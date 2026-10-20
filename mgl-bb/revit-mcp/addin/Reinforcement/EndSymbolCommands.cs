using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Selection;
using RevitMcpAddin.Reinforcement.Core;
using RevitMcpAddin.Reinforcement.Ui;

namespace RevitMcpAddin.Reinforcement
{
    /// <summary>Сонгоход ЗӨВХӨН арматур (<see cref="Rebar"/>).  Эзэн элемент (дам нуруу, багана…) сонгогдохгүй.</summary>
    internal sealed class RfRebarPickFilter : ISelectionFilter
    {
        public bool AllowElement(Element e)
        {
            return e is Rebar;
        }

        public bool AllowReference(Reference reference, XYZ position) { return false; }
    }

    /// <summary>
    /// «Арматурын төгсгөлийн тэмдэг»: ЭХЛЭЭД тэмдгийн төрлийг (family эсвэл код-оор зурах тэмдэг) сонгоно, ДАРАА нь арматур бүр
    /// дээр ДАРААЛАН дарахад (2026-10-02-оос) дарах бүрт эхлэл/төгсгөлд арматурын чиглэлээр эргүүлж шууд тавина; Esc = дуусгах
    /// (тавьсан нь хэвээр; нэг ч дараагүй бол загварт юу ч өөрчлөгдөхгүй).  Олонлог (bar set) арматурыг дарсан цэгт хамгийн ойр
    /// ширхгээр.  Урьдчилан сонгосон арматур байвал тэднийг нэг дор (нэг удаа) тавина.
    /// </summary>
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public class RebarEndSymbolCommand : IExternalCommand
    {
        private static bool IsBarSet(Rebar r)
        {
            try { return r.NumberOfBarPositions > 1; }
            catch { return false; }
        }

        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            UIDocument uidoc;
            Document doc;
            if (!RfGuard.Begin(commandData, RfText.EndTitle, out uidoc, out doc)) return Result.Cancelled;

            View view = doc.ActiveView;
            if (RfView.Use(view) == RfViewUse.Unsupported)
            {
                TaskDialog.Show(RfText.EndTitle, RfText.UnsupportedView);
                return Result.Cancelled;
            }

            // Тохирох family (view-based Generic Annotation / Detail Item) БАЙХГҮЙ ч ажиллана: код-оор зурах тэмдэг (тойрог/загалмай/налуу зураас).
            List<FamilySymbol> symbols = EndSymbolService.ListSymbols(doc);

            int notRebar;
            List<Rebar> rebars = RfRebarCollect.Resolve(
                uidoc.Selection.GetElementIds().Select(id => doc.GetElement(id)), out notRebar);

            RfPrefsData prefs = RfPrefs.Load();
            var dlg = new EndSymbolDialog(doc, symbols, prefs.EndSymbol, rebars.Count, notRebar);
            if (App.ShowOwned(dlg, commandData.Application.MainWindowHandle) != true || dlg.Options == null)
                return Result.Cancelled;

            // «Дараагийн удаа санах» — ЗӨВХӨН чагталсан үед сонголтыг хадгална; үгүй бол өгөгдмөл руу буцаана.
            // Цонхны «OK»-ийн дараа шууд (дараалан дарах горимд Esc нь «дуусгах» — тохиргоо алдагдах ёсгүй).
            if (dlg.Remember) dlg.ApplyTo(prefs.EndSymbol);
            else prefs.EndSymbol = new RfEndSymbolPrefs();
            RfPrefs.Save(prefs);

            // Урьдчилан сонгоогүй: арматур бүр дээр ДАРААЛАН дарж, дарах бүрт тэмдэг шууд тавигдана; Esc = дуусгах.
            if (rebars.Count == 0) return PickLoop(uidoc, doc, view, dlg.Options);

            // Олонлог (bar set) арматурыг ӨМНӨ нь сонгосон бол «аль ширхэг» гэдгийг тодорхойлох дарсан цэг байхгүй — ширхгийг таамаглахгүй
            // (бүх ширхэгт ч тавихгүй), нэг удаа ширхэг дээр дарж заалгана.  Esc = цуцлах.
            if (dlg.Options.BarSet == RfBarSetMode.Nearest && !dlg.Options.PickPoint.HasValue && rebars.Count == 1 && IsBarSet(rebars[0]))
            {
                try
                {
                    XYZ clicked = uidoc.Selection.PickPoint(RfText.PickBarPrompt);
                    dlg.Options.PickPoint = RfConv.V(clicked);
                }
                catch (Autodesk.Revit.Exceptions.OperationCanceledException)
                {
                    return Result.Cancelled;
                }
                catch (Exception ex)
                {
                    message = ex.Message;
                    TaskDialog.Show(RfText.EndTitle, RfText.Error(ex.Message));
                    return Result.Failed;
                }
            }

            RfEndSymbolReport rep;
            try
            {
                rep = EndSymbolService.Place(doc, view, rebars, dlg.Options);
            }
            catch (Exception ex)
            {
                message = ex.Message;
                TaskDialog.Show(RfText.EndTitle, RfText.Error(ex.Message));
                return Result.Failed;
            }
            rep.Unsupported = notRebar;

            // Ctrl+Z-ийн сануулга ЗӨВХӨН бодитоор тэмдэг тавигдсан үед — үгүй бол Ctrl+Z нь хэрэглэгчийн өмнөх ӨӨР үйлдлийг буцаана.
            RfGuard.ShowReport(RfText.EndTitle,
                rep.Placed > 0 ? RfText.EndDone : RfText.EndNothing,
                RfText.EndResult(rep) + (rep.Placed > 0 ? "\n\n" + RfText.Ctrlz : string.Empty) + "  (" + rep.ElapsedMs + " ms)",
                rep.Failures.Concat(rep.Notes));
            return rep.Placed > 0 ? Result.Succeeded : (rep.Failures.Count > 0 ? Result.Failed : Result.Cancelled);
        }

        /// <summary>
        /// Дараалан дарах горим: цонхны тохиргоо НЭГ удаа, дараа нь арматур бүр дээр дарах бүрт тэмдэг ШУУД тавигдана —
        /// товшилт бүр өөрийн транзакц (нээлттэй транзакцгүйгээр дахин сонгоно; Ctrl+Z бүр сүүлийн товшилтыг буцаана).
        /// Явц status bar-т («Тавьсан: N · Сүүлийнх: …»), цонх гаргахгүй.  Esc = дуусгах.  Эцсийн тайлан зөвхөн алгассан /
        /// анхааруулах зүйл байвал; алдаа гарвал давталт ЗОГСОЖ шууд мэдэгдэнэ (дараагийн товшилт бүр ижил алдаа давтана).
        /// </summary>
        private static Result PickLoop(UIDocument uidoc, Document doc, View view, RfEndSymbolOptions options)
        {
            var total = new RfEndSymbolReport();
            string last = null;
            int clicks = 0;
            bool stopped = false;
            var filter = new RfRebarPickFilter();

            while (true)
            {
                Reference picked;
                try
                {
                    picked = uidoc.Selection.PickObject(ObjectType.Element, filter, RfText.PickLoopPrompt(total.Placed, last));
                }
                catch (Autodesk.Revit.Exceptions.OperationCanceledException)
                {
                    break; // Esc — дуусгах (тавьсан тэмдгүүд хэвээр)
                }
                catch (Exception ex)
                {
                    // Сонголт эхэлж чадсангүй (ж: өөр командын горим идэвхтэй) — энэ товшилтод загварт юу ч бичигдээгүй.
                    total.Failures.Add(ex.Message);
                    stopped = true;
                    break;
                }

                Rebar rebar = picked == null ? null : doc.GetElement(picked) as Rebar;
                if (rebar == null) continue;

                // Олонлог (bar set) бол ЭНЭ товшилтын цэгт хамгийн ойр ширхэг — өмнөх товшилтын цэгийг дамжуулахгүй.
                options.PickPoint = null;
                XYZ gp = null;
                try { gp = picked.GlobalPoint; }
                catch { gp = null; }
                if (gp != null && !gp.IsAlmostEqualTo(XYZ.Zero)) options.PickPoint = RfConv.V(gp);

                RfEndSymbolReport rep;
                try
                {
                    rep = EndSymbolService.Place(doc, view, new List<Rebar> { rebar }, options);
                }
                catch (Exception ex)
                {
                    rep = new RfEndSymbolReport();
                    rep.Failures.Add(ex.Message);
                }
                clicks++;
                total.Add(rep);
                if (rep.Failures.Count > 0)
                {
                    stopped = true;
                    break;
                }
                last = RfText.LastPick(rep);
            }

            if (clicks == 0 && !stopped) return Result.Cancelled; // шууд Esc — загварт ямар ч өөрчлөлтгүй

            // ⚠️ `message`-ийг ЗОРИУД бичихгүй — тайлан аль хэдийн харагдсан; Revit-ийн хоёр дахь алдааны цонх давхардана.
            if (total.HasIssues || total.Placed == 0)
            {
                RfGuard.ShowReport(RfText.EndTitle,
                    total.Placed > 0 ? RfText.EndDone : RfText.EndNothing,
                    RfText.EndResult(total) + (total.Placed > 0 ? "\n\n" + RfText.CtrlzPerPick : string.Empty) + "  (" + total.ElapsedMs + " ms)",
                    total.Failures.Concat(total.Notes));
            }
            return total.Placed > 0 ? Result.Succeeded : (total.Failures.Count > 0 ? Result.Failed : Result.Cancelled);
        }
    }

    /// <summary>
    /// «Тэмдэглэгээ шинэчлэх»: идэвхтэй харагдацад энэ add-in-ий тавьсан тэмдэглэгээг (одоогоор төгсгөлийн тэмдэг)
    /// арматурын ОДООГИЙН геометрээр дахин тооцож зөөнө/эргүүлнэ.  Гараар тавьсан юм хөндөгдөхгүй, юу ч УСТАХГҮЙ.
    /// </summary>
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public class RefreshAnnotationsCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            UIDocument uidoc;
            Document doc;
            if (!RfGuard.Begin(commandData, RfText.RefreshTitle, out uidoc, out doc)) return Result.Cancelled;

            View view = doc.ActiveView;
            if (RfView.Use(view) == RfViewUse.Unsupported)
            {
                TaskDialog.Show(RfText.RefreshTitle, RfText.UnsupportedView);
                return Result.Cancelled;
            }

            // ⚠️ Огтлолын тэмдэглэгээг «шинэчлэх» нь хэмжээс/tag-ийг ШИНЭЭР үүсгээд өмнөхийг солино — гараар зөөсөн/форматласан байрлал алдагдана.
            // Тэгэхээр ийм тэмдэглэгээ энэ харагдацад бий бол ЭХЛЭЭД асууна; өгөгдмөл нь аюулгүй сонголт (зөвхөн төгсгөлийн тэмдэг).
            bool includeSections = true;
            int sectionSets = RfSectionStore.Read(view).Sets.Count;
            if (sectionSets > 0)
            {
                var ask = new TaskDialog(RfText.RefreshTitle)
                {
                    MainInstruction = RfText.RefreshAskTitle,
                    MainContent = RfText.RefreshAskBody(sectionSets),
                    CommonButtons = TaskDialogCommonButtons.Cancel,
                    DefaultButton = TaskDialogResult.CommandLink2,
                };
                ask.AddCommandLink(TaskDialogCommandLinkId.CommandLink1, RfText.RefreshAskAll);
                ask.AddCommandLink(TaskDialogCommandLinkId.CommandLink2, RfText.RefreshAskEndOnly);
                TaskDialogResult answer = ask.Show();
                if (answer == TaskDialogResult.CommandLink1) includeSections = true;
                else if (answer == TaskDialogResult.CommandLink2) includeSections = false;
                else return Result.Cancelled;
            }

            RfEndSymbolReport rep;
            List<RfSectionReport> secReports;
            int secOrphans;
            bool changed;
            try
            {
                // Хоёр төрлийн тэмдэглэгээ (төгсгөлийн тэмдэг + огтлолын багц) НЭГ Ctrl+Z-ээр буцна.
                using (var outer = new TransactionGroup(doc, RfText.RefreshTitle))
                {
                    outer.Start();
                    rep = EndSymbolService.Refresh(doc, view);
                    if (includeSections)
                    {
                        secReports = RfSectionService.Refresh(doc, view, out secOrphans);
                    }
                    else
                    {
                        secReports = new List<RfSectionReport>();
                        secOrphans = 0;
                    }
                    changed = rep.Updated > 0 || secReports.Any(r => r.DimsMade + r.Tags > 0);
                    if (changed) outer.Assimilate();
                    else outer.RollBack();
                }
            }
            catch (Exception ex)
            {
                message = ex.Message;
                TaskDialog.Show(RfText.RefreshTitle, RfText.Error(ex.Message));
                return Result.Failed;
            }

            bool nothing = rep.Rebars == 0 && rep.Failures.Count == 0 && secReports.Count == 0 && secOrphans == 0;
            if (nothing)
            {
                TaskDialog.Show(RfText.RefreshTitle, RfText.RefreshNothing);
                return Result.Cancelled;
            }

            string content = RfText.RefreshResult(rep);
            int dims = secReports.Sum(r => r.DimsMade), tags = secReports.Sum(r => r.Tags);
            if (secReports.Count > 0 || secOrphans > 0)
                content += "\n" + RfText.RefreshSecSummary(secReports.Count, dims, tags, secOrphans);
            var details = new List<string>(rep.Failures);
            foreach (RfSectionReport sr in secReports) details.AddRange(sr.Failures);
            RfGuard.ShowReport(RfText.RefreshTitle, RfText.RefreshDone,
                content + (changed ? "\n\n" + RfText.Ctrlz : string.Empty) + "  (" + (rep.ElapsedMs + secReports.Sum(r => r.ElapsedMs)) + " ms)", details);
            return details.Count > 0 && rep.Updated + dims + tags == 0 ? Result.Failed : Result.Succeeded;
        }
    }

    /// <summary>Товч идэвхтэй: project файлд, план/зүсэлт/фасад/detail харагдац идэвхтэй үед.</summary>
    public class RfViewAvailability : IExternalCommandAvailability
    {
        public bool IsCommandAvailable(UIApplication applicationData, CategorySet selectedCategories)
        {
            try
            {
                UIDocument uidoc = applicationData == null ? null : applicationData.ActiveUIDocument;
                if (uidoc == null || uidoc.Document == null || uidoc.Document.IsFamilyDocument) return false;
                return RfView.Use(uidoc.ActiveView) != RfViewUse.Unsupported;
            }
            catch
            {
                return false;
            }
        }
    }
}
