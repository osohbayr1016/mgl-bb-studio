using RevitMcpAddin.CloneDrawings.Core;

namespace RevitMcpAddin.CloneDrawings.Tests
{
    public static class ElementKindTests
    {
        [Test]
        public static void FramingSplitsIntoBeamJoistBrace()
        {
            Assert.Eq("Дам нуруу", ElementKind.Describe("OST_StructuralFraming", "W Shapes", "W18x55", "Girder", "Structural Framing"));
            Assert.Eq("Ферм", ElementKind.Describe("OST_StructuralFraming", "K-Series Bar Joist-Angle Web", "16K6", "Joist", "Structural Framing"));
            Assert.Eq("Налуу тулгуур", ElementKind.Describe("OST_StructuralFraming", "HSS", "HSS6x6", "Brace", "Structural Framing"));
            Assert.Eq("Дам нуруу", ElementKind.Describe("OST_StructuralFraming", "Concrete-Rectangular Beam", "CB24x30", null, "Structural Framing"));
        }

        [Test]
        public static void KnownCategories()
        {
            Assert.Eq("Багана", ElementKind.Describe("OST_StructuralColumns", "Concrete-Rectangular-Column", "CC24x24", null, "Structural Columns"));
            Assert.Eq("Хана", ElementKind.Describe("OST_Walls", null, "Generic - 200mm", null, "Walls"));
            Assert.Eq("Шон суурь", ElementKind.Describe("OST_StructuralFoundation", "Pile Cap", "36x36 Pile_24", null, "Structural Foundations"));
            Assert.Eq("Хаалга", ElementKind.Describe("OST_Doors", "Single-Flush", "0915 x 2134", null, "Doors"));
        }

        [Test]
        public static void UnknownCategoryFallsBackToRevitName()
        {
            Assert.Eq("Specialty Equipment", ElementKind.Describe("OST_SpecialityEquipment", "X", "Y", null, "Specialty Equipment"));
            Assert.Eq("Элемент", ElementKind.Describe(null, null, null, null, null));
        }
    }

    public static class NameMatchTests
    {
        [Test]
        public static void MatchesWholeToken()
        {
            Assert.True(NameMatch.ContainsMark("B1 - Дам нурууны фасад", "B1"));
            Assert.True(NameMatch.ContainsMark("Зүсэлт 1-1 (B1)", "B1"));
            Assert.True(NameMatch.ContainsMark("S-B1", "B1"));
            Assert.True(NameMatch.ContainsMark("b1_detail", "B1"));
            Assert.False(NameMatch.ContainsMark("B12 - фасад", "B1"));
            Assert.False(NameMatch.ContainsMark("AB1 план", "B1"));
        }

        [Test]
        public static void CyrillicAndLatinLookalikesAreEqual()
        {
            // «В1» кирилл В, тэмдэг нь латин «B1».
            Assert.True(NameMatch.ContainsMark("В1 - зүсэлт", "B1"));
            Assert.True(NameMatch.ContainsMark("C-12 detail", "С-12"));
        }

        [Test]
        public static void AmbiguousMarkNeverMatches()
        {
            Assert.False(NameMatch.ContainsMark("Level 1", "1"));
            Assert.False(NameMatch.ContainsMark("Section 12", "12"));
            Assert.False(NameMatch.ContainsMark("anything", null));
        }
    }
}
