using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using RevitMcpAddin.ClashCheck.Core;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.ChangeImpact.Core
{
    /// <summary>`PreChangeDiff.Compute`-ийн оролт — Revit-ээс цуглуулсан ХУУЛСАН өгөгдөл.</summary>
    public sealed class PreChangeInput
    {
        public PreChangeRequest Request { get; set; }
        public string DocumentTitle { get; set; }
        public DateTime Utc { get; set; }
        public SandboxOutcome Outcome { get; set; }
        /// <summary>Blocked/Rejected/NotRestored шалтгаан (хүнд ойлгомжтой).</summary>
        public List<string> BlockReasons { get; set; } = new List<string>();
        public List<FailureNote> Failures { get; set; } = new List<FailureNote>();
        public StateSnapshot Before { get; set; }
        public StateSnapshot After { get; set; }
        public PreChangeDependencies Deps { get; set; }
        public PreChangeFingerprint Fingerprint { get; set; }
        public Dictionary<string, long> StageMs { get; set; }
        public List<string> Notes { get; set; } = new List<string>();
        public List<string> ExtraIncompleteReasons { get; set; } = new List<string>();
        /// <summary>Шийдвэрт НӨЛӨӨЛӨХГҮЙ дутагдал (харагдалтын хязгаар, хөрш ханын хязгаар) — «хянах»-ыг л шаарддаг.</summary>
        public List<string> ExtraAdvisoryReasons { get; set; } = new List<string>();
        /// <summary>`Quick` = түр дүн: гүн шалгалтууд (MEP, гарц, орчны зай, хүснэгт, шинээр харагдах харагдац) ХАРААХАН хийгдээгүй.</summary>
        public AnalysisStage Stage { get; set; }
        public List<string> PendingChecks { get; set; } = new List<string>();
        public RejectionKind Rejection { get; set; }
        /// <summary>Хаалга зөөх: хостын геометр, нүх, нэр дэвшигч (кэшлэгдсэн, ХУУЛСАН).  Хана зөөхөд null.</summary>
        public DoorMoveContext Door { get; set; }
    }

    /// <summary>
    /// Шийдвэрт ХЭДЭН ЗЭРЭГ нөлөөлөхийг тодорхойлох дутагдлын цуглуулагч.
    /// `Required` = шаардлагатай шалгалт (өрөө, хэмжээс, хаалга/цонх, MEP, тохируулсан гарц, хамаарлын граф) дутуу → «ДҮГНЭХ БОЛОМЖГҮЙ».
    /// `Advisory` = харагдац/хуудас/хүснэгт гэх мэт — «ХЯНААД ЗӨӨ» (ногоон биш), гэхдээ дүгнэж болохгүй гэсэн үг БИШ.
    /// </summary>
    internal sealed class IncompleteSink
    {
        public readonly List<string> Required = new List<string>();
        public readonly List<string> Advisory = new List<string>();
        public void Req(string text) { if (!string.IsNullOrWhiteSpace(text)) Required.Add(text); }
        public void Adv(string text) { if (!string.IsNullOrWhiteSpace(text)) Advisory.Add(text); }
        public void Req(IEnumerable<string> texts) { if (texts != null) foreach (string t in texts) Req(t); }
        public void Adv(IEnumerable<string> texts) { if (texts != null) foreach (string t in texts) Adv(t); }
    }

    /// <summary>
    /// ӨМНӨ ↔ ДАРАА ялгаа → ТОДОРХОЙЛОГДСОН нөлөөллийн тайлан.  Revit-гүй ЦЭВЭР: тестлэгдэнэ.
    ///
    /// ДҮРМҮҮД (тестээр цоожлогдсон):
    ///   • Хэмжсэн ялгаа л `Confirmed`.  Бодит хамаарал боловч «эвдэрсэн» гэх нотолгоогүй (харагдац, хуудас) = `Review`.
    ///   • Тооцоолоогүй (гарц сонгоогүй, 3D харагдац алга, норм) = `NotEvaluated` — ХЭЗЭЭ Ч «0» биш.
    ///   • Хязгаар/уншигдаагүй/линк/геометр алдаа = `IncompleteReasons` → толгой дүгнэлт ХЭЗЭЭ Ч `Clean` биш.
    ///   • «Шинэ clash» = ДАРАА батлагдсан, ӨМНӨ нь clash биш; өмнө нь байсан = «хуучин».
    /// </summary>
    public static class PreChangeDiff
    {
        public static PreChangeReport Compute(PreChangeInput inp)
        {
            if (inp == null) throw new ArgumentNullException("inp");
            var r = new PreChangeReport
            {
                Utc = inp.Utc == default(DateTime) ? SmartClock.UtcNow : inp.Utc,
                DocumentTitle = inp.DocumentTitle,
                Request = inp.Request,
                Outcome = inp.Outcome,
                Fingerprint = inp.Fingerprint,
                Before = inp.Before,
                After = inp.After,
                StageMs = inp.StageMs ?? new Dictionary<string, long>(),
            };
            r.Notes.AddRange(inp.Notes ?? new List<string>());

            if (inp.Outcome != SandboxOutcome.Simulated)
            {
                BuildBlocked(r, inp);
                return r;
            }

            StateSnapshot before = inp.Before ?? new StateSnapshot();
            StateSnapshot after = inp.After ?? new StateSnapshot();
            PreChangeDependencies deps = inp.Deps ?? new PreChangeDependencies();
            bool quick = inp.Stage == AnalysisStage.Quick;
            r.Stage = inp.Stage;
            r.PendingChecks = quick ? (inp.PendingChecks ?? new List<string>()).ToList() : new List<string>();
            var inc = new IncompleteSink();
            inc.Req(inp.ExtraIncompleteReasons);
            inc.Adv(inp.ExtraAdvisoryReasons);
            inc.Req(before.IncompleteReasons);
            inc.Req(after.IncompleteReasons);
            inc.Adv(before.AdvisoryReasons);
            inc.Adv(after.AdvisoryReasons);
            inc.Req(deps.IncompleteReasons);
            inc.Adv(deps.AdvisoryReasons);
            bool door = PreChangeOperations.Of(inp.Request) == PreChangeOperationKind.DoorMove;
            if (before.SourceDeleted) inc.Req(PreChangeOperations.NounCap(PreChangeOperations.Of(inp.Request)) + " ӨМНӨХ төлөвт загварт олдсонгүй — ялгааг тодорхойлох боломжгүй.");
            if (!before.Captured) inc.Req("Хөдөлгөөний ӨМНӨХ төлөвийг бүрэн уншиж чадсангүй — ялгаа тодорхойлогдсонгүй.");
            if (!after.Captured) inc.Req("Хөдөлгөөний ДАРААХ төлөвийг бүрэн уншиж чадсангүй — ялгаа тодорхойлогдсонгүй.");

            AddFailures(r, inp.Failures);
            AddDeleted(r, after);
            if (door)
            {
                // Хаалга зөөх: хаалга өөрөө, нүх/зам/саад, From/To өрөө, орчны зай — ЗӨВХӨН хаалганд хамаарах хэсэг (DoorMoveDiff).
                // Өрөө, хэмжээс, харагдац/хуудас, хүснэгт, гарц, норм нь доорх ХУВААЛЦСАН код.
                DimensionItems(r, before, after, deps, inc);
                DoorMoveDiff.Build(r, inp, before, after, inc, quick);
                RoomItems(r, before, after, inc);
            }
            else
            {
                SourceItem(r, after);
                RoomItems(r, before, after, inc);
                DimensionItems(r, before, after, deps, inc);
                HostedItems(r, inp.Request, before, after, inc, !quick);
                JoinedItems(r, inp.Request, before, after);
            }
            ViewSheetItems(r, deps, inc, quick);
            if (!quick)
            {
                ScheduleItems(r, before, after, deps, inc);
                if (!door) ClashItems(r, before, after, inc);
                EgressItems(r, before, after, inc);
            }
            AddNorm(r);
            FillCoverage(r, before, after, deps, quick);
            r.DistinctSheetCount = DistinctSheetCount(deps);

            r.RequiredIncomplete = inc.Required.Distinct(StringComparer.Ordinal).ToList();
            r.AdvisoryIncomplete = inc.Advisory.Distinct(StringComparer.Ordinal).Where(a => !r.RequiredIncomplete.Contains(a)).ToList();
            r.IncompleteReasons = r.RequiredIncomplete.Concat(r.AdvisoryIncomplete).ToList();
            r.Items = Order(Dedupe(r.Items));
            r.Level = ComputeLevel(r);
            return r;
        }

        private static void FillCoverage(PreChangeReport r, StateSnapshot before, StateSnapshot after, PreChangeDependencies deps, bool quick)
        {
            bool captured = before.Captured && after.Captured;
            PreChangeCoverage c = r.Coverage;
            c.RoomsChecked = captured;
            c.DimensionsChecked = captured;
            c.ViewsChecked = deps.VisibilityChecked;
            if (quick)
            {
                // Түр дүн: гүн шалгалт хараахан хийгдээгүй — «хийгдсэн» гэж ХЭЗЭЭ Ч тэмдэглэхгүй.
                c.SchedulesChecked = false;
                c.ClashEvaluated = false;
                c.ClashComplete = false;
                c.EgressConfigured = (before.Egress ?? new EgressSnap()).Configured;
                c.EgressEvaluated = false;
                return;
            }
            c.SchedulesChecked = deps.Schedules.Count == 0
                || deps.Schedules.All(s => before.Schedules.ContainsKey(s.Id) && after.Schedules.ContainsKey(s.Id)
                    && before.Schedules[s.Id].Evaluated && after.Schedules[s.Id].Evaluated);
            ClashSnap bc = before.Clash ?? new ClashSnap(), ac = after.Clash ?? new ClashSnap();
            c.ClashEvaluated = bc.Evaluated && ac.Evaluated;
            c.ClashComplete = c.ClashEvaluated && bc.Complete && ac.Complete
                && !ac.Pairs.Values.Any(p => p.Verdict == ClashVerdict.GeometryError || p.Verdict == ClashVerdict.Unsupported)
                && !bc.Pairs.Values.Any(p => p.Verdict == ClashVerdict.GeometryError || p.Verdict == ClashVerdict.Unsupported);
            EgressSnap be = before.Egress ?? new EgressSnap(), ae = after.Egress ?? new EgressSnap();
            c.EgressConfigured = be.Configured;
            c.EgressEvaluated = be.Configured && be.Evaluated && ae.Evaluated
                && be.Routes.Count > 0
                && be.Routes.Keys.All(id => ae.Routes.ContainsKey(id) && be.Routes[id].Evaluated && ae.Routes[id].Evaluated);
        }

        /* ============================== BLOCKED ============================== */

        private static void BuildBlocked(PreChangeReport r, PreChangeInput inp)
        {
            r.Level = AttentionLevel.Blocked;
            r.Rejection = inp.Rejection;
            r.Stage = AnalysisStage.Full;
            r.BlockReasons.AddRange((inp.BlockReasons ?? new List<string>()).Where(s => !string.IsNullOrWhiteSpace(s)));
            foreach (FailureNote f in inp.Failures ?? new List<FailureNote>())
            {
                string t = f.IsError ? "Revit алдаа: " + f.Text : "Revit анхааруулга: " + f.Text;
                if (!r.BlockReasons.Contains(t)) r.BlockReasons.Add(t);
            }
            if (r.BlockReasons.Count == 0)
                r.BlockReasons.Add(inp.Outcome == SandboxOutcome.NotRestored
                    ? "Загварыг анхны төлөвт нь буцаасныг баталгаажуулж чадсангүй."
                    : "Энэ хөдөлгөөнийг хийх боломжгүй.");

            r.Items.Add(new PreChangeItem
            {
                Key = "blocked", Code = ItemCodes.Blocked,
                Category = PreChangeCategory.Failure,
                Truth = TruthState.Confirmed,
                Severity = ItemSeverity.Critical,
                Title = inp.Outcome == SandboxOutcome.NotRestored ? "Загвар буцаагдсан эсэх батлагдсангүй" : "Энэ хөдөлгөөнийг хийх боломжгүй",
                Why = string.Join(" ", r.BlockReasons),
                Kind = ImpactNodeKind.Element,
            });
            foreach (string reason in inp.ExtraIncompleteReasons ?? new List<string>()) r.IncompleteReasons.Add(reason);
            r.IncompleteReasons = r.IncompleteReasons.Distinct(StringComparer.Ordinal).ToList();
            if (inp.Outcome != SandboxOutcome.NotRestored) r.Notes.Add(PreChangeText.ModelUntouched);
        }

        /* ============================== FAILURES ============================= */

        private static void AddFailures(PreChangeReport r, List<FailureNote> failures)
        {
            if (failures == null) return;
            int i = 0;
            foreach (FailureNote f in failures)
            {
                if (f == null || string.IsNullOrWhiteSpace(f.Text)) continue;
                r.Items.Add(new PreChangeItem
                {
                    Key = "failure:" + (i++), Code = f.IsError ? ItemCodes.FailureError : ItemCodes.FailureWarning,
                    Category = PreChangeCategory.Failure,
                    Truth = TruthState.Confirmed,
                    Severity = f.IsError ? ItemSeverity.Critical : ItemSeverity.Notice,
                    Title = f.IsError ? "Revit алдаа" : "Revit анхааруулга",
                    Why = f.Text,
                    Kind = ImpactNodeKind.Element,
                    Id = f.ElementIds != null && f.ElementIds.Count > 0 ? f.ElementIds[0] : 0,
                });
            }
        }

        private static void AddDeleted(PreChangeReport r, StateSnapshot after)
        {
            if (after.DeletedIds == null || after.DeletedIds.Count == 0) return;
            r.Items.Add(new PreChangeItem
            {
                Key = "deleted", Code = ItemCodes.ModelDeleted, Subject = after.DeletedIds.Count.ToString(CultureInfo.InvariantCulture),
                Category = PreChangeCategory.Model,
                Truth = TruthState.Confirmed,
                Severity = ItemSeverity.Critical,
                Title = after.DeletedIds.Count + " элемент устна",
                Why = "Revit энэ хөдөлгөөний үеэр " + after.DeletedIds.Count + " элементийг устгана (регенераци).",
                Kind = ImpactNodeKind.Element,
                BeforeValue = 0,
                AfterValue = after.DeletedIds.Count,
            });
        }

        /// <summary>Хөдөлгөөний дараа ХАНА ӨӨРӨӨ загварт олдохгүй бол — батлагдсан ноцтой.</summary>
        private static void SourceItem(PreChangeReport r, StateSnapshot after)
        {
            if (after == null || !after.Captured || !after.SourceDeleted) return;
            r.Items.Add(new PreChangeItem
            {
                Key = "source:missing", Code = ItemCodes.SourceMissing, Subject = r.Request != null ? r.Request.SourceLabel : null,
                Category = PreChangeCategory.Model, Truth = TruthState.Confirmed, Severity = ItemSeverity.Critical,
                Title = "Хана өөрөө алга болно", Why = "Хөдөлгөөний дараа сонгосон хана загварт олдохгүй байна.",
                Id = r.Request != null ? r.Request.SourceId : 0, Kind = ImpactNodeKind.Element,
            });
        }

        /* ============================== ӨРӨӨ ================================ */

        private static void RoomItems(PreChangeReport r, StateSnapshot before, StateSnapshot after, IncompleteSink incomplete)
        {
            int unreadable = 0, unchangedAdjacent = 0;
            foreach (long id in before.Rooms.Keys.Union(after.Rooms.Keys).OrderBy(x => x))
            {
                RoomSnap b, a;
                before.Rooms.TryGetValue(id, out b);
                after.Rooms.TryGetValue(id, out a);

                if (b != null && a == null)
                {
                    r.Items.Add(RoomItem(b, ItemCodes.RoomRemoved, ItemSeverity.Critical, "Өрөө алга болно", PreChangeText.M2(b.Enclosed ? (double?)b.AreaM2 : null), "алга", null,
                        "Хөдөлгөөний дараа " + b.Label + " өрөө загварт үлдэхгүй.", b.AreaM2, null));
                    continue;
                }
                if (b == null && a != null)
                {
                    r.Items.Add(RoomItem(a, ItemCodes.RoomCreated, ItemSeverity.Warning, "Шинэ өрөө үүснэ", "алга", PreChangeText.M2(a.Enclosed ? (double?)a.AreaM2 : null), null,
                        "Хөдөлгөөний дараа " + a.Label + " өрөө шинээр үүснэ.", null, a.AreaM2));
                    continue;
                }
                if (b == null || a == null) continue;

                if (!b.Readable || !a.Readable) { unreadable++; continue; }

                bool bEnc = b.Placed && b.Enclosed, aEnc = a.Placed && a.Enclosed;
                if (bEnc && !aEnc)
                {
                    string state = !a.Placed ? "хуваарилагдаагүй" : "хаалттай биш";
                    r.Items.Add(RoomItem(a, ItemCodes.RoomUnenclosed, ItemSeverity.Critical, a.Label + " хаалттай орон зай байхаа болино", PreChangeText.M2(b.AreaM2), state,
                        PreChangeText.Unknown,
                        "Хөдөлгөөний дараа " + a.Label + " өрөөний хил хаагдахгүй (Not " + (a.Placed ? "Enclosed" : "Placed") + ") — талбай тооцогдохгүй.", b.AreaM2, null));
                    continue;
                }
                if (!bEnc && aEnc)
                {
                    r.Items.Add(RoomItem(a, ItemCodes.RoomEnclosed, ItemSeverity.Notice, a.Label + " шинээр хаалттай болно", "хаалттай биш", PreChangeText.M2(a.AreaM2), PreChangeText.Unknown,
                        "Өмнө хаалттай биш байсан өрөө хөдөлгөөний дараа хаалттай орон зай болно.", null, a.AreaM2));
                    continue;
                }
                if (!bEnc && !aEnc) continue;

                double d = a.AreaM2 - b.AreaM2;
                if (Math.Abs(d) <= PreChangeTolerance.AreaM2)
                {
                    if (b.BoundedBySource || a.BoundedBySource) unchangedAdjacent++;
                    continue;
                }
                string why = (b.BoundedBySource || a.BoundedBySource)
                    ? "Энэ хана " + a.Label + " өрөөний хилийг үүсгэнэ — хөдөлгөөнөөр талбай өөрчлөгдөнө."
                    : "Хөдөлгөөний дараа " + a.Label + " өрөөний талбай өөрчлөгдөнө.";
                r.Items.Add(RoomItem(a, ItemCodes.RoomArea, ItemSeverity.Warning, a.Label, PreChangeText.M2(b.AreaM2), PreChangeText.M2(a.AreaM2), PreChangeText.DeltaM2(d), why, b.AreaM2, a.AreaM2));
            }

            if (unreadable > 0) incomplete.Req(unreadable + " өрөөний талбайг уншиж чадсангүй — тэдний өөрчлөлт тодорхойлогдоогүй.");
            if (unchangedAdjacent > 0)
                r.Notes.Add(unchangedAdjacent + " зэргэлдээ өрөөний талбай өөрчлөгдөхгүй.");
        }

        private static PreChangeItem RoomItem(RoomSnap room, string code, ItemSeverity sev, string title, string before, string after, string delta, string why, double? bv, double? av)
        {
            return new PreChangeItem
            {
                Key = "room:" + room.Id, Code = code, Subject = room.Label,
                Category = PreChangeCategory.Room,
                Truth = TruthState.Confirmed,
                Severity = sev,
                Title = title,
                Before = before,
                After = after,
                Delta = delta,
                Why = why,
                Id = room.Id,
                Uid = room.Uid,
                Kind = ImpactNodeKind.Room,
                BeforeValue = bv,
                AfterValue = av,
                DeltaValue = bv.HasValue && av.HasValue ? av.Value - bv.Value : (double?)null,
            };
        }

        /* ============================== ХЭМЖЭЭС ============================= */

        private static void DimensionItems(PreChangeReport r, StateSnapshot before, StateSnapshot after, PreChangeDependencies deps, IncompleteSink incomplete)
        {
            int unreadable = 0, unchanged = 0, missingBefore = 0;
            foreach (long id in deps.DimensionIds.Distinct())
                if (!before.Dimensions.ContainsKey(id) && !after.Dimensions.ContainsKey(id)) missingBefore++;
            if (missingBefore > 0) incomplete.Req(missingBefore + " хэмжээсийн утгыг уншиж чадсангүй — ялгаа тодорхойлогдоогүй.");

            foreach (long id in before.Dimensions.Keys.Union(after.Dimensions.Keys).OrderBy(x => x))
            {
                DimSnap b, a;
                before.Dimensions.TryGetValue(id, out b);
                after.Dimensions.TryGetValue(id, out a);
                if (b != null && a == null)
                {
                    r.Items.Add(new PreChangeItem
                    {
                        Key = "dim:" + id, Code = ItemCodes.DimDeleted, Subject = b.Label, Category = PreChangeCategory.Dimension, Truth = TruthState.Confirmed, Severity = ItemSeverity.Critical,
                        Title = b.Label + " устна", Why = "Хөдөлгөөний дараа энэ хэмжээс загварт үлдэхгүй.", Id = id, Uid = b.Uid, Kind = ImpactNodeKind.Dimension,
                    });
                    continue;
                }
                if (b == null || a == null) continue;
                if (!b.Readable || !a.Readable) { unreadable++; continue; }

                if (b.SegmentsMm.Count != a.SegmentsMm.Count)
                {
                    r.Items.Add(new PreChangeItem
                    {
                        Key = "dim:" + id, Code = ItemCodes.DimReview, Subject = a.Label, Category = PreChangeCategory.Dimension, Truth = TruthState.Review, Severity = ItemSeverity.Notice,
                        Title = a.Label, Why = "Хэмжээсийн сегментийн тоо өөрчлөгдөнө (" + b.SegmentsMm.Count + " → " + a.SegmentsMm.Count + ") — гараар хянана уу.",
                        Id = id, Uid = a.Uid, Kind = ImpactNodeKind.Dimension,
                    });
                    continue;
                }

                bool changed = false;
                for (int i = 0; i < b.SegmentsMm.Count; i++)
                    if (!PreChangeTolerance.SameMm(b.SegmentsMm[i], a.SegmentsMm[i])) { changed = true; break; }
                if (!changed) { unchanged++; continue; }

                double bs = b.SegmentsMm.Sum(), asum = a.SegmentsMm.Sum();
                bool multi = b.SegmentsMm.Count > 1;
                r.Items.Add(new PreChangeItem
                {
                    Key = "dim:" + id, Code = ItemCodes.DimChanged, Subject = a.Label,
                    Category = PreChangeCategory.Dimension,
                    Truth = TruthState.Confirmed,
                    Severity = ItemSeverity.Notice,
                    Title = a.Label,
                    Before = multi ? SegmentList(b.SegmentsMm) : PreChangeText.Mm(bs),
                    After = multi ? SegmentList(a.SegmentsMm) : PreChangeText.Mm(asum),
                    Delta = multi ? SegmentDeltas(b.SegmentsMm, a.SegmentsMm) : PreChangeText.DeltaMm(asum - bs),
                    Why = "Хэмжээс энэ " + PreChangeOperations.Accusative(PreChangeOperations.Of(r.Request)) + " (эсвэл түүнээс хамаарах геометрийг) лавласан — утга өөрчлөгдөнө.",
                    Id = id, Uid = a.Uid, Kind = ImpactNodeKind.Dimension,
                    BeforeValue = bs, AfterValue = asum, DeltaValue = asum - bs, ViewType = null,
                });
            }

            if (unreadable > 0) incomplete.Req(unreadable + " хэмжээсийн тоон утгыг уншиж чадсангүй (spot/тусгай хэмжээс) — өөрчлөлт тодорхойлогдоогүй.");
            if (unchanged > 0)
                r.Items.Add(new PreChangeItem
                {
                    Key = "dim:unchanged", Code = ItemCodes.DimUnchanged, Category = PreChangeCategory.Dimension, Truth = TruthState.Review, Severity = ItemSeverity.Ok,
                    Title = unchanged + " хэмжээс лавласан боловч утга өөрчлөгдөхгүй",
                    Why = "Хэмжээс энэ " + PreChangeOperations.Comitative(PreChangeOperations.Of(r.Request)) + " холбоотой, гэхдээ хөдөлгөөнөөс утга нь шилжихгүй.", Kind = ImpactNodeKind.Dimension,
                });
        }

        private static string SegmentList(List<double> seg)
        {
            return string.Join(" · ", seg.Select(v => Math.Round(v).ToString("0", CultureInfo.InvariantCulture))) + " мм";
        }

        private static string SegmentDeltas(List<double> b, List<double> a)
        {
            var parts = new List<string>();
            for (int i = 0; i < b.Count; i++) parts.Add(PreChangeText.DeltaMm(a[i] - b[i]));
            return string.Join(" · ", parts);
        }

        /* ============================== ХАЛГА / ЦОНХ ======================= */

        private static void HostedItems(PreChangeReport r, PreChangeRequest req, StateSnapshot before, StateSnapshot after, IncompleteSink incomplete, bool includeClearance)
        {
            double[] vec = req != null ? req.VectorMm : null;
            int clearanceNotEvaluated = 0;
            string clearanceNote = null;
            foreach (long id in before.Hosted.Keys.Union(after.Hosted.Keys).OrderBy(x => x))
            {
                HostedSnap b, a;
                before.Hosted.TryGetValue(id, out b);
                after.Hosted.TryGetValue(id, out a);

                if (b != null && b.Exists && (a == null || !a.Exists))
                {
                    r.Items.Add(new PreChangeItem
                    {
                        Key = "host:" + id, Code = ItemCodes.HostDeleted, Subject = b.Label, Category = PreChangeCategory.Hosted, Truth = TruthState.Confirmed, Severity = ItemSeverity.Critical,
                        Title = b.Label + " устна", Why = "Хөдөлгөөний дараа энэ хаалга/цонх загварт үлдэхгүй.", Id = id, Uid = b.Uid, Kind = ImpactNodeKind.Element,
                    });
                    continue;
                }
                if (b == null || a == null || !b.Exists || !a.Exists) continue;

                // Хост алдсан = хаалга/цонх энэ ханаас салсан (өөр хост эсвэл хостгүй).  Хост уншигдаагүй бол «алдсан» гэж ТООЦОХГҮЙ.
                if (b.HostKnown && a.HostKnown && b.HostId != a.HostId && (req == null || b.HostId == req.SourceId))
                {
                    r.Items.Add(new PreChangeItem
                    {
                        Key = "hostlost:" + id, Code = ItemCodes.HostLost, Subject = b.Label, Category = PreChangeCategory.Hosted, Truth = TruthState.Confirmed, Severity = ItemSeverity.Critical,
                        Title = b.Label + " ханаасаа сална", Why = "Хөдөлгөөний дараа энэ хаалга/цонх хостоо алдаж, ханатай холбоогүй болно.",
                        Id = id, Uid = a.Uid, Kind = ImpactNodeKind.Element,
                    });
                    continue;
                }

                double[] disp = PreChangeTolerance.DiffMm(b.LocationMm, a.LocationMm);
                if (disp == null)
                {
                    incomplete.Req("Хаалга/цонхны байрлалыг уншиж чадсангүй — хамт хөдөлсөн эсэх тодорхойлогдоогүй.");
                }
                else if (PreChangeTolerance.LengthOfMm(disp) > PreChangeTolerance.LengthMm)
                {
                    bool with = PreChangeTolerance.SameVectorMm(disp, vec);
                    double len = PreChangeTolerance.LengthOfMm(disp);
                    r.Items.Add(new PreChangeItem
                    {
                        Key = "host:" + id, Code = with ? ItemCodes.HostMoved : ItemCodes.HostDisplaced, Subject = b.Label,
                        Category = PreChangeCategory.Hosted,
                        Truth = TruthState.Confirmed,
                        Severity = with ? ItemSeverity.Ok : ItemSeverity.Warning,
                        Title = b.Label,
                        Before = "байрлал өөрчлөгдөөгүй",
                        After = "хөдөлнө",
                        Delta = PreChangeText.Mm(len),
                        Why = with
                            ? "Ханатайгаа хамт " + PreChangeText.Mm(len) + " хөдөлнө (хост) — энэ нь өөрөө нормын зөрчил биш."
                            : "Ханаас ӨӨР хэмжээгээр (" + PreChangeText.Mm(len) + ") хөдөлнө — хостын хэлбэр/нүх өөрчлөгдөж байна, гараар хянана уу.",
                        Id = id, Uid = a.Uid, Kind = ImpactNodeKind.Element, DeltaValue = len,
                    });
                }

                if (b.RoomsReadable && a.RoomsReadable && (b.FromRoomId != a.FromRoomId || b.ToRoomId != a.ToRoomId))
                {
                    r.Items.Add(new PreChangeItem
                    {
                        Key = "host-rooms:" + id, Code = ItemCodes.HostRooms, Subject = b.Label, Category = PreChangeCategory.Hosted, Truth = TruthState.Confirmed, Severity = ItemSeverity.Notice,
                        Title = b.Label + " — өрөөнүүд",
                        Before = RoomPair(b), After = RoomPair(a),
                        Why = "Хаалганы хоёр талын өрөө (From/To) өөрчлөгдөнө — хүснэгт, tag шинэчлэгдэх шаардлагатай.",
                        Id = id, Uid = a.Uid, Kind = ImpactNodeKind.Element,
                    });
                }

                if (!includeClearance) continue;
                if (b.ClearanceEvaluated && a.ClearanceEvaluated && b.ClearanceMm.HasValue && a.ClearanceMm.HasValue)
                {
                    double cd = a.ClearanceMm.Value - b.ClearanceMm.Value;
                    if (Math.Abs(cd) > PreChangeTolerance.LengthMm)
                        r.Items.Add(new PreChangeItem
                        {
                            Key = "clr:" + id, Code = ItemCodes.ClearanceChanged, Subject = b.Label, Category = PreChangeCategory.Clearance, Truth = TruthState.Confirmed,
                            Severity = cd < 0 ? ItemSeverity.Warning : ItemSeverity.Notice,
                            Title = b.Label + " — хаалганы орчны зай",
                            Before = PreChangeText.Mm(b.ClearanceMm), After = PreChangeText.Mm(a.ClearanceMm), Delta = PreChangeText.DeltaMm(cd),
                            Why = "Хамгийн ойрын саад хүртэлх зай (геометрээр хэмжсэн). Энэ нь нормын шалгалт БИШ.",
                            Id = id, Uid = a.Uid, Kind = ImpactNodeKind.Element, BeforeValue = b.ClearanceMm, AfterValue = a.ClearanceMm, DeltaValue = cd,
                        });
                }
                else
                {
                    clearanceNotEvaluated++;
                    if (clearanceNote == null) clearanceNote = a.ClearanceNote ?? b.ClearanceNote;
                }
            }

            if (includeClearance && clearanceNotEvaluated > 0)
                r.Items.Add(new PreChangeItem
                {
                    Key = "clr:ne", Code = ItemCodes.ClearanceNe, Category = PreChangeCategory.Clearance, Truth = TruthState.NotEvaluated, Severity = ItemSeverity.Ok,
                    Title = "Хаалганы орчны зай: тооцоолоогүй",
                    Why = (string.IsNullOrWhiteSpace(clearanceNote) ? "Найдвартай хэмжих геометр олдсонгүй." : clearanceNote) + " (" + clearanceNotEvaluated + " хаалга/цонх)",
                    Kind = ImpactNodeKind.Element,
                });
        }

        private static string RoomPair(HostedSnap h)
        {
            return (string.IsNullOrEmpty(h.FromRoomName) ? "гадна" : h.FromRoomName) + " → " + (string.IsNullOrEmpty(h.ToRoomName) ? "гадна" : h.ToRoomName);
        }

        private static void JoinedItems(PreChangeReport r, PreChangeRequest req, StateSnapshot before, StateSnapshot after)
        {
            foreach (long id in before.Joined.Keys.OrderBy(x => x))
            {
                ElementPlace b = before.Joined[id], a;
                if (!after.Joined.TryGetValue(id, out a)) continue;
                if (b.Location == null || a.Location == null || b.Location.Length != a.Location.Length) continue;
                bool moved = false;
                double maxd = 0;
                for (int i = 0; i < b.Location.Length; i++)
                {
                    double d = Math.Abs(b.Location[i] - a.Location[i]);
                    if (d > PreChangeTolerance.LengthMm) moved = true;
                    if (d > maxd) maxd = d;
                }
                if (!moved) continue;
                r.Items.Add(new PreChangeItem
                {
                    Key = "joined:" + id, Code = ItemCodes.JoinedMoved, Subject = string.IsNullOrEmpty(b.Name) ? "Холбогдсон хана" : b.Name, Category = PreChangeCategory.Hosted, Truth = TruthState.Confirmed, Severity = ItemSeverity.Notice,
                    Title = (string.IsNullOrEmpty(b.Name) ? "Холбогдсон хана" : b.Name) + " · #" + id,
                    Before = "анхны байрлал", After = "өөрчлөгдөнө", Delta = PreChangeText.Mm(maxd),
                    Why = "Холбогдсон (join) хөрш хана ханатайгаа хамт өөрчлөгдөнө.", Id = id, Uid = b.Uid, Kind = ImpactNodeKind.Element, DeltaValue = maxd,
                });
            }
        }

        /* ============================== ХАРАГДАЦ / ХУУДАС =================== */

        private static void ViewSheetItems(PreChangeReport r, PreChangeDependencies deps, IncompleteSink incomplete, bool quick)
        {
            if (!deps.VisibilityChecked)
                incomplete.Adv("Харагдалтыг шалгаагүй — аль харагдацад харагдах нь тодорхойлогдоогүй (хуудасны тоо бүрэн биш).");
            else if (!deps.AfterVisibilityChecked && !quick)
                incomplete.Adv("Хөдөлсний ДАРАА шинээр харагдах харагдацыг бүрэн шалгаагүй — зөвхөн одоогийн харагдалтаар.");

            foreach (DepNode v in deps.Views.GroupBy(x => x.Id).Select(g => g.OrderBy(x => ImpactConf.Rank(x.Confidence)).First()))
            {
                r.Items.Add(new PreChangeItem
                {
                    Key = "view:" + v.Id, Code = ItemCodes.View, Subject = v.Name, Category = PreChangeCategory.View, Truth = TruthState.Review, Severity = ItemSeverity.Notice,
                    Title = v.Name, Why = v.Reason ?? "Харагдацад хамаарна", Id = v.Id, Uid = v.Uid, Kind = ImpactNodeKind.View,
                    Confidence = ImpactConf.Normalize(v.Confidence), ViewType = v.ViewType, SheetNumber = SheetsOf(deps, v),
                });
            }

            foreach (DepNode s in deps.Sheets.GroupBy(x => x.Id).Select(g => g.OrderBy(x => ImpactConf.Rank(x.Confidence)).First()))
            {
                r.Items.Add(new PreChangeItem
                {
                    Key = "sheet:" + s.Id, Code = ItemCodes.Sheet, Subject = s.SheetNumber ?? s.Name, Category = PreChangeCategory.Sheet, Truth = TruthState.Review, Severity = ItemSeverity.Notice,
                    Title = s.SheetNumber != null ? s.SheetNumber + (string.IsNullOrEmpty(s.Name) ? "" : " " + s.Name) : s.Name,
                    Why = s.Reason ?? "Хуудсанд байрласан харагдац нөлөөлөгдөнө", Id = s.Id, Uid = s.Uid, Kind = ImpactNodeKind.Sheet,
                    Confidence = ImpactConf.Normalize(s.Confidence), SheetNumber = s.SheetNumber,
                });
            }

            if (deps.Tags.Count > 0)
                r.Items.Add(new PreChangeItem
                {
                    Key = "tags", Code = ItemCodes.Tags, Category = PreChangeCategory.View, Truth = TruthState.Review, Severity = ItemSeverity.Ok,
                    Title = deps.Tags.Select(t => t.Id).Distinct().Count() + " tag энэ " + PreChangeOperations.Comitative(PreChangeOperations.Of(r.Request)) + " холбоотой",
                    Why = "Tag-ийн байрлал/текст шинэчлэгдэх эсэхийг харагдацаа нээж хянана уу.", Kind = ImpactNodeKind.Tag,
                    AfterValue = deps.Tags.Select(t => t.Id).Distinct().Count(),
                });
        }

        private static string SheetsOf(PreChangeDependencies deps, DepNode v)
        {
            if (v.SheetIds == null || v.SheetIds.Count == 0) return null;
            var nums = deps.Sheets.Where(s => v.SheetIds.Contains(s.Id)).Select(s => s.SheetNumber).Where(n => !string.IsNullOrEmpty(n)).Distinct().OrderBy(n => n, StringComparer.CurrentCultureIgnoreCase);
            string joined = string.Join(", ", nums);
            return joined.Length == 0 ? null : joined;
        }

        /// <summary>Нөлөөлөгдөх ДАВХАРДАЛГҮЙ хуудасны тоо — хуудас руу хүрсэн бүх зам (харагдац, хүснэгт) нэгдэнэ.</summary>
        public static int DistinctSheetCount(PreChangeDependencies deps)
        {
            if (deps == null) return 0;
            var ids = new HashSet<long>(deps.Sheets.Select(s => s.Id));
            foreach (DepNode v in deps.Views) foreach (long s in v.SheetIds ?? new List<long>()) ids.Add(s);
            foreach (DepNode v in deps.Schedules) foreach (long s in v.SheetIds ?? new List<long>()) ids.Add(s);
            return ids.Count;
        }

        /* ============================== ХҮСНЭГТ ============================= */

        private static void ScheduleItems(PreChangeReport r, StateSnapshot before, StateSnapshot after, PreChangeDependencies deps, IncompleteSink incomplete)
        {
            foreach (DepNode s in deps.Schedules.GroupBy(x => x.Id).Select(g => g.OrderBy(x => ImpactConf.Rank(x.Confidence)).First()))
            {
                ScheduleSnap b, a;
                before.Schedules.TryGetValue(s.Id, out b);
                after.Schedules.TryGetValue(s.Id, out a);
                bool evaluated = b != null && a != null && b.Evaluated && a.Evaluated;

                if (evaluated)
                {
                    var entered = a.Members.Where(m => !b.Members.Contains(m)).ToList();
                    var left = b.Members.Where(m => !a.Members.Contains(m)).ToList();
                    if (entered.Count > 0 || left.Count > 0)
                    {
                        r.Items.Add(new PreChangeItem
                        {
                            Key = "sched:" + s.Id, Code = ItemCodes.ScheduleChanged, Subject = s.Name, Category = PreChangeCategory.Schedule, Truth = TruthState.Confirmed, Severity = ItemSeverity.Notice,
                            Title = s.Name,
                            Before = b.Members.Count + " мөр", After = a.Members.Count + " мөр",
                            Delta = (entered.Count > 0 ? entered.Count + " орно" : "") + (entered.Count > 0 && left.Count > 0 ? ", " : "") + (left.Count > 0 ? left.Count + " гарна" : ""),
                            Why = "Хүснэгтийн мөрөнд ордог элемент өөрчлөгдөнө (Revit-ээс хэмжсэн).", Id = s.Id, Uid = s.Uid, Kind = ImpactNodeKind.Schedule,
                            Confidence = ImpactConf.Normalize(s.Confidence), SheetNumber = SheetsOf(deps, s),
                        });
                        continue;
                    }
                }

                // Гишүүнчлэл ӨӨРЧЛӨГДӨӨГҮЙ эсвэл шалгаж чадаагүй — хуудсанд байрласан хүснэгтийн утга өөрчлөгдөж болох → ХЯНАХ (батлагдаагүй).
                string why = evaluated
                    ? "Элемент хүснэгтэд байсаар — гэхдээ хүснэгтийн утга (хаалганы өрөө, талбай...) өөрчлөгдөж болно: хянана уу."
                    : "Хүснэгтийн мөрийг (элементээр) шалгаж чадсангүй — хамаарал " + ImpactConf.Letter(s.Confidence) + " итгэлтэй, хянана уу.";
                r.Items.Add(new PreChangeItem
                {
                    Key = "sched:" + s.Id, Code = evaluated ? ItemCodes.ScheduleReview : ItemCodes.ScheduleNe, Subject = s.Name, Category = PreChangeCategory.Schedule, Truth = evaluated ? TruthState.Review : TruthState.NotEvaluated,
                    Severity = ItemSeverity.Ok, Title = s.Name, Why = why, Id = s.Id, Uid = s.Uid, Kind = ImpactNodeKind.Schedule,
                    Confidence = ImpactConf.Normalize(s.Confidence), SheetNumber = SheetsOf(deps, s),
                });
                if (!evaluated) incomplete.Adv("Зарим хүснэгтийн мөрийг (элементээр) ӨМНӨ/ДАРАА харьцуулж чадсангүй — хүснэгтийн гишүүнчлэл тодорхойлогдоогүй.");
            }
        }

        /* ============================== MEP CLASH =========================== */

        /// <summary>«Харуулах» товчны id: host-ын элемент бол өөрөө, линк доторх бол ЛИНК instance (линк доторх элементийг host-д сонгох боломжгүй).</summary>
        private static long ShowId(ClashPairState p)
        {
            return string.IsNullOrEmpty(p.OtherLink) ? p.OtherId : p.OtherLinkInstanceId;
        }

        private static void ClashItems(PreChangeReport r, StateSnapshot before, StateSnapshot after, IncompleteSink incomplete)
        {
            ClashSnap b = before.Clash ?? new ClashSnap(), a = after.Clash ?? new ClashSnap();
            if (!b.Evaluated || !a.Evaluated)
            {
                string reason = !string.IsNullOrWhiteSpace(a.NotEvaluatedReason) ? a.NotEvaluatedReason : b.NotEvaluatedReason;
                r.Items.Add(new PreChangeItem
                {
                    Key = "clash:ne", Code = ItemCodes.ClashNe, Category = PreChangeCategory.Clash, Truth = TruthState.NotEvaluated, Severity = ItemSeverity.Ok,
                    Title = "MEP clash: тооцоолоогүй",
                    Why = string.IsNullOrWhiteSpace(reason) ? "MEP шалгалт хийгдсэнгүй." : reason, Kind = ImpactNodeKind.Element,
                });
                // MEP-ийн шалгалт хийгдээгүй бол «шинэ clash байхгүй» гэж батлах боломжгүй → ШААРДЛАГАТАЙ шалгалтын дутагдал.
                incomplete.Req("MEP clash шалгалт хийгдсэнгүй" + (string.IsNullOrWhiteSpace(reason) ? "." : ": " + reason));
                return;
            }

            incomplete.Req(b.IncompleteReasons);
            incomplete.Req(a.IncompleteReasons);
            int geoErr = a.Pairs.Values.Count(p => p.Verdict == ClashVerdict.GeometryError || p.Verdict == ClashVerdict.Unsupported)
                       + b.Pairs.Values.Count(p => p.Verdict == ClashVerdict.GeometryError || p.Verdict == ClashVerdict.Unsupported);
            if (geoErr > 0) incomplete.Req(geoErr + " MEP хосыг геометрээр шалгаж чадсангүй — «clash байхгүй» гэж батлах боломжгүй.");

            int newCount = 0;
            foreach (ClashPairState p in a.Pairs.Values.Where(x => x.Verdict == ClashVerdict.ConfirmedClash).OrderBy(x => x.Key, StringComparer.Ordinal))
            {
                ClashPairState bp;
                b.Pairs.TryGetValue(p.Key, out bp);
                bool wasClash = bp != null && bp.Verdict == ClashVerdict.ConfirmedClash;
                bool knownClean = bp == null || bp.Verdict == ClashVerdict.NoClash;
                if (wasClash)
                {
                    r.Items.Add(new PreChangeItem
                    {
                        Key = "clash:" + p.Key, Code = ItemCodes.ClashOld, Subject = p.OtherLabel, Category = PreChangeCategory.Clash, Truth = TruthState.Confirmed, Severity = ItemSeverity.Ok,
                        Title = "Хуучин clash · " + p.OtherLabel, Why = "Энэ clash хөдөлгөөнөөс ӨМНӨ ч байсан (хөдөлгөөнөөс үл хамаарна).",
                        Id = ShowId(p), Kind = ImpactNodeKind.Element,
                    });
                }
                else if (knownClean)
                {
                    newCount++;
                    r.Items.Add(new PreChangeItem
                    {
                        Key = "clash:" + p.Key, Code = ItemCodes.ClashNew, Subject = p.OtherLabel, Category = PreChangeCategory.Clash, Truth = TruthState.Confirmed, Severity = ItemSeverity.Critical,
                        Title = "Шинэ clash · " + p.OtherLabel, After = Math.Round(p.VolumeCm3, 1).ToString("0.#", CultureInfo.InvariantCulture) + " см³",
                        Before = "clash байхгүй",
                        Why = "Хана хөдөлсний дараа энэ элементтэй геометрээр огтлолцоно" + (string.IsNullOrEmpty(p.OtherLink) ? "." : " (линк: " + p.OtherLink + " — «Харуулах» нь линк загварыг сонгоно).")
                            + (bp == null ? " Өмнө нь энэ хос огтлолцоогүй." : ""),
                        Id = ShowId(p), Kind = ImpactNodeKind.Element, AfterValue = p.VolumeCm3,
                    });
                }
                else
                {
                    r.Items.Add(new PreChangeItem
                    {
                        Key = "clash:" + p.Key, Code = ItemCodes.ClashUnknown, Subject = p.OtherLabel, Category = PreChangeCategory.Clash, Truth = TruthState.Review, Severity = ItemSeverity.Warning,
                        Title = "Clash · " + p.OtherLabel,
                        Why = "Хөдөлгөөний дараа огтлолцож байна, гэхдээ ӨМНӨ ТӨЛӨВИЙГ шалгаж чадаагүй тул шинэ эсэхийг батлах боломжгүй.",
                        Id = ShowId(p), Kind = ImpactNodeKind.Element, AfterValue = p.VolumeCm3,
                    });
                }
            }

            foreach (ClashPairState p in b.Pairs.Values.Where(x => x.Verdict == ClashVerdict.ConfirmedClash).OrderBy(x => x.Key, StringComparer.Ordinal))
            {
                ClashPairState ap;
                if (a.Pairs.TryGetValue(p.Key, out ap) && ap.Verdict == ClashVerdict.NoClash)
                    r.Items.Add(new PreChangeItem
                    {
                        Key = "clash:resolved:" + p.Key, Code = ItemCodes.ClashResolved, Subject = p.OtherLabel, Category = PreChangeCategory.Clash, Truth = TruthState.Confirmed, Severity = ItemSeverity.Ok,
                        Title = "Clash арилна · " + p.OtherLabel, Why = "Хөдөлгөөний дараа өмнө нь байсан огтлолцол арилна.", Id = ShowId(p), Kind = ImpactNodeKind.Element,
                    });
            }

            bool complete = b.Complete && a.Complete && geoErr == 0;
            if (newCount == 0 && complete)
                r.Items.Add(new PreChangeItem
                {
                    Key = "clash:none", Code = ItemCodes.ClashNone, Category = PreChangeCategory.Clash, Truth = TruthState.Confirmed, Severity = ItemSeverity.Ok,
                    Title = "Шинэ MEP clash илрээгүй", BeforeValue = 0, AfterValue = 0,
                    Why = "MEP нэр дэвшигч бүгд шалгагдсан (линк ачаалагдсан, геометр алдаагүй).", Kind = ImpactNodeKind.Element,
                });
            else if (newCount == 0)
                r.Items.Add(new PreChangeItem
                {
                    Key = "clash:incomplete", Code = ItemCodes.ClashIncomplete, Category = PreChangeCategory.Clash, Truth = TruthState.Incomplete, Severity = ItemSeverity.Notice,
                    Title = "MEP шалгалт бүрэн биш — «clash байхгүй» гэж батлах боломжгүй",
                    Why = string.Join(" ", b.IncompleteReasons.Concat(a.IncompleteReasons).Distinct()), Kind = ImpactNodeKind.Element,
                });
        }

        /// <summary>Шинэ (батлагдсан) clash-ийн тоо — карт, тест.</summary>
        public static int NewClashCount(PreChangeReport r)
        {
            return r.Items.Count(i => i.Category == PreChangeCategory.Clash && i.Truth == TruthState.Confirmed && i.Severity == ItemSeverity.Critical);
        }

        /* ============================== ГАРЦ ================================ */

        private static void EgressItems(PreChangeReport r, StateSnapshot before, StateSnapshot after, IncompleteSink incomplete)
        {
            EgressSnap b = before.Egress ?? new EgressSnap(), a = after.Egress ?? new EgressSnap();
            if (!b.Configured)
            {
                r.Items.Add(new PreChangeItem
                {
                    Key = "egress:ne", Code = ItemCodes.EgressNotConfigured, Category = PreChangeCategory.Egress, Truth = TruthState.NotEvaluated, Severity = ItemSeverity.Ok,
                    Title = PreChangeText.EgressNotConfigured,
                    Why = "Гарц болох хаалгыг «Гарц сонгох»-оор нэг удаа тохируулна. Хаалганы нэрээр таамаглахгүй.", Kind = ImpactNodeKind.Element,
                });
                return;
            }
            if (!b.Evaluated || !a.Evaluated)
            {
                string reason = !string.IsNullOrWhiteSpace(a.NotEvaluatedReason) ? a.NotEvaluatedReason : b.NotEvaluatedReason;
                r.Items.Add(new PreChangeItem
                {
                    Key = "egress:ne", Code = ItemCodes.EgressNe, Category = PreChangeCategory.Egress, Truth = TruthState.NotEvaluated, Severity = ItemSeverity.Ok,
                    Title = "Гарцын зам: тооцоолоогүй", Why = string.IsNullOrWhiteSpace(reason) ? "Замын тооцоо хийгдсэнгүй." : reason, Kind = ImpactNodeKind.Element,
                });
                // Гарц ТОХИРУУЛСАН хэрнээ тооцоо унасан = техникийн шалгалтын дутагдал (тохируулаагүйтэй адилгүй).
                incomplete.Req(b.IncompleteReasons);
                incomplete.Req(a.IncompleteReasons);
                incomplete.Req("Тохируулсан гарцын замыг тооцоолж чадсангүй" + (string.IsNullOrWhiteSpace(reason) ? "." : ": " + reason));
                return;
            }

            incomplete.Req(b.IncompleteReasons);
            incomplete.Req(a.IncompleteReasons);
            int notComputed = 0;
            bool any = false;
            foreach (long id in b.Routes.Keys.Union(a.Routes.Keys).OrderBy(x => x))
            {
                EgressRoute br, ar;
                b.Routes.TryGetValue(id, out br);
                a.Routes.TryGetValue(id, out ar);
                if (br == null || ar == null || !br.Evaluated || !ar.Evaluated) { notComputed++; continue; }
                any = true;
                string name = ar.RoomName ?? br.RoomName ?? "Өрөө #" + id;

                if (br.LengthM.HasValue && !ar.LengthM.HasValue)
                {
                    r.Items.Add(EgressItem(id, name, ItemCodes.EgressLost, ItemSeverity.Critical, "Гарцын зам боломжгүй болно", PreChangeText.M(br.LengthM), "зам олдсонгүй", null,
                        "Хөдөлгөөний дараа " + name + " өрөөнөөс сонгосон гарц руу зам олдохгүй.", br.LengthM, null));
                }
                else if (!br.LengthM.HasValue && ar.LengthM.HasValue)
                {
                    r.Items.Add(EgressItem(id, name, ItemCodes.EgressGained, ItemSeverity.Notice, "Гарцын зам боломжтой болно", "зам олдоогүй", PreChangeText.M(ar.LengthM), null,
                        "Өмнө нь зам олдоогүй байсан өрөөнөөс гарц руу зам нээгдэнэ.", null, ar.LengthM));
                }
                else if (!br.LengthM.HasValue && !ar.LengthM.HasValue)
                {
                    r.Items.Add(EgressItem(id, name, ItemCodes.EgressUnreachable, ItemSeverity.Warning, "Гарцын зам өмнө ч, дараа ч олдохгүй", "зам олдоогүй", "зам олдоогүй", null,
                        "Энэ өрөөнөөс гарц руу зам олдсонгүй (хөдөлгөөнөөс үл хамаарна) — Path of Travel-ийн үр дүн.", null, null));
                }
                else
                {
                    double d = ar.LengthM.Value - br.LengthM.Value;
                    if (Math.Abs(d) <= PreChangeTolerance.RouteM) continue;
                    r.Items.Add(EgressItem(id, name, ItemCodes.EgressChanged, d > 0 ? ItemSeverity.Notice : ItemSeverity.Ok, "Гарцын зам", PreChangeText.M(br.LengthM), PreChangeText.M(ar.LengthM), PreChangeText.DeltaM(d),
                        "Сонгосон гарц хүртэлх хамгийн богино зам (Revit Path of Travel). Хууль тогтоосон дээд хязгаартай тулгаагүй.", br.LengthM, ar.LengthM));
                }
            }

            if (notComputed > 0)
                incomplete.Req(notComputed + " өрөөнөөс гарц хүртэлх замыг тооцоолж чадсангүй — гарцын шалгалт бүрэн биш.");
            if (!any && notComputed == 0)
                r.Notes.Add("Гарцын замд нөлөөлөх өрөө олдсонгүй.");
        }

        private static PreChangeItem EgressItem(long roomId, string room, string code, ItemSeverity sev, string title, string before, string after, string delta, string why, double? bv, double? av)
        {
            return new PreChangeItem
            {
                Key = "egress:" + roomId, Code = code, Subject = room, Category = PreChangeCategory.Egress, Truth = TruthState.Confirmed, Severity = sev,
                Title = title + " · " + room, Before = before, After = after, Delta = delta, Why = why, Id = roomId, Kind = ImpactNodeKind.Room,
                BeforeValue = bv, AfterValue = av, DeltaValue = bv.HasValue && av.HasValue ? av.Value - bv.Value : (double?)null,
            };
        }

        /* ============================== НОРМ ================================ */

        private static void AddNorm(PreChangeReport r)
        {
            r.Items.Add(new PreChangeItem
            {
                Key = "norm", Code = ItemCodes.NormNe, Category = PreChangeCategory.Norm, Truth = TruthState.NotEvaluated, Severity = ItemSeverity.Ok,
                Title = "Нормын автомат шалгалт: тооцоолоогүй",
                Why = PreChangeText.NormNotEvaluated + " (Хууль, норм зохиож таамаглахгүй.)", Kind = ImpactNodeKind.Global,
            });
        }

        /* ============================== LEVEL / ORDER ======================= */

        public static AttentionLevel ComputeLevel(PreChangeReport r)
        {
            if (r.Outcome != SandboxOutcome.Simulated) return AttentionLevel.Blocked;
            bool critical = r.Items.Any(i => i.Truth == TruthState.Confirmed && i.Severity == ItemSeverity.Critical);
            if (critical) return AttentionLevel.Critical;

            bool changes = r.Items.Any(i =>
                (i.Truth == TruthState.Confirmed && i.Severity >= ItemSeverity.Notice)
                || (i.Truth == TruthState.Review && i.Severity >= ItemSeverity.Notice)
                || (i.Truth == TruthState.Incomplete));
            bool unresolved = r.Items.Any(i => i.Truth == TruthState.Review && i.Severity >= ItemSeverity.Warning);
            if (changes || unresolved || r.Incomplete) return AttentionLevel.Review;
            return AttentionLevel.Clean;
        }

        private static List<PreChangeItem> Dedupe(List<PreChangeItem> items)
        {
            var seen = new HashSet<string>(StringComparer.Ordinal);
            var res = new List<PreChangeItem>();
            foreach (PreChangeItem i in items)
            {
                if (!string.IsNullOrEmpty(i.Key) && !seen.Add(i.Key)) continue;
                res.Add(i);
            }
            return res;
        }

        private static int CategoryOrder(PreChangeCategory c)
        {
            switch (c)
            {
                case PreChangeCategory.Failure: return 0;
                case PreChangeCategory.Model: return 1;
                case PreChangeCategory.Clash: return 2;
                case PreChangeCategory.Obstacle: return 2;
                case PreChangeCategory.Egress: return 3;
                case PreChangeCategory.Room: return 4;
                case PreChangeCategory.Opening: return 5;
                case PreChangeCategory.Hosted: return 5;
                case PreChangeCategory.Clearance: return 6;
                case PreChangeCategory.Dimension: return 7;
                case PreChangeCategory.Sheet: return 8;
                case PreChangeCategory.View: return 9;
                case PreChangeCategory.Schedule: return 10;
                default: return 11;
            }
        }

        private static List<PreChangeItem> Order(List<PreChangeItem> items)
        {
            return items
                .OrderByDescending(i => (int)i.Severity)
                .ThenBy(i => TruthOrder(i.Truth))
                .ThenBy(i => CategoryOrder(i.Category))
                .ThenBy(i => i.Title ?? "", StringComparer.CurrentCultureIgnoreCase)
                .ToList();
        }

        private static int TruthOrder(TruthState t)
        {
            switch (Truth.Normalize(t))
            {
                case TruthState.Confirmed: return 0;
                case TruthState.Review: return 1;
                case TruthState.Incomplete: return 2;
                default: return 3;
            }
        }
    }
}
