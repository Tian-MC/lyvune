package lyrics_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"time"

	"github.com/navidrome/navidrome/core/lyrics"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

const wordSyncFile = `version: '1.0'
metadata:
  title: 'Song'
  artist: 'Band'
  language: 'eng'
lines:
  - text: "Hello world"
    start_ms: 1000
    end_ms: 3000
    words:
      - text: "Hello "
        start_ms: 1000
        end_ms: 1500
      - text: "world"
        start_ms: 1500
        end_ms: 3000
`

const lineSyncFile = `version: '1.0'
metadata:
  title: 'Song'
  artist: 'Band'
lines:
  - text: "Hello world"
    start_ms: 1000
`

func item(id int, over map[string]any) map[string]any {
	base := map[string]any{
		"id": id, "name": "Song", "trackName": "Song", "artistName": "Band", "albumName": "Album",
		"duration": 200.0, "instrumental": false, "hasWordSync": false,
		"plainLyrics": "Hello world\nSecond line", "syncedLyrics": "[00:01.00] Hello world\n[00:03.00] Second line",
		"lyricsfile": lineSyncFile,
	}
	for k, v := range over {
		base[k] = v
	}
	return base
}

var _ = Describe("LRCLIB provider", func() {
	var (
		srv      *httptest.Server
		handler  http.HandlerFunc
		requests []*http.Request
		p        lyrics.OnlineProvider
		rec      = lyrics.Recording{Title: "Song", Artist: "Band", Album: "Album", DurationSec: 200}
	)

	serve := func(h http.HandlerFunc) {
		handler = h
		srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			requests = append(requests, r.Clone(context.Background()))
			handler(w, r)
		}))
		p = lyrics.NewLRCLIB(srv.URL, true)
		lyrics.FastForTest(p)
	}
	writeJSON := func(w http.ResponseWriter, status int, v any) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(v)
	}

	BeforeEach(func() { requests = nil })
	AfterEach(func() {
		if srv != nil {
			srv.Close()
		}
	})

	It("reports itself as ready and verified, with word sync support", func() {
		serve(func(http.ResponseWriter, *http.Request) {})
		info := p.Info()
		Expect(info.Status).To(Equal(lyrics.StatusReady))
		Expect(info.Verified).To(BeTrue())
		Expect(info.WordSync).To(BeTrue())
		Expect(info.Storable).To(BeTrue())
	})

	It("identifies itself with a descriptive User-Agent", func() {
		serve(func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 404, map[string]any{}) })
		_, _ = p.Search(context.Background(), rec)
		Expect(requests).ToNot(BeEmpty())
		Expect(requests[0].Header.Get("User-Agent")).To(HavePrefix("NavidromeReimagined/"))
		Expect(requests[0].Header.Get("User-Agent")).To(ContainSubstring("github.com"))
	})

	It("tries the exact lookup first, with the rounded duration, then searches", func() {
		serve(func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case "/api/get":
				q := r.URL.Query()
				Expect(q.Get("track_name")).To(Equal("Song"))
				Expect(q.Get("artist_name")).To(Equal("Band"))
				Expect(q.Get("album_name")).To(Equal("Album"))
				Expect(q.Get("duration")).To(Equal("200"))
				writeJSON(w, 200, item(1, nil))
			case "/api/search":
				writeJSON(w, 200, []any{item(1, nil), item(2, map[string]any{"albumName": "Other"})})
			}
		})
		got, err := p.Search(context.Background(), rec)
		Expect(err).ToNot(HaveOccurred())
		Expect(got).To(HaveLen(2), "the exact result is not repeated by the search")
		Expect(got[0].ID).To(Equal("lrclib:1"))
		Expect(got[1].ID).To(Equal("lrclib:2"))
	})

	It("still searches when the exact lookup finds nothing", func() {
		serve(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/api/get" {
				writeJSON(w, 404, map[string]any{"statusCode": 404, "name": "TrackNotFound"})
				return
			}
			writeJSON(w, 200, []any{item(7, nil)})
		})
		got, err := p.Search(context.Background(), rec)
		Expect(err).ToNot(HaveOccurred())
		Expect(got).To(HaveLen(1))
	})

	It("skips the exact lookup when the album or duration is unknown", func() {
		serve(func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, []any{}) })
		_, _ = p.Search(context.Background(), lyrics.Recording{Title: "Song", Artist: "Band"})
		for _, r := range requests {
			Expect(r.URL.Path).To(Equal("/api/search"))
		}
	})

	It("queries with the clean title and the first artist", func() {
		serve(func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, []any{}) })
		_, _ = p.Search(context.Background(), lyrics.Recording{Title: "Song (feat. X) [2011 Remaster]", Artist: "Band feat. X", DurationSec: 1})
		Expect(requests[0].URL.Query().Get("track_name")).To(Equal("Song"))
		Expect(requests[0].URL.Query().Get("artist_name")).To(Equal("Band"))
	})

	Describe("choosing the lyrics inside a result", func() {
		search := func(it map[string]any) lyrics.Candidate {
			serve(func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, []any{it}) })
			got, err := p.Search(context.Background(), lyrics.Recording{Title: "Song", Artist: "Band"})
			Expect(err).ToNot(HaveOccurred())
			Expect(got).To(HaveLen(1))
			return got[0]
		}

		It("returns karaoke when the Lyricsfile has real word timing", func() {
			c := search(item(1, map[string]any{"hasWordSync": true, "lyricsfile": wordSyncFile}))
			Expect(c.Quality).To(Equal(lyrics.QualityKaraoke))
			Expect(c.Lyrics[0].Line[0].Cue).To(HaveLen(2))
		})

		It("returns synced lyrics when there is only line timing", func() {
			c := search(item(1, nil))
			Expect(c.Quality).To(Equal(lyrics.QualitySynced))
		})

		It("never invents word timing from line timing", func() {
			c := search(item(1, map[string]any{"hasWordSync": false}))
			Expect(c.Quality).ToNot(Equal(lyrics.QualityKaraoke))
			for _, l := range c.Lyrics {
				for _, line := range l.Line {
					Expect(line.Cue).To(BeEmpty())
				}
			}
		})

		It("falls back to the LRC when the Lyricsfile is unusable", func() {
			c := search(item(1, map[string]any{"lyricsfile": "::: not yaml :::"}))
			Expect(c.Quality).To(Equal(lyrics.QualitySynced))
		})

		It("falls back to plain text when nothing is timed", func() {
			c := search(item(1, map[string]any{"lyricsfile": "", "syncedLyrics": ""}))
			Expect(c.Quality).To(Equal(lyrics.QualityPlain))
		})

		It("reports instrumental tracks without lyrics", func() {
			c := search(item(1, map[string]any{"instrumental": true, "plainLyrics": "", "syncedLyrics": "", "lyricsfile": ""}))
			Expect(c.Meta.Instrumental).To(BeTrue())
			Expect(c.Quality).To(Equal(lyrics.QualityNone))
			_, ok := lyrics.Choose([]lyrics.Candidate{c}, lyrics.Policy{})
			Expect(ok).To(BeFalse())
		})

		It("scores each result against the recording", func() {
			serve(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/get" {
					writeJSON(w, 404, map[string]any{})
					return
				}
				writeJSON(w, 200, []any{
					item(1, nil),
					item(2, map[string]any{"trackName": "Song (Live)", "duration": 200.0}),
					item(3, map[string]any{"artistName": "Someone Else"}),
				})
			})
			got, _ := p.Search(context.Background(), rec)
			Expect(got).To(HaveLen(3))
			Expect(got[0].Match.Verified()).To(BeTrue())
			Expect(got[1].Match.Verified()).To(BeFalse(), "the live version is not trusted")
			Expect(got[2].Match.Verified()).To(BeFalse(), "another artist is not trusted")
			Expect(got[0].Storable).To(BeTrue())
			Expect(got[0].Source).To(Equal(lyrics.SourceRemote))
		})
	})

	Describe("failures", func() {
		It("honours Retry-After on 429 and stops asking during the cool-down", func() {
			var hits atomic.Int32
			serve(func(w http.ResponseWriter, r *http.Request) {
				hits.Add(1)
				w.Header().Set("Retry-After", "30")
				w.WriteHeader(429)
			})
			_, err := p.Search(context.Background(), lyrics.Recording{Title: "Song", Artist: "Band"})
			var rl *lyrics.RateLimitedError
			Expect(errors.As(err, &rl)).To(BeTrue())
			Expect(rl.RetryAfter).To(Equal(30 * time.Second))

			before := hits.Load()
			_, err = p.Search(context.Background(), lyrics.Recording{Title: "Song", Artist: "Band"})
			Expect(errors.As(err, &rl)).To(BeTrue())
			Expect(hits.Load()).To(Equal(before), "no request during the cool-down")
		})

		It("still searches when the exact lookup returns garbage", func() {
			serve(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/get" {
					_, _ = w.Write([]byte("{broken"))
					return
				}
				writeJSON(w, 200, []any{item(5, nil)})
			})
			got, err := p.Search(context.Background(), rec)
			Expect(err).ToNot(HaveOccurred())
			Expect(got).To(HaveLen(1))
			Expect(got[0].ID).To(Equal("lrclib:5"))
		})

		It("retries a busy server and succeeds", func() {
			var hits atomic.Int32
			serve(func(w http.ResponseWriter, r *http.Request) {
				if hits.Add(1) < 3 {
					writeJSON(w, 503, map[string]any{"name": "ServerOverloaded", "statusCode": 503})
					return
				}
				writeJSON(w, 200, []any{item(1, nil)})
			})
			got, err := p.Search(context.Background(), lyrics.Recording{Title: "Song", Artist: "Band"})
			Expect(err).ToNot(HaveOccurred())
			Expect(got).To(HaveLen(1))
			Expect(hits.Load()).To(Equal(int32(3)))
		})

		It("gives up after a bounded number of attempts", func() {
			var hits atomic.Int32
			serve(func(w http.ResponseWriter, r *http.Request) { hits.Add(1); w.WriteHeader(503) })
			_, err := p.Search(context.Background(), lyrics.Recording{Title: "Song", Artist: "Band"})
			Expect(err).To(MatchError(lyrics.ErrProviderUnavailable))
			Expect(hits.Load()).To(Equal(int32(3)))
		})

		It("does not retry a client error", func() {
			var hits atomic.Int32
			serve(func(w http.ResponseWriter, r *http.Request) { hits.Add(1); w.WriteHeader(400) })
			_, err := p.Search(context.Background(), lyrics.Recording{Title: "Song", Artist: "Band"})
			Expect(err).To(MatchError(lyrics.ErrProviderUnavailable))
			Expect(hits.Load()).To(Equal(int32(1)))
		})

		It("survives malformed JSON", func() {
			serve(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("{not json")) })
			_, err := p.Search(context.Background(), lyrics.Recording{Title: "Song", Artist: "Band"})
			Expect(err).To(MatchError(lyrics.ErrProviderUnavailable))
		})

		It("returns nothing for an empty answer", func() {
			serve(func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, []any{}) })
			got, err := p.Search(context.Background(), lyrics.Recording{Title: "Song", Artist: "Band"})
			Expect(err).ToNot(HaveOccurred())
			Expect(got).To(BeEmpty())
		})

		It("times out a stalled server", func() {
			serve(func(w http.ResponseWriter, r *http.Request) { time.Sleep(time.Second) })
			start := time.Now()
			_, err := p.Search(context.Background(), lyrics.Recording{Title: "Song", Artist: "Band"})
			Expect(err).To(HaveOccurred())
			Expect(time.Since(start)).To(BeNumerically("<", 3*time.Second))
		})

		It("stops when the context is cancelled", func() {
			serve(func(w http.ResponseWriter, r *http.Request) { time.Sleep(time.Second) })
			ctx, cancel := context.WithCancel(context.Background())
			go func() { time.Sleep(30 * time.Millisecond); cancel() }()
			_, err := p.Search(ctx, lyrics.Recording{Title: "Song", Artist: "Band"})
			Expect(err).To(HaveOccurred())
		})

		It("ignores a huge response instead of loading it all", func() {
			serve(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(200)
				_, _ = w.Write([]byte("["))
				chunk := []byte(strings.Repeat("x", 1<<20))
				for i := 0; i < 8; i++ {
					_, _ = w.Write(chunk)
				}
			})
			_, err := p.Search(context.Background(), lyrics.Recording{Title: "Song", Artist: "Band"})
			Expect(err).To(HaveOccurred())
		})

		It("is disabled without a request when turned off", func() {
			serve(func(w http.ResponseWriter, r *http.Request) {})
			off := lyrics.NewLRCLIB(srv.URL, false)
			Expect(off.Info().Status).To(Equal(lyrics.StatusDisabled))
			_, err := off.Search(context.Background(), rec)
			Expect(err).To(MatchError(lyrics.ErrProviderDisabled))
			Expect(requests).To(BeEmpty())
		})
	})
})
