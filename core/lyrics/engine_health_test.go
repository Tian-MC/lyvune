package lyrics_test

import (
	"context"
	"time"

	"github.com/navidrome/navidrome/conf"
	"github.com/navidrome/navidrome/conf/configtest"
	"github.com/navidrome/navidrome/core/lyrics"
	"github.com/navidrome/navidrome/model"
	"github.com/navidrome/navidrome/tests"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("Provider status", func() {
	var (
		clock  time.Time
		engine lyrics.Engine
		a, b   *fakeProvider
	)

	statusOf := func(id string) lyrics.ProviderStatus {
		for _, p := range engine.Providers(context.Background()) {
			if p.ID == id {
				return p
			}
		}
		Fail("no provider " + id)
		return lyrics.ProviderStatus{}
	}

	BeforeEach(func() {
		DeferCleanup(configtest.SetupConfig())
		conf.Server.LyricsPriority = ".lrc,embedded"
		clock = time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)
		a, b = newFake("alpha"), newFake("beta")
		for _, f := range []*fakeProvider{a, b} {
			f.info.Implemented, f.info.Configured, f.info.Auth = true, true, lyrics.AuthNone
		}
		svc := lyrics.NewService(lyrics.Options{
			DataStore: &tests.MockDataStore{MockedProperty: &safeProps{}},
			Providers: lyrics.NewProviders(a, b),
			Store:     lyrics.NewStore(GinkgoT().TempDir(), 10),
			Now:       func() time.Time { return clock },
		})
		engine = lyrics.EngineOf(svc)
		_, err := engine.SaveSettings(context.Background(), lyrics.Settings{Providers: []string{"alpha", "beta"}, MinConfidence: 0.85})
		Expect(err).ToNot(HaveOccurred())
	})

	It("starts with nothing claimed: implemented and configured, but not seen working", func() {
		st := statusOf("alpha")
		Expect(st.Implemented && st.Configured).To(BeTrue())
		Expect(st.LiveVerified).To(BeFalse())
		Expect(st.KaraokeVerified).To(BeFalse())
		Expect(st.LastSuccess).To(BeNil())
		Expect(st.Availability).To(Equal(lyrics.AvailabilityAvailable))
	})

	It("marks a provider live-verified after an answer, and karaoke-verified only for a verified match with word timing", func() {
		a.set(remote("alpha", "1", karaokeOf("x"), 0.99))
		b.set(remote("beta", "1", syncedOf("y"), 0.99))
		got := engine.CheckProviders(context.Background())
		Expect(got).ToNot(BeEmpty())

		sa, sb := statusOf("alpha"), statusOf("beta")
		Expect(sa.LiveVerified && sb.LiveVerified).To(BeTrue())
		Expect(*sa.LastSuccess).To(Equal(clock))
		Expect(sa.KaraokeVerified).To(BeTrue())
		Expect(sb.KaraokeVerified).To(BeFalse(), "line timing is not karaoke")
	})

	It("does not count karaoke from a doubtful match", func() {
		a.set(remote("alpha", "1", karaokeOf("x"), 0.5))
		engine.CheckProviders(context.Background())
		Expect(statusOf("alpha").KaraokeVerified).To(BeFalse())
	})

	It("tells an outage apart from a missing implementation", func() {
		a.mu.Lock()
		a.err = lyrics.ErrProviderUnavailable
		a.mu.Unlock()
		engine.CheckProviders(context.Background())
		st := statusOf("alpha")
		Expect(st.Availability).To(Equal(lyrics.AvailabilityTemporarily))
		Expect(st.Implemented).To(BeTrue(), "an outage does not make it unimplemented")
		Expect(st.LastError).ToNot(BeEmpty())
		Expect(st.LastFailure).ToNot(BeNil())

		// and it recovers on the next answer
		a.set()
		clock = clock.Add(time.Minute)
		engine.CheckProviders(context.Background())
		Expect(statusOf("alpha").Availability).To(Equal(lyrics.AvailabilityAvailable))
	})

	It("reports a rate limit with its end", func() {
		a.mu.Lock()
		a.err = &lyrics.RateLimitedError{Provider: "alpha", RetryAfter: 90 * time.Second}
		a.mu.Unlock()
		engine.CheckProviders(context.Background())
		st := statusOf("alpha")
		Expect(st.Availability).To(Equal(lyrics.AvailabilityRateLimited))
		Expect(*st.RateLimitedUntil).To(Equal(clock.Add(90 * time.Second)))
		clock = clock.Add(2 * time.Minute)
		Expect(statusOf("alpha").Availability).To(Equal(lyrics.AvailabilityTemporarily), "the limit has passed; the last answer was still a failure")
	})

	It("separates turned off, needs a key and not available", func() {
		_, err := engine.SaveSettings(context.Background(), lyrics.Settings{Providers: []string{"alpha"}, MinConfidence: 0.85})
		Expect(err).ToNot(HaveOccurred())
		Expect(statusOf("beta").Availability).To(Equal(lyrics.AvailabilityOff))

		b.info.Status = lyrics.StatusNeedsCredentials
		Expect(statusOf("beta").Availability).To(Equal(lyrics.AvailabilityNeedsKey))
		b.info.Status = lyrics.StatusUnavailable
		Expect(statusOf("beta").Availability).To(Equal(lyrics.AvailabilityNotUsable))
	})

	Describe("permission to save", func() {
		search := func() []lyrics.Candidate {
			res, err := engine.Search(context.Background(), &model.MediaFile{ID: "s", Title: "Song", Artist: "Band", Album: "Album", Duration: 200}, lyrics.SearchOptions{})
			Expect(err).ToNot(HaveOccurred())
			return res.Candidates
		}
		BeforeEach(func() {
			a.info.Storable = false
			c := remote("alpha", "1", karaokeOf("x"), 0.99)
			c.Storable = false
			a.set(c)
		})

		It("keeps an unofficial provider's lyrics unsaveable until the administrator allows it", func() {
			st := statusOf("alpha")
			Expect(st.StoreOptIn).To(BeTrue())
			Expect(st.StoreAllowed || st.Storable).To(BeFalse())
			Expect(search()[0].Storable).To(BeFalse())

			_, err := engine.SaveSettings(context.Background(), lyrics.Settings{Providers: []string{"alpha"}, Store: []string{"alpha", "nope"}, MinConfidence: 0.85})
			Expect(err).ToNot(HaveOccurred())
			st = statusOf("alpha")
			Expect(st.StoreAllowed && st.Storable).To(BeTrue())
			Expect(engine.Settings(context.Background()).Store).To(Equal([]string{"alpha"}), "unknown providers are dropped")
			Expect(search()[0].Storable).To(BeTrue())

			// and it can be taken back
			_, err = engine.SaveSettings(context.Background(), lyrics.Settings{Providers: []string{"alpha"}, MinConfidence: 0.85})
			Expect(err).ToNot(HaveOccurred())
			Expect(search()[0].Storable).To(BeFalse())
		})

		It("offers no opt-in for a provider that already may save, or one that cannot be used", func() {
			Expect(statusOf("beta").StoreOptIn).To(BeFalse(), "beta may save by itself")
			b.info.Storable, b.info.Implemented, b.info.Status = false, false, lyrics.StatusUnavailable
			Expect(statusOf("beta").StoreOptIn).To(BeFalse(), "an unusable provider cannot be opted in")
		})
	})

	It("does not offer, or count, a result that is only credits", func() {
		credits := model.LyricList{{Kind: model.LyricKindMain, Line: []model.Line{{Value: "作曲 : Someone"}}}}
		c := remote("alpha", "1", credits, 0.99)
		c.Quality = lyrics.QualityPlain
		a.set(c)
		res, err := engine.Search(context.Background(), &model.MediaFile{ID: "s", Title: "Song", Artist: "Band", Album: "Album", Duration: 200}, lyrics.SearchOptions{})
		Expect(err).ToNot(HaveOccurred())
		Expect(res.Candidates).To(BeEmpty())
		for _, o := range res.Providers {
			if o.ID == "alpha" {
				Expect(o.Count).To(BeZero())
			}
		}
	})

	It("asks only providers that are ready and turned on when checking", func() {
		_, err := engine.SaveSettings(context.Background(), lyrics.Settings{Providers: []string{"alpha"}, MinConfidence: 0.85})
		Expect(err).ToNot(HaveOccurred())
		engine.CheckProviders(context.Background())
		Expect(a.calls.Load()).To(Equal(int32(1)))
		Expect(b.calls.Load()).To(BeZero())
	})
})
