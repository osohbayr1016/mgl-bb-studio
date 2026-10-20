r"""ЯРИА ХЭЛЦЛИЙН ТӨЛӨВИЙН ШАЛГАЛТ — `addin/Conversation.cs`-ийг Revit-гүйгээр тулгана.

Энэ бол туслахыг ЧИГЛҮҮЛЭГЧЭЭС АГЕНТ болгох суурь давхарга.  Гурван зүйлийг
барина:

  1. **ЗААЛТ** — «эхнийхийг нь ялга», «3 дахийг», «сүүлийнхийг».
     Сүүлд жагсаасан хуудсууд дээр тогтоно.
  2. **ХҮЛЭЭЛТИЙН ХЯЗГААР** — «Аль хуудсыг?» гэж МӨНХӨД асуухаас сэргийлнэ.
  3. **ШИНЭ САНАА ЯЛАХ** — хэрэглэгчийг гацаанд оруулахгүй.

⚠️ №3 нь ХАМГИЙН ЧУХАЛ.  Муу зохиосон слот бөглөгч нь хүнийг барьдаг:
«Аль хуудсыг?» гэж асуугаад, хүн «за яахав, явцаа илгээе» гэхэд түүнийг
хуудасны нэр гэж уншиж «олдсонгүй» гэдэг.  Хүн гарах арга олохгүй.
`ShouldYieldTo` үүнээс сэргийлдэг бөгөөд энэ тест түүнийг барина.

    ..\..\server\.venv\Scripts\python.exe check_conversation.py
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

# ⚠️ Долоон файл нь Revit-ийн API-д ХАМААРАХГҮЙ тул бие даан эмхэтгэнэ.
SOURCES = [
    "Conversation.cs", "TextFold.cs", "Slots.cs",
    "IntentModel.cs", "IntentRouter.cs", "IntentParser.cs", "Lang.cs",
]

CSPROJ = """<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>disable</Nullable>
    <ImplicitUsings>disable</ImplicitUsings>
    <AssemblyName>convcheck</AssemblyName>
    <EnableSourceControlManagerQueries>false</EnableSourceControlManagerQueries>
    <EnableSourceLink>false</EnableSourceLink>
  </PropertyGroup>
  <ItemGroup>
__COMPILE__
  </ItemGroup>
</Project>
"""

# ⚠️ Тусгаарлагч нь " || " — ташуу зураас ашиглахгүй (урхи №14).
MAIN = """using System;
using System.Collections.Generic;
using RevitMcpAddin;

Console.OutputEncoding = System.Text.Encoding.UTF8;

var sheets = new List<Slots.SheetRef>
{
    new Slots.SheetRef { Number = "BA-01", Name = "Nuur fasad", Uid = "u1" },
    new Slots.SheetRef { Number = "BA-02", Name = "Plan", Uid = "u2" },
    new Slots.SheetRef { Number = "HAS-03", Name = "Halaalt", Uid = "u3" },
    new Slots.SheetRef { Number = "BA-15", Name = "Zuselt", Uid = "u4" },
};

void Line(string name, string got) => Console.WriteLine(name + " || " + got);

// ---------- 1. ЗААЛТ ----------
Conversation.RememberSheets(sheets);
string[] probes = {
    "ehniihiig ni ylga", "эхнийхийг нь ялга", "isolate the first one",
    "suuliihiig haruul", "сүүлийнхийг харуул", "show the last one",
    "3 dahiig ylga", "2 r huudsiig haruul",
    "БА-02 ыг ялга", "ямар нэг юм",
};
foreach (string p in probes)
{
    Slots.SheetRef hit = Conversation.ResolveOrdinal(p);
    Line("ord:" + p, hit == null ? "-" : hit.Uid);
}

// ---------- 2. ХҮЛЭЭЛТИЙН ХЯЗГААР ----------
Conversation.Clear();
for (int i = 1; i <= 5; i++)
{
    bool again = Conversation.Ask("isolate_sheet", "sheet");
    Line("ask#" + i, again ? "asks" : "gives-up");
}

// ---------- 3. ШИНЭ САНАА ЯЛАХ ----------
Conversation.Clear();
Conversation.Ask("isolate_sheet", "sheet");

var answerLike = new RouteResult { By = DecidedBy.Fallback, Intent = null };
Line("yield:fallback", Conversation.ShouldYieldTo(answerLike) ? "yield" : "answer");

var sameIntent = new RouteResult { By = DecidedBy.Model, Intent = "isolate_sheet" };
Line("yield:same", Conversation.ShouldYieldTo(sameIntent) ? "yield" : "answer");

var newIntent = new RouteResult { By = DecidedBy.Model, Intent = "submit_progress" };
Line("yield:new", Conversation.ShouldYieldTo(newIntent) ? "yield" : "answer");

var kwIntent = new RouteResult { By = DecidedBy.Keyword, Intent = "reset_view" };
Line("yield:keyword", Conversation.ShouldYieldTo(kwIntent) ? "yield" : "answer");

// ---------- 4. ХҮЛЭЭЛТГҮЙ ҮЕД ----------
Conversation.Clear();
Line("peek:empty", Conversation.Peek() == null ? "null" : "set");
"""

CASES = [
    # --- заалт: кирилл, латин, англи ---
    ("ord:ehniihiig ni ylga",       "u1"),
    ("ord:эхнийхийг нь ялга",       "u1"),
    ("ord:isolate the first one",   "u1"),
    ("ord:suuliihiig haruul",       "u4"),
    ("ord:сүүлийнхийг харуул",      "u4"),
    ("ord:show the last one",       "u4"),
    ("ord:3 dahiig ylga",           "u3"),
    ("ord:2 r huudsiig haruul",     "u2"),
    # ⚠️ Шифр байвал заалт ажиллах ЁСГҮЙ — `Slots.MatchSheet` эхлээд
    # ажилладаг тул энд хүрэхгүй, гэхдээ хүрсэн ч заалт олохгүй.
    ("ord:БА-02 ыг ялга",           "-"),
    ("ord:ямар нэг юм",             "-"),

    # --- хүлээлт 3 удаа асуугаад ӨГНӨ ---
    # ⚠️ MaxTurns=3 гэдэг нь «3 УДАА асууна» гэсэн үг — 4 дэх дуудлагад өгнө.
    # Анх энэ тест 3 дээр өгнө гэж бичигдсэн байсан нь ТЕСТИЙН алдаа байв.
    ("ask#1", "asks"),
    ("ask#2", "asks"),
    ("ask#3", "asks"),
    ("ask#4", "gives-up"),
    ("ask#5", "asks"),      # өгсний дараа тэглэгдэж, дахин эхэлнэ

    # --- шинэ санаа ялах ---
    ("yield:fallback", "answer"),   # танигдаагүй = хариу байж болно
    ("yield:same",     "answer"),   # ижил санаа = дахин оролдлого
    ("yield:new",      "yield"),    # ⚠️ ӨӨР санаа = хүн сэдэв сольсон
    ("yield:keyword",  "yield"),    # түлхүүр үг ч мөн адил

    ("peek:empty", "null"),
]


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp)
        compile_lines = "\n".join(
            f'    <Compile Include="{(ADDIN / f).resolve()}" />' for f in SOURCES)
        (d / "convcheck.csproj").write_text(
            CSPROJ.replace("__COMPILE__", compile_lines), encoding="utf-8")
        (d / "Program.cs").write_text(MAIN, encoding="utf-8")

        r = subprocess.run(["dotnet", "run", "--project", str(d / "convcheck.csproj")],
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
    print(f"  {'шалгалт':34} {'үр дүн':>10} {'хүлээсэн':>10}")
    print("  " + "-" * 58)
    for key, want in CASES:
        have = got.get(key, "<АЛГА>")
        good = have == want
        ok += good
        print(f"  {'✅' if good else '❌'} {key[:32]:32} {have:>10} {want:>10}")

    print(f"\n  {ok}/{len(CASES)} зөв")
    if ok < len(CASES):
        sys.exit(1)


if __name__ == "__main__":
    main()
