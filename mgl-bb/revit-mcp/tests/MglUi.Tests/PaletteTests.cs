using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.Ui.Core;

namespace RevitMcpAddin.Ui.Tests
{
    /// <summary>Өнгөний токен: контраст нь БИЧИГДСЭН биш, ТООЦООЛОГДСОН.</summary>
    public static class PaletteTests
    {
        private static IReadOnlyDictionary<string, string> Pal(MglThemeMode m) { return MglPalette.For(m); }

        [Test]
        public static void Both_palettes_define_exactly_the_same_valid_keys()
        {
            foreach (MglThemeMode m in new[] { MglThemeMode.Light, MglThemeMode.Dark })
            {
                IReadOnlyDictionary<string, string> p = Pal(m);
                Assert.SeqEq(MglPalette.Keys.OrderBy(k => k), p.Keys.OrderBy(k => k), m + " түлхүүрийн олонлог");
                foreach (string k in MglPalette.Keys)
                {
                    int r, g, b;
                    Assert.True(MglContrast.TryParseHex(p[k], out r, out g, out b), m + "/" + k + " = " + p[k] + " буруу hex");
                }
            }
        }

        [Test]
        public static void HighContrast_has_no_hardcoded_palette_system_colours_win()
        {
            Assert.Null(MglPalette.For(MglThemeMode.HighContrast));
        }

        [Test]
        public static void Resolver_high_contrast_beats_everything()
        {
            Assert.Eq(MglThemeMode.HighContrast, MglThemeResolver.Resolve(true, "Dark"));
            Assert.Eq(MglThemeMode.HighContrast, MglThemeResolver.Resolve(true, "Light"));
            Assert.Eq(MglThemeMode.HighContrast, MglThemeResolver.Resolve(true, null));
        }

        [Test]
        public static void Resolver_follows_revit_theme_and_defaults_to_light()
        {
            Assert.Eq(MglThemeMode.Dark, MglThemeResolver.Resolve(false, "Dark"));
            Assert.Eq(MglThemeMode.Dark, MglThemeResolver.Resolve(false, "dark"));
            Assert.Eq(MglThemeMode.Light, MglThemeResolver.Resolve(false, "Light"));
            Assert.Eq(MglThemeMode.Light, MglThemeResolver.Resolve(false, null));
            Assert.Eq(MglThemeMode.Light, MglThemeResolver.Resolve(false, "Sepia"));
        }

        [Test]
        public static void Contrast_math_matches_wcag_reference_values()
        {
            Assert.True(Math.Abs(MglContrast.Ratio("#000000", "#FFFFFF") - 21.0) < 0.001, "хар/цагаан = 21");
            Assert.True(Math.Abs(MglContrast.Ratio("#777777", "#777777") - 1.0) < 1e-9, "ижил өнгө = 1");
            // WCAG жишээ: #767676 цагаан дээр ≈ 4.54 (AA-г давах хамгийн саарал)
            double r = MglContrast.Ratio("#767676", "#FFFFFF");
            Assert.True(r > 4.5 && r < 4.6, "#767676 цагаан дээр " + r);
            Assert.True(Math.Abs(MglContrast.Ratio("#FFFFFF", "#000000") - MglContrast.Ratio("#000000", "#FFFFFF")) < 1e-9, "тэгш хэмтэй");
        }

        [Test]
        public static void Contrast_rejects_malformed_hex()
        {
            Assert.Throws<ArgumentException>(() => MglContrast.Ratio("white", "#000000"));
            Assert.Throws<ArgumentException>(() => MglContrast.Ratio("#12345", "#000000"));
        }

        // ── Бодит шаардлага: хоёр сэдэв бүрт ───────────────────────────────
        private static void ForEachTheme(Action<MglThemeMode, IReadOnlyDictionary<string, string>> check)
        {
            foreach (MglThemeMode m in new[] { MglThemeMode.Light, MglThemeMode.Dark }) check(m, Pal(m));
        }

        private static void AtLeast(string theme, IReadOnlyDictionary<string, string> p, string fg, string bg, double min)
        {
            double r = MglContrast.Ratio(p[fg], p[bg]);
            Assert.True(r >= min, theme + ": " + fg + " (" + p[fg] + ") / " + bg + " (" + p[bg] + ") = " + r.ToString("F2") + " < " + min);
        }

        [Test]
        public static void Body_text_meets_4_5_on_every_surface_it_can_sit_on()
        {
            ForEachTheme((m, p) =>
            {
                foreach (string bg in new[] { "Bg", "BgRaised", "BgInput", "Hover", "Pressed", "Selected", "AccentSoft" })
                    AtLeast(m.ToString(), p, "Fg", bg, 4.5);
                foreach (string bg in new[] { "Bg", "BgRaised", "BgInput", "Hover", "Selected" })
                    AtLeast(m.ToString(), p, "FgMuted", bg, 4.5);   // secondary текст ≥ 12 DIP-тэй ч 4.5 шаардана
            });
        }

        [Test]
        public static void Text_on_hover_pressed_and_selected_rows_has_its_own_tokens_and_meets_4_5()
        {
            // Өндөр контрастад hover/selected дэвсгэр Highlight болж, текст нь HighlightText болдог — тиймээс
            // удирдлагын загвар Foreground-ийг ҮРГЭЛЖ эдгээр токеноос авна.
            ForEachTheme((m, p) =>
            {
                AtLeast(m.ToString(), p, "HoverFg", "Hover", 4.5);
                AtLeast(m.ToString(), p, "PressedFg", "Pressed", 4.5);
                AtLeast(m.ToString(), p, "SelectedFg", "Selected", 4.5);
            });
        }

        [Test]
        public static void Accent_button_text_and_accent_as_text_meet_4_5()
        {
            ForEachTheme((m, p) =>
            {
                AtLeast(m.ToString(), p, "AccentFg", "Accent", 4.5);
                AtLeast(m.ToString(), p, "Accent", "Bg", 4.5);
                AtLeast(m.ToString(), p, "Accent", "BgRaised", 4.5);
                AtLeast(m.ToString(), p, "Accent", "AccentSoft", 4.5);
            });
        }

        [Test]
        public static void Semantic_colours_meet_4_5_as_text_and_on_their_own_tint()
        {
            ForEachTheme((m, p) =>
            {
                foreach (string s in new[] { "Ok", "Warn", "Danger", "Info" })
                {
                    AtLeast(m.ToString(), p, s, "Bg", 4.5);
                    AtLeast(m.ToString(), p, s, "BgRaised", 4.5);
                    AtLeast(m.ToString(), p, s, s + "Bg", 4.5);
                    AtLeast(m.ToString(), p, "Fg", s + "Bg", 4.5);
                }
            });
        }

        [Test]
        public static void Control_boundaries_and_focus_ring_meet_3_to_1()
        {
            ForEachTheme((m, p) =>
            {
                foreach (string bg in new[] { "Bg", "BgRaised", "BgInput" })
                    AtLeast(m.ToString(), p, "LineStrong", bg, 3.0);
                AtLeast(m.ToString(), p, "Accent", "Bg", 3.0);    // фокусын цагираг
            });
        }

        [Test]
        public static void Decorative_Line_token_is_NOT_used_for_control_boundaries()
        {
            // Хэрэглэгчийн санал болгосон #CBD5E1 / #4B5563 нь суурь дээр < 3:1 (гоёл) — тиймээс
            // удирдлагад ЗААВАЛ LineStrong.  Энэ тест токены үүргийг тогтооно: Line < 3:1, LineStrong ≥ 3:1.
            ForEachTheme((m, p) =>
            {
                Assert.True(MglContrast.Ratio(p["Line"], p["Bg"]) < 3.0, m + ": Line нь зааглах шугам — удирдлагын хүрээ болгож болохгүй");
                Assert.True(MglContrast.Ratio(p["LineStrong"], p["Bg"]) >= 3.0, m + ": LineStrong");
            });
        }

        [Test]
        public static void Legacy_pane_keys_still_exist_so_dark_panes_can_migrate_by_DynamicResource()
        {
            // AssistantPane/WorkPane/Intelligence түлхүүрүүд: Bg BgRaised BgInput Line Fg FgMuted Accent AccentDim Warn Danger
            foreach (string k in new[] { "Bg", "BgRaised", "BgInput", "Line", "Fg", "FgMuted", "Accent", "AccentDim", "Warn", "Danger" })
            {
                Assert.True(MglPalette.Light.ContainsKey(k) && MglPalette.Dark.ContainsKey(k), "хуучин түлхүүр алга: " + k);
            }
        }
    }
}
