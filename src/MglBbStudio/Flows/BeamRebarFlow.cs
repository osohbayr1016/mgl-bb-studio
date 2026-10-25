using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Interop;
using System.Windows.Media;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Selection;
using MglBb.Core;
using MglBb.RevitSide;
using WCombo = System.Windows.Controls.ComboBox;
using WBinding = System.Windows.Data.Binding;

namespace MglBb.BeamRebar
{
    /// <summary>
    /// «Арматур үүсгэх» (дамнуруу): сонгосон эсвэл бүх загварын төмөр бетон дамнурууны гинжүүд → марк бүрийн мөртэй цонх (компанийн / нормын
    /// анхдагч, LIRA-ийн As-аас санал, инженерийн засвар) → гинж бүр тусдаа transaction-оор <see cref="BbBeamRebarGen"/>.  Тохиргоо төсөл бүрд
    /// %APPDATA%\MGL\BbStudio\rebar\&lt;төсөл&gt;.json-д хадгалагдана.
    /// </summary>
    internal static class BeamRebarFlow
    {
        internal const string Title = "MGL ББ — Арматур үүсгэх";

        static string BookPath(Document doc)
        {
            return Path.Combine(Paths.Root, "rebar", BbRebarBook.SafeName(doc.Title) + ".json");
        }

        public static Result Run(UIDocument uidoc)
        {
            if (RebarJobHost.Busy) { TaskDialog.Show(Title, "Арматур үүсгэх ажил явж байна — явцын цонхонд дуусах эсвэл «Зогсоох» хүртэл хүлээнэ үү."); return Result.Cancelled; }
            Document doc = uidoc.Document;
            List<FamilyInstance> beams = Selected(uidoc);
            if (beams.Count == 0)
            {
                var td = new TaskDialog(Title)
                {
                    MainInstruction = "Аль дамнуруунд арматур үүсгэх вэ?",
                    MainContent = "Олон алгаслын дамнуруу = ижил тэмдэгтэй, нэг шугам дээрх бүх элемент (гинж).  Туслах дамнуруу (Т…) гол дамнуруунд тулна.",
                };
                td.AddCommandLink(TaskDialogCommandLinkId.CommandLink1, "Загварын бүх төмөр бетон дамнуруу");
                td.AddCommandLink(TaskDialogCommandLinkId.CommandLink2, "Дамнуруу сонгох");
                td.CommonButtons = TaskDialogCommonButtons.Cancel;
                TaskDialogResult res = td.Show();
                if (res == TaskDialogResult.CommandLink1) beams = BbBeamRebarGen.AllBeams(doc).ToList();
                else if (res == TaskDialogResult.CommandLink2)
                {
                    try
                    {
                        beams = uidoc.Selection.PickObjects(ObjectType.Element, new FramingFilter(), "Дамнуруу сонгоод Finish дарна уу")
                            .Select(r => doc.GetElement(r)).OfType<FamilyInstance>().ToList();
                    }
                    catch (Autodesk.Revit.Exceptions.OperationCanceledException) { return Result.Cancelled; }
                }
                else return Result.Cancelled;
            }
            List<BbBeamGenItem> items = BbBeamRebarGen.Collect(doc, beams);
            if (items.Count == 0) { TaskDialog.Show(Title, "Төмөр бетон (Concrete материалтай) дамнуруу олдсонгүй."); return Result.Cancelled; }

            string path = BookPath(doc);
            BbRebarBook book;
            try { book = BbRebarBook.Load(path); }
            catch { try { File.Copy(path, path + ".broken", true); } catch { } book = new BbRebarBook(); }

            // Загварын гар арматураас төслийн хэв маяг (сонгосон гинжүүдээс; хадгалсныхаас цөөн гинжээс сурсан бол хуучныг үлдээнэ).
            BbRebarStyle learned = BbRebarLearn.FromModel(doc, items);
            if (!learned.Empty && (book.Style == null || learned.Chains >= book.Style.Chains)) book.Style = learned;
            var win = new BeamRebarWindow(book, items);
            try { new WindowInteropHelper(win).Owner = uidoc.Application.MainWindowHandle; } catch { }
            if (win.ShowDialog() != true) return Result.Cancelled;
            try { book.Save(path); } catch { /* тохиргоо хадгалагдаагүй ч үүсгэнэ */ }

            return Generate(uidoc, book, items);
        }

        static List<FamilyInstance> Selected(UIDocument uidoc)
        {
            return uidoc.Selection.GetElementIds().Select(id => uidoc.Document.GetElement(id)).OfType<FamilyInstance>()
                .Where(f => f.Category != null && f.Category.Id.Value == (long)BuiltInCategory.OST_StructuralFraming).ToList();
        }

        /// <summary>Гинж бүр = нэг алхам (<see cref="RebarJobHost"/>): өөрийн transaction, өөрийн Ctrl+Z; Revit алхам хооронд чөлөөлөгдөнө.</summary>
        static Result Generate(UIDocument uidoc, BbRebarBook book, List<BbBeamGenItem> items)
        {
            Document doc = uidoc.Document;
            int made = 0, chains = 0, failed = 0;
            var notes = new List<string>();
            var errors = new List<string>();
            var steps = new List<RebarJobHost.Step>();
            foreach (BbBeamGenItem item in items)
            {
                BbBeamGenItem it = item;
                BbRebarRow row = book.Row(it.Key);
                if (!row.Enabled) continue;
                if (it.Skip != null) { notes.Add(it.Key + ": алгаслаа — " + it.Skip + "."); continue; }
                if (it.Foreign > 0 && !book.ReplaceForeign) { notes.Add(it.Key + ": гараар тавьсан арматуртай — алгаслаа (солих бол цонхонд тэмдэглэнэ)."); continue; }
                steps.Add(new RebarJobHost.Step
                {
                    Text = it.Key,
                    Run = () =>
                    {
                        if (it.Members.Any(m => !m.IsValidObject)) { failed++; return "✗ " + it.Key + " — дамнуруу устсан/өөрчлөгдсөн, алгаслаа"; }
                        using (var t = new Transaction(doc, "Арматур " + it.Key))
                        {
                            FailureHandlingOptions fh = t.GetFailureHandlingOptions();
                            fh.SetFailuresPreprocessor(new BbSwallowWarnings());
                            t.SetFailureHandlingOptions(fh);
                            t.Start();
                            BbBeamRebarGen.Outcome o;
                            try { o = BbBeamRebarGen.Generate(doc, it, book, errors); }
                            catch (Exception ex) { t.RollBack(); notes.Add(it.Key + ": алдаа — " + ex.Message); failed++; return "✗ " + it.Key + " — алдаа (буцаагдсан)"; }
                            if (t.Commit() != TransactionStatus.Committed) { notes.Add(it.Key + ": Revit буцаалаа."); failed++; return "✗ " + it.Key + " — Revit буцаалаа"; }
                            made += o.Created;
                            chains++;
                            failed += o.Failed;
                            List<string> mine = o.Notes.Distinct().ToList();
                            foreach (string n in mine) notes.Add(it.Key + ": " + n);
                            return (o.Failed > 0 ? "✗ " : "✓ ") + it.Key + " — " + o.Created + " элемент" + (o.Failed > 0 ? ", " + o.Failed + " бүтсэнгүй" : "")
                                + (mine.Count > 0 ? ", анхааруулга " + mine.Count : "");
                        }
                    },
                });
            }
            if (steps.Count == 0)
            {
                TaskDialog.Show(Title, "Үүсгэх дамнуруу алга." + (items.Any(x => x.Skip == null && x.Foreign > 0) && !book.ReplaceForeign
                    ? "  Гараар тавьсан арматуртайг солих бол цонхны «Гараар тавьсан арматурыг устгаж солих»-ыг тэмдэглэнэ үү." : "") + (notes.Count > 0 ? Environment.NewLine + string.Join(Environment.NewLine, notes.Take(20)) : ""));
                return Result.Cancelled;
            }
            RebarJobHost.Start(uidoc, Title, steps,
                (done, total) => chains + " дамнуруунд " + made + " арматурын элемент үүсгэлээ" + (failed > 0 ? " (" + failed + " бүтсэнгүй)" : "")
                    + ".  Гинж бүр өөрийн Ctrl+Z-тэй.",
                () => errors.Concat(notes).Distinct().Take(300).ToList());
            return Result.Succeeded;
        }

        private sealed class FramingFilter : ISelectionFilter
        {
            public bool AllowElement(Element e) { return e?.Category != null && e.Category.Id.Value == (long)BuiltInCategory.OST_StructuralFraming; }
            public bool AllowReference(Reference r, XYZ p) { return false; }
        }
    }

}
