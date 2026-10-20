r"""ДҮРМИЙН ХӨДӨЛГҮҮРИЙН ШАЛГАЛТ — `addin/RuleEngine.cs`-ийг Revit-гүйгээр тулгана.

`check_nudge.py` (`:32-45`)-ийн ЯГ ИЖИЛ хэв маяг: Revit-д хүрдэггүй `.cs`
файлуудыг түр `net10.0` console төсөлд хийж `dotnet run` хийнэ.  `addin/`-д C#
тест ТЭГ бөгөөд net48 (R24) build нь Revit 2024-ийн API-тай тул шинэ
хувилбарын төрөл хэрэглэж болохгүй — тиймээс энэ гурван (+RuleDef-ийн улмаас
дөрөв дэх) файл нь Autodesk.Revit-ийн ямар ч төрөлгүй байхаар зохиогдсон.

    ..\..\server\.venv\Scripts\python.exe check_rules.py
    ..\..\server\.venv\Scripts\python.exe check_rules.py --parity

ЗҮГЭЭР ГҮЙЛТ  — §3.13-ын 12 семантик кейсийг C# тал дээр шалгана.
`--parity`   — §3.13.1-ийн P1–P8 хамаарлын fixture-ийг **ХОЁР ТАЛ** дээр
               ажиллуулж, `kind` / `reason` / `missing[]` ГУРВЫГ мөр мөрөөр
               тулгана.  ⚠️ «Хэдэн хувь таарлаа» гэсэн ЗӨӨЛӨН хаалга БАЙХГҮЙ —
               нэг ч мөр зөрвөл exit 1.

⚠️ ЯАГААД ТУЛГАЛТ ХЭРЭГТЭЙ ВЭ: §61-ийн предикат ХОЁР ХЭЛ ДЭЭР ХОЁР УДАА
   бичигдсэн (`backend/src/lib/ruleApplicability.ts` ↔ `addin/RuleEngine.cs`)
   бөгөөд тэднийг тэнцүү байлгах юу ч БАЙХГҮЙ.  Ажиллах үед C# тал ШИЙДНЭ,
   харин `2-7`-ийн `rule_run_ledger.skipped_reason` ХҮЛЭЭЛТ нь TS талаас
   тооцогдоно — зөрвөл дүрэм АЛГАСАГДАЖ, бэлэн байдлын хаалга НОГООН болно.
   `check_parity.py:16-18` нь 2026-08-24-нд яг ийм зөрүүг бодитоор олсон.
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

HERE = Path(__file__).resolve().parent
ADDIN = HERE.parent / "addin"
REPO = HERE.parent.parent
BACKEND_LIB = REPO / "backend" / "src" / "lib"

# ⚠️ `RuleDef` нь `RulePack.cs`-д амьдардаг тул ГУРВЫН оронд ДӨРВӨН файл
#    эмхэтгэнэ.  Дөрвүүлээ Autodesk.Revit-гүй — `grep -c "Autodesk.Revit"` = 0.
CS_FILES = ["Units.cs", "RuleFacts.cs", "RuleEngine.cs", "RulePack.cs"]

CSPROJ = """<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>disable</Nullable>
    <ImplicitUsings>disable</ImplicitUsings>
    <AssemblyName>rulecheck</AssemblyName>
    <EnableSourceControlManagerQueries>false</EnableSourceControlManagerQueries>
    <EnableSourceLink>false</EnableSourceLink>
    <NoWarn>$(NoWarn);CS0649</NoWarn>
  </PropertyGroup>
  <ItemGroup>
__COMPILE__
  </ItemGroup>
</Project>
"""

# ⚠️ Тусгаарлагч " || " — `check_nudge.py`-ийн заншил.
MAIN = r"""using System;
using System.Collections.Generic;
using System.Text.Json;
using RevitMcpAddin;

Console.OutputEncoding = System.Text.Encoding.UTF8;

// ⚠️ БОСГЫГ ТОГТМОЛООС УНШИНА, ЛИТЕРАЛААР БИЧИХГҮЙ.  Хос файлын тулгалт нь
//    ЯГ ҮҮН ДЭЭР зогсоно: `RuleEngine.HIGH_RISE_HEIGHT_M`-ыг 50 болгосон засвар
//    P2 fixture-ийг зөрүүлж, `--parity` УЛААН болно.  Литералаар бичвэл
//    тогтмол нь дүрмийн замд ОРОХГҮЙ бөгөөд тулгалт ЮУ Ч барихгүй.
string Fmt(double v) { return v.ToString("0.######", System.Globalization.CultureInfo.InvariantCulture); }
string APP = "{\"all\":[{\"any\":[{\"project.height_m\":{\"gt\":" + Fmt(RuleEngine.HIGH_RISE_HEIGHT_M) + "}},"
           + "{\"project.stories_above_grade\":{\"gt\":" + Fmt(RuleEngine.HIGH_RISE_STORIES) + "}}]},"
           + "{\"doc.room_boundary_location\":{\"eq\":\"Finish\"}},"
           + "{\"element.category\":{\"eq\":\"Rooms\"}},"
           + "{\"element.name_folded\":{\"contains_any\":[\"hongil\",\"koridor\"]}}]}";
string CHK = "{\"if\":{\"element.length_m\":{\"gt\":10}},"
                 + "\"then\":{\"element.clear_width_mm\":{\"gte\":1500}},"
                 + "\"else\":{\"element.clear_width_mm\":{\"gte\":1200}}}";

CheckNode Parse(string json, bool check)
{
    JsonDocument d = JsonDocument.Parse(json);
    CheckNode n;
    string err;
    bool ok = check
        ? RuleEngine.TryParseCheck(d.RootElement, out n, out err)
        : RuleEngine.TryParsePredicate(d.RootElement, out n, out err);
    if (!ok) throw new Exception("parse: " + err);
    return n;
}

RuleDef Rule(string verification, string unit, string appJson, string chkJson)
{
    RuleDef r = new RuleDef();
    r.RuleUid = "BA-HR-CORRIDOR-W-001";
    r.Version = 1;
    r.TeamCode = "BA";
    r.VerificationState = verification;
    r.IssueClass = "REGULATORY_VIOLATION";
    r.Severity = "HIGH";
    r.Unit = unit;
    r.CoordinateSystem = "none";
    r.RequiresContext = new string[] { "project.height_m", "doc.room_boundary_location" };
    r.Applicability = appJson == null ? null : Parse(appJson, false);
    r.Check = chkJson == null ? null : Parse(chkJson, true);
    r.Requires = new RuleRequires();
    r.Requires.Params = new string[] { "clear_width_mm", "length_m" };
    r.Requires.TriggeredBy = new RuleTrigger[0];
    r.Exceptions = new RuleException[0];
    return r;
}

ProjectBuildContext Ctx(double? h, double? st, string boundary)
{
    ProjectBuildContext c = ProjectBuildContext.Empty();
    c.ProjectId = 1;
    c.HeightM = h;
    c.StoriesAboveGrade = st;
    c.RoomBoundaryLocation = boundary;
    return c;
}

FactBag Bag(ProjectBuildContext c, string category, string name,
            double? lengthM, double? widthMm, string widthUnit, QuantitySource widthSrc)
{
    var el = new Dictionary<string, FactValue>(StringComparer.Ordinal);
    if (name != null) el["name_folded"] = FactValue.OfText(name);
    if (lengthM.HasValue)
        el["length_m"] = FactValue.OfNumber(
            Quantity.Of(lengthM.Value, "M", QuantitySource.BuiltinGeometry, null));
    if (widthMm.HasValue)
        el["clear_width_mm"] = FactValue.OfNumber(
            Quantity.Of(widthMm.Value, widthUnit, widthSrc, widthSrc == QuantitySource.TypedParam ? "spec" : null));
    return new FactBag(c, null, el, category);
}

string Join(string[] a)
{
    if (a == null || a.Length == 0) return "-";
    return string.Join(",", a);
}

void Case(string name, RuleDef rule, FactBag bag)
{
    Applicability app;
    RuleOutcome o = RuleEngine.Execute(rule, bag, out app);
    if (o == null)
    {
        Console.WriteLine(name + " || NOT_APPLICABLE || - || - || " + (app.Reason ?? "-") + " || -");
        return;
    }
    Console.WriteLine(name + " || " + o.Result.ToString().ToUpperInvariant()
        + " || " + (o.Severity ?? "-")
        + " || " + (o.EvidenceLevel ?? "-")
        + " || " + (o.UncertainReason ?? "-")
        + " || " + Join(o.MissingInputs));
}

RuleDef verified = Rule("HUMAN_VERIFIED", "MM", APP, CHK);
RuleDef unverified = Rule("UNVERIFIED", "MM", APP, CHK);

ProjectBuildContext hi = Ctx(52, null, "Finish");

// 1-3: босгын гурвал
Case("threshold_minus", verified, Bag(hi, "Rooms", "hongil 3", 12, 1499, "MM", QuantitySource.Computed));
Case("threshold",       verified, Bag(hi, "Rooms", "hongil 3", 12, 1500, "MM", QuantitySource.Computed));
Case("threshold_plus",  verified, Bag(hi, "Rooms", "hongil 3", 12, 1501, "MM", QuantitySource.Computed));

// 4: ЖИНХЭНЭ ТЭГ нь `missing` БИШ
Case("zero",            verified, Bag(hi, "Rooms", "hongil 3", 12, 0, "MM", QuantitySource.Computed));

// 5: оролт байхгүй
Case("missing_input",   verified, Bag(hi, "Rooms", "hongil 3", 12, null, "MM", QuantitySource.Computed));

// 6: нэгж зөрөв (M vs MM) — ЧИМЭЭГҮЙ ХӨРВҮҮЛЭЛТ БАЙХГҮЙ
Case("mixed_units",     verified, Bag(hi, "Rooms", "hongil 3", 12, 1.42, "M", QuantitySource.Computed));

// 7: эх үүсвэр зөрөв — таамаглах эрхгүй
Case("mixed_provenance", verified, Bag(hi, "Rooms", "hongil 3", 12, 1200, "MM", QuantitySource.UntypedParam));

// 8: контекст байхгүй → NOT_APPLICABLE БИШ, UNCERTAIN
Case("no_context",      verified, Bag(Ctx(null, null, "Finish"), "Rooms", "hongil 3", 12, 1400, "MM", QuantitySource.Computed));

// 10: UNVERIFIED ХАВЧААР — VIOLATION → WARNING, evidence → MODEL_DERIVED
Case("clamp_unverified", unverified, Bag(hi, "Rooms", "hongil 3", 12, 1499, "MM", QuantitySource.Computed));

// 11: boundary location зөрөв → NOT_APPLICABLE
Case("boundary_center", verified, Bag(Ctx(52, null, "Center"), "Rooms", "hongil 3", 12, 1499, "MM", QuantitySource.Computed));

// 12: DEG дүрэм РАДИАН эх сурвалж дээр — ҮРГЭЛЖ PASS БАЙЖ БОЛОХГҮЙ
{
    const string SLOPE = "{\"element.ramp_slope_deg\":{\"lte\":5}}";
    RuleDef deg = Rule("HUMAN_VERIFIED", "DEG", null, SLOPE);
    var el = new Dictionary<string, FactValue>(StringComparer.Ordinal);
    // 0.0873 радиан = 5°.  Нэгжийг NONE гэж зарлавал нэр↔нэгж ЗӨРНӨ.
    el["ramp_slope_deg"] = FactValue.OfNumber(
        Quantity.Of(0.0873, "NONE", QuantitySource.BuiltinGeometry, null));
    Case("deg_radian_source", deg, new FactBag(hi, null, el, "Ramps"));
}

// 9: зөрчилдөөн — НЭГ UNCERTAIN, ConflictRuleUids >= 2
{
    ConflictEntry e = new ConflictEntry();
    e.RuleUidA = "BA-HR-CORRIDOR-W-001";
    e.RuleUidB = "BB-COL-ENCROACH-002";
    e.ConflictKind = "threshold";
    e.Scope = "intra_pack";
    ConflictTable t = ConflictTable.Build(new ConflictEntry[] { e });

    RuleOutcome a = new RuleOutcome();
    a.RuleUid = "BA-HR-CORRIDOR-W-001"; a.RuleVersion = 1; a.Result = Verdict.Violation;
    a.Severity = "CRITICAL"; a.EvidenceLevel = "AI_INFERRED"; a.Unit = "MM";
    a.MissingInputs = new string[0]; a.ConflictRuleUids = new string[0];
    RuleOutcome b = new RuleOutcome();
    b.RuleUid = "BB-COL-ENCROACH-002"; b.RuleVersion = 1; b.Result = Verdict.Pass;
    b.Severity = "LOW"; b.EvidenceLevel = "HUMAN_VERIFIED"; b.Unit = "MM";
    b.MissingInputs = new string[0]; b.ConflictRuleUids = new string[0];

    RuleOutcome[] merged = RuleEngine.Reconcile(new RuleOutcome[] { b, a }, t);
    RuleOutcome m = merged[0];
    Console.WriteLine("conflict || " + m.Result.ToString().ToUpperInvariant()
        + " || " + m.Severity + " || " + m.EvidenceLevel
        + " || " + (m.UncertainReason ?? "-") + " || " + Join(m.ConflictRuleUids));
}

// ---------- P1-P8: ХАМААРЛЫН ПАРИТЕТЫН FIXTURE ----------
void P(string name, ProjectBuildContext c, string category, string nameFolded)
{
    Applicability a = RuleEngine.EvaluateApplicability(verified, Bag(c, category, nameFolded, 12, 1400, "MM", QuantitySource.Computed));
    Console.WriteLine("P:" + name + " || " + a.Kind + " || " + (a.Reason ?? "-") + " || " + Join(a.Missing));
}

// ---------- W1-W7: СЕРВЕР→КЛИЕНТИЙН ЗААГ (`exceptions[].when` + ЭШЛЭЛ) ----------
// ⚠️ ЭНД БАГЦЫН БАЙТААС ЭХЛЭНЭ, `RuleDef`-ийг кодоор угсрахгүй.  Хоёр уналт
//    хоёулаа ЗӨВХӨН тэр заагт амьдардаг байсан:
//      W1 — сервер `when`-ийг гаргадаггүй байсан → `RuleEngine` үл хамаарах
//           зүйлийг АЛГАСААД атриум бүрийг зөрчил гэж мэдээлдэг (fail-open).
//      W5 — UNVERIFIED дүрэм эшлэлээ утсан дээр гаргадаг байсан.
const string CIT = "\"document_uid\":\"BNBD-31-03\",\"clause_uid\":\"4.2\",\"edition_ref\":\"2021\",";
const string EX_WITH = "[{\"code\":\"atrium\",\"when\":{\"element.name_folded\":{\"contains_any\":[\"atrium\"]}},\"note_mn\":null}]";
const string EX_NO_WHEN = "[{\"code\":\"atrium\",\"note_mn\":null}]";
const string EX_EMPTY_WHEN = "[{\"code\":\"atrium\",\"when\":{},\"note_mn\":null}]";

string PackJson(string verification, string citation, string exceptions)
{
    return "{\"pack_contract\":\"rulepack-v1\",\"team_code\":\"BA\","
        + "\"ruleset_version\":\"2026-09-01.1\",\"pack_sha256\":\"__SHA__\","
        + "\"generated_at\":\"2026-09-01T00:00:00Z\","
        + "\"project_context\":{\"project_id\":1,\"jurisdiction\":\"MN\"},"
        + "\"rules\":[{\"rule_uid\":\"BA-CEIL-H-002\",\"version\":1,\"team_code\":\"BA\","
        + "\"semantic_hash\":\"cccc\",\"title_mn\":\"Tooz\",\"title_en\":null,"
        + citation
        + "\"effective_from\":null,\"verification_state\":\"" + verification + "\","
        + "\"issue_class\":\"REGULATORY_VIOLATION\",\"severity\":\"HIGH\",\"unit\":\"MM\","
        + "\"coordinate_system\":\"none\",\"expect_applicable\":true,\"requires_context\":[],"
        + "\"applicability\":{\"element.category\":{\"eq\":\"Ceilings\"}},"
        + "\"check\":{\"element.ceiling_h_mm\":{\"gte\":2500}},"
        + "\"requires\":{\"params\":[\"name_folded\",\"ceiling_h_mm\"],\"triggered_by\":[]},"
        + "\"exceptions\":" + exceptions + ",\"recommendation_mn\":null}],\"conflicts\":[]}";
}

// ⚠️ `ComputePackSha256` нь `pack_sha256` ба `generated_at`-ыг ХООСОН МӨР
//    болгож канончилдог тул хоосон утга дээр тооцоод буцааж тавихад хүчинтэй.
RulePack.Loaded LoadPack(string template)
{
    string bare = template.Replace("__SHA__", "");
    string sha;
    using (JsonDocument d0 = JsonDocument.Parse(bare)) { sha = RulePack.ComputePackSha256(d0.RootElement); }
    if (sha == null) return null;
    return RulePack.ParseVerified(template.Replace("__SHA__", sha), null);
}

FactBag CeilBag(string nameFolded, double heightMm)
{
    var el = new Dictionary<string, FactValue>(StringComparer.Ordinal);
    el["name_folded"] = FactValue.OfText(nameFolded);
    el["ceiling_h_mm"] = FactValue.OfNumber(
        Quantity.Of(heightMm, "MM", QuantitySource.Computed, null));
    return new FactBag(ProjectBuildContext.Empty(), null, el, "Ceilings");
}

void WireCase(string name, string verification, string citation, string exceptions,
              string nameFolded, double heightMm)
{
    RulePack.Loaded pack = LoadPack(PackJson(verification, citation, exceptions));
    if (pack == null || pack.Rules == null || pack.Rules.Length != 1)
    {
        Console.WriteLine(name + " || REJECTED");
        return;
    }
    RuleDef rd = pack.Rules[0];
    Applicability ap;
    RuleOutcome oc = RuleEngine.Execute(rd, CeilBag(nameFolded, heightMm), out ap);
    string verdict = oc == null ? "NOT_APPLICABLE" : oc.Result.ToString().ToUpperInvariant();
    string reason = oc == null ? (ap.Reason ?? "-") : "-";
    Console.WriteLine(name + " || " + verdict + " || " + reason
        + " || " + (rd.DocumentUid ?? "-") + " || " + (rd.ClauseUid ?? "-")
        + " || " + (rd.EditionRef ?? "-")
        + " || " + (oc == null ? "-" : (oc.SuppressCitation ? "true" : "false"))
        + " || " + (oc == null ? "-" : (oc.CitationLabelMn ?? "-")));
}

// W1 - `when` YNEN -> duurem HAMAARAHGUI (ul hamaarah zuil ZORCHLIIG DARNA).
WireCase("W:exception_fires", "HUMAN_VERIFIED", CIT, EX_WITH, "atrium 1", 2200);
// W2 - SOROG HYNALT: atrium BISH tooz ni HEVEER zorchil.
WireCase("W:exception_negative", "HUMAN_VERIFIED", CIT, EX_WITH, "oroo 5", 2200);
// W3 - `when`-gui ul hamaarah zuil -> BUH BAGTS TATGALZANA (fail-closed).
WireCase("W:when_missing", "HUMAN_VERIFIED", CIT, EX_NO_WHEN, "atrium 1", 2200);
// W4 - HOOSON `when` ch mun TATGALZANA.
WireCase("W:when_empty", "HUMAN_VERIFIED", CIT, EX_EMPTY_WHEN, "atrium 1", 2200);
// W5 - UNVERIFIED: eshlel HOOSLOGDONO + HAVCHAAR ni VIOLATION -> WARNING.
WireCase("W:unverified_citation", "UNVERIFIED", CIT, EX_WITH, "oroo 5", 2200);
// W6 - HUMAN_VERIFIED: eshlel HEVEER, daragdahgui.
WireCase("W:verified_citation", "HUMAN_VERIFIED", CIT, EX_WITH, "oroo 5", 2200);

// W7 - EVLERUULELT ni daragdsan eshleliig SERGEEHGUI.
{
    ConflictEntry ce = new ConflictEntry();
    ce.RuleUidA = "AA-1"; ce.RuleUidB = "BB-2";
    ce.ConflictKind = "threshold"; ce.Scope = "intra_pack";
    ConflictTable ct = ConflictTable.Build(new ConflictEntry[] { ce });

    RuleOutcome ua = new RuleOutcome();
    ua.RuleUid = "AA-1"; ua.RuleVersion = 1; ua.Result = Verdict.Warning;
    ua.Severity = "HIGH"; ua.EvidenceLevel = "MODEL_DERIVED"; ua.Unit = "MM";
    ua.MissingInputs = new string[0]; ua.ConflictRuleUids = new string[0];
    RuleEngine.ClampByVerification(ua, "UNVERIFIED");
    RuleOutcome vb = new RuleOutcome();
    vb.RuleUid = "BB-2"; vb.RuleVersion = 1; vb.Result = Verdict.Pass;
    vb.Severity = "LOW"; vb.EvidenceLevel = "HUMAN_VERIFIED"; vb.Unit = "MM";
    vb.MissingInputs = new string[0]; vb.ConflictRuleUids = new string[0];
    RuleEngine.ClampByVerification(vb, "HUMAN_VERIFIED");

    RuleOutcome mg = RuleEngine.Reconcile(new RuleOutcome[] { vb, ua }, ct)[0];
    Console.WriteLine("W:conflict_citation || " + (mg.SuppressCitation ? "true" : "false")
        + " || " + (mg.CitationLabelMn ?? "-"));
}

P("P1", Ctx(52, null, "Finish"), "Rooms", "hongil 3");
P("P2", Ctx(51, 16, "Finish"), "Rooms", "hongil 3");
P("P3", Ctx(null, null, "Finish"), "Rooms", "hongil 3");
P("P4", Ctx(null, 17, "Finish"), "Rooms", "hongil 3");
P("P5", Ctx(52, null, "Center"), "Rooms", "hongil 3");
P("P6", Ctx(52, null, null), "Rooms", "hongil 3");
P("P7", Ctx(52, null, "Finish"), "Walls", "hongil 3");
P("P8", Ctx(52, null, "Finish"), "Rooms", "oroo 12");
"""

# TS тал — ЯГ ИЖИЛ P1-P8-ыг ижил форматаар хэвлэнэ.
NODE_MAIN = r"""import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const M = await import('__MODEL__');
const A = await import('__APPLIC__');

// ⚠️ БОСГЫГ ТОГТМОЛООС УНШИНА (C# талтай ижил шалтгаан) — литералаар бичвэл
// хос файлын тулгалт ЮУ Ч барихгүй.
const APP = {
  all: [
    { any: [
        { 'project.height_m': { gt: A.HIGH_RISE_HEIGHT_M } },
        { 'project.stories_above_grade': { gt: A.HIGH_RISE_STORIES } },
      ] },
    { 'doc.room_boundary_location': { eq: 'Finish' } },
    { 'element.category': { eq: 'Rooms' } },
    { 'element.name_folded': { contains_any: ['hongil', 'koridor'] } },
  ],
};
const parsed = M.parsePredicate(APP);
if (!parsed.ok) throw new Error('parse: ' + parsed.error);

const rule = {
  ruleUid: 'BA-HR-CORRIDOR-W-001', version: 1, semanticHash: '', teamCode: 'BA',
  titleMn: '', titleEn: null, documentUid: null, clauseUid: null, editionRef: null,
  effectiveFrom: null, verificationState: 'HUMAN_VERIFIED',
  issueClass: 'REGULATORY_VIOLATION', severity: 'HIGH', unit: 'MM',
  coordinateSystem: 'none', expectApplicable: true,
  requiresContext: ['project.height_m', 'doc.room_boundary_location'],
  applicability: parsed.node, check: null,
  requires: { params: ['clear_width_mm', 'length_m'], triggeredBy: [] },
  exceptions: [], recommendationMn: null,
};

function ctx(h, st, boundary) {
  return { ...M.emptyBuildContext(1, ''), heightM: h, storiesAboveGrade: st,
           roomBoundaryLocation: boundary };
}

function bag(c, category, nameFolded) {
  const element = {};
  if (nameFolded !== null) element['name_folded'] = { kind: 'text', value: nameFolded };
  element['length_m'] = { kind: 'number', value: 12, unit: 'M', source: 'builtin_geometry', specId: null };
  element['clear_width_mm'] = { kind: 'number', value: 1400, unit: 'MM', source: 'computed', specId: null };
  return M.createFactBag({ context: c, element, dirtyCategory: category });
}

function P(name, c, category, nameFolded) {
  const a = A.evaluateApplicability(rule, c, bag(c, category, nameFolded));
  const missing = a.kind === 'UNCERTAIN' && a.missing.length ? a.missing.join(',') : '-';
  const reason = a.kind === 'NOT_APPLICABLE' ? a.reason : '-';
  console.log('P:' + name + ' || ' + a.kind + ' || ' + reason + ' || ' + missing);
}

P('P1', ctx(52, null, 'Finish'), 'Rooms', 'hongil 3');
P('P2', ctx(51, 16, 'Finish'), 'Rooms', 'hongil 3');
P('P3', ctx(null, null, 'Finish'), 'Rooms', 'hongil 3');
P('P4', ctx(null, 17, 'Finish'), 'Rooms', 'hongil 3');
P('P5', ctx(52, null, 'Center'), 'Rooms', 'hongil 3');
P('P6', ctx(52, null, null), 'Rooms', 'hongil 3');
P('P7', ctx(52, null, 'Finish'), 'Walls', 'hongil 3');
P('P8', ctx(52, null, 'Finish'), 'Rooms', 'oroo 12');
"""

# name -> "VERDICT || SEVERITY || EVIDENCE || REASON || MISSING"
CASES = [
    ("threshold_minus",   "VIOLATION || HIGH || MODEL_DERIVED || - || -"),
    ("threshold",         "PASS || HIGH || MODEL_DERIVED || - || -"),
    ("threshold_plus",    "PASS || HIGH || MODEL_DERIVED || - || -"),
    # ⚠️ ЖИНХЭНЭ ТЭГ нь VIOLATION, MissingInputs ХООСОН — `zero` ба
    #    `missing_input` нь ХОЁР ӨӨР кейс (v2 §63).
    ("zero",              "VIOLATION || HIGH || MODEL_DERIVED || - || -"),
    ("missing_input",     "UNCERTAIN || HIGH || MODEL_DERIVED || missing_input || element.clear_width_mm"),
    ("mixed_units",       "UNCERTAIN || HIGH || MODEL_DERIVED || mixed_units || element.clear_width_mm"),
    ("mixed_provenance",  "UNCERTAIN || HIGH || MODEL_DERIVED || mixed_provenance || element.clear_width_mm"),
    # ⚠️ Контекст байхгүй нь NOT_APPLICABLE БИШ — «шалгалт хийгдээгүй» гэдэг
    #    нь «загвар цэвэр» гэсэн үг БИШ.
    ("no_context",        "UNCERTAIN || HIGH || MODEL_DERIVED || missing_context || project.height_m"),
    # ⚠️ ХАВЧААР: VIOLATION → WARNING, evidence → MODEL_DERIVED.
    ("clamp_unverified",  "WARNING || HIGH || MODEL_DERIVED || - || -"),
    ("boundary_center",   "NOT_APPLICABLE || - || - || boundary_location || -"),
    # ⚠️ Радиан эх сурвалж ХЭЗЭЭ Ч чимээгүй PASS болохгүй.
    ("deg_radian_source", "UNCERTAIN || HIGH || MODEL_DERIVED || mixed_units || element.ramp_slope_deg"),
    # ⚠️ Зөрчилдөөн: НЭГ UNCERTAIN, хамгийн өндөр severity, хамгийн бага
    #    evidence, ConflictRuleUids >= 2.
    ("conflict",          "UNCERTAIN || CRITICAL || AI_INFERRED || conflict || BA-HR-CORRIDOR-W-001,BB-COL-ENCROACH-002"),

    # ---- W1-W7: СЕРВЕР→КЛИЕНТИЙН ЗААГ ----
    # Формат: VERDICT || REASON || DOCUMENT_UID || CLAUSE_UID || EDITION_REF
    #         || SUPPRESS_CITATION || CITATION_LABEL_MN
    # ⚠️ W1: `exceptions[].when` нь утсан дээр ИРЭХГҮЙ бол ЭНЭ МӨР
    #    «VIOLATION» болно — яг тэр нь дүрэм ИЛ зөвшөөрсөн атриумыг зөрчил
    #    гэж мэдээлдэг ЧИМЭЭГҮЙ уналт байв.
    ("W:exception_fires",     "NOT_APPLICABLE || exception:atrium || BNBD-31-03 || 4.2 || 2021 || - || -"),
    ("W:exception_negative",  "VIOLATION || - || BNBD-31-03 || 4.2 || 2021 || false || -"),
    # ⚠️ `when`-гүй / хоосон `when` нь ХАГАС АЧААЛАХГҮЙ дүрмээр БҮХ БАГЦЫГ хаяна.
    ("W:when_missing",        "REJECTED"),
    ("W:when_empty",          "REJECTED"),
    # ⚠️ UNVERIFIED: эшлэлийн ГУРВАН талбар ХООСОРНО, ноцтой байдал БУУРНА,
    #    шошго нь `complianceModel.ts`-ийн мөртэй ҮСЭГ ҮСГЭЭР ижил.
    ("W:unverified_citation", "WARNING || - || - || - || - || true || дотоод шалгуур (эх сурвалж баталгаажаагүй)"),
    ("W:verified_citation",   "VIOLATION || - || BNBD-31-03 || 4.2 || 2021 || false || -"),
    # ⚠️ Зөрчилдөөн нь дарагдсан эшлэлийг «хожигчийн» нэрээр СЭРГЭЭХГҮЙ.
    ("W:conflict_citation",   "true || дотоод шалгуур (эх сурвалж баталгаажаагүй)"),
]

PARITY = ["P:P1", "P:P2", "P:P3", "P:P4", "P:P5", "P:P6", "P:P7", "P:P8"]


def run_csharp(tmp: Path) -> dict:
    compile_lines = "\n".join(
        '    <Compile Include="%s" />' % (ADDIN / f).resolve() for f in CS_FILES
    )
    (tmp / "rulecheck.csproj").write_text(
        CSPROJ.replace("__COMPILE__", compile_lines), encoding="utf-8")
    (tmp / "Program.cs").write_text(MAIN, encoding="utf-8")
    r = subprocess.run(
        ["dotnet", "run", "--project", str(tmp / "rulecheck.csproj")],
        capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        print((r.stdout or "")[-4000:], file=sys.stderr)
        print((r.stderr or "")[-4000:], file=sys.stderr)
        raise SystemExit("C# harness амжилтгүй (rc=%d)" % r.returncode)
    return parse_lines(r.stdout or "")


def run_typescript(tmp: Path) -> dict:
    src = (NODE_MAIN
           .replace("__MODEL__", (BACKEND_LIB / "complianceModel.ts").resolve().as_uri())
           .replace("__APPLIC__", (BACKEND_LIB / "ruleApplicability.ts").resolve().as_uri()))
    script = tmp / "parity.mjs"
    script.write_text(src, encoding="utf-8")
    r = subprocess.run(["node", str(script)], capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        print((r.stdout or "")[-4000:], file=sys.stderr)
        print((r.stderr or "")[-4000:], file=sys.stderr)
        raise SystemExit("TS harness амжилтгүй (rc=%d)" % r.returncode)
    return parse_lines(r.stdout or "")


def parse_lines(text: str) -> dict:
    got = {}
    for line in text.splitlines():
        if " || " not in line:
            continue
        key, rest = line.split(" || ", 1)
        got[key.strip()] = rest.strip()
    return got


def main() -> None:
    parity = "--parity" in sys.argv
    with tempfile.TemporaryDirectory() as t:
        tmp = Path(t)
        cs = run_csharp(tmp)
        ts = run_typescript(tmp) if parity else None

    ok = 0
    print("  %-22s %s" % ("кейс", "үр дүн"))
    print("  " + "-" * 96)
    for key, want in CASES:
        have = cs.get(key, "<АЛГА>")
        good = have == want
        ok += good
        print("  %s %-22s %s" % ("OK " if good else "BAD", key, have))
        if not good:
            print("  %s %-22s %s" % ("   ", "  ХҮЛЭЭСЭН", want))
    print("\n  %d/%d семантик кейс зөв" % (ok, len(CASES)))
    failed = ok < len(CASES)

    if parity:
        print("\n  ХАМААРЛЫН ТУЛГАЛТ — TS <-> C# (§3.13.1)")
        print("  " + "-" * 96)
        pok = 0
        for key in PARITY:
            a = cs.get(key, "<C#-Д АЛГА>")
            b = ts.get(key, "<TS-Д АЛГА>") if ts else "<АЛГА>"
            good = a == b
            pok += good
            print("  %s %-6s C#=%-46s TS=%s" % ("OK " if good else "BAD", key, a, b))
        print("\n  %d/%d fixture таарлаа" % (pok, len(PARITY)))
        if pok < len(PARITY):
            failed = True

    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
