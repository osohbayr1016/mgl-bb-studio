using System;
using System.Collections.Generic;
using Autodesk.Revit.DB;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement
{
    /// <summary>
    /// Код-оор зурагдах (family-гүй) төгсгөлийн тэмдгийг ХАРАГДАЦАД хамаарах detail шугам/нумаар зурна.
    /// Binary RFA шаардахгүй: төсөлд тохирох view-based annotation family байхгүй ч ажиллана.
    /// Геометрийн тооцоо Core-д (<see cref="RfMarkerGeometry"/>, тестлэгдсэн); энд зөвхөн Revit-д бичнэ.
    /// ⚠️ Нээлттэй Transaction дотор дуудна.
    /// </summary>
    internal static class RfMarkerDraw
    {
        /// <summary>
        /// Тэмдгийн бүх элементийг (хоёр хагас нум / хоёр шугам / нэг шугам) үүсгэж буцаана.  Алдаа гарвал ЭНЭ дуудлагаар үүссэн
        /// элементүүдийг дуудагч устгана (хагас тэмдэг үлдээхгүй).
        /// </summary>
        public static List<Element> Create(Document doc, View view, RfViewFrame frame, RfV3 centerModel, RfMarkerStyle style,
            double radiusFt, double rotationRad)
        {
            var parts = new List<Element>();
            RfV2 c = frame.ToView(centerModel);
            try
            {
                foreach (RfMarkerPrim prim in RfMarkerGeometry.Build(style, c, radiusFt, rotationRad))
                {
                    Curve curve;
                    if (prim.Kind == RfPrimKind.Line)
                    {
                        curve = Line.CreateBound(RfConv.X(frame.ToModel(prim.A)), RfConv.X(frame.ToModel(prim.B)));
                    }
                    else
                    {
                        // ГУРВАН ЦЭГЭЭР (эхлэл, төгсгөл, дундах цэг) — өнцгийн нэгж, хавтгайн баазын тэмдэг, 2π-ийн wrap-аас үл хамаарна.
                        // Нум нь харагдацын (u, v)-д CCW (Start → End); End < Start бол 2π нэмж дундах цэгийг ЗӨВ талд авна.
                        double s = prim.StartAngle, e = prim.EndAngle;
                        if (e < s) e += 2.0 * Math.PI;
                        double m = (s + e) / 2.0;
                        Func<double, XYZ> at = a => RfConv.X(frame.ToModel(prim.Center + new RfV2(Math.Cos(a), Math.Sin(a)) * prim.Radius));
                        curve = Arc.Create(at(s), at(e), at(m));
                    }
                    DetailCurve dc = doc.Create.NewDetailCurve(view, curve);
                    if (dc == null) throw new InvalidOperationException(RfText.MarkerNotDrawn);
                    parts.Add(dc);
                }
            }
            catch
            {
                // Хагас зурагдсан тэмдгийг (жишээ нь 2 хагас нумын эхнийх) үлдээхгүй — дуудагчид хүрэхээс ӨМНӨ өөрөө цэвэрлэнэ.
                foreach (Element part in parts)
                {
                    try { if (part != null && part.IsValidObject) doc.Delete(part.Id); }
                    catch { }
                }
                throw;
            }
            return parts;
        }
    }
}
