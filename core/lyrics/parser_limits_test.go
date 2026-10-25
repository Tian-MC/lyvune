package lyrics_test

import (
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/navidrome/navidrome/core/lyrics"
	"github.com/navidrome/navidrome/model"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

// Hostile and damaged input to the word-timed parsers. The documents here are
// synthetic.
var _ = Describe("word-timed parser limits", func() {
	within := func(d time.Duration, f func()) {
		t0 := time.Now()
		f()
		ExpectWithOffset(1, time.Since(t0)).To(BeNumerically("<", d), "the parser must stay linear")
	}

	It("stays linear on a line of unmatched brackets (4 MB, the most a response may carry)", func() {
		within(2*time.Second, func() {
			_, _, _ = lyrics.ParseQRC("[0,1000]" + strings.Repeat("(", 4<<20))
		})
		within(2*time.Second, func() {
			_, _, _ = lyrics.ParseQRC("[0,1000]" + strings.Repeat("(1,", 1<<20))
		})
		within(2*time.Second, func() { _, _ = lyrics.ParseKRC("[0,1000]" + strings.Repeat("<", 4<<20)) })
		within(2*time.Second, func() { _, _ = lyrics.ParseYRC("[0,1000]" + strings.Repeat("(", 4<<20)) })
	})

	It("refuses a document over the size limit and a document with too many lines", func() {
		_, _, err := lyrics.ParseQRC(strings.Repeat("a", 9<<20))
		Expect(err).To(MatchError(lyrics.ErrLyricsTooLarge))
		_, err = lyrics.ParseKRC(strings.Repeat("a", 9<<20))
		Expect(err).To(MatchError(lyrics.ErrLyricsTooLarge))
		_, err = lyrics.ParseYRC(strings.Repeat("a", 9<<20))
		Expect(err).To(MatchError(lyrics.ErrLyricsTooLarge))
		_, err = lyrics.ParseRichSync(strings.Repeat(" ", 9<<20))
		Expect(err).To(MatchError(lyrics.ErrLyricsTooLarge))

		many := strings.Repeat("[1,1]x(1,1)\n", 50001)
		_, _, err = lyrics.ParseQRC(many)
		Expect(err).To(MatchError(lyrics.ErrLyricsTooLarge))
		_, err = lyrics.ParseKRC(strings.Repeat("[1,1]<0,1,0>x\n", 50001))
		Expect(err).To(MatchError(lyrics.ErrLyricsTooLarge))
		_, err = lyrics.ParseYRC(strings.Repeat("[1,1](1,1,0)x\n", 50001))
		Expect(err).To(MatchError(lyrics.ErrLyricsTooLarge))
	})

	It("does not let huge times wrap around into negative ones", func() {
		huge := "9223372036854775000"
		_, _, err := lyrics.ParseQRC("[" + huge + "," + huge + "]a(" + huge + "," + huge + ")")
		Expect(err).To(HaveOccurred(), "a time above 100 hours is not a position in a song")
		_, err = lyrics.ParseKRC("[" + huge + "," + huge + "]<0,1,0>a")
		Expect(err).To(HaveOccurred())
		_, err = lyrics.ParseYRC("[" + huge + "," + huge + "](" + huge + ",1,0)a")
		Expect(err).To(HaveOccurred())

		// a bad word keeps the line, without that word's time
		list, _, err := lyrics.ParseQRC("[1000,1000]a(1000,500)b(" + huge + ",5)")
		Expect(err).ToNot(HaveOccurred())
		for _, c := range list[0].Line[0].Cue {
			Expect(*c.Start).To(BeNumerically(">=", 0))
			Expect(*c.Start).To(BeNumerically("<=", 360000000))
		}
	})

	It("ignores an implausible offset and never lets one push a time below zero", func() {
		list, _, err := lyrics.ParseQRC("[offset:9223372036854775000]\n[1000,1000]a(1000,500)")
		Expect(err).ToNot(HaveOccurred())
		Expect(*list[0].Line[0].Start).To(Equal(int64(1000)))
		list, _, err = lyrics.ParseQRC("[offset:-5000]\n[1000,1000]a(1000,500)")
		Expect(err).ToNot(HaveOccurred())
		Expect(*list[0].Line[0].Start).To(Equal(int64(0)))
		Expect(*list[0].Line[0].Cue[0].Start).To(Equal(int64(0)))
	})

	It("reads only the first lyric block of an envelope with several", func() {
		doc := `<QrcInfos><LyricInfo LyricCount="2"><Lyric_1 LyricContent="[0,1000]one(0,500)"/>` +
			`<Lyric_2 LyricContent="[0,1000]two(0,500)"/></LyricInfo></QrcInfos>`
		list, _, err := lyrics.ParseQRC(doc)
		Expect(err).ToNot(HaveOccurred())
		Expect(list[0].Line[0].Value).To(Equal("one"))
		Expect(list[0].Line).To(HaveLen(1))
	})

	It("keeps a '\"/>' that belongs to the lyrics, and decodes entities without resolving anything", func() {
		doc := "<QrcInfos><LyricInfo><Lyric_1 LyricContent=\"[0,2000]say \"/> hi(0,900)&amp;&#233;&lt;x&gt;(900,900)\"/></LyricInfo></QrcInfos>"
		list, _, err := lyrics.ParseQRC(doc)
		Expect(err).ToNot(HaveOccurred())
		Expect(list[0].Line[0].Value).To(Equal(`say "/> hi&é<x>`))

		// an external entity is just text: nothing is fetched or read
		xxe := `<?xml version="1.0"?><!DOCTYPE d [<!ENTITY e SYSTEM "file:///etc/passwd">]>` +
			`<QrcInfos><LyricInfo><Lyric_1 LyricContent="[0,1000]&e;(0,500)"/></LyricInfo></QrcInfos>`
		list, _, err = lyrics.ParseQRC(xxe)
		Expect(err).ToNot(HaveOccurred())
		Expect(list[0].Line[0].Value).To(Equal("&e;"))
		Expect(list[0].Line[0].Value).ToNot(ContainSubstring("root:"))
	})

	It("fails on a truncated envelope instead of guessing", func() {
		_, _, err := lyrics.ParseQRC(`<QrcInfos><LyricInfo><Lyric_1 LyricContent="[0,1000]a(0,500)`)
		Expect(err).To(HaveOccurred())
	})

	It("handles very long lines and many words without trouble", func() {
		var sb strings.Builder
		sb.WriteString("[0,600000]")
		for i := 0; i < 30000; i++ {
			sb.WriteString("w(")
			sb.WriteString(strings.Repeat("1", 1))
			sb.WriteString(",1)")
		}
		within(3*time.Second, func() {
			list, _, err := lyrics.ParseQRC(sb.String())
			Expect(err).ToNot(HaveOccurred())
			Expect(list[0].Line[0].Cue).To(HaveLen(30000))
		})
	})
})

// invariants checks what every parsed document must satisfy, whatever went in.
func invariants(t *testing.T, list model.LyricList) {
	t.Helper()
	const maxMs = int64(100 * 3600 * 1000)
	for _, l := range list {
		for _, line := range l.Line {
			if !utf8.ValidString(line.Value) {
				t.Fatalf("line text is not valid UTF-8: %q", line.Value)
			}
			if line.Start != nil && (*line.Start < 0 || *line.Start > maxMs) {
				t.Fatalf("line start out of range: %d", *line.Start)
			}
			if line.Start != nil && line.End != nil && *line.End < *line.Start {
				t.Fatalf("line ends before it starts: %d < %d", *line.End, *line.Start)
			}
			for _, c := range line.Cue {
				if c.Start != nil && (*c.Start < 0 || *c.Start > maxMs*2) {
					t.Fatalf("cue start out of range: %d", *c.Start)
				}
				if c.Start != nil && c.End != nil && *c.End < *c.Start {
					t.Fatalf("cue ends before it starts: %d < %d", *c.End, *c.Start)
				}
				if c.ByteStart < 0 || c.ByteEnd < c.ByteStart-1 || c.ByteEnd >= len(line.Value) && len(c.Value) > 0 {
					t.Fatalf("cue bytes %d..%d outside %q", c.ByteStart, c.ByteEnd, line.Value)
				}
			}
		}
	}
}

func FuzzParseQRC(f *testing.F) {
	f.Add(qrcEnvelope(qrcBody))
	f.Add("[0,1000]a(0,500)b(500,500)")
	f.Add("[offset:100]\n[1000,1000]Oh (1000,300)(yeah)(1300,700)")
	f.Add(`<QrcInfos><LyricInfo><Lyric_1 LyricContent="[0,1]a(0,1)"/></LyricInfo></QrcInfos>`)
	f.Add("[9223372036854775807,1]x(9223372036854775807,1)")
	f.Fuzz(func(t *testing.T, in string) {
		list, _, err := lyrics.ParseQRC(in)
		if err == nil {
			invariants(t, list)
		}
	})
}

func FuzzParseKRC(f *testing.F) {
	f.Add(syntheticKRC())
	f.Add("[0,1000]<0,500,0>a<500,500,0>b")
	f.Add("[offset:-100]\n[1,1]<0,1,0>x")
	f.Fuzz(func(t *testing.T, in string) {
		list, err := lyrics.ParseKRC(in)
		if err == nil {
			invariants(t, list)
		}
	})
}

func FuzzParseYRC(f *testing.F) {
	f.Add("[1000,1500](1000,300,0)a(1300,400,0)b")
	f.Add(`{"t":0,"c":[{"tx":"x"}]}`)
	f.Add("[0,1000](0,500,0)Oh (500,500,0)(oh)")
	f.Fuzz(func(t *testing.T, in string) {
		list, err := lyrics.ParseYRC(in)
		if err == nil {
			invariants(t, list)
		}
	})
}

func FuzzParseRichSync(f *testing.F) {
	f.Add(`[{"ts":1.0,"te":3.0,"l":[{"c":"a","o":0},{"c":"b","o":0.4}],"x":"ab"}]`)
	f.Add(`[{"ts":-1,"te":1e308,"l":[{"c":"a","o":1e308}]}]`)
	f.Fuzz(func(t *testing.T, in string) {
		list, err := lyrics.ParseRichSync(in)
		if err == nil {
			invariants(t, list)
		}
	})
}

func FuzzDecodeKRC(f *testing.F) {
	f.Add(packKRC(syntheticKRC()))
	f.Add([]byte("krc1\x00\x01"))
	f.Add([]byte("plain text"))
	f.Fuzz(func(t *testing.T, in []byte) {
		text, err := lyrics.DecodeKRC(in)
		if err == nil && !utf8.ValidString(text) {
			t.Fatalf("decoded text is not UTF-8")
		}
	})
}
