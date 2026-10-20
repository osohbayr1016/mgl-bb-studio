using System;
using System.Collections.Generic;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using RevitMcpAddin.WallElevation.Core;
using RevitMcpAddin.WallElevation.Revit;
using RevitMcpAddin.WallElevation.Ui;

namespace RevitMcpAddin.WallElevation
{
    /// <summary>
    /// «Ханын дэлгээс» ribbon команд — НИМГЭН: лиценз → <see cref="WallElevationWorkflow"/> (Revit-ийн UI-тай).  «Үүсгэх» дармагц команд
    /// ДУУСНА — ажил арын горимд (<see cref="WeJob"/>, «Зураг клонлох»-той ижил хост), явц баруун талын «MGL — Ажлын явц» самбарт.  Урсгал өөрөө workflow-д — Revit дотрох шалгалт ЯГ ижил ангийг ажиллуулдаг.
    /// Runtime AI БАЙХГҮЙ; бүх Revit API дуудлага энэ thread-д.
    /// </summary>
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public class WallElevationCommand : IExternalCommand
    {
        /// <summary>«Интерьер» самбарын товч (<see cref="WallElevationInteriorCommand"/>) — хуудсанд интерьерийн ангилал үргэлж.</summary>
        protected virtual bool Interior { get { return false; } }

        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            // ⚠️ ЛИЦЕНЗ: бусад хэрэгслийн адил (Licensing/LicenseGate.cs).
            if (!global::RevitMcpAddin.Licensing.LicenseGate.Ensure()) return Result.Cancelled;
            try
            {
                UIApplication uiapp = commandData.Application;
                App.RememberMainWindow(uiapp.MainWindowHandle);
                UIDocument uidoc = uiapp.ActiveUIDocument;
                if (uidoc == null || uidoc.Document == null) return Result.Cancelled;

                WeSettings initial = WePrefsStore.Load();
                if (Interior)
                {
                    // W09 (2026-10-16): «Интерьер» товч = ӨГӨГДМӨЛ ЗОРИУЛАЛТ «Интерьер» (цонхонд харагдана, өрөө бүрт сольж болно).  Хуудасны «* Classification» =
                    // «Интерьер», «* Sub-Discipline» = «Барилга архитектур» нь тэр зориулалтын хуудасны мета (2026-10-14-ний түгжээ).
                    initial.InteriorTool = true;
                    initial.DefaultPreset = WePresetId.Interior;
                    initial.FixedSheetParams = WeSheetDiscipline.Interior();
                }
                WeWorkflowResult r = new WallElevationWorkflow().Run(uidoc, new RevitWorkflowUi(uidoc), initial, WePrefsStore.Save);
                if (r.Cancelled) return Result.Cancelled;
                if (r.Job != null) return Result.Succeeded;   // арын горимд — явц, тайлан баруун талын самбарт
                if (r.ViewToOpen != null)
                {
                    try { uidoc.ActiveView = r.ViewToOpen; }
                    catch (Exception ex) { WeLog.Error("open", r.ViewToOpen.Name, ex); }
                }
                return Result.Succeeded;
            }
            catch (Exception ex)
            {
                WeLog.Error("run", "Команд унав", ex);
                message = ex.Message;
                TaskDialog.Show(WallElevationWorkflow.Title, "Ханын дэлгээс үүсгэж чадсангүй: " + ex.Message + "\n\nДэлгэрэнгүй: " + WeLog.LogPath);
                return Result.Failed;
            }
        }
    }

    /// <summary>
    /// «Интерьер» самбарын «Ханын дэлгээс» (`MglWallElevations@interior`, RibbonBuilder.DisciplineBindings) — ижил урсгал, хуудсанд
    /// интерьерийн ангилал («* Classification» = «Интерьер», «* Sub-Discipline» = «Барилга архитектур») автоматаар.
    /// </summary>
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public class WallElevationInteriorCommand : WallElevationCommand
    {
        protected override bool Interior { get { return true; } }
    }

    /// <summary>Ribbon командын UI: Revit-ийн сонголт/TaskDialog + эзэнтэй модаль WPF.</summary>
    internal sealed class RevitWorkflowUi : IWeWorkflowUi
    {
        public WeTargets ChooseTargets(UIDocument uidoc) { return ElevationTargetResolver.PickTargets(uidoc); }

        public WeTargets ChooseMore(UIDocument uidoc) { return ElevationTargetResolver.PickMore(uidoc); }

        public bool CanChooseMore(UIDocument uidoc)
        {
            try { return uidoc != null && WeRoomPicker.Supports(uidoc.ActiveView); } catch { return false; }
        }

        public void Message(string text) { TaskDialog.Show(WallElevationWorkflow.Title, text); }

        public bool Preview(WallElevationDialog dialog) { return App.ShowOwned(dialog) == true; }

        private readonly UIDocument _uidoc;
        public RevitWorkflowUi(UIDocument uidoc) { _uidoc = uidoc; }

        public void Show(View view)
        {
            if (_uidoc != null && view != null && view.IsValidObject && _uidoc.ActiveView.Id != view.Id) _uidoc.ActiveView = view;
        }

        public bool StartBackground(WeJob job)
        {
            if (!CloneDrawings.CdJobHost.IsReady) return false;
            CloneDrawings.CdJobHost.Enqueue(job);
            if (!CloneDrawings.CdJobHost.ShowPane(_uidoc.Application))
                TaskDialog.Show(WallElevationWorkflow.Title,
                    "Ханын дэлгээс арын горимд эхэллээ — хүлээх хооронд Revit-д үргэлжлүүлэн ажиллаж болно.\n\n"
                    + "Явцын самбар нээгдсэнгүй (Revit-ээ дахин эхлүүлбэл гарна); дуусахад тайлан цонхоор гарна.");
            return true;
        }

        public bool ConfirmForeground(string reason)
        {
            var td = new TaskDialog(WallElevationWorkflow.Title)
            {
                MainInstruction = "Арын горим боломжгүй байна",
                MainContent = reason,
                CommonButtons = TaskDialogCommonButtons.Cancel,
                DefaultButton = TaskDialogResult.Cancel,
            };
            td.AddCommandLink(TaskDialogCommandLinkId.CommandLink1, "Одоо шууд үүсгэх", "Revit дуустал завгүй болно (ахиц самбаргүй)");
            td.AddCommandLink(TaskDialogCommandLinkId.CommandLink2, "Болих", "Тохиргоо хадгалагдсан — Revit-ийг дахин эхлүүлээд дахин дарна уу");
            return td.Show() == TaskDialogResult.CommandLink1;
        }

        public void OpenResults(Document doc)
        {
            View active = null;
            try { active = _uidoc != null ? _uidoc.ActiveView : null; } catch { }
            WeResultBrowser.Open(_uidoc.Application, doc, null, null, active != null ? active.Id : ElementId.InvalidElementId, true, false);
        }

        public bool Report(WeReport report)
        {
            var td = new TaskDialog(WallElevationWorkflow.Title)
            {
                MainInstruction = report.Instruction,
                MainContent = report.Content,
                ExpandedContent = report.Details,
                CommonButtons = TaskDialogCommonButtons.Close,
            };
            if (!string.IsNullOrEmpty(report.OpenLabel)) td.AddCommandLink(TaskDialogCommandLinkId.CommandLink1, report.OpenLabel, "Дэлгээсийг идэвхтэй харагдац болгоно");
            return td.Show() == TaskDialogResult.CommandLink1;
        }
    }
}
