package lyrics

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strconv"
	"time"

	"github.com/navidrome/navidrome/model"
)

const (
	settingsKey  = "Lyrics.Settings"
	stateKeyFmt  = "Lyrics.State."
	missKeyFmt   = "Lyrics.Miss."
	missTTL      = 7 * 24 * time.Hour
	upgradeEvery = 7 * 24 * time.Hour
)

// Settings are the server-wide lyrics preferences. They are stored in the
// database, so they survive restarts; provider credentials are not part of
// them and live only in the server configuration.
type Settings struct {
	// PreferLocal makes local files (sidecars, embedded tags) win over
	// downloaded lyrics regardless of quality. Default true.
	PreferLocal bool `json:"preferLocal"`
	// AutoRetrieve fetches lyrics for tracks that have none. Default true.
	AutoRetrieve bool `json:"autoRetrieve"`
	// AutoUpgrade looks for better lyrics for Navidrome-managed lyrics. Default true.
	AutoUpgrade bool `json:"autoUpgrade"`
	// AutoReplaceManual lets an automatic upgrade supersede a sidecar or embedded
	// lyrics the user supplied. Default false.
	AutoReplaceManual bool `json:"autoReplaceManual"`
	// Providers lists provider IDs, in order, that are searched. A provider not
	// listed is off.
	Providers []string `json:"providers"`
	// AutoPersist lets the automatic retrieval and upgrade save what they find,
	// for the providers whose save preference is on. When off, results are only
	// shown. Default true.
	AutoPersist bool `json:"autoPersist"`
	// StorePref is the administrator's wish, per provider, to have its lyrics
	// saved automatically. It is a preference and never a right: a provider whose
	// terms are recorded as restricting storage is not saved whatever it says
	// (rights.go). A provider without an entry follows Store (below), then its
	// default.
	StorePref map[string]bool `json:"storePref,omitempty"`
	// Store is the list an earlier version kept of providers to save. It is still
	// read, as a preference, until the administrator chooses one explicitly.
	Store []string `json:"store,omitempty"`
	// Ack lists notices the administrator has dismissed ("recommended").
	Ack []string `json:"ack,omitempty"`
	// MinConfidence is the lowest recording match accepted automatically.
	MinConfidence float64 `json:"minConfidence"`
}

// Where an effective save preference comes from.
const (
	// PrefDefault is the provider's default.
	PrefDefault = "default"
	// PrefChosen is an explicit choice of the administrator.
	PrefChosen = "chosen"
	// PrefLegacy is the list an earlier version kept, still honoured.
	PrefLegacy = "legacy"
)

// savePreference returns whether the administrator wants a provider's lyrics
// saved automatically, and where that comes from. An explicit choice wins, then
// the earlier list, then the provider's default.
func (s Settings) savePreference(id string, r providerRights) (bool, string) {
	if v, ok := s.StorePref[id]; ok {
		return v, PrefChosen
	}
	if slices.Contains(s.Store, id) {
		return true, PrefLegacy
	}
	return r.DefaultSave, PrefDefault
}

// AckRecommended is the notice about settings that differ from the recommended
// ones.
const AckRecommended = "recommended"

// DefaultSettings returns the recommended defaults.
func DefaultSettings() Settings {
	return Settings{
		PreferLocal:       true,
		AutoRetrieve:      true,
		AutoUpgrade:       true,
		AutoPersist:       true,
		AutoReplaceManual: false,
		Providers:         []string{lrclibID},
		MinConfidence:     ConfidenceAuto,
	}
}

// Sanitize clamps values to safe bounds. Automatic selection can never be made
// more lenient than the verified threshold.
func (s Settings) Sanitize(known []string) Settings {
	if s.MinConfidence < ConfidenceAuto {
		s.MinConfidence = ConfidenceAuto
	}
	if s.MinConfidence > 1 {
		s.MinConfidence = 1
	}
	var providers []string
	for _, id := range s.Providers {
		if slices.Contains(known, id) && !slices.Contains(providers, id) {
			providers = append(providers, id)
		}
	}
	s.Providers = providers
	var store []string
	for _, id := range s.Store {
		if slices.Contains(known, id) && !slices.Contains(store, id) {
			store = append(store, id)
		}
	}
	s.Store = store
	if len(s.StorePref) > 0 {
		pref := map[string]bool{}
		for id, v := range s.StorePref {
			if slices.Contains(known, id) {
				pref[id] = v
			}
		}
		s.StorePref = pref
	}
	var ack []string
	for _, id := range s.Ack {
		if id == AckRecommended && !slices.Contains(ack, id) {
			ack = append(ack, id)
		}
	}
	s.Ack = ack
	return s
}

// SongState is what is remembered for one track beyond its lyrics files.
type SongState struct {
	Locked    bool  `json:"locked,omitempty"`
	OffsetMs  int64 `json:"offsetMs,omitempty"`
	CheckedAt int64 `json:"checkedAt,omitempty"`
	// Shown is true when a better result was found that may only be shown, so a
	// restart (which empties what is shown) does not hide it behind the last check.
	Shown bool `json:"shown,omitempty"`
}

func (s SongState) zero() bool { return s == SongState{} }

// propertyStore keeps settings, per-track state and "not found" markers in the
// database property table.
type propertyStore struct {
	ds model.DataStore
}

func (p propertyStore) settings(ctx context.Context, known []string) Settings {
	raw, err := p.ds.Property().Get(ctx, settingsKey)
	if err != nil || raw == "" {
		return DefaultSettings().Sanitize(known)
	}
	s := DefaultSettings()
	if json.Unmarshal([]byte(raw), &s) != nil {
		return DefaultSettings().Sanitize(known)
	}
	return s.Sanitize(known)
}

func (p propertyStore) putSettings(ctx context.Context, s Settings) error {
	raw, err := json.Marshal(s)
	if err != nil {
		return err
	}
	return p.ds.Property().Put(ctx, settingsKey, string(raw))
}

func (p propertyStore) state(ctx context.Context, id string) SongState {
	var st SongState
	raw, err := p.ds.Property().Get(ctx, stateKeyFmt+id)
	if err == nil && raw != "" {
		_ = json.Unmarshal([]byte(raw), &st)
	}
	return st
}

func (p propertyStore) putState(ctx context.Context, id string, st SongState) error {
	if st.zero() {
		err := p.ds.Property().Delete(ctx, stateKeyFmt+id)
		if errors.Is(err, model.ErrNotFound) {
			return nil
		}
		return err
	}
	raw, err := json.Marshal(st)
	if err != nil {
		return err
	}
	return p.ds.Property().Put(ctx, stateKeyFmt+id, string(raw))
}

// recentMiss reports whether providers recently found nothing for the track, so
// they are not asked again for every play.
func (p propertyStore) recentMiss(ctx context.Context, id string, now time.Time) bool {
	raw, err := p.ds.Property().Get(ctx, missKeyFmt+id)
	if err != nil {
		return false
	}
	at, err := strconv.ParseInt(raw, 10, 64)
	return err == nil && now.Sub(time.Unix(at, 0)) < missTTL
}

func (p propertyStore) recordMiss(ctx context.Context, id string, now time.Time) {
	_ = p.ds.Property().Put(ctx, missKeyFmt+id, strconv.FormatInt(now.Unix(), 10))
}

func (p propertyStore) clearMiss(ctx context.Context, id string) {
	_ = p.ds.Property().Delete(ctx, missKeyFmt+id)
}
