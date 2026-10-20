using System;
using System.Collections.Generic;
using System.Linq;
using MglBb.Core;

namespace MglBb.Tests
{
    public static class LearnTests
    {
        [Test]
        public static void NamePatterns()
        {
            Assert.Eq("ДАМНУРУУ {mark} АРМАТУРЧЛАЛ", BbNames.Pattern("ДАМНУРУУ ДН-1 АРМАТУРЧЛАЛ", "ДН-1"));
            Assert.Eq("БАГАНА {mark} АРМАТУРЧЛАЛ", BbNames.Pattern("БАГАНА  Б-1 АРМАТУРЧЛАЛ", "Б-1"));
            Assert.Eq("{mark} S{n}", BbNames.SectionPattern("ДН-1 S3", "ДН-1"));
            Assert.Eq("{mark} S {n}", BbNames.SectionPattern("Б-12 S 4", "Б-12"));
            Assert.Eq(null, BbNames.SectionPattern("ДН-1 SA", "ДН-1"));
            Assert.Eq(" Copy {n}", BbNames.PartSuffix("ДАМНУРУУ ДН-1 АРМАТУРЧЛАЛ Copy 1", "ДАМНУРУУ ДН-1 АРМАТУРЧЛАЛ"));
        }

        [Test]
        public static void MarkIsWholeWord()
        {
            Assert.Eq(-1, BbNames.IndexOfMark("ДАМНУРУУ ДН-12 АРМАТУРЧЛАЛ", "ДН-1"));
            Assert.Eq(-1, BbNames.IndexOfMark("БАГАНА Б-1-1 АРМАТУРЧЛАЛ", "Б-1"));
            Assert.Eq(-1, BbNames.IndexOfMark("ТДН-1 S1", "ДН-1"));
            Assert.Eq(9, BbNames.IndexOfMark("ДАМНУРУУ ДН-1 АРМАТУРЧЛАЛ Copy 1", "ДН-1"));
        }

        [Test]
        public static void SamplesApplyMedianModeMajority()
        {
            var s = new BbSamples();
            foreach (double v in new[] { 280.0, 285, 290, 600, 284 }) s.Num("beam.ElevCropBelowMm", v);
            foreach (string t in new[] { "A", "B", "A" }) s.Str("beam.ElevViewType", t);
            foreach (int sc in new[] { 50, 50, 20 }) s.Num("beam.ElevScale", sc);
            s.Bool("column.SecRightSide", false); s.Bool("column.SecRightSide", false); s.Bool("column.SecRightSide", true);
            s.Num("beam.ElevCropAboveMm", 1); // нэг жишээ — хэрэглэхгүй
            var std = new BbStandard();
            int n = s.ApplyTo(std, minSamples: 3);
            Assert.Eq(4, n);
            Assert.Near(285, std.Beam.ElevCropBelowMm, 1e-9);
            Assert.Eq("A", std.Beam.ElevViewType);
            Assert.Eq(50, std.Beam.ElevScale);
            Assert.False(std.Column.SecRightSide);
            Assert.Near(290, std.Beam.ElevCropAboveMm, 1e-9); // өгөгдмөл хэвээр
            Assert.Eq(5, std.Evidence["beam.ElevCropBelowMm"]);
        }

        [Test]
        public static void StandardJsonRoundTrip()
        {
            var std = new BbStandard { Source = "ЖИШЭЭ-1.rvt" };
            std.Beam.ElevViewType = "2.4. Рамын арматурчлал + Дамнуруу";
            std.Column.SecScale = 25;
            std.BeamAux.SecBarChain = false;
            std.Evidence["beam.ElevScale"] = 136;
            var back = BbStandard.FromJson(BbJson.Parse(BbJson.Write(std.ToJson())));
            Assert.Eq("ЖИШЭЭ-1.rvt", back.Source);
            Assert.Eq("2.4. Рамын арматурчлал + Дамнуруу", back.Beam.ElevViewType);
            Assert.Eq(25, back.Column.SecScale);
            Assert.False(back.BeamAux.SecBarChain);
            Assert.Eq(136, back.Evidence["beam.ElevScale"]);
            Assert.Eq("ДАМНУРУУ ДН-1 АРМАТУРЧЛАЛ Copy 1", back.Beam.ElevName("ДН-1", 2));
            Assert.Eq("ДН-1 S3", back.Beam.SecName("ДН-1", 3));
        }

        [Test]
        public static void SpansAndStations()
        {
            // 3 алгасал: багана 0..600, 8000..8600, 16000..16600, гинж 0..16600
            var member = new BbSpan(0, 16600);
            var sup = new[] { new BbSpan(0, 600), new BbSpan(8000, 8600), new BbSpan(16000, 16600) };
            var spans = BbLayoutMath.ClearSpans(member, sup);
            Assert.Eq(2, spans.Count);
            Assert.Near(600, spans[0].A, 1e-9);
            Assert.Near(8000, spans[0].B, 1e-9);
            var st = BbLayoutMath.SectionStations(member, spans, sup, 830, 0.12, true, true, 400);
            Assert.Eq(6, st.Count);
            Assert.Near(1430, st[0], 1e-9);
            Assert.Near(4300, st[1], 1e-9);
            Assert.Near(7170, st[2], 1e-9);
            // зөвхөн сүүлийн алгасалд баруун тулгуур: 1430, 4300, 9430, 12300, 15170
            var st2 = BbLayoutMath.SectionStations(member, spans, sup, 830, 0.12, true, true, 400, rightOnlyLast: true);
            Assert.Eq(5, st2.Count);
            Assert.Near(9430, st2[2], 1e-9);
            Assert.Near(15170, st2[4], 1e-9);
        }

        [Test]
        public static void SplitPartsAtSupport()
        {
            var ext = new BbSpan(-600, 50100);
            var sup = new[] { new BbSpan(0, 1000), new BbSpan(8000, 9000), new BbSpan(16000, 17000), new BbSpan(24050, 24950), new BbSpan(32500, 33500), new BbSpan(49000, 50000) };
            var parts = BbLayoutMath.SplitParts(ext, sup, 28000, 2000);
            Assert.Eq(2, parts.Count);
            // хуваах цэг = тулгуурын (24050..24950) голд, 2 м давхцалтай
            Assert.Near(24500 + 1000, parts[0].B, 1e-6);
            Assert.Near(24500 - 1000, parts[1].A, 1e-6);
        }
    }
}
