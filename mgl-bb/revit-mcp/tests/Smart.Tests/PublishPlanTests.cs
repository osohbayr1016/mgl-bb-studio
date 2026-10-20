using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using RevitMcpAddin.Smart.Core;
using RevitMcpAddin.SmartPublish.Core;

namespace RevitMcpAddin.Smart.Tests
{
    public static class PublishPlanTests
    {
        private static List<PublishItem> Sheets(params string[] numbers)
        {
            return numbers.Select((n, i) => Samples.Sheet("u" + i, n, "Plan " + n)).ToList();
        }

        /* ------------------------------ PLANNER --------------------------- */

        [Test]
        [WindowsOnly("Windows drive-letter paths (D:\\...): on a non-Windows OS System.IO.Path does not treat them as rooted/separated")]
        public static void Plan_PerSheetPdf_NamesAndFolders()
        {
            PublishProfile p = Samples.Profile();
            var fs = new MemoryFileSystem().AddDir(@"D:\Out");
            PublishPlan plan = PublishPlanner.Build(p, Sheets("A-101", "A-102"), Samples.Project(), fs);
            Assert.Eq(2, plan.Artifacts.Count);
            PlannedArtifact a = plan.Artifacts[0];
            Assert.Eq("A-101_Plan A-101_A", a.FileBaseName);
            Assert.Eq(".pdf", a.Extension);
            Assert.Eq(@"D:\Out\PDF", a.Folder);
            Assert.Eq(@"D:\Out\PDF\A-101_Plan A-101_A.pdf", a.FullPath);
            Assert.Eq(PlanAction.Export, a.Action);
        }

        [Test]
        public static void Plan_CombinedPdf_IsOneArtifactWithMembers()
        {
            PublishProfile p = Samples.Profile();
            p.Pdf.Combine = true;
            p.Naming.CombinedTemplate = "{ProjectNumber}_{FirstSheet}-{LastSheet}";
            PublishPlan plan = PublishPlanner.Build(p, Sheets("A-101", "A-102", "A-103"), Samples.Project(), new MemoryFileSystem().AddDir(@"D:\Out"));
            Assert.Eq(1, plan.Artifacts.Count);
            Assert.Eq("*", plan.Artifacts[0].ItemId);
            Assert.Eq("MGL-251006_A-101-A-103", plan.Artifacts[0].FileBaseName);
            Assert.SeqEq(new[] { "u0", "u1", "u2" }, plan.Artifacts[0].MemberIds);
        }

        [Test]
        [WindowsOnly("Windows drive-letter paths (D:\\...): on a non-Windows OS System.IO.Path does not treat them as rooted/separated")]
        public static void Plan_Ifc_IsModelLevel_SingleArtifact()
        {
            PublishProfile p = Samples.Profile();
            p.Formats = new List<PublishFormat> { PublishFormat.Ifc };
            PublishPlan plan = PublishPlanner.Build(p, Sheets("A-101", "A-102"), Samples.Project(new DateTime(2026, 10, 1)), new MemoryFileSystem().AddDir(@"D:\Out"));
            Assert.Eq(1, plan.Artifacts.Count);
            Assert.Eq(PublishItemKind.Model, plan.Artifacts[0].ItemKind);
            Assert.Eq("MGL-251006_20261001_Model", plan.Artifacts[0].FileBaseName);
            Assert.Eq(@"D:\Out\IFC", plan.Artifacts[0].Folder);
        }

        [Test]
        [WindowsOnly("Windows drive-letter paths (D:\\...): on a non-Windows OS System.IO.Path does not treat them as rooted/separated")]
        public static void Plan_MultipleFormats_GoToFormatFolders()
        {
            PublishProfile p = Samples.Profile();
            p.Formats = new List<PublishFormat> { PublishFormat.Pdf, PublishFormat.Dwg };
            PublishPlan plan = PublishPlanner.Build(p, Sheets("A-101"), Samples.Project(), new MemoryFileSystem().AddDir(@"D:\Out"));
            Assert.Eq(2, plan.Artifacts.Count);
            Assert.True(plan.Artifacts.Any(a => a.Folder == @"D:\Out\PDF" && a.Extension == ".pdf"));
            Assert.True(plan.Artifacts.Any(a => a.Folder == @"D:\Out\DWG" && a.Extension == ".dwg"));
        }

        [Test]
        [WindowsOnly("Windows drive-letter paths (D:\\...): on a non-Windows OS System.IO.Path does not treat them as rooted/separated")]
        public static void Plan_Subfolder_TemplateWithSeparators_BecomesNestedFolders()
        {
            PublishProfile p = Samples.Profile();
            p.Destination.SubfolderTemplate = "{ProjectNumber}/{Date:yyyy-MM-dd}/{Format}";
            PublishPlan plan = PublishPlanner.Build(p, Sheets("A-101"), Samples.Project(new DateTime(2026, 10, 1)), new MemoryFileSystem().AddDir(@"D:\Out"));
            Assert.Eq(@"D:\Out\MGL-251006\2026-10-01\PDF", plan.Artifacts[0].Folder);
        }

        [Test]
        public static void Plan_Subfolder_DotDotSegments_CannotEscapeBase()
        {
            PublishProfile p = Samples.Profile();
            p.Destination.SubfolderTemplate = "../../Windows/{Format}";
            PublishPlan plan = PublishPlanner.Build(p, Sheets("A-101"), Samples.Project(), new MemoryFileSystem().AddDir(@"D:\Out"));
            Assert.True(plan.Artifacts[0].Folder.StartsWith(@"D:\Out"), plan.Artifacts[0].Folder);
            Assert.False(plan.Artifacts[0].Folder.Contains(".."), plan.Artifacts[0].Folder);
        }

        [Test]
        public static void Plan_NoBaseFolder_LeavesFolderNull()
        {
            PublishProfile p = Samples.Profile(null);
            PublishPlan plan = PublishPlanner.Build(p, Sheets("A-101"), Samples.Project(), new MemoryFileSystem());
            Assert.Null(plan.Artifacts[0].Folder);
        }

        [Test]
        public static void Plan_InvalidTemplate_IsReportedOnce_NotPerSheet()
        {
            PublishProfile p = Samples.Profile();
            p.Naming.SheetTemplate = "{Bogus}_{SheetNumber}";
            PublishPlan plan = PublishPlanner.Build(p, Sheets("A-101", "A-102", "A-103"), Samples.Project(), new MemoryFileSystem().AddDir(@"D:\Out"));
            Assert.Eq(1, plan.NameIssues.Count(i => i.Kind == NameIssueKind.TemplateError && i.ItemId == null));
        }

        [Test]
        public static void Plan_MissingTokens_AreReportedPerItem()
        {
            PublishProfile p = Samples.Profile();
            p.Naming.SheetTemplate = "{SheetNumber}_{Param:Zone}";
            PublishPlan plan = PublishPlanner.Build(p, Sheets("A-101", "A-102"), Samples.Project(), new MemoryFileSystem().AddDir(@"D:\Out"));
            Assert.Eq(2, plan.NameIssues.Count(i => i.Kind == NameIssueKind.MissingToken));
        }

        [Test]
        public static void Plan_DuplicateNames_Block_ReportsAllMembers()
        {
            PublishProfile p = Samples.Profile();
            p.Naming.SheetTemplate = "{ProjectNumber}";   // бүх хуудас ижил нэр
            PublishPlan plan = PublishPlanner.Build(p, Sheets("A-101", "A-102"), Samples.Project(), new MemoryFileSystem().AddDir(@"D:\Out"));
            Assert.Eq(2, plan.NameIssues.Count(i => i.Kind == NameIssueKind.Duplicate));
        }

        [Test]
        public static void Plan_DuplicateNames_Suffix_ResolvesDeterministically()
        {
            PublishProfile p = Samples.Profile();
            p.Naming.SheetTemplate = "{ProjectNumber}";
            p.Naming.Duplicates = DuplicateNamePolicy.Suffix;
            PublishPlan plan = PublishPlanner.Build(p, Sheets("A-101", "A-102", "A-103"), Samples.Project(), new MemoryFileSystem().AddDir(@"D:\Out"));
            Assert.SeqEq(new[] { "MGL-251006", "MGL-251006_2", "MGL-251006_3" }, plan.Artifacts.Select(a => a.FileBaseName));
            Assert.Eq(2, plan.NameIssues.Count(i => i.Kind == NameIssueKind.DuplicateResolved));
        }

        [Test]
        public static void Plan_DuplicateDetection_IsCaseInsensitive()
        {
            PublishProfile p = Samples.Profile();
            p.Naming.SheetTemplate = "{SheetNumber}";
            var items = new List<PublishItem> { Samples.Sheet("1", "a-101", "x"), Samples.Sheet("2", "A-101", "y") };
            PublishPlan plan = PublishPlanner.Build(p, items, Samples.Project(), new MemoryFileSystem().AddDir(@"D:\Out"));
            Assert.Eq(2, plan.NameIssues.Count(i => i.Kind == NameIssueKind.Duplicate));
        }

        [Test]
        public static void Plan_SamePdfAndDwgName_IsNotADuplicate()
        {
            PublishProfile p = Samples.Profile();
            p.Formats = new List<PublishFormat> { PublishFormat.Pdf, PublishFormat.Dwg };
            p.Destination.SubfolderTemplate = "";   // ижил хавтас, ялгаатай өргөтгөл
            PublishPlan plan = PublishPlanner.Build(p, Sheets("A-101"), Samples.Project(), new MemoryFileSystem().AddDir(@"D:\Out"));
            Assert.Eq(0, plan.NameIssues.Count(i => i.Kind == NameIssueKind.Duplicate));
        }

        /* ---------------------------- BYE-GAAH FILES ---------------------- */

        [Test]
        [WindowsOnly("Windows drive-letter paths (D:\\...): on a non-Windows OS System.IO.Path does not treat them as rooted/separated")]
        public static void Plan_Overwrite_Modes_WithExistingFile()
        {
            string existing = @"D:\Out\PDF\A-101_Plan A-101_A.pdf";
            Func<OverwriteMode, PlannedArtifact> run = mode =>
            {
                PublishProfile p = Samples.Profile();
                p.Overwrite = mode;
                var fs = new MemoryFileSystem().AddDir(@"D:\Out\PDF").AddFile(existing);
                return PublishPlanner.Build(p, Sheets("A-101"), Samples.Project(), fs).Artifacts[0];
            };

            PlannedArtifact ow = run(OverwriteMode.Overwrite);
            Assert.Eq(PlanAction.Overwrite, ow.Action);
            Assert.True(ow.TargetExists);
            Assert.Eq("A-101_Plan A-101_A", ow.FileBaseName);

            PlannedArtifact skip = run(OverwriteMode.Skip);
            Assert.Eq(PlanAction.SkipExisting, skip.Action);

            PlannedArtifact fail = run(OverwriteMode.Fail);
            Assert.Eq(PlanAction.Export, fail.Action);
            Assert.True(fail.TargetExists);

            PlannedArtifact ver = run(OverwriteMode.Version);
            Assert.Eq(PlanAction.Versioned, ver.Action);
            Assert.Eq("A-101_Plan A-101_A_v2", ver.FileBaseName);
        }

        [Test]
        [WindowsOnly("Windows drive-letter paths (D:\\...): on a non-Windows OS System.IO.Path does not treat them as rooted/separated")]
        public static void Plan_Version_SkipsTakenVersionNumbers()
        {
            PublishProfile p = Samples.Profile();
            var fs = new MemoryFileSystem().AddDir(@"D:\Out\PDF")
                .AddFile(@"D:\Out\PDF\A-101_Plan A-101_A.pdf")
                .AddFile(@"D:\Out\PDF\A-101_Plan A-101_A_v2.pdf")
                .AddFile(@"D:\Out\PDF\A-101_Plan A-101_A_v3.pdf");
            PlannedArtifact a = PublishPlanner.Build(p, Sheets("A-101"), Samples.Project(), fs).Artifacts[0];
            Assert.Eq("A-101_Plan A-101_A_v4", a.FileBaseName);
        }

        [Test]
        [WindowsOnly("Windows drive-letter paths (D:\\...): on a non-Windows OS System.IO.Path does not treat them as rooted/separated")]
        public static void Plan_Existing_IsCaseInsensitiveLikeWindows()
        {
            PublishProfile p = Samples.Profile();
            p.Overwrite = OverwriteMode.Skip;
            var fs = new MemoryFileSystem().AddDir(@"D:\Out\PDF").AddFile(@"D:\Out\PDF\a-101_plan a-101_a.PDF");
            // MemoryFileSystem нь зам харьцуулалтад үсгийн том/жижгийг үл хамаарна.
            PlannedArtifact a = PublishPlanner.Build(p, Sheets("A-101"), Samples.Project(), fs).Artifacts[0];
            Assert.Eq(PlanAction.SkipExisting, a.Action);
        }

        [Test]
        public static void Plan_PathTooLong_IsFlagged()
        {
            PublishProfile p = Samples.Profile(@"D:\" + new string('x', 200));
            p.Naming.SheetTemplate = "{SheetName}";
            var items = new List<PublishItem> { Samples.Sheet("1", "A-101", new string('Ө', 100)) };
            PublishPlan plan = PublishPlanner.Build(p, items, Samples.Project(), new MemoryFileSystem());
            Assert.Eq(1, plan.NameIssues.Count(i => i.Kind == NameIssueKind.PathTooLong));
        }

        [Test]
        public static void Plan_Index_Token_IncrementsAcrossArtifacts()
        {
            PublishProfile p = Samples.Profile();
            p.Naming.SheetTemplate = "{Index:3}_{SheetNumber}";
            PublishPlan plan = PublishPlanner.Build(p, Sheets("A-101", "A-102"), Samples.Project(), new MemoryFileSystem().AddDir(@"D:\Out"));
            Assert.SeqEq(new[] { "001_A-101", "002_A-102" }, plan.Artifacts.Select(a => a.FileBaseName));
        }

        /* ------------------------------ SELECTION ------------------------- */

        [Test]
        public static void Selection_Conditions_AreAnded_CaseInsensitive()
        {
            var rule = new SelectionRule();
            rule.Conditions.Add(new ItemCondition { Field = "SheetNumber", Op = ConditionOp.StartsWith, Value = "a-" });
            rule.Conditions.Add(new ItemCondition { Field = "Param:Discipline", Op = ConditionOp.Equals, Value = "architecture" });
            Assert.True(ItemSelection.Matches(Samples.Sheet("1", "A-101", "x"), rule));
            Assert.False(ItemSelection.Matches(Samples.Sheet("2", "S-101", "x"), rule));
        }

        [Test]
        public static void Selection_UnknownOperator_DoesNotMatch_Safely()
        {
            var rule = new SelectionRule();
            rule.Conditions.Add(new ItemCondition { Field = "SheetNumber", Op = ConditionOp.Unknown, Value = "x" });
            Assert.False(ItemSelection.Matches(Samples.Sheet("1", "A-101", "x"), rule));
        }

        [Test]
        public static void Selection_Eligible_ExcludesPlaceholdersAndViewsByDefault()
        {
            var all = new List<PublishItem>
            {
                Samples.Sheet("1", "A-101", "x"),
                Samples.Sheet("2", "A-102", "ph", placeholder: true),
                new PublishItem { Id = "v", Kind = PublishItemKind.View, Number = "Level 1", Name = "Level 1" },
            };
            Assert.SeqEq(new[] { "1" }, ItemSelection.Eligible(all, new SelectionRule()).Select(i => i.Id));
            Assert.Eq(3, ItemSelection.Eligible(all, new SelectionRule { IncludePlaceholders = true, IncludeViews = true }).Count());
        }

        [Test]
        public static void Selection_FieldValue_Aliases()
        {
            PublishItem it = Samples.Sheet("1", "A-101", "Plan", "C");
            Assert.Eq("A-101", ItemSelection.FieldValue(it, "number"));
            Assert.Eq("Plan", ItemSelection.FieldValue(it, "SheetName"));
            Assert.Eq("C", ItemSelection.FieldValue(it, "Revision"));
            Assert.Eq("Architecture", ItemSelection.FieldValue(it, "Param:Discipline"));
            Assert.Null(ItemSelection.FieldValue(it, "nonsense"));
        }

        /* -------------------------- ARTIFACT VALIDATION ------------------- */

        private static FileFacts F(string path, long len, int sec)
        {
            return new FileFacts { Path = path, Length = len, LastWriteUtc = new DateTime(2026, 1, 1, 0, 0, sec, DateTimeKind.Utc) };
        }

        [Test]
        public static void Validate_NewFile_IsOk()
        {
            ArtifactCheck c = ArtifactValidator.Validate(@"D:\o\a.pdf", new FileFacts[0], new[] { F(@"D:\o\a.pdf", 500, 5) });
            Assert.True(c.Ok);
            Assert.Eq(500L, c.Length);
            Assert.False(c.NameDiffered);
        }

        [Test]
        public static void Validate_Missing_IsMissingArtifact()
        {
            ArtifactCheck c = ArtifactValidator.Validate(@"D:\o\a.pdf", new FileFacts[0], new FileFacts[0]);
            Assert.False(c.Ok);
            Assert.Eq(PublishFailureCode.MissingArtifact, c.Code);
        }

        [Test]
        public static void Validate_ZeroByte_IsEmptyArtifact()
        {
            ArtifactCheck c = ArtifactValidator.Validate(@"D:\o\a.pdf", new FileFacts[0], new[] { F(@"D:\o\a.pdf", 0, 5) });
            Assert.False(c.Ok);
            Assert.Eq(PublishFailureCode.EmptyArtifact, c.Code);
        }

        [Test]
        public static void Validate_StaleOldFile_IsNotSuccess()
        {
            // Өмнөх гаргалтын файл үлдсэн, экспорт чимээгүй бүтэлгүйтсэн — «байна» гэж худал зарлахгүй.
            FileFacts old = F(@"D:\o\a.pdf", 500, 5);
            ArtifactCheck c = ArtifactValidator.Validate(@"D:\o\a.pdf", new[] { old }, new[] { F(@"D:\o\a.pdf", 500, 5) });
            Assert.False(c.Ok);
            Assert.Eq(PublishFailureCode.MissingArtifact, c.Code);
            Assert.True(c.Note.Contains("шинэчлэгдээгүй"), c.Note);
        }

        [Test]
        public static void Validate_RewrittenFile_Passes_EvenWithSameSize()
        {
            ArtifactCheck c = ArtifactValidator.Validate(@"D:\o\a.pdf", new[] { F(@"D:\o\a.pdf", 500, 5) }, new[] { F(@"D:\o\a.pdf", 500, 9) });
            Assert.True(c.Ok);
        }

        [Test]
        public static void Validate_RevitUsedDifferentName_AdoptsSingleNewFileWithSameExtension()
        {
            ArtifactCheck c = ArtifactValidator.Validate(@"D:\o\A-101.dwg", new[] { F(@"D:\o\old.dwg", 10, 1) },
                new[] { F(@"D:\o\old.dwg", 10, 1), F(@"D:\o\A-101-Level 1.dwg", 700, 7), F(@"D:\o\A-101.pcp", 5, 7) });
            Assert.True(c.Ok);
            Assert.True(c.NameDiffered);
            Assert.True(c.Path.EndsWith("A-101-Level 1.dwg"));
        }

        [Test]
        public static void Validate_AmbiguousNewFiles_AreNotGuessed()
        {
            ArtifactCheck c = ArtifactValidator.Validate(@"D:\o\x.dwg", new FileFacts[0],
                new[] { F(@"D:\o\one.dwg", 10, 3), F(@"D:\o\two.dwg", 10, 3) });
            Assert.False(c.Ok);
            Assert.Eq(PublishFailureCode.MissingArtifact, c.Code);
        }

        /* ------------------------------- STORES --------------------------- */

        [Test]
        public static void ProfileStore_FirstLoad_SeedsStarters_Once()
        {
            var store = new SmartStore(TestDirs.NewTemp());
            PublishProfilesFile f = PublishProfileStore.Load(store);
            Assert.Eq(5, f.Profiles.Count);
            Assert.True(f.Profiles.All(p => p.Starter));
            // Бүгдийг устгасны дараа дахин суулгахгүй.
            foreach (string id in f.Profiles.Select(p => p.Id).ToList()) PublishProfileStore.Delete(f, id);
            PublishProfileStore.Save(f, store);
            Assert.Eq(0, PublishProfileStore.Load(store).Profiles.Count);
        }

        [Test]
        public static void ProfileStore_RestoreStarters_DoesNotDuplicate()
        {
            var store = new SmartStore(TestDirs.NewTemp());
            PublishProfilesFile f = PublishProfileStore.Load(store);
            PublishProfileStore.Delete(f, f.Profiles[0].Id);
            Assert.Eq(1, PublishProfileStore.RestoreStarters(f));
            Assert.Eq(0, PublishProfileStore.RestoreStarters(f));
            Assert.Eq(5, f.Profiles.Count);
        }

        [Test]
        public static void ProfileStore_Upsert_BumpsVersion_OnlyWhenContentChanges()
        {
            var f = new PublishProfilesFile();
            PublishProfile p = Samples.Profile();
            PublishProfileStore.Upsert(f, p);
            Assert.Eq(1, f.Profiles[0].Version);

            PublishProfile same = f.Profiles[0].Clone();
            PublishProfileStore.Upsert(f, same);
            Assert.Eq(1, f.Profiles[0].Version, "агуулга ижил — хувилбар өсөхгүй");

            PublishProfile changed = f.Profiles[0].Clone();
            changed.Naming.SheetTemplate = "{SheetNumber}";
            PublishProfileStore.Upsert(f, changed);
            Assert.Eq(2, f.Profiles[0].Version);
            Assert.Eq(1, f.Profiles.Count);
        }

        [Test]
        public static void ProfileStore_RoundTrip_PreservesEverything()
        {
            var store = new SmartStore(TestDirs.NewTemp());
            var f = new PublishProfilesFile();
            PublishProfile p = Samples.Profile();
            p.Formats = new List<PublishFormat> { PublishFormat.Pdf, PublishFormat.Dwg, PublishFormat.Ifc };
            p.Selection.Conditions.Add(new ItemCondition { Field = "SheetNumber", Op = ConditionOp.StartsWith, Value = "A" });
            p.SeverityOverrides[PreflightIds.MissingToken] = PreflightSeverity.Warning;
            p.Ifc.ExtraOptions["ExportUserDefinedPsets"] = "true";
            p.Pdf.PaperFormat = "ISO_A3";
            PublishProfileStore.Upsert(f, p);
            Assert.True(PublishProfileStore.Save(f, store));

            PublishProfile back = PublishProfileStore.Load(store).Profiles.Single(x => x.Id == p.Id);
            Assert.SeqEq(p.Formats, back.Formats);
            Assert.Eq("A", back.Selection.Conditions[0].Value);
            Assert.Eq(ConditionOp.StartsWith, back.Selection.Conditions[0].Op);
            Assert.Eq(PreflightSeverity.Warning, back.SeverityOverrides[PreflightIds.MissingToken]);
            Assert.Eq("true", back.Ifc.ExtraOptions["ExportUserDefinedPsets"]);
            Assert.Eq("ISO_A3", back.Pdf.PaperFormat);
            Assert.Eq(OverwriteMode.Version, back.Overwrite);
        }

        [Test]
        public static void ProfileStore_OldFileWithoutNewFields_GetsDefaults()
        {
            string root = TestDirs.NewTemp();
            var store = new SmartStore(root);
            File.WriteAllText(store.FullPath("profiles.json"),
                "{\"schema\":1,\"payload\":{\"startersSeeded\":true,\"profiles\":[{\"id\":\"p1\",\"name\":\"Old\",\"formats\":[\"pdf\",\"futureFormat\"]}]}}");
            PublishProfile p = PublishProfileStore.Load(store).Profiles.Single();
            Assert.NotNull(p.Naming);
            Assert.NotNull(p.Destination);
            Assert.NotNull(p.Selection.Conditions);
            Assert.Eq(OverwriteMode.Version, p.Overwrite);
            Assert.Eq(MissingTokenPolicy.Error, p.Naming.OnMissing);
            Assert.Eq(2, p.Formats.Count);
            Assert.Eq(PublishFormat.Unknown, p.Formats[1]);   // танигдаагүй формат Unknown болж, planner хасна
        }

        [Test]
        public static void Planner_IgnoresUnknownFormats()
        {
            PublishProfile p = Samples.Profile();
            p.Formats = new List<PublishFormat> { PublishFormat.Unknown, PublishFormat.Pdf };
            PublishPlan plan = PublishPlanner.Build(p, Sheets("A-101"), Samples.Project(), new MemoryFileSystem().AddDir(@"D:\Out"));
            Assert.Eq(1, plan.Artifacts.Count);
        }

        [Test]
        public static void HistoryStore_Upsert_ReplacesSameId_AndCaps()
        {
            string root = TestDirs.NewTemp();
            SmartPaths.OverrideRoot(root);
            try
            {
                DocumentKey key = DocumentKeyBuilder.Build(new DocumentFacts { CreationGuid = Guid.NewGuid().ToString() });
                var run = new PublishRun { DocKey = key.Id, Status = RunStatus.Running, StartedUtc = DateTime.UtcNow };
                string err;
                Assert.True(PublishHistoryStore.Upsert(key, run, out err), err);
                run.Status = RunStatus.Succeeded;
                Assert.True(PublishHistoryStore.Upsert(key, run, out err), err);
                PublishHistory h = PublishHistoryStore.Load(key);
                Assert.Eq(1, h.Runs.Count);
                Assert.Eq(RunStatus.Succeeded, h.Runs[0].Status);

                for (int i = 0; i < PublishHistoryStore.MaxRuns + 20; i++)
                    PublishHistoryStore.Upsert(key, new PublishRun { StartedUtc = DateTime.UtcNow }, out err);
                Assert.Eq(PublishHistoryStore.MaxRuns, PublishHistoryStore.Load(key).Runs.Count);
            }
            finally { SmartPaths.OverrideRoot(null); }
        }

        [Test]
        public static void HistoryStore_NonPersistableKey_StaysInMemory_NoFiles()
        {
            string root = TestDirs.NewTemp();
            SmartPaths.OverrideRoot(root);
            try
            {
                DocumentKey key = DocumentKeyBuilder.Build(new DocumentFacts { SessionId = "tmp1" });
                Assert.False(key.Persistable);
                string err;
                Assert.True(PublishHistoryStore.Upsert(key, new PublishRun { Status = RunStatus.Failed }, out err));
                Assert.Eq(1, PublishHistoryStore.Load(key).Runs.Count);
                Assert.False(Directory.Exists(Path.Combine(root, "docs")), "түр түлхүүрээр диск дээр файл үүсэх ёсгүй");
            }
            finally { SmartPaths.OverrideRoot(null); }
        }

        /* ----------------------------- CHECKPOINTS ------------------------ */

        private static PublishArtifact Art(string item, PublishFormat f, ArtifactStatus s, params string[] members)
        {
            return new PublishArtifact { ItemId = item, Format = f, Status = s, MemberIds = members.ToList() };
        }

        [Test]
        public static void Checkpoint_Advances_OnlyForFullySuccessfulSheets()
        {
            var cps = new PublishCheckpoints();
            var run = new PublishRun
            {
                Id = "r1", ProfileId = "p", EndedUtc = new DateTime(2026, 10, 1), ChangeSeqAtStart = 42,
                Formats = new List<PublishFormat> { PublishFormat.Pdf, PublishFormat.Dwg },
                ItemIds = new List<string> { "s1", "s2", "s3" },
                Artifacts = new List<PublishArtifact>
                {
                    Art("s1", PublishFormat.Pdf, ArtifactStatus.Succeeded),
                    Art("s1", PublishFormat.Dwg, ArtifactStatus.Succeeded),
                    Art("s2", PublishFormat.Pdf, ArtifactStatus.Succeeded),
                    Art("s2", PublishFormat.Dwg, ArtifactStatus.Failed),     // нэг формат унасан — бүрэн гарсан болохгүй
                    Art("s3", PublishFormat.Pdf, ArtifactStatus.Cancelled),
                },
            };
            PublishCheckpointStore.Advance(cps, run, null);
            Dictionary<string, SheetCheckpoint> map = cps.Profiles["p"];
            Assert.True(map.ContainsKey("s1"));
            Assert.False(map["s1"].Partial, "бүх формат гарсан");
            Assert.Eq(42L, map["s1"].ChangeSeq);
            Assert.True(map.ContainsKey("s2"), "амжилттай PDF-ийн тэмдэг хадгалагдана (дараа DWG-г дахин оролдоход хэрэгтэй)");
            Assert.True(map["s2"].Partial, "DWG унасан — хуудас «бүрэн гараагүй»");
            Assert.True(map["s2"].Formats.ContainsKey("pdf") && !map["s2"].Formats.ContainsKey("dwg"));
            Assert.False(map.ContainsKey("s3"), "цуцлагдсан — ямар ч тэмдэг үгүй");
        }

        [Test]
        public static void Checkpoint_RetryOfOneFormat_DoesNotAdvanceTheWatermarkOfTheOlderFormat()
        {
            var cps = new PublishCheckpoints();
            // Гүйлт 1 (өөрчлөлтийн дугаар 10): PDF гарсан, DWG унасан.
            PublishCheckpointStore.Advance(cps, new PublishRun
            {
                Id = "r1", ProfileId = "p", ChangeSeqAtStart = 10, DocVersionGuidAtStart = "g10", EndedUtc = new DateTime(2026, 10, 1),
                Formats = new List<PublishFormat> { PublishFormat.Pdf, PublishFormat.Dwg }, ItemIds = new List<string> { "s1" },
                Artifacts = new List<PublishArtifact> { Art("s1", PublishFormat.Pdf, ArtifactStatus.Succeeded), Art("s1", PublishFormat.Dwg, ArtifactStatus.Failed) },
            }, null);
            Assert.True(cps.Profiles["p"]["s1"].Partial);

            // Загвар засагдсан (өөрчлөлтийн дугаар 20).  Гүйлт 2 = ЗӨВХӨН DWG-ийн дахин оролдлого, амжилттай.
            PublishCheckpointStore.Advance(cps, new PublishRun
            {
                Id = "r2", ParentRunId = "r1", ProfileId = "p", ChangeSeqAtStart = 20, DocVersionGuidAtStart = "g20", EndedUtc = new DateTime(2026, 10, 2),
                Formats = new List<PublishFormat> { PublishFormat.Pdf, PublishFormat.Dwg }, ItemIds = new List<string> { "s1" },
                Artifacts = new List<PublishArtifact> { Art("s1", PublishFormat.Dwg, ArtifactStatus.Succeeded) },
            }, null);

            SheetCheckpoint cp = cps.Profiles["p"]["s1"];
            Assert.False(cp.Partial, "хоёр формат одоо амжилттай гарсан");
            Assert.Eq(10L, cp.ChangeSeq, "PDF өөрчлөлтийн 10-тай — checkpoint хамгийн ЭРТ тэмдэгтэй (20 БИШ), эс бөгөөс 10–20-ийн засвар PDF-д ороогүй атлаа алдагдана");
            Assert.Eq("g10", cp.DocVersionGuid);
            Assert.Eq(10L, cp.Formats["pdf"].ChangeSeq);
            Assert.Eq(20L, cp.Formats["dwg"].ChangeSeq);
            Assert.Eq(new DateTime(2026, 10, 1), cp.PublishedUtc, "«гаргасан» огноо = watermark-тай ижил (хамгийн ЭРТ формат: PDF 10/1) — DWG 10/2-д гарсан ч хуудас 10/1-ээр шинэчлэгдсэн");
        }

        [Test]
        public static void Checkpoint_SkippedFormat_KeepsItsOlderStamp_WhileFreshOnesAdvance()
        {
            var cps = new PublishCheckpoints();
            var formats = new List<PublishFormat> { PublishFormat.Pdf, PublishFormat.Dwg };
            PublishCheckpointStore.Advance(cps, new PublishRun
            {
                Id = "r1", ProfileId = "p", ChangeSeqAtStart = 5, Formats = formats, ItemIds = new List<string> { "s1" },
                Artifacts = new List<PublishArtifact> { Art("s1", PublishFormat.Pdf, ArtifactStatus.Succeeded), Art("s1", PublishFormat.Dwg, ArtifactStatus.Succeeded) },
            }, null);
            // Overwrite=Skip: PDF байгаа тул алгассан, DWG шинээр гарсан.
            PublishCheckpointStore.Advance(cps, new PublishRun
            {
                Id = "r2", ProfileId = "p", ChangeSeqAtStart = 9, Formats = formats, ItemIds = new List<string> { "s1" },
                Artifacts = new List<PublishArtifact> { Art("s1", PublishFormat.Pdf, ArtifactStatus.Skipped), Art("s1", PublishFormat.Dwg, ArtifactStatus.Succeeded) },
            }, null);
            SheetCheckpoint cp = cps.Profiles["p"]["s1"];
            Assert.Eq(5L, cp.ChangeSeq, "алгассан PDF нь ШИНЭ гаргалт БИШ — хуучин тэмдэг хэвээр");
            Assert.Eq(9L, cp.Formats["dwg"].ChangeSeq);
            Assert.False(cp.Partial);
        }

        [Test]
        public static void Checkpoint_AllSkippedRun_DoesNotTouchAnything()
        {
            var cps = new PublishCheckpoints();
            cps.Profiles["p"] = new Dictionary<string, SheetCheckpoint> { { "s1", new SheetCheckpoint { RunId = "old", ChangeSeq = 5 } } };
            PublishCheckpointStore.Advance(cps, new PublishRun
            {
                Id = "r2", ProfileId = "p", ChangeSeqAtStart = 99, Formats = new List<PublishFormat> { PublishFormat.Pdf }, ItemIds = new List<string> { "s1" },
                Artifacts = new List<PublishArtifact> { Art("s1", PublishFormat.Pdf, ArtifactStatus.Skipped) },
            }, null);
            Assert.Eq("old", cps.Profiles["p"]["s1"].RunId);
            Assert.Eq(5L, cps.Profiles["p"]["s1"].ChangeSeq);
        }

        [Test]
        public static void Checkpoint_LegacyCheckpointWithoutFormats_IsSeededForEveryFormatOfTheRun()
        {
            var cps = new PublishCheckpoints();
            cps.Profiles["p"] = new Dictionary<string, SheetCheckpoint>
            {
                { "s1", new SheetCheckpoint { RunId = "legacy", ChangeSeq = 3, DocVersionGuid = "g3", PublishedUtc = new DateTime(2026, 9, 1) } },   // Formats = null (хуучин файл)
            };
            PublishCheckpointStore.Advance(cps, new PublishRun
            {
                Id = "r2", ProfileId = "p", ChangeSeqAtStart = 8, DocVersionGuidAtStart = "g8", EndedUtc = new DateTime(2026, 10, 3),
                Formats = new List<PublishFormat> { PublishFormat.Pdf, PublishFormat.Dwg }, ItemIds = new List<string> { "s1" },
                Artifacts = new List<PublishArtifact> { Art("s1", PublishFormat.Dwg, ArtifactStatus.Succeeded) },
            }, null);
            SheetCheckpoint cp = cps.Profiles["p"]["s1"];
            Assert.False(cp.Partial, "хуучин checkpoint-ийн үед БҮХ формат гарсан гэж үзнэ");
            Assert.Eq(3L, cp.ChangeSeq, "PDF хуучин (3) хэвээр");
            Assert.Eq(8L, cp.Formats["dwg"].ChangeSeq);
        }

        [Test]
        public static void LastPublishInfo_DistinguishesPartial_AndNeedsPublish()
        {
            Assert.True(LastPublishInfo.NeedsPublish(LastPublishInfo.Describe(null)));
            Assert.True(LastPublishInfo.NeedsPublish(LastPublishInfo.Describe(new SheetCheckpoint { Partial = true, PublishedUtc = DateTime.UtcNow })));
            Assert.False(LastPublishInfo.NeedsPublish(LastPublishInfo.Describe(new SheetCheckpoint { PublishedUtc = DateTime.UtcNow })));
            Assert.True(LastPublishInfo.Describe(new SheetCheckpoint { Partial = true, PublishedUtc = DateTime.UtcNow }).StartsWith(LastPublishInfo.PartialPrefix));
        }

        [Test]
        public static void Checkpoint_RoundTripsThroughJson_WithFormatStamps()
        {
            var cps = new PublishCheckpoints();
            PublishCheckpointStore.Advance(cps, new PublishRun
            {
                Id = "r1", ProfileId = "p", ChangeSeqAtStart = 7, DocVersionGuidAtStart = "g7", EndedUtc = new DateTime(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc),
                Formats = new List<PublishFormat> { PublishFormat.Pdf, PublishFormat.Dwg }, ItemIds = new List<string> { "s1" },
                Artifacts = new List<PublishArtifact> { Art("s1", PublishFormat.Pdf, ArtifactStatus.Succeeded), Art("s1", PublishFormat.Dwg, ArtifactStatus.Failed) },
            }, null);
            var back = SmartJson.Deserialize<PublishCheckpoints>(SmartJson.Serialize(cps));
            SheetCheckpoint cp = back.Profiles["p"]["s1"];
            Assert.True(cp.Partial);
            Assert.Eq(7L, cp.Formats["pdf"].ChangeSeq);
            Assert.Eq("g7", cp.Formats["pdf"].DocVersionGuid);
        }

        /* ------------------------ VALIDATOR / DWG / RACE ------------------ */

        [Test]
        [WindowsOnly("mixed / and \\ separators are only one path on Windows; on Unix \\ is an ordinary filename character")]
        public static void Validator_PathWithForwardSlashes_StillMatchesTheExactFile()
        {
            // Хавтсыг «D:/Out» гэж бичсэн — хүлээсэн зам «D:/Out\\x.dwg», файлын жагсаалтад «D:\\Out\\x.dwg».
            var before = new List<FileFacts>();
            var after = new List<FileFacts>
            {
                new FileFacts { Path = @"D:\Out\x.dwg", Length = 500, LastWriteUtc = new DateTime(2026, 10, 1) },
                new FileFacts { Path = @"D:\Out\x-xref1.dwg", Length = 100, LastWriteUtc = new DateTime(2026, 10, 1) },
            };
            ArtifactCheck c = ArtifactValidator.Validate("D:/Out\\x.dwg", before, after);
            Assert.True(c.Ok, c.Note);
            Assert.False(c.NameDiffered, "яг нэрээрээ олдсон");
        }

        [Test]
        public static void Validator_XrefSiblings_DoNotHideTheMainFile_WhenNameIsPrefixed()
        {
            // Revit хуудасны нэрэнд нэмэлт нэмж (угтвар) бичсэн + xref файлууд: хүлээсэн нэрээр ЭХЭЛСЭН ганц файл = үндсэн файл.
            var after = new List<FileFacts>
            {
                new FileFacts { Path = @"D:\Out\A-101 Plan-Sheet.dwg", Length = 500, LastWriteUtc = new DateTime(2026, 10, 1) },
                new FileFacts { Path = @"D:\Out\detail-xref.dwg", Length = 80, LastWriteUtc = new DateTime(2026, 10, 1) },
            };
            ArtifactCheck c = ArtifactValidator.Validate(@"D:\Out\A-101 Plan.dwg", new List<FileFacts>(), after);
            Assert.True(c.Ok, c.Note);
            Assert.True(c.NameDiffered);
            Assert.True(c.Path.EndsWith("A-101 Plan-Sheet.dwg"));

            // Тодорхойгүй (угтвартай хоёр шинэ файл) бол ТААМАГЛАХГҮЙ.
            var ambiguous = new List<FileFacts>
            {
                new FileFacts { Path = @"D:\Out\A-101 Plan-1.dwg", Length = 500, LastWriteUtc = new DateTime(2026, 10, 1) },
                new FileFacts { Path = @"D:\Out\A-101 Plan-2.dwg", Length = 500, LastWriteUtc = new DateTime(2026, 10, 1) },
            };
            Assert.False(ArtifactValidator.Validate(@"D:\Out\A-101 Plan.dwg", new List<FileFacts>(), ambiguous).Ok);
        }

        [Test]
        public static void Planner_Dwg_IsAlwaysOneFilePerSheet_EvenWhenMergedViewsIsOn()
        {
            // Revit-ийн `name` нь «нэг файлын нэр ЭСВЭЛ олон файлын угтвар» — нэгтгэсэн DWG гэж төлөвлөвөл `name.dwg` үүсэхгүй.
            PublishProfile p = Samples.Profile();
            p.Formats = new List<PublishFormat> { PublishFormat.Dwg };
            p.Dwg.MergedViews = true;
            PublishPlan plan = PublishPlanner.Build(p, Sheets("A-101", "A-102", "A-103"), Samples.Project(), new MemoryFileSystem().AddDir(@"D:\Out"));
            Assert.Eq(3, plan.Artifacts.Count(a => a.Format == PublishFormat.Dwg));
            Assert.True(plan.Artifacts.All(a => a.MemberIds.Count == 1 && a.ItemId != "*"), "нэг файл = нэг хуудас");
        }

        [Test]
        public static void Checkpoint_SkippedAlone_DoesNotAdvance()
        {
            var cps = new PublishCheckpoints();
            var run = new PublishRun { Id = "r", ProfileId = "p", ItemIds = new List<string> { "s1" },
                Artifacts = new List<PublishArtifact> { Art("s1", PublishFormat.Pdf, ArtifactStatus.Skipped) } };
            PublishCheckpointStore.Advance(cps, run, null);
            Assert.False(cps.Profiles.ContainsKey("p") && cps.Profiles["p"].ContainsKey("s1"));
        }

        [Test]
        public static void Checkpoint_CombinedPdf_RequiresAllFormatsOfEachMember()
        {
            var cps = new PublishCheckpoints();
            var run = new PublishRun
            {
                Id = "r", ProfileId = "p", ItemIds = new List<string> { "s1", "s2" },
                Formats = new List<PublishFormat> { PublishFormat.Pdf, PublishFormat.Dwg },
                Artifacts = new List<PublishArtifact>
                {
                    Art("*", PublishFormat.Pdf, ArtifactStatus.Succeeded, "s1", "s2"),
                    Art("s1", PublishFormat.Dwg, ArtifactStatus.Succeeded),
                    Art("s2", PublishFormat.Dwg, ArtifactStatus.Failed),
                },
            };
            PublishCheckpointStore.Advance(cps, run, null);
            Assert.False(cps.Profiles["p"]["s1"].Partial);
            Assert.True(cps.Profiles["p"]["s2"].Partial, "s2-ийн DWG унасан — нэгтгэсэн PDF амжилттай ч бүрэн гарсан БОЛОХГҮЙ");
        }

        [Test]
        public static void Checkpoint_FailedRun_KeepsPreviousCheckpoint()
        {
            var cps = new PublishCheckpoints();
            cps.Profiles["p"] = new Dictionary<string, SheetCheckpoint> { { "s1", new SheetCheckpoint { RunId = "old", ChangeSeq = 5 } } };
            var run = new PublishRun { Id = "r2", ProfileId = "p", ItemIds = new List<string> { "s1" },
                Artifacts = new List<PublishArtifact> { Art("s1", PublishFormat.Pdf, ArtifactStatus.Failed) } };
            PublishCheckpointStore.Advance(cps, run, null);
            Assert.Eq("old", cps.Profiles["p"]["s1"].RunId);
        }
    }
}
