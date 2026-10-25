package lyrics_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/Tian-MC/lyvune/conf"
	"github.com/Tian-MC/lyvune/conf/configtest"
	"github.com/Tian-MC/lyvune/core/lyrics"
	"github.com/Tian-MC/lyvune/model"
	"github.com/Tian-MC/lyvune/tests"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

// safeProps is an in-memory property repository that is safe for concurrent use.
type safeProps struct {
	mu   sync.Mutex
	data map[string]string
}

func (p *safeProps) Put(_ context.Context, id, v string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.data == nil {
		p.data = map[string]string{}
	}
	p.data[id] = v
	return nil
}
func (p *safeProps) Get(_ context.Context, id string) (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if v, ok := p.data[id]; ok {
		return v, nil
	}
	return "", model.ErrNotFound
}
func (p *safeProps) Delete(_ context.Context, id string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if _, ok := p.data[id]; !ok {
		return model.ErrNotFound
	}
	delete(p.data, id)
	return nil
}
func (p *safeProps) DefaultGet(ctx context.Context, id, def string) (string, error) {
	if v, err := p.Get(ctx, id); err == nil {
		return v, nil
	}
	return def, nil
}

// fakeProvider answers searches with whatever the test configured.
type fakeProvider struct {
	mu    sync.Mutex
	info  lyrics.ProviderInfo
	cands []lyrics.Candidate
	err   error
	calls atomic.Int32
	delay time.Duration
	// active and peak record how many searches ran at the same moment
	active atomic.Int32
	peak   atomic.Int32
}

func newFake(id string) *fakeProvider {
	return &fakeProvider{info: lyrics.ProviderInfo{ID: id, Name: id, Status: lyrics.StatusReady, Storable: true}}
}
func (f *fakeProvider) Info() lyrics.ProviderInfo { return f.info }
func (f *fakeProvider) Search(_ context.Context, _ lyrics.Recording) ([]lyrics.Candidate, error) {
	f.calls.Add(1)
	now := f.active.Add(1)
	for {
		p := f.peak.Load()
		if now <= p || f.peak.CompareAndSwap(p, now) {
			break
		}
	}
	defer f.active.Add(-1)
	time.Sleep(f.delay)
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.cands, f.err
}
func (f *fakeProvider) set(cands ...lyrics.Candidate) {
	f.mu.Lock()
	f.cands, f.err = cands, nil
	f.mu.Unlock()
}

func plainOf(text string) model.LyricList {
	return model.LyricList{{Kind: model.LyricKindMain, Lang: "eng", Line: []model.Line{{Value: text}}}}
}
func syncedOf(text string) model.LyricList {
	return model.LyricList{{Kind: model.LyricKindMain, Lang: "eng", Synced: true, Line: []model.Line{{Start: i64(1000), Value: text}}}}
}
func karaokeOf(text string) model.LyricList {
	return model.LyricList{{Kind: model.LyricKindMain, Lang: "eng", Synced: true, Line: []model.Line{{
		Start: i64(1000), Value: text, Cue: []model.Cue{{Start: i64(1000), End: i64(1500), Value: text, ByteStart: 0, ByteEnd: len(text) - 1}},
	}}}}
}

func remote(provider, id string, list model.LyricList, confidence ...float64) lyrics.Candidate {
	match := 0.97
	if len(confidence) > 0 {
		match = confidence[0]
	}
	return lyrics.Candidate{
		ID: provider + ":" + id, Provider: provider, Source: lyrics.SourceRemote, Lyrics: list, Quality: lyrics.QualityOf(list),
		Meta: lyrics.Meta{Title: "Song", Artist: "Band", DurationSec: 200}, Match: lyrics.Match{Confidence: match}, Storable: true,
	}
}

func firstLine(list model.LyricList) string {
	if len(list) == 0 || len(list[0].Line) == 0 {
		return ""
	}
	return list[0].Line[0].Value
}

var _ = Describe("Lyrics engine", func() {
	var (
		ctx      context.Context
		root     string
		hist     string
		mf       *model.MediaFile
		fake     *fakeProvider
		props    *safeProps
		clock    time.Time
		svc      lyrics.Lyrics
		engine   lyrics.Engine
		audioSum []byte
	)

	newService := func() {
		svc = lyrics.NewService(lyrics.Options{
			DataStore: &tests.MockDataStore{MockedProperty: props},
			Providers: lyrics.NewProviders(fake),
			Store:     lyrics.NewStore(hist, 10),
			Now:       func() time.Time { return clock },
		})
		engine = lyrics.EngineOf(svc)
	}
	dir := func() string { return filepath.Join(root, "Artist", "Album") }
	write := func(name, content string) string {
		p := filepath.Join(dir(), name)
		Expect(os.WriteFile(p, []byte(content), 0o644)).To(Succeed())
		return p
	}
	envFile := func() string { return filepath.Join(dir(), "01 - Song.lyrics.json") }
	get := func() model.LyricList {
		list, err := svc.GetLyrics(ctx, mf)
		Expect(err).ToNot(HaveOccurred())
		return list
	}
	resolve := func(opts lyrics.ResolveOptions) lyrics.ResolveResult {
		res, err := engine.Resolve(ctx, mf, opts)
		Expect(err).ToNot(HaveOccurred())
		return res
	}
	status := func() lyrics.SongStatus {
		st, err := engine.Status(ctx, mf)
		Expect(err).ToNot(HaveOccurred())
		return st
	}
	setSettings := func(f func(*lyrics.Settings)) {
		s := engine.Settings(ctx)
		f(&s)
		_, err := engine.SaveSettings(ctx, s)
		Expect(err).ToNot(HaveOccurred())
	}

	BeforeEach(func() {
		DeferCleanup(configtest.SetupConfig())
		conf.Server.LyricsPriority = ".lrc,embedded"
		ctx = context.Background()
		root, hist = GinkgoT().TempDir(), GinkgoT().TempDir()
		Expect(os.MkdirAll(dir(), 0o755)).To(Succeed())
		audioPath := write("01 - Song.flac", "FLACDATA")
		raw, _ := os.ReadFile(audioPath)
		audioSum = raw
		mf = &model.MediaFile{
			ID: "song-1", Title: "Song", Artist: "Band", Album: "Album", Duration: 200,
			Path: "Artist/Album/01 - Song.flac", LibraryPath: root,
		}
		fake = newFake("fake")
		props = &safeProps{}
		clock = time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC)
		newService()
		setSettings(func(s *lyrics.Settings) { s.Providers = []string{"fake"} })
	})

	AfterEach(func() {
		raw, err := os.ReadFile(filepath.Join(dir(), "01 - Song.flac"))
		Expect(err).ToNot(HaveOccurred())
		Expect(raw).To(Equal(audioSum), "the audio file is never modified")
	})

	Describe("source precedence", func() {
		embedded := func() { mf.Lyrics = mustJSON(plainOf("embedded text")) }

		It("shows a local sidecar before embedded lyrics", func() {
			embedded()
			write("01 - Song.lrc", "[00:01.00]sidecar text")
			Expect(firstLine(get())).To(Equal("sidecar text"))
			Expect(status().Current.Source).To(Equal("sidecar"))
		})

		It("shows embedded lyrics before downloaded ones, by default", func() {
			embedded()
			writeManaged(hist, mf, karaokeOf("downloaded karaoke"))
			Expect(firstLine(get())).To(Equal("embedded text"))
			Expect(status().Current.Source).To(Equal("embedded"))
		})

		It("lets lyrics the user chose win over a sidecar", func() {
			write("01 - Song.lrc", "[00:01.00]sidecar text")
			fake.set(remote("fake", "1", syncedOf("chosen")))
			_, err := engine.Search(ctx, mf, lyrics.SearchOptions{})
			Expect(err).ToNot(HaveOccurred())
			_, err = engine.Apply(ctx, mf, lyrics.ApplyRequest{CandidateID: "fake:1", Confirm: true})
			Expect(err).ToNot(HaveOccurred())
			Expect(firstLine(get())).To(Equal("chosen"))
			Expect(status().Current.Source).To(Equal("user"))
		})

		It("lets downloaded lyrics compete on quality when local priority is off", func() {
			embedded()
			writeManaged(hist, mf, karaokeOf("karaoke text"))
			Expect(firstLine(get())).To(Equal("embedded text"))
			setSettings(func(s *lyrics.Settings) { s.PreferLocal = false })
			Expect(firstLine(get())).To(Equal("karaoke text"))
		})

		It("keeps local lyrics on a tie when local priority is off", func() {
			write("01 - Song.lrc", "[00:01.00]sidecar text")
			fake.set(remote("fake", "1", syncedOf("downloaded synced"), 0.99))
			Expect(resolve(lyrics.ResolveOptions{}).Result).To(Equal(lyrics.ResolveHave))
			setSettings(func(s *lyrics.Settings) { s.PreferLocal = false })
			Expect(firstLine(get())).To(Equal("sidecar text"))
		})

		It("ignores a .lyrics.json that is not a Lyvune envelope", func() {
			write("01 - Song.lyrics.json", `{"someone":"else"}`)
			write("01 - Song.lrc", "[00:01.00]sidecar text")
			Expect(firstLine(get())).To(Equal("sidecar text"))
		})
	})

	Describe("automatic retrieval", func() {
		It("downloads missing lyrics, saves them next to the audio and keeps using them offline", func() {
			fake.set(remote("fake", "1", syncedOf("fetched"), 0.97))
			res := resolve(lyrics.ResolveOptions{})
			Expect(res.Result).To(Equal(lyrics.ResolveFound))
			Expect(res.Applied.Quality).To(Equal("synced"))
			Expect(envFile()).To(BeAnExistingFile())

			// the network is gone, the server restarted: a brand new service
			fake.err = lyrics.ErrProviderUnavailable
			newService()
			before := fake.calls.Load()
			Expect(firstLine(get())).To(Equal("fetched"))
			Expect(fake.calls.Load()).To(Equal(before), "reading saved lyrics makes no request")
			Expect(status().Current.Source).To(Equal("managed"))
		})

		It("prefers the best verified candidate: karaoke over synced over plain", func() {
			fake.set(
				remote("fake", "p", plainOf("plain"), 0.99),
				remote("fake", "s", syncedOf("synced"), 0.99),
				remote("fake", "k", karaokeOf("karaoke"), 0.9),
			)
			Expect(resolve(lyrics.ResolveOptions{}).Applied.Quality).To(Equal("karaoke"))
		})

		It("never stores a doubtful karaoke over correct synced lyrics", func() {
			fake.set(remote("fake", "k", karaokeOf("wrong karaoke"), 0.4), remote("fake", "s", syncedOf("right synced"), 0.97))
			resolve(lyrics.ResolveOptions{})
			Expect(firstLine(get())).To(Equal("right synced"))
		})

		It("does not store an ambiguous match", func() {
			fake.set(remote("fake", "1", syncedOf("maybe"), 0.7))
			Expect(resolve(lyrics.ResolveOptions{}).Result).To(Equal(lyrics.ResolveNotFound))
			Expect(envFile()).ToNot(BeAnExistingFile())
		})

		It("does not store lyrics the provider does not allow to be saved", func() {
			c := remote("fake", "1", syncedOf("temporary"), 0.99)
			c.Storable = false
			fake.set(c)
			// good, but neither kept nor shown: reported as found-but-not-saved, not as missing
			Expect(resolve(lyrics.ResolveOptions{}).Result).To(Equal(lyrics.ResolveNotSaved))
			Expect(envFile()).ToNot(BeAnExistingFile())
		})

		It("remembers a clean 'not found' so providers are not asked again", func() {
			fake.set()
			Expect(resolve(lyrics.ResolveOptions{}).Result).To(Equal(lyrics.ResolveNotFound))
			calls := fake.calls.Load()
			Expect(resolve(lyrics.ResolveOptions{}).Result).To(Equal(lyrics.ResolveNotFound))
			Expect(fake.calls.Load()).To(Equal(calls))
			Expect(status().MissingRecently).To(BeTrue())

			Expect(resolve(lyrics.ResolveOptions{Recheck: true}).Result).To(Equal(lyrics.ResolveNotFound))
			Expect(fake.calls.Load()).To(Equal(calls + 1))
		})

		It("forgets a 'not found' after a week", func() {
			fake.set()
			resolve(lyrics.ResolveOptions{})
			clock = clock.Add(8 * 24 * time.Hour)
			resolve(lyrics.ResolveOptions{})
			Expect(fake.calls.Load()).To(Equal(int32(2)))
		})

		It("does not remember an outage as 'not found'", func() {
			fake.mu.Lock()
			fake.err = lyrics.ErrProviderUnavailable
			fake.mu.Unlock()
			Expect(resolve(lyrics.ResolveOptions{}).Result).To(Equal(lyrics.ResolveUnavailable))
			fake.set(remote("fake", "1", syncedOf("back online"), 0.97))
			Expect(resolve(lyrics.ResolveOptions{}).Result).To(Equal(lyrics.ResolveFound))
		})

		It("stops and reports when a provider asks to slow down", func() {
			fake.mu.Lock()
			fake.err = &lyrics.RateLimitedError{Provider: "fake", RetryAfter: 30 * time.Second}
			fake.mu.Unlock()
			res := resolve(lyrics.ResolveOptions{})
			Expect(res.Result).To(Equal(lyrics.ResolveUnavailable))
			Expect(res.RetryAfter).To(Equal(30))
		})

		It("does nothing when automatic retrieval is off, unless the user asked", func() {
			setSettings(func(s *lyrics.Settings) { s.AutoRetrieve = false })
			fake.set(remote("fake", "1", syncedOf("fetched"), 0.97))
			Expect(resolve(lyrics.ResolveOptions{}).Result).To(Equal(lyrics.ResolveDisabled))
			Expect(fake.calls.Load()).To(BeZero())
			Expect(resolve(lyrics.ResolveOptions{Explicit: true}).Result).To(Equal(lyrics.ResolveFound))
		})

		It("shares one search between concurrent requests for the same track", func() {
			fake.delay = 150 * time.Millisecond
			fake.set(remote("fake", "1", syncedOf("fetched"), 0.97))
			var wg sync.WaitGroup
			for i := 0; i < 6; i++ {
				wg.Add(1)
				go func() {
					defer GinkgoRecover()
					defer wg.Done()
					_, err := engine.Resolve(ctx, mf, lyrics.ResolveOptions{})
					Expect(err).ToNot(HaveOccurred())
				}()
			}
			wg.Wait()
			Expect(fake.calls.Load()).To(Equal(int32(1)))
		})

		It("reports a read-only library instead of failing", func() {
			if os.Geteuid() == 0 {
				Skip("root ignores directory permissions")
			}
			Expect(os.Chmod(dir(), 0o555)).To(Succeed())
			DeferCleanup(func() { _ = os.Chmod(dir(), 0o755) })
			fake.set(remote("fake", "1", syncedOf("fetched"), 0.97))
			res := resolve(lyrics.ResolveOptions{})
			Expect(res.Result).To(Equal(lyrics.ResolveUnavailable))
			Expect(res.Message).To(ContainSubstring("cannot be written"))
			Expect(status().Writable).To(BeTrue(), "the folder resolves; the write itself failed")
		})

		It("only uses the providers enabled in the settings", func() {
			setSettings(func(s *lyrics.Settings) { s.Providers = nil })
			fake.set(remote("fake", "1", syncedOf("fetched"), 0.97))
			Expect(resolve(lyrics.ResolveOptions{}).Result).To(Equal(lyrics.ResolveUnavailable))
			Expect(fake.calls.Load()).To(BeZero())
		})
	})

	Describe("automatic upgrades", func() {
		It("upgrades downloaded plain lyrics to synced, with a way back", func() {
			saveManaged(ctx, engine, mf, fake, "plain", plainOf("plain version"))
			Expect(firstLine(get())).To(Equal("plain version"))
			fake.set(remote("fake", "2", syncedOf("synced version"), 0.97))

			res := resolve(lyrics.ResolveOptions{})
			Expect(res.Result).To(Equal(lyrics.ResolveUpgraded))
			Expect(firstLine(get())).To(Equal("synced version"))
			Expect(status().History).ToNot(BeEmpty())
		})

		It("upgrades synced lyrics to karaoke", func() {
			saveManaged(ctx, engine, mf, fake, "s", syncedOf("synced version"))
			fake.set(remote("fake", "2", karaokeOf("karaoke version"), 0.95))
			Expect(resolve(lyrics.ResolveOptions{}).Result).To(Equal(lyrics.ResolveUpgraded))
			Expect(status().Current.Quality).To(Equal("karaoke"))
		})

		It("never downgrades and never replaces equal quality", func() {
			saveManaged(ctx, engine, mf, fake, "s", syncedOf("synced version"))
			fake.set(remote("fake", "p", plainOf("plain"), 0.99), remote("fake", "s2", syncedOf("another synced"), 0.99))
			Expect(resolve(lyrics.ResolveOptions{}).Result).To(Equal(lyrics.ResolveKept))
			Expect(firstLine(get())).To(Equal("synced version"))
		})

		It("says the provider did not answer, rather than 'nothing better', during an outage", func() {
			saveManaged(ctx, engine, mf, fake, "p", plainOf("plain version"))
			fake.mu.Lock()
			fake.err = lyrics.ErrProviderUnavailable
			fake.mu.Unlock()
			Expect(resolve(lyrics.ResolveOptions{}).Result).To(Equal(lyrics.ResolveUnavailable))
			Expect(firstLine(get())).To(Equal("plain version"))
			// and it is checked again later: an outage must not count as "checked recently"
			fake.set(remote("fake", "2", syncedOf("better"), 0.97))
			Expect(resolve(lyrics.ResolveOptions{}).Result).To(Equal(lyrics.ResolveUpgraded))
		})

		It("leaves karaoke alone without asking providers", func() {
			saveManagedKaraoke(ctx, engine, mf, fake)
			calls := fake.calls.Load()
			Expect(resolve(lyrics.ResolveOptions{}).Result).To(Equal(lyrics.ResolveHave))
			Expect(fake.calls.Load()).To(Equal(calls))
		})

		It("does not search again within a week, unless asked to recheck", func() {
			saveManaged(ctx, engine, mf, fake, "p", plainOf("plain version"))
			fake.set()
			resolve(lyrics.ResolveOptions{})
			calls := fake.calls.Load()
			Expect(resolve(lyrics.ResolveOptions{}).Result).To(Equal(lyrics.ResolveSkipped))
			Expect(fake.calls.Load()).To(Equal(calls))
			resolve(lyrics.ResolveOptions{Recheck: true})
			Expect(fake.calls.Load()).To(Equal(calls + 1))
		})

		It("does nothing when automatic upgrades are off", func() {
			saveManaged(ctx, engine, mf, fake, "p", plainOf("plain version"))
			setSettings(func(s *lyrics.Settings) { s.AutoUpgrade = false })
			fake.set(remote("fake", "2", syncedOf("better"), 0.99))
			calls := fake.calls.Load()
			Expect(resolve(lyrics.ResolveOptions{}).Result).To(Equal(lyrics.ResolveDisabled))
			Expect(fake.calls.Load()).To(Equal(calls))
		})

		It("never replaces a locked source", func() {
			saveManaged(ctx, engine, mf, fake, "p", plainOf("plain version"))
			Expect(engine.SetLocked(ctx, mf, true)).To(Succeed())
			fake.set(remote("fake", "2", karaokeOf("better"), 0.99))
			calls := fake.calls.Load()
			Expect(resolve(lyrics.ResolveOptions{Explicit: true, Recheck: true}).Result).To(Equal(lyrics.ResolveLocked))
			Expect(fake.calls.Load()).To(Equal(calls))
			Expect(firstLine(get())).To(Equal("plain version"))
		})

		Context("with lyrics the user supplied", func() {
			var lrc string
			BeforeEach(func() {
				lrc = write("01 - Song.lrc", "hand written, no timestamps")
				fake.set(remote("fake", "2", karaokeOf("remote karaoke"), 0.99))
			})

			It("preserves a sidecar by default and does not even ask providers", func() {
				Expect(resolve(lyrics.ResolveOptions{}).Result).To(Equal(lyrics.ResolveHave))
				Expect(fake.calls.Load()).To(BeZero())
				Expect(envFile()).ToNot(BeAnExistingFile())
			})

			It("preserves embedded lyrics by default", func() {
				Expect(os.Remove(lrc)).To(Succeed())
				mf.Lyrics = mustJSON(plainOf("embedded text"))
				Expect(resolve(lyrics.ResolveOptions{}).Result).To(Equal(lyrics.ResolveHave))
				Expect(fake.calls.Load()).To(BeZero())
			})

			It("supersedes a sidecar only when allowed, without touching the file", func() {
				setSettings(func(s *lyrics.Settings) { s.AutoReplaceManual = true })
				Expect(resolve(lyrics.ResolveOptions{}).Result).To(Equal(lyrics.ResolveUpgraded))
				Expect(firstLine(get())).To(Equal("remote karaoke"))
				raw, _ := os.ReadFile(lrc)
				Expect(string(raw)).To(Equal("hand written, no timestamps"))
			})

			It("supersedes embedded lyrics without rewriting the audio", func() {
				Expect(os.Remove(lrc)).To(Succeed())
				mf.Lyrics = mustJSON(plainOf("embedded text"))
				setSettings(func(s *lyrics.Settings) { s.AutoReplaceManual = true })
				Expect(resolve(lyrics.ResolveOptions{}).Result).To(Equal(lyrics.ResolveUpgraded))
				Expect(firstLine(get())).To(Equal("remote karaoke"))
				Expect(status().Local).To(ContainElement(HaveField("ID", "embedded")), "the embedded lyrics remain an alternative")
			})

			It("honours a locked sidecar even when manual replacement is allowed", func() {
				setSettings(func(s *lyrics.Settings) { s.AutoReplaceManual = true })
				Expect(engine.SetLocked(ctx, mf, true)).To(Succeed())
				Expect(resolve(lyrics.ResolveOptions{}).Result).To(Equal(lyrics.ResolveLocked))
				Expect(envFile()).ToNot(BeAnExistingFile())
			})

			It("never replaces lyrics the user picked on purpose", func() {
				setSettings(func(s *lyrics.Settings) { s.AutoReplaceManual = true })
				_, _ = engine.Search(ctx, mf, lyrics.SearchOptions{})
				_, err := engine.Apply(ctx, mf, lyrics.ApplyRequest{CandidateID: "fake:2", Confirm: true})
				Expect(err).ToNot(HaveOccurred())
				fake.set(remote("fake", "3", karaokeOf("even better"), 0.99))
				Expect(resolve(lyrics.ResolveOptions{Explicit: true, Recheck: true}).Result).To(Equal(lyrics.ResolveHave))
				Expect(firstLine(get())).To(Equal("remote karaoke"))
			})
		})
	})

	Describe("choosing a version by hand", func() {
		search := func() {
			_, err := engine.Search(ctx, mf, lyrics.SearchOptions{})
			Expect(err).ToNot(HaveOccurred())
		}

		It("asks for confirmation before superseding a sidecar", func() {
			write("01 - Song.lrc", "[00:01.00]sidecar text")
			fake.set(remote("fake", "1", syncedOf("chosen"), 0.97))
			search()
			_, err := engine.Apply(ctx, mf, lyrics.ApplyRequest{CandidateID: "fake:1"})
			Expect(err).To(MatchError(lyrics.ErrConfirmRequired))
			Expect(firstLine(get())).To(Equal("sidecar text"))
		})

		It("supersedes a sidecar after confirmation, keeping the original file", func() {
			lrc := write("01 - Song.lrc", "[00:01.00]sidecar text")
			fake.set(remote("fake", "1", syncedOf("chosen"), 0.97))
			search()
			res, err := engine.Apply(ctx, mf, lyrics.ApplyRequest{CandidateID: "fake:1", Confirm: true})
			Expect(err).ToNot(HaveOccurred())
			Expect(res.Action).To(Equal("created-preferred"))
			Expect(res.Superseded).To(Equal("sidecar"))
			Expect(firstLine(get())).To(Equal("chosen"))
			raw, _ := os.ReadFile(lrc)
			Expect(string(raw)).To(Equal("[00:01.00]sidecar text"))
		})

		It("needs no confirmation when nothing is there", func() {
			fake.set(remote("fake", "1", syncedOf("chosen"), 0.97))
			search()
			res, err := engine.Apply(ctx, mf, lyrics.ApplyRequest{CandidateID: "fake:1"})
			Expect(err).ToNot(HaveOccurred())
			Expect(res.Action).To(Equal("created-preferred"))
		})

		It("replaces an incorrect karaoke with correct but lower quality lyrics, on purpose", func() {
			saveManagedKaraoke(ctx, engine, mf, fake)
			fake.set(remote("fake", "right", plainOf("the right words"), 0.9))
			search()
			res, err := engine.Apply(ctx, mf, lyrics.ApplyRequest{CandidateID: "fake:right"})
			Expect(err).ToNot(HaveOccurred(), "a downloaded version can be replaced by choice")
			Expect(res.Action).To(Equal("replaced-managed"))
			Expect(firstLine(get())).To(Equal("the right words"))
		})

		It("returns the way back to the previous version", func() {
			saveManaged(ctx, engine, mf, fake, "first", syncedOf("first version"))
			fake.set(remote("fake", "2", syncedOf("second version"), 0.97))
			search()
			res, err := engine.Apply(ctx, mf, lyrics.ApplyRequest{CandidateID: "fake:2"})
			Expect(err).ToNot(HaveOccurred())
			Expect(res.Undo).ToNot(BeEmpty())
			Expect(firstLine(get())).To(Equal("second version"))

			_, err = engine.Restore(ctx, mf, res.Undo)
			Expect(err).ToNot(HaveOccurred())
			Expect(firstLine(get())).To(Equal("first version"))
		})

		It("selects embedded lyrics as the preferred version without changing the audio", func() {
			mf.Lyrics = mustJSON(plainOf("embedded text"))
			write("01 - Song.lrc", "[00:01.00]sidecar text")
			Expect(firstLine(get())).To(Equal("sidecar text"))
			res, err := engine.Apply(ctx, mf, lyrics.ApplyRequest{CandidateID: "embedded", Confirm: true})
			Expect(err).ToNot(HaveOccurred())
			Expect(res.EmbeddedKept).To(BeTrue())
			Expect(firstLine(get())).To(Equal("embedded text"))
		})

		It("refuses to replace locked lyrics without force, and allows it with force", func() {
			saveManaged(ctx, engine, mf, fake, "first", syncedOf("first version"))
			Expect(engine.SetLocked(ctx, mf, true)).To(Succeed())
			fake.set(remote("fake", "2", syncedOf("second version"), 0.97))
			search()
			_, err := engine.Apply(ctx, mf, lyrics.ApplyRequest{CandidateID: "fake:2", Confirm: true})
			Expect(err).To(MatchError(lyrics.ErrLocked))
			Expect(firstLine(get())).To(Equal("first version"))

			_, err = engine.Apply(ctx, mf, lyrics.ApplyRequest{CandidateID: "fake:2", Confirm: true, Force: true})
			Expect(err).ToNot(HaveOccurred())
			Expect(firstLine(get())).To(Equal("second version"))
			Expect(status().Locked).To(BeTrue(), "forcing a replacement keeps the lock")
		})

		It("refuses lyrics a provider does not allow to be saved", func() {
			c := remote("fake", "1", syncedOf("temporary"), 0.9)
			c.Storable = false
			fake.set(c)
			search()
			_, err := engine.Apply(ctx, mf, lyrics.ApplyRequest{CandidateID: "fake:1"})
			Expect(err).To(MatchError(lyrics.ErrNotStorable))
		})

		It("only accepts candidates the server found", func() {
			_, err := engine.Apply(ctx, mf, lyrics.ApplyRequest{CandidateID: "fake:999"})
			Expect(err).To(MatchError(lyrics.ErrNoCandidate))
		})

		It("forgets candidates after the search expires", func() {
			fake.set(remote("fake", "1", syncedOf("chosen"), 0.97))
			search()
			clock = clock.Add(time.Hour)
			svcClockCandidate := func() error {
				_, err := engine.Apply(ctx, mf, lyrics.ApplyRequest{CandidateID: "fake:1"})
				return err
			}
			Expect(svcClockCandidate()).To(MatchError(lyrics.ErrNoCandidate))
		})

		It("lists weak matches only when asked", func() {
			fake.set(remote("fake", "weak", syncedOf("weak"), 0.3), remote("fake", "ok", syncedOf("ok"), 0.7))
			res, _ := engine.Search(ctx, mf, lyrics.SearchOptions{})
			Expect(res.Candidates).To(HaveLen(1))
			res, _ = engine.Search(ctx, mf, lyrics.SearchOptions{ShowAll: true})
			Expect(res.Candidates).To(HaveLen(2))
		})

		It("reports each provider's outcome, and one failing does not hide the others", func() {
			bad := newFake("bad")
			bad.err = errors.New("boom")
			svc = lyrics.NewService(lyrics.Options{
				DataStore: &tests.MockDataStore{MockedProperty: props},
				Providers: lyrics.NewProviders(bad, fake), Store: lyrics.NewStore(hist, 10), Now: func() time.Time { return clock },
			})
			engine = lyrics.EngineOf(svc)
			fake.set(remote("fake", "1", syncedOf("fine"), 0.97))
			res, err := engine.Search(ctx, mf, lyrics.SearchOptions{})
			Expect(err).ToNot(HaveOccurred())
			Expect(res.Candidates).To(HaveLen(1))
			byID := map[string]string{}
			for _, o := range res.Providers {
				byID[o.ID] = o.Status
			}
			Expect(byID).To(HaveKeyWithValue("bad", lyrics.OutcomeError))
			Expect(byID).To(HaveKeyWithValue("fake", lyrics.OutcomeOK))
		})
	})

	Describe("importing lyrics", func() {
		It("imports an LRC file as the preferred lyrics", func() {
			res, err := engine.Import(ctx, mf, lyrics.ImportRequest{FileName: "mine.lrc", Content: []byte("[00:01.00]imported line")})
			Expect(err).ToNot(HaveOccurred())
			Expect(res.Action).To(Equal("created-preferred"))
			Expect(firstLine(get())).To(Equal("imported line"))
			Expect(status().Current.Source).To(Equal("user"))
		})

		It("imports word-timed Enhanced LRC as karaoke", func() {
			_, err := engine.Import(ctx, mf, lyrics.ImportRequest{FileName: "k.elrc", Content: []byte("[00:01.00]<00:01.00>Hello <00:01.50>world")})
			Expect(err).ToNot(HaveOccurred())
			Expect(status().Current.Quality).To(Equal("karaoke"))
		})

		It("rejects empty and oversized files", func() {
			_, err := engine.Import(ctx, mf, lyrics.ImportRequest{FileName: "x.lrc"})
			Expect(err).To(MatchError(lyrics.ErrEmptyLyrics))
			_, err = engine.Import(ctx, mf, lyrics.ImportRequest{FileName: "x.lrc", Content: make([]byte, 3<<20)})
			Expect(err).To(MatchError(lyrics.ErrEmptyLyrics))
		})

		It("rejects a file with no lyrics in it", func() {
			_, err := engine.Import(ctx, mf, lyrics.ImportRequest{FileName: "x.txt", Content: []byte("   \n  ")})
			Expect(err).To(HaveOccurred())
		})

		It("asks for confirmation before superseding an existing sidecar", func() {
			write("01 - Song.lrc", "[00:01.00]sidecar text")
			_, err := engine.Import(ctx, mf, lyrics.ImportRequest{FileName: "x.lrc", Content: []byte("[00:01.00]imported")})
			Expect(err).To(MatchError(lyrics.ErrConfirmRequired))
		})

		It("imports a Lyvune lyrics.json", func() {
			saveManaged(ctx, engine, mf, fake, "m", karaokeOf("karaoke text"))
			raw, _ := os.ReadFile(envFile())
			Expect(os.Remove(envFile())).To(Succeed())
			_, err := engine.Import(ctx, mf, lyrics.ImportRequest{FileName: "backup.lyrics.json", Content: raw})
			Expect(err).ToNot(HaveOccurred())
			Expect(status().Current.Quality).To(Equal("karaoke"))
		})
	})

	Describe("lock and offset", func() {
		It("keeps the lock and offset of a sidecar that is not Lyvune's, in the database", func() {
			write("01 - Song.lrc", "[00:01.00]sidecar text")
			Expect(engine.SetLocked(ctx, mf, true)).To(Succeed())
			Expect(engine.SetOffset(ctx, mf, 250)).To(Succeed())
			newService() // restart
			st := status()
			Expect(st.Locked).To(BeTrue())
			Expect(st.OffsetMs).To(Equal(int64(250)))
			Expect(*get()[0].Offset).To(Equal(int64(250)))
		})

		It("keeps them inside the Lyvune sidecar when there is one", func() {
			saveManaged(ctx, engine, mf, fake, "m", syncedOf("synced"))
			Expect(engine.SetOffset(ctx, mf, -400)).To(Succeed())
			Expect(engine.SetLocked(ctx, mf, true)).To(Succeed())
			raw, _ := os.ReadFile(envFile())
			var env map[string]any
			Expect(json.Unmarshal(raw, &env)).To(Succeed())
			Expect(env).To(HaveKeyWithValue("offsetMs", BeNumerically("==", -400)))
			Expect(env).To(HaveKeyWithValue("locked", true))
			Expect(*get()[0].Offset).To(Equal(int64(-400)))
		})

		It("does not rewrite timestamps or fill the history when the offset changes", func() {
			saveManaged(ctx, engine, mf, fake, "m", syncedOf("synced"))
			before := len(status().History)
			for _, ms := range []int64{100, 200, 300, 400} {
				Expect(engine.SetOffset(ctx, mf, ms)).To(Succeed())
			}
			Expect(len(status().History)).To(Equal(before))
			Expect(*get()[0].Line[0].Start).To(Equal(int64(1000)))
		})

		It("clamps an absurd offset", func() {
			write("01 - Song.lrc", "[00:01.00]sidecar text")
			Expect(engine.SetOffset(ctx, mf, 99999999)).To(Succeed())
			Expect(status().OffsetMs).To(Equal(int64(600000)))
		})

		It("carries the lock and offset over when a sidecar becomes a preferred version", func() {
			write("01 - Song.lrc", "[00:01.00]sidecar text")
			Expect(engine.SetLocked(ctx, mf, true)).To(Succeed())
			Expect(engine.SetOffset(ctx, mf, 300)).To(Succeed())
			fake.set(remote("fake", "1", syncedOf("chosen"), 0.97))
			_, _ = engine.Search(ctx, mf, lyrics.SearchOptions{})
			_, err := engine.Apply(ctx, mf, lyrics.ApplyRequest{CandidateID: "fake:1", Confirm: true, Force: true})
			Expect(err).ToNot(HaveOccurred())
			st := status()
			Expect(st.Locked).To(BeTrue())
			Expect(st.OffsetMs).To(Equal(int64(300)))
		})
	})

	Describe("deleting downloaded lyrics", func() {
		It("removes the Lyvune sidecar and nothing else, and can be undone", func() {
			lrc := write("01 - Song.lrc", "[00:01.00]sidecar text")
			writeManaged(hist, mf, syncedOf("downloaded"))
			res, err := engine.DeleteManaged(ctx, mf)
			Expect(err).ToNot(HaveOccurred())
			Expect(envFile()).ToNot(BeAnExistingFile())
			Expect(lrc).To(BeAnExistingFile())
			Expect(filepath.Join(dir(), "01 - Song.flac")).To(BeAnExistingFile())
			Expect(firstLine(get())).To(Equal("sidecar text"))

			_, err = engine.Restore(ctx, mf, res.Undo)
			Expect(err).ToNot(HaveOccurred())
			Expect(envFile()).To(BeAnExistingFile())
		})

		It("says so when there is nothing to delete", func() {
			write("01 - Song.lrc", "[00:01.00]sidecar text")
			_, err := engine.DeleteManaged(ctx, mf)
			Expect(err).To(MatchError(lyrics.ErrNothingToDelete))
		})
	})

	Describe("settings", func() {
		It("defaults to the recommended values", func() {
			s := lyrics.DefaultSettings()
			Expect(s.PreferLocal).To(BeTrue())
			Expect(s.AutoRetrieve).To(BeTrue())
			Expect(s.AutoUpgrade).To(BeTrue())
			Expect(s.AutoReplaceManual).To(BeFalse())
		})

		It("persists across a restart", func() {
			setSettings(func(s *lyrics.Settings) { s.AutoReplaceManual = true; s.PreferLocal = false })
			newService()
			s := engine.Settings(ctx)
			Expect(s.AutoReplaceManual).To(BeTrue())
			Expect(s.PreferLocal).To(BeFalse())
		})

		It("never lets automatic matching be more lenient than verified", func() {
			saved, err := engine.SaveSettings(ctx, lyrics.Settings{MinConfidence: 0.1, Providers: []string{"fake", "nope", "fake"}})
			Expect(err).ToNot(HaveOccurred())
			Expect(saved.MinConfidence).To(Equal(lyrics.ConfidenceAuto))
			Expect(saved.Providers).To(Equal([]string{"fake"}))
		})

		It("lists providers with their status and whether they are on", func() {
			list := engine.Providers(ctx)
			Expect(list).To(HaveLen(1))
			Expect(list[0].ID).To(Equal("fake"))
			Expect(list[0].Enabled).To(BeTrue())
		})
	})

	Describe("bulk operations", func() {
		var files model.MediaFiles
		var addTracks func(n int)
		BeforeEach(func() {
			files = nil
			repo := tests.CreateMockMediaFileRepo()
			for _, id := range []string{"t1", "t2", "t3"} {
				base := id + ".flac"
				Expect(os.WriteFile(filepath.Join(dir(), base), []byte("AUDIO"), 0o644)).To(Succeed())
				files = append(files, model.MediaFile{ID: id, Title: "Song", Artist: "Band", Album: "Album", Duration: 200, Path: "Artist/Album/" + base, LibraryPath: root})
			}
			repo.SetData(files)
			// the mock library ignores filters, so a test that needs more tracks adds them to it
			addTracks = func(n int) {
				for i := len(files) + 1; i <= n; i++ {
					id := fmt.Sprintf("t%d", i)
					base := id + ".flac"
					Expect(os.WriteFile(filepath.Join(dir(), base), []byte("AUDIO"), 0o644)).To(Succeed())
					files = append(files, model.MediaFile{ID: id, Title: "Song", Artist: "Band", Album: "Album", Duration: 200, Path: "Artist/Album/" + base, LibraryPath: root})
				}
				repo.SetData(files)
			}
			svc = lyrics.NewService(lyrics.Options{
				DataStore: &tests.MockDataStore{MockedProperty: props, MockedMediaFile: repo},
				Providers: lyrics.NewProviders(fake), Store: lyrics.NewStore(hist, 10), Now: func() time.Time { return clock },
			})
			engine = lyrics.EngineOf(svc)
			setSettings(func(s *lyrics.Settings) { s.Providers = []string{"fake"} })
		})

		wait := func(id string) lyrics.BulkStatus {
			var st lyrics.BulkStatus
			Eventually(func() string {
				st, _ = engine.Bulk(id)
				return st.State
			}, 5*time.Second, 20*time.Millisecond).ShouldNot(Equal("running"))
			return st
		}

		It("downloads missing lyrics for the chosen tracks and reports the counts", func() {
			fake.set(remote("fake", "1", syncedOf("fetched"), 0.97))
			st, err := engine.StartBulk(ctx, lyrics.BulkRequest{Action: lyrics.BulkMissing, TrackIDs: []string{"t1", "t2", "t3"}})
			Expect(err).ToNot(HaveOccurred())
			Expect(st.Total).To(Equal(3))
			done := wait(st.ID)
			Expect(done.State).To(Equal("done"))
			Expect(done.Found).To(Equal(3))
			Expect(done.Done).To(Equal(3))
			Expect(filepath.Join(dir(), "t2.lyrics.json")).To(BeAnExistingFile())
		})

		It("covers the whole library when asked, without listing every track", func() {
			fake.set(remote("fake", "1", syncedOf("fetched"), 0.97))
			st, err := engine.StartBulk(ctx, lyrics.BulkRequest{Action: lyrics.BulkMissing, All: true})
			Expect(err).ToNot(HaveOccurred())
			Expect(st.Total).To(Equal(3))
			Expect(wait(st.ID).Found).To(Equal(3))
		})

		It("skips tracks that already have lyrics, so a rerun resumes where it stopped", func() {
			Expect(os.WriteFile(filepath.Join(dir(), "t1.lrc"), []byte("[00:01.00]mine"), 0o644)).To(Succeed())
			fake.set(remote("fake", "1", syncedOf("fetched"), 0.97))
			st, _ := engine.StartBulk(ctx, lyrics.BulkRequest{Action: lyrics.BulkMissing, TrackIDs: []string{"t1", "t2", "t3"}})
			done := wait(st.ID)
			Expect(done.Found).To(Equal(2))
			Expect(done.Kept).To(Equal(1))
			calls := fake.calls.Load()

			st, _ = engine.StartBulk(ctx, lyrics.BulkRequest{Action: lyrics.BulkMissing, TrackIDs: []string{"t1", "t2", "t3"}})
			done = wait(st.ID)
			Expect(done.Found).To(BeZero())
			Expect(fake.calls.Load()).To(Equal(calls), "nothing left to look up")
		})

		It("upgrades only downloaded lyrics unless manual replacement is confirmed", func() {
			Expect(os.WriteFile(filepath.Join(dir(), "t1.lrc"), []byte("plain sidecar"), 0o644)).To(Succeed())
			fake.set(remote("fake", "k", karaokeOf("karaoke"), 0.97))
			st, _ := engine.StartBulk(ctx, lyrics.BulkRequest{Action: lyrics.BulkUpgrade, TrackIDs: []string{"t1"}})
			done := wait(st.ID)
			Expect(done.Upgraded).To(BeZero())
			Expect(filepath.Join(dir(), "t1.lyrics.json")).ToNot(BeAnExistingFile())
		})

		It("needs explicit confirmation to replace manual sidecars in bulk", func() {
			_, err := engine.StartBulk(ctx, lyrics.BulkRequest{Action: lyrics.BulkReplaceManual, TrackIDs: []string{"t1"}})
			Expect(err).To(MatchError(lyrics.ErrConfirmRequired))

			Expect(os.WriteFile(filepath.Join(dir(), "t1.lrc"), []byte("plain sidecar"), 0o644)).To(Succeed())
			fake.set(remote("fake", "k", karaokeOf("karaoke"), 0.97))
			st, err := engine.StartBulk(ctx, lyrics.BulkRequest{Action: lyrics.BulkReplaceManual, TrackIDs: []string{"t1"}, Confirm: true})
			Expect(err).ToNot(HaveOccurred())
			Expect(wait(st.ID).Upgraded).To(Equal(1))
			raw, _ := os.ReadFile(filepath.Join(dir(), "t1.lrc"))
			Expect(string(raw)).To(Equal("plain sidecar"), "the original file is still there")
		})

		It("runs one job at a time", func() {
			fake.delay = 200 * time.Millisecond
			fake.set(remote("fake", "1", syncedOf("fetched"), 0.97))
			st, err := engine.StartBulk(ctx, lyrics.BulkRequest{Action: lyrics.BulkMissing, TrackIDs: []string{"t1", "t2", "t3"}})
			Expect(err).ToNot(HaveOccurred())
			_, err = engine.StartBulk(ctx, lyrics.BulkRequest{Action: lyrics.BulkMissing, TrackIDs: []string{"t1"}})
			Expect(err).To(MatchError(lyrics.ErrBusy))
			Expect(engine.CancelBulk(st.ID)).To(BeTrue())
			Expect(wait(st.ID).State).To(Equal("cancelled"))
		})

		It("uses no more workers than there are tracks", func() {
			fake.delay = 60 * time.Millisecond
			fake.set(remote("fake", "1", syncedOf("fetched"), 0.97))
			st, _ := engine.StartBulk(ctx, lyrics.BulkRequest{Action: lyrics.BulkMissing, TrackIDs: []string{"t1", "t2", "t3"}})
			Expect(wait(st.ID).Done).To(Equal(3))
			Expect(fake.peak.Load()).To(Equal(int32(3)))
		})

		Describe("with many tracks", func() {
			all12 := []string{"t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9", "t10", "t11", "t12"}
			BeforeEach(func() { addTracks(12) })

			It("works on four tracks at once, no more, and counts every track exactly once", func() {
				fake.delay = 80 * time.Millisecond
				fake.set(remote("fake", "1", syncedOf("fetched"), 0.97))
				st, err := engine.StartBulk(ctx, lyrics.BulkRequest{Action: lyrics.BulkMissing, TrackIDs: all12})
				Expect(err).ToNot(HaveOccurred())
				done := wait(st.ID)
				Expect(done.State).To(Equal("done"))
				Expect(done.Total).To(Equal(12))
				Expect(done.Done).To(Equal(12))
				Expect(done.Found).To(Equal(12))
				Expect(fake.peak.Load()).To(Equal(int32(4)), "four searches overlapped, never more")
				for _, id := range all12 {
					Expect(filepath.Join(dir(), id+".lyrics.json")).To(BeAnExistingFile())
				}
			})

			It("stops every worker when cancelled, and keeps what was finished", func() {
				fake.delay = 120 * time.Millisecond
				fake.set(remote("fake", "1", syncedOf("fetched"), 0.97))
				st, _ := engine.StartBulk(ctx, lyrics.BulkRequest{Action: lyrics.BulkMissing, TrackIDs: all12})
				Eventually(func() int32 { return fake.calls.Load() }, 2*time.Second, 10*time.Millisecond).Should(BeNumerically(">=", 1))
				Expect(engine.CancelBulk(st.ID)).To(BeTrue())
				done := wait(st.ID)
				Expect(done.State).To(Equal("cancelled"))
				Expect(done.Done).To(BeNumerically("<", 12))
				Expect(fake.active.Load()).To(BeZero(), "no worker is left running")
				time.Sleep(250 * time.Millisecond)
				Expect(fake.calls.Load()).To(BeNumerically("<", 12), "nothing new started after the cancel")
			})

			It("stops when a provider asks to slow down, without starting new tracks", func() {
				fake.mu.Lock()
				fake.err = &lyrics.RateLimitedError{Provider: "fake", RetryAfter: 45 * time.Second}
				fake.mu.Unlock()
				st, _ := engine.StartBulk(ctx, lyrics.BulkRequest{Action: lyrics.BulkMissing, TrackIDs: all12})
				done := wait(st.ID)
				Expect(done.Done).To(BeNumerically("<=", 4), "only the tracks already running finished")
				Expect(done.Done).To(BeNumerically(">=", 1))
				Expect(done.Done).To(BeNumerically("<", 12))
				Expect(done.Message).To(ContainSubstring("slow down"))
			})
		})

		It("rejects an unknown action and an empty selection", func() {
			_, err := engine.StartBulk(ctx, lyrics.BulkRequest{Action: "nuke", TrackIDs: []string{"t1"}})
			Expect(err).To(HaveOccurred())
			_, err = engine.StartBulk(ctx, lyrics.BulkRequest{Action: lyrics.BulkMissing})
			Expect(err).To(HaveOccurred())
		})

		It("reports an unknown job", func() {
			_, ok := engine.Bulk("nope")
			Expect(ok).To(BeFalse())
			Expect(engine.CancelBulk("nope")).To(BeFalse())
		})
	})
})

// writeManaged stores a downloaded sidecar directly, as if it had been fetched
// earlier, so tests can combine it with local lyrics that would otherwise have
// prevented the download.
func writeManaged(hist string, mf *model.MediaFile, list model.LyricList) {
	c := remote("fake", "earlier", list)
	_, err := lyrics.NewStore(hist, 10).Save(lyrics.Target{Root: mf.LibraryPath, AudioRel: mf.Path}, lyrics.NewEnvelope(c, lyrics.OriginManaged, time.Now()))
	Expect(err).ToNot(HaveOccurred())
}

func mustJSON(list model.LyricList) string {
	raw, err := json.Marshal(list)
	Expect(err).ToNot(HaveOccurred())
	return string(raw)
}

// saveManaged stores downloaded lyrics through the normal automatic path, so
// the test uses the same code as production. The default is synced lyrics.
func saveManaged(ctx context.Context, engine lyrics.Engine, mf *model.MediaFile, fake *fakeProvider, id string, list ...model.LyricList) {
	l := syncedOf("managed text")
	if len(list) > 0 {
		l = list[0]
	}
	fake.set(remote("fake", id, l, 0.97))
	res, err := engine.Resolve(ctx, mf, lyrics.ResolveOptions{Explicit: true, Recheck: true})
	Expect(err).ToNot(HaveOccurred())
	Expect(res.Result).To(Equal(lyrics.ResolveFound))
	fake.set()
}

func saveManagedKaraoke(ctx context.Context, engine lyrics.Engine, mf *model.MediaFile, fake *fakeProvider) {
	saveManaged(ctx, engine, mf, fake, "k", karaokeOf("karaoke text"))
}
