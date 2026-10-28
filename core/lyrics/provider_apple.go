package lyrics

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/Tian-MC/lyvune/log"
	"github.com/Tian-MC/lyvune/model"
)

const (
	appleID       = "apple"
	appleMaxItems = 3
)

// apple reads Apple Music lyrics from a keyless third-party catalogue (lrc.red,
// formerly lyrics-api.binimum.org). Apple publishes no lyrics API: the catalogue
// is not run by Apple, and it answers with the song's TTML, which carries word
// or syllable timing for most tracks.
//
// The response shape was checked against the live service: GET /api/v1 with
// track, artist, album and duration returns {"results":[{id, isrc, track_name,
// artist_name, album_name, duration, timing_type, lyricsUrl}]}, and lyricsUrl
// is a TTML document.
type apple struct {
	baseURL string
	http    *httpProvider
}

// NewAppleMusic returns the Apple Music provider. baseURL may be empty for the
// public catalogue.
func NewAppleMusic(baseURL string) OnlineProvider {
	if baseURL == "" {
		baseURL = "https://lrc.red/api/v1"
	}
	return &apple{baseURL: strings.TrimRight(baseURL, "/"), http: newHTTPProvider(appleID, 500*time.Millisecond, nil)}
}

func (a *apple) Info() ProviderInfo {
	return ProviderInfo{
		ID: appleID, Name: "Apple Music", Status: StatusReady, Verified: true,
		Plain: true, Synced: true, WordSync: true,
		Implemented: true, Configured: true, Auth: AuthNone, Formats: []string{"ttml"},
		Attribution: "Lyrics from Apple Music, through the lrc.red catalogue",
		Note: "Unofficial: Apple has no public lyrics API, so this reads a third-party catalogue (lrc.red) that serves " +
			"Apple Music lyrics as TTML, with word or syllable timing for most songs. No account or key is needed.",
	}
}

type appleItem struct {
	ID         string  `json:"id"`
	TrackName  string  `json:"track_name"`
	ArtistName string  `json:"artist_name"`
	AlbumName  string  `json:"album_name"`
	Duration   float64 `json:"duration"`
	TimingType string  `json:"timing_type"`
	LyricsURL  string  `json:"lyricsUrl"`
}

func (a *apple) Search(ctx context.Context, rec Recording) ([]Candidate, error) {
	title, _ := splitTitle(rec.Title)
	title = strings.TrimSpace(title)
	artist := primaryArtist(rec.Artist)
	if title == "" || artist == "" {
		return nil, nil
	}
	q := url.Values{"track": {title}, "artist": {artist}}
	if rec.Album != "" {
		q.Set("album", rec.Album)
	}
	if rec.DurationSec > 0 {
		q.Set("duration", strconv.Itoa(int(rec.DurationSec)))
	}
	var res struct {
		Results []appleItem `json:"results"`
	}
	if err := a.http.getJSON(ctx, a.baseURL+"?"+q.Encode(), &res); err != nil {
		if errors.Is(err, errNotFound) {
			return nil, nil
		}
		return nil, err
	}

	// Word and syllable timing first; the sort is stable, so the catalogue's
	// own order decides among equals.
	items := res.Results
	sort.SliceStable(items, func(i, j int) bool { return appleTimed(items[i]) && !appleTimed(items[j]) })

	var out []Candidate
	for _, it := range items {
		if len(out) == appleMaxItems {
			break
		}
		if !strings.HasPrefix(it.LyricsURL, "https://") {
			continue
		}
		ttml, err := a.fetchTTML(ctx, it.LyricsURL)
		if err != nil {
			if len(out) == 0 {
				return nil, err
			}
			log.Debug(ctx, "Apple Music lyrics could not be fetched", "id", it.ID, err)
			continue
		}
		list, err := model.ParseLyrics(ctx, ".ttml", "xxx", ttml)
		if err != nil || len(list) == 0 {
			log.Debug(ctx, "Apple Music lyrics could not be parsed", "id", it.ID, err)
			continue
		}
		c := Candidate{
			ID: appleID + ":" + it.ID, Provider: appleID, Source: SourceRemote,
			Meta:        Meta{Title: it.TrackName, Artist: it.ArtistName, Album: it.AlbumName, DurationSec: it.Duration},
			Attribution: a.Info().Attribution,
			Lyrics:      list, Quality: QualityOf(list),
		}
		if list[0].Lang != "" && list[0].Lang != "xxx" {
			c.Meta.Lang = list[0].Lang
		}
		c.Match = ScoreMatch(rec, c.Meta)
		out = append(out, c)
	}
	return out, nil
}

func appleTimed(it appleItem) bool {
	return it.TimingType == "word" || it.TimingType == "syllable"
}

// fetchTTML downloads one lyrics document, with the same pacing and limits as
// the search.
func (a *apple) fetchTTML(ctx context.Context, endpoint string) ([]byte, error) {
	h := a.http
	if err := h.pacer.wait(ctx); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, h.timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent())
	resp, err := h.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrProviderUnavailable, err)
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusTooManyRequests:
		d := parseRetryAfter(resp.Header.Get("Retry-After"), time.Minute)
		h.pacer.coolDown(d)
		return nil, &RateLimitedError{Provider: appleID, RetryAfter: d}
	case resp.StatusCode != http.StatusOK:
		return nil, fmt.Errorf("%w: %s answered %d", ErrProviderUnavailable, appleID, resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
}
