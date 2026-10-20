using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;

namespace RevitMcpAddin.ChangeImpact.Core
{
    public enum FastFindingKind
    {
        /// <summary>Шинэ байрлал хост ханын гадна — Revit хийлгэхгүй (тодорхойлогдсон).</summary>
        OutsideHost = 0,
        /// <summary>Хоёр нүхний ХОСТ ДАГУУХ интервал, ХОЁУЛАНГ НЬ өргөн мэдэгдэж байхад давхцана (геометрийн тоон баталгаа).</summary>
        OpeningOverlap,
        /// <summary>Нүх давхцаж болзошгүй, гэхдээ аль нэгийн өргөн мэдэгдэхгүй — батлах боломжгүй.</summary>
        OpeningOverlapUnverified,
        /// <summary>Нүх ханын төгсгөлд (эсвэл холбогдсон хананд) хэт ойр.</summary>
        WallEnd,
        /// <summary>Замын дундуур өөр хаалга/цонх/нүх байна (дараалал солигдоно).</summary>
        PathCrossesOpening,
        /// <summary>Эцсийн байрлалд элементийн хайрцагтай давхцана (bbox — батлагдаагүй нэр дэвшигч).</summary>
        FinalCandidate,
        /// <summary>Зөвхөн замд (эцсийн байрлалд биш) — мэдээлэл.</summary>
        PathCandidate,
        /// <summary>Хаалга одоогийн байрлалдаа ч энэ нүхтэй аль хэдийн давхцаж байсан — шинэ биш.</summary>
        StartOverlap,
    }

    public sealed class FastFinding
    {
        public FastFindingKind Kind { get; set; }
        public ItemSeverity Severity { get; set; }
        /// <summary>`Confirmed` = тоон/геометрийн ТООЦОО хийн батлагдсан (интервал); `Review` = bbox/таамаг нэр дэвшигч.</summary>
        public TruthState Truth { get; set; }
        public long Id { get; set; }
        public long LinkInstanceId { get; set; }
        public string Label { get; set; }
        public ObstacleKind ObstacleKind { get; set; }
        public double[] BoxMm { get; set; }
        public string Text { get; set; }
        public double? Mm { get; set; }
        /// <summary>Эцсийн байрлалд (final) уу, зам дунд (path) уу.</summary>
        public bool IsFinal { get; set; }
        public bool IsPath { get; set; }
    }

    /// <summary>ТҮР (урьдчилсан) дүн — fast scan.  Sandbox-оор батлагдаагүй; «ногоон» ХЭЗЭЭ Ч үүсгэхгүй.</summary>
    public sealed class DoorFastResult
    {
        public double OffsetMm { get; set; }
        public DoorTargetCheck Check { get; set; }
        public SweepEnvelope Envelope { get; set; }
        public List<FastFinding> Findings { get; set; } = new List<FastFinding>();
        /// <summary>Нэр дэвшигч цуглуулалт бүрэн дууссан эсэх (context-ийн `IncompleteReasons` хоосон).</summary>
        public bool Complete { get; set; }
        public double ElapsedMs { get; set; }

        public int CriticalCount { get { return Findings.Count(f => f.Severity == ItemSeverity.Critical); } }
        public int ReviewCount { get { return Findings.Count(f => f.Severity >= ItemSeverity.Notice && f.Severity != ItemSeverity.Critical); } }

        /// <summary>Урьдчилсан өнгө: 🔴 тоон баталгаатай ноцтой, 🟠 нэр дэвшигч/хянах, ⚪ хүндрэл олдоогүй (ЭЦСИЙН ШАЛГАЛТ ХҮЛЭЭГДЭЖ БАЙНА).</summary>
        public ApplyTone Tone
        {
            get
            {
                if (Check != null && !Check.Ok && Check.Refused) return ApplyTone.Red;
                if (CriticalCount > 0) return ApplyTone.Red;
                if (ReviewCount > 0) return ApplyTone.Amber;
                return ApplyTone.Gray;
            }
        }

        public bool CanSimulate { get { return Check != null && Check.Ok; } }
    }

    /// <summary>
    /// LEVEL 1 — ШУУРХАЙ ТААМАГЛАЛТ (predictive).  Цэвэр тоо (хост параметр, интервал, хайрцаг): &lt; 50 мс.
    /// Зорилт нь ghost-ийн өнгө, «хэн хэнтэй давхцах бололцоотой»-г хэрэглэгч товч дарах бүрт ТУН ШУУД харуулах.
    ///
    /// ТЭМДЭГЛЭЛ (үнэний загвар):
    ///   • Хоёр нүхний интервалын давхцал (хоёулаа өргөн мэдэгдсэн) — `Confirmed` + 🔴: энэ нь Revit-ийн нүхний геометрийг тоогоор давтсан шалгалт.
    ///   • Өргөн мэдэгдэхгүй, bbox-ийн давхцал, замын нэр дэвшигч — `Review`.  bbox-оор «clash» ХЭЗЭЭ Ч «батлагдахгүй».
    /// Эцсийн (🔴/🟠/🟢) дүгнэлтийг sandbox шийднэ.
    /// </summary>
    public static class DoorFastScan
    {
        public static DoorFastResult Run(DoorMoveContext ctx, double offsetMm)
        {
            var sw = Stopwatch.StartNew();
            var r = new DoorFastResult { OffsetMm = offsetMm };
            r.Check = DoorHostMath.Check(ctx, offsetMm);
            if (ctx == null || ctx.Host == null || ctx.Door == null)
            {
                r.ElapsedMs = sw.Elapsed.TotalMilliseconds;
                return r;
            }
            r.Complete = ctx.IncompleteReasons.Count == 0;
            r.Envelope = DoorSweep.Envelope(ctx, offsetMm);

            if (!r.Check.Ok)
            {
                if (r.Check.Code == "outside.host")
                    r.Findings.Add(new FastFinding
                    {
                        Kind = FastFindingKind.OutsideHost, Severity = ItemSeverity.Critical, Truth = TruthState.Confirmed,
                        Label = ctx.Door.Label, Text = r.Check.Problem, IsFinal = true,
                    });
                r.ElapsedMs = sw.Elapsed.TotalMilliseconds;
                return r;
            }

            OpeningFindings(ctx, r);
            WallEndFindings(ctx, r);
            ObstacleFindings(ctx, offsetMm, r);

            r.Findings = r.Findings
                .OrderByDescending(f => (int)f.Severity)
                .ThenBy(f => (int)f.Kind)
                .ThenBy(f => f.Label ?? "", StringComparer.Ordinal)
                .ThenBy(f => f.Id)
                .ToList();
            r.ElapsedMs = sw.Elapsed.TotalMilliseconds;
            return r;
        }

        private static void OpeningFindings(DoorMoveContext ctx, DoorFastResult r)
        {
            double tol = PreChangeTolerance.LengthMm;
            DoorBody d = ctx.Door;
            double s0 = d.CenterParamMm, s1 = r.Check.TargetParamMm;
            double half = DoorHostMath.HalfWidth(d);
            double pathLo = Math.Min(s0, s1), pathHi = Math.Max(s0, s1);

            foreach (OpeningSpan o in ctx.Openings.OrderBy(x => x.Id))
            {
                if (o.Id == d.Id) continue;
                double oHalf = o.WidthKnown ? o.WidthMm / 2.0 : 0;
                double oLo = o.CenterParamMm - oHalf, oHi = o.CenterParamMm + oHalf;
                // Босоо (Z) давхцал: хаалганы дээгүүр transom цонх, шалнаас дээш өргөгдсөн цонх зэрэг НЭГ ХАНАН ДЭЭР ч огтлолцохгүй.  Z мэдэгдэж, огтлолцохгүй бол алгасна;
                // Z уншигдаагүй бол «батлагдсан» БИШ — Review (нүхний өргөн мэдэгдэхгүй тохиолдолтой ИЖИЛ).
                bool zKnown = d.ZMaxMm > d.ZMinMm && o.BoxMm != null && o.BoxMm.Length >= 6;
                if (zKnown && DoorHostMath.Overlap(d.ZMinMm, d.ZMaxMm, Math.Min(o.BoxMm[2], o.BoxMm[5]), Math.Max(o.BoxMm[2], o.BoxMm[5])) <= tol) continue;
                bool bothKnown = d.WidthKnown && o.WidthKnown && zKnown;
                string label = string.IsNullOrWhiteSpace(o.Label) ? ObstacleKinds.Label(o.Kind) + " #" + o.Id : o.Label;

                double finalOv = DoorHostMath.Overlap(r.Check.IntervalStartMm, r.Check.IntervalEndMm, oLo, oHi);
                double startOv = DoorHostMath.Overlap(s0 - half, s0 + half, oLo, oHi);

                if (bothKnown)
                {
                    if (finalOv > tol)
                    {
                        bool preExisting = startOv > tol && finalOv <= startOv + tol;
                        r.Findings.Add(new FastFinding
                        {
                            Kind = preExisting ? FastFindingKind.StartOverlap : FastFindingKind.OpeningOverlap,
                            Severity = preExisting ? ItemSeverity.Notice : ItemSeverity.Critical,
                            Truth = TruthState.Confirmed,
                            Id = o.Id, Label = label, ObstacleKind = o.Kind, IsFinal = true, Mm = finalOv,
                            Text = preExisting
                                ? d.Label + " нь " + label + "-ийн нүхтэй өмнө нь ч давхцаж байсан (" + PreChangeText.Mm(startOv) + ")."
                                : d.Label + " нь " + label + "-ийн нүхтэй " + PreChangeText.Mm(finalOv) + " давхцана.",
                        });
                        continue;
                    }
                }
                else
                {
                    // Өргөн мэдэгдэхгүй: төвийн зайг мэдэгдэж буй хагас өргөнтэй харьцуулна — батлах БОЛОМЖГҮЙ тул Review.
                    double knownHalf = Math.Max(half, oHalf);
                    double dist = Math.Abs(s1 - o.CenterParamMm);
                    if (dist <= knownHalf + tol)
                    {
                        r.Findings.Add(new FastFinding
                        {
                            Kind = FastFindingKind.OpeningOverlapUnverified, Severity = ItemSeverity.Warning, Truth = TruthState.Review,
                            Id = o.Id, Label = label, ObstacleKind = o.Kind, IsFinal = true, Mm = dist,
                            Text = d.Label + " нь " + label + "-тай давхцаж магадгүй — нүхний өргөнг найдвартай тодорхойлж чадсангүй.",
                        });
                        continue;
                    }
                }

                // Эцсийн байрлалд давхцахгүй, гэхдээ замын дундуур (хоёр байрлалын хооронд) байна → дараалал солигдоно.
                if (o.CenterParamMm > pathLo + tol && o.CenterParamMm < pathHi - tol)
                    r.Findings.Add(new FastFinding
                    {
                        Kind = FastFindingKind.PathCrossesOpening, Severity = ItemSeverity.Notice, Truth = TruthState.Confirmed,
                        Id = o.Id, Label = label, ObstacleKind = o.Kind, IsPath = true,
                        Text = d.Label + " нь " + label + "-ийг дайран зөөгдөнө — ханан дээрх дараалал солигдоно.",
                    });
            }
        }

        private static void WallEndFindings(DoorMoveContext ctx, DoorFastResult r)
        {
            double tol = PreChangeTolerance.LengthMm;
            DoorTargetCheck c = r.Check;
            WallEndFinding(r, ctx, "эхлэл", c.GapToStartMm, ctx.Host.StartJoinThicknessMm, tol);
            WallEndFinding(r, ctx, "төгсгөл", c.GapToEndMm, ctx.Host.EndJoinThicknessMm, tol);
        }

        private static void WallEndFinding(DoorFastResult r, DoorMoveContext ctx, string endName, double gap, double joinThickness, double tol)
        {
            if (gap <= tol)
            {
                r.Findings.Add(new FastFinding
                {
                    Kind = FastFindingKind.WallEnd, Severity = ItemSeverity.Warning, Truth = TruthState.Review, Label = ctx.Host.Label, IsFinal = true, Mm = gap,
                    Text = ctx.Door.Label + "-ийн нүх ханын " + endName + "тэй шүргэнэ (үлдэх хана " + PreChangeText.Mm(Math.Max(0, gap)) + ").",
                });
                return;
            }
            if (joinThickness > 0 && gap < joinThickness / 2.0 - tol)
                r.Findings.Add(new FastFinding
                {
                    Kind = FastFindingKind.WallEnd, Severity = ItemSeverity.Warning, Truth = TruthState.Review, Label = ctx.Host.Label, IsFinal = true, Mm = gap,
                    Text = ctx.Door.Label + "-ийн нүх ханын " + endName + "д холбогдсон хананы зузаанд (" + PreChangeText.Mm(joinThickness) + ") хүрнэ — ханын зах " + PreChangeText.Mm(gap) + ".",
                });
        }

        private static void ObstacleFindings(DoorMoveContext ctx, double offsetMm, DoorFastResult r)
        {
            foreach (SweepHit h in DoorSweep.Scan(ctx, offsetMm))
            {
                ObstacleBox o = h.Obstacle;
                string label = string.IsNullOrWhiteSpace(o.Label) ? ObstacleKinds.Label(o.Kind) + " #" + o.Id : o.Label;
                if (h.AtStart && h.AtFinal) continue;     // өмнө нь ч давхцаж байсан — шинэ нөлөө биш (exact шат тайлбарлана)
                if (h.IsNewFinal)
                {
                    r.Findings.Add(new FastFinding
                    {
                        Kind = FastFindingKind.FinalCandidate, Severity = ItemSeverity.Warning, Truth = TruthState.Review,
                        Id = o.Id, LinkInstanceId = o.LinkInstanceId, Label = label, ObstacleKind = o.Kind, BoxMm = o.BoxMm, IsFinal = true, Mm = h.FinalOverlapMm,
                        Text = label + " — шинэ байрлалд хаалганы хайрцагтай давхцана (урьдчилсан, геометрээр батлагдаагүй).",
                    });
                }
                else if (h.IsPathOnly)
                {
                    r.Findings.Add(new FastFinding
                    {
                        Kind = FastFindingKind.PathCandidate, Severity = ItemSeverity.Notice, Truth = TruthState.Review,
                        Id = o.Id, LinkInstanceId = o.LinkInstanceId, Label = label, ObstacleKind = o.Kind, BoxMm = o.BoxMm, IsPath = true,
                        Text = label + " — хөдөлгөөний замд байна; эцсийн байрлалд огтлолцохгүй.",
                    });
                }
            }
        }

        public static string Summary(DoorFastResult r)
        {
            if (r == null || r.Check == null) return "";
            if (!r.Check.Ok) return r.Check.Problem ?? "";
            if (r.CriticalCount == 0 && r.ReviewCount == 0) return "Урьдчилсан: хүндрэл илрээгүй — эцсийн шалгалт хийгдэж байна.";
            return "Урьдчилсан: " + r.CriticalCount.ToString(CultureInfo.InvariantCulture) + " ноцтой, " + r.ReviewCount.ToString(CultureInfo.InvariantCulture) + " хянах.";
        }
    }
}
