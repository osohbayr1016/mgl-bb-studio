using System;
using System.Collections.Generic;

namespace RevitMcpAddin.FamilyHub.Core
{
    /// <summary>
    /// FAMILY HUB — POC.  Энэ хавтас (`Core/`) нь `Autodesk.Revit`-ийн ямар ч
    /// төрөл дурддаггүй: `tests/FamilyHub.Tests` нь эдгээр файлыг ШУУД эмхэтгэдэг
    /// (Intelligence/Core-ийн ижил дүрэм, §63).
    /// </summary>
    public enum DownloadCapability
    {
        /// <summary>Нэвтрэлтгүй, шууд татагдана.</summary>
        AnonymousDirect,
        /// <summary>Нийлүүлэгч нэвтрэлт шаарддаг — ТОЙРОХГҮЙ.</summary>
        AuthRequired,
        /// <summary>Мэдээлэл л бий, файл татах зам байхгүй.</summary>
        MetadataOnly,
        Unknown,
    }

    public enum RevitCompatibility
    {
        Compatible,
        LikelyCompatible,
        Unknown,
        Incompatible,
    }

    public sealed class ProviderCapabilities
    {
        public bool SupportsAnonymousSearch { get; set; }
        public bool SupportsAnonymousPreview { get; set; }
        public bool SupportsAnonymousDownload { get; set; }
        public bool RequiresAuthentication { get; set; }
        public bool SupportsDirectRevitAssets { get; set; }
    }

    /// <summary>
    /// Зөвхөн МЕТАДАТА — нийлүүлэгчийн RFA санг ХЭЗЭЭ Ч хуулбарлахгүй.
    /// </summary>
    public sealed class FamilyProduct
    {
        public string ProviderId { get; set; }
        /// <summary>Нийлүүлэгчийн доторх тогтвортой танигч (URL slug, repo path г.м.).</summary>
        public string ExternalId { get; set; }
        /// <summary>Файл/хувилбарын танигч (blob sha, asset id).  Байхгүй бол null.</summary>
        public string ExternalAssetId { get; set; }
        /// <summary>Хувилбарын шошго (commit, release tag).  Байхгүй бол null.</summary>
        public string AssetVersion { get; set; }
        public string Name { get; set; }
        public string Manufacturer { get; set; }
        public string Category { get; set; }
        public string Subcategory { get; set; }
        public string ProductUrl { get; set; }
        public string ThumbnailUrl { get; set; }
        public List<string> Formats { get; set; } = new List<string>();
        /// <summary>Нийлүүлэгчийн МЭДЭЭЛСЭН Revit хувилбарууд (ж: "2018").  Хоосон = мэдэгдэхгүй.</summary>
        public List<string> RevitVersions { get; set; } = new List<string>();
        public DownloadCapability DownloadCapability { get; set; } = DownloadCapability.Unknown;
        /// <summary>Файлын хэмжээ (байт), мэдэгдэж байвал.</summary>
        public long? SizeBytes { get; set; }

        /// <summary>
        /// Нийлүүлэгчийн танигч — давхардлын шалгалтын А түлхүүр:
        /// <c>providerId:externalId:externalAssetId</c>.
        /// </summary>
        public string ProviderIdentity
        {
            get { return FamilyIdentity.Provider(ProviderId, ExternalId, ExternalAssetId); }
        }
    }

    public sealed class FamilySearchQuery
    {
        public string Text { get; set; }
        public int Limit { get; set; } = 50;
    }

    public sealed class SearchResult
    {
        public List<FamilyProduct> Items { get; set; } = new List<FamilyProduct>();
        /// <summary>Хэрэглэгчид харуулах тайлбар (ж: «нийлүүлэгч нэвтрэлт шаарддаг»).</summary>
        public string Notice { get; set; }
        public bool Truncated { get; set; }
    }

    /// <summary>`ResolveDownloadAsync`-ийн үр дүн — URL л, файл биш.</summary>
    public sealed class FamilyDownloadResult
    {
        public DownloadCapability Capability { get; set; }
        /// <summary>Шууд файлын HTTPS URL (Capability == AnonymousDirect үед).</summary>
        public Uri Url { get; set; }
        /// <summary>Хүлээгдэж буй файлын нэр (өргөтгөлтэй).</summary>
        public string FileName { get; set; }
        public long? ExpectedSizeBytes { get; set; }
        public string Reason { get; set; }

        public static FamilyDownloadResult AuthRequired(string reason)
        {
            return new FamilyDownloadResult { Capability = DownloadCapability.AuthRequired, Reason = reason };
        }

        public static FamilyDownloadResult MetadataOnly(string reason)
        {
            return new FamilyDownloadResult { Capability = DownloadCapability.MetadataOnly, Reason = reason };
        }
    }

    public static class FamilyIdentity
    {
        public static string Provider(string providerId, string externalId, string externalAssetId)
        {
            return (providerId ?? "") + ":" + (externalId ?? "") + ":" + (externalAssetId ?? "");
        }
    }

    /// <summary>
    /// Төслийн бүртгэлийн нэг мөр (ExtensibleStorage-д JSON-оор хадгалагдана).
    /// </summary>
    public sealed class FamilyHubRegistryEntry
    {
        public string ProviderId { get; set; }
        public string ExternalProductId { get; set; }
        public string ExternalAssetId { get; set; }
        public string AssetVersion { get; set; }
        public string Sha256 { get; set; }
        /// <summary>`ElementId` — `long` (Revit 2024+ `ElementId.Value`).</summary>
        public long RevitFamilyId { get; set; }
        public string RevitFamilyName { get; set; }
        public List<long> RevitSymbolIds { get; set; } = new List<long>();
        /// <summary>ISO-8601 UTC.</summary>
        public string LoadedAt { get; set; }
        /// <summary>
        /// Энэ мөр өөр нийлүүлэгчийн мөрийг ИЖИЛ файл (SHA-256) учир одоо байгаа
        /// family руу ЗААСАН эсэх — хоёр дахь хуулбар ачаалаагүй гэдгийн ул мөр.
        /// </summary>
        public bool MappedByHash { get; set; }

        public string ProviderIdentity
        {
            get { return FamilyIdentity.Provider(ProviderId, ExternalProductId, ExternalAssetId); }
        }
    }
}
