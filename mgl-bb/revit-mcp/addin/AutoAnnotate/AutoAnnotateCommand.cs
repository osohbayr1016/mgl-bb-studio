using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using RevitMcpAddin.Reinforcement;
using RevitMcpAddin.Reinforcement.Ui;

namespace RevitMcpAddin.AutoAnnotate
{
    /// <summary>
    /// «Автомат хэмжээс» ribbon команд (2026-09-30).  Идэвхтэй харагдацын элементийг
    /// таньж хэмжээс, tag-ийг ажлын зургийн бүтцээр тавина:
    ///   план  — гадна талд 3 гинж (нүх / тэнхлэг / нийт), дотор хананы гинж, хаалганы нүх,
    ///           баганын тэнхлэгийн холболт, хаалга/цонх/өрөө/багана/дам нурууны tag;
    ///   зүсэлт, фасад — түвшин, тэнхлэг, цонх/хаалганы өндөр, tag.
    /// Цөм нь <see cref="AaRunner"/> (UI-гүй, тест харness ч дууддаг).
    /// </summary>
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public class AutoAnnotateCommand : IExternalCommand
    {
        private const string DialogTitle = "MGL — Хэмжээс, тэмдэглэгээ";

        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            return Run(commandData, ref message, AaDialogTab.Default);
        }

        /// <summary>
        /// Нэгдсэн хэрэгслийн ГАНЦ орох цэг.  Хуучин «Огтлолын тэмдэглэгээ» товч (<c>Reinforcement.SectionAnnotationCommand</c>) энд
        /// <see cref="AaDialogTab.Copy"/>-гээр дамжуулна — давхар хэрэглэгчийн урсгал (хоёр өөр цонх) үгүй.
        /// </summary>
        internal Result Run(ExternalCommandData commandData, ref string message, AaDialogTab initialTab)
        {
            // ⚠️ ЛИЦЕНЗ (1.9.0): зөвхөн компанийн бүртгэлээр, ажлын компьютер дээр — Licensing/LicenseGate.cs.
            if (!global::RevitMcpAddin.Licensing.LicenseGate.Ensure()) return Result.Cancelled;
            UIDocument uidoc = commandData.Application.ActiveUIDocument;
            if (uidoc == null || uidoc.Document == null)
                return Result.Cancelled;
            Document doc = uidoc.Document;
            if (doc.IsFamilyDocument)
            {
                TaskDialog.Show(DialogTitle, "Зөвхөн project файл дээр ажиллана (family биш).");
                return Result.Cancelled;
            }
            View view = doc.ActiveView;
            if (AaScan.KindOf(view) == AaViewKind.Unsupported)
            {
                TaskDialog.Show(DialogTitle,
                    "Давхрын план, бүтээцийн план, таазны план, зүсэлт эсвэл фасад нээгээд дахин дарна уу.\n\n"
                    + "3D, хуудас, хүснэгт, draft харагдац дээр ажиллахгүй.");
                return Result.Cancelled;
            }
            if (view.ViewTemplateId != ElementId.InvalidElementId)
            {
                // Загвар нь хэмжээсийг нууж болзошгүй — анхааруулна, зогсоохгүй.
                try
                {
                    if (view.GetCategoryHidden(new ElementId(BuiltInCategory.OST_Dimensions)))
                    {
                        TaskDialog.Show(DialogTitle, "Энэ харагдацад хэмжээс (Dimensions) ангилал нуугдсан байна — "
                            + "тавьсан хэмжээс харагдахгүй.  Visibility/Graphics-ээс асаана уу.");
                    }
                }
                catch
                {
                }
            }

            ICollection<ElementId> selection = uidoc.Selection.GetElementIds();
            AaViewInfo info;
            try
            {
                info = AaRunner.Analyze(doc, view, selection);
            }
            catch (Exception ex)
            {
                message = ex.Message;
                TaskDialog.Show(DialogTitle, "Харагдацыг уншиж чадсангүй: " + ex.Message);
                return Result.Failed;
            }

            AaOptions prefs = AaPrefs.Load();

            // «Хуулбарлаж зурах» таб (хуучин «Огтлолын тэмдэглэгээ»-ний «Загвар харагдацаас хуулах»): зөвхөн план/зүсэлт/detail дээр боломжтой.
            RfViewUse use = RfView.Use(view);
            bool copyUsable = use == RfViewUse.Plan || use == RfViewUse.Section || use == RfViewUse.Detail;
            RfTemplatePanel copyPanel = null;
            try
            {
                if (copyUsable)
                    copyPanel = new RfTemplatePanel(doc, new RfTemplateSource(doc, view), RfTemplateFlow.Targets(doc, view, selection), true);
                else
                    copyPanel = new RfTemplatePanel(doc, null, null, false);
            }
            catch (Exception ex)
            {
                // Загвар цуглуулж чадаагүй нь үндсэн хэрэгслийг унагахгүй — таб «боломжгүй» гэж харагдана.
                copyPanel = new RfTemplatePanel(doc, null, null, false);
                System.Diagnostics.Debug.WriteLine("[auto-annotate] copy tab: " + ex.Message);
            }

            var dlg = new AutoAnnotateDialog(info, prefs, copyPanel, initialTab);
            if (App.ShowOwned(dlg, commandData.Application.MainWindowHandle) != true)
                return Result.Cancelled;

            // Загвар харагдацаас хуулах (генераторгүй зам) — тусдаа үйлдэл, хэмжээсийн тохиргоо хадгалагдахгүй.
            if (dlg.TemplateResult != null && dlg.TemplateTarget != null)
            {
                return RfTemplateFlow.Run(doc, view, dlg.TemplateTarget, dlg.TemplateResult, ref message);
            }

            AaOptions options = dlg.ToOptions();
            AaPrefs.Save(options);

            AaReport rep;
            try
            {
                rep = AaRunner.Run(doc, view, selection, options);
            }
            catch (Exception ex)
            {
                message = ex.Message;
                TaskDialog.Show(DialogTitle, "Алдаа: " + ex.Message);
                return Result.Failed;
            }

            ShowReport(rep);
            if (rep.Created.Count == 0 && rep.PreviousRemoved == 0 && !rep.RebarChanged)
                return rep.Errors.Count > 0 ? Result.Failed : Result.Cancelled;
            return Result.Succeeded;
        }

        internal static string Summary(AaReport r)
        {
            var sb = new StringBuilder();
            if (r.Dims > 0)
            {
                var parts = new List<string>();
                if (r.DimsFacade > 0) parts.Add("фасад " + r.DimsFacade);
                if (r.DimsGrid > 0) parts.Add("тэнхлэг " + r.DimsGrid);
                if (r.DimsOverall > 0) parts.Add("нийт " + r.DimsOverall);
                if (r.DimsInterior > 0) parts.Add("дотор " + r.DimsInterior);
                if (r.DimsDoor > 0) parts.Add("хаалга " + r.DimsDoor);
                if (r.DimsColumn > 0) parts.Add("багана " + r.DimsColumn);
                if (r.DimsLevel > 0) parts.Add("түвшин " + r.DimsLevel);
                if (r.DimsOpening > 0) parts.Add("нүхний өндөр " + r.DimsOpening);
                sb.AppendLine("Хэмжээс: " + r.Dims + " гинж (" + string.Join(", ", parts) + ")");
            }
            else if (r.RebarSections + r.ElevHosts + r.WsMras + r.WsTags + r.WsLapChains + r.WsOverall == 0)
            {
                sb.AppendLine("Хэмжээс: тавигдсангүй");
            }
            if (r.RebarSections > 0)
                sb.AppendLine("Арматур — огтлол: " + r.RebarSections + " гишүүн · хомутын гинж " + r.RebarSecDims + " (" + r.RebarSecDimSegments + " сегмент)"
                    + (r.RebarSecMemberDims > 0 ? " · гишүүний хэмжээс (тэнхлэг/хучилт/хана) " + r.RebarSecMemberDims : "") + " · шошго " + r.RebarSecTags);
            if (r.ElevHosts > 0)
                sb.AppendLine("Арматур — дэлгээс: " + r.ElevHosts + " гишүүн (дам нуруу, багана) · шошго " + r.ElevTags + " · хомутын MRA " + r.ElevMras + " · давхцал " + r.ElevLaps
                    + (r.ElevLapChains > 0 ? " · үргэлжилсэн " + r.ElevLapChains : "") + " · тэнхлэг/түвшний гинж " + r.ElevSpans);
            if (r.WsHosts > 0 || r.WsMras + r.WsTags + r.WsLapChains + r.WsOverall > 0)
                sb.AppendLine("Хана/хучилтын арматур: " + r.WsHosts + " хана/хучилт · MRA " + r.WsMras
                    + (r.WsTags > 0 ? " · шошго " + r.WsTags : "") + (r.WsLapChains > 0 ? " · үргэлжилсэн " + r.WsLapChains : "")
                    + (r.WsOverall > 0 ? " · ерөнхий хэмжээс " + r.WsOverall : "") + (r.WsFailed > 0 ? " · тавигдаагүй " + r.WsFailed : "")
                    + (r.WsMraExisting > 0 ? " · " + r.WsMraExisting + " олонлог аль хэдийн MRA-тай (давхар тавиагүй)" : "")
                    + (r.WsMraDupRemoved > 0 ? " · давхардсан MRA " + r.WsMraDupRemoved + " устгав" : ""));
            if (r.Tags + r.RoomTags + r.TagsExisting > 0 || r.RebarSections + r.ElevHosts + r.WsMras + r.WsTags + r.WsLapChains + r.WsOverall == 0)
                sb.AppendLine("Tag: " + (r.Tags + r.RoomTags) + (r.RoomTags > 0 ? " (өрөө " + r.RoomTags + ")" : "")
                + (r.TagsExisting > 0 ? " · " + r.TagsExisting + " нь аль хэдийн tag-тай байсан" : ""));
            if (r.PreviousRemoved > 0)
                sb.AppendLine("Өмнөх автомат хэмжээс/tag: " + r.PreviousRemoved + " устгаж дахин тавив");
            if (r.GridsExtended > 0)
                sb.AppendLine("Тэнхлэгийн бөмбөлөг гаргасан: " + r.GridsExtended);
            if (r.DimsFailed + r.TagsFailed + r.InvalidRemoved > 0)
                sb.AppendLine("Тавьж чадаагүй: " + (r.DimsFailed + r.InvalidRemoved) + " хэмжээс, " + r.TagsFailed + " tag");
            return sb.ToString().TrimEnd();
        }

        private static void ShowReport(AaReport r)
        {
            var td = new TaskDialog(DialogTitle)
            {
                MainInstruction = r.Errors.Count > 0 && r.Created.Count == 0 && !r.RebarChanged ? "Хэмжээс тавигдсангүй" : "Хэмжээс, тэмдэглэгээ тавигдлаа",
                MainContent = Summary(r) + "\n\nБүгдийг Ctrl+Z-ээр нэг дор буцаана.",
            };
            var notes = r.Errors.Select(e => "Алдаа: " + e).Concat(r.Notes).Take(15).ToList();
            if (notes.Count > 0)
                td.ExpandedContent = string.Join("\n", notes.Select(n => "• " + n));
            td.Show();
        }
    }

    /// <summary>Товч идэвхтэй: project файлд, план/зүсэлт/фасад харагдац идэвхтэй үед.</summary>
    public class AutoAnnotateAvailability : IExternalCommandAvailability
    {
        public bool IsCommandAvailable(UIApplication applicationData, CategorySet selectedCategories)
        {
            try
            {
                UIDocument uidoc = applicationData?.ActiveUIDocument;
                if (uidoc == null || uidoc.Document == null || uidoc.Document.IsFamilyDocument)
                    return false;
                return AaScan.KindOf(uidoc.ActiveView) != AaViewKind.Unsupported;
            }
            catch
            {
                return false;
            }
        }
    }
}
