using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using Autodesk.Revit.DB;
using RevitMcpAddin.Smart.Core;
using RevitMcpAddin.SmartPublish.Core;

namespace RevitMcpAddin.SmartPublish
{
    internal sealed class PublishRunOptions
    {
        public IProgress<JobProgress> Progress { get; set; }
        public CancellationToken Cancel { get; set; }
        /// <summary>Файл бүрийн ДАРАА дуудагдана (UI-д амьсгал өгөх: `UiPump.DoEvents`).</summary>
        public Action Pump { get; set; }
        public IFileSystem Fs { get; set; } = RealFileSystem.Instance;
        public string ParentRunId { get; set; }
        public int PreflightWarnings { get; set; }
        /// <summary>Гаргалтын ЭХЭНД байсан загварын өөрчлөлтийн дугаар (Change Impact capture) — байхгүй бол null.</summary>
        public long? ChangeSeq { get; set; }
        /// <summary>
        /// Төлөвлөхөөс ӨМНӨ ч байгаа гэдгийг мэдэж буй файлууд (дахин оролдлогын ӨМНӨХ оролдлогын ӨӨРИЙН хэсэгчилсэн файл — зориуд ДАРЖ бичнэ).
        /// Бусад файл төлөвлөгөө гарснаас хойш үүссэн бол дарж бичихгүй (`PublishFailureCode.TargetChanged`).
        /// </summary>
        public IReadOnlyCollection<string> KnownExistingPaths { get; set; }
        /// <summary>Төлөвлөгөөг үүсгэхэд ашигласан «одоо» (`{Date}`) — түүхэд хадгалагдаж, дахин оролдлого ижил нэр гаргахад хэрэглэгдэнэ.</summary>
        public DateTime? PlanNowUtc { get; set; }
    }

    /// <summary>
    /// Төлөвлөгөөг ЭКСПОРТЛОНО.  Revit-ийн үндсэн thread дээр, хүчинтэй API контекстэд (IExternalCommand
    /// эсвэл `SmartExecutor` step) дуудагдана.
    ///
    /// ГЭРЭЭ:
    ///   • Файл бүр БИЕ ДААСАН: нэг файлын алдаа (түгжигдсэн, тохиргоо буруу, Revit татгалзсан) бусдыг
    ///     зогсоохгүй; `Failures` дээр шалтгаан код, дахин оролдох боломжтой эсэхтэй.
    ///   • Цуцлалт ФАЙЛУУДЫН ХООРОНД л (экспортын ДУНДУУР зогсоох аюулгүй арга байхгүй).  Цуцлагдсан
    ///     гүйлт `Cancelled` — `Failed`-аас ялгагдана; оролдоогүй файлууд `Cancelled` артифакт.
    ///   • Түүх ЭХЛЭХЭД (Running) ба ДУУСАХАД хоёр удаа атомаар хадгалагдана — Revit гэнэт хаагдсан
    ///     ч «Running» хэвээр үлдэж, ямар нэг юм гарсныг харуулна.
    ///   • Checkpoint-ыг ЗӨВХӨН бүрэн амжилттай хуудсуудад ахиулна (`PublishCheckpointStore.Advance`).
    ///   • «Файл байна» ≠ «амжилттай»: `ArtifactValidator` экспортын ӨМНӨХ/ДАРААХ хавтсыг харьцуулж
    ///     ХУУЧИН файлыг амжилт гэж тооцдоггүй.  PDF-д Revit `false` буцаасан бол файл үүссэн ч
    ///     артифакт `Failed` (хэсэгчилсэн файлын замыг тэмдэглэнэ, УСТГАХГҮЙ).
    /// </summary>
    internal static class PublishRunner
    {
        internal static PublishRun Run(Document doc, DocumentKey key, PublishProfile profile, PublishPlan plan,
            IReadOnlyList<PublishItem> items, PublishRunOptions opt)
        {
            opt = opt ?? new PublishRunOptions();
            IFileSystem fs = opt.Fs ?? RealFileSystem.Instance;

            var run = new PublishRun
            {
                DocKey = key.Id,
                DocTitle = key.Display,
                ProfileId = profile.Id,
                ProfileName = profile.Name,
                ProfileVersion = profile.Version,
                StartedUtc = SmartClock.UtcNow,
                Status = RunStatus.Running,
                Formats = (profile.Formats ?? new List<PublishFormat>()).Where(f => f != PublishFormat.Unknown).Distinct().ToList(),
                Destination = profile.Destination != null ? profile.Destination.BaseFolder : null,
                ItemIds = items.Select(i => i.Id).ToList(),
                PlannedCount = plan.Artifacts.Count,
                ParentRunId = opt.ParentRunId,
                PreflightWarnings = opt.PreflightWarnings,
                ChangeSeqAtStart = opt.ChangeSeq,
                DocVersionGuidAtStart = TryVersionGuid(doc),
                PlanNowUtc = opt.PlanNowUtc,
            };

            Save(key, run);
            SmartLog.Info("publish", "run_started", new { run = SmartLog.Id(run.Id), artifacts = plan.Artifacts.Count, formats = run.Formats.Select(f => f.ToString()).ToArray() });

            var sw = Stopwatch.StartNew();
            var adapters = new Dictionary<PublishFormat, IExportAdapter>
            {
                { PublishFormat.Pdf, new PdfExportAdapter() },
                { PublishFormat.Dwg, new DwgExportAdapter() },
                { PublishFormat.Ifc, new IfcExportAdapter() },
            };
            Dictionary<string, ElementId> ids = ResolveIds(doc, items);
            var known = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string kp in opt.KnownExistingPaths ?? new string[0]) known.Add(PathKey.Of(kp));
            var preparedFolders = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            bool createMissing = profile.Destination == null || profile.Destination.CreateMissing;

            bool cancelled = false;
            int index = 0;
            int total = plan.Artifacts.Count;

            foreach (PlannedArtifact pa in plan.Artifacts)
            {
                index++;
                var art = new PublishArtifact
                {
                    ItemId = pa.ItemId,
                    ItemLabel = pa.ItemLabel,
                    Format = pa.Format,
                    Path = pa.FullPath,
                    Status = ArtifactStatus.Pending,
                    MemberIds = new List<string>(pa.MemberIds ?? new List<string>()),
                };
                run.Artifacts.Add(art);

                if (cancelled || opt.Cancel.IsCancellationRequested)
                {
                    cancelled = true;
                    art.Status = ArtifactStatus.Cancelled;
                    art.Notes.Add("Хэрэглэгч зогсоосон — оролдоогүй.");
                    PublishRetry.CarryForwardPartial(art, pa.FullPath, known, fs);       // өмнөх оролдлогын файлыг энэ оролдлого хөндөөгүй — мартахгүй
                    continue;
                }

                Report(opt, "export", index - 1, total, pa.ItemLabel + " → " + pa.Format.ToString().ToUpperInvariant());

                if (pa.Action == PlanAction.SkipExisting)
                {
                    art.Status = ArtifactStatus.Skipped;
                    art.Notes.Add("Файл байгаа тул алгасав.");
                    continue;
                }

                var artWatch = Stopwatch.StartNew();
                try
                {
                    ExportOne(doc, profile, pa, art, run, ids, adapters, fs, preparedFolders, createMissing, known);
                }
                catch (Exception ex) when (!(ex is OperationCanceledException))
                {
                    // Сүүлчийн хамгаалалт — адаптер бүр өөрийн алдааг барьдаг ч planner/validator-ын
                    // гэнэтийн алдаа бусад файлыг зогсоох ёсгүй.
                    Fail(run, art, PublishFailureCode.Unknown, "Гэнэтийн алдаа: " + SmartLog.Scrub(ex.Message), ex, true);
                    SmartLog.Error("publish", "artifact_unexpected", ex, new { run = SmartLog.Id(run.Id), fmt = pa.Format.ToString() });
                }
                // Энэ оролдлого өмнөх оролдлогын хэсэгчилсэн файлд хүрэлгүй бүтэлгүйтсэн (түгжигдсэн, хавтас бичигдэхгүй, ...) бол файл ХЭВЭЭР үлдсэн — дараагийн оролдлого мартахгүй.
                PublishRetry.CarryForwardPartial(art, pa.FullPath, known, fs);
                art.DurationMs = artWatch.ElapsedMilliseconds;

                Report(opt, "export", index, total, pa.ItemLabel);
                if (opt.Pump != null) opt.Pump();
            }

            sw.Stop();
            run.EndedUtc = SmartClock.UtcNow;
            run.DurationMs = sw.ElapsedMilliseconds;
            run.Status = Summarize(run, cancelled);
            Save(key, run);

            AdvanceCheckpoints(key, run, items);
            SmartLog.Info("publish", "run_finished", new
            {
                run = SmartLog.Id(run.Id),
                status = run.Status.ToString(),
                ok = run.Artifacts.Count(a => a.Status == ArtifactStatus.Succeeded),
                failed = run.Failures.Count,
                ms = run.DurationMs,
            });
            return run;
        }

        /* ============================== ONE FILE =========================== */

        private static void ExportOne(Document doc, PublishProfile profile, PlannedArtifact pa, PublishArtifact art, PublishRun run,
            Dictionary<string, ElementId> ids, Dictionary<PublishFormat, IExportAdapter> adapters, IFileSystem fs,
            HashSet<string> preparedFolders, bool createMissing, HashSet<string> knownExisting)
        {
            if (string.IsNullOrEmpty(pa.Folder) || string.IsNullOrEmpty(pa.FileBaseName))
            {
                Fail(run, art, PublishFailureCode.PreflightBlocked, "Гаргах хавтас эсвэл файлын нэр тодорхойгүй.", null, false);
                return;
            }

            // Хавтас
            if (!preparedFolders.Contains(pa.Folder))
            {
                string err;
                if (!PrepareFolder(fs, pa.Folder, createMissing, out err))
                {
                    Fail(run, art, PublishFailureCode.DestinationNotWritable, err, null, true);
                    return;
                }
                preparedFolders.Add(pa.Folder);
            }

            // Харагдацууд
            var req = new ExportRequest { Doc = doc, Profile = profile, Artifact = pa };
            if (pa.Format != PublishFormat.Ifc)
            {
                var missing = new List<string>();
                foreach (string member in pa.MemberIds)
                {
                    ElementId id;
                    if (ids.TryGetValue(member, out id)) req.ViewIds.Add(id);
                    else missing.Add(member);
                }
                if (req.ViewIds.Count == 0)
                {
                    Fail(run, art, PublishFailureCode.ItemNotFound, "Сонгосон хуудас загварт олдсонгүй (устгагдсан байж болзошгүй).", null, false);
                    return;
                }
                if (missing.Count > 0)
                {
                    art.Notes.Add(missing.Count + " хуудас загварт олдоогүй тул алгассан.");
                    // Түүх/checkpoint нь ЗӨВХӨН файлд ЯГ ОРСОН хуудсыг заана: олдоогүй (устсан) хуудсын checkpoint ахихгүй, дахин оролдлого тэднийг хайхгүй.
                    art.MemberIds.RemoveAll(m => missing.Contains(m));
                }
            }

            IExportAdapter adapter;
            if (!adapters.TryGetValue(pa.Format, out adapter))
            {
                Fail(run, art, PublishFailureCode.Unknown, "Танигдаагүй формат.", null, false);
                return;
            }

            // ТӨЛӨВЛӨГӨӨ ↔ ДИСК: дарж бичихээр ТӨЛӨВЛӨӨГҮЙ зорилтот файл (Export, шинэ дугаартай `_vN`) одоо диск дээр байвал (өөр хэрэглэгч, өөр процесс,
            // урт гаргалтын завсар) ДАРЖ БИЧИХГҮЙ — тэр нь өөр хүний файлыг чимээгүй устгана, баталгаажуулалт ч ШИНЭ гэж хүлээн авна.
            // ⚠️ «Шинэ дугаартай»-д ТӨЛӨВЛӨСӨН нэр (`_v2`) дээр шалгана — эх нэрийн `TargetExists` нь `_v2` чөлөөтэй гэсэн баталгаа БИШ (`PublishRace`).
            // Дахин оролдох = шинэ төлөвлөгөө; «Overwrite» горимд дарж бичих нь төлөвлөгөөт тул зөвшөөрөгдөнө.
            if (PublishRace.TargetAppeared(pa.Action, () => fs.FileExists(pa.FullPath), knownExisting.Contains(PathKey.Of(pa.FullPath))))
            {
                Fail(run, art, PublishFailureCode.TargetChanged,
                    "Файл төлөвлөгөө гарснаас хойш үүссэн (өөр хэрэглэгч/процесс) — дарж бичихгүй. Дахин оролдоход профайлын «байгаа файл» дүрэм (шинэ дугаар / алгасах / дарах) тэр файлд шинээр хэрэглэгдэнэ.", null, true);
                return;
            }

            IReadOnlyList<FileFacts> before = fs.ListFiles(pa.Folder);
            ExportOutcome outcome = adapter.Export(req);
            IReadOnlyList<FileFacts> after = fs.ListFiles(pa.Folder);
            ArtifactCheck check = ArtifactValidator.Validate(pa.FullPath, before, after);

            // Шийдвэр нь цэвэр функцэд (`ArtifactClassifier`, тестлэгдсэн) — энд зөвхөн хэрэглэнэ.
            ArtifactVerdict verdict = ArtifactClassifier.Classify(outcome, check, pa.FullPath, pa.MemberIds.Count);
            art.Path = verdict.Path ?? art.Path;
            art.PartialPath = verdict.Status == ArtifactStatus.Succeeded ? null : verdict.PartialPath;
            art.SizeBytes = verdict.SizeBytes;
            art.CreatedUtc = verdict.CreatedUtc;
            art.Notes.AddRange(verdict.Notes);
            if (verdict.Status == ArtifactStatus.Succeeded)
            {
                art.Status = ArtifactStatus.Succeeded;
                art.Validated = verdict.Validated;
                if (pa.Notes != null) art.Notes.AddRange(pa.Notes);
            }
            else
            {
                Fail(run, art, verdict.Code, verdict.Message, null, verdict.Retryable, verdict.ExceptionType);
            }
        }

        private static bool PrepareFolder(IFileSystem fs, string folder, bool createMissing, out string error)
        {
            error = null;
            try
            {
                if (!fs.DirectoryExists(folder))
                {
                    if (!createMissing)
                    {
                        error = "Гаргах хавтас байхгүй байна.";
                        return false;
                    }
                    fs.CreateDirectory(folder);
                }
                string probe;
                if (!fs.TryProbeWritable(folder, out probe))
                {
                    error = "Гаргах хавтсанд бичих боломжгүй байна" + (string.IsNullOrEmpty(probe) ? "." : " (" + probe + ").");
                    return false;
                }
                return true;
            }
            catch (Exception ex) when (ex is System.IO.IOException || ex is UnauthorizedAccessException || ex is ArgumentException || ex is NotSupportedException)
            {
                error = "Хавтас үүсгэх/шалгахад алдаа гарлаа (" + ex.GetType().Name + ").";
                return false;
            }
        }

        private static void Fail(PublishRun run, PublishArtifact art, PublishFailureCode code, string message, Exception ex, bool retryable, string exType = null)
        {
            art.Status = ArtifactStatus.Failed;
            run.Failures.Add(new PublishFailure
            {
                ItemId = art.ItemId,
                ItemLabel = art.ItemLabel,
                Format = art.Format,
                Code = code,
                Message = message,
                ExceptionType = exType ?? (ex != null ? ex.GetType().Name : null),
                Retryable = retryable,
            });
        }

        private static RunStatus Summarize(PublishRun run, bool cancelled)
        {
            if (cancelled) return RunStatus.Cancelled;
            int ok = run.Artifacts.Count(a => a.Status == ArtifactStatus.Succeeded);
            int skipped = run.Artifacts.Count(a => a.Status == ArtifactStatus.Skipped);
            int failed = run.Artifacts.Count(a => a.Status == ArtifactStatus.Failed);
            if (failed == 0) return RunStatus.Succeeded;   // бүгд амжилттай эсвэл алгассан
            if (ok + skipped == 0) return RunStatus.Failed;
            return RunStatus.Partial;
        }

        /* ============================== HELPERS ============================ */

        private static Dictionary<string, ElementId> ResolveIds(Document doc, IReadOnlyList<PublishItem> items)
        {
            var map = new Dictionary<string, ElementId>(StringComparer.Ordinal);
            foreach (PublishItem it in items)
            {
                try
                {
                    Element e = doc.GetElement(it.Id);
                    if (e != null) map[it.Id] = e.Id;
                }
                catch (Exception) { /* олдсонгүй гэж тооцогдоно */ }
            }
            return map;
        }

        private static string TryVersionGuid(Document doc)
        {
            try { return Document.GetDocumentVersion(doc).VersionGUID.ToString(); }
            catch (Exception) { return null; }
        }

        private static void Report(PublishRunOptions opt, string stage, int done, int total, string message)
        {
            if (opt.Progress != null) opt.Progress.Report(JobProgress.Of(stage, done, total, message));
        }

        private const string HistoryWarning = "Гаргалтын түүхийг хадгалж чадсангүй — энэ гүйлт түүхэд харагдахгүй байж болно.";

        private static void Save(DocumentKey key, PublishRun run)
        {
            string err;
            if (!PublishHistoryStore.Upsert(key, run, out err))
            {
                SmartLog.Warn("publish", "history_save_failed", new { run = SmartLog.Id(run.Id), err = SmartLog.Scrub(err) });
                if (!run.PersistWarnings.Contains(HistoryWarning)) run.PersistWarnings.Add(HistoryWarning);
            }
            else
            {
                // Эхний («Явагдаж байна») хадгалалт унаад эцсийнх нь амжилттай болсон бол анхааруулга ХУУЧИРСАН — түүх одоо хадгалагдсан.
                run.PersistWarnings.Remove(HistoryWarning);
            }
        }

        private static void AdvanceCheckpoints(DocumentKey key, PublishRun run, IReadOnlyList<PublishItem> items)
        {
            try
            {
                PublishCheckpoints cps = PublishCheckpointStore.Load(key);
                var rev = new Dictionary<string, string>(StringComparer.Ordinal);
                foreach (PublishItem i in items)
                    if (i.RevisionNumber != null && !string.IsNullOrEmpty(i.Id)) rev[i.Id] = i.RevisionNumber;   // ToDictionary нь давхардсан id-д унана
                PublishCheckpointStore.Advance(cps, run, rev);
                string err;
                if (!PublishCheckpointStore.Save(key, cps, out err))
                {
                    SmartLog.Warn("publish", "checkpoint_save_failed", new { err = SmartLog.Scrub(err) });
                    run.PersistWarnings.Add("Хуудасны «сүүлд гаргасан» тэмдгийг хадгалж чадсангүй — файлууд гарсан ч «өөрчлөгдсөн хуудас» шинжилгээнд эдгээр хуудас хуучин хэвээр харагдана.");
                }
            }
            catch (Exception ex)
            {
                SmartLog.Error("publish", "checkpoint_failed", ex);
                // Чимээгүй залгихгүй: файлууд гарсан ч «сүүлд гаргасан» тэмдэг ахиагүй — хэрэглэгч мэдэх ёстой.
                run.PersistWarnings.Add("Хуудасны «сүүлд гаргасан» тэмдгийг шинэчилж чадсангүй (" + ex.GetType().Name + ") — файлууд гарсан ч «өөрчлөгдсөн хуудас» шинжилгээнд эдгээр хуудас хуучин хэвээр харагдана.");
            }
        }
    }
}
