#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
MGL AI · norm-dataset · verify norm codes against the MCIS current-norm register.

    python ai/norm-dataset/tools/mcis_verify.py "31-17-10" "20-04-17" …
    python ai/norm-dataset/tools/mcis_verify.py --from-registry      # every code in registry/norms.jsonl

Writes/merges ai/norm-dataset/registry/mcis_verification.json:
  { "<query>": { "checked_at", "records": [ {act, title, status, decision, pdf, directurl, id, leaf} … ] } }

⚠️ EVIDENCE, NOT TRUTH.  A record with wfmstatusname «Хүчин төгөлдөр» is the register's
   claim on the day it was checked; the registry builder copies it into `status_evidence`
   and only then sets status=ACTIVE.  Codes the register does not know stay
   CANDIDATE_NEEDS_STATUS_CHECK.  Network: uses curl -4 (the dev PC's IPv6 is broken).
"""
from __future__ import annotations

import html
import json
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
REG = HERE.parent / "registry"
OUT = REG / "mcis_verification.json"
BASE = "https://mcis.gov.mn/mn/"
# top-level categories of the MCIS «Норм, норматив» page (ids measured 2026-09-16)
TOP = ["16170721506632", "16170721506842", "16170721507042", "16170721507242", "16170721507662", "16170721507872", "16170721508152", "16170721508392"]


def post(path: str, data: dict) -> object:
    args = ["curl", "-4", "-s", "--max-time", "60", "-X", "POST", BASE + path,
            "-H", "X-Requested-With: XMLHttpRequest", "-H", "Referer: https://mcis.gov.mn/mn/norm"]
    for k, v in data.items():
        args += ["--data-urlencode", f"{k}={v}"]
    out = subprocess.run(args, capture_output=True).stdout.decode("utf-8", "replace")
    try:
        return json.loads(out)
    except Exception:
        return None


def strip(s: str | None) -> str:
    return html.unescape(re.sub(r"<[^>]+>", " | ", s or "")).strip(" |")


def leaves() -> list[tuple[str, str]]:
    out = []
    for t in TOP:
        for it in post("getNormCatDetail", {"id": t}) or []:
            out.append((it["id"], it.get("name", "")))
    return out


def lookup(code_digits: str, leaf_ids: list[tuple[str, str]]) -> list[dict]:
    # the `register` filter is global — one leaf query is enough, but a leaf that
    # errors returns nothing, so try a few until a result set appears.
    for lid, lname in leaf_ids[:6]:
        r = post("getNormList", {"id": lid, "offset": 1, "register": code_digits})
        if r and isinstance(r, dict) and r.get("result") is not None:
            seen: set[str] = set()
            rows = []
            for it in r["result"]:
                if it["id"] in seen:
                    continue
                seen.add(it["id"])
                rows.append({
                    "id": it.get("id"),
                    "act": strip(it.get("actnumber")).split(" | ")[0],
                    "act_full": strip(it.get("actnumber")),
                    "title": strip(it.get("title")).split(" | ")[0],
                    "title_full": strip(it.get("title")),
                    "status": it.get("wfmstatusname"),
                    "decision": strip(it.get("decision")),
                    "pdf": ("https://mcis.gov.mn/" + it["physicalpath"]) if it.get("physicalpath") else None,
                    "directurl": it.get("directurl"),
                    "category": it.get("midtitle"),
                })
            return rows
    return []


def main() -> None:
    args = sys.argv[1:]
    codes: list[str] = []
    if "--from-registry" in args:
        for line in (REG / "norms.jsonl").read_text(encoding="utf-8").splitlines():
            if line.strip():
                codes.append(json.loads(line)["canonical_code"])
        args = [a for a in args if a != "--from-registry"]
    codes += args
    digits = []
    for c in codes:
        m = re.search(r"(\d[\d\-.*/]*\d)", c)
        if m:
            digits.append((c, m.group(1).replace(".", "-").rstrip("*")))
    existing = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    lv = leaves()
    sys.stderr.write(f"leaves: {len(lv)}\n")
    for code, d in digits:
        rows = lookup(d, lv)
        # keep only rows whose act contains the digits (the register filter is fuzzy)
        rows = [r for r in rows if d.split("-")[0] in r["act"] and d.split("-")[-1] in r["act"]] or rows
        existing[code] = {"checked_at": date.today().isoformat(), "query": d, "records": rows}
        sys.stderr.write(f"  {code}: {len(rows)} record(s)\n")
    OUT.write_text(json.dumps(existing, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n")
    print(str(OUT))


if __name__ == "__main__":
    main()
