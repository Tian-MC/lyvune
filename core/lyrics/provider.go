package lyrics

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"sync"
	"time"
)

// Provider status values reported to the user.
const (
	// StatusReady means the provider can be searched.
	StatusReady = "ready"
	// StatusNeedsCredentials means it works once an API key is configured.
	StatusNeedsCredentials = "needs-credentials"
	// StatusDisabled means it is turned off in the settings.
	StatusDisabled = "disabled"
	// StatusUnavailable means there is no authorized way to use it.
	StatusUnavailable = "unavailable"
)

// ProviderInfo is what the interface shows about a provider. It never carries
// credentials.
type ProviderInfo struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Status string `json:"status"`
	// Reason explains any status other than ready.
	Reason string `json:"reason,omitempty"`
	// Verified is true only when the adapter was checked against the live service.
	Verified     bool `json:"verified"`
	Plain        bool `json:"plain"`
	Synced       bool `json:"synced"`
	WordSync     bool `json:"wordSync"`
	Translation  bool `json:"translation"`
	Romanization bool `json:"romanization"`
	// Storable is true when the provider's terms allow keeping its lyrics.
	Storable    bool   `json:"storable"`
	Attribution string `json:"attribution,omitempty"`
	Note        string `json:"note,omitempty"`
}

// OnlineProvider searches one online lyrics service.
type OnlineProvider interface {
	Info() ProviderInfo
	// Search returns candidates for the recording. It may return fewer than the
	// service has; matching and ranking happen in the caller.
	Search(ctx context.Context, rec Recording) ([]Candidate, error)
}

// Errors a provider can return. None of them are fatal for the others.
var (
	// ErrProviderUnavailable means the service cannot be used right now.
	ErrProviderUnavailable = errors.New("lyrics provider unavailable")
	// ErrProviderDisabled means the provider is turned off or not configured.
	ErrProviderDisabled = errors.New("lyrics provider disabled")
)

// RateLimitedError means the provider asked us to slow down.
type RateLimitedError struct {
	Provider   string
	RetryAfter time.Duration
}

func (e *RateLimitedError) Error() string {
	return fmt.Sprintf("%s rate limit reached, retry in %s", e.Provider, e.RetryAfter.Round(time.Second))
}

// maxResponseBytes bounds what is read from any provider.
const maxResponseBytes = 4 << 20

// pacer spaces requests to one provider and honours its Retry-After.
type pacer struct {
	mu       sync.Mutex
	interval time.Duration
	next     time.Time
	until    time.Time
	name     string
}

func newPacer(name string, interval time.Duration) *pacer {
	return &pacer{name: name, interval: interval}
}

// wait blocks until a request may be sent. It fails fast during a cool-down
// instead of queueing requests that would only be refused.
func (p *pacer) wait(ctx context.Context) error {
	p.mu.Lock()
	now := time.Now()
	if now.Before(p.until) {
		d := p.until.Sub(now)
		p.mu.Unlock()
		return &RateLimitedError{Provider: p.name, RetryAfter: d}
	}
	at := p.next
	if at.Before(now) {
		at = now
	}
	p.next = at.Add(p.interval)
	p.mu.Unlock()

	if d := at.Sub(now); d > 0 {
		return sleep(ctx, d)
	}
	return ctx.Err()
}

func (p *pacer) coolDown(d time.Duration) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if until := time.Now().Add(d); until.After(p.until) {
		p.until = until
	}
}

func sleep(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// parseRetryAfter reads a Retry-After header in seconds, capped so a hostile
// value cannot park the provider for long.
func parseRetryAfter(v string, fallback time.Duration) time.Duration {
	secs, err := strconv.Atoi(v)
	if err != nil || secs <= 0 {
		return fallback
	}
	d := time.Duration(secs) * time.Second
	if d > 10*time.Minute {
		d = 10 * time.Minute
	}
	return d
}

// Providers is the ordered set of lyrics providers.
type Providers struct {
	list []OnlineProvider
}

// NewProviders wraps providers, keeping their order.
func NewProviders(list ...OnlineProvider) *Providers {
	return &Providers{list: list}
}

// All returns every provider in order.
func (p *Providers) All() []OnlineProvider {
	if p == nil {
		return nil
	}
	return p.list
}

// Get returns a provider by ID.
func (p *Providers) Get(id string) (OnlineProvider, bool) {
	for _, pr := range p.All() {
		if pr.Info().ID == id {
			return pr, true
		}
	}
	return nil, false
}
