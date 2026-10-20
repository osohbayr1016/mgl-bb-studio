using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.Smart.Core;
using RevitMcpAddin.SmartPublish.Core;

namespace RevitMcpAddin.SmartPublish
{
    /// <summary>
    /// Revit-ээс гаргалтад хэрэгтэй мэдээллийг ХУУЛЖ (detached DTO) авна.  Энэ нь Smart Publish-ийн
    /// Revit API-д хүрдэг ЦОРЫН ГАНЦ унших хэсэг — дараа нь planner/preflight/нэршил бүгд цэвэр .NET.
    ///
    /// ⚠️ Revit-ийн үндсэн thread дээр, хүчинтэй API контекстод л дуудна.
    /// ⚠️ Нэг параметр унших алдаа бүтэн жагсаалтыг унагаах ёсгүй — тухайн утга л алгасагдана.
    /// </summary>
    internal static class PublishCollector
    {
        private const int MaxValueLength = 200;

        internal static PublishContext CollectContext(Document doc)
        {
            var ctx = new PublishContext { Now = DateTime.Now };
            try { ctx.DocumentTitle = StripExt(doc.Title); } catch (Exception) { }

            Autodesk.Revit.DB.ProjectInfo pi = null;
            try { pi = doc.ProjectInformation; } catch (Exception) { }
            if (pi == null) return ctx;

            try { ctx.ProjectName = Clean(pi.Name); } catch (Exception) { }
            try { ctx.ProjectNumber = Clean(pi.Number); } catch (Exception) { }
            try { ctx.ProjectClient = Clean(pi.ClientName); } catch (Exception) { }
            try { ctx.ProjectAddress = Clean(pi.Address); } catch (Exception) { }
            try { ctx.ProjectStatus = Clean(pi.Status); } catch (Exception) { }

            foreach (Parameter p in SafeParameters(pi))
            {
                string name = SafeName(p);
                if (name == null) continue;
                string v = ParamText(doc, p);
                if (v != null) ctx.ProjectValues[name] = v;
            }
            return ctx;
        }

        /// <summary>
        /// Хуудас (болон `includeViews` бол хуудсанд ороогүй хэвлэгдэх харагдац)-ыг цуглуулна.
        /// Дугаараар «байгалийн» эрэмбэлнэ (A-2 &lt; A-10).
        /// </summary>
        internal static List<PublishItem> CollectItems(Document doc, bool includeViews)
        {
            var items = new List<PublishItem>();

            foreach (ViewSheet sheet in new FilteredElementCollector(doc).OfClass(typeof(ViewSheet)).Cast<ViewSheet>())
            {
                var it = new PublishItem
                {
                    Id = sheet.UniqueId,
                    Kind = PublishItemKind.Sheet,
                    Number = Clean(sheet.SheetNumber),
                    Name = Clean(sheet.Name),
                    ViewType = "Sheet",
                    ElementIdValue = sheet.Id.Value,
                };
                try { it.IsPlaceholder = sheet.IsPlaceholder; } catch (Exception) { }
                try { it.CanBePrinted = sheet.CanBePrinted && !it.IsPlaceholder; } catch (Exception) { it.CanBePrinted = !it.IsPlaceholder; }
                ReadRevision(doc, sheet, it);

                foreach (Parameter p in SafeParameters(sheet))
                {
                    string name = SafeName(p);
                    if (name == null) continue;
                    string v = ParamText(doc, p);
                    if (v != null) it.Values[name] = v;
                }
                items.Add(it);
            }

            if (includeViews)
            {
                HashSet<long> onSheets = ViewsOnSheets(doc);
                foreach (View v in new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>())
                {
                    if (v is ViewSheet || v.IsTemplate) continue;
                    if (!IsPublishableViewType(v.ViewType)) continue;
                    bool printable;
                    try { printable = v.CanBePrinted; } catch (Exception) { printable = false; }
                    if (!printable) continue;

                    var it = new PublishItem
                    {
                        Id = v.UniqueId,
                        Kind = PublishItemKind.View,
                        Number = Clean(v.Name),
                        Name = Clean(v.Name),
                        ViewType = v.ViewType.ToString(),
                        CanBePrinted = true,
                        ElementIdValue = v.Id.Value,
                    };
                    if (onSheets.Contains(it.ElementIdValue)) it.Values["OnSheet"] = "yes";
                    items.Add(it);
                }
            }

            items.Sort((a, b) =>
            {
                int k = a.Kind.CompareTo(b.Kind);
                return k != 0 ? k : NaturalComparer.Instance.Compare(a.Number, b.Number);
            });
            return items;
        }

        private static bool IsPublishableViewType(ViewType t)
        {
            switch (t)
            {
                case ViewType.FloorPlan:
                case ViewType.CeilingPlan:
                case ViewType.AreaPlan:
                case ViewType.EngineeringPlan:
                case ViewType.Elevation:
                case ViewType.Section:
                case ViewType.Detail:
                case ViewType.ThreeD:
                case ViewType.DraftingView:
                case ViewType.Legend:
                    return true;
                default:
                    return false;
            }
        }

        private static HashSet<long> ViewsOnSheets(Document doc)
        {
            var set = new HashSet<long>();
            try
            {
                foreach (Viewport vp in new FilteredElementCollector(doc).OfClass(typeof(Viewport)).Cast<Viewport>())
                    set.Add(vp.ViewId.Value);
            }
            catch (Exception) { }
            return set;
        }

        private static void ReadRevision(Document doc, ViewSheet sheet, PublishItem it)
        {
            try
            {
                ElementId revId = sheet.GetCurrentRevision();
                if (revId == null || revId == ElementId.InvalidElementId) return;
                it.RevisionNumber = Clean(sheet.GetRevisionNumberOnSheet(revId));
                var rev = doc.GetElement(revId) as Revision;
                if (rev != null)
                {
                    it.RevisionDescription = Clean(rev.Description);
                    it.RevisionDate = Clean(rev.RevisionDate);
                }
            }
            catch (Exception)
            {
                // Ревизийн мэдээлэл унших алдаа — хуудас ревизгүй мэт үлдэнэ (preflight мэдээлнэ).
            }
        }

        /// <summary>
        /// Preflight-д хэрэгтэй орчны баримт: DWG setup-ууд, 3D харагдацууд, PDF тохиргооны зөв байдал.
        /// </summary>
        internal static EnvironmentFacts CollectEnvironment(Document doc, PublishProfile profile)
        {
            var env = new EnvironmentFacts();
            try { env.IsFamilyDocument = doc.IsFamilyDocument; } catch (Exception) { }

            try
            {
                foreach (string n in BaseExportOptions.GetPredefinedSetupNames(doc))
                    if (!string.IsNullOrWhiteSpace(n)) env.DwgSetupNames.Add(n.Trim());
            }
            catch (Exception)
            {
                // Project баримт биш / setup уншигдсангүй — preflight «setup олдсонгүй» гэж мэдээлнэ.
            }

            try
            {
                foreach (View3D v in new FilteredElementCollector(doc).OfClass(typeof(View3D)).Cast<View3D>())
                    if (!v.IsTemplate && !string.IsNullOrWhiteSpace(v.Name)) env.ThreeDViewNames.Add(v.Name.Trim());
            }
            catch (Exception) { }

            if (profile != null && profile.Pdf != null)
                PdfOptionsBuilder.Validate(profile.Pdf, env.InvalidPdfSettings);
            return env;
        }

        /* ============================== HELPERS ============================ */

        internal static string ParamText(Document doc, Parameter p)
        {
            try
            {
                if (p == null || !p.HasValue) return null;
                string s;
                switch (p.StorageType)
                {
                    case StorageType.String:
                        s = p.AsString();
                        break;
                    case StorageType.Integer:
                    case StorageType.Double:
                        s = p.AsValueString();
                        if (string.IsNullOrEmpty(s))
                            s = p.StorageType == StorageType.Integer
                                ? p.AsInteger().ToString(System.Globalization.CultureInfo.InvariantCulture)
                                : p.AsDouble().ToString("0.####", System.Globalization.CultureInfo.InvariantCulture);
                        break;
                    case StorageType.ElementId:
                        s = p.AsValueString();
                        if (string.IsNullOrEmpty(s))
                        {
                            Element e = doc.GetElement(p.AsElementId());
                            s = e != null ? e.Name : null;
                        }
                        break;
                    default:
                        return null;
                }
                return Clean(s);
            }
            catch (Exception)
            {
                return null;
            }
        }

        private static IEnumerable<Parameter> SafeParameters(Element e)
        {
            try { return e.Parameters.Cast<Parameter>().ToList(); }
            catch (Exception) { return new Parameter[0]; }
        }

        private static string SafeName(Parameter p)
        {
            try
            {
                string n = p.Definition != null ? p.Definition.Name : null;
                return string.IsNullOrWhiteSpace(n) ? null : n.Trim();
            }
            catch (Exception) { return null; }
        }

        private static string Clean(string s)
        {
            if (string.IsNullOrWhiteSpace(s)) return null;
            s = s.Trim();
            return s.Length > MaxValueLength ? s.Substring(0, MaxValueLength) : s;
        }

        private static string StripExt(string title)
        {
            if (string.IsNullOrEmpty(title)) return title;
            return title.EndsWith(".rvt", StringComparison.OrdinalIgnoreCase) ? title.Substring(0, title.Length - 4) : title;
        }
    }
}
