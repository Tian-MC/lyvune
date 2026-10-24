package lyrics_test

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/navidrome/navidrome/core/lyrics"
	"github.com/navidrome/navidrome/model"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

func envelopeFor(text string, origin string) lyrics.Envelope {
	list := model.LyricList{{Synced: true, Lang: "eng", Line: []model.Line{{Start: i64(1000), Value: text}}}}
	return lyrics.NewEnvelope(candidate(list), origin, time.Now())
}

var _ = Describe("Store", func() {
	var (
		root    string
		hist    string
		store   *lyrics.Store
		target  lyrics.Target
		audio   string
		audioFn = "01 - Song.flac"
	)

	BeforeEach(func() {
		root = GinkgoT().TempDir()
		hist = GinkgoT().TempDir()
		Expect(os.MkdirAll(filepath.Join(root, "Artist", "Album"), 0o755)).To(Succeed())
		audio = filepath.Join(root, "Artist", "Album", audioFn)
		Expect(os.WriteFile(audio, []byte("FLACDATA"), 0o644)).To(Succeed())
		store = lyrics.NewStore(hist, 3)
		target = lyrics.Target{Root: root, AudioRel: "Artist/Album/" + audioFn}
	})

	sidecar := func() string { return filepath.Join(root, "Artist", "Album", "01 - Song.lyrics.json") }
	read := func() lyrics.Envelope {
		data, err := os.ReadFile(sidecar())
		Expect(err).ToNot(HaveOccurred())
		env, err := lyrics.ParseEnvelope(data)
		Expect(err).ToNot(HaveOccurred())
		return env
	}
	lineOf := func(e lyrics.Envelope) string { return e.Lyrics[0].Line[0].Value }

	It("creates the sidecar next to the audio, and leaves the audio alone", func() {
		before := sha256.Sum256([]byte("FLACDATA"))
		stat, _ := os.Stat(audio)

		_, err := store.Save(target, envelopeFor("first", lyrics.OriginManaged))
		Expect(err).ToNot(HaveOccurred())
		Expect(lineOf(read())).To(Equal("first"))

		data, _ := os.ReadFile(audio)
		Expect(sha256.Sum256(data)).To(Equal(before))
		after, _ := os.Stat(audio)
		Expect(after.ModTime()).To(Equal(stat.ModTime()), "the audio file's timestamp is unchanged")
	})

	It("leaves no temporary files behind", func() {
		_, err := store.Save(target, envelopeFor("first", lyrics.OriginManaged))
		Expect(err).ToNot(HaveOccurred())
		entries, _ := os.ReadDir(filepath.Dir(audio))
		for _, e := range entries {
			Expect(e.Name()).ToNot(ContainSubstring(".tmp-"))
		}
	})

	It("keeps the previous sidecar in the history before replacing it", func() {
		_, _ = store.Save(target, envelopeFor("first", lyrics.OriginManaged))
		_, err := store.Save(target, envelopeFor("second", lyrics.OriginUser))
		Expect(err).ToNot(HaveOccurred())
		Expect(lineOf(read())).To(Equal("second"))

		versions := store.Versions(target)
		Expect(versions).To(HaveLen(2))
		Expect(versions[0].Existed).To(BeTrue(), "newest entry is the replaced 'first'")
		Expect(versions[0].Origin).To(Equal(lyrics.OriginManaged))
		Expect(versions[1].Existed).To(BeFalse(), "the very first write had no previous file")
	})

	It("restores a previous version, and the restore itself can be undone", func() {
		_, _ = store.Save(target, envelopeFor("first", lyrics.OriginManaged))
		_, _ = store.Save(target, envelopeFor("second", lyrics.OriginManaged))
		replaced := store.Versions(target)[0]

		_, err := store.Restore(target, replaced.ID)
		Expect(err).ToNot(HaveOccurred())
		Expect(lineOf(read())).To(Equal("first"))

		// undo the restore: the newest history entry holds 'second'
		_, err = store.Restore(target, store.Versions(target)[0].ID)
		Expect(err).ToNot(HaveOccurred())
		Expect(lineOf(read())).To(Equal("second"))
	})

	It("undoes the very first write by removing the sidecar", func() {
		_, _ = store.Save(target, envelopeFor("first", lyrics.OriginManaged))
		first := store.Versions(target)[0]
		Expect(first.Existed).To(BeFalse())
		_, err := store.Restore(target, first.ID)
		Expect(err).ToNot(HaveOccurred())
		Expect(sidecar()).ToNot(BeAnExistingFile())
	})

	It("reports an unknown version", func() {
		_, err := store.Restore(target, "123")
		Expect(err).To(MatchError(lyrics.ErrNoVersion))
	})

	It("bounds the history", func() {
		for i := 0; i < 8; i++ {
			_, err := store.Save(target, envelopeFor(fmt.Sprintf("v%d", i), lyrics.OriginManaged))
			Expect(err).ToNot(HaveOccurred())
		}
		Expect(store.Versions(target)).To(HaveLen(3))
		files, _ := os.ReadDir(filepath.Join(hist, entryDir(hist)))
		Expect(len(files)).To(BeNumerically("<=", 6), "a .json and a .data file per version")
	})

	It("keeps its history outside the music library", func() {
		_, _ = store.Save(target, envelopeFor("first", lyrics.OriginManaged))
		_, _ = store.Save(target, envelopeFor("second", lyrics.OriginManaged))
		var inLibrary []string
		_ = filepath.WalkDir(root, func(p string, d os.DirEntry, _ error) error {
			if !d.IsDir() {
				inLibrary = append(inLibrary, d.Name())
			}
			return nil
		})
		Expect(inLibrary).To(ConsistOf(audioFn, "01 - Song.lyrics.json"))
	})

	It("deletes a Navidrome sidecar but keeps it in the history", func() {
		_, _ = store.Save(target, envelopeFor("first", lyrics.OriginManaged))
		_, err := store.Delete(target)
		Expect(err).ToNot(HaveOccurred())
		Expect(sidecar()).ToNot(BeAnExistingFile())
		Expect(audio).To(BeAnExistingFile())

		_, err = store.Restore(target, store.Versions(target)[0].ID)
		Expect(err).ToNot(HaveOccurred())
		Expect(lineOf(read())).To(Equal("first"))
	})

	It("will not delete or overwrite a .lyrics.json that is not a Navidrome envelope", func() {
		Expect(os.WriteFile(sidecar(), []byte(`{"someone":"else"}`), 0o644)).To(Succeed())
		_, err := store.Save(target, envelopeFor("mine", lyrics.OriginManaged))
		Expect(err).To(MatchError(lyrics.ErrNotManaged))
		_, err = store.Delete(target)
		Expect(err).To(MatchError(lyrics.ErrNotManaged))
		data, _ := os.ReadFile(sidecar())
		Expect(string(data)).To(Equal(`{"someone":"else"}`))
	})

	It("never touches other lyrics files such as .lrc", func() {
		lrc := filepath.Join(root, "Artist", "Album", "01 - Song.lrc")
		Expect(os.WriteFile(lrc, []byte("[00:01.00]hand written"), 0o644)).To(Succeed())
		_, err := store.Save(target, envelopeFor("downloaded", lyrics.OriginManaged))
		Expect(err).ToNot(HaveOccurred())
		data, _ := os.ReadFile(lrc)
		Expect(string(data)).To(Equal("[00:01.00]hand written"))
	})

	It("reads the sidecar back", func() {
		_, _ = store.Save(target, envelopeFor("first", lyrics.OriginUser))
		env, name, err := store.Read(target)
		Expect(err).ToNot(HaveOccurred())
		Expect(name).To(Equal("01 - Song.lyrics.json"))
		Expect(env.Origin).To(Equal(lyrics.OriginUser))
	})

	Describe("name collisions", func() {
		It("uses the audio extension when two audio files share a base name", func() {
			other := filepath.Join(root, "Artist", "Album", "01 - Song.mp3")
			Expect(os.WriteFile(other, []byte("MP3"), 0o644)).To(Succeed())
			_, err := store.Save(target, envelopeFor("flac lyrics", lyrics.OriginManaged))
			Expect(err).ToNot(HaveOccurred())
			Expect(filepath.Join(root, "Artist", "Album", "01 - Song.flac.lyrics.json")).To(BeAnExistingFile())
			Expect(sidecar()).ToNot(BeAnExistingFile())
		})

		It("finds an existing sidecar under either name", func() {
			_, _ = store.Save(target, envelopeFor("first", lyrics.OriginManaged))
			other := filepath.Join(root, "Artist", "Album", "01 - Song.mp3")
			Expect(os.WriteFile(other, []byte("MP3"), 0o644)).To(Succeed())
			// the file written before the mp3 existed is still the flac's
			_, name, err := store.Read(target)
			Expect(err).ToNot(HaveOccurred())
			Expect(name).To(Equal("01 - Song.lyrics.json"))
		})
	})

	Describe("path safety", func() {
		DescribeTable("refuses paths that leave the library",
			func(rel string) {
				_, err := store.Save(lyrics.Target{Root: root, AudioRel: rel}, envelopeFor("x", lyrics.OriginManaged))
				Expect(err).To(MatchError(lyrics.ErrUnsafePath))
			},
			Entry("parent traversal", "../outside.flac"),
			Entry("nested traversal", "Artist/../../outside.flac"),
			Entry("absolute path", "/etc/passwd"),
			Entry("unclean path", "Artist//Album/./x.flac"),
			Entry("empty", ""),
		)

		It("refuses a symlink at the sidecar path", func() {
			outside := filepath.Join(GinkgoT().TempDir(), "victim.txt")
			Expect(os.WriteFile(outside, []byte("precious"), 0o644)).To(Succeed())
			Expect(os.Symlink(outside, sidecar())).To(Succeed())
			_, err := store.Save(target, envelopeFor("x", lyrics.OriginManaged))
			Expect(err).To(MatchError(lyrics.ErrUnsafePath))
			data, _ := os.ReadFile(outside)
			Expect(string(data)).To(Equal("precious"))
		})

		It("refuses a track folder that is a symlink out of the library", func() {
			outsideDir := GinkgoT().TempDir()
			Expect(os.Symlink(outsideDir, filepath.Join(root, "Escape"))).To(Succeed())
			_, err := store.Save(lyrics.Target{Root: root, AudioRel: "Escape/x.flac"}, envelopeFor("x", lyrics.OriginManaged))
			Expect(err).To(MatchError(lyrics.ErrUnsafePath))
			entries, _ := os.ReadDir(outsideDir)
			Expect(entries).To(BeEmpty())
		})

		It("accepts a library folder that is itself reached through a symlink", func() {
			link := filepath.Join(GinkgoT().TempDir(), "lib")
			Expect(os.Symlink(root, link)).To(Succeed())
			_, err := store.Save(lyrics.Target{Root: link, AudioRel: "Artist/Album/" + audioFn}, envelopeFor("x", lyrics.OriginManaged))
			Expect(err).ToNot(HaveOccurred())
		})

		It("only writes to local libraries", func() {
			_, err := store.Save(lyrics.Target{Root: "s3://bucket/music", AudioRel: "a/b.flac"}, envelopeFor("x", lyrics.OriginManaged))
			Expect(err).To(MatchError(lyrics.ErrNotLocal))
		})

		It("accepts a file:// library URL", func() {
			_, err := store.Save(lyrics.Target{Root: "file://" + root, AudioRel: "Artist/Album/" + audioFn}, envelopeFor("x", lyrics.OriginManaged))
			Expect(err).ToNot(HaveOccurred())
		})
	})

	Describe("failure handling", func() {
		It("keeps the old file intact when the folder cannot be written", func() {
			if os.Geteuid() == 0 {
				Skip("root ignores directory permissions")
			}
			_, err := store.Save(target, envelopeFor("good", lyrics.OriginManaged))
			Expect(err).ToNot(HaveOccurred())
			dir := filepath.Dir(audio)
			Expect(os.Chmod(dir, 0o555)).To(Succeed())
			DeferCleanup(func() { _ = os.Chmod(dir, 0o755) })

			_, err = store.Save(target, envelopeFor("never written", lyrics.OriginManaged))
			Expect(err).To(MatchError(lyrics.ErrReadOnly))
			Expect(lineOf(read())).To(Equal("good"))
		})

		It("does not write anything when the new lyrics are invalid", func() {
			_, _ = store.Save(target, envelopeFor("good", lyrics.OriginManaged))
			bad := envelopeFor("good", lyrics.OriginManaged)
			bad.Lyrics = nil
			_, err := store.Save(target, bad)
			Expect(err).To(MatchError(lyrics.ErrInvalidEnvelope))
			Expect(lineOf(read())).To(Equal("good"))
			Expect(store.Versions(target)).To(HaveLen(1), "no history entry for a rejected write")
		})
	})

	It("serialises concurrent replacements: the file is always one complete version", func() {
		var wg sync.WaitGroup
		for i := 0; i < 12; i++ {
			wg.Add(1)
			go func(i int) {
				defer GinkgoRecover()
				defer wg.Done()
				_, err := store.Save(target, envelopeFor(fmt.Sprintf("writer-%d", i), lyrics.OriginManaged))
				Expect(err).ToNot(HaveOccurred())
			}(i)
		}
		wg.Wait()
		Expect(lineOf(read())).To(HavePrefix("writer-"))
		entries, _ := os.ReadDir(filepath.Dir(audio))
		for _, e := range entries {
			Expect(strings.Contains(e.Name(), ".tmp-")).To(BeFalse())
		}
		Expect(len(store.Versions(target))).To(Equal(3), "bounded to the keep limit")
	})
})

func entryDir(hist string) string {
	entries, _ := os.ReadDir(hist)
	if len(entries) == 0 {
		return ""
	}
	return entries[0].Name()
}
