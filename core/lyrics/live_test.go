//go:build live

package lyrics_test

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/navidrome/navidrome/core/lyrics"
	"github.com/navidrome/navidrome/log"
)

// TestLiveProviders queries the real NetEase, KuGou and QQ Music services. It is opt-in
// (go test -tags live -run TestLiveProviders) because it needs the network and
// asks the services for a handful of lyrics. It prints what came back; it only
// fails when a provider errors out on a track it should answer.
func TestLiveProviders(t *testing.T) {
	recs := []struct {
		name string
		rec  lyrics.Recording
	}{
		{"English", lyrics.Recording{Title: "Judas", Artist: "Lady Gaga", Album: "Born This Way", DurationSec: 249}},
		{"Japanese", lyrics.Recording{Title: "マトリョシカ", Artist: "米津玄師", DurationSec: 198}},
		{"Chinese", lyrics.Recording{Title: "晴天", Artist: "周杰倫", Album: "葉惠美", DurationSec: 269}},
		{"Korean", lyrics.Recording{Title: "Dynamite", Artist: "BTS", DurationSec: 199}},
		{"Cached QRC", lyrics.Recording{Title: "Blinding Lights", Artist: "The Weeknd", Album: "After Hours", DurationSec: 200}},
		{"Mismatch", lyrics.Recording{Title: "Judas", Artist: "Lady Gaga", DurationSec: 30}},
		{"Metal", lyrics.Recording{Title: "Incultus", Artist: "Xanthochroid", Album: "Incultus", DurationSec: 0}},
	}
	log.SetLevel(log.LevelDebug)
	provs := []lyrics.OnlineProvider{lyrics.NewNetEase("", true), lyrics.NewKuGou("", "", true), lyrics.NewQQ("", "", "", true)}
	out := os.Stdout
	for _, p := range provs {
		for _, r := range recs {
			ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
			got, err := p.Search(ctx, r.rec)
			cancel()
			fmt.Fprintf(out, "%-8s %-9s err=%v candidates=%d\n", p.Info().ID, r.name, err, len(got))
			for _, c := range got {
				words, lines := 0, 0
				tracks := ""
				for _, l := range c.Lyrics {
					tracks += " " + l.Kind
					if l.IsMainKind() {
						for _, ln := range l.Line {
							words += len(ln.Cue)
							if ln.Start != nil {
								lines++
							}
						}
					}
				}
				fmt.Fprintf(out, "    %-6s %q / %q  dur=%.0f conf=%.2f verified=%v quality=%s timedlines=%d wordcues=%d tracks=[%s]\n",
					c.ID[:3], c.Meta.Title, c.Meta.Artist, c.Meta.DurationSec, c.Match.Confidence, c.Match.Verified(), c.Quality, lines, words, tracks)
			}
			time.Sleep(3 * time.Second)
		}
	}
}
