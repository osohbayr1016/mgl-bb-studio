"""Furniture layout of one apartment unit — tiered (economy / standard / luxury).

Python stdlib only; deterministic (same input → same output).  Replaces the old
«one bed in the room centre» placement that architects never used (owner,
2026-10-14).  Every item is placed the way a person furnishes a flat:

* bedroom  — bed head against a closed wall without a door (window wall last),
             walking space on the free side(s) and at the foot, night stands,
             wardrobe on another wall, desk under the window in children's rooms;
* living + kitchen — kitchen run along a wall from a corner with a 1.1 m work
             aisle, dining table next to it, sofa against a wall facing a TV
             unit on the opposite wall, coffee table in between;
* bathroom — tub or shower in the far corner, WC with its 0.8 m zone and 0.6 m
             in front, basin with 0.7 m in front, washing machine if it fits.

Door swings (±0.55 m along the wall × 0.95 m deep) and openings without a wall
stay free.  Required items (one bed per bedroom; sofa + kitchen; WC + basin)
step down in size and clearance before the plan is rejected, so this never
rejects a plan the old placement accepted for space reasons alone.

Output per item: kind, room, x, y (centre), width (X extent), depth (Y extent),
back (side of the room the item's back rests on: south/north/west/east, or
None for free-standing items).  Revit turns the family so its back (+Y) faces
that wall and snaps it to the real wall face.  Every footprint stays inside the
room's wall FACES (≥ 1 cm, FACE_GAP = 2 cm): the C# FurniturePlanner.Safe and
the wall-face contract of test_roomplan_hardening.py.
"""
from __future__ import annotations

import math

TIERS = ("economy", "standard", "luxury")
SIDES = ("south", "north", "west", "east")
FACE_GAP = 0.02                      # furniture stands 2 cm off the wall FACE (C# Safe: ≥ 1 cm)
GAP = 0.03                           # between neighbouring footprints
DOOR_HALF, DOOR_DEPTH = 0.55, 0.95   # keep-out in front of every door: the 0.9 m leaf's swing,
                                     # either hinge side (shared rule with C# FurniturePlanner.Safe)
OPENING_DEPTH = 0.9                  # keep-out in front of a wall-less edge
DEFAULT_EXT_T, DEFAULT_INT_T = 0.2, 0.1   # wall thickness when the caller does not know it

# --- sizes per tier (metres): (along the wall, depth) -----------------------
BED = {  # (width, length) — head against the wall
    "economy":  {"master": [(1.4, 2.0), (1.2, 2.0), (0.9, 2.0)], "other": [(0.9, 2.0), (0.8, 1.9)]},
    "standard": {"master": [(1.6, 2.0), (1.4, 2.0), (1.2, 2.0), (0.9, 2.0)],
                 "other": [(1.2, 2.0), (0.9, 2.0), (0.8, 1.9)]},
    "luxury":   {"master": [(1.8, 2.1), (1.6, 2.0), (1.4, 2.0), (0.9, 2.0)],
                 "other": [(1.4, 2.0), (1.2, 2.0), (0.9, 2.0)]},
}
BED_SIDE = {"economy": 0.5, "standard": 0.6, "luxury": 0.7}
BED_FOOT = {"economy": 0.6, "standard": 0.7, "luxury": 0.8}
NIGHTSTAND = (0.45, 0.40)
WARDROBE = {"economy": {"master": 1.2, "other": 1.0}, "standard": {"master": 1.8, "other": 1.2},
            "luxury": {"master": 2.4, "other": 1.8}}
DESK = {"standard": (1.0, 0.55), "luxury": (1.2, 0.6)}
KITCHEN = {"economy": [2.4, 2.1, 1.8], "standard": [3.0, 2.7, 2.4, 2.1, 1.8], "luxury": [3.6, 3.3, 3.0, 2.7, 2.4, 1.8]}
KITCHEN_AISLE = {"economy": 1.0, "standard": 1.1, "luxury": 1.2}
KITCHEN_RETURN = {"luxury": [1.8, 1.5, 1.2], "standard": [1.2]}
DINING = {"economy": [(1.2, 0.8), (1.0, 0.75)], "standard": [(1.6, 0.9), (1.4, 0.8), (1.2, 0.8)],
          "luxury": [(2.0, 1.0), (1.8, 0.9), (1.6, 0.9)]}
DINING_CLEAR = {"economy": 0.65, "standard": 0.75, "luxury": 0.85}
SOFA = {"economy": [(1.8, 0.85), (1.6, 0.8)], "standard": [(2.2, 0.9), (2.0, 0.9), (1.8, 0.85)],
        "luxury": [(2.8, 0.95), (2.4, 0.95), (2.2, 0.9)]}
COFFEE = {"economy": (0.9, 0.5), "standard": (1.1, 0.6), "luxury": (1.3, 0.7)}
TV = {"economy": (1.2, 0.4), "standard": (1.6, 0.45), "luxury": (2.0, 0.45)}
BASIN = {"economy": (0.5, 0.45), "standard": (0.6, 0.48), "luxury": (1.0, 0.55)}
WC_ZONE, WC_DEPTH, WC_FRONT = 0.8, 0.75, 0.6
TUB = {"economy": [(1.5, 0.7)], "standard": [(1.7, 0.75), (1.5, 0.7)], "luxury": [(1.8, 0.8), (1.7, 0.75)]}
SHOWER = {"economy": (0.8, 0.8), "standard": (0.9, 0.9), "luxury": (1.2, 0.9)}
WASHER = (0.6, 0.6)


def _overlap(a, b, gap=0.0):
    return a[0] < b[2] + gap and a[2] > b[0] - gap and a[1] < b[3] + gap and a[3] > b[1] - gap


def _inside(r, box):
    return r[0] >= box[0] - 1e-9 and r[1] >= box[1] - 1e-9 and r[2] <= box[2] + 1e-9 and r[3] <= box[3] + 1e-9


class _Room:
    """One room: its usable box, doors, wall-less edges, window sides and what is placed so far."""

    def __init__(self, room, doors, walls, width, height, ext_t, int_t, facades):
        self.name = room["name"]
        self.r = (room["x1"], room["y1"], room["x2"], room["y2"])
        x1, y1, x2, y2 = self.r

        def half(at, limit):
            return (ext_t if abs(at - limit) < 1e-6 else int_t) / 2.0

        ext_t = ext_t or DEFAULT_EXT_T
        int_t = int_t or DEFAULT_INT_T
        if width is None or height is None:
            fx1, fy1, fx2, fy2 = x1 + int_t / 2, y1 + int_t / 2, x2 - int_t / 2, y2 - int_t / 2
        else:
            fx1, fy1 = x1 + half(x1, 0.0), y1 + half(y1, 0.0)
            fx2, fy2 = x2 - half(x2, width), y2 - half(y2, height)
        self.box = (fx1 + FACE_GAP, fy1 + FACE_GAP, fx2 - FACE_GAP, fy2 - FACE_GAP)
        self.facade = set()
        if width is not None and height is not None:
            for side, at, lim in (("south", y1, 0.0), ("north", y2, height), ("west", x1, 0.0), ("east", x2, width)):
                if abs(at - lim) < 1e-6 and side in facades:
                    self.facade.add(side)
        self.doors = []          # (side, centre along that side)
        self.zones = []          # keep-out rectangles (doors, openings)
        for d in doors:
            cx, cy = d["center"]["x"], d["center"]["y"]
            side = self._side_of(cx, cy)
            if side is None:
                continue
            along = cx if side in ("south", "north") else cy
            self.doors.append((side, along))
            self.zones.append(self._band(side, along - DOOR_HALF, along + DOOR_HALF, DOOR_DEPTH))
        self.covered = {s: self._coverage(s, walls) for s in SIDES}
        for s in SIDES:
            for lo, hi in self._gaps(s):
                self.zones.append(self._band(s, lo, hi, OPENING_DEPTH))
        self._anchor_cache = {}
        lo_x, hi_x = self.r[0], self.r[2]
        lo_y, hi_y = self.r[1], self.r[3]
        self._full = {s: len(self.covered[s]) == 1 and
                      self.covered[s][0][0] <= (lo_x if s in ("south", "north") else lo_y) + 1e-6 and
                      self.covered[s][0][1] >= (hi_x if s in ("south", "north") else hi_y) - 1e-6
                      for s in SIDES}
        self.feet = []           # placed footprints
        self.clear = []          # placed clearance rectangles (other items stay out)
        self.items = []

    # -- geometry helpers ---------------------------------------------------
    def _side_of(self, x, y):
        x1, y1, x2, y2 = self.r
        if x1 - .01 <= x <= x2 + .01:
            if abs(y - y1) < .02:
                return "south"
            if abs(y - y2) < .02:
                return "north"
        if y1 - .01 <= y <= y2 + .01:
            if abs(x - x1) < .02:
                return "west"
            if abs(x - x2) < .02:
                return "east"
        return None

    def _band(self, side, lo, hi, depth):
        x1, y1, x2, y2 = self.r
        if side == "south":
            return (lo, y1, hi, y1 + depth)
        if side == "north":
            return (lo, y2 - depth, hi, y2)
        if side == "west":
            return (x1, lo, x1 + depth, hi)
        return (x2 - depth, lo, x2, hi)

    def _coverage(self, side, walls):
        """Intervals of this side (room coordinates along it) that have a wall."""
        x1, y1, x2, y2 = self.r
        horizontal = side in ("south", "north")
        line = {"south": y1, "north": y2, "west": x1, "east": x2}[side]
        lo, hi = (x1, x2) if horizontal else (y1, y2)
        spans = []
        for w in walls or ():
            (ax, ay), (bx, by) = (w["start"]["x"], w["start"]["y"]), (w["end"]["x"], w["end"]["y"])
            if horizontal and abs(ay - by) < 1e-6 and abs(ay - line) < .02:
                a, b = sorted((ax, bx))
            elif not horizontal and abs(ax - bx) < 1e-6 and abs(ax - line) < .02:
                a, b = sorted((ay, by))
            else:
                continue
            a, b = max(a, lo), min(b, hi)
            if b > a:
                spans.append((a, b))
        spans.sort()
        merged = []
        for a, b in spans:
            if merged and a <= merged[-1][1] + 1e-6:
                merged[-1] = (merged[-1][0], max(merged[-1][1], b))
            else:
                merged.append((a, b))
        return merged if walls is not None else [(lo, hi)]

    def _gaps(self, side):
        x1, y1, x2, y2 = self.r
        lo, hi = (x1, x2) if side in ("south", "north") else (y1, y2)
        at, out = lo, []
        for a, b in self.covered[side]:
            if a - at > .05:
                out.append((at, a))
            at = max(at, b)
        if hi - at > .05:
            out.append((at, hi))
        return out

    def along_range(self, side):
        b = self.box
        return (b[0], b[2]) if side in ("south", "north") else (b[1], b[3])

    def depth_of(self, side):
        b = self.box
        return b[3] - b[1] if side in ("south", "north") else b[2] - b[0]

    def rect(self, side, a, length, depth):
        """Footprint with its back on `side`, starting at `a` along it."""
        b = self.box
        if side == "south":
            return (a, b[1], a + length, b[1] + depth)
        if side == "north":
            return (a, b[3] - depth, a + length, b[3])
        if side == "west":
            return (b[0], a, b[0] + depth, a + length)
        return (b[2] - depth, a, b[2], a + length)

    def front(self, side, foot, depth, widen=0.0):
        """Rectangle in front of a footprint (towards the room), `depth` deep."""
        x1, y1, x2, y2 = foot
        if side == "south":
            return (x1 - widen, y2, x2 + widen, y2 + depth)
        if side == "north":
            return (x1 - widen, y1 - depth, x2 + widen, y1)
        if side == "west":
            return (x2, y1 - widen, x2 + depth, y2 + widen)
        return (x1 - depth, y1 - widen, x1, y2 + widen)

    def front_mid(self, side, foot, depth, width):
        """Only the middle `width` of the front — the step-in spot of a tub or shower;
        fixtures may stand beside it along the same wall."""
        x1, y1, x2, y2 = foot
        if side in ("south", "north"):
            c = (x1 + x2) / 2
            r = self.front(side, (c - width / 2, y1, c + width / 2, y2), depth)
        else:
            c = (y1 + y2) / 2
            r = self.front(side, (x1, c - width / 2, x2, c + width / 2), depth)
        return r

    def sides_of(self, side, foot, width):
        """The two strips beside a footprint (along the wall), `width` wide, full depth."""
        x1, y1, x2, y2 = foot
        if side in ("south", "north"):
            return [(x1 - width, y1, x1, y2), (x2, y1, x2 + width, y2)]
        return [(x1, y1 - width, x2, y1), (x1, y2, x2, y2 + width)]

    def walled(self, side, a, length):
        """Is [a, a+length] along `side` backed by a real wall?"""
        if self._full[side]:
            return True
        return any(lo - 1e-6 <= a and a + length <= hi + 1e-6 for lo, hi in self.covered[side])

    def anchors(self, side, length):
        """Candidate start positions along a side: corners, centre, beside doors, window centre."""
        key = (side, length)
        hit = self._anchor_cache.get(key)
        if hit is not None:
            return hit
        lo, hi = self.along_range(side)
        if hi - lo < length - 1e-9:
            self._anchor_cache[key] = []
            return []
        pts = {lo, hi - length, (lo + hi - length) / 2}
        for s, c in self.doors:
            for a in (c + DOOR_HALF + GAP, c - DOOR_HALF - GAP - length):
                pts.add(a)
        for wlo, whi in self.covered[side]:
            pts.update((wlo, whi - length))
        out = sorted(round(a, 5) for a in pts if lo - 1e-9 <= a <= hi - length + 1e-9)
        self._anchor_cache[key] = out
        return out

    def free(self, foot, own_clear=(), ignore=()):
        if not _inside(foot, self.box):
            return False
        if any(_overlap(foot, z) for z in self.zones):
            return False
        for i, f in enumerate(self.feet):
            if i in ignore:
                continue
            if _overlap(foot, f, GAP):
                return False
        for i, c in enumerate(self.clear):
            if c[0] in ignore:
                continue
            if _overlap(foot, c[1]):
                return False
        for c in own_clear:
            if not _inside(c, self.box):
                return False
            if any(_overlap(c, f) for i, f in enumerate(self.feet) if i not in ignore):
                return False
        return True

    def add(self, kind, foot, back, clears=()):
        idx = len(self.feet)
        self.feet.append(foot)
        for c in clears:
            self.clear.append((idx, c))
        x1, y1, x2, y2 = foot
        self.items.append({"kind": kind, "room": self.name, "x": round((x1 + x2) / 2, 5),
                           "y": round((y1 + y2) / 2, 5), "width": round(x2 - x1, 5),
                           "depth": round(y2 - y1, 5), "back": back})
        return idx

    def opposite(self, side):
        return {"south": "north", "north": "south", "west": "east", "east": "west"}[side]

    def door_sides(self):
        return {s for s, _ in self.doors}

    def centre(self):
        b = self.box
        return ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)


def _dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _mid(r):
    return ((r[0] + r[2]) / 2, (r[1] + r[3]) / 2)


# ---------------------------------------------------------------- bedroom --
def _bedroom(room, tier, master):
    """Bed first (scored over every size × clearance × wall × position), then its companions."""
    sizes = BED[tier]["master" if master else "other"]
    side_clear, foot_clear = BED_SIDE[tier], BED_FOOT[tier]
    # Clearance levels: the tier's own, then a still-usable minimum.  A bigger bed with
    # 0.45 m beside it beats a single bed in a master bedroom.
    levels = [(side_clear, foot_clear, 0.0), (0.45, 0.55, 1.2)]
    doors = room.door_sides()
    best = None
    for rank, (w, l) in enumerate(sizes + [(0.9, 2.0), (0.8, 1.9)]):
        double = w >= 1.35
        for sc, fc, penalty in levels + [(0.0, 0.45, 3.0)]:
            if double and sc <= 0:
                continue
            # The best any position could still score with this size and clearance.
            if best is not None and (3.0 if master else 1.5) * w + 7.5 - penalty + w <= best[0]:
                continue
            for side in SIDES:
                if room.depth_of(side) < l + fc - 1e-9:
                    continue
                lo, hi = room.along_range(side)
                for a in room.anchors(side, w):
                    if not room.walled(side, a, w):
                        continue
                    foot = room.rect(side, a, w, l)
                    if sc <= 0:
                        strips = []
                    elif double:
                        strips = room.sides_of(side, foot, sc)
                    elif abs(a - lo) < 1e-6:
                        strips = room.sides_of(side, foot, sc)[1:]   # in the low corner: walk on the high side
                    elif abs(a + w - hi) < 1e-6:
                        strips = room.sides_of(side, foot, sc)[:1]
                    else:
                        continue                                     # single beds go into a corner
                    clears = list(strips) + [room.front(side, foot, fc)]
                    if not room.free(foot, clears):
                        continue
                    score = -penalty
                    score += (3.0 if master else 1.5) * w            # the biggest bed that fits
                    score += 0 if side in doors else 3.0             # head not on the door wall
                    score += 0 if side in room.facade else 2.0       # nor under the window
                    score += 1.5 if room.opposite(side) in doors else 0
                    if double:
                        score -= abs((a + w / 2) - (lo + hi) / 2) * 0.8   # doubles centred on their wall
                    cand = (score, side, a, foot, clears, w, l, double)
                    if best is None or cand[0] > best[0] + 1e-9:
                        best = cand
    if best is None:
        raise ValueError("furniture cannot be placed clear of doors: Bed")
    _, side, a, foot, clears, w, l, double = best
    room.add("Bed" if double else "BedSingle", foot, side, clears)
    # Night stands beside the head, inside the bed's own walking strips.
    want = 2 if double and tier != "economy" else (1 if double or tier == "luxury" else 0)
    nw, nd = NIGHTSTAND
    bed_idx = len(room.feet) - 1
    placed = 0
    for at in (a - GAP - nw, a + w + GAP):
        if placed >= want:
            break
        stand = room.rect(side, at, nw, nd)
        if room.free(stand, ignore={bed_idx}):
            room.add("Nightstand", stand, side)
            placed += 1
    # Wardrobe on another wall, never under a window or across a door.
    target = WARDROBE[tier]["master" if master else "other"]
    lengths = [x for x in (target, target - 0.3, target - 0.6, 1.2, 1.0, 0.9, 0.8) if 0.79 < x <= target + 1e-9]
    done = False
    for length in sorted(set(lengths), reverse=True):
        options = []
        for s in SIDES:
            if s in room.facade or room.depth_of(s) < 0.6 + 0.75:
                continue
            for at in room.anchors(s, length):
                if not room.walled(s, at, length):
                    continue
                foot = room.rect(s, at, length, 0.6)
                clr = room.front(s, foot, 0.75)
                if room.free(foot, [clr]):
                    lo, hi = room.along_range(s)
                    corner = abs(at - lo) < 1e-6 or abs(at + length - hi) < 1e-6
                    options.append(((1 if corner else 0) + (1 if s != side else 0), s, foot, clr))
        if options:
            options.sort(key=lambda o: (-o[0], SIDES.index(o[1]), o[2]))
            _, s, foot, clr = options[0]
            room.add("Wardrobe", foot, s, [clr])
            done = True
            break
    # Desk under the window in the other bedrooms.
    if not master and tier in DESK:
        dw, dd = DESK[tier]
        for s in sorted(SIDES, key=lambda s: (s not in room.facade, SIDES.index(s))):
            hit = None
            for at in room.anchors(s, dw):
                if not room.walled(s, at, dw):
                    continue
                foot = room.rect(s, at, dw, dd)
                clr = room.front(s, foot, 0.7)
                if room.free(foot, [clr]):
                    hit = (foot, clr)
                    break
            if hit:
                room.add("Desk", hit[0], s, [hit[1]])
                break


# ----------------------------------------------------------- living room --
def _living(room, tier, entry_point):
    aisle = KITCHEN_AISLE[tier]
    kitchen = None
    for length in KITCHEN[tier]:
        options = []
        for s in SIDES:
            if room.depth_of(s) < 0.6 + aisle:
                continue
            for a in room.anchors(s, length):
                if not room.walled(s, a, length):
                    continue
                foot = room.rect(s, a, length, 0.6)
                clr = room.front(s, foot, aisle)
                if not room.free(foot, [clr]):
                    continue
                lo, hi = room.along_range(s)
                corner = abs(a - lo) < 1e-6 or abs(a + length - hi) < 1e-6
                score = (0 if s in room.facade else 4) + (1.5 if corner else 0)
                if entry_point is not None:
                    score -= _dist(_mid(foot), entry_point) * 0.25   # cook near the way in
                options.append((score, s, a, foot, clr, corner))
        if options:
            options.sort(key=lambda o: (-o[0], SIDES.index(o[1]), o[2]))
            kitchen = options[0]
            break
    if kitchen is None:
        raise ValueError("furniture cannot be placed clear of doors: Kitchen")
    _, ks, ka, kfoot, kclr, kcorner = kitchen
    kitchen_idx = room.add("Kitchen", kfoot, ks, [kclr])
    # L-shaped return from the kitchen's corner (standard / luxury).
    if kcorner and tier in KITCHEN_RETURN:
        lo, hi = room.along_range(ks)
        at_low = abs(ka - lo) < 1e-6
        corner_side = {("south", True): "west", ("south", False): "east", ("north", True): "west",
                       ("north", False): "east", ("west", True): "south", ("west", False): "north",
                       ("east", True): "south", ("east", False): "north"}[(ks, at_low)]
        for length in KITCHEN_RETURN[tier]:
            rlo, rhi = room.along_range(corner_side)
            near_low = ks in ("south", "west")
            a = rlo + 0.6 + GAP if near_low else rhi - 0.6 - GAP - length
            if corner_side in room.facade or not room.walled(corner_side, a, length):
                continue
            foot = room.rect(corner_side, a, length, 0.6)
            clr = room.front(corner_side, foot, aisle)
            if room.free(foot, [clr], ignore={kitchen_idx}):   # the return shares the run's aisle corner
                room.add("Kitchen", foot, corner_side, [clr])
                break
    kitchen_mid = _mid(kclr)
    # Sofa against a wall, as far from the kitchen as the room allows, with a TV wall opposite.
    sofa = None
    for w, d in SOFA[tier]:
        options = []
        for s in SIDES:
            if room.depth_of(s) < d + 0.45 + 0.6:
                continue
            for a in room.anchors(s, w):
                if not room.walled(s, a, w):
                    continue
                foot = room.rect(s, a, w, d)
                clr = room.front(s, foot, 1.05)          # coffee table + legs
                if not room.free(foot, [clr]):
                    continue
                view = room.depth_of(s) - d
                score = _dist(_mid(foot), kitchen_mid) * 0.6
                score += 2 if 2.0 <= view <= 4.5 else 0
                score += 0 if s in room.door_sides() else 1
                score += 0.5 if s not in room.facade else 0
                options.append((score, s, a, foot, clr))
        if options:
            options.sort(key=lambda o: (-o[0], SIDES.index(o[1]), o[2]))
            sofa = options[0]
            break
    if sofa is None:
        raise ValueError("furniture cannot be placed clear of doors: Sofa")
    _, ss, sa, sfoot, sclr = sofa
    sofa_idx = room.add("Sofa", sfoot, ss, [sclr])
    cw, cd = COFFEE[tier]
    sw = (sfoot[2] - sfoot[0]) if ss in ("south", "north") else (sfoot[3] - sfoot[1])
    sd = (sfoot[3] - sfoot[1]) if ss in ("south", "north") else (sfoot[2] - sfoot[0])
    centre = sa + sw / 2
    table = room.front(ss, room.rect(ss, centre - cw / 2, cw, sd + 0.45), cd)
    if room.free(table, ignore={sofa_idx}):
        room.add("CoffeeTable", table, None)
    # TV unit on the opposite wall, on the sofa's axis.
    tw, td = TV[tier]
    opp = room.opposite(ss)
    for shift in (0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9):
        a = centre - tw / 2 + shift
        lo, hi = room.along_range(opp)
        if a < lo - 1e-9 or a + tw > hi + 1e-9 or not room.walled(opp, a, tw):
            continue
        foot = room.rect(opp, a, tw, td)
        if room.free(foot, ignore={sofa_idx}) and not _overlap(foot, sclr):
            room.add("TvUnit", foot, opp)
            break
    # The view from the sofa to the TV wall stays open: nothing else (dining table) stands in it.
    view_w = min(sw, 1.6)
    axis = room.rect(ss, centre - view_w / 2, view_w, sd)
    room.clear.append((sofa_idx, room.front(ss, axis, max(0.0, room.depth_of(ss) - sd))))
    # Dining table between kitchen and living, chairs all round.
    clear = DINING_CLEAR[tier]
    for w, d in DINING[tier]:
        best = None
        b = room.box
        spots = []
        for rot in (False, True):
            tw2, td2 = (d, w) if rot else (w, d)
            xs = [b[0] + clear + tw2 / 2 + i * 0.2 for i in range(max(0, int((b[2] - b[0] - 2 * clear - tw2) / 0.2) + 1))]
            ys = [b[1] + clear + td2 / 2 + i * 0.2 for i in range(max(0, int((b[3] - b[1] - 2 * clear - td2) / 0.2) + 1))]
            spots += [(round(_dist((x, y), kitchen_mid), 6), rot, x, y, tw2, td2) for x in xs for y in ys]
        for dist, rot, x, y, tw2, td2 in sorted(spots):      # nearest to the kitchen first
            foot = (x - tw2 / 2, y - td2 / 2, x + tw2 / 2, y + td2 / 2)
            ring = (foot[0] - clear, foot[1] - clear, foot[2] + clear, foot[3] + clear)
            if room.free(foot, [ring]):
                best = (-dist, foot, ring)
                break
        if best:
            room.add("DiningTable", best[1], None, [best[2]])
            return
    # Small rooms: the table stands against a wall, chairs on the three open sides.
    for w, d in DINING[tier][-1:] + [(1.0, 0.7)]:
        options = []
        for s in SIDES:
            for a in room.anchors(s, w):
                if not room.walled(s, a, w):
                    continue
                foot = room.rect(s, a, w, d)
                ring = [room.front(s, foot, clear, widen=clear)] + room.sides_of(s, foot, clear)
                if room.free(foot, ring):
                    options.append((-_dist(_mid(foot), kitchen_mid), s, foot, ring))
        if options:
            options.sort(key=lambda o: (-o[0], SIDES.index(o[1]), o[2]))
            _, s, foot, ring = options[0]
            room.add("DiningTable", foot, s, ring)
            return


# -------------------------------------------------------------- bathroom --
def _bathroom(room, tier, main):
    seqs = []
    bathing = []
    if main or tier == "luxury":
        bathing += [("Bathtub", w, d, 0.6) for w, d in TUB[tier]]
    sw, sd = SHOWER[tier]
    bathing += [("Shower", sw, sd, 0.6), ("Shower", 0.8, 0.8, 0.55)]
    for b in bathing:
        seqs.append([b, "wc", "basin", "washer"])
    seqs.append(["wc", "basin", "washer"])
    seqs.append(["wc", "basin"])
    best = None
    for seq in seqs:
        trial = _Snapshot(room)
        ok, placed = _try_bath(trial.room, tier, seq, main)
        if not ok:
            continue
        score = sum({"Bathtub": 4, "Shower": 3, "Washer": 1}.get(k, 0) for k in placed)
        if best is None or score > best[0]:
            best = (score, trial)
        if score >= 4 + (1 if main and tier != "luxury" else 0):
            break
    if best is None:
        raise ValueError("furniture cannot be placed clear of doors: Toilet")
    best[1].commit(room)


class _Snapshot:
    """Copy of a room's placement state so a bathroom sequence can be tried and thrown away."""

    def __init__(self, room):
        self.room = object.__new__(_Room)
        self.room.__dict__.update(room.__dict__)
        self.room.feet = list(room.feet)
        self.room.clear = list(room.clear)
        self.room.items = list(room.items)

    def commit(self, room):
        room.feet, room.clear, room.items = self.room.feet, self.room.clear, self.room.items


def _try_bath(room, tier, seq, main):
    placed = []
    far_sides = sorted(SIDES, key=lambda s: (s in room.door_sides(), -room.depth_of(room.opposite(s))))
    for step in seq:
        if isinstance(step, tuple):
            kind, w, d, front = step
            hit = None
            for s in far_sides:
                for a in room.anchors(s, w):
                    lo, hi = room.along_range(s)
                    if not (abs(a - lo) < 1e-6 or abs(a + w - hi) < 1e-6):
                        continue                         # tubs and showers fill a corner
                    if not room.walled(s, a, w):
                        continue
                    foot = room.rect(s, a, w, d)
                    clr = room.front_mid(s, foot, front, 0.7)
                    if room.free(foot, [clr]):
                        hit = (s, foot, clr)
                        break
                if hit:
                    break
            if not hit:
                return False, placed
            room.add(kind, hit[1], hit[0], [hit[2]])
            placed.append(kind)
            continue
        if step == "wc":
            hit = _wall_spot(room, WC_ZONE, WC_DEPTH, WC_FRONT, prefer_far=True)
            if not hit:
                return False, placed
            s, foot, clr = hit
            room.add("Toilet", foot, s, [clr])
            placed.append("Toilet")
        elif step == "basin":
            bw, bd = BASIN[tier]
            hit = _wall_spot(room, bw, bd, 0.7, prefer_far=False) or _wall_spot(room, 0.5, 0.45, 0.6, prefer_far=False)
            if not hit:
                return False, placed
            s, foot, clr = hit
            room.add("Basin", foot, s, [clr])
            placed.append("Basin")
        elif step == "washer":
            if tier == "luxury" and main:
                continue
            hit = _wall_spot(room, WASHER[0], WASHER[1], 0.6, prefer_far=False)
            if hit:
                s, foot, clr = hit
                room.add("Washer", foot, s, [clr])
                placed.append("Washer")
    return True, placed


def _wall_spot(room, w, d, front, prefer_far):
    doors = room.doors
    options = []
    for s in SIDES:
        if room.depth_of(s) < d + front - 1e-9:
            continue
        for a in room.anchors(s, w):
            if not room.walled(s, a, w):
                continue
            foot = room.rect(s, a, w, d)
            clr = room.front(s, foot, front)
            if not room.free(foot, [clr]):
                continue
            m = _mid(foot)
            near = min((_dist(m, _door_point(room, ds, dc)) for ds, dc in doors), default=0)
            score = near if prefer_far else -near
            options.append((score, s, a, foot, clr))
    if not options:
        return None
    options.sort(key=lambda o: (-o[0], SIDES.index(o[1]), o[2]))
    _, s, a, foot, clr = options[0]
    return s, foot, clr


def _door_point(room, side, along):
    x1, y1, x2, y2 = room.r
    return {"south": (along, y1), "north": (along, y2), "west": (x1, along), "east": (x2, along)}[side]


# ------------------------------------------------------------------ unit --
_CACHE: dict = {}


def furnish(rooms, doors, walls=None, width=None, height=None, ext_t=0.0, int_t=0.0,
            entry=None, facades=(), tier="standard"):
    """All furniture of one unit.  Raises ValueError when a required item cannot be placed."""
    tier = tier if tier in TIERS else "standard"
    facades = set(facades or ())
    entry_point = None
    if entry is not None and width is not None:
        for d in doors:
            if d["host_wall"] == entry:
                entry_point = (d["center"]["x"], d["center"]["y"])
                break
    bedrooms = [r for r in rooms if r["name"].startswith("Унтлагын")]
    master = max(bedrooms, key=lambda r: ((r["x2"] - r["x1"]) * (r["y2"] - r["y1"]), r["name"]))["name"] if bedrooms else None
    baths = [r for r in rooms if r["name"].startswith("Ариун")]
    main_bath = baths[0]["name"] if baths else None
    result = []
    for r in rooms:
        name = r["name"]
        if not (name.startswith("Унтлагын") or name.startswith("Зочны") or name.startswith("Ариун")):
            continue
        room = _Room(r, doors, walls, width, height, ext_t, int_t, facades)
        kind = name[:5]
        flag = name == master if kind == "Унтла" else (name == main_bath if kind == "Ариун" else entry_point)
        # Many generated candidates share a room exactly (same rectangle, doors, walls,
        # windows): lay each distinct room out once.
        key = (kind, room.r, tuple(room.doors), tuple(tuple(room.covered[s]) for s in SIDES),
               tuple(sorted(room.facade)), room.box, tier, flag)
        cached = _CACHE.get(key)
        if cached is None:
            try:
                if kind == "Унтла":
                    _bedroom(room, tier, name == master)
                elif kind == "Зочны":
                    _living(room, tier, entry_point)
                else:
                    if not room.doors:
                        raise ValueError("bathroom entry not found")
                    _bathroom(room, tier, name == main_bath)
                cached = [dict(item) for item in room.items]
            except ValueError as error:
                cached = error
            if len(_CACHE) > 20000:
                _CACHE.clear()
            _CACHE[key] = cached
        if isinstance(cached, ValueError):
            raise ValueError(str(cached))
        result.extend(dict(item, room=name) for item in cached)
    return result
