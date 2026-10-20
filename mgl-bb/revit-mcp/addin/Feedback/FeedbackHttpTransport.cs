using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using RevitMcpAddin.Feedback.Core;

namespace RevitMcpAddin.Feedback
{
    /// <summary>
    /// <see cref="IFeedbackTransport"/>-ийн HTTP хэрэгжүүлэлт (<c>/api/engineering-feedback</c>).
    ///
    /// ⚠️ ТОКЕН ХҮСЭЛТ БҮРД ШИНЭЭР + ХҮРЭЭНИЙ ШАЛГАЛТ: илгээхийн өмнө <see cref="TokenProvider"/>-оос (=
    ///    <c>SettingsStore.Load()</c>) одоогийн токеныг авч, түүний <c>sub</c>/<c>tid</c> болон серверийн хост нь item-ийн
    ///    хүрээтэй ЯГ таарч байгааг шалгана — таарахгүй бол (өөр хэрэглэгч нэвтэрсэн, гарсан) 401 гэж үзэж item хүлээнэ.
    ///    Тийм учраас add-in-ий ерөнхий <c>SessionTokenHandler</c>-ыг ЭНД ХЭРЭГЛЭХГҮЙ: тэр нь гарсны дараах хуучин session-ыг
    ///    ДАРААГИЙН хэрэглэгчийн session-оор сольж болзошгүй (хэрэглэгч А-гийн хүсэлт Б-ийн нэрээр явах эрсдэл).
    /// ⚠️ User-Agent «MglRevitAddin/…» ЗААВАЛ (Cloudflare 1010 — ApiClient.cs-ийн тайлбар).
    /// ⚠️ Том файлыг санах ойд бүтнээр уншихгүй: энгийн файл stream, multipart хэсэг ≤ 8 MiB буфер.
    /// </summary>
    internal sealed class FeedbackHttpTransport : IFeedbackTransport
    {
        private const string Base = "/api/engineering-feedback";
        private static readonly TimeSpan JsonTimeout = TimeSpan.FromSeconds(60);
        private static readonly TimeSpan UploadTimeout = TimeSpan.FromMinutes(10);

        private static readonly HttpClient Http = CreateClient();

        /// <summary>(host, token) — одоогийн тохиргооноос; токен байхгүй бол null.</summary>
        public Func<(string host, string token)> TokenProvider { get; }
        private readonly string _scope;

        public FeedbackHttpTransport(string scope, Func<(string host, string token)> tokenProvider)
        {
            _scope = scope;
            TokenProvider = tokenProvider ?? throw new ArgumentNullException(nameof(tokenProvider));
        }

        private static HttpClient CreateClient()
        {
            var c = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }, true) { Timeout = Timeout.InfiniteTimeSpan };
            c.DefaultRequestHeaders.UserAgent.ParseAdd("MglRevitAddin/" + BuildInfo.Version);
            c.DefaultRequestHeaders.Accept.ParseAdd("application/json");
            return c;
        }

        /* ───────────────────────────── API ───────────────────────────── */

        public async Task<FeedbackDraftResult> CreateDraftAsync(string clientRequestId, FeedbackFields fields, string diagnosticsJson, CancellationToken ct)
        {
            var body = FieldsBody(clientRequestId, fields);
            if (!string.IsNullOrEmpty(diagnosticsJson))
            {
                using (JsonDocument doc = JsonDocument.Parse(diagnosticsJson)) body["diagnostics"] = doc.RootElement.Clone();
                body["diagnostics_schema"] = FeedbackDiagnostics.Schema;
            }
            using (JsonDocument res = await SendJsonAsync(HttpMethod.Post, Base + "/drafts", body, ct).ConfigureAwait(false))
            {
                JsonElement r = res.RootElement.GetProperty("request");
                return new FeedbackDraftResult
                {
                    Id = Str(r, "id"),
                    Status = Str(r, "status"),
                    Reused = res.RootElement.TryGetProperty("reused", out JsonElement u) && u.ValueKind == JsonValueKind.True,
                };
            }
        }

        public async Task<FeedbackReservedAttachment> ReserveAsync(string draftId, FeedbackAttachment a, bool sendHash, CancellationToken ct)
        {
            var body = new Dictionary<string, object>
            {
                ["client_attachment_id"] = a.ClientAttachmentId,
                ["name"] = a.Name,
                ["size"] = a.Size,
                ["kind"] = a.Kind == "screenshot" || a.Kind == "diagnostics" ? a.Kind : "file",
            };
            if (sendHash && !string.IsNullOrEmpty(a.Sha256)) body["sha256"] = a.Sha256;
            using (JsonDocument res = await SendJsonAsync(HttpMethod.Post, Base + "/drafts/" + Uri.EscapeDataString(draftId) + "/attachments", body, ct).ConfigureAwait(false))
                return Attachment(res.RootElement.GetProperty("attachment"));
        }

        public async Task<FeedbackReservedAttachment> PutContentAsync(string attachmentId, Stream content, long length, CancellationToken ct)
        {
            var sc = new StreamContent(content, 81920);
            sc.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
            sc.Headers.ContentLength = length;
            using (JsonDocument res = await SendAsync(HttpMethod.Put, Base + "/attachments/" + Uri.EscapeDataString(attachmentId) + "/content", sc, UploadTimeout, ct).ConfigureAwait(false))
                return Attachment(res.RootElement.GetProperty("attachment"));
        }

        public async Task<IList<int>> PutPartAsync(string attachmentId, int partNumber, byte[] buffer, int count, string sha256, CancellationToken ct)
        {
            var bc = new ByteArrayContent(buffer, 0, count);
            bc.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
            string path = Base + "/attachments/" + Uri.EscapeDataString(attachmentId) + "/parts/" + partNumber + (string.IsNullOrEmpty(sha256) ? "" : "?sha256=" + sha256);
            using (JsonDocument res = await SendAsync(HttpMethod.Put, path, bc, UploadTimeout, ct).ConfigureAwait(false))
                return Ints(res.RootElement, "uploaded_parts");
        }

        public async Task<FeedbackReservedAttachment> CompleteAsync(string attachmentId, CancellationToken ct)
        {
            using (JsonDocument res = await SendJsonAsync(HttpMethod.Post, Base + "/attachments/" + Uri.EscapeDataString(attachmentId) + "/complete", new Dictionary<string, object>(), ct).ConfigureAwait(false))
                return Attachment(res.RootElement.GetProperty("attachment"));
        }

        public async Task<FeedbackSubmitResult> SubmitAsync(string draftId, string clientRequestId, FeedbackFields fields, IList<string> attachmentIds, CancellationToken ct)
        {
            var body = FieldsBody(clientRequestId, fields);
            body["attachment_ids"] = attachmentIds;
            using (JsonDocument res = await SendJsonAsync(HttpMethod.Post, Base + "/drafts/" + Uri.EscapeDataString(draftId) + "/submit", body, ct, TimeSpan.FromSeconds(90)).ConfigureAwait(false))
            {
                return new FeedbackSubmitResult
                {
                    Receipt = Receipt(res.RootElement.GetProperty("receipt")),
                    AlreadySubmitted = res.RootElement.TryGetProperty("already_submitted", out JsonElement a) && a.ValueKind == JsonValueKind.True,
                };
            }
        }

        /// <summary>Өөрийн хүсэлтүүдийн нийтийн төлөв (<c>GET /mine</c>) — «Миний хүсэлтүүд» таб.</summary>
        public async Task<List<MineRow>> MineAsync(CancellationToken ct)
        {
            using (JsonDocument res = await SendAsync(HttpMethod.Get, Base + "/mine", null, JsonTimeout, ct).ConfigureAwait(false))
            {
                var list = new List<MineRow>();
                foreach (JsonElement e in res.RootElement.GetProperty("items").EnumerateArray())
                {
                    list.Add(new MineRow
                    {
                        Id = Str(e, "id"),
                        DisplayNumber = Str(e, "display_number"),
                        Title = Str(e, "title"),
                        Status = Str(e, "status"),
                        StatusLabel = Str(e, "status_label"),
                        SubmittedAt = Str(e, "submitted_at"),
                        CanRetest = e.TryGetProperty("can_retest", out JsonElement c) && c.ValueKind == JsonValueKind.True,
                    });
                }
                return list;
            }
        }

        /// <summary>«Засагдаагүй» / «Ажиллаж байна» — одоогийн оношилгоотой (<c>POST /mine/:id/retest</c>).</summary>
        public async Task<string> RetestAsync(string requestId, string action, string note, string clientEventId, string diagnosticsJson, CancellationToken ct)
        {
            var body = new Dictionary<string, object> { ["action"] = action, ["client_event_id"] = clientEventId };
            if (!string.IsNullOrWhiteSpace(note)) body["note"] = note.Trim();
            if (!string.IsNullOrEmpty(diagnosticsJson))
                using (JsonDocument doc = JsonDocument.Parse(diagnosticsJson)) body["diagnostics"] = doc.RootElement.Clone();
            using (JsonDocument res = await SendJsonAsync(HttpMethod.Post, Base + "/mine/" + Uri.EscapeDataString(requestId) + "/retest", body, ct).ConfigureAwait(false))
                return Str(res.RootElement, "status_label");
        }

        /// <summary><c>GET /capabilities</c> — серверийн хязгаар (<see cref="FeedbackLimits.ApplyCapabilities"/>).</summary>
        public async Task<string> CapabilitiesJsonAsync(CancellationToken ct)
        {
            using (JsonDocument res = await SendAsync(HttpMethod.Get, Base + "/capabilities", null, JsonTimeout, ct).ConfigureAwait(false))
                return res.RootElement.GetRawText();
        }

        /* ─────────────────────────── дотоод ─────────────────────────── */

        private Task<JsonDocument> SendJsonAsync(HttpMethod method, string path, object body, CancellationToken ct, TimeSpan? timeout = null)
        {
            var content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
            return SendAsync(method, path, content, timeout ?? JsonTimeout, ct);
        }

        private async Task<JsonDocument> SendAsync(HttpMethod method, string path, HttpContent content, TimeSpan timeout, CancellationToken ct)
        {
            (string host, string token) = Current();
            using (var cts = CancellationTokenSource.CreateLinkedTokenSource(ct))
            {
                cts.CancelAfter(timeout);
                using (var req = new HttpRequestMessage(method, host.TrimEnd('/') + path) { Content = content })
                {
                    req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                    HttpResponseMessage res;
                    try
                    {
                        res = await Http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, cts.Token).ConfigureAwait(false);
                    }
                    catch (OperationCanceledException) when (!ct.IsCancellationRequested)
                    {
                        throw new FeedbackNetworkException("Сервер " + (int)timeout.TotalSeconds + " секундэд хариулсангүй");
                    }
                    catch (HttpRequestException ex)
                    {
                        throw new FeedbackNetworkException("Сервер рүү холбогдож чадсангүй: " + ex.Message, ex);
                    }
                    using (res)
                    {
                        string text = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
                        if (res.IsSuccessStatusCode)
                        {
                            try { return JsonDocument.Parse(string.IsNullOrEmpty(text) ? "{}" : text); }
                            catch (JsonException) { throw new FeedbackHttpException((int)res.StatusCode, "BAD_RESPONSE", "Серверийн хариу JSON биш (прокси / Cloudflare?)"); }
                        }
                        throw ToError(res, text);
                    }
                }
            }
        }

        private (string host, string token) Current()
        {
            (string host, string token) = TokenProvider();
            if (string.IsNullOrEmpty(host) || string.IsNullOrEmpty(token))
                throw new FeedbackHttpException(401, "NOT_SIGNED_IN", "Нэвтрээгүй байна");
            if (!FeedbackScope.TryReadToken(token, out long sub, out string tid) || FeedbackScope.Key(host, tid, sub) != _scope)
                throw new FeedbackHttpException(401, "SCOPE_CHANGED", "Өөр бүртгэлээр нэвтэрсэн байна — энэ хүсэлтийг анх илгээсэн хүн нэвтэрмэгц илгээгдэнэ");
            return (host, token);
        }

        private static FeedbackHttpException ToError(HttpResponseMessage res, string text)
        {
            int status = (int)res.StatusCode;
            string code = null, message = null;
            FeedbackReceipt receipt = null;
            List<int> missing = null;
            try
            {
                using (JsonDocument d = JsonDocument.Parse(text))
                {
                    JsonElement r = d.RootElement;
                    code = Str(r, "code");
                    message = Str(r, "error");
                    if (r.TryGetProperty("receipt", out JsonElement rc) && rc.ValueKind == JsonValueKind.Object) receipt = Receipt(rc);
                    if (r.TryGetProperty("missing", out JsonElement m) && m.ValueKind == JsonValueKind.Array) missing = new List<int>(Ints(r, "missing"));
                }
            }
            catch (JsonException)
            {
                // Cloudflare-ийн HTML алдаа г.м.
                message = status == 403 && text != null && text.IndexOf("1010", StringComparison.Ordinal) >= 0
                    ? "Cloudflare хүсэлтийг хаасан (1010)"
                    : "HTTP " + status;
            }
            TimeSpan? retryAfter = null;
            RetryConditionHeaderValue ra = res.Headers.RetryAfter;
            if (ra != null)
            {
                if (ra.Delta.HasValue) retryAfter = ra.Delta.Value;
                else if (ra.Date.HasValue) retryAfter = ra.Date.Value - DateTimeOffset.UtcNow;
            }
            return new FeedbackHttpException(status, code, message, retryAfter, receipt, missing);
        }

        private static Dictionary<string, object> FieldsBody(string clientRequestId, FeedbackFields f)
        {
            var b = new Dictionary<string, object>
            {
                ["client_request_id"] = clientRequestId,
                ["source"] = f.Source,
                ["type"] = f.Type,
                ["title"] = f.Title,
                ["description"] = f.Description,
            };
            void Opt(string k, string v) { if (!string.IsNullOrWhiteSpace(v)) b[k] = v; }
            Opt("tool_id", f.ToolId);
            Opt("source_context", f.SourceContext);
            Opt("expected", f.Expected);
            Opt("actual", f.Actual);
            Opt("steps", f.Steps);
            Opt("suggestion", f.Suggestion);
            Opt("impact", f.Impact);
            Opt("revit_build", f.RevitBuild);
            Opt("addin_version", f.AddinVersion);
            Opt("addin_sha256", f.AddinSha256);
            if (f.RevitYear.HasValue) b["revit_year"] = f.RevitYear.Value;
            return b;
        }

        private static FeedbackReservedAttachment Attachment(JsonElement a) => new FeedbackReservedAttachment
        {
            Id = Str(a, "id"),
            State = Str(a, "state"),
            Mode = Str(a, "mode"),
            PartSize = a.TryGetProperty("part_size", out JsonElement ps) && ps.ValueKind == JsonValueKind.Number ? ps.GetInt32() : 0,
            PartCount = a.TryGetProperty("part_count", out JsonElement pc) && pc.ValueKind == JsonValueKind.Number ? pc.GetInt32() : 1,
            UploadedParts = new List<int>(Ints(a, "uploaded_parts")),
        };

        private static FeedbackReceipt Receipt(JsonElement r) => new FeedbackReceipt
        {
            RequestId = Str(r, "id"),
            Number = r.TryGetProperty("number", out JsonElement n) && n.ValueKind == JsonValueKind.Number ? n.GetInt32() : (int?)null,
            DisplayNumber = Str(r, "display_number"),
            Status = Str(r, "status"),
            StatusLabel = Str(r, "status_label"),
            SubmittedAt = Str(r, "submitted_at"),
        };

        private static string Str(JsonElement o, string name) =>
            o.ValueKind == JsonValueKind.Object && o.TryGetProperty(name, out JsonElement v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

        private static IList<int> Ints(JsonElement o, string name)
        {
            var list = new List<int>();
            if (o.ValueKind == JsonValueKind.Object && o.TryGetProperty(name, out JsonElement v) && v.ValueKind == JsonValueKind.Array)
                foreach (JsonElement x in v.EnumerateArray())
                    if (x.ValueKind == JsonValueKind.Number && x.TryGetInt32(out int i)) list.Add(i);
            return list;
        }
    }

    internal sealed class MineRow
    {
        public string Id { get; set; }
        public string DisplayNumber { get; set; }
        public string Title { get; set; }
        public string Status { get; set; }
        public string StatusLabel { get; set; }
        public string SubmittedAt { get; set; }
        public bool CanRetest { get; set; }
    }
}
