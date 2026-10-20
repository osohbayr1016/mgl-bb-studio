using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.Smart.Core;
using RevitMcpAddin.SmartPublish.Core;

namespace RevitMcpAddin.Smart.Tests
{
    /// <summary>
    /// Production audit-ийн 2-р хараат бус хяналтын Publish-ийн олдворууд: IFC checkpoint, профайлд холбох, төлөвлөгөө ↔ диск уралдаан,
    /// дахин оролдлого (ӨӨРИЙН хэсэгчилсэн файл, бүх хуудсаар төлөвлөх), «бүрэн гаргалт» хүрээ.
    /// </summary>
    public static class PublishAuditTests
    {
        private const string G = "guid-1";

        private static PublishArtifact Art(string item, PublishFormat f, ArtifactStatus s, params string[] members)
        {
            return new PublishArtifact { ItemId = item, Format = f, Status = s, MemberIds = members.ToList() };
        }

        private static PublishItem Sheet(string uid, long id, string number)
        {
            return new PublishItem { Id = uid, ElementIdValue = id, Kind = PublishItemKind.Sheet, Number = number, Name = "Sheet " + number };
        }

        private static WatermarkAnalysis Analysis(long watermark)
        {
            return new WatermarkAnalysis { Watermark = watermark, Report = new ImpactReport { SourceCount = 5, Status = RunStatus.Succeeded } };
        }

        private static FormatStamp Stamp(long seq)
        {
            return new FormatStamp { RunId = "r" + seq, ChangeSeq = seq, Utc = new DateTime(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc).AddMinutes(seq), DocVersionGuid = G };
        }

        private static SheetCheckpoint PdfOnlyCheckpoint(long seq = 5)
        {
            return new SheetCheckpoint
            {
                ChangeSeq = seq, DocVersionGuid = G, PublishedUtc = new DateTime(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc),
                Formats = new Dictionary<string, FormatStamp> { { "pdf", Stamp(seq) } },
            };
        }

        /* ------------------------ IFC ≠ ХУУДАСНЫ ФОРМАТ ------------------- */

        [Test]
        public static void Checkpoint_PdfPlusIfcProfile_SheetIsCompleteOnceItsPdfSucceeds()
        {
            var cps = new PublishCheckpoints();
            var run = new PublishRun
            {
                Id = "r1", ProfileId = "p", ChangeSeqAtStart = 7, DocVersionGuidAtStart = G, EndedUtc = new DateTime(2026, 10, 1),
                Formats = new List<PublishFormat> { PublishFormat.Pdf, PublishFormat.Ifc },   // Authority Submission / Archive жишээ профайл
                ItemIds = new List<string> { "s1", "s2" },
                Artifacts = new List<PublishArtifact>
                {
                    Art("s1", PublishFormat.Pdf, ArtifactStatus.Succeeded),
                    Art("s2", PublishFormat.Pdf, ArtifactStatus.Succeeded),
                    Art("*", PublishFormat.Ifc, ArtifactStatus.Succeeded),      // загварын түвшний ГАНЦ файл, гишүүнгүй
                },
            };
            PublishCheckpointStore.Advance(cps, run, null);
            SheetCheckpoint s1 = cps.Profiles["p"]["s1"];
            Assert.False(s1.Partial, "IFC нь хуудасны формат БИШ — PDF гарсан хуудас «бүрэн гарсан»");
            Assert.Eq(7L, s1.ChangeSeq);
            Assert.False(s1.Formats.ContainsKey("ifc"), "IFC нь хуудасны checkpoint-д тэмдэг үүсгэхгүй");
            Assert.False(cps.Profiles["p"]["s2"].Partial);
        }

        [Test]
        public static void Checkpoint_IfcOnlyProfile_WritesNoSheetCheckpoint()
        {
            var cps = new PublishCheckpoints();
            PublishCheckpointStore.Advance(cps, new PublishRun
            {
                Id = "r1", ProfileId = "p", Formats = new List<PublishFormat> { PublishFormat.Ifc }, ItemIds = new List<string> { "s1" },
                Artifacts = new List<PublishArtifact> { Art("*", PublishFormat.Ifc, ArtifactStatus.Succeeded) },
            }, null);
            Assert.False(cps.Profiles.ContainsKey("p") && cps.Profiles["p"].ContainsKey("s1"), "IFC ганцаараа ямар ч хуудсыг «гаргасан» болгохгүй");
        }

        [Test]
        public static void Checkpoint_IfcArtifact_IsNeverCountedEvenIfItCarriesMembers()
        {
            // Хамгаалалт: ирээдүйд IFC артифакт гишүүнтэй болсон ч хуудасны checkpoint-ийн «шаардлагатай формат» болохгүй.
            var cps = new PublishCheckpoints();
            PublishCheckpointStore.Advance(cps, new PublishRun
            {
                Id = "r1", ProfileId = "p", Formats = new List<PublishFormat> { PublishFormat.Pdf, PublishFormat.Ifc }, ItemIds = new List<string> { "s1" },
                Artifacts = new List<PublishArtifact>
                {
                    Art("s1", PublishFormat.Pdf, ArtifactStatus.Succeeded),
                    Art("*", PublishFormat.Ifc, ArtifactStatus.Failed, "s1"),
                },
            }, null);
            SheetCheckpoint cp = cps.Profiles["p"]["s1"];
            Assert.False(cp.Partial);
            Assert.False(cp.Formats.ContainsKey("ifc"));
        }

        [Test]
        public static void SheetFormats_DropsIfcAndUnknown_AndFormatsKeyIsStable()
        {
            Assert.SeqEq(new[] { PublishFormat.Pdf, PublishFormat.Dwg },
                PublishCheckpointStore.SheetFormats(new[] { PublishFormat.Pdf, PublishFormat.Ifc, PublishFormat.Unknown, PublishFormat.Dwg, PublishFormat.Pdf }));
            Assert.Eq("dwg+pdf", PublishCheckpointStore.FormatsKey(new[] { PublishFormat.Pdf, PublishFormat.Dwg }), "дарааллаас хамааралгүй");
            Assert.Eq("dwg+pdf", PublishCheckpointStore.FormatsKey(new[] { PublishFormat.Dwg, PublishFormat.Pdf, PublishFormat.Ifc }), "IFC ордоггүй");
            Assert.Eq("", PublishCheckpointStore.FormatsKey(null));
            Assert.Eq("", PublishCheckpointStore.FormatsKey(new[] { PublishFormat.Ifc }));
        }

        /* ----------------- ПРОФАЙЛД ФОРМАТ НЭМЭГДЭХ / ПРОФАЙЛД ХОЛБОХ ----------------- */

        [Test]
        public static void MissingFormats_ListsOnlySheetFormatsAbsentFromTheStamps_AndSkipsLegacy()
        {
            SheetCheckpoint cp = PdfOnlyCheckpoint();
            Assert.SeqEq(new[] { PublishFormat.Dwg }, PublishCheckpointStore.MissingFormats(cp, new[] { PublishFormat.Pdf, PublishFormat.Dwg, PublishFormat.Ifc }));
            Assert.Eq(0, PublishCheckpointStore.MissingFormats(cp, new[] { PublishFormat.Pdf }).Count);
            Assert.Eq(0, PublishCheckpointStore.MissingFormats(null, new[] { PublishFormat.Dwg }).Count);
            // Формат тэмдэггүй хуучин checkpoint: тэр үеийн форматыг мэдэх боломжгүй — шүүхгүй (өмнөх зан төлөв).
            Assert.Eq(0, PublishCheckpointStore.MissingFormats(new SheetCheckpoint { ChangeSeq = 5 }, new[] { PublishFormat.Pdf, PublishFormat.Dwg }).Count);
        }

        [Test]
        public static void Resolve_ProfileGainedAFormat_TreatsTheOldCheckpointAsNeverPublished_WithReason()
        {
            var items = new List<PublishItem> { Sheet("u1", 1, "A-101") };
            var cps = new Dictionary<string, SheetCheckpoint> { { "u1", PdfOnlyCheckpoint() } };

            // Профайл «PDF-only» хэвээр: шинжилгээ хэвийн.
            AffectedPublishSet same = AffectedPublishResolver.Resolve(items, cps, new[] { Analysis(5) }, G, null, "p", new[] { PublishFormat.Pdf });
            Assert.Eq(AffectState.NoImpactFound, same.Get("u1").State);

            // Дараа нь профайлд DWG нэмэгдсэн: DWG хэзээ ч гараагүй тул «PDF-ийн checkpoint»-оор «шинэчлэгдсэн» гэж үзэх ёсгүй.
            AffectedPublishSet gained = AffectedPublishResolver.Resolve(items, cps, new[] { Analysis(5) }, G, null, "p", new[] { PublishFormat.Pdf, PublishFormat.Dwg });
            Assert.Eq(AffectState.NeverPublished, gained.Get("u1").State);
            Assert.True(gained.Get("u1").Reasons[0].Contains("DWG"), gained.Get("u1").Reasons[0]);
            Assert.True(gained.AffectedIds().Contains("u1"), "«нөлөөлөгдсөн» сонголтод орно");
        }

        [Test]
        public static void Resolve_BindsProfileAndFormats_AppliesToOnlyThatCombination()
        {
            var items = new List<PublishItem> { Sheet("u1", 1, "A-101") };
            AffectedPublishSet set = AffectedPublishResolver.Resolve(items, new Dictionary<string, SheetCheckpoint>(), new List<WatermarkAnalysis>(), null, null,
                "profile-A", new[] { PublishFormat.Pdf, PublishFormat.Ifc });
            Assert.Eq("profile-A", set.ProfileId);
            Assert.True(set.AppliesTo("profile-A", new[] { PublishFormat.Pdf }), "IFC нь багцад ордоггүй");
            Assert.True(set.AppliesTo("profile-A", new[] { PublishFormat.Ifc, PublishFormat.Pdf }));
            Assert.False(set.AppliesTo("profile-B", new[] { PublishFormat.Pdf }), "ӨӨР профайл");
            Assert.False(set.AppliesTo("profile-A", new[] { PublishFormat.Pdf, PublishFormat.Dwg }), "формат нэмэгдсэн");
            Assert.False(set.AppliesTo(null, new[] { PublishFormat.Pdf }));

            // Профайлд холбоогүй (хуучин/гараар бүтээсэн) шинжилгээ ХЭЗЭЭ Ч хүчинтэй гэж үзэгдэхгүй.
            Assert.False(new AffectedPublishSet().AppliesTo("profile-A", new[] { PublishFormat.Pdf }));
        }

        [Test]
        public static void LastPublishInfo_ProfileGainedAFormat_IsPartialAndNamesTheMissingFormat()
        {
            SheetCheckpoint cp = PdfOnlyCheckpoint();
            string d = LastPublishInfo.Describe(cp, new[] { PublishFormat.Pdf, PublishFormat.Dwg });
            Assert.True(d.StartsWith(LastPublishInfo.PartialPrefix), d);
            Assert.True(d.Contains("DWG дутуу"), d);
            Assert.True(LastPublishInfo.NeedsPublish(d));

            // IFC нь хуудсыг «хэсэгчлэн» болгохгүй.
            Assert.False(LastPublishInfo.NeedsPublish(LastPublishInfo.Describe(cp, new[] { PublishFormat.Pdf, PublishFormat.Ifc })));
            // Формат өгөөгүй дуудлага (хуучин) өмнөх зан төлөвтэй.
            Assert.False(LastPublishInfo.NeedsPublish(LastPublishInfo.Describe(cp)));
        }

        /* ------------------- ТӨЛӨВЛӨГӨӨ ↔ ДИСК УРАЛДАА -------------------- */

        [Test]
        [WindowsOnly("Windows drive-letter paths (D:\\...): on a non-Windows OS System.IO.Path does not treat them as rooted/separated")]
        public static void Race_VersionedTargetAppearingAfterPlanning_IsDetected()
        {
            // Эх файл байсан → planner `_v2` сонгосон (`TargetExists` = true нь ЭХ нэрийнх).  Дараа нь өөр хэрэглэгч `_v2`-ийг үүсгэсэн.
            var fs = new MemoryFileSystem().AddDir(@"D:\Out").AddFile(@"D:\Out\PDF\A-101.pdf", 10);
            PublishProfile p = Samples.Profile();
            p.Naming.SheetTemplate = "{SheetNumber}";
            PublishPlan plan = PublishPlanner.Build(p, new List<PublishItem> { Samples.Sheet("u0", "A-101", "Plan") }, Samples.Project(), fs);
            PlannedArtifact pa = plan.Artifacts.Single();
            Assert.Eq(PlanAction.Versioned, pa.Action);
            Assert.True(pa.TargetExists, "эх нэр байсан");
            Assert.Eq("A-101_v2", pa.FileBaseName);

            Assert.False(PublishRace.TargetAppeared(pa.Action, () => fs.FileExists(pa.FullPath), false), "`_v2` чөлөөтэй — гаргана");
            fs.AddFile(@"D:\Out\PDF\A-101_v2.pdf", 10);
            Assert.True(PublishRace.TargetAppeared(pa.Action, () => fs.FileExists(pa.FullPath), false),
                "`_v2` хойно үүссэн — ХУУЧИН нөхцөл (`!TargetExists`) үүнийг алгасаж өөр хүний файлыг дарж байв");
        }

        [Test]
        public static void Race_OverwriteAndSkipAreNotGuarded_ExportAndVersionedAre()
        {
            Assert.True(PublishRace.MustBeAbsent(PlanAction.Export));
            Assert.True(PublishRace.MustBeAbsent(PlanAction.Versioned));
            Assert.False(PublishRace.MustBeAbsent(PlanAction.Overwrite), "дарж бичих нь төлөвлөгөөт");
            Assert.False(PublishRace.MustBeAbsent(PlanAction.SkipExisting));
        }

        [Test]
        public static void Race_KnownPartialIsExempt_AndDiskIsOnlyTouchedWhenItMatters()
        {
            Assert.False(PublishRace.TargetAppeared(PlanAction.Export, () => true, true), "дахин оролдлогын ӨӨРИЙН хэсэгчилсэн файл");
            Assert.True(PublishRace.TargetAppeared(PlanAction.Export, () => true, false));
            Assert.False(PublishRace.TargetAppeared(PlanAction.Export, () => false, false));

            int calls = 0;
            Func<bool> counting = () => { calls++; return true; };
            PublishRace.TargetAppeared(PlanAction.Overwrite, counting, false);
            PublishRace.TargetAppeared(PlanAction.SkipExisting, counting, false);
            PublishRace.TargetAppeared(PlanAction.Export, counting, true);
            Assert.Eq(0, calls, "шаардлагагүй үед диск рүү хандахгүй");
        }

        /* ------------------ «ЭНЭ ЭКСПОРТОООР ҮҮССЭН» ФАЙЛ -------------------- */

        private static readonly DateTime T0 = new DateTime(2026, 1, 1, 0, 0, 5, DateTimeKind.Utc);

        [Test]
        public static void Validator_Fresh_DistinguishesOursFromAPreExistingFile()
        {
            var old = new FileFacts { Path = @"D:\o\a.pdf", Length = 500, LastWriteUtc = T0 };
            ArtifactCheck stale = ArtifactValidator.Validate(@"D:\o\a.pdf", new[] { old }, new[] { old });
            Assert.False(stale.Ok);
            Assert.False(stale.Fresh, "экспортоос өмнө байсан, шинэчлэгдээгүй файл манайх БИШ");

            ArtifactCheck created = ArtifactValidator.Validate(@"D:\o\a.pdf", new FileFacts[0], new[] { new FileFacts { Path = @"D:\o\a.pdf", Length = 10, LastWriteUtc = T0 } });
            Assert.True(created.Ok && created.Fresh);

            ArtifactCheck empty = ArtifactValidator.Validate(@"D:\o\a.pdf", new FileFacts[0], new[] { new FileFacts { Path = @"D:\o\a.pdf", Length = 0, LastWriteUtc = T0 } });
            Assert.False(empty.Ok);
            Assert.True(empty.Fresh, "0 байт ч ШИНЭЭР үүссэн файл = манай үлдэгдэл");

            ArtifactCheck rewritten = ArtifactValidator.Validate(@"D:\o\a.pdf", new[] { old },
                new[] { new FileFacts { Path = @"D:\o\a.pdf", Length = 700, LastWriteUtc = T0.AddSeconds(30) } });
            Assert.True(rewritten.Ok && rewritten.Fresh, "шинэчлэгдсэн (хэмжээ/цаг өөр) файл");
        }

        [Test]
        public static void Classify_FailureWithAStaleFile_DoesNotClaimItAsOurPartial()
        {
            var old = new FileFacts { Path = @"D:\o\a.pdf", Length = 500, LastWriteUtc = T0 };
            ArtifactCheck stale = ArtifactValidator.Validate(@"D:\o\a.pdf", new[] { old }, new[] { old });
            ExportOutcome o = ExportOutcome.Fail(PublishFailureCode.ExportException, "boom", null, retryable: true, called: true);
            ArtifactVerdict v = ArtifactClassifier.Classify(o, stale, @"D:\o\a.pdf", 1);
            Assert.Null(v.PartialPath, "өөр хүний/хуучин файлыг дахин оролдлого дарж бичих ёсгүй");
            Assert.Eq(0, v.Notes.Count, "«файл үүссэн» гэсэн худал тэмдэглэл гарах ёсгүй");
            Assert.Eq(@"D:\o\a.pdf", v.Path, "төлөвлөсөн зам хэвээр");
        }

        [Test]
        public static void Classify_FreshPartialFile_IsRecordedAsOurPartial_OnEveryFailurePath()
        {
            var fresh = new ArtifactCheck { Ok = false, Fresh = true, Code = PublishFailureCode.EmptyArtifact, Path = @"D:\o\partial.pdf", Length = 0 };

            // 1) Адаптер exception.
            ArtifactVerdict ex = ArtifactClassifier.Classify(ExportOutcome.Fail(PublishFailureCode.ExportException, "boom", null, true, true), fresh, @"D:\o\a.pdf", 1);
            Assert.Eq(@"D:\o\partial.pdf", ex.PartialPath);

            // 2) Revit `false`.
            ArtifactVerdict rejected = ArtifactClassifier.Classify(new ExportOutcome { Called = true, RevitSaidTrue = false },
                new ArtifactCheck { Ok = true, Path = @"D:\o\a.pdf", Length = 900, LastWriteUtc = T0 }, @"D:\o\a.pdf", 3);
            Assert.Eq(@"D:\o\a.pdf", rejected.PartialPath);

            // 3) Revit `true` ч файл хоосон.
            ArtifactVerdict empty = ArtifactClassifier.Classify(ExportOutcome.Ok(), fresh, @"D:\o\a.pdf", 1);
            Assert.Eq(PublishFailureCode.EmptyArtifact, empty.Code);
            Assert.Eq(@"D:\o\partial.pdf", empty.PartialPath);

            // Амжилттай үед PartialPath байхгүй.
            ArtifactVerdict ok = ArtifactClassifier.Classify(ExportOutcome.Ok(), new ArtifactCheck { Ok = true, Fresh = true, Path = @"D:\o\a.pdf", Length = 5 }, @"D:\o\a.pdf", 1);
            Assert.Null(ok.PartialPath);
        }

        /* ------------------------------ RETRY ----------------------------- */

        [Test]
        public static void Retry_OwnPartialPaths_AreOnlyThoseThisRunLeft()
        {
            var run = new PublishRun
            {
                Artifacts = new List<PublishArtifact>
                {
                    new PublishArtifact { ItemId = "s1", Format = PublishFormat.Pdf, Status = ArtifactStatus.Failed, Path = @"D:\Out\PDF\s1.pdf", PartialPath = @"D:\Out\PDF\s1.pdf" },
                    // TargetChanged: `Path` нь өөр хүний файл — энэ гүйлт юу ч үлдээгээгүй.
                    new PublishArtifact { ItemId = "s2", Format = PublishFormat.Pdf, Status = ArtifactStatus.Failed, Path = @"D:\Out\PDF\s2.pdf" },
                    new PublishArtifact { ItemId = "s3", Format = PublishFormat.Pdf, Status = ArtifactStatus.Succeeded, Path = @"D:\Out\PDF\s3.pdf" },
                    new PublishArtifact { ItemId = "s4", Format = PublishFormat.Pdf, Status = ArtifactStatus.Cancelled },
                    new PublishArtifact { ItemId = "s5", Format = PublishFormat.Pdf, Status = ArtifactStatus.Failed, PartialPath = @"D:\Out\PDF\S1.PDF" },   // ижил файл, том үсгээр
                },
            };
            Assert.SeqEq(new[] { @"D:\Out\PDF\s1.pdf" }, PublishRetry.OwnPartialPaths(run), "давхардал (том/жижиг үсэг) нэг болно, `Path` ороогүй");
        }

        [Test]
        [WindowsOnly("mixed / and \\ separators are only one path on Windows; on Unix \\ is an ordinary filename character")]
        public static void Retry_HidingFileSystem_MatchesPathsRegardlessOfSeparatorsAndCase()
        {
            var fs = new MemoryFileSystem().AddDir(@"D:\Out").AddFile(@"D:\Out\PDF\A-101.pdf", 10).AddFile(@"D:\Out\PDF\A-102.pdf", 10);
            // Түүхэнд «/»-тэй хавтастай бичигдсэн зам ↔ файлын жагсаалтад «\»-тэй зам.
            var hiding = new PublishRetry.HidingFileSystem(fs, new[] { "D:/Out/pdf/A-101.pdf" });
            Assert.False(hiding.FileExists(@"D:\Out\PDF\A-101.pdf"), "нуугдсан");
            Assert.True(hiding.FileExists(@"D:\Out\PDF\A-102.pdf"), "бусад файл харагдана");
            Assert.Null(hiding.GetFile(@"D:\Out\PDF\A-101.pdf"));
            Assert.SeqEq(new[] { @"D:\Out\PDF\A-102.pdf" }, hiding.ListFiles(@"D:\Out\PDF").Select(f => f.Path));
        }

        [Test]
        public static void Classify_EveryFreshPartialBranch_RecordsTheFileFingerprint()
        {
            DateTime when = T0.AddMinutes(7);
            var fresh = new ArtifactCheck { Ok = false, Fresh = true, Code = PublishFailureCode.EmptyArtifact, Path = @"D:\o\p.pdf", Length = 0, LastWriteUtc = when };

            ArtifactVerdict thrown = ArtifactClassifier.Classify(ExportOutcome.Fail(PublishFailureCode.ExportException, "boom", null, true, true), fresh, @"D:\o\a.pdf", 1);
            Assert.Eq(0L, thrown.SizeBytes);
            Assert.Eq(when, thrown.CreatedUtc.Value, "exception салаа: файлын өөрчилсөн цаг");

            ArtifactVerdict rejected = ArtifactClassifier.Classify(new ExportOutcome { Called = true, RevitSaidTrue = false },
                new ArtifactCheck { Ok = true, Fresh = true, Path = @"D:\o\a.pdf", Length = 900, LastWriteUtc = when }, @"D:\o\a.pdf", 3);
            Assert.Eq(900L, rejected.SizeBytes);
            Assert.Eq(when, rejected.CreatedUtc.Value);

            ArtifactVerdict empty = ArtifactClassifier.Classify(ExportOutcome.Ok(), fresh, @"D:\o\a.pdf", 1);
            Assert.Eq(when, empty.CreatedUtc.Value, "«Revit true ч файл хоосон» салаа ч хурууны хээтэй (өмнө нь хоосон байв)");

            // Хуучин (шинэчлэгдээгүй) файл манай үлдэгдэл БИШ → хурууны хээ ч бичигдэхгүй.
            var stale = new ArtifactCheck { Ok = false, Fresh = false, Code = PublishFailureCode.MissingArtifact, Path = @"D:\o\a.pdf", Length = 500, LastWriteUtc = when };
            ArtifactVerdict old = ArtifactClassifier.Classify(ExportOutcome.Ok(), stale, @"D:\o\a.pdf", 1);
            Assert.Null(old.PartialPath);
            Assert.Null(old.CreatedUtc);
        }

        [Test]
        public static void Retry_CarryForwardPartial_KeepsOurFileWhenTheRetryNeverTouchedIt()
        {
            string p = @"D:\Out\PDF\A-102.pdf";
            var fs = new MemoryFileSystem().AddDir(@"D:\Out").AddFile(p, 300, T0);
            var known = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { PathKey.Of(p) };

            // Түгжигдсэн файл (`OutputLocked`) гэх мэт: энэ оролдлого файлд хүрээгүй → `PartialPath` байхгүй.
            var failed = new PublishArtifact { ItemId = "s1", Format = PublishFormat.Pdf, Status = ArtifactStatus.Failed, Path = p };
            PublishRetry.CarryForwardPartial(failed, p, known, fs);
            Assert.Eq(p, failed.PartialPath, "өмнөх оролдлогын файл дараагийн оролдлогод ДАМЖИНА");
            Assert.Eq(300L, failed.SizeBytes);
            Assert.Eq(T0, failed.CreatedUtc.Value);
            Assert.Eq(1, failed.Notes.Count);

            // Хэрэглэгч цуцалсан (оролдоогүй) артифакт ч мөн.
            var cancelled = new PublishArtifact { ItemId = "s1", Format = PublishFormat.Pdf, Status = ArtifactStatus.Cancelled, Path = p };
            PublishRetry.CarryForwardPartial(cancelled, p, known, fs);
            Assert.Eq(p, cancelled.PartialPath);

            // Энэ оролдлого өөрөө (шинээр) файл үлдээсэн бол хөндөхгүй.
            var rewrote = new PublishArtifact { ItemId = "s1", Format = PublishFormat.Pdf, Status = ArtifactStatus.Failed, Path = p, PartialPath = @"D:\Out\PDF\other.pdf", SizeBytes = 7 };
            PublishRetry.CarryForwardPartial(rewrote, p, known, fs);
            Assert.Eq(@"D:\Out\PDF\other.pdf", rewrote.PartialPath);
            Assert.Eq(7L, rewrote.SizeBytes);

            // Амжилттай / алгассан артифакт дамжуулахгүй.
            var ok = new PublishArtifact { ItemId = "s1", Format = PublishFormat.Pdf, Status = ArtifactStatus.Succeeded, Path = p };
            PublishRetry.CarryForwardPartial(ok, p, known, fs);
            Assert.Null(ok.PartialPath);
            var skipped = new PublishArtifact { ItemId = "s1", Format = PublishFormat.Pdf, Status = ArtifactStatus.Skipped, Path = p };
            PublishRetry.CarryForwardPartial(skipped, p, known, fs);
            Assert.Null(skipped.PartialPath);

            // Мэдэгдэж буй хэсэгчилсэн файл БИШ зам (өөр хүний файл) — дамжуулахгүй.
            string foreign = @"D:\Out\PDF\A-103.pdf";
            fs.AddFile(foreign, 50, T0);
            var other = new PublishArtifact { ItemId = "s2", Format = PublishFormat.Pdf, Status = ArtifactStatus.Failed, Path = foreign };
            PublishRetry.CarryForwardPartial(other, foreign, known, fs);
            Assert.Null(other.PartialPath);

            // Файл одоо алга — дамжуулах зүйл байхгүй.
            fs.Remove(p);
            var gone = new PublishArtifact { ItemId = "s1", Format = PublishFormat.Pdf, Status = ArtifactStatus.Failed, Path = p };
            PublishRetry.CarryForwardPartial(gone, p, known, fs);
            Assert.Null(gone.PartialPath);
        }

        [Test]
        [WindowsOnly("Windows drive-letter paths (D:\\...): on a non-Windows OS System.IO.Path does not treat them as rooted/separated")]
        public static void Retry_SecondFailedRetry_StillHidesTheFirstPartial_SoSkipModeDoesNotAcceptItAsPublished()
        {
            PublishProfile prof = Samples.Profile();
            prof.Naming.SheetTemplate = "{SheetNumber}";
            prof.Overwrite = OverwriteMode.Skip;
            var items = new List<PublishItem> { Samples.Sheet("u0", "A-102", "Plan") };
            string p = @"D:\Out\PDF\A-102.pdf";
            var fs = new MemoryFileSystem().AddDir(@"D:\Out").AddFile(p, 300, T0);

            // R1 = R0-ийн дахин оролдлого: P-д хүрэхээсээ өмнө бүтэлгүйтсэн (түгжигдсэн) → `CarryForwardPartial` P-г дамжуулсан.
            var r1 = new PublishRun
            {
                Id = "r1", ProfileId = prof.Id, ItemIds = new List<string> { "u0" },
                Artifacts = new List<PublishArtifact> { new PublishArtifact { ItemId = "u0", Format = PublishFormat.Pdf, Status = ArtifactStatus.Failed, Path = p } },
            };
            PublishRetry.CarryForwardPartial(r1.Artifacts[0], p, new HashSet<string>(StringComparer.OrdinalIgnoreCase) { PathKey.Of(p) }, fs);

            // R2 = R1-ийн дахин оролдлого.
            List<string> partials = PublishRetry.OwnPartialPaths(r1, fs);
            Assert.SeqEq(new[] { p }, partials, "хоёр дахь дахин оролдлого эхний хэсэгчилсэн файлаа МАРТАХГҮЙ");
            var hiding = new PublishRetry.HidingFileSystem(fs, partials);
            PublishPlan plan = PublishRetry.Filter(PublishPlanner.Build(prof, items, Samples.Project(), hiding), PublishRetry.Targets(r1));
            Assert.Eq(PlanAction.Export, plan.Artifacts.Single().Action, "Skip горимд ч эвдэрсэн файлыг «алгассан» гэж хүлээн авахгүй");

            // Дамжуулаагүй байсан бол (хуучин зан төлөв) Skip нь эвдэрсэн файлыг хүлээн авна — тестийн шалтгаан.
            PublishPlan forgot = PublishRetry.Filter(PublishPlanner.Build(prof, items, Samples.Project(), fs), PublishRetry.Targets(r1));
            Assert.Eq(PlanAction.SkipExisting, forgot.Artifacts.Single().Action);
        }

        [Test]
        [WindowsOnly("Windows drive-letter paths (D:\\...): on a non-Windows OS System.IO.Path does not treat them as rooted/separated")]
        public static void Retry_OwnPartialPaths_VerifiesTheFileIsStillTheOneWeLeft()
        {
            string p = @"D:\Out\PDF\A-101.pdf";
            var run = new PublishRun
            {
                Artifacts = new List<PublishArtifact>
                {
                    new PublishArtifact { ItemId = "s1", Format = PublishFormat.Pdf, Status = ArtifactStatus.Failed, Path = p, PartialPath = p, SizeBytes = 300, CreatedUtc = T0 },
                },
            };

            // Хэмжээ, өөрчилсөн цаг тэнцүү — бидний файл.
            Assert.SeqEq(new[] { p }, PublishRetry.OwnPartialPaths(run, new MemoryFileSystem().AddFile(p, 300, T0)));
            // FAT-ийн 2 секундийн нарийвчлал хүртэл зөрүү зөвшөөрнө.
            Assert.SeqEq(new[] { p }, PublishRetry.OwnPartialPaths(run, new MemoryFileSystem().AddFile(p, 300, T0.AddSeconds(2))));
            // Хэн нэгэн гараар экспортолж солисон: өөр хэмжээ / өөр цаг / файл алга → бидний үлдэгдэл БИШ.
            Assert.Eq(0, PublishRetry.OwnPartialPaths(run, new MemoryFileSystem().AddFile(p, 999, T0)).Count, "хэмжээ өөр");
            Assert.Eq(0, PublishRetry.OwnPartialPaths(run, new MemoryFileSystem().AddFile(p, 300, T0.AddHours(3))).Count, "өөрчилсөн цаг өөр");
            Assert.Eq(0, PublishRetry.OwnPartialPaths(run, new MemoryFileSystem().AddDir(@"D:\Out\PDF")).Count, "файл алга");

            // Өөрчилсөн цаг тэмдэглэгдээгүй (хуучин бичлэг) бол зөвхөн хэмжээгээр.
            run.Artifacts[0].CreatedUtc = null;
            Assert.SeqEq(new[] { p }, PublishRetry.OwnPartialPaths(run, new MemoryFileSystem().AddFile(p, 300, T0.AddDays(9))));

            // Орлуулсан файлд профайлын дүрэм (Skip) хэвээр хэрэглэгдэнэ — нуугдахгүй.
            PublishProfile prof = Samples.Profile();
            prof.Naming.SheetTemplate = "{SheetNumber}";
            prof.Overwrite = OverwriteMode.Skip;
            run.Artifacts[0].CreatedUtc = T0;
            var replaced = new MemoryFileSystem().AddDir(@"D:\Out").AddFile(p, 999, T0.AddHours(3));
            var hiding = new PublishRetry.HidingFileSystem(replaced, PublishRetry.OwnPartialPaths(run, replaced));
            PublishPlan plan = PublishPlanner.Build(prof, new List<PublishItem> { Samples.Sheet("u0", "A-101", "Plan") }, Samples.Project(), hiding);
            Assert.Eq(PlanAction.SkipExisting, plan.Artifacts.Single().Action, "өөр хүний файлыг чимээгүй дарж бичихгүй");
        }

        [Test]
        public static void Retry_OwnPartialPaths_IncludesCancelledArtifactsThatCarriedAPartial()
        {
            var run = new PublishRun
            {
                Artifacts = new List<PublishArtifact>
                {
                    new PublishArtifact { ItemId = "s1", Format = PublishFormat.Pdf, Status = ArtifactStatus.Cancelled, PartialPath = @"D:\Out\PDF\s1.pdf" },
                    new PublishArtifact { ItemId = "s2", Format = PublishFormat.Pdf, Status = ArtifactStatus.Cancelled },
                },
            };
            Assert.SeqEq(new[] { @"D:\Out\PDF\s1.pdf" }, PublishRetry.OwnPartialPaths(run));
        }

        [Test]
        [WindowsOnly("Windows drive-letter paths (D:\\...): on a non-Windows OS System.IO.Path does not treat them as rooted/separated")]
        public static void Retry_ForeignFileThatCausedTargetChanged_IsNotHidden_SoTheProfileRuleAppliesAgain()
        {
            PublishProfile p = Samples.Profile();
            p.Naming.SheetTemplate = "{SheetNumber}";
            var items = new List<PublishItem> { Samples.Sheet("u0", "A-101", "Plan") };
            // Эхний гүйлт: `A-101.pdf` төлөвлөгдсөн (байгаагүй) → өөр хүн үүсгэсэн → TargetChanged.  Энэ гүйлт файл үлдээгээгүй.
            var run = new PublishRun
            {
                Id = "r", ProfileId = p.Id, ItemIds = new List<string> { "u0" },
                Artifacts = new List<PublishArtifact> { new PublishArtifact { ItemId = "u0", Format = PublishFormat.Pdf, Status = ArtifactStatus.Failed, Path = @"D:\Out\PDF\A-101.pdf" } },
            };
            var fs = new MemoryFileSystem().AddDir(@"D:\Out").AddFile(@"D:\Out\PDF\A-101.pdf", 10);   // өөр хүний файл
            var hiding = new PublishRetry.HidingFileSystem(fs, PublishRetry.OwnPartialPaths(run));

            PublishPlan plan = PublishRetry.Filter(PublishPlanner.Build(p, items, Samples.Project(), hiding), PublishRetry.Targets(run));
            Assert.Eq(PlanAction.Versioned, plan.Artifacts.Single().Action, "Version горим: өөр хүний файлыг хадгалж шинэ дугаар авна");
            Assert.Eq("A-101_v2", plan.Artifacts.Single().FileBaseName);
        }

        [Test]
        public static void Retry_PlansOverTheFullOriginalSet_SoNamesMatchTheFirstRun()
        {
            PublishProfile p = Samples.Profile();
            p.Naming.SheetTemplate = "{Index:2}_{SheetNumber}";
            PublishContext ctx = Samples.Project();
            var fs = new MemoryFileSystem().AddDir(@"D:\Out");
            var all = new List<PublishItem>
            {
                Samples.Sheet("u0", "A-101", "Plan"), Samples.Sheet("u1", "A-102", "Plan"), Samples.Sheet("u2", "A-103", "Plan"),
            };
            Assert.Eq("02_A-102", PublishPlanner.Build(p, all, ctx, fs).Artifacts[1].FileBaseName, "эхний гүйлтийн нэр");

            var run = new PublishRun
            {
                Id = "r", ProfileId = p.Id, ItemIds = new List<string> { "u0", "u1", "u2" },
                Artifacts = new List<PublishArtifact>
                {
                    new PublishArtifact { ItemId = "u0", Format = PublishFormat.Pdf, Status = ArtifactStatus.Succeeded },
                    new PublishArtifact { ItemId = "u1", Format = PublishFormat.Pdf, Status = ArtifactStatus.Failed },
                    new PublishArtifact { ItemId = "u2", Format = PublishFormat.Pdf, Status = ArtifactStatus.Succeeded },
                },
            };

            // ХУУЧИН арга (зөвхөн бүтэлгүйтсэн хуудсаар төлөвлөх): `{Index}` 1 болж файл ӨӨР нэртэй гарна.
            Assert.Eq("01_A-102", PublishPlanner.Build(p, new List<PublishItem> { all[1] }, ctx, fs).Artifacts.Single().FileBaseName);

            // ШИНЭ арга: бүх хуудсаар төлөвлөөд зорилтыг шүүнэ.
            List<PublishItem> planItems = PublishRetry.PlanItemIds(run).Select(id => all.First(i => i.Id == id)).ToList();
            PublishPlan retry = PublishRetry.Filter(PublishPlanner.Build(p, planItems, ctx, fs), PublishRetry.Targets(run));
            Assert.Eq(1, retry.Artifacts.Count);
            Assert.Eq("02_A-102", retry.Artifacts[0].FileBaseName, "эхний гүйлттэй ИЖИЛ нэр");
        }

        [Test]
        public static void Retry_PlanItemIds_KeepsTheOriginalOrder_AndFallsBackToFailedArtifactsForOldHistory()
        {
            var run = new PublishRun { ItemIds = new List<string> { "c", "a", "b", "a", "" } };
            Assert.SeqEq(new[] { "c", "a", "b" }, PublishRetry.PlanItemIds(run), "эх дараалал, давхардалгүй");

            var old = new PublishRun
            {
                Artifacts = new List<PublishArtifact>
                {
                    new PublishArtifact { ItemId = "s2", Format = PublishFormat.Pdf, Status = ArtifactStatus.Failed },
                    new PublishArtifact { ItemId = "*", Format = PublishFormat.Pdf, Status = ArtifactStatus.Cancelled, MemberIds = { "s3", "s4" } },
                },
            };
            Assert.SeqEq(new[] { "s2", "s3", "s4" }, PublishRetry.PlanItemIds(old), "ItemIds хоосон хуучин түүх");
        }

        [Test]
        public static void Retry_ContextFor_ReusesTheParentsPlanningTime_AndCopiesTheProject()
        {
            PublishContext session = Samples.Project(new DateTime(2026, 10, 5, 8, 0, 0));
            DateTime planned = new DateTime(2026, 10, 1, 9, 30, 0, DateTimeKind.Local);
            var parent = new PublishRun { StartedUtc = planned.ToUniversalTime().AddMinutes(3), PlanNowUtc = planned.ToUniversalTime() };

            PublishContext c = PublishRetry.ContextFor(session, parent);
            Assert.Eq(planned, c.Now, "{Date} эх гүйлттэй ижил");
            Assert.Eq(session.ProjectNumber, c.ProjectNumber);
            Assert.Eq(session.ProjectValues["Phase"], c.ProjectValues["Phase"]);
            c.ProjectValues["Phase"] = "CD";
            Assert.Eq("DD", session.ProjectValues["Phase"], "хуулбар — эх контекст өөрчлөгдөхгүй");
            Assert.Eq(new DateTime(2026, 10, 5, 8, 0, 0), session.Now, "сессийн «одоо» хөндөгдөөгүй");

            // Хуучин түүх: `PlanNowUtc` үгүй → гүйлтийн эхлэх цаг.
            var legacy = new PublishRun { StartedUtc = planned.ToUniversalTime() };
            Assert.Eq(planned, PublishRetry.ContextFor(session, legacy).Now);

            // Ямар ч тэмдэглэгээгүй бол сессийн «одоо» хэвээр.
            Assert.Eq(session.Now, PublishRetry.ContextFor(session, new PublishRun()).Now);
        }

        [Test]
        public static void Retry_Filter_DropsNameIssuesOfSheetsThatAreNotRetried()
        {
            var plan = new PublishPlan();
            plan.Artifacts.Add(new PlannedArtifact { ItemId = "a", Format = PublishFormat.Pdf });
            plan.Artifacts.Add(new PlannedArtifact { ItemId = "b", Format = PublishFormat.Pdf });
            plan.NameIssues.Add(new NameIssue { Kind = NameIssueKind.MissingToken, ItemId = "a", Format = PublishFormat.Pdf, Detail = "x" });
            plan.NameIssues.Add(new NameIssue { Kind = NameIssueKind.MissingToken, ItemId = "b", Format = PublishFormat.Pdf, Detail = "y" });
            plan.NameIssues.Add(new NameIssue { Kind = NameIssueKind.TemplateError, Detail = "загварын алдаа (хуудсанд холбогдоогүй)" });

            PublishPlan f = PublishRetry.Filter(plan, new[] { new RetryTarget { ItemId = "a", Format = PublishFormat.Pdf } });
            Assert.Eq(1, f.Artifacts.Count);
            Assert.SeqEq(new[] { "x", "загварын алдаа (хуудсанд холбогдоогүй)" }, f.NameIssues.Select(n => n.Detail),
                "дахин оролдохгүй хуудасны нэрийн асуудал preflight-ийг блоклох ёсгүй");
        }

        /* ------------------------ «БҮРЭН ГАРГАЛТ» ХҮРЭЭ --------------------- */

        [Test]
        public static void CoversAllSheets_OnlyWhenEveryRuleSheetWasInTheRun()
        {
            var items = new List<PublishItem>
            {
                Samples.Sheet("u0", "A-101", "Plan"), Samples.Sheet("u1", "A-102", "Plan"), Samples.Sheet("u2", "A-103", "Plan"),
                Samples.Sheet("uP", "A-900", "Placeholder", placeholder: true),
                new PublishItem { Id = "v1", Kind = PublishItemKind.View, Number = "L1", Name = "Level 1" },
            };
            var rule = new SelectionRule();   // placeholder, харагдац ороогүй
            int covered, total;

            Assert.True(ItemSelection.CoversAllSheets(items, rule, new[] { "u0", "u1", "u2" }, out covered, out total));
            Assert.Eq(3, total);
            Assert.Eq(3, covered);

            Assert.False(ItemSelection.CoversAllSheets(items, rule, new[] { "u0" }, out covered, out total), "3-ын 1-ийг гаргасан гүйлт «бүгд гарсан» БИШ");
            Assert.Eq(1, covered);
            Assert.Eq(3, total);

            Assert.False(ItemSelection.CoversAllSheets(new List<PublishItem>(), rule, new string[0], out covered, out total), "гаргах хуудасгүй бол «бүгд гарсан» гэж тунхаглахгүй");

            // Нөхцөлтэй дүрэм: зөвхөн дүрмийн хуудсууд тооцогдоно.
            var narrow = new SelectionRule { Conditions = new List<ItemCondition> { new ItemCondition { Field = "SheetNumber", Op = ConditionOp.StartsWith, Value = "A-10" } } };
            Assert.True(ItemSelection.CoversAllSheets(items, narrow, new[] { "u0", "u1", "u2" }, out covered, out total));
        }

        /* --------------------------- JSON GEREE --------------------------- */

        [Test]
        public static void Run_RoundTripsPartialPathAndPlanNow()
        {
            var run = new PublishRun { Id = "r1", PlanNowUtc = new DateTime(2026, 10, 1, 1, 30, 0, DateTimeKind.Utc) };
            run.Artifacts.Add(new PublishArtifact { ItemId = "s1", Status = ArtifactStatus.Failed, PartialPath = @"D:\Out\a.pdf" });
            var back = SmartJson.Deserialize<PublishRun>(SmartJson.Serialize(run));
            Assert.Eq(@"D:\Out\a.pdf", back.Artifacts[0].PartialPath);
            Assert.Eq(run.PlanNowUtc, back.PlanNowUtc);

            // Хуучин түүх (шинэ талбаргүй) — null, унахгүй.
            var legacy = SmartJson.Deserialize<PublishRun>("{\"id\":\"old\",\"artifacts\":[{\"itemId\":\"s1\",\"status\":\"Failed\",\"path\":\"D:\\\\x.pdf\"}]}");
            Assert.Null(legacy.Artifacts[0].PartialPath);
            Assert.False(legacy.PlanNowUtc.HasValue);
        }
    }
}
