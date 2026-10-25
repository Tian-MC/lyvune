package lyrics

import (
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
