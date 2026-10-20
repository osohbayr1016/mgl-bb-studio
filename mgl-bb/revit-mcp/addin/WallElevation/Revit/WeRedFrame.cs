using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Revit
{
    /// <summary>
    /// Бөөрөнхий өнцөгтэй УЛААН ТАСАРХАЙ хүрээ (2026-10-14, интерьерийн баг 3-р тойрог: «бүгдийн гадуур улаан тасархай зураасаар хүрээлнэ», жишээ
    /// хуудас 232/236/238) — дэлгээс бүр, түлхүүр планы crop-ын ДОТОР (цаасан дээр 0.5 мм), булан 3 мм радиустай.
    /// ⚠️ ХЭМЖСЭН (Revit 2024, gate DIAG-SPOT-FADE-FRAME): detail шугам дэлгээсийн crop-оор ТАСРАГДАНА — хүрээ crop-оос гадна байвал харагдахгүй,
    /// тиймээс дотор нь.  Шугамын хэв маягийг (Object Styles → Lines → <see cref="StyleName"/>) ганц удаа үүсгэнэ; хэрэглэгч өнгө, жин, хээг нь
    /// сольсон бол ХӨНДӨХГҮЙ.  3D (axon) харагдацад detail шугам зурах боломжгүй (Revit API) — тэнд хүрээгүй.
    /// </summary>
    internal static class WeRedFrame
    {
        public const string StyleName = "MGL — Улаан тасархай хүрээ";
        /// <summary>Crop-оос дотогш (цаасны мм).</summary>
        public const double InsetMm = 0.5;
        /// <summary>Булангийн радиус (цаасны мм).</summary>
        public const double RadiusMm = 3;

        /// <summary>Хэв маяг (байхгүй бол үүсгэнэ: улаан 200,40,40 · жин 3 · «Dash»).  Нээлттэй transaction дотор.</summary>
        public static GraphicsStyle Style(Document doc)
        {
            Category lines = doc.Settings.Categories.get_Item(BuiltInCategory.OST_Lines);
            if (lines == null) return null;
            Category sub = lines.SubCategories.Contains(StyleName) ? lines.SubCategories.get_Item(StyleName) : null;
            if (sub == null)
            {
                sub = doc.Settings.Categories.NewSubcategory(lines, StyleName);
                sub.LineColor = new Color(200, 40, 40);
                sub.SetLineWeight(3, GraphicsStyleType.Projection);
                LinePatternElement dash = LinePatternElement.GetLinePatternElementByName(doc, "Dash")
                                          ?? new FilteredElementCollector(doc).OfClass(typeof(LinePatternElement)).Cast<LinePatternElement>()
                                                 .FirstOrDefault(l => l.Name.IndexOf("Dash", StringComparison.OrdinalIgnoreCase) >= 0);
                if (dash != null) sub.SetLinePatternId(dash.Id, GraphicsStyleType.Projection);
            }
            return sub.GetGraphicsStyle(GraphicsStyleType.Projection);
        }

        /// <param name="pt">Дотоод (x, y) → харагдацын хавтгай дээрх дэлхийн цэг.</param>
        /// <param name="xAxis">Дотоод x-ийн дэлхийн нэгж вектор.</param>
        /// <param name="yAxis">Дотоод y-ийн дэлхийн нэгж вектор (x-д перпендикуляр).</param>
        /// <param name="paperMm">Цаасны 1 мм = загварын хэдэн нэгж (масштабаар).</param>
        /// <returns>Үүсгэсэн detail шугамууд (WeAnnoStore-д бүртгэнэ).</returns>
        public static List<ElementId> Draw(Document doc, View v, Func<double, double, XYZ> pt, XYZ xAxis, XYZ yAxis,
                                           double minX, double minY, double maxX, double maxY, double paperMm, ICollection<string> notes)
        {
            var ids = new List<ElementId>();
            double inset = InsetMm * paperMm;
            double tiny = Math.Max(doc.Application.ShortCurveTolerance * 2, paperMm * 0.2);
            WeRoundedRect.Outline o = WeRoundedRect.Of(minX + inset, minY + inset, maxX - inset, maxY - inset, RadiusMm * paperMm, tiny);
            if (o == null) return ids;
            GraphicsStyle style = null;
            try { style = Style(doc); } catch (Exception ex) { WeLog.Info("frame", "хэв маяг — " + ex.Message); }
            var curves = new List<Curve>();
            foreach (WeSegment2 s in o.Lines) curves.Add(Line.CreateBound(pt(s.X0, s.Y0), pt(s.X1, s.Y1)));
            foreach (WeArc2 a in o.Arcs) curves.Add(Arc.Create(pt(a.Cx, a.Cy), a.R, a.A0, a.A1, xAxis, yAxis));
            foreach (Curve c in curves)
            {
                try
                {
                    DetailCurve dc = doc.Create.NewDetailCurve(v, c);
                    if (style != null) dc.LineStyle = style;
                    ids.Add(dc.Id);
                }
                catch (Exception ex)
                {
                    WeLog.Info("frame", v.Name + ": улаан хүрээ — " + ex.Message);
                    if (notes != null && ids.Count == 0) notes.Add("Улаан тасархай хүрээ зурж чадсангүй («" + v.Name + "»): " + ex.Message);
                }
            }
            return ids;
        }
    }
}
