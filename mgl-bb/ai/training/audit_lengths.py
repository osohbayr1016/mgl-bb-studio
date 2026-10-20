#!/usr/bin/env python3
"""
MGL AI · СУРГАЛТЫН БАГЦЫН УРТ/ТАЙРАГДЛЫН АУДИТ (§5, §13–14) — tokenizer-ийн түвшинд.

Мөр бүрийг serving-ийн ЯГ хэлбэрээр (chat template, enable_thinking=false) токенжуулж:
  · хэсэг бүрийн урт: system · түүх · сүүлийн user-ийн ХЭСГҮҮД (хэрэгслийн хайрцаг,
    нормын шийдвэр, нотолгоо, асуулт) · assistant зорилт
  · өгөгдсөн max_seq-д ЮУ тайрагдах вэ — `train_lora.py`-ийн render-тэй ИЖИЛ логикоор
    (prompt толгой + сүүл, зорилт бүтэн) — хэсэг бүрд хэдэн токен алдагдах, ЭРХ БҮХИЙ
    агуулга (хайрцаг, шийдвэр, нотолгоо, асуулт) хөндөгдөх мөрийн тоо
  · хариултын урт (токен/тэмдэгт) — key, intent, ээлжийн төрөл, үндэслэл, хэрэгсэл, ГҮН-ээр

⚠️ Тайлан нь ХЭМЖИЛТ: `reports/length-audit-<dataset>.json` + консол.  Хаалга биш.
"""

from __future__ import annotations

import sys as _sys

for _stream in (_sys.stdout, _sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

import argparse
import json
import re
import statistics
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "training" / "out"
REPORTS = ROOT / "training" / "reports"
REGISTRY = ROOT / "registry" / "models.json"

BOXES = [
    ("tools", "<<<MGLAI-TOOLS>>>", "<<<END-MGLAI-TOOLS>>>"),
    ("norm_decision", "<<<MGLAI-NORM-DECISION>>>", "<<<END-MGLAI-NORM-DECISION>>>"),
    ("evidence", "<<<MGLAI-EVIDENCE>>>", "<<<END-MGLAI-EVIDENCE>>>"),
]


def serving_base():
    reg = json.loads(REGISTRY.read_text(encoding="utf-8"))
    for c in reg["candidates"]:
        if c["runtime_variant"] == "employee-8b-q4":
            return c["base_model"], c.get("base_model_revision")
    raise SystemExit("registry")


def split_user(text: str) -> dict[str, str]:
    """Сүүлийн user ээлжийг хайрцаг/асуулт болгон задална (токенжуулахад тусад нь)."""
    parts = {}
    rest = text
    for name, a, b in BOXES:
        i = rest.find(a)
        j = rest.find(b)
        if i >= 0 and j > i:
            parts[name] = rest[i : j + len(b)]
            rest = rest[:i] + rest[j + len(b):]
    parts["question"] = rest.strip()
    return parts


def bucket(n: int) -> str:
    for hi, name in ((32, "≤32"), (64, "33–64"), (128, "65–128"), (256, "129–256"), (512, "257–512")):
        if n <= hi:
            return name
    return ">512"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", default="train")
    ap.add_argument("--max-seq", type=int, default=1536)
    ap.add_argument("--dataset-dir", default=str(OUT))
    args = ap.parse_args()

    from transformers import AutoTokenizer

    base, rev = serving_base()
    tok = AutoTokenizer.from_pretrained(base, revision=rev)
    ntok = lambda s: len(tok(s, add_special_tokens=False)["input_ids"])  # noqa: E731

    d = Path(args.dataset_dir)
    man = json.loads((d / "manifest.json").read_text(encoding="utf-8"))
    rows = [json.loads(l) for l in (d / f"behavior-sft-{args.split}.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]

    per = []
    for r in rows:
        msgs = r["messages"]
        sys_t = ntok(msgs[0]["content"])
        hist = msgs[1:-2]
        hist_t = sum(ntok(m["content"]) for m in hist)
        last_user = msgs[-2]["content"]
        parts = split_user(last_user)
        part_t = {k: ntok(v) for k, v in parts.items()}
        prompt = tok.apply_chat_template(msgs[:-1], tokenize=False, add_generation_prompt=True, enable_thinking=False)
        p_ids = tok(prompt, add_special_tokens=False)["input_ids"]
        target = msgs[-1]["content"] + tok.eos_token + "\n"
        t_ids = tok(target, add_special_tokens=False)["input_ids"]
        total = len(p_ids) + len(t_ids)
        # train_lora.py render-тэй ижил: keep = max_seq − |зорилт|; толгой keep//2, сүүл keep − keep//2
        rec = {
            "id": r["id"], "key": r["key"], "intent": r.get("intent"), "turn_kind": r.get("turn_kind"),
            "axes": r["axes"], "depth": r.get("depth_hint") or r.get("axes", {}).get("depth", "—"),
            "system": sys_t, "history": hist_t, "history_msgs": len(hist), **{f"user_{k}": v for k, v in part_t.items()},
            "prompt": len(p_ids), "target": len(t_ids), "target_chars": len(msgs[-1]["content"]), "total": total,
            "truncated": total > args.max_seq, "lost": {}, "critical_hit": [],
        }
        if total > args.max_seq:
            keep = args.max_seq - len(t_ids)
            if keep < 64:
                rec["lost"]["ALL_PROMPT_AND_TARGET"] = total - args.max_seq
                rec["critical_hit"].append("target")
            else:
                head_n = keep // 2
                tail_n = keep - head_n
                cut_from = head_n
                cut_to = len(p_ids) - tail_n
                # Тасарсан токены мужийг хэсэгт буулгана: prompt-ыг хэсэг бүрээр дарааллаар
                # токенжуулж хилийг ойролцоогоор олно (template-ийн тэмдэгт ~10 ток/мессеж).
                segs = [("system", sys_t)]
                for m in hist:
                    segs.append((f"history_{m['role']}", ntok(m["content"])))
                for k in ("tools", "norm_decision", "evidence", "question"):
                    if k in part_t:
                        segs.append((f"user_{k}", part_t[k]))
                pos = 0
                for name, n in segs:
                    a, b = pos, pos + n
                    ov = max(0, min(b, cut_to) - max(a, cut_from))
                    if ov > 0:
                        rec["lost"][name] = rec["lost"].get(name, 0) + ov
                        if name.startswith("user_") or name == "system":
                            rec["critical_hit"].append(name)
                    pos = b
        per.append(rec)

    n = len(per)
    trunc = [p for p in per if p["truncated"]]
    crit = [p for p in trunc if p["critical_hit"]]
    lost_by = Counter()
    for p in trunc:
        for k, v in p["lost"].items():
            lost_by[k] += v
    crit_by = Counter(h for p in crit for h in set(p["critical_hit"]))

    def stats(xs):
        xs = sorted(xs)
        return {"n": len(xs), "mean": round(statistics.mean(xs)) if xs else 0, "median": xs[len(xs) // 2] if xs else 0, "p90": xs[min(len(xs) - 1, int(0.9 * len(xs)))] if xs else 0, "max": xs[-1] if xs else 0}

    sections = {k: stats([p[k] for p in per if k in p]) for k in ("system", "history", "user_tools", "user_norm_decision", "user_evidence", "user_question", "prompt", "target", "total")}
    target_buckets = Counter(bucket(p["target"]) for p in per)
    by = lambda key: {k: stats([p["target"] for p in per if (p[key] if key in p else p["axes"].get(key)) == k]) for k in sorted({(p[key] if key in p else p["axes"].get(key)) for p in per}, key=str)}  # noqa: E731
    by_key = {k: stats([p["target"] for p in per if p["key"] == k]) for k in sorted({p["key"] for p in per})}
    by_intent = {k: stats([p["target"] for p in per if p["intent"] == k]) for k in sorted({str(p["intent"]) for p in per})}
    by_turn = {k: stats([p["target"] for p in per if p["turn_kind"] == k]) for k in sorted({str(p["turn_kind"]) for p in per})}
    by_ground = {k: stats([p["target"] for p in per if p["axes"].get("grounding") == k]) for k in sorted({p["axes"].get("grounding") for p in per}, key=str)}
    by_tools = {k: stats([p["target"] for p in per if p["axes"].get("tools") == k]) for k in sorted({p["axes"].get("tools") for p in per}, key=str)}
    by_depth = {k: stats([p["target"] for p in per if p["depth"] == k]) for k in sorted({str(p["depth"]) for p in per})}

    report = {
        "dataset_version": man.get("dataset_version"), "split": args.split, "max_seq": args.max_seq, "tokenizer": f"{base}@{(rev or '?')[:8]}", "rows": n,
        "sections": sections,
        "truncation": {"rows": len(trunc), "pct": round(100 * len(trunc) / n, 1), "critical_rows": len(crit), "critical_pct": round(100 * len(crit) / n, 1), "tokens_lost_by_section": dict(lost_by), "critical_sections_hit": dict(crit_by), "worst": sorted(({"id": p["id"], "key": p["key"], "total": p["total"], "lost": p["lost"]} for p in trunc), key=lambda x: -x["total"])[:8]},
        "target_buckets": dict(sorted(target_buckets.items())),
        "target_by_key": by_key, "target_by_intent": by_intent, "target_by_turn": by_turn, "target_by_grounding": by_ground, "target_by_tools": by_tools, "target_by_depth": by_depth,
        "long_targets": {"≥128": sum(1 for p in per if p["target"] >= 128), "≥256": sum(1 for p in per if p["target"] >= 256), "≥512": sum(1 for p in per if p["target"] >= 512)},
    }
    REPORTS.mkdir(parents=True, exist_ok=True)
    out = REPORTS / f"length-audit-{man.get('dataset_version')}-{args.split}-seq{args.max_seq}.json"
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"АУДИТ {man.get('dataset_version')} · {args.split} · {n} мөр · max_seq {args.max_seq}")
    for k, v in sections.items():
        print(f"  {k:20s} n={v['n']:3d} mean {v['mean']:5d} med {v['median']:5d} p90 {v['p90']:5d} max {v['max']:5d}")
    print(f"  ТАЙРАГДАХ: {len(trunc)}/{n} ({report['truncation']['pct']}%) · ЭРХ БҮХИЙ агуулга хөндөгдөх: {len(crit)} ({report['truncation']['critical_pct']}%)")
    print(f"    алдагдах токен хэсгээр: {dict(lost_by)}")
    print(f"    хөндөгдсөн чухал хэсэг (мөр): {dict(crit_by)}")
    print(f"  ЗОРИЛТЫН УРТ (токен): {dict(sorted(target_buckets.items()))} · ≥128: {report['long_targets']['≥128']} · ≥256: {report['long_targets']['≥256']}")
    print("  гүнээр:", {k: (v["n"], v["mean"]) for k, v in by_depth.items()})
    print("  ээлжээр:", {k: (v["n"], v["mean"]) for k, v in by_turn.items()})
    print("  үндэслэлээр:", {k: (v["n"], v["mean"]) for k, v in by_ground.items()})
    print(f"  → {out}")


if __name__ == "__main__":
    main()
