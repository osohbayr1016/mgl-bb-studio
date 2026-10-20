using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using RevitMcpAddin.WorkPane.Core;

namespace RevitMcpAddin.WorkPane
{
    /// <summary>
    /// «MGL ажил» самбарын сервертэй харилцах ЖИЖИГ клиент.
    ///
    /// ⚠️ `AiHttp.Http` (20 с, UA-тай) тээврийг л хуваалцана — `ApiClient.Http`
    ///    (180 с, QTO push-д) самбарын нэг товчийг гурван минут «дүүжлэх» тул
    ///    БҮҮ хэрэглэ (`RevitApi.SendShortAsync`-ийн ижил шийдвэр).
    /// ⚠️ Цаг бүртгэл (`/tracking/*`), тайлангийн дараалал нь `WorkTrackingHost`-ынх —
    ///    энд ЗӨВХӨН самбарын унших гарц + «Ажилласан» тэмдэг.
    /// </summary>
    internal static class WorkPaneApi
    {
        private const int TimeoutSec = 15;

        private static HttpRequestMessage Req(HttpMethod m, string host, string path, string token, object payload = null)
        {
            var req = new HttpRequestMessage(m, ApiClient.Url(host, path));
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            if (payload != null) req.Content = ApiClient.JsonContent(payload);
            return req;
        }

        private static async Task<string> SendAsync(HttpRequestMessage req, CancellationToken ct)
        {
            using (req)
            using (var cts = CancellationTokenSource.CreateLinkedTokenSource(ct))
            {
                cts.CancelAfter(TimeSpan.FromSeconds(TimeoutSec));
                using (HttpResponseMessage res = await AiHttp.Http.SendAsync(req, cts.Token).ConfigureAwait(false))
                {
                    string body = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
                    if (!res.IsSuccessStatusCode) throw ApiClient.Error(res, body);
                    return body;
                }
            }
        }

        /// <summary>`GET /api/revit/work-context` — файл → төсөл → миний нээлттэй таскууд.</summary>
        public static async Task<WorkContextDto> GetWorkContextAsync(
            string host, string token, ActiveDocInfo doc, int? hintProjectId, CancellationToken ct)
        {
            string q = "/api/revit/work-context?doc_uid=" + Uri.EscapeDataString(doc.DocUid ?? string.Empty) +
                       Param("title", doc.Title) + Param("file_name", doc.FileName) +
                       Param("project_number", doc.ProjectNumber) + Param("project_name", doc.ProjectName);
            if (hintProjectId.HasValue && hintProjectId.Value > 0) q += "&project_id=" + hintProjectId.Value;
            string body = await SendAsync(Req(HttpMethod.Get, host, q, token), ct).ConfigureAwait(false);
            return JsonSerializer.Deserialize<WorkContextDto>(body, ApiClient.ReadOptions) ?? new WorkContextDto();
        }

        /// <summary>
        /// `POST /api/repair {project_id, task_id}` — цагаар явдаг (ZA) таскийн «Ажилласан»
        /// тэмдэг (0348).  Цагийг СЕРВЕР бодно; өдөрт нэг удаа (давтвал 200).
        /// ⚠️ admin энэ замыг ашиглах эрхгүй (`REPAIR_ROLES`) — 403-ийг ойлгомжтой хэлнэ.
        /// </summary>
        public static Task<string> MarkWorkedAsync(string host, string token, int projectId, int taskId, CancellationToken ct)
        {
            return SendAsync(Req(HttpMethod.Post, host, "/api/repair", token,
                new { project_id = projectId, task_id = taskId }), ct);
        }

        /// <summary>`GET /api/auth/me` — толгойд харуулах нэр.  Алдаа гарвал null (чимэглэл).</summary>
        public static async Task<string> GetDisplayNameAsync(string host, string token, CancellationToken ct)
        {
            try
            {
                string body = await SendAsync(Req(HttpMethod.Get, host, "/api/auth/me", token), ct).ConfigureAwait(false);
                using (JsonDocument d = JsonDocument.Parse(body))
                {
                    JsonElement u;
                    if (!d.RootElement.TryGetProperty("user", out u)) return null;
                    string full = Str(u, "full_name");
                    string username = Str(u, "username");
                    if (!string.IsNullOrWhiteSpace(full)) return full.Trim();
                    return string.IsNullOrWhiteSpace(username) ? null : username.Trim();
                }
            }
            catch (UnauthorizedException) { throw; }
            catch { return null; }
        }

        private static string Str(JsonElement o, string name)
        {
            JsonElement v;
            return o.TryGetProperty(name, out v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        }

        private static string Param(string name, string value)
        {
            return string.IsNullOrWhiteSpace(value) ? string.Empty : "&" + name + "=" + Uri.EscapeDataString(value.Trim());
        }
    }

    /// <summary>
    /// Идэвхтэй баримтын ЭНГИЙН мэдээлэл — Revit-ийн объект БИШ.  `get_document_context`
    /// хэрэгслээр (RevitToolBus → Revit-ийн үндсэн thread) уншигдаж, самбарт
    /// зөвхөн мөр болж ирнэ (Revit API-г арын thread-ээс хэзээ ч хөндөхгүй).
    /// </summary>
    internal sealed class ActiveDocInfo
    {
        public string DocUid;
        public string Title;
        public string FileName;
        public string ProjectNumber;
        public string ProjectName;
        public string RevitVersion;
        public bool IsFamily;
        public bool IsLink;

        public static ActiveDocInfo FromToolJson(JsonElement j)
        {
            return new ActiveDocInfo
            {
                DocUid = S(j, "doc_uid"),
                Title = S(j, "title"),
                FileName = S(j, "file_name"),
                ProjectNumber = S(j, "project_number"),
                ProjectName = S(j, "project_name"),
                RevitVersion = S(j, "revit_version"),
                IsFamily = B(j, "is_family"),
                IsLink = B(j, "is_link"),
            };
        }

        private static string S(JsonElement j, string n)
        {
            JsonElement v;
            return j.ValueKind == JsonValueKind.Object && j.TryGetProperty(n, out v) && v.ValueKind == JsonValueKind.String
                ? v.GetString()
                : null;
        }

        private static bool B(JsonElement j, string n)
        {
            JsonElement v;
            return j.ValueKind == JsonValueKind.Object && j.TryGetProperty(n, out v) && v.ValueKind == JsonValueKind.True;
        }
    }
}
