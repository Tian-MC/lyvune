# Lyrics providers: research and findings

What was found about NetEase Cloud Music, KuGou Music and Musixmatch, how each was checked, and what the code does about it. Dated October 2026. "Live" means a real request to the service made from this project; "tests" means a fake server or a synthetic fixture.

## How this was researched

- **Live probing.** The endpoints were called directly and the responses read before any adapter was written. This is the main evidence.
- **Reference projects.** Only the **README pages** of the projects below were read (licence, providers, stated approach). Their source code was **not** read, and nothing was copied from them. The KRC layout was verified against a real KuGou file, the YRC layout against a real NetEase response.
- **Not examined:** Liriqo, syncedlyrics_aio, better-lyrics.

| Project | Licence | What its README says |
| --- | --- | --- |
| [syncedlyrics](https://github.com/moehmeni/syncedlyrics) | MIT | Musixmatch, NetEase, LRCLIB and others; an `enhanced` option that retrieves existing word-level LRC and falls back to line-synced. The README does not say how its Musixmatch provider authenticates. |
| [LDDC](https://github.com/chenmozhijin/LDDC) | **GPL-3.0** | QQ Music, KuGou, NetEase, LRCLIB; saves word-by-word LRC and others; opens local encrypted lyric files. |
| [Beautiful Lyrics Reborn](https://github.com/yeahnangua/beautiful-lyrics-reborn) | **AGPL-3.0-or-later** (its `Server/` too) | KuGou (KRC), NetEase (YRC), QQ (QRC), Musixmatch (RichSync). Matches on title, artist and duration and skips unverified user-uploaded KuGou entries. Musixmatch uses a runtime-acquired anonymous token. |
| [Syncanto](https://github.com/alfzcore/Syncanto) | MIT | Musixmatch through its desktop API, **signed with HMAC-SHA256**; NetEase through the public `music.163.com` endpoints; KuGou synced only. Uses rotating proxies for some other providers. 19 commits, no releases. |

**What was adopted, and what was refused**

- NetEase through its open web endpoints without an account: the same approach Syncanto describes; the code is this project's own.
- The idea of matching on title, artist and duration and distrusting unverified entries: already how this engine works.
- **Refused:** Musixmatch's desktop/anonymous token and its HMAC-signed API (private credentials and a request signature); proxy rotation; the signed NetEase `weapi`/`eapi` calls; any cookie-gated access.
- **Code licences.** No code from any of these projects is in this repository. LDDC is GPL-3.0 and Beautiful Lyrics Reborn AGPL-3.0+; this fork is GPL-3.0, which could in principle take GPL code, but writing from the format was the safer course and nothing needed to be taken. If code is ever reused, the licence notice has to travel with it.

## NetEase Cloud Music

| | |
| --- | --- |
| Reference | Syncanto's description of the public endpoints; own implementation |
| Mechanism | `GET music.163.com/api/search/get?s=…&type=1` then `GET /api/song/lyric?id=…&lv=-1&tv=-1&rv=-1&yv=-1` |
| Authentication | None. No account, cookie, token or signature. A `Referer` is sent. |
| Formats seen (live) | `lrc` (line-timed), `tlyric` (translation), `romalrc` (romanization), `yrc` (word-timed), `ytlrc`, `klyric` (empty in every sample) |
| Word timing | **Yes, for some songs.** For *Judas* the answer carried 9.5 KB of YRC; for another song none. The adapter parses `yrc` when present and otherwise classifies the result as line-synced. |
| Translation / romanization | Yes, as separate tracks, kept apart from the original |
| Limits | Undocumented; no rate limit was hit. Requests are spaced 400 ms and 429 is honoured. The original of some songs is missing from search (covers, live and remix versions come back instead, and are rejected). |
| Storage | No terms were found that grant it. **Never kept** (shown while playing from memory only); see the storage policy in `LYRICS_ENGINE.md`. |
| Confidence | Medium. Works today; undocumented endpoints can change. |

Is the YRC genuine? In the sample, 7 of 55 multi-word lines had words of identical length (chanted "oh oh oh oh" lines); the rest varied. The guard (`rejectSyntheticWordTiming`) only distrusts a document where most lines look divided by formula.

## KuGou Music

| | |
| --- | --- |
| Reference | LDDC and Beautiful Lyrics Reborn describe KRC; own implementation checked against a real file |
| Mechanism | `songsearch.kugou.com/song_search_v2` → `lyrics.kugou.com/search?hash=…&duration=…` → `lyrics.kugou.com/download?id=…&accesskey=…&fmt=krc` |
| Authentication | None. |
| Formats seen (live) | `krc` (word-timed): base64 of `krc1` + zlib stream XOR-ed with a fixed 16-byte key that is part of the file format; its text holds `[start,duration]<offset,duration,0>word` lines and a base64 `[language:]` block with romanization and translation. `lrc` (line-timed). |
| Word timing | **Yes.** A real KRC of a Japanese song had 80 lines, 0 of them evenly divided; *Judas* gave 518 word cues. |
| Translation / romanization | In the KRC `[language:]` block, kept as separate tracks. The first sample file had romanization and a blank translation (so none was offered); the two results the adapter returned for the same song carried both. *Judas* had neither. |
| Limits | The song search silently returns **0 results** when asked in quick succession (observed live). The adapter spaces requests by 1 s and asks once more after an empty list. Entries whose length is more than 5 s from the song are skipped. |
| Storage | No terms found. **Never kept** (shown while playing from memory only). |
| Confidence | Medium. Works today; undocumented. |

## Musixmatch

| | |
| --- | --- |
| Reference | The official API documentation's method names; syncedlyrics and Syncanto for the existence of word-level data |
| Mechanism | Official API with the user's own key: `matcher.track.get`, `track.richsync.get`, `track.subtitle.get`, `track.lyrics.get` |
| Authentication | The user's API key from the server configuration, never sent to the browser. |
| Formats | RichSync JSON (`ts`, `te`, `l[{c,o}]`) parsed by `ParseRichSync`: seconds to milliseconds, only the last word of a line gets an end (`te`). LRC for subtitles; plain text. |
| Word timing | **Not verified.** No API key was available, so no real RichSync response was seen. The parser is covered by tests from the documented shape only, and the interface does not claim word timing for this provider. |
| Audit of the previous adapter | It used `matcher.lyrics.get`, which returns no track metadata, so every result got a fixed 0.7 confidence and could never be chosen. It now scores the match on the metadata Musixmatch returns, like the other providers. |
| Limits | Which calls work depends on the plan. A refused call (403) is skipped; a refused key (401/402) disables the provider. Free keys return partial lyrics ending in a "NOT for Commercial use" notice; those are discarded rather than shown as a whole song. |
| Storage | Only the user's plan can authorize it. **Never kept**, and only previewed in the manager; keeping would need an agreement with Musixmatch. |
| Confidence | Low until a real key has been tried. |

The private tokens used by Musixmatch's desktop and mobile apps give access to RichSync without a commercial plan. They are **not** used: they are credentials extracted from a proprietary app and the request signature is a protection.

## Not done

- **QQ's own encrypted QRC** is not decoded (word timing from QQ comes from the Better Lyrics cache; see Phase 11 below).
- **NetEase `klyric`** and `ytlrc` are not parsed.
- **Apple Music** stays off: the timed-lyrics endpoint is private.
- **Traditional/Simplified Chinese** artist names are not converted. A match differing only in script scores about 0.82 and is offered for manual choice, never chosen automatically (seen live with 周杰倫 / 周杰伦).

## Live results (Phase 10)

From `go test -tags live -run TestLiveProviders ./core/lyrics` (opt-in; it calls the real services). Recorded 25 Oct 2026.

| Track | NetEase | KuGou |
| --- | --- | --- |
| *Judas*, Lady Gaga (English) | 3 verified results, word-timed YRC, with translation | 1 verified result, word-timed KRC (518 cues) |
| マトリョシカ, 米津玄師 (Japanese) | 3 verified, word-timed YRC, translation and romanization | 2 verified, word-timed KRC, translation block and romanization |
| 晴天, 周杰倫 (Chinese) | none (only covers; rejected) | 1 result, 0.82, **not verified** (script difference) |
| Dynamite, BTS (Korean) | none (only live, remix and cover; rejected) | none |
| *Judas* with a wrong length (30 s) | none | none |
| *Incultus*, Xanthochroid (no duration) | 1 verified, line-synced only | none |

Not saved anywhere in the real library: all persistence checks used a temporary copy.


# Phase 11: QQ Music, keyless sources and the status discrepancy

## Why the interface said "KRC not supported" while the code supported it

The texts quoted in the report ("KuGou has no public developer API for lyrics… which this project does not use", "The KRC word-timed format is not supported", the same for NetEase and YRC) are the descriptions of the placeholder providers that Phase 9 shipped, and they exist **only on `master`** (`core/lyrics/provider_unavailable.go`). Phase 10 replaced those placeholders with working adapters on `lyrics-providers`, which was never merged.

The cause was a stale process, not a code defect: the development backend on port 4633 was a Phase 9 binary (started 02:32, built 12:37; it contained the placeholder text and no `song_search_v2`). The Vite server on 4533 proxies to it, so the interface faithfully displayed what that old backend said. The registry, the capability metadata and the frontend were correct for the new code; nothing was missing or disabled by a flag. Replacing the binary with the current build made the same interface report KuGou, NetEase and QQ as ready (`/api/lyrics/settings` on 4633 now lists them).

The wording itself was also a weakness: a single "Ready · checked against the live service" line mixed several different facts. Providers now report implemented, set up, seen working, karaoke seen, checked in development and storage separately (see `LYRICS_ENGINE.md`).

## What was read this phase

| Source | Read at | Finding |
| --- | --- | --- |
| syncedlyrics `providers/musixmatch.py` | source | Calls `apic-desktop.musixmatch.com`, gets an anonymous `usertoken` from `token.get` using a hard-coded desktop-app `app_id`, caches it for 10 minutes. That is the anonymous token of Musixmatch's own desktop app. |
| LiriQo README | README | QQ through `musicu.fcg` (`GetPlayLyricInfo`), KRC/QRC decrypted inside its own worker; Musixmatch only as an upstream behind YouTube Music. MIT. |
| LDDC, Syncanto (this phase) | README only | Not re-read. Phase 10's notes stand. |
| Better Lyrics docs and live API | docs + live requests | See below. |

No source code of LDDC, Syncanto, Beautiful Lyrics Reborn or LiriQo was read or copied, so no GPL/AGPL code is in the repository.

## Better Lyrics API (live, Oct 2026)

| Endpoint | Keyless result |
| --- | --- |
| `/qq/getLyrics` | `200` QRC when the song is cached; `404` for a cached "nothing"; **`401 API key required` for an uncached song** |
| `/kugou/getLyrics` | `200` line-timed LRC when cached; same `401` otherwise |
| `/ttml/getLyrics` (syllable) | `401` for all four songs tried; no cached hit |

So "keyless" means **cache-only**. In eight songs, QQ had QRC cached for one, KuGou LRC for one. A later request for another album spelling of *Judas* did return QRC, so the cache varies and cannot be relied on. The responses carry no match score on the provider endpoints. The KuGou endpoint returns only line-timed LRC, which is lower than the KRC the project already reads directly, so it was not added. TTML was not adopted: it gave nothing keyless and does not state where its data comes from.

## QQ Music

| | |
| --- | --- |
| Direct route | `c.y.qq.com`: `smartbox_new.fcg` (search), `fcg_play_single_song.fcg` (title, artist, album, length), `fcg_query_lyric_new.fcg` (line-timed LRC + translation). Needs a `Referer`, no account, cookie or signature. Unofficial. |
| Word timing | **QRC**, from the Better Lyrics cache (keyless, cached songs) or from Better Lyrics with the user's own key. QQ's own QRC download is encrypted with a custom DES; it is **not decoded**. |
| Genuine? | Checked on real documents: *Judas* 522 cues, 75 lines of 4+ words, 0 uniform, 268 distinct durations; *Blinding Lights* credit lines are evenly split but the sung lines vary (142–1083 ms); both kept as karaoke. |
| Real-world defect found | The QRC envelope is **not well-formed XML** (raw `"` inside `LyricContent`), so an XML parser rejects it. The body is cut out as text instead. |
| Storage | No terms found. Never kept (shown while playing from memory only). |
| Confidence | Direct route: medium. Word timing: low to medium (depends on the cache). |

## Musixmatch without a personal key

Investigated; **no authorized keyless route was found, and none is implemented.** The keyless routes open-source projects use take the anonymous token of Musixmatch's desktop app (a hard-coded app id presented as that app), and some sign requests with HMAC. Those are credentials taken from a proprietary application and a request signature meant to restrict access. The official API with the user's own key stays as an optional mode, shown as such next to a "Without a key: not available" mode so it is not mistaken for a toggle that does nothing. Local `.lrc`, `.krc`, `.yrc` and `.qrc` import remains available.

## Parser support (independent of the network)

| Format | Parser | Source of real data |
| --- | --- | --- |
| LRC, enhanced LRC, plain | `model` package | LRCLIB, QQ direct, NetEase, KuGou fallback |
| LRCLIB Lyricsfile | `model` package | LRCLIB (`hasWordSync`) |
| KRC | `krc.go` (plain or `krc1` container) | KuGou, live |
| YRC | `yrc.go` | NetEase, live (some songs) |
| QRC | `qrc.go` (decrypted XML or bare body) | Better Lyrics cache, live |
| RichSync | `richsync.go` | Musixmatch; **not seen live** |

All keep real timestamps, never set a word end the source does not give, and drop word timing from documents whose words look divided by formula. Local `.krc`, `.yrc` and `.qrc` sidecars work offline when their suffix is in `LyricsPriority`.

## Storage matrix

| Provider | Retrieval | Permanent storage |
| --- | --- | --- |
| LRCLIB | Public API | Yes |
| KuGou, NetEase, QQ | Open web endpoints, no terms found | **No.** Shown from memory; kept only with a written authorization |
| Musixmatch | Official API with the user's key | **No.** Preview only; kept only with a written authorization |
| Apple Music | Not implemented | — |

Retrieval and storage are separate decisions: a result can be shown and chosen for the session without being kept.

## Live results, 25 Oct 2026

`go test -tags live -run TestLiveProviders ./core/lyrics`. Counts are structural; no lyric text is reproduced.

| Track | NetEase | KuGou | QQ |
| --- | --- | --- | --- |
| *Judas* (English) | 3 verified, YRC, 514 cues, translation | 1 verified, KRC, 518 cues | 1 verified, line-timed (82 lines); QRC 522 cues in the app run |
| マトリョシカ (Japanese) | 3 verified, YRC 629–640 cues, translation + romanization | 2 verified, KRC 637–664 cues, translation + romanization | 2, **not** verified (0.84, script variants in the artist), line-timed |
| 晴天 (Chinese) | none (covers only) | 1, 0.82 not verified, KRC 597 cues | 2: line-timed 0.82; QRC 597 cues 0.70, **not** verified |
| Dynamite (Korean) | none | none | 1 verified, line-timed (83 lines) |
| *Blinding Lights* | 3 verified, YRC | 1 verified, KRC | 2 verified: line-timed and QRC 316 cues |
| Wrong length (30 s) | none | none | none |

End to end in a browser on a temporary copy of the library: QQ's QRC for *Judas* was chosen in the manager, saved (`.lyrics.json`, provider `qq`, 82 lines, 522 cues), played with the words advancing, seeked by clicking a line, and read back with the network cut. Karaoke rendering of NetEase and KuGou was checked the same way in Phase 10.


# Phase 11 final validation

## Status of each provider, checked against the code (25 Oct 2026)

| Provider | Official? | Key | Formats read | Word timing | Storage by default |
| --- | --- | --- | --- | --- | --- |
| LRCLIB | Public API | none | Lyricsfile, LRC, plain | Yes, when `hasWordSync` (seen live) | Yes (its own policy) |
| KuGou | **Unofficial** web endpoints | none | KRC, LRC, translation, romanization | Yes, KRC (seen live, many songs) | **No** |
| NetEase | **Unofficial** web endpoints | none | YRC, LRC, translation, romanization | Yes for some songs (seen live) | **No** |
| QQ Music | **Unofficial** web endpoints + Better Lyrics community cache | none (optional Better Lyrics key) | QRC, LRC, translation | Only when the cache holds the song (seen live: 1 song in 8 without a key; *Judas* under one album spelling) | **No** |
| Musixmatch | Official API | **your own key** | RichSync, LRC, plain | **Not verified** (no key) | **No** |
| Apple Music | none | n/a | none | n/a | n/a |

A working endpoint is not an authorized one, and neither is permission to keep the lyrics. KuGou, NetEase and QQ answer without credentials today; their terms were not found, and they can change or block a region at any time.

## Findings of the final validation

- **QRC parser.** Reviewed and fuzzed. Reproduced and fixed: a quadratic scan, negative times from integer wrap-around (also through `[offset:]`), merging of several `Lyric_N` blocks, invalid UTF-8 reaching line text, no limits on size or line count. Fuzzing (40–60 s per parser after the fixes) found no further failure.
- **Earlier build wrote junk.** A previous build saved NetEase's answer for a song without lyrics (a lone `[00:00.00-1] 作曲 : name`) as plain lyrics. Such results are no longer offered or saved, and a managed sidecar like that is ignored (the file is not touched).
- **Mobile.** At 320 px the Repeat button stuck out 4 px of its column and two Now Playing links were 20 px high; both fixed. No page overflow at any of the three widths.
- **Playback.** One playback element for the session (the engine builds two at start-up and never again); a provider that never answers does not move the audio clock.

## Remaining limitations

- QQ's own encrypted QRC is not decoded; word timing from QQ depends on a community cache.
- Musixmatch has never been exercised against the live service.
- The Simplified/Traditional Chinese mismatch is not handled.
- "Seen working" and "karaoke seen" are in memory and start empty after a restart.
- Browser coverage: Chromium, Firefox 158, emulated mobile viewports. No Safari, real device or assistive technology.


# Storage policy (final)

Storage is configurable per provider. A provider's *rights status* (granted, unclear, restricted) is kept apart from the administrator's *preference* to save and from the *outcome* of the last save; a preference is never described as a permission. No provider's terms on keeping lyrics could be verified, so every built-in provider is *unclear*; LRCLIB is saved by default, the others only when the administrator turns them on. A recorded restriction is honoured and not circumvented, and a save is reported only after the sidecar was read back. Details are in `LYRICS_ENGINE.md`, section *Storage policy*.

Found while validating it: the application builds one lyrics service per router, so state held in memory (what is shown, provider health) has to be shared between them or the player's router never sees what the administrator's router chose. Unit tests of one service cannot show this; the shared state is covered by a test with two services and was confirmed against a running server.
