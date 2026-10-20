using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.CloneDrawings.Core;

namespace RevitMcpAddin.CloneDrawings.Tests
{
    /// <summary>«Загвар харагдацаас идэвхтэй харагдац руу хуулах» — цэвэр шийдвэрүүд.</summary>
    public static class OntoViewRulesTests
    {
        [Test]
        public static void Flip_SameSide_False()
        {
            // Хоёулаа тэнхлэгийн + чиглэлд харж байна.
            Assert.False(OntoViewRules.NeedsFlip(0.99, 0.97));
            // Хоёулаа − чиглэлд.
            Assert.False(OntoViewRules.NeedsFlip(-1, -0.8));
        }

        [Test]
        public static void Flip_OppositeSides_True()
        {
            Assert.True(OntoViewRules.NeedsFlip(1, -1));
            Assert.True(OntoViewRules.NeedsFlip(-0.7, 0.9));
        }

        [Test]
        public static void Flip_NotEndOn_NoDecision()
        {
            // Дагуу огтлол (харагдац тэнхлэгт ⟂) эсвэл план — шийдвэр гаргахгүй (ердийн хүрээ).
            Assert.False(OntoViewRules.NeedsFlip(0.05, -1));
            Assert.False(OntoViewRules.NeedsFlip(1, -0.2));
            Assert.False(OntoViewRules.NeedsFlip(0, 0));
        }

        [Test]
        public static void Flip_Boundary_IsEndOnAtHalf()
        {
            Assert.True(OntoViewRules.IsEndOn(0.5));
            Assert.True(OntoViewRules.IsEndOn(-0.5));
            Assert.False(OntoViewRules.IsEndOn(0.4999));
        }

        [Test]
        public static void Views_SameKindFirst_ThenMostAnnotated_ThenName()
        {
            var rows = new List<OntoViewRules.ViewRow>
            {
                new OntoViewRules.ViewRow { Id = 1, Name = "Plan A", Dims = 30, Tags = 30, SameKind = false },
                new OntoViewRules.ViewRow { Id = 2, Name = "Section 2", Dims = 4, Tags = 2, SameKind = true },
                new OntoViewRules.ViewRow { Id = 3, Name = "Section 1", Dims = 4, Tags = 2, SameKind = true },
                new OntoViewRules.ViewRow { Id = 4, Name = "Section 9", Dims = 9, Tags = 6, SameKind = true },
            };
            List<long> ids = OntoViewRules.OrderViews(rows).Select(r => r.Id).ToList();
            // Ижил төрөл: 9 (хамгийн олон) → 1, 2 (ижил тоо — нэрээр) → дараа нь өөр төрөл.
            Assert.Eq("4,3,2,1", string.Join(",", ids));
        }

        [Test]
        public static void Views_Haystack_HasNameAndType_NotCounts()
        {
            var r = new OntoViewRules.ViewRow { Name = "Дам нуруу B1 огтлол", TypeLabel = "Огтлол", Dims = 12, Tags = 8 };
            string h = OntoViewRules.Haystack(r);
            Assert.True(h.Contains("B1"));
            Assert.True(h.Contains("Огтлол"));
            Assert.False(h.Contains("12"));
        }

        [Test]
        public static void Hosts_MostReferencedFirst()
        {
            var counts = new Dictionary<long, int> { { 10, 3 }, { 20, 12 }, { 30, 5 } };
            bool amb;
            List<long> order = OntoViewRules.OrderHosts(counts, out amb);
            Assert.Eq("20,30,10", string.Join(",", order));
            Assert.False(amb);
        }

        [Test]
        public static void Hosts_TieAtTop_IsAmbiguous()
        {
            var counts = new Dictionary<long, int> { { 7, 4 }, { 5, 4 }, { 9, 1 } };
            bool amb;
            List<long> order = OntoViewRules.OrderHosts(counts, out amb);
            Assert.True(amb);
            // Тэнцүү үед id-аар тогтвортой.
            Assert.Eq("5,7,9", string.Join(",", order));
        }

        [Test]
        public static void Hosts_ZeroRefs_Excluded_AndSingleIsNotAmbiguous()
        {
            bool amb;
            List<long> none = OntoViewRules.OrderHosts(new Dictionary<long, int> { { 1, 0 } }, out amb);
            Assert.Eq(0, none.Count);
            Assert.False(amb);
            List<long> one = OntoViewRules.OrderHosts(new Dictionary<long, int> { { 1, 2 } }, out amb);
            Assert.Eq(1, one.Count);
            Assert.False(amb);
        }
    }
}
