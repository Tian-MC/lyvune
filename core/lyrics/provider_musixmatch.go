package lyrics

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/navidrome/navidrome/log"
	"github.com/navidrome/navidrome/model"
)

const musixmatchID = "musixmatch"

// musixmatchMatchConfidence is the confidence given to a matcher result. The
// matcher is fuzzy on Musixmatch's side and returns no track metadata we could
// compare, so a result is never trusted enough to be stored automatically.
const musixmatchMatchConfidence = 0.7

// musixmatch uses the official Musixmatch API with the user's own API key
// (Lyrics.Musixmatch.ApiKey in the configuration).
//
// It has NOT been verified against the live service: the developer terms could
// not be read and no key was available. The implementation therefore does the
// least that is safe:
//   - lyrics are shown for manual selection only, never stored in sidecars,
//   - the match is never reported as verified,
//   - word-level (richsync) lyrics are not requested.
type musixmatch struct {
	baseURL string
	apiKey  string
	client  *http.Client
	pacer   *pacer
	timeout time.Duration
}

// NewMusixmatch returns the Musixmatch provider. Without an API key it reports
// that credentials are needed and makes no request.
func NewMusixmatch(baseURL, apiKey string) OnlineProvider {
	if baseURL == "" {
		baseURL = "https://api.musixmatch.com/ws/1.1"
	}
	return &musixmatch{
		baseURL: strings.TrimRight(baseURL, "/"),
		apiKey:  strings.TrimSpace(apiKey),
		client:  &http.Client{},
		pacer:   newPacer(musixmatchID, time.Second),
		timeout: 8 * time.Second,
	}
}

func (m *musixmatch) Info() ProviderInfo {
	info := ProviderInfo{
		ID: musixmatchID, Name: "Musixmatch", Status: StatusReady, Verified: false,
		Plain: true, Synced: true, Storable: false,
		Note: "Needs your own Musixmatch API key. Results can be previewed but are not saved: " +
			"the service terms could not be verified, and full or synced lyrics depend on your plan. Word-level lyrics are not supported.",
	}
	if m.apiKey == "" {
		info.Status = StatusNeedsCredentials
		info.Reason = "Set Lyrics.Musixmatch.ApiKey in the configuration"
	}
	return info
}

type musixmatchEnvelope struct {
	Message struct {
		Header struct {
			StatusCode int `json:"status_code"`
		} `json:"header"`
		Body json.RawMessage `json:"body"`
	} `json:"message"`
}

func (m *musixmatch) Search(ctx context.Context, rec Recording) ([]Candidate, error) {
	if m.apiKey == "" {
		return nil, ErrProviderDisabled
	}
	title, _ := splitTitle(rec.Title)
	title, artist := strings.TrimSpace(title), primaryArtist(rec.Artist)
	if title == "" || artist == "" {
		return nil, nil
	}

	c := Candidate{
		ID: musixmatchID + ":" + title + "|" + artist, Provider: musixmatchID, Source: SourceRemote,
		Meta:     Meta{Title: rec.Title, Artist: rec.Artist, Album: rec.Album, DurationSec: rec.DurationSec},
		Storable: false,
		Match:    Match{Confidence: musixmatchMatchConfidence, Mismatch: []string{"unverified-match"}},
	}

	var plain struct {
		Lyrics struct {
			Body      string `json:"lyrics_body"`
			Language  string `json:"lyrics_language"`
			Copyright string `json:"lyrics_copyright"`
		} `json:"lyrics"`
	}
	if err := m.call(ctx, "matcher.lyrics.get", url.Values{"q_track": {title}, "q_artist": {artist}}, &plain); err != nil && err != errNotFound {
		return nil, err
	}
	c.Attribution = strings.TrimSpace(plain.Lyrics.Copyright)
	c.Meta.Lang = plain.Lyrics.Language
	if list, err := model.ParseLyrics(ctx, ".txt", "xxx", []byte(plain.Lyrics.Body)); err == nil && len(list) > 0 {
		c.Lyrics, c.Quality = list, QualityOf(list)
	}

	var sub struct {
		Subtitle struct {
			Body string `json:"subtitle_body"`
		} `json:"subtitle"`
	}
	q := url.Values{"q_track": {title}, "q_artist": {artist}, "subtitle_format": {"lrc"}}
	if rec.DurationSec > 0 {
		q.Set("f_subtitle_length", strconv.Itoa(int(math.Round(rec.DurationSec))))
		q.Set("f_subtitle_length_max_deviation", "3")
	}
	switch err := m.call(ctx, "matcher.subtitle.get", q, &sub); err {
	case nil:
		if list, perr := model.ParseLyrics(ctx, ".lrc", "xxx", []byte(sub.Subtitle.Body)); perr == nil {
			if sq := QualityOf(list); sq > c.Quality {
				c.Lyrics, c.Quality = list, sq
			}
		}
	case errNotFound:
	default:
		// The plain lyrics are still worth offering when synced lyrics are not in the plan.
		log.Debug(ctx, "Musixmatch synced lyrics unavailable", err)
	}
	if c.Quality == QualityNone {
		return nil, nil
	}
	return []Candidate{c}, nil
}

func (m *musixmatch) call(ctx context.Context, method string, q url.Values, out any) error {
	if err := m.pacer.wait(ctx); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, m.timeout)
	defer cancel()
	q.Set("apikey", m.apiKey)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, m.baseURL+"/"+method+"?"+q.Encode(), nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", userAgent())
	resp, err := m.client.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %s", ErrProviderUnavailable, redactKey(err.Error(), m.apiKey))
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusTooManyRequests {
		d := parseRetryAfter(resp.Header.Get("Retry-After"), time.Minute)
		m.pacer.coolDown(d)
		return &RateLimitedError{Provider: musixmatchID, RetryAfter: d}
	}
	var env musixmatchEnvelope
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxResponseBytes)).Decode(&env); err != nil {
		return fmt.Errorf("%w: unreadable response", ErrProviderUnavailable)
	}
	switch code := env.Message.Header.StatusCode; {
	case code == http.StatusOK:
		return json.Unmarshal(env.Message.Body, out)
	case code == http.StatusNotFound:
		return errNotFound
	case code == http.StatusTooManyRequests:
		m.pacer.coolDown(time.Minute)
		return &RateLimitedError{Provider: musixmatchID, RetryAfter: time.Minute}
	case code == http.StatusUnauthorized || code == http.StatusPaymentRequired || code == http.StatusForbidden:
		return fmt.Errorf("%w: the API key was refused (status %d)", ErrProviderDisabled, code)
	default:
		return fmt.Errorf("%w: status %d", ErrProviderUnavailable, code)
	}
}

// redactKey keeps the API key out of errors and logs.
func redactKey(s, key string) string {
	if key == "" {
		return s
	}
	return strings.ReplaceAll(s, key, "***")
}
