package lyrics

import (
	"github.com/navidrome/navidrome/model"
)

// Quality ranks lyrics by how precisely they are synchronized. A higher value
// always wins among candidates that match the recording.
type Quality int

const (
	QualityNone Quality = iota
	// QualityPlain is text without timestamps.
	QualityPlain
	// QualitySynced has a start time for lines.
	QualitySynced
	// QualityKaraoke has real word- or syllable-level timing from the source.
	QualityKaraoke
)

func (q Quality) String() string {
	switch q {
	case QualityPlain:
		return "plain"
	case QualitySynced:
		return "synced"
	case QualityKaraoke:
		return "karaoke"
	default:
		return "none"
	}
}

// ParseQuality is the inverse of String; unknown values are QualityNone.
func ParseQuality(s string) Quality {
	switch s {
	case "plain":
		return QualityPlain
	case "synced":
		return QualitySynced
	case "karaoke":
		return QualityKaraoke
	default:
		return QualityNone
	}
}

// QualityOf classifies the main track of a lyric list. It never infers word
// timing: karaoke needs cues that carry a start time from the source.
func QualityOf(list model.LyricList) Quality {
	best := QualityNone
	for _, l := range list {
		if !l.IsMainKind() {
			continue
		}
		q := qualityOfLyrics(l)
		if q > best {
			best = q
		}
	}
	return best
}

func qualityOfLyrics(l model.Lyrics) Quality {
	hasText, hasLineTime, hasWordTime := false, false, false
	for _, line := range l.Line {
		if line.Value != "" {
			hasText = true
		}
		if l.Synced && line.Start != nil {
			hasLineTime = true
		}
		if l.Synced {
			for _, c := range line.Cue {
				if c.Start != nil {
					hasWordTime = true
					break
				}
			}
		}
	}
	switch {
	case hasWordTime:
		return QualityKaraoke
	case hasLineTime:
		return QualitySynced
	case hasText:
		return QualityPlain
	default:
		return QualityNone
	}
}

// Source is the precedence class of a lyrics candidate. A lower value wins by
// default; the user can always choose any candidate explicitly.
type Source int

const (
	// SourceUser is lyrics the user selected, imported or locked.
	SourceUser Source = iota + 1
	// SourceSidecar is a lyrics file next to the audio that Navidrome did not write.
	SourceSidecar
	// SourceEmbedded is lyrics stored in the audio file's tags.
	SourceEmbedded
	// SourceManaged is lyrics Navidrome downloaded and stored.
	SourceManaged
	// SourceRemote is a result from an online provider, not stored yet.
	SourceRemote
)

func (s Source) String() string {
	switch s {
	case SourceUser:
		return "user"
	case SourceSidecar:
		return "sidecar"
	case SourceEmbedded:
		return "embedded"
	case SourceManaged:
		return "managed"
	case SourceRemote:
		return "remote"
	default:
		return "unknown"
	}
}

// Meta describes the recording a candidate says it belongs to.
type Meta struct {
	Title        string  `json:"title,omitempty"`
	Artist       string  `json:"artist,omitempty"`
	Album        string  `json:"album,omitempty"`
	DurationSec  float64 `json:"duration,omitempty"`
	Lang         string  `json:"lang,omitempty"`
	Instrumental bool    `json:"instrumental,omitempty"`
}

// Candidate is one set of lyrics that could be shown for a track.
type Candidate struct {
	// ID is stable for the lifetime of a search, e.g. "lrclib:123" or "embedded".
	ID       string
	Provider string
	Source   Source
	Lyrics   model.LyricList
	Quality  Quality
	Meta     Meta
	Match    Match
	// Storable is true when saving the lyrics is not ruled out: the provider's
	// terms are not recorded as restricting it (see rights.go). It says nothing
	// about a right to keep them. The engine sets it for the providers it knows.
	Storable bool
	// AutoSave is true when the automatic retrieval may save this result: it is
	// Storable, the administrator wants this provider's lyrics saved, and
	// automatic saving is on.
	AutoSave bool
	// CanShow is true when the lyrics may be shown while a track plays, from
	// memory, without being written to disk.
	CanShow bool
	// DisplayOnly is true when the lyrics may be shown but not saved at all.
	DisplayOnly bool
	// Rights is the status of the provider's terms (RightsGranted, RightsUnclear
	// or RightsRestricted); empty for a provider the table does not know.
	Rights      string
	Attribution string
	// File is the sidecar file name for local candidates, relative to the audio folder.
	File string
}
