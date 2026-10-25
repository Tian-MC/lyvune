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

| Provider | Access | What it reads | Shown while playing | Kept on disk |
| --- | --- | --- | --- | --- |
| **LRCLIB** | Public API, no key | Exact lookup then search; plain, synced and word-synced (Lyricsfile, when `hasWordSync`) | Yes | **Yes, permission not verified** (see below) |
| **KuGou Music** | Open web endpoints, no account (unofficial) | Song search, lyric entries, `krc` (word-timed), `lrc` fallback, translation and romanization | Yes, from memory | No |
| **NetEase Cloud Music** | Open web endpoints, no account (unofficial) | Song search, `lrc`, `tlyric`, `romalrc`, and `yrc` (word-timed) for the songs that have it | Yes, from memory | No |
| **QQ Music** | Open web endpoints, no account (unofficial) + Better Lyrics community cache | Line-timed lyrics and translation; word-timed **QRC** when the cache has the song (an optional Better Lyrics key makes any song available) | Yes, from memory | No |
| **Musixmatch** | Official API, **your own key** (no authorized keyless route exists) | `matcher.track.get`, `track.richsync.get`, `track.subtitle.get`, `track.lyrics.get` | Preview in the manager only | No |
| **Apple Music** | None | Not implemented: the timed-lyrics endpoint is private | — | — |

## Storage policy

Retrieval, display, import and storage are four separate things:

| | Meaning | Decided by |
| --- | --- | --- |
| **Retrieval** | Asking the provider for lyrics | How the service is reached (keyless, key, unofficial) and the enabled providers |
| **Display** | Showing the lyrics while a track plays, without keeping them | The provider's entry in the rights table: `session` (from memory) or `preview` (manager only) |
| **Import** | Lyrics you own: your `.lrc`, `.krc`, `.yrc`, `.qrc`, `.lyrics.json` | You: always allowed |
| **Storage** | Keeping the lyrics next to the audio so they work offline | Your **preference**, per provider, unless a recorded rule restricts it |

Three facts are kept apart and never merged:

- **Rights status** of a provider: `granted` (a recorded authorization), `unclear` (the default for every built-in provider: no terms permitting or forbidding storage could be verified) or `restricted` (only through a recorded record). The interface says "Rights unclear"; it never says that saving is permitted.
- **Preference**: the administrator's choice whether to save a provider's lyrics locally. It is a decision, not a permission from the provider. Defaults: LRCLIB on, the others off.
- **Outcome**: what happened to the last save (verified, or why it failed), shown on each provider card.

**Configuration** (Settings, administrators)

- *Save found lyrics automatically* (`autoPersist`, default on): off keeps every automatic result display-only.
- A save switch per provider (`storePref`). The old `store` list is still honoured as a preference that is on; an explicit choice beats it, and nothing is rewritten unless you change a switch.
- Enabled providers, minimum match confidence, automatic quality upgrades and manual-source protection are the existing settings.
- A provider that is `restricted` cannot be saved whatever the switch says: it is shown, with the reason.

**What happens**

- Automatic retrieval picks the best candidate by match confidence first, then genuine karaoke > synced > plain. If its provider is saved, it is written as `<audio>.lyrics.json` with word timing, translation, romanization, provenance and history, and the result is **read back and compared** before it is reported as saved. If it is not saved, it is shown from memory ("Shown from X · not saved").
- A saved sidecar is loaded without any network or provider call, so karaoke survives restarts, the browser being closed, a provider outage and no connection.
- Automatic quality upgrades (for example LRCLIB synced to KuGou KRC karaoke) keep the previous version in history, never downgrade, respect locks and check at most once every seven days.
- Source priority: locked or chosen local > your sidecars > existing local > embedded > managed saved > remote. Your own `.lrc/.krc/.yrc/.qrc` are never overwritten; a credits-only managed sidecar is ignored and never overwritten automatically.
- **Manual**: in the lyrics manager each result offers *Save lyrics locally* and, when allowed, *Show only*. Saving validates the result, checks locks and existing files, asks before replacing lyrics you supplied, writes atomically and confirms only after reading the file back. A restricted result offers *Show this version (not saved)*. The manager distinguishes shown temporarily, saved locally, storage restricted and save failed.
- A **bulk job** never fills memory: it saves what the preferences allow and counts the rest as not saved. It runs four workers; each provider keeps its own pacing.

**Recording a right or a restriction.** `lyrics-storage-rights.json` in the data folder documents what is known about a provider's terms. A record must name its basis and reference (500 bytes at most); the file is limited to 64 KB, is re-read every few seconds, and a broken file changes nothing:

```json
{"authorizations":[
  {"provider":"kugou","basis":"Licence agreement of 2026-11-02","reference":"contract no. 4711"},
  {"provider":"netease","status":"restricted","basis":"Terms of service, section 4","reference":"https://example.invalid/terms"}
]}
```

`granted` is the default status. An arbitrary declaration is not proof: the file writes the claim down where it can be checked, and the interface shows the basis. Restricted records are honoured without being circumvented.

**A saved file that holds only credits.** An earlier build saved a lone credit line for a song a service had no lyrics for. Such a file is ignored, listed in the lyrics manager, and removed only when the administrator confirms.

### Romanization made in the player

Lyrics that arrive without a romanization (from a provider or a sidecar) can be romanized **in the browser**, on request: the *Romanization* button in the lyrics view appears when the song is mostly written in a supported script, and the choice is remembered in the browser. Nothing is sent anywhere, saved to the sidecar, or computed until the button is on, and the original lines, their timing and the words of the karaoke are never touched: the romanization is a separate line shown above the text.

**Provider and generated.** A romanization supplied with the lyrics always wins and is shown as it is. Only the lines the provider left empty, or echoed unchanged, are filled in, so a provider that skipped a line does not leave a hole and never has a line replaced. Provider lines are matched to the lyrics by timestamp (or by position when the line counts are equal); a provider that does not line up gives nothing rather than a shifted romanization.

| Script | Library | Notes |
| --- | --- | --- |
| Japanese | `kuromoji` (mecab-ipadic) for the analysis, own kana converter | See below |
| Chinese | `pinyin-pro` | Pinyin with tone marks |
| Korean | `hangul-romanization` | Revised Romanization |
| Greek | `greek-transliteration` | ELOT 743-style |
| Russian, Ukrainian | `cyrillic-to-translit-js` | Ukrainian is chosen by its own letters (і ї є ґ) or the language tag; other Cyrillic languages are read as Russian |
| Arabic | `arabic-transliterate` | Lyrics carry no short vowels, so this is a consonant skeleton (*mrḥba bk*), not a pronunciation |

Each library is loaded the first time a song needs it. A line with several scripts goes through each romanizer in turn and keeps its Latin words.

**Japanese** is done in stages (`ui/src/lyrics/romanize/japanese.js`, `kana.js`), because a morphological analyzer gives readings, not romaji, and its token boundaries are not word boundaries:

1. *Analyze* every line, kana-only ones too (the first version sent those straight to a kana table, which is why they came out as one long word).
2. *Repair* what the analyzer gets wrong: 々 takes the reading of the kanji before it with rendaku where the sounds allow it (人々 *hitobito*, 色々 *iroiro*), and is left as written when there is no kanji to repeat; a run of unknown katakana is cut into the dictionary words it is made of (`ホップステップジャンプ`) or into its repeats (`ギブミーギブミー`); a kanji the dictionary only has as a suffix is read as the word it is after kana (手 *te*, not *shu*) unless the suffix reading differs by rendaku alone (顔 *gao*).
3. *Group* tokens into written words: particles stand alone, inflections and auxiliaries attach to their verb or adjective, the copula (です, だ) stands alone, pieces of a katakana word are joined (`ピン`+`キー`), a lone kana is joined to the kana word it belongs to (`なか`+`み`), and a sentence-final particle followed by kana of the same phrase is the start of a word (`よこ顔`). The spaces of the source are kept.
4. *Convert* to Hepburn: は/へ/を as particles are *wa/e/o*, a sokuon crosses the boundary of two tokens (`とっ`+`て` is *totte*), small kana (`ティ` *ti*, `ウィ` *wi*, `チィ` *chii*, `ピャ` *pya*), `ッチ` is *cch*, `ン` before a vowel is *n'*.
5. *Assemble* with the punctuation against the word before it, quotation marks against what they quote, and Latin text and numbers as they were.

Long vowels have two styles, chosen with the select beside the button and remembered for every song: doubled letters (`toukyou`, `haado`, the default, easy to type) or macrons (`tōkyō`, `hādo`). In the macron style a katakana ー is always a macron, おう/おお/ああ/うう/ええ inside a word are macrons, and the final う of a verb is not (`omou`, but `ikō`). Switching style does not analyze anything again.

**Han characters** are ambiguous: kanji with no kana in the song and no language tag could be Chinese or Japanese. They are read as Chinese unless the song has kana or is tagged Japanese, so Chinese lyrics are never read with Japanese readings, and when the choice is really open the player offers *Han characters: automatic / Chinese / Japanese*, remembered per song.

**Resources.** The analyzer's dictionary (about 17 MB, mecab-ipadic through `kuromoji`) is copied from the npm package at build time into `kuromoji-dict/`, fetched the first time a Japanese line is romanized, and never at startup. It is not precached by the service worker and adds about 17 MB to the server binary. The build also copies the mecab-ipadic `NOTICE.md` and the Apache licence of kuromoji next to it, as their licences require. If the dictionary cannot be loaded, kana lines are still read by the converter, lines with kanji are left out rather than guessed, the player says romanization could not be loaded when nothing at all worked, and a failed load is not retried for 30 seconds. Results are cached by line, engine and style (4,000 lines).

**Accuracy and limits.** Romanization is approximate. Measured on a sample of 1,000 lines, the analysis and conversion take under 0.1 ms a line, so no Web Worker was needed; loading the dictionary takes about 0.7 s the first time. Known limits: context-dependent kanji readings the dictionary chooses wrongly, proper names and invented words (read by their kana when the dictionary does not know them), compounds that the dictionary stores as one word (`もう一度` is *mouichido*), and rendaku in compounds the dictionary does not have. Chinese is written syllable by syllable without word boundaries, and Arabic is not vocalized. Spellings of invented names are conventions, not a single correct answer.

**Alternatives considered.** `kuroshiro` (with `kuroshiro-analyzer-kuromoji`) was used first and dropped: its analyzer uses Node's `path` and does not run in the browser, and it only wraps the same dictionary. `wanakana` was dropped for the converter because it cannot write `ティ`, `ウィ`, `チィ` or `ヴ` correctly and cannot express long vowels as macrons. A UniDic- or NEologd-based analyzer would improve names and compounds but is several times larger than mecab-ipadic and has no maintained browser build; it is not worth the weight without measurements that show it, so kuromoji stays and the repairs above are done around it.

**Manual corrections (not built yet).** Corrections for names or unusual readings would be a per-track overlay kept in the browser (`lyrics.romanization.fix.<trackId>`: a list of `{ from, to }` replacements applied to the romaji of the line that contains `from`, never to the lyrics, with a reset to the generated text and a distinct style for corrected lines). They are not implemented because the editor needs its own interface; the architecture keeps the original text, the timing and the provider romanization untouched.

### What the provider list shows

*Implemented*, *set up*, *seen working*, *karaoke seen*, *checked in development* and *can be saved* are separate facts, and none is inferred from another:

- **Implemented**: the backend has working code. An outage does not change it.
- **Set up**: everything needed to make a request is in place (a key, when one is needed).
- **Seen working** and **karaoke seen**: measured from the searches the server ran since it started. A search that finds nothing still shows the service answered. Karaoke counts only for a *verified* match that carries word timing; line timing is never karaoke. These reset when the server restarts.
- **Checked in development**: the adapter was checked against the live service when it was written.
- **Availability** is the state now: available, off, needs your key, not available, rate limited, or temporarily unavailable (the last answer was a failure).

*Check providers* (Settings, administrators; `POST /api/lyrics/providers/check`) asks each provider that is turned on for one well-known song so these update on request. It is never run in the background.

[LYRICS_PROVIDERS_RESEARCH.md](LYRICS_PROVIDERS_RESEARCH.md) has the evidence, the licences and the limits of each.

LRCLIB was checked against the real service: the response has `id`, `trackName`, `artistName`, `albumName`, `duration`, `instrumental`, `hasWordSync`, `plainLyrics`, `syncedLyrics` and `lyricsfile`. The adapter sends a descriptive User-Agent, spaces requests, retries 5xx and network errors at most three times, honours `Retry-After` on 429 (and stops asking during the cool-down), and bounds responses to 4 MB.

**Word timing is only what the source gives.** KRC and YRC are parsed by `krc.go` and `yrc.go`, RichSync by `richsync.go`; none of them depends on a network adapter, and none estimates a time. A word has an end only when the file says so. A document whose word times look divided by formula (most lines with words of equal length in time, or proportional to their letters) is reduced to line timing, so it can never rank as karaoke. A romanization keeps word timing only when it has exactly one piece per original word; a translation never has word timing.

**KuGou and NetEase are unofficial.** Neither has a public lyrics API. The adapters use the open web endpoints their own web clients use, with no account, cookie, token or request signing, and not the signed `weapi`/`eapi` calls. Their terms were not found, so the rights status is *unclear*: the administrator decides whether to keep their lyrics (see *Storage policy*), and that decision is not a permission from the provider. KuGou's song search answers "0 results" without any error when it is asked too quickly, so the adapter spaces its requests by a second and asks once more before believing an empty list.

**Musixmatch** uses only the official API with your own key; the private token of its apps is not used. Which calls a key may make depends on its plan: a call the plan refuses is skipped. Word timing is not advertised for it until it has been seen working.

Your own `.krc`, `.yrc` and `.qrc` files next to the audio are read as local sidecars when their suffix is in `LyricsPriority` (for example `.qrc,.krc,.lrc,embedded`). A `.krc` may be plain text or the distributed `krc1` container; a `.qrc` must be the decrypted XML or its bare body (QQ's encrypted form is not decoded).

**QQ Music.** The direct route (`c.y.qq.com`, with a `Referer`) gives search, title/artist/album/length and line-timed lyrics. Word timing comes from Better Lyrics (`/qq/getLyrics`): without a key it answers **from its cache only**, and an uncached song is refused with `401`, which is treated as ordinary, not as an error. In the tests, one song in eight had QRC cached without a key, and the same song could be cached under one album spelling and not another, so word timing from QQ is real but not dependable. The endpoint reports no match score and no length, so the QRC is matched from its own `[ti:]`, `[ar:]`, `[al:]` tags and rejected if it runs more than 5 s past the track; a QRC that stays under 0.85 only for lack of a length is verified when its line starts agree with those of the verified QQ lyrics (a different version drifts). The QRC envelope is cut out as text because real documents carry raw quotes and are not well-formed XML.

LRCLIB's terms of use could not be read from here either; it is a free community service whose own client downloads and stores lyrics.

### Parser limits and hostile input

The word-timed parsers (KRC, YRC, QRC, RichSync) read documents that come from the network or from a user's disk, so they are bounded:

- a document over 8 MB, or with more than 50,000 lines, is refused (`ErrLyricsTooLarge`); responses are also cut at 4 MB and sidecars at 16 MB;
- times are limited to 100 hours, so large values cannot wrap around into negative ones; an `[offset:]` beyond one hour either way is ignored, and an offset can never move a time below zero;
- the QRC token scan looks at most 48 bytes ahead, so a line of unmatched brackets costs linear time (it was quadratic: about 80 s for 4 MB);
- the QRC envelope is **not parsed as XML** (real documents contain raw quotes and are ill-formed, and an XML decoder would bring DTDs and entities). The first `Lyric_1` block is cut out as text and only HTML/XML character references are decoded, so nothing external is ever resolved (an `<!ENTITY ... SYSTEM "file:///...">` is just text);
- invalid UTF-8 is replaced with U+FFFD before parsing, so line text and cue byte offsets agree;
- an unreadable word keeps its line, without a time for that word. Nothing is estimated.

Fuzz targets (`go test -fuzz`) exist for QRC, KRC, YRC, RichSync and the KRC container; the inputs that once failed are kept as regression seeds in `core/lyrics/testdata/fuzz`.

### Bulk jobs

One job runs at a time and works on **4 tracks at once** (`bulkWorkers` in `bulk.go`). Providers still see requests no faster than their own pacing (a request every 0.3 to 1 s, depending on the provider), so the workers overlap the waiting, not the load. A provider asking to slow down, or a cancel, stops the job: tracks already running finish, nothing new starts, and the finished ones are skipped when it is run again. Inside a job the per-search timeout is 90 s instead of 20 s, because the workers' requests to one provider queue on its pacing.

### Results that are only credits

A service that has no lyrics for a song sometimes answers with a header: NetEase sent a single line, `作曲 : <name>`, for an instrumental. A result whose lines are all credits (`作词`, `作曲`, `Composer:`, `Lyrics by:`…), or a title plus credits, is not offered and not saved, for any provider. NetEase's stray `-1` in some timestamps (`[00:00.00-1]`) is removed.

## Who can do what

**Only administrators can make the server fetch lyrics**: searching providers, choosing a version, automatic retrieval and upgrades (`POST /api/lyrics/song/{id}/resolve`, triggered when an administrator plays a track), bulk jobs, imports, locks, offsets, restores, deletion, the provider settings and *Check providers*. Everyone else only **reads** lyrics: the lyrics a track already has (local files, embedded tags, saved `.lyrics.json`) are served to every signed-in user, and a regular user playing a track never causes a download. Anything an administrator saved is visible to all.

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
| `Lyrics.QQ.BetterLyricsApiKey` | empty | Optional: your own Better Lyrics key, so uncached songs are fetched too; masked in the configuration view |
| `Lyrics.HistoryKeep` | `10` | Versions kept per track |
| `lyrics-storage-rights.json` | absent | Recorded rights or restrictions per provider (see *Storage policy*); not a setting |
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
- Nothing can switch saving on for a provider without a written authorization; results that may not be kept are held in memory only (at most 300 tracks, twelve hours) and never written to the library or the database.

## Tests

Run: `go test ./core/lyrics/ ./server/nativeapi/` and `cd ui && npm test`.

- **Go (`core/lyrics`)**: quality classification; matching (featured artists, versions, Unicode, CJK, duration); ranking (a doubtful karaoke never beats correct synced lyrics); the envelope (round trip, every validation); the store (atomicity, no leftovers, history, bounds, restore, undo of the first write, symlinks, traversal, read-only folders, 12 concurrent writers); LRCLIB against a fake server (exact then search, retries, 429 cool-down, malformed JSON, timeouts, huge responses); Musixmatch; the unavailable providers; the engine (precedence, retrieval, upgrades, locks, manual replacement, import, offsets, deletion, settings, bulk jobs). Run with the race detector.
- **Go (`server/nativeapi`)**: authentication, admin-only writes, error mapping, no credential in any response.
- **Frontend**: the API client, signals and `useLyrics` (refresh after a change, no previous-track lyrics), the source line, the manager (search, preview, confirm, locked, undo, import, history, deletion, errors), the settings and the automatic request.
- **Not covered by automated tests**: live providers other than LRCLIB, and word timing from a live LRCLIB result.

Beyond the unit tests, the feature was run end to end against the real LRCLIB with a copy of three library tracks: automatic retrieval for a Japanese title, local-over-remote precedence with a hand-written `.lrc`, confirmed replacement, lock, offset, undo, a full scan, a restart with the network cut, and a check that the audio and the original `.lrc` were byte-identical afterwards.

## Test coverage of this feature

Automated: Go unit, provider, parser, fuzz, engine and API tests (`core/lyrics`, `server/nativeapi`, race detector), and the frontend suite. By hand against real services and real audio on a temporary copy of the library: Chromium and **Firefox 158** (via WebDriver BiDi; QRC karaoke, word highlighting compared with the QRC data frame by frame, seeking, pause and resume, track changes, provider search and filter, translation, history restore), Chromium at 390×844, 360×800 and 320×700, a provider that never answers while music plays, and a regular user who can read lyrics but cannot fetch any. Not covered: Safari, a real touch device, Windows, screen readers.

## Known limitations

- Anything that fetches or changes lyrics (search, choose, automatic retrieval, import, lock, offset, restore, delete, bulk, settings) is administrator-only; other users can only read.
- Only local libraries can be written to. `.lyrics.json` is the only sidecar written: `.lrc` is not exported, so other players do not see downloaded lyrics.
- Choosing embedded lyrics copies them into a preferred sidecar; the embedded ones stay in the audio.
- A library folder reached through a symbolic link that leaves the library is not written to.
- Bulk jobs run in memory: a restart stops one, and running it again skips finished tracks. A job of mostly KuGou lookups is limited by KuGou's one-request-a-second pacing, so four workers do not make that provider four times faster.
- Musixmatch is not verified against the live service (no API key was available); Apple Music is off.
- KuGou, NetEase and QQ use undocumented endpoints that can change or block a region at any time; saving their lyrics rests on the administrator's preference, not on a verified right; while that preference is off their lyrics are shown from memory only and are not available offline.
- No provider's terms on keeping lyrics could be verified: every built-in provider is *unclear*, and LRCLIB is saved by default only as a default preference.
- Lyrics shown but not saved are held in memory and are lost when the server restarts; after a restart the track is looked up again when an administrator plays it.
- NetEase word timing exists only for songs where the endpoint returns `yrc`; the others are line-synced. NetEase's `klyric` is ignored.
- A matching song can be missing from a service (a cover or live version is not accepted instead), and Simplified/Traditional Chinese artist names are not converted, so such a match is offered as "uncertain" and never chosen automatically.
- QQ's own QRC is encrypted and is not decoded; word timing from QQ depends on the Better Lyrics cache. Better Lyrics' TTML (syllable) provider was not adopted: without a key it served none of the songs tried, and it does not say where its data comes from.
- Simplified/Traditional Chinese is not converted: an artist written in the other script scores about 0.82 and is only offered for manual choice.
- Singer prefixes inside QRC lines are kept as text.
- The runtime "seen working" and "karaoke seen" marks live in memory and start empty after a restart.
- The Windows build was not compiled here (it needs CGO for SQLite); the code avoids platform-specific calls.
- `golangci-lint` was not run.
