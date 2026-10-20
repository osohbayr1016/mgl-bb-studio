using System;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using RevitMcpAddin.ChangeImpact.Ui;
using RevitMcpAddin.Smart;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.ChangeImpact
{
    /// <summary>
    /// «Өөрчлөлтийн нөлөө» ribbon команд — модальгүй цонхыг нээнэ (нэг instance; дахин дарахад байгааг нь урд гаргана).
    /// Цонх Revit API-д `SmartExecutor`-оор л хүрнэ.  Загварыг ӨӨРЧИЛӨХГҮЙ.
    /// </summary>
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public class ChangeImpactCommand : IExternalCommand
    {
        private const string DialogTitle = "MGL — Өөрчлөлтийн нөлөө";

        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            // ⚠️ ЛИЦЕНЗ (1.9.0): зөвхөн компанийн бүртгэлээр, ажлын компьютер дээр — Licensing/LicenseGate.cs.
            if (!global::RevitMcpAddin.Licensing.LicenseGate.Ensure()) return Result.Cancelled;
            UIDocument uidoc = commandData.Application.ActiveUIDocument;
            if (uidoc == null || uidoc.Document == null) return Result.Cancelled;
            Document doc = uidoc.Document;
            if (doc.IsFamilyDocument)
            {
                TaskDialog.Show(DialogTitle, "Өөрчлөлтийн нөлөө нь зөвхөн төслийн (project) файлд ажиллана — Family биш.");
                return Result.Cancelled;
            }
            if (!SmartExecutor.IsReady)
            {
                TaskDialog.Show(DialogTitle, "MGL Smart гарц эхлээгүй байна — Revit-ийг дахин асаана уу.");
                return Result.Failed;
            }

            try
            {
                SmartWindows.ShowModeless(SmartWindows.IdentityOf(doc), () => new ChangeImpactWindow(new RevitImpactSession(doc)));
                return Result.Succeeded;
            }
            catch (Exception ex)
            {
                SmartLog.Error("impact", "open_failed", ex);
                TaskDialog.Show(DialogTitle, "Цонхыг нээж чадсангүй (" + ex.GetType().Name + ").");
                return Result.Failed;
            }
        }
    }
}
