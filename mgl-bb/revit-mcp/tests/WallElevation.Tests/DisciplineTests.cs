using System.Collections.Generic;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    /// <summary>Интерьерийн хэрэгслийн хуудасны тогтмол ангилал (2026-10-14): параметрийг НЭРЭЭР тулгах, файлд хадгалахгүй.</summary>
    public static class DisciplineTests
    {
        [Test]
        public static void Interior_classification_matches_parameter_names_loosely()
        {
            Dictionary<string, string> fx = WeSheetDiscipline.Interior();
            Assert.Eq("Интерьер", WeSheetDiscipline.ValueFor(fx, "* Classification"));
            Assert.Eq("Интерьер", WeSheetDiscipline.ValueFor(fx, "classification"));
            Assert.Eq("Барилга архитектур", WeSheetDiscipline.ValueFor(fx, "* Sub-Discipline"));
            Assert.Eq("Барилга архитектур", WeSheetDiscipline.ValueFor(fx, "Sub Discipline"));
            Assert.Eq("Барилга архитектур", WeSheetDiscipline.ValueFor(fx, "*SUB_DISCIPLINE"));
            Assert.Null(WeSheetDiscipline.ValueFor(fx, "* Type Design"), "бусад параметр хөндөгдөхгүй");
            Assert.Null(WeSheetDiscipline.ValueFor(fx, "Discipline"), "«Discipline» ≠ «Sub-Discipline»");
            Assert.Null(WeSheetDiscipline.ValueFor(null, "* Classification"));
            Assert.Eq("subdiscipline", WeSheetDiscipline.NormalizeName("* Sub-Discipline"));
        }

        [Test]
        public static void Interior_flag_is_cloned_but_never_saved()
        {
            var s = new WeSettings { InteriorTool = true, FixedSheetParams = WeSheetDiscipline.Interior() };
            WeSettings c = s.Clone();
            Assert.True(c.InteriorTool);
            Assert.Eq(2, c.FixedSheetParams.Count);
            c.FixedSheetParams.Clear();
            Assert.Eq(2, s.FixedSheetParams.Count, "Clone гүн хуулна");
            WeSettings r = WeSettings.Deserialize(s.Serialize());
            Assert.False(r.InteriorTool, "товч бүр өөрийн — файлд хадгалагдахгүй");
            Assert.Eq(0, r.FixedSheetParams.Count);
        }
    }
}
