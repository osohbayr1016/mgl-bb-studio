using System;
using System.Collections.Generic;
using Autodesk.Revit.DB;
using MglBb.Core;

namespace MglBb.RevitSide
{
    /// <summary>
    /// Хана/хучилтын MRA шошгонд инженерийн хугарал (<see cref="BbMraElbow"/>).  ⚠️ Нээлттэй Transaction ДОТОР.  Бичвэрийн хүрээг leader-ийг түр
    /// унтрааж хэмжинэ (leader-тэй bbox нь хэмжээсийн шугам хүртэл сунадаг).  Бүх шошгыг гурван шатаар — шошго бүрт Regenerate хийвэл том төлөвлөгөөнд удаан.
    /// </summary>
    internal static class BbMraElbows
    {
        private sealed class Item
        {
            public IndependentTag Tag;
            public double Dim0, Dim1, TextL, TextR;
            public bool Measured;
        }

        /// <summary>Хугарал тавьсан шошгоны тоо.</summary>
        public static int Apply(Document doc, View view, IEnumerable<ElementId> mraIds, BbPlateStandard ps)
        {
            if (!ps.MraElbows) return 0;
            double sc = Math.Max(1, view.Scale);
            XYZ o = view.Origin, rt = view.RightDirection;
            Func<XYZ, double> U = p => (p - o).DotProduct(rt);
            var items = new List<Item>();
            foreach (ElementId id in mraIds)
            {
                try
                {
                    if (!(doc.GetElement(id) is MultiReferenceAnnotation m)) continue;
                    var t = doc.GetElement(m.TagId) as IndependentTag;
                    var d = doc.GetElement(m.DimensionId) as Dimension;
                    if (t == null || d == null || !t.HasLeader || !(d.Curve is Line dl) || !BbMraElbow.Along(dl.Direction.DotProduct(rt))) continue;
                    XYZ dir = dl.Direction;
                    XYZ a, b;
                    if (d.NumberOfSegments == 0)
                    {
                        double h = (d.Value ?? 0) / 2;
                        a = d.Origin - dir * h; b = d.Origin + dir * h;
                    }
                    else
                    {
                        DimensionSegment s0 = d.Segments.get_Item(0), s1 = d.Segments.get_Item(d.NumberOfSegments - 1);
                        a = s0.Origin - dir * ((s0.Value ?? 0) / 2); b = s1.Origin + dir * ((s1.Value ?? 0) / 2);
                    }
                    items.Add(new Item { Tag = t, Dim0 = Math.Min(U(a), U(b)), Dim1 = Math.Max(U(a), U(b)) });
                }
                catch { }
            }
            if (items.Count == 0) return 0;

            foreach (Item it in items)
            {
                try { it.Tag.HasLeader = false; } catch { }
            }
            doc.Regenerate();
            foreach (Item it in items)
            {
                try
                {
                    BoundingBoxXYZ bb = it.Tag.get_BoundingBox(view);
                    if (bb == null) continue;
                    double u0 = double.MaxValue, u1 = double.MinValue;
                    foreach (XYZ p in new[] { bb.Min, bb.Max, new XYZ(bb.Min.X, bb.Max.Y, bb.Min.Z), new XYZ(bb.Max.X, bb.Min.Y, bb.Min.Z) })
                    {
                        double u = U(bb.Transform == null ? p : bb.Transform.OfPoint(p));
                        u0 = Math.Min(u0, u); u1 = Math.Max(u1, u);
                    }
                    it.TextL = u0; it.TextR = u1; it.Measured = u1 > u0;
                }
                catch { }
            }
            foreach (Item it in items)
            {
                try { it.Tag.HasLeader = true; } catch { }
            }
            doc.Regenerate();
            double left = BbGeom.Ft(ps.MraElbowLeftPaperMm * sc), inset = BbGeom.Ft(ps.MraElbowRightPaperMm * sc), tol = BbGeom.Ft(0.5 * sc);
            int n = 0;
            foreach (Item it in items)
            {
                if (!it.Measured) continue;
                try
                {
                    IList<Reference> refs = it.Tag.GetTaggedReferences();
                    if (refs == null || refs.Count == 0) continue;
                    XYZ head = it.Tag.TagHeadPosition;
                    double hu = U(head);
                    double eu = BbMraElbow.U(hu, it.TextL, it.TextR, it.Dim0, it.Dim1, left, inset, tol);
                    it.Tag.SetLeaderElbow(refs[0], head + rt * (eu - hu));
                    n++;
                }
                catch { }
            }
            if (n > 0) doc.Regenerate();
            return n;
        }
    }
}
