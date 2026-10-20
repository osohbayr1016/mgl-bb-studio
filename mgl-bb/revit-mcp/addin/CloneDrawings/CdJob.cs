using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Events;
using RevitMcpAddin.CloneDrawings.Core;

namespace RevitMcpAddin.CloneDrawings
{
    /// <summary>
    /// Нэг хувилалт (загвар → N зорилт) — АЛХАМ АЛХМААР (2026-10-01).
    ///
    /// Эзний хүсэлт: «хувилах дарсны дараа бүх зүйл гацаад өөр товч дарж болохгүй — баруун талд явц хэдэн хувьтай
    /// харагдаад би Revit дотроо өөр ажлаа хийдэг байх».  Revit-ийн API зөвхөн үндсэн thread дээр ажилладаг тул
    /// «арын thread» гэж байхгүй — оронд нь ажлыг ЖИЖИГ алхам болгож Revit сул зогсох (Idling) бүрд хэдийг нь
    /// хийнэ (<see cref="CdJobHost"/>).  Алхмын хооронд хэрэглэгч Revit-д чөлөөтэй ажиллана.
    ///
    /// ГЭРЭЭ:
    ///   • НЭГ АЛХАМ = НЭГ Transaction («MGL клон 3/8 · B4 · харагдац «Зүсэлт 1-1»»).  Алхмын ГАДУУР нээлттэй
    ///     transaction хэзээ ч үлдэхгүй (Revit-ийн дүрэм) — тиймээс «нэг Ctrl+Z» биш; оронд нь
    ///     <see cref="UndoAll"/> энэ хувилалтоор НЭМЭГДСЭН бүхнийг (DocumentChanged-аар тоолсон) нэг дор устгана.
    ///   • Алхам Revit-д буцаагдвал (commit амжилтгүй / алдаа) тэр алхмын тоолуурыг буцааж, кэшийг файлаас дахин
    ///     уншина (<see cref="CdPlan.Resync"/>) — бусад алхам хадгалагдсан хэвээр.
    ///   • Алхмын хооронд хэрэглэгчийн өөрчлөлт (DocumentChanged) → дараагийн алхмаас өмнө Resync.  Хэрэглэгч Ctrl+Z
    ///     дарж манай алхмыг буцаавал → түр зогсоож, тэр зорилтыг дахин хийнэ (давхардал шалгалттай тул дутууг л нэмнэ).
    ///   • Revit-ийн объект (Element, View) алхмын хооронд ХАДГАЛАГДАНА, гэхдээ Resync бүрд id-аар дахин олдоно.
    /// </summary>
    public sealed class CdJob : IMglJob
    {
        /// <summary>Тэмдэглэгээний алхамд өгөх хамгийн бага хугацаа (мс) — нэг transaction-д 1-2 tag л хийхгүйн тулд.</summary>
        private const long MinAnnotateMs = 60;
        /// <summary>Хөнгөн шинэчлэлтэд хуримтлуулах элементийн дээд тоо — үүнээс олон бол бүрэн Resync хямд.</summary>
        private const int LightSyncMaxIds = 2000;
        /// <summary>
        /// Аюулгүй горимд НЭГ Ч алхам амжилтгүйгээр ийм олон элемент буцаж, харагдацыг өөр хүн эзэмшиж (worksharing)
        /// байвал харагдацын үлдсэнийг алгасна — элемент бүрд буцаалт, тайланд мөр бүр хэрэггүй.  Эзэмшилгүй харагдацад
        /// хэзээ ч бөөнөөр алгасахгүй (алдаатай элемент дараалан байж болно — тус бүрийг нь шалгана).
        /// </summary>
        private const int AbandonAfterSkips = 2;

        /// <summary>Revit transaction нээхийг зөвшөөрөөгүй (засварлах горим, түр зуурын төлөв) — алхам юу ч өөрчлөөгүй.</summary>
        private sealed class TxBusyException : Exception
        {
            public TxBusyException(string message) : base(message) { }
        }

        public readonly int Number;
        public readonly Document Doc;
        public readonly ElementId TemplateId;
        public readonly CdTemplateInfo Info;
        public readonly List<CdLinkedView> Views;
        public readonly CdOptions Options;
        public readonly List<string> ManualViewUids;
        public readonly CdReport Report = new CdReport();
        public readonly string Title;
        public readonly string DocTitle;
        public readonly int TargetCount;
        public readonly DateTime QueuedAt = DateTime.Now;

        public CdJobState State { get; private set; } = CdJobState.Queued;
        /// <summary>Одоо юу хийж байна — «B4 (4/8) · харагдац үүсгэж байна: «Зүсэлт 1-1»».</summary>
        public string Status { get; private set; } = "Дараалалд хүлээж байна";
        /// <summary>Анхааруулга (шар) — Ctrl+Z, файл хаагдсан г.м.</summary>
        public string Notice { get; private set; }
        public DateTime? StartedAt { get; private set; }
        public DateTime? FinishedAt { get; private set; }
        /// <summary>Зөвхөн алхам хийсэн хугацаа (түр зогссон, Revit завгүй байсан хугацаа ороогүй) — үлдсэн хугацааны тооцоонд.</summary>
        public long ActiveMs { get; private set; }
        /// <summary>Арын горим (CdJobHost) — тайлангийн «буцаах» тайлбар өөр.</summary>
        public bool Background { get; internal set; }
        public bool LinksSaved { get; private set; }
        /// <summary>«Бүгдийг буцаах» хийгдсэн бол үр дүн.</summary>
        public string UndoResult { get; private set; }
        public bool Undone { get; private set; }
        /// <summary>
        /// Сүүлийн алхам Revit transaction нээж чадсангүй (засварлах горим г.м.) — хост дараагийн хэрэглэгчийн үйлдлийг хүлээнэ
        /// (Idling-ийг шууд дахин дуудуулахгүй, CPU ачаалахгүй).
        /// </summary>
        public bool WaitingForRevit { get; private set; }

        /// <summary>Энэ хувилалтын transaction-уудаар НЭМЭГДСЭН элементүүд (<see cref="UndoAll"/>).</summary>
        internal readonly HashSet<long> Created = new HashSet<long>();

        private sealed class TargetSlot
        {
            public ElementId Id;
            public int Position;
            public bool Rerun;
        }

        private enum Phase { Links, Prepare, Begin, Views, Annotate, Sheets, Finish }

        private readonly Queue<TargetSlot> _targets = new Queue<TargetSlot>();
        private readonly Dictionary<int, ElementId> _targetByPosition = new Dictionary<int, ElementId>();
        private readonly Dictionary<string, int> _txTarget = new Dictionary<string, int>(StringComparer.Ordinal);
        private Phase _phase = Phase.Links;
        private CdHostIndex _hosts;
        private CdPlan _plan;
        private CdContext _ctx;
        private TargetSlot _cur;
        private string _curLabel;
        private List<CdLinkedView> _toCreate;
        private int _viewIdx, _annIdx, _sheetIdx;
        private CdAnnotateWork _work;
        private List<ElementId> _sheets;
        private readonly int _sheetSlots;
        private readonly int _perTarget;
        private int _unitsTotal;
        private int _unitsDone, _targetUnitsStart;
        private double _partial;
        private bool _needResync, _restartCurrent, _executing;
        /// <summary>
        /// Алхмын хооронд хэрэглэгчийн transaction-ууд НЭМСЭН/ӨӨРЧИЛСӨН (устгаагүй) элементүүд — дараагийн алхмаас өмнө
        /// бүрэн Resync-ийн оронд зөвхөн хөндөгдсөн кэшийг хаяна (<see cref="LightSync"/>).
        /// </summary>
        private readonly HashSet<long> _touched = new HashSet<long>();
        /// <summary>Гарын холбоосын transaction-ы нэр (Ctrl+Z-ээр буцаагдсаныг танина) ба түүнийг дахин бичих хүлээлт.</summary>
        private string _linksTx;
        private bool _relink;
        /// <summary>«Өмнөх клоныг устгах» алхам → устгасан тоо (Ctrl+Z/Y-ээр тайлангийн тоо, анхааруулгыг засна).</summary>
        private readonly Dictionary<string, int> _deletedByTx = new Dictionary<string, int>(StringComparer.Ordinal);
        /// <summary>
        /// Алхам явагдаж байна.  Revit урт регенерацийн үед мессеж боловсруулж самбарын товч АЛХМЫН ДУНД ажиллаж
        /// болзошгүй — тэр үед түр зогсоох/цуцлахыг алхам дуусахад хийнэ (<see cref="_pendingPause"/>, <see cref="_pendingCancel"/>).
        /// </summary>
        private bool _inStep, _pendingPause, _pendingCancel;
        private int _targetsFinished;
        private readonly HashSet<int> _finishedPositions = new HashSet<int>();

        public CdJob(Document doc, Element template, CdTemplateInfo info, CdHostIndex hosts, IEnumerable<CdLinkedView> views,
            IEnumerable<ElementId> targetIds, CdOptions options, List<string> manualViewUids)
        {
            Number = MglJobSeq.Next();
            Doc = doc;
            TemplateId = template.Id;
            Info = info;
            _hosts = hosts;
            Views = views.Where(v => v.Mode != CdViewMode.Skip).ToList();
            Options = options ?? new CdOptions();
            ManualViewUids = manualViewUids;
            int pos = 0;
            foreach (ElementId id in targetIds)
            {
                pos++;
                _targets.Enqueue(new TargetSlot { Id = id, Position = pos });
                _targetByPosition[pos] = id;
            }
            TargetCount = pos;
            Title = info.Kind + " «" + info.Label + "» → " + TargetCount + " элемент";
            try { DocTitle = doc.Title; } catch { DocTitle = ""; }

            int newViews = Views.Count(v => v.Mode == CdViewMode.NewView && v.CanClone);
            _sheetSlots = Options.Sheets
                ? Views.Where(v => v.Mode == CdViewMode.NewView && v.CanClone && v.SheetId != null && v.SheetId != ElementId.InvalidElementId)
                    .Select(v => v.SheetId.Value).Distinct().Count()
                : 0;
            _perTarget = JobProgress.UnitsPerTarget(newViews, Views.Count, _sheetSlots);
            _unitsTotal = 2 + TargetCount * _perTarget;
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

        public double Fraction => State == CdJobState.Done ? 1 : JobProgress.Fraction(_unitsDone + _partial, _unitsTotal);

        public int TargetsFinished => _targetsFinished;

        public TimeSpan? Remaining => IsFinished ? (TimeSpan?)null : JobProgress.Remaining(ActiveMs, Fraction);

        internal bool SameDoc(Document d)
        {
            try { return d != null && DocAlive && d.IsValidObject && Doc.Equals(d); }
            catch { return false; }
        }

        // ── Удирдлага (самбарын товч — Revit API дуудахгүй) ─────────────────

        internal void Start()
        {
            if (State != CdJobState.Queued)
                return;
            State = CdJobState.Running;
            StartedAt = DateTime.Now;
            Status = "Бэлтгэж байна…";
        }

        public void Pause()
        {
            if (_inStep)
            {
                _pendingPause = true;
                return;
            }
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

        /// <summary>
        /// Цуцлах — алхмын ХООРОНД (самбарын товч хэзээ ч алхмын дундуур ажиллахгүй) тул шууд.  Хийгдсэн алхмууд
        /// хадгалагдана; дутуу зорилтыг тайланд тоолно (дахин ажиллуулахад дутууг нь нэмнэ).
        /// </summary>
        public void Cancel(string why = null)
        {
            if (IsFinished)
                return;
            if (_inStep)
            {
                _pendingCancel = true;
                return;
            }
            int unfinished = _targets.Count;
            Report.TargetsUnfinished = unfinished;
            End(CdJobState.Cancelled, why ?? (unfinished > 0 ? "Цуцалсан — " + unfinished + " элемент дутуу үлдсэн" : "Цуцалсан"));
        }

        private void End(CdJobState state, string status)
        {
            State = state;
            Status = status;
            FinishedAt = DateTime.Now;
            _partial = 0;
            if (state == CdJobState.Done)
                _unitsDone = _unitsTotal;
            // Revit-ийн объектын кэшийг суллана — тайлан, Created үлдэнэ.
            _ctx = null;
            _plan = null;
            _work = null;
            _hosts = null;
        }

        // ── Гүйцэтгэл ──────────────────────────────────────────────────────

        /// <summary>Синхрон (тест харness, хуучин зан төлөв): бүгдийг дараалан — дуудагч TransactionGroup эзэмшинэ.</summary>
        internal void RunToEnd()
        {
            Start();
            while (State == CdJobState.Running)
            {
                Step(long.MaxValue);
                if (WaitingForRevit && State == CdJobState.Running)
                    End(CdJobState.Failed, "Revit өөрчлөлт хүлээж авахгүй байна — хувилалт зогслоо");
            }
        }

        /// <summary>
        /// Нэг алхам.  <paramref name="budgetMs"/> — Idling-ийн энэ удаагийн үлдсэн хугацаа (тэмдэглэгээний алхам
        /// түүнийг хүндэтгэж хуваагдана).  Хэзээ ч шидэхгүй.
        /// </summary>
        internal void Step(long budgetMs)
        {
            if (IsFinished || State != CdJobState.Running)
                return;
            var sw = Stopwatch.StartNew();
            _inStep = true;
            WaitingForRevit = false;
            try
            {
                StepCore(budgetMs);
            }
            catch (TxBusyException)
            {
                // Юу ч өөрчлөөгүй (transaction эхлээгүй) — яг энэ алхмыг дараа нь дахин.
                if (DocReadOnly())
                {
                    End(CdJobState.Failed, "Файл зөвхөн уншихаар нээгдсэн тул хувилах боломжгүй");
                }
                else
                {
                    WaitingForRevit = true;
                    Status = "Revit одоогоор өөрчлөлт хүлээж авахгүй байна (засварлах горим г.м.) — дуусмагц үргэлжилнэ";
                }
            }
            catch (Exception ex)
            {
                // Алхмын transaction-ы ГАДУУРХ гэнэтийн алдаа (бэлтгэл, жагсаалт).  Зорилтын дунд бол тэр зорилтыг алгасна.
                Report.Error("Гэнэтийн алдаа" + (_curLabel != null ? " (" + _curLabel + ")" : "") + ": " + ex.Message);
                _needResync = true;
                if (_cur != null && _plan != null)
                {
                    Report.TargetError(Key(_cur));
                    DropCurrentTarget();
                }
                else
                {
                    End(CdJobState.Failed, "Алдаа гарч зогслоо: " + ex.Message);
                }
            }
            finally
            {
                ActiveMs += sw.ElapsedMilliseconds;
                _inStep = false;
                if (_pendingCancel)
                {
                    _pendingCancel = false;
                    Cancel();
                }
                else if (_pendingPause)
                {
                    _pendingPause = false;
                    Pause();
                }
            }
        }

        private bool DocReadOnly()
        {
            try { return Doc.IsReadOnly; }
            catch { return false; }
        }

        private void StepCore(long budgetMs)
        {
            if (!DocAlive)
            {
                End(CdJobState.Failed, "Файл хаагдсан тул хувилалт зогслоо");
                return;
            }
            if (_needResync && _plan != null)
            {
                Resync();
                if (IsFinished)
                    return;
            }
            else if (_touched.Count > 0 && _plan != null)
            {
                LightSync();
                if (IsFinished)
                    return;
            }
            if (_relink)
            {
                // Ctrl+Z гарын холбоосыг буцаасан — дахин бичнэ (явцын нэгж нэмэхгүй).  Transaction нээгдээгүй бол хүлээлт хэвээр.
                SaveLinks(true);
                _relink = false;
            }
            if (_restartCurrent)
            {
                _restartCurrent = false;
                if (_cur != null)
                {
                    _cur.Rerun = true;
                    _ctx = null;
                    _work = null;
                    _unitsDone = _targetUnitsStart;
                    _partial = 0;
                    _phase = Phase.Begin;
                }
            }

            switch (_phase)
            {
                case Phase.Links: DoLinks(); break;
                case Phase.Prepare: DoPrepare(); break;
                case Phase.Begin: DoBegin(); break;
                case Phase.Views: DoView(); break;
                case Phase.Annotate: DoAnnotate(budgetMs); break;
                case Phase.Sheets: DoSheet(); break;
                case Phase.Finish: DoFinish(); break;
            }
        }

        private void DoLinks()
        {
            Status = "Бэлтгэж байна…";
            if (ManualViewUids != null)
                SaveLinks(false);
            _unitsDone++;
            _phase = Phase.Prepare;
        }

        /// <summary>
        /// Гараар холбосон харагдацыг загвар элементэд бичнэ.  <paramref name="again"/> — Ctrl+Z-ээр буцаагдсаны дараа дахин
        /// (тэр үед зорилтын дунд байж болох тул буцаалтыг тухайн зорилтын алдаа гэж тоолохгүй).
        /// </summary>
        private void SaveLinks(bool again)
        {
            Element tpl = Doc.GetElement(TemplateId);
            bool written = false, committed = false;
            // Ажил бүрд ялгаатай нэр — өөр хувилалтын холбоосыг буцаахад энэ ажил андуурахгүй.
            _linksTx = JobNames.Job("#" + Number + " загварын холбоо — " + Info.Label);
            if (tpl != null)
                committed = RunTx(_linksTx, 0, () => written = CdLinks.SetManualViews(tpl, ManualViewUids), quiet: again);
            LinksSaved = committed && written;
            if (!LinksSaved)
                Report.Note("Гараар холбосон харагдацыг загвар элементэд хадгалж чадсангүй (өөр хүн эзэмшиж байна уу?).");
        }

        private void DoPrepare()
        {
            Element tpl = Doc.GetElement(TemplateId);
            if (tpl == null)
            {
                End(CdJobState.Failed, "Загвар элемент устсан тул хувилах боломжгүй");
                return;
            }
            Status = "Эх зургийг уншиж байна…";
            // Дараалалд хүлээх хооронд файл өөрчлөгдсөн бол (өмнөх хувилалт, хэрэглэгч) суурийн индексийг дахин угсарна.
            _plan = CdPlan.Prepare(Doc, tpl, Info, Views, Options, _needResync ? null : _hosts);
            _hosts = _plan.Hosts;
            _needResync = false;
            _touched.Clear();
            _unitsDone++;
            _phase = Phase.Begin;
        }

        private void DoBegin()
        {
            if (_targets.Count == 0)
            {
                Finish();
                return;
            }
            if (_plan.Template == null || !_plan.Template.IsValidObject)
            {
                Report.TargetsUnfinished = _targets.Count;
                End(CdJobState.Failed, "Загвар элемент устсан тул хувилалт зогслоо");
                return;
            }
            _cur = _targets.Peek();
            _targetUnitsStart = _unitsDone;
            _partial = 0;
            Element tgt = Doc.GetElement(_cur.Id);
            if (tgt == null || !tgt.IsValidObject)
            {
                Report.Note("Зорилт (ID " + _cur.Id.Value + ") устсан тул алгасав.");
                _curLabel = null;
                DropCurrentTarget();
                return;
            }
            _curLabel = CloneNaming.TargetLabel(CdAnalysis.Mark(tgt), tgt.Id.Value);
            Status = Pos() + " · бэлтгэж байна";
            bool deleteOld = Options.Recreate && !_cur.Rerun;
            CdContext ctx = null;
            if (deleteOld)
            {
                // «Өмнөх клоныг устгаж шинээр» — устгал transaction шаардана.  Буцаагдвал устгалгүйгээр үргэлжилнэ.
                string delTx = StepName("өмнөх клоныг устгах");
                int deletedBefore = Report.ViewsDeleted;
                if (!RunTx(delTx, _cur.Position, () => ctx = CdEngine.BeginTarget(_plan, tgt, Report, true)))
                    ctx = null;
                else if (Report.ViewsDeleted > deletedBefore)
                    _deletedByTx[delTx] = Report.ViewsDeleted - deletedBefore;
            }
            if (ctx == null)
            {
                if (_needResync)
                {
                    Resync();
                    if (IsFinished || _cur == null)
                        return;
                }
                ctx = CdEngine.BeginTarget(_plan, tgt, Report, false);
            }
            _ctx = ctx;
            _toCreate = CdEngine.ViewsToCreate(_plan);
            _viewIdx = 0;
            Advance();
            _phase = Phase.Views;
        }

        private void DoView()
        {
            if (_viewIdx >= _toCreate.Count)
            {
                // Шинэ харагдацууд бүгд commit болсон (commit бүр регенерацитай) — харагдах байдлын кэшийг шинэчилнэ.
                _ctx.ResetVisibility();
                _annIdx = 0;
                _work = null;
                _phase = Phase.Annotate;
                return;
            }
            CdLinkedView lv = _toCreate[_viewIdx];
            Status = Pos() + " · харагдац үүсгэж байна: " + JobNames.Quote(lv.Name);
            RunTx(StepName("харагдац " + JobNames.Quote(lv.Name)), _cur.Position, () => CdEngine.CreateView(_ctx, lv));
            _viewIdx++; // transaction нээгдээгүй бол (TxBusyException) энэ харагдацыг дахин
            Advance();
        }

        private void DoAnnotate(long budgetMs)
        {
            if (_work == null)
            {
                if (_annIdx >= _plan.Views.Count)
                {
                    _sheets = null;
                    _phase = Phase.Sheets;
                    return;
                }
                CdLinkedView lv = _plan.Views[_annIdx];
                _work = CdEngine.BeginAnnotate(_ctx, lv);
                if (_work == null)
                {
                    _annIdx++;
                    Advance();
                    return;
                }
            }

            CdAnnotateWork w = _work;
            if (w.Finished())
            {
                // Буцаалт/алгасалтын дараа үлдсэн элемент алга.
                _work = null;
                _annIdx++;
                Advance();
                return;
            }
            Status = Pos() + " · tag, хэмжээс: " + JobNames.Quote(w.View?.Name)
                     + (w.Total > 1 ? "  (" + Math.Min(w.Done, w.Total) + "/" + w.Total + ")" : "")
                     + (w.Safe ? " · нэг нэгээр шалгаж байна" : "");
            var sw = Stopwatch.StartNew();
            long limit = Math.Max(budgetMs, MinAnnotateMs);
            Func<bool> timeUp = w.Safe ? () => true // аюулгүй горим: нэг алхамд нэг элемент
                : budgetMs == long.MaxValue ? (Func<bool>)null
                : () => sw.ElapsedMilliseconds >= limit;
            w.Mark();
            bool done = false;
            string what = "тэмдэглэгээ " + JobNames.Quote(w.View?.Name);
            if (w.Safe)
                what += " · " + CdEngine.ItemLabel(w); // аль эх элемент бүтэлгүйтсэнийг тайлан, Undo жагсаалтад
            // Хурдан горимын буцаалт, аюулгүй горимын бүрэн шинэчлэлтээс ӨМНӨХ буцаалтыг тайланд бичихгүй — нэг нэгээр
            // дахин хийхэд (файлаас шинэ уншилттай) аль элемент буруу нь тодорно.  Буцаалт бүрэн Resync өдөөхгүй —
            // доор зөвхөн энэ харагдацын кэшийг цэвэрлэнэ.
            bool ok = RunTx(StepName(what), _cur.Position,
                () => done = CdEngine.ContinueAnnotate(_ctx, w, timeUp), quiet: !(w.Safe && w.Resynced), resyncOnFail: false);
            if (!ok)
            {
                // Энэ алхмын бүх үр дүн transaction-тай хамт буцсан — яг эхлэл рүү нь буцна (өмнөх алхмууд commit
                // хэвээр).  Буцсан tag/хэмжээсийг кэшээс хасна; 2D-г «байгаа эсэх»-ээр нэмэлт шалгана.
                int reached = w.Done;
                w.Rewind();
                _ctx.DetailCheck.Add(w.DestId);
                _ctx.ForgetRolledBack(w.DestId);
                if (!w.Safe)
                {
                    // Тэр хэсгийг (буцах үед хүрсэн цэг хүртэл) НЭГ НЭГЭЭР дахин — алдаатай элемент л алгасагдана.
                    w.Safe = true;
                    w.SafeUntil = Math.Max(reached, w.Done + 1);
                    _partial = w.Fraction;
                    return;
                }
                if (!w.Resynced)
                {
                    // Ганц элемент буцсан.  Буруутгахаас өмнө хэрэглэгчийн засвараар хуучирсан кэш биш гэдгийг баталгаажуулна:
                    // файлаас бүрэн дахин уншаад яг тэр элементийг НЭГ удаа дахин (харагдацад нэг л удаа).
                    w.Resynced = true;
                    _needResync = true;
                    _partial = w.Fraction;
                    return;
                }
                // Шинэ уншилтын дараа ч буцсан — яг ЭНЭ элемент буруу: алгасна (шалтгаан нь тайлангийн «АЛДАА»-д).
                CdEngine.SkipItem(_ctx, w);
                w.Skipped++;
                if (w.SafeOk == 0 && w.Skipped >= AbandonAfterSkips && !w.Finished() && CdEngine.OwnedByOtherUser(Doc, w.DestId))
                {
                    int left = CdEngine.AbandonAnnotate(_ctx, w);
                    Report.Error("тэмдэглэгээ " + JobNames.Quote(w.View?.Name) + " (" + (_curLabel ?? "?") + "): харагдацыг өөр "
                                 + "хүн эзэмшиж (worksharing) байгаа тул үлдсэн " + left + " тэмдэглэгээг алгасав — чөлөөлсний дараа "
                                 + "дахин хувилахад дутууг нэмнэ");
                }
                // Буцах үед хүрсэн цэг хүртэл нэг нэгээр; дараа нь хурдан.  Харагдацад хоёр дахь алдаатай элемент олдвол
                // үлдсэнийг нэг нэгээр (харагдац «асуудалтай»).
                w.Safe = w.Skipped >= 2 || w.Done < w.SafeUntil;
                if (w.Finished())
                {
                    _work = null;
                    _annIdx++;
                    Advance();
                }
                else
                {
                    _partial = w.Fraction;
                }
                return;
            }
            if (w.Safe)
            {
                w.SafeOk++;
                if (w.Skipped < 2 && w.Done >= w.SafeUntil)
                    w.Safe = false; // буцсан хэсгийг давсан — бүгд амжилттай бол алдаа нь хослолоос байсан
            }
            if (done)
            {
                _work = null;
                _annIdx++;
                Advance();
            }
            else
            {
                _partial = w.Fraction;
            }
        }

        private void DoSheet()
        {
            if (_sheets == null)
            {
                _sheets = Options.Sheets && _ctx.Dest.Count > 0 ? CdEngine.SheetGroups(_ctx) : new List<ElementId>();
                _sheetIdx = 0;
            }
            if (_sheetIdx >= _sheets.Count)
            {
                _phase = Phase.Finish;
                return;
            }
            ElementId sid = _sheets[_sheetIdx];
            string num = null;
            try { num = (Doc.GetElement(sid) as ViewSheet)?.SheetNumber; } catch { }
            Status = Pos() + " · хуудас " + (num ?? "?");
            RunTx(StepName("хуудас " + (num ?? "?")), _cur.Position, () => CdEngine.CloneSheet(_ctx, sid));
            _sheetIdx++;
            Advance();
        }

        private void DoFinish()
        {
            Status = Pos() + " · дуусгаж байна";
            if (!RunTx(StepName("дуусгах"), _cur.Position, () => CdEngine.FinishTarget(_ctx)))
            {
                // Зураг нь хийгдсэн — зөвхөн «загвартай холбоо» бичигдсэнгүй.  Зорилтыг дууссанд тоолно.
                Report.TargetsDone++;
            }
            _targets.Dequeue();
            if (_finishedPositions.Add(_cur.Position))
                _targetsFinished++;
            _unitsDone = _targetUnitsStart + _perTarget;
            _partial = 0;
            _cur = null;
            _ctx = null;
            _curLabel = null;
            _phase = Phase.Begin;
        }

        private void Finish()
        {
            string s = Report.TargetsDone + " элементэд хувилав";
            if (Report.TargetsFailed > 0)
                s += " · " + Report.TargetsFailed + " элементэд алдаатай алхам";
            End(CdJobState.Done, "Дууслаа — " + s);
        }

        /// <summary>Одоогийн зорилтыг (устсан эсвэл гэнэтийн алдаа) алгасна.</summary>
        private void DropCurrentTarget()
        {
            if (_targets.Count > 0 && _cur != null && ReferenceEquals(_targets.Peek(), _cur))
                _targets.Dequeue();
            _unitsDone = _targetUnitsStart + _perTarget;
            _partial = 0;
            _cur = null;
            _ctx = null;
            _work = null;
            _curLabel = null;
            _phase = Phase.Begin;
        }

        /// <summary>Нэгж дуусгав — зорилтын хувьд <see cref="_perTarget"/>-аас хэтрэхгүй (төгсгөл нь тэнцүүлнэ).</summary>
        private void Advance()
        {
            _partial = 0;
            if (_unitsDone < _targetUnitsStart + _perTarget - 1)
                _unitsDone++;
        }

        private string Pos() => (_curLabel ?? "?") + " (" + (_cur?.Position ?? 0) + "/" + TargetCount + ")";

        private string StepName(string what) => JobNames.Step(_cur?.Position ?? 0, TargetCount, _curLabel, what, Number);

        private static string Key(TargetSlot t) => t.Position.ToString(System.Globalization.CultureInfo.InvariantCulture);

        // ── Transaction ────────────────────────────────────────────────────

        /// <summary>
        /// Нэг алхам = нэг transaction.  Шийдэгдэхгүй Revit алдааг ЧИМЭЭГҮЙ буцаана (модаль цонх гаргахгүй — хэрэглэгч
        /// өөр ажил хийж байна), тайланд шалтгааныг нь бичнэ.  Буцаагдвал тоолуурыг сэргээж, дараагийн алхмаас өмнө
        /// кэшийг файлаас дахин уншина.
        /// </summary>
        /// <param name="quiet">
        /// Буцаалтыг тайланд БИЧИХГҮЙ (кэш шинэчлэлт хэвээр) — тэмдэглэгээний олон элементтэй алхам буцаагдвал тэдгээрийг
        /// нэг нэгээр дахин хийдэг; аль нь буруу байсныг ТЭР үед л тайланд бичнэ.  Эс бөгөөс нэг нэгээр хийхэд бүгд
        /// амжилттай болсон ч тайлан «алдаатай алхам» гэж худал хэлнэ.
        /// </param>
        /// <param name="resyncOnFail">
        /// Буцаалтын дараа бүрэн Resync (өгөгдмөл).  Тэмдэглэгээний алхам false — өөрөө зөвхөн тэр харагдацын кэшийг цэвэрлэнэ.
        /// </param>
        private bool RunTx(string name, int position, Action body, bool quiet = false, bool resyncOnFail = true)
        {
            if (position > 0)
                _txTarget[name] = position;
            CdReport.Snapshot snap = Report.Take();
            var handler = new CdFailureHandler(Report, true);
            using (var t = new Transaction(Doc, name))
            {
                // Revit transaction нээхийг зөвшөөрөхгүй бол (засварлах горим — sketch, бүлэг засах; түр зуурын төлөв) энэ
                // алхмын алдаа БИШ: юу ч өөрчлөөгүй тул алгасахгүй, буцаалт гэж тоолохгүй — дараа нь дахин.
                TransactionStatus started;
                try { started = t.Start(); }
                catch (Exception ex) { throw new TxBusyException(ex.Message); }
                if (started != TransactionStatus.Started)
                    throw new TxBusyException(started.ToString());
                try
                {
                    FailureHandlingOptions fho = t.GetFailureHandlingOptions();
                    fho.SetFailuresPreprocessor(handler);
                    fho.SetClearAfterRollback(true);
                    t.SetFailureHandlingOptions(fho);
                    _executing = true;
                    body();
                    TransactionStatus st = t.Commit();
                    if (st == TransactionStatus.Committed)
                        return true;
                    Report.Restore(snap, quiet);
                    StepFailed(name, handler.RolledBackReason ?? ("Revit өөрчлөлтийг буцаасан (" + st + ")"), quiet, resyncOnFail);
                    return false;
                }
                catch (Exception ex)
                {
                    try
                    {
                        if (t.HasStarted() && !t.HasEnded())
                            t.RollBack();
                    }
                    catch { }
                    Report.Restore(snap, quiet);
                    StepFailed(name, ex.Message, quiet, resyncOnFail);
                    return false;
                }
                finally
                {
                    _executing = false;
                }
            }
        }

        private void StepFailed(string name, string why, bool quiet, bool resync)
        {
            if (resync)
                _needResync = true;
            if (quiet)
                return;
            string what = name != null && name.StartsWith(JobNames.Prefix, StringComparison.Ordinal)
                ? name.Substring(JobNames.Prefix.Length).TrimStart(' ', '·')
                : name;
            Report.Error(what + ": " + (why ?? "?").Trim().TrimEnd('.'));
            if (_cur != null)
                Report.TargetError(Key(_cur));
        }

        private void Resync()
        {
            _needResync = false;
            _touched.Clear();
            if (_plan == null)
                return;
            if (_plan.Template == null || !_plan.Template.IsValidObject)
            {
                Report.TargetsUnfinished = _targets.Count;
                End(CdJobState.Failed, "Загвар элемент устсан тул хувилалт зогслоо");
                return;
            }
            _plan.Resync();
            _hosts = _plan.Hosts;
            if (_ctx != null)
            {
                if (_ctx.Tgt == null || !_ctx.Tgt.IsValidObject)
                {
                    Report.Note("Зорилт " + (_curLabel ?? "?") + " хувилах явцад устсан тул алгасав.");
                    Report.TargetError(_cur != null ? Key(_cur) : "?");
                    DropCurrentTarget();
                    return;
                }
                _ctx.ResetCaches();
                CdEngine.RemapRelated(_ctx);
            }
        }

        /// <summary>
        /// Хэрэглэгч алхмын хооронд зөвхөн элемент НЭМСЭН/ӨӨРЧИЛСӨН — хөндөгдсөн харагдац, ангилал, элементийн кэшийг л хаяна
        /// (<see cref="CdTouch"/>).  Загвар, одоогийн зорилт эсвэл тэдгээрийн арматур/суусан элемент хөндөгдсөн бол бүрэн Resync.
        /// </summary>
        private void LightSync()
        {
            List<long> ids = _touched.ToList();
            _touched.Clear();
            if (_plan.Template == null || !_plan.Template.IsValidObject || (_ctx != null && (_ctx.Tgt == null || !_ctx.Tgt.IsValidObject)))
            {
                Resync(); // устсан загвар/зорилтыг тэнд мэдээлнэ
                return;
            }
            CdTouch t = CdTouch.Collect(Doc, ids, _plan, _ctx);
            if (t == null)
            {
                Resync();
                return;
            }
            _plan.Forget(t);
            _hosts = _plan.Hosts;
            _ctx?.Forget(t);
            // Хөнгөн шинэчлэлт бүх зүйлийг хамарч чадахгүй байж болзошгүй — дараагийн буцаалтад дахин бүрэн уншиж нэг удаа оролдоно.
            if (_work != null)
                _work.Resynced = false;
        }

        /// <summary>Хэрэглэгчийн transaction-ы нэмсэн/өөрчилсөн элементийг хуримтлуулна; устгалтай эсвэл хэт олон бол false (бүрэн Resync).</summary>
        private bool CollectTouched(DocumentChangedEventArgs e)
        {
            try
            {
                if (e.GetDeletedElementIds().Count > 0)
                    return false; // устсан объект кэшэд үлдэж болзошгүй — бүрэн
                ICollection<ElementId> added = e.GetAddedElementIds();
                ICollection<ElementId> modified = e.GetModifiedElementIds();
                if (added.Count + modified.Count == 0)
                    return false; // юу өөрчлөгдсөнийг мэдэхгүй — бүрэн
                if (_touched.Count + added.Count + modified.Count > LightSyncMaxIds)
                    return false;
                foreach (ElementId id in added)
                    _touched.Add(id.Value);
                foreach (ElementId id in modified)
                    _touched.Add(id.Value);
                return true;
            }
            catch
            {
                return false;
            }
        }

        // ── Revit-ийн өөрчлөлт (CdJobHost-оос) ─────────────────────────────

        /// <summary>
        /// Манай алхмын commit → нэмэгдсэн элементийг тоолно (<see cref="UndoAll"/>).  Хэрэглэгчийн ердийн transaction
        /// (нэмсэн/өөрчилсөн, устгалгүй) → хөнгөн шинэчлэлт (<see cref="LightSync"/>); устгал, Ctrl+Z/Y, өөр хувилалтын
        /// алхам → дараагийн алхмаас өмнө бүрэн Resync.  Ctrl+Z манай алхмыг буцаасан бол тэр зорилтыг дахин хийхээр тэмдэглэж,
        /// түр зогсооно (хэрэглэгч өөрийнхөө ажлыг буцаах гэж байсан байж болно — дахин Ctrl+Z дарахад манай өөр алхам
        /// замд нь саад болохгүй).
        /// </summary>
        internal void OnDocumentChanged(DocumentChangedEventArgs e)
        {
            if (Undone)
                return;
            ICollection<string> names;
            try { names = e.GetTransactionNames(); }
            catch { names = new List<string>(); }
            UndoOperation op = e.Operation;
            TrackCreated(e, op, names);
            if (IsFinished)
                return;
            if (_executing && op == UndoOperation.TransactionCommitted && names.Count > 0 && names.All(JobNames.IsOurs))
            {
                try
                {
                    foreach (ElementId id in e.GetAddedElementIds())
                        Created.Add(id.Value);
                }
                catch { }
                return;
            }
            if (op == UndoOperation.TransactionCommitted && _plan != null && names.Count > 0 && !names.Any(JobNames.IsOurs)
                && (_needResync || CollectTouched(e)))
                return; // бүрэн Resync аль хэдийн хүлээгдэж байна, эсвэл хөнгөн шинэчлэлтэд хуримтлуулав
            _needResync = true;
            _touched.Clear();
            if (op != UndoOperation.TransactionUndone)
                return;
            bool ours = false;
            foreach (string n in names)
            {
                if (!JobNames.IsOurs(n))
                    continue;
                ours = true;
                if (_txTarget.TryGetValue(n, out int pos))
                {
                    ScheduleRerun(pos);
                }
                else if (_linksTx != null && n == _linksTx)
                {
                    _relink = true; // LinksSaved-ийг TrackCreated цэвэрлэсэн
                }
            }
            if (ours && State == CdJobState.Running)
            {
                State = CdJobState.Paused;
                Status = "Түр зогсоосон";
                Notice = "Ctrl+Z хувилалтын алхмыг буцаасан тул түр зогсоолоо.  «Үргэлжлүүлэх» дарвал буцсан хэсгийг дахин "
                         + "хийнэ (байгааг давхардуулахгүй); «Цуцлах» дарвал энд зогсоно.";
            }
        }

        /// <summary>
        /// «Бүгдийг буцаах»-ын жагсаалтыг (<see cref="Created"/>) Ctrl+Z/Y-тэй уялдуулна — ажил дууссаны дараа ч (хост дууссан
        /// ажилд ч дамжуулна).  Ctrl+Z манай алхмын элементийг устгавал хасна: Revit буцаалтын дараа тэр ID-г хэрэглэгчийн
        /// ШИНЭ элементэд дахин олгож болох тул «Бүгдийг буцаах» түүнийг устгах ёсгүй.  Ctrl+Y манай алхмыг давтвал буцааж нэмнэ.
        /// </summary>
        private void TrackCreated(DocumentChangedEventArgs e, UndoOperation op, ICollection<string> names)
        {
            try
            {
                if (op != UndoOperation.TransactionUndone && op != UndoOperation.TransactionRedone)
                    return;
                bool undo = op == UndoOperation.TransactionUndone;
                foreach (string n in names)
                {
                    // «Өмнөх клоныг устгах» буцсан/давтагдсан — устгасан тоо (ба «Бүгдийг буцаах»-ын анхааруулга) үнэн байна.
                    if (n != null && _deletedByTx.TryGetValue(n, out int d))
                        Report.ViewsDeleted = Math.Max(0, Report.ViewsDeleted + (undo ? -d : d));
                    if (_linksTx != null && n == _linksTx)
                        LinksSaved = !undo;
                }
                if (undo)
                {
                    if (Created.Count > 0)
                    {
                        foreach (ElementId id in e.GetDeletedElementIds())
                            Created.Remove(id.Value);
                    }
                }
                else if (names.Count > 0 && names.All(JobNames.IsOurs) && names.Any(n => _txTarget.ContainsKey(n) || n == _linksTx))
                {
                    // Алхмын нэр ажлын дугаартай (JobNames.Step) — өөр ажлын давтагдсан алхам энд орохгүй.
                    foreach (ElementId id in e.GetAddedElementIds())
                        Created.Add(id.Value);
                }
            }
            catch { }
        }

        private void ScheduleRerun(int position)
        {
            Report.Note("Хувилалтын явцад Ctrl+Z-ээр алхам буцаагдсан — буцсан хэсгийг дахин хийхэд шинэ харагдац, tag, хэмжээсийн "
                        + "тоо тайланд давхар тоологдсон байж болно (загварт давхардал үүсгэхгүй).");
            if (_cur != null && _cur.Position == position)
            {
                _restartCurrent = true;
                return;
            }
            if (_targets.Any(t => t.Position == position))
                return; // хараахан хийгдээгүй (эсвэл аль хэдийн дахин хийхээр дараалсан)
            if (!_targetByPosition.TryGetValue(position, out ElementId id))
                return;
            _targets.Enqueue(new TargetSlot { Id = id, Position = position, Rerun = true });
            _unitsTotal += _perTarget;
            if (_finishedPositions.Remove(position))
            {
                // Дахин хийгдэж дуусахад дахин тоологдоно.
                _targetsFinished = Math.Max(0, _targetsFinished - 1);
                Report.TargetsDone = Math.Max(0, Report.TargetsDone - 1);
            }
        }

        // ── Бүгдийг буцаах ─────────────────────────────────────────────────

        /// <summary>
        /// Энэ хувилалтоор НЭМЭГДСЭН (DocumentChanged-аар тоолсон) харагдац, хуудас, tag, хэмжээс, 2D-г нэг transaction-д
        /// устгана («нэг Ctrl+Z»-ийн оронд).  Зөвхөн дууссан ажилд.  Устгах төрлийг ЦАГААН ЖАГСААЛТААР — Revit-ийн өөрөө
        /// үүсгэсэн дотоод элемент (sketch plane, зүсэлтийн тэмдэг) харагдацтайгаа хамт устна.  Revit API контекстод.
        /// </summary>
        internal string UndoAll()
        {
            if (!IsFinished)
                return "Хувилалт явагдаж байна — эхлээд цуцлана уу.";
            if (Undone)
                return UndoResult;
            if (!DocAlive)
                return UndoResult = "Файл хаагдсан тул буцаах боломжгүй.";
            var views = new List<ElementId>();
            var anns = new List<ElementId>();
            foreach (long v in Created)
            {
                Element e = Doc.GetElement(new ElementId(v));
                if (e == null)
                    continue;
                if (e is View vw)
                {
                    if (!vw.IsTemplate)
                        views.Add(e.Id);
                }
                else if (IsAnnotation(e))
                {
                    anns.Add(e.Id);
                }
            }
            if (views.Count + anns.Count == 0)
            {
                Undone = true;
                return UndoResult = "Устгах зүйл алга — аль хэдийн буцаасан эсвэл гараар устгасан байна.";
            }
            int sheets = views.Count(id => Doc.GetElement(id) is ViewSheet);
            int delViews = 0, delAnns = 0;
            var handler = new CdFailureHandler(new CdReport(), true);
            using (var t = new Transaction(Doc, JobNames.Job("бүгдийг буцаах — " + Info.Label)))
            {
                try
                {
                    t.Start();
                    FailureHandlingOptions fho = t.GetFailureHandlingOptions();
                    fho.SetFailuresPreprocessor(handler);
                    fho.SetClearAfterRollback(true);
                    t.SetFailureHandlingOptions(fho);
                    delViews = DeleteAll(views);
                    delAnns = DeleteAll(anns.Where(id => Doc.GetElement(id) != null).ToList());
                    if (t.Commit() != TransactionStatus.Committed)
                        return UndoResult = "Revit буцаалтыг хүлээж авсангүй: " + (handler.RolledBackReason ?? "?");
                }
                catch (Exception ex)
                {
                    try
                    {
                        if (t.HasStarted() && !t.HasEnded())
                            t.RollBack();
                    }
                    catch { }
                    return UndoResult = "Буцааж чадсангүй: " + ex.Message;
                }
            }
            int viewsOnly = Math.Max(0, delViews - sheets);
            string res = "Буцаалаа: " + viewsOnly + " харагдац, " + Math.Min(sheets, delViews) + " хуудас, " + delAnns
                         + " тэмдэглэгээ устгав.";
            // Revit зарим элементийг устгахыг зөвшөөрөөгүй (өөр хүн эзэмшиж/түгжигдсэн) — дахин оролдох боломжийг үлдээнэ.
            int left = views.Concat(anns).Count(id => Doc.GetElement(id) != null);
            if (left > 0)
                return UndoResult = res + "  " + left + " элементийг Revit устгахыг зөвшөөрсөнгүй (өөр хүн эзэмшиж эсвэл "
                                    + "түгжигдсэн байж болно) — «Бүгдийг буцаах»-ыг дахин дарж болно.";
            Undone = true;
            return UndoResult = res;
        }

        private static bool IsAnnotation(Element e)
        {
            if (e is IndependentTag || e is SpatialElementTag || e is Dimension || e is MultiReferenceAnnotation
                || e is TextNote || e is FilledRegion || e is Viewport || e is ScheduleSheetInstance)
                return true;
            if (e is CurveElement && e.Category?.Id.Value == (long)BuiltInCategory.OST_Lines && e.ViewSpecific)
                return true;
            return e is FamilyInstance && e.ViewSpecific;
        }

        /// <summary>Нэг дор устгана; Revit татгалзвал нэг нэгээр (тус бүр SubTransaction) — устгагдсаны тоо.</summary>
        private int DeleteAll(List<ElementId> ids)
        {
            if (ids.Count == 0)
                return 0;
            using (var st = new SubTransaction(Doc))
            {
                try
                {
                    st.Start();
                    Doc.Delete(ids);
                    st.Commit();
                    return ids.Count;
                }
                catch
                {
                    if (st.HasStarted() && !st.HasEnded())
                        st.RollBack();
                }
            }
            int n = 0;
            foreach (ElementId id in ids)
            {
                if (Doc.GetElement(id) == null)
                    continue;
                using (var st = new SubTransaction(Doc))
                {
                    try
                    {
                        st.Start();
                        Doc.Delete(id);
                        st.Commit();
                        n++;
                    }
                    catch
                    {
                        if (st.HasStarted() && !st.HasEnded())
                            st.RollBack();
                    }
                }
            }
            return n;
        }

        /// <summary>«Эхний шинэ хуудас/харагдац»-ыг нээх — Revit API контекстод, зөвхөн идэвхтэй файлд.</summary>
        internal string Open(Autodesk.Revit.UI.UIApplication app, bool sheet)
        {
            if (!DocAlive)
                return "Файл хаагдсан.";
            ElementId id = sheet ? Report.FirstSheetId : Report.FirstViewId;
            if (id == null || !(Doc.GetElement(id) is View v))
                return "Тэр " + (sheet ? "хуудас" : "харагдац") + " одоо байхгүй (буцаасан эсвэл устгасан).";
            Autodesk.Revit.UI.UIDocument uidoc = app?.ActiveUIDocument;
            if (uidoc?.Document == null || !uidoc.Document.Equals(Doc))
                return "«" + DocTitle + "» файлыг идэвхтэй болгоод дахин дарна уу.";
            uidoc.RequestViewChange(v);
            return null;
        }

        // ── IMglJob — арын горимын хост «Ханын дэлгээс»-тэй хуваалцсан (2026-10-07) ──

        int IMglJob.Number => Number;
        string IMglJob.Title => Title;
        bool IMglJob.Background { get => Background; set => Background = value; }
        string IMglJob.FinalReport => Report.Summary(true);
        void IMglJob.Start() => Start();
        void IMglJob.Step(long budgetMs) => Step(budgetMs);
        bool IMglJob.SameDoc(Document d) => SameDoc(d);
        void IMglJob.OnDocumentChanged(DocumentChangedEventArgs e) => OnDocumentChanged(e);
        string IMglJob.UndoAll() => UndoAll();
        string IMglJob.Open(Autodesk.Revit.UI.UIApplication app, bool sheet) => Open(app, sheet);
        CdJobCard IMglJob.Card() => CdJobHost.ToCard(this);
        void IMglJob.Finished(Autodesk.Revit.UI.UIApplication app) { }
    }
}
