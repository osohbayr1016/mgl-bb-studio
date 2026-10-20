using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Revit
{
    /// <summary>
    /// Цонхонд сонгох хуудасны параметрийн утгууд (2026-10-14, интерьерийн баг 3-р тойрог: «* Type Designator»-ийг цонхноос сонгоно).
    /// Параметрийг НЭРЭЭР тулгана (<see cref="WeSheetDiscipline.NormalizeName"/> — «*», зай, зураас, үсгийн том жижиг үл тоогдоно).
    /// Утга = төслийн хуудсуудад бичигдсэн (олон хэрэглэгдсэн нь эхэнд); анхны сонголт = энэ хэрэгслийн өмнөх хуудасных, интерьерийн
    /// хэрэгсэлд — «* Classification» = «Интерьер» хуудасных; аль нь ч үгүй бол хоосон (бичихгүй).  Хэзээ ч шидэхгүй.
    /// </summary>
    internal static class WeSheetParamReader
    {
        public static WeSheetParamChoice Read(Document doc, string paramName, bool interiorTool)
        {
            var c = new WeSheetParamChoice { ParamName = paramName };
            try
            {
                string want = WeSheetDiscipline.NormalizeName(paramName);
                string clsKey = WeSheetDiscipline.NormalizeName(WeSheetDiscipline.ClassificationParam);
                var counts = new Dictionary<string, int>(StringComparer.Ordinal);
                var ours = new Dictionary<string, int>(StringComparer.Ordinal);
                var interior = new Dictionary<string, int>(StringComparer.Ordinal);
                bool seen = false, writable = false;
                string actual = null, actualCls = null;
                foreach (ViewSheet sh in new FilteredElementCollector(doc).OfClass(typeof(ViewSheet)).Cast<ViewSheet>())
                {
                    if (sh.IsPlaceholder) continue;
                    Parameter prm = actual != null ? sh.LookupParameter(actual) : null;
                    if (prm == null) prm = Find(sh, want);
                    if (prm == null) continue;
                    seen = true;
                    actual = prm.Definition.Name;
                    if (prm.StorageType == StorageType.String && !prm.IsReadOnly) writable = true;
                    string val = prm.StorageType == StorageType.String ? prm.AsString() : prm.AsValueString();
                    if (string.IsNullOrWhiteSpace(val)) continue;
                    val = val.Trim();
                    Inc(counts, val);
                    WeRecord rec = GeneratedElevationRepository.Read(sh);
                    if (rec != null && rec.Kind == GeneratedElevationRepository.KindSheet) Inc(ours, val);
                    if (interiorTool)
                    {
                        Parameter cls = actualCls != null ? sh.LookupParameter(actualCls) : null;
                        if (cls == null) cls = Find(sh, clsKey);
                        if (cls != null)
                        {
                            actualCls = cls.Definition.Name;
                            if (string.Equals((cls.AsString() ?? string.Empty).Trim(), WeSheetDiscipline.InteriorClassification, StringComparison.Ordinal)) Inc(interior, val);
                        }
                    }
                }
                if (!seen)
                {
                    // Хуудас нэг ч алга, эсвэл параметр холбогдсон ч хуудасгүй — Project Parameters-ийн холболтоос.
                    string bound = BoundToSheets(doc, want);
                    if (bound != null) { seen = true; writable = true; actual = bound; }
                }
                c.Exists = seen;
                c.Writable = writable;
                if (actual != null) c.ParamName = actual;
                if (!seen) c.Problem = "Төсөлд «" + paramName + "» хуудасны параметр алга (Manage → Project Parameters-д хуудасны ангилалд нэмбэл энд сонгогдоно).";
                else if (!writable) c.Problem = "«" + c.ParamName + "» параметр бичвэр биш эсвэл зөвхөн уншигдах — сонгох боломжгүй.";
                c.Values = WeSheetParamChoice.Rank(counts);
                string src;
                c.Default = WeSheetParamChoice.PickDefault(ours, interior, out src);
                c.DefaultSource = src;
            }
            catch (Exception ex)
            {
                WeLog.Info("sheets", "«" + paramName + "» унших — " + ex.Message);
                c.Problem = "«" + paramName + "» уншигдсангүй: " + ex.Message;
            }
            return c;
        }

        private static Parameter Find(Element e, string normalized)
        {
            foreach (Parameter p in e.Parameters)
                if (p != null && p.Definition != null && WeSheetDiscipline.NormalizeName(p.Definition.Name) == normalized) return p;
            return null;
        }

        private static string BoundToSheets(Document doc, string normalized)
        {
            try
            {
                Category sheets = Category.GetCategory(doc, BuiltInCategory.OST_Sheets);
                DefinitionBindingMapIterator it = doc.ParameterBindings.ForwardIterator();
                while (it.MoveNext())
                {
                    Definition d = it.Key;
                    var b = it.Current as ElementBinding;
                    if (d == null || b == null || WeSheetDiscipline.NormalizeName(d.Name) != normalized) continue;
                    if (sheets != null && b.Categories != null && b.Categories.Contains(sheets)) return d.Name;
                }
            }
            catch { }
            return null;
        }

        private static void Inc(Dictionary<string, int> d, string v)
        {
            int n;
            d[v] = d.TryGetValue(v, out n) ? n + 1 : 1;
        }
    }
}
