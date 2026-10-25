using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using MglBb.Core;
using MglBb.Flows;
using MglBb.Infra;
using MglBb.RevitSide;

namespace MglBb.MarkTidy
{
    /// <summary>«Хамааралгүй тэмдэг нуух»: сонгосон / идэвхтэй (эсвэл төслийн бүх) дэлгээсэд өөр гишүүний огтлол, хэсэглэлийн тэмдгийг нууна.</summary>
    internal static class MarkTidyFlow
    {
        private const string Title = "MGL ББ — Хамааралгүй тэмдэг нуух";

        public static Result Run(UIDocument uidoc)
        {
            Document doc = uidoc.Document;
            BbStandard std = BbStore.LoadForProject(doc, out string _, out string _);

            // Сонгосон / идэвхтэй харагдац — гишүүнийг таньж (нэр эсвэл геометр); байхгүй бол төслийн нэрээр танигдах бүх дэлгээс.
            var picked = uidoc.Selection.GetElementIds().Select(id => doc.GetElement(id)).OfType<View>().ToList();
            if (picked.Count == 0 && uidoc.ActiveView is ViewSection) picked.Add(uidoc.ActiveView);
            var rows = new List<KeyValuePair<View, string>>();
            foreach (View v in picked)
            {
                string m = BbMarkTidy.ElevationMark(doc, v, std);
                if (m != null) rows.Add(new KeyValuePair<View, string>(v, m));
            }
            bool whole = rows.Count == 0;
            if (whole)
            {
                List<string> patterns = BbMarkTidy.ElevPatterns(std);
                foreach (ViewSection v in new FilteredElementCollector(doc).OfClass(typeof(ViewSection)).Cast<ViewSection>().Where(v => !v.IsTemplate).OrderBy(v => v.Name))
                {
                    string m = BbMarkNames.MarkOf(v.Name, patterns);
                    if (m != null) rows.Add(new KeyValuePair<View, string>(v, m));
                }
            }
            if (rows.Count == 0)
            {
                TaskDialog.Show(Title, "Дэлгээс олдсонгүй.  Дамнуруу / багана / ханын дэлгээсийг нээх эсвэл Project Browser-оос сонгоно уу.");
                return Result.Cancelled;
            }

            var dlg = new BbDialog(Title, (whole ? "Дэлгээс сонгоогүй тул төслийн бүх дэлгээс (" + rows.Count + ")." : "Сонгосон дэлгээс " + rows.Count + ".") +
                "  Дэлгээс бүрт тэр гишүүнд хамааралгүй огтлол / хэсэглэлийн тэмдгийг нууна.", 640);
            dlg.OkButton.Content = "Нуух";
            var lb = dlg.Picker(rows.Select(r => r.Key.Name + "   · " + r.Value), Math.Min(320, 40 + 22 * rows.Count), rows.Count > 8);
            lb.SelectAll();
            dlg.Note("Өөрийнх гэж үлдэх: нэрэнд гишүүний тэмдэг байгаа («ДН-1 S2»), эсвэл дэлгээстэй ижил хуудсанд байрласан харагдац.  " +
                     "Буцааж харуулах бол Revit-ийн «Reveal Hidden Elements».");
            if (!dlg.Show(uidoc.Application.MainWindowHandle)) return Result.Cancelled;
            var chosen = lb.SelectedItems.Cast<object>().Select(o => rows[lb.Items.IndexOf(o)]).ToList();
            if (chosen.Count == 0) return Result.Cancelled;

            var lines = new List<string>();
            int total = 0;
            using (var t = new Transaction(doc, "MGL ББ: хамааралгүй тэмдэг нуух"))
            {
                t.Start();
                FlowCommon.Swallow(t);
                foreach (KeyValuePair<View, string> r in chosen)
                {
                    int h = BbMarkTidy.HideForeign(doc, r.Key, r.Value, null);
                    total += h;
                    if (h > 0) lines.Add("«" + r.Key.Name + "»: " + h);
                }
                t.Commit();
            }
            if (lines.Count == 0) lines.Add("Нуух тэмдэг байсангүй — бүгд өөрийнх эсвэл аль хэдийн нуусан.");
            new TaskDialog(Title) { MainInstruction = chosen.Count + " дэлгээсэд " + total + " тэмдэг нуув.", MainContent = string.Join(Environment.NewLine, lines.Take(14)) }.Show();
            return Result.Succeeded;
        }
    }
}
