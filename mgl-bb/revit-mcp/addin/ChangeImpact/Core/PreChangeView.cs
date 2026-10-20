using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using RevitMcpAddin.ClashCheck.Core;

namespace RevitMcpAddin.ChangeImpact.Core
{
    /// <summary>Тэргүүн 3 үр дагаврын нэг мөр: «Оффис 203   24.8 → 22.9 м²   −1.9 м²».</summary>
    public sealed class ConsequenceRow
    {
        public string Key { get; set; }
        public string Label { get; set; }
        public string Before { get; set; }
        public string After { get; set; }
        public string Delta { get; set; }
        public string Detail { get; set; }
        public ItemSeverity Tone { get; set; }
        public PreChangeCategory Category { get; set; }
        public string ItemKey { get; set; }
        public long Id { get; set; }
        public ImpactNodeKind Kind { get; set; }
        public int Tier { get; set; }
        public double Weight { get; set; }
        public bool CanShow { get { return Id > 0 && Kind != ImpactNodeKind.Global; } }
    }

    public sealed class AreaRow
    {
        public long RoomId { get; set; }
        public string Label { get; set; }
        public double BeforeM2 { get; set; }
        public double AfterM2 { get; set; }
        public double DeltaM2 { get; set; }
    }

    /// <summary>
    /// «Талбайн шилжилт» — хана зөөхөд талбай нэг өрөөнөөс нөгөөд шилждэг.  ЗӨВХӨН хоёр талдаа амжилттай уншигдсан, хаалттай өрөөнөөс тооцно.
    /// ⚠️ «Борлуулах талбай» (sellable area) ГЭЖ ХЭЗЭЭ Ч нэрлэхгүй — өрөөний ангилал үүнийг дэмждэггүй.
    /// </summary>
    public sealed class PreChangeAreaSummary
    {
        public List<AreaRow> Rows { get; set; } = new List<AreaRow>();
        public int EvaluatedRooms { get; set; }
        /// <summary>Тооцоонд ОРООГҮЙ өрөө (уншигдаагүй, хаалттай болох/болихгүй, шинэ/устсан).</summary>
        public int ExcludedRooms { get; set; }
        public double TotalDeltaM2 { get; set; }
        /// <summary>Нийлбэр ≈ 0 бөгөөд ≥2 өрөө — талбай нэгээс нөгөөд шилжсэн.</summary>
        public bool IsTransfer { get; set; }
        /// <summary>Нийт хаалттай талбай өөрчлөгдсөн (гадна хана зөөх г.м.) — «Нийт хаалттай талбай: +X м²» харуулна.</summary>
        public bool ShowTotal { get; set; }
        public string Title { get; set; }
        public string TotalText { get; set; }

        public bool HasContent { get { return Rows.Count > 0; } }

        public static PreChangeAreaSummary Build(PreChangeReport r)
        {
            var s = new PreChangeAreaSummary { Title = "Талбайн өөрчлөлт" };
            if (r == null || r.Outcome != SandboxOutcome.Simulated || r.Before == null || r.After == null || !r.Before.Captured || !r.After.Captured) return s;

            foreach (long id in r.Before.Rooms.Keys.Union(r.After.Rooms.Keys).OrderBy(x => x))
            {
                RoomSnap b, a;
                bool hb = r.Before.Rooms.TryGetValue(id, out b), ha = r.After.Rooms.TryGetValue(id, out a);
                if (!hb || !ha || !b.Readable || !a.Readable || !(b.Placed && b.Enclosed) || !(a.Placed && a.Enclosed))
                {
                    // Хоёр талдаа ХААЛТТАЙ, УНШИГДСАН өрөөг л нийлбэрт оруулна — бусдыг тусад нь тоолж ил хэлнэ.
                    if (hb || ha) s.ExcludedRooms++;
                    continue;
                }
                s.EvaluatedRooms++;
                double d = a.AreaM2 - b.AreaM2;
                s.TotalDeltaM2 += d;
                if (Math.Abs(d) > PreChangeTolerance.AreaM2)
                    s.Rows.Add(new AreaRow { RoomId = id, Label = a.Label, BeforeM2 = b.AreaM2, AfterM2 = a.AreaM2, DeltaM2 = d });
            }

            s.Rows = s.Rows.OrderByDescending(x => x.DeltaM2).ThenBy(x => x.Label, StringComparer.Ordinal).ToList();
            bool totalChanged = Math.Abs(s.TotalDeltaM2) > PreChangeTolerance.AreaM2;
            s.IsTransfer = s.Rows.Count >= 2 && !totalChanged;
            s.ShowTotal = s.EvaluatedRooms > 0 && totalChanged;
            s.Title = s.IsTransfer ? "Талбайн шилжилт" : "Талбайн өөрчлөлт";
            if (s.ShowTotal)
                s.TotalText = "Нийт хаалттай талбай: " + PreChangeText.DeltaM2(s.TotalDeltaM2)
                    + (s.ExcludedRooms > 0 ? "  (" + s.ExcludedRooms + " өрөө тооцоонд ороогүй)" : "");
            else if (s.ExcludedRooms > 0 && s.Rows.Count > 0)
                s.TotalText = s.ExcludedRooms + " өрөө тооцоонд ороогүй.";
            return s;
        }
    }

    /// <summary>MEP-ийн нэг мөр: «Wall W12 ↔ Duct SA-350 · огтлолцол X см³».  ЗӨВХӨН бодит хэмжсэн утга — байхгүйг зохиохгүй.</summary>
    public sealed class MepClashLine
    {
        public string Wall { get; set; }
        public string Other { get; set; }
        public string Link { get; set; }
        /// <summary>Огтлолцлын эзлэхүүн (см³).  null = хэмжээгүй.</summary>
        public double? VolumeCm3 { get; set; }
        public bool IsNew { get; set; }
        public string ItemKey { get; set; }
        public long Id { get; set; }
        public string Headline { get; set; }
        public string Metric { get; set; }
    }

    public sealed class EgressLine
    {
        public string Room { get; set; }
        public string Headline { get; set; }
        public string Before { get; set; }
        public string After { get; set; }
        public string Delta { get; set; }
        public bool Lost { get; set; }
        public string ItemKey { get; set; }
        public long Id { get; set; }
    }

    /// <summary>
    /// UI-ийн БҮХ харагдах өгөгдөл — шийдвэр, тэргүүн 3 үр дагавар, 5 карт, талбайн шилжилт, MEP, гарц, төлөвийн чип, «Яагаад?» — ЦЭВЭР.
    /// Цонх зөвхөн үүнийг зурна (Revit/бизнес дүрэм ЭНД, WPF-д БИШ).  Smart.UiSmoke хуурамч session-оор шалгана.
    /// </summary>
    public sealed class PreChangeView
    {
        public const string EgressExplanation = "Сонгосон гарц хүртэлх Revit Path of Travel. Нормын дээд зайтай тулгаагүй.";
        public const string StageProvisional = "Түр дүн";
        public const string StageFinal = "Эцсийн техникийн дүгнэлт";

        public PreChangeReport Report { get; set; }
        public MoveDecision Decision { get; set; }
        public ApplyGateResult Gate { get; set; }
        public FreshnessState Freshness { get; set; }
        public string StageLabel { get; set; }
        public List<ConsequenceRow> Top { get; set; } = new List<ConsequenceRow>();
        public List<SummaryCard> Cards { get; set; } = new List<SummaryCard>();
        public PreChangeAreaSummary Area { get; set; }
        public List<MepClashLine> MepNew { get; set; } = new List<MepClashLine>();
        public List<MepClashLine> MepExisting { get; set; } = new List<MepClashLine>();
        public List<EgressLine> Egress { get; set; } = new List<EgressLine>();
        public string EgressNote { get; set; }
        public PreChangeSummary Details { get; set; }
        /// <summary>«Яагаад?» — бүх шалтгаан (🔴/⚪/🟠) дарааллаараа.</summary>
        public List<DecisionReason> Why { get; set; } = new List<DecisionReason>();
        public string ModelOnlyNote { get { return PreChangeDecisionEngine.ModelOnlyNote; } }

        public static PreChangeView Build(PreChangeReport r, FreshnessState freshness, bool busy)
        {
            MoveDecision d = PreChangeDecisionEngine.Decide(r);
            var v = new PreChangeView
            {
                Report = r, Decision = d, Freshness = freshness,
                StageLabel = d.IsFinal ? StageFinal : StageProvisional,
                Area = PreChangeAreaSummary.Build(r),
            };
            v.Gate = PreChangeApplyGate.Evaluate(new ApplyGateInput
            {
                Decision = r == null ? null : d, Freshness = freshness, Busy = busy,
                DistanceMm = r != null && r.Request != null ? r.Request.DistanceMm : 0,
            });
            if (r == null) return v;

            v.Details = PreChangeSummary.Build(r);
            v.Why = d.Blocking.Concat(d.UnknownReasons).Concat(d.ReviewReasons).ToList();
            if (r.Outcome == SandboxOutcome.Simulated)
            {
                v.Top = TopConsequences(r, d);
                v.Cards = SimpleCards(r, v.Details);
                BuildMep(r, v);
                BuildEgress(r, v);
            }
            return v;
        }

        /* ============================== ТЭРГҮҮН 3 ============================ */

        private static ConsequenceRow Row(string key, string label, string before, string after, string delta, ItemSeverity tone, PreChangeCategory cat,
            PreChangeItem it, int tier, double weight, string detail = null)
        {
            return new ConsequenceRow
            {
                Key = key, Label = label, Before = before, After = after, Delta = delta, Tone = tone, Category = cat, Detail = detail,
                ItemKey = it != null ? it.Key : null, Id = it != null ? it.Id : 0, Kind = it != null ? it.Kind : ImpactNodeKind.Element, Tier = tier, Weight = weight,
            };
        }

        private static List<ConsequenceRow> TopConsequences(PreChangeReport r, MoveDecision d)
        {
            var rows = new List<ConsequenceRow>();

            // Tier 0 — батлагдсан ноцтой (🔴): ямар шалтгааны улмаас зөөхгүй вэ.
            List<PreChangeItem> critical = r.Items.Where(i => i.Truth == TruthState.Confirmed && i.Severity == ItemSeverity.Critical).ToList();
            List<PreChangeItem> clashes = critical.Where(i => i.Code == ItemCodes.ClashNew).OrderBy(i => i.Subject ?? "", StringComparer.Ordinal).ToList();
            if (clashes.Count == 1)
                rows.Add(Row("clash", "MEP", null, "+1 шинэ clash", clashes[0].Subject, ItemSeverity.Critical, PreChangeCategory.Clash, clashes[0], 0, 6));
            else if (clashes.Count > 1)
                rows.Add(Row("clash", "MEP", null, "+" + clashes.Count + " шинэ clash", null, ItemSeverity.Critical, PreChangeCategory.Clash, clashes[0], 0, 6));
            foreach (PreChangeItem i in critical.Where(x => x.Code != ItemCodes.ClashNew).OrderBy(x => x.Code, StringComparer.Ordinal).ThenBy(x => x.Subject ?? "", StringComparer.Ordinal))
            {
                if (i.Category == PreChangeCategory.Egress)
                    rows.Add(Row("egress:" + i.Key, "Гарц", i.Before, "зам тасарна", null, ItemSeverity.Critical, PreChangeCategory.Egress, i, 0, 7, i.Subject));
                else if (i.Category == PreChangeCategory.Room)
                    rows.Add(Row(i.Key, i.Subject ?? i.Title, i.Before, i.After, i.Delta, ItemSeverity.Critical, PreChangeCategory.Room, i, 0, 2));
                else
                    rows.Add(Row(i.Key, i.Subject ?? i.Title, null, null, null, ItemSeverity.Critical, i.Category, i, 0, 9, i.Title));
            }

            // Tier 1 — өрөөний талбай (|өөрчлөлт| ихээс).
            foreach (PreChangeItem i in r.Items.Where(x => x.Truth == TruthState.Confirmed && x.Code == ItemCodes.RoomArea))
                rows.Add(Row(i.Key, i.Subject ?? i.Title, i.Before, i.After, i.Delta, i.Severity, PreChangeCategory.Room, i, 1, Math.Abs(i.DeltaValue ?? 0)));

            // Tier 2 — гарц, орчны зай.
            foreach (PreChangeItem i in r.Items.Where(x => x.Truth == TruthState.Confirmed && (x.Code == ItemCodes.EgressChanged || x.Code == ItemCodes.EgressGained)))
                rows.Add(Row(i.Key, "Гарц · " + (i.Subject ?? ""), i.Before, i.After, i.Delta, i.Severity, PreChangeCategory.Egress, i, 2, Math.Abs(i.DeltaValue ?? 0)));
            foreach (PreChangeItem i in r.Items.Where(x => x.Truth == TruthState.Confirmed && x.Code == ItemCodes.ClearanceChanged))
                rows.Add(Row(i.Key, "Орчны зай · " + (i.Subject ?? ""), i.Before, i.After, i.Delta, i.Severity, PreChangeCategory.Clearance, i, 2, Math.Abs(i.DeltaValue ?? 0)));

            // Tier 3 — хэмжээс (нэгтгэсэн).
            List<PreChangeItem> dims = r.Items.Where(x => x.Truth == TruthState.Confirmed && x.Code == ItemCodes.DimChanged).ToList();
            if (dims.Count > 0)
                rows.Add(Row("dims", "Хэмжээс", null, dims.Count + " шинэчлэгдэнэ", null, ItemSeverity.Notice, PreChangeCategory.Dimension, dims[0], 3, dims.Count));

            // Tier 4 — хуудас (нэгтгэсэн).
            DecisionReason sheet = d.ReviewReasons.FirstOrDefault(x => x.Code == ItemCodes.Sheet);
            if (sheet != null)
                rows.Add(new ConsequenceRow
                {
                    Key = "sheets", Label = "Хуудас", After = sheet.Text.Replace(" хуудас хянана", ""), Tone = ItemSeverity.Notice, Category = PreChangeCategory.Sheet,
                    ItemKey = sheet.ItemKey, Id = sheet.Id, Kind = sheet.Kind, Tier = 4, Weight = r.DistinctSheetCount, Detail = "хянана",
                });

            return rows.OrderBy(x => x.Tier).ThenByDescending(x => x.Weight).ThenBy(x => x.Label ?? "", StringComparer.Ordinal).Take(3).ToList();
        }

        /* ============================== 5 КАРТ ============================== */

        private static List<SummaryCard> SimpleCards(PreChangeReport r, PreChangeSummary s)
        {
            var cards = new List<SummaryCard>();
            bool quick = r.Stage == AnalysisStage.Quick;
            foreach (string key in new[] { PreChangeSummary.Rooms, PreChangeSummary.Dimensions, PreChangeSummary.Mep, PreChangeSummary.Egress, PreChangeSummary.Sheets })
            {
                SummaryCard c = s.Card(key);
                if (c == null) continue;
                var copy = new SummaryCard { Key = c.Key, Title = c.Title, Value = c.Value, Detail = c.Detail, Truth = c.Truth, Tone = c.Tone };
                PreChangeCoverage cov = r.Coverage ?? new PreChangeCoverage();
                if (key == PreChangeSummary.Mep && quick)
                    { copy.Value = "…"; copy.Detail = "шалгаж байна"; copy.Truth = TruthState.Incomplete; copy.Tone = ItemSeverity.Ok; }
                else if (key == PreChangeSummary.Egress && !cov.EgressConfigured)
                    { copy.Value = "тохируулаагүй"; copy.Detail = "алдаа биш — «Нарийвчилсан»-д тохируулна"; copy.Truth = TruthState.NotEvaluated; copy.Tone = ItemSeverity.Ok; }
                else if (key == PreChangeSummary.Egress && quick)
                    { copy.Value = "…"; copy.Detail = "шалгаж байна"; copy.Truth = TruthState.Incomplete; copy.Tone = ItemSeverity.Ok; }
                cards.Add(copy);
            }
            return cards;
        }

        /* ============================== MEP ================================= */

        private static void BuildMep(PreChangeReport r, PreChangeView v)
        {
            string wall = r.Request != null && !string.IsNullOrWhiteSpace(r.Request.SourceLabel) ? r.Request.SourceLabel : "Хана";
            foreach (PreChangeItem i in r.Items.Where(x => x.Category == PreChangeCategory.Clash && (x.Code == ItemCodes.ClashNew || x.Code == ItemCodes.ClashOld))
                .OrderBy(x => x.Subject ?? "", StringComparer.Ordinal))
            {
                bool isNew = i.Code == ItemCodes.ClashNew;
                double? vol = isNew ? i.AfterValue : null;
                var line = new MepClashLine
                {
                    Wall = wall, Other = i.Subject, IsNew = isNew, ItemKey = i.Key, Id = i.Id,
                    VolumeCm3 = vol != null && vol > 0 ? vol : null,
                    Headline = isNew ? "ШИНЭ CLASH" : "Хуучин clash (хөдөлгөөнөөс үл хамаарна)",
                };
                if (line.VolumeCm3.HasValue)
                    line.Metric = "Огтлолцол: " + Math.Round(line.VolumeCm3.Value, 1).ToString("0.#", CultureInfo.InvariantCulture) + " см³";
                if (isNew) v.MepNew.Add(line); else v.MepExisting.Add(line);
            }
        }

        /* ============================== ГАРЦ ================================ */

        private static void BuildEgress(PreChangeReport r, PreChangeView v)
        {
            if (r.Coverage == null || !r.Coverage.EgressConfigured) return;
            v.EgressNote = EgressExplanation;
            foreach (PreChangeItem i in r.Items.Where(x => x.Category == PreChangeCategory.Egress && x.Truth == TruthState.Confirmed)
                .OrderBy(x => x.Subject ?? "", StringComparer.Ordinal))
            {
                bool lost = i.Code == ItemCodes.EgressLost;
                v.Egress.Add(new EgressLine
                {
                    Room = i.Subject, Lost = lost, ItemKey = i.Key, Id = i.Id,
                    Headline = lost ? "Гарцаас хүрэх зам тасарна" : "Гарц",
                    Before = i.Before, After = i.After, Delta = i.Delta,
                });
            }
        }
    }
}
