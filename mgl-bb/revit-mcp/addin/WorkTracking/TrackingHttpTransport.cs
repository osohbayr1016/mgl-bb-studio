using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using RevitMcpAddin.WorkTracking.Core;

namespace RevitMcpAddin.WorkTracking
{
    /// <summary>
    /// Цаг бүртгэлийн HTTP тээвэр — `AiHttp.Http` (20 с, `MglRevitAddin/` UA —
    /// Cloudflare-ийн 1010 хаалт) дээр, өөрийн богино хугацаатай.
    ///
    /// ⚠️ `ApiClient.Http`-ийг ХЭРЭГЛЭХГҮЙ — 180 с (QTO push) тул heartbeat
    ///    гацвал бүх loop зогсоно.
    /// ⚠️ `AiHttp.SendAsync`-ийг ДУУДАХГҮЙ — дундын доройтлын тоолуурыг хөдөлгөнө.
    /// ⚠️ Хариу нь ҮРГЭЛЖ арын thread дээр боловсрогдоно; UI thread хүлээхгүй.
    /// </summary>
    internal sealed class TrackingHttpTransport : ITrackingTransport
    {
        private static readonly JsonSerializerOptions Json = new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
        };

        private readonly Func<string> _host;

        public TrackingHttpTransport(Func<string> host)
        {
            _host = host;
        }

        private HttpRequestMessage Req(HttpMethod m, string path, string token, object payload)
        {
            string host = (_host() ?? AddinSettings.DefaultApiHost).TrimEnd('/');
            var req = new HttpRequestMessage(m, host + path);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            if (payload != null)
                req.Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
            return req;
        }

        public async Task<SyncResponse> SyncAsync(string token, SyncRequest request, CancellationToken ct)
        {
            using (HttpRequestMessage req = Req(HttpMethod.Post, "/api/revit/tracking/sync", token, request))
            using (HttpResponseMessage res = await AiHttp.Http.SendAsync(req, ct).ConfigureAwait(false))
            {
                string body = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
                if (!res.IsSuccessStatusCode)
                    throw new TrackingTransportException((int)res.StatusCode, Snip(body));
                return JsonSerializer.Deserialize<SyncResponse>(body, Json) ?? new SyncResponse();
            }
        }

        public async Task<ReportSendResult> SubmitReportAsync(string token, ReportItem r, CancellationToken ct)
        {
            object completionQa = null;
            if (!string.IsNullOrWhiteSpace(r.CompletionQaJson))
            {
                try { completionQa = JsonSerializer.Deserialize<JsonElement>(r.CompletionQaJson); }
                catch { completionQa = null; }
            }
            var payload = new Dictionary<string, object>
            {
                ["draft_uid"] = r.DraftUid,
                // Ажилтан самбар дээр «Илгээх» дарж баталсан — серверийн ижил гэрээ.
                ["confirmed"] = true,
                ["task_id"] = r.TaskId,
                ["percentage"] = r.Percentage,
                ["notes"] = r.Notes ?? string.Empty,
                ["revit_document_id"] = r.RevitDocumentId,
                ["sheet_uids"] = r.SheetUids ?? new List<string>(),
                ["report_date"] = r.ReportDate,
                ["revit_active_ms"] = r.RevitActiveMs,
                ["change"] = new Dictionary<string, object> { ["via"] = "work_tracking_report" },
                ["evidence"] = Array.Empty<object>(),
            };
            if (completionQa != null) payload["completion_qa"] = completionQa;

            using (HttpRequestMessage req = Req(HttpMethod.Post, "/api/revit/submissions", token, payload))
            using (HttpResponseMessage res = await AiHttp.Http.SendAsync(req, ct).ConfigureAwait(false))
            {
                string body = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
                ReportSendResult result = ReportResponseClassifier.Classify((int)res.StatusCode, body);
                if (result.Kind == ReportSendKind.Rejected) result.Message = Friendly(result.Message);
                return result;
            }
        }

        internal sealed class DocLookup
        {
            public int ProjectId { get; set; }
            public string ProjectName { get; set; }
            public int? DocumentId { get; set; }
        }

        /// <summary>
        /// `GET /api/revit/context?doc_uid=` — баримт серверт бүртгэгдсэн бол төслийг нь.
        /// 404 = бүртгэлгүй (null).  Самбар нээгдээгүй ч цаг бүртгэл баримтын төслийг мэдэхэд.
        /// </summary>
        public async Task<DocLookup> LookupDocumentAsync(string token, string docUid, CancellationToken ct)
        {
            using (var cts = CancellationTokenSource.CreateLinkedTokenSource(ct))
            {
                cts.CancelAfter(TimeSpan.FromSeconds(10));
                using (HttpRequestMessage req = Req(HttpMethod.Get, "/api/revit/context?doc_uid=" + Uri.EscapeDataString(docUid ?? ""), token, null))
                using (HttpResponseMessage res = await AiHttp.Http.SendAsync(req, cts.Token).ConfigureAwait(false))
                {
                    if ((int)res.StatusCode == 404) return null;
                    string body = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
                    if (!res.IsSuccessStatusCode) throw new TrackingTransportException((int)res.StatusCode, Snip(body));
                    using (JsonDocument doc = JsonDocument.Parse(body))
                    {
                        JsonElement d;
                        if (!doc.RootElement.TryGetProperty("document", out d) || d.ValueKind != JsonValueKind.Object) return null;
                        JsonElement v;
                        int pid = d.TryGetProperty("project_id", out v) && v.ValueKind == JsonValueKind.Number ? v.GetInt32() : 0;
                        if (pid <= 0) return null;
                        return new DocLookup
                        {
                            ProjectId = pid,
                            ProjectName = d.TryGetProperty("project_name", out v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null,
                            DocumentId = d.TryGetProperty("id", out v) && v.ValueKind == JsonValueKind.Number ? v.GetInt32() : (int?)null,
                        };
                    }
                }
            }
        }

        private static string Snip(string body)
        {
            if (string.IsNullOrEmpty(body)) return "";
            return body.Length > 300 ? body.Substring(0, 300) : body;
        }

        /// <summary>Серверийн алдааны кодыг ажилтанд ойлгомжтой болгоно.</summary>
        private static string Friendly(string raw)
        {
            switch (raw)
            {
                case "percentage_regression":
                    return "Хувь өмнөхөөсөө бага байна — одоогийн явцаас багагүй хувь бичнэ үү.";
                case "percentage_above_ceiling":
                case "already_at_ceiling":
                    return "Энэ хувийг Revit-ээс илгээх боломжгүй (дуусгах нь дуусгалтын асуултуудтай).";
                case "MANAGED_ROOT":
                    return "Энэ таск хуваарилагдсан — Revit-ээс хувь илгээхгүй. «Миний ажлууд» хуудаснаас өөрийн хэсгийн хувийг бөглөнө үү.";
                case "CONVERTED_PART":
                    return "Энэ хэсэг үндсэн ажилд нэгтгэгдсэн — явц, цагийг үндсэн ажил дээр «Миний ажлууд» хуудаснаас бүртгэнэ.";
                case "HOURS_PROGRESS":
                    return "Энэ төсөл цагаар бүртгэгддэг — хувь бичихгүй, «Ажилласан» тэмдэглэнэ.";
                case "indeterminate":
                    return "Өмнөх илгээлтийн үр дүн тодорхойгүй — «Миний ажлууд»-аас шалгаад, ороогүй бол дахин илгээнэ үү.";
                case "Task not found":
                    return "Таск олдсонгүй (устгагдсан байж магадгүй).";
                default:
                    return raw;
            }
        }
    }
}
