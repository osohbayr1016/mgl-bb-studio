using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using MglBb.Core;
using MglBb.Flows;
using MglBb.Infra;
using MglBb.RevitSide;

namespace MglBb.DeleteLog
{
    /// <summary>«Устгалтын түүх»: загварт бүртгэгдсэн устгалт (хэн, хэзээ, юуг) — хамт ажилладаг бүх хүнд Synchronize-ийн дараа ижил.</summary>
    internal static class DeleteLogFlow
    {
        private const string Title = "MGL ББ — Устгалтын түүх";

        public static Result Run(UIDocument uidoc)
        {
            Document doc = uidoc.Document;
            List<BbDeleteBatch> all = BbDeleteWatch.ReadAll(doc).OrderByDescending(b => b.When).ToList();
            BbDeleteWatch.MarkAllSeen(doc, all);

            var rows = new List<string>();
            foreach (BbDeleteBatch b in all)
            {
                string head = Local(b) + " · " + b.User;
                foreach (BbDeletedItem it in b.Items) rows.Add(head + Environment.NewLine + "   " + BbDeleteLog.Sentence(b, it));
                if (b.Truncated > 0) rows.Add(head + Environment.NewLine + "   … нэрээр бүртгээгүй өөр " + b.Truncated + " элемент");
            }
            int people = all.Select(b => b.User).Distinct(StringComparer.OrdinalIgnoreCase).Count();
            var dlg = new BbDialog(Title, "Энэ загварт " + all.Count + " устгалт, " + rows.Count + " элемент, " + people + " хүн.  " +
                (doc.IsWorkshared ? "Хамт ажилладаг бүх хүнд Synchronize / Reload Latest-ийн дараа ижил харагдана." : "Загвар workshared биш."), 760);
            dlg.OkButton.Content = "Хаах";
            dlg.Picker(rows, 360, true);
            dlg.Note("Зөвхөн сонгож устгасан элемент бүртгэгдэнэ (хамт устсан шошго, хэмжээсийг тоогоор).  Undo хийсэн устгалт бүртгэлээс ч буцна.");
            var warn = dlg.Check("Устгахын өмнө анхааруулах", BbDeleteWatch.State.WarnBeforeDelete,
                "Унтраасан ч устгалт бүртгэгдэж бусдад мэдэгдэнэ — зөвхөн энэ компьютерийн асуулт.");
            dlg.ResultButton("Excel-ээр гаргах", 1);
            bool shown = dlg.Show(uidoc.Application.MainWindowHandle);
            if ((warn.IsChecked == true) != BbDeleteWatch.State.WarnBeforeDelete)
            {
                BbDeleteWatch.State.WarnBeforeDelete = warn.IsChecked == true;
                BbDeleteWatch.SaveState();
            }
            if (!shown || dlg.ResultCode != 1) return Result.Succeeded;

            string path = ExportPath(doc);
            try
            {
                BbXlsx.Write(path, new[] { Sheet(all) });
                FlowCommon.Open(path);
                return Result.Succeeded;
            }
            catch (IOException ex)
            {
                TaskDialog.Show(Title, "Excel-д бичиж чадсангүй (файл нээлттэй байж магадгүй): " + ex.Message + Environment.NewLine + path);
                return Result.Failed;
            }
        }

        private static string Local(BbDeleteBatch b)
        {
            return b.When == DateTime.MinValue ? "?" : b.When.ToLocalTime().ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture);
        }

        private static string ExportPath(Document doc)
        {
            string dir = Path.GetDirectoryName(BbStore.IssuesPath(doc));
            return Path.Combine(dir, "Устгалтын түүх " + DateTime.Now.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture) + ".xlsx");
        }

        private static BbXlsx.Sheet Sheet(IEnumerable<BbDeleteBatch> all)
        {
            var sh = new BbXlsx.Sheet { Name = "Устгалт" };
            sh.Header.AddRange(new[] { "Огноо", "Устгасан", "Ангилал", "Нэр", "Марк", "Түвшин", "Үүсгэсэн", "Element Id", "Харагдац" });
            sh.Widths.AddRange(new[] { 17.0, 16, 20, 36, 12, 14, 16, 12, 28 });
            foreach (BbDeleteBatch b in all)
                foreach (BbDeletedItem it in b.Items)
                    sh.Rows.Add(new List<string> { Local(b), b.User, it.Category, it.Name, it.Mark, it.Level, it.Creator, it.Id.ToString(CultureInfo.InvariantCulture), b.View });
            return sh;
        }
    }
}
