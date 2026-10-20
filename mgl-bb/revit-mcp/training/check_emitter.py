r"""ИЛГЭЭГЧИЙН БАТ БӨХИЙН ШАЛГАЛТ — `addin/BimEmitter.cs`-ийг Revit-гүйгээр
БОДИТООР АЖИЛЛУУЛЖ тулгана.

⚠️ ЯАГААД ЭНЭ ФАЙЛ ОРШИХ ЁСТОЙ ВЭ.  `BimEmitter.cs` бол 0201-0210-ын
   ЦОРЫН ГАНЦ үйлдвэрлэгч бөгөөд ~20 машин дээр өдөр бүр ажиллана.  Тэр нь
   өөрийн тайлбартаа «хоёр thread, 4096 хязгаартай дараалал, тоологдсон
   алдагдал, бат бөх JSONL + атом курсор, 5 алдааны таслуур, 2 MB нягтралт
   нь ЗӨВХӨН баталгаажсан мөрийг хаяна» гэж ЗАРЛАСАН.  Эдгээр нь БҮГД
   БАТЛАГДААГҮЙ МЭДЭГДЭЛ байв — файл нэг ч удаа ажиллаж байгаагүй.
   Кодыг УНШИЖ батлах БОЛОМЖГҮЙ (процесс унах, хоёр процесс, диск дүүрэх,
   backoff нь бүгд ГҮЙЛТИЙН шинж чанар).  Тиймээс энд ЖИНХЭНЭ эх кодыг
   эмхэтгэж, ЖИНХЭНЭ процесс болгож ажиллуулж, процессыг АЛЖ, дискийг
   ЭВДЭЖ, сүлжээг УНАГААЖ ХЭМЖИНЭ.

`check_rules.py` / `check_nudge.py`-ийн ИЖИЛ хэв маяг: Revit-д хүрдэггүй
`.cs` файлуудыг түр `net10.0` console төсөлд хийж эмхэтгэнэ.  ЯЛГАА нь:
энэ харнесс эмхэтгэсэн exe-г ОЛОН УДАА, өөр өөр нөхцөлд ажиллуулж,
файлын системийн үр дүнг Python талаас шалгана.

    ..\..\server\.venv\Scripts\python.exe check_emitter.py
    ..\..\server\.venv\Scripts\python.exe check_emitter.py --only T1,T5
    ..\..\server\.venv\Scripts\python.exe check_emitter.py --slow  # + 5 мин таслуурын сэргэлт
    ..\..\server\.venv\Scripts\python.exe check_emitter.py --keep  # түр хавтсыг үлдээх

⚠️ БОДИТ ЭХ КОД, ГАНЦХАН ОРЛУУЛГА.  `BimEmitter.cs`-аас ЗӨВХӨН `Dir`
   шинж чанарын их бие солигдоно (`%APPDATA%\RevitMcpAddin` → харнессийн
   түр хавтас).  Орлуулга ЯГ НЭГ УДАА таарах ёстой — таарахгүй бол харнесс
   ЗОГСОНО, эс бөгөөс өөр кодыг шалгаад «ногоон» гэж хэлэх эрсдэлтэй.
   Бусад БҮХ мөр үсэг үсгээрээ.

⚠️ ҮНЭНЧ БАЙДЛЫН ХИЛ.  Revit (`ChangeTracker`), HTTP (`AiHttp`), тохиргоо
   (`SettingsStore`) нь `emitter_harness/Stubs.cs`-д загварчлагдсан.
   Дараалал, диск, курсор, багцлалт, backoff, таслуур, нягтралт, унтраалт
   — БҮГД жинхэнэ `BimEmitter.cs`.  `ChangeSetCoalescer.cs` нь мөн ЖИНХЭНЭ
   файл (Autodesk.Revit-гүй тул шууд эмхэтгэгдэнэ).

⚠️ ГОЛ ИНВАРИАНТ, БҮХ ТЕСТЭД НЭГ:
       үйл явдал бүр нь ЛИБО хүргэгдсэн, ЛИБО дискэн дээр байх ЁСТОЙ.
   Аль нь ч биш бол — АЛДАГДСАН.  Тоологдсон алдагдал (`dropped_count`)
   нь ТУСДАА ангилал: харагдах алдагдал бол чимээгүй алдагдлаас хамаагүй
   дээр ч, бас алдагдал хэвээр.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from collections import Counter
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

HERE = Path(__file__).resolve().parent
ADDIN = HERE.parent / "addin"
HARNESS_SRC = HERE / "emitter_harness"

# ⚠️ ЖИНХЭНЭ ФАЙЛУУД (үсэг үсгээрээ, `BimEmitter.cs`-ийн `Dir`-ээс бусад).
REAL_VERBATIM = ["ChangeSetCoalescer.cs"]
REAL_PATCHED = "BimEmitter.cs"

# ⚠️ ГАНЦХАН ОРЛУУЛГА.  Таарахгүй / олон таарвал ЗОГСОНО.
DIR_PATTERN = re.compile(
    r"return\s+Path\.Combine\(\s*"
    r"Environment\.GetFolderPath\(Environment\.SpecialFolder\.ApplicationData\)\s*,\s*"
    r'"RevitMcpAddin"\s*\)\s*;'
)
DIR_REPLACEMENT = "return Harness.Dir;   /* ХАРНЕССИЙН ГАНЦ ОРЛУУЛГА */"

# ⚠️ `BimEmitter` нь UI / Revit-д ХЭЗЭЭ Ч хүрэх ЁСГҮЙ (Хориглолт №8, №9).
FORBIDDEN = [
    "Autodesk.Revit",
    "Dispatcher",
    "DockablePane",
    "MessageBox",
    "System.Windows",
    "TaskDialog",
]

CSPROJ = """<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>disable</Nullable>
    <ImplicitUsings>disable</ImplicitUsings>
    <AssemblyName>bimcheck</AssemblyName>
    <EnableSourceControlManagerQueries>false</EnableSourceControlManagerQueries>
    <EnableSourceLink>false</EnableSourceLink>
    <InvariantGlobalization>true</InvariantGlobalization>
    <NoWarn>$(NoWarn);CS0649;CS0414;CS0162;CS8321</NoWarn>
  </PropertyGroup>
</Project>
"""


# ============================================================================
#  ҮР ДҮНГИЙН БҮРТГЭЛ
# ============================================================================

class Report:
    def __init__(self) -> None:
        self.rows: list[tuple[str, str, bool, str]] = []

    def add(self, test: str, claim: str, ok: bool, detail: str) -> None:
        self.rows.append((test, claim, ok, detail))
        mark = "PASS" if ok else "FAIL"
        print(f"  [{mark}] {test} — {claim}")
        if detail:
            for ln in detail.splitlines():
                print(f"         {ln}")

    @property
    def failed(self) -> int:
        return sum(1 for _, _, ok, _ in self.rows if not ok)


REPORT = Report()


# ============================================================================
#  ЭМХЭТГЭЛ
# ============================================================================

def build(workdir: Path) -> Path:
    proj = workdir / "proj"
    proj.mkdir(parents=True, exist_ok=True)
    (proj / "bimcheck.csproj").write_text(CSPROJ, encoding="utf-8")

    for name in REAL_VERBATIM:
        src = ADDIN / name
        if not src.exists():
            sys.exit(f"ЗОГСЛОО: {src} байхгүй")
        shutil.copyfile(src, proj / name)

    raw = (ADDIN / REAL_PATCHED).read_text(encoding="utf-8")
    patched, n = DIR_PATTERN.subn(DIR_REPLACEMENT, raw)
    if n != 1:
        sys.exit(
            f"ЗОГСЛОО: `Dir` орлуулга {n} удаа таарлаа (1 байх ёстой).\n"
            f"  `BimEmitter.cs`-ийн `Dir` шинж чанар өөрчлөгдсөн байна — "
            f"check_emitter.py-ийн DIR_PATTERN-ыг ЗАСААД дахин ажиллуул.\n"
            f"  Ингэхгүй бол харнесс өөр код шалгаад ногоон болно."
        )
    (proj / REAL_PATCHED).write_text(patched, encoding="utf-8")

    for name in ("Stubs.cs", "Program.cs"):
        shutil.copyfile(HARNESS_SRC / name, proj / name)

    out = workdir / "out"
    cmd = [
        "dotnet", "build", str(proj / "bimcheck.csproj"),
        "-c", "Release", "-o", str(out), "--nologo", "-v", "q",
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                       errors="replace", timeout=600)
    if r.returncode != 0:
        sys.exit("ЗОГСЛОО: эмхэтгэл унав\n" + (r.stdout or "") + (r.stderr or ""))

    exe = out / ("bimcheck.exe" if os.name == "nt" else "bimcheck")
    if not exe.exists():
        sys.exit(f"ЗОГСЛОО: {exe} үүсээгүй")
    return exe


# ============================================================================
#  ГҮЙЛТИЙН ОРЧИН
# ============================================================================

class Case:
    """Нэг тестийн тусгаарлагдсан хавтас + сүлжээний удирдлага."""

    def __init__(self, exe: Path, root: Path, name: str) -> None:
        self.exe = exe
        self.name = name
        self.base = root / name
        self.dir = self.base / "appdata"
        self.ctl = self.base / "ctl"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.ctl.mkdir(parents=True, exist_ok=True)
        self.net("up")
        self.runs: list[str] = []

    def net(self, mode: str) -> None:
        (self.ctl / "net.txt").write_text(mode, encoding="utf-8")

    # ── гүйлт ────────────────────────────────────────────────────────────
    def argv(self, run_id: str, **kw) -> list[str]:
        a = [str(self.exe), "--dir", str(self.dir), "--ctl", str(self.ctl),
             "--run-id", run_id]
        for k, v in kw.items():
            flag = "--" + k.replace("_", "-")
            if v is True:
                a.append(flag)
            elif v is False or v is None:
                continue
            else:
                a += [flag, str(v)]
        return a

    def run(self, run_id: str, timeout: float | None = None, **kw) -> dict:
        self.runs.append(run_id)
        argv = self.argv(run_id, **kw)
        budget = timeout or (int(kw.get("run_ms", 1500)) / 1000.0 + 90)
        t0 = time.time()
        p = subprocess.run(argv, capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=budget)
        return {"rc": p.returncode, "out": p.stdout, "err": p.stderr,
                "wall": time.time() - t0, "run_id": run_id}

    def spawn(self, run_id: str, **kw) -> subprocess.Popen:
        self.runs.append(run_id)
        return subprocess.Popen(self.argv(run_id, **kw), stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True,
                                encoding="utf-8", errors="replace")

    # ── нотолгоо унших ───────────────────────────────────────────────────
    def attempts(self, run_ids: list[str] | None = None) -> list[dict]:
        out: list[dict] = []
        for rid in (run_ids if run_ids is not None else self.runs):
            p = self.ctl / f"attempts-{rid}.jsonl"
            if not p.exists():
                continue
            for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except Exception:  # noqa: BLE001
                    pass
        return out

    def delivered(self, run_ids: list[str] | None = None) -> tuple[Counter, Counter]:
        txn, ev = Counter(), Counter()
        for rec in self.attempts(run_ids):
            if not rec.get("delivered"):
                continue
            b = rec.get("body")
            if not isinstance(b, dict):
                continue
            for t in b.get("transactions") or []:
                if t.get("txn_uid"):
                    txn[t["txn_uid"]] += 1
            for e in b.get("events") or []:
                if e.get("event_uid"):
                    ev[e["event_uid"]] += 1
        return txn, ev

    def log_files(self) -> list[Path]:
        return sorted(self.dir.glob("bim-events*.jsonl"))

    def cursor_files(self) -> list[Path]:
        return sorted(self.dir.glob("bim-events*.cursor"))

    def session_files(self) -> list[Path]:
        return sorted(self.dir.glob("bim-sessions*.json"))

    def disk_raw(self) -> list[str]:
        out: list[str] = []
        for p in self.log_files():
            out += p.read_text(encoding="utf-8", errors="replace").splitlines()
        return [ln for ln in out if ln.strip()]

    def disk_parsed(self) -> tuple[list[dict], int]:
        """(зөв мөрүүд, эвдэрсэн мөрийн тоо)."""
        good, bad = [], 0
        for ln in self.disk_raw():
            try:
                good.append(json.loads(ln))
            except Exception:  # noqa: BLE001
                bad += 1
        return good, bad

    def disk_txn_uids(self) -> set[str]:
        good, _ = self.disk_parsed()
        return {o["b"]["txn_uid"] for o in good
                if o.get("t") == "txn" and isinstance(o.get("b"), dict)
                and o["b"].get("txn_uid")}

    def disk_ns(self) -> set[int]:
        good, _ = self.disk_parsed()
        return {int(o["n"]) for o in good if isinstance(o.get("n"), int)}

    def status(self, run_id: str) -> dict:
        p = self.ctl / f"status-{run_id}.json"
        if not p.exists():
            return {}
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            return {}

    def total_bytes(self) -> int:
        return sum(p.stat().st_size for p in self.log_files())

    # ── POST-ын биен доторх `session.perf` (0226-ийн `perf_json`) ────────
    def perf_blocks(self, run_ids: "list[str] | None" = None) -> "list[dict]":
        """Илгээгдсэн БҮХ (оролдсон) биеийн `session.perf` объектууд.

        ⚠️ `delivered` -ээр ШҮҮХГҮЙ: биеийг угсарсан эсэх нь чухал, сүлжээ
           хүлээж авсан эсэх нь ЭНД биш."""
        out: list[dict] = []
        for rec in self.attempts(run_ids):
            b = rec.get("body")
            if not isinstance(b, dict):
                continue
            ses = b.get("session")
            if not isinstance(ses, dict):
                continue
            perf = ses.get("perf")
            if isinstance(perf, dict):
                out.append(perf)
        return out

    def perf_sub(self, key: str, field: str,
                 run_ids: "list[str] | None" = None) -> "list[int]":
        vals: list[int] = []
        for perf in self.perf_blocks(run_ids):
            blk = perf.get(key)
            if isinstance(blk, dict) and isinstance(blk.get(field), int):
                vals.append(blk[field])
        return vals


def clean(res: dict) -> tuple[bool, str]:
    """Процесс эрүүл дууссан уу (UI рүү алдаа шидээгүй үү)."""
    err = (res.get("err") or "").strip()
    ok = res["rc"] == 0 and not err
    return ok, f"rc={res['rc']} wall={res['wall']:.1f}s stderr={err[:400]!r}"


# ============================================================================
#  T0 — СТАТИК ГЭРЭЭ
# ============================================================================

def t0_static(_exe: Path, _root: Path) -> None:
    src = (ADDIN / REAL_PATCHED).read_text(encoding="utf-8")
    hits = [w for w in FORBIDDEN if w in src]
    REPORT.add("T0", "BimEmitter нь UI / Revit-ийн төрөлд хүрэхгүй",
               not hits, f"олдсон: {hits}" if hits else "хориотой 6 нэрийн 0 нь олдов")


# ============================================================================
#  T1 — ПРОЦЕСС ДУНД НЬ УНАХ → ЯГ НЭГ УДАА ХҮРГЭХ
# ============================================================================

def t1_restart(exe: Path, root: Path) -> None:
    c = Case(exe, root, "T1")
    N = 60

    # (a) Сүлжээ унтарсан үед 60 гүйлгээ → дараа нь TerminateProcess.
    c.net("down")
    a = c.run("a", emit=N, touches=4, run_ms=3000, exit="hard", timeout=90)

    disk = c.disk_txn_uids()
    REPORT.add("T1", "унасан процессын дараалал ДИСКЭН дээр бүрэн үлдэв",
               len(disk) == N,
               f"түлхсэн={N} дискэнд={len(disk)} файл={[p.name for p in c.log_files()]} "
               f"хэмжээ={c.total_bytes()}B")

    # (b) Сүлжээ сэргэв → шавхагдах ёстой.
    c.net("up")
    b = c.run("b", emit=0, run_ms=6000, exit="graceful", timeout=90)
    okb, det = clean(b)

    txn, ev = c.delivered(["b"])
    missing = disk - set(txn)
    dupes = {k: v for k, v in txn.items() if v > 1}
    REPORT.add("T1", "дахин асаахад БҮГД илгээгдэв, ЯГ НЭГ УДАА",
               not missing and not dupes,
               f"хүргэгдсэн={len(txn)} дутуу={len(missing)} давхардсан={len(dupes)} "
               f"үйл явдал={len(ev)} (SESSION_START сайдкараас сэргэв)")

    # (c) Гурав дахь асаалт — ДАХИН илгээх ЁСГҮЙ (курсорын гэрээ).
    d = c.run("c", emit=0, run_ms=4000, exit="graceful", timeout=90)
    txn3, ev3 = c.delivered(["c"])
    REPORT.add("T1", "гурав дахь асаалтад дахин илгээхгүй (курсор ажиллав)",
               len(txn3) == 0,
               f"дахин илгээгдсэн txn={len(txn3)} event={len(ev3)} "
               f"курсор={[p.read_text(encoding='utf-8', errors='replace') for p in c.cursor_files()]}")

    REPORT.add("T1", "гурван асаалтын аль нь ч алдаа шидээгүй",
               okb and clean(d)[0], det)


# ============================================================================
#  T2 — СҮЛЖЭЭ УДААН УНАСАН: BACKOFF + ТАСЛУУР + СЭРГЭЛТ
# ============================================================================

def t2_backoff(exe: Path, root: Path, slow: bool) -> None:
    # (a) BackoffMs = {2,4,8,16,32,60}s ба 5 алдааны дараа таслуур 5 минут.
    #     Таслуургүй бол 6 дахь оролдлого t≈62s дээр гарна; таслууртай бол
    #     t≈330s.  75 секунд ажиллуулж 5-аас илүү оролдлого гарсан эсэхээр
    #     таслуур НЭЭГДСЭНИЙГ шууд хэмжинэ.
    c = Case(exe, root, "T2a")
    c.net("down")
    res = c.run("a", emit=10, touches=4, run_ms=75000, exit="graceful", timeout=180)
    at = [r["ms"] for r in c.attempts(["a"])]
    gaps = [round((at[i + 1] - at[i]) / 1000.0, 1) for i in range(len(at) - 1)]
    want = [2, 4, 8, 16]
    gaps_ok = (len(gaps) >= 4 and
               all(abs(gaps[i] - want[i]) <= 1.3 for i in range(4)))
    REPORT.add("T2", "backoff шат 2/4/8/16 сек яг ажиллав",
               gaps_ok, f"оролдлогууд(мс)={at}\nзавсрууд(сек)={gaps}")
    REPORT.add("T2", "5 дараалсан алдааны дараа таслуур НЭЭГДЭВ (75с-д 6 дахь оролдлого гараагүй)",
               len(at) == 5, f"75 секундэд {len(at)} оролдлого (5 хүлээгдэж байсан)")

    # (b) Таслуур нээгдэхээс ӨМНӨ сүлжээ сэргэвэл шууд шавхагдана.
    c2 = Case(exe, root, "T2b")
    c2.net("down")
    p = c2.spawn("b", emit=40, touches=4, run_ms=30000, exit="graceful")
    time.sleep(12.0)
    c2.net("up")
    try:
        p.wait(timeout=120)
    except subprocess.TimeoutExpired:
        p.kill()
    txn, _ = c2.delivered(["b"])
    disk_all = c2.disk_txn_uids()
    lost = {f"seq{i}" for i in range(0)}  # тайлбарын төлөө
    covered = len(txn) >= 40
    REPORT.add("T2", "сүлжээ сэргэхэд буферлэсэн бүх мөр шавхагдав",
               covered and not any(v > 1 for v in txn.values()),
               f"түлхсэн=40 хүргэгдсэн={len(txn)} давхардсан="
               f"{sum(1 for v in txn.values() if v > 1)} дискэнд үлдсэн={len(disk_all)}")

    if slow:
        # (c) Таслуурын СЭРГЭЛТ — 5 минутын шалгах хүсэлт.
        c3 = Case(exe, root, "T2c")
        c3.net("down")
        p3 = c3.spawn("c", emit=10, touches=4, run_ms=350000, exit="graceful")
        time.sleep(60)
        c3.net("up")
        try:
            p3.wait(timeout=420)
        except subprocess.TimeoutExpired:
            p3.kill()
        txn3, _ = c3.delivered(["c"])
        REPORT.add("T2", "таслуур нээгдсэний дараа 5 минутын шалгалтаар СЭРГЭВ",
                   len(txn3) >= 10, f"хүргэгдсэн={len(txn3)}")


# ============================================================================
#  T3 — ДАРААЛАЛ ДҮҮРЭХ: ТООЛОГДСОН УУ, ЧИМЭЭГҮЙ ҮҮ
# ============================================================================

def t3_overflow(exe: Path, root: Path) -> None:
    # (a) Шавхагчгүйгээр 10 000 мөр түлхэх → 4096 багтаж, 5904 хаягдана.
    c = Case(exe, root, "T3a")
    res = c.run("a", enqueue_raw=10000, no_start=True, run_ms=300, exit="none",
                timeout=90)
    st = c.status("a")
    pending, dropped = st.get("pending"), st.get("dropped")
    REPORT.add("T3", "дараалал дүүрэхэд мөр ХАЯГДАЖ, ТООЛОГДОНО (чимээгүй биш)",
               pending == 4096 and dropped == 10000 - 4096,
               f"pending={pending} (4096 хүлээв) dropped={dropped} (5904 хүлээв)")

    # (b) Тоолуур нь POST-ын `session.dropped_count`-д ХҮРЭХ ЁСТОЙ.
    c2 = Case(exe, root, "T3b")
    c2.net("up")
    c2.run("b", emit=20, touches=4, inject_dropped=777, run_ms=5000,
           exit="graceful", timeout=90)
    seen = []
    for rec in c2.attempts(["b"]):
        b = rec.get("body")
        if isinstance(b, dict) and isinstance(b.get("session"), dict):
            seen.append(b["session"].get("dropped_count"))
    REPORT.add("T3", "хаягдлын тоо серверт `session.dropped_count`-оор мэдэгдэнэ",
               bool(seen) and max(x for x in seen if x is not None) >= 777,
               f"илгээгдсэн dropped_count утгууд={seen}")


# ============================================================================
#  T4 — ЭВДЭРСЭН КУРСОР / ТАСАРСАН JSONL (ЦАХИЛГААН ТАСАРСАН)
# ============================================================================

def _seed(c: Case, n: int, run_id: str = "seed", touches: int = 4) -> None:
    c.net("down")
    c.run(run_id, emit=n, touches=touches, run_ms=3500, exit="graceful", timeout=90)


def t4_corruption(exe: Path, root: Path) -> None:
    # (a) Курсор нь ХОГ текст.
    c = Case(exe, root, "T4a")
    _seed(c, 20)
    for p in c.cursor_files():
        p.write_text("!!!not-a-number!!!", encoding="utf-8")
    if not c.cursor_files():           # курсор хараахан бичигдээгүй бол үүсгэнэ
        (c.dir / "bim-events.cursor").write_text("!!!", encoding="utf-8")
    before = c.disk_txn_uids()
    c.net("up")
    r = c.run("a", emit=0, run_ms=5000, exit="graceful", timeout=90)
    txn, _ = c.delivered(["a"])
    REPORT.add("T4", "хог курсорыг үл тоож БҮХ мөрийг сэргээв",
               set(before) <= set(txn) and clean(r)[0],
               f"дискэнд={len(before)} хүргэгдсэн={len(txn)} {clean(r)[1]}")

    # (b) Курсор ХООСОН (Delete→Move-ийн хооронд унасныг дуурайв).
    c2 = Case(exe, root, "T4b")
    _seed(c2, 20)
    for p in c2.cursor_files():
        p.write_text("", encoding="utf-8")
    before2 = c2.disk_txn_uids()
    c2.net("up")
    r2 = c2.run("a", emit=0, run_ms=5000, exit="graceful", timeout=90)
    txn2, _ = c2.delivered(["a"])
    REPORT.add("T4", "хоосон курсор нь fail-safe (алдагдалгүй, давхардал зөвшөөрөгдөнө)",
               set(before2) <= set(txn2) and clean(r2)[0],
               f"дискэнд={len(before2)} хүргэгдсэн={len(txn2)}")

    # (c) ТАСАРСАН СҮҮЛИЙН МӨР — цахилгаан бичилтийн дунд тасарсан.
    c3 = Case(exe, root, "T4c")
    _seed(c3, 20)
    log = c3.log_files()[0]
    raw = log.read_bytes()
    cut = raw.rstrip(b"\n")
    cut = cut[: len(cut) - 40]          # сүүлийн мөрийг ХАГАСАЛНА
    log.write_bytes(cut)
    good_after_cut, bad = c3.disk_parsed()
    survivors = {o["b"]["txn_uid"] for o in good_after_cut
                 if o.get("t") == "txn" and o.get("b", {}).get("txn_uid")}
    c3.net("up")
    r3 = c3.run("a", emit=0, run_ms=5000, exit="graceful", timeout=90)
    txn3, _ = c3.delivered(["a"])
    REPORT.add("T4", "тасарсан сүүлийн мөр нь бүх бүртгэлийг УСТГАХГҮЙ",
               survivors and set(survivors) <= set(txn3) and clean(r3)[0],
               f"тасралтын дараа бүтэн={len(survivors)} эвдэрсэн={bad} "
               f"хүргэгдсэн={len(txn3)} {clean(r3)[1]}")

    # (d) ЗАЛГАГДСАН МӨР — тасарсан мөрийн ард шинэ бичилт нааагдана.
    c4 = Case(exe, root, "T4d")
    _seed(c4, 20)
    log4 = c4.log_files()[0]
    raw4 = log4.read_bytes().rstrip(b"\n")
    log4.write_bytes(raw4[: len(raw4) - 40])    # шинэ мөр наалдана
    c4.net("down")
    c4.run("b", emit=10, touches=4, run_ms=3500, exit="graceful", timeout=90)
    good4, bad4 = c4.disk_parsed()
    on_disk4 = {o["b"]["txn_uid"] for o in good4
                if o.get("t") == "txn" and o.get("b", {}).get("txn_uid")}
    c4.net("up")
    r4 = c4.run("c", emit=0, run_ms=6000, exit="graceful", timeout=90)
    txn4, _ = c4.delivered(["c"])
    lost = on_disk4 - set(txn4)
    REPORT.add("T4", "залгагдсан мөрийн дараа ҮЛДСЭН бүх мөр хүргэгдэв",
               not lost and clean(r4)[0],
               f"дискэн дээр бүтэн={len(on_disk4)} эвдэрсэн мөр={bad4} "
               f"хүргэгдсэн={len(txn4)} алдагдсан={len(lost)}\n"
               f"(эвдэрсэн мөр бүр = ЯГ 1 үйл явдлын алдагдал — JSONL-ийн "
               f"залгалтын угийн шинж)")


# ============================================================================
#  T5 — 2 MB НЯГТРАЛТ: БАТАЛГААЖААГҮЙ МӨРИЙГ ХЭЗЭЭ Ч ХАЯХГҮЙ
# ============================================================================

def t5_compaction(exe: Path, root: Path) -> None:
    # (a) 1-р асаалт: бүх мөр баталгаажина, файл 2 MB давна.
    #     2-р асаалт: сүлжээгүй, шинэ мөр нэмнэ → нягтралт ажиллана.
    c = Case(exe, root, "T5a")
    c.net("up")
    c.run("a", emit=1600, touches=24, emit_chunk=150, emit_delay_ms=90,
          run_ms=20000, exit="graceful", timeout=180)
    txn_a, _ = c.delivered(["a"])

    c.net("down")
    c.run("b", emit=400, touches=24, emit_chunk=150, emit_delay_ms=90,
          run_ms=12000, exit="graceful", timeout=180)
    on_disk = c.disk_txn_uids()
    unconfirmed_b = {u for u in on_disk if u not in txn_a}

    c.net("up")
    c.run("c", emit=0, run_ms=15000, exit="graceful", timeout=180)
    txn_c, _ = c.delivered(["c"])

    lost = unconfirmed_b - set(txn_c)
    a_missing = {u for u in txn_a if u} - set(txn_a)
    REPORT.add("T5", "нягтралт нь БАТАЛГААЖААГҮЙ мөрийг хаядаггүй",
               not lost,
               f"1-р асаалтад хүргэгдсэн={len(txn_a)} 2-р асаалтад дискэнд "
               f"баталгаажаагүй={len(unconfirmed_b)} 3-р асаалтад хүргэгдсэн={len(txn_c)} "
               f"АЛДАГДСАН={len(lost)}")
    REPORT.add("T5", "нягтралт нь баталгаажсан мөрийг үнэхээр хаяж файлыг жижигрүүлэв",
               c.total_bytes() < 2 * 1024 * 1024 or not txn_a,
               f"эцсийн файлын хэмжээ={c.total_bytes()}B (2 MB хязгаар)")

    # (b) MaxUnsent-ээс ДЭЭШ: дискэнд байгаа ч санах ойд АЧААЛААГҮЙ мөрүүд.
    #     ⚠️ Энэ бол «нягтралт нь `unsent`-ээс БҮТЭН ДАХИН БИЧДЭГ» гэсэн
    #        загварын шууд үр дагавар.  20 000-аас дээш баталгаажаагүй мөр
    #        (сүлжээгүй бүтэн өдрийн ажил) бүрэн бодитой.
    c2 = Case(exe, root, "T5b")
    _seed(c2, 1, touches=2)
    good, _ = c2.disk_parsed()
    tmpl = next((o for o in good if o.get("t") == "txn"), None)
    if tmpl is None:
        REPORT.add("T5", "MaxUnsent-ээс дээш мөр (үрийн гүйлт бүтэлгүйтэв)", False, "")
        return
    sess = tmpl["s"]
    lines = [json.dumps(o, ensure_ascii=False, separators=(",", ":"))
             for o in good if o.get("t") != "txn"]     # SESSION_* мөрүүдийг үлдээнэ
    TOTAL = 20500
    for n in range(2, 2 + TOTAL):
        o = json.loads(json.dumps(tmpl))
        o["n"] = n
        o["b"]["txn_uid"] = f"{sess}:{n}"
        o["b"]["seq"] = n
        for t in o["b"].get("touches", []):
            t["txn_uid"] = o["b"]["txn_uid"]
        lines.append(json.dumps(o, ensure_ascii=False, separators=(",", ":")))
    log = c2.log_files()[0]
    log.write_text("\n".join(lines) + "\n", encoding="utf-8")
    for p in c2.cursor_files():
        p.write_text("1", encoding="utf-8")
    if not c2.cursor_files():
        (c2.dir / "bim-events.cursor").write_text("1", encoding="utf-8")

    tail_ns = set(range(2 + 20000, 2 + TOTAL))       # ачаалагдахгүй сүүл
    size_before = c2.total_bytes()
    c2.net("up")
    r = c2.run("big", emit=0, run_ms=25000, exit="graceful", timeout=240)
    txn, _ = c2.delivered(["big"])
    delivered_ns = {int(u.split(":")[-1]) for u in txn if u.split(":")[-1].isdigit()}
    still_on_disk = c2.disk_ns()
    vanished = {n for n in tail_ns if n not in delivered_ns and n not in still_on_disk}
    st = c2.status("big")
    REPORT.add("T5", "MaxUnsent-ээс дээш дискэн дээрх мөр нягтралтад устдаггүй",
               not vanished,
               f"файл={size_before}B → {c2.total_bytes()}B; сүүлийн {len(tail_ns)} мөрөөс "
               f"АЛГА БОЛСОН={len(vanished)} (хүргэгдээгүй БАС дискэнд алга)\n"
               f"dropped тоолуур={st.get('dropped')} — эдгээр нь тоологдсон ч үгүй бол ЧИМЭЭГҮЙ")


# ============================================================================
#  T6 — НЭГ PC ДЭЭР ХОЁР REVIT (нэг %APPDATA%)
# ============================================================================

def t6_concurrent(exe: Path, root: Path) -> None:
    c = Case(exe, root, "T6")
    c.net("up")
    N = 300
    p1 = c.spawn("p1", emit=N, touches=4, emit_chunk=60, emit_delay_ms=90,
                 run_ms=16000, exit="graceful")
    p2 = c.spawn("p2", emit=N, touches=4, emit_chunk=60, emit_delay_ms=90,
                 run_ms=16000, exit="graceful")
    errs = []
    for p, tag in ((p1, "p1"), (p2, "p2")):
        try:
            o, e = p.communicate(timeout=180)
        except subprocess.TimeoutExpired:
            p.kill()
            o, e = p.communicate()
        if p.returncode != 0 or (e or "").strip():
            errs.append(f"{tag}: rc={p.returncode} err={(e or '').strip()[:300]}")

    # Гуравдахь асаалт — үлдсэн бүхнийг шавхана.
    c.run("p3", emit=0, run_ms=15000, exit="graceful", timeout=120)

    txn, _ = c.delivered()
    expect = {f"doc-p1", f"doc-p2"}  # тайлбарын төлөө
    st1, st2 = c.status("p1"), c.status("p2")
    dropped = (st1.get("dropped") or 0) + (st2.get("dropped") or 0)
    on_disk = c.disk_txn_uids()
    delivered_set = set(txn)
    # Хоёр процесс тус бүр N гүйлгээ ҮҮСГЭСЭН.  Тэдгээр нь ЛИБО хүргэгдсэн,
    # ЛИБО дискэн дээр байх ЁСТОЙ.
    accounted = len(delivered_set | on_disk)
    dupes = sum(1 for v in txn.values() if v > 1)
    REPORT.add("T6", "хоёр процесс нэг %APPDATA%-г хуваалцахад мөр АЛДАГДАХГҮЙ",
               accounted >= 2 * N,
               f"үүсгэсэн={2 * N} хүргэгдсэн={len(delivered_set)} дискэнд={len(on_disk)} "
               f"нийт бүртгэгдсэн={accounted} АЛДАГДСАН={2 * N - accounted} "
               f"давхардсан={dupes} dropped тоолуур={dropped}")
    REPORT.add("T6", "хоёр процессын аль нь ч алдаа шидээгүй",
               not errs, "\n".join(errs) if errs else "хоёулаа rc=0, stderr хоосон")

    # ── (b) ХАМГИЙН ХУРЦ ХУВИЛБАР ────────────────────────────────────────
    # ⚠️ (a) нь сүлжээ БҮТЭН ажиллаж байсан тул дискний зөрчил ХАРАГДАХГҮЙ —
    #    мөрүүд санах ойноос шууд хүргэгдсэн.  Жинхэнэ эрсдэл нь: хоёр Revit
    #    ОФФЛАЙН ажиллаж, БҮГД ганц `bim-events.jsonl` / `.cursor` /
    #    `bim-sessions.json` рүү бичээд, дараа нь ДАХИН АСААХАД илэрнэ.
    c2 = Case(exe, root, "T6b")
    c2.net("down")
    q1 = c2.spawn("q1", emit=N, touches=4, emit_chunk=60, emit_delay_ms=90,
                  run_ms=14000, exit="graceful")
    q2 = c2.spawn("q2", emit=N, touches=4, emit_chunk=60, emit_delay_ms=90,
                  run_ms=14000, exit="graceful")
    for p in (q1, q2):
        try:
            p.communicate(timeout=180)
        except subprocess.TimeoutExpired:
            p.kill()
            p.communicate()

    on_disk2 = c2.disk_txn_uids()
    sess_files = c2.session_files()
    headers = []
    for sp in sess_files:
        try:
            headers += [h.get("SessionUid") for h in json.loads(
                sp.read_text(encoding="utf-8", errors="replace"))]
        except Exception:  # noqa: BLE001
            pass
    REPORT.add("T6", "оффлайн хоёр процессын мөр БҮГД дискэнд хүрэв",
               len(on_disk2) == 2 * N,
               f"үүсгэсэн={2 * N} дискэнд={len(on_disk2)} "
               f"алдагдсан={2 * N - len(on_disk2)} (AppendAllText-ийн хуваалцлын зөрчил)")
    REPORT.add("T6", "хоёр сессийн ТОЛГОЙ хоёулаа сайдкарт үлдэв",
               len(set(h for h in headers if h)) >= 2,
               f"сайдкар файл={[p.name for p in sess_files]} толгой={headers}\n"
               f"(толгойгүй сесс = тэр сессийн БҮХ мөр `_dropped`-д хаягдана)")

    # Гуравдахь асаалт — сүлжээ сэргэв, бүх зүйл шавхагдах ЁСТОЙ.
    c2.net("up")
    c2.run("q3", emit=0, run_ms=25000, exit="graceful", timeout=180)
    txn2, _ = c2.delivered(["q3"])
    left = c2.disk_txn_uids()
    accounted2 = len(set(txn2) | left)
    st3 = c2.status("q3")
    REPORT.add("T6", "оффлайн хоёр процессын дараа ДАХИН АСААХАД мөр алдагдахгүй",
               accounted2 >= 2 * N,
               f"үүсгэсэн={2 * N} хүргэгдсэн={len(txn2)} дискэнд үлдсэн={len(left)} "
               f"нийт={accounted2} АЛДАГДСАН={2 * N - accounted2} "
               f"dropped тоолуур={st3.get('dropped')}")


# ============================================================================
#  T7 — ДИСК БИЧИГДЭХГҮЙ / ЭРХГҮЙ ХАВТАС
# ============================================================================

def t7_disk(exe: Path, root: Path) -> None:
    # (a) `Dir` нь ФАЙЛ — `Directory.CreateDirectory` БҮР удаа унана.
    base = root / "T7a"
    base.mkdir(parents=True, exist_ok=True)
    ctl = base / "ctl"
    ctl.mkdir(exist_ok=True)
    blocked = base / "appdata"
    blocked.write_text("энэ бол хавтас БИШ, файл", encoding="utf-8")
    (ctl / "net.txt").write_text("up", encoding="utf-8")

    argv = [str(exe), "--dir", str(blocked), "--ctl", str(ctl), "--run-id", "a",
            "--emit", "50", "--touches", "4", "--run-ms", "6000",
            "--exit", "graceful", "--join-ms", "400"]
    t0 = time.time()
    p = subprocess.run(argv, capture_output=True, text=True, encoding="utf-8",
                       errors="replace", timeout=120)
    wall = time.time() - t0

    txn = Counter()
    ap = ctl / "attempts-a.jsonl"
    if ap.exists():
        for line in ap.read_text(encoding="utf-8", errors="replace").splitlines():
            if not line.strip():
                continue
            try:
                rec = json.loads(line)
            except Exception:  # noqa: BLE001
                continue
            if not rec.get("delivered"):
                continue
            for t in (rec.get("body") or {}).get("transactions") or []:
                if t.get("txn_uid"):
                    txn[t["txn_uid"]] += 1

    REPORT.add("T7", "бичигдэхгүй хавтас дээр ЧИМЭЭГҮЙ доройтоно (алдаа шидэхгүй)",
               p.returncode == 0 and not (p.stderr or "").strip(),
               f"rc={p.returncode} wall={wall:.1f}s stderr={(p.stderr or '').strip()[:300]!r}")
    REPORT.add("T7", "диск бичигдэхгүй ч САНАХ ОЙНООС илгээсээр байна",
               len(txn) >= 50,
               f"хүргэгдсэн={len(txn)} / 50 (сайдкар байхгүй ч сесс амьд байгаа тул толгой санах ойд байна)")
    REPORT.add("T7", "унтраалт хурдан (Revit-ийн хаагдалт гацахгүй)",
               wall < 6.0 + 4.0, f"нийт {wall:.1f}s (түлхэлт+6с ажиллагаа+унтраалт)")

    # ── ОЛОЛТ B ──────────────────────────────────────────────────────────
    # ⚠️ ЯАГААД ДЭЭРХ ХОЁР БАТЛАМЖ ХҮРЭЛЦЭХГҮЙ ВЭ.  Тэд «доройтол ажиллаж
    #    байна» гэдгийг л батлана — ЯГ ТЭР нь алдааг НУУДАГ шинж чанар:
    #    санах ойгоос бүх мөр хүргэгдсэн тул сервер тал БҮРЭН ЭРҮҮЛ
    #    харагдана.  Хэрэв энэ агшинд Revit унавал (эсвэл сүлжээ БАС
    #    унасан бол) `%APPDATA%` бичигдэхгүй тул БҮГД алга болно, аль ч
    #    талд НЭГ Ч тоолуургүй.  Доорх хоёр батламж нь ТООЛУУР байгаа
    #    эсэхийг, ба тэр нь СЕРВЕРТ ХҮРЭХ эсэхийг хэмжинэ.
    st7 = {}
    sp = ctl / "status-a.json"
    if sp.exists():
        try:
            st7 = json.loads(sp.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            st7 = {}

    REPORT.add("T7", "диск бичигдэхгүй нь ТООЛОГДОНО (чимээгүй биш)",
               (st7.get("disk_fail") or 0) >= 1 and (st7.get("disk_fail_lines") or 0) >= 1,
               f"disk_fail={st7.get('disk_fail')} disk_fail_lines={st7.get('disk_fail_lines')} "
               f"disk_lost={st7.get('disk_lost')} dropped={st7.get('dropped')}\n"
               f"(0 бол `AppendLines` нь ХООСОН `catch {{}}` руу буцсан гэсэн үг)")

    perf_fail: list[int] = []
    ap2 = ctl / "attempts-a.jsonl"
    if ap2.exists():
        for line in ap2.read_text(encoding="utf-8", errors="replace").splitlines():
            if not line.strip():
                continue
            try:
                rec = json.loads(line)
            except Exception:  # noqa: BLE001
                continue
            ses = ((rec.get("body") or {}).get("session") or {})
            disk = (ses.get("perf") or {}).get("disk")
            if isinstance(disk, dict) and isinstance(disk.get("fail_writes"), int):
                perf_fail.append(disk["fail_writes"])

    REPORT.add("T7", "дискний бүтэлгүйтэл СЕРВЕРТ `session.perf.disk`-ээр хүрнэ",
               bool(perf_fail) and max(perf_fail) >= 1,
               f"POST-ын биен доторх perf.disk.fail_writes={perf_fail[:8]}\n"
               f"(`bim_sessions.perf_json`, 0226 — `lib/bimEvents.ts:403` нь шинэ "
               f"гүйцэтгэлийн тоог ЭНД тавихыг зааварласан)")

    # (c) УНТРААЛТЫН ЭЦСИЙН ШАВХАЛТ дискэнд унавал — ЖИНХЭНЭ АЛДАГДАЛ.
    #     `PostLoop`-ийн `finally` нь ИЖИЛ залгидаг дуудлагыг ашигладаг
    #     байсан тул диск дүүрсэн үед `Pending`-д үлдсэн БҮХ мөрийг
    #     ЧИМЭЭГҮЙ хаядаг байв.
    base3 = root / "T7c"
    ctl3 = base3 / "ctl"
    ctl3.mkdir(parents=True, exist_ok=True)
    blocked3 = base3 / "appdata"
    blocked3.write_text("энэ бол хавтас БИШ, файл", encoding="utf-8")
    (ctl3 / "net.txt").write_text("down", encoding="utf-8")
    argv3 = [str(exe), "--dir", str(blocked3), "--ctl", str(ctl3), "--run-id", "c",
             "--emit", "5", "--touches", "2", "--run-ms", "1200",
             "--enqueue-raw-late", "3000", "--exit", "graceful", "--join-ms", "2500"]
    p3 = subprocess.run(argv3, capture_output=True, text=True, encoding="utf-8",
                        errors="replace", timeout=120)
    st3 = {}
    sp3 = ctl3 / "status-c.json"
    if sp3.exists():
        try:
            st3 = json.loads(sp3.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            st3 = {}
    lost3 = st3.get("disk_lost") or 0
    REPORT.add("T7", "унтраалтын шавхалт дискэнд унавал АЛДАГДАЛ гэж тоологдоно",
               lost3 >= 1 and (st3.get("dropped") or 0) >= lost3
               and p3.returncode == 0 and not (p3.stderr or "").strip(),
               f"disk_lost={lost3} dropped={st3.get('dropped')} phase={st3.get('phase')} "
               f"rc={p3.returncode} stderr={(p3.stderr or '').strip()[:200]!r}\n"
               f"(`disk_lost` нь `dropped`-д БАС нэмэгдэх ЁСТОЙ — тэр нь "
               f"жинхэнэ алдагдал; 0 бол шавхалт ЧИМЭЭГҮЙ хаясан гэсэн үг)")

    # (b) Хавтас байгаа ч БИЧИХ ЭРХГҮЙ (icacls).  Windows дээр л утгатай.
    if os.name == "nt":
        base2 = root / "T7b"
        ctl2 = base2 / "ctl"
        ro = base2 / "appdata"
        ro.mkdir(parents=True, exist_ok=True)
        ctl2.mkdir(parents=True, exist_ok=True)
        (ctl2 / "net.txt").write_text("up", encoding="utf-8")
        user = os.environ.get("USERNAME") or ""
        denied = False
        if user:
            r = subprocess.run(["icacls", str(ro), "/deny", f"{user}:(OI)(CI)(W)"],
                               capture_output=True, text=True, errors="replace")
            denied = r.returncode == 0
        if denied:
            argv2 = [str(exe), "--dir", str(ro), "--ctl", str(ctl2), "--run-id", "b",
                     "--emit", "30", "--run-ms", "5000", "--exit", "graceful"]
            t1 = time.time()
            p2 = subprocess.run(argv2, capture_output=True, text=True,
                                encoding="utf-8", errors="replace", timeout=120)
            w2 = time.time() - t1
            subprocess.run(["icacls", str(ro), "/remove:d", user],
                           capture_output=True, text=True, errors="replace")
            REPORT.add("T7", "ACL-ээр бичих эрх хаасан хавтас дээр ч унахгүй",
                       p2.returncode == 0 and not (p2.stderr or "").strip(),
                       f"rc={p2.returncode} wall={w2:.1f}s "
                       f"stderr={(p2.stderr or '').strip()[:300]!r}")
        else:
            print("  [SKIP] T7b — icacls ажиллуулж чадсангүй")


# ============================================================================
#  T8 — ХУУЧИН ХУВИЛБАРЫН ФАЙЛЫГ ӨВЛӨХ (шинэчлэлтийн зам)
# ============================================================================

def t8_legacy(exe: Path, root: Path) -> None:
    """⚠️ 1.2.1 нь тагггүй `bim-events.jsonl` бичдэг.  Дараагийн хувилбар
    процесс тутамд өөрийн файлтай болсон тул ХУУЧИН файлыг ЗААВАЛ өвлөх
    ёстой — эс бөгөөс шинэчлэлтийн өдөр ажилтны сүүлийн офлайн ажил
    БҮРМӨСӨН алга болно."""
    c = Case(exe, root, "T8")
    c.net("down")
    c.run("seed", emit=25, touches=4, run_ms=3500, exit="graceful", timeout=90)

    before = c.disk_txn_uids()
    # Тагтай файлуудыг ХУУЧИН (тагггүй) нэр рүү буулгана.
    for src, dst in (("bim-events.*.jsonl", "bim-events.jsonl"),
                     ("bim-events.*.cursor", "bim-events.cursor"),
                     ("bim-sessions.*.json", "bim-sessions.json")):
        for p in c.dir.glob(src):
            p.rename(c.dir / dst)
    for p in c.dir.glob("bim-events.*.lock"):
        p.unlink()

    c.net("up")
    r = c.run("a", emit=0, run_ms=6000, exit="graceful", timeout=90)
    txn, _ = c.delivered(["a"])
    leftover = (c.dir / "bim-events.jsonl").exists()
    REPORT.add("T8", "хуучин хувилбарын тагггүй лог өвлөгдөж бүрэн илгээгдэв",
               before and set(before) <= set(txn) and clean(r)[0],
               f"хуучин файлд={len(before)} хүргэгдсэн={len(txn)} {clean(r)[1]}")
    REPORT.add("T8", "өвлөсний дараа хуучин файл устгагдав (дахин өвлөхгүй)",
               not leftover,
               f"bim-events.jsonl үлдсэн={leftover} файлууд="
               f"{sorted(p.name for p in c.dir.iterdir())}")

    # Дахин асаахад ДАВХАРДАХГҮЙ.
    c.run("b", emit=0, run_ms=4000, exit="graceful", timeout=90)
    txn2, _ = c.delivered(["b"])
    REPORT.add("T8", "өвлөсөн мөр дахин асаахад ДАХИН илгээгдэхгүй",
               len(txn2) == 0, f"дахин илгээгдсэн={len(txn2)}")


# ============================================================================
#  T9 — КУРСОР НЬ ИЛГЭЭГДЭЭГҮЙ МӨРИЙГ ДАВЖ УРАГШЛАХГҮЙ
# ============================================================================

def t9_cursor_guard(exe: Path, root: Path) -> None:
    """⚠️ ЯАГААД ЭНЭ ТЕСТ ОРШИХ ЁСТОЙ ВЭ (ОЛОЛТ E, 2026-09-01).

    `AdvanceCursor`-ийн «илгээгдээгүй мөрийг давахгүй» мөчлөгийг УСТГАХАД
    өмнөх 29 батламж БҮГД НОГООН хэвээр байв — өөрөөр хэлбэл тэр хамгаалалт
    БАТЛАГДААГҮЙ мэдэгдэл байсан.  Тэр нь онолын зүйл ч БИШ: `SendOneBatch`
    нь багцыг СЕССЭЭР бүлэглэдэг (өөр `session_uid` дээр `break`), 200
    гүйлгээ / 2000 `touch`-ийн хязгаараар ч тасалдаг тул `unsent`-д СҮҮЛ
    үлдэх нь ХЭВИЙН АЖИЛЛАГАА.  Хамгаалалтгүй бол курсор нь ДИСКЭНД
    БИЧИГДСЭН ХАМГИЙН ӨНДӨР `n` хүртэл үсэрч, тэр сүүлийг «баталгаажсан»
    гэж тэмдэглэнэ — дараагийн асаалт тэднийг АЛГАСНА.

    ХЭМЖИХ ЗАМ:
      * `--docs 3` → ГУРВАН сесс, мөрүүд ээлжилнэ → `SendOneBatch` нь
        сесс солигдох БҮРД тасална (нэг багцад 2 мөр).
      * `down-after:3` → ЭХНИЙ ГУРВАН POST амжилттай (курсор урагшилна),
        дараа нь сүлжээ УНАНА → үлдсэн ~234 мөр `unsent`-д ба ДИСКЭН дээр.
      * Дахин асаах → БҮХ мөр хүргэгдэх ЁСТОЙ.
    Хамгаалалтгүй бол эхний амжилттай POST-ийн дараа курсор нь `_maxAppended`
    (=200, дараа нь 240) болж, дахин асаахад бараг БҮГД алга болно.
    """
    # ⚠️ N НЬ ЖИЖИГ БАЙХ ЁСТОЙ.  Гурван сесс ээлжлэх нь POST тутамд ~2 мөр
    #    гэсэн үг, `PostLoop` нь эргэлт бүрд `Pending.TryTake(..., 500ms)`
    #    дээр суудаг тул шавхалт нь POST тутамд ~0.5 секунд.  240 мөр нь
    #    ~60 секунд шаардана — тест нь хамгаалалтын оронд ТЭВЧЭЭРИЙГ хэмжинэ.
    # ⚠️ N НЬ ЖИЖИГ БАЙХ ЁСТОЙ.  Гурван сесс ээлжлэх нь POST тутамд ~2 мөр
    #    гэсэн үг, `PostLoop` нь эргэлт бүрд `Pending.TryTake(..., 500ms)`
    #    дээр суудаг тул шавхалт нь POST тутамд ~0.5 секунд.  240 мөр нь
    #    ~60 секунд шаардана — тест нь хамгаалалтын оронд ТЭВЧЭЭРИЙГ хэмжинэ.
    c = Case(exe, root, "T9")
    N = 60

    c.net("down-after:3")
    r1 = c.run("a", emit=N, docs=3, touches=2, emit_chunk=N, emit_delay_ms=0,
               run_ms=6000, exit="graceful", timeout=150)

    seeded = c.disk_txn_uids()
    txn_a, ev_a = c.delivered(["a"])
    delivered_uids = set(txn_a) | set(ev_a)

    # ── МӨР БҮРИЙН `n` → uid.  SESSION_START/END нь `event_uid`, гүйлгээ нь
    #    `txn_uid`; хоёулаа курсорын нэг ХИЛЭЭР удирдагдана.
    good, _bad = c.disk_parsed()
    n_of_uid: dict[str, int] = {}
    for o in good:
        b = o.get("b")
        if not isinstance(b, dict) or not isinstance(o.get("n"), int):
            continue
        uid = b.get("txn_uid") if o.get("t") == "txn" else b.get("event_uid")
        if uid:
            n_of_uid[uid] = int(o["n"])
    undelivered_ns = {n for uid, n in n_of_uid.items() if uid not in delivered_uids}

    cursors = [q.read_text(encoding="utf-8", errors="replace")
               for q in c.cursor_files()]
    cur = -1
    for t in cursors:
        try:
            cur = max(cur, int(t.strip()))
        except Exception:  # noqa: BLE001
            pass
    max_n = max(c.disk_ns() or {0})

    REPORT.add("T9", "сесс солигдоход багц тасарч `unsent`-д СҮҮЛ үлдэв (цонх бодит)",
               len(seeded) == N and 0 < len(delivered_uids) < len(n_of_uid),
               f"дискэнд={len(seeded)}/{N} мөр={len(n_of_uid)} "
               f"эхний асаалтад хүргэгдсэн={len(delivered_uids)} "
               f"илгээгдээгүй={len(undelivered_ns)} курсор={cursors} "
               f"дискэн дэх хамгийн өндөр n={max_n}")

    # ── ШУУД ХЭМЖИЛТ (хугацаанаас ХАМААРАХГҮЙ).  Курсорын ГЭРЭЭ нь
    #    «`n <= _cursor` бүх мөр СЕРВЕР ДЭЭР байна».  Илгээгдээгүй мөрийн
    #    хамгийн бага `n` нь курсороос ЗААВАЛ ИХ байх ёстой.
    smallest_unsent = min(undelivered_ns) if undelivered_ns else None
    REPORT.add("T9", "курсор нь ИЛГЭЭГДЭЭГҮЙ хамгийн бага `n`-ээс ЦААШ гараагүй",
               smallest_unsent is not None and cur < smallest_unsent,
               f"курсор={cur} илгээгдээгүй хамгийн бага n={smallest_unsent} "
               f"дискэн дэх хамгийн өндөр n={max_n}\n"
               f"(хамгаалалтгүй бол курсор нь `_maxAppended`≈{max_n} болж, "
               f"илгээгдээгүй {len(undelivered_ns)} мөрийг «баталгаажсан» гэж "
               f"тэмдэглэнэ)")

    # ── ЭЦСИЙН НОТОЛГОО: дахин асаахад БҮГД хүргэгдэв.  Хоёр асаалт —
    #    POST тутам ~0.5с тул нэг асаалтын төсөв хүрэхгүй байж болно.
    c.net("up")
    r2 = c.run("b", emit=0, run_ms=26000, exit="graceful", timeout=180)
    r3 = c.run("c", emit=0, run_ms=26000, exit="graceful", timeout=180)
    txn_b, _ = c.delivered(["b"])
    txn_c, _ = c.delivered(["c"])
    all_txn = set(txn_a) | set(txn_b) | set(txn_c)
    lost = seeded - all_txn

    REPORT.add("T9", "дахин асаахад ИЛГЭЭГДЭЭГҮЙ мөр БҮГД сэргэв",
               not lost and clean(r1)[0] and clean(r2)[0] and clean(r3)[0],
               f"дискэнд={len(seeded)} 1-р={len(txn_a)} 2-р={len(txn_b)} "
               f"3-р={len(txn_c)} нийт={len(all_txn)} АЛДАГДСАН={len(lost)}")


# ============================================================================
#  T10 — СЕРВЕРИЙН ХАРИУГ ТУЛГАХ (200 ≠ «бүгд хүлээн авагдав»)
# ============================================================================

def t10_reconcile(exe: Path, root: Path) -> None:
    """⚠️ `POST /api/learning/events` нь 200 буцаагаад БҮХ гүйлгээг
    `rejected.txns`-д хаяж ЧАДНА (толгойгүй сесс — `learning.ts:508-509`,
    төсвийн таслалт, хэлбэрийн алдаа).  Клиент биеийг УНШИХГҮЙ бол тэр нь
    ЧИМЭЭГҮЙ өгөгдөл алдагдал."""

    # (a) ЭРҮҮЛ ЗАМ — бүх мөр хүлээн авагдвал тоолуур ТЭГ, `perf` БАЙХГҮЙ.
    c = Case(exe, root, "T10a")
    c.net("up")
    c.run("a", emit=40, touches=4, emit_chunk=20, emit_delay_ms=700,
          run_ms=6000, exit="graceful", timeout=120)
    st = c.status("a")
    perfs = c.perf_blocks(["a"])
    REPORT.add("T10", "эрүүл замд татгалзлын тоолуур ТЭГ, ХУДАЛ дохио өгөхгүй",
               (st.get("srv_rejected") or 0) == 0
               and (st.get("srv_dropped") or 0) == 0
               and (st.get("srv_unaccounted") or 0) == 0
               and not any("ingest" in x or "disk" in x for x in perfs),
               f"srv_rejected={st.get('srv_rejected')} srv_dropped={st.get('srv_dropped')} "
               f"srv_unaccounted={st.get('srv_unaccounted')} perf блок={perfs}\n"
               f"(`perf` огт бичигдэх ЁСГҮЙ — 0226-ийн NULL='ХЭМЖЭЭГҮЙ' инвариант)")

    # (b) СЕРВЕР 200 БУЦААГААД БАГЦ ТУТАМД НЭГ ГҮЙЛГЭЭГ ТАТГАЛЗАВ.
    c2 = Case(exe, root, "T10b")
    c2.net("reject-txn:1")
    c2.run("b", emit=60, touches=4, emit_chunk=20, emit_delay_ms=900,
           run_ms=8000, exit="graceful", timeout=150)
    st2 = c2.status("b")
    ing = c2.perf_sub("ingest", "rejected", ["b"])
    REPORT.add("T10", "200-ийн доторх `rejected` нь клиент талд ТООЛОГДОНО",
               (st2.get("srv_rejected") or 0) >= 1,
               f"srv_rejected={st2.get('srv_rejected')} "
               f"srv_dropped={st2.get('srv_dropped')} "
               f"srv_unaccounted={st2.get('srv_unaccounted')}\n"
               f"(0 бол `SendOneBatch` нь биеийг УНШААГҮЙ — ямар ч 2xx-ыг "
               f"«бүрэн хүлээн авав» гэж таамагласаар байна)")
    REPORT.add("T10", "татгалзал СЕРВЕРТ `session.perf.ingest`-ээр буцаж хүрнэ",
               bool(ing) and max(ing) >= 1,
               f"дараагийн POST-уудын perf.ingest.rejected={ing[:8]}")

    # (c) ТАТГАЛЗСАН МӨРӨӨС БОЛЖ ДАРААЛАЛ ТЭЭГЛЭХГҮЙ (курсор урагшилсан).
    c2.net("up")
    c2.run("c", emit=0, run_ms=5000, exit="graceful", timeout=120)
    txn_c, _ = c2.delivered(["c"])
    REPORT.add("T10", "татгалзсан мөрийг ДАХИН оролддоггүй (дараалал тээглэхгүй)",
               len(txn_c) == 0,
               f"дахин илгээгдсэн={len(txn_c)} — татгалзлын шалтгаан нь мөрийн "
               f"ӨӨРИЙНХ нь хэлбэр тул дахин илгээх нь ЯГ ИЖИЛ хариу өгнө")

    # (d) ТАНИХГҮЙ ХЭЛБЭРИЙН ХАРИУ = ӨМНӨХ ЗАН ҮЙЛ (хуучин сервер).
    #     `off` горим нь `{"accepted":null,...}` буцаана — `accepted` нь
    #     объект БИШ тул тулгалт ажиллах ЁСГҮЙ.
    c3 = Case(exe, root, "T10c")
    c3.net("off")
    c3.run("d", emit=20, touches=4, run_ms=5000, exit="graceful", timeout=120)
    st3 = c3.status("d")
    REPORT.add("T10", "танихгүй хэлбэрийн хариунд ЮУ Ч тоолохгүй (хуучин сервер)",
               (st3.get("srv_rejected") or 0) == 0
               and (st3.get("srv_unaccounted") or 0) == 0,
               f"srv_rejected={st3.get('srv_rejected')} "
               f"srv_unaccounted={st3.get('srv_unaccounted')}")

    # ── 0243-ИЙН `accounted` ГЭРЭЭ ────────────────────────────────────────
    # ⚠️ `routes/learning.ts:1076-1082`: «`accounted` — ЭНЭ Л ТАЛБАР нь
    #    мөрүүдээ устгаж болно гэсэн эрх олгоно … ⚠️ HTTP статусаар БҮҮ шийд».
    #    Тиймээс 4xx-ын ХОЁР ЯЛГААТАЙ ЗАМЫГ ЗААВАЛ ялгах ёстой.

    # (e) 422 `batch_rejected` — `accounted:true`, `retryable:false`.
    #     Сервер алдагдлыг БҮРТГЭСЭН; мөрийг хадгалбал дараалал МӨНХӨД
    #     тээглэж, түүний ард байгаа БҮХ шинэ ажил бас илгээгдэхгүй болно.
    c4 = Case(exe, root, "T10d")
    c4.net("reject-all")
    c4.run("e", emit=25, touches=4, run_ms=8000, exit="graceful", timeout=150)
    st4 = c4.status("e")
    att4 = [r for r in c4.attempts(["e"]) if r.get("code") == 422]
    c4.net("up")
    c4.run("f", emit=0, run_ms=6000, exit="graceful", timeout=120)
    txn_f, ev_f = c4.delivered(["f"])
    REPORT.add("T10", "422 `accounted:true` дээр мөрийг хаяж, дараалал тээглэхгүй",
               len(att4) >= 1 and len(txn_f) == 0 and len(ev_f) == 0,
               f"422 оролдлого={len(att4)} дараагийн асаалтад дахин илгээгдсэн "
               f"txn={len(txn_f)} event={len(ev_f)} srv_rejected={st4.get('srv_rejected')}\n"
               f"(дахин илгээгдвэл ижил 422 дахин ирж МӨНХИЙН мөчлөг үүснэ)")
    REPORT.add("T10", "422-ийн татгалзал ТООЛОГДОНО (чимээгүй хаялт биш)",
               (st4.get("srv_rejected") or 0) >= 25,
               f"srv_rejected={st4.get('srv_rejected')} (>=25 хүлээв) "
               f"srv_unaccounted={st4.get('srv_unaccounted')}")

    # (f) 409 `loss_unaccounted` — `accounted:false`, `retryable:true`.
    #     ХААНА Ч бүртгэгдээгүй ⇒ мөрүүд ЗААВАЛ ЛОКАЛД ҮЛДЭНЭ.
    c5 = Case(exe, root, "T10e")
    c5.net("no-session")
    c5.run("g", emit=25, touches=4, run_ms=8000, exit="graceful", timeout=150)
    on_disk5 = c5.disk_txn_uids()
    c5.net("up")
    c5.run("h", emit=0, run_ms=8000, exit="graceful", timeout=150)
    txn_h, _ = c5.delivered(["h"])
    REPORT.add("T10", "409 `accounted:false` дээр мөр ХАДГАЛАГДАЖ дараа илгээгдэв",
               len(on_disk5) == 25 and set(on_disk5) <= set(txn_h),
               f"дискэнд={len(on_disk5)}/25 дараагийн асаалтад хүргэгдсэн={len(txn_h)}\n"
               f"(`accounted:false` = ХААНА Ч бүртгэгдээгүй; хаявал ЧИМЭЭГҮЙ "
               f"БҮРЭН АЛДАГДАЛ — `learning.ts:1085-1090`)")


# ============================================================================
#  MAIN
# ============================================================================

TESTS = {
    "T0": lambda e, r, s: t0_static(e, r),
    "T1": lambda e, r, s: t1_restart(e, r),
    "T2": lambda e, r, s: t2_backoff(e, r, s),
    "T3": lambda e, r, s: t3_overflow(e, r),
    "T4": lambda e, r, s: t4_corruption(e, r),
    "T5": lambda e, r, s: t5_compaction(e, r),
    "T6": lambda e, r, s: t6_concurrent(e, r),
    "T7": lambda e, r, s: t7_disk(e, r),
    "T8": lambda e, r, s: t8_legacy(e, r),
    "T9": lambda e, r, s: t9_cursor_guard(e, r),
    "T10": lambda e, r, s: t10_reconcile(e, r),
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="жишээ: T1,T5")
    ap.add_argument("--slow", action="store_true", help="+ 5 минутын таслуурын сэргэлт")
    ap.add_argument("--keep", action="store_true", help="түр хавтсыг үлдээх")
    args = ap.parse_args()

    want = [t.strip().upper() for t in args.only.split(",") if t.strip()] or list(TESTS)
    bad = [t for t in want if t not in TESTS]
    if bad:
        sys.exit(f"үл мэдэгдэх тест: {bad}")

    root = Path(tempfile.mkdtemp(prefix="bimemitter-"))
    print(f"түр хавтас: {root}")
    t0 = time.time()
    try:
        exe = build(root)
        print(f"эмхэтгэв: {exe}\n")
        for name in want:
            print(f"── {name} ───────────────────────────────────────────")
            TESTS[name](exe, root, args.slow)
            print()
    finally:
        if not args.keep:
            shutil.rmtree(root, ignore_errors=True)

    total = len(REPORT.rows)
    failed = REPORT.failed
    print("=" * 72)
    print(f"НИЙТ {total} батламж — {total - failed} PASS, {failed} FAIL "
          f"({time.time() - t0:.0f}s)")
    for test, claim, ok, _ in REPORT.rows:
        if not ok:
            print(f"  FAIL  {test}  {claim}")
    print("=" * 72)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
