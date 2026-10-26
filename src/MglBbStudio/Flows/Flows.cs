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

        /// <summary>Цонхонд «Тохиргоо (option)» сонголт — өгөгдмөл нь энэ төсөлд идэвхтэй option.</summary>
        public static System.Windows.Controls.ComboBox OptionCombo(BbDialog dlg, Document doc, out BbOptionBook book)
        {
            book = BbStore.LoadOptions();
            var names = new List<string> { BbOptionBook.BaseName };
            names.AddRange(book.Options.Select(o => o.Name).OrderBy(n => n, StringComparer.CurrentCulture));
            return dlg.Combo("Тохиргоо (option)", names, names.IndexOf(book.ActiveFor(BbStore.ProjectKey(doc))));
        }

        /// <summary>Сурсан стандарт + сонгосон option.  Сонголт өөрчлөгдсөн бол түүнийг энэ төсөлд идэвхтэй болгож хадгална.</summary>
        public static BbStandard StandardFor(Document doc, BbOptionBook book, System.Windows.Controls.ComboBox box, out string src)
        {
            BbStandard std = BbStore.LoadStandard(out src);
            string key = BbStore.ProjectKey(doc);
            string name = box?.SelectedItem as string ?? book.ActiveFor(key);
            if (book.ActiveFor(key) != (book.Find(name)?.Name ?? BbOptionBook.BaseName))
            {
                book.SetActive(key, name);
                try { BbStore.SaveOptions(book); } catch { }
            }
            std = book.Apply(std, key, out string used);
            src += " · option «" + used + "»";
            return std;
        }
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
            // Зөвхөн хэрэглэгчийн ЗААСАН харагдацаас сурна (ББ инженерийн шаардлага 2026-10-21) — Project Browser / хуудсан дээр сонгосныг урьдчилан чагтална.
            var sheetOf = new Dictionary<long, string>();
            foreach (Viewport vp in new FilteredElementCollector(doc).OfClass(typeof(Viewport)).Cast<Viewport>())
                if (doc.GetElement(vp.SheetId) is ViewSheet sh) sheetOf[vp.ViewId.Value] = sh.SheetNumber ?? "";
            List<View> views = new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>()
                .Where(v => !v.IsTemplate && (v.ViewType == ViewType.Detail || v.ViewType == ViewType.Section
                    || ((v.ViewType == ViewType.EngineeringPlan || v.ViewType == ViewType.FloorPlan) && sheetOf.ContainsKey(v.Id.Value))))
                .OrderBy(v => v.Name, StringComparer.CurrentCulture).ToList();
            HashSet<long> pre = PreSelectedViews(uidoc);
            views = views.Where(v => pre.Contains(v.Id.Value)).Concat(views.Where(v => !pre.Contains(v.Id.Value))).ToList();
            if (views.Count == 0)
            {
                TaskDialog.Show("MGL ББ — Стандарт сурах", "Энэ төсөлд сурах харагдац (Detail / Section) алга.");
                return Result.Cancelled;
            }

            var dlg = new BbDialog("MGL ББ — Стандарт сурах", "Зөвхөн доор СОНГОСОН харагдацаас компанийн стандартыг сурна (харагдацын төрөл, загвар, масштаб, crop, " +
                "огтлолын байрлал, хэмжээс/шошго/MRA-ийн зай, хуудасны байрлал).  Загварт ЮУ Ч өөрчлөгдөхгүй.", 640);
            dlg.Section("Харагдац (" + views.Count + ")");
            var lb = dlg.Picker(views.Select(v => v.Name + (sheetOf.TryGetValue(v.Id.Value, out string sn) ? "   · хуудас " + sn : "   · хуудасгүй")
                + (BbAnnoStore.IsGenerated(v) ? "   · MGL ББ үүсгэсэн" : "")), 360, search: true);
            for (int i = 0; i < views.Count && pre.Contains(views[i].Id.Value); i++) lb.SelectedItems.Add(lb.Items[i]);
            dlg.Note("«Хайх»-д нэрийн хэсгийг бичнэ (жишээ «ДН-1 S», «5-11») — хайлтыг сольсон ч өмнө сонгосон нь сонгогдсон хэвээр.  Ctrl / Shift дарж олныг сонгоно.  Project Browser эсвэл хуудсан дээр урьдчилан сонгосон харагдац энд сонгогдсон байна.  " +
                     "Сонгосон харагдац бүр жишээ болно — нэг ч хангалттай.");
            dlg.Note("Одоогийн стандарт: " + src);
            if (!dlg.Show(uidoc.Application.MainWindowHandle)) return Result.Cancelled;
            var only = new HashSet<long>();
            foreach (object o in lb.SelectedItems) only.Add(views[lb.Items.IndexOf(o)].Id.Value);
            if (only.Count == 0)
            {
                TaskDialog.Show("MGL ББ — Стандарт сурах", "Харагдац сонгоогүй — стандарт өөрчлөгдсөнгүй.");
                return Result.Cancelled;
            }

            BbStandard learned = BbLearner.Learn(doc, current, 100000, out BbLearnReport rep, only);
            if (rep.ElevDump.Length > 0)
            {
                // Дамнурууны дэлгээсийн хэмжээс/шошгоны бүрэн хэмжилт — хөгжүүлэгч зургийн дүрмийг тодорхойлоход.
                string dump = Path.Combine(Paths.Root, "learn-elev-report.txt");
                try
                {
                    Directory.CreateDirectory(Paths.Root);
                    File.WriteAllText(dump, doc.Title + "  " + DateTime.Now.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture) + Environment.NewLine + rep.ElevDump,
                        new System.Text.UTF8Encoding(true));
                    rep.Notes.Add("Дэлгээсийн хэмжилтийн тайлан: " + dump);
                }
                catch (Exception ex) { rep.Notes.Add("Дэлгээсийн тайлан бичигдсэнгүй: " + ex.Message); }
            }
            var lines = new List<string>
            {
                "Шинжилсэн харагдац " + rep.ViewsScanned + ", танигдсан " + rep.Classified + " (" + string.Join(", ", rep.PerKind.Select(kv => kv.Key + " " + kv.Value)) + ")",
                "Сурсан тохиргоо " + rep.FieldsLearned + " · " + (rep.ElapsedMs / 1000.0).ToString("0", CultureInfo.InvariantCulture) + " сек",
                "",
                "Дамнуруу: «" + learned.Beam.ElevViewType + "» 1:" + learned.Beam.ElevScale + ", огтлол 1:" + learned.Beam.SecScale + ", нэр «" + learned.Beam.ElevNamePattern + "»",
                "Дамнурууны огтлолын шошго: " + RoleSummary(learned.Beam),
                "Туслах дамнуруу: «" + learned.BeamAux.ElevViewType + "»",
                "Багана: «" + learned.Column.ElevViewType + "» 1:" + learned.Column.ElevScale + ", огтлол 1:" + learned.Column.SecScale,
                "Хана: «" + learned.Plate.WallRebarViewType + "», MRA «" + learned.Plate.WallMraType + "»",
                "Хучилт: «" + learned.Plate.SlabBottomViewType + "» 1:" + learned.Plate.SlabScale + ", MRA «" + learned.Plate.SlabMraType + "»",
                "Рамын байгуулалт: «" + learned.Plate.FrameViewType + "» 1:" + learned.Plate.FrameScale + ", нэр «" + learned.Plate.FrameName + "», марк «" + learned.Plate.FrameColumnTagType + "» / «" + learned.Plate.FrameBeamTagType + "»",
                "Хуудас: «" + learned.Sheet.TitleBlock + "», цуврал " + learned.Sheet.ColumnSheetPrefix + " / " + learned.Sheet.BeamSheetPrefix + " / " + learned.Sheet.WallSheetPrefix + " / " + learned.Sheet.SlabSheetPrefix,
            };
            lines.AddRange(rep.Notes.Take(5));
            if (rep.Classified == 0)
            {
                FlowCommon.Summary(uidoc, "Стандарт сурах", "Сонгосон харагдацаас дамнуруу / багана / хана / хучилтын зураг танигдсангүй — стандарт өөрчлөгдсөнгүй.", lines, rep.Issues);
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

        /// <summary>«дээд зүүн 12/+5 · доод зүүн 10/+8 · …» (тал, гаднах зай / босоо зай, цаасан мм); сураагүй үүрэг = «—».</summary>
        internal static string RoleSummary(BbMemberStandard ms)
        {
            var parts = new List<string>();
            foreach (BbBarRole r in new[] { BbBarRole.Top, BbBarRole.Bottom, BbBarRole.Side, BbBarRole.Stirrup })
            {
                ms.RoleTag(r, out string side, out double dx, out double dy);
                string name = r == BbBarRole.Top ? "дээд" : r == BbBarRole.Bottom ? "доод" : r == BbBarRole.Side ? "бөөр" : "хомут";
                parts.Add(name + " " + (string.IsNullOrEmpty(side) ? "—"
                    : (side == BbTagRoles.Right ? "баруун " : "зүүн ") + dx.ToString("0.#", CultureInfo.InvariantCulture) + "/" + (dy >= 0 ? "+" : "") + dy.ToString("0.#", CultureInfo.InvariantCulture)));
            }
            return string.Join(" · ", parts) + " мм";
        }

        /// <summary>Одоо сонгогдсон харагдац: Project Browser-ийн харагдац, хуудсан дээрх viewport, сонгосон хуудасны бүх харагдац.</summary>
        private static HashSet<long> PreSelectedViews(UIDocument uidoc)
        {
            var res = new HashSet<long>();
            Document doc = uidoc.Document;
            foreach (ElementId id in uidoc.Selection.GetElementIds())
            {
                Element e = doc.GetElement(id);
                if (e is ViewSheet sh) foreach (ElementId vp in sh.GetAllViewports()) { if (doc.GetElement(vp) is Viewport p) res.Add(p.ViewId.Value); }
                else if (e is View v) res.Add(v.Id.Value);
                else if (e is Viewport vpt) res.Add(vpt.ViewId.Value);
            }
            return res;
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
            public BbFrameLevel Frame;

            public BbMemberKind Kind
            {
                get
                {
                    if (Column != null) return BbMemberKind.Column;
                    if (Wall != null) return BbMemberKind.Wall;
                    if (Slab != null) return BbMemberKind.Slab;
                    if (Frame != null) return BbMemberKind.Frame;
                    return Beam != null && Beam.Aux ? BbMemberKind.BeamAux : BbMemberKind.Beam;
                }
            }
        }

        public static Result Run(UIDocument uidoc)
        {
            Document doc = uidoc.Document;
            // Юу ч сонголгүй «Finish» дарвал зөвхөн рамын байгуулалт (түвшнээр).
            List<Element> picked = Pick(uidoc);
            if (picked == null) return Result.Cancelled;
            BbStandard std = BbStore.LoadStandard(out string src);

            List<Item> items = BuildItems(doc, picked);
            List<BbFrameLevel> frameLevels = BbFramePlan.Levels(doc);

            var dlg = new BbDialog("MGL ББ — Ажлын зураг гаргах", "Сонгосон гишүүдийн загварчилсан арматураас компанийн стандартаар дэлгээс ба огтлол үүсгэнэ.");
            if (items.Count > 0)
            {
                dlg.Section("Гишүүд (" + items.Count + ")");
                dlg.List(items.Select(i => i.Text), Math.Min(160, 26 + 18 * items.Count));
            }
            System.Windows.Controls.ListBox frameBox = null;
            if (frameLevels.Count > 0)
            {
                dlg.Section("Рамын байгуулалт — түвшин (" + frameLevels.Count + ")");
                frameBox = dlg.Picker(frameLevels.Select(FrameText), Math.Min(200, 30 + 20 * frameLevels.Count));
                dlg.Note("«" + std.Plate.FrameName.Replace("{level}", "…") + "» төлөвлөгөө (" + std.Sheet.FrameSheetPrefix + " цуврал).  Ctrl / Shift дарж олныг сонгоно; сонгоогүй бол үүсгэхгүй.");
            }
            if (items.Count == 0 && frameBox == null)
            {
                TaskDialog.Show("MGL ББ — Ажлын зураг гаргах", "Дамнуруу / багана / хана / хучилт сонгоогүй, рамын байгуулалт хийх түвшин ч алга.");
                return Result.Cancelled;
            }
            dlg.Section("Юу үүсгэх");
            var cElev = dlg.Check("Дэлгээс (арматурчлал)", true);
            var cSec = dlg.Check("Огтлол", true);
            var mode = dlg.Combo("Огтлолын байрлал", new[] { "Стандарт — тулгуур + дунд, давхардалгүй", "Алгасал бүрд (тулгуур + дунд)", "Зөвхөн дунд хэсэгт", "Зөвхөн тулгуурт" }, 0);
            var cAnn = dlg.Check("Стандартаар тэмдэглэх (хэмжээс, шошго, MRA)", true);
            var cBreaks = dlg.Check("Break line (огтлолын хучилт, дэлгээсийн дамнуруу / багана)", std.Beam.SecBreakLines || std.Beam.ElevBreakLines,
                "Crop-ын ирмэгийг дайрсан хучилт, дамнуруу, баганад «" + std.Beam.BreakFamily + "».");
            var cEndSym = dlg.Check("Арматурын төгсгөлийн тэмдэг (дэлгээс)", std.Beam.ElevEndSymbols,
                string.IsNullOrEmpty(std.Beam.ElevEndSymbolType) ? "Тэмдэг сураагүй — «Стандарт сурах»-аар тэмдэгтэй дэлгээсээс сурна." : "«" + std.Beam.ElevEndSymbolType + "» — сурсан дүрмээр.");
            var cSheet = dlg.Check("Хуудсанд байрлуулах (A2, дэлгээс дээр, огтлол доор)", true, "Дугаар — компанийн цувралын дараагийн чөлөөт дугаар (дамнуруу 5-, багана 4-).");
            List<string> tbs = new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_TitleBlocks).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>()
                .Select(s => s.FamilyName + " : " + s.Name).Distinct().OrderBy(s => s, StringComparer.CurrentCulture).ToList();
            System.Windows.Controls.ComboBox tbBox =tbs.Count > 0 ? dlg.Combo("Хуудасны хүрээ (title block)", tbs, Math.Max(0, tbs.IndexOf(std.Sheet.TitleBlock))) : null;
            var cSched = dlg.Check("Түүврийг хувилж хуудсанд байрлуулах (арматур, бетон)", true, "Энэ төслийн өөр гишүүний түүврийг хуулж, нэр болон шүүлтүүрийн тэмдгийг солино.");
            var exist = dlg.Combo("Ижил нэртэй харагдац байвал", new[] { "Алгасах", "Шинээр (нэрийн ард дугаар)" }, 0);
            var optBox = FlowCommon.OptionCombo(dlg, doc, out BbOptionBook book);
            dlg.Note("Стандарт: " + src);
            dlg.Note("Ажиллаж байх хооронд явцын цонх нээгдэнэ — гишүүн бүрийн хооронд Revit чөлөөлөгдөх тул загвар дээр үргэлжлүүлэн ажиллаж болно.");
            if (!dlg.Show(uidoc.Application.MainWindowHandle)) return Result.Cancelled;
            if (GenJobHost.Busy)
            {
                TaskDialog.Show("MGL ББ — Ажлын зураг гаргах", "Өмнөх ажлын зураг үүсгэлт дуусаагүй байна — явцын цонхноос дуусахыг хүлээх эсвэл «Зогсоох» дарна уу.");
                return Result.Cancelled;
            }
            string tbPicked = tbBox != null && tbBox.SelectedIndex >= 0 ? tbs[tbBox.SelectedIndex] : null;
            std = FlowCommon.StandardFor(doc, book, optBox, out src);

            var opt = new BbGenOptions
            {
                Elevation = cElev.IsChecked == true,
                Sections = cSec.IsChecked == true,
                SectionMode = new[] { "auto", "all", "mid", "supports" }[Math.Max(0, mode.SelectedIndex)],
                Existing = exist.SelectedIndex == 1 ? "new" : "skip",
            };
            bool annotate = cAnn.IsChecked == true;
            bool onSheet = cSheet.IsChecked == true;
            if (tbPicked != null) std.Sheet.TitleBlock = tbPicked;
            // Хэрэглэгчийн сонголт: энэ ажилд break line / төгсгөлийн тэмдэг (стандартад хадгалахгүй — зөвхөн энэ удаа).
            foreach (BbMemberStandard ms in new[] { std.Beam, std.BeamAux, std.Column })
            {
                if (cBreaks.IsChecked != true) { ms.SecBreakLines = false; ms.ElevBreakLines = false; }
                if (cEndSym.IsChecked != true) ms.ElevEndSymbols = false;
            }
            if (frameBox != null)
                foreach (object sel in frameBox.SelectedItems)
                {
                    BbFrameLevel fl = frameLevels[frameBox.Items.IndexOf(sel)];
                    items.Add(new Item { Mark = fl.LevelText, Frame = fl, Text = FrameText(fl) });
                }
            if (items.Count == 0) return Result.Cancelled;
            if (!opt.Elevation && !opt.Sections && items.All(i => i.Frame == null)) return Result.Cancelled;

            GenJobHost.Start(uidoc, new GenJob(doc, items, std, opt, annotate, onSheet, cSched.IsChecked == true), src);
            return Result.Succeeded;
        }

        internal static string FrameText(BbFrameLevel fl)
        {
            return fl.LevelText + " түвшний рамын байгуулалт — багана " + fl.Columns.Count + ", дамнуруу " + fl.Beams.Count + "   (" + fl.Level?.Name + ")";
        }

        /// <summary>Дууссан ажлын дүгнэлтийн мөрүүд (явцын цонх / TaskDialog).</summary>
        internal static List<string> SummaryLines(GenRun g, bool annotate, bool onSheet)
        {
            BbAnnoReport rep = g.Rep;
            var lines = new List<string>
            {
                "Дэлгээс " + g.Elevs + ", огтлол " + g.Secs + (g.Skipped > 0 ? " (ижил арматуртай " + g.Skipped + " огтлол алгассан)" : "") + (onSheet ? ", хуудас " + g.Sheets + (g.Schedules > 0 ? ", түүвэр " + g.Schedules : "") : ""),
            };
            if (annotate)
                lines.Add("Тэмдэглэгээ: огтлолын хэмжээс " + rep.SecDims + " (+арматурын гинж " + rep.BarChains + "), шошго " + (rep.SecTags + rep.ElevTags) + ", MRA " + rep.ElevMras + ", давхцал " + rep.ElevLaps + ", break line " + rep.Breaks);
            lines.Add("Хугацаа " + (g.Watch.ElapsedMilliseconds / 1000.0).ToString("0", CultureInfo.InvariantCulture) + " сек");
            lines.Add("");
            lines.AddRange(g.Notes.Take(8));
            return lines;
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
                    BbBeamChain ch = BbGeom.BeamChain(doc, fi, gridOrder: true);
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
            var job = new GenJob(doc, items, std, opt, annotate, onSheet, schedules);
            using (var tg = new TransactionGroup(doc, "MGL ББ: ажлын зураг"))
            {
                tg.Start();
                try
                {
                    foreach (Item it in items) job.RunItem(it);
                    tg.Assimilate();
                }
                catch
                {
                    if (tg.HasStarted() && !tg.HasEnded()) tg.RollBack();
                    throw;
                }
            }
            return job.Finish();
        }

        /// <summary>
        /// Ажлын зургийн гүйцэтгэгч — гишүүн бүрийг (<see cref="RunItem"/>) тусад нь ажиллуулж болно: <see cref="Execute"/> бүгдийг нэг дор, арын
        /// горим (<see cref="GenJobHost"/>) гишүүн бүрийг өөрийн ExternalEvent-д (хооронд нь хэрэглэгч Revit-д ажиллана).  Transaction-гүй үед дуудна.
        /// </summary>
        internal sealed class GenJob
        {
            public readonly Document Doc;
            public readonly IList<Item> Items;
            private readonly BbStandard _std;
            private readonly BbGenOptions _opt;
            private readonly bool _annotate, _onSheet, _schedules;
            private readonly GenRun _g = new GenRun { Watch = Stopwatch.StartNew() };
            private readonly Dictionary<BbMemberKind, List<BbSchedules.Role>> _roleCache = new Dictionary<BbMemberKind, List<BbSchedules.Role>>();
            private readonly Dictionary<long, string> _roles = new Dictionary<long, string>();
            private bool _finished;

            public GenJob(Document doc, IList<Item> items, BbStandard std, BbGenOptions opt, bool annotate, bool onSheet, bool schedules)
            {
                Doc = doc; Items = items; _std = std; _opt = opt; _annotate = annotate; _onSheet = onSheet; _schedules = schedules;
            }

            public GenRun Progress { get { return _g; } }
            public bool OnSheet { get { return _onSheet; } }
            public bool Annotate { get { return _annotate; } }

            /// <summary>Нэг гишүүн: үүсгэх → тэмдэглэх → crop → хуудас (өөр өөр Transaction).  Алдаа гарвал шиднэ — дуудагч буцаана.</summary>
            public void RunItem(Item it)
            {
                Document doc = Doc;
                BbStandard std = _std;
                BbGenOptions opt = _opt;
                bool annotate = _annotate, onSheet = _onSheet, schedules = _schedules;
                GenRun g = _g;
                var roleCache = _roleCache;
                var roles = _roles;
                List<BbIssue> issues = g.Issues;
                List<string> notes = g.Notes;
                BbAnnoReport rep = g.Rep;
                {
                    {
                        BbGenResult r;
                        using (var t = new Transaction(doc, "MGL ББ: харагдац " + it.Mark))
                        {
                            t.Start();
                            FlowCommon.Swallow(t);
                            r = it.Column != null ? BbColumns.Create(doc, it.Column, std, opt)
                                : it.Wall != null ? BbPlates.CreateWall(doc, it.Wall, std, opt, roles)
                                : it.Slab != null ? BbPlates.CreateSlab(doc, it.Slab, std, opt, roles)
                                : it.Frame != null ? BbFramePlan.Create(doc, it.Frame, std, opt, roles)
                                : BbViews.CreateBeam(doc, it.Beam, std, opt);
                            t.Commit();
                        }
                        g.Elevs += r.Elevations.Count + r.Plans.Count;
                        g.Secs += r.Sections.Count;
                        g.Skipped += r.SkippedDuplicates;
                        notes.AddRange(r.Notes);
                        issues.AddRange(r.Issues);
                        if (g.First == null) g.First = r.Elevations.Cast<View>().Concat(r.Sections).Concat(r.Plans).FirstOrDefault();
                        if (annotate)
                        {
                            if (it.Frame != null)
                            {
                                foreach (View v in r.Plans) BbFramePlan.Annotate(doc, v, it.Frame, std.Plate, rep, it.Mark);
                            }
                            else if (it.Wall != null || it.Slab != null)
                            {
                                IList<Element> hosts = it.Wall != null ? it.Wall.Members.Cast<Element>().ToList() : it.Slab.Floors.Cast<Element>().ToList();
                                foreach (View v in r.Elevations.Cast<View>().Concat(r.Sections).Concat(r.Plans))
                                    if (roles.TryGetValue(v.Id.Value, out string role)) BbPlates.Annotate(doc, v, role, hosts, std.Plate, rep, it.Mark);
                            }
                            else foreach (ViewSection v in r.Elevations.Concat(r.Sections)) AnnotateOne(doc, v, std, rep);
                        }
                        // Тэмдэглэгээний crop (Annotation Crop) — шинэ харагдацад УНТРААЛТТАЙ (ББ инженерийн шаардлага 2026-10-21; өмнө нь
                        // BbCrop.FitAnnotationCrop-оор асааж тааруулдаг байв).
                        using (var t = new Transaction(doc, "MGL ББ: тэмдэглэгээний crop " + it.Mark))
                        {
                            t.Start();
                            FlowCommon.Swallow(t);
                            var all = r.Elevations.Cast<View>().Concat(r.Sections).Concat(r.Plans).ToList();
                            if (it.Wall != null) BbPlates.TidyMarks(doc, all, roles);
                            if (it.Slab == null && it.Frame == null)
                            {
                                // Дэлгээсэд хамааралгүй огтлол / хэсэглэлийн тэмдгийг нуух (2026-10-23).
                                var own = new HashSet<string>(all.Select(v => v.Name), StringComparer.Ordinal);
                                foreach (View e in r.Elevations)
                                {
                                    int h = BbMarkTidy.HideForeign(doc, e, it.Mark, own);
                                    if (h > 0) notes.Add("«" + e.Name + "»: хамааралгүй " + h + " огтлол / хэсэглэлийн тэмдгийг нуув.");
                                }
                                BbMarkTidy.HideInOthers(doc, it.Mark, all, std);
                            }
                            foreach (View v in all)
                            {
                                BbDatums.Trim(doc, v);
                                BbCrop.AnnotationCropOff(v);
                            }
                            t.Commit();
                        }
                        if (onSheet && (it.Slab != null || it.Frame != null))
                        {
                            // Хучилт: төлөвлөгөө бүр өөрийн хуудсанд (ЖИШЭЭ-1 7-10/7-11/7-12), нэр = төлөвлөгөөний нэр.
                            using (var t = new Transaction(doc, "MGL ББ: хуудас " + it.Mark))
                            {
                                t.Start();
                                FlowCommon.Swallow(t);
                                foreach (View p in r.Plans)
                                {
                                    List<ViewSheet> sh = BbSheets.Place(doc, p.Name, it.Kind, new List<View> { p }, new List<View>(), std, issues, notes);
                                    g.Sheets += sh.Count;
                                    g.CreatedSheets.AddRange(sh);
                                    if (sh.Count > 0) g.First = sh[0];
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
                                g.Sheets += sh.Count;
                                g.CreatedSheets.AddRange(sh);
                                if (sh.Count > 0) g.First = sh[0];
                            }
                        }
                    }
                }
            }

            /// <summary>Тэмдэглэгээний тайлангийн асуудал/тэмдэглэлийг нэгтгэнэ (нэг удаа).</summary>
            public GenRun Finish()
            {
                if (!_finished)
                {
                    _finished = true;
                    _g.Issues.AddRange(_g.Rep.Issues);
                    _g.Notes.AddRange(_g.Rep.Notes);
                }
                return _g;
            }
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
                // Заавал үүсгэх түүвэр (арматур, бетон, нэгдсэн, хэсгийн тодорхойлолт) цувралын хуудсанд алга бол төслийн бүх түүврээс.
                var have = new HashSet<string>(roles.Select(x => x.Pattern), StringComparer.Ordinal);
                roles.AddRange(BbSchedules.RolesAnywhere(doc, marks).Where(x => BbCompanyRules.IsRequiredSchedule(x.Pattern) && have.Add(x.Pattern)));
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
            if (smp.IsSection)
            {
                bool beam = smp.Kind == BbMemberKind.Beam || smp.Kind == BbMemberKind.BeamAux;
                HashSet<long> before = beam ? BbAnnoStore.Owned(doc, v) : null;
                BbAnnotate.Section(doc, v, smp.Host, ms, rep, smp.Mark);
                if (beam)
                {
                    BbSecTagLayout.Apply(doc, v, smp.Host, ms, before, rep, smp.Mark, smp.Kind == BbMemberKind.BeamAux ? std.Beam : null);
                    BbBreaks.Section(doc, v, ms, rep, smp.Mark);
                }
            }
            else BbAnnotate.Elevation(doc, v, BbAnnotate.ElevationHosts(doc, v, smp), ms, rep, smp.Mark);
        }

        private static string Label(string mark, Element e) { return string.IsNullOrEmpty(mark) ? "(тэмдэггүй #" + e.Id.Value + ")" : mark; }

        internal static List<Element> Pick(UIDocument uidoc, string prompt = "Ажлын зураг гаргах дамнуруу / багана / хана / хучилтаа сонгоно уу (Finish — дуусгах; юу ч сонгохгүй Finish = зөвхөн рамын байгуулалт)")
        {
            Document doc = uidoc.Document;
            var filter = new MemberFilter();
            var res = uidoc.Selection.GetElementIds().Select(id => doc.GetElement(id)).Where(filter.AllowElement).ToList();
            if (res.Count > 0) return res;
            try
            {
                IList<Reference> refs = uidoc.Selection.PickObjects(ObjectType.Element, filter, prompt);
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
            var optBox = FlowCommon.OptionCombo(dlg, doc, out BbOptionBook book);
            dlg.Note("Энэ хэрэгслийн өмнө тавьсан тэмдэглэгээ солигдоно (давхардахгүй).  Гараар тавьсан хэмжээс, шошго хөндөгдөхгүй.");
            dlg.Note("Стандарт: " + src);
            if (!dlg.Show(uidoc.Application.MainWindowHandle)) return Result.Cancelled;
            std = FlowCommon.StandardFor(doc, book, optBox, out src);

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
                "Огтлол: хэмжээс " + rep.SecDims + " (+арматурын гинж " + rep.BarChains + "), гишүүний гинж " + rep.SecMemberDims + ", шошго " + rep.SecTags + " (үүргээр байрлуулсан " + rep.RoleTags + "), break line " + rep.Breaks,
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
