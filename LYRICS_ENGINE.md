# Lyrics engine

How Navidrome Reimagined finds, ranks, stores and lets you override lyrics.

Three rules drive everything:

1. **Local files first.** Lyrics you have on disk win by default.
2. **Karaoke > synced > plain**, among results that really match the track.
3. **You can always override.** Every source can be superseded by a deliberate choice, and every replacement can be undone.

Audio files are never modified. Timestamps are never invented: karaoke means the source really carried word timing.

## Architecture

| Part | Where |
| --- | --- |
| Parsers (LRC, Enhanced LRC, TTML, SRT, Lyricsfile YAML, plain text) | `model/lyrics_*.go` (already in Navidrome) |
| Source order for local files, plugins | `core/lyrics/lyrics.go` (`lyricspriority`) |
| Quality and source model | `core/lyrics/candidate.go` |
| Recording match | `core/lyrics/match.go` |
| Choosing among candidates | `core/lyrics/rank.go` |
| `.lyrics.json` format | `core/lyrics/envelope.go` |
| Safe writes, history, restore | `core/lyrics/store.go` |
| What is shown for a track | `core/lyrics/resolve.go` |
| Search, apply, import, retrieve, upgrade, lock, offset | `core/lyrics/engine.go` |
| Bulk jobs | `core/lyrics/bulk.go` |
| Providers | `core/lyrics/provider*.go` |
| HTTP API | `server/nativeapi/lyrics.go` (`/api/lyrics`) |
| Interface | `ui/src/lyrics/`, `ui/src/personal/LyricsSettings.jsx` |

The existing OpenSubsonic endpoints (`getLyricsBySongId`, `getLyrics`) and the Jellyfin lyrics endpoint are unchanged: they ask the same service, which now also knows about `.lyrics.json`.

## What is shown for a track

In this order, the first that exists wins (with "prefer local files" on, the default):

1. **Lyrics you chose or imported** (a `.lyrics.json` with `origin: "user"`).
2. **Local files**, in the existing `lyricspriority` order: sidecars (`.ttml`, `.yaml`, `.yml`, `.elrc`, `.lrc`, `.srt`, `.txt`), embedded tags, and lyrics plugins.
3. **Downloaded lyrics** (a `.lyrics.json` with `origin: "managed"`).

Quality decides between sources only if you turn "prefer local files" off; local wins ties.

Do not add `.lyrics.json` to `lyricspriority`: it is handled separately (an entry is ignored).

## Override modes

| Mode | How it works here |
| --- | --- |
| **A. Preserve existing** (default) | Nothing replaces your sidecar or embedded lyrics on its own. Providers are only asked when you search by hand. |
| **B. Upgrade automatically** | Downloaded lyrics are replaced by better ones (plain → synced, synced → karaoke), never the other way, and only with a verified match. Sidecar and embedded lyrics are superseded only if you also turn on "Also upgrade lyrics I added myself". Lyrics you chose are never replaced automatically. |
| **C. Force override** | "Use this version" in the manager. It asks you to confirm when it supersedes a sidecar, embedded or previously chosen lyrics, and says what happens to the original. Lower quality is allowed: this is your decision. |
| **D. Lock** | A locked track is never changed by an upgrade or a bulk job. Replacing it by hand needs "Replace anyway". The lock survives the replacement. |

Choosing lyrics over a sidecar or embedded lyrics **does not touch the original**: a preferred `.lyrics.json` is written beside it and takes precedence. Deleting that file brings the original back.

## Files next to the audio

Navidrome only creates, replaces or deletes **`.lyrics.json` files that carry its own envelope**. It never writes `.lrc`, never edits tags and never touches audio, artwork or timestamps.

Name: `01 - Song.lyrics.json`. If another **audio** file shares the base name (`01 - Song.flac` and `01 - Song.mp3`), the audio extension is kept: `01 - Song.flac.lyrics.json`. Other files with the same base name, such as `01 - Song.lrc` or a cover, do not count.

Writes are atomic (temporary file in the same folder, flushed, renamed), verified by reading the file back, and serialised per file. A `.lyrics.json` that is not a Navidrome envelope is ignored and never overwritten.

### Schema (version 1)

```json
{
  "format": "navidrome-lyrics",
  "version": 1,
  "origin": "managed",
  "locked": false,
  "offsetMs": 0,
  "provider": "lrclib",
  "providerId": "4020565",
  "quality": "synced",
  "confidence": 1,
  "retrievedAt": "2026-10-25T00:11:24Z",
  "attribution": "Lyrics from LRCLIB (lrclib.net)",
  "recording": { "title": "…", "artist": "…", "album": "…", "duration": 199 },
  "lyrics": [ /* OpenSubsonic structured lyrics: kind, lang, synced, line[{start,value,cue[]}], offset */ ]
}
```

- `origin`: `managed` (downloaded automatically) or `user` (chosen or imported).
- `lyrics` uses the same structure as the OpenSubsonic `structuredLyrics`, so word timing (`cue` with `start`, `end`, byte offsets), translations (`kind: "translation"`) and pronunciations (`kind: "pronunciation"`) survive unchanged.
- `offsetMs` is added on top of any offset in the lyrics; **positive shows lyrics sooner**. Timestamps in the file are never rewritten.
- Readers reject newer versions, other formats, files over 4 MB, more than 5000 lines, lines over 4096 bytes, more than 512 cues in a line, negative timestamps and cues that end before they start.

Lock and offset live in the sidecar when there is one. For a track whose current lyrics are a sidecar or embedded, they are kept in the database instead (the server's `property` table).

## History and undo

Before any change to a Navidrome sidecar, the previous content is saved under `<data folder>/lyrics-history/<track key>/`, outside the library. The last 10 versions are kept per track (`Lyrics.HistoryKeep`). The very first save is recorded as "no file", so even that can be undone. Restoring is itself undoable. Changing the lock or the offset does not add history, so adjusting the timing never pushes real versions out.

## Matching the recording

Each result is scored 0–1 against the track:

| Signal | Weight |
| --- | --- |
| Title (clean title, without featured artists and remaster notes) | 40% |
| Artist (any credited artist matches) | 30% |
| Duration (≤2 s full, ≤5 s 0.75, ≤10 s 0.4, else 0) | 25% |
| Album (weak: compilations differ) | 5% |

Then:

- A weak title or artist caps the score at 0.4, and a length more than 15 s off at 0.45, so one good field cannot rescue a wrong recording.
- A different **version** (live, remix, acoustic, instrumental/karaoke/off vocal, cover, demo, sped up/slowed) halves the score. Remasters, mono mixes and "deluxe" notes are ignored.
- Text is compared after Unicode compatibility folding (full-width, case, punctuation). Diacritics are folded for Latin text only, so Japanese voiced marks (が / か) are never merged.

**Verified** means a score of at least 0.85 *and* a length within 5 s of the track. Only verified results are stored automatically. A result that is plausible but not verified (0.5–0.85, or a length 5–15 s off) is shown in manual search as "Uncertain match" and never stored without your choice. The 5-second rule exists because a real LRCLIB result 8 s longer than the track scored 0.85 and would otherwise have been accepted.

## Automatic retrieval and upgrades

When a track starts playing, the interface asks the server to look at it (after 1.5 s, so skipping through a queue searches nothing). The server:

1. Does nothing if the track already has local lyrics and upgrades do not apply.
2. For a track without lyrics (and "find missing lyrics" on): searches the enabled providers, keeps verified results the provider allows to be saved, picks the best by quality, then match, then provider order, and saves it as `managed`.
3. For downloaded lyrics below karaoke (and "upgrade" on): does the same, accepts only a strictly better quality, and checks again at most once a week.

It never delays playback. Requests for the same track share one search; leaving the track cancels the request and the next visit asks again.

A clean "nothing found" is remembered for a week. An outage, a timeout or a rate limit is **not** remembered, so the track is tried again later.

## Providers

| Provider | Status | What it does | Saves lyrics |
| --- | --- | --- | --- |
| **LRCLIB** | Implemented, checked against the live service | Exact lookup then search; plain, synced and word-synced (Lyricsfile, when `hasWordSync`) | Yes |
| **Musixmatch** | Implemented, **not verified**; needs your own API key | Official `matcher.lyrics.get` and `matcher.subtitle.get`; no word-level (richsync) | **No** |
| **KuGou** | Not available | No public lyrics API; no request is ever made | — |
| **NetEase Cloud Music** | Not available | No public lyrics API; no request is ever made | — |
| **Apple Music** | Not available | The API documents only `hasLyrics`; the timed-lyrics endpoint is private | — |

LRCLIB was checked against the real service: the response has `id`, `trackName`, `artistName`, `albumName`, `duration`, `instrumental`, `hasWordSync`, `plainLyrics`, `syncedLyrics` and `lyricsfile`. The adapter sends a descriptive User-Agent, spaces requests, retries 5xx and network errors at most three times, honours `Retry-After` on 429 (and stops asking during the cool-down), and bounds responses to 4 MB. LRCLIB answered `503 ServerOverloaded` during testing, which is handled. No result with real word timing turned up in the samples tried, so karaoke from LRCLIB is covered by the parser tests and not by a live example.

Musixmatch: the developer terms could not be read and no key was available, so the adapter is deliberately conservative. Results can be previewed but not chosen (choosing means saving, which is not allowed), the match is never reported as verified, and the key is read from the server configuration only and redacted from errors.

KuGou, NetEase and Apple Music are listed so the interface can say why they are off. KRC and YRC word-timed formats are **not** supported.

LRCLIB's terms of use could not be read from here either; it is a free community service whose own client downloads and stores lyrics.

## Offline, restarts and the scanner

- Saved lyrics are read from disk on every request. They need no network and no database state, and survive restarts, updates and library rescans.
- Sidecar files, including `.lyrics.json`, are read from disk at request time and are not stored in the database, so a rescan cannot lose them. (Embedded lyrics are stored by the scanner, as before.) Writing a sidecar can make the folder watcher run one selective scan of that folder; it does not repeat.
- A lost database loses the settings, the "not found" memory, and the lock and offset of tracks whose current lyrics are a sidecar or embedded. Everything saved in a `.lyrics.json`, including its lock and offset, is intact.

## API

All under `/api/lyrics`, with the usual authentication. Reading and automatic retrieval are open to every signed-in user; everything else is **administrators only**, because it changes files in the shared library.

| Request | Who | Purpose |
| --- | --- | --- |
| `GET /settings` | user | Settings and provider statuses (never credentials) |
| `PUT /settings` | admin | Save settings |
| `GET /song/{id}` | user | Where the current lyrics come from, local versions, lock, offset, history |
| `POST /song/{id}/resolve` | user | Automatic retrieval or upgrade for a track |
| `POST /song/{id}/search` | admin | Search providers; candidates come with a preview |
| `POST /song/{id}/apply` | admin | Choose a candidate by ID (`confirm`, `force`) |
| `POST /song/{id}/import` | admin | Import a file's text (`.lrc`, `.elrc`, `.ttml`, `.srt`, `.txt`, `.yaml`, `.lyrics.json`, up to 2 MB) |
| `PUT /song/{id}/lock`, `PUT /song/{id}/offset` | admin | Lock; offset (clamped to ±10 min) |
| `POST /song/{id}/restore`, `DELETE /song/{id}` | admin | Restore a version; delete the Navidrome sidecar |
| `POST /bulk`, `GET`/`DELETE /bulk/{id}` | admin | Library, album or track jobs: `missing`, `upgrade`, `recheck`, `replace-manual` (needs `confirm`) |

A candidate is always referred to by an ID the server issued, so a client cannot supply lyrics of its own through it. Errors carry a code (`confirm-required`, `locked`, `not-storable`, `no-candidate`, `read-only`, `unsafe-path`, `not-managed`, `busy`, …).

## Interface

- **Now Playing → lyrics** shows a quiet line: where the lyrics come from, quality, lock, offset and the provider's attribution.
- **Manage** (administrators): current lyrics, lock, timing, other versions, import, delete, history with restore, and a *Find lyrics* tab with provider outcomes, previews, match quality and whether a result can be saved.
- **Settings → Lyrics** (administrators): the switches, every provider's real status, and whole-library jobs with progress and cancel. Replacing lyrics you added yourself, in bulk, sits behind its own confirmation.
- **Album → ⋯ → Find lyrics for this album** (administrators).

## Configuration

| Setting | Default | Notes |
| --- | --- | --- |
| `Lyrics.LRCLIB.Enabled` | `true` | |
| `Lyrics.LRCLIB.BaseURL` | `https://lrclib.net` | |
| `Lyrics.Musixmatch.ApiKey` | empty | Config file or `ND_LYRICS_MUSIXMATCH_APIKEY`; masked in the configuration view |
| `Lyrics.HistoryKeep` | `10` | Versions kept per track |
| Prefer local files | on | stored in the database |
| Find missing lyrics automatically | **on** | stored in the database |
| Upgrade downloaded lyrics automatically | on | |
| Also upgrade lyrics I added myself | off | |
| Providers | LRCLIB | order is the tie-breaker |

**Automatic retrieval is on by default**, so the first time a track without lyrics plays, a `.lyrics.json` is written beside it. Turn it off in *Settings → Lyrics*, or leave the library read-only: the engine then reports that it cannot save and nothing else changes.

## Security

- Writes are confined to the library: the folder must resolve inside it, symbolic links at the target or in the path are refused, and non-local libraries are not written.
- Only Navidrome envelopes are replaced or deleted; other files with the same name are left alone.
- Provider answers are size-bounded and validated; imports are bounded; offsets are clamped.
- Credentials never reach the interface, the logs or the error messages.

## Tests

Run: `go test ./core/lyrics/ ./server/nativeapi/` and `cd ui && npm test`.

- **Go (`core/lyrics`)**: quality classification; matching (featured artists, versions, Unicode, CJK, duration); ranking (a doubtful karaoke never beats correct synced lyrics); the envelope (round trip, every validation); the store (atomicity, no leftovers, history, bounds, restore, undo of the first write, symlinks, traversal, read-only folders, 12 concurrent writers); LRCLIB against a fake server (exact then search, retries, 429 cool-down, malformed JSON, timeouts, huge responses); Musixmatch; the unavailable providers; the engine (precedence, retrieval, upgrades, locks, manual replacement, import, offsets, deletion, settings, bulk jobs). Run with the race detector.
- **Go (`server/nativeapi`)**: authentication, admin-only writes, error mapping, no credential in any response.
- **Frontend**: the API client, signals and `useLyrics` (refresh after a change, no previous-track lyrics), the source line, the manager (search, preview, confirm, locked, undo, import, history, deletion, errors), the settings and the automatic request.
- **Not covered by automated tests**: live providers other than LRCLIB, and word timing from a live LRCLIB result.

Beyond the unit tests, the feature was run end to end against the real LRCLIB with a copy of three library tracks: automatic retrieval for a Japanese title, local-over-remote precedence with a hand-written `.lrc`, confirmed replacement, lock, offset, undo, a full scan, a restart with the network cut, and a check that the audio and the original `.lrc` were byte-identical afterwards.

## Known limitations

- Changes (choose, import, lock, offset, restore, delete, bulk) are administrator-only.
- Only local libraries can be written to. `.lyrics.json` is the only sidecar written: `.lrc` is not exported, so other players do not see downloaded lyrics.
- Choosing embedded lyrics copies them into a preferred sidecar; the embedded ones stay in the audio.
- A library folder reached through a symbolic link that leaves the library is not written to.
- Bulk jobs run in memory: a restart stops one, and running it again skips finished tracks.
- Musixmatch is unverified and saves nothing; KuGou, NetEase and Apple Music are off; KRC and YRC are not parsed.
- The Windows build was not compiled here (it needs CGO for SQLite); the code avoids platform-specific calls.
- `golangci-lint` was not run.
