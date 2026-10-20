using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Autodesk.Revit.DB;
using MglBb.Core;

namespace MglBb.RevitSide
{
    /// <summary>
    /// Гишүүний ТҮҮВЭР (ЖИШЭЭ-1: «201.ББ.РАМ.АРМАТУР Дн-1» Partition = «ДАМНУРУУ ДН-1 АРМАТУРЧЛАЛ», «204.ББ.РАМ.БЕТОН ДН-1» Mark = «ДН-1»,
    /// «205.ББ.РАМ. ХЭСГИЙН ТОДОРХОЙЛОЛТ Дн-1» Partition + Shape ≠ …; багананд 201/202/203/205 «БАГАНА Б-n»).
    /// Инженер нэг гишүүний түүврийг хуулж, нэр болон шүүлтүүрийн утган дахь ТЭМДГИЙГ сольдог — энд яг тэгнэ: тухайн цувралын хуудсанд
    /// байрласан түүврүүдээс «үүрэг» (нэр − тэмдэг) бүрийн жишээг олж (≥ 30 % хуудсанд байдаг үүрэг л), View.Duplicate → нэр, шүүлтүүрийн утгад
    /// тэмдэг солих.  Ижил нэртэй түүвэр байвал ДАХИН ашиглана (хуулахгүй).  Хоосон гарсан түүвэр (арматурын Partition өөр) = асуудал.
    /// Нээлттэй Transaction дотор.
    /// </summary>
    internal static class BbSchedules
    {
        internal sealed class Role
        {
            public string Pattern;          // «201.ББ.РАМ.АРМАТУР {mark}»
            public ViewSchedule Template;
            public string TemplateMark;     // жишээний тэмдэг (ж: «Дн-1»)
            public int Sheets;
        }

        /// <summary>Цувралын (<paramref name="prefix"/>) хуудсуудаас түүврийн үүргүүд.  <paramref name="marks"/> = тэр төрлийн бүх тэмдэг.</summary>
        public static List<Role> Roles(Document doc, string prefix, ICollection<string> marks)
        {
            var res = new List<Role>();
            if (string.IsNullOrEmpty(prefix) || marks == null || marks.Count == 0) return res;
            var sheets = new FilteredElementCollector(doc).OfClass(typeof(ViewSheet)).Cast<ViewSheet>()
                .Where(s => (s.SheetNumber ?? "").StartsWith(prefix, StringComparison.Ordinal)).ToList();
            if (sheets.Count == 0) return res;
            var sheetIds = new HashSet<long>(sheets.Select(s => s.Id.Value));
            var byMarkLen = marks.Where(m => !string.IsNullOrWhiteSpace(m)).Distinct(StringComparer.OrdinalIgnoreCase).OrderByDescending(m => m.Length).ToList();
            var roles = new Dictionary<string, Role>(StringComparer.Ordinal);
            var roleSheets = new Dictionary<string, HashSet<long>>(StringComparer.Ordinal);
            foreach (ScheduleSheetInstance si in new FilteredElementCollector(doc).OfClass(typeof(ScheduleSheetInstance)).Cast<ScheduleSheetInstance>())
            {
                if (!sheetIds.Contains(si.OwnerViewId.Value)) continue;
                if (si.IsTitleblockRevisionSchedule) continue;
                if (!(doc.GetElement(si.ScheduleId) is ViewSchedule vs) || vs.IsTemplate) continue;
                string name = vs.Name ?? "";
                string mark = byMarkLen.FirstOrDefault(m => EndsWithToken(name, m));
                if (mark == null) continue;
                if (!FiltersMention(vs, mark)) continue;          // шүүлтүүрт тэмдэггүй (нийт түүвэр г.м.) — гишүүний түүвэр биш
                string pattern = name.Substring(0, name.Length - mark.Length) + "{mark}";
                if (!roles.TryGetValue(pattern, out Role r))
                {
                    r = new Role { Pattern = pattern, Template = vs, TemplateMark = mark };
                    roles[pattern] = r;
                    roleSheets[pattern] = new HashSet<long>();
                }
                roleSheets[pattern].Add(si.OwnerViewId.Value);
            }
            // Үүрэг нь гишүүний түүвэртэй хуудсуудын ≥ 30 %-д (цувралын БҮХ хуудас биш — 6- цувралд байгуулалтын хуудас ч бий).
            int seriesSheets = Math.Max(1, roleSheets.Values.SelectMany(x => x).Distinct().Count());
            foreach (var kv in roles)
            {
                kv.Value.Sheets = roleSheets[kv.Key].Count;
                // Цувралын хуудасны ≥ 30 %-д байдаг үүрэг (нэг удаагийн «НЭГДСЭН» түүвэр ороход хуудас бүрд давтагдахгүй).
                if (kv.Value.Sheets >= Math.Max(2, 0.3 * seriesSheets)) res.Add(kv.Value);
            }
            return res.OrderBy(r => r.Pattern, StringComparer.Ordinal).ToList();
        }

        private static bool EndsWithToken(string name, string mark)
        {
            if (!name.EndsWith(mark, StringComparison.OrdinalIgnoreCase)) return false;
            int i = name.Length - mark.Length;
            return i == 0 || !char.IsLetterOrDigit(name[i - 1]);
        }

        private static bool FiltersMention(ViewSchedule vs, string mark)
        {
            try
            {
                ScheduleDefinition d = vs.Definition;
                for (int i = 0; i < d.GetFilterCount(); i++)
                {
                    ScheduleFilter f = d.GetFilter(i);
                    if (!f.IsStringValue) continue;
                    if (TokenIndex(f.GetStringValue() ?? "", mark) >= 0) return true;
                }
            }
            catch { }
            return false;
        }

        /// <summary>Тэмдэг үгийн хилтэй байх байрлал («ДН-1» нь «ДН-12» дотор ТААРАХГҮЙ).</summary>
        private static int TokenIndex(string s, string mark)
        {
            int from = 0;
            while (true)
            {
                int i = s.IndexOf(mark, from, StringComparison.OrdinalIgnoreCase);
                if (i < 0) return -1;
                bool l = i == 0 || !char.IsLetterOrDigit(s[i - 1]);
                int e = i + mark.Length;
                bool r = e >= s.Length || !char.IsLetterOrDigit(s[e]);
                if (l && r) return i;
                from = i + 1;
            }
        }

        private static string ReplaceToken(string s, string mark, string with)
        {
            int i = TokenIndex(s, mark);
            if (i < 0) return s;
            return s.Substring(0, i) + with + s.Substring(i + mark.Length);
        }

        /// <summary>Гишүүний түүврүүд (хувилсан/байгаа).  Хоосон гарсныг асуудал болгоно.</summary>
        public static List<ViewSchedule> ForMember(Document doc, string mark, IList<Role> roles, List<BbIssue> issues, List<string> notes)
        {
            var res = new List<ViewSchedule>();
            var byName = new Dictionary<string, ViewSchedule>(StringComparer.OrdinalIgnoreCase);
            foreach (ViewSchedule v in new FilteredElementCollector(doc).OfClass(typeof(ViewSchedule)).Cast<ViewSchedule>())
                if (!v.IsTemplate && !byName.ContainsKey(v.Name ?? "")) byName[v.Name ?? ""] = v;
            foreach (Role r in roles)
            {
                string name = r.Pattern.Replace("{mark}", mark);
                if (byName.TryGetValue(name, out ViewSchedule have)) { res.Add(have); continue; }
                ViewSchedule vs;
                try
                {
                    ElementId id = r.Template.Duplicate(ViewDuplicateOption.Duplicate);
                    vs = doc.GetElement(id) as ViewSchedule;
                    if (vs == null) continue;
                    vs.Name = name;
                    ScheduleDefinition d = vs.Definition;
                    for (int i = 0; i < d.GetFilterCount(); i++)
                    {
                        ScheduleFilter f = d.GetFilter(i);
                        if (!f.IsStringValue) continue;
                        string v = f.GetStringValue() ?? "";
                        string nv = ReplaceToken(v, r.TemplateMark, mark);
                        if (nv == v) continue;
                        f.SetValue(nv);
                        d.SetFilter(i, f);
                    }
                }
                catch (Exception ex)
                {
                    issues.Add(new BbIssue
                    {
                        Tool = "Хуудсанд байрлуулах", Severity = BbSeverity.Warning, Member = mark,
                        Problem = "Түүвэр «" + name + "»-ийг «" + r.Template.Name + "»-ээс хувилж чадсангүй: " + ex.Message.Split('\n')[0],
                        Proposal = "Түүврийг гараар хувилж шүүлтүүрийг солих.",
                        Key = "sched|" + mark + "|" + r.Pattern,
                    });
                    continue;
                }
                byName[name] = vs;
                res.Add(vs);
            }
            if (res.Count > 0) doc.Regenerate();
            foreach (ViewSchedule vs in res)
            {
                int rows;
                try { rows = new FilteredElementCollector(doc, vs.Id).GetElementCount(); } catch { rows = -1; }
                if (rows != 0) continue;
                string filt = "";
                try
                {
                    ScheduleDefinition d = vs.Definition;
                    for (int i = 0; i < d.GetFilterCount(); i++)
                    {
                        ScheduleFilter f = d.GetFilter(i);
                        if (f.IsStringValue && TokenIndex(f.GetStringValue() ?? "", mark) >= 0)
                        {
                            filt = (d.GetField(f.FieldId)?.GetName() ?? "?") + " = «" + f.GetStringValue() + "»";
                            break;
                        }
                    }
                }
                catch { }
                issues.Add(new BbIssue
                {
                    Tool = "Хуудсанд байрлуулах", Severity = BbSeverity.Warning, Member = mark, View = vs.Name, ViewId = vs.Id.Value,
                    Problem = "Түүвэр «" + vs.Name + "» хоосон" + (filt.Length > 0 ? " (шүүлтүүр " + filt + ")" : "") + ".",
                    Proposal = filt.StartsWith("Partition", StringComparison.Ordinal)
                        ? "Гишүүний арматурын Partition-ийг «" + filt.Substring(filt.IndexOf('«') + 1).TrimEnd('»') + "» болгох (арматурын дугаар шинэчлэгдэнэ)."
                        : "Гишүүний параметр шүүлтүүртэй таарах эсэхийг шалгах.",
                    Key = "sched-empty|" + vs.Name,
                });
            }
            return res;
        }

        /// <summary>
        /// Хуудасны баруун талд (дээрээс доош, багтахгүй бол зүүн тийш дараагийн багана) байрлуулна; viewport/өөр түүвэртэй давхцахгүй.
        /// Хуудас бүрт багтахгүй бол false (дуудагч тусдаа «… ТҮҮВЭР» хуудас үүсгэнэ).  Аль хэдийн тэр хуудсанд байвал алгасна.
        /// </summary>
        public static bool PlaceOn(Document doc, ViewSheet sheet, IList<ViewSchedule> schedules, out int placed)
        {
            placed = 0;
            if (schedules == null || schedules.Count == 0) return true;
            BoundingBoxXYZ tb = null;
            foreach (Element e in new FilteredElementCollector(doc, sheet.Id).OfCategory(BuiltInCategory.OST_TitleBlocks).WhereElementIsNotElementType())
            {
                tb = e.get_BoundingBox(sheet);
                if (tb != null) break;
            }
            double mm = 1 / 304.8;
            double x0 = tb != null ? tb.Min.X : -594 * mm, x1 = tb != null ? tb.Max.X : 0, y0 = tb != null ? tb.Min.Y : 0, y1 = tb != null ? tb.Max.Y : 420 * mm;
            double right = x1 - 11 * mm, top = y1 - 8 * mm, bottom = y0 + 48 * mm, left = x0 + 20 * mm, gap = 3 * mm;
            var busy = new List<BbSheets.Rect>();
            foreach (ElementId id in sheet.GetAllViewports())
                if (doc.GetElement(id) is Viewport vp && doc.GetElement(vp.ViewId) is View v) busy.Add(BbSheets.Content(doc, vp, v));
            var already = new HashSet<long>();
            foreach (ScheduleSheetInstance si in new FilteredElementCollector(doc, sheet.Id).OfClass(typeof(ScheduleSheetInstance)).Cast<ScheduleSheetInstance>())
            {
                if (si.IsTitleblockRevisionSchedule) continue;
                already.Add(si.ScheduleId.Value);
                BoundingBoxXYZ b = si.get_BoundingBox(sheet);
                if (b != null) busy.Add(new BbSheets.Rect { X0 = b.Min.X, Y0 = b.Min.Y, X1 = b.Max.X, Y1 = b.Max.Y });
            }
            // Байрлал хайх: баруун талаас эхлэн, дээрээс доош — саадын (viewport/түүвэр) ирмэгүүдээр нэр дэвшигч цэг.  Хүрээний (title block)
            // доод хүснэгт баруун доод буланд (≈ 172 × 48 мм) — бусад хэсэгт доод зай 12 мм.
            double tbW = 172 * mm, tbH = 48 * mm, low = y0 + 12 * mm;
            var made = new List<ElementId>();
            foreach (ViewSchedule vs in schedules)
            {
                if (already.Contains(vs.Id.Value)) continue;
                ScheduleSheetInstance si = ScheduleSheetInstance.Create(doc, sheet.Id, vs.Id, new XYZ(x0, y1, 0));
                made.Add(si.Id);
                doc.Regenerate();
                BoundingBoxXYZ b = si.get_BoundingBox(sheet);
                if (b == null) continue;
                double w = b.Max.X - b.Min.X, h = b.Max.Y - b.Min.Y;
                var xs = new List<double> { right };
                var ys = new List<double> { top };
                foreach (BbSheets.Rect q in busy) { xs.Add(q.X0 - gap); ys.Add(q.Y0 - gap); }
                BbSheets.Rect? spot = null;
                foreach (double xr in xs.Where(v => v <= right + 1e-9).OrderByDescending(v => v))
                {
                    foreach (double yt in ys.Where(v => v <= top + 1e-9).OrderByDescending(v => v))
                    {
                        var r = new BbSheets.Rect { X0 = xr - w, X1 = xr, Y0 = yt - h, Y1 = yt };
                        if (r.X0 < left) continue;
                        double floor = r.X1 > x1 - tbW ? y0 + tbH : low;
                        if (r.Y0 < floor) continue;
                        if (busy.Any(q => Overlap(q, r))) continue;
                        spot = r;
                        break;
                    }
                    if (spot != null) break;
                }
                if (spot == null)
                {
                    foreach (ElementId id in made) { try { doc.Delete(id); } catch { } }
                    placed = 0;
                    return false;
                }
                XYZ p = si.Point;
                si.Point = new XYZ(p.X + (spot.Value.X0 - b.Min.X), p.Y + (spot.Value.Y1 - b.Max.Y), p.Z);
                busy.Add(spot.Value);
                placed++;
            }
            return true;
        }

        private static bool Overlap(BbSheets.Rect a, BbSheets.Rect b)
        {
            return a.X0 < b.X1 && b.X0 < a.X1 && a.Y0 < b.Y1 && b.Y0 < a.Y1;
        }
    }
}
