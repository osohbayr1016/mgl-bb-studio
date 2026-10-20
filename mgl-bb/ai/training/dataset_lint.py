#!/usr/bin/env python3
"""
MGL AI · БАГЦЫН БОДЛОГЫН ШАЛГАЛТ (§35).

⚠️ ЭНЭ ФАЙЛ БОЛ §35-ИЙН ХЭРЭГЖҮҮЛЭЛТ.  Мандатын хамгийн чухал ганц дүрэм:

      Битгий сурга:  «Ажилтны тоо 42».
      Сурга:         «Ажилтны тоог асуувал `get_active_employees` дууд».

   Учир нь маргааш 43 болно.  Жинд шигтгэсэн тоо нь дахин сургалт хийтэл
   ХУДАЛ хариу өгөх ба хэн ч түүнийг анзаарахгүй.

⚠️ ЭНЭ ШАЛГАЛТЫГ АЛГАСАХ ТУГ БАЙХГҮЙ.  `train_lora.py` нь үүнийг
   болзолгүй дуудаж, унавал сургалтыг ЗОГСООНО.

⚠️ ХУУРАМЧ ЭЕРЭГ ГАРАХ НЬ ЗӨВ ТАЛ РУУ АЛДАХ.  «БНбД 21-01-02» гэсэн
   норм эшлэлд тоо байгаа ч тэр нь ТОГТМОЛ баримт — доорх дүрмүүд нь
   зөвхөн АМЬД ERP-ийн үйл үгтэй хамт гарсан тоог хардана.

Ажиллуулах:
    python ai/training/dataset_lint.py ai/datasets/mgl-dataset-1.1.0/train.jsonl
"""

from __future__ import annotations

import sys as _sys

# ⚠️ Windows-ийн консол нь өгөгдмөлөөр cp1252 — кирилл тэмдэгт бүхий
#    ганц `print` нь UnicodeEncodeError-оор скриптийг УНАГААНА.  Ажилтны
#    машин бүр Windows тул энэ хоёр мөр нь заавал.  (`PYTHONIOENCODING`-д
#    найдах нь ажиллахгүй — тэр нь бүрхүүл тус бүрд тавигдана.)
for _stream in (_sys.stdout, _sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

import json
import re
import sys
from pathlib import Path

# ⚠️ АМЬД ERP-ИЙН ОЙЛГОЛТУУД.  Эдгээрийн хажууд ТОО гарвал тэр нь
#    хуучирдаг баримт байх магадлалтай.
LIVE_ENTITY_MN = r"(ажилтан|ажиллагс|ажилчид|төсөл|даалгавар|хугацаа|deadline|явц|хувь|баг|гишүүн)"
LIVE_ENTITY_EN = r"(employee|staff|headcount|project|task|deadline|progress|team|member)"

# «41 ажилтан», «ажилтан 41», «12 төсөл» …
NUM_NEAR_ENTITY = re.compile(
    rf"(\b\d{{1,5}}\b\s*\w{{0,12}}\s*{LIVE_ENTITY_MN}"
    rf"|{LIVE_ENTITY_MN}\s*\w{{0,12}}\s*\b\d{{1,5}}\b"
    rf"|\b\d{{1,5}}\b\s*{LIVE_ENTITY_EN}"
    rf"|{LIVE_ENTITY_EN}\s*\w{{0,12}}\s*\b\d{{1,5}}\b)",
    re.IGNORECASE,
)

# Тодорхой огноо — «2026-09-17», «09 сарын 17».
HARD_DATE = re.compile(r"\b20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b")

# Хүний нэр мэт: «А.Ананд», «B.Bat»
PERSON_CODE = re.compile(r"\b[А-ЯA-Z]\.[А-ЯA-Z][а-яa-zА-ЯA-Z]{2,}\b")

# ⚠️ ЭДГЭЭР НЬ ТОГТМОЛ — норм, стандартын дугаар.  Тоо агуулсан ч
#    хуучирдаггүй тул шалгалтаас ЧӨЛӨӨЛӨГДӨНӨ.
STANDARD_REF = re.compile(r"\b(БНбД|БД|MNS|СНиП|SNiP|ISO|IEC|GOST)\s*[\d\-–.]+", re.IGNORECASE)

# Хэрэгсэл дуудахыг заасан хариу — ЗӨВ зан төлөв, шагнана.
TOOL_MENTION = re.compile(
    r"(get_active_employees|list_projects|get_upcoming_deadlines|get_overdue_tasks"
    r"|get_my_assignments|get_project_progress|search_regulations|хэрэгсэл|tool)",
    re.IGNORECASE,
)


def _mask_standards(text: str) -> str:
    """Норм эшлэлийг далдалж, дүрмүүд түүн дээр гал нээхээс сэргийлнэ."""
    return STANDARD_REF.sub("«СТАНДАРТ»", text)


_NUM = re.compile(r"\d+(?:[.,]\d+)?")


def _numbers(text: str) -> set[str]:
    out: set[str] = set()
    for n in _NUM.findall(text):
        n = n.replace(",", ".")
        out.add(n)
        out.add(n.split(".")[0])  # «88.9» → «88» ч гэсэн (NUM_NEAR_ENTITY бүхэл тоог л барьдаг)
    return out


def lint_answer(answer: str, given: str = "") -> list[tuple[str, str]]:
    """Нэг ХАРИУГ шалгана.  `(дүрэм, дэлгэрэнгүй)` жагсаалт буцаана.

    `given` — тухайн жишээний ХЭРЭГЛЭГЧИЙН ээлжүүд (serving-v2 формат:
    `<<<MGLAI-TOOLS>>>` хайрцаг, нормын шийдвэр, нотолгоо, асуулт).  Тэнд
    БАЙГАА тоо/огноог хариулт ХУУЛСАН бол тэр нь жинд шигтгэсэн баримт
    БИШ — «хайрцгаас хуул» гэсэн зан төлөв.  Хайрцагт БАЙХГҮЙ тоо л
    хориотой.
    """
    problems: list[tuple[str, str]] = []
    masked = _mask_standards(answer)
    given_nums = _numbers(given)

    m = NUM_NEAR_ENTITY.search(masked)
    if m and not TOOL_MENTION.search(answer):
        # ⚠️ Хэрэгсэл дурдсан хариу нь ЗӨВ хэлбэр — «get_active_employees
        #    дуудаад 41 гэж хариулсан» гэдэг нь зан төлөв заасан жишээ.
        nums = _numbers(m.group(0))
        if not nums or not nums <= given_nums:
            problems.append(
                ("live_fact_in_weights", f"амьд ERP баримт мэт тоо: «{m.group(0).strip()}»")
            )

    d = HARD_DATE.search(masked)
    if d and not TOOL_MENTION.search(answer) and d.group(0) not in given:
        problems.append(("hard_date", f"тодорхой огноо: «{d.group(0)}»"))

    p = PERSON_CODE.search(masked)
    if p:
        problems.append(("person_name", f"хүний нэр: «{p.group(0)}» — ажилтан ирж, явдаг"))

    return problems


CYR = re.compile(r"[А-Яа-яӨөҮүЁё]")
LAT = re.compile(r"[A-Za-z]")
# Identity-гоожилт — хариултад хэрэглэгчийн нэр/албан тушаал/эрхийг ДУРДАХ (асуугаагүй байхад).  Багц нь
# userName=null-аар угсрагддаг тул эдгээр хэллэг хариултад огт байх ёсгүй.
# ⚠️ «Таны эрх …» (permission-denied-ийн зөв тайлбар) ба «таны нэр дээр эзэмшүүлнэ» (Revit worksharing)
#    нь identity гоожилт БИШ — хэмжсэн 2 худал эерэг.  Зөвхөн нэр/албан тушаалыг ТОДОРХОЙЛОН хэлэхийг барина.
IDENTITY_LEAK = re.compile(r"(таны нэр (бол|нь) |таны албан тушаал (бол|нь) |та бол [^.\n]{0,30}(инженер|архитектор|ахлах|админ|захирал)\b|таныг [^.\n]{0,20} гэдэг)", re.IGNORECASE)
MAX_ANSWER_CHARS = 6000
# Бүтэцтэй мөр — markdown хүснэгтийн мөр (`| … |`) ба жагсаалтын мөр (`• `, `- `, `* `, `1. `).
# ⚠️ 2026-09-21: `norm-documents` / `norm-catalog` гэр бүлийн зорилт нь баримт бүрд ИЖИЛ төлөвийн шошго
#    («| ШАЛГАГДААГҮЙ | [Бүртгэл», «— source not verified)») давтдаг тул 4-грам мөчлөгийн дүрэм 3 мөрийг
#    ХУДЛАА барьж байв (хэмжсэн: beh_0222, beh_0232, beh_0230 — бүгд өөр өөр код/нэртэй хууль ёсны жагсаалт;
#    үнэлгээний `repetition.mjs` ч хүснэгтийн давталтыг severe гэж тоолдоггүй).  Мөчлөг (§28) нь ЧӨЛӨӨТ
#    БИЧВЭРИЙН гажиг тул 4-грамыг зөвхөн бүтэцгүй мөрөнд тоолно; ижил өгүүлбэр ×2 шалгалт БҮХ мөрөнд
#    (жагсаалтын ижил мөр ч) хэвээр — «• X / • X / • X» гогцоо тэндээ баригдана.
STRUCTURED_LINE = re.compile(r"^\s*(\|.*\|\s*$|[•\-\*]\s+\S|\d{1,2}[.)]\s+\S)")


def _repetition(text: str) -> str | None:
    """Хүчтэй давталт — ижил өгүүлбэр ≥ 2, эсвэл 4-грам мөчлөг (§28).  Хэмжүүр биш, ХААЛГА."""
    sents = [s.strip().lower() for s in re.split(r"(?<=[.!?])\s+|\n+", text) if len(s.strip()) > 12]
    seen: dict[str, int] = {}
    for s in sents:
        seen[s] = seen.get(s, 0) + 1
        if seen[s] >= 2:
            return f"ижил өгүүлбэр ×{seen[s]}: «{s[:60]}»"
    prose = "\n".join(line for line in text.splitlines() if not STRUCTURED_LINE.match(line))
    words = re.findall(r"\S+", prose.lower())
    if len(words) >= 24:
        grams: dict[tuple, int] = {}
        for k in range(len(words) - 3):
            g = tuple(words[k:k + 4])
            grams[g] = grams.get(g, 0) + 1
        worst = max(grams.values()) if grams else 0
        if worst >= 3 and worst / max(1, len(words) - 3) > 0.02:
            g = next(g for g, c in grams.items() if c == worst)
            return f"4-грам ×{worst}: «{' '.join(g)[:60]}»"
    return None


def lint_structure(row: dict, i: int, seen_ids: set) -> list[dict]:
    """§12 — бүтцийн шалгалт: роль, хоосон хариулт, давхар id, урт, давталт, хэлний зөрүү, identity."""
    out: list[dict] = []
    add = lambda rule, detail: out.append({"row": i, "rule": rule, "detail": detail})  # noqa: E731
    rid = row.get("id")
    if rid is not None:
        if rid in seen_ids:
            add("duplicate_id", f"id давхардсан: {rid}")
        seen_ids.add(rid)
    msgs = row.get("messages")
    if not isinstance(msgs, list) or len(msgs) < 2:
        add("malformed_messages", "messages нь ≥ 2 элементтэй жагсаалт биш")
        return out
    roles = [m.get("role") for m in msgs]
    if roles[0] not in ("system", "user") or roles[-1] != "assistant":
        add("malformed_roles", f"роль дараалал: {roles}")
    for k in range(1, len(roles)):
        if roles[k] == roles[k - 1] and roles[k] != "system":
            add("malformed_roles", f"ижил роль дараалсан: {roles[k]} @{k}")
            break
    for m in msgs:
        if m.get("role") not in ("system", "user", "assistant", "tool"):
            add("malformed_roles", f"танигдахгүй роль: {m.get('role')}")
        if not str(m.get("content") or "").strip():
            add("empty_content", f"хоосон {m.get('role')}")
    answer = str(msgs[-1].get("content") or "")
    if not answer.strip():
        return out
    if len(answer) > MAX_ANSWER_CHARS:
        add("too_long", f"хариулт {len(answer)} тэмдэгт > {MAX_ANSWER_CHARS}")
    rep = _repetition(answer)
    if rep:
        add("repetition", rep)
    # Хэлний зөрүү: монгол (кирилл) асуултад латин-давамгай хариулт — «Reply in English» заавар байхгүй бол.
    last_user = next((str(m.get("content") or "") for m in reversed(msgs) if m.get("role") == "user"), "")
    q = last_user.split("Асуулт:")[-1] if "Асуулт:" in last_user else last_user
    sys_txt = str(msgs[0].get("content") or "") if roles[0] == "system" else ""
    wants_en = bool(re.search(r"(Reply in English|answer in English|response_language[^\n]*en|Хариултын хэл[^\n]*англи)", sys_txt + last_user, re.IGNORECASE))
    if len(CYR.findall(q)) > 20 and not wants_en:
        c, l = len(CYR.findall(answer)), len(LAT.findall(answer))
        if l > 2 * c and c + l > 40:
            add("language_mismatch", f"кирилл асуулт → латин хариулт (cyr {c} / lat {l})")
    if IDENTITY_LEAK.search(answer):
        add("identity_leak", f"identity дурдсан: «{IDENTITY_LEAK.search(answer).group(0)[:50]}»")
    return out


def lint_rows(rows: list[dict]) -> list[dict]:
    """`train.jsonl`-ийн мөрүүдийг шалгана (§35 бодлого + §12 бүтэц)."""
    out: list[dict] = []
    seen_ids: set = set()
    for i, row in enumerate(rows):
        out.extend(lint_structure(row, i, seen_ids))
        msgs = row.get("messages") or []
        answer = ""
        given: list[str] = []
        for m in msgs:
            if m.get("role") == "assistant":
                answer = str(m.get("content") or "")
            elif m.get("role") in ("user", "tool"):
                given.append(str(m.get("content") or ""))
        if not answer:
            continue
        for rule, detail in lint_answer(answer, "\n".join(given)):
            out.append({"row": i, "rule": rule, "detail": detail})
    return out


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit("Хэрэглээ: python dataset_lint.py <train.jsonl>")
    path = Path(sys.argv[1])
    rows = []
    bad_json = []
    for n, l in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not l.strip():
            continue
        try:
            rows.append(json.loads(l))
        except json.JSONDecodeError as e:
            bad_json.append({"row": n, "rule": "invalid_json", "detail": str(e)[:80]})
    problems = bad_json + lint_rows(rows)
    if "--json" in sys.argv:
        out = Path(sys.argv[sys.argv.index("--json") + 1])
        by_rule: dict[str, int] = {}
        for q in problems:
            by_rule[q["rule"]] = by_rule.get(q["rule"], 0) + 1
        out.write_text(json.dumps({"file": str(path), "rows": len(rows), "problems": len(problems), "by_rule": by_rule, "items": problems}, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"\nMGL AI · багцын бодлогын шалгалт\n  {path}\n  {len(rows)} мөр\n")
    if not problems:
        print("  ✔ Цэвэр.\n")
        return
    for p in problems:
        print(f"  ✖ мөр {p['row']}: {p['rule']} — {p['detail']}")
    print(f"\n  {len(problems)} асуудал.  §35-ыг үз.\n")
    sys.exit(1)


if __name__ == "__main__":
    main()
