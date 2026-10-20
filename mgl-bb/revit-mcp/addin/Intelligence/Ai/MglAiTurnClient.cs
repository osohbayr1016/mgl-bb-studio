using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using RevitMcpAddin.Intelligence.Contracts;

namespace RevitMcpAddin.Intelligence.Ai
{
    /// <summary>
    /// ЖИНХЭНЭ MGL AI ХОЛБОЛТ (Session R, Phase 5) — ажилтны PC-ийн runtime дээрх
    /// `POST /turn` (хуваалцсан ээлжийн хөдөлгүүр).
    ///
    /// ⚠️ ЭНД ОРКЕСТРАЦИ, VALIDATOR, PROMPT БАЙХГҮЙ.  Хөтчийн orchestrator-ийн порт
    ///    (`packages/mglai-common/src/turn/engine.ts`) runtime дотор ажиллаж, Worker-ийн
    ///    plan/context/messages, локал норм, локал Qwen, гэрээний баталгаажуулалт бүгд
    ///    ТЭНД.  Энэ клиент нь Revit-ийн контекстыг өгөөд SSE-г уншина — ХӨТӨЧТЭЙ ИЖИЛ ЗАМ.
    /// ⚠️ `/generate`-ийг ХЭЗЭЭ Ч шууд дуудахгүй (R-6).
    /// ⚠️ ERP токен нь `SettingsStore` (DPAPI) — `erp_token` талбараар runtime руу л явна,
    ///    логд/UI-д гарахгүй.  Runtime-ийн нууц `IMglAiLocalAuthProvider`-оос.
    /// </summary>
    public sealed class MglAiTurnClient : IMglAiRevitClient
    {
        private static readonly HttpClient Http = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
        private readonly string _baseUrl;
        private readonly IMglAiLocalAuthProvider _auth;
        private readonly Func<string> _erpToken;

        public MglAiTurnClient(IMglAiLocalAuthProvider auth, Func<string> erpToken, string baseUrl = null)
        {
            _auth = auth ?? new NotConfiguredLocalAuthProvider();
            _erpToken = erpToken ?? (() => null);
            _baseUrl = (baseUrl ?? MglAiRuntimeProbe.DefaultBase).TrimEnd('/');
        }

        public string Binding { get { return "LIVE:/turn"; } }

        public async Task<RevitTurnResult> AskAsync(RevitTurnRequest request, CancellationToken ct)
        {
            var r = new RevitTurnResult { Binding = Binding, Source = TurnAnswerSource.ERROR };
            string secret = _auth.TryGetSecret();
            if (string.IsNullOrEmpty(secret))
            {
                r.State = RevitErrorState.AUTH_REQUIRED;
                r.AnswerMn = "Локал MGL AI-ийн суулгацын нууц олдсонгүй (" + _auth.Describe() + ").";
                return r;
            }
            string erp = _erpToken();
            var body = new Dictionary<string, object>
            {
                { "question", request.Question },
                { "conv_uid", request.ConvUid },
                { "seq", request.Seq },
                { "surface", request.Surface ?? "revit" },
                { "revit_context", request.RevitContext },
            };
            if (!string.IsNullOrEmpty(erp)) body["erp_token"] = erp;
            if (request.History != null && request.History.Count > 0) body["history"] = request.History;
            if (request.ConvState.HasValue && request.ConvState.Value.ValueKind != JsonValueKind.Undefined && request.ConvState.Value.ValueKind != JsonValueKind.Null)
                body["conv_state"] = request.ConvState.Value;

            HttpResponseMessage resp;
            try
            {
                var msg = new HttpRequestMessage(HttpMethod.Post, _baseUrl + "/turn")
                {
                    Content = new StringContent(IntelligenceJson.Serialize(body), Encoding.UTF8, "application/json"),
                };
                msg.Headers.TryAddWithoutValidation("X-MglAi-Secret", secret);
                resp = await Http.SendAsync(msg, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex)
            {
                r.State = RevitErrorState.MGL_AI_OFFLINE;
                r.AnswerMn = "Локал MGL AI runtime хүрэхгүй байна (" + ex.GetType().Name + ").";
                return r;
            }
            using (resp)
            {
                if (resp.StatusCode == System.Net.HttpStatusCode.Unauthorized)
                {
                    r.State = RevitErrorState.AUTH_REQUIRED;
                    r.AnswerMn = "MGL AI: нэвтрэлт шаардлагатай (runtime нууц эсвэл ERP токен).";
                    return r;
                }
                if (!resp.IsSuccessStatusCode)
                {
                    r.State = RevitErrorState.MGL_AI_OFFLINE;
                    r.AnswerMn = "MGL AI runtime алдаа: HTTP " + (int)resp.StatusCode;
                    return r;
                }
                using (Stream s = await resp.Content.ReadAsStreamAsync().ConfigureAwait(false))
                using (var reader = new StreamReader(s, Encoding.UTF8))
                {
                    string ev = "message";
                    var data = new StringBuilder();
                    string line;
                    while ((line = await reader.ReadLineAsync().ConfigureAwait(false)) != null)
                    {
                        ct.ThrowIfCancellationRequested();
                        if (line.Length == 0)
                        {
                            if (data.Length > 0) Handle(ev, data.ToString(), r);
                            ev = "message"; data.Clear();
                            continue;
                        }
                        if (line.StartsWith("event:", StringComparison.Ordinal)) ev = line.Substring(6).Trim();
                        else if (line.StartsWith("data:", StringComparison.Ordinal)) data.Append(line.Substring(5).Trim());
                    }
                    if (data.Length > 0) Handle(ev, data.ToString(), r);
                }
            }
            if (r.Source == TurnAnswerSource.ERROR && string.IsNullOrEmpty(r.AnswerMn))
            {
                r.State = RevitErrorState.MGL_AI_OFFLINE;
                r.AnswerMn = "MGL AI урсгал үр дүнгүй дууслаа.";
            }
            return r;
        }

        /// <summary>Хөтчийн `orchestrator.ts`-ийн `TurnResult`-тэй ижил талбарууд (`cache`-гүй).</summary>
        internal static void Handle(string ev, string json, RevitTurnResult r)
        {
            try
            {
                using (JsonDocument d = JsonDocument.Parse(json))
                {
                    JsonElement root = d.RootElement;
                    if (ev == "result")
                    {
                        JsonElement v;
                        r.AnswerMn = root.TryGetProperty("answer", out v) && v.ValueKind == JsonValueKind.String ? v.GetString() : "";
                        string engine = root.TryGetProperty("engine", out v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
                        r.Source = engine == "retrieval-only" ? TurnAnswerSource.RETRIEVAL_ONLY : TurnAnswerSource.MODEL;
                        if (root.TryGetProperty("error", out v) && v.ValueKind == JsonValueKind.Object)
                        {
                            JsonElement code;
                            string c = v.TryGetProperty("code", out code) && code.ValueKind == JsonValueKind.String ? code.GetString() : "error";
                            r.Notices.Add(c);
                            if (c == "LOCAL_RUNTIME_OFFLINE") r.State = RevitErrorState.MGL_AI_OFFLINE;
                            // R3.5 хэмжсэн: backend унтарсан үед State OK хэвээр үлдэж байв — ERP_OFFLINE / AUTH_REQUIRED / ERROR-ыг ялгана.
                            else if (c == "BACKEND_OFFLINE" || c == "ERP_TIMEOUT" || c == "NETWORK_ERROR" || c == "SERVICE_UNAVAILABLE") r.State = RevitErrorState.ERP_OFFLINE;
                            else if (c == "AUTH_EXPIRED" || c == "PERMISSION_DENIED") r.State = RevitErrorState.AUTH_REQUIRED;
                        }
                        if (root.TryGetProperty("citations", out v) && v.ValueKind == JsonValueKind.Array)
                        {
                            foreach (JsonElement c in v.EnumerateArray())
                            {
                                JsonElement lbl;
                                if (c.TryGetProperty("label", out lbl) && lbl.ValueKind == JsonValueKind.String) r.Citations.Add(lbl.GetString());
                                else if (c.TryGetProperty("document", out lbl) && lbl.ValueKind == JsonValueKind.String) r.Citations.Add(lbl.GetString());
                            }
                        }
                        JsonElement sr;
                        if (root.TryGetProperty("stopReason", out sr) && sr.ValueKind == JsonValueKind.String) r.StopReason = sr.GetString();
                        if (root.TryGetProperty("firstTokenMs", out sr) && sr.ValueKind == JsonValueKind.Number) r.FirstTokenMs = sr.GetDouble();
                        if (root.TryGetProperty("totalMs", out sr) && sr.ValueKind == JsonValueKind.Number) r.TotalMs = sr.GetDouble();
                        r.Engine = engine;
                        if (root.TryGetProperty("convStateNext", out sr) && sr.ValueKind == JsonValueKind.Object) r.ConvStateNext = sr.Clone();
                        // R4.2 — итгэмжлэгдээгүй санал: энд ЗӨВХӨН уншина; binder/preview host дээр.
                        if (root.TryGetProperty("revitActionCandidate", out sr) && sr.ValueKind == JsonValueKind.Object)
                        {
                            try { r.ActionCandidate = IntelligenceJson.Deserialize<RevitActionCandidate>(sr.GetRawText()); } catch { r.ActionCandidate = null; }
                        }
                        if (root.TryGetProperty("revitActionCandidateRejected", out sr) && sr.ValueKind == JsonValueKind.String) r.ActionCandidateRejected = sr.GetString();
                        if (root.TryGetProperty("contractDiag", out v) && v.ValueKind == JsonValueKind.Object)
                        {
                            r.ContractDiag = v.Clone();
                            JsonElement fin;
                            if (v.TryGetProperty("final", out fin) && fin.ValueKind == JsonValueKind.String)
                            {
                                string f = fin.GetString();
                                if (f == "template") r.Source = TurnAnswerSource.SERVER_TEMPLATE;
                                r.Notices.Add("contract:" + f);
                            }
                        }
                    }
                    else if (ev == "error")
                    {
                        JsonElement m;
                        r.State = RevitErrorState.MGL_AI_OFFLINE;
                        r.AnswerMn = "MGL AI алдаа: " + (root.TryGetProperty("message", out m) ? m.GetString() : json);
                    }
                    else if (ev == "ai")
                    {
                        // Гүйцэтгэлийн үйл явдал — самбарын мөшгөлтөд; энд зөвхөн notice-ийг цуглуулна.
                        JsonElement t;
                        if (root.TryGetProperty("type", out t) && t.ValueKind == JsonValueKind.String && t.GetString() == "notice")
                        {
                            JsonElement msg;
                            if (root.TryGetProperty("safeUserMessage", out msg) && msg.ValueKind == JsonValueKind.String) r.Notices.Add(msg.GetString());
                        }
                    }
                }
            }
            catch { /* эвдэрсэн frame — алгасна */ }
        }

        public Task<string> WordReportAsync(RevitReport report, CancellationToken ct)
        {
            // Тайлангийн үглэл ч ИЖИЛ замаар (§35) — гэхдээ тусдаа ээлж; энэ релизэд детерминист хэвээр.
            return Task.FromResult<string>(null);
        }
    }

    /// <summary>
    /// Runtime-ийн суулгацын нууц — Session B-ийн КАНОН байршил.
    ///
    /// Гэрээ (баталгаажуулсан 2026-09-14): `ai/deployment/src/layout.ts`
    /// `resolveLayout(root = MGLAI_DATA_DIR ?? %LOCALAPPDATA%/MglAi)` — `secret.txt` нь тэр
    /// үндсэн хавтсанд «ХЭВЭЭР» (layout.ts-ийн тайлбар), `ai/runtime/src/config.ts`-ийн
    /// `secretFile = join(dataDir, 'secret.txt')` ЯГ түүнийг уншдаг.  Энэ анги ИЖИЛ дүрмийг
    /// (env override → өгөгдмөл root) дагана; өөр хадгалалт ЗОХИОГДООГҮЙ (R-20).
    ///
    /// ⚠️ Нууц: ХЭЗЭЭ Ч логд, exception-д, UI-д, оношилгоонд, .addin-д орохгүй; Revit
    ///    хадгалахгүй; Worker/backend руу явахгүй — ЗӨВХӨН loopback `X-MglAi-Secret`.
    ///    `Describe()` нь зөвхөн «байна/байхгүй» гэж хэлнэ.  Файл байхгүй = runtime суулгаагүй.
    /// </summary>
    public sealed class LocalAppDataAuthProvider : IMglAiLocalAuthProvider
    {
        public static string SecretPath
        {
            get
            {
                string local = Environment.GetEnvironmentVariable("LOCALAPPDATA")
                    ?? Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                string dataDir = Environment.GetEnvironmentVariable("MGLAI_DATA_DIR") ?? Path.Combine(local, "MglAi");
                return Path.Combine(dataDir, "secret.txt");
            }
        }

        public string TryGetSecret()
        {
            try
            {
                string p = SecretPath;
                if (!File.Exists(p)) return null;
                string s = File.ReadAllText(p, Encoding.UTF8).Trim();
                return s.Length >= 16 ? s : null;
            }
            catch { return null; }
        }

        public string Describe()
        {
            return File.Exists(SecretPath) ? "runtime secret.txt олдсон" : "runtime суулгаагүй (secret.txt алга)";
        }
    }
}
