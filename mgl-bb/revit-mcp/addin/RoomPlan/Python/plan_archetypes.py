"""Original MGL apartment design exemplars — NOT copied from Finch.

A local, deterministic and editable *architectural precedent* library.
The samples are hand-authored programs (not real project drawings, not
regulatory-certified). For commercial use replace or extend with architect-
approved, licensed and verified internal examples.
No external AI, API, neural network, third-party dependencies or network.
"""
from __future__ import annotations

import math

# Meaningful authored programs: different numbers of bedrooms, living-zone
# proportions, wet area ordering, entry relationship and spatial topology.
# These are original synthetic examples, not imported/crawled from Finch.
SEEDS = (
    {"id": "mgl-studio-open-01", "name": "Compact open 1BR",
     "bedrooms": 1, "topology": "living-hub", "public_share": .47,
     "wet_share": .26, "sequence": "wet-first"},
    {"id": "mgl-studio-gallery-02", "name": "Entry gallery 1BR",
     "bedrooms": 1, "topology": "entry-gallery", "public_share": .19,
     "wet_share": .28, "sequence": "wet-last"},
    {"id": "mgl-family-social-03", "name": "Social living core 2BR",
     "bedrooms": 2, "topology": "living-hub", "public_share": .44,
     "wet_share": .23, "sequence": "wet-centre"},
    {"id": "mgl-family-gallery-04", "name": "Accessible entry gallery 2BR",
     "bedrooms": 2, "topology": "entry-gallery", "public_share": .17,
     "wet_share": .22, "sequence": "wet-last"},
    {"id": "mgl-family-private-05", "name": "Three-bedroom privacy",
     "bedrooms": 3, "topology": "living-hub", "public_share": .42,
     "wet_share": .22, "sequence": "wet-centre"},
    {"id": "mgl-family-gallery-06", "name": "Three-bedroom long frontage",
     "bedrooms": 3, "topology": "entry-gallery", "public_share": .18,
     "wet_share": .20, "sequence": "wet-first"},
)


def _point(x, y):
    return {"x": round(x, 6), "y": round(y, 6)}


def _validate_seed(seed):
    if not isinstance(seed, dict):
        raise ValueError("seed must be object")
    if seed.get("bedrooms") not in (1, 2, 3):
        raise ValueError("seed bedrooms")
    if seed.get("topology") not in ("living-hub", "entry-gallery"):
        raise ValueError("seed topology")
    if seed.get("sequence") not in ("wet-first", "wet-centre", "wet-last"):
        raise ValueError("seed sequence")
    share = seed.get("public_share")
    wet = seed.get("wet_share")
    if type(share) not in (float, int) or not .15 <= share <= .52:
        raise ValueError("seed public_share")
    if type(wet) not in (float, int) or not .18 <= wet <= .30:
        raise ValueError("seed wet_share")


def _rotate(p, width, height, side, mirror):
    x, y = p["x"], p["y"]
    if mirror:
        x = width - x
    if side == "south":
        return _point(x, y)
    if side == "north":
        return _point(width-x, height-y)
    if side == "east":
        return _point(height-y, x)
    if side == "west":
        return _point(y, width-x)
    raise ValueError("invalid entry side")


def _outer_host(wall_id, side, mirror):
    if wall_id not in ("south", "north", "west", "east"):
        return wall_id
    if mirror:
        wall_id = {"west":"east", "east":"west"}.get(wall_id, wall_id)
    translate = {
        "south":{"south":"south","north":"north","west":"west","east":"east"},
        "north":{"south":"north","north":"south","west":"east","east":"west"},
        "east":{"south":"east","north":"west","west":"south","east":"north"},
        "west":{"south":"west","north":"east","west":"north","east":"south"},
    }
    return translate[side][wall_id]


def _build(seed, unit_width, unit_height, side, mirror, shift):
    # The entry wall is south in the local coordinate system. Rotating the
    # solution allows real Revit north/east/west entry wall selection.
    rotate90 = side in ("east", "west")
    width, height = (unit_height, unit_width) if rotate90 else (unit_width, unit_height)
    bedrooms = seed["bedrooms"]
    if width < (11.0 if bedrooms == 3 else 8.6) or height < 8.0:
        raise ValueError("footprint not compatible with exemplar")
    rect_rooms, walls, doors = [], [], []

    def wall(name, x1, y1, x2, y2):
        walls.append({"id":name,"start":_point(x1,y1),"end":_point(x2,y2)})

    def room(name, x1,y1,x2,y2):
        if x2 <= x1 or y2 <= y1:
            raise ValueError("zero room")
        rect_rooms.append({"name":name,"x1":x1,"y1":y1,"x2":x2,"y2":y2})

    def door(host, x, y):
        doors.append({"host_wall":host,"center":_point(x,y)})

    for name, coords in (
        ("south",(0,0,width,0)),("north",(0,height,width,height)),
        ("west",(0,0,0,height)),("east",(width,0,width,height))
    ):
        wall(name,*coords)
    door("south",width/2,0)

    frac = max(.15, min(.52, seed["public_share"] + shift))
    living_h = height*frac
    bath_w = max(2.5, width*seed["wet_share"])
    usable_w = width-bath_w
    n_others = bedrooms + (1 if seed["topology"] == "entry-gallery" else 0)
    # Widths tuned to allow real bed envelopes and entry door centres.
    room_w = usable_w/n_others
    if seed["topology"] == "living-hub":
        # A shared social living space is the circulation heart. Bedroom and
        # sanitary rooms all open onto the same shared wall; NO corridor.
        if living_h < 3.3 or height-living_h < 3.3 or room_w < 2.35:
            raise ValueError("living-hub cannot furnish candidate")
        wall("living-north",0,living_h,width,living_h)
        room("Зочны өрөө + гал тогоо",0,0,width,living_h)
        labels=["Унтлагын өрөө "+str(i+1) for i in range(bedrooms)]
        if seed["sequence"]=="wet-first":
            labels=["Ариун цэврийн өрөө"]+labels
        elif seed["sequence"]=="wet-last":
            labels=labels+["Ариун цэврийн өрөө"]
        else:
            labels.insert(len(labels)//2,"Ариун цэврийн өрөө")
        room_widths=[bath_w if x=="Ариун цэврийн өрөө" else room_w for x in labels]
        x=0
        for i,(name,span) in enumerate(zip(labels,room_widths)):
            next_x=x+span
            if i>0:wall("hub-divider-"+str(i),x,living_h,x,height)
            room(name,x,living_h,next_x,height)
            door("living-north",(x+next_x)/2,living_h)
            x=next_x
    else:
        # Entry gallery is a *different plan graph*: entrance -> thin horizontal
        # corridor -> separate public/private rooms extending to the far facade.
        # This is not a mirror of a vertical corridor floor plan.
        gallery_h=max(1.6,living_h)
        if gallery_h > 2.35 or height-gallery_h < 3.7 or room_w < 2.3:
            raise ValueError("gallery cannot furnish candidate")
        wall("gallery-north",0,gallery_h,width,gallery_h)
        room("Хонгил",0,0,width,gallery_h)
        labels=["Зочны өрөө + гал тогоо"]+[
            "Унтлагын өрөө "+str(i+1) for i in range(bedrooms)]
        if seed["sequence"]=="wet-first":
            labels=["Ариун цэврийн өрөө"]+labels
        elif seed["sequence"]=="wet-last":
            labels=labels+["Ариун цэврийн өрөө"]
        else:
            labels.insert(1,"Ариун цэврийн өрөө")
        room_widths=[bath_w if x=="Ариун цэврийн өрөө" else room_w for x in labels]
        x=0
        for i,(name,span) in enumerate(zip(labels,room_widths)):
            next_x=x+span
            if i>0:wall("gallery-divider-"+str(i),x,gallery_h,x,height)
            room(name,x,gallery_h,next_x,height)
            door("gallery-north",(x+next_x)/2,gallery_h)
            x=next_x
    if abs(x-width)>1e-5:
        raise ValueError("uncovered footprint")

    # Exact geometry transformation and original native wall-name remapping.
    for w in walls:
        w["start"]=_rotate(w["start"],width,height,side,mirror)
        w["end"]=_rotate(w["end"],width,height,side,mirror)
        w["id"]=_outer_host(w["id"],side,mirror)
    for d in doors:
        d["center"]=_rotate(d["center"],width,height,side,mirror)
        d["host_wall"]=_outer_host(d["host_wall"],side,mirror)
    for r in rect_rooms:
        a=_rotate(_point(r["x1"],r["y1"]),width,height,side,mirror)
        b=_rotate(_point(r["x2"],r["y2"]),width,height,side,mirror)
        r["x1"],r["x2"]=min(a["x"],b["x"]),max(a["x"],b["x"])
        r["y1"],r["y2"]=min(a["y"],b["y"]),max(a["y"],b["y"])

    for r in rect_rooms:
        area=(r["x2"]-r["x1"])*(r["y2"]-r["y1"])
        if r["name"] not in ("Хонгил", "Зочны өрөө + гал тогоо") and area<9:
            raise ValueError("bedroom/bath too small")
        if r["name"]=="Ариун цэврийн өрөө" and min(r["x2"]-r["x1"],r["y2"]-r["y1"])<2.15:
            raise ValueError("bath too narrow")
    out_w,out_h=(height,width) if rotate90 else (width,height)
    return {
        "seed_id":seed["id"],"seed_name":seed["name"],"topology":seed["topology"],
        "width_m":out_w,"height_m":out_h,
        "walls":walls,"rooms":rect_rooms,"doors":doors
    }


def seed_options(width, height, bedrooms, entry):
    """Adapt ORIGINAL exemplar programs to a new rectangular unit footprint.

    Each precedent can be mirrored and resized. No model training is claimed;
    fitting and downstream furniture/circulation checks must be verified.
    """
    if entry not in ("south","north","east","west"):
        raise ValueError("unknown entry")
    result=[]
    for seed in SEEDS:
        _validate_seed(seed)
        if seed["bedrooms"]!=bedrooms:
            continue
        for mirror in (False, True):
            for shift in (0.0, -.02, .02):
                try:
                    option=_build(seed,width,height,entry,mirror,shift)
                except ValueError:
                    continue
                option["mirror"]=mirror
                option["fraction_adjustment"]=shift
                result.append(option)
    return result
