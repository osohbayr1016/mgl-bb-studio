using System;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using RevitMcpAddin.Smart;
using RevitMcpAddin.Smart.Core;
using RevitMcpAddin.SmartCount.Ui;

namespace RevitMcpAddin.SmartCount
{
    /// <summary>
    /// «Smart Count» ribbon команд — модальгүй цонхыг нээнэ (төрөл тутамд НЭГ; дахин дарахад байгааг нь урд гаргана).
    /// Цонх Revit API-д `SmartExecutor`-оор л хүрнэ.  Загварыг ӨӨРЧИЛӨХГҮЙ (сонголт нь зөвхөн UI-н сонголт).
    /// </summary>
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public class SmartCountCommand : IExternalCommand
    {
        private const string DialogTitle = "MGL — Элемент тоолох";

        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            // ⚠️ ЛИЦЕНЗ (1.9.0): зөвхөн компанийн бүртгэлээр, ажлын компьютер дээр — Licensing/LicenseGate.cs.
            if (!global::RevitMcpAddin.Licensing.LicenseGate.Ensure()) return Result.Cancelled;
            UIDocument uidoc = commandData.Application.ActiveUIDocument;
            if (uidoc == null || uidoc.Document == null) return Result.Cancelled;
            Document doc = uidoc.Document;
            if (doc.IsFamilyDocument)
            {
                TaskDialog.Show(DialogTitle, "Элемент тоолох нь зөвхөн төслийн файлд ажиллана — Family биш.");
                return Result.Cancelled;
            }
            if (!SmartExecutor.IsReady)
            {
                TaskDialog.Show(DialogTitle, "MGL Smart гарц эхлээгүй байна — Revit-ийг дахин асаана уу.");
                return Result.Failed;
            }

            try
            {
                SmartWindows.ShowModeless(SmartWindows.IdentityOf(doc), () => new SmartCountWindow(new RevitCountSession(doc)));
                return Result.Succeeded;
            }
            catch (Exception ex)
            {
                SmartLog.Error("count", "open_failed", ex);
                TaskDialog.Show(DialogTitle, "Цонхыг нээж чадсангүй (" + ex.GetType().Name + ").");
                return Result.Failed;
            }
        }
    }
}
