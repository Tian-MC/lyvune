# Lyrics coverage corpus

`corpus.json` lists 50 real recordings (English, Japanese, Chinese, Korean, Italian, Spanish, French, German, Portuguese, metal) with the title, artist, album and length a tagged library would have. The metadata was taken from Deezer's public catalogue search on 2026-10-27, not from any lyrics service, so the lyrics providers are measured on tags they did not write. It holds metadata only: no lyrics, no audio.

Some entries are not what was searched for, and are kept because a library has such tracks too: a live version, a cover by another artist, a title written in Latin letters for a Japanese song.

`coverage_live_test.go` uses it (opt-in, it needs the network):

```sh
go test -tags 'live sqlite_fts5' -run TestLiveCoverage -timeout 60m -count=1 -v ./core/lyrics/
LYVUNE_COVERAGE_REPORT=/tmp/report.json …   # the answer of every provider for every track, as JSON
```

The services change their answers from one run to the next (KuGou's search comes back empty at random; LRCLIB answers 503 at times), so a single run is a sample, not an exact figure.
