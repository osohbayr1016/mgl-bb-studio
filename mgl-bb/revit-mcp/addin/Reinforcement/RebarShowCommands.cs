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
    /// <summary>
    /// «Захын, голын арматур»: НЭГ товчоор идэвхтэй харагдацад харагдах БҮХ арматурын олонлог (bar set)-ийн эхний, сүүлийн, голын ширхгийг
    /// үлдээж бусдыг нуух (Presentation = Select, эсвэл ердөө эхний-сүүлийн бол FirstLast).  Ганц болон 2 ширхэгтэй олонлогт ХҮРЭХГҮЙ.
    /// Нэг Ctrl+Z-ээр буцна.  Ширхэг сонгох, голоос N дэх ширхгийг харуулах нь <see cref="RebarShowPickCommand"/> (нэмэлт цэс).
    /// </summary>
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public class RebarShowEdgesCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            UIDocument uidoc;
            Document doc;
            if (!RfGuard.Begin(commandData, RfShowText.EdgesTitle, out uidoc, out doc)) return Result.Cancelled;

            View view = doc.ActiveView;
            if (RfView.Use(view) == RfViewUse.Unsupported)
            {
                TaskDialog.Show(RfShowText.EdgesTitle, RfText.UnsupportedView);
                return Result.Cancelled;
            }

            List<Rebar> rebars = RfShowService.RebarsInView(doc, view);
            if (rebars.Count == 0)
            {
                TaskDialog.Show(RfShowText.EdgesTitle, RfShowText.NoRebarInView);
                return Result.Cancelled;
            }

            // Хэнийг үлдээхийг цонхоор сонгуулна (сүүлийн сонголт хадгалагдсан).
            var dlg = new RebarEdgesDialog(RfShowPrefs.Load(), rebars.Count);
            if (App.ShowOwned(dlg, commandData.Application.MainWindowHandle) != true || dlg.Spec == null) return Result.Cancelled;

            RfShowReport rep;
            try
            {
                rep = RfShowService.Apply(doc, view, rebars, dlg.Spec, RfShowText.EdgesTitle);
            }
            catch (Exception ex)
            {
                message = ex.Message;
                TaskDialog.Show(RfShowText.EdgesTitle, RfShowText.Error(ex.Message));
                return Result.Failed;
            }

            RfGuard.ShowReport(RfShowText.EdgesTitle,
                rep.Changed > 0 ? RfShowText.Done : RfShowText.Nothing,
                RfShowText.Result(rep) + (rep.Changed > 0 ? "\n\n" + RfShowText.Ctrlz : string.Empty) + "  (" + rep.ElapsedMs + " ms)",
                rep.Failures.Concat(rep.Notes));
            return rep.Changed > 0 ? Result.Succeeded : (rep.Failures.Count > 0 ? Result.Failed : Result.Cancelled);
        }
    }

    /// <summary>
    /// «Арматурын ширхэг харуулах» нэмэлт цэс: эхний / сүүлийн / голын ширхэг, голоос хажуу тийш N дэх ширхгийг (гол заавал биш) сонгож,
    /// (1) сонгосон арматурт, (2) олонлогийн ширхэг дээр ДАРЖ (давтан), (3) харагдацын бүх арматурт хэрэглэнэ; мөн бүх ширхэгтэй болгож буцаана.
    /// Цонх хаагдаж, сонголт/үйлдэл дууссаны дараа сүүлийн утгуудаараа ДАХИН нээгдэнэ — Хаах хүртэл үргэлжилнэ.
    /// Ганц болон 2 ширхэгтэй олонлогт ХҮРЭХГҮЙ.
    /// </summary>
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public class RebarShowPickCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            UIDocument uidoc;
            Document doc;
            if (!RfGuard.Begin(commandData, RfShowText.PickTitle, out uidoc, out doc)) return Result.Cancelled;

            View view = doc.ActiveView;
            if (RfView.Use(view) == RfViewUse.Unsupported)
            {
                TaskDialog.Show(RfShowText.PickTitle, RfText.UnsupportedView);
                return Result.Cancelled;
            }

            RfShowPrefs prefs = RfShowPrefs.Load();
            string status = null;
            bool anyChange = false;

            while (true)
            {
                int unsupported;
                int pre = RfRebarCollect.Resolve(SelectedElements(uidoc, doc), out unsupported).Count;
                var dlg = new RebarShowDialog(prefs, status, pre);
                if (App.ShowOwned(dlg, commandData.Application.MainWindowHandle) != true || dlg.Action == RebarShowAction.None) break;

                RfShowReport rep;
                try
                {
                    rep = Run(uidoc, doc, view, dlg.Action, dlg.Spec);
                }
                catch (Exception ex)
                {
                    rep = new RfShowReport();
                    rep.Failures.Add(ex.Message);
                }
                if (rep == null) continue;      // Esc — юу ч хийгээгүй, өмнөх төлөв хэвээр
                if (rep.Changed > 0) anyChange = true;
                status = RfShowText.Result(rep)
                    + (rep.Changed > 0 ? "\n" + RfShowText.Ctrlz : string.Empty)
                    + (rep.Failures.Count > 0 ? "\n" + string.Join("\n", rep.Failures.Take(5).Select(f => "• " + f)) : string.Empty);
            }
            return anyChange ? Result.Succeeded : Result.Cancelled;
        }

        /// <summary>Нэг үйлдэл.  null = хэрэглэгч Esc дарсан (юу ч хийгээгүй).</summary>
        private static RfShowReport Run(UIDocument uidoc, Document doc, View view, RebarShowAction action, RfShowSpec spec)
        {
            switch (action)
            {
                case RebarShowAction.PickRebars:
                {
                    List<Rebar> rebars = SelectOrPick(uidoc, doc);
                    return rebars == null ? null : RfShowService.Apply(doc, view, rebars, spec, RfShowText.PickTitle);
                }
                case RebarShowAction.ResetPicked:
                {
                    List<Rebar> rebars = SelectOrPick(uidoc, doc);
                    return rebars == null ? null : RfShowService.ShowAll(doc, view, rebars, RfShowText.PickTitle);
                }
                case RebarShowAction.WholeView:
                {
                    List<Rebar> all = RfShowService.RebarsInView(doc, view);
                    if (all.Count == 0)
                    {
                        TaskDialog.Show(RfShowText.PickTitle, RfShowText.NoRebarInView);
                        return null;
                    }
                    return RfShowService.Apply(doc, view, all, spec, RfShowText.PickTitle);
                }
                case RebarShowAction.ResetView:
                {
                    List<Rebar> all = RfShowService.RebarsInView(doc, view);
                    if (all.Count == 0)
                    {
                        TaskDialog.Show(RfShowText.PickTitle, RfShowText.NoRebarInView);
                        return null;
                    }
                    return RfShowService.ShowAll(doc, view, all, RfShowText.PickTitle);
                }
                case RebarShowAction.PickBars:
                    return ClickLoop(uidoc, doc, view, spec);
                default:
                    return null;
            }
        }

        /// <summary>
        /// Дарах давталт: товшилт бүр олонлогийн дарсан ширхгийг тохиргоонд нэмж, ТУСДАА транзакцаар хэрэглэнэ (Ctrl+Z бүр сүүлийн товшилтыг буцаана).
        /// Esc = цонх руу буцах.  Алдаа гарвал давталт зогсож цонхонд мэдэгдэнэ.
        /// </summary>
        private static RfShowReport ClickLoop(UIDocument uidoc, Document doc, View view, RfShowSpec spec)
        {
            var total = new RfShowReport();
            var filter = new RfRebarPickFilter();
            int clicks = 0;
            string last = null;

            while (true)
            {
                Reference picked;
                try
                {
                    picked = uidoc.Selection.PickObject(ObjectType.Element, filter, RfShowText.PickBarPrompt(clicks, last));
                }
                catch (Autodesk.Revit.Exceptions.OperationCanceledException)
                {
                    break;
                }
                catch (Exception ex)
                {
                    total.Failures.Add(ex.Message);
                    break;
                }

                Rebar rebar = picked == null ? null : doc.GetElement(picked) as Rebar;
                if (rebar == null) continue;

                XYZ gp = null;
                try { gp = picked.GlobalPoint; }
                catch { gp = null; }
                if (gp == null || gp.IsAlmostEqualTo(XYZ.Zero))
                {
                    total.Failures.Add(RfShowText.NoNearestBar);
                    break;
                }

                RfShowReport rep = RfShowService.ApplyClick(doc, view, rebar, gp, spec, RfShowText.PickTitle);
                clicks++;
                total.Add(rep);
                last = RfShowText.LastClick(rep);
                if (rep.Failures.Count > 0) break;
            }
            return clicks == 0 && total.Failures.Count == 0 ? null : total;
        }

        /// <summary>Урьдчилан сонгосон арматур байвал тэдгээрийг, үгүй бол хэрэглэгчээр сонгуулна.  null = Esc.</summary>
        private static List<Rebar> SelectOrPick(UIDocument uidoc, Document doc)
        {
            int unsupported;
            List<Rebar> pre = RfRebarCollect.Resolve(SelectedElements(uidoc, doc), out unsupported);
            if (pre.Count > 0) return pre;
            try
            {
                IList<Reference> refs = uidoc.Selection.PickObjects(ObjectType.Element, new RfRebarPickFilter(), RfShowText.PickRebarsPrompt);
                List<Rebar> picked = RfRebarCollect.Resolve(refs.Select(r => doc.GetElement(r)), out unsupported);
                return picked.Count == 0 ? null : picked;
            }
            catch (Autodesk.Revit.Exceptions.OperationCanceledException)
            {
                return null;
            }
        }

        private static IEnumerable<Element> SelectedElements(UIDocument uidoc, Document doc)
        {
            return uidoc.Selection.GetElementIds().Select(id => doc.GetElement(id));
        }
    }
}
