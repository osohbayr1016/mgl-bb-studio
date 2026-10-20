using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace RevitMcpAddin.Licensing
{
    /// <summary>
    /// «MGL нэвтрэлт» товч — компанийн бүртгэлээр нэвтрэх, энэ компьютерын лицензийн
    /// төлөв, дахин шалгах, гарах.  ЛИЦЕНЗГҮЙ ч ажиллана (энэ бол хаалганы өөрийнх нь хаалга).
    /// </summary>
    [Transaction(TransactionMode.ReadOnly)]
    public class LicenseCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            App.ShowOwned(new LicenseDialog(fromTool: false), commandData.Application.MainWindowHandle);
            return Result.Succeeded;
        }
    }

    /// <summary>«MGL нэвтрэлт» товч ҮРГЭЛЖ идэвхтэй — файл нээгээгүй ч нэвтэрч болно.</summary>
    public class LicenseAvailability : IExternalCommandAvailability
    {
        public bool IsCommandAvailable(UIApplication applicationData, CategorySet selectedCategories) => true;
    }
}
