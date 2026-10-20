using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Selection;

namespace RevitMcpAddin.CloneDrawings
{
    /// <summary>
    /// «Зураг хувилах» ribbon команд (2026-09-30).  Инженер НЭГ элементийн (загвар — жишээ
    /// нь B1 дам нуруу, C1 багана) зургийг бүрэн хийчихээд, бусад ижил элементэд (B2…B9)
    /// нэг товчоор хуулна:
    ///
    ///   1. Загвар элементээ сонгоно (эсвэл өмнө нь сонгоод товч дарна).
    ///   2. Зорилтот элементүүдээ сонгоод «Finish» (юу ч сонгохгүй бол цонхноос бүгдийг нэмнэ).
    ///   3. Цонхноос аль харагдац (бүлэг + шүүлт), юуг хувилахоо, аль бүлгийг хамруулахаа сонгоно.
    ///
    /// 2026-10-01: «Хувилах» дармагц команд ДУУСНА — хувилалт АРЫН горимд (<see cref="CdJobHost"/>,
    /// Revit-ийн Idling дээр алхам алхмаар) явж, явц баруун талын «MGL — Зураг хувилах» самбарт гарна;
    /// хэрэглэгч Revit-д үргэлжлүүлэн ажиллана.  Алхам бүр өөрийн Transaction-тай (нэг Ctrl+Z биш —
    /// самбарын «Бүгдийг буцаах»).  Арын хост эхлээгүй бол хуучин синхрон зам (<see cref="CdRunner"/>).
    /// </summary>
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public class CloneDrawingsCommand : IExternalCommand
    {
        private const string DialogTitle = "MGL — Зураг хувилах";

        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            // ⚠️ ЛИЦЕНЗ (1.9.0): зөвхөн компанийн бүртгэлээр, ажлын компьютер дээр — Licensing/LicenseGate.cs.
            if (!global::RevitMcpAddin.Licensing.LicenseGate.Ensure()) return Result.Cancelled;
            UIDocument uidoc = commandData.Application.ActiveUIDocument;
            if (uidoc?.Document == null)
                return Result.Cancelled;
            Document doc = uidoc.Document;
            if (doc.IsFamilyDocument)
            {
                TaskDialog.Show(DialogTitle, "Зөвхөн project файл дээр ажиллана (family биш).");
                return Result.Cancelled;
            }
            View active = doc.ActiveView;
            if (!(active is ViewPlan || active is ViewSection || active is View3D) || active.IsTemplate)
            {
                TaskDialog.Show(DialogTitle,
                    "План, зүсэлт эсвэл 3D харагдац нээгээд дахин дарна уу.\n\n"
                    + "Загвар ба зорилтот элементүүдийг загварын харагдац дээр сонгоно (хуудас, хүснэгт, draft дээр биш).");
                return Result.Cancelled;
            }

            // Хувилалт явагдаж байвал самбарыг харуулна (хэрэглэгч хаасан байж болно) — шинэ хувилалтыг тохируулж
            // дараалалд нэмж болно; зөвхөн самбар харах гэсэн бол сонголтоос Esc.
            IMglJob busy = CdJobHost.IsReady ? CdJobHost.Busy : null;
            if (busy != null)
                CdJobHost.ShowPane(commandData.Application);

            try
            {
                // ── 1. Загвар элемент
                Element tpl = null;
                ICollection<ElementId> pre = uidoc.Selection.GetElementIds();
                if (pre.Count == 1 && CdAnalysis.IsCloneable(doc.GetElement(pre.First())))
                    tpl = doc.GetElement(pre.First());
                if (tpl == null)
                {
                    Reference r = uidoc.Selection.PickObject(ObjectType.Element, new CdPickFilter(null, null),
                        "ЗАГВАР элементээ сонгоно уу — зураг нь (зүсэлт, tag, хэмжээс) бүрэн хийгдсэн элемент");
                    tpl = doc.GetElement(r);
                }
                if (tpl == null)
                    return Result.Cancelled;

                CdHostIndex hosts = CdHostIndex.Build(doc);
                CdTemplateInfo info = CdAnalysis.AnalyzeTemplate(doc, tpl, hosts);
                if (info.Views.Count == 0 && info.Candidates.Count == 0)
                {
                    TaskDialog.Show(DialogTitle,
                        "«" + info.Label + "» элементэд холбогдсон зураг олдсонгүй.\n\n"
                        + "Загвар элемент нь ядаж нэг харагдацад tag эсвэл хэмжээстэй байх, эсвэл түүнийг "
                        + "тусгайлан харуулдаг (тайрсан) зүсэлт/callout байх ёстой.  Эхлээд нэг элементийнхээ "
                        + "зургийг бүрэн хийгээд дахин дарна уу.");
                    return Result.Cancelled;
                }

                // ── 2. Зорилтууд
                try { uidoc.Selection.SetElementIds(new List<ElementId> { tpl.Id }); } catch { }
                IList<Reference> picked = uidoc.Selection.PickObjects(ObjectType.Element,
                    new CdPickFilter(tpl.Category.Id, tpl.Id),
                    "«" + info.Label + "» (" + info.Kind.ToLowerInvariant() + ")-ийн зургийг хуулах ЗОРИЛТОТ "
                    + info.Kind.ToLowerInvariant() + "-уудаа сонгоод «Finish»  "
                    + "(юу ч сонгохгүй Finish дарвал цонхноос «+ Ижил төрлийн бүгд»)");

                CdLinks.CloneIndex clones = CdLinks.CloneIndex.Build(doc);
                var seen = new HashSet<ElementId>();
                var targets = new List<CdTargetInfo>();
                foreach (Reference r in picked)
                {
                    Element e = doc.GetElement(r);
                    if (e == null || e.Id == tpl.Id || !seen.Add(e.Id))
                        continue;
                    targets.Add(CdAnalysis.DescribeTarget(doc, info, e, clones));
                }

                // ── 3. Цонх
                AddinSettings settings = SettingsStore.Load();
                busy = CdJobHost.IsReady ? CdJobHost.Busy : null;
                string queueNote = busy == null ? null
                    : "Өмнөх ажил («" + busy.Title + "», " + Core.JobProgress.Percent(busy.Fraction) + "%) явагдаж байна — энэ нь дараалалд орж, түүний дараа эхэлнэ.";
                var dlg = new CloneDrawingsDialog(info, targets, FromPrefs(settings.CloneDrawings, info.Kind),
                    sameType => CdAnalysis.SameCategory(doc, info, sameType)
                        .Select(e => CdAnalysis.DescribeTarget(doc, info, e, clones)).ToList(),
                    () =>
                    {
                        List<CdLinkedView> found = CdAnalysis.FindCandidates(doc, tpl, info);
                        info.Candidates.AddRange(found);
                        return found;
                    },
                    ChoiceFromPrefs(settings.CloneDrawings, info.Kind),
                    queueNote);
                if (App.ShowOwned(dlg, commandData.Application.MainWindowHandle) != true)
                    return Result.Cancelled;
                try
                {
                    settings.CloneDrawings = ToPrefs(dlg, info.RebarCount > 0, settings.CloneDrawings, info.Kind);
                    SettingsStore.Save(settings);
                }
                catch
                {
                    // Тохиргоо хадгалагдахгүй байх нь хувилахад саад болохгүй.
                }

                List<CdLinkedView> views = dlg.SelectedViews();
                List<ElementId> targetIds = dlg.SelectedTargetIds();
                CdOptions options = dlg.ToOptions();
                if (views.Count == 0 || targetIds.Count == 0)
                    return Result.Cancelled;
                List<string> manual = dlg.ManualLinksChanged() ? dlg.ManualViewUids() : null;

                // ── 4. Гүйцэтгэл — АРЫН ГОРИМД: команд энд дуусч, Revit сул зогсох бүрд хэдэн алхам хийгдэнэ.
                if (CdJobHost.IsReady)
                {
                    var job = new CdJob(doc, tpl, info, hosts, views, targetIds, options, manual);
                    CdJobHost.Enqueue(job);
                    if (!CdJobHost.ShowPane(commandData.Application))
                    {
                        TaskDialog.Show(DialogTitle,
                            "Хувилалт арын горимд эхэллээ — Revit-д үргэлжлүүлэн ажиллаж болно.\n\n"
                            + "Явцын самбар нээгдсэнгүй (Revit-ээ дахин эхлүүлбэл гарна); дуусахад тайлан цонхоор гарна.");
                    }
                    return Result.Succeeded;
                }

                // Нөөц: арын хост эхлээгүй (OnStartup-д бүртгэл унасан) — хуучин синхрон зам, нэг Ctrl+Z.
                CdReport rep = CdRunner.Run(doc, tpl, info, hosts, views, targetIds, options, manual);
                ShowReport(uidoc, rep);
                return rep.TargetsDone > 0 ? Result.Succeeded : Result.Failed;
            }
            catch (Autodesk.Revit.Exceptions.OperationCanceledException)
            {
                return Result.Cancelled;
            }
            catch (Exception ex)
            {
                message = ex.Message;
                TaskDialog.Show(DialogTitle, "Алдаа гарлаа:\n\n" + ex.Message);
                return Result.Failed;
            }
        }

        /// <summary>
        /// Сүүлийн сонголт.  «Аль элементийн tag» нь ЗАГВАРЫН ТӨРЛӨӨР санагдана: дам нуруу хувилахдоо
        /// фермийн tag-ийг асаасан бол дараагийн дам нуруунд ч асаалттай, баганад — өөрийнх нь.
        /// Анх удаа (санасан зүйлгүй): зөвхөн загварын төрөл (хурдан, «зөвхөн дам нуруу»).
        /// </summary>
        private static CdOptions FromPrefs(CloneDrawingsPrefs p, string kind)
        {
            p = p ?? new CloneDrawingsPrefs();
            HashSet<string> kinds = new HashSet<string> { kind };
            if (p.AnnotationKinds != null && p.AnnotationKinds.TryGetValue(kind, out List<string> extra) && extra != null)
                kinds.UnionWith(extra);
            return new CdOptions
            {
                Tags = p.Tags,
                Dimensions = p.Dimensions,
                Spots = p.Spots,
                Details = p.Details,
                Sheets = p.Sheets,
                Rebar = p.Rebar,
                ReplaceMark = p.ReplaceMark,
                AnnotationKinds = kinds,
            };
        }

        /// <summary>Өмнө нь хэрэглэгч өгөгдмөлөөс өөрөөр сонгосон харагдац, унтраасан төрөл (загварын төрлөөр).</summary>
        private static CdViewChoice ChoiceFromPrefs(CloneDrawingsPrefs p, string kind)
        {
            var c = new CdViewChoice();
            if (p?.ViewsOn != null)
                c.On.UnionWith(p.ViewsOn.Where(x => !string.IsNullOrEmpty(x)));
            if (p?.ViewsOff != null)
                c.Off.UnionWith(p.ViewsOff.Where(x => !string.IsNullOrEmpty(x)));
            if (p?.ViewTypesOff != null && p.ViewTypesOff.TryGetValue(kind, out List<string> off) && off != null)
                c.TypesOff.UnionWith(off);
            return c;
        }

        /// <summary>
        /// Загварт арматургүй үед «арматур» сонголт идэвхгүй байсан тул хуучин утгыг хадгална.  Харагдацын сонголт,
        /// төрлийн шүүлт, «аль элементийн tag»-ийг ЭНЭ цонхонд гарсан зүйлсээр л шинэчилнэ — бусдыг хөндөхгүй.
        /// </summary>
        private static CloneDrawingsPrefs ToPrefs(CloneDrawingsDialog dlg, bool rebarAvailable, CloneDrawingsPrefs old, string kind)
        {
            CdOptions o = dlg.ToOptions();
            var kinds = old?.AnnotationKinds != null
                ? new Dictionary<string, List<string>>(old.AnnotationKinds)
                : new Dictionary<string, List<string>>();
            var extra = new HashSet<string>(kinds.TryGetValue(kind, out List<string> was) && was != null ? was : new List<string>());
            foreach (KeyValuePair<string, bool> kv in dlg.KindChoices())
            {
                if (kv.Key == kind)
                    continue;
                if (kv.Value)
                    extra.Add(kv.Key);
                else
                    extra.Remove(kv.Key);
            }
            kinds[kind] = extra.OrderBy(k => k, StringComparer.Ordinal).ToList();

            CdViewChoice ch = dlg.Choice();
            var on = new List<string>(old?.ViewsOn ?? new List<string>());
            var off = new List<string>(old?.ViewsOff ?? new List<string>());
            foreach (string uid in dlg.ShownViewUids())
            {
                Core.RecentSet.Set(on, uid, ch.On.Contains(uid));
                Core.RecentSet.Set(off, uid, ch.Off.Contains(uid));
            }
            var typesOff = old?.ViewTypesOff != null
                ? new Dictionary<string, List<string>>(old.ViewTypesOff)
                : new Dictionary<string, List<string>>();
            var types = new List<string>(typesOff.TryGetValue(kind, out List<string> t0) && t0 != null ? t0 : new List<string>());
            foreach (string t in dlg.ShownTypes())
            {
                types.Remove(t);
                if (ch.TypesOff.Contains(t))
                    types.Add(t);
            }
            typesOff[kind] = types;

            return new CloneDrawingsPrefs
            {
                Tags = o.Tags,
                Dimensions = o.Dimensions,
                Spots = o.Spots,
                Details = o.Details,
                Sheets = o.Sheets,
                Rebar = rebarAvailable ? o.Rebar : (old?.Rebar ?? true),
                ReplaceMark = o.ReplaceMark,
                AnnotationKinds = kinds,
                ViewsOn = on,
                ViewsOff = off,
                ViewTypesOff = typesOff,
            };
        }

        private static void ShowReport(UIDocument uidoc, CdReport rep)
        {
            Document doc = uidoc.Document;
            var td = new TaskDialog(DialogTitle)
            {
                MainInstruction = rep.TargetsDone == 0 ? "Юу ч хувилагдсангүй"
                    : rep.AnythingNew ? "Зураг хувилж дууслаа" : "Бүгд аль хэдийн хувилагдсан байна",
                MainContent = rep.Summary(),
                CommonButtons = TaskDialogCommonButtons.Close,
            };
            View sheet = rep.FirstSheetId == null ? null : doc.GetElement(rep.FirstSheetId) as View;
            View view = rep.FirstViewId == null ? null : doc.GetElement(rep.FirstViewId) as View;
            if (sheet != null)
                td.AddCommandLink(TaskDialogCommandLinkId.CommandLink1, "Эхний шинэ хуудсыг нээх", sheet.Title);
            if (view != null)
                td.AddCommandLink(TaskDialogCommandLinkId.CommandLink2, "Эхний шинэ харагдацыг нээх", view.Name);
            TaskDialogResult res = td.Show();
            try
            {
                if (res == TaskDialogResult.CommandLink1 && sheet != null)
                    uidoc.RequestViewChange(sheet);
                else if (res == TaskDialogResult.CommandLink2 && view != null)
                    uidoc.RequestViewChange(view);
            }
            catch
            {
                // Харагдац нээх нь зөвхөн тав тух.
            }
        }
    }

    /// <summary>Загвар/зорилт сонгох шүүлтүүр: загвар болж болох элемент, зорилтод ИЖИЛ АНГИЛАЛ.</summary>
    internal sealed class CdPickFilter : ISelectionFilter
    {
        private readonly ElementId _category;
        private readonly ElementId _exclude;

        public CdPickFilter(ElementId category, ElementId exclude)
        {
            _category = category;
            _exclude = exclude;
        }

        public bool AllowElement(Element elem)
        {
            if (!CdAnalysis.IsCloneable(elem))
                return false;
            if (_exclude != null && elem.Id == _exclude)
                return false;
            return _category == null || elem.Category.Id == _category;
        }

        public bool AllowReference(Reference reference, XYZ position) => false;
    }
}
