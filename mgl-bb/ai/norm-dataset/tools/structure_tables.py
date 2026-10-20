#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
MGL AI · norm-dataset · TABLE ROW STRUCTURER (2026-09-23, first used for БНбД 20-04-17)

    python ai/norm-dataset/tools/structure_tables.py ai/norm-dataset/documents/BNbD_20-04-17

Reads   <Doc>/parsed/tables.jsonl + source/<pdf>
Writes  <Doc>/parsed/tables_structured.jsonl   (NEW file — tables.jsonl is never modified)
        <Doc>/parsed/tables_structured_report.json

WHY.  A ruled table whose body has no horizontal rules between items comes out of `find_tables` as ONE row
   whose label cell holds several items and whose value cell holds several numbers («1,05 1,1 1,2 1,3 1,1
   1,15» — БНбД 20-04-17 table 7.1).  Pairing item ↔ value by ORDER would be an inference.  This tool pairs
   them by GEOMETRY: every value line is anchored to the label line printed on the SAME baseline (±3 pt).

RULES (deterministic, no document-specific code):
   • label column = the column with the most letters; value columns = the others except a narrow «№» column.
   • a «packed» row = label cell with ≥ 2 text lines AND a value column with ≥ 2 lines that contain a digit.
   • anchor: each value line → the label line whose baseline is within 3 pt.  No anchor, or two value lines on
     one label line in the same column → the row stays as extracted, `alignment: "ambiguous_packed"`.
   • un-anchored label lines: those BEFORE the first anchor, and any run ending with «:», are group headings;
     otherwise a line belongs to the NEXT item when the previous anchor line ended an item («;» / «.»),
     else it continues the previous item.  Headings nest by x-indent (a heading pops headings at ≥ its indent).
   • every emitted cell text is the PDF's own words, in reading order — nothing is added, nothing is guessed.
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

TOL = 3.0
DIGIT = re.compile(r"\d")
LETTERS = re.compile(r"[^\W\d_]", re.U)


def read_jsonl(p: Path) -> list[dict]:
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]


def toks(s: str) -> set[str]:
    return {t for t in re.findall(r"[^\W_]{2,}|\d+(?:,\d+)?", s.lower(), re.U)}


def lines_in(words: list, rect) -> list[dict]:
    """Words whose centre lies in `rect` → lines [{y, x, text}] ordered top→bottom (baseline = word y1)."""
    x0, y0, x1, y1 = rect
    ws = [w for w in words if x0 - 0.5 <= (w[0] + w[2]) / 2 <= x1 + 0.5 and y0 - 0.5 <= (w[1] + w[3]) / 2 <= y1 + 0.5]
    out: list[dict] = []
    for w in sorted(ws, key=lambda w: (w[3], w[0])):
        if out and abs(out[-1]["y"] - w[3]) <= 1.6:
            out[-1]["words"].append(w)
        else:
            out.append({"y": w[3], "words": [w]})
    for ln in out:
        ln["words"].sort(key=lambda w: w[0])
        ln["x"] = ln["words"][0][0]
        ln["text"] = " ".join(w[4] for w in ln["words"]).strip()
        del ln["words"]
    return out


def letters(s: str) -> int:
    return len(LETTERS.findall(s))


OFFSET_TOL = 1.0  # «constant offset» anchoring: every value sits the SAME distance below its item's first line
CENTER_TOL = 2.5  # «centered» anchoring: a value sits at the vertical centre of its item's lines
ITEM_MARKER = re.compile(r"^\s*(?:[-–•]\s|\d{1,2}[.)]\s|[а-яөүa-z]\)\s)")


def join_wrapped_ranges(ls: list[dict]) -> list[dict]:
    """«15-» ⏎ «50» → «15- 50» (keeps the first line's baseline).  Only a line that ENDS with a dash after a digit
    and is followed by a line that STARTS with a digit is joined — the words stay exactly as printed."""
    out: list[dict] = []
    for l in ls:
        if out and re.search(r"\d\s*[-–]\s*$", out[-1]["text"]) and re.match(r"^\s*\d", l["text"]):
            out[-1] = {**out[-1], "text": f"{out[-1]['text']} {l['text']}"}
        else:
            out.append(l)
    return out


def item_spans(label: list[dict]) -> list[tuple[int, int]]:
    """Items of a packed label cell, as (first line index, last line index).  A line opening with a list marker
    («- », «2. », «а) ») starts an item; lines before the first marker are headings, not items.  Without any
    marker an item ends at a line ending with «;» / «.»."""
    marks = [i for i, l in enumerate(label) if ITEM_MARKER.match(l["text"])]
    spans: list[tuple[int, int]] = []
    if len(marks) >= 2:
        for a, b in zip(marks, marks[1:] + [len(label)]):
            spans.append((a, b - 1))
        return spans
    start = 0
    for i, l in enumerate(label):
        if re.search(r"[;.]\s*$", l["text"]) or i == len(label) - 1:
            spans.append((start, i))
            start = i + 1
    return spans


def anchor_values(label: list[dict], values: dict[int, list[dict]], mode: str) -> dict[int, dict[int, str]] | None:
    """`baseline`: a value line anchors to the label line on the same baseline (±TOL).
    `offset` (22-01-21 table 2: «Тогтмол» y=220.5 ↔ «0.9» y=227.8, «Удаан …» 236.0 ↔ «0.8» 243.3, the two-line item
    «Богино … адрын» 251.5 ↔ «0.5» 258.8): the value lines are all printed the SAME distance (±1 pt, less than one line
    pitch) below the nearest label line above them — that constant is the row's geometry, so each value anchors to
    that line.  A spread of distances is not a layout, it is ambiguity → None."""
    anchors: dict[int, dict[int, str]] = {}
    pairs: list[tuple[int, int, int, str, float]] = []
    marked = item_spans(label) if mode in ("centered", "top") else []
    if mode == "top" and not any(ITEM_MARKER.match(label[a]["text"]) for a, _ in marked[1:2]):
        return None  # top-aligned anchoring needs marker-delimited items
    pitch = min((b["y"] - a["y"] for a, b in zip(label, label[1:]) if b["y"] - a["y"] > 2), default=0.0)
    used_lines: set[int] = set()
    used_by_col: dict[int, set[int]] = {}
    for col, vls in values.items():
        for k, v in enumerate(vls):
            if not DIGIT.search(v["text"]):
                # a value-column line without a digit continues the value above it («4,0-өөс» + «багагүй.»)
                continue
            if mode == "centered":
                if len(marked) >= 2 and any(ITEM_MARKER.match(label[a]["text"]) for a, _ in marked[1:]):
                    cand = [(a, b) for (a, b) in marked if abs((label[a]["y"] + label[b]["y"]) / 2 - v["y"]) <= CENTER_TOL]
                else:
                    # no list markers (22-01-21 table 4): a one-line item carries its value on its baseline, a two-line
                    # item halfway between its lines — exactly one of the two must hold (a longer item is not decidable
                    # without markers, and the coverage check below rejects it)
                    one = [(i, i) for i, l in enumerate(label) if abs(l["y"] - v["y"]) <= TOL]
                    two = [(i, i + 1) for i in range(len(label) - 1) if abs((label[i]["y"] + label[i + 1]["y"]) / 2 - v["y"]) <= CENTER_TOL]
                    cand = one if (len(one) == 1 and not two) else two if (len(two) == 1 and not one) else []
                if len(cand) != 1:
                    return None
                a, b = cand[0]
                mine = used_by_col.setdefault(col, set())
                if mine & set(range(a, b + 1)):
                    return None  # two values of one column claim overlapping items
                mine |= set(range(a, b + 1))
                used_lines |= set(range(a, b + 1))
                pairs.append((col, k, a, v["text"], 0.0))
            elif mode == "top":
                # the value printed in the band of its item's FIRST line (cell text top-aligned, 22-01-21 table 5)
                band = 0.75 * pitch if pitch else 0.0
                cand = [a for (a, _) in marked if band and label[a]["y"] - band <= v["y"] <= label[a]["y"] + 1.0]
                if len(cand) != 1:
                    return None
                pairs.append((col, k, cand[0], v["text"], 0.0))
            elif mode == "baseline":
                cand = [i for i, l in enumerate(label) if abs(l["y"] - v["y"]) <= TOL]
                if len(cand) != 1:
                    return None
                pairs.append((col, k, cand[0], v["text"], 0.0))
            elif mode == "offset_below":
                above = [i for i, l in enumerate(label) if l["y"] < v["y"] - TOL]
                if not above:
                    return None
                i = above[-1]
                pairs.append((col, k, i, v["text"], v["y"] - label[i]["y"]))
            else:  # offset_above — the value printed a constant distance ABOVE its label line (22-01-21 table 9)
                below = [i for i, l in enumerate(label) if l["y"] > v["y"] + TOL]
                if not below:
                    return None
                i = below[0]
                pairs.append((col, k, i, v["text"], label[i]["y"] - v["y"]))
    if mode == "centered" and not (len(marked) >= 2 and any(ITEM_MARKER.match(label[a]["text"]) for a, _ in marked[1:])):
        # coverage: from the first item down, every label line belongs to exactly one anchored item
        first = min((a for (_, _, a, _, _) in pairs), default=0)
        if not pairs or any(u != set(range(first, len(label))) for u in used_by_col.values()):
            return None
    if mode in ("offset_below", "offset_above"):
        ds = [d for (_, _, _, _, d) in pairs]
        pitch = min((b["y"] - a["y"] for a, b in zip(label, label[1:]) if b["y"] - a["y"] > 2), default=0.0)
        if len(ds) < 2 or max(ds) - min(ds) > OFFSET_TOL or not pitch or max(ds) >= pitch - TOL:
            return None
    vmap: dict[tuple[int, int], int] = {}
    for col, k, i, text, _ in pairs:
        anchors.setdefault(i, {})
        if col in anchors[i]:
            return None
        anchors[i][col] = text
        vmap[(col, k)] = i
    # attach digit-less value lines to the value line directly above in the same column
    for col, vls in values.items():
        for k, v in enumerate(vls):
            if DIGIT.search(v["text"]) or k == 0:
                continue
            i = vmap.get((col, k - 1))
            if i is not None:
                anchors[i][col] = f"{anchors[i][col]} {v['text']}"
                vmap[(col, k)] = i
    return anchors


def split_packed(label: list[dict], values: dict[int, list[dict]], outer_heading: str | None = None) -> tuple[list[dict], str] | None:
    """Anchor value lines to label lines; return (sub-rows, anchoring mode) or None (ambiguous).
    `outer_heading`: on a table's continuation page the packed cell's heading can be the previous page's last row
    («2. … шийдлээр барихад:», 22-01-21 table 4) — it opens the group the lower-case items belong to."""
    anchors = anchor_values(label, values, "baseline")
    if anchors is not None:
        # same-baseline anchoring is unambiguous geometry: accept or reject, never second-guess (20-04-17 unchanged)
        items = build_items(label, anchors, outer_heading)
        return (items, "baseline") if items is not None else None
    # Every other layout is only accepted when EVERY mode that anchors AND validates yields the same pairing — the
    # direction of an offset (value below vs above its label) is not knowable from one row, so two plausible
    # readings that disagree are ambiguity, not a choice (22-01-21: table 2 reads «below», table 9 «above»).
    results: list[tuple[str, list[dict]]] = []
    for mode in ("offset_below", "offset_above", "centered", "top"):
        a = anchor_values(label, values, mode)
        if a is None:
            continue
        items = build_items(label, a, outer_heading)
        if items is not None:
            results.append((mode, items))
    if not results:
        return None
    sig = lambda its: json.dumps([(it["label"], sorted(it["cells"].items())) for it in its], ensure_ascii=False)  # noqa: E731
    if len({sig(its) for _, its in results}) != 1:
        return None
    return results[0][1], results[0][0]


def build_items(label: list[dict], anchors: dict[int, dict[int, str]], outer_heading: str | None) -> list[dict] | None:
    """Anchored label lines → items with their group headings; None when the reading fails VALIDATION."""
    if len(anchors) < 2:
        return None
    order = sorted(anchors)
    ends_item = lambda t: bool(re.search(r"[;.]\s*$", t))  # noqa: E731
    ends_head = lambda t: bool(re.search(r":\s*$", t))  # noqa: E731
    items: list[dict] = []
    stack: list[tuple[float, str]] = []

    def push_heading(run: list[dict]) -> None:
        hx = run[0]["x"]
        stack[:] = [h for h in stack if h[0] < hx - 1]
        stack.append((hx, " ".join(l["text"] for l in run)))

    if outer_heading and outer_heading.rstrip().endswith(":"):
        stack.append((-1.0, outer_heading.strip()))
    if order[0] > 0:  # everything above the first anchor is the row's heading
        push_heading(label[: order[0]])
    prev: int | None = None
    for i in order:
        between = label[prev + 1: i] if prev is not None else []
        lead: list[dict] = []
        if between:
            j = max((k for k, l in enumerate(between) if ends_head(l["text"])), default=-1)
            h0 = j
            while h0 > 0 and not ends_item(between[h0 - 1]["text"]) and not ends_head(between[h0 - 1]["text"]):
                h0 -= 1
            pre = between[: h0] if j >= 0 else between
            post = between[j + 1:] if j >= 0 else []
            for l in pre:  # continuation of the previous item until it ends; then lead lines of this item
                if items and not ends_item(items[-1]["_last"]) and not lead:
                    items[-1]["label"] += " " + l["text"]
                    items[-1]["_last"] = l["text"]
                else:
                    lead.append(l)
            if j >= 0:
                push_heading(between[h0: j + 1])
            lead.extend(post)
        lines = lead + [label[i]]
        items.append({"group_path": [h[1] for h in stack], "label": " ".join(l["text"] for l in lines), "cells": anchors[i], "_last": label[i]["text"], "y": label[i]["y"]})
        prev = i
    for l in label[order[-1] + 1:]:  # lines below the last anchor continue the last item
        items[-1]["label"] += " " + l["text"]
    for it in items:
        it.pop("_last", None)
    # VALIDATION — a heading must open like a heading (capital, digit, list marker); a lower-case label is valid
    # only under a heading that ends with «:» (7.1 «…зэргийг:» → «үйлдвэрийн нөхцөлд …»).  Anything else means
    # one printed line carried the tail of one item AND the head of the next (Д.1 row 1) → ambiguous, not split.
    opens = re.compile(r"^\s*(?:[А-ЯӨҮЁA-Z\d]|[-–•]\s|[а-яөүa-z]\)\s)")
    for it in items:
        if any(not opens.match(h) for h in it["group_path"]):
            return None
        if not opens.match(it["label"]) and not (it["group_path"] and it["group_path"][-1].rstrip().endswith(":")):
            return None
    return items


def main() -> None:
    doc_dir = Path(sys.argv[1]).resolve()
    meta = json.loads((doc_dir / "metadata.json").read_text(encoding="utf-8"))
    pdf_path = doc_dir / "source" / meta["source"]["file"]
    sha = hashlib.sha256(pdf_path.read_bytes()).hexdigest()
    tables = read_jsonl(doc_dir / "parsed" / "tables.jsonl")
    doc = pymupdf.open(str(pdf_path))
    grids_by_page: dict[int, list] = {}
    words_by_page: dict[int, list] = {}

    def grids(p: int) -> list:
        if p not in grids_by_page:
            page = doc[p - 1]
            grids_by_page[p] = [g for g in page.find_tables().tables]
            words_by_page[p] = page.get_text("words")
        return grids_by_page[p]

    out: list[dict] = []
    report = {"tool": "structure_tables/1", "tables": 0, "tables_with_packed_rows": 0, "packed_rows": 0, "rows_split": 0, "sub_rows": 0, "ambiguous_rows": 0, "grids_not_found": [], "source_sha256": sha}
    for t in tables:
        report["tables"] += 1
        want = toks(" ".join(" ".join(r) for r in t["rows"]))
        # «ruled_grid_N_pages» — every page the table spans (a 3-page table used to lose its third page; 22-01-21
        # annex 1 spans 8)
        span = re.search(r"_(\d+)_pages$", str(t.get("extraction", "")))
        pages = [t["source_pdf_page"] + k for k in range(int(span.group(1)) if span else 1)]
        matched: list[tuple[int, object]] = []
        for p in pages:
            if p > doc.page_count:
                continue
            best, score = None, 0.0
            for g in grids(p):
                cells = g.extract()
                have = toks(" ".join(" ".join(c or "" for c in r) for r in cells))
                if not have:
                    continue
                s = len(want & have) / max(1, len(have))
                if s > score:
                    best, score = g, s
            if best is not None and score >= 0.6:
                matched.append((p, best))
            elif p == pages[0]:
                # the table must start on its caption page — continuation grids alone would describe a PART of the
                # table as the whole (20-04-17 Г.2: page 66 unmatched, pages 67–68 matched a sub-grid)
                break
        rec = {"table_id": t["table_id"], "caption_raw": t.get("caption_raw"), "source_page": t.get("source_page"), "source_pdf_page": t["source_pdf_page"], "structure": "not_found" if not matched else "grid", "rows": [], "packed_rows": 0, "split_rows": 0, "ambiguous_rows": 0}
        if not matched:
            report["grids_not_found"].append(t["table_id"])
            out.append(rec)
            continue
        for p, g in matched:
            words = words_by_page[p]
            ncols = g.col_count
            # column letter mass over the whole grid → label column
            mass = [0] * ncols
            for row in g.rows:
                present = [c for c in row.cells if c is not None]
                for ci, c in enumerate(row.cells):
                    # a row whose ONLY cell spans the grid (a merged «Тайлбар:» note row) says nothing about columns
                    if c is not None and not (ncols >= 2 and len(present) == 1):
                        mass[ci] += sum(letters(l["text"]) for l in lines_in(words, c))
            label_col = max(range(ncols), key=lambda i: mass[i])
            continuation_page = bool(rec["rows"]) and p != matched[0][0]
            for ri, row in enumerate(g.rows):
                cells = row.cells
                col_lines: dict[int, list[dict]] = {ci: (lines_in(words, c) if c is not None else []) for ci, c in enumerate(cells)}
                texts = {ci: " ".join(l["text"] for l in ls) for ci, ls in col_lines.items()}
                base = {"page": p, "grid_row": ri, "cells": [texts.get(ci, "") for ci in range(ncols)], "label_col": label_col}
                lab = col_lines.get(label_col, [])
                value_cols = {ci: ls for ci, ls in col_lines.items() if ci != label_col and cells[ci] is not None and (cells[ci][2] - cells[ci][0]) > 30}
                # a range wrapped at its dash («15-» ⏎ «50», «150-» ⏎ «250» — 22-01-21 table 1) is ONE value, not two
                value_cols = {ci: join_wrapped_ranges(ls) for ci, ls in value_cols.items()}
                digit_lines = {ci: [l for l in ls if DIGIT.search(l["text"])] for ci, ls in value_cols.items()}
                packed = len(lab) >= 2 and any(len(v) >= 2 for v in digit_lines.values())
                narrow_cols = [ci for ci, c in enumerate(cells) if ci != label_col and c is not None and (c[2] - c[0]) <= 30]
                if not packed:
                    rr = {**base, "alignment": "grid_cell", "row_no": next((texts[ci] for ci in narrow_cols if texts.get(ci)), None), "label": texts.get(label_col, "")}
                    # the first body row of a table's second page with an empty «№» cell continues the last row of
                    # the previous page (8.3 row 10 «б)») — it inherits that row's number and headings, flagged.
                    narrow0 = [texts.get(ci, "") for ci, c in enumerate(cells) if ci != label_col and c is not None and (c[2] - c[0]) <= 30]
                    if continuation_page and ri == 0 and narrow0 and not any(narrow0) and rec["rows"]:
                        last = rec["rows"][-1]
                        rr.update({"row_no": last.get("row_no"), "group_path": last.get("group_path") or [], "label": texts.get(label_col, ""), "continued_from_previous_page": True})
                    rec["rows"].append(rr)
                    continue
                rec["packed_rows"] += 1
                report["packed_rows"] += 1
                outer = rec["rows"][-1].get("label") if (continuation_page and ri == 0 and rec["rows"]) else None
                got = split_packed(lab, {ci: ls for ci, ls in value_cols.items() if ls}, outer)
                items, how = got if got is not None else (None, None)
                if items is None:
                    rec["ambiguous_rows"] += 1
                    report["ambiguous_rows"] += 1
                    rec["rows"].append({**base, "alignment": "ambiguous_packed"})
                    continue
                rec["split_rows"] += 1
                report["rows_split"] += 1
                def row_no_for(it: dict) -> str | None:
                    # the «№» column: a line on the item's own baseline wins (8.4 «1», «2»); else the cell's whole text
                    for ci in narrow_cols:
                        own = [l["text"] for l in col_lines.get(ci, []) if abs(l["y"] - it["y"]) <= TOL]
                        if own:
                            return own[0]
                    return next((texts[ci] for ci in narrow_cols if texts.get(ci)), None)

                # a value column no item claimed but that holds text (22-01-21 table 9 «Тайлбар») is ONE cell spanning
                # the whole packed row — a vertical merge: every sub-row carries it, flagged in `merged_cols`
                merged = {ci: texts.get(ci, "") for ci in value_cols if texts.get(ci) and not any(it["cells"].get(ci) for it in items)}
                for k, it in enumerate(items):
                    report["sub_rows"] += 1
                    row_rec = {
                        "page": p, "grid_row": ri, "sub_row": k, "label_col": label_col,
                        "row_no": row_no_for(it),
                        "group_path": it["group_path"], "label": it["label"],
                        "cells": [it["label"] if ci == label_col else (merged[ci] if ci in merged else it["cells"].get(ci, "")) for ci in range(ncols)],
                        "alignment": {"baseline": "layout_baseline", "offset_below": "layout_offset_below", "offset_above": "layout_offset_above", "centered": "layout_centered", "top": "layout_top_aligned"}[how],
                    }
                    if merged:
                        row_rec["merged_cols"] = sorted(merged)
                    rec["rows"].append(row_rec)
        if rec["packed_rows"]:
            report["tables_with_packed_rows"] += 1
        out.append(rec)
    (doc_dir / "parsed" / "tables_structured.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in out), encoding="utf-8")
    (doc_dir / "parsed" / "tables_structured_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    sys.stdout.write(json.dumps({k: v for k, v in report.items() if k != "grids_not_found"}, ensure_ascii=False) + f" · grids_not_found {len(report['grids_not_found'])}\n")


if __name__ == "__main__":
    main()
