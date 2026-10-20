"""MGL offline room-plan engine v1: Python 3 stdlib only; NO AI, API or network.

Input: one JSON object on stdin; output: one JSON object on stdout.
Commands: generate_batch, record_event, analytics, health.
The Revit add-in is responsible for final geometry/Family collision validation.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import sqlite3
import sys
import uuid
from collections import Counter
from plan_archetypes import seed_options
from plan_validation import validate_plan, _touches
from plan_generator import MIN_ENTRY_HALL, generate as generate_plans, score_world
from plan_furniture import TIERS, furnish
from datetime import datetime, timedelta, timezone

VERSION = "py-rp-12"
REASONS = {
    "too_small", "bad_circulation", "door_conflict", "bad_furniture",
    "poor_daylight", "wet_zone", "not_preferred", "other"
}
ACTIONS = {"viewed", "selected", "rejected", "applied", "apply_failed"}
ENTRIES = {"south", "north", "east", "west"}
MAX_UNITS, MAX_OPTIONS = 24, 36


def require(test: bool, message: str):
    if not test:
        raise ValueError(message)


FIELD_LABELS = {"width_m": "Нэгжийн өргөн", "height_m": "Нэгжийн гүн", "hall_width": "Хонгилын өргөн",
                "exterior_wall_thickness_m": "Гадна ханын зузаан",
                "interior_wall_thickness_m": "Дотор ханын зузаан"}


def number(x, name: str, lo: float, hi: float) -> float:
    # Архитекторт шууд харагддаг (Revit цонх) — түлхүүрийн нэр биш, утгатай мессеж.
    label = FIELD_LABELS.get(name, name)
    shown = x if type(x) in (int, float) else "тоо биш"
    require(type(x) in (int, float) and math.isfinite(x) and lo <= x <= hi,
            "%s %g–%g м байх ёстой (одоо: %s)" % (label, lo, hi, shown))
    return float(x)


def db_file() -> Path:
    override = os.environ.get("MGL_ROOMPLAN_DB_PATH")
    if override:
        return Path(override)
    parent = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / ".local" / "share")))
    return parent / "RevitMcpAddin" / "roomplan-preferences.sqlite3"


# Сонголтын сан нь ЗӨВХӨН сайжруулалт: эвдэрсэн / түгжигдсэн сан генерацийг хэзээ ч зогсоохгүй.
PROPOSAL_RETENTION_DAYS = 30


def quarantine_db(reason: str) -> str | None:
    """Эвдэрсэн санг `.corrupt-<utc>` нэрээр хадгалаад зайлуулна (устгахгүй)."""
    path = db_file()
    if not path.exists():
        return None
    target = path.with_name(path.name + ".%s-%s" % (reason, datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")))
    try:
        path.rename(target)
    except OSError:
        return None
    for suffix in ("-wal", "-shm"):
        side = path.with_name(path.name + suffix)
        try:
            if side.exists():
                side.rename(target.with_name(target.name + suffix))
        except OSError:
            pass
    return target.name


def open_db():
    """(con, warning) — сан ашиглах боломжгүй бол con=None, warning=шалтгаан.

    Эвдэрсэн файл («not a database», «malformed») хадгалагдаад шинээр үүснэ;
    түгжигдсэн сан (өөр Revit процесс) хөндөгдөхгүй — энэ удаа түүхгүйгээр үүсгэнэ.
    """
    try:
        return connect(), None
    except (sqlite3.Error, OSError) as ex:
        text = str(ex)
        if isinstance(ex, sqlite3.DatabaseError) and ("not a database" in text or "malformed" in text):
            moved = quarantine_db("corrupt")
            try:
                return connect(), ("Сонголтын сан эвдэрсэн байсан тул шинээр үүсгэв" +
                                   (" (хуучныг %s нэрээр хадгалав)" % moved if moved else ""))
            except (sqlite3.Error, OSError) as again:
                text = str(again)
        return None, "Сонголтын сан ашиглах боломжгүй (%s) — энэ удаа түүх/суралцалгүйгээр гаргав, санал хадгалагдаагүй" % text


def connect():
    path = db_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(path), timeout=5)
    try:
        _prepare(con)
    except BaseException:
        # Windows: нээлттэй холболт файлыг түгжинэ — эвдэрсэн санг хадгалж
        # зайлуулахын (rename) өмнө ЗААВАЛ хаана.
        con.close()
        raise
    return con


def _prepare(con):
    con.execute("PRAGMA busy_timeout=5000")
    con.execute("""CREATE TABLE IF NOT EXISTS proposals(
        batch_id TEXT NOT NULL, unit_id TEXT NOT NULL, option_id TEXT NOT NULL,
        template TEXT NOT NULL, score REAL NOT NULL, created_utc TEXT NOT NULL,
        PRIMARY KEY(batch_id, unit_id, option_id))""")
    con.execute("""CREATE TABLE IF NOT EXISTS feedback(
        event_id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, unit_id TEXT NOT NULL,
        option_id TEXT NOT NULL, action TEXT NOT NULL, reason TEXT,
        created_utc TEXT NOT NULL,
        FOREIGN KEY(batch_id, unit_id, option_id)
          REFERENCES proposals(batch_id, unit_id, option_id))""")
    # Compatible with SQLite databases created by the earlier MGL MVP.
    columns = {row[1] for row in con.execute("PRAGMA table_info(proposals)")}
    if "option_json" not in columns:
        con.execute("ALTER TABLE proposals ADD COLUMN option_json TEXT")
    con.execute("""CREATE TABLE IF NOT EXISTS applied_plan_library(
        option_id TEXT PRIMARY KEY, bedrooms INTEGER NOT NULL,
        entry TEXT NOT NULL, width_m REAL NOT NULL, height_m REAL NOT NULL,
        option_json TEXT NOT NULL, created_utc TEXT NOT NULL)""")
    con.execute("CREATE INDEX IF NOT EXISTS idx_saved_context ON applied_plan_library(bedrooms,entry)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_feedback_option ON feedback(batch_id,unit_id,option_id)")
    con.execute("PRAGMA foreign_keys=ON")


def utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def template_stats(con) -> dict[str, tuple[int, int, int]]:
    """Exposure-adjusted preference signals from confirmed actions only.

    Rejections count only when the architect explicitly chose a reason.
    Repeated rejection events for the same proposal count at most once.
    """
    generated = dict(con.execute("SELECT template, COUNT(*) FROM proposals GROUP BY template"))
    applied = dict(con.execute("""SELECT p.template,COUNT(*) FROM feedback f JOIN proposals p
        ON p.batch_id=f.batch_id AND p.unit_id=f.unit_id AND p.option_id=f.option_id
        WHERE f.action='applied' GROUP BY p.template"""))
    rejected = dict(con.execute("""SELECT template,COUNT(*) FROM (
        SELECT DISTINCT p.template,p.batch_id,p.unit_id,p.option_id
        FROM feedback f JOIN proposals p ON
        p.batch_id=f.batch_id AND p.unit_id=f.unit_id AND p.option_id=f.option_id
        WHERE f.action='rejected') GROUP BY template"""))
    return {k: (v, applied.get(k, 0), rejected.get(k, 0))
            for k, v in generated.items()}


def pt(x, y):
    return {"x": round(x, 6), "y": round(y, 6)}


def make(width, height, bedrooms, index, entry):
    # Central corridor: 24 parameter candidates. Side-corridor: 12 further candidates.
    # All geometry is a schematic proposal, NOT code compliance.
    swap = index % 2 == 1
    corridor_shift = (-0.42, -0.15, 0.15, 0.42)[(index // 2) % 4]
    cut = (0.47, 0.55, 0.63)[(index // 8) % 3]
    base_w, base_h = (height, width) if entry in ("east", "west") else (width, height)
    require(base_w >= (10.5 if bedrooms == 3 else 8.0) and base_h >= 7.8,
            "footprint too small for this bedroom count")
    cx = base_w / 2 + corridor_shift
    left, right = cx - 0.8, cx + 0.8
    require(left > 2.5 and base_w - right > 2.5, "corridor leaves too little room")

    walls, rooms, doors = [], [], []
    def wall(id, x1, y1, x2, y2):
        walls.append({"id": id, "start": pt(x1, y1), "end": pt(x2, y2)})
    def room(name, x1, y1, x2, y2, host):
        require(x2 > x1 and y2 > y1, "inverted room")
        rooms.append({"name": name, "x1": x1, "y1": y1, "x2": x2, "y2": y2})
        if host:
            doors.append({"host_wall": host, "center": pt(x2 if host == "hall-west" else x1,
                                                       (y1 + y2) / 2)})
    if index >= 24:
        # Distinct topology: side corridor with ALL rooms on a single side.
        # Mirroring moves corridor to the opposite exterior wall.
        # Entrance is on the selected exterior side; every private room has
        # its own door directly off the side hall. Fail-closed on narrow units.
        require(base_w >= 8.0 and base_h >= (10.7 if bedrooms == 3 else 8.2),
                "side-hall requires a taller footprint")
        hall_x = 1.6
        for wid, coords in (
            ("south",(0,0,base_w,0)),("north",(0,base_h,base_w,base_h)),
            ("west",(0,0,0,base_h)),("east",(base_w,0,base_w,base_h))
        ):
            wall(wid,*coords)
        wall("hall-east",hall_x,0,hall_x,base_h)
        doors.append({"host_wall":"south","center":pt(0.80,0)})
        room("Хонгил",0,0,hall_x,base_h,None)
        if bedrooms == 1:
            cuts=[0,0.23,0.60,1]
            names=["Ариун цэврийн өрөө","Унтлагын өрөө 1",
                   "Зочны өрөө + гал тогоо"]
        elif bedrooms == 2:
            cuts=[0,0.22,0.46,0.70,1]
            names=["Ариун цэврийн өрөө","Унтлагын өрөө 1",
                   "Унтлагын өрөө 2","Зочны өрөө + гал тогоо"]
        else:
            # Five usable rooms along one hallway. Any smaller than this
            # needs a different graph/solver, not squeezed sleeping spaces.
            cuts=[0,0.20,0.40,0.60,0.80,1]
            names=["Ариун цэврийн өрөө","Унтлагын өрөө 1",
                   "Унтлагын өрөө 2","Унтлагын өрөө 3",
                   "Зочны өрөө + гал тогоо"]
        # The wet room is always the first band. Revit rejects a room under
        # 2.15 m (RoomPlanRanking.GeometrySafe), so widen a too-thin bath band
        # and rescale the rest instead of handing Revit a plan it will drop.
        bath_frac = max(cuts[1], 2.3/base_h)
        if bath_frac > cuts[1]:
            cuts = [0, bath_frac] + [bath_frac + (c-cuts[1])*(1-bath_frac)/(1-cuts[1])
                                     for c in cuts[2:]]
        # Different interior space sequences, without fabricating duplicate
        # layouts from changing an unused corridor parameter.
        sequence = (index-24)//2
        if sequence % 3 == 1:
            names[-2],names[-1]=names[-1],names[-2]
        elif sequence % 3 == 2:
            names[1],names[-1]=names[-1],names[1]
        for j,name in enumerate(names):
            y1,y2=base_h*cuts[j],base_h*cuts[j+1]
            if j>0:
                wall("side-partition-"+str(j),hall_x,y1,base_w,y1)
            room(name,hall_x,y1,base_w,y2,"hall-east")
    else:
        for id, coords in (
            ("south", (0, 0, base_w, 0)),
            ("north", (0, base_h, base_w, base_h)),
            ("west", (0, 0, 0, base_h)),
            ("east", (base_w, 0, base_w, base_h)),
            ("hall-west", (left, 0, left, base_h)),
            ("hall-east", (right, 0, right, base_h))
        ):
            wall(id, *coords)
        doors.append({"host_wall": "south", "center": pt(cx, 0)})
        room("Хонгил", left, 0, right, base_h, None)
        if bedrooms == 1:
            sep = base_h * (0.33 + cut * .065)
            wall("right-1", right, sep, base_w, sep)
            room("Зочны өрөө + гал тогоо", 0, 0, left, base_h, "hall-west")
            room("Ариун цэврийн өрөө", right, 0, base_w, sep, "hall-east")
            room("Унтлагын өрөө 1", right, sep, base_w, base_h, "hall-east")
        else:
            wall("left-1", 0, base_h * cut, left, base_h * cut)
            room("Зочны өрөө + гал тогоо", 0, 0, left, base_h * cut, "hall-west")
            room("Унтлагын өрөө 1", 0, base_h * cut, left, base_h, "hall-west")
            if bedrooms == 2:
                sep = base_h * (0.28 + cut * .06)
                wall("right-1", right, sep, base_w, sep)
                room("Ариун цэврийн өрөө", right, 0, base_w, sep, "hall-east")
                room("Унтлагын өрөө 2", right, sep, base_w, base_h, "hall-east")
            else:
                first = base_h * 0.24
                second = base_h * (0.59 + .08 * cut)
                wall("right-1", right, first, base_w, first)
                wall("right-2", right, second, base_w, second)
                room("Ариун цэврийн өрөө", right, 0, base_w, first, "hall-east")
                room("Унтлагын өрөө 2", right, first, base_w, second, "hall-east")
                room("Унтлагын өрөө 3", right, second, base_w, base_h, "hall-east")

    def transform(p):
        x, y = p["x"], p["y"]
        if swap:
            x = base_w - x
        if entry == "north":
            return pt(base_w - x, base_h - y)
        if entry == "east":
            return pt(base_h - y, x)
        if entry == "west":
            return pt(y, base_w - x)
        return pt(x, y)

    def host(id):
        if id.startswith("hall-"):
            # Mirrored center corridor: swap left/right ID so doors still map to correct wall.
            return {"hall-west": "hall-east", "hall-east": "hall-west"}[id] if swap else id
        sides = ("south", "north", "west", "east")
        if id not in sides:
            return id
        # Apply mirror on X then quarter turn. Mapping preserves perimeter host IDs.
        after_mirror = {"west":"east","east":"west"}.get(id,id) if swap else id
        maps = {
            "south": dict(zip(sides, sides)),
            "north": {"south":"north","north":"south","west":"east","east":"west"},
            "east": {"south":"east","north":"west","west":"south","east":"north"},
            "west": {"south":"west","north":"east","west":"north","east":"south"}
        }
        return maps[entry][after_mirror]

    for w in walls:
        w["start"], w["end"], w["id"] = transform(w["start"]), transform(w["end"]), host(w["id"])
    for d in doors:
        d["center"], d["host_wall"] = transform(d["center"]), host(d["host_wall"])
    for r in rooms:
        a, b = transform(pt(r["x1"], r["y1"])), transform(pt(r["x2"], r["y2"]))
        r["x1"], r["x2"] = min(a["x"], b["x"]), max(a["x"], b["x"])
        r["y1"], r["y2"] = min(a["y"], b["y"]), max(a["y"], b["y"])
    wout, hout = (base_h, base_w) if entry in ("east", "west") else (base_w, base_h)

    for r in rooms:
        rw, rh = r["x2"] - r["x1"], r["y2"] - r["y1"]
        if r["name"] != "Хонгил":
            require(min(rw, rh) >= 2.0 and rw*rh >= 5, "unusable room")
            if r["name"].startswith("Унтлагын"):
                require(rw*rh >= 9, "tiny bedroom")
    for d in doors:
        w = next((w for w in walls if w["id"] == d["host_wall"]), None)
        require(w is not None, "door without host")
        v = abs(w["start"]["x"] - w["end"]["x"]) < 1e-4
        u = "y" if v else "x"
        require(abs(d["center"]["x" if v else "y"] - w["start"]["x" if v else "y"]) < 1e-3,
                "door off host")
        low, high = sorted((w["start"][u], w["end"][u]))
        require(low + 0.70 < d["center"][u] < high - 0.70, "door at corner")
    return wout, hout, walls, rooms, doors


def canonical(option):
    return json.dumps(option, sort_keys=True, separators=(",", ":"), ensure_ascii=False)



def wall_faces(room, width, height, ext_t, int_t):
    """Өрөөний ханын НҮҮР (тэнхлэгээс дотогш): ирмэг гадна хана дээр бол гадна
    ханын зузааны хагас, бусад үед дотор ханын хагас.  Зузаан 0 → өрөөний тэгш
    өнцөгт өөрөө (2026-10-14-өөс өмнөх зан төлөв, байт-ижил)."""
    x1, y1, x2, y2 = room["x1"], room["y1"], room["x2"], room["y2"]
    if not (ext_t or int_t) or width is None or height is None:
        return x1, y1, x2, y2
    def half(at, limit):
        return (ext_t if abs(at - limit) < 1e-6 else int_t) / 2.0
    return (x1 + half(x1, 0.0), y1 + half(y1, 0.0),
            x2 - half(x2, width), y2 - half(y2, height))


def furniture_for(rooms, doors, width=None, height=None, ext_t=0.0, int_t=0.0,
                  walls=None, entry=None, facades=(), tier="standard"):
    """Furniture of one unit — see plan_furniture.py (tiered, oriented, doors kept free).

    `ext_t` / `int_t` — бодит ханын бүтэн зузаан (м).  Байрлал ба зай ханын НҮҮРнээс
    (2026-10-14 аудит P1-e).  Raises ValueError when a required item (bed, sofa,
    kitchen, WC, basin) cannot be placed — the plan is then dropped.
    """
    return furnish(rooms, doors, walls, width, height, ext_t, int_t, entry, facades, tier)


def saved_options(con, unit):
    """Return only previously APPLIED local layouts with comparable footprint.

    A reused plan is geometrically adapted and revalidated later; previous
    approval is NOT a code-safety guarantee for a new building or new dimensions.
    """
    require(isinstance(unit, dict), "unit data expected")
    w, h = unit.get("width_m"), unit.get("height_m")
    if type(w) not in (int, float) or type(h) not in (int, float):
        return []
    rows = con.execute("""SELECT option_id,option_json,width_m,height_m
        FROM applied_plan_library WHERE bedrooms=? AND entry=?
        ORDER BY created_utc DESC LIMIT 60""",
        (unit.get("bedrooms"),unit.get("entry","south"))).fetchall()
    results=[]
    for option_id,payload,original_w,original_h in rows:
        ratio_x,ratio_y=float(w)/original_w,float(h)/original_h
        if not (.78 <= ratio_x <= 1.22 and .78 <= ratio_y <= 1.22):
            continue
        try:
            previous=json.loads(payload)
            def point(p):
                return pt(p["x"]*ratio_x,p["y"]*ratio_y)
            walls=[{"id":v["id"],"start":point(v["start"]),"end":point(v["end"])}
                   for v in previous["walls"]]
            doors=[{"host_wall":d["host_wall"],"center":point(d["center"])}
                   for d in previous["doors"]]
            rooms=[{"name":x["name"],"x1":round(x["x1"]*ratio_x,6),
                "x2":round(x["x2"]*ratio_x,6),"y1":round(x["y1"]*ratio_y,6),
                "y2":round(x["y2"]*ratio_y,6)} for x in previous["rooms"]]
            ext_t, int_t = wall_thickness(unit)
            entry=unit.get("entry","south")
            facades=unit.get("facades") or [x for x in ENTRIES if x!=entry]
            furniture=furniture_for(rooms,doors,float(w),float(h),ext_t,int_t,
                                    walls,entry,facades,unit_tier(unit))
            results.append({"seed_id":"saved-"+option_id,"seed_name":"Өмнө ашигласан план",
                "topology":previous.get("topology","saved-adapted"),
                "width_m":float(w),"height_m":float(h),
                "rooms":rooms,"walls":walls,"doors":doors,"furniture":furniture})
        except (ValueError,TypeError,KeyError,ZeroDivisionError):
            continue
    return results

TOPOLOGY_ORDER = ("t-hall", "l-hall", "central-hall", "side-hall", "entry-gallery",
                  "living-hub", "living-column", "split-living")


def wall_thickness(unit):
    """(гадна, дотор) ханын бүтэн зузаан, м — заагаагүй бол 0 (тэнхлэгээр)."""
    ext_t = unit.get("exterior_wall_thickness_m", 0) or 0
    int_t = unit.get("interior_wall_thickness_m", 0) or 0
    return (number(ext_t, "exterior_wall_thickness_m", 0, 0.8),
            number(int_t, "interior_wall_thickness_m", 0, 0.4))


def unit_tier(unit):
    """Тавилгын зэрэглэл: economy / standard (өгөгдмөл) / luxury."""
    tier = unit.get("tier", "standard") or "standard"
    require(isinstance(tier, str) and tier in TIERS, "Зэрэглэл economy/standard/luxury байх ёстой")
    return tier


def unit_program(unit):
    """Parse and validate one unit request (raises ValueError)."""
    require(isinstance(unit, dict), "Нэгжийн өгөгдөл буруу (объект биш)")
    uid = unit.get("unit_id")
    require(isinstance(uid, str) and 1 <= len(uid) <= 64 and
            all(x.isalnum() or x in "-_" for x in uid), "Нэгжийн дугаар (unit_id) буруу")
    width, height = number(unit.get("width_m"), "width_m", 7.8, 30), number(unit.get("height_m"), "height_m", 7.8, 30)
    bedrooms = unit.get("bedrooms")
    require(type(bedrooms) is int and 1 <= bedrooms <= 4, "Унтлагын өрөөний тоо 1–4 байх ёстой")
    bathrooms = unit.get("bathrooms", 1)
    require(type(bathrooms) is int and 1 <= bathrooms <= 2, "Ариун цэврийн өрөөний тоо 1–2 байх ёстой")
    entry = unit.get("entry", "south")
    require(isinstance(entry, str) and entry in ENTRIES, "Орцны тал south/north/east/west байх ёстой")
    facades = unit.get("facades")
    if facades is None:
        facades = [s for s in ("south", "north", "west", "east") if s != entry]
    require(isinstance(facades, list) and all(isinstance(f, str) and f in ENTRIES for f in facades) and
            len(set(facades)) == len(facades), "Гэрэлтэй фасад нь south/north/east/west-ийн жагсаалт байх ёстой")
    hall = unit.get("hall_width", 1.4)
    hall = number(hall, "hall_width", 1.1, 1.8)
    cap = unit.get("max_options", 36)
    require(type(cap) is int and 1 <= cap <= MAX_OPTIONS, "Хувилбарын тоо 1–36 байх ёстой")
    return uid, width, height, bedrooms, bathrooms, entry, facades, hall, cap


def via_living_rooms(rooms, doors):
    """Rooms whose only door opens onto the living room (no corridor)."""
    living = [r for r in rooms if r["name"].startswith("Зочны")]
    result = []
    for d in doors:
        if d["host_wall"] in ENTRIES:
            continue
        touching = [r for r in rooms if _touches(r, d["center"])]
        names = {r["name"] for r in touching}
        if len(touching) == 2 and living and living[0]["name"] in names:
            other = next(r for r in touching if r["name"] != living[0]["name"])
            if other["name"] != "Хонгил":
                result.append(other["name"])
    return result


def kind(name):
    for prefix, k in (("Унтлагын", "bed"), ("Ариун", "bath"), ("Зочны", "living"),
                      ("Агуулах", "storage")):
        if name.startswith(prefix):
            return k
    return "hall"


def plan_signature(option):
    """Coarse layout identity: which room sits where (3x3 grid).  Options
    differing only by a few centimetres collapse to one signature."""
    w, h = option["width_m"], option["height_m"]
    cells = sorted((kind(r["name"]), int(3 * ((r["x1"] + r["x2"]) / 2) / w),
                    int(3 * ((r["y1"] + r["y2"]) / 2) / h)) for r in option["rooms"])
    return option["topology"] + "|" + repr(cells)


def world_key(w, h, rooms, walls, doors):
    """Геометрийн ижил байдал: хананы id, чиглэл, өрөөний дугаарлалтаас ҮЛ хамаарна.

    `option_id` нь `canonical(geometry)`-аас — хананы id-г агуулдаг тул толин
    тусгалын алхам ижил геометрийг өөр `w#` id-тай дахин гаргахад галерейд
    давхардал үүсдэг байв (аудит: ~900 нэгжид 69).  `option_id` ӨӨРЧЛӨГДӨӨГҮЙ
    (суралцлын сан түүгээр холбогддог) — давхардлыг энэ түлхүүрээр хасна.
    """
    r = sorted((kind(x["name"]), round(x["x1"], 3), round(x["y1"], 3), round(x["x2"], 3),
                round(x["y2"], 3)) for x in rooms)
    wl = sorted(tuple(sorted(((round(v["start"]["x"], 3), round(v["start"]["y"], 3)),
                              (round(v["end"]["x"], 3), round(v["end"]["y"], 3)))))
                for v in walls)
    d = sorted((round(x["center"]["x"], 3), round(x["center"]["y"], 3), x["host_wall"] in ENTRIES)
               for x in doors)
    return repr((round(w, 3), round(h, 3), r, wl, d))


def generate_unit(unit, history, prior_plans=(), samples=100):
    uid, width, height, bedrooms, bathrooms, entry, facades, hall, cap = unit_program(unit)
    ext_t, int_t = wall_thickness(unit)
    tier = unit_tier(unit)
    # Орох хаалга хонгилын үзүүрт багтах хамгийн бага өргөн (plan_generator.MIN_ENTRY_HALL).
    hall_gen = max(hall, MIN_ENTRY_HALL)
    warnings = ["Оноо нь БНбД/MNS-ийн баталгаа биш; гадна хаалга/Family/Revit collision-г Apply-ээс өмнө шалгана."]
    if hall_gen > hall:
        warnings.append("Хүссэн %.2f м хонгилын үзүүрт орох хаалга (уулзвараас 0.65 м) багтахгүй тул "
                        "хонгилтой хувилбаруудыг %.2f м-ээр гаргав." % (hall, hall_gen))
    candidates = []
    legacy = bathrooms == 1 and bedrooms <= 3
    if legacy:
        for i in range(36):
            try:
                w, h, walls, rooms, doors = make(width, height, bedrooms, i, entry)
            except ValueError:
                continue
            template = (("side-hall-right" if i % 2 else "side-hall-left") if i >= 24 else
                        ("central-hall" if i % 2 == 0 else "central-hall-mirror"))
            candidates.append({"template": template,
                               "topology": "side-hall" if i >= 24 else "central-hall",
                               "origin": None, "width_m": w, "height_m": h,
                               "walls": walls, "rooms": rooms, "doors": doors})
        for seed in seed_options(width, height, bedrooms, entry):
            candidates.append({"template": seed["seed_id"], "topology": seed["topology"],
                               "origin": seed["seed_name"], **_geometry(seed)})
    for seed in prior_plans:
        if sum(r["name"].startswith("Ариун") for r in seed["rooms"]) != bathrooms:
            continue
        candidates.append({"template": seed["seed_id"], "topology": seed["topology"],
                           "origin": seed["seed_name"], **_geometry(seed)})
    seed_key = "|".join(str(x) for x in (round(width, 3), round(height, 3), bedrooms,
                                          bathrooms, entry, sorted(facades), hall_gen))
    rng_seed = int(hashlib.sha256(seed_key.encode("utf-8")).hexdigest()[:12], 16)
    for g in generate_plans(width, height, bedrooms, bathrooms, entry, facades, hall_gen,
                            rng_seed, samples):
        candidates.append({"template": g["seed_id"], "topology": g["topology"],
                           "origin": None, **_geometry(g)})

    options, ids, worlds = [], set(), set()
    for cand in candidates:
        w, h = cand["width_m"], cand["height_m"]
        walls, rooms, doors = cand["walls"], cand["rooms"], cand["doors"]
        # Хүсэлтийн орц ба хонгилын өргөнийг ЭХ СУРВАЛЖААС ҮЛ ХАМААРАН шалгана:
        # хадгалсан (масштабласан) план 1.09 м хонгилтой ирж болдог байв.
        ok, diagnostic, metrics = validate_plan(w, h, walls, rooms, doors,
                                                entry=entry, min_hall=hall)
        if not ok:
            continue
        key = world_key(w, h, rooms, walls, doors)
        if key in worlds:
            continue
        worlds.add(key)
        via = via_living_rooms(rooms, doors)
        base, parts, report, lit, habitable = score_world(
            rooms, w, h, entry, facades, bedrooms, bathrooms, hall_gen, via)
        template = cand["template"]
        generated, applied, rejected = history.get(template, (0, 0, 0))
        # Evidence = explicit decisions.  How often a template was merely shown
        # depends on the 36-option cap and the footprint, so it is only a
        # consistency check (decisions cannot outnumber proposals).
        adjustment = 0.0
        if applied + rejected >= 3 and generated >= applied + rejected:
            preference = (applied + 2.0) / (applied + rejected + 4.0)
            adjustment = round(max(-4.0, min(4.0, (preference - .5) * 8)), 2)
        score = round(max(1.0, min(99.0, base + adjustment)), 2)
        # Furniture is a pure function of this geometry + tier: it stays out of the
        # identity and is computed only for options the gallery actually takes.
        geometry = {"width_m": w, "height_m": h, "rooms": rooms,
                    "walls": walls, "doors": doors, "tier": tier}
        # Content-addressed identity: the same geometry is the same option,
        # not a fake "new" plan because its loop index changed.
        option_id = hashlib.sha256(canonical(geometry).encode("utf-8")).hexdigest()[:24]
        if option_id in ids:
            continue
        ids.add(option_id)
        metrics = dict(metrics, daylit_rooms=lit, habitable_rooms=habitable,
                       bathrooms=bathrooms)
        origin = cand["origin"]
        options.append({"option_id": option_id, "template": template,
            "topology": cand["topology"], "library_origin": origin,
            "metrics": metrics, "score_parts": parts, "room_report": report,
            "facades": list(facades),
            "score": score, "base_score": round(score - adjustment, 2),
            "preference_adjustment": round(adjustment, 2),
            "explanation": explain(cand["topology"], origin, parts, lit, habitable),
            "width_m": w, "height_m": h, "walls": walls, "rooms": rooms,
            "doors": doors, "furniture": None})
    options.sort(key=lambda o: (-o["score"], o["option_id"]))

    def furnished(o):
        # Geometry from any source is NOT trusted: recompute the furniture and drop
        # a plan whose required furniture cannot stay clear of its doors.
        if o["furniture"] is None and not o.get("_unfurnishable"):
            try:
                o["furniture"] = furniture_for(o["rooms"], o["doors"], o["width_m"], o["height_m"],
                                               ext_t, int_t, o["walls"], entry, facades, tier)
            except ValueError:
                o["_unfurnishable"] = True
        return o["furniture"] is not None

    selected = select_diverse(options, cap, furnished)
    valid = [o for o in options if not o.get("_unfurnishable")]
    return {"unit_id": uid, "options": selected, "total_valid": len(valid),
            "topologies": sorted({o["topology"] for o in options}),
            "hall_width_requested": hall, "hall_width_used": hall_gen,
            "warnings": warnings}


def _geometry(source):
    return {"width_m": source["width_m"], "height_m": source["height_m"],
            "walls": source["walls"], "rooms": source["rooms"], "doors": source["doors"]}


TOPOLOGY_MN = {
    "t-hall": "Үүдний танхим + хөндлөн коридор",
    "l-hall": "Үүдний танхим + Г коридор",
    "central-hall": "Төв коридор", "side-hall": "Хажуу коридор",
    "entry-gallery": "Үүдний коридор", "living-hub": "Зочны өрөөний төвтэй",
    "living-column": "Зочны өрөө хажуудаа", "split-living": "Унтлагын өрөөнүүд хоёр талд",
    "saved-adapted": "Өмнө ашигласан",
}


def explain(topology, origin, parts, lit, habitable):
    head = ("Дотоод жишээ сангийн '" + origin + "' загварыг талбайд тааруулсан"
            if origin else TOPOLOGY_MN.get(topology, topology))
    weak = min(parts, key=parts.get)
    labels = {"daylight": "гэрэл", "area_fit": "өрөөний хэмжээ", "squareness": "хэлбэр",
              "circulation": "коридорын талбай", "zoning": "бүсчлэл"}
    return (head + " · гэрэлтэй " + str(lit) + "/" + str(habitable) +
            " амьдрах өрөө · сул тал: " + labels[weak] + " · нормын баталгаа биш")


def select_diverse(options, cap, accept=lambda o: True):
    """Finch-like gallery: best of every layout family first, then distinct
    room arrangements, only then near-duplicates of the same arrangement.
    `accept` is asked (lazily, in this order) before an option is taken."""
    selected, taken, signatures = [], set(), set()
    def take(o):
        selected.append(o)
        taken.add(o["option_id"])
        signatures.add(plan_signature(o))
    if cap >= 6:
        for family in TOPOLOGY_ORDER:
            o = next((x for x in options if x["topology"] == family and accept(x)), None)
            if o is not None and len(selected) < cap:
                take(o)
        for exact in ("side-hall-left", "side-hall-right",
                      "central-hall", "central-hall-mirror"):
            o = next((x for x in options if x["template"] == exact and
                      x["option_id"] not in taken and accept(x)), None)
            if o is not None and len(selected) < cap:
                take(o)
        o = next((x for x in options if x["template"].startswith("saved-") and
                  x["option_id"] not in taken and accept(x)), None)
        if o is not None and len(selected) < cap:
            take(o)
        for o in options:
            if o["topology"] == "entry-gallery" and o["library_origin"] and \
                    o["option_id"] not in taken and len(selected) < cap and accept(o):
                take(o)
                break
    # Distinct arrangements, at most a fair share per family per round.
    for o in options:
        if len(selected) >= cap:
            break
        if o["option_id"] in taken or plan_signature(o) in signatures or not accept(o):
            continue
        take(o)
    for o in options:
        if len(selected) >= cap:
            break
        if o["option_id"] not in taken and accept(o):
            take(o)
    selected.sort(key=lambda o: (-o["score"], o["option_id"]))
    return selected


def batch_generate(req):
    units = req.get("units")
    require(isinstance(units,list) and 1 <= len(units) <= MAX_UNITS, "units count 1..24")
    ids = [u.get("unit_id") for u in units if isinstance(u,dict)]
    require(len(ids) == len(units) and len(set(ids)) == len(ids), "unit_ids must be unique")
    batch_id = req.get("batch_id") or str(uuid.uuid4())
    require(isinstance(batch_id,str) and len(batch_id) <= 80 and len(batch_id) > 4,
            "invalid batch_id")
    # Сонголтын сан нь ЗӨВХӨН сайжруулалт: эвдэрсэн / түгжигдсэн сан генерацийг
    # зогсоохгүй (өмнө нь «file is not a database» бүх багцыг унагадаг байв).
    con, db_warning = open_db()
    historic, contexts = {}, [[] for _ in units]
    recorded = False
    result = []
    try:
        if con is not None:
            try:
                historic = template_stats(con)  # snapshot BEFORE recording this batch
                contexts = []
                for u in units:
                    try:
                        contexts.append(saved_options(con, u))
                    except (ValueError, TypeError):
                        contexts.append([])
            except sqlite3.Error as ex:
                historic, contexts = {}, [[] for _ in units]
                db_warning = "Сонголтын санг уншиж чадсангүй (%s) — энэ удаа түүхгүйгээр гаргав" % ex
        # Fewer random samples per unit for big batches keeps a 24-unit
        # run well under a few seconds; small batches explore more.
        samples = 110 if len(units) <= 6 else 55
        for u, c in zip(units, contexts):
            try:
                result.append(generate_unit(u, historic, c, samples))
            except (ValueError, TypeError, KeyError) as ex:
                # One bad unit must not cancel the others; Revit shows why.
                result.append({"unit_id": u.get("unit_id"), "options": [],
                               "total_valid": 0, "error": str(ex)})
        # Validation must complete before any new proposal is persisted.
        if con is not None:
            try:
                when = utc()
                with con:
                    for item in result:
                        for o in item["options"]:
                            con.execute("""INSERT OR IGNORE INTO proposals
                                (batch_id,unit_id,option_id,template,score,created_utc,option_json)
                                VALUES(?,?,?,?,?,?,?)""",
                                (batch_id,item["unit_id"],o["option_id"],o["template"],o["score"],
                                 when,canonical(o)))
                    prune_proposals(con)
                recorded = True
            except sqlite3.Error as ex:
                db_warning = "Саналыг санд бичиж чадсангүй (%s) — энэ багцын сонголтыг суралцалд тоолохгүй" % ex
    finally:
        if con is not None:
            con.close()
    if db_warning:
        for item in result:
            item.setdefault("warnings", []).append(db_warning)
    return {"schema_version":1,"engine_version":VERSION, "batch_id":batch_id,
            "units":result, "local_only":True, "recorded":recorded,
            "warnings":[db_warning] if db_warning else []}


def prune_proposals(con):
    """Шийдвэргүй (feedback-гүй) хуучин саналыг устгана — сан хязгааргүй өсдөг байв
    (24 нэгжийн багц бүр ~3.9 МБ option_json).  Шийдвэртэй санал (rejected/applied/…)
    ба хэрэглэсэн планы сан ХӨНДӨГДӨХГҮЙ — суралцал тэднээс."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=PROPOSAL_RETENTION_DAYS)).isoformat()
    con.execute("""DELETE FROM proposals WHERE created_utc < ? AND NOT EXISTS (
        SELECT 1 FROM feedback f WHERE f.batch_id=proposals.batch_id
          AND f.unit_id=proposals.unit_id AND f.option_id=proposals.option_id)""", (cutoff,))


def reset_preferences(_req):
    """Суралцлын санг АРХИВЛААД шинээр эхлүүлнэ (устгахгүй) — дэмжлэгийн хэрэгсэл."""
    moved = quarantine_db("reset")
    return {"ok": True, "archived_as": moved}


def record_event(req):
    action, reason = req.get("action"), req.get("reason")
    require(action in ACTIONS, "invalid action")
    if action == "rejected":
        require(reason in REASONS, "rejection needs controlled reason")
    else:
        require(reason is None, "reason permitted only for explicit rejection")
    event_id = req.get("event_id") or str(uuid.uuid4())
    batch, unit, opt = (req.get(k) for k in ("batch_id","unit_id","option_id"))
    require(all(isinstance(v,str) and 1 <= len(v) <= 80 for v in (event_id,batch,unit,opt)),
            "invalid event identifiers")
    with connect() as con:
        prior = con.execute("""SELECT batch_id,unit_id,option_id,action,reason
            FROM feedback WHERE event_id=?""", (event_id,)).fetchone()
        if prior is not None:
            require(prior == (batch,unit,opt,action,reason),
                    "event_id reused for different feedback")
            return {"ok":True,"event_id":event_id,"action":action,"idempotent":True}
        exists = con.execute("""SELECT 1 FROM proposals WHERE batch_id=? AND unit_id=?
            AND option_id=?""", (batch,unit,opt)).fetchone()
        require(exists is not None, "unknown proposal; generation must be recorded first")
        if action in ("applied", "rejected"):
            # «applied» бол эцсийн: давхар applied, applied-ийн дараах rejected-ыг хүлээхгүй
            # (өмнө нь тэр хоёр суралцлын тоололд зөрчилдсөн нотолгоо болдог байв).
            prev = con.execute("""SELECT 1 FROM feedback WHERE batch_id=? AND unit_id=?
                AND option_id=? AND action='applied'""", (batch,unit,opt)).fetchone()
            require(prev is None, "duplicate applied action" if action == "applied"
                    else "option already applied; rejection refused")
        con.execute("""INSERT OR IGNORE INTO feedback(event_id,batch_id,unit_id,option_id,
            action,reason,created_utc) VALUES(?,?,?,?,?,?,?)""",
            (event_id,batch,unit,opt,action,reason,utc()))
        if action == "applied":
            row = con.execute("""SELECT option_json FROM proposals
                WHERE batch_id=? AND unit_id=? AND option_id=?""",
                (batch,unit,opt)).fetchone()
            if row is not None and row[0]:
                option = json.loads(row[0])
                rooms = option.get("rooms", [])
                bedrooms = sum(x["name"].startswith("Унтлагын") for x in rooms)
                first_door = option["doors"][0]["host_wall"]
                # Not an official library until architect has applied this plan.
                if bedrooms in (1,2,3) and first_door in ENTRIES:
                    con.execute("""INSERT OR IGNORE INTO applied_plan_library
                        (option_id,bedrooms,entry,width_m,height_m,option_json,created_utc)
                        VALUES(?,?,?,?,?,?,?)""",
                        (opt,bedrooms,first_door,option["width_m"],option["height_m"],
                         row[0],utc()))
    return {"ok":True,"event_id":event_id,"action":action}


def analytics(req):
    with connect() as con:
        rows = con.execute("""SELECT p.template,COUNT(*) AS events,
            COUNT(DISTINCT p.batch_id || ':' || p.unit_id || ':' || p.option_id)
            FROM proposals p GROUP BY p.template ORDER BY p.template""").fetchall()
        acts = dict(con.execute("SELECT action, COUNT(*) FROM feedback GROUP BY action"))
        reasons = dict(con.execute("""SELECT reason,COUNT(*) FROM feedback
            WHERE action='rejected' GROUP BY reason"""))
        applied = dict(con.execute("""SELECT p.template, COUNT(*)
            FROM feedback f JOIN proposals p ON
            p.batch_id=f.batch_id AND p.unit_id=f.unit_id AND p.option_id=f.option_id
            WHERE f.action='applied' GROUP BY p.template"""))
        library_count = con.execute("SELECT COUNT(*) FROM applied_plan_library").fetchone()[0]
        return {"schema_version":1, "generated":sum(r[1] for r in rows),
                "locally_saved_applied_plans":library_count,
                "actions":acts,"explicit_rejection_reasons":reasons,
                "templates":[{"template":r[0],"generated":r[1],"applied":applied.get(r[0],0)}
                             for r in rows],
                "note":"Generated != viewed or approved. Only applied counts as used. " +
                      "No unselected option is treated as rejected without explicit reason."}


def _utf8_stdio():
    # Windows-д redirect хийсэн pipe нь locale-ийн (cp1252/cp1251) кодлолтой тул
    # кирилл гаралт 'charmap' алдаагаар унадаг.  PYTHONIOENCODING-д найдахгүй —
    # frozen roomplan_cli.exe болон шууд дуудалт хоёуланд UTF-8 болгоно.
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass


def main():
    _utf8_stdio()
    try:
        # utf-8-sig: .NET Framework (Revit 2024) StandardInput нь BOM бичиж болно —
        # `json.load` нь «Unexpected UTF-8 BOM» гэж унадаг.
        raw = sys.stdin.buffer.read() if hasattr(sys.stdin, "buffer") else sys.stdin.read().encode("utf-8")
        request = json.loads(raw.decode("utf-8-sig"))
        require(isinstance(request,dict), "request must be object")
        cmd = request.get("command")
        if cmd == "generate_batch":
            response = batch_generate(request)
        elif cmd == "record_event":
            response = record_event(request)
        elif cmd == "analytics":
            response = analytics(request)
        elif cmd == "reset_preferences":
            response = reset_preferences(request)
        elif cmd == "health":
            response = {"ok":True,"engine_version":VERSION,"local_only":True}
        else:
            raise ValueError("unknown command")
        print(json.dumps(response,ensure_ascii=False,separators=(",",":"),allow_nan=False))
    except (ValueError, TypeError, KeyError, sqlite3.Error, OSError) as ex:
        print(json.dumps({"error":str(ex),"engine_version":VERSION},ensure_ascii=False))
        sys.exit(2)

if __name__ == "__main__":
    main()
