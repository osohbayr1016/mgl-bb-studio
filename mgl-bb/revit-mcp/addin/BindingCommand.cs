using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace RevitMcpAddin
{
    /// <summary>
    /// «Зураг холбох» — Revit-ийн хуудсуудыг MGL-ийн ажлуудтай тааруулна.
    ///
    /// IExternalCommand нь Revit-ийн ҮНДСЭН thread дээр ажилладаг тул Revit
    /// API-г ШУУД дуудаж болно (ExternalEvent шаардлагагүй).  HTTP дуудлагыг
    /// `Task.Run(...).GetAwaiter().GetResult()`-аар хийнэ — энэ бол add-in-ий
    /// бусад командуудын аль хэдийн хэрэглэдэг загвар (ScheduleExportCommand).
    /// </summary>
    [Transaction(TransactionMode.ReadOnly)]
    public class BindingCommand : IExternalCommand
    {
        private const string DialogTitle = "MGL — Зураг холбох";

        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            // ⚠️ ЛИЦЕНЗ (1.9.0): зөвхөн компанийн бүртгэлээр, ажлын компьютер дээр — Licensing/LicenseGate.cs.
            if (!global::RevitMcpAddin.Licensing.LicenseGate.Ensure()) return Result.Cancelled;
            UIDocument uidoc = commandData?.Application?.ActiveUIDocument;
            Document doc = uidoc?.Document;
            if (doc == null || doc.IsFamilyDocument)
            {
                TaskDialog.Show(DialogTitle, "Эхлээд төслийн файлаа нээнэ үү.");
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

            List<RevitTools.SheetDto> sheets;
            try
            {
                sheets = RevitTools.SheetDtos(doc);
            }
            catch (Exception ex)
            {
                TaskDialog.Show(DialogTitle, "Хуудсуудыг уншиж чадсангүй.\n\n" + RevitApi.FriendlyError(ex));
                return Result.Failed;
            }

            if (sheets.Count == 0)
            {
                TaskDialog.Show(
                    DialogTitle,
                    "Энэ файлд хуудас (Sheet) олдсонгүй.\n\n" +
                    "Явцын бүртгэл нь ХУУДАС дээр тулгуурладаг — эхлээд " +
                    "хуудсуудаа үүсгэнэ үү.");
                return Result.Cancelled;
            }

            HandshakeResult hs;
            try
            {
                hs = Ui.MglBusy.Run("ERP-тэй холбогдож, хуудсуудыг тулгаж байна…", () => RevitApi.HandshakeAsync(
                        settings.ApiHost,
                        settings.Token,
                        settings.ProjectId.Value,
                        RevitTools.DocUid(doc),
                        SafeFileName(doc),
                        doc.Application?.VersionNumber,
                        doc.IsLinked,
                        sheets));
            }
            catch (UnauthorizedException)
            {
                TaskDialog.Show(DialogTitle,
                    "Нэвтрэлт хүчингүй болжээ. Тохиргоо цонхноос дахин нэвтэрнэ үү.");
                return Result.Cancelled;
            }
            catch (Exception ex)
            {
                TaskDialog.Show(DialogTitle, "Сервертэй холбогдож чадсангүй:\n\n" +
                                             RevitApi.FriendlyError(ex));
                return Result.Failed;
            }

            if (hs?.Document == null)
            {
                TaskDialog.Show(DialogTitle, "Сервер хүлээгдээгүй хариу буцаалаа.");
                return Result.Failed;
            }

            var dlg = new BindingDialog(settings.ApiHost, settings.Token, hs);
            App.ShowOwned(dlg, commandData.Application.MainWindowHandle);

            // Холбоос батлагдсан бол суурь snapshot-ыг ТҮҮНИЙ ДАРАА авна —
            // ингэснээр «өнөөдөр юу өөрчлөгдсөн» гэдэг нь холбосон агшнаас
            // эхэлж тоологдоно.
            if (dlg.Saved)
            {
                // ⚠️ RevitToolBus.Call-ыг ЭНД дуудаж БОЛОХГҮЙ.  IExternalCommand.Execute
                // нь Revit-ийн ҮНДСЭН thread дээр ажилладаг ба Call нь ExternalEvent
                // Raise хийгээд тэр л thread-ийг блоклодог — Revit сул зав гарахгүй
                // тул үйл явдал хэзээ ч дуудагдахгүй.  Үр дүн: Revit 180 секунд
                // гацаад суурь нь ЯГ Л авагдахгүй (алдаа нь catch-д залгигдана).
                // Execute өөрөө хүчинтэй API контекстэд, үндсэн thread дээр байгаа
                // тул гарц огт хэрэггүй — шууд дуудна (CaptureBaseline нь зөвхөн
                // уншаад JSON файл бичдэг, Transaction нээхгүй).
                try { RevitTools.Run(commandData.Application, "capture_baseline", "{}"); }
                catch { /* суурь авч чадаагүй нь илгээхийг зогсоохгүй */ }
            }

            return Result.Succeeded;
        }

        /// <summary>
        /// Path.GetFileName-ийн ДӨРӨВ ДЭХ хуулбар (LinkEnumerator, QtoExtractor,
        /// ScheduleExportCommand, PdfViewExportCommand).  Хадгалаагүй файлд
        /// PathName хоосон байдаг тул Title рүү шилжинэ.
        /// </summary>
        private static string SafeFileName(Document doc)
        {
            try
            {
                return string.IsNullOrEmpty(doc.PathName)
                    ? doc.Title
                    : System.IO.Path.GetFileName(doc.PathName);
            }
            catch
            {
                return doc.Title ?? "unknown.rvt";
            }
        }
    }
}
