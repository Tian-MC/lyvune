package lyrics

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/Tian-MC/lyvune/model"
)

// EnvelopeFormat identifies a `.lyrics.json` sidecar written by Lyvune.
const EnvelopeFormat = "navidrome-lyrics"

// EnvelopeVersion is the current schema version. Readers reject newer ones.
const EnvelopeVersion = 1

// EnvelopeSuffix is the sidecar suffix for structured lyrics.
const EnvelopeSuffix = ".lyrics.json"

// Envelope origins.
const (
	// OriginManaged marks lyrics Lyvune downloaded on its own.
	OriginManaged = "managed"
	// OriginUser marks lyrics the user selected or imported on purpose.
	OriginUser = "user"
)

// Limits that keep a malformed or hostile file from exhausting memory.
const (
	maxEnvelopeBytes = 4 << 20
	maxEnvelopeLines = 5000
	maxLineBytes     = 4096
	maxCuesPerLine   = 512
)

// Envelope is the versioned `.lyrics.json` sidecar. It keeps what a plain LRC
// cannot: word timing, translations, pronunciations, the recording the lyrics
// were matched to, where they came from, the sync offset and the lock.
//
// The `lyrics` array uses the same structure as the OpenSubsonic structured
// lyrics model, so word timings, translations and pronunciation tracks survive
// unchanged.
type Envelope struct {
	Format      string          `json:"format"`
	Version     int             `json:"version"`
	Origin      string          `json:"origin"`
	Locked      bool            `json:"locked,omitempty"`
	OffsetMs    int64           `json:"offsetMs,omitempty"`
	Provider    string          `json:"provider,omitempty"`
	ProviderID  string          `json:"providerId,omitempty"`
	Quality     string          `json:"quality"`
	Confidence  float64         `json:"confidence,omitempty"`
	RetrievedAt time.Time       `json:"retrievedAt"`
	Attribution string          `json:"attribution,omitempty"`
	Recording   Meta            `json:"recording"`
	Lyrics      model.LyricList `json:"lyrics"`
}

// ErrInvalidEnvelope wraps every reason a sidecar is rejected.
var ErrInvalidEnvelope = errors.New("invalid lyrics sidecar")

// NewEnvelope builds an envelope for a candidate. Origin says whether the
// lyrics were chosen by the user or downloaded automatically.
func NewEnvelope(c Candidate, origin string, now time.Time) Envelope {
	return Envelope{
		Format:      EnvelopeFormat,
		Version:     EnvelopeVersion,
		Origin:      origin,
		Provider:    c.Provider,
		ProviderID:  providerID(c),
		Quality:     QualityOf(c.Lyrics).String(),
		Confidence:  c.Match.Confidence,
		RetrievedAt: now.UTC(),
		Attribution: c.Attribution,
		Recording:   c.Meta,
		Lyrics:      c.Lyrics,
	}
}

func providerID(c Candidate) string {
	prefix := c.Provider + ":"
	if len(c.ID) > len(prefix) && c.ID[:len(prefix)] == prefix {
		return c.ID[len(prefix):]
	}
	return ""
}

// ParseEnvelope reads and validates a `.lyrics.json` file.
func ParseEnvelope(data []byte) (Envelope, error) {
	var env Envelope
	if len(data) > maxEnvelopeBytes {
		return env, fmt.Errorf("%w: file too large", ErrInvalidEnvelope)
	}
	if err := json.Unmarshal(data, &env); err != nil {
		return env, fmt.Errorf("%w: %w", ErrInvalidEnvelope, err)
	}
	if err := env.Validate(); err != nil {
		return Envelope{}, err
	}
	return env, nil
}

// Validate checks the structure and the bounds of an envelope.
func (e Envelope) Validate() error {
	switch {
	case e.Format != EnvelopeFormat:
		return fmt.Errorf("%w: unknown format %q", ErrInvalidEnvelope, e.Format)
	case e.Version < 1 || e.Version > EnvelopeVersion:
		return fmt.Errorf("%w: unsupported version %d", ErrInvalidEnvelope, e.Version)
	case e.Origin != OriginManaged && e.Origin != OriginUser:
		return fmt.Errorf("%w: unknown origin %q", ErrInvalidEnvelope, e.Origin)
	case len(e.Lyrics) == 0:
		return fmt.Errorf("%w: no lyrics", ErrInvalidEnvelope)
	}
	for _, l := range e.Lyrics {
		if len(l.Line) > maxEnvelopeLines {
			return fmt.Errorf("%w: too many lines", ErrInvalidEnvelope)
		}
		for _, line := range l.Line {
			if len(line.Value) > maxLineBytes || len(line.Cue) > maxCuesPerLine {
				return fmt.Errorf("%w: line too long", ErrInvalidEnvelope)
			}
			if line.Start != nil && *line.Start < 0 {
				return fmt.Errorf("%w: negative timestamp", ErrInvalidEnvelope)
			}
			for _, c := range line.Cue {
				if c.Start != nil && *c.Start < 0 {
					return fmt.Errorf("%w: negative timestamp", ErrInvalidEnvelope)
				}
				if c.Start != nil && c.End != nil && *c.End < *c.Start {
					return fmt.Errorf("%w: cue ends before it starts", ErrInvalidEnvelope)
				}
			}
		}
	}
	if QualityOf(e.Lyrics) == QualityNone {
		return fmt.Errorf("%w: lyrics are empty", ErrInvalidEnvelope)
	}
	return nil
}

// Marshal renders the envelope as indented JSON.
func (e Envelope) Marshal() ([]byte, error) {
	if err := e.Validate(); err != nil {
		return nil, err
	}
	out, err := json.MarshalIndent(e, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(out, '\n'), nil
}

// List returns the lyrics with the stored sync offset applied. The offset is
// added to any offset the lyrics already carry, so timing in the file is
// never rewritten.
func (e Envelope) List() model.LyricList {
	return withOffset(e.Lyrics, e.OffsetMs)
}

func withOffset(list model.LyricList, offsetMs int64) model.LyricList {
	if offsetMs == 0 {
		return list
	}
	out := make(model.LyricList, len(list))
	for i, l := range list {
		var base int64
		if l.Offset != nil {
			base = *l.Offset
		}
		total := base + offsetMs
		l.Offset = &total
		out[i] = l
	}
	return out
}
