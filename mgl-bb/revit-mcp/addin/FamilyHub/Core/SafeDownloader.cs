using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace RevitMcpAddin.FamilyHub.Core
{
    public enum DownloadStatus
    {
        Ok,
        /// <summary>401 / 403 / нэвтрэх хуудас руу redirect / HTML нэвтрэх хуудас — ТОЙРОХГҮЙ.</summary>
        AuthRequired,
        NotFound,
        HostNotAllowed,
        InsecureScheme,
        TooManyRedirects,
        TooLarge,
        BadContentType,
        Timeout,
        Cancelled,
        HttpError,
        NetworkError,
    }

    public sealed class DownloadPolicy
    {
        public long MaxBytes { get; set; } = 50L * 1024 * 1024;
        public TimeSpan Timeout { get; set; } = TimeSpan.FromSeconds(120);
        public int MaxRedirects { get; set; } = 5;
        public IReadOnlyList<string> AllowedHosts { get; set; } = new string[0];
    }

    public sealed class DownloadOutcome
    {
        public DownloadStatus Status { get; set; }
        public string FilePath { get; set; }
        public string Sha256 { get; set; }
        public long Bytes { get; set; }
        public int HttpStatus { get; set; }
        public string ContentType { get; set; }
        public Uri FinalUrl { get; set; }
        public string Reason { get; set; }
        public bool Ok { get { return Status == DownloadStatus.Ok; } }

        internal static DownloadOutcome Fail(DownloadStatus s, string reason, int http = 0, Uri url = null)
        {
            return new DownloadOutcome { Status = s, Reason = reason, HttpStatus = http, FinalUrl = url };
        }
    }

    /// <summary>
    /// Гадны файлыг ИТГЭЛГҮЙ гэж үзэн татагч.  HTTPS л, хостын цагаан жагсаалт,
    /// redirect-ийг ӨӨРӨӨ дагана (хоп бүр дахин шалгагдана), хэмжээний дээд
    /// хязгаар, хугацаа, цуцлалт, урсгалын явцад SHA-256.
    ///
    /// ⚠️ `AllowAutoRedirect = false` ЗААВАЛ: автомат redirect нь нэвтрэх
    /// хуудас, эсвэл цагаан жагсаалтын гаднах домэйн руу чимээгүй хөтөлнө.
    /// </summary>
    public sealed class SafeDownloader
    {
        private static readonly string[] AllowedContentTypes =
        {
            "application/octet-stream", "binary/octet-stream", "application/zip",
            "application/x-zip-compressed", "application/x-zip", "application/vnd.autodesk.revit",
        };

        private static readonly string[] LoginPathHints =
        {
            "/login", "/signin", "/sign-in", "/sign_in", "/auth", "/account/login", "/sso", "/oauth", "/identity",
        };

        private readonly HttpClient _http;

        public SafeDownloader(HttpMessageHandler handler = null, string userAgent = null)
        {
            HttpMessageHandler h = handler ?? new HttpClientHandler
            {
                AllowAutoRedirect = false,
                AutomaticDecompression = DecompressionMethods.None,
                UseCookies = false,
            };
            _http = new HttpClient(h, disposeHandler: true) { Timeout = System.Threading.Timeout.InfiniteTimeSpan };
            _http.DefaultRequestHeaders.UserAgent.ParseAdd(userAgent ?? "MglRevitAddin-FamilyHub/0.1");
            _http.DefaultRequestHeaders.Accept.ParseAdd("application/octet-stream");
            _http.DefaultRequestHeaders.Accept.ParseAdd("application/zip");
        }

        public static bool HostAllowed(Uri url, IReadOnlyList<string> allowed)
        {
            if (url == null || allowed == null) return false;
            string host = url.Host.ToLowerInvariant();
            foreach (string raw in allowed)
            {
                if (string.IsNullOrWhiteSpace(raw)) continue;
                string a = raw.Trim().ToLowerInvariant();
                if (a.StartsWith("*."))
                {
                    string suffix = a.Substring(1); // ".example.com"
                    if (host.EndsWith(suffix, StringComparison.Ordinal) && host.Length > suffix.Length) return true;
                }
                else if (host == a) return true;
            }
            return false;
        }

        public static bool LooksLikeLoginRedirect(Uri url)
        {
            if (url == null) return false;
            string p = url.AbsolutePath.ToLowerInvariant();
            foreach (string hint in LoginPathHints)
                if (p.Contains(hint)) return true;
            string q = url.Query.ToLowerInvariant();
            return q.Contains("returnurl=") || q.Contains("redirect_uri=") || q.Contains("return_to=");
        }

        /// <summary>
        /// Файлыг <paramref name="destPath"/> руу татна.  Амжилтгүй бол хагас
        /// файл устгагдана.  Хэзээ ч алдаа шидэхгүй — үр дүн `Status`-д.
        /// </summary>
        public async Task<DownloadOutcome> DownloadAsync(
            Uri url, string destPath, DownloadPolicy policy, CancellationToken ct, IProgress<long> progress = null)
        {
            policy = policy ?? new DownloadPolicy();
            using (var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct))
            {
                timeoutCts.CancelAfter(policy.Timeout);
                CancellationToken tok = timeoutCts.Token;
                try
                {
                    return await DownloadCoreAsync(url, destPath, policy, tok, progress).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    TryDelete(destPath);
                    return ct.IsCancellationRequested
                        ? DownloadOutcome.Fail(DownloadStatus.Cancelled, "Хэрэглэгч цуцалсан", 0, url)
                        : DownloadOutcome.Fail(DownloadStatus.Timeout, "Хугацаа дууссан (" + (int)policy.Timeout.TotalSeconds + " с)", 0, url);
                }
                catch (HttpRequestException ex)
                {
                    TryDelete(destPath);
                    return DownloadOutcome.Fail(DownloadStatus.NetworkError, "Сүлжээний алдаа: " + ex.Message, 0, url);
                }
                catch (IOException ex)
                {
                    TryDelete(destPath);
                    return DownloadOutcome.Fail(DownloadStatus.NetworkError, "I/O алдаа: " + ex.Message, 0, url);
                }
            }
        }

        private async Task<DownloadOutcome> DownloadCoreAsync(
            Uri url, string destPath, DownloadPolicy policy, CancellationToken ct, IProgress<long> progress)
        {
            Uri current = url;
            for (int hop = 0; hop <= policy.MaxRedirects; hop++)
            {
                if (current == null || !current.IsAbsoluteUri)
                    return DownloadOutcome.Fail(DownloadStatus.HttpError, "URL буруу", 0, current);
                if (!string.Equals(current.Scheme, "https", StringComparison.OrdinalIgnoreCase))
                    return DownloadOutcome.Fail(DownloadStatus.InsecureScheme, "Зөвхөн HTTPS зөвшөөрнө: " + current.Scheme, 0, current);
                if (!HostAllowed(current, policy.AllowedHosts))
                    return DownloadOutcome.Fail(DownloadStatus.HostNotAllowed, "Хост цагаан жагсаалтад байхгүй: " + current.Host, 0, current);

                using (var req = new HttpRequestMessage(HttpMethod.Get, current))
                using (HttpResponseMessage res = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false))
                {
                    int code = (int)res.StatusCode;

                    if (code >= 300 && code < 400)
                    {
                        Uri loc = res.Headers.Location;
                        if (loc == null) return DownloadOutcome.Fail(DownloadStatus.HttpError, "Redirect Location-гүй", code, current);
                        if (!loc.IsAbsoluteUri) loc = new Uri(current, loc);
                        if (LooksLikeLoginRedirect(loc))
                            return DownloadOutcome.Fail(DownloadStatus.AuthRequired, "Нэвтрэх хуудас руу redirect: " + loc.Host + loc.AbsolutePath, code, loc);
                        if (!HostAllowed(loc, policy.AllowedHosts))
                            return DownloadOutcome.Fail(DownloadStatus.HostNotAllowed, "Redirect цагаан жагсаалтын гаднах хост руу: " + loc.Host, code, loc);
                        current = loc;
                        continue;
                    }

                    if (code == 401 || code == 403)
                        return DownloadOutcome.Fail(DownloadStatus.AuthRequired, "HTTP " + code + " — нэвтрэлт шаардлагатай", code, current);
                    if (code == 404 || code == 410)
                        return DownloadOutcome.Fail(DownloadStatus.NotFound, "HTTP " + code, code, current);
                    if (code < 200 || code >= 300)
                        return DownloadOutcome.Fail(DownloadStatus.HttpError, "HTTP " + code, code, current);

                    string ctype = res.Content.Headers.ContentType != null ? res.Content.Headers.ContentType.MediaType : null;
                    string ctypeLower = (ctype ?? "").ToLowerInvariant();
                    if (ctypeLower.StartsWith("text/html"))
                    {
                        // 200 + HTML = ихэвчлэн cookie-гүй үеийн нэвтрэх/зөвшөөрлийн хуудас.
                        string head = await ReadHeadAsync(res, 64 * 1024, ct).ConfigureAwait(false);
                        string hl = head.ToLowerInvariant();
                        bool login = hl.Contains("login") || hl.Contains("sign in") || hl.Contains("signin") || hl.Contains("password");
                        return DownloadOutcome.Fail(
                            login ? DownloadStatus.AuthRequired : DownloadStatus.BadContentType,
                            login ? "HTML нэвтрэх хуудас буцаав (файлын оронд)" : "HTML хуудас буцаав (файлын оронд)",
                            code, current);
                    }
                    if (!string.IsNullOrEmpty(ctype) && Array.IndexOf(AllowedContentTypes, ctypeLower) < 0)
                        return DownloadOutcome.Fail(DownloadStatus.BadContentType, "Content-Type зөвшөөрөгдөөгүй: " + ctype, code, current);

                    long? len = res.Content.Headers.ContentLength;
                    if (len.HasValue && len.Value > policy.MaxBytes)
                        return DownloadOutcome.Fail(DownloadStatus.TooLarge, "Хэмжээ " + len.Value + " > " + policy.MaxBytes, code, current);

                    return await StreamToFileAsync(res, destPath, policy, ct, progress, code, ctype, current).ConfigureAwait(false);
                }
            }
            return DownloadOutcome.Fail(DownloadStatus.TooManyRedirects, "Redirect " + policy.MaxRedirects + "-аас олон", 0, current);
        }

        private static async Task<string> ReadHeadAsync(HttpResponseMessage res, int max, CancellationToken ct)
        {
            try
            {
                using (Stream s = await res.Content.ReadAsStreamAsync().ConfigureAwait(false))
                {
                    var buf = new byte[max];
                    int total = 0;
                    while (total < max)
                    {
                        int n = await s.ReadAsync(buf, total, max - total, ct).ConfigureAwait(false);
                        if (n <= 0) break;
                        total += n;
                    }
                    return Encoding.UTF8.GetString(buf, 0, total);
                }
            }
            catch { return ""; }
        }

        private static async Task<DownloadOutcome> StreamToFileAsync(
            HttpResponseMessage res, string destPath, DownloadPolicy policy, CancellationToken ct,
            IProgress<long> progress, int code, string ctype, Uri finalUrl)
        {
            long total = 0;
            string dir = Path.GetDirectoryName(destPath);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            using (SHA256 sha = SHA256.Create())
            using (Stream src = await res.Content.ReadAsStreamAsync().ConfigureAwait(false))
            {
                var dst = new FileStream(destPath, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 16, true);
                try
                {
                    var buf = new byte[1 << 16];
                    while (true)
                    {
                        ct.ThrowIfCancellationRequested();
                        int n = await src.ReadAsync(buf, 0, buf.Length, ct).ConfigureAwait(false);
                        if (n <= 0) break;
                        total += n;
                        if (total > policy.MaxBytes)
                        {
                            dst.Dispose();
                            TryDelete(destPath);
                            return DownloadOutcome.Fail(DownloadStatus.TooLarge, "Хэмжээ " + policy.MaxBytes + "-аас хэтэрсэн", code, finalUrl);
                        }
                        sha.TransformBlock(buf, 0, n, null, 0);
                        await dst.WriteAsync(buf, 0, n, ct).ConfigureAwait(false);
                        if (progress != null) progress.Report(total);
                    }
                    sha.TransformFinalBlock(buf, 0, 0);
                }
                finally
                {
                    dst.Dispose();
                }
                return new DownloadOutcome
                {
                    Status = DownloadStatus.Ok,
                    FilePath = destPath,
                    Bytes = total,
                    Sha256 = Hex(sha.Hash),
                    HttpStatus = code,
                    ContentType = ctype,
                    FinalUrl = finalUrl,
                };
            }
        }

        public static string Hex(byte[] b)
        {
            var sb = new StringBuilder(b.Length * 2);
            foreach (byte x in b) sb.Append(x.ToString("x2"));
            return sb.ToString();
        }

        public static string Sha256OfFile(string path)
        {
            using (SHA256 sha = SHA256.Create())
            using (FileStream fs = File.OpenRead(path))
                return Hex(sha.ComputeHash(fs));
        }

        private static void TryDelete(string p)
        {
            try { if (!string.IsNullOrEmpty(p) && File.Exists(p)) File.Delete(p); } catch { }
        }
    }
}
