package lyrics

import "time"

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
	}
}
