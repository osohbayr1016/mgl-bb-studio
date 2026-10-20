using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Revit
{
    /// <summary>
    /// W06 (2026-10-16): үр дүнгийн индексийн Revit давхарга — үүсгэсэн харагдацын ТАНИЛТ (Extensible Storage) + БОДИТ viewport (хэрэглэгч гараар
    /// зөөсөн хуудас ч) + хуудсан дээрх байрлал (хүрээнээс гадуур / давхцал).  Загварт юу ч бичихгүй.  Revit API контекстод.
    /// </summary>
    internal static class WeResultReader
    {
        /// <summary>
        /// Хуудсан дээрх байрлалыг шалгах хугацааны дээд хэмжээ (мс) — title block / viewport-ийн хайрцаг асуухад Revit хуудсыг тооцдог тул олон
        /// хуудастай баримтад хязгаартай; хэтэрвэл үлдсэн хуудсыг «шалгаагүй» гэж тэмдэглэнэ («Шинэчлэх» дахин оролдоно).
        /// </summary>
        public const int FitBudgetMs = 4000;

        public static List<WeResultViewInfo> Read(Document doc, ICollection<string> onlyRooms, out int fitSkipped)
        {
            fitSkipped = 0;
            var list = new List<WeResultViewInfo>();
            if (doc == null) return list;
            var vpOfView = new Dictionary<long, Viewport>();
            foreach (Viewport vp in new FilteredElementCollector(doc).OfClass(typeof(Viewport)).Cast<Viewport>())
                if (!vpOfView.ContainsKey(vp.ViewId.Value)) vpOfView[vp.ViewId.Value] = vp;
            foreach (KeyValuePair<View, WeRecord> kv in GeneratedElevationRepository.ReadAll(doc))
            {
                WeRecord rec = kv.Value;
                WeResultKind kind;
                if (rec.Kind == GeneratedElevationRepository.KindView) kind = WeResultKind.Elevation;
                else if (rec.Kind == GeneratedElevationRepository.KindKeyPlan) kind = WeResultKind.KeyPlan;
                else if (rec.Kind == GeneratedElevationRepository.KindAxon) kind = WeResultKind.Axon;
                else continue;
                if (onlyRooms != null && !onlyRooms.Contains(rec.RoomUid ?? string.Empty)) continue;
                View v = kv.Key;
                var info = new WeResultViewInfo { Kind = kind, Key = rec.Key, RoomUid = rec.RoomUid ?? string.Empty, ViewId = v.Id.Value, ViewName = v.Name };
                Viewport p;
                if (vpOfView.TryGetValue(v.Id.Value, out p))
                {
                    info.ViewportId = p.Id.Value;
                    info.SheetId = p.SheetId.Value;
                    var sh = doc.GetElement(p.SheetId) as ViewSheet;
                    if (sh != null) { info.SheetNumber = sh.SheetNumber; info.SheetName = sh.Name; }
                    try { Parameter dn = p.get_Parameter(BuiltInParameter.VIEWPORT_DETAIL_NUMBER); info.DetailNumber = dn != null ? dn.AsString() : null; } catch { }
                }
                list.Add(info);
            }
            var sw = Stopwatch.StartNew();
            foreach (IGrouping<long, WeResultViewInfo> g in list.Where(i => i.SheetId != 0).GroupBy(i => i.SheetId).OrderBy(g => g.Key))
            {
                if (sw.ElapsedMilliseconds > FitBudgetMs) { fitSkipped += g.Count(); continue; }
                var sh = doc.GetElement(new ElementId(g.Key)) as ViewSheet;
                List<WeResultViewInfo> items = g.ToList();
                var rects = new List<double[]>();
                foreach (WeResultViewInfo i in items)
                {
                    double[] r = null;
                    try
                    {
                        var vp = doc.GetElement(new ElementId(i.ViewportId)) as Viewport;
                        Outline o = vp != null ? vp.GetBoxOutline() : null;
                        if (o != null && !o.IsEmpty) r = new[] { o.MinimumPoint.X, o.MinimumPoint.Y, o.MaximumPoint.X, o.MaximumPoint.Y };
                    }
                    catch { }
                    rects.Add(r);
                }
                bool[] off, ov;
                WeResultIndex.Assess(rects, Frame(doc, sh), out off, out ov);
                for (int k = 0; k < items.Count; k++) { items[k].OutOfFrame = off[k]; items[k].Overlaps = ov[k]; }
            }
            if (sw.ElapsedMilliseconds > 500) WeLog.Info("results", "байрлалын шалгалт " + sw.ElapsedMilliseconds + " мс" + (fitSkipped > 0 ? " · " + fitSkipped + " шалгаагүй (хугацаа)" : string.Empty));
            return list;
        }

        /// <summary>Хуудасны title block-ийн хүрээ (хуудасны координат) — title block-гүй бол null (гадна гэж тооцохгүй).</summary>
        private static double[] Frame(Document doc, ViewSheet sheet)
        {
            if (sheet == null) return null;
            try
            {
                foreach (FamilyInstance fi in new FilteredElementCollector(doc, sheet.Id).OfCategory(BuiltInCategory.OST_TitleBlocks)
                                                  .WhereElementIsNotElementType().OfType<FamilyInstance>())
                {
                    BoundingBoxXYZ bb = fi.get_BoundingBox(sheet);
                    if (bb != null) return new[] { bb.Min.X, bb.Min.Y, bb.Max.X, bb.Max.Y };
                }
            }
            catch { }
            return null;
        }

        /// <summary>Өрөөний нэр («Өрөө 205 — Гал тогоо (L02)») — host эсвэл link-ийн өрөө; олдохгүй бол null.</summary>
        public static string RoomLabel(Document doc, string roomUid)
        {
            if (doc == null || string.IsNullOrEmpty(roomUid)) return null;
            try
            {
                RevitLinkInstance li;
                Room r = WeRoomRef.Resolve(doc, roomUid, out li);
                return r != null ? WeRoomPicker.Label(r) : null;
            }
            catch { return null; }
        }

        /// <summary>Энэ ажиллагааны мөрүүд → үр дүнгийн индексийн «шинэ / шинэчилсэн / үүсгээгүй / алдаа».</summary>
        public static List<WeResultRunInfo> RunInfo(WeRunResult result)
        {
            var list = new List<WeResultRunInfo>();
            if (result == null) return list;
            foreach (WeRunItem w in result.Items)
            {
                WeResultRunInfo r = WeResultIndex.RunRow(w.Plan, w.Outcome, w.Message);
                if (r != null) list.Add(r);
            }
            return list;
        }
    }
}
