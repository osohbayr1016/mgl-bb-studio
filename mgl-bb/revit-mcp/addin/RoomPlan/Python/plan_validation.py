"""Fail-closed, API-free validation of original MGL apartment schematic plans.

Topology, enclosure, area conservation, door hosting and reachability checks.
This is NOT structural, egress, fire-safety or Mongolian-code certification.
"""
from __future__ import annotations

import math

SIDES = frozenset(("south","north","west","east"))
EPSILON = 1e-4
HALL = "Хонгил"
# Хуваалцсан ирмэгийн хана / периметрийн тулгалтын хүлцэл (генератор мм-ийн
# сүлжээнд тойруулдаг — 1e-3 нь бөөрөнхийлөлтийг тэвчинэ, 1 см-ийн цоорхойг биш).
COVER_TOL = 1e-3


def _finite(*xs):
    return all(isinstance(x,(int,float)) and not isinstance(x,bool) and math.isfinite(x)
               for x in xs)


def _axis(wall):
    """('v', x, lo, hi) / ('h', y, lo, hi) эсвэл налуу бол None."""
    a,b=wall["start"],wall["end"]
    if abs(a["x"]-b["x"])<EPSILON:
        return "v",a["x"],min(a["y"],b["y"]),max(a["y"],b["y"])
    if abs(a["y"]-b["y"])<EPSILON:
        return "h",a["y"],min(a["x"],b["x"]),max(a["x"],b["x"])
    return None


def _covered(spans, lo, hi):
    """[lo, hi] нь `spans`-ийн нэгдлээр (COVER_TOL хүлцэлтэй) бүрэн хучигдсан уу."""
    reach=lo
    for a,b in sorted(spans):
        if a>reach+COVER_TOL:
            return False
        reach=max(reach,b)
        if reach>=hi-COVER_TOL:
            return True
    return reach>=hi-COVER_TOL


def _shared_edge(a,b):
    for p,q in ((a["x2"],b["x1"]),(b["x2"],a["x1"])):
        if abs(p-q)<EPSILON:
            lo,hi=max(a["y1"],b["y1"]),min(a["y2"],b["y2"])
            if hi-lo>COVER_TOL:
                return "v",p,lo,hi
    for p,q in ((a["y2"],b["y1"]),(b["y2"],a["y1"])):
        if abs(p-q)<EPSILON:
            lo,hi=max(a["x1"],b["x1"]),min(a["x2"],b["x2"])
            if hi-lo>COVER_TOL:
                return "h",p,lo,hi
    return None


def structural_problem(width,height,walls,rooms,doors,entry=None,min_hall=None):
    """Тоо, хана, периметр, хучилт, нэр, орц, хонгилын өргөний инвариант.

    2026-10-14-ний аудитаар `validate_plan` нь дараахыг ХҮЛЭЭН АВДАГ байсан
    (генератор хэзээ ч үүсгэдэггүй ч хадгалсан/дахин ашигласан план үүсгэж болно):
    NaN координат (дараа нь `json.dumps(allow_nan=False)`-д бүх багцыг унагадаг),
    налуу / тэг урттай / гадуурх хана, өрөөг хоёр хуваасан хана, хананы
    хоорондох хуваалтгүй хоёр өрөө, өөр талд орсон орц, давхардсан нэр,
    хүссэнээс нарийн хонгил.  Алдааны текст = машин-уншигдах шалтгаан.
    """
    for r in rooms:
        if not isinstance(r.get("name"),str):
            return "room name missing"
        if not _finite(r["x1"],r["y1"],r["x2"],r["y2"]):
            return "room coordinates must be finite numbers"
    for w in walls:
        if not _finite(w["start"]["x"],w["start"]["y"],w["end"]["x"],w["end"]["y"]):
            return "wall coordinates must be finite numbers"
    for d in doors:
        if not _finite(d["center"]["x"],d["center"]["y"]):
            return "door coordinates must be finite numbers"
    names=[r["name"] for r in rooms if r["name"]!=HALL]
    if len(names)!=len(set(names)):
        return "duplicate room names"
    axes={}
    for w in walls:
        ax=_axis(w)
        if ax is None:
            return "diagonal wall"
        if ax[3]-ax[2]<.05:
            return "zero-length wall"
        for p in (w["start"],w["end"]):
            if (p["x"]< -EPSILON or p["y"]< -EPSILON or
                    p["x"]>width+EPSILON or p["y"]>height+EPSILON):
                return "wall outside footprint"
        axes[w["id"]]=ax
    expected={"south":("h",0.0,0.0,width),"north":("h",height,0.0,width),
              "west":("v",0.0,0.0,height),"east":("v",width,0.0,height)}
    for side,exp in expected.items():
        got=axes.get(side)
        if (got is None or got[0]!=exp[0] or
                any(abs(got[i]-exp[i])>COVER_TOL for i in (1,2,3))):
            return "perimeter wall missing or not the full edge: "+side
    for wid,(o,at,lo,hi) in axes.items():
        if wid in SIDES:
            continue
        for r in rooms:
            if o=="v":
                cuts=(r["x1"]+EPSILON<at<r["x2"]-EPSILON and
                      min(hi,r["y2"])-max(lo,r["y1"])>EPSILON)
            else:
                cuts=(r["y1"]+EPSILON<at<r["y2"]-EPSILON and
                      min(hi,r["x2"])-max(lo,r["x1"])>EPSILON)
            if cuts:
                return "wall cuts through a room"
    for i,a in enumerate(rooms):
        for b in rooms[i+1:]:
            if a["name"]==HALL and b["name"]==HALL:
                continue   # хонгилын хэсгүүд нэг нээлттэй орон зай
            edge=_shared_edge(a,b)
            if edge is None:
                continue
            o,at,lo,hi=edge
            spans=[(w[2],w[3]) for w in axes.values() if w[0]==o and abs(w[1]-at)<EPSILON]
            if not _covered(spans,lo,hi):
                return "shared edge between rooms has no wall"
    if entry is not None:
        outside=[d["host_wall"] for d in doors if d["host_wall"] in SIDES]
        if outside!=[entry]:
            return "outside entry is not on the requested side"
    if min_hall is not None:
        for r in rooms:
            if r["name"]==HALL and min(r["x2"]-r["x1"],r["y2"]-r["y1"])<min_hall-COVER_TOL:
                return "corridor narrower than the requested hall width"
    return None


def _touches(room, point):
    x,y=point["x"],point["y"]
    x1,y1,x2,y2=room["x1"],room["y1"],room["x2"],room["y2"]
    on_vertical=(abs(x-x1)<EPSILON or abs(x-x2)<EPSILON) and y1+EPSILON<y<y2-EPSILON
    on_horizontal=(abs(y-y1)<EPSILON or abs(y-y2)<EPSILON) and x1+EPSILON<x<x2-EPSILON
    return on_vertical or on_horizontal


def _door_on_wall(door,wall):
    x,y=door["center"]["x"],door["center"]["y"]
    a,b=wall["start"],wall["end"]
    if abs(a["x"]-b["x"])<EPSILON:
        return (abs(x-a["x"])<EPSILON and
                min(a["y"],b["y"])+.65<y<max(a["y"],b["y"])-.65)
    if abs(a["y"]-b["y"])<EPSILON:
        return (abs(y-a["y"])<EPSILON and
                min(a["x"],b["x"])+.65<x<max(a["x"],b["x"])-.65)
    return False


def _open_edge(a,b):
    """True when two rectangles share an edge longer than 0.5 m."""
    for p,q in ((a["x2"],b["x1"]),(b["x2"],a["x1"])):
        if abs(p-q)<EPSILON and min(a["y2"],b["y2"])-max(a["y1"],b["y1"])>.5:
            return True
    for p,q in ((a["y2"],b["y1"]),(b["y2"],a["y1"])):
        if abs(p-q)<EPSILON and min(a["x2"],b["x2"])-max(a["x1"],b["x1"])>.5:
            return True
    return False


def validate_plan(width,height,walls,rooms,doors,entry=None,min_hall=None):
    """Return (valid, reason, metrics) with deterministic exact tests.

    All room boundaries are required to cover the entire rectangular unit.
    Each internal door must join EXACTLY two room spaces and all rooms must
    be traversable from the outside (through actual drawn door positions).
    `entry` (south/north/west/east) and `min_hall` (m) are the REQUEST's — when
    given, the plan must honour them (saved/replayed plans included).
    """
    try:
        return _validate_plan(width,height,walls,rooms,doors,entry,min_hall)
    except (KeyError,TypeError,AttributeError):
        # Хадгалсан/гаднаас ирсэн бүтэц эвдэрсэн — нэг төлөвлөгөөнөөс болж
        # бүх багц унах ёсгүй.
        return False,"malformed plan geometry",{}


def _validate_plan(width,height,walls,rooms,doors,entry,min_hall):
    if (not all(isinstance(x,(int,float)) and math.isfinite(x) and x>0
                for x in (width,height)) or not rooms or not walls or not doors):
        return False,"invalid footprint or empty geometry",{}
    problem=structural_problem(width,height,walls,rooms,doors,entry,min_hall)
    if problem:
        return False,problem,{}
    identifiers=[w["id"] for w in walls]
    if len(identifiers)!=len(set(identifiers)):
        return False,"duplicate wall identifiers",{}
    walls_by_id={w["id"]:w for w in walls}
    area=0.0
    for r in rooms:
        x1,y1,x2,y2=(r["x1"],r["y1"],r["x2"],r["y2"])
        if (x1 < -EPSILON or y1 < -EPSILON or x2>width+EPSILON or
            y2>height+EPSILON or x2-x1 < .8 or y2-y1<.8):
            return False,"room lies outside footprint or is degenerate",{}
        surface=(x2-x1)*(y2-y1)
        if surface<3:
            return False,"room too small for schematic planning",{}
        if r["name"].startswith("Унтлагын") and surface < 9:
            return False,"bedroom under schematic area gate",{}
        area+=surface
    if abs(area-width*height)>max(.01,width*height*.0001):
        return False,"rooms do not cover usable footprint",{}
    for i,a in enumerate(rooms):
        for b in rooms[i+1:]:
            if (min(a["x2"],b["x2"])-max(a["x1"],b["x1"])>.001 and
                min(a["y2"],b["y2"])-max(a["y1"],b["y1"])>.001):
                return False,"overlapping rooms",{}
    adjacency={i:set() for i in range(len(rooms))}
    exterior_connected=set()
    entrance_count=0
    for d in doors:
        host=walls_by_id.get(d["host_wall"])
        if host is None or not _door_on_wall(d,host):
            return False,"door is off wall or too near endpoint",{}
        touches=[i for i,r in enumerate(rooms) if _touches(r,d["center"])]
        if d["host_wall"] in SIDES:
            entrance_count+=1
            if len(touches)!=1:
                return False,"outside entry must enter exactly one room",{}
            exterior_connected.add(touches[0])
        else:
            if len(touches)!=2:
                return False,"internal door must connect exactly two room zones",{}
            a,b=touches
            adjacency[a].add(b)
            adjacency[b].add(a)
    # Corridor pieces (several rectangles named "Хонгил", e.g. a foyer plus
    # a cross corridor) are ONE open space: no wall, no door between them.
    for i,a in enumerate(rooms):
        if a["name"]!="Хонгил":
            continue
        for j in range(i+1,len(rooms)):
            b=rooms[j]
            if b["name"]=="Хонгил" and _open_edge(a,b):
                adjacency[i].add(j)
                adjacency[j].add(i)
    if entrance_count!=1:
        return False,"exactly one outside entry required",{}
    seen=set(exterior_connected)
    stack=list(seen)
    while stack:
        cur=stack.pop()
        for neighbor in adjacency[cur]:
            if neighbor not in seen:
                seen.add(neighbor)
                stack.append(neighbor)
    if len(seen)!=len(rooms):
        return False,"inaccessible room without a door route",{}
    hall=sum((r["x2"]-r["x1"])*(r["y2"]-r["y1"])
             for r in rooms if r["name"]=="Хонгил")
    bedrooms=[r for r in rooms if r["name"].startswith("Унтлагын")]
    living=[r for r in rooms if r["name"].startswith("Зочны")]
    metrics={
        "usable_area_m2":round(width*height,2),
        "circulation_area_m2":round(hall,2),
        "area_efficiency_percent":round((1-hall/(width*height))*100,1),
        "min_bedroom_area_m2":round(min(
            ((r["x2"]-r["x1"])*(r["y2"]-r["y1"]) for r in bedrooms), default=0),2),
        "room_count":len(rooms),
        "interior_door_count":len(doors)-entrance_count,
        "connected_to_entry":True,
        "geometry_passed":True,
        "norms_validated":False
    }
    if not living:
        return False,"missing living room",{}
    problem=revit_geometry_problem(walls,rooms,doors)
    if problem:
        return False,problem,{}
    return True,"schematic geometry connected",metrics


def revit_geometry_problem(walls,rooms,doors):
    """Twin of C# RoomPlanRanking.GeometrySafe (RoomPlan/Core/RoomPlanRanking.cs).

    The Revit add-in re-checks every Python option with that gate and silently
    drops any that fail, so a plan Python ranks but Revit hides would make the
    gallery shrink (or go empty) without explanation.  Keep both in step.
    """
    for r in rooms:
        w,h=r["x2"]-r["x1"],r["y2"]-r["y1"]
        if r["name"]!="Хонгил" and (w<2.15 or h<2.15 or w*h<5):
            return "room too narrow for schematic layout"
        if r["name"].startswith("Зочны") and w*h<14:
            return "living area too small"
    for d in doors:
        host=next(x for x in walls if x["id"]==d["host_wall"])
        vertical=abs(host["start"]["x"]-host["end"]["x"])<EPSILON
        cx,cy=d["center"]["x"],d["center"]["y"]
        for divider in walls:
            if divider is host:
                continue
            a,b=divider["start"],divider["end"]
            if (vertical and abs(a["y"]-b["y"])<EPSILON and abs(cy-a["y"])<.65 and
                    min(a["x"],b["x"])<=cx+.001 and max(a["x"],b["x"])>=cx-.001):
                return "door at wall junction"
            if (not vertical and abs(a["x"]-b["x"])<EPSILON and abs(cx-a["x"])<.65 and
                    min(a["y"],b["y"])<=cy+.001 and max(a["y"],b["y"])>=cy-.001):
                return "door at wall junction"
    for i,a in enumerate(doors):
        for b in doors[i+1:]:
            if (a["host_wall"]==b["host_wall"] and
                    math.hypot(a["center"]["x"]-b["center"]["x"],
                               a["center"]["y"]-b["center"]["y"])<1.45):
                return "two doors overlapping on one wall"
    return None
