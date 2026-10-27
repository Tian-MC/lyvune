package lyrics

import (
	"context"
	"testing"
	"time"
)

// A provider that refused is asked more slowly afterwards, then back at its
// usual pace as requests go through again.
func TestPacerSlowsDownAfterARefusalAndRecovers(t *testing.T) {
	p := newPacer("p", 100*time.Millisecond)
	for _, want := range []time.Duration{200, 400, 800, 800} {
		p.coolDown(0)
		if p.interval != want*time.Millisecond {
			t.Fatalf("after a refusal the spacing is %s, want %s", p.interval, want*time.Millisecond)
		}
	}
	p.next = time.Time{}
	ctx := context.Background()
	for range 30 {
		p.next = time.Time{} // no real waiting in the test
		if err := p.wait(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if p.interval != 100*time.Millisecond {
		t.Fatalf("the spacing came back to %s, want the usual 100ms", p.interval)
	}
}

func TestPacerFailsFastDuringACoolDown(t *testing.T) {
	p := newPacer("p", 0)
	p.coolDown(time.Hour)
	err := p.wait(context.Background())
	rl, ok := err.(*RateLimitedError)
	if !ok || rl.Provider != "p" || rl.RetryAfter <= 59*time.Minute {
		t.Fatalf("got %v", err)
	}
}
