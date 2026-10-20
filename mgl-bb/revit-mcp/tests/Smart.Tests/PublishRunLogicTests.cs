using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.Smart.Core;
using RevitMcpAddin.SmartPublish.Core;

namespace RevitMcpAddin.Smart.Tests
{
    /// <summary>Файлын систем дуудлагыг тоолно — planner нэг файл тутамд `FileExists` дуудаж болохгүй.</summary>
    internal sealed class CountingFileSystem : IFileSystem
    {
        private readonly IFileSystem _inner;
        public int FileExistsCalls, ListCalls;
        public CountingFileSystem(IFileSystem inner) { _inner = inner; }
        public bool FileExists(string path) { FileExistsCalls++; return _inner.FileExists(path); }
        public bool DirectoryExists(string path) { return _inner.DirectoryExists(path); }
        public void CreateDirectory(string path) { _inner.CreateDirectory(path); }
        public bool TryProbeWritable(string directory, out string error) { return _inner.TryProbeWritable(directory, out error); }
        public FileFacts GetFile(string path) { return _inner.GetFile(path); }
        public IReadOnlyList<FileFacts> ListFiles(string directory) { ListCalls++; return _inner.ListFiles(directory); }
    }

    public static class PublishRunLogicTests
    {
        private static ArtifactCheck GoodCheck(string path = @"D:\o\a.pdf")
        {
            return new ArtifactCheck { Ok = true, Path = path, Length = 900, LastWriteUtc = new DateTime(2026, 1, 1, 0, 0, 5, DateTimeKind.Utc) };
        }

        /* --------------------------- CLASSIFIER --------------------------- */

        [Test]
        public static void Classify_TrueAndFreshFile_Succeeds_Validated()
        {
            ArtifactVerdict v = ArtifactClassifier.Classify(ExportOutcome.Ok(), GoodCheck(), @"D:\o\a.pdf", 1);
            Assert.Eq(ArtifactStatus.Succeeded, v.Status);
            Assert.True(v.Validated);
            Assert.Eq(900L, v.SizeBytes);
        }

        [Test]
        public static void Classify_RevitFalse_ButFileExists_IsFailed_WithPartialPath()
        {
            // PDF: Document.Export `false` — зарим харагдац бүтэлгүй ч файл үүссэн байж болно.
            ArtifactVerdict v = ArtifactClassifier.Classify(new ExportOutcome { Called = true, RevitSaidTrue = false }, GoodCheck(), @"D:\o\a.pdf", 3);
            Assert.Eq(ArtifactStatus.Failed, v.Status);
            Assert.Eq(PublishFailureCode.ExportRejected, v.Code);
            Assert.True(v.Retryable);
            Assert.Eq(@"D:\o\a.pdf", v.Path);
            Assert.True(v.Notes.Any(n => n.Contains("хэсэгчилсэн")), "хэсэгчилсэн файлын тэмдэглэл");
            Assert.True(v.Message.Contains("нэгтгэсэн"), v.Message);
            Assert.False(v.Validated);
        }

        [Test]
        public static void Classify_RevitFalse_NoFile_IsFailed_NoPath_Note()
        {
            ArtifactVerdict v = ArtifactClassifier.Classify(new ExportOutcome { Called = true, RevitSaidTrue = false },
                new ArtifactCheck { Ok = false, Code = PublishFailureCode.MissingArtifact }, @"D:\o\a.pdf", 1);
            Assert.Eq(ArtifactStatus.Failed, v.Status);
            Assert.Eq(0, v.Notes.Count);
        }

        [Test]
        public static void Classify_Exception_Locked_IsRetryable_AndKeepsExceptionType()
        {
            ExportOutcome o = ExportOutcome.Fail(PublishFailureCode.OutputLocked, "locked", new InvalidOperationException(), retryable: true, called: true);
            ArtifactVerdict v = ArtifactClassifier.Classify(o, new ArtifactCheck { Ok = false, Code = PublishFailureCode.MissingArtifact }, @"D:\o\a.pdf", 1);
            Assert.Eq(PublishFailureCode.OutputLocked, v.Code);
            Assert.True(v.Retryable);
            Assert.Eq("InvalidOperationException", v.ExceptionType);
        }

        [Test]
        public static void Classify_Exception_WithPartialFile_RecordsPathAndNote()
        {
            ExportOutcome o = ExportOutcome.Fail(PublishFailureCode.ExportException, "boom", null, retryable: true, called: true);
            ArtifactVerdict v = ArtifactClassifier.Classify(o, GoodCheck(@"D:\o\partial.pdf"), @"D:\o\a.pdf", 1);
            Assert.Eq(@"D:\o\partial.pdf", v.Path);
            Assert.True(v.Notes.Count == 1);
        }

        [Test]
        public static void Classify_ConfigFailure_NotRetryable()
        {
            ExportOutcome o = ExportOutcome.Fail(PublishFailureCode.DwgSetupInvalid, "setup missing");
            ArtifactVerdict v = ArtifactClassifier.Classify(o, null, @"D:\o\a.dwg", 1);
            Assert.False(v.Retryable);
            Assert.Eq(PublishFailureCode.DwgSetupInvalid, v.Code);
        }

        [Test]
        public static void Classify_TrueButMissingFile_IsFailed_NotFalseSuccess()
        {
            ArtifactVerdict v = ArtifactClassifier.Classify(ExportOutcome.Ok(),
                new ArtifactCheck { Ok = false, Code = PublishFailureCode.MissingArtifact, Note = "Хүлээсэн файл үүссэнгүй." }, @"D:\o\a.pdf", 1);
            Assert.Eq(ArtifactStatus.Failed, v.Status);
            Assert.Eq(PublishFailureCode.MissingArtifact, v.Code);
            Assert.False(v.Validated);
        }

        [Test]
        public static void Classify_TrueButStaleFile_IsFailed()
        {
            FileFacts old = new FileFacts { Path = @"D:\o\a.pdf", Length = 500, LastWriteUtc = new DateTime(2026, 1, 1, 0, 0, 5, DateTimeKind.Utc) };
            ArtifactCheck check = ArtifactValidator.Validate(@"D:\o\a.pdf", new[] { old }, new[] { old });
            ArtifactVerdict v = ArtifactClassifier.Classify(ExportOutcome.Ok(), check, @"D:\o\a.pdf", 1);
            Assert.Eq(ArtifactStatus.Failed, v.Status);
            Assert.True(v.Message.Contains("шинэчлэгдээгүй"), v.Message);
        }

        [Test]
        public static void Classify_TrueButZeroBytes_IsEmptyArtifact()
        {
            ArtifactCheck check = ArtifactValidator.Validate(@"D:\o\a.pdf", new FileFacts[0],
                new[] { new FileFacts { Path = @"D:\o\a.pdf", Length = 0, LastWriteUtc = DateTime.UtcNow } });
            ArtifactVerdict v = ArtifactClassifier.Classify(ExportOutcome.Ok(), check, @"D:\o\a.pdf", 1);
            Assert.Eq(PublishFailureCode.EmptyArtifact, v.Code);
        }

        [Test]
        public static void Classify_NameDiffered_SucceedsWithNote()
        {
            ArtifactCheck check = ArtifactValidator.Validate(@"D:\o\A.dwg", new FileFacts[0],
                new[] { new FileFacts { Path = @"D:\o\A-Level 1.dwg", Length = 100, LastWriteUtc = DateTime.UtcNow } });
            ArtifactVerdict v = ArtifactClassifier.Classify(ExportOutcome.Ok(), check, @"D:\o\A.dwg", 1);
            Assert.Eq(ArtifactStatus.Succeeded, v.Status);
            Assert.Eq(@"D:\o\A-Level 1.dwg", v.Path);
            Assert.True(v.Notes.Count == 1);
        }

        /* ------------------------------- RETRY ---------------------------- */

        private static PublishRun Run()
        {
            return new PublishRun
            {
                Id = "r", ProfileId = "p",
                Artifacts = new List<PublishArtifact>
                {
                    new PublishArtifact { ItemId = "s1", Format = PublishFormat.Pdf, Status = ArtifactStatus.Succeeded },
                    new PublishArtifact { ItemId = "s2", Format = PublishFormat.Pdf, Status = ArtifactStatus.Failed, Path = @"D:\Out\PDF\s2.pdf" },
                    new PublishArtifact { ItemId = "s2", Format = PublishFormat.Dwg, Status = ArtifactStatus.Succeeded },
                    new PublishArtifact { ItemId = "s3", Format = PublishFormat.Dwg, Status = ArtifactStatus.Cancelled },
                    new PublishArtifact { ItemId = "*", Format = PublishFormat.Ifc, Status = ArtifactStatus.Failed },
                    new PublishArtifact { ItemId = "*", Format = PublishFormat.Pdf, Status = ArtifactStatus.Cancelled, MemberIds = { "s4", "s5" } },
                },
            };
        }

        [Test]
        public static void Retry_Targets_AreFailedAndCancelledOnly()
        {
            List<RetryTarget> t = PublishRetry.Targets(Run());
            Assert.Eq(4, t.Count);
            Assert.True(t.Any(x => x.ItemId == "s2" && x.Format == PublishFormat.Pdf));
            Assert.False(t.Any(x => x.ItemId == "s1"));
            Assert.False(t.Any(x => x.ItemId == "s2" && x.Format == PublishFormat.Dwg), "амжилттай хэсгийг дахин гаргахгүй");
        }

        [Test]
        public static void Retry_ItemIds_ExpandCombinedMembers()
        {
            Assert.SeqEq(new[] { "s2", "s3", "s4", "s5" }, PublishRetry.ItemIds(Run()).OrderBy(x => x));
        }

        [Test]
        [WindowsOnly("Windows drive-letter paths (D:\\...): on a non-Windows OS System.IO.Path does not treat them as rooted/separated")]
        public static void Retry_Plan_OnlyFailedPairs_AndPartialFileIsOverwrittenNotVersioned()
        {
            PublishProfile p = Samples.Profile();
            p.Formats = new List<PublishFormat> { PublishFormat.Pdf, PublishFormat.Dwg };
            p.Naming.SheetTemplate = "{SheetNumber}";
            PublishRun run = new PublishRun
            {
                Id = "r", ProfileId = p.Id,
                Artifacts = new List<PublishArtifact>
                {
                    new PublishArtifact { ItemId = "u0", Format = PublishFormat.Pdf, Status = ArtifactStatus.Failed, Path = @"D:\Out\PDF\A-101.pdf" },
                    new PublishArtifact { ItemId = "u0", Format = PublishFormat.Dwg, Status = ArtifactStatus.Succeeded },
                },
            };
            var items = new List<PublishItem> { Samples.Sheet("u0", "A-101", "Plan") };
            // Бүтэлгүйтсэн оролдлогын хэсэгчилсэн PDF диск дээр үлдсэн.
            var fs = new MemoryFileSystem().AddDir(@"D:\Out").AddFile(@"D:\Out\PDF\A-101.pdf", 10);
            var hiding = new PublishRetry.HidingFileSystem(fs, new[] { @"D:\Out\PDF\A-101.pdf" });

            PublishPlan full = PublishPlanner.Build(p, items, Samples.Project(), hiding);
            PublishPlan plan = PublishRetry.Filter(full, PublishRetry.Targets(run));
            Assert.Eq(1, plan.Artifacts.Count);
            Assert.Eq("A-101", plan.Artifacts[0].FileBaseName, "хэсэгчилсэн файл _v2 болохгүй");
            Assert.Eq(PlanAction.Export, plan.Artifacts[0].Action);

            // Хэрэв нуухгүй бол Version горимд _v2 болох байсан (ялгааг батлах).
            PublishPlan unhidden = PublishPlanner.Build(p, items, Samples.Project(), fs);
            Assert.Eq("A-101_v2", unhidden.Artifacts.First(a => a.Format == PublishFormat.Pdf).FileBaseName);
        }

        /* ------------------------ PLANNER PERFORMANCE --------------------- */

        [Test]
        public static void Planner_DoesNotCallFileExists_PerArtifact_ListsEachFolderOnce()
        {
            PublishProfile p = Samples.Profile();
            p.Formats = new List<PublishFormat> { PublishFormat.Pdf, PublishFormat.Dwg };
            var items = Enumerable.Range(0, 400).Select(i => Samples.Sheet("u" + i, "A-" + i, "Plan " + i)).ToList();
            var fs = new CountingFileSystem(new MemoryFileSystem().AddDir(@"D:\Out"));
            PublishPlan plan = PublishPlanner.Build(p, items, Samples.Project(), fs);
            Assert.Eq(800, plan.Artifacts.Count);
            Assert.Eq(0, fs.FileExistsCalls, "FileExists дуудаагүй байх ёстой");
            Assert.True(fs.ListCalls <= 2, "хавтас тутамд нэг л жагсаалт: " + fs.ListCalls);
        }

        /* ---------------------------- NATURAL SORT ------------------------ */

        [Test]
        public static void NaturalComparer_OrdersNumbersNumerically()
        {
            var list = new List<string> { "A-10", "A-2", "a-1", "A-100", "B-1", "A-02", "A-1" };
            list.Sort(NaturalComparer.Instance);
            Assert.SeqEq(new[] { "A-1", "a-1", "A-02", "A-2", "A-10", "A-100", "B-1" }, list);
            Assert.Eq("B-1", list.Last());
            Assert.True(list.IndexOf("A-2") < list.IndexOf("A-10"));
            Assert.True(list.IndexOf("A-10") < list.IndexOf("A-100"));
        }

        [Test]
        public static void NaturalComparer_NullsAndPrefixes()
        {
            Assert.True(NaturalComparer.Instance.Compare(null, "A") < 0);
            Assert.True(NaturalComparer.Instance.Compare("A", null) > 0);
            Assert.Eq(0, NaturalComparer.Instance.Compare(null, null));
            Assert.True(NaturalComparer.Instance.Compare("A", "A-1") < 0);
            Assert.True(NaturalComparer.Instance.Compare("Нэг-2", "Нэг-10") < 0);
        }
    }
}
