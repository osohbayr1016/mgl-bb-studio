using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using RevitMcpAddin.FamilyHub.Core;
using RevitMcpAddin.FamilyHub.Providers;

namespace RevitMcpAddin.FamilyHub.Tests
{
    public static class UnitTests
    {
        [Test] public static void HostAllowlist_ExactAndWildcard()
        {
            var allowed = new[] { "raw.githubusercontent.com", "*.cdn.example.test" };
            Assert.True(SafeDownloader.HostAllowed(new Uri("https://raw.githubusercontent.com/a/b"), allowed));
            Assert.True(SafeDownloader.HostAllowed(new Uri("https://RAW.githubusercontent.com/a"), allowed));
            Assert.False(SafeDownloader.HostAllowed(new Uri("https://raw.githubusercontent.com.evil.org/a"), allowed));
            Assert.True(SafeDownloader.HostAllowed(new Uri("https://eu.cdn.example.test/x"), allowed));
            Assert.False(SafeDownloader.HostAllowed(new Uri("https://cdn.example.test/x"), allowed), "bare apex not covered by *.");
            Assert.False(SafeDownloader.HostAllowed(new Uri("https://github.com/x"), allowed));
            Assert.False(SafeDownloader.HostAllowed(new Uri("https://x.test/"), new string[0]), "empty allowlist blocks all (BIMobject)");
        }

        [Test] public static void LoginRedirectHeuristic()
        {
            Assert.True(SafeDownloader.LooksLikeLoginRedirect(new Uri("https://x.test/account/login?returnUrl=%2Ff")));
            Assert.True(SafeDownloader.LooksLikeLoginRedirect(new Uri("https://x.test/Identity/Account/Login")));
            Assert.True(SafeDownloader.LooksLikeLoginRedirect(new Uri("https://x.test/download?redirect_uri=abc")));
            Assert.False(SafeDownloader.LooksLikeLoginRedirect(new Uri("https://x.test/files/Chair.rfa")));
        }

        [Test] public static void SafeFileName_StripsPathsAndReserved()
        {
            Assert.Eq("Chair.rfa", TempFiles.SafeFileName("..\\..\\Chair.rfa"));
            Assert.Eq("Chair.rfa", TempFiles.SafeFileName("/etc/Chair.rfa"));
            Assert.Eq("LE Chair.rfa", TempFiles.SafeFileName("LE Chair.rfa"), "spaces kept — family name = file stem");
            Assert.Eq("a_b.rfa", TempFiles.SafeFileName("a:b.rfa"));
            Assert.Eq("_CON.rfa", TempFiles.SafeFileName("CON.rfa"));
            Assert.Eq("family.rfa", TempFiles.SafeFileName("..."));
            Assert.Eq("family.rfa", TempFiles.SafeFileName(""));
        }

        [Test] public static void ZipTraversalDetector()
        {
            Assert.True(FamilyPackageInspector.IsTraversal("../x.rfa"));
            Assert.True(FamilyPackageInspector.IsTraversal("a/../../x.rfa"));
            Assert.True(FamilyPackageInspector.IsTraversal("/abs/x.rfa"));
            Assert.True(FamilyPackageInspector.IsTraversal("C:/x.rfa"));
            Assert.True(FamilyPackageInspector.IsTraversal("..\\x.rfa"));
            Assert.False(FamilyPackageInspector.IsTraversal("furniture/x.rfa"));
            Assert.False(FamilyPackageInspector.IsTraversal("x.rfa"));
        }

        [Test] public static void SavedRevitVersion_FromFakeAndRealLayouts()
        {
            string dir = TestEnv.TempRoot();
            string a = Path.Combine(dir, "a.rfa"); File.WriteAllBytes(a, FakeRfa.Make(2018));
            string b = Path.Combine(dir, "b.rfa"); File.WriteAllBytes(b, FakeRfa.Make(2024, withFormatLine: true));
            string line;
            Assert.Eq(2018, FamilyPackageInspector.ReadSavedRevitVersion(a, out line) ?? 0);
            Assert.Contains(line, "Autodesk Revit 2018");
            Assert.Eq(2024, FamilyPackageInspector.ReadSavedRevitVersion(b, out line) ?? 0);
            // Байт нэгээр шилжсэн (сондгой offset) — хоёр дахь оролдлого олно.
            byte[] shifted = new byte[1 + FakeRfa.Make(2019).Length];
            Array.Copy(FakeRfa.Make(2019), 0, shifted, 1, shifted.Length - 1);
            string c = Path.Combine(dir, "c.rfa"); File.WriteAllBytes(c, shifted);
            Assert.Eq(2019, FamilyPackageInspector.ReadSavedRevitVersion(c, out line) ?? 0);
            Directory.Delete(dir, true);
        }

        [Test] public static void Compatibility_Matrix()
        {
            Assert.Eq(RevitCompatibility.Compatible, RevitCompatibilityCheck.FromSavedVersion(2027, 2027));
            Assert.Eq(RevitCompatibility.LikelyCompatible, RevitCompatibilityCheck.FromSavedVersion(2018, 2027));
            Assert.Eq(RevitCompatibility.Incompatible, RevitCompatibilityCheck.FromSavedVersion(2028, 2027));
            Assert.Eq(RevitCompatibility.Unknown, RevitCompatibilityCheck.FromSavedVersion(null, 2027));
            Assert.Eq(RevitCompatibility.Unknown, RevitCompatibilityCheck.FromSavedVersion(2018, 0));
            Assert.Eq(RevitCompatibility.Unknown, RevitCompatibilityCheck.FromProviderMetadata(new List<string>(), 2027));
            Assert.Eq(RevitCompatibility.Compatible, RevitCompatibilityCheck.FromProviderMetadata(new List<string> { "Revit 2027" }, 2027));
            Assert.Eq(RevitCompatibility.LikelyCompatible, RevitCompatibilityCheck.FromProviderMetadata(new List<string> { "2020", "2029" }, 2027));
            Assert.Eq(RevitCompatibility.Incompatible, RevitCompatibilityCheck.FromProviderMetadata(new List<string> { "2029" }, 2027));
            Assert.Eq(RevitCompatibility.Unknown, RevitCompatibilityCheck.FromProviderMetadata(new List<string> { "latest" }, 2027));
        }

        [Test] public static void Registry_JsonRoundTrip_AndLookups()
        {
            var reg = new FamilyHubRegistry();
            reg.Upsert(new FamilyHubRegistryEntry { ProviderId = "github", ExternalProductId = "o/r@main:LE Chair.rfa", ExternalAssetId = "sha1", AssetVersion = "main", Sha256 = "AB", RevitFamilyId = 42, RevitFamilyName = "LE Chair", RevitSymbolIds = new List<long> { 43 }, LoadedAt = "2026-09-15T00:00:00Z" });
            reg.Upsert(new FamilyHubRegistryEntry { ProviderId = "github", ExternalProductId = "o/r@main:LE Chair.rfa", ExternalAssetId = "sha1", Sha256 = "ab", RevitFamilyId = 42, RevitFamilyName = "LE Chair" });
            Assert.Eq(1, reg.Entries.Count, "upsert on identity");
            FamilyHubRegistry back = FamilyHubRegistry.FromJson(reg.ToJson());
            Assert.Eq(1, back.Entries.Count);
            Assert.NotNull(back.FindByProviderIdentity("github:o/r@main:LE Chair.rfa:sha1"));
            Assert.NotNull(back.FindBySha256("AB"), "hash lookup case-insensitive");
            Assert.NotNull(back.FindByFamilyName("LE Chair"));
            Assert.Eq(42L, back.FindByFamilyId(42)[0].RevitFamilyId);
            Assert.Eq(0, FamilyHubRegistry.FromJson("{not json").Entries.Count, "corrupt json → empty, never throws");
            Assert.Eq(0, FamilyHubRegistry.FromJson(null).Entries.Count);
        }

        [Test] public static void EntriesForProduct_MatchesZipChildren()
        {
            var reg = new FamilyHubRegistry();
            reg.Upsert(new FamilyHubRegistryEntry { ProviderId = "p", ExternalProductId = "x", ExternalAssetId = "a#one.rfa", RevitFamilyId = 1 });
            reg.Upsert(new FamilyHubRegistryEntry { ProviderId = "p", ExternalProductId = "x", ExternalAssetId = "a#two.rfa", RevitFamilyId = 2 });
            reg.Upsert(new FamilyHubRegistryEntry { ProviderId = "p", ExternalProductId = "x", ExternalAssetId = "ab", RevitFamilyId = 3 });
            var prod = new FamilyProduct { ProviderId = "p", ExternalId = "x", ExternalAssetId = "a" };
            Assert.Eq(2, FamilyHubPipeline.EntriesForProduct(reg, prod).Count, "'ab' must not match 'a'");
        }

        [Test] public static void BimObject_ProductUrlParse_AndAuthRequired()
        {
            string locale, brand, slug;
            Assert.True(BimObjectProvider.TryParseProductUrl("https://www.bimobject.com/en-us/aereco-de/product/abi", out locale, out brand, out slug));
            Assert.Eq("en-us", locale); Assert.Eq("aereco-de", brand); Assert.Eq("abi", slug);
            Assert.True(BimObjectProvider.TryParseProductUrl("https://bimobject.com/de/cariboni/product/chara_ceiling-recessed?x=1", out locale, out brand, out slug));
            Assert.False(BimObjectProvider.TryParseProductUrl("https://www.bimobject.com/en-us/product?searchText=chair", out locale, out brand, out slug));
            Assert.False(BimObjectProvider.TryParseProductUrl("https://evil.org/en-us/a/product/b", out locale, out brand, out slug));

            var p = new BimObjectProvider();
            Assert.True(p.Capabilities.RequiresAuthentication);
            Assert.False(p.Capabilities.SupportsAnonymousDownload);
            Assert.Eq(0, p.AllowedDownloadHosts.Count, "no verified download host → nothing may be fetched");
            SearchResult s = p.SearchAsync(new FamilySearchQuery { Text = "office chair" }, CancellationToken.None).Result;
            Assert.Eq(0, s.Items.Count);
            Assert.Contains(s.Notice, "AUTH_REQUIRED");
            SearchResult byUrl = p.SearchAsync(new FamilySearchQuery { Text = "https://www.bimobject.com/en-us/aereco-de/product/abi" }, CancellationToken.None).Result;
            Assert.Eq(1, byUrl.Items.Count);
            Assert.Eq(DownloadCapability.AuthRequired, byUrl.Items[0].DownloadCapability);
            Assert.Null(byUrl.Items[0].ThumbnailUrl, "never invent a thumbnail host");
            FamilyDownloadResult d = p.ResolveDownloadAsync(byUrl.Items[0], CancellationToken.None).Result;
            Assert.Eq(DownloadCapability.AuthRequired, d.Capability);
            Assert.Null(d.Url);
        }

        [Test] public static async Task GitHub_TreeParse_Search_And_DownloadUrl_ViaStub()
        {
            string tree = "{\"sha\":\"aa48\",\"tree\":[" +
                "{\"path\":\"README.md\",\"type\":\"blob\",\"sha\":\"r1\",\"size\":10}," +
                "{\"path\":\"LE Chair.rfa\",\"type\":\"blob\",\"sha\":\"f4d79edd\",\"size\":307200}," +
                "{\"path\":\"sub/LE Desk.rfa\",\"type\":\"blob\",\"sha\":\"d1\",\"size\":393216}," +
                "{\"path\":\"sub\",\"type\":\"tree\",\"sha\":\"t1\"}],\"truncated\":false}";
            var http = new StubHttpHandler();
            http.Status("https://api.github.com/repos/StudioLE/RevitFamilies/git/trees/main?recursive=1", System.Net.HttpStatusCode.OK, tree, "application/json");
            var src = new GitHubRfaSource { Owner = "StudioLE", Repo = "RevitFamilies", Ref = "main", Label = "StudioLE" };
            var prov = new GitHubPublicRfaProvider(new[] { src }, http, TimeSpan.FromMinutes(5), null);

            SearchResult all = await prov.SearchAsync(new FamilySearchQuery(), CancellationToken.None);
            Assert.Eq(2, all.Items.Count, "only .rfa blobs");
            SearchResult chair = await prov.SearchAsync(new FamilySearchQuery { Text = "chair" }, CancellationToken.None);
            Assert.Eq(1, chair.Items.Count);
            FamilyProduct p = chair.Items[0];
            Assert.Eq("github", p.ProviderId);
            Assert.Eq("StudioLE/RevitFamilies@main:LE Chair.rfa", p.ExternalId);
            Assert.Eq("f4d79edd", p.ExternalAssetId);
            Assert.Eq("LE Chair", p.Name);
            Assert.Eq(DownloadCapability.AnonymousDirect, p.DownloadCapability);
            Assert.Eq(0, p.RevitVersions.Count, "GitHub exposes no Revit version → UNKNOWN before download");

            FamilyDownloadResult d = await prov.ResolveDownloadAsync(p, CancellationToken.None);
            Assert.Eq("https://raw.githubusercontent.com/StudioLE/RevitFamilies/main/LE%20Chair.rfa", d.Url.AbsoluteUri);
            Assert.Eq("LE Chair.rfa", d.FileName);
            Assert.True(SafeDownloader.HostAllowed(d.Url, prov.AllowedDownloadHosts));

            await prov.SearchAsync(new FamilySearchQuery { Text = "desk" }, CancellationToken.None);
            Assert.Eq(1, http.Requests.Count, "tree cached — anonymous rate limit is 60/h");

            FamilyProduct byId = await prov.GetProductAsync("StudioLE/RevitFamilies@main:sub/LE Desk.rfa", CancellationToken.None);
            Assert.NotNull(byId);
            Assert.Eq("sub", byId.Category);
            Assert.Null(await prov.GetProductAsync("Other/Repo@main:x.rfa", CancellationToken.None), "non-allowlisted repo refused");
            FamilyDownloadResult foreign = await prov.ResolveDownloadAsync(new FamilyProduct { ProviderId = "github", ExternalId = "Other/Repo@main:x.rfa" }, CancellationToken.None);
            Assert.Eq(DownloadCapability.MetadataOnly, foreign.Capability);
        }

        [Test] public static void GitHub_SourceSpecParse()
        {
            GitHubRfaSource s = GitHubRfaSource.Parse("StudioLE/RevitFamilies@aa48e31d");
            Assert.Eq("StudioLE", s.Owner); Assert.Eq("RevitFamilies", s.Repo); Assert.Eq("aa48e31d", s.Ref);
            Assert.Eq("main", GitHubRfaSource.Parse("a/b").Ref);
            Assert.Null(GitHubRfaSource.Parse("nonsense"));
            Assert.Null(GitHubRfaSource.Parse("a/b/c"));
        }

        [Test] public static void ProviderRegistry_RejectsDuplicateIds()
        {
            var reg = new FamilyProviderRegistry().Add(new BimObjectProvider());
            bool threw = false;
            try { reg.Add(new BimObjectProvider()); } catch (InvalidOperationException) { threw = true; }
            Assert.True(threw);
            Assert.NotNull(reg.Get("bimobject"));
            Assert.Null(reg.Get("nope"));
        }
    }
}
