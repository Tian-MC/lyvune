package lyrics

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/navidrome/navidrome/model"
)

// YRC is NetEase Cloud Music's word-timed lyrics format:
//
//	{"t":0,"c":[{"tx":"credit: "},{"tx":"name"}]}          (metadata line)
//	[lineStart,lineDuration](wordStart,wordDuration,0)text(...)text
//
// All times are absolute milliseconds. The online NetEase adapter does not
// request YRC (no authorized plain endpoint returns it), so this parser serves
// files a user supplies themselves; see LYRICS_PROVIDERS_RESEARCH.md.

// ErrNotYRC means the text holds no YRC lines.
var ErrNotYRC = errors.New("not a YRC file")

// ParseYRC parses YRC text. Metadata JSON lines keep their line time only.
func ParseYRC(text string) (model.LyricList, error) {
	var lines []model.Line
	for raw := range strings.SplitSeq(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		raw = strings.TrimSpace(strings.TrimPrefix(raw, "\ufeff"))
		switch {
		case strings.HasPrefix(raw, "{"):
			if l, ok := parseYRCMeta(raw); ok {
				lines = append(lines, l)
			}
		case strings.HasPrefix(raw, "["):
			head, body, ok := strings.Cut(raw[1:], "]")
			if !ok {
				continue
			}
			start, dur, ok := parsePair(head)
			if !ok {
				continue
			}
			lines = append(lines, parseYRCLine(start, dur, body))
		}
	}
	if len(lines) == 0 {
		return nil, ErrNotYRC
	}
	main := model.Lyrics{Kind: model.LyricKindMain, Lang: "xxx", Synced: true, Line: lines}
	if !hasText(main) {
		return nil, fmt.Errorf("%w: no text", ErrNotYRC)
	}
	return model.LyricList{main}, nil
}

func parseYRCMeta(raw string) (model.Line, bool) {
	var m struct {
		T int64 `json:"t"`
		C []struct {
			Tx string `json:"tx"`
		} `json:"c"`
	}
	if json.Unmarshal([]byte(raw), &m) != nil || m.T < 0 {
		return model.Line{}, false
	}
	var sb strings.Builder
	for _, c := range m.C {
		sb.WriteString(c.Tx)
	}
	if strings.TrimSpace(sb.String()) == "" {
		return model.Line{}, false
	}
	return model.Line{Start: i64(m.T), Value: strings.TrimSpace(sb.String())}, true
}

func parseYRCLine(start, dur int64, body string) model.Line {
	var words []timedWord
	rest := body
	for {
		open := strings.IndexByte(rest, '(')
		if open < 0 {
			break
		}
		closeIdx := strings.IndexByte(rest[open:], ')')
		if closeIdx < 0 {
			break
		}
		tag := rest[open+1 : open+closeIdx]
		after := rest[open+closeIdx+1:]
		fields := strings.Split(tag, ",")
		ws, errS := strconv.ParseInt(strings.TrimSpace(fields[0]), 10, 64)
		wd, errD := int64(-1), error(nil)
		if len(fields) > 1 {
			wd, errD = strconv.ParseInt(strings.TrimSpace(fields[1]), 10, 64)
		}
		next := strings.IndexByte(after, '(')
		text := after
		if next >= 0 {
			text = after[:next]
		}
		if errS != nil || errD != nil || ws < 0 || len(fields) < 2 {
			// Parentheses that are part of the lyric text, e.g. "(oh)"
			if len(words) > 0 {
				words[len(words)-1].text += rest[:open+closeIdx+1] + text
			}
			rest = after[len(text):]
			continue
		}
		w := timedWord{start: ws, text: text}
		if wd >= 0 {
			w.end = i64(ws + wd)
		}
		words = append(words, w)
		rest = after[len(text):]
	}
	if len(words) == 0 {
		return model.Line{Start: i64(start), End: i64(start + dur), Value: strings.TrimSpace(body)}
	}
	return wordLine(start, i64(start+dur), mergeBlankWords(words))
}
