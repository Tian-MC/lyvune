package lyrics

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// httpProvider is the request plumbing shared by the providers that talk to a
// plain JSON service: pacing, a timeout per request, Retry-After handling and
// a bounded retry on server errors. A failure never leaves the provider; the
// caller decides what it means for the others.
type httpProvider struct {
	id       string
	client   *http.Client
	pacer    *pacer
	timeout  time.Duration
	backoff  time.Duration
	attempts int
	headers  map[string]string
}

func newHTTPProvider(id string, interval time.Duration, headers map[string]string) *httpProvider {
	return &httpProvider{
		id: id, client: &http.Client{}, pacer: newPacer(id, interval),
		timeout: 8 * time.Second, backoff: 400 * time.Millisecond, attempts: 2, headers: headers,
	}
}

// getJSON GETs endpoint and decodes the JSON body into out. It returns
// errNotFound for 404, a RateLimitedError for 429, and an error wrapping
// ErrProviderUnavailable for anything else that is not a usable answer.
func (h *httpProvider) getJSON(ctx context.Context, endpoint string, out any) error {
	var lastErr error
	for attempt := 1; attempt <= h.attempts; attempt++ {
		if err := h.pacer.wait(ctx); err != nil {
			return err
		}
		status, retryAfter, err := h.do(ctx, endpoint, out)
		switch {
		case err == nil && status == http.StatusOK:
			return nil
		case err == nil && status == http.StatusNotFound:
			return errNotFound
		case err == nil && status == http.StatusTooManyRequests:
			d := parseRetryAfter(retryAfter, time.Minute)
			h.pacer.coolDown(d)
			return &RateLimitedError{Provider: h.id, RetryAfter: d}
		case err == nil && status >= 400 && status < 500:
			// Refused (blocked region, changed service): retrying cannot help
			return fmt.Errorf("%w: %s answered %d", ErrProviderUnavailable, h.id, status)
		case ctx.Err() != nil:
			return ctx.Err()
		}
		if err != nil {
			lastErr = err
		} else {
			lastErr = fmt.Errorf("%s answered %d", h.id, status)
		}
		if attempt < h.attempts {
			if serr := sleep(ctx, h.backoff*time.Duration(attempt)); serr != nil {
				return serr
			}
		}
	}
	return fmt.Errorf("%w: %v", ErrProviderUnavailable, lastErr)
}

func (h *httpProvider) do(ctx context.Context, endpoint string, out any) (int, string, error) {
	ctx, cancel := context.WithTimeout(ctx, h.timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return 0, "", err
	}
	req.Header.Set("User-Agent", userAgent())
	req.Header.Set("Accept", "application/json")
	for k, v := range h.headers {
		req.Header.Set(k, v)
	}
	resp, err := h.client.Do(req)
	if err != nil {
		return 0, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16))
		return resp.StatusCode, resp.Header.Get("Retry-After"), nil
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxResponseBytes)).Decode(out); err != nil {
		return resp.StatusCode, "", fmt.Errorf("unreadable response: %w", err)
	}
	return resp.StatusCode, "", nil
}
