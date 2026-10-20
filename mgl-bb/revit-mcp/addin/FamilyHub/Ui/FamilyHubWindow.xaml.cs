using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media.Imaging;
using Microsoft.Web.WebView2.Core;
using RevitMcpAddin.FamilyHub.Core;
using RevitMcpAddin.FamilyHub.Providers;
using RevitMcpAddin.FamilyHub.Revit;

namespace RevitMcpAddin.FamilyHub.Ui
{
    /// <summary>Нэг үр дүнгийн мөр — UI-ийн төлөв (Revit төрөлгүй).</summary>
    public sealed class FamilyRow : INotifyPropertyChanged
    {
        public FamilyProduct Product { get; set; }
        public string ProviderName { get; set; }
        public string Title { get { return Product.Name; } }
        public string Subtitle
        {
            get
            {
                string s = Product.Manufacturer ?? "";
                if (!string.IsNullOrEmpty(Product.Category)) s += (s.Length > 0 ? " · " : "") + Product.Category;
                return s;
            }
        }
        public string Meta
        {
            get
            {
                string m = ProviderName;
                m += " · Revit: " + RevitCompatibilityCheck.DisplayLabel(Compatibility);
                if (SavedVersion.HasValue) m += " (файл: " + SavedVersion + ")";
                if (Product.SizeBytes.HasValue && Product.SizeBytes > 0) m += " · " + (Product.SizeBytes.Value / 1024) + " KB";
                return m;
            }
        }
        public string Initial { get { return string.IsNullOrEmpty(Product.Name) ? "?" : Product.Name.Substring(0, 1).ToUpperInvariant(); } }
        public BitmapImage Thumbnail { get; set; }

        public RevitCompatibility Compatibility { get; set; } = RevitCompatibility.Unknown;
        public int? SavedVersion { get; set; }

        private bool _inProject;
        public bool InProject { get { return _inProject; } set { _inProject = value; Notify("InProject"); Notify("ShowAdd"); Notify("StateText"); } }
        public LoadedTarget Target { get; set; } = new LoadedTarget();

        public string StateText { get { return _inProject ? "✓ Төсөлд байгаа" : ""; } }
        public bool ShowAdd { get { return !_inProject; } }

        public string ButtonText
        {
            get
            {
                switch (Product.DownloadCapability)
                {
                    case DownloadCapability.AnonymousDirect: return "Revit-д нэмэх";
                    case DownloadCapability.AuthRequired: return "Нэвтрэх шаардлагатай";
                    default: return "Зөвхөн мэдээлэл — татахгүй";
                }
            }
        }
        public bool ButtonEnabled { get { return Product.DownloadCapability == DownloadCapability.AnonymousDirect && Compatibility != RevitCompatibility.Incompatible; } }

        public event PropertyChangedEventHandler PropertyChanged;
        public void Notify(string n) { var h = PropertyChanged; if (h != null) h(this, new PropertyChangedEventArgs(n)); }
        public void NotifyAll() { foreach (string n in new[] { "Meta", "InProject", "ShowAdd", "StateText", "ButtonText", "ButtonEnabled", "Compatibility" }) Notify(n); }
    }

    /// <summary>Байрлуулах бай — төсөлд байгаа family + төрлүүд (аль ч табаас).</summary>
    public sealed class LoadedTarget
    {
        public string Title { get; set; }
        public long FamilyId { get; set; }
        public List<long> SymbolIds { get; set; } = new List<long>();
        public List<string> SymbolNames { get; set; } = new List<string>();

        public static LoadedTarget From(string title, ExistingFamilyInfo f)
        {
            return new LoadedTarget { Title = title, FamilyId = f.FamilyId, SymbolIds = new List<long>(f.SymbolIds), SymbolNames = new List<string>(f.SymbolNames) };
        }

        public static LoadedTarget From(FileOutcome f)
        {
            return new LoadedTarget { Title = f.FamilyName, FamilyId = f.FamilyId, SymbolIds = new List<long>(f.SymbolIds), SymbolNames = new List<string>(f.SymbolNames) };
        }
    }

    public partial class FamilyHubWindow : Window, IConflictResolver, IPipelineObserver
    {
        private readonly FamilyHubSession _session;
        private readonly ObservableCollection<FamilyRow> _rows = new ObservableCollection<FamilyRow>();
        private CancellationTokenSource _cts;
        private TaskCompletionSource<ConflictDecision> _conflictTcs;
        private LoadedTarget _lastTarget;
        private LoadedTarget _webTarget;
        private bool _busy;
        private bool _webReady;
        private bool _webInitStarted;

        public FamilyHubWindow(FamilyHubSession session)
        {
            _session = session;
            InitializeComponent();
            // Хэмжээ/байрлал: Revit-ийн дэлгэцийн ажлын талбарт багтаана, хил хадгалагдана.  (Цонхны өөрийн цайвар загварыг хэвээр
            // үлдээв — BIMobject-ийн вэб агуулга ямар ч сэдэвт цагаан; сэдвийг дагуулах нь тусдаа шийдвэр.)
            global::RevitMcpAddin.Ui.MglWindow.Adopt(this, "family-hub");
            Results.ItemsSource = _rows;
            ProviderBox.Items.Add("Бүх нээлттэй эх");
            foreach (IFamilyProvider p in _session.Providers.Providers)
                if (p.Capabilities.SupportsAnonymousSearch) ProviderBox.Items.Add(p.DisplayName);
            ProviderBox.SelectedIndex = 0;
            Loaded += (s, e) => { _ = InitWebAsync(); _ = RunSearchAsync(); };
        }

        /* ═══════════════════════ BIMobject — WebView2 ═══════════════════════ */

        private static string WebProfileDir
        {
            get
            {
                // ⚠️ UserDataFolder ЗААВАЛ бичих эрхтэй газар — өгөгдмөл нь exe-ийн хажууд
                //    (Program Files\Autodesk\Revit 2027) тул WebView2 эхэлж чадахгүй.
                return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "MGL", "RevitMcpAddin", "WebView2Profile");
            }
        }

        private async Task InitWebAsync()
        {
            if (_webInitStarted) return;
            _webInitStarted = true;
            WebInitOverlay.Visibility = Visibility.Visible;
            WebRetryBtn.Visibility = Visibility.Collapsed;
            WebInitText.Text = "Хөтөч эхэлж байна…";
            try
            {
                Directory.CreateDirectory(WebProfileDir);
                CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, WebProfileDir);
                await BimWeb.EnsureCoreWebView2Async(env);
                CoreWebView2 core = BimWeb.CoreWebView2;
                core.Settings.IsStatusBarEnabled = false;
                core.Settings.AreDevToolsEnabled = false;
                core.Settings.AreDefaultContextMenusEnabled = true;
                core.DownloadStarting += Web_DownloadStarting;
                core.NewWindowRequested += (s, e) =>
                {
                    // Шинэ цонх нээхгүй — ижил табд.  Татах холбоос (target=_blank) ч
                    // үүгээр орж ирээд DownloadStarting-д баригдана.
                    e.Handled = true;
                    try { core.Navigate(e.Uri); } catch { }
                };
                core.SourceChanged += (s, e) =>
                {
                    WebUrl.Text = core.Source;
                    _ = UpdateWebBannerAsync(core.Source);
                };
                core.Navigate(BimObjectProvider.BrowserHomeUrl);
                _webReady = true;
                WebInitOverlay.Visibility = Visibility.Collapsed;
            }
            catch (Exception ex)
            {
                _webInitStarted = false;
                WebInitText.Text = "WebView2 эхлүүлж чадсангүй: " + ex.Message
                    + "\n\nMicrosoft Edge WebView2 Runtime суусан эсэхийг шалгана уу (Windows 11-д өгөгдмөл суусан байдаг).";
                WebRetryBtn.Visibility = Visibility.Visible;
            }
        }

        private void WebRetry_Click(object sender, RoutedEventArgs e) { _ = InitWebAsync(); }
        private void WebBack_Click(object sender, RoutedEventArgs e) { if (_webReady && BimWeb.CanGoBack) BimWeb.GoBack(); }
        private void WebForward_Click(object sender, RoutedEventArgs e) { if (_webReady && BimWeb.CanGoForward) BimWeb.GoForward(); }
        private void WebReload_Click(object sender, RoutedEventArgs e) { if (_webReady) BimWeb.Reload(); }
        private void WebHome_Click(object sender, RoutedEventArgs e) { if (_webReady) BimWeb.CoreWebView2.Navigate(BimObjectProvider.BrowserHomeUrl); }

        private void WebUrl_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key != Key.Enter || !_webReady) return;
            string u = (WebUrl.Text ?? "").Trim();
            if (u.Length == 0) return;
            if (!u.StartsWith("http://", StringComparison.OrdinalIgnoreCase) && !u.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) u = "https://" + u;
            try { BimWeb.CoreWebView2.Navigate(u); } catch (Exception ex) { SetBusy(false, "Хаяг буруу: " + ex.Message); }
        }

        private void Tabs_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (!ReferenceEquals(e.Source, Tabs)) return;
            if (Tabs.SelectedIndex == 0 && !_webInitStarted) _ = InitWebAsync();
        }

        /// <summary>
        /// Хөтөч татаж эхлэв — Downloads биш ТҮР хавтас руу, өгөгдмөл татах UI-гүй.
        /// Хост/Content-Type шалгалт байхгүй (хөтөч өөрөө татсан); магик байт, ZIP,
        /// exe, хэмжээ, хувилбар, давхардал бүгд pipeline-д.
        /// </summary>
        private void Web_DownloadStarting(object sender, CoreWebView2DownloadStartingEventArgs e)
        {
            CoreWebView2DownloadOperation op = e.DownloadOperation;
            string proposed = Path.GetFileName(e.ResultFilePath ?? "");
            string name = TempFiles.SafeFileName(string.IsNullOrEmpty(proposed) ? LastSegment(op.Uri) : proposed);
            string ext = Path.GetExtension(name).ToLowerInvariant();
            e.Handled = true;

            if (_busy)
            {
                e.Cancel = true;
                SetBusy(true, "Өмнөх үйлдэл дуусаагүй — " + name + " татахыг цуцлав");
                return;
            }
            if (!op.Uri.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                e.Cancel = true;
                SetBusy(false, "Зөвхөн HTTPS татна: " + op.Uri);
                return;
            }
            if (ext != ".rfa" && ext != ".zip")
            {
                e.Cancel = true;
                SetBusy(false, "«" + name + "» — Family Hub зөвхөн .rfa / .zip (доторх .rfa) авна. Энэ форматыг Revit-д ачаалахгүй.");
                return;
            }
            if (op.TotalBytesToReceive.HasValue && (long)op.TotalBytesToReceive.Value > _session.Options.MaxBytes)
            {
                e.Cancel = true;
                SetBusy(false, "«" + name + "» хэт том (" + (op.TotalBytesToReceive.Value / 1024 / 1024) + " MB > " + (_session.Options.MaxBytes / 1024 / 1024) + " MB)");
                return;
            }

            string dir = TempFiles.NewSessionDir(_session.Options.TempRoot);
            string dest = Path.Combine(dir, name);
            e.ResultFilePath = dest;

            string pageUrl = _webReady ? BimWeb.CoreWebView2.Source : null;
            FamilyProduct product = BimObjectProvider.ProductFromBrowserDownload(pageUrl, op.Uri, name);

            SetBusy(true, "Downloading… " + name);
            CancelBtn.Visibility = Visibility.Visible;
            _cts = new CancellationTokenSource();
            _cts.Token.Register(() => { try { Dispatcher.BeginInvoke(new Action(() => { try { op.Cancel(); } catch { } })); } catch { } });

            op.BytesReceivedChanged += (s, a) =>
            {
                long got = (long)op.BytesReceived;
                if (got > _session.Options.MaxBytes) { try { op.Cancel(); } catch { } return; }
                string total = op.TotalBytesToReceive.HasValue ? " / " + (op.TotalBytesToReceive.Value / 1024) + " KB" : "";
                StatusText.Text = "Downloading… " + name + "  " + (got / 1024) + " KB" + total;
            };
            op.StateChanged += async (s, a) =>
            {
                if (op.State == CoreWebView2DownloadState.InProgress) return;
                if (op.State == CoreWebView2DownloadState.Completed)
                {
                    await RunDownloadedAsync(product, dest);
                }
                else
                {
                    CancelBtn.Visibility = Visibility.Collapsed;
                    _cts = null;
                    TempFiles.TryDeleteDir(dir);
                    SetBusy(false, "Татах тасарлаа: " + op.InterruptReason + " (" + name + ")");
                }
            };
        }

        private async Task RunDownloadedAsync(FamilyProduct product, string filePath)
        {
            PipelineResult result;
            try
            {
                FamilyHubPipeline pipeline = _session.NewPipeline(this);
                CancellationToken ct = _cts != null ? _cts.Token : CancellationToken.None;
                result = await Task.Run(() => pipeline.AddDownloadedAsync(product, filePath, this, ct));
            }
            catch (Exception ex)
            {
                result = new PipelineResult { Status = PipelineStatus.Failed, Message = ex.Message };
            }
            CancelBtn.Visibility = Visibility.Collapsed;
            _cts = null;

            FileOutcome primary = PrimaryOutcome(result);
            if (primary != null) _webTarget = LoadedTarget.From(primary);
            SetBusy(false, Summarize(result));
            _ = UpdateWebBannerAsync(_webReady ? BimWeb.CoreWebView2.Source : null);

            if (result.Status == PipelineStatus.Ok && primary != null)
            {
                ShowTypes(_webTarget, primary.Status == FileOutcomeStatus.Loaded ? "Family ачаалагдлаа: " + primary.FamilyName : primary.Message);
                await PlaceAsync(_webTarget, _webTarget.SymbolIds.Count > 0 ? _webTarget.SymbolIds[0] : (long?)null);
            }
            else if (result.Status == PipelineStatus.AlreadyInProject && primary != null)
            {
                ShowTypes(_webTarget, "✓ Төсөлд байгаа: " + primary.FamilyName);
            }
        }

        /// <summary>Бүтээгдэхүүний хуудас дээр байхад «✓ Төсөлд байгаа + Байрлуулах» — татахгүйгээр.</summary>
        private async Task UpdateWebBannerAsync(string pageUrl)
        {
            string locale, brand, slug;
            if (!BimObjectProvider.TryParseProductUrl(pageUrl, out locale, out brand, out slug))
            {
                WebPlaceBtn.Visibility = Visibility.Collapsed;
                WebBannerText.Text = "BIMobject-ийн сайт жинхэнэ хөтчөөр нээгдэнэ. Өөрийн бүртгэлээр нэвтэрч, бүтээгдэхүүний «Download» товчийг дарахад файл шууд Revit руу орно (шалгалт → давхардал → ачаалах → байрлуулах). Downloads хавтсанд юу ч үлдэхгүй.";
                return;
            }
            try
            {
                var probe = new FamilyProduct { ProviderId = BimObjectProvider.Id, ExternalId = brand + "/" + slug };
                if (!await _session.Revit.HasProjectDocumentAsync(CancellationToken.None)) return;
                FamilyHubRegistry reg = await _session.Revit.LoadRegistryAsync(CancellationToken.None);
                List<FamilyHubRegistryEntry> entries = FamilyHubPipeline.EntriesForProduct(reg, probe);
                foreach (FamilyHubRegistryEntry en in entries)
                {
                    ExistingFamilyInfo fam = await _session.Revit.FindFamilyByIdAsync(en.RevitFamilyId, CancellationToken.None);
                    if (fam == null) continue;
                    _webTarget = LoadedTarget.From(fam.Name, fam);
                    WebBannerText.Text = "✓ Төсөлд байгаа: «" + fam.Name + "» энэ бүтээгдэхүүнээс аль хэдийн ачаалагдсан — дахин татах шаардлагагүй.";
                    WebPlaceBtn.Visibility = Visibility.Visible;
                    return;
                }
                WebPlaceBtn.Visibility = Visibility.Collapsed;
                WebBannerText.Text = "Бүтээгдэхүүн: " + brand + " / " + slug + " — «Download» дарж Revit форматыг сонгоход шууд ачаалагдана.";
            }
            catch
            {
                WebPlaceBtn.Visibility = Visibility.Collapsed;
            }
        }

        private async void WebPlace_Click(object sender, RoutedEventArgs e)
        {
            if (_webTarget == null) return;
            ShowTypes(_webTarget, "✓ Төсөлд байгаа: " + _webTarget.Title);
            await PlaceAsync(_webTarget, _webTarget.SymbolIds.Count > 0 ? _webTarget.SymbolIds[0] : (long?)null);
        }

        /* ═══════════════════════ Нийтийн сан — хайлт ═══════════════════════ */

        private void SearchBox_TextChanged(object sender, TextChangedEventArgs e)
        {
            SearchHint.Visibility = string.IsNullOrEmpty(SearchBox.Text) ? Visibility.Visible : Visibility.Collapsed;
        }

        private void SearchBox_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Enter) _ = RunSearchAsync();
        }

        private void Search_Click(object sender, RoutedEventArgs e) { _ = RunSearchAsync(); }

        private IEnumerable<IFamilyProvider> SelectedProviders()
        {
            var searchable = new List<IFamilyProvider>();
            foreach (IFamilyProvider p in _session.Providers.Providers)
                if (p.Capabilities.SupportsAnonymousSearch) searchable.Add(p);
            int i = ProviderBox.SelectedIndex;
            if (i <= 0 || i > searchable.Count) return searchable;
            return new[] { searchable[i - 1] };
        }

        private async Task RunSearchAsync()
        {
            if (_busy) return;
            SetBusy(true, "Хайж байна…");
            _rows.Clear();
            HideConflict();
            TypesPanel.Visibility = Visibility.Collapsed;
            var notices = new List<string>();
            var query = new FamilySearchQuery { Text = SearchBox.Text, Limit = 100 };
            var providers = new List<IFamilyProvider>(SelectedProviders());
            try
            {
                using (var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30)))
                {
                    foreach (IFamilyProvider p in providers)
                    {
                        SearchResult r;
                        try { r = await Task.Run(() => p.SearchAsync(query, cts.Token)); }
                        catch (Exception ex) { notices.Add(p.DisplayName + ": " + ex.Message); continue; }
                        if (!string.IsNullOrEmpty(r.Notice)) notices.Add(r.Notice);
                        foreach (FamilyProduct fp in r.Items)
                        {
                            var row = new FamilyRow { Product = fp, ProviderName = p.DisplayName };
                            row.Compatibility = RevitCompatibilityCheck.FromProviderMetadata(fp.RevitVersions, _session.Revit.RevitVersion);
                            _rows.Add(row);
                        }
                    }
                    await MarkInProjectAsync(cts.Token);
                }
                NoticeText.Text = string.Join("\n", notices);
                NoticeBorder.Visibility = notices.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
                SetBusy(false, _rows.Count + " үр дүн.");
            }
            catch (Exception ex)
            {
                SetBusy(false, "Хайлт амжилтгүй: " + ex.Message);
            }
        }

        private async Task MarkInProjectAsync(CancellationToken ct)
        {
            if (!await _session.Revit.HasProjectDocumentAsync(ct)) return;
            FamilyHubRegistry reg = await _session.Revit.LoadRegistryAsync(ct);
            foreach (FamilyRow row in _rows)
            {
                List<FamilyHubRegistryEntry> entries = FamilyHubPipeline.EntriesForProduct(reg, row.Product);
                if (entries.Count == 0) continue;
                ExistingFamilyInfo fam = await _session.Revit.FindFamilyByIdAsync(entries[0].RevitFamilyId, ct);
                if (fam == null) continue;
                row.Target = LoadedTarget.From(row.Product.Name, fam);
                row.InProject = true;
                row.NotifyAll();
            }
        }

        private async void Add_Click(object sender, RoutedEventArgs e)
        {
            var row = (sender as FrameworkElement)?.Tag as FamilyRow;
            if (row == null || _busy) return;
            IFamilyProvider provider = _session.Providers.Get(row.Product.ProviderId);
            if (provider == null) return;

            _cts = new CancellationTokenSource();
            SetBusy(true, "Эхэлж байна…");
            CancelBtn.Visibility = Visibility.Visible;
            HideConflict();
            TypesPanel.Visibility = Visibility.Collapsed;
            PipelineResult result;
            try
            {
                FamilyHubPipeline pipeline = _session.NewPipeline(this);
                CancellationToken ct = _cts.Token;
                result = await Task.Run(() => pipeline.AddToRevitAsync(provider, row.Product, this, ct));
            }
            catch (Exception ex)
            {
                result = new PipelineResult { Status = PipelineStatus.Failed, Message = ex.Message };
            }
            CancelBtn.Visibility = Visibility.Collapsed;
            _cts = null;

            FileOutcome primary = PrimaryOutcome(result);
            if (primary != null)
            {
                row.Target = LoadedTarget.From(primary);
                row.Compatibility = primary.Compatibility;
                row.SavedVersion = primary.SavedRevitVersion;
                row.InProject = true;
                row.NotifyAll();
            }
            else if (result.Files.Count > 0)
            {
                row.Compatibility = result.Files[0].Compatibility;
                row.SavedVersion = result.Files[0].SavedRevitVersion;
                row.NotifyAll();
            }
            SetBusy(false, Summarize(result));

            if (result.Status == PipelineStatus.Ok && primary != null)
            {
                ShowTypes(row.Target, primary.Status == FileOutcomeStatus.Loaded ? "Family ачаалагдлаа: " + primary.FamilyName : primary.Message);
                await PlaceAsync(row.Target, row.Target.SymbolIds.Count > 0 ? row.Target.SymbolIds[0] : (long?)null);
            }
            else if (result.Status == PipelineStatus.AlreadyInProject && primary != null)
            {
                ShowTypes(row.Target, "✓ Төсөлд байгаа: " + primary.FamilyName);
            }
        }

        private static FileOutcome PrimaryOutcome(PipelineResult result)
        {
            foreach (FileOutcome f in result.Files)
            {
                if (f.Status == FileOutcomeStatus.Loaded || f.Status == FileOutcomeStatus.MappedByHash ||
                    f.Status == FileOutcomeStatus.UsedExisting || f.Status == FileOutcomeStatus.AlreadyInProject)
                    return f;
            }
            return null;
        }

        private static string Summarize(PipelineResult result)
        {
            string summary = result.Message;
            int loaded = 0, skipped = 0;
            foreach (FileOutcome f in result.Files)
            {
                if (f.Status == FileOutcomeStatus.Loaded) loaded++;
                if (f.Status == FileOutcomeStatus.SkippedVariant) skipped++;
            }
            if (loaded > 1) summary += " (" + loaded + " family)";
            if (skipped > 0) summary += " · " + skipped + " өөр хувилбарын хуулбарыг алгасав";
            if (!result.TempCleaned) summary += " ⚠️ түр файл цэвэрлэгдээгүй";
            return summary;
        }

        private void ShowTypes(LoadedTarget target, string title)
        {
            _lastTarget = target;
            TypesTitle.Text = title;
            TypesList.Items.Clear();
            foreach (string n in target.SymbolNames) TypesList.Items.Add(n);
            if (TypesList.Items.Count > 0) TypesList.SelectedIndex = 0;
            TypesPanel.Visibility = Visibility.Visible;
        }

        /* ═══════════════════════ PLACE ═══════════════════════ */

        private async void Place_Click(object sender, RoutedEventArgs e)
        {
            var row = (sender as FrameworkElement)?.Tag as FamilyRow;
            if (row == null || !row.InProject) return;
            ShowTypes(row.Target, "✓ Төсөлд байгаа: " + row.Product.Name);
            await PlaceAsync(row.Target, row.Target.SymbolIds.Count > 0 ? row.Target.SymbolIds[0] : (long?)null);
        }

        private async void PlaceType_Click(object sender, RoutedEventArgs e)
        {
            if (_lastTarget == null) return;
            int i = TypesList.SelectedIndex;
            long? sym = i >= 0 && i < _lastTarget.SymbolIds.Count ? _lastTarget.SymbolIds[i] : (long?)null;
            await PlaceAsync(_lastTarget, sym);
        }

        private async Task PlaceAsync(LoadedTarget target, long? symbolId)
        {
            if (_busy || target == null) return;
            SetBusy(true, "Байрлуулахад бэлэн ✓ — Revit дээр байрлуулна уу (Esc = дуусгах)…");
            try
            {
                PlacementOutcome o = await _session.Revit.PlaceAsync(target.FamilyId, symbolId, CancellationToken.None);
                string t = o.SymbolName != null ? " [" + o.SymbolName + "]" : "";
                SetBusy(false, o.Message + t);
            }
            catch (Exception ex)
            {
                SetBusy(false, "Байрлуулалт: " + ex.Message);
            }
        }

        /* ═══════════════════════ цуцлах / зөрчил / төлөв ═══════════════════════ */

        private void Cancel_Click(object sender, RoutedEventArgs e)
        {
            try { _cts?.Cancel(); } catch { }
            if (_conflictTcs != null) _conflictTcs.TrySetResult(ConflictDecision.Cancel);
        }

        public Task<ConflictDecision> ResolveNameConflictAsync(NameConflict conflict, CancellationToken ct)
        {
            var tcs = new TaskCompletionSource<ConflictDecision>(TaskCreationOptions.RunContinuationsAsynchronously);
            ct.Register(() => tcs.TrySetResult(ConflictDecision.Cancel));
            Dispatcher.Invoke(() =>
            {
                _conflictTcs = tcs;
                ConflictText.Text =
                    "«" + conflict.FamilyName + "» нэртэй family төсөлд аль хэдийн бий (" + (conflict.Existing.Category ?? "?") + ", "
                    + conflict.Existing.SymbolNames.Count + " төрөл), гэвч файл нь ӨӨР (SHA-256 таарахгүй, нийлүүлэгчийн бүртгэлд байхгүй).\n"
                    + "Автоматаар нэр өөрчлөхгүй, дарж бичихгүй.  Одоо байгааг ашиглах уу?";
                ConflictPanel.Visibility = Visibility.Visible;
            });
            return tcs.Task;
        }

        private void ConflictUseExisting_Click(object sender, RoutedEventArgs e)
        {
            HideConflict();
            _conflictTcs?.TrySetResult(ConflictDecision.UseExisting);
        }

        private void ConflictCancel_Click(object sender, RoutedEventArgs e)
        {
            HideConflict();
            _conflictTcs?.TrySetResult(ConflictDecision.Cancel);
        }

        private void HideConflict()
        {
            ConflictPanel.Visibility = Visibility.Collapsed;
            _conflictTcs = null;
        }

        public void Report(PipelineStage stage, string message)
        {
            Dispatcher.BeginInvoke(new Action(() =>
            {
                string prefix;
                switch (stage)
                {
                    case PipelineStage.Checking: prefix = "Checking duplicates… "; break;
                    case PipelineStage.Downloading: prefix = "Downloading… "; break;
                    case PipelineStage.Validating: prefix = "Validating… "; break;
                    case PipelineStage.Deduplicating: prefix = "Checking duplicates… "; break;
                    case PipelineStage.Loading: prefix = "Loading… "; break;
                    default: prefix = ""; break;
                }
                StatusText.Text = prefix + message;
            }));
        }

        private void SetBusy(bool busy, string text)
        {
            _busy = busy;
            StatusText.Text = text;
            Progress.Visibility = busy ? Visibility.Visible : Visibility.Collapsed;
            SearchBtn.IsEnabled = !busy;
        }

        private static string LastSegment(string url)
        {
            try
            {
                var u = new Uri(url);
                string p = u.AbsolutePath;
                int i = p.LastIndexOf('/');
                return Uri.UnescapeDataString(i >= 0 ? p.Substring(i + 1) : p);
            }
            catch { return "family.rfa"; }
        }

        protected override void OnClosed(EventArgs e)
        {
            try { _cts?.Cancel(); } catch { }
            try { BimWeb?.Dispose(); } catch { }
            base.OnClosed(e);
        }
    }
}
