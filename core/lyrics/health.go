package lyrics

import (
	"sync"
	"time"
)

// Availability values reported for a provider. They describe the service right
// now, and are separate from whether the adapter exists (Implemented) or was
// ever checked (Verified).
const (
	AvailabilityAvailable   = "available"
	AvailabilityOff         = "off"
	AvailabilityNeedsKey    = "needs-credentials"
	AvailabilityNotUsable   = "not-available"
	AvailabilityRateLimited = "rate-limited"
	AvailabilityTemporarily = "temporarily-unavailable"
)

// providerHealth is what searches have shown about a provider since the server
// started. It is deliberately in memory: it reports what happened, not what was
// once true.
type providerHealth struct {
	lastSuccess time.Time
	lastFailure time.Time
	lastError   string
	karaokeSeen bool
	limitedTill time.Time
}

// healthTracker records the outcome of every provider search.
type healthTracker struct {
	mu sync.Mutex
	m  map[string]*providerHealth
}

func newHealthTracker() *healthTracker { return &healthTracker{m: map[string]*providerHealth{}} }

func (h *healthTracker) get(id string) *providerHealth {
	ph := h.m[id]
	if ph == nil {
		ph = &providerHealth{}
		h.m[id] = ph
	}
	return ph
}

// record notes one search outcome. A request that found nothing still counts as
// a success: the service answered. Karaoke is only noted for a verified match
// that really carries word timing.
func (h *healthTracker) record(o ProviderOutcome, cands []Candidate, now time.Time) {
	if o.Status == OutcomeDisabled {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	ph := h.get(o.ID)
	switch o.Status {
	case OutcomeOK:
		ph.lastSuccess = now
		ph.limitedTill = time.Time{}
		for _, c := range cands {
			if c.Quality == QualityKaraoke && c.Match.Verified() {
				ph.karaokeSeen = true
			}
		}
	case OutcomeRateLimited:
		ph.lastFailure, ph.lastError = now, o.Message
		ph.limitedTill = now.Add(time.Duration(o.RetryAfter) * time.Second)
	default:
		ph.lastFailure, ph.lastError = now, o.Message
	}
}

// apply fills the runtime fields of a provider's status.
func (h *healthTracker) apply(st *ProviderStatus, now time.Time) {
	h.mu.Lock()
	defer h.mu.Unlock()
	ph := h.m[st.ID]
	if ph != nil {
		if !ph.lastSuccess.IsZero() {
			t := ph.lastSuccess
			st.LastSuccess = &t
			st.LiveVerified = true
		}
		if !ph.lastFailure.IsZero() {
			t := ph.lastFailure
			st.LastFailure, st.LastError = &t, ph.lastError
		}
		if now.Before(ph.limitedTill) {
			t := ph.limitedTill
			st.RateLimitedUntil = &t
		}
		st.KaraokeVerified = ph.karaokeSeen
	}
	st.Availability = availabilityOf(st, ph, now)
}

func availabilityOf(st *ProviderStatus, ph *providerHealth, now time.Time) string {
	switch {
	case st.Status == StatusNeedsCredentials:
		return AvailabilityNeedsKey
	case st.Status == StatusUnavailable:
		return AvailabilityNotUsable
	case !st.Enabled:
		return AvailabilityOff
	case ph != nil && now.Before(ph.limitedTill):
		return AvailabilityRateLimited
	case ph != nil && ph.lastFailure.After(ph.lastSuccess):
		return AvailabilityTemporarily
	}
	return AvailabilityAvailable
}
