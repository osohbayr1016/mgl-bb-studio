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
                Assert.Near(1.5, ms.SecBottomTagDyFromBarPaperMm, 1e-9);
                Assert.Near(15.5, ms.SecTagOutPaperMm, 1e-9);
                // Хугарал (ЖИШЭЭ-2 засвар, 14:56): ажлын арматур — тэнхлэгээс, хомут — хөлөөс.
                ms.RoleElbow(BbBarRole.Top, out string topRef, out double topD);
                ms.RoleElbow(BbBarRole.Bottom, out string botRef, out double botD);
                ms.RoleElbow(BbBarRole.Stirrup, out string stRef, out double stD);
                Assert.Eq(BbTagRoles.ElbowAxis, topRef);
                Assert.Eq(BbTagRoles.ElbowAxis, botRef);
                Assert.Eq(BbTagRoles.ElbowEnd, stRef);
                Assert.Near(3.5, topD, 1e-9);
                Assert.Near(0.5, botD, 1e-9);
                Assert.Near(3, stD, 1e-9);
            }
        }
    }
}
