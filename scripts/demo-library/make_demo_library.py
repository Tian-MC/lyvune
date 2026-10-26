#!/usr/bin/env python3
"""Builds Lyvune's demo library: a small music library whose every part is original, for screenshots and demos.

    python3 scripts/demo-library/make_demo_library.py OUT_DIR [--covers-only]

Nothing is sampled, downloaded or copied. The music is synthesised here (simple instrumental tracks in a key and a
tempo), the covers are drawn here (abstract shapes, no text), and the lyrics are written in demo-library.json, with a
word timing that this script derives from the tempo, and that the lead melody follows note by note. The tracks are
written as FLAC with tags, one folder per album with a cover.png, and a Lyvune .lyrics.json next to each song that has
lyrics. The artists, albums and titles are invented.

Needs Python 3, numpy and Pillow, and ffmpeg (with the flac encoder) on the PATH. The output is the same every time.
The data and what it produces are released under CC0 1.0; this script is part of Lyvune (GPL-3.0). See README.md.
"""

import argparse
import hashlib
import json
import math
import os
import random
import subprocess
import sys
import tempfile
import wave

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SR = 44100
COVER_PX = 900          # the size of cover.png
SS = 2                  # drawn at twice the size and scaled down, for smooth edges

# ------------------------------------------------------------------------------------------------ covers


def rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def vgrad(size, top, bottom):
    w, h = size
    t = np.linspace(0, 1, h)[:, None, None]
    arr = (np.array(top)[None, None, :] * (1 - t) + np.array(bottom)[None, None, :] * t)
    return Image.fromarray(np.repeat(arr, w, axis=1).astype("uint8"), "RGB").convert("RGBA")


def glow(base, xy, radius, color, strength=1.0):
    """A soft round light, blended on top of base."""
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x, y = xy
    d.ellipse([x - radius, y - radius, x + radius, y + radius], fill=color + (int(255 * strength),))
    layer = layer.filter(ImageFilter.GaussianBlur(radius * 0.55))
    return Image.alpha_composite(base, layer)


def paint_cover(motif, palette, seed):
    rnd = random.Random(seed)
    S = COVER_PX * SS
    pal = [rgb(c) for c in palette]
    c0, c1, c2, c3, c4 = pal
    img = vgrad((S, S), c0, c1)
    d = ImageDraw.Draw(img, "RGBA")

    if motif == "lanterns":
        img = vgrad((S, S), c0, mix(c1, c4, 0.25))
        for i in range(60):                                   # a few faint stars
            x, y = rnd.randrange(S), rnd.randrange(int(S * 0.45))
            ImageDraw.Draw(img, "RGBA").ellipse([x, y, x + 6 * SS // 2, y + 6 * SS // 2], fill=(255, 240, 220, rnd.randrange(60, 160)))
        for i in range(9):
            x = int(S * (0.12 + 0.76 * (i + rnd.random() * 0.4) / 9))
            y = int(S * (0.18 + 0.50 * rnd.random()))
            w = int(S * rnd.uniform(0.07, 0.11)); h = int(w * 1.25)
            col = pal[2 + i % 3]
            img = glow(img, (x, y + h // 2), int(w * 1.6), col, 0.55)
            d = ImageDraw.Draw(img, "RGBA")
            d.rounded_rectangle([x - w // 2, y, x + w // 2, y + h], radius=w // 3, fill=col + (255,))
            d.rectangle([x - w // 3, y - 8 * SS, x + w // 3, y], fill=mix(c0, c1, 0.5) + (255,))
            d.line([x, y - 8 * SS, x, y - 60 * SS], fill=mix(c0, c4, 0.4) + (200,), width=3 * SS)
            for k in (-1, 0, 1):
                d.line([x + k * w // 3, y + 6 * SS, x + k * w // 3, y + h - 6 * SS], fill=mix(col, c0, 0.45) + (140,), width=2 * SS)
        for j in range(14):                                   # the river
            yy = int(S * (0.78 + j * 0.016))
            d.line([0, yy, S, yy], fill=mix(c1, c3, j / 14) + (60 + j * 8,), width=2 * SS)
    elif motif == "halfmoon":
        img = Image.new("RGBA", (S, S), c0)
        d = ImageDraw.Draw(img, "RGBA")
        stripe = S // 12
        for i in range(12):
            d.rectangle([i * stripe, 0, (i + 1) * stripe, int(S * 0.22)], fill=(c1 if i % 2 == 0 else c0) + (255,))
        for i in range(12):
            d.pieslice([i * stripe, int(S * 0.14), (i + 1) * stripe, int(S * 0.30)], 0, 180, fill=(c1 if i % 2 == 0 else c0) + (255,))
        cx, cy, r = S // 2, int(S * 0.62), int(S * 0.27)
        d.pieslice([cx - r, cy - r, cx + r, cy + r], 180, 360, fill=c4 + (255,))
        d.pieslice([cx - r, cy - r, cx + r, cy + r], 0, 180, fill=c3 + (255,))
        for k in range(3):                                     # steam from the cup
            xs = cx - r // 2 + k * r // 2
            pts = [(xs + 22 * SS * math.sin(t / 7 + k), int(S * 0.36) - t * 4 * SS) for t in range(0, 46)]
            d.line(pts, fill=c3 + (200,), width=9 * SS, joint="curve")
    elif motif == "ferris":
        cx, cy, R = S // 2, int(S * 0.46), int(S * 0.33)
        img = glow(img, (cx, cy), int(R * 1.2), c1, 0.5)
        d = ImageDraw.Draw(img, "RGBA")
        d.ellipse([cx - R, cy - R, cx + R, cy + R], outline=c4 + (255,), width=8 * SS)
        d.ellipse([cx - R * 0.55, cy - R * 0.55, cx + R * 0.55, cy + R * 0.55], outline=c4 + (150,), width=4 * SS)
        for i in range(12):
            a = i * math.tau / 12
            d.line([cx, cy, cx + R * math.cos(a), cy + R * math.sin(a)], fill=c4 + (170,), width=4 * SS)
            px, py = cx + R * math.cos(a), cy + R * math.sin(a)
            col = pal[2 + i % 2 + (i % 3 == 0)]
            d.ellipse([px - 26 * SS, py - 26 * SS, px + 26 * SS, py + 26 * SS], fill=col + (255,))
        d.polygon([(cx, cy), (cx - R * 0.5, S * 0.96), (cx - R * 0.35, S * 0.96)], fill=c4 + (210,))
        d.polygon([(cx, cy), (cx + R * 0.5, S * 0.96), (cx + R * 0.35, S * 0.96)], fill=c4 + (210,))
        d.ellipse([cx - 22 * SS, cy - 22 * SS, cx + 22 * SS, cy + 22 * SS], fill=c2 + (255,))
    elif motif == "ferry":
        img = vgrad((S, S), c0, mix(c2, c3, 0.5))
        cx, cy, r = S // 2, int(S * 0.50), int(S * 0.27)
        img = glow(img, (cx, cy), int(r * 1.5), c3, 0.55)
        d = ImageDraw.Draw(img, "RGBA")
        sun = vgrad((r * 2, r * 2), c3, c2)
        m = Image.new("L", (r * 2, r * 2), 0)
        ImageDraw.Draw(m).ellipse([0, 0, r * 2 - 1, r * 2 - 1], fill=255)
        md = ImageDraw.Draw(m)
        for k in range(1, 8):                                  # slits in the sun
            y = int(r * (0.9 + k * 0.16))
            md.rectangle([0, y, r * 2, y + k * 3 * SS], fill=0)
        img.paste(sun, (cx - r, cy - r), m)
        d = ImageDraw.Draw(img, "RGBA")
        hor = int(S * 0.62)
        d.rectangle([0, hor, S, S], fill=mix(c0, (0, 0, 0), 0.4) + (255,))
        for k in range(-12, 13):
            d.line([cx + k * 20 * SS, hor, cx + k * 120 * SS, S], fill=c4 + (150,), width=2 * SS)
        for k in range(1, 9):
            y = hor + int((S - hor) * (k / 8) ** 1.8)
            d.line([0, y, S, y], fill=c2 + (170,), width=2 * SS)
        bx = int(S * 0.68)
        d.polygon([(bx, hor - 10 * SS), (bx + 150 * SS, hor - 10 * SS), (bx + 120 * SS, hor + 18 * SS), (bx + 20 * SS, hor + 18 * SS)], fill=(10, 6, 24, 255))
        d.rectangle([bx + 50 * SS, hor - 50 * SS, bx + 100 * SS, hor - 10 * SS], fill=(10, 6, 24, 255))
    elif motif == "contours":
        img = vgrad((S, S), c1, c0)
        d = ImageDraw.Draw(img, "RGBA")
        xs = np.linspace(0, S, 400)
        for k in range(26):
            yb = S * (0.06 + k * 0.036)
            ys = yb + S * 0.05 * np.sin(xs / S * 5.2 + k * 0.38) + S * 0.03 * np.sin(xs / S * 11 + k * 0.15)
            d.line(list(zip(xs, ys)), fill=mix(c2, c4, k / 26) + (150 + k * 4 if k < 20 else 255,), width=(4 if k % 5 == 0 else 2) * SS)
        d.ellipse([S * 0.66, S * 0.20, S * 0.70, S * 0.24], fill=c4 + (255,))
    elif motif == "spin":
        img = Image.new("RGBA", (S, S), c0)
        d = ImageDraw.Draw(img, "RGBA")
        cx, cy = int(S * 0.5), int(S * 0.5)
        for k in range(14, 0, -1):
            r = int(S * 0.036 * k * 1.15)
            ox = int(math.sin(k * 0.5) * S * 0.012 * k / 4)
            d.ellipse([cx + ox - r, cy - r, cx + ox + r, cy + r], fill=(c1 if k % 2 == 0 else c3) + (255,), outline=c4 + (200,), width=2 * SS)
        d.ellipse([cx - 60 * SS, cy - 60 * SS, cx + 60 * SS, cy + 60 * SS], fill=c2 + (255,))
        d.ellipse([cx - 22 * SS, cy - 22 * SS, cx + 22 * SS, cy + 22 * SS], fill=c0 + (255,))
    elif motif == "grid":
        img = Image.new("RGBA", (S, S), c0)
        d = ImageDraw.Draw(img, "RGBA")
        n = 10; cell = S // n
        for i in range(n + 1):
            d.line([i * cell, 0, i * cell, S], fill=c1 + (255,), width=2 * SS)
            d.line([0, i * cell, S, i * cell], fill=c1 + (255,), width=2 * SS)
        for i in range(n):
            for j in range(n):
                v = rnd.random()
                if v < 0.18:
                    d.rectangle([i * cell + 3, j * cell + 3, (i + 1) * cell - 3, (j + 1) * cell - 3], fill=(c2 if v < 0.11 else c3) + (255 if v < 0.11 else 230,))
                elif v < 0.4:
                    d.rectangle([i * cell + 12, j * cell + cell // 2 - 3, i * cell + 12 + int(cell * rnd.uniform(0.2, 0.6)), j * cell + cell // 2 + 3], fill=c4 + (150,))
        d.rectangle([cell * 3, cell * 4, cell * 6, cell * 5], outline=c2 + (255,), width=6 * SS)
    elif motif == "brass":                                     # a street lamp in the rain, and its reflection
        img = vgrad((S, S), c0, c1)
        hor = int(S * 0.74)
        lx, ly = int(S * 0.5), int(S * 0.30)
        img = glow(img, (lx, ly), int(S * 0.30), c3, 0.55)
        img = glow(img, (lx, hor + int(S * 0.10)), int(S * 0.22), c3, 0.25)
        d = ImageDraw.Draw(img, "RGBA")
        d.rectangle([0, hor, S, S], fill=mix(c0, (0, 0, 0), 0.35) + (255,))
        for k in range(1, 9):                                  # puddle ripples
            y = hor + int((S - hor) * (k / 9) ** 1.4)
            d.line([int(S * (0.5 - 0.05 * k)), y, int(S * (0.5 + 0.05 * k)), y], fill=c3 + (90 - k * 8,), width=3 * SS)
        d.rectangle([lx - 9 * SS, ly, lx + 9 * SS, hor], fill=mix(c0, c4, 0.25) + (255,))
        d.rectangle([lx - 24 * SS, hor - 16 * SS, lx + 24 * SS, hor], fill=mix(c0, c4, 0.25) + (255,))
        d.arc([lx - 70 * SS, ly - 60 * SS, lx + 70 * SS, ly + 80 * SS], 180, 360, fill=mix(c0, c4, 0.25) + (255,), width=10 * SS)
        d.polygon([(lx - 52 * SS, ly - 4 * SS), (lx + 52 * SS, ly - 4 * SS), (lx + 34 * SS, ly + 52 * SS), (lx - 34 * SS, ly + 52 * SS)], fill=c3 + (255,))
        d.rectangle([lx - 56 * SS, ly - 14 * SS, lx + 56 * SS, ly - 4 * SS], fill=mix(c0, c4, 0.25) + (255,))
        for k in range(120):                                   # rain
            x = rnd.randrange(-S // 4, S); y = rnd.randrange(0, S); l = rnd.randrange(60, 220)
            d.line([x, y, x - l * 0.25, y + l], fill=c4 + (rnd.randrange(28, 100),), width=2 * SS)
    elif motif == "bloom":
        img = vgrad((S, S), c0, mix(c0, c1, 0.5))
        for k in range(16):
            x, y = rnd.randrange(S), rnd.randrange(S)
            r = rnd.randrange(int(S * 0.08), int(S * 0.22))
            img = glow(img, (x, y), r, pal[1 + k % 4], rnd.uniform(0.28, 0.6))
        d = ImageDraw.Draw(img, "RGBA")
        for k in range(30):
            x, y, r = rnd.randrange(S), rnd.randrange(S), rnd.randrange(6, 26) * SS
            d.ellipse([x - r, y - r, x + r, y + r], outline=c4 + (rnd.randrange(80, 200),), width=2 * SS)
    elif motif == "field":
        img = vgrad((S, S), c3, c2)
        d = ImageDraw.Draw(img, "RGBA")
        hor = int(S * 0.34)
        d.ellipse([S * 0.62, S * 0.10, S * 0.74, S * 0.22], fill=c3 + (255,))
        d.rectangle([0, hor, S, S], fill=c1 + (255,))
        xs = np.linspace(0, S, 300)
        for k in range(14):
            yb = hor + (S - hor) * (k / 14) ** 1.5
            ys = yb + 18 * SS * np.sin(xs / S * 6 + k)
            col = mix(c1, c0, k / 14) if k % 2 == 0 else mix(c2, c1, 0.4 + k / 40)
            d.polygon(list(zip(xs, ys)) + [(S, S), (0, S)], fill=col + (255,))
        for k in range(60):
            x = rnd.randrange(S); y = rnd.randrange(int(S * 0.5), S)
            d.line([x, y, x + rnd.randrange(-14, 14) * SS, y - 36 * SS], fill=c4 + (200,), width=3 * SS)
    elif motif == "tide":
        img = vgrad((S, S), c4, c2)
        d = ImageDraw.Draw(img, "RGBA")
        xs = np.linspace(0, S, 400)
        for k in range(9):
            yb = S * (0.28 + k * 0.085)
            ys = yb + S * 0.035 * np.sin(xs / S * (3.5 + k * 0.6) + k * 1.3)
            d.polygon(list(zip(xs, ys)) + [(S, S), (0, S)], fill=mix(c3, c0, k / 8) + (255,))
        d.ellipse([S * 0.68, S * 0.12, S * 0.84, S * 0.28], fill=c4 + (255,))
        img = glow(img, (int(S * 0.76), int(S * 0.20)), int(S * 0.20), c4, 0.35)
    elif motif == "platform":
        img = vgrad((S, S), c1, c0)
        d = ImageDraw.Draw(img, "RGBA")
        vx, vy = int(S * 0.5), int(S * 0.44)
        img = glow(img, (vx, vy), int(S * 0.20), c3, 0.75)
        d = ImageDraw.Draw(img, "RGBA")
        for x0 in (-S * 0.1, S * 0.2, S * 0.8, S * 1.1):
            d.line([vx, vy, x0, S], fill=c2 + (255,), width=10 * SS)
        for k in range(1, 18):
            t = (k / 18) ** 1.9
            y = vy + (S - vy) * t
            xl = vx + (S * 0.2 - vx) * t; xr = vx + (S * 0.8 - vx) * t
            d.line([xl - 40 * SS * t * 4, y, xr + 40 * SS * t * 4, y], fill=mix(c2, c0, 0.5) + (255,), width=max(2, int(8 * SS * t)))
        d.ellipse([vx - 18 * SS, vy - 18 * SS, vx + 18 * SS, vy + 18 * SS], fill=c4 + (255,))
        d.rectangle([0, 0, S, int(S * 0.05)], fill=c0 + (255,))

    out = img.convert("RGB").resize((COVER_PX, COVER_PX), Image.LANCZOS)
    return out


# ------------------------------------------------------------------------------------------------ music

NOTE = {"C": 0, "C#": 1, "Db": 1, "D": 2, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "Ab": 8, "A": 9, "Bb": 10, "B": 11}
SCALES = {"major": [0, 2, 4, 5, 7, 9, 11], "minor": [0, 2, 3, 5, 7, 8, 10]}
PROG = {"major": [0, 4, 5, 3], "minor": [0, 5, 2, 6]}
# per style: drums, arpeggio notes per beat, pad level, lead timbre, echo
STYLES = {
    "pop": dict(drums="four", arp=2, pad=0.55, lead="bell", echo=0.30, bass=0.8),
    "soft": dict(drums="soft", arp=1, pad=0.65, lead="pluck", echo=0.28, bass=0.7),
    "synth": dict(drums="four", arp=2, pad=0.75, lead="saw", echo=0.38, bass=0.9),
    "ambient": dict(drums="none", arp=0.5, pad=1.0, lead="bell", echo=0.5, bass=0.5),
    "electro": dict(drums="four", arp=4, pad=0.35, lead="saw", echo=0.25, bass=1.0),
    "lofi": dict(drums="swing", arp=1, pad=0.8, lead="pluck", echo=0.3, bass=0.8),
    "jazz": dict(drums="swing", arp=1, pad=0.7, lead="pluck", echo=0.22, bass=0.9),
    "dream": dict(drums="soft", arp=2, pad=1.0, lead="bell", echo=0.5, bass=0.7),
    "rock": dict(drums="four", arp=2, pad=0.6, lead="saw", echo=0.25, bass=1.0),
}


def freq(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def adsr(n, a, d, s, r):
    e = np.ones(n)
    na, nd, nr = int(a * SR), int(d * SR), int(r * SR)
    na = min(na, n); nd = min(nd, max(0, n - na)); nr = min(nr, n)
    if na: e[:na] = np.linspace(0, 1, na)
    if nd: e[na:na + nd] = np.linspace(1, s, nd)
    e[na + nd:] = s
    if nr: e[n - nr:] *= np.linspace(1, 0, nr)
    return e


def osc(f, n, kind, rnd=None, vib=0.0):
    t = np.arange(n) / SR
    ph = 2 * np.pi * f * t
    if vib:
        ph = ph + vib * np.sin(2 * np.pi * 5.2 * t) * (t / (t[-1] + 1e-9))
    if kind == "sine":
        return np.sin(ph)
    if kind == "tri":
        return (2 / np.pi) * np.arcsin(np.sin(ph))
    if kind == "bell":
        return np.sin(ph) + 0.35 * np.sin(2 * ph) * np.exp(-t * 5) + 0.18 * np.sin(3.01 * ph) * np.exp(-t * 9)
    if kind == "pluck":
        return (np.sin(ph) + 0.5 * np.sin(2 * ph) * np.exp(-t * 7) + 0.25 * np.sin(3 * ph) * np.exp(-t * 11)) * np.exp(-t * 2.2)
    if kind == "saw":
        out = np.zeros(n)
        for k in range(1, 9):
            if f * k < 9000:
                out += np.sin(k * ph) / k
        return out * 0.6
    raise ValueError(kind)


class Mix:
    def __init__(self, seconds):
        self.n = int(seconds * SR) + SR * 2
        self.L = np.zeros(self.n); self.R = np.zeros(self.n)

    def add(self, start, sig, gain=1.0, pan=0.0):
        i = int(start * SR)
        if i >= self.n:
            return
        j = min(self.n, i + len(sig))
        sig = sig[:j - i] * gain
        self.L[i:j] += sig * (1 - max(0, pan)); self.R[i:j] += sig * (1 + min(0, pan))


def drums(mx, style, bpm, bars, rnd):
    beat = 60.0 / bpm
    if style == "none":
        return
    for bar in range(bars):
        for b in range(4):
            t0 = (bar * 4 + b) * beat
            hits = []
            if style == "four":
                hits = ["k"] if b in (0, 2) else ["s"]
                hits += ["h"]
            elif style == "soft":
                hits = ["k"] if b == 0 else (["s2"] if b in (1, 3) else [])
                hits += ["h2"]
            elif style == "swing":
                hits = (["k"] if b in (0, 2) else []) + (["s2"] if b in (1, 3) else []) + ["h2"]
            for h in hits:
                if h == "k":
                    t = np.arange(int(0.28 * SR)) / SR
                    f = 130 * np.exp(-t * 18) + 42
                    mx.add(t0, np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 11), 0.9)
                elif h in ("s", "s2"):
                    t = np.arange(int(0.22 * SR)) / SR
                    nz = np.random.default_rng(int(t0 * 1000) % 99991).standard_normal(len(t))
                    mx.add(t0, (nz * 0.7 + np.sin(2 * np.pi * 190 * t) * 0.6) * np.exp(-t * (22 if h == "s" else 30)), 0.45 if h == "s" else 0.25, 0.1)
                elif h in ("h", "h2"):
                    for sub in (0, 0.5):
                        t = np.arange(int(0.06 * SR)) / SR
                        nz = np.random.default_rng(int((t0 + sub * beat) * 1000) % 99991).standard_normal(len(t))
                        hp = np.diff(nz, prepend=0)
                        mx.add(t0 + sub * beat, hp * np.exp(-t * 80), (0.22 if h == "h" else 0.12) * (1.0 if sub == 0 else 0.7), -0.2)


def chord_midis(root, mode, degree, octave=4):
    sc = SCALES[mode]
    out = []
    for k in (0, 2, 4):
        idx = degree + k
        out.append(12 * (octave + 1) + root + sc[idx % 7] + 12 * (idx // 7))
    return out


def echo(mx, amount):
    for delay, g, swap in ((0.31, 0.55, True), (0.52, 0.32, False), (0.83, 0.18, True)):
        d = int(delay * SR)
        for src, dst in ((mx.L, mx.R if swap else mx.L), (mx.R, mx.L if swap else mx.R)):
            dst[d:] += src[:-d] * amount * g


def lead_pitch(line_words, root, mode, rnd_seed, prev):
    """A pentatonic melody for one line; the same words always give the same notes (choruses repeat)."""
    r = random.Random(rnd_seed)
    penta = [0, 2, 4, 7, 9] if mode == "major" else [0, 3, 5, 7, 10]
    seq = []
    i = r.randrange(2, 6)
    for _ in line_words:
        i = max(0, min(9, i + r.choice([-2, -1, -1, 0, 1, 1, 2])))
        octv, deg = divmod(i, 5)
        seq.append(12 * 6 + root + penta[deg] + 12 * (octv - 1) + 12)
    return seq


def word_times(words, start, line_dur, rnd):
    """Splits a line's time among its words: longer words and the last word get more of it."""
    wts = [max(1.0, min(2.2, 0.55 + 0.17 * len(w.strip()))) for w in words]
    wts[-1] *= 1.6
    total = sum(wts)
    span = line_dur * 0.9
    out = []
    t = start
    for w, wt in zip(words, wts):
        d = span * wt / total
        out.append((t, t + d * 0.94))
        t += d
    return out


def build_audio(track, bpm, root, mode, bars, style_name, lyric_lines, lyric_times, seed):
    st = STYLES[style_name]
    beat = 60.0 / bpm
    secs = bars * 4 * beat
    mx = Mix(secs)
    rnd = random.Random(seed)
    sc = SCALES[mode]
    prog = PROG[mode]
    for bar in range(bars):
        deg = prog[(bar // 1) % 4]
        t0 = bar * 4 * beat
        notes = chord_midis(root, mode, deg, 3)
        for k, m in enumerate(notes):                          # pad: a soft chord that lasts the bar
            n = int(4 * beat * SR * 1.05)
            for det in (-0.04, 0.04):
                sig = osc(freq(m + 12) * 2 ** (det / 12), n, "tri") * adsr(n, 0.35, 0.3, 0.8, 0.9)
                mx.add(t0, sig, 0.045 * st["pad"], -0.4 + 0.4 * k)
        bass = 12 * 3 + root + sc[deg % 7] - 12 * (1 if root > 6 else 0)
        for b in (0, 2):                                       # bass on beats 1 and 3, a pickup before beat 3
            n = int(1.7 * beat * SR)
            mx.add(t0 + b * beat, osc(freq(bass), n, "sine") * adsr(n, 0.01, 0.2, 0.7, 0.3), 0.30 * st["bass"])
        steps = int(4 * st["arp"]) if st["arp"] >= 1 else 2
        order = [0, 1, 2, 1, 2, 1, 0, 2]
        for s in range(steps):
            m = notes[order[s % len(order)]] + 12 + (12 if s % 4 == 3 else 0)
            ts = t0 + s * (4 * beat / steps)
            n = int(0.55 * SR)
            mx.add(ts, osc(freq(m), n, "pluck") * adsr(n, 0.003, 0.1, 0.5, 0.2), 0.10, 0.3 if s % 2 else -0.3)
    drums(mx, st["drums"], bpm, bars, rnd)
    if lyric_lines:
        prev = None
        for words, times in zip(lyric_lines, lyric_times):
            pitches = lead_pitch(words, root, mode, hashlib.md5("".join(words).encode()).hexdigest(), prev)
            for w, (ts, te), p in zip(words, times, pitches):
                n = int(max(0.12, te - ts) * SR)
                kind = st["lead"]
                mx.add(ts, osc(freq(p), n, kind, vib=1.4 if kind == "saw" else 0.0) * adsr(n, 0.01, 0.12, 0.8, 0.12), 0.20, 0.0)
    else:
        motif = [rnd.choice([0, 2, 4, 7, 9]) for _ in range(8)]       # an 8-note motif, played every 2 bars, now and then varied
        for bar in range(2, bars - 1, 2):
            for k in range(8):
                if rnd.random() < 0.18:
                    continue
                m = 12 * 6 + root + (motif[k] if (bar // 2) % 3 else motif[(k * 3) % 8])
                if mode == "minor":
                    m = 12 * 6 + root + [0, 3, 5, 7, 10][(motif[k] // 2) % 5]
                ts = (bar * 4 + k * 1.0) * beat
                n = int(0.9 * beat * SR)
                kind = st["lead"]
                mx.add(ts, osc(freq(m), n, kind, vib=1.2 if kind == "saw" else 0.0) * adsr(n, 0.01, 0.12, 0.75, 0.2), 0.16, 0.15)
    echo(mx, st["echo"])
    n = int(secs * SR)
    L, R = mx.L[:n], mx.R[:n]
    fade = int(1.5 * SR)
    for ch in (L, R):
        ch[-fade:] *= np.linspace(1, 0, fade)
        ch[:int(0.02 * SR)] *= np.linspace(0, 1, int(0.02 * SR))
    peak = max(np.abs(L).max(), np.abs(R).max(), 1e-9)
    gain = 0.85 / peak
    st16 = np.stack([np.tanh(L * gain * 1.1) / np.tanh(1.1), np.tanh(R * gain * 1.1) / np.tanh(1.1)], axis=1)
    return (st16 * 32767).astype("<i2"), secs


# ------------------------------------------------------------------------------------------------ lyrics


def make_envelope(artist, album, title, duration, lang, lines_with_times):
    lines = []
    for words, times in lines_with_times:
        if not words:
            continue
        value = "".join(words)
        cues = []
        pos = 0
        for w, (ts, te) in zip(words, times):
            b = len(w.encode("utf-8"))
            cues.append({"start": int(ts * 1000), "end": int(te * 1000), "value": w, "byteStart": pos, "byteEnd": pos + b - 1})
            pos += b
        lines.append({"start": cues[0]["start"], "end": cues[-1]["end"], "value": value, "cue": cues})
    return {
        "format": "navidrome-lyrics", "version": 1, "origin": "user", "locked": False, "offsetMs": 0,
        "quality": "karaoke", "confidence": 1, "retrievedAt": "2025-01-01T00:00:00Z",
        "attribution": "Demo lyrics written for Lyvune, released under CC0 1.0",
        "recording": {"title": title, "artist": artist, "album": album, "duration": int(round(duration))},
        "lyrics": [{"displayArtist": artist, "displayTitle": title, "kind": "main", "lang": lang, "synced": True, "line": lines}],
    }


# ------------------------------------------------------------------------------------------------ build


def slug(s):
    return "".join(c for c in s if c.isalnum() or c in " &-_.").strip()


def write_wav(path, pcm):
    with wave.open(path, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("out")
    ap.add_argument("--covers-only", action="store_true", help="draw the covers only (into OUT/covers) and stop")
    a = ap.parse_args()
    data = json.load(open(os.path.join(HERE, "demo-library.json"), encoding="utf-8"))
    os.makedirs(a.out, exist_ok=True)
    if not a.covers_only and subprocess.run(["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True).stdout.find(" flac ") < 0:
        sys.exit("ffmpeg with the flac encoder is needed")
    total = 0
    for ai, alb in enumerate(data["albums"]):
        folder = os.path.join(a.out, "covers" if a.covers_only else os.path.join(slug(alb["artist"]), slug(alb["album"])))
        os.makedirs(folder, exist_ok=True)
        seed = int(hashlib.md5((alb["artist"] + alb["album"]).encode()).hexdigest()[:8], 16)
        cover = paint_cover(alb["motif"], alb["palette"], seed)
        cover.save(os.path.join(folder, f"{ai:02d}-{slug(alb['album'])}.png" if a.covers_only else "cover.png"), optimize=True)
        print(f"{alb['artist']} - {alb['album']}: cover")
        if a.covers_only:
            continue
        for ti, tr in enumerate(alb["tracks"], 1):
            root = NOTE[tr["key"]]; bpm = tr["bpm"]; beat = 60.0 / bpm; bar = 4 * beat
            lines, times = [], []
            if tr.get("lyrics"):
                t = 2 * bar                                        # two bars of introduction
                rnd = random.Random(seed + ti)
                for words in tr["lyrics"]:
                    if words:
                        lines.append(words); times.append(word_times(words, t, 2 * bar, rnd))
                    t += 2 * bar
                bars = int(math.ceil((t + 2 * bar) / bar))
            else:
                bars = tr["bars"]
            pcm, secs = build_audio(tr, bpm, root, alb_mode(tr), bars, tr["style"], lines, times, seed + ti)
            name = f"{ti:02d} {slug(tr['title'])}"
            with tempfile.TemporaryDirectory() as td:
                wav = os.path.join(td, "t.wav"); write_wav(wav, pcm)
                subprocess.run([
                    "ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-c:a", "flac", "-compression_level", "8",
                    "-metadata", f"title={tr['title']}", "-metadata", f"artist={alb['artist']}", "-metadata", f"album_artist={alb['artist']}",
                    "-metadata", f"album={alb['album']}", "-metadata", f"track={ti}/{len(alb['tracks'])}", "-metadata", f"date={alb['year']}",
                    "-metadata", f"genre={alb['genre']}", "-metadata", "comment=Lyvune demo library, CC0 1.0. Synthesised; not a recording.",
                    os.path.join(folder, name + ".flac")], check=True)
            if lines:
                env = make_envelope(alb["artist"], alb["album"], tr["title"], secs, tr["lang"], list(zip(lines, times)))
                with open(os.path.join(folder, name + ".lyrics.json"), "w", encoding="utf-8") as f:
                    json.dump(env, f, ensure_ascii=False, indent=1)
            total += 1
            print(f"  {ti:02d} {tr['title']}  {int(secs // 60)}:{int(secs % 60):02d}" + ("  (karaoke)" if lines else ""))
    print(f"done: {len(data['albums'])} albums" + ("" if a.covers_only else f", {total} tracks") + f" in {a.out}")


def alb_mode(tr):
    return tr["mode"]


if __name__ == "__main__":
    main()
