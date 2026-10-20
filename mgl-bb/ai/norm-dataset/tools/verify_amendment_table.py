#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
MGL AI · norm-dataset · CROSS-SOURCE CHECK OF AN AMENDED ANNEX TABLE (2026-09-23, first used for БНбД 22-01-21)

    python ai/norm-dataset/tools/verify_amendment_table.py ai/norm-dataset/documents/BNbD_22-01-21 \
        --amendment A-2022-07 --table "Хавсралт 1" --pages 2-9

WHY.  The normative text (MCIS edition) prints an annex that an ORDER re-approved; the order's own official text
(legalinfo.mn) prints the same annex.  Two independent extractions that agree row by row are the strongest
evidence a text-layer table can get short of a human reading the page image — and a disagreement must be SEEN,
never averaged away.

HOW.
   • The amendment PDF is the file named in metadata.amendments[id] (`source/_external/…`, NOT in git) — its
     sha256 must equal metadata.amendments[id].source_sha256, else the run stops.
   • Its annex rows are read from the TEXT LAYER as a token stream «№ → name line(s) → 4 values» (its ruled grids
     are incomplete on some pages), independently of how the normative PDF's grid was parsed.
   • The normative rows come from parsed/tables.jsonl (the grid), with the merged «Аймгийн нэр» cell carried down.
   • Rows are matched by their printed number «№»; every cell is compared as printed (no normalisation beyond
     whitespace).  Output: parsed/amendment_verification.json.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

try:
    import pymupdf  # type: ignore
except ImportError:  # pragma: no cover
    sys.stderr.write("pymupdf is required:  pip install pymupdf\n")
    sys.exit(2)

VALUE = re.compile(r"^(?:[<>]\s*\d+|\d+\s*[-–]\s*\d+|\d+|-)$")
ROMAN = re.compile(r"^(?:V|VI|VII|VIII|IX|X|XI|XII)\*?$")


def ws(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def name(s: str) -> str:
    """names compare modulo the line-wrap space after a hyphen («Баруунбаян- Улаан» ≡ «Баруунбаян-Улаан»)"""
    return re.sub(r"([-–])\s+", r"\1", ws(s))


def parse_stream(lines: list[str]) -> dict[int, dict]:
    """«1 Архангай Батцэнгэл 121-140 VII 281-340 IX 2 Булган …» → {1: {aimag, sum, cells}}.  A row is a number that
    continues the sequence, 1–3 name lines, then value/roman/value/roman."""
    rows: dict[int, dict] = {}
    toks = [ws(l) for l in lines if ws(l)]
    i, want = 0, 1
    while i < len(toks):
        if toks[i] != str(want):
            i += 1
            continue
        j = i + 1
        names: list[str] = []
        while j < len(toks) and not VALUE.match(toks[j]) and len(names) < 4:
            names.append(toks[j])
            j += 1
        vals = toks[j:j + 4]
        if len(vals) == 4 and VALUE.match(vals[0]) and ROMAN.match(vals[1]) and VALUE.match(vals[2]) and ROMAN.match(vals[3]) and names:
            # a name line opening with «(» continues the previous name («Чулуунхороот» ⏎ «(Эрээнцав)»)
            merged: list[str] = []
            for n in names:
                if merged and merged[-1].endswith(("-", "–")):
                    merged[-1] = f"{merged[-1]}{n}"  # «Баруунбаян-» ⏎ «Улаан» — a hyphen-wrapped name
                elif merged and (n.startswith("(") or n[:1].islower()):
                    merged[-1] = f"{merged[-1]} {n}"
                else:
                    merged.append(n)
            aimag, sm = (merged[0], " ".join(merged[1:])) if len(merged) >= 2 else (None, merged[0])
            rows[want] = {"aimag": aimag, "sum": sm, "cells": vals}
            want += 1
            i = j + 4
        else:
            i += 1
    return rows


def main() -> None:
    args = sys.argv[1:]
    doc_dir = Path(args[0]).resolve()
    opt = {args[k]: args[k + 1] for k in range(1, len(args) - 1, 2)}
    meta = json.loads((doc_dir / "metadata.json").read_text(encoding="utf-8"))
    am = next(a for a in meta["amendments"] if a["id"] == opt["--amendment"])
    rel = next(r for r in meta["source_roles"] if r["role"] == "AMENDMENT_SOURCE")["file"].split(" ")[0]
    pdf = doc_dir / rel
    if not pdf.exists():
        sys.stderr.write(f"amendment PDF missing: {pdf}\n  download: curl -4 -sL -o \"{pdf}\" \"{am['source_url']}\"\n")
        sys.exit(2)
    sha = hashlib.sha256(pdf.read_bytes()).hexdigest()
    if sha != am["source_sha256"]:
        sys.stderr.write(f"sha256 mismatch: {sha} != {am['source_sha256']}\n")
        sys.exit(1)
    a, b = (int(x) for x in opt["--pages"].split("-"))
    doc = pymupdf.open(str(pdf))
    lines: list[str] = []
    for p in range(a, b + 1):
        lines += doc[p - 1].get_text("text").splitlines()
    ext = parse_stream(lines)

    table_id = opt["--table"]
    t = next(json.loads(l) for l in (doc_dir / "parsed" / "tables.jsonl").read_text(encoding="utf-8").splitlines()
             if l.strip() and json.loads(l)["table_id"].endswith("#T" + table_id))
    norm: dict[int, dict] = {}
    aimag = None
    for r in t["rows"]:
        if not r or not re.fullmatch(r"\d+", ws(r[0])):
            continue  # header rows
        if ws(r[1]):
            aimag = ws(r[1])
        norm[int(ws(r[0]))] = {"aimag": aimag, "aimag_from_merged_cell": not ws(r[1]), "sum": ws(r[2]), "cells": [ws(c) for c in r[3:7]]}

    mismatches = []
    for n in sorted(set(norm) | set(ext)):
        x, y = norm.get(n), ext.get(n)
        if x is None or y is None:
            mismatches.append({"no": n, "missing_in": "normative" if x is None else "amendment"})
            continue
        diffs = {}
        if name(x["sum"]) != name(y["sum"]):
            diffs["sum"] = [x["sum"], y["sum"]]
        if y["aimag"] is not None and name(x["aimag"]) != name(y["aimag"]):
            diffs["aimag"] = [x["aimag"], y["aimag"]]
        for k, lab in enumerate(["500 см/с2", "500 балл", "2500 см/с2", "2500 балл"]):
            if x["cells"][k].replace(" ", "") != y["cells"][k].replace(" ", ""):
                diffs[lab] = [x["cells"][k], y["cells"][k]]
        if diffs:
            mismatches.append({"no": n, "diffs": diffs})
    out = {
        "tool": "verify_amendment_table/1",
        "document": meta["canonical_code"],
        "table": table_id,
        "amendment": {"id": am["id"], "order": f"№{am['order_number']} ({am['order_date']})", "url": am["source_url"], "sha256": sha, "pages": f"{a}-{b}"},
        "normative_source": {"file": meta["source"]["file"], "sha256": meta["source"]["sha256"]},
        "rows_normative": len(norm),
        "rows_amendment": len(ext),
        "rows_identical": len(norm) - len([m for m in mismatches if "diffs" in m or m.get("missing_in") == "amendment"]),
        "mismatches": mismatches,
        "method": "normative = parsed grid (merged aimag carried down); amendment = independent text-layer token stream; matched by printed №, compared as printed",
    }
    (doc_dir / "parsed" / "amendment_verification.json").write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in out.items() if k != "mismatches"}, ensure_ascii=False), f"· mismatches {len(mismatches)}")
    for m in mismatches[:20]:
        print("  ", json.dumps(m, ensure_ascii=False))


if __name__ == "__main__":
    main()
