package lyrics

import (
	"context"
	"errors"
	"time"

	"github.com/navidrome/navidrome/model"
)

// Engine manages lyrics beyond reading them: retrieval from providers, the
// user's choices, safe storage, history and bulk work. It is implemented by the
// same service that implements Lyrics.
type Engine interface {
	Settings(ctx context.Context) Settings
	SaveSettings(ctx context.Context, s Settings) (Settings, error)
	// Providers lists every provider with its status; it never returns credentials.
	Providers(ctx context.Context) []ProviderStatus

	Status(ctx context.Context, mf *model.MediaFile) (SongStatus, error)
	Search(ctx context.Context, mf *model.MediaFile, opts SearchOptions) (SearchResult, error)
	Apply(ctx context.Context, mf *model.MediaFile, req ApplyRequest) (ApplyResult, error)
	Import(ctx context.Context, mf *model.MediaFile, req ImportRequest) (ApplyResult, error)
	Resolve(ctx context.Context, mf *model.MediaFile, opts ResolveOptions) (ResolveResult, error)
	SetLocked(ctx context.Context, mf *model.MediaFile, locked bool) error
	SetOffset(ctx context.Context, mf *model.MediaFile, offsetMs int64) error
	Restore(ctx context.Context, mf *model.MediaFile, versionID string) (ApplyResult, error)
	DeleteManaged(ctx context.Context, mf *model.MediaFile) (ApplyResult, error)

	StartBulk(ctx context.Context, req BulkRequest) (BulkStatus, error)
	Bulk(id string) (BulkStatus, bool)
	CancelBulk(id string) bool
}

// EngineOf returns the Engine behind a Lyrics service, or nil if it has none.
func EngineOf(l Lyrics) Engine {
	e, _ := l.(Engine)
	return e
}

// Errors of the engine. The native API maps them to HTTP statuses.
var (
	ErrLocked          = errors.New("these lyrics are locked")
	ErrConfirmRequired = errors.New("replacing the current lyrics needs confirmation")
	ErrNotStorable     = errors.New("this provider does not allow its lyrics to be saved")
	ErrNoCandidate     = errors.New("no such lyrics candidate, search again")
	ErrEmptyLyrics     = errors.New("the lyrics are empty")
	ErrNothingToDelete = errors.New("there are no downloaded lyrics to delete")
	ErrBusy            = errors.New("another bulk lyrics job is running")
)

// ProviderStatus is a provider's info plus whether it is searched automatically.
type ProviderStatus struct {
	ProviderInfo
	Enabled bool `json:"enabled"`
}

// SourceInfo describes one set of lyrics a track has, for display.
type SourceInfo struct {
	// ID is what Apply takes to select this source: "embedded", "sidecar:.lrc",
	// "managed" or "user".
	ID       string  `json:"id"`
	Source   string  `json:"source"`
	Provider string  `json:"provider,omitempty"`
	Quality  string  `json:"quality"`
	File     string  `json:"file,omitempty"`
	Origin   string  `json:"origin,omitempty"`
	Lang     string  `json:"lang,omitempty"`
	Lines    int     `json:"lines"`
	Match    float64 `json:"confidence,omitempty"`
	// RetrievedAt is set for lyrics Navidrome stored.
	RetrievedAt *time.Time `json:"retrievedAt,omitempty"`
	Attribution string     `json:"attribution,omitempty"`
}

// SongStatus is everything the lyrics manager shows for a track.
type SongStatus struct {
	// Current is what is shown during playback; nil when there are no lyrics.
	Current *SourceInfo `json:"current"`
	// Local lists every local alternative, including the current one.
	Local []SourceInfo `json:"local"`
	// Locked protects the current lyrics from automatic replacement.
	Locked   bool  `json:"locked"`
	OffsetMs int64 `json:"offsetMs"`
	// History is the undo history of the Navidrome sidecar, newest first.
	History []Version `json:"history"`
	// Writable is false when lyrics cannot be saved for this track (a remote
	// library, or no readable library folder).
	Writable bool `json:"writable"`
	// WriteError explains why Writable is false.
	WriteError string `json:"writeError,omitempty"`
	// MissingRecently is true when providers recently found nothing.
	MissingRecently bool `json:"missingRecently"`
}

// SearchOptions selects providers for a manual search.
type SearchOptions struct {
	// Providers limits the search; empty means every provider that is ready.
	Providers []string
	// ShowAll includes weak matches that are normally hidden.
	ShowAll bool
}

// ProviderOutcome reports how one provider answered a search.
type ProviderOutcome struct {
	ID         string `json:"id"`
	Status     string `json:"status"`
	Count      int    `json:"count"`
	Message    string `json:"message,omitempty"`
	RetryAfter int    `json:"retryAfter,omitempty"`
}

// Outcome statuses.
const (
	OutcomeOK          = "ok"
	OutcomeError       = "error"
	OutcomeRateLimited = "rate-limited"
	OutcomeDisabled    = "disabled"
	OutcomeUnavailable = "unavailable"
)

// SearchResult is the answer to a manual search.
type SearchResult struct {
	Candidates []Candidate       `json:"-"`
	Providers  []ProviderOutcome `json:"providers"`
}

// ApplyRequest selects a candidate as the track's preferred lyrics.
type ApplyRequest struct {
	// CandidateID comes from a search or from Status.Local.
	CandidateID string
	// Confirm acknowledges that the current lyrics will be superseded. It is
	// required when they are a sidecar, embedded or previously chosen lyrics.
	Confirm bool
	// Force replaces lyrics that are locked.
	Force bool
}

// ImportRequest adds lyrics from a file the user provides.
type ImportRequest struct {
	FileName string
	Content  []byte
	Confirm  bool
	Force    bool
}

// ApplyResult says what happened, in terms the user can act on.
type ApplyResult struct {
	// Action is "created-preferred", "replaced-managed", "replaced-preferred",
	// "restored" or "deleted".
	Action string `json:"action"`
	// Superseded is the source that is no longer shown ("" when there was none).
	Superseded string `json:"superseded,omitempty"`
	// EmbeddedKept is true when embedded lyrics remain in the audio, unchanged.
	EmbeddedKept bool `json:"embeddedKept,omitempty"`
	// Undo is the history version that restores the previous state.
	Undo   string      `json:"undo,omitempty"`
	Status *SongStatus `json:"status,omitempty"`
}

// ResolveOptions tunes Resolve.
type ResolveOptions struct {
	// Recheck ignores the "not found recently" and "checked recently" memory.
	Recheck bool
	// Explicit marks an action the user asked for, such as a bulk job. It does
	// not depend on the automatic retrieval and upgrade settings.
	Explicit bool
	// ReplaceManual lets this run supersede sidecar or embedded lyrics. It is
	// only honoured for an explicit bulk operation the user confirmed.
	ReplaceManual bool
}

// Resolve results.
const (
	ResolveHave        = "have-lyrics"
	ResolveFound       = "found"
	ResolveUpgraded    = "upgraded"
	ResolveNotFound    = "not-found"
	ResolveKept        = "kept"
	ResolveLocked      = "locked"
	ResolveDisabled    = "disabled"
	ResolveUnavailable = "unavailable"
	ResolveSkipped     = "skipped"
)

// ResolveResult reports what automatic retrieval did.
type ResolveResult struct {
	Result  string      `json:"result"`
	Applied *SourceInfo `json:"applied,omitempty"`
	Message string      `json:"message,omitempty"`
	// RetryAfter is set (in seconds) when a provider asked us to slow down.
	RetryAfter int `json:"retryAfter,omitempty"`
}

// Bulk actions.
const (
	BulkMissing       = "missing"
	BulkUpgrade       = "upgrade"
	BulkRecheck       = "recheck"
	BulkReplaceManual = "replace-manual"
)

// BulkRequest starts a bulk operation over tracks.
type BulkRequest struct {
	Action   string
	TrackIDs []string
	AlbumIDs []string
	// Confirm is required for BulkReplaceManual, which can supersede lyrics the
	// user supplied.
	Confirm bool
}

// BulkStatus is the progress of a bulk job.
type BulkStatus struct {
	ID       string    `json:"id"`
	Action   string    `json:"action"`
	State    string    `json:"state"` // running, done, cancelled
	Total    int       `json:"total"`
	Done     int       `json:"done"`
	Found    int       `json:"found"`
	Upgraded int       `json:"upgraded"`
	Kept     int       `json:"kept"`
	Missing  int       `json:"missing"`
	Failed   int       `json:"failed"`
	Started  time.Time `json:"started"`
	Finished time.Time `json:"finished,omitempty"`
	Message  string    `json:"message,omitempty"`
}
