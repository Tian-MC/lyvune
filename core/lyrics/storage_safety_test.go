package lyrics_test

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/navidrome/navidrome/conf"
	"github.com/navidrome/navidrome/conf/configtest"
	"github.com/navidrome/navidrome/core/lyrics"
	"github.com/navidrome/navidrome/model"
	"github.com/navidrome/navidrome/tests"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("Saving lyrics: defaults and local files", func() {
	var (
		ctx    context.Context
		root   string
		mf     *model.MediaFile
		fake   *fakeProvider
		engine lyrics.Engine
		svc    lyrics.Lyrics
	)
	dir := func() string { return filepath.Join(root, "Artist", "Album") }
	write := func(name, content string) string {
		p := filepath.Join(dir(), name)
		Expect(os.WriteFile(p, []byte(content), 0o644)).To(Succeed())
		return p
	}
	sidecar := func() string { return filepath.Join(dir(), "01 - Song.lyrics.json") }
	newService := func(providers ...lyrics.OnlineProvider) {
		svc = lyrics.NewService(lyrics.Options{
			DataStore: &tests.MockDataStore{MockedProperty: &safeProps{}},
			Providers: lyrics.NewProviders(providers...),
			Store:     lyrics.NewStore(GinkgoT().TempDir(), 10),
			Now:       func() time.Time { return time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC) },
		})
		engine = lyrics.EngineOf(svc)
	}

	BeforeEach(func() {
		DeferCleanup(configtest.SetupConfig())
		conf.Server.LyricsPriority = ".qrc,.krc,.yrc,.lrc,embedded"
		ctx = context.Background()
		root = GinkgoT().TempDir()
		Expect(os.MkdirAll(dir(), 0o755)).To(Succeed())
		write("01 - Song.flac", "FLACDATA")
		mf = &model.MediaFile{ID: "song-1", Title: "Song", Artist: "Band", Album: "Album", Duration: 200,
			Path: "Artist/Album/01 - Song.flac", LibraryPath: root}
		fake = newFake("fake")
		newService(fake)
	})

	Describe("defaults", func() {
		It("saves nothing from a provider that grants no permission, until it is allowed", func() {
			s := lyrics.DefaultSettings()
			Expect(s.Store).To(BeEmpty())
			Expect(s.Providers).To(Equal([]string{"lrclib"}), "only the provider with its own permission is on")
		})

		It("never saves a verified karaoke result by itself when the provider may not be saved", func() {
			c := remote("fake", "1", karaokeOf("fetched"), 0.99)
			c.Storable = false
			fake.set(c)
			fake.info.Storable = false
			_, err := engine.SaveSettings(ctx, lyrics.Settings{Providers: []string{"fake"}, MinConfidence: 0.85, AutoRetrieve: true})
			Expect(err).ToNot(HaveOccurred())
			res, err := engine.Resolve(ctx, mf, lyrics.ResolveOptions{})
			Expect(err).ToNot(HaveOccurred())
			Expect(res.Result).To(Equal(lyrics.ResolveNotSaved))
			Expect(sidecar()).ToNot(BeAnExistingFile())
			Expect(fake.calls.Load()).To(BeNumerically(">=", 1), "the provider was asked, nothing was kept")
		})

	})

	Describe("a credits-only sidecar saved by an earlier version", func() {
		const junk = `{"format":"navidrome-lyrics","version":1,"origin":"%s","provider":"netease","providerId":"1","quality":"plain","confidence":1,` +
			`"retrievedAt":"2026-10-25T12:00:00Z","attribution":"x","recording":{"title":"Song","artist":"Band","album":"Album","duration":200},` +
			`"lyrics":[{"lang":"xxx","line":[{"value":"[00:00.00-1] 作曲 : Someone"}],"synced":false}]}`

		It("is not shown, and a retrieval replaces it while keeping it in the history", func() {
			write("01 - Song.lyrics.json", fmt.Sprintf(junk, "managed"))
			Expect(mustLyrics(svc.GetLyrics(ctx, mf))).To(BeEmpty(), "the junk line is not served as lyrics")

			fake.set(remote("fake", "1", syncedOf("a real line"), 0.99))
			_, err := engine.SaveSettings(ctx, lyrics.Settings{Providers: []string{"fake"}, MinConfidence: 0.85, AutoRetrieve: true})
			Expect(err).ToNot(HaveOccurred())
			res, err := engine.Resolve(ctx, mf, lyrics.ResolveOptions{})
			Expect(err).ToNot(HaveOccurred())
			Expect(res.Result).To(Equal(lyrics.ResolveFound))
			Expect(firstLine(mustLyrics(svc.GetLyrics(ctx, mf)))).To(Equal("a real line"))
		})

		It("is never ignored when the user chose it", func() {
			write("01 - Song.lyrics.json", fmt.Sprintf(junk, "user"))
			Expect(firstLine(mustLyrics(svc.GetLyrics(ctx, mf)))).To(ContainSubstring("作曲"))
		})
	})

	Describe("local files keep priority", func() {
		BeforeEach(func() {
			_, err := engine.SaveSettings(ctx, lyrics.Settings{Providers: []string{"fake"}, MinConfidence: 0.85, PreferLocal: true, AutoRetrieve: true, AutoUpgrade: true})
			Expect(err).ToNot(HaveOccurred())
			fake.set(remote("fake", "1", karaokeOf("remote karaoke"), 0.99))
		})

		DescribeTable("a downloaded karaoke result never replaces your own file",
			func(name, content string) {
				path := write(name, content)
				before, _ := os.ReadFile(path)
				for _, opts := range []lyrics.ResolveOptions{{}, {Recheck: true}} {
					res, err := engine.Resolve(ctx, mf, opts)
					Expect(err).ToNot(HaveOccurred())
					Expect(res.Result).To(Equal(lyrics.ResolveHave))
				}
				Expect(sidecar()).ToNot(BeAnExistingFile())
				after, _ := os.ReadFile(path)
				Expect(after).To(Equal(before), "the file is byte-identical")
				Expect(fake.calls.Load()).To(BeZero(), "providers were not even asked")
				Expect(firstLine(mustLyrics(svc.GetLyrics(ctx, mf)))).ToNot(Equal("remote karaoke"))
			},
			Entry(".lrc", "01 - Song.lrc", "[00:01.00]my own line"),
			Entry(".krc", "01 - Song.krc", "[ar:A]\n[1000,1000]<0,400,0>my<400,600,0> own"),
			Entry(".yrc", "01 - Song.yrc", "[1000,1000](1000,400,0)my (1400,600,0)own"),
			Entry(".qrc", "01 - Song.qrc", "[1000,1000]my (1000,400)own(1400,600)"),
		)

		It("keeps a user-chosen .lyrics.json and a locked track, even against better remote lyrics", func() {
			_, err := engine.Import(ctx, mf, lyrics.ImportRequest{FileName: "mine.lrc", Content: []byte("[00:01.00]chosen by me")})
			Expect(err).ToNot(HaveOccurred())
			raw, _ := os.ReadFile(sidecar())
			res, err := engine.Resolve(ctx, mf, lyrics.ResolveOptions{Recheck: true})
			Expect(err).ToNot(HaveOccurred())
			Expect(res.Result).To(Equal(lyrics.ResolveHave))
			after, _ := os.ReadFile(sidecar())
			Expect(after).To(Equal(raw))
			Expect(fake.calls.Load()).To(BeZero())

			Expect(engine.SetLocked(ctx, mf, true)).To(Succeed())
			res, err = engine.Resolve(ctx, mf, lyrics.ResolveOptions{Explicit: true, Recheck: true, ReplaceManual: true})
			Expect(err).ToNot(HaveOccurred())
			Expect(res.Result).To(Equal(lyrics.ResolveLocked))
			// locking only adds the lock to the sidecar; the lyrics are untouched
			Expect(firstLine(mustLyrics(svc.GetLyrics(ctx, mf)))).To(Equal("chosen by me"))
			after, _ = os.ReadFile(sidecar())
			Expect(string(after)).To(ContainSubstring(`"locked": true`))
			Expect(string(after)).To(ContainSubstring("chosen by me"))
			Expect(string(after)).ToNot(ContainSubstring("remote karaoke"))
		})
	})
})

func mustLyrics(l model.LyricList, err error) model.LyricList {
	Expect(err).ToNot(HaveOccurred())
	return l
}
