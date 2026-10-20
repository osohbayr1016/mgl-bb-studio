r"""ӨӨРЧЛӨЛТ НЭГТГЭГЧИЙН ШАЛГАЛТ — `addin/ChangeSetCoalescer.cs`-ийг
Revit-гүйгээр тулгана (2-4 §3.17).

Add-in-д C# ТЕСТ ТЭГ байдаг.  `ChangeSetCoalescer` нь ЦЭВЭР (Revit-ийн API-д
хүрэхгүй, диск хөндөхгүй, цагийг ӨӨРӨӨ уншихгүй — `nowMs` дуудагчаас ирнэ)
тул түүнийг ганцаар нь эмхэтгэж ажиллуулах боломжтой ЦОРЫН ГАНЦ анги юм.
`check_nudge.py`-ийн бүтцийг ҮГ ҮСГЭЭР хуулна.

⚠️ ЭНЭ ТЕСТИЙН ИХЭНХ НЬ «ХААГДАХ ЁСГҮЙ» тохиолдол.  Хугацаанаас нь ӨМНӨ
хаагдсан олонлог нь хэрэглэгчийн зурж байх дундуур Revit-ийн үндсэн thread
дээр ажил төлөвлөнө — тэр цочрол нь хүмүүсийг add-in-ыг устгахад хүргэдэг
зүйл (R7).

⚠️ `defer` нь ХААГДАНА, ГЭХДЭЭ ЦУГЛУУЛАХГҮЙ (`MayCollect = false`).  Гурав
дахь тохиолдол ЯГ ҮҮНИЙГ барина: `maxDeferMs` нь тасралтгүй ажиллаж буй
хүний дээр асдаг тул тэнд COLD ажил эхлүүлэх нь хамгийн харагдах цочрол.

    ..\..\server\.venv\Scripts\python.exe check_changeset.py
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

ADDIN = Path(__file__).resolve().parent.parent / "addin"

CSPROJ = """<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>disable</Nullable>
    <ImplicitUsings>disable</ImplicitUsings>
    <AssemblyName>changesetcheck</AssemblyName>
    <EnableSourceControlManagerQueries>false</EnableSourceControlManagerQueries>
    <EnableSourceLink>false</EnableSourceLink>
  </PropertyGroup>
  <ItemGroup>
    <Compile Include="__COALESCER__" />
  </ItemGroup>
</Project>
"""

# ⚠️ Тусгаарлагч " || " — ташуу зураас ашиглахгүй (урхи №14).
MAIN = """using System;
using System.Collections.Generic;
using RevitMcpAddin;

Console.OutputEncoding = System.Text.Encoding.UTF8;

const int SETTLE = 1200;
const int DEFER  = 15000;
const int MAXEL  = 2000;

ChangeSetCoalescer New() => new ChangeSetCoalescer(SETTLE, DEFER, MAXEL);

long[] Ids(int n, long start)
{
    var a = new long[n];
    for (int i = 0; i < n; i++) a[i] = start + i;
    return a;
}

// reason:mayCollect:elementCount:coarse:undoBurst
string Fmt(LogicalChangeSet s)
{
    if (s == null) return "null";
    return s.CloseReason + ":" + (s.MayCollect ? "1" : "0") + ":" +
           s.ElementIds.Length + ":" + (s.Coarse ? "1" : "0") + ":" + s.UndoBurst;
}

void Say(string name, LogicalChangeSet s) => Console.WriteLine(name + " || " + Fmt(s));

// 1) Ганц гүйлгээ + 1199 мс → ХААГДАХГҮЙ (намжаагүй).
{
    var c = New();
    c.Feed(1, 0, "DOC-A", Ids(1, 10), 1, false);
    Say("t01:settle_too_early", c.TryClose(1199, true));
}

// 2) Ганц гүйлгээ + 1200 мс → settle, ЦУГЛУУЛЖ БОЛНО.
{
    var c = New();
    c.Feed(1, 0, "DOC-A", Ids(1, 10), 1, false);
    Say("t02:settle", c.TryClose(1200, true));
}

// 3) 1100 мс тутам 20 гүйлгээ → 15 000 мс хүртэл null; дараа нь defer,
//    ба defer нь ЦУГЛУУЛАХГҮЙ.
{
    var c = New();
    LogicalChangeSet first = null;
    for (int i = 0; i < 20 && first == null; i++)
    {
        long t = (long)i * 1100;
        c.Feed(i + 1, t, "DOC-A", Ids(1, 100 + i), 1, false);
        first = c.TryClose(t, false);
    }
    Say("t03:defer_no_collect", first);
}

// 4) Нэг гүйлгээнд 2500 элемент → size, Coarse, id ТАЙРАГДСАН.
{
    var c = New();
    c.Feed(1, 0, "DOC-A", Ids(2500, 1), 2500, false);
    Say("t04:size_coarse", c.TryClose(1, true));
}

// 5) Хоёр өөр DocKey → хоёр ТУСДАА олонлог, ХОЛИЛДОХГҮЙ.
{
    var c = New();
    c.Feed(1, 0, "DOC-A", Ids(1, 10), 1, false);
    c.Feed(2, 0, "DOC-B", Ids(1, 20), 1, false);
    LogicalChangeSet a = c.TryClose(2000, true);
    LogicalChangeSet b = c.TryClose(2000, true);
    LogicalChangeSet none = c.TryClose(2000, true);
    string ka = a == null ? "?" : a.DocKey;
    string kb = b == null ? "?" : b.DocKey;
    Console.WriteLine("t05:two_docs || " + ka + "," + kb + "," +
                      (none == null ? "null" : "EXTRA") + "," +
                      (a == null ? -1 : a.ElementIds.Length) + "," +
                      (b == null ? -1 : b.ElementIds.Length));
}

// 6) Давхардсан id → гаралт ДАВХАРДААГҮЙ.
{
    var c = New();
    var dup = new long[] { 7, 7, 7, 8, 7 };
    c.Feed(1, 0, "DOC-A", dup, dup.Length, false);
    c.Feed(2, 10, "DOC-A", dup, dup.Length, false);
    Say("t06:dedupe", c.TryClose(1300, true));
}

// 7) 40 удаа Ctrl+Z → UndoBurst = 40, ГАНЦ олонлог.
{
    var c = New();
    for (int i = 0; i < 40; i++)
        c.Feed(i + 1, i, "DOC-A", Ids(1, 500), 1, true);
    Say("t07:undo_burst", c.TryClose(1300, true));
}

// 8) settle шалгуур хангагдсан ч `quiet:false` ⇒ ЦУГЛУУЛАХГҮЙ.
{
    var c = New();
    c.Feed(1, 0, "DOC-A", Ids(1, 10), 1, false);
    Say("t08:settle_not_quiet", c.TryClose(1500, false));
}

// 9) `Feed` дуудагдаагүй → null, онцгой байдал ҮҮСГЭХГҮЙ.
{
    var c = New();
    Say("t09:empty", c.TryClose(999999, true));
}

// 10) `nowMs` буурсан (цагийн шилжилт) → ХАЯГДАХГҮЙ, ХӨЛДӨХГҮЙ, defer.
{
    var c = New();
    c.Feed(1, 10000, "DOC-A", Ids(1, 10), 1, false);
    Say("t10:clock_backwards", c.TryClose(5000, true));
}
"""

CASES = [
    # --- ХААГДАХ ЁСГҮЙ (тестийн гол хэсэг) ---
    ("t01:settle_too_early",  "null"),
    ("t09:empty",             "null"),

    # --- хаагдах ба ЦУГЛУУЛЖ БОЛОХ ---
    ("t02:settle",            "settle:1:1:0:0"),
    ("t04:size_coarse",       "size:1:2000:1:0"),
    ("t06:dedupe",            "settle:1:2:0:0"),
    ("t07:undo_burst",        "settle:1:1:0:40"),

    # --- хаагдах ба ЦУГЛУУЛАХГҮЙ ---
    # 15 000 мс нь 1100 мс тутмын 15 дахь тэжээл дээр л давагдана
    #   (0, 1100, … 15400) — тиймээс 15 өвөрмөц id хуримтлагдана.
    ("t03:defer_no_collect",  "defer:0:15:0:0"),
    ("t08:settle_not_quiet",  "settle:0:1:0:0"),
    ("t10:clock_backwards",   "defer:0:1:0:0"),

    # --- баримт тутамд ТУСДАА олонлог ---
    ("t05:two_docs",          "DOC-A,DOC-B,null,1,1"),
]


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp)
        (d / "changesetcheck.csproj").write_text(
            CSPROJ.replace("__COALESCER__",
                           str((ADDIN / "ChangeSetCoalescer.cs").resolve())),
            encoding="utf-8")
        (d / "Program.cs").write_text(MAIN, encoding="utf-8")

        r = subprocess.run(["dotnet", "run", "--project", str(d / "changesetcheck.csproj")],
                           capture_output=True, text=True, encoding="utf-8")
        if r.returncode != 0:
            print((r.stdout or "")[-3000:], file=sys.stderr)
            print((r.stderr or "")[-3000:], file=sys.stderr)
            raise SystemExit(f"C# harness амжилтгүй (rc={r.returncode})")
        lines = [l for l in (r.stdout or "").splitlines() if " || " in l]

    got = {}
    for l in lines:
        k, v = l.rsplit(" || ", 1)
        got[k.strip()] = v.strip()

    ok = 0
    print(f"  {'тохиолдол':26} {'үр дүн':>22} {'хүлээсэн':>22}")
    print("  " + "-" * 74)
    for key, want in CASES:
        have = got.get(key, "<АЛГА>")
        good = have == want
        ok += good
        print(f"  {'✅' if good else '❌'} {key[:24]:24} {have:>22} {want:>22}")

    print(f"\n  {ok}/{len(CASES)} зөв")
    if ok < len(CASES):
        sys.exit(1)


if __name__ == "__main__":
    main()
