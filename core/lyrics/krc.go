package lyrics

import (
	"bytes"
	"compress/zlib"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"unicode/utf8"

	"github.com/Tian-MC/lyvune/model"
)

// KRC is KuGou's karaoke lyrics format. A file is either plain text or the
// distributed form: the bytes "krc1", then a zlib stream XOR-ed with a fixed
// 16-byte key. The key is part of the file format (it is the same for every
// file and not a secret tied to an account), so decoding it is reading a file
// format, not getting around an access control.
//
// This parser was written from the format itself, checked against a real file
// downloaded from KuGou, not copied from another project:
//
//	[id:$00000000]
//	[ti:Title]  [ar:Artist]  [offset:0]  [language:<base64 JSON>]
//	[lineStart,lineDuration]<wordOffset,wordDuration,0>text<...>text
//
// Line starts are absolute milliseconds; word offsets are relative to their
// line. Everything is source timing; nothing is estimated.

var krcKey = [16]byte{64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105}

const (
	krcMagic = "krc1"
	// maxKRCBytes bounds the decompressed size so a hostile file cannot
	// exhaust memory.
	maxKRCBytes = 8 << 20
)

// ErrNotKRC means the data is neither a KRC container nor KRC text.
var ErrNotKRC = errors.New("not a KRC file")

// DecodeKRC returns the text of a KRC file. Data that is already text is
// returned unchanged, so a user can import either form.
func DecodeKRC(data []byte) (string, error) {
	if !bytes.HasPrefix(data, []byte(krcMagic)) {
		if !utf8.Valid(data) {
			return "", ErrNotKRC
		}
		return strings.TrimPrefix(string(data), "\ufeff"), nil
	}
	buf := bytes.Clone(data[len(krcMagic):])
	for i := range buf {
		buf[i] ^= krcKey[i%len(krcKey)]
	}
	zr, err := zlib.NewReader(bytes.NewReader(buf))
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrNotKRC, err)
	}
	defer zr.Close()
	out, err := io.ReadAll(io.LimitReader(zr, maxKRCBytes+1))
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrNotKRC, err)
	}
	if len(out) > maxKRCBytes {
		return "", fmt.Errorf("%w: too large", ErrNotKRC)
	}
	if !utf8.Valid(out) {
		return "", fmt.Errorf("%w: not UTF-8", ErrNotKRC)
	}
	return strings.TrimPrefix(string(out), "\ufeff"), nil
}

// krcLanguage is the decoded [language:] block. type 0 is romanization and
// type 1 a translation; each has one entry per body line.
type krcLanguage struct {
	Content []struct {
		LyricContent [][]string `json:"lyricContent"`
		Type         int        `json:"type"`
		Language     int        `json:"language"`
	} `json:"content"`
}

// ParseKRC parses KRC text (see DecodeKRC) into the lyrics model. The first
// lyric is the original with word timing; a translation and a romanization
// follow when the file carries them. A line with no word tags keeps only its
// line time.
func ParseKRC(text string) (model.LyricList, error) {
	if err := withinLimits(text); err != nil {
		return nil, err
	}
	text = cleanText(text)
	var (
		lines  []model.Line
		offset int64
		lang   krcLanguage
	)
	for raw := range strings.SplitSeq(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		raw = strings.TrimSpace(raw)
		if !strings.HasPrefix(raw, "[") {
			continue
		}
		head, rest, ok := strings.Cut(raw[1:], "]")
		if !ok {
			continue
		}
		if start, dur, ok := parsePair(head); ok {
			if len(lines) >= maxLyricLines {
				return nil, fmt.Errorf("%w: too many lines", ErrLyricsTooLarge)
			}
			lines = append(lines, parseKRCLine(start, dur, rest))
			continue
		}
		key, val, _ := strings.Cut(head, ":")
		switch strings.ToLower(key) {
		case "offset":
			offset = parseOffsetMs(val)
		case "language":
			if dec, err := base64.StdEncoding.DecodeString(strings.TrimSpace(val)); err == nil {
				_ = json.Unmarshal(dec, &lang) // a bad block only loses the extras
			}
		}
	}
	if len(lines) == 0 {
		return nil, fmt.Errorf("%w: no lyric lines", ErrNotKRC)
	}
	if offset != 0 {
		shiftLines(lines, offset)
	}
	main := model.Lyrics{Kind: model.LyricKindMain, Lang: "xxx", Synced: true, Line: lines}
	if !hasText(main) {
		return nil, fmt.Errorf("%w: no text", ErrNotKRC)
	}
	// Always original, translation, romanization, whatever order the file uses
	var tr, ro *model.Lyrics
	for _, c := range lang.Content {
		switch c.Type {
		case 1:
			tr = krcTranslation(lines, c.LyricContent)
		case 0:
			ro = krcRomanization(lines, c.LyricContent)
		}
	}
	list := model.LyricList{main}
	for _, extra := range []*model.Lyrics{tr, ro} {
		if extra != nil {
			list = append(list, *extra)
		}
	}
	return list, nil
}

func parsePair(s string) (int64, int64, bool) {
	a, b, ok := strings.Cut(s, ",")
	if !ok {
		return 0, 0, false
	}
	x, ok1 := parseTimeMs(a)
	y, ok2 := parseTimeMs(b)
	return x, y, ok1 && ok2
}

// parseKRCLine reads "<off,dur,flag>text" groups. Text before the first tag,
// or a line with no tags, is kept as untimed line text.
func parseKRCLine(start, dur int64, body string) model.Line {
	var words []timedWord
	rest := body
	for {
		open := strings.IndexByte(rest, '<')
		if open < 0 {
			break
		}
		closeIdx := strings.IndexByte(rest[open:], '>')
		if closeIdx < 0 {
			break
		}
		tag := rest[open+1 : open+closeIdx]
		rest = rest[open+closeIdx+1:]
		next := strings.IndexByte(rest, '<')
		word := rest
		if next >= 0 {
			word = rest[:next]
		}
		fields := strings.Split(tag, ",")
		off, okO := parseTimeMs(fields[0])
		wdur, okD := int64(-1), true
		if len(fields) > 1 {
			wdur, okD = parseTimeMs(fields[1])
		}
		if !okO || !okD {
			// Not a timing tag: it is part of the text
			if len(words) > 0 {
				words[len(words)-1].text += "<" + tag + ">" + word
			}
			rest = rest[len(word):]
			continue
		}
		w := timedWord{start: start + off, text: word}
		if wdur >= 0 {
			w.end = i64(start + off + wdur)
		}
		words = append(words, w)
	}
	if len(words) == 0 {
		return model.Line{Start: i64(start), End: i64(start + dur), Value: strings.TrimSpace(body)}
	}
	return wordLine(start, i64(start+dur), mergeBlankWords(words))
}

func shiftLines(lines []model.Line, by int64) {
	add := func(p **int64) {
		if *p != nil {
			// A negative offset cannot move a time before the start of the song
			*p = i64(max(0, **p+by))
		}
	}
	for i := range lines {
		add(&lines[i].Start)
		add(&lines[i].End)
		for j := range lines[i].Cue {
			add(&lines[i].Cue[j].Start)
			add(&lines[i].Cue[j].End)
		}
	}
}

// krcTranslation aligns translated lines with the original by index. The
// translation has line times only: it is a different text, so word times of
// the original do not apply to it.
func krcTranslation(orig []model.Line, content [][]string) *model.Lyrics {
	out := make([]model.Line, 0, len(orig))
	any := false
	for i, o := range orig {
		var v string
		if i < len(content) {
			v = strings.TrimSpace(strings.Join(content[i], ""))
		}
		if v != "" {
			any = true
		}
		out = append(out, model.Line{Start: o.Start, End: o.End, Value: v})
	}
	if !any {
		return nil
	}
	return &model.Lyrics{Kind: model.LyricKindTranslation, Lang: "xxx", Synced: true, Line: out}
}

// krcRomanization keeps the original word timing only when the file gives
// exactly one romanized piece per original word. Otherwise the line is text at
// the line time: pieces cannot be paired with words without guessing.
func krcRomanization(orig []model.Line, content [][]string) *model.Lyrics {
	out := make([]model.Line, 0, len(orig))
	any := false
	for i, o := range orig {
		var parts []string
		if i < len(content) {
			parts = content[i]
		}
		if len(parts) > 0 && len(parts) == len(o.Cue) {
			words := make([]timedWord, len(parts))
			for k, p := range parts {
				words[k] = timedWord{start: *o.Cue[k].Start, text: p}
				if o.Cue[k].End != nil {
					words[k].end = i64(*o.Cue[k].End)
				}
			}
			line := wordLine(*o.Start, o.End, words)
			if strings.TrimSpace(line.Value) != "" {
				any = true
			}
			out = append(out, line)
			continue
		}
		v := strings.TrimSpace(strings.Join(parts, ""))
		if v != "" {
			any = true
		}
		out = append(out, model.Line{Start: o.Start, End: o.End, Value: v})
	}
	if !any {
		return nil
	}
	return &model.Lyrics{Kind: model.LyricKindPronunciation, Lang: "xxx", Synced: true, Line: out}
}
