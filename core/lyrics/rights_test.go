package lyrics_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/navidrome/navidrome/conf"
	"github.com/navidrome/navidrome/conf/configtest"
	"github.com/navidrome/navidrome/core/lyrics"
	"github.com/navidrome/navidrome/model"
	"github.com/navidrome/navidrome/tests"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("Storage rights and display", func() {
	var (
		ctx    context.Context
		root   string
		mf     *model.MediaFile
		clock  time.Time
		rights string
		fakes  map[string]*fakeProvider
		svc    lyrics.Lyrics
		engine lyrics.Engine
		props  *safeProps
	)
	dir := func() string { return filepath.Join(root, "Artist", "Album") }
	write := func(name, content string) string {
		p := filepath.Join(dir(), name)
		Expect(os.WriteFile(p, []byte(content), 0o644)).To(Succeed())
		return p
	}
	sidecar := func() string { return filepath.Join(dir(), "01 - Song.lyrics.json") }
	build := func(ids ...string) {
		fakes = map[string]*fakeProvider{}
		var list []lyrics.OnlineProvider
		for _, id := range ids {
			f := newFake(id)
			f.info.Storable = true // a provider's own say-so must not matter for the known ones
			fakes[id] = f
			list = append(list, f)
		}
		svc = lyrics.NewService(lyrics.Options{
			DataStore:  &tests.MockDataStore{MockedProperty: props},
			Providers:  lyrics.NewProviders(list...),
			Store:      lyrics.NewStore(GinkgoT().TempDir(), 10),
			Now:        func() time.Time { return clock },
			RightsFile: rights,
		})
		engine = lyrics.EngineOf(svc)
		_, err := engine.SaveSettings(ctx, lyrics.Settings{Providers: ids, MinConfidence: 0.85, PreferLocal: true, AutoRetrieve: true, AutoPersist: true, AutoUpgrade: true})
		Expect(err).ToNot(HaveOccurred())
	}
	search := func() []lyrics.Candidate {
		res, err := engine.Search(ctx, mf, lyrics.SearchOptions{})
		Expect(err).ToNot(HaveOccurred())
		return res.Candidates
	}
	lyricText := func() string {
		l, err := svc.GetLyrics(ctx, mf)
		Expect(err).ToNot(HaveOccurred())
		return firstLine(l)
	}
	status := func() lyrics.SongStatus {
		st, err := engine.Status(ctx, mf)
		Expect(err).ToNot(HaveOccurred())
		return st
	}

	BeforeEach(func() {
		DeferCleanup(configtest.SetupConfig())
		conf.Server.LyricsPriority = ".lrc,embedded"
		ctx = context.Background()
		root = GinkgoT().TempDir()
		Expect(os.MkdirAll(dir(), 0o755)).To(Succeed())
		write("01 - Song.flac", "FLACDATA")
		mf = &model.MediaFile{ID: "song-1", Title: "Song", Artist: "Band", Album: "Album", Duration: 200,
			Path: "Artist/Album/01 - Song.flac", LibraryPath: root}
		clock = time.Date(2026, 10, 26, 12, 0, 0, 0, time.UTC)
		rights = filepath.Join(GinkgoT().TempDir(), "lyrics-storage-rights.json")
		props = &safeProps{}
	})

	Describe("what is known about each provider, and what the administrator wants", func() {
		It("starts with every provider's terms 'unclear', LRCLIB saved by default and the others not", func() {
			svc := lyrics.NewService(lyrics.Options{
				DataStore:  &tests.MockDataStore{MockedProperty: props},
				Store:      lyrics.NewStore(GinkgoT().TempDir(), 10),
				RightsFile: rights,
			})
			got := map[string]lyrics.ProviderStatus{}
			for _, p := range lyrics.EngineOf(svc).Providers(ctx) {
				got[p.ID] = p
			}
			for _, id := range []string{"lrclib", "kugou", "netease", "qq", "musixmatch"} {
				Expect(got[id].StoreStatus).To(Equal(lyrics.RightsUnclear), id)
				Expect(got[id].StoreVerified).To(BeFalse(), id+": nothing is documented")
				Expect(got[id].StoreAllowed).To(BeTrue(), id+": nothing says it is forbidden")
				Expect(got[id].StoreBasis).ToNot(BeEmpty(), id)
				Expect(got[id].SavePreferenceSource).To(Equal(lyrics.PrefDefault), id)
			}
			Expect(got["lrclib"].SavePreference).To(BeTrue(), "as it always was")
			Expect(got["lrclib"].StoreBasis).To(ContainSubstring("could not be found"))
			for _, id := range []string{"kugou", "netease", "qq", "musixmatch"} {
				Expect(got[id].SavePreference).To(BeFalse(), id+" is saved only when asked for")
			}
			Expect(got["kugou"].Display).To(Equal(lyrics.DisplaySession))
			Expect(got["musixmatch"].Display).To(Equal(lyrics.DisplayPreview))
			Expect(got["kugou"].Offline).To(Equal("when-saved"), "offline once it has been saved")
		})

		It("sets what a result may do from the rights and the preference, not from the provider's own claim", func() {
			build("lrclib", "kugou", "musixmatch")
			for id, f := range fakes {
				f.set(remote(id, "1", syncedOf(id+" lyrics"), 0.99)) // remote() claims Storable
			}
			by := map[string]lyrics.Candidate{}
			for _, c := range search() {
				by[c.Provider] = c
			}
			Expect(by["lrclib"].Storable && by["lrclib"].AutoSave).To(BeTrue())
			Expect(by["kugou"].Storable).To(BeTrue(), "saving by hand is not ruled out")
			Expect(by["kugou"].AutoSave).To(BeFalse(), "not asked for automatically")
			Expect(by["kugou"].CanShow).To(BeTrue())
			Expect(by["kugou"].Rights).To(Equal(lyrics.RightsUnclear))
			Expect(by["musixmatch"].CanShow).To(BeFalse(), "preview only: not even shown while playing")
		})

		It("turns on automatic saving for one provider, by an explicit choice that beats the older list", func() {
			build("lrclib", "kugou", "netease")
			for id, f := range fakes {
				f.set(remote(id, "1", karaokeOf(id+" karaoke"), 0.99))
			}
			s := engine.Settings(ctx)
			s.StorePref = map[string]bool{"kugou": true}
			s.Store = []string{"netease"} // the list an earlier version kept
			_, err := engine.SaveSettings(ctx, s)
			Expect(err).ToNot(HaveOccurred())
			by := map[string]lyrics.Candidate{}
			for _, c := range search() {
				by[c.Provider] = c
			}
			Expect(by["kugou"].AutoSave).To(BeTrue())
			Expect(by["netease"].AutoSave).To(BeTrue(), "the earlier list is still honoured as a preference")
			var src = map[string]string{}
			for _, p := range engine.Providers(ctx) {
				src[p.ID] = p.SavePreferenceSource
			}
			Expect(src).To(HaveKeyWithValue("kugou", lyrics.PrefChosen))
			Expect(src).To(HaveKeyWithValue("netease", lyrics.PrefLegacy))
			Expect(src).To(HaveKeyWithValue("lrclib", lyrics.PrefDefault))

			s.StorePref = map[string]bool{"kugou": true, "netease": false}
			_, err = engine.SaveSettings(ctx, s)
			Expect(err).ToNot(HaveOccurred())
			for _, c := range search() {
				if c.Provider == "netease" {
					Expect(c.AutoSave).To(BeFalse(), "an explicit 'no' beats the earlier list")
				}
			}
			Expect(engine.Settings(ctx).Store).To(Equal([]string{"netease"}), "the earlier list is kept as it was")
		})

		It("saves nothing automatically when automatic saving is off, but still shows", func() {
			build("lrclib")
			fakes["lrclib"].set(remote("lrclib", "1", syncedOf("synced"), 0.99))
			s := engine.Settings(ctx)
			s.AutoPersist = false
			_, err := engine.SaveSettings(ctx, s)
			Expect(err).ToNot(HaveOccurred())
			res, err := engine.Resolve(ctx, mf, lyrics.ResolveOptions{})
			Expect(err).ToNot(HaveOccurred())
			Expect(res.Result).To(Equal(lyrics.ResolveFound))
			Expect(res.Persisted).To(BeFalse())
			Expect(sidecar()).ToNot(BeAnExistingFile())
			Expect(lyricText()).To(Equal("synced"), "shown, not saved")
		})

		It("drops unknown providers from the preferences and keeps the rest", func() {
			build("kugou")
			s := engine.Settings(ctx)
			s.StorePref = map[string]bool{"kugou": true, "nobody": true}
			saved, err := engine.SaveSettings(ctx, s)
			Expect(err).ToNot(HaveOccurred())
			Expect(saved.StorePref).To(Equal(map[string]bool{"kugou": true}))
		})
	})

	Describe("documented rights", func() {
		const granted = `{"authorizations":[{"provider":"kugou","basis":"Licence agreement of 2026-11-02","reference":"contract no. 4711"}]}`
		const restricted = `{"authorizations":[{"provider":"kugou","status":"restricted","basis":"Terms, section on caching","reference":"https://example.org/terms"}]}`
		status := func(id string) lyrics.ProviderStatus {
			for _, p := range engine.Providers(ctx) {
				if p.ID == id {
					return p
				}
			}
			Fail("no provider " + id)
			return lyrics.ProviderStatus{}
		}

		It("records an authorization as 'granted' and verified, with its basis, and makes saving the default", func() {
			Expect(os.WriteFile(rights, []byte(granted), 0o644)).To(Succeed())
			build("kugou", "netease")
			kg := status("kugou")
			Expect(kg.StoreStatus).To(Equal(lyrics.RightsGranted))
			Expect(kg.StoreVerified).To(BeTrue())
			Expect(kg.StoreBasis).To(Equal("Licence agreement of 2026-11-02"))
			Expect(kg.StoreReference).To(Equal("contract no. 4711"))
			Expect(kg.SavePreference).To(BeTrue())
			Expect(status("netease").StoreStatus).To(Equal(lyrics.RightsUnclear), "only the provider named in the record")
		})

		It("refuses to save a provider whose recorded terms restrict it, whatever the preference", func() {
			Expect(os.WriteFile(rights, []byte(restricted), 0o644)).To(Succeed())
			build("kugou")
			s := engine.Settings(ctx)
			s.StorePref = map[string]bool{"kugou": true}
			_, err := engine.SaveSettings(ctx, s)
			Expect(err).ToNot(HaveOccurred())
			fakes["kugou"].set(remote("kugou", "1", karaokeOf("restricted karaoke"), 0.99))

			kg := status("kugou")
			Expect(kg.StoreStatus).To(Equal(lyrics.RightsRestricted))
			Expect(kg.StoreAllowed).To(BeFalse())
			Expect(kg.SavePreference).To(BeFalse(), "the wish cannot override the recorded terms")
			Expect(kg.Offline).To(Equal("no"))

			c := search()[0]
			Expect(c.Storable || c.AutoSave).To(BeFalse())
			Expect(c.DisplayOnly).To(BeTrue(), "it can still be shown")

			res, err := engine.Resolve(ctx, mf, lyrics.ResolveOptions{})
			Expect(err).ToNot(HaveOccurred())
			Expect(res.Persisted).To(BeFalse())
			Expect(sidecar()).ToNot(BeAnExistingFile())

			_, err = engine.Apply(ctx, mf, lyrics.ApplyRequest{CandidateID: c.ID, Mode: lyrics.ModeSave})
			Expect(err).To(MatchError(lyrics.ErrStorageRestricted))
			shown, err := engine.Apply(ctx, mf, lyrics.ApplyRequest{CandidateID: c.ID, Mode: lyrics.ModeShow, Confirm: true})
			Expect(err).ToNot(HaveOccurred())
			Expect(shown.NotSaved).To(BeTrue())
		})

		It("is withdrawn when the record is removed", func() {
			Expect(os.WriteFile(rights, []byte(granted), 0o644)).To(Succeed())
			build("kugou")
			Expect(status("kugou").StoreVerified).To(BeTrue())
			Expect(os.Remove(rights)).To(Succeed())
			clock = clock.Add(time.Minute)
			Expect(status("kugou").StoreStatus).To(Equal(lyrics.RightsUnclear))
		})

		DescribeTable("changes nothing unless it names a known provider, a known status and its basis",
			func(content string) {
				Expect(os.WriteFile(rights, []byte(content), 0o644)).To(Succeed())
				build("kugou", "musixmatch")
				Expect(status("kugou").StoreStatus).To(Equal(lyrics.RightsUnclear))
				Expect(status("musixmatch").StoreStatus).To(Equal(lyrics.RightsUnclear))
			},
			Entry("no reference", `{"authorizations":[{"provider":"kugou","basis":"a contract"}]}`),
			Entry("no basis", `{"authorizations":[{"provider":"kugou","reference":"no. 1"}]}`),
			Entry("blank fields", `{"authorizations":[{"provider":"kugou","basis":"  ","reference":" "}]}`),
			Entry("unknown provider", `{"authorizations":[{"provider":"nobody","basis":"b","reference":"r"}]}`),
			Entry("unknown status", `{"authorizations":[{"provider":"kugou","status":"whatever","basis":"b","reference":"r"}]}`),
			Entry("not JSON", `kugou: yes please`),
			Entry("a field of absurd length", `{"authorizations":[{"provider":"kugou","basis":"`+strings.Repeat("x", 600)+`","reference":"r"}]}`),
			Entry("a boolean instead of a record", `{"authorizations":{"kugou":true}}`),
		)

		It("ignores a huge file", func() {
			Expect(os.WriteFile(rights, []byte(strings.Repeat(" ", 70<<10)+granted), 0o644)).To(Succeed())
			build("kugou")
			Expect(status("kugou").StoreStatus).To(Equal(lyrics.RightsUnclear))
		})
	})

	Describe("saving found lyrics, and using them offline", func() {
		karaoke := func() model.LyricList {
			return model.LyricList{{Kind: model.LyricKindMain, Lang: "xxx", Synced: true, Line: []model.Line{
				{Start: i64(1000), End: i64(2500), Value: "Hello world", Cue: []model.Cue{
					{Start: i64(1000), End: i64(1400), Value: "Hello ", ByteStart: 0, ByteEnd: 5},
					{Start: i64(1400), End: i64(2500), Value: "world", ByteStart: 6, ByteEnd: 10},
				}},
			}}, {Kind: model.LyricKindTranslation, Lang: "xxx", Synced: true, Line: []model.Line{{Start: i64(1000), Value: "Ciao mondo"}}}}
		}
		wantPref := func(ids ...string) {
			s := engine.Settings(ctx)
			s.StorePref = map[string]bool{}
			for _, id := range ids {
				s.StorePref[id] = true
			}
			_, err := engine.SaveSettings(ctx, s)
			Expect(err).ToNot(HaveOccurred())
		}

		It("saves genuine word timing, translation and provenance, and reloads it after a restart with no provider asked", func() {
			build("kugou")
			wantPref("kugou")
			fakes["kugou"].set(remote("kugou", "42", karaoke(), 0.99))
			res, err := engine.Resolve(ctx, mf, lyrics.ResolveOptions{})
			Expect(err).ToNot(HaveOccurred())
			Expect(res.Result).To(Equal(lyrics.ResolveFound))
			Expect(res.Persisted).To(BeTrue())
			Expect(sidecar()).To(BeAnExistingFile())

			raw, _ := os.ReadFile(sidecar())
			text := string(raw)
			for _, want := range []string{`"provider": "kugou"`, `"providerId": "42"`, `"quality": "karaoke"`, `"retrievedAt"`, `"Hello "`, `"start": 1400`, `"end": 2500`, `"translation"`, "Ciao mondo", `"title": "Song"`, `"artist": "Band"`} {
				Expect(text).To(ContainSubstring(want), want)
			}

			// a different process: new service, new empty memory, the same provider unreachable
			down := newFake("kugou")
			down.mu.Lock()
			down.err = lyrics.ErrProviderUnavailable
			down.mu.Unlock()
			restarted := lyrics.NewService(lyrics.Options{
				DataStore: &tests.MockDataStore{MockedProperty: props}, Providers: lyrics.NewProviders(down),
				Store: lyrics.NewStore(GinkgoT().TempDir(), 10), Now: func() time.Time { return clock }, RightsFile: rights,
			})
			got, err := restarted.GetLyrics(ctx, mf)
			Expect(err).ToNot(HaveOccurred())
			Expect(lyrics.QualityOf(got)).To(Equal(lyrics.QualityKaraoke))
			Expect(got[0].Line[0].Cue).To(HaveLen(2))
			Expect(*got[0].Line[0].Cue[1].Start).To(Equal(int64(1400)))
			Expect(*got[0].Line[0].Cue[1].End).To(Equal(int64(2500)))
			again, err := lyrics.EngineOf(restarted).Resolve(ctx, mf, lyrics.ResolveOptions{})
			Expect(err).ToNot(HaveOccurred())
			Expect(again.Result).To(Equal(lyrics.ResolveHave))
			Expect(down.calls.Load()).To(BeZero(), "no provider was contacted")
			var kg lyrics.ProviderStatus
			for _, p := range engine.Providers(ctx) {
				if p.ID == "kugou" {
					kg = p
				}
			}
			Expect(kg.LastSave).ToNot(BeNil())
			Expect(kg.LastSave.OK).To(BeTrue())
		})

		It("shows without saving when the preference is off, and saves when asked by hand", func() {
			build("kugou")
			fakes["kugou"].set(remote("kugou", "1", karaoke(), 0.99))
			res, err := engine.Resolve(ctx, mf, lyrics.ResolveOptions{})
			Expect(err).ToNot(HaveOccurred())
			Expect(res.Persisted).To(BeFalse())
			Expect(sidecar()).ToNot(BeAnExistingFile())
			Expect(lyrics.QualityOf(mustLyrics(svc.GetLyrics(ctx, mf)))).To(Equal(lyrics.QualityKaraoke))

			c := search()[0]
			saved, err := engine.Apply(ctx, mf, lyrics.ApplyRequest{CandidateID: c.ID, Mode: lyrics.ModeSave})
			Expect(err).ToNot(HaveOccurred())
			Expect(saved.NotSaved).To(BeFalse())
			Expect(sidecar()).To(BeAnExistingFile())
			Expect(status().Current.Source).To(Equal("user"), "an explicit choice is saved as the administrator's own")
		})

		It("saves a manual choice only after it has been read back, and says so", func() {
			build("kugou")
			fakes["kugou"].set(remote("kugou", "1", karaoke(), 0.99))
			c := search()[0]
			Expect(status().Current).To(BeNil())
			saved, err := engine.Apply(ctx, mf, lyrics.ApplyRequest{CandidateID: c.ID, Mode: lyrics.ModeSave})
			Expect(err).ToNot(HaveOccurred())
			Expect(saved.NotSaved).To(BeFalse())
			Expect(saved.Status.Current.Provider).To(Equal("kugou"))
			Expect(saved.Status.Current.Quality).To(Equal("karaoke"))
			env, _ := lyrics.ReadEnvelopeForTest(ctx, mf)
			Expect(env).ToNot(BeNil())
			Expect(lyrics.CueCountForTest(env.Lyrics)).To(Equal(2))
		})

		It("reports a failed save and keeps the track's lyrics as they were", func() {
			build("kugou")
			wantPref("kugou")
			fakes["kugou"].set(remote("kugou", "1", karaoke(), 0.99))
			Expect(os.Chmod(dir(), 0o555)).To(Succeed())
			DeferCleanup(func() { _ = os.Chmod(dir(), 0o755) })
			res, err := engine.Resolve(ctx, mf, lyrics.ResolveOptions{})
			Expect(err).ToNot(HaveOccurred())
			Expect(res.Persisted).To(BeFalse())
			Expect(sidecar()).ToNot(BeAnExistingFile())
			var kg lyrics.ProviderStatus
			for _, p := range engine.Providers(ctx) {
				if p.ID == "kugou" {
					kg = p
				}
			}
			Expect(kg.LastSave).ToNot(BeNil())
			Expect(kg.LastSave.OK).To(BeFalse())
			Expect(kg.LastSave.Message).ToNot(BeEmpty())
		})
	})

	Describe("quality upgrades", func() {
		wantKuGou := func() {
			s := engine.Settings(ctx)
			s.StorePref = map[string]bool{"kugou": true}
			_, err := engine.SaveSettings(ctx, s)
			Expect(err).ToNot(HaveOccurred())
		}
		It("replaces line-synced LRCLIB lyrics with word-timed KuGou ones, keeping the earlier version", func() {
			build("lrclib", "kugou")
			wantKuGou()
			fakes["lrclib"].set(remote("lrclib", "1", syncedOf("line synced"), 0.99))
			res, err := engine.Resolve(ctx, mf, lyrics.ResolveOptions{})
			Expect(err).ToNot(HaveOccurred())
			Expect(res.Persisted).To(BeTrue())
			Expect(lyricText()).To(Equal("line synced"))

			fakes["kugou"].set(remote("kugou", "1", karaokeOf("word timed"), 0.99))
			clock = clock.Add(8 * 24 * time.Hour) // past the interval between upgrade checks
			up, err := engine.Resolve(ctx, mf, lyrics.ResolveOptions{})
			Expect(err).ToNot(HaveOccurred())
			Expect(up.Result).To(Equal(lyrics.ResolveUpgraded))
			Expect(lyricText()).To(Equal("word timed"))
			cur := status().Current
			Expect(cur.Source).To(Equal("managed"))
			Expect(cur.Provider).To(Equal("kugou"))
			Expect(cur.Quality).To(Equal("karaoke"))
			Expect(status().History).ToNot(BeEmpty(), "the earlier version is in the history")
			raw, _ := os.ReadFile(sidecar())
			Expect(string(raw)).ToNot(ContainSubstring("line synced"))
		})

		It("never downgrades, never upgrades a locked track, and never trusts a doubtful match", func() {
			build("lrclib", "kugou")
			wantKuGou()
			fakes["kugou"].set(remote("kugou", "1", karaokeOf("word timed"), 0.99))
			_, err := engine.Resolve(ctx, mf, lyrics.ResolveOptions{})
			Expect(err).ToNot(HaveOccurred())
			Expect(lyricText()).To(Equal("word timed"))

			// a later, merely line-synced result does not replace karaoke
			fakes["lrclib"].set(remote("lrclib", "2", syncedOf("line synced"), 0.99))
			clock = clock.Add(8 * 24 * time.Hour)
			res, err := engine.Resolve(ctx, mf, lyrics.ResolveOptions{Recheck: true})
			Expect(err).ToNot(HaveOccurred())
			Expect(res.Result).To(Equal(lyrics.ResolveHave))
			Expect(lyricText()).To(Equal("word timed"))
		})

		It("does not upgrade to a karaoke result for another recording", func() {
			build("lrclib", "kugou")
			wantKuGou()
			fakes["lrclib"].set(remote("lrclib", "1", syncedOf("line synced"), 0.99))
			_, err := engine.Resolve(ctx, mf, lyrics.ResolveOptions{})
			Expect(err).ToNot(HaveOccurred())
			fakes["kugou"].set(remote("kugou", "9", karaokeOf("wrong song karaoke"), 0.5))
			clock = clock.Add(8 * 24 * time.Hour)
			res, err := engine.Resolve(ctx, mf, lyrics.ResolveOptions{})
			Expect(err).ToNot(HaveOccurred())
			Expect(res.Result).To(Equal(lyrics.ResolveKept))
			Expect(lyricText()).To(Equal("line synced"))
		})

		It("respects a lock", func() {
			build("lrclib", "kugou")
			wantKuGou()
			fakes["lrclib"].set(remote("lrclib", "1", syncedOf("line synced"), 0.99))
			_, err := engine.Resolve(ctx, mf, lyrics.ResolveOptions{})
			Expect(err).ToNot(HaveOccurred())
			Expect(engine.SetLocked(ctx, mf, true)).To(Succeed())
			fakes["kugou"].set(remote("kugou", "1", karaokeOf("word timed"), 0.99))
			clock = clock.Add(8 * 24 * time.Hour)
			res, err := engine.Resolve(ctx, mf, lyrics.ResolveOptions{Recheck: true})
			Expect(err).ToNot(HaveOccurred())
			Expect(res.Result).To(Equal(lyrics.ResolveLocked))
			Expect(lyricText()).To(Equal("line synced"))
		})
	})

	Describe("several requests at once", func() {
		It("asks the providers once for simultaneous requests for the same track, and writes one valid sidecar", func() {
			build("lrclib")
			fakes["lrclib"].delay = 150 * time.Millisecond
			fakes["lrclib"].set(remote("lrclib", "1", syncedOf("synced"), 0.99))
			var wg sync.WaitGroup
			for i := 0; i < 8; i++ {
				wg.Add(1)
				go func() {
					defer wg.Done()
					defer GinkgoRecover()
					_, err := engine.Resolve(ctx, mf, lyrics.ResolveOptions{})
					Expect(err).ToNot(HaveOccurred())
				}()
			}
			wg.Wait()
			Expect(fakes["lrclib"].calls.Load()).To(Equal(int32(1)))
			Expect(sidecar()).To(BeAnExistingFile())
			Expect(lyricText()).To(Equal("synced"))
			entries, _ := os.ReadDir(dir())
			for _, e := range entries {
				Expect(e.Name()).ToNot(ContainSubstring(".tmp"), "no temporary file is left behind")
			}
		})

		It("keeps one valid sidecar when two different versions are saved at the same moment", func() {
			build("lrclib")
			fakes["lrclib"].set(remote("lrclib", "1", syncedOf("first version"), 0.99), remote("lrclib", "2", syncedOf("second version"), 0.98))
			cands := search()
			var wg sync.WaitGroup
			for _, c := range cands {
				wg.Add(1)
				go func() {
					defer wg.Done()
					defer GinkgoRecover()
					_, err := engine.Apply(ctx, mf, lyrics.ApplyRequest{CandidateID: c.ID, Mode: lyrics.ModeSave, Confirm: true, Force: true})
					Expect(err).ToNot(HaveOccurred())
				}()
			}
			wg.Wait()
			Expect(lyricText()).To(BeElementOf("first version", "second version"))
			raw, _ := os.ReadFile(sidecar())
			Expect(json.Valid(raw)).To(BeTrue(), "the sidecar is whole, not a mix of two writes")
		})
	})

	Describe("one process, several routers", func() {
		It("shows to a second service what the first one chose to show, as the player's router must see it", func() {
			opts := func(f *fakeProvider) lyrics.Options {
				return lyrics.Options{
					DataStore: &tests.MockDataStore{MockedProperty: props}, Providers: lyrics.NewProviders(f),
					Store: lyrics.NewStore(GinkgoT().TempDir(), 10), Now: func() time.Time { return clock },
					RightsFile: rights, ShareState: true,
				}
			}
			api := newFake("kugou")
			api.set(remote("kugou", "1", karaokeOf("shown karaoke"), 0.99))
			native := lyrics.NewService(opts(api))
			subsonic := lyrics.NewService(opts(newFake("kugou")))
			_, err := lyrics.EngineOf(native).SaveSettings(ctx, lyrics.Settings{Providers: []string{"kugou"}, MinConfidence: 0.85, PreferLocal: true, AutoRetrieve: true, AutoPersist: true})
			Expect(err).ToNot(HaveOccurred())

			res, err := lyrics.EngineOf(native).Resolve(ctx, mf, lyrics.ResolveOptions{})
			Expect(err).ToNot(HaveOccurred())
			Expect(res.Result).To(Equal(lyrics.ResolveFound))
			got, err := subsonic.GetLyrics(ctx, mf)
			Expect(err).ToNot(HaveOccurred())
			Expect(firstLine(got)).To(Equal("shown karaoke"))
		})
	})

	Describe("showing lyrics that may not be kept", func() {
		BeforeEach(func() {
			build("kugou")
			fakes["kugou"].set(remote("kugou", "1", karaokeOf("shown karaoke"), 0.99))
		})
		choose := func(opts ...func(*lyrics.ApplyRequest)) (lyrics.ApplyResult, error) {
			req := lyrics.ApplyRequest{CandidateID: search()[0].ID, Mode: lyrics.ModeShow}
			for _, o := range opts {
				o(&req)
			}
			return engine.Apply(ctx, mf, req)
		}

		It("shows the chosen version, writes nothing, and says it is not saved", func() {
			res, err := choose()
			Expect(err).ToNot(HaveOccurred())
			Expect(res.NotSaved).To(BeTrue())
			Expect(res.Action).To(Equal("shown-not-saved"))
			Expect(sidecar()).ToNot(BeAnExistingFile())
			Expect(lyricText()).To(Equal("shown karaoke"))
			cur := status().Current
			Expect(cur.Source).To(Equal("remote"))
			Expect(cur.Origin).To(Equal("chosen"))
			Expect(cur.Provider).To(Equal("kugou"))
			Expect(cur.Quality).To(Equal("karaoke"))
			entries, _ := os.ReadDir(dir())
			Expect(entries).To(HaveLen(1), "only the audio is in the folder")
		})

		It("is gone after a restart and after twelve hours, and never offline", func() {
			_, err := choose()
			Expect(err).ToNot(HaveOccurred())
			Expect(lyricText()).To(Equal("shown karaoke"))

			restarted := lyrics.NewService(lyrics.Options{
				DataStore: &tests.MockDataStore{MockedProperty: props}, Providers: lyrics.NewProviders(fakes["kugou"]),
				Store: lyrics.NewStore(GinkgoT().TempDir(), 10), Now: func() time.Time { return clock }, RightsFile: rights,
			})
			l, err := restarted.GetLyrics(ctx, mf)
			Expect(err).ToNot(HaveOccurred())
			Expect(l).To(BeEmpty(), "memory only: nothing survives a restart")

			clock = clock.Add(13 * time.Hour)
			Expect(lyricText()).To(BeEmpty())
		})

		It("needs the usual confirmation to replace the administrator's own lyrics, and leaves them untouched", func() {
			lrc := write("01 - Song.lrc", "[00:01.00]my own line")
			before, _ := os.ReadFile(lrc)
			_, err := choose()
			Expect(err).To(MatchError(lyrics.ErrConfirmRequired))
			res, err := choose(func(r *lyrics.ApplyRequest) { r.Confirm = true })
			Expect(err).ToNot(HaveOccurred())
			Expect(res.NotSaved).To(BeTrue())
			Expect(lyricText()).To(Equal("shown karaoke"))
			after, _ := os.ReadFile(lrc)
			Expect(after).To(Equal(before), "the .lrc is byte-identical")

			clock = clock.Add(13 * time.Hour)
			Expect(lyricText()).To(Equal("my own line"), "when it lapses the local file is what is shown again")
		})

		It("respects a source lock", func() {
			_, err := engine.Import(ctx, mf, lyrics.ImportRequest{FileName: "mine.lrc", Content: []byte("[00:01.00]locked line")})
			Expect(err).ToNot(HaveOccurred())
			Expect(engine.SetLocked(ctx, mf, true)).To(Succeed())
			_, err = choose()
			Expect(err).To(MatchError(lyrics.ErrLocked))
			Expect(lyricText()).To(Equal("locked line"))
			res, err := choose(func(r *lyrics.ApplyRequest) { r.Force, r.Confirm = true, true })
			Expect(err).ToNot(HaveOccurred())
			Expect(res.NotSaved).To(BeTrue())
		})

		It("is replaced by lyrics that are saved afterwards", func() {
			_, err := choose()
			Expect(err).ToNot(HaveOccurred())
			_, err = engine.Import(ctx, mf, lyrics.ImportRequest{FileName: "mine.lrc", Content: []byte("[00:01.00]imported"), Confirm: true})
			Expect(err).ToNot(HaveOccurred())
			Expect(lyricText()).To(Equal("imported"))
			Expect(sidecar()).To(BeAnExistingFile())
		})
	})

	Describe("automatic retrieval", func() {
		It("saves what may be saved and shows the better result that may not, and asks once", func() {
			build("lrclib", "kugou")
			fakes["lrclib"].set(remote("lrclib", "1", syncedOf("saved synced"), 0.99))
			fakes["kugou"].set(remote("kugou", "1", karaokeOf("shown karaoke"), 0.99))
			res, err := engine.Resolve(ctx, mf, lyrics.ResolveOptions{})
			Expect(err).ToNot(HaveOccurred())
			Expect(res.Result).To(Equal(lyrics.ResolveFound))
			Expect(res.Persisted).To(BeTrue(), "the LRCLIB copy was saved")
			Expect(sidecar()).To(BeAnExistingFile())
			raw, _ := os.ReadFile(sidecar())
			Expect(string(raw)).To(ContainSubstring("saved synced"))
			Expect(string(raw)).ToNot(ContainSubstring("shown karaoke"), "the karaoke was never written")
			Expect(lyricText()).To(Equal("shown karaoke"), "karaoke beats synced, as ever")
			cur := status().Current
			Expect(cur.Source).To(Equal("remote"))
			Expect(cur.Origin).To(Equal("auto"))

			calls := fakes["kugou"].calls.Load()
			again, err := engine.Resolve(ctx, mf, lyrics.ResolveOptions{})
			Expect(err).ToNot(HaveOccurred())
			Expect(again.Result).To(Equal(lyrics.ResolveHave))
			Expect(fakes["kugou"].calls.Load()).To(Equal(calls), "no new request while it is held")

			clock = clock.Add(13 * time.Hour)
			Expect(lyricText()).To(Equal("saved synced"), "offline, the saved copy is what remains")
		})

		It("shows, without saving anything, when no provider may keep lyrics", func() {
			build("kugou")
			fakes["kugou"].set(remote("kugou", "1", karaokeOf("shown karaoke"), 0.99))
			res, err := engine.Resolve(ctx, mf, lyrics.ResolveOptions{})
			Expect(err).ToNot(HaveOccurred())
			Expect(res.Result).To(Equal(lyrics.ResolveFound))
			Expect(res.Persisted).To(BeFalse())
			Expect(sidecar()).ToNot(BeAnExistingFile())
			Expect(lyricText()).To(Equal("shown karaoke"))
		})

		It("keeps local files first: a shown result never outranks them while local lyrics are preferred", func() {
			build("kugou")
			fakes["kugou"].set(remote("kugou", "1", karaokeOf("shown karaoke"), 0.99))
			_, err := engine.Resolve(ctx, mf, lyrics.ResolveOptions{})
			Expect(err).ToNot(HaveOccurred())
			write("01 - Song.lrc", "[00:01.00]my own line")
			Expect(lyricText()).To(Equal("my own line"))

			s := engine.Settings(ctx)
			s.PreferLocal = false
			_, err = engine.SaveSettings(ctx, s)
			Expect(err).ToNot(HaveOccurred())
			Expect(lyricText()).To(Equal("shown karaoke"), "with local lyrics not preferred, better quality wins")
		})

		It("a bulk job does not fill memory with lyrics it may not keep", func() {
			build("kugou")
			fakes["kugou"].set(remote("kugou", "1", karaokeOf("shown karaoke"), 0.99))
			res, err := engine.Resolve(ctx, mf, lyrics.ResolveOptions{Explicit: true, NoDisplay: true})
			Expect(err).ToNot(HaveOccurred())
			Expect(res.Result).To(Equal(lyrics.ResolveNotSaved))
			Expect(lyricText()).To(BeEmpty())
			Expect(sidecar()).ToNot(BeAnExistingFile())
		})

		It("a provider limited to preview is neither saved nor shown automatically, and cannot be shown by choice", func() {
			build("musixmatch")
			fakes["musixmatch"].set(remote("musixmatch", "1", syncedOf("preview only"), 0.99))
			res, err := engine.Resolve(ctx, mf, lyrics.ResolveOptions{})
			Expect(err).ToNot(HaveOccurred())
			Expect(res.Result).To(Equal(lyrics.ResolveNotSaved))
			Expect(lyricText()).To(BeEmpty())
			_, err = engine.Apply(ctx, mf, lyrics.ApplyRequest{CandidateID: search()[0].ID, Mode: lyrics.ModeShow})
			Expect(err).To(MatchError(lyrics.ErrNotStorable))
		})

		It("a provider limited to preview can still be saved by an explicit choice, since nothing forbids it", func() {
			build("musixmatch")
			fakes["musixmatch"].set(remote("musixmatch", "1", syncedOf("saved by choice"), 0.99))
			res, err := engine.Apply(ctx, mf, lyrics.ApplyRequest{CandidateID: search()[0].ID, Mode: lyrics.ModeSave})
			Expect(err).ToNot(HaveOccurred())
			Expect(res.NotSaved).To(BeFalse())
			Expect(lyricText()).To(Equal("saved by choice"))
		})
	})

	Describe("a saved result that only holds credits", func() {
		const junk = `{"format":"navidrome-lyrics","version":1,"origin":"managed","provider":"netease","providerId":"1","quality":"plain","confidence":1,` +
			`"retrievedAt":"2026-10-25T12:00:00Z","attribution":"x","recording":{"title":"Song","artist":"Band","album":"Album","duration":200},` +
			`"lyrics":[{"lang":"xxx","line":[{"value":"[00:00.00-1] 作曲 : Someone"}],"synced":false}]}`

		It("is listed as ignored, and is removed only when the administrator asks", func() {
			build("lrclib")
			path := write("01 - Song.lyrics.json", junk)
			st := status()
			Expect(st.Current).To(BeNil())
			Expect(st.Ignored).To(HaveLen(1))
			Expect(st.Ignored[0].Reason).To(Equal("credits-only"))
			Expect(st.Ignored[0].File).To(Equal("01 - Song.lyrics.json"))
			Expect(path).To(BeAnExistingFile(), "listing it removes nothing")

			res, err := engine.DeleteManaged(ctx, mf)
			Expect(err).ToNot(HaveOccurred())
			Expect(res.Action).To(Equal("deleted"))
			Expect(path).ToNot(BeAnExistingFile())
			Expect(status().Ignored).To(BeEmpty())
		})

		It("is never listed for a file the user chose, which stays in use", func() {
			build("lrclib")
			write("01 - Song.lyrics.json", strings.Replace(junk, `"origin":"managed"`, `"origin":"user"`, 1))
			Expect(status().Ignored).To(BeEmpty())
			Expect(status().Current).ToNot(BeNil())
		})
	})
})
