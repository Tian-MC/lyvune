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
})
