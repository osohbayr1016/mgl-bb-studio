using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using RevitMcpAddin.FamilyHub.Core;

namespace RevitMcpAddin.FamilyHub.Providers
{
    /// <summary>
    /// BIMobject — МЕТАДАТА / AUTH_REQUIRED нийлүүлэгч.
    ///
    /// 2026-09-15-нд anonymous HTTP-ээр ХЭМЖСЭН (нэвтрэлт, cookie, токен ОГТ хэрэглээгүй):
    ///
    ///   GET https://www.bimobject.com/en-us/api/v1/config       → 403  Cf-Mitigated: challenge
    ///   GET https://www.bimobject.com/en-us                     → 403  Cf-Mitigated: challenge
    ///   GET https://www.bimobject.com/en-us/{brand}/product/{slug} (3 бүтээгдэхүүн) → 403 challenge
    ///   GET https://www.bimobject.com/en-us/product?searchText=… → 403  Cf-Mitigated: challenge
    ///   GET https://www.bimobject.com/robots.txt                → 200  (Sitemap: Azure blob)
    ///   GET https://stbimobjectportalsitemap.blob.core.windows.net/sitemap/sitemap_index.xml → 200
    ///   GET …/sitemap/sitemap_product_en-us_01.xml              → 200  (зөвхөн URL + lastmod, зураг/нэр байхгүй)
    ///
    /// Өөрөөр хэлбэл хөтөчийн бус клиентэд бүтээгдэхүүний хуудас, хайлт, config
    /// БҮГД Cloudflare-ийн anti-bot challenge-ийн ард.  Тэр challenge-ийг тойрох нь
    /// ХОРИОТОЙ (даалгаврын дүрэм) тул энэ нийлүүлэгч:
    ///   • хайлт хийхгүй (сүлжээ рүү ОГТ хандахгүй),
    ///   • зөвхөн хэрэглэгчийн буулгасан бүтээгдэхүүний URL-аас метадата (brand/slug) гаргана,
    ///   • татах хүсэлт бүрд AUTH_REQUIRED буцаана.
    /// ЯМАР Ч endpoint ТААМАГЛААГҮЙ.  BIMobject өөрөө татахад нэвтрэлт шаарддаг гэж
    /// мэдэгддэг; тэдний албан ёсны зам нь өөрсдийнх нь Revit app (нэвтрэлттэй).
    /// </summary>
    public sealed class BimObjectProvider : IFamilyProvider
    {
        public const string Id = "bimobject";

        public string ProviderId { get { return Id; } }
        public string DisplayName { get { return "BIMobject"; } }

        public ProviderCapabilities Capabilities { get; } = new ProviderCapabilities
        {
            SupportsAnonymousSearch = false,
            SupportsAnonymousPreview = false,
            SupportsAnonymousDownload = false,
            RequiresAuthentication = true,
            SupportsDirectRevitAssets = false,
        };

        /// <summary>Нэг ч татах хост баталгаажаагүй — ХООСОН (SafeDownloader бүгдийг хаана).</summary>
        public IReadOnlyList<string> AllowedDownloadHosts { get; } = new string[0];

        public const string AnonymousNotice =
            "BIMobject: хөтөчийн бус хүсэлт бүр Cloudflare challenge-ээр хаагддаг (403), "
            + "татахад нэвтрэлт шаардлагатай — AUTH_REQUIRED.  Бүтээгдэхүүний URL буулгавал зөвхөн метадата харуулна.";

        // https://www.bimobject.com/{locale}/{brand}/product/{slug}  (sitemap-аас баталгаажсан хэлбэр)
        private static readonly Regex ProductUrl = new Regex(
            @"^https?://(?:www\.)?bimobject\.com/(?<locale>[a-z]{2}(?:-[a-z]{2})?)/(?<brand>[^/?#]+)/product/(?<slug>[^/?#]+)",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

        public static bool TryParseProductUrl(string url, out string locale, out string brand, out string slug)
        {
            locale = brand = slug = null;
            if (string.IsNullOrWhiteSpace(url)) return false;
            Match m = ProductUrl.Match(url.Trim());
            if (!m.Success) return false;
            locale = m.Groups["locale"].Value.ToLowerInvariant();
            brand = m.Groups["brand"].Value;
            slug = m.Groups["slug"].Value;
            return true;
        }

        /// <summary>WebView2 табын эхлэлийн хуудас — хэрэглэгч сайтыг нь ЖИНХЭНЭ хөтчөөр үзнэ.</summary>
        public const string BrowserHomeUrl = "https://www.bimobject.com/en-us";

        /// <summary>
        /// ХӨТЧӨӨР татсан файлын бүтээгдэхүүний бичлэг.  Хэрэглэгч bimobject.com дээр
        /// өөрийн эрхээр нэвтэрч, өөрөө «Download» дарсан — бид зөвхөн файлын очих
        /// газрыг түр хавтас руу чиглүүлж, дараа нь pipeline-ээр шалгаж ачаална.
        /// Танигч: <c>bimobject:{brand}/{slug}:{fileName}</c>; product URL байхгүй бол
        /// (татах товч өөр хуудсанд байсан) <c>bimobject:url:{download host+path}</c>.
        /// </summary>
        public static FamilyProduct ProductFromBrowserDownload(string pageUrl, string downloadUrl, string fileName)
        {
            string locale, brand, slug;
            string safeName = fileName ?? "";
            if (TryParseProductUrl(pageUrl, out locale, out brand, out slug))
            {
                FamilyProduct p = Describe(locale, brand, slug);
                p.ExternalAssetId = safeName;
                p.DownloadCapability = DownloadCapability.AnonymousDirect; // хөтөч аль хэдийн татсан
                p.Formats.Add(System.IO.Path.GetExtension(safeName).TrimStart('.').ToLowerInvariant());
                return p;
            }
            Uri u;
            string key = Uri.TryCreate(downloadUrl ?? "", UriKind.Absolute, out u) ? u.Host + u.AbsolutePath : safeName;
            return new FamilyProduct
            {
                ProviderId = Id,
                ExternalId = "url:" + key,
                ExternalAssetId = safeName,
                Name = System.IO.Path.GetFileNameWithoutExtension(safeName),
                Manufacturer = "BIMobject",
                ProductUrl = pageUrl,
                DownloadCapability = DownloadCapability.AnonymousDirect,
            };
        }

        public Task<SearchResult> SearchAsync(FamilySearchQuery query, CancellationToken cancellationToken)
        {
            var r = new SearchResult { Notice = AnonymousNotice };
            string locale, brand, slug;
            if (query != null && TryParseProductUrl(query.Text, out locale, out brand, out slug))
                r.Items.Add(Describe(locale, brand, slug));
            return Task.FromResult(r);
        }

        public Task<FamilyProduct> GetProductAsync(string externalId, CancellationToken cancellationToken)
        {
            // externalId = "{brand}/{slug}"
            if (string.IsNullOrEmpty(externalId)) return Task.FromResult<FamilyProduct>(null);
            int i = externalId.IndexOf('/');
            if (i <= 0 || i == externalId.Length - 1) return Task.FromResult<FamilyProduct>(null);
            return Task.FromResult(Describe("en-us", externalId.Substring(0, i), externalId.Substring(i + 1)));
        }

        public Task<FamilyDownloadResult> ResolveDownloadAsync(FamilyProduct product, CancellationToken cancellationToken)
        {
            return Task.FromResult(FamilyDownloadResult.AuthRequired(
                "BIMobject татахад нэвтрэлт шаарддаг; anonymous зам байхгүй (403 challenge). Тойрохгүй."));
        }

        private static FamilyProduct Describe(string locale, string brand, string slug)
        {
            return new FamilyProduct
            {
                ProviderId = Id,
                ExternalId = brand + "/" + slug,
                ExternalAssetId = null,
                AssetVersion = null,
                Name = Humanize(slug),
                Manufacturer = Humanize(brand),
                Category = null,
                ProductUrl = "https://www.bimobject.com/" + locale + "/" + brand + "/product/" + slug,
                ThumbnailUrl = null, // баталгаажсан нийтийн thumbnail хост байхгүй — таамаглахгүй
                DownloadCapability = DownloadCapability.AuthRequired,
            };
        }

        private static string Humanize(string slug)
        {
            if (string.IsNullOrEmpty(slug)) return slug;
            string s = Uri.UnescapeDataString(slug).Replace('-', ' ').Replace('_', ' ').Trim();
            return s.Length > 0 ? char.ToUpperInvariant(s[0]) + s.Substring(1) : s;
        }
    }
}
