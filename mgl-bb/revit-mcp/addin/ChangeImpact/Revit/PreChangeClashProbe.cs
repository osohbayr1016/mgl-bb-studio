using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.ClashCheck;
using RevitMcpAddin.ClashCheck.Core;
using RevitMcpAddin.Smart;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.ChangeImpact
{
    /// <summary>
    /// MEP clash — ШИНЭ clash-ийг ӨМНӨ/ДАРАА харьцуулж олно.  ⚠️ ХОЁР ДАХЬ clash хөдөлгүүр БИЧЭЭГҮЙ: `ClashCheck.GeometryVerifier`
    /// (хос бүрийн solid + boolean intersect, линкийн transform-той) ДАХИН ашиглана; зөвхөн нэр дэвшигчийг ХАНЫН хөдөлгөөний
    /// хүрээгээр (өмнөх ∪ дараах bbox) шүүж, ӨМНӨ/ДАРАА ИЖИЛ хосыг шалгана.
    ///
    /// ПРИНЦИП: «clash байхгүй» гэж ЗӨВХӨН бүх хос ҮНЭХЭЭР шалгагдсан үед.  Unload хийсэн линк, хаалттай workset, хязгаар (cap),
    /// геометрийн алдаа, хугацааны хязгаар — бүгд `IncompleteReasons`-д (ЧИМЭЭГҮЙ алгасахгүй).  Линк загварыг ХЭЗЭЭ Ч өөрчлөхгүй.
    /// </summary>
    internal static class PreChangeClashProbe
    {
        internal const int MaxCandidates = 300;
        /// <summary>Нэр дэвшигчийн хүрээг тэлэх (мм) — зайны хүлцэл, MEP-ийн тусгаарлагч.</summary>
        internal const double RegionPadMm = 50;

        internal static readonly BuiltInCategory[] MepCategories =
        {
            BuiltInCategory.OST_DuctCurves, BuiltInCategory.OST_FlexDuctCurves, BuiltInCategory.OST_DuctFitting, BuiltInCategory.OST_DuctAccessory,
            BuiltInCategory.OST_PipeCurves, BuiltInCategory.OST_FlexPipeCurves, BuiltInCategory.OST_PipeFitting, BuiltInCategory.OST_PipeAccessory,
            BuiltInCategory.OST_Conduit, BuiltInCategory.OST_ConduitFitting, BuiltInCategory.OST_CableTray, BuiltInCategory.OST_CableTrayFitting,
        };

        /// <summary>Хөдөлгөөний хүрээ (host координат, дотоод нэгж): хананы bbox ∪ вектороор шилжсэн bbox, тэлсэн.</summary>
        internal static Outline Region(Wall wall, XYZ moveFt)
        {
            BoundingBoxXYZ bb = wall.get_BoundingBox(null);
            if (bb == null) return null;
            double pad = PcUnits.ToInternalMm(RegionPadMm);
            var min = new XYZ(Math.Min(bb.Min.X, bb.Min.X + moveFt.X) - pad, Math.Min(bb.Min.Y, bb.Min.Y + moveFt.Y) - pad, bb.Min.Z - pad);
            var max = new XYZ(Math.Max(bb.Max.X, bb.Max.X + moveFt.X) + pad, Math.Max(bb.Max.Y, bb.Max.Y + moveFt.Y) + pad, bb.Max.Z + pad);
            return new Outline(min, max);
        }

        internal static ClashSpec Plan(Document doc, Wall wall, XYZ moveFt)
        {
            var spec = new ClashSpec();
            Outline region = Region(wall, moveFt);
            if (region == null)
            {
                spec.NotEvaluatedReason = "Хананы хэмжээ (bounding box) уншигдсангүй — MEP нэр дэвшигчийг олж чадсангүй.";
                return spec;
            }

            var filter = new ElementMulticategoryFilter(MepCategories.ToList());
            var ids = new List<ClashCand>();

            try
            {
                foreach (ElementId id in new FilteredElementCollector(doc).WherePasses(filter).WhereElementIsNotElementType()
                    .WherePasses(new BoundingBoxIntersectsFilter(region)).ToElementIds())
                    ids.Add(new ClashCand { ElementId = id.Value, Slot = -1 });
                CheckWorksets(doc, "Энэ файл", spec);
            }
            catch (Exception ex)
            {
                spec.IncompleteReasons.Add("Host файлын MEP нэр дэвшигчийг олж чадсангүй (" + ex.GetType().Name + ").");
            }

            int unloaded = 0;
            foreach (RevitLinkInstance inst in new FilteredElementCollector(doc).OfClass(typeof(RevitLinkInstance)).Cast<RevitLinkInstance>())
            {
                Document ld = null;
                try { ld = inst.GetLinkDocument(); } catch (Exception) { }
                if (ld == null) { unloaded++; continue; }

                try
                {
                    Transform t = inst.GetTotalTransform();
                    Transform inv = t.Inverse;
                    Outline linkRegion = TransformOutline(region, inv);
                    var slot = new LinkSlot
                    {
                        InstanceId = inst.Id.Value,
                        InstanceUid = inst.UniqueId,
                        Name = ClashLinks.DisplayName(inst),
                        LinkDocId = RevitDocumentKeys.Of(ld).Id,
                    };
                    spec.Slots.Add(slot);
                    int slotIndex = spec.Slots.Count - 1;
                    foreach (ElementId id in new FilteredElementCollector(ld).WherePasses(filter).WhereElementIsNotElementType()
                        .WherePasses(new BoundingBoxIntersectsFilter(linkRegion)).ToElementIds())
                        ids.Add(new ClashCand { ElementId = id.Value, Slot = slotIndex });
                    CheckWorksets(ld, "Линк «" + slot.Name + "»", spec);
                }
                catch (Exception ex)
                {
                    spec.IncompleteReasons.Add("Линкийн MEP нэр дэвшигчийг олж чадсангүй (" + ex.GetType().Name + ").");
                }
            }
            if (unloaded > 0)
                spec.IncompleteReasons.Add(unloaded + " линк unload хийгдсэн — тэдгээрийн MEP-г шалгаагүй (clash илрээгүй ≠ clash байхгүй).");

            if (ids.Count > MaxCandidates)
            {
                spec.IncompleteReasons.Add("MEP нэр дэвшигч " + ids.Count + " байна — эхний " + MaxCandidates + "-г л шалгав.");
                ids = ids.Take(MaxCandidates).ToList();
            }
            spec.Cands = ids;
            return spec;
        }

        internal static void CheckWorksets(Document d, string what, ClashSpec spec)
        {
            try
            {
                if (!d.IsWorkshared) return;
                int closed = new FilteredWorksetCollector(d).OfKind(WorksetKind.UserWorkset).Cast<Workset>().Count(w => !w.IsOpen);
                if (closed > 0)
                    spec.IncompleteReasons.Add(what + ": " + closed + " хаалттай workset — тэдгээрийн элементийг (MEP) шалгаагүй.");
            }
            catch (Exception) { /* workset мэдээлэл уншигдсангүй — дараагийн шалгалт хэвээр */ }
        }

        internal static Outline TransformOutline(Outline o, Transform t)
        {
            XYZ a = o.MinimumPoint, b = o.MaximumPoint;
            double minX = double.MaxValue, minY = double.MaxValue, minZ = double.MaxValue, maxX = double.MinValue, maxY = double.MinValue, maxZ = double.MinValue;
            for (int i = 0; i < 8; i++)
            {
                XYZ c = t.OfPoint(new XYZ((i & 1) == 0 ? a.X : b.X, (i & 2) == 0 ? a.Y : b.Y, (i & 4) == 0 ? a.Z : b.Z));
                minX = Math.Min(minX, c.X); minY = Math.Min(minY, c.Y); minZ = Math.Min(minZ, c.Z);
                maxX = Math.Max(maxX, c.X); maxY = Math.Max(maxY, c.Y); maxZ = Math.Max(maxZ, c.Z);
            }
            return new Outline(new XYZ(minX, minY, minZ), new XYZ(maxX, maxY, maxZ));
        }

        /// <summary>Хана ↔ нэр дэвшигч бүрийн хос шалгалт (геометр).  `budgetMs` хэтэрвэл үлдсэнийг ШАЛГААГҮЙ гэж ИЛ тэмдэглэнэ.</summary>
        internal static ClashSnap Read(Document doc, ClashSpec spec, long wallId, int budgetMs, BeforeMemo memo = null)
        {
            var snap = new ClashSnap();
            if (spec == null) { snap.NotEvaluatedReason = "MEP нэр дэвшигч бэлтгэгдсэнгүй."; return snap; }
            if (!string.IsNullOrEmpty(spec.NotEvaluatedReason)) { snap.NotEvaluatedReason = spec.NotEvaluatedReason; return snap; }

            snap.Evaluated = true;
            snap.IncompleteReasons.AddRange(spec.IncompleteReasons);
            var sw = Stopwatch.StartNew();
            var rule = new ClashRule
            {
                Mode = ClashMode.HardIntersection,
                MinVolumeCm3 = PreChangeTolerance.VolumeCm3,
                IgnoreJoined = false, IgnoreHosted = false, IgnoreConnected = false,
            };

            Element wall = doc.GetElement(new ElementId(wallId));
            if (wall == null) { snap.Evaluated = false; snap.NotEvaluatedReason = "Хана олдсонгүй."; return snap; }

            var scope = new RevitKeyScope(doc);
            var wallItem = new SideItem { Key = scope.Host(wall), IdValue = wallId, Slot = -1 };
            int skipped = 0;

            using (var gv = new GeometryVerifier(doc, spec.Slots))
            {
                gv.BeginStep();
                for (int i = 0; i < spec.Cands.Count; i++)
                {
                    ClashCand c = spec.Cands[i];
                    // ӨМНӨХ төлөв (хөдөлгөөнгүй) зайнаас ХАМААРАХГҮЙ — аль хэдийн шалгасан хосыг геометрээр дахин шалгахгүй.
                    string memoKey = BeforeMemo.ClashKey(c.Slot, c.ElementId);
                    if (memo != null && memo.ClashCandidatesRead.Contains(memoKey))
                    {
                        ClashPairState hit;
                        if (memo.ClashPairs.TryGetValue(memoKey, out hit)) snap.Pairs[hit.Key] = hit;
                        continue;
                    }
                    if (sw.ElapsedMilliseconds > budgetMs) { skipped = spec.Cands.Count - i; break; }
                    try
                    {
                        Element e;
                        ElementKey key;
                        string linkName = null;
                        if (c.Slot < 0)
                        {
                            e = doc.GetElement(new ElementId(c.ElementId));
                            if (e == null) continue;
                            key = scope.Host(e);
                        }
                        else
                        {
                            ClashLinks.Resolved link = ClashLinks.Resolve(doc, spec.Slots[c.Slot]);
                            if (link == null)
                            {
                                snap.IncompleteReasons.Add("Линк «" + spec.Slots[c.Slot].Name + "» шалгалтын явцад unload хийгдсэн.");
                                continue;
                            }
                            e = link.Doc.GetElement(new ElementId(c.ElementId));
                            if (e == null) continue;
                            key = scope.Linked(link.Instance, link.Doc, e);
                            linkName = spec.Slots[c.Slot].Name;
                        }

                        var item = new SideItem { Key = key, IdValue = c.ElementId, Slot = c.Slot };
                        PairResult pr = gv.Verify(wallItem, item, rule, 0, i);
                        string pairKey = key.ToString();
                        var state = new ClashPairState
                        {
                            Key = pairKey,
                            OtherId = c.ElementId,
                            OtherLabel = LabelOf(e),
                            OtherLink = linkName,
                            OtherLinkInstanceId = c.Slot >= 0 ? spec.Slots[c.Slot].InstanceId : 0,
                            Verdict = pr.Verdict,
                            VolumeCm3 = pr.VolumeCm3,
                            Reason = pr.Reason,
                        };
                        snap.Pairs[pairKey] = state;
                        if (memo != null && pr.Verdict != ClashVerdict.GeometryError && pr.Verdict != ClashVerdict.Unsupported)
                        {
                            memo.ClashCandidatesRead.Add(memoKey);
                            memo.ClashPairs[memoKey] = state;
                        }
                    }
                    catch (Exception ex)
                    {
                        snap.IncompleteReasons.Add("MEP хосыг шалгаж чадсангүй (" + ex.GetType().Name + ").");
                    }
                }
            }

            if (skipped > 0) snap.IncompleteReasons.Add(skipped + " MEP нэр дэвшигчийг хугацааны хязгаараас болж шалгаагүй.");
            snap.IncompleteReasons = snap.IncompleteReasons.Distinct(StringComparer.Ordinal).ToList();
            snap.Complete = snap.IncompleteReasons.Count == 0;
            return snap;
        }

        private static string LabelOf(Element e)
        {
            try
            {
                string cat = e.Category != null ? e.Category.Name : "Элемент";
                string name = e.Name;
                return cat + (string.IsNullOrEmpty(name) ? "" : " · " + name) + " · #" + e.Id.Value;
            }
            catch (Exception) { return "MEP элемент #" + e.Id.Value; }
        }
    }
}
