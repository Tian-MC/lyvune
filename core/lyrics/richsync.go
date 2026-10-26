package lyrics

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"

	"github.com/Tian-MC/lyvune/model"
)

// RichSync is Musixmatch's word-timed lyrics format, returned by the
// documented track.richsync.get call as a JSON string:
//
//	[{"ts":12.3,"te":15.9,"l":[{"c":"Hel","o":0.0},{"c":"lo","o":0.4}],"x":"Hello"}]
//
// ts/te are the line start and end in seconds; each o is the word's start
// offset from ts in seconds. A word's end is not given: only the last word of a
// line has one (te). Other ends are left empty rather than derived.

// ErrNotRichSync means the data is not a RichSync document.
var ErrNotRichSync = errors.New("not a RichSync document")

type richSyncLine struct {
	TS float64 `json:"ts"`
	TE float64 `json:"te"`
	L  []struct {
		C string  `json:"c"`
		O float64 `json:"o"`
	} `json:"l"`
	X string `json:"x"`
}

func secToMs(s float64) int64 { return int64(math.Round(s * 1000)) }

// ParseRichSync parses the richsync_body JSON.
func ParseRichSync(body string) (model.LyricList, error) {
	if err := withinLimits(body); err != nil {
		return nil, err
	}
	var in []richSyncLine
	if err := json.Unmarshal([]byte(body), &in); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrNotRichSync, err)
	}
	if len(in) > maxLyricLines {
		return nil, fmt.Errorf("%w: too many lines", ErrLyricsTooLarge)
	}
	var lines []model.Line
	for _, l := range in {
		if l.TS < 0 || math.IsNaN(l.TS) || math.IsInf(l.TS, 0) || l.TE < l.TS || l.TE*1000 > maxTimestampMs {
			continue
		}
		start, end := secToMs(l.TS), secToMs(l.TE)
		var words []timedWord
		for _, w := range l.L {
			if w.O < 0 || math.IsNaN(w.O) || math.IsInf(w.O, 0) || (l.TS+w.O)*1000 > maxTimestampMs {
				words = nil
				break
			}
			words = append(words, timedWord{start: start + secToMs(w.O), text: w.C})
		}
		words = mergeBlankWords(words)
		if len(words) > 0 && words[len(words)-1].start <= end {
			words[len(words)-1].end = i64(end)
		}
		if len(words) == 0 {
			if v := strings.TrimSpace(l.X); v != "" {
				lines = append(lines, model.Line{Start: i64(start), End: i64(end), Value: v})
			}
			continue
		}
		lines = append(lines, wordLine(start, i64(end), words))
	}
	main := model.Lyrics{Kind: model.LyricKindMain, Lang: "xxx", Synced: true, Line: lines}
	if !hasText(main) {
		return nil, fmt.Errorf("%w: no text", ErrNotRichSync)
	}
	return model.LyricList{main}, nil
}
