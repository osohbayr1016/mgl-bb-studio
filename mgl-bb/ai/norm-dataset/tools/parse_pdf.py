#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
MGL AI · norm-dataset · PDF → parsed/  (L1 + L2 structure extraction)

    python ai/norm-dataset/tools/parse_pdf.py ai/norm-dataset/documents/BNbD_31-17-10

Reads  <doc>/metadata.json  +  <doc>/source/<pdf named in metadata.source.file>
Writes <doc>/parsed/{document.md, clauses.jsonl, tables.jsonl, formulas.jsonl,
                     references.jsonl, definitions.jsonl, numeric_requirements.jsonl,
                     appendices.jsonl, sections.jsonl, parse_report.json}

⚠️ DERIVED, REPRODUCIBLE, NEVER HAND-EDITED.  Every record carries `source_page`
   (the PRINTED page number that a citation must show) and `source_pdf_page` (the
   PDF page index, for audit only).  The two differ by a constant offset per
   document (metadata.source.printed_page_offset).

⚠️ WHAT THIS IS NOT.  It is a text-layer parser, not a human verification.  Every
   record is emitted with `verification_status` =
   `official_pdf_text_layer_auto_extracted` (registered as NON-EXECUTABLE in
   ai/retrieval/src/rules.ts).  The document becomes searchable and citable (L1/L2);
   numeric rules become searchable but are NOT executed as authoritative answers
   until a human verifies them against the page image (then the status is changed
   in the pack by the verifier, not here).

⚠️ TWO LAYOUT FAMILIES, ONE PARSER (2026-09-21, БНбД 20-04-17).  31-17-10 numbers its
   appendices («1-р хавсралт»), writes section headings in CAPITALS and has a constant
   printed-page offset.  20-04-17 letters its appendices («Б хавсралт (заавал мөрдөх)»,
   clauses «Б.1.1»), writes headings in Title case, defines terms inside clause 3.1.N
   («“Ачаалал” гэж …») and its MCIS render carries the printed page number at the top of
   every page (`metadata.source.page_number_mode: "top_of_page"`).  Both shapes are
   detected from the text; nothing is keyed on the document code.

⚠️ LEGACY «Arial Mon» ENCODING.  Mongolian PDFs produced with the Arial Mon /
   Times New Roman Mon fonts store Cyrillic as Latin-1 code points 0xC0–0xFF in
   cp1251 order, with є/Є/ї/Ї standing in for ө/Ө/ү/Ү.  `demon()` maps them back.
   Mixed documents (some runs already Unicode) are fine — real Unicode Cyrillic
   is outside the remapped range.  The remap runs ONLY when the text layer contains at
   least one Latin-1 letter code point (0xC0–0xFF); in a genuine-Unicode file (41-01-11)
   the ordinal «º» (U+00BA) is a degree sign and must not become «ө».

⚠️ THIRD LAYOUT (2026-09-21, БНбД 41-01-11): CAPITALS headings, «ХАВСРАЛТ А» (word
   first), clauses «К.1», tables «Хүснэгт Б.1» (with source slips «Д,1», «С1», Latin «P.3»),
   the reference list inside body §2, definitions in appendix А, formulas «(1)» / «(Л.1)»,
   clauses that start mid-line («…авна. 5.9 Үйлдвэрийн…»), and NO printed page numbers
   (citations use the PDF page index, offset 0).  Still detected from the text.

Dependencies: pymupdf (pip install pymupdf).  No OCR.
"""
from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path

try:
    import pymupdf  # type: ignore
except ImportError:  # pragma: no cover
    sys.stderr.write("pymupdf is required:  pip install pymupdf\n")
    sys.exit(2)

PARSER_VERSION = "parse_pdf/1"
AUTO_STATUS = "official_pdf_text_layer_auto_extracted"

# ── Arial Mon decode ─────────────────────────────────────────────────
_REMAP_EXTRA = {0xA8, 0xAA, 0xAF, 0xB8, 0xBA, 0xBF}
_UKR_TO_MN = {"є": "ө", "Є": "Ө", "ї": "ү", "Ї": "Ү"}


def demon(s: str) -> str:
    out = []
    for ch in s:
        o = ord(ch)
        if 0xC0 <= o <= 0xFF or o in _REMAP_EXTRA:
            try:
                c = bytes([o]).decode("cp1251")
            except UnicodeDecodeError:
                c = ch
            out.append(_UKR_TO_MN.get(c, c))
        else:
            out.append(ch)
    return "".join(out)


# ── Records ──────────────────────────────────────────────────────────
@dataclass
class Clause:
    clause_id: str
    document_code: str
    section: str
    clause: str
    heading: str | None
    text: str
    source_page: int | None
    source_pdf_page: int
    end_page: int | None
    scope: str  # body | appendix
    appendix: str | None
    notes: list[str] = field(default_factory=list)
    source_url: str = ""
    status: str = ""
    verification_status: str = AUTO_STATUS


@dataclass
class Table:
    table_id: str
    document_code: str
    title: str | None
    caption_raw: str
    columns: list[str]
    rows: list[list[str]]
    notes: list[str]
    source_page: int | None
    source_pdf_page: int
    clause_context: str | None
    extraction: str  # ruled_grid | ruled_grid_N_pages | ruled_grid_uncaptioned | caption_only
    title_source: str = "preceding_text_hint"
    source_url: str = ""
    verification_status: str = AUTO_STATUS


@dataclass
class Formula:
    formula_id: str
    document_code: str
    clause: str | None
    label: str
    expression: str
    expression_quality: str  # text_layer_clean | text_layer_garbled
    variables: list[dict]
    units: list[str]
    conditions: list[str]
    source_page: int | None
    source_pdf_page: int
    source_url: str = ""
    verification_status: str = AUTO_STATUS
    # written only when set (OMIT_WHEN_NONE) — older documents' formulas.jsonl stay byte-identical
    extraction: str | None = None  # "inline_label_in_clause_text" — recovered from the clause text, not a formula line
    review: dict | None = None  # {status: FORMULA_IMAGE_REVIEW_REQUIRED, reason, checked_against, checked_at}


OMIT_WHEN_NONE = {"extraction", "review"}


# ── Regexes ──────────────────────────────────────────────────────────
UPPER_MN = "А-ЯӨҮЁ"
RE_SECTION = re.compile(r"^\s*(\d{1,2})\.\s+(\S.*)$")
# «8.ГАЛ ТҮЙМРИЙН …» — heading with no space after the dot (41-01-11 §8); only a CAPITAL letter
# may follow directly, so «8.1 Барилгын» (a clause) never matches.
RE_SECTION_NOSPACE = re.compile(r"^\s*(\d{1,2})\.([А-ЯӨҮЁ].*)$")
# «4.» ⏎ «ҮНДСЭН ЗАРЧИМ» — the section number alone on its line, the CAPITALS title on the next
# (22-01-21 §4, §5).  Without this the whole section (§4–§5, 37 k characters) was glued onto 3.54.
RE_SECTION_BARE = re.compile(r"^\s*(\d{1,2})\.\s*$")
# «07 дугаар тушаалын нэгдүгээр хавсралт» — the header of an annex that an ORDER (re)approved, printed
# above the annex itself (22-01-21 annexes 1–2, re-approved by order 07 of 2022).  The two lines above it
# («Барилга, хот байгуулалтын сайдын» ⏎ «2022 оны 01 дүгээр сарын 06-ны өдрийн») are part of the header.
ORDINAL_MN = {"нэг": 1, "хоёр": 2, "гурав": 3, "дөрөв": 4, "тав": 5, "зургаа": 6, "долоо": 7, "найм": 8, "ес": 9, "арав": 10}
RE_ORDER_ANNEX = re.compile(r"^\s*(\d{1,3}|\.{2,})\s+(?:дугаар|дүгээр)\s+тушаалын\s+(нэг|хоёр|гурав|дөрөв|тав|зургаа|долоо|найм|ес|арав)(?:дугаар|дүгээр)\s+хавсралт\s*\.?\s*$", re.I)
RE_ORDER_HEADER_LINE = re.compile(r"(?:сайдын|даргын)\s*$|^\s*(?:\d{4}|\.{2,})\s+оны\s+.*өдрийн\s*$", re.I)
RE_ORDER_DATE = re.compile(r"(\d{4})\s+оны\s+(\d{1,2})\s+(?:дүгээр|дугаар)\s+сарын\s+(\d{1,2})")
# «2 дугаар хүснэгт» (the whole line) / «Хүснэгт. 8» / «Хүснэгт. 9 Өрөгт …» — 22-01-21 caption forms.  The
# table's TITLE is printed on the line(s) ABOVE the standalone number («Ачааллын хослолын илтгэлцүүр» ⏎
# «2 дугаар хүснэгт»), so it is taken from there (and removed from the clause text).
RE_TABLE_CAPTION_ORD = re.compile(r"^\s*(\d{1,2})\s+(?:дүгээр|дугаар)\s+хүснэгт\s*\.?\s*$", re.I)
RE_TABLE_CAPTION_DOT = re.compile(r"^\s*Хүснэгт\.\s*(\d{1,2})\b\s*[.:]?\s*(.*)$")
RE_TABLE_CAPTION_WORD_ALONE = re.compile(r"^\s*Хүснэгт\s+(\d{1,2})\s*$")  # «Хүснэгт 15» alone on its line, title above
# «(1)» alone on its line — the label of an equation printed on the lines ABOVE it (22-01-21: Word
# equation objects with stacked sub/superscripts).  Accepted only when those lines hold an «=».
RE_FORMULA_LABEL_BARE = re.compile(r"^\s*\(\s*(\d{1,2})\s*\)\s*\.?\s*$")
RE_APPENDIX = re.compile(r"^\s*(\d{1,2}(?:\.\d)?)\s*-р\s*хавсралт\b(.*)$", re.I)
# «Б хавсралт (заавал мөрдөх)» — lettered appendix (20-04-17).  A single Cyrillic capital
# followed by the word; the tail carries the kind in parentheses and/or the title.
RE_APPENDIX_LETTER = re.compile(r"^\s*([А-ЯӨҮЁ])\s+хавсралт\b(.*)$")
# «ХАВСРАЛТ А» — word first, CAPITALS (41-01-11).  Only the upper-case word form is a header;
# an in-text mention is «хавсралт А-д» (lower case, suffixed) and must stay prose.
RE_APPENDIX_WORD_FIRST = re.compile(r"^\s*ХАВСРАЛТ\s+([А-ЯӨҮЁA-Z])\s*(.*)$")
RE_APPENDIX_KIND = re.compile(r"^\s*[(/]?\s*(Заавал мөрдөх|Зөвлөмжийн|Лавлах|Мэдээллийн)\s*[)/]?\.?\s*$", re.I)
RE_CLAUSE = re.compile(r"^\s*(\d{1,2}(?:\.\d{1,3}){1,3})\.?\s+(\S.*)$")
RE_CLAUSE_BARE = re.compile(r"^\s*(\d{1,2}(?:\.\d{1,3}){1,3})\.?\s*$")
# «Б.1.1. …» — clause inside a lettered appendix.  The letter stays in the clause id
# («Б.1.1»), so ids are unique across appendices and match how the text cites them.
RE_CLAUSE_LETTER = re.compile(r"^\s*([А-ЯӨҮЁ]\.\d{1,2}(?:\.\d{1,3}){0,3})\.?\s+(\S.*)$")
RE_TABLE_CAPTION = re.compile(r"(?:^|\s)((?:[А-ЯӨҮЁ]\.\s?)?\d{1,2}(?:\.\d{1,2}){0,2})\s*[-–]\s*р\s+хүснэгт\b|^\s*Хүснэгт\s+((?:[А-ЯӨҮЁA-Za-z][.,]?\s?)?\d{1,2}(?:\.\d{1,2}){0,2})\b", re.I)
# Word-first captions in 41-01-11 carry typographic slips: «Хүснэгт Д,1», «Хүснэгт С1» and Latin
# look-alikes «Хүснэгт p.1 / P.3 / M.1 / T.3» for Р / М / Т.  The id is normalised to «Д.1»;
# the raw caption is kept in `caption_raw`.
_LATIN_TO_CYR_LOOKALIKE = {"A": "А", "B": "В", "C": "С", "E": "Е", "H": "Н", "K": "К", "M": "М", "O": "О", "P": "Р", "T": "Т", "X": "Х"}


def norm_table_id(raw: str) -> str:
    t = re.sub(r"\s+", "", raw).replace(",", ".")  # «Г. 10» → «Г.10», «Д,1» → «Д.1»
    m = re.match(r"^([А-ЯӨҮЁA-Za-z])\.?(\d.*)$", t)
    if m:
        letter = _LATIN_TO_CYR_LOOKALIKE.get(m.group(1).upper(), m.group(1))
        t = f"{letter}.{m.group(2)}"  # «С1» → «С.1», «p.1» → «Р.1»
    return t
# «…11-ээс 15-р хүснэгт ашиглаж авах бол» — a caption sits at the START of a line (or the
# line is nothing but the caption); a table number quoted inside a sentence is a reference.
RE_LIST_ITEM = re.compile(r"^\s*[а-яa-zөү]\)")
# «“Ачаалал” гэж …» — a term defined inside a clause (20-04-17 section 3.1.N); 31-17-10
# keeps its definitions in appendix 1 («Term - definition»), both feed definitions.jsonl.
RE_CLAUSE_DEFINITION = re.compile(r"^\s*[“«\"]([^”»\"]{2,90})[”»\"]\s+гэж\s+(.+)$")
RE_APPENDIX_ROLE_DEFINITIONS = re.compile(r"нэр\s*томь?ёо", re.I)
RE_APPENDIX_ROLE_REFERENCES = re.compile(r"[иэ]ш\s*татсан|норматив\s*ишлэл|ишлэл\s*авсан|баримт\s*бичгийн\s*[иэ]шлэл", re.I)
# a dash-bulleted reference list in a body section (22-01-21 §2 «- БНбД 2.01.07-16 Ачаалал ба үйлчлэл»)
RE_REF_BULLET = re.compile(r"^\s*[-–•]\s+(\S.*)$")
RE_CAPTION_TAIL = re.compile(r"^\s*[-–]\s*р\s+хүснэгт\b", re.I)
RE_FORMULA_LABEL = re.compile(r"\(\s*(\d{1,2}(?:\.\d{1,2}){1,3}\s*[абвa-c]?)\s*\)\s*\.?\s*$")
# «Vx = KnvH ;   (1)» / «(Л.1)» — 41-01-11 numbers its formulas with a bare integer (body) or
# «letter.n» (appendix Л).  A bare integer is accepted ONLY when the text before it on the same
# line contains «=» — «(2)» at the end of a sentence is a list reference, not a formula.
RE_FORMULA_LABEL_SIMPLE = re.compile(r"\(\s*(\d{1,2}|[А-ЯӨҮЁ]\.\d{1,2})\s*\)\s*\.?\s*$")
# «…авна. 5.9 Үйлдвэрийн …» — the next clause starts in the middle of a line (41-01-11).  Split
# only when the number is the very next clause in sequence (checked by the caller).
RE_INLINE_CLAUSE = re.compile(r"[.;:]\s+(\d{1,2}(?:\.\d{1,3}){1,3})\.?\s+(?=[А-ЯӨҮЁ])")
RE_HEADER_CODE = None  # set from metadata
RE_PAGE_NO = re.compile(r"^\s*\d{1,3}\s*$")
RE_NOTE = re.compile(r"^\s*Тайлбар\s*[:.]", re.I)
RE_REF_CODE = re.compile(
    r"(БНбД|БНОД|БД|СНиП|СНИП|MNS|ГОСТ|СП|УББ|БНОД)\s*((?:II|I|IV|V)?[\d.\-–/*]*\d[\d.\-–/*]*)",
)
RE_NUM_UNIT = re.compile(
    r"(?<![\w.,])(\d{1,4}(?:[.,]\d{1,3})?)(?:\s*[-–]\s*(\d{1,4}(?:[.,]\d{1,3})?))?\s*"
    r"(м2|м²|мм|см|м/мин|м/с2|м/с|кПа|кпа|кгс/м2|кН/м|кг/м3|%|давхар|секунд|сек|минут|мин|цаг|°С|0С|Гц|В|Вт|люкс|кВт|ОМ|Ом|Па|хүн/м2|хүн)?"
    r"\s*[-–]?\s*(?:ээс|аас|оос|өөс|ээс|с)?\s*"
    r"(ихгүй|багагүй|хэтрэхгүй|дээшгүй|доошгүй|хүртэл|дээш|доош|бага байх|их байх|тэнцүү)",
    re.I,
)
OP_MAP = {
    "ихгүй": "<=", "хэтрэхгүй": "<=", "дээшгүй": "<=", "доош": "<=", "хүртэл": "<=", "бага байх": "<",
    "багагүй": ">=", "доошгүй": ">=", "дээш": ">=", "их байх": ">",
    "тэнцүү": "=",
}


def clause_parts(cid: str) -> list[int]:
    """«3.1.8» → [3, 1, 8]; «Б.1.1» → [1, 1] (the appendix letter is a scope, not a level)."""
    return [int(x) for x in cid.split(".") if x.isdigit()]


def is_mostly_upper(s: str) -> bool:
    letters = [ch for ch in s if ch.isalpha()]
    if len(letters) < 4:
        return False
    return sum(1 for ch in letters if ch.isupper()) / len(letters) >= 0.7


def norm_num(s: str) -> float:
    return float(s.replace(",", "."))


def squash(lines: list[str]) -> str:
    t = " ".join(x.strip() for x in lines if x.strip())
    t = re.sub(r"\s+", " ", t)
    t = re.sub(r"(\w)-\s+(\d)", r"\1-\2", t)  # «31-\n03-03»
    return t.strip()


# ── Main parser ──────────────────────────────────────────────────────
class NormPdfParser:
    def __init__(self, doc_dir: Path):
        self.doc_dir = doc_dir
        self.meta = json.loads((doc_dir / "metadata.json").read_text(encoding="utf-8"))
        self.code: str = self.meta["canonical_code"]
        src = self.meta["source"]
        self.pdf_path = doc_dir / "source" / src["file"]
        self.offset: int = int(src.get("printed_page_offset", 0))
        # «top_of_page»: the printed page number is read from the running header of each
        # page (code line + number, or a bare number) — used when one PDF mixes two
        # paginations (20-04-17: MCIS render 1–39, then original 31–88).  Default «offset».
        self.page_number_mode: str = str(src.get("page_number_mode", "offset"))
        self.page_printed: dict[int, int] = {}
        self.body_first_pdf_page: int = int(src.get("body_first_pdf_page", 1))
        self.source_url: str = self.meta.get("source_url", "")
        self.status: str = self.meta.get("status", "")
        self.report: dict = {"parser": PARSER_VERSION, "warnings": [], "anomalies": []}
        self.pages: list[list[str]] = []
        self.page_tables: dict[int, list] = {}
        self.frame_pages: set[int] = set()  # pages whose only «grid» was the printed page border
        self.clauses: list[Clause] = []
        self.tables: list[Table] = []
        self.formulas: list[Formula] = []
        self.sections: list[dict] = []
        self.appendices: list[dict] = []
        self.definitions: list[dict] = []
        self.references: list[dict] = []
        self.numeric: list[dict] = []
        self.md: list[str] = []

    # page bookkeeping
    def printed(self, pdf_page: int) -> int | None:
        if self.page_number_mode == "top_of_page":
            n = self.page_printed.get(pdf_page)
            if n is not None:
                return n
            note = f"pdf page {pdf_page}: no page number in header; printed page unknown"
            if note not in self.report["anomalies"]:
                self.report["anomalies"].append(note)
            return None
        p = pdf_page - self.offset
        return p if p >= 1 else None

    def load(self) -> None:
        doc = pymupdf.open(str(self.pdf_path))
        header_re = re.compile(rf"^\s*{re.escape(self.code)}\s*$")
        # The Arial-Mon remap is applied only when the text layer really carries legacy
        # Latin-1 letter code points (0xC0–0xFF).  A genuine-Unicode file (41-01-11) has none,
        # and there the ordinal «º» (U+00BA) is a degree sign — remapping it would turn every
        # «70ºС» into «70өС» (measured: 119 places).
        legacy = any(re.search(r"[À-ÿ]", doc[i].get_text("text")) for i in range(doc.page_count))
        dec = demon if legacy else (lambda s: s)  # silent: 20-04-17 is genuine Unicode too and its report must not change
        for i in range(doc.page_count):
            page = doc[i]
            raw = dec(page.get_text("text"))
            lines = raw.splitlines()
            # strip running header (code line + printed page number line right after)
            cleaned: list[str] = []
            j = 0
            head = 0
            while j < len(lines) and head < 6:
                s = lines[j].strip()
                if s == "" or header_re.match(s) or (RE_PAGE_NO.match(s) and head < 4):
                    if RE_PAGE_NO.match(s) and (i + 1) not in self.page_printed:
                        self.page_printed[i + 1] = int(s)
                    j += 1
                    head += 1
                    continue
                break
            cleaned = lines[j:]
            self.pages.append(cleaned)
            try:
                tabs = page.find_tables()
                grids = []
                for t in tabs.tables:
                    cells = [[(dec(c).replace("\n", " ").strip() if c else "") for c in r] for r in t.extract()]
                    # ⚠️ PAGE FRAME (41-01-11, MCIS-stamped PDF): the printed page border is
                    # detected as ONE grid that holds the whole page text — its first cell is the
                    # page's first text line.  Re-detect inside the border; if nothing is found
                    # the frame is dropped (the caption then falls back to `caption_only` lines).
                    first_line = next((ln.strip() for ln in cleaned if ln.strip()), "")
                    first_cell = next((c for r in cells for c in r if c), "")
                    n_cells = sum(len(r) for r in cells)
                    empty_share = (sum(1 for r in cells for c in r if not c) / n_cells) if n_cells else 0.0
                    # a real table that opens a page (31-17-10 p.41: 17 % empty cells) is not a frame (≥ 60 %)
                    bx0, by0, bx1, by1 = t.bbox
                    area_share = ((bx1 - bx0) * (by1 - by0)) / max(1.0, page.rect.width * page.rect.height)
                    # frame = holds the page's first text line, OR covers most of the page while being mostly empty
                    n_cols = len(cells[0]) if cells else 0
                    is_frame = bool(cells) and len(cells) >= 8 and (
                        (bool(first_line) and first_cell == first_line and n_cols <= 3 and empty_share >= 0.45)  # 2-col border; a 12-col table continuation (31-17-10 p.111) is not a frame
                        or (area_share >= 0.55 and empty_share >= 0.6))
                    if is_frame:
                        x0, y0, x1, y1 = t.bbox
                        inner = page.find_tables(clip=pymupdf.Rect(x0 + 4, y0 + 4, x1 - 4, y1 - 4)).tables
                        # position of each inner grid = number of non-empty text lines above it
                        # (header lines already stripped), so a caption can claim the grid BELOW it
                        stripped = sum(1 for ln in lines[:j] if ln.strip())
                        text_lines = [(ln["bbox"][3], "".join(sp["text"] for sp in ln["spans"]).strip()) for bl in page.get_text("dict")["blocks"] if bl.get("type", 0) == 0 for ln in bl["lines"]]
                        for it in inner:
                            above = sum(1 for (y_bot, txt) in text_lines if txt and y_bot <= it.bbox[1] + 2) - stripped
                            grids.append({"bbox": it.bbox, "inner": True, "lines_above": max(0, above),
                                          "cells": [[(dec(c).replace("\n", " ").strip() if c else "") for c in r] for r in it.extract()]})
                        self.frame_pages.add(i + 1)
                        self.report["anomalies"].append(f"page frame detected as a grid on pdf page {i+1}; {len(inner)} inner table(s) re-detected")
                        continue
                    grids.append({"bbox": t.bbox, "cells": cells})
                self.page_tables[i + 1] = grids
            except Exception as e:  # pragma: no cover
                self.report["warnings"].append(f"find_tables failed on pdf page {i+1}: {e}")
        doc.close()

    # ── structure pass ──
    def parse(self) -> None:
        cur_section: str | None = None
        cur_section_title: str | None = None
        scope = "body"
        cur_app: str | None = None
        cur_app_kind: str | None = None
        cur_clause: Clause | None = None
        buf: list[str] = []
        pending_heading: str | None = None
        in_toc = False
        table_open: dict | None = None
        app1_paras: list[tuple[list[str], int]] = []
        app2_lines: list[tuple[str, int]] = []
        expecting_app_title = 0
        # role of the current appendix: «definitions» / «references» / None — decided by
        # number (1/2, legacy numbered layout) or by its title (lettered layout).
        cur_app_role: str | None = None
        ref_app_id: str | None = None
        def_app_id: str | None = None
        # True right after a Title-case heading line — only the NEXT line may continue it
        heading_open = False
        upper_open = False  # True right after a CAPITALS heading line (or its continuation)
        # prose between a section heading and its first clause (20-04-17 §11, §14, §15 have
        # whole paragraphs there) — stored on the section record as `intro`, not dropped.
        section_intro: list[str] = []
        # heading style detected from the text: once a CAPITALS heading has been seen the
        # Title-case rule is off — in 41-01-11 the reference list inside §2 («1. Дуу шуугиан…»,
        # «5. БНбД 31-03-03 …») is numbered sequentially and would otherwise read as headings.
        heading_style: str | None = None
        # numbered reference list living in a BODY section (41-01-11 §2) rather than an appendix
        ref_section_id: str | None = None
        sec_ref_lines: list[tuple[str, int]] = []
        # the same list printed with dash bullets (22-01-21 §2) — collected ALONGSIDE the section intro (the list
        # stays searchable in the §2 chunk); the numbered form above keeps its historical «out of the intro» rule
        sec_ref_bullet_lines: list[tuple[str, int]] = []
        # annex opened by an order header («… тушаалын нэгдүгээр хавсралт»): its first ruled grid is the annex
        # table itself (22-01-21 annex 1 — no «N-р хүснэгт» caption), so the grid opens a table on its own
        pending_annex_table = False
        toc_lines: list[str] = []

        def pop_title_lines(lines_buf: list[str]) -> str | None:
            """«Ачааллын хослолын илтгэлцүүр» ⏎ «2 дугаар хүснэгт» — the title printed ABOVE a standalone caption.
            Up to 3 trailing lines without sentence punctuation whose topmost starts with a capital are the
            title; they are REMOVED from the clause text (they are not part of the requirement)."""
            got: list[str] = []
            k = len(lines_buf) - 1
            while k >= 0 and len(got) < 3:
                ln = lines_buf[k].strip()
                if not ln or ln.endswith((".", ";", ":", "!", "?")) or len(ln) > 140 or RE_LIST_ITEM.match(ln):
                    break
                got.insert(0, ln)
                k -= 1
            # the title opens with a capital or a symbol («𝒛𝒛𝒉𝒉 ⁄ харьцаанаас …» — math alphanumerics are symbols here),
            # never with a lower-case word (that is the tail of the sentence above)
            def opens_title(t: str) -> bool:
                c = t[:1]
                return bool(c) and (c.isupper() or not c.isalpha() or 0x1D400 <= ord(c) <= 0x1D7FF)
            # … and a line without any letter («0», the tail of the previous table's «1. 0») is not a title line
            while got and (not opens_title(got[0]) or not re.search(r"[^\W\d_]", got[0])):
                got.pop(0)
            if not got:
                return None
            del lines_buf[len(lines_buf) - len(got):]
            return squash(got)

        def flush_clause(end_pdf: int):
            nonlocal cur_clause, buf
            if cur_clause is not None:
                cur_clause.text = squash(buf)
                cur_clause.end_page = self.printed(end_pdf)
                if cur_clause.text:
                    self.clauses.append(cur_clause)
            cur_clause = None
            buf = []

        def flush_table():
            nonlocal table_open
            if table_open is not None:
                self._finish_table(table_open)
            table_open = None

        def flush_intro():
            nonlocal section_intro
            if section_intro and self.sections and scope == "body":
                self.sections[-1]["intro"] = squash(section_intro)
            section_intro = []

        for pi, lines in enumerate(self.pages):
            pdf_page = pi + 1
            if pdf_page < self.body_first_pdf_page:
                continue
            for li, raw in enumerate(lines):
                line = raw.rstrip()
                s = line.strip()
                if s == "":
                    continue
                was_open, heading_open = heading_open, False
                upper_open_prev, upper_open = upper_open, False
                # «7.1.2» + next line «–р хүснэгт. …» = a table caption split over two lines
                if RE_CLAUSE_BARE.match(s):
                    nxt_i = next((k for k in range(li + 1, min(li + 3, len(lines))) if lines[k].strip()), None)
                    if nxt_i is not None and RE_CAPTION_TAIL.match(lines[nxt_i].strip()):
                        s = s + " " + lines[nxt_i].strip()
                        lines[nxt_i] = ""
                # «4.» ⏎ «ҮНДСЭН ЗАРЧИМ» — join a bare section number with its CAPITALS title line
                bsm = RE_SECTION_BARE.match(s)
                if bsm and scope == "body" and not in_toc:
                    nxt_i = next((k for k in range(li + 1, min(li + 3, len(lines))) if lines[k].strip()), None)
                    if nxt_i is not None and is_mostly_upper(lines[nxt_i].strip()) and not RE_CLAUSE.match(lines[nxt_i].strip()):
                        s = f"{bsm.group(1)}. {lines[nxt_i].strip()}"
                        lines[nxt_i] = ""
                if (s.upper().startswith("ГАРЧИГ") or s.upper().startswith("АГУУЛГА")) and pdf_page > self.body_first_pdf_page + 5:
                    in_toc = True
                if in_toc:
                    toc_lines.append(s)
                    continue
                # a clause that starts mid-line («…авна. 5.9 Үйлдвэрийн …»): cut the line and
                # push the remainder back so it is processed as its own line
                if cur_clause is not None and scope == "body":
                    im = RE_INLINE_CLAUSE.search(s)
                    if im and self._is_next_clause(im.group(1), cur_clause):
                        lines.insert(li + 1, s[im.start(1):])
                        s = s[: im.start(1)].rstrip()

                # annex header printed by the order that (re)approved it — «07 дугаар тушаалын нэгдүгээр хавсралт»
                om = RE_ORDER_ANNEX.match(s)
                if om:
                    # the header block's first lines («Барилга, хот байгуулалтын сайдын» ⏎ «2022 оны … өдрийн») were
                    # already taken as text of the previous clause / table — take them back
                    block: list[str] = []
                    for holder in (buf, table_open["lines"] if table_open is not None else []):
                        while holder and RE_ORDER_HEADER_LINE.search(holder[-1].strip()) and len(block) < 3:
                            block.insert(0, holder.pop().strip())
                    flush_clause(pdf_page)
                    flush_table()
                    flush_intro()
                    scope = "appendix"
                    cur_app = str(ORDINAL_MN[om.group(2).lower()])
                    cur_section = cur_app
                    cur_app_kind = None
                    cur_app_role = None  # an order's annex is content, never the definitions/references list
                    header = squash(block + [s])
                    dm = RE_ORDER_DATE.search(header)
                    rec = {"appendix_id": cur_app, "document_code": self.code, "kind": None,
                           "title": None, "source_page": self.printed(pdf_page), "source_pdf_page": pdf_page,
                           "source_url": self.source_url, "verification_status": AUTO_STATUS,
                           "published_by_order": {
                               "number": om.group(1) if om.group(1)[0].isdigit() else None,
                               "date": (f"{dm.group(1)}-{int(dm.group(2)):02d}-{int(dm.group(3)):02d}" if dm else None),
                               "header": header,
                           }}
                    self.appendices.append(rec)
                    expecting_app_title = 3
                    pending_annex_table = True
                    self.md.append(f"\n## Хавсралт {cur_app}\n")
                    self.md.append(header)
                    continue
                # while an order-annex title is still being read: its sentence-case title wraps over lines
                # («Монгол орны хот, … 2500 жилийн» ⏎ «давтагдах хугацааны …» ⏎ «баллын утгууд»)
                if (scope == "appendix" and self.appendices and self.appendices[-1].get("published_by_order")
                        and self.appendices[-1]["title"] is not None and expecting_app_title > 0
                        and s[:1].islower() and not self.appendices[-1]["title"].endswith((".", ";", ":"))):
                    self.appendices[-1]["title"] = (self.appendices[-1]["title"] + " " + s).strip()
                    self.md.append(s)
                    continue
                # the annex table: the first line that lies inside a ruled grid opens it («Хавсралт 1»)
                if scope == "appendix" and pending_annex_table and table_open is None and self._in_grid(pdf_page, s):
                    pending_annex_table = False
                    expecting_app_title = 0
                    title = self.appendices[-1]["title"] or f"Хавсралт {cur_app}"
                    table_open = {"table_id": f"Хавсралт {cur_app}", "caption_raw": title, "pdf_page": pdf_page, "end_pdf_page": pdf_page,
                                  "lines": [s], "notes": [], "line_no": None, "clause": None, "title_hint": [],
                                  "title_explicit": title, "title_source": "appendix_title", "appendix": cur_app}
                    continue

                # appendix header — numbered («1-р хавсралт»), lettered («Б хавсралт (заавал мөрдөх)»)
                # or word-first CAPITALS («ХАВСРАЛТ А»)
                m = RE_APPENDIX.match(s) or RE_APPENDIX_LETTER.match(s) or RE_APPENDIX_WORD_FIRST.match(s)
                if m and not RE_CLAUSE.match(s):
                    flush_clause(pdf_page)
                    flush_table()
                    flush_intro()
                    scope = "appendix"
                    cur_app = _LATIN_TO_CYR_LOOKALIKE.get(m.group(1), m.group(1))
                    cur_section = cur_app
                    cur_app_kind = None
                    cur_app_role = "definitions" if cur_app == "1" else "references" if cur_app == "2" else None
                    tail = m.group(2).strip(" .:")
                    km = RE_APPENDIX_KIND.match(tail) if tail else None
                    rec = {"appendix_id": cur_app, "document_code": self.code, "kind": (km.group(1) if km else None),
                           "title": None, "source_page": self.printed(pdf_page), "source_pdf_page": pdf_page,
                           "source_url": self.source_url, "verification_status": AUTO_STATUS}
                    if tail and not km and len(tail) > 3:
                        # «(мэдээллийн) Иш татсан баримт бичгүүд» — kind and title on one line
                        km2 = re.match(r"^\(\s*([^)]{3,30})\s*\)\s*(.*)$", tail)
                        if km2 and RE_APPENDIX_KIND.match(km2.group(1)):
                            rec["kind"] = RE_APPENDIX_KIND.match(km2.group(1)).group(1)
                            if len(km2.group(2).strip()) > 3:
                                rec["title"] = km2.group(2).strip()
                        else:
                            rec["title"] = tail
                    self.appendices.append(rec)
                    if rec["title"] and cur_app_role is None:
                        cur_app_role = self._appendix_role(rec["title"])
                    if cur_app_role == "references":
                        ref_app_id = cur_app
                    if cur_app_role == "definitions":
                        def_app_id = cur_app
                    expecting_app_title = 3
                    self.md.append(f"\n## Хавсралт {cur_app}\n")
                    continue
                if scope == "appendix" and expecting_app_title > 0:
                    km = RE_APPENDIX_KIND.match(s)
                    if km:
                        self.appendices[-1]["kind"] = km.group(1)
                        expecting_app_title -= 1
                        continue
                    if self.appendices[-1]["title"] is None and not RE_CLAUSE.match(s) and not RE_CLAUSE_LETTER.match(s) and not RE_TABLE_CAPTION.search(s):
                        self.appendices[-1]["title"] = s
                        self.md.append(f"### {s}\n")
                        if cur_app_role is None:
                            cur_app_role = self._appendix_role(s)
                            if cur_app_role == "references":
                                ref_app_id = cur_app
                            if cur_app_role == "definitions":
                                def_app_id = cur_app
                        expecting_app_title = 1
                        continue
                    # a CAPITALS title wrapped over two lines («АГААРЫН ХӨДӨЛГӨӨНИЙ … ХУРДААС УРСАЖ БУЙ» ⏎
                    # «АГААРЫН ХАМГИЙН ИХ ХУРДАД …», 41-01-11) — the second line joins the title
                    if (self.appendices[-1]["title"] is not None and is_mostly_upper(self.appendices[-1]["title"]) and is_mostly_upper(s)
                            and not RE_CLAUSE.match(s) and not RE_CLAUSE_LETTER.match(s) and not RE_TABLE_CAPTION.search(s)):
                        self.appendices[-1]["title"] = (self.appendices[-1]["title"] + " " + s).strip()
                        expecting_app_title = 1
                        continue
                    expecting_app_title = 0

                # body section heading — CAPITALS (31-17-10) at any forward number, or Title case
                # (20-04-17) only as the NEXT sequential number (numbered notes «1. Шаардлагатай…»
                # inside a section are not headings).  The Title-case rule is off once the document
                # has shown a CAPITALS heading (41-01-11: numbered reference list inside §2).
                m = RE_SECTION.match(s) or RE_SECTION_NOSPACE.match(s)
                if m and scope == "body" and (is_mostly_upper(m.group(2)) or (heading_style != "upper" and self._title_case_heading(m.group(1), m.group(2), cur_section))):
                    num = m.group(1)
                    if cur_section is None or int(num) == int(cur_section) + 1 or int(num) > int(cur_section):
                        flush_clause(pdf_page)
                        flush_table()
                        cur_section = num
                        cur_section_title = m.group(2).strip(" ,")
                        flush_intro()
                        self.sections.append({"section": num, "title": cur_section_title, "source_page": self.printed(pdf_page), "source_pdf_page": pdf_page})
                        self.md.append(f"\n## {num}. {cur_section_title}\n")
                        heading_open = not is_mostly_upper(m.group(2))
                        if is_mostly_upper(m.group(2)):
                            heading_style = "upper"
                            upper_open = True
                        elif heading_style is None:
                            heading_style = "title"
                        if RE_APPENDIX_ROLE_REFERENCES.search(cur_section_title):
                            ref_section_id = num
                        continue
                # uppercase continuation of a section title — only on the line(s) directly after
                # the heading (41-01-11 §2: a reference-list line «/ГОСТ12.1.005-88 ССБТ/» is
                # upper case too but sits several lines below the heading)
                if (scope == "body" and self.sections and is_mostly_upper(s) and cur_clause is None and len(s) > 6 and not RE_CLAUSE.match(s)
                        and (upper_open_prev or heading_style != "upper")):
                    self.sections[-1]["title"] = (self.sections[-1]["title"] + " " + s).strip()
                    upper_open = True
                    continue
                # wrapped Title-case heading: the continuation line starts in lower case and is
                # not a sentence («…эдлэхүүн болон» ⏎ «тээврийн хэрэгслээс үүсэх ачаалал»)
                if (was_open and scope == "body" and self.sections and cur_clause is None
                        and s[0].islower() and len(s) < 90 and not s.endswith((".", ";", ":")) and not RE_CLAUSE.match(s)
                        and not RE_LIST_ITEM.match(s)):
                    self.sections[-1]["title"] = (self.sections[-1]["title"] + " " + s).strip()
                    continue

                # definitions appendix / references appendix are special (by number in the
                # numbered layout, by title in the lettered one)
                if scope == "appendix" and cur_app_role == "definitions":
                    app1_paras.append(([s], pdf_page))
                    continue
                if scope == "appendix" and cur_app_role == "references":
                    app2_lines.append((s, pdf_page))
                    continue

                # table caption — standalone «2 дугаар хүснэгт» / «Хүснэгт. 8 [title]» (22-01-21): the title is on the
                # line(s) above (or after the number on the «Хүснэгт.» line)
                sm = RE_TABLE_CAPTION_ORD.match(s) or RE_TABLE_CAPTION_DOT.match(s) or RE_TABLE_CAPTION_WORD_ALONE.match(s)
                if sm:
                    tid = sm.group(1)
                    tail = sm.group(2).strip() if sm.re is RE_TABLE_CAPTION_DOT and sm.lastindex and sm.lastindex >= 2 else ""
                    if len(re.findall(r"[А-Яа-яӨөҮүЁё]", tail)) >= 6:
                        title_explicit, title_src = tail.rstrip(" ."), "caption"
                    elif table_open is not None:
                        # a table right after another one: the title lines sit at the end of the previous table's text
                        title_explicit, title_src = pop_title_lines(table_open["lines"]), "preceding_title_line"
                    else:
                        title_explicit, title_src = pop_title_lines(buf) if cur_clause is not None else None, "preceding_title_line"
                    flush_table()
                    line_no = sum(1 for ln in lines[: li + 1] if ln.strip())
                    table_open = {"table_id": tid, "caption_raw": s, "pdf_page": pdf_page, "end_pdf_page": pdf_page, "lines": [], "notes": [], "line_no": line_no,
                                  "clause": cur_clause.clause if cur_clause else None, "title_hint": buf[-2:] if buf else [],
                                  "title_explicit": title_explicit, "title_source": title_src}
                    continue
                tm = RE_TABLE_CAPTION.search(s)
                if tm and not (tm.start() == 0 or len(s) <= 45):
                    tm = None
                if tm:
                    flush_table()
                    tid = norm_table_id(tm.group(1) or tm.group(2))  # «Г. 10» → «Г.10», «Д,1» → «Д.1», «p.1» → «Р.1»
                    line_no = sum(1 for ln in lines[: li + 1] if ln.strip())  # caption position (non-empty lines incl. itself)
                    table_open = {"table_id": tid, "caption_raw": s, "pdf_page": pdf_page, "end_pdf_page": pdf_page, "lines": [], "notes": [], "line_no": line_no,
                                  "clause": cur_clause.clause if cur_clause else None, "title_hint": buf[-2:] if buf else []}
                    continue

                # formula label at end of line — «(5.1.1)», or «(1)» / «(Л.1)» when the same
                # line holds an equation (an «=» before the label)
                fm = RE_FORMULA_LABEL.search(s)
                if fm is None:
                    fs = RE_FORMULA_LABEL_SIMPLE.search(s)
                    if fs and "=" in s[: fs.start()]:
                        fm = fs
                if fm is None and cur_clause is not None:
                    # «(1)» alone on its line (22-01-21): the equation is the preceding lines back to the last
                    # sentence end — accepted only when they hold an «=» (a bare «(2)» in prose is a list mark)
                    fb = RE_FORMULA_LABEL_BARE.match(s)
                    if fb:
                        eq: list[str] = []
                        for ln in reversed(buf[-10:]):
                            if ln.strip().endswith((".", ":", ";")) and eq:
                                break
                            eq.insert(0, ln)
                        if any("=" in ln for ln in eq):
                            label = fb.group(1)
                            self._add_formula(label, squash(eq), cur_clause.clause, pdf_page, stacked=True)
                            buf.append(s)
                            continue
                if fm:
                    label = re.sub(r"\s+", "", fm.group(1))
                    expr = s[: fm.start()].strip(" ,.;")
                    if not expr:
                        # expression on preceding buffered lines (Word equation objects come out garbled)
                        tail = buf[-3:] if buf else []
                        expr = squash(tail)
                    self._add_formula(label, expr, cur_clause.clause if cur_clause else None, pdf_page)
                    if cur_clause is not None:
                        buf.append(s)
                    continue

                # ⚠️ A CAPTIONED TABLE'S ROWS ARE NOT A NEW CLAUSE (2026-09-23, 20-04-17 table 7.1): once a caption
                # has opened `table_open`, the table's rows follow in the text layer.  A row that happens to start
                # with the next clause number («7.3 зүйлд зааснаас бусад метал бүтээцэд;») used to OPEN clause 7.3
                # and pour the whole table («… 1,05 1,1 1,2 …») into it, while the real 7.3 was glued on at the end.
                # While a table is open, a line that lies inside a ruled grid cell on this page stays in the table.
                # (Scoped to an open table on purpose: a blanket «grid text is never clause text» rule deleted 15
                # real 41-01-11 clauses, measured.)
                # A numbered line whose text opens like a sentence (capital letter) still starts a clause — 41-01-11
                # prints real clauses (7.11.8, 9.10) inside ruled boxes right after a table (measured).
                cm_probe = RE_CLAUSE.match(s)
                real_start = bool(cm_probe and cm_probe.group(2)[:1].isupper())
                if table_open is not None and not real_start and self._in_grid(pdf_page, s):
                    table_open["lines"].append(s)
                    table_open["end_pdf_page"] = pdf_page
                    continue

                # clause start (numeric, or «Б.1.1» inside a lettered appendix)
                cm = RE_CLAUSE.match(s) or RE_CLAUSE_BARE.match(s)
                if cm is None and scope == "appendix" and cur_app is not None and not cur_app[0].isdigit():
                    cm = RE_CLAUSE_LETTER.match(s)
                if cm and self._is_clause_of(cm.group(1), cur_section, scope, cur_app):
                    cid = cm.group(1)
                    rest = cm.group(2) if cm.lastindex and cm.lastindex >= 2 else ""
                    if not self._accept_clause(cid, rest, cur_clause, scope, cur_app):
                        cm = None
                if cm and self._is_clause_of(cm.group(1), cur_section, scope, cur_app):
                    flush_clause(pdf_page)
                    flush_table()
                    flush_intro()
                    cid = cm.group(1)
                    rest = cm.group(2) if cm.lastindex and cm.lastindex >= 2 else ""
                    cur_clause = Clause(
                        clause_id=(f"{self.code}#A{cur_app}:{cid}" if scope == "appendix" else f"{self.code}#{cid}"), document_code=self.code, section=cur_section or "",
                        clause=cid, heading=None, text="", source_page=self.printed(pdf_page), source_pdf_page=pdf_page,
                        end_page=None, scope=scope, appendix=cur_app if scope == "appendix" else None,
                        source_url=self.source_url, status=self.status,
                    )
                    buf = [rest] if rest else []
                    continue

                # note lines
                if RE_NOTE.match(s):
                    if table_open is not None and not table_open["lines"]:
                        table_open["notes"].append(s)
                        continue
                    if cur_clause is not None:
                        cur_clause.notes.append(s)

                if table_open is not None:
                    # table body flows until next clause/caption; keep raw lines for caption-only fallback
                    table_open["lines"].append(s)
                    table_open["end_pdf_page"] = pdf_page
                    continue

                if cur_clause is not None:
                    buf.append(s)
                else:
                    # prose before the first clause of a section (intro sentences) → md + the
                    # section's `intro` (searchable through the section chunk); appendix prose → md
                    self.md.append(s)
                    if scope == "body" and ref_section_id == cur_section and (re.match(r"^\d{1,2}\.\s+\S", s) or sec_ref_lines):
                        # numbered reference list inside the section («1. Дуу шуугиан … /ГОСТ12.1.003-83/»)
                        sec_ref_lines.append((s, pdf_page))
                        continue
                    if scope == "body" and ref_section_id == cur_section and (RE_REF_BULLET.match(s) or sec_ref_bullet_lines):
                        sec_ref_bullet_lines.append((s, pdf_page))
                    if scope == "body" and self.sections and not any(c.scope == "body" and c.section == cur_section for c in self.clauses):
                        section_intro.append(s)
            # page end: nothing special — clauses continue across pages
        flush_clause(len(self.pages))
        flush_table()
        flush_intro()
        self._leftover_grids()
        self._parse_definitions(app1_paras, def_app_id or "1")
        self._parse_definitions_from_clauses()
        self._parse_definitions_from_colon_clauses()
        self._appendix_contents_from_toc(toc_lines)
        self._parse_reference_list(app2_lines, ref_app_id or "2")
        if sec_ref_lines and ref_section_id:
            self._parse_reference_list(sec_ref_lines, ref_section_id, in_section=True)
        elif sec_ref_bullet_lines and ref_section_id:
            self._parse_reference_list(sec_ref_bullet_lines, ref_section_id, in_section=True, bullets=True)
        self._extract_refs_from_clauses()
        self._extract_numeric()
        self._inline_label_formulas()
        self._apply_formula_review()

    def _inline_label_formulas(self) -> None:
        """A numbered equation whose glyphs came out as stacked tokens sits INSIDE the clause text with its label mid-line
        («… тодорхойлно. j j ip j p n … 1 ) (  (5) Үүнд: …», 22-01-21 5.7–5.11; «𝜔𝜔𝑞𝑞≥3𝜔𝜔1 (27) 𝜔𝜔𝑞𝑞≥2𝜔𝜔𝑐𝑐 (28) Үүнд:»,
        8.4.20).  Such a label is recorded as a formula that EXISTS but cannot be read — expression kept verbatim,
        quality garbled, review required — so «(5) томьёо» resolves to a record instead of vanishing.  A label that
        is a REFERENCE («(8) томьёогоор») is not a formula line; labels the line loop already found are skipped."""
        have = {f.label for f in self.formulas}
        rx = re.compile(r"\(\s*(\d{1,2})\s*\)(?!\s*(?:[-–]?\s*(?:р|ын|ийн|д|т|аар|ээр|оор|өөр|томь?ёо|дугаар|дүгээр)))")
        for c in self.clauses:
            last = 0
            for m in rx.finditer(c.text):
                label = m.group(1)
                span_start = max(c.text.rfind(". ", last, m.start()), c.text.rfind(": ", last, m.start()))
                expr = c.text[(span_start + 2) if span_start >= 0 else last:m.start()].strip()
                last = m.end()
                if label in have:
                    continue
                math = bool(re.search(r"[=≤≥<>∑√]|[\U0001D400-\U0001D7FF]", expr)) or len(re.findall(r"(?:^|\s)[A-Za-z]{1,2}(?=\s)", expr)) >= 6
                follows = c.text[m.end():m.end() + 12]
                if not math or not (re.match(r"\s*Үүнд\s*:", follows) or re.match(r"\s*\S*[=≥≤]", follows) or re.search(r"[\U0001D400-\U0001D7FF]", expr)):
                    continue
                self._add_formula(label, expr, c.clause, c.source_pdf_page, stacked=True)
                f = self.formulas[-1]
                f.expression_quality = "text_layer_garbled"
                f.extraction = "inline_label_in_clause_text"
                f.review = {"status": "FORMULA_IMAGE_REVIEW_REQUIRED", "reason": "equation glyphs are stacked/duplicated in the text layer; the label was found inside the clause text"}
                have.add(label)

    def _apply_formula_review(self) -> None:
        """metadata.formula_review — formulas checked against the PAGE IMAGE and found wrong in the text layer (not a
        verification: the flag only ever LOWERS trust).  22-01-21: formula (3) spans three lines and the text layer
        gives its third line («βi=2.5 (0.4/ Ti)^0.5») to (4)."""
        for rv in self.meta.get("formula_review", []) or []:
            for f in self.formulas:
                if f.label == str(rv["label"]):
                    f.expression_quality = "text_layer_garbled"
                    f.review = {"status": rv.get("status", "FORMULA_IMAGE_REVIEW_REQUIRED"), "reason": rv["reason"],
                                "checked_against": rv.get("checked_against"), "checked_at": rv.get("checked_at")}

    def _in_grid(self, pdf_page: int, s: str) -> bool:
        """True when the text line is (part of) a cell of a ruled grid detected on this page."""
        t = re.sub(r"\s+", " ", s).strip()
        if len(t) < 3:
            return False
        for g in self.page_tables.get(pdf_page, []):
            for row in g["cells"]:
                for c in row:
                    if c and t in re.sub(r"\s+", " ", c):
                        return True
        return False

    def _is_clause_of(self, cid: str, section: str | None, scope: str, app: str | None) -> bool:
        if section is None:
            return False
        parts = cid.split(".")
        if scope == "appendix" and app is not None:
            ap = app.split(".")
            return parts[: len(ap)] == ap and len(parts) > len(ap)
        return parts[0] == str(int(section))

    @staticmethod
    def _is_next_clause(cid: str, prev: Clause) -> bool:
        """True when `cid` is exactly the clause after `prev` at the same depth (5.8 → 5.9) or
        the first child of it (5.8 → 5.8.1) — used to split a clause that starts mid-line."""
        parts, pp = clause_parts(cid), clause_parts(prev.clause)
        if len(parts) == len(pp) and parts[:-1] == pp[:-1] and parts[-1] == pp[-1] + 1:
            return True
        return parts[:-1] == pp and parts[-1] == 1

    @staticmethod
    def _title_case_heading(num: str, title: str, cur_section: str | None) -> bool:
        """«8. Тоног төхөөрөмж, хүн, …» — a heading only when it is the next section number,
        starts with a capital and does not read like a sentence."""
        t = title.strip()
        if not t or not t[0].isupper() or len(t) > 110 or t.endswith((".", ";", ":")):
            return False
        expected = 1 if cur_section is None else int(cur_section) + 1
        return int(num) == expected

    @staticmethod
    def _appendix_role(title: str) -> str | None:
        if RE_APPENDIX_ROLE_REFERENCES.search(title):
            return "references"
        if RE_APPENDIX_ROLE_DEFINITIONS.search(title):
            return "definitions"
        return None

    def _accept_clause(self, cid: str, rest: str, prev: Clause | None, scope: str, app: str | None) -> bool:
        """Sequential numbering OR an unused number whose text starts like a sentence.

        ⚠️ Table cells («8.8 9.6 10.4 …»), in-text references («14.14 заалтын…», «9.33 дугаар
           зүйлд…») and equation fragments («5.0 (500)») all look like clause starts to a
           regex.  A real clause is either the next number in sequence or starts with a
           capital letter; anything else is continuation text.
        """
        used = {(c.scope, c.appendix, c.clause) for c in self.clauses}
        if prev is not None:
            used.add((prev.scope, prev.appendix, prev.clause))
        if (scope, app if scope == "appendix" else None, cid) in used:
            return False
        parts = clause_parts(cid)
        if prev is not None and prev.scope == scope and (scope != "appendix" or prev.appendix == app):
            pp = clause_parts(prev.clause)
            # same depth, +1..+3
            if len(pp) == len(parts) and pp[:-1] == parts[:-1] and 1 <= parts[-1] - pp[-1] <= 3:
                if parts[-1] - pp[-1] > 1:
                    self.report["anomalies"].append(f"clause numbering gap {prev.clause} → {cid} ({scope}{'/' + app if app else ''})")
                return True
            # deeper level start
            if parts[:-1] == pp and parts[-1] == 1:
                return True
            # pop one/two levels and +1
            for k in (1, 2):
                if len(pp) - k >= 1 and len(parts) == len(pp) - k and parts[:-1] == pp[: len(pp) - k - 1] and parts[-1] == pp[len(pp) - k - 1] + 1:
                    return True
        else:
            # first clause of a section / appendix
            if parts[-1] == 1:
                return True
        # out-of-order but unused: accept only when it reads like a sentence start
        if rest and (rest[0].isupper() or (rest[0] in "«“\"(" and len(rest) > 1 and rest[1].isupper())):
            self.report["anomalies"].append(f"out-of-order clause {cid} accepted (sentence start) ({scope}{'/' + app if app else ''})")
            return True
        return False

    def _add_formula(self, label: str, expr: str, clause: str | None, pdf_page: int, stacked: bool = False) -> None:
        garbled = bool(re.search(r"[∑∫]|\n", expr)) or len(expr) < 4 or not re.search(r"[=<>≤≥]", expr)
        # an equation whose sub/superscripts came out as separate short tokens («j ik S = K0 K1 j ik S0») or in
        # Cambria-Math duplicated glyphs («𝜇𝜇𝑖𝑖») cannot be trusted as text — flagged for review, never rebuilt
        if stacked and (re.search(r"(?:^|\s)[a-zα-ω]{1,3}\s+[a-zα-ω]{1,3}\s", expr) or re.search(r"[\U0001D400-\U0001D7FF]", expr)):
            garbled = True
        # a superscript flattened onto the line after a ratio («βi=2.5 (0.4/ Ti) 0.5» = 2.5·(0.4/Ti)^0.5, 22-01-21 5.6) reads
        # as a PRODUCT — a wrong formula, not a garbled one — so it is flagged for review against the page image
        if re.search(r"\([^()]*/[^()]*\)\s+\d+(?:[.,]\d+)?(?=\s|$|[;,])", expr):
            garbled = True
        quality = "text_layer_garbled" if garbled else "text_layer_clean"
        # variables: tokens like Wp, wm, k(ze), γf …
        vars_ = sorted(set(re.findall(r"\b[A-Za-zγζξν][A-Za-z0-9,_]*(?:\([a-z]+\))?", expr)))
        fid = f"{self.code}#F{label}"
        if any(f.formula_id == fid for f in self.formulas):
            fid = f"{fid}@p{pdf_page}"
        self.formulas.append(Formula(
            formula_id=fid, document_code=self.code, clause=clause, label=label, expression=expr,
            expression_quality=quality, variables=[{"symbol": v} for v in vars_][:12], units=[], conditions=[],
            source_page=self.printed(pdf_page), source_pdf_page=pdf_page, source_url=self.source_url,
        ))

    def _finish_table(self, t: dict) -> None:
        pdf_page = t["pdf_page"]
        grids: list[dict] = []
        # the caption's page (or the next one) holds the grid; a table flowing over several
        # pages has one grid per page — absorb them while the table was still open.
        last = max(t.get("end_pdf_page", pdf_page), pdf_page)
        for pg in range(pdf_page, last + 2):
            cands = self.page_tables.get(pg, [])
            if pg > last and pdf_page in self.frame_pages:
                # on a frame page the table either was re-detected inside the border or is not a
                # ruled grid at all — never borrow the next page's grid (it belongs to a later caption)
                break
            if cands and (pg <= last or not grids):
                pick = 0
                if pg == pdf_page and t.get("line_no") is not None and any(c.get("inner") for c in cands):
                    # frame-page grids carry their position: take the first grid BELOW the caption
                    # line; a grid above it belongs to an earlier table (41-01-11 p.79: Ж.1 / И.1)
                    below = [k for k, c in enumerate(cands) if c.get("lines_above", 0) >= t["line_no"]]
                    if not below:
                        continue
                    pick = below[0]
                grids.append(cands.pop(pick))
                if pg > last:
                    break
        cap_text = re.sub(r"^\s*(?:Хүснэгт\s+(?:[А-ЯӨҮЁA-Za-z][.,]?\s?)?[\d.]+|[\d.]+\s*[-–]\s*р\s+хүснэгт)\s*[.:\-–]?\s*", "", t["caption_raw"], flags=re.I).strip()
        if t.get("title_explicit"):
            # 22-01-21: the title printed above a standalone «N дугаар хүснэгт» / an annex's own title
            title, title_source = t["title_explicit"], t.get("title_source", "preceding_title_line")
        elif len(re.findall(r"[А-Яа-яӨөҮүЁё]", cap_text)) >= 6:
            title, title_source = cap_text, "caption"
        else:
            title, title_source = (squash(t["title_hint"]) if t["title_hint"] else None), "preceding_text_hint"
        if grids and grids[0]["cells"]:
            cells = grids[0]["cells"]
            columns = [c or "" for c in cells[0]]
            rows = [[c or "" for c in r] for r in cells[1:]]
            for g in grids[1:]:
                rows.extend([[c or "" for c in r] for r in g["cells"]])
            extraction = "ruled_grid" if len(grids) == 1 else f"ruled_grid_{len(grids)}_pages"
        else:
            columns = []
            rows = [[squash([ln])] for ln in t["lines"][:80]]
            extraction = "caption_only"
        notes = [ln for ln in t["lines"] if RE_NOTE.match(ln)] + t["notes"]
        tid = f"{self.code}#T{t['table_id']}"
        if any(x.table_id == tid for x in self.tables):
            tid = f"{tid}@p{pdf_page}"
            self.report["anomalies"].append(f"duplicate table number {t['table_id']} (pdf page {pdf_page}); suffixed")
        self.tables.append(Table(
            table_id=tid, document_code=self.code, title=title, caption_raw=t["caption_raw"], columns=columns,
            rows=rows, notes=notes, source_page=self.printed(pdf_page), source_pdf_page=pdf_page,
            clause_context=t["clause"], extraction=extraction, source_url=self.source_url, title_source=title_source,
        ))

    def _leftover_grids(self) -> None:
        """Ruled grids that no caption claimed — kept so no table data is silently lost."""
        for pg, cands in sorted(self.page_tables.items()):
            if pg < self.body_first_pdf_page:
                continue  # cover / approval pages (22-01-21 PDF p.2: the cover's layout grid) are not norm tables
            k = 0
            for g in cands:
                if not g["cells"] or len(g["cells"]) < 2:
                    continue
                k += 1
                base = f"{self.code}#Tp{self.printed(pg) if self.printed(pg) is not None else 'pdf' + str(pg)}"
                # several uncaptioned grids on one page (figure legends) → «…-2», «…-3»
                tid = base if k == 1 else f"{base}-{k}"
                self.tables.append(Table(
                    table_id=tid, document_code=self.code, title=None,
                    caption_raw="", columns=[c or "" for c in g["cells"][0]], rows=[[c or "" for c in r] for r in g["cells"][1:]],
                    notes=[], source_page=self.printed(pg), source_pdf_page=pg, clause_context=None,
                    extraction="ruled_grid_uncaptioned", source_url=self.source_url,
                ))
                self.report["anomalies"].append(f"uncaptioned ruled grid on printed page {self.printed(pg)} (pdf {pg})")

    def _parse_definitions(self, paras: list[tuple[list[str], int]], app_id: str = "1") -> None:
        # Appendix 1 lines: a definition starts with «Term- …» / «Term: …»; continuation lines follow.
        cur: dict | None = None
        for (lines, pdf_page) in paras:
            s = lines[0]
            m = re.match(r"^([А-ЯӨҮЁ][^:\-–]{2,90}?)\s*[-–:]\s*(.*)$", s)
            if m and (cur is None or len(cur["definition"]) > 20):
                if cur:
                    self.definitions.append(cur)
                cur = {"term": m.group(1).strip(), "definition": m.group(2).strip(), "document_code": self.code,
                       "appendix": app_id, "source_page": self.printed(pdf_page), "source_pdf_page": pdf_page,
                       "source_url": self.source_url, "verification_status": AUTO_STATUS}
            elif cur is not None:
                cur["definition"] = squash([cur["definition"], s])
        if cur:
            self.definitions.append(cur)
        for d in self.definitions:
            d["definition_id"] = f"{self.code}#DEF:{re.sub(r'\\s+', '_', d['term'].lower())[:60]}"

    def _parse_definitions_from_clauses(self) -> None:
        """«3.1.1. “Ачаалал” гэж барилгын объектод … хэлнэ;» — term definitions written as
        clauses (20-04-17 section 3).  The clause itself stays a clause; the definition is
        an ADDITIONAL record pointing at the same page so «X гэж юу вэ?» finds it."""
        for c in self.clauses:
            if c.scope != "body":
                continue
            m = RE_CLAUSE_DEFINITION.match(c.text)
            if not m:
                continue
            term = m.group(1).strip()
            definition = m.group(2).strip().rstrip(";").strip()
            if len(definition) < 10:
                continue
            self.definitions.append({
                "term": term, "definition": definition, "document_code": self.code,
                "appendix": None, "clause": c.clause, "source_page": c.source_page, "source_pdf_page": c.source_pdf_page,
                "source_url": self.source_url, "verification_status": AUTO_STATUS,
                "definition_id": f"{self.code}#DEF:{re.sub(r'\\s+', '_', term.lower())[:60]}",
            })

    def _parse_definitions_from_colon_clauses(self) -> None:
        """«3.15. Газар хөдлөлтийн шинжээр нь ангилсан хөрсний зэрэг (I, II ба III): Буурь хөрсөөр …» — a
        definitions SECTION (title «Нэр томьёо ба тодорхойлолт», 22-01-21 §3) whose clauses read «Term: definition».
        Only in a section so titled; a quoted/«гэж» clause is left to `_parse_definitions_from_clauses`."""
        def_sections = {s["section"] for s in self.sections if RE_APPENDIX_ROLE_DEFINITIONS.search(s.get("title") or "")}
        if not def_sections:
            return
        have = {d.get("clause") for d in self.definitions if d.get("clause")}
        for c in self.clauses:
            if c.scope != "body" or c.section not in def_sections or c.clause in have:
                continue
            m = re.match(r"^([^:;.“”«»\"]{2,160}?)\s*:\s*(\S.+)$", c.text)
            if not m or " гэж " in m.group(1):
                continue
            term = m.group(1).strip()
            definition = m.group(2).strip().rstrip(";").strip()
            if len(definition) < 10 or not term[:1].isupper():
                continue
            self.definitions.append({
                "term": term, "definition": definition, "document_code": self.code,
                "appendix": None, "clause": c.clause, "source_page": c.source_page, "source_pdf_page": c.source_pdf_page,
                "source_url": self.source_url, "verification_status": AUTO_STATUS,
                "definition_id": f"{self.code}#DEF:{re.sub(r'\\s+', '_', term.lower())[:60]}",
            })

    def _appendix_contents_from_toc(self, toc_lines: list[str]) -> None:
        """«11. 2 ДУГААР ХАВСРАЛТ. МОНГОЛ ОРНЫ …» + «11.1 МОНГОЛ ОРНЫ … ЗУРАГ» … — the printed table of contents
        is the only TEXT that names an annex made of images (22-01-21 annex 2: 30 map pages).  The entries are
        attached to the appendix as `contents_from_toc` — titles only; nothing is read from the images."""
        if not toc_lines or not self.appendices:
            return
        head = re.compile(r"^\s*(\d{1,2})\.\s*(\d{1,2})\s+(?:ДҮГЭЭР|ДУГААР|ДАХЬ)\s+ХАВСРАЛТ\.?\s*(.*)$", re.I)
        entry = re.compile(r"^\s*(\d{1,2})\.(\d{1,2})\s+(\S.*)$")
        by_sec: dict[str, str] = {}
        cur_app: str | None = None
        cur_sec: str | None = None
        items: dict[str, list[dict]] = {}
        last: dict | None = None
        in_head = False  # the annex heading itself wraps («… МОНГОЛ ОРНЫ ГАЗАР ХӨДЛӨЛИЙН ЕРӨНХИЙ» ⏎ «МУЖЛАЛ (500 …)»)
        for s in toc_lines:
            h = head.match(s)
            if h:
                cur_sec, cur_app = h.group(1), h.group(2)
                by_sec[cur_sec] = cur_app
                items.setdefault(cur_app, [])
                last = None
                in_head = True
                continue
            if cur_app is None:
                continue
            e = entry.match(s)
            if in_head and not e and is_mostly_upper(s):
                continue  # continuation of the annex heading, not an entry of its contents
            in_head = False
            if e and e.group(1) == cur_sec:
                last = {"no": f"{e.group(1)}.{e.group(2)}", "title": e.group(3).strip()}
                items[cur_app].append(last)
                continue
            if e and e.group(1) != cur_sec:
                cur_app = None
                continue
            # a wrapped entry continues with a SHORT line («ЗУРАГ», «НЭГ УДАА ТОХИОЛДОХ)»); a long CAPITALS line is a
            # group heading inside the list («МОНГОЛ ОРНЫ ГАЗАР ХӨДЛӨЛИЙН ЕРӨНХИЙ МУЖЛАЛ (2500 ЖИЛД …»)
            if is_mostly_upper(s) and last is not None and not last["title"].endswith((")", ".")) and len(s.split()) <= 3:
                last["title"] = (last["title"] + " " + s.strip()).strip()
            elif is_mostly_upper(s):
                last = {"no": None, "title": s.strip(), "group_heading": True}
                items[cur_app].append(last)
        for rec in self.appendices:
            got = items.get(rec["appendix_id"])
            if got:
                rec["contents_from_toc"] = got
                rec["contents_source"] = "printed table of contents («АГУУЛГА»); titles only — the entries are not matched to pages"

    def _parse_reference_list(self, lines: list[tuple[str, int]], app_id: str = "2", in_section: bool = False, bullets: bool = False) -> None:
        """Numbered list «N. …» of referenced documents — in an appendix (31-17-10 app. 2,
        20-04-17 app. А) or in the body of a section (41-01-11 §2, `in_section`).  `bullets`: the dash form
        «- БНбД … Title» (22-01-21 §2) — a wrapped title continues on a LOWER-case line; the first capitalised
        non-bullet line is the prose after the list («Энэхүү норм ба дүрмийг … мөрдөнө») and ends it."""
        items: list[tuple[str, int]] = []
        for s, pg in lines:
            if bullets:
                m = RE_REF_BULLET.match(s)
                if m:
                    items.append((m.group(1), pg))
                elif items and s.strip()[:1].islower():
                    items[-1] = (items[-1][0] + " " + s, items[-1][1])
                elif items and s.strip():
                    break
                continue
            m = re.match(r"^(\d{1,2})\.\s+(.*)$", s)
            if m:
                items.append((m.group(2), pg))
            elif items:
                items[-1] = (items[-1][0] + " " + s, items[-1][1])
        for n, (txt, pg) in enumerate(items, start=1):
            txt = squash([txt])
            codes = self._codes_in(txt)
            self.references.append({
                "reference_id": f"{self.code}#REF:{'sec' if in_section else 'app'}{app_id}:{n}",
                "from": self.code, "from_clause": None, "from_locator": f"{app_id}-р {'бүлэг' if in_section else 'хавсралт'}, {n}",
                "to_document": codes[0] if codes else None, "to_documents": codes,
                "to_document_key": self.normalize_code(codes[0]) if codes else None,
                "relationship": "normative_reference_list", "context": txt,
                "source_page": self.printed(pg), "source_pdf_page": pg, "verification_status": AUTO_STATUS,
            })

    def _codes_in(self, text: str) -> list[str]:
        out = []
        for m in RE_REF_CODE.finditer(text):
            prefix = m.group(1).replace("СНИП", "СНиП")
            num = m.group(2).strip(" .,/")
            num = re.sub(r"\s+", "", num).replace("–", "-")
            if not re.search(r"\d", num):
                continue
            num = num.strip("-/–")
            m2 = re.match(r"^(.*?)/(\d{4})$", num)
            if m2:
                num = m2.group(1)
            if not re.search(r"\d", num):
                continue
            code = f"{prefix} {num}"
            if code not in out:
                out.append(code)
        return out

    @staticmethod
    def normalize_code(code: str) -> str:
        """«БНбД 2.01.07-90» → «БНбД 2-01-07-90», «БНбД 22.01.01*» → «БНбД 22-01-01*» — a
        registry key; the printed form is kept in `to_document`."""
        prefix, _, num = code.partition(" ")
        if re.match(r"^\d+\.\d+\.\d+", num):
            num = num.replace(".", "-")
        return f"{prefix} {num}"

    def _extract_refs_from_clauses(self) -> None:
        seen = set()
        for c in self.clauses:
            for code in self._codes_in(c.text):
                key = (c.clause, code)
                if key in seen:
                    continue
                seen.add(key)
                self.references.append({
                    "reference_id": f"{self.code}#REF:{c.clause}:{code}",
                    "from": self.code, "from_clause": c.clause, "from_locator": f"заалт {c.clause}",
                    "to_document": code, "to_documents": [code], "to_document_key": self.normalize_code(code),
                    "relationship": "normative_reference", "context": self._window(c.text, code),
                    "source_page": c.source_page, "source_pdf_page": c.source_pdf_page, "verification_status": AUTO_STATUS,
                })

    @staticmethod
    def _window(text: str, needle: str, span: int = 90) -> str:
        i = text.find(needle.split(" ")[-1])
        if i < 0:
            return text[:2 * span]
        return text[max(0, i - span): i + span].strip()

    def _extract_numeric(self) -> None:
        for c in self.clauses:
            for m in RE_NUM_UNIT.finditer(c.text):
                v1, v2, unit, word = m.group(1), m.group(2), m.group(3), m.group(4)
                word_l = word.lower()
                op = OP_MAP.get(word_l)
                if op is None:
                    continue
                try:
                    value: float | list[float] = norm_num(v1)
                except ValueError:
                    continue
                if v2:
                    try:
                        value = [norm_num(v1), norm_num(v2)]
                        op = "range"
                    except ValueError:
                        pass
                unit_out = unit
                if m.start() > 0 and c.text[m.start() - 1] == "/":
                    # «1/8-ээс хэтрэхгүй», «h/500» — a ratio, not the bare denominator
                    pre = re.search(r"([\w.]{1,6})/$", c.text[max(0, m.start() - 8): m.start()])
                    value = f"{pre.group(1) if pre else '?'}/{v1}"
                    unit_out = "ratio"
                start = max(0, m.start() - 80)
                subject = c.text[start: m.start()].strip()
                subject = re.sub(r"^\S*\s", "", subject) if len(subject) > 70 else subject
                rid = f"{self.code}#NR:{c.clause}:{len([n for n in self.numeric if n['clause'] == c.clause]) + 1}"
                self.numeric.append({
                    "requirement_id": rid, "document_code": self.code, "clause": c.clause, "appendix": c.appendix,
                    "subject": subject, "operator": op, "value": value,
                    "unit": (unit_out.replace("м2", "м²").replace("0С", "°С") if unit_out else None),
                    "quote": c.text[start: m.end() + 30].strip(), "conditions": [], "exceptions": [],
                    "source_page": c.source_page, "source_pdf_page": c.source_pdf_page, "source_url": self.source_url,
                    "extraction": "regex_v1", "verification_status": AUTO_STATUS,
                })

    # ── output ──
    def write(self) -> None:
        out = self.doc_dir / "parsed"
        out.mkdir(parents=True, exist_ok=True)

        def jsonl(name: str, rows) -> int:
            with (out / name).open("w", encoding="utf-8", newline="\n") as f:
                n = 0
                for r in rows:
                    d = asdict(r) if hasattr(r, "__dataclass_fields__") else r
                    if hasattr(r, "__dataclass_fields__"):
                        for k in OMIT_WHEN_NONE:
                            if k in d and d[k] is None:
                                del d[k]
                    f.write(json.dumps(d, ensure_ascii=False) + "\n")
                    n += 1
            return n

        counts = {
            "sections": jsonl("sections.jsonl", self.sections),
            "appendices": jsonl("appendices.jsonl", self.appendices),
            "clauses": jsonl("clauses.jsonl", self.clauses),
            "tables": jsonl("tables.jsonl", self.tables),
            "formulas": jsonl("formulas.jsonl", self.formulas),
            "references": jsonl("references.jsonl", self.references),
            "definitions": jsonl("definitions.jsonl", self.definitions),
            "numeric_requirements": jsonl("numeric_requirements.jsonl", self.numeric),
        }
        # document.md — hierarchical, printed page markers
        md = [f"# {self.code} — {self.meta.get('title_mn','')}\n", f"Эх сурвалж: {self.source_url}\n"]
        cur_sec = None
        for c in self.clauses:
            key = (c.scope, c.section)
            if key != cur_sec:
                cur_sec = key
                if c.scope == "body":
                    title = next((s["title"] for s in self.sections if s["section"] == c.section), "")
                    md.append(f"\n## {c.section}. {title}\n")
                else:
                    ap = next((a for a in self.appendices if a["appendix_id"] == c.appendix), None)
                    md.append(f"\n## Хавсралт {c.appendix} — {(ap or {}).get('title') or ''}\n")
            md.append(f"**{c.clause}** *(х. {c.source_page})* {c.text}\n")
            for n in c.notes:
                md.append(f"> {n}\n")
        for t in self.tables:
            md.append(f"\n### Хүснэгт {t.table_id.split('#T')[-1]} *(х. {t.source_page})* — {t.title or ''}\n")
            if t.columns:
                md.append("| " + " | ".join(t.columns) + " |")
                md.append("|" + "---|" * len(t.columns))
                for r in t.rows:
                    md.append("| " + " | ".join(r) + " |")
            else:
                for r in t.rows:
                    md.append(f"- {r[0]}")
        (out / "document.md").write_text("\n".join(md), encoding="utf-8", newline="\n")
        self.report["counts"] = counts
        self.report["counts"]["tables_ruled_grid"] = sum(1 for t in self.tables if t.extraction == "ruled_grid")
        self.report["counts"]["formulas_clean"] = sum(1 for f in self.formulas if f.expression_quality == "text_layer_clean")
        self.report["counts"]["definitions"] = len(self.definitions)
        (out / "parse_report.json").write_text(json.dumps(self.report, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")
        print(json.dumps(self.report["counts"], ensure_ascii=False))
        for w in self.report["warnings"]:
            print("  !", w)


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    p = NormPdfParser(Path(sys.argv[1]))
    p.load()
    p.parse()
    p.write()


if __name__ == "__main__":
    main()
