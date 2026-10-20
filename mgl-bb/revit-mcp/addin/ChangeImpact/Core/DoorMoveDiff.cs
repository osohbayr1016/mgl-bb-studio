using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using RevitMcpAddin.ClashCheck.Core;

namespace RevitMcpAddin.ChangeImpact.Core
{
    /// <summary>
    /// «Хаалга зөөх» үйлдлийн ДИФФ-ийн хаалганд ХАМААРАХ хэсэг.  Бусад (өрөө, хэмжээс, харагдац/хуудас, хүснэгт, гарц, норм, failure) нь
    /// `PreChangeDiff.Compute`-ийн ХУВААЛЦСАН код — энд ДАХИН БИЧИГДЭЭГҮЙ.
    ///
    /// ХОЁР ТӨРЛИЙН НӨЛӨӨ (тусад нь):
    ///   A. ЗАМЫН нөлөө — одоогийн ба шинэ байрлалын ХООРОНД юу байна (хайрцгийн broad-phase, `DoorSweep`).
    ///   B. ЭЦСИЙН БАЙРЛАЛЫН нөлөө — хаалга ТЭНД очвол юу болох (sandbox-ийн settled төлөв + GeometryVerifier).
    ///
    /// ҮНЭНИЙ ЗАГВАР:
    ///   • Нүхний интервалын давхцал (хоёулаа өргөн мэдэгдсэн) → `Confirmed` 🔴 (Revit-ийн параметрийн тоон тооцоо).
    ///   • Багана/бүтэц/хана/MEP-тэй БАТЛАГДСАН геометр огтлолцол (ӨМНӨ нь огтлолцоогүй) → `Confirmed` 🔴.
    ///   • Тавилга/төхөөрөмжтэй батлагдсан огтлолцол → `Confirmed` 🟠 (хянах).
    ///   • bbox-ийн давхцал ганцаараа → `Review` нэр дэвшигч (ХЭЗЭЭ Ч 🔴 биш).  Exact шатанд геометрээр «огтлолцохгүй» нь батлагдвал «шалгагдсан» болно.
    ///   • Замын нэр дэвшигч (эцсийн байрлалд огтлолцохгүй) → мэдээлэл (verdict-д нөлөөлөхгүй).
    /// </summary>
    internal static class DoorMoveDiff
    {
        internal static string LabelOf(PreChangeRequest req, DoorMoveContext ctx, StateSnapshot before)
        {
            if (ctx != null && ctx.Door != null && !string.IsNullOrWhiteSpace(ctx.Door.Label)) return ctx.Door.Label;
            if (req != null && !string.IsNullOrWhiteSpace(req.SourceLabel)) return req.SourceLabel;
            HostedSnap b;
            if (before != null && req != null && before.Hosted.TryGetValue(req.SourceId, out b) && !string.IsNullOrWhiteSpace(b.Mark)) return b.Mark;
            return "Хаалга";
        }

        internal static void Build(PreChangeReport r, PreChangeInput inp, StateSnapshot before, StateSnapshot after, IncompleteSink inc, bool quick)
        {
            PreChangeRequest req = inp.Request;
            DoorMoveContext ctx = inp.Door;
            string label = LabelOf(req, ctx, before);

            DoorItems(r, req, ctx, before, after, label, inc);
            if (ctx == null)
                inc.Req("Хаалганы хамаарлын контекст байхгүй — нүхний давхцал, замын нөлөөг шалгаж чадсангүй.");
            else
                GeometryItems(r, req, ctx, label, before, after, quick, inc);
            RoomItems(r, req, label, before, after);
            if (!quick) ClearanceItems(r, req, label, before, after);

            r.Items.Add(new PreChangeItem
            {
                Key = "door:swing", Code = ItemCodes.DoorSwingNe, Category = PreChangeCategory.Clearance, Truth = TruthState.NotEvaluated, Severity = ItemSeverity.Ok,
                Title = "Хаалганы дүүжин (swing): тооцоолоогүй",
                Why = "Family-ийн найдвартай дүүжингийн геометр олдохгүй тул зохиож тооцоолоогүй. Дүүжингийн зайг нормоор шалгахгүй.", Kind = ImpactNodeKind.Element,
            });
        }

        /* ============================== ХААЛГА ӨӨРӨӨ ======================== */

        private static void DoorItems(PreChangeReport r, PreChangeRequest req, DoorMoveContext ctx, StateSnapshot before, StateSnapshot after, string label, IncompleteSink inc)
        {
            HostedSnap b, a;
            bool hb = before.Hosted.TryGetValue(req.SourceId, out b);
            bool ha = after.Hosted.TryGetValue(req.SourceId, out a);

            if (after.Captured && (after.SourceDeleted || (ha && !a.Exists)))
            {
                r.Items.Add(new PreChangeItem
                {
                    Key = "door:lost", Code = ItemCodes.DoorLost, Subject = label, Category = PreChangeCategory.Model, Truth = TruthState.Confirmed, Severity = ItemSeverity.Critical,
                    Title = label + " өөрөө загварт алга болно", Why = "Хөдөлгөөний дараа хаалга загварт олдохгүй байна (Revit устгасан).",
                    Id = req.SourceId, Kind = ImpactNodeKind.Element,
                });
                return;
            }
            if (!hb || !b.Exists) { inc.Req("Хаалгыг ӨМНӨХ төлөвт уншиж чадсангүй — ялгааг тодорхойлох боломжгүй."); return; }
            if (!ha) { if (after.Captured) inc.Req("Хаалгыг ДАРААХ төлөвт уншиж чадсангүй — ялгааг тодорхойлох боломжгүй."); return; }

            // Хост хэвээр үү?
            if (b.HostKnown && a.HostKnown)
            {
                if (b.HostId != a.HostId)
                {
                    r.Items.Add(new PreChangeItem
                    {
                        Key = "door:hostlost", Code = ItemCodes.HostLost, Subject = label, Category = PreChangeCategory.Hosted, Truth = TruthState.Confirmed, Severity = ItemSeverity.Critical,
                        Title = label + " ханаасаа сална", Why = "Хөдөлгөөний дараа хаалга ӨӨРИЙН хост ханыг алдаж, өөр хост руу шилжинэ/хостгүй болно.",
                        Id = req.SourceId, Kind = ImpactNodeKind.Element,
                    });
                    return;
                }
            }
            else inc.Req("Хаалганы хостыг уншиж чадсангүй — хост хэвээр үлдэх эсэх тодорхойлогдоогүй.");

            // Байрлал: хүссэн вектортой ижил үү?
            double[] disp = PreChangeTolerance.DiffMm(b.LocationMm, a.LocationMm);
            if (disp == null) inc.Req("Хаалганы байрлалыг уншиж чадсангүй — хүссэн байрлалд очих эсэх тодорхойлогдоогүй.");
            else
            {
                double[] vec = req.VectorMm;
                double dev = Math.Sqrt(Sq(disp[0] - vec[0]) + Sq(disp[1] - vec[1]) + Sq(disp[2] - vec[2]));
                double moved = PreChangeTolerance.LengthOfMm(disp);
                if (dev > PreChangeTolerance.LengthMm * 2)
                {
                    r.Items.Add(new PreChangeItem
                    {
                        Key = "door:deviated", Code = ItemCodes.DoorDeviated, Subject = label, Category = PreChangeCategory.Hosted, Truth = TruthState.Confirmed, Severity = ItemSeverity.Warning,
                        Title = label + ": Revit хүссэнээс ӨӨР хэмжээгээр зөөнө",
                        Before = PreChangeText.Mm(req.DistanceMm) + " (хүссэн)", After = PreChangeText.Mm(moved) + " (Revit)", Delta = PreChangeText.DeltaMm(moved - req.DistanceMm),
                        Why = "Revit хаалгыг хост, хязгаарлалтаас хамааран өөр байрлалд суулгана — preview энэ бодит байрлалыг харуулж байна.",
                        Id = req.SourceId, Kind = ImpactNodeKind.Element, DeltaValue = moved - req.DistanceMm,
                    });
                }
                else
                {
                    r.Items.Add(new PreChangeItem
                    {
                        Key = "door:moved", Code = ItemCodes.DoorMoved, Subject = label, Category = PreChangeCategory.Hosted, Truth = TruthState.Confirmed, Severity = ItemSeverity.Ok,
                        Title = label + " хүссэн байрлалдаа очно", After = PreChangeText.Mm(moved), Why = "Revit хаалгыг хост ханан дээр хүссэн зайгаар суулгана (sandbox-д хэмжсэн).",
                        Id = req.SourceId, Kind = ImpactNodeKind.Element, DeltaValue = moved,
                    });
                }
            }

            // Эргэлт (flip)
            if (b.FlipKnown && a.FlipKnown)
            {
                if (b.FacingFlipped != a.FacingFlipped || b.HandFlipped != a.HandFlipped)
                    r.Items.Add(new PreChangeItem
                    {
                        Key = "door:flip", Code = ItemCodes.DoorFlip, Subject = label, Category = PreChangeCategory.Hosted, Truth = TruthState.Confirmed, Severity = ItemSeverity.Warning,
                        Title = label + ": нээгдэх чиглэл (flip) өөрчлөгдөнө",
                        Why = "Хөдөлгөөний дараа хаалганы facing/hand flip өөр боллоо — нээгдэх тал солигдоно, гараар хянана уу.",
                        Id = req.SourceId, Kind = ImpactNodeKind.Element,
                    });
            }
            else inc.Adv("Хаалганы эргэлтийг (flip) уншиж чадсангүй — нээгдэх чиглэл хэвээр эсэх тодорхойлогдоогүй.");
        }

        private static double Sq(double v) { return v * v; }

        /* ============================== ГЕОМЕТР: ЗАМ + ЭЦСИЙН БАЙРЛАЛ ======= */

        private static void GeometryItems(PreChangeReport r, PreChangeRequest req, DoorMoveContext ctx, string label, StateSnapshot before, StateSnapshot after, bool quick, IncompleteSink inc)
        {
            DoorFastResult fast = DoorFastScan.Run(ctx, req.OffsetMm);
            if (!ctx.Door.WidthKnown) inc.Adv("Хаалганы нүхний өргөнг тодорхойлж чадсангүй — нүхний давхцлыг зөвхөн төвөөр шалгав.");
            else if (ctx.Door.WidthSource == WidthSource.BBox) r.Notes.Add("Хаалганы нүхний өргөнг bounding box-оос (ойролцоо) уншсан.");
            foreach (string reason in ctx.IncompleteReasons) inc.Adv(reason);

            foreach (FastFinding f in fast.Findings)
            {
                switch (f.Kind)
                {
                    case FastFindingKind.OutsideHost:
                        r.Items.Add(new PreChangeItem
                        {
                            Key = "door:outside", Code = ItemCodes.DoorOutsideHost, Subject = label, Category = PreChangeCategory.Opening, Truth = TruthState.Confirmed, Severity = ItemSeverity.Critical,
                            Title = f.Text, Why = "Хаалга ӨӨРИЙН хост ханан дээр үлдэх ёстой — шинэ байрлал ханын гадна.", Id = req.SourceId, Kind = ImpactNodeKind.Element,
                        });
                        break;
                    case FastFindingKind.OpeningOverlap:
                        r.Items.Add(OpeningOverlapItem(f, label));
                        break;
                    case FastFindingKind.OpeningOverlapUnverified:
                        r.Items.Add(new PreChangeItem
                        {
                            Key = "door-opening:" + f.Id, Code = ItemCodes.DoorOpeningUnverified, Subject = f.Label, Category = PreChangeCategory.Opening, Truth = TruthState.Review, Severity = ItemSeverity.Warning,
                            Title = f.Text, Why = "Нүхний өргөнг Revit-ийн параметрээс тодорхойлж чадаагүй тул давхцлыг БАТЛАХ боломжгүй — гараар хянана уу.",
                            Id = f.Id, Kind = ImpactNodeKind.Element, TargetKey = "0:" + f.Id,
                        });
                        break;
                    case FastFindingKind.WallEnd:
                        r.Items.Add(new PreChangeItem
                        {
                            Key = "door:wallend:" + (f.Mm.HasValue ? Math.Round(f.Mm.Value).ToString("0", CultureInfo.InvariantCulture) : "x"), Code = ItemCodes.DoorWallEnd, Subject = label,
                            Category = PreChangeCategory.Opening, Truth = TruthState.Review, Severity = ItemSeverity.Warning,
                            Title = f.Text, Why = "Нүх ханын төгсгөл/холбогдсон хананд ойр — геометрийн ойролцоо хэмжилт; нормын хамгийн бага зайгаар шалгаагүй.",
                            Id = ctx.Host.Id, Kind = ImpactNodeKind.Element, TargetKey = "0:" + ctx.Host.Id,
                        });
                        break;
                    case FastFindingKind.PathCrossesOpening:
                        r.Items.Add(new PreChangeItem
                        {
                            Key = "door-path:" + f.Id, Code = ItemCodes.DoorPathCrossing, Subject = f.Label, Category = PreChangeCategory.Opening, Truth = TruthState.Confirmed, Severity = ItemSeverity.Notice,
                            Title = f.Text, Why = "Хаалга ханан дээрх өөр нүхийг дайрч зөөгдөх тул хаалга/цонхны дараалал (дугаарлалт, хүснэгтийн эрэмбэ) өөрчлөгдөж болно.",
                            Id = f.Id, Kind = ImpactNodeKind.Element, TargetKey = "0:" + f.Id,
                        });
                        break;
                    case FastFindingKind.StartOverlap:
                        r.Notes.Add(f.Text);
                        break;
                }
            }

            ObstacleItems(r, req, ctx, label, fast, before, after, quick, inc);
        }

        private static PreChangeItem OpeningOverlapItem(FastFinding f, string label)
        {
            return new PreChangeItem
            {
                Key = "door-opening:" + f.Id, Code = ItemCodes.DoorOpeningOverlap, Subject = f.Label, Category = PreChangeCategory.Opening, Truth = TruthState.Confirmed, Severity = ItemSeverity.Critical,
                Title = f.Text, After = f.Mm.HasValue ? PreChangeText.Mm(f.Mm.Value) + " давхцана" : null, Before = "давхцаагүй",
                Why = "Нэг ханан дээрх хоёр нүх хост дагуу давхцаж байна — нүхний өргөнг параметрээс уншиж тоон интервалаар тооцсон.",
                Id = f.Id, Kind = ImpactNodeKind.Element, DeltaValue = f.Mm, TargetKey = "0:" + f.Id,
            };
        }

        private static string Subj(string label, long id, ObstacleKind k)
        {
            return string.IsNullOrWhiteSpace(label) ? ObstacleKinds.Label(k) + " #" + id : label;
        }

        private static void ObstacleItems(PreChangeReport r, PreChangeRequest req, DoorMoveContext ctx, string doorLabel, DoorFastResult fast, StateSnapshot before, StateSnapshot after, bool quick, IncompleteSink inc)
        {
            List<FastFinding> finals = fast.Findings.Where(f => f.Kind == FastFindingKind.FinalCandidate).ToList();
            List<FastFinding> paths = fast.Findings.Where(f => f.Kind == FastFindingKind.PathCandidate).ToList();

            foreach (FastFinding f in paths) r.Items.Add(PathCandidateItem(f));

            if (quick)
            {
                foreach (FastFinding f in finals) r.Items.Add(CandidateItem(f, "Урьдчилсан (bounding box)"));
                return;
            }

            ClashSnap b = before.Clash ?? new ClashSnap(), a = after.Clash ?? new ClashSnap();
            if (!b.Evaluated || !a.Evaluated)
            {
                string reason = !string.IsNullOrWhiteSpace(a.NotEvaluatedReason) ? a.NotEvaluatedReason : b.NotEvaluatedReason;
                r.Items.Add(new PreChangeItem
                {
                    Key = "clash:ne", Code = ItemCodes.ClashNe, Category = PreChangeCategory.Clash, Truth = TruthState.NotEvaluated, Severity = ItemSeverity.Ok,
                    Title = "Огтлолцол (MEP, бүтэц, тавилга): тооцоолоогүй", Why = string.IsNullOrWhiteSpace(reason) ? "Геометрийн шалгалт хийгдсэнгүй." : reason, Kind = ImpactNodeKind.Element,
                });
                inc.Req("Огтлолцлын геометр шалгалт хийгдсэнгүй" + (string.IsNullOrWhiteSpace(reason) ? "." : ": " + reason));
                foreach (FastFinding f in finals) r.Items.Add(CandidateItem(f, "Геометрээр шалгаж чадсангүй"));
                return;
            }

            inc.Req(b.IncompleteReasons);
            inc.Req(a.IncompleteReasons);
            int geoErr = a.Pairs.Values.Count(p => p.Verdict == ClashVerdict.GeometryError || p.Verdict == ClashVerdict.Unsupported)
                       + b.Pairs.Values.Count(p => p.Verdict == ClashVerdict.GeometryError || p.Verdict == ClashVerdict.Unsupported);
            if (geoErr > 0) inc.Req(geoErr + " элементийг геометрээр шалгаж чадсангүй — «огтлолцол байхгүй» гэж батлах боломжгүй.");

            int newCount = 0;
            foreach (ClashPairState p in a.Pairs.Values.Where(x => x.Verdict == ClashVerdict.ConfirmedClash).OrderBy(x => x.Key, StringComparer.Ordinal))
            {
                ClashPairState bp;
                b.Pairs.TryGetValue(p.Key, out bp);
                bool was = bp != null && bp.Verdict == ClashVerdict.ConfirmedClash;
                bool knownClean = bp == null || bp.Verdict == ClashVerdict.NoClash;
                string subj = Subj(p.OtherLabel, p.OtherId, p.OtherKind);
                string tkey = p.OtherLinkInstanceId + ":" + p.OtherId;
                long showId = string.IsNullOrEmpty(p.OtherLink) ? p.OtherId : p.OtherLinkInstanceId;
                string vol = Math.Round(p.VolumeCm3, 1).ToString("0.#", CultureInfo.InvariantCulture) + " см³";

                if (was)
                {
                    r.Items.Add(new PreChangeItem
                    {
                        Key = "clash:" + p.Key, Code = ItemCodes.ClashOld, Subject = subj, Category = PreChangeCategory.Clash, Truth = TruthState.Confirmed, Severity = ItemSeverity.Ok,
                        Title = "Хуучин огтлолцол · " + subj, Why = "Энэ огтлолцол хөдөлгөөнөөс ӨМНӨ ч байсан (хөдөлгөөнөөс үл хамаарна).", Id = showId, Kind = ImpactNodeKind.Element, TargetKey = tkey,
                    });
                    continue;
                }
                if (!knownClean)
                {
                    r.Items.Add(new PreChangeItem
                    {
                        Key = "clash:" + p.Key, Code = ItemCodes.DoorObstacleCandidate, Subject = subj, Category = PreChangeCategory.Obstacle, Truth = TruthState.Review, Severity = ItemSeverity.Warning,
                        Title = subj + " — огтлолцож байна, гэхдээ шинэ эсэхийг батлах боломжгүй",
                        Why = "Хөдөлгөөний дараа огтлолцож байна, гэхдээ ӨМНӨ ТӨЛӨВИЙГ шалгаж чадаагүй.", Id = showId, Kind = ImpactNodeKind.Element, TargetKey = tkey,
                    });
                    continue;
                }

                newCount++;
                switch (ObstacleKinds.ClassOf(p.OtherKind))
                {
                    case ObstacleClass.Mep:
                        r.Items.Add(new PreChangeItem
                        {
                            Key = "clash:" + p.Key, Code = ItemCodes.ClashNew, Subject = subj, Category = PreChangeCategory.Clash, Truth = TruthState.Confirmed, Severity = ItemSeverity.Critical,
                            Title = "Шинэ MEP огтлолцол · " + subj, Before = "огтлолцол байхгүй", After = vol,
                            Why = "Хаалганы нүхний бүсэд " + subj + " геометрээр огтлолцоно" + (string.IsNullOrEmpty(p.OtherLink) ? "." : " (линк: " + p.OtherLink + ")."),
                            Id = showId, Kind = ImpactNodeKind.Element, AfterValue = p.VolumeCm3, TargetKey = tkey,
                        });
                        break;
                    case ObstacleClass.Structural:
                        r.Items.Add(new PreChangeItem
                        {
                            Key = "clash:" + p.Key, Code = ItemCodes.DoorStructureClash, Subject = subj, Category = PreChangeCategory.Obstacle, Truth = TruthState.Confirmed, Severity = ItemSeverity.Critical,
                            Title = subj + ": хаалганы геометртэй огтлолцоно (" + ObstacleKinds.Label(p.OtherKind).ToLowerInvariant() + ")", Before = "огтлолцол байхгүй", After = vol,
                            Why = "Хаалга шинэ байрлалдаа " + subj + "-тай геометрээр (boolean intersect) огтлолцоно" + (string.IsNullOrEmpty(p.OtherLink) ? "." : " (линк: " + p.OtherLink + ")."),
                            Id = showId, Kind = ImpactNodeKind.Element, AfterValue = p.VolumeCm3, TargetKey = tkey,
                        });
                        break;
                    case ObstacleClass.Opening:
                        r.Items.Add(new PreChangeItem
                        {
                            Key = "door-opening:" + p.OtherId, Code = ItemCodes.DoorOpeningOverlap, Subject = subj, Category = PreChangeCategory.Opening, Truth = TruthState.Confirmed, Severity = ItemSeverity.Critical,
                            Title = doorLabel + " нь " + subj + "-тай геометрээр огтлолцоно", Before = "давхцаагүй", After = vol,
                            Why = "Хаалга шинэ байрлалдаа бусад хаалга/цонхны геометртэй огтлолцоно.", Id = showId, Kind = ImpactNodeKind.Element, AfterValue = p.VolumeCm3, TargetKey = tkey,
                        });
                        break;
                    default:    // Furnishing, Other
                        r.Items.Add(new PreChangeItem
                        {
                            Key = "clash:" + p.Key, Code = ItemCodes.DoorFurnitureClash, Subject = subj, Category = PreChangeCategory.Obstacle, Truth = TruthState.Confirmed, Severity = ItemSeverity.Warning,
                            Title = subj + ": хаалганы геометртэй огтлолцоно (" + ObstacleKinds.Label(p.OtherKind).ToLowerInvariant() + ")", Before = "огтлолцол байхгүй", After = vol,
                            Why = "Геометрээр батлагдсан огтлолцол — тавилга/төхөөрөмжийг зөөх эсвэл хаалганы байрлалыг өөрчилнө үү.",
                            Id = showId, Kind = ImpactNodeKind.Element, AfterValue = p.VolumeCm3, TargetKey = tkey,
                        });
                        break;
                }
            }

            foreach (ClashPairState p in b.Pairs.Values.Where(x => x.Verdict == ClashVerdict.ConfirmedClash).OrderBy(x => x.Key, StringComparer.Ordinal))
            {
                ClashPairState ap;
                if (a.Pairs.TryGetValue(p.Key, out ap) && ap.Verdict == ClashVerdict.NoClash)
                    r.Items.Add(new PreChangeItem
                    {
                        Key = "clash:resolved:" + p.Key, Code = ItemCodes.ClashResolved, Subject = p.OtherLabel, Category = PreChangeCategory.Clash, Truth = TruthState.Confirmed, Severity = ItemSeverity.Ok,
                        Title = "Огтлолцол арилна · " + p.OtherLabel, Why = "Хөдөлгөөний дараа өмнө нь байсан огтлолцол арилна.",
                        Id = string.IsNullOrEmpty(p.OtherLink) ? p.OtherId : p.OtherLinkInstanceId, Kind = ImpactNodeKind.Element, TargetKey = p.OtherLinkInstanceId + ":" + p.OtherId,
                    });
            }

            // bbox-ийн нэр дэвшигчийг геометрийн үр дүнтэй тулгана: огтлолцохгүй нь БАТЛАГДСАН бол «шалгагдсан», үгүй бол хянах.
            int cleared = 0;
            foreach (FastFinding f in finals)
            {
                ClashPairState pair = a.Pairs.Values.FirstOrDefault(x => x.OtherId == f.Id && x.OtherLinkInstanceId == f.LinkInstanceId);
                if (pair != null && pair.Verdict == ClashVerdict.ConfirmedClash) continue;       // дээр мөр үүссэн
                if (pair != null && pair.Verdict == ClashVerdict.NoClash) { cleared++; continue; }
                r.Items.Add(CandidateItem(f, "Геометрээр шалгаж чадсангүй"));
            }
            if (cleared > 0)
                r.Items.Add(new PreChangeItem
                {
                    Key = "door:nearby-clear", Code = ItemCodes.DoorNearbyClear, Category = PreChangeCategory.Obstacle, Truth = TruthState.Confirmed, Severity = ItemSeverity.Ok,
                    Title = cleared + " элемент хайрцгаар ойр ч геометрээр огтлолцохгүй",
                    Why = "Эцсийн байрлалд bounding box давхцсан ч геометрийн (boolean intersect) шалгалтаар огтлолцол илрээгүй.", Kind = ImpactNodeKind.Element, AfterValue = cleared,
                });

            bool complete = b.Complete && a.Complete && geoErr == 0;
            if (newCount == 0 && complete)
                r.Items.Add(new PreChangeItem
                {
                    Key = "clash:none", Code = ItemCodes.ClashNone, Category = PreChangeCategory.Clash, Truth = TruthState.Confirmed, Severity = ItemSeverity.Ok,
                    Title = "Шинэ огтлолцол илрээгүй", BeforeValue = 0, AfterValue = 0,
                    Why = "Нэр дэвшигч бүгд шалгагдсан (линк ачаалагдсан, геометр алдаагүй).", Kind = ImpactNodeKind.Element,
                });
            else if (newCount == 0)
                r.Items.Add(new PreChangeItem
                {
                    Key = "clash:incomplete", Code = ItemCodes.ClashIncomplete, Category = PreChangeCategory.Clash, Truth = TruthState.Incomplete, Severity = ItemSeverity.Notice,
                    Title = "Геометрийн шалгалт бүрэн биш — «огтлолцол байхгүй» гэж батлах боломжгүй",
                    Why = string.Join(" ", b.IncompleteReasons.Concat(a.IncompleteReasons).Distinct()), Kind = ImpactNodeKind.Element,
                });
        }

        private static PreChangeItem CandidateItem(FastFinding f, string basis)
        {
            return new PreChangeItem
            {
                Key = "door-cand:" + f.LinkInstanceId + ":" + f.Id, Code = ItemCodes.DoorObstacleCandidate, Subject = f.Label, Category = PreChangeCategory.Obstacle, Truth = TruthState.Review, Severity = ItemSeverity.Warning,
                Title = f.Text, Why = basis + " — хаалганы хайрцагтай давхцана, гэхдээ геометрээр огтлолцох нь батлагдаагүй.",
                Id = f.Id, Kind = ImpactNodeKind.Element, TargetKey = f.LinkInstanceId + ":" + f.Id,
            };
        }

        private static PreChangeItem PathCandidateItem(FastFinding f)
        {
            return new PreChangeItem
            {
                Key = "door-pathc:" + f.LinkInstanceId + ":" + f.Id, Code = ItemCodes.DoorPathCandidate, Subject = f.Label, Category = PreChangeCategory.Obstacle, Truth = TruthState.Review, Severity = ItemSeverity.Ok,
                Title = f.Text, Why = "Хөдөлгөөний замын хүрээнд байна (мэдээлэл) — эцсийн байрлалд огтлолцохгүй тул шийдвэрт нөлөөлөхгүй.",
                Id = f.Id, Kind = ImpactNodeKind.Element, TargetKey = f.LinkInstanceId + ":" + f.Id,
            };
        }

        /* ============================== ӨРӨӨ (From/To) ===================== */

        private static string RoomPair(string from, string to)
        {
            return (string.IsNullOrEmpty(from) ? "гадна" : from) + " → " + (string.IsNullOrEmpty(to) ? "гадна" : to);
        }

        private static void RoomItems(PreChangeReport r, PreChangeRequest req, string label, StateSnapshot before, StateSnapshot after)
        {
            HostedSnap b, a;
            if (!before.Hosted.TryGetValue(req.SourceId, out b) || !after.Hosted.TryGetValue(req.SourceId, out a)) return;
            if (!b.Exists || !a.Exists || !b.RoomsReadable || !a.RoomsReadable) return;
            if (b.FromRoomId == a.FromRoomId && b.ToRoomId == a.ToRoomId) return;

            r.Items.Add(new PreChangeItem
            {
                Key = "door:rooms", Code = ItemCodes.DoorRoomsChanged, Subject = label, Category = PreChangeCategory.Hosted, Truth = TruthState.Confirmed, Severity = ItemSeverity.Warning,
                Title = label + ": From/To өрөө өөрчлөгдөнө", Before = RoomPair(b.FromRoomName, b.ToRoomName), After = RoomPair(a.FromRoomName, a.ToRoomName),
                Why = "Хаалганы хоёр талын өрөө өөрчлөгдөнө — хаалганы хүснэгт, tag, өрөөний хүснэгт шинэчлэгдэнэ. Нормын зөрчил гэж үзээгүй.",
                Id = req.SourceId, Kind = ImpactNodeKind.Element,
            });

            // Нөлөөлөгдсөн өрөө = хаалгатай холбоо нь ХОЛБОГДОХ эсвэл АЛДАГДАХ өрөө (өмнөх ба дараах олонлогийн ялгаа).  Хаалгаа хэвээр хадгалсан өрөө орохгүй.
            var rooms = new Dictionary<long, string>();
            var beforeSet = new HashSet<long>(new[] { b.FromRoomId, b.ToRoomId }.Where(x => x > 0));
            var afterSet = new HashSet<long>(new[] { a.FromRoomId, a.ToRoomId }.Where(x => x > 0));
            Action<long, string> add = (id, name) =>
            {
                if (id <= 0 || rooms.ContainsKey(id) || beforeSet.Contains(id) == afterSet.Contains(id)) return;
                rooms[id] = string.IsNullOrEmpty(name) ? "Өрөө #" + id : name;
            };
            add(b.FromRoomId, b.FromRoomName); add(b.ToRoomId, b.ToRoomName); add(a.FromRoomId, a.FromRoomName); add(a.ToRoomId, a.ToRoomName);
            foreach (KeyValuePair<long, string> kv in rooms.OrderBy(x => x.Key))
                r.Items.Add(new PreChangeItem
                {
                    Key = "door:room:" + kv.Key, Code = ItemCodes.DoorRoomAffected, Subject = kv.Value, Category = PreChangeCategory.Room, Truth = TruthState.Confirmed, Severity = ItemSeverity.Notice,
                    Title = kv.Value + ": хаалганы From/To шинэчлэгдэнэ", Why = "Хаалганы энэ талын өрөөний холбоос өөрчлөгдөнө (хүснэгт, tag).",
                    Id = kv.Key, Kind = ImpactNodeKind.Room, TargetKey = "0:" + kv.Key,
                });
        }

        /* ============================== ОРЧНЫ ЗАЙ ========================== */

        private static void ClearanceItems(PreChangeReport r, PreChangeRequest req, string label, StateSnapshot before, StateSnapshot after)
        {
            HostedSnap b, a;
            if (!before.Hosted.TryGetValue(req.SourceId, out b) || !after.Hosted.TryGetValue(req.SourceId, out a) || !b.Exists || !a.Exists) return;
            if (b.ClearanceEvaluated && a.ClearanceEvaluated && b.ClearanceMm.HasValue && a.ClearanceMm.HasValue)
            {
                double cd = a.ClearanceMm.Value - b.ClearanceMm.Value;
                if (Math.Abs(cd) > PreChangeTolerance.LengthMm)
                    r.Items.Add(new PreChangeItem
                    {
                        Key = "clr:" + req.SourceId, Code = ItemCodes.ClearanceChanged, Subject = label, Category = PreChangeCategory.Clearance, Truth = TruthState.Confirmed,
                        Severity = cd < 0 ? ItemSeverity.Warning : ItemSeverity.Notice,
                        Title = label + " — хаалганы орчны зай",
                        Before = PreChangeText.Mm(b.ClearanceMm), After = PreChangeText.Mm(a.ClearanceMm), Delta = PreChangeText.DeltaMm(cd),
                        Why = "Хамгийн ойрын саад хүртэлх зай (геометрээр хэмжсэн). Энэ нь нормын шалгалт БИШ.",
                        Id = req.SourceId, Kind = ImpactNodeKind.Element, BeforeValue = b.ClearanceMm, AfterValue = a.ClearanceMm, DeltaValue = cd,
                    });
                return;
            }
            r.Items.Add(new PreChangeItem
            {
                Key = "clr:ne", Code = ItemCodes.ClearanceNe, Category = PreChangeCategory.Clearance, Truth = TruthState.NotEvaluated, Severity = ItemSeverity.Ok,
                Title = "Хаалганы орчны зай: тооцоолоогүй",
                Why = (string.IsNullOrWhiteSpace(a.ClearanceNote ?? b.ClearanceNote) ? "Найдвартай хэмжих геометр олдсонгүй." : (a.ClearanceNote ?? b.ClearanceNote)),
                Kind = ImpactNodeKind.Element,
            });
        }
    }
}
