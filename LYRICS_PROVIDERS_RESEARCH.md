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
| Storage | No terms were found that grant it. **Not saved unless `Lyrics.NetEase.Store` is on.** |
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
| Storage | No terms found. **Not saved unless `Lyrics.KuGou.Store` is on.** |
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
| Storage | Only the user's plan can authorize it. **Not saved unless `Lyrics.Musixmatch.Store` is on.** |
| Confidence | Low until a real key has been tried. |

The private tokens used by Musixmatch's desktop and mobile apps give access to RichSync without a commercial plan. They are **not** used: they are credentials extracted from a proprietary app and the request signature is a protection.

## Not done

- **QQ Music (QRC)** is not implemented.
- **NetEase `klyric`** and `ytlrc` are not parsed.
- **Apple Music** stays off: the timed-lyrics endpoint is private.
- **Traditional/Simplified Chinese** artist names are not converted. A match differing only in script scores about 0.82 and is offered for manual choice, never chosen automatically (seen live with 周杰倫 / 周杰伦).

## Live results

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
