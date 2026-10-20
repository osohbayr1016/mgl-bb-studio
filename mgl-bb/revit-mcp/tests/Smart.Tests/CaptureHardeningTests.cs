using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.Smart.Core;
using RevitMcpAddin.SmartPublish.Core;

namespace RevitMcpAddin.Smart.Tests
{
    /// <summary>
    /// Production audit-ийн 2-р хараат бус хяналтын «бүртгэл / таних / хадгалалт»-ын олдворууд (Revit-гүй хэсэг): дугаарын өндөр хаалт, цэвэрхэн
    /// хаагдаагүй session-ийн тэмдэг, диск дэх файлын хурууны хээ, шалгах цэгийн уншигдахгүй файл, баримтын цоорхойн тохиргоо.
    /// </summary>
    public static class CaptureHardeningTests
    {
        private static DocumentKey NewKey()
        {
            return DocumentKeyBuilder.Build(new DocumentFacts { CreationGuid = Guid.NewGuid().ToString() });
        }

        private static ChangeBatch Batch(long seq)
        {
            var b = new ChangeBatch { Seq = seq, Utc = new DateTime(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc), Resolved = true, Modified = 1 };
            b.Entries.Add(new ChangeEntry { Id = seq, Kind = ChangeKind.Modified, Known = true, Uid = "u" + seq });
            return b;
        }

        /* ------------------------ ImpactSeq.Observe ----------------------- */

        [Test]
        public static void ImpactSeq_Observe_NeverLetsNextFallBelowAPersistedValue()
        {
            ImpactSeq.ResetForTests();
            try
            {
                long now = ImpactSeq.Mark();
                long fromTheFuture = now + 3_000_000L;           // ≈ 3 сек урагш (хуучин session цаг нь ирээдүйд байсан / одоогийн цаг ухарсан)
                Assert.True(ImpactSeq.Observe(fromTheFuture));
                Assert.True(ImpactSeq.Next() > fromTheFuture, "цаг ухарсан ч шинэ дугаар хуучнаас БАГА гарч болохгүй");
                long a = ImpactSeq.Next(), b = ImpactSeq.Next();
                Assert.True(b > a, "хатуу өсөх");
            }
            finally { ImpactSeq.ResetForTests(); }
        }

        [Test]
        public static void ImpactSeq_Observe_IgnoresZeroNegativeAndAbsurdValues()
        {
            ImpactSeq.ResetForTests();
            try
            {
                Assert.False(ImpactSeq.Observe(0));
                Assert.False(ImpactSeq.Observe(-5));
                long absurd = ImpactSeq.Mark() + (ImpactSeq.MaxFutureMs + 60_000L) * 1024;
                Assert.False(ImpactSeq.Observe(absurd), "30 хоногоос хол ирээдүйн дугаар = эвдэрсэн утга; дугаарлалтыг үүрд урагшлуулахгүй");
                Assert.True(ImpactSeq.Next() < absurd);
            }
            finally { ImpactSeq.ResetForTests(); }
        }

        [Test]
        public static void ChangeLogStore_Load_ObservesTheHighestPersistedSeq()
        {
            string root = TestDirs.NewTemp();
            SmartPaths.OverrideRoot(root);
            ImpactSeq.ResetForTests();
            try
            {
                DocumentKey key = NewKey();
                long future = ImpactSeq.Mark() + 3_600_000L * 1024;        // 1 цагийн дараах дугаартай багц бичигдсэн
                var f = new ChangeLogFile { LostThroughSeq = 5 };
                f.Batches.Add(Batch(future));
                string err;
                Assert.True(ChangeLogStore.Save(key, f, out err), err);

                ImpactSeq.ResetForTests();                                   // шинэ session: санах ойн өндөр хаалт алга
                LoadStatus status;
                ChangeLogStore.Load(key, out status);
                Assert.Eq(LoadStatus.Ok, status);
                Assert.True(ImpactSeq.Next() > future, "диск дээрх дугаараас хойш үргэлжилнэ");
            }
            finally { ImpactSeq.ResetForTests(); SmartPaths.OverrideRoot(null); }
        }

        [Test]
        public static void CheckpointStore_And_PublishCheckpoints_Load_ObserveTheirSeqs_Too()
        {
            string root = TestDirs.NewTemp();
            SmartPaths.OverrideRoot(root);
            ImpactSeq.ResetForTests();
            try
            {
                DocumentKey key = NewKey();
                long hi = ImpactSeq.Mark() + 7_200_000L * 1024;
                string err;
                Assert.True(CheckpointStore.Add(key, new ModelCheckpoint { Utc = DateTime.UtcNow, Label = "x", Kind = "user", ChangeSeq = hi }, out err), err);

                var cps = new PublishCheckpoints();
                cps.Profiles["p"] = new Dictionary<string, SheetCheckpoint>
                {
                    { "s1", new SheetCheckpoint { ChangeSeq = 5, Formats = new Dictionary<string, FormatStamp> { { "pdf", new FormatStamp { ChangeSeq = hi + 777 } } } } },
                };
                Assert.True(PublishCheckpointStore.Save(key, cps, out err), err);

                ImpactSeq.ResetForTests();
                CheckpointStore.Load(key);
                Assert.True(ImpactSeq.Next() > hi, "шалгах цэгийн дугаар");

                ImpactSeq.ResetForTests();
                PublishCheckpointStore.Load(key);
                Assert.True(ImpactSeq.Next() > hi + 777, "гаргалтын checkpoint-ийн формат тэмдгийн дугаар");
            }
            finally { ImpactSeq.ResetForTests(); SmartPaths.OverrideRoot(null); }
        }

        /* ------------------- ЦЭВЭРХЭН ХААГДААГҮЙ SESSION ------------------ */

        [Test]
        public static void PriorSessionEndedUncleanly_OnlyForAForeignSessionThatLeftTheFileOpen()
        {
            string me = ChangeLogStore.ProcessSessionId;
            Assert.False(ChangeLogStore.PriorSessionEndedUncleanly(null, me));
            Assert.False(ChangeLogStore.PriorSessionEndedUncleanly(new ChangeLogFile(), me), "хуучин файл (талбаргүй) = нотолгоо байхгүй");
            Assert.False(ChangeLogStore.PriorSessionEndedUncleanly(new ChangeLogFile { CleanClose = true, SessionId = "other" }, me), "тэр session цэвэрхэн хаасан");
            Assert.False(ChangeLogStore.PriorSessionEndedUncleanly(new ChangeLogFile { CleanClose = false, SessionId = me }, me), "өөрийн session-ийн нээлттэй тэмдэг цоорхой БИШ");
            Assert.False(ChangeLogStore.PriorSessionEndedUncleanly(new ChangeLogFile { CleanClose = false, SessionId = null }, me), "session тодорхойгүй бол таамаглахгүй");
            Assert.True(ChangeLogStore.PriorSessionEndedUncleanly(new ChangeLogFile { CleanClose = false, SessionId = "other" }, me), "өөр session нээлттэй орхисон (унасан/ОДОО нээлттэй)");
        }

        [Test]
        public static void ChangeLogFile_SessionFields_RoundTrip_AndLegacyJsonDefaultsToClean()
        {
            var f = new ChangeLogFile { SessionId = "abc123", CleanClose = false, LostThroughSeq = 9 };
            ChangeLogFile back = SmartJson.Deserialize<ChangeLogFile>(SmartJson.Serialize(f));
            Assert.Eq("abc123", back.SessionId);
            Assert.False(back.CleanClose);

            // Хуучин add-in-ийн бичсэн файл (CleanClose талбаргүй) — «цэвэр» гэж үзнэ, худал цоорхой гаргахгүй.
            var legacy = SmartJson.Deserialize<ChangeLogFile>("{\"batches\":[],\"droppedBatches\":0,\"lostThroughSeq\":4}");
            Assert.True(legacy.CleanClose);
            Assert.Null(legacy.SessionId);
            Assert.Eq(4L, legacy.LostThroughSeq);
        }

        [Test]
        public static void ChangeLogStore_DiskStamp_ChangesOnRewrite_AndIsNullWhenThereIsNothingToCompare()
        {
            string root = TestDirs.NewTemp();
            SmartPaths.OverrideRoot(root);
            try
            {
                DocumentKey key = NewKey();
                Assert.Null(ChangeLogStore.DiskStamp(key), "файл байхгүй");
                Assert.Null(ChangeLogStore.DiskStamp(null));
                Assert.Null(ChangeLogStore.DiskStamp(DocumentKeyBuilder.Build(new DocumentFacts { SessionId = "tmp" })), "хадгалах боломжгүй түлхүүр");

                var f = new ChangeLogFile();
                f.Batches.Add(Batch(ImpactSeq.Mark()));
                string err;
                Assert.True(ChangeLogStore.Save(key, f, out err), err);
                string first = ChangeLogStore.DiskStamp(key);
                Assert.True(first != null);
                Assert.Eq(first, ChangeLogStore.DiskStamp(key), "өөрчлөлтгүй бол ижил");

                // Өөр session ижил файлд нэмж бичив → хурууны хээ өөрчлөгдөнө (бичихийн өмнө нэгтгэх ёстой гэсэн дохио).
                f.Batches.Add(Batch(ImpactSeq.Next()));
                Assert.True(ChangeLogStore.Save(key, f, out err), err);
                Assert.True(first != ChangeLogStore.DiskStamp(key));
            }
            finally { SmartPaths.OverrideRoot(null); }
        }

        [Test]
        public static void ChangeLogStore_IsMarkedUnreadable_FollowsTheStore_AndNeverThrows()
        {
            string root = TestDirs.NewTemp();
            SmartPaths.OverrideRoot(root);
            try
            {
                DocumentKey key = NewKey();
                Assert.False(ChangeLogStore.IsMarkedUnreadable(null), "түлхүүргүй = тэмдэглэгээ байхгүй");
                Assert.False(ChangeLogStore.IsMarkedUnreadable(DocumentKeyBuilder.Build(new DocumentFacts { SessionId = "tmp" })), "хадгалах боломжгүй түлхүүр");
                Assert.False(ChangeLogStore.IsMarkedUnreadable(key), "файл хэзээ ч уншигдаагүй");

                var f = new ChangeLogFile();
                f.Batches.Add(Batch(ImpactSeq.Mark()));
                string err;
                Assert.True(ChangeLogStore.Save(key, f, out err), err);
                string path = SmartStore.Default.FullPath(SmartPaths.DocFile(key, ChangeLogStore.FileName));

                // Түгжигдсэн файл: уншилт `Unreadable` → `Persist` бичилт бүтэлгүйтсэний дараа энэ тэмдэглэгээгээр `LoadFailed` болгож back-off хийнэ.
                using (new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
                {
                    LoadStatus status;
                    ChangeLogStore.Load(key, out status);
                    Assert.Eq(LoadStatus.Unreadable, status);
                    Assert.True(ChangeLogStore.IsMarkedUnreadable(key), "түгжигдсэн файл = «уншигдахгүй» гэж тэмдэглэгдсэн");
                }

                // Түгжээ суларсан ч амжилттай Load хүртэл тэмдэглэгээ хэвээр (Save татгалзана), Load-ын дараа арилна.
                Assert.True(ChangeLogStore.IsMarkedUnreadable(key));
                LoadStatus again;
                ChangeLogStore.Load(key, out again);
                Assert.Eq(LoadStatus.Ok, again);
                Assert.False(ChangeLogStore.IsMarkedUnreadable(key));
            }
            finally { ImpactSeq.ResetForTests(); SmartPaths.OverrideRoot(null); }
        }

        /* ---------------- ШАЛГАХ ЦЭГ: УНШИГДАХГҮЙ ФАЙЛ ≠ «ЦЭГ АЛГА» -------- */

        [Test]
        public static void CheckpointStore_RemoveAndAdd_RefuseOnAnUnreadableFile_NeverFakeSuccess()
        {
            string root = TestDirs.NewTemp();
            SmartPaths.OverrideRoot(root);
            try
            {
                DocumentKey key = NewKey();
                string err;
                var keep = new ModelCheckpoint { Utc = DateTime.UtcNow, Label = "keep", Kind = "user" };
                Assert.True(CheckpointStore.Add(key, keep, out err), err);

                string path = SmartStore.Default.FullPath(SmartPaths.DocFile(key, "impact-checkpoints.json"));
                string before = File.ReadAllText(path);
                using (new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.None))        // антивирус/нөөцлөлт түгжсэн
                {
                    bool removed;
                    Assert.False(CheckpointStore.Remove(key, keep.Id, out removed, out err), "уншигдахгүй файл дээр «амжилттай» гэж худал хэлэхгүй");
                    Assert.False(removed);
                    Assert.True(err != null && err.Contains("уншигдсангүй"), err);

                    // Байхгүй id-д ч «цэг байгаагүй, OK» гэж хэлэхгүй — файлыг уншиж чадаагүй.
                    Assert.False(CheckpointStore.Remove(key, "no-such", out removed, out err));

                    Assert.False(CheckpointStore.Add(key, new ModelCheckpoint { Utc = DateTime.UtcNow, Label = "new", Kind = "user" }, out err));
                    Assert.True(err != null && err.Contains("уншигдсангүй"), err);
                }
                Assert.Eq(before, File.ReadAllText(path), "одоо байгаа цэгүүд ДАРАГДААГҮЙ");

                // Түгжээ суларсны дараа хэвийн.
                bool removed2;
                Assert.True(CheckpointStore.Remove(key, keep.Id, out removed2, out err), err);
                Assert.True(removed2);
            }
            finally { SmartPaths.OverrideRoot(null); }
        }

        [Test]
        public static void CheckpointStore_NewerSchemaFile_IsNeverModified()
        {
            string root = TestDirs.NewTemp();
            SmartPaths.OverrideRoot(root);
            try
            {
                DocumentKey key = NewKey();
                string path = SmartStore.Default.FullPath(SmartPaths.DocFile(key, "impact-checkpoints.json"));
                Directory.CreateDirectory(Path.GetDirectoryName(path));
                File.WriteAllText(path, "{\"schema\":99,\"savedUtc\":\"x\",\"payload\":{\"items\":[{\"id\":\"future\"}]}}");
                string err; bool removed;
                Assert.False(CheckpointStore.Add(key, new ModelCheckpoint { Utc = DateTime.UtcNow, Label = "n", Kind = "user" }, out err));
                Assert.True(err != null && err.Contains("шинэ хувилбар"), err);
                Assert.False(CheckpointStore.Remove(key, "future", out removed, out err));
                Assert.True(File.ReadAllText(path).Contains("future"));
            }
            finally { SmartPaths.OverrideRoot(null); }
        }

        /* ------------------- БАРИМТЫН ЦООРХОЙ (тохиргоо) ------------------ */

        [Test]
        public static void SmartSettings_DocGap_IsRecordedPerDocument_MonotonicAndPruned()
        {
            var store = new SmartStore(TestDirs.NewTemp());
            Assert.True(SmartSettings.RecordDocGap("doc-A", 500, store));
            Assert.True(SmartSettings.RecordDocGap("doc-A", 300, store), "бага дугаар нь бууруулахгүй (амжилттай)");
            Assert.True(SmartSettings.RecordDocGap("doc-B", 900, store));

            SmartSettingsFile f = SmartSettings.Load(store);
            Assert.Eq(500L, SmartSettings.DocGapFor(f, "doc-A"));
            Assert.Eq(900L, SmartSettings.DocGapFor(f, "doc-B"));
            Assert.Eq(0L, SmartSettings.DocGapFor(f, "doc-C"), "бусад баримтад нөлөөлөхгүй");
            Assert.Eq(0L, SmartSettings.DocGapFor(f, null));
            Assert.Eq(0L, SmartSettings.DocGapFor(null, "doc-A"));
            Assert.Eq(0L, f.TrackingGapThroughSeq, "глобал тэмдэглэгээнээс ТУСДАА");

            for (int i = 0; i < SmartSettings.MaxDocGaps + 25; i++) SmartSettings.RecordDocGap("bulk" + i, 1000 + i, store);
            SmartSettingsFile pruned = SmartSettings.Load(store);
            Assert.True(pruned.DocGapThroughSeq.Count <= SmartSettings.MaxDocGaps, "хязгаартай: " + pruned.DocGapThroughSeq.Count);
            Assert.Eq(0L, SmartSettings.DocGapFor(pruned, "doc-A"), "хамгийн бага дугаартай (хуучин) нь хасагдсан");
            Assert.Eq(1000L + SmartSettings.MaxDocGaps + 24, SmartSettings.DocGapFor(pruned, "bulk" + (SmartSettings.MaxDocGaps + 24)), "хамгийн шинэ нь үлдсэн");

            Assert.False(SmartSettings.RecordDocGap("", 5, store));
            Assert.False(SmartSettings.RecordDocGap("x", 0, store));
        }

        [Test]
        public static void SmartSettings_DocGap_IsNotRecordedOverAnUnreadableSettingsFile()
        {
            var store = new SmartStore(TestDirs.NewTemp());
            Assert.True(SmartSettings.Save(new SmartSettingsFile { ImpactTracking = false }, store));
            string path = store.FullPath(SmartSettings.FileName);
            string before = File.ReadAllText(path);
            using (new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
            {
                Assert.False(SmartSettings.RecordDocGap("doc-A", 100, store), "уншигдаагүй тохиргоог анхдагчаар дарж бичихгүй");
            }
            Assert.Eq(before, File.ReadAllText(path));
            SmartSettingsFile back = SmartSettings.Load(store);
            Assert.False(back.ImpactTracking, "бодит тохиргоо хэвээр");
        }
    }
}
