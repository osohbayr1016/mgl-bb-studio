using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using RevitMcpAddin.Intelligence.Contracts;
using RevitMcpAddin.Intelligence.Core;

namespace RevitMcpAddin.Intelligence.Ai
{
    /* ================================================================== */
    /*  MGL AI ↔ REVIT КЛИЕНТИЙН ХИЛ (§18, R-6, R-20)                      */
    /*                                                                    */
    /*  Session R нь Revit-ийн КОНТЕКСТ ҮЙЛДВЭРЛЭНЭ; ерөнхий AI              */
    /*  оркестраци (plan → tools ‖ norm → context → generate → messages,   */
    /*  tfc гэрээ, validator, ярианы төлөв) нь Session A/C/D-ийнх бөгөөд   */
    /*  ӨНӨӨДӨР хөтчийн `orchestrator.ts` дотор амьдардаг — сервер дээр    */
    /*  «нэг ээлж» гэсэн ТОГТВОРТОЙ endpoint БАЙХГҮЙ.                      */
    /*                                                                    */
    /*  Тиймээс:                                                          */
    /*    · `IMglAiRevitClient` — ГЭРЭЭ.  Revit-ийн самбар зөвхөн үүнийг   */
    /*      мэднэ.                                                        */
    /*    · `MockMglAiRevitClient` — UI-ийн ажилд, детерминист.            */
    /*    · Жинхэнэ клиент = `MglAiTurnClient` (Phase 5): runtime-ийн `/turn` — */
    /*      хөтчийн orchestrator `packages/mglai-common/src/turn/`-д зөөгдөж, */
    /*      ажилтны PC-ийн runtime хостолно; C# нь зөвхөн SSE уншина.      */
    /*      `Unbound`/`Mock` нь fallback ба тест.                          */
    /*                                                                    */
    /*  ⚠️ Нормын/инженерийн асуултыг ШУУД локал `/generate` руу явуулахгүй */
    /*     — Session A-ийн итгэмжлэгдсэн замыг алгасна (R-6).              */
    /* ================================================================== */

    /// <summary>Локал runtime-ийн итгэмжлэл — НУУЦ энд ХЭЗЭЭ Ч хатуу бичигдэхгүй (R-20).</summary>
    public interface IMglAiLocalAuthProvider
    {
        /// <summary>`X-MglAi-Secret`-ийн утга, эсвэл null (тохируулаагүй).  Логд ХЭЗЭЭ Ч бичихгүй.</summary>
        string TryGetSecret();
        string Describe();
    }

    /// <summary>
    /// Session B-ийн суулгацын нууцын байршил (`ai/runtime` нь ажилтны
    /// профайлын хавтсанд `secret.txt` бичдэг) — эцсийн гэрээ нь D-ийн
    /// нэгтгэлээс ирнэ.  Одоохондоо ТОХИРУУЛААГҮЙ гэж хэлнэ; өөр хадгалалт
    /// ЗОХИОХГҮЙ (R-20).
    /// </summary>
    public sealed class NotConfiguredLocalAuthProvider : IMglAiLocalAuthProvider
    {
        public string TryGetSecret() { return null; }
        public string Describe() { return "SESSION_D_BINDING_REQUIRED: локал runtime-ийн нууцын нийлүүлэгч тохируулаагүй"; }
    }

    public sealed class MglAiRuntimeStatus
    {
        public bool Reachable;
        public bool Paired;
        public string Version;
        public string Model;
        public string Error;
        public double LatencyMs;
    }

    /// <summary>
    /// Локал runtime-ийн `/health` (нэвтрэлтгүй, 127.0.0.1:39217) — зөвхөн
    /// «амьд уу» гэдгийг хэлнэ.  `localhost` БИШ, `127.0.0.1` (урхи №6:
    /// .NET-д `localhost` ~2 с саатуулдаг).
    /// </summary>
    public static class MglAiRuntimeProbe
    {
        public const string DefaultBase = "http://127.0.0.1:39217";
        private static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };

        public static async Task<MglAiRuntimeStatus> ProbeAsync(string baseUrl = null, CancellationToken ct = default(CancellationToken))
        {
            var st = new MglAiRuntimeStatus();
            var sw = System.Diagnostics.Stopwatch.StartNew();
            try
            {
                string url = (baseUrl ?? DefaultBase).TrimEnd('/') + "/health";
                using (HttpResponseMessage resp = await Http.GetAsync(url, ct).ConfigureAwait(false))
                {
                    st.LatencyMs = sw.Elapsed.TotalMilliseconds;
                    if (!resp.IsSuccessStatusCode) { st.Error = "HTTP " + (int)resp.StatusCode; return st; }
                    string body = await resp.Content.ReadAsStringAsync().ConfigureAwait(false);
                    st.Reachable = true;
                    using (JsonDocument d = JsonDocument.Parse(body))
                    {
                        JsonElement r = d.RootElement;
                        JsonElement v;
                        if (r.TryGetProperty("version", out v) && v.ValueKind == JsonValueKind.String) st.Version = v.GetString();
                        if (r.TryGetProperty("paired", out v) && v.ValueKind == JsonValueKind.True) st.Paired = true;
                        if (r.TryGetProperty("model", out v))
                        {
                            if (v.ValueKind == JsonValueKind.String) st.Model = v.GetString();
                            else if (v.ValueKind == JsonValueKind.Object)
                            {
                                JsonElement id;
                                if (v.TryGetProperty("id", out id) && id.ValueKind == JsonValueKind.String) st.Model = id.GetString();
                            }
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                st.LatencyMs = sw.Elapsed.TotalMilliseconds;
                st.Error = ex.GetType().Name;
            }
            return st;
        }
    }

    /// <summary>Revit-ийн самбарын харах ЦОРЫН ГАНЦ AI гэрээ.</summary>
    public interface IMglAiRevitClient
    {
        /// <summary>MOCK | SESSION_D_BINDING_REQUIRED | LIVE</summary>
        string Binding { get; }
        Task<RevitTurnResult> AskAsync(RevitTurnRequest request, CancellationToken ct);
        /// <summary>Тайлангийн мөрүүдийг үглэнэ — БАРИМТ нэмэхгүй (R-18).  null = загваргүй, детерминист хэвээр.</summary>
        Task<string> WordReportAsync(RevitReport report, CancellationToken ct);
    }

    /// <summary>
    /// ДЕТЕРМИНИСТ MOCK — UI-г Qwen-гүй, серверьгүй ажиллуулна (§75).
    /// Хариулт нь ЗӨВХӨН Revit-ийн контекстоос: сонгосон элемент, харагдац,
    /// төсөл.  Норм, тоо ЗОХИОХГҮЙ; асуулт нормын шинжтэй бол
    /// `SESSION_D_BINDING_REQUIRED` гэж ил хэлнэ.
    /// </summary>
    public sealed class MockMglAiRevitClient : IMglAiRevitClient
    {
        public string Binding { get { return "MOCK"; } }

        public Task<RevitTurnResult> AskAsync(RevitTurnRequest request, CancellationToken ct)
        {
            var r = new RevitTurnResult { Source = TurnAnswerSource.MOCK, Binding = Binding };
            var sb = new StringBuilder();
            MglAiRevitContextWire c = request != null ? request.RevitContext : null;
            if (c == null || c.DocTitle == null)
            {
                sb.Append("Revit-д нээлттэй баримт алга.");
                r.State = RevitErrorState.NO_DOCUMENT;
            }
            else
            {
                sb.Append("Revit загвар: файл «").Append(c.DocTitle).Append("»");
                if (c.ActiveViewName != null) sb.Append(", харагдац «").Append(c.ActiveViewName).Append("»");
                if (c.LevelName != null) sb.Append(", давхар «").Append(c.LevelName).Append("»");
                sb.Append(". ");
                if (c.Selection.Count == 0) sb.Append("Сонгосон элемент алга.");
                else
                {
                    var byCat = new Dictionary<string, int>(StringComparer.Ordinal);
                    foreach (MglAiSelectedElementWire e in c.Selection)
                    {
                        string k = e.Category ?? "тодорхойгүй";
                        int n; byCat[k] = byCat.TryGetValue(k, out n) ? n + 1 : 1;
                    }
                    sb.Append("Сонгосон ").Append(c.Selection.Count).Append(" элемент: ");
                    var parts = new List<string>();
                    foreach (KeyValuePair<string, int> kv in byCat) parts.Add(kv.Key + "×" + kv.Value);
                    sb.Append(string.Join(", ", parts)).Append('.');
                }
                if (c.ProjectId == null) sb.Append(" ERP төсөл баталгаажаагүй.");
            }
            sb.Append("\n\n⚠ Энэ бол Revit-ийн контекстын ДЕТЕРМИНИСТ хураангуй (MOCK). Норм/инженерийн асуултын хариулт MGL AI-ийн итгэмжлэгдсэн замаар ирнэ — SESSION_D_BINDING_REQUIRED.");
            r.AnswerMn = sb.ToString();
            r.Notices.Add("SESSION_D_BINDING_REQUIRED");
            return Task.FromResult(r);
        }

        public Task<string> WordReportAsync(RevitReport report, CancellationToken ct)
        {
            return Task.FromResult<string>(null);
        }
    }

    /// <summary>
    /// Жинхэнэ холболтын ОРОН ЗАЙ — бүх дуудлага `SESSION_D_BINDING_REQUIRED`
    /// буцаана.  `Bind(...)` нь D-ийн нэг ээлжийн endpoint/клиент ирэхэд
    /// солигдох ГАНЦ цэг; самбар өөрчлөгдөхгүй.
    /// </summary>
    public sealed class UnboundMglAiRevitClient : IMglAiRevitClient
    {
        public string Binding { get { return "SESSION_D_BINDING_REQUIRED"; } }

        public Task<RevitTurnResult> AskAsync(RevitTurnRequest request, CancellationToken ct)
        {
            return Task.FromResult(new RevitTurnResult
            {
                Source = TurnAnswerSource.ERROR,
                State = RevitErrorState.MGL_AI_OFFLINE,
                Binding = Binding,
                AnswerMn = "MGL AI-ийн Revit холболт хараахан идэвхжээгүй (SESSION_D_BINDING_REQUIRED). Revit-ийн контекст, даалгавар, тайлан, нийцлийн шалгалт локалд ажиллаж байна.",
                Notices = { "SESSION_D_BINDING_REQUIRED" },
            });
        }

        public Task<string> WordReportAsync(RevitReport report, CancellationToken ct)
        {
            return Task.FromResult<string>(null);
        }
    }
}
