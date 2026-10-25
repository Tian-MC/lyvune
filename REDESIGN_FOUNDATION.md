# Lyvune — Redesign Foundation

Phase 0 deliverable: an audit of the existing frontend, the functional systems that
must survive the reconstruction, the architectural decisions taken, and the phased
roadmap with acceptance criteria.

Central principle: **Quiet when browsing. Immersive when listening.**

---

## 1. Repository state at the start

| Item | Value |
| --- | --- |
| Branch | `redesign` (from `master` @ `ec2e0a9e`) |
| Working tree | clean — no unexpected changes |
| Backend | Go 1.27, untouched by this work |
| Frontend | `ui/` — Vite 7, React 17.0.2, react-admin 3.19, Material-UI v4 |
| Package manager | npm (lockfile `ui/package-lock.json`) |
| Test runner | Vitest 4 + Testing Library (jsdom) |
| Lint | ESLint 8 (react, hooks, jsx-a11y), Prettier 3 |
| Local library | a personal music folder — treated as **read-only** |

The UI is embedded in the Go binary (`ui/embed.go`) from `ui/build`. In dev mode Vite
proxies `/auth`, `/api`, `/rest`, `/backgrounds` to the backend on `PORT + 100`.

## 2. Frontend architecture (as found)

```
index.jsx → App.jsx
  ├─ SharePlayer (public share links, rendered instead of the app)
  └─ HotKeys → DndProvider → redux Provider → react-admin <Admin>
        ├─ dataProvider   ra-data-json-server over /api + wrapper (library filter, playlists, users…)
        ├─ authProvider   /auth/login, JWT in localStorage + Subsonic salt/token
        ├─ i18nProvider   polyglot, translations served by /api/translation
        ├─ customRoutes   /personal
        ├─ layout         Layout (RA Layout + AppBar + Menu + Notification)
        ├─ Resources      album, artist, song, radio, share, playlist, user, player,
        │                 transcoding, library, missing, plugin (+ data-only resources)
        └─ <Player/>      navidrome-music-player (react-jinke fork) mounted as a child
```

### State (redux, created in `store/createAdminStore.js`)
`admin` (react-admin cache), `router` (connected-react-router, **hash history**),
`player`, `library`, `albumView`, `theme`, `settings`, `replayGain`, `transcoding`,
`activity`, and dialog slices. `theme`, `library`, `player.{queue,volume,savedPlayIndex}`,
`albumView`, `settings` are persisted to `localStorage.state` (throttled).

### Server APIs used by the UI
* **Native REST** (`/api/*`, JWT in `X-ND-Authorization`, refreshed on every response):
  album, artist, song, playlist (+ `/playlist/:id/tracks`), radio, share, user, player,
  transcoding, library, missing, plugin, genre, tag, translation, config, insights,
  keepalive, queue, inspect, metadata refresh, quickconnect, `/events` (SSE).
* **Subsonic** (`/rest/*`, `u/t/s` token auth, built by `subsonic/index.js`):
  `stream`, `getCoverArt`, `star/unstar`, `setRating`, `reportPlayback`, `download`,
  `startScan/getScanStatus`, `getNowPlaying`, `getArtistInfo`, `getAlbumInfo`,
  `getTopSongs`, `getSimilarSongs2`, `getAvatar`, `getLyricsBySongId`.

### Playback (legacy, as found — replaced by `playback/engine.js`)
* `navidrome-music-player` owns the `<audio>` element **and** its UI. Redux mirrors it
  through a fragile `playIndex/clear/syncQueue` handshake (`reducers/playerReducer.js`).
* `audioplayer/Player.jsx` adds: playback reporting (`starting/playing/paused/stopped`,
  heartbeat every `playbackReportIntervalMs`, debounced seek reports, keepalive on
  `pagehide`), `keepalive` call on track end, ReplayGain via Web Audio, transcoding
  decisions (`transcode/decisionService`, prefetch of the next 3 tracks),
  desktop notifications, document title, Google Analytics event, hotkeys,
  beforeunload guard, Media Session (inside the library).
* Lyrics: the reducer flattens the song's `lyrics` JSON into an LRC string, synced
  only, for the library's lyric overlay.

### Lyrics (server)
`getLyricsBySongId?id=…&enhanced=true` returns `structuredLyrics[]` with:
`kind` (`main | translation | pronunciation`), `lang`, `synced`, `offset`,
`line[] {start?, value}`, and — when the source has them — `cueLine[]` with
word-level `cue[] {start, end?, byteStart, byteEnd, value}` and `agents[]`.
So line sync, word sync, translations and romanisation are all **real data paths**,
present only when the files provide them.

## 3. Feature inventory (must survive)

**Browsing**: album lists (all, random, favourites, top rated, recently added,
recently played, most played) with search/filters/sort/pagination and grid/table
views; artists (role filter, info/bio, top songs, similar, external links);
songs (search, sort, column toggles, bulk actions); radios (play, CRUD for admins);
playlists (owner/public, smart playlists, sidebar list, drag reorder, add/remove,
import/export M3U); shares; library selector (multi-library).

**Album page**: artwork + lightbox, editable cover upload, dates, genres, record
labels, catalog, release types, comment, external links (MusicBrainz, Last.fm),
disc grouping with disc artwork, play/shuffle/add/next, love, rating, download,
share, info dialog, refresh metadata, missing files.

**Track interactions** (context menu): play now, play next, add to queue, instant
mix, add to playlist, show in playlist, share, download, info, love, rating,
go to album/artist, bulk selection actions.

**Player**: play/pause, prev/next, seek, volume, play modes, queue view/reorder/
remove/clear, save queue as playlist, love current, lyrics, cover → album,
ReplayGain, transcoding, notifications, hotkeys (`space ← → = - l shift+c m shift+?`).

**Personal settings**: theme, language, date format, default view, ReplayGain,
notifications, Last.fm and ListenBrainz scrobbling.

**Admin**: users, players, transcodings, libraries (scan, PID), missing files,
plugins (JSON-forms config, permissions), now-playing panel, scan activity panel,
about dialog, quick connect.

## 4. Brand identity — extracted, not invented

* The Lyvune logo (`resources/logo-192x192.png`, `ui/public/android-chrome-*`)
  is **black, white and `#0084FF`** (pixel census: `#0084ff` dominant, `#000000`
  second). The UI already uses `#0085ff` for the system-name link.
* **Lyvune Blue = `#0084FF`.** It is the only accent of the new design system.

## 5. Reuse vs. rebuild

| System | Decision | Reason |
| --- | --- | --- |
| Go backend, APIs | **keep untouched** | non-negotiable |
| `authProvider`, `httpClient`, `subsonic/` | **keep** | correct, tested, token refresh logic |
| `dataProvider` wrapper | **keep** | library filter, user/library association, playlists |
| react-admin core (store, cache, i18n, routing, resources) | **keep as infrastructure** | love/rating/refresh flows, SSE refreshes, admin CRUD all depend on its cache; migrating would rewrite reliable logic without benefit |
| `transcode/`, `utils/calculateReplayGain`, `eventStream` | **keep** | pure logic |
| Action creators (`playTracks`, `addTracks`, `playNext`, `shuffleTracks`, `setTrack`, …) | **keep the public API** | ~20 call sites dispatch them |
| `playerReducer` | **rewritten** | the jinke handshake disappeared with the new engine |
| `navidrome-music-player` | **replaced and removed** (also from `package.json`) | it owned both UI and audio, cannot be restyled into the new Now Playing |
| Layout, AppBar, Menu, all list/show pages, Personal | **rebuilt; legacy files removed** | presentation layer |
| Dialogs, context menus, admin CRUD forms | **keep logic, restyle** through a token-driven MUI theme | complex, well tested forms; visual consistency comes from the theme |
| 29 legacy themes | **removed**; only Lyvune and Lyvune OLED remain | stored ids still resolve (Dark and Extra Dark to the two themes, any other to Lyvune), see `DESIGN_SYSTEM.md` §13 |

## 6. Target architecture

```
ui/src/
  design/        tokens.css, global.css, muiTheme.js, primitives (Button, IconButton,
                 Artwork, Slider, Skeleton, EmptyState, Section, Tabs, …)
  shell/         AppShell (react-admin layout), Sidebar, TopBar, MobileNav, Home routing
  playback/      engine.js (audio singleton, outside React), reporting, mediaSession,
                 hooks (usePlayer, usePlaybackTime), PlayerBar, NowPlaying, Queue
  lyrics/        api, parser (line/word/translation), LyricsView
  views/         home, album, artist, library (albums/artists/songs/genres), search,
                 playlist, favorites, settings
  (existing)     dataProvider, authProvider, subsonic, transcode, dialogs, admin resources
```

Boundaries:
1. **API** — `dataProvider` (REST) + `subsonic` (Subsonic). Views never build URLs.
2. **Auth/permissions** — `authProvider`, `usePermissions`.
3. **Music data** — react-admin hooks (`useGetList`, `useGetOne`) so the shared cache
   keeps love/rating updates and SSE refreshes coherent across views.
4. **Playback engine** — a module singleton owning one `HTMLAudioElement` created once,
   never inside a page component. Redux holds *intent* (queue, index, mode, volume);
   the engine holds *media* (time, buffering). High-frequency time is published through
   a tiny subscription store, never through redux → no global re-renders at 4 Hz.
5. **Queue** — pure reducer functions (add, next, move, remove, shuffle/unshuffle).
6. **Lyrics** — fetched per track, parsed into a normalised model, synchronised against
   the engine clock with `requestAnimationFrame` only while visible.
7. **Navigation** — react-admin routes (URLs preserved: `#/album/:id/show`, …) plus
   custom routes (`/`, `/search`, `/personal`). Now Playing is an overlay with a history
   entry so the Back button closes it without unmounting the page.
8. **Presentation** — CSS Modules + CSS custom properties (no runtime CSS-in-JS for new code).
9. **Tokens/themes** — `design/tokens.css` is the single source; `muiTheme.js` maps the
   same values onto MUI so legacy forms and dialogs match.
10. **Interaction primitives** — shared components in `design/`.

### Dependencies added
* `react-virtuoso@4.16.1` — virtualised lists/grids with window scrolling and
  `endReached` paging (large libraries). Pinned to a mature release.
* `@fontsource-variable/inter@5.3.0` — self-hosted Inter variable (no external font CDN,
  works offline/PWA). CJK and other scripts fall back to system fonts.
* Icons: `react-icons/lu` (Lucide) — **already a dependency**, consistent 1.5–2px strokes.

### Dependencies removed
`navidrome-music-player`, `react-drag-listview`, `react-measure` — used only by the
removed legacy player, layout and pages (import-graph and symbol analysis against
upstream `master`).

No framework migration. React 17 stays (react-admin 3 requires it).

## 7. Roadmap & acceptance criteria

| Phase | Scope | Acceptance criteria |
| --- | --- | --- |
| 0 Audit | this document | inventory complete, decisions recorded |
| 1 Design system | `DESIGN_SYSTEM.md`, tokens, global styles, MUI theme, primitives | tokens drive both new components and MUI; focus ring visible; reduced-motion honoured; build passes |
| 2 Shell + engine | AppShell, sidebar (collapsible), top bar, mobile nav, new playback engine, PlayerBar | navigation never interrupts audio; all legacy destinations reachable; hotkeys work; reporting calls identical to legacy; queue persists across reload |
| 3 Home + library + search | Home (real data only), albums/artists/songs/genres browsing, search | sections hidden when empty; virtualised lists; sort/filter preserved; keyboard search |
| 4 Album + artist | cinematic heroes with artwork-derived ambience, tracklists | current track marked by icon + colour; all track actions available; mobile hero recomposed |
| 5 Now Playing | immersive overlay | opening/closing never restarts audio; Back closes it; ambient colour from artwork; contrast ≥ 4.5:1 for text |
| 6 Lyrics + queue | synced/unsynced/word-level/translation lyrics, queue panel | no fabricated timing; manual scroll pauses auto-follow; reorder/remove/jump/clear/save queue |
| 7 Playlists, settings, rest | playlists, personal settings, admin screens themed, share player | every legacy setting present; no visually legacy screen left |
| 8 Polish | a11y, perf, edge cases, dead-code removal | lint/tests/build green; long titles/missing art handled; legacy presentation code removed only after verification |

Validation after each phase: `npm run lint`, `npm run type-check`, `npm test`,
`npm run build`, plus browser checks (desktop + mobile viewport) against a local
backend scanning the read-only library.

## 8. Status (release-readiness pass)

| Phase | Status |
| --- | --- |
| 0 Audit | done |
| 1 Design system | done — tokens, global styles, MUI theme, primitives, `DESIGN_SYSTEM.md` |
| 2 Shell + engine | done — AppShell, collapsible sidebar with playlists, top bar with global search, mobile tab bar, audio engine, PlayerBar, hotkeys, scroll restoration, `/` search refocus |
| 3 Home + library + search | done — Home, Albums (all list types, legacy filters), Artists, Songs, Genres, Favourites, Library hub (`/browse`), Search |
| 4 Album + artist | done — plus quality chip, subtitle, playlist origin link, drag to queue, per-list columns and rating |
| 5 Now Playing | done — overlay with history entry, ambient light, focus trap, desktop + mobile layouts |
| 6 Lyrics + queue | done — synced / unsynced / word-level / translation / romanisation (fixture-verified; LRC id tags hidden); queue panel closes when emptied |
| 7 Playlists, settings, rest | done — playlists (create, add, remove, reorder, edit, delete), personal settings, theme compatibility, public share player on the new engine; radios, shares and admin screens keep their react-admin layouts under the new theme |
| 8 Polish & cleanup | done — legacy player, layout, show pages, theme stylesheets and three dependencies removed |

Validation (this pass, run fresh): `npm run lint`, `npm run check-formatting`,
`npm run type-check`, `npm test` (98 files, 933 tests), `vite build`, `make test-i18n`
(with `gojq` standing in for `jq`). Browser checks against a local backend that scans
the read-only library: viewports 1920×1080, 1440×900, 1280×800, 768×1024, 390×844 and
360×800 (320×800 for overflow), a touch-enabled mobile context, a non-admin user, EN and
IT.

### Known limitations
* Development-only console warnings that come from upstream code and also occur on
  `master` are listed, with origin and reproduction steps, in `DESIGN_SYSTEM.md` §14.
* Languages other than English and Italian fall back to English for the new `ui.*`
  strings.
* react-admin applies edits and deletes after a ~5 s undo window, as upstream does.
* Not verified: Safari, Windows, a physical touch device, a real screen reader,
  Lighthouse scores, and word-level lyrics on real data (the library has none; covered by
  labelled fixtures and unit tests).
