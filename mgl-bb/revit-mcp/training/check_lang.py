r"""ХАРИУЛТЫН ХЭЛ ТАНИХ ШАЛГАЛТ — `addin/Lang.cs`-ийг Revit-гүйгээр тулгана.

Ангилагч англи хэлийг таньдаг болсон («unhide everything again» → reset_view),
ГЭВЧ хариулт нь монголоор гарвал хагас ажилласантай адил.  `Lang` нь
хэрэглэгчийн бичсэн хэлээр хариулах шийдвэрийг гаргадаг.

⚠️ ГУРВАН ДҮРЭМ, гуравуулаа энд баригдана:
  1. КИРИЛЛ байвал → монгол.  Хамгийн тодорхой дохио.
  2. АНГЛИ ТУСЛАХ ҮГ байвал → англи.  ГЭХДЭЭ «progress», «sheet», «push»
     зэрэг мэргэжлийн үгс дохио БИШ — монголчууд өдөр тутам холимог
     бичдэг («progress оо push хий»), тэднийг дохио болговол монгол мөрийг
     англи гэж алдана.
  3. ДОХИОГҮЙ бол → өмнөхийг хадгална («BA-01», «70%», «ok»).  Хэл нь
     яриа дунд үсэрвэл эвгүй.

⚠️ ЛАТИНААР БИЧСЭН МОНГОЛ нь дохиогүйд тооцогдоно, өөрөөр хэлбэл анхдагч
монгол хариулт авна.  Ажилтнууд кирилл УНШИНА, зөвхөн БИЧИХ нь хэцүү
(гарын байрлал, утас) — «hiisnee ilgee» гэсэн хүнд англиар хариулбал буруу.

    ..\..\server\.venv\Scripts\python.exe check_lang.py
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
    <AssemblyName>langcheck</AssemblyName>
    <EnableSourceControlManagerQueries>false</EnableSourceControlManagerQueries>
    <EnableSourceLink>false</EnableSourceLink>
  </PropertyGroup>
  <ItemGroup>
    <Compile Include="__LANG__" />
  </ItemGroup>
</Project>
"""

# ⚠️ Тусгаарлагч нь " || " — ташуу зураас ашиглахгүй (урхи №14).
MAIN = """using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using RevitMcpAddin;

string doc = File.ReadAllText(args[0], System.Text.Encoding.UTF8);
using JsonDocument jd = JsonDocument.Parse(doc);
Console.OutputEncoding = System.Text.Encoding.UTF8;

foreach (JsonElement p in jd.RootElement.EnumerateArray())
{
    string t = p.GetString();
    UiLang? got = Lang.Detect(t);
    Console.WriteLine(t + " || " + (got.HasValue ? got.Value.ToString() : "-"));
}
"""

# (текст, хүлээсэн: "Mn" | "En" | "-" = дохиогүй)
CASES = [
    # --- кирилл → монгол ---
    ("хийснээ илгээ",                 "Mn"),
    ("БА-01 ыг харуул",               "Mn"),
    ("явц хэд вэ",                    "Mn"),
    ("sheet үүдээ харуул",            "Mn"),   # холимог ч кирилл бий
    ("progress оо push хий",          "Mn"),

    # --- англи → англи ---
    ("send my progress to the system", "En"),
    ("what changed since yesterday",   "En"),
    ("show me all the sheets",         "En"),
    ("can you help me",                "En"),
    ("please reset the view",          "En"),
    ("how far am i",                   "En"),
    ("i want to submit",               "En"),
    ("thanks",                         "En"),

    # --- латин-монгол → ДОХИОГҮЙ (анхдагч монгол хэвээр) ---
    ("hiisnee ilgee",                 "-"),
    ("huudsuudaa haruul",             "-"),
    ("yavts hed ve",                  "-"),
    ("BA-01 iig tusgaarla",           "-"),
    ("suuri avchih",                  "-"),

    # --- дохиогүй ---
    ("БА-01",                         "Mn"),   # кирилл үсэг бий
    ("BA-01",                         "-"),
    ("70%",                           "-"),
    ("ok",                            "-"),
    ("",                              "-"),
    ("   ",                           "-"),

    # ⚠️ Мэргэжлийн үг дохио БОЛОХГҮЙ — эдгээр нь монгол өгүүлбэрт
    # байнга орно.  Дохио болговол монгол мөрийг англи гэж алдана.
    ("progress push submit",          "-"),
    ("isolate sheet baseline",        "-"),
    ("progres ilgee",                 "-"),
]


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp)
        (d / "langcheck.csproj").write_text(
            CSPROJ.replace("__LANG__", str((ADDIN / "Lang.cs").resolve())),
            encoding="utf-8")
        (d / "Program.cs").write_text(MAIN, encoding="utf-8")
        (d / "in.json").write_text(
            json.dumps([c[0] for c in CASES], ensure_ascii=False), encoding="utf-8")

        r = subprocess.run(
            ["dotnet", "run", "--project", str(d / "langcheck.csproj"), "--", str(d / "in.json")],
            capture_output=True, text=True, encoding="utf-8")
        if r.returncode != 0:
            print((r.stdout or "")[-3000:], file=sys.stderr)
            print((r.stderr or "")[-3000:], file=sys.stderr)
            raise SystemExit(f"C# harness амжилтгүй (rc={r.returncode})")
        lines = [l for l in (r.stdout or "").splitlines() if " || " in l]

    if len(lines) != len(CASES):
        raise SystemExit(f"мөрийн тоо зөрж байна: {len(lines)} vs {len(CASES)}")

    ok = 0
    print(f"  {'текст':36} {'таамаг':>8} {'хүлээсэн':>10}")
    print("  " + "-" * 60)
    for (text, want), line in zip(CASES, lines):
        got = line.rsplit(" || ", 1)[1].strip()
        good = got == want
        ok += good
        shown = repr(text) if not text.strip() else text
        print(f"  {'✅' if good else '❌'} {shown[:34]:34} {got:>8} {want:>10}")

    print(f"\n  {ok}/{len(CASES)} зөв")
    if ok < len(CASES):
        sys.exit(1)


if __name__ == "__main__":
    main()
