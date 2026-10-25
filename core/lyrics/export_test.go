package lyrics

import (
	"time"

	"github.com/navidrome/navidrome/model"
)

// Test hooks: make the pacing and retry delays negligible.
func FastForTest(p OnlineProvider) {
	switch v := p.(type) {
	case *lrclib:
		v.pacer.interval = 0
		v.backoff = time.Millisecond
		v.timeout = 300 * time.Millisecond
	case *musixmatch:
		v.pacer.interval = 0
		v.timeout = 300 * time.Millisecond
	case *netease:
		v.http.pacer.interval = 0
		v.http.backoff = time.Millisecond
		v.http.timeout = 300 * time.Millisecond
	case *kugou:
		v.emptyRetry = time.Millisecond
		v.http.pacer.interval = 0
		v.http.backoff = time.Millisecond
		v.http.timeout = 300 * time.Millisecond
	}
}

// RejectSyntheticWordTiming exposes the guard to the tests.
func RejectSyntheticWordTiming(l model.LyricList) (model.LyricList, bool) {
	return rejectSyntheticWordTiming(l)
}
