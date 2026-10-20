using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using RevitMcpAddin.Intelligence.Contracts;

namespace RevitMcpAddin.Intelligence.Core
{
    /// <summary>ERP-ийн төслийн товч мөр — `ProjectInfo`-гийн цэвэр хос (Revit/HTTP-гүй тест).</summary>
    public sealed class ErpProjectRef
    {
        public int Id;
        public string Name;
    }

    /// <summary>Хадгалсан, хэрэглэгчийн БАТАЛГААЖУУЛСАН холбоос (`project-links.json`-ийн нэг мөр).</summary>
    public sealed class StoredProjectLink
    {
        public string DocKey;
        public int ProjectId;
        public string ProjectName;
        public string ConfirmedAt;
        /// <summary>USER_CONFIRMED | SERVER_HANDSHAKE</summary>
        public string ConfirmedBy;
    }

    /// <summary>
    /// ТӨСЛИЙН ХОЛБООСЫН БОДЛОГО (§27–28, R-10) — ЦЭВЭР.
    ///
    ///   хадгалсан баталгаажсан холбоос     → CONFIRMED (USER_CONFIRMED)
    ///   серверт ЭНЭ баримт ЭНЭ төсөлд бүртгэлтэй (handshake) → CONFIRMED (SERVER_HANDSHAKE)
    ///   Тохиргооны төсөл / нэрийн таарц    → SUGGESTED (хэзээ ч CONFIRMED биш)
    ///   ERP хүрэхгүй, санал ч байхгүй      → ERP_OFFLINE / UNLINKED
    ///
    /// ⚠️ Тохиргооны `ProjectId` нь МАШИНЫ хэмжээнд нэг тоо — баримт тутамд
    ///    биш.  2026-08-26-нд ижил `doc_uid` хоёр төсөлд бүртгэгдсэн нь яг
    ///    үүнээс.  Тиймээс тэр нь ЗӨВХӨН хүчтэй САНАЛ (оноо 0.9).
    /// ⚠️ Файлын нэрийн таарц нь `MGL-yymmdd` кодоор л өндөр оноо авна
    ///    (`lib/mainProjects.ts parseProjectName`-ийн дүрэм); үгийн давхцал
    ///    нь сул дохио.
    /// </summary>
    public static class ProjectLinkPolicy
    {
        private static readonly Regex CodeRx = new Regex(@"MGL[-_ ]?(\d{6})", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

        public static RevitProjectLink Resolve(
            string docKey,
            string docTitle,
            string projectNameParam,
            StoredProjectLink stored,
            int? serverRegisteredProjectId,
            string serverRegisteredProjectName,
            int? settingsProjectId,
            string settingsProjectName,
            IList<ErpProjectRef> erpProjects,
            bool erpReachable,
            DateTime? nowUtc = null)
        {
            var link = new RevitProjectLink { DocKey = docKey };

            if (stored != null && string.Equals(stored.DocKey, docKey, StringComparison.Ordinal) && stored.ProjectId > 0)
            {
                link.State = ProjectLinkState.CONFIRMED;
                link.ProjectId = stored.ProjectId;
                link.ProjectName = stored.ProjectName;
                link.ConfirmedBy = string.IsNullOrEmpty(stored.ConfirmedBy) ? "USER_CONFIRMED" : stored.ConfirmedBy;
                link.ConfirmedAt = stored.ConfirmedAt;
                return link;
            }

            if (serverRegisteredProjectId.HasValue && serverRegisteredProjectId.Value > 0)
            {
                // Handshake нь хэрэглэгчийн ИЛ үйлдэл («Зураг холбох» / бүртгэх)
                // байсан тул баримт ↔ төсөл гэсэн серверийн мөр = баталгаа.
                link.State = ProjectLinkState.CONFIRMED;
                link.ProjectId = serverRegisteredProjectId;
                link.ProjectName = serverRegisteredProjectName;
                link.ConfirmedBy = "SERVER_HANDSHAKE";
                link.ConfirmedAt = (nowUtc ?? DateTime.UtcNow).ToString("o");
                return link;
            }

            var suggestions = new Dictionary<int, ProjectLinkSuggestion>();
            if (settingsProjectId.HasValue && settingsProjectId.Value > 0)
            {
                suggestions[settingsProjectId.Value] = new ProjectLinkSuggestion
                {
                    ProjectId = settingsProjectId.Value,
                    ProjectName = settingsProjectName,
                    Score = 0.9,
                    Reason = "settings",
                };
            }

            if (erpProjects != null)
            {
                string code = ExtractCode(docTitle) ?? ExtractCode(projectNameParam);
                var docTokens = Tokens(docTitle);
                foreach (string t in Tokens(projectNameParam)) docTokens.Add(t);
                foreach (ErpProjectRef p in erpProjects)
                {
                    if (p == null || p.Id <= 0) continue;
                    double score = 0;
                    string reason = null;
                    string pcode = ExtractCode(p.Name);
                    if (code != null && pcode != null && string.Equals(code, pcode, StringComparison.Ordinal))
                    {
                        score = 0.95;
                        reason = "code:" + code;
                    }
                    else if (docTokens.Count > 0)
                    {
                        var pt = Tokens(p.Name);
                        int common = 0;
                        foreach (string t in pt) if (docTokens.Contains(t)) common++;
                        int union = pt.Count + docTokens.Count - common;
                        if (union > 0 && common > 0)
                        {
                            score = Math.Round((double)common / union, 3);
                            reason = "tokens:" + common;
                        }
                    }
                    if (score < 0.2) continue;
                    ProjectLinkSuggestion existing;
                    if (suggestions.TryGetValue(p.Id, out existing))
                    {
                        if (score > existing.Score) { existing.Score = score; existing.Reason = reason; }
                        if (string.IsNullOrEmpty(existing.ProjectName)) existing.ProjectName = p.Name;
                    }
                    else
                    {
                        suggestions[p.Id] = new ProjectLinkSuggestion { ProjectId = p.Id, ProjectName = p.Name, Score = score, Reason = reason };
                    }
                }
            }

            foreach (ProjectLinkSuggestion s in suggestions.Values) link.Suggestions.Add(s);
            link.Suggestions.Sort((a, b) =>
            {
                int c = b.Score.CompareTo(a.Score);
                return c != 0 ? c : a.ProjectId.CompareTo(b.ProjectId);
            });
            if (link.Suggestions.Count > 5) link.Suggestions.RemoveRange(5, link.Suggestions.Count - 5);

            if (link.Suggestions.Count > 0) link.State = ProjectLinkState.SUGGESTED;
            else link.State = erpReachable ? ProjectLinkState.UNLINKED : ProjectLinkState.ERP_OFFLINE;
            return link;
        }

        /// <summary>Хэрэглэгч ИЛ баталгаажуулав — ЭНЭ Л функц `USER_CONFIRMED` үүсгэнэ.</summary>
        public static StoredProjectLink Confirm(string docKey, int projectId, string projectName, DateTime? nowUtc = null)
        {
            if (string.IsNullOrEmpty(docKey)) throw new ArgumentException("docKey");
            if (projectId <= 0) throw new ArgumentException("projectId");
            return new StoredProjectLink
            {
                DocKey = docKey,
                ProjectId = projectId,
                ProjectName = projectName,
                ConfirmedAt = (nowUtc ?? DateTime.UtcNow).ToString("o"),
                ConfirmedBy = "USER_CONFIRMED",
            };
        }

        public static string ExtractCode(string s)
        {
            if (string.IsNullOrEmpty(s)) return null;
            Match m = CodeRx.Match(s);
            return m.Success ? m.Groups[1].Value : null;
        }

        /// <summary>Кирилл↔латин эвхэлттэй (`TextFold.Fold`) үгсийн олонлог; 2-оос богино үг хасагдана.</summary>
        internal static HashSet<string> Tokens(string s)
        {
            var set = new HashSet<string>(StringComparer.Ordinal);
            if (string.IsNullOrWhiteSpace(s)) return set;
            string folded = TextFold.Fold(s);
            foreach (string t in folded.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries))
            {
                if (t.Length >= 3) set.Add(t);
            }
            return set;
        }
    }
}
