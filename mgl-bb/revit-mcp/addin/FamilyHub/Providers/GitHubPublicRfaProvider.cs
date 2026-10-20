using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using RevitMcpAddin.FamilyHub.Core;

namespace RevitMcpAddin.FamilyHub.Providers
{
    /// <summary>
    /// Нэг нийтийн GitHub repo-гийн .rfa файлууд — «owner/repo@ref».</summary>
    public sealed class GitHubRfaSource
    {
        public string Owner { get; set; }
        public string Repo { get; set; }
        public string Ref { get; set; } = "main";
        /// <summary>Хэрэглэгчид харуулах эх сурвалжийн нэр (Manufacturer талбар).</summary>
        public string Label { get; set; }
        /// <summary>README-д лиценз заагаагүй бол UI-д анхааруулах.</summary>
        public string LicenseNote { get; set; }

        public string Key { get { return Owner + "/" + Repo + "@" + Ref; } }

        /// <summary>"owner/repo@ref" эсвэл "owner/repo" (ref=main).</summary>
        public static GitHubRfaSource Parse(string spec)
        {
            if (string.IsNullOrWhiteSpace(spec)) return null;
            string s = spec.Trim();
            string r = "main";
            int at = s.IndexOf('@');
            if (at > 0) { r = s.Substring(at + 1); s = s.Substring(0, at); }
            string[] parts = s.Split('/');
            if (parts.Length != 2 || parts[0].Length == 0 || parts[1].Length == 0) return null;
            return new GitHubRfaSource { Owner = parts[0], Repo = parts[1], Ref = r, Label = parts[0] };
        }
    }

    /// <summary>
    /// FALLBACK НИЙЛҮҮЛЭГЧ — жинхэнэ anonymous, нийтийн RFA татах эх сурвалж.
    ///
    /// 2026-09-15-нд ХЭМЖСЭН (нэвтрэлтгүй):
    ///   GET https://api.github.com/repos/StudioLE/RevitFamilies/git/trees/main?recursive=1 → 200 (16 .rfa)
    ///   GET https://raw.githubusercontent.com/StudioLE/RevitFamilies/main/LE%20Chair.rfa   → 200,
    ///       application/octet-stream, 307 200 байт, redirect 0, магик D0CF11E0 (OLE), дотор нь
    ///       «Revit Build: Autodesk Revit 2018».
    ///   anonymous rate limit: 60 хүсэлт/цаг (X-RateLimit-Limit: 60) → модны жагсаалтыг КЭШЛЭНЭ.
    ///
    /// Эх сурвалж нь ЦАГААН ЖАГСААЛТ (`Sources`) — GitHub-ыг бүхэлд нь хайхгүй,
    /// хэдэн repo-гийн модыг л уншина.  Хайлт = кэшлэсэн жагсаалтыг локал шүүх.
    /// </summary>
    public sealed class GitHubPublicRfaProvider : IFamilyProvider
    {
        public const string Id = "github";

        public static readonly GitHubRfaSource DefaultSource = new GitHubRfaSource
        {
            Owner = "StudioLE",
            Repo = "RevitFamilies",
            Ref = "main",
            Label = "StudioLE (GitHub)",
            LicenseNote = "Repo-д LICENSE файл алга — POC-ийн туршилтын файл болгон л ашиглана, тараахгүй.",
        };

        private readonly List<GitHubRfaSource> _sources;
        private readonly HttpClient _api;
        private readonly TimeSpan _cacheTtl;
        private readonly string _cacheDir;
        private readonly object _gate = new object();
        private readonly Dictionary<string, CachedTree> _mem = new Dictionary<string, CachedTree>(StringComparer.Ordinal);

        public string ProviderId { get { return Id; } }
        public string DisplayName { get { return "GitHub (нийтийн .rfa)"; } }

        public ProviderCapabilities Capabilities { get; } = new ProviderCapabilities
        {
            SupportsAnonymousSearch = true,
            SupportsAnonymousPreview = false, // файл бүрд thumbnail байхгүй — таамаглахгүй
            SupportsAnonymousDownload = true,
            RequiresAuthentication = false,
            SupportsDirectRevitAssets = true,
        };

        /// <summary>Баталгаажсан татах хостууд.  `objects.githubusercontent.com` = raw-ийн LFS/CDN redirect зорилт.</summary>
        public IReadOnlyList<string> AllowedDownloadHosts { get; } = new[] { "raw.githubusercontent.com", "objects.githubusercontent.com" };

        public IReadOnlyList<GitHubRfaSource> Sources { get { return _sources; } }

        public GitHubPublicRfaProvider(IEnumerable<GitHubRfaSource> sources = null, HttpMessageHandler handler = null,
            TimeSpan? cacheTtl = null, string cacheDir = null, string userAgent = null)
        {
            _sources = new List<GitHubRfaSource>(sources ?? new[] { DefaultSource });
            _api = handler != null ? new HttpClient(handler, disposeHandler: false) : new HttpClient();
            _api.Timeout = TimeSpan.FromSeconds(20);
            _api.DefaultRequestHeaders.UserAgent.ParseAdd(userAgent ?? "MglRevitAddin-FamilyHub/0.1");
            _api.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
            _cacheTtl = cacheTtl ?? TimeSpan.FromMinutes(15);
            _cacheDir = cacheDir;
        }

        /// <summary>Нэмэлт эх сурвалж: `FAMILYHUB_GITHUB_SOURCES=owner/repo@ref;owner2/repo2` (тестэд).</summary>
        public static List<GitHubRfaSource> SourcesFromEnvironment()
        {
            var list = new List<GitHubRfaSource> { DefaultSource };
            string env = Environment.GetEnvironmentVariable("FAMILYHUB_GITHUB_SOURCES");
            if (string.IsNullOrWhiteSpace(env)) return list;
            foreach (string spec in env.Split(new[] { ';', ',' }, StringSplitOptions.RemoveEmptyEntries))
            {
                GitHubRfaSource s = GitHubRfaSource.Parse(spec);
                if (s != null && !list.Exists(x => x.Key == s.Key)) list.Add(s);
            }
            return list;
        }

        public async Task<SearchResult> SearchAsync(FamilySearchQuery query, CancellationToken cancellationToken)
        {
            var result = new SearchResult();
            string[] tokens = Tokenize(query != null ? query.Text : null);
            int limit = query != null && query.Limit > 0 ? query.Limit : 50;
            var notices = new List<string>();
            foreach (GitHubRfaSource src in _sources)
            {
                List<FamilyProduct> all;
                try
                {
                    all = await ListAsync(src, cancellationToken).ConfigureAwait(false);
                }
                catch (OperationCanceledException) { throw; }
                catch (Exception ex)
                {
                    notices.Add(src.Key + ": " + ex.Message);
                    continue;
                }
                foreach (FamilyProduct p in all)
                {
                    if (!Matches(p, tokens)) continue;
                    if (result.Items.Count >= limit) { result.Truncated = true; break; }
                    result.Items.Add(p);
                }
                if (!string.IsNullOrEmpty(src.LicenseNote)) notices.Add(src.Key + ": " + src.LicenseNote);
            }
            if (notices.Count > 0) result.Notice = string.Join("\n", notices);
            return result;
        }

        public async Task<FamilyProduct> GetProductAsync(string externalId, CancellationToken cancellationToken)
        {
            // externalId = "owner/repo@ref:path/in/repo.rfa"
            if (string.IsNullOrEmpty(externalId)) return null;
            int colon = externalId.IndexOf(':');
            if (colon <= 0) return null;
            GitHubRfaSource src = GitHubRfaSource.Parse(externalId.Substring(0, colon));
            if (src == null) return null;
            GitHubRfaSource known = _sources.Find(s => s.Key == src.Key);
            if (known == null) return null; // цагаан жагсаалтын гаднах repo — үгүй
            string path = externalId.Substring(colon + 1);
            foreach (FamilyProduct p in await ListAsync(known, cancellationToken).ConfigureAwait(false))
                if (string.Equals(p.ExternalId, externalId, StringComparison.Ordinal)) return p;
            return null;
        }

        public Task<FamilyDownloadResult> ResolveDownloadAsync(FamilyProduct product, CancellationToken cancellationToken)
        {
            if (product == null || product.ProviderId != Id)
                return Task.FromResult(FamilyDownloadResult.MetadataOnly("Өөр нийлүүлэгчийн бүтээгдэхүүн"));
            int colon = product.ExternalId.IndexOf(':');
            GitHubRfaSource src = colon > 0 ? GitHubRfaSource.Parse(product.ExternalId.Substring(0, colon)) : null;
            if (src == null || _sources.Find(s => s.Key == src.Key) == null)
                return Task.FromResult(FamilyDownloadResult.MetadataOnly("Эх сурвалж цагаан жагсаалтад байхгүй"));
            string path = product.ExternalId.Substring(colon + 1);
            var url = new Uri("https://raw.githubusercontent.com/" + Esc(src.Owner) + "/" + Esc(src.Repo) + "/" + Esc(src.Ref) + "/" + EscPath(path));
            return Task.FromResult(new FamilyDownloadResult
            {
                Capability = DownloadCapability.AnonymousDirect,
                Url = url,
                FileName = Path.GetFileName(path),
                ExpectedSizeBytes = product.SizeBytes,
            });
        }

        /* ───────────── мод унших + кэш ───────────── */

        private sealed class CachedTree
        {
            public DateTime FetchedUtc { get; set; }
            public List<FamilyProduct> Items { get; set; }
        }

        private async Task<List<FamilyProduct>> ListAsync(GitHubRfaSource src, CancellationToken ct)
        {
            lock (_gate)
            {
                CachedTree c;
                if (_mem.TryGetValue(src.Key, out c) && DateTime.UtcNow - c.FetchedUtc < _cacheTtl) return c.Items;
            }
            List<FamilyProduct> disk = TryReadDiskCache(src);
            if (disk != null)
            {
                lock (_gate) _mem[src.Key] = new CachedTree { FetchedUtc = DateTime.UtcNow, Items = disk };
                return disk;
            }

            var url = "https://api.github.com/repos/" + Esc(src.Owner) + "/" + Esc(src.Repo) + "/git/trees/" + Esc(src.Ref) + "?recursive=1";
            string json;
            using (HttpResponseMessage res = await _api.GetAsync(url, ct).ConfigureAwait(false))
            {
                if ((int)res.StatusCode == 403 || (int)res.StatusCode == 429)
                    throw new InvalidOperationException("GitHub API rate limit / 403 — дараа дахин оролдоно уу");
                if (!res.IsSuccessStatusCode)
                    throw new InvalidOperationException("GitHub API HTTP " + (int)res.StatusCode);
                json = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
            }
            List<FamilyProduct> items = ParseTree(src, json);
            lock (_gate) _mem[src.Key] = new CachedTree { FetchedUtc = DateTime.UtcNow, Items = items };
            TryWriteDiskCache(src, json);
            return items;
        }

        /// <summary>GitHub trees JSON → бүтээгдэхүүний метадата (зөвхөн .rfa blob).  Тестэд ил.</summary>
        public static List<FamilyProduct> ParseTree(GitHubRfaSource src, string json)
        {
            var list = new List<FamilyProduct>();
            using (JsonDocument doc = JsonDocument.Parse(json))
            {
                JsonElement tree;
                if (!doc.RootElement.TryGetProperty("tree", out tree)) return list;
                foreach (JsonElement e in tree.EnumerateArray())
                {
                    string type = Str(e, "type");
                    string path = Str(e, "path");
                    if (type != "blob" || path == null || !path.EndsWith(".rfa", StringComparison.OrdinalIgnoreCase)) continue;
                    string sha = Str(e, "sha");
                    long size = 0;
                    JsonElement sz;
                    if (e.TryGetProperty("size", out sz) && sz.ValueKind == JsonValueKind.Number) size = sz.GetInt64();
                    string dir = path.Contains("/") ? path.Substring(0, path.LastIndexOf('/')) : null;
                    list.Add(new FamilyProduct
                    {
                        ProviderId = Id,
                        ExternalId = src.Key + ":" + path,
                        ExternalAssetId = sha,
                        AssetVersion = src.Ref,
                        Name = Path.GetFileNameWithoutExtension(path),
                        Manufacturer = src.Label ?? src.Owner,
                        Category = dir ?? src.Repo,
                        Subcategory = null,
                        ProductUrl = "https://github.com/" + src.Owner + "/" + src.Repo + "/blob/" + src.Ref + "/" + EscPath(path),
                        ThumbnailUrl = null,
                        Formats = new List<string> { "rfa" },
                        RevitVersions = new List<string>(), // мэдэгдэхгүй — татсаны дараа файлаас уншина
                        DownloadCapability = DownloadCapability.AnonymousDirect,
                        SizeBytes = size,
                    });
                }
            }
            list.Sort((a, b) => string.Compare(a.Name, b.Name, StringComparison.OrdinalIgnoreCase));
            return list;
        }

        private string DiskCachePath(GitHubRfaSource src)
        {
            if (string.IsNullOrEmpty(_cacheDir)) return null;
            string safe = (src.Owner + "_" + src.Repo + "_" + src.Ref).Replace('/', '_');
            return Path.Combine(_cacheDir, "github-tree-" + safe + ".json");
        }

        private List<FamilyProduct> TryReadDiskCache(GitHubRfaSource src)
        {
            try
            {
                string p = DiskCachePath(src);
                if (p == null || !File.Exists(p)) return null;
                if (DateTime.UtcNow - File.GetLastWriteTimeUtc(p) > _cacheTtl) return null;
                return ParseTree(src, File.ReadAllText(p));
            }
            catch { return null; }
        }

        private void TryWriteDiskCache(GitHubRfaSource src, string json)
        {
            try
            {
                string p = DiskCachePath(src);
                if (p == null) return;
                Directory.CreateDirectory(Path.GetDirectoryName(p));
                File.WriteAllText(p + ".tmp", json);
                if (File.Exists(p)) File.Delete(p);
                File.Move(p + ".tmp", p);
            }
            catch { }
        }

        /* ───────────── туслах ───────────── */

        public static string[] Tokenize(string text)
        {
            if (string.IsNullOrWhiteSpace(text)) return new string[0];
            return text.ToLowerInvariant().Split(new[] { ' ', '\t', ',', ';' }, StringSplitOptions.RemoveEmptyEntries);
        }

        public static bool Matches(FamilyProduct p, string[] tokens)
        {
            if (tokens.Length == 0) return true;
            string hay = ((p.Name ?? "") + " " + (p.Category ?? "") + " " + (p.Manufacturer ?? "") + " " + (p.ExternalId ?? "")).ToLowerInvariant();
            foreach (string t in tokens)
                if (hay.IndexOf(t, StringComparison.Ordinal) < 0) return false;
            return true;
        }

        private static string Str(JsonElement e, string name)
        {
            JsonElement v;
            return e.TryGetProperty(name, out v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        }

        private static string Esc(string s) { return Uri.EscapeDataString(s); }

        private static string EscPath(string path)
        {
            string[] segs = path.Split('/');
            for (int i = 0; i < segs.Length; i++) segs[i] = Uri.EscapeDataString(segs[i]);
            return string.Join("/", segs);
        }
    }
}
