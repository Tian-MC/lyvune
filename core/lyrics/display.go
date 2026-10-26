package lyrics

import (
	"sync"
	"time"

	"github.com/Tian-MC/lyvune/model"
)

const (
	// displayTTL bounds how long lyrics that may not be kept stay available for
	// display. They are in memory only: a restart empties the cache.
	displayTTL = 12 * time.Hour
	// displayMax bounds the number of tracks held at once.
	displayMax = 300
)

// displayEntry is a provider's lyrics shown for a track without being saved.
type displayEntry struct {
	list        model.LyricList
	provider    string
	quality     Quality
	match       float64
	attribution string
	// chosen is true when the administrator picked this version, so it outranks
	// lyrics found by the automatic retrieval.
	chosen bool
	at     time.Time
}

// displayCache holds lyrics that may be shown but not kept. It is deliberately
// not persistent: nothing here is offline lyrics, and nothing is written to the
// music library or the database.
type displayCache struct {
	mu    sync.Mutex
	m     map[string]*displayEntry
	order []string
}

func newDisplayCache() *displayCache { return &displayCache{m: map[string]*displayEntry{}} }

func (d *displayCache) get(trackID string, now time.Time) *displayEntry {
	if d == nil {
		return nil
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	e := d.m[trackID]
	if e == nil {
		return nil
	}
	if now.Sub(e.at) > displayTTL {
		d.removeLocked(trackID)
		return nil
	}
	return e
}

func (d *displayCache) put(trackID string, e *displayEntry) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if _, ok := d.m[trackID]; ok {
		d.removeLocked(trackID)
	}
	d.m[trackID] = e
	d.order = append(d.order, trackID)
	for len(d.order) > displayMax {
		delete(d.m, d.order[0])
		d.order = d.order[1:]
	}
}

func (d *displayCache) drop(trackID string) {
	if d == nil {
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	d.removeLocked(trackID)
}

func (d *displayCache) removeLocked(trackID string) {
	delete(d.m, trackID)
	for i, id := range d.order {
		if id == trackID {
			d.order = append(d.order[:i], d.order[i+1:]...)
			break
		}
	}
}
