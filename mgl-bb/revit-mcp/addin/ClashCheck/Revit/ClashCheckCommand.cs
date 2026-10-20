using System;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using RevitMcpAddin.ClashCheck.Ui;
using RevitMcpAddin.Smart;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.ClashCheck
{
    /// <summary>
    /// «Clash шалгах» ribbon команд — модальгүй цонхыг нээнэ (нэг instance; дахин дарахад байгааг нь урд гаргана).
    /// Цонх Revit API-д `SmartExecutor`-оор л хүрнэ.  Загварыг ӨӨРЧИЛӨХГҮЙ (сонгох/ойртуулах нь зөвхөн UI төлөв).
    /// </summary>
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public class ClashCheckCommand : IExternalCommand
    {
        private const string DialogTitle = "MGL — Давхцал шалгах";

        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            // ⚠️ ЛИЦЕНЗ (1.9.0): зөвхөн компанийн бүртгэлээр, ажлын компьютер дээр — Licensing/LicenseGate.cs.
            if (!global::RevitMcpAddin.Licensing.LicenseGate.Ensure()) return Result.Cancelled;
            UIDocument uidoc = commandData.Application.ActiveUIDocument;
            if (uidoc == null || uidoc.Document == null) return Result.Cancelled;
            Document doc = uidoc.Document;
            if (doc.IsFamilyDocument)
            {
                TaskDialog.Show(DialogTitle, "Давхцал шалгах нь зөвхөн төслийн файлд ажиллана — Family биш.");
                return Result.Cancelled;
            }
            if (!SmartExecutor.IsReady)
            {
                TaskDialog.Show(DialogTitle, "MGL Smart гарц эхлээгүй байна — Revit-ийг дахин асаана уу.");
                return Result.Failed;
            }

            try
            {
                SmartWindows.ShowModeless(SmartWindows.IdentityOf(doc), () => new ClashWindow(new RevitClashSession(doc)));
                return Result.Succeeded;
            }
            catch (Exception ex)
            {
                SmartLog.Error("clash", "open_failed", ex);
                TaskDialog.Show(DialogTitle, "Цонхыг нээж чадсангүй (" + ex.GetType().Name + ").");
                return Result.Failed;
            }
        }
    }
}
