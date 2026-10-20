r"""СЛОТ ГАРГАЛТЫН ШАЛГАЛТ — `addin/Slots.cs`-ийг Revit-гүйгээр тулгана.

Санаа зөв таних нь ХАГАС нь.  «BA-01 ыг ялга» гэхэд аль хуудсыг гэдгийг
олж чадахгүй бол туслах ажиллахгүй.  Энэ файл тэр хоёр слотыг барина:
хуудасны шифр ба хувь.

⚠️ 2026-08-25 хүртэл хуудас таних нь мөрийг шууд харьцуулдаг байсан тул
«BA-01» гэж ЛАТИНААР бичихэд кирилл «БА-01» хуудас ОЛДОХГҮЙ байв.  Мөн
«БА01» (зураасгүй), «ба 1» (тэггүй) хоёр ч ажиллахгүй.  Гурвуулаа бодит
хэрэглээнд байнга тохиолддог.

    ..\..\server\.venv\Scripts\python.exe check_slots.py
"""

from __future__ import annotations

import json
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
    <AssemblyName>slots</AssemblyName>
    <EnableSourceControlManagerQueries>false</EnableSourceControlManagerQueries>
    <EnableSourceLink>false</EnableSourceLink>
  </PropertyGroup>
  <ItemGroup>
    <Compile Include="__FOLD__" />
    <Compile Include="__SLOTS__" />
  </ItemGroup>
</Project>
"""

# ⚠️ Тусгаарлагч нь " || " — ташуу зураас ашиглахгүй.  C# мөрийг Bash
# heredoc-оор бичихэд `\t` гэх мэт нь гэмтдэг (урхи №14).
MAIN = """using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using RevitMcpAddin;

string doc = File.ReadAllText(args[0], System.Text.Encoding.UTF8);
using JsonDocument jd = JsonDocument.Parse(doc);
Console.OutputEncoding = System.Text.Encoding.UTF8;

var sheets = new List<Slots.SheetRef>();
foreach (JsonElement s in jd.RootElement.GetProperty("sheets").EnumerateArray())
{
    sheets.Add(new Slots.SheetRef {
        Number = s.GetProperty("number").GetString(),
        Name   = s.GetProperty("name").GetString(),
        Uid    = s.GetProperty("uid").GetString(),
    });
}

foreach (JsonElement p in jd.RootElement.GetProperty("probes").EnumerateArray())
{
    string t = p.GetString();
    Slots.SheetRef hit = Slots.MatchSheet(sheets, t);
    double? pct = Slots.Percent(t);
    Console.WriteLine(t + " || " + (hit == null ? "-" : hit.Uid)
                        + " || " + (pct.HasValue ? ((int)pct.Value).ToString() : "-"));
}
"""

SHEETS = [
    {"number": "БА-01", "name": "Нүүр фасад", "uid": "u1"},
    {"number": "БА-02", "name": "1 давхрын план", "uid": "u2"},
    {"number": "ХАС-03", "name": "Халаалтын схем", "uid": "u3"},
    {"number": "ЦБУ-10", "name": "Цахилгаан хангамж", "uid": "u4"},
    {"number": "БА-15", "name": "Зүсэлт А-А", "uid": "u5"},
]

# (текст, хүлээсэн uid, хүлээсэн хувь)
CASES = [
    # --- шифр яг таарах ---
    ("БА-01 ыг ялга",                 "u1", "-"),
    ("БА-01",                          "u1", "-"),
    # --- ЛАТИНААР бичсэн (өмнө нь БҮТЭЛГҮЙТДЭГ байсан) ---
    ("BA-01 ig ylga",                  "u1", "-"),
    ("ba-01 iig tusgaarla",            "u1", "-"),
    ("HAS 03 iig ylgaj haruul",        "u3", "-"),
    ("cbu-10 haruulaach",              "u4", "-"),
    # --- ХАРАГДАЦЫН ХОЛИМОГ: кирилл «с» ↔ латин «c», «о» ↔ «0» ---
    # Эдгээр нь эвхэлтээр таарахгүй; шифрийн ойрын таарц (зай ≤ 1) барина.
    ("hac-03 haruul",                  "u3", "-"),
    ("ba-o1 iig ylga",                 "u1", "-"),
    ("cbu 1o",                         "u4", "-"),
    # ⚠️ Ойрын таарц ХОЁРДМОЛ бол NULL — «ba03» нь ba01/ba02 хоёуланд
    # 1 зайд байна.  Таамаглахаас асуусан нь дээр.
    ("ba03 iig ylga",                  "-",  "-"),
    # --- зураасгүй / зайгүй (өмнө нь БҮТЭЛГҮЙТДЭГ байсан) ---
    ("БА01 харуул",                    "u1", "-"),
    ("ba01",                           "u1", "-"),
    ("ХАС 03",                         "u3", "-"),
    # --- эхний тэггүй (өмнө нь БҮТЭЛГҮЙТДЭГ байсан) ---
    ("ба 1 ийг тусгаарла",             "u1", "-"),
    ("ba 1",                           "u1", "-"),
    ("ХАС-3 ыг харуул",                "u3", "-"),
    # --- НЭРЭЭР дуудах ---
    ("фасад харуул",                   "u1", "-"),
    ("халаалтын схем харуулаач",       "u3", "-"),
    ("зүсэлт ийг ялга",                "u5", "-"),
    ("cahilgaan haruul",               "u4", "-"),
    # --- олдохгүй / хоёрдмол бол NULL ---
    ("хуудсуудаа харуул",              "-",  "-"),
    ("БА-99 ыг ялга",                  "-",  "-"),
    ("бүгдийг буцаа",                  "-",  "-"),
    ("БА хуудсуудыг харуул",           "-",  "-"),
    # --- ХУВЬ ---
    ("70%",                            "-",  "70"),
    ("70 хувь болголоо",               "-",  "70"),
    ("70 huvi bolgoloo",               "-",  "70"),
    ("70 percent done",                "-",  "70"),
    ("БА-01 ыг 60% болголоо",          "u1", "60"),
    ("ХАС-03 ыг 100 хувь болгов",      "u3", "100"),
    ("BA-01 iig 45 huviar hiilee",     "u1", "45"),
    ("энэ хуудсыг дуусгалаа",          "-",  "-"),
    ("БА-15",                          "u5", "-"),      # 15 нь ХУВЬ БИШ
    ("150% болгов",                    "-",  "-"),      # 100-аас дээш = үгүйсгэнэ
]


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp)
        (d / "slots.csproj").write_text(
            CSPROJ.replace("__FOLD__", str((ADDIN / "TextFold.cs").resolve()))
                  .replace("__SLOTS__", str((ADDIN / "Slots.cs").resolve())),
            encoding="utf-8")
        (d / "Program.cs").write_text(MAIN, encoding="utf-8")
        (d / "in.json").write_text(
            json.dumps({"sheets": SHEETS, "probes": [c[0] for c in CASES]},
                       ensure_ascii=False), encoding="utf-8")

        r = subprocess.run(
            ["dotnet", "run", "--project", str(d / "slots.csproj"), "--", str(d / "in.json")],
            capture_output=True, text=True, encoding="utf-8")
        if r.returncode != 0:
            print((r.stdout or "")[-3000:], file=sys.stderr)
            print((r.stderr or "")[-3000:], file=sys.stderr)
            raise SystemExit(f"C# harness амжилтгүй (rc={r.returncode})")
        lines = [l for l in (r.stdout or "").splitlines() if " || " in l]

    if len(lines) != len(CASES):
        raise SystemExit(f"мөрийн тоо зөрж байна: {len(lines)} vs {len(CASES)}")

    ok = 0
    print(f"  {'текст':34} {'хуудас':>7} {'хүлээсэн':>9} {'хувь':>5} {'хүлээсэн':>9}")
    print("  " + "-" * 74)
    for (text, want_uid, want_pct), line in zip(CASES, lines):
        got_t, got_uid, got_pct = [x.strip() for x in line.split(" || ")]
        good = got_uid == want_uid and got_pct == want_pct
        ok += good
        print(f"  {'✅' if good else '❌'} {text[:32]:32} {got_uid:>7} {want_uid:>9} "
              f"{got_pct:>5} {want_pct:>9}")

    print(f"\n  {ok}/{len(CASES)} зөв")
    if ok < len(CASES):
        sys.exit(1)


if __name__ == "__main__":
    main()
