using System;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using RevitMcpAddin.Licensing.Core;

namespace RevitMcpAddin.Licensing
{
    /// <summary>
    /// «MGL нэвтрэлт» цонх — компанийн бүртгэлээр нэвтэрч, энэ компьютерын лицензийг
    /// шалгана.  Хоёр горим:
    ///   • `fromTool: true` — хэрэгслийн товч дарахад лиценз хүчингүй үед нээгдэнэ;
    ///     токен байвал ӨӨРӨӨ шалгаж, амжилттай бол ӨӨРӨӨ хаагдаж (DialogResult = true)
    ///     хэрэгсэл үргэлжилнэ.
    ///   • `fromTool: false` — «MGL нэвтрэлт» товч: төлөв, дахин шалгах, гарах.
    ///
    /// XAML-гүй (кодоор) — WPF markup-ийн хоёр алхмын эмхэтгэлд шинэ файл нэмэхгүйн тулд.
    /// Нууц үг дискэнд ХЭЗЭЭ Ч хадгалагдахгүй.
    /// </summary>
    internal sealed class LicenseDialog : Window
    {
        // Төлөвийн өнгө — `Ui/MglTheme`-ийн токен (Ok / Danger / FgMuted); Revit-ийн сэдэв солигдоход дагана.  Өнгө ганцаараа биш:
        // амжилт «✓», алдаа «✕» тэмдэгтэй (SetStatus).
        private enum Tone { Muted, Ok, Bad }

        private readonly bool _fromTool;
        private readonly TextBlock _status = new TextBlock { TextWrapping = TextWrapping.Wrap, FontSize = 13 };
        private readonly TextBlock _who = new TextBlock { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 4, 0, 0) };
        private readonly StackPanel _loginPanel = new StackPanel { Margin = new Thickness(0, 12, 0, 0) };
        private readonly TextBox _user = new TextBox { Padding = new Thickness(4, 3, 4, 3) };
        private readonly PasswordBox _pass = new PasswordBox { Padding = new Thickness(4, 3, 4, 3) };
        private readonly Button _loginBtn = MakeButton("Нэвтрэх", 110);
        private readonly Button _checkBtn = MakeButton("Дахин шалгах", 120);
        private readonly Button _signOutBtn = MakeButton("Бүртгэлээс гарах", 130);
        private readonly Button _continueBtn = MakeButton("Үргэлжлүүлэх", 120);
        private readonly Button _closeBtn = MakeButton("Хаах", 80);
        private readonly TextBox _deviceCode = new TextBox
        {
            IsReadOnly = true,
            BorderThickness = new Thickness(0),
            Background = Brushes.Transparent,
            FontFamily = new FontFamily("Consolas"),
        };
        private bool _busy;
        private readonly CancellationTokenSource _cts = new CancellationTokenSource();

        public LicenseDialog(bool fromTool)
        {
            _fromTool = fromTool;
            // Хэмжээ/байрлал (эзний дэлгэцийн ажлын талбарт багтана) + дундын сэдэв (Light/Dark/өндөр контраст).
            Ui.MglWindow.Setup(this, "MGL — Компанийн нэвтрэлт", 470, 0, 420, 0, resizable: false, sizeToContentHeight: true);
            Ui.MglTheme.Apply(this);

            var root = new StackPanel { Margin = new Thickness(20, 16, 20, 16) };
            root.Children.Add(Ui.MglUi.Heading("MGL add-in — компанийн нэвтрэлт"));
            var intro = Ui.MglUi.Muted(
                "MGL add-in компанийн бүртгэлээр нэвтэрмэгц ажиллана. Компьютер бүр өөрийн аюулгүй байдлын " +
                "түлхүүртэй (TPM) — add-in-ийн файлыг хуулж өөр компьютерт тавьсан ч ажиллахгүй. Интернэтгүй " +
                "үед сүүлийн шалгалтаас хойш 12 цаг ажилласаар байна.");
            intro.Margin = new Thickness(0, 6, 0, 12);
            root.Children.Add(intro);

            var statusBox = new Border
            {
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(10, 8, 10, 8),
            };
            statusBox.SetResourceReference(Border.BorderBrushProperty, "Line");
            _who.SetResourceReference(TextBlock.ForegroundProperty, "FgMuted");
            var statusStack = new StackPanel();
            statusStack.Children.Add(_status);
            statusStack.Children.Add(_who);
            statusBox.Child = statusStack;
            root.Children.Add(statusBox);

            var userLabel = new TextBlock { Text = "Нэвтрэх нэр", Margin = new Thickness(0, 0, 0, 3) };
            var passLabel = new TextBlock { Text = "Нууц үг", Margin = new Thickness(0, 8, 0, 3) };
            _loginPanel.Children.Add(userLabel);
            _loginPanel.Children.Add(_user);
            _loginPanel.Children.Add(passLabel);
            _loginPanel.Children.Add(_pass);
            Ui.MglAuto.LabelFor(userLabel, _user);
            Ui.MglAuto.LabelFor(passLabel, _pass);
            Ui.MglUi.Primary(_loginBtn);
            Ui.MglAuto.Name(_deviceCode, "Компьютерын код", "Admin-д энэ кодыг хэлбэл таны компьютерыг таньж зөвшөөрнө");
            var loginRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 10, 0, 0) };
            loginRow.Children.Add(_loginBtn);
            _loginPanel.Children.Add(loginRow);
            root.Children.Add(_loginPanel);

            var codeRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 14, 0, 0) };
            var codeLabel = Ui.MglUi.Muted("Компьютерын код: ");
            codeLabel.VerticalAlignment = VerticalAlignment.Center;
            codeRow.Children.Add(codeLabel);
            _deviceCode.SetResourceReference(Control.ForegroundProperty, "FgMuted");
            codeRow.Children.Add(_deviceCode);
            root.Children.Add(codeRow);

            var buttons = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                HorizontalAlignment = HorizontalAlignment.Right,
                Margin = new Thickness(0, 14, 0, 0),
            };
            buttons.Children.Add(_checkBtn);
            buttons.Children.Add(_signOutBtn);
            buttons.Children.Add(_continueBtn);
            buttons.Children.Add(_closeBtn);
            root.Children.Add(buttons);
            Content = root;

            _loginBtn.Click += async (s, e) => await LoginAsync();
            _checkBtn.Click += async (s, e) => await CheckAsync();
            _signOutBtn.Click += (s, e) => SignOut();
            _continueBtn.Click += (s, e) => { DialogResult = true; };
            _closeBtn.Click += (s, e) => { DialogResult = false; };
            _closeBtn.IsCancel = true;
            _pass.KeyDown += async (s, e) => { if (e.Key == Key.Enter) await LoginAsync(); };
            Closed += (s, e) => { try { _cts.Cancel(); } catch { } };

            Loaded += async (s, e) =>
            {
                Render(LicenseGate.Snapshot(), null);
                LicenseSnapshot snap = LicenseGate.Snapshot();
                if (snap.Status != LeaseStatus.Valid && snap.HasToken) await CheckAsync();
                else if (!snap.HasToken) _user.Focus();
            };
        }

        private async Task LoginAsync()
        {
            if (_busy) return;
            string username = _user.Text.Trim();
            string password = _pass.Password;
            if (username.Length == 0 || password.Length == 0)
            {
                SetStatus("Нэвтрэх нэр, нууц үгээ бичнэ үү.", Tone.Bad);
                return;
            }
            SetBusy(true, "Нэвтэрч, энэ компьютерыг бүртгэж байна…");
            RefreshResult r;
            try
            {
                AddinSettings st = SettingsStore.Load();
                string host = string.IsNullOrWhiteSpace(st.ApiHost) ? AddinSettings.DefaultApiHost : st.ApiHost;
                // ⚠️ 365 хоногийн токен ҮҮСГЭХГҮЙ (1.10.0): нэвтрэх → төхөөрөмжийн түлхүүр бүртгэх → лиценз.
                r = await LicenseGate.SignInAsync(host, username, password, _cts.Token);
                _pass.Clear();
            }
            catch (Exception ex)
            {
                SetBusy(false, null);
                SetStatus(RevitApi.FriendlyError(ex), Tone.Bad);
                return;
            }
            SetBusy(false, null);
            if (!IsLoaded || !IsVisible) return;
            Render(LicenseGate.Snapshot(), r);
            // Хэрэгслийн товчноос ирсэн бол амжилтын дараа шууд үргэлжлүүлнэ.
            if (_fromTool && r.Outcome == RefreshOutcome.Ok) DialogResult = true;
        }

        private async Task CheckAsync()
        {
            if (_busy) return;
            SetBusy(true, "Энэ компьютерыг шалгаж байна…");
            RefreshResult r;
            try
            {
                r = await LicenseGate.RefreshAsync(_cts.Token);
            }
            catch (Exception ex)
            {
                r = RefreshResult.Of(RefreshOutcome.Offline, null, ex.Message);
            }
            SetBusy(false, null);
            if (!IsLoaded || !IsVisible) return;
            Render(LicenseGate.Snapshot(), r);
            // Хэрэгслийн товчноос ирсэн бол амжилтын дараа шууд үргэлжлүүлнэ.
            if (_fromTool && r.Outcome == RefreshOutcome.Ok) DialogResult = true;
        }

        private void SignOut()
        {
            if (_busy) return;
            LicenseGate.SignOut();
            Render(LicenseGate.Snapshot(), null);
            SetStatus("Бүртгэлээс гарлаа. MGL add-in-ийг ашиглахын тулд дахин нэвтэрнэ үү.", Tone.Muted);
        }

        private void Render(LicenseSnapshot snap, RefreshResult last)
        {
            _deviceCode.Text = snap.DeviceShortId ?? "—";
            if (string.IsNullOrEmpty(_user.Text) && !string.IsNullOrEmpty(snap.UserName)) _user.Text = snap.UserName;

            bool valid = snap.Status == LeaseStatus.Valid;
            if (valid)
            {
                LeaseInfo i = snap.Info;
                SetStatus("Лиценз хүчинтэй — энэ компьютер таны бүртгэлээр баталгаажсан.", Tone.Ok);
                _who.Text = (i?.Name ?? snap.UserName ?? "") +
                            (string.IsNullOrEmpty(i?.Role) ? "" : " (" + LicenseText.RoleLabel(i.Role) + ")") +
                            (i == null ? "" : "\nИнтернэтгүй " + i.ExpiresAt.ToLocalTime().ToString("yyyy-MM-dd HH:mm") + " хүртэл ажиллана.") +
                            (i?.Via == "approved" ? "\nAdmin гараар зөвшөөрсөн компьютер." : "") +
                            (snap.DeviceSecurity == "tpm" ? "\nХамгаалалт: TPM түлхүүр." :
                             snap.DeviceSecurity == "software"
                                ? "\nХамгаалалт: програмын түлхүүр (TPM олдсонгүй)." +
                                  (string.IsNullOrEmpty(snap.DeviceKeyNote) ? "" : " " + snap.DeviceKeyNote)
                                : "") +
                            (i != null && i.Security == "legacy"
                                ? "\nАнхаар: хуучин горим — удахгүй дуусна. «Гарах» дараад дахин нэвтэрч төхөөрөмжөө бүртгүүлнэ үү."
                                : "");
            }
            else
            {
                string msg = last?.Message ?? snap.LastMessage ?? LicenseText.ForStatus(snap.Status);
                SetStatus(msg, snap.HasToken ? Tone.Bad : Tone.Muted);
                _who.Text = snap.HasToken && !string.IsNullOrEmpty(snap.UserName) ? "Бүртгэл: " + snap.UserName : string.Empty;
            }

            bool needLogin = !snap.HasToken || last?.Outcome == RefreshOutcome.Unauthorized ||
                             last?.Outcome == RefreshOutcome.NeedEnroll ||
                             snap.LastCode == "UNAUTHORIZED" ||
                             (snap.LastCode != null && Array.IndexOf(LicenseResponse.EnrollCodes, snap.LastCode) >= 0);
            _loginPanel.Visibility = needLogin ? Visibility.Visible : Visibility.Collapsed;
            _checkBtn.Visibility = snap.HasToken && !needLogin ? Visibility.Visible : Visibility.Collapsed;
            _signOutBtn.Visibility = snap.HasToken ? Visibility.Visible : Visibility.Collapsed;
            _continueBtn.Visibility = valid && _fromTool ? Visibility.Visible : Visibility.Collapsed;
            _continueBtn.IsDefault = valid && _fromTool;
            _loginBtn.IsDefault = needLogin;
            _who.Visibility = string.IsNullOrEmpty(_who.Text) ? Visibility.Collapsed : Visibility.Visible;
        }

        private void SetBusy(bool busy, string text)
        {
            _busy = busy;
            _loginBtn.IsEnabled = !busy;
            _checkBtn.IsEnabled = !busy;
            _signOutBtn.IsEnabled = !busy;
            _continueBtn.IsEnabled = !busy;
            Cursor = busy ? Cursors.Wait : null;
            if (busy && text != null) SetStatus(text, Tone.Muted);
        }

        private void SetStatus(string text, Tone tone)
        {
            string t = text ?? string.Empty;
            // Өнгө ганцаараа төлөвийг илтгэхгүй: амжилт «✓», алдаа «✕».
            string glyph = t.Length == 0 ? "" : tone == Tone.Ok ? "✓ " : tone == Tone.Bad ? "✕ " : "";
            _status.Text = glyph + t;
            _status.SetResourceReference(TextBlock.ForegroundProperty, tone == Tone.Ok ? "Ok" : tone == Tone.Bad ? "Danger" : "FgMuted");
        }

        private static Button MakeButton(string text, double minWidth)
        {
            return new Button
            {
                Content = text,
                MinWidth = minWidth,
                Padding = new Thickness(10, 4, 10, 4),
                Margin = new Thickness(6, 0, 0, 0),
            };
        }

    }
}
