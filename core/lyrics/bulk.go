package lyrics

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"sync"
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

// When a provider asks a job to slow down, no new track starts until the wait
// it asked for is over, and the track it refused goes back in the queue: a
// rate limit costs time, never a track. Limits in a row wait longer and longer,
// from bulkBackoffBase up to bulkMaxWait; after bulkMaxLimits limits in a row,
// the provider is not merely busy and the job stops, keeping what it did. A
// track refused bulkTrackAttempts times is counted as failed.
var (
	bulkBackoffBase = 5 * time.Second
	bulkMaxWait     = 10 * time.Minute
)

const (
	bulkMaxLimits     = 8
	bulkTrackAttempts = 4
)

type bulkCtxKey struct{}

// bulkPace is the waiting of a job after providers asked it to slow down.
type bulkPace struct {
	mu      sync.Mutex
	until   time.Time
	who     string
	inARow  int
	stopped string
}

// limited records a refusal and returns how long new tracks wait.
func (p *bulkPace) limited(who []string, retryAfter time.Duration, now time.Time) (time.Time, string, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.inARow++
	name := strings.Join(who, ", ")
	if p.inARow > bulkMaxLimits {
		if p.stopped == "" {
			p.stopped = name
		}
		return p.until, p.who, true
	}
	wait := min(max(retryAfter, bulkBackoffBase<<(p.inARow-1)), bulkMaxWait)
	if until := now.Add(wait); until.After(p.until) {
		p.until, p.who = until, name
	}
	return p.until, p.who, false
}

// answered notes a track that no provider refused: the next limit starts the
// backoff again.
func (p *bulkPace) answered() {
	p.mu.Lock()
	p.inARow = 0
	p.mu.Unlock()
}

func (p *bulkPace) state() (time.Time, string, string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.until, p.who, p.stopped
}

func (l *lyricsService) runBulk(ctx context.Context, job *bulkJob, action string, files model.MediaFiles) {
	defer job.cancel()
	ctx = context.WithValue(ctx, bulkCtxKey{}, true)
	r := &bulkRunner{
		l: l, job: job, action: action, files: files,
		opts:     ResolveOptions{Explicit: true, Recheck: action != BulkMissing, ReplaceManual: action == BulkReplaceManual, NoDisplay: true},
		queue:    make([]int, len(files)),
		attempts: make([]int, len(files)),
	}
	r.changed = sync.NewCond(&r.mu)
	for i := range r.queue {
		r.queue[i] = i
	}
	stopWake := context.AfterFunc(ctx, func() {
		r.mu.Lock()
		r.changed.Broadcast()
		r.mu.Unlock()
	})
	defer stopWake()

	var wg sync.WaitGroup
	for range min(bulkWorkers, len(files)) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r.work(ctx)
		}()
	}
	wg.Wait()

	_, _, stopped := r.pace.state()
	state, msg := "done", ""
	switch {
	case ctx.Err() != nil:
		state, msg = "cancelled", "Cancelled"
	case stopped != "":
		msg = fmt.Sprintf("Stopped: %s kept asking to slow down. Run it again later; finished tracks are skipped.", stopped)
	}
	job.update(func(s *BulkStatus) {
		s.State, s.Message, s.Finished = state, msg, l.now().UTC()
		s.WaitingFor, s.ResumeAt = "", nil
	})
}

// bulkRunner is one run of a bulk job: a queue of tracks the workers take
// from, and put back the tracks a provider refused.
type bulkRunner struct {
	l      *lyricsService
	job    *bulkJob
	action string
	opts   ResolveOptions
	files  model.MediaFiles
	pace   bulkPace

	mu       sync.Mutex
	changed  *sync.Cond
	queue    []int
	attempts []int
	running  int
}

func (r *bulkRunner) work(ctx context.Context) {
	for {
		i, ok := r.take(ctx)
		if !ok {
			return
		}
		if !r.waitTurn(ctx) {
			r.finish(-1)
			return
		}
		if r.process(ctx, i) {
			r.finish(i)
		} else {
			r.finish(-1)
		}
	}
}

// take returns the next track, waiting while others are still running and may
// put theirs back; false when there is nothing left to do.
func (r *bulkRunner) take(ctx context.Context) (int, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for len(r.queue) == 0 && r.running > 0 && ctx.Err() == nil {
		r.changed.Wait()
	}
	if len(r.queue) == 0 || ctx.Err() != nil {
		return 0, false
	}
	i := r.queue[0]
	r.queue = r.queue[1:]
	r.running++
	return i, true
}

// finish ends the work on a track, putting it back at the end of the queue
// when requeue is its index (-1 otherwise).
func (r *bulkRunner) finish(requeue int) {
	r.mu.Lock()
	r.running--
	if requeue >= 0 {
		r.queue = append(r.queue, requeue)
	}
	r.changed.Broadcast()
	r.mu.Unlock()
}

// waitTurn holds a worker while the job waits for a provider. False when the
// job is stopping.
func (r *bulkRunner) waitTurn(ctx context.Context) bool {
	for {
		until, _, stopped := r.pace.state()
		if stopped != "" || ctx.Err() != nil {
			return false
		}
		d := time.Until(until)
		if d <= 0 {
			r.job.update(func(s *BulkStatus) { s.WaitingFor, s.ResumeAt = "", nil })
			return true
		}
		if sleep(ctx, d) != nil {
			return false
		}
	}
}

// process handles one track. It returns true when a provider refused it and it
// is to be tried again.
func (r *bulkRunner) process(ctx context.Context, i int) bool {
	mf := &r.files[i]
	cur, err := r.l.resolveCurrent(ctx, []*model.MediaFile{mf})
	hasLyrics := err == nil && cur.list != nil
	// "missing" fills gaps only; the upgrade actions look at what exists
	if (r.action == BulkMissing && hasLyrics) || ((r.action == BulkUpgrade || r.action == BulkReplaceManual) && !hasLyrics) {
		r.job.update(func(s *BulkStatus) { s.Done++; s.Kept++ })
		return false
	}
	res, err := r.l.resolve(ctx, mf, r.opts)
	if err != nil {
		log.Warn(ctx, "Bulk lyrics failed for a track", "id", mf.ID, err)
		r.job.update(func(s *BulkStatus) { s.Done++; s.Failed++ })
		return false
	}
	if res.RetryAfter > 0 && res.Result == ResolveUnavailable && ctx.Err() == nil {
		return r.refused(ctx, i, res)
	}
	r.pace.answered()
	r.job.update(func(s *BulkStatus) {
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
	return false
}

// refused handles a track a provider asked to slow down for. Nothing was saved
// or remembered for it: it is simply not done yet.
func (r *bulkRunner) refused(ctx context.Context, i int, res ResolveResult) bool {
	until, who, stop := r.pace.limited(res.LimitedBy, time.Duration(res.RetryAfter)*time.Second, time.Now())
	r.attempts[i]++
	again := !stop && r.attempts[i] < bulkTrackAttempts
	r.job.update(func(s *BulkStatus) {
		s.RateLimited++
		switch {
		case again:
			s.Retried++
			s.WaitingFor = who
			t := until.UTC()
			s.ResumeAt = &t
		case !stop:
			s.Done++
			s.Failed++
		}
	})
	log.Info(ctx, "Bulk lyrics: a provider asked to slow down", "provider", who, "until", until,
		"track", r.files[i].ID, "attempt", r.attempts[i], "retrying", again)
	return again
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
