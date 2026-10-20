r"""GOLDEN БАГЦЫН ГҮЙЛТ (1B-5) — оноолт · ХООСОН-БЛОК дүрэм · хэвлэлтийн тэмдэглэл.

    ..\server\.venv\Scripts\python.exe run_golden.py --kind intent
    ..\server\.venv\Scripts\python.exe run_golden.py --kind bim      # → БЛОКЛОВ

`pull_and_retrain.py`-ийн ЗУРГАА ДАХЬ ХААЛГА.  `check_behavior.py`-аас
ЯЛГААТАЙ нь: тэр нь зөвхөн `intents` хуваарийг (PROBES) хардаг, энэ нь
ЗУРГУУЛАН хуваарийг хардаг БА хоосон хуваарийг АЛГАСАХГҮЙ.

ГАРАХ КОД
  0  бүх шаардлагатай хуваарь дүүрэн, буруу мөр 0
  1  АЛДАГДАЛ — golden мөр CURATED-TRAIN-д оржээ (`assert_no_leak`)
  2  БЛОКЛОВ — шаардлагатай хуваарь ХООСОН эсвэл буруу мөртэй
  3  БҮРЭН БҮТЭН БАЙДАЛ — SHA-256 / `preprocess_contract` зөрөв
  4  C# harness ажиллаагүй (dotnet, IntentModel.cs, загварын JSON)

⚠️ ЯАГААД ХООСНЫГ АЛГАСАЖ БОЛОХГҮЙ ВЭ (§3.4).  `bim` ба `rules` нь өнөөдөр
ХООСОН.  «n/a» гээд алгасвал Track C-ийн эхний загвар «BIM-ийг ойлгодог» гэж
мэдэгдэхэд түүнийг НЯЦААХ ТОО БАЙХГҮЙ болно.  Хоосон = «бид хараахан
хэмжээгүй», алгасалт = «хэмжих шаардлагагүй».  Систем эхнийхийг хэлэх ёстой.

⚠️ ТААМАГЛАЛЫГ C# ТАЛААС АВНА (`IntentModel.Predict`), Python-оос БИШ.
Python дээр дахин хэрэгжүүлбэл ЭНЭ ФАЙЛ нь `preprocess()` ↔ `IntentModel.cs`
хосын ГУРАВ ДАХЬ хуулбар болно; тэр нь яг л `check_parity.py` барихаар
байгуулагдсан уналтын горим.  Тиймээс `check_behavior.py`-тэй ЯГ ИЖИЛ
harness-ыг ашиглана.
"""

from __future__ import annotations

import argparse
import ast
import datetime as _dt
import io
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import assert_no_leak as anl  # noqa: E402
from assert_no_leak import (  # noqa: E402
    MANIFEST_PATH,
    PARTITIONS,
    REPO,
    TRAINING,
    golden_rows,
    load_manifest,
    read_json,
    rel,
    sha256_file,
    verify_checksums,
    verify_contract,
    verify_exclusions,
)

ADDIN = REPO / "addin"
DEFAULT_MODEL = ADDIN / "Resources" / "intent-model.json"
DEFAULT_BASELINE = HERE / "last_run.json"

# ⚠️ `IntentRouter.cs:81` (`MinConfidence`)-тэй ЗААВАЛ таарна.  Оноололт нь
# шошгоор явдаг тул энэ нь зөвхөн ТАЙЛАНГИЙН багана — гэвч «босго давсан
# мөнгөн буруу таамаг» хэдэн ширхэг байгааг харуулах нь §2.4-ийн дөрвөн
# уналтыг эрт барих цорын ганц дохио.
MINC = 0.45


# --------------------------------------------------------------------------
# C# harness
# --------------------------------------------------------------------------

def harness_sources() -> tuple[str, str]:
    """`check_parity.py`-ийн `HARNESS_CSPROJ` / `HARNESS_MAIN`-ыг AST-аар авна.

    ⚠️ ИМПОРТЛОХГҮЙ.  `check_parity.py` нь модулийн түвшинд `train_intent`-ээс
    нэрс импортолдог; тэр жагсаалт өөрчлөгдөх үед (жишээ нь 1B-4-ийн
    `clean` → `clean_records` шилжилт) энэ хаалга ХАМААРАЛГҮЙ шалтгаанаар
    унах болно.  Хэрэгтэй нь ердөө хоёр МӨРИЙН ТОГТМОЛ тул эх сурвалжийг
    задлан уншина — хуулбар үүсгэхгүй, хамаарал ч үүсгэхгүй.
    """
    src = io.open(TRAINING / "check_parity.py", encoding="utf-8").read()
    out: dict[str, str] = {}
    for n in ast.parse(src).body:
        if isinstance(n, ast.Assign) and len(n.targets) == 1:
            name = getattr(n.targets[0], "id", "")
            if name in ("HARNESS_CSPROJ", "HARNESS_MAIN"):
                out[name] = ast.literal_eval(n.value)
    if len(out) != 2:
        raise SystemExit("check_parity.py-аас harness олдсонгүй "
                         "(HARNESS_CSPROJ / HARNESS_MAIN)")
    return out["HARNESS_CSPROJ"], out["HARNESS_MAIN"]


_MISSING_RE = re.compile(
    r"error CS(?:0103|0246|0234):.*?['\"]([A-Za-z_][A-Za-z0-9_]*)['\"]")


def resolve_missing(stdout: str, stderr: str) -> list[Path]:
    """Эмхэтгэлийн «ийм нэр алга» алдаанаас дутуу .cs файлыг олно.

    ⚠️ ЯАГААД ЭНЭ ХЭРЭГТЭЙ ВЭ.  `check_parity.py`-ийн harness нь ердөө ХОЁР
    файл эмхэтгэдэг (`IntentModel.cs` + `TextFold.cs`).  Add-in шинэ ЦЭВЭР
    .NET туслах авах бүрд (2026-08-28: `Percentiles.cs`-ийн `Metrics`) тэр
    harness эмхэтгэлийн алдаагаар унадаг — гэтэл шалтгаан нь загварын чанар
    ОГТ БИШ.  Энэ гогцоо дутуу файлыг ӨӨРӨӨ нэмж, ЮУ нэмснээ ЧАНГА хэвлэнэ.
    Add-in-д ЯМАР Ч өөрчлөлт оруулахгүй — зөвхөн түр хавтас дахь csproj.
    """
    names = set(_MISSING_RE.findall((stdout or "") + "\n" + (stderr or "")))
    found: list[Path] = []
    for name in sorted(names):
        decl = re.compile(r"\b(?:class|struct|enum|interface|record)\s+" +
                          re.escape(name) + r"\b")
        for cs in sorted(ADDIN.glob("*.cs")):
            try:
                if decl.search(cs.read_text(encoding="utf-8", errors="replace")):
                    found.append(cs)
                    break
            except OSError:
                continue
    return found


def predict(texts: list[str], model: Path) -> dict[str, tuple[str, float]]:
    """текст → (шошго, итгэлцэл).  Нэг л удаа dotnet асаана."""
    if not texts:
        return {}
    if not model.exists():
        print(f"❌ загвар олдсонгүй: {model}", file=sys.stderr)
        sys.exit(4)
    csproj, main_cs = harness_sources()
    extra: list[Path] = []
    r = None
    for attempt in range(4):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            includes = "".join(
                f'\n    <Compile Include="{p.resolve()}" />' for p in extra)
            (d / "parity.csproj").write_text(
                csproj
                .replace("__MODEL_CS__", str((ADDIN / "IntentModel.cs").resolve()))
                .replace("__FOLD_CS__", str((ADDIN / "TextFold.cs").resolve()))
                .replace("</ItemGroup>", includes + "\n  </ItemGroup>", 1),
                encoding="utf-8")
            (d / "Program.cs").write_text(main_cs, encoding="utf-8")
            pf = d / "p.txt"
            pf.write_text("\n".join(texts), encoding="utf-8")
            r = subprocess.run(
                ["dotnet", "run", "--project", str(d / "parity.csproj"), "--",
                 str(model.resolve()), str(pf)],
                capture_output=True, text=True, encoding="utf-8")
        if r.returncode == 0:
            break
        more = [p for p in resolve_missing(r.stdout or "", r.stderr or "")
                if p not in extra]
        if not more or attempt == 3:
            break
        extra += more
        print("  ⚠️ harness-д дутуу .cs нэмэв: "
              + ", ".join(p.name for p in more), file=sys.stderr)
    if extra:
        print(f"  ℹ️ harness нь check_parity-ийн 2 файлаас гадна "
              f"{len(extra)} нэмэлт файл эмхэтгэв: "
              f"{', '.join(p.name for p in extra)}", file=sys.stderr)
    if r is None or r.returncode != 0:
        print(((r.stdout if r else "") or "")[-2000:], file=sys.stderr)
        print(((r.stderr if r else "") or "")[-2000:], file=sys.stderr)
        print(f"❌ C# harness амжилтгүй (rc={r.returncode if r else '?'})",
              file=sys.stderr)
        sys.exit(4)

    out: dict[str, tuple[str, float]] = {}
    for line in (r.stdout or "").splitlines():
        if "\t" not in line:
            continue
        t, lab, conf = line.split("\t")
        out[t] = (lab, float(conf))
    missing = [t for t in texts if t not in out]
    if missing:
        print(f"❌ harness {len(missing)} мөрийг буцаасангүй: {missing[:3]}",
              file=sys.stderr)
        sys.exit(4)
    return out


# --------------------------------------------------------------------------
# Оноолт
# --------------------------------------------------------------------------

def score(rows: list[dict], pred: dict[str, tuple[str, float]]) -> dict:
    n = len(rows)
    passed = 0
    wrong: list[dict] = []
    acted_wrong = 0
    for r in rows:
        lab, conf = pred[r["text"]]
        good = lab == r["intent"]
        if good:
            passed += 1
        else:
            # ⚠️ «Босго давсан БУРУУ таамаг» нь энгийн буруугаас АЮУЛТАЙ:
            # add-in асуухгүй, ҮЙЛДЭЛ хийнэ.  §2.4-ийн HN-1 яг ийм байсан.
            acted = lab != "unknown" and conf >= MINC
            if acted:
                acted_wrong += 1
            wrong.append({"text": r["text"], "expected": r["intent"],
                          "got": lab, "confidence": round(conf, 4),
                          "acted": acted,
                          **({"incident": r["incident"]} if r.get("incident") else {})})
    return {"rows": n, "pass": passed, "fail": n - passed,
            "acted_wrong": acted_wrong, "wrong": wrong}


def delta_str(name: str, res: dict, base: dict | None) -> str:
    if res["rows"] == 0:
        return "⚠ ХООСОН — харьцуулалт БАЙХГҮЙ"
    if not base:
        return "— (суурь алга)"
    prev = (base.get("partitions") or {}).get(name)
    if not prev:
        return "— (шинэ хуваарь)"
    d = res["pass"] - int(prev.get("pass") or 0)
    dn = res["rows"] - int(prev.get("rows") or 0)
    # ⚠️ §3.4: дельтаг МӨРИЙН ТООГҮЙГЭЭР хэвлэхийг ХОРИГЛОНО — 3 мөрийн
    # багц дээрх +2 ба 300 мөрийн багц дээрх +2 хоёр ӨӨР мэдэгдэл.
    return f"{d:+d}  (мөр {dn:+d} → {res['rows']})"


def main() -> None:
    ap = argparse.ArgumentParser(description="Golden багцын гүйлт")
    ap.add_argument("--kind", required=True, choices=["intent", "bim", "rules"])
    ap.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    ap.add_argument("--baseline", type=Path, default=DEFAULT_BASELINE,
                    help="өмнөх гүйлтийн JSON (Δ тооцоход)")
    ap.add_argument("--save-baseline", action="store_true",
                    help="энэ гүйлтийг суурь болгон бичих")
    ap.add_argument("--out", type=Path, default=None,
                    help="`assistant_models.eval_json`-д илгээх payload")
    args = ap.parse_args()

    man = load_manifest()

    # --- 1. БҮРЭН БҮТЭН БАЙДАЛ -------------------------------------------
    problems = verify_contract(man) + verify_checksums(man) + verify_exclusions(man)
    if problems:
        print("❌ GOLDEN БАГЦЫН БҮРЭН БҮТЭН БАЙДАЛ ЭВДЭРСЭН:", file=sys.stderr)
        for p in problems:
            print(f"     {p}", file=sys.stderr)
        print("   Golden файлыг гараар зассан бол `freeze.py refresh` "
              "ажиллуулж, PR-т ЯАГААД гэдгийг бич.", file=sys.stderr)
        sys.exit(3)

    # --- 2. АЛДАГДАЛ ------------------------------------------------------
    if anl.check(verbose=False) != 0:
        print("❌ Golden мөр CURATED-TRAIN-д алдагджээ — дэлгэрэнгүйг "
              "`assert_no_leak.py`-аас үз.", file=sys.stderr)
        sys.exit(1)

    # --- 3. ТААМАГЛАЛ -----------------------------------------------------
    gold = golden_rows()
    for name, rows in gold.items():
        for r in rows:
            if "\n" in r["text"] or "\t" in r["text"] or not r["text"].strip():
                print(f"❌ golden/{name}: мөр шилжилт/таб агуулсан текст "
                      f"({r['row_id']}) — harness мөрөөр ажилладаг",
                      file=sys.stderr)
                sys.exit(3)

    texts = sorted({r["text"] for rows in gold.values() for r in rows})
    pred = predict(texts, args.model)

    model_version = ""
    try:
        model_version = str(read_json(args.model).get("version") or "")
    except Exception:  # noqa: BLE001
        pass

    base = None
    if args.baseline and args.baseline.exists():
        try:
            base = read_json(args.baseline)
        except Exception:  # noqa: BLE001
            base = None

    required = man["required_partitions"][args.kind]

    # --- 4. ХЭВЛЭЛТИЙН ТЭМДЭГЛЭЛ -----------------------------------------
    print(f"Загвар {model_version or '(хувилбаргүй)'}  (kind={args.kind})")
    print(f"  датасет {man['dataset_version']} · гэрээ {man['preprocess_contract']} · "
          f"манифест {sha256_file(MANIFEST_PATH)[:16]}…")
    print(f"  шаардлагатай хуваарь: {', '.join(required)}")
    print()
    print(f"  {'хуваарь':16} {'мөр':>4}  {'зөв':>9}   Δ өмнөхөөс")
    print("  " + "-" * 62)

    results: dict[str, dict] = {}
    blocked: list[str] = []
    for name in PARTITIONS:
        res = score(gold[name], pred)
        results[name] = res
        cell = "—" if res["rows"] == 0 else f"{res['pass']}/{res['rows']}"
        print(f"  {name:16} {res['rows']:>4}  {cell:>9}   "
              f"{delta_str(name, res, base)}")
        if name in required and res["rows"] == 0:
            blocked.append(name)          # ❌ АЛГАСАХГҮЙ
        if name in required and res["fail"] > 0:
            blocked.append(name)

    # Буруу мөрүүдийг ил гарга — «яагаад блоклов» гэдэг нэг харцаар мэдэгдэнэ.
    for name in PARTITIONS:
        for w in results[name]["wrong"]:
            flag = "‼️ ҮЙЛДЭЛ ХИЙХ БАЙВ" if w["acted"] else "асууна"
            inc = f"  [{w['incident']}]" if w.get("incident") else ""
            print(f"    ❌ {name}/{w['text']!r} → {w['got']} "
                  f"{w['confidence']:.2f} (хүлээсэн {w['expected']}) {flag}{inc}")

    payload = {
        "dataset_version": man["dataset_version"],
        "manifest_sha256": sha256_file(MANIFEST_PATH),
        "preprocess_contract": man["preprocess_contract"],
        "kind": args.kind,
        "model_version": model_version,
        "partitions": {k: {"rows": v["rows"], "pass": v["pass"],
                           "fail": v["fail"], "acted_wrong": v["acted_wrong"]}
                       for k, v in results.items()},
        "required": required,
        "blocked": sorted(set(blocked)),
        "passed": not blocked,
        "run_at": _dt.datetime.now().astimezone().isoformat(timespec="seconds"),
    }
    if args.out:
        args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n",
                            encoding="utf-8")
        print(f"\n  payload: {args.out}")

    if blocked:
        print("\n❌ БЛОКЛОВ: " + ", ".join(sorted(set(blocked))), file=sys.stderr)
        for name in sorted(set(blocked)):
            if results[name]["rows"] == 0:
                print(f"     {name}: ХООСОН — «хараахан хэмжээгүй» гэдэг нь "
                      f"«хэмжих шаардлагагүй» гэсэн үг БИШ (§3.4).",
                      file=sys.stderr)
            else:
                print(f"     {name}: {results[name]['fail']} буруу мөр",
                      file=sys.stderr)
        sys.exit(2)

    if args.save_baseline:
        args.baseline.write_text(
            json.dumps(payload, ensure_ascii=False, indent=1) + "\n",
            encoding="utf-8")
        print(f"  суурь бичигдлээ: {rel(args.baseline)}")

    print("\n✅ GOLDEN ДАВЛАА — блоклосон хуваарь алга.")


if __name__ == "__main__":
    main()
