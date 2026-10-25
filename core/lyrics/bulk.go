package lyrics

import (
	"context"
	"fmt"
	"slices"
	"sync"
	"sync/atomic"
	"time"

	. "github.com/Masterminds/squirrel"
	"github.com/Tian-MC/lyvune/log"
	"github.com/Tian-MC/lyvune/model"
)

// maxBulkTracks bounds one job.
const maxBulkTracks = 20000

type bulkJob struct {
	mu     sync.Mutex
	status BulkStatus
	cancel context.CancelFunc
}

func (j *bulkJob) snapshot() BulkStatus {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.status
}

func (j *bulkJob) update(f func(*BulkStatus)) {
	j.mu.Lock()
	defer j.mu.Unlock()
	f(&j.status)
}

// StartBulk begins a bulk operation. Only one runs at a time; running a job
// again is safe, because tracks that are already done are skipped, which is also
// how an interrupted job is resumed.
func (l *lyricsService) StartBulk(ctx context.Context, req BulkRequest) (BulkStatus, error) {
	switch req.Action {
	case BulkMissing, BulkUpgrade, BulkRecheck:
	case BulkReplaceManual:
		// This can supersede lyrics the user supplied, so it is never implicit
		if !req.Confirm {
			return BulkStatus{}, ErrConfirmRequired
		}
	default:
		return BulkStatus{}, fmt.Errorf("unknown bulk action %q", req.Action)
	}
	if l.ds == nil {
		return BulkStatus{}, fmt.Errorf("bulk lyrics need the database")
	}

	var filters []Sqlizer
	if len(req.TrackIDs) > 0 {
		filters = append(filters, Eq{"media_file.id": req.TrackIDs})
	}
	if len(req.AlbumIDs) > 0 {
		filters = append(filters, Eq{"media_file.album_id": req.AlbumIDs})
	}
	if len(filters) == 0 && !req.All {
		return BulkStatus{}, fmt.Errorf("choose tracks or albums")
	}
	where := And{Eq{"missing": false}}
	if len(filters) > 0 {
		where = append(where, Or(filters))
	}
	files, err := l.ds.MediaFile().GetAll(ctx, model.QueryOptions{Filters: where, Max: maxBulkTracks})
	if err != nil {
		return BulkStatus{}, err
	}

	l.bulkMu.Lock()
	for _, j := range l.bulkJobs {
		if j.snapshot().State == "running" {
			l.bulkMu.Unlock()
			return BulkStatus{}, ErrBusy
		}
	}
	l.bulkSeq++
	id := fmt.Sprintf("bulk-%d", l.bulkSeq)
	runCtx, cancel := context.WithCancel(context.WithoutCancel(ctx))
	job := &bulkJob{cancel: cancel, status: BulkStatus{
		ID: id, Action: req.Action, State: "running", Total: len(files), Started: l.now().UTC(),
	}}
	l.bulkJobs[id] = job
	// Keep only a few finished jobs
	if len(l.bulkJobs) > 5 {
		var done []string
		for k, j := range l.bulkJobs {
			if j.snapshot().State != "running" {
				done = append(done, k)
			}
		}
		slices.Sort(done)
		for len(l.bulkJobs) > 5 && len(done) > 0 {
			delete(l.bulkJobs, done[0])
			done = done[1:]
		}
	}
	l.bulkMu.Unlock()

	go l.runBulk(runCtx, job, req.Action, files)
	return job.snapshot(), nil
}

// bulkWorkers is how many tracks a job works on at once. Providers still see
// requests no faster than their own pacing allows, so more workers overlap the
// waiting, not the load on a service.
const bulkWorkers = 4

// bulkSearchTimeout replaces the interactive search timeout inside a job: the
// requests of several workers to one provider queue on its pacing, so a search
// can legitimately take longer than a person would wait.
const bulkSearchTimeout = 90 * time.Second

type bulkCtxKey struct{}

func (l *lyricsService) runBulk(ctx context.Context, job *bulkJob, action string, files model.MediaFiles) {
	defer job.cancel()
	ctx = context.WithValue(ctx, bulkCtxKey{}, true)
	opts := ResolveOptions{Explicit: true, Recheck: action != BulkMissing, ReplaceManual: action == BulkReplaceManual, NoDisplay: true}

	var (
		stop    atomic.Bool
		limitMu sync.Mutex
		limited string
	)
	// process handles one track and records its outcome. A provider asking to
	// slow down stops the whole job: tracks already running finish, no new one
	// starts.
	process := func(mf *model.MediaFile) {
		cur, err := l.resolveCurrent(ctx, []*model.MediaFile{mf})
		hasLyrics := err == nil && cur.list != nil
		// "missing" fills gaps only; the upgrade actions look at what exists
		if (action == BulkMissing && hasLyrics) || ((action == BulkUpgrade || action == BulkReplaceManual) && !hasLyrics) {
			job.update(func(s *BulkStatus) { s.Done++; s.Kept++ })
			return
		}
		res, err := l.resolve(ctx, mf, opts)
		if err != nil {
			log.Warn(ctx, "Bulk lyrics failed for a track", "id", mf.ID, err)
			job.update(func(s *BulkStatus) { s.Done++; s.Failed++ })
			return
		}
		job.update(func(s *BulkStatus) {
			s.Done++
			switch res.Result {
			case ResolveFound:
				s.Found++
			case ResolveUpgraded:
				s.Upgraded++
			case ResolveNotFound:
				s.Missing++
			case ResolveNotSaved:
				s.Unsaved++
			case ResolveUnavailable:
				s.Failed++
			default:
				s.Kept++
			}
		})
		if res.RetryAfter > 0 {
			limitMu.Lock()
			if limited == "" {
				limited = fmt.Sprintf("A provider asked to slow down. Run it again in about %s; finished tracks are skipped.",
					(time.Duration(res.RetryAfter) * time.Second).Round(time.Second))
			}
			limitMu.Unlock()
			stop.Store(true)
		}
	}

	next := make(chan int)
	var wg sync.WaitGroup
	for range min(bulkWorkers, len(files)) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range next {
				if ctx.Err() != nil || stop.Load() {
					continue // drain; nothing more is started
				}
				process(&files[i])
			}
		}()
	}
	for i := range files {
		if ctx.Err() != nil || stop.Load() {
			break
		}
		next <- i
	}
	close(next)
	wg.Wait()

	state, msg := "done", limited
	if ctx.Err() != nil {
		state, msg = "cancelled", "Cancelled"
	}
	job.update(func(s *BulkStatus) {
		s.State, s.Message, s.Finished = state, msg, l.now().UTC()
	})
}

// Bulk returns the status of a bulk job.
func (l *lyricsService) Bulk(id string) (BulkStatus, bool) {
	l.bulkMu.Lock()
	defer l.bulkMu.Unlock()
	j, ok := l.bulkJobs[id]
	if !ok {
		return BulkStatus{}, false
	}
	return j.snapshot(), true
}

// CancelBulk stops a running bulk job.
func (l *lyricsService) CancelBulk(id string) bool {
	l.bulkMu.Lock()
	j, ok := l.bulkJobs[id]
	l.bulkMu.Unlock()
	if !ok || j.snapshot().State != "running" {
		return false
	}
	j.cancel()
	return true
}
