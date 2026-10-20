using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace RevitMcpAddin.ChangeImpact.Core
{
    public sealed class ImpactCounter
    {
        public string Key { get; set; }
        public string Title { get; set; }
        public int Count { get; set; }
        /// <summary>null = «БҮГД».</summary>
        public ImpactGroup? Group { get; set; }
        public bool Active { get; set; }
    }

    public sealed class TopImpactRow
    {
        public string Text { get; set; }
        public ItemSeverity Tone { get; set; }
        public string ItemKey { get; set; }
        public string TargetKey { get; set; }
        public long Id { get; set; }
        public ImpactNodeKind Kind { get; set; }
        public bool CanShow { get { return Id > 0 && Kind != ImpactNodeKind.Global; } }
    }

    /// <summary>«Баримтжуулалт» хураангуй: «2 хэмжээс · 1 tag · 1 хүснэгт · 2 план, 1 зүсэлт · 3 хуудас».</summary>
    public sealed class DoorDocSummary
    {
        public int Dimensions { get; set; }
        public int Tags { get; set; }
        public int Schedules { get; set; }
        public int Sheets { get; set; }
        public string ViewsText { get; set; }
        public string Line { get; set; }
        public bool HasContent { get { return !string.IsNullOrEmpty(Line); } }
    }

    public sealed class DoorClearanceView
    {
        public string Before { get; set; }
        public string After { get; set; }
        public string Delta { get; set; }
        public string Note { get; set; }
        public bool Evaluated { get; set; }
    }

    /// <summary>
    /// Хаалга зөөх цонхны БҮХ харагдах өгөгдөл — ЦЭВЭР (WPF-гүй).  Controller-ын төлвөөс гарна; цонх зөвхөн зурна.
    /// ⚠️ Хэрэглэгчид ElementId, graph node, resolver, generation, transaction, sandbox, API класс ХАРАГДАХГҮЙ — тэр нь `TechnicalInfo`-д.
    /// </summary>
    public sealed class DoorMoveView
    {
        public const string SwingText = "Хаалганы дүүжин (swing): тооцоолоогүй";
        public const string ModelUnchanged = "Загвар өөрчлөгдөөгүй — бодит хаалга анхны байрлалдаа.";

        public string DoorHeadline { get; set; }
        public string RoomsLine { get; set; }
        public string HostLine { get; set; }
        public bool HasTarget { get; set; }
        public double? OffsetMm { get; set; }
        public string OffsetText { get; set; }

        public string Mark { get; set; }
        public string Title { get; set; }
        public string Subtitle { get; set; }
        public string StageLabel { get; set; }
        /// <summary>Толгой дүгнэлт урьдчилсан (fast scan) эсэх — sandbox-ийн эцсийн дүн хараахан ирээгүй.</summary>
        public bool Predictive { get; set; }
        public bool Busy { get; set; }
        public ExactPhase Phase { get; set; }
        public MoveVerdict Verdict { get; set; }
        public bool VerdictIsFinal { get; set; }
        public ItemSeverity Tone { get; set; }

        public MoveDecision Decision { get; set; }
        public ApplyGateResult Gate { get; set; }
        public List<ImpactCounter> Counters { get; set; } = new List<ImpactCounter>();
        public List<ImpactEntry> Entries { get; set; } = new List<ImpactEntry>();
        /// <summary>Critical бүлэг — ХАМГИЙН ЭХЭНД (хэрэв > 0).</summary>
        public List<ImpactEntry> Critical { get; set; } = new List<ImpactEntry>();
        public List<TopImpactRow> Top { get; set; } = new List<TopImpactRow>();
        public int CriticalCount { get; set; }
        public int ReviewCount { get; set; }
        public int NewClashCount { get; set; }
        public int OpeningOverlapCount { get; set; }
        public int SheetCount { get; set; }
        public DoorDocSummary Docs { get; set; } = new DoorDocSummary();
        public DoorClearanceView Clearance { get; set; }
        public string SwingLine { get { return SwingText; } }
        public string NormLine { get; set; }
        public string ModelNote { get; set; }
        public string StatusLine { get; set; }
        public string Notice { get; set; }
        public bool ModelMayBeModified { get; set; }
        /// <summary>Жагсаалт өмнөх зорилтын дүн (бүдэг харуулна) — шинэ зорилт шалгагдаж байна.</summary>
        public bool ListsArePrevious { get; set; }
        public double? PreviousOffsetMm { get; set; }
        public ImpactGroup? Filter { get; set; }
        /// <summary>Зөвхөн «Техникийн мэдээлэл» хэсэгт (generation, хугацаа).</summary>
        public string TechnicalInfo { get; set; }

        public static string OffsetLabel(double offsetMm)
        {
            string s = Math.Round(offsetMm).ToString("0", CultureInfo.InvariantCulture);
            return (offsetMm > 0 ? "+" : "") + s + " мм";
        }

        public static DoorMoveView Build(DoorSimulationController c, FreshnessState freshness)
        {
            var v = new DoorMoveView { NormLine = PreChangeDecisionEngine.NormLineText, Filter = c.Filter, Notice = c.Notice };
            PreChangeSelection d = c.Door;
            v.DoorHeadline = HeadlineOf(d);
            v.RoomsLine = RoomsOf(d);
            v.HostLine = d != null && !string.IsNullOrWhiteSpace(d.HostLabel) ? "Хост: " + d.HostLabel : null;
            v.HasTarget = c.OffsetMm.HasValue;
            v.OffsetMm = c.OffsetMm;
            v.OffsetText = c.OffsetMm.HasValue ? OffsetLabel(c.OffsetMm.Value) : "";
            v.Phase = c.Phase;
            v.Busy = c.Applying || c.Phase == ExactPhase.Debouncing || c.Phase == ExactPhase.Running || c.Phase == ExactPhase.Provisional;
            v.Gate = c.Gate(freshness);
            v.TechnicalInfo = TechInfo(c);

            if (!c.OffsetMm.HasValue)
            {
                v.Mark = "⚪"; v.Title = "ШИНЭ БАЙРЛАЛ ЗААГААГҮЙ";
                v.Subtitle = "«Шинэ байрлал заах» дарж ханан дээр дарна уу, эсвэл ← → товчоор зайг өөрчилнө үү.";
                v.StageLabel = "";
                v.Verdict = MoveVerdict.Unknown;
                v.StatusLine = ModelUnchanged;
                v.Counters = BuildCounters(new List<ImpactEntry>(), c.Filter);
                return v;
            }

            PreChangeReport cur = c.CurrentReport;
            v.StatusLine = ModelUnchanged;
            if (cur != null)
            {
                MoveDecision dec = PreChangeDecisionEngine.Decide(cur);
                v.Decision = dec;
                v.Mark = dec.Mark; v.Title = dec.Title; v.Subtitle = dec.Subtitle;
                v.Verdict = dec.Verdict;
                v.VerdictIsFinal = dec.IsFinal && !dec.IsPending;
                v.Predictive = !v.VerdictIsFinal;
                v.ModelMayBeModified = dec.ModelMayBeModified;
                v.StageLabel = c.Phase == ExactPhase.Provisional || dec.IsPending ? PreChangeView.StageProvisional + " — гүн шалгалт (MEP, гарц, хүснэгт) үргэлжилж байна…" : PreChangeView.StageFinal;
                v.Entries = DoorImpactGroups.Build(cur, null);
                v.Top = dec.Top.Take(3).Select(t => TopOf(t, cur)).ToList();
                FillCounts(v, cur);
                v.Docs = DocsOf(cur);
                v.Clearance = ClearanceOf(cur);
                v.Tone = ToneOf(dec);
            }
            else
            {
                // Урьдчилсан дүн (fast scan) — эцсийн шалгалт хийгдэж байна.  ⚪/🟠/🔴 «түр» гэж ил тэмдэглэнэ; 🟢 хэзээ ч биш.
                DoorFastResult fast = c.Fast;
                v.Predictive = true;
                v.Entries = DoorImpactGroups.Build(null, fast);
                v.Top = (fast != null ? fast.Findings : new List<FastFinding>()).Where(f => f.Severity >= ItemSeverity.Notice).Take(3).Select(f => new TopImpactRow
                {
                    Text = f.Text, Tone = f.Severity, Id = f.Id, Kind = ImpactNodeKind.Element, TargetKey = f.Id > 0 ? f.LinkInstanceId + ":" + f.Id : null,
                }).ToList();
                if (c.Phase == ExactPhase.Failed)
                {
                    v.Mark = "⚪"; v.Title = "ДҮГНЭХ БОЛОМЖГҮЙ"; v.Subtitle = c.LastError; v.StageLabel = "Шинжилгээ амжилтгүй — загварт өөрчлөлт хийгдээгүй."; v.Verdict = MoveVerdict.Unknown; v.Predictive = false;
                    v.Tone = ItemSeverity.Ok;
                }
                else if (fast != null && (fast.CriticalCount > 0))
                {
                    v.Mark = "🔴"; v.Title = "ЗӨӨХГҮЙ (түр)"; v.Verdict = MoveVerdict.DoNotMove; v.Subtitle = FirstText(v.Top) ?? DoorFastScan.Summary(fast);
                    v.StageLabel = "Урьдчилсан дүн — эцсийн шалгалт хийгдэж байна…"; v.Tone = ItemSeverity.Critical;
                }
                else if (fast != null && fast.ReviewCount > 0)
                {
                    v.Mark = "🟠"; v.Title = "ХЯНАХ (түр)"; v.Verdict = MoveVerdict.MoveWithReview; v.Subtitle = DoorFastScan.Summary(fast);
                    v.StageLabel = "Урьдчилсан дүн — эцсийн шалгалт хийгдэж байна…"; v.Tone = ItemSeverity.Warning;
                }
                else
                {
                    v.Mark = "⚪"; v.Title = "ШАЛГАЖ БАЙНА…"; v.Verdict = MoveVerdict.Unknown; v.Subtitle = DoorFastScan.Summary(fast);
                    v.StageLabel = "Урьдчилсан дүн — эцсийн шалгалт хийгдэж байна…"; v.Tone = ItemSeverity.Ok;
                }
                FillCounts(v, null);
                PreChangeReport prev = c.PreviousReport;
                if (prev != null && prev.Request != null)
                {
                    v.ListsArePrevious = true;
                    v.PreviousOffsetMm = prev.Request.OffsetMm;
                }
            }

            v.Counters = BuildCounters(v.Entries, c.Filter);
            v.Critical = v.Entries.Where(e => e.Group == ImpactGroup.Critical).ToList();
            v.CriticalCount = v.Critical.Count;
            v.ReviewCount = v.Entries.Count(e => e.Group == ImpactGroup.Review);
            return v;
        }

        private static void FillCounts(DoorMoveView v, PreChangeReport r)
        {
            if (r == null) return;
            v.NewClashCount = r.Items.Count(i => i.Truth == TruthState.Confirmed && i.Severity >= ItemSeverity.Warning
                && (i.Code == ItemCodes.ClashNew || i.Code == ItemCodes.DoorStructureClash || i.Code == ItemCodes.DoorFurnitureClash));
            v.OpeningOverlapCount = r.Items.Count(i => i.Code == ItemCodes.DoorOpeningOverlap);
            v.SheetCount = Math.Max(r.DistinctSheetCount, r.Items.Where(i => i.Code == ItemCodes.Sheet).Select(i => i.Id).Distinct().Count());
        }

        private static string FirstText(List<TopImpactRow> top)
        {
            return top.Count > 0 ? top[0].Text : null;
        }

        private static ItemSeverity ToneOf(MoveDecision d)
        {
            switch (d.Verdict)
            {
                case MoveVerdict.DoNotMove: return ItemSeverity.Critical;
                case MoveVerdict.MoveWithReview: return ItemSeverity.Warning;
                case MoveVerdict.MoveOk: return ItemSeverity.Ok;
                default: return ItemSeverity.Ok;
            }
        }

        private static TopImpactRow TopOf(DecisionReason r, PreChangeReport rep)
        {
            PreChangeItem it = string.IsNullOrEmpty(r.ItemKey) ? null : rep.Items.FirstOrDefault(i => i.Key == r.ItemKey);
            return new TopImpactRow
            {
                Text = r.Text, Tone = it != null ? it.Severity : (r.Priority <= 9 ? ItemSeverity.Critical : ItemSeverity.Warning),
                ItemKey = r.ItemKey, Id = r.Id, Kind = r.Kind, TargetKey = it != null ? it.TargetKey : null,
            };
        }

        private static List<ImpactCounter> BuildCounters(List<ImpactEntry> entries, ImpactGroup? filter)
        {
            Func<ImpactGroup, string, ImpactCounter> mk = (g, title) => new ImpactCounter { Key = g.ToString(), Title = title, Count = DoorImpactGroups.Count(entries, g), Group = g, Active = filter.HasValue && filter.Value == g };
            return new List<ImpactCounter>
            {
                new ImpactCounter { Key = "all", Title = "БҮГД", Count = entries.Count, Group = null, Active = !filter.HasValue },
                mk(ImpactGroup.Critical, "Ноцтой"),
                mk(ImpactGroup.Review, "Хянах"),
                mk(ImpactGroup.Changed, "Өөрчлөгдөнө"),
                mk(ImpactGroup.Safe, "Хэвийн"),
                mk(ImpactGroup.NotEvaluated, "Тооцоогүй"),
            };
        }

        private static string HeadlineOf(PreChangeSelection d)
        {
            if (d == null) return "";
            var parts = new List<string>();
            parts.Add(string.IsNullOrWhiteSpace(d.Mark) ? (d.Label ?? "Хаалга") : d.Mark);
            if (d.DoorWidthMm > 0 && d.DoorHeightMm > 0) parts.Add(Math.Round(d.DoorWidthMm).ToString("0", CultureInfo.InvariantCulture) + " × " + Math.Round(d.DoorHeightMm).ToString("0", CultureInfo.InvariantCulture));
            if (!string.IsNullOrWhiteSpace(d.LevelName)) parts.Add(d.LevelName);
            return string.Join(" · ", parts);
        }

        private static string RoomsOf(PreChangeSelection d)
        {
            if (d == null) return null;
            bool f = !string.IsNullOrWhiteSpace(d.FromRoom), t = !string.IsNullOrWhiteSpace(d.ToRoom);
            if (!f && !t) return null;
            return (f ? d.FromRoom : "гадна") + " ↔ " + (t ? d.ToRoom : "гадна");
        }

        private static DoorDocSummary DocsOf(PreChangeReport r)
        {
            var s = new DoorDocSummary();
            s.Dimensions = r.Items.Count(i => i.Code == ItemCodes.DimChanged || i.Code == ItemCodes.DimReview);
            PreChangeItem tags = r.Items.FirstOrDefault(i => i.Code == ItemCodes.Tags);
            s.Tags = tags != null && tags.AfterValue.HasValue ? (int)tags.AfterValue.Value : 0;
            s.Schedules = r.Items.Count(i => i.Code == ItemCodes.ScheduleChanged || i.Code == ItemCodes.ScheduleReview);
            s.Sheets = Math.Max(r.DistinctSheetCount, r.Items.Where(i => i.Code == ItemCodes.Sheet).Select(i => i.Id).Distinct().Count());
            s.ViewsText = PreChangeText.ViewBreakdown(r.Items.Where(i => i.Code == ItemCodes.View && !string.IsNullOrEmpty(i.ViewType)).Select(i => i.ViewType));
            var parts = new List<string>();
            if (s.Dimensions > 0) parts.Add(s.Dimensions + " хэмжээс");
            if (s.Tags > 0) parts.Add(s.Tags + " tag");
            if (s.Schedules > 0) parts.Add(s.Schedules + " хүснэгт");
            if (!string.IsNullOrEmpty(s.ViewsText)) parts.Add(s.ViewsText);
            if (s.Sheets > 0) parts.Add(s.Sheets + " хуудас");
            s.Line = parts.Count == 0 ? null : string.Join(" · ", parts);
            return s;
        }

        private static DoorClearanceView ClearanceOf(PreChangeReport r)
        {
            PreChangeItem ch = r.Items.FirstOrDefault(i => i.Code == ItemCodes.ClearanceChanged);
            if (ch != null)
                return new DoorClearanceView { Evaluated = true, Before = ch.Before, After = ch.After, Delta = ch.Delta, Note = "Геометрээр хэмжсэн. Нормын шалгалт биш." };
            PreChangeItem ne = r.Items.FirstOrDefault(i => i.Code == ItemCodes.ClearanceNe);
            if (ne != null) return new DoorClearanceView { Evaluated = false, Note = "Орчны зай: тооцоолоогүй — " + ne.Why };
            return null;
        }

        private static string TechInfo(DoorSimulationController c)
        {
            var parts = new List<string>();
            parts.Add("generation " + c.Generation);
            if (c.Fast != null) parts.Add("fast scan " + Math.Round(c.Fast.ElapsedMs, 2).ToString("0.##", CultureInfo.InvariantCulture) + " мс");
            if (c.Timings.GhostUpdateMs > 0) parts.Add("ghost " + Math.Round(c.Timings.GhostUpdateMs, 2).ToString("0.##", CultureInfo.InvariantCulture) + " мс");
            if (c.Timings.RenderMs > 0) parts.Add("UI " + Math.Round(c.Timings.RenderMs, 1).ToString("0.#", CultureInfo.InvariantCulture) + " мс");
            DoorSimulationTimings t = c.Timings;
            if (t.ExactToProvisionalMs > 0) parts.Add("түр дүн " + t.ExactToProvisionalMs + " мс");
            if (t.ExactToFinalMs > 0) parts.Add("эцсийн дүн " + t.ExactToFinalMs + " мс");
            if (t.ApplyMs > 0) parts.Add("зөөлт " + t.ApplyMs + " мс");
            parts.Add("шинжилгээ " + t.ExactCount + ", цуцалсан " + t.CancelledCount + ", хожуу ирсэн " + t.LateIgnoredCount);
            return string.Join(" · ", parts);
        }
    }
}
