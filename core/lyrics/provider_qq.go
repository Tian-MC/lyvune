package lyrics

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/navidrome/navidrome/log"
	"github.com/navidrome/navidrome/model"
)

const (
	qqID = "qq"
	// qqLookups bounds how many matched songs get their lyrics fetched.
	qqLookups = 3
	// qqMaxOverrunMs is how far the lyrics may run past the end of the track.
	qqMaxOverrunMs = 5000
)

// qq reads QQ Music through two independent, keyless routes. Each is its own
// mode, and one failing never affects the other.
//
// Direct (the web player's own open endpoints, which need a Referer and no
// account, cookie or signature):
//
//	GET c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg?key=…            search
//	GET c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg?songmid=…       title, artist, album, length
//	GET c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=…    line-timed LRC + translation
//
// Community cache (Better Lyrics, https://docs.betterlyrics.org): QRC with word
// timing, for songs that someone else already fetched. Without an API key it
// answers from its cache only; an uncached song is refused with 401, which is
// treated as "not available", not as an error. An optional Better Lyrics key
// turns that into a live fetch. The endpoint reports no match score, so the
// match is judged from the title, artist and album tags inside the QRC itself.
//
// The QRC that QQ serves to its own apps is encrypted; decoding it is not
// implemented here. That is why word timing needs the community cache.
type qq struct {
	directURL string
	blURL     string
	blKey     string
	direct    *httpProvider
	bl        *httpProvider
}

// NewQQ returns the QQ Music provider. Empty URLs select the public services.
// betterLyricsKey is optional.
func NewQQ(directURL, betterLyricsURL, betterLyricsKey string) OnlineProvider {
	if directURL == "" {
		directURL = "https://c.y.qq.com"
	}
	if betterLyricsURL == "" {
		betterLyricsURL = "https://api.betterlyrics.org"
	}
	q := &qq{
		directURL: strings.TrimRight(directURL, "/"), blURL: strings.TrimRight(betterLyricsURL, "/"),
		blKey:  strings.TrimSpace(betterLyricsKey),
		direct: newHTTPProvider(qqID, 400*time.Millisecond, map[string]string{"Referer": "https://y.qq.com/"}),
	}
	hdr := map[string]string{}
	if q.blKey != "" {
		hdr["X-API-Key"] = q.blKey
	}
	q.bl = newHTTPProvider(qqID+"-cache", 700*time.Millisecond, hdr)
	return q
}

func (q *qq) Info() ProviderInfo {
	note := "QQ Music's open web endpoints give time-synced lines and translations without any account. " +
		"Word timing (QRC) comes from the Better Lyrics community cache, which has it only for songs already cached" +
		"; both routes are unofficial."
	if q.blKey != "" {
		note = "QQ Music's open web endpoints give time-synced lines and translations without any account. " +
			"Word timing (QRC) comes from Better Lyrics, with your key, so uncached songs are fetched too; both routes are unofficial."
	}
	return ProviderInfo{
		ID: qqID, Name: "QQ Music", Status: StatusReady, Verified: true,
		Plain: true, Synced: true, WordSync: true, Translation: true,
		Implemented: true, Configured: true, Auth: AuthOptionalKey,
		Formats:     []string{"qrc", "lrc", "translation"},
		Attribution: "Lyrics from QQ Music",
		Note:        note,
		Modes: []ProviderMode{
			{ID: "direct", Name: "QQ Music web endpoints (line-synced)", Auth: AuthNone, Active: true},
			{ID: "community-cache", Name: "Better Lyrics cache (word-timed QRC)", Auth: AuthNone, Active: true,
				Note: "Only songs already cached"},
			{ID: "community-live", Name: "Better Lyrics with your key (any song)", Auth: AuthAPIKey, Active: q.blKey != ""},
		},
	}
}

type qqSong struct {
	Mid    string `json:"mid"`
	Name   string `json:"name"`
	Singer string `json:"singer"`
}

func (q *qq) Search(ctx context.Context, rec Recording) ([]Candidate, error) {
	title, _ := splitTitle(rec.Title)
	title, artist := strings.TrimSpace(title), primaryArtist(rec.Artist)
	if title == "" {
		return nil, nil
	}
	var out []Candidate
	var directErr error
	cands, err := q.searchDirect(ctx, rec, title, artist)
	if err != nil {
		directErr = err
	}
	out = append(out, cands...)

	// The two routes are independent: a failing one only matters when the
	// other has nothing to offer.
	if qrc, err := q.searchQRC(ctx, rec, title, artist); err != nil {
		var rl *RateLimitedError
		if errors.As(err, &rl) || ctx.Err() != nil {
			if len(out) == 0 {
				return nil, err
			}
		} else {
			log.Debug(ctx, "QQ Music community cache failed", err)
		}
	} else if qrc != nil {
		confirmQRC(qrc, out)
		out = append(out, *qrc)
	}
	if len(out) == 0 && directErr != nil {
		return nil, directErr
	}
	return out, nil
}

// searchDirect finds the song on QQ Music and reads its line-timed lyrics.
func (q *qq) searchDirect(ctx context.Context, rec Recording, title, artist string) ([]Candidate, error) {
	var res struct {
		Code int `json:"code"`
		Data struct {
			Song struct {
				Items []qqSong `json:"itemlist"`
			} `json:"song"`
		} `json:"data"`
	}
	endpoint := q.directURL + "/splcloud/fcgi-bin/smartbox_new.fcg?" + url.Values{
		"key": {strings.TrimSpace(title + " " + artist)}, "format": {"json"}}.Encode()
	if err := q.direct.getJSON(ctx, endpoint, &res); err != nil {
		if errors.Is(err, errNotFound) {
			return nil, nil
		}
		return nil, err
	}
	if res.Code != 0 {
		return nil, fmt.Errorf("%w: QQ Music search answered code %d", ErrProviderUnavailable, res.Code)
	}

	// Rank on title and artist first; length and album need the detail call.
	type scored struct {
		song  qqSong
		match Match
	}
	var found []scored
	for _, s := range res.Data.Song.Items {
		if s.Mid == "" || s.Name == "" {
			continue
		}
		found = append(found, scored{s, ScoreMatch(Recording{Title: rec.Title, Artist: rec.Artist}, Meta{Title: s.Name, Artist: s.Singer})})
	}
	sort.SliceStable(found, func(i, j int) bool { return found[i].match.Confidence > found[j].match.Confidence })

	var out []Candidate
	for _, f := range found {
		if len(out) >= qqLookups || !f.match.Listed() {
			break
		}
		c, err := q.directCandidate(ctx, rec, f.song)
		if err != nil {
			var rl *RateLimitedError
			if errors.As(err, &rl) || ctx.Err() != nil || len(out) == 0 && errors.Is(err, ErrProviderUnavailable) {
				return out, err
			}
			log.Debug(ctx, "QQ Music lookup failed", "mid", f.song.Mid, err)
			continue
		}
		if c != nil {
			out = append(out, *c)
		}
	}
	return out, nil
}

func (q *qq) directCandidate(ctx context.Context, rec Recording, s qqSong) (*Candidate, error) {
	var detail struct {
		Data []struct {
			Title  string `json:"title"`
			Singer []struct {
				Name string `json:"name"`
			} `json:"singer"`
			Album struct {
				Name string `json:"name"`
			} `json:"album"`
			Interval float64 `json:"interval"`
		} `json:"data"`
	}
	dq := url.Values{"songmid": {s.Mid}, "format": {"json"}, "platform": {"yqq"}}
	if err := q.direct.getJSON(ctx, q.directURL+"/v8/fcg-bin/fcg_play_single_song.fcg?"+dq.Encode(), &detail); err != nil {
		if errors.Is(err, errNotFound) {
			return nil, nil
		}
		return nil, err
	}
	meta := Meta{Title: s.Name, Artist: s.Singer}
	if len(detail.Data) > 0 {
		d := detail.Data[0]
		names := make([]string, 0, len(d.Singer))
		for _, sg := range d.Singer {
			names = append(names, sg.Name)
		}
		if d.Title != "" {
			meta.Title = d.Title
		}
		if len(names) > 0 {
			meta.Artist = strings.Join(names, ", ")
		}
		meta.Album, meta.DurationSec = d.Album.Name, d.Interval
	}
	match := ScoreMatch(rec, meta)
	if !match.Listed() {
		return nil, nil
	}

	var lyr struct {
		Code  int    `json:"code"`
		Lyric string `json:"lyric"`
		Trans string `json:"trans"`
	}
	lq := url.Values{"songmid": {s.Mid}, "format": {"json"}, "nobase64": {"1"}, "g_tk": {"5381"}}
	if err := q.direct.getJSON(ctx, q.directURL+"/lyric/fcgi-bin/fcg_query_lyric_new.fcg?"+lq.Encode(), &lyr); err != nil {
		if errors.Is(err, errNotFound) {
			return nil, nil
		}
		return nil, err
	}
	c := &Candidate{
		ID: qqID + ":" + s.Mid, Provider: qqID, Source: SourceRemote, Meta: meta, Match: match,
		Attribution: "Lyrics from QQ Music",
	}
	if strings.Contains(lyr.Lyric, "纯音乐") && strings.Count(lyr.Lyric, "\n") < 3 {
		c.Meta.Instrumental = true
		return c, nil
	}
	text := strings.TrimSpace(lyr.Lyric)
	if lyr.Code != 0 || text == "" {
		return nil, nil
	}
	list, err := model.ParseLyrics(ctx, ".lrc", "xxx", []byte(text))
	if err != nil || len(list) == 0 {
		return nil, nil
	}
	for i := range list {
		if list[i].Kind == "" {
			list[i].Kind = model.LyricKindMain
		}
	}
	if tr := strings.TrimSpace(lyr.Trans); tr != "" && list[0].Synced {
		if tl, err := model.ParseLyrics(ctx, ".lrc", "xxx", []byte(tr)); err == nil && len(tl) > 0 && tl[0].Synced && hasText(tl[0]) {
			t := tl[0]
			t.Kind = model.LyricKindTranslation
			list = append(list, t)
		}
	}
	c.Lyrics, c.Quality = list, QualityOf(list)
	if c.Quality == QualityNone {
		return nil, nil
	}
	return c, nil
}

// searchQRC asks the Better Lyrics cache for word-timed QRC.
func (q *qq) searchQRC(ctx context.Context, rec Recording, title, artist string) (*Candidate, error) {
	var res struct {
		Lyrics string `json:"lyrics"`
	}
	params := url.Values{"s": {title}, "a": {artist}}
	if rec.Album != "" {
		params.Set("al", rec.Album)
	}
	if rec.DurationSec > 0 {
		params.Set("d", fmt.Sprintf("%d", int(math.Round(rec.DurationSec))))
	}
	if err := q.bl.getJSON(ctx, q.blURL+"/qq/getLyrics?"+params.Encode(), &res); err != nil {
		// 404: nothing for this song. 401/403: uncached and no key, which is the
		// ordinary keyless case. Neither is a failure.
		if errors.Is(err, errNotFound) || isStatusRefused(err) {
			return nil, nil
		}
		return nil, err
	}
	list, tags, err := ParseQRC(res.Lyrics)
	if err != nil {
		log.Debug(ctx, "QQ Music QRC could not be read", err)
		return nil, nil
	}
	if checked, synthetic := rejectSyntheticWordTiming(list); synthetic {
		log.Debug(ctx, "QQ Music word timing looks evenly split, using line timing only")
		list = checked
	}
	meta := Meta{Title: tags.Title, Artist: tags.Artist, Album: tags.Album}
	match := ScoreMatch(rec, meta)
	// The tags carry no length, so check the lyrics against the track instead
	if rec.DurationSec > 0 {
		var lastMs int64
		for _, l := range list[0].Line {
			if l.End != nil && *l.End > lastMs {
				lastMs = *l.End
			} else if l.Start != nil && *l.Start > lastMs {
				lastMs = *l.Start
			}
		}
		if float64(lastMs)/1000 > rec.DurationSec+qqMaxOverrunMs/1000 {
			match.Confidence = math.Min(match.Confidence, 0.45)
			match.Mismatch = append(match.Mismatch, "lyrics-longer-than-track")
		}
	}
	c := &Candidate{
		ID: qqID + ":cache:" + tags.Title, Provider: qqID, Source: SourceRemote, Lyrics: list,
		Quality: QualityOf(list), Meta: meta, Match: match, Attribution: "Lyrics from QQ Music (via Better Lyrics)",
	}
	if c.Quality == QualityNone {
		return nil, nil
	}
	return c, nil
}

const (
	// qqAgreeToleranceMs is how far a QRC line start may be from a QQ line start
	// and still be the same line.
	qqAgreeToleranceMs = 1500
	// qqAgreeShare is the share of QRC lines that must have a counterpart.
	qqAgreeShare = 0.7
)

// confirmQRC gives a word-timed QRC the match of a verified line-timed QQ
// result when their timelines agree. The community cache reports no length, so
// on its own a QRC with the right title and artist cannot be told from another
// version of the song. Line starts that coincide with those of a result whose
// length was checked can: a different version drifts.
func confirmQRC(qrc *Candidate, direct []Candidate) {
	// Agreement only settles the length. A QRC whose own tags name another song,
	// or that was already ruled out, is never promoted by it.
	if qrc.Match.Verified() || !qrc.Match.Listed() || len(qrc.Match.Mismatch) > 0 || len(qrc.Lyrics) == 0 {
		return
	}
	for _, d := range direct {
		if d.Match.Verified() && d.Quality >= QualitySynced && len(d.Lyrics) > 0 &&
			timelinesAgree(qrc.Lyrics[0], d.Lyrics[0]) {
			qrc.Match = d.Match
			qrc.Meta.DurationSec = d.Meta.DurationSec
			return
		}
	}
}

func timelinesAgree(a, b model.Lyrics) bool {
	var counted, matched int
	for _, la := range a.Line {
		if la.Start == nil || strings.TrimSpace(la.Value) == "" {
			continue
		}
		counted++
		for _, lb := range b.Line {
			if lb.Start != nil && math.Abs(float64(*la.Start-*lb.Start)) <= qqAgreeToleranceMs {
				matched++
				break
			}
		}
	}
	return counted >= 2 && float64(matched) >= qqAgreeShare*float64(counted)
}

// isStatusRefused reports whether a provider call failed because the service
// refused it (4xx other than 404 and 429), as Better Lyrics does for an
// uncached song without a key.
func isStatusRefused(err error) bool {
	return errors.Is(err, ErrProviderUnavailable) && strings.Contains(err.Error(), "answered 4")
}
