package lyrics

import (
	"math"
	"regexp"
	"strings"
	"unicode"

	"github.com/navidrome/navidrome/model"
	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
)

// Confidence thresholds for a candidate's match with the recording.
const (
	// ConfidenceAuto is the minimum for storing a result without asking the user.
	ConfidenceAuto = 0.85
	// ConfidenceListed is the minimum for showing a result in manual search.
	ConfidenceListed = 0.5
)

// Recording is what we know about the track lyrics are wanted for.
type Recording struct {
	Title       string
	Artist      string
	AlbumArtist string
	Album       string
	DurationSec float64
	ISRC        string
}

// RecordingOf describes a media file.
func RecordingOf(mf *model.MediaFile) Recording {
	rec := Recording{
		Title:       mf.Title,
		Artist:      mf.Artist,
		AlbumArtist: mf.AlbumArtist,
		Album:       mf.Album,
		DurationSec: float64(mf.Duration),
	}
	if isrc := mf.Tags[model.TagISRC]; len(isrc) > 0 {
		rec.ISRC = isrc[0]
	}
	return rec
}

// Match is how well a candidate's metadata fits the recording. Each component
// is 0..1; Confidence combines them.
type Match struct {
	Confidence    float64  `json:"confidence"`
	Title         float64  `json:"title"`
	Artist        float64  `json:"artist"`
	Album         float64  `json:"album"`
	Duration      float64  `json:"duration"`
	DurationDelta float64  `json:"durationDelta"`
	Mismatch      []string `json:"mismatch,omitempty"`
}

// Verified reports whether the match is strong enough to store automatically.
func (m Match) Verified() bool { return m.Confidence >= ConfidenceAuto }

// Listed reports whether the match is plausible enough to offer to the user.
func (m Match) Listed() bool { return m.Confidence >= ConfidenceListed }

// ScoreMatch compares a candidate's metadata with the recording.
func ScoreMatch(rec Recording, meta Meta) Match {
	var m Match

	recTitle, recTags := splitTitle(rec.Title)
	candTitle, candTags := splitTitle(meta.Title)
	m.Title = similarity(normalize(recTitle), normalize(candTitle))

	m.Artist = artistScore(rec, meta.Artist)

	m.Album = 0.5
	if rec.Album != "" && meta.Album != "" {
		m.Album = similarity(normalize(rec.Album), normalize(meta.Album))
	}

	m.Duration = 0.5
	if rec.DurationSec > 0 && meta.DurationSec > 0 {
		m.DurationDelta = math.Abs(rec.DurationSec - meta.DurationSec)
		switch {
		case m.DurationDelta <= 2:
			m.Duration = 1
		case m.DurationDelta <= 5:
			m.Duration = 0.75
		case m.DurationDelta <= 10:
			m.Duration = 0.4
		default:
			m.Duration = 0
		}
	}

	m.Confidence = 0.40*m.Title + 0.30*m.Artist + 0.25*m.Duration + 0.05*m.Album

	// A good score on one field must not rescue a wrong recording.
	if m.Title < 0.6 || m.Artist < 0.5 {
		m.Confidence = math.Min(m.Confidence, 0.4)
		m.Mismatch = append(m.Mismatch, "metadata")
	}
	if m.DurationDelta > 15 {
		m.Confidence = math.Min(m.Confidence, 0.45)
		m.Mismatch = append(m.Mismatch, "duration")
	}
	if diff := versionDifference(recTags, candTags); len(diff) > 0 {
		m.Confidence *= 0.5
		m.Mismatch = append(m.Mismatch, diff...)
	}
	m.Confidence = math.Round(m.Confidence*1000) / 1000
	return m
}

// hardVersions change the recording itself, so lyrics from one are not safe for
// another (different timing, sometimes different words). Remasters, mono mixes
// and similar do not.
var hardVersions = map[string]*regexp.Regexp{
	"live":         regexp.MustCompile(`(?i)\blive\b|ライブ|现场|現場|라이브`),
	"remix":        regexp.MustCompile(`(?i)\bremix\b|\bmix\b|リミックス`),
	"acoustic":     regexp.MustCompile(`(?i)\bacoustic\b|アコースティック`),
	"instrumental": regexp.MustCompile(`(?i)\binstrumental\b|\boff vocal\b|\bkaraoke\b|インスト|カラオケ|伴奏`),
	"cover":        regexp.MustCompile(`(?i)\bcover\b|カバー`),
	"demo":         regexp.MustCompile(`(?i)\bdemo\b`),
	"speed":        regexp.MustCompile(`(?i)\bsped up\b|\bspeed up\b|\bslowed\b|\bnightcore\b|\b8d\b`),
}

// versionNoise is bracketed text that carries no lyrics-relevant information.
var versionNoise = regexp.MustCompile(`(?i)\b(remaster(ed)?|mono|stereo|deluxe|version|edit|single|bonus|explicit|clean|\d{4})\b`)

var featMarker = regexp.MustCompile(`(?i)^(feat\.?|ft\.?|featuring|with)\b`)

var bracketed = regexp.MustCompile(`[\(\[（【]([^\)\]）】]*)[\)\]）】]`)

// splitTitle returns the title without version/featuring decorations and the
// set of hard version tags found in them.
func splitTitle(title string) (string, map[string]bool) {
	tags := map[string]bool{}
	collect := func(text string) {
		for name, re := range hardVersions {
			if re.MatchString(text) {
				tags[name] = true
			}
		}
	}

	core := bracketed.ReplaceAllStringFunc(title, func(group string) string {
		inner := strings.TrimSpace(trimDelims(group))
		if featMarker.MatchString(inner) {
			return " "
		}
		collect(inner)
		if versionNoise.MatchString(inner) || hasHardVersion(inner) {
			return " "
		}
		// A real part of the title, e.g. "(What's the Story) Morning Glory?"
		return " " + inner + " "
	})

	// "Song - Live at X" / "Song - 2011 Remaster"
	if i := strings.LastIndex(core, " - "); i > 0 {
		suffix := core[i+3:]
		collect(suffix)
		if versionNoise.MatchString(suffix) || hasHardVersion(suffix) {
			core = core[:i]
		}
	}
	return core, tags
}

func trimDelims(group string) string {
	r := []rune(group)
	if len(r) < 2 {
		return group
	}
	return string(r[1 : len(r)-1])
}

func hasHardVersion(text string) bool {
	for _, re := range hardVersions {
		if re.MatchString(text) {
			return true
		}
	}
	return false
}

func versionDifference(rec, cand map[string]bool) []string {
	var diff []string
	for name := range hardVersions {
		if rec[name] != cand[name] {
			diff = append(diff, "version:"+name)
		}
	}
	return diff
}

var artistSplit = regexp.MustCompile(`(?i)\s*(?:;|,|&|/|\+|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\bwith\b|\bx\b|、|と)\s*`)

func artistNames(s string) []string {
	var out []string
	for _, part := range artistSplit.Split(s, -1) {
		if n := normalize(part); n != "" {
			out = append(out, n)
		}
	}
	return out
}

func artistScore(rec Recording, candArtist string) float64 {
	cand := artistNames(candArtist)
	have := append(artistNames(rec.Artist), artistNames(rec.AlbumArtist)...)
	if len(cand) == 0 || len(have) == 0 {
		return 0.5
	}
	best := 0.0
	exact := 0
	for _, c := range cand {
		for _, h := range have {
			s := similarity(c, h)
			if s > best {
				best = s
			}
			if c == h {
				exact++
				break
			}
		}
	}
	// Every credited artist on the candidate is one of ours: a full match even
	// when the library credits more (or fewer) featured artists.
	if exact == len(cand) {
		return 1
	}
	if exact > 0 {
		return math.Max(best, 0.9)
	}
	return best
}

// normalize folds case, width, punctuation and (for non-CJK text) diacritics so
// that equivalent spellings compare equal.
func normalize(s string) string {
	s = norm.NFKC.String(s)
	if !hasCJK(s) {
		t := transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC)
		if folded, _, err := transform.String(t, s); err == nil {
			s = folded
		}
	}
	s = strings.ToLower(s)
	var b strings.Builder
	space := true
	for _, r := range s {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r) || unicode.Is(unicode.Mn, r):
			b.WriteRune(r)
			space = false
		default:
			if !space {
				b.WriteByte(' ')
				space = true
			}
		}
	}
	return strings.TrimSpace(b.String())
}

func hasCJK(s string) bool {
	for _, r := range s {
		if unicode.In(r, unicode.Han, unicode.Hiragana, unicode.Katakana, unicode.Hangul) {
			return true
		}
	}
	return false
}

// similarity is 1 for equal strings, otherwise a Dice coefficient over rune
// bigrams (works for CJK, which has no word boundaries).
func similarity(a, b string) float64 {
	if a == "" || b == "" {
		return 0
	}
	if a == b {
		return 1
	}
	ar, br := []rune(strings.ReplaceAll(a, " ", "")), []rune(strings.ReplaceAll(b, " ", ""))
	if len(ar) < 2 || len(br) < 2 {
		return 0
	}
	grams := map[[2]rune]int{}
	for i := 0; i < len(ar)-1; i++ {
		grams[[2]rune{ar[i], ar[i+1]}]++
	}
	common := 0
	for i := 0; i < len(br)-1; i++ {
		g := [2]rune{br[i], br[i+1]}
		if grams[g] > 0 {
			grams[g]--
			common++
		}
	}
	return 2 * float64(common) / float64(len(ar)-1+len(br)-1)
}
