package lyrics

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/Tian-MC/lyvune/log"
	"github.com/Tian-MC/lyvune/model"
)

const musixmatchID = "musixmatch"

// musixmatch uses the official Musixmatch API with the user's own API key
// (Lyrics.Musixmatch.ApiKey in the configuration). It never uses the private
// tokens of Musixmatch's apps.
//
// Flow, all documented methods:
//
//	matcher.track.get      the track Musixmatch thinks this is, with its real
//	                       title, artist, album, length and what it has
//	track.richsync.get     word-timed lyrics (parsed by ParseRichSync)
//	track.subtitle.get     line-timed lyrics
//	track.lyrics.get       plain lyrics
//
// The match is scored on the metadata Musixmatch returns, like every other
// provider. Which of the calls an API key may use depends on its plan; a call
// the plan refuses is skipped, not treated as a broken key.
//
// This adapter has NOT been verified against the live service: no API key was
// available. Its parsing is covered by tests built from the documented
// response shapes only.
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
	note := "Official API with your own key. Not verified against the live service. " +
		"Word timing (RichSync) is read when your plan returns it, but is not advertised until it has been seen working. " +
		"Free keys return partial lyrics, which are discarded."
	info := ProviderInfo{
		ID: musixmatchID, Name: "Musixmatch", Status: StatusReady, Verified: false,
		Plain: true, Synced: true, Note: note,
		Implemented: true, Configured: m.apiKey != "", Auth: AuthAPIKey,
		Formats: []string{"richsync", "lrc", "txt"},
		Modes: []ProviderMode{
			{ID: "official", Name: "Official API (your own key)", Auth: AuthAPIKey, Active: m.apiKey != ""},
			{ID: "keyless", Name: "Without a key", Auth: AuthNone, Active: false,
				Note: "No authorized keyless route exists: the known ones use the anonymous token of Musixmatch's desktop app, which is not used."},
		},
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

// errPlanDenied means the key is valid but its plan does not include the call.
var errPlanDenied = errors.New("not included in the plan")

type musixmatchTrack struct {
	TrackID      int64   `json:"track_id"`
	Name         string  `json:"track_name"`
	Artist       string  `json:"artist_name"`
	Album        string  `json:"album_name"`
	Length       float64 `json:"track_length"`
	Instrumental int     `json:"instrumental"`
	HasLyrics    int     `json:"has_lyrics"`
	HasSubtitles int     `json:"has_subtitles"`
	HasRichsync  int     `json:"has_richsync"`
}

// musixmatchFreeMarker is appended to the truncated lyrics of free keys.
const musixmatchFreeMarker = "NOT for Commercial use"

//nolint:gocyclo // Musixmatch answers in many shapes, and each branch handles one of them
func (m *musixmatch) Search(ctx context.Context, rec Recording) ([]Candidate, error) {
	if m.apiKey == "" {
		return nil, ErrProviderDisabled
	}
	title, _ := splitTitle(rec.Title)
	title, artist := strings.TrimSpace(title), primaryArtist(rec.Artist)
	if title == "" || artist == "" {
		return nil, nil
	}

	var found struct {
		Track musixmatchTrack `json:"track"`
	}
	q := url.Values{"q_track": {title}, "q_artist": {artist}}
	if rec.Album != "" {
		q.Set("q_album", rec.Album)
	}
	if err := m.call(ctx, "matcher.track.get", q, &found); err != nil {
		if errors.Is(err, errNotFound) || errors.Is(err, errPlanDenied) {
			return nil, nil
		}
		return nil, err
	}
	t := found.Track
	if t.TrackID == 0 {
		return nil, nil
	}
	c := Candidate{
		ID: fmt.Sprintf("%s:%d", musixmatchID, t.TrackID), Provider: musixmatchID, Source: SourceRemote,
		Meta: Meta{Title: t.Name, Artist: t.Artist, Album: t.Album, DurationSec: t.Length, Instrumental: t.Instrumental == 1},
	}
	c.Match = ScoreMatch(rec, c.Meta)
	if !c.Match.Listed() {
		return nil, nil
	}
	if c.Meta.Instrumental {
		return []Candidate{c}, nil
	}
	id := url.Values{"track_id": {strconv.FormatInt(t.TrackID, 10)}}

	best := func(list model.LyricList) {
		if len(list) == 0 {
			return
		}
		for i := range list {
			if list[i].Kind == "" {
				list[i].Kind = model.LyricKindMain
			}
		}
		if q := QualityOf(list); q > c.Quality {
			c.Lyrics, c.Quality = list, q
		}
	}
	soft := func(what string, err error) error {
		if err == nil || errors.Is(err, errNotFound) || errors.Is(err, errPlanDenied) {
			return nil
		}
		var rl *RateLimitedError
		if errors.As(err, &rl) || ctx.Err() != nil {
			return err
		}
		log.Debug(ctx, "Musixmatch call failed", "what", what, err)
		return nil
	}

	if t.HasRichsync == 1 {
		var rs struct {
			Richsync struct {
				Body string `json:"richsync_body"`
			} `json:"richsync"`
		}
		if err := soft("richsync", m.call(ctx, "track.richsync.get", cloneValues(id), &rs)); err != nil {
			return nil, err
		}
		if list, err := ParseRichSync(rs.Richsync.Body); err == nil {
			list, _ = rejectSyntheticWordTiming(list)
			best(list)
		}
	}
	if c.Quality < QualityKaraoke && t.HasSubtitles == 1 {
		var sub struct {
			Subtitle struct {
				Body string `json:"subtitle_body"`
			} `json:"subtitle"`
		}
		sq := cloneValues(id)
		sq.Set("subtitle_format", "lrc")
		if err := soft("subtitle", m.call(ctx, "track.subtitle.get", sq, &sub)); err != nil {
			return nil, err
		}
		if list, err := model.ParseLyrics(ctx, ".lrc", "xxx", []byte(sub.Subtitle.Body)); err == nil {
			best(list)
		}
	}
	if c.Quality == QualityNone && t.HasLyrics == 1 {
		var plain struct {
			Lyrics struct {
				Body      string `json:"lyrics_body"`
				Language  string `json:"lyrics_language"`
				Copyright string `json:"lyrics_copyright"`
			} `json:"lyrics"`
		}
		if err := soft("lyrics", m.call(ctx, "track.lyrics.get", cloneValues(id), &plain)); err != nil {
			return nil, err
		}
		// Free keys get a cut-down text ending in a notice. Showing part of a song as
		// if it were the song would be wrong, so it is dropped.
		if body := plain.Lyrics.Body; body != "" && !strings.Contains(body, musixmatchFreeMarker) {
			c.Attribution = strings.TrimSpace(plain.Lyrics.Copyright)
			c.Meta.Lang = plain.Lyrics.Language
			if list, err := model.ParseLyrics(ctx, ".txt", "xxx", []byte(body)); err == nil {
				best(list)
			}
		}
	}
	if c.Quality == QualityNone {
		return nil, nil
	}
	return []Candidate{c}, nil
}

func cloneValues(v url.Values) url.Values {
	out := make(url.Values, len(v))
	for k, vals := range v {
		out[k] = append([]string(nil), vals...)
	}
	return out
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
	case code == http.StatusForbidden:
		return fmt.Errorf("%w: %s", errPlanDenied, method)
	case code == http.StatusUnauthorized || code == http.StatusPaymentRequired:
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
