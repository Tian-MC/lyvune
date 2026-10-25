package lyrics

import (
	"encoding/json"
	"io"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/navidrome/navidrome/log"
)

// A provider's results can be handled in four separate ways, and each needs its
// own permission:
//
//   - retrieval: asking the provider for lyrics;
//   - display: showing them while a track plays, without keeping them;
//   - import: lyrics the user owns, read from the user's own files;
//   - storage: keeping the provider's lyrics permanently next to the audio.
//
// Retrieval and display follow from how a service is reached. Storage does not:
// it needs a right to keep the lyrics, which a working endpoint does not give.
// This file decides storage and display, in one place, from facts and not from
// a switch.

// How a provider's results may be shown when they may not be kept.
const (
	// DisplaySession lets the lyrics be shown while playing, held in memory only
	// and never written to disk.
	DisplaySession = "session"
	// DisplayPreview lets them be read in the lyrics manager and nothing more.
	DisplayPreview = "preview"
)

// providerRights is what is known about keeping and showing one provider's
// lyrics.
type providerRights struct {
	Display string
	// Eligible is true when the lyrics may be kept permanently.
	Eligible bool
	// Verified is true only when the permission rests on a document that was
	// named (see StorageAuthorization), not on an assumption.
	Verified  bool
	Basis     string
	Reference string
}

// builtinRights is the starting point. Only LRCLIB may keep lyrics, and even
// that is an assumption about what the service is for: its terms were not found.
var builtinRights = map[string]providerRights{
	lrclibID: {
		Display: DisplaySession, Eligible: true, Verified: false,
		Basis: "A free community service whose purpose is to let clients find and keep synchronized lyrics. " +
			"Its terms of use could not be found, so this is an assumption about its purpose, not a verified permission.",
	},
	kugouID: {
		Display: DisplaySession,
		Basis:   "Unofficial endpoints; no terms were found that allow keeping its lyrics.",
	},
	neteaseID: {
		Display: DisplaySession,
		Basis:   "Unofficial endpoints; no terms were found that allow keeping its lyrics.",
	},
	qqID: {
		Display: DisplaySession,
		Basis:   "Unofficial endpoints and a community cache; no terms were found that allow keeping its lyrics.",
	},
	musixmatchID: {
		Display: DisplayPreview,
		Basis:   "Keeping or showing lyrics beyond the preview depends on your agreement with Musixmatch, which was not verified.",
	},
	"apple": {Display: DisplayPreview, Basis: "No lyrics are retrieved from this service."},
}

// StorageAuthorization is a record that a provider's lyrics may be kept. It is
// not a switch: it has to name the document or agreement it rests on. Records
// are read from rightsFileName in the data folder, so an authorization obtained
// later can be put to use without changing the code.
//
//	{"authorizations":[{"provider":"kugou","basis":"Licence agreement of 2026-11-02","reference":"contract no. 4711"}]}
//
// The file cannot prove that the document exists. It exists so the claim is
// written down, shown in the interface and open to being checked.
type StorageAuthorization struct {
	Provider  string `json:"provider"`
	Basis     string `json:"basis"`
	Reference string `json:"reference"`
}

const (
	rightsFileName      = "lyrics-storage-rights.json"
	maxRightsFileBytes  = 64 << 10
	maxRightsFieldBytes = 500
	rightsRefresh       = 5 * time.Second
)

// rightsTable answers, per provider, what may be done with its lyrics.
type rightsTable struct {
	path string

	mu       sync.Mutex
	checked  time.Time
	modTime  time.Time
	size     int64
	override map[string]providerRights
}

func newRightsTable(path string) *rightsTable { return &rightsTable{path: path} }

// get returns the rights of a provider known to the table. ok is false for a
// provider it does not know (a plugin, a test double), which then speaks for
// itself.
func (t *rightsTable) get(id string, now time.Time) (providerRights, bool) {
	base, ok := builtinRights[id]
	if !ok {
		return providerRights{}, false
	}
	if t != nil {
		if ov, has := t.authorization(id, now); has {
			return ov, true
		}
	}
	return base, true
}

func (t *rightsTable) authorization(id string, now time.Time) (providerRights, bool) {
	if t.path == "" {
		return providerRights{}, false
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if now.Sub(t.checked) >= rightsRefresh {
		t.checked = now
		t.reload()
	}
	r, ok := t.override[id]
	return r, ok
}

// reload re-reads the file when it changed. A broken file grants nothing.
func (t *rightsTable) reload() {
	info, err := os.Stat(t.path)
	if err != nil {
		t.override, t.modTime, t.size = nil, time.Time{}, 0
		return
	}
	if info.ModTime().Equal(t.modTime) && info.Size() == t.size && t.override != nil {
		return
	}
	t.modTime, t.size = info.ModTime(), info.Size()
	t.override = parseAuthorizations(t.path)
	if t.override == nil {
		t.override = map[string]providerRights{}
	}
}

func parseAuthorizations(path string) map[string]providerRights {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, maxRightsFileBytes+1))
	if err != nil || len(data) > maxRightsFileBytes {
		log.Warn("Lyrics storage rights file is unreadable or too large; it grants nothing", "path", path)
		return nil
	}
	var doc struct {
		Authorizations []StorageAuthorization `json:"authorizations"`
	}
	if err := json.Unmarshal(data, &doc); err != nil {
		log.Warn("Lyrics storage rights file is not valid; it grants nothing", "path", path, err)
		return nil
	}
	out := map[string]providerRights{}
	for _, a := range doc.Authorizations {
		base, known := builtinRights[a.Provider]
		basis, ref := strings.TrimSpace(a.Basis), strings.TrimSpace(a.Reference)
		switch {
		case !known:
			log.Warn("Lyrics storage authorization names an unknown provider; ignored", "provider", a.Provider)
		case a.Provider == "apple":
			log.Warn("Lyrics storage authorization for a provider without lyrics; ignored", "provider", a.Provider)
		case basis == "" || ref == "" || len(basis) > maxRightsFieldBytes || len(ref) > maxRightsFieldBytes:
			log.Warn("Lyrics storage authorization needs a basis and a reference of reasonable length; ignored", "provider", a.Provider)
		default:
			out[a.Provider] = providerRights{Display: base.Display, Eligible: true, Verified: true, Basis: basis, Reference: ref}
		}
	}
	return out
}
