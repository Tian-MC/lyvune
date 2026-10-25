package lyrics

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"math"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/navidrome/navidrome/log"
	"github.com/navidrome/navidrome/model"
)

const (
	kugouID = "kugou"
	// kugouSongs bounds how many matched songs get their lyrics looked up, and
	// kugouLyricTries how many lyric entries of one song are downloaded.
	kugouSongs      = 2
	kugouLyricTries = 2
	// kugouMaxDriftMs is how far a lyric entry's length may be from the song's.
	kugouMaxDriftMs = 5000
)

// kugou talks to KuGou's open web endpoints, found by inspecting the web
// client and cross-checked against a live account-less session:
//
//	GET songsearch.kugou.com/song_search_v2?keyword=...      song list with file hashes
//	GET lyrics.kugou.com/search?hash=...&duration=<ms>        lyric entries (id, accesskey)
//	GET lyrics.kugou.com/download?id=..&accesskey=..&fmt=krc  base64 KRC (see krc.go)
//
// No account, cookie or request signing is involved. They are undocumented, so
// the provider is reported as unofficial and, unless the administrator opts in,
// its lyrics are not saved.
type kugou struct {
	searchURL string
	lyricsURL string
	http      *httpProvider
	// emptyRetry is the pause before asking again after an empty song search.
	// KuGou answers "0 results" without any error when requests come close
	// together, so an empty list is asked once more before it is believed.
	emptyRetry time.Duration
}

// NewKuGou returns the KuGou provider. Empty URLs select the public services.
func NewKuGou(searchURL, lyricsURL string) OnlineProvider {
	if searchURL == "" {
		searchURL = "https://songsearch.kugou.com"
	}
	if lyricsURL == "" {
		lyricsURL = "https://lyrics.kugou.com"
	}
	return &kugou{
		searchURL: strings.TrimRight(searchURL, "/"), lyricsURL: strings.TrimRight(lyricsURL, "/"),
		http:       newHTTPProvider(kugouID, time.Second, nil),
		emptyRetry: 2 * time.Second,
	}
}

func (k *kugou) Info() ProviderInfo {
	note := "Unofficial: KuGou has no public lyrics API, so this uses its open web endpoints without any account. " +
		"Offers word-timed KRC lyrics when KuGou has them, plus translations and romanization."
	return ProviderInfo{
		ID: kugouID, Name: "KuGou Music", Status: StatusReady, Verified: true,
		Plain: true, Synced: true, WordSync: true, Translation: true, Romanization: true,
		Implemented: true, Configured: true, Auth: AuthNone,
		Formats: []string{"krc", "lrc", "translation", "romanization"}, Attribution: "Lyrics from KuGou Music", Note: note,
	}
}

type kugouSong struct {
	Name     string `json:"SongName"`
	Singer   string `json:"SingerName"`
	Album    string `json:"AlbumName"`
	Duration int64  `json:"Duration"`
	Hash     string `json:"FileHash"`
}

type kugouLyricEntry struct {
	ID        string `json:"id"`
	AccessKey string `json:"accesskey"`
	Duration  int64  `json:"duration"`
	Score     int    `json:"score"`
}

func (k *kugou) Search(ctx context.Context, rec Recording) ([]Candidate, error) {
	title, _ := splitTitle(rec.Title)
	title, artist := strings.TrimSpace(title), primaryArtist(rec.Artist)
	if title == "" {
		return nil, nil
	}
	var res struct {
		Status int `json:"status"`
		Data   struct {
			Lists []kugouSong `json:"lists"`
		} `json:"data"`
	}
	q := url.Values{
		"keyword": {strings.TrimSpace(title + " " + artist)}, "page": {"1"}, "pagesize": {"10"},
		"filter": {"0"}, "platform": {"WebFilter"},
	}
	endpoint := k.searchURL + "/song_search_v2?" + q.Encode()
	for attempt := 0; attempt < 2; attempt++ {
		res.Data.Lists = nil
		if err := k.http.getJSON(ctx, endpoint, &res); err != nil {
			if errors.Is(err, errNotFound) {
				return nil, nil
			}
			return nil, err
		}
		if res.Status != 1 {
			return nil, fmt.Errorf("%w: KuGou search answered status %d", ErrProviderUnavailable, res.Status)
		}
		if len(res.Data.Lists) > 0 || attempt == 1 {
			break
		}
		if err := sleep(ctx, k.emptyRetry); err != nil {
			return nil, err
		}
	}

	type scored struct {
		song  kugouSong
		meta  Meta
		match Match
	}
	var found []scored
	seen := map[string]bool{}
	for _, s := range res.Data.Lists {
		if s.Hash == "" || s.Name == "" || seen[strings.ToLower(s.Hash)] {
			continue
		}
		seen[strings.ToLower(s.Hash)] = true
		meta := Meta{Title: s.Name, Artist: s.Singer, Album: s.Album, DurationSec: float64(s.Duration)}
		found = append(found, scored{s, meta, ScoreMatch(rec, meta)})
	}
	sort.SliceStable(found, func(i, j int) bool { return found[i].match.Confidence > found[j].match.Confidence })

	if len(found) > 0 {
		log.Debug(ctx, "KuGou songs", "found", len(found), "bestConfidence", found[0].match.Confidence, "best", found[0].meta.Title)
	}
	var out []Candidate
	for _, f := range found {
		if len(out) >= kugouSongs || !f.match.Listed() {
			break
		}
		c, err := k.candidate(ctx, f.song, f.meta, f.match)
		if err != nil {
			var rl *RateLimitedError
			if errors.As(err, &rl) || ctx.Err() != nil || len(out) == 0 && errors.Is(err, ErrProviderUnavailable) {
				return out, err
			}
			log.Debug(ctx, "KuGou lyrics lookup failed", "hash", f.song.Hash, err)
			continue
		}
		if c != nil {
			out = append(out, *c)
		}
	}
	return out, nil
}

// candidate finds the best lyrics of one song. It stops at the first entry
// that has word timing.
func (k *kugou) candidate(ctx context.Context, s kugouSong, meta Meta, match Match) (*Candidate, error) {
	var res struct {
		Status     int               `json:"status"`
		Candidates []kugouLyricEntry `json:"candidates"`
	}
	q := url.Values{
		"ver": {"1"}, "man": {"yes"}, "client": {"pc"}, "keyword": {""},
		"duration": {strconv.FormatInt(s.Duration*1000, 10)}, "hash": {s.Hash},
	}
	if err := k.http.getJSON(ctx, k.lyricsURL+"/search?"+q.Encode(), &res); err != nil {
		if errors.Is(err, errNotFound) {
			return nil, nil
		}
		return nil, err
	}
	var entries []kugouLyricEntry
	for _, e := range res.Candidates {
		// An entry of a very different length belongs to another version
		if e.ID != "" && e.AccessKey != "" &&
			(e.Duration == 0 || math.Abs(float64(e.Duration-s.Duration*1000)) <= kugouMaxDriftMs) {
			entries = append(entries, e)
		}
	}
	log.Debug(ctx, "KuGou lyric entries", "hash", s.Hash, "all", len(res.Candidates), "usable", len(entries))
	sort.SliceStable(entries, func(i, j int) bool { return entries[i].Score > entries[j].Score })
	if len(entries) > kugouLyricTries {
		entries = entries[:kugouLyricTries]
	}

	c := &Candidate{
		ID: kugouID + ":" + s.Hash, Provider: kugouID, Source: SourceRemote, Meta: meta, Match: match,
		Attribution: "Lyrics from KuGou Music",
	}
	var lastErr error
	for _, e := range entries {
		list, err := k.download(ctx, e)
		if err != nil {
			var rl *RateLimitedError
			if errors.As(err, &rl) || ctx.Err() != nil {
				return nil, err
			}
			lastErr = err
			continue
		}
		if q := QualityOf(list); q > c.Quality {
			c.Lyrics, c.Quality, c.ID = list, q, kugouID+":"+e.ID
		}
		if c.Quality == QualityKaraoke {
			break
		}
	}
	if c.Quality == QualityNone {
		if lastErr != nil && len(entries) > 0 {
			return nil, lastErr
		}
		return nil, nil
	}
	return c, nil
}

// download fetches one entry as KRC and falls back to its plain LRC when the
// KRC cannot be read. The format actually received decides the quality.
func (k *kugou) download(ctx context.Context, e kugouLyricEntry) (model.LyricList, error) {
	get := func(format string) (string, error) {
		var res struct {
			Status  int    `json:"status"`
			Content string `json:"content"`
		}
		q := url.Values{"ver": {"1"}, "client": {"pc"}, "id": {e.ID}, "accesskey": {e.AccessKey}, "fmt": {format}, "charset": {"utf8"}}
		if err := k.http.getJSON(ctx, k.lyricsURL+"/download?"+q.Encode(), &res); err != nil {
			return "", err
		}
		if res.Status != 200 || res.Content == "" {
			return "", errNotFound
		}
		return res.Content, nil
	}

	var krcErr error
	if content, err := get("krc"); err == nil {
		raw, derr := base64.StdEncoding.DecodeString(content)
		if derr == nil {
			var text string
			if text, derr = DecodeKRC(raw); derr == nil {
				list, perr := ParseKRC(text)
				if perr == nil {
					if checked, synthetic := rejectSyntheticWordTiming(list); synthetic {
						log.Debug(ctx, "KuGou word timing looks evenly split, using line timing only", "id", e.ID)
						list = checked
					}
					return list, nil
				}
				derr = perr
			}
		}
		krcErr = derr
	} else {
		var rl *RateLimitedError
		if errors.As(err, &rl) || ctx.Err() != nil {
			return nil, err
		}
		krcErr = err
	}
	log.Debug(ctx, "KuGou KRC unavailable, trying LRC", "id", e.ID, krcErr)

	content, err := get("lrc")
	if err != nil {
		return nil, err
	}
	raw, err := base64.StdEncoding.DecodeString(content)
	if err != nil {
		return nil, fmt.Errorf("%w: unreadable lyrics", ErrProviderUnavailable)
	}
	list, err := model.ParseLyrics(ctx, ".lrc", "xxx", raw)
	if err != nil || len(list) == 0 {
		return nil, errNotFound
	}
	for i := range list {
		if list[i].Kind == "" {
			list[i].Kind = model.LyricKindMain
		}
	}
	return list, nil
}
