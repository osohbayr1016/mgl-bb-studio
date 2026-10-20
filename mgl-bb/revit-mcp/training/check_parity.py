"""C# ↔ Python ТУЛГАЛТ — ангилагч хоёр талдаа ИЖИЛ ажиллаж байгааг батална.

⚠️ ЯАГААД ЭНЭ ХЭРЭГТЭЙ ВЭ

Сургалт Python дээр, таамаглал C# дээр явдаг.  Хоёр талын урьдчилан
боловсруулалт, TF-IDF, softmax ЯГ таарах ёстой.  Хэрэв зөрвөл:
  • эмхэтгэл амжилттай болно
  • тест ногоон гарна
  • загварын нарийвчлал ЧИМЭЭГҮЙ унана — хэн ч мэдэхгүй

Энэ скрипт үүнийг барина.  Загвар шинэчлэх, `preprocess()` засах, эсвэл
`IntentModel.cs`-ийг хөндөх бүрд АЖИЛЛУУЛ.

    python check_parity.py --data data/bootstrap.json --model ../addin/Resources/intent-model.json

2026-08-24-нд ЭНЭ СКРИПТ БОДИТ АЛДАА ОЛСОН: C# нь нэг ч n-gram таарахгүй
үед («ok», «hmm», «asdf») эрт гарч `null` буцаадаг байсан, харин sklearn
тэг вектороос intercept-ээр таамаглал гаргадаг.  215 мөрийн 7 дээр зөрсөн.
"""

from __future__ import annotations

import argparse
import io
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

import numpy as np

from train_intent import build, clean, load_rows, preprocess  # noqa: F401

HARNESS_CSPROJ = """<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>disable</Nullable>
    <ImplicitUsings>disable</ImplicitUsings>
    <AssemblyName>parity</AssemblyName>
    <EnableSourceControlManagerQueries>false</EnableSourceControlManagerQueries>
    <EnableSourceLink>false</EnableSourceLink>
  </PropertyGroup>
  <ItemGroup>
    <Compile Include="__MODEL_CS__" />
    <Compile Include="__FOLD_CS__" />
  </ItemGroup>
</Project>
"""

# ⚠️ `IntentModel.cs` ба `TextFold.cs` нь Revit-ийн API-д ХАМААРАХГҮЙ (зөвхөн System.*) тул
# Revit-гүйгээр эмхэтгэж болно.  Яг тэр шинж нь энэ тестийг боломжтой болгож
# байгаа — Revit шаарддаг байсан бол автомат тулгалт хийх аргагүй байх байв.
HARNESS_MAIN = """using System;
using System.IO;
using RevitMcpAddin;

string model = args[0];
string probes = args[1];
string dst = Path.Combine(
    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
    "RevitMcpAddin", "intent-model.json");
Directory.CreateDirectory(Path.GetDirectoryName(dst));
string backup = dst + ".parity-backup";
bool had = File.Exists(dst);
if (had) File.Copy(dst, backup, true);
try
{
    File.Copy(model, dst, true);
    IntentModel.Reload();
    Console.OutputEncoding = System.Text.Encoding.UTF8;
    foreach (string line in File.ReadAllLines(probes, System.Text.Encoding.UTF8))
    {
        string t = line.TrimEnd('\\r', '\\n');
        if (t.Length == 0) continue;
        IntentPrediction p = IntentModel.Predict(t);
        Console.WriteLine($"{t}\\t{p.Intent ?? "null"}\\t{p.Confidence:0.0000}");
    }
}
finally
{
    // ⚠️ Хэрэглэгчийн бодит загварыг СЭРГЭЭНЭ — тест нь Revit-ийн
    // ажиллаж буй тохиргоог эвдэх ёсгүй.
    if (had) { File.Copy(backup, dst, true); File.Delete(backup); }
    else if (File.Exists(dst)) File.Delete(dst);
}
"""


def main() -> None:
    ap = argparse.ArgumentParser(description="C# ↔ Python тулгалт")
    ap.add_argument("--data", nargs="+", type=Path, required=True)
    ap.add_argument("--model", type=Path, required=True)
    ap.add_argument(
        "--intent-model-cs",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "addin" / "IntentModel.cs",
    )
    ap.add_argument(
        "--text-fold-cs",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "addin" / "TextFold.cs",
    )
    ap.add_argument("--tol", type=float, default=0.005, help="итгэлцлийн зөвшөөрөх зөрүү")
    args = ap.parse_args()

    if not args.model.exists():
        raise SystemExit(f"загвар олдсонгүй: {args.model}")

    # --- Python тал -------------------------------------------------------
    print("Python талыг сургаж байна…")
    X, y = clean(load_rows(list(args.data)))

    # ⚠️ `max_features`-ийг ЭКСПОРТОЛСОН ЗАГВАРААС уншина, хатуу бичихгүй.
    # Урьд нь энд `build(6000)` гэж бичигдсэн байсан тул `train_intent.py`-ийн
    # анхдагчийг 12000 болгоход тест нь 6000-тай загвар сургаад 12000-тай
    # экспортын эсрэг тулгаж, «C# буруу» гэсэн ХУДАЛ дохио өгсөн
    # (2026-08-25).  Үгсийн сангийн хэмжээ нь яг тэр тоо тул зөрөх аргагүй.
    model_json = json.loads(io.open(args.model, encoding="utf-8").read())
    max_features = len(model_json.get("vocab") or {}) or 6000
    print(f"  загварын онцлог: {max_features}")

    vec, clf = build(max_features)
    Xv = vec.fit_transform(X)
    clf.fit(Xv, np.array(y))

    # ⚠️ Экспортолсон загварын ХУВИЛБАРААР шалгах ёстой, дахин сургасан
    # загвараар БИШ.  Тиймээс сургалтыг ижил үр (random_state) дээр хийж,
    # экспортын бөөрөнхийлөлтийн зөрүүг `--tol`-оор зөвшөөрнө.
    probs = clf.predict_proba(vec.transform(X))
    py_rows = []
    for t, p in zip(X, probs):
        i = int(np.argmax(p))
        py_rows.append((t, str(clf.classes_[i]), float(p[i])))

    # --- C# тал -----------------------------------------------------------
    print("C# талыг эмхэтгэж байна…")
    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp)
        (d / "parity.csproj").write_text(
            HARNESS_CSPROJ
                .replace("__MODEL_CS__", str(args.intent_model_cs.resolve()))
                .replace("__FOLD_CS__", str(args.text_fold_cs.resolve())),
            encoding="utf-8",
        )
        (d / "Program.cs").write_text(HARNESS_MAIN, encoding="utf-8")
        probes = d / "probes.txt"
        probes.write_text("\n".join(t for t, _, _ in py_rows), encoding="utf-8")

        r = subprocess.run(
            # ⚠️ `--nologo` нь `dotnet run`-д БАЙХГҮЙ (зөвхөн `dotnet build`).
            # Байвал rc != 0 болж, шалтгаан нь харагдахгүй унана.
            ["dotnet", "run", "--project", str(d / "parity.csproj"),
             "--", str(args.model.resolve()), str(probes)],
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        if r.returncode != 0:
            print("--- dotnet stdout ---", file=sys.stderr)
            print((r.stdout or "")[-3000:], file=sys.stderr)
            print("--- dotnet stderr ---", file=sys.stderr)
            print((r.stderr or "")[-3000:], file=sys.stderr)
            raise SystemExit(f"C# harness амжилтгүй (rc={r.returncode})")
        cs_lines = [l for l in (r.stdout or "").splitlines() if "\t" in l]

    # --- Тулгалт ----------------------------------------------------------
    if len(cs_lines) != len(py_rows):
        raise SystemExit(f"мөрийн тоо зөрж байна: py={len(py_rows)} cs={len(cs_lines)}")

    diff = 0
    max_delta = 0.0
    bad: list[tuple[str, str, str]] = []
    for (t1, l1, c1), line in zip(py_rows, cs_lines):
        t2, l2, c2 = line.split("\t")
        if t1 != t2:
            raise SystemExit(f"текст зөрж байна: {t1!r} vs {t2!r}")
        if l1 != l2:
            diff += 1
            if len(bad) < 10:
                bad.append((t1, l1, l2))
        max_delta = max(max_delta, abs(c1 - float(c2)))

    print()
    print(f"  мөр             : {len(py_rows)}")
    print(f"  шошгын зөрүү    : {diff}")
    print(f"  итгэлцлийн зөрүү: {max_delta:.6f}  (зөвшөөрөх {args.tol})")
    for t, a, b in bad:
        print(f"    {t!r}  python={a}  csharp={b}")

    print()
    if diff == 0 and max_delta <= args.tol:
        print("  ✅ C# ба Python ЯГ ИЖИЛ")
        return
    print("  ❌ ЗӨРҮҮТЭЙ — preprocess эсвэл экспортыг шалга")
    sys.exit(1)


if __name__ == "__main__":
    main()
