using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace RevitMcpAddin.RoomPlan
{
    /// <summary>
    /// «Давхрын план» (Finch маяг, 2026-10-14): ЦОНХ, АСУУЛТГҮЙ.  Идэвхтэй Floor Plan-ы давхрын шалыг өөрөө олж
    /// (`FloorStudioEngine.Capture` — сонгосон шал эсвэл тэр давхрын хамгийн том шал), зүүн талын «MGL — Давхрын план»
    /// самбарыг нээгээд олон зуун бүтэн давхрын хувилбарыг арын урсгалд бэлдэнэ (Revit хөлдөхгүй).  Сонголт, Revit-д тавих,
    /// тавилга — бүгд самбараас нэг товчоор (`FloorStudioPane`).  Давхрыг таних боломжгүй бол шалтгааныг самбар хэлнэ.
    /// </summary>
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public sealed class RoomPlanFloorCommand : IExternalCommand
    {
        internal const string Title = FloorPlateShell.GroupName;

        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            if (!Licensing.LicenseGate.Ensure()) return Result.Cancelled;
            UIApplication app = commandData.Application;
            StudioStorey storey = FloorStudioEngine.Capture(app.ActiveUIDocument);
            FloorStudioPaneProvider.Show(app);
            FloorStudioPaneProvider.View.Start(storey);
            return Result.Succeeded;
        }
    }
}
