package lyrics

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/Tian-MC/lyvune/log"
	"github.com/Tian-MC/lyvune/model"
)

const (
	searchTimeout   = 20 * time.Second
	maxSearchShown  = 30
	maxImportBytes  = 2 << 20
	maxOffsetMs     = 10 * 60 * 1000
	autoResolveTime = 40 * time.Second
)

func targetOf(mf *model.MediaFile) Target {
	return Target{Root: mf.LibraryPath, AudioRel: filepath.ToSlash(mf.Path)}
}

func (l *lyricsService) Settings(ctx context.Context) Settings { return l.settings(ctx) }

func (l *lyricsService) SaveSettings(ctx context.Context, s Settings) (Settings, error) {
	s = s.Sanitize(l.knownProviderIDs())
	if l.ds != nil {
		if err := l.props.putSettings(ctx, s); err != nil {
			return Settings{}, err
		}
	}
	l.forgetSettings()
	return s, nil
}

func (l *lyricsService) Providers(ctx context.Context) []ProviderStatus {
	cfg := l.settings(ctx)
	enabled := cfg.Providers
	out := make([]ProviderStatus, 0, len(l.providers.All()))
	for _, p := range l.providers.All() {
		info := p.Info()
		st := ProviderStatus{ProviderInfo: info, Enabled: info.Status == StatusReady && slices.Contains(enabled, info.ID)}
		l.applyRights(&st, cfg)
		l.health.apply(&st, l.now())
		out = append(out, st)
	}
	return out
}

// checkRecording is searched by CheckProviders: a well-known recording that
// the providers can be expected to have.
var checkRecording = Recording{Title: "Judas", Artist: "Lady Gaga", Album: "Born This Way", DurationSec: 249}

// CheckProviders asks every provider that is ready and turned on for one
// well-known recording, so the status shows whether they answer now. It is run
// on request, never in the background.
func (l *lyricsService) CheckProviders(ctx context.Context) []ProviderStatus {
	enabled := l.settings(ctx).Providers
	var ps []OnlineProvider
	for _, p := range l.providers.All() {
		if info := p.Info(); info.Status == StatusReady && slices.Contains(enabled, info.ID) {
			ps = append(ps, p)
		}
	}
	l.searchRecording(ctx, checkRecording, ps)
	return l.Providers(ctx)
}

func (l *lyricsService) Status(ctx context.Context, mf *model.MediaFile) (SongStatus, error) {
	cur, err := l.resolveCurrent(ctx, []*model.MediaFile{mf})
	if err != nil {
		return SongStatus{}, err
	}
	st := SongStatus{Local: []SourceInfo{}, History: []Version{}, Ignored: []IgnoredSource{}}
	if env, name := readEnvelope(ctx, mf); env != nil && junkManaged(env) {
		st.Ignored = append(st.Ignored, IgnoredSource{File: name, Provider: env.Provider, Reason: "credits-only"})
	}
	if cur.list != nil {
		info := cur.info
		st.Current = &info
		st.Locked, st.OffsetMs = cur.state.Locked, cur.state.OffsetMs
	} else {
		state := l.effective(ctx, mf, nil)
		st.Locked, st.OffsetMs = state.Locked, state.OffsetMs
	}
	for _, c := range l.localCandidates(ctx, mf) {
		info := sourceInfoOf(c.ID, c.Source, c.Lyrics)
		info.Provider, info.File, info.Match, info.Attribution = c.Provider, c.File, c.Match.Confidence, c.Attribution
		if c.Source == SourceUser || c.Source == SourceManaged {
			if env, _ := readEnvelope(ctx, mf); env != nil {
				info = envelopeInfo(env, c.File)
			}
		}
		st.Local = append(st.Local, info)
	}
	t := targetOf(mf)
	if _, err := l.store.resolve(t); err != nil {
		st.WriteError = writeErrorText(err)
	} else {
		st.Writable = true
		st.History = append(st.History, l.store.Versions(t)...)
	}
	if l.ds != nil {
		st.MissingRecently = l.props.recentMiss(ctx, mf.ID, l.now())
	}
	return st, nil
}

func writeErrorText(err error) string {
	switch {
	case errors.Is(err, ErrNotLocal):
		return "Lyrics can only be saved for libraries on a local disk."
	case errors.Is(err, ErrUnsafePath):
		return "The track is reached through a symbolic link that leaves the library, so it is not written to."
	default:
		return "The library folder cannot be written to."
	}
}

// ---------------------------------------------------------------------------
// Search

type providerResult struct {
	id    string
	cands []Candidate
	err   error
	skip  string
}

// searchProviders picks the providers a search asks. Without an explicit list it
// is every provider that is ready; an explicit list may name providers that are
// not, which then report why they were not searched.
func (l *lyricsService) searchProviders(opts SearchOptions) []OnlineProvider {
	var out []OnlineProvider
	for _, p := range l.providers.All() {
		id := p.Info().ID
		switch {
		case len(opts.Providers) > 0 && slices.Contains(opts.Providers, id):
			out = append(out, p)
		case len(opts.Providers) == 0 && p.Info().Status == StatusReady:
			out = append(out, p)
		}
	}
	return out
}

// searchAll queries providers concurrently. One provider failing, being slow or
// being rate limited never affects the others.
func (l *lyricsService) searchAll(ctx context.Context, mf *model.MediaFile, providers []OnlineProvider) ([]Candidate, []ProviderOutcome) {
	return l.searchRecording(ctx, RecordingOf(mf), providers)
}

func (l *lyricsService) searchRecording(ctx context.Context, rec Recording, providers []OnlineProvider) ([]Candidate, []ProviderOutcome) {
	timeout := searchTimeout
	if ctx.Value(bulkCtxKey{}) != nil {
		timeout = bulkSearchTimeout
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	results := make([]providerResult, len(providers))
	var wg sync.WaitGroup
	for i, p := range providers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			info := p.Info()
			if info.Status != StatusReady {
				results[i] = providerResult{id: info.ID, skip: info.Status}
				return
			}
			cands, err := p.Search(ctx, rec)
			results[i] = providerResult{id: info.ID, cands: cands, err: err}
		}()
	}
	wg.Wait()

	var all []Candidate
	outcomes := make([]ProviderOutcome, 0, len(results))
	for i, r := range results {
		out := ProviderOutcome{ID: r.id, Status: OutcomeOK, Count: len(r.cands)}
		var rl *RateLimitedError
		switch {
		case r.skip != "":
			out.Status = OutcomeDisabled
			if r.skip == StatusUnavailable {
				out.Status = OutcomeUnavailable
			}
			out.Message = providers[i].Info().Reason
		case errors.As(r.err, &rl):
			out.Status, out.RetryAfter = OutcomeRateLimited, int(rl.RetryAfter.Seconds())
			out.Message = rl.Error()
		case errors.Is(r.err, ErrProviderDisabled):
			out.Status, out.Message = OutcomeDisabled, "Not configured or turned off"
		case errors.Is(r.err, ErrProviderUnavailable):
			out.Status, out.Message = OutcomeUnavailable, r.err.Error()
		case r.err != nil:
			out.Status, out.Message = OutcomeError, r.err.Error()
			log.Debug(ctx, "Lyrics provider failed", "provider", r.id, r.err)
		}
		cands := dropCreditOnly(r.cands)
		l.health.record(out, cands, l.now())
		out.Count = len(cands)
		outcomes = append(outcomes, out)
		all = append(all, cands...)
	}
	// What may be done with a result follows from the provider's rights, never
	// from the provider's own say-so (a provider the table does not know, such as
	// a plugin, speaks for itself)
	now := l.now()
	cfg := l.settings(ctx)
	for i := range all {
		c := &all[i]
		r, ok := l.rights.get(c.Provider, now)
		if !ok {
			c.AutoSave = c.Storable && cfg.AutoPersist
			continue
		}
		pref, _ := cfg.savePreference(c.Provider, r)
		c.Storable = r.allowed()
		c.AutoSave = c.Storable && pref && cfg.AutoPersist
		c.CanShow = r.Display == DisplaySession
		c.DisplayOnly = !c.Storable && c.CanShow
		c.Rights = r.Status
	}
	return all, outcomes
}

// applyRights fills what is known about keeping a provider's lyrics, and what
// the administrator wants done with them.
func (l *lyricsService) applyRights(st *ProviderStatus, cfg Settings) {
	r, ok := l.rights.get(st.ID, l.now())
	if !ok {
		st.Display, st.StoreStatus, st.StoreAllowed = DisplayPreview, RightsUnclear, st.ProviderInfo.Storable
		st.SavePreference, st.SavePreferenceSource = st.StoreAllowed, PrefDefault
	} else {
		st.Display, st.StoreStatus, st.StoreAllowed, st.StoreVerified = r.Display, r.Status, r.allowed(), r.verified()
		st.StoreBasis, st.StoreReference = r.Basis, r.Reference
		st.SavePreference, st.SavePreferenceSource = cfg.savePreference(st.ID, r)
		st.SavePreference = st.SavePreference && st.StoreAllowed
	}
	st.Storable = st.StoreAllowed
	st.Offline = "when-saved"
	if !st.StoreAllowed {
		st.Offline = "no"
	}
}

// usable keeps the results that can be put to use: saved when the automatic
// retrieval may keep them, or shown from memory when they may be shown and the
// caller allows it.
func usable(cands []Candidate, opts ResolveOptions) []Candidate {
	out := make([]Candidate, 0, len(cands))
	for _, c := range cands {
		if c.AutoSave || (c.CanShow && !opts.NoDisplay) || (c.DisplayOnly && !opts.NoDisplay) {
			out = append(out, c)
		}
	}
	return out
}

func (l *lyricsService) Search(ctx context.Context, mf *model.MediaFile, opts SearchOptions) (SearchResult, error) {
	cands, outcomes := l.searchAll(ctx, mf, l.searchProviders(opts))
	l.searches.put(mf.ID, cands, l.now())

	shown := make([]Candidate, 0, len(cands))
	for _, c := range cands {
		if opts.ShowAll || c.Match.Listed() {
			shown = append(shown, c)
		}
	}
	sort.SliceStable(shown, func(i, j int) bool {
		a, b := shown[i], shown[j]
		if a.Match.Verified() != b.Match.Verified() {
			return a.Match.Verified()
		}
		if a.Quality != b.Quality {
			return a.Quality > b.Quality
		}
		return a.Match.Confidence > b.Match.Confidence
	})
	if len(shown) > maxSearchShown {
		shown = shown[:maxSearchShown]
	}
	return SearchResult{Candidates: shown, Providers: outcomes}, nil
}

// ---------------------------------------------------------------------------
// Choosing lyrics

func (l *lyricsService) candidateByID(ctx context.Context, mf *model.MediaFile, id string) (Candidate, bool) {
	for _, c := range l.localCandidates(ctx, mf) {
		if c.ID == id {
			c.Meta = Meta{Title: mf.Title, Artist: mf.Artist, Album: mf.Album, DurationSec: float64(mf.Duration)}
			if c.Source == SourceEmbedded || c.Source == SourceSidecar {
				c.Match = Match{Confidence: 1}
			}
			return c, true
		}
	}
	return l.searches.get(mf.ID, id, l.now())
}

// needsConfirmation reports whether choosing other lyrics supersedes something
// the user supplied or chose, which must be an explicit decision.
func needsConfirmation(cur current) bool {
	if cur.list == nil {
		return false
	}
	switch cur.info.Source {
	case SourceUser.String(), SourceSidecar.String(), SourceEmbedded.String():
		return true
	case SourceRemote.String():
		// Lyrics shown after an automatic retrieval may be replaced freely. A plugin's
		// lyrics and ones the administrator chose to show may not
		return cur.info.Origin != originAuto
	}
	return false
}

func (l *lyricsService) save(ctx context.Context, mf *model.MediaFile, cand Candidate, origin string, cur current) (Version, error) {
	env := NewEnvelope(cand, origin, l.now())
	env.Locked, env.OffsetMs = cur.state.Locked, cur.state.OffsetMs
	prev, err := l.store.Save(targetOf(mf), env)
	if err == nil {
		err = verifySaved(ctx, mf, cand)
	}
	if err != nil {
		l.recordSave(cand.Provider, false, saveFailure(err))
		return Version{}, err
	}
	l.recordSave(cand.Provider, true, "")
	l.display.drop(mf.ID) // what was just saved is now the lyrics of the track
	if l.ds != nil {
		// The sidecar now holds the lock and offset
		state := l.props.state(ctx, mf.ID)
		state.Locked, state.OffsetMs = false, 0
		_ = l.props.putState(ctx, mf.ID, state)
		l.props.clearMiss(ctx, mf.ID)
	}
	return prev, nil
}

// recordSave notes the outcome of a save for the provider's status. Lyrics the
// user supplied are not a provider's.
func (l *lyricsService) recordSave(provider string, ok bool, message string) {
	switch provider {
	case "", "import", "sidecar", "embedded":
		return
	}
	l.health.recordSave(provider, ok, message, l.now())
}

// saveFailure says in a few words why a save failed.
func saveFailure(err error) string {
	switch {
	case errors.Is(err, ErrSaveUnverified):
		return "The file was written but could not be read back as saved."
	case errors.Is(err, ErrReadOnly), errors.Is(err, ErrNotLocal), errors.Is(err, ErrUnsafePath):
		return writeErrorText(err)
	default:
		return "The file could not be written."
	}
}

// verifySaved reads the sidecar back, the way the player will, and checks that
// it holds what was meant to be saved: the same quality and the same word
// timing. A save is only reported once this holds.
func verifySaved(ctx context.Context, mf *model.MediaFile, cand Candidate) error {
	env, _ := readEnvelope(ctx, mf)
	if env == nil || QualityOf(env.Lyrics) != QualityOf(cand.Lyrics) || cueCount(env.Lyrics) != cueCount(cand.Lyrics) {
		return ErrSaveUnverified
	}
	return nil
}

// cueCount counts the word-level cues of the main lyrics.
func cueCount(list model.LyricList) int {
	n := 0
	for _, l := range list {
		if !l.IsMainKind() {
			continue
		}
		for _, line := range l.Line {
			n += len(line.Cue)
		}
	}
	return n
}

func (l *lyricsService) apply(ctx context.Context, mf *model.MediaFile, cand Candidate, confirm, force bool, mode string) (ApplyResult, error) {
	if cand.Quality == QualityNone || QualityOf(cand.Lyrics) == QualityNone {
		return ApplyResult{}, ErrEmptyLyrics
	}
	// Saving is refused only when the provider's terms are recorded as
	// restricting it. Showing needs a provider that may be shown.
	saving := mode == ModeSave || (mode == "" && cand.Storable)
	switch {
	case saving && !cand.Storable:
		if cand.Rights == RightsRestricted {
			return ApplyResult{}, ErrStorageRestricted
		}
		return ApplyResult{}, ErrNotStorable
	case !saving && !cand.CanShow && !cand.DisplayOnly:
		return ApplyResult{}, ErrNotStorable
	}
	cur, err := l.resolveCurrent(ctx, []*model.MediaFile{mf})
	if err != nil {
		return ApplyResult{}, err
	}
	if cur.state.Locked && !force {
		return ApplyResult{}, ErrLocked
	}
	if needsConfirmation(cur) && !confirm {
		return ApplyResult{}, ErrConfirmRequired
	}
	if !saving {
		return l.applyDisplay(ctx, mf, cand, cur)
	}
	res := ApplyResult{Action: "created-preferred"}
	if cur.list != nil {
		res.Superseded = cur.info.Source
		if cur.env != nil && cur.env.Origin == OriginManaged {
			res.Action = "replaced-managed"
		} else if cur.env != nil {
			res.Action = "replaced-preferred"
		}
	}
	prev, err := l.save(ctx, mf, cand, OriginUser, cur)
	if err != nil {
		return ApplyResult{}, err
	}
	if prev.Existed || prev.ID != "" {
		res.Undo = prev.ID
	}
	for _, c := range l.localCandidates(ctx, mf) {
		if c.Source == SourceEmbedded {
			res.EmbeddedKept = true
		}
	}
	if status, err := l.Status(ctx, mf); err == nil {
		res.Status = &status
	}
	return res, nil
}

// applyDisplay shows a result the administrator chose although it may not be
// kept. Nothing is written: the lyrics are held in memory, outrank the others
// for as long as they are held, and are not available offline.
func (l *lyricsService) applyDisplay(ctx context.Context, mf *model.MediaFile, cand Candidate, cur current) (ApplyResult, error) {
	res := ApplyResult{Action: "shown-not-saved", NotSaved: true}
	if cur.list != nil {
		res.Superseded = cur.info.Source
	}
	l.display.put(mf.ID, &displayEntry{
		list: cand.Lyrics, provider: cand.Provider, quality: cand.Quality, match: cand.Match.Confidence,
		attribution: cand.Attribution, chosen: true, at: l.now(),
	})
	for _, c := range l.localCandidates(ctx, mf) {
		if c.Source == SourceEmbedded {
			res.EmbeddedKept = true
		}
	}
	if status, err := l.Status(ctx, mf); err == nil {
		res.Status = &status
	}
	return res, nil
}

func (l *lyricsService) Apply(ctx context.Context, mf *model.MediaFile, req ApplyRequest) (ApplyResult, error) {
	cand, ok := l.candidateByID(ctx, mf, req.CandidateID)
	if !ok {
		return ApplyResult{}, ErrNoCandidate
	}
	cur, _ := l.resolveCurrent(ctx, []*model.MediaFile{mf})
	if cur.list != nil && cur.info.ID == cand.ID && (cand.Source == SourceUser || cand.Source == SourceManaged) {
		res := ApplyResult{Action: "unchanged"}
		if status, err := l.Status(ctx, mf); err == nil {
			res.Status = &status
		}
		return res, nil
	}
	return l.apply(ctx, mf, cand, req.Confirm, req.Force, req.Mode)
}

func importSuffix(name string) string {
	lower := strings.ToLower(name)
	for _, suffix := range []string{EnvelopeSuffix, ".elrc", ".lrc", ".ttml", ".srt", ".txt", ".yaml", ".yml"} {
		if strings.HasSuffix(lower, suffix) {
			return suffix
		}
	}
	return "auto"
}

func (l *lyricsService) Import(ctx context.Context, mf *model.MediaFile, req ImportRequest) (ApplyResult, error) {
	if len(req.Content) == 0 || len(req.Content) > maxImportBytes {
		return ApplyResult{}, ErrEmptyLyrics
	}
	var list model.LyricList
	suffix := importSuffix(req.FileName)
	if suffix == EnvelopeSuffix {
		env, err := ParseEnvelope(req.Content)
		if err != nil {
			return ApplyResult{}, err
		}
		list = env.Lyrics
	} else {
		var err error
		list, err = model.ParseLyrics(ctx, suffix, "xxx", req.Content)
		if err != nil {
			return ApplyResult{}, fmt.Errorf("%w: %w", ErrEmptyLyrics, err)
		}
	}
	cand := Candidate{
		ID: "import", Provider: "import", Source: SourceUser, Lyrics: list, Quality: QualityOf(list),
		Meta:        Meta{Title: mf.Title, Artist: mf.Artist, Album: mf.Album, DurationSec: float64(mf.Duration)},
		Match:       Match{Confidence: 1},
		Storable:    true,
		Attribution: "Imported from " + filepath.Base(req.FileName),
	}
	return l.apply(ctx, mf, cand, req.Confirm, req.Force, ModeSave)
}

// ---------------------------------------------------------------------------
// Lock, offset, history, delete

func (l *lyricsService) SetLocked(ctx context.Context, mf *model.MediaFile, locked bool) error {
	return l.updateState(ctx, mf, func(s *SongState) { s.Locked = locked }, func(e *Envelope) { e.Locked = locked })
}

func (l *lyricsService) SetOffset(ctx context.Context, mf *model.MediaFile, offsetMs int64) error {
	offsetMs = max(-maxOffsetMs, min(maxOffsetMs, offsetMs))
	return l.updateState(ctx, mf, func(s *SongState) { s.OffsetMs = offsetMs }, func(e *Envelope) { e.OffsetMs = offsetMs })
}

// updateState changes the lock or offset where it lives: in the sidecar when the
// track has one, otherwise in the database.
func (l *lyricsService) updateState(ctx context.Context, mf *model.MediaFile, db func(*SongState), file func(*Envelope)) error {
	if env, _ := readEnvelope(ctx, mf); env != nil {
		return l.store.Update(targetOf(mf), file)
	}
	if l.ds == nil {
		return nil
	}
	st := l.props.state(ctx, mf.ID)
	db(&st)
	return l.props.putState(ctx, mf.ID, st)
}

func (l *lyricsService) result(ctx context.Context, mf *model.MediaFile, action string, prev Version) ApplyResult {
	res := ApplyResult{Action: action}
	if prev.ID != "" {
		res.Undo = prev.ID
	}
	if status, err := l.Status(ctx, mf); err == nil {
		res.Status = &status
	}
	return res
}

func (l *lyricsService) Restore(ctx context.Context, mf *model.MediaFile, versionID string) (ApplyResult, error) {
	prev, err := l.store.Restore(targetOf(mf), versionID)
	if err != nil {
		return ApplyResult{}, err
	}
	l.display.drop(mf.ID) // an explicit restore is what should be shown now
	if l.ds != nil {
		l.props.clearMiss(ctx, mf.ID)
	}
	return l.result(ctx, mf, "restored", prev), nil
}

func (l *lyricsService) DeleteManaged(ctx context.Context, mf *model.MediaFile) (ApplyResult, error) {
	prev, err := l.store.Delete(targetOf(mf))
	if errors.Is(err, fs.ErrNotExist) {
		return ApplyResult{}, ErrNothingToDelete
	}
	if err != nil {
		return ApplyResult{}, err
	}
	return l.result(ctx, mf, "deleted", prev), nil
}

// ---------------------------------------------------------------------------
// Automatic retrieval and upgrade

func (l *lyricsService) Resolve(ctx context.Context, mf *model.MediaFile, opts ResolveOptions) (ResolveResult, error) {
	// Concurrent requests for the same track (several tabs, rapid skipping) share
	// one search. It outlives the request that started it, so a client that
	// navigates away does not cancel the work another one is waiting for.
	v, err, _ := l.flight.Do(mf.ID, func() (any, error) {
		bg, cancel := context.WithTimeout(context.WithoutCancel(ctx), autoResolveTime)
		defer cancel()
		return l.resolve(bg, mf, opts)
	})
	if err != nil {
		return ResolveResult{}, err
	}
	return v.(ResolveResult), nil
}

func autoSaveOnly(cands []Candidate) []Candidate {
	out := make([]Candidate, 0, len(cands))
	for _, c := range cands {
		if c.AutoSave {
			out = append(out, c)
		}
	}
	return out
}

func (l *lyricsService) enabledProviders(s Settings) []OnlineProvider {
	var out []OnlineProvider
	for _, id := range s.Providers {
		if p, ok := l.providers.Get(id); ok && p.Info().Status == StatusReady {
			out = append(out, p)
		}
	}
	return out
}

func (l *lyricsService) resolve(ctx context.Context, mf *model.MediaFile, opts ResolveOptions) (ResolveResult, error) {
	s := l.settings(ctx)
	cur, err := l.resolveCurrent(ctx, []*model.MediaFile{mf})
	if err != nil {
		return ResolveResult{}, err
	}
	if cur.list == nil {
		return l.retrieveMissing(ctx, mf, s, opts)
	}
	return l.upgrade(ctx, mf, s, cur, opts)
}

func (l *lyricsService) policy(s Settings) Policy {
	return Policy{MinConfidence: s.MinConfidence, ProviderOrder: s.Providers}
}

// automaticCandidates drops the translation tracks of provider results before
// automatic retrieval or upgrade chooses or saves one, unless the administrator
// wants them. The candidates are copied, not changed.
func automaticCandidates(cands []Candidate, s Settings) []Candidate {
	if s.IncludeProviderTranslations {
		return cands
	}
	out := make([]Candidate, len(cands))
	for i, c := range cands {
		c.Lyrics = withoutTranslations(c.Lyrics)
		out[i] = c
	}
	return out
}

func rateLimitOf(outcomes []ProviderOutcome) (int, bool) {
	retry := 0
	for _, o := range outcomes {
		if o.Status == OutcomeRateLimited && o.RetryAfter > retry {
			retry = o.RetryAfter
		}
	}
	return retry, retry > 0
}

func anyFailed(outcomes []ProviderOutcome) bool {
	for _, o := range outcomes {
		if o.Status == OutcomeError || o.Status == OutcomeRateLimited || o.Status == OutcomeUnavailable {
			return true
		}
	}
	return false
}

func (l *lyricsService) retrieveMissing(ctx context.Context, mf *model.MediaFile, s Settings, opts ResolveOptions) (ResolveResult, error) {
	if !s.AutoRetrieve && !opts.Explicit {
		return ResolveResult{Result: ResolveDisabled}, nil
	}
	if l.ds != nil && !opts.Recheck && l.props.recentMiss(ctx, mf.ID, l.now()) {
		return ResolveResult{Result: ResolveNotFound, Message: "Providers found nothing recently"}, nil
	}
	providers := l.enabledProviders(s)
	if len(providers) == 0 {
		return ResolveResult{Result: ResolveUnavailable, Message: "No lyrics provider is enabled"}, nil
	}
	cands, outcomes := l.searchAll(ctx, mf, providers)
	cands = automaticCandidates(cands, s)
	if retry, limited := rateLimitOf(outcomes); limited {
		return ResolveResult{Result: ResolveUnavailable, RetryAfter: retry, Message: "A provider asked to slow down"}, nil
	}
	pol := l.policy(s)
	best, ok := Choose(usable(cands, opts), pol)
	if !ok {
		// Something good may exist that is not allowed to be kept or shown here
		if _, any := Choose(cands, pol); any && !anyFailed(outcomes) {
			return ResolveResult{Result: ResolveNotSaved, Message: "A result was found that may not be kept"}, nil
		}
		if !anyFailed(outcomes) && l.ds != nil {
			// Only a clean "nothing there" is remembered; an outage must not hide the track
			l.props.recordMiss(ctx, mf.ID, l.now())
		}
		result := ResolveNotFound
		if anyFailed(outcomes) {
			result = ResolveUnavailable
		}
		return ResolveResult{Result: result}, nil
	}
	persisted := false
	// An ignored sidecar is Lyvune's own file that is no longer used. Nothing
	// automatic overwrites it: the administrator removes it, or replaces it by choice.
	blocked := hasIgnoredSidecar(ctx, mf)
	if blocked && opts.NoDisplay {
		return ResolveResult{Result: ResolveNotSaved, Message: "A saved file next to this track is ignored; remove it in the lyrics manager first"}, nil
	}
	// Automatic retrieval keeps lyrics only where keeping is allowed; the best
	// of those goes to disk even when a better one can only be shown
	if keep, ok := Choose(autoSaveOnly(cands), pol); ok && !blocked {
		if _, err := l.save(ctx, mf, keep, OriginManaged, current{}); err != nil {
			if errors.Is(err, ErrReadOnly) || errors.Is(err, ErrNotLocal) || errors.Is(err, ErrUnsafePath) {
				if best.AutoSave {
					return ResolveResult{Result: ResolveUnavailable, Message: writeErrorText(err)}, nil
				}
			} else {
				return ResolveResult{}, err
			}
		} else {
			persisted = true
		}
	}
	shownOnly := !best.AutoSave || blocked
	if shownOnly {
		l.showAuto(ctx, mf, best)
	}
	info := sourceInfoOf("managed", SourceManaged, best.Lyrics)
	if shownOnly {
		info = sourceInfoOf("display", SourceRemote, best.Lyrics)
		info.Origin = originAuto
	}
	info.Provider, info.Match = best.Provider, best.Match.Confidence
	res := ResolveResult{Result: ResolveFound, Applied: &info, Persisted: persisted}
	if blocked {
		res.Message = "Shown, not saved: a saved file next to this track is ignored; remove it in the lyrics manager to let lyrics be saved"
	}
	return res, nil
}

// hasIgnoredSidecar reports whether the track has a sidecar Lyvune wrote that
// is no longer used (see junkManaged).
func hasIgnoredSidecar(ctx context.Context, mf *model.MediaFile) bool {
	env, _ := readEnvelope(ctx, mf)
	return env != nil && junkManaged(env)
}

// showAuto holds a result that may only be shown, found by the automatic
// retrieval. It is remembered per track so the provider is not asked again for
// every play, and flagged in the database so an upgrade check is not skipped
// after a restart has emptied it.
func (l *lyricsService) showAuto(ctx context.Context, mf *model.MediaFile, c Candidate) {
	l.display.put(mf.ID, &displayEntry{
		list: c.Lyrics, provider: c.Provider, quality: c.Quality, match: c.Match.Confidence,
		attribution: c.Attribution, at: l.now(),
	})
	if l.ds != nil {
		st := l.props.state(ctx, mf.ID)
		if !st.Shown {
			st.Shown = true
			_ = l.props.putState(ctx, mf.ID, st)
		}
	}
}

//nolint:gocyclo // a single list of upgrade rules; splitting it would scatter them
func (l *lyricsService) upgrade(ctx context.Context, mf *model.MediaFile, s Settings, cur current, opts ResolveOptions) (ResolveResult, error) {
	if cur.state.Locked {
		return ResolveResult{Result: ResolveLocked}, nil
	}
	// Lyrics the user chose are never replaced automatically. Sidecar and
	// embedded lyrics are only superseded when that was allowed.
	allowManual := s.AutoReplaceManual || opts.ReplaceManual
	switch cur.info.Source {
	case SourceManaged.String():
	case SourceSidecar.String(), SourceEmbedded.String():
		if !allowManual {
			return ResolveResult{Result: ResolveHave}, nil
		}
	case SourceRemote.String():
		// Only lyrics shown after an automatic retrieval are upgraded; a plugin's
		// lyrics and ones the administrator chose to show are never replaced automatically
		if cur.info.Origin != originAuto {
			return ResolveResult{Result: ResolveHave}, nil
		}
	default:
		return ResolveResult{Result: ResolveHave}, nil
	}
	if !s.AutoUpgrade && !opts.Explicit {
		return ResolveResult{Result: ResolveDisabled}, nil
	}
	curQuality := ParseQuality(cur.info.Quality)
	if curQuality == QualityKaraoke {
		return ResolveResult{Result: ResolveHave}, nil
	}
	if l.ds != nil && !opts.Recheck {
		st := l.props.state(ctx, mf.ID)
		// A better result that may only be shown is lost when the server restarts;
		// the track is then looked at again instead of waiting for the next check
		lostShown := st.Shown && l.display.get(mf.ID, l.now()) == nil
		if at := st.CheckedAt; at > 0 && l.now().Sub(time.Unix(at, 0)) < upgradeEvery && !lostShown {
			return ResolveResult{Result: ResolveSkipped, Message: "Checked recently"}, nil
		}
	}
	providers := l.enabledProviders(s)
	if len(providers) == 0 {
		return ResolveResult{Result: ResolveUnavailable, Message: "No lyrics provider is enabled"}, nil
	}
	cands, outcomes := l.searchAll(ctx, mf, providers)
	cands = automaticCandidates(cands, s)
	if retry, limited := rateLimitOf(outcomes); limited {
		return ResolveResult{Result: ResolveUnavailable, RetryAfter: retry, Message: "A provider asked to slow down"}, nil
	}
	var best *Candidate
	for _, c := range Eligible(usable(cands, opts), l.policy(s)) {
		if IsUpgrade(curQuality, c) {
			c := c
			best = &c
			break
		}
	}
	if l.ds != nil && !anyFailed(outcomes) && (best == nil || best.AutoSave) {
		if st := l.props.state(ctx, mf.ID); st.Shown {
			st.Shown = false
			_ = l.props.putState(ctx, mf.ID, st)
		}
	}
	if !anyFailed(outcomes) {
		l.markChecked(ctx, mf)
	}
	if best == nil {
		// A provider that did not answer is not the same as "nothing better exists"
		if anyFailed(outcomes) {
			return ResolveResult{Result: ResolveUnavailable}, nil
		}
		return ResolveResult{Result: ResolveKept}, nil
	}
	if !best.AutoSave {
		// Better, but it is not to be saved automatically: it is shown from memory, and what is saved stays as it was
		l.showAuto(ctx, mf, *best)
		info := sourceInfoOf("display", SourceRemote, best.Lyrics)
		info.Origin, info.Provider, info.Match = originAuto, best.Provider, best.Match.Confidence
		return ResolveResult{Result: ResolveUpgraded, Applied: &info}, nil
	}
	// Replacing a manual sidecar goes in the user layer, so it outranks it
	origin := OriginManaged
	if cur.info.Source != SourceManaged.String() {
		origin = OriginUser
	}
	if _, err := l.save(ctx, mf, *best, origin, cur); err != nil {
		if errors.Is(err, ErrReadOnly) || errors.Is(err, ErrNotLocal) || errors.Is(err, ErrUnsafePath) {
			return ResolveResult{Result: ResolveUnavailable, Message: writeErrorText(err)}, nil
		}
		return ResolveResult{}, err
	}
	info := sourceInfoOf("managed", SourceManaged, best.Lyrics)
	info.Provider, info.Match = best.Provider, best.Match.Confidence
	return ResolveResult{Result: ResolveUpgraded, Applied: &info}, nil
}

func (l *lyricsService) markChecked(ctx context.Context, mf *model.MediaFile) {
	if l.ds == nil {
		return
	}
	st := l.props.state(ctx, mf.ID)
	st.CheckedAt = l.now().Unix()
	_ = l.props.putState(ctx, mf.ID, st)
}

// dropCreditOnly removes candidates whose lyrics are only credits. Such an
// answer means the service has no lyrics for the song; it is not a result.
func dropCreditOnly(cands []Candidate) []Candidate {
	out := cands[:0:0]
	for _, c := range cands {
		if len(c.Lyrics) > 0 && creditsOnly(c.Lyrics) {
			continue
		}
		out = append(out, c)
	}
	return out
}
