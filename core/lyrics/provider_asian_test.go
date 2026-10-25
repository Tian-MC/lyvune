package lyrics_test

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"

	"github.com/navidrome/navidrome/core/lyrics"
	"github.com/navidrome/navidrome/model"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

// These tests run against local fake servers shaped like the real services
// (checked with the live calls in live_test.go). Lyric text is synthetic.

func writeJSON(w http.ResponseWriter, v any) { _ = json.NewEncoder(w).Encode(v) }

var _ = Describe("NetEase provider", func() {
	rec := lyrics.Recording{Title: "こんにちは", Artist: "テスト歌手", Album: "Album", DurationSec: 200}
	var srv *httptest.Server
	AfterEach(func() {
		if srv != nil {
			srv.Close()
			srv = nil
		}
	})

	song := func(id int, name, artist string, ms int) map[string]any {
		return map[string]any{"id": id, "name": name, "duration": ms,
			"artists": []map[string]any{{"name": artist}}, "album": map[string]any{"name": "Album"}}
	}
	serve := func(store bool, songs []map[string]any, lyric map[int]map[string]any) lyrics.OnlineProvider {
		srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case "/api/search/get":
				Expect(r.URL.Query().Get("s")).To(ContainSubstring("こんにちは"), "CJK is sent untouched")
				writeJSON(w, map[string]any{"code": 200, "result": map[string]any{"songs": songs}})
			case "/api/song/lyric":
				var id int
				_, _ = fmt.Sscan(r.URL.Query().Get("id"), &id)
				writeJSON(w, lyric[id])
			default:
				w.WriteHeader(404)
			}
		}))
		p := lyrics.NewNetEase(srv.URL, store)
		lyrics.FastForTest(p)
		return p
	}
	const lrc = "[00:01.00]こんにちは\n[00:03.00]さようなら"
	const yrc = "[1000,2000](1000,500,0)こ(1500,300,0)ん(1800,900,0)にちは\n[3000,1000](3000,200,0)さよ(3200,800,0)うなら"

	It("is unofficial, advertises what it really returns, and stores only when allowed", func() {
		info := lyrics.NewNetEase("", false).Info()
		Expect(info.Status).To(Equal(lyrics.StatusReady))
		Expect(info.Translation && info.Romanization && info.Synced).To(BeTrue())
		Expect(info.Storable).To(BeFalse())
		Expect(info.Note).To(ContainSubstring("Unofficial"))
		Expect(lyrics.NewNetEase("", true).Info().Storable).To(BeTrue())
	})

	It("reads word timing from yrc and keeps the translation and romanization as separate tracks", func() {
		p := serve(true, []map[string]any{song(7, "こんにちは", "テスト歌手", 200000)}, map[int]map[string]any{7: {
			"code": 200, "lrc": map[string]any{"lyric": lrc}, "yrc": map[string]any{"lyric": yrc},
			"tlyric":  map[string]any{"lyric": "[00:01.00]Hello\n[00:03.00]Goodbye"},
			"romalrc": map[string]any{"lyric": "[00:01.00]konnichiwa\n[00:03.00]sayounara"},
		}})
		got, err := p.Search(context.Background(), rec)
		Expect(err).ToNot(HaveOccurred())
		Expect(got).To(HaveLen(1))
		c := got[0]
		Expect(c.Quality).To(Equal(lyrics.QualityKaraoke))
		Expect(c.Storable).To(BeTrue())
		Expect(c.Match.Verified()).To(BeTrue())
		Expect(c.Lyrics).To(HaveLen(3))
		Expect([]string{c.Lyrics[0].Kind, c.Lyrics[1].Kind, c.Lyrics[2].Kind}).To(Equal(
			[]string{model.LyricKindMain, model.LyricKindTranslation, model.LyricKindPronunciation}))
		Expect(c.Lyrics[1].Line[0].Value).To(Equal("Hello"))
		Expect(*c.Lyrics[0].Line[0].Cue[2].End).To(Equal(int64(2700)))
	})

	It("never calls line-timed LRC karaoke", func() {
		p := serve(false, []map[string]any{song(7, "こんにちは", "テスト歌手", 200000)},
			map[int]map[string]any{7: {"code": 200, "lrc": map[string]any{"lyric": lrc}}})
		got, err := p.Search(context.Background(), rec)
		Expect(err).ToNot(HaveOccurred())
		Expect(got).To(HaveLen(1))
		Expect(got[0].Quality).To(Equal(lyrics.QualitySynced))
		Expect(got[0].Storable).To(BeFalse())
	})

	It("never verifies other recordings: covers, live versions and wrong lengths", func() {
		p := serve(true, []map[string]any{
			song(1, "こんにちは (Live)", "テスト歌手", 200000),
			song(2, "こんにちは", "別の人", 200000),
			song(3, "こんにちは", "テスト歌手", 90000),
		}, map[int]map[string]any{
			1: {"code": 200, "yrc": map[string]any{"lyric": yrc}}, 2: {"code": 200, "yrc": map[string]any{"lyric": yrc}},
			3: {"code": 200, "yrc": map[string]any{"lyric": yrc}},
		})
		got, err := p.Search(context.Background(), rec)
		Expect(err).ToNot(HaveOccurred())
		for _, c := range got {
			Expect(c.Match.Verified()).To(BeFalse(), c.Meta.Title+" / "+c.Meta.Artist)
		}
		_, auto := lyrics.Choose(got, lyrics.Policy{})
		Expect(auto).To(BeFalse(), "karaoke from a wrong recording is never chosen automatically")
	})

	It("does not turn a credits-only answer or a malformed timestamp into lyrics", func() {
		// NetEase answers like this for a song it has no lyrics for
		p := serve(true, []map[string]any{song(7, "こんにちは", "テスト歌手", 200000)},
			map[int]map[string]any{7: {"code": 200, "lrc": map[string]any{"lyric": "[00:00.00-1] 作曲 : Someone"}}})
		got, err := p.Search(context.Background(), rec)
		Expect(err).ToNot(HaveOccurred())
		for _, c := range got {
			Expect(lyrics.CreditsOnly(c.Lyrics)).To(BeTrue(), "the provider may return it; the engine drops it")
		}

		// the stray "-1" is removed from real lyrics
		p = serve(true, []map[string]any{song(7, "こんにちは", "テスト歌手", 200000)},
			map[int]map[string]any{7: {"code": 200, "lrc": map[string]any{"lyric": "[00:01.00-1]first line\n[00:03.50-1]second line"}}})
		got, err = p.Search(context.Background(), rec)
		Expect(err).ToNot(HaveOccurred())
		Expect(got).To(HaveLen(1))
		Expect(got[0].Quality).To(Equal(lyrics.QualitySynced))
		Expect(got[0].Lyrics[0].Line[0].Value).To(Equal("first line"))
		Expect(*got[0].Lyrics[0].Line[1].Start).To(Equal(int64(3500)))
	})

	It("reports instrumentals and songs without lyrics", func() {
		p := serve(true, []map[string]any{song(7, "こんにちは", "テスト歌手", 200000)},
			map[int]map[string]any{7: {"code": 200, "pureMusic": true}})
		got, err := p.Search(context.Background(), rec)
		Expect(err).ToNot(HaveOccurred())
		Expect(got).To(HaveLen(1))
		Expect(got[0].Meta.Instrumental).To(BeTrue())
		Expect(got[0].Quality).To(Equal(lyrics.QualityNone))

		p = serve(true, []map[string]any{song(7, "こんにちは", "テスト歌手", 200000)},
			map[int]map[string]any{7: {"code": 200, "nolyric": true}})
		got, err = p.Search(context.Background(), rec)
		Expect(err).ToNot(HaveOccurred())
		Expect(got).To(BeEmpty())
	})

	It("isolates failures: malformed answers, server errors and rate limits", func() {
		for _, tc := range []struct {
			h    http.HandlerFunc
			want string
		}{
			{func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("<html>blocked")) }, "unavailable"},
			{func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(500) }, "unavailable"},
			{func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(403) }, "unavailable"},
			{func(w http.ResponseWriter, r *http.Request) { w.Header().Set("Retry-After", "30"); w.WriteHeader(429) }, "ratelimit"},
		} {
			s := httptest.NewServer(tc.h)
			p := lyrics.NewNetEase(s.URL, true)
			lyrics.FastForTest(p)
			_, err := p.Search(context.Background(), rec)
			s.Close()
			Expect(err).To(HaveOccurred())
			if tc.want == "ratelimit" {
				var rl *lyrics.RateLimitedError
				Expect(err).To(BeAssignableToTypeOf(rl))
			} else {
				Expect(err).To(MatchError(lyrics.ErrProviderUnavailable))
			}
		}
	})

	It("stops when the request is cancelled", func() {
		s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }))
		defer s.Close()
		p := lyrics.NewNetEase(s.URL, true)
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		_, err := p.Search(ctx, rec)
		Expect(err).To(HaveOccurred())
	})
})

var _ = Describe("KuGou provider", func() {
	rec := lyrics.Recording{Title: "こんにちは", Artist: "テスト歌手", DurationSec: 200}
	var srv *httptest.Server
	AfterEach(func() {
		if srv != nil {
			srv.Close()
			srv = nil
		}
	})

	type fake struct {
		emptyFirst bool
		songs      []map[string]any
		entries    []map[string]any
		krc        string // KRC text; "" means the KRC download fails
		lrc        string
		searches   atomic.Int32
		downloads  []string
	}
	serve := func(f *fake, store bool) lyrics.OnlineProvider {
		srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case "/song_search_v2":
				n := f.searches.Add(1)
				if f.emptyFirst && n == 1 {
					writeJSON(w, map[string]any{"status": 1, "data": map[string]any{"total": 0, "lists": []any{}}})
					return
				}
				writeJSON(w, map[string]any{"status": 1, "data": map[string]any{"total": len(f.songs), "lists": f.songs}})
			case "/search":
				writeJSON(w, map[string]any{"status": 200, "candidates": f.entries})
			case "/download":
				format := r.URL.Query().Get("fmt")
				f.downloads = append(f.downloads, format)
				switch {
				case format == "krc" && f.krc != "":
					writeJSON(w, map[string]any{"status": 200, "content": base64.StdEncoding.EncodeToString(packKRC(f.krc))})
				case format == "lrc" && f.lrc != "":
					writeJSON(w, map[string]any{"status": 200, "content": base64.StdEncoding.EncodeToString([]byte("\xef\xbb\xbf" + f.lrc))})
				default:
					writeJSON(w, map[string]any{"status": 400, "content": ""})
				}
			}
		}))
		p := lyrics.NewKuGou(srv.URL, srv.URL, store)
		lyrics.FastForTest(p)
		return p
	}
	song := func(hash, name, artist string, secs int) map[string]any {
		return map[string]any{"FileHash": hash, "SongName": name, "SingerName": artist, "AlbumName": "Album", "Duration": secs}
	}
	entry := func(id string, ms, score int) map[string]any {
		return map[string]any{"id": id, "accesskey": "KEY" + id, "duration": ms, "score": score}
	}
	newFake := func() *fake {
		return &fake{
			songs:   []map[string]any{song("H1", "こんにちは", "テスト歌手", 200)},
			entries: []map[string]any{entry("11", 200400, 60)},
			krc:     syntheticKRC(),
		}
	}

	It("is unofficial, advertises word timing, translation and romanization", func() {
		info := lyrics.NewKuGou("", "", false).Info()
		Expect(info.WordSync && info.Translation && info.Romanization).To(BeTrue())
		Expect(info.Storable).To(BeFalse())
		Expect(info.Note).To(ContainSubstring("Unofficial"))
	})

	It("downloads KRC and keeps the real word timing with translation and romanization", func() {
		f := newFake()
		got, err := serve(f, true).Search(context.Background(), rec)
		Expect(err).ToNot(HaveOccurred())
		Expect(got).To(HaveLen(1))
		c := got[0]
		Expect(c.Quality).To(Equal(lyrics.QualityKaraoke))
		Expect(c.Storable).To(BeTrue())
		Expect(c.Match.Verified()).To(BeTrue())
		Expect(c.Lyrics).To(HaveLen(3))
		Expect(c.Lyrics[0].Line[0].Cue).To(HaveLen(4))
		Expect(f.downloads).To(Equal([]string{"krc"}), "LRC is not fetched when KRC worked")
	})

	It("falls back to plain LRC and classifies it by what it contains", func() {
		f := newFake()
		f.krc, f.lrc = "", "[00:01.00]こんにちは\n[00:03.00]さようなら"
		got, err := serve(f, true).Search(context.Background(), rec)
		Expect(err).ToNot(HaveOccurred())
		Expect(got).To(HaveLen(1))
		Expect(got[0].Quality).To(Equal(lyrics.QualitySynced))
		Expect(f.downloads).To(Equal([]string{"krc", "lrc"}))
	})

	It("skips lyric entries whose length belongs to another version", func() {
		f := newFake()
		f.entries = []map[string]any{entry("99", 260000, 90), entry("11", 200400, 10)}
		got, err := serve(f, true).Search(context.Background(), rec)
		Expect(err).ToNot(HaveOccurred())
		Expect(got).To(HaveLen(1))
		Expect(got[0].ID).To(Equal("kugou:11"))
	})

	It("asks once more when the search comes back empty, because KuGou does that when throttling", func() {
		f := newFake()
		f.emptyFirst = true
		got, err := serve(f, true).Search(context.Background(), rec)
		Expect(err).ToNot(HaveOccurred())
		Expect(got).To(HaveLen(1))
		Expect(f.searches.Load()).To(Equal(int32(2)))
	})

	It("does not keep asking when there really is nothing", func() {
		f := newFake()
		f.songs = nil
		got, err := serve(f, true).Search(context.Background(), rec)
		Expect(err).ToNot(HaveOccurred())
		Expect(got).To(BeEmpty())
		Expect(f.searches.Load()).To(Equal(int32(2)))
	})

	It("rejects a different recording even when it has good karaoke", func() {
		f := newFake()
		f.songs = []map[string]any{song("H2", "こんにちは (Live)", "テスト歌手", 200), song("H3", "こんにちは", "別の人", 200), song("H4", "こんにちは", "テスト歌手", 61)}
		got, err := serve(f, true).Search(context.Background(), rec)
		Expect(err).ToNot(HaveOccurred())
		Expect(got).To(BeEmpty())
		Expect(f.downloads).To(BeEmpty())
	})

	It("drops word timing that looks divided up by formula, keeping the line times", func() {
		f := newFake()
		var sb strings.Builder
		for i := 0; i < 8; i++ {
			fmt.Fprintf(&sb, "[%d,2000]<0,500,0>aa <500,500,0>bb <1000,500,0>cc <1500,500,0>dd\n", i*2000)
		}
		f.krc = sb.String()
		got, err := serve(f, true).Search(context.Background(), rec)
		Expect(err).ToNot(HaveOccurred())
		Expect(got).To(HaveLen(1))
		Expect(got[0].Quality).To(Equal(lyrics.QualitySynced), "evenly split words are not karaoke")
		Expect(got[0].Lyrics[0].Line[0].Cue).To(BeEmpty())
		Expect(*got[0].Lyrics[0].Line[1].Start).To(Equal(int64(2000)))
	})

	It("reports a rate limit and a blocked service without affecting other providers", func() {
		s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Header().Set("Retry-After", "5"); w.WriteHeader(429) }))
		defer s.Close()
		p := lyrics.NewKuGou(s.URL, s.URL, true)
		lyrics.FastForTest(p)
		_, err := p.Search(context.Background(), rec)
		var rl *lyrics.RateLimitedError
		Expect(err).To(BeAssignableToTypeOf(rl))

		down := lyrics.NewKuGou("http://127.0.0.1:1", "http://127.0.0.1:1", true)
		lyrics.FastForTest(down)
		_, err = down.Search(context.Background(), rec)
		Expect(err).To(MatchError(lyrics.ErrProviderUnavailable))
	})
})

var _ = Describe("synthetic word timing", func() {
	build := func(starts ...int64) model.Line {
		words := make([]model.Cue, len(starts))
		for i, s := range starts {
			s := s
			words[i] = model.Cue{Start: &s, Value: "ab "}
		}
		return model.Line{Cue: words}
	}
	list := func(lines ...model.Line) model.LyricList {
		return model.LyricList{{Kind: model.LyricKindMain, Synced: true, Line: lines}}
	}
	measured := build(0, 130, 600, 640)
	even := build(0, 500, 1000, 1500)

	It("keeps a document with a few chanted even lines", func() {
		out, rejected := lyrics.RejectSyntheticWordTiming(list(measured, measured, measured, measured, even))
		Expect(rejected).To(BeFalse())
		Expect(out[0].Line[0].Cue).ToNot(BeEmpty())
	})

	It("rejects a document that is mostly even, and not a short one", func() {
		_, rejected := lyrics.RejectSyntheticWordTiming(list(even, even, even, even, measured))
		Expect(rejected).To(BeTrue())
		_, rejected = lyrics.RejectSyntheticWordTiming(list(even, even))
		Expect(rejected).To(BeFalse(), "too little evidence to judge")
	})
})
