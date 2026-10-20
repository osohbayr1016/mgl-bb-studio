"""MGL room-plan generator v2 — program-driven, daylight-aware, stdlib only.

Finch-style workflow, implemented locally without AI, API or network:
  program (bedrooms, bathrooms) + rules (hall width, minimum sizes)
  + daylight facades  ->  many topologically distinct rectangular layouts
  ->  every one validated (geometry, doors, reachability, furniture) and
  scored on area fit, daylight, squareness, circulation and zoning.

Plans are built in a LOCAL frame whose entrance is the south wall (y = 0),
then mirrored / rotated onto the real entrance side.  All values are
schematic product heuristics, NOT БНбД/MNS compliance.
"""
from __future__ import annotations

import math
import random

LIVING = "Зочны өрөө + гал тогоо"
HALL = "Хонгил"
BATH = "Ариун цэврийн өрөө"
STORAGE = "Агуулах"
SIDES = ("south", "north", "west", "east")
ROUND = 3            # millimetre grid: shared edges must be bit-identical
DOOR_MARGIN = 0.75   # C# GeometrySafe needs >= 0.65 from wall ends/junctions
SHORT_MARGIN = 0.68  # end-of-corridor doors on a 1.4 m hall end
# Хонгилын үзүүрт (орц) хаалга 0.65 м-ийн уулзварын зайтай (C# GeometrySafe) багтах
# хамгийн бага өргөн нь 2 × SHORT_MARGIN = 1.36 м.  Үүнээс нарийн хонгилоор үүсгэвэл
# `build_doors` бүх хонгилтой хувилбарыг ЧИМЭЭГҮЙ хаядаг байсан (2026-10-14 аудит:
# 1.2 м-ээр 25 нэгжийн 0-д хонгилтой хувилбар гарсан).  CLI нь хонгилыг энэ утгаар
# үүсгэж, хүсэлт нарийн байсныг анхааруулгаар ИЛ хэлнэ.
MIN_ENTRY_HALL = 1.4


def bed_name(i):
    return "Унтлагын өрөө " + str(i)


def bath_name(i):
    return BATH if i == 1 else BATH + " " + str(i)


def kind_of(name):
    if name == HALL:
        return "hall"
    if name.startswith("Унтлагын"):
        return "bed"
    if name.startswith("Ариун"):
        return "bath"
    if name.startswith("Агуулах"):
        return "storage"
    return "living"


# --------------------------------------------------------------- rules

class Rules:
    """Graph rules (Finch term): per-kind minimums and ideal targets."""

    def __init__(self, total, bedrooms, bathrooms, hall_width):
        self.hall = hall_width
        self.min_side = {"living": 3.0, "bed": 2.6, "bath": 2.2, "storage": 2.2}
        self.min_area = {"living": 14.0, "bed": 9.0, "bath": 5.0, "storage": 5.0}
        grow = max(0.0, min(1.0, (total - 45.0) / 80.0))
        self.ideal_bed_master = 12.5 + 4.5 * grow
        self.ideal_bed = 10.5 + 3.0 * grow
        self.ideal_bath = 5.4 + 1.6 * grow
        self.ideal_living = max(17.0, min(42.0, total * (0.36 if bedrooms == 1 else 0.29)))
        self.bedrooms, self.bathrooms = bedrooms, bathrooms

    def ideal(self, name):
        k = kind_of(name)
        if k == "living":
            return self.ideal_living
        if k == "bath":
            return self.ideal_bath if name == BATH else self.ideal_bath * 0.85
        if k == "bed":
            return self.ideal_bed_master if name == bed_name(1) else self.ideal_bed
        if k == "storage":
            return 6.0
        return 0.0

    def min_len(self, name, cross):
        """Smallest stacked length for a room whose other side is `cross`."""
        k = kind_of(name)
        if cross < self.min_side[k] - 1e-9:
            return None
        return max(self.min_side[k], self.min_area[k] / cross)


def program_rooms(bedrooms, bathrooms):
    return [LIVING] + [bed_name(i + 1) for i in range(bedrooms)] + \
        [bath_name(i + 1) for i in range(bathrooms)]


# ------------------------------------------------------------ packing

def split(lo, hi, names, cross, rules):
    """Split [lo, hi] into consecutive spans, one per name, weighted by ideal
    area and lifted to each room's minimum.  Returns cut positions or None."""
    total = hi - lo
    mins = []
    for n in names:
        m = rules.min_len(n, cross)
        if m is None:
            return None
        mins.append(m)
    if sum(mins) > total + 1e-9:
        return None
    weights = [rules.ideal(n) for n in names]
    lengths = [None] * len(names)
    free = list(range(len(names)))
    remaining = total
    while True:
        wsum = sum(weights[i] for i in free)
        bad = [i for i in free if remaining * weights[i] / wsum < mins[i]]
        if not bad:
            for i in free:
                lengths[i] = remaining * weights[i] / wsum
            break
        for i in bad:
            lengths[i] = mins[i]
            remaining -= mins[i]
            free.remove(i)
        if not free:
            if abs(remaining) > 1e-6:
                lengths[bad[-1]] += remaining
            break
    cuts, pos = [lo], lo
    for length in lengths:
        pos += length
        cuts.append(round(pos, ROUND))
    cuts[-1] = round(hi, ROUND)
    return cuts


def stack_y(x1, x2, y1, y2, names, rules, out):
    if not names:
        return True
    cuts = split(y1, y2, names, x2 - x1, rules)
    if cuts is None:
        return False
    for i, n in enumerate(names):
        out.append(rect(n, x1, cuts[i], x2, cuts[i + 1]))
    return True


def stack_x(x1, x2, y1, y2, names, rules, out):
    if not names:
        return True
    cuts = split(x1, x2, names, y2 - y1, rules)
    if cuts is None:
        return False
    for i, n in enumerate(names):
        out.append(rect(n, cuts[i], y1, cuts[i + 1], y2))
    return True


def rect(name, x1, y1, x2, y2):
    return {"name": name, "x1": round(x1, ROUND), "y1": round(y1, ROUND),
            "x2": round(x2, ROUND), "y2": round(y2, ROUND)}


def area_of(names, rules):
    return sum(rules.ideal(n) for n in names)


def min_stack(names, cross, rules):
    """Shortest length that can hold `names` stacked with the given cross
    dimension, or None when the cross dimension itself is too narrow."""
    total = 0.0
    for n in names:
        m = rules.min_len(n, cross)
        if m is None:
            return None
        total += m
    return total


def min_width(names, rules):
    return max([rules.min_side[kind_of(n)] for n in names] or [0.0])


def pick(lo, hi, target, rng, jitter=0.12):
    """Sample inside the feasible [lo, hi] around an area-derived target."""
    if lo > hi + 1e-9:
        return None
    value = target * rng.uniform(1 - jitter, 1 + jitter)
    if rng.random() < 0.25:
        value = rng.uniform(lo, hi)
    return round(min(hi, max(lo, value)), ROUND)


# ----------------------------------------------------------- families
# Each family returns (topology, rooms) or None.  W x D local, entry south.

def fam_spine(W, D, rules, rng, rooms, one_sided):
    """Hall from the entrance; rooms in one/two columns; optionally one room
    across the far end (classic 'living at the facade' corridor plan)."""
    hw = rules.hall
    rest = rooms[:]
    rng.shuffle(rest)
    top = []
    if rng.random() < 0.55:
        top = [rest.pop(rng.randrange(len(rest)))]
    if one_sided:
        left, right = [], rest
    else:
        k = rng.randint(1, max(1, len(rest) - 1))
        left, right = rest[:k], rest[k:]
    # Column widths: feasible range from the widest minimum side.
    if one_sided:
        c = 0.0
    else:
        al, ar = area_of(left, rules), area_of(right, rules)
        lo_c, hi_c = min_width(left, rules), W - hw - min_width(right, rules)
        c = pick(lo_c, hi_c, (W - hw) * al / (al + ar), rng)
        if c is None:
            return None
    rw = W - hw - c
    if one_sided and rw < min_width(right, rules):
        return None
    need = max(min_stack(left, c, rules) if left else 0.0,
               min_stack(right, rw, rules) if right else 0.0, 3.0) \
        if (not left or min_stack(left, c, rules) is not None) and \
           (min_stack(right, rw, rules) is not None) else None
    if need is None:
        return None
    if top:
        top_min = rules.min_len(top[0], W)
        if top_min is None:
            return None
        top_d = pick(top_min, D - need, area_of(top, rules) / W, rng)
        if top_d is None:
            return None
    else:
        top_d = 0.0
    lh = round(D - top_d, ROUND)
    out = [rect(HALL, c, 0, c + hw, lh)]
    if not stack_y(0, c, 0, lh, left, rules, out):
        return None
    if not stack_y(c + hw, W, 0, lh, right, rules, out):
        return None
    if top:
        out.append(rect(top[0], 0, lh, W, D))
    return ("side-hall" if one_sided else "central-hall"), out


def fam_t_hall(W, D, rules, rng, rooms):
    """Entry foyer -> cross corridor (T) or one-armed corridor (L).
    Habitable rooms line the far facade above the corridor; wet rooms and
    overflow sit beside the foyer.  The typical single-facade apartment."""
    hw = rules.hall
    rest = rooms[:]
    rng.shuffle(rest)
    habitable = [n for n in rest if kind_of(n) != "bath"]
    baths = [n for n in rest if kind_of(n) == "bath"]
    keep = rng.randint(max(1, len(habitable) - 2), len(habitable))
    row, side = habitable[:keep], habitable[keep:] + baths
    rng.shuffle(side)
    if len(side) > 4:
        return None
    k = rng.randint(max(0, len(side) - 2), min(2, len(side)))
    left, right = side[:k], side[k:]
    # A non-empty side sits under a corridor arm (flank) or runs full depth
    # beside the foyer (column).  At least one arm, otherwise it is a spine.
    left_arm = bool(left) and rng.random() < 0.6
    right_arm = bool(right) and rng.random() < 0.6
    if not left_arm and not right_arm:
        if left and (not right or rng.random() < 0.5):
            left_arm = True
        elif right:
            right_arm = True
        else:
            return None
    free = W - hw
    if left and right:
        al, ar = area_of(left, rules), area_of(right, rules)
        c = pick(min_width(left, rules), free - min_width(right, rules),
                 free * al / (al + ar), rng)
    elif left:
        c = round(free, ROUND)
    elif right:
        c = 0.0
    else:
        return None
    if c is None:
        return None
    L = 0.0 if left_arm else c
    R = W if right_arm else round(c + hw, ROUND)
    span = R - L
    if span < 2.6:
        return None
    # Corridor depth: flanks under the arms need their stacked minimum, the
    # facade row needs its minimum depth; sample between the two.
    # Rooms under an arm either stack (each opens onto the foyer) or sit side
    # by side (each opens onto the arm above) — whichever the width allows.
    lo_y = 2.2
    beside = {}
    for name, flank, width, arm in (("l", left, c, left_arm), ("r", right, W - c - hw, right_arm)):
        if not (flank and arm):
            continue
        widths = sum(min_width([n], rules) for n in flank)
        beside[name] = len(flank) > 1 and width >= widths + 0.2 and rng.random() < 0.7
        if beside[name]:
            m = min_width(flank, rules)
        else:
            m = min_stack(flank, width, rules)
        if m is None:
            return None
        lo_y = max(lo_y, m)
    row_min = max(min_width(row, rules),
                  sum(rules.min_area[kind_of(n)] for n in row) / span)
    target = D - hw - area_of(row, rules) / span
    yc = pick(lo_y, D - hw - row_min, target, rng, 0.15)
    if yc is None:
        return None
    # A flank holding only wet rooms would turn into a 20 m2 bathroom; give
    # the leftover depth to a storage / wardrobe room instead.
    for name, flank, x1, x2, arm in (("l", left, 0.0, c, left_arm), ("r", right, c + hw, W, right_arm)):
        depth = yc if arm else D
        if flank and all(kind_of(n) == "bath" for n in flank) and \
                (x2 - x1) * depth > 1.7 * area_of(flank, rules) and len(flank) < 2:
            flank.insert(rng.randint(0, len(flank)), STORAGE)
            if arm:
                beside[name] = (x2 - x1) >= 4.6 and (depth < 4.6 or rng.random() < 0.5)
    if left.count(STORAGE) + right.count(STORAGE) > 1:
        return None
    out = [rect(HALL, c, 0, c + hw, yc), rect(HALL, L, yc, R, yc + hw)]
    if not stack_x(L, R, yc + hw, D, row, rules, out):
        return None
    # Beside the foyer: below the arm, or a full-depth column without one.
    for name, flank, x1, x2, arm in (("l", left, 0.0, c, left_arm), ("r", right, c + hw, W, right_arm)):
        if arm and beside.get(name):
            ok = stack_x(x1, x2, 0, yc, flank, rules, out)
        else:
            ok = stack_y(x1, x2, 0, yc if arm else D, flank, rules, out)
        if not ok:
            return None
    if (c > 0.01 and not left) or (W - c - hw > 0.01 and not right):
        return None
    return ("t-hall" if left_arm and right_arm else "l-hall"), out


def fam_gallery(W, D, rules, rng, rooms):
    """Corridor along the entrance wall; rooms in a row reach the facade."""
    hw = rules.hall
    row = rooms[:]
    rng.shuffle(row)
    corner = None
    if rng.random() < 0.4 and len(row) > 2:
        corner = row.pop()
    out = []
    end = W
    if corner:
        cw = max(rules.min_len(corner, D) or 99, area_of([corner], rules) / D)
        cw = round(cw * rng.uniform(1.0, 1.15), ROUND)
        end = round(W - cw, ROUND)
        if end < 4.0:
            return None
        out.append(rect(corner, end, 0, W, D))
    out.append(rect(HALL, 0, 0, end, hw))
    if not stack_x(0, end, hw, D, row, rules, out):
        return None
    return "entry-gallery", out


def fam_hub(W, D, rules, rng, rooms, shape):
    """No corridor: the living room is the circulation hub."""
    rest = [n for n in rooms if n != LIVING]
    rng.shuffle(rest)
    out = []
    if shape == "band":
        d = max(area_of([LIVING], rules) / W * rng.uniform(0.95, 1.3), 3.3)
        d = round(d, ROUND)
        if D - d < 2.6:
            return None
        out.append(rect(LIVING, 0, 0, W, d))
        if not stack_x(0, W, d, D, rest, rules, out):
            return None
        return "living-hub", out
    if shape == "column":
        a = max(area_of([LIVING], rules) / D * rng.uniform(0.95, 1.3), 3.3)
        a = round(a, ROUND)
        if W - a < 2.6:
            return None
        out.append(rect(LIVING, 0, 0, a, D))
        if not stack_y(a, W, 0, D, rest, rules, out):
            return None
        return "living-column", out
    # split: living in the middle, private rooms on both sides
    if len(rest) < 2:
        return None
    k = rng.randint(1, len(rest) - 1)
    left, right = rest[:k], rest[k:]
    a = max(area_of([LIVING], rules) / D * rng.uniform(0.95, 1.25), 3.3)
    al, ar = area_of(left, rules) / D, area_of(right, rules) / D
    lw = round((W - a) * al / (al + ar), ROUND)
    rw0 = round(lw + a, ROUND)
    if lw < 2.2 or W - rw0 < 2.2:
        return None
    out.append(rect(LIVING, lw, 0, rw0, D))
    if not stack_y(0, lw, 0, D, left, rules, out):
        return None
    if not stack_y(rw0, W, 0, D, right, rules, out):
        return None
    return "split-living", out


FAMILIES = (
    ("central-hall", lambda W, D, r, g, rooms: fam_spine(W, D, r, g, rooms, False)),
    ("side-hall", lambda W, D, r, g, rooms: fam_spine(W, D, r, g, rooms, True)),
    ("t-hall", fam_t_hall),
    ("entry-gallery", fam_gallery),
    ("living-hub", lambda W, D, r, g, rooms: fam_hub(W, D, r, g, rooms, "band")),
    ("living-column", lambda W, D, r, g, rooms: fam_hub(W, D, r, g, rooms, "column")),
    ("split-living", lambda W, D, r, g, rooms: fam_hub(W, D, r, g, rooms, "split")),
)


# -------------------------------------------------- walls and doors

def _shared(a, b):
    """Shared edge of two rects: ('v', x, lo, hi) / ('h', y, lo, hi) / None."""
    for (p, q) in ((a["x2"], b["x1"]), (b["x2"], a["x1"])):
        if p == q:
            lo, hi = max(a["y1"], b["y1"]), min(a["y2"], b["y2"])
            if hi - lo > 1e-6:
                return ("v", p, lo, hi)
    for (p, q) in ((a["y2"], b["y1"]), (b["y2"], a["y1"])):
        if p == q:
            lo, hi = max(a["x1"], b["x1"]), min(a["x2"], b["x2"])
            if hi - lo > 1e-6:
                return ("h", p, lo, hi)
    return None


def build_walls(rooms, W, D):
    """Interior walls = every shared room edge except hall<->hall (open),
    merged into maximal collinear segments."""
    lines = {}
    for i, a in enumerate(rooms):
        for b in rooms[i + 1:]:
            if a["name"] == HALL and b["name"] == HALL:
                continue
            s = _shared(a, b)
            if s is None:
                continue
            o, at, lo, hi = s
            if (o == "v" and at in (0, W)) or (o == "h" and at in (0, D)):
                continue
            lines.setdefault((o, at), []).append((lo, hi))
    walls = []
    for (o, at), spans in sorted(lines.items()):
        spans.sort()
        merged = [list(spans[0])]
        for lo, hi in spans[1:]:
            if lo <= merged[-1][1] + 1e-6:
                merged[-1][1] = max(merged[-1][1], hi)
            else:
                merged.append([lo, hi])
        for lo, hi in merged:
            wid = "w" + str(len(walls) + 1)
            if o == "v":
                walls.append({"id": wid, "o": o, "at": at, "lo": lo, "hi": hi})
            else:
                walls.append({"id": wid, "o": o, "at": at, "lo": lo, "hi": hi})
    for side, o, at, length in (("south", "h", 0, W), ("north", "h", D, W),
                                ("west", "v", 0, D), ("east", "v", W, D)):
        walls.append({"id": side, "o": o, "at": at, "lo": 0.0, "hi": length})
    return walls


def _host(walls, o, at, lo, hi):
    for w in walls:
        if w["o"] == o and w["at"] == at and w["lo"] <= lo + 1e-6 and w["hi"] >= hi - 1e-6:
            return w
    return None


def _door_pos(lo, hi, prefer):
    length = hi - lo
    if length >= 2 * DOOR_MARGIN + 0.2:
        a, b = lo + DOOR_MARGIN + 0.1, hi - DOOR_MARGIN - 0.1
        p = a if abs(a - prefer) <= abs(b - prefer) else b
        return round(p, ROUND)
    if length >= 2 * SHORT_MARGIN:
        return round((lo + hi) / 2, ROUND)
    return None


def build_doors(rooms, walls, W):
    """Entry door + one door per room toward the hall (or living hub).
    Returns doors or None when a room cannot be connected."""
    halls = [r for r in rooms if r["name"] == HALL]
    living = next(r for r in rooms if r["name"] == LIVING)
    doors = []
    # Entrance: a hall piece on the south wall, else the living room.
    entry_room = next((r for r in halls if r["y1"] == 0), None)
    if entry_room is None and living["y1"] == 0:
        entry_room = living
    if entry_room is None:
        return None
    lo, hi = entry_room["x1"], entry_room["x2"]
    p = _door_pos(lo, hi, (lo + hi) / 2) if hi - lo < 2.4 else round((lo + hi) / 2, ROUND)
    if p is None:
        return None
    doors.append({"host_wall": "south", "center": (p, 0.0)})
    ex = p
    for r in rooms:
        if r["name"] == HALL or r is entry_room:
            continue
        targets = halls if halls else []
        best = None
        for t in targets:
            s = _shared(r, t)
            if s is not None and (best is None or s[3] - s[2] > best[3] - best[2]):
                best = s
        via_living = False
        if best is None or best[3] - best[2] < 2 * SHORT_MARGIN:
            if r is living:
                return None
            s = _shared(r, living)
            if s is None:
                return None
            best, via_living = s, True
        o, at, lo, hi = best
        host = _host(walls, o, at, lo, hi)
        if host is None:
            return None
        p = _door_pos(lo, hi, ex if o == "h" else 0.0)
        if p is None:
            return None
        center = (at, p) if o == "v" else (p, at)
        doors.append({"host_wall": host["id"], "center": center, "room": r["name"],
                      "via_living": via_living})
    # Two doors on one wall must be >= 1.45 m apart (C# GeometrySafe).
    for i, a in enumerate(doors):
        for b in doors[i + 1:]:
            if a["host_wall"] == b["host_wall"] and math.hypot(
                    a["center"][0] - b["center"][0], a["center"][1] - b["center"][1]) < 1.5:
                return None
    return doors


# --------------------------------------------------------- transform

class Frame:
    """Local (entry = south) <-> world for one entrance side and mirror."""

    def __init__(self, width, height, entry, mirror):
        self.entry, self.mirror = entry, mirror
        self.W, self.D = (height, width) if entry in ("east", "west") else (width, height)
        self.wout, self.hout = width, height

    def pt(self, x, y):
        if self.mirror:
            x = self.W - x
        e = self.entry
        if e == "north":
            x, y = self.W - x, self.D - y
        elif e == "east":
            x, y = self.D - y, x
        elif e == "west":
            x, y = y, self.W - x
        return round(x, 6), round(y, 6)

    def side(self, local_side):
        mids = {"south": (self.W / 2, 0), "north": (self.W / 2, self.D),
                "west": (0, self.D / 2), "east": (self.W, self.D / 2)}
        x, y = self.pt(*mids[local_side])
        if abs(y) < 1e-6:
            return "south"
        if abs(y - self.hout) < 1e-6:
            return "north"
        if abs(x) < 1e-6:
            return "west"
        return "east"

    def local_sides(self, world_sides):
        return {s for s in SIDES if self.side(s) in world_sides}


def to_world(frame, rooms, walls, doors):
    out_rooms = []
    for r in rooms:
        a = frame.pt(r["x1"], r["y1"])
        b = frame.pt(r["x2"], r["y2"])
        out_rooms.append({"name": r["name"], "x1": min(a[0], b[0]), "y1": min(a[1], b[1]),
                          "x2": max(a[0], b[0]), "y2": max(a[1], b[1])})
    out_walls = []
    for w in walls:
        if w["id"] in SIDES:
            continue
        if w["o"] == "v":
            s, e = frame.pt(w["at"], w["lo"]), frame.pt(w["at"], w["hi"])
        else:
            s, e = frame.pt(w["lo"], w["at"]), frame.pt(w["hi"], w["at"])
        out_walls.append({"id": w["id"], "start": {"x": s[0], "y": s[1]},
                          "end": {"x": e[0], "y": e[1]}})
    W, H = frame.wout, frame.hout
    for wid, coords in (("south", (0, 0, W, 0)), ("north", (0, H, W, H)),
                        ("west", (0, 0, 0, H)), ("east", (W, 0, W, H))):
        out_walls.append({"id": wid, "start": {"x": coords[0], "y": coords[1]},
                          "end": {"x": coords[2], "y": coords[3]}})
    out_doors = []
    for d in doors:
        c = frame.pt(*d["center"])
        host = frame.side(d["host_wall"]) if d["host_wall"] in SIDES else d["host_wall"]
        out_doors.append({"host_wall": host, "center": {"x": c[0], "y": c[1]}})
    return out_rooms, out_walls, out_doors


# ----------------------------------------------------------- scoring

def facade_contact(room, W, D, facades):
    total = 0.0
    if "south" in facades and abs(room["y1"]) < 1e-4:
        total += room["x2"] - room["x1"]
    if "north" in facades and abs(room["y2"] - D) < 1e-4:
        total += room["x2"] - room["x1"]
    if "west" in facades and abs(room["x1"]) < 1e-4:
        total += room["y2"] - room["y1"]
    if "east" in facades and abs(room["x2"] - W) < 1e-4:
        total += room["y2"] - room["y1"]
    return total


def evaluate(rooms, W, D, rules, facades, via_living=()):
    """Finch-like 0-100 score with a breakdown.  `facades` are LOCAL sides
    that may carry windows.  Pure geometry; no code-compliance claim."""
    habitable = [r for r in rooms if kind_of(r["name"]) in ("living", "bed")]
    lit, lit_weight = 0, 0.0
    hab_weight = sum(2.0 if kind_of(r["name"]) == "living" else 1.0 for r in habitable)
    room_report = []
    area_fit, square = [], []
    for r in rooms:
        k = kind_of(r["name"])
        w, h = r["x2"] - r["x1"], r["y2"] - r["y1"]
        area = w * h
        if k == "hall":
            continue
        ideal = rules.ideal(r["name"])
        dev = (area - ideal) / ideal
        # Undersized rooms hurt; generous ones only mildly (big units), but
        # an oversized bathroom is wasted floor area.
        tolerance = {"bath": 0.35, "living": 0.35, "bed": 0.5, "storage": 0.6}[k]
        if -0.12 <= dev <= tolerance:
            fit = 1.0
        elif dev < 0:
            fit = max(0.0, 1 + (dev + 0.12) * 3.0)
        else:
            fit = max(0.0, 1 - (dev - tolerance) * (1.6 if k in ("bath", "storage") else 0.9))
        area_fit.append(fit)
        ratio = max(w, h) / min(w, h)
        limit = 2.2 if k == "living" else 1.7
        square.append(1.0 if ratio <= limit else max(0.0, 1 - (ratio - limit) / 1.4))
        contact = facade_contact(r, W, D, facades)
        need = 2.4 if k == "living" else 1.2
        daylit = k in ("living", "bed") and contact >= need
        if daylit:
            lit += 1
            lit_weight += 2.0 if k == "living" else 1.0
        room_report.append({"name": r["name"], "area_m2": round(area, 2),
                            "ideal_m2": round(ideal, 1), "fit": round(fit, 2),
                            "facade_m": round(contact, 2),
                            "daylit": daylit if k in ("living", "bed") else None})
    # The living room counts double: a dark living room is the worst miss.
    # Squared: a windowless bedroom/living room is a design defect (habitable
    # rooms need daylight), not a small trade-off against room size.
    daylight = (lit_weight / hab_weight) ** 2 if (habitable and facades) else 1.0
    hall_area = sum((r["x2"] - r["x1"]) * (r["y2"] - r["y1"])
                    for r in rooms if r["name"] == HALL)
    frac = hall_area / (W * D)
    circulation = 1.0 if frac <= 0.08 else max(0.0, 1 - (frac - 0.08) / 0.14)
    beds_via_living = sum(1 for n in via_living if kind_of(n) == "bed")
    baths_via_living = sum(1 for n in via_living if kind_of(n) == "bath")
    zoning = 1.0
    if rules.bedrooms > 1:
        zoning -= 0.18 * beds_via_living
    zoning -= 0.25 * baths_via_living
    # Wet rooms that share a wall = one plumbing riser (cheaper, quieter).
    baths = [r for r in rooms if kind_of(r["name"]) == "bath"]
    if len(baths) == 2 and _shared(baths[0], baths[1]) is None:
        zoning -= 0.1
    # Wet rooms on the daylight facade waste window frontage.
    if facades and any(facade_contact(b, W, D, facades) > 0 for b in baths):
        zoning -= 0.12
    zoning = max(0.0, zoning)
    parts = {
        "daylight": round(daylight, 3),
        # One badly sized / badly shaped room spoils a plan even when the
        # average looks fine (Finch marks it red): blend mean with the worst.
        "area_fit": round(0.6 * sum(area_fit) / len(area_fit) + 0.4 * min(area_fit), 3),
        "squareness": round(0.6 * sum(square) / len(square) + 0.4 * min(square), 3),
        "circulation": round(circulation, 3),
        "zoning": round(zoning, 3),
    }
    weights = {"daylight": 0.32, "area_fit": 0.23, "squareness": 0.15,
               "circulation": 0.12, "zoning": 0.18}
    score = 100 * sum(parts[k] * weights[k] for k in weights)
    return round(score, 2), parts, room_report, lit, len(habitable)


# ---------------------------------------------------------- generate

def generate(width, height, bedrooms, bathrooms, entry, facades, hall_width,
             seed, samples=70):
    """Return candidate plans in WORLD coordinates (validated later by the
    shared validator / furniture planner).  Deterministic for given input."""
    rng = random.Random(seed)
    names = program_rooms(bedrooms, bathrooms)
    results, seen = [], set()
    for mirror in (False, True):
        frame = Frame(width, height, entry, mirror)
        W, D = frame.W, frame.D
        rules = Rules(W * D, bedrooms, bathrooms, hall_width)
        local_facades = frame.local_sides(set(facades))
        for family, build in FAMILIES:
            found = 0
            # Cheap rejections are fine: keep drawing until this family has
            # `samples` distinct candidates or the attempt budget is spent.
            for _ in range(samples * 5):
                if found >= samples:
                    break
                try:
                    made = build(W, D, rules, rng, names)
                except (ValueError, ZeroDivisionError, TypeError):
                    made = None
                if made is None:
                    continue
                topology, rooms = made
                key = tuple(sorted((r["name"], r["x1"], r["y1"], r["x2"], r["y2"])
                                   for r in rooms))
                if key in seen:
                    continue
                seen.add(key)
                found += 1
                renumber(rooms)
                if not _program_ok(rooms, rules):
                    continue
                walls = build_walls(rooms, W, D)
                doors = build_doors(rooms, walls, W)
                if doors is None:
                    continue
                via = [d["room"] for d in doors if d.get("via_living")]
                score, parts, report, lit, hab = evaluate(rooms, W, D, rules,
                                                          local_facades, via)
                wr, ww, wd = to_world(frame, rooms, walls, doors)
                results.append({
                    "seed_id": "gen-" + topology, "seed_name": None,
                    "topology": topology, "width_m": float(width), "height_m": float(height),
                    "rooms": wr, "walls": ww, "doors": wd,
                    "score": score, "score_parts": parts, "room_report": report,
                    "daylit_rooms": lit, "habitable_rooms": hab,
                })
    return results


def renumber(rooms):
    """Largest bedroom = 'Унтлагын өрөө 1' (master), largest bath = main bath."""
    for kind, namer in (("bed", bed_name), ("bath", bath_name)):
        group = sorted((r for r in rooms if kind_of(r["name"]) == kind),
                       key=lambda r: (-(r["x2"] - r["x1"]) * (r["y2"] - r["y1"]),
                                      r["y1"], r["x1"]))
        for i, r in enumerate(group):
            r["name"] = namer(i + 1)


def _program_ok(rooms, rules):
    for r in rooms:
        k = kind_of(r["name"])
        if k == "hall":
            continue
        w, h = r["x2"] - r["x1"], r["y2"] - r["y1"]
        if min(w, h) < rules.min_side[k] - 1e-6 or w * h < rules.min_area[k] - 1e-6:
            return False
    return True


def score_world(option_rooms, width, height, entry, facades, bedrooms, bathrooms,
                hall_width, via_living=()):
    """Score any world-coordinate plan (legacy templates, saved plans) on the
    same scale as generated ones, so the ranking is comparable."""
    # Facade sides are world sides and the rooms are world rectangles.
    rules = Rules(width * height, bedrooms, bathrooms, hall_width)
    return evaluate(option_rooms, width, height, rules, set(facades), via_living)
