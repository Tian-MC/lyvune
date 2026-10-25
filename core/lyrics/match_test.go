package lyrics_test

import (
	"github.com/Tian-MC/lyvune/core/lyrics"
	"github.com/Tian-MC/lyvune/model"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

func i64(v int64) *int64 { return &v }

var _ = Describe("Quality", func() {
	It("is none for an empty list", func() {
		Expect(lyrics.QualityOf(nil)).To(Equal(lyrics.QualityNone))
	})

	It("is plain without timestamps", func() {
		list := model.LyricList{{Line: []model.Line{{Value: "hello"}}}}
		Expect(lyrics.QualityOf(list)).To(Equal(lyrics.QualityPlain))
	})

	It("is synced when lines carry a start time", func() {
		list := model.LyricList{{Synced: true, Line: []model.Line{{Start: i64(1000), Value: "hello"}}}}
		Expect(lyrics.QualityOf(list)).To(Equal(lyrics.QualitySynced))
	})

	It("is karaoke only with real word timing", func() {
		list := model.LyricList{{Synced: true, Line: []model.Line{{
			Start: i64(1000), Value: "hello",
			Cue: []model.Cue{{Start: i64(1000), End: i64(1400), Value: "hello"}},
		}}}}
		Expect(lyrics.QualityOf(list)).To(Equal(lyrics.QualityKaraoke))
	})

	It("does not call cues without a start time karaoke", func() {
		list := model.LyricList{{Synced: true, Line: []model.Line{{
			Start: i64(1000), Value: "hello", Cue: []model.Cue{{Value: "hello"}},
		}}}}
		Expect(lyrics.QualityOf(list)).To(Equal(lyrics.QualitySynced))
	})

	It("ignores translations when classifying", func() {
		list := model.LyricList{
			{Kind: model.LyricKindMain, Line: []model.Line{{Value: "hello"}}},
			{Kind: model.LyricKindTranslation, Synced: true, Line: []model.Line{{Start: i64(1), Value: "hola"}}},
		}
		Expect(lyrics.QualityOf(list)).To(Equal(lyrics.QualityPlain))
	})

	It("round-trips its name", func() {
		for _, q := range []lyrics.Quality{lyrics.QualityPlain, lyrics.QualitySynced, lyrics.QualityKaraoke} {
			Expect(lyrics.ParseQuality(q.String())).To(Equal(q))
		}
		Expect(lyrics.ParseQuality("nonsense")).To(Equal(lyrics.QualityNone))
	})
})

var _ = Describe("ScoreMatch", func() {
	rec := lyrics.Recording{Title: "Born This Way", Artist: "Lady Gaga", Album: "Born This Way", DurationSec: 260}

	It("verifies an exact match", func() {
		m := lyrics.ScoreMatch(rec, lyrics.Meta{Title: "Born This Way", Artist: "Lady Gaga", Album: "Born This Way", DurationSec: 261})
		Expect(m.Verified()).To(BeTrue())
		Expect(m.Confidence).To(BeNumerically(">=", 0.95))
	})

	It("still verifies when the album differs, as on compilations", func() {
		m := lyrics.ScoreMatch(rec, lyrics.Meta{Title: "Born This Way", Artist: "Lady Gaga", Album: "Billboard Top 100 Hits Of 2011", DurationSec: 261})
		Expect(m.Verified()).To(BeTrue())
	})

	It("rejects the same title by another artist", func() {
		m := lyrics.ScoreMatch(rec, lyrics.Meta{Title: "Born This Way", Artist: "Some Cover Band", DurationSec: 260})
		Expect(m.Verified()).To(BeFalse())
		Expect(m.Mismatch).To(ContainElement("metadata"))
	})

	It("rejects a very different duration even with matching text", func() {
		m := lyrics.ScoreMatch(rec, lyrics.Meta{Title: "Born This Way", Artist: "Lady Gaga", DurationSec: 400})
		Expect(m.Verified()).To(BeFalse())
		Expect(m.Mismatch).To(ContainElement("duration"))
	})

	It("is not verified when the duration is off by a few seconds only moderately", func() {
		near := lyrics.ScoreMatch(rec, lyrics.Meta{Title: "Born This Way", Artist: "Lady Gaga", DurationSec: 263})
		far := lyrics.ScoreMatch(rec, lyrics.Meta{Title: "Born This Way", Artist: "Lady Gaga", DurationSec: 270})
		Expect(near.Confidence).To(BeNumerically(">", far.Confidence))
	})

	It("does not trust a result whose length is more than five seconds off, however good the text", func() {
		ok := lyrics.ScoreMatch(rec, lyrics.Meta{Title: "Born This Way", Artist: "Lady Gaga", Album: "Born This Way", DurationSec: 264})
		off := lyrics.ScoreMatch(rec, lyrics.Meta{Title: "Born This Way", Artist: "Lady Gaga", Album: "Born This Way", DurationSec: 268})
		Expect(ok.Verified()).To(BeTrue())
		Expect(off.Verified()).To(BeFalse())
		Expect(off.Listed()).To(BeTrue(), "it is still offered for a manual choice")
	})

	It("treats a missing duration as neutral, not as a match", func() {
		withDur := lyrics.ScoreMatch(rec, lyrics.Meta{Title: "Born This Way", Artist: "Lady Gaga", DurationSec: 260})
		without := lyrics.ScoreMatch(rec, lyrics.Meta{Title: "Born This Way", Artist: "Lady Gaga"})
		Expect(without.Confidence).To(BeNumerically("<", withDur.Confidence))
		Expect(without.Duration).To(Equal(0.5))
	})

	It("ignores featured artists and remaster notes", func() {
		r := lyrics.Recording{Title: "Song (feat. Someone) [2011 Remaster]", Artist: "The Band", DurationSec: 200}
		m := lyrics.ScoreMatch(r, lyrics.Meta{Title: "Song", Artist: "The Band", DurationSec: 200})
		Expect(m.Verified()).To(BeTrue())
		Expect(m.Mismatch).To(BeEmpty())
	})

	It("accepts extra credited artists on either side", func() {
		r := lyrics.Recording{Title: "Duet", Artist: "A feat. B", DurationSec: 200}
		m := lyrics.ScoreMatch(r, lyrics.Meta{Title: "Duet", Artist: "A", DurationSec: 200})
		Expect(m.Verified()).To(BeTrue())
	})

	DescribeTable("a different version of the recording is not trusted",
		func(libraryTitle, candidateTitle, tag string) {
			r := lyrics.Recording{Title: libraryTitle, Artist: "The Band", DurationSec: 200}
			m := lyrics.ScoreMatch(r, lyrics.Meta{Title: candidateTitle, Artist: "The Band", DurationSec: 200})
			Expect(m.Verified()).To(BeFalse())
			Expect(m.Mismatch).To(ContainElement("version:" + tag))
		},
		Entry("live", "Song", "Song (Live at Wembley)", "live"),
		Entry("remix", "Song", "Song - Club Remix", "remix"),
		Entry("acoustic", "Song", "Song [Acoustic]", "acoustic"),
		Entry("instrumental", "Song", "Song (Instrumental)", "instrumental"),
		Entry("karaoke", "Song", "Song (Karaoke Version)", "instrumental"),
		Entry("the library has the live version", "Song (Live)", "Song", "live"),
	)

	It("matches the same live version on both sides", func() {
		r := lyrics.Recording{Title: "Song (Live)", Artist: "The Band", DurationSec: 200}
		m := lyrics.ScoreMatch(r, lyrics.Meta{Title: "Song - Live", Artist: "The Band", DurationSec: 200})
		Expect(m.Verified()).To(BeTrue())
	})

	It("keeps bracketed text that belongs to the title", func() {
		r := lyrics.Recording{Title: "(What's the Story) Morning Glory?", Artist: "Oasis", DurationSec: 258}
		m := lyrics.ScoreMatch(r, lyrics.Meta{Title: "What's the Story Morning Glory", Artist: "Oasis", DurationSec: 258})
		Expect(m.Verified()).To(BeTrue())
	})

	It("folds case, width and diacritics", func() {
		r := lyrics.Recording{Title: "Café del Mar", Artist: "Énergie", DurationSec: 300}
		m := lyrics.ScoreMatch(r, lyrics.Meta{Title: "CAFE DEL MAR", Artist: "Energie", DurationSec: 300})
		Expect(m.Verified()).To(BeTrue())
	})

	It("matches Japanese text without losing voiced marks", func() {
		r := lyrics.Recording{Title: "マトリョシカ", Artist: "ハチ", DurationSec: 198}
		same := lyrics.ScoreMatch(r, lyrics.Meta{Title: "マトリョシカ", Artist: "ハチ", DurationSec: 198})
		Expect(same.Verified()).To(BeTrue())
		// が and か are different syllables; folding marks away would make them equal
		other := lyrics.ScoreMatch(
			lyrics.Recording{Title: "がっこう", Artist: "ハチ", DurationSec: 198},
			lyrics.Meta{Title: "かっこう", Artist: "ハチ", DurationSec: 198},
		)
		Expect(other.Title).To(BeNumerically("<", 1))
	})

	It("matches full-width and half-width forms", func() {
		r := lyrics.Recording{Title: "ＡＢＣ", Artist: "Band", DurationSec: 100}
		m := lyrics.ScoreMatch(r, lyrics.Meta{Title: "abc", Artist: "Band", DurationSec: 100})
		Expect(m.Verified()).To(BeTrue())
	})

	It("matches Chinese and Korean metadata", func() {
		Expect(lyrics.ScoreMatch(lyrics.Recording{Title: "晴天", Artist: "周杰倫", DurationSec: 269},
			lyrics.Meta{Title: "晴天", Artist: "周杰倫", DurationSec: 269}).Verified()).To(BeTrue())
		Expect(lyrics.ScoreMatch(lyrics.Recording{Title: "봄날", Artist: "방탄소년단", DurationSec: 274},
			lyrics.Meta{Title: "봄날", Artist: "방탄소년단", DurationSec: 274}).Verified()).To(BeTrue())
	})

	It("lists plausible but unverified candidates", func() {
		m := lyrics.ScoreMatch(rec, lyrics.Meta{Title: "Born This Way", Artist: "Lady Gaga", DurationSec: 268})
		Expect(m.Listed()).To(BeTrue())
	})
})

var _ = Describe("Choose", func() {
	cand := func(provider string, q lyrics.Quality, conf float64) lyrics.Candidate {
		return lyrics.Candidate{ID: provider, Provider: provider, Quality: q, Match: lyrics.Match{Confidence: conf}}
	}

	It("prefers karaoke over synced over plain", func() {
		got, ok := lyrics.Choose([]lyrics.Candidate{
			cand("a", lyrics.QualityPlain, 0.99),
			cand("b", lyrics.QualityKaraoke, 0.9),
			cand("c", lyrics.QualitySynced, 0.99),
		}, lyrics.Policy{})
		Expect(ok).To(BeTrue())
		Expect(got.Provider).To(Equal("b"))
	})

	It("never lets a doubtful karaoke result outrank a correct synced one", func() {
		got, ok := lyrics.Choose([]lyrics.Candidate{
			cand("wrong-karaoke", lyrics.QualityKaraoke, 0.4),
			cand("right-synced", lyrics.QualitySynced, 0.97),
		}, lyrics.Policy{})
		Expect(ok).To(BeTrue())
		Expect(got.Provider).To(Equal("right-synced"))
	})

	It("returns nothing when no candidate is trustworthy", func() {
		_, ok := lyrics.Choose([]lyrics.Candidate{cand("a", lyrics.QualityKaraoke, 0.6)}, lyrics.Policy{})
		Expect(ok).To(BeFalse())
	})

	It("skips candidates without lyrics", func() {
		_, ok := lyrics.Choose([]lyrics.Candidate{cand("a", lyrics.QualityNone, 1)}, lyrics.Policy{})
		Expect(ok).To(BeFalse())
	})

	It("uses match confidence when quality is equal", func() {
		got, _ := lyrics.Choose([]lyrics.Candidate{
			cand("a", lyrics.QualitySynced, 0.88),
			cand("b", lyrics.QualitySynced, 0.99),
		}, lyrics.Policy{ProviderOrder: []string{"a", "b"}})
		Expect(got.Provider).To(Equal("b"))
	})

	It("uses provider order only as the last tie-breaker", func() {
		got, _ := lyrics.Choose([]lyrics.Candidate{
			cand("a", lyrics.QualitySynced, 0.95),
			cand("b", lyrics.QualitySynced, 0.95),
		}, lyrics.Policy{ProviderOrder: []string{"b", "a"}})
		Expect(got.Provider).To(Equal("b"))
	})

	It("does not let provider order beat quality", func() {
		got, _ := lyrics.Choose([]lyrics.Candidate{
			cand("preferred", lyrics.QualityPlain, 0.99),
			cand("other", lyrics.QualityKaraoke, 0.9),
		}, lyrics.Policy{ProviderOrder: []string{"preferred", "other"}})
		Expect(got.Provider).To(Equal("other"))
	})

	It("honours a stricter minimum confidence", func() {
		_, ok := lyrics.Choose([]lyrics.Candidate{cand("a", lyrics.QualitySynced, 0.9)}, lyrics.Policy{MinConfidence: 0.95})
		Expect(ok).To(BeFalse())
	})

	It("only counts a strictly better quality as an upgrade", func() {
		Expect(lyrics.IsUpgrade(lyrics.QualityPlain, cand("a", lyrics.QualitySynced, 1))).To(BeTrue())
		Expect(lyrics.IsUpgrade(lyrics.QualitySynced, cand("a", lyrics.QualityKaraoke, 1))).To(BeTrue())
		Expect(lyrics.IsUpgrade(lyrics.QualitySynced, cand("a", lyrics.QualitySynced, 1))).To(BeFalse())
		Expect(lyrics.IsUpgrade(lyrics.QualityKaraoke, cand("a", lyrics.QualitySynced, 1))).To(BeFalse())
	})
})
