r"""ДҮГНЭЛТИЙН УРСГАЛЫН ШАЛГАЛТ — `addin/FindingFeed.cs`-ийг Revit-гүйгээр тулгана.

`check_nudge.py`-ийн хэв маягийг давтав: түр `.csproj` үүсгээд ГАНЦ файлыг
оруулж `dotnet run` хийнэ.  Revit суулгалт, лиценз, WPF огт шаардахгүй —
`FindingFeed.cs` нь Revit-ийн ямар ч төрөл ашигладаггүй, UI-д хүрдэггүй тул
add-in дахь цөөхөн автоматжуулж болох давхаргын нэг (C# тест ТЭГ).

⚠️ ЭНЭ ФАЙЛЫН ОРШИН БАЙХ ГОЛ ШАЛТГААН нь 9 дүгээр тохиолдол:
   «ЭРЭМБЭЛЭХЭЭС ӨМНӨ ТАСЛАХ» алдаа.  Тэр алдаа нь `ChangeReport.cs:56-60`-д
   аль хэдийн НЭГ УДАА гарсан бөгөөд хэрэглэгч «санамсаргүй N»-г БҮРЭН
   жагсаалт гэж үзээд үлдсэнийг нь засахгүй өнгөрдөг байв.  Нормын
   дүгнэлтийн хувьд тэр нь өмнөх алдаанаас хамаагүй аюултай: харагдаагүй
   CRITICAL зөрчил нь баригдалгүй хэвлэгдэнэ.

    ..\..\server\.venv\Scripts\python.exe check_findingfeed.py
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
    <AssemblyName>feedcheck</AssemblyName>
    <NoWarn>CS0649</NoWarn>
    <EnableSourceControlManagerQueries>false</EnableSourceControlManagerQueries>
    <EnableSourceLink>false</EnableSourceLink>
  </PropertyGroup>
  <ItemGroup>
    <Compile Include="__FEED__" />
  </ItemGroup>
</Project>
"""

# ⚠️ Тусгаарлагч " || " — ташуу зураас ашиглахгүй (`check_nudge.py`-ийн урхи №14).
MAIN = """using System;
using System.Collections.Generic;
using RevitMcpAddin;

Console.OutputEncoding = System.Text.Encoding.UTF8;

const long T0 = 1700000000L;
const long DAY = 86400L;

FindingFeed.Item It(string key, string sev, long at, string root, bool stale)
{
    return new FindingFeed.Item
    {
        DedupKey = key,
        Severity = sev,
        Verdict = "VIOLATION",
        DetectedAtSec = at,
        RootDedupKey = root,
        IsStale = stale,
    };
}

FindingFeed.Item Missing(string key, string sev, long at)
{
    FindingFeed.Item i = It(key, sev, at, null, false);
    i.RootMissing = true;   // серверийн `promoted`
    return i;
}

void Say(string name, object v) { Console.WriteLine(name + " || " + v); }

string Cap(string s) { return s == null ? "<null>" : s.Replace("\\n", "/"); }

// ---------- 1. Хоосон оролт ----------
{
    var st = new FindingFeed.State();
    FindingFeed.Result r = FindingFeed.Build(new List<FindingFeed.Item>(), st, T0, 4);
    Say("1:empty", r.Groups.Count);
}

// ---------- 2. Жагсаалт дотор null ----------
{
    var st = new FindingFeed.State();
    var list = new List<FindingFeed.Item> { null, It("a", "HIGH", T0, null, false), null };
    FindingFeed.Result r = FindingFeed.Build(list, st, T0, 4);
    Say("2:nullitem", r.Groups.Count);
}

// ---------- 3. CRITICAL + INFO холимог ----------
{
    var st = new FindingFeed.State();
    var list = new List<FindingFeed.Item>
    {
        It("info", "INFO", T0 + 500, null, false),
        It("crit", "CRITICAL", T0, null, false),
    };
    FindingFeed.Result r = FindingFeed.Build(list, st, T0 + 1000, 4);
    Say("3:severity_first", r.Groups[0].Primary.DedupKey);
}

// ---------- 4. Ижил хүнд байдал, өөр цаг ----------
{
    var st = new FindingFeed.State();
    var list = new List<FindingFeed.Item>
    {
        It("old", "HIGH", T0, null, false),
        It("new", "HIGH", T0 + 900, null, false),
    };
    FindingFeed.Result r = FindingFeed.Build(list, st, T0 + 1000, 4);
    Say("4:newest_first", r.Groups[0].Primary.DedupKey);
}

// ---------- 5. Үндэс + 3 дагавар ----------
{
    var st = new FindingFeed.State();
    var list = new List<FindingFeed.Item> { It("root", "HIGH", T0, null, false) };
    for (int i = 0; i < 3; i++) list.Add(It("c" + i, "MEDIUM", T0, "root", false));
    FindingFeed.Result r = FindingFeed.Build(list, st, T0 + 10, 4);
    Say("5:root_group",
        r.Groups.Count + "|" + r.Groups[0].Primary.DedupKey + "|" + r.Groups[0].Consequences.Count);
}

// ---------- 6. Үндэс + 20 дагавар ----------
{
    var st = new FindingFeed.State();
    var list = new List<FindingFeed.Item> { It("root", "HIGH", T0, null, false) };
    for (int i = 0; i < 20; i++) list.Add(It("c" + i, "MEDIUM", T0, "root", false));
    FindingFeed.Result r = FindingFeed.Build(list, st, T0 + 10, 4);
    Say("6:fold", r.Groups[0].Consequences.Count + "|" + r.Groups[0].ConsequenceTotal);
}

// ---------- 7. Үндэс нь хүлээн зөвшөөрөгдсөн ----------
{
    var st = new FindingFeed.State();
    FindingFeed.Acknowledge(st, "root", T0);
    var list = new List<FindingFeed.Item>
    {
        It("root", "CRITICAL", T0, null, false),
        It("c1", "CRITICAL", T0, "root", false),
        It("c2", "HIGH", T0, "root", false),
        It("c3", "MEDIUM", T0, "root", false),
    };
    FindingFeed.Result r = FindingFeed.Build(list, st, T0 + 60, 4);
    Say("7:promote",
        r.Groups.Count + "|" + r.Groups[0].Primary.DedupKey + "|" + r.Groups[0].Consequences.Count);
}

// ---------- 8. 100 дүгнэлт, MaxVisible = 40 ----------
{
    var st = new FindingFeed.State();
    var list = new List<FindingFeed.Item>();
    for (int i = 0; i < 100; i++) list.Add(It("k" + i, "HIGH", T0 + i, null, false));
    FindingFeed.Result r = FindingFeed.Build(list, st, T0 + 1000, 4);
    Say("8:budget", r.Groups.Count + "|" + r.Truncated);
}

// ---------- 9. 100 дүгнэлт, CRITICAL нь ХАМГИЙН СҮҮЛД ----------
{
    var st = new FindingFeed.State();
    var list = new List<FindingFeed.Item>();
    for (int i = 0; i < 99; i++) list.Add(It("k" + i, "HIGH", T0 + 5000 + i, null, false));
    list.Add(It("crit", "CRITICAL", T0, null, false));   // хамгийн сүүлд, хамгийн ХУУЧИН
    FindingFeed.Result r = FindingFeed.Build(list, st, T0 + 9000, 4);
    bool visible = false;
    foreach (FindingFeed.Group g in r.Groups)
        if (g.Primary.DedupKey == "crit") visible = true;
    Say("9:sort_before_cut", visible + "|" + r.Groups[0].Primary.DedupKey);
}

// ---------- 10. Хүлээн зөвшөөрснөөс 3 хоногийн дараа ----------
{
    var st = new FindingFeed.State();
    FindingFeed.Acknowledge(st, "a", T0);
    var list = new List<FindingFeed.Item> { It("a", "HIGH", T0, null, false) };
    FindingFeed.Result r = FindingFeed.Build(list, st, T0 + 3 * DAY, 4);
    Say("10:snoozed", r.Groups.Count + "|" + r.Hidden);
}

// ---------- 11. Хүлээн зөвшөөрснөөс 8 хоногийн дараа ----------
{
    var st = new FindingFeed.State();
    FindingFeed.Acknowledge(st, "a", T0);
    var list = new List<FindingFeed.Item> { It("a", "HIGH", T0, null, false) };
    FindingFeed.Result r = FindingFeed.Build(list, st, T0 + 8 * DAY, 4);
    Say("11:snooze_expired", r.Groups.Count + "|" + r.Hidden);
}

// ---------- 12. minSeverityRank = 1 (HIGH) ----------
{
    var st = new FindingFeed.State();
    var list = new List<FindingFeed.Item>
    {
        It("a", "CRITICAL", T0, null, false),
        It("b", "HIGH", T0, null, false),
        It("c", "MEDIUM", T0, null, false),
        It("d", "LOW", T0, null, false),
        It("e", "INFO", T0, null, false),
    };
    FindingFeed.Result r = FindingFeed.Build(list, st, T0 + 10, 1);
    Say("12:min_severity", r.Groups.Count + "|" + r.Hidden);
}

// ---------- 13. Хуучирсан мөр ----------
{
    var st = new FindingFeed.State();
    var list = new List<FindingFeed.Item>
    {
        It("stale", "HIGH", T0 + 900, null, true),
        It("fresh", "HIGH", T0, null, false),
    };
    FindingFeed.Result r = FindingFeed.Build(list, st, T0 + 1000, 4);
    Say("13:stale", r.AnyStale + "|" + r.Groups[0].Primary.DedupKey);
}

// ---------- 14. Туузны бичээс, 0 бүлэгтэй ----------
{
    Say("14:badge_empty", Cap(FindingFeed.BadgeCaption(new FindingFeed.Result())));
}

// ---------- 15-20. §80 — ЭРХИЙН ТҮВШИН ----------
{
    var st = new FindingFeed.State();
    var list = new List<FindingFeed.Item>
    {
        It("a", "HIGH", T0, null, false),
        It("b", "HIGH", T0, null, false),
        It("c", "HIGH", T0, null, false),
    };
    FindingFeed.Result r = FindingFeed.Build(list, st, T0 + 10, 4);

    Say("15:observe_hidden", FindingFeed.Surfaces("0"));
    Say("16:explain_shows", FindingFeed.Surfaces("1"));
    Say("17:unknown_hidden", FindingFeed.Surfaces(null));
    Say("18:badge_observe", Cap(FindingFeed.BadgeCaption(r, "0")));
    Say("19:badge_explain", Cap(FindingFeed.BadgeCaption(r, "1")));
    Say("20:recommend_gate",
        FindingFeed.ShowsRecommendation("1") + "|" + FindingFeed.ShowsRecommendation("2"));
}

// ---------- 21-24. F4 — `promoted` (симптомыг «үндэс» гэж нэрлэхгүй) ----------
{
    // Энгийн бүлэг: үндэс нь ЖАГСААЛТАД БАЙНА → `Promoted` ХУДАЛ.
    var st = new FindingFeed.State();
    var list = new List<FindingFeed.Item>
    {
        It("root", "HIGH", T0, null, false),
        It("c1", "MEDIUM", T0, "root", false),
    };
    FindingFeed.Result r = FindingFeed.Build(list, st, T0 + 10, 4);
    Say("21:not_promoted", r.Groups[0].Promoted);
}
{
    // Үндэс нь ХҮЛЭЭН ЗӨВШӨӨРӨГДСӨН → нугалагдсан толгой → `Promoted` ҮНЭН.
    var st = new FindingFeed.State();
    FindingFeed.Acknowledge(st, "root", T0);
    var list = new List<FindingFeed.Item>
    {
        It("root", "CRITICAL", T0, null, false),
        It("c1", "CRITICAL", T0, "root", false),
        It("c2", "HIGH", T0, "root", false),
    };
    FindingFeed.Result r = FindingFeed.Build(list, st, T0 + 60, 4);
    Say("22:promoted_ack", r.Groups[0].Promoted + "|" + r.Groups[0].Primary.DedupKey);
}
{
    // Үндэс нь `minSeverityRank`-ийн ДООР унав → мөн адил `Promoted`.
    var st = new FindingFeed.State();
    var list = new List<FindingFeed.Item>
    {
        It("root", "LOW", T0, null, false),
        It("c1", "CRITICAL", T0, "root", false),
    };
    FindingFeed.Result r = FindingFeed.Build(list, st, T0 + 10, 1);
    Say("23:promoted_filtered", r.Groups[0].Promoted + "|" + r.Groups[0].Primary.DedupKey);
}
{
    // Серверийн `promoted` туг — дотоод нугалалт БОЛООГҮЙ ч ХҮНДЭТГЭНЭ.
    var st = new FindingFeed.State();
    var list = new List<FindingFeed.Item> { Missing("srv", "HIGH", T0) };
    FindingFeed.Result r = FindingFeed.Build(list, st, T0 + 10, 4);
    Say("24:promoted_server", r.Groups[0].Promoted);
}

// ---------- 25-26. МӨРИЙН ТӨСӨВ ----------
{
    // 40 бүлэг × (1 + 9) = 400 мөр.  Мөрийн төсөв 120 → 12 бүлэг Л орно.
    var st = new FindingFeed.State();
    var list = new List<FindingFeed.Item>();
    for (int g = 0; g < 40; g++)
    {
        list.Add(It("r" + g, "HIGH", T0 + g, null, false));
        for (int c = 0; c < 9; c++) list.Add(It("r" + g + "c" + c, "MEDIUM", T0, "r" + g, false));
    }
    FindingFeed.Result r = FindingFeed.Build(list, st, T0 + 1000, 4);
    int rows = 0;
    foreach (FindingFeed.Group g in r.Groups) rows += 1 + g.Consequences.Count;
    Say("25:row_budget", r.Groups.Count + "|" + rows + "|" + r.Truncated);
}
{
    // ⚠️ Мөрийн төсөв дүүрэхэд ХӨНГӨН бүлэг ХҮНД бүлгийг ТОЙРЧ ГАРАХГҮЙ.
    //    Эхний 12 бүлэг том (10 мөр), 13 дахь нь ганц мөртэй CRITICAL БИШ
    //    LOW — тэр багтахаар байсан ч эрэмбийг эвдэхгүйн тулд ОРОХГҮЙ.
    var st = new FindingFeed.State();
    var list = new List<FindingFeed.Item>();
    for (int g = 0; g < 12; g++)
    {
        list.Add(It("r" + g, "HIGH", T0 + g, null, false));
        for (int c = 0; c < 9; c++) list.Add(It("r" + g + "c" + c, "MEDIUM", T0, "r" + g, false));
    }
    list.Add(It("tiny", "LOW", T0, null, false));
    FindingFeed.Result r = FindingFeed.Build(list, st, T0 + 1000, 4);
    bool tinyShown = false;
    foreach (FindingFeed.Group g in r.Groups) if (g.Primary.DedupKey == "tiny") tinyShown = true;
    Say("26:no_queue_jump", r.Groups.Count + "|" + tinyShown + "|" + r.Truncated);
}

// ---------- 27-33. F5 — ГАДАРГУУГИЙН ТӨЛӨВ ----------
{
    // Түвшин уншаагүй.
    Say("27:state_unknown", FindingFeed.StateOf(null, false, true, true, true, 0));
    // LEVEL 0 — ажиглалт.
    Say("28:state_observe", FindingFeed.StateOf("0", false, true, true, true, 0));
    // Багц алга — өдөр тутмын төлөв, `NoProducer`-оос ӨМНӨ.
    Say("29:state_nopack", FindingFeed.StateOf("1", true, false, false, false, 0));
    // ⛔ F5-ийн ЯГ ТЭР ХОРОМ: багц ирлээ, ҮЙЛДВЭРЛЭГЧ АЛГА.
    Say("30:state_noproducer", FindingFeed.StateOf("1", false, false, false, false, 0));
    // Суваг бий, үр дүн хараахан ирээгүй.
    Say("31:state_notyet", FindingFeed.StateOf("1", false, true, false, false, 0));
    // Хүргэгдсэн, гэхдээ зөвхөн ӨСӨЛТӨТ мөчлөг — «цэвэр» БИШ.
    Say("32:state_partial", FindingFeed.StateOf("1", false, true, true, false, 0));
    // Бүтэн скан + хоосон → ЦОРЫН ГАНЦ «цэвэр».
    Say("33:state_clean", FindingFeed.StateOf("1", false, true, true, true, 0));
    // Мөр байвал үргэлж `Findings`.
    Say("34:state_findings", FindingFeed.StateOf("1", false, true, true, false, 3));
}

// ---------- 35. ⛔ ГЭРЭЭ: ХҮРГЭЛТГҮЙГЭЭР «ЦЭВЭР» ГЭЖ ХЭЗЭЭ Ч БУЦААХГҮЙ ----------
{
    // Бүх хувиргалтыг ТООЧНО.  Энэ нь F5-ийн регрессийн зангуу: ирээдүйд
    // хэн нэгэн `StateOf`-ыг «хялбарчилвал» ЭНД унана.
    string[] levels = { null, "", "x", "0", "1", "2", "3", "4", "5" };
    bool leak = false;
    int seen = 0;
    foreach (string lv in levels)
    foreach (bool noPack in new bool[] { false, true })
    foreach (bool wired in new bool[] { false, true })
    foreach (bool delivered in new bool[] { false, true })
    foreach (bool whole in new bool[] { false, true })
    foreach (int n in new int[] { 0, 1, 40 })
    {
        seen++;
        FindingFeed.SurfaceState s = FindingFeed.StateOf(lv, noPack, wired, delivered, whole, n);
        // (1) Хүргэгдээгүй / суваггүй бол «цэвэр» ГЭЖ ХЭЗЭЭ Ч ХЭЛЭХГҮЙ.
        if (FindingFeed.ClaimsClean(s) && (!delivered || !wired)) leak = true;
        // (2) Багц байхгүй бол ч «цэвэр» ГЭЖ ХЭЛЭХГҮЙ.
        if (FindingFeed.ClaimsClean(s) && noPack) leak = true;
        // (3) Бүтэн скан хийгээгүй бол «цэвэр» ГЭЖ ХЭЛЭХГҮЙ.
        if (FindingFeed.ClaimsClean(s) && !whole) leak = true;
        // (4) Мөр байхад «цэвэр» ГЭЖ ХЭЛЭХГҮЙ.
        if (FindingFeed.ClaimsClean(s) && n > 0) leak = true;
    }
    Say("35:no_silent_pass", leak + "|" + seen);
}
"""

CASES = [
    # --- спекийн ЗААВАЛ шалгах 14 тохиолдол ---
    ("1:empty", "0"),                       # онцгой шидэхгүй
    ("2:nullitem", "1"),                    # null-ыг алгасана, унахгүй
    ("3:severity_first", "crit"),           # CRITICAL нь ЭХЭНД
    ("4:newest_first", "new"),              # ижил хүнд байдалд сүүлийнх нь ДЭЭР
    ("5:root_group", "1|root|3"),           # нэг бүлэг, үндэс нь толгой
    ("6:fold", "9|20"),                     # 9 харуулна, 20 гэж хэлнэ
    ("7:promote", "1|c1|2"),                # үндэс нуугдвал хамгийн хүнд дагавар толгой болно
    ("8:budget", "40|60"),                  # эрэмбэлсний ДАРАА таслав
    ("9:sort_before_cut", "True|crit"),     # ⚠️ ЭНЭ ФАЙЛЫН ОРШИН БАЙХ ШАЛТГААН
    ("10:snoozed", "0|1"),                  # 3 хоног — нуугдсан хэвээр
    ("11:snooze_expired", "1|0"),           # 8 хоног — ДАХИН харагдана
    ("12:min_severity", "2|3"),             # MEDIUM/LOW/INFO нуугдана
    ("13:stale", "True|fresh"),             # хуучирсан нь ДООР
    ("14:badge_empty", "Норм/шалгалт"),     # тоо БАЙХГҮЙ

    # --- §80 эрхийн түвшин (спекийн 14-өөс ГАДНА, ЭНЭ СЕССИЙН нэмэлт) ---
    ("15:observe_hidden", "False"),         # LEVEL 0 — цуглуулна, ХАРУУЛАХГҮЙ
    ("16:explain_shows", "True"),
    ("17:unknown_hidden", "False"),         # null нь 0 БИШ, гэхдээ мөн ХААЛТТАЙ
    ("18:badge_observe", "Норм/шалгалт"),   # LEVEL 0 дээр ТОО Ч ГАРАХГҮЙ
    ("19:badge_explain", "Норм/шалгалт (3)"),
    ("20:recommend_gate", "False|True"),    # зөвлөмж нь LEVEL 2-оос

    # --- F4: `promoted` — симптомыг «Үндсэн шалтгаан» гэж НЭРЛЭХГҮЙ ---
    ("21:not_promoted", "False"),           # үндэс нь жагсаалтад БАЙНА
    ("22:promoted_ack", "True|c1"),         # үндэс хүлээн зөвшөөрөгдөв
    ("23:promoted_filtered", "True|c1"),    # үндэс босгоос доогуур унав
    ("24:promoted_server", "True"),         # серверийн `promoted` тугийг зөөв

    # --- Мөрийн төсөв (40 бүлэг × 10 мөр = 400 мөр байсан) ---
    ("25:row_budget", "12|120|28"),         # 120 мөрөөр тасална
    ("26:no_queue_jump", "12|False|1"),     # хөнгөн бүлэг хүндийг ТОЙРОХГҮЙ

    # --- F5: гадаргуугийн ЗУРГААН өөр «дүгнэлт алга» ---
    ("27:state_unknown", "AuthorityUnknown"),
    ("28:state_observe", "Observe"),
    ("29:state_nopack", "NoPack"),
    ("30:state_noproducer", "NoProducer"),  # ⛔ багц ирсэн, суваг алга
    ("31:state_notyet", "NotYetRun"),
    ("32:state_partial", "PartialClean"),   # өсөлтөт мөчлөг ≠ «цэвэр»
    ("33:state_clean", "Clean"),
    ("34:state_findings", "Findings"),

    # --- F5-ийн РЕГРЕССИЙН ЗАНГУУ: 432 хувиргалтын АЛЬ Ч НЬ ---
    #     хүргэлтгүй/суваггүй/багцгүй/бүтэн скангүй байхад «цэвэр» гэж
    #     буцаах ЁСГҮЙ.  Энэ мөр улаан болбол чимээгүй тэнцэл эргэж ирсэн.
    ("35:no_silent_pass", "False|432"),
]

REQUIRED = 14   # спекийн заавал шалгах тоо


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp)
        (d / "feedcheck.csproj").write_text(
            CSPROJ.replace("__FEED__", str((ADDIN / "FindingFeed.cs").resolve())),
            encoding="utf-8")
        (d / "Program.cs").write_text(MAIN, encoding="utf-8")

        r = subprocess.run(["dotnet", "run", "--project", str(d / "feedcheck.csproj")],
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
    req_ok = 0
    print(f"  {'тохиолдол':24} {'үр дүн':>22} {'хүлээсэн':>22}")
    print("  " + "-" * 72)
    for idx, (key, want) in enumerate(CASES):
        have = got.get(key, "<АЛГА>")
        good = have == want
        ok += good
        if idx < REQUIRED:
            req_ok += good
        print(f"  {'✅' if good else '❌'} {key[:22]:22} {have:>22} {want:>22}")

    print(f"\n  {ok}/{len(CASES)} зөв  (спекийн заавал {req_ok}/{REQUIRED})")
    if ok < len(CASES):
        sys.exit(1)


if __name__ == "__main__":
    main()
