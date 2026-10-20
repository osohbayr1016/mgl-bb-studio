using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Revit
{
    /// <summary>
    /// Legend харагдац бүрийн ДОТОРХ бичвэр — нэр, таних тэмдгээр хайхад (2026-10-14, интерьерийн баг 3-р тойрог: «legend-ийг таних тэмдэг
    /// болон нэрээр нь шууд хайх»).  Эх сурвалж: бичвэр (TextNote), шошгоны бичвэр, тэмдэглэгээний family-ийн бичвэр параметр, legend
    /// component-ийн төрлийн «Type Mark», «Keynote», «Description», төрлийн нэр.  Баримтыг АНГИЛЛААР 4 удаа л гүйлгэнэ (legend тус бүрт
    /// collector биш).  Унших боломжгүй зүйлийг алгасна — хэзээ ч шидэхгүй.
    /// </summary>
    internal static class WeLegendReader
    {
        public static List<WeLegendInfo> Read(Document doc, IList<View> legends)
        {
            var result = new List<WeLegendInfo>();
            if (legends == null || legends.Count == 0) return result;
            var byView = new Dictionary<long, WeLegendInfo>();
            foreach (View v in legends)
            {
                if (v == null || !v.IsValidObject) continue;
                var info = new WeLegendInfo(v.Name);
                byView[v.Id.Value] = info;
                result.Add(info);
            }
            Action<ElementId, string> add = (owner, text) =>
            {
                WeLegendInfo info;
                if (owner == null || string.IsNullOrWhiteSpace(text) || !byView.TryGetValue(owner.Value, out info)) return;
                string t = text.Replace("\r", " ").Replace("\n", " ").Trim();
                if (t.Length > 200) t = t.Substring(0, 200);
                if (!info.Texts.Contains(t)) info.Texts.Add(t);
            };
            try
            {
                foreach (TextNote tn in new FilteredElementCollector(doc).OfClass(typeof(TextNote)).Cast<TextNote>())
                    if (byView.ContainsKey(tn.OwnerViewId.Value)) add(tn.OwnerViewId, tn.Text);
            }
            catch (Exception ex) { WeLog.Info("legend", "бичвэр унших — " + ex.Message); }
            try
            {
                foreach (IndependentTag tag in new FilteredElementCollector(doc).OfClass(typeof(IndependentTag)).Cast<IndependentTag>())
                {
                    if (!byView.ContainsKey(tag.OwnerViewId.Value)) continue;
                    try { add(tag.OwnerViewId, tag.TagText); } catch { }
                }
            }
            catch (Exception ex) { WeLog.Info("legend", "шошго унших — " + ex.Message); }
            try
            {
                // Тэмдэглэгээний family (generic annotation, detail component) — бичвэр параметрүүд.  Ангиллаар шүүнэ (загварын олон мянган family
                // instance-ийг гүйлгэхгүй).
                var cats = new LogicalOrFilter(new ElementCategoryFilter(BuiltInCategory.OST_GenericAnnotation), new ElementCategoryFilter(BuiltInCategory.OST_DetailComponents));
                foreach (FamilyInstance fi in new FilteredElementCollector(doc).OfClass(typeof(FamilyInstance)).WherePasses(cats).Cast<FamilyInstance>())
                {
                    if (!byView.ContainsKey(fi.OwnerViewId.Value)) continue;
                    foreach (Parameter p in fi.Parameters) AddString(add, fi.OwnerViewId, p);
                    if (fi.Symbol != null) foreach (Parameter p in fi.Symbol.Parameters) AddString(add, fi.OwnerViewId, p);
                }
            }
            catch (Exception ex) { WeLog.Info("legend", "тэмдэг унших — " + ex.Message); }
            try
            {
                // Legend component — харуулж буй төрлийн тэмдэг.
                foreach (Element e in new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_LegendComponents).WhereElementIsNotElementType())
                {
                    if (!byView.ContainsKey(e.OwnerViewId.Value)) continue;
                    Parameter lp = e.get_Parameter(BuiltInParameter.LEGEND_COMPONENT);
                    Element type = lp != null ? doc.GetElement(lp.AsElementId()) : null;
                    if (type == null) continue;
                    add(e.OwnerViewId, type.Name);
                    foreach (BuiltInParameter bip in new[] { BuiltInParameter.ALL_MODEL_TYPE_MARK, BuiltInParameter.KEYNOTE_PARAM, BuiltInParameter.ALL_MODEL_DESCRIPTION })
                    {
                        try { Parameter tp = type.get_Parameter(bip); if (tp != null) add(e.OwnerViewId, tp.AsString()); } catch { }
                    }
                }
            }
            catch (Exception ex) { WeLog.Info("legend", "legend component унших — " + ex.Message); }
            foreach (WeLegendInfo info in result) info.Codes = WeLegendSearch.Codes(info.Texts);
            return result;
        }

        private static void AddString(Action<ElementId, string> add, ElementId owner, Parameter p)
        {
            try
            {
                if (p == null || p.StorageType != StorageType.String || !p.HasValue) return;
                string s = p.AsString();
                if (!string.IsNullOrWhiteSpace(s) && s.Length <= 120) add(owner, s);
            }
            catch { }
        }
    }
}
