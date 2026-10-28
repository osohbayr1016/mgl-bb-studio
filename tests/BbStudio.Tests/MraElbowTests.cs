using MglBb.Core;

namespace MglBb.Tests
{
    public static class MraElbowTests
    {
        [Test]
        public static void TextOnTheLineBreaksAtItsStart()
        {
            // ЖИШЭЭ-1 доод үе MRA 32419884: шугам −8.4..55, толгой 41.36, бичвэр 39.4..60.1 → хугарал 37.86 (толгойноос 3.5).
            Assert.Near(41.36 - 3.9, BbMraElbow.U(41.36, 39.36, 60.14, -8.38, 54.95, 3.9, 0.9), 1e-9);
        }

        [Test]
        public static void TextBeforeTheLineBreaksAtItsEnd()
        {
            // MRA 32419911: шугам 129.5..149.5, бичвэр 111.5..134.2 (шугамын өмнө эхэлсэн) → хугарал бичвэрийн төгсгөлд 133.26.
            Assert.Near(134.16 - 0.9, BbMraElbow.U(113.53, 111.53, 134.16, 129.53, 149.53, 3.9, 0.9), 1e-9);
            // Дээд үе MRA 32006249: бичвэр −15.85..6.82, шугам −8.4.. → 5.92.
            Assert.Near(5.92, BbMraElbow.U(-13.85, -15.85, 6.82, -8.38, 54.95, 3.9, 0.9), 1e-9);
        }

        [Test]
        public static void OnlyWhenTheLineRunsAlongTheText()
        {
            Assert.True(BbMraElbow.Along(1));
            Assert.True(BbMraElbow.Along(-1), "чиглэлийн тэмдэг хамаагүй");
            Assert.False(BbMraElbow.Along(0), "босоо шугам → хугаралгүй (инженер ч тавиагүй)");
        }

        [Test]
        public static void DefaultsFromExampleOne()
        {
            var ps = new BbPlateStandard();
            Assert.True(ps.MraElbows);
            Assert.Near(3.9, ps.MraElbowLeftPaperMm, 1e-9);
            Assert.Near(0.9, ps.MraElbowRightPaperMm, 1e-9);
        }
    }
}
