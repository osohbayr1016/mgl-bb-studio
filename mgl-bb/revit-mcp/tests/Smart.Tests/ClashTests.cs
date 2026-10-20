using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.Smart.Core;
using RevitMcpAddin.ClashCheck.Core;

namespace RevitMcpAddin.Smart.Tests
{
    public static class ClashTests
    {
        private static readonly DateTime T0 = new DateTime(2026, 10, 1, 9, 0, 0, DateTimeKind.Utc);

        private static ClashRule Rule(string cA = "OST_PipeCurves", string cB = "OST_StructuralFraming")
        {
            return new ClashRule
            {
                Id = "rule1", Name = "Хоолой ↔ Дам",
                A = new ClashSelector { Categories = { cA } },
                B = new ClashSelector { Categories = { cB } },
            };
        }

        private static ElementKey K(string uid) { return ElementKey.Host("doc:p", uid); }

        /* ------------------------------ RULE LOGIC ------------------------ */

        [Test]
        public static void Rule_SymmetricWhenSelectorsEqual_CaseAndOrderInsensitive()
        {
            var r = new ClashRule
            {
                A = new ClashSelector { Categories = { "OST_PipeCurves", "OST_DuctCurves" } },
                B = new ClashSelector { Categories = { "ost_ductcurves", "OST_PipeCurves" } },
            };
            Assert.True(r.Symmetric);
            Assert.False(Rule().Symmetric);
            r.B.Source = ClashSource.Links;
            Assert.False(r.Symmetric);
        }

        [Test]
        public static void Rule_SemanticHash_IgnoresNameEnabledSeverity_ButNotSelectorsOrThreshold()
        {
            string h = ClashRuleLogic.SemanticHash(Rule());
            ClashRule r = Rule();
            r.Name = "Өөр нэр"; r.Enabled = false; r.Severity = ClashSeverity.Critical;
            Assert.Eq(h, ClashRuleLogic.SemanticHash(r), "нэр/идэвхтэй/ноцтой байдал үр дүнд нөлөөлөхгүй");

            r.A.Categories.Add("OST_DuctCurves");
            Assert.False(h == ClashRuleLogic.SemanticHash(r), "ангилал нэмбэл хэш өөр");
            r = Rule(); r.MinVolumeCm3 = 50;
            Assert.False(h == ClashRuleLogic.SemanticHash(r), "босго өөр");
            r = Rule(); r.IgnoreJoined = false;
            Assert.False(h == ClashRuleLogic.SemanticHash(r), "алгасах туг өөр");
            r = Rule(); r.B.NameContains = "300";
            Assert.False(h == ClashRuleLogic.SemanticHash(r));
        }

        [Test]
        public static void Rule_SemanticHash_CategoryOrderAndCaseDoNotMatter()
        {
            ClashRule a = Rule(); a.A.Categories = new List<string> { "OST_PipeCurves", "OST_DuctCurves" };
            ClashRule b = Rule(); b.A.Categories = new List<string> { "ost_ductcurves", "OST_PIPECURVES" };
            Assert.Eq(ClashRuleLogic.SemanticHash(a), ClashRuleLogic.SemanticHash(b));
        }

        [Test]
        public static void Fingerprint_IsOrderIndependent_AndRuleAware()
        {
            string f1 = ClashRuleLogic.Fingerprint("r", "h", K("a"), K("b"));
            string f2 = ClashRuleLogic.Fingerprint("r", "h", K("b"), K("a"));
            Assert.Eq(f1, f2);
            Assert.Eq(16, f1.Length);
            Assert.False(f1 == ClashRuleLogic.Fingerprint("r2", "h", K("a"), K("b")), "өөр дүрэм");
            Assert.False(f1 == ClashRuleLogic.Fingerprint("r", "h2", K("a"), K("b")), "өөр хэш");
            Assert.False(f1 == ClashRuleLogic.Fingerprint("r", "h", K("a"), K("c")), "өөр элемент");
        }

        [Test]
        public static void Fingerprint_DistinguishesLinkInstances_OfSameLinkedElement()
        {
            ElementKey host = K("beam1");
            ElementKey l1 = ElementKey.Linked("doc:p", "inst1", "doc:link", "pipe9");
            ElementKey l2 = ElementKey.Linked("doc:p", "inst2", "doc:link", "pipe9");
            Assert.False(ClashRuleLogic.Fingerprint("r", "h", host, l1) == ClashRuleLogic.Fingerprint("r", "h", host, l2));
        }

        [Test]
        public static void Fingerprint_DeletedAndRecreatedElement_IsNewIdentity()
        {
            Assert.False(ClashRuleLogic.Fingerprint("r", "h", K("a"), K("b")) == ClashRuleLogic.Fingerprint("r", "h", K("a"), K("b-recreated")));
        }

        [Test]
        public static void Validate_Rule()
        {
            Assert.True(ClashRuleLogic.IsRunnable(ClashRuleLogic.Validate(Rule())));
            ClashRule noCat = Rule(); noCat.A.Categories.Clear();
            Assert.False(ClashRuleLogic.IsRunnable(ClashRuleLogic.Validate(noCat)));
            ClashRule clearance = Rule(); clearance.Mode = ClashMode.Clearance;
            List<RuleIssue> issues = ClashRuleLogic.Validate(clearance);
            Assert.False(ClashRuleLogic.IsRunnable(issues));
            Assert.True(issues.Any(i => i.Message.Contains("ДЭМЖИГДЭХГҮЙ")), "clearance-ийг чимээгүй «шалгасан» мэт яваахгүй");
            ClashRule unknown = Rule(); unknown.Mode = ClashMode.Unknown;
            Assert.False(ClashRuleLogic.IsRunnable(ClashRuleLogic.Validate(unknown)));
            ClashRule neg = Rule(); neg.MinVolumeCm3 = -1;
            Assert.False(ClashRuleLogic.IsRunnable(ClashRuleLogic.Validate(neg)));
            ClashRule noName = Rule(); noName.Name = " ";
            Assert.False(ClashRuleLogic.IsRunnable(ClashRuleLogic.Validate(noName)));
        }

        [Test]
        public static void RuleStore_SeedsStarters_Once_AndRoundTrips()
        {
            var store = new SmartStore(TestDirs.NewTemp());
            ClashRulesFile f = ClashRuleStore.Load(store);
            Assert.Eq(5, f.Rules.Count);
            Assert.True(f.Rules.All(r => ClashRuleLogic.IsRunnable(ClashRuleLogic.Validate(r))), "бүх жишээ дүрэм ажиллах боломжтой байх ёстой");
            ClashRule edit = f.Rules[0].Clone();
            edit.A.Categories.Add("OST_Conduit");
            edit.IgnoreJoined = false;
            ClashRuleStore.Upsert(f, edit);
            Assert.True(ClashRuleStore.Save(f, store));
            ClashRule back = ClashRuleStore.Load(store).Rules.Single(r => r.Id == edit.Id);
            Assert.True(back.A.Categories.Contains("OST_Conduit"));
            Assert.False(back.IgnoreJoined);
            Assert.Eq(ClashMode.HardIntersection, back.Mode);
        }

        /* ------------------------------ SPATIAL --------------------------- */

        private static List<Aabb> RandomBoxes(Random rnd, int n, double world, double maxSize)
        {
            var l = new List<Aabb>(n);
            for (int i = 0; i < n; i++)
            {
                double x = rnd.NextDouble() * world, y = rnd.NextDouble() * world, z = rnd.NextDouble() * world / 4;
                l.Add(new Aabb(x, y, z, x + rnd.NextDouble() * maxSize, y + rnd.NextDouble() * maxSize, z + rnd.NextDouble() * maxSize));
            }
            return l;
        }

        private static HashSet<long> Brute(IReadOnlyList<Aabb> a, IReadOnlyList<Aabb> b, bool sym, double inflate)
        {
            var set = new HashSet<long>();
            for (int i = 0; i < a.Count; i++)
                for (int j = 0; j < b.Count; j++)
                {
                    if (sym && j <= i) continue;
                    Aabb bj = b[j];
                    Aabb ai = a[i];
                    if (ai.Overlaps(ref bj, inflate)) set.Add(((long)i << 32) | (uint)j);
                }
            return set;
        }

        [Test]
        public static void Spatial_MatchesBruteForce_TwoSets()
        {
            var rnd = new Random(7);
            List<Aabb> a = RandomBoxes(rnd, 400, 50000, 3000);
            List<Aabb> b = RandomBoxes(rnd, 500, 50000, 6000);
            var gen = new CandidateGenerator(a, b, false, 0, 10_000_000);
            HashSet<long> got = new HashSet<long>(gen.RunAll());
            HashSet<long> want = Brute(a, b, false, 0);
            Assert.Eq(want.Count, got.Count, "хосын тоо");
            Assert.True(got.SetEquals(want), "хосууд таарах ёстой");
            Assert.True(want.Count > 0);
        }

        [Test]
        public static void Spatial_MatchesBruteForce_Symmetric_WithInflate()
        {
            var rnd = new Random(11);
            List<Aabb> a = RandomBoxes(rnd, 600, 40000, 2500);
            var gen = new CandidateGenerator(a, a, true, 150, 10_000_000);
            HashSet<long> got = new HashSet<long>(gen.RunAll());
            HashSet<long> want = Brute(a, a, true, 150);
            Assert.True(got.SetEquals(want), "got=" + got.Count + " want=" + want.Count);
            // Симметр: өөртэйгөө биш, a<b.
            Assert.True(got.All(p => CandidateGenerator.PairA(p) < CandidateGenerator.PairB(p)));
        }

        [Test]
        public static void Spatial_VeryLongElements_GoThroughBigList_AndStillMatch()
        {
            var rnd = new Random(3);
            List<Aabb> b = RandomBoxes(rnd, 300, 30000, 1500);
            // 80 м хоолой (X тэнхлэгийн дагуу) — олон нүд хамарна.
            b.Add(new Aabb(-5000, 15000, 100, 75000, 15200, 300));
            b.Add(new Aabb(0, 0, 0, 90000, 90000, 40000));   // бүх зүйлтэй давхцах том
            List<Aabb> a = RandomBoxes(rnd, 200, 30000, 2000);
            a.Add(new Aabb(-2000, 14000, 0, 80000, 16000, 500));   // урт A
            var gen = new CandidateGenerator(a, b, false, 0, 10_000_000);
            gen.BuildIndex();
            Assert.True(gen.BigCount >= 1, "хамгийн том элемент big жагсаалтад: " + gen.BigCount);
            HashSet<long> got = new HashSet<long>(gen.RunAll());
            Assert.True(got.SetEquals(Brute(a, b, false, 0)));
        }

        [Test]
        public static void Spatial_GridBudgetExhausted_FallsBackToBigList_AndStillMatches()
        {
            var rnd = new Random(29);
            List<Aabb> a = RandomBoxes(rnd, 300, 30000, 2000);
            List<Aabb> b = RandomBoxes(rnd, 400, 30000, 4000);
            // Торын төсөв ЯГ 40 бичлэг — бараг бүх элемент `big` руу унана.  Хос бүрэн ижил байх ёстой (зөвхөн удаан).
            var tiny = new CandidateGenerator(a, b, false, 0, 10_000_000, maxGridEntries: 40);
            tiny.BuildIndex();
            Assert.True(tiny.BigCount > 300, "төсөв дуусахад ихэнх нь big: " + tiny.BigCount);
            var got = new HashSet<long>(tiny.RunAll());
            Assert.True(got.SetEquals(Brute(a, b, false, 0)), "budget fallback нь хосыг алдаж болохгүй");

            var normal = new CandidateGenerator(a, b, false, 0, 10_000_000);
            Assert.True(new HashSet<long>(normal.RunAll()).SetEquals(got));
        }

        [Test]
        public static void Spatial_ItemsOverCellLimit_GoBig_NotTheGrid()
        {
            // 216-аас олон нүд хамарсан элемент (хэт урт) — тор биш big.
            var rnd = new Random(31);
            List<Aabb> b = RandomBoxes(rnd, 200, 20000, 800);
            b.Add(new Aabb(0, 0, 0, 1000000, 300, 300));        // 1 км урт шугам — нүдний хэмжээнээс үл хамааран 216-аас олон нүд
            var gen = new CandidateGenerator(RandomBoxes(rnd, 50, 20000, 800), b, false, 0, 10_000_000);
            gen.BuildIndex();
            Assert.True(gen.BigCount >= 1);
            Assert.True(CandidateGenerator.MaxCellsPerItem <= 216, "нэг элементийн нүдний дээд хязгаар бууруулсан");
        }

        [Test]
        public static void StateStore_Trim_DropsOldestResolvedOnly_AndKeepsActive()
        {
            var s = new ClashState { Issues = new List<ClashIssue>(), Runs = new List<ClashRunRecord>() };
            int total = ClashStateStore.MaxIssues + 300;
            for (int i = 0; i < total; i++)
            {
                bool resolved = i % 2 == 0;
                s.Issues.Add(new ClashIssue
                {
                    Fingerprint = "fp" + i,
                    Status = resolved ? ClashStatus.Resolved : ClashStatus.New,
                    LastSeenUtc = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddMinutes(i),
                    ResolvedUtc = resolved ? (DateTime?)new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddMinutes(i) : null,
                });
            }
            ClashStateStore.Trim(s);
            Assert.Eq(ClashStateStore.MaxIssues, s.Issues.Count, "яг хязгаар хүртэл");
            Assert.True(s.Issues.Count(i => i.Status == ClashStatus.New) == total / 2, "идэвхтэй issue ХЭЗЭЭ Ч хасагдахгүй");
            Assert.False(s.Issues.Any(i => i.Fingerprint == "fp0"), "хамгийн хуучин Resolved хасагдсан");
        }

        [Test]
        public static void Spatial_Overflow_StopsAndFlags()
        {
            // Бүх хайрцаг бүгдтэй давхцана → хос тэсэрнэ.
            var a = Enumerable.Range(0, 300).Select(i => new Aabb(0, 0, 0, 1000, 1000, 1000)).ToList();
            var gen = new CandidateGenerator(a, a, true, 0, 5000);
            gen.RunAll();
            Assert.True(gen.Overflow);
            Assert.True(gen.Pairs.Count <= 5000);
        }

        [Test]
        public static void Spatial_Incremental_Steps_GiveSameResult_AsOneShot()
        {
            var rnd = new Random(21);
            List<Aabb> a = RandomBoxes(rnd, 500, 30000, 2500);
            List<Aabb> b = RandomBoxes(rnd, 500, 30000, 2500);
            var one = new CandidateGenerator(a, b, false, 0, 10_000_000);
            var set1 = new HashSet<long>(one.RunAll());
            var inc = new CandidateGenerator(a, b, false, 0, 10_000_000);
            inc.BuildIndex();
            int steps = 0;
            while (!inc.Step(37)) steps++;
            Assert.True(steps >= 10, "олон алхмаар");
            Assert.True(new HashSet<long>(inc.Pairs).SetEquals(set1));
        }

        [Test]
        public static void Spatial_EmptyAndInvalidBoxes_AreSafe()
        {
            var empty = new CandidateGenerator(new List<Aabb>(), new List<Aabb>(), false, 0, 100);
            Assert.Eq(0, empty.RunAll().Count);
            var bad = new List<Aabb> { new Aabb(double.NaN, 0, 0, 1, 1, 1), new Aabb(5, 5, 5, 1, 1, 1), new Aabb(0, 0, 0, 10, 10, 10) };
            var gen = new CandidateGenerator(bad, bad, true, 0, 100);
            Assert.Eq(0, gen.RunAll().Count, "зөвхөн хүчинтэй нэг хайрцаг л үлдсэн — хос байхгүй");
        }

        [Test]
        public static void Spatial_TouchingBoxes_CountAsOverlap_NegativeCoordinatesWork()
        {
            var a = new List<Aabb> { new Aabb(-1000, -1000, -1000, 0, 0, 0) };
            var b = new List<Aabb> { new Aabb(0, 0, 0, 500, 500, 500), new Aabb(1, 1, 1, 5, 5, 5) };
            var got = new CandidateGenerator(a, b, false, 0, 100).RunAll();
            Assert.SeqEq(new[] { 0 }, got.Select(CandidateGenerator.PairB), "хил хүрэлцсэн = давхцсан; тусдаа нь үгүй");
            var inflated = new CandidateGenerator(a, b, false, 2, 100).RunAll();
            Assert.Eq(2, inflated.Count, "2 мм тэлэхэд хоёр дахь нь орно");
        }

        [Test]
        public static void Spatial_ScalesNearLinear_NotQuadratic()
        {
            var rnd = new Random(5);
            List<Aabb> a = RandomBoxes(rnd, 40000, 400000, 1500);
            List<Aabb> b = RandomBoxes(rnd, 40000, 400000, 1500);
            var sw = System.Diagnostics.Stopwatch.StartNew();
            var gen = new CandidateGenerator(a, b, false, 0, 50_000_000);
            gen.RunAll();
            sw.Stop();
            // 40k × 40k = 1.6 тэрбум харьцуулалт байх байсан; тор нь секундын дотор.
            Assert.True(sw.ElapsedMilliseconds < 8000, "хэт удаан: " + sw.ElapsedMilliseconds + " мс");
            Assert.False(gen.Overflow);
        }

        [Test]
        public static void Aabb_Intersection_AndUnion()
        {
            var a = new Aabb(0, 0, 0, 10, 10, 10);
            var b = new Aabb(5, 5, 5, 20, 20, 20);
            Aabb i = Aabb.Intersection(a, b);
            Assert.True(i.IsValid);
            Assert.Near(5, i.MinX, 0); Assert.Near(10, i.MaxX, 0);
            Aabb none = Aabb.Intersection(a, new Aabb(50, 50, 50, 60, 60, 60));
            Assert.False(none.IsValid);
            Aabb u = Aabb.Union(a, b);
            Assert.Near(20, u.MaxZ, 0);
            Assert.Near(7.5, i.Center()[0], 1e-9);
            Assert.Near(7.5, i.Center()[2], 1e-9);
        }

        /* ------------------------------ RECONCILE ------------------------- */

        private static DetectedClash Det(string a, string b, string rule = "rule1", string hash = "H1", double vol = 100)
        {
            return new DetectedClash
            {
                Fingerprint = ClashRuleLogic.Fingerprint(rule, hash, K(a), K(b)),
                A = new ClashElementInfo { Key = K(a).ToString(), Category = "Pipes" },
                B = new ClashElementInfo { Key = K(b).ToString(), Category = "Beams" },
                VolumeCm3 = vol, Point = new[] { 1.0, 2.0, 3.0 }, Level = "Level 1",
            };
        }

        private static ReconcileInput Input(IReadOnlyList<DetectedClash> det, bool complete = true, Func<ClashIssue, PairState> state = null, string hash = "H1")
        {
            return new ReconcileInput { RuleId = "rule1", RuleName = "R", RuleHash = hash, Detected = det, RunComplete = complete, StateOf = state };
        }

        private static ReconcileResult Run(List<ClashIssue> prev, ReconcileInput input, DateTime? now = null)
        {
            return ClashReconciler.Reconcile(prev, input, now ?? T0);
        }

        [Test]
        public static void Reconcile_FirstRun_AllNew()
        {
            ReconcileResult r = Run(new List<ClashIssue>(), Input(new[] { Det("p1", "b1"), Det("p2", "b1") }));
            Assert.Eq(2, r.New);
            Assert.True(r.Issues.All(i => i.Status == ClashStatus.New && i.TimesSeen == 1 && i.FirstSeenUtc == T0));
        }

        [Test]
        public static void Reconcile_Rerun_PreservesStatuses_AcceptedStaysAccepted()
        {
            ReconcileResult first = Run(new List<ClashIssue>(), Input(new[] { Det("p1", "b1"), Det("p2", "b1") }));
            ClashIssue p1 = first.Issues.Single(i => i.A.Key == K("p1").ToString());
            string err;
            Assert.True(ClashReconciler.TrySetStatus(p1, ClashStatus.Accepted, "Зөвшөөрсөн — манжет тавина", T0.AddHours(1), out err));
            ClashIssue p2 = first.Issues.Single(i => i.A.Key == K("p2").ToString());
            Assert.True(ClashReconciler.TrySetStatus(p2, ClashStatus.Reviewed, null, T0.AddHours(1), out err));

            ReconcileResult second = Run(first.Issues, Input(new[] { Det("p1", "b1", vol: 120), Det("p2", "b1") }), T0.AddDays(1));
            Assert.Eq(0, second.New);
            Assert.Eq(2, second.Updated);
            Assert.Eq(ClashStatus.Accepted, second.Issues.Single(i => i.A.Key == K("p1").ToString()).Status, "Accepted дахин New болохгүй");
            Assert.Eq(ClashStatus.Reviewed, second.Issues.Single(i => i.A.Key == K("p2").ToString()).Status);
            ClashIssue u1 = second.Issues.Single(i => i.A.Key == K("p1").ToString());
            Assert.Eq(2, u1.TimesSeen);
            Assert.Eq(T0.AddDays(1), u1.LastSeenUtc);
            Assert.Eq(T0, u1.FirstSeenUtc);
            Assert.Near(120, u1.VolumeCm3, 0, "хэмжээ шинэчлэгдэнэ");
        }

        [Test]
        public static void Reconcile_SlightGeometryMove_KeepsSameIssue()
        {
            // Fingerprint координатаас хамаарахгүй → ижил хос, өөр цэг = ижил issue.
            ReconcileResult first = Run(new List<ClashIssue>(), Input(new[] { Det("p1", "b1") }));
            DetectedClash moved = Det("p1", "b1");
            moved.Point = new[] { 1000.0, 2000.0, 3000.0 };
            ReconcileResult second = Run(first.Issues, Input(new[] { moved }));
            Assert.Eq(1, second.Issues.Count);
            Assert.Eq(0, second.New);
            Assert.Near(1000, second.Issues[0].Point[0], 0);
        }

        [Test]
        public static void Reconcile_Missing_WithEvidence_BecomesResolved_WithReason()
        {
            ReconcileResult first = Run(new List<ClashIssue>(), Input(new[] { Det("p1", "b1"), Det("p2", "b1"), Det("p3", "b1") }));
            Func<ClashIssue, PairState> state = i =>
            {
                if (i.A.Key == K("p1").ToString()) return PairState.ElementMissing;
                if (i.A.Key == K("p2").ToString()) return PairState.NoLongerOverlapping;
                return PairState.NoClash;
            };
            ReconcileResult second = Run(first.Issues, Input(new DetectedClash[0], true, state), T0.AddDays(2));
            Assert.Eq(3, second.Resolved);
            Assert.True(second.Issues.All(i => i.Status == ClashStatus.Resolved && i.ResolvedUtc == T0.AddDays(2)));
            Assert.SeqEq(new[] { "deleted", "moved_apart", "rerun" }, second.Issues.OrderBy(i => i.A.Key).Select(i => i.History.Last().Reason));
        }

        [Test]
        public static void Reconcile_Missing_WithoutEvidence_IsNeverResolved_ButMarkedUnverified()
        {
            ReconcileResult first = Run(new List<ClashIssue>(), Input(new[] { Det("p1", "b1"), Det("p2", "b1") }));
            Func<ClashIssue, PairState> state = i => i.A.Key == K("p1").ToString() ? PairState.Unverified : PairState.NotEvaluated;
            ReconcileResult second = Run(first.Issues, Input(new DetectedClash[0], true, state));
            Assert.Eq(0, second.Resolved);
            Assert.Eq(2, second.Unverified);
            Assert.True(second.Issues.All(i => i.Status == ClashStatus.New && i.Unverified));
            // StateOf байхгүй бол ч нотолгоогүй.
            ReconcileResult noState = Run(first.Issues, Input(new DetectedClash[0], true, null));
            Assert.Eq(0, noState.Resolved);
        }

        [Test]
        public static void Reconcile_IgnoredByDesign_ResolvesWithOwnReason()
        {
            ReconcileResult first = Run(new List<ClashIssue>(), Input(new[] { Det("p1", "b1") }));
            ReconcileResult second = Run(first.Issues, Input(new DetectedClash[0], true, i => PairState.IgnoredByDesign), T0.AddDays(1));
            Assert.Eq(1, second.Resolved);
            Assert.Eq(ClashStatus.Resolved, second.Issues[0].Status);
            Assert.Eq("ignored_by_design", second.Issues[0].History.Last().Reason);
            // Цуцлагдсан гүйлтэд энэ нотолгоо ч хүчингүй.
            ReconcileResult incomplete = Run(first.Issues, Input(new DetectedClash[0], false, i => PairState.IgnoredByDesign), T0.AddDays(1));
            Assert.Eq(0, incomplete.Resolved);
        }

        [Test]
        public static void Reconcile_IncompleteRun_ResolvesNothing()
        {
            ReconcileResult first = Run(new List<ClashIssue>(), Input(new[] { Det("p1", "b1") }));
            ReconcileResult cancelled = Run(first.Issues, Input(new DetectedClash[0], false, i => PairState.NoClash));
            Assert.Eq(0, cancelled.Resolved);
            Assert.Eq(ClashStatus.New, cancelled.Issues[0].Status);
            Assert.False(cancelled.Issues[0].Unverified, "цуцлагдсан гүйлт «баталгаагүй» гэж ч тэмдэглэхгүй");
        }

        [Test]
        public static void Reconcile_ResolvedThenReappears_BecomesNew_WithHistory()
        {
            ReconcileResult first = Run(new List<ClashIssue>(), Input(new[] { Det("p1", "b1") }));
            ReconcileResult second = Run(first.Issues, Input(new DetectedClash[0], true, i => PairState.NoClash), T0.AddDays(1));
            Assert.Eq(ClashStatus.Resolved, second.Issues[0].Status);
            ReconcileResult third = Run(second.Issues, Input(new[] { Det("p1", "b1") }), T0.AddDays(2));
            Assert.Eq(1, third.Reappeared);
            ClashIssue i3 = third.Issues[0];
            Assert.Eq(ClashStatus.New, i3.Status);
            Assert.Null(i3.ResolvedUtc);
            Assert.Eq("reappeared", i3.History.Last().Reason);
            Assert.Eq(1, third.Issues.Count, "шинэ мөр үүсэхгүй — ижил issue дахин нээгдэв");
        }

        [Test]
        public static void Reconcile_RuleHashChange_LeavesOldIssuesUntouched_AsHistory()
        {
            ReconcileResult first = Run(new List<ClashIssue>(), Input(new[] { Det("p1", "b1", hash: "H1") }, hash: "H1"));
            string err;
            ClashReconciler.TrySetStatus(first.Issues[0], ClashStatus.Accepted, "ok", T0, out err);
            // Дүрэм өөрчлөгдсөн (H2): ижил хос шинэ хэшээр ШИНЭ issue; хуучин Accepted хөндөгдөхгүй, Resolved ч болохгүй.
            ReconcileResult second = Run(first.Issues, Input(new[] { Det("p1", "b1", hash: "H2") }, true, i => PairState.NoClash, "H2"));
            Assert.Eq(2, second.Issues.Count);
            ClashIssue old = second.Issues.Single(i => i.RuleHash == "H1");
            Assert.Eq(ClashStatus.Accepted, old.Status, "хуучин хувилбарын шийдвэр чимээгүй шинэ тохиргоонд шилжихгүй");
            Assert.Eq(ClashStatus.New, second.Issues.Single(i => i.RuleHash == "H2").Status);
            Assert.Eq(0, second.Resolved);
        }

        [Test]
        public static void Reconcile_OtherRulesIssues_AreUntouched()
        {
            var other = new ClashIssue { Fingerprint = "zzz", RuleId = "other-rule", RuleHash = "H1", Status = ClashStatus.Accepted };
            ReconcileResult r = Run(new List<ClashIssue> { other }, Input(new DetectedClash[0], true, i => PairState.NoClash));
            Assert.Eq(ClashStatus.Accepted, r.Issues[0].Status);
            Assert.Eq(0, r.Resolved);
        }

        [Test]
        public static void Reconcile_DuplicateDetections_CollapseToOneIssue()
        {
            ReconcileResult r = Run(new List<ClashIssue>(), Input(new[] { Det("p1", "b1"), Det("b1", "p1") }));
            Assert.Eq(1, r.Issues.Count, "A/B дараалал солигдсон ижил хос");
        }

        [Test]
        public static void Reconcile_UnknownStatusFromFile_BecomesNew()
        {
            var i = new ClashIssue { Fingerprint = "x", RuleId = "rule1", RuleHash = "H1", Status = ClashStatus.Unknown };
            ClashReconciler.Normalize(i);
            Assert.Eq(ClashStatus.New, i.Status);
        }

        /* ---------------------------- MANUAL STATUS ----------------------- */

        [Test]
        public static void Status_User_CannotSetResolved_OrReopenResolved()
        {
            ReconcileResult first = Run(new List<ClashIssue>(), Input(new[] { Det("p1", "b1") }));
            ClashIssue i = first.Issues[0];
            string err;
            Assert.False(ClashReconciler.TrySetStatus(i, ClashStatus.Resolved, null, T0, out err));
            Assert.True(err.Contains("дахин шалгалт"), err);
            Assert.True(ClashReconciler.TrySetStatus(i, ClashStatus.Reviewed, "харлаа", T0, out err));
            Assert.Eq("харлаа", i.Note);
            Assert.Eq("user", i.History.Last().Reason);

            ReconcileResult res = Run(first.Issues, Input(new DetectedClash[0], true, x => PairState.NoClash));
            Assert.False(ClashReconciler.TrySetStatus(res.Issues[0], ClashStatus.New, null, T0, out err), "Resolved-ийг гараар сэргээхгүй");
        }

        [Test]
        public static void Status_History_RecordsEveryTransition()
        {
            ReconcileResult first = Run(new List<ClashIssue>(), Input(new[] { Det("p1", "b1") }));
            ClashIssue i = first.Issues[0];
            string err;
            ClashReconciler.TrySetStatus(i, ClashStatus.Reviewed, null, T0.AddHours(1), out err);
            ClashReconciler.TrySetStatus(i, ClashStatus.Accepted, "тайлбар", T0.AddHours(2), out err);
            ClashReconciler.TrySetStatus(i, ClashStatus.New, null, T0.AddHours(3), out err);
            Assert.SeqEq(new[] { ClashStatus.New, ClashStatus.Reviewed, ClashStatus.Accepted, ClashStatus.New }, i.History.Select(h => h.To));
        }

        /* ------------------------------ STATE STORE ----------------------- */

        [Test]
        public static void StateStore_RoundTrip_AndTrim_KeepsActiveDropsOldResolved()
        {
            string root = TestDirs.NewTemp();
            SmartPaths.OverrideRoot(root);
            try
            {
                DocumentKey key = DocumentKeyBuilder.Build(new DocumentFacts { CreationGuid = Guid.NewGuid().ToString() });
                var s = new ClashState();
                s.Issues.Add(new ClashIssue { Fingerprint = "a", RuleId = "r", RuleHash = "h", Status = ClashStatus.Accepted, A = new ClashElementInfo { Category = "Хоолой" } });
                string err;
                Assert.True(ClashStateStore.Save(key, s, out err), err);
                ClashState back = ClashStateStore.Load(key);
                Assert.Eq(1, back.Issues.Count);
                Assert.Eq("Хоолой", back.Issues[0].A.Category);

                var big = new ClashState();
                for (int i = 0; i < ClashStateStore.MaxIssues + 100; i++)
                    big.Issues.Add(new ClashIssue { Fingerprint = "f" + i, Status = i < 50 ? ClashStatus.Accepted : ClashStatus.Resolved, ResolvedUtc = T0.AddSeconds(i) });
                ClashStateStore.Trim(big);
                Assert.Eq(ClashStateStore.MaxIssues, big.Issues.Count);
                Assert.Eq(50, big.Issues.Count(i => i.Status == ClashStatus.Accepted), "идэвхтэй/зөвшөөрсөн хасагдахгүй");
            }
            finally { SmartPaths.OverrideRoot(null); }
        }

        [Test]
        public static void StateStore_Update_IsSerialized_NoLostUpdatesAcrossThreads()
        {
            string root = TestDirs.NewTemp();
            SmartPaths.OverrideRoot(root);
            try
            {
                DocumentKey key = DocumentKeyBuilder.Build(new DocumentFacts { CreationGuid = Guid.NewGuid().ToString() });
                const int threads = 6, perThread = 15;
                var errors = new List<string>();
                var workers = new List<System.Threading.Thread>();
                for (int t = 0; t < threads; t++)
                {
                    int id = t;
                    var th = new System.Threading.Thread(() =>
                    {
                        for (int n = 0; n < perThread; n++)
                        {
                            string err;
                            bool ok = ClashStateStore.Update(key, s => s.Issues.Add(new ClashIssue { Fingerprint = "t" + id + "-" + n, RuleId = "r", RuleHash = "h" }), out err);
                            if (!ok) lock (errors) errors.Add(err);
                        }
                    });
                    workers.Add(th);
                    th.Start();
                }
                foreach (System.Threading.Thread th in workers) th.Join();
                Assert.Eq(0, errors.Count, string.Join(";", errors));
                Assert.Eq(threads * perThread, ClashStateStore.Load(key).Issues.Count, "нэг ч шинэчлэл алдагдаагүй");
            }
            finally { SmartPaths.OverrideRoot(null); }
        }

        [Test]
        public static void StateStore_Update_FailureInMutate_DoesNotCorruptState()
        {
            string root = TestDirs.NewTemp();
            SmartPaths.OverrideRoot(root);
            try
            {
                DocumentKey key = DocumentKeyBuilder.Build(new DocumentFacts { CreationGuid = Guid.NewGuid().ToString() });
                string err;
                Assert.True(ClashStateStore.Update(key, s => s.Issues.Add(new ClashIssue { Fingerprint = "keep", RuleId = "r", RuleHash = "h" }), out err), err);
                bool threw = false;
                try { ClashStateStore.Update(key, s => { s.Issues.Clear(); throw new InvalidOperationException("boom"); }, out err); }
                catch (InvalidOperationException) { threw = true; }
                Assert.True(threw);
                Assert.Eq(1, ClashStateStore.Load(key).Issues.Count, "mutate унасан үед дискэнд хагас өөрчлөлт бичигдэхгүй");
                // Түгжээ чөлөөлөгдсөн (дараагийн шинэчлэл гацахгүй).
                Assert.True(ClashStateStore.Update(key, s => s.Issues.Add(new ClashIssue { Fingerprint = "next", RuleId = "r", RuleHash = "h" }), out err), err);
                Assert.Eq(2, ClashStateStore.Load(key).Issues.Count);
            }
            finally { SmartPaths.OverrideRoot(null); }
        }

        [Test]
        public static void ElementInfo_Label_AndKeyRoundTrip()
        {
            var info = new ClashElementInfo { Key = ElementKey.Linked("h", "v", "l", "u").ToString(), Category = "Pipes", Type = "Steel 100", IdValue = 123, LinkName = "MEP.rvt" };
            Assert.True(info.ElementKey.IsLinked);
            Assert.True(info.Label.Contains("Pipes") && info.Label.Contains("Steel 100") && info.Label.Contains("MEP.rvt"), info.Label);
        }
    }
}
