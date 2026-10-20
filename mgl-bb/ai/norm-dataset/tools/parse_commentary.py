#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
MGL AI · norm-dataset · OFFICIAL COMMENTARY PARSER (2026-09-23, first used for БД 20-102-21)

    python ai/norm-dataset/tools/parse_commentary.py ai/norm-dataset/documents/BNbD_20-04-17

Reads   <Doc>/commentary/metadata.json + commentary/source/<pdf>
        <Doc>/parsed/{clauses,sections}.jsonl          (the NORM — only to link, never modified)
Writes  <Doc>/commentary/parsed/commentary.jsonl       one record per commentary unit
        <Doc>/commentary/parsed/parse_report.json

⚠️ COMMENTARY IS NOT THE NORM.  Every record carries `role: COMMENTARY_SOURCE`, `normative: false`
   and its own code/page/URL.  The builder (build-l2.mjs) attaches a link to the norm clause; it never
   merges commentary text into the clause text.  A unit that cannot be linked stays `unlinked` and is
   not served next to any clause.

LAYOUT (measured on БД 20-102-21): two columns — LEFT (x1 ≤ ~250) restates the norm clause, RIGHT
   (x0 ≥ ~243) holds the commentary.  A unit opens with «<clause>.Т.» at the start of a right-column
   block («1.1.Т.», «5.6.в.Т.», «8.2.2.Т.1.»); «Т.N» sub-parts belong to the same unit.  «13.1.Т. хүснэгт»,
   «8.2.Т. зурагт үзүүлсэн» are the commentary's OWN table/figure labels, not unit markers.  Full-width
   blocks (worked examples, tables, the restated norm table) are kept in `full_text` only; the served
   excerpt is built from right-column text.  Column bounds come from metadata (`source.layout`), not code.
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

MARKER = re.compile(
    r"^\s*(?P<base>(?:[А-ЯӨҮЁ]\.)?\d{1,2}(?:\.\d{1,3})*(?:\.[а-яөүё])?)\.?\s*[ТT](?:\s*\.(?P<sub>(?:\d{1,2}\.?)*)|(?=\s+[А-ЯӨҮЁ]))\s*(?P<rest>.*)$",
    re.S,
)
# «Тайлбаргүй. 10.7.Т Цасан …» — a second unit opening in the MIDDLE of a block (after a sentence end).
# «9.6.T.» — the source sometimes types a LATIN T.  «…10.5-10.8 10.9.Т. Тайлбаргүй.» — a «no commentary» marker glued
# to the restated norm line (no sentence end before it) is split too.
MID_MARKER = re.compile(r"(?<=[.;!?])\s+(?=(?:[А-ЯӨҮЁ]\.)?\d{1,2}(?:\.\d{1,3})+(?:\.[а-яөүё])?\.?\s*[ТT](?:\s*\.|\s+[А-ЯӨҮЁ]))|\s+(?=\d{1,2}(?:\.\d{1,3})+\.?\s*[ТT]\.\s*Тайлбаргүй)")
NOT_A_MARKER = re.compile(r"^\s*(зураг|хүснэгт|бүдүүвч)", re.I)
NO_COMMENTARY = re.compile(r"^\s*Тайлбаргүй\.?\s*$")
# «Тайлбарыг 9.12-оос үз.», «Тайлбарыг 9.2.Т. 9.3.Т; 9.4.Т; 9.5.Т -с үз.» — see-also, possibly a list.
SEE_ALSO = re.compile(r"Тайлбарыг\s+((?:\d{1,2}(?:\.\d{1,3})+\.?\s*(?:[ТT]\.?)?[;,]?\s*)+)-?\s*(?:с|оос|ээс|аас|өөс)\s+үз")
APPENDIX_HEAD = re.compile(r"^\s*([А-ЯӨҮЁ])\s+[Хх]авсралт\b\s*(.*)$")
TOC_HEAD = re.compile(r"^\s*ГАРЧИГ\s*$")


def squash(s: str) -> str:
    return re.sub(r"\s+", " ", s.replace(" ", " ")).strip()


def read_jsonl(p: Path) -> list[dict]:
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()] if p.exists() else []


class Walker:
    """Block stream → commentary units.  `mode`: linked → skip (restated norm appendix) → appendix → stop."""

    def __init__(self, lay: dict, sec_titles: dict[str, str], known: set[str] | None = None):
        self.lay = lay
        # numbers that exist in the NORM (body clauses + sections).  A marker whose base is NOT one of them (e.g.
        # «3.2.Т.» — commentary on a sub-topic of section 3) is accepted only when its text opens with a capital:
        # «(14.8.Т) томьёогоор …» is the commentary's own formula label, not a unit (measured, pdf p.124).
        self.known = known or set()
        self.sec_titles = sec_titles
        self.units: list[dict] = []
        self.cur: dict | None = None
        self.mode = "linked"

    def _open(self, base: str, sub: str, first: str, pno: int, kind: str) -> None:
        if self.cur:
            self.units.append(self.cur)
        self.cur = {"base": base, "subs": [sub] if sub else [], "right": [first] if first else [], "full": [first] if first else [],
                    "pdf_page": pno, "end_pdf_page": pno, "kind": kind, "marker_raw": None, "title": None}

    def step(self, t: str, x0: float, x1: float, pno: int) -> None:
        if self.mode == "stop":
            return
        if TOC_HEAD.match(t):
            self.mode = "stop"
            return
        ap = APPENDIX_HEAD.match(t)
        if ap and len(t) < 60:
            if "Тайлбар" in ap.group(2):  # the commentary's OWN appendix («Е Хавсралт (Тайлбар)»)
                self.mode = "appendix"
                self._open(ap.group(1), "", "", pno, "commentary_appendix")
            else:  # a restated NORM appendix («А хавсралт (мэдээллийн)») — norm text, skipped
                if self.cur:
                    self.units.append(self.cur)
                    self.cur = None
                self.mode = "skip"
            return
        if self.mode == "skip":
            return
        if self.mode == "appendix":
            if self.cur is None:
                return
            if self.cur["title"] is None and t.isupper():
                self.cur["title"] = t
                return
            self.cur["full"].append(t)
            self.cur["right"].append(t)
            self.cur["end_pdf_page"] = pno
            return
        is_right = x0 >= self.lay["right_column_min_x"]
        is_left = x1 <= self.lay["left_column_max_x"]
        hm = re.match(r"^(\d{1,2})\.\s+(.+)$", t)
        if hm and not is_left and hm.group(2).strip().lower() in self.sec_titles and len(t) < 90:
            return  # a norm section heading — structure only
        m = MARKER.match(t) if not is_left else None
        if m and not NOT_A_MARKER.match(m.group("rest")) and self._plausible(m.group("base"), m.group("rest")):
            base = m.group("base")
            sub = (m.group("sub") or "").rstrip(".")
            rest = m.group("rest").strip()
            if self.cur and self.cur["base"] == base:
                if sub and sub not in self.cur["subs"]:
                    self.cur["subs"].append(sub)
                self.cur["right"].append(rest)
                self.cur["full"].append(rest)
                self.cur["end_pdf_page"] = pno
                return
            self._open(base, sub, rest, pno, "clause_commentary")
            self.cur["marker_raw"] = t[: m.start("rest")].strip()
            return
        if self.cur is None or is_left:
            return
        if is_right:
            self.cur["right"].append(t)
        self.cur["full"].append(t)
        self.cur["end_pdf_page"] = pno

    def _plausible(self, base: str, rest: str) -> bool:
        num = re.sub(r"\.[а-яөүё]$", "", base)
        if num in self.known:
            return True
        return bool(re.match(r"^\s*[А-ЯӨҮЁA-Z]", rest))

    def done(self) -> list[dict]:
        if self.cur:
            self.units.append(self.cur)
            self.cur = None
        return self.units


def main() -> None:
    doc_dir = Path(sys.argv[1]).resolve()
    cdir = doc_dir / "commentary"
    meta = json.loads((cdir / "metadata.json").read_text(encoding="utf-8"))
    norm_meta = json.loads((doc_dir / "metadata.json").read_text(encoding="utf-8"))
    src = meta["source"]
    lay = src["layout"]
    pdf_path = cdir / "source" / src["file"]
    sha = hashlib.sha256(pdf_path.read_bytes()).hexdigest()
    if sha != src["sha256"]:
        raise SystemExit(f"sha256 mismatch: {sha} != metadata {src['sha256']}")

    clauses = read_jsonl(doc_dir / "parsed" / "clauses.jsonl")
    sections = read_jsonl(doc_dir / "parsed" / "sections.jsonl")
    body = {c["clause"]: c for c in clauses if c["scope"] == "body"}
    sec_titles = {squash(s["title"]).lower(): str(s["section"]) for s in sections}
    sec_ids = {str(s["section"]) for s in sections}
    norm_code = norm_meta["canonical_code"]

    doc = pymupdf.open(str(pdf_path))
    report: dict = {"parser": "parse_commentary/1", "anomalies": [], "counts": {}}

    # printed page numbers from the footer
    printed: dict[int, int | None] = {}
    for i in range(doc.page_count):
        n = None
        for b in doc[i].get_text("blocks"):
            if b[1] >= lay["footer_min_y"] and re.fullmatch(r"\s*\d{1,3}\s*", b[4] or ""):
                n = int(b[4].strip())
        printed[i + 1] = n
    first = lay["body_first_pdf_page"]
    page_inferred: set[int] = set()
    for p in range(first, doc.page_count + 1):
        if printed[p] is None:
            prev_ok = p - 1 < first or printed.get(p - 1) == p - 2
            if printed.get(p + 1) == p and prev_ok:
                printed[p] = p - 1
                page_inferred.add(p)
                report["anomalies"].append(f"pdf page {p}: no footer number; printed page {p - 1} taken from the neighbours' constant offset (pdf-1)")

    w = Walker(lay, sec_titles, set(body) | sec_ids)
    for i in range(first - 1, doc.page_count):
        pno = i + 1
        for b in sorted(doc[i].get_text("blocks"), key=lambda b: (round(b[1]), b[0])):
            x0, y0, x1, y1, raw = b[:5]
            if y0 < lay["header_max_y"] or y0 >= lay["footer_min_y"]:
                continue
            t0 = squash(raw or "")
            if not t0:
                continue
            parts = [t0] if x1 <= lay["left_column_max_x"] else [x for x in MID_MARKER.split(t0) if x.strip()]
            for t in parts:
                w.step(t, x0, x1, pno)
        if w.mode == "stop":
            break
    units = w.done()

    out: list[dict] = []
    seen: dict[str, int] = {}
    for u in units:
        base = u["base"]
        text = squash(" ".join(u["right"]))
        full = squash(" ".join(u["full"]))
        seen[base] = seen.get(base, 0) + 1
        uid_key = base if seen[base] == 1 else f"{base}@{u['pdf_page']}"
        if seen[base] > 1:
            report["anomalies"].append(f"marker {base} opens a second unit on pdf page {u['pdf_page']}")
        link: dict = {"resolution": "unlinked", "clause_uid": None, "clause_id": None, "item": None, "section": None}
        if u["kind"] == "clause_commentary":
            mm = re.match(r"^(\d{1,2}(?:\.\d{1,3})*)(?:\.([а-яөүё]))?$", base)
            if mm:
                num, item = mm.group(1), mm.group(2)
                sec = num.split(".")[0]
                if num in body:
                    link = {"resolution": "clause_item" if item else "clause", "clause_uid": body[num]["clause_id"], "clause_id": num, "item": item, "section": sec}
                else:
                    parent = ".".join(num.split(".")[:-1])
                    if parent and parent in body:
                        link = {"resolution": "parent_clause", "clause_uid": body[parent]["clause_id"], "clause_id": parent, "item": None, "section": sec}
                    elif sec in sec_ids:
                        link = {"resolution": "section", "clause_uid": None, "clause_id": None, "item": None, "section": sec}
        no_comm = bool(NO_COMMENTARY.match(text)) if u["kind"] == "clause_commentary" else False
        sa = SEE_ALSO.search(text)
        out.append({
            "commentary_uid": f"{meta['canonical_code']}#{uid_key}",
            "commentary_code": meta["canonical_code"],
            "commentary_doc_id": meta["doc_id"],
            "commentary_of": norm_code,
            "role": "COMMENTARY_SOURCE",
            "normative": False,
            "kind": u["kind"],
            "marker": base,
            "marker_raw": u["marker_raw"],
            "sub_parts": u["subs"],
            "title": u["title"],
            "norm_link": link,
            "no_commentary": no_comm,
            "see_also": re.findall(r"\d{1,2}(?:\.\d{1,3})+", sa.group(1)) if sa else [],
            "text": text,
            "full_text": full,
            "text_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
            "source_page": printed.get(u["pdf_page"]),
            "source_pdf_page": u["pdf_page"],
            "end_page": printed.get(u["end_pdf_page"]),
            "end_pdf_page": u["end_pdf_page"],
            "page_inferred": u["pdf_page"] in page_inferred,
            "source_url": meta["source_url"],
            "pdf_url": meta["source_pdf_url"],
            "document_sha256": sha,
            "verification_status": "official_pdf_text_layer_auto_extracted",
        })

    by_res: dict[str, int] = {}
    for r in out:
        by_res[r["norm_link"]["resolution"]] = by_res.get(r["norm_link"]["resolution"], 0) + 1
    linked = {r["norm_link"]["clause_id"] for r in out if r["norm_link"]["clause_id"]}
    report["counts"] = {
        "units": len(out),
        "with_commentary": sum(1 for r in out if not r["no_commentary"]),
        "no_commentary": sum(1 for r in out if r["no_commentary"]),
        "link_resolution": by_res,
        "commentary_appendix": sum(1 for r in out if r["kind"] == "commentary_appendix"),
        "pages_inferred": len(page_inferred),
        "norm_body_clauses": len(body),
        "norm_body_clauses_with_a_unit": len([c for c in body if c in linked]),
    }
    report["norm_body_clauses_without_unit"] = [c for c in body if c not in linked]
    report["source_sha256"] = sha
    pdir = cdir / "parsed"
    pdir.mkdir(parents=True, exist_ok=True)
    (pdir / "commentary.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in out), encoding="utf-8")
    (pdir / "parse_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    sys.stdout.write(json.dumps(report["counts"], ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
