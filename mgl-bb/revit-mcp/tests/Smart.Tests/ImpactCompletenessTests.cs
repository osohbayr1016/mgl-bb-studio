using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.Smart.Tests
{
    /// <summary>
    /// «Нөлөөлөл олдсонгүй» нь «өөрчлөгдөөгүй» БИШ.  Бүртгэлийн цоорхой, хязгаар, устсан элемент, шалгаагүй хэсэг бүр шинжилгээг
    /// «бүрэн БИШ» болгодог эсэхийг хараат бус хяналтын 3 HIGH олдвороор барьж тестлэнэ.
    /// </summary>
    public static class ImpactCompletenessTests
    {
        private static ChangeBatch B(long seq, int entries = 1, bool truncated = false)
        {
            var b = new ChangeBatch { Seq = seq, Utc = new DateTime(2026, 10, 1, 9, 0, 0, DateTimeKind.Utc).AddSeconds(seq), Resolved = true, Truncated = truncated };
            for (int i = 0; i < entries; i++)
                b.Entries.Add(new ChangeEntry { Id = seq * 1000 + i, Kind = ChangeKind.Modified, Known = true, Uid = "u" + seq + "_" + i });
            b.Modified = entries;
            return b;
        }

        private static ChangeEntry Deleted(long id, bool known, long ownerView = 0, long host = 0, ImpactNodeKind kind = ImpactNodeKind.Element)
        {
            return new ChangeEntry { Id = id, Kind = ChangeKind.Deleted, Known = known, Uid = known ? "u" + id : null, OwnerViewId = ownerView, HostId = host, NodeKind = kind };
        }

        private static ChangeBatch BDel(long seq, params ChangeEntry[] entries)
        {
            var b = new ChangeBatch { Seq = seq, Resolved = true };
            b.Entries.AddRange(entries);
            b.Deleted = entries.Length;
            return b;
        }

        /* ---------------------------- LOG GAP TRACKING -------------------- */

        [Test]
        public static void Trim_RecordsTheNewestDroppedSeq_SoTheGapIsNeverSilent()
        {
            var batches = new List<ChangeBatch>();
            for (int i = 1; i <= ChangeLogStore.MaxBatches + 25; i++) batches.Add(B(i * 10));
            long lost = 0;
            int removed = ChangeLogStore.TrimBatches(batches, ref lost);
            Assert.Eq(25, removed);
            Assert.Eq(ChangeLogStore.MaxBatches, batches.Count);
            Assert.Eq(250L, lost, "хасагдсан хамгийн ШИНЭ дугаар (25-р багц)");
            Assert.Eq(260L, batches.First().Seq);
        }

        [Test]
        public static void Trim_ByEntryBudget_AlsoRecordsTheGap_ButAlwaysKeepsTheNewestBatch()
        {
            var batches = new List<ChangeBatch> { B(10, 40000), B(20, 40000), B(30, 40000) };
            long lost = 0;
            ChangeLogStore.TrimBatches(batches, ref lost);
            Assert.True(batches.Sum(b => b.Entries.Count) <= ChangeLogStore.MaxEntries);
            Assert.Eq(10L, lost);
            Assert.True(batches.Any(b => b.Seq == 30), "хамгийн сүүлийн багц хэзээ ч хасагдахгүй");

            var huge = new List<ChangeBatch> { B(5, ChangeLogStore.MaxEntries + 500) };
            long lost2 = 0;
            ChangeLogStore.TrimBatches(huge, ref lost2);
            Assert.Eq(1, huge.Count, "ганц багц хэт том байсан ч хасахгүй");
            Assert.Eq(0L, lost2);
        }

        [Test]
        public static void Trim_NothingToRemove_LeavesGapUntouched()
        {
            var batches = new List<ChangeBatch> { B(10), B(20) };
            long lost = 77;
            Assert.Eq(0, ChangeLogStore.TrimBatches(batches, ref lost));
            Assert.Eq(77L, lost, "өмнө тэмдэглэсэн цоорхой буурахгүй");
        }

        [Test]
        public static void ChangeLogFile_KeepsTheGap_AcrossSaveTrimAndJson()
        {
            var f = new ChangeLogFile { LostThroughSeq = 123 };
            for (int i = 1; i <= ChangeLogStore.MaxBatches + 3; i++) f.Batches.Add(B(1000 + i));
            ChangeLogStore.Trim(f);
            Assert.Eq(ChangeLogStore.MaxBatches, f.Batches.Count);
            Assert.Eq(1003L, f.LostThroughSeq, "Trim нь одоо байгаа цоорхойгоос ИХ дугаар л тавина");
            var back = SmartJson.Deserialize<ChangeLogFile>(SmartJson.Serialize(f));
            Assert.Eq(1003L, back.LostThroughSeq);
        }

        [Test]
        public static void HasLogGap_OnlyWhenTheGapReachesIntoTheAnalysedRange()
        {
            string r;
            // Хуучин trim (дугаар 100) — 500-аас эхэлсэн шинжилгээнд нөлөөлөхгүй.
            Assert.False(ImpactCompleteness.HasLogGap(500, 100, 0, false, out r));
            // 50-аас эхэлсэн шинжилгээний муж 100-г агуулна — цоорхой.
            Assert.True(ImpactCompleteness.HasLogGap(50, 100, 0, false, out r));
            Assert.True(r.Contains("бүрэн БИШ"), r);
            // Дээд хаалт яг тэнцүү бол (from нь exclusive) муж дотор БИШ.
            Assert.False(ImpactCompleteness.HasLogGap(100, 100, 0, false, out r));
            // Бүртгэл унтраалттай байсан (дахин асаасан мөч 300) — 200-аас эхэлсэн шинжилгээ.
            Assert.True(ImpactCompleteness.HasLogGap(200, 0, 300, false, out r));
            Assert.True(r.Contains("унтраалттай"), r);
            Assert.False(ImpactCompleteness.HasLogGap(300, 0, 300, false, out r));
            // Диск дэх бүртгэл УНШИГДААГҮЙ — ямар ч муж дээр цоорхой.
            Assert.True(ImpactCompleteness.HasLogGap(long.MaxValue - 1, 0, 0, true, out r));
            Assert.True(r.Contains("уншигдсангүй"), r);
            // Цоорхойгүй
            Assert.False(ImpactCompleteness.HasLogGap(0, 0, 0, false, out r));
            // Тохиргооны файл уншигдсангүй — бүртгэл унтарсан эсэх, хаалтын үеийн цоорхой тодорхойгүй: «цоорхойгүй» гэж ХЭЗЭЭ Ч хэлэхгүй.
            Assert.True(ImpactCompleteness.HasLogGap(0, 0, 0, false, out r, settingsUnreadable: true));
            Assert.True(r.Contains("Тохиргооны файл"), r);
        }

        /* ---------------------------- COMPLETENESS REASONS ---------------- */

        [Test]
        public static void Reasons_EmptyWhenNothingLimitedAnything()
        {
            Assert.Eq(0, ImpactCompleteness.Reasons(new CompletenessInputs()).Count);
            Assert.Eq(0, ImpactCompleteness.Reasons(null).Count);
        }

        [Test]
        public static void Reasons_EveryLimitProducesAHumanReadableReason()
        {
            var inputs = new CompletenessInputs
            {
                GraphComplete = false,
                GraphReasons = new[] { "хэт олон холбоотой зангилаа (>400, 12 сул холбоо орхигдсон)", "3 зангилаа 6-н гүнээс цааш дэлгэгдээгүй" },
                ResolverFailures = 2,
                ResolverTruncations = 1,
                TruncationReasons = new[] { "«Wall» — төрлийн хувилбар: 1500 байна, эхний 1000-г л авав." },
                GlobalUnenumerated = 1,
                SourcesTruncated = true,
                TruncatedBatches = 2,
                UnresolvedDeleted = 3,
                DeletedUnderivable = 4,
                LogGap = true,
                TrackingDisabled = true,
                SkippedAnalyses = new[] { "Харагдалтын шинжилгээг сонгоогүй." },
                BaselineFailed = true,
                BaselineFailedReason = "GUID энэ баримтад хүчингүй",
                UnknownTargets = 5,
                UnknownSources = 6,
                UnreadableLinks = 7,
            };
            List<string> reasons = ImpactCompleteness.Reasons(inputs);
            Assert.Eq(15, reasons.Count, string.Join("\n", reasons));
            string all = string.Join("\n", reasons);
            foreach (string needle in new[] { "унтраалттай", "Бүртгэлд цоорхой", "2 багц", "хэт олон", "3 устсан", "4 загварын элемент", "граф хязгаарт", "1500", "2 резольвер", "5 нөлөөлөгдөх зорилт", "6 өөрчилсөн элемент", "7 холбоосын зорилт", "Төслийн ерөнхий", "Харагдалтын шинжилгээг", "baseline" })
                Assert.True(all.Contains(needle), "шалтгаан дутуу: " + needle + "\n" + all);
            Assert.Eq(reasons.Count, reasons.Distinct().Count(), "давхардалгүй");
        }

        [Test]
        public static void Reasons_LogGapWithoutText_StillHasADefaultSentence()
        {
            List<string> r = ImpactCompleteness.Reasons(new CompletenessInputs { LogGap = true });
            Assert.Eq(1, r.Count);
            Assert.True(r[0].Contains("цоорхой"));
        }

        /* ---------------------------- AGGREGATOR COUNTERS ----------------- */

        [Test]
        public static void Aggregator_CountsTruncatedBatches_InTheRangeOnly()
        {
            var all = new List<ChangeBatch> { B(10, 1, truncated: true), B(20, 1), B(30, 1, truncated: true), B(40, 1, truncated: true) };
            AggregatedChanges r = ChangeAggregator.Aggregate(all, 15, 35, null, 1000);
            Assert.Eq(1, r.TruncatedBatches, "20 (цэвэр) ба 30 (таслагдсан) мужид — 10, 40 мужаас гадна");
        }

        [Test]
        public static void IsDerivableDeletion_ViewSpecificHostedAndPlacements_ButNotPlainModelElements()
        {
            Assert.True(ChangeAggregator.IsDerivableDeletion(Deleted(1, true, ownerView: 50)), "view-specific → харагдац");
            Assert.True(ChangeAggregator.IsDerivableDeletion(Deleted(2, true, host: 70)), "хостод холбогдсон");
            Assert.True(ChangeAggregator.IsDerivableDeletion(Deleted(3, true, kind: ImpactNodeKind.Sheet)));
            Assert.True(ChangeAggregator.IsDerivableDeletion(Deleted(4, true, kind: ImpactNodeKind.View)));
            Assert.True(ChangeAggregator.IsDerivableDeletion(Deleted(5, true, kind: ImpactNodeKind.Schedule)));
            Assert.False(ChangeAggregator.IsDerivableDeletion(Deleted(6, true)), "энгийн загварын элемент (хана г.м.) — геометр устсан");
            Assert.False(ChangeAggregator.IsDerivableDeletion(null));
        }

        [Test]
        public static void Aggregator_DeletedKnownModelElement_IsFlaggedUnderivable_NotSilent()
        {
            // Хана 9:00-д засагдаад (кэшлэгдсэн) дараа нь устсан → мэдээлэл БИЙ, гэвч аль харагдацад харагдаж байсныг ҮНДЭСЛЭХ боломжгүй.
            var all = new List<ChangeBatch>
            {
                BDel(10, Deleted(1, known: true)),                                   // хана — үндэслэх боломжгүй
                BDel(20, Deleted(2, known: true, ownerView: 99)),                    // tag — харагдацтай холбоотой
                BDel(30, Deleted(3, known: false)),                                  // мэдээлэлгүй
            };
            AggregatedChanges r = ChangeAggregator.Aggregate(all, 0, long.MaxValue, null, 1000);
            Assert.Eq(3, r.Deleted);
            Assert.Eq(1, r.DeletedUnderivable, "хана");
            Assert.Eq(1, r.UnresolvedDeleted, "мэдээлэлгүй");
        }

        /* ---------------------------- GRAPH LIMITS ------------------------ */

        private static IReadOnlyList<ImpactEdge> Edges(long from, params long[] to)
        {
            return to.Select(t => new ImpactEdge { From = from, To = t, Relationship = "rel", Confidence = ImpactConfidence.B, Reason = "r", Resolver = "x" }).ToList();
        }

        [Test]
        public static void Graph_FanoutTruncation_MakesItIncomplete()
        {
            var limits = new ImpactLimits { MaxEdgesPerNode = 3 };
            var g = new ImpactGraphBuilder(new[] { new SourceChange { Id = 1, Kind = ChangeKind.Modified } },
                id => id == 1 ? Edges(1, 10, 11, 12, 13, 14, 15) : new ImpactEdge[0], limits).RunAll();
            Assert.False(g.Complete, "сул холбоо орхигдсон — «бүрэн» биш");
            Assert.True(g.IncompleteReasons.Any(x => x.Contains("хэт олон холбоотой")), string.Join("|", g.IncompleteReasons));
            Assert.Eq(3, g.Targets.Count);
        }

        [Test]
        public static void Graph_DepthLimit_MakesItIncomplete_WithAReason()
        {
            var limits = new ImpactLimits { MaxDepth = 2 };
            // 1 → 2 → 3 → 4 : гүн 2 дээр зогсоно
            var g = new ImpactGraphBuilder(new[] { new SourceChange { Id = 1, Kind = ChangeKind.Modified } },
                id => id < 4 ? Edges(id, id + 1) : new ImpactEdge[0], limits).RunAll();
            Assert.False(g.Complete);
            Assert.True(g.IncompleteReasons.Any(x => x.Contains("гүнээс")), string.Join("|", g.IncompleteReasons));
            Assert.False(g.Targets.ContainsKey(4), "хязгаараас цааш дэлгэгдээгүй");
        }

        [Test]
        public static void Graph_WithinLimits_IsComplete_AndEmptyGraphIsComplete()
        {
            var g = new ImpactGraphBuilder(new[] { new SourceChange { Id = 1, Kind = ChangeKind.Modified } },
                id => id == 1 ? Edges(1, 2, 3) : new ImpactEdge[0]).RunAll();
            Assert.True(g.Complete);
            Assert.Eq(0, g.IncompleteReasons.Count);
            var empty = new ImpactGraphBuilder(new SourceChange[0], id => new ImpactEdge[0]).RunAll();
            Assert.True(empty.Complete, "эх сурвалж 0 → дэлгэх зүйл үгүй");
        }

        /* ---------------------------- CHECKPOINT STORE -------------------- */

        [Test]
        public static void Checkpoints_Remove_DeletesOnlyThatOne_AndReportsMissingWithoutWriting()
        {
            string root = TestDirs.NewTemp();
            SmartPaths.OverrideRoot(root);
            try
            {
                DocumentKey key = DocumentKeyBuilder.Build(new DocumentFacts { CreationGuid = Guid.NewGuid().ToString() });
                string err;
                bool removed;
                var a = new ModelCheckpoint { Utc = new DateTime(2026, 10, 1, 8, 0, 0, DateTimeKind.Utc), Label = "a", Kind = "user" };
                var b = new ModelCheckpoint { Utc = new DateTime(2026, 10, 1, 9, 0, 0, DateTimeKind.Utc), Label = "b", Kind = "user" };
                Assert.True(CheckpointStore.Add(key, a, out err), err);
                Assert.True(CheckpointStore.Add(key, b, out err), err);

                Assert.True(CheckpointStore.Remove(key, a.Id, out removed, out err), err);
                Assert.True(removed);
                CheckpointsFile f = CheckpointStore.Load(key);
                Assert.Eq(1, f.Items.Count);
                Assert.Eq(b.Id, f.Items[0].Id, "зөвхөн сонгосон нь устсан");

                Assert.True(CheckpointStore.Remove(key, "no-such-id", out removed, out err), "байхгүй id нь алдаа БИШ");
                Assert.False(removed);
                Assert.Eq(1, CheckpointStore.Load(key).Items.Count);
            }
            finally { SmartPaths.OverrideRoot(null); }
        }

        [Test]
        public static void Checkpoints_ConcurrentAddAndRemove_NeverLoseAnUpdate()
        {
            string root = TestDirs.NewTemp();
            SmartPaths.OverrideRoot(root);
            try
            {
                DocumentKey key = DocumentKeyBuilder.Build(new DocumentFacts { CreationGuid = Guid.NewGuid().ToString() });
                string err;
                var doomed = new List<ModelCheckpoint>();
                for (int i = 0; i < 20; i++)
                {
                    var cp = new ModelCheckpoint { Utc = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddMinutes(i), Label = "old" + i, Kind = "user" };
                    doomed.Add(cp);
                    Assert.True(CheckpointStore.Add(key, cp, out err), err);
                }

                var added = new List<string>();
                var errors = new List<string>();
                var adder = new System.Threading.Thread(() =>
                {
                    for (int i = 0; i < 20; i++)
                    {
                        var cp = new ModelCheckpoint { Utc = new DateTime(2026, 6, 1, 0, 0, 0, DateTimeKind.Utc).AddMinutes(i), Label = "new" + i, Kind = "publish" };
                        string e;
                        if (CheckpointStore.Add(key, cp, out e)) lock (added) added.Add(cp.Id); else lock (errors) errors.Add(e);
                    }
                });
                var remover = new System.Threading.Thread(() =>
                {
                    foreach (ModelCheckpoint cp in doomed)
                    {
                        string e; bool removed;
                        if (!CheckpointStore.Remove(key, cp.Id, out removed, out e)) lock (errors) errors.Add(e);
                    }
                });
                adder.Start(); remover.Start(); adder.Join(); remover.Join();

                Assert.Eq(0, errors.Count, string.Join("|", errors));
                CheckpointsFile f = CheckpointStore.Load(key);
                // Нэмсэн 20 бүгд үлдсэн (устгал тэднийг дарж бичээгүй), устгасан 20 бүгд алга.
                Assert.Eq(20, f.Items.Count, "нэмсэн/устгасан хоёр уралдахад өөрчлөлт алдагдаагүй");
                foreach (string id in added) Assert.True(f.Items.Any(i => i.Id == id), "нэмсэн цэг алдагдсан: " + id);
                foreach (ModelCheckpoint cp in doomed) Assert.False(f.Items.Any(i => i.Id == cp.Id), "устгасан цэг үлдсэн: " + cp.Label);
            }
            finally { SmartPaths.OverrideRoot(null); }
        }

        /* ---------------------------- REPORT JSON ------------------------- */

        [Test]
        public static void Report_NewFields_RoundTripThroughJson()
        {
            var r = new ImpactReport
            {
                Incomplete = true, LogGap = true, TruncatedBatches = 3, DeletedUnderivable = 2, BaselineUsed = true, BaselineFailed = false,
            };
            r.IncompleteReasons.Add("шалтгаан");
            ImpactReport back = SmartJson.Deserialize<ImpactReport>(SmartJson.Serialize(r));
            Assert.True(back.Incomplete && back.LogGap && back.BaselineUsed && !back.BaselineFailed);
            Assert.Eq(3, back.TruncatedBatches);
            Assert.Eq(2, back.DeletedUnderivable);
            Assert.SeqEq(new[] { "шалтгаан" }, back.IncompleteReasons);
        }
    }
}
