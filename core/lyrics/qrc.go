package lyrics

import (
	"errors"
	"fmt"
	"html"
	"strconv"
	"strings"

	"github.com/navidrome/navidrome/model"
)

// QRC is QQ Music's word-timed lyrics format. It is XML around an LRC-like
// body:
//
//	<QrcInfos><QrcHeadInfo .../><LyricInfo LyricCount="1">
//	  <Lyric_1 LyricType="1" LyricContent="[ti:..]&#10;[0,4690]Hel(0,500)lo(500,521)..."/>
//	</LyricInfo></QrcInfos>
//
// Inside LyricContent a line is "[lineStart,lineDuration]" followed by words,
// each word's text coming BEFORE its own "(start,duration)" token. All times are
// milliseconds and word starts are absolute (from the start of the song). A
// word ends at start+duration, not at the next word's start; a duration of 0
// means the source does not say, so no end is set.
//
// Only the decrypted text is read here. The encrypted form QQ serves to its own
// apps is not decoded by this project.

// ErrNotQRC means the text holds no QRC lyric lines.
var ErrNotQRC = errors.New("not a QRC document")

const (
	qrcContentOpen  = `LyricContent="`
	qrcContentClose = `"/>`
)

// QRCBody extracts the lyric body from a QRC envelope. Text without the
// envelope is taken to be the body itself, so a bare body can be imported too.
//
// The envelope is not parsed as XML on purpose: real documents carry raw double
// quotes inside the LyricContent attribute ("The Weeknd"), which makes them
// ill-formed. The body is cut out between the attribute opening and the last
// closing of the element, then the XML entities are decoded.
func QRCBody(text string) (string, error) {
	text = strings.TrimPrefix(text, "\ufeff")
	if !strings.Contains(text, "<QrcInfos") {
		return text, nil
	}
	open := strings.Index(text, qrcContentOpen)
	if open < 0 {
		return "", fmt.Errorf("%w: no LyricContent", ErrNotQRC)
	}
	rest := text[open+len(qrcContentOpen):]
	end := strings.LastIndex(rest, qrcContentClose)
	if end < 0 {
		// A space before the slash is also valid XML
		end = strings.LastIndex(rest, `" />`)
	}
	if end < 0 {
		return "", fmt.Errorf("%w: LyricContent is not closed", ErrNotQRC)
	}
	body := html.UnescapeString(rest[:end])
	if strings.TrimSpace(body) == "" {
		return "", fmt.Errorf("%w: empty LyricContent", ErrNotQRC)
	}
	return body, nil
}

// QRCTags are the header tags of a QRC body that identify the recording.
type QRCTags struct {
	Title, Artist, Album string
}

// ParseQRC parses a QRC document (envelope or bare body) into the lyrics model
// and returns its header tags, which name the recording the lyrics belong to.
func ParseQRC(text string) (model.LyricList, QRCTags, error) {
	body, err := QRCBody(text)
	if err != nil {
		return nil, QRCTags{}, err
	}
	var (
		lines  []model.Line
		tags   QRCTags
		offset int64
	)
	for raw := range strings.SplitSeq(strings.ReplaceAll(body, "\r\n", "\n"), "\n") {
		raw = strings.TrimSpace(raw)
		if !strings.HasPrefix(raw, "[") {
			continue
		}
		head, rest, ok := strings.Cut(raw[1:], "]")
		if !ok {
			continue
		}
		if start, dur, ok := parsePair(head); ok {
			lines = append(lines, parseQRCLine(start, dur, rest))
			continue
		}
		key, val, _ := strings.Cut(head, ":")
		val = strings.TrimSpace(val)
		switch strings.ToLower(key) {
		case "ti":
			tags.Title = val
		case "ar":
			tags.Artist = val
		case "al":
			tags.Album = val
		case "offset":
			offset, _ = strconv.ParseInt(val, 10, 64)
		}
	}
	if len(lines) == 0 {
		return nil, tags, fmt.Errorf("%w: no lyric lines", ErrNotQRC)
	}
	if offset != 0 {
		shiftLines(lines, offset)
	}
	main := model.Lyrics{Kind: model.LyricKindMain, Lang: "xxx", Synced: true, Line: lines}
	if !hasText(main) {
		return nil, tags, fmt.Errorf("%w: no text", ErrNotQRC)
	}
	return model.LyricList{main}, tags, nil
}

// parseQRCLine reads "word(start,dur)word(start,dur)". A "(" that does not open
// a timing token is part of the text ("(oh)").
func parseQRCLine(start, dur int64, body string) model.Line {
	var words []timedWord
	var text strings.Builder
	for i := 0; i < len(body); i++ {
		if body[i] == '(' {
			if end := strings.IndexByte(body[i:], ')'); end > 0 {
				if ws, wd, ok := parsePair(body[i+1 : i+end]); ok {
					w := timedWord{start: ws, text: text.String()}
					if wd > 0 {
						w.end = i64(ws + wd)
					}
					words = append(words, w)
					text.Reset()
					i += end
					continue
				}
			}
		}
		text.WriteByte(body[i])
	}
	if tail := text.String(); tail != "" && len(words) > 0 {
		// Text after the last token has no time of its own
		words[len(words)-1].text += tail
	}
	if len(words) == 0 {
		return model.Line{Start: i64(start), End: i64(start + dur), Value: strings.TrimSpace(body)}
	}
	line := wordLine(start, i64(start+dur), mergeBlankWords(words))
	if dur == 0 {
		line.End = nil
	}
	return line
}
