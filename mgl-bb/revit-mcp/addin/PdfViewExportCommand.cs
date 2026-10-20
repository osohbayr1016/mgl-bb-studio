using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace RevitMcpAddin
{
    /// <summary>
    /// «PDF илгээх» ribbon команд: идэвхтэй харагдацыг PDF болгоно.  План/огтлолд grid-үүдийн
    /// хооронд автомат хэмжээс тавьж, PDF болгон export хийгээд MGL сайт руу
    /// байршуулна. Хэмжээсүүд ТҮРХИЙН — транзакцаа export-ийн ДАРАА rollback
    /// хийдэг тул модель огт өөрчлөгдөхгүй (undo stack ч бохирдохгүй).
    ///
    /// Spike-аар батлагдсан (Revit 2027): PDF export нээлттэй транзакц дотор
    /// ажилладаг тул commit огт хэрэггүй — нэг Transaction: хэмжээс →
    /// Regenerate → Export → RollBack.
    /// </summary>
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public class PdfViewExportCommand : IExternalCommand
    {
        private const string DialogTitle = "MGL — PDF";

        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            // ⚠️ ЛИЦЕНЗ (1.9.0): зөвхөн компанийн бүртгэлээр, ажлын компьютер дээр — Licensing/LicenseGate.cs.
            if (!global::RevitMcpAddin.Licensing.LicenseGate.Ensure()) return Result.Cancelled;
            UIDocument uidoc = commandData.Application.ActiveUIDocument;
            if (uidoc == null || uidoc.Document == null)
                return Result.Cancelled;
            Document doc = uidoc.Document;

            // ⚠️ ActiveGraphicalView БИШ, ActiveView.  ActiveGraphicalView нь хүснэгт
            // (schedule) нээлттэй үед СҮҮЛД идэвхтэй байсан график харагдацыг буцаадаг
            // тул хэрэглэгч дэлгэц дээрээ харж байгаагаас ӨӨР зургийг илгээх эрсдэлтэй.
            View view = uidoc.ActiveView;
            if (!IsExportable(view))
            {
                TaskDialog.Show(DialogTitle,
                    "Энэ харагдацыг PDF болгож чадахгүй.\n\n"
                    + "План, огтлол, фасад, хуудас, 3D эсвэл draft харагдац нээгээд "
                    + "дахин оролдоно уу.");
                return Result.Cancelled;
            }

            AddinSettings settings = SettingsStore.Load();
            if (string.IsNullOrEmpty(settings.Token) || settings.ProjectId == null)
            {
                App.ShowOwned(new SettingsDialog(), commandData.Application.MainWindowHandle);
                settings = SettingsStore.Load();
                if (string.IsNullOrEmpty(settings.Token) || settings.ProjectId == null)
                    return Result.Cancelled;
            }

            bool addGridDimensions = WantsGridDimensions(view);
            var confirm = new TaskDialog(DialogTitle)
            {
                MainInstruction = "«" + DisplayName(view) + "» харагдацыг PDF болгож илгээх үү?",
                MainContent = addGridDimensions
                    ? "Тэнхлэгүүдийн (grid) хооронд автомат хэмжээс тавигдаж PDF дээр харагдана; "
                      + "модель өөрөө өөрчлөгдөхгүй (түр хэмжээс экспортын дараа устна)."
                    : "Харагдац байгаагаараа PDF болно (автомат хэмжээс зөвхөн план, "
                      + "огтлолын харагдацад тавигдана).",
                CommonButtons = TaskDialogCommonButtons.Yes | TaskDialogCommonButtons.No,
                DefaultButton = TaskDialogResult.Yes,
            };
            if (confirm.Show() != TaskDialogResult.Yes)
                return Result.Cancelled;

            string folder = Path.Combine(Path.GetTempPath(), "RevitMcpAddin");
            Directory.CreateDirectory(folder);
            string safeName = SanitizeFileName(view.Name);
            string pdfPath = Path.Combine(folder, safeName + ".pdf");

            int dimCount;
            bool exported;
            using (var tx = new Transaction(doc, "MGL PDF экспорт (түр)"))
            {
                tx.Start();
                try
                {
                    // Тэнхлэгийн хэмжээс зөвхөн план/огтлолд утгатай.  Хуудас, 3D,
                    // draft харагдацыг байгаагаар нь экспортолно.
                    dimCount = addGridDimensions ? GridDimensioner.Run(doc, view) : 0;

                    if (addGridDimensions)
                    {
                        // Annotation crop идэвхтэй бол гадна тавьсан хэмжээсүүд
                        // хайчлагдана — түр унтраана (rollback-аар буцна).
                        Parameter annoCrop =
                            view.get_Parameter(BuiltInParameter.VIEWER_ANNOTATION_CROP_ACTIVE);
                        if (annoCrop != null && !annoCrop.IsReadOnly && annoCrop.AsInteger() == 1)
                            annoCrop.Set(0);

                        doc.Regenerate();
                    }

                    var options = new PDFExportOptions
                    {
                        Combine = true,
                        FileName = safeName,
                    };
                    exported = doc.Export(folder, new List<ElementId> { view.Id }, options);
                }
                finally
                {
                    // Түр хэмжээс + crop өөрчлөлт бүгд буцна; PDF диск дээр үлдэнэ.
                    tx.RollBack();
                }
            }

            if (!exported || !File.Exists(pdfPath))
            {
                TaskDialog.Show(DialogTitle, "PDF export бүтсэнгүй.");
                return Result.Failed;
            }

            try
            {
                byte[] bytes = File.ReadAllBytes(pdfPath);
                string fileName = QtoFileName(doc);

                MediaUploadResult upload = Ui.MglBusy.Run("PDF файлыг ERP руу байршуулж байна…", () =>
                        ApiClient.UploadMediaAsync(
                            settings.ApiHost, settings.Token,
                            safeName + ".pdf", bytes, "application/pdf"));

                Ui.MglBusy.Run<bool>("PDF-ийг ERP-д бүртгэж байна…", async () =>
                {
                    await ApiClient.RegisterViewExportAsync(
                        settings.ApiHost, settings.Token,
                        new ViewExportPayload
                        {
                            ProjectId = settings.ProjectId.Value,
                            ViewName = view.Name,
                            FileName = fileName,
                            MediaUrl = upload.Url,
                        });
                    return true;
                });

                var sb = new StringBuilder();
                sb.AppendLine("Илгээлээ.");
                sb.AppendLine();
                sb.AppendLine("Харагдац: " + DisplayName(view));
                if (addGridDimensions)
                    sb.AppendLine("Хэмжээсийн шугам: " + dimCount);
                sb.AppendLine("Хэмжээ: " + (bytes.Length / 1024.0 / 1024.0).ToString("F1") + " MB");
                sb.AppendLine();
                sb.AppendLine("Вэб: /app/qto → Самбар → Зургийн PDF хуудсууд");
                TaskDialog.Show(DialogTitle, sb.ToString());
                return Result.Succeeded;
            }
            catch (UnauthorizedException)
            {
                TaskDialog.Show(DialogTitle, "Токен хүчингүй — Тохиргооноос дахин нэвтэрнэ үү.");
                return Result.Failed;
            }
            catch (Exception ex)
            {
                TaskDialog.Show(DialogTitle, "Байршуулахад алдаа гарлаа.\n\n" + RevitApi.FriendlyError(ex));
                return Result.Failed;
            }
            finally
            {
                try { File.Delete(pdfPath); } catch { /* түр файл — үлдсэн ч хамаагүй */ }
            }
        }

        /// <summary>
        /// Энэ харагдацыг PDF болгож болох уу?  Идэвхжилтийн анги ба командын
        /// шалгалт хоёулаа ЭНЭ функцийг дуудна — өөр хоорондоо зөрөх боломжгүй.
        ///
        /// Урьд нь зөвхөн ViewPlan/ViewSection зөвшөөрөгддөг байсан тул хэрэглэгч
        /// хуудас эсвэл 3D дээр байхад товч ямар ч тайлбаргүй бүдгэрч, «эвдэрсэн»
        /// мэт харагддаг байв.  Экспортын API нь хэвлэгддэг аль ч харагдацыг
        /// дэмждэг тул хязгаарлалт хэрэггүй байсан.
        /// </summary>
        internal static bool IsExportable(View view)
        {
            if (view == null || view.IsTemplate)
                return false;
            if (!(view is ViewPlan || view is ViewSection || view is ViewSheet
                  || view is View3D || view is ViewDrafting))
                return false;

            // Хэвлэгдэхгүй харагдац (ж: зарим системийн харагдац) экспортод орохгүй.
            try { return view.CanBePrinted; }
            catch { return false; }
        }

        /// <summary>
        /// Тэнхлэгийн (grid) автомат хэмжээсийг зөвхөн план/огтлолд тавина —
        /// хуудас, 3D, draft харагдацад утгагүй бөгөөд GridDimensioner ажиллахгүй.
        /// </summary>
        internal static bool WantsGridDimensions(View view)
        {
            return view is ViewPlan || view is ViewSection;
        }

        /// <summary>Хэрэглэгчид харуулах нэр: хуудсанд дугаарыг нь хамт гаргана.</summary>
        private static string DisplayName(View view)
        {
            var sheet = view as ViewSheet;
            if (sheet == null)
                return view.Name;
            string number = sheet.SheetNumber;
            return string.IsNullOrWhiteSpace(number) ? sheet.Name : number + " — " + sheet.Name;
        }

        private static string SanitizeFileName(string name)
        {
            var sb = new StringBuilder(name.Length);
            foreach (char ch in name)
                sb.Append(Array.IndexOf(Path.GetInvalidFileNameChars(), ch) >= 0 ? '_' : ch);
            string safe = sb.ToString().Trim();
            return string.IsNullOrEmpty(safe) ? "view" : safe;
        }

        private static string QtoFileName(Document doc)
        {
            try
            {
                string pathName = doc.PathName;
                if (!string.IsNullOrEmpty(pathName))
                    return Path.GetFileName(pathName);
            }
            catch (ArgumentException) { }
            return doc.Title + ".rvt";
        }
    }

    /// <summary>
    /// Хэвлэгдэх харагдац идэвхтэй үед товч асна.  Шалгалт нь командынхтай ижил
    /// (PdfViewExportCommand.IsExportable) — товч асаад команд нь татгалзах, эсвэл
    /// эсрэгээрээ болох боломжгүй.
    /// </summary>
    public class PdfViewAvailability : IExternalCommandAvailability
    {
        public bool IsCommandAvailable(UIApplication applicationData, CategorySet selectedCategories)
        {
            try
            {
                UIDocument uidoc = applicationData?.ActiveUIDocument;
                if (uidoc == null || uidoc.Document == null || uidoc.Document.IsFamilyDocument)
                    return false;
                return PdfViewExportCommand.IsExportable(uidoc.ActiveView);
            }
            catch
            {
                return false;
            }
        }
    }
}
