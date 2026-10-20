using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using RevitMcpAddin.FamilyHub.Core;
using RevitMcpAddin.FamilyHub.Providers;

namespace RevitMcpAddin.FamilyHub.Tests
{
    /// <summary>WebView2-ээр (хөтчөөр) татсан файлын зам — `AddDownloadedAsync` + хувилбарын сонголт.</summary>
    public static class BrowserDownloadTests
    {
        private static string Drop(string root, string name, byte[] body)
        {
            string dir = TempFiles.NewSessionDir(root);
            string p = Path.Combine(dir, name);
            File.WriteAllBytes(p, body);
            return p;
        }

        private static FamilyProduct Bim(string file)
        {
            return BimObjectProvider.ProductFromBrowserDownload(
                "https://www.bimobject.com/en-us/acme/product/office-chair-x1", "https://cdn.example.test/dl/" + file, file);
        }

        [Test] public static void BrowserProduct_Identity_FromProductPage_AndFallback()
        {
            FamilyProduct p = Bim("office-chair-x1.zip");
            Assert.Eq("bimobject", p.ProviderId);
            Assert.Eq("acme/office-chair-x1", p.ExternalId);
            Assert.Eq("office-chair-x1.zip", p.ExternalAssetId);
            Assert.Eq("bimobject:acme/office-chair-x1:office-chair-x1.zip", p.ProviderIdentity);
            Assert.Eq(DownloadCapability.AnonymousDirect, p.DownloadCapability);
            Assert.Eq("Acme", p.Manufacturer);

            FamilyProduct q = BimObjectProvider.ProductFromBrowserDownload("https://www.bimobject.com/en-us/account/downloads", "https://files.example.test/x/Chair.rfa", "Chair.rfa");
            Assert.Eq("url:files.example.test/x/Chair.rfa", q.ExternalId);
            Assert.Eq("Chair", q.Name);
        }

        [Test] public static async Task Downloaded_Rfa_Loaded_AndTempCleaned()
        {
            var revit = new FakeRevit();
            var pipe = new FamilyHubPipeline(revit, new SafeDownloader(new StubHttpHandler()), new ScriptedResolver(), new PipelineOptions());
            string root = TestEnv.TempRoot();
            string path = Drop(root, "Office Chair.rfa", FakeRfa.Make(2022, "oc"));
            string dir = Path.GetDirectoryName(path);

            PipelineResult r = await pipe.AddDownloadedAsync(Bim("Office Chair.rfa"), path, null, CancellationToken.None);

            Assert.Eq(PipelineStatus.Ok, r.Status, r.Message);
            Assert.Eq(FileOutcomeStatus.Loaded, r.Files[0].Status);
            Assert.Eq("Office Chair", r.Files[0].FamilyName);
            Assert.Eq(2022, r.Files[0].SavedRevitVersion ?? 0);
            Assert.False(Directory.Exists(dir), "browser session dir deleted");
            Assert.True(r.TempCleaned);
            Assert.NotNull(r.Download);
            Assert.Eq(r.Files[0].Sha256, r.Download.Sha256);
            FamilyHubRegistry reg = FamilyHubRegistry.FromJson(revit.RegistryJson);
            Assert.Eq("bimobject:acme/office-chair-x1:Office Chair.rfa", reg.Entries[0].ProviderIdentity);
        }

        [Test] public static async Task Downloaded_SameProductAgain_AlreadyInProject_NoLoad()
        {
            var revit = new FakeRevit();
            var pipe = new FamilyHubPipeline(revit, new SafeDownloader(new StubHttpHandler()), new ScriptedResolver(), new PipelineOptions());
            string root = TestEnv.TempRoot();
            await pipe.AddDownloadedAsync(Bim("Chair.rfa"), Drop(root, "Chair.rfa", FakeRfa.Make(2022, "c")), null, CancellationToken.None);
            string second = Drop(root, "Chair.rfa", FakeRfa.Make(2022, "c"));

            PipelineResult r = await pipe.AddDownloadedAsync(Bim("Chair.rfa"), second, null, CancellationToken.None);

            Assert.Eq(PipelineStatus.AlreadyInProject, r.Status, r.Message);
            Assert.Eq(1, revit.LoadCalls);
            Assert.False(File.Exists(second), "second download removed");
        }

        [Test] public static async Task Downloaded_Zip_WithVersionVariants_LoadsBestOnly()
        {
            var revit = new FakeRevit { RevitVersion = 2027 };
            var pipe = new FamilyHubPipeline(revit, new SafeDownloader(new StubHttpHandler()), new ScriptedResolver(), new PipelineOptions());
            string root = TestEnv.TempRoot();
            byte[] zip = FakeRfa.Zip(
                FakeRfa.Entry("Acme Chair_2020.rfa", FakeRfa.Make(2020, "a")),
                FakeRfa.Entry("Acme Chair_2023.rfa", FakeRfa.Make(2023, "b")),
                FakeRfa.Entry("Acme Chair_2028.rfa", FakeRfa.Make(2028, "c")),
                FakeRfa.Entry("Acme Chair Spec.pdf", new byte[] { 0x25, 0x50, 0x44, 0x46 }),
                FakeRfa.Entry("Acme Table.rfa", FakeRfa.Make(2019, "t")));
            string path = Drop(root, "acme-chair.zip", zip);

            PipelineResult r = await pipe.AddDownloadedAsync(Bim("acme-chair.zip"), path, null, CancellationToken.None);

            Assert.Eq(PipelineStatus.Ok, r.Status, r.Message);
            Assert.Eq(5 - 1, r.Files.Count, "pdf ignored; 4 rfa outcomes");
            var byName = new Dictionary<string, FileOutcome>();
            foreach (FileOutcome f in r.Files) byName[f.FamilyName] = f;
            Assert.Eq(FileOutcomeStatus.SkippedVariant, byName["Acme Chair_2020"].Status);
            Assert.Eq(FileOutcomeStatus.Loaded, byName["Acme Chair_2023"].Status, "newest <= current wins");
            Assert.Eq(FileOutcomeStatus.Incompatible, byName["Acme Chair_2028"].Status, "future version reported, not silently skipped");
            Assert.Eq(FileOutcomeStatus.Loaded, byName["Acme Table"].Status, "a different family is not a variant");
            Assert.Eq(2, revit.LoadCalls);
        }

        [Test] public static void VariantSelection_Rules()
        {
            Assert.Eq("Acme Chair", FamilyHubPipeline.NormalizeVariantName("Acme Chair_2022"));
            Assert.Eq("Acme Chair", FamilyHubPipeline.NormalizeVariantName("Acme Chair (2022)"));
            Assert.Eq("Acme Chair", FamilyHubPipeline.NormalizeVariantName("Acme Chair R2022"));
            Assert.Eq("Acme Chair", FamilyHubPipeline.NormalizeVariantName("Acme Chair-Revit 2022"));
            Assert.Eq("Acme Chair", FamilyHubPipeline.NormalizeVariantName("Acme Chair"));

            // Ижил нэр, хувилбарын тэмдэггүй, хадгалсан хувилбар өөр — ГЭСЭН Ч нэг л group;
            // хамгийн шинэ нь ачаалагдаж, хуучин нь алгасагдана (ижил family мөн).
            var files = new List<InspectedFamilyFile>
            {
                new InspectedFamilyFile { FamilyName = "Sofa", SavedRevitVersion = 2020 },
                new InspectedFamilyFile { FamilyName = "Sofa", SavedRevitVersion = 2024 },
                new InspectedFamilyFile { FamilyName = "Lamp", SavedRevitVersion = 2018 },
            };
            HashSet<InspectedFamilyFile> skip = FamilyHubPipeline.SelectVersionVariants(files, 2027);
            Assert.Eq(1, skip.Count);
            Assert.True(skip.Contains(files[0]));

            // Хувилбар мэдэгдэхгүй, нэр ялгаатай → юу ч алгасахгүй.
            var distinct = new List<InspectedFamilyFile>
            {
                new InspectedFamilyFile { FamilyName = "Door A" },
                new InspectedFamilyFile { FamilyName = "Door B" },
            };
            Assert.Eq(0, FamilyHubPipeline.SelectVersionVariants(distinct, 2027).Count);
            Assert.Eq(0, FamilyHubPipeline.SelectVersionVariants(new List<InspectedFamilyFile> { files[0] }, 2027).Count);
        }

        [Test] public static async Task Downloaded_WrongExtension_OrMissing_Rejected()
        {
            var revit = new FakeRevit();
            var pipe = new FamilyHubPipeline(revit, new SafeDownloader(new StubHttpHandler()), new ScriptedResolver(), new PipelineOptions());
            string root = TestEnv.TempRoot();
            string dwg = Drop(root, "chair.dwg", new byte[] { 1, 2, 3 });
            PipelineResult a = await pipe.AddDownloadedAsync(Bim("chair.dwg"), dwg, null, CancellationToken.None);
            Assert.Eq(PipelineStatus.InvalidPackage, a.Status, a.Message);
            Assert.False(File.Exists(dwg), "rejected file removed");

            PipelineResult b = await pipe.AddDownloadedAsync(Bim("x.rfa"), Path.Combine(root, "nope", "x.rfa"), null, CancellationToken.None);
            Assert.Eq(PipelineStatus.DownloadFailed, b.Status);

            string exe = Drop(root, "trojan.rfa", System.Text.Encoding.ASCII.GetBytes("MZ......this is a PE, not OLE......................"));
            PipelineResult c = await pipe.AddDownloadedAsync(Bim("trojan.rfa"), exe, null, CancellationToken.None);
            Assert.Eq(PipelineStatus.InvalidPackage, c.Status, c.Message);
            Assert.Eq(0, revit.LoadCalls);
        }

        [Test] public static async Task Downloaded_Oversize_Rejected()
        {
            var revit = new FakeRevit();
            var pipe = new FamilyHubPipeline(revit, new SafeDownloader(new StubHttpHandler()), new ScriptedResolver(), new PipelineOptions { MaxBytes = 2048 });
            string big = Drop(TestEnv.TempRoot(), "big.rfa", FakeRfa.Make(2022, "b", pad: 8000));
            PipelineResult r = await pipe.AddDownloadedAsync(Bim("big.rfa"), big, null, CancellationToken.None);
            Assert.Eq(PipelineStatus.DownloadFailed, r.Status, r.Message);
            Assert.False(File.Exists(big));
        }

        [Test] public static void ProductPageProbe_MatchesAnyAssetOfProduct()
        {
            var reg = new FamilyHubRegistry();
            reg.Upsert(new FamilyHubRegistryEntry { ProviderId = "bimobject", ExternalProductId = "acme/office-chair-x1", ExternalAssetId = "office-chair-x1.zip#Chair_2023.rfa", RevitFamilyId = 5 });
            var probe = new FamilyProduct { ProviderId = "bimobject", ExternalId = "acme/office-chair-x1" };
            Assert.Eq(1, FamilyHubPipeline.EntriesForProduct(reg, probe).Count, "page banner: asset-less probe matches all assets of the product");
            var other = new FamilyProduct { ProviderId = "bimobject", ExternalId = "acme/office-chair-x2" };
            Assert.Eq(0, FamilyHubPipeline.EntriesForProduct(reg, other).Count);
        }
    }
}
