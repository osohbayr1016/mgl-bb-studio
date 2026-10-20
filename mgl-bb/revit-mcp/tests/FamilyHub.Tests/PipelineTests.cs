using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using RevitMcpAddin.FamilyHub.Core;

namespace RevitMcpAddin.FamilyHub.Tests
{
    /// <summary>Даалгаврын 16 тестийн хувилбар — pipeline түвшинд, Revit-гүй.</summary>
    public static class PipelineTests
    {
        private const string Host = "https://files.example.test/";

        private sealed class Rig
        {
            public StubHttpHandler Http = new StubHttpHandler();
            public StubProvider Provider = new StubProvider();
            public FakeRevit Revit = new FakeRevit();
            public ScriptedResolver Resolver = new ScriptedResolver();
            public RecordingObserver Observer = new RecordingObserver();
            public string TempRoot = TestEnv.TempRoot();
            public PipelineOptions Options;
            public FamilyHubPipeline Pipeline
            {
                get
                {
                    Options = Options ?? new PipelineOptions { TempRoot = TempRoot, DownloadTimeout = TimeSpan.FromSeconds(5) };
                    return new FamilyHubPipeline(Revit, new SafeDownloader(Http), Resolver, Options);
                }
            }
            public Task<PipelineResult> Add(FamilyProduct p) => Pipeline.AddToRevitAsync(Provider, p, Observer, CancellationToken.None);
            public int Downloads(string url) => Http.Requests.FindAll(u => u == url).Count;
            public bool TempEmpty() => !Directory.Exists(TempRoot) || Directory.GetDirectories(TempRoot).Length == 0;
        }

        [Test] public static async Task T01_FirstDownload_LoadsAndRegisters()
        {
            var r = new Rig();
            r.Http.File(Host + "Chair.rfa", FakeRfa.Make(2018, "a"));
            FamilyProduct p = r.Provider.Add("prod-1", "asset-1", "Chair", Host + "Chair.rfa");

            PipelineResult res = await r.Add(p);

            Assert.Eq(PipelineStatus.Ok, res.Status, res.Message);
            Assert.Eq(1, res.Files.Count);
            Assert.Eq(FileOutcomeStatus.Loaded, res.Files[0].Status);
            Assert.Eq("Chair", res.Files[0].FamilyName);
            Assert.Eq(2, res.Files[0].SymbolNames.Count);
            Assert.Eq(RevitCompatibility.LikelyCompatible, res.Files[0].Compatibility);
            Assert.Eq(2018, res.Files[0].SavedRevitVersion ?? 0);
            Assert.Eq(1, r.Revit.LoadCalls);
            Assert.True(res.TempCleaned, "temp cleaned");
            Assert.True(r.TempEmpty(), "temp dir empty");
            FamilyHubRegistry reg = FamilyHubRegistry.FromJson(r.Revit.RegistryJson);
            Assert.Eq(1, reg.Entries.Count);
            Assert.Eq("stub:prod-1:asset-1", reg.Entries[0].ProviderIdentity);
            Assert.Eq(res.Files[0].Sha256, reg.Entries[0].Sha256);
            Assert.Contains(string.Join(",", r.Observer.Stages), "Checking,Downloading");
        }

        [Test] public static async Task T02_SameProductTwice_NoSecondDownload()
        {
            var r = new Rig();
            r.Http.File(Host + "Chair.rfa", FakeRfa.Make(2018, "a"));
            FamilyProduct p = r.Provider.Add("prod-1", "asset-1", "Chair", Host + "Chair.rfa");
            await r.Add(p);
            int before = r.Downloads(Host + "Chair.rfa");

            PipelineResult res = await r.Add(p);

            Assert.Eq(PipelineStatus.AlreadyInProject, res.Status, res.Message);
            Assert.Eq(before, r.Downloads(Host + "Chair.rfa"), "no re-download");
            Assert.Eq(1, r.Revit.LoadCalls, "no re-load");
            Assert.Eq(FileOutcomeStatus.AlreadyInProject, res.Files[0].Status);
            Assert.Eq(1, r.Revit.Families.Count);
        }

        [Test] public static async Task T03_SameFileTwoRecords_MappedByHash_NoSecondCopy()
        {
            var r = new Rig();
            byte[] same = FakeRfa.Make(2018, "same");
            r.Http.File(Host + "a/Chair.rfa", same).File(Host + "b/Chair.rfa", same);
            FamilyProduct p1 = r.Provider.Add("prod-A", "asset-A", "Chair", Host + "a/Chair.rfa");
            FamilyProduct p2 = r.Provider.Add("prod-B", "asset-B", "Chair", Host + "b/Chair.rfa");
            await r.Add(p1);

            PipelineResult res = await r.Add(p2);

            Assert.Eq(PipelineStatus.Ok, res.Status, res.Message);
            Assert.Eq(FileOutcomeStatus.MappedByHash, res.Files[0].Status);
            Assert.Eq(1, r.Revit.LoadCalls, "second record must NOT import a second copy");
            Assert.Eq(1, r.Revit.Families.Count);
            Assert.Eq(0, r.Resolver.Calls, "hash match wins before name-conflict dialog");
            FamilyHubRegistry reg = FamilyHubRegistry.FromJson(r.Revit.RegistryJson);
            Assert.Eq(2, reg.Entries.Count);
            Assert.Eq(reg.Entries[0].RevitFamilyId, reg.Entries[1].RevitFamilyId);
            Assert.True(reg.Entries[1].MappedByHash);
            // Гурав дахь дарахад хоёр дахь бичлэг ч «IN PROJECT».
            PipelineResult again = await r.Add(p2);
            Assert.Eq(PipelineStatus.AlreadyInProject, again.Status);
        }

        [Test] public static async Task T04a_SameNameDifferentFile_Cancel()
        {
            var r = new Rig();
            r.Revit.AddExisting("Chair", "Old");
            r.Http.File(Host + "Chair.rfa", FakeRfa.Make(2018, "new"));
            FamilyProduct p = r.Provider.Add("prod-1", "asset-1", "Chair", Host + "Chair.rfa");
            r.Resolver.Decision = ConflictDecision.Cancel;

            PipelineResult res = await r.Add(p);

            Assert.Eq(1, r.Resolver.Calls);
            Assert.Eq("Chair", r.Resolver.Last.FamilyName);
            Assert.Eq(PipelineStatus.Cancelled, res.Status, res.Message);
            Assert.Eq(FileOutcomeStatus.NameConflictCancelled, res.Files[0].Status);
            Assert.Eq(0, r.Revit.LoadCalls, "no overwrite, no rename, no load");
            Assert.Eq(1, r.Revit.Families.Count);
            Assert.Null(r.Revit.RegistryJson, "nothing registered");
            Assert.True(r.TempEmpty());
        }

        [Test] public static async Task T04b_SameNameDifferentFile_UseExisting()
        {
            var r = new Rig();
            FakeRevit.Fam old = r.Revit.AddExisting("Chair", "Old");
            r.Http.File(Host + "Chair.rfa", FakeRfa.Make(2018, "new"));
            FamilyProduct p = r.Provider.Add("prod-1", "asset-1", "Chair", Host + "Chair.rfa");
            r.Resolver.Decision = ConflictDecision.UseExisting;

            PipelineResult res = await r.Add(p);

            Assert.Eq(PipelineStatus.Ok, res.Status, res.Message);
            Assert.Eq(FileOutcomeStatus.UsedExisting, res.Files[0].Status);
            Assert.Eq(old.Id, res.Files[0].FamilyId);
            Assert.Eq(0, r.Revit.LoadCalls);
            Assert.Eq(1, r.Revit.Families.Count, "Chair 1 / Chair Copy must never appear");
            PipelineResult again = await r.Add(p);
            Assert.Eq(PipelineStatus.AlreadyInProject, again.Status);
        }

        [Test] public static async Task T05_ZipWithOneRfa()
        {
            var r = new Rig();
            r.Http.File(Host + "pack.zip", FakeRfa.Zip(FakeRfa.Entry("Desk.rfa", FakeRfa.Make(2018, "d"))), "application/zip");
            FamilyProduct p = r.Provider.Add("prod-z", "asset-z", "Desk pack", Host + "pack.zip");

            PipelineResult res = await r.Add(p);

            Assert.Eq(PipelineStatus.Ok, res.Status, res.Message);
            Assert.Eq(1, res.Files.Count);
            Assert.Eq("Desk", res.Files[0].FamilyName);
            FamilyHubRegistry reg = FamilyHubRegistry.FromJson(r.Revit.RegistryJson);
            Assert.Eq("asset-z#Desk.rfa", reg.Entries[0].ExternalAssetId);
            Assert.True(r.TempEmpty(), "extract dir cleaned");
        }

        [Test] public static async Task T06_ZipWithMultipleRfa_AllLoaded_ThenInProject()
        {
            var r = new Rig();
            r.Http.File(Host + "set.zip", FakeRfa.Zip(
                FakeRfa.Entry("furniture/Table.rfa", FakeRfa.Make(2018, "t")),
                FakeRfa.Entry("furniture/Sofa.rfa", FakeRfa.Make(2018, "s")),
                FakeRfa.Entry("readme.txt", new byte[] { 65, 66 })), "application/zip");
            FamilyProduct p = r.Provider.Add("prod-set", "asset-set", "Set", Host + "set.zip");

            PipelineResult res = await r.Add(p);

            Assert.Eq(PipelineStatus.Ok, res.Status, res.Message);
            Assert.Eq(2, res.Files.Count);
            Assert.Eq(2, r.Revit.LoadCalls);
            PipelineResult again = await r.Add(p);
            Assert.Eq(PipelineStatus.AlreadyInProject, again.Status, "both entries recognised");
            Assert.Eq(2, r.Revit.LoadCalls);
        }

        [Test] public static async Task T07_InvalidZip_Rejected()
        {
            var r = new Rig();
            byte[] junk = new byte[600];
            junk[0] = 0x50; junk[1] = 0x4B; junk[2] = 0x03; junk[3] = 0x04; // PK магик, дараа нь хог
            r.Http.File(Host + "bad.zip", junk, "application/zip");
            FamilyProduct p = r.Provider.Add("prod-bad", "asset-bad", "Bad", Host + "bad.zip");

            PipelineResult res = await r.Add(p);

            Assert.Eq(PipelineStatus.InvalidPackage, res.Status, res.Message);
            Assert.Eq(0, r.Revit.LoadCalls);
            Assert.True(r.TempEmpty());
        }

        [Test] public static async Task T07b_ZipWithExecutable_Rejected_Whole()
        {
            var r = new Rig();
            r.Http.File(Host + "evil.zip", FakeRfa.Zip(
                FakeRfa.Entry("Chair.rfa", FakeRfa.Make(2018, "c")),
                FakeRfa.Entry("setup.exe", new byte[] { 0x4D, 0x5A })), "application/zip");
            FamilyProduct p = r.Provider.Add("prod-evil", "asset-evil", "Evil", Host + "evil.zip");
            PipelineResult res = await r.Add(p);
            Assert.Eq(PipelineStatus.InvalidPackage, res.Status, res.Message);
            Assert.Contains(res.Message, "setup.exe");
            Assert.Eq(0, r.Revit.LoadCalls);
        }

        [Test] public static async Task T07c_ZipTraversal_Rejected()
        {
            var r = new Rig();
            r.Http.File(Host + "trav.zip", FakeRfa.Zip(FakeRfa.Entry("../../Chair.rfa", FakeRfa.Make(2018, "c"))), "application/zip");
            FamilyProduct p = r.Provider.Add("prod-trav", "asset-trav", "Trav", Host + "trav.zip");
            PipelineResult res = await r.Add(p);
            Assert.Eq(PipelineStatus.InvalidPackage, res.Status, res.Message);
            Assert.Contains(res.Message, "traversal");
        }

        [Test] public static async Task T08_HttpTimeout()
        {
            var r = new Rig();
            r.Options = new PipelineOptions { TempRoot = r.TempRoot, DownloadTimeout = TimeSpan.FromMilliseconds(300) };
            r.Http.Slow(Host + "slow.rfa", TimeSpan.FromSeconds(5), FakeRfa.Make(2018));
            FamilyProduct p = r.Provider.Add("prod-slow", "asset-slow", "Slow", Host + "slow.rfa");

            PipelineResult res = await r.Add(p);

            Assert.Eq(PipelineStatus.DownloadFailed, res.Status, res.Message);
            Assert.Eq(DownloadStatus.Timeout, res.Download.Status);
            Assert.True(r.TempEmpty());
        }

        [Test] public static async Task T09_Http404()
        {
            var r = new Rig();
            r.Http.Status(Host + "missing.rfa", HttpStatusCode.NotFound);
            FamilyProduct p = r.Provider.Add("prod-404", "asset-404", "Missing", Host + "missing.rfa");
            PipelineResult res = await r.Add(p);
            Assert.Eq(PipelineStatus.DownloadFailed, res.Status, res.Message);
            Assert.Eq(DownloadStatus.NotFound, res.Download.Status);
            Assert.Eq(404, res.Download.HttpStatus);
        }

        [Test] public static async Task T10_LoginRedirect_AuthRequired_NotFollowed()
        {
            var r = new Rig();
            r.Http.Redirect(Host + "gated.rfa", "https://files.example.test/account/login?returnUrl=%2Fgated.rfa");
            r.Http.File(Host + "account/login?returnUrl=%2Fgated.rfa", FakeRfa.Make(2018)); // дагасан бол ЭНД хүрнэ
            FamilyProduct p = r.Provider.Add("prod-gated", "asset-gated", "Gated", Host + "gated.rfa");

            PipelineResult res = await r.Add(p);

            Assert.Eq(PipelineStatus.AuthRequired, res.Status, res.Message);
            Assert.Eq(DownloadStatus.AuthRequired, res.Download.Status);
            Assert.Eq(0, r.Downloads(Host + "account/login?returnUrl=%2Fgated.rfa"), "login URL must never be requested");
            Assert.Contains(res.Message, "AUTH_REQUIRED");
        }

        [Test] public static async Task T10b_RedirectToForeignHost_Blocked()
        {
            var r = new Rig();
            r.Http.Redirect(Host + "hop.rfa", "https://evil.example.org/Chair.rfa");
            FamilyProduct p = r.Provider.Add("prod-hop", "asset-hop", "Hop", Host + "hop.rfa");
            PipelineResult res = await r.Add(p);
            Assert.Eq(PipelineStatus.DownloadFailed, res.Status, res.Message);
            Assert.Eq(DownloadStatus.HostNotAllowed, res.Download.Status);
            Assert.Eq(0, r.Downloads("https://evil.example.org/Chair.rfa"));
        }

        [Test] public static async Task T10c_RedirectWithinAllowlist_Followed()
        {
            var r = new Rig();
            r.Http.Redirect(Host + "moved.rfa", "https://eu.cdn.example.test/Chair.rfa", HttpStatusCode.MovedPermanently);
            r.Http.File("https://eu.cdn.example.test/Chair.rfa", FakeRfa.Make(2018, "cdn"));
            FamilyProduct p = r.Provider.Add("prod-moved", "asset-moved", "Chair", Host + "moved.rfa");
            PipelineResult res = await r.Add(p);
            Assert.Eq(PipelineStatus.Ok, res.Status, res.Message);
            Assert.Eq("https://eu.cdn.example.test/Chair.rfa", res.Download.FinalUrl.ToString());
        }

        [Test] public static async Task T11_Http401_AuthRequired()
        {
            var r = new Rig();
            r.Http.Status(Host + "p.rfa", HttpStatusCode.Unauthorized);
            FamilyProduct p = r.Provider.Add("prod-401", "asset-401", "P", Host + "p.rfa");
            PipelineResult res = await r.Add(p);
            Assert.Eq(PipelineStatus.AuthRequired, res.Status, res.Message);
            Assert.Eq(401, res.Download.HttpStatus);
            Assert.Eq(1, r.Http.Requests.Count, "exactly one attempt, no retry/bypass");
        }

        [Test] public static async Task T12_Http403_AuthRequired()
        {
            var r = new Rig();
            r.Http.Status(Host + "f.rfa", HttpStatusCode.Forbidden, "<html>Just a moment...</html>", "text/html");
            FamilyProduct p = r.Provider.Add("prod-403", "asset-403", "F", Host + "f.rfa");
            PipelineResult res = await r.Add(p);
            Assert.Eq(PipelineStatus.AuthRequired, res.Status, res.Message);
            Assert.Eq(403, res.Download.HttpStatus);
            Assert.Eq(1, r.Http.Requests.Count);
        }

        [Test] public static async Task T12b_HtmlLoginPageWith200_AuthRequired()
        {
            var r = new Rig();
            r.Http.Status(Host + "h.rfa", HttpStatusCode.OK, "<html><form>Please sign in<input type=password></form></html>", "text/html");
            FamilyProduct p = r.Provider.Add("prod-html", "asset-html", "H", Host + "h.rfa");
            PipelineResult res = await r.Add(p);
            Assert.Eq(PipelineStatus.AuthRequired, res.Status, res.Message);
        }

        [Test] public static async Task T12c_ProviderSaysAuthRequired_NoRequestAtAll()
        {
            var r = new Rig();
            FamilyProduct p = r.Provider.Add("bim-1", null, "Locked", null);
            PipelineResult res = await r.Add(p);
            Assert.Eq(PipelineStatus.AuthRequired, res.Status, res.Message);
            Assert.Eq(0, r.Http.Requests.Count);
        }

        [Test] public static async Task T13a_UnsupportedRevitVersion_FromFile_Incompatible()
        {
            var r = new Rig();
            r.Http.File(Host + "future.rfa", FakeRfa.Make(2030, "f", withFormatLine: true));
            FamilyProduct p = r.Provider.Add("prod-fut", "asset-fut", "Future", Host + "future.rfa");
            PipelineResult res = await r.Add(p);
            Assert.Eq(PipelineStatus.Incompatible, res.Status, res.Message);
            Assert.Eq(FileOutcomeStatus.Incompatible, res.Files[0].Status);
            Assert.Eq(RevitCompatibility.Incompatible, res.Files[0].Compatibility);
            Assert.Eq(2030, res.Files[0].SavedRevitVersion ?? 0);
            Assert.Eq(0, r.Revit.LoadCalls);
        }

        [Test] public static async Task T13b_UnsupportedRevitVersion_FromMetadata_NoDownload()
        {
            var r = new Rig();
            r.Http.File(Host + "x.rfa", FakeRfa.Make(2030));
            FamilyProduct p = r.Provider.Add("prod-meta", "asset-meta", "X", Host + "x.rfa", null, "2030", "2031");
            PipelineResult res = await r.Add(p);
            Assert.Eq(PipelineStatus.Incompatible, res.Status, res.Message);
            Assert.Eq(0, r.Http.Requests.Count, "filtered before download");
        }

        [Test] public static async Task T13c_SameVersion_Compatible_UnknownWhenNoLine()
        {
            var r = new Rig();
            r.Http.File(Host + "now.rfa", FakeRfa.Make(2027, "n", withFormatLine: true));
            byte[] blank = new byte[1024]; Array.Copy(new byte[] { 0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1 }, blank, 8);
            r.Http.File(Host + "blank.rfa", blank);
            PipelineResult a = await r.Add(r.Provider.Add("p1", "a1", "Now", Host + "now.rfa"));
            PipelineResult b = await r.Add(r.Provider.Add("p2", "a2", "Blank", Host + "blank.rfa"));
            Assert.Eq(RevitCompatibility.Compatible, a.Files[0].Compatibility);
            Assert.Eq(RevitCompatibility.Unknown, b.Files[0].Compatibility, "never claim compatibility without evidence");
            Assert.Eq(PipelineStatus.Ok, b.Status, "UNKNOWN still attempts load; Revit decides");
        }

        [Test] public static async Task T14_CancelMidDownload_CleansTemp()
        {
            var r = new Rig();
            byte[] big = FakeRfa.Make(2018, "big", pad: 200_000);
            r.Http.Trickle(Host + "big.rfa", big, 4096, TimeSpan.FromMilliseconds(20));
            FamilyProduct p = r.Provider.Add("prod-big", "asset-big", "Big", Host + "big.rfa");
            var cts = new CancellationTokenSource();
            Task<PipelineResult> task = r.Pipeline.AddToRevitAsync(r.Provider, p, r.Observer, cts.Token);
            await Task.Delay(150);
            cts.Cancel();
            PipelineResult res = await task;
            Assert.Eq(PipelineStatus.Cancelled, res.Status, res.Message);
            Assert.Eq(0, r.Revit.LoadCalls);
            Assert.True(res.TempCleaned && r.TempEmpty(), "partial file removed");
        }

        [Test] public static async Task T15_LoadIntoExistingProject_OtherFamiliesUntouched()
        {
            var r = new Rig();
            r.Revit.AddExisting("Door A"); r.Revit.AddExisting("Window B");
            r.Http.File(Host + "Chair.rfa", FakeRfa.Make(2018, "c"));
            PipelineResult res = await r.Add(r.Provider.Add("prod-1", "asset-1", "Chair", Host + "Chair.rfa"));
            Assert.Eq(PipelineStatus.Ok, res.Status, res.Message);
            Assert.Eq(3, r.Revit.Families.Count);
            Assert.Eq(0, r.Resolver.Calls);
        }

        [Test] public static async Task T16_RestartRevit_RegistryPersists_PreventsDuplicate()
        {
            var r = new Rig();
            r.Http.File(Host + "Chair.rfa", FakeRfa.Make(2018, "c"));
            FamilyProduct p = r.Provider.Add("prod-1", "asset-1", "Chair", Host + "Chair.rfa");
            await r.Add(p);
            string persisted = r.Revit.RegistryJson;   // ExtensibleStorage-д хадгалагдсан JSON
            Assert.NotNull(persisted);

            // «Revit дахин асаав»: шинэ gateway, ижил төслийн family + ижил хадгалсан JSON.
            var revit2 = new FakeRevit { RegistryJson = persisted };
            FakeRevit.Fam f = r.Revit.Families[0];
            revit2.Families.Add(f);
            var pipeline2 = new FamilyHubPipeline(revit2, new SafeDownloader(r.Http), r.Resolver, new PipelineOptions { TempRoot = r.TempRoot });
            int before = r.Http.Requests.Count;

            PipelineResult res = await pipeline2.AddToRevitAsync(r.Provider, p, r.Observer, CancellationToken.None);

            Assert.Eq(PipelineStatus.AlreadyInProject, res.Status, res.Message);
            Assert.Eq(before, r.Http.Requests.Count, "no download after restart");
            Assert.Eq(0, revit2.LoadCalls);
        }

        [Test] public static async Task T16b_FamilyDeletedFromProject_StaleEntryDropped_ReloadAllowed()
        {
            var r = new Rig();
            r.Http.File(Host + "Chair.rfa", FakeRfa.Make(2018, "c"));
            FamilyProduct p = r.Provider.Add("prod-1", "asset-1", "Chair", Host + "Chair.rfa");
            await r.Add(p);
            r.Revit.Families.Clear(); // хэрэглэгч family-г Revit дээр устгав
            PipelineResult res = await r.Add(p);
            Assert.Eq(PipelineStatus.Ok, res.Status, res.Message);
            Assert.Eq(FileOutcomeStatus.Loaded, res.Files[0].Status);
            Assert.Eq(1, FamilyHubRegistry.FromJson(r.Revit.RegistryJson).Entries.Count, "stale entry replaced, not duplicated");
        }

        [Test] public static async Task T17_NoProjectDocument()
        {
            var r = new Rig();
            r.Revit.HasDocument = false;
            r.Http.File(Host + "Chair.rfa", FakeRfa.Make(2018));
            PipelineResult res = await r.Add(r.Provider.Add("p", "a", "Chair", Host + "Chair.rfa"));
            Assert.Eq(PipelineStatus.NoDocument, res.Status);
            Assert.Eq(0, r.Http.Requests.Count);
        }

        [Test] public static async Task T18_OversizeRejected_HeaderAndStream()
        {
            var r = new Rig();
            r.Options = new PipelineOptions { TempRoot = r.TempRoot, MaxBytes = 4096 };
            r.Http.File(Host + "huge.rfa", FakeRfa.Make(2018, "h", pad: 10_000));
            PipelineResult res = await r.Add(r.Provider.Add("p", "a", "Huge", Host + "huge.rfa"));
            Assert.Eq(PipelineStatus.DownloadFailed, res.Status, res.Message);
            Assert.Eq(DownloadStatus.TooLarge, res.Download.Status);
            Assert.True(r.TempEmpty());
        }

        [Test] public static async Task T19_HttpSchemeRejected()
        {
            var r = new Rig();
            PipelineResult res = await r.Add(r.Provider.Add("p", "a", "Plain", "http://files.example.test/Chair.rfa"));
            Assert.Eq(PipelineStatus.DownloadFailed, res.Status, res.Message);
            Assert.Eq(DownloadStatus.InsecureScheme, res.Download.Status);
            Assert.Eq(0, r.Http.Requests.Count);
        }

        [Test] public static async Task T20_WrongContentType_Rejected()
        {
            var r = new Rig();
            r.Http.File(Host + "img.rfa", FakeRfa.Make(2018), "image/png");
            PipelineResult res = await r.Add(r.Provider.Add("p", "a", "Img", Host + "img.rfa"));
            Assert.Eq(DownloadStatus.BadContentType, res.Download.Status);
        }

        [Test] public static async Task T21_RfaMagicMismatch_Rejected()
        {
            var r = new Rig();
            r.Http.File(Host + "fake.rfa", System.Text.Encoding.UTF8.GetBytes("MZ this is not an rfa at all, just text padded........."));
            PipelineResult res = await r.Add(r.Provider.Add("p", "a", "Fake", Host + "fake.rfa"));
            Assert.Eq(PipelineStatus.InvalidPackage, res.Status, res.Message);
            Assert.Eq(0, r.Revit.LoadCalls);
        }
    }
}
