package lyrics

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/Tian-MC/lyvune/consts"
	"github.com/Tian-MC/lyvune/log"
	"github.com/Tian-MC/lyvune/model"
)

const (
	lrclibID       = "lrclib"
	lrclibMaxItems = 20
	// lrclibAttempts bounds retries on network errors and 5xx answers.
	lrclibAttempts = 3
)

var errNotFound = errors.New("not found")

// lrclib talks to the public LRCLIB API (https://lrclib.net).
//
// The response shape was checked against the live service: each result has
// id, name, trackName, artistName, albumName, duration, instrumental,
// hasWordSync, plainLyrics, syncedLyrics and lyricsfile (a Lyricsfile YAML
// document, which carries word timing when hasWordSync is true).
type lrclib struct {
	baseURL string
	client  *http.Client
	pacer   *pacer
	timeout time.Duration
	backoff time.Duration
	enabled bool
}

// NewLRCLIB returns the LRCLIB provider. baseURL may be empty for the public
// service. LRCLIB asks clients to identify themselves, so a descriptive
// User-Agent is always sent.
func NewLRCLIB(baseURL string, enabled bool) OnlineProvider {
	if baseURL == "" {
		baseURL = "https://lrclib.net"
	}
	return &lrclib{
		baseURL: strings.TrimRight(baseURL, "/"),
		client:  &http.Client{},
		pacer:   newPacer(lrclibID, 300*time.Millisecond),
		timeout: 8 * time.Second,
		backoff: 400 * time.Millisecond,
		enabled: enabled,
	}
}

func (l *lrclib) Info() ProviderInfo {
	info := ProviderInfo{
		ID: lrclibID, Name: "LRCLIB", Status: StatusReady, Verified: true,
		Plain: true, Synced: true, WordSync: true,
		Implemented: true, Configured: true, Auth: AuthNone, Formats: []string{"lyricsfile", "lrc", "txt"},
		Attribution: "Lyrics from LRCLIB (lrclib.net)",
		Note:        "Free community service. Word timing is offered only for tracks where hasWordSync is set.",
	}
	if !l.enabled {
		info.Status, info.Reason = StatusDisabled, "Turned off in the lyrics settings"
	}
	return info
}

type lrclibItem struct {
	ID           int64   `json:"id"`
	TrackName    string  `json:"trackName"`
	ArtistName   string  `json:"artistName"`
	AlbumName    string  `json:"albumName"`
	Duration     float64 `json:"duration"`
	Instrumental bool    `json:"instrumental"`
	HasWordSync  bool    `json:"hasWordSync"`
	PlainLyrics  string  `json:"plainLyrics"`
	SyncedLyrics string  `json:"syncedLyrics"`
	Lyricsfile   string  `json:"lyricsfile"`
}

func (l *lrclib) Search(ctx context.Context, rec Recording) ([]Candidate, error) {
	if !l.enabled {
		return nil, ErrProviderDisabled
	}
	title, _ := splitTitle(rec.Title)
	title = strings.TrimSpace(title)
	artist := primaryArtist(rec.Artist)
	if title == "" || artist == "" {
		return nil, nil
	}

	var items []lrclibItem
	var exactErr error
	seen := map[int64]bool{}
	add := func(it lrclibItem) {
		if it.ID != 0 && !seen[it.ID] && len(items) < lrclibMaxItems {
			seen[it.ID] = true
			items = append(items, it)
		}
	}

	// The exact lookup is the most precise: LRCLIB matches the duration to
	// within a couple of seconds.
	if rec.Album != "" && rec.DurationSec > 0 {
		var it lrclibItem
		err := l.getJSON(ctx, "/api/get", url.Values{
			"track_name":  {title},
			"artist_name": {artist},
			"album_name":  {rec.Album},
			"duration":    {strconv.Itoa(int(math.Round(rec.DurationSec)))},
		}, &it)
		var rl *RateLimitedError
		switch {
		case err == nil:
			add(it)
		case errors.Is(err, errNotFound):
		case errors.As(err, &rl):
			return nil, err
		default:
			// A bad answer to the exact lookup must not stop the general search
			exactErr = err
		}
	}

	var results []lrclibItem
	err := l.getJSON(ctx, "/api/search", url.Values{"track_name": {title}, "artist_name": {artist}}, &results)
	if err != nil && !errors.Is(err, errNotFound) {
		if len(items) == 0 {
			if exactErr != nil && errors.Is(err, ErrProviderUnavailable) {
				return nil, exactErr
			}
			return nil, err
		}
		log.Debug(ctx, "LRCLIB search failed after an exact match", err)
	}
	for _, it := range results {
		add(it)
	}

	out := make([]Candidate, 0, len(items))
	for _, it := range items {
		out = append(out, lrclibCandidate(ctx, rec, it))
	}
	return out, nil
}

func primaryArtist(artist string) string {
	parts := artistSplit.Split(artist, 2)
	return strings.TrimSpace(parts[0])
}

// lrclibCandidate converts one result. It keeps the best lyrics the result
// really has: word timing from the Lyricsfile, else line timing from the LRC,
// else plain text. Nothing is ever inferred.
func lrclibCandidate(ctx context.Context, rec Recording, it lrclibItem) Candidate {
	c := Candidate{
		ID:       fmt.Sprintf("%s:%d", lrclibID, it.ID),
		Provider: lrclibID,
		Source:   SourceRemote,
		Meta: Meta{
			Title: it.TrackName, Artist: it.ArtistName, Album: it.AlbumName,
			DurationSec: it.Duration, Instrumental: it.Instrumental,
		},
		Attribution: "Lyrics from LRCLIB (lrclib.net)",
	}
	c.Match = ScoreMatch(rec, c.Meta)
	if it.Instrumental {
		return c
	}

	best := func(list model.LyricList) {
		if q := QualityOf(list); q > c.Quality {
			c.Lyrics, c.Quality = list, q
		}
	}
	parse := func(suffix, text string) model.LyricList {
		if strings.TrimSpace(text) == "" {
			return nil
		}
		list, err := model.ParseLyrics(ctx, suffix, "xxx", []byte(text))
		if err != nil {
			log.Debug(ctx, "LRCLIB lyrics could not be parsed", "id", it.ID, "format", suffix, err)
			return nil
		}
		return list
	}
	best(parse(".yaml", it.Lyricsfile))
	best(parse(".lrc", it.SyncedLyrics))
	best(parse(".txt", it.PlainLyrics))
	if len(c.Lyrics) > 0 && c.Lyrics[0].Lang != "" && c.Lyrics[0].Lang != "xxx" {
		c.Meta.Lang = c.Lyrics[0].Lang
	}
	return c
}

// getJSON performs a GET with pacing, bounded retries and Retry-After handling.
func (l *lrclib) getJSON(ctx context.Context, path string, q url.Values, out any) error {
	endpoint := l.baseURL + path + "?" + q.Encode()
	var lastErr error
	for attempt := 1; attempt <= lrclibAttempts; attempt++ {
		if err := l.pacer.wait(ctx); err != nil {
			return err
		}
		status, retryAfter, err := l.do(ctx, endpoint, out)
		switch {
		case err == nil && status == http.StatusOK:
			return nil
		case err == nil && status == http.StatusNotFound:
			return errNotFound
		case err == nil && status == http.StatusTooManyRequests:
			d := parseRetryAfter(retryAfter, 30*time.Second)
			l.pacer.coolDown(d)
			return &RateLimitedError{Provider: lrclibID, RetryAfter: d}
		case err == nil && status >= 400 && status < 500:
			return fmt.Errorf("%w: LRCLIB answered %d", ErrProviderUnavailable, status)
		case ctx.Err() != nil:
			return ctx.Err()
		}
		if err != nil {
			lastErr = err
		} else {
			lastErr = fmt.Errorf("LRCLIB answered %d", status)
		}
		if attempt < lrclibAttempts {
			if serr := sleep(ctx, l.backoff*time.Duration(attempt)); serr != nil {
				return serr
			}
		}
	}
	return fmt.Errorf("%w: %w", ErrProviderUnavailable, lastErr)
}

func (l *lrclib) do(ctx context.Context, endpoint string, out any) (status int, retryAfter string, err error) {
	ctx, cancel := context.WithTimeout(ctx, l.timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return 0, "", err
	}
	req.Header.Set("User-Agent", userAgent())
	req.Header.Set("Accept", "application/json")
	resp, err := l.client.Do(req)
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

func userAgent() string {
	return "Lyvune/" + consts.Version + " (https://github.com/Tian-MC/lyvune)"
}
