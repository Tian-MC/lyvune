package lyrics

import (
	"context"
	"errors"
	"io"
	"io/fs"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/Tian-MC/lyvune/conf"
	"github.com/Tian-MC/lyvune/core/storage"
	"github.com/Tian-MC/lyvune/log"
	"github.com/Tian-MC/lyvune/model"
)

// settingsTTL keeps the settings read off the hot path: lyrics are resolved on
// every track start.
const settingsTTL = 5 * time.Second

func (l *lyricsService) knownProviderIDs() []string {
	var ids []string
	for _, p := range l.providers.All() {
		ids = append(ids, p.Info().ID)
	}
	return ids
}

func (l *lyricsService) settings(ctx context.Context) Settings {
	l.settingsMu.Lock()
	defer l.settingsMu.Unlock()
	if l.ds == nil {
		return DefaultSettings().Sanitize(l.knownProviderIDs())
	}
	if l.settingsAt.IsZero() || time.Since(l.settingsAt) > settingsTTL {
		l.settingsCache = l.props.settings(ctx, l.knownProviderIDs())
		l.settingsAt = time.Now()
	}
	return l.settingsCache
}

func (l *lyricsService) forgetSettings() {
	l.settingsMu.Lock()
	l.settingsAt = time.Time{}
	l.settingsMu.Unlock()
}

// libraryFS opens the filesystem of a track's library for reading.
func libraryFS(mf *model.MediaFile) (fs.FS, error) {
	st, err := storage.For(mf.LibraryPath)
	if err != nil {
		return nil, err
	}
	return st.FS()
}

// readEnvelope returns the Lyvune sidecar of a track, if it has a valid one.
// A `.lyrics.json` that is not a Lyvune envelope belongs to someone else and
// is ignored.
func readEnvelope(ctx context.Context, mf *model.MediaFile) (*Envelope, string) {
	if mf == nil || mf.LibraryPath == "" || mf.Path == "" {
		return nil, ""
	}
	fsys, err := libraryFS(mf)
	if err != nil {
		log.Trace(ctx, "no filesystem for lyrics sidecar", err)
		return nil, ""
	}
	dir := path.Dir(mf.Path)
	for _, name := range CandidateNames(path.Base(mf.Path)) {
		f, err := fsys.Open(path.Join(dir, name))
		if err != nil {
			continue
		}
		data, err := io.ReadAll(io.LimitReader(f, maxEnvelopeBytes+1))
		_ = f.Close()
		if err != nil {
			continue
		}
		env, err := ParseEnvelope(data)
		if err != nil {
			if !errors.Is(err, ErrInvalidEnvelope) {
				log.Warn(ctx, "error reading lyrics sidecar", "file", name, err)
			}
			continue
		}
		return &env, name
	}
	return nil, ""
}

// Where a result shown from memory came from: found by the automatic retrieval,
// or chosen by the administrator.
const (
	originAuto   = "auto"
	originChosen = "chosen"
)

// junkManaged reports a sidecar Lyvune wrote itself that holds no lyrics, only
// credits. An earlier version saved such an answer (a single "作曲 : name" line)
// for songs a service had no lyrics for. It is treated as absent, so it is not
// shown and a later retrieval replaces it (the file is kept in the history). A
// sidecar the user chose is never ignored this way.
func junkManaged(env *Envelope) bool {
	return env.Origin == OriginManaged && creditsOnly(env.Lyrics)
}

// effective is the lock and offset in force for a track. The sidecar holds them
// when there is one; otherwise they are in the database.
func (l *lyricsService) effective(ctx context.Context, mf *model.MediaFile, env *Envelope) SongState {
	if env != nil {
		return SongState{Locked: env.Locked, OffsetMs: env.OffsetMs}
	}
	if l.ds == nil {
		return SongState{}
	}
	return l.props.state(ctx, mf.ID)
}

// current is what a track shows during playback.
type current struct {
	list model.LyricList
	info SourceInfo
	mf   *model.MediaFile
	env  *Envelope
	// state is the effective lock/offset.
	state SongState
}

func sourceInfoOf(id string, source Source, list model.LyricList) SourceInfo {
	info := SourceInfo{ID: id, Source: source.String(), Quality: QualityOf(list).String()}
	for _, ly := range list {
		if ly.IsMainKind() {
			info.Lines = len(ly.Line)
			info.Lang = ly.Lang
			break
		}
	}
	return info
}

func envelopeInfo(env *Envelope, name string) SourceInfo {
	id, source := "managed", SourceManaged
	if env.Origin == OriginUser {
		id, source = "user", SourceUser
	}
	info := sourceInfoOf(id, source, env.Lyrics)
	retrieved := env.RetrievedAt
	info.Provider, info.File, info.Origin = env.Provider, name, env.Origin
	info.Match, info.RetrievedAt, info.Attribution = env.Confidence, &retrieved, env.Attribution
	return info
}

func legacyInfo(hit legacyHit) SourceInfo {
	switch {
	case strings.EqualFold(hit.token, "embedded"):
		return sourceInfoOf("embedded", SourceEmbedded, hit.list)
	case strings.HasPrefix(hit.token, "."):
		info := sourceInfoOf("sidecar:"+hit.token, SourceSidecar, hit.list)
		ext := path.Ext(hit.mf.Path)
		info.File = path.Base(hit.mf.Path[:len(hit.mf.Path)-len(ext)] + hit.token)
		return info
	default:
		info := sourceInfoOf("plugin:"+hit.token, SourceRemote, hit.list)
		info.Provider = hit.token
		return info
	}
}

// resolveCurrent decides which lyrics a track shows.
//
//  1. Lyrics the user chose (or imported) always win.
//  2. Local files in the configured lyricspriority order: sidecars, embedded
//     tags and plugins.
//  3. Lyrics Lyvune downloaded.
//
// When "prefer local" is turned off, downloaded lyrics compete with local ones
// on quality instead, and local wins ties. A locked source is not special here:
// the lock only stops automatic replacement.
func (l *lyricsService) resolveCurrent(ctx context.Context, mediaFiles []*model.MediaFile) (current, error) {
	type found struct {
		env  *Envelope
		name string
		mf   *model.MediaFile
	}
	var user, managed *found
	for _, mf := range mediaFiles {
		if mf == nil {
			continue
		}
		env, name := readEnvelope(ctx, mf)
		if env == nil || junkManaged(env) {
			continue
		}
		f := &found{env: env, name: name, mf: mf}
		if env.Origin == OriginUser && user == nil {
			user = f
		}
		if env.Origin == OriginManaged && managed == nil {
			managed = f
		}
	}

	finish := func(list model.LyricList, info SourceInfo, mf *model.MediaFile, env *Envelope) (current, error) {
		st := l.effective(ctx, mf, env)
		return current{list: withOffset(list, st.OffsetMs), info: info, mf: mf, env: env, state: st}, nil
	}

	// Lyrics the administrator chose to show, though they may not be kept, outrank
	// everything for as long as they are held in memory
	var shown *displayEntry
	var shownFile *model.MediaFile
	for _, mf := range mediaFiles {
		if mf == nil {
			continue
		}
		if e := l.display.get(mf.ID, l.now()); e != nil {
			shown, shownFile = e, mf
			break
		}
	}
	showing := func() (current, error) {
		st := l.effective(ctx, shownFile, nil)
		info := sourceInfoOf("display", SourceRemote, shown.list)
		info.Provider, info.Match, info.Attribution = shown.provider, shown.match, shown.attribution
		at := shown.at
		info.RetrievedAt, info.Origin = &at, originAuto
		if shown.chosen {
			info.Origin = originChosen
		}
		return current{list: withOffset(shown.list, st.OffsetMs), info: info, mf: shownFile, state: st}, nil
	}
	if shown != nil && shown.chosen {
		return showing()
	}

	if user != nil {
		return finish(user.env.Display(), envelopeInfo(user.env, user.name), user.mf, user.env)
	}

	base := current{}
	hit, haveLocal := l.resolveLegacy(ctx, mediaFiles)
	preferLocal := l.settings(ctx).PreferLocal
	switch {
	case managed != nil && (!haveLocal || (!preferLocal && QualityOf(managed.env.Lyrics) > QualityOf(hit.list))):
		base, _ = finish(managed.env.Display(), envelopeInfo(managed.env, managed.name), managed.mf, managed.env)
	case haveLocal:
		base, _ = finish(hit.list, legacyInfo(hit), hit.mf, nil)
	}
	// A result found automatically that may only be shown fills a gap, and beats
	// what was saved only when it is better; local files keep priority
	if shown != nil {
		switch {
		case base.list == nil:
			return showing()
		case base.info.Source == SourceManaged.String() && shown.quality > ParseQuality(base.info.Quality):
			return showing()
		case !preferLocal && base.info.Source != SourceManaged.String() && shown.quality > ParseQuality(base.info.Quality):
			return showing()
		}
	}
	return base, nil
}

// localCandidates lists every local lyrics source of a track: the Lyvune
// sidecar, each configured sidecar format, and embedded tags.
func (l *lyricsService) localCandidates(ctx context.Context, mf *model.MediaFile) []Candidate {
	var out []Candidate
	add := func(c Candidate) {
		c.Quality = QualityOf(c.Lyrics)
		if c.Quality != QualityNone {
			out = append(out, c)
		}
	}
	if env, name := readEnvelope(ctx, mf); env != nil && !junkManaged(env) {
		info := envelopeInfo(env, name)
		src := SourceManaged
		if env.Origin == OriginUser {
			src = SourceUser
		}
		add(Candidate{ID: info.ID, Provider: env.Provider, Source: src, Lyrics: env.Display(), Meta: env.Recording,
			Match: Match{Confidence: env.Confidence}, Storable: true, Attribution: env.Attribution, File: name})
	}
	for pattern := range strings.SplitSeq(conf.Server.LyricsPriority, ",") {
		pattern = strings.TrimSpace(pattern)
		switch {
		case pattern == "" || strings.EqualFold(pattern, EnvelopeSuffix):
		case strings.EqualFold(pattern, "embedded"):
			if list, err := fromEmbedded(ctx, mf); err == nil {
				add(Candidate{ID: "embedded", Provider: "embedded", Source: SourceEmbedded, Lyrics: list, Storable: true})
			}
		case strings.HasPrefix(pattern, "."):
			list, err := fromExternalFile(ctx, mf, pattern)
			if err != nil {
				continue
			}
			ext := path.Ext(mf.Path)
			add(Candidate{ID: "sidecar:" + pattern, Provider: "sidecar", Source: SourceSidecar, Lyrics: list, Storable: true,
				File: path.Base(mf.Path[:len(mf.Path)-len(ext)] + pattern)})
		}
	}
	return out
}

// searchCache remembers the candidates of recent searches so Apply can refer to
// one by ID. The lyrics themselves never come from the client: a candidate can
// only be one the server found.
type searchCache struct {
	mu      sync.Mutex
	entries map[string]searchEntry
}

type searchEntry struct {
	at    time.Time
	cands map[string]Candidate
}

const (
	searchCacheTTL = 15 * time.Minute
	searchCacheMax = 64
)

func newSearchCache() *searchCache { return &searchCache{entries: map[string]searchEntry{}} }

func (c *searchCache) put(songID string, cands []Candidate, now time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	byID := make(map[string]Candidate, len(cands))
	for _, cand := range cands {
		byID[cand.ID] = cand
	}
	c.entries[songID] = searchEntry{at: now, cands: byID}
	if len(c.entries) > searchCacheMax {
		oldestID, oldest := "", now
		for id, e := range c.entries {
			if e.at.Before(oldest) {
				oldestID, oldest = id, e.at
			}
		}
		delete(c.entries, oldestID)
	}
}

func (c *searchCache) get(songID, candidateID string, now time.Time) (Candidate, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[songID]
	if !ok || now.Sub(e.at) > searchCacheTTL {
		return Candidate{}, false
	}
	cand, ok := e.cands[candidateID]
	return cand, ok
}
