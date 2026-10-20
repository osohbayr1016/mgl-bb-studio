using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;

namespace MglBb.RevitSide
{
    /// <summary>
    /// Түвшин/тэнхлэгийн шугамыг харагдац бүрт (view-specific 2D extents) crop-ын ирмэгт тайрна — ЖИШЭЭ-1-ийн ханын дэлгээсэд түвшний шугам
    /// ханын хажуугаар л, толгой нь баруун талд; тэнхлэг доороо бөмбөлөгтэй.  Тайраагүй үед шугам харагдацаас 25–40 мм (цаасаар) сунаж viewport-ыг
    /// томруулж, гарчиг зургаасаа хол унадаг байв (ЦХ-7, хэмжсэн).  Зөвхөн ЭНЭ харагдацын 2D extents — загварын түвшин/тэнхлэг хөндөгдөхгүй.
    /// Нээлттэй Transaction дотор.
    /// </summary>
    internal static class BbDatums
    {
        public static int Trim(Document doc, View v)
        {
            if (v == null || !v.CropBoxActive) return 0;
            BoundingBoxXYZ cb = v.CropBox;
            Transform t = cb.Transform ?? Transform.Identity;
            Transform inv = t.Inverse;
            double sc = Math.Max(1, v.Scale);
            double edge = 3 / 304.8 * sc, bubble = 6 / 304.8 * sc;
            int n = 0;
            foreach (DatumPlane d in new FilteredElementCollector(doc, v.Id).OfClass(typeof(DatumPlane)).Cast<DatumPlane>())
            {
                if (!(d is Level) && !(d is Grid)) continue;
                try
                {
                    IList<Curve> cs = d.GetCurvesInView(DatumExtentType.ViewSpecific, v);
                    if (cs == null || cs.Count != 1 || !(cs[0] is Line ln)) continue;
                    XYZ a = inv.OfPoint(ln.GetEndPoint(0)), b = inv.OfPoint(ln.GetEndPoint(1));
                    XYZ dir = b - a;
                    if (dir.GetLength() < 1e-6) continue;
                    bool horiz = Math.Abs(dir.Normalize().X) > 0.999, vert = Math.Abs(dir.Normalize().Y) > 0.999;
                    if (!horiz && !vert) continue;
                    // Шугам crop-ын дотор (перпендикуляр координатаар) байх ёстой.
                    double cross = horiz ? a.Y : a.X;
                    if (horiz ? (cross < cb.Min.Y || cross > cb.Max.Y) : (cross < cb.Min.X || cross > cb.Max.X)) continue;
                    double lo = horiz ? cb.Min.X : cb.Min.Y, hi = horiz ? cb.Max.X : cb.Max.Y;
                    bool b0 = d.IsBubbleVisibleInView(DatumEnds.End0, v), b1 = d.IsBubbleVisibleInView(DatumEnds.End1, v);
                    double pa = horiz ? a.X : a.Y, pb = horiz ? b.X : b.Y;
                    // Үзүүр бүрийг харгалзах crop ирмэгт (бөмбөлөг/толгойтой үзүүр бага зэрэг гадна).
                    bool aLow = pa < pb;
                    double na = aLow ? lo - (b0 ? bubble : edge) : hi + (b0 ? bubble : edge);
                    double nb = aLow ? hi + (b1 ? bubble : edge) : lo - (b1 ? bubble : edge);
                    XYZ qa = horiz ? new XYZ(na, a.Y, a.Z) : new XYZ(a.X, na, a.Z);
                    XYZ qb = horiz ? new XYZ(nb, b.Y, b.Z) : new XYZ(b.X, nb, b.Z);
                    if (Math.Abs(na - pa) < 1e-4 && Math.Abs(nb - pb) < 1e-4) continue;
                    d.SetDatumExtentType(DatumEnds.End0, v, DatumExtentType.ViewSpecific);
                    d.SetDatumExtentType(DatumEnds.End1, v, DatumExtentType.ViewSpecific);
                    d.SetCurveInView(DatumExtentType.ViewSpecific, v, Line.CreateBound(t.OfPoint(qa), t.OfPoint(qb)));
                    n++;
                }
                catch { }
            }
            return n;
        }

        /// <summary>Харагдацын түвшин/тэнхлэгийн шугам + толгойн хүрээг (загварын цэгүүд) нэмнэ — viewport-ын агуулгын хэмжээнд.</summary>
        public static void AddExtents(Document doc, View v, Action<XYZ> add)
        {
            double sc = Math.Max(1, v.Scale);
            double levelHead = 30 / 304.8 * sc, levelUp = 8 / 304.8 * sc, gridBubble = 11 / 304.8 * sc;
            XYZ up = v.UpDirection;
            foreach (DatumPlane d in new FilteredElementCollector(doc, v.Id).OfClass(typeof(DatumPlane)).Cast<DatumPlane>())
            {
                if (!(d is Level) && !(d is Grid)) continue;
                try
                {
                    IList<Curve> cs = d.GetCurvesInView(DatumExtentType.ViewSpecific, v);
                    if (cs == null) continue;
                    foreach (Curve c in cs)
                    {
                        XYZ p0 = c.GetEndPoint(0), p1 = c.GetEndPoint(1);
                        add(p0); add(p1);
                        XYZ dir = (p1 - p0).GetLength() > 1e-9 ? (p1 - p0).Normalize() : XYZ.BasisX;
                        foreach (var end in new[] { DatumEnds.End0, DatumEnds.End1 })
                        {
                            if (!d.IsBubbleVisibleInView(end, v)) continue;
                            XYZ p = end == DatumEnds.End0 ? p0 : p1;
                            XYZ outw = end == DatumEnds.End0 ? dir.Negate() : dir;
                            if (d is Level) { add(p + outw * levelHead); add(p + outw * levelHead + up * levelUp); }
                            else { add(p + outw * gridBubble); }
                        }
                    }
                }
                catch { }
            }
        }
    }
}
