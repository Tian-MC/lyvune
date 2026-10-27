//go:build live

package lyrics_test

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Tian-MC/lyvune/core/lyrics"
)

// TestLiveCoverage measures how often the keyless providers find lyrics, and
// word-timed lyrics, for a corpus of real recordings (testdata/coverage, with
// the title, artist, album and length a tagged library would have; taken from
// Deezer's public catalogue, not from any lyrics service). It is opt-in:
//
//	go test -tags live -run TestLiveCoverage -timeout 60m ./core/lyrics/
//
// LYVUNE_COVERAGE_CORPUS picks another corpus and LYVUNE_COVERAGE_REPORT writes
// the full answer per track and provider as JSON. Providers are asked one
// track at a time, with a pause between tracks, through their usual pacing.
// It never fails on a miss: it reports.
func TestLiveCoverage(t *testing.T) {
	path := os.Getenv("LYVUNE_COVERAGE_CORPUS")
	if path == "" {
		path = "testdata/coverage/corpus.json"
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var corpus []struct {
		Lang        string  `json:"lang"`
		Title       string  `json:"title"`
		Artist      string  `json:"artist"`
		Album       string  `json:"album"`
		DurationSec float64 `json:"durationSec"`
	}
	if err := json.Unmarshal(raw, &corpus); err != nil {
		t.Fatal(err)
	}
	provs := []lyrics.OnlineProvider{
		lyrics.NewLRCLIB("", true), lyrics.NewNetEase(""), lyrics.NewKuGou("", ""), lyrics.NewQQ("", "", ""),
	}

	type found struct {
		ID       string   `json:"id"`
		Quality  string   `json:"quality"`
		Score    float64  `json:"score"`
		Delta    float64  `json:"durationDelta"`
		Verified bool     `json:"verified"`
		Mismatch []string `json:"mismatch,omitempty"`
		Title    string   `json:"title"`
		Artist   string   `json:"artist"`
	}
	type answer struct {
		Error string  `json:"error,omitempty"`
		Found []found `json:"found"`
		// Best is the quality of the best verified result ("" for none)
		Best string `json:"best"`
	}
	type row struct {
		Lang, Title, Artist string
		Answers             map[string]answer
		// Chosen is the quality automatic retrieval would take from all providers
		Chosen   string
		Provider string
	}

	var rows []row
	for i, r := range corpus {
		rec := lyrics.Recording{Title: r.Title, Artist: r.Artist, Album: r.Album, DurationSec: r.DurationSec}
		answers := map[string]answer{}
		var all []lyrics.Candidate
		var mu sync.Mutex
		var wg sync.WaitGroup
		for _, p := range provs {
			wg.Add(1)
			go func() {
				defer wg.Done()
				ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
				defer cancel()
				got, err := p.Search(ctx, rec)
				a := answer{Found: []found{}}
				if err != nil {
					a.Error = err.Error()
				}
				best := lyrics.QualityNone
				for _, c := range got {
					a.Found = append(a.Found, found{
						ID: c.ID, Quality: c.Quality.String(), Score: c.Match.Confidence, Delta: c.Match.DurationDelta,
						Verified: c.Match.Verified(), Mismatch: c.Match.Mismatch, Title: c.Meta.Title, Artist: c.Meta.Artist,
					})
					if c.Match.Verified() && c.Quality > best {
						best = c.Quality
					}
				}
				if best != lyrics.QualityNone {
					a.Best = best.String()
				}
				mu.Lock()
				answers[p.Info().ID] = a
				all = append(all, got...)
				mu.Unlock()
			}()
		}
		wg.Wait()
		rw := row{Lang: r.Lang, Title: r.Title, Artist: r.Artist, Answers: answers}
		if c, ok := lyrics.Choose(all, lyrics.Policy{ProviderOrder: []string{"lrclib", "kugou", "qq", "netease"}}); ok {
			rw.Chosen, rw.Provider = c.Quality.String(), c.Provider
		}
		rows = append(rows, rw)
		fmt.Printf("%2d/%d %-6s %-28.28s %-20.20s chosen=%-8s %-8s", i+1, len(corpus), r.Lang, r.Title, r.Artist, rw.Chosen, rw.Provider)
		for _, p := range provs {
			a := answers[p.Info().ID]
			mark := a.Best
			if a.Error != "" {
				mark = "ERR"
			}
			fmt.Printf(" %s=%s", p.Info().ID, mark)
		}
		fmt.Println()
		time.Sleep(2 * time.Second)
	}

	// Totals: any verified lyrics, line timing or better, word timing
	count := func(pick func(row) string) (anyQ, synced, karaoke int) {
		for _, r := range rows {
			switch lyrics.ParseQuality(pick(r)) {
			case lyrics.QualityKaraoke:
				karaoke++
				fallthrough
			case lyrics.QualitySynced:
				synced++
				fallthrough
			case lyrics.QualityPlain:
				anyQ++
			}
		}
		return
	}
	n := len(rows)
	pct := func(v int) string { return fmt.Sprintf("%2d/%d (%3.0f%%)", v, n, 100*float64(v)/float64(n)) }
	fmt.Printf("\n%-10s %-16s %-16s %-16s %s\n", "source", "any", "synced+", "karaoke", "errors")
	for _, p := range provs {
		id := p.Info().ID
		a, s, k := count(func(r row) string { return r.Answers[id].Best })
		errs := 0
		for _, r := range rows {
			if r.Answers[id].Error != "" {
				errs++
			}
		}
		fmt.Printf("%-10s %-16s %-16s %-16s %d\n", id, pct(a), pct(s), pct(k), errs)
	}
	a, s, k := count(func(r row) string { return r.Chosen })
	fmt.Printf("%-10s %-16s %-16s %-16s\n", "chosen", pct(a), pct(s), pct(k))

	// Word-timed results that were found and not usable, and why
	why := map[string]int{}
	for _, r := range rows {
		if r.Chosen == "karaoke" {
			continue
		}
		for id, ans := range r.Answers {
			for _, f := range ans.Found {
				if f.Quality != "karaoke" || f.Verified {
					continue
				}
				reason := "score"
				switch {
				case len(f.Mismatch) > 0:
					reason = strings.Join(f.Mismatch, "+")
				case f.Delta > 5:
					reason = "duration"
				}
				why[id+": "+reason]++
			}
		}
	}
	keys := make([]string, 0, len(why))
	for k := range why {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	fmt.Println("\nword-timed results found but not verified:")
	for _, k := range keys {
		fmt.Printf("  %-40s %d\n", k, why[k])
	}

	if out := os.Getenv("LYVUNE_COVERAGE_REPORT"); out != "" {
		data, _ := json.MarshalIndent(rows, "", " ")
		if err := os.WriteFile(out, data, 0o600); err != nil {
			t.Fatal(err)
		}
	}
}
