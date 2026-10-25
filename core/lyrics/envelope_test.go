package lyrics_test

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/Tian-MC/lyvune/core/lyrics"
	"github.com/Tian-MC/lyvune/model"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

func karaokeList() model.LyricList {
	return model.LyricList{{
		Kind: model.LyricKindMain, Lang: "jpn", Synced: true,
		Line: []model.Line{{
			Start: i64(1000), Value: "こんにちは",
			Cue: []model.Cue{
				{Start: i64(1000), End: i64(1400), Value: "こん", ByteStart: 0, ByteEnd: 5},
				{Start: i64(1400), End: i64(2000), Value: "にちは", ByteStart: 6, ByteEnd: 14},
			},
		}},
	}, {
		Kind: model.LyricKindTranslation, Lang: "eng", Synced: true,
		Line: []model.Line{{Start: i64(1000), Value: "Hello"}},
	}}
}

func candidate(list model.LyricList) lyrics.Candidate {
	return lyrics.Candidate{
		ID: "lrclib:42", Provider: "lrclib", Lyrics: list,
		Meta:  lyrics.Meta{Title: "Song", Artist: "Band", DurationSec: 200},
		Match: lyrics.Match{Confidence: 0.97},
	}
}

var _ = Describe("Envelope", func() {
	now := time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC)

	It("round-trips word timing, translations and provenance without loss", func() {
		env := lyrics.NewEnvelope(candidate(karaokeList()), lyrics.OriginManaged, now)
		data, err := env.Marshal()
		Expect(err).ToNot(HaveOccurred())

		back, err := lyrics.ParseEnvelope(data)
		Expect(err).ToNot(HaveOccurred())
		Expect(back.Lyrics).To(Equal(env.Lyrics))
		Expect(back.Provider).To(Equal("lrclib"))
		Expect(back.ProviderID).To(Equal("42"))
		Expect(back.Quality).To(Equal("karaoke"))
		Expect(back.Origin).To(Equal(lyrics.OriginManaged))
		Expect(back.Confidence).To(Equal(0.97))
		Expect(back.RetrievedAt).To(Equal(now))
		Expect(lyrics.QualityOf(back.Lyrics)).To(Equal(lyrics.QualityKaraoke))
	})

	It("keeps the stable top-level fields", func() {
		data, _ := lyrics.NewEnvelope(candidate(karaokeList()), lyrics.OriginUser, now).Marshal()
		var raw map[string]any
		Expect(json.Unmarshal(data, &raw)).To(Succeed())
		Expect(raw).To(HaveKeyWithValue("format", "navidrome-lyrics"))
		Expect(raw).To(HaveKeyWithValue("version", BeNumerically("==", 1)))
		Expect(raw).To(HaveKeyWithValue("origin", "user"))
		Expect(raw).To(HaveKey("lyrics"))
	})

	DescribeTable("rejects what is not a valid envelope",
		func(mutate func(map[string]any)) {
			data, _ := lyrics.NewEnvelope(candidate(karaokeList()), lyrics.OriginManaged, now).Marshal()
			var raw map[string]any
			Expect(json.Unmarshal(data, &raw)).To(Succeed())
			mutate(raw)
			bad, _ := json.Marshal(raw)
			_, err := lyrics.ParseEnvelope(bad)
			Expect(err).To(MatchError(lyrics.ErrInvalidEnvelope))
		},
		Entry("another format", func(m map[string]any) { m["format"] = "other" }),
		Entry("a newer version", func(m map[string]any) { m["version"] = 99 }),
		Entry("an unknown origin", func(m map[string]any) { m["origin"] = "robot" }),
		Entry("no lyrics", func(m map[string]any) { m["lyrics"] = []any{} }),
		Entry("lyrics with only blank lines", func(m map[string]any) {
			m["lyrics"] = []any{map[string]any{"lang": "xxx", "synced": false, "line": []any{map[string]any{"value": ""}}}}
		}),
		Entry("a negative timestamp", func(m map[string]any) {
			m["lyrics"] = []any{map[string]any{"lang": "xxx", "synced": true, "line": []any{map[string]any{"start": -5, "value": "x"}}}}
		}),
		Entry("a cue that ends before it starts", func(m map[string]any) {
			m["lyrics"] = []any{map[string]any{"lang": "xxx", "synced": true, "line": []any{map[string]any{
				"start": 1, "value": "x",
				"cue": []any{map[string]any{"start": 500, "end": 100, "value": "x", "byteStart": 0, "byteEnd": 0}},
			}}}}
		}),
	)

	It("rejects malformed JSON and oversized input", func() {
		_, err := lyrics.ParseEnvelope([]byte("{not json"))
		Expect(err).To(MatchError(lyrics.ErrInvalidEnvelope))
		_, err = lyrics.ParseEnvelope([]byte(strings.Repeat("a", 5<<20)))
		Expect(err).To(MatchError(lyrics.ErrInvalidEnvelope))
	})

	It("rejects a line that is absurdly long", func() {
		long := model.LyricList{{Line: []model.Line{{Value: strings.Repeat("x", 5000)}}}}
		_, err := lyrics.NewEnvelope(candidate(long), lyrics.OriginManaged, now).Marshal()
		Expect(err).To(MatchError(lyrics.ErrInvalidEnvelope))
	})

	It("applies the sync offset on top of the offset in the lyrics, without rewriting timing", func() {
		list := model.LyricList{{Synced: true, Offset: i64(100), Line: []model.Line{{Start: i64(1000), Value: "x"}}}}
		env := lyrics.NewEnvelope(candidate(list), lyrics.OriginUser, now)
		env.OffsetMs = 250
		out := env.List()
		Expect(*out[0].Offset).To(Equal(int64(350)))
		Expect(*out[0].Line[0].Start).To(Equal(int64(1000)))
		Expect(*env.Lyrics[0].Offset).To(Equal(int64(100)), "the stored lyrics are not mutated")
	})
})
