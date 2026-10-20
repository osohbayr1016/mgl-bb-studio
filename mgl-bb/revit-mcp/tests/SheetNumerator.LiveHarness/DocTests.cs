using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using RevitMcpAddin.SheetNumerator.Core;
using RevitMcpAddin.SheetNumerator.Revit;

namespace SnLive
{
    /// <summary>Scratch document дээрх БОДИТ Revit шалгалтууд (Capture → engine → Apply → унших).</summary>
    internal static class DocTests
    {
        public static List<KeyValuePair<string, Action<Ctx>>> All()
        {
            var l = new List<KeyValuePair<string, Action<Ctx>>>();
            Action<string, Action<Ctx>> add = (n, a) => l.Add(new KeyValuePair<string, Action<Ctx>>(n, a));
            add("L01_Capture_Basics", L01);
            add("L02_Capture_Parameters", L02);
            add("L03_Apply_RotationNeedsTempNumbers", L03);
            add("L03b_Apply_NamesParamsGroupCount", L03b);
            add("L04_Rollback_InjectedFailure", L04);
            add("L05_Rollback_RealRevitException", L05);
            add("L06_Stale_NothingWritten", L06);
            add("L07_Scope_Duplicates_CaseInsensitive", L07);
            add("L08_UnicodeMarkers_Probe_Apply_Clean", L08);
            add("L09_Rename_Delete", L09);
            add("L11_Assemblies", L11);
            add("L10_Perf_250Sheets", L10);
            add("L12_Worksharing_LocalCentral", L12);
            return l;
        }

        // ═════════════════════════════════════════════════════════════
        private static List<ViewSheet> Seed4(Document d)
        {
            var l = new List<ViewSheet>();
            l.Add(Ctx.Sheet(d, "A-001", "Alpha"));
            l.Add(Ctx.Sheet(d, "A-002", "Beta"));
            l.Add(Ctx.Sheet(d, "A-003", "Gamma"));
            l.Add(Ctx.Sheet(d, "A-004", "Delta"));
            return l;
        }

        private static ApplyRequest Request(DocumentSnapshot snap, params ApplyItem[] items)
        {
            var req = new ApplyRequest { DocumentKey = snap.DocumentKey, Uniqueness = snap.Uniqueness };
            req.Items.AddRange(items);
            return req;
        }

        private static ApplyItem Item(DocumentSnapshot snap, string name, string newNumber, string newName = null)
        {
            SheetSnapshot s = snap.Sheets.First(x => x.Name == name);
            return new ApplyItem
            {
                SheetId = s.SheetId, UniqueId = s.UniqueId, ExpectedNumber = s.Number, ExpectedName = s.Name,
                NewNumber = newNumber, NewName = newName,
            };
        }

        private static string NumberOf(Document d, string name)
        {
            foreach (ViewSheet s in new FilteredElementCollector(d).OfClass(typeof(ViewSheet)).Cast<ViewSheet>())
            {
                if (s.Name == name)
                    return s.SheetNumber;
            }
            return null;
        }

        // ═════════════════════════════════════════════════════════════
        private static void L01(Ctx c)
        {
            Document d = c.NewDoc();
            c.Tx(d, "seed", () =>
            {
                Ctx.Sheet(d, "A-001", "Alpha");
                Ctx.Sheet(d, "A-002", "Beta");
                Ctx.Sheet(d, "A-003", "Gamma");
                ViewSheet ph = ViewSheet.CreatePlaceholder(d);
                ph.SheetNumber = "PH-1";
                ph.Name = "Placeholder one";
                SheetCollection c1 = SheetCollection.Create(d, "Phase 1");
                SheetCollection c2 = SheetCollection.Create(d, "Phase 2");
                ViewSheet s1 = Ctx.Sheet(d, "S-01", "P1 plan");
                s1.SheetCollectionId = c1.Id;
                ViewSheet s2 = Ctx.Sheet(d, "S-02", "P1 section");
                s2.SheetCollectionId = c1.Id;
                ViewSheet s3 = Ctx.Sheet(d, "S-01", "P2 plan");   // ИЖИЛ дугаар, ӨӨР цуглуулга
                s3.SheetCollectionId = c2.Id;
            });

            DocumentSnapshot snap = c.Snap(d);
            Ctx.Eq(7, snap.Sheets.Count, "хуудасны тоо");
            Ctx.Eq(UniquenessMode.PerSheetCollection, snap.Uniqueness, "давхардлын хүрээ (Revit 2025+)");
            Ctx.Eq(1, snap.Sheets.Count(s => s.IsPlaceholder), "placeholder тоо");
            Ctx.Require(snap.Sheets.First(s => s.IsPlaceholder).Number == "PH-1", "placeholder дугаар");
            Ctx.Eq(2, snap.Collections.Count, "цуглуулгын тоо");
            Ctx.Require(snap.Collections.Any(x => x.Name == "Phase 1") && snap.Collections.Any(x => x.Name == "Phase 2"), "цуглуулгын нэр");
            SheetSnapshot p2 = snap.Sheets.First(s => s.Name == "P2 plan");
            Ctx.Eq("Phase 2", p2.CollectionName, "P2 plan-ийн цуглуулга");
            Ctx.Require(p2.CollectionId != 0, "P2 plan цуглуулгын id");
            Ctx.Eq(0L, snap.Sheets.First(s => s.Name == "Alpha").CollectionId, "цуглуулгагүй хуудас");
            Ctx.Eq(2, snap.Sheets.Count(s => s.Number == "S-01"), "S-01 хоёр цуглуулгад давхар оршино");
            c.R.Info("Browser organization: «" + snap.Browser.OrganizationName + "», grouping=" + snap.Browser.HasGrouping
                + ", sort=" + snap.Browser.SortParameterName + ", desc=" + snap.Browser.SortDescending);
            c.R.Info("DocumentKey: " + snap.DocumentKey);

            // Бүлэглэлт: цуглуулга тус бүр, үндэс бүлэг.
            GroupingResult g = SheetGroupingService.Build(snap, DisplayMode.Grouped, false);
            c.R.Info("бүлгүүд: " + string.Join("; ", g.Groups.Select(x => x.Title + "(" + x.Sheets.Count + ")")));
            Ctx.Require(g.Groups.Count >= 3, "≥3 бүлэг (үндэс + 2 цуглуулга) хүлээсэн: " + g.Groups.Count);

            // Stamp хөнгөн.
            DocumentStamp stamp = SheetSnapshotService.ReadStamp(d);
            Ctx.Eq(7, stamp.Sheets.Count, "stamp-ийн хуудас");
        }

        // ═════════════════════════════════════════════════════════════
        /// <summary>Нийт-хэрэглээний scratch параметрүүд: SN_Tag (текст), SN_Count (бүхэл).  Хэрэглэгчийн shared-parameter файлын замыг ХЭЗЭЭ Ч үлдээхгүй.</summary>
        private static void AddParams(Ctx c, Document d)
        {
            UIApplication app = c.App;
            string old = app.Application.SharedParametersFilename;
            string spf = Path.Combine(c.OutDir, "sn-shared-params.txt");
            File.WriteAllText(spf,
                "# This is a Revit shared parameter file.\r\n# Do not edit manually.\r\n*META\tVERSION\tMINVERSION\r\nMETA\t2\t1\r\n*GROUP\tID\tNAME\r\n*PARAM\tGUID\tNAME\tDATATYPE\tDATACATEGORY\tGROUP\tVISIBLE\tDESCRIPTION\tUSERMODIFIABLE\tHIDEWHENNOVALUE\r\n");
            try
            {
                app.Application.SharedParametersFilename = spf;
                DefinitionFile df = app.Application.OpenSharedParameterFile();
                DefinitionGroup grp = df.Groups.Create("SN");
                Definition tag = grp.Definitions.Create(new ExternalDefinitionCreationOptions("SN_Tag", SpecTypeId.String.Text));
                Definition cnt = grp.Definitions.Create(new ExternalDefinitionCreationOptions("SN_Count", SpecTypeId.Int.Integer));
                CategorySet cs = app.Application.Create.NewCategorySet();
                cs.Insert(Category.GetCategory(d, BuiltInCategory.OST_Sheets));
                c.Tx(d, "bind params", () =>
                {
                    InstanceBinding b1 = app.Application.Create.NewInstanceBinding(cs);
                    d.ParameterBindings.Insert(tag, b1, GroupTypeId.IdentityData);
                    InstanceBinding b2 = app.Application.Create.NewInstanceBinding(cs);
                    d.ParameterBindings.Insert(cnt, b2, GroupTypeId.IdentityData);
                });
            }
            finally
            {
                try { app.Application.SharedParametersFilename = old ?? string.Empty; } catch (Exception) { }
            }
        }

        private static void L02(Ctx c)
        {
            Document d = c.NewDoc();
            AddParams(c, d);
            c.Tx(d, "seed", () => { Seed4(d); });

            DocumentSnapshot snap = c.Snap(d);
            c.R.Info("каталог (" + snap.ParameterCatalog.Count + "): " + string.Join("; ", snap.ParameterCatalog
                .Select(p => (p.Label ?? p.DisplayName) + "[" + p.ValueKind + (p.IsReadOnly ? ",RO" : "") + "]")));
            SheetParameterInfo tag = snap.ParameterCatalog.FirstOrDefault(p => p.DisplayName == "SN_Tag");
            SheetParameterInfo cnt = snap.ParameterCatalog.FirstOrDefault(p => p.DisplayName == "SN_Count");
            Ctx.Require(tag != null && cnt != null, "SN_Tag/SN_Count каталогт алга");
            Ctx.Eq(ParamValueKind.Text, tag.ValueKind, "SN_Tag төрөл");
            Ctx.Eq(ParamValueKind.Integer, cnt.ValueKind, "SN_Count төрөл");
            Ctx.Require(tag.IsWritable && cnt.IsWritable, "SN_* бичигдэх боломжтой байх ёстой");
            Ctx.Eq(ParameterKind.Shared, tag.Key.Kind, "SN_Tag түлхүүрийн төрөл (shared = GUID)");

            // Бичигдэх боломжгүй (read-only, хэмжигдэхүй, ElementId) параметр бичих зорилт болж болохгүй.
            foreach (SheetParameterInfo p in snap.ParameterCatalog)
            {
                if (p.IsWritable)
                    Ctx.Require(p.ValueKind == ParamValueKind.Text || p.ValueKind == ParamValueKind.Integer || p.ValueKind == ParamValueKind.Number,
                        "бичигдэх параметр буруу төрөлтэй: " + p.DisplayName + " " + p.ValueKind);
            }
            // Нэр, дугаар зэрэг «дуу чимээ» параметр каталогт орохгүй.
            Ctx.Require(!snap.ParameterCatalog.Any(p => p.DisplayName == "Sheet Number"), "«Sheet Number» каталогт орсон");
        }

        // ═════════════════════════════════════════════════════════════
        private static ApplyResult RotateLast(Ctx c, Document d, out DocumentSnapshot snap)
        {
            snap = c.Snap(d);
            SheetGroup g = Ctx.AllGroup(snap);
            var order = new WorkingOrderState(g);
            order.MoveToTop(new HashSet<long> { snap.Sheets.First(s => s.Name == "Delta").SheetId });
            var st = new RenumberSettings { MoveRenumber = true };
            RenumberPlan plan = Ctx.Plan(snap, g, st, order.Working);
            Ctx.Require(plan.HasChanges && !plan.HasBlockingErrors, "Move төлөвлөгөө алдаатай: " + string.Join("; ", plan.AllIssues.Select(i => i.Message)));
            ApplyRequest req = ApplyRequestBuilder.Build(plan, snap);
            return RenumberApplyService.Apply(d, req);
        }

        private static void L03(Ctx c)
        {
            Document d = c.NewDoc();
            c.Tx(d, "seed", () => { Seed4(d); });
            DocumentSnapshot snap;
            ApplyResult res = RotateLast(c, d, out snap);
            Ctx.Eq(ApplyOutcome.Applied, res.Outcome, "outcome (" + res.Message + " / " + res.Detail + ")");
            Ctx.Eq("A-001", NumberOf(d, "Delta"), "Delta");
            Ctx.Eq("A-002", NumberOf(d, "Alpha"), "Alpha");
            Ctx.Eq("A-003", NumberOf(d, "Beta"), "Beta");
            Ctx.Eq("A-004", NumberOf(d, "Gamma"), "Gamma");
            Ctx.Eq(4, res.NumbersChanged, "өөрчлөгдсөн дугаар");
            // Түр дугаар үлдээгүй.
            Ctx.Require(!c.Snap(d).Sheets.Any(s => s.Number.StartsWith("MGLTMP_", StringComparison.Ordinal)), "түр дугаар үлдсэн");
        }

        private static ParameterValueProbe ReadParam(ViewSheet sh, string name)
        {
            Parameter p = sh.LookupParameter(name);
            if (p == null)
                return new ParameterValueProbe { Exists = false };
            return new ParameterValueProbe
            {
                Exists = true,
                HasValue = p.HasValue,
                Text = p.StorageType == StorageType.String ? p.AsString() : null,
                Int = p.StorageType == StorageType.Integer ? p.AsInteger() : 0,
            };
        }

        private sealed class ParameterValueProbe
        {
            public bool Exists, HasValue;
            public string Text;
            public int Int;
        }

        private static void L03b(Ctx c)
        {
            Document d = c.NewDoc();
            AddParams(c, d);
            c.Tx(d, "seed", () => { Seed4(d); });
            DocumentSnapshot snap = c.Snap(d);
            SheetGroup g = Ctx.AllGroup(snap);
            ParameterKey tagKey = snap.ParameterCatalog.First(p => p.DisplayName == "SN_Tag").Key;
            ParameterKey cntKey = snap.ParameterCatalog.First(p => p.DisplayName == "SN_Count").Key;

            var st = new RenumberSettings();
            st.Simple.Prefix = "B-";
            st.Simple.Start = 10;
            st.Simple.Width = 3;
            st.WriteResultToParameter = true;
            st.ResultParameter = tagKey;
            st.ResultSource = GeneratedValueSource.FullNumber;
            st.WriteGroupCount = true;
            st.CountParameter = cntKey;
            st.CountScope = CountWriteScope.FirstSheet;
            st.NameAtEnd = true;
            st.NameSource = GeneratedValueSource.FullNumber;
            st.NameSeparator = " · ";

            RenumberPlan plan = Ctx.Plan(snap, g, st);
            Ctx.Require(!plan.HasBlockingErrors, "төлөвлөгөө алдаатай: " + string.Join("; ", plan.AllIssues.Select(i => i.Message)));
            ApplyResult res = RenumberApplyService.Apply(d, ApplyRequestBuilder.Build(plan, snap));
            Ctx.Eq(ApplyOutcome.Applied, res.Outcome, "outcome (" + res.Message + " / " + res.Detail + ")");

            var sheets = new FilteredElementCollector(d).OfClass(typeof(ViewSheet)).Cast<ViewSheet>().ToDictionary(s => s.SheetNumber, s => s);
            Ctx.EqSeq(new[] { "B-010", "B-011", "B-012", "B-013" }, sheets.Keys.OrderBy(k => k, StringComparer.Ordinal), "шинэ дугаарууд");
            Ctx.Eq("Alpha · B-010", sheets["B-010"].Name, "нэр (Alpha)");
            Ctx.Eq("Delta · B-013", sheets["B-013"].Name, "нэр (Delta)");
            foreach (var kv in sheets)
            {
                ParameterValueProbe tag = ReadParam(kv.Value, "SN_Tag");
                Ctx.Require(tag.Exists && tag.HasValue && tag.Text == kv.Key, "SN_Tag = дугаар байх ёстой: " + kv.Key + " → «" + tag.Text + "»");
            }
            ParameterValueProbe first = ReadParam(sheets["B-010"], "SN_Count");
            Ctx.Require(first.HasValue && first.Int == 4, "SN_Count (эхний хуудас) = 4: " + first.Int);
            ParameterValueProbe other = ReadParam(sheets["B-011"], "SN_Count");
            Ctx.Require(!other.HasValue || other.Int == 0, "SN_Count (бусад хуудас) хоосон байх ёстой");
            Ctx.Eq(4, res.NumbersChanged, "өөрчлөгдсөн дугаар");
            Ctx.Eq(4, res.NamesChanged, "өөрчлөгдсөн нэр");
            Ctx.Eq(5, res.ParametersWritten, "бичигдсэн параметр (4 SN_Tag + 1 SN_Count)");
        }

        // ═════════════════════════════════════════════════════════════
        private static void L04(Ctx c)
        {
            Document d = c.NewDoc();
            c.Tx(d, "seed", () => { Seed4(d); });
            RenumberApplyService.FailAtStage = "after-temp";
            DocumentSnapshot snap;
            ApplyResult res = RotateLast(c, d, out snap);
            Ctx.Eq(ApplyOutcome.RolledBack, res.Outcome, "outcome");
            Ctx.Require(res.RollbackVerified, "буцаалт баталгаажсан байх ёстой");
            foreach (SheetSnapshot s in snap.Sheets)
                Ctx.Eq(s.Number, NumberOf(d, s.Name), "буцаасны дараах дугаар: " + s.Name);
            Ctx.Require(!c.Snap(d).Sheets.Any(s => s.Number.StartsWith("MGLTMP_", StringComparison.Ordinal)), "түр дугаар үлдсэн");
            c.R.Info("мессеж: " + res.Message.Replace("\n", " / "));

            // Дараагийн ердийн apply буцаалтын дараа ХЭВИЙН ажиллана.
            RenumberApplyService.FailAtStage = null;
            ApplyResult res2 = RotateLast(c, d, out snap);
            Ctx.Eq(ApplyOutcome.Applied, res2.Outcome, "буцаалтын дараах apply");
            Ctx.Eq("A-001", NumberOf(d, "Delta"), "Delta (дахин)");
        }

        private static void L05(Ctx c)
        {
            Document d = c.NewDoc();
            c.Tx(d, "seed", () => { Seed4(d); });
            DocumentSnapshot snap = c.Snap(d);
            // Нэр нь Revit-д хориотой тэмдэгттэй (урьдчилсан шалгалтыг ЗОРИУД тойрсон гар хүсэлт) — Revit өөрөө шидэх ёстой.
            ApplyRequest req = Request(snap, Item(snap, "Alpha", "Z-1", "Bad{Name"), Item(snap, "Beta", "Z-2"));
            ApplyResult res = RenumberApplyService.Apply(d, req);
            c.R.Info("outcome=" + res.Outcome + " verified=" + res.RollbackVerified + " msg=" + res.Message.Replace("\n", " / ")
                + " detail=" + (res.Detail ?? string.Empty).Replace("\n", " / "));
            Ctx.Eq(ApplyOutcome.RolledBack, res.Outcome, "outcome");
            Ctx.Require(res.RollbackVerified, "буцаалт баталгаажсан байх ёстой");
            Ctx.Eq("A-001", NumberOf(d, "Alpha"), "Alpha буцсан");
            Ctx.Eq("A-002", NumberOf(d, "Beta"), "Beta буцсан");
            Ctx.Require(res.Problems.Count > 0, "асуудал бүртгэгдсэн байх ёстой");
        }

        private static void L06(Ctx c)
        {
            Document d = c.NewDoc();
            c.Tx(d, "seed", () => { Seed4(d); });
            DocumentSnapshot snap = c.Snap(d);
            // Хэрэглэгч (Project Browser) нэг хуудасны дугаарыг гаднаас солив.
            c.Tx(d, "external edit", () =>
            {
                ViewSheet b = new FilteredElementCollector(d).OfClass(typeof(ViewSheet)).Cast<ViewSheet>().First(s => s.Name == "Beta");
                b.SheetNumber = "A-002-REV";
            });
            ApplyRequest req = Request(snap, Item(snap, "Alpha", "Z-1"), Item(snap, "Beta", "Z-2"));
            ApplyResult res = RenumberApplyService.Apply(d, req);
            Ctx.Eq(ApplyOutcome.Stale, res.Outcome, "outcome");
            Ctx.Eq("A-001", NumberOf(d, "Alpha"), "Alpha ХӨНДӨГДӨӨГҮЙ байх ёстой");
            Ctx.Eq("A-002-REV", NumberOf(d, "Beta"), "Beta гаднаас засагдсан хэвээр");
            Ctx.Require((res.Message ?? string.Empty).Contains("өөрчлөгдсөн"), "мессеж: " + res.Message);

            // Хуудас устсан.
            DocumentSnapshot snap2 = c.Snap(d);
            c.Tx(d, "external delete", () =>
            {
                ViewSheet g = new FilteredElementCollector(d).OfClass(typeof(ViewSheet)).Cast<ViewSheet>().First(s => s.Name == "Gamma");
                d.Delete(g.Id);
            });
            ApplyResult res2 = RenumberApplyService.Apply(d, Request(snap2, Item(snap2, "Alpha", "Z-1"), Item(snap2, "Gamma", "Z-3")));
            Ctx.Eq(ApplyOutcome.Stale, res2.Outcome, "устсан хуудас → Stale");
            Ctx.Eq("A-001", NumberOf(d, "Alpha"), "Alpha ХӨНДӨГДӨӨГҮЙ (устсан хуудас)");

            // Document солигдсон (өөр document-ийн түлхүүр).
            DocumentSnapshot snap3 = c.Snap(d);
            ApplyRequest wrongDoc = Request(snap3, Item(snap3, "Alpha", "Z-1"));
            wrongDoc.DocumentKey = "bogus|key|path";
            Ctx.Eq(ApplyOutcome.Stale, RenumberApplyService.Apply(d, wrongDoc).Outcome, "document солигдсон → Stale");
        }

        // ═════════════════════════════════════════════════════════════
        private static void L07(Ctx c)
        {
            Document d = c.NewDoc();
            c.Tx(d, "seed", () =>
            {
                Ctx.Sheet(d, "A-001", "Alpha");
                Ctx.Sheet(d, "A-002", "Beta");
                SheetCollection c1 = SheetCollection.Create(d, "Phase 1");
                SheetCollection c2 = SheetCollection.Create(d, "Phase 2");
                ViewSheet s1 = Ctx.Sheet(d, "S-01", "P1 plan");
                s1.SheetCollectionId = c1.Id;
                ViewSheet s2 = Ctx.Sheet(d, "S-02", "P1 section");
                s2.SheetCollectionId = c1.Id;
                ViewSheet s3 = Ctx.Sheet(d, "S-01", "P2 plan");
                s3.SheetCollectionId = c2.Id;
            });
            DocumentSnapshot snap = c.Snap(d);

            // (a) Нэг хүрээнд (цуглуулгагүй) давхардал → БЛОКЛОНО, юу ч бичигдэхгүй.
            ApplyResult a = RenumberApplyService.Apply(d, Request(snap, Item(snap, "Beta", "A-001")));
            Ctx.Eq(ApplyOutcome.Blocked, a.Outcome, "(a) нэг хүрээний давхардал");
            Ctx.Eq("A-002", NumberOf(d, "Beta"), "(a) Beta хөндөгдөөгүй");

            // (b) Том жижиг үсэг ялгахгүй (Revit) — «a-001» нь «A-001»-тэй давхардана.
            ApplyResult b = RenumberApplyService.Apply(d, Request(snap, Item(snap, "Beta", "a-001")));
            Ctx.Eq(ApplyOutcome.Blocked, b.Outcome, "(b) том/жижиг үсгийн давхардал");

            // (c) ӨӨР цуглуулгад ижил дугаар ЗӨВШӨӨРӨГДӨНӨ — Revit өөрөө хүлээн авна.
            ApplyResult cc = RenumberApplyService.Apply(d, Request(snap, Item(snap, "P2 plan", "S-02")));
            Ctx.Eq(ApplyOutcome.Applied, cc.Outcome, "(c) цуглуулга хоорондын ижил дугаар (" + cc.Message + " / " + cc.Detail + ")");
            Ctx.Eq("S-02", NumberOf(d, "P2 plan"), "(c) P2 plan");
            Ctx.Eq("S-02", NumberOf(d, "P1 section"), "(c) P1 section хэвээр");

            // (d) Үндэс (цуглуулгагүй) хуудас цуглуулгын дугаартай ИЖИЛ байж болно (хэмжсэн: тусдаа хүрээ).
            DocumentSnapshot snap2 = c.Snap(d);
            ApplyResult dd = RenumberApplyService.Apply(d, Request(snap2, Item(snap2, "Beta", "S-01")));
            Ctx.Eq(ApplyOutcome.Applied, dd.Outcome, "(d) үндэс ↔ цуглуулгын ижил дугаар (" + dd.Message + " / " + dd.Detail + ")");

            // (e) Нэг цуглуулга дотор давхардал → блок.
            DocumentSnapshot snap3 = c.Snap(d);
            ApplyResult ee = RenumberApplyService.Apply(d, Request(snap3, Item(snap3, "P1 section", "S-01")));
            Ctx.Eq(ApplyOutcome.Blocked, ee.Outcome, "(e) цуглуулга доторх давхардал");
            Ctx.Eq("S-02", NumberOf(d, "P1 section"), "(e) хөндөгдөөгүй");
        }

        // ═════════════════════════════════════════════════════════════
        private static void L08(Ctx c)
        {
            Document d = c.NewDoc();
            MarkerCapabilities caps = UnicodeProbe.Probe(d);
            c.R.Info("probe: probed=" + caps.IsProbed + " error=" + caps.ProbeError + " accepted=["
                + string.Join(", ", caps.Accepted.Select(ch => "U+" + ((int)ch).ToString("X4"))) + "] rejected=["
                + string.Join(", ", caps.Rejected.Select(kv => "U+" + ((int)kv.Key).ToString("X4"))) + "]");
            Ctx.Require(caps.IsProbed, "probe хийгдсэн байх ёстой: " + caps.ProbeError);
            Ctx.Require(caps.AnyAvailable, "Revit дугаарт үл үзэгдэх тэмдэг хадгалдаг байх ёстой");
            Ctx.Require(d.GetElement(ElementId.InvalidElementId) == null && new FilteredElementCollector(d).OfClass(typeof(ViewSheet)).GetElementCount() == 0,
                "probe-ийн placeholder хуудас үлдсэн (Transaction буцаагдаагүй)");

            char m = caps.Preferred('​');
            c.Tx(d, "seed", () => { Ctx.Sheet(d, "A-001", "Alpha"); Ctx.Sheet(d, "A-002", "Beta"); Ctx.Sheet(d, "A-003", "Gamma"); });
            DocumentSnapshot snap = c.Snap(d);
            SheetGroup g = Ctx.AllGroup(snap);

            // Бүх хуудас ИЖИЛ «K» дугаартай болох дугаарлалт — давхардлыг үл үзэгдэх тэмдгээр ялгана.
            var st = new RenumberSettings { Mode = NumberingMode.Advanced, UseUnicodeMarkers = true, MarkerChar = m };
            st.Advanced.Parts[0].Enabled = true;
            st.Advanced.Parts[0].Prefix = "K";
            st.Advanced.Parts[0].ValueMode = PartValueMode.None;
            RenumberPlan plan = Ctx.Plan(snap, g, st, markers: caps);
            Ctx.Require(!plan.HasBlockingErrors, "төлөвлөгөө алдаатай: " + string.Join("; ", plan.AllIssues.Select(i => i.Message)));
            string[] expected = { "K", "K" + m, "K" + m + m };
            Ctx.EqSeq(expected, plan.Rows.Select(r => r.NewNumber), "төлөвлөсөн дугаарууд");
            ApplyResult res = RenumberApplyService.Apply(d, ApplyRequestBuilder.Build(plan, snap));
            Ctx.Eq(ApplyOutcome.Applied, res.Outcome, "outcome (" + res.Message + " / " + res.Detail + ")");

            var live = new FilteredElementCollector(d).OfClass(typeof(ViewSheet)).Cast<ViewSheet>().Select(s => s.SheetNumber).OrderBy(x => x, StringComparer.Ordinal).ToList();
            Ctx.EqSeq(expected.OrderBy(x => x, StringComparer.Ordinal), live, "Revit-д хадгалагдсан дугаарууд");
            Ctx.Eq(3, live.Distinct(StringComparer.OrdinalIgnoreCase).Count(), "Revit гурвыг ЯЛГААТАЙ гэж үзнэ");

            // Цэвэрлэх горим: «K​» → «K» нь «K»-тэй давхцана → БЛОК.
            DocumentSnapshot snap2 = c.Snap(d);
            SheetGroup g2 = Ctx.AllGroup(snap2);
            RenumberPlan clean = Ctx.Plan(snap2, g2, new RenumberSettings { CleanMarkers = true }, markers: caps);
            Ctx.Require(clean.HasBlockingErrors, "цэвэрлэх нь давхардал үүсгэх тул блоклогдох ёстой");
            c.R.Info("clean: " + string.Join(" | ", clean.Rows.Select(r => Ctx.Show(r.Sheet.Number) + "→" + Ctx.Show(r.NewNumber))));
        }

        // ═════════════════════════════════════════════════════════════
        private static void L09(Ctx c)
        {
            Document d = c.NewDoc();
            c.Tx(d, "seed", () => { Seed4(d); });
            DocumentSnapshot snap = c.Snap(d);
            SheetSnapshot alpha = snap.Sheets.First(s => s.Name == "Alpha");
            string key = snap.DocumentKey;

            OperationResult ok = SheetEditService.Rename(d, new RenameRequest
            {
                DocumentKey = key, SheetId = alpha.SheetId, UniqueId = alpha.UniqueId, ExpectedNumber = alpha.Number, ExpectedName = alpha.Name,
                NewName = "Alpha (шинэчилсэн)",
            });
            Ctx.Require(ok.Success, "нэр өөрчлөх: " + ok.Message + " " + ok.Detail);
            Ctx.Eq("A-001", NumberOf(d, "Alpha (шинэчилсэн)"), "нэр өөрчлөгдсөн");

            // Хуучирсан (хэрэглэгч өөр нэр харсан) → Stale.
            OperationResult stale = SheetEditService.Rename(d, new RenameRequest
            {
                DocumentKey = key, SheetId = alpha.SheetId, UniqueId = alpha.UniqueId, ExpectedNumber = alpha.Number, ExpectedName = "Alpha",
                NewName = "X",
            });
            Ctx.Require(!stale.Success && stale.Stale, "хуучирсан нэр өөрчлөлт Stale байх ёстой");

            // Хориотой тэмдэгт.
            SheetSnapshot beta = snap.Sheets.First(s => s.Name == "Beta");
            OperationResult bad = SheetEditService.Rename(d, new RenameRequest
            {
                DocumentKey = key, SheetId = beta.SheetId, UniqueId = beta.UniqueId, ExpectedNumber = beta.Number, ExpectedName = beta.Name,
                NewName = "Bad{Name",
            });
            c.R.Info("хориотой нэр: success=" + bad.Success + " msg=" + bad.Message);
            Ctx.Require(!bad.Success, "хориотой тэмдэгттэй нэр татгалзагдах ёстой");
            Ctx.Eq("Beta", NumberOf(d, "Beta") != null ? "Beta" : "?", "Beta нэр хэвээр");

            // Устгах: идэвхтэй харагдацыг устгахыг хаана.
            SheetSnapshot gamma = snap.Sheets.First(s => s.Name == "Gamma");
            ElementId gammaId = new ElementId(gamma.SheetId);
            OperationResult activeBlocked = SheetEditService.Delete(d, gammaId, new DeleteRequest
            {
                DocumentKey = key, SheetId = gamma.SheetId, UniqueId = gamma.UniqueId, ExpectedNumber = gamma.Number, ExpectedName = gamma.Name,
            });
            Ctx.Require(!activeBlocked.Success && activeBlocked.Message == Msg.DeleteActiveViewFailed, "идэвхтэй харагдацыг устгахыг хаах ёстой");
            Ctx.Require(NumberOf(d, "Gamma") != null, "Gamma устсан");

            OperationResult del = SheetEditService.Delete(d, null, new DeleteRequest
            {
                DocumentKey = key, SheetId = gamma.SheetId, UniqueId = gamma.UniqueId, ExpectedNumber = gamma.Number, ExpectedName = gamma.Name,
            });
            Ctx.Require(del.Success, "устгах: " + del.Message + " " + del.Detail);
            Ctx.Require(NumberOf(d, "Gamma") == null, "Gamma устгагдаагүй");
            // Устсан хуудсыг дахин устгах → Stale.
            OperationResult again = SheetEditService.Delete(d, null, new DeleteRequest
            {
                DocumentKey = key, SheetId = gamma.SheetId, UniqueId = gamma.UniqueId, ExpectedNumber = gamma.Number, ExpectedName = gamma.Name,
            });
            Ctx.Require(!again.Success && again.Stale, "устсан хуудсыг дахин устгах Stale байх ёстой");
        }

        // ═════════════════════════════════════════════════════════════
        private static void L11(Ctx c)
        {
            Document d = c.NewDoc();
            long asm1 = 0, asm2 = 0;
            ElementId wall1 = null, wall2 = null;
            c.Tx(d, "walls", () =>
            {
                Ctx.Sheet(d, "A-001", "Alpha");
                Level lvl = new FilteredElementCollector(d).OfClass(typeof(Level)).Cast<Level>().First();
                WallType wt = new FilteredElementCollector(d).OfClass(typeof(WallType)).Cast<WallType>().First(t => t.Kind == WallKind.Basic);
                // ЯЛГААТАЙ геометр — ижил хоёр assembly Revit-д НЭГ төрөл болж нэгтгэгдээд «views will be deleted» гэсэн алдаа (МОДАЛЬ) өгдөг.
                Wall w1 = Wall.Create(d, Line.CreateBound(new XYZ(0, 0, 0), new XYZ(10, 0, 0)), wt.Id, lvl.Id, 10, 0, false, false);
                Wall w2 = Wall.Create(d, Line.CreateBound(new XYZ(0, 20, 0), new XYZ(17, 20, 0)), wt.Id, lvl.Id, 13, 0, false, false);
                wall1 = w1.Id;
                wall2 = w2.Id;
            });
            c.R.Info("walls OK");
            ElementId catId = Category.GetCategory(d, BuiltInCategory.OST_Walls).Id;
            ElementId a1Id = null, a2Id = null;
            c.Tx(d, "assembly 1", () =>
            {
                AssemblyInstance a1 = AssemblyInstance.Create(d, new List<ElementId> { wall1 }, catId);
                a1Id = a1.Id;
                asm1 = a1.Id.Value;
            });
            c.Tx(d, "assembly 2", () =>
            {
                AssemblyInstance a2 = AssemblyInstance.Create(d, new List<ElementId> { wall2 }, catId);
                a2Id = a2.Id;
                asm2 = a2.Id.Value;
            });
            c.R.Info("assemblies OK: " + asm1 + ", " + asm2);
            ElementId titleBlock = new FilteredElementCollector(d).OfCategory(BuiltInCategory.OST_TitleBlocks).WhereElementIsElementType().FirstElementId();
            c.R.Info("title block: " + (titleBlock == null || titleBlock == ElementId.InvalidElementId ? "(байхгүй)" : titleBlock.Value.ToString()));
            ViewSheet s1 = null, s2 = null;
            c.Tx(d, "assembly sheets", () =>
            {
                s1 = AssemblyViewUtils.CreateSheet(d, a1Id, titleBlock ?? ElementId.InvalidElementId);
                s2 = AssemblyViewUtils.CreateSheet(d, a2Id, titleBlock ?? ElementId.InvalidElementId);
            });
            c.R.Info("assembly sheets: [" + s1.SheetNumber + "] [" + s2.SheetNumber + "]");
            c.Tx(d, "assembly sheet numbers", () =>
            {
                s1.SheetNumber = "AS-1";
                s1.Name = "Asm1 sheet";
                s2.SheetNumber = "AS-1";     // ӨӨР assembly → ижил дугаар зөвшөөрөгдөнө
                s2.Name = "Asm2 sheet";
            });
            DocumentSnapshot snap = c.Snap(d);
            SheetSnapshot x1 = snap.Sheets.First(s => s.Name == "Asm1 sheet");
            SheetSnapshot x2 = snap.Sheets.First(s => s.Name == "Asm2 sheet");
            Ctx.Require(x1.IsAssemblySheet && x2.IsAssemblySheet, "assembly хуудас гэж танигдаагүй");
            Ctx.Require(x1.AssemblyId == asm1 && x2.AssemblyId == asm2, "assembly id таарсангүй");
            Ctx.Require(x1.AssemblyId != x2.AssemblyId, "хоёр assembly ялгаатай байх ёстой");
            Ctx.Eq("AS-1", x1.Number, "assembly 1 дугаар");
            Ctx.Eq("AS-1", x2.Number, "assembly 2 дугаар (өөр assembly-д давхар оршино)");
            Ctx.Require(!snap.Sheets.First(s => s.Name == "Alpha").IsAssemblySheet, "энгийн хуудас assembly гэж танигдсан");

            GroupingResult gr = SheetGroupingService.Build(snap, DisplayMode.Grouped, false);
            c.R.Info("бүлгүүд: " + string.Join("; ", gr.Groups.Select(x => x.Title + "(" + x.Sheets.Count + ")")));
            Ctx.Require(gr.Groups.Count(x => x.Key.Kind == GroupKind.Assembly) == 2, "assembly бүлэг 2 байх ёстой");

            // Assembly-ийн дотор дугаарлах: хоёр assembly-ийн хуудсыг АЛЬ АЛИНД нь «AS-2» болгох → давхцахгүй (тусдаа хүрээ).
            ApplyResult res = RenumberApplyService.Apply(d, Request(snap, Item(snap, "Asm1 sheet", "AS-2"), Item(snap, "Asm2 sheet", "AS-2")));
            Ctx.Eq(ApplyOutcome.Applied, res.Outcome, "assembly тус бүрт ижил дугаар (" + res.Message + " / " + res.Detail + ")");
            Ctx.Eq("AS-2", NumberOf(d, "Asm1 sheet"), "assembly 1");
            Ctx.Eq("AS-2", NumberOf(d, "Asm2 sheet"), "assembly 2");
        }

        // ═════════════════════════════════════════════════════════════
        private static void L10(Ctx c)
        {
            const int N = 250;
            Document d = c.NewDoc();
            var sw = Stopwatch.StartNew();
            c.Tx(d, "seed", () =>
            {
                for (int i = 1; i <= N; i++)
                    Ctx.Sheet(d, "A-" + i.ToString("000"), "Sheet " + i.ToString("000"));
            });
            long tSeed = sw.ElapsedMilliseconds;

            sw.Restart();
            DocumentSnapshot snap = c.Snap(d);
            long tCapture = sw.ElapsedMilliseconds;
            Ctx.Eq(N, snap.Sheets.Count, "хуудасны тоо");

            sw.Restart();
            SheetGroup g = Ctx.AllGroup(snap);
            var order = new WorkingOrderState(g);
            order.MoveToTop(new HashSet<long> { snap.Sheets.First(s => s.Name == "Sheet " + N.ToString("000")).SheetId });
            RenumberPlan plan = Ctx.Plan(snap, g, new RenumberSettings { MoveRenumber = true }, order.Working);
            long tPlan = sw.ElapsedMilliseconds;
            Ctx.Require(!plan.HasBlockingErrors && plan.NumberChangedCount == N, "төлөвлөгөө: өөрчлөгдөх " + plan.NumberChangedCount);

            sw.Restart();
            ApplyResult res = RenumberApplyService.Apply(d, ApplyRequestBuilder.Build(plan, snap));
            long tApply = sw.ElapsedMilliseconds;
            Ctx.Eq(ApplyOutcome.Applied, res.Outcome, "outcome (" + res.Message + " / " + res.Detail + ")");

            Ctx.Eq("A-001", NumberOf(d, "Sheet " + N.ToString("000")), "сүүлийн хуудас эхний дугаарыг авсан");
            Ctx.Eq("A-" + N.ToString("000"), NumberOf(d, "Sheet " + (N - 1).ToString("000")), "(N-1)-р хуудас сүүлийн дугаарыг авсан");

            sw.Restart();
            c.Snap(d);
            long tCapture2 = sw.ElapsedMilliseconds;
            c.R.Info(N + " хуудас: үүсгэх " + tSeed + " мс · Capture " + tCapture + " мс · төлөвлөх " + tPlan + " мс · Apply (" + N + " дугаар, 2 transaction) "
                + tApply + " мс · дахин Capture " + tCapture2 + " мс");
            Ctx.Require(tApply < 20000, "Apply хэт удаан: " + tApply + " мс");
        }

        // ═════════════════════════════════════════════════════════════
        /// <summary>
        /// Workshared document (төв файлыг ЛОКАЛААР хадгалсан) дээр Apply — `IsWorkshared` салаа (CheckModifiable)
        /// БОДИТООР ажиллаж, ямар ч exception-гүй, түр дугаар → эцсийн дугаар нэг Undo-той хэрэгжинэ.
        /// ⚠️ «Өөр хэрэглэгчийн эзэмшилд» гэсэн блоклох салааг ганц машин дээр дуурайх БОЛОМЖГҮЙ — гараар (олон хэрэглэгчтэй төв загвар).
        /// </summary>
        private static void L12(Ctx c)
        {
            Document d = c.NewDoc();
            c.Tx(d, "seed", () => { Seed4(d); });

            string dir = Path.Combine(c.OutDir, "ws");
            Directory.CreateDirectory(dir);
            string central = Path.Combine(dir, "ws-central-" + Guid.NewGuid().ToString("N").Substring(0, 8) + ".rvt");
            d.EnableWorksharing("Shared Levels and Grids", "Workset1");
            var so = new SaveAsOptions { OverwriteExistingFile = true };
            var wo = new WorksharingSaveAsOptions { SaveAsCentral = true };
            so.SetWorksharingOptions(wo);
            d.SaveAs(central, so);
            Ctx.Require(d.IsWorkshared, "document workshared болсонгүй");
            c.R.Info("workshared=" + d.IsWorkshared + " · path=" + d.PathName);

            DocumentSnapshot snap = c.Snap(d);
            Ctx.Require(snap.IsWorkshared, "snapshot.IsWorkshared = false");
            Ctx.Eq(4, snap.Sheets.Count, "хуудасны тоо");

            foreach (SheetSnapshot s in snap.Sheets)
            {
                string owner;
                CheckoutStatus st = WorksharingUtils.GetCheckoutStatus(d, new ElementId(s.SheetId), out owner);
                ModelUpdatesStatus up = WorksharingUtils.GetModelUpdatesStatus(d, new ElementId(s.SheetId));
                c.R.Info("  " + s.Number + ": checkout=" + st + " owner=«" + owner + "» updates=" + up);
            }

            // A-001..A-004 → A-004..A-001 (бүгд өөр дугаар авна → түр дугаар шаардлагатай).
            ApplyResult res = RenumberApplyService.Apply(d, Request(snap,
                Item(snap, "Alpha", "A-004"), Item(snap, "Beta", "A-003"), Item(snap, "Gamma", "A-002"), Item(snap, "Delta", "A-001")));
            Ctx.Eq(ApplyOutcome.Applied, res.Outcome, "workshared document дээр apply (" + res.Message + " / " + res.Detail + ")");
            Ctx.Eq("A-004", NumberOf(d, "Alpha"), "Alpha");
            Ctx.Eq("A-001", NumberOf(d, "Delta"), "Delta");

            foreach (SheetSnapshot s in snap.Sheets)
            {
                string owner;
                CheckoutStatus st = WorksharingUtils.GetCheckoutStatus(d, new ElementId(s.SheetId), out owner);
                c.R.Info("  apply-ийн дараа " + s.Name + ": checkout=" + st + " owner=«" + owner + "»");
            }

            // Хуучирсан хүсэлт (дугаар гаднаас солигдсон) workshared дээр ч Stale.
            ApplyResult stale = RenumberApplyService.Apply(d, Request(snap, Item(snap, "Alpha", "A-009")));
            Ctx.Eq(ApplyOutcome.Stale, stale.Outcome, "workshared дээр хуучирсан хүсэлт");
        }
    }
}
