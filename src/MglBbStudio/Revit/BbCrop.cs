using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;

namespace MglBb.RevitSide
{
    /// <summary>
    /// Тэмдэглэгээний crop (annotation crop) — үүсгэсэн харагдацын ӨӨРИЙН хэмжээс/шошго/MRA/бичвэр бүрэн багтах хамгийн бага зайгаар.
    /// Шалтгаан (хэмжсэн, ЦХ-7 хуудас): crop идэвхгүй үед бусад харагдацын огтлолын тэмдэг (урт улаан тасархай шугам) viewport-ыг хуудасны
    /// өргөнөөр сунгаж, гарчиг харагдацаасаа хол унадаг байв.  Нээлттэй Transaction дотор.
    /// </summary>
    internal static class BbCrop
    {
        /// <summary>Хамгийн бага / их зай (цаасан мм).</summary>
        public static double MinMm = 3, MaxMm = 80;

        public static bool FitAnnotationCrop(Document doc, View v, List<string> notes)
        {
            if (v == null || !v.CropBoxActive) return false;
            ViewCropRegionShapeManager m;
            try { m = v.GetCropRegionShapeManager(); } catch { return false; }
            if (m == null) return false;
            BoundingBoxXYZ cb = v.CropBox;
            Transform inv = (cb.Transform ?? Transform.Identity).Inverse;
            double x0 = cb.Min.X, x1 = cb.Max.X, y0 = cb.Min.Y, y1 = cb.Max.Y;
            double ax0 = x0, ax1 = x1, ay0 = y0, ay1 = y1;
            var filter = new LogicalOrFilter(new List<ElementFilter>
            {
                new ElementClassFilter(typeof(Dimension)),
                new ElementClassFilter(typeof(IndependentTag)),
                new ElementClassFilter(typeof(MultiReferenceAnnotation)),
                new ElementClassFilter(typeof(TextNote)),
                new ElementClassFilter(typeof(SpotDimension)),
            });
            foreach (Element e in new FilteredElementCollector(doc).OwnedByView(v.Id).WherePasses(filter))
            {
                BoundingBoxXYZ b;
                try { b = e.get_BoundingBox(v); } catch { continue; }
                if (b == null) continue;
                Transform bt = b.Transform ?? Transform.Identity;
                foreach (double x in new[] { b.Min.X, b.Max.X })
                    foreach (double y in new[] { b.Min.Y, b.Max.Y })
                        foreach (double z in new[] { b.Min.Z, b.Max.Z })
                        {
                            XYZ q = inv.OfPoint(bt.OfPoint(new XYZ(x, y, z)));
                            ax0 = Math.Min(ax0, q.X); ax1 = Math.Max(ax1, q.X); ay0 = Math.Min(ay0, q.Y); ay1 = Math.Max(ay1, q.Y);
                        }
            }
            double sc = Math.Max(1, v.Scale);
            // Зай = цаасны фут (Revit-ийн UI «Annotation Crop» зайг цаасаар харуулдаг) — gate-ээр шалгасан хэмжилттэй тулгана.
            Func<double, double> paper = model => Clamp(model / sc * 304.8) / 304.8;
            try
            {
                Parameter p = v.get_Parameter(BuiltInParameter.VIEWER_ANNOTATION_CROP_ACTIVE);
                if (p == null || p.IsReadOnly) return false;
                p.Set(1);
                m.LeftAnnotationCropOffset = paper(x0 - ax0);
                m.RightAnnotationCropOffset = paper(ax1 - x1);
                m.BottomAnnotationCropOffset = paper(y0 - ay0);
                m.TopAnnotationCropOffset = paper(ay1 - y1);
                return true;
            }
            catch (Exception ex)
            {
                notes?.Add("«" + v.Name + "»: тэмдэглэгээний crop — " + ex.Message.Split('\n')[0]);
                return false;
            }
        }

        /// <summary>«Annotation Crop»-ыг унтраана (шинэ харагдацын өгөгдмөл).  Нээлттэй Transaction дотор.</summary>
        public static void AnnotationCropOff(View v)
        {
            try
            {
                Parameter p = v.get_Parameter(BuiltInParameter.VIEWER_ANNOTATION_CROP_ACTIVE);
                if (p != null && !p.IsReadOnly && p.AsInteger() != 0) p.Set(0);
            }
            catch { }
        }

        private static double Clamp(double mm) { return Math.Max(MinMm, Math.Min(MaxMm, mm + 3)); }
    }
}
