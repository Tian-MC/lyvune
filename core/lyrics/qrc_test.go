package lyrics_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"

	"github.com/navidrome/navidrome/core/lyrics"
	"github.com/navidrome/navidrome/model"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

// SYNTHETIC QRC fixtures in the documented layout; not provider data.

func qrcEnvelope(body string) string {
	esc := strings.NewReplacer("&", "&amp;", "\"", "&quot;", "<", "&lt;", "\n", "&#10;").Replace(body)
	return `<?xml version="1.0" encoding="utf-8"?>` + "\n" +
		`<QrcInfos><QrcHeadInfo SaveTime="201" Version="100"/><LyricInfo LyricCount="1"><Lyric_1 LyricType="1" LyricContent="` +
		esc + `"/></LyricInfo></QrcInfos>`
}

const qrcBody = "[ti:Test Song]\n[ar:Test Band]\n[al:Test Album]\n[by:]\n[offset:0]\n" +
	"[1000,1500]Hel(1000,300)lo (1300,400)wor(1700,300)ld(2000,500)\n" +
	"[3000,1000]Un(3000,250)i(3250,150)code(3400,600)\n"

var _ = Describe("QRC", func() {
	It("reads the XML envelope and keeps the real word timing", func() {
		list, tags, err := lyrics.ParseQRC(qrcEnvelope(qrcBody))
		Expect(err).ToNot(HaveOccurred())
		Expect(tags).To(Equal(lyrics.QRCTags{Title: "Test Song", Artist: "Test Band", Album: "Test Album"}))
		Expect(lyrics.QualityOf(list)).To(Equal(lyrics.QualityKaraoke))
		l := list[0].Line[0]
		Expect(l.Value).To(Equal("Hello world"))
		Expect(*l.Start).To(Equal(int64(1000)))
		Expect(*l.End).To(Equal(int64(2500)))
		Expect(l.Cue).To(HaveLen(4))
		// starts are absolute; a word ends at start+duration, not at the next start
		Expect(*l.Cue[1].Start).To(Equal(int64(1300)))
		Expect(*l.Cue[1].End).To(Equal(int64(1700)))
		Expect(l.Cue[1].Value).To(Equal("lo "))
		Expect(l.Value[l.Cue[2].ByteStart : l.Cue[2].ByteEnd+1]).To(Equal("wor"))
	})

	It("accepts a bare body, XML-escaped text and Unicode", func() {
		list, _, err := lyrics.ParseQRC("[0,2000]こん(0,500)にちは(500,700) &amp; (1200,100)“q”(1300,500)")
		Expect(err).ToNot(HaveOccurred())
		Expect(list[0].Line[0].Value).To(Equal("こんにちは &amp; “q”"), "a bare body is not XML, so nothing is unescaped")
		list, _, err = lyrics.ParseQRC(qrcEnvelope("[0,2000]Tom & Jerry(0,900)\"quoted\"(900,800)"))
		Expect(err).ToNot(HaveOccurred())
		Expect(list[0].Line[0].Value).To(Equal(`Tom & Jerry"quoted"`))
	})

	It("reads an envelope with raw double quotes inside the attribute, as real documents have", func() {
		doc := `<?xml version="1.0" encoding="utf-8"?>` + "\n" +
			`<QrcInfos><QrcHeadInfo SaveTime="201" Version="100"/><LyricInfo LyricCount="1"><Lyric_1 LyricType="1" LyricContent="[ti:T]` + "\n" +
			`[ar:A]` + "\n" + `[0,2000]by (0,500)"Quoted"(500,900) &amp; (1400,100)x(1500,500)` + "\n" + `"/></LyricInfo></QrcInfos>`
		list, tags, err := lyrics.ParseQRC(doc)
		Expect(err).ToNot(HaveOccurred())
		Expect(tags.Title).To(Equal("T"))
		Expect(list[0].Line[0].Value).To(Equal(`by "Quoted" & x`))
		Expect(*list[0].Line[0].Cue[1].Start).To(Equal(int64(500)))
	})

	It("leaves the end empty when the source gives a zero duration", func() {
		list, _, err := lyrics.ParseQRC("[0,1000]a(0,0)b(500,500)")
		Expect(err).ToNot(HaveOccurred())
		Expect(list[0].Line[0].Cue[0].End).To(BeNil())
		Expect(*list[0].Line[0].Cue[1].End).To(Equal(int64(1000)))
	})

	It("keeps parentheses that belong to the text and applies the offset", func() {
		list, _, err := lyrics.ParseQRC("[offset:100]\n[1000,1000]Oh (1000,300)(yeah)(1300,700)")
		Expect(err).ToNot(HaveOccurred())
		l := list[0].Line[0]
		Expect(l.Value).To(Equal("Oh (yeah)"))
		Expect(*l.Start).To(Equal(int64(1100)))
		Expect(*l.Cue[1].Start).To(Equal(int64(1400)))
	})

	It("keeps a line with no word tokens as line timing", func() {
		list, _, err := lyrics.ParseQRC("[0,1000]just a line\n[1000,1000]another")
		Expect(err).ToNot(HaveOccurred())
		Expect(lyrics.QualityOf(list)).To(Equal(lyrics.QualitySynced))
	})

	It("copes with gaps, overlapping tokens, long lines and junk without panicking", func() {
		inputs := []string{
			"", "[", "[1,2", "[1,2]x(", "[1,2]x(1,", "[1,2]x(a,b)", "<QrcInfos>", "<QrcInfos></QrcInfos>", "<QrcInfos><Lyric_1 LyricContent=\"[0,1]a(0,1)", "<QrcInfos>LyricContent=\"\"/>",
			"[0,100]a(0,100)b(0,100)c(50,10)", "[0,100]a(500,100)b(100,100)",
			"[0,1000]" + strings.Repeat("w(1,1)", 20000),
			qrcEnvelope("[ti:x]"),
		}
		for _, in := range inputs {
			Expect(func() { _, _, _ = lyrics.ParseQRC(in) }).ToNot(Panic(), fmt.Sprintf("%.30q", in))
		}
		_, _, err := lyrics.ParseQRC("<QrcInfos></QrcInfos>")
		Expect(err).To(MatchError(lyrics.ErrNotQRC))
	})

	It("is classified at the lowest quality its timing supports", func() {
		even := "[0,4000]a(0,1000)b(1000,1000)c(2000,1000)d(3000,1000)\n"
		list, _, err := lyrics.ParseQRC(strings.Repeat(even, 6))
		Expect(err).ToNot(HaveOccurred())
		checked, rejected := lyrics.RejectSyntheticWordTiming(list)
		Expect(rejected).To(BeTrue(), "every word the same length is not measured timing")
		Expect(lyrics.QualityOf(checked)).To(Equal(lyrics.QualitySynced))
	})
})

var _ = Describe("QQ Music provider", func() {
	rec := lyrics.Recording{Title: "Test Song", Artist: "Test Band", Album: "Test Album", DurationSec: 200}
	var srv *httptest.Server
	AfterEach(func() {
		if srv != nil {
			srv.Close()
			srv = nil
		}
	})

	type fake struct {
		songs       []map[string]any
		interval    int
		lyric       string
		trans       string
		qrc         string // QRC envelope; "" means the cache has nothing
		blStatus    int    // when set, Better Lyrics answers this status
		sawKey      string
		sawReferer  string
		blRequested int
	}
	serve := func(f *fake, store bool, key string) lyrics.OnlineProvider {
		srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case "/splcloud/fcgi-bin/smartbox_new.fcg":
				f.sawReferer = r.Header.Get("Referer")
				writeJSON(w, map[string]any{"code": 0, "data": map[string]any{"song": map[string]any{"itemlist": f.songs}}})
			case "/v8/fcg-bin/fcg_play_single_song.fcg":
				writeJSON(w, map[string]any{"data": []map[string]any{{"title": "Test Song", "singer": []map[string]any{{"name": "Test Band"}},
					"album": map[string]any{"name": "Test Album"}, "interval": f.interval}}})
			case "/lyric/fcgi-bin/fcg_query_lyric_new.fcg":
				writeJSON(w, map[string]any{"code": 0, "lyric": f.lyric, "trans": f.trans})
			case "/qq/getLyrics":
				f.blRequested++
				f.sawKey = r.Header.Get("X-API-Key")
				switch {
				case f.blStatus != 0:
					w.WriteHeader(f.blStatus)
					writeJSON(w, map[string]any{"error": "x"})
				case f.qrc == "":
					w.WriteHeader(404)
					writeJSON(w, map[string]any{"error": "no songs found"})
				default:
					writeJSON(w, map[string]any{"lyrics": f.qrc, "provider": "qq"})
				}
			default:
				w.WriteHeader(404)
			}
		}))
		p := lyrics.NewQQ(srv.URL, srv.URL, key, store)
		lyrics.FastForTest(p)
		return p
	}
	newFake := func() *fake {
		return &fake{
			songs:    []map[string]any{{"mid": "M1", "name": "Test Song", "singer": "Test Band"}},
			interval: 200,
			lyric:    "[ti:Test Song]\n[00:01.00]Hello world\n[00:03.00]Second line",
		}
	}

	It("is keyless, unofficial, and advertises word timing only through the community cache", func() {
		info := lyrics.NewQQ("", "", "", false).Info()
		Expect(info.Auth).To(Equal(lyrics.AuthOptionalKey))
		Expect(info.Storable).To(BeFalse())
		Expect(info.Note).To(ContainSubstring("already cached"))
		Expect(info.Modes).To(HaveLen(3))
		Expect(info.Modes[0].Active && info.Modes[1].Active).To(BeTrue())
		Expect(info.Modes[2].Active).To(BeFalse(), "the keyed mode is off without a key")
		Expect(lyrics.NewQQ("", "", "k", true).Info().Modes[2].Active).To(BeTrue())
		Expect(lyrics.NewQQ("", "", "k", true).Info().Storable).To(BeTrue())
	})

	It("reads line-timed lyrics and a translation from the open endpoints, sending a Referer and no key", func() {
		f := newFake()
		f.trans = "[00:01.00]你好世界\n[00:03.00]第二行"
		got, err := serve(f, true, "").Search(context_(), rec)
		Expect(err).ToNot(HaveOccurred())
		Expect(got).To(HaveLen(1))
		c := got[0]
		Expect(c.Quality).To(Equal(lyrics.QualitySynced))
		Expect(c.Match.Verified()).To(BeTrue())
		Expect(c.Lyrics).To(HaveLen(2))
		Expect(c.Lyrics[1].Kind).To(Equal(model.LyricKindTranslation))
		Expect(f.sawReferer).To(Equal("https://y.qq.com/"))
		Expect(f.sawKey).To(BeEmpty())
	})

	It("adds word-timed QRC from the community cache and ranks it above line timing", func() {
		f := newFake()
		f.qrc = qrcEnvelope(qrcBody)
		got, err := serve(f, true, "").Search(context_(), rec)
		Expect(err).ToNot(HaveOccurred())
		Expect(got).To(HaveLen(2))
		var karaoke, synced *lyrics.Candidate
		for i := range got {
			switch got[i].Quality {
			case lyrics.QualityKaraoke:
				karaoke = &got[i]
			case lyrics.QualitySynced:
				synced = &got[i]
			}
		}
		Expect(karaoke).ToNot(BeNil())
		Expect(synced).ToNot(BeNil())
		Expect(karaoke.Match.Verified()).To(BeTrue(), "judged from the title, artist and album tags inside the QRC")
		best, auto := lyrics.Choose(got, lyrics.Policy{})
		Expect(auto).To(BeTrue())
		Expect(best.Quality).To(Equal(lyrics.QualityKaraoke))
	})

	It("verifies a QRC that has no length by agreement with the verified QQ timeline", func() {
		// album tag differs and no length is given, so the tags alone score below verified
		other := strings.Replace(qrcBody, "[al:Test Album]", "[al:Some Single]", 1)
		f := newFake()
		f.lyric = "[00:01.00]Hello world\n[00:03.00]Second line"
		f.qrc = qrcEnvelope(other)
		got, err := serve(f, true, "").Search(context_(), rec)
		Expect(err).ToNot(HaveOccurred())
		best, auto := lyrics.Choose(got, lyrics.Policy{})
		Expect(auto).To(BeTrue())
		Expect(best.Quality).To(Equal(lyrics.QualityKaraoke))
		Expect(best.Meta.DurationSec).To(Equal(200.0))

		// the same words on a shifted timeline are another version: not verified
		f2 := newFake()
		f2.lyric = "[00:11.00]Hello world\n[00:13.00]Second line"
		f2.qrc = qrcEnvelope(other)
		got, err = serve(f2, true, "").Search(context_(), rec)
		Expect(err).ToNot(HaveOccurred())
		best, auto = lyrics.Choose(got, lyrics.Policy{})
		Expect(auto).To(BeTrue())
		Expect(best.Quality).To(Equal(lyrics.QualitySynced), "the unconfirmed karaoke is not chosen")
	})

	It("never trusts a QRC of another song or one longer than the track", func() {
		f := newFake()
		f.qrc = qrcEnvelope(strings.Replace(qrcBody, "[ti:Test Song]", "[ti:Another Tune]", 1))
		got, err := serve(f, true, "").Search(context_(), rec)
		Expect(err).ToNot(HaveOccurred())
		for _, c := range got {
			if c.Quality == lyrics.QualityKaraoke {
				Expect(c.Match.Verified()).To(BeFalse())
			}
		}
		short := rec
		short.DurationSec = 100
		f2 := newFake()
		f2.qrc = qrcEnvelope(qrcBody + "[120000,1000]late(120000,500)\n")
		got, err = serve(f2, true, "").Search(context_(), short)
		Expect(err).ToNot(HaveOccurred())
		for _, c := range got {
			if c.Quality == lyrics.QualityKaraoke {
				Expect(c.Match.Verified()).To(BeFalse())
				Expect(c.Match.Mismatch).To(ContainElement("lyrics-longer-than-track"))
			}
		}
	})

	It("treats an uncached song without a key as ordinary, not as a failure", func() {
		f := newFake()
		f.blStatus = 401
		p := serve(f, true, "")
		got, err := p.Search(context_(), rec)
		Expect(err).ToNot(HaveOccurred())
		Expect(got).To(HaveLen(1), "the direct route still answers")
		Expect(got[0].Quality).To(Equal(lyrics.QualitySynced))
	})

	It("sends the optional Better Lyrics key only to Better Lyrics", func() {
		f := newFake()
		f.qrc = qrcEnvelope(qrcBody)
		_, err := serve(f, true, "MYKEY").Search(context_(), rec)
		Expect(err).ToNot(HaveOccurred())
		Expect(f.sawKey).To(Equal("MYKEY"))
		raw, _ := jsonMarshal(lyrics.NewQQ("", "", "MYKEY", false).Info())
		Expect(string(raw)).ToNot(ContainSubstring("MYKEY"))
	})

	It("keeps working when one route is down", func() {
		f := newFake()
		f.blStatus = 500
		got, err := serve(f, true, "").Search(context_(), rec)
		Expect(err).ToNot(HaveOccurred())
		Expect(got).To(HaveLen(1))

		down := lyrics.NewQQ("http://127.0.0.1:1", "http://127.0.0.1:1", "", true)
		lyrics.FastForTest(down)
		_, err = down.Search(context_(), rec)
		Expect(err).To(MatchError(lyrics.ErrProviderUnavailable))
	})

	It("rejects another recording and an instrumental has no lyrics", func() {
		f := newFake()
		f.songs = []map[string]any{{"mid": "M2", "name": "Test Song (Live)", "singer": "Test Band"}, {"mid": "M3", "name": "Other", "singer": "Else"}}
		got, err := serve(f, true, "").Search(context_(), rec)
		Expect(err).ToNot(HaveOccurred())
		for _, c := range got {
			Expect(c.Match.Verified()).To(BeFalse())
		}
		f2 := newFake()
		f2.lyric = "[00:00:00]此歌曲为没有填词的纯音乐，请您欣赏"
		got, err = serve(f2, true, "").Search(context_(), rec)
		Expect(err).ToNot(HaveOccurred())
		Expect(got).To(HaveLen(1))
		Expect(got[0].Meta.Instrumental).To(BeTrue())
		Expect(got[0].Quality).To(Equal(lyrics.QualityNone))
	})

	It("reports a rate limit from either route", func() {
		s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Header().Set("Retry-After", "5"); w.WriteHeader(429) }))
		defer s.Close()
		p := lyrics.NewQQ(s.URL, s.URL, "", true)
		lyrics.FastForTest(p)
		_, err := p.Search(context_(), rec)
		var rl *lyrics.RateLimitedError
		Expect(err).To(BeAssignableToTypeOf(rl))
	})
})

func context_() context.Context         { return context.Background() }
func jsonMarshal(v any) ([]byte, error) { return json.Marshal(v) }
