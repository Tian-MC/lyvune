package lyrics

import (
	"html"
	"regexp"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/Tian-MC/lyvune/model"
)

// KuGou's KRC lyrics are HTML-escaped: its answer carries "eta&apos;" where the
// song says "eta'". LRC, enhanced LRC, TTML and SRT text is decoded when it is
// parsed (str.SanitizeText), before any byte offset is worked out; the KRC parser
// does the same for each word (decodeText), so the line and its cues are built
// from the decoded words.
//
// Sidecars written before that keep the text as KuGou sent it. They are not
// rewritten: ForDisplay restores the characters where the lyrics are handed
// out, for the envelopes that do not say their text is already decoded
// (Envelope.TextDecoded), and moves the byte offsets of the cues with it.
var entityProviders = []string{kugouID}

// A character reference with its closing semicolon. A bare "&" or a name
// without the semicolon ("R&B", "AT&T", "&copy") is not one and is left alone.
var entityRef = regexp.MustCompile(`&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});`)

// ForDisplay returns the list with the HTML character references decoded, when
// the lyrics came from a provider whose saved text is still escaped. Nothing else is touched:
// lyrics from other providers, from files and from tags are returned as they
// are. The list that was passed in is never modified; when there is nothing to
// decode it is returned itself.
func ForDisplay(provider string, list model.LyricList) model.LyricList {
	if !slices.Contains(entityProviders, provider) {
		return list
	}
	var out model.LyricList
	for i, l := range list {
		lines, changed := decodeLines(l.Line)
		if !changed {
			continue
		}
		if out == nil {
			out = slices.Clone(list)
		}
		out[i].Line = lines
	}
	if out == nil {
		return list
	}
	return out
}

func decodeLines(lines []model.Line) ([]model.Line, bool) {
	var out []model.Line
	for i, line := range lines {
		decoded, changed := decodeLine(line)
		if !changed {
			continue
		}
		if out == nil {
			out = slices.Clone(lines)
		}
		out[i] = decoded
	}
	if out == nil {
		return lines, false
	}
	return out, true
}

// entityEdit replaces value[from:to] with text.
type entityEdit struct {
	from, to int
	text     string
}

// decodeLine decodes one line and moves the byte offsets of its word cues with
// it. A cue covers value[ByteStart:ByteEnd+1]; when a reference before or inside
// it changes length, the cue's range follows the same characters. Times, order,
// agents and the number of cues do not change.
func decodeLine(line model.Line) (model.Line, bool) {
	spans := entityRef.FindAllStringIndex(line.Value, -1)
	if len(spans) == 0 {
		return line, false
	}
	// Offsets that do not describe the line cannot be moved safely: leave it as it is
	for _, c := range line.Cue {
		if c.ByteStart < 0 || c.ByteEnd < c.ByteStart || c.ByteEnd >= len(line.Value) {
			return line, false
		}
	}
	var edits []entityEdit
	for _, s := range spans {
		ref := line.Value[s[0]:s[1]]
		text := html.UnescapeString(ref)
		if text == ref || !plainText(text) || straddlesCue(s[0], s[1], line.Cue) {
			continue
		}
		edits = append(edits, entityEdit{s[0], s[1], text})
	}
	if len(edits) == 0 {
		return line, false
	}

	var b strings.Builder
	at := 0
	for _, e := range edits {
		b.WriteString(line.Value[at:e.from])
		b.WriteString(e.text)
		at = e.to
	}
	b.WriteString(line.Value[at:])
	value := b.String()

	// shift: how far a position of the old line moved. Positions are never inside
	// a replaced reference (straddlesCue), so edits end at or before them.
	shift := func(pos int) int {
		moved := pos
		for _, e := range edits {
			if e.to <= pos {
				moved += len(e.text) - (e.to - e.from)
			}
		}
		return moved
	}
	out := line
	out.Value = value
	if len(line.Cue) > 0 {
		out.Cue = make([]model.Cue, len(line.Cue))
		for i, c := range line.Cue {
			from, to := shift(c.ByteStart), shift(c.ByteEnd+1)
			if c.Value == line.Value[c.ByteStart:c.ByteEnd+1] {
				c.Value = value[from:to]
			} else {
				c.Value = decodeText(c.Value)
			}
			c.ByteStart, c.ByteEnd = from, to-1
			out.Cue[i] = c
		}
	}
	return out, true
}

// decodeText decodes the references of a text in a single pass: what a
// reference decodes to is not looked at again, so "&amp;apos;" gives "&apos;".
func decodeText(s string) string {
	return entityRef.ReplaceAllStringFunc(s, func(ref string) string {
		if text := html.UnescapeString(ref); text != ref && plainText(text) {
			return text
		}
		return ref
	})
}

// straddlesCue reports whether a reference is cut by the edge of a cue, which
// would leave no right place for the edge once the reference is replaced.
func straddlesCue(from, to int, cues []model.Cue) bool {
	for _, c := range cues {
		for _, edge := range [2]int{c.ByteStart, c.ByteEnd + 1} {
			if from < edge && edge < to {
				return true
			}
		}
	}
	return false
}

// plainText is false for what a reference must not turn into inside a line: a
// control character (a line break would split the line), or the replacement
// character the decoder uses for a number that is not a character.
//
// A reference stands for one character or two. The decoder also accepts a legacy
// name without its semicolon as a prefix ("&notareference;" gives "¬areference;"),
// which is a longer result and not a reference, so it is refused.
func plainText(s string) bool {
	if !utf8.ValidString(s) || utf8.RuneCountInString(s) > 2 {
		return false
	}
	for _, r := range s {
		if r == utf8.RuneError || unicode.IsControl(r) {
			return false
		}
	}
	return true
}
