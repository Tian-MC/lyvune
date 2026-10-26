# Demo library

A small music library in which **every part is original**: the music, the cover art and the lyrics. Lyvune's screenshots
and demos use it, so they show nobody else's songs, covers or words.

## What is in it

- **12 albums by 10 artists, 38 short tracks.** The artists, albums and titles are invented, and any resemblance to a
  real name is a coincidence.
- **Music:** instrumental tracks made with a synthesiser written for this (chords, bass, an arpeggio, drums, and a
  lead). They are not recordings and use no samples. They are meant as material to show in a player, not as music to be
  judged.
- **Covers:** abstract shapes drawn by the script. There is no text on them and no font is involved.
- **Lyrics:** two songs have lyrics with word-by-word timing, `Paper Lanterns` (English) and `Midnight Pier` (Japanese).
  The words were written for this library. The lead melody follows the timing note by note. They are Lyvune
  `.lyrics.json` files, so the player shows the source as *Chosen by you*, which is what it is.

`demo-library.json` holds the data (artists, albums, tracks, tempos, keys and the lyrics); `make_demo_library.py` makes
the files.

## Make it

You need Python 3 with `numpy` and `Pillow`, and `ffmpeg` with the FLAC encoder:

```sh
python3 -m pip install numpy pillow
python3 scripts/demo-library/make_demo_library.py /tmp/demo-library      # about 40 seconds, 280 MB
```

It writes `Artist/Album/NN Title.flac` with tags, a `cover.png` per album, and a `.lyrics.json` next to each song with
lyrics. `--covers-only` draws only the covers. The synthesis is deterministic, so a second run gives the same sound.

## Use it for screenshots

Run Lyvune **apart from anything of yours**: its own empty data folder, the demo library as the music folder (read-only
is enough), another port, and no external services.

```sh
ND_MUSICFOLDER=/tmp/demo-library ND_DATAFOLDER="$(mktemp -d)" ND_PORT=14634 ND_ENABLEEXTERNALSERVICES=false ./lyvune
```

Create the first account in the browser, let the scan finish, and play a song. Never point a screenshot session at a
personal library or at a real database.

## Licence and provenance

**The demo content.** The data in `demo-library.json` and what the script makes from it (the synthesised audio, the covers
and the lyrics) is dedicated to the public domain by the maintainer under **CC0 1.0**
(<https://creativecommons.org/publicdomain/zero/1.0/>), **to the extent of the rights the maintainer holds in it**.

It was created for Lyvune, at the maintainer's request, with an AI assistant (Claude) writing the script, the music data
and the lyrics, and none of it is taken from anyone else's work. Whether copyright exists in material made this way
depends on the country: the dedication covers whatever rights the maintainer holds, and **claims none that do not
exist**. It claims no right over anything that belongs to someone else.

**Everything else stays as it was.** `make_demo_library.py` and the rest of the repository are under the **GPL-3.0**. The
screenshots in `docs/screenshots` show Lyvune's interface, which is part of the GPL-3.0 project, so only the demo content
shown in them is CC0. The tools used to make the library (Python, numpy, Pillow, ffmpeg) keep their own licences and are
not part of the dedication. Nothing here changes Lyvune's licence or the credits to Navidrome.
