using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    /// <summary>
    /// Түлхүүр планы дүүргэлтийн нүх (live gate 2026-10-16, PRESET-KEEP-B102): эхний ажиллуулалт шошгыг, дараа нь маркерыг тусад нь хасдаг
    /// байсан тул дахин ажиллуулалтын нэг алхмын хилээс сегментээр зөрдөг байв.  Хайрцгийн дараалал, тэмдэг дуудах дарааллаас үл хамаарах ёстой.
    /// </summary>
    public static class FillHolesTests
    {
        private static double[] R(double x0, double y0, double x1, double y1) { return new[] { x0, y0, x1, y1 }; }

        [Test]
        public static void Order_and_signature_do_not_depend_on_call_order()
        {
            double[] label = R(10, 10, 12, 11), marker = R(14.5, 9, 15.5, 10), tag = R(10, 13, 13, 14);
            List<double[]> firstRunRefill = WeFillHoles.Sorted(new[] { label, tag, marker });   // эхний ажиллуулалт: шошго, дараа нь маркер
            List<double[]> rerunFill = WeFillHoles.Sorted(new[] { marker, label, tag });        // дахин ажиллуулалт: маркер аль хэдийн бий
            Assert.Eq(3, firstRunRefill.Count);
            for (int i = 0; i < 3; i++) Assert.SeqEq(firstRunRefill[i], rerunFill[i], "хайрцаг " + i);
            Assert.Eq(WeFillHoles.Signature(new[] { label, tag, marker }), WeFillHoles.Signature(new[] { marker, label, tag }));
            Assert.SeqEq(label, firstRunRefill[0], "x0 хамгийн бага нь эхэнд (ижил x0 бол y0)");
        }

        [Test]
        public static void Signature_changes_when_a_marker_appears_and_ignores_rounding_noise()
        {
            double[] label = R(10, 10, 12, 11), marker = R(14.5, 9, 15.5, 10);
            string before = WeFillHoles.Signature(new[] { label });                 // эхний FillRoom — маркер хараахан алга
            string after = WeFillHoles.Signature(new[] { label, marker });           // маркер үүссэний дараа → дахин бодно
            Assert.True(before != after, "маркер нэмэгдвэл тэмдэг өөр");
            string noisy = WeFillHoles.Signature(new[] { R(10 + 2e-5, 10 - 3e-5, 12, 11), R(14.5, 9, 15.5 + 1e-5, 10) });
            Assert.Eq(after, noisy, "bounding box-ийн дугуйлалтын шуугиан тэмдгийг өөрчлөхгүй");
        }

        [Test]
        public static void Degenerate_duplicate_and_flipped_boxes_are_normalised()
        {
            List<double[]> s = WeFillHoles.Sorted(new[]
            {
                R(5, 5, 5, 6),            // өргөнгүй
                null,
                R(12, 11, 10, 10),        // урвуу бичсэн
                R(10, 10, 12, 11),        // ижил хайрцаг
                new[] { 1.0, 2.0 },       // дутуу
            });
            Assert.Eq(1, s.Count, "нэг л жинхэнэ хайрцаг");
            Assert.SeqEq(R(10, 10, 12, 11), s[0]);
            Assert.Eq(string.Empty, WeFillHoles.Signature(new double[][] { }), "хайрцаггүй = хоосон тэмдэг");
        }
    }
}
