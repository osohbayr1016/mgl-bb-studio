using System;
using System.Threading;
using System.Threading.Tasks;
using RevitMcpAddin.FamilyHub.Core;
using RevitMcpAddin.FamilyHub.Providers;

namespace RevitMcpAddin.FamilyHub.Tests
{
    /// <summary>
    /// БОДИТ сүлжээний тест — ЗӨВХӨН `FAMILYHUB_LIVE=1` үед (сүлжээгүй машинд
    /// suite ногоон хэвээр).  Нийт 2 хүсэлт: GitHub trees API ×1, raw татах ×1.
    /// Бөөнөөр татахгүй; anonymous rate limit 60/цаг.
    /// </summary>
    public static class LiveTests
    {
        private static bool Enabled => Environment.GetEnvironmentVariable("FAMILYHUB_LIVE") == "1";

        [Test] public static async Task Live_GitHub_SearchDownloadValidateRegister_RealFile()
        {
            if (!Enabled) { Console.WriteLine("       (skipped — set FAMILYHUB_LIVE=1)"); return; }
            var provider = new GitHubPublicRfaProvider();
            SearchResult s = await provider.SearchAsync(new FamilySearchQuery { Text = "chair" }, CancellationToken.None);
            Assert.Eq(1, s.Items.Count, "StudioLE/RevitFamilies has exactly one *chair* rfa");
            FamilyProduct p = s.Items[0];
            Console.WriteLine("       product: " + p.ExternalId + " asset=" + p.ExternalAssetId + " size=" + p.SizeBytes);

            var revit = new FakeRevit { RevitVersion = 2027 };
            var resolver = new ScriptedResolver();
            var obs = new RecordingObserver();
            string temp = TestEnv.TempRoot();
            var pipeline = new FamilyHubPipeline(revit, new SafeDownloader(), resolver, new PipelineOptions { TempRoot = temp });

            PipelineResult res = await pipeline.AddToRevitAsync(provider, p, obs, CancellationToken.None);
            Console.WriteLine("       download: HTTP " + res.Download.HttpStatus + " " + res.Download.ContentType + " " + res.Download.Bytes + " B  final=" + res.Download.FinalUrl);
            Console.WriteLine("       sha256:   " + res.Files[0].Sha256);
            Console.WriteLine("       saved in: Revit " + res.Files[0].SavedRevitVersion + " → " + RevitCompatibilityCheck.Label(res.Files[0].Compatibility));
            Assert.Eq(PipelineStatus.Ok, res.Status, res.Message);
            Assert.Eq(200, res.Download.HttpStatus);
            Assert.Eq(307200L, res.Download.Bytes);
            Assert.Eq("2c768906bf8bcd7a6a80f2ff51d4b29f4d292de26b7e6c88fccbe76af19f5d91", res.Files[0].Sha256, "matches the hash measured with curl on 2026-09-15");
            Assert.Eq(2018, res.Files[0].SavedRevitVersion ?? 0);
            Assert.Eq(RevitCompatibility.LikelyCompatible, res.Files[0].Compatibility);
            Assert.Eq("LE Chair", res.Files[0].FamilyName);
            Assert.True(res.TempCleaned, "temp cleaned");

            // Хоёр дахь удаа — сүлжээ рүү ОГТ хандахгүй.
            PipelineResult again = await pipeline.AddToRevitAsync(provider, p, obs, CancellationToken.None);
            Assert.Eq(PipelineStatus.AlreadyInProject, again.Status);
            Assert.Null(again.Download, "no download on second click");
        }
    }
}
