using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using MglBb.Core;
using MglBb.Flows;
using MglBb.Infra;
using MglBb.RevitSide;

namespace MglBb.Issues
{
    /// <summary>
    /// «Асуудал – Шийдэл»: инженерийн бөглөсөн Excel-ийг БУЦААЖ уншина — нээлттэй мөр бүрийн харагдац руу шууд очиж (элементийг сонгоно),
    /// инженерийн шийдлийг харуулна, засагдсаныг «Шийдсэн» гэж тэмдэглэнэ (Excel-д бичнэ).  Файл, хавтас нээх.
    /// </summary>
    internal static class IssuesFlow
    {
        private const string Title = "MGL ББ — Асуудал – Шийдэл";

        public static Result Run(UIDocument uidoc)
        {
            Document doc = uidoc.Document;
            string path = BbStore.IssuesPath(doc);
            if (!File.Exists(path))
            {
                var td = new TaskDialog(Title)
                {
                    MainInstruction = "Энэ төсөлд асуудал бүртгэгдээгүй байна",
                    MainContent = "«Ажлын зураг гаргах», «Стандартаар тэмдэглэх» ажилласны дараа үүснэ." + Environment.NewLine + Environment.NewLine + path,
                };
                td.AddCommandLink(TaskDialogCommandLinkId.CommandLink1, "Сурсан стандартын хавтас нээх", Path.GetDirectoryName(BbStore.StandardPath));
                if (td.Show() == TaskDialogResult.CommandLink1) FlowCommon.Open(Path.GetDirectoryName(BbStore.StandardPath));
                return Result.Succeeded;
            }
            List<KeyValuePair<string, BbIssue>> rows;
            try { rows = BbIssueBook.Load(path); }
            catch (Exception ex)
            {
                TaskDialog.Show(Title, "Excel-ийг уншиж чадсангүй: " + ex.Message + Environment.NewLine + Environment.NewLine + path);
                return Result.Failed;
            }
            List<int> open = OpenRows(rows);
            var by = rows.GroupBy(r => string.IsNullOrEmpty(r.Value.Status) ? "(хоосон)" : r.Value.Status).Select(g => g.Key + " " + g.Count());
            var dlg = new BbDialog(Title, "Нийт " + rows.Count + " мөр · " + string.Join(" · ", by) + ".  Доор — шийдэгдээгүй " + open.Count + ".", 760);
            dlg.OkButton.Content = "Харагдац руу очих";
            var lb = dlg.Picker(open.Select(i => Line(rows[i].Value)), 320);
            dlg.Note("Инженер Excel-ийн «Инженерийн шийдэл», «Төлөв», «Тайлбар» баганыг бөглөнө — хэрэгсэл дахин ажиллахад хадгалагдана.  " +
                     "Excel нээлттэй үед «Шийдсэн» гэж тэмдэглэх боломжгүй (файлыг хаана уу).");
            dlg.ResultButton("Шийдсэн гэж тэмдэглэх", 2);
            dlg.ResultButton("Excel нээх", 3);
            dlg.ResultButton("Хавтас нээх", 4);
            if (open.Count > 0) lb.SelectedIndex = 0;
            if (!dlg.Show(uidoc.Application.MainWindowHandle)) return Result.Cancelled;
            var chosen = new List<int>();
            foreach (object o in lb.SelectedItems) chosen.Add(open[lb.Items.IndexOf(o)]);
            switch (dlg.ResultCode)
            {
                case 3: FlowCommon.Open(path); return Result.Succeeded;
                case 4: FlowCommon.Open(Path.GetDirectoryName(path)); return Result.Succeeded;
                case 2:
                    if (chosen.Count == 0) return Result.Cancelled;
                    if (!MarkResolved(path, rows, chosen))
                    {
                        TaskDialog.Show(Title, "Excel нээлттэй байна — хаагаад дахин оролдоно уу." + Environment.NewLine + Environment.NewLine + path);
                        return Result.Failed;
                    }
                    TaskDialog.Show(Title, chosen.Count + " мөрийг «Шийдсэн» болгов.");
                    return Result.Succeeded;
                default:
                    if (chosen.Count == 0) return Result.Cancelled;
                    return GoTo(uidoc, rows[chosen[0]].Value) ? Result.Succeeded : Result.Failed;
            }
        }

        /// <summary>Шийдэгдээгүй мөрүүд: «Шийдсэн/Хамаагүй» биш; төлөвгүй «Мэдээлэл» мөр орохгүй.</summary>
        internal static List<int> OpenRows(IList<KeyValuePair<string, BbIssue>> rows)
        {
            var open = new List<int>();
            for (int i = 0; i < rows.Count; i++)
            {
                string st = rows[i].Value.Status ?? "";
                if (st == "Шийдсэн" || st == "Хамаагүй") continue;
                if (rows[i].Value.Severity == BbSeverity.Info && st.Length == 0) continue;
                open.Add(i);
            }
            return open;
        }

        internal static bool MarkResolved(string path, List<KeyValuePair<string, BbIssue>> rows, IEnumerable<int> which)
        {
            foreach (int i in which) rows[i].Value.Status = "Шийдсэн";
            try { BbIssueBook.Save(path, rows); return true; }
            catch (IOException) { return false; }
        }

        private static string Line(BbIssue x)
        {
            string where = string.IsNullOrEmpty(x.View) ? (string.IsNullOrEmpty(x.Sheet) ? x.Tool : "хуудас " + x.Sheet) : x.View;
            string head = (string.IsNullOrEmpty(x.Member) ? "" : x.Member + " · ") + where;
            string s = "[" + (string.IsNullOrEmpty(x.Status) ? "—" : x.Status) + "] " + head + Environment.NewLine + x.Problem;
            if (!string.IsNullOrEmpty(x.Decision)) s += Environment.NewLine + "Шийдэл: " + x.Decision;
            return s;
        }

        /// <summary>Мөрийн харагдац (ViewId → нэр → хуудас) руу очиж элементийг сонгоно.</summary>
        internal static bool GoTo(UIDocument uidoc, BbIssue x)
        {
            Document doc = uidoc.Document;
            View v = x.ViewId > 0 ? doc.GetElement(new ElementId(x.ViewId)) as View : null;
            if (v == null && !string.IsNullOrEmpty(x.View))
                v = new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>().FirstOrDefault(q => !q.IsTemplate && q.Name == x.View);
            if (v == null && !string.IsNullOrEmpty(x.Sheet))
                v = new FilteredElementCollector(doc).OfClass(typeof(ViewSheet)).Cast<ViewSheet>().FirstOrDefault(q => q.SheetNumber == x.Sheet);
            Element el = x.ElementId > 0 ? doc.GetElement(new ElementId(x.ElementId)) : null;
            if (v == null && el == null)
            {
                TaskDialog.Show(Title, "Мөрийн харагдац/элемент энэ төсөлд олдсонгүй (устгагдсан эсвэл өөр төсөл)." + Environment.NewLine + Environment.NewLine + x.Problem);
                return false;
            }
            try { if (v != null && !v.IsTemplate) uidoc.ActiveView = v; } catch { }
            if (el != null)
            {
                try
                {
                    uidoc.Selection.SetElementIds(new List<ElementId> { el.Id });
                    uidoc.ShowElements(el.Id);
                }
                catch { }
            }
            return true;
        }
    }
}
