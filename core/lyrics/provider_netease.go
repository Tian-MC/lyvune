package lyrics

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/navidrome/navidrome/log"
	"github.com/navidrome/navidrome/model"
)

const (
	neteaseID = "netease"
	// neteaseLookups bounds how many matched songs get their lyrics fetched.
	neteaseLookups = 3
)

// netease talks to NetEase Cloud Music's unauthenticated web endpoints:
//
//	GET /api/search/get?s=<query>&type=1&limit=10
//	GET /api/song/lyric?id=<id>&lv=-1&tv=-1&rv=-1&yv=-1
//
// They need no account or token and no request signing. They are not a
// documented public API (NetEase has none), so the provider is reported as
// unofficial and, unless the administrator opts in, its lyrics are not saved.
//
// Checked against the live service: the lyric call returns lrc (line-timed),
// tlyric (translation), romalrc (romanization) and, for some songs, yrc (word
// timing, parsed by ParseYRC) with ytlrc. Songs without yrc are line-synced and
// are classified as such. The signed weapi/eapi calls are not used.
type netease struct {
	baseURL string
	http    *httpProvider
	store   bool
}

// NewNetEase returns the NetEase Cloud Music provider. store allows its lyrics
// to be saved next to the audio; baseURL may be empty for the public service.
func NewNetEase(baseURL string, store bool) OnlineProvider {
	if baseURL == "" {
		baseURL = "https://music.163.com"
	}
	return &netease{
		baseURL: strings.TrimRight(baseURL, "/"),
		store:   store,
		http: newHTTPProvider(neteaseID, 400*time.Millisecond, map[string]string{
			"Referer":         "https://music.163.com/",
			"Accept-Language": "en,zh;q=0.8,ja;q=0.6",
		}),
	}
}

func (n *netease) Info() ProviderInfo {
	note := "Unofficial: NetEase has no public lyrics API, so this uses its open web endpoints without any account. " +
		"Lines are time-synced, and word timing (YRC) comes with some songs. " +
		"Translations and romanization are included when NetEase has them."
	if !n.store {
		note += " Lyrics can be previewed but are not saved unless Lyrics.NetEase.Store is turned on."
	}
	return ProviderInfo{
		ID: neteaseID, Name: "NetEase Cloud Music", Status: StatusReady, Verified: true,
		Plain: true, Synced: true, WordSync: true, Translation: true, Romanization: true,
		Storable: n.store, Attribution: "Lyrics from NetEase Cloud Music", Note: note,
	}
}

type neteaseSong struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Duration int64  `json:"duration"`
	Artists  []struct {
		Name string `json:"name"`
	} `json:"artists"`
	Album struct {
		Name string `json:"name"`
	} `json:"album"`
}

type neteaseText struct {
	Lyric string `json:"lyric"`
}

type neteaseLyric struct {
	Code       int         `json:"code"`
	PureMusic  bool        `json:"pureMusic"`
	NoLyric    bool        `json:"nolyric"`
	Uncollect  bool        `json:"uncollected"`
	Lrc        neteaseText `json:"lrc"`
	TLyric     neteaseText `json:"tlyric"`
	RomaLrc    neteaseText `json:"romalrc"`
	YRC        neteaseText `json:"yrc"`
	StatusCode int         `json:"-"`
}

func (n *netease) Search(ctx context.Context, rec Recording) ([]Candidate, error) {
	title, _ := splitTitle(rec.Title)
	title, artist := strings.TrimSpace(title), primaryArtist(rec.Artist)
	if title == "" {
		return nil, nil
	}
	var res struct {
		Code   int `json:"code"`
		Result struct {
			Songs []neteaseSong `json:"songs"`
		} `json:"result"`
	}
	q := url.Values{"s": {strings.TrimSpace(title + " " + artist)}, "type": {"1"}, "limit": {"10"}, "offset": {"0"}}
	if err := n.http.getJSON(ctx, n.baseURL+"/api/search/get?"+q.Encode(), &res); err != nil {
		if errors.Is(err, errNotFound) {
			return nil, nil
		}
		return nil, err
	}
	if res.Code != 0 && res.Code != 200 {
		return nil, fmt.Errorf("%w: NetEase search answered code %d", ErrProviderUnavailable, res.Code)
	}

	type scored struct {
		song  neteaseSong
		meta  Meta
		match Match
	}
	var found []scored
	for _, s := range res.Result.Songs {
		if s.ID == 0 || s.Name == "" {
			continue
		}
		names := make([]string, 0, len(s.Artists))
		for _, a := range s.Artists {
			names = append(names, a.Name)
		}
		meta := Meta{Title: s.Name, Artist: strings.Join(names, ", "), Album: s.Album.Name, DurationSec: float64(s.Duration) / 1000}
		found = append(found, scored{s, meta, ScoreMatch(rec, meta)})
	}
	sort.SliceStable(found, func(i, j int) bool { return found[i].match.Confidence > found[j].match.Confidence })

	var out []Candidate
	for _, f := range found {
		if len(out) >= neteaseLookups || !f.match.Listed() {
			break
		}
		c, err := n.candidate(ctx, f.song, f.meta, f.match)
		if err != nil {
			var rl *RateLimitedError
			if errors.As(err, &rl) || ctx.Err() != nil || len(out) == 0 && errors.Is(err, ErrProviderUnavailable) {
				return out, err
			}
			log.Debug(ctx, "NetEase lyrics lookup failed", "id", f.song.ID, err)
			continue
		}
		if c != nil {
			out = append(out, *c)
		}
	}
	return out, nil
}

func (n *netease) candidate(ctx context.Context, s neteaseSong, meta Meta, match Match) (*Candidate, error) {
	var res neteaseLyric
	q := url.Values{"id": {strconv.FormatInt(s.ID, 10)}, "lv": {"-1"}, "tv": {"-1"}, "rv": {"-1"}, "yv": {"-1"}}
	if err := n.http.getJSON(ctx, n.baseURL+"/api/song/lyric?"+q.Encode(), &res); err != nil {
		if errors.Is(err, errNotFound) {
			return nil, nil
		}
		return nil, err
	}
	c := &Candidate{
		ID: neteaseID + ":" + strconv.FormatInt(s.ID, 10), Provider: neteaseID, Source: SourceRemote,
		Meta: meta, Match: match, Storable: n.store, Attribution: "Lyrics from NetEase Cloud Music",
	}
	if res.PureMusic {
		c.Meta.Instrumental = true
		return c, nil
	}
	if res.NoLyric || res.Uncollect {
		return nil, nil
	}
	c.Lyrics, c.Quality = neteaseLyrics(ctx, res)
	if c.Quality == QualityNone {
		return nil, nil
	}
	return c, nil
}

// neteaseLyrics builds the best original lyrics the answer really has (YRC
// word timing, else timed LRC, else text) and attaches the translation and
// romanization as separate tracks.
func neteaseLyrics(ctx context.Context, res neteaseLyric) (model.LyricList, Quality) {
	var main model.LyricList
	var q Quality
	if strings.TrimSpace(res.YRC.Lyric) != "" {
		if list, err := ParseYRC(res.YRC.Lyric); err == nil {
			if checked, synthetic := rejectSyntheticWordTiming(list); synthetic {
				log.Debug(ctx, "NetEase word timing looks evenly split, using line timing only")
				list = checked
			}
			main, q = list, QualityOf(list)
		}
	}
	if text := strings.TrimSpace(res.Lrc.Lyric); text != "" {
		if list, err := model.ParseLyrics(ctx, ".lrc", "xxx", []byte(text)); err == nil && len(list) > 0 {
			if lq := QualityOf(list); lq > q {
				main, q = list, lq
			}
		}
	}
	if q == QualityNone {
		return nil, QualityNone
	}
	for i := range main {
		if main[i].Kind == "" {
			main[i].Kind = model.LyricKindMain
		}
	}
	extra := func(text, kind string) {
		if strings.TrimSpace(text) == "" {
			return
		}
		list, err := model.ParseLyrics(ctx, ".lrc", "xxx", []byte(text))
		if err != nil || len(list) == 0 || !list[0].Synced {
			// Untimed extras cannot be lined up with the original
			return
		}
		l := list[0]
		l.Kind = kind
		if hasText(l) {
			main = append(main, l)
		}
	}
	extra(res.TLyric.Lyric, model.LyricKindTranslation)
	extra(res.RomaLrc.Lyric, model.LyricKindPronunciation)
	return main, q
}
