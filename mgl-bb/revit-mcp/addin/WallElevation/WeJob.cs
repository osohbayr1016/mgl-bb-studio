using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Events;
using Autodesk.Revit.UI;
using RevitMcpAddin.CloneDrawings;
using RevitMcpAddin.CloneDrawings.Core;
using RevitMcpAddin.WallElevation.Core;
using RevitMcpAddin.WallElevation.Revit;

namespace RevitMcpAddin.WallElevation
{
    /// <summary>
    /// «Ханын дэлгээс»-ийн АРЫН ГОРИМЫН ажил (2026-10-07).  Эзний хүсэлт: «хуудас үүсгэх дарсны дараа mouse loading болоод Revit-ээ
    /// ашиглаж чадахгүй байна — зураг клонлох шиг хүлээх хооронд дараагийн зураг болон бусад зүйлсээ хийж суумаар байна».
    ///
    /// «Зураг клонлох»-ын хостыг (<see cref="CdJobHost"/>, Revit-ийн Idling) ашиглана: цонхонд «Үүсгэх» дармагц команд ДУУСНА, ажил
    /// баруун талын «MGL — Ажлын явц» самбарт явцаа харуулж <see cref="ElevationGenerationCoordinator"/>-ийн алхмуудыг нэг нэгээр гүйцэтгэнэ.
    ///
    /// ГЭРЭЭ:
    ///   • Алхам бүр НЭГ <see cref="TransactionGroup"/> («MGL дэлгээс #3 · 310A — харагдац…») — Undo жагсаалтад нэг мөр.  Синхрон горимын
    ///     «нэг Ctrl+Z» байхгүй — оронд нь «Бүгдийг буцаах» энэ ажлын ҮҮСГЭСЭН харагдац, хуудас, маркерыг устгана.
    ///   • Ажил дараалалд хүлээж байх хооронд загвар өөрчлөгдсөн байж болох тул ЭХЛЭХДЭЭ нөөц, сонголт, төлөвлөгөөг ДАХИН уншина
    ///     (<see cref="Prepare"/>, ≈ 0.5 с) — хоёр ажил нэг өрөөнд давхар дэлгээс үүсгэхгүй.
    ///   • Хэрэглэгч Ctrl+Z-ээр манай алхмыг буцаавал түр зогсооно (өөрийнхөө ажлыг буцаах гэж байсан байж болно).
    ///   • Дууссаны дараа хэрэглэгч эхэлсэн харагдацаасаа шилжээгүй бол эхний хуудсыг нээнэ; шилжсэн бол самбарт «Хуудас нээх».
    /// </summary>
    internal sealed class WeJob : IMglJob
    {
        public const string TxPrefix = "MGL дэлгээс";

        /// <summary>Нөөц + төлөвлөгөө + гүйцэтгэгч — ажил эхлэх үед дахин бэлтгэнэ.</summary>
        internal sealed class Prepared
        {
            public WeResources Res;
            public WePlan Plan;
            public ElevationGenerationCoordinator Coordinator;
            public string ViewTypeName;
            public WeSettings Settings;
            /// <summary>Загварт хүрэхээс ӨМНӨ зогсоох шалтгаан (W05 — дугаарлалтын зөрчил г.м.); null = үргэлжлүүлнэ.</summary>
            public string Error;
            /// <summary>W01: төлөвлөгөөний эх элементүүд — ажил явж байх үед өөрчлөгдвөл дахин төлөвлөнө.</summary>
            public WeSourceWatch Watch;
        }

        private sealed class TxBusyException : Exception
        {
            public TxBusyException(string message) : base(message) { }
        }

        public readonly Document Doc;
        private readonly Func<WeTimings, Prepared> _prepare;
        private readonly ElementId _startView;
        private readonly WeTimings _timings = new WeTimings();
        private Prepared _p;
        private WeRunResult _result;
        private WeReport _report;
        private bool _executing, _inStep, _pendingPause, _pendingCancel;
        private int _stepNo;
        private string _openMessage;
        /// <summary>W01: сүүлийн төлөвлөлтөөс хойш эх элемент өөрчлөгдсөн шалтгаан (null = төлөвлөгөө хүчинтэй).</summary>
        private string _staleWhy;
        private int _replans;
        private readonly List<DateTime> _replanTimes = new List<DateTime>();
        /// <summary>Дахин төлөвлөхөөс ӨМНӨХ хэсгүүдийн үр дүн — дууссаны дараа нэг тайланд нэгтгэнэ.</summary>
        private readonly List<WeRunResult> _segments = new List<WeRunResult>();
        private bool _folded;
        /// <summary>W01: алхмын хугацаа — урт алхмыг логт (бодит загвар дээр хэмжиж засах).</summary>
        private readonly WeSlowSteps _slow = new WeSlowSteps();

        public int Number { get; }
        public CdJobState State { get; private set; } = CdJobState.Queued;
        public string Status { get; private set; } = "Өмнөх ажил дуусахыг хүлээж байна";
        public string Notice { get; private set; }
        public string Title { get; }
        public string DocTitle { get; }
        public bool Background { get; set; }
        public bool WaitingForRevit { get; private set; }
        public bool Undone { get; private set; }
        public string UndoResult { get; private set; }
        public DateTime? FinishedAt { get; private set; }
        public long ActiveMs { get; private set; }

        /// <summary>Энэ ажлын алхмуудаар НЭМЭГДСЭН элемент (DocumentChanged) — «Бүгдийг буцаах».</summary>
        internal readonly HashSet<long> Created = new HashSet<long>();

        public WeJob(Document doc, string title, ElementId startView, Func<WeTimings, Prepared> prepare)
        {
            Number = MglJobSeq.Next();
            Doc = doc;
            Title = title;
            _startView = startView ?? ElementId.InvalidElementId;
            _prepare = prepare;
            try { DocTitle = doc.Title; } catch { DocTitle = string.Empty; }
        }

        public bool IsFinished => State == CdJobState.Done || State == CdJobState.Cancelled || State == CdJobState.Failed;

        public bool DocAlive
        {
            get
            {
                try { return Doc != null && Doc.IsValidObject; }
                catch { return false; }
            }
        }

        private double _maxFraction;

        /// <summary>0..1 — хэзээ ч буурахгүй (хуудасны алхмын тоо явцын дунд тодорхой болдог).</summary>
        public double Fraction
        {
            get
            {
                if (State == CdJobState.Done) return 1;
                if (_p == null) return 0;
                _maxFraction = Math.Max(_maxFraction, Math.Max(0.02, _p.Coordinator.Fraction));
                return _maxFraction;
            }
        }

        /// <summary>Энэ ажлын үр дүн (дууссаны дараа).</summary>
        public WeRunResult Result => _result;
        public WeReport Report => _report;

        public string FinalReport => _report == null ? Status : _report.Instruction + "\n\n" + _report.Content;

        public bool SameDoc(Document d)
        {
            try { return d != null && DocAlive && d.IsValidObject && Doc.Equals(d); }
            catch { return false; }
        }

        // ── Удирдлага (самбарын товч — Revit API дуудахгүй) ─────────────────

        public void Start()
        {
            if (State != CdJobState.Queued) return;
            State = CdJobState.Running;
            Status = "Бэлтгэж байна…";
        }

        public void Pause()
        {
            if (_inStep) { _pendingPause = true; return; }
            if (State == CdJobState.Running)
            {
                State = CdJobState.Paused;
                Status = "Түр зогсоосон — «Үргэлжлүүлэх» дарвал яг энэ цэгээс үргэлжилнэ";
            }
        }

        public void Resume()
        {
            _pendingPause = false;
            if (State == CdJobState.Paused)
            {
                State = CdJobState.Running;
                Notice = null;
                Status = "Үргэлжлүүлж байна…";
            }
        }

        public void Cancel(string why = null)
        {
            if (IsFinished) return;
            if (_inStep) { _pendingCancel = true; return; }
            Complete(CdJobState.Cancelled, why ?? "Цуцалсан — хийгдсэн дэлгээс, хуудас хадгалагдсан (дахин ажиллуулбал дутууг нь нэмнэ)");
        }

        // ── Гүйцэтгэл ──────────────────────────────────────────────────────

        /// <summary>Синхрон (Revit дотрох шалгалт): бүх алхмыг дараалан — дуудагч TransactionGroup эзэмшиж болно.</summary>
        internal void RunToEnd()
        {
            Start();
            while (State == CdJobState.Running)
            {
                Step(long.MaxValue);
                if (WaitingForRevit && State == CdJobState.Running)
                    Complete(CdJobState.Failed, "Revit өөрчлөлт хүлээж авахгүй байна — зогслоо");
            }
        }

        /// <summary>НЭГ алхам (нэг TransactionGroup).  Хэзээ ч шидэхгүй.</summary>
        public void Step(long budgetMs)
        {
            if (IsFinished || State != CdJobState.Running) return;
            var sw = Stopwatch.StartNew();
            _inStep = true;
            WaitingForRevit = false;
            try
            {
                if (!DocAlive)
                {
                    Complete(CdJobState.Failed, "Файл хаагдсан тул дэлгээс үүсгэх зогслоо");
                    return;
                }
                if (_p == null)
                {
                    // Дараалалд хүлээх хооронд загвар өөрчлөгдсөн байж болно — нөөц, сонголт, төлөвлөгөөг дахин (≈ 0.5 с, загварт хүрэхгүй).
                    Status = "Өрөө, хананы мэдээллийг уншиж байна…";
                    _p = _prepare(_timings);
                    if (_p == null || _p.Coordinator == null)
                    {
                        Complete(CdJobState.Failed, "Өрөө/хана олдсонгүй (устгасан уу?) — дэлгээс үүсгэсэнгүй");
                        return;
                    }
                    if (!string.IsNullOrEmpty(_p.Error))
                    {
                        string why = _p.Error;
                        _p = null;
                        Complete(CdJobState.Failed, why);
                        return;
                    }
                    _result = _p.Coordinator.Begin(_p.Plan, _timings);
                    // W01: эхлэлийн мөр — оношилгоо ба live gate (ажил явж байх үед загвар өөрчлөх сценари үүгээр эхэлдэг).
                    WeLog.Info("job", "#" + Number + " эхэллээ: " + _p.Plan.Items.Count(i => i.Action == WeAction.Create || i.Action == WeAction.Update)
                                      + " дэлгээс үүсгэх/шинэчлэх, " + _p.Plan.Groups.Count + " бүлэг");
                    if (_p.Coordinator.Done) { Finish(); }
                    return;
                }
                if (_staleWhy != null && !_p.Coordinator.MidSheetGroup)
                {
                    // W01: сонгосон өрөө/хана/шал/тааз/link ажил явж байх үед өөрчлөгдсөн — хуучирсан геометрээр ҮРГЭЛЖЛҮҮЛЭХГҮЙ.  (Хуудасны
                    // бүлгийн дунд бол тэр хуудсыг эхлээд дуусгана — хуудасны алхам бодит харагдацаар ажилладаг, зохиомж алгасагдахгүй.)
                    Replan();
                    return;
                }
                RunOneStep();
                if (_p.Coordinator.Done) Finish();
            }
            catch (TxBusyException)
            {
                if (DocReadOnly())
                {
                    Complete(CdJobState.Failed, "Файл зөвхөн уншихаар нээгдсэн тул дэлгээс үүсгэх боломжгүй");
                }
                else
                {
                    WaitingForRevit = true;
                    Status = "Revit одоогоор өөрчлөлт хүлээж авахгүй байна (засварлах горим г.м.) — дуусмагц үргэлжилнэ";
                }
            }
            catch (Exception ex)
            {
                WeLog.Error("job", "Арын ажил", ex);
                // «Санал хүсэлт» (2026-10-16): алдааг санаж, хэрэглэгч товч дармагц үе шат + exception хавсаргагдана.
                Feedback.Core.FeedbackRecentErrors.Remember("MglWallElevations", "Ханын дэлгээс", "арын ажил, алхам " + _stepNo, ex);
                Complete(CdJobState.Failed, "Алдаа гарч зогслоо: " + ex.Message + "  — «Санал хүсэлт» товчоор програм хариуцагчид мэдэгдэнэ үү (алдааны мэдээлэл автоматаар хавсаргагдана).");
            }
            finally
            {
                ActiveMs += sw.ElapsedMilliseconds;
                _inStep = false;
                if (_pendingCancel) { _pendingCancel = false; Cancel(); }
                else if (_pendingPause) { _pendingPause = false; Pause(); }
            }
        }

        private void RunOneStep()
        {
            _stepNo++;
            var timer = Stopwatch.StartNew();
            try { RunOneStepCore(); }
            finally
            {
                long ms = timer.ElapsedMilliseconds;
                string label = (_p != null ? _p.Coordinator.LastStepLabel : null) ?? ("алхам " + _stepNo);
                if (_slow.Add(label, ms)) WeLog.Info("job", "#" + Number + " урт алхам " + ms + " мс — «" + label + "»");
            }
        }

        private void RunOneStepCore()
        {
            string baseName = TxPrefix + " #" + Number;
            using (var tg = new TransactionGroup(Doc, baseName + " · алхам " + _stepNo))
            {
                TransactionStatus started;
                try { started = tg.Start(); }
                catch (Exception ex) { throw new TxBusyException(ex.Message); }
                if (started != TransactionStatus.Started) throw new TxBusyException(started.ToString());
                _executing = true;
                try { _p.Coordinator.Step(); }
                finally { _executing = false; }
                string label = _p.Coordinator.LastStepLabel;
                if (!string.IsNullOrEmpty(label))
                {
                    try { tg.SetName(JobNames.Clip(baseName + " · " + label, 120)); } catch { }
                }
                if (tg.HasStarted() && !tg.HasEnded()) tg.Assimilate();
            }
            Status = _p.Coordinator.Status ?? Status;
        }

        private void Finish()
        {
            FoldEarlier();
            WeLog.Info("run", DocTitle + " · арын ажил #" + Number + " · " + WallElevationWorkflow.Summary(_result) + " · " + _timings
                              + (_replans > 0 ? " · дахин төлөвлөлт " + _replans : string.Empty));
            WeLog.Info("job", "#" + Number + " алхмууд: " + _slow);
            Complete(CdJobState.Done, null);
        }

        // ── W01: эх өгөгдөл өөрчлөгдвөл дахин төлөвлөх ────────────────────

        /// <summary>
        /// Сонгосон өрөө/хана/шал/тааз/link өөрчлөгдсөн — нөөц, сонголт, төлөвлөгөөг ДАХИН уншина (≈ 0.5 с, загварт хүрэхгүй), алхмын машин
        /// эхнээс: аль хэдийн үүссэн дэлгээс «өөрчлөлтгүй» (эсвэл эх нь өөрчлөгдсөн бол «шинэчлэгдэнэ», тэмдэглэгээ хүлээгдэж буй бол дахин
        /// тэмдэглэнэ) — давхардал үүсэхгүй.  Хэрэглэгч тэр өрөөг тасралтгүй засаж байвал түр зогсооно (Idling-ийг дэмий эргүүлэхгүй).
        /// </summary>
        private void Replan()
        {
            DateTime now = DateTime.Now;
            string why = _staleWhy;
            WeReplan.Prune(_replanTimes, now);
            if (WeReplan.ShouldPause(_replanTimes, now))
            {
                _replanTimes.Clear();   // «Үргэлжлүүлэх» → НЭГ удаа дахин төлөвлөнө (шууд дахин зогсохгүй)
                State = CdJobState.Paused;
                Status = "Түр зогсоосон — сонгосон өрөөнд засвар үргэлжилж байна";
                Notice = "Сонгосон өрөө/ханыг тасралтгүй засаж байгаа тул (сүүлд: «" + why + "») дэлгээс үүсгэхийг түр зогсоолоо.  Засварлаж дуусаад "
                         + "«Үргэлжлүүлэх» дарвал шинэчилсэн геометрээр нэг удаа дахин төлөвлөж үргэлжилнэ; «Цуцлах» — энд зогсоно (хийгдсэн нь хадгалагдана).";
                WeLog.Info("job", "#" + Number + " олон дахин төлөвлөлт — түр зогсоов (" + why + ")");
                return;
            }
            _replanTimes.Add(now);
            Status = "«" + why + "» — дахин уншиж төлөвлөж байна…";
            var sw = Stopwatch.StartNew();
            Prepared fresh = _prepare(_timings);
            _replans++;
            _staleWhy = null;
            if (fresh == null || fresh.Coordinator == null)
            {
                Complete(CdJobState.Failed, "«" + why + "»-ийн дараа сонгосон өрөө/хана олдсонгүй (устгасан уу?) — өмнө хийгдсэн дэлгээс, хуудас хадгалагдсан");
                return;
            }
            if (!string.IsNullOrEmpty(fresh.Error))
            {
                Complete(CdJobState.Failed, fresh.Error);
                return;
            }
            if (_result != null) _segments.Add(_result);
            _p = fresh;
            _result = _p.Coordinator.Begin(_p.Plan, _timings);
            _result.Notes.Add("Ажил явж байх үед «" + why + "» тул шинэчилсэн геометрээр дахин төлөвлөв" + (_replans > 1 ? " (" + _replans + "-р удаа)" : string.Empty)
                              + " — өмнө хийгдсэн дэлгээс давхардаагүй, эх нь өөрчлөгдсөн нь шинэчлэгдэнэ.");
            Notice = "«" + why + "» — шинэчилсэн геометрээр дахин төлөвлөлөө; давхардалгүй үргэлжилж байна.";
            WeLog.Info("job", "#" + Number + " дахин төлөвлөв (" + why + ") " + sw.ElapsedMilliseconds + " мс");
            if (_p.Coordinator.Done) Finish();
        }

        /// <summary>Энэ өөрчлөлт ажлын эх элементийг хөндсөн бол <see cref="_staleWhy"/>.  DocumentChanged-аас (уншина, бичихгүй).</summary>
        private void WatchSources(DocumentChangedEventArgs e)
        {
            if (IsFinished || _p == null || _p.Watch == null || _p.Watch.IsEmpty) return;
            string why;
            try
            {
                List<long> modified = e.GetModifiedElementIds().Select(id => id.Value).ToList();
                List<long> deleted = e.GetDeletedElementIds().Select(id => id.Value).ToList();
                why = _p.Watch.Why(modified, deleted, AddedModelElements(e.GetAddedElementIds()));
            }
            catch (Exception ex)
            {
                WeLog.Error("job", "эх өгөгдлийн өөрчлөлт шалгах", ex);
                why = "загвар өөрчлөгдсөн (шалгаж чадсангүй)";
            }
            if (why == null) return;
            if (_staleWhy == null) WeLog.Info("job", "#" + Number + " эх өгөгдөл өөрчлөгдсөн: " + why + " — дараагийн алхмын өмнө дахин төлөвлөнө");
            _staleWhy = why;
            Notice = "«" + why + "» — дараагийн алхмын өмнө шинэчилсэн геометрээр дахин төлөвлөнө (хийгдсэн дэлгээс давхардахгүй).";
        }

        /// <summary>Нэмэгдсэн ЗАГВАРЫН элемент (харагдацын тэмдэглэл, төрөл биш) — ангилал, хайрцаг.  <see cref="WeSourceWatch.MaxAddedChecked"/>-аас олон бол таслана.</summary>
        private List<WeAddedElement> AddedModelElements(ICollection<ElementId> ids)
        {
            var list = new List<WeAddedElement>();
            if (ids == null || ids.Count == 0 || _p.Watch.Boxes.Count == 0) return list;
            foreach (ElementId id in ids)
            {
                if (list.Count > WeSourceWatch.MaxAddedChecked) break;
                Element el = Doc.GetElement(id);
                if (el == null || el is ElementType || el.ViewSpecific || el.Category == null || el.Category.CategoryType != CategoryType.Model) continue;
                BoundingBoxXYZ bb = el.get_BoundingBox(null);
                list.Add(new WeAddedElement
                {
                    Id = id.Value,
                    Category = el.Category.Name,
                    HasBox = bb != null,
                    Min = bb != null ? bb.Min.ToWe() : WeV3.Zero,
                    Max = bb != null ? bb.Max.ToWe() : WeV3.Zero,
                });
            }
            return list;
        }

        /// <summary>Дахин төлөвлөхөөс өмнөх хэсгүүдийн үр дүнг сүүлийнх рүү нэгтгэнэ (тайлан, тоолуур) — нэг удаа.</summary>
        private void FoldEarlier()
        {
            if (_folded || _segments.Count == 0 || _result == null) return;
            _folded = true;
            WeRunResult acc = _segments[0];
            for (int k = 1; k < _segments.Count; k++)
            {
                MergeInto(_segments[k], acc);
                acc = _segments[k];
            }
            MergeInto(_result, acc);
        }

        private static void MergeInto(WeRunResult later, WeRunResult earlier)
        {
            var byKey = new Dictionary<string, WeRunItem>(StringComparer.Ordinal);
            foreach (WeRunItem e in earlier.Items)
                if (e.Plan != null && !string.IsNullOrEmpty(e.Plan.Key) && !byKey.ContainsKey(e.Plan.Key)) byKey[e.Plan.Key] = e;
            var laterKeys = new HashSet<string>(StringComparer.Ordinal);
            foreach (WeRunItem i in later.Items)
            {
                if (i.Plan == null || string.IsNullOrEmpty(i.Plan.Key)) continue;
                laterKeys.Add(i.Plan.Key);
                WeRunItem e;
                if (!byKey.TryGetValue(i.Plan.Key, out e)) continue;
                i.Outcome = WeReplan.MergeOutcome(e.Outcome, i.Outcome);
                i.Created |= e.Created;
                if (!i.Annotated && e.Annotated)
                {
                    i.Annotated = true;
                    i.Dims = e.Dims; i.Spots = e.Spots; i.Tags = e.Tags; i.Keynotes = e.Keynotes;
                }
            }
            // Тэмдэглэгээний нийт = дэлгээс бүрийн СҮҮЛИЙН тэмдэглэгээ (дахин тэмдэглэсэн дэлгээсийг давхар тоолохгүй) + шинэ төлөвлөгөөнд
            // ороогүй (эх нь устсан) өмнөх дэлгээсийнх.
            List<WeRunItem> all = later.Items.Where(i => i.Annotated)
                .Concat(earlier.Items.Where(e => e.Annotated && e.Plan != null && !laterKeys.Contains(e.Plan.Key ?? string.Empty)))
                .ToList();
            later.AnnoDims = all.Sum(i => i.Dims);
            later.AnnoSpots = all.Sum(i => i.Spots);
            later.AnnoTags = all.Sum(i => i.Tags);
            later.AnnoKeynotes = all.Sum(i => i.Keynotes);
            later.AnnoFailed += earlier.AnnoFailed;
            later.AnnoRemoved += earlier.AnnoRemoved;
            later.KeyPlansUpdated = WeReplan.MergeUpdated(earlier.KeyPlansCreated, earlier.KeyPlansUpdated, later.KeyPlansUpdated);
            later.KeyPlansCreated += earlier.KeyPlansCreated;
            later.AxonsUpdated = WeReplan.MergeUpdated(earlier.AxonsCreated, earlier.AxonsUpdated, later.AxonsUpdated);
            later.AxonsCreated += earlier.AxonsCreated;
            later.SheetsCreated += earlier.SheetsCreated;
            later.ViewportsPlaced += earlier.ViewportsPlaced;
            later.ExtrasPlaced += earlier.ExtrasPlaced;
            later.WarningsHidden += earlier.WarningsHidden;
            later.MarkersHidden = Math.Max(later.MarkersHidden, earlier.MarkersHidden);   // дахин нуух үе шат ижил тэмдгийг тоолно
            later.Committed |= earlier.Committed;
            for (int k = earlier.Sheets.Count - 1; k >= 0; k--)
                if (!later.Sheets.Contains(earlier.Sheets[k])) later.Sheets.Insert(0, earlier.Sheets[k]);
            later.Notes.InsertRange(0, earlier.Notes.Where(n => !later.Notes.Contains(n)).ToList());
        }

        private void Complete(CdJobState state, string status)
        {
            FoldEarlier();
            State = state;
            FinishedAt = DateTime.Now;
            if (_result != null && _p != null)
            {
                _report = WallElevationWorkflow.BuildReport(_result, _p.Plan, _p.ViewTypeName, true);
                if (state == CdJobState.Cancelled) _report.Instruction = "Цуцалсан — " + _report.Instruction;
            }
            Status = status ?? (_report != null ? _report.Instruction : "Дууссан");
        }

        private bool DocReadOnly()
        {
            try { return Doc.IsReadOnly; }
            catch { return false; }
        }

        /// <summary>
        /// Дууссаны дараа (Idling): хэрэглэгч эхэлсэн харагдацаасаа шилжээгүй бол эхний хуудсыг (хуудасгүй бол эхний дэлгээсийг) нээнэ —
        /// эзний гомдол «үүсгэсэн дэлгээсийг олоход хэцүү».  Хэрэглэгч өөр зураг дээр ажиллаж байвал ХӨНДӨХГҮЙ — самбарт «Хуудас нээх».
        /// </summary>
        public void Finished(UIApplication app)
        {
            if (State != CdJobState.Done || _result == null) return;
            try
            {
                UIDocument uidoc = app?.ActiveUIDocument;
                if (uidoc?.Document == null || !uidoc.Document.Equals(Doc)) return;
                bool onStart = _startView != ElementId.InvalidElementId && uidoc.ActiveView != null && uidoc.ActiveView.Id == _startView;
                // W06 (2026-10-16): хэрэглэгч ӨӨР зураг дээр ажиллаж байвал ямар ч цонх нээхгүй, харагдац солихгүй (фокус булаахгүй) — самбарын
                // «Үр дүн» товч.  Эхэлсэн зураг дээрээ хүлээж байвал үр дүнгийн хөтөч (өрөө → дэлгээс → хуудас) + эхний хуудас.
                if (!onStart)
                {
                    _openMessage = "Дууссан — «Үр дүн» товчоор өрөө → дэлгээс → хуудсыг харна (таны одоо ажиллаж буй зургийг хөндсөнгүй).";
                    WeLog.Info("job", "#" + Number + " дууссан — хэрэглэгч өөр зураг дээр тул үр дүнгийн самбарыг нээсэнгүй (фокус булаахгүй)");
                    return;
                }
                if (_p?.Settings == null || _p.Settings.ReviewPanel)
                {
                    WeResultBrowser.Open(app, Doc, JobRooms(), WeResultReader.RunInfo(_result), _startView, true, true);
                    _openMessage = "Үр дүнгийн самбар нээгдлээ — өрөө бүрийн хуудсыг «Шалгасан · Дараах»-аар шалгана.";
                    return;
                }
                View v = FirstSheet() ?? FirstView();
                if (v == null) return;
                uidoc.RequestViewChange(v);
                var sh = v as ViewSheet;
                _openMessage = sh != null ? "Хуудас «" + sh.SheetNumber + " — " + sh.Name + "» нээгдлээ." : "«" + v.Name + "» нээгдлээ.";
            }
            catch (Exception ex) { WeLog.Error("job", "хуудас нээх", ex); }
        }

        private View FirstSheet()
        {
            if (_result == null) return null;
            foreach (ElementId id in _result.Sheets)
            {
                var v = Doc.GetElement(id) as ViewSheet;
                if (v != null) return v;
            }
            return null;
        }

        private View FirstView()
        {
            if (_result == null) return null;
            foreach (WeRunItem i in _result.Items)
            {
                if (i.Outcome != "Үүсгэв" && i.Outcome != "Шинэчлэв") continue;
                var v = Doc.GetElement(i.ViewId) as View;
                if (v != null) return v;
            }
            return null;
        }

        /// <summary>Энэ ажлын өрөөнүүд (UniqueId; хана горимын дэлгээс — хоосон мөр) — үр дүнгийн хөтчийн шүүлтүүр.</summary>
        private ICollection<string> JobRooms()
        {
            var rooms = new HashSet<string>(StringComparer.Ordinal);
            if (_result != null)
                foreach (WeRunItem i in _result.Items) if (i.Plan != null) rooms.Add(i.Plan.RoomUid ?? string.Empty);
            return rooms;
        }

        public string Open(UIApplication app, bool sheet)
        {
            if (!DocAlive) return "Файл хаагдсан.";
            if (sheet)
            {
                // W06: «Үр дүн» — өрөө → дэлгээс → одоогийн хуудас (баримтаас дахин уншина: зөөсөн, нэрийг сольсон, устгасан ч зөв).
                WeResultBrowser.Open(app, Doc, JobRooms(), WeResultReader.RunInfo(_result), _startView, true, false);
                return null;
            }
            View v = sheet ? FirstSheet() : FirstView();
            if (v == null) return "Тэр " + (sheet ? "хуудас" : "харагдац") + " одоо байхгүй (буцаасан эсвэл устгасан).";
            UIDocument uidoc = app?.ActiveUIDocument;
            if (uidoc?.Document == null || !uidoc.Document.Equals(Doc))
                return "«" + DocTitle + "» файлыг идэвхтэй болгоод дахин дарна уу.";
            uidoc.RequestViewChange(v);
            return null;
        }

        // ── Revit-ийн өөрчлөлт (хостоос) ──────────────────────────────────

        private bool IsOurs(string name)
        {
            string p = TxPrefix + " #" + Number;
            return name != null && (name == p || name.StartsWith(p + " ", StringComparison.Ordinal));
        }

        public void OnDocumentChanged(DocumentChangedEventArgs e)
        {
            if (Undone) return;
            ICollection<string> names;
            try { names = e.GetTransactionNames(); }
            catch { names = new List<string>(); }
            UndoOperation op = e.Operation;
            try
            {
                if (_executing && op == UndoOperation.TransactionCommitted)
                {
                    // Манай алхмын дотоод transaction — нэмэгдсэн элемент («Бүгдийг буцаах»).
                    foreach (ElementId id in e.GetAddedElementIds()) Created.Add(id.Value);
                    return;
                }
                bool ours = names.Any(IsOurs);
                if (!ours)
                {
                    // Хэрэглэгчийн (эсвэл бусдын) загварчлал — ажлын эх элементийг хөндсөн бол дараагийн алхмын өмнө дахин төлөвлөнө.
                    // ⚠️ Created-д ХЭЗЭЭ Ч нэмэхгүй (хэрэглэгчийн элементийг «Бүгдийг буцаах» устгах ёсгүй).
                    WatchSources(e);
                    return;
                }
                if (op == UndoOperation.TransactionUndone)
                {
                    // Ctrl+Z манай алхмыг буцаасан: устсан id-г хасна (Revit тэр ID-г хэрэглэгчийн ШИНЭ элементэд дахин олгож болно).
                    foreach (ElementId id in e.GetDeletedElementIds()) Created.Remove(id.Value);
                    if (State == CdJobState.Running)
                    {
                        State = CdJobState.Paused;
                        Status = "Түр зогсоосон";
                        Notice = "Ctrl+Z дэлгээсийн алхмыг буцаасан тул түр зогсоолоо.  «Үргэлжлүүлэх» дарвал дараагийн алхмаас үргэлжилнэ "
                                 + "(буцсан дэлгээсийг дахин хийхгүй — дараа нь хэрэгслийг дахин ажиллуулбал нөхнө); «Цуцлах» дарвал энд зогсоно.";
                    }
                }
                else if (op == UndoOperation.TransactionRedone)
                {
                    foreach (ElementId id in e.GetAddedElementIds()) Created.Add(id.Value);
                }
            }
            catch { }
        }

        // ── Бүгдийг буцаах ─────────────────────────────────────────────────

        /// <summary>
        /// Энэ ажлын ҮҮСГЭСЭН харагдац (дэлгээс, түлхүүр план, 3D), хуудас, хоосорсон Elevation маркерыг устгана (тэдгээрийн тэмдэглэгээ,
        /// viewport хамт устна).  ӨМНӨ байсан, энэ ажлаар шинэчлэгдсэн харагдацыг хөндөхгүй (тэдний шинэ тэмдэглэгээ үлдэнэ).
        /// </summary>
        public string UndoAll()
        {
            if (!IsFinished) return "Ажил явагдаж байна — эхлээд цуцлана уу.";
            if (Undone) return UndoResult;
            if (!DocAlive) return UndoResult = "Файл хаагдсан тул буцаах боломжгүй.";
            var views = new List<ElementId>();
            var markers = new List<ElementId>();
            foreach (long v in Created)
            {
                Element e = Doc.GetElement(new ElementId(v));
                if (e is View vw && !vw.IsTemplate) views.Add(e.Id);
                else if (e is ElevationMarker) markers.Add(e.Id);
            }
            if (views.Count == 0 && markers.Count == 0)
            {
                Undone = true;
                return UndoResult = "Устгах зүйл алга — аль хэдийн буцаасан эсвэл гараар устгасан байна.";
            }
            int sheets = views.Count(id => Doc.GetElement(id) is ViewSheet);
            int deleted = 0;
            var handler = new WeFailureSwallower();
            using (var t = new Transaction(Doc, TxPrefix + " #" + Number + " · бүгдийг буцаах"))
            {
                try
                {
                    t.Start();
                    FailureHandlingOptions fho = t.GetFailureHandlingOptions();
                    fho.SetFailuresPreprocessor(handler);
                    fho.SetClearAfterRollback(true);
                    t.SetFailureHandlingOptions(fho);
                    // Хуудас эхэлж (viewport-ууд), дараа нь харагдац, эцэст нь хоосорсон маркер.
                    foreach (ElementId id in views.OrderBy(id => Doc.GetElement(id) is ViewSheet ? 0 : 1))
                        deleted += DeleteOne(id);
                    foreach (ElementId id in markers)
                    {
                        var mk = Doc.GetElement(id) as ElevationMarker;
                        if (mk != null && mk.IsValidObject && !mk.HasElevations()) DeleteOne(id);
                    }
                    if (t.Commit() != TransactionStatus.Committed)
                        return UndoResult = "Revit буцаалтыг хүлээж авсангүй: " + (handler.LastError ?? "?");
                }
                catch (Exception ex)
                {
                    try { if (t.HasStarted() && !t.HasEnded()) t.RollBack(); } catch { }
                    return UndoResult = "Буцааж чадсангүй: " + ex.Message;
                }
            }
            int left = views.Count(id => Doc.GetElement(id) != null);
            string res = "Буцаалаа: " + Math.Max(0, deleted - sheets) + " харагдац, " + Math.Min(sheets, deleted) + " хуудас устгав.";
            if (left > 0)
                return UndoResult = res + "  " + left + " харагдацыг Revit устгахыг зөвшөөрсөнгүй (өөр хүн эзэмшиж эсвэл түгжигдсэн байж болно) — дахин дарж болно.";
            Undone = true;
            return UndoResult = res;
        }

        private int DeleteOne(ElementId id)
        {
            if (Doc.GetElement(id) == null) return 0;
            using (var st = new SubTransaction(Doc))
            {
                try
                {
                    st.Start();
                    Doc.Delete(id);
                    st.Commit();
                    return 1;
                }
                catch
                {
                    if (st.HasStarted() && !st.HasEnded()) st.RollBack();
                    return 0;
                }
            }
        }

        // ── Самбарын карт ──────────────────────────────────────────────────

        public CdJobCard Card()
        {
            double f = Fraction;
            var card = new CdJobCard
            {
                Number = Number,
                State = ToCardState(State),
                Title = Title,
                DocTitle = DocTitle,
                Status = Status,
                Notice = Notice,
                Fraction = f,
                Percent = JobProgress.Percent(f),
                Counters = Counters(),
                Message = UndoResult ?? _openMessage,
                // W06: эхний товч = үр дүнгийн хөтөч (хуудасгүй ажилд ч — харагдац хуудсанд байршаагүй гэдгийг тэнд харна).
                CanOpenSheet = IsFinished && !Undone && _result != null && _result.Items.Count > 0,
                CanOpenView = IsFinished && !Undone && FirstViewSafe(),
                OpenSheetText = "Үр дүн: өрөө → дэлгээс → хуудас",
                OpenSheetTip = "Өрөө бүрийн дэлгээс, тэдгээрийн ОДООГИЙН хуудас (гараар зөөсөн ч), шинэ / шинэчилсэн / цэгцлэх / хуудасгүй / алдаа;\n"
                               + "хуудас, харагдац нээх, viewport сонгох, Project Browser-т олох.",
                CanUndo = Background && IsFinished && !Undone && Created.Count > 0,
                ToolTitle = WallElevationWorkflow.Title,
                CancelQuestion = "Дэлгээс үүсгэхийг зогсоох уу?\n\nОдоог хүртэл үүссэн дэлгээс, хуудас хадгалагдана.  Дахин ажиллуулахад давхардуулахгүйгээр дутууг нь нэмнэ.",
                UndoQuestion = "Энэ ажлаар ҮҮССЭН бүх дэлгээс, түлхүүр план, 3D, хуудсыг (тэдгээрийн хэмжээс, тэмдэглэгээтэй хамт) устгах уу?\n\n"
                               + "Өмнө байсан харагдац, өрөө, хана хөндөгдөхгүй.  Энэ устгалыг өөрийг нь Ctrl+Z-ээр буцааж болно.",
                UndoWarning = UpdatedCount() > 0
                    ? "⚠ Энэ ажил өмнө үүссэн " + UpdatedCount() + " харагдацыг ШИНЭЧИЛСЭН — «Бүгдийг буцаах» тэдгээрийг хуучин байдалд нь оруулахгүй "
                      + "(зөвхөн ШИНЭ харагдац, хуудсыг устгана)."
                    : null,
            };
            if (IsFinished)
            {
                card.Report = _report == null ? null : _report.Content + (string.IsNullOrEmpty(_report.Details) ? "" : "\n\n" + _report.Details);
                card.TimeLine = (FinishedAt.HasValue ? FinishedAt.Value.ToString("HH:mm") + " · " : "") + JobProgress.Duration(TimeSpan.FromMilliseconds(ActiveMs)) + " зарцуулсан";
            }
            else if (State == CdJobState.Queued)
            {
                card.TimeLine = "Өмнөх ажил дуусахыг хүлээж байна";
            }
            else
            {
                TimeSpan? left = JobProgress.Remaining(ActiveMs, f);
                card.TimeLine = JobProgress.Duration(TimeSpan.FromMilliseconds(ActiveMs)) + " ажилласан" + (left.HasValue ? " · ≈" + JobProgress.Duration(left.Value) + " үлдсэн" : "");
            }
            return card;
        }

        private bool FirstViewSafe()
        {
            try { return FirstView() != null; } catch { return false; }
        }

        private int UpdatedCount()
        {
            if (_result == null) return 0;
            return _result.Count(i => i.Outcome == "Шинэчлэв") + _result.KeyPlansUpdated + _result.AxonsUpdated;
        }

        private string Counters()
        {
            if (_result == null) return null;
            var parts = new List<string>();
            int made = _result.Count(i => i.Outcome == "Үүсгэв" || i.Outcome == "Шинэчлэв");
            int todo = _result.Count(i => i.Plan.Action == WeAction.Create || i.Plan.Action == WeAction.Update);
            if (todo > 0) parts.Add("дэлгээс " + made + "/" + todo);
            if (_result.SheetsCreated > 0) parts.Add("хуудас " + _result.SheetsCreated);
            if (_result.AnnoDims > 0) parts.Add("хэмжээс " + _result.AnnoDims);
            int failed = _result.Count(i => i.Status == WeStatus.Failed);
            if (failed > 0) parts.Add("алдаа " + failed);
            if (_replans > 0) parts.Add("дахин төлөвлөсөн " + _replans);
            return parts.Count == 0 ? null : string.Join(" · ", parts);
        }

        private static CdCardState ToCardState(CdJobState s)
        {
            switch (s)
            {
                case CdJobState.Running: return CdCardState.Running;
                case CdJobState.Paused: return CdCardState.Paused;
                case CdJobState.Queued: return CdCardState.Queued;
                case CdJobState.Done: return CdCardState.Done;
                case CdJobState.Cancelled: return CdCardState.Cancelled;
                default: return CdCardState.Failed;
            }
        }
    }
}
