using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.Smart.Core;
using RevitMcpAddin.ChangeImpact.Core;

namespace RevitMcpAddin.Smart.Tests
{
    public static class ImpactTests
    {
        private static ImpactEdge E(long from, long to, ImpactConfidence c, string rel = "rel", string reason = null)
        {
            return new ImpactEdge { From = from, To = to, Confidence = c, Relationship = rel, Reason = reason ?? (rel + " " + from + "→" + to), Resolver = "test" };
        }

        /// <summary>Хуурамч холбооны хүснэгтээс `expand` хийнэ.</summary>
        private static Func<long, IReadOnlyList<ImpactEdge>> Graph(params ImpactEdge[] edges)
        {
            ILookup<long, ImpactEdge> map = edges.ToLookup(e => e.From);
            return id => map[id].ToList();
        }

        private static SourceChange Src(long id, ChangeKind k = ChangeKind.Modified, long seq = 1)
        {
            return new SourceChange { Id = id, Kind = k, Seq = seq };
        }

        /* ------------------------------ ИТГЭЛ ------------------------------ */

        [Test]
        public static void Confidence_WeakerNeverUpgrades_UnknownIsWeakest()
        {
            Assert.Eq(ImpactConfidence.B, ImpactConf.Weaker(ImpactConfidence.A, ImpactConfidence.B));
            Assert.Eq(ImpactConfidence.B, ImpactConf.Weaker(ImpactConfidence.B, ImpactConfidence.A));
            Assert.Eq(ImpactConfidence.D, ImpactConf.Weaker(ImpactConfidence.A, ImpactConfidence.D));
            Assert.Eq(ImpactConfidence.C, ImpactConf.Weaker(ImpactConfidence.C, ImpactConfidence.C));
            // Unknown нь ХЭЗЭЭ Ч «шууд» болохгүй — хамгийн сул (D).
            Assert.Eq(ImpactConfidence.D, ImpactConf.Weaker(ImpactConfidence.A, ImpactConfidence.Unknown));
            Assert.Eq(ImpactConfidence.D, ImpactConf.Normalize(ImpactConfidence.Unknown));
            Assert.True(ImpactConf.IsStronger(ImpactConfidence.A, ImpactConfidence.B));
            Assert.False(ImpactConf.IsStronger(ImpactConfidence.D, ImpactConfidence.Unknown), "Unknown = D → тэнцүү, илүү хүчтэй биш");
        }

        [Test]
        public static void Confidence_Labels_AreDistinct()
        {
            var labels = new[] { ImpactConfidence.A, ImpactConfidence.B, ImpactConfidence.C, ImpactConfidence.D }.Select(ImpactConf.Label).ToList();
            Assert.Eq(4, labels.Distinct().Count());
            Assert.Eq("Шууд", ImpactConf.Label(ImpactConfidence.A));
            Assert.True(ImpactConf.Meaning(ImpactConfidence.C).Contains("crop"), "C итгэлийн тайлбарт crop/нуугдсан хязгаар дурдагдах ёстой");
        }

        /* ------------------------------ ГРАФ ------------------------------ */

        [Test]
        public static void Graph_AllDirectChain_StaysA_WithFullPath()
        {
            // view-specific элемент (1) → харагдац (2) → хуудас (3)
            ImpactGraph g = new ImpactGraphBuilder(new[] { Src(1) }, Graph(E(1, 2, ImpactConfidence.A, "view_owner"), E(2, 3, ImpactConfidence.A, "viewport_sheet"))).RunAll();
            Assert.True(g.Complete);
            Assert.Eq(ImpactConfidence.A, g.Targets[3].Confidence);
            Assert.Eq(2, g.Targets[3].Depth);
            Assert.SeqEq(new[] { "view_owner", "viewport_sheet" }, g.Targets[3].Path.Select(p => p.Relationship));
            Assert.Eq(1L, g.Targets[3].SourceId);
            Assert.False(g.Targets.ContainsKey(1), "эх сурвалж зорилт биш");
        }

        [Test]
        public static void Graph_PathConfidence_IsWeakestLink_NeverUpgraded()
        {
            // 1 —B→ 2 —A→ 3 : дараагийн «шууд» холбоо нь B-г A болгож ДЭЭШЛҮҮЛЭХГҮЙ.
            ImpactGraph g = new ImpactGraphBuilder(new[] { Src(1) }, Graph(E(1, 2, ImpactConfidence.B), E(2, 3, ImpactConfidence.A))).RunAll();
            Assert.Eq(ImpactConfidence.B, g.Targets[2].Confidence);
            Assert.Eq(ImpactConfidence.B, g.Targets[3].Confidence, "A холбоо B замыг дээшлүүлэхгүй");
            // C → B → A
            ImpactGraph g2 = new ImpactGraphBuilder(new[] { Src(1) }, Graph(E(1, 2, ImpactConfidence.C), E(2, 3, ImpactConfidence.B), E(3, 4, ImpactConfidence.A))).RunAll();
            Assert.Eq(ImpactConfidence.C, g2.Targets[4].Confidence);
        }

        [Test]
        public static void Graph_StrongestPathWins_EvenIfLonger()
        {
            // 1 —C→ 9 (богино, сул); 1 —A→ 2 —A→ 3 —A→ 9 (урт, шууд) → 9 нь A.
            var edges = new[]
            {
                E(1, 9, ImpactConfidence.C, "visibility"),
                E(1, 2, ImpactConfidence.A), E(2, 3, ImpactConfidence.A), E(3, 9, ImpactConfidence.A, "viewport_sheet"),
            };
            ImpactGraph g = new ImpactGraphBuilder(new[] { Src(1) }, Graph(edges)).RunAll();
            Assert.Eq(ImpactConfidence.A, g.Targets[9].Confidence, "хамгийн хүчтэй зам");
            Assert.Eq(3, g.Targets[9].Depth);
            Assert.True(g.Targets[9].PathCount >= 2, "өөр зам ч олдсоныг тэмдэглэнэ");
        }

        [Test]
        public static void Graph_EqualConfidence_PrefersShorterPath()
        {
            var edges = new[] { E(1, 2, ImpactConfidence.B), E(2, 3, ImpactConfidence.B), E(3, 9, ImpactConfidence.B), E(1, 9, ImpactConfidence.B, "direct") };
            ImpactGraph g = new ImpactGraphBuilder(new[] { Src(1) }, Graph(edges)).RunAll();
            Assert.Eq(1, g.Targets[9].Depth);
            Assert.Eq("direct", g.Targets[9].Path.Single().Relationship);
        }

        [Test]
        public static void Graph_Cycles_Terminate_AndSelfLoopsAreIgnored()
        {
            var edges = new[] { E(1, 2, ImpactConfidence.A), E(2, 3, ImpactConfidence.A), E(3, 1, ImpactConfidence.A), E(3, 2, ImpactConfidence.A), E(2, 2, ImpactConfidence.A) };
            ImpactGraph g = new ImpactGraphBuilder(new[] { Src(1) }, Graph(edges)).RunAll();
            Assert.True(g.Complete);
            Assert.Eq(2, g.Targets.Count, "2 ба 3 л зорилт (1 нь эх сурвалж)");
            Assert.Eq(3, g.Expanded, "зангилаа бүр нэг л удаа дэлгэгдэнэ");
        }

        [Test]
        public static void Graph_MultipleSources_TargetUsesStrongestSource()
        {
            var edges = new[] { E(1, 9, ImpactConfidence.C), E(2, 9, ImpactConfidence.A, "view_owner") };
            ImpactGraph g = new ImpactGraphBuilder(new[] { Src(1), Src(2) }, Graph(edges)).RunAll();
            Assert.Eq(ImpactConfidence.A, g.Targets[9].Confidence);
            Assert.Eq(2L, g.Targets[9].SourceId);
        }

        [Test]
        public static void Graph_SourceReachedFromAnotherSource_StaysSource()
        {
            ImpactGraph g = new ImpactGraphBuilder(new[] { Src(1), Src(2) }, Graph(E(1, 2, ImpactConfidence.C), E(2, 3, ImpactConfidence.A))).RunAll();
            Assert.False(g.Targets.ContainsKey(2));
            Assert.Eq(ImpactConfidence.A, g.Targets[3].Confidence, "2 өөрөө өөрчлөгдсөн — түүнээс A холбоо хэвээр шууд");
            Assert.Eq(2L, g.Targets[3].SourceId);
        }

        [Test]
        public static void Graph_DepthLimit_StopsExpansion_AndNotesIt()
        {
            var edges = Enumerable.Range(1, 12).Select(i => E(i, i + 1, ImpactConfidence.A)).ToArray();
            var limits = new ImpactLimits { MaxDepth = 3 };
            ImpactGraph g = new ImpactGraphBuilder(new[] { Src(1) }, Graph(edges), limits).RunAll();
            Assert.True(g.Targets.ContainsKey(4), "гүн 3 хүртэл (4-р зангилаа гүн 3)");
            Assert.False(g.Targets.ContainsKey(5), "цааш дэлгэгдэхгүй");
            Assert.True(g.Notes.Any(n => n.Contains("гүнээс цааш")), string.Join("|", g.Notes));
        }

        [Test]
        public static void Graph_NodeLimit_IsReportedAsIncomplete()
        {
            var edges = Enumerable.Range(2, 200).Select(i => E(1, i, ImpactConfidence.B)).ToArray();
            var limits = new ImpactLimits { MaxNodes = 50, MaxEdgesPerNode = 1000 };
            ImpactGraph g = new ImpactGraphBuilder(new[] { Src(1) }, Graph(edges), limits).RunAll();
            Assert.False(g.Complete, "хязгаар хэтэрсэн бол бүрэн гэж ТООЦООГҮЙ");
            Assert.True(g.Targets.Count <= 50);
            Assert.True(g.Notes.Any(n => n.Contains("Зангилааны хязгаар")), string.Join("|", g.Notes));
        }

        [Test]
        public static void Graph_Fanout_KeepsStrongestEdges_AndSaysSo()
        {
            var edges = new List<ImpactEdge>();
            for (int i = 2; i < 12; i++) edges.Add(E(1, i, ImpactConfidence.D));       // 10 сул
            edges.Add(E(1, 100, ImpactConfidence.A));                                  // 1 хүчтэй
            var limits = new ImpactLimits { MaxEdgesPerNode = 3 };
            ImpactGraph g = new ImpactGraphBuilder(new[] { Src(1) }, Graph(edges.ToArray()), limits).RunAll();
            Assert.True(g.Targets.ContainsKey(100), "хамгийн хүчтэй холбоо ХАСАГДАХГҮЙ");
            Assert.Eq(3, g.Targets.Count);
            Assert.True(g.Notes.Any(n => n.Contains("Хэт олон холбоотой")), string.Join("|", g.Notes));
        }

        [Test]
        public static void Graph_ExpandThrows_IsRecorded_NotFatal()
        {
            Func<long, IReadOnlyList<ImpactEdge>> expand = id =>
            {
                if (id == 2) throw new InvalidOperationException("boom");
                if (id == 1) return new[] { E(1, 2, ImpactConfidence.A), E(1, 3, ImpactConfidence.A) };
                return new ImpactEdge[0];
            };
            ImpactGraph g = new ImpactGraphBuilder(new[] { Src(1) }, expand).RunAll();
            Assert.False(g.Complete);
            Assert.True(g.Targets.ContainsKey(3), "бусад зам үргэлжилнэ");
            Assert.True(g.Notes.Any(n => n.Contains("уншиж чадсангүй")));
        }

        [Test]
        public static void Graph_ExpansionLimit_StopsAndReports()
        {
            var edges = Enumerable.Range(1, 500).Select(i => E(i, i + 1, ImpactConfidence.A)).ToArray();
            var limits = new ImpactLimits { MaxExpansions = 10, MaxDepth = 1000, MaxNodes = 100000 };
            ImpactGraph g = new ImpactGraphBuilder(new[] { Src(1) }, Graph(edges), limits).RunAll();
            Assert.False(g.Complete);
            Assert.Eq(10, g.Expanded);
        }

        [Test]
        public static void Graph_SteppedExecution_EqualsSingleRun()
        {
            var rnd = new Random(7);
            var edges = new List<ImpactEdge>();
            for (int i = 0; i < 400; i++)
            {
                long a = rnd.Next(1, 120), b = rnd.Next(1, 120);
                if (a != b) edges.Add(E(a, b, (ImpactConfidence)rnd.Next(1, 5)));
            }
            var all = new ImpactGraphBuilder(new[] { Src(1), Src(2) }, Graph(edges.ToArray())).RunAll();
            var stepped = new ImpactGraphBuilder(new[] { Src(1), Src(2) }, Graph(edges.ToArray()));
            while (!stepped.Step(3)) { }
            ImpactGraph g2 = stepped.Build();
            Assert.Eq(all.Targets.Count, g2.Targets.Count);
            foreach (var kv in all.Targets)
            {
                Assert.Eq(kv.Value.Confidence, g2.Targets[kv.Key].Confidence, "зорилт " + kv.Key);
                Assert.Eq(kv.Value.Depth, g2.Targets[kv.Key].Depth, "гүн " + kv.Key);
            }
        }

        [Test]
        public static void Graph_RandomGraphs_ConfidenceIsExactlyWidestPath()
        {
            // Брут-форс (DFS) лавлагаатай харьцуулна: зорилт бүрийн итгэл = бүх замын хамгийн хүчтэй «хамгийн сул холбоо».
            for (int seed = 0; seed < 25; seed++)
            {
                var rnd = new Random(seed);
                int n = 9;
                var edges = new List<ImpactEdge>();
                for (int i = 0; i < 22; i++)
                {
                    long a = rnd.Next(1, n + 1), b = rnd.Next(1, n + 1);
                    if (a != b) edges.Add(E(a, b, (ImpactConfidence)rnd.Next(1, 5)));
                }
                var limits = new ImpactLimits { MaxDepth = 99 };
                ImpactGraph g = new ImpactGraphBuilder(new[] { Src(1) }, Graph(edges.ToArray()), limits).RunAll();

                var best = new Dictionary<long, int>();
                Action<long, int, HashSet<long>> dfs = null;
                dfs = (node, worst, visited) =>
                {
                    foreach (ImpactEdge e in edges.Where(x => x.From == node))
                    {
                        if (visited.Contains(e.To)) continue;
                        int w = Math.Max(worst, ImpactConf.Rank(e.Confidence));
                        int cur;
                        if (!best.TryGetValue(e.To, out cur) || w < cur) best[e.To] = w;
                        visited.Add(e.To);
                        dfs(e.To, w, visited);
                        visited.Remove(e.To);
                    }
                };
                dfs(1, 1, new HashSet<long> { 1 });
                best.Remove(1);

                Assert.Eq(best.Count, g.Targets.Count, "seed " + seed + ": зорилтын тоо");
                foreach (var kv in best)
                    Assert.Eq(kv.Value, ImpactConf.Rank(g.Targets[kv.Key].Confidence), "seed " + seed + ": зорилт " + kv.Key);
            }
        }

        [Test]
        public static void Graph_PathEdges_AreContiguous_FromSourceToTarget()
        {
            var edges = new[] { E(1, 2, ImpactConfidence.A), E(2, 3, ImpactConfidence.B), E(3, 4, ImpactConfidence.B), E(1, 4, ImpactConfidence.D) };
            ImpactGraph g = new ImpactGraphBuilder(new[] { Src(1) }, Graph(edges)).RunAll();
            ImpactTarget t = g.Targets[4];
            Assert.Eq(ImpactConfidence.B, t.Confidence, "B зам D шууд холбооноос хүчтэй");
            long prev = t.SourceId;
            foreach (ImpactEdge e in t.Path)
            {
                Assert.Eq(prev, e.From, "зам тасраагүй");
                prev = e.To;
            }
            Assert.Eq(4L, prev);
        }

        [Test]
        public static void Graph_Explainer_SeparatesDirectFromInferred()
        {
            var edges = new[] { E(1, 2, ImpactConfidence.B, "room_boundary", "өрөөний хил"), E(2, 3, ImpactConfidence.A, "view_owner", "харагдацад хамаарна") };
            ImpactGraph g = new ImpactGraphBuilder(new[] { Src(1) }, Graph(edges)).RunAll();
            List<string> lines = ImpactExplainer.Describe(g.Targets[3], id => "N" + id);
            string text = string.Join("\n", lines);
            Assert.True(text.Contains("[B таамаг]") && text.Contains("[A шууд]"), text);
            Assert.True(text.Contains("өрөөний хил"), "хамгийн сул холбоог нэрлэнэ: " + text);
            Assert.True(lines[0].Contains("N1") && lines[0].Contains("өөрчлөгдсөн"));
            string del = ImpactExplainer.Describe(g.Targets[3], id => "N" + id, ChangeKind.Deleted)[0];
            Assert.True(del.Contains("устсан"));
        }

        /* ------------------------------ ДУГААР ----------------------------- */

        [Test]
        public static void Seq_IsStrictlyIncreasing_EvenWhenClockStandsStillOrGoesBack()
        {
            ImpactSeq.ResetForTests();
            DateTime t = new DateTime(2026, 10, 1, 9, 0, 0, DateTimeKind.Utc);
            SmartClock.Override(() => t);
            try
            {
                long a = ImpactSeq.Next(), b = ImpactSeq.Next(), c = ImpactSeq.Next();
                Assert.True(a < b && b < c, "цаг зогссон ч өснө");
                t = t.AddMinutes(-5);   // цаг хойш зөрсөн
                long d = ImpactSeq.Next();
                Assert.True(d > c, "цаг хойш зөрсөн ч буурахгүй");
                t = t.AddMinutes(10);
                long e = ImpactSeq.Next();
                Assert.True(e > d);
            }
            finally { SmartClock.Override(null); ImpactSeq.ResetForTests(); }
        }

        [Test]
        public static void Seq_Mark_SeparatesBeforeFromAfter()
        {
            ImpactSeq.ResetForTests();
            DateTime t = new DateTime(2026, 10, 1, 9, 0, 0, DateTimeKind.Utc);
            SmartClock.Override(() => t);
            try
            {
                long before = ImpactSeq.Next();
                long mark = ImpactSeq.Mark();
                Assert.True(before <= mark);
                long after = ImpactSeq.Next();
                Assert.True(after > mark, "mark-ийн дараахь өөрчлөлт бүр түүнээс их");
                Assert.True(ImpactSeq.Mark() >= after);
            }
            finally { SmartClock.Override(null); ImpactSeq.ResetForTests(); }
        }

        [Test]
        public static void Seq_AcrossSessions_RemainsOrderedByTime()
        {
            ImpactSeq.ResetForTests();
            DateTime t = new DateTime(2026, 10, 1, 9, 0, 0, DateTimeKind.Utc);
            SmartClock.Override(() => t);
            try
            {
                long s1 = ImpactSeq.Next();
                ImpactSeq.ResetForTests();             // Revit дахин асав (тоолуур 0)
                t = t.AddHours(3);
                long s2 = ImpactSeq.Next();
                Assert.True(s2 > s1, "session хооронд ч дараалал хадгалагдана");
                Assert.True(Math.Abs((ImpactSeq.ToUtc(s2) - t).TotalSeconds) < 1, "дугаар → цаг буцаан хөрвөнө");
            }
            finally { SmartClock.Override(null); ImpactSeq.ResetForTests(); }
        }

        /* ---------------------------- БҮРТГЭЛ / ХАДГАЛАЛТ ------------------- */

        private static ChangeBatch Batch(long seq, int entries, ChangeKind kind = ChangeKind.Modified)
        {
            var b = new ChangeBatch { Seq = seq, Utc = new DateTime(2026, 10, 1, 9, 0, 0, DateTimeKind.Utc), Operation = "TransactionCommitted", Modified = entries };
            for (int i = 0; i < entries; i++) b.Entries.Add(new ChangeEntry { Id = seq * 1000 + i, Kind = kind, Uid = "u" + seq + "-" + i, Category = "Walls", Known = true });
            return b;
        }

        [Test]
        public static void ChangeLog_RoundTrip_PreservesEntries_AndOrdersBySeq()
        {
            string root = TestDirs.NewTemp();
            SmartPaths.OverrideRoot(root);
            try
            {
                DocumentKey key = DocumentKeyBuilder.Build(new DocumentFacts { CreationGuid = Guid.NewGuid().ToString() });
                var f = new ChangeLogFile { DroppedBatches = 3 };
                f.Batches.Add(Batch(20, 2));
                f.Batches.Add(Batch(10, 3, ChangeKind.Deleted));
                string err;
                Assert.True(ChangeLogStore.Save(key, f, out err), err);
                ChangeLogFile back = ChangeLogStore.Load(key);
                Assert.SeqEq(new long[] { 10, 20 }, back.Batches.Select(b => b.Seq));
                Assert.Eq(3, back.Batches[0].Entries.Count);
                Assert.Eq(ChangeKind.Deleted, back.Batches[0].Entries[0].Kind);
                Assert.Eq(3, back.DroppedBatches);
                Assert.True(back.Batches[0].Entries[0].Known);
            }
            finally { SmartPaths.OverrideRoot(null); }
        }

        [Test]
        public static void ChangeLog_Trim_DropsOldestBatches_ByCountAndEntries()
        {
            var f = new ChangeLogFile();
            for (int i = 1; i <= ChangeLogStore.MaxBatches + 25; i++) f.Batches.Add(Batch(i, 1));
            ChangeLogStore.Trim(f);
            Assert.Eq(ChangeLogStore.MaxBatches, f.Batches.Count);
            Assert.Eq(26L, f.Batches[0].Seq, "хамгийн хуучин нь хасагдсан");

            var big = new ChangeLogFile();
            for (int i = 1; i <= 30; i++) big.Batches.Add(Batch(i, 4000));      // 120 000 мөр > 80 000
            ChangeLogStore.Trim(big);
            Assert.True(big.Batches.Sum(b => b.Entries.Count) <= ChangeLogStore.MaxEntries);
            Assert.Eq(30L, big.Batches.Last().Seq, "хамгийн шинэ багц үлдэнэ");
        }

        [Test]
        public static void ChangeLog_UnknownEnumFromNewerFile_LoadsAsUnknown_NotCorrupt()
        {
            string json = "{\"batches\":[{\"seq\":5,\"entries\":[{\"id\":1,\"kind\":\"teleported\",\"nodeKind\":\"hologram\"}]}]}";
            ChangeLogFile f;
            Assert.True(SmartJson.TryDeserialize(json, out f));
            Assert.Eq(ChangeKind.Unknown, f.Batches[0].Entries[0].Kind, "танигдаагүй утга аюулгүй 0");
            Assert.Eq(ImpactNodeKind.Element, f.Batches[0].Entries[0].NodeKind);
        }

        [Test]
        public static void Checkpoints_AddAndPersist_NewestFirst_Bounded()
        {
            string root = TestDirs.NewTemp();
            SmartPaths.OverrideRoot(root);
            try
            {
                DocumentKey key = DocumentKeyBuilder.Build(new DocumentFacts { CreationGuid = Guid.NewGuid().ToString() });
                string err;
                for (int i = 0; i < CheckpointStore.MaxItems + 5; i++)
                    Assert.True(CheckpointStore.Add(key, new ModelCheckpoint { Utc = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddMinutes(i), Label = "cp" + i, ChangeSeq = i, Kind = "user" }, out err), err);
                CheckpointsFile f = CheckpointStore.Load(key);
                Assert.Eq(CheckpointStore.MaxItems, f.Items.Count);
                Assert.Eq("cp" + (CheckpointStore.MaxItems + 4), f.Items[0].Label, "хамгийн шинэ нь эхэнд");
            }
            finally { SmartPaths.OverrideRoot(null); }
        }

        [Test]
        public static void ReportStore_SavesLast_AndHistoryHeaders_AndTruncatesHugeReports()
        {
            string root = TestDirs.NewTemp();
            SmartPaths.OverrideRoot(root);
            try
            {
                DocumentKey key = DocumentKeyBuilder.Build(new DocumentFacts { CreationGuid = Guid.NewGuid().ToString() });
                var r = new ImpactReport { Utc = DateTime.UtcNow, Status = RunStatus.Succeeded, SourceCount = 3 };
                r.Items.Add(new ImpactItem { Id = 1, Kind = ImpactNodeKind.Sheet, Confidence = ImpactConfidence.A, Name = "A-101" });
                r.Items.Add(new ImpactItem { Id = 2, Kind = ImpactNodeKind.View, Confidence = ImpactConfidence.B, Name = "Plan" });
                string err;
                Assert.True(ImpactReportStore.Save(key, r, out err), err);
                ImpactReportFile f = ImpactReportStore.Load(key);
                Assert.Eq(2, f.Last.Items.Count);
                Assert.Eq(1, f.History.Count);
                Assert.Eq(1, f.History[0].Sheets);
                Assert.Eq(1, f.History[0].DirectCount);

                var huge = new ImpactReport { Utc = DateTime.UtcNow, Status = RunStatus.Succeeded };
                for (int i = 0; i < ImpactReportStore.MaxItems + 50; i++)
                    huge.Items.Add(new ImpactItem { Id = i, Kind = i % 100 == 0 ? ImpactNodeKind.Sheet : ImpactNodeKind.Element, Confidence = (ImpactConfidence)(1 + i % 4) });
                Assert.True(ImpactReportStore.Save(key, huge, out err), err);
                ImpactReportFile f2 = ImpactReportStore.Load(key);
                Assert.Eq(ImpactReportStore.MaxItems, f2.Last.Items.Count);
                Assert.True(f2.Last.Incomplete && f2.Last.Notes.Any(n => n.Contains("таслав")), "таслагдсаныг ИЛ хэлнэ");
                Assert.True(f2.Last.Items.Take(10).All(i => i.Kind == ImpactNodeKind.Sheet), "хуудсууд эхэнд үлдсэн");
                Assert.Eq(2, f2.History.Count);
            }
            finally { SmartPaths.OverrideRoot(null); }
        }

        [Test]
        public static void NodeLabel_UsesNameOrFallsBackToUnknownMarker()
        {
            var known = new ImpactNode { Id = 5, Category = "Walls", Name = "Basic Wall 200" };
            Assert.True(known.Label.Contains("Basic Wall 200") && known.Label.Contains("#5"), known.Label);
            var gone = new ImpactNode { Id = 77, Unknown = true };
            Assert.True(gone.Label.Contains("мэдээлэл алга") && gone.Label.Contains("#77"), gone.Label);
        }
    }
}
