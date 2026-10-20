using System;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using RevitMcpAddin.Ui.Core;

namespace RevitMcpAddin.Ui.Revit
{
    /// <summary>
    /// «Хэрэгсэл хайх» товч.  Модаль каталогийг нээж, хэрэглэгч «Нээх» дарсан бол цонх хаагдсаны ДАРАА
    /// (энэ нь `Execute`-ийн API контекст дотор) сонгосон командыг `PostCommand`-оор эхлүүлнэ.
    ///
    /// ⚠️ Лиценз/нэвтрэлт ШААРДАХГҮЙ (каталог нь заавар) — сонгосон хэрэгсэл эхлэхдээ ӨӨРИЙН гарцыг (`LicenseGate.Ensure`) хийнэ.
    /// ⚠️ Загварт ЮУ Ч ХИЙХГҮЙ (`ReadOnly`), ERP руу юу ч илгээхгүй.
    /// </summary>
    [Transaction(TransactionMode.ReadOnly)]
    [Regeneration(RegenerationOption.Manual)]
    public class ToolCatalogCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            try
            {
                UIApplication uiApp = commandData.Application;
                ToolContext context = ToolContextProbe.Read(uiApp);
                var window = new ToolCatalogWindow(context);
                App.ShowOwned(window, uiApp.MainWindowHandle);

                ToolMeta chosen = window.ChosenTool;
                if (chosen != null)
                {
                    LaunchResult r = ToolLauncher.TryPost(uiApp, chosen);
                    if (!r.Ok)
                        TaskDialog.Show("MGL — Хэрэгсэл хайх", r.Message);
                }
                return Result.Succeeded;
            }
            catch (Exception ex)
            {
                message = ex.Message;
                TaskDialog.Show("MGL — Хэрэгсэл хайх", "Каталогийг нээж чадсангүй: " + ex.Message);
                return Result.Failed;
            }
        }
    }
}
