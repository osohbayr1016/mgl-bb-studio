using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using Autodesk.Revit.UI;
using RevitMcpAddin.Licensing.Core;

namespace RevitMcpAddin.Licensing
{
    /// <summary>
    /// ЛИЦЕНЗИЙН ХААЛГА — add-in-ий БҮХ товч эхлээд `Ensure()`-ийг дуудна.
    ///
    /// Эзний шаардлага (2026-10-01): add-in зөвхөн компанийн нэр/нууц үгээр нэвтэрсэн,
    /// зөвхөн тухайн ажилтны ирц бүртгүүлдэг АЖЛЫН компьютер дээр ажиллана — DLL-ийг
    /// хуулж өөр газар зарж ашиглах боломжгүй.
    ///
    /// Урсгал (add-in 1.10.0, migration 0375 — төхөөрөмжийн түлхүүртэй):
    ///   1. Нэвтрэх (компанийн нэр + нууц үг) → 24 цагийн session (нууц үгээр дөнгөж нэвтэрсэн токен).
    ///   2. ТӨХӨӨРӨМЖИЙН ТҮЛХҮҮР бүртгэх: TPM / CNG дахь ECDSA P-256 түлхүүр үүсгээд нийтийн хагасыг
    ///      сервер рүү (`/device/enroll`) — нэг удаагийн challenge-д гарын үсэг зурж эзэмшлээ батална.
    ///      Ажлын компьютертэй таарвал шууд зөвшөөрөгдөнө, үгүй бол admin-ийн зөвшөөрөл хүлээнэ.
    ///   3. `POST /api/revit/license` — challenge-ийн proof-тэй; сервер ГАРЫН ҮСЭГТЭЙ 12 цагийн лиценз +
    ///      30 минутын API session + renewal credential олгоно.
    ///   4. Add-in лицензийг шигтгэсэн нийтийн түлхүүрээр шалгана (`LicenseLease.Verify`): гарын үсэг,
    ///      энэ компьютер, энэ компьютерын түлхүүр, хугацаа, цаг ухраагаагүй.
    ///   5. Арын дэвсгэрт: лиценз 1 цаг тутам, session ~20 минут тутам шинэчлэгдэнэ (бүгд түлхүүрээр
    ///      гарын үсэг зурна).  Интернэтгүй үед хуучин лиценз хугацаа дуустал (≤ 12 цаг) ажиллана.
    ///      Сервер «үгүй» гэвэл (хаасан, цуцалсан, ажлаас гарсан, хувилбар хуучирсан) лиценз ШУУД устна.
    ///
    /// ⚠️ ХААЛТТАЙГААР УНАНА (fail-closed): лиценз шалгах явцад алдаа гарвал хэрэгсэл
    ///    ажиллахгүй, харин алдааг цонхонд ил харуулна.
    /// ⚠️ Энэ нь UX + гүн хамгаалалт.  Add-in-ий кодыг өөрчилсөн хүн энэ хаалтыг тойрч болно —
    ///    тиймээс чухал шийдвэр (төхөөрөмж, хувилбар, session) СЕРВЕР талд мөн хэрэгждэг.
    /// </summary>
    public static class LicenseGate
    {
        private static readonly object Sync = new object();
        private static bool _loaded;
        private static string _lease;
        private static DateTimeOffset? _maxSeen;
        private static string _lastCode;
        private static string _lastMessage;
        private static DateTimeOffset? _checkedAt;
        private static string _revitYear;
        private static int _refreshing;
        private static int _sessionRefreshing;
        private static DateTimeOffset _lastAttempt = DateTimeOffset.MinValue;
        private static DateTimeOffset _lastSessionAttempt = DateTimeOffset.MinValue;
        private static volatile bool _deviceMode;
        // `SignOut` / татгалзалтаар нэмэгдэнэ: эхлэхээсээ ӨМНӨ эхэлсэн (хуучин үеийн) арын шинэчлэл дууссан хойно
        // session / credential / лицензийг буцааж сэргээх ёсгүй.
        private static int _generation;
        private static Timer _timer;

        // Төхөөрөмжийн түлхүүрийн кэш.  Түлхүүр БАЙХГҮЙ гэдгийг 30 секунд кэшлэнэ (CNG-ийг давтан
        // шалгахгүйн тулд); бүртгэлийн дараа `InvalidateSigner()`.
        private static readonly object SignerGate = new object();
        private static DeviceSigner _signer;
        private static long _signerUid;
        private static long _signerMissUid;
        private static DateTimeOffset _signerMissUntil = DateTimeOffset.MinValue;

        private static string FilePath => Path.Combine(SettingsStore.Dir, "license.json");

        /// <summary>OnStartup — дискнээс уншаад, шаардлагатай бол арын дэвсгэрт шинэчилнэ.  UI-гүй.</summary>
        public static void Init(string revitYear)
        {
            _revitYear = revitYear;
            try { _deviceMode = DeviceCredentialStore.Has(); } catch { _deviceMode = false; }
            LeaseStatus st;
            LeaseInfo info;
            lock (Sync)
            {
                EnsureLoaded();
                st = VerifyLocked(DateTimeOffset.UtcNow, out info);
            }
            if (HasToken() && (st != LeaseStatus.Valid || LicenseLease.NeedsRefresh(info, DateTimeOffset.UtcNow)))
            {
                // Revit-ийн ачааллыг саатуулахгүйн тулд хэдэн секунд хүлээнэ.
                Task.Run(async () =>
                {
                    await Task.Delay(8000).ConfigureAwait(false);
                    RefreshInBackground(force: true);
                });
            }
            StartTimer();
        }

        /// <summary>Яг одоо хүчинтэй лиценз байна уу (UI-гүй — MCP bridge г.м.).</summary>
        public static bool IsLicensedNow()
        {
            try
            {
                lock (Sync)
                {
                    EnsureLoaded();
                    return VerifyLocked(DateTimeOffset.UtcNow, out _) == LeaseStatus.Valid;
                }
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// Товч бүрийн эхэнд (Revit-ийн UI thread).  Хүчинтэй бол шууд `true`; үгүй бол
        /// «MGL нэвтрэлт» цонхыг нээж (токен байвал өөрөө шалгана), амжилттай болсон
        /// үед л `true`.
        /// </summary>
        public static bool Ensure()
        {
            LeaseStatus st;
            LeaseInfo info;
            try
            {
                lock (Sync)
                {
                    EnsureLoaded();
                    st = VerifyLocked(DateTimeOffset.UtcNow, out info);
                }
            }
            catch
            {
                st = LeaseStatus.Missing;
                info = null;
            }

            if (st == LeaseStatus.Valid)
            {
                if (LicenseLease.NeedsRefresh(info, DateTimeOffset.UtcNow)) RefreshInBackground(force: false);
                // Revit дөнгөж асаад / компьютер унтраад сэрсний дараа session байхгүй байж болно — хэрэгсэл
                // токенгүй эхэлж «нэвтрээгүй» гэж андуурахгүйн тулд (хамгийн ихдээ 12 с) хүлээнэ.
                WaitForSession();
                return true;
            }

            try
            {
                var dlg = new LicenseDialog(fromTool: true);
                bool? ok = App.ShowOwned(dlg);
                return ok == true && IsLicensedNow();
            }
            catch (Exception ex)
            {
                TaskDialog.Show("MGL", "Нэвтрэлтийн цонхыг нээж чадсангүй:\n\n" + ex.Message);
                return false;
            }
        }

        /// <summary>
        /// Session байхгүй / дуусахад ойртсон бол СИНХРОН нэг удаа шинэчилнэ (≤ 12 секунд; 60 секундэд нэгээс олон
        /// удаа оролдохгүй — интернэтгүй үед UI-г давтан гацаахгүй).  Хэзээ ч шидэхгүй.
        /// </summary>
        private static void WaitForSession()
        {
            try
            {
                if (!_deviceMode || !DeviceSession.NeedsRefresh(DateTimeOffset.UtcNow)) return;
                if (DateTimeOffset.UtcNow - _lastSessionAttempt < TimeSpan.FromSeconds(60)) return;
                if (Interlocked.CompareExchange(ref _sessionRefreshing, 1, 0) != 0) return;
                _lastSessionAttempt = DateTimeOffset.UtcNow;
                try
                {
                    // ⚠️ CTS-ийг ажил ДУУССАНЫ дараа л устгана: 12 с-д хүлээлт дуусахад ажил үргэлжилж болно —
                    //    `using` нь түүний токеныг ажлын дунд устгадаг (net48-д ObjectDisposedException).
                    var cts = new CancellationTokenSource(TimeSpan.FromSeconds(12));
                    Task t = Task.Run(() => RefreshSessionAsync(cts.Token));
                    t.ContinueWith(_ => cts.Dispose(), TaskScheduler.Default);
                    t.Wait(TimeSpan.FromSeconds(12));
                }
                finally
                {
                    Interlocked.Exchange(ref _sessionRefreshing, 0);
                }
            }
            catch
            {
                // Session-гүйгээр үргэлжилнэ — дуудлага 401 өгвөл арын шинэчлэл дараагийн удаад нөхнө.
            }
        }

        /// <summary>Цонхонд харуулах одоогийн төлөв.</summary>
        public static LicenseSnapshot Snapshot()
        {
            AddinSettings settings = SafeSettings();
            string credential = SafeCredential();
            lock (Sync)
            {
                EnsureLoaded();
                LeaseStatus st = VerifyLocked(DateTimeOffset.UtcNow, out LeaseInfo info);
                DeviceSigner signer = GetSigner(TokenPeek.LeaseSub(_lease) ?? TokenPeek.JwtSub(credential), false, out _);
                return new LicenseSnapshot
                {
                    Status = st,
                    Info = info,
                    LastCode = _lastCode,
                    LastMessage = _lastMessage,
                    CheckedAt = _checkedAt,
                    HasToken = HasToken(settings),
                    UserName = settings?.Username,
                    DeviceShortId = SafeShortId(),
                    DeviceSecurity = signer?.SecurityLevel,
                    DeviceKeyNote = signer?.FallbackReason,
                    DeviceKeyShortId = signer != null && signer.KeyId != null && signer.KeyId.Length >= 8
                        ? signer.KeyId.Substring(0, 8)
                        : null,
                };
            }
        }

        /// <summary>
        /// ХЯНАЛТГҮЙ багцын горим (`BatchQto`): UI ХАРУУЛАХГҮЙ (хүн байхгүй — TaskDialog түгжинэ).  Лиценз
        /// хүчингүй, эсвэл төхөөрөмжийн session дуусахад ойртсон бол СИНХРОН нэг удаа шинэчилж оролдоод
        /// (≤ 45 секунд), хүчинтэй лиценз БА токен байгаа эсэхийг буцаана.  Хэзээ ч шидэхгүй.
        /// </summary>
        public static bool EnsureForBatch()
        {
            try
            {
                bool licensed = IsLicensedNow();
                bool needSession = _deviceMode && DeviceSession.NeedsRefresh(DateTimeOffset.UtcNow);
                if (!licensed || needSession)
                {
                    using (var cts = new CancellationTokenSource(TimeSpan.FromSeconds(45)))
                    {
                        // Task.Run: Revit-ийн sync context дээр `.GetAwaiter().GetResult()` DEADLOCK-ээс сэргийлнэ.
                        Task.Run(() => licensed ? RefreshSessionAsync(cts.Token) : RefreshAsync(cts.Token)).GetAwaiter().GetResult();
                    }
                }
                return IsLicensedNow();
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// MCP bridge / UI-гүй дуудагчид: яг одоо хүчинтэй төхөөрөмжийн session байна уу
        /// (`SettingsStore.Load()` нь session токеныг `Token`-д шигтгэдэг).
        /// </summary>
        public static bool HasDeviceSession()
        {
            return DeviceSession.TryGetToken(out _);
        }

        /// <summary>`SettingsStore.Load()` бүрт (хямд): session дуусахад ойртсон бол арын дэвсгэрт шинэчилнэ.</summary>
        internal static void OnSettingsRead()
        {
            try
            {
                if (_deviceMode && DeviceSession.NeedsRefresh(DateTimeOffset.UtcNow)) RefreshSessionInBackground();
            }
            catch
            {
                // Хэзээ ч Load()-ийг унагаахгүй.
            }
        }

        /// <summary>Арын дэвсгэрт шинэчилнэ (нэг зэрэг нэг л, амжаагүй бол 10 минут хүлээнэ).</summary>
        public static void RefreshInBackground(bool force = false)
        {
            if (!HasToken()) return;
            if (!force && DateTimeOffset.UtcNow - _lastAttempt < TimeSpan.FromMinutes(10)) return;
            if (Interlocked.CompareExchange(ref _refreshing, 1, 0) != 0) return;
            Task.Run(async () =>
            {
                try { await RefreshAsync(CancellationToken.None).ConfigureAwait(false); }
                catch { /* арын дэвсгэр — чимээгүй; дараагийн товч дахин оролдоно */ }
                finally { Interlocked.Exchange(ref _refreshing, 0); }
            });
        }

        /// <summary>Төхөөрөмжийн session-ийг арын дэвсгэрт шинэчилнэ (2 минутаас олон дахин оролдохгүй).</summary>
        private static void RefreshSessionInBackground()
        {
            if (!_deviceMode) return;
            if (DateTimeOffset.UtcNow - _lastSessionAttempt < TimeSpan.FromMinutes(2)) return;
            if (Interlocked.CompareExchange(ref _sessionRefreshing, 1, 0) != 0) return;
            _lastSessionAttempt = DateTimeOffset.UtcNow;
            Task.Run(async () =>
            {
                try { await RefreshSessionAsync(CancellationToken.None).ConfigureAwait(false); }
                catch { /* арын дэвсгэр */ }
                finally { Interlocked.Exchange(ref _sessionRefreshing, 0); }
            });
        }

        private static void StartTimer()
        {
            try
            {
                if (_timer != null) return;
                // 5 минут тутам: лицензийн шинэчлэл (1 цаг) ба session (~20 минут)-ийг хугацаанд нь хийнэ.
                // Товч дарахыг хүлээхгүй — Revit-ийг шөнөжин нээлттэй орхисон ч лиценз дуусахгүй.
                _timer = new Timer(_ => Tick(), null, TimeSpan.FromMinutes(2), TimeSpan.FromMinutes(5));
            }
            catch
            {
                // Timer үүсэхгүй бол товч дарах үед шинэчлэгдэнэ.
            }
        }

        private static void Tick()
        {
            try
            {
                if (!_deviceMode && !HasToken()) return;
                LeaseStatus st;
                LeaseInfo info;
                lock (Sync)
                {
                    EnsureLoaded();
                    st = VerifyLocked(DateTimeOffset.UtcNow, out info);
                }
                DateTimeOffset now = DateTimeOffset.UtcNow;
                if (st != LeaseStatus.Valid || LicenseLease.NeedsRefresh(info, now)) RefreshInBackground(force: false);
                // Лицензийн шинэчлэл 10 минутын хязгаарт орж ЭХЛЭЭГҮЙ ч session-оо тусад нь шинэчилнэ (лицензийн
                // шинэчлэл өөрөө session авчирдаг тул тэр ажиллаж байхад давхардуулахгүй).
                if (st == LeaseStatus.Valid && _deviceMode && DeviceSession.NeedsRefresh(now) &&
                    Volatile.Read(ref _refreshing) == 0)
                    RefreshSessionInBackground();
            }
            catch
            {
                // Арын дэвсгэр — чимээгүй.
            }
        }

        /// <summary>Сервераас лиценз авах / шинэчлэх (хадгалсан credential-аар).  Хэзээ ч шидэхгүй.</summary>
        public static async Task<RefreshResult> RefreshAsync(CancellationToken ct)
        {
            _lastAttempt = DateTimeOffset.UtcNow;
            AddinSettings settings = SafeSettings();
            string bearer = DeviceCredentialStore.Load();
            // Хуучин (≤ 1.9.x) 365 хоногийн токен — зөвхөн ШИЛЖИЛТИЙН үед; төхөөрөмжийн горимд шилжмэгц устна.
            // ⚠️ `settings.Token` БИШ: `Load()` түүнд session-ийг шигтгэдэг — session лиценз авах bearer болохгүй.
            if (string.IsNullOrEmpty(bearer)) bearer = SettingsStore.LegacyToken();
            if (string.IsNullOrEmpty(bearer))
                return RefreshResult.Of(RefreshOutcome.NoToken, null, LicenseText.ForStatus(LeaseStatus.Missing));

            DeviceProfile profile;
            try
            {
                profile = await Task.Run(() => HardwareProbe.Read()).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                return Remember(RefreshOutcome.Offline, null, "Компьютерын мэдээллийг уншиж чадсангүй: " + ex.Message, clear: false);
            }
            return await RequestLicenseAsync(HostOf(settings), bearer, profile, ct).ConfigureAwait(false);
        }

        /// <summary>
        /// Нэвтрэх: нэр + нууц үг → төхөөрөмжийн түлхүүр бүртгэх (шаардлагатай бол) → лиценз.
        /// Нэвтрэх алдаа (буруу нууц үг, сүлжээ) `ApiException` / `HttpRequestException`-ээр ШИДЭГДЭНЭ —
        /// дуудагч `RevitApi.FriendlyError`-оор харуулна.  Бусад үр дүн `RefreshResult`.
        ///
        /// ⚠️ 365 хоногийн `mcp` токен ЭНД ХЭЗЭЭ Ч үүсгэгдэхгүй (өмнөх `MintLongTokenAsync`).  Нууц үг
        ///    дискэнд хадгалагдахгүй; зөвхөн DPAPI-аар шифрлэгдсэн renewal credential үлдэнэ.
        /// </summary>
        public static async Task<RefreshResult> SignInAsync(string host, string username, string password, CancellationToken ct)
        {
            _lastAttempt = DateTimeOffset.UtcNow;
            var login = await ApiClient.LoginAsync(host, username, password).ConfigureAwait(false);
            string loginToken = login.token;

            AddinSettings st = SettingsStore.Load();
            st.ApiHost = host;
            st.Username = username;
            SettingsStore.Save(st);

            DeviceProfile profile;
            try
            {
                profile = await Task.Run(() => HardwareProbe.Read()).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                return Remember(RefreshOutcome.Offline, null, "Компьютерын мэдээллийг уншиж чадсангүй: " + ex.Message, clear: false);
            }

            // Түлхүүр ERP ажилтан тутам (`DeviceKeyStore.ForUser`) — нэвтэрсэн токены `sub`-аас.
            long? uid = TokenPeek.JwtSub(loginToken);

            // 1) Түлхүүрийг бүртгүүлнэ (сервер аль хэдийн мэддэг бол idempotent).
            EnrollResult er = null;
            for (int attempt = 0; er == null; attempt++)
            {
                DeviceSigner signer = GetSigner(uid, true, out string keyError);
                if (signer == null)
                {
                    return Remember(RefreshOutcome.Denied, "DEVICE_KEY_UNAVAILABLE",
                        keyError ?? "Энэ компьютер дээр төхөөрөмжийн түлхүүр үүсгэж чадсангүй.", clear: false);
                }

                ProofOutcome pr = await BuildProofAsync(host, loginToken, profile.DeviceId, DeviceProof.PurposeEnroll, signer, ct)
                    .ConfigureAwait(false);
                if (pr.Failure != null) return pr.Failure;

                HttpReply enrollReply = await PostAsync(host, "/api/revit/device/enroll", loginToken, new
                {
                    device_id = profile.DeviceId,
                    hw = new { gpus = profile.Gpus, cores = profile.Cores, screens = profile.Screens },
                    addin_version = BuildInfo.Version,
                    revit_year = _revitYear,
                    public_key = new { x = signer.X, y = signer.Y },
                    security_level = signer.SecurityLevel,
                    proof = pr.Proof,
                }, ct).ConfigureAwait(false);
                if (enrollReply.Offline)
                {
                    return Remember(RefreshOutcome.Offline, null,
                        "Сервертэй холбогдож чадсангүй — интернэт холболтоо шалгана уу.", clear: false);
                }
                EnrollResult parsed = DeviceResponses.ParseEnroll(enrollReply.Status, enrollReply.Text);
                if (parsed.Ok)
                {
                    er = parsed;
                    break;
                }
                LicenseResponse.Result denied = LicenseResponse.Classify(enrollReply.Status, enrollReply.Text);
                // 409 DEVICE_KEY_MISMATCH = сервер ЭНЭ түлхүүрийг энэ бүртгэлд ХЭЗЭЭ Ч хүлээн авахгүй (admin цуцалсан /
                // өөр бүртгэлд ашиглагдсан / бүртгэл өөр түлхүүртэй).  Тийм түлхүүр хадгалаад ашиггүй — НЭГ удаа
                // устгаад шинэ түлхүүрээр дахин оролдоно (нууц үгээр дөнгөж нэвтэрсэн үед л).  Шинэ түлхүүр ч ердийн
                // шийдвэрээр явна: цуцалсан бүртгэл → DEVICE_REVOKED (admin «хүлээлгэд» буцаахыг хүлээнэ).
                if (attempt == 0 && enrollReply.Status == 409 && denied.Code == "DEVICE_KEY_MISMATCH" && uid.HasValue)
                {
                    RotateSigner(uid.Value);
                    continue;
                }
                return HandleNonOk(denied, keepLease: false);
            }

            if (!string.IsNullOrEmpty(er.Credential))
            {
                DeviceCredentialStore.Save(er.Credential);
                _deviceMode = true;
            }
            if (er.DeviceStatus == "pending")
            {
                // Admin зөвшөөрөх хүртэл лиценз ҮГҮЙ.  Credential хадгалагдсан тул зөвшөөрсний дараа
                // нууц үггүйгээр автоматаар лиценз авна.
                return Remember(RefreshOutcome.Denied, "DEVICE_PENDING",
                    string.IsNullOrEmpty(er.Message) ? "Энэ төхөөрөмжийг ашиглах зөвшөөрөл хүлээгдэж байна. Системийн админд хандана уу." : er.Message,
                    clear: true);
            }

            // 2) Лиценз (proof-тэй).
            return await RequestLicenseAsync(host, loginToken, profile, ct).ConfigureAwait(false);
        }

        /// <summary>Гарах — токен, credential, session, лицензийг энэ компьютероос арилгана (TPM түлхүүр ҮЛДЭНЭ).</summary>
        public static void SignOut()
        {
            Interlocked.Increment(ref _generation);
            try { SettingsStore.ClearStoredToken(); } catch { }
            try { DeviceCredentialStore.Clear(); } catch { }
            DeviceSession.Clear();
            _deviceMode = false;
            lock (Sync)
            {
                EnsureLoaded();
                _lease = null;
                _lastCode = null;
                _lastMessage = null;
                SaveLocked();
            }
        }

        // ── сервертэй харилцах ───────────────────────────────────────────

        private sealed class HttpReply
        {
            public int Status;
            public string Text;
            public bool Offline;
        }

        private sealed class ProofOutcome
        {
            public object Proof;
            public RefreshResult Failure;
        }

        private static async Task<HttpReply> PostAsync(string host, string path, string bearer, object body, CancellationToken ct)
        {
            try
            {
                using (var cts = CancellationTokenSource.CreateLinkedTokenSource(ct))
                using (var req = new HttpRequestMessage(HttpMethod.Post, ApiClient.Url(host, path)))
                {
                    cts.CancelAfter(TimeSpan.FromSeconds(20));
                    req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
                    req.Content = ApiClient.JsonContent(body);
                    using (HttpResponseMessage res = await ApiClient.Http.SendAsync(req, cts.Token).ConfigureAwait(false))
                    {
                        string text = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
                        return new HttpReply { Status = (int)res.StatusCode, Text = text };
                    }
                }
            }
            catch (Exception ex) when (ex is HttpRequestException || ex is OperationCanceledException)
            {
                return new HttpReply { Offline = true };
            }
        }

        /// <summary>
        /// Серверээс нэг удаагийн challenge авч, төхөөрөмжийн түлхүүрээр гарын үсэг зурна.
        /// ⚠️ Challenge нь хэрэглэгч + төхөөрөмж + зорилгод уяатай, 2 минутын настай, НЭГ удаагийн —
        ///    тиймээс энэ proof-ыг хулгайлсан ч дахин ашиглах боломжгүй.
        /// </summary>
        private static async Task<ProofOutcome> BuildProofAsync(
            string host, string bearer, string deviceId, string purpose, DeviceSigner signer, CancellationToken ct)
        {
            HttpReply reply = await PostAsync(host, "/api/revit/device/challenge", bearer, new
            {
                device_id = deviceId,
                purpose,
                addin_version = BuildInfo.Version,
            }, ct).ConfigureAwait(false);
            if (reply.Offline)
            {
                return new ProofOutcome
                {
                    Failure = Remember(RefreshOutcome.Offline, null,
                        "Сервертэй холбогдож чадсангүй — интернэт холболтоо шалгана уу.", clear: false),
                };
            }
            ChallengeResult ch = DeviceResponses.ParseChallenge(reply.Status, reply.Text);
            if (!ch.Ok)
            {
                return new ProofOutcome { Failure = HandleNonOk(LicenseResponse.Classify(reply.Status, reply.Text), keepLease: false) };
            }
            // Сервер өөр түлхүүр хүлээж байна (өөр түлхүүртэй бүртгэл) — гарын үсэг зурахгүй.
            if (!string.IsNullOrEmpty(ch.KeyId) && !string.Equals(ch.KeyId, signer.KeyId, StringComparison.OrdinalIgnoreCase))
            {
                return new ProofOutcome
                {
                    Failure = Remember(RefreshOutcome.NeedEnroll, "DEVICE_KEY_MISMATCH",
                        "Төхөөрөмжийн түлхүүр бүртгэлтэй таарахгүй байна. Системийн админд хандана уу.", clear: true),
                };
            }
            string signature;
            try
            {
                signature = signer.Sign(DeviceProof.Message(purpose, ch.ChallengeId, ch.Nonce, ch.UserId, deviceId, signer.KeyId));
            }
            catch (Exception)
            {
                // Түлхүүр алга болсон (TPM цэвэрлэсэн, Windows профайл солигдсон) — дахин бүртгүүлнэ.
                InvalidateSigner();
                return new ProofOutcome
                {
                    Failure = Remember(RefreshOutcome.NeedEnroll, "DEVICE_NOT_ENROLLED",
                        "Төхөөрөмжийн түлхүүр олдсонгүй. Дахин нэвтэрч бүртгүүлнэ үү.", clear: true),
                };
            }
            return new ProofOutcome { Proof = new { challenge_id = ch.ChallengeId, signature } };
        }

        /// <summary>`POST /api/revit/license` — түлхүүртэй бол proof-тэй.</summary>
        private static async Task<RefreshResult> RequestLicenseAsync(
            string host, string bearer, DeviceProfile profile, CancellationToken ct)
        {
            int gen = Volatile.Read(ref _generation);
            DeviceSigner signer = GetSigner(TokenPeek.JwtSub(bearer), false, out _);
            // ⚠️ Төхөөрөмж ӨМНӨ нь түлхүүртэй бүртгэгдсэн (credential байна) атлаа түлхүүрийг ОДОО нээж чадахгүй байвал
            //    (TPM завгүй, сэрсний дараах түр алдаа) proof-гүй хүсэлт СЕРВЕР рүү илгээхгүй: тэр нь
            //    DEVICE_PROOF_REQUIRED татгалзал болж лиценз + session-ийг ШУУД устгаад, сервер дээрх
            //    төлвийг бохирдуулна.  Хуучин лиценз хэвээр (дуустал), цонх «дахин нэвтэрнэ үү» гэж хэлнэ.
            if (signer == null && (_deviceMode || DeviceCredentialStore.Has()))
            {
                return Remember(RefreshOutcome.NeedEnroll, "KEY_UNAVAILABLE",
                    "Төхөөрөмжийн түлхүүрийг нээж чадсангүй. Түр хүлээгээд дахин оролдоно уу — үргэлжилбэл дахин нэвтэрч бүртгүүлнэ үү.",
                    clear: false);
            }
            object proof = null;
            if (signer != null)
            {
                ProofOutcome pr = await BuildProofAsync(host, bearer, profile.DeviceId, DeviceProof.PurposeLicense, signer, ct)
                    .ConfigureAwait(false);
                if (pr.Failure != null) return pr.Failure;
                proof = pr.Proof;
            }

            HttpReply reply = await PostAsync(host, "/api/revit/license", bearer, new
            {
                device_id = profile.DeviceId,
                hw = new { gpus = profile.Gpus, cores = profile.Cores, screens = profile.Screens },
                addin_version = BuildInfo.Version,
                revit_year = _revitYear,
                proof,
            }, ct).ConfigureAwait(false);
            if (reply.Offline)
            {
                return Remember(RefreshOutcome.Offline, null,
                    "Сервертэй холбогдож чадсангүй — интернэт холболтоо шалгана уу.", clear: false);
            }

            LicenseResponse.Result r = LicenseResponse.Classify(reply.Status, reply.Text);
            if (r.Kind != LicenseResponse.Kind.Ok) return HandleNonOk(r, keepLease: true);

            DateTimeOffset now = DateTimeOffset.UtcNow;
            LeaseStatus st = LicenseLease.Verify(r.Lease, LicenseKeys.Production, profile.DeviceId, signer?.KeyId, now, null, out LeaseInfo info);
            if (st != LeaseStatus.Valid)
            {
                // Сервер манай мэдэхгүй түлхүүрээр гарын үсэг зурсан (add-in хуучирсан эсвэл
                // хуурамч сервер) — хадгалахгүй, одоогийн төлөв хэвээр.
                string msg = st == LeaseStatus.UnknownKey || st == LeaseStatus.BadSignature
                    ? "Серверийн лицензийг энэ add-in таньсангүй. Add-in-ийг шинэчилнэ үү (admin-д хандана уу)."
                    : LicenseText.ForStatus(st);
                return Remember(RefreshOutcome.InvalidLease, st.ToString(), msg, clear: false);
            }
            // Энэ хугацаанд SignOut / татгалзал болсон бол (хуучин үеийн хариу) юу ч сэргээхгүй.
            if (gen != Volatile.Read(ref _generation))
                return RefreshResult.Of(RefreshOutcome.Offline, null, null);
            lock (Sync)
            {
                _lease = r.Lease;
                _maxSeen = Max(_maxSeen, now);
                _lastCode = null;
                _lastMessage = null;
                _checkedAt = now;
                SaveLocked();
            }
            if (!string.IsNullOrEmpty(r.Credential))
            {
                DeviceCredentialStore.Save(r.Credential);
                _deviceMode = true;
                // Төхөөрөмжийн горимд шилжлээ — 365 хоногийн хуучин токен дискэнд ҮЛДЭХГҮЙ.
                try { SettingsStore.ClearStoredToken(); } catch { }
            }
            if (!string.IsNullOrEmpty(r.SessionToken))
            {
                DeviceSession.Set(r.SessionToken, r.SessionExpiresAt ?? now.AddMinutes(30));
            }
            return RefreshResult.Of(RefreshOutcome.Ok, null, null, info);
        }

        /// <summary>Session-ийг түлхүүрийн proof-оор шинэчилнэ (лиценз биш).  Хэзээ ч шидэхгүй.</summary>
        private static async Task<RefreshResult> RefreshSessionAsync(CancellationToken ct)
        {
            int gen = Volatile.Read(ref _generation);
            string credential = DeviceCredentialStore.Load();
            DeviceSigner signer = GetSigner(TokenPeek.JwtSub(credential), false, out _);
            if (string.IsNullOrEmpty(credential) || signer == null)
                return RefreshResult.Of(RefreshOutcome.NoToken, null, null);

            string host = HostOf(SafeSettings());
            string deviceId = SafeDeviceId();
            if (deviceId == null) return RefreshResult.Of(RefreshOutcome.Offline, null, null);

            ProofOutcome pr = await BuildProofAsync(host, credential, deviceId, DeviceProof.PurposeSession, signer, ct)
                .ConfigureAwait(false);
            if (pr.Failure != null) return pr.Failure;

            HttpReply reply = await PostAsync(host, "/api/revit/device/session", credential, new
            {
                device_id = deviceId,
                addin_version = BuildInfo.Version,
                proof = pr.Proof,
            }, ct).ConfigureAwait(false);
            if (reply.Offline)
                return Remember(RefreshOutcome.Offline, null, "Сервертэй холбогдож чадсангүй.", clear: false);

            SessionResult sr = DeviceResponses.ParseSession(reply.Status, reply.Text);
            if (!sr.Ok) return HandleNonOk(LicenseResponse.Classify(reply.Status, reply.Text), keepLease: true);

            if (gen != Volatile.Read(ref _generation))
                return RefreshResult.Of(RefreshOutcome.Offline, null, null); // SignOut / татгалзалтын дараах хуучин хариу
            DeviceSession.Set(sr.Token, sr.ExpiresAt ?? DateTimeOffset.UtcNow.AddMinutes(30));
            if (!string.IsNullOrEmpty(sr.Credential)) DeviceCredentialStore.Save(sr.Credential);
            return RefreshResult.Of(RefreshOutcome.Ok, null, null);
        }

        /// <summary>Ok биш хариуг ангилж, төлөвийг хадгална (Denied → лиценз + session ШУУД устна).</summary>
        private static RefreshResult HandleNonOk(LicenseResponse.Result r, bool keepLease)
        {
            switch (r.Kind)
            {
                case LicenseResponse.Kind.Unauthorized:
                    // Credential / токен хүчингүй — дахин нэвтрэх хэрэгтэй.
                    DeviceCredentialStore.Clear();
                    _deviceMode = false;
                    return Remember(RefreshOutcome.Unauthorized, r.Code, r.Message, clear: true);
                case LicenseResponse.Kind.NeedEnroll:
                    return Remember(RefreshOutcome.NeedEnroll, r.Code, r.Message, clear: true);
                case LicenseResponse.Kind.Denied:
                    // Сервер «үгүй» гэв — хадгалсан лиценз ШУУД устна (хаах, цуцлах, ажлаас гаргах шууд хүчинтэй).
                    return Remember(RefreshOutcome.Denied, r.Code, r.Message, clear: true);
                case LicenseResponse.Kind.NotReady:
                    return Remember(RefreshOutcome.ServerNotReady, r.Code, r.Message, clear: false);
                default:
                    return Remember(RefreshOutcome.Offline, r.Code, r.Message, clear: false);
            }
        }

        // ── төхөөрөмжийн түлхүүр ──────────────────────────────────────────

        /// <summary>
        /// ЭНЭ ажилтны (`userId`) төхөөрөмжийн түлхүүр.  `userId` тодорхойгүй бол null — add-in түлхүүргүй мэт
        /// ажиллана (сервер түлхүүр шаардвал «дахин нэвтэрнэ үү»).
        /// </summary>
        private static DeviceSigner GetSigner(long? userId, bool createIfMissing, out string error)
        {
            error = null;
            if (!userId.HasValue || userId.Value <= 0)
            {
                error = "Ажилтны бүртгэл тодорхойгүй байна — дахин нэвтэрнэ үү.";
                return null;
            }
            long uid = userId.Value;
            lock (SignerGate)
            {
                if (_signer != null && _signerUid == uid) return _signer;
                DateTimeOffset now = DateTimeOffset.UtcNow;
                if (!createIfMissing && _signerMissUid == uid && now < _signerMissUntil) return null;
                try
                {
                    DeviceKeyStore store = DeviceKeyStore.ForUser(uid);
                    DeviceSigner s = createIfMissing ? store.OpenOrCreate(out error) : store.TryOpenExisting();
                    if (s != null)
                    {
                        _signer = s;
                        _signerUid = uid;
                        return s;
                    }
                }
                catch (Exception ex)
                {
                    error = ex.Message;
                }
                _signerMissUid = uid;
                _signerMissUntil = now.AddSeconds(30);
                return null;
            }
        }

        private static void InvalidateSigner()
        {
            lock (SignerGate)
            {
                _signer = null;
                _signerUid = 0;
                _signerMissUntil = DateTimeOffset.MinValue;
            }
        }

        /// <summary>Сервер хэзээ ч хүлээн авахгүй түлхүүрийг устгана (дараагийн `GetSigner(…, true)` шинээр үүсгэнэ).</summary>
        private static void RotateSigner(long userId)
        {
            lock (SignerGate)
            {
                try { DeviceKeyStore.ForUser(userId).Delete(); } catch { }
                _signer = null;
                _signerUid = 0;
                _signerMissUntil = DateTimeOffset.MinValue;
            }
        }

        // ── дотоод ──────────────────────────────────────────────────────

        private static RefreshResult Remember(RefreshOutcome outcome, string code, string message, bool clear)
        {
            if (clear)
            {
                Interlocked.Increment(ref _generation);
                DeviceSession.Clear();
            }
            lock (Sync)
            {
                EnsureLoaded();
                if (clear) _lease = null;
                _lastCode = code;
                _lastMessage = message;
                _checkedAt = DateTimeOffset.UtcNow;
                SaveLocked();
            }
            return RefreshResult.Of(outcome, code, message);
        }

        private static LeaseStatus VerifyLocked(DateTimeOffset now, out LeaseInfo info)
        {
            // Лиценз `dk`-тэй бол ТҮҮНИЙ ажилтны (`sub`) түлхүүртэй тулгана — гарын үсгийг Verify шалгана.
            LeaseStatus st = LicenseLease.Verify(_lease, LicenseKeys.Production, SafeDeviceId(),
                SafeKeyId(TokenPeek.LeaseSub(_lease)), now, _maxSeen, out info);
            if (st == LeaseStatus.Valid && (!_maxSeen.HasValue || now - _maxSeen.Value > TimeSpan.FromMinutes(30)))
            {
                // Цаг ухраахыг илрүүлэх «хамгийн хожуу харсан цаг»-ийг урагшлуулна.
                _maxSeen = Max(_maxSeen, now);
                SaveLocked();
            }
            return st;
        }

        private static void EnsureLoaded()
        {
            if (_loaded) return;
            _loaded = true;
            try
            {
                if (!File.Exists(FilePath)) return;
                LicenseFile f = JsonSerializer.Deserialize<LicenseFile>(File.ReadAllText(FilePath));
                if (f == null) return;
                _lease = f.Lease;
                _maxSeen = f.MaxSeenUtc;
                _lastCode = f.LastCode;
                _lastMessage = f.LastMessage;
                _checkedAt = f.CheckedAtUtc;
            }
            catch
            {
                // Гэмтсэн файл — лицензгүй эхэлнэ (дахин шалгана).
            }
        }

        private static void SaveLocked()
        {
            try
            {
                Directory.CreateDirectory(SettingsStore.Dir);
                string json = JsonSerializer.Serialize(new LicenseFile
                {
                    Lease = _lease,
                    MaxSeenUtc = _maxSeen,
                    LastCode = _lastCode,
                    LastMessage = _lastMessage,
                    CheckedAtUtc = _checkedAt,
                });
                string tmp = FilePath + ".tmp";
                File.WriteAllText(tmp, json);
                if (File.Exists(FilePath)) File.Replace(tmp, FilePath, null);
                else File.Move(tmp, FilePath);
            }
            catch
            {
                // Диск бичигдэхгүй ч санах ой дахь лиценз энэ сессэд хүчинтэй.
            }
        }

        private static bool HasToken()
        {
            return HasToken(SafeSettings());
        }

        private static bool HasToken(AddinSettings settings)
        {
            if (_deviceMode) return true;
            try { if (DeviceCredentialStore.Has()) return true; } catch { }
            return !string.IsNullOrEmpty(settings?.Token);
        }

        private static string HostOf(AddinSettings settings)
        {
            return string.IsNullOrWhiteSpace(settings?.ApiHost) ? AddinSettings.DefaultApiHost : settings.ApiHost;
        }

        private static AddinSettings SafeSettings()
        {
            try { return SettingsStore.Load(); } catch { return null; }
        }

        private static string SafeDeviceId()
        {
            try { return HardwareProbe.DeviceId(); } catch { return null; }
        }

        private static string SafeKeyId(long? userId)
        {
            try { return GetSigner(userId, false, out _)?.KeyId; } catch { return null; }
        }

        private static string SafeCredential()
        {
            try { return DeviceCredentialStore.Load(); } catch { return null; }
        }

        private static string SafeShortId()
        {
            string id = SafeDeviceId();
            return id != null && id.Length >= 8 ? id.Substring(0, 8) : id;
        }

        private static DateTimeOffset Max(DateTimeOffset? a, DateTimeOffset b) => a.HasValue && a.Value > b ? a.Value : b;

        private sealed class LicenseFile
        {
            [JsonPropertyName("lease")] public string Lease { get; set; }
            [JsonPropertyName("max_seen_utc")] public DateTimeOffset? MaxSeenUtc { get; set; }
            [JsonPropertyName("last_code")] public string LastCode { get; set; }
            [JsonPropertyName("last_message")] public string LastMessage { get; set; }
            [JsonPropertyName("checked_at_utc")] public DateTimeOffset? CheckedAtUtc { get; set; }
        }
    }

    public enum RefreshOutcome { Ok, Denied, Unauthorized, NeedEnroll, Offline, NoToken, ServerNotReady, InvalidLease }

    public sealed class RefreshResult
    {
        public RefreshOutcome Outcome { get; private set; }
        public string Code { get; private set; }
        public string Message { get; private set; }
        public LeaseInfo Info { get; private set; }

        internal static RefreshResult Of(RefreshOutcome o, string code, string message, LeaseInfo info = null)
        {
            return new RefreshResult { Outcome = o, Code = code, Message = message, Info = info };
        }
    }

    public sealed class LicenseSnapshot
    {
        public LeaseStatus Status { get; set; }
        public LeaseInfo Info { get; set; }
        public string LastCode { get; set; }
        public string LastMessage { get; set; }
        public DateTimeOffset? CheckedAt { get; set; }
        public bool HasToken { get; set; }
        public string UserName { get; set; }
        public string DeviceShortId { get; set; }
        /// <summary>tpm | software | null (энэ компьютерт түлхүүр байхгүй).</summary>
        public string DeviceSecurity { get; set; }
        public string DeviceKeyShortId { get; set; }
        /// <summary>TPM-ийн оронд програмын түлхүүр сонгосон шалтгаан (зөвхөн түлхүүр үүсгэсэн анхны удаад).</summary>
        public string DeviceKeyNote { get; set; }
    }
}
