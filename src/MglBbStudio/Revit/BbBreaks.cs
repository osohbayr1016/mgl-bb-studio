using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.ExtensibleStorage;
using MglBb.Core;

namespace MglBb.RevitSide
{
    /// <summary>
    /// Дамнурууны огтлолын break line: crop-ын зүүн/баруун ирмэгийг дайрсан хучилт бүрд «DET-Symbol_Break_Line» (харагдацын detail item, цэгэн)
    /// — ирмэгээс <see cref="BbMemberStandard.BreakInsetPaperMm"/>-ээр дотогш, хучилтын зузааны голд, left/right = зузааны хагас (ЖИШЭЭ-2-оос хэмжсэн,
    /// <see cref="BbBreakPlan"/>).  Хучилтын дээд/доод ирмэгийг геометрээр (огтлолын хавтгай дээрх босоо шугамын огтлолцол) олно.
    /// Энэ хэрэгслийн тавьсныг өөрийн бүртгэлээр (schema <c>6d77be7b-…</c>) таньж дахин ажиллуулахад солино; гараар тавьсан break line байгаа
    /// газарт давхардуулахгүй.
    /// </summary>
    internal static class BbBreaks
    {
        private static readonly Guid SchemaGuid = new Guid("6d77be7b-6fd7-4b20-8092-f78c4200d321");
        private const double Mm = 1 / 304.8;

        private static Schema Get(bool create)
        {
            Schema s = Schema.Lookup(SchemaGuid);
            if (s != null || !create) return s;
            var b = new SchemaBuilder(SchemaGuid);
            b.SetSchemaName("MglBbStudioBreak");
            b.SetReadAccessLevel(AccessLevel.Public);
            b.SetWriteAccessLevel(AccessLevel.Public);
            b.SetVendorId("MGLE");
            b.SetDocumentation("MGL ББ Студи: огтлолд автоматаар тавьсан break line (дахин ажиллуулахад солигдоно).");
            b.AddSimpleField("ViewUid", typeof(string));
            return b.Finish();
        }

        private static bool IsOurs(Element e, View v)
        {
            Schema s = Get(false);
            if (s == null) return false;
            try
            {
                Entity ent = e.GetEntity(s);
                return ent != null && ent.IsValid() && string.Equals(ent.Get<string>("ViewUid"), v.UniqueId, StringComparison.Ordinal);
            }
            catch { return false; }
        }

        /// <summary>Break line-ын family-ийн төрлүүд (нэр нь <paramref name="family"/>-тэй сул тэнцүү).</summary>
        public static List<FamilySymbol> Symbols(Document doc, string family)
        {
            string key = BbCompanyRules.Norm(family ?? "");
            return new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_DetailComponents).WhereElementIsElementType().OfType<FamilySymbol>()
                .Where(fs => BbCompanyRules.Norm(fs.FamilyName ?? "") == key).ToList();
        }

        public static bool IsBreakFamily(FamilyInstance fi)
        {
            return (fi?.Symbol?.FamilyName ?? "").IndexOf("Break", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        /// <summary>«Scale Factor» (эсвэл нэрний «1=25») — харагдацын масштабд таарах төрлийг сонгоход.</summary>
        private static double ScaleFactor(FamilySymbol fs)
        {
            try
            {
                Parameter p = fs.LookupParameter("Scale Factor");
                if (p != null && p.HasValue)
                {
                    if (p.StorageType == StorageType.Double) return p.AsDouble();
                    if (p.StorageType == StorageType.Integer) return p.AsInteger();
                    if (double.TryParse(p.AsValueString(), NumberStyles.Float, CultureInfo.InvariantCulture, out double d)) return d;
                }
            }
            catch { }
            string n = fs.Name ?? "";
            int i = n.IndexOf('=');
            return i >= 0 && double.TryParse(n.Substring(i + 1).Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out double v) ? v : 0;
        }

        /// <summary>Нээлттэй Transaction-гүй үед: огтлолд break line тавина (өмнөх өөрийнхийг солино).  Тавьсан тоо.</summary>
        public static int Section(Document doc, ViewSection v, BbMemberStandard ms, BbAnnoReport rep, string mark)
        {
            if (doc == null || v == null || ms == null || !ms.SecBreakLines) return 0;
            List<FamilySymbol> syms = Symbols(doc, ms.BreakFamily);
            if (syms.Count == 0)
            {
                rep?.Issues.Add(new BbIssue
                {
                    Tool = "Тэмдэглэх", Severity = BbSeverity.Warning, Member = mark ?? "", View = v.Name, ViewId = v.Id.Value,
                    Problem = "Break line-ын family «" + ms.BreakFamily + "» энэ төсөлд алга — огтлолд break line тавьсангүй.",
                    Proposal = "Family-г компанийн template-ээс ачаалах (Detail Items).",
                    Key = "break|family|" + ms.BreakFamily,
                });
                return 0;
            }
            int best = BbBreakPlan.NearestScale(syms.Select(ScaleFactor).ToList(), v.Scale);
            FamilySymbol sym = syms[Math.Max(0, best)];

            BoundingBoxXYZ crop = v.CropBox;
            Transform t = crop.Transform, inv = t.Inverse;
            double sc = Math.Max(1, v.Scale);
            double inset = ms.BreakInsetPaperMm * sc * Mm, mask = ms.BreakMaskPaperMm * sc * Mm;
            double x0 = crop.Min.X, x1 = crop.Max.X;
            // Огтлолын хавтгайн ард (2 мм) — хучилт хавтгайд огтлогдож байгаа хэсэг.
            double zc = Math.Max(crop.Min.Z, crop.Max.Z - 2 * Mm);

            var left = new List<BbYSpan>();
            var right = new List<BbYSpan>();
            foreach (Element fl in Floors(doc, crop))
            {
                foreach (Solid so in Solids(fl))
                {
                    // Ирмэгийн ДОТОР (break line-ын байр) ба ГАДНА (1 мм) — хоёуланд нь хучилт байвал л ирмэгийг дайрсан.
                    List<BbYSpan> inL = Cut(so, t, inv, x0 + inset, crop, zc), outL = Cut(so, t, inv, x0 - 1 * Mm, crop, zc);
                    List<BbYSpan> inR = Cut(so, t, inv, x1 - inset, crop, zc), outR = Cut(so, t, inv, x1 + 1 * Mm, crop, zc);
                    left.AddRange(Overlap(inL, outL));
                    right.AddRange(Overlap(inR, outR));
                }
            }

            int placed = 0, kept = 0;
            using (var tr = new Transaction(doc, "MGL ББ: break line " + (mark ?? "")))
            {
                tr.Start();
                FailureHandlingOptions fho = tr.GetFailureHandlingOptions();
                fho.SetFailuresPreprocessor(new BbSwallowWarnings());
                tr.SetFailureHandlingOptions(fho);

                var manual = new List<double[]>();
                foreach (FamilyInstance fi in new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_DetailComponents)
                             .WherePasses(new ElementOwnerViewFilter(v.Id)).OfType<FamilyInstance>().ToList())
                {
                    if (!IsBreakFamily(fi)) continue;
                    if (IsOurs(fi, v)) { try { doc.Delete(fi.Id); } catch { } continue; }
                    if (fi.Location is LocationPoint lp) { XYZ q = inv.OfPoint(lp.Point); manual.Add(new[] { q.X, q.Y }); }
                }

                List<BbBreakSpot> spots = BbBreakPlan.Spots(x0, x1, left, right, inset, mask, 20 * Mm, 2 * Mm);
                if (spots.Count > 0 && !sym.IsActive) { sym.Activate(); doc.Regenerate(); }
                foreach (BbBreakSpot s in spots)
                {
                    if (BbBreakPlan.Covered(s, manual, Math.Max(3 * inset, 30 * Mm))) { kept++; continue; }
                    try
                    {
                        XYZ p = t.OfPoint(new XYZ(s.X, s.Y, crop.Max.Z));
                        FamilyInstance fi = doc.Create.NewFamilyInstance(p, sym, v);
                        // Зүүн тал: +90° (hand дээш, facing гадагш = зүүн), баруун тал: −90° (ЖИШЭЭ-2 «Detail 241»-ийн 270°).
                        ElementTransformUtils.RotateElement(doc, fi.Id, Line.CreateBound(p, p + v.ViewDirection), s.Right ? -Math.PI / 2 : Math.PI / 2);
                        SetLength(fi, "left", s.Half);
                        SetLength(fi, "right", s.Half);
                        SetLength(fi, "masking depth extension", s.Mask);
                        var ent = new Entity(Get(true));
                        ent.Set("ViewUid", v.UniqueId ?? "");
                        fi.SetEntity(ent);
                        placed++;
                    }
                    catch (Exception ex)
                    {
                        rep?.Issues.Add(new BbIssue
                        {
                            Tool = "Тэмдэглэх", Severity = BbSeverity.Warning, Member = mark ?? "", View = v.Name, ViewId = v.Id.Value,
                            Problem = "Break line тавьж чадсангүй: " + (ex.Message ?? "").Split('\n')[0],
                            Proposal = "Гараар тавих.",
                            Key = "break|" + v.Name + "|" + (s.Right ? "R" : "L"),
                        });
                    }
                }
                tr.Commit();
            }
            if (rep != null) rep.Breaks += placed;
            if (kept > 0) rep?.Notes.Add(v.Name + ": гараар тавьсан break line " + kept + " хөндөөгүй.");
            return placed;
        }

        private static IEnumerable<Element> Floors(Document doc, BoundingBoxXYZ crop)
        {
            Transform t = crop.Transform;
            var pts = new List<XYZ>();
            foreach (double x in new[] { crop.Min.X - 1, crop.Max.X + 1 })
                foreach (double y in new[] { crop.Min.Y, crop.Max.Y })
                    foreach (double z in new[] { crop.Min.Z, crop.Max.Z })
                        pts.Add(t.OfPoint(new XYZ(x, y, z)));
            var ol = new Outline(new XYZ(pts.Min(p => p.X), pts.Min(p => p.Y), pts.Min(p => p.Z)), new XYZ(pts.Max(p => p.X), pts.Max(p => p.Y), pts.Max(p => p.Z)));
            return new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Floors).WhereElementIsNotElementType()
                .WherePasses(new BoundingBoxIntersectsFilter(ol)).ToElements();
        }

        private static IEnumerable<Solid> Solids(Element e)
        {
            GeometryElement ge;
            try { ge = e.get_Geometry(new Options { ComputeReferences = false, DetailLevel = ViewDetailLevel.Fine }); }
            catch { yield break; }
            if (ge == null) yield break;
            foreach (GeometryObject o in ge)
            {
                if (o is Solid s && s.Volume > 1e-9) yield return s;
                else if (o is GeometryInstance gi)
                    foreach (GeometryObject io in gi.GetInstanceGeometry())
                        if (io is Solid s2 && s2.Volume > 1e-9) yield return s2;
            }
        }

        /// <summary>Харагдацын x = <paramref name="x"/> дээрх босоо шугамаар хатуу биеийг огтолсон хэсгүүд (харагдацын y).</summary>
        private static List<BbYSpan> Cut(Solid so, Transform t, Transform inv, double x, BoundingBoxXYZ crop, double z)
        {
            var res = new List<BbYSpan>();
            try
            {
                double pad = (crop.Max.Y - crop.Min.Y) * 0.5;
                Line ln = Line.CreateBound(t.OfPoint(new XYZ(x, crop.Min.Y - pad, z)), t.OfPoint(new XYZ(x, crop.Max.Y + pad, z)));
                SolidCurveIntersection sci = so.IntersectWithCurve(ln, new SolidCurveIntersectionOptions { ResultType = SolidCurveIntersectionMode.CurveSegmentsInside });
                for (int i = 0; i < sci.SegmentCount; i++)
                {
                    Curve c = sci.GetCurveSegment(i);
                    double a = inv.OfPoint(c.GetEndPoint(0)).Y, b = inv.OfPoint(c.GetEndPoint(1)).Y;
                    // Crop-ын өндрөөр хязгаарлана (хучилт crop-оос гарч байвал break line crop дотор).
                    double lo = Math.Max(Math.Min(a, b), crop.Min.Y), hi = Math.Min(Math.Max(a, b), crop.Max.Y);
                    if (hi > lo) res.Add(new BbYSpan(lo, hi));
                }
            }
            catch { }
            return res;
        }

        private static IEnumerable<BbYSpan> Overlap(List<BbYSpan> inside, List<BbYSpan> outside)
        {
            foreach (BbYSpan a in inside)
                foreach (BbYSpan b in outside)
                {
                    double lo = Math.Max(a.Lo, b.Lo), hi = Math.Min(a.Hi, b.Hi);
                    if (hi > lo) yield return new BbYSpan(lo, hi);
                }
        }

        private static void SetLength(FamilyInstance fi, string name, double ft)
        {
            try
            {
                Parameter p = fi.LookupParameter(name);
                if (p != null && !p.IsReadOnly && p.StorageType == StorageType.Double) p.Set(ft);
            }
            catch { }
        }
    }
}
