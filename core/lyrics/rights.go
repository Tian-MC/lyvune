package lyrics

import (
	"encoding/json"
	"io"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/Tian-MC/lyvune/log"
)

// A provider's results can be handled in four separate ways:
//
//   - retrieval: asking the provider for lyrics;
//   - display: showing them while a track plays, without keeping them;
//   - import: lyrics the user owns, read from the user's own files;
//   - storage: keeping the provider's lyrics permanently next to the audio.
//
// Three things must not be mixed up when it comes to storage:
//
//   - the RIGHTS: what is known about the provider's terms. That is a status,
//     not a permission: "granted" (a written authorization is recorded),
//     "unclear" (no terms were found or they could not be read: the honest
//     default) or "restricted" (the terms, as recorded, do not allow it);
//   - the PREFERENCE: whether the administrator wants a provider's lyrics saved
//     automatically. A preference is a wish and never proof of a right;
//   - the OUTCOME of each save, which is only reported once it was verified.
//
// Storage is refused only for "restricted". For the others it follows the
// preference, and the interface says plainly that the rights are unclear.

// How a provider's results may be shown when they may not be kept.
const (
	// DisplaySession lets the lyrics be shown while playing, held in memory only
	// and never written to disk.
	DisplaySession = "session"
	// DisplayPreview lets them be read in the lyrics manager and nothing more.
	DisplayPreview = "preview"
)

// What is known about a provider's terms on keeping its lyrics.
const (
	// RightsGranted means a written authorization is recorded (see
	// StorageAuthorization). It is a claim written down, not proof.
	RightsGranted = "granted"
	// RightsUnclear means no terms were found, or they could not be read.
	RightsUnclear = "unclear"
	// RightsRestricted means the terms, as recorded, do not allow keeping the
	// lyrics. Nothing is saved, whatever the preference.
	RightsRestricted = "restricted"
)

// providerRights is what is known about keeping and showing one provider's
// lyrics.
type providerRights struct {
	Display string
	// Status is RightsGranted, RightsUnclear or RightsRestricted.
	Status string
	// DefaultSave is the preference when the administrator has not chosen one.
	DefaultSave bool
	Basis       string
	Reference   string
}

// allowed is false only when the terms, as recorded, forbid keeping the lyrics.
func (r providerRights) allowed() bool { return r.Status != RightsRestricted }

// verified is true only when the status rests on a recorded document.
func (r providerRights) verified() bool { return r.Status != RightsUnclear && r.Reference != "" }

// builtinRights is the starting point. No provider's terms could be read, so
// every status is "unclear". LRCLIB is saved by default, as it always was; the
// others only when the administrator asks for it.
var builtinRights = map[string]providerRights{
	lrclibID: {
		Display: DisplaySession, Status: RightsUnclear, DefaultSave: true,
		Basis: "A free community service whose purpose is to let clients find and keep synchronized lyrics. " +
			"Its terms of use could not be found, so keeping its lyrics rests on that assumption.",
	},
	kugouID: {
		Display: DisplaySession, Status: RightsUnclear,
		Basis: "Unofficial endpoints. No terms were found, so it is not known whether keeping its lyrics is allowed.",
	},
	neteaseID: {
		Display: DisplaySession, Status: RightsUnclear,
		Basis: "Unofficial endpoints. No terms were found, so it is not known whether keeping its lyrics is allowed.",
	},
	qqID: {
		Display: DisplaySession, Status: RightsUnclear,
		Basis: "Unofficial endpoints and a community cache. No terms were found, so it is not known whether keeping its lyrics is allowed.",
	},
	musixmatchID: {
		Display: DisplayPreview, Status: RightsUnclear,
		Basis: "An official API used with your own key. Its terms could not be read here; keeping lyrics depends on your plan and agreement with Musixmatch.",
	},
	appleID: {
		Display: DisplaySession, Status: RightsUnclear,
		Basis: "Apple's lyrics through a third-party catalogue (lrc.red). Neither Apple nor the catalogue publishes terms for this use, so it is not known whether keeping the lyrics is allowed.",
	},
}

// StorageAuthorization documents what is known about a provider's terms. It is
// not a switch: it has to name the document or agreement it rests on. Records
// are read from rightsFileName in the data folder, so an authorization obtained
// later, or a restriction found in the terms, can be recorded without changing
// the code.
//
//	{"authorizations":[
//	  {"provider":"kugou","basis":"Licence agreement of 2026-11-02","reference":"contract no. 4711"},
//	  {"provider":"musixmatch","status":"restricted","basis":"API terms, section on caching","reference":"https://example.org/terms"}]}
//
// Status is "granted" (the default) or "restricted". The file cannot prove that
// the document exists or says what is claimed: it writes the claim down, shows
// it in the interface and keeps it open to being checked. An administrator's
// preference to save lyrics is a separate setting and is never treated as proof.
type StorageAuthorization struct {
	Provider  string `json:"provider"`
	Status    string `json:"status,omitempty"`
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
		case basis == "" || ref == "" || len(basis) > maxRightsFieldBytes || len(ref) > maxRightsFieldBytes:
			log.Warn("Lyrics storage authorization needs a basis and a reference of reasonable length; ignored", "provider", a.Provider)
		default:
			status := RightsGranted
			switch a.Status {
			case "", RightsGranted:
			case RightsRestricted:
				status = RightsRestricted
			default:
				log.Warn("Lyrics storage authorization has an unknown status; ignored", "provider", a.Provider, "status", a.Status)
				continue
			}
			out[a.Provider] = providerRights{
				Display: base.Display, Status: status, DefaultSave: base.DefaultSave || status == RightsGranted,
				Basis: basis, Reference: ref,
			}
		}
	}
	return out
}
