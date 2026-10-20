using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.Smart
{
    /// <summary>
    /// Загварын ангиллын жагсаалт (Smart Count, Clash Checker хоёуланд).  ЗӨВХӨН built-in загварын
    /// ангилал (BuiltInCategory нэрээр — UI хэлнээс үл хамаарна); хэрэглэгчийн өөрийн/Revit-ийн
    /// дотоод ангилал, annotation, analytical орохгүй.
    /// ⚠️ Revit API — үндсэн thread (`SmartExecutor`) дээр.
    /// </summary>
    internal static class SmartCategories
    {
        internal static IReadOnlyList<CategoryInfo> ModelCategories(Document doc)
        {
            var list = new List<CategoryInfo>();
            foreach (Category c in doc.Settings.Categories)
            {
                try
                {
                    if (c.CategoryType != CategoryType.Model || !c.AllowsBoundParameters || !c.IsVisibleInUI) continue;
                    long id = c.Id.Value;
                    if (id >= 0) continue;   // built-in категори сөрөг id-тай
                    var bic = (BuiltInCategory)(int)id;
                    if (!Enum.IsDefined(typeof(BuiltInCategory), bic)) continue;
                    list.Add(new CategoryInfo { Id = bic.ToString(), Name = c.Name });
                }
                catch (Exception) { /* нэг ангиллын алдаа жагсаалтыг унагахгүй */ }
            }
            return list.OrderBy(c => c.Name, StringComparer.CurrentCultureIgnoreCase).ToList();
        }
    }
}
