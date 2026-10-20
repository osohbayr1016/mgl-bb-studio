using System;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace RevitMcpAddin.WorkPane
{
    /// <summary>
    /// «MGL ажил» бэхлэгддэг самбарын нийлүүлэгч (Revit work tracking MVP, 2026-09-29).
    ///
    /// ⚠️ `RegisterDockablePane` нь ЗӨВХӨН `OnStartup` дотор (Revit API-ийн хатуу
    ///    шаардлага) — `App.cs`-ийн `#if MGL_WORK_TRACKING` блок.
    /// ⚠️ GUID ТОГТМОЛ — Revit самбарын байрлал/хэмжээг үүгээр санадаг.  Хэзээ ч бүү сольж.
    /// ⚠️ `VisibleByDefault = true` — анх суулгасны дараа Revit нээхэд самбар ӨӨРӨӨ
    ///    гарч ирнэ (ажилтан туузан цэс хайх шаардлагагүй: «суулгаад л нэвтэрнэ»).
    ///    Дараагийн нээлтүүдэд Revit хэрэглэгчийн сүүлийн төлвийг (нээлттэй/хаалттай)
    ///    санана.
    /// </summary>
    public class WorkPaneProvider : IDockablePaneProvider
    {
        public static readonly Guid PaneGuid = new Guid("b6c1a3e2-5f47-4d8e-9a21-7c0e4d3f8a15");

        public static DockablePaneId PaneId => new DockablePaneId(PaneGuid);

        /// <summary>Нэг л удаа үүсгэнэ — хаагдаад дахин нээгдэхэд төлөв нь хадгалагдана.</summary>
        private static WorkPaneView _view;

        public static WorkPaneView View => _view ?? (_view = new WorkPaneView());

        public void SetupDockablePane(DockablePaneProviderData data)
        {
            data.FrameworkElement = View;
            data.VisibleByDefault = true;
            data.InitialState = new DockablePaneState
            {
                DockPosition = DockPosition.Right,
            };
        }
    }

    /// <summary>«MGL ажил» товч — самбарыг нээж, идэвхжүүлнэ.  Файлгүй ч ажиллана (нэвтрэх).</summary>
    [Transaction(TransactionMode.ReadOnly)]
    public class WorkPaneCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            // ⚠️ ЛИЦЕНЗ (1.9.0): зөвхөн компанийн бүртгэлээр, ажлын компьютер дээр — Licensing/LicenseGate.cs.
            if (!global::RevitMcpAddin.Licensing.LicenseGate.Ensure()) return Result.Cancelled;
            try
            {
                DockablePane pane = commandData.Application.GetDockablePane(WorkPaneProvider.PaneId);
                if (pane == null)
                {
                    TaskDialog.Show("MGL ажил", "Самбар бүртгэгдээгүй байна. Revit-ээ дахин эхлүүлнэ үү.");
                    return Result.Failed;
                }
                pane.Show();
                return Result.Succeeded;
            }
            catch (Exception ex)
            {
                message = ex.Message;
                return Result.Failed;
            }
        }
    }

    /// <summary>«MGL ажил» товч ҮРГЭЛЖ идэвхтэй — нээлттэй файлгүй ч нэвтэрч болно.</summary>
    public class WorkPaneAvailability : IExternalCommandAvailability
    {
        public bool IsCommandAvailable(UIApplication applicationData, CategorySet selectedCategories) => true;
    }
}
