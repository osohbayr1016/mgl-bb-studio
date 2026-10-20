using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace RevitMcpAddin
{
    /// <summary>
    /// "Тоо хэмжээ илгээх" ribbon команд: идэвхтэй загвараас нэгтгэсэн тоо
    /// хэмжээг уншаад MGL сервер рүү илгээнэ. Зөвхөн унших үйлдэл —
    /// Transaction огт нээхгүй.
    /// </summary>
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public class QtoExportCommand : IExternalCommand
    {
        private const string DialogTitle = "MGL — Тоо хэмжээ";

        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            // ⚠️ ЛИЦЕНЗ (1.9.0): зөвхөн компанийн бүртгэлээр, ажлын компьютер дээр — Licensing/LicenseGate.cs.
            if (!global::RevitMcpAddin.Licensing.LicenseGate.Ensure()) return Result.Cancelled;
            UIDocument uidoc = commandData.Application.ActiveUIDocument;
            if (uidoc == null || uidoc.Document == null)
                return Result.Cancelled;
            Document doc = uidoc.Document;

            AddinSettings settings = SettingsStore.Load();
            if (string.IsNullOrEmpty(settings.Token) || settings.ProjectId == null)
            {
                App.ShowOwned(new SettingsDialog(), commandData.Application.MainWindowHandle);
                settings = SettingsStore.Load();
                if (string.IsNullOrEmpty(settings.Token) || settings.ProjectId == null)
                    return Result.Cancelled;
            }

            // Link файлуудыг хамруулах бол олон файлын зам руу салаална;
            // ганц файл (link-гүй эсвэл унтраасан) бол хуучин зам ЯГ хэвээР.
            List<QtoTarget> targets = LinkEnumerator.CollectTargets(doc, settings.IncludeLinks);
            int runnable = 0;
            foreach (QtoTarget t in targets)
                if (t.Document != null)
                    runnable++;
            if (runnable > 1)
                return ExecuteMulti(commandData, settings, targets);

            QtoExtractionResult extraction;
            try
            {
                extraction = QtoExtractor.Extract(
                    doc, commandData.Application.Application.VersionNumber);
            }
            catch (Exception ex)
            {
                TaskDialog.Show(DialogTitle, "Тоо хэмжээ задлахад алдаа гарлаа.\n\n" + RevitApi.FriendlyError(ex));
                return Result.Failed;
            }

            QtoPayload payload = extraction.Payload;
            payload.ProjectId = settings.ProjectId.Value;

            // Сервер тал мөргүй payload-ыг 400-аар татгалздаг ("project_id,
            // file_name and rows are required") тул хүн англи JSON харах болно.
            // Илгээхээс ӨМНӨ ойлгомжтой хэлж, дэмий баталгаажуулалт харуулахгүй.
            if (extraction.RowCount == 0)
            {
                TaskDialog.Show(DialogTitle,
                    "«" + payload.FileName + "» файлаас тоо хэмжээ гаргах элемент олдсонгүй." + "\n\n" +
                    "Илгээх зүйл алга — загварт хана, хучилт, багана зэрэг бодит " +
                    "элемент байгаа эсэхээ шалгана уу.");
                return Result.Cancelled;
            }

            if (!ConfirmSend(settings, extraction))
                return Result.Cancelled;

            return Send(settings, payload);
        }

        /// <summary>
        /// Олон файлын зам: урьдчилсан баталгаажуулалт (задаргаа ХИЙХЭЭС ӨМНӨ —
        /// минутаар үргэлжлэх ажлыг эхлүүлэхийн өмнө юу явахыг харуулна),
        /// дараа нь бүх ажил QtoProgressWindow дотор явагдана.
        /// </summary>
        private static Result ExecuteMulti(
            ExternalCommandData commandData, AddinSettings settings, List<QtoTarget> targets)
        {
            var sb = new StringBuilder();
            sb.AppendLine("Төсөл: " +
                (string.IsNullOrEmpty(settings.ProjectName)
                    ? "#" + settings.ProjectId
                    : settings.ProjectName));
            sb.AppendLine();
            int sendCount = 0;
            foreach (QtoTarget t in targets)
            {
                if (t.Document != null)
                {
                    sendCount++;
                    sb.AppendLine("  • " + t.FileName + (t.IsHost ? "  (үндсэн)" : ""));
                }
            }
            foreach (QtoTarget t in targets)
            {
                if (t.Document == null)
                    sb.AppendLine("  — алгасна: " + t.FileName + " (" + t.SkipReason + ")");
            }
            sb.AppendLine();
            sb.AppendLine("Файл бүр ТУСДАА run болж илгээгдэнэ.");

            var confirm = new TaskDialog(DialogTitle)
            {
                MainInstruction = sendCount + " файлын тоо хэмжээг илгээх үү?",
                MainContent = sb.ToString(),
                CommonButtons = TaskDialogCommonButtons.Yes | TaskDialogCommonButtons.No,
                DefaultButton = TaskDialogResult.Yes,
            };
            if (confirm.Show() != TaskDialogResult.Yes)
                return Result.Cancelled;

            var window = new QtoProgressWindow(
                targets, settings, commandData.Application.Application.VersionNumber);
            App.ShowOwned(window, commandData.Application.MainWindowHandle);

            int ok = 0;
            int failed = 0;
            bool cancelled = false;
            foreach (FilePushOutcome outcome in window.Results)
            {
                if (outcome.Ok)
                    ok++;
                else if (outcome.Skipped && outcome.Error == "цуцлагдсан")
                    cancelled = true;
                else if (!outcome.Skipped)
                    failed++;
            }
            if (ok > 0)
                return Result.Succeeded;
            if (cancelled && failed == 0)
                return Result.Cancelled;
            return Result.Failed;
        }

        private static bool ConfirmSend(AddinSettings settings, QtoExtractionResult extraction)
        {
            var sb = new StringBuilder();
            sb.AppendLine("Файл: " + extraction.Payload.FileName);
            sb.AppendLine("Төсөл: " +
                (string.IsNullOrEmpty(settings.ProjectName)
                    ? "#" + settings.ProjectId
                    : settings.ProjectName));
            sb.AppendLine("Элемент: " + extraction.ElementCount.ToString("N0"));
            sb.AppendLine("Мөр (бүлэглэсэн): " + extraction.RowCount.ToString("N0"));
            if (extraction.MaterialsWithoutDensity > 0)
                sb.AppendLine("Жингүй материал: " + extraction.MaterialsWithoutDensity);

            if (extraction.TopCategories != null && extraction.TopCategories.Count > 0)
            {
                sb.AppendLine();
                sb.AppendLine("Ангилал (топ):");
                foreach (KeyValuePair<string, int> kv in extraction.TopCategories)
                    sb.AppendLine("  • " + kv.Key + ": " + kv.Value.ToString("N0"));
            }

            var dialog = new TaskDialog(DialogTitle)
            {
                MainInstruction = "Тоо хэмжээ илгээх үү?",
                MainContent = sb.ToString(),
                CommonButtons = TaskDialogCommonButtons.Yes | TaskDialogCommonButtons.No,
                DefaultButton = TaskDialogResult.Yes,
            };
            return dialog.Show() == TaskDialogResult.Yes;
        }

        private static Result Send(AddinSettings settings, QtoPayload payload)
        {
            bool retried = false;
            while (true)
            {
                try
                {
                    // Task.Run (deadlock-гүй) + модаль «хүлээж байна» цонх (`Ui/MglBusy`): 400 мс-аас удвал Revit «Not Responding»
                    // болохгүй, хэр удсаныг харуулна.  Сүлжээний дуудлага л — Revit API ЭНД дуудагдахгүй.
                    QtoPushResult result = Ui.MglBusy.Run("Тоо хэмжээг ERP-д илгээж байна…", () =>
                            ApiClient.PostRevitRunAsync(settings.ApiHost, settings.Token, payload));

                    TaskDialog.Show(DialogTitle, string.Format(
                        "Илгээлээ. Run #{0} — {1} мөр (ангилсан {2}, ангилаагүй {3}).",
                        result.RunId, result.Facts, result.Mapped, result.Unmapped));
                    return Result.Succeeded;
                }
                catch (UnauthorizedException)
                {
                    if (retried)
                    {
                        TaskDialog.Show(DialogTitle,
                            "Токен хүчингүй хэвээр байна. Тохиргооноос дахин нэвтэрнэ үү.");
                        return Result.Failed;
                    }

                    TaskDialog.Show(DialogTitle, "Токен хүчингүй боллоо — дахин нэвтэрнэ үү.");
                    bool? ok = App.ShowOwned(new SettingsDialog());
                    if (ok != true)
                        return Result.Cancelled;

                    settings = SettingsStore.Load();
                    if (string.IsNullOrEmpty(settings.Token))
                        return Result.Cancelled;
                    if (settings.ProjectId != null)
                        payload.ProjectId = settings.ProjectId.Value;
                    retried = true;
                }
                catch (DuplicatePushException dup)
                {
                    TaskDialog.Show(DialogTitle,
                        "Энэ илгээлт аль хэдийн хүлээн авагдсан байна (Run #" + dup.RunId + ").");
                    return Result.Succeeded;
                }
                catch (ApiException ex)
                {
                    TaskDialog.Show(DialogTitle, "Илгээж чадсангүй.\n\n" + RevitApi.FriendlyError(ex));
                    return Result.Failed;
                }
                catch (HttpRequestException ex)
                {
                    return HandleNetworkFailure(payload, ex);
                }
                catch (TaskCanceledException ex)
                {
                    return HandleNetworkFailure(payload, ex);
                }
            }
        }

        private static Result HandleNetworkFailure(QtoPayload payload, Exception ex)
        {
            string path = null;
            try { path = SettingsStore.SaveLastPayload(JsonSerializer.Serialize(payload)); }
            catch { /* хадгалж чадаагүй ч dialog-оо харуулна */ }

            var sb = new StringBuilder();
            sb.AppendLine("Сүлжээнд холбогдож чадсангүй — payload last-run.json-д хадгалагдлаа.");
            if (path != null)
            {
                sb.AppendLine();
                sb.AppendLine(path);
            }
            sb.AppendLine();
            sb.Append(ex.Message);
            TaskDialog.Show(DialogTitle, sb.ToString());
            return Result.Failed;
        }
    }

    /// <summary>Идэвхтэй project document байгаа үед л товчийг идэвхжүүлнэ.</summary>
    public class QtoCommandAvailability : IExternalCommandAvailability
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

    /// <summary>"Тохиргоо" товч — зөвхөн SettingsDialog-ийг нээнэ.</summary>
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public class QtoSettingsCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            App.ShowOwned(new SettingsDialog(), commandData.Application.MainWindowHandle);
            return Result.Succeeded;
        }
    }
}
