using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;

namespace RevitMcpAddin
{
    /// <summary>
    /// Хүснэгт (ViewSchedule) уншигч — read-only. Эсийн ХАРАГДАХ текстийг
    /// (бүлэглэлт, нийлбэр, форматтайгаар нь — инженерийн харж байгаагаар)
    /// авдаг тул тооцоолол давхардахгүй, вэб дээр яг Revit-ийнх шиг гарна.
    /// </summary>
    public static class ScheduleReader
    {
        /// <summary>Нэг ведомостоос авах мөрийн дээд хязгаар (сервер: 5000).</summary>
        public const int MaxRows = 5_000;

        /// <summary>
        /// Илгээж болох ведомостууд: template биш, revision биш, мөн зохион
        /// байгуулалтын (Views/Sheets/Legend) биш. Нэрээр нь эрэмбэлнэ.
        /// </summary>
        public static List<ViewSchedule> CollectSendable(Document doc)
        {
            // Зохион байгуулалтын категориуд — төсөвт хамаагүй.
            var skipCats = new HashSet<long>
            {
                -2000279, // Views
                -2003100, // Sheets
                -2005029, // Keynote (legend)
                -2000150, // Generic Annotations
            };

            var list = new List<ViewSchedule>();
            foreach (Element e in new FilteredElementCollector(doc).OfClass(typeof(ViewSchedule)))
            {
                var s = (ViewSchedule)e;
                if (s.IsTemplate || s.IsTitleblockRevisionSchedule)
                    continue;
                try
                {
                    if (skipCats.Contains(s.Definition.CategoryId.Value))
                        continue;
                }
                catch
                {
                    // CategoryId унших боломжгүй — үлдээнэ
                }
                list.Add(s);
            }
            return list.OrderBy(s => CategoryNameOf(doc, s)).ThenBy(s => s.Name).ToList();
        }

        public static string CategoryNameOf(Document doc, ViewSchedule s)
        {
            try
            {
                Category cat = Category.GetCategory(doc, s.Definition.CategoryId);
                if (cat != null)
                    return cat.Name;
            }
            catch { }
            return "";
        }

        /// <summary>Body хэсгийн мөрийн тоо (сонгогчийн жагсаалтад харуулах).</summary>
        public static int RowCountOf(ViewSchedule s)
        {
            try
            {
                return s.GetTableData().GetSectionData(SectionType.Body).NumberOfRows;
            }
            catch
            {
                return 0;
            }
        }

        /// <summary>Нэг ведомостыг бүрэн уншина: баганын гарчиг + body эсүүд.</summary>
        public static SchedulePushItem Read(Document doc, ViewSchedule s)
        {
            var item = new SchedulePushItem
            {
                Name = s.Name,
                Category = CategoryNameOf(doc, s),
            };

            // Баганын гарчгууд — харагдах талбаруудын ColumnHeading.
            ScheduleDefinition def = s.Definition;
            for (int i = 0; i < def.GetFieldCount(); i++)
            {
                ScheduleField field = def.GetField(i);
                if (field.IsHidden)
                    continue;
                item.Columns.Add(field.ColumnHeading ?? field.GetName());
            }

            // Body эсүүд — GetCellText нь бүлэглэлт/нийлбэрийн мөрүүдийг ч өгнө.
            TableSectionData body = s.GetTableData().GetSectionData(SectionType.Body);
            int rows = Math.Min(body.NumberOfRows, MaxRows);
            int cols = body.NumberOfColumns;
            for (int r = 0; r < rows; r++)
            {
                var row = new List<string>(cols);
                bool any = false;
                for (int c = 0; c < cols; c++)
                {
                    string text = s.GetCellText(SectionType.Body, r, c) ?? string.Empty;
                    if (text.Length > 0)
                        any = true;
                    row.Add(text);
                }
                if (any)
                    item.Rows.Add(row);
            }
            return item;
        }
    }
}
