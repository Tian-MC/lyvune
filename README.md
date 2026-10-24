# Navidrome Reimagined

A fork of [Navidrome](https://www.navidrome.org), the open source web-based music server and streamer, with a
rewritten web interface.

Only the frontend in `ui/` was rebuilt. The Go backend, the REST and Subsonic APIs, authentication, the database,
library scanning and streaming are the upstream code, so existing Subsonic clients, configuration and data keep working.
The fork is based on upstream `master` at commit `ec2e0a9e`.

## What changed

- The shell, playback engine and views were rewritten. Audio is owned by a single `HTMLAudioElement` outside React
  (`ui/src/playback/engine.js`), so navigating never interrupts playback.
- react-admin is still used for the data layer and the administration screens.
- The previous player, layout, album/artist/playlist pages and the `navidrome-music-player`, `react-drag-listview`
  and `react-measure` dependencies were removed.
- Themes saved by existing users keep working. *Dark* and *Extra Dark* map to the new *Navidrome* and
  *Navidrome Black (OLED)* themes, other dark themes are applied as colour tints, and light themes fall back to
  Navidrome.
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
ND_MUSICFOLDER=/path/to/music ND_DATAFOLDER=/path/to/data ./navidrome
```

Navidrome only reads the music folder. Configuration options and installation methods other than building from
source are the same as upstream: see the [Navidrome documentation](https://www.navidrome.org/docs/).

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

This project follows [navidrome/navidrome](https://github.com/navidrome/navidrome). Bugs in the server, the APIs and
scanning belong there. See the [contributing guide](CONTRIBUTING.md) and the
[code of conduct](CODE_OF_CONDUCT.md).

## License

GNU General Public License v3.0, the same as upstream. See [LICENSE](LICENSE).
