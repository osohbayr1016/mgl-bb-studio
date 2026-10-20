using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.ClashCheck.Core;

namespace RevitMcpAddin.ChangeImpact.Core
{
    public sealed class SummaryCard
    {
        public string Key { get; set; }
        public string Title { get; set; }
        public string Value { get; set; }
        public string Detail { get; set; }
        public TruthState Truth { get; set; }
        public ItemSeverity Tone { get; set; }
    }

    /// <summary>Нэг бүлгийн (Батлагдсан / Хянах / Тооцоолоогүй / Анхааруулга) мөрүүд.</summary>
    public sealed class SummaryGroup
    {
        public string Key { get; set; }
        public string Title { get; set; }
        public List<PreChangeItem> Items { get; set; } = new List<PreChangeItem>();
    }

    /// <summary>
    /// UI-ийн «5 секундэд ойлгох» ТОВЧ — ЦЭВЭР (тестлэгдэнэ).  Карт бүр ҮНЭНЭЭР тооцсон эсэхээ хэлнэ: тооцоогүйг «0» гэж ХЭЗЭЭ Ч гаргахгүй.
    /// </summary>
    public sealed class PreChangeSummary
    {
        public string Headline { get; set; }
        public AttentionLevel Level { get; set; }
        public string LevelText { get; set; }
        public string LevelExplain { get; set; }
        public List<SummaryCard> Cards { get; set; } = new List<SummaryCard>();
        public List<SummaryGroup> Groups { get; set; } = new List<SummaryGroup>();
        public string Footer { get; set; }
        public List<string> Warnings { get; set; } = new List<string>();
        public bool CanApply { get; set; }

        public SummaryCard Card(string key)
        {
            return Cards.FirstOrDefault(c => c.Key == key);
        }

        public SummaryGroup Group(string key)
        {
            return Groups.FirstOrDefault(g => g.Key == key);
        }

        public const string Rooms = "rooms", Dimensions = "dimensions", Views = "views", Sheets = "sheets", Mep = "mep", Egress = "egress", Hosted = "hosted";
        public const string GConfirmed = "confirmed", GReview = "review", GNotEvaluated = "notEvaluated", GWarnings = "warnings";

        public static PreChangeSummary Build(PreChangeReport r)
        {
            if (r == null) throw new ArgumentNullException("r");
            var s = new PreChangeSummary
            {
                Headline = PreChangeText.Headline(r.Request),
                Level = r.Level,
                LevelText = PreChangeText.LevelLabel(r.Level),
                LevelExplain = PreChangeText.LevelExplain(r.Level, r.Incomplete),
                CanApply = r.CanApply,
                Footer = r.Outcome == SandboxOutcome.NotRestored ? null : PreChangeText.ModelUntouched,
            };

            if (r.Outcome == SandboxOutcome.Simulated) BuildCards(s, r);

            var all = r.Items;
            s.Groups.Add(new SummaryGroup
            {
                Key = GConfirmed, Title = "Батлагдсан өөрчлөлт",
                Items = all.Where(i => i.Truth == TruthState.Confirmed && i.Category != PreChangeCategory.Failure).ToList(),
            });
            s.Groups.Add(new SummaryGroup
            {
                Key = GReview, Title = "Хянах зүйл",
                Items = all.Where(i => i.Truth == TruthState.Review).ToList(),
            });
            s.Groups.Add(new SummaryGroup
            {
                Key = GNotEvaluated, Title = "Тооцоолоогүй",
                Items = all.Where(i => i.Truth == TruthState.NotEvaluated || i.Truth == TruthState.Incomplete).ToList(),
            });
            s.Groups.Add(new SummaryGroup
            {
                Key = GWarnings, Title = "Анхааруулга",
                Items = all.Where(i => i.Category == PreChangeCategory.Failure).ToList(),
            });

            s.Warnings.AddRange(r.BlockReasons);
            foreach (string reason in r.IncompleteReasons) s.Warnings.Add("Бүрэн биш: " + reason);
            return s;
        }

        /// <summary>«2 өрөө · 2 хэмжээс · 3 хуудас · 1 MEP clash» — Apply-ийн дараах товч.  Тооцоогүй зүйлийг БИЧИХГҮЙ.</summary>
        public static string CountsLine(PreChangeReport r)
        {
            if (r == null) return "";
            var parts = new List<string>();
            PreChangeCoverage cov = r.Coverage ?? new PreChangeCoverage();
            if (cov.RoomsChecked)
                parts.Add(r.Items.Count(i => i.Category == PreChangeCategory.Room && i.Truth == TruthState.Confirmed) + " өрөө");
            if (cov.DimensionsChecked)
                parts.Add(r.Items.Count(i => i.Category == PreChangeCategory.Dimension && i.Truth == TruthState.Confirmed && i.Severity >= ItemSeverity.Notice) + " хэмжээс");
            if (cov.ViewsChecked)
                parts.Add(Math.Max(r.DistinctSheetCount, r.Items.Where(i => i.Category == PreChangeCategory.Sheet).Select(i => i.Id).Distinct().Count()) + " хуудас");
            if (cov.ClashEvaluated)
                parts.Add(PreChangeDiff.NewClashCount(r) + " MEP clash");
            return string.Join(" · ", parts);
        }

        private static void BuildCards(PreChangeSummary s, PreChangeReport r)
        {
            PreChangeCoverage cov = r.Coverage ?? new PreChangeCoverage();

            // Өрөө
            var rooms = r.Items.Where(i => i.Category == PreChangeCategory.Room && i.Truth == TruthState.Confirmed).ToList();
            s.Cards.Add(CountCard(Rooms, "Өрөө", rooms.Count, cov.RoomsChecked, rooms.Any(i => i.Severity == ItemSeverity.Critical),
                rooms.Count > 0 ? "талбай өөрчлөгдөнө" : "өөрчлөгдөхгүй"));

            // Хэмжээс (утга өөрчлөгдсөн)
            var dims = r.Items.Where(i => i.Category == PreChangeCategory.Dimension && i.Truth == TruthState.Confirmed && i.Severity >= ItemSeverity.Notice).ToList();
            s.Cards.Add(CountCard(Dimensions, "Хэмжээс", dims.Count, cov.DimensionsChecked, dims.Any(i => i.Severity == ItemSeverity.Critical),
                dims.Count > 0 ? "утга өөрчлөгдөнө" : "өөрчлөгдөхгүй"));

            // Хаалга/цонх (хамт хөдөлнө)
            var hosted = r.Items.Where(i => i.Category == PreChangeCategory.Hosted && i.Truth == TruthState.Confirmed && i.Key != null && i.Key.StartsWith("host:", StringComparison.Ordinal)).ToList();
            s.Cards.Add(CountCard(Hosted, "Хаалга/цонх", hosted.Count, cov.RoomsChecked, hosted.Any(i => i.Severity == ItemSeverity.Critical),
                hosted.Count > 0 ? "хамт хөдөлнө" : "хөдлөхгүй"));

            // Харагдац (Хянах — «эвдэрсэн» БИШ)
            var views = r.Items.Where(i => i.Category == PreChangeCategory.View && i.Kind == ImpactNodeKind.View).ToList();
            var vc = new SummaryCard { Key = Views, Title = "Харагдац", Truth = cov.ViewsChecked ? TruthState.Review : TruthState.Incomplete };
            if (!cov.ViewsChecked) { vc.Value = "тооцоогүй"; vc.Detail = "харагдалтыг шалгаагүй"; vc.Tone = ItemSeverity.Ok; }
            else
            {
                vc.Value = views.Count.ToString();
                vc.Detail = views.Count == 0 ? "хянах харагдац алга" : PreChangeText.ViewBreakdown(views.Select(v => v.ViewType)) + " хянана";
                vc.Tone = views.Count > 0 ? ItemSeverity.Notice : ItemSeverity.Ok;
            }
            s.Cards.Add(vc);

            // Хуудас (давхардалгүй)
            int sheets = Math.Max(r.DistinctSheetCount, r.Items.Where(i => i.Category == PreChangeCategory.Sheet).Select(i => i.Id).Distinct().Count());
            var sc = new SummaryCard { Key = Sheets, Title = "Хуудас", Truth = cov.ViewsChecked ? TruthState.Review : TruthState.Incomplete };
            if (!cov.ViewsChecked) { sc.Value = "тооцоогүй"; sc.Detail = "харагдалтыг шалгаагүй"; sc.Tone = ItemSeverity.Ok; }
            else { sc.Value = sheets.ToString(); sc.Detail = sheets == 0 ? "нөлөөлөх хуудас алга" : "хянах шаардлагатай"; sc.Tone = sheets > 0 ? ItemSeverity.Notice : ItemSeverity.Ok; }
            s.Cards.Add(sc);

            // MEP
            s.Cards.Add(MepCard(r, cov));

            // Гарц
            s.Cards.Add(EgressCard(r, cov));
        }

        private static SummaryCard CountCard(string key, string title, int count, bool checkedOk, bool critical, string detail)
        {
            if (!checkedOk)
                return new SummaryCard { Key = key, Title = title, Value = "тооцоогүй", Detail = "бүрэн унших боломжгүй байсан", Truth = TruthState.Incomplete, Tone = ItemSeverity.Ok };
            return new SummaryCard
            {
                Key = key, Title = title, Value = count.ToString(), Detail = detail, Truth = TruthState.Confirmed,
                Tone = critical ? ItemSeverity.Critical : (count > 0 ? ItemSeverity.Warning : ItemSeverity.Ok),
            };
        }

        private static SummaryCard MepCard(PreChangeReport r, PreChangeCoverage cov)
        {
            var c = new SummaryCard { Key = Mep, Title = "MEP" };
            if (!cov.ClashEvaluated)
            {
                c.Value = "тооцоогүй"; c.Truth = TruthState.NotEvaluated; c.Tone = ItemSeverity.Ok;
                PreChangeItem ne = r.Items.FirstOrDefault(i => i.Key == "clash:ne");
                c.Detail = ne != null ? ne.Why : "MEP шалгалт хийгдсэнгүй";
                return c;
            }
            int n = PreChangeDiff.NewClashCount(r);
            if (n > 0) { c.Value = n + " шинэ clash"; c.Truth = TruthState.Confirmed; c.Tone = ItemSeverity.Critical; c.Detail = "хөдөлгөөнөөс үүснэ"; return c; }
            if (!cov.ClashComplete) { c.Value = "бүрэн биш"; c.Truth = TruthState.Incomplete; c.Tone = ItemSeverity.Notice; c.Detail = "шинэ clash илрээгүй ч шалгалт дутуу"; return c; }
            c.Value = "0 шинэ clash"; c.Truth = TruthState.Confirmed; c.Tone = ItemSeverity.Ok; c.Detail = "шалгалт бүрэн";
            return c;
        }

        private static SummaryCard EgressCard(PreChangeReport r, PreChangeCoverage cov)
        {
            var c = new SummaryCard { Key = Egress, Title = "Гарц" };
            if (!cov.EgressConfigured) { c.Value = "тооцоогүй"; c.Truth = TruthState.NotEvaluated; c.Tone = ItemSeverity.Ok; c.Detail = "гарц сонгоогүй"; return c; }
            var eg = r.Items.Where(i => i.Category == PreChangeCategory.Egress && i.Truth == TruthState.Confirmed).ToList();
            if (eg.Any(i => i.Severity == ItemSeverity.Critical)) { c.Value = "боломжгүй"; c.Truth = TruthState.Confirmed; c.Tone = ItemSeverity.Critical; c.Detail = "зам олдохгүй болно"; return c; }
            if (!cov.EgressEvaluated)
            {
                c.Value = eg.Count > 0 ? "хэсэгчлэн" : "тооцоогүй"; c.Truth = eg.Count > 0 ? TruthState.Incomplete : TruthState.NotEvaluated; c.Tone = ItemSeverity.Notice; c.Detail = "зам тооцоо бүрэн биш"; return c;
            }
            double? worst = eg.Where(i => i.DeltaValue.HasValue).Select(i => i.DeltaValue).OrderByDescending(v => v.Value).FirstOrDefault();
            if (worst.HasValue) { c.Value = PreChangeText.DeltaM(worst); c.Detail = "хамгийн их өөрчлөлт"; c.Tone = worst.Value > 0 ? ItemSeverity.Notice : ItemSeverity.Ok; }
            else { c.Value = "өөрчлөгдөхгүй"; c.Detail = "зам тогтвортой"; c.Tone = ItemSeverity.Ok; }
            c.Truth = TruthState.Confirmed;
            return c;
        }
    }
}
