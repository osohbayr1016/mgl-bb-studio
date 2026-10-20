using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Autodesk.Revit.DB;

namespace RevitMcpAddin.SheetNumerator.Revit
{
    /// <summary>
    /// Browser Organization API-ийн ХУВИЛБАР-ЗӨРЧИЛТЭЙ гишүүд — reflection-ээр, НЭГ газар.
    ///
    /// Revit 2026-аас `FolderItemInfo.ElementId` ба `BrowserOrganization.SortingParameterId` нь ХУУЧИРСАН
    /// (obsolete; «дараагийн хувилбарт устаж болзошгүй»), оронд нь `GetGroupingParameterIdPath()` /
    /// `GetSortingParameterIdPath()` (параметрийн ЗАМ — лавлах параметр → … → параметр).  Хоёр хувилбар нэг
    /// DLL-д багтдаггүй (2024 net48, 2025/2026 net8) тул шинийг нь байвал түүгээр, үгүй бол хуучнаар унших
    /// нь reflection-ийг шаарддаг.  Ингэснээр хуучирсан API-н анхааруулга ч, Revit 2028-д устсан үеийн
    /// эмхэтгэлийн алдаа ч гарахгүй.
    /// </summary>
    internal static class BrowserApi
    {
        private static readonly MethodInfo GroupingPathMethod =
            typeof(FolderItemInfo).GetMethod("GetGroupingParameterIdPath", Type.EmptyTypes);

        private static readonly PropertyInfo GroupingIdProperty = typeof(FolderItemInfo).GetProperty("ElementId");

        private static readonly MethodInfo SortingPathMethod =
            typeof(BrowserOrganization).GetMethod("GetSortingParameterIdPath", Type.EmptyTypes);

        private static readonly PropertyInfo SortingIdProperty = typeof(BrowserOrganization).GetProperty("SortingParameterId");

        /// <summary>Folder-ийг бүлэглэж буй параметрийн id (замын ЭЦСИЙН параметр).  0 = мэдэхгүй.</summary>
        public static long GroupingParameterId(FolderItemInfo item)
        {
            try
            {
                if (GroupingPathMethod != null)
                {
                    var path = GroupingPathMethod.Invoke(item, null) as IEnumerable<ElementId>;
                    ElementId last = path != null ? path.LastOrDefault() : null;
                    if (last != null)
                        return last.Value;
                }
                if (GroupingIdProperty != null)
                {
                    ElementId id = GroupingIdProperty.GetValue(item, null) as ElementId;
                    return id != null ? id.Value : 0;
                }
            }
            catch (Exception ex)
            {
                SheetNumeratorLog.Error("browser", "Folder-ийн параметрийн id уншиж чадсангүй", ex);
            }
            return 0;
        }

        /// <summary>Browser-ийн эрэмбэлэх параметрийн ЗАМ (хоосон биш бол сүүлийнх нь утгыг өгнө).</summary>
        public static IReadOnlyList<ElementId> SortingParameterPath(BrowserOrganization org)
        {
            var list = new List<ElementId>();
            if (org == null)
                return list;
            try
            {
                if (SortingPathMethod != null)
                {
                    var path = SortingPathMethod.Invoke(org, null) as IEnumerable<ElementId>;
                    if (path != null)
                        list.AddRange(path);
                }
                if (list.Count == 0 && SortingIdProperty != null)
                {
                    ElementId id = SortingIdProperty.GetValue(org, null) as ElementId;
                    if (id != null)
                        list.Add(id);
                }
            }
            catch (Exception ex)
            {
                SheetNumeratorLog.Error("browser", "Эрэмбэлэх параметрийг уншиж чадсангүй", ex);
            }
            return list;
        }
    }
}
