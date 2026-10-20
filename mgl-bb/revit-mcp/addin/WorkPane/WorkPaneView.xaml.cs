using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using RevitMcpAddin.WorkPane.Core;
using RevitMcpAddin.WorkTracking;
using RevitMcpAddin.WorkTracking.Core;

namespace RevitMcpAddin.WorkPane
{
    /// <summary>
    /// «MGL ажил» — Revit work tracking MVP-ийн ажилтны самбар (Session 3).
    ///
    /// Энэ самбар ЭЗЭМШИНЭ: нэвтрэх/гарах, «хэн бэ», идэвхтэй файл → бүртгэлтэй
    /// төсөл → таскийн сонголт, явц/өдрийн тайлан (100% хаалтыг оруулаад), ZA
    /// таскийн «Ажилласан».
    /// Энэ самбар ЭЗЭМШИХГҮЙ: цаг тоолох, heartbeat, офлайн дараалал —
    /// `WorkTracking/WorkTrackingHost` (самбар хаалттай ч тоолол үргэлжилнэ).
    ///
    /// ⚠️ 2026-09-29 (эзний «хоёр тусдаа систем» шийдвэр): автомат цаг бүртгэл
    ///    ДАЛД — цаг, «тоолж байна/үгүй», өдрийн жагсаалтыг ЭНД ХАРУУЛАХГҮЙ
    ///    (`TrackingPanel` хасагдсан, текстэнд «цаг тоологдоно» гэж бичихгүй).
    ///    Үлдсэн нь ажилтны ӨӨРИЙН тайлангийн дараалал (`RenderOutbox`) — хостын
    ///    `Reports()` / `RetryReport` / `DiscardReport`.
    ///
    /// ⚠️ REVIT API-Г ШУУД ХӨНДӨХГҮЙ.  Баримтын мэдээллийг `get_document_context`
    ///    хэрэгслээр (RevitToolBus → ExternalEvent → Revit-ийн үндсэн thread) АРЫН
    ///    thread-ээс (`Task.Run`) уншина — WPF thread-ээс `RevitToolBus.Call` хийвэл
    ///    ГАЦНА (ASSISTANT.md урхи №10).
    /// ⚠️ Сүлжээний бүх дуудлага async — удаан сүлжээ Revit-ийг хэзээ ч барихгүй.
    /// ⚠️ Таскийг ТААМАГЛАЖ сонгохгүй (`WorkPaneRules.DecideTask`).
    /// </summary>
    public partial class WorkPaneView : UserControl
    {
        /// <summary>Вэбийн хаяг («Вэб дээр нээх»).  `MGL_WEB_HOST`-оор дарж бичнэ.</summary>
        private static string WebBase
        {
            get
            {
                string env = Environment.GetEnvironmentVariable("MGL_WEB_HOST");
                return string.IsNullOrWhiteSpace(env) ? "https://mgl-design-system.pages.dev" : env.Trim().TrimEnd('/');
            }
        }

        private readonly DispatcherTimer _reload;
        private readonly Dictionary<string, TextBox> _answers = new Dictionary<string, TextBox>(StringComparer.Ordinal);
        /// <summary>Энэ сесст хэрэглэгч ИЛ сонгосон төсөл (баримт тутам) — хоёрдмол бүртгэлд.</summary>
        private readonly Dictionary<string, int> _chosenProject = new Dictionary<string, int>(StringComparer.Ordinal);

        /// <summary>Дарааллын сүүлд зурсан хэлбэр — өөрчлөгдөөгүй бол дахин зурахгүй.</summary>
        private string _outboxSig;
        private bool _hooked;
        private WorkContextDto _ctx;
        private ActiveDocInfo _doc;
        private int _loadVersion;
        private bool _suppressCombo;
        private string _displayName;
        private int? _shownUserId;
        private bool? _shownSignedIn;
        private string _lastHostDocName;
        /// <summary>Сервер 401 өгсөн токен — тэр токеноор дахин «нэвтэрсэн» гэж харуулахгүй.</summary>
        private string _rejectedToken;

        public WorkPaneView()
        {
            InitializeComponent();
            // Өнгө, оролт, combo, чагтын загвар — `Ui/MglTheme` (Revit сэдэв/өндөр контраст дагана); ЗӨВХӨН энэ самбарын resource.
            global::RevitMcpAddin.Ui.MglTheme.Apply(this, 12);
            _reload = new DispatcherTimer(DispatcherPriority.Background, Dispatcher)
            {
                Interval = TimeSpan.FromMilliseconds(600),
            };
            _reload.Tick += (s, e) =>
            {
                _reload.Stop();
                _reload.Interval = TimeSpan.FromMilliseconds(600);
                _ = LoadContextAsync();
            };
            Loaded += OnLoaded;
            Unloaded += OnUnloaded;
        }

        /* ============================================================== */
        /*  Амьдралын мөчлөг                                               */
        /* ============================================================== */

        private void OnLoaded(object sender, RoutedEventArgs e)
        {
            WorkTrackingHost h = WorkTrackingHost.Instance;
            if (h != null && !_hooked)
            {
                h.Changed += OnHostChanged;
                _hooked = true;
            }
            if (string.IsNullOrEmpty(UserBox.Text)) UserBox.Text = SafeSettings()?.Username ?? string.Empty;
            ApplyAuth(force: true);
        }

        private void OnUnloaded(object sender, RoutedEventArgs e)
        {
            // Dockable pane нь нуугдах/таб солих үед Unloaded болж дахин Loaded болдог —
            // захиалгыг чөлөөлж, дахин ачаалахад сэргээнэ (давхар захиалга үүсэхгүй).
            WorkTrackingHost h = WorkTrackingHost.Instance;
            if (h != null && _hooked)
            {
                h.Changed -= OnHostChanged;
                _hooked = false;
            }
        }

        /// <summary>Хост АРЫН thread дээр дуудна — UI руу галт-мартах (Invoke биш).</summary>
        private void OnHostChanged()
        {
            try { Dispatcher.BeginInvoke(new Action(HostChangedUi)); } catch { }
        }

        private void HostChangedUi()
        {
            ApplyAuth(force: false);
            WorkTrackingHost h = WorkTrackingHost.Instance;
            if (h == null || !IsSignedIn(h.View())) return;
            TrackingView v = h.View();
            RenderOutbox(h);
            // Идэвхтэй баримт солигдсон — контекстыг дахин уншина (debounce).
            if (!string.Equals(v.DocName, _lastHostDocName, StringComparison.Ordinal))
            {
                _lastHostDocName = v.DocName;
                ScheduleReload(600);
                return;
            }
            SyncComboWithHost(v);
        }

        private void ScheduleReload(int ms)
        {
            _reload.Stop();
            _reload.Interval = TimeSpan.FromMilliseconds(Math.Max(100, ms));
            _reload.Start();
        }

        /* ============================================================== */
        /*  Нэвтрэлт                                                       */
        /* ============================================================== */

        private static AddinSettings SafeSettings()
        {
            try { return SettingsStore.Load(); } catch { return null; }
        }

        private bool IsSignedIn(TrackingView v)
        {
            string token = SafeSettings()?.Token;
            return v != null && v.UserId.HasValue && !string.IsNullOrEmpty(token) &&
                   !string.Equals(token, _rejectedToken, StringComparison.Ordinal);
        }

        private void ApplyAuth(bool force)
        {
            WorkTrackingHost h = WorkTrackingHost.Instance;
            if (h == null)
            {
                WhoText.Text = "«MGL ажил» энэ Revit дээр ажиллахгүй байна (Revit 2027 шаардлагатай).";
                LoginCard.Visibility = Visibility.Collapsed;
                WorkBody.Visibility = Visibility.Collapsed;
                LogoutBtn.Visibility = Visibility.Collapsed;
                return;
            }

            TrackingView v = h.View();
            bool signedIn = IsSignedIn(v);
            if (!force && _shownSignedIn == signedIn && _shownUserId == v.UserId) return;
            bool userChanged = _shownUserId != v.UserId;
            _shownSignedIn = signedIn;
            _shownUserId = v.UserId;

            if (!signedIn)
            {
                LoginCard.Visibility = Visibility.Visible;
                WorkBody.Visibility = Visibility.Collapsed;
                LogoutBtn.Visibility = Visibility.Collapsed;
                WhoText.Text = _rejectedToken != null
                    ? "Нэвтрэлт хүчингүй болжээ — дахин нэвтэрнэ үү."
                    : "Нэвтрээгүй";
                return;
            }

            LoginCard.Visibility = Visibility.Collapsed;
            WorkBody.Visibility = Visibility.Visible;
            LogoutBtn.Visibility = Visibility.Visible;
            if (userChanged)
            {
                _displayName = null;
                _ctx = null;
                _chosenProject.Clear();
                _outboxSig = null;
            }
            WhoText.Text = _displayName ?? v.UserName ?? ("Хэрэглэгч #" + v.UserId);
            if (_displayName == null) _ = LoadDisplayNameAsync();
            RenderOutbox(h);
            ScheduleReload(100);
        }

        private async Task LoadDisplayNameAsync()
        {
            AddinSettings st = SafeSettings();
            if (st == null || string.IsNullOrEmpty(st.Token)) return;
            try
            {
                string name = await Task.Run(() =>
                    WorkPaneApi.GetDisplayNameAsync(st.ApiHost, st.Token, CancellationToken.None));
                if (!string.IsNullOrWhiteSpace(name))
                {
                    _displayName = name;
                    WhoText.Text = name;
                }
            }
            catch (UnauthorizedException)
            {
                MarkTokenRejected(st.Token);
            }
            catch { /* чимэглэл — нэргүй ч ажиллана */ }
        }

        private void MarkTokenRejected(string token)
        {
            _rejectedToken = token;
            ApplyAuth(force: true);
        }

        private void PassBox_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Enter) LoginBtn_Click(sender, e);
        }

        private async void LoginBtn_Click(object sender, RoutedEventArgs e)
        {
            string username = (UserBox.Text ?? string.Empty).Trim();
            string password = PassBox.Password ?? string.Empty;
            if (username.Length == 0 || password.Length == 0)
            {
                SetMuted(LoginStatus, "Нэвтрэх нэр, нууц үгээ бичнэ үү.", error: true);
                return;
            }
            if (!LoginBtn.IsEnabled) return;
            LoginBtn.IsEnabled = false;
            SetMuted(LoginStatus, "Нэвтэрч байна…", error: false);

            AddinSettings st0 = SafeSettings() ?? new AddinSettings();
            string host = string.IsNullOrWhiteSpace(st0.ApiHost) ? AddinSettings.DefaultApiHost : st0.ApiHost.Trim();
            try
            {
                // ⚠️ Нэвтрэлт (1.10.0): нэр/нууц үг → ТӨХӨӨРӨМЖИЙН ТҮЛХҮҮР бүртгэх → лиценз + 30 минутын
                //    session (`LicenseGate.SignInAsync`).  365 хоногийн токен ҮҮСГЭХГҮЙ.
                //    НУУЦ ҮГ ХАДГАЛАГДАХГҮЙ — зөвхөн DPAPI-аар шифрлэгдсэн renewal credential.
                Licensing.RefreshResult signIn = await Task.Run(async () =>
                    await Licensing.LicenseGate.SignInAsync(host, username, password, System.Threading.CancellationToken.None)
                        .ConfigureAwait(false));
                if (signIn.Outcome != Licensing.RefreshOutcome.Ok)
                {
                    SetMuted(LoginStatus, signIn.Message ?? "Нэвтэрч чадсангүй.", error: true);
                    return;
                }

                PassBox.Clear();
                SetMuted(LoginStatus, string.Empty, error: false);
                _rejectedToken = null;
                _displayName = null;
                _ctx = null;
                WorkTrackingHost.Instance?.NotifyAuthChanged();
                ApplyAuth(force: true);
            }
            catch (Exception ex)
            {
                SetMuted(LoginStatus, RevitApi.FriendlyError(ex), error: true);
            }
            finally
            {
                LoginBtn.IsEnabled = true;
            }
        }

        private void LogoutBtn_Click(object sender, RoutedEventArgs e)
        {
            MessageBoxResult ok = MessageBox.Show(
                "Энэ компьютер дээрх MGL нэвтрэлтээс гарах уу?\n\n" +
                "Илгээгдээгүй тайлан хадгалагдсан хэвээр — та дахин нэвтрэхэд илгээгдэнэ.",
                "MGL ажил", MessageBoxButton.YesNo, MessageBoxImage.Question);
            if (ok != MessageBoxResult.Yes) return;

            try
            {
                AddinSettings st = SafeSettings() ?? new AddinSettings();
                st.Token = null;
                st.TokenEnc = null;
                SettingsStore.Save(st);
                // Гарсны дараа энэ компьютерын лиценз ч арилна (1.9.0).
                Licensing.LicenseGate.SignOut();
            }
            catch (Exception ex)
            {
                MessageBox.Show("Гарч чадсангүй: " + ex.Message, "MGL ажил");
                return;
            }
            _ctx = null;
            _doc = null;
            _displayName = null;
            _chosenProject.Clear();
            WorkTrackingHost.Instance?.NotifyAuthChanged();
            ApplyAuth(force: true);
        }

        /* ============================================================== */
        /*  Файл → төсөл → таск                                            */
        /* ============================================================== */

        private void RefreshBtn_Click(object sender, RoutedEventArgs e)
        {
            WorkTrackingHost.Instance?.Kick();
            _ = LoadContextAsync();
        }

        private async Task LoadContextAsync()
        {
            WorkTrackingHost h = WorkTrackingHost.Instance;
            if (h == null) return;
            TrackingView v0 = h.View();
            if (!IsSignedIn(v0)) return;
            AddinSettings st = SafeSettings();
            if (st == null || string.IsNullOrEmpty(st.Token)) return;

            int ver = ++_loadVersion;
            SetMuted(ContextStatus, "Уншиж байна…", error: false);

            ActiveDocInfo doc;
            try
            {
                // ⚠️ Task.Run ЗААВАЛ — RevitToolBus.Call нь ExternalEvent-ийг ХҮЛЭЭДЭГ.
                JsonElement j = await Task.Run(() => RevitApi.CallTool("get_document_context"));
                doc = ActiveDocInfo.FromToolJson(j);
            }
            catch (Exception ex)
            {
                if (ver != _loadVersion) return;
                ShowNoDocument(ex.Message);
                return;
            }
            if (ver != _loadVersion) return;

            if (doc.IsFamily)
            {
                // Family засварлах нь төслийн ажлын хэсэг — хостын контекст хэвээр
                // (тоолол өмнөх төслийн таск дээр үргэлжилнэ).  Самбарыг хөндөхгүй.
                SetMuted(ContextStatus,
                    "Family засварлаж байна — өмнөх төслийн таск сонгогдсон хэвээр.", error: false);
                return;
            }
            if (string.IsNullOrEmpty(doc.DocUid))
            {
                ShowNoDocument(null);
                return;
            }

            _doc = doc;
            DocLine.Text = "Файл: " + (string.IsNullOrEmpty(doc.FileName) ? doc.Title : doc.FileName);

            int? hint = null;
            int chosen;
            if (_chosenProject.TryGetValue(doc.DocUid, out chosen)) hint = chosen;
            else if (v0.ProjectId.HasValue && string.Equals(v0.DocName, doc.Title, StringComparison.Ordinal)) hint = v0.ProjectId;

            WorkContextDto ctx;
            try
            {
                ctx = await Task.Run(() => WorkPaneApi.GetWorkContextAsync(st.ApiHost, st.Token, doc, hint, CancellationToken.None));
            }
            catch (UnauthorizedException)
            {
                if (ver == _loadVersion) MarkTokenRejected(st.Token);
                return;
            }
            catch (Exception ex)
            {
                if (ver != _loadVersion) return;
                // Хост өмнөх (санамжийн) контекст дээр ТООЛСООР байна — самбар л хуучирна.
                SetMuted(ContextStatus,
                    "Сервертэй холбогдож чадсангүй — «Шинэчлэх»-ээр дахин оролдоно уу. " +
                    "Бичсэн тайлан хадгалагдаж, холболт сэргэхэд илгээгдэнэ.\n(" +
                    RevitApi.FriendlyError(ex) + ")", error: true);
                return;
            }
            if (ver != _loadVersion) return;

            _ctx = ctx;
            ApplyContext(h, ctx);
        }

        private void ShowNoDocument(string detail)
        {
            _doc = null;
            _ctx = null;
            DocLine.Text = "Файл: —";
            ProjectLine.Text = "Төсөл: —";
            ChoicePanel.Visibility = Visibility.Collapsed;
            TaskPanel.Visibility = Visibility.Collapsed;
            ReportCard.Visibility = Visibility.Collapsed;
            SetMuted(ContextStatus, "Revit-д төслийн файл нээхэд энд таны таскууд гарна." +
                (string.IsNullOrWhiteSpace(detail) ? "" : "\n(" + detail + ")"), error: false);
        }

        private void ApplyContext(WorkTrackingHost h, WorkContextDto ctx)
        {
            ChoicePanel.Visibility = Visibility.Collapsed;
            TaskPanel.Visibility = Visibility.Collapsed;
            ReportCard.Visibility = Visibility.Collapsed;
            SetMuted(ContextStatus, string.Empty, error: false);

            if (ctx.Document != null)
            {
                ProjectLine.Text = "Төсөл: " + (ctx.Document.ProjectName ?? ("#" + ctx.Document.ProjectId));
                // Баримт → төсөл санамж (хост тоолол, heartbeat-даа хэрэглэнэ).
                h.RememberDocument(_doc.DocUid, ctx.Document.ProjectId, ctx.Document.ProjectName,
                    ctx.Document.RevitDocumentId, _doc.Title);

                if (ctx.Project == null || !string.Equals(ctx.Project.Status, "active", StringComparison.Ordinal))
                {
                    TrackingView v = h.View();
                    if (v.ProjectId == ctx.Document.ProjectId && v.TaskId.HasValue) h.ClearTask(_doc.DocUid);
                    SetMuted(ContextStatus, "Энэ төсөл идэвхгүй (архивлагдсан эсвэл дууссан) — таск сонгох боломжгүй.", error: false);
                    return;
                }
                BuildTaskList(h, ctx);
                return;
            }

            if (ctx.Ambiguous && ctx.Registrations.Count > 0)
            {
                ProjectLine.Text = "Төсөл: (сонгоно уу)";
                ShowChoice(
                    "Энэ файл хэд хэдэн төсөлд бүртгэлтэй байна. Одоо аль төслийн ажил хийж байна вэ?",
                    ctx.Registrations.Cast<object>().ToList(),
                    "Энэ төслийг сонгох");
                return;
            }

            ProjectLine.Text = "Төсөл: бүртгэгдээгүй файл";
            if (ctx.Suggestions.Count > 0)
            {
                ShowChoice(
                    "Энэ файл MGL-д бүртгэгдээгүй байна. Аль төслийн файл вэ? " +
                    "(Нэг удаа холбоход бусад ажилтанд ч хадгалагдана.)",
                    ctx.Suggestions.Cast<object>().ToList(),
                    "Энэ төсөлд холбох");
            }
            else
            {
                SetMuted(ContextStatus,
                    "Энэ файл бүртгэгдээгүй бөгөөд танд нээлттэй таск бүхий төсөл алга. " +
                    "Вэбийн «Миний ажлууд» хуудаснаас таскаа аваад «Шинэчлэх» дарна уу.", error: false);
            }
        }

        private void BuildTaskList(WorkTrackingHost h, WorkContextDto ctx)
        {
            List<WorkTaskDto> tasks = ctx.Tasks ?? new List<WorkTaskDto>();
            int projectId = ctx.Document.ProjectId;
            TrackingView v = h.View();
            bool currentIsThisProject = v.ProjectId == projectId;
            TaskDecision d = WorkPaneRules.DecideTask(
                tasks.Select(t => t.TaskId).ToList(), v.TaskId, currentIsThisProject,
                h.RememberedTaskId(projectId), ctx.ResolvedBy);

            // ⚠️ Хост дууссан / хуваарилалтаас гарсан таск дээр ТООЛСООР байж болохгүй.
            if (d.ClearStale) h.ClearTask(_doc.DocUid);

            if (tasks.Count == 0)
            {
                SetMuted(ContextStatus,
                    "Танд энэ төсөлд нээлттэй таск алга. Вэбийн «Миний ажлууд» хуудаснаас таск аваад «Шинэчлэх» дарна уу.",
                    error: false);
                return;
            }

            _suppressCombo = true;
            try
            {
                TaskCombo.ItemsSource = tasks;
                TaskCombo.SelectedItem = null;
                WorkTaskDto pick = d.TaskId.HasValue ? tasks.FirstOrDefault(t => t.TaskId == d.TaskId.Value) : null;
                TaskDecisionKind kind = pick == null && d.Kind != TaskDecisionKind.NoTasks
                    ? TaskDecisionKind.NeedsChoice
                    : d.Kind;
                switch (kind)
                {
                    case TaskDecisionKind.KeepCurrent:
                        TaskCombo.SelectedItem = pick;
                        TaskNote.Text = "Одоо энэ таск дээр ажиллаж байна.";
                        break;
                    case TaskDecisionKind.Restore:
                        h.SelectTask(_doc.DocUid, projectId, pick.TaskId, pick.TaskName);
                        TaskCombo.SelectedItem = pick;
                        TaskNote.Text = "Өмнөх сонголтоо үргэлжлүүлж байна.";
                        break;
                    case TaskDecisionKind.AutoSingle:
                        h.SelectTask(_doc.DocUid, projectId, pick.TaskId, pick.TaskName);
                        TaskCombo.SelectedItem = pick;
                        TaskNote.Text = "Танд энэ төсөлд ганц нээлттэй таск байгаа тул АВТОМАТААР сонгогдлоо. " +
                                        "Өөр таск дээр ажиллаж байгаа бол дээрх жагсаалтаас солино уу.";
                        break;
                    default:
                        TaskNote.Text = "Жагсаалтаас одоо ажиллаж буй таскаа сонгоно уу.";
                        break;
                }
            }
            finally
            {
                _suppressCombo = false;
            }

            TaskPanel.Visibility = Visibility.Visible;
            UpdateTaskUi();
        }

        /// <summary>Хост өөр газраас (өөр баримт, дахин нэвтрэлт) таскаа сольсон бол жагсаалтыг тэгшилнэ.</summary>
        private void SyncComboWithHost(TrackingView v)
        {
            if (_ctx?.Document == null || TaskPanel.Visibility != Visibility.Visible) return;
            if (v.ProjectId != _ctx.Document.ProjectId) return;
            var cur = TaskCombo.SelectedItem as WorkTaskDto;
            int? want = v.TaskId;
            if ((cur?.TaskId) == want) return;
            _suppressCombo = true;
            try
            {
                TaskCombo.SelectedItem = want.HasValue
                    ? (TaskCombo.ItemsSource as IEnumerable<WorkTaskDto>)?.FirstOrDefault(t => t.TaskId == want.Value)
                    : null;
            }
            finally
            {
                _suppressCombo = false;
            }
            UpdateTaskUi();
        }

        private void TaskCombo_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (_suppressCombo) return;
            var t = TaskCombo.SelectedItem as WorkTaskDto;
            WorkTrackingHost h = WorkTrackingHost.Instance;
            if (t == null || h == null || _ctx?.Document == null || _doc == null) return;
            // ⚠️ ИЛ сонголт — ЭНЭ Л «цаг хэнд тоологдох» шийдвэр.
            h.SelectTask(_doc.DocUid, _ctx.Document.ProjectId, t.TaskId, t.TaskName);
            TaskNote.Text = "Одоо энэ таск дээр ажиллаж байна.";
            ResetReportForm();
            UpdateTaskUi();
        }

        private void ClearTaskBtn_Click(object sender, RoutedEventArgs e)
        {
            WorkTrackingHost h = WorkTrackingHost.Instance;
            if (h == null || _doc == null) return;
            h.ClearTask(_doc.DocUid);
            _suppressCombo = true;
            try { TaskCombo.SelectedItem = null; }
            finally { _suppressCombo = false; }
            TaskNote.Text = "Таск сонгоогүй.";
            UpdateTaskUi();
        }

        /* ============================================================== */
        /*  Төсөл сонгох / файл бүртгэх                                     */
        /* ============================================================== */

        private void ShowChoice(string title, List<object> items, string button)
        {
            ChoiceTitle.Text = title;
            ChoiceList.ItemsSource = items;
            ChoiceList.SelectedItem = null;
            ChoiceBtn.Content = button;
            ChoiceBtn.IsEnabled = false;
            ChoicePanel.Visibility = Visibility.Visible;
        }

        private void ChoiceList_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            ChoiceBtn.IsEnabled = ChoiceList.SelectedItem != null;
        }

        private async void ChoiceBtn_Click(object sender, RoutedEventArgs e)
        {
            object picked = ChoiceList.SelectedItem;
            ActiveDocInfo doc = _doc;
            WorkTrackingHost h = WorkTrackingHost.Instance;
            AddinSettings st = SafeSettings();
            if (picked == null || doc == null || h == null || st == null) return;

            var reg = picked as RegistrationDto;
            if (reg != null)
            {
                // Хоёрдмол бүртгэл — ХЭРЭГЛЭГЧИЙН ил сонголт.  Серверт шинэ бүртгэл үүсэхгүй.
                _chosenProject[doc.DocUid] = reg.ProjectId;
                h.RememberDocument(doc.DocUid, reg.ProjectId, reg.ProjectName, reg.RevitDocumentId, doc.Title);
                ChoicePanel.Visibility = Visibility.Collapsed;
                _ = LoadContextAsync();
                return;
            }

            var sug = picked as SuggestionDto;
            if (sug == null) return;
            MessageBoxResult ok = MessageBox.Show(
                "«" + (doc.FileName ?? doc.Title) + "» файлыг «" + sug.ProjectName + "» төсөлд холбох уу?\n\n" +
                "Энэ холбоос серверт хадгалагдаж, энэ файлыг нээх бүх ажилтанд үйлчилнэ.",
                "MGL ажил", MessageBoxButton.YesNo, MessageBoxImage.Question);
            if (ok != MessageBoxResult.Yes) return;

            ChoiceBtn.IsEnabled = false;
            SetMuted(ContextStatus, "Холбож байна…", error: false);
            try
            {
                // Хуудсууд нь холбоосын НЭМЭЛТ (дэд жагсаалт, хуудас↔таск санал) — цаг
                // бүртгэлд шаардлагагүй.  Уншиж чадахгүй бол хоосон жагсаалтаар бүртгэнэ
                // (сервер `sheets: []`-г хүлээж авдаг).
                var sheets = new List<RevitTools.SheetDto>();
                try
                {
                    JsonElement js = await Task.Run(() => RevitApi.CallTool("list_sheets"));
                    JsonElement arr;
                    if (js.TryGetProperty("sheets", out arr) && arr.ValueKind == JsonValueKind.Array)
                    {
                        foreach (JsonElement x in arr.EnumerateArray())
                        {
                            JsonElement u, nn, na, pc;
                            sheets.Add(new RevitTools.SheetDto
                            {
                                uid = x.TryGetProperty("uid", out u) ? u.GetString() : null,
                                number = x.TryGetProperty("number", out nn) ? nn.GetString() : "",
                                name = x.TryGetProperty("name", out na) ? na.GetString() : "",
                                placed_view_count = x.TryGetProperty("placed_view_count", out pc) && pc.TryGetInt32(out int pv) ? pv : 0,
                            });
                        }
                    }
                }
                catch { /* хуудасгүй бүртгэл */ }

                await Task.Run(() => RevitApi.HandshakeAsync(
                    st.ApiHost, st.Token, sug.ProjectId, doc.DocUid,
                    string.IsNullOrEmpty(doc.FileName) ? (doc.Title ?? "Revit") : doc.FileName,
                    doc.RevitVersion, doc.IsLink, sheets));

                _chosenProject[doc.DocUid] = sug.ProjectId;
                ChoicePanel.Visibility = Visibility.Collapsed;
                await LoadContextAsync();
            }
            catch (UnauthorizedException)
            {
                MarkTokenRejected(st.Token);
            }
            catch (Exception ex)
            {
                SetMuted(ContextStatus, "Холбож чадсангүй: " + RevitApi.FriendlyError(ex), error: true);
                ChoiceBtn.IsEnabled = ChoiceList.SelectedItem != null;
            }
        }

        /* ============================================================== */
        /*  Явц ба өдрийн тайлан                                            */
        /* ============================================================== */

        private WorkTaskDto SelectedTask => TaskCombo.SelectedItem as WorkTaskDto;

        private void UpdateTaskUi()
        {
            WorkTaskDto t = SelectedTask;
            ClearTaskBtn.Visibility = t != null ? Visibility.Visible : Visibility.Collapsed;
            if (t == null)
            {
                ReportCard.Visibility = Visibility.Collapsed;
                return;
            }
            ReportCard.Visibility = Visibility.Visible;

            if (t.IsHoursMode)
            {
                PercentPanel.Visibility = Visibility.Collapsed;
                HoursPanel.Visibility = Visibility.Visible;
                CurrentLine.Text = t.TaskName;
                MarkBtn.IsEnabled = !t.MarkedToday;
                MarkBtn.Content = t.MarkedToday ? "Өнөөдөр тэмдэглэгдсэн ✓" : "Өнөөдөр ажилласан";
                return;
            }

            HoursPanel.Visibility = Visibility.Collapsed;
            PercentPanel.Visibility = Visibility.Visible;
            CurrentLine.Text = "Одоогийн явц " + WorkPaneRules.Pct(t.CurrentProgress) + "%" +
                               (t.ReportedToday ? "  ·  өнөөдөр тайлан илгээсэн" : "");
            if (CompleteCheck.IsChecked != true)
            {
                if (string.IsNullOrWhiteSpace(PercentBox.Text))
                    PercentBox.Text = WorkPaneRules.Pct(t.CurrentProgress);
                PercentHint.Text = "дээд тал нь 99% — дуусгах бол доорх нүдийг чагтална";
            }
        }

        private void ResetReportForm()
        {
            CompleteCheck.IsChecked = false;
            PercentBox.Text = string.Empty;
            PercentBox.IsEnabled = true;
            NotesBox.Text = string.Empty;
            QuestionsPanel.Children.Clear();
            QuestionsPanel.Visibility = Visibility.Collapsed;
            _answers.Clear();
            SetMuted(ReportStatus, string.Empty, error: false);
        }

        private void CompleteCheck_Changed(object sender, RoutedEventArgs e)
        {
            bool completing = CompleteCheck.IsChecked == true;
            PercentBox.IsEnabled = !completing;
            if (completing)
            {
                PercentBox.Text = "100";
                PercentHint.Text = "таск ДУУСНА — доорх асуултуудад хариулна уу";
                BuildQuestions();
                QuestionsPanel.Visibility = Visibility.Visible;
            }
            else
            {
                WorkTaskDto t = SelectedTask;
                PercentBox.Text = t != null ? WorkPaneRules.Pct(t.CurrentProgress) : string.Empty;
                PercentHint.Text = "дээд тал нь 99% — дуусгах бол доорх нүдийг чагтална";
                QuestionsPanel.Visibility = Visibility.Collapsed;
            }
        }

        private void BuildQuestions()
        {
            QuestionsPanel.Children.Clear();
            _answers.Clear();
            foreach (CompletionQuestionDto q in _ctx?.CompletionQuestions ?? new List<CompletionQuestionDto>())
            {
                if (q == null || string.IsNullOrEmpty(q.Id)) continue;
                var label = new TextBlock
                {
                    Text = q.Text,
                    TextWrapping = TextWrapping.Wrap,
                    Margin = new Thickness(0, 6, 0, 2),
                    FontSize = 12,
                };
                label.SetResourceReference(TextBlock.ForegroundProperty, "Fg");
                var box = new TextBox
                {
                    TextWrapping = TextWrapping.Wrap,
                    AcceptsReturn = true,
                    MinHeight = 44,
                };
                System.Windows.Automation.AutomationProperties.SetLabeledBy(box, label);
                _answers[q.Id] = box;
                QuestionsPanel.Children.Add(label);
                QuestionsPanel.Children.Add(box);
            }
        }

        private void SendBtn_Click(object sender, RoutedEventArgs e)
        {
            WorkTrackingHost h = WorkTrackingHost.Instance;
            WorkTaskDto t = SelectedTask;
            if (h == null || t == null || _ctx?.Document == null) return;

            bool completing = CompleteCheck.IsChecked == true;
            double pct;
            switch (WorkPaneRules.CheckPercent(PercentBox.Text, t.CurrentProgress, completing, out pct))
            {
                case PercentCheckCode.Empty:
                    SetMuted(ReportStatus, "Явцын хувийг бичнэ үү.", error: true);
                    return;
                case PercentCheckCode.NotANumber:
                    SetMuted(ReportStatus, "Хувийг тоогоор бичнэ үү (ж: 45 эсвэл 45.5).", error: true);
                    return;
                case PercentCheckCode.BelowCurrent:
                    SetMuted(ReportStatus, "Одоогийн явц " + WorkPaneRules.Pct(t.CurrentProgress) +
                                           "% — үүнээс бага хувь илгээх боломжгүй.", error: true);
                    return;
                case PercentCheckCode.AboveCeiling:
                    SetMuted(ReportStatus, completing
                        ? "Энэ таск аль хэдийн дууссан."
                        : "99%-аас дээш зөвхөн «ДУУСГАХ (100%)»-ыг чагталж илгээнэ.", error: true);
                    return;
            }

            string notes = (NotesBox.Text ?? string.Empty).Trim();
            if (notes.Length < 3)
            {
                SetMuted(ReportStatus, "Өнөөдөр юу хийснээ товч бичнэ үү.", error: true);
                return;
            }

            string qaJson = null;
            if (completing)
            {
                var answers = _answers.ToDictionary(kv => kv.Key, kv => kv.Value.Text ?? string.Empty, StringComparer.Ordinal);
                List<string> missing = WorkPaneRules.MissingAnswers(_ctx.CompletionQuestions, answers);
                if (missing.Count > 0)
                {
                    SetMuted(ReportStatus, "Дуусгахын тулд бүх асуултад хариулна уу:\n• " + string.Join("\n• ", missing), error: true);
                    return;
                }
                MessageBoxResult ok = MessageBox.Show(
                    "«" + t.TaskName + "» таскийг 100% болгож ДУУСГАХ уу?\n\n" +
                    "Дууссан таск таны жагсаалтаас гарна.",
                    "MGL ажил", MessageBoxButton.YesNo, MessageBoxImage.Question);
                if (ok != MessageBoxResult.Yes) return;
                qaJson = WorkPaneRules.CompletionQaJson(_ctx.CompletionQuestions, answers);
            }

            try
            {
                // ⚠️ ДАРААЛЛААР — эхлээд дискэнд, дараа нь хостын арын loop илгээнэ
                //    (сүлжээгүй ч текст алдагдахгүй, draft_uid тогтвортой тул давхардахгүй).
                h.EnqueueReport(t.TaskId, t.TaskName, _ctx.Project?.Name ?? _ctx.Document.ProjectName, pct, notes,
                    _ctx.Document.RevitDocumentId, null, qaJson);
            }
            catch (Exception ex)
            {
                SetMuted(ReportStatus, "Тайланг хадгалж чадсангүй: " + ex.Message, error: true);
                return;
            }

            SetMuted(ReportStatus, completing
                ? "Дуусгах тайлан дараалалд орлоо — илгээгдсэний дараа таск жагсаалтаас гарна."
                : "Тайлан дараалалд орлоо — сүлжээтэй бол хэдэн секундэд илгээгдэнэ. " +
                  "Илгээгдэх хүртэл дээд талын «Илгээгдээгүй тайлан» хэсэгт харагдана.", error: false);
            string status = ReportStatus.Text;
            ResetReportForm();
            SetMuted(ReportStatus, status, error: false);
            UpdateTaskUi();
            // Илгээгдсэний дараа одоогийн хувь, «өнөөдөр ✓»-ийг шинэчилнэ.
            ScheduleReload(8000);
        }

        private async void MarkBtn_Click(object sender, RoutedEventArgs e)
        {
            WorkTaskDto t = SelectedTask;
            AddinSettings st = SafeSettings();
            if (t == null || _ctx?.Document == null || st == null) return;
            MarkBtn.IsEnabled = false;
            SetMuted(ReportStatus, "Тэмдэглэж байна…", error: false);
            try
            {
                await Task.Run(() => WorkPaneApi.MarkWorkedAsync(st.ApiHost, st.Token, _ctx.Document.ProjectId, t.TaskId, CancellationToken.None));
                SetMuted(ReportStatus, "Өнөөдөр ажилласан гэж тэмдэглэгдлээ — цагийг систем бодно.", error: false);
                ScheduleReload(500);
            }
            catch (UnauthorizedException)
            {
                MarkTokenRejected(st.Token);
            }
            catch (ApiException ex) when (ex.StatusCode == 403)
            {
                SetMuted(ReportStatus, RevitApi.FriendlyError(ex) +
                    "\n(«Ажилласан» тэмдэглэгээ нь инженер, архитектор, ахлахад зориулагдсан.)", error: true);
                MarkBtn.IsEnabled = true;
            }
            catch (Exception ex)
            {
                SetMuted(ReportStatus, "Тэмдэглэж чадсангүй: " + RevitApi.FriendlyError(ex), error: true);
                MarkBtn.IsEnabled = true;
            }
        }

        private void OpenWebBtn_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(WebBase + "/app/my-tasks")
                {
                    UseShellExecute = true,
                });
            }
            catch (Exception ex)
            {
                SetMuted(ReportStatus, "Хөтөч нээж чадсангүй: " + ex.Message, error: true);
            }
        }

        /* ============================================================== */
        /*  Илгээгдээгүй тайлан (хостын дараалал)                          */
        /* ============================================================== */

        /// <summary>
        /// Ажилтны ӨӨРИЙН тайлангийн дараалал — илгээгдээгүй (сүлжээ / нэвтрэлт
        /// хүлээж буй) ба сервер татгалзсан.  Цаг бүртгэлийн мэдээлэл ЭНД ОРОХГҮЙ.
        /// Татгалзсаныг «Дахин илгээх» (хостын `RetryReport` — ШИНЭ draft_uid, огноо
        /// хэвээр) эсвэл «Устгах».  Тэмдэглэл нь сонгож хуулж болох нүдэнд — устгахаас
        /// өмнө текстээ авч болно.
        /// </summary>
        private void RenderOutbox(WorkTrackingHost h)
        {
            if (h == null)
            {
                OutboxCard.Visibility = Visibility.Collapsed;
                return;
            }
            IReadOnlyList<ReportItem> all;
            TrackingView v;
            try
            {
                all = h.Reports();
                v = h.View();
            }
            catch
            {
                return;
            }

            var rows = new List<KeyValuePair<ReportItem, OutboxLineKind>>();
            foreach (ReportItem r in all)
            {
                if (r == null) continue;
                OutboxLineKind? kind = WorkPaneRules.OutboxKind(r.State, v.Online, v.AuthRequired);
                if (kind.HasValue) rows.Add(new KeyValuePair<ReportItem, OutboxLineKind>(r, kind.Value));
            }
            string sig = v.WorkDate + "#" + string.Join(";", rows.Select(x => x.Key.DraftUid + "|" + x.Value + "|" + x.Key.LastError));
            if (sig == _outboxSig) return;
            _outboxSig = sig;

            OutboxList.Children.Clear();
            foreach (KeyValuePair<ReportItem, OutboxLineKind> x in rows)
                OutboxList.Children.Add(OutboxRow(h, x.Key, x.Value, v.WorkDate));
            OutboxCard.Visibility = rows.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        }

        private UIElement OutboxRow(WorkTrackingHost h, ReportItem r, OutboxLineKind kind, string today)
        {
            bool rejected = kind == OutboxLineKind.Rejected;
            var box = new StackPanel { Margin = new Thickness(0, 4, 0, 2) };
            var headline = new TextBlock
            {
                Text = WorkPaneRules.OutboxHeadline(kind, r.TaskName, r.TaskId, r.Percentage, r.ReportDate, today),
                TextWrapping = TextWrapping.Wrap,
                FontSize = 12,
            };
            headline.SetResourceReference(TextBlock.ForegroundProperty, rejected ? "Danger" : "Warn");
            box.Children.Add(headline);
            if (rejected && !string.IsNullOrWhiteSpace(r.LastError))
            {
                box.Children.Add(new TextBlock
                {
                    Text = r.LastError,
                    Style = (Style)FindResource("MutedText"),
                    Margin = new Thickness(0, 1, 0, 0),
                });
            }
            if (!string.IsNullOrWhiteSpace(r.Notes))
            {
                // TextBlock биш — сонгож Ctrl+C-ээр хуулж болно (устгахаас өмнө текстээ авах).
                box.Children.Add(new TextBox
                {
                    Text = r.Notes.Trim(),
                    IsReadOnly = true,
                    TextWrapping = TextWrapping.Wrap,
                    MaxHeight = 64,
                    VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                    FontSize = 12,
                    Margin = new Thickness(0, 3, 0, 0),
                });
            }
            if (rejected)
            {
                var btns = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 4, 0, 0) };
                string uid = r.DraftUid;
                btns.Children.Add(OutboxButton("Дахин илгээх", () => h.RetryReport(uid)));
                btns.Children.Add(OutboxButton("Устгах", () =>
                {
                    MessageBoxResult ok = MessageBox.Show(
                        "Энэ тайланг устгах уу? Бичсэн текст алга болно.",
                        "MGL ажил", MessageBoxButton.YesNo, MessageBoxImage.Question);
                    if (ok == MessageBoxResult.Yes) h.DiscardReport(uid);
                }));
                box.Children.Add(btns);
            }
            return box;
        }

        private Button OutboxButton(string text, Action onClick)
        {
            var b = new Button
            {
                Content = text,
                Style = (Style)FindResource("FlatButton"),
                Padding = new Thickness(8, 2, 8, 2),
                Margin = new Thickness(0, 0, 6, 0),
                FontSize = 12,
            };
            b.Click += (s, e) =>
            {
                try { onClick(); }
                catch (Exception ex) { MessageBox.Show("Амжилтгүй: " + ex.Message, "MGL ажил"); }
                // Дарсан товчоо өөрийн Click дотор устгахгүйн тулд дараагийн эргэлтэд дахин зурна.
                _outboxSig = null;
                Dispatcher.BeginInvoke(new Action(() => RenderOutbox(WorkTrackingHost.Instance)));
            };
            return b;
        }

        /* ============================================================== */

        private void SetMuted(TextBlock tb, string text, bool error)
        {
            tb.Text = text ?? string.Empty;
            tb.SetResourceReference(TextBlock.ForegroundProperty, error ? "Danger" : "FgMuted");
            tb.Visibility = string.IsNullOrEmpty(tb.Text) ? Visibility.Collapsed : Visibility.Visible;
        }
    }
}
