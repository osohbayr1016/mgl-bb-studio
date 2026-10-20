using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Autodesk.Revit.DB;

namespace RevitMcpAddin.WallElevation.Revit
{
    /// <summary>
    /// Холбосон (link) загварын ханын ТОГТВОРТОЙ түлхүүр — «link|&lt;link instance UniqueId&gt;|&lt;элементийн UniqueId&gt;».
    /// Бодит төслүүдэд (жишээ: GATEWAY — өрөөний хилийн ихэнх нь бүтцийн link-ийн хана) өрөөний хана link-д байдаг тул дэлгээсийн
    /// зангуу, Extensible Storage-ийн түлхүүр, «эх хана байна уу» шалгалт бүгд энэ мөрөөр явна.  Host-ын <c>Document.GetElement(string)</c>
    /// энэ мөрийг ХЭЗЭЭ Ч олохгүй — тиймээс эх элементийн оршихуйг зөвхөн <see cref="Exists"/>-ээр шалгана.
    /// </summary>
    public static class WeLinkRef
    {
        public const string Prefix = "link|";

        public static string Make(RevitLinkInstance link, Element e)
        {
            return Prefix + link.UniqueId + "|" + e.UniqueId;
        }

        public static bool IsLink(string uid) { return uid != null && uid.StartsWith(Prefix, StringComparison.Ordinal); }

        /// <summary>Link-ийн түлхүүрээс link instance ба элементийг олно (link ачаалагдаагүй бол false).</summary>
        public static bool TryResolve(Document doc, string uid, out RevitLinkInstance link, out Element element)
        {
            link = null;
            element = null;
            if (!IsLink(uid)) return false;
            string rest = uid.Substring(Prefix.Length);
            int bar = rest.IndexOf('|');
            if (bar <= 0) return false;
            try
            {
                link = doc.GetElement(rest.Substring(0, bar)) as RevitLinkInstance;
                Document ld = link != null ? link.GetLinkDocument() : null;
                element = ld != null ? ld.GetElement(rest.Substring(bar + 1)) : null;
            }
            catch { element = null; }
            return element != null;
        }

        /// <summary>
        /// Link-ийн элементийн нүүрийг хэмжээсийн лавлагаа болгоно.  ⚠️ ХЭМЖСЭН (Revit 2024, MITIC 219E, 2026-10-08): <c>CreateLinkReference</c>-ийн
        /// шууд үр дүн ба түүний тогтвортой мөрийг дахин уншсан лавлагаа ХОЁУЛАА <c>NewDimension</c>-д «Invalid number of references» —
        /// хоёр лавлагаа хоёулаа link-ийнх үед (хэвтээ нийт урт, түлхүүр планы өрөөний хэмжээс) хэмжээс огт үүсдэггүй байв.  Мөрийн
        /// «:RVTLINK»-ийг «:0:RVTLINK» болгож уншсан лавлагаа хүлээн авагдаж, зөв утга (2630) өгсөн.  Хөрвүүлж чадахгүй бол анхныхыг буцаана.
        /// </summary>
        public static Reference ForDimension(Document doc, Reference linkFace, RevitLinkInstance link)
        {
            if (linkFace == null || link == null) return linkFace;
            Reference lr;
            try { lr = linkFace.CreateLinkReference(link); } catch { return null; }
            if (lr == null) return null;
            try
            {
                string rep = lr.ConvertToStableRepresentation(doc);
                if (rep != null && rep.Contains(":RVTLINK") && !rep.Contains(":0:RVTLINK"))
                {
                    Reference fixedRef = Reference.ParseFromStableRepresentation(doc, rep.Replace(":RVTLINK", ":0:RVTLINK"));
                    if (fixedRef != null) return fixedRef;
                }
            }
            catch { }
            return lr;
        }

        private static readonly Regex LinkPart = new Regex(@"link\|([0-9A-Za-z\-]+)\|([0-9A-Za-z\-]+)", RegexOptions.CultureInvariant);

        /// <summary>
        /// LINK-ИЙГ ДАХИН ХОЛБОСОН (эзний шийдвэр 2026-10-14: «өрөөгөөр нь таньж хуучнаа шинэчилнэ»).  Хадгалсан түлхүүрийн link instance
        /// устсан эсвэл ачаалагдаагүй байхад ИЖИЛ элементийг (өрөө, хана — UniqueId нь файлд тогтвортой) агуулсан ачаалагдсан ӨӨР instance
        /// байвал түлхүүрийг тэр instance руу шилжүүлнэ — эс бөгөөс төлөвлөгч хуучин дэлгээсийг танихгүй «(2)» нэртэй давхардуулдаг байв
        /// (ХЭМЖСЭН MAX ӨРГӨӨ INT_B, 2026-10-13).  Хуучин instance хэвээр (ачаалагдаагүй) байвал зөвхөн ИЖИЛ байрлалтай (хувиргалт ≤ 1 мм)
        /// instance руу — ижил файлын ХОЁР хуулбар (A/B блок) хоорондоо солигдохгүй.  Хэд хэдэн тохирох instance (хоёрдмол) → хөндөхгүй.
        /// </summary>
        public static string Rebind(Document doc, string text, Func<XYZ> near = null)
        {
            if (doc == null || string.IsNullOrEmpty(text) || text.IndexOf(Prefix, StringComparison.Ordinal) < 0) return text;
            var map = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (Match m in LinkPart.Matches(text))
            {
                string inst = m.Groups[1].Value;
                if (map.ContainsKey(inst)) continue;
                map[inst] = NewInstanceFor(doc, inst, m.Groups[2].Value, near);
            }
            if (map.Values.All(v => v == null)) return text;
            return LinkPart.Replace(text, m =>
            {
                string to;
                return map.TryGetValue(m.Groups[1].Value, out to) && to != null ? Prefix + to + "|" + m.Groups[2].Value : m.Value;
            });
        }

        private static string NewInstanceFor(Document doc, string instUid, string elemUid, Func<XYZ> near)
        {
            RevitLinkInstance old = null;
            try { old = doc.GetElement(instUid) as RevitLinkInstance; } catch { }
            if (old != null && old.GetLinkDocument() != null) return null;   // хэвийн — ачаалагдсан
            Transform oldTf = null;
            if (old != null) try { oldTf = old.GetTotalTransform(); } catch { oldTf = null; }
            var found = new List<KeyValuePair<string, double>>();
            foreach (RevitLinkInstance li in new FilteredElementCollector(doc).OfClass(typeof(RevitLinkInstance)).Cast<RevitLinkInstance>())
            {
                if (li.UniqueId == instUid) continue;
                try
                {
                    Document ld = li.GetLinkDocument();
                    Element e = ld != null ? ld.GetElement(elemUid) : null;
                    if (e == null) continue;
                    Transform tf = li.GetTotalTransform();
                    if (old != null)
                    {
                        if (oldTf == null) continue;
                        if (tf.Origin.DistanceTo(oldTf.Origin) > 1 / 304.8 || tf.BasisX.DotProduct(oldTf.BasisX) < 1 - 1e-6) continue;
                    }
                    XYZ at = PointOf(e), c = near != null ? near() : null;
                    double d = c != null && at != null ? Flat(tf.OfPoint(at)).DistanceTo(Flat(c)) : double.NaN;
                    found.Add(new KeyValuePair<string, double>(li.UniqueId, d));
                }
                catch { }
            }
            if (found.Count == 1) return found[0].Key;
            // Ижил файлын хэд хэдэн хуулбар (A/B блок, эсвэл SaveAs хийсэн файл — UniqueId ижил): харагдацын байрлалд хамгийн ойр нь, хоёр дахь
            // нь ≥ 2 дахин хол бол л (эс бөгөөс хоёрдмол — хөндөхгүй).
            if (found.Count < 2 || found.Any(f => double.IsNaN(f.Value))) return null;
            List<KeyValuePair<string, double>> byDist = found.OrderBy(f => f.Value).ToList();
            return byDist[1].Value >= 2 * byDist[0].Value + 1 ? byDist[0].Key : null;
        }

        private static XYZ Flat(XYZ p) { return new XYZ(p.X, p.Y, 0); }

        private static XYZ PointOf(Element e)
        {
            try
            {
                var lp = e.Location as LocationPoint;
                if (lp != null) return lp.Point;
                var lc = e.Location as LocationCurve;
                if (lc != null && lc.Curve != null) return lc.Curve.Evaluate(0.5, true);
                BoundingBoxXYZ bb = e.get_BoundingBox(null);
                return bb != null ? (bb.Min + bb.Max) * 0.5 : null;
            }
            catch { return null; }
        }

        /// <summary>Харагдацын төв (план/дэлгээс — crop, 3D — section box, хуудас — эхний байрлуулсан харагдацынх) — <see cref="Rebind"/>-ийн хоёрдмолыг шийдэхэд.  Тодорхойгүй бол null.</summary>
        public static XYZ CenterOf(View v)
        {
            try
            {
                if (v == null) return null;
                var sheet = v as ViewSheet;
                if (sheet != null)
                {
                    foreach (ElementId id in sheet.GetAllPlacedViews())
                    {
                        XYZ c = CenterOf(v.Document.GetElement(id) as View);
                        if (c != null) return c;
                    }
                    return null;
                }
                var v3 = v as View3D;
                BoundingBoxXYZ bb = v3 != null && v3.IsSectionBoxActive ? v3.GetSectionBox() : v.CropBox;
                if (bb == null || bb.Transform == null) return null;
                return bb.Transform.OfPoint((bb.Min + bb.Max) * 0.5);
            }
            catch { return null; }
        }

        /// <summary>Эх элемент (host эсвэл link) байгаа эсэх.  Link ачаалагдаагүй бол «байгаа» гэж үзнэ — өнчин гэж тайлагнахгүй.</summary>
        public static bool Exists(Document doc, string uid)
        {
            if (string.IsNullOrEmpty(uid)) return false;
            if (!IsLink(uid)) return doc.GetElement(uid) != null;
            RevitLinkInstance link;
            Element e;
            if (TryResolve(doc, uid, out link, out e)) return true;
            // Link instance байгаа ч ачаалагдаагүй — шалгах боломжгүй, устгасан гэж буруу дүгнэхгүй.
            return link != null && link.GetLinkDocument() == null;
        }
    }
}
