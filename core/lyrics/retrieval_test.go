package lyrics_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"

	"github.com/Tian-MC/lyvune/conf"
	"github.com/Tian-MC/lyvune/conf/configtest"
	"github.com/Tian-MC/lyvune/core/lyrics"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("Finding lyrics that exist", func() {
	rec := func(title, artist string) lyrics.Recording {
		return lyrics.Recording{Title: title, Artist: artist, Album: "Album", DurationSec: 200}
	}
	meta := func(title, artist string) lyrics.Meta {
		return lyrics.Meta{Title: title, Artist: artist, Album: "Album", DurationSec: 200}
	}

	Describe("a featuring credit written without brackets", func() {
		It("does not turn the right recording into a mismatch", func() {
			for _, title := range []string{"Song feat. Guest", "Song ft. Guest", "Song featuring Guest", "Song FEAT. Guest & Other"} {
				m := lyrics.ScoreMatch(rec(title, "Main"), meta("Song", "Main"))
				Expect(m.Verified()).To(BeTrue(), title)
				Expect(m.Title).To(Equal(1.0), title)
			}
			m := lyrics.ScoreMatch(rec("Song", "Main"), meta("Song feat. Guest", "Main feat. Guest"))
			Expect(m.Verified()).To(BeTrue())
		})

		It("keeps a title whose last word only looks like one", func() {
			for _, title := range []string{"Great Feat", "Daft feat", "Featuring"} {
				Expect(lyrics.ScoreMatch(rec(title, "Main"), meta("Great", "Main")).Title).To(BeNumerically("<", 1), title)
				Expect(lyrics.ScoreMatch(rec(title, "Main"), meta(title, "Main")).Title).To(Equal(1.0), title)
			}
		})

		It("still keeps different recordings apart", func() {
			for _, title := range []string{"Song feat. Guest (Live)", "Song feat. Guest - Live at Wembley", "Song feat. Guest [Acoustic]"} {
				m := lyrics.ScoreMatch(rec(title, "Main"), meta("Song", "Main"))
				Expect(m.Verified()).To(BeFalse(), title)
			}
			m := lyrics.ScoreMatch(rec("Song feat. Guest (Live)", "Main"), meta("Song (Live)", "Main"))
			Expect(m.Verified()).To(BeTrue(), "the live lyrics for the live recording")
		})

		It("keeps a real part of the title that follows the credit", func() {
			m := lyrics.ScoreMatch(rec("Song feat. Guest (Part 2)", "Main"), meta("Song (Part 2)", "Main"))
			Expect(m.Title).To(Equal(1.0))
		})
	})

	Describe("the duration rule", func() {
		cand := func(id string, q lyrics.Quality, conf, delta float64) lyrics.Candidate {
			return lyrics.Candidate{ID: id, Provider: "fake", Quality: q, Match: lyrics.Match{Confidence: conf, DurationDelta: delta}}
		}

		It("never takes better synchronization from a version of another length", func() {
			// 0.85 is reached with an 8 s difference when title, artist and album agree
			far := cand("k", lyrics.QualityKaraoke, 0.85, 8)
			Expect(far.Match.Verified()).To(BeFalse())
			best, ok := lyrics.Choose([]lyrics.Candidate{far, cand("s", lyrics.QualitySynced, 0.97, 1)}, lyrics.Policy{})
			Expect(ok).To(BeTrue())
			Expect(best.ID).To(Equal("s"))
			Expect(lyrics.Eligible([]lyrics.Candidate{far}, lyrics.Policy{})).To(BeEmpty())
		})

		It("still prefers verified word timing over line timing", func() {
			best, _ := lyrics.Choose([]lyrics.Candidate{
				cand("s", lyrics.QualitySynced, 0.99, 0), cand("k", lyrics.QualityKaraoke, 0.88, 4),
			}, lyrics.Policy{})
			Expect(best.ID).To(Equal("k"))
		})
	})

	Describe("the artist LRCLIB is asked for", func() {
		var (
			srv  *httptest.Server
			mu   sync.Mutex
			asks []string
			// found maps an artist_name to what /api/search answers for it
			found map[string][]map[string]any
		)
		BeforeEach(func() {
			DeferCleanup(configtest.SetupConfig())
			mu.Lock()
			asks, found = nil, map[string][]map[string]any{}
			mu.Unlock()
			srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				artist := r.URL.Query().Get("artist_name")
				mu.Lock()
				asks = append(asks, r.URL.Path+" "+artist)
				items := found[artist]
				mu.Unlock()
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path == "/api/get" {
					w.WriteHeader(http.StatusNotFound)
					return
				}
				if items == nil {
					items = []map[string]any{}
				}
				_ = json.NewEncoder(w).Encode(items)
			}))
			DeferCleanup(srv.Close)
		})
		search := func(r lyrics.Recording) []lyrics.Candidate {
			p := lyrics.NewLRCLIB(srv.URL, true)
			lyrics.FastForTest(p)
			got, err := p.Search(context.Background(), r)
			Expect(err).ToNot(HaveOccurred())
			return got
		}
		searched := func() []string {
			mu.Lock()
			defer mu.Unlock()
			var out []string
			for _, a := range asks {
				if len(a) > 12 && a[:12] == "/api/search " {
					out = append(out, a[12:])
				}
			}
			return out
		}
		item := func(id int, artist string) map[string]any {
			return map[string]any{"id": id, "trackName": "The Boxer", "artistName": artist, "albumName": "Album", "duration": 200, "syncedLyrics": "[00:01.00]line"}
		}

		It("keeps a name that contains &, a comma or a slash", func() {
			for _, artist := range []string{"Simon & Garfunkel", "Earth, Wind & Fire", "AC/DC"} {
				mu.Lock()
				found[artist] = []map[string]any{item(1, artist)}
				mu.Unlock()
				got := search(lyrics.Recording{Title: "The Boxer", Artist: artist, Album: "Album", DurationSec: 200})
				Expect(got).ToNot(BeEmpty(), artist)
				Expect(got[0].Match.Verified()).To(BeTrue(), artist)
			}
			Expect(searched()).To(Equal([]string{"Simon & Garfunkel", "Earth, Wind & Fire", "AC/DC"}), "one search each, with the whole name")
		})

		It("asks for the first of several artists, without the featuring credit", func() {
			conf.Server.Scanner.ArtistJoiner = " • "
			search(lyrics.Recording{Title: "The Boxer", Artist: "Main • Second", Album: "Album", DurationSec: 200})
			search(lyrics.Recording{Title: "The Boxer", Artist: "Main feat. Guest", Album: "Album", DurationSec: 200})
			Expect(searched()).To(Equal([]string{"Main", "Main"}))
		})

		It("tries the first credited name once when the whole credit found nothing", func() {
			mu.Lock()
			found["Main"] = []map[string]any{item(7, "Main")}
			mu.Unlock()
			got := search(lyrics.Recording{Title: "The Boxer", Artist: "Main, Guest", Album: "Album", DurationSec: 200})
			Expect(searched()).To(Equal([]string{"Main, Guest", "Main"}))
			Expect(got).To(HaveLen(1))
			Expect(got[0].ID).To(Equal("lrclib:7"))
		})

		It("does not ask again when the whole name found the recording", func() {
			mu.Lock()
			found["Main, Guest"] = []map[string]any{item(8, "Main, Guest")}
			mu.Unlock()
			search(lyrics.Recording{Title: "The Boxer", Artist: "Main, Guest", Album: "Album", DurationSec: 200})
			Expect(searched()).To(Equal([]string{"Main, Guest"}))
		})
	})
	Describe("cases measured on real recordings", func() {
		at := func(title, artist string, secs float64) lyrics.Recording {
			return lyrics.Recording{Title: title, Artist: artist, Album: "Album", DurationSec: secs}
		}
		as := func(title, artist string, secs float64) lyrics.Meta {
			return lyrics.Meta{Title: title, Artist: artist, DurationSec: secs}
		}

		It("keeps a featuring credit inside brackets to the bracket rules", func() {
			// Before, the credit was cut with the closing bracket: "Get Lucky (Radio Edit -"
			m := lyrics.ScoreMatch(at("Get Lucky (Radio Edit - feat. Pharrell Williams and Nile Rodgers)", "Daft Punk", 248),
				as("Get Lucky (Radio Edit)", "Daft Punk, Pharrell Williams", 248))
			Expect(m.Title).To(Equal(1.0))
			Expect(m.Verified()).To(BeTrue())
		})

		It("reads traditional and simplified Chinese as the same names", func() {
			m := lyrics.ScoreMatch(at("婚禮的祝福", "陳奕迅", 261), as("婚礼的祝福", "陈奕迅", 261))
			Expect(m.Title).To(Equal(1.0))
			Expect(m.Artist).To(Equal(1.0))
			Expect(m.Verified()).To(BeTrue())
			Expect(lyrics.ScoreMatch(at("她說", "林俊傑", 318), as("她说", "林俊杰", 320)).Verified()).To(BeTrue())
			// and different songs stay different
			Expect(lyrics.ScoreMatch(at("婚禮的祝福", "陳奕迅", 261), as("十年", "陈奕迅", 261)).Verified()).To(BeFalse())
		})

		It("folds only what has one simplified form, and leaves kana and hangul alone", func() {
			Expect(lyrics.SimplifiedHanForTest("陳奕迅 婚禮的祝福 說 鄧紫棋 臺灣")).To(Equal("陈奕迅 婚礼的祝福 说 邓紫棋 台湾"))
			Expect(lyrics.SimplifiedHanForTest("乾")).To(Equal("乾"), "乾 may stay 乾 or become 干: not guessed")
			Expect(lyrics.SimplifiedHanForTest("夜に駆ける 강남스타일 Hello")).To(Equal("夜に駆ける 강남스타일 Hello"))
			Expect(lyrics.HanTableSizeForTest()).To(BeNumerically(">", 6000))
			Expect(lyrics.SimplifiedHanForTest("\U00033446")).To(Equal("\U0002A38F"), "characters outside the BMP are read from the table")
		})

		It("knows an artist by the other name written in brackets", func() {
			Expect(lyrics.ScoreMatch(at("Dynamite", "BTS", 199), as("Dynamite", "BTS (防弹少年团)", 199)).Artist).To(Equal(1.0))
			Expect(lyrics.ScoreMatch(at("Dynamite", "防弹少年团", 199), as("Dynamite", "BTS (防弹少年团)", 199)).Artist).To(Equal(1.0))
			Expect(lyrics.ScoreMatch(at("紅蓮華", "LiSA", 236), as("紅蓮華", "LiSA (織部里沙)", 236)).Verified()).To(BeTrue())
			Expect(lyrics.ScoreMatch(at("Dynamite", "Taio Cruz", 202), as("Dynamite", "BTS (防弹少年团)", 202)).Verified()).To(BeFalse())
		})

		It("accepts a subtitle or a note on one side only when the lengths agree", func() {
			Expect(lyrics.ScoreMatch(at("MALAMENTE", "ROSALÍA", 149), as("MALAMENTE (Cap.1: Augurio)", "ROSALÍA", 150)).Verified()).To(BeTrue())
			Expect(lyrics.ScoreMatch(at("任性（电视剧《难哄》主题曲）", "五月天", 265), as("任性", "五月天", 265)).Verified()).To(BeTrue())
			// another part of a song lasts another time
			Expect(lyrics.ScoreMatch(at("Song", "Band", 200), as("Song (Part 2)", "Band", 245)).Verified()).To(BeFalse())
			Expect(lyrics.ScoreMatch(at("Song", "Band", 200), as("Song (Part 2)", "Band", 0)).Verified()).To(BeFalse(), "an unknown length is not agreement")
			// a version is still another recording
			Expect(lyrics.ScoreMatch(at("Song", "Band", 200), as("Song (Live)", "Band", 200)).Verified()).To(BeFalse())
		})

		It("does not take a title with words added for the song", func() {
			// NetEase listed "Despacito 缓缓", a Chinese cover, as verified at 0.91
			m := lyrics.ScoreMatch(at("Despacito", "Luis Fonsi", 228), as("Despacito 缓缓", "Luis Fonsi, 林俊杰", 229))
			Expect(m.Verified()).To(BeFalse())
			Expect(lyrics.ScoreMatch(at("Hello", "Adele", 295), as("Hello Goodbye", "Adele", 295)).Verified()).To(BeFalse())
			// an article more or less is the same title
			Expect(lyrics.ScoreMatch(at("The Sound Of Silence", "Simon & Garfunkel", 183), as("Sound of Silence", "Simon & Garfunkel", 183)).Verified()).To(BeTrue())
			// a note in brackets, with the same length, still is the song
			Expect(lyrics.ScoreMatch(at("Gangnam Style (강남스타일)", "Psy", 219), as("Gangnam Style", "PSY", 219)).Verified()).To(BeTrue())
		})

		It("asks keyword searches for the bare title, in simplified Chinese unless it is Japanese", func() {
			for _, c := range []struct{ title, artist, wantTitle, wantArtist string }{
				{"任性（电视剧《难哄》主题曲）", "五月天", "任性", "五月天"},
				{"婚禮的祝福", "陳奕迅", "婚礼的祝福", "陈奕迅"},
				{"紅蓮華", "LiSA", "红莲华", "LiSA"},
				{"夜に駆ける", "YOASOBI", "夜に駆ける", "YOASOBI"},
				{"Get Lucky (Radio Edit - feat. Pharrell Williams)", "Daft Punk", "Get Lucky", "Daft Punk"},
				{"Song feat. Guest - Live at Wembley", "Main ft. Guest", "Song", "Main"},
				{"(What's the Story) Morning Glory?", "Oasis", "Morning Glory?", "Oasis"},
			} {
				title, artist := lyrics.SearchTermsForTest(lyrics.Recording{Title: c.title, Artist: c.artist})
				Expect([]string{title, artist}).To(Equal([]string{c.wantTitle, c.wantArtist}), c.title)
			}
		})
	})
})
