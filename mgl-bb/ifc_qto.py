"""
ifc_qto.py — Material quantity takeoff from an IFC file.

Usage:
    python ifc_qto.py model.ifc [output.xlsx]

Strategy:
    1. Read Qto_* QuantitySets if the model has them (fast, authoritative).
    2. Fall back to computing volume/area from geometry (slower, always works).
    3. Resolve materials (incl. layer sets — wall/slab layers split by thickness).
    4. Write Excel: raw element rows + material summary + per-class summary.
"""

import sys
import multiprocessing
from collections import defaultdict

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.element as ue
import pandas as pd

QTO_KEYS_VOLUME = ("NetVolume", "GrossVolume", "Volume")
QTO_KEYS_AREA = ("NetSideArea", "GrossSideArea", "NetArea", "GrossArea", "Area")
QTO_KEYS_LENGTH = ("Length", "Height", "Depth")

TARGET_CLASSES = [
    "IfcWall", "IfcSlab", "IfcColumn", "IfcBeam", "IfcFooting",
    "IfcStair", "IfcStairFlight", "IfcRoof", "IfcCovering",
    "IfcDoor", "IfcWindow", "IfcPile", "IfcRamp", "IfcPlate", "IfcMember",
]


def get_qsets(element):
    """Return merged quantity dict from all Qto_* sets on the element."""
    out = {}
    for pset_name, props in (ue.get_psets(element, qtos_only=True) or {}).items():
        for k, v in props.items():
            if isinstance(v, (int, float)):
                out[k] = v
    return out


def pick(qdict, keys):
    for k in keys:
        if k in qdict and qdict[k]:
            return qdict[k]
    return None


def geometry_quantities(model, elements, settings):
    """Compute {element_id: (volume, area)} from geometry for given elements."""
    result = {}
    iterator = ifcopenshell.geom.iterator(
        settings, model,
        multiprocessing.cpu_count(),
        include=elements,
    )
    if not iterator.initialize():
        return result
    while True:
        shape = iterator.get()
        try:
            geo = shape.geometry
            verts = geo.verts
            faces = geo.faces
            # signed volume of triangle mesh + surface area
            vol, area = 0.0, 0.0
            for i in range(0, len(faces), 3):
                a, b, c = faces[i] * 3, faces[i + 1] * 3, faces[i + 2] * 3
                ax, ay, az = verts[a], verts[a + 1], verts[a + 2]
                bx, by, bz = verts[b], verts[b + 1], verts[b + 2]
                cx, cy, cz = verts[c], verts[c + 1], verts[c + 2]
                # cross product (b-a) x (c-a)
                ux, uy, uz = bx - ax, by - ay, bz - az
                vx, vy, vz = cx - ax, cy - ay, cz - az
                nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
                area += 0.5 * (nx * nx + ny * ny + nz * nz) ** 0.5
                vol += (ax * (by * cz - bz * cy)
                        + ay * (bz * cx - bx * cz)
                        + az * (bx * cy - by * cx)) / 6.0
            result[shape.id] = (abs(vol), area)
        except Exception:
            pass
        if not iterator.next():
            break
    return result


def material_breakdown(element, volume):
    """
    Return list of (material_name, volume_share).
    Layer sets: split element volume by layer thickness ratio.
    Otherwise: full volume to each named material (constituents) or single material.
    """
    mat = ue.get_material(element, should_skip_usage=True)
    if mat is None:
        return [("(no material)", volume)]

    t = mat.is_a()
    if t == "IfcMaterial":
        return [(mat.Name or "(unnamed)", volume)]

    if t == "IfcMaterialLayerSet":
        layers = mat.MaterialLayers or []
        total = sum((l.LayerThickness or 0) for l in layers) or 1.0
        out = []
        for l in layers:
            name = l.Material.Name if l.Material else "(unnamed layer)"
            share = (l.LayerThickness or 0) / total
            out.append((name, (volume or 0) * share))
        return out or [("(empty layer set)", volume)]

    if t == "IfcMaterialConstituentSet":
        names = [c.Material.Name for c in (mat.MaterialConstituents or []) if c.Material]
        return [(n, None) for n in names] or [("(no material)", volume)]

    if t == "IfcMaterialProfileSet":
        names = [p.Material.Name for p in (mat.MaterialProfiles or []) if p.Material]
        return [(n, volume) for n in names] or [("(no material)", volume)]

    if t == "IfcMaterialList":
        names = [m.Name for m in (mat.Materials or [])]
        return [(n, None) for n in names] or [("(no material)", volume)]

    return [(getattr(mat, "Name", None) or t, volume)]


def main(ifc_path, out_path="qto_output.xlsx"):
    print(f"Opening {ifc_path} ...")
    model = ifcopenshell.open(ifc_path)

    elements = []
    for cls in TARGET_CLASSES:
        try:
            elements.extend(model.by_type(cls))
        except Exception:
            pass
    # de-dup (IfcStairFlight may appear under IfcStair decomposition etc.)
    elements = list({e.id(): e for e in elements}.values())
    print(f"Found {len(elements)} structural/architectural elements")

    # Pass 1: quantity sets
    rows, need_geom = [], []
    for e in elements:
        q = get_qsets(e)
        vol = pick(q, QTO_KEYS_VOLUME)
        area = pick(q, QTO_KEYS_AREA)
        length = pick(q, QTO_KEYS_LENGTH)
        rows.append({
            "GlobalId": e.GlobalId,
            "Class": e.is_a(),
            "Name": e.Name or "",
            "Type": (ue.get_type(e).Name if ue.get_type(e) else ""),
            "Storey": (ue.get_container(e).Name if ue.get_container(e) else ""),
            "Volume_m3": vol,
            "Area_m2": area,
            "Length_m": length,
            "QtySource": "QuantitySet" if (vol or area) else "geometry",
            "_eid": e.id(),
        })
        if not vol:
            need_geom.append(e)

    # Pass 2: geometry fallback
    if need_geom:
        print(f"Computing geometry for {len(need_geom)} elements without quantity sets ...")
        settings = ifcopenshell.geom.settings()
        settings.set(settings.USE_WORLD_COORDS, True)
        geo = geometry_quantities(model, need_geom, settings)
        for r in rows:
            if r["Volume_m3"] is None and r["_eid"] in geo:
                v, a = geo[r["_eid"]]
                r["Volume_m3"] = round(v, 4)
                if r["Area_m2"] is None:
                    r["Area_m2"] = round(a / 2, 4)  # half of mesh surface ≈ one face

    # Pass 3: materials
    by_id = {e.id(): e for e in elements}
    mat_rows = []
    for r in rows:
        e = by_id[r["_eid"]]
        for mat_name, mat_vol in material_breakdown(e, r["Volume_m3"] or 0):
            mat_rows.append({
                "Material": mat_name or "(unnamed)",
                "Class": r["Class"],
                "Storey": r["Storey"],
                "Volume_m3": round(mat_vol, 4) if mat_vol else None,
                "Count": 1,
            })
        r.pop("_eid")

    df = pd.DataFrame(rows)
    dfm = pd.DataFrame(mat_rows)

    mat_summary = (dfm.groupby("Material")
                   .agg(Total_Volume_m3=("Volume_m3", "sum"),
                        Element_Count=("Count", "sum"))
                   .sort_values("Total_Volume_m3", ascending=False)
                   .reset_index())

    class_summary = (df.groupby("Class")
                     .agg(Count=("GlobalId", "count"),
                          Total_Volume_m3=("Volume_m3", "sum"),
                          Total_Area_m2=("Area_m2", "sum"))
                     .reset_index())

    with pd.ExcelWriter(out_path, engine="openpyxl") as xl:
        mat_summary.to_excel(xl, sheet_name="Material Summary", index=False)
        class_summary.to_excel(xl, sheet_name="By Class", index=False)
        dfm.to_excel(xl, sheet_name="Material x Element", index=False)
        df.to_excel(xl, sheet_name="All Elements", index=False)

    print(f"\nWrote {out_path}")
    print(mat_summary.head(15).to_string(index=False))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "qto_output.xlsx")
