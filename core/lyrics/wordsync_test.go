package lyrics_test

import (
	"bytes"
	"compress/zlib"
	"encoding/base64"
	"encoding/json"
	"strings"

	"github.com/Tian-MC/lyvune/core/lyrics"
	"github.com/Tian-MC/lyvune/model"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

// The fixtures below are SYNTHETIC: short lines written for these tests, in the
// documented layout of each format. They are not provider data.

// testKRCKey is the public container key of the KRC format, repeated here so
// the test does not depend on the implementation's copy.
var testKRCKey = []byte{64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105}

func packKRC(text string) []byte {
	var z bytes.Buffer
	w := zlib.NewWriter(&z)
	_, _ = w.Write([]byte(text))
	_ = w.Close()
	b := z.Bytes()
	for i := range b {
		b[i] ^= testKRCKey[i%len(testKRCKey)]
	}
	return append([]byte("krc1"), b...)
}

func krcLanguage(romaji [][]string, translation [][]string) string {
	doc := map[string]any{"version": 1, "content": []map[string]any{
		{"type": 0, "language": 0, "lyricContent": romaji},
		{"type": 1, "language": 0, "lyricContent": translation},
	}}
	raw, _ := json.Marshal(doc)
	return base64.StdEncoding.EncodeToString(raw)
}

func syntheticKRC() string {
	return "\ufeff[id:$00000000]\n[ar:Test Artist]\n[ti:Test Song]\n[offset:0]\n[language:" +
		krcLanguage([][]string{{"ko ", "n ni ", "chi ", "wa"}, {"sa yo ", "na ", "ra"}}, [][]string{{"Hello"}, {"Goodbye"}}) + "]\n" +
		"[1000,1500]<0,300,0>こ<300,400,0>ん<700,300,0>に<1000,500,0>ちは\n" +
		"[3000,1000]<0,600,0>さよ<600,400,0>なら\n"
}

var _ = Describe("KRC", func() {
	It("decodes the distributed container and plain text alike", func() {
		packed, err := lyrics.DecodeKRC(packKRC(syntheticKRC()))
		Expect(err).ToNot(HaveOccurred())
		Expect(packed).To(ContainSubstring("[1000,1500]"))
		plain, err := lyrics.DecodeKRC([]byte(syntheticKRC()))
		Expect(err).ToNot(HaveOccurred())
		Expect(plain).To(Equal(packed))
	})

	It("rejects binary garbage and a corrupted container", func() {
		_, err := lyrics.DecodeKRC([]byte{0xff, 0xfe, 0x00, 0x81})
		Expect(err).To(MatchError(lyrics.ErrNotKRC))
		_, err = lyrics.DecodeKRC(append([]byte("krc1"), 1, 2, 3, 4, 5))
		Expect(err).To(MatchError(lyrics.ErrNotKRC))
	})

	It("keeps the exact word timing, text and Unicode of the source", func() {
		list, err := lyrics.ParseKRC(syntheticKRC())
		Expect(err).ToNot(HaveOccurred())
		main := list[0]
		Expect(main.Kind).To(Equal(model.LyricKindMain))
		Expect(main.Synced).To(BeTrue())
		Expect(lyrics.QualityOf(list)).To(Equal(lyrics.QualityKaraoke))
		Expect(main.Line).To(HaveLen(2))

		l := main.Line[0]
		Expect(l.Value).To(Equal("こんにちは"))
		Expect(*l.Start).To(Equal(int64(1000)))
		Expect(*l.End).To(Equal(int64(2500)))
		Expect(l.Cue).To(HaveLen(4))
		// word offsets are relative to the line start
		Expect(*l.Cue[0].Start).To(Equal(int64(1000)))
		Expect(*l.Cue[0].End).To(Equal(int64(1300)))
		Expect(*l.Cue[3].Start).To(Equal(int64(2000)))
		Expect(*l.Cue[3].End).To(Equal(int64(2500)))
		Expect(l.Cue[3].Value).To(Equal("ちは"))
		// byte offsets address the word inside the line text (end is inclusive)
		Expect(l.Value[l.Cue[3].ByteStart : l.Cue[3].ByteEnd+1]).To(Equal("ちは"))
	})

	It("keeps the translation and aligns the romanization word by word only when counts agree", func() {
		list, err := lyrics.ParseKRC(syntheticKRC())
		Expect(err).ToNot(HaveOccurred())
		Expect(list).To(HaveLen(3))

		tr := list[1]
		Expect(tr.Kind).To(Equal(model.LyricKindTranslation))
		Expect(tr.Line[0].Value).To(Equal("Hello"))
		Expect(tr.Line[0].Cue).To(BeEmpty(), "a translation has no word timing of its own")
		Expect(*tr.Line[1].Start).To(Equal(int64(3000)))

		ro := list[2]
		Expect(ro.Kind).To(Equal(model.LyricKindPronunciation))
		Expect(ro.Line[0].Cue).To(HaveLen(4), "4 pieces for 4 words")
		Expect(*ro.Line[0].Cue[1].Start).To(Equal(int64(1300)))
		Expect(ro.Line[1].Cue).To(BeEmpty(), "3 pieces for 2 words cannot be paired")
		Expect(ro.Line[1].Value).To(Equal("sa yo na ra"))
	})

	It("never turns a line without word tags into karaoke", func() {
		list, err := lyrics.ParseKRC("[0,2000]just a plain line\n[2000,1000]another")
		Expect(err).ToNot(HaveOccurred())
		Expect(lyrics.QualityOf(list)).To(Equal(lyrics.QualitySynced))
		Expect(list[0].Line[0].Cue).To(BeEmpty())
	})

	It("applies the offset tag to every time", func() {
		list, err := lyrics.ParseKRC("[offset:500]\n[1000,1000]<0,400,0>a<400,600,0>b")
		Expect(err).ToNot(HaveOccurred())
		l := list[0].Line[0]
		Expect(*l.Start).To(Equal(int64(1500)))
		Expect(*l.Cue[1].Start).To(Equal(int64(1900)))
	})

	It("survives malformed input", func() {
		for _, in := range []string{"", "[", "[1,2", "[a,b]<x>", "<0,1,0>text", "[0,1]<9999999999999999999999,1,0>x", strings.Repeat("[1,1]<1,1,0>", 1000), "[0,1000]<0,500,0>ok <bad tag> more"} {
			Expect(func() { _, _ = lyrics.ParseKRC(in) }).ToNot(Panic(), in)
		}
		list, err := lyrics.ParseKRC("[0,1000]<0,500,0>ok <bad tag> more")
		Expect(err).ToNot(HaveOccurred())
		Expect(list[0].Line[0].Value).To(Equal("ok <bad tag> more"))
	})

	It("rejects a document with no lyric lines", func() {
		_, err := lyrics.ParseKRC("[ar:x]\n[ti:y]")
		Expect(err).To(MatchError(lyrics.ErrNotKRC))
	})
})

var _ = Describe("YRC", func() {
	const yrc = `{"t":0,"c":[{"tx":"作词: "},{"tx":"Someone"}]}
[1000,1500](1000,300,0)こ(1300,400,0)ん(1700,300,0)に(2000,500,0)ちは
[3000,1000](3000,600,0)Hello (3600,400,0)(oh)
`

	It("keeps absolute word starts and durations and the metadata line", func() {
		list, err := lyrics.ParseYRC(yrc)
		Expect(err).ToNot(HaveOccurred())
		Expect(lyrics.QualityOf(list)).To(Equal(lyrics.QualityKaraoke))
		lines := list[0].Line
		Expect(lines).To(HaveLen(3))
		Expect(lines[0].Value).To(Equal("作词: Someone"))
		Expect(lines[0].Cue).To(BeEmpty(), "a credit line has no word timing")
		Expect(lines[1].Value).To(Equal("こんにちは"))
		Expect(*lines[1].Cue[3].Start).To(Equal(int64(2000)))
		Expect(*lines[1].Cue[3].End).To(Equal(int64(2500)))
		Expect(*lines[1].End).To(Equal(int64(2500)))
	})

	It("keeps parentheses that belong to the text", func() {
		list, err := lyrics.ParseYRC("[0,1000](0,500,0)Hel(500,500,0)lo (oh) yeah")
		Expect(err).ToNot(HaveOccurred())
		Expect(list[0].Line[0].Value).To(Equal("Hello (oh) yeah"))
		Expect(list[0].Line[0].Cue).To(HaveLen(2))
	})

	It("is not fooled by plain LRC, and survives garbage", func() {
		_, err := lyrics.ParseYRC("not lyrics at all")
		Expect(err).To(MatchError(lyrics.ErrNotYRC))
		for _, in := range []string{"", "[", "{", "{\"t\":-1}", "[1,2](", "[0,1](x,y,z)q"} {
			Expect(func() { _, _ = lyrics.ParseYRC(in) }).ToNot(Panic(), in)
		}
	})
})

var _ = Describe("RichSync", func() {
	const body = `[{"ts":1.0,"te":3.5,"l":[{"c":"Hel","o":0},{"c":"lo","o":0.4},{"c":" ","o":0.8},{"c":"world","o":1.0}],"x":"Hello world"},
	{"ts":4.0,"te":6.0,"l":[],"x":"No words here"}]`

	It("converts seconds to exact milliseconds and leaves unknown word ends empty", func() {
		list, err := lyrics.ParseRichSync(body)
		Expect(err).ToNot(HaveOccurred())
		Expect(lyrics.QualityOf(list)).To(Equal(lyrics.QualityKaraoke))
		l := list[0].Line[0]
		Expect(l.Value).To(Equal("Hello world"))
		Expect(l.Cue).To(HaveLen(3))
		Expect(*l.Cue[1].Start).To(Equal(int64(1400)))
		Expect(l.Cue[1].Value).To(Equal("lo "), "the separator joins the previous word")
		Expect(l.Cue[0].End).To(BeNil())
		Expect(*l.Cue[2].End).To(Equal(int64(3500)))
	})

	It("keeps a line without words as line timing only", func() {
		list, err := lyrics.ParseRichSync(body)
		Expect(err).ToNot(HaveOccurred())
		l := list[0].Line[1]
		Expect(l.Value).To(Equal("No words here"))
		Expect(l.Cue).To(BeEmpty())
	})

	It("rejects bad documents without panicking", func() {
		for _, in := range []string{"", "{}", "[]", "null", `[{"ts":-1,"te":1,"l":[{"c":"a","o":0}]}]`, `[{"ts":5,"te":1,"l":[]}]`, `[{"ts":1,"te":2,"l":[{"c":"a","o":-3}],"x":""}]`} {
			Expect(func() { _, _ = lyrics.ParseRichSync(in) }).ToNot(Panic(), in)
			_, err := lyrics.ParseRichSync(in)
			Expect(err).To(HaveOccurred(), in)
		}
	})
})

var _ = Describe("credit-only lyrics", func() {
	lines := func(vs ...string) model.LyricList {
		out := make([]model.Line, len(vs))
		for i, v := range vs {
			out[i] = model.Line{Value: v}
		}
		return model.LyricList{{Kind: model.LyricKindMain, Line: out}}
	}

	It("is not a lyric when every line is a credit, a title or blank", func() {
		Expect(lyrics.CreditsOnly(lines("作曲 : Someone"))).To(BeTrue())
		Expect(lyrics.CreditsOnly(lines("作词 : A", "作曲 : B", "编曲 : C", ""))).To(BeTrue())
		Expect(lyrics.CreditsOnly(lines("Composer: A", "Lyrics by: B"))).To(BeTrue())
		Expect(lyrics.CreditsOnly(lines("Song - Artist", "作曲：A"))).To(BeTrue(), "a title and credits is still a header")
		Expect(lyrics.CreditsOnly(lines("[00:00.00-1] 作曲 : Someone"))).To(BeTrue(), "a stray timestamp left in the text does not hide the credit")
	})

	It("is a lyric once there are real lines, whatever credits come first", func() {
		Expect(lyrics.CreditsOnly(lines("作词 : A", "作曲 : B", "first sung line", "second sung line"))).To(BeFalse())
		Expect(lyrics.CreditsOnly(lines("hello", "world"))).To(BeFalse())
		Expect(lyrics.CreditsOnly(lines("こんにちは", "さようなら"))).To(BeFalse())
	})

	It("does not mistake a sung line that starts like a credit for one", func() {
		Expect(lyrics.CreditsOnly(lines("Music is my escape", "Words fail me now"))).To(BeFalse())
	})
})
