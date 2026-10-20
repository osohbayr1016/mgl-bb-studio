using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace RevitMcpAddin.FamilyHub.Core
{
    /// <summary>
    /// Нийлүүлэгчийн абстракц.  BIMobject нь апп даяар ХАТУУ бичигдээгүй —
    /// UI, pipeline, бүртгэл бүгд зөвхөн энэ интерфейсийг мэднэ.
    /// </summary>
    public interface IFamilyProvider
    {
        string ProviderId { get; }
        string DisplayName { get; }
        ProviderCapabilities Capabilities { get; }

        /// <summary>
        /// Энэ нийлүүлэгчээс татахыг ЗӨВШӨӨРСӨН хостууд (яг тэнцүү, эсвэл
        /// <c>*.example.com</c> хэлбэрийн дэд домэйн).  Redirect ч үүнд захирагдана.
        /// </summary>
        IReadOnlyList<string> AllowedDownloadHosts { get; }

        Task<SearchResult> SearchAsync(FamilySearchQuery query, CancellationToken cancellationToken);

        Task<FamilyProduct> GetProductAsync(string externalId, CancellationToken cancellationToken);

        Task<FamilyDownloadResult> ResolveDownloadAsync(FamilyProduct product, CancellationToken cancellationToken);
    }

    /// <summary>Бүртгэгдсэн нийлүүлэгчид — дараалал нь UI-д харагдах дараалал.</summary>
    public sealed class FamilyProviderRegistry
    {
        private readonly List<IFamilyProvider> _providers = new List<IFamilyProvider>();

        public IReadOnlyList<IFamilyProvider> Providers { get { return _providers; } }

        public FamilyProviderRegistry Add(IFamilyProvider provider)
        {
            if (provider == null) throw new ArgumentNullException("provider");
            foreach (IFamilyProvider p in _providers)
                if (string.Equals(p.ProviderId, provider.ProviderId, StringComparison.Ordinal))
                    throw new InvalidOperationException("Provider давхардсан: " + provider.ProviderId);
            _providers.Add(provider);
            return this;
        }

        public IFamilyProvider Get(string providerId)
        {
            foreach (IFamilyProvider p in _providers)
                if (string.Equals(p.ProviderId, providerId, StringComparison.Ordinal)) return p;
            return null;
        }
    }
}
