using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Revit
{
    /// <summary>
    /// Дэлгээсийг хуудсанд бэлдэх «цэгцлэлт» (жишээ хуудас 206A-G: түвшний толгой баруун талд, тэнхлэгийн бөмбөлөг хэмжээсийн доор,
    /// өөр юу ч хүрээнээс гарахгүй).
    /// ⚠️ ХЭМЖСЭН (GATEWAY, 2026-10-07): 58 түвшин, 25 тэнхлэгтэй бодит загварт түвшин/тэнхлэгийн шугам барилгын бүтэн өргөнөөр сунаж
    /// viewport-ийг 40 см хүртэл томруулсан — 8 дэлгээс 7 хуудсанд тарсан.  Тиймээс: (1) түвшний 2D хүрээ = дэлгээсийн өргөн → гадна босоо
    /// хэмжээс + толгой (баруун), зүүн бөмбөлөг нуух; ижил өндрийн түвшнээс (О/, А/, Х.А/ … давхар 6) зөвхөн энэ өрөөнд хамаарахыг үлдээнэ;
    /// (2) тэнхлэгийн 2D хүрээ = хүрээний дээдээс хэвтээ хэмжээсийн доор хүртэл, бөмбөлөг доор; (3) annotation crop идэвхтэй, offset нь
    /// тавьсан тэмдэглэгээ + толгойд яг багтах (offset нь ЦААСАН нэгжээр — хэмжсэн: 10 мм × 1:50 = загварт 500 мм).
    /// </summary>
    internal sealed class WeViewTidy
    {
        private readonly Document _doc;
        private readonly WeSettings _s;
        private readonly IWeUnits _u;

        public WeViewTidy(Document doc, WeSettings s, IWeUnits u)
        {
            _doc = doc;
            _s = s;
            _u = u;
        }

        public void Run(List<WeRunItem> items, WeRunResult result)
        {
            var views = new List<KeyValuePair<View, WePlannedElevation>>();
            using (var t = new Transaction(_doc, "Ханын дэлгээс — цэгцлэх"))
            {
                WeFailureSwallower sw = WeFailureSwallower.Attach(t);
                t.Start();
                foreach (WeRunItem w in items)
                {
                    var v = _doc.GetElement(w.ViewId) as View;
                    if (v == null || w.Plan == null || w.Plan.Frame == null || w.Plan.Box == null) continue;
                    try
                    {
                        var marks = new List<ElementId>();
                        TrimDatums(v, w.Plan, marks);
                        if (marks.Count > 0) WeAnnoStore.Write(_doc, v, WeAnnoStore.Previous(_doc, v).Concat(marks));
                        views.Add(new KeyValuePair<View, WePlannedElevation>(v, w.Plan));
                    }
                    catch (Exception ex) { WeLog.Info("tidy", v.Name + ": " + ex.Message); }
                }
                _doc.Regenerate();
                foreach (KeyValuePair<View, WePlannedElevation> kv in views)
                {
                    try { FitAnnotationCrop(_doc, kv.Key, Math.Max(1, kv.Key.Scale), 3); }
                    catch (Exception ex) { WeLog.Info("tidy", kv.Key.Name + ": annotation crop — " + ex.Message); }
                }
                t.Commit();
                result.WarningsHidden += sw.WarningsHidden;
            }
        }

        // ── Түвшин, тэнхлэг ─────────────────────────────────────────

        private void TrimDatums(View v, WePlannedElevation p, List<ElementId> marks)
        {
            WeFrame f = p.Frame;
            double scale = Math.Max(1, v.Scale);
            Func<double, double> paper = mm => _u.MmToInternal(mm * scale);
            WeAnnotationPlan anno = p.Annotation;
            double left = p.Box.MinX - paper(2);
            double right = (anno != null && !double.IsNaN(anno.OuterVerticalX) ? Math.Max(anno.OuterVerticalX, p.Box.MaxX) : p.Box.MaxX) + paper(6);
            List<WeDimRow> hrows = anno != null ? anno.Rows.Where(r => !r.Vertical).ToList() : new List<WeDimRow>();
            double bottom = (hrows.Count > 0 ? hrows.Min(r => r.At) : p.Box.MinY) - paper(5);
            double top = p.Box.MaxY;
            XYZ right3 = f.Right.ToXyz();
            double cx = (p.Box.MinX + p.Box.MaxX) / 2;

            var visible = new FilteredElementCollector(_doc, v.Id).WhereElementIsNotElementType().ToList();
            var levels = visible.OfType<Level>().ToList();
            var grids = visible.OfType<Grid>().ToList();

            // Ижил өндрийн түвшин (олон цамхагтай загварт «О/Давхар 6», «А/Давхар 6», «Х.А/Давхар 6») — энэ дэлгээсийн голыг МОДЕЛЬ
            // хүрээгээрээ хамарсан нэгийг үлдээнэ (байхгүй бол нэр нь өрөөний түвшинтэй ижил угтвартайг, эсвэл хамгийн богино нэртэйг).
            var hide = new List<ElementId>();
            foreach (IGrouping<long, Level> g in levels.GroupBy(l => (long)Math.Round(WeAnnoSourceReader.LevelZ(l) * 304.8)))
            {
                if (g.Count() < 2) continue;
                Level keep = g.OrderByDescending(l => CoversX(l, v, f, cx) ? 1 : 0)
                              .ThenByDescending(l => SamePrefix(l.Name, p.LevelName) ? 1 : 0)
                              .ThenBy(l => l.Name.Length).ThenBy(l => l.Id.Value).First();
                foreach (Level l in g) if (l.Id != keep.Id && l.CanBeHidden(v)) hide.Add(l.Id);
            }
            if (hide.Count > 0)
            {
                try { v.HideElements(hide); } catch (Exception ex) { WeLog.Info("tidy", v.Name + ": түвшин нуух — " + ex.Message); }
            }

            foreach (Level l in levels)
            {
                if (hide.Contains(l.Id)) continue;
                SetExtent(l, v, (a, b) =>
                {
                    double xa = f.ToLocal(a.ToWe()).X, xb = f.ToLocal(b.ToWe()).X;
                    bool aLeft = xa <= xb;
                    XYZ na = a + right3 * ((aLeft ? left : right) - xa);
                    XYZ nb = b + right3 * ((aLeft ? right : left) - xb);
                    return new[] { na, nb, aLeft ? (object)DatumEnds.End1 : DatumEnds.End0 };
                });
                // Түвшний төрөлд толгой алга (GATEWAY) — жишээ хуудасны «8,00 ▽ Давхар 3»-ийг баруун үзүүрт зурна.
                if (!WeLevelMark.HasHead(_doc, l))
                {
                    try
                    {
                        IList<Curve> cs = l.GetCurvesInView(DatumExtentType.ViewSpecific, v);
                        var line = cs != null && cs.Count == 1 ? cs[0] as Line : null;
                        if (line != null)
                        {
                            double y = f.ToLocal(line.GetEndPoint(0).ToWe()).Y;
                            WeLevelMark.Draw(_doc, v, f, l, right, y, _u, marks);
                        }
                    }
                    catch (Exception ex) { WeLog.Info("tidy", v.Name + ": түвшний тэмдэг «" + l.Name + "» — " + ex.Message); }
                }
            }
            foreach (Grid g in grids)
            {
                SetExtent(g, v, (a, b) =>
                {
                    double za = a.Z - f.Origin.Z, zb = b.Z - f.Origin.Z;
                    if (Math.Abs(za - zb) < 1e-6) return null;   // энэ харагдацад хэвтээ (огтлолын тэнхлэг биш)
                    bool aLow = za <= zb;
                    XYZ na = new XYZ(a.X, a.Y, f.Origin.Z + (aLow ? bottom : top));
                    XYZ nb = new XYZ(b.X, b.Y, f.Origin.Z + (aLow ? top : bottom));
                    return new[] { na, nb, aLow ? (object)DatumEnds.End0 : DatumEnds.End1 };
                });
            }
        }

        /// <summary>
        /// Datum-ийн энэ харагдацын шугамыг солих: <paramref name="ends"/> = {шинэ эхлэл, шинэ төгсгөл, бөмбөлөгтэй үзүүр}.
        /// Бөмбөлгийг тэр үзүүрт л үлдээнэ.
        /// </summary>
        private static void SetExtent(DatumPlane d, View v, Func<XYZ, XYZ, object[]> ends)
        {
            try
            {
                IList<Curve> cs = d.GetCurvesInView(DatumExtentType.ViewSpecific, v);
                var line = cs != null && cs.Count == 1 ? cs[0] as Line : null;
                if (line == null) return;
                object[] r = ends(line.GetEndPoint(0), line.GetEndPoint(1));
                if (r == null) return;
                var na = (XYZ)r[0];
                var nb = (XYZ)r[1];
                var bubble = (DatumEnds)r[2];
                if (na.DistanceTo(nb) < 1e-3) return;
                d.SetDatumExtentType(DatumEnds.End0, v, DatumExtentType.ViewSpecific);
                d.SetDatumExtentType(DatumEnds.End1, v, DatumExtentType.ViewSpecific);
                Line nl = Line.CreateBound(na, nb);
                if (d.IsCurveValidInView(DatumExtentType.ViewSpecific, v, nl)) d.SetCurveInView(DatumExtentType.ViewSpecific, v, nl);
                DatumEnds other = bubble == DatumEnds.End0 ? DatumEnds.End1 : DatumEnds.End0;
                try { if (!d.IsBubbleVisibleInView(bubble, v)) d.ShowBubbleInView(bubble, v); } catch { }
                try { if (d.IsBubbleVisibleInView(other, v)) d.HideBubbleInView(other, v); } catch { }
            }
            catch (Exception ex) { WeLog.Info("tidy", v.Name + ": «" + d.Name + "» — " + ex.Message); }
        }

        private static bool CoversX(Level l, View v, WeFrame f, double x)
        {
            try
            {
                IList<Curve> cs = l.GetCurvesInView(DatumExtentType.Model, v);
                var line = cs != null && cs.Count == 1 ? cs[0] as Line : null;
                if (line == null) return false;
                double a = f.ToLocal(line.GetEndPoint(0).ToWe()).X, b = f.ToLocal(line.GetEndPoint(1).ToWe()).X;
                return x >= Math.Min(a, b) - 1e-6 && x <= Math.Max(a, b) + 1e-6;
            }
            catch { return false; }
        }

        private static bool SamePrefix(string a, string b)
        {
            Func<string, string> pre = s => { int i = (s ?? string.Empty).IndexOf('/'); return i < 0 ? string.Empty : s.Substring(0, i); };
            return string.Equals(pre(a), pre(b), StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>
        /// Түлхүүр план: тэнхлэгийн шугамыг crop-оос <paramref name="marginMm"/> (цаас) гадагш хүртэл тайрна (бөмбөлөг хүрээний ойролцоо
        /// үлдэнэ — жишээ хуудасны X2, Y9), дараа нь annotation crop.  Хүрээг огтлохгүй тэнхлэгийг хөндөхгүй.
        /// </summary>
        internal static void TidyPlan(Document doc, View v, double marginMm)
        {
            if (!v.CropBoxActive) return;
            double scale = Math.Max(1, v.Scale);
            BoundingBoxXYZ cb = v.CropBox;
            Transform tf = cb.Transform, inv = tf.Inverse;
            double m = marginMm / 304.8 * scale;
            double x0 = cb.Min.X - m, x1 = cb.Max.X + m, y0 = cb.Min.Y - m, y1 = cb.Max.Y + m;
            foreach (Grid g in new FilteredElementCollector(doc, v.Id).OfClass(typeof(Grid)).Cast<Grid>())
            {
                try
                {
                    IList<Curve> cs = g.GetCurvesInView(DatumExtentType.ViewSpecific, v);
                    var line = cs != null && cs.Count == 1 ? cs[0] as Line : null;
                    if (line == null) continue;
                    XYZ a = inv.OfPoint(line.GetEndPoint(0)), b = inv.OfPoint(line.GetEndPoint(1));
                    double t0 = 0, t1 = 1, dx = b.X - a.X, dy = b.Y - a.Y;
                    if (!Clip(-dx, a.X - x0, ref t0, ref t1) || !Clip(dx, x1 - a.X, ref t0, ref t1)
                        || !Clip(-dy, a.Y - y0, ref t0, ref t1) || !Clip(dy, y1 - a.Y, ref t0, ref t1)) continue;
                    if (t0 <= 1e-6 && t1 >= 1 - 1e-6) continue;
                    XYZ na = tf.OfPoint(new XYZ(a.X + dx * t0, a.Y + dy * t0, a.Z)), nb = tf.OfPoint(new XYZ(a.X + dx * t1, a.Y + dy * t1, a.Z));
                    if (na.DistanceTo(nb) < 1e-3) continue;
                    g.SetDatumExtentType(DatumEnds.End0, v, DatumExtentType.ViewSpecific);
                    g.SetDatumExtentType(DatumEnds.End1, v, DatumExtentType.ViewSpecific);
                    Line nl = Line.CreateBound(na, nb);
                    if (g.IsCurveValidInView(DatumExtentType.ViewSpecific, v, nl)) g.SetCurveInView(DatumExtentType.ViewSpecific, v, nl);
                }
                catch (Exception ex) { WeLog.Info("tidy", v.Name + ": тэнхлэг «" + g.Name + "» — " + ex.Message); }
            }
            doc.Regenerate();
            FitAnnotationCrop(doc, v, scale, 3);
        }

        /// <summary>Liang–Barsky: p·t ≤ q.</summary>
        private static bool Clip(double p, double q, ref double t0, ref double t1)
        {
            if (Math.Abs(p) < 1e-12) return q >= 0;
            double r = q / p;
            if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
            else { if (r < t0) return false; if (r < t1) t1 = r; }
            return true;
        }

        // ── Annotation crop ─────────────────────────────────────────

        /// <summary>
        /// Annotation crop-ийг идэвхжүүлж, offset-ийг энэ харагдацын ӨӨРИЙН тэмдэглэгээ + харагдах түвшин/тэнхлэг (толгойтой)-д багтаана
        /// (цаасан дээр <paramref name="marginMm"/> нөөцтэй).  Хүрээнээс гадуурх бусад юм (өөр харагдацын тэмдэг, холын тэмдэглэгээ) тасарна.
        /// </summary>
        internal static void FitAnnotationCrop(Document doc, View v, double scale, double marginMm)
        {
            if (!v.CropBoxActive) return;
            // ⚠️ ХЭМЖСЭН (GATEWAY 310, дахин ажиллуулах): одоогийн annotation crop-оос гадна ШИНЭ тэмдэглэгээ (шалны spot-ийн leader зүүн
            // талд) Revit-д нуугдмал — харагдацын collector түүнийг БУЦААХГҮЙ тул crop өөрийгөө хэзээ ч томруулахгүй байв.  Түр унтрааж
            // бүх тэмдэглэгээг тоолно (доор дахин асаана).
            try
            {
                Parameter on = v.get_Parameter(BuiltInParameter.VIEWER_ANNOTATION_CROP_ACTIVE);
                if (on != null && !on.IsReadOnly && on.AsInteger() == 1) { on.Set(0); doc.Regenerate(); }
            }
            catch { }
            BoundingBoxXYZ cb = v.CropBox;
            Transform inv = cb.Transform.Inverse;
            double x0 = cb.Min.X, x1 = cb.Max.X, y0 = cb.Min.Y, y1 = cb.Max.Y;
            double ex0 = x0, ex1 = x1, ey0 = y0, ey1 = y1;
            Action<XYZ> add = q =>
            {
                XYZ l = inv.OfPoint(q);
                ex0 = Math.Min(ex0, l.X); ex1 = Math.Max(ex1, l.X);
                ey0 = Math.Min(ey0, l.Y); ey1 = Math.Max(ey1, l.Y);
            };
            foreach (Element e in new FilteredElementCollector(doc, v.Id).WhereElementIsNotElementType())
            {
                var d = e as DatumPlane;
                if (d != null)
                {
                    // ⚠️ Datum-ийн bbox нь 3D (загварын) хүрээг өгч болно — харагдацын шугам + толгойн нөөцөөр.
                    try
                    {
                        IList<Curve> cs = d.GetCurvesInView(DatumExtentType.ViewSpecific, v);
                        var line = cs != null && cs.Count == 1 ? cs[0] as Line : null;
                        if (line == null) continue;
                        XYZ a = line.GetEndPoint(0), b = line.GetEndPoint(1), dir = (b - a).Normalize();
                        double head = (d is Level ? 24 : 12) / 304.8 * scale;
                        add(d.IsBubbleVisibleInView(DatumEnds.End0, v) ? a - dir * head : a);
                        add(d.IsBubbleVisibleInView(DatumEnds.End1, v) ? b + dir * head : b);
                    }
                    catch { }
                    continue;
                }
                if (e.OwnerViewId != v.Id || e.Category == null || e.Category.CategoryType != CategoryType.Annotation) continue;
                if (e.Category.Id.Value == (long)BuiltInCategory.OST_Viewers) continue;
                BoundingBoxXYZ bb;
                try { bb = e.get_BoundingBox(v); } catch { continue; }
                if (bb == null) continue;
                foreach (double x in new[] { bb.Min.X, bb.Max.X })
                    foreach (double y in new[] { bb.Min.Y, bb.Max.Y })
                        foreach (double z in new[] { bb.Min.Z, bb.Max.Z })
                            add(bb.Transform != null ? bb.Transform.OfPoint(new XYZ(x, y, z)) : new XYZ(x, y, z));
            }
            // Хэт хол (жишээ: залруулаагүй datum) бол хязгаарлана — цаасан дээр 80 мм-ээс их offset утгагүй.
            double cap = 80 / 304.8, m = marginMm / 304.8;
            Func<double, double> paper = model => Math.Min(cap, Math.Max(0, model) / scale + m);
            Parameter act = v.get_Parameter(BuiltInParameter.VIEWER_ANNOTATION_CROP_ACTIVE);
            if (act != null && !act.IsReadOnly && act.AsInteger() != 1) act.Set(1);
            ViewCropRegionShapeManager crm = v.GetCropRegionShapeManager();
            crm.LeftAnnotationCropOffset = paper(x0 - ex0);
            crm.RightAnnotationCropOffset = paper(ex1 - x1);
            crm.BottomAnnotationCropOffset = paper(y0 - ey0);
            crm.TopAnnotationCropOffset = paper(ey1 - y1);
        }
    }
}
