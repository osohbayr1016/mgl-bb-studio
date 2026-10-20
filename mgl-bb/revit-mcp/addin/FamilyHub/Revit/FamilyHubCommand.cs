using System;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using RevitMcpAddin.FamilyHub.Core;
using RevitMcpAddin.FamilyHub.Providers;
using RevitMcpAddin.FamilyHub.Ui;

namespace RevitMcpAddin.FamilyHub.Revit
{
    /// <summary>
    /// «Family Hub» товч — модальгүй цонхыг нээнэ (нэг л instance).  Revit-ийн
    /// API-д хүрэх бүх зам `FamilyHubExternalEvent`-ээр; цонх өөрөө Revit-ийн
    /// төрөл дуудахгүй.
    /// </summary>
    [Transaction(TransactionMode.Manual)]
    public class FamilyHubCommand : IExternalCommand
    {
        private static FamilyHubWindow _window;
        private static FamilyHubSession _session;

        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            // ⚠️ ЛИЦЕНЗ (1.9.0): зөвхөн компанийн бүртгэлээр, ажлын компьютер дээр — Licensing/LicenseGate.cs.
            if (!global::RevitMcpAddin.Licensing.LicenseGate.Ensure()) return Result.Cancelled;
            try
            {
                UIApplication uiapp = commandData.Application;
                App.RememberMainWindow(uiapp.MainWindowHandle);
                FamilyHubExternalEvent.Ensure();
                if (_session == null) _session = FamilyHubSession.Create(uiapp);

                if (_window == null || !_window.IsLoaded)
                {
                    _window = new FamilyHubWindow(_session);
                    try
                    {
                        if (App.MainWindowHandle != IntPtr.Zero)
                            new System.Windows.Interop.WindowInteropHelper(_window).Owner = App.MainWindowHandle;
                    }
                    catch { }
                    _window.Closed += (s, e) => { _window = null; };
                    _window.Show();
                }
                else
                {
                    _window.Activate();
                }
                return Result.Succeeded;
            }
            catch (Exception ex)
            {
                message = ex.Message;
                return Result.Failed;
            }
        }
    }

    /// <summary>Нэг Revit сессийн Family Hub-ийн бүрдэл — нийлүүлэгчид, татагч, pipeline.</summary>
    public sealed class FamilyHubSession
    {
        public FamilyProviderRegistry Providers { get; private set; }
        public IRevitGateway Revit { get; private set; }
        public SafeDownloader Downloader { get; private set; }
        public PipelineOptions Options { get; private set; }

        public static FamilyHubSession Create(UIApplication uiapp)
        {
            string ua = "MglRevitAddin-FamilyHub/" + BuildInfo.Version;
            string cacheDir = System.IO.Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MGL", "RevitMcpAddin", "FamilyHubCache");
            var providers = new FamilyProviderRegistry()
                .Add(new GitHubPublicRfaProvider(GitHubPublicRfaProvider.SourcesFromEnvironment(), null, null, cacheDir, ua))
                .Add(new BimObjectProvider());
            TempFiles.SweepStale(TimeSpan.FromHours(6));
            return new FamilyHubSession
            {
                Providers = providers,
                Revit = new RevitGateway(uiapp),
                Downloader = new SafeDownloader(null, ua),
                Options = new PipelineOptions(),
            };
        }

        public FamilyHubPipeline NewPipeline(IConflictResolver resolver)
        {
            return new FamilyHubPipeline(Revit, Downloader, resolver, Options);
        }
    }
}
