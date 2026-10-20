using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace RevitMcpAddin
{
    /// <summary>Non-success API response (body truncated to 500 chars).</summary>
    public class ApiException : Exception
    {
        public int StatusCode { get; }

        public ApiException(int statusCode, string body)
            : base("API " + statusCode + ": " + body)
        {
            StatusCode = statusCode;
        }
    }

    /// <summary>401 — токен хүчингүй эсвэл хугацаа нь дууссан.</summary>
    public class UnauthorizedException : ApiException
    {
        public UnauthorizedException(string body) : base(401, body) { }
    }

    /// <summary>409 — ижил push_id-тай илгээлт аль хэдийн хүлээн авагдсан.</summary>
    public class DuplicatePushException : ApiException
    {
        public int RunId { get; }

        public DuplicatePushException(int runId, string body) : base(409, body)
        {
            RunId = runId;
        }
    }

    /// <summary>Thin wrapper over the MGL backend HTTP API.</summary>
    public static class ApiClient
    {
        /// <summary>
        /// ⚠️ Хугацаа нь 30 секунд БАЙЖ БОЛОХГҮЙ.  Энэ клиент нь 20,000 мөр
        /// хүртэлх тоо хэмжээний payload, мөн хэдэн MB-ийн PDF-ийг байршуулдаг —
        /// оффисын энгийн интернэтээр 30 секунд хүрэлцэхгүй тул хүн «A task was
        /// canceled.» гэсэн англи алдаа хараад, PDF нь устгагдан ажил дэмий
        /// үрэгддэг байв.  180 секунд нь бодит хэмжээст хангалттай бөгөөд үнэхээр
        /// гацсан хүсэлтийг мөнхөд хүлээхээс хамгаална.
        /// </summary>
        internal static readonly HttpClient Http = CreateClient();
        // ⚠️ ЭНЭ КЛИЕНТ НЬ 180 СЕКУНДТЭЙ, QTO-д ЗОРИУЛАГДСАН.
        //    Compliance / BIM-бүртгэл / AI-ийн дуудлага `AiHttp.Http`-ыг
        //    (20 с, CancellationToken, bounded retry, bounded concurrency)
        //    хэрэглэнэ — v2 §32 «Do not reuse an unrelated 180-second HTTP
        //    timeout».  Энд БҮҮ нэм.

        private static HttpClient CreateClient()
        {
            // ⚠️ `SessionTokenHandler`: урт ажлын эхэнд барьсан хуучин төхөөрөмжийн session токеныг илгээх агшинд
            //    шинэ session-оор солино (1.10.0) — дуудагч бүрийг засахгүйгээр 30 минутын session-ийн хугацаа дуусахаас хамгаална.
            var c = new HttpClient(new Licensing.SessionTokenHandler(new HttpClientHandler()), true)
            {
                Timeout = TimeSpan.FromSeconds(180)
            };

            // ⚠️ USER-AGENT ЗААВАЛ.  `HttpClient` анхдагчаараа энэ толгойг
            // ОГТ ИЛГЭЭДЭГГҮЙ, гэтэл Cloudflare-ийн «Browser Integrity Check»
            // нь User-Agent-гүй хүсэлтийг **403 (error code 1010)**-аар
            // Worker-т ХҮРЭХЭЭС нь ӨМНӨ хаадаг.
            //
            // Үр дагавар нь оношлоход маш хэцүү байв: самбар «Вэб
            // холбогдоогүй» гэж хэлэх ба шалтгаан нь харагдахгүй — нэвтрэлт,
            // токен, хаяг бүгд зөв мөртлөө.  2026-08-25-нд ХЭМЖИЖ баталсан:
            //     UA байхгүй        → 403  error code: 1010
            //     UA "MglRevitAddin/1.0" → 401  {"error":"Invalid or expired token"}
            // Өөрөөр хэлбэл UA нэмэхэд л хүсэлт Worker-т хүрч, ЖИНХЭНЭ
            // алдаагаа хэлдэг болсон.
            //
            // ⚠️ Үйлчлүүлэгч бүрийн deployment Cloudflare-ийн ард байх тул
            // энэ мөрийг ХЭЗЭЭ Ч БҮҮ УСТГА.
            //
            // ⚠️ УГТВАР `MglRevitAddin/` ЗААВАЛ ХЭВЭЭР.  Хувилбарыг ЗАЛГАЖ
            // болно — угтварыг УСТГАЖ БОЛОХГҮЙ.  Хувилбар нь энд байх нь
            // сервер талд «аль ажилтан аль build-тай явж байна» гэдгийг
            // хүсэлт бүрээс харах цорын ганц арга (`dist/` git-д ороогүй,
            // ажилтны компьютерт автомат шинэчлэл байхгүй).
            //
            // ⚠️ ТАРААХААС ӨМНӨ НЭГ МАШИН ДЭЭР ТУРШ: 401 (403 БИШ) ирж
            // байгааг батал.  Хэрэв шинэ UA хэлбэр ямар нэг шалтгаанаар
            // Cloudflare-т 403/1010 авбал тэр нь БҮХ REST дуудлагыг АЛСААС
            // зогсоох ба add-in бүрэн шинэчлэлээс өөр гарц байхгүй.
            c.DefaultRequestHeaders.UserAgent.ParseAdd("MglRevitAddin/" + BuildInfo.Version);
            c.DefaultRequestHeaders.Accept.ParseAdd("application/json");
            return c;
        }

        internal static readonly JsonSerializerOptions ReadOptions = new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        };

        /// <summary>POST /api/auth/login → богино хугацааны session токен + role.</summary>
        public static async Task<(string token, string role)> LoginAsync(
            string host, string username, string password)
        {
            using HttpRequestMessage req =
                new HttpRequestMessage(HttpMethod.Post, Url(host, "/api/auth/login"))
                {
                    Content = JsonContent(new { username, password })
                };
            using HttpResponseMessage res = await Http.SendAsync(req).ConfigureAwait(false);
            string body = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
            if (!res.IsSuccessStatusCode)
                throw Error(res, body);

            LoginResponse parsed = JsonSerializer.Deserialize<LoginResponse>(body, ReadOptions);
            if (parsed == null || string.IsNullOrEmpty(parsed.Token))
                throw new ApiException((int)res.StatusCode, "login response had no token");
            return (parsed.Token, parsed.User != null ? parsed.User.Role : null);
        }

        /// <summary>POST /api/auth/mcp-token → ~1 жилийн урт хугацааны токен.</summary>
        public static async Task<string> MintLongTokenAsync(string host, string sessionToken)
        {
            using HttpRequestMessage req =
                new HttpRequestMessage(HttpMethod.Post, Url(host, "/api/auth/mcp-token"))
                {
                    Content = new StringContent("{}", Encoding.UTF8, "application/json")
                };
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", sessionToken);

            using HttpResponseMessage res = await Http.SendAsync(req).ConfigureAwait(false);
            string body = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
            if (!res.IsSuccessStatusCode)
                throw Error(res, body);

            McpTokenResponse parsed = JsonSerializer.Deserialize<McpTokenResponse>(body, ReadOptions);
            if (parsed == null || string.IsNullOrEmpty(parsed.Token))
                throw new ApiException((int)res.StatusCode, "mcp-token response had no token");
            return parsed.Token;
        }

        /// <summary>
        /// GET /api/revit/assistant/model → санаа таних загварыг шинэчилнэ.
        ///
        /// ⚠️ ЭНЭ НЬ ӨӨРӨӨ СУРАХ ГОГЦООНЫ ХААГДАХ ЦЭГ.  Хэрэглэгчид сонголт
        /// дарж, 👎 дарж, залруулга өгдөг — тэр өгөгдлөөр загварыг дахин
        /// сургадаг.  Гэвч 2026-08-25 хүртэл `IntentModel.SaveDownloaded`
        /// нь НЭГ Ч ГАЗРААС ДУУДАГДДАГГҮЙ байсан тул сайжруулалт нь
        /// инженерийн компьютерт ХЭЗЭЭ Ч ХҮРДЭГГҮЙ — хүмүүс сургадаг ч
        /// үр дүнг нь хэзээ ч хардаггүй байв.
        ///
        /// `have` нь одоо суусан хувилбар.  Сервер таарвал жинг илгээхгүй —
        /// Revit асах бүрт татах нь дэмий.
        ///
        /// ⚠️ ХЭМЖЭЭ: `Resources/intent-model.json` ≈ **918 KB**
        /// (2026-08-27-нд 940,283 байт хэмжсэн; загвар дахин
        /// сургагдах бүрт хэдэн KB-ээр хэлбэлзэнэ).  Энэ тайлбар
        /// урьд нь «~400 KB» гэж бичигдсэн байсан — бодитаас 2× БАГА.
        ///
        /// ⚠️ `have` нь ХООСОН ирвэл богиносгол ОГТ АЖИЛЛАХГҮЙ.  Дуудагч
        /// `IntentModel.VersionForSync()`-ыг (ачаалалтыг ХҮЧЛЭДЭГ) АРЫН
        /// thread дээр дуудах ЁСТОЙ; `LoadedVersion` нь самбар нээгдэх үед
        /// үргэлж null байдаг тул тэр нь болохгүй.
        ///
        /// Буцах утга: шинэ хувилбарын нэр, эсвэл шинэчлээгүй бол null.
        /// ⚠️ АЛДАА ШИДЭХГҮЙ — сүлжээгүй үед шигтгэсэн загвар үргэлжлүүлнэ.
        /// </summary>
        public static async Task<string> SyncIntentModelAsync(string host, string token, string have)
        {
            try
            {
                string path = "/api/revit/assistant/model";
                if (!string.IsNullOrEmpty(have)) path += "?have=" + Uri.EscapeDataString(have);

                using HttpRequestMessage req = new HttpRequestMessage(HttpMethod.Get, Url(host, path));
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

                using HttpResponseMessage res = await Http.SendAsync(req).ConfigureAwait(false);
                if (!res.IsSuccessStatusCode) return null;

                string body = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
                using JsonDocument doc = JsonDocument.Parse(body);
                JsonElement root = doc.RootElement;

                if (root.TryGetProperty("unchanged", out JsonElement un) &&
                    un.ValueKind == JsonValueKind.True)
                    return null;

                if (!root.TryGetProperty("weights", out JsonElement w) ||
                    w.ValueKind != JsonValueKind.Object)
                    return null;

                // ⚠️ ТҮҮХИЙ JSON-ыг дамжуулна.  `SaveDownloaded` нь дотроо
                // `Parse` хийж БОЛОВСРУУЛАЛТЫН ГЭРЭЭГ шалгадаг тул гэрээ
                // зөрсөн загвар диск дээр хүрэхгүй.
                if (!IntentModel.SaveDownloaded(w.GetRawText())) return null;

                return root.TryGetProperty("version", out JsonElement v) ? v.GetString() : "?";
            }
            catch
            {
                return null;   // офлайн / буруу хариу — чимээгүй өнгөрнө
            }
        }

        /// <summary>GET /api/projects → зөвхөн id + name-ийг уншина.</summary>
        public static async Task<List<ProjectInfo>> GetProjectsAsync(string host, string token)
        {
            using HttpRequestMessage req =
                new HttpRequestMessage(HttpMethod.Get, Url(host, "/api/projects"));
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

            using HttpResponseMessage res = await Http.SendAsync(req).ConfigureAwait(false);
            string body = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
            if (!res.IsSuccessStatusCode)
                throw Error(res, body);

            ProjectListResponse parsed =
                JsonSerializer.Deserialize<ProjectListResponse>(body, ReadOptions);
            return parsed != null && parsed.Projects != null
                ? parsed.Projects
                : new List<ProjectInfo>();
        }

        /// <summary>
        /// POST /api/upload?bucket=media — multipart нэг файл (backend-ийн
        /// body['file'] талбар). PDF зэрэг жижиг файлд зориулагдсан; том
        /// файлд multipart/create зам байдаг ч энд хэрэггүй.
        /// </summary>
        public static async Task<MediaUploadResult> UploadMediaAsync(
            string host, string token, string fileName, byte[] bytes, string contentType)
        {
            using var content = new MultipartFormDataContent();
            var filePart = new ByteArrayContent(bytes);
            filePart.Headers.ContentType =
                new System.Net.Http.Headers.MediaTypeHeaderValue(contentType);

            // Cloudflare Workers-ийн FormData parser нь Content-Disposition-ийн
            // параметрүүдийг ХАШИЛТТАЙ шаарддаг бол .NET default нь name=file
            // (хашилтгүй) + кирилл нэрэнд filename*/encoded-word нэмдэг →
            // "missing a name" TypeError, 500. Тиймээс header-ийг өөрсдөө
            // хашилттай, ASCII нэртэйгээр онооно (хүнд харагдах нэр view_name-д
            // хэвээр — энэ нь зөвхөн wire формат).
            var disposition =
                new System.Net.Http.Headers.ContentDispositionHeaderValue("form-data")
                {
                    Name = "\"file\"",
                    FileName = "\"" + AsciiFileName(fileName) + "\"",
                };
            filePart.Headers.ContentDisposition = disposition;
            content.Add(filePart);

            using HttpRequestMessage req =
                new HttpRequestMessage(HttpMethod.Post, Url(host, "/api/upload?bucket=media"))
                {
                    Content = content,
                };
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

            using HttpResponseMessage res = await Http.SendAsync(req).ConfigureAwait(false);
            string body = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
            if (!res.IsSuccessStatusCode)
                throw Error(res, body);

            MediaUploadResult parsed =
                JsonSerializer.Deserialize<MediaUploadResult>(body, ReadOptions);
            if (parsed == null || string.IsNullOrEmpty(parsed.Url))
                throw new ApiException((int)res.StatusCode, "upload response had no url");
            return parsed;
        }

        /// <summary>POST /api/qto/schedules — ведомостуудыг илгээнэ (REPLACE семантик).</summary>
        public static async Task<SchedulePushResult> PostSchedulesAsync(
            string host, string token, SchedulePushPayload payload)
        {
            using HttpRequestMessage req =
                new HttpRequestMessage(HttpMethod.Post, Url(host, "/api/qto/schedules"))
                {
                    Content = JsonContent(payload),
                };
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

            using HttpResponseMessage res = await Http.SendAsync(req).ConfigureAwait(false);
            string body = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
            if (res.StatusCode == System.Net.HttpStatusCode.Unauthorized)
                throw new UnauthorizedException(body);
            if (!res.IsSuccessStatusCode)
                throw Error(res, body);

            SchedulePushResult parsed =
                JsonSerializer.Deserialize<SchedulePushResult>(body, ReadOptions);
            return parsed ?? new SchedulePushResult();
        }

        /// <summary>Multipart filename-д зориулж ASCII-гүй тэмдэгтийг '_' болгоно.</summary>
        private static string AsciiFileName(string name)
        {
            if (string.IsNullOrEmpty(name))
                return "file.pdf";
            var sb = new System.Text.StringBuilder(name.Length);
            foreach (char ch in name)
            {
                bool ok = (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')
                    || (ch >= '0' && ch <= '9') || ch == '.' || ch == '_' || ch == '-';
                sb.Append(ok ? ch : '_');
            }
            string safe = sb.ToString().Trim('_');
            return string.IsNullOrEmpty(safe) ? "file.pdf" : safe;
        }

        /// <summary>POST /api/qto/view-exports — R2-д орсон план PDF-ийг төсөлд бүртгэнэ.</summary>
        public static async Task<int> RegisterViewExportAsync(
            string host, string token, ViewExportPayload payload)
        {
            using HttpRequestMessage req =
                new HttpRequestMessage(HttpMethod.Post, Url(host, "/api/qto/view-exports"))
                {
                    Content = JsonContent(payload),
                };
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

            using HttpResponseMessage res = await Http.SendAsync(req).ConfigureAwait(false);
            string body = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
            if (!res.IsSuccessStatusCode)
                throw Error(res, body);

            ViewExportResult parsed =
                JsonSerializer.Deserialize<ViewExportResult>(body, ReadOptions);
            return parsed != null ? parsed.Id : 0;
        }

        /// <summary>POST /api/qto/revit-runs → 201 result; 401/409 become typed exceptions.</summary>
        public static async Task<QtoPushResult> PostRevitRunAsync(
            string host, string token, QtoPayload payload)
        {
            using HttpRequestMessage req =
                new HttpRequestMessage(HttpMethod.Post, Url(host, "/api/qto/revit-runs"))
                {
                    Content = JsonContent(payload)
                };
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

            using HttpResponseMessage res = await Http.SendAsync(req).ConfigureAwait(false);
            string body = await res.Content.ReadAsStringAsync().ConfigureAwait(false);

            if (res.StatusCode == HttpStatusCode.Unauthorized)
                throw new UnauthorizedException(Snippet(body));

            if ((int)res.StatusCode == 409)
                throw new DuplicatePushException(TryReadRunId(body), Snippet(body));

            if (!res.IsSuccessStatusCode)
                throw new ApiException((int)res.StatusCode, Snippet(body));

            QtoPushResult result = JsonSerializer.Deserialize<QtoPushResult>(body, ReadOptions);
            return result ?? new QtoPushResult();
        }

        private static int TryReadRunId(string body)
        {
            try
            {
                using JsonDocument doc = JsonDocument.Parse(body);
                if (doc.RootElement.TryGetProperty("run_id", out JsonElement runId) &&
                    runId.ValueKind == JsonValueKind.Number)
                {
                    return runId.GetInt32();
                }
            }
            catch
            {
                // 409 body was not JSON — keep run id 0.
            }
            return 0;
        }

        /// <summary>
        /// Энэ МАШИНЫ таних тэмдэг — sha256, НЭР БИШ.
        ///
        /// ⚠️ `BimEmitter`-ийн session handshake-тай ЯГ ИЖИЛ ТОМЬЁО байх
        /// ЁСТОЙ (`BimEmitter.cs`-ийн `MachineHash()`), эс бөгөөс нэг машин
        /// сервер дээр ХОЁР өөр хэшээр харагдана: `bim_sessions`-д нэгээр,
        /// `addin_installs`-д өөрөөр — тэгвэл «парк хэдэн машин вэ» гэсэн
        /// тоо хэзээ ч тохирохгүй.  Тиймээс хоёулаа `ChangeTracker.Sha256Hex`
        /// -ийг ижил оролтоор дууддаг.
        ///
        /// ⚠️ Машины НЭР, домэйн, хэрэглэгчийн нэр — гурвуулан ЗӨВХӨН хэшийн
        /// оролт.  Сервер рүү түүхий утга ХЭЗЭЭ Ч явахгүй (0202-ийн гэрээ).
        /// </summary>
        internal static string MachineHash()
        {
            try
            {
                string raw = Environment.MachineName + "|" +
                             Environment.UserDomainName + "|" +
                             Environment.UserName;
                return ChangeTracker.Sha256Hex(raw);
            }
            catch { return null; }
        }

        /// <summary>
        /// КЭШЛЭГДСЭН эрхийн түвшин — `settings.json`-ы `authority_level`.
        ///
        /// ⚠️ ЦЭВЭР УНШИЛТ.  Дискэнд ЮУ Ч бичихгүй, сүлжээ ХӨНДӨХГҮЙ,
        /// ХЭЗЭЭ Ч шидэхгүй — `PostHealthAsync` нь офлайн үед ч чимээгүй
        /// ажиллах ёстой.
        ///
        /// ⚠️ ЗӨВХӨН НЭГ ОРОНТОЙ ЦЭВЭР ЦИФРИЙГ хүлээж авна.  Гараар
        /// засварласан хог утга ('0x2', '1e0', ' 3 ') нь серверийн багана
        /// руу орж, паркийн тайланг бохирдуулах ЁСГҮЙ; таарахгүй бол `null`
        /// (= «мэдэгдэхгүй»), 0 БИШ — 0 гэдэг нь OBSERVE гэсэн ТОДОРХОЙ
        /// мэдэгдэл бөгөөс «хараахан аваагүй»-тэй ХОЛИГДОХ ёсгүй.
        /// </summary>
        private static string CachedAuthorityLevel()
        {
            try
            {
                string raw = SettingsStore.Load()?.AuthorityLevel;
                if (string.IsNullOrWhiteSpace(raw)) return null;
                raw = raw.Trim();
                if (raw.Length != 1 || raw[0] < '0' || raw[0] > '5') return null;
                return raw;
            }
            catch { return null; }
        }

        /// <summary>
        /// `GET /api/learning/settings` → `compliance.authority_level`-ыг
        /// кэшлэнэ (v2 §80-ийн клиент тал, 2-8 §9 №14-ийн хариу).
        ///
        /// ⚠️ ЯАГААД ЭНЭ ДУУДЛАГА ХЭРЭГТЭЙ ВЭ: `addin_installs.authority_level`
        /// -ийн ЦОРЫН ГАНЦ бичигч нь `POST /api/revit/health` бөгөөд түүний
        /// эх өгөгдөл нь ЛОКАЛ кэш.  Кэшийг хэн ч дүүргэхгүй бол багана
        /// мөнхөд NULL — засвар нь зөвхөн гоо сайхны болно.
        ///
        /// ⚠️ ЧИМЭЭГҮЙ.  Офлайн / 401 / 500 — БҮГД `false` буцаана, кэш
        /// хэвээр (§75-ын доройтол).  Эрүүл мэндийн тайлан ХЭЗЭЭ Ч
        /// энэ дуудлагаас болж зогсохгүй.
        ///
        /// ⚠️ ӨӨРЧЛӨГДӨӨГҮЙ бол ДИСК ХӨНДӨХГҮЙ.  `SettingsStore.Save` нь
        /// БҮХ тохиргоог дарж бичдэг тул арын thread-ээс дуудах бүр нь
        /// Тохиргоо цонхны зэрэгцээ бичилттэй уралдана; түвшин жилд нэг
        /// удаа л өөрчлөгддөг учир бичилтийг ЗААВАЛ нөхцөлт болгоно.
        /// </summary>
        internal static async Task<bool> RefreshAuthorityLevelAsync(string host, string token)
        {
            if (string.IsNullOrEmpty(token)) return false;
            try
            {
                int? level;
                using (HttpRequestMessage req =
                    new HttpRequestMessage(HttpMethod.Get, Url(host, "/api/learning/settings")))
                {
                    req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                    using (HttpResponseMessage res =
                        await AiHttp.Http.SendAsync(req).ConfigureAwait(false))
                    {
                        if (!res.IsSuccessStatusCode) return false;
                        string body = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
                        LearningSettingsReply parsed =
                            JsonSerializer.Deserialize<LearningSettingsReply>(body, ReadOptions);
                        level = parsed?.Compliance?.AuthorityLevel;
                    }
                }
                if (level == null || level < 0 || level > 5) return false;

                string next = level.Value.ToString(System.Globalization.CultureInfo.InvariantCulture);

                // ⚠️ ДАХИН УНШИНА, дээрх `using`-үүд хаагдсаны ДАРАА: уралдааны
                //    цонхыг боломжтой хэмжээгээр нарийсгана (сүлжээний хүлээлт
                //    Load ба Save хоёрын ХООРОНД байх ЁСГҮЙ).
                AddinSettings cur = SettingsStore.Load();
                if (cur == null) return false;
                if (string.Equals(cur.AuthorityLevel, next, StringComparison.Ordinal)) return false;

                cur.AuthorityLevel = next;
                SettingsStore.Save(cur);
                return true;
            }
            catch
            {
                // Офлайн / хэлбэр буруу / диск бичигдэхгүй — БҮГД чимээгүй.
                return false;
            }
        }

        /// <summary>
        /// POST /api/revit/health — суулгалтын эрүүл мэндийн тайлан (v2 §74).
        /// Самбар анх ачаалагдахад НЭГ УДАА, арын thread-ээс.
        ///
        /// ⚠️ ХЭЗЭЭ Ч БҮҮ БЛОКЛО.  Ямар ч алдаа чимээгүй залгигдана —
        /// эрүүл мэндийн тайлан илгээгдээгүй нь ажилтны ажлыг зогсоох ЁСГҮЙ
        /// (v2 §75).  Сүлжээгүй үед Revit БҮРЭН хэвийн ажиллана.
        ///
        /// ⚠️ ЭНЭ БОЛ ГАНЦ ХҮСЭЛТ.  Давтахгүй, тогтмол хугацаагаар
        /// илгээхгүй — `last_seen_at` нь «энэ машин өнөөдөр Revit нээсэн»
        /// гэдгийг л хэлнэ.  Тогтмол ping нь телеметрийг ХЯНАЛТ болгоно.
        ///
        /// ⚠️ `ApiClient.Http`-ЫГ ХЭРЭГЛЭХГҮЙ — тэр нь 180 секундтэй, 20 000
        /// мөрийн QTO push-д зориулагдсан (v2 §32 «Do not reuse an unrelated
        /// 180-second HTTP timeout»).  Энд `AiHttp.Http` (20 с) хэрэглэнэ.
        ///
        /// ⚠️ ГЭХДЭЭ `AiHttp.SendAsync`-ЫГ ДУУДАХГҮЙ: тэр нь дундын
        /// доройтлын тоолуурыг (`DegradeState`) хөдөлгөдөг ба энэ
        /// «сайн байна уу» гэсэн нэг удаагийн хүсэлт нийцлийн давхаргын
        /// төлөвийг гуйвуулах ЁСГҮЙ.  Зөвхөн ТЭЭВРИЙГ нь хуваалцана.
        ///
        /// Буцах утга: серверийн хариу (`latest_version`, `upgrade_required`,
        /// `recognised`), эсвэл офлайн/алдаатай үед `null`.
        /// </summary>
        internal static async Task<HealthReply> PostHealthAsync(
            string host, string token, SelfCheckResult sc)
        {
            if (sc == null || string.IsNullOrEmpty(token)) return null;
            try
            {
                using (HttpRequestMessage req =
                    new HttpRequestMessage(HttpMethod.Post, Url(host, "/api/revit/health"))
                    {
                        Content = JsonContent(new
                        {
                            machine_hash    = MachineHash(),
                            revit_year      = sc.RevitYear,
                            revit_build     = sc.RevitBuild,
                            addin_version   = sc.AddinVersion,
                            model_version   = sc.ModelVersion,
                            model_source    = sc.ModelSource,
                            ruleset_version = sc.RulesetVersion,
                            pack_sha256     = sc.PackSha256,
                            config_version  = sc.ConfigVersion,
                            release_sha256  = sc.ReleaseSha256,
                            channel         = sc.Channel,
                            // ⚠️ ЭНЭ ТАЛБАР `SelfCheckResult`-Д БАЙХГҮЙ, ХАРИН
                            //    КЭШЛЭГДСЭН ТОХИРГООНООС ИРНЭ.  Сервер 0242-оос
                            //    хойш `addin_installs.authority_level`-ыг
                            //    bind-даг ба клиент түүнийг ХЭЗЭЭ Ч илгээдэггүй
                            //    байсан тул мөр бүр NULL байв — өөрөөр хэлбэл
                            //    «энэ парк ямар түвшинд явж байна» гэсэн ганц
                            //    хэмжигдэхүүн үхмэл байлаа (v2 §80).
                            // ⚠️ `null` нь ЗӨВ утга: хараахан нэг ч удаа
                            //    серверээс аваагүй суулгац.  2-8 §9 №14 —
                            //    «суваг байхгүй бол null илгээнэ, блоклохгүй».
                            authority_level = CachedAuthorityLevel(),
                            health          = sc.Health,
                            health_json     = new
                            {
                                ok      = sc.Ok,
                                failed  = sc.Failed,
                                skipped = sc.Skipped,
                                ts      = sc.Ts,
                            },
                        }),
                    })
                {
                    req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                    using (HttpResponseMessage res =
                        await AiHttp.Http.SendAsync(req).ConfigureAwait(false))
                    {
                        if (!res.IsSuccessStatusCode) return null;
                        string body = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
                        return JsonSerializer.Deserialize<HealthReply>(body, ReadOptions);
                    }
                }
            }
            catch
            {
                // ⚠️ Офлайн / 403 / 500 / DNS — БҮГД чимээгүй.  §75.
                return null;
            }
        }

        internal static Exception Error(HttpResponseMessage res, string body)
        {
            string snippet = Snippet(body);
            if (res.StatusCode == HttpStatusCode.Unauthorized)
                return new UnauthorizedException(snippet);
            return new ApiException((int)res.StatusCode, snippet);
        }

        private static string Snippet(string body)
        {
            if (body == null)
                return string.Empty;
            return body.Length > 500 ? body.Substring(0, 500) : body;
        }

        internal static StringContent JsonContent(object payload)
        {
            return new StringContent(
                JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
        }

        internal static string Url(string host, string path)
        {
            return (host ?? string.Empty).Trim().TrimEnd('/') + path;
        }
    }
}
