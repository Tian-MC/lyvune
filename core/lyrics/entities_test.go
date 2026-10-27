package lyrics_test

import (
	"context"
	"strings"

	"github.com/Tian-MC/lyvune/core/lyrics"
	"github.com/Tian-MC/lyvune/model"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("HTML character references in provider lyrics", func() {
	text := func(value string) model.LyricList {
		return model.LyricList{{Kind: model.LyricKindMain, Lang: "xxx", Line: []model.Line{{Value: value}}}}
	}
	// words builds a karaoke line the way the parsers do: one cue per word, each
	// word followed by its space, with byte offsets into the joined line.
	words := func(ws ...string) model.LyricList {
		var line model.Line
		for i, w := range ws {
			if i < len(ws)-1 {
				w += " "
			}
			start, end := int64(i*1000), int64(i*1000+900)
			line.Cue = append(line.Cue, model.Cue{Start: &start, End: &end, Value: w, ByteStart: len(line.Value), ByteEnd: len(line.Value) + len(w) - 1})
			line.Value += w
		}
		s := int64(0)
		line.Start = &s
		return model.LyricList{{Kind: model.LyricKindMain, Lang: "xxx", Synced: true, Line: []model.Line{line}}}
	}
	// consistent: every cue still names exactly its own text in the line
	consistent := func(l model.Line) {
		for _, c := range l.Cue {
			Expect(c.ByteStart).To(BeNumerically(">=", 0))
			Expect(c.ByteEnd).To(BeNumerically("<", len(l.Value)))
			Expect(l.Value[c.ByteStart : c.ByteEnd+1]).To(Equal(c.Value))
		}
	}
	first := func(l model.LyricList) model.Line { return l[0].Line[0] }

	It("decodes the references of plain text", func() {
		for in, want := range map[string]string{
			"poem&apos;s":        "poem's",
			"He&#39;s":           "He's",
			"don&#x27;t":         "don't",
			"don&#X27;t":         "don't",
			"say &quot;hi&quot;": `say "hi"`,
			"rock &amp; roll":    "rock & roll",
			"&lt;3 you &gt; me":  "<3 you > me",
			"caf&eacute;":        "café",
			"senza eta&apos;":    "senza eta'",
			"&apos;&apos;&apos;": "'''",
		} {
			Expect(first(lyrics.ForDisplay("kugou", text(in))).Value).To(Equal(want), in)
		}
	})

	It("decodes a reference only once", func() {
		Expect(first(lyrics.ForDisplay("kugou", text("a &amp;apos; b"))).Value).To(Equal("a &apos; b"))
		Expect(first(lyrics.ForDisplay("kugou", text("&amp;amp;"))).Value).To(Equal("&amp;"))
		Expect(first(lyrics.ForDisplay("kugou", text("&#38;#39;"))).Value).To(Equal("&#39;"))
	})

	It("leaves what is not a complete reference alone", func() {
		for _, in := range []string{"R&B and AT&T", "&copy 2024", "fish & chips;", "&notareference;", "&#;", "&#xZZ;", "a & b", "&", "x&;"} {
			Expect(first(lyrics.ForDisplay("kugou", text(in))).Value).To(Equal(in), in)
		}
	})

	It("never turns a reference into a control character or a broken one", func() {
		for _, in := range []string{"a&#10;b", "a&#13;b", "a&#0;b", "a&#xD800;b", "a&#1114112;b"} {
			Expect(first(lyrics.ForDisplay("kugou", text(in))).Value).To(Equal(in), in)
		}
	})

	It("reads a numeric reference the way a browser does", func() {
		Expect(first(lyrics.ForDisplay("kugou", text("a&#x85;b"))).Value).To(Equal("a…b"))
	})

	It("gives text that looks like HTML as plain characters, for the client to show as text", func() {
		got := first(lyrics.ForDisplay("kugou", text("&lt;script&gt;alert(1)&lt;/script&gt; &lt;b&gt;x&lt;/b&gt;"))).Value
		Expect(got).To(Equal("<script>alert(1)</script> <b>x</b>"))
	})

	It("moves the byte offsets of the word cues with the text", func() {
		in := words("Sacra", "lotta", "poem&apos;s", "dura", "cruda", "di", "ideali", "senza", "eta&apos;")
		got := lyrics.ForDisplay("kugou", in)
		line := first(got)
		Expect(line.Value).To(Equal("Sacra lotta poem's dura cruda di ideali senza eta'"))
		consistent(line)
		Expect(line.Cue).To(HaveLen(9))
		Expect(line.Cue[2].Value).To(Equal("poem's "))
		Expect(line.Cue[3].Value).To(Equal("dura "))
		Expect(line.Cue[8].Value).To(Equal("eta'"))
		Expect(line.Cue[8].ByteEnd).To(Equal(len(line.Value) - 1))
	})

	It("keeps the timing, the order and everything else of the cues", func() {
		in := words("don&apos;t", "stop", "me&apos;s", "now")
		got := first(lyrics.ForDisplay("kugou", in))
		for i, c := range got.Cue {
			orig := first(in).Cue[i]
			Expect(*c.Start).To(Equal(*orig.Start))
			Expect(*c.End).To(Equal(*orig.End))
			Expect(c.AgentID).To(Equal(orig.AgentID))
		}
		Expect(got.Start).To(Equal(first(in).Start))
	})

	It("handles several references in one word and many after them", func() {
		got := first(lyrics.ForDisplay("kugou", words("&quot;rock&amp;roll&quot;", "it&#39;s", "&lt;3", "end")))
		Expect(got.Value).To(Equal(`"rock&roll" it's <3 end`))
		consistent(got)
		Expect(got.Cue[3].Value).To(Equal("end"))
	})

	It("keeps offsets valid with multibyte text before and after a reference", func() {
		got := first(lyrics.ForDisplay("kugou", words("日本語", "café", "naïve&apos;s", "😀", "한국어", "Привет&apos;", "ok")))
		Expect(got.Value).To(Equal("日本語 café naïve's 😀 한국어 Привет' ok"))
		consistent(got)
		Expect(got.Cue[3].Value).To(Equal("😀 "))
		Expect(utf8Valid(got.Value)).To(BeTrue())
	})

	It("moves the cues of every agent, background vocals included", func() {
		// the main voice and a background voice share the line; the cues are not in text order
		value := "don&apos;t go (oh&apos;h)"
		a, b, c := int64(0), int64(500), int64(900)
		line := model.Line{Start: &a, Value: value, Cue: []model.Cue{
			{Start: &a, End: &b, Value: "don&apos;t ", ByteStart: 0, ByteEnd: 10, AgentID: "v1"},
			{Start: &b, End: &c, Value: "go ", ByteStart: 11, ByteEnd: 13, AgentID: "v1"},
			{Start: &a, End: &c, Value: "oh&apos;h", ByteStart: 15, ByteEnd: 23, AgentID: "v2"},
		}}
		got := first(lyrics.ForDisplay("kugou", model.LyricList{{Line: []model.Line{line}, Agents: []model.Agent{{ID: "v1", Role: "main"}, {ID: "v2", Role: "bg"}}}}))
		Expect(got.Value).To(Equal("don't go (oh'h)"))
		consistent(got)
		Expect(got.Cue[0].AgentID).To(Equal("v1"))
		Expect(got.Cue[2].AgentID).To(Equal("v2"))
		Expect(got.Cue[2].Value).To(Equal("oh'h"))
	})

	It("does not decode a reference that a cue edge cuts in two", func() {
		a := int64(0)
		line := model.Line{Value: "it&apos;s", Cue: []model.Cue{
			{Start: &a, Value: "it&", ByteStart: 0, ByteEnd: 2},
			{Start: &a, Value: "apos;s", ByteStart: 3, ByteEnd: 8},
		}}
		got := first(lyrics.ForDisplay("kugou", model.LyricList{{Line: []model.Line{line}}}))
		Expect(got).To(Equal(line))
	})

	It("leaves a line alone when its offsets do not fit it", func() {
		a := int64(0)
		line := model.Line{Value: "it&apos;s", Cue: []model.Cue{{Start: &a, Value: "it&apos;s", ByteStart: 0, ByteEnd: 99}}}
		Expect(first(lyrics.ForDisplay("kugou", model.LyricList{{Line: []model.Line{line}}}))).To(Equal(line))
	})

	It("decodes translation and pronunciation tracks too", func() {
		in := model.LyricList{
			{Kind: model.LyricKindMain, Line: []model.Line{{Value: "eta&apos;"}}},
			{Kind: model.LyricKindPronunciation, Line: []model.Line{{Value: "e&apos;ta"}}},
			{Kind: model.LyricKindTranslation, Line: []model.Line{{Value: "l&apos;età"}}},
		}
		got := lyrics.ForDisplay("kugou", in)
		Expect([]string{got[0].Line[0].Value, got[1].Line[0].Value, got[2].Line[0].Value}).To(Equal([]string{"eta'", "e'ta", "l'età"}))
	})

	It("returns lyrics without references exactly as they were", func() {
		in := words("Sacra", "lotta", "日本語", "café", "R&B")
		got := lyrics.ForDisplay("kugou", in)
		Expect(got).To(Equal(in))
		Expect(&got[0].Line[0]).To(BeIdenticalTo(&in[0].Line[0]), "the same list, not a copy")
	})

	It("does not change the list it was given", func() {
		in := words("poem&apos;s", "x")
		before := first(in).Value
		beforeCue := first(in).Cue[0]
		_ = lyrics.ForDisplay("kugou", in)
		Expect(first(in).Value).To(Equal(before))
		Expect(first(in).Cue[0]).To(Equal(beforeCue))
	})

	It("only touches the providers known to send escaped text", func() {
		for _, p := range []string{"lrclib", "netease", "musixmatch", "qq", "sidecar", "embedded", ""} {
			in := text("poem&apos;s")
			Expect(lyrics.ForDisplay(p, in)).To(Equal(in), p)
		}
		Expect(first(lyrics.ForDisplay("kugou", text("poem&apos;s"))).Value).To(Equal("poem's"))
	})

	It("is decoded at parse time for KRC, offsets and translation included", func() {
		const krc = "[id:$00000000]\n[ti:t]\n[offset:0]\n[language:" +
			"@LANG@" + "]\n" +
			"[33793,12174]<0,1704,0>Sacra <1704,1417,0>lotta <3121,1581,0>poem&apos;s <4702,1625,0>caf\u00e9 <6327,837,0>\u65e5\u672c <7164,2475,0>&lt;3 <9639,1532,0>&amp;apos; <11171,1003,0>eta&apos;\n" +
			"[50000,3000]no word tags, don&#39;t stop\n"
		list, err := lyrics.ParseKRC(strings.Replace(krc, "@LANG@", krcLanguage(
			[][]string{{"S", "l", "p&apos;s", "c", "n", "l", "a", "e&apos;"}, {"no word"}},
			[][]string{{"l&apos;eta"}, {"it&apos;s"}}), 1))
		Expect(err).ToNot(HaveOccurred())
		Expect(list).To(HaveLen(3))
		line := first(list)
		Expect(line.Value).To(Equal("Sacra lotta poem's caf\u00e9 \u65e5\u672c <3 &apos; eta'"), "decoded once: &amp;apos; gives &apos;")
		consistent(line)
		Expect(line.Cue).To(HaveLen(8))
		Expect(line.Cue[2].Value).To(Equal("poem's "))
		Expect(*line.Cue[2].Start).To(Equal(int64(33793 + 3121)))
		Expect(line.Cue[7].Value).To(Equal("eta'"))
		Expect(line.Cue[7].ByteEnd).To(Equal(len(line.Value) - 1))
		Expect(list[0].Line[1].Value).To(Equal("no word tags, don't stop"))
		Expect(list[1].Line[0].Value).To(Equal("l'eta"), "translation")
		Expect(list[1].Line[1].Value).To(Equal("it's"))
		pron := list[2].Line[0]
		Expect(pron.Value).To(ContainSubstring("p's"))
		consistent(pron)
	})

	It("is the same for LRC and enhanced LRC, which are decoded when they are parsed", func() {
		list, err := model.ParseLyrics(context.Background(), ".lrc", "xxx", []byte("[00:33.79]Sacra eta&apos;\n[00:40.00]<00:40.00>don&apos;t <00:40.50>caf\u00e9 <00:41.00>poem&apos;s\n"))
		Expect(err).ToNot(HaveOccurred())
		Expect(list[0].Line[0].Value).To(Equal("Sacra eta'"))
		l := list[0].Line[1]
		Expect(l.Value).To(Equal("don't caf\u00e9 poem's"))
		consistent(l)
		Expect(l.Cue[2].Value).To(Equal("poem's"))
	})
})

func utf8Valid(s string) bool { return strings.ToValidUTF8(s, "\x00") == s }
