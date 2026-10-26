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

The data in `demo-library.json` and everything the script produces (the audio, the covers and the lyrics) are released
under **CC0 1.0**, a public domain dedication: <https://creativecommons.org/publicdomain/zero/1.0/>. They were made for
Lyvune by its maintainer with the help of an AI assistant (Claude), and nothing in them comes from anywhere else. The
script itself is part of Lyvune and under the GPL-3.0, like the rest of the repository.
