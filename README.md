<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/transparent/logo-horizontal-for-dark-bg.svg">
    <img alt="Lyvune" src="docs/brand/transparent/logo-horizontal-for-light-bg.svg" width="420">
  </picture>
</p>

# Lyvune

Lyvune is an open source web-based music server and streamer, with a rewritten web interface, word-by-word karaoke
lyrics and a lyrics engine. It started as a fork of [Navidrome](https://www.navidrome.org) (previously *Navidrome
Reimagined*) and keeps its code, its license and its copyright notices.

The frontend in `ui/` was rebuilt, and the backend gained a lyrics engine. The REST and Subsonic APIs, authentication,
the database, library scanning and streaming are otherwise the upstream code, so existing Subsonic clients,
configuration and data keep working. The fork is based on upstream `master` at commit `ec2e0a9e`.

## Brand

The logos are in [`docs/brand`](docs/brand): the icon, the wordmark, the horizontal logo and the app icon, each in
dark, light and monochrome versions (SVG, and PNG for the transparent set), plus the small-size tests the favicons
come from.

## Screenshots

| | |
| --- | --- |
| ![Home](docs/screenshots/home.webp) | ![Albums](docs/screenshots/albums.webp) |
| Home: recently played and recently added | Albums |
| ![Album](docs/screenshots/album.webp) | ![Karaoke lyrics](docs/screenshots/lyrics.webp) |
| An album | Word-by-word karaoke lyrics, with the source shown below |
| ![Romanization](docs/screenshots/lyrics-romanization.webp) | ![Romanization with macrons](docs/screenshots/lyrics-romanization-macrons.webp) |
| Romanization above each line, with doubled vowels (`ou · aa`) | The same with macrons (`ō · ā`) |

On a phone the lyrics view keeps the same controls:

<p align="center"><img src="docs/screenshots/lyrics-mobile.webp" alt="Lyrics with romanization on a phone" width="260"></p>

## What changed

- The shell, playback engine and views were rewritten. Audio is owned by a single `HTMLAudioElement` outside React
  (`ui/src/playback/engine.js`), so navigating never interrupts playback.
- react-admin is still used for the data layer and the administration screens.
- The previous player, layout, album/artist/playlist pages and the `navidrome-music-player`, `react-drag-listview`
  and `react-measure` dependencies were removed.
- There are two themes: *Lyvune* and *Lyvune Black (OLED)*. A saved *Dark* or *Extra Dark* theme becomes one of them,
  and any other saved theme becomes *Lyvune*.
- A lyrics engine looks for missing lyrics online (LRCLIB, KuGou, NetEase, QQ Music and, with your own key,
  Musixmatch), prefers the files you already have, and lets you override, lock and undo. Word-by-word karaoke is
  shown when a source really has it. Found lyrics are saved next to the audio (`.lyrics.json`, offline, with word timing) according to a per-provider
  choice you control in Settings (LRCLIB on by default, the others off; no provider's terms on keeping lyrics could be
  verified, so this is your decision and not a permission), and results that are not saved are only shown while
  playing. It never modifies audio files. Automatic retrieval is on by default; see [LYRICS_ENGINE.md](LYRICS_ENGINE.md).
- Lyrics in Japanese, Chinese, Korean, Greek, Cyrillic or Arabic script can be romanized in the player with one
  button (made in the browser, only when switched on; approximate); see [LYRICS_ENGINE.md](LYRICS_ENGINE.md).
- The new interface text is translated to English and Italian. Other languages use English for it.

Design decisions, architecture and the status of the work are in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) and
[REDESIGN_FOUNDATION.md](REDESIGN_FOUNDATION.md).

## Requirements

- Go (the version in `go.mod`)
- Node.js (the version in `.nvmrc`) and npm

## Run it

Development, with hot reload for the frontend and the backend:

```sh
make setup   # install dependencies
make dev     # http://localhost:4533
```

Build and run a binary:

```sh
make build
ND_MUSICFOLDER=/path/to/music ND_DATAFOLDER=/path/to/data ./lyvune
```

Lyvune reads the music folder and only writes `.lyrics.json` lyrics files into it (see above). Configuration
options are the same as Navidrome's: see the [Navidrome documentation](https://www.navidrome.org/docs/).

**If you come from Navidrome**, nothing has to be migrated. The configuration file is `lyvune.toml`, and a
`navidrome.toml` in the same place is still read when there is no `lyvune.toml`. Environment variables keep their
`ND_` prefix. An existing `navidrome.db` is used as it is (a new installation creates `lyvune.db`), and old
`navidrome_backup_*.db` backups are still listed and pruned. The server still presents itself to Subsonic clients as
`navidrome`, because clients recognise it, and the features it has, by that name. Sidecar files keep the format name
`navidrome-lyrics`, so lyrics saved earlier still load.

## Privacy

Lyvune does not send usage statistics anywhere: the anonymous insights collector Navidrome has is **off by default**
(`EnableInsightsCollector`, `ND_ENABLEINSIGHTSCOLLECTOR`). Looking up lyrics asks the providers you enabled for the
tracks you play, and the login page may fetch a background image from navidrome.org (set `UILoginBackgroundURL` to
change it).

## Tests

```sh
cd ui
npm run lint
npm run check-formatting
npm run type-check
npm test
npm run build

cd ..
make test-i18n
```

## Upstream

Lyvune builds on [Navidrome](https://github.com/navidrome/navidrome), by Deluan Quintão and its contributors. Bugs
in the parts that come from it (the server, the APIs and scanning) may also belong there. See the
[contributing guide](CONTRIBUTING.md) and the [code of conduct](CODE_OF_CONDUCT.md).

## License

GNU General Public License v3.0, the same as upstream. See [LICENSE](LICENSE).
