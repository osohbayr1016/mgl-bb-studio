using System;
using System.Linq;
using RevitMcpAddin.Ui.Core;

namespace RevitMcpAddin.Ui.Tests
{
    public static class ToolIconTests
    {
        [Test]
        public static void Every_tool_and_the_erp_pulldown_has_an_icon_spec()
        {
            foreach (ToolMeta t in ToolCatalogData.All)
                Assert.NotNull(ToolIcons.Find(t.IconKey), t.Name + " → '" + t.IconKey + "'");
            Assert.NotNull(ToolIcons.Find(ToolPulldowns.ErpSendIconKey), "ERP pulldown");
        }

        [Test]
        public static void Icon_colours_are_unique_so_similar_buttons_are_never_the_same_colour()
        {
            // Хоёр товч (Family сан ≡ Зураг холбох, Түүвэр синк ≡ Хуудас үүсгэх) өмнө нь ижил өнгөтэй байв.
            var dup = ToolIcons.All.GroupBy(s => s.Hex.ToUpperInvariant()).Where(g => g.Count() > 1).Select(g => g.Key + ":" + string.Join("/", g.Select(s => s.Key))).ToList();
            Assert.Eq(0, dup.Count, string.Join(", ", dup));
        }

        [Test]
        public static void Icon_keys_are_unique_and_hex_and_codepoints_valid()
        {
            Assert.Eq(ToolIcons.All.Count, ToolIcons.All.Select(s => s.Key).Distinct().Count());
            foreach (ToolIconSpec s in ToolIcons.All)
            {
                int r, g, b;
                Assert.True(MglContrast.TryParseHex(s.Hex, out r, out g, out b), s.Key + " hex");
                Assert.True(s.CodePoints.Length >= 1 && s.CodePoints.All(c => c >= 0xE000 && c <= 0xF8FF), s.Key + " код цэг нь Private Use Area (Segoe icon)");
            }
        }

        [Test]
        public static void Confusable_pairs_get_different_first_choice_glyphs()
        {
            // Хавтсанд гаргах ≠ ERP руу илгээх
            Assert.True(ToolIcons.Find("publish").CodePoints[0] != ToolIcons.Find("erp-send").CodePoints[0]);
            Assert.False(ToolIcons.Find("publish").CodePoints.Contains(0xE898), "Файл гаргах нь «Upload» сумгүй (ERP илгээхтэй андуурагдана)");
            // Элемент хуулах ≠ Түүвэр хувилах
            Assert.True(ToolIcons.Find("copy-to").CodePoints[0] != ToolIcons.Find("schedule-clone").CodePoints[0]);
            // Хуудас үүсгэх ≠ Хуудас дугаарлах
            Assert.True(ToolIcons.Find("sheets").CodePoints[0] != ToolIcons.Find("sheet-numerator").CodePoints[0]);
        }

        [Test]
        public static void Icon_colour_is_mid_tone_readable_on_light_and_dark_ribbon()
        {
            // App.cs-ийн «DimGray нь бараан туузан дээр харагддаггүй байв» сургамж: гэрэлтэлт хэт бага/өндөр биш.
            foreach (ToolIconSpec s in ToolIcons.All)
            {
                double l = MglContrast.Luminance(s.Hex);
                Assert.True(l > 0.07 && l < 0.55, s.Key + " " + s.Hex + " гэрэлтэлт " + l.ToString("F2"));
            }
        }
    }
}
