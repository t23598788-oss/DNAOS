#!/usr/bin/env python3
# อ่าน screenshot ของ acceptance-sandbox แล้วคืนพิกัด "logical points" จริง + BOUNDS ของแต่ละ target
# ด้วยการหา "largest contiguous color BLOB" (connected component) — ไม่ใช่ bbox ของสีทั้งภาพ
# (bbox ทั้งภาพถูก stray pixel ปนเปื้อน: run 1788244866695 ทำ boxY=299 ผิด ทั้งที่กล่องจริง ~516)
# usage: calibrate-sandbox.py <png> <logicalW> <logicalH>
import sys, json
from PIL import Image
png, LW, LH = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
im = Image.open(png).convert("RGB"); PW, PH = im.size
sx, sy = PW / float(LW), PH / float(LH)
STEP = 3  # sample grid (logical px) — เร็วพอและละเอียดพอ
COL = {"click": (30, 110, 205), "drag": (28, 170, 92), "input": (150, 60, 200), "box": (240, 92, 40)}

def near(p, c, t=52):
    return (p[0]-c[0])**2 + (p[1]-c[1])**2 + (p[2]-c[2])**2 < t*t

def mask(color):
    """set of (lx,ly) sampled points matching color"""
    pts = set()
    for ly in range(0, LH, STEP):
        py = min(int(ly*sy), PH-1)
        for lx in range(0, LW, STEP):
            if near(im.getpixel((min(int(lx*sx), PW-1), py)), color):
                pts.add((lx, ly))
    return pts

def largest_blob(pts):
    """4-connectivity (on the STEP grid) connected components → largest → its bbox+center+size"""
    if not pts:
        return None
    seen = set(); best = None
    for start in pts:
        if start in seen:
            continue
        stack = [start]; comp = []
        seen.add(start)
        while stack:
            x, y = stack.pop(); comp.append((x, y))
            for dx, dy in ((STEP,0),(-STEP,0),(0,STEP),(0,-STEP)):
                n = (x+dx, y+dy)
                if n in pts and n not in seen:
                    seen.add(n); stack.append(n)
        if best is None or len(comp) > len(best):
            best = comp
    xs = [p[0] for p in best]; ys = [p[1] for p in best]
    return {"x0": min(xs), "x1": max(xs), "y0": min(ys), "y1": max(ys),
            "cx": (min(xs)+max(xs))//2, "cy": (min(ys)+max(ys))//2, "size": len(best)}

def bounds(color):
    return largest_blob(mask(color))

out = {"cleanX": int(LW*0.25)}
cb = bounds(COL["click"])
bx = bounds(COL["box"])
ip = bounds(COL["input"])
dg = bounds(COL["drag"])
# click target (clickband blob)
if cb:
    out["clickY"] = cb["cy"]; out["clickBounds"] = {k: cb[k] for k in ("x0", "x1", "y0", "y1")}
# drag target (orange box = largest orange blob, ไม่ใช่ bbox ปนเปื้อน)
if bx:
    out["boxX"] = bx["cx"]; out["boxY"] = bx["cy"]; out["boxBounds"] = {k: bx[k] for k in ("x0", "x1", "y0", "y1")}
# input band (purple) → ใช้ center Y; input field กว้าง ครอบ cleanX
if ip:
    out["inputY"] = ip["cy"]; out["inputBounds"] = {k: ip[k] for k in ("x0", "x1", "y0", "y1")}
if dg:
    out["dragY"] = dg["cy"]
print(json.dumps(out))
