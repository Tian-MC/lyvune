# Running Lyvune with Docker

This guide takes you from nothing to a working Lyvune in a container, keeps your music and your data safe, and
covers the questions that come next: permissions, a reverse proxy, backups, updates, coming from Navidrome.

> **The alpha is out, and its image is published:** `ghcr.io/tian-mc/lyvune:0.1.0-alpha.5`, for `amd64` and `arm64`.
> It is an alpha, so read the [release notes](https://github.com/Tian-MC/lyvune/releases/tag/v0.1.0-alpha.5) for what to expect. You can also
> [build the image yourself](#build-it-from-source-instead). See [Images](#images) for the tags.

## What you need

- A recent Docker Engine (24 or newer) with the Compose plugin (`docker compose version` should work). The **Buildx
  plugin** (`docker buildx version`) is needed only to build the image yourself, or to inspect a published image with
  `docker buildx imagetools inspect`: without Buildx, Docker uses its legacy builder, which cannot read the Dockerfile.
  On Arch Linux: `sudo pacman -S docker-buildx docker-compose`.
- A computer with 64-bit Intel/AMD (`amd64`) or ARM (`arm64`) processors.
- A folder with your music.
- Disk space for the image, and for the database and cache, which grow with your library.

## Quick start

```sh
git clone --branch v0.1.0-alpha.5 https://github.com/Tian-MC/lyvune.git
cd lyvune
cp .env.example .env
```

Open `.env`, change the `LYVUNE_MUSIC_DIR` line to your music folder and add a `LYVUNE_IMAGE` line, so that Compose runs
the published image:

```env
LYVUNE_MUSIC_DIR=/srv/music
LYVUNE_IMAGE=ghcr.io/tian-mc/lyvune:0.1.0-alpha.5
```

Then:

```sh
docker compose pull
docker compose up -d --no-build
```

`--no-build` makes sure nothing is built on your computer: the image you pulled is the one that runs. Open
<http://localhost:4533>. The first person to open Lyvune creates the administrator account. Lyvune then scans your
library and the music appears. There is no `latest` tag: always name the version.

Useful commands:

```sh
docker compose ps                  # is it running, and is it "healthy"?
docker compose logs -f lyvune      # what it is doing
docker compose stop                # stop it; your data stays
docker compose down                # remove the container; your data stays (it is in a volume)
```

## Build it from source instead

Leave `LYVUNE_IMAGE` out of `.env` and Compose builds the image from the repository you cloned, as `lyvune:local`. Use
`git clone https://github.com/Tian-MC/lyvune.git` (the development branch) or the tag you want, and:

```sh
docker compose up -d --build
```

The first build takes a few minutes and needs the Buildx plugin (see above).

## What the Compose file does

`compose.yaml` runs one service, `lyvune`:

| | |
| --- | --- |
| Image | the one `LYVUNE_IMAGE` names; with nothing set, built from this repository as `lyvune:local` |
| Port | `4533` on your computer (`LYVUNE_PORT` changes it) |
| `/data` | Lyvune's database, cache, backups and the history of replaced lyrics. A Docker volume named `lyvune-data` unless `LYVUNE_DATA` says otherwise |
| `/music` | your music, mounted **read-only** |
| User | `1000:1000` (`LYVUNE_USER` changes it). Never root |
| Safety | no extra privileges (`cap_drop: ALL`, `no-new-privileges`), no access to the Docker socket, logs rotated at 10 MB |
| Health | Docker runs `lyvune healthcheck` every 30 seconds; `docker compose ps` shows `healthy` |

The settings in `.env`:

| Variable | Meaning | Default |
| --- | --- | --- |
| `LYVUNE_MUSIC_DIR` | your music folder on this computer | **required** |
| `LYVUNE_DATA` | a folder to keep the data in, instead of a Docker volume | the `lyvune-data` volume |
| `LYVUNE_PORT` | the port on this computer | `4533` |
| `LYVUNE_USER` | `uid:gid` the server runs as | `1000:1000` |
| `TZ` | time zone, for the scan schedule and log times | `UTC` |
| `LYVUNE_IMAGE` | the image to run, for example `ghcr.io/tian-mc/lyvune:0.1.0-alpha.5` | `lyvune:local`, built here |

Everything else Lyvune can be told is an `ND_` environment variable, exactly as in Navidrome (`ND_LOGLEVEL`,
`ND_BASEURL`, `ND_SCANNER_SCHEDULE`, ...), or a line in `lyvune.toml` in the data folder. Add them under
`environment:` in `compose.yaml`.

## Your music and lyrics

Lyvune can save the lyrics it finds as a small file next to the song (`Song.lyrics.json`), so they work offline and
survive a restart. It never changes your audio files or their tags. That means it needs to **write** to the music
folder, and the Compose file mounts it read-only to be on the safe side. You choose:

**Read-only (the default).** Lyvune cannot change your music folder at all. Everything works, including the lyrics
that are already there next to your songs (`.lrc` files, lyrics inside the files) and lyrics you import. What it
cannot do is *save* lyrics it downloads: automatic retrieval reports that the library cannot be written to, and in
the lyrics manager the result can only be shown for the moment ("Show only"), not kept. Nothing is dropped silently:
the answer is `read-only`.

**Writable.** Lyvune saves lyrics next to the songs, the folder gets `.lyrics.json` files, and nothing else is
written there:

```sh
docker compose -f compose.yaml -f compose.sidecars.yaml up -d
```

The user the container runs as needs write permission on the music folder, see [Permissions](#permissions). If you
use this every time, you can add `COMPOSE_FILE=compose.yaml:compose.sidecars.yaml` to `.env`.

There is no setting that keeps the lyrics files somewhere other than next to the songs. The earlier versions of what
you replace, and a history to restore them from, are kept in `/data/lyrics-history`, which is always writable.

## Permissions

Lyvune runs as an ordinary user (`1000:1000`) inside the container, not root. Two folders matter:

**The data folder.** With the default volume there is nothing to do: the volume starts owned by that user. If you
prefer a folder of your own (easier to back up), create it first and give it to the user the container runs as:

```sh
mkdir -p /srv/lyvune
sudo chown 1000:1000 /srv/lyvune     # or your own user, see below
# .env:  LYVUNE_DATA=/srv/lyvune
```

If Docker creates the folder for you, it creates it as root and Lyvune cannot write to it.

**The music folder.** Reading needs nothing special beyond the files being readable by that user. Writing (only if
you chose the writable setup) needs the user to own, or have group write access to, the folders. Lyvune never changes
owners or permissions in your library, and this guide does not ask you to.

**Using your own user.** `id -u` and `id -g` show your numbers. Put them in `.env`, for example
`LYVUNE_USER=1001:1001`, and make the data folder yours. Changing the user while keeping the default volume leaves
Lyvune unable to write to it, so combine the two.

**NAS and network shares.** The user ids are those of the machine running Docker. On a NAS, use the id of the NAS
account that owns the shared folders and set `LYVUNE_USER` to it. A share that does not allow the owner to change
permissions is fine: Lyvune does not try to.

**Something is wrong with permissions when** the container restarts again and again and the log says
`Database could not be opened! ... unable to open database file`. That message is what Lyvune says when it cannot
write to the data folder, whatever the real reason. Check who owns it (`ls -ld /srv/lyvune`) against `LYVUNE_USER`.

## Open it from outside: a reverse proxy

Lyvune speaks plain HTTP on port 4533. To reach it from the internet or under a name with HTTPS, put a reverse proxy
in front. If the proxy runs on the same machine, set `LYVUNE_PORT=127.0.0.1:4533` in `.env`, so that only that
machine can reach Lyvune directly.

Caddy:

```
music.example.com {
    reverse_proxy lyvune:4533
}
```

nginx:

```
location / {
    proxy_pass http://127.0.0.1:4533;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
}
```

- **Under a path** (`https://example.com/music`): set `ND_BASEURL=/music` and proxy that path to Lyvune.
- **The client's real address.** Lyvune only believes `X-Forwarded-For` from addresses you list in
  `ND_EXTAUTH_TRUSTEDSOURCES`, for example the Docker network range of the proxy. Be careful: that list also lets those
  addresses sign users in through a `Remote-User` header, so list only a proxy you control.
- **Streaming and long requests** work best with response buffering off, as in the nginx example.

## Your data, backups and restoring

Everything Lyvune keeps is in `/data`:

| | |
| --- | --- |
| `lyvune.db` (or `navidrome.db` if you came from Navidrome) | users, playlists, play counts, settings |
| `cache/` | transcoded audio and resized artwork; it can be deleted |
| `lyrics-history/` | the versions of lyrics you replaced, to restore from the lyrics manager |
| `backups/` | database backups made by `lyvune backup` |
| `lyvune.toml` | your settings, if you made one |

**Make a backup now:**

```sh
docker compose exec lyvune lyvune backup create
```

The file appears in `/data/backups`. Copy it somewhere else too; a backup next to the data is not a backup of the disk.
To make them regularly and keep the last seven, add to `environment:`:

```yaml
ND_BACKUP_SCHEDULE: "0 3 * * *"     # every night at 3
ND_BACKUP_COUNT: "7"
```

**Back up the whole data folder.** Stop Lyvune first so the database is not changing:

```sh
docker compose stop
# with the default volume:
docker run --rm -v lyvune_lyvune-data:/data -v "$PWD":/backup alpine tar czf /backup/lyvune-data.tar.gz -C /data .
# with LYVUNE_DATA=/srv/lyvune, simply copy that folder
docker compose start
```

**Restore a database backup.** This must be done with Lyvune stopped:

```sh
docker compose stop
docker compose run --rm lyvune backup restore -b lyvune_backup_2026.10.25_03.00.00.db
docker compose start
```

A name without a folder is looked for in `/data/backups`. It asks for confirmation; `-f` skips that.

**Check the database** at any time with `docker compose exec lyvune lyvune doctor`. It only reads.

## Updating, and going back

```sh
docker compose exec lyvune lyvune backup create        # first, a backup
# in .env, set LYVUNE_IMAGE to the new version (note the old one: it is how you go back), then:
docker compose pull
docker compose up -d --no-build                        # new image, same data
```

If you build from source instead: `docker tag lyvune:local lyvune:previous` to keep the image you have, `git pull`, and
`docker compose up -d --build`.

Going back: a new version may change the database, and running the old version on it is not safe.
To go back, restore the backup you made first (above) and run the old image:

```sh
docker compose stop
docker compose run --rm lyvune backup restore -b <the backup from before the update>
# in .env, set LYVUNE_IMAGE back to the old version (with a source build: lyvune:previous), then:
docker compose up -d --no-build
```

## Coming from Navidrome

Lyvune reads what Navidrome wrote, so you do not export or convert anything. It keeps these names on purpose:
`navidrome.toml` is read when there is no `lyvune.toml`, the environment variables still start with `ND_`, an
existing `navidrome.db` is used as it is (a new installation creates `lyvune.db`), old `navidrome_backup_*.db` files
are still listed and pruned, saved lyrics files keep their format, and Subsonic apps keep working, because Lyvune
still tells them it is a `navidrome` server.

1. **Stop Navidrome.** Two servers must never open the same database.
2. **Copy, do not move.** Make a copy of Navidrome's data folder (it holds `navidrome.db`, and with it
   `navidrome.db-wal` and `navidrome.db-shm` if they exist, plus `navidrome.toml` if you have one):
   ```sh
   cp -a /path/to/navidrome/data /srv/lyvune
   ```
3. **Give it to the user Lyvune runs as.** Navidrome's image runs as root, so its files may belong to root:
   ```sh
   sudo chown -R 1000:1000 /srv/lyvune        # or the LYVUNE_USER you chose
   ```
4. In `.env`: `LYVUNE_MUSIC_DIR` is the same music folder Navidrome used and `LYVUNE_DATA=/srv/lyvune`. Bring your
   `ND_` variables across under `environment:`.
5. `docker compose pull && docker compose up -d --no-build`, with `LYVUNE_IMAGE` set as in the quick start. Sign in with your Navidrome account.

Lyvune updates the database to its own version the first time it opens it. **Count on that being one-way**, so
Navidrome should not be pointed at it again: keep the folder you copied from untouched, and going back is starting Navidrome on
that. A folder with `navidrome.db` that you keep using stays `navidrome.db`; nothing is renamed.

## Troubleshooting

| What you see | What it means | What to do |
| --- | --- | --- |
| `docker compose` says `Set LYVUNE_MUSIC_DIR in .env ...` | the music folder is not set | edit `.env` |
| The container restarts, log says `Database could not be opened` | Lyvune cannot write to `/data` | [Permissions](#permissions) |
| `docker compose ps` says `unhealthy` | the process runs but the server does not answer | `docker compose logs lyvune`; `docker compose exec lyvune lyvune healthcheck` prints the reason |
| `failed to parse platform : "" is an invalid OS component` while building | the legacy builder is being used: the Buildx plugin is missing | install it (see Requirements), then build again |
| `port is already allocated` | something uses 4533 | set `LYVUNE_PORT` |
| The library is empty | the folder is empty or not readable by the user | `docker compose exec lyvune ls /music`; check the path in `.env` and the permissions |
| Lyrics are not saved, the lyrics manager says the folder cannot be written to | the music folder is read-only | [Your music and lyrics](#your-music-and-lyrics) |
| Times in the log are off | no time zone | set `TZ` in `.env` |
| The page loads but sign-in loops behind a proxy | the proxy does not pass `Host` or the scheme | use the examples above; under a path set `ND_BASEURL` |
| It is slow to start with a big library | the first scan | the web interface works meanwhile; watch `docker compose logs -f lyvune` |

To see everything Lyvune is doing, set `LYVUNE_LOGLEVEL=debug` in `.env` and `docker compose up -d`.

## Privacy: what leaves your machine

Lyvune sends no usage statistics. The anonymous "insights" report that Navidrome has is **off** by default, and the
sign-in page uses a plain background instead of fetching one from navidrome.org. Turning either on again is your
choice (`ND_ENABLEINSIGHTSCOLLECTOR=true`, `ND_UILOGINBACKGROUNDURL=/backgrounds`).

By default Lyvune still asks other services for things you ask it for: lyrics providers (LRCLIB, KuGou, NetEase, QQ
Music) when it looks for lyrics, and Deezer for artist information. `ND_ENABLEEXTERNALSERVICES=false` turns all of
that off; Lyvune then contacts no other host. The lyrics providers can also be switched off one by one in Settings.

## Images

| Image | What it is |
| --- | --- |
| `ghcr.io/tian-mc/lyvune:0.1.0-alpha.5` | **published**: the image of [v0.1.0-alpha.5](https://github.com/Tian-MC/lyvune/releases/tag/v0.1.0-alpha.5), for `linux/amd64` and `linux/arm64`. Its digest is in the release notes |
| `ghcr.io/tian-mc/lyvune:0.1.0-alpha.4` | **published**: the image of [v0.1.0-alpha.4](https://github.com/Tian-MC/lyvune/releases/tag/v0.1.0-alpha.4), for `linux/amd64` and `linux/arm64`. Its digest is in the release notes |
| `ghcr.io/tian-mc/lyvune:0.1.0-alpha.3` | **published**: the image of [v0.1.0-alpha.3](https://github.com/Tian-MC/lyvune/releases/tag/v0.1.0-alpha.3), for `linux/amd64` and `linux/arm64`. Its digest is in the release notes |
| `ghcr.io/tian-mc/lyvune:0.1.0-alpha.2` | **published**: the image of [v0.1.0-alpha.2](https://github.com/Tian-MC/lyvune/releases/tag/v0.1.0-alpha.2), for `linux/amd64` and `linux/arm64`. Its digest is in the release notes |
| `ghcr.io/tian-mc/lyvune:0.1.0-alpha.1` | **published**: the image of [v0.1.0-alpha.1](https://github.com/Tian-MC/lyvune/releases/tag/v0.1.0-alpha.1), for `linux/amd64` and `linux/arm64`. Its digest is `sha256:9faa644f6a3f805c201a765bd145048005e60764f23da5fcd4af1811c1d8511c`. Each release is exactly one tag, and **there is no `latest`**. See [RELEASING.md](RELEASING.md) |
| `lyvune:local` | what `docker compose up --build` builds from your copy of the repository when `LYVUNE_IMAGE` is not set. Yours to keep or rebuild |

The image is built for two platforms, `linux/amd64` and `linux/arm64` (Raspberry Pi 4 and 5, many NAS), and Docker picks
the right one. What was actually run on each is in [Tested on](RELEASING.md#tested-on). To build for another platform than yours, `docker buildx build --platform linux/arm64 -t lyvune:arm64 .`

## Building and testing it yourself

```sh
docker build -t lyvune:local .                       # the image, without Compose
scripts/docker-smoke-test.sh                          # builds it and tests it end to end
scripts/docker-smoke-test.sh --image ghcr.io/tian-mc/lyvune:0.1.0-alpha.5   # tests the published image instead
python3 scripts/smoke_test.py check http://localhost:4533   # the same checks, against a server that is running
```

`scripts/docker-smoke-test.sh` checks first that Docker, Compose and Buildx are there and says what is missing. Run it as a
normal user who may use Docker; under `sudo` it still runs the containers as you, not as root. It starts containers on free ports with temporary folders and a generated music library,
and removes everything it made. It checks a new installation, a restart, a clean stop, a read-only library, a
migration from a copied `navidrome.db`, and an unwritable data folder.
