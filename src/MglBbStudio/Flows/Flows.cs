using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Selection;
using MglBb.Core;
using MglBb.Infra;
using MglBb.RevitSide;

namespace MglBb.Flows
{
    /// <summary>Урсгалуудын нийтлэг хэсэг: дүгнэлтийн цонх, Excel, анхааруулга залгих.</summary>
    internal static class FlowCommon
    {
        public static void Summary(UIDocument uidoc, string title, string instruction, IEnumerable<string> lines, IList<BbIssue> issues)
        {
            Document doc = uidoc.Document;
            string path = BbStore.WriteIssues(doc, issues, out string err);
            var td = new TaskDialog("MGL ББ — " + title)
            {
                MainInstruction = instruction,
                MainContent = string.Join(Environment.NewLine, (lines ?? Enumerable.Empty<string>()).Take(14)),
            };
            int open = issues == null ? 0 : issues.Count(i => i.Severity != BbSeverity.Info);
            if (path != null)
            {
                td.FooterText = (open > 0 ? "Шийдэх асуудал " + open + " — " : "") + "«Асуудал – Шийдэл»: " + path + (err != null ? " (" + err + ")" : "");
                td.AddCommandLink(TaskDialogCommandLinkId.CommandLink1, "«Асуудал – Шийдэл» Excel нээх", "Инженер «Шийдэл / Төлөв» баганыг бөглөөд хөгжүүлэгчид илгээнэ.");
            }
            else if (err != null) td.FooterText = "Excel бичигдсэнгүй: " + err;
            td.AddCommandLink(TaskDialogCommandLinkId.CommandLink2, "Хаах");
            if (td.Show() == TaskDialogResult.CommandLink1 && path != null) Open(path);
        }

        public static void Open(string path)
        {
            try { Process.Start(new ProcessStartInfo(path) { UseShellExecute = true }); }
            catch (Exception ex) { TaskDialog.Show("MGL ББ", "Нээж чадсангүй: " + ex.Message + Environment.NewLine + path); }
        }

        public static void Swallow(Transaction t)
        {
            FailureHandlingOptions fho = t.GetFailureHandlingOptions();
            fho.SetFailuresPreprocessor(new BbSwallowWarnings());
            t.SetFailureHandlingOptions(fho);
        }

        public static string Mm(double mm) { return (mm / 1000).ToString("0.0", CultureInfo.InvariantCulture) + " м"; }
    }

    internal sealed class MemberFilter : ISelectionFilter
    {
        public bool AllowElement(Element e)
        {
            long c = e?.Category?.Id.Value ?? 0;
            if (BbPlates.IsWallHost(e) || BbPlates.IsSlabHost(e)) return true;
            return e is FamilyInstance && (c == (long)BuiltInCategory.OST_StructuralFraming || c == (long)BuiltInCategory.OST_StructuralColumns);
        }

        public bool AllowReference(Reference r, XYZ p) { return false; }
    }
}

namespace MglBb.Learn
{
    using MglBb.Flows;

    /// <summary>«Стандарт сурах»: энэ төслийн дууссан ажлын зургаас (хуудсанд байрлуулсан дэлгээс/огтлол) стандартыг сурч хадгална.  Загварт юу ч бичихгүй.</summary>
    internal static class LearnFlow
    {
        public static Result Run(UIDocument uidoc)
        {
            Document doc = uidoc.Document;
            BbStandard current = BbStore.LoadStandard(out string src);
            var ask = new TaskDialog("MGL ББ — Стандарт сурах")
            {
                MainInstruction = "Энэ төслийн ДУУССАН ажлын зургаас компанийн стандартыг сурах уу?",
                MainContent = "Хуудсанд байрлуулсан дамнуруу, багана, цутгамал хана, хучилтын зургийг (харагдацын төрөл, загвар, масштаб, crop, огтлолын байрлал, " +
                              "хэмжээс/шошго/MRA-ийн зай, хуудасны байрлал, дугаарын цуврал) шинжилнэ.  Энэ хэрэгслийн үүсгэсэн зургийг алгасна.  " +
                              "Загварт ЮУ Ч өөрчлөгдөхгүй.\n\nОдоогийн стандарт: " + src,
                FooterText = "Сурсан стандарт: " + BbStore.StandardPath,
            };
            ask.AddCommandLink(TaskDialogCommandLinkId.CommandLink1, "Хурдан", "Төрөл бүрээс 60 харагдац (ЖИШЭЭ-1 ≈ 1.5 минут).");
            ask.AddCommandLink(TaskDialogCommandLinkId.CommandLink2, "Бүрэн", "Бүх харагдац (том төсөлд 5+ минут).");
            ask.AddCommandLink(TaskDialogCommandLinkId.CommandLink3, "Болих");
            TaskDialogResult a = ask.Show();
            if (a != TaskDialogResult.CommandLink1 && a != TaskDialogResult.CommandLink2) return Result.Cancelled;
            int max = a == TaskDialogResult.CommandLink1 ? 60 : 100000;

            BbStandard learned = BbLearner.Learn(doc, current, max, out BbLearnReport rep);
            var lines = new List<string>
            {
                "Шинжилсэн харагдац " + rep.ViewsScanned + ", танигдсан " + rep.Classified + " (" + string.Join(", ", rep.PerKind.Select(kv => kv.Key + " " + kv.Value)) + ")",
                "Сурсан тохиргоо " + rep.FieldsLearned + " · " + (rep.ElapsedMs / 1000.0).ToString("0", CultureInfo.InvariantCulture) + " сек",
                "",
                "Дамнуруу: «" + learned.Beam.ElevViewType + "» 1:" + learned.Beam.ElevScale + ", огтлол 1:" + learned.Beam.SecScale + ", нэр «" + learned.Beam.ElevNamePattern + "»",
                "Туслах дамнуруу: «" + learned.BeamAux.ElevViewType + "»",
                "Багана: «" + learned.Column.ElevViewType + "» 1:" + learned.Column.ElevScale + ", огтлол 1:" + learned.Column.SecScale,
                "Хана: «" + learned.Plate.WallRebarViewType + "», MRA «" + learned.Plate.WallMraType + "»",
                "Хучилт: «" + learned.Plate.SlabBottomViewType + "» 1:" + learned.Plate.SlabScale + ", MRA «" + learned.Plate.SlabMraType + "»",
                "Хуудас: «" + learned.Sheet.TitleBlock + "», цуврал " + learned.Sheet.ColumnSheetPrefix + " / " + learned.Sheet.BeamSheetPrefix + " / " + learned.Sheet.WallSheetPrefix + " / " + learned.Sheet.SlabSheetPrefix,
            };
            lines.AddRange(rep.Notes.Take(5));
            if (rep.Classified == 0)
            {
                FlowCommon.Summary(uidoc, "Стандарт сурах", "Дууссан ажлын зураг олдсонгүй — стандарт өөрчлөгдсөнгүй.", lines, rep.Issues);
                return Result.Cancelled;
            }
            var save = new TaskDialog("MGL ББ — Стандарт сурах")
            {
                MainInstruction = "Стандарт сурлаа — хадгалах уу?",
                MainContent = string.Join(Environment.NewLine, lines),
                CommonButtons = TaskDialogCommonButtons.Yes | TaskDialogCommonButtons.No,
                FooterText = "Өмнөх стандарт standard.prev.json болж нөөцлөгдөнө.",
            };
            if (save.Show() != TaskDialogResult.Yes) return Result.Cancelled;
            BbStore.SaveStandard(learned);
            FlowCommon.Summary(uidoc, "Стандарт сурах", "Стандарт хадгалагдлаа.", new[] { BbStore.StandardPath }, rep.Issues);
            return Result.Succeeded;
        }
    }
}

namespace MglBb.Generate
{
    using MglBb.Flows;

    /// <summary>
    /// «Ажлын зураг гаргах»: сонгосон дамнуруу (гинжээр) / баганы (давхруудаар) арматураас стандартаар дэлгээс + огтлол үүсгэж, тэмдэглэнэ.
    /// Бүгд НЭГ TransactionGroup → нэг Ctrl+Z.
    /// </summary>
    internal static class GenerateFlow
    {
        internal sealed class Item
        {
            public string Mark, Text;
            public BbBeamChain Beam;
            public BbColumnStack Column;
            public BbWallStack Wall;
            public BbSlabLevel Slab;

            public BbMemberKind Kind
            {
                get
                {
                    if (Column != null) return BbMemberKind.Column;
                    if (Wall != null) return BbMemberKind.Wall;
                    if (Slab != null) return BbMemberKind.Slab;
                    return Beam != null && Beam.Aux ? BbMemberKind.BeamAux : BbMemberKind.Beam;
                }
            }
        }

        public static Result Run(UIDocument uidoc)
        {
            Document doc = uidoc.Document;
            List<Element> picked = Pick(uidoc);
            if (picked == null || picked.Count == 0) return Result.Cancelled;
            BbStandard std = BbStore.LoadStandard(out string src);

            List<Item> items = BuildItems(doc, picked);

            var dlg = new BbDialog("MGL ББ — Ажлын зураг гаргах", "Сонгосон гишүүдийн загварчилсан арматураас компанийн стандартаар дэлгээс ба огтлол үүсгэнэ.");
            dlg.Section("Гишүүд (" + items.Count + ")");
            dlg.List(items.Select(i => i.Text), Math.Min(160, 26 + 18 * items.Count));
            dlg.Section("Юу үүсгэх");
            var cElev = dlg.Check("Дэлгээс (арматурчлал)", true);
            var cSec = dlg.Check("Огтлол", true);
            var mode = dlg.Combo("Огтлолын байрлал", new[] { "Стандарт — тулгуур + дунд, давхардалгүй", "Алгасал бүрд (тулгуур + дунд)", "Зөвхөн дунд хэсэгт", "Зөвхөн тулгуурт" }, 0);
            var cAnn = dlg.Check("Стандартаар тэмдэглэх (хэмжээс, шошго, MRA)", true);
            var cSheet = dlg.Check("Хуудсанд байрлуулах (A2, дэлгээс дээр, огтлол доор)", true, "Дугаар — компанийн цувралын дараагийн чөлөөт дугаар (дамнуруу 5-, багана 4-).");
            var cSched = dlg.Check("Түүврийг хувилж хуудсанд байрлуулах (арматур, бетон)", true, "Энэ төслийн өөр гишүүний түүврийг хуулж, нэр болон шүүлтүүрийн тэмдгийг солино.");
            var exist = dlg.Combo("Ижил нэртэй харагдац байвал", new[] { "Алгасах", "Шинээр (нэрийн ард дугаар)" }, 0);
            dlg.Note("Стандарт: " + src);
            if (!dlg.Show(uidoc.Application.MainWindowHandle)) return Result.Cancelled;

            var opt = new BbGenOptions
            {
                Elevation = cElev.IsChecked == true,
                Sections = cSec.IsChecked == true,
                SectionMode = new[] { "auto", "all", "mid", "supports" }[Math.Max(0, mode.SelectedIndex)],
                Existing = exist.SelectedIndex == 1 ? "new" : "skip",
            };
            bool annotate = cAnn.IsChecked == true;
            bool onSheet = cSheet.IsChecked == true;
            if (!opt.Elevation && !opt.Sections) return Result.Cancelled;

            GenRun g = Execute(doc, items, std, opt, annotate, onSheet, cSched.IsChecked == true);
            List<BbIssue> issues = g.Issues;
            List<string> notes = g.Notes;
            BbAnnoReport rep = g.Rep;
            int elevs = g.Elevs, secs = g.Secs, skipped = g.Skipped, sheetCount = g.Sheets;
            View first = g.First;
            var sw = g.Watch;
            if (first != null) { try { uidoc.ActiveView = first; } catch { } }
            var lines = new List<string>
            {
                "Дэлгээс " + elevs + ", огтлол " + secs + (skipped > 0 ? " (ижил арматуртай " + skipped + " огтлол алгассан)" : "") + (onSheet ? ", хуудас " + sheetCount + (g.Schedules > 0 ? ", түүвэр " + g.Schedules : "") : ""),
            };
            if (annotate)
                lines.Add("Тэмдэглэгээ: огтлолын хэмжээс " + rep.SecDims + " (+арматурын гинж " + rep.BarChains + "), шошго " + (rep.SecTags + rep.ElevTags) + ", MRA " + rep.ElevMras + ", давхцал " + rep.ElevLaps);
            lines.Add("Хугацаа " + (sw.ElapsedMilliseconds / 1000.0).ToString("0", CultureInfo.InvariantCulture) + " сек");
            lines.Add("");
            lines.AddRange(notes.Take(8));
            FlowCommon.Summary(uidoc, "Ажлын зураг гаргах", (elevs + secs) + " харагдац үүслээ.", lines, issues);
            return Result.Succeeded;
        }

        internal static List<Item> BuildItems(Document doc, IEnumerable<Element> picked)
        {
            var items = new List<Item>();
            var seen = new HashSet<long>();
            foreach (Element e in picked)
            {
                if (seen.Contains(e.Id.Value)) continue;
                if (e is Wall wall)
                {
                    BbWallStack ws = BbPlates.WallStack(doc, wall);
                    foreach (Wall m in ws.Members) seen.Add(m.Id.Value);
                    items.Add(new Item { Mark = ws.Mark, Wall = ws, Text = ws.Mark + " — хана, " + ws.Members.Count + " хэсэг, " + FlowCommon.Mm(BbGeom.ToMm(ws.S1 - ws.S0)) + " × " + FlowCommon.Mm(BbGeom.ToMm(ws.Top - ws.Bottom)) + ", арматур " + ws.RebarCount + (ws.RebarCount == 0 ? "  ⚠ арматургүй" : "") });
                    continue;
                }
                if (e is Floor floor)
                {
                    BbSlabLevel sl = BbPlates.SlabLevel(doc, floor);
                    foreach (Floor m in sl.Floors) seen.Add(m.Id.Value);
                    seen.Add(floor.Id.Value);
                    if (items.Any(x => x.Slab != null && x.Slab.Level?.Id == sl.Level?.Id)) continue;
                    items.Add(new Item { Mark = sl.LevelText, Slab = sl, Text = sl.LevelText + " түвшний хучилт — " + sl.Floors.Count + " хавтан, арматур " + sl.RebarCount + (sl.RebarCount == 0 ? "  ⚠ арматургүй" : "") });
                    continue;
                }
                if (!(e is FamilyInstance fi)) continue;
                if (fi.Category.Id.Value == (long)BuiltInCategory.OST_StructuralColumns)
                {
                    BbColumnStack st = BbColumns.Stack(doc, fi);
                    foreach (FamilyInstance m in st.Members) seen.Add(m.Id.Value);
                    items.Add(new Item { Mark = st.Mark, Column = st, Text = Label(st.Mark, fi) + " — багана, " + st.Members.Count + " давхар, " + FlowCommon.Mm(BbGeom.ToMm(st.Top - st.Bottom)) + ", арматур " + st.RebarCount + (st.RebarCount == 0 ? "  ⚠ арматургүй" : "") });
                }
                else
                {
                    BbBeamChain ch = BbGeom.BeamChain(doc, fi);
                    foreach (FamilyInstance m in ch.Members) seen.Add(m.Id.Value);
                    items.Add(new Item { Mark = ch.Mark, Beam = ch, Text = Label(ch.Mark, fi) + " — " + (ch.Aux ? "туслах дамнуруу" : "дамнуруу") + ", " + ch.Members.Count + " элемент, " + FlowCommon.Mm(BbGeom.ToMm(ch.S1 - ch.S0)) + ", тулгуур " + ch.Supports.Count + ", арматур " + ch.RebarCount + (ch.RebarCount == 0 ? "  ⚠ арматургүй" : "") });
                }
            }

            return items;
        }

        internal sealed class GenRun
        {
            public readonly List<BbIssue> Issues = new List<BbIssue>();
            public readonly List<string> Notes = new List<string>();
            public readonly BbAnnoReport Rep = new BbAnnoReport();
            public int Elevs, Secs, Skipped, Sheets, Schedules;
            public View First;
            public readonly List<ViewSheet> CreatedSheets = new List<ViewSheet>();
            public Stopwatch Watch;
        }

        /// <summary>Цонхгүй гүйцэтгэл (gate-ээр ч туршигдана): НЭГ TransactionGroup — үүсгэх → тэмдэглэх → хуудас.</summary>
        internal static GenRun Execute(Document doc, IList<Item> items, BbStandard std, BbGenOptions opt, bool annotate, bool onSheet, bool schedules = true)
        {
            var g = new GenRun { Watch = Stopwatch.StartNew() };
            var roleCache = new Dictionary<BbMemberKind, List<BbSchedules.Role>>();
            var roles = new Dictionary<long, string>();
            List<BbIssue> issues = g.Issues;
            List<string> notes = g.Notes;
            BbAnnoReport rep = g.Rep;
            int elevs = 0, secs = 0, skipped = 0, sheetCount = 0;
            View first = null;
            using (var tg = new TransactionGroup(doc, "MGL ББ: ажлын зураг"))
            {
                tg.Start();
                try
                {
                    foreach (Item it in items)
                    {
                        BbGenResult r;
                        using (var t = new Transaction(doc, "MGL ББ: харагдац " + it.Mark))
                        {
                            t.Start();
                            FlowCommon.Swallow(t);
                            r = it.Column != null ? BbColumns.Create(doc, it.Column, std, opt)
                                : it.Wall != null ? BbPlates.CreateWall(doc, it.Wall, std, opt, roles)
                                : it.Slab != null ? BbPlates.CreateSlab(doc, it.Slab, std, opt, roles)
                                : BbViews.CreateBeam(doc, it.Beam, std, opt);
                            t.Commit();
                        }
                        elevs += r.Elevations.Count + r.Plans.Count;
                        secs += r.Sections.Count;
                        skipped += r.SkippedDuplicates;
                        notes.AddRange(r.Notes);
                        issues.AddRange(r.Issues);
                        if (first == null) first = r.Elevations.Cast<View>().Concat(r.Sections).Concat(r.Plans).FirstOrDefault();
                        if (annotate)
                        {
                            if (it.Wall != null || it.Slab != null)
                            {
                                IList<Element> hosts = it.Wall != null ? it.Wall.Members.Cast<Element>().ToList() : it.Slab.Floors.Cast<Element>().ToList();
                                foreach (View v in r.Elevations.Cast<View>().Concat(r.Sections).Concat(r.Plans))
                                    if (roles.TryGetValue(v.Id.Value, out string role)) BbPlates.Annotate(doc, v, role, hosts, std.Plate, rep, it.Mark);
                            }
                            else foreach (ViewSection v in r.Elevations.Concat(r.Sections)) AnnotateOne(doc, v, std, rep);
                        }
                        // Тэмдэглэгээний crop: өөрийн тэмдэглэгээ багтах хэмжээгээр (бусад огтлолын тэмдэг viewport-ыг сунгахгүй).
                        using (var t = new Transaction(doc, "MGL ББ: тэмдэглэгээний crop " + it.Mark))
                        {
                            t.Start();
                            FlowCommon.Swallow(t);
                            var all = r.Elevations.Cast<View>().Concat(r.Sections).Concat(r.Plans).ToList();
                            if (it.Wall != null) BbPlates.TidyMarks(doc, all, roles);
                            foreach (View v in all)
                            {
                                BbDatums.Trim(doc, v);
                                BbCrop.FitAnnotationCrop(doc, v, notes);
                            }
                            t.Commit();
                        }
                        if (onSheet && it.Slab != null)
                        {
                            // Хучилт: төлөвлөгөө бүр өөрийн хуудсанд (ЖИШЭЭ-1 7-10/7-11/7-12), нэр = төлөвлөгөөний нэр.
                            using (var t = new Transaction(doc, "MGL ББ: хуудас " + it.Mark))
                            {
                                t.Start();
                                FlowCommon.Swallow(t);
                                foreach (View p in r.Plans)
                                {
                                    List<ViewSheet> sh = BbSheets.Place(doc, p.Name, BbMemberKind.Slab, new List<View> { p }, new List<View>(), std, issues, notes);
                                    sheetCount += sh.Count;
                                    g.CreatedSheets.AddRange(sh);
                                    if (sh.Count > 0) first = sh[0];
                                }
                                t.Commit();
                            }
                        }
                        else if (onSheet && r.Elevations.Count + r.Sections.Count > 0)
                        {
                            using (var t = new Transaction(doc, "MGL ББ: хуудас " + it.Mark))
                            {
                                t.Start();
                                FlowCommon.Swallow(t);
                                BbMemberKind kind = it.Kind;
                                List<ViewSheet> sh = BbSheets.Place(doc, string.IsNullOrEmpty(it.Mark) ? "?" : it.Mark, kind, r.Elevations.Cast<View>().ToList(), r.Sections.Cast<View>().ToList(), std, issues, notes);
                                if (sh.Count > 0 && schedules && !string.IsNullOrEmpty(it.Mark))
                                {
                                    ViewSheet extra = PlaceSchedules(doc, it.Mark, kind, sh[sh.Count - 1], std, roleCache, issues, notes, ref g.Schedules);
                                    if (extra != null) sh.Add(extra);
                                }
                                t.Commit();
                                sheetCount += sh.Count;
                                g.CreatedSheets.AddRange(sh);
                                if (sh.Count > 0) first = sh[0];
                            }
                        }
                    }
                    tg.Assimilate();
                }
                catch
                {
                    if (tg.HasStarted() && !tg.HasEnded()) tg.RollBack();
                    throw;
                }
            }
            issues.AddRange(rep.Issues);
            notes.AddRange(rep.Notes);
            g.Elevs = elevs; g.Secs = secs; g.Skipped = skipped; g.Sheets = sheetCount; g.First = first;
            return g;
        }

        /// <summary>
        /// Гишүүний түүврийг (цувралын жишээнээс хувилж) хуудасны баруун талд; багтахгүй бол тусдаа «… ТҮҮВЭР» хуудас (буцаана).  Нээлттэй Transaction дотор.
        /// </summary>
        private static ViewSheet PlaceSchedules(Document doc, string mark, BbMemberKind kind, ViewSheet sheet, BbStandard std,
            Dictionary<BbMemberKind, List<BbSchedules.Role>> cache, List<BbIssue> issues, List<string> notes, ref int count)
        {
            if (!cache.TryGetValue(kind, out List<BbSchedules.Role> roles))
            {
                BuiltInCategory cat = kind == BbMemberKind.Column ? BuiltInCategory.OST_StructuralColumns : kind == BbMemberKind.Wall ? BuiltInCategory.OST_Walls : BuiltInCategory.OST_StructuralFraming;
                var marks = new FilteredElementCollector(doc).OfCategory(cat).WhereElementIsNotElementType().Select(BbGeom.Mark).Where(m => m.Length > 0).Distinct().ToList();
                roles = BbSchedules.Roles(doc, BbSheets.Prefix(std.Sheet, kind), marks);
                cache[kind] = roles;
                if (roles.Count == 0)
                    issues.Add(new BbIssue
                    {
                        Tool = "Хуудсанд байрлуулах", Severity = BbSeverity.Info, Member = BbStandard.KindName(kind),
                        Problem = BbStandard.KindName(kind) + "-ны хуудсанд байрласан гишүүний түүвэр (тэмдэгтэй, шүүлтүүрт нь тэмдэгтэй) энэ төсөлд олдсонгүй — түүвэр хувилсангүй.",
                        Proposal = "Нэг гишүүний түүврийг (арматур, бетон) гараар хийж хуудсанд байрлуулбал дараагийнхыг автоматаар хувилна.",
                        Key = "sched|roles|" + kind,
                    });
            }
            if (roles.Count == 0) return null;
            List<ViewSchedule> list = BbSchedules.ForMember(doc, mark, roles, issues, notes);
            if (list.Count == 0) return null;
            if (BbSchedules.PlaceOn(doc, sheet, list, out int n)) { count += n; return null; }
            ViewSheet extra = BbSheets.ScheduleSheet(doc, mark, kind, std, issues);
            if (extra == null) return null;
            if (!BbSchedules.PlaceOn(doc, extra, list, out n))
            {
                // Хуудаснаас өндөр түүвэр (27 давхрын баганын «НЭГДСЭН» г.м.) — хоосон хуудас үлдээхгүй.
                try { doc.Delete(extra.Id); } catch { }
                issues.Add(new BbIssue
                {
                    Tool = "Хуудсанд байрлуулах", Severity = BbSeverity.Warning, Member = mark,
                    Problem = "Түүвэр (" + string.Join(", ", list.Select(x => "«" + x.Name + "»")) + ") хуудасны өндрөөс урт — байрлуулсангүй.",
                    Proposal = "Түүврийг Revit-ийн «Split Schedule»-ээр хувааж гараар байрлуулах.",
                    Key = "sched-tall|" + mark,
                });
                return null;
            }
            count += n;
            notes.Add(mark + ": түүвэр зурагтай хуудсанд багтсангүй — «" + extra.SheetNumber + " " + extra.Name + "» хуудсанд.");
            return extra;
        }

        /// <summary>Нэг харагдацыг ангилж, стандартаар тэмдэглэнэ (Transaction-гүй үед).</summary>
        public static void AnnotateOne(Document doc, View view, BbStandard std, BbAnnoReport rep)
        {
            // Хана / хучилтын харагдацыг ЭХЛЭЭД (нэрэнд ханын тэмдэг / түвшний төлөвлөгөө) — эс бөгөөс ханын дэлгээсийг түүнийг дайрсан
            // дамнуруугаар (ДН-14) ангилж ханын MRA-г устгадаг байв (ЦХ-1, UI gate-ээр илэрсэн).
            string role = BbPlates.Classify(doc, view, std.Plate, out List<Element> hosts, out string pmark);
            if (role != null) { BbPlates.Annotate(doc, view, role, hosts, std.Plate, rep, pmark); return; }
            ViewSection v = view as ViewSection;
            BbViewSample smp = v == null ? null : BbLearner.Classify(doc, v);
            if (smp == null)
            {
                rep.Issues.Add(new BbIssue { Tool = "Тэмдэглэх", Severity = BbSeverity.Warning, View = view.Name, ViewId = view.Id.Value, Problem = "Харагдацын гишүүнийг таньсангүй (дамнуруу/багана/хана/хучилт).", Proposal = "Crop-ыг шалгах, нэрэнд тэмдэг байгаа эсэх, эсвэл гараар тэмдэглэх.", Key = "anno|" + view.Name + "|classify" });
                return;
            }
            BbMemberStandard ms = std.For(smp.Kind);
            if (smp.IsSection) BbAnnotate.Section(doc, v, smp.Host, ms, rep, smp.Mark);
            else BbAnnotate.Elevation(doc, v, BbAnnotate.ElevationHosts(doc, v, smp), ms, rep, smp.Mark);
        }

        private static string Label(string mark, Element e) { return string.IsNullOrEmpty(mark) ? "(тэмдэггүй #" + e.Id.Value + ")" : mark; }

        private static List<Element> Pick(UIDocument uidoc)
        {
            Document doc = uidoc.Document;
            var filter = new MemberFilter();
            var res = uidoc.Selection.GetElementIds().Select(id => doc.GetElement(id)).Where(filter.AllowElement).ToList();
            if (res.Count > 0) return res;
            try
            {
                IList<Reference> refs = uidoc.Selection.PickObjects(ObjectType.Element, filter, "Ажлын зураг гаргах дамнуруу / багана / хана / хучилтаа сонгоно уу (Finish — дуусгах)");
                return refs.Select(r => doc.GetElement(r)).Where(x => x != null).ToList();
            }
            catch (Autodesk.Revit.Exceptions.OperationCanceledException) { return null; }
        }
    }
}

namespace MglBb.Annotate
{
    using MglBb.Flows;

    /// <summary>«Стандартаар тэмдэглэх»: сонгосон (Project Browser) эсвэл идэвхтэй дэлгээс/огтлолд компанийн стандартаар хэмжээс, шошго, MRA.</summary>
    internal static class AnnotateFlow
    {
        public static Result Run(UIDocument uidoc)
        {
            Document doc = uidoc.Document;
            var views = uidoc.Selection.GetElementIds().Select(id => doc.GetElement(id)).OfType<View>().Where(v => !v.IsTemplate && (v is ViewSection || v is ViewPlan)).ToList();
            if (views.Count == 0 && (uidoc.ActiveView is ViewSection || uidoc.ActiveView is ViewPlan) && !uidoc.ActiveView.IsTemplate) views.Add(uidoc.ActiveView);
            if (views.Count == 0)
            {
                TaskDialog.Show("MGL ББ — Стандартаар тэмдэглэх", "Дэлгээс, огтлол эсвэл хучилтын төлөвлөгөө нээх, эсвэл Project Browser-оос сонгоно уу.");
                return Result.Cancelled;
            }
            BbStandard std = BbStore.LoadStandard(out string src);
            var dlg = new BbDialog("MGL ББ — Стандартаар тэмдэглэх", "Дараах харагдацад компанийн стандартаар хэмжээс, арматурын шошго, хомутын MRA тавина.");
            dlg.List(views.Select(v => v.Name), Math.Min(160, 26 + 18 * views.Count));
            dlg.Note("Энэ хэрэгслийн өмнө тавьсан тэмдэглэгээ солигдоно (давхардахгүй).  Гараар тавьсан хэмжээс, шошго хөндөгдөхгүй.");
            dlg.Note("Стандарт: " + src);
            if (!dlg.Show(uidoc.Application.MainWindowHandle)) return Result.Cancelled;

            var rep = new BbAnnoReport();
            var sw = Stopwatch.StartNew();
            using (var tg = new TransactionGroup(doc, "MGL ББ: стандартаар тэмдэглэх"))
            {
                tg.Start();
                try
                {
                    foreach (View v in views) Generate.GenerateFlow.AnnotateOne(doc, v, std, rep);
                    tg.Assimilate();
                }
                catch
                {
                    if (tg.HasStarted() && !tg.HasEnded()) tg.RollBack();
                    throw;
                }
            }
            var lines = new List<string>
            {
                "Харагдац " + rep.Views + " / " + views.Count,
                "Огтлол: хэмжээс " + rep.SecDims + " (+арматурын гинж " + rep.BarChains + "), гишүүний гинж " + rep.SecMemberDims + ", шошго " + rep.SecTags,
                "Дэлгээс: шошго " + rep.ElevTags + " (дунд өндөрт " + rep.ElevSideTags + "), MRA " + rep.ElevMras + ", давхцал " + rep.ElevLaps + ", тэнхлэгийн гинж " + rep.ElevSpans,
                "Хугацаа " + (sw.ElapsedMilliseconds / 1000.0).ToString("0", CultureInfo.InvariantCulture) + " сек",
                "",
            };
            lines.AddRange(rep.Notes.Take(8));
            FlowCommon.Summary(uidoc, "Стандартаар тэмдэглэх", "Тэмдэглэгээ дууслаа.", lines, rep.Issues);
            return Result.Succeeded;
        }
    }
}
