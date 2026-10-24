package lyrics_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"

	"github.com/navidrome/navidrome/core/lyrics"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("Musixmatch provider", func() {
	rec := lyrics.Recording{Title: "Song", Artist: "Band", DurationSec: 200}
	var (
		srv  *httptest.Server
		urls []string
	)

	reply := func(status int, body any) map[string]any {
		return map[string]any{"message": map[string]any{"header": map[string]any{"status_code": status}, "body": body}}
	}
	serve := func(h func(method string, w http.ResponseWriter)) lyrics.OnlineProvider {
		srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			urls = append(urls, r.URL.String())
			h(r.URL.Path[len("/"):], w)
		}))
		p := lyrics.NewMusixmatch(srv.URL, "SECRETKEY")
		lyrics.FastForTest(p)
		return p
	}
	write := func(w http.ResponseWriter, v any) { _ = json.NewEncoder(w).Encode(v) }

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

	It("is honest that it is unverified and cannot store lyrics", func() {
		info := lyrics.NewMusixmatch("", "key").Info()
		Expect(info.Verified).To(BeFalse())
		Expect(info.Storable).To(BeFalse())
		Expect(info.WordSync).To(BeFalse())
	})

	It("offers synced lyrics for manual selection, never as a stored or verified match", func() {
		p := serve(func(method string, w http.ResponseWriter) {
			switch method {
			case "matcher.lyrics.get":
				write(w, reply(200, map[string]any{"lyrics": map[string]any{
					"lyrics_body": "Hello world\nSecond line", "lyrics_language": "en", "lyrics_copyright": "Lyrics powered by Musixmatch",
				}}))
			case "matcher.subtitle.get":
				write(w, reply(200, map[string]any{"subtitle": map[string]any{"subtitle_body": "[00:01.00] Hello world\n[00:03.00] Second line"}}))
			}
		})
		got, err := p.Search(context.Background(), rec)
		Expect(err).ToNot(HaveOccurred())
		Expect(got).To(HaveLen(1))
		c := got[0]
		Expect(c.Quality).To(Equal(lyrics.QualitySynced))
		Expect(c.Storable).To(BeFalse())
		Expect(c.Attribution).To(Equal("Lyrics powered by Musixmatch"))
		Expect(c.Match.Verified()).To(BeFalse())
		Expect(c.Match.Listed()).To(BeTrue())
		Expect(c.Match.Mismatch).To(ContainElement("unverified-match"))

		_, auto := lyrics.Choose(got, lyrics.Policy{})
		Expect(auto).To(BeFalse(), "never chosen automatically")
	})

	It("falls back to plain lyrics when synced lyrics are not in the plan", func() {
		p := serve(func(method string, w http.ResponseWriter) {
			switch method {
			case "matcher.lyrics.get":
				write(w, reply(200, map[string]any{"lyrics": map[string]any{"lyrics_body": "Hello world"}}))
			default:
				write(w, reply(401, []any{}))
			}
		})
		got, err := p.Search(context.Background(), rec)
		Expect(err).ToNot(HaveOccurred())
		Expect(got).To(HaveLen(1))
		Expect(got[0].Quality).To(Equal(lyrics.QualityPlain))
	})

	It("never asks for word-level (richsync) lyrics", func() {
		p := serve(func(method string, w http.ResponseWriter) { write(w, reply(404, []any{})) })
		_, _ = p.Search(context.Background(), rec)
		for _, u := range urls {
			Expect(u).ToNot(ContainSubstring("richsync"))
		}
	})

	It("returns nothing when there is no match", func() {
		p := serve(func(method string, w http.ResponseWriter) { write(w, reply(404, []any{})) })
		got, err := p.Search(context.Background(), rec)
		Expect(err).ToNot(HaveOccurred())
		Expect(got).To(BeEmpty())
	})

	It("turns a refused key into a disabled provider", func() {
		p := serve(func(method string, w http.ResponseWriter) { write(w, reply(401, []any{})) })
		_, err := p.Search(context.Background(), rec)
		Expect(err).To(MatchError(lyrics.ErrProviderDisabled))
	})

	It("reports a rate limit", func() {
		p := serve(func(method string, w http.ResponseWriter) { w.Header().Set("Retry-After", "20"); w.WriteHeader(429) })
		_, err := p.Search(context.Background(), rec)
		var rl *lyrics.RateLimitedError
		Expect(err).To(HaveOccurred())
		Expect(err).To(BeAssignableToTypeOf(rl))
	})

	It("keeps the API key out of errors", func() {
		p := serve(func(method string, w http.ResponseWriter) {})
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

var _ = Describe("providers without an authorized API", func() {
	DescribeTable("say so honestly and never search",
		func(p lyrics.OnlineProvider) {
			info := p.Info()
			Expect(info.Status).To(Equal(lyrics.StatusUnavailable))
			Expect(info.Reason).ToNot(BeEmpty())
			Expect(info.Verified).To(BeFalse())
			Expect(info.Plain || info.Synced || info.WordSync || info.Storable).To(BeFalse(), "no capability is claimed")
			got, err := p.Search(context.Background(), lyrics.Recording{Title: "Song", Artist: "Band"})
			Expect(err).To(MatchError(lyrics.ErrProviderUnavailable))
			Expect(got).To(BeEmpty())
		},
		Entry("KuGou", lyrics.NewKuGou()),
		Entry("NetEase", lyrics.NewNetEase()),
		Entry("Apple Music", lyrics.NewAppleMusic()),
	)

	It("explains why Apple Music is not used", func() {
		Expect(lyrics.NewAppleMusic().Info().Reason).To(ContainSubstring("hasLyrics"))
	})
})
