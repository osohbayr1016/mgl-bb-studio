using System;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    /// <summary>
    /// W03/W07 (2026-10-16): харагдацын төлөв (шинэ хувилбартай схем — хуучин GUID хөндөгдөхгүй) ба масштабын дүрэм: сонгосон масштаб үүсгэх,
    /// дахин ажиллуулахад ЯГ; гараар сольсныг тохиргоо өөрчлөгдөөгүй үед хадгална.
    /// </summary>
    public static class ViewStateTests
    {
        [Test]
        public static void View_state_round_trips_and_keeps_unknown_future_keys()
        {
            // «preset» нь W09-өөс албан ёсны түлхүүр — танихгүй түлхүүрийн жишээ нь «joints» (W08-ийн ирээдүйн утга).
            var s = new WeViewState { Scale = 50, CropLowerMm = -150, CropUpperMm = 2700.5, Preset = WePresetId.Bathroom };
            s.Unknown["joints"] = "tile600";
            string text = s.Serialize();
            Assert.True(text.StartsWith("v=1;", StringComparison.Ordinal), "хувилбартай: " + text);
            WeViewState r = WeViewState.Parse(text);
            Assert.Eq(50, r.Scale);
            Assert.Eq(-150.0, r.CropLowerMm);
            Assert.Eq(2700.5, r.CropUpperMm);
            Assert.Eq(WePresetId.Bathroom, r.Preset, "өрөөний зориулалт харагдац дээр хадгалагдана");
            Assert.Eq("tile600", r.Unknown["joints"], "ирээдүйн хувилбарын түлхүүрийг хуучин хувилбар устгахгүй");
            Assert.True(r.HasCropOverride);
            Assert.Eq(string.Empty, WeViewState.Parse("v=1;preset=garbage").Preset, "танихгүй зориулалт → хоосон");
        }

        [Test]
        public static void View_state_parse_never_throws_and_defaults_bad_values()
        {
            foreach (string bad in new[] { null, "", "garbage", "v=9;scale=abc;lo=NaN;up=1e999", "scale=0;scale=99999", ";;=;=x" })
            {
                WeViewState s = WeViewState.Parse(bad);
                Assert.Eq(0, s.Scale, "буруу масштаб → 0 («" + bad + "»)");
                Assert.True(double.IsNaN(s.CropLowerMm) && double.IsNaN(s.CropUpperMm), "буруу мм → Авто («" + bad + "»)");
            }
            Assert.False(new WeViewState().HasCropOverride, "өгөгдмөл = Авто");
        }

        [Test]
        public static void Scale_rule_applies_the_setting_to_new_views()
        {
            WeScaleRule.Decision d = WeScaleRule.Decide(100, 0, 50, true);
            Assert.Eq(50, d.Apply);
            Assert.Eq(50, d.Record);
            Assert.False(d.KeptManual);
        }

        [Test]
        public static void Scale_rule_keeps_a_manual_scale_when_the_setting_did_not_change()
        {
            // Хэрэгсэл 1:50 тавьсан, хэрэглэгч 1:25 болгосон, тохиргоо 1:50 хэвээр → 1:25 хадгална.
            WeScaleRule.Decision d = WeScaleRule.Decide(25, 50, 50, false);
            Assert.Eq(25, d.Apply);
            Assert.True(d.KeptManual);
            Assert.Eq(50, d.Record, "хэрэгслийн зорьсон масштаб бичигдэнэ — дараагийн удаа ч хадгална");
            // Дараагийн ажиллагаа: ижил төлөв → дахин хадгална.
            Assert.Eq(25, WeScaleRule.Decide(25, d.Record, 50, false).Apply);
        }

        [Test]
        public static void Scale_rule_applies_a_changed_setting_even_over_a_manual_scale()
        {
            // Хэрэглэгч цонхонд 1:50 → 1:100 болгосон (ИЛ шийдвэр) — гараар 1:25 болгосон байсан ч шинэ тохиргоо.
            WeScaleRule.Decision d = WeScaleRule.Decide(25, 50, 100, false);
            Assert.Eq(100, d.Apply);
            Assert.False(d.KeptManual);
            // Хэрэгсэл тавьсан хэвээр, тохиргоо өөрчлөгдсөн → шинэ утга.
            Assert.Eq(75, WeScaleRule.Decide(50, 50, 75, false).Apply);
        }

        [Test]
        public static void Scale_rule_for_legacy_views_follows_the_old_behaviour_per_kind()
        {
            // Дэлгээс (төлөвгүй, өмнөх хувилбар үргэлж тохиргоог хэрэглэдэг байсан) → тохиргоо.
            Assert.Eq(50, WeScaleRule.Decide(75, 0, 50, false, true).Apply);
            // Түлхүүр план / 3D (өмнөх хувилбар хуудсанд багтаахаар 1:125 болгосон байж болно) → хэвээр, хуудсыг эвдэхгүй.
            WeScaleRule.Decision k = WeScaleRule.Decide(125, 0, 50, false, false);
            Assert.Eq(125, k.Apply);
            Assert.True(k.KeptManual);
            Assert.Eq(50, k.Record, "дараагийн удаа гараар гэж танигдаж хадгалагдана");
            Assert.Eq(125, WeScaleRule.Decide(125, k.Record, 50, false, false).Apply, "дахин ажиллуулахад тогтвортой");
        }
    }
}
