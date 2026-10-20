using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace RevitMcpAddin
{
    /// <summary>
    /// «Хүснэгт илгээх» — идэвхтэй документын сонгосон Schedule/Quantities
    /// хүснэгтүүдийг эсийн текстээр нь вэбэд байршуулна. Сонголт сонгогч
    /// цонхонд хийгдэж settings.json-д хадгалагдана. Сервер тал REPLACE
    /// семантиктай тул дахин илгээхэд шинэчлэгдэнэ.
    /// </summary>
    [Transaction(TransactionMode.ReadOnly)]
    [Regeneration(RegenerationOption.Manual)]
    public class ScheduleExportCommand : IExternalCommand
    {
        private const string DialogTitle = "MGL — Хүснэгт";

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

            List<ViewSchedule> sendable = ScheduleReader.CollectSendable(doc);
            if (sendable.Count == 0)
            {
                TaskDialog.Show(DialogTitle, "Илгээж болох хүснэгт олдсонгүй.");
                return Result.Cancelled;
            }

            var items = sendable
                .Select(s => new SchedulePickItem
                {
                    Name = s.Name,
                    Category = ScheduleReader.CategoryNameOf(doc, s),
                    RowCount = ScheduleReader.RowCountOf(s),
                })
                .ToList();

            var picker = new SchedulePickerDialog(items, settings.SelectedSchedules);
            if (App.ShowOwned(picker, commandData.Application.MainWindowHandle) != true)
                return Result.Cancelled;

            // Сонголтыг санана (амжилт бүтэлгүйгээс үл хамааран — UX).
            settings.SelectedSchedules = picker.SelectedNames.ToList();
            SettingsStore.Save(settings);

            var chosen = new HashSet<string>(picker.SelectedNames, StringComparer.OrdinalIgnoreCase);
            var payload = new SchedulePushPayload
            {
                ProjectId = settings.ProjectId.Value,
                FileName = ResolveFileName(doc),
            };
            foreach (ViewSchedule s in sendable)
            {
                if (!chosen.Contains(s.Name))
                    continue;
                try
                {
                    payload.Schedules.Add(ScheduleReader.Read(doc, s));
                }
                catch
                {
                    // Нэг хүснэгтийн алдаа бусдыг нь унагахгүй.
                }
            }
            if (payload.Schedules.Count == 0)
            {
                TaskDialog.Show(DialogTitle, "Сонгосон хүснэгтүүдийг уншиж чадсангүй.");
                return Result.Failed;
            }

            // Сервер тал нэг илгээлтэд ХАМГИЙН ИХ 60 хүснэгт авдаг (qto.ts
            // MAX_SCHEDULES) бөгөөд хэтэрвэл БҮГДИЙГ 413-аар татгалздаг —
            // «Бүгдийг сонгох» дарсан том загварт бүх ажил дэмий үрэгддэг байв.
            // Илгээхээс ӨМНӨ монголоор хэлж, юуг нь хасахыг мэдэгдэнэ.
            const int MaxSchedules = 60;
            if (payload.Schedules.Count > MaxSchedules)
            {
                TaskDialog.Show(DialogTitle,
                    payload.Schedules.Count + " хүснэгт сонгосон байна — нэг удаад " +
                    MaxSchedules + " хүртэл илгээх боломжтой." + "\n\n" +
                    "Сонголтоо цөөрүүлээд дахин оролдоно уу (үлдсэнийг нь дараагийн " +
                    "удаад илгээж болно — сервер тал нэрээр нь шинэчилдэг).");
                return Result.Cancelled;
            }

            try
            {
                SchedulePushResult result = Ui.MglBusy.Run("Түүврийн хүснэгтүүдийг ERP-д илгээж байна…", () =>
                        ApiClient.PostSchedulesAsync(settings.ApiHost, settings.Token, payload));

                var sb = new StringBuilder();
                sb.AppendLine("Илгээлээ.");
                sb.AppendLine();
                sb.AppendLine("Хүснэгт: " + result.Saved);
                sb.AppendLine("Нийт мөр: " + result.Rows.ToString("N0"));
                sb.AppendLine();
                sb.AppendLine("Вэб: /app/qto → Самбар → Хүснэгт");
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
                TaskDialog.Show(DialogTitle, "Илгээхэд алдаа гарлаа.\n\n" + RevitApi.FriendlyError(ex));
                return Result.Failed;
            }
        }

        private static string ResolveFileName(Document doc)
        {
            try
            {
                string pathName = doc.PathName;
                if (!string.IsNullOrEmpty(pathName))
                {
                    string name = System.IO.Path.GetFileName(pathName);
                    if (!string.IsNullOrEmpty(name))
                        return name;
                }
            }
            catch (ArgumentException) { }
            return doc.Title + ".rvt";
        }
    }
}
