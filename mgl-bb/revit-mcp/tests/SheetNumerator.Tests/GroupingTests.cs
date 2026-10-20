using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.SheetNumerator.Core;

namespace RevitMcpAddin.SheetNumerator.Tests
{
    /// <summary>GroupKey (нэр ≠ танигч), бүлэглэлт, мод, эрэмбэ.</summary>
    public static class GroupingTests
    {
        // ── GroupKey ────────────────────────────────────────────────
        [Test]
        public static void GroupKey_SameDisplayName_DifferentBrowserPath_AreDifferent()
        {
            GroupKey a = GroupKey.Folder(new[] { Fx.Seg("Архитектур"), Fx.Seg("План") });
            GroupKey b = GroupKey.Folder(new[] { Fx.Seg("Конструкц"), Fx.Seg("План") });
            Assert.False(a.Equals(b));
            Assert.False(a.StableId == b.StableId);
        }

        [Test]
        public static void GroupKey_SameNameBrowserFolder_Collection_Assembly_AreDistinct()
        {
            // Гурвуулаа «ARCH» нэртэй ч ТУСДАА түлхүүр.
            GroupKey folder = GroupKey.Folder(new[] { Fx.Seg("ARCH") });
            GroupKey coll = GroupKey.Collection(5, new[] { Fx.Seg("ARCH") });
            GroupKey asm = GroupKey.Assembly(5);
            Assert.False(folder.Equals(coll));
            Assert.False(coll.Equals(asm));
            Assert.False(folder.Equals(asm));
            Assert.Eq(3, new HashSet<GroupKey> { folder, coll, asm }.Count);
        }

        [Test]
        public static void GroupKey_Collection_SamePath_DifferentCollectionId_AreDistinct()
        {
            GroupKey a = GroupKey.Collection(5, new[] { Fx.Seg("ARCH") });
            GroupKey b = GroupKey.Collection(6, new[] { Fx.Seg("ARCH") });
            Assert.False(a.Equals(b));
        }

        [Test]
        public static void GroupKey_SamePathSameKind_AreEqual()
        {
            GroupKey a = GroupKey.Folder(new[] { Fx.Seg("A"), Fx.Seg("B") });
            GroupKey b = GroupKey.Folder(new[] { Fx.Seg("A"), Fx.Seg("B") });
            Assert.True(a.Equals(b));
            Assert.Eq(a.GetHashCode(), b.GetHashCode());
        }

        [Test]
        public static void GroupKey_SegmentBoundaries_AreUnambiguous()
        {
            // «A;B» нэг сегмент ≠ «A» ба «B» хоёр сегмент; «1:A» гэх мэт тусгаарлагч нэрэнд байсан ч андуурахгүй.
            GroupKey one = GroupKey.Folder(new[] { Fx.Seg("A;B") });
            GroupKey two = GroupKey.Folder(new[] { Fx.Seg("A"), Fx.Seg("B") });
            Assert.False(one.Equals(two));
            GroupKey x = GroupKey.Folder(new[] { new FolderSegment("1:A", 7) });
            GroupKey y = GroupKey.Folder(new[] { new FolderSegment("A", 71) });
            Assert.False(x.Equals(y));
        }

        [Test]
        public static void GroupKey_DifferentGroupingParameter_SameName_AreDistinct()
        {
            GroupKey a = GroupKey.Folder(new[] { new FolderSegment("X", -1007404) });
            GroupKey b = GroupKey.Folder(new[] { new FolderSegment("X", -1006322) });
            Assert.False(a.Equals(b));
        }

        // ── Бүлэглэлт ───────────────────────────────────────────────
        private static DocumentSnapshot DocOf(params SheetSnapshot[] sheets)
        {
            return Fx.Doc(sheets);
        }

        [Test]
        public static void Grouped_GroupsByBrowserPath_AndOrdersByNumber()
        {
            var s1 = Fx.Sheet(1, "A-10", path: new[] { Fx.Seg("AR") });
            var s2 = Fx.Sheet(2, "A-2", path: new[] { Fx.Seg("AR") });
            var s3 = Fx.Sheet(3, "S-1", path: new[] { Fx.Seg("ST") });
            GroupingResult r = SheetGroupingService.Build(DocOf(s1, s2, s3), DisplayMode.Grouped, false);
            Assert.Eq(2, r.Groups.Count);
            SheetGroup ar = r.Groups.First(g => g.Title == "AR");
            Assert.SeqEq(new[] { "A-2", "A-10" }, ar.Sheets.Select(s => s.Number), "байгалийн эрэмбэ");
        }

        [Test]
        public static void Grouped_ArbitraryDepth_Tree()
        {
            var deep = Fx.Sheet(1, "1", path: new[] { Fx.Seg("L1"), Fx.Seg("L2"), Fx.Seg("L3"), Fx.Seg("L4"), Fx.Seg("L5") });
            GroupingResult r = SheetGroupingService.Build(DocOf(deep), DisplayMode.Grouped, false);
            GroupNode n = r.Root;
            foreach (string t in new[] { "L1", "L2", "L3", "L4", "L5" })
            {
                Assert.Eq(1, n.Children.Count);
                n = n.Children[0];
                Assert.Eq(t, n.Title);
            }
            Assert.NotNull(n.Group);
            Assert.Eq(GroupNodeKind.Group, n.Kind);
        }

        [Test]
        public static void Grouped_NoOrganization_PutsEverythingInRootGroup()
        {
            GroupingResult r = SheetGroupingService.Build(DocOf(Fx.Sheet(1, "A"), Fx.Sheet(2, "B")), DisplayMode.Grouped, false);
            Assert.Eq(1, r.Groups.Count);
            Assert.NotNull(r.Root.Group, "үндэс зангилаа өөрөө бүлэг");
            Assert.Eq(2, r.Groups[0].Sheets.Count);
        }

        [Test]
        public static void Grouped_SheetsHiddenByBrowserFilter_AreNotListed_ButStayInDocument()
        {
            var a = Fx.Sheet(1, "A");
            var hidden = Fx.Sheet(2, "H", visible: false);
            DocumentSnapshot doc = DocOf(a, hidden);
            GroupingResult r = SheetGroupingService.Build(doc, DisplayMode.Grouped, false);
            Assert.Eq(1, r.Groups.Sum(g => g.Sheets.Count));
            Assert.Eq(2, doc.Sheets.Count);
        }

        [Test]
        public static void Grouped_CollectionAndFolderWithSameName_AreSeparateGroups()
        {
            var inFolder = Fx.Sheet(1, "A", path: new[] { Fx.Seg("ARCH") });
            var inColl = Fx.Sheet(2, "B", collection: 7, path: new[] { Fx.Seg("ARCH") });
            GroupingResult r = SheetGroupingService.Build(DocOf(inFolder, inColl), DisplayMode.Grouped, false);
            Assert.Eq(2, r.Groups.Count);
            Assert.True(r.Groups.Any(g => g.Key.Kind == GroupKind.BrowserFolder));
            Assert.True(r.Groups.Any(g => g.Key.Kind == GroupKind.SheetCollection && g.Key.CollectionElementId == 7));
        }

        [Test]
        public static void Grouped_AssemblyNamedLikeFolder_IsSeparate()
        {
            var inFolder = Fx.Sheet(1, "A", path: new[] { Fx.Seg("ASM5") });
            var asm = Fx.Sheet(2, "B", assembly: true, assemblyId: 5);   // нэр «ASM5»
            GroupingResult r = SheetGroupingService.Build(DocOf(inFolder, asm), DisplayMode.Grouped, false);
            Assert.Eq(2, r.Groups.Count);
            Assert.Eq(1, r.Groups.Count(g => g.Key.Kind == GroupKind.Assembly));
        }

        [Test]
        public static void Grouped_AssemblyOnlyProject_StillPopulates()
        {
            var a1 = Fx.Sheet(1, "A101", assembly: true, assemblyId: 10);
            var a2 = Fx.Sheet(2, "A101", assembly: true, assemblyId: 11);
            var a3 = Fx.Sheet(3, "A102", assembly: true, assemblyId: 11);
            GroupingResult r = SheetGroupingService.Build(DocOf(a1, a2, a3), DisplayMode.Grouped, false);
            Assert.Eq(2, r.Groups.Count);
            Assert.Eq(3, r.Groups.Sum(g => g.Sheets.Count));
            Assert.True(r.Groups.All(g => g.Key.Kind == GroupKind.Assembly));
            Assert.Eq(3, r.Root.TotalSheets);
        }

        [Test]
        public static void Grouped_TreeOrder_FoldersThenCollectionsThenAssemblies()
        {
            var f = Fx.Sheet(1, "A", path: new[] { Fx.Seg("Z-folder") });
            var c = Fx.Sheet(2, "B", collection: 3);
            var a = Fx.Sheet(3, "C", assembly: true, assemblyId: 4);
            GroupingResult r = SheetGroupingService.Build(DocOf(a, c, f), DisplayMode.Grouped, false);
            Assert.SeqEq(new[] { GroupKind.BrowserFolder, GroupKind.SheetCollection, GroupKind.Assembly }, r.Groups.Select(g => g.Key.Kind));
        }

        [Test]
        public static void Grouped_Descending_RespectsBrowserSortDirection()
        {
            DocumentSnapshot doc = DocOf(Fx.Sheet(1, "A1"), Fx.Sheet(2, "A2"), Fx.Sheet(3, "A3"));
            doc.Browser.SortDescending = true;
            GroupingResult r = SheetGroupingService.Build(doc, DisplayMode.Grouped, false);
            Assert.SeqEq(new[] { "A3", "A2", "A1" }, r.Groups[0].Sheets.Select(s => s.Number));
        }

        [Test]
        public static void Grouped_UsesBrowserSortKey_NotJustTheNumber()
        {
            var a = Fx.Sheet(1, "A1"); a.SortKey = "Z";
            var b = Fx.Sheet(2, "A2"); b.SortKey = "M";
            GroupingResult r = SheetGroupingService.Build(DocOf(a, b), DisplayMode.Grouped, false);
            Assert.SeqEq(new[] { "A2", "A1" }, r.Groups[0].Sheets.Select(s => s.Number));
        }

        [Test]
        public static void Grouped_FindContaining_And_Find()
        {
            var s1 = Fx.Sheet(1, "A", path: new[] { Fx.Seg("AR") });
            var s2 = Fx.Sheet(2, "B", path: new[] { Fx.Seg("ST") });
            GroupingResult r = SheetGroupingService.Build(DocOf(s1, s2), DisplayMode.Grouped, false);
            SheetGroup g = r.FindContaining(2);
            Assert.Eq("ST", g.Title);
            Assert.NotNull(r.Find(g.Key));
            Assert.Null(r.FindContaining(99));
        }

        // ── Бүгдийг нэг бүлэгт ──────────────────────────────────────
        [Test]
        public static void AllInOne_ContainsEverySheet_IncludingHiddenAssemblyPlaceholder()
        {
            var a = Fx.Sheet(1, "A", path: new[] { Fx.Seg("AR") });
            var hidden = Fx.Sheet(2, "H", visible: false);
            var asm = Fx.Sheet(3, "AS", assembly: true, assemblyId: 9);
            var ph = Fx.Sheet(4, "PH", placeholder: true);
            GroupingResult r = SheetGroupingService.Build(DocOf(a, hidden, asm, ph), DisplayMode.AllInOne, false);
            Assert.Eq(1, r.Groups.Count);
            Assert.Eq(GroupKind.AllSheets, r.Groups[0].Key.Kind);
            Assert.Eq(4, r.Groups[0].Sheets.Count);
        }

        [Test]
        public static void AllInOne_SortByName_IsStable()
        {
            var a = Fx.Sheet(1, "A1", name: "План"); a.SortKey = "1";
            var b = Fx.Sheet(2, "A2", name: "План"); b.SortKey = "2";
            var c = Fx.Sheet(3, "A3", name: "Зүсэлт"); c.SortKey = "3";
            GroupingResult r = SheetGroupingService.Build(DocOf(a, b, c), DisplayMode.AllInOne, true);
            // «Зүсэлт» < «План»; ижил нэртэй A1, A2 нь анхны (Browser) дарааллаа хадгална.
            Assert.SeqEq(new long[] { 3, 1, 2 }, r.Groups[0].Sheets.Select(s => s.SheetId));
        }

        [Test]
        public static void AllInOne_NoSortByName_UsesBrowserOrder()
        {
            var a = Fx.Sheet(1, "A10"); a.SortKey = "A10";
            var b = Fx.Sheet(2, "A2"); b.SortKey = "A2";
            GroupingResult r = SheetGroupingService.Build(DocOf(a, b), DisplayMode.AllInOne, false);
            Assert.SeqEq(new long[] { 2, 1 }, r.Groups[0].Sheets.Select(s => s.SheetId));
        }

        [Test]
        public static void AllInOne_EmptyProject_HasOneEmptyGroup()
        {
            GroupingResult r = SheetGroupingService.Build(DocOf(), DisplayMode.AllInOne, false);
            Assert.Eq(1, r.Groups.Count);
            Assert.Eq(0, r.Groups[0].Sheets.Count);
        }

        [Test]
        public static void Grouped_EmptyProject_HasNoGroups()
        {
            GroupingResult r = SheetGroupingService.Build(DocOf(), DisplayMode.Grouped, false);
            Assert.Eq(0, r.Groups.Count);
        }

        // ── NaturalComparer ─────────────────────────────────────────
        [Test]
        public static void NaturalComparer_Orders()
        {
            var list = new List<string> { "A-10", "A-2", "B-1", "A-1" };
            list.Sort(NaturalComparer.Instance);
            Assert.SeqEq(new[] { "A-1", "A-2", "A-10", "B-1" }, list);
            // Revit-ийн Browser тэргүүлэх тэгийг ТООЦОХГҮЙ (A-2 = A-02): тэнцүүг нэр, дараа нь ElementId шийднэ.
            Assert.Eq(0, NaturalComparer.Instance.Compare("A-2", "A-02"));
            Assert.Eq(0, NaturalComparer.Instance.Compare("A-002", "A-02"));
            Assert.True(NaturalComparer.Instance.Compare("A-2", "A-10") < 0);
            Assert.True(NaturalComparer.Instance.Compare("A-02", "A-10") < 0);
            Assert.Eq(0, NaturalComparer.Instance.Compare("a1", "A1"));
            Assert.True(NaturalComparer.Instance.Compare("B", "A-1") > 0);
        }

        [Test]
        public static void NaturalComparer_PrefixTextTokenSortsFirst_AsMeasuredInRevit()
        {
            // «A» нь «A »-ийн угтвар → ард нь тоо байсан ч түрүүлнэ (код байрлалаар «1» > « » боловч).
            Assert.True(NaturalComparer.Instance.Compare("A1", "A 1") < 0);
            Assert.True(NaturalComparer.Instance.Compare("A 1", "A-1") < 0);
            Assert.True(NaturalComparer.Instance.Compare("A1", "A-1") < 0);
            // Эхний байрлалд тоо ба тэмдэгт: код байрлалаар («/» < «1» < «=»).
            Assert.True(NaturalComparer.Instance.Compare("/1", "1") < 0);
            Assert.True(NaturalComparer.Instance.Compare("1", "=1") < 0);
            Assert.True(NaturalComparer.Instance.Compare("20", "_x") < 0);
        }

        [Test]
        public static void NaturalComparer_FoldsOnlyAsciiLetters_AsMeasuredInRevit()
        {
            Assert.True(NaturalComparer.Instance.Compare("a", "B") < 0, "ASCII: a < B");
            Assert.True(NaturalComparer.Instance.Compare("_", "a") < 0, "«_» нь жижигрүүлсэн «a»-аас өмнө");
            Assert.True(NaturalComparer.Instance.Compare("Z", "ä") < 0, "ASCII ба латин-1");
            Assert.True(NaturalComparer.Instance.Compare("Б", "б") < 0, "кирилл том нь жижгээс өмнө (том/жижгийг ЯЛГАНА)");
            Assert.True(NaturalComparer.Instance.Compare("Ä", "ä") < 0, "латин-1 том нь жижгээс өмнө");
        }

        [Test]
        public static void NaturalComparer_HugeNumbers_AreCompared_Exactly()
        {
            Assert.True(NaturalComparer.Instance.Compare("A-100000000000000000001", "A-100000000000000000002") < 0);
            Assert.True(NaturalComparer.Instance.Compare("A-9223372036854775808", "A-18446744073709551615") < 0);
            Assert.True(NaturalComparer.Instance.Compare("A-99999999999999999999", "A-100000000000000000000") < 0);
            Assert.Eq(0, NaturalComparer.Instance.Compare("A-0", "A-000"));
        }
    }
}
