using System;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace RevitMcpAddin
{
    /// <summary>
    /// «MGL туслах» бэхлэгддэг самбарын нийлүүлэгч.
    ///
    /// ⚠️ `RegisterDockablePane` нь ЗӨВХӨН `OnStartup` дотор дуудагдана —
    /// Revit-ийн API-ийн хатуу шаардлага.  Дараа нь `GetDockablePane(id)`-ээр
    /// хэдэн ч удаа нээж/хааж болно.
    ///
    /// GUID нь ТОГТМОЛ байх ёстой: Revit самбарын байрлал/хэмжээг үүгээр
    /// санадаг.  Хэзээ ч бүү өөрчил.
    /// </summary>
    public class AssistantPaneProvider : IDockablePaneProvider
    {
        public static readonly Guid PaneGuid = new Guid("6f1a2c74-9d43-4b1e-9a7c-2f5b0a91cc10");

        public static DockablePaneId PaneId => new DockablePaneId(PaneGuid);

        /// <summary>Нэг л удаа үүсгэнэ — самбар хаагдаад дахин нээгдэхэд төлөв нь хадгалагдана.</summary>
        private static AssistantPane _view;

        public static AssistantPane View => _view ?? (_view = new AssistantPane());

        public void SetupDockablePane(DockablePaneProviderData data)
        {
            data.FrameworkElement = View;
            data.InitialState = new DockablePaneState
            {
                DockPosition = DockPosition.Right,
            };
            // W10 (2026-10-16): «MGL туслах» Revit нээгдэхэд ӨӨРӨӨ гарч ирэхгүй — зөвхөн «AI туслах» товчоор.  Хуучин
            // хувилбараас шинэчилсэн хэрэглэгчийн Revit-ийн санасан «нээлттэй» төлөвийг App нэг удаа хаана
            // (`App.HideAssistantOnceAfterUpgrade`).  Эрүүл мэндийн тайлан самбараас салсан (`HealthReporter`).
            data.VisibleByDefault = false;
        }
    }

    /// <summary>«MGL туслах» товч — самбарыг нээж, идэвхжүүлнэ.</summary>
    [Transaction(TransactionMode.ReadOnly)]
    public class AssistantPaneCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            // ⚠️ ЛИЦЕНЗ (1.9.0): зөвхөн компанийн бүртгэлээр, ажлын компьютер дээр — Licensing/LicenseGate.cs.
            if (!global::RevitMcpAddin.Licensing.LicenseGate.Ensure()) return Result.Cancelled;
            try
            {
                DockablePane pane = commandData.Application.GetDockablePane(AssistantPaneProvider.PaneId);
                if (pane == null)
                {
                    TaskDialog.Show("MGL туслах",
                        "Самбар бүртгэгдээгүй байна. Revit-ээ дахин эхлүүлнэ үү.");
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

    /// <summary>Явцын товчнууд — төслийн файл нээлттэй үед л идэвхтэй.</summary>
    public class ProgressCommandAvailability : IExternalCommandAvailability
    {
        public bool IsCommandAvailable(UIApplication applicationData, CategorySet selectedCategories)
        {
            try
            {
                Document doc = applicationData?.ActiveUIDocument?.Document;
                return doc != null && !doc.IsFamilyDocument;
            }
            catch
            {
                return false;
            }
        }
    }
}
