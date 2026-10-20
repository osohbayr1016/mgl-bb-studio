using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.SheetNumerator.Core;

namespace RevitMcpAddin.SheetNumerator.Tests
{
    /// <summary>Давхардлын шалгалт (БҮХ хуудастай) + үл үзэгдэх Unicode тэмдэг.</summary>
    public static class DuplicateAndMarkerTests
    {
        private static RenumberSettings FixedNumber(string text)
        {
            // Бүх мөрөнд ИЖИЛ дугаар үүсгэнэ (Fixed хэсэг, угтвар).
            var s = new RenumberSettings { Mode = NumberingMode.Advanced };
            s.Advanced.Parts[0].Enabled = true;
            s.Advanced.Parts[0].Prefix = text;
            s.Advanced.Parts[0].ValueMode = PartValueMode.None;
            return s;
        }

        // ── Давхардал ───────────────────────────────────────────────
        [Test]
        public static void TwoGeneratedIdentical_BothChangedRowsFlagged()
        {
            RenumberPlan p = Fx.Plan(Fx.Sheets("a", "b"), FixedNumber("SAME"));
            Assert.True(p.Rows[0].Issues.Any(i => i.Code == IssueCode.DuplicateNumber));
            Assert.True(p.Rows[1].Issues.Any(i => i.Code == IssueCode.DuplicateNumber));
            Assert.True(p.HasBlockingErrors);
        }

        [Test]
        public static void DuplicateMessage_MatchesSpec()
        {
            RenumberPlan p = Fx.Plan(Fx.Sheets("a", "b"), FixedNumber("SAME"));
            string m = p.Rows[0].Issues.First(i => i.Code == IssueCode.DuplicateNumber).Message;
            Assert.True(m.StartsWith("Дугаар давхардсан байна.\n“SAME” дугаар энэ дугаарлалтын хүрээнд аль хэдийн ашиглагдаж байна."), m);
        }

        [Test]
        public static void CollisionWithSheetInAnotherGroup_IsDetected()
        {
            var inGroup = new List<SheetSnapshot> { Fx.Sheet(1, "x1"), Fx.Sheet(2, "x2") };
            var other = Fx.Sheet(50, "A2");
            DocumentSnapshot doc = Fx.Doc(inGroup.Concat(new[] { other }));
            RenumberPlan p = Fx.Plan(inGroup, Fx.SimpleSettings(prefix: "A"), doc: doc);
            Assert.Eq("A1", p.Rows[0].NewNumber);
            Assert.False(p.Rows[0].Issues.Any(i => i.Code == IssueCode.DuplicateNumber));
            Assert.True(p.Rows[1].Issues.Any(i => i.Code == IssueCode.DuplicateNumber), "A2 өөр бүлгийн хуудастай давхцав");
        }

        [Test]
        public static void CollisionWithSheetHiddenByBrowserFilter_IsDetected_AndMessageMentionsIt()
        {
            var inGroup = new List<SheetSnapshot> { Fx.Sheet(1, "x1") };
            var hidden = Fx.Sheet(60, "A1", visible: false);
            DocumentSnapshot doc = Fx.Doc(inGroup.Concat(new[] { hidden }));
            RenumberPlan p = Fx.Plan(inGroup, Fx.SimpleSettings(prefix: "A"), doc: doc);
            ValidationIssue issue = p.Rows[0].Issues.Single(i => i.Code == IssueCode.DuplicateNumber);
            Assert.True(issue.Message.Contains("шүүлтэнд нуугдсан"));
        }

        [Test]
        public static void SwapWithinGroup_IsNotADuplicate()
        {
            // 01↔02 солих: эцсийн төлөвт давхардал байхгүй (хоёр дахь алхамд түр дугаараар шийдэгдэнэ).
            List<SheetSnapshot> sheets = Fx.Sheets("01", "02");
            var s = new RenumberSettings { MoveRenumber = true };
            RenumberPlan p = Fx.Plan(sheets, s, working: new List<SheetSnapshot> { sheets[1], sheets[0] });
            Assert.False(p.AllIssues.Any(i => i.Code == IssueCode.DuplicateNumber));
            Assert.Eq(2, p.NumberChangedCount);
        }

        [Test]
        public static void DuplicateIsCaseInsensitive_LikeRevit()
        {
            var inGroup = new List<SheetSnapshot> { Fx.Sheet(1, "x1") };
            var other = Fx.Sheet(2, "a1");
            DocumentSnapshot doc = Fx.Doc(inGroup.Concat(new[] { other }));
            RenumberPlan p = Fx.Plan(inGroup, Fx.SimpleSettings(prefix: "A"), doc: doc);
            Assert.True(p.Rows[0].Issues.Any(i => i.Code == IssueCode.DuplicateNumber));
        }

        [Test]
        public static void CyrillicCase_IsAlsoCaseInsensitive()
        {
            var inGroup = new List<SheetSnapshot> { Fx.Sheet(1, "x1") };
            var other = Fx.Sheet(2, "ар-1");
            DocumentSnapshot doc = Fx.Doc(inGroup.Concat(new[] { other }));
            RenumberPlan p = Fx.Plan(inGroup, Fx.SimpleSettings(prefix: "АР-"), doc: doc);
            Assert.True(p.Rows[0].Issues.Any(i => i.Code == IssueCode.DuplicateNumber));
        }

        [Test]
        public static void InvisibleMarkerDistinguishesNumbers()
        {
            var inGroup = new List<SheetSnapshot> { Fx.Sheet(1, "x1") };
            var other = Fx.Sheet(2, "A1​");
            DocumentSnapshot doc = Fx.Doc(inGroup.Concat(new[] { other }));
            RenumberPlan p = Fx.Plan(inGroup, Fx.SimpleSettings(prefix: "A"), doc: doc);
            Assert.False(p.Rows[0].Issues.Any(i => i.Code == IssueCode.DuplicateNumber), "A1 ≠ A1+ZWSP");
        }

        [Test]
        public static void PerCollectionScope_AllowsSameNumberInDifferentCollections()
        {
            var inGroup = new List<SheetSnapshot> { Fx.Sheet(1, "x1", collection: 100) };
            var otherCollection = Fx.Sheet(2, "A1", collection: 200);
            var noCollection = Fx.Sheet(3, "A1");
            DocumentSnapshot doc = Fx.Doc(inGroup.Concat(new[] { otherCollection, noCollection }), UniquenessMode.PerSheetCollection);
            RenumberPlan p = Fx.Plan(inGroup, Fx.SimpleSettings(prefix: "A"), doc: doc);
            Assert.False(p.AllIssues.Any(i => i.Code == IssueCode.DuplicateNumber), "цуглуулга бүрт тусдаа хүрээ");
        }

        [Test]
        public static void PerCollectionScope_BlocksSameNumberInSameCollection()
        {
            var inGroup = new List<SheetSnapshot> { Fx.Sheet(1, "x1", collection: 100) };
            var sameCollection = Fx.Sheet(2, "A1", collection: 100);
            DocumentSnapshot doc = Fx.Doc(inGroup.Concat(new[] { sameCollection }), UniquenessMode.PerSheetCollection);
            RenumberPlan p = Fx.Plan(inGroup, Fx.SimpleSettings(prefix: "A"), doc: doc);
            Assert.True(p.Rows[0].Issues.Any(i => i.Code == IssueCode.DuplicateNumber));
        }

        [Test]
        public static void GlobalScope_Revit2024_BlocksAcrossCollectionsAndUngrouped()
        {
            var inGroup = new List<SheetSnapshot> { Fx.Sheet(1, "x1") };
            var other = Fx.Sheet(2, "A1", collection: 200);   // 2024-д цуглуулга байхгүй, ГЛОБАЛ
            DocumentSnapshot doc = Fx.Doc(inGroup.Concat(new[] { other }), UniquenessMode.Global);
            RenumberPlan p = Fx.Plan(inGroup, Fx.SimpleSettings(prefix: "A"), doc: doc);
            Assert.True(p.Rows[0].Issues.Any(i => i.Code == IssueCode.DuplicateNumber));
        }

        [Test]
        public static void AssemblySheets_OwnScopePerAssemblyInstance()
        {
            var inGroup = new List<SheetSnapshot> { Fx.Sheet(1, "x1") };
            var asm = Fx.Sheet(2, "A1", assembly: true, assemblyId: 900);   // assembly хуудас — энгийн хүрээнд ОРОХГҮЙ
            DocumentSnapshot doc = Fx.Doc(inGroup.Concat(new[] { asm }), UniquenessMode.PerSheetCollection);
            RenumberPlan p = Fx.Plan(inGroup, Fx.SimpleSettings(prefix: "A"), doc: doc);
            Assert.False(p.AllIssues.Any(i => i.Code == IssueCode.DuplicateNumber));

            // Харин ӨӨР assembly хуудастай ижил assembly дотор давхцана, өөр assembly-тэй давхцахгүй.
            var asmGroup = new List<SheetSnapshot>
            {
                Fx.Sheet(10, "q1", assembly: true, assemblyId: 900),
                Fx.Sheet(11, "q2", assembly: true, assemblyId: 900),
            };
            var asmOther = Fx.Sheet(12, "AS-1", assembly: true, assemblyId: 901);
            DocumentSnapshot doc2 = Fx.Doc(asmGroup.Concat(new[] { asmOther }), UniquenessMode.PerSheetCollection);
            RenumberPlan p2 = Fx.Plan(asmGroup, Fx.SimpleSettings(prefix: "AS-"), doc: doc2);
            Assert.False(p2.AllIssues.Any(i => i.Code == IssueCode.DuplicateNumber), "AS-1 өөр assembly-д байгаа — хүрээ тусдаа");
        }

        [Test]
        public static void ScopeKeys_DoNotConfuseCollectionWithAssembly()
        {
            SheetSnapshot c = Fx.Sheet(1, "A", collection: 5);
            SheetSnapshot a = Fx.Sheet(2, "A", assembly: true, assemblyId: 5);
            Assert.False(c.ScopeKey(UniquenessMode.PerSheetCollection) == a.ScopeKey(UniquenessMode.PerSheetCollection));
        }

        [Test]
        public static void ProhibitedCharacters_AreReportedBeforeApply()
        {
            // Параметрээс авсан угтварт Revit-д хориглогдсон тэмдэгт байвал мөр АЛДААТАЙ болно (apply-аас ӨМНӨ).
            ParameterKey key = ParameterKey.Project("P");
            SheetSnapshot a = Fx.WithParams(Fx.Sheet(1, "x1"), Fx.P(key, "A:B"));
            var sheets = new List<SheetSnapshot> { a };
            DocumentSnapshot doc = Fx.Doc(sheets, UniquenessMode.PerSheetCollection, Fx.Param(key, "P", ParamValueKind.Text));
            RenumberSettings s = Fx.SimpleSettings();
            s.UseParameterPrefix = true;
            s.PrefixParameter = key;
            RenumberPlan p = Fx.Plan(sheets, s, doc: doc);
            Assert.True(p.Rows[0].Issues.Any(i => i.Code == IssueCode.ProhibitedCharacter));
        }

        [Test]
        public static void RevitRules_Prohibited_And_Normalize()
        {
            Assert.SeqEq(new[] { '\\', ':', '?' }, RevitSheetRules.FindProhibited("a\\b:c?"));
            Assert.Eq(1, RevitSheetRules.FindProhibited("a\tb").Count, "TAB/хяналтын тэмдэг");
            Assert.Eq(0, RevitSheetRules.FindProhibited("A-01 /*\"'!@#$%^&()=+,._").Count, "хэмжсэн зөвшөөрөгдсөн тэмдэгтүүд");
            Assert.Eq("A-01", RevitSheetRules.Normalize("  A-01 "));
            Assert.Eq("A​", RevitSheetRules.Normalize("A​"), "ZWSP тайрагдахгүй (хэмжсэн)");
            Assert.Eq("A", RevitSheetRules.Normalize("A᠎"), "U+180E тайрагдана (хэмжсэн)");
            Assert.True(RevitSheetRules.IsBlank("   "));
        }

        // ── Үл үзэгдэх тэмдэг ───────────────────────────────────────
        [Test]
        public static void Markers_FirstKeepsPlain_LaterGetIncreasingMarkers()
        {
            RenumberSettings s = FixedNumber("SAME");
            s.UseUnicodeMarkers = true;
            s.MarkerChar = '​';
            RenumberPlan p = Fx.Plan(Fx.Sheets("a", "b", "c"), s, markers: Fx.Markers('​'));
            Assert.SeqEq(new[] { "SAME", "SAME​", "SAME​​" }, Fx.Numbers(p));
            Assert.False(p.AllIssues.Any(i => i.Code == IssueCode.DuplicateNumber));
            Assert.False(p.Rows[0].MarkerAdded);
            Assert.True(p.Rows[1].MarkerAdded);
            Assert.True(p.Rows[1].Issues.Any(i => i.Code == IssueCode.MarkerAdded && i.Severity == IssueSeverity.Info));
        }

        [Test]
        public static void Markers_AreAddedToChangedRow_NotToTheUnchangedOwnerOfTheNumber()
        {
            var inGroup = new List<SheetSnapshot> { Fx.Sheet(1, "x1") };
            var owner = Fx.Sheet(2, "A1");   // өөр бүлгийн, өөрчлөгдөхгүй
            DocumentSnapshot doc = Fx.Doc(inGroup.Concat(new[] { owner }));
            RenumberSettings s = Fx.SimpleSettings(prefix: "A");
            s.UseUnicodeMarkers = true;
            RenumberPlan p = Fx.Plan(inGroup, s, doc: doc, markers: Fx.Markers('​'));
            Assert.Eq("A1​", p.Rows[0].NewNumber);
            Assert.False(p.HasBlockingErrors);
        }

        [Test]
        public static void Markers_NameAndParameterSourcesStayVisible()
        {
            // Тэмдэг зөвхөн SheetNumber-д — нэр/параметрт ГООЖИХГҮЙ.
            ParameterKey target = ParameterKey.Project("Mark");
            List<SheetSnapshot> sheets = Fx.Sheets("a", "b");
            foreach (SheetSnapshot sh in sheets) Fx.WithParams(sh, Fx.P(target, ""));
            DocumentSnapshot doc = Fx.Doc(sheets, UniquenessMode.PerSheetCollection, Fx.Param(target, "Mark", ParamValueKind.Text));
            RenumberSettings s = FixedNumber("SAME");
            s.UseUnicodeMarkers = true;
            s.WriteResultToParameter = true;
            s.ResultParameter = target;
            s.NameAtStart = true;
            RenumberPlan p = Fx.Plan(sheets, s, doc: doc, markers: Fx.Markers('​'));
            Assert.Eq("SAME​", p.Rows[1].NewNumber);
            Assert.Eq("SAME", p.Rows[1].Writes.Single().Text);
            Assert.True(p.Rows[1].NewName.StartsWith("SAME "));
            Assert.False(p.Rows[1].NewName.Contains("​"));
        }

        [Test]
        public static void Markers_NotProbedOrNotAccepted_IsBlockingSettingsError()
        {
            RenumberSettings s = FixedNumber("SAME");
            s.UseUnicodeMarkers = true;
            RenumberPlan p = Fx.Plan(Fx.Sheets("a"), s, markers: null);
            Assert.True(p.GlobalIssues.Any(i => i.Code == IssueCode.MarkerUnavailable));

            p = Fx.Plan(Fx.Sheets("a"), s, markers: Fx.Markers('⁠'));   // U+200B хүлээн аваагүй
            Assert.True(p.GlobalIssues.Any(i => i.Code == IssueCode.MarkerUnavailable));
        }

        [Test]
        public static void Markers_Disabled_DuplicatesStayBlocking()
        {
            RenumberPlan p = Fx.Plan(Fx.Sheets("a", "b"), FixedNumber("SAME"), markers: Fx.Markers('​'));
            Assert.True(p.HasBlockingErrors);
        }

        [Test]
        public static void ExistingMarkerInNumber_IsPreserved_AndWarned()
        {
            // «Одоогийн дугаар + угтвар» горимд хуучин үл үзэгдэх тэмдэг чимээгүй хаягдахгүй.
            RenumberSettings s = Fx.SimpleSettings(prefix: "P-", useStart: false);
            List<SheetSnapshot> sheets = Fx.Sheets("A1​");
            RenumberPlan p = Fx.Plan(sheets, s);
            Assert.Eq("P-A1​", p.Rows[0].NewNumber);
            Assert.True(p.Rows[0].Issues.Any(i => i.Code == IssueCode.ContainsInvisibleMarker));
            Assert.Eq("P-A1⟦U+200B⟧", p.Rows[0].NumberDiagnostic);
        }

        [Test]
        public static void CleanMarkers_RemovesKnownMarkersDeliberately()
        {
            var s = new RenumberSettings { CleanMarkers = true };
            List<SheetSnapshot> sheets = Fx.Sheets("A-01​", "A-02", "A-03⁠⁠");
            RenumberPlan p = Fx.Plan(sheets, s);
            Assert.SeqEq(new[] { "A-01", "A-02", "A-03" }, Fx.Numbers(p));
            Assert.Eq(2, p.NumberChangedCount);
        }

        [Test]
        public static void CleanMarkers_ThatCreatesDuplicate_IsBlocked()
        {
            var s = new RenumberSettings { CleanMarkers = true };
            List<SheetSnapshot> sheets = Fx.Sheets("A-01", "A-01​");
            RenumberPlan p = Fx.Plan(sheets, s);
            Assert.True(p.Rows[1].Issues.Any(i => i.Code == IssueCode.DuplicateNumber));
        }

        // ── UnicodeMarkers (цэвэр туслахууд) ────────────────────────
        [Test]
        public static void Markers_Detect_Escape_Remove()
        {
            Assert.True(UnicodeMarkers.ContainsMarker("A​"));
            Assert.False(UnicodeMarkers.ContainsMarker("A-01"));
            Assert.Eq(2, UnicodeMarkers.CountMarkers("A​-⁠"));
            Assert.Eq("A-01⟦U+200B × 2⟧", UnicodeMarkers.Escape("A-01​​"));
            Assert.Eq("A⟦U+200B⟧-01", UnicodeMarkers.Escape("A​-01"));
            Assert.Eq("A-01", UnicodeMarkers.RemoveKnownMarkers("A​-0⁠" + "1"));
        }

        [Test]
        public static void Markers_MakeUnique_And_Append()
        {
            var taken = new HashSet<string> { "N", "N​" };
            int k;
            string u = UnicodeMarkers.MakeUnique("N", '​', c => taken.Contains(c), 10, out k);
            Assert.Eq("N​​", u);
            Assert.Eq(2, k);
            Assert.Null(UnicodeMarkers.MakeUnique("N", '​', c => true, 3, out k), "хязгаарт багтахгүй бол null");
            Assert.Eq("A​​", UnicodeMarkers.Append("A", '​', 2));
        }

        [Test]
        public static void MarkerCatalog_ListsMongolianVowelSeparator_ButProbeMustDecide()
        {
            Assert.NotNull(UnicodeMarkerCatalog.Find('​'));
            Assert.NotNull(UnicodeMarkerCatalog.Find('᠎'));
            Assert.True(UnicodeMarkerCatalog.Candidates.Count >= 10);
            // Каталог нь баталгаа БИШ — probe хийгээгүй бол ямар ч тэмдэг боломжгүй.
            Assert.False(new MarkerCapabilities().AnyAvailable);
            MarkerCapabilities caps = Fx.Markers('⁠');
            Assert.Eq('⁠', caps.Preferred('​'));
            Assert.Eq('⁠', caps.Preferred('⁠'));
        }
    }
}
