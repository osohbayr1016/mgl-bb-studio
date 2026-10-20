using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using RevitMcpAddin.AutoAnnotate;

namespace RevitMcpAddin.Reinforcement
{
    /// <summary>
    /// «Огтлолын тэмдэглэгээ» — ХУУЧИН орох цэг.  2026-10-05-аас тусдаа хэрэгсэл БИШ: нэгдсэн «Хэмжээс, тэмдэглэгээ» (<see cref="AutoAnnotateCommand"/>)-ийг
    /// «Хуулбарлаж зурах» таб идэвхтэй нээнэ.  Огтлолын автомат хэмжээс/шошго (хомутын гинж, ажлын арматурын шошго) «Арматур» табд, «Загвар харагдацаас хуулах»
    /// «Хуулбарлаж зурах» табд.  Ribbon-ы нэр (<c>MglRebarSectionAnnotation</c>), хайлт, тохиргоог эвдэхгүйн тулд команд хэвээр, зөвхөн чиглүүлнэ.
    /// </summary>
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public class SectionAnnotationCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            return new AutoAnnotateCommand().Run(commandData, ref message, AaDialogTab.Copy);
        }
    }
}
