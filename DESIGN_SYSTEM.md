# Lyvune Design System

**Quiet when browsing. Immersive when listening.**

The visual language of the redesigned Lyvune UI: roughly 70% minimal premium
(typography, spacing, restraint) and 30% cinematic (artwork-lit heroes, Now Playing).
Everything below is implemented in `ui/src/design/` and consumed by `shell/`,
`playback/`, `lyrics/` and `views/`.

---

## 1. Identity

| Role | Token | Value | Notes |
| --- | --- | --- | --- |
| Lyvune Blue | `--nd-blue` | `#0084FF` | Extracted from the official logo (`resources/logo-192x192.png`). Icons, progress, active states, focus. |
| Hover | `--nd-blue-hover` | `#2A97FF` | |
| Solid (text on blue) | `--nd-blue-solid` | `#0073DE` | Filled buttons with labels: 4.6:1 against white (AA). |
| Blue text | `--nd-blue-text` | `#4BA6FF` | Small blue text on dark surfaces (≥ 6:1). |
| Soft fills | `--nd-blue-soft` / `--nd-blue-softer` | 14% / 8% | Selected rows, active nav item. |

Blue is the **only** accent. There is no secondary hue: coral, purple and neon are
deliberately absent. Artwork colour may *light* a page (see Ambient) but never
recolours controls, navigation or text.

The logo is redrawn as an SVG (`shell/Logo.jsx`): blue disc, black grooves, white
label — faithful to the PNG mark.

## 2. Surfaces & text

Near-black neutrals with a hint of cool, separated by tone rather than borders.

| Token | Default | OLED variant |
| --- | --- | --- |
| `--bg-app` | `#08090B` | `#000000` |
| `--bg-sidebar` | `#050607` | `#000000` |
| `--surface-1` / `-2` / `-3` | `#121317` / `#181A1F` / `#202228` | one step darker |
| `--surface-hover` / `--surface-active` | white 5% / 8% | |
| `--border-subtle` / `-default` / `-strong` | white 6% / 10% / 18% | |
| `--text-1` | `#F4F5F7` | primary |
| `--text-2` | 66% | secondary (≈ 7.8:1) |
| `--text-3` | 50% | metadata (≥ 4.5:1) |

The OLED variant is selected with the Theme setting (`data-theme="oled"` on `<html>`).

## 3. Typography

* **Inter Variable**, self-hosted (`@fontsource-variable/inter`), with system CJK /
  Noto fallbacks so Japanese, Chinese, Korean, Cyrillic and Greek render natively.
* Features `cv11`, `ss03`; numbers that change (times, counts) use `.nd-tabular`.
* `overflow-wrap: anywhere` globally; titles use `text-wrap: balance`.

| Token | Size | Use |
| --- | --- | --- |
| `--text-display` | clamp(36 → 72px) | Album / artist / playlist hero titles, tracking −0.035em |
| `--text-h1` | clamp(28 → 40px) | Page titles |
| `--text-h2` | 24px | Section titles |
| `--text-h3` | 19px | Group titles |
| `--text-title` | 16px | Prominent row text |
| `--text-body` | 15px | Body |
| `--text-small` | 13px | Metadata |
| `--text-micro` | 11px | Overlines (uppercase, +0.08em) |

Bold is reserved for titles; metadata stays regular/medium in `--text-2/3`.

## 4. Space, radius, elevation

* Spacing: 4px base — `--space-1` (4) … `--space-20` (80). Page gutter
  `--page-gutter: clamp(16px, 3.2vw, 48px)`.
* Radius: `xs 4 · sm 6 · md 10 · lg 14 · xl 20 · full`; artwork `--radius-art: 6px`
  (artists are circles).
* Elevation: `--shadow-1` (rows), `--shadow-2`, `--shadow-pop` (menus, dialogs,
  panels: shadow + 1px hairline), `--shadow-art` (hero artwork).
* Glass (`backdrop-filter`) only on chrome that floats over content: top bar when
  scrolled, player bar, mobile nav, queue panel.

## 5. Motion

| Token | Value | Use |
| --- | --- | --- |
| `--ease-standard` | `cubic-bezier(.2,0,0,1)` | most transitions |
| `--ease-emphasized` | `cubic-bezier(.3,0,0,1)` | entering surfaces, art |
| `--duration-fast/base/slow/cinematic` | 120 / 200 / 320 / 600ms | |

Only opacity and transform are animated. No idle loops except the playing-bars
indicator (static when paused). `prefers-reduced-motion` zeroes durations and
disables keyframes globally.

## 6. Ambient lighting

`design/Ambient.jsx` lights album, artist, playlist and Now Playing backgrounds
from **real artwork data provided by the server**: the `thumbHash` (decoded to a
32px canvas, upscaled + blurred by the compositor) and `dominantColor`, softened
by `design/color.js` (saturation 18–62%, lightness 20–42%). A scrim guarantees text
contrast. Two intensities: `subtle` (heroes fade into the page) and `immersive`
(Now Playing). Static — one cross-fade when the artwork changes, no animation loop.

## 7. Icons

Lucide via `react-icons/lu`, re-exported with semantic names from
`design/icons.js` (`PlayIcon`, `QueueIcon`, `LyricsIcon`…). 24px grid, 1.75–2px
strokes. Transport glyphs (play/pause/skip) are filled for weight at small sizes.

## 8. Components

| Component | File | Notes |
| --- | --- | --- |
| `Button` | `Button.jsx` | `primary · secondary · outline · ghost · chip`; `sm · md · lg` |
| `IconButton` | `IconButton.jsx` | label is mandatory (aria-label + tooltip); `ghost · subtle · filled · light`; toggles use `active` (blue + dot) and `pressed` (`aria-pressed`) |
| `Slider` | `Slider.jsx` | native `<input type=range>`; drag preview + commit on release; buffered track |
| `Cover` | `Cover.jsx` | square/round artwork over the shared blob cache + thumbhash placeholder |
| `Ambient` | `Ambient.jsx` | see §6 |
| `Section`, `Shelf`, `PageHeader`, `EmptyState`, `Skeleton`, `PlayingBars` | `Section.jsx` | page structure and states |
| `ActionMenu`, `useActionMenu` | `ActionMenu.jsx` | "…" menus and right-click menus share one state; submenus supported |
| `LoveToggle` | `LoveToggle.jsx` | favourite toggle, blue filled heart when on |
| MUI theme | `muiTheme.js` | the same tokens mapped onto Material-UI for forms, dialogs, menus, tooltips, snackbars and react-admin screens |

Product components: `shell/` (AppShell, Sidebar, TopBar, MobileNav, UserMenu),
`playback/` (PlayerBar, NowPlaying, QueueList/QueuePanel, controls),
`lyrics/LyricsView`, `views/shared` (Cards, TrackList, Hero, CollectionMenu).

## 9. States & accessibility rules

* Focus: 2px Lyvune Blue ring (`--focus-ring`) on every interactive element
  (`:focus-visible`).
* State is never colour-only: active nav = blue icon + bold label + indicator bar;
  current track = playing bars + blue title; toggles = blue + dot + `aria-pressed`.
* Every icon-only control has an accessible name; dialogs trap focus, close on
  Escape and restore focus; Now Playing is `role=dialog aria-modal`.
* Touch targets ≥ 40px (44px for primary mobile actions); row actions grow to 40px on
  `(pointer: coarse)`; hover-only affordances become always-visible on `(hover: none)`
  devices.
* Cover images always carry an `alt` (the title, or `""` when the text beside them
  already names the item).
* Contrast: body text ≥ 7:1, metadata ≥ 4.5:1, white on filled blue 4.6:1.

## 10. Layout & breakpoints

CSS custom properties cannot be used in media queries, so breakpoints are
documented constants:

| Name | Width | Behaviour |
| --- | --- | --- |
| phone | < 600px | 2-column grids, stacked heroes |
| small | < 700px | tracklists drop album/duration columns |
| tablet | < 900px | sidebar hidden → bottom tab bar + floating mini player |
| laptop | < 1100px | compact player bar |
| desktop | ≥ 1100px | full layout, content max `--content-max: 1680px` |

Safe areas (`env(safe-area-inset-*)`) are applied to the top bar, mobile nav,
player and Now Playing.

## 11. Writing new UI

1. Use tokens, never raw colours/sizes (the only exceptions are pure white/black
   on cinematic surfaces).
2. Style with CSS Modules next to the component; no new runtime CSS-in-JS.
3. Strings go through `useT()` (`i18n/useT.js`) with an English fallback, and the
   key is added to `ui/src/i18n/en.json` (`ui.*` namespace).
4. Hooks/helpers live in their own modules (fast-refresh lint rule).
5. Playback is driven only through `playback/engine.js` and redux actions —
   components never touch an `<audio>` element.

## 12. Tracklists

`views/shared/TrackList` is the single tracklist used by albums, artists, playlists,
Songs and search. Optional columns (rating, quality, year, plays, last played, album
artist, composer, genre, mood, BPM, channels, size) are chosen per list from the
column menu and stored in `settings.trackColumns` (falling back to the legacy
`toggleableFields`). Below 900px the optional columns and the header are hidden.
Selection (`useTrackSelection` + `SelectionBar`), drag/Alt+Arrow reordering and the
context menu are shared by every list.

## 13. Theme compatibility

The interface is dark-only. `design/legacyThemes.js` keeps the theme ids that
users stored in earlier versions working, without rewriting what is stored:

| Support | Themes | Result |
| --- | --- | --- |
| successor | Dark, Extra Dark | the official Lyvune and Lyvune OLED variants |
| tinted | 18 dark community themes | their accent and background feed the tokens (`computeTint`); secondary text, muted text and filled-accent text are recomputed so contrast stays ≥ 7:1 / 4.5:1 / 4.5:1 |
| unsupported | 9 light themes | Lyvune is used and the theme picker says so |

The legacy theme definitions in `src/themes/` are data only; none of their
player or layout stylesheets remain.

## 14. Known limitations

Console warnings in development (none occur in production builds, and each also
occurs on upstream `master`; reproduced there with the same backend):

| Warning | Origin | Reproduce |
| --- | --- | --- |
| `Invalid prop 'label' supplied to NullableBooleanInput` | upstream list filters with a heart-icon label (`PlaylistFilter`, album and artist filters) | open Albums, Artists or Playlists |
| `React does not recognize the hasList/hasEdit/hasShow/hasCreate prop` | upstream `PlaylistEdit` forwards react-admin's props to `SimpleForm` | open a playlist's edit form |
| `out-of-range value 'it' for the select (name="language")` | upstream `SelectLanguage` renders before the translation list loads | choose a non-English language, reload, open Settings |
| `SyntaxError: expected property name, got '{'` (×2 at load) | `ui/index.html` holds Go template placeholders (`{{ .AppConfig }}`) that only the Go server substitutes | start `vite` alone |
| `Could not load user libraries …` | upstream `LibrarySelector` logs when its library request fails right after sign-in | sign in on a fresh browser profile |

Other limits: the nine light legacy themes are not supported (Lyvune is used);
languages other than English and Italian fall back to English for the new `ui.*`
strings.
