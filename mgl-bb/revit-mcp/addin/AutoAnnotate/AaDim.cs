using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.AutoAnnotate.Core;

namespace RevitMcpAddin.AutoAnnotate
{
    /// <summary>Нэг хэмжээсийн гинжийг Revit-д үүсгэх — бүх төрлийн гинж үүгээр дамжина.</summary>
    internal static class AaDim
    {
        /// <summary>1 мм — хоёр лавлагааг «нэг цэг» гэж үзэх хүлцэл (0 урттай сегмент Revit-д алдаа).</summary>
        public const double Tol = 1.0 / 304.8;

        /// <summary>
        /// items-ийг along чиглэлийн дагуу, outward чиглэлд c координатад байрлах шугамаар хэмжинэ.
        /// Хоёр координат хоёулаа ViewData-ийн 2D хавтгайд (план XY / харагдацын UV).
        ///
        /// Бүтэн гинж унавал (нэг лавлагаа нь энэ харагдацад хэмжигдэхгүй) булан + тэнхлэгийн
        /// гинжээр ДАХИН оролдоно — нэг муу нүүрнээс болж бүх фасад хэмжээсгүй үлдэхгүй.
        /// </summary>
        public static Dimension Create(ViewData d, IList<ChainItem> items, V2 along, V2 outward, double c,
            DimensionType type, AaReport rep, string what)
        {
            List<ChainItem> list = Chain.Normalize(Chain.KeepParallel(items), Tol);
            if (list.Count < 2)
                return null;
            Dimension dim = TryCreate(d, list, along, outward, c, type, out string err);
            if (dim == null && list.Count > 2)
            {
                List<ChainItem> strong = list.Where(i => i.Priority >= Chain.PriorityCorner).ToList();
                if (strong.Count >= 2 && strong.Count < list.Count)
                    dim = TryCreate(d, strong, along, outward, c, type, out _);
                if (dim != null)
                    rep.Note(what + ": зарим нүхний ирмэгийг хэмжиж чадсангүй — булан, тэнхлэгээр л тавив.");
            }
            if (dim == null)
            {
                rep.DimsFailed++;
                if (!string.IsNullOrEmpty(err))
                    rep.Note(what + ": " + err);
                return null;
            }
            rep.Created.Add(dim.Id);
            rep.DimIds.Add(dim.Id);
            rep.DimWhat[dim.Id.Value] = what;
            return dim;
        }

        /// <summary>
        /// Жижиг сегментийн бичвэрийг зөөнө (<see cref="TextLayout"/>).  Бүх хэмжээсийг үүсгэсний
        /// ДАРАА нэг удаа Regenerate хийж утгыг уншина — хэмжээс бүрд regen хийвэл том файлд удаан.
        /// </summary>
        public static void NudgeTexts(ViewData d, AaReport rep)
        {
            if (rep.DimIds.Count == 0)
                return;
            try { d.Doc.Regenerate(); }
            catch { return; }
            int scale = d.Scale;
            foreach (ElementId id in rep.DimIds)
            {
                try
                {
                    if (!(d.Doc.GetElement(id) is Dimension dim) || dim.Segments == null || dim.Segments.Size < 2)
                        continue;
                    if (!(dim.Curve is Line line))
                        continue;
                    DimensionType dt = dim.DimensionType;
                    double textMm = ParamFeet(dt, BuiltInParameter.TEXT_SIZE) * Paper.MmPerFoot;
                    if (textMm <= 0.1) textMm = 2.5;
                    double widthScale = ParamFeet(dt, BuiltInParameter.TEXT_WIDTH_SCALE);
                    if (widthScale <= 0.1) widthScale = 1;
                    double charMm = textMm * 0.72 * widthScale;

                    var segs = new List<DimensionSegment>();
                    foreach (DimensionSegment sg in dim.Segments)
                        segs.Add(sg);
                    var len = new List<double>();
                    var w = new List<double>();
                    foreach (DimensionSegment sg in segs)
                    {
                        double v = sg.Value ?? 0;
                        len.Add(v * Paper.MmPerFoot / scale);
                        w.Add((sg.ValueString ?? "").Length * charMm);
                    }
                    TextPlace[] plan = TextLayout.Plan(len, w, 1.0);
                    XYZ dir = line.Direction;
                    for (int i = 0; i < segs.Count; i++)
                    {
                        if (plan[i] == TextPlace.Default)
                            continue;
                        DimensionSegment sg = segs[i];
                        if (!sg.IsTextPositionAdjustable())
                            continue;
                        XYZ tp = sg.TextPosition, o = sg.Origin;
                        double segModel = sg.Value ?? 0;
                        double textModel = w[i] * scale / Paper.MmPerFoot;
                        double gapModel = 1.5 * scale / Paper.MmPerFoot;
                        switch (plan[i])
                        {
                            case TextPlace.Before:
                                sg.TextPosition = tp - dir * (segModel / 2 + textModel / 2 + gapModel);
                                break;
                            case TextPlace.After:
                                sg.TextPosition = tp + dir * (segModel / 2 + textModel / 2 + gapModel);
                                break;
                            default:
                                XYZ off = tp - o;
                                XYZ up = off - dir * off.DotProduct(dir);
                                up = up.GetLength() > 1e-9 ? up.Normalize() : d.View.UpDirection;
                                sg.TextPosition = tp + up * (textMm * 1.25 * scale / Paper.MmPerFoot);
                                break;
                        }
                    }
                }
                catch
                {
                    // Бичвэр зөөж чадаагүй нь хэмжээсийг эвдэхгүй — өгөгдмөл байрлалдаа үлдэнэ.
                }
            }
        }

        /// <summary>
        /// Тэнхлэг/түвшний шугамыг (зөвхөн ЭНЭ харагдацад, ViewSpecific) outward тал руу need
        /// координат хүртэл уртасгана — бөмбөлөг/түвшний тэмдэг хэмжээсний гинжийн ГАДНА гарна.
        /// Хэзээ ч богиносгохгүй.  Амжилттай бол true.
        /// </summary>
        public static bool ExtendDatum(ViewData d, DatumPlane dp, V2 outward, double need, AaReport rep)
        {
            try
            {
                IList<Curve> cs = dp.GetCurvesInView(DatumExtentType.ViewSpecific, d.View);
                if (cs == null || cs.Count != 1 || !(cs[0] is Line l))
                    return false;
                XYZ e0 = l.GetEndPoint(0), e1 = l.GetEndPoint(1);
                double c0 = d.ToView(e0).Dot(outward), c1 = d.ToView(e1).Dot(outward);
                int endIdx = c0 >= c1 ? 0 : 1;
                XYZ end = endIdx == 0 ? e0 : e1, other = endIdx == 0 ? e1 : e0;
                double cur = Math.Max(c0, c1);
                if (cur >= need - 1e-6)
                    return false;
                XYZ dir = (end - other).Normalize();
                double k = d.ToViewVec(dir).Dot(outward);
                if (k < 0.5)
                    return false;
                XYZ newEnd = end + dir * ((need - cur) / k);
                Line nl = endIdx == 0 ? Line.CreateBound(newEnd, other) : Line.CreateBound(other, newEnd);
                dp.SetDatumExtentType(endIdx == 0 ? DatumEnds.End0 : DatumEnds.End1, d.View, DatumExtentType.ViewSpecific);
                if (!dp.IsCurveValidInView(DatumExtentType.ViewSpecific, d.View, nl))
                    return false;
                dp.SetCurveInView(DatumExtentType.ViewSpecific, d.View, nl);
                rep.GridsExtended++;
                return true;
            }
            catch (Exception ex)
            {
                rep.Note("«" + dp.Name + "»-ийн тэмдгийг гадна гаргаж чадсангүй: " + ex.Message);
                return false;
            }
        }

        private static double ParamFeet(Element e, BuiltInParameter bip)
        {
            try
            {
                Parameter p = e?.get_Parameter(bip);
                return p != null && p.HasValue && p.StorageType == StorageType.Double ? p.AsDouble() : 0;
            }
            catch
            {
                return 0;
            }
        }

        private static Dimension TryCreate(ViewData d, IList<ChainItem> list, V2 along, V2 outward, double c,
            DimensionType type, out string err)
        {
            err = null;
            double a0 = list[0].Pos - 0.5, a1 = list[list.Count - 1].Pos + 0.5;
            XYZ p0 = d.ToModel(along * a0 + outward * c);
            XYZ p1 = d.ToModel(along * a1 + outward * c);
            var ra = new ReferenceArray();
            foreach (ChainItem i in list)
            {
                if (i.Ref is Reference r)
                    ra.Append(r);
            }
            if (ra.Size < 2)
                return null;
            try
            {
                Line line = Line.CreateBound(p0, p1);
                Dimension made = type != null
                    ? d.Doc.Create.NewDimension(d.View, line, ra, type)
                    : d.Doc.Create.NewDimension(d.View, line, ra);
                // Сонгосон төрлөөр үүссэнийг БАТАЛНА — өөр (өгөгдмөл) төрлөөр үүсвэл цуцлаад шалтгааныг хэлнэ, чимээгүй үлдээхгүй.
                if (made != null && type != null && !AaDimType.Enforce(made, type, out err))
                {
                    try { d.Doc.Delete(made.Id); }
                    catch { }
                    return null;
                }
                return made;
            }
            catch (Exception ex)
            {
                err = ex.Message;
                return null;
            }
        }
    }
}
