using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using RevitMcpAddin.Reinforcement.Ui;

namespace RevitMcpAddin.Reinforcement
{
    /// <summary>
    /// «Түүвэр хувилах» — инженерийн форматласан нэг арматурын түүврийг (жишээ нь DN-1) эх болгож, Partition
    /// бүрт түүврийг View.Duplicate-аар хуулж, ЗӨВХӨН шүүлтүүрийг солино.  Урьдчилан харалгүй юу ч бичигдэхгүй;
    /// байгаа түүврийг өгөгдмөлөөр ХӨНДӨХГҮЙ.
    /// </summary>
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public class ScheduleCloneCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            UIDocument uidoc;
            Document doc;
            if (!RfGuard.Begin(commandData, RfText.CloneTitle, out uidoc, out doc)) return Result.Cancelled;

            var session = new RfScheduleSession(doc);
            List<ViewSchedule> templates;
            try { templates = session.Templates(); }
            catch (Exception ex)
            {
                message = ex.Message;
                TaskDialog.Show(RfText.CloneTitle, RfText.Error(ex.Message));
                return Result.Failed;
            }
            if (templates.Count == 0)
            {
                TaskDialog.Show(RfText.CloneTitle, RfText.NoTemplates);
                return Result.Cancelled;
            }

            RfPrefsData prefs = RfPrefs.Load();
            var dlg = new ScheduleCloneDialog(session, templates, doc.ActiveView as ViewSchedule, prefs.Schedule);
            if (App.ShowOwned(dlg, commandData.Application.MainWindowHandle) != true || dlg.Request == null)
                return Result.Cancelled;
            RfPrefs.Save(prefs);

            RfCloneReport rep;
            try { rep = session.Execute(dlg.Request); }
            catch (Exception ex)
            {
                message = ex.Message;
                TaskDialog.Show(RfText.CloneTitle, RfText.Error(ex.Message));
                return Result.Failed;
            }
            ShowResult(rep);
            return rep.Created + rep.Updated + rep.Replaced == 0 && rep.Failures.Count > 0 ? Result.Failed : Result.Succeeded;
        }

        internal static void ShowResult(RfCloneReport rep)
        {
            bool any = rep.Created + rep.Updated + rep.Replaced > 0;
            // Ctrl+Z-ийн сануулга ЗӨВХӨН бодитоор юм өөрчилсөн үед (үгүй бол Ctrl+Z нь хэрэглэгчийн өмнөх ӨӨР үйлдлийг буцаана).
            string content = RfText.CloneResult(rep.Created, rep.Updated, rep.Replaced, rep.UpToDate, rep.Conflicts,
                    Math.Max(0, rep.Skipped - rep.UpToDate - rep.Conflicts), rep.Failures.Count)
                + (rep.SheetsReplaced > 0 ? "\n" + RfText.SheetsReplaced(rep.SheetsReplaced) : string.Empty)
                + (any ? "\n\n" + RfText.Ctrlz : string.Empty) + "  (" + rep.ElapsedMs + " ms)";
            string heading = rep.Created > 0 ? RfText.CloneDone
                : (rep.Updated + rep.Replaced > 0 ? RfText.CloneUpdated
                : (rep.Failures.Count > 0 ? RfText.CloneFailed : RfText.CloneUnchanged));
            RfGuard.ShowReport(RfText.CloneTitle, heading, content, rep.Failures.Concat(rep.Notes));
        }
    }

    /// <summary>
    /// «Түүвэр синк хийх» — загварын Partition-ууд ба өмнө үүсгэсэн түүврүүдийг харьцуулна.  Дутууг үүсгэх,
    /// буруу шүүлтүүрийг засах; орхигдсоныг ЗӨВХӨН хэрэглэгч чагталвал устгана.
    /// </summary>
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public class ScheduleSyncCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            UIDocument uidoc;
            Document doc;
            if (!RfGuard.Begin(commandData, RfText.SyncTitle, out uidoc, out doc)) return Result.Cancelled;

            var session = new RfScheduleSession(doc);
            List<ViewSchedule> templates;
            try { templates = session.Templates(); }
            catch (Exception ex)
            {
                message = ex.Message;
                TaskDialog.Show(RfText.SyncTitle, RfText.Error(ex.Message));
                return Result.Failed;
            }
            if (templates.Count == 0)
            {
                TaskDialog.Show(RfText.SyncTitle, RfText.NoTemplates);
                return Result.Cancelled;
            }

            var dlg = new ScheduleSyncDialog(session, templates, doc.ActiveView as ViewSchedule);
            if (App.ShowOwned(dlg, commandData.Application.MainWindowHandle) != true || dlg.Action == RfSyncAction.None)
                return Result.Cancelled;

            try
            {
                if (dlg.Action == RfSyncAction.DeleteTicked)
                {
                    List<string> failed;
                    int n = session.DeleteSchedules(dlg.DeleteIds, dlg.TemplateId, out failed);
                    RfGuard.ShowReport(RfText.SyncTitle, RfText.DeleteResult(n) + (failed.Count > 0 ? " · " + RfText.DeleteFailedCount(failed.Count) : string.Empty),
                        n > 0 ? RfText.Ctrlz : RfText.NothingDeleted, failed);
                    return n > 0 ? Result.Succeeded : Result.Cancelled;
                }
                RfCloneReport rep = session.Execute(dlg.Request);
                ScheduleCloneCommand.ShowResult(rep);
                return rep.Created + rep.Updated + rep.Replaced == 0 && rep.Failures.Count > 0 ? Result.Failed : Result.Succeeded;
            }
            catch (Exception ex)
            {
                message = ex.Message;
                TaskDialog.Show(RfText.SyncTitle, RfText.Error(ex.Message));
                return Result.Failed;
            }
        }
    }
}
