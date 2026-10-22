using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using MglBb.Core;
using MglBb.Flows;
using MglBb.Generate;
using MglBb.Infra;
using MglBb.RevitSide;

namespace MglBb.Schedules
{
    /// <summary>
    /// «Түүвэр үүсгэх»: сонгосон дамнуруу (гинжээр) / багана (давхруудаар) / ханын бетон, арматурын түүврийг төсөлд байгаа өөр гишүүний
    /// түүврээс хувилна (нэр, шүүлтүүрийн тэмдэг солих — <see cref="BbSchedules.ForMember"/>); сонголтоор гишүүний зурагтай хуудсанд эсвэл тусдаа
    /// «… ТҮҮВЭР» хуудсанд байрлуулна.  Нэг TransactionGroup → нэг Ctrl+Z.
    /// </summary>
    internal static class ScheduleFlow
    {
        private const string Title = "MGL ББ — Түүвэр үүсгэх";

        private sealed class RoleRow
        {
            public BbMemberKind Kind;
            public BbSchedules.Role Role;
            public string Text;
        }

        public static Result Run(UIDocument uidoc)
        {
            Document doc = uidoc.Document;
            List<Element> picked = GenerateFlow.Pick(uidoc, "Түүвэр үүсгэх дамнуруу / багана / ханаа сонгоно уу (Finish — дуусгах)");
            if (picked == null || picked.Count == 0) return Result.Cancelled;
            List<GenerateFlow.Item> items = GenerateFlow.BuildItems(doc, picked).Where(i => i.Slab == null && !string.IsNullOrEmpty(i.Mark)).ToList();
            if (items.Count == 0)
            {
                TaskDialog.Show(Title, "Сонгосон элементүүдэд тэмдэг (Mark)-тэй дамнуруу, багана, хана алга — түүврийн шүүлтүүр тэмдгээр ажилладаг.");
                return Result.Cancelled;
            }
            BbStandard std = BbStore.LoadStandard(out string src);

            // Гишүүний төрөл бүрийн жишээ түүврүүд (тэр ангиллын БҮХ тэмдгээр).
            var rows = new List<RoleRow>();
            foreach (BbMemberKind kind in items.Select(i => Group(i.Kind)).Distinct())
            {
                var marks = new FilteredElementCollector(doc).OfCategory(Category(kind)).WhereElementIsNotElementType().Select(BbGeom.Mark).Where(m => m.Length > 0).Distinct().ToList();
                foreach (BbSchedules.Role r in BbSchedules.RolesAnywhere(doc, marks))
                    rows.Add(new RoleRow { Kind = kind, Role = r, Text = BbStandard.KindName(kind) + ":  " + r.Pattern + "   (жишээ «" + r.Template.Name + "»" + (r.Sheets > 0 ? ", хуудсанд " + r.Sheets : "") + ")" });
            }
            if (rows.Count == 0)
            {
                TaskDialog.Show(Title, "Энэ төсөлд хувилах жишээ түүвэр алга.\n\nНэг гишүүний бетон, арматурын түүврийг гараар үүсгэнэ үү: түүврийн нэр тэмдгээр төгссөн " +
                    "(ж: «204.ББ.РАМ.БЕТОН ДН-1»), шүүлтүүрт тэр тэмдэг орсон (Mark = ДН-1, эсвэл арматурын Partition = «ДАМНУРУУ ДН-1 АРМАТУРЧЛАЛ»).  " +
                    "Дараа нь энэ хэрэгсэл бусад гишүүнд автоматаар хувилна.");
                return Result.Cancelled;
            }

            var dlg = new BbDialog(Title, "Сонгосон гишүүдийн бетон, арматурын түүврийг төсөлд байгаа жишээ түүврээс хувилна — нэр болон шүүлтүүрийн тэмдгийг сольж.", 680);
            dlg.Section("Гишүүд (" + items.Count + ")");
            dlg.List(items.Select(i => i.Text), Math.Min(140, 26 + 18 * items.Count));
            dlg.Section("Хувилах түүвэр (" + rows.Count + ")");
            var lb = dlg.Picker(rows.Select(r => r.Text), Math.Min(260, 40 + 20 * rows.Count));
            bool anyDefault = rows.Any(r => BbCompanyRules.IsRequiredSchedule(r.Role.Pattern));
            for (int i = 0; i < rows.Count; i++)
                if (!anyDefault || BbCompanyRules.IsRequiredSchedule(rows[i].Role.Pattern)) lb.SelectedItems.Add(lb.Items[i]);
            dlg.Note("Арматур, бетон, арматурын НЭГДСЭН түүвэр, хэсгийн ТОДОРХОЙЛОЛТ урьдчилан сонгогдсон.  Ctrl / Shift-ээр нэмж хасна.  " +
                     "Ижил нэртэй түүвэр аль хэдийн байвал дахин ашиглана.");
            var cSheet = dlg.Check("Хуудсанд байрлуулах", true, "Гишүүний зурагтай хуудасны баруун талд; багтахгүй бол тусдаа «… ТҮҮВЭР» хуудас.");
            dlg.Note("Стандарт: " + src);
            if (!dlg.Show(uidoc.Application.MainWindowHandle)) return Result.Cancelled;
            var chosen = new List<RoleRow>();
            foreach (object o in lb.SelectedItems) chosen.Add(rows[lb.Items.IndexOf(o)]);
            if (chosen.Count == 0) return Result.Cancelled;
            bool onSheet = cSheet.IsChecked == true;

            var sw = Stopwatch.StartNew();
            var issues = new List<BbIssue>();
            var notes = new List<string>();
            int made = 0, placed = 0;
            ViewSchedule first = null;
            using (var tg = new TransactionGroup(doc, "MGL ББ: түүвэр үүсгэх"))
            {
                tg.Start();
                foreach (GenerateFlow.Item it in items)
                {
                    List<BbSchedules.Role> roles = chosen.Where(r => r.Kind == Group(it.Kind)).Select(r => r.Role).ToList();
                    if (roles.Count == 0) continue;
                    using (var t = new Transaction(doc, "MGL ББ: түүвэр " + it.Mark))
                    {
                        t.Start();
                        FlowCommon.Swallow(t);
                        int before = CountSchedules(doc);
                        List<ViewSchedule> list = BbSchedules.ForMember(doc, it.Mark, roles, issues, notes);
                        made += CountSchedules(doc) - before;
                        if (first == null) first = list.FirstOrDefault();
                        if (onSheet && list.Count > 0) placed += Place(doc, it, list, std, issues, notes);
                        t.Commit();
                    }
                }
                tg.Assimilate();
            }
            if (first != null) { try { uidoc.ActiveView = first; } catch { } }
            var lines = new List<string>
            {
                "Шинээр хувилсан түүвэр " + made + (onSheet ? ", хуудсанд байрлуулсан " + placed : ""),
                "Хугацаа " + (sw.ElapsedMilliseconds / 1000.0).ToString("0", CultureInfo.InvariantCulture) + " сек",
                "",
            };
            lines.AddRange(notes.Take(8));
            FlowCommon.Summary(uidoc, "Түүвэр үүсгэх", items.Count + " гишүүний түүвэр бэлэн.", lines, issues);
            return Result.Succeeded;
        }

        /// <summary>Гишүүний зурагтай хуудас (харагдацын нэрэнд тэмдэгтэй, цувралын хуудсыг илүүд) — багтахгүй/байхгүй бол «… ТҮҮВЭР» хуудас.</summary>
        private static int Place(Document doc, GenerateFlow.Item it, List<ViewSchedule> list, BbStandard std, List<BbIssue> issues, List<string> notes)
        {
            string prefix = BbSheets.Prefix(std.Sheet, it.Kind) ?? "";
            ViewSheet home = new FilteredElementCollector(doc).OfClass(typeof(ViewSheet)).Cast<ViewSheet>()
                .Where(s => s.GetAllViewports().Any(id => doc.GetElement(id) is Viewport vp && doc.GetElement(vp.ViewId) is View v && BbSchedules.TokenIndex(v.Name ?? "", it.Mark) >= 0))
                .OrderByDescending(s => prefix.Length > 0 && (s.SheetNumber ?? "").StartsWith(prefix, StringComparison.Ordinal))
                .ThenBy(s => s.SheetNumber, StringComparer.Ordinal)
                .FirstOrDefault();
            if (home != null && BbSchedules.PlaceOn(doc, home, list, out int n)) return n;
            ViewSheet extra = BbSheets.ScheduleSheet(doc, it.Mark, it.Kind, std, issues);
            if (extra == null) return 0;
            if (BbSchedules.PlaceOn(doc, extra, list, out n))
            {
                notes.Add(it.Mark + ": түүвэр «" + extra.SheetNumber + " " + extra.Name + "» хуудсанд.");
                return n;
            }
            try { doc.Delete(extra.Id); } catch { }
            issues.Add(new BbIssue
            {
                Tool = "Түүвэр үүсгэх", Severity = BbSeverity.Warning, Member = it.Mark,
                Problem = "Түүвэр (" + string.Join(", ", list.Select(x => "«" + x.Name + "»")) + ") хуудасны өндрөөс урт — байрлуулсангүй.",
                Proposal = "Түүврийг Revit-ийн «Split Schedule»-ээр хувааж гараар байрлуулах.",
                Key = "sched-tall|" + it.Mark,
            });
            return 0;
        }

        private static BbMemberKind Group(BbMemberKind k) { return k == BbMemberKind.BeamAux ? BbMemberKind.Beam : k; }

        private static BuiltInCategory Category(BbMemberKind k)
        {
            return k == BbMemberKind.Column ? BuiltInCategory.OST_StructuralColumns : k == BbMemberKind.Wall ? BuiltInCategory.OST_Walls : BuiltInCategory.OST_StructuralFraming;
        }

        private static int CountSchedules(Document doc)
        {
            return new FilteredElementCollector(doc).OfClass(typeof(ViewSchedule)).GetElementCount();
        }
    }
}
