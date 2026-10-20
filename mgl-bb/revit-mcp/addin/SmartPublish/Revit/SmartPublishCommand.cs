using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using RevitMcpAddin.Smart.Core;
using RevitMcpAddin.SmartPublish.Core;
using RevitMcpAddin.SmartPublish.Ui;

namespace RevitMcpAddin.SmartPublish
{
    /// <summary>
    /// «Smart Publish» ribbon команд.  Урсгал (бүгд ЭНЭ командын Revit API контекстод):
    ///
    ///   цонх (модаль) → [Гаргах] → прогресс цонх + экспорт → цонх дахин (Түүх таб) → [Дахин оролдох] ...
    ///
    /// Модаль урсгал нь зориуд: Revit нь add-in-ийн модаль цонх нээлттэй үед ExternalEvent ГҮЙЦЭТГЭХГҮЙ
    /// (баримтжуулсан), харин командын дотор API контекст ХҮЧИНТЭЙ — экспорт шууд явна.  Гаргалтын үеэр
    /// загварыг хэрэглэгч ЗАСАХ боломжгүй (Revit-ийн үндсэн цонх модаль цонхоор хаагдсан) — гаргасан
    /// файлуудын нийцтэй байдал хадгалагдана.
    ///
    /// Загварыг ӨӨРЧЛӨХГҮЙ (IFC-ийн түр транзакц ROLLBACK).  `[Transaction(Manual)]`.
    /// </summary>
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public class SmartPublishCommand : IExternalCommand
    {
        private const string DialogTitle = "MGL — Файл гаргах";

        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            // ⚠️ ЛИЦЕНЗ (1.9.0): зөвхөн компанийн бүртгэлээр, ажлын компьютер дээр — Licensing/LicenseGate.cs.
            if (!global::RevitMcpAddin.Licensing.LicenseGate.Ensure()) return Result.Cancelled;
            UIDocument uidoc = commandData.Application.ActiveUIDocument;
            if (uidoc == null || uidoc.Document == null) return Result.Cancelled;
            Document doc = uidoc.Document;
            if (doc.IsFamilyDocument)
            {
                TaskDialog.Show(DialogTitle, "Файл гаргах нь зөвхөн төслийн файлд ажиллана — Family биш.");
                return Result.Cancelled;
            }

            RevitPublishSession session;
            try
            {
                session = new RevitPublishSession(doc);
            }
            catch (Exception ex)
            {
                SmartLog.Error("publish", "session_failed", ex);
                TaskDialog.Show(DialogTitle, "Гаргалтыг бэлтгэж чадсангүй (" + ex.GetType().Name + ").\nЛогийг шалгана уу: %APPDATA%\\RevitMcpAddin\\smart\\logs");
                return Result.Failed;
            }

            IntPtr owner = commandData.Application.MainWindowHandle;
            string tab = null;
            while (true)
            {
                var dlg = new PublishDialog(session, tab);
                bool? shown = App.ShowOwned(dlg, owner);
                PublishDialogResult res = dlg.Result;
                if (shown != true || res == null || res.Action == PublishDialogAction.None) break;

                try
                {
                    if (res.Action == PublishDialogAction.Publish)
                    {
                        PublishRun done = RunPublish(doc, session, res.Profile, res.Items, res.Plan, res.Report != null ? res.Report.Warnings : 0, null, owner);
                        WarnIfNotPersisted(done);
                        tab = "history";
                    }
                    else if (res.Action == PublishDialogAction.Retry)
                    {
                        RunRetry(doc, session, res.RetryOf, owner);
                        tab = "history";
                    }
                    else if (res.Action == PublishDialogAction.AnalyzeChanges)
                    {
                        // Шинжилгээ хийгээд цонхыг дахин нээнэ (сонголт = нөлөөлөгдсөн хуудсууд).  Цонх МОДАЛЬ тул
                        // шинжилгээ командын API контекстод явна (PublishImpactAnalysis-ийн тайлбар).
                        session.Affected = PublishImpactAnalysis.Run(commandData.Application, doc, session, res.Profile, owner);
                        tab = null;
                    }
                }
                catch (Exception ex)
                {
                    SmartLog.Error("publish", "run_unhandled", ex);
                    TaskDialog.Show(DialogTitle, "Гаргалтын үеэр гэнэтийн алдаа гарлаа (" + ex.GetType().Name + ").\nТүүхийг шалгана уу.");
                    tab = "history";
                }
            }
            return Result.Succeeded;
        }

        /// <summary>Түүх/checkpoint хадгалагдаагүй бол хэрэглэгчид ИЛ хэлнэ (лог л биш).</summary>
        private static void WarnIfNotPersisted(PublishRun run)
        {
            if (run == null || run.PersistWarnings == null || run.PersistWarnings.Count == 0) return;
            TaskDialog.Show(DialogTitle, "⚠ " + string.Join("\n\n⚠ ", run.PersistWarnings.Distinct()));
        }

        private static PublishRun RunPublish(Document doc, RevitPublishSession session, PublishProfile profile,
            List<PublishItem> items, PublishPlan plan, int warnings, string parentRunId, IntPtr owner,
            IReadOnlyCollection<string> knownExisting = null, DateTime? planNowLocal = null)
        {
            var progress = new PublishProgressWindow("MGL — Гаргаж байна");
            // Гаргалтын туршид Revit-ийн үндсэн цонхыг идэвхгүй болгоно — эс бөгөөс энэ хугацаанд дарсан товч/товчлуур дараалалд
            // хуримтлагдаж, дараа нь Revit-д хэрэгжинэ.
            using (new RevitMcpAddin.Smart.Ui.OwnerLock(owner))
            try
            {
                if (owner != IntPtr.Zero) new System.Windows.Interop.WindowInteropHelper(progress).Owner = owner;
                progress.Show();
                var opt = new PublishRunOptions
                {
                    Progress = progress,
                    Cancel = progress.Token,
                    Pump = UiPump.DoEvents,
                    ParentRunId = parentRunId,
                    PreflightWarnings = warnings,
                    // Гаргалтын ЭХЭНД өөрчлөлтийн дугаарын хаалт — хуудас бүрийн checkpoint-д бичигдэж, дараа нь «хойш юу
                    // өөрчлөгдсөн бэ» гэсэн шинжилгээний эхлэл болно.  Модаль гаргалтын үеэр загвар засагдахгүй.
                    ChangeSeq = ChangeImpact.ImpactService.Mark(),
                    KnownExistingPaths = knownExisting,
                    // Төлөвлөгөөг үүсгэсэн «одоо» — дахин оролдлого ТЭР цагаар төлөвлөнө ({Date} өөр өдөр/сессид шилжихгүй).
                    PlanNowUtc = (planNowLocal ?? session.Project.Now).ToUniversalTime(),
                };
                // Эхний «Бэлтгэж байна» нь цонхыг зурахад.
                UiPump.DoEvents();
                PublishRun run = PublishRunner.Run(doc, session.Key, profile, plan, items, opt);
                RecordPublishCheckpoint(session, profile, run, items);
                // Гаргалтын дараа хуучин шинжилгээ хүчингүй (checkpoint ахисан) — дараагийн цонхонд харуулахгүй.
                session.Affected = null;
                return run;
            }
            finally
            {
                progress.Finish();
            }
        }

        /// <summary>
        /// БҮРЭН амжилттай гаргалтыг «Өөрчлөлтийн нөлөө»-ийн шалгах цэг болгон бүртгэнэ (`Kind = publish`) — тэнд «сүүлийн гаргалтаас
        /// хойш» гэж сонгож болно.  Шалгах цэг «энэ өөрчлөлтийн дугаар хүртэл БҮХ зүйл гарсан» гэсэн утгатай тул:
        ///   • хэсэгчилсэн/бүтэлгүйтсэн гаргалт ОРОХГҮЙ;
        ///   • профайлын дүрмээр гарах БҮХ хуудсыг хамараагүй гүйлт (50-ын 3-ыг гаргасан) ОРОХГҮЙ — бусад хуудасны өөрчлөлт нуугдана;
        ///   • дахин оролдлого ОРОХГҮЙ — өмнөх амжилттай файлууд хуучин өөрчлөлтийн дугаартай; хуудас бүрийн checkpoint (хамгийн эртний формат) үүнийг зөв барьдаг.
        /// </summary>
        private static void RecordPublishCheckpoint(RevitPublishSession session, PublishProfile profile, PublishRun run, IReadOnlyList<PublishItem> publishedItems)
        {
            try
            {
                // ЗӨВХӨН бүх файл ШИНЭЭР амжилттай гарсан үед (алгассан/бүтэлгүй нэг ч файлгүй) — «Succeeded» нь бүгд алгассан гүйлтэд ч гарна.
                if (run == null || run.Status != RunStatus.Succeeded || run.Artifacts.Count == 0
                    || run.Artifacts.Any(a => a.Status != ArtifactStatus.Succeeded)) return;
                if (!string.IsNullOrEmpty(run.ParentRunId)) return;

                int covered, total;
                if (!ItemSelection.CoversAllSheets(session.Items, profile.Selection, publishedItems.Select(i => i.Id), out covered, out total))
                {
                    SmartLog.Info("publish", "impact_checkpoint_skipped_scope", new { covered, total });
                    return;
                }

                string err;
                bool saved = ChangeImpact.Core.CheckpointStore.Add(session.Key, new ChangeImpact.Core.ModelCheckpoint
                {
                    Utc = run.EndedUtc ?? run.StartedUtc,
                    Label = "Гаргалт: " + profile.Name,
                    Kind = "publish",
                    ChangeSeq = run.ChangeSeqAtStart ?? 0,
                    VersionGuid = run.DocVersionGuidAtStart,
                }, out err);
                if (!saved) SmartLog.Warn("publish", "impact_checkpoint_not_saved", new { err = SmartLog.Scrub(err) });
            }
            catch (Exception ex)
            {
                SmartLog.Warn("publish", "impact_checkpoint_failed", new { ex = ex.GetType().Name });
            }
        }

        /// <summary>
        /// Бүтэлгүйтсэн/цуцлагдсан файлуудыг шинэ гүйлтээр дахин оролдоно (анхных нь түүх хэвээр).
        ///
        /// ТӨЛӨВЛӨЛТ: эх гүйлтийн БҮХ хуудсаар, эх «одоо»-гоор (`{Date}`) дахин төлөвлөж, дараа нь ЗӨВХӨН бүтэлгүйтсэн (хуудас, формат) хосуудыг
        /// үлдээнэ — зөвхөн бүтэлгүйтсэн хуудсаар төлөвлөвөл `{Index}`/`{SheetCount}`/давхардлын дагавар өөр гарч файлын нэр өөр болно.
        ///
        /// ХЭСЭГЧИЛСЭН ФАЙЛ: ЗӨВХӨН ЭНЭ гүйлтийн ӨӨРИЙН үлдээсэн (`PublishArtifact.PartialPath`) файлыг `_v2` болгохгүй, ДАРЖ бичнэ.  Өөр хүний үүсгэсэн
        /// (`TargetChanged`), өмнөх гаргалтын, түгжигдсэн файлыг энд ХЭЗЭЭ Ч нуухгүй — профайлын «байгаа файл» дүрэм шинээр хэрэглэгдэнэ.
        /// </summary>
        private static void RunRetry(Document doc, RevitPublishSession session, PublishRun parent, IntPtr owner)
        {
            PublishProfile profile = session.Profiles.Profiles.FirstOrDefault(p => p.Id == parent.ProfileId);
            if (profile == null)
            {
                TaskDialog.Show(DialogTitle, "Энэ гүйлтийн профайл («" + parent.ProfileName + "») устгагдсан байна — дахин оролдох боломжгүй.");
                return;
            }

            // Эх гүйлтийн БҮХ хуудас (эх дарааллаар, одоо загварт байгаа нь) — төлөвлөлтөд; зөвхөн дахин оролдох хуудас — preflight-д.
            var byId = new Dictionary<string, PublishItem>(StringComparer.Ordinal);
            foreach (PublishItem it in session.Items) if (!byId.ContainsKey(it.Id)) byId[it.Id] = it;
            List<PublishItem> planItems = PublishRetry.PlanItemIds(parent).Where(byId.ContainsKey).Select(id => byId[id]).ToList();
            var retryIds = new HashSet<string>(PublishRetry.ItemIds(parent), StringComparer.Ordinal);
            List<PublishItem> retryItems = planItems.Where(i => retryIds.Contains(i.Id)).ToList();

            PublishProfile effective = profile.Clone();
            if (!string.IsNullOrWhiteSpace(parent.Destination)) effective.Destination.BaseFolder = parent.Destination;
            PublishContext ctx = PublishRetry.ContextFor(session.Project, parent);

            // ЗӨВХӨН диск дээр ОДОО ч бидний үлдээсэн хэвээр (хэмжээ + өөрчилсөн цаг таарсан) файлыг нууж/дарж бичнэ: хэн нэгэн тэр замд өөр файл тавьсан бол
            // (гараар экспортолсон г.м.) түүнд профайлын «байгаа файл» дүрэм шинээр хэрэглэгдэнэ.
            List<string> partials = PublishRetry.OwnPartialPaths(parent, session.Fs);
            IFileSystem fs = new PublishRetry.HidingFileSystem(session.Fs, partials);

            // Эх гүйлтийн хуудсуудаас зарим нь загвараас устсан бол тэдгээрийг төлөвлөлтөөс хасна → `{Index}` / `{SheetCount}` / давхардлын дагавар анхныхаас өөр гарч,
            // дахин оролдлого өөр нэртэй файл үүсгэж болно (анхны хэсэгчилсэн файл тусдаа үлдэнэ).  Чимээгүй орхихгүй.
            int goneFromModel = PublishRetry.PlanItemIds(parent).Count(id => !byId.ContainsKey(id));
            if (goneFromModel > 0)
            {
                var warn = new TaskDialog(DialogTitle)
                {
                    MainInstruction = goneFromModel + " хуудас загварт одоо олдохгүй байна (устсан байж болзошгүй).",
                    MainContent = "Дахин оролдлого олдсон хуудсуудаар л төлөвлөгдөнө — файлын нэрэнд {Index}, {SheetCount} зэрэг дугаарлалт орвол анхны гүйлтийн нэрээс ӨӨР гарч,"
                        + " анхны хэсэгчилсэн файл тусдаа үлдэж болно. Үргэлжлүүлэх үү?",
                    CommonButtons = TaskDialogCommonButtons.Yes | TaskDialogCommonButtons.No,
                    DefaultButton = TaskDialogResult.No,
                };
                if (warn.Show() != TaskDialogResult.Yes) return;
            }

            List<RetryTarget> targets = PublishRetry.Targets(parent);
            PublishPlan full = PublishPlanner.Build(effective, planItems, ctx, fs);
            PublishPlan plan = PublishRetry.Filter(full, targets);

            // Preflight ЗӨВХӨН дахин оролдох форматуудыг шалгана: нэг PDF-ийг дахин оролдоход эх гүйлтээс хойш нэрийг нь өөрчилсөн DWG тохиргоо / устгасан IFC харагдац
            // (энэ оролдлогод хамаагүй формат) блоклох ёсгүй.  Гүйлтийн бичлэг (`effective`) нь профайлын БҮХ форматыг хэвээр хадгална — checkpoint-ийн «бүрэн гарсан» дүрэм.
            PublishProfile preflightProfile = effective.Clone();
            preflightProfile.Formats = plan.Artifacts.Select(a => a.Format).Where(f => f != PublishFormat.Unknown).Distinct().ToList();

            PreflightReport report = PreflightEngine.Run(new PreflightContext
            {
                Profile = preflightProfile,
                Items = retryItems,
                Plan = plan,
                Project = ctx,
                Env = session.EnvFor(preflightProfile),
                Fs = fs,
            });
            if (!report.CanRun || plan.Artifacts.Count == 0)
            {
                string why = plan.Artifacts.Count == 0
                    ? "Дахин оролдох файл олдсонгүй."
                    : string.Join("\n", report.Findings.Where(f => f.Severity == PreflightSeverity.Blocking).Take(6).Select(f => "• " + f.Message));
                TaskDialog.Show(DialogTitle, "Дахин оролдоход Preflight блоклосон:\n\n" + why);
                return;
            }

            // Анхны гаргалтын цонх «байгаа файлыг дарж бичнэ» гэж асуудаг — дахин оролдлого мөн адил (өмнөх оролдлогын хэсэгчилсэн файл ЭНД тоологдохгүй).
            int overwrites = plan.Artifacts.Count(a => a.Action == PlanAction.Overwrite);
            if (overwrites > 0)
            {
                var ask = new TaskDialog(DialogTitle)
                {
                    MainInstruction = overwrites + " байгаа файлыг дарж бичнэ.",
                    MainContent = "Профайлын «Дарж бичих» горимоор дахин оролдлого эдгээр файлыг шинээр экспортлоно. Үргэлжлүүлэх үү?",
                    CommonButtons = TaskDialogCommonButtons.Yes | TaskDialogCommonButtons.No,
                    DefaultButton = TaskDialogResult.No,
                };
                if (ask.Show() != TaskDialogResult.Yes) return;
            }

            if (profile.Version != parent.ProfileVersion)
                SmartLog.Info("publish", "retry_profile_changed", new { was = parent.ProfileVersion, now = profile.Version });

            // ЗӨВХӨН өмнөх оролдлогын ӨӨРИЙН хэсэгчилсэн файлыг зориуд ДАРЖ бичнэ (race шалгалт «шинээр үүссэн» гэж үзэхгүй).
            // `run.ItemIds` = эх төлөвлөлтийн БҮХ хуудас (бүртгэлд тогтвортой, retry-ийн retry-д ч индекс/нэр өөрчлөгдөхгүй).
            PublishRun retried = RunPublish(doc, session, effective, planItems, plan, report.Warnings, parent.Id, owner, partials, ctx.Now);
            WarnIfNotPersisted(retried);
        }
    }
}
