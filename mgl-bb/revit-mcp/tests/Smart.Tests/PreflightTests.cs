using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.SmartPublish.Core;

namespace RevitMcpAddin.Smart.Tests
{
    public static class PreflightTests
    {
        private static List<PublishItem> One()
        {
            return new List<PublishItem> { Samples.Sheet("u1", "A-101", "Plan") };
        }

        private static PreflightReport Run(PublishProfile p, List<PublishItem> items, MemoryFileSystem fs, EnvironmentFacts env = null)
        {
            return PreflightEngine.Run(Samples.Pre(p, items, fs, env));
        }

        private static MemoryFileSystem GoodFs()
        {
            return new MemoryFileSystem().AddDir(@"D:\Out");
        }

        private static IEnumerable<PreflightFinding> Of(PreflightReport r, string rule)
        {
            return r.Findings.Where(f => f.RuleId == rule);
        }

        [Test]
        [WindowsOnly("Windows drive-letter paths (D:\\...): on a non-Windows OS System.IO.Path does not treat them as rooted/separated")]
        public static void Clean_Run_CanRun_NoBlockingNoWarning()
        {
            PreflightReport r = Run(Samples.Profile(), One(), GoodFs());
            Assert.True(r.CanRun, string.Join("\n", r.Findings.Select(f => f.Severity + " " + f.RuleId + " " + f.Message)));
            Assert.Eq(0, r.Warnings);
        }

        [Test]
        [WindowsOnly("Windows drive-letter paths (D:\\...): on a non-Windows OS System.IO.Path does not treat them as rooted/separated")]
        public static void EmptySet_Blocks_ButNotWhenOnlyIfc()
        {
            Assert.False(Run(Samples.Profile(), new List<PublishItem>(), GoodFs()).CanRun);
            PublishProfile ifc = Samples.Profile();
            ifc.Formats = new List<PublishFormat> { PublishFormat.Ifc };
            PreflightReport r = Run(ifc, new List<PublishItem>(), GoodFs());
            Assert.Eq(0, Of(r, PreflightIds.EmptySet).Count());
            Assert.True(r.CanRun);
        }

        [Test]
        public static void NoFormats_Blocks()
        {
            PublishProfile p = Samples.Profile();
            p.Formats = new List<PublishFormat> { PublishFormat.Unknown };
            Assert.Eq(1, Of(Run(p, One(), GoodFs()), PreflightIds.NoFormats).Count(f => f.Severity == PreflightSeverity.Blocking));
        }

        [Test]
        public static void MissingDestination_Blocks()
        {
            PublishProfile p = Samples.Profile(null);
            PreflightReport r = Run(p, One(), new MemoryFileSystem());
            Assert.False(r.CanRun);
            Assert.Eq(1, Of(r, PreflightIds.DestinationMissing).Count());
        }

        [Test]
        public static void RelativeDestination_Blocks()
        {
            PreflightReport r = Run(Samples.Profile(@"relative\path"), One(), new MemoryFileSystem());
            Assert.True(Of(r, PreflightIds.DestinationMissing).Any(f => f.Severity == PreflightSeverity.Blocking));
        }

        [Test]
        [WindowsOnly("Windows drive-letter paths (D:\\...): on a non-Windows OS System.IO.Path does not treat them as rooted/separated")]
        public static void DestinationNotExisting_CreateMissing_IsInfo_NotBlocking()
        {
            PublishProfile p = Samples.Profile(@"D:\New");
            PreflightReport r = Run(p, One(), new MemoryFileSystem().AddDir(@"D:\"));
            Assert.True(r.CanRun, string.Join("\n", r.Findings.Select(f => f.Severity + " " + f.Message)));
            Assert.True(Of(r, PreflightIds.DestinationMissing).Any(f => f.Severity == PreflightSeverity.Info));
        }

        [Test]
        public static void DestinationNotExisting_NoCreate_Blocks()
        {
            PublishProfile p = Samples.Profile(@"D:\New");
            p.Destination.CreateMissing = false;
            Assert.False(Run(p, One(), new MemoryFileSystem().AddDir(@"D:\")).CanRun);
        }

        [Test]
        public static void ReadOnlyDestination_Blocks()
        {
            var fs = GoodFs();
            fs.ReadOnlyDirs.Add(@"D:\Out");
            PreflightReport r = Run(Samples.Profile(), One(), fs);
            Assert.False(r.CanRun);
            Assert.Eq(1, Of(r, PreflightIds.DestinationNotWritable).Count());
        }

        [Test]
        [WindowsOnly("drive-root semantics (D:\\ has no parent): there is no equivalent root on a non-Windows OS")]
        public static void NewDestination_ChecksNearestExistingParentIsWritable()
        {
            var fs = new MemoryFileSystem().AddDir(@"D:\");
            fs.ReadOnlyDirs.Add(@"D:");
            PreflightReport r = Run(Samples.Profile(@"D:\a\b\c"), One(), fs);
            Assert.Eq(1, Of(r, PreflightIds.DestinationNotWritable).Count(), "эх хавтас бичигдэхгүй");
        }

        [Test]
        public static void RequiredParameter_Missing_BlocksPerSheet_WithNames()
        {
            PublishProfile p = Samples.Profile();
            p.RequiredParameters = new List<string> { "Discipline", "Zone", "Approved By" };
            PreflightReport r = Run(p, One(), GoodFs());
            PreflightFinding f = Of(r, PreflightIds.RequiredParameter).Single();
            Assert.Eq(PreflightSeverity.Blocking, f.Severity);
            Assert.True(f.Message.Contains("Zone") && f.Message.Contains("Approved By") && !f.Message.Contains("Discipline,"), f.Message);
            Assert.Eq("u1", f.ItemId);
        }

        [Test]
        public static void MissingRevision_OnlyWhenRequired()
        {
            var items = new List<PublishItem> { Samples.Sheet("u1", "A-101", "Plan", rev: null) };
            Assert.Eq(0, Of(Run(Samples.Profile(), items, GoodFs()), PreflightIds.MissingRevision).Count());
            PublishProfile p = Samples.Profile();
            p.Revision.Required = true;
            p.Naming.SheetTemplate = "{SheetNumber}";
            PreflightReport r = Run(p, items, GoodFs());
            Assert.Eq(1, Of(r, PreflightIds.MissingRevision).Count(f => f.Severity == PreflightSeverity.Blocking));
        }

        [Test]
        public static void NotPrintable_AndPlaceholder_Block()
        {
            var items = new List<PublishItem>
            {
                Samples.Sheet("u1", "A-101", "ok"),
                Samples.Sheet("u2", "A-102", "np", printable: false),
                Samples.Sheet("u3", "A-103", "ph", placeholder: true),
            };
            PreflightReport r = Run(Samples.Profile(), items, GoodFs());
            Assert.False(r.CanRun);
            Assert.Eq(1, Of(r, PreflightIds.NotPrintable).Count());
            Assert.Eq(1, Of(r, PreflightIds.PlaceholderSheet).Count());
            Assert.SeqEq(new[] { "u2", "u3" }, r.BlockedItemIds().OrderBy(x => x));
        }

        [Test]
        public static void NotPrintable_IgnoredForIfcOnly()
        {
            PublishProfile p = Samples.Profile();
            p.Formats = new List<PublishFormat> { PublishFormat.Ifc };
            var items = new List<PublishItem> { Samples.Sheet("u2", "A-102", "np", printable: false) };
            Assert.Eq(0, Of(Run(p, items, GoodFs()), PreflightIds.NotPrintable).Count());
        }

        [Test]
        public static void DuplicateSheetNumbers_Warns()
        {
            var items = new List<PublishItem> { Samples.Sheet("u1", "A-101", "x"), Samples.Sheet("u2", "a-101", "y") };
            PublishProfile p = Samples.Profile();
            p.Naming.SheetTemplate = "{SheetNumber}_{SheetName}";
            PreflightReport r = Run(p, items, GoodFs());
            Assert.Eq(2, Of(r, PreflightIds.DuplicateSheetNumbers).Count(f => f.Severity == PreflightSeverity.Warning));
        }

        [Test]
        public static void DuplicateOutputNames_Block_BySettings()
        {
            PublishProfile p = Samples.Profile();
            p.Naming.SheetTemplate = "{ProjectNumber}";
            var items = new List<PublishItem> { Samples.Sheet("u1", "A-101", "x"), Samples.Sheet("u2", "A-102", "y") };
            PreflightReport r = Run(p, items, GoodFs());
            Assert.False(r.CanRun);
            Assert.Eq(2, Of(r, PreflightIds.DuplicateNames).Count(f => f.Severity == PreflightSeverity.Blocking));
        }

        [Test]
        [WindowsOnly("Windows drive-letter paths (D:\\...): on a non-Windows OS System.IO.Path does not treat them as rooted/separated")]
        public static void DuplicateOutputNames_Suffix_IsInfoOnly()
        {
            PublishProfile p = Samples.Profile();
            p.Naming.SheetTemplate = "{ProjectNumber}";
            p.Naming.Duplicates = DuplicateNamePolicy.Suffix;
            var items = new List<PublishItem> { Samples.Sheet("u1", "A-101", "x"), Samples.Sheet("u2", "A-102", "y") };
            PreflightReport r = Run(p, items, GoodFs());
            Assert.True(r.CanRun);
            Assert.Eq(1, Of(r, PreflightIds.DuplicateNames).Count(f => f.Severity == PreflightSeverity.Info));
        }

        [Test]
        public static void InvalidTemplate_Blocks_WithHint()
        {
            PublishProfile p = Samples.Profile();
            p.Naming.SheetTemplate = "{Nope}";
            PreflightReport r = Run(p, One(), GoodFs());
            Assert.False(r.CanRun);
            Assert.Eq(1, Of(r, PreflightIds.TemplateInvalid).Count());
        }

        [Test]
        [WindowsOnly("Windows drive-letter paths (D:\\...): on a non-Windows OS System.IO.Path does not treat them as rooted/separated")]
        public static void MissingToken_Error_Blocks_Empty_IsInfo()
        {
            PublishProfile p = Samples.Profile();
            p.Naming.SheetTemplate = "{SheetNumber}_{Param:Zone}";
            Assert.False(Run(p, One(), GoodFs()).CanRun);
            p.Naming.OnMissing = MissingTokenPolicy.Empty;
            PreflightReport r = Run(p, One(), GoodFs());
            Assert.True(r.CanRun);
            Assert.Eq(PreflightSeverity.Info, Of(r, PreflightIds.MissingToken).Single().Severity);
        }

        [Test]
        public static void EmptyFilename_AlwaysBlocks_EvenWithEmptyPolicy()
        {
            PublishProfile p = Samples.Profile();
            p.Naming.SheetTemplate = "{Param:Zone}";
            p.Naming.OnMissing = MissingTokenPolicy.Empty;
            PreflightReport r = Run(p, One(), GoodFs());
            Assert.False(r.CanRun);
            Assert.Eq(1, Of(r, PreflightIds.EmptyFilename).Count());
        }

        [Test]
        [WindowsOnly("Windows drive-letter paths (D:\\...): on a non-Windows OS System.IO.Path does not treat them as rooted/separated")]
        public static void SeverityOverride_CanDowngrade_Downgradable_ButNotStructural()
        {
            PublishProfile p = Samples.Profile();
            p.Naming.SheetTemplate = "{SheetNumber}_{Param:Zone}";
            p.SeverityOverrides[PreflightIds.MissingToken] = PreflightSeverity.Warning;     // downgradable
            p.SeverityOverrides[PreflightIds.EmptySet] = PreflightSeverity.Info;            // structural: хэвээр Blocking
            PreflightReport r = Run(p, new List<PublishItem>(), GoodFs());
            Assert.Eq(PreflightSeverity.Blocking, Of(r, PreflightIds.EmptySet).Single().Severity);

            PreflightReport r2 = Run(p, One(), GoodFs());
            Assert.Eq(PreflightSeverity.Warning, Of(r2, PreflightIds.MissingToken).Single().Severity);
            Assert.True(r2.CanRun);
        }

        [Test]
        public static void SeverityOverride_CanEscalate()
        {
            PublishProfile p = Samples.Profile();
            p.Overwrite = OverwriteMode.Overwrite;
            p.SeverityOverrides[PreflightIds.OverwriteConflict] = PreflightSeverity.Blocking;
            var fs = GoodFs().AddFile(@"D:\Out\PDF\A-101_Plan_A.pdf");
            PreflightReport r = Run(p, One(), fs);
            Assert.False(r.CanRun);
        }

        [Test]
        [WindowsOnly("Windows drive-letter paths (D:\\...): on a non-Windows OS System.IO.Path does not treat them as rooted/separated")]
        public static void OverwriteConflict_Severities_ByMode()
        {
            Func<OverwriteMode, PreflightSeverity?> sev = mode =>
            {
                PublishProfile p = Samples.Profile();
                p.Overwrite = mode;
                var fs = GoodFs().AddFile(@"D:\Out\PDF\A-101_Plan_A.pdf");
                PreflightReport r = Run(p, One(), fs);
                PreflightFinding f = Of(r, PreflightIds.OverwriteConflict).FirstOrDefault();
                return f == null ? (PreflightSeverity?)null : f.Severity;
            };
            Assert.Eq(PreflightSeverity.Blocking, sev(OverwriteMode.Fail).Value);
            Assert.Eq(PreflightSeverity.Warning, sev(OverwriteMode.Overwrite).Value);
            Assert.Eq(PreflightSeverity.Info, sev(OverwriteMode.Skip).Value);
            Assert.Eq(PreflightSeverity.Info, sev(OverwriteMode.Version).Value);
        }

        [Test]
        [WindowsOnly("Windows drive-letter paths (D:\\...): on a non-Windows OS System.IO.Path does not treat them as rooted/separated")]
        public static void Dwg_Setup_Checks()
        {
            PublishProfile p = Samples.Profile();
            p.Formats = new List<PublishFormat> { PublishFormat.Dwg };

            // Тохиргооны нэргүй — Info.
            PreflightReport none = Run(p, One(), GoodFs());
            Assert.Eq(PreflightSeverity.Info, Of(none, PreflightIds.DwgSetup).Single().Severity);

            // Байхгүй нэр — Blocking.
            p.Dwg.SetupName = "Company A";
            var env = new EnvironmentFacts();
            env.DwgSetupNames.Add("Other");
            Assert.False(Run(p, One(), GoodFs(), env).CanRun);

            // Байгаа нэр (үсгийн том/жижиг үл хамаарна).
            env.DwgSetupNames.Add("company a");
            Assert.True(Run(p, One(), GoodFs(), env).CanRun);

            // Модуль байхгүй.
            env.DwgModuleAvailable = false;
            Assert.False(Run(p, One(), GoodFs(), env).CanRun);
        }

        [Test]
        [WindowsOnly("Windows drive-letter paths (D:\\...): on a non-Windows OS System.IO.Path does not treat them as rooted/separated")]
        public static void Ifc_FilterView_MustExist()
        {
            PublishProfile p = Samples.Profile();
            p.Formats = new List<PublishFormat> { PublishFormat.Ifc };
            p.Ifc.FilterViewName = "IFC Export";
            var env = new EnvironmentFacts();
            Assert.False(Run(p, One(), GoodFs(), env).CanRun);
            env.ThreeDViewNames.Add("IFC Export");
            PreflightReport r = Run(p, One(), GoodFs(), env);
            Assert.True(r.CanRun);
            Assert.True(Of(r, PreflightIds.IfcOptions).Any(f => f.Severity == PreflightSeverity.Info && f.Message.Contains("ЗАГВАР")));
        }

        [Test]
        public static void FamilyDocument_Blocks()
        {
            var env = new EnvironmentFacts { IsFamilyDocument = true };
            Assert.False(Run(Samples.Profile(), One(), GoodFs(), env).CanRun);
        }

        [Test]
        [WindowsOnly("Windows drive-letter paths (D:\\...): on a non-Windows OS System.IO.Path does not treat them as rooted/separated")]
        public static void InvalidPdfSettings_Warn()
        {
            var env = new EnvironmentFacts();
            env.InvalidPdfSettings.Add("Orientation=Sideways");
            PreflightReport r = Run(Samples.Profile(), One(), GoodFs(), env);
            Assert.True(r.CanRun);
            Assert.Eq(1, Of(r, PreflightIds.PdfSettings).Count(f => f.Severity == PreflightSeverity.Warning));
        }

        [Test]
        public static void CombinedPdf_GivesIsolationNote()
        {
            PublishProfile p = Samples.Profile();
            p.Pdf.Combine = true;
            var items = new List<PublishItem> { Samples.Sheet("1", "A-101", "x"), Samples.Sheet("2", "A-102", "y") };
            Assert.Eq(1, Of(Run(p, items, GoodFs()), PreflightIds.CombinedPdf).Count());
        }

        [Test]
        public static void Findings_AreOrdered_BlockingFirst()
        {
            PublishProfile p = Samples.Profile();
            p.Overwrite = OverwriteMode.Overwrite;
            var fs = GoodFs().AddFile(@"D:\Out\PDF\A-101_Plan_A.pdf");
            var items = new List<PublishItem> { Samples.Sheet("u1", "A-101", "Plan"), Samples.Sheet("u2", "A-102", "np", printable: false) };
            PreflightReport r = Run(p, items, fs);
            Assert.Eq(PreflightSeverity.Blocking, r.Findings[0].Severity);
            Assert.Eq(PreflightSeverity.Info <= r.Findings.Last().Severity, true);
            for (int i = 1; i < r.Findings.Count; i++)
                Assert.True(r.Findings[i - 1].Severity >= r.Findings[i].Severity, "эрэмбэ буурах ёстой");
        }

        private sealed class ThrowingRule : IPreflightRule
        {
            public string Id { get { return "boom"; } }
            public bool Downgradable { get { return true; } }
            public IEnumerable<PreflightFinding> Evaluate(PreflightContext c) { throw new InvalidOperationException("x"); }
        }

        [Test]
        [WindowsOnly("Windows drive-letter paths (D:\\...): on a non-Windows OS System.IO.Path does not treat them as rooted/separated")]
        public static void ThrowingRule_IsReported_AndDoesNotStopOthers()
        {
            var rules = new List<IPreflightRule>(PreflightEngine.DefaultRules) { new ThrowingRule() };
            PreflightReport r = PreflightEngine.Run(Samples.Pre(Samples.Profile(), One(), GoodFs()), rules);
            Assert.True(r.CanRun, "дүрмийн өөрийнх нь алдаа Blocking биш");
            PreflightFinding f = r.Findings.Single(x => x.RuleId == "boom");
            Assert.Eq(PreflightSeverity.Warning, f.Severity);
        }

        [Test]
        public static void LargeSet_IsInfo()
        {
            var items = Enumerable.Range(0, 160).Select(i => Samples.Sheet("u" + i, "A-" + i, "Plan " + i)).ToList();
            PreflightReport r = Run(Samples.Profile(), items, GoodFs());
            Assert.Eq(PreflightSeverity.Info, Of(r, PreflightIds.LargeSet).Single().Severity);
        }

        [Test]
        public static void DestinationTooLongPath_Blocks()
        {
            PublishProfile p = Samples.Profile(@"D:\" + new string('x', 230));
            p.Naming.SheetTemplate = "{SheetName}";
            var items = new List<PublishItem> { Samples.Sheet("1", "A", new string('Ө', 100)) };
            PreflightReport r = Run(p, items, new MemoryFileSystem().AddDir(@"D:\"));
            Assert.Eq(1, Of(r, PreflightIds.PathTooLong).Count());
            Assert.False(r.CanRun);
        }
    }
}
