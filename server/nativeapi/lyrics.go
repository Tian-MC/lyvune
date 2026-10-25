package nativeapi

import (
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/navidrome/navidrome/core/lyrics"
	"github.com/navidrome/navidrome/log"
	"github.com/navidrome/navidrome/model"
)

// maxLyricsBody bounds a request body: an import is up to 2 MB of text, which can
// grow when JSON-escaped.
const maxLyricsBody = 8 << 20

// previewLines bounds how many lines a candidate preview carries.
const previewLines = 400

// addLyricsRoute registers the lyrics management API under /lyrics.
//
// Reading the state of a track and asking for automatic retrieval are open to
// every signed-in user. Everything that chooses, imports, locks, restores or
// deletes lyrics changes files in the shared music library, so it is admin only.
func (api *Router) addLyricsRoute(r chi.Router) {
	if api.lyrics == nil {
		return
	}
	r.Route("/lyrics", func(r chi.Router) {
		r.Get("/settings", api.getLyricsSettings)
		r.Get("/song/{id}", api.withTrack(api.getLyricsStatus))
		r.Post("/song/{id}/resolve", api.withTrack(api.resolveLyrics))

		r.With(adminOnlyMiddleware).Group(func(r chi.Router) {
			r.Put("/settings", api.putLyricsSettings)
			r.Post("/providers/check", api.checkLyricsProviders)
			r.Post("/song/{id}/search", api.withTrack(api.searchLyrics))
			r.Post("/song/{id}/apply", api.withTrack(api.applyLyrics))
			r.Post("/song/{id}/import", api.withTrack(api.importLyrics))
			r.Put("/song/{id}/lock", api.withTrack(api.lockLyrics))
			r.Put("/song/{id}/offset", api.withTrack(api.offsetLyrics))
			r.Post("/song/{id}/restore", api.withTrack(api.restoreLyrics))
			r.Delete("/song/{id}", api.withTrack(api.deleteLyrics))

			r.Post("/bulk", api.startLyricsBulk)
			r.Get("/bulk/{id}", api.getLyricsBulk)
			r.Delete("/bulk/{id}", api.cancelLyricsBulk)
		})
	})
}

type lyricsHandler func(w http.ResponseWriter, r *http.Request, mf *model.MediaFile)

func (api *Router) withTrack(h lyricsHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		mf, err := api.ds.MediaFile().Get(r.Context(), chi.URLParam(r, "id"))
		if errors.Is(err, model.ErrNotFound) {
			lyricsError(w, http.StatusNotFound, "not-found", "No such track")
			return
		}
		if err != nil {
			log.Error(r.Context(), "Error loading track for lyrics", err)
			lyricsError(w, http.StatusInternalServerError, "internal", "Could not load the track")
			return
		}
		h(w, r, mf)
	}
}

func lyricsJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func lyricsError(w http.ResponseWriter, status int, code, message string) {
	lyricsJSON(w, status, map[string]string{"error": code, "message": message})
}

func decodeLyricsBody(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxLyricsBody)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		lyricsError(w, http.StatusBadRequest, "bad-request", "The request could not be read")
		return false
	}
	return true
}

// failLyrics maps an engine error to an HTTP answer a person can act on.
func failLyrics(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, lyrics.ErrLocked):
		lyricsError(w, http.StatusConflict, "locked", "These lyrics are locked. Unlock them, or replace them anyway.")
	case errors.Is(err, lyrics.ErrConfirmRequired):
		lyricsError(w, http.StatusConflict, "confirm-required", "This replaces lyrics that were supplied or chosen on purpose. Confirm to continue.")
	case errors.Is(err, lyrics.ErrNotStorable):
		lyricsError(w, http.StatusUnprocessableEntity, "not-storable", "Saving is off for this provider. An administrator can allow it in Settings, under Lyrics.")
	case errors.Is(err, lyrics.ErrNoCandidate):
		lyricsError(w, http.StatusNotFound, "no-candidate", "That result is no longer available. Search again.")
	case errors.Is(err, lyrics.ErrEmptyLyrics), errors.Is(err, lyrics.ErrInvalidEnvelope):
		lyricsError(w, http.StatusUnprocessableEntity, "empty", "There are no usable lyrics in that.")
	case errors.Is(err, lyrics.ErrNoVersion), errors.Is(err, lyrics.ErrNothingToDelete), errors.Is(err, fs.ErrNotExist):
		lyricsError(w, http.StatusNotFound, "not-found", "There is nothing to restore or delete.")
	case errors.Is(err, lyrics.ErrBusy):
		lyricsError(w, http.StatusConflict, "busy", "Another bulk lyrics job is already running.")
	case errors.Is(err, lyrics.ErrNotLocal):
		lyricsError(w, http.StatusUnprocessableEntity, "not-local", "Lyrics can only be saved for libraries on a local disk.")
	case errors.Is(err, lyrics.ErrReadOnly):
		lyricsError(w, http.StatusUnprocessableEntity, "read-only", "The library folder cannot be written to.")
	case errors.Is(err, lyrics.ErrUnsafePath):
		lyricsError(w, http.StatusUnprocessableEntity, "unsafe-path", "That location is not safe to write to.")
	case errors.Is(err, lyrics.ErrNotManaged):
		lyricsError(w, http.StatusConflict, "not-managed", "A file with that name exists that Navidrome did not write, so it was left alone.")
	default:
		log.Error(r.Context(), "Lyrics operation failed", err)
		lyricsError(w, http.StatusInternalServerError, "internal", "The lyrics operation failed.")
	}
}

// ---------------------------------------------------------------------------
// Settings and providers

func (api *Router) getLyricsSettings(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	lyricsJSON(w, http.StatusOK, map[string]any{
		"settings":  api.lyrics.Settings(ctx),
		"providers": api.lyrics.Providers(ctx),
	})
}

// checkLyricsProviders searches a well-known recording on every enabled
// provider, so their status reflects what answers now.
func (api *Router) checkLyricsProviders(w http.ResponseWriter, r *http.Request) {
	lyricsJSON(w, http.StatusOK, map[string]any{"providers": api.lyrics.CheckProviders(r.Context())})
}

func (api *Router) putLyricsSettings(w http.ResponseWriter, r *http.Request) {
	var s lyrics.Settings
	if !decodeLyricsBody(w, r, &s) {
		return
	}
	saved, err := api.lyrics.SaveSettings(r.Context(), s)
	if err != nil {
		failLyrics(w, r, err)
		return
	}
	lyricsJSON(w, http.StatusOK, map[string]any{"settings": saved, "providers": api.lyrics.Providers(r.Context())})
}

// ---------------------------------------------------------------------------
// One track

func (api *Router) getLyricsStatus(w http.ResponseWriter, r *http.Request, mf *model.MediaFile) {
	st, err := api.lyrics.Status(r.Context(), mf)
	if err != nil {
		failLyrics(w, r, err)
		return
	}
	lyricsJSON(w, http.StatusOK, st)
}

func (api *Router) resolveLyrics(w http.ResponseWriter, r *http.Request, mf *model.MediaFile) {
	res, err := api.lyrics.Resolve(r.Context(), mf, lyrics.ResolveOptions{})
	if err != nil {
		failLyrics(w, r, err)
		return
	}
	lyricsJSON(w, http.StatusOK, res)
}

// candidateDTO is what the interface needs to list and preview a candidate. The
// lyrics are shown for preview only: applying one refers to it by ID, so the
// client can never supply lyrics of its own through a "candidate".
type candidateDTO struct {
	ID           string        `json:"id"`
	Provider     string        `json:"provider"`
	Source       string        `json:"source"`
	Quality      string        `json:"quality"`
	Verified     bool          `json:"verified"`
	Match        lyrics.Match  `json:"match"`
	Meta         lyrics.Meta   `json:"meta"`
	Storable     bool          `json:"storable"`
	Attribution  string        `json:"attribution,omitempty"`
	Lines        int           `json:"lines"`
	WordTiming   bool          `json:"wordTiming"`
	Translation  bool          `json:"translation"`
	Romanization bool          `json:"romanization"`
	Preview      []previewLine `json:"preview"`
	Truncated    bool          `json:"truncated,omitempty"`
}

type previewLine struct {
	Start *int64 `json:"start,omitempty"`
	Text  string `json:"text"`
}

func toCandidateDTO(c lyrics.Candidate) candidateDTO {
	dto := candidateDTO{
		ID: c.ID, Provider: c.Provider, Source: c.Source.String(), Quality: c.Quality.String(),
		Verified: c.Match.Verified(), Match: c.Match, Meta: c.Meta, Storable: c.Storable,
		Attribution: c.Attribution, Preview: []previewLine{},
	}
	for _, l := range c.Lyrics {
		switch l.EffectiveKind() {
		case model.LyricKindTranslation:
			dto.Translation = true
		case model.LyricKindPronunciation:
			dto.Romanization = true
		case model.LyricKindMain:
			if dto.Lines > 0 {
				continue
			}
			dto.Lines = len(l.Line)
			for i, line := range l.Line {
				if len(line.Cue) > 0 && line.Cue[0].Start != nil {
					dto.WordTiming = true
				}
				if i < previewLines {
					dto.Preview = append(dto.Preview, previewLine{Start: line.Start, Text: line.Value})
				}
			}
			dto.Truncated = len(l.Line) > previewLines
		}
	}
	return dto
}

func (api *Router) searchLyrics(w http.ResponseWriter, r *http.Request, mf *model.MediaFile) {
	var body struct {
		Providers []string `json:"providers"`
		ShowAll   bool     `json:"showAll"`
	}
	if r.ContentLength != 0 && !decodeLyricsBody(w, r, &body) {
		return
	}
	res, err := api.lyrics.Search(r.Context(), mf, lyrics.SearchOptions{Providers: body.Providers, ShowAll: body.ShowAll})
	if err != nil {
		failLyrics(w, r, err)
		return
	}
	dtos := make([]candidateDTO, 0, len(res.Candidates))
	for _, c := range res.Candidates {
		dtos = append(dtos, toCandidateDTO(c))
	}
	lyricsJSON(w, http.StatusOK, map[string]any{"candidates": dtos, "providers": res.Providers})
}

func (api *Router) applyLyrics(w http.ResponseWriter, r *http.Request, mf *model.MediaFile) {
	var body struct {
		CandidateID string `json:"candidateId"`
		Confirm     bool   `json:"confirm"`
		Force       bool   `json:"force"`
	}
	if !decodeLyricsBody(w, r, &body) {
		return
	}
	res, err := api.lyrics.Apply(r.Context(), mf, lyrics.ApplyRequest{CandidateID: body.CandidateID, Confirm: body.Confirm, Force: body.Force})
	if err != nil {
		failLyrics(w, r, err)
		return
	}
	lyricsJSON(w, http.StatusOK, res)
}

func (api *Router) importLyrics(w http.ResponseWriter, r *http.Request, mf *model.MediaFile) {
	var body struct {
		FileName string `json:"fileName"`
		Content  string `json:"content"`
		Confirm  bool   `json:"confirm"`
		Force    bool   `json:"force"`
	}
	if !decodeLyricsBody(w, r, &body) {
		return
	}
	res, err := api.lyrics.Import(r.Context(), mf, lyrics.ImportRequest{
		FileName: body.FileName, Content: []byte(body.Content), Confirm: body.Confirm, Force: body.Force,
	})
	if err != nil {
		failLyrics(w, r, err)
		return
	}
	lyricsJSON(w, http.StatusOK, res)
}

func (api *Router) lockLyrics(w http.ResponseWriter, r *http.Request, mf *model.MediaFile) {
	var body struct {
		Locked bool `json:"locked"`
	}
	if !decodeLyricsBody(w, r, &body) {
		return
	}
	if err := api.lyrics.SetLocked(r.Context(), mf, body.Locked); err != nil {
		failLyrics(w, r, err)
		return
	}
	api.getLyricsStatus(w, r, mf)
}

func (api *Router) offsetLyrics(w http.ResponseWriter, r *http.Request, mf *model.MediaFile) {
	var body struct {
		OffsetMs int64 `json:"offsetMs"`
	}
	if !decodeLyricsBody(w, r, &body) {
		return
	}
	if err := api.lyrics.SetOffset(r.Context(), mf, body.OffsetMs); err != nil {
		failLyrics(w, r, err)
		return
	}
	api.getLyricsStatus(w, r, mf)
}

func (api *Router) restoreLyrics(w http.ResponseWriter, r *http.Request, mf *model.MediaFile) {
	var body struct {
		Version string `json:"version"`
	}
	if !decodeLyricsBody(w, r, &body) {
		return
	}
	res, err := api.lyrics.Restore(r.Context(), mf, body.Version)
	if err != nil {
		failLyrics(w, r, err)
		return
	}
	lyricsJSON(w, http.StatusOK, res)
}

func (api *Router) deleteLyrics(w http.ResponseWriter, r *http.Request, mf *model.MediaFile) {
	res, err := api.lyrics.DeleteManaged(r.Context(), mf)
	if err != nil {
		failLyrics(w, r, err)
		return
	}
	lyricsJSON(w, http.StatusOK, res)
}

// ---------------------------------------------------------------------------
// Bulk

func (api *Router) startLyricsBulk(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Action   string   `json:"action"`
		TrackIDs []string `json:"trackIds"`
		AlbumIDs []string `json:"albumIds"`
		All      bool     `json:"all"`
		Confirm  bool     `json:"confirm"`
	}
	if !decodeLyricsBody(w, r, &body) {
		return
	}
	st, err := api.lyrics.StartBulk(r.Context(), lyrics.BulkRequest{
		Action: body.Action, TrackIDs: body.TrackIDs, AlbumIDs: body.AlbumIDs, All: body.All, Confirm: body.Confirm,
	})
	if err != nil {
		if errors.Is(err, lyrics.ErrConfirmRequired) || errors.Is(err, lyrics.ErrBusy) {
			failLyrics(w, r, err)
			return
		}
		lyricsError(w, http.StatusBadRequest, "bad-request", err.Error())
		return
	}
	lyricsJSON(w, http.StatusAccepted, st)
}

func (api *Router) getLyricsBulk(w http.ResponseWriter, r *http.Request) {
	st, ok := api.lyrics.Bulk(chi.URLParam(r, "id"))
	if !ok {
		lyricsError(w, http.StatusNotFound, "not-found", "No such job")
		return
	}
	lyricsJSON(w, http.StatusOK, st)
}

func (api *Router) cancelLyricsBulk(w http.ResponseWriter, r *http.Request) {
	if !api.lyrics.CancelBulk(chi.URLParam(r, "id")) {
		lyricsError(w, http.StatusNotFound, "not-found", "No running job with that ID")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
