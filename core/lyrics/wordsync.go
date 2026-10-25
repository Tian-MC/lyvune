package lyrics

import (
	"errors"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/navidrome/navidrome/model"
)

// timedWord is one unit of text with timing that came from a source file. End
// is nil when the source gives no end time; it is never filled in by guessing.
type timedWord struct {
	start int64
	end   *int64
	text  string
}

func i64(v int64) *int64 { return &v }

// Limits that keep a hostile or damaged document from costing more than it is
// worth. Real lyrics are far below all of them.
const (
	// maxLyricsDocBytes bounds a document handed to a word-timed parser.
	maxLyricsDocBytes = 8 << 20
	// maxLyricLines bounds the lines of one document.
	maxLyricLines = 50000
	// maxTimestampMs is the largest time accepted (100 hours). Anything above is
	// not a position in a song, and larger values would overflow when added.
	maxTimestampMs = 100 * 3600 * 1000
	// maxTagOffsetMs bounds an [offset:] tag (one hour either way).
	maxTagOffsetMs = 3600 * 1000
)

// ErrLyricsTooLarge means a document is over the parser limits.
var ErrLyricsTooLarge = errors.New("lyrics document too large")

// cleanText makes a document valid UTF-8 before it is parsed: any byte that is
// not part of a character becomes U+FFFD, so line text and the byte offsets of
// its cues always agree.
func cleanText(text string) string { return strings.ToValidUTF8(text, "\ufffd") }

// withinLimits checks the size of a document before it is parsed.
func withinLimits(text string) error {
	if len(text) > maxLyricsDocBytes {
		return ErrLyricsTooLarge
	}
	return nil
}

// parseTimeMs reads a non-negative millisecond value no larger than
// maxTimestampMs.
func parseTimeMs(s string) (int64, bool) {
	v, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
	return v, err == nil && v >= 0 && v <= maxTimestampMs
}

// parseOffsetMs reads an [offset:] tag. A value out of bounds is ignored (no
// shift) rather than clamped, since it is not a plausible correction.
func parseOffsetMs(s string) int64 {
	v, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
	if err != nil || v < -maxTagOffsetMs || v > maxTagOffsetMs {
		return 0
	}
	return v
}

// wordLine builds a line from source-timed words. The line text is the
// concatenation of the words, so cue byte offsets always land inside it (the
// end offset is inclusive, as everywhere in the lyrics model).
func wordLine(start int64, end *int64, words []timedWord) model.Line {
	var sb strings.Builder
	cues := make([]model.Cue, 0, len(words))
	for _, w := range words {
		bs := sb.Len()
		sb.WriteString(w.text)
		be := bs
		if len(w.text) > 0 {
			be = sb.Len() - 1
		}
		c := model.Cue{Start: i64(w.start), Value: w.text, ByteStart: bs, ByteEnd: be}
		if w.end != nil {
			c.End = i64(*w.end)
		}
		cues = append(cues, c)
	}
	line := model.Line{Start: i64(start), Value: sb.String(), Cue: cues}
	if end != nil {
		line.End = i64(*end)
	}
	return line
}

// mergeBlankWords folds words that carry only whitespace into the previous
// word's text, so a separator never becomes a cue with a timestamp of its own.
// No timing is changed.
func mergeBlankWords(words []timedWord) []timedWord {
	out := make([]timedWord, 0, len(words))
	for _, w := range words {
		if strings.TrimSpace(w.text) == "" && len(out) > 0 {
			out[len(out)-1].text += w.text
			continue
		}
		out = append(out, w)
	}
	return out
}

// hasText reports whether any line of the lyrics has visible text.
func hasText(l model.Lyrics) bool {
	for _, line := range l.Line {
		if strings.TrimSpace(line.Value) != "" {
			return true
		}
	}
	return false
}

const (
	// syntheticMinLines is how many lines of 4+ words a document needs before
	// its timing can be judged at all.
	syntheticMinLines = 4
	// syntheticShare is the share of those lines that must look machine-split
	// for the whole document to be distrusted.
	syntheticShare = 0.6
)

// rejectSyntheticWordTiming drops the word timing of a document whose words
// look divided up rather than measured: nearly every line has words of equal
// length in time, or of a length proportional to their letters. Such timing is
// what alignment-by-formula produces; it is not karaoke. The lines keep their
// own times, so the lyrics are still usable as line-synced. A real recording
// has the odd even line (a chanted "oh oh oh oh") but not a majority of them.
func rejectSyntheticWordTiming(list model.LyricList) (model.LyricList, bool) {
	eligible, suspect := 0, 0
	for _, l := range list {
		if !l.IsMainKind() {
			continue
		}
		for _, line := range l.Line {
			if len(line.Cue) < 4 {
				continue
			}
			eligible++
			if evenlySplit(line) {
				suspect++
			}
		}
	}
	if eligible < syntheticMinLines || float64(suspect) < syntheticShare*float64(eligible) {
		return list, false
	}
	out := make(model.LyricList, len(list))
	for i, l := range list {
		l.Line = append([]model.Line(nil), l.Line...)
		for j := range l.Line {
			l.Line[j].Cue = nil
		}
		out[i] = l
	}
	return out, true
}

// evenlySplit reports whether the gaps between a line's word starts are all
// equal, or all proportional to the number of letters in each word.
func evenlySplit(line model.Line) bool {
	n := len(line.Cue)
	gaps := make([]float64, 0, n-1)
	letters := make([]float64, 0, n-1)
	for i := 0; i < n-1; i++ {
		if line.Cue[i].Start == nil || line.Cue[i+1].Start == nil {
			return false
		}
		gaps = append(gaps, float64(*line.Cue[i+1].Start-*line.Cue[i].Start))
		letters = append(letters, float64(max(1, utf8.RuneCountInString(strings.TrimSpace(line.Cue[i].Value)))))
	}
	minG, maxG := gaps[0], gaps[0]
	for _, g := range gaps {
		minG, maxG = min(minG, g), max(maxG, g)
	}
	if maxG-minG <= 1 {
		return true
	}
	var sumG, sumL float64
	for i := range gaps {
		sumG += gaps[i]
		sumL += letters[i]
	}
	perLetter := sumG / sumL
	if perLetter <= 0 {
		return false
	}
	for i := range gaps {
		if r := gaps[i] / (letters[i] * perLetter); r < 0.97 || r > 1.03 {
			return false
		}
	}
	return true
}

// creditLine matches a line that only credits someone ("作曲 : Name",
// "Composer: Name", "Lyrics by: Name"), which services put at the top of their
// lyrics and which is metadata, not something sung.
var creditLine = regexp.MustCompile(`(?i)^\s*(?:作词|作詞|作曲|编曲|編曲|制作人|製作人|监制|词|詞|曲|演唱|lyrics?|lyricist|composer|composed|written|music|arranged|arrangement|producer|produced|vocals?|words)(?:\s+by)?\s*[:：]`)

// creditsOnly reports whether the main lyric has no real content: every line is
// a credit or blank, or the only other line is a title ("Song - Artist") sitting
// above credits. A service answers this way for a song it has no lyrics for (an
// instrumental, say), and it must not be saved as lyrics. A short real lyric
// with no credits is never caught.
func creditsOnly(list model.LyricList) bool {
	main, ok := list.Main()
	if !ok {
		return false
	}
	content, credits := 0, 0
	var only string
	for _, l := range main.Line {
		v := strings.TrimSpace(l.Value)
		switch {
		case v == "":
		case creditLine.MatchString(v):
			credits++
		default:
			content++
			only = v
		}
	}
	return content == 0 || (content == 1 && credits > 0 && strings.Contains(only, " - "))
}
