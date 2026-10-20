using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.ChangeImpact.Core
{
    public static class DoorMoveRequests
    {
        /// <summary>
        /// Хаалганы зөөх хүсэлт.  `signedOffsetMm` = хостын чиглэлийн дагуух ТЭМДЭГТЭЙ зай.
        /// Вектор = `DirX/DirY × DistanceMm` нь `хостын чиглэл × offset`-тэй ЯГ ТЭНЦҮҮ (`PreChangeRequestRules.Validate` шалгана).
        /// </summary>
        public static PreChangeRequest Build(PreChangeSelection door, double signedOffsetMm)
        {
            if (door == null) return null;
            double tn = Math.Sqrt(door.TangentX * door.TangentX + door.TangentY * door.TangentY);
            double tx = tn > 1e-9 ? door.TangentX / tn : 0, ty = tn > 1e-9 ? door.TangentY / tn : 0;
            double sign = signedOffsetMm >= 0 ? 1 : -1;
            return new PreChangeRequest
            {
                Operation = PreChangeOperationKind.DoorMove,
                SourceId = door.SourceId, SourceUid = door.SourceUid, SourceLabel = string.IsNullOrWhiteSpace(door.Mark) ? door.Label : door.Mark,
                HostId = door.HostId, HostUid = door.HostUid, TangentX = tx, TangentY = ty, OffsetMm = signedOffsetMm,
                DistanceMm = Math.Abs(signedOffsetMm), DirX = tx * sign, DirY = ty * sign,
                SideLabel = signedOffsetMm >= 0 ? "хананы дагуу (+)" : "хананы дагуу (−)", SideIndex = signedOffsetMm >= 0 ? 0 : 1,
            };
        }
    }

    /// <summary>Simulation-ы мөчлөг: ямар шат вэ.</summary>
    public enum ExactPhase
    {
        /// <summary>Зорилт алга (эсвэл хөдөлгөөнгүй) — юу ч шалгаагүй.</summary>
        None = 0,
        /// <summary>Зорилт сүүлд өөрчлөгдсөн, debounce (150–300 мс) хүлээж байна.</summary>
        Debouncing,
        /// <summary>Яг тэр зорилтод sandbox ажиллаж байна, түр дүн хараахан ирээгүй.</summary>
        Running,
        /// <summary>Түр (Quick) дүн ирсэн, эцсийн дүн хүлээгдэж байна.</summary>
        Provisional,
        /// <summary>Эцсийн дүн (яг ЭНЭ зорилтын).</summary>
        Final,
        /// <summary>Шинжилгээ унасан (хэрэгслийн алдаа) — Apply хаалттай.</summary>
        Failed,
    }

    public interface IDoorSimulationHost
    {
        long NowMs { get; }
        /// <summary>Яг ЭНЭ generation-д sandbox эхлүүл.  Үр дүнг `OnExactProvisional/OnExactFinished/OnExactFailed`-ээр буцаана.</summary>
        void StartExact(int generation, PreChangeRequest request);
        /// <summary>Явж буй (хуучирсан) generation-ийн ажлыг цуцал.  Хайхрамжгүй байж болно — хуучин үр дүн ямар ч байсан хаягдана.</summary>
        void CancelExact(int generation);
        /// <summary>Ghost + тодруулгыг ТУН ШУУД шинэчил (Revit API-гүй өгөгдөл).</summary>
        void ShowVisual(DoorVisualState visual);
        void ClearVisual();
        /// <summary>UI-г дахин зур.</summary>
        void Changed();
    }

    /// <summary>Хугацааны ҮНЭН хэмжилт — хуурамч «real-time» гэж зарлахгүй.</summary>
    public sealed class DoorSimulationTimings
    {
        public double FastScanMs { get; set; }
        /// <summary>Ghost + тодруулгын зураглал угсарч Revit-д дамжуулахад (UI thread) — сүүлийн удаа.</summary>
        public double GhostUpdateMs { get; set; }
        /// <summary>UI-г дахин зурахад (цонх тавьдаг) — сүүлийн удаа.</summary>
        public double RenderMs { get; set; }
        /// <summary>«Зөөх» (Apply) дуустал — цонх тавьдаг.</summary>
        public long ApplyMs { get; set; }
        public long ExactToProvisionalMs { get; set; }
        public long ExactToFinalMs { get; set; }
        public long ExactCount { get; set; }
        public long CancelledCount { get; set; }
        public long LateIgnoredCount { get; set; }
    }

    /// <summary>
    /// Хаалга зөөх simulation-ийн ЦЭВЭР төлөвийн машин.  UI (WPF) зөвхөн үүнийг зурна; Revit-тэй `IDoorSimulationHost`-оор харилцана.
    ///
    ///   ДҮРЭМ №1 — GENERATION: зорилт өөрчлөгдөх бүрт `Generation` өснө.  Fast scan, sandbox, зураглал, UI бүгд ТЭР generation-д уяатай.
    ///              Хуучин generation-ийн үр дүн (удаан sandbox) хожуу ирвэл ХАЯГДАНА — шинэ зорилтын UI-г ХЭЗЭЭ Ч дарахгүй.
    ///   ДҮРЭМ №2 — LATEST-WINS: +10 +10 +10 +10 гэж дараалан дарахад 4 үнэтэй sandbox дараалалд орохгүй: debounce, дахин цуцлаад зөвхөн хамгийн сүүлийнхийг шалгана.
    ///   ДҮРЭМ №3 — APPROVE: `Generation == ExactReportGeneration` (яг ЭНЭ зорилтын эцсийн дүн) үед л идэвхжинэ.  Шалгаж байх үед идэвхгүй.
    ///   ДҮРЭМ №4 — ХУУРАМЧ «ЭЦСИЙН» БАЙХГҮЙ: fast scan нь «түр» (🟢 хэзээ ч биш); эцсийн дүгнэлт зөвхөн sandbox-оос (эсвэл тодорхойлогдсон татгалзлаас).
    ///
    /// Нэг thread (UI)-д ажиллана.  Цаг `IDoorSimulationHost.NowMs`-аас → тест тодорхойлогдсон.
    /// </summary>
    public sealed class DoorSimulationController
    {
        public const int DebounceMs = 220;

        private readonly IDoorSimulationHost _host;
        private readonly PreChangeSelection _door;
        private DoorMoveContext _ctx;
        private long _lastChangeMs;
        private long _exactDueMs;
        private long _exactStartMs;
        private int _runningGeneration = -1;

        public DoorSimulationController(IDoorSimulationHost host, PreChangeSelection door)
        {
            if (host == null) throw new ArgumentNullException("host");
            _host = host;
            _door = door;
            Timings = new DoorSimulationTimings();
        }

        public PreChangeSelection Door { get { return _door; } }
        public DoorMoveContext Context { get { return _ctx; } }
        public int Generation { get; private set; }
        public double? OffsetMm { get; private set; }
        public DoorFastResult Fast { get; private set; }
        public ExactPhase Phase { get; private set; }
        /// <summary>Хамгийн сүүлд ирсэн (түр эсвэл эцсийн) тайлан ба тэр нь АЛЬ generation-ийнх.  `Current`-тай ижил биш бол «өмнөх дүн».</summary>
        public PreChangeReport ExactReport { get; private set; }
        public int ExactReportGeneration { get; private set; } = -1;
        public string LastError { get; private set; }
        public ImpactGroup? Filter { get; private set; }
        public bool Applying { get; private set; }
        public string Notice { get; private set; }
        public DoorSimulationTimings Timings { get; private set; }

        /// <summary>Яг ОДООГИЙН зорилтын тайлан (түр эсвэл эцсийн).  Үгүй бол null.</summary>
        public PreChangeReport CurrentReport { get { return ExactReport != null && ExactReportGeneration == Generation ? ExactReport : null; } }
        /// <summary>Хуучин зорилтын тайлан (шинэ зорилтыг шалгаж байх хооронд бүдэг харуулна).  Эцсийн/түр аль ч байж болно.</summary>
        public PreChangeReport PreviousReport { get { return ExactReport != null && ExactReportGeneration != Generation ? ExactReport : null; } }
        public bool HasTarget { get { return OffsetMm.HasValue; } }
        public bool ExactIsCurrentAndFinal { get { return Phase == ExactPhase.Final && ExactReportGeneration == Generation && ExactReport != null; } }

        public void SetContext(DoorMoveContext ctx)
        {
            _ctx = ctx;
        }

        /* ============================== ЗОРИЛТ ============================== */

        public PreChangeRequest BuildRequest()
        {
            return OffsetMm.HasValue ? DoorMoveRequests.Build(_door, OffsetMm.Value) : null;
        }

        public void Nudge(double deltaMm)
        {
            SetTarget((OffsetMm ?? 0) + deltaMm);
        }

        /// <summary>
        /// Шинэ зорилтот offset (мм).  Ghost + fast scan ТУН ШУУД; sandbox debounce-ийн дараа.  Ижил утга дахин өгвөл юу ч өөрчлөгдөхгүй.
        /// Зөөлт хэрэгжиж байхад (`Applying`) эсвэл контекст бэлэн болоогүй үед үл хэрэгсэнэ.
        /// </summary>
        public void SetTarget(double offsetMm)
        {
            if (Applying || _ctx == null || double.IsNaN(offsetMm) || double.IsInfinity(offsetMm)) return;
            if (OffsetMm.HasValue && Math.Abs(OffsetMm.Value - offsetMm) <= 0.01 && Phase != ExactPhase.None) return;
            Advance();
            OffsetMm = offsetMm;
            Notice = null;
            LastError = null;
            _lastChangeMs = _host.NowMs;

            DoorFastResult fast = DoorFastScan.Run(_ctx, offsetMm);
            Fast = fast;
            Timings.FastScanMs = fast.ElapsedMs;

            if (fast.Check != null && fast.Check.Code == "no.move")
            {
                // Хаалга анхны байрлалдаа — simulation байхгүй, ghost байхгүй.
                Phase = ExactPhase.None;
                ExactReport = null;
                ExactReportGeneration = -1;
                _host.ClearVisual();
                _host.Changed();
                return;
            }

            if (!fast.CanSimulate)
            {
                // Тодорхойлогдсон татгалзал (хостын гадна г.м.): sandbox ХЭРЭГГҮЙ — шууд эцсийн 🔴 (Revit энэ байрлалыг хийлгэхгүй).
                ExactReport = BlockedReport(offsetMm, fast);
                ExactReportGeneration = Generation;
                Phase = ExactPhase.Final;
            }
            else
            {
                Phase = ExactPhase.Debouncing;
                _exactDueMs = _lastChangeMs + DebounceMs;
            }
            PushVisual();
            _host.Changed();
        }

        /// <summary>Generation нэмж, явж буй ажлыг цуцална.  ЗӨВХӨН дотооддоо.</summary>
        private void Advance()
        {
            Generation++;
            if (_runningGeneration >= 0)
            {
                Timings.CancelledCount++;
                _host.CancelExact(_runningGeneration);
                _runningGeneration = -1;
            }
            // Хуучин дүнг (`ExactReport`) хадгална — бүдэг харуулахад; гэхдээ шинэ generation-ийнх биш тул approve хаалттай.
        }

        /// <summary>Таймерын цохилт (~40 мс).  Debounce дууссан бол яг ОДООГИЙН зорилтод sandbox эхлүүлнэ.</summary>
        public void Tick()
        {
            if (Applying || Phase != ExactPhase.Debouncing || !OffsetMm.HasValue) return;
            if (_host.NowMs < _exactDueMs) return;
            StartExactNow();
        }

        private void StartExactNow()
        {
            PreChangeRequest req = BuildRequest();
            if (req == null) return;
            Phase = ExactPhase.Running;
            _runningGeneration = Generation;
            _exactStartMs = _host.NowMs;
            Timings.ExactCount++;
            _host.StartExact(Generation, req);
            _host.Changed();
        }

        /// <summary>Debounce-гүй, ШУУД дахин шалга (хуучирсан/дүгнэх боломжгүй үед «Дахин шалгах»).</summary>
        public void Recheck()
        {
            if (Applying || !OffsetMm.HasValue || _ctx == null) return;
            Advance();
            LastError = null;
            Notice = null;
            DoorFastResult fast = DoorFastScan.Run(_ctx, OffsetMm.Value);
            Fast = fast;
            if (!fast.CanSimulate)
            {
                ExactReport = fast.Check != null && fast.Check.Code == "no.move" ? null : BlockedReport(OffsetMm.Value, fast);
                ExactReportGeneration = ExactReport != null ? Generation : -1;
                Phase = ExactReport != null ? ExactPhase.Final : ExactPhase.None;
            }
            else StartExactNow();
            PushVisual();
            _host.Changed();
        }

        /* ============================== ҮР ДҮН (host-оос) =================== */

        /// <summary>Түр (Quick) дүн.  ЗӨВХӨН яг ОДООГИЙН generation-ийнх бол.  true = хүлээн авсан.</summary>
        public bool OnExactProvisional(int generation, PreChangeReport report)
        {
            if (!Accepts(generation) || report == null) return CountLate(generation);
            if (Phase == ExactPhase.Final) return false;           // эцсийн дүн аль хэдийн ирсэн
            ExactReport = report;
            ExactReportGeneration = generation;
            Phase = ExactPhase.Provisional;
            Timings.ExactToProvisionalMs = _host.NowMs - _exactStartMs;
            PushVisual();
            _host.Changed();
            return true;
        }

        public bool OnExactFinished(int generation, PreChangeReport report)
        {
            if (!Accepts(generation) || report == null) return CountLate(generation);
            ExactReport = report;
            ExactReportGeneration = generation;
            Phase = ExactPhase.Final;
            _runningGeneration = -1;
            Timings.ExactToFinalMs = _host.NowMs - _exactStartMs;
            PushVisual();
            _host.Changed();
            return true;
        }

        public bool OnExactFailed(int generation, string message, bool cancelled)
        {
            if (cancelled) { if (generation == _runningGeneration) _runningGeneration = -1; return false; }
            if (!Accepts(generation)) return CountLate(generation);
            _runningGeneration = -1;
            LastError = message;
            Phase = ExactPhase.Failed;
            ExactReport = null;
            ExactReportGeneration = -1;
            PushVisual();
            _host.Changed();
            return true;
        }

        private bool Accepts(int generation)
        {
            return !Applying && OffsetMm.HasValue && generation == Generation && (Phase == ExactPhase.Running || Phase == ExactPhase.Provisional);
        }

        private bool CountLate(int generation)
        {
            if (generation != Generation) Timings.LateIgnoredCount++;
            return false;
        }

        /* ============================== ШҮҮЛТҮҮР, ЦЭВЭРЛЭХ ================== */

        /// <summary>Картыг дарах: тухайн бүлгийг л Revit-д тодруулна; `null` = БҮГД.</summary>
        public void SetFilter(ImpactGroup? group)
        {
            Filter = group;
            if (OffsetMm.HasValue && Phase != ExactPhase.None) PushVisual();
            _host.Changed();
        }

        /// <summary>
        /// ЦУЦЛАХ / DISCARD — бодит хаалга хөдлөөгүй (sandbox аль хэдийн буцсан) тул загвар буцаах ХЭРЭГГҮЙ.  Шинжилгээг цуцалж, ghost, тодруулга,
        /// зорилт, түр төлөвийг бүгдийг арилгана.  Зөөлт хэрэгжиж байхад (`Applying`) false.
        /// </summary>
        public bool Discard()
        {
            if (Applying) return false;
            Advance();
            OffsetMm = null;
            Fast = null;
            ExactReport = null;
            ExactReportGeneration = -1;
            Phase = ExactPhase.None;
            LastError = null;
            Filter = null;
            Notice = PreChangeText.SimulationDiscarded;
            _host.ClearVisual();
            _host.Changed();
            return true;
        }

        /* ============================== APPROVE / APPLY ===================== */

        public ApplyGateResult Gate(FreshnessState freshness)
        {
            if (_ctx == null || !OffsetMm.HasValue)
                return new ApplyGateResult { PrimaryLabel = "Эхлээд шинэ байрлал заана", Tone = ApplyTone.Gray };
            if (Applying) return new ApplyGateResult { PrimaryLabel = "Хэрэгжүүлж байна…", Tone = ApplyTone.Gray };
            if (Phase == ExactPhase.Failed)
                return new ApplyGateResult { PrimaryLabel = "Дүгнэх боломжгүй", Tone = ApplyTone.Gray, Hint = LastError, ShowRecheck = true, RecheckLabel = "Дахин шалгах" };
            // ДҮРЭМ №3: яг ЭНЭ зорилтын эцсийн дүн байхгүй бол БОЛОМЖГҮЙ.
            // Зорилт байгаа ч шинжилгээ ажиллахгүй (Apply амжилтгүй болсон гэх мэт) — «шалгаж байна» гэж ХУДАЛ хэлэхгүй, дахин шалгахыг санал болгоно.
            if (Phase == ExactPhase.None)
                return new ApplyGateResult { PrimaryLabel = "Дахин шалгана уу", Tone = ApplyTone.Gray, Hint = Notice, ShowRecheck = true, RecheckLabel = "Дахин шалгах" };
            if (!ExactIsCurrentAndFinal)
                return new ApplyGateResult { PrimaryLabel = "Шинэ байрлалыг шалгаж байна…", Tone = ApplyTone.Gray, Hint = "Эцсийн дүн ирэх хүртэл зөөх боломжгүй." };
            var inp = new ApplyGateInput { Decision = PreChangeDecisionEngine.Decide(ExactReport), Freshness = freshness, DistanceMm = Math.Abs(OffsetMm.Value) };
            ApplyGateResult g = PreChangeApplyGate.Evaluate(inp);
            // Товч «яг юу болохыг» хэлнэ: ТЭМДЭГТЭЙ зай (+300 = ханын төгсгөл рүү, −250 = эхлэл рүү) ба зөөгдөх зүйл — хаалга.
            if (g.PrimaryEnabled)
                g.PrimaryLabel = (inp.Decision.Verdict == MoveVerdict.MoveWithReview ? "Хянаад хаалгыг " : "Хаалгыг ") + DoorMoveView.OffsetLabel(OffsetMm.Value) + " зөөх";
            return g;
        }

        /// <summary>
        /// «Зөөх» дарах: бүх шалгалтыг ДАХИН хийж, ЗӨВХӨН батлагдсан тайланг буцаана (Apply-д дамжуулна).  null → `refusal`-д шалтгаан.
        /// Давхар дарахад хоёр дахь удаа null (Applying).
        /// </summary>
        public PreChangeReport TryBeginApply(FreshnessState freshness, out string refusal)
        {
            refusal = null;
            if (Applying) { refusal = "Хэрэгжүүлж байна — түр хүлээнэ үү."; return null; }
            if (!OffsetMm.HasValue || _ctx == null) { refusal = "Шинэ байрлал заагаагүй байна."; return null; }
            if (!ExactIsCurrentAndFinal) { refusal = "Шинэ байрлалыг шалгаж байна — эцсийн дүн ирсний дараа зөөнө үү."; return null; }
            PreChangeRequest rr = ExactReport.Request;
            if (rr == null || Math.Abs(rr.OffsetMm - OffsetMm.Value) > PreChangeTolerance.LengthMm)
            { refusal = "Шалгасан зай одоогийн зайтай таарахгүй байна — дахин шалгана уу."; return null; }
            ApplyGateResult g = Gate(freshness);
            if (!g.PrimaryEnabled) { refusal = g.Hint ?? "Зөөх боломжгүй."; return null; }
            Applying = true;
            return ExactReport;
        }

        /// <summary>Apply дууссаны дараа.  Амжилттай бол бүх зүйл арилна; хуучирсан бол автоматаар дахин шалгана (зөөгдөөгүй); бусад үед дүн хуучирсан гэж тэмдэглэнэ.</summary>
        public void OnApplied(ApplyOutcome outcome)
        {
            Applying = false;
            if (outcome == null)
            {
                Notice = "Хэрэгжүүлэх үр дүн ирсэнгүй — загварт өөрчлөлт орсон эсэхийг Revit-д шалгана уу.";
                Advance();
                Phase = ExactPhase.None;
                ExactReport = null;
                ExactReportGeneration = -1;
                _host.Changed();
                return;
            }
            if (outcome.Moved)
            {
                Advance();
                OffsetMm = null;
                Fast = null;
                ExactReport = null;
                ExactReportGeneration = -1;
                Phase = ExactPhase.None;
                Filter = null;
                Notice = outcome.Message;
                _host.ClearVisual();
                _host.Changed();
                return;
            }
            if (outcome.Status == ApplyStatus.Stale)
            {
                Notice = PreChangeText.StaleRefreshed;
                Recheck();
                return;
            }
            // Failed / RolledBackMismatch / Cancelled: загвар өөрчлөгдөөгүй, гэхдээ өмнөх дүн итгэлгүй — дахин шалгах хүртэл Approve хаалттай.
            // Ghost, тодруулга ЦЭВЭРЛЭГДЭНЭ (хуучирсан зураглал үлдэхгүй); зорилт хэвээр — «Дахин шалгах» шинэ зураглал үүсгэнэ.
            Advance();
            Notice = outcome.Message;
            ExactReport = null;
            ExactReportGeneration = -1;
            Phase = ExactPhase.None;
            _host.ClearVisual();
            _host.Changed();
        }

        /// <summary>Цонх хаагдах/файл солигдох: ажлыг цуцалж, зураглалыг арилгана.  Идемпотент.</summary>
        public void Close()
        {
            Applying = false;
            Advance();
            OffsetMm = null;
            Phase = ExactPhase.None;
            ExactReport = null;
            ExactReportGeneration = -1;
            _host.ClearVisual();
        }

        /* ============================== ЗУРАГЛАЛ ============================ */

        private void PushVisual()
        {
            if (_ctx == null || !OffsetMm.HasValue) return;
            PreChangeReport cur = CurrentReport;
            bool exact = cur != null;
            List<ImpactEntry> entries = DoorImpactGroups.Build(cur, cur == null ? Fast : null);
            ApplyTone tone;
            if (cur != null && Phase != ExactPhase.Provisional) tone = PreChangeWorkflow.ToneFor(PreChangeDecisionEngine.Decide(cur));
            else tone = Fast != null && (Fast.CriticalCount > 0 || (Fast.Check != null && Fast.Check.Refused)) ? ApplyTone.Red : ApplyTone.Gray;
            var sw = System.Diagnostics.Stopwatch.StartNew();
            _host.ShowVisual(DoorOverlayBuilder.Visual(_ctx, Generation, OffsetMm.Value, tone, entries, Filter, exact));
            Timings.GhostUpdateMs = sw.Elapsed.TotalMilliseconds;
        }

        /// <summary>Тодорхойлогдсон татгалзлын (хостын гадна) эцсийн тайлан — sandbox ХЭРЭГГҮЙ.</summary>
        internal PreChangeReport BlockedReport(double offsetMm, DoorFastResult fast)
        {
            PreChangeRequest req = DoorMoveRequests.Build(_door, offsetMm);
            var input = new PreChangeInput
            {
                Request = req, DocumentTitle = null, Utc = DateTime.UtcNow, Outcome = SandboxOutcome.Rejected,
                // Хостын гадна гэх мэт Revit ХИЙЛГЭХГҮЙ нь тодорхой → «зөөхгүй» (🔴); мэдээлэл дутуу бол «дүгнэх боломжгүй» (⚪).
                Rejection = fast != null && fast.Check != null && fast.Check.Refused ? RejectionKind.Refused : RejectionKind.Unsupported,
                Door = _ctx, Stage = AnalysisStage.Full,
            };
            input.BlockReasons.Add(fast != null && fast.Check != null && !string.IsNullOrWhiteSpace(fast.Check.Problem) ? fast.Check.Problem : "Энэ байрлалд хаалгыг зөөх боломжгүй.");
            return PreChangeDiff.Compute(input);
        }
    }
}
