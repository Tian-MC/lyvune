package lyrics

import (
	"context"
	"time"

	"github.com/Tian-MC/lyvune/model"
)

// TrimDriveSlashForTest exposes the Windows file URL handling, which only runs on Windows.
func TrimDriveSlashForTest(p string) string { return trimDriveSlash(p) }

// IsRootedForTest exposes the check for paths that start at a root.
func IsRootedForTest(p string) bool { return isRooted(p) }

// Test hooks: make the pacing and retry delays negligible.
func FastForTest(p OnlineProvider) {
	switch v := p.(type) {
	case *lrclib:
		v.pacer.interval, v.pacer.base = 0, 0
		v.backoff = time.Millisecond
		v.timeout = 300 * time.Millisecond
	case *musixmatch:
		v.pacer.interval, v.pacer.base = 0, 0
		v.timeout = 300 * time.Millisecond
	case *netease:
		v.http.pacer.interval, v.http.pacer.base = 0, 0
		v.http.backoff = time.Millisecond
		v.http.timeout = 300 * time.Millisecond
	case *qq:
		v.direct.pacer.interval, v.bl.pacer.interval = 0, 0
		v.direct.pacer.base, v.bl.pacer.base = 0, 0
		v.direct.backoff, v.bl.backoff = time.Millisecond, time.Millisecond
		v.direct.timeout, v.bl.timeout = 300*time.Millisecond, 300*time.Millisecond
	case *kugou:
		v.emptyRetry = time.Millisecond
		v.http.pacer.interval, v.http.pacer.base = 0, 0
		v.http.backoff = time.Millisecond
		v.http.timeout = 300 * time.Millisecond
	}
}

// RejectSyntheticWordTiming exposes the guard to the tests.
func RejectSyntheticWordTiming(l model.LyricList) (model.LyricList, bool) {
	return rejectSyntheticWordTiming(l)
}

// CreditsOnly exposes the credits check to the tests.
func CreditsOnly(l model.LyricList) bool { return creditsOnly(l) }

// ReadEnvelopeForTest reads a track's sidecar the way the engine does.
func ReadEnvelopeForTest(ctx context.Context, mf *model.MediaFile) (*Envelope, string) {
	return readEnvelope(ctx, mf)
}

// CueCountForTest counts the word cues of the main lyrics.
func CueCountForTest(l model.LyricList) int { return cueCount(l) }

// AutomaticCandidatesForTest exposes the policy applied to provider results
// before automatic retrieval and upgrades choose one.
func AutomaticCandidatesForTest(cands []Candidate, includeTranslations bool) []Candidate {
	return automaticCandidates(cands, Settings{IncludeProviderTranslations: includeTranslations})
}

// SetBulkWaitForTest shortens the waits of bulk jobs after a provider asks to
// slow down; the returned function restores them.
func SetBulkWaitForTest(base, maxWait time.Duration) func() {
	oldBase, oldMax := bulkBackoffBase, bulkMaxWait
	bulkBackoffBase, bulkMaxWait = base, maxWait
	return func() { bulkBackoffBase, bulkMaxWait = oldBase, oldMax }
}
