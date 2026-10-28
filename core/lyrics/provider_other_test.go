package lyrics_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"

	"github.com/Tian-MC/lyvune/core/lyrics"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("Musixmatch provider", func() {
	rec := lyrics.Recording{Title: "Song", Artist: "Band", Album: "Album", DurationSec: 200}
	var (
		srv  *httptest.Server
		urls []string
	)

	reply := func(status int, body any) map[string]any {
		return map[string]any{"message": map[string]any{"header": map[string]any{"status_code": status}, "body": body}}
	}
	track := func(over map[string]any) map[string]any {
		t := map[string]any{
			"track_id": 42, "track_name": "Song", "artist_name": "Band", "album_name": "Album", "track_length": 200,
			"instrumental": 0, "has_lyrics": 1, "has_subtitles": 1, "has_richsync": 0,
		}
		for k, v := range over {
			t[k] = v
		}
		return reply(200, map[string]any{"track": t})
	}
	serve := func(store bool, h func(method string, w http.ResponseWriter)) lyrics.OnlineProvider {
		srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			urls = append(urls, r.URL.String())
			h(r.URL.Path[len("/"):], w)
		}))
		p := lyrics.NewMusixmatch(srv.URL, "SECRETKEY")
		lyrics.FastForTest(p)
		return p
	}
	write := func(w http.ResponseWriter, v any) { _ = json.NewEncoder(w).Encode(v) }
	const richsync = `[{"ts":1.0,"te":3.0,"l":[{"c":"Hel","o":0},{"c":"lo","o":0.4},{"c":" ","o":0.8},{"c":"world","o":1.0}],"x":"Hello world"}]`

	BeforeEach(func() { urls = nil })
	AfterEach(func() {
		if srv != nil {
			srv.Close()
			srv = nil
		}
	})

	It("asks for credentials and makes no request without an API key", func() {
		p := lyrics.NewMusixmatch("http://127.0.0.1:1", "")
		Expect(p.Info().Status).To(Equal(lyrics.StatusNeedsCredentials))
		_, err := p.Search(context.Background(), rec)
		Expect(err).To(MatchError(lyrics.ErrProviderDisabled))
	})

	It("is honest that it is unverified, claims no word timing, and stores only when allowed", func() {
		info := lyrics.NewMusixmatch("", "key").Info()
		Expect(info.Verified).To(BeFalse())
		Expect(info.Storable).To(BeFalse())
		Expect(info.WordSync).To(BeFalse())
	})

	It("scores the match on the metadata Musixmatch returns", func() {
		p := serve(false, func(method string, w http.ResponseWriter) {
			switch method {
			case "matcher.track.get":
				write(w, track(map[string]any{"track_name": "Other Song", "artist_name": "Someone Else", "track_length": 90}))
			default:
				write(w, reply(404, []any{}))
			}
		})
		got, err := p.Search(context.Background(), rec)
		Expect(err).ToNot(HaveOccurred())
		Expect(got).To(BeEmpty(), "a different recording is not offered")
		Expect(urls).To(HaveLen(1), "no lyrics are fetched for a rejected match")
	})

	It("prefers real word timing (RichSync) over line timing, without inventing end times", func() {
		p := serve(true, func(method string, w http.ResponseWriter) {
			switch method {
			case "matcher.track.get":
				write(w, track(map[string]any{"has_richsync": 1}))
			case "track.richsync.get":
				write(w, reply(200, map[string]any{"richsync": map[string]any{"richsync_body": richsync}}))
			default:
				Fail("only the richsync call is needed: " + method)
			}
		})
		got, err := p.Search(context.Background(), rec)
		Expect(err).ToNot(HaveOccurred())
		Expect(got).To(HaveLen(1))
		Expect(got[0].Quality).To(Equal(lyrics.QualityKaraoke))
		Expect(got[0].Match.Verified()).To(BeTrue())
		line := got[0].Lyrics[0].Line[0]
		Expect(line.Cue).To(HaveLen(3), "the lone space is not a cue of its own")
		Expect(*line.Cue[0].Start).To(Equal(int64(1000)))
		Expect(line.Cue[0].End).To(BeNil(), "only the last word has a source end time")
		Expect(*line.Cue[2].End).To(Equal(int64(3000)))
	})

	It("falls back to synced, then plain, lyrics", func() {
		p := serve(false, func(method string, w http.ResponseWriter) {
			switch method {
			case "matcher.track.get":
				write(w, track(nil))
			case "track.subtitle.get":
				write(w, reply(200, map[string]any{"subtitle": map[string]any{"subtitle_body": "[00:01.00] Hello world\n[00:03.00] Second line"}}))
			default:
				Fail("unexpected " + method)
			}
		})
		got, err := p.Search(context.Background(), rec)
		Expect(err).ToNot(HaveOccurred())
		Expect(got).To(HaveLen(1))
		Expect(got[0].Quality).To(Equal(lyrics.QualitySynced))

		p2 := serve(false, func(method string, w http.ResponseWriter) {
			switch method {
			case "matcher.track.get":
				write(w, track(map[string]any{"has_subtitles": 0}))
			case "track.lyrics.get":
				write(w, reply(200, map[string]any{"lyrics": map[string]any{"lyrics_body": "Hello world", "lyrics_copyright": "Lyrics powered by Musixmatch"}}))
			}
		})
		got, err = p2.Search(context.Background(), rec)
		Expect(err).ToNot(HaveOccurred())
		Expect(got).To(HaveLen(1))
		Expect(got[0].Quality).To(Equal(lyrics.QualityPlain))
		Expect(got[0].Attribution).To(Equal("Lyrics powered by Musixmatch"))
	})

	It("skips a call the plan does not include instead of disabling itself", func() {
		p := serve(false, func(method string, w http.ResponseWriter) {
			switch method {
			case "matcher.track.get":
				write(w, track(map[string]any{"has_richsync": 1}))
			case "track.richsync.get":
				write(w, reply(403, []any{}))
			case "track.subtitle.get":
				write(w, reply(200, map[string]any{"subtitle": map[string]any{"subtitle_body": "[00:01.00] Hello world"}}))
			}
		})
		got, err := p.Search(context.Background(), rec)
		Expect(err).ToNot(HaveOccurred())
		Expect(got).To(HaveLen(1))
		Expect(got[0].Quality).To(Equal(lyrics.QualitySynced))
	})

	It("discards the cut-down lyrics of free keys", func() {
		p := serve(false, func(method string, w http.ResponseWriter) {
			switch method {
			case "matcher.track.get":
				write(w, track(map[string]any{"has_subtitles": 0}))
			case "track.lyrics.get":
				write(w, reply(200, map[string]any{"lyrics": map[string]any{"lyrics_body": "Hello...\n\n******* This Lyrics is NOT for Commercial use *******"}}))
			}
		})
		got, err := p.Search(context.Background(), rec)
		Expect(err).ToNot(HaveOccurred())
		Expect(got).To(BeEmpty())
	})

	It("reports an instrumental track without lyrics", func() {
		p := serve(false, func(method string, w http.ResponseWriter) { write(w, track(map[string]any{"instrumental": 1})) })
		got, err := p.Search(context.Background(), rec)
		Expect(err).ToNot(HaveOccurred())
		Expect(got).To(HaveLen(1))
		Expect(got[0].Meta.Instrumental).To(BeTrue())
		Expect(got[0].Quality).To(Equal(lyrics.QualityNone))
	})

	It("returns nothing when there is no match", func() {
		p := serve(false, func(method string, w http.ResponseWriter) { write(w, reply(404, []any{})) })
		got, err := p.Search(context.Background(), rec)
		Expect(err).ToNot(HaveOccurred())
		Expect(got).To(BeEmpty())
	})

	It("turns a refused key into a disabled provider", func() {
		p := serve(false, func(method string, w http.ResponseWriter) { write(w, reply(401, []any{})) })
		_, err := p.Search(context.Background(), rec)
		Expect(err).To(MatchError(lyrics.ErrProviderDisabled))
	})

	It("reports a rate limit", func() {
		p := serve(false, func(method string, w http.ResponseWriter) { w.Header().Set("Retry-After", "20"); w.WriteHeader(429) })
		_, err := p.Search(context.Background(), rec)
		var rl *lyrics.RateLimitedError
		Expect(err).To(HaveOccurred())
		Expect(err).To(BeAssignableToTypeOf(rl))
	})

	It("keeps the API key out of errors", func() {
		p := serve(false, func(method string, w http.ResponseWriter) {})
		srv.Close()
		_, err := p.Search(context.Background(), rec)
		Expect(err).To(HaveOccurred())
		Expect(err.Error()).ToNot(ContainSubstring("SECRETKEY"))
	})

	It("never exposes the key through its info", func() {
		raw, _ := json.Marshal(lyrics.NewMusixmatch("", "SECRETKEY").Info())
		Expect(string(raw)).ToNot(ContainSubstring("SECRETKEY"))
	})
})
