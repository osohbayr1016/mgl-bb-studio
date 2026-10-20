using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using RevitMcpAddin.WallElevation.Core;
using RevitMcpAddin.WallElevation.Revit;
using RevitMcpAddin.WallElevation.Ui;

namespace RevitMcpAddin.WallElevation
{
    /// <summary>Хэрэглэгчтэй харилцах цэгүүд — ribbon командад Revit-ийн TaskDialog/WPF, шалгалтын harness-д скрипт.</summary>
    internal interface IWeWorkflowUi
    {
        /// <summary>Өрөө/хана (эсвэл tag, цэгээр сонгосон link-ийн өрөө) сонгуулна; null/хоосон = болих.</summary>
        WeTargets ChooseTargets(UIDocument uidoc);

        /// <summary>«+ Өрөө нэмэх» (2026-10-14): нэмэх өрөөнүүдийг сонгуулна (олон, Esc = дуусгах); null = юу ч нэмэхгүй.</summary>
        WeTargets ChooseMore(UIDocument uidoc);

        /// <summary>Цонхонд «+ Өрөө нэмэх» товч харуулах эсэх (план идэвхтэй — өрөөн дотор дарж сонгох боломжтой).</summary>
        bool CanChooseMore(UIDocument uidoc);

        /// <summary>Энгийн мэдэгдэл (алдаа, «юу ч сонгоогүй» г.м.).</summary>
        void Message(string text);

        /// <summary>Урьдчилсан дүнгийн цонх (модаль); true = «Үүсгэх».</summary>
        bool Preview(WallElevationDialog dialog);

        /// <summary>Тайлан; true = «Нээх» (холбоосын харагдацыг нээх).</summary>
        bool Report(WeReport report);

        /// <summary>
        /// Үр дүнг ХАРУУЛАХ: үүсгэсэн хуудсыг (хуудасгүй бол эхний дэлгээсийг) идэвхтэй харагдац болгоно — тайлангаас ӨМНӨ.
        /// Хэрэглэгчийн гомдол (2026-10-07): «үүсгэсэн дэлгээсийг олоход хэцүү».
        /// </summary>
        void Show(View view);

        /// <summary>
        /// АРЫН ГОРИМ (2026-10-07): ажлыг Revit-ийн Idling-ийн хостод өгнө — команд шууд дуусч хэрэглэгч Revit-д үргэлжлүүлэн ажиллана,
        /// явц баруун талын самбарт.  true = эхэлсэн; false = хост алга (OnStartup-д бүртгэл унасан) → <see cref="ConfirmForeground"/>.
        /// </summary>
        bool StartBackground(WeJob job);

        /// <summary>
        /// W01 (2026-10-16): арын горим боломжгүй үед ЧИМЭЭГҮЙ синхрон горим руу унахгүй — хэрэглэгчээс асууна: true = одоо шууд үүсгэх (Revit дуустал
        /// завгүй), false = болих (тохиргоо хадгалагдсан — Revit-ийг дахин эхлүүлээд дахин дарна).
        /// </summary>
        bool ConfirmForeground(string reason);

        /// <summary>
        /// W06 (2026-10-16): «Өмнөх үр дүн…» — баримтын БҮХ үүсгэсэн дэлгээсийн хөтөч (өрөө → дэлгээс → одоогийн хуудас), Revit дахин асаасны
        /// дараа ч (баримтаас уншина).  Модаль цонх хаагдсаны дараа (Revit API контекстод) дуудагдана.
        /// </summary>
        void OpenResults(Document doc);
    }

    /// <summary>Эцсийн тайлан — UI-аас хамааралгүй бичвэр.</summary>
    internal sealed class WeReport
    {
        public string Instruction;
        public string Content;
        public string Details;
        public string OpenLabel;
        public ElementId OpenViewId = ElementId.InvalidElementId;
        public bool Committed;
    }

    internal sealed class WeWorkflowResult
    {
        public bool Cancelled;
        public WeSettings Settings;
        public WePlan Plan;
        public WeRunResult Run;
        public WeReport Report;
        /// <summary>Хэрэглэгч «Нээх» сонгосон бол нээх харагдац.</summary>
        public View ViewToOpen;
        /// <summary>Арын горимд эхэлсэн ажил (үр дүн нь самбарт) — синхрон бол null.</summary>
        public WeJob Job;
    }

    /// <summary>
    /// «Ханын дэлгээс»-ийн БҮТЭН урсгал: сонголт → нөөц/индекс (баримтыг НЭГ удаа гүйлгэнэ) → урьдчилсан дүн (загварт хүрэхгүй)
    /// → хассан мөр → үүсгэх (<see cref="ElevationGenerationCoordinator"/>) → тайлан.  Ribbon команд ба Revit дотрох шалгалт
    /// ХОЁУЛАА энэ ангийг ажиллуулна — шалгасан урсгал = хэрэглэгчийн урсгал.
    /// </summary>
    internal sealed class WallElevationWorkflow
    {
        public const string Title = "MGL — Ханын дэлгээс";

        public WeWorkflowResult Run(UIDocument uidoc, IWeWorkflowUi ui, WeSettings initial, Action<WeSettings> save)
        {
            var outcome = new WeWorkflowResult { Cancelled = true };
            Document doc = uidoc.Document;
            if (doc.IsFamilyDocument)
            {
                ui.Message("Ханын дэлгээс зөвхөн төслийн файлд ажиллана (family биш).");
                return outcome;
            }

            WeTargets ids = ui.ChooseTargets(uidoc);
            if (ids == null || ids.Count == 0) return outcome;

            var timings = new WeTimings();
            var units = new WeRevitUnits();
            WeResources res = timings.Measure("нөөц", () => WeResources.Collect(doc));
            if (res.SectionTypes.Count == 0 && res.ElevationTypes.Count == 0)
            {
                ui.Message("Загварт Elevation ч, Section ч харагдацын төрөл алга — нэгийг үүсгээд дахин оролдоно уу.");
                return outcome;
            }

            // «+ Өрөө нэмэх» (2026-10-14): цонх хаагдаж өрөө нэмж сонгоод ДАХИН нээгдэнэ — тохиргоо, хассан мөр хадгалагдана.
            WeSettings current = initial ?? new WeSettings();
            ICollection<string> carriedExcluded = null;
            WeRequest req = null;
            Func<WeSettings, WePlan> planner = null;
            WallElevationDialog dlg = null;
            List<WeLegendInfo> legends = null;
            WeSheetParamChoice typeDes = null;
            List<string> sheetChoices = null;
            for (int round = 0; ; round++)
            {
                WeTargets roundIds = ids;
                req = timings.Measure("сонголт унших", () => Resolve(doc, roundIds, res));
                if (req.Rooms.Count == 0 && req.Walls.Count == 0)
                {
                    // WE-BUG-004 (live gate, 2026-10-13): ачаалагдаагүй link-ийн өрөөний tag сонгоход тайлбар (SelectionNotes) аль хэдийн бэлэн
                    // байсан ч ерөнхий мессеж түүнийг хаядаг байв — хэрэглэгч ЯАГААД гэдгийг мэдэхгүй.  Сонголтын тайлбарыг эхэнд.
                    string std = res.Standards.Found ? res.Standards.Summary() : null;
                    List<string> why = req.SelectionNotes.Where(n => !string.IsNullOrEmpty(n) && n != std).ToList();
                    ui.Message((why.Count > 0 ? string.Join("\n", why) + "\n\n" : string.Empty)
                               + "Сонголтод өрөө эсвэл хана алга.  Планаас өрөө (эсвэл өрөөний tag), хана сонгоод дахин дарна уу.");
                    return outcome;
                }

                WeRequest roundReq = req;
                planner = s => WallElevationPlanner.Plan(roundReq,
                    new WePlanContext { Settings = s, Units = units, ViewSetupToken = res.SetupToken(s) });

                // 2026-10-14: доод талын урьдчилсан зураг — ЖИНХЭНЭ үүсгэх замаар нэг дэлгээс, PNG, бүгдийг буцаана.
                var live = new WeLivePreview(doc, req, units);
                // Ажлын зургийн бүрдэл (2026-10-14): хуудсыг Project Browser-ийн аль бүлэг, хэсэгт оруулах — цонхонд сонгоно.
                WeSheetFolders folders = timings.Measure("хуудасны бүлэг", () => WeSheetFolderReader.Read(doc, res));
                // 3-р тойрог (2026-10-14): legend-ийг таних тэмдгээр хайх; «* Type Designator»-ийг цонхноос сонгох (баримтаас НЭГ удаа).
                if (legends == null) legends = timings.Measure("legend-ийн тэмдэг", () => WeLegendReader.Read(doc, res.Legends));
                WeSettings cur0 = current;
                if (typeDes == null) typeDes = timings.Measure("Type Designator", () => WeSheetParamReader.Read(doc, WeSheetDiscipline.TypeDesignatorParam, cur0.InteriorTool));
                // W02 (2026-10-16): «Байршлын хуудас» — хэрэглэгч бэлэн хуудас ИЛ сонгож болно (өгөгдмөл: өрөө тус бүр шинэ хуудас).
                if (sheetChoices == null) sheetChoices = timings.Measure("хуудасны жагсаалт", () => SheetChoices(doc));
                // W05: хуудас/тэмдгийн дугаарлалтын урьдчилсан дүн, зөрчил (цонхонд — зөрчилтэй бол «Үүсгэх» идэвхгүй).
                WeSheetNumberContext numberCtx = NumberContext(res);
                Func<WePlan, WeSettings, ICollection<string>, WeNumberingResult> numbering = (p, s, ex) => WeNumbering.Evaluate(p, s, ex, numberCtx);
                dlg = new WallElevationDialog(current,
                    res.ViewTypeChoices(current.ViewKind),
                    res.Templates.Select(t => t.Name).ToList(),
                    new[] { res.AutoTitleBlockLabel() }.Concat(res.TitleBlocks.Select(WeResources.TitleBlockLabel)).ToList(),
                    req.Rooms.Count, req.Walls.Count, planner, units,
                    res.DimTypes.Select(t => t.Name).ToList(),
                    res.SpotTypes.Select(t => t.Name).ToList(),
                    res.KeynoteTypes.Select(WeResources.TitleBlockLabel).ToList(),
                    legends,
                    k => res.ViewTypeChoices(k),
                    res.Standards.ElevationTemplate != null ? "‹Төслийн стандарт› " + res.Standards.ElevationTemplate.Name : null,
                    live.Start,
                    folders,
                    ui.CanChooseMore(uidoc),
                    carriedExcluded,
                    typeDes,
                    sheetChoices,
                    numbering);
                // «Санал хүсэлт» (2026-10-16): тохиргооны цонхноос шууд — хэрэгсэл, үе шат, өрөө/ханын тоо, тохиргооны хураангуй
                // оношилгоонд.  Модаль цонхны товчны дарцаар (API context) дуудагдана; «Санал хүсэлт» цонх нь modeless.
                UIDocument fbDoc = uidoc;
                WallElevationDialog fbDlg = dlg;
                int fbRooms = req.Rooms.Count, fbWalls = req.Walls.Count;
                dlg.FeedbackRequested = () =>
                {
                    try
                    {
                        WeSettings s = fbDlg.Settings ?? current;
                        var extra = new Dictionary<string, string>
                        {
                            ["rooms"] = fbRooms.ToString(System.Globalization.CultureInfo.InvariantCulture),
                            ["walls"] = fbWalls.ToString(System.Globalization.CultureInfo.InvariantCulture),
                            ["view_kind"] = s.ViewKind.ToString(),
                            ["interior_tool"] = s.InteriorTool ? "1" : "0",
                            ["elevation_scale"] = s.Scale.ToString(System.Globalization.CultureInfo.InvariantCulture),
                        };
                        Feedback.FeedbackCommand.Open(fbDoc?.Application, "MglWallElevations",
                            s.InteriorTool ? "Ханын дэлгээс (Интерьер)" : "Ханын дэлгээс", "тохиргооны цонх", null, null, extra);
                    }
                    catch (Exception ex)
                    {
                        WeLog.Error("feedback", "Санал хүсэлт нээх", ex);
                    }
                };
                bool ok;
                try { ok = ui.Preview(dlg); }
                finally
                {
                    // Цонх ямар ч замаар хаагдсан — дуусаагүй урьдчилсан зургийн түр өөрчлөлт загварт ҮЛДЭХГҮЙ.
                    dlg.CancelPreviewJob();
                    live.CancelAll();
                }
                if (dlg.ResultsRequested)
                {
                    ui.OpenResults(doc);
                    return outcome;
                }
                if (dlg.AddRoomsRequested && round < 50)
                {
                    current = dlg.Settings;
                    carriedExcluded = new List<string>(dlg.ExcludedKeys ?? new List<string>());
                    WeTargets more = ui.ChooseMore(uidoc);
                    if (more != null && more.Count > 0) ids = WeTargets.Union(ids, more);
                    continue;
                }
                if (!ok) return outcome;
                break;
            }

            WeSettings settings = dlg.Settings;
            if (save != null) save(settings);
            WePlan plan = timings.Measure("геометр, төлөвлөгөө", () => planner(settings));
            var excluded = new HashSet<string>(dlg.ExcludedKeys ?? new List<string>(), StringComparer.Ordinal);
            WallElevationPlanner.ApplyExclusions(plan, excluded);
            // W05: дугаарлалт — зөрчилтэй бол загварт ХҮРЭХГҮЙ (цонх аль хэдийн хаасан байх ёстой; хооронд нь загвар өөрчлөгдсөн бол энд барина).
            WeNumberingResult nr = WeNumbering.Evaluate(plan, settings, excluded, NumberContext(res));
            if (!nr.Ok)
            {
                ui.Message("Дугаарлалтыг засахгүйгээр үүсгэх боломжгүй:\n\n" + string.Join("\n", nr.Errors) + "\n\nТохиргоо хадгалагдсан — засаад дахин ажиллуулна уу.");
                return outcome;
            }
            plan.SheetNumbers = nr.SheetNumbers;
            foreach (string n in nr.Notes) plan.Notes.Add(n);

            // АРЫН ГОРИМ (ribbon): команд ЭНД дуусна — ажил Revit-ийн Idling дээр алхам алхмаар, хэрэглэгч хүлээх хооронд Revit-д ажиллана.
            // Ажил эхлэхдээ нөөц, сонголт, төлөвлөгөөг ДАХИН уншина (дараалалд хүлээх хооронд загвар өөрчлөгдсөн байж болно).
            View active = null;
            try { active = uidoc.ActiveView; } catch { }
            var job = new WeJob(doc, JobTitle(plan), active != null ? active.Id : ElementId.InvalidElementId,
                                t => Prepare(doc, ids, settings, excluded, t));
            if (ui.StartBackground(job))
            {
                outcome.Cancelled = false;
                outcome.Settings = settings;
                outcome.Plan = plan;
                outcome.Job = job;
                return outcome;
            }
            // W01: арын хост алга (OnStartup-д бүртгэл унасан г.м.) — чимээгүй блоклохгүй, хэрэглэгч шийднэ.  Тохиргоо аль хэдийн хадгалагдсан.
            if (!ui.ConfirmForeground("Арын горимын хост (баруун талын «MGL — Ажлын явц») энэ Revit-д бүртгэгдээгүй байна.  Одоо шууд үүсгэвэл Revit дуустал "
                                      + "(" + JobTitle(plan) + ") завгүй болно.  Revit-ийг дахин эхлүүлбэл арын горимоор (Revit-д үргэлжлүүлэн ажиллах боломжтой) ажиллана."))
            {
                WeLog.Info("run", doc.Title + " · арын хост алга — хэрэглэгч шууд үүсгэхээс татгалзав (тохиргоо хадгалагдсан)");
                return outcome;
            }

            var coord = new ElevationGenerationCoordinator(doc, new SectionElevationViewFactory(), res, settings, units);
            WeRunResult result = coord.Run(plan, timings);
            WeLog.Info("run", doc.Title + " · " + Summary(result) + " · " + timings);

            WeReport report = BuildReport(result, plan, ViewTypeName(res, settings));
            // Үр дүнг шууд харуулна: хуудас (эсвэл эхний дэлгээс).
            View shown = null;
            if (result.Committed)
            {
                shown = result.Sheets.Select(id => doc.GetElement(id) as View).FirstOrDefault(v => v != null)
                        ?? (report.OpenViewId != ElementId.InvalidElementId ? doc.GetElement(report.OpenViewId) as View : null);
                if (shown != null)
                {
                    try { ui.Show(shown); } catch (Exception ex) { WeLog.Error("open", shown.Name, ex); }
                    var sh = shown as ViewSheet;
                    report.Content = (sh != null ? "Хуудас «" + sh.SheetNumber + " — " + sh.Name + "» нээгдлээ (Project Browser → Sheets)."
                                                 : "«" + shown.Name + "» нээгдлээ.") + "\n\n" + report.Content;
                }
            }
            bool open = ui.Report(report);
            outcome.Cancelled = false;
            outcome.Settings = settings;
            outcome.Plan = plan;
            outcome.Run = result;
            outcome.Report = report;
            if (open && report.OpenViewId != ElementId.InvalidElementId) outcome.ViewToOpen = doc.GetElement(report.OpenViewId) as View;
            return outcome;
        }

        /// <summary>Сонголтыг унших (өрөө, хана, link) + одоо байгаа дэлгээсийн индекс.</summary>
        private static WeRequest Resolve(Document doc, WeTargets ids, WeResources res)
        {
            WeRequest r = new ElevationTargetResolver(doc).Resolve(ids);
            r.Existing = GeneratedElevationRepository.ExistingViews(doc, res.Generated);
            r.ExistingViewNames = res.ViewNames;
            if (res.Standards.Found) r.SelectionNotes.Add(res.Standards.Summary());
            return r;
        }

        /// <summary>
        /// W05: хуудасны дугаар хуваарилах орчин — төслийн бүх хуудасны дугаар, энэ хэрэгслийн өмнө хуудастай бүлэг (эхний хуудас), төслийн цуваа.
        /// </summary>
        internal static WeSheetNumberContext NumberContext(WeResources res)
        {
            var ctx = new WeSheetNumberContext { Taken = new HashSet<string>(res.SheetNumbers, StringComparer.OrdinalIgnoreCase) };
            var groups = new HashSet<string>(StringComparer.Ordinal);
            foreach (KeyValuePair<View, WeRecord> kv in res.Generated)
            {
                if (kv.Value.Kind != GeneratedElevationRepository.KindSheet || !(kv.Key is ViewSheet) || !kv.Key.IsValidObject) continue;
                string key = kv.Value.Key ?? string.Empty;
                if (key.StartsWith("sheet|", StringComparison.Ordinal) && key.EndsWith("|p0", StringComparison.Ordinal))
                    groups.Add(key.Substring(6, key.Length - 9));
            }
            ctx.GroupsWithSheet = groups;
            if (res.Standards.Found)
                ctx.LearnedNext = taken => res.Standards.NextSheetNumber(new HashSet<string>(taken, StringComparer.OrdinalIgnoreCase));
            return ctx;
        }

        /// <summary>Төслийн хуудсууд «BA428 — 101 ХАНЫН ДЭЛГЭЭС» (дугаарын дарааллаар, placeholder-гүй) — «Байршлын хуудас» сонголтод.</summary>
        private static List<string> SheetChoices(Document doc)
        {
            return new FilteredElementCollector(doc).OfClass(typeof(ViewSheet)).Cast<ViewSheet>()
                .Where(sh => !sh.IsPlaceholder && !sh.IsTemplate)
                .OrderBy(sh => sh.SheetNumber, StringComparer.OrdinalIgnoreCase)
                .Select(sh => sh.SheetNumber + " — " + sh.Name)
                .ToList();
        }

        private static string ViewTypeName(WeResources res, WeSettings settings)
        {
            return res.UsesStandardType(settings) ? res.Standards.ElevationType.Name
                : string.IsNullOrWhiteSpace(settings.ViewTypeName) ? WeResources.OwnViewTypeName : settings.ViewTypeName;
        }

        /// <summary>
        /// Арын ажил эхлэх үед: нөөц, сонголт, төлөвлөгөөг ДАХИН (≈ 0.5 с, загварт хүрэхгүй) — цонхонд харсантай ижил тохиргоо, хассан мөрөөр.
        /// Өрөө/хана устсан бол null.
        /// </summary>
        internal static WeJob.Prepared Prepare(Document doc, WeTargets ids, WeSettings settings, ICollection<string> excluded, WeTimings timings)
        {
            var units = new WeRevitUnits();
            WeResources res = timings.Measure("нөөц", () => WeResources.Collect(doc));
            var alive = new WeTargets { Ids = ids.Ids.Where(id => doc.GetElement(id) != null).ToList(), RoomUids = ids.RoomUids.ToList() };
            WeRequest req = timings.Measure("сонголт унших", () => Resolve(doc, alive, res));
            if (req.Rooms.Count == 0 && req.Walls.Count == 0) return null;
            WePlan plan = timings.Measure("геометр, төлөвлөгөө", () => WallElevationPlanner.Plan(req,
                new WePlanContext { Settings = settings, Units = units, ViewSetupToken = res.SetupToken(settings) }));
            WallElevationPlanner.ApplyExclusions(plan, excluded);
            // W05: дугаарлалтыг ДАХИН (дараалалд хүлээх хооронд хуудас нэмэгдсэн байж болно) — зөрчилтэй бол загварт хүрэхгүй.
            WeNumberingResult nr = WeNumbering.Evaluate(plan, settings, excluded, NumberContext(res));
            plan.SheetNumbers = nr.SheetNumbers;
            foreach (string n in nr.Notes) plan.Notes.Add(n);
            // W01: ажил явж байх үед эдгээр элемент өөрчлөгдвөл төлөвлөгөө хуучирна (WeJob дахин төлөвлөнө).
            WeSourceWatch watch = WeSourceWatch.From(req, units);
            if (watch.UsesLinks)
            {
                foreach (RevitLinkInstance li in new FilteredElementCollector(doc).OfClass(typeof(RevitLinkInstance)).Cast<RevitLinkInstance>())
                {
                    watch.LinkIds.Add(li.Id.Value);
                    ElementId lt = li.GetTypeId();
                    if (lt != null && lt != ElementId.InvalidElementId) watch.LinkIds.Add(lt.Value);
                }
            }
            return new WeJob.Prepared
            {
                Res = res,
                Plan = plan,
                Watch = watch,
                Coordinator = new ElevationGenerationCoordinator(doc, new SectionElevationViewFactory(), res, settings, units),
                ViewTypeName = ViewTypeName(res, settings),
                Settings = settings,
                Error = nr.Ok ? null : "Дугаарлалтын зөрчил — дэлгээс үүсгэсэнгүй (загварт хүрээгүй):  " + string.Join("  ", nr.Errors),
            };
        }

        /// <summary>Самбарын гарчиг: «Ханын дэлгээс · Өрөө 310 — Үйлчилгээний талбай-10 (Давхар 3) → 8 дэлгээс».</summary>
        internal static string JobTitle(WePlan plan)
        {
            int n = plan.Items.Count(i => i.Action == WeAction.Create || i.Action == WeAction.Update || i.Action == WeAction.Keep);
            string what = plan.Groups.Count == 1 ? (plan.Groups[0].GroupLabel ?? plan.Groups[0].Label)
                        : plan.Groups.Count > 1 ? plan.Groups.Count + " өрөө" : "сонгосон хана";
            return "Ханын дэлгээс · " + what + " → " + n + " дэлгээс";
        }

        public static string Summary(WeRunResult r)
        {
            int created = r.Count(i => i.Outcome == "Үүсгэв");
            int updated = r.Count(i => i.Outcome == "Шинэчлэв");
            int kept = r.Count(i => i.Outcome == "Хэвээр");
            int failed = r.Count(i => i.Status == WeStatus.Failed);
            int notMade = r.Count(i => i.Outcome == "Алгасав" && i.Status > WeStatus.Warning);
            int excluded = r.Count(i => i.Plan.ActionNote == "Та хассан");
            var parts = new List<string>();
            if (created > 0) parts.Add(created + " шинэ");
            if (updated > 0) parts.Add(updated + " шинэчилсэн");
            if (kept > 0) parts.Add(kept + " өөрчлөлтгүй");
            if (excluded > 0) parts.Add(excluded + " хассан");
            if (notMade > 0) parts.Add(notMade + " үүсгээгүй (дэмжигдэхгүй/шалгах)");
            if (failed > 0) parts.Add(failed + " алдаа");
            if (r.KeyPlansCreated + r.KeyPlansUpdated > 0) parts.Add((r.KeyPlansCreated > 0 ? r.KeyPlansCreated + " шинэ" : r.KeyPlansUpdated + " шинэчилсэн") + " түлхүүр план");
            if (r.AxonsCreated + r.AxonsUpdated > 0) parts.Add((r.AxonsCreated > 0 ? r.AxonsCreated + " шинэ" : r.AxonsUpdated + " шинэчилсэн") + " 3D");
            if (r.SheetsCreated + r.ViewportsPlaced + r.ExtrasPlaced > 0)
                parts.Add(r.SheetsCreated + " хуудас, " + (r.ViewportsPlaced + r.ExtrasPlaced) + " байрлуулсан");
            var anno = new List<string>();
            if (r.AnnoDims > 0) anno.Add(r.AnnoDims + " хэмжээс");
            if (r.AnnoSpots > 0) anno.Add(r.AnnoSpots + " spot level");
            if (r.AnnoTags > 0) anno.Add(r.AnnoTags + " шошго");
            if (r.AnnoKeynotes > 0) anno.Add(r.AnnoKeynotes + " keynote");
            if (anno.Count > 0) parts.Add("тэмдэглэгээ: " + string.Join(", ", anno));
            if (r.AnnoFailed > 0) parts.Add(r.AnnoFailed + " тэмдэглэгээ тавигдсангүй (дэлгэрэнгүйг логоос)");
            return parts.Count == 0 ? "Өөрчлөлт алга" : string.Join(" · ", parts);
        }

        public static WeReport BuildReport(WeRunResult r, WePlan plan, string viewTypeName)
        {
            return BuildReport(r, plan, viewTypeName, false);
        }

        /// <param name="background">Арын горим — алхам бүр тусдаа (нэг Ctrl+Z биш); буцаах нь самбарын «Бүгдийг буцаах».</param>
        public static WeReport BuildReport(WeRunResult r, WePlan plan, string viewTypeName, bool background)
        {
            var details = new StringBuilder();
            // Эхлээд анхаарах зүйл (алдаа, шалгах, анхааруулга), дараа нь бусад.
            foreach (WeRunItem i in r.Items.OrderByDescending(x => x.Status))
            {
                string mark = i.Status == WeStatus.Ready ? "✓" : i.Status == WeStatus.Warning ? "⚠" : i.Status == WeStatus.RequiresReview ? "?" : "✖";
                details.Append(mark).Append(' ').Append(i.Outcome).Append(" — ")
                       .Append(string.IsNullOrEmpty(i.ViewName) ? i.Plan.WallLabel : i.ViewName)
                       .Append(" (").Append(i.Plan.GroupLabel).Append(')');
                if (!string.IsNullOrEmpty(i.Message)) details.Append(": ").Append(i.Message);
                details.AppendLine();
            }
            foreach (WeOrphan o in plan.Orphans) details.Append("⚠ Эх нь алга: ").Append(o.Name).Append(" — ").AppendLine(o.Reason);
            foreach (string n in plan.Notes.Concat(r.Notes)) details.Append("ⓘ ").AppendLine(n);
            if (r.MarkersHidden > 0) details.Append("ⓘ Дэлгээсүүд дээр бусад дэлгээсийн ").Append(r.MarkersHidden).AppendLine(" тэмдгийг нуув (Reveal Hidden-ээр харагдана).");
            if (r.WarningsHidden > 0) details.Append("ⓘ Revit-ийн ").Append(r.WarningsHidden).AppendLine(" анхааруулгыг нуув.");
            details.Append("Хугацаа: ").AppendLine(r.Timings.ToString());

            int failed = r.Count(i => i.Status == WeStatus.Failed);
            WeRunItem first = r.Items.FirstOrDefault(i => (i.Outcome == "Үүсгэв" || i.Outcome == "Шинэчлэв") && i.ViewId != ElementId.InvalidElementId);
            var rep = new WeReport
            {
                Committed = r.Committed,
                Instruction = !r.Committed ? (failed > 0 ? "Дэлгээс үүсгэж чадсангүй" : "Загвар өөрчлөгдсөнгүй")
                              : failed > 0 ? "Ханын дэлгээс бэлэн — " + failed + " алдаатай (доор)" : "Ханын дэлгээс бэлэн",
                Content = Summary(r) + (!r.Committed ? string.Empty
                          : (background ? "\n\nБуцаах бол энэ самбарын «Бүгдийг буцаах»." : "\n\nБүгдийг нэг Ctrl+Z-ээр буцаана.")
                            + "  Харагдацууд Project Browser → Elevations / Sections («" + viewTypeName + "»), хуудас → Sheets."),
                Details = details.ToString(),
            };
            if (first != null)
            {
                rep.OpenViewId = first.ViewId;
                rep.OpenLabel = "Нээх: " + first.ViewName;
            }
            return rep;
        }
    }
}
