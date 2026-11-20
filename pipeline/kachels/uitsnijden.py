#!/usr/bin/env python3
"""Snijdt productfoto's met een (bijna) witte achtergrond uit -> transparante PNG, klaar voor de studio-sokkel.
Gebruik: uitsnijden.py <bron> <doel.png> [max_hoogte]
- haalt energielabels (groen blok rechtsboven) weg
- wist witte achtergrond vanaf de randen (gaten in het vuurvenster blijven dicht)
- verwijdert vloerschaduw onderin en losse restjes; houdt het hoofdobject over
Geeft exitcode 3 als de foto geen witte achtergrond heeft (dan als sfeerfoto gebruiken)."""
import sys
from collections import deque
from PIL import Image, ImageDraw, ImageFilter, ImageChops
src, dst = sys.argv[1], sys.argv[2]; MAXH = int(sys.argv[3]) if len(sys.argv) > 3 else 700
im = Image.open(src).convert('RGBA'); bg = Image.new('RGBA', im.size, (255, 255, 255, 255)); bg.alpha_composite(im); im = bg.convert('RGB')
W, H = im.size; p = im.load()
edge = [p[x, y] for x in range(0, W, 4) for y in (0, H - 1)] + [p[x, y] for y in range(0, H, 4) for x in (0, W - 1)]
if sum(1 for c in edge if min(c) > 200 and max(c) - min(c) < 25) / len(edge) < .55: sys.exit(3)
lab = sum(1 for y in range(int(H * .14)) for x in range(int(W * .7), W) if p[x, y][1] > 140 and p[x, y][1] - p[x, y][2] > 60)
if lab > 200: ImageDraw.Draw(im).rectangle([int(W * .62), 0, W, int(H * .17)], fill=(255, 255, 255)); p = im.load()
seen = bytearray(W * H); q = deque([(x, y) for x in range(W) for y in (0, H - 1)] + [(x, y) for y in range(H) for x in (0, W - 1)])
m = Image.new('L', (W, H), 255); mp = m.load()
while q:
    x, y = q.popleft(); i = y * W + x
    if seen[i]: continue
    seen[i] = 1; c = p[x, y]
    if not (min(c) > 165 and max(c) - min(c) < 28): continue
    mp[x, y] = 0
    for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
        if 0 <= nx < W and 0 <= ny < H and not seen[ny * W + nx]: q.append((nx, ny))
for y in range(int(H * .72), H):   # vloerschaduw
    for x in range(W):
        c = p[x, y]
        if mp[x, y] and min(c) > 118 and max(c) - min(c) < 26: mp[x, y] = 0
m = m.filter(ImageFilter.MinFilter(3))
# grootste samenhangende delen houden
mp = m.load(); seen = bytearray(W * H); comps = []
for y in range(H):
    for x in range(W):
        if mp[x, y] > 40 and not seen[y * W + x]:
            qq = deque([(x, y)]); seen[y * W + x] = 1; pts = []
            while qq:
                cx, cy = qq.popleft(); pts.append((cx, cy))
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < W and 0 <= ny < H and not seen[ny * W + nx] and mp[nx, ny] > 40: seen[ny * W + nx] = 1; qq.append((nx, ny))
            comps.append(pts)
if not comps: sys.exit(3)
big = max(len(c) for c in comps); keep = Image.new('L', (W, H), 0); kp = keep.load()
for c in comps:
    if len(c) >= big * .05:
        for x, y in c: kp[x, y] = 255
a = ImageChops.multiply(m, keep.filter(ImageFilter.MaxFilter(3))).filter(ImageFilter.GaussianBlur(.6))
o = im.convert('RGBA'); o.putalpha(a); o = o.crop(a.point(lambda v: 255 if v > 30 else 0).getbbox())
if o.height > MAXH: o = o.resize((round(o.width * MAXH / o.height), MAXH), Image.LANCZOS)
o.save(dst, optimize=True)
