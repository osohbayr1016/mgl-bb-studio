using System;
using System.Collections.Generic;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Events;
using RevitMcpAddin.Feedback.Core;

namespace RevitMcpAddin.Feedback
{
    /// <summary>
    /// «Санал хүсэлт» товч (туузан цэс, «Сан» самбар).
    /// ⚠️ ЛИЦЕНЗ ШААРДАХГҮЙ (<c>LicenseGate.Ensure()</c> ЗОРИУД байхгүй): лицензгүй / нэвтрээгүй / файлгүй үед ч алдаагаа
    ///    бичиж хадгалах боломжтой байх ёстой.  Илгээхэд компанийн бүртгэл (сервер) шаардагдана — сервер л эрхийг шийднэ.
    /// </summary>
    [Transaction(TransactionMode.ReadOnly)]
    public class FeedbackCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            try
            {
                UIApplication app = commandData.Application;
                App.RememberMainWindow(app.MainWindowHandle);
                Open(app, null, null, null, null);
                return Result.Succeeded;
            }
            catch (Exception ex)
            {
                message = ex.Message;
                return Result.Failed;
            }
        }

        /// <summary>
        /// Хэрэгслийн дотроос (ж: «Ханын дэлгээс»-ийн цонх, алдааны мессеж) нээнэ.  ⚠️ API context-д дуудна (командын
        /// <c>Execute</c> эсвэл түүний модаль цонх, ExternalEvent) — оношилгоо идэвхтэй файл/харагдацыг уншина.
        /// </summary>
        internal static void Open(UIApplication app, string toolId, string toolLabel, string stage, Exception error,
            string suggestedTitle = null, Dictionary<string, string> extra = null)
        {
            // Арын ажлын сүүлийн алдаа (2 цагийн дотор) — тэр агшинд цонх нээх боломжгүй байсан тул одоо хавсаргана.
            if (error == null)
            {
                FeedbackRecentErrors.Entry recent = FeedbackRecentErrors.Latest(toolId, DateTimeOffset.UtcNow);
                if (recent != null)
                {
                    toolId = recent.ToolId;
                    toolLabel = toolLabel ?? recent.ToolLabel;
                    stage = recent.Stage + " (" + recent.At.ToLocalTime().ToString("HH:mm") + ")";
                    error = recent.Error;
                }
            }
            DiagnosticsInput d = FeedbackDiagnosticsCollector.Collect(app, toolId, stage, error, extra);
            FeedbackWindow.ShowFor(new FeedbackContext
            {
                ToolId = toolId,
                ToolLabel = toolLabel,
                Stage = stage,
                Error = error,
                Diagnostics = d,
                SuggestedTitle = suggestedTitle ?? (error != null ? Trim((toolLabel ?? toolId ?? "MGL") + ": " + error.Message, FeedbackLimits.TitleMax) : null),
            });
        }

        /// <summary>Оношилгоог дуудагч аль хэдийн (API context-д) цуглуулсан бол — modeless самбараас.</summary>
        internal static void OpenWith(FeedbackContext ctx)
        {
            FeedbackWindow.ShowFor(ctx);
        }

        private static string Trim(string s, int max) => s == null || s.Length <= max ? s : s.Substring(0, max - 1) + "…";
    }

    /// <summary>«Санал хүсэлт» ҮРГЭЛЖ идэвхтэй — нээлттэй файлгүй, лицензгүй ч.</summary>
    public class FeedbackAvailability : IExternalCommandAvailability
    {
        public bool IsCommandAvailable(UIApplication applicationData, CategorySet selectedCategories) => true;
    }

    /// <summary>
    /// MGL add-in-ий барьж чадаагүй алдааг ЛОКАЛ файлд (<see cref="FeedbackCrashStore"/>) бичиж, ДАРААГИЙН нээлтэд
    /// хэрэглэгчээс «програм хариуцагчид мэдэгдэх үү?» гэж НЭГ удаа асууна.  Юу ч автоматаар илгээгдэхгүй.
    /// Зөвхөн stack-д манай кодын мөр (RevitMcpAddin.*) байгаа алдааг бичнэ — бусад add-in-ийн алдааг цуглуулахгүй.
    /// </summary>
    internal static class FeedbackCrashCapture
    {
        private static string _revitYear;
        private static bool _installed;
        private static UIControlledApplication _app;

        public static void Install(UIControlledApplication application, string revitYear)
        {
            if (_installed) return;
            _installed = true;
            _revitYear = revitYear;
            _app = application;
            AppDomain.CurrentDomain.UnhandledException += (s, e) =>
            {
                var ex = e.ExceptionObject as Exception;
                if (IsOurs(ex)) FeedbackCrashStore.Write(FeedbackCrashStore.DefaultDir(), ex, BuildInfo.Version, _revitYear, null, DateTimeOffset.UtcNow);
            };
            try
            {
                // WPF dispatcher-ийн алдааг АЖИГЛАНА л (Handled-ийг хөндөхгүй — Revit-ийн зан төлөв өөрчлөгдөхгүй).
                System.Windows.Threading.Dispatcher.CurrentDispatcher.UnhandledException += (s, e) =>
                {
                    if (IsOurs(e.Exception)) FeedbackCrashStore.Write(FeedbackCrashStore.DefaultDir(), e.Exception, BuildInfo.Version, _revitYear, null, DateTimeOffset.UtcNow);
                };
            }
            catch (Exception) { }
            try { application.Idling += OfferOnce; } catch (Exception) { }
        }

        /// <summary>Хэрэгсэл өөрөө барьсан ч мэдээлэх ёстой алдаа (ж: арын ажил унасан) — зөвхөн локал бүртгэл.</summary>
        public static void Record(Exception ex, string toolId)
        {
            if (ex == null) return;
            FeedbackCrashStore.Write(FeedbackCrashStore.DefaultDir(), ex, BuildInfo.Version, _revitYear, toolId, DateTimeOffset.UtcNow);
        }

        private static bool IsOurs(Exception ex) =>
            ex != null && (ex.StackTrace ?? string.Empty).IndexOf("RevitMcpAddin.", StringComparison.Ordinal) >= 0;

        /// <summary>Revit бүрэн ачаалагдсаны дараах ЭХНИЙ Idling — өмнөх алдаа байвал нэг удаа санал болгоно.</summary>
        private static void OfferOnce(object sender, IdlingEventArgs e)
        {
            try { if (_app != null) _app.Idling -= OfferOnce; } catch (Exception) { }
            try
            {
                if (BatchQto.IsBatch) return;   // шөнийн багцын хостод хэзээ ч цонх гаргахгүй
                List<FeedbackCrashStore.CrashRecord> pending = FeedbackCrashStore.Pending(FeedbackCrashStore.DefaultDir(), DateTimeOffset.UtcNow);
                if (pending.Count == 0) return;
                FeedbackCrashStore.CrashRecord last = pending[0];
                var td = new TaskDialog("MGL — Санал хүсэлт")
                {
                    MainInstruction = "Өмнөх удаа MGL add-in-д алдаа гарсан байна",
                    MainContent = (last.Error?.Type ?? "Алдаа") + ": " + (last.Error?.Message ?? "") + "\n\nПрограм хариуцагчид мэдэгдвэл засахад тусална.  Юу илгээгдэхийг цонхонд харж, хасаж болно.",
                    CommonButtons = TaskDialogCommonButtons.Close,
                };
                td.AddCommandLink(TaskDialogCommandLinkId.CommandLink1, "Санал хүсэлт нээх", "Алдааны мэдээлэл урьдчилан бөглөгдөнө");
                td.AddCommandLink(TaskDialogCommandLinkId.CommandLink2, "Дахиж бүү асуу", "Энэ алдааг мартах");
                TaskDialogResult r = td.Show();
                if (r == TaskDialogResult.CommandLink1)
                {
                    foreach (FeedbackCrashStore.CrashRecord c in pending) FeedbackCrashStore.MarkHandled(c);
                    var app = sender as UIApplication;
                    DiagnosticsInput d = FeedbackDiagnosticsCollector.Collect(app, last.ToolId, "crash (өмнөх нээлт)");
                    d.Error = last.Error;
                    FeedbackCommand.OpenWith(new FeedbackContext
                    {
                        ToolId = last.ToolId,
                        Stage = "crash (өмнөх нээлт " + last.At + ")",
                        Diagnostics = d,
                        SuggestedTitle = "Add-in алдаа: " + (last.Error?.Type ?? "") ,
                        SuggestedDescription = "Өмнөх удаа Revit-д MGL add-in алдаа гаргасан.  Юу хийж байхад гарсан бэ: ",
                    });
                }
                else if (r == TaskDialogResult.CommandLink2)
                {
                    foreach (FeedbackCrashStore.CrashRecord c in pending) FeedbackCrashStore.MarkHandled(c);
                }
            }
            catch (Exception ex)
            {
                FeedbackService.Log("crash offer failed: " + ex.Message);
            }
        }
    }
}
