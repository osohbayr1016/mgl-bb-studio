using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using MglBb.Core;
using MglBb.Flows;
using MglBb.Infra;
using MglBb.RevitSide;

namespace MglBb.HostFix
{
    /// <summary>«Хост засах»: сонгосон арматур / гишүүд (эсвэл идэвхтэй огтлол, дэлгээсийн гишүүд; аль нь ч үгүй бол бүх загвар) — хост буруу арматурыг зөв гишүүнд шилжүүлнэ.</summary>
    internal static class HostFixFlow
    {
        private const string Title = "MGL ББ — Арматурын хост засах";

        public static Result Run(UIDocument uidoc)
        {
            Document doc = uidoc.Document;
            BbStandard std = BbStore.LoadForProject(doc, out string _, out string _);

            var scope = uidoc.Selection.GetElementIds().Select(id => doc.GetElement(id)).Where(e => e != null && !(e is View)).ToList();
            string where;
            if (scope.Count > 0) where = "Сонгосон " + scope.Count + " элемент";
            else if (uidoc.ActiveView is ViewSection av && !av.IsTemplate)
            {
                // Огтлол / дэлгээс: харагдах дамнуруу, баганын хүрээ (нуусан арматур ч орно — загварын collector-оор).
                scope = new FilteredElementCollector(doc, av.Id).WherePasses(new ElementMulticategoryFilter(new List<BuiltInCategory>
                    { BuiltInCategory.OST_StructuralFraming, BuiltInCategory.OST_StructuralColumns })).WhereElementIsNotElementType().ToList();
                where = "«" + av.Name + "»-ийн " + scope.Count + " гишүүн";
            }
            else where = "Бүх загвар";

            List<BbHostFix> fixes = BbRebarHost.Find(doc, scope, out int checkedCount, out int unclear);
            if (fixes.Count == 0)
            {
                TaskDialog.Show(Title, where + ": " + checkedCount + " арматур шалгав — хост бүгд зөв." +
                    (unclear > 0 ? Environment.NewLine + unclear + " арматур аль ч гишүүнд хагасаас илүү багтаагүй тул хөндсөнгүй." : ""));
                return Result.Succeeded;
            }

            var dlg = new BbDialog(Title, where + ": " + checkedCount + " арматур шалгав, " + fixes.Count + " нь өөр гишүүнд хостлогдсон.  " +
                "Арматурын тэнхлэг аль гишүүний биет дотор илүү багтсанаар зөв хостыг олов.", 760);
            dlg.OkButton.Content = "Хост засах";
            var lb = dlg.Picker(fixes.Select(Line), Math.Min(360, 40 + 22 * fixes.Count), fixes.Count > 8);
            lb.SelectAll();
            dlg.Note("Хувь = арматурын тэнхлэгийн хэдэн хувь нь тэр гишүүнд багтсан.  Шилжүүлсний дараа гишүүний дэлгээсэд нуусан арматурыг харуулж, хуучин хостын дэлгээсэд нууна.  " +
                     "Огтлолын шошгыг «Стандартаар тэмдэглэх»-ээр дахин тавина уу.");
            if (!dlg.Show(uidoc.Application.MainWindowHandle)) return Result.Cancelled;
            var chosen = lb.SelectedItems.Cast<object>().Select(o => fixes[lb.Items.IndexOf(o)]).ToList();
            if (chosen.Count == 0) return Result.Cancelled;

            var errors = new List<string>();
            int done, shown, hidden;
            using (var t = new Transaction(doc, "MGL ББ: арматурын хост засах"))
            {
                t.Start();
                FlowCommon.Swallow(t);
                done = BbRebarHost.Apply(doc, chosen, std, errors, out shown, out hidden);
                t.Commit();
            }
            var lines = chosen.GroupBy(f => BbRebarHost.Describe(f.To)).Select(g => "→ " + g.Key + ": " + g.Count() + " арматур").ToList();
            if (shown + hidden > 0) lines.Add("Дэлгээс: " + shown + " арматур харуулав, " + hidden + " нуув.");
            lines.AddRange(errors.Take(6).Select(e => "Алдаа " + e));
            new TaskDialog(Title) { MainInstruction = done + " арматурын хостыг засав.", MainContent = string.Join(Environment.NewLine, lines.Take(14)) }.Show();
            return Result.Succeeded;
        }

        private static string Line(BbHostFix f)
        {
            string type = f.Bar.Document.GetElement(f.Bar.GetTypeId())?.Name ?? "";
            int q = 1;
            try { q = f.Bar.Quantity; } catch { }
            return type + (q > 1 ? " ×" + q : "") + " [" + f.Bar.Id.Value + "]   " + BbRebarHost.Describe(f.From) + " " + Pct(f.FromShare) + "  →  " + BbRebarHost.Describe(f.To) + " " + Pct(f.Share);
        }

        private static string Pct(double s) { return Math.Round(s * 100) + "%"; }
    }
}
