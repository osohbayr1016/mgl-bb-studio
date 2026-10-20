using System;
using Autodesk.Revit.DB;
using RevitMcpAddin.AutoAnnotate.Core;

namespace RevitMcpAddin.AutoAnnotate
{
    /// <summary>
    /// «Хэмжээсийн төрөл»-ийн Revit талын ГАНЦ хаалга: (1) сонголтыг (UniqueId) бодит <see cref="DimensionType"/>-д тулгана, (2) хэмжээс үүсмэгц БОДИТ төрөл
    /// нь хүссэнтэй таарч байгааг баталж, зөрвөл тохируулна / үгүй бол үүсгэснийг ЦУЦАЛНА.  Хэзээ ч чимээгүй өөр төрлөөр үлдээхгүй.
    ///
    /// Шалтгаан (2026-10-05): сонголт Арматур/Ерөнхий гэсэн ХОЁР хайрцагт байж нэг нь үл тоогдож, хомутын MRA-ийн хэмжээс MRA төрлийнхөө өөрийн хэмжээсийн
    /// загварыг (<c>MultiReferenceAnnotationType.DimensionStyleId</c>) хэрэглэдэг, мөн хадгалсан ElementId өөр төслийн ӨӨР элементийг заадаг байв.
    /// </summary>
    internal static class AaDimType
    {
        /// <summary>
        /// UniqueId-г тулгана.  Хоосон = өгөгдмөл (<paramref name="type"/> = null, алдаагүй).  Олдохгүй / хэмжээсийн төрөл биш бол <paramref name="error"/> = мессеж.
        /// </summary>
        public static bool Resolve(Document doc, string uid, out DimensionType type, out string error)
        {
            type = null;
            error = null;
            Element e = null;
            if (!string.IsNullOrEmpty(uid))
            {
                try { e = doc.GetElement(uid); }
                catch { e = null; }
            }
            DimensionType dt = e as DimensionType;
            bool linear = false;
            if (dt != null)
            {
                try { linear = dt.StyleType == DimensionStyleType.Linear; }
                catch { linear = false; }
            }
            AaTypeVerdict v = AaTypeChoice.Decide(uid, e != null, dt != null && linear);
            if (v == AaTypeVerdict.UseSelected)
            {
                type = dt;
                return true;
            }
            if (v == AaTypeVerdict.UseDefault) return true;
            error = AaTypeChoice.VerdictMessage(v);
            return false;
        }

        /// <summary>
        /// Үүссэн хэмжээсийн БОДИТ төрөл хүссэнтэй таарна уу.  Таарахгүй бол <c>Dimension.DimensionType</c>-д тохируулж дахин шалгана.  Тохируулж чадахгүй бол
        /// false + шалтгаан — дуудагч тэр хэмжээсийг буцаана / устгана (өөр төрлөөр чимээгүй үлдээхгүй).  <paramref name="want"/> == null бол шалгахгүй.
        /// </summary>
        public static bool Enforce(Dimension d, DimensionType want, out string problem)
        {
            problem = null;
            if (d == null || want == null) return true;
            long expected = want.Id.Value;
            try
            {
                if (AaTypeChoice.Matches(expected, ActualId(d))) return true;
                try { d.DimensionType = want; }
                catch (Exception ex) { problem = ex.Message.Split('\n')[0].Trim().TrimEnd('.'); }
                if (AaTypeChoice.Matches(expected, ActualId(d))) return true;
            }
            catch (Exception ex)
            {
                problem = ex.Message.Split('\n')[0].Trim().TrimEnd('.');
            }
            problem = "Хэмжээс «" + SafeName(want) + "» төрлөөр үүссэнгүй (Revit өөр төрөл хэрэглэсэн" + (string.IsNullOrEmpty(problem) ? "" : ": " + problem) + ")";
            return false;
        }

        private static long ActualId(Dimension d)
        {
            ElementId id = d.GetTypeId();
            return id == null ? -1 : id.Value;
        }

        public static string SafeName(Element e)
        {
            try { return e == null ? "?" : e.Name; }
            catch { return "?"; }
        }
    }
}
