using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;

namespace RevitMcpAddin
{
    /// <summary>
    /// Бүртгэл ба ERP төсөл: нэвтрэх, ажиллах төслөө сонгох.  Серверийн хаяг, link файл хамруулах нь
    /// «Нарийвчилсан тохиргоо»-д.  Нууц үг хэзээ ч диск дээр хадгалагдахгүй.
    ///
    /// ⚠️ 2026-10-03: `Task.Run(...).GetAwaiter().GetResult()` БҮРЭН АРИЛСАН (өмнө нь нэвтрэх, жагсаалт
    /// шинэчлэх нь диалогийн thread-ийг ≈480 с хүртэл гацаадаг, цуцлах, явц байгаагүй).  Одоо:
    ///   • бүх сүлжээний дуудлага `await` — цонх хариу өгсөөр, ажиллаж буй үед хүлээлтийн заагч + төлөв;
    ///   • нэвтрэлт давхар явахгүй (`_loggingIn`), шинэ хүсэлт хуучныг ХҮЧИНГҮЙ болгоно — нэг `RequestGuard _guard`
    ///     (`Ui/Core/RequestGuard.cs`, `tests/MglUi.Tests`-д тестлэгдсэн) ЭХ ГАРАЛТЫГ ганц газар хөтөлнө:
    ///   • серверийн хаяг солигдвол өмнө явж буй хүсэлтийн үр дүн хаягдана (guard-ийн epoch) — шинэ хаяг дээр хуучин
    ///     хариу бичигдэхгүй;
    ///   • хуучин токентой хүсэлтийн хоцорсон 401 нь ШИНЭ нэвтрэлтийг арилгахгүй (guard-ийн `LateUnauthorized`);
    ///   • цонх хаагдахад цуцлах дохио + үр дүн хаягдана (guard-ийн `Close`).
    /// `LicenseDialog` (аль хэдийн зөв async, `_cts`/`_busy`/`IsLoaded` хамгаалалттай) загварыг дагасан.
    /// </summary>
    public partial class SettingsDialog : Window
    {
        private enum Tone { Muted, Ok, Danger }

        private string _token;
        private bool _loggingIn;
        private bool _loadingProjects;
        // Хоцорсон хариу, хаяг солигдох, цонх хаагдах дүрэм — `Ui/Core/RequestGuard.cs` (macOS дээр тестлэгдсэн).
        private readonly Ui.Core.RequestGuard _guard = new Ui.Core.RequestGuard();
        private readonly CancellationTokenSource _cts = new CancellationTokenSource();
        // Салбарын сонголтыг кодоор тавьж байх үед Checked/Unchecked үйл явдлыг хадгалахгүй.
        private bool _ribbonLoading;
        private readonly Dictionary<Ui.Core.ToolDiscipline, CheckBox> _ribbonBoxes = new Dictionary<Ui.Core.ToolDiscipline, CheckBox>();

        public SettingsDialog()
        {
            InitializeComponent();
            Ui.MglWindow.Setup(this, Title, 520, 0, 460, 0, sizeToContentHeight: true, resizable: false);
            Ui.MglTheme.Apply(this);
            Ui.MglUi.Primary(SaveBtn);
            Ui.MglAuto.LabelFor(UserLabel, UserBox);
            Ui.MglAuto.LabelFor(PassLabel, PassBox);
            Ui.MglAuto.LabelFor(HostLabel, HostBox);
            Ui.MglAuto.Name(ProjectCombo, "ERP төсөл", "Ажиллах төслөө жагсаалтаас сонгоно");
            Ui.MglAuto.Name(LoadProjectsBtn, "Төслийн жагсаалт шинэчлэх", "Серверээс төслүүдийн жагсаалтыг дахин татна");

            AddinSettings settings = SettingsStore.Load();
            HostBox.Text = string.IsNullOrWhiteSpace(settings.ApiHost)
                ? AddinSettings.DefaultApiHost
                : settings.ApiHost;
            UserBox.Text = settings.Username ?? string.Empty;
            IncludeLinksBox.IsChecked = settings.IncludeLinks;

            if (!string.IsNullOrEmpty(settings.Token))
            {
                _token = settings.Token;
                if (settings.ProjectId != null)
                {
                    // Жагсаалт ачаалагдаагүй байхад хадгалсан төслөө шууд сонгогдсоноор харуулна.
                    var saved = new ProjectInfo
                    {
                        Id = settings.ProjectId.Value,
                        Name = string.IsNullOrEmpty(settings.ProjectName)
                            ? "Төсөл #" + settings.ProjectId.Value
                            : settings.ProjectName,
                    };
                    ProjectCombo.ItemsSource = new List<ProjectInfo> { saved };
                    ProjectCombo.SelectedIndex = 0;
                }
            }

            RenderAccount(settings.Username);
            UpdateButtons();
            InitRibbonSection();

            // Серверийн хаяг солигдвол өмнөх хүсэлтийн үр дүн (өөр сервер) хүчингүй.
            HostBox.TextChanged += (s, e) =>
            {
                _guard.InvalidateInFlight();
                if (!string.IsNullOrEmpty(_token))
                    SetProjectStatus("Серверийн хаяг өөрчлөгдсөн — «Жагсаалт шинэчлэх»-ээр төслүүдийг дахин ачаална уу.", Tone.Muted);
            };
            Closed += (s, e) =>
            {
                Ui.Revit.RibbonDisciplines.Changed -= RenderRibbonSection;
                _guard.Close();
                try { _cts.Cancel(); } catch { /* аль хэдийн dispose */ }
            };

            // ⚠️ ЖАГСААЛТЫГ ӨӨРӨӨ ТАТНА — хадгалсан ганц төсөл нь сервертэй холбоогүй локал өгөгдөл
            // (2026-08-25-ны «эдгээр нь миний компьютер дээрх төслүүд юм уу?» гэсэн бодит гомдол).
            Loaded += (s, e) =>
            {
                LoadProjectsSoon();
                RefreshErpTeamsSoon();
            };
        }

        // ── Хүсэлтийн хамгаалалт ────────────────────────────────────────

        /// <summary>Хариу ОДОО ч хүчинтэй юу — `RequestGuard`.</summary>
        private bool Accept(int requestId, int epoch)
        {
            return _guard.Accept(requestId, epoch);
        }

        private int BeginRequest()
        {
            return _guard.Begin();
        }

        private void EndRequest(int requestId, bool login)
        {
            if (login) _loggingIn = false; else _loadingProjects = false;
            // Хүлээлтийн заагч: ямар ч хүсэлт явж буй л бол.
            Cursor = (_loggingIn || _loadingProjects) ? Cursors.Wait : null;
            if (!_guard.IsClosed) UpdateButtons();
        }

        // ── Төсөл ачаалах ───────────────────────────────────────────────

        private async void LoadProjectsSoon()
        {
            await LoadProjectsAsync(false);
        }

        private async void LoadProjectsBtn_Click(object sender, RoutedEventArgs e)
        {
            await LoadProjectsAsync(true);
        }

        private async Task LoadProjectsAsync(bool manual)
        {
            if (string.IsNullOrEmpty(_token) || _loadingProjects || (_loggingIn && !manual)) return;

            string host = HostBox.Text.Trim();
            string tokenUsed = _token;
            int epoch = _guard.Epoch;
            int id = BeginRequest();
            _loadingProjects = true;
            Cursor = Cursors.Wait;
            UpdateButtons();
            SetProjectStatus("Төслийн жагсаалтыг ачаалж байна…", Tone.Muted);
            try
            {
                // Task.Run: ApiClient-ийн синхрон бэлтгэл (HttpClient үүсгэх, DNS) UI thread-ийг саатуулахгүй.
                List<ProjectInfo> projects =
                    await Task.Run(() => ApiClient.GetProjectsAsync(host, tokenUsed)).ConfigureAwait(true);
                if (!Accept(id, epoch)) return;
                ApplyProjects(projects);
                SetProjectStatus(
                    projects.Count == 0
                        ? "ⓘ Танд харагдах төсөл алга. Админд хандаж төсөлд нэмүүлнэ үү."
                        : "Жагсаалтад " + projects.Count + " төсөл байна. Ажиллах төслөө сонгоно уу.",
                    Tone.Muted);
            }
            catch (UnauthorizedException)
            {
                if (!Accept(id, epoch)) return;
                // Хоцорсон 401 нь ШИНЭ нэвтрэлтийг арилгаж болохгүй — зөвхөн ЯГ ЭНЭ токентой хүсэлтэд.
                if (Ui.Core.RequestGuard.ShouldClearCredential(tokenUsed, _token))
                {
                    _token = null;
                    RenderAccount(UserBox.Text.Trim());
                }
                SetProjectStatus("✖ Нэвтрэлтийн хугацаа дууссан — дахин нэвтэрнэ үү.", Tone.Danger);
            }
            catch (Exception ex)
            {
                if (!Accept(id, epoch)) return;
                // Хадгалсан ганц төсөл ХЭВЭЭР үлдэнэ — цонх ашиглагдахуйц.  Гэхдээ жагсаалт БҮРЭН БИШ гэдгийг ил хэлнэ.
                SetProjectStatus("✖ Төслийн жагсаалтыг татаж чадсангүй: " + RevitApi.FriendlyError(ex)
                    + " Хадгалсан төсөл хэвээр байна. Дахин оролдохыг «Жагсаалт шинэчлэх»-ээр.", Tone.Danger);
            }
            finally
            {
                EndRequest(id, false);
            }
        }

        // ── Нэвтрэх ─────────────────────────────────────────────────────

        private async void LoginBtn_Click(object sender, RoutedEventArgs e)
        {
            if (_loggingIn) return;   // давхар дарахаас хамгаална

            string host = HostBox.Text.Trim();
            string username = UserBox.Text.Trim();
            string password = PassBox.Password;
            if (host.Length == 0 || username.Length == 0 || password.Length == 0)
            {
                SetAccountStatus("✖ Нэвтрэх нэр, нууц үгээ бичнэ үү"
                    + (host.Length == 0 ? " (серверийн хаяг «Нарийвчилсан тохиргоо»-д хоосон байна)." : "."), Tone.Danger);
                if (host.Length == 0) AdvancedExpander.IsExpanded = true;
                return;
            }

            int epoch = _guard.Epoch;
            int id = BeginRequest();
            _loggingIn = true;
            Cursor = Cursors.Wait;
            UpdateButtons();
            SetAccountStatus("Нэвтэрч байна…", Tone.Muted);
            try
            {
                // ⚠️ 1.10.0: 365 хоногийн токен ҮҮСГЭХГҮЙ — нэвтрэх → төхөөрөмжийн түлхүүр → лиценз + 30 минутын
                //    session (`LicenseGate.SignInAsync`).  Төслийн жагсаалтыг тэр session-оор татна.
                //    Task.Run: TPM түлхүүр нээх зэрэг синхрон бэлтгэл UI thread-ийг саатуулахгүй.
                //    `ct` нь зөвхөн дараагийн 20 с-ын POST-д хүрдэг (эхний нэвтрэх алхамд токен байхгүй).
                Licensing.RefreshResult signIn = await Task.Run(() =>
                    Licensing.LicenseGate.SignInAsync(host, username, password, _cts.Token)).ConfigureAwait(true);
                if (!Accept(id, epoch)) return;
                if (signIn.Outcome != Licensing.RefreshOutcome.Ok)
                    throw new InvalidOperationException(signIn.Message ?? "Нэвтэрч чадсангүй.");

                string sessionToken = SettingsStore.Load().Token;
                List<ProjectInfo> projects =
                    await Task.Run(() => ApiClient.GetProjectsAsync(host, sessionToken)).ConfigureAwait(true);
                if (!Accept(id, epoch)) return;

                _token = sessionToken;
                PassBox.Clear();   // амжилттай нэвтэрсний дараа нууц үгийг санах ойд үлдээхгүй
                RefreshErpTeamsSoon();   // шинэ хэрэглэгчийн ERP-ийн баг → туузан цэсний салбар
                ApplyProjects(projects);
                RenderAccount(username, signIn.Info != null ? signIn.Info.Role : null);
                SetProjectStatus(
                    projects.Count == 0
                        ? "ⓘ Танд харагдах төсөл алга. Админд хандаж төсөлд нэмүүлнэ үү."
                        : "Жагсаалтад " + projects.Count + " төсөл байна. Ажиллах төслөө сонгоно уу.",
                    Tone.Muted);
            }
            catch (OperationCanceledException)
            {
                // Цонх хаагдсан — харуулах юм байхгүй.
                if (!_guard.IsClosed && Accept(id, epoch)) SetAccountStatus("Нэвтрэлт цуцлагдлаа.", Tone.Muted);
            }
            catch (Exception ex)
            {
                if (!Accept(id, epoch)) return;
                SetAccountStatus("✖ " + RevitApi.FriendlyError(ex), Tone.Danger);
            }
            finally
            {
                EndRequest(id, true);
            }
        }

        private void ProjectCombo_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            UpdateButtons();
        }

        private void SaveBtn_Click(object sender, RoutedEventArgs e)
        {
            ProjectInfo project = ProjectCombo.SelectedItem as ProjectInfo;
            if (string.IsNullOrEmpty(_token) || project == null)
                return;

            AddinSettings settings = SettingsStore.Load();
            settings.ApiHost = HostBox.Text.Trim();
            settings.Username = UserBox.Text.Trim();
            // ⚠️ Төхөөрөмжийн session идэвхтэй үед токеныг ДИСКЭНД бичихгүй (`SettingsStore.Save` ч шалгана).
            if (!Licensing.LicenseGate.HasDeviceSession()) settings.Token = _token;
            settings.ProjectId = project.Id;
            settings.ProjectName = project.Name;
            settings.IncludeLinks = IncludeLinksBox.IsChecked == true;
            SettingsStore.Save(settings);
            // Энэ компьютерын лицензийг арын дэвсгэрт шалгана (1.9.0).
            try { Licensing.LicenseGate.RefreshInBackground(force: true); } catch { }

            DialogResult = true;
        }

        private void CancelBtn_Click(object sender, RoutedEventArgs e)
        {
            DialogResult = false;
        }

        // ── Туузан цэсний салбар (2026-10-13) ───────────────────────────
        //
        // Сонголт ШУУД хэрэгжинэ (ui-prefs.json + товч нуух/харуулах) — «Хадгалах» шаардахгүй, учир нь тэр товч
        // нэвтэрч төсөл сонгоогүй үед идэвхгүй.  Дүрэм: Ui/Core/ToolDiscipline.cs, хэрэгжүүлэлт: Ui/Revit/RibbonDisciplines.cs.

        private void InitRibbonSection()
        {
            _ribbonLoading = true;
            try
            {
                foreach (Ui.Core.ToolDiscipline d in Ui.Core.ToolDisciplines.Each)
                {
                    var box = new CheckBox { Content = Ui.Core.ToolDisciplines.Label(d), Margin = new Thickness(0, 0, 0, 3) };
                    box.Checked += RibbonChoice_Changed;
                    box.Unchecked += RibbonChoice_Changed;
                    RibbonManualPanel.Children.Add(box);
                    _ribbonBoxes[d] = box;
                }
            }
            finally
            {
                _ribbonLoading = false;
            }
            Ui.Revit.RibbonDisciplines.Changed += RenderRibbonSection;
            RenderRibbonSection();
        }

        /// <summary>Хадгалсан сонголтоор радио/чагтыг тавьж, төлөвийн мөрийг бичнэ.</summary>
        private void RenderRibbonSection()
        {
            if (_guard.IsClosed) return;
            Ui.Core.RibbonPrefs prefs = Ui.Revit.RibbonDisciplines.Prefs;
            _ribbonLoading = true;
            try
            {
                Ui.Core.ToolDiscipline erp = prefs.ErpSet;
                RibbonAutoRadio.Content = erp == Ui.Core.ToolDiscipline.None
                    ? "Миний ERP-ийн багаар (баг тодорхойгүй — бүх хэрэгсэл харагдана)"
                    : "Миний ERP-ийн багаар (одоо: " + Ui.Core.ToolDisciplines.Describe(erp) + ")";

                Ui.Core.RibbonFilterMode mode = prefs.FilterMode;
                RibbonAutoRadio.IsChecked = mode == Ui.Core.RibbonFilterMode.Auto;
                RibbonManualRadio.IsChecked = mode == Ui.Core.RibbonFilterMode.Manual;
                RibbonAllRadio.IsChecked = mode == Ui.Core.RibbonFilterMode.All;

                // Гараар сонгоогүй бол ERP-ийн багийг урьдчилан чагталж өгнө — «Өөрөө сонгох» дээр дарахад хоосон эхлэхгүй.
                Ui.Core.ToolDiscipline manual = mode == Ui.Core.RibbonFilterMode.Manual || prefs.ManualSet != Ui.Core.ToolDiscipline.None
                    ? prefs.ManualSet
                    : erp;
                foreach (KeyValuePair<Ui.Core.ToolDiscipline, CheckBox> kv in _ribbonBoxes)
                {
                    kv.Value.IsChecked = (manual & kv.Key) != 0;
                    kv.Value.IsEnabled = mode == Ui.Core.RibbonFilterMode.Manual;
                }
            }
            finally
            {
                _ribbonLoading = false;
            }
            RibbonStatus.Text = RibbonStatusText(prefs);
        }

        private void RibbonChoice_Changed(object sender, RoutedEventArgs e)
        {
            if (_ribbonLoading || _guard.IsClosed) return;
            Ui.Core.RibbonFilterMode mode = RibbonManualRadio.IsChecked == true
                ? Ui.Core.RibbonFilterMode.Manual
                : RibbonAllRadio.IsChecked == true ? Ui.Core.RibbonFilterMode.All : Ui.Core.RibbonFilterMode.Auto;
            Ui.Core.ToolDiscipline manual = Ui.Core.ToolDiscipline.None;
            foreach (KeyValuePair<Ui.Core.ToolDiscipline, CheckBox> kv in _ribbonBoxes)
                if (kv.Value.IsChecked == true) manual |= kv.Key;
            try { Ui.Revit.RibbonDisciplines.SetChoice(mode, manual); }
            catch (Exception ex) { Ui.Revit.RibbonBuilder.LogFailure("Салбарын сонголт хэрэгжүүлэх", ex); }
            RenderRibbonSection();
        }

        /// <summary>
        /// «Таны салбарын самбар: … · Нуугдсан: …» — нийтлэг самбарууд үргэлж харагдах тул зөвхөн САЛБАРЫН самбаруудыг нэрлэнэ.
        /// Нуух дүрэм нь ribbon-той ЯГ ижил (`ToolDisciplines.Plan` + `RibbonPlan`).
        /// </summary>
        private static string RibbonStatusText(Ui.Core.RibbonPrefs prefs)
        {
            Ui.Core.ToolDiscipline active = prefs.Active;
            IReadOnlyList<Ui.Core.RibbonPanelPlan> plan = Ui.Core.RibbonPlan.For(Ui.Revit.RibbonBuilder.Running);
            var common = new List<string>();
            var shown = new List<string>();
            var hidden = new List<string>();
            foreach (Ui.Core.RibbonPanelPlan p in plan)
            {
                if (p.Discipline == Ui.Core.ToolDiscipline.None) common.Add(p.Title);
                else (Ui.Core.ToolDisciplines.IsPanelVisible(p, active) ? shown : hidden).Add("«" + p.Title + "»");
            }

            string lead = prefs.FilterMode == Ui.Core.RibbonFilterMode.Manual && prefs.ManualSet == Ui.Core.ToolDiscipline.None
                ? "Салбар сонгоогүй тул бүх самбар харагдана. "
                : string.Empty;
            string text = lead + "Нийтлэг самбарууд (" + string.Join(", ", common) + ") үргэлж харагдана.";
            if (shown.Count > 0) text += " Салбарын самбар: " + string.Join(", ", shown) + ".";
            if (hidden.Count > 0)
                text += " Нуугдсан: " + string.Join(", ", hidden) + " — тэдгээрийн хэрэгслийг «Хэрэгсэл хайх»-аас олж болно.";
            return text + " Сонголт шууд хэрэгжинэ.";
        }

        /// <summary>ERP-ээс ажилтны багийг арын дэвсгэрт шинэчилнэ; ирмэгц `Changed` → `RenderRibbonSection`.</summary>
        private void RefreshErpTeamsSoon()
        {
            string token = _token;
            string host = HostBox.Text.Trim();
            if (string.IsNullOrEmpty(token) || host.Length == 0) return;
            CancellationToken ct = _cts.Token;
            Task.Run(() => Ui.Revit.RibbonDisciplines.RefreshFromErpAsync(host, token, ct));
        }

        // ── Харагдац ────────────────────────────────────────────────────

        private void ApplyProjects(List<ProjectInfo> projects)
        {
            ProjectInfo current = ProjectCombo.SelectedItem as ProjectInfo;
            int? preferId = current != null ? current.Id : SettingsStore.Load().ProjectId;

            ProjectCombo.ItemsSource = projects;
            if (preferId != null)
            {
                for (int i = 0; i < projects.Count; i++)
                {
                    if (projects[i].Id == preferId.Value)
                    {
                        ProjectCombo.SelectedIndex = i;
                        return;
                    }
                }
            }
            if (projects.Count == 1)
                ProjectCombo.SelectedIndex = 0;
        }

        private void UpdateButtons()
        {
            bool signedIn = !string.IsNullOrEmpty(_token);
            bool busy = _loggingIn || _loadingProjects;
            LoginBtn.IsEnabled = !_loggingIn;
            LoadProjectsBtn.IsEnabled = signedIn && !busy;
            bool hasProject = ProjectCombo.SelectedItem is ProjectInfo;
            SaveBtn.IsEnabled = signedIn && hasProject && !busy;

            // «Хадгалах» яагаад идэвхгүй вэ — tooltip биш, ил текстээр.
            if (SaveBtn.IsEnabled) SaveHint.Text = string.Empty;
            else if (busy) SaveHint.Text = "Хүлээнэ үү…";
            else if (!signedIn) SaveHint.Text = "Хадгалахын тулд эхлээд нэвтэрнэ үү.";
            else SaveHint.Text = "Хадгалахын тулд ажиллах төслөө сонгоно уу.";
        }

        /// <summary>Нэвтрэлтийн төлөв: «✓ Нэвтэрсэн: нэр (дүр)» эсвэл «Нэвтрээгүй».  «Токен»-ы тухай үг ХЭРЭГЛЭХГҮЙ.</summary>
        private void RenderAccount(string username, string role = null)
        {
            if (!string.IsNullOrEmpty(_token))
            {
                string name = string.IsNullOrWhiteSpace(username) ? "?" : username;
                string roleText = string.IsNullOrEmpty(role) ? string.Empty : " (" + Licensing.Core.LicenseText.RoleLabel(role) + ")";
                SetAccountStatus("✓ Нэвтэрсэн: " + name + roleText, Tone.Ok);
            }
            else
            {
                SetAccountStatus("Нэвтрээгүй. Нэвтрэх нэр, нууц үгээ бичиж «Нэвтрэх» дарна уу.", Tone.Muted);
            }
        }

        private void SetAccountStatus(string text, Tone tone)
        {
            AccountStatus.Text = text;
            Colour(AccountStatus, tone);
        }

        private void SetProjectStatus(string text, Tone tone)
        {
            ProjectStatus.Text = text;
            Colour(ProjectStatus, tone);
        }

        /// <summary>Өнгө нь токеноос (сэдэвт дагана); утга ӨНГӨӨР ГАНЦААРАА БИШ — ✓ / ✖ / ⓘ тэмдэгт бичвэрт орсон.</summary>
        private static void Colour(TextBlock block, Tone tone)
        {
            string key = tone == Tone.Ok ? "Ok" : tone == Tone.Danger ? "Danger" : "FgMuted";
            block.SetResourceReference(TextBlock.ForegroundProperty, key);
        }
    }
}
