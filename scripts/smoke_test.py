#!/usr/bin/env python3
"""Smoke test for a running Lyvune server. Python 3 and nothing else (no curl, no jq, no ffmpeg).

    smoke_test.py library DIR
        write a small test library into DIR: three silent .wav files with tags, two of them with a
        synced .lrc next to them

    smoke_test.py check URL [--user NAME --password SECRET] [--sidecars rw|ro] [--songs N]
        run the checks against the server at URL. A server with no users gets an administrator
        created (NAME / SECRET); one that has users is signed in to with the same credentials.
        --sidecars says what to expect from saving lyrics next to the music: rw = it works,
        ro = it is refused with a "read-only" answer and nothing is written.

It exits with 0 when every check passed. It is what scripts/docker-smoke-test.sh runs against a container,
and it can be run against any server: it only reads, except for the administrator it may create and one
lyrics import into the test library.
"""

import argparse
import json
import os
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

FIXTURES = [
    # folder, file, title, artist, album, track, synced lyrics (None for no .lrc)
    (
        "Test Artist/Test Album",
        "01 First Song",
        "First Song",
        "Test Artist",
        "Test Album",
        1,
        ["[00:01.00]Hello from the first song", "[00:05.00]This is the second line", "[00:09.00]And the third"],
    ),
    ("Test Artist/Test Album", "02 Second Song", "Second Song", "Test Artist", "Test Album", 2, None),
    (
        "Japanese Artist/Japanese Album",
        "01 Japanese Song",
        "Japanese Song",
        "Japanese Artist",
        "Japanese Album",
        1,
        ["[00:01.00]どうしようもなかったから", "[00:05.00]今すぐ君に会いたい。", "[00:09.00]ありがとう"],
    ),
]


def chunk(ident, payload):
    pad = b"\0" if len(payload) % 2 else b""
    return ident + struct.pack("<I", len(payload)) + payload + pad


def write_wav(path, title, artist, album, track, seconds=24, rate=8000):
    """A silent 8-bit mono WAV file with RIFF INFO tags (title, artist, album, track)."""
    fmt = struct.pack("<HHIIHH", 1, 1, rate, rate, 1, 8)
    info = b"INFO" + b"".join(
        chunk(k.encode(), v.encode("utf-8") + b"\0")
        for k, v in (("INAM", title), ("IART", artist), ("IPRD", album), ("ITRK", str(track)))
    )
    body = b"WAVE" + chunk(b"fmt ", fmt) + chunk(b"LIST", info) + chunk(b"data", b"\x80" * (rate * seconds))
    with open(path, "wb") as f:
        f.write(b"RIFF" + struct.pack("<I", len(body)) + body)


def make_library(root):
    for folder, name, title, artist, album, track, lrc in FIXTURES:
        directory = os.path.join(root, folder)
        os.makedirs(directory, exist_ok=True)
        write_wav(os.path.join(directory, name + ".wav"), title, artist, album, track)
        if lrc:
            with open(os.path.join(directory, name + ".lrc"), "w", encoding="utf-8") as f:
                f.write("\n".join(lrc) + "\n")
    print(f"wrote {len(FIXTURES)} songs to {root}")


class Server:
    def __init__(self, base):
        self.base = base.rstrip("/")
        self.token = None
        self.user = None
        self.password = None

    def request(self, path, method="GET", body=None, headers=None, timeout=30):
        data = None
        headers = dict(headers or {})
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        if self.token:
            headers.setdefault("X-ND-Authorization", "Bearer " + self.token)
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.status, resp.headers, resp.read()
        except urllib.error.HTTPError as e:
            return e.code, e.headers, e.read()

    def json(self, path, **kw):
        status, _, raw = self.request(path, **kw)
        try:
            return status, json.loads(raw or b"null")
        except ValueError:
            return status, None

    def subsonic(self, endpoint, **params):
        q = {"u": self.user, "p": self.password, "v": "1.16.1", "c": "smoke-test", "f": "json", **params}
        status, data = self.json("/rest/" + endpoint + "?" + urllib.parse.urlencode(q))
        return status, (data or {}).get("subsonic-response", {})


results = []


def check(name, fn):
    try:
        outcome = fn()
        ok, detail = (outcome, "") if isinstance(outcome, bool) else (bool(outcome[0]), outcome[1])
    except Exception as e:  # a check that cannot even run is a failed check
        ok, detail = False, f"{type(e).__name__}: {e}"
    results.append(ok)
    print(("PASS  " if ok else "FAIL  ") + name + (f"  ({detail})" if detail else ""))
    return ok


def run_checks(args):
    s = Server(args.url)
    s.user, s.password = args.user, args.password

    check("the server answers /ping", lambda: s.request("/ping")[0] == 200)

    def ui():
        status, _, body = s.request("/app/")
        html = body.decode("utf-8", "replace")
        return status == 200 and "<title>Lyvune" in html and "<script" in html, f"HTTP {status}"

    check("the web interface is served and says Lyvune", ui)

    def asset(path, magic):
        def run():
            status, _, body = s.request(path)
            return status == 200 and body.startswith(magic), f"HTTP {status}, {len(body)} bytes"

        return run

    check("the logo and icons are served", asset("/app/favicon-32x32.png", b"\x89PNG"))
    check("the app icon for phones is served", asset("/app/apple-touch-icon.png", b"\x89PNG"))
    check("the Japanese dictionary (romanization) is served", asset("/app/kuromoji-dict/base.dat.gz", b"\x1f\x8b"))
    check("its licence notice is served with it", asset("/app/kuromoji-dict/NOTICE.md", b"Library dependencies"))

    def sign_in():
        status, data = s.json("/auth/createAdmin", method="POST", body={"username": args.user, "password": args.password})
        verb = "created"
        if status != 200 or not data or not data.get("token"):
            status, data = s.json("/auth/login", method="POST", body={"username": args.user, "password": args.password})
            verb = "signed in"
        if status == 200 and data and data.get("token"):
            s.token = data["token"]
            return True, f"administrator {verb}"
        return False, f"HTTP {status}"

    if not check("an administrator can be created or signed in", sign_in):
        return finish()

    def subsonic_ping():
        status, r = s.subsonic("ping")
        return (
            status == 200 and r.get("status") == "ok" and r.get("openSubsonic") is True and r.get("type") == "navidrome",
            f"status={r.get('status')} type={r.get('type')} openSubsonic={r.get('openSubsonic')}",
        )

    check("the Subsonic API answers, as a server Subsonic clients know (type navidrome)", subsonic_ping)

    def extensions():
        _, r = s.subsonic("getOpenSubsonicExtensions")
        names = [e["name"] for e in r.get("openSubsonicExtensions", [])]
        return "songLyrics" in names, ", ".join(names)

    check("OpenSubsonic offers songLyrics", extensions)

    def scan():
        s.subsonic("startScan", fullScan="true")
        deadline = time.time() + 90
        while time.time() < deadline:
            time.sleep(1)
            _, r = s.subsonic("getScanStatus")
            st = r.get("scanStatus", {})
            if not st.get("scanning") and st.get("count", 0) >= args.songs:
                return True, f"{st['count']} files"
        return False, "the scan did not finish with the test songs in 90 s"

    if not check("the library is scanned", scan):
        return finish()

    songs = {}

    def search():
        _, r = s.subsonic("search3", query="", songCount="50")
        for song in r.get("searchResult3", {}).get("song", []):
            songs[song["title"]] = song["id"]
        return len(songs) >= args.songs, ", ".join(sorted(songs))

    check("the songs are found, with their tags", search)

    def stream():
        sid = songs.get("First Song")
        status, headers, body = s.request("/rest/stream?" + urllib.parse.urlencode(
            {"u": args.user, "p": args.password, "v": "1.16.1", "c": "smoke-test", "id": sid}))
        return status == 200 and len(body) > 1000 and body[:4] == b"RIFF", f"HTTP {status}, {len(body)} bytes, {headers.get('Content-Type')}"

    check("a song streams (real audio bytes)", stream)

    def lyrics(title, first):
        def run():
            _, r = s.subsonic("getLyricsBySongId", id=songs.get(title, ""), enhanced="true")
            lists = r.get("lyricsList", {}).get("structuredLyrics", [])
            lines = [l.get("value", "") for sl in lists for l in sl.get("line", [])]
            return bool(lines) and lines[0] == first, f"{len(lines)} lines"

        return run

    check("synced lyrics next to a song are served (OpenSubsonic)", lyrics("First Song", "Hello from the first song"))
    check("so are Japanese lyrics (the romanization input)", lyrics("Japanese Song", "どうしようもなかったから"))

    def native_lyrics():
        status, data = s.json("/api/lyrics/song/" + songs.get("First Song", ""))
        cur = (data or {}).get("current") or {}
        return status == 200 and cur.get("source") == "sidecar", f"source={cur.get('source')}"

    check("the lyrics engine reports where they come from", native_lyrics)

    sid = songs.get("Second Song", "")
    body = {"fileName": "second.lrc", "content": "[00:01.00]Saved for the test\n[00:05.00]Second line\n", "confirm": True}
    if args.sidecars == "rw":

        def save():
            status, data = s.json("/api/lyrics/song/" + sid + "/import", method="POST", body=body)
            cur = ((data or {}).get("status") or {}).get("current") or {}
            return status == 200 and cur.get("source") == "user", f"HTTP {status}, source={cur.get('source')}"

        check("lyrics are saved next to the music (writable library)", save)
        if args.music_dir:
            path = os.path.join(args.music_dir, "Test Artist/Test Album/02 Second Song.lyrics.json")
            check("and the sidecar file is there", lambda: (os.path.isfile(path), path))
    elif args.sidecars == "ro":

        def refused():
            status, data = s.json("/api/lyrics/song/" + sid + "/import", method="POST", body=body)
            return status == 422 and (data or {}).get("error") == "read-only", f"HTTP {status}, {(data or {}).get('error')}"

        check("saving lyrics is refused, not silently dropped (read-only library)", refused)
        if args.music_dir:
            names = [n for _, _, fs in os.walk(args.music_dir) for n in fs if n.endswith(".lyrics.json")]
            check("and nothing was written to the library", lambda: (not names, ", ".join(names)))

    return finish()


def finish():
    failed = results.count(False)
    print(f"\n{len(results) - failed} passed, {failed} failed")
    return 1 if failed else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    lib = sub.add_parser("library", help="write the test library")
    lib.add_argument("dir")
    chk = sub.add_parser("check", help="run the checks against a server")
    chk.add_argument("url")
    chk.add_argument("--user", default="smoke")
    chk.add_argument("--password", default="smoke-test-password")
    chk.add_argument("--sidecars", choices=["rw", "ro", "skip"], default="skip")
    chk.add_argument("--music-dir", help="the library folder on this machine, to look for the sidecar file")
    chk.add_argument("--songs", type=int, default=len(FIXTURES))
    args = parser.parse_args()
    if args.command == "library":
        make_library(args.dir)
        return 0
    return run_checks(args)


if __name__ == "__main__":
    sys.exit(main())
