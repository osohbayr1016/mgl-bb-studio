using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.ChangeImpact.Core;

namespace RevitMcpAddin.Smart.Tests
{
    /// <summary>«Хэрэв та X-г эндээс тийш зөөвөл …» тайлан, шийдвэр — ЦЭВЭР (Revit-гүй).</summary>
    public static class SimNarrativeTests
    {
        private static SimScene Scene(string name = "Хаалга · Single-Flush · #501")
        {
            return new SimScene { MovingName = name, PrimaryId = 501 };
        }

        private static SimExactResult Exact(SimVec off, SandboxOutcome outcome = SandboxOutcome.Simulated, bool complete = true)
        {
            return new SimExactResult { OffsetMm = new[] { off.X, off.Y, off.Z }, Outcome = outcome, ClashesEvaluated = true, ClashesComplete = complete, RoomsEvaluated = true };
        }

        private static SimExactClash Clash(string key, SimKind kind, double cm3, SimClashState st = SimClashState.Confirmed, string label = null)
        {
            return new SimExactClash { Key = key, Id = long.Parse(key.Substring(2)), Label = label ?? ("Элемент " + key), Kind = kind, VolumeCm3 = cm3, State = st, CategoryName = "X" };
        }

        private static SimConflictResult Live(params SimHit[] hits)
        {
            var r = new SimConflictResult();
            r.Hits.AddRange(hits);
            return r;
        }

        private static SimHit Hit(string key, SimKind kind, double depth = 40, bool pre = false, bool reactive = false, string label = null)
        {
            return new SimHit { Key = key, Id = long.Parse(key.Substring(2)), Label = label ?? ("Элемент " + key), Kind = kind, DepthMm = depth, PreExisting = pre, Reactive = reactive, CrossingPairs = 3 };
        }

        private static readonly SimVec Off = new SimVec(350, -120, 0);

        /* ============================== ҮНДСЭН ХЭЛБЭР ========================= */

        [Test]
        public static void ZeroOffset_AsksTheUserToDrag_AndNeverApplies()
        {
            SimReport r = SimNarrative.Build(Scene(), new SimVec(0, 0, 0), null, null, SimPhase.Idle);
            Assert.False(r.CanApply);
            Assert.Eq(MoveVerdict.Unknown, r.Verdict);
            Assert.True(r.Headline.Contains("хулганаар"), r.Headline);
            Assert.False(r.IsFinal);
        }

        [Test]
        public static void Headline_NamesTheElementAndTheOffset()
        {
            SimReport r = SimNarrative.Build(Scene("Хана · Basic Wall · #9"), Off, Live(), null, SimPhase.Dragging);
            Assert.True(r.Headline.StartsWith("Хэрэв та «Хана · Basic Wall · #9»-г эндээс тийш зөөвөл"), r.Headline);
            Assert.True(r.Headline.Contains("X +350 мм") && r.Headline.Contains("Y −120 мм"), r.Headline);
        }

        [Test]
        public static void FormatOffset_ShowsOnlyNonZeroAxes_WithTotalForCombinedMoves()
        {
            Assert.Eq("X +350 мм · Y −120 мм (нийт 370 мм)", SimNarrative.FormatOffset(new SimVec(350, -120, 0)));
            Assert.Eq("Z −50 мм", SimNarrative.FormatOffset(new SimVec(0, 0, -50)));
            Assert.Eq("X +12.3 м".Replace("12.3 м", "12000 мм"), SimNarrative.FormatOffset(new SimVec(12000, 0, 0)).Replace("12000 мм", "12000 мм"));
        }

        /* ============================== ЧИРЖ БАЙХ ҮЕД ======================== */

        [Test]
        public static void WhileDragging_NeverShowsGreen_EvenWithoutHits()
        {
            SimReport r = SimNarrative.Build(Scene(), Off, Live(), null, SimPhase.Dragging);
            Assert.Eq("⚪", r.Mark);
            Assert.Eq("ЧИРЖ БАЙНА…", r.Title);
            Assert.True(r.IsPending);
            Assert.False(r.CanApply, "чирж байх үед зөөх товч хаалттай");
            Assert.True(r.Subtitle.Contains("огтлолцол илрээгүй"), r.Subtitle);
        }

        [Test]
        public static void WhileDragging_ListsPreliminaryClashes_AndHighlightsThem()
        {
            SimReport r = SimNarrative.Build(Scene(), Off, Live(Hit("h:7", SimKind.Wall, 80, label: "Хана · Generic 200 · #7")), null, SimPhase.Dragging);
            Assert.Eq(1, r.Lines.Count);
            Assert.True(r.Lines[0].Text.Contains("Хана · Generic 200 · #7") && r.Lines[0].Text.Contains("урьдчилсан"), r.Lines[0].Text);
            Assert.False(r.Lines[0].Exact);
            Assert.True(r.HighlightKeys.Contains("h:7"));
            Assert.True(r.Subtitle.Contains("1 элементтэй"), r.Subtitle);
        }

        [Test]
        public static void PreExistingOverlaps_AreNotListed()
        {
            SimReport r = SimNarrative.Build(Scene(), Off, Live(Hit("h:7", SimKind.Wall, pre: true)), null, SimPhase.Dragging);
            Assert.Eq(0, r.Lines.Count, "хөдөлгөөнгүй үеэс байсан давхцал шинэ биш");
        }

        [Test]
        public static void StaleExactResult_IsIgnored_ForAnotherOffset()
        {
            SimExactResult stale = Exact(new SimVec(100, 0, 0));
            SimReport r = SimNarrative.Build(Scene(), Off, Live(), stale, SimPhase.Analyzing);
            Assert.False(r.IsFinal);
            Assert.Eq("ШАЛГАЖ БАЙНА…", r.Title);
            Assert.False(r.CanApply);
        }

        /* ============================== ЭЦСИЙН ДҮН =========================== */

        [Test]
        public static void ExactClean_IsGreen_AppliesTrue_AndNeverClaimsNormCompliance()
        {
            SimReport r = SimNarrative.Build(Scene(), Off, Live(), Exact(Off), SimPhase.Idle);
            Assert.Eq(MoveVerdict.MoveOk, r.Verdict);
            Assert.Eq("🟢", r.Mark);
            Assert.Eq("ТЕХНИКИЙН ХУВЬД ЗӨӨЖ БОЛНО", r.Title);
            Assert.True(r.CanApply);
            Assert.True(r.IsFinal);
            Assert.Eq(PreChangeDecisionEngine.NormLineText, r.NormLine);
            Assert.Eq(PreChangeDecisionEngine.ModelOnlyNote, r.ModelOnlyNote);
            AssertNoComplianceClaim(r);
        }

        [Test]
        public static void ExactClash_WithColumn_IsOrange_WithTheEngineeringConsequence()
        {
            SimExactResult e = Exact(Off);
            e.Clashes.Add(Clash("h:12", SimKind.Column, 350000, label: "Багана · 400x400 · #12"));
            SimReport r = SimNarrative.Build(Scene(), Off, Live(Hit("h:12", SimKind.Column)), e, SimPhase.Idle);
            Assert.Eq(MoveVerdict.MoveWithReview, r.Verdict);
            Assert.Eq("🟠", r.Mark);
            Assert.True(r.CanApply, "🟠 зөөж болно, хянана");
            SimLine l = r.Lines.First(x => x.Code == "clash");
            Assert.True(l.Exact);
            Assert.True(l.Text.Contains("Багана · 400x400 · #12") && l.Text.Contains("0.35 м³"), l.Text);
            Assert.True(l.Consequence.Contains("инженерийн"), l.Consequence);
            Assert.True(r.HighlightKeys.Contains("h:12"));
        }

        [Test]
        public static void ExactBlocked_IsRed_AndExplainsWhy_AndClosesApply()
        {
            SimExactResult e = Exact(Off, SandboxOutcome.Blocked);
            e.BlockReasons.Add("Revit энэ хөдөлгөөнийг зөвшөөрөөгүй: Түгжигдсэн хэмжээс.");
            SimReport r = SimNarrative.Build(Scene(), Off, Live(), e, SimPhase.Idle);
            Assert.Eq(MoveVerdict.DoNotMove, r.Verdict);
            Assert.Eq("🔴", r.Mark);
            Assert.False(r.CanApply);
            Assert.True(r.Lines[0].Text.Contains("Түгжигдсэн хэмжээс"), r.Lines[0].Text);
            Assert.True(r.Lines[0].Consequence.Contains("ЮУ Ч өөрчлөгдөөгүй"));
        }

        [Test]
        public static void ExactFaultOrNotRestored_IsUnknown_NotRed()
        {
            foreach (SandboxOutcome o in new[] { SandboxOutcome.Faulted, SandboxOutcome.NotRestored })
            {
                SimExactResult e = Exact(Off, o);
                e.BlockReasons.Add("тест");
                SimReport r = SimNarrative.Build(Scene(), Off, Live(), e, SimPhase.Idle);
                Assert.Eq(MoveVerdict.Unknown, r.Verdict, o.ToString());
                Assert.Eq("⚪", r.Mark);
                Assert.False(r.CanApply);
            }
            SimReport nr = SimNarrative.Build(Scene(), Off, Live(), Exact(Off, SandboxOutcome.NotRestored), SimPhase.Idle);
            Assert.True(nr.Coverage.Any(c => c.Contains("Ctrl+Z")), "буцаалт батлагдаагүй бол ИЛ хэлнэ");
        }

        [Test]
        public static void DeletedElements_AreRed()
        {
            SimExactResult e = Exact(Off);
            e.Deleted.Add(new SimDeletedElement { Id = 77, Label = "Хаалга · #77", Kind = SimKind.Door, Known = true });
            SimReport r = SimNarrative.Build(Scene(), Off, Live(), e, SimPhase.Idle);
            Assert.Eq(MoveVerdict.DoNotMove, r.Verdict);
            Assert.True(r.Lines[0].Text.Contains("УСТНА") && r.Lines[0].Text.Contains("Хаалга · #77"));
            Assert.False(r.CanApply);
        }

        [Test]
        public static void UnidentifiedDeletions_AreReviewNotRed()
        {
            SimExactResult e = Exact(Off);
            e.Deleted.Add(new SimDeletedElement { Id = 5, Label = "Элемент #5", Known = false });
            SimReport r = SimNarrative.Build(Scene(), Off, Live(), e, SimPhase.Idle);
            Assert.Eq(MoveVerdict.MoveWithReview, r.Verdict, "дотоод (таниагүй) устгал нь шийдвэрийг 🔴 болгохгүй");
            Assert.True(r.Lines.Any(l => l.Code == "deleted.internal"));
        }

        [Test]
        public static void RoomAreaChange_IsOrange_WithBeforeAfter()
        {
            SimExactResult e = Exact(Off);
            e.Rooms.Add(new SimRoomChange { Id = 5, Name = "Оффис 101", BeforeM2 = 24.5, AfterM2 = 21.3 });
            e.Rooms.Add(new SimRoomChange { Id = 6, Name = "Коридор", BeforeM2 = 10, AfterM2 = 10.01 });          // босгоос бага — мөр байхгүй
            SimReport r = SimNarrative.Build(Scene(), Off, Live(), e, SimPhase.Idle);
            Assert.Eq(MoveVerdict.MoveWithReview, r.Verdict);
            SimLine l = r.Lines.Single(x => x.Code == "room.area");
            Assert.True(l.Text.Contains("24.5 → 21.3") && l.Text.Contains("−3.2"), l.Text);
            Assert.Eq(1, r.Lines.Count(x => x.Code.StartsWith("room")));
        }

        [Test]
        public static void IncompleteClashScan_IsUnknown_NotGreen()
        {
            SimExactResult e = Exact(Off, complete: false);
            e.IncompleteReasons.Add("MEP нэр дэвшигч 400 байна — эхний 300-г л шалгав.");
            SimReport r = SimNarrative.Build(Scene(), Off, Live(), e, SimPhase.Idle);
            Assert.Eq(MoveVerdict.Unknown, r.Verdict);
            Assert.False(r.CanApply, "шалгаагүйг «цэвэр» гэж хэлэхгүй");
            Assert.True(r.Subtitle.Contains("300"), r.Subtitle);
        }

        [Test]
        public static void ExactPreExistingContact_IsHidden_UntilItGrows()
        {
            SimExactResult e = Exact(Off);
            SimExactClash same = Clash("h:3", SimKind.Wall, 100);
            same.PreExisting = true; same.BeforeVolumeCm3 = 95;
            SimExactClash bigger = Clash("h:4", SimKind.Wall, 5000);
            bigger.PreExisting = true; bigger.BeforeVolumeCm3 = 95;
            e.Clashes.Add(same); e.Clashes.Add(bigger);
            SimReport r = SimNarrative.Build(Scene(), Off, Live(), e, SimPhase.Idle);
            Assert.Eq(1, r.Lines.Count(x => x.Code == "clash"));
            Assert.True(r.HighlightKeys.Contains("h:4") && !r.HighlightKeys.Contains("h:3"));
        }

        [Test]
        public static void RevitNoClash_DropsThePreliminaryHit_ButUnsupportedKeepsItAsPreliminary()
        {
            SimExactResult e = Exact(Off);
            e.Clashes.Add(Clash("h:5", SimKind.Wall, 0, SimClashState.NoClash));
            e.Clashes.Add(Clash("h:6", SimKind.Furniture, 0, SimClashState.Unsupported));
            SimReport r = SimNarrative.Build(Scene(), Off, Live(Hit("h:5", SimKind.Wall), Hit("h:6", SimKind.Furniture)), e, SimPhase.Idle);
            Assert.False(r.HighlightKeys.Contains("h:5"), "Revit-ийн тооцоогоор давхцаагүй");
            Assert.True(r.HighlightKeys.Contains("h:6"));
            SimLine l = r.Lines.Single(x => x.Code == "clash.prelim");
            Assert.True(l.Text.Contains("Revit-ээр баталгаажуулж чадсангүй"), l.Text);
            Assert.False(l.Exact);
            Assert.Eq(MoveVerdict.MoveWithReview, r.Verdict);
        }

        [Test]
        public static void ReactiveJoinedWalls_AreInformation_NotAFinding()
        {
            SimExactResult e = Exact(Off);
            SimExactClash c = Clash("h:8", SimKind.Wall, 8000);
            c.Reactive = true;
            e.Clashes.Add(c);
            SimReport r = SimNarrative.Build(Scene(), Off, Live(), e, SimPhase.Idle);
            Assert.Eq(MoveVerdict.MoveOk, r.Verdict, "Revit өөрөө засдаг — шийдвэрийг хүндрүүлэхгүй");
            Assert.Eq(SimSeverity.Info, r.Lines.Single(x => x.Code == "clash.reactive").Severity);
        }

        [Test]
        public static void ManyClashes_AreGroupedByKind()
        {
            SimExactResult e = Exact(Off);
            for (int i = 0; i < 4; i++) e.Clashes.Add(Clash("h:" + (20 + i), SimKind.Wall, 1000 + i));
            for (int i = 0; i < 3; i++) e.Clashes.Add(Clash("h:" + (40 + i), SimKind.Duct, 500 + i));
            SimReport r = SimNarrative.Build(Scene(), Off, Live(), e, SimPhase.Idle);
            SimLine walls = r.Lines.Single(x => x.Code == "clash.group" && x.Kind == SimKind.Wall);
            Assert.True(walls.Text.StartsWith("Хана ×4"), walls.Text);
            Assert.Eq(4, walls.Keys.Count);
            SimLine ducts = r.Lines.Single(x => x.Code == "clash.group" && x.Kind == SimKind.Duct);
            Assert.True(ducts.Consequence.Contains("трассчлах"));
            Assert.Eq(7, r.HighlightKeys.Count);
        }

        [Test]
        public static void DependentsAndModified_AreInformation_AndDoNotChangeTheVerdict()
        {
            SimExactResult e = Exact(Off);
            e.Dependents.Add(new SimDependent { Id = 1, Category = "Хаалга" });
            e.Dependents.Add(new SimDependent { Id = 2, Category = "Хаалга" });
            e.Dependents.Add(new SimDependent { Id = 3, Category = "Хэмжээс" });
            e.ModifiedCount = 6;
            SimReport r = SimNarrative.Build(Scene(), Off, Live(), e, SimPhase.Idle);
            Assert.Eq(MoveVerdict.MoveOk, r.Verdict);
            Assert.True(r.Lines.Single(x => x.Code == "dependents").Text.Contains("Хаалга ×2"));
            Assert.True(r.Lines.Single(x => x.Code == "modified").Text.Contains("6 элемент"));
        }

        [Test]
        public static void Lines_AreOrdered_BlockingFirst_ThenReview_ThenInfo()
        {
            SimExactResult e = Exact(Off);
            e.Clashes.Add(Clash("h:3", SimKind.Wall, 5000));
            e.Deleted.Add(new SimDeletedElement { Id = 9, Label = "X", Kind = SimKind.Other, Known = true });
            e.ModifiedCount = 2;
            SimReport r = SimNarrative.Build(Scene(), Off, Live(), e, SimPhase.Idle);
            var sev = r.Lines.Select(l => (int)l.Severity).ToList();
            Assert.SeqEq(sev.OrderByDescending(x => x).ToList(), sev);
            Assert.Eq(1, r.BlockingCount);
            Assert.True(r.ReviewCount >= 1);
        }

        [Test]
        public static void CoverageAlwaysSaysWhatWasNotChecked()
        {
            SimReport r = SimNarrative.Build(Scene(), Off, Live(), Exact(Off), SimPhase.Idle);
            Assert.True(r.Coverage.Any(c => c.Contains("Шалгаагүй") && c.Contains("хуудас") && c.Contains("норм")), string.Join(" | ", r.Coverage));
        }

        [Test]
        public static void NoReportEverClaimsNormCompliance()
        {
            var offsets = new[] { new SimVec(0, 0, 0), Off, new SimVec(0, 0, 900) };
            foreach (SimVec o in offsets)
            {
                foreach (SimExactResult e in new SimExactResult[]
                {
                    null, Exact(o), Exact(o, SandboxOutcome.Blocked), Exact(o, SandboxOutcome.Faulted), Exact(o, complete: false),
                })
                {
                    foreach (SimPhase ph in new[] { SimPhase.Idle, SimPhase.Dragging, SimPhase.Analyzing })
                        AssertNoComplianceClaim(SimNarrative.Build(Scene(), o, Live(Hit("h:1", SimKind.Wall)), e, ph));
                }
            }
        }

        private static void AssertNoComplianceClaim(SimReport r)
        {
            var texts = new List<string> { r.Headline, r.Title, r.Subtitle, r.ModelLine, r.NormLine, r.ModelOnlyNote };
            texts.AddRange(r.Lines.Select(l => l.Text));
            texts.AddRange(r.Lines.Select(l => l.Consequence));
            texts.AddRange(r.Coverage);
            foreach (string t in texts.Where(t => t != null))
            {
                Assert.False(t.Contains("Нормд нийцсэн") || t.Contains("нормд нийцнэ") || t.Contains("БНбД-д нийцсэн"), "норм нийцлийн мэдэгдэл: " + t);
            }
        }
    }
}
