package lyrics_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
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
		_, err := engine.SaveSettings(ctx, lyrics.Settings{Providers: ids, MinConfidence: 0.85, PreferLocal: true, AutoRetrieve: true, AutoUpgrade: true})
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

	Describe("what each provider may do by default", func() {
		It("lets only LRCLIB keep lyrics, and says that rests on an assumption", func() {
			svc := lyrics.NewService(lyrics.Options{
				DataStore:  &tests.MockDataStore{MockedProperty: props},
				Store:      lyrics.NewStore(GinkgoT().TempDir(), 10),
				RightsFile: rights,
			})
			got := map[string]lyrics.ProviderStatus{}
			for _, p := range lyrics.EngineOf(svc).Providers(ctx) {
				got[p.ID] = p
			}
			Expect(got["lrclib"].StoreEligible).To(BeTrue())
			Expect(got["lrclib"].StoreVerified).To(BeFalse(), "its terms were not found, so the permission is not verified")
			Expect(got["lrclib"].StoreBasis).To(ContainSubstring("assumption"))
			Expect(got["lrclib"].Offline).To(Equal("when-saved"))
			for _, id := range []string{"kugou", "netease", "qq"} {
				Expect(got[id].StoreEligible).To(BeFalse(), id)
				Expect(got[id].Storable).To(BeFalse(), id)
				Expect(got[id].StoreVerified).To(BeFalse(), id)
				Expect(got[id].Display).To(Equal(lyrics.DisplaySession), id+" may be shown while playing")
				Expect(got[id].Offline).To(Equal("no"), id)
			}
			Expect(got["musixmatch"].Display).To(Equal(lyrics.DisplayPreview), "only a preview")
			Expect(got["musixmatch"].StoreEligible).To(BeFalse())
			Expect(got["apple"].StoreEligible).To(BeFalse())
		})

		It("sets what a result may do from the rights, not from the provider's own claim", func() {
			build("lrclib", "kugou", "musixmatch")
			for id, f := range fakes {
				f.set(remote(id, "1", syncedOf(id+" lyrics"), 0.99)) // remote() claims Storable
			}
			by := map[string]lyrics.Candidate{}
			for _, c := range search() {
				by[c.Provider] = c
			}
			Expect(by["lrclib"].Storable).To(BeTrue())
			Expect(by["kugou"].Storable).To(BeFalse())
			Expect(by["kugou"].DisplayOnly).To(BeTrue())
			Expect(by["musixmatch"].Storable).To(BeFalse())
			Expect(by["musixmatch"].DisplayOnly).To(BeFalse(), "preview only: not even shown while playing")
		})

		It("ignores the retired Store setting, and keeps its value for the administrator to see", func() {
			build("kugou")
			s := engine.Settings(ctx)
			s.Store = []string{"kugou"}
			_, err := engine.SaveSettings(ctx, s)
			Expect(err).ToNot(HaveOccurred())
			Expect(engine.Settings(ctx).Store).To(Equal([]string{"kugou"}), "not overwritten")
			fakes["kugou"].set(remote("kugou", "1", karaokeOf("x"), 0.99))
			Expect(search()[0].Storable).To(BeFalse(), "it no longer grants anything")
		})
	})

	Describe("a storage authorization", func() {
		const valid = `{"authorizations":[{"provider":"kugou","basis":"Licence agreement of 2026-11-02","reference":"contract no. 4711"}]}`

		It("makes a provider's lyrics storable, verified, with its basis shown, and is read without a rebuild", func() {
			Expect(os.WriteFile(rights, []byte(valid), 0o644)).To(Succeed())
			build("kugou", "netease")
			fakes["kugou"].set(remote("kugou", "1", karaokeOf("x"), 0.99))
			fakes["netease"].set(remote("netease", "1", karaokeOf("y"), 0.99))
			by := map[string]lyrics.Candidate{}
			for _, c := range search() {
				by[c.Provider] = c
			}
			Expect(by["kugou"].Storable).To(BeTrue())
			Expect(by["netease"].Storable).To(BeFalse(), "only the provider named in the record")
			var kg lyrics.ProviderStatus
			for _, p := range engine.Providers(ctx) {
				if p.ID == "kugou" {
					kg = p
				}
			}
			Expect(kg.StoreEligible && kg.StoreVerified).To(BeTrue())
			Expect(kg.StoreBasis).To(Equal("Licence agreement of 2026-11-02"))
			Expect(kg.StoreReference).To(Equal("contract no. 4711"))
		})

		It("is withdrawn when the record is removed", func() {
			Expect(os.WriteFile(rights, []byte(valid), 0o644)).To(Succeed())
			build("kugou")
			fakes["kugou"].set(remote("kugou", "1", karaokeOf("x"), 0.99))
			Expect(search()[0].Storable).To(BeTrue())
			Expect(os.Remove(rights)).To(Succeed())
			clock = clock.Add(time.Minute)
			Expect(search()[0].Storable).To(BeFalse())
		})

		DescribeTable("grants nothing unless it names a known provider and its basis",
			func(content string) {
				Expect(os.WriteFile(rights, []byte(content), 0o644)).To(Succeed())
				build("kugou", "musixmatch")
				fakes["kugou"].set(remote("kugou", "1", karaokeOf("x"), 0.99))
				for _, c := range search() {
					Expect(c.Storable).To(BeFalse())
				}
			},
			Entry("no reference", `{"authorizations":[{"provider":"kugou","basis":"a contract"}]}`),
			Entry("no basis", `{"authorizations":[{"provider":"kugou","reference":"no. 1"}]}`),
			Entry("blank fields", `{"authorizations":[{"provider":"kugou","basis":"  ","reference":" "}]}`),
			Entry("unknown provider", `{"authorizations":[{"provider":"nobody","basis":"b","reference":"r"}]}`),
			Entry("not JSON", `kugou: yes please`),
			Entry("a field of absurd length", `{"authorizations":[{"provider":"kugou","basis":"`+strings.Repeat("x", 600)+`","reference":"r"}]}`),
			Entry("a boolean instead of a record", `{"authorizations":{"kugou":true}}`),
		)

		It("cannot be given to a service that returns no lyrics, and a huge file grants nothing", func() {
			Expect(os.WriteFile(rights, []byte(`{"authorizations":[{"provider":"apple","basis":"b","reference":"r"}]}`), 0o644)).To(Succeed())
			svc := lyrics.NewService(lyrics.Options{DataStore: &tests.MockDataStore{MockedProperty: props},
				Store: lyrics.NewStore(GinkgoT().TempDir(), 10), RightsFile: rights})
			for _, p := range lyrics.EngineOf(svc).Providers(ctx) {
				if p.ID == "apple" {
					Expect(p.StoreEligible).To(BeFalse())
				}
			}
			Expect(os.WriteFile(rights, []byte(strings.Repeat(" ", 70<<10)+valid), 0o644)).To(Succeed())
			build("kugou")
			fakes["kugou"].set(remote("kugou", "1", karaokeOf("x"), 0.99))
			Expect(search()[0].Storable).To(BeFalse())
		})
	})

	Describe("showing lyrics that may not be kept", func() {
		BeforeEach(func() {
			build("kugou")
			fakes["kugou"].set(remote("kugou", "1", karaokeOf("shown karaoke"), 0.99))
		})
		choose := func(opts ...func(*lyrics.ApplyRequest)) (lyrics.ApplyResult, error) {
			req := lyrics.ApplyRequest{CandidateID: search()[0].ID}
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

		It("a provider limited to preview is neither saved nor shown, and cannot be chosen", func() {
			build("musixmatch")
			fakes["musixmatch"].set(remote("musixmatch", "1", syncedOf("preview only"), 0.99))
			res, err := engine.Resolve(ctx, mf, lyrics.ResolveOptions{})
			Expect(err).ToNot(HaveOccurred())
			Expect(res.Result).To(Equal(lyrics.ResolveNotSaved))
			Expect(lyricText()).To(BeEmpty())
			_, err = engine.Apply(ctx, mf, lyrics.ApplyRequest{CandidateID: search()[0].ID})
			Expect(err).To(MatchError(lyrics.ErrNotStorable))
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
