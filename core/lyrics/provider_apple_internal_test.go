package lyrics

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

const appleTestTTML = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:lrc="http://lrc.red/lyric-ttml-internal" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" lrc:timing="Word" xml:lang="en"><body dur="0:05.000"><div begin="1.000" end="4.000"><p begin="1.000" end="3.000" ttm:agent="v1"><span begin="1.000" end="1.500">Hello</span> <span begin="1.500" end="3.000">world</span></p></div></body></tt>`

func appleServer(t *testing.T, search http.HandlerFunc) *apple {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1", search)
	mux.HandleFunc("/s/ok.ttml", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(appleTestTTML)) })
	srv := httptest.NewTLSServer(mux)
	t.Cleanup(srv.Close)
	p := NewAppleMusic(srv.URL + "/api/v1").(*apple)
	p.http.client = srv.Client()
	p.http.pacer.interval, p.http.pacer.base = 0, 0
	return p
}

func TestAppleReturnsWordTimedKaraoke(t *testing.T) {
	var p *apple
	p = appleServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("track") != "Song" || r.URL.Query().Get("artist") != "Band" || r.URL.Query().Get("duration") != "200" {
			t.Errorf("unexpected query %s", r.URL.RawQuery)
		}
		base := p.baseURL[:len(p.baseURL)-len("/api/v1")]
		_, _ = fmt.Fprintf(w, `{"results":[
			{"id":"line","track_name":"Song","artist_name":"Band","duration":200,"timing_type":"line","lyricsUrl":%q},
			{"id":"word","track_name":"Song","artist_name":"Band","duration":200,"timing_type":"word","lyricsUrl":%q},
			{"id":"plain","track_name":"Song","artist_name":"Band","duration":200,"timing_type":"word","lyricsUrl":"http://insecure/x.ttml"}]}`,
			base+"/s/ok.ttml", base+"/s/ok.ttml")
	})
	got, err := p.Search(context.Background(), Recording{Title: "Song", Artist: "Band", DurationSec: 200})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2 candidates (the non-https one is skipped), got %d", len(got))
	}
	if got[0].ID != "apple:word" {
		t.Errorf("word-timed result must come first, got %s", got[0].ID)
	}
	if got[0].Quality != QualityKaraoke {
		t.Errorf("want karaoke quality, got %s", got[0].Quality)
	}
}

func TestAppleNotFoundAndThrottling(t *testing.T) {
	p := appleServer(t, func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNotFound) })
	got, err := p.Search(context.Background(), Recording{Title: "Song", Artist: "Band"})
	if err != nil || len(got) != 0 {
		t.Fatalf("404 must be an empty answer, got %v, %v", got, err)
	}

	p = appleServer(t, func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTooManyRequests) })
	_, err = p.Search(context.Background(), Recording{Title: "Song", Artist: "Band"})
	var rl *RateLimitedError
	if !errors.As(err, &rl) {
		t.Fatalf("want a RateLimitedError, got %v", err)
	}
}
