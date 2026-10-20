r"""ИДЭВХТЭЙ САНУУЛГЫН ШАЛГАЛТ — `addin/Nudges.cs`-ийг Revit-гүйгээр тулгана.

Сануулга бол туслахын хамгийн хямд «агент» шинж: NLU огт шаардахгүй,
Revit-ийн API-д огт хүрэхгүй.  ГЭХДЭЭ хамгийн эмзэг нь ч мөн энэ —
уйтгартай сануулга нь хүнийг add-in-ыг бүхэлд нь унтраахад хүргэнэ.

⚠️ ТИЙМЭЭС ЭНЭ ТЕСТИЙН ИХЭНХ НЬ «ЧИМЭЭГҮЙ БАЙХ ЁСТОЙ» тохиолдол.
Дүрэм ажилладаг эсэхээс илүү, ажиллах ЁСГҮЙ үедээ ЧИМЭЭГҮЙ байх нь чухал:
хүн бичиж байхад, амралтын өдөр, шөнө, өмнөх сануулгаас удаагүй, төсөв
дууссан, sync явж байхад — бүгд чимээгүй.

    ..\..\server\.venv\Scripts\python.exe check_nudge.py
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
    <AssemblyName>nudgecheck</AssemblyName>
    <EnableSourceControlManagerQueries>false</EnableSourceControlManagerQueries>
    <EnableSourceLink>false</EnableSourceLink>
  </PropertyGroup>
  <ItemGroup>
    <Compile Include="__NUDGES__" />
  </ItemGroup>
</Project>
"""

# ⚠️ Тусгаарлагч " || " — ташуу зураас ашиглахгүй (урхи №14).
MAIN = """using System;
using RevitMcpAddin;

Console.OutputEncoding = System.Text.Encoding.UTF8;

// Ажлын өдрийн 17:00 — «явц бүртгээгүй» дүрмийн цонх.
DateTime Work(int hour) => new DateTime(2026, 8, 25, hour, 0, 0);   // Даваа

Nudges.Ctx Base() => new Nudges.Ctx
{
    NowLocal = Work(17),
    IsWorkday = true,
    ChangeCount = 214,
    HasBaseline = true,
    BaselineAgeHours = 3,
    ReportedToday = false,
    UnboundSheets = 0,
    MinutesSinceOpen = 120,
    Busy = false,
    AwaitingAnswer = false,
    Suppressed = false,
    WebConnected = true,
    SecondsSinceTyping = 600,
};

void Run(string name, Action<Nudges.Ctx> tweak, Action<Nudges.State> setup)
{
    Nudges.Ctx c = Base();
    if (tweak != null) tweak(c);
    var s = new Nudges.State();
    s.RollOver(c.NowLocal);
    if (setup != null) setup(s);
    Nudges.Result r = Nudges.Pick(c, s);
    Console.WriteLine(name + " || " + (r == null ? "silent" : r.Id));
}

// ---------- Дүрэм ажиллах ёстой ----------
Run("fire:no_progress", null, null);
Run("fire:no_baseline", c => { c.HasBaseline = false; c.ChangeCount = 250; c.ReportedToday = true; }, null);
Run("fire:unbound", c => { c.ReportedToday = true; c.UnboundSheets = 5; }, null);

// ---------- ЧИМЭЭГҮЙ БАЙХ ЁСТОЙ ----------
Run("quiet:typing",      c => c.SecondsSinceTyping = 10, null);
Run("quiet:busy",        c => c.Busy = true, null);
Run("quiet:awaiting",    c => c.AwaitingAnswer = true, null);
Run("quiet:sync",        c => c.Suppressed = true, null);
Run("quiet:weekend",     c => c.IsWorkday = false, null);
Run("quiet:early",       c => c.NowLocal = Work(7), null);
Run("quiet:late",        c => c.NowLocal = Work(21), null);
Run("quiet:reported",    c => c.ReportedToday = true, null);
Run("quiet:fewchanges",  c => c.ChangeCount = 5, null);
Run("quiet:offline",     c => c.WebConnected = false, null);
Run("quiet:unbound_early", c => { c.ReportedToday = true; c.UnboundSheets = 5; c.MinutesSinceOpen = 3; }, null);

// ---------- ТӨСӨВ ----------
Run("budget:maxed", null, s => { s.SentToday = 2; s.LastSentUtc = DateTime.UtcNow.AddHours(-5); });
Run("budget:toosoon", null, s => { s.SentToday = 1; s.LastSentUtc = DateTime.UtcNow.AddMinutes(-30); });
Run("budget:gap_ok", null, s => { s.SentToday = 1; s.LastSentUtc = DateTime.UtcNow.AddMinutes(-120); });
Run("budget:already_fired", null, s => s.FiredToday.Add("no_progress_today"));

// ---------- Өдөр солигдоход тэглэгдэх ----------
{
    var s = new Nudges.State();
    s.RollOver(Work(17));
    s.SentToday = 2;
    s.FiredToday.Add("no_progress_today");
    Nudges.Ctx c = Base();
    c.NowLocal = Work(17).AddDays(1);
    Nudges.Result r = Nudges.Pick(c, s);
    Console.WriteLine("rollover:newday || " + (r == null ? "silent" : r.Id));
}

// ---------- «Дараа» гэвэл өнөөдөр дахин гарахгүй ----------
{
    var s = new Nudges.State();
    s.RollOver(Work(17));
    Nudges.Dismiss(s, "no_progress_today");
    Nudges.Result r = Nudges.Pick(Base(), s);
    Console.WriteLine("dismiss:same_day || " + (r == null ? "silent" : r.Id));
}
"""

CASES = [
    # --- ажиллах ёстой ---
    ("fire:no_progress",     "no_progress_today"),
    ("fire:no_baseline",     "no_baseline"),
    ("fire:unbound",         "unbound_sheets"),

    # --- ⚠️ ЧИМЭЭГҮЙ БАЙХ ЁСТОЙ (тестийн гол хэсэг) ---
    ("quiet:typing",         "silent"),   # хүн бичиж байна — таслах нь хамгийн муу
    ("quiet:busy",           "silent"),
    ("quiet:awaiting",       "silent"),
    ("quiet:sync",           "silent"),
    ("quiet:weekend",        "silent"),   # амралтын өдөр зэмлэх нь буруу
    ("quiet:early",          "silent"),
    ("quiet:late",           "silent"),
    ("quiet:reported",       "silent"),   # аль хэдийн бүртгэсэн
    ("quiet:fewchanges",     "silent"),   # бараг юу ч хийгээгүй
    ("quiet:offline",        "silent"),   # вэб уншаагүй — «бүртгээгүй» гэдгийг мэдэхгүй
    ("quiet:unbound_early",  "silent"),   # файл дөнгөж нээгдсэн

    # --- төсөв ---
    ("budget:maxed",         "silent"),
    ("budget:toosoon",       "silent"),
    ("budget:gap_ok",        "no_progress_today"),
    ("budget:already_fired", "silent"),

    # --- өдөр солигдох / үгүйсгэх ---
    ("rollover:newday",      "no_progress_today"),
    ("dismiss:same_day",     "silent"),
]


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp)
        (d / "nudgecheck.csproj").write_text(
            CSPROJ.replace("__NUDGES__", str((ADDIN / "Nudges.cs").resolve())),
            encoding="utf-8")
        (d / "Program.cs").write_text(MAIN, encoding="utf-8")

        r = subprocess.run(["dotnet", "run", "--project", str(d / "nudgecheck.csproj")],
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
    print(f"  {'тохиолдол':26} {'үр дүн':>20} {'хүлээсэн':>20}")
    print("  " + "-" * 70)
    for key, want in CASES:
        have = got.get(key, "<АЛГА>")
        good = have == want
        ok += good
        print(f"  {'✅' if good else '❌'} {key[:24]:24} {have:>20} {want:>20}")

    print(f"\n  {ok}/{len(CASES)} зөв")
    if ok < len(CASES):
        sys.exit(1)


if __name__ == "__main__":
    main()
