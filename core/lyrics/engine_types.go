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
	// CheckProviders asks each enabled provider for a well-known recording and
	// returns the refreshed statuses. Only run on request.
	CheckProviders(ctx context.Context) []ProviderStatus

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
	ErrNotStorable     = errors.New("these lyrics may neither be kept nor shown by this server: they can only be previewed")
	ErrNoCandidate     = errors.New("no such lyrics candidate, search again")
	ErrEmptyLyrics     = errors.New("the lyrics are empty")
	ErrNothingToDelete = errors.New("there are no downloaded lyrics to delete")
	ErrBusy            = errors.New("another bulk lyrics job is running")
)

// ProviderStatus is a provider's info plus whether it is searched automatically.
type ProviderStatus struct {
	ProviderInfo
	Enabled bool `json:"enabled"`
	// Availability is the state of the service right now (the Availability*
	// constants); Verified in ProviderInfo is what development checked.
	Availability string `json:"availability"`
	// LiveVerified is true once a request to the service has succeeded since the
	// server started.
	LiveVerified bool `json:"liveVerified"`
	// KaraokeVerified is true once a verified match with real word timing has
	// come back since the server started.
	KaraokeVerified bool `json:"karaokeVerified"`
	// Display is how results may be shown when they may not be kept: DisplaySession
	// (while playing, from memory, never written to disk) or DisplayPreview (in
	// the lyrics manager only).
	Display string `json:"display"`
	// StoreEligible is true when this provider's lyrics may be kept permanently.
	// StoreVerified is true only when that rests on a document named in a storage
	// authorization; StoreBasis and StoreReference say what it rests on. Storable
	// (embedded) repeats StoreEligible for the clients that read it.
	StoreEligible  bool   `json:"storeEligible"`
	StoreVerified  bool   `json:"storeVerified"`
	StoreBasis     string `json:"storeBasis,omitempty"`
	StoreReference string `json:"storeReference,omitempty"`
	// Offline says whether results stay available without the network: only
	// once saved, so only for a provider whose lyrics may be kept.
	Offline          string     `json:"offline"`
	LastSuccess      *time.Time `json:"lastSuccess,omitempty"`
	LastFailure      *time.Time `json:"lastFailure,omitempty"`
	LastError        string     `json:"lastError,omitempty"`
	RateLimitedUntil *time.Time `json:"rateLimitedUntil,omitempty"`
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

// IgnoredSource is a sidecar that is not used, and why.
type IgnoredSource struct {
	File     string `json:"file"`
	Provider string `json:"provider,omitempty"`
	// Reason is "credits-only".
	Reason string `json:"reason"`
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
	// Ignored lists files next to the audio that Navidrome wrote itself and no
	// longer uses (a saved result that only held credits), so the administrator
	// can remove them. Nothing is removed without that decision.
	Ignored []IgnoredSource `json:"ignored"`
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
	// NotSaved is true when the lyrics are shown but were not written anywhere:
	// they are held in memory and are not available offline.
	NotSaved bool `json:"notSaved,omitempty"`
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
	// NoDisplay keeps results that may not be saved from being shown from
	// memory. A bulk job sets it: filling memory with lyrics nobody asked to
	// see is not what it is for.
	NoDisplay bool
}

// Resolve results.
const (
	ResolveHave     = "have-lyrics"
	ResolveFound    = "found"
	ResolveUpgraded = "upgraded"
	ResolveNotFound = "not-found"
	// ResolveNotSaved means a good result was found but may not be kept, and it
	// was not shown either (a bulk job).
	ResolveNotSaved    = "not-saved"
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
	// Persisted is true when something was saved next to the audio. A result
	// that was only shown has Applied set and Persisted false.
	Persisted bool `json:"persisted"`
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
	// All covers every track in the library (up to a safety limit).
	All bool
	// Confirm is required for BulkReplaceManual, which can supersede lyrics the
	// user supplied.
	Confirm bool
}

// BulkStatus is the progress of a bulk job.
type BulkStatus struct {
	ID       string `json:"id"`
	Action   string `json:"action"`
	State    string `json:"state"` // running, done, cancelled
	Total    int    `json:"total"`
	Done     int    `json:"done"`
	Found    int    `json:"found"`
	Upgraded int    `json:"upgraded"`
	Kept     int    `json:"kept"`
	Missing  int    `json:"missing"`
	// Unsaved counts tracks where a good result was found that may not be kept.
	Unsaved  int       `json:"unsaved"`
	Failed   int       `json:"failed"`
	Started  time.Time `json:"started"`
	Finished time.Time `json:"finished,omitempty"`
	Message  string    `json:"message,omitempty"`
}
