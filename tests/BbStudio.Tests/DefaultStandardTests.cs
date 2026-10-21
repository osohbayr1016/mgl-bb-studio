using System;
using System.IO;
using MglBb.Core;

namespace MglBb.Tests
{
    public static class DefaultStandardTests
    {
        /// <summary>Plugin-д шигтгэсэн өгөгдмөл стандарт (src/MglBbStudio/Resources) — тестийн хавтаснаас дээш хайна.</summary>
        private static BbStandard Embedded()
        {
            string dir = AppContext.BaseDirectory;
            while (dir != null)
            {
                string p = Path.Combine(dir, "src", "MglBbStudio", "Resources", "standard-default.json");
                if (File.Exists(p)) return BbStandard.Load(p);
                dir = Path.GetDirectoryName(dir);
            }
            throw new FileNotFoundException("standard-default.json");
        }

        [Test]
        public static void BeamSectionTagLayoutIsLearnedByDefault()
        {
            // ЖИШЭЭ-2-оос сурсан (2026-10-21) — «Стандарт сурах»-гүйгээр анхнаасаа хэрэглэгдэнэ.  Талбарын нэр өөрчлөгдвөл энд унана.
            BbStandard std = Embedded();
            foreach (BbMemberStandard ms in new[] { std.Beam, std.BeamAux })
            {
                Assert.Eq("left", ms.SecTopTagSide);
                Assert.Eq("left", ms.SecBottomTagSide);
                Assert.Eq("left", ms.SecSideTagSide);
                Assert.Eq("left", ms.SecStirrupTagSide);
                Assert.Near(11, ms.SecTopTagDxPaperMm, 1e-9);
                Assert.Near(8.5, ms.SecTopTagDyFromBarPaperMm, 1e-9);
                Assert.Near(3, ms.SecBottomTagDyFromBarPaperMm, 1e-9);
                Assert.Near(24, ms.SecLeaderLandingPaperMm, 1e-9);
                Assert.Near(8.5, ms.SecLeaderRunPaperMm, 1e-9);
                Assert.Near(14.5, ms.SecTagOutPaperMm, 1e-9);
            }
        }
    }
}
