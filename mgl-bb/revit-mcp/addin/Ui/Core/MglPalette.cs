using System;
using System.Collections.Generic;
using System.Globalization;

namespace RevitMcpAddin.Ui.Core
{
    // ══════════════════════════════════════════════════════════════════════════
    //  MGL UI — ДУНДЫН ӨНГӨНИЙ ТОКЕН (Revit/WPF-гүй ЦЭВЭР логик).
    //
    //  Яагаад ЭНД: өнгө нь `tests/MglUi.Tests`-д ТЕСТЛЭГДДЭГ — «контраст ≥ 4.5:1»
    //  гэдгийг бичиж орхихгүй, МАТЕМАТИКААР шалгана.  WPF дахь токен толь
    //  (`Ui/MglTheme.cs`) энэ хүснэгтээс шууд баригддаг тул хоёр хуулбар байхгүй.
    //
    //  ⚠️ Токены НЭРС нь одоо байгаа самбаруудын түлхүүртэй ТОВЧ ИЖИЛ (Bg, BgRaised,
    //  BgInput, Line, Fg, FgMuted, Accent, AccentDim, Warn, Danger) — тэр нь
    //  AssistantPane/WorkPane/IntelligencePanel-ийг `StaticResource` → `DynamicResource`
    //  болгож, өөрийн хуулбарыг устгахад л шилжих боломж олгодог.
    //
    //  ⚠️ `Line` нь ЗӨВХӨН зааглах шугам (хэрэглэгчийн санал болгосон #CBD5E1 /
    //  #4B5563 нь суурь дээр 1.4–2.0:1 — гоёл).  Оролт, товч зэрэг УДИРДЛАГЫН
    //  хүрээ `LineStrong` (≥ 3:1) байна — `MglUi.Tests` барина.
    // ══════════════════════════════════════════════════════════════════════════

    public enum MglThemeMode
    {
        Light = 0,
        Dark = 1,
        /// <summary>Windows-ийн өндөр контраст — ЭНЭ нь бусад бүхнээс ЧУХАЛ; өнгийг системээс авна.</summary>
        HighContrast = 2,
    }

    public static class MglThemeResolver
    {
        /// <summary>
        /// Өндөр контраст &gt; Revit-ийн сэдэв &gt; цайвар.
        /// <paramref name="revitTheme"/>: "Dark" / "Light" (том жижиг үсэг үл ялгана) эсвэл мэдэгдэхгүй бол null.
        /// </summary>
        public static MglThemeMode Resolve(bool highContrast, string revitTheme)
        {
            if (highContrast) return MglThemeMode.HighContrast;
            if (string.Equals(revitTheme, "Dark", StringComparison.OrdinalIgnoreCase)) return MglThemeMode.Dark;
            return MglThemeMode.Light;
        }
    }

    /// <summary>Өнгөний токен: нэр → "#RRGGBB".  Өндөр контрастад хүснэгт ОГТ хэрэглэгдэхгүй (система).</summary>
    public static class MglPalette
    {
        /// <summary>Бүх токены нэр (хоёр сэдэвд ижил олонлог — тест барина).</summary>
        public static readonly string[] Keys =
        {
            "Bg", "BgRaised", "BgInput",
            "Fg", "FgMuted", "FgDisabled",
            "Line", "LineStrong",
            "Accent", "AccentFg", "AccentSoft", "AccentDim",
            "Hover", "Pressed", "Selected", "HoverFg", "PressedFg", "SelectedFg",
            "Ok", "OkBg", "Warn", "WarnBg", "Danger", "DangerBg", "Info", "InfoBg",
        };

        private static readonly Dictionary<string, string> LightMap = new Dictionary<string, string>
        {
            { "Bg", "#F8FAFC" },        // үндсэн гадаргуу
            { "BgRaised", "#FFFFFF" },  // өргөгдсөн (карт)
            { "BgInput", "#FFFFFF" },   // оролт
            { "Fg", "#0F172A" },        // үндсэн текст
            { "FgMuted", "#475569" },   // хоёрдогч текст
            { "FgDisabled", "#94A3B8" },// идэвхгүй (контрастын шаардлагаас чөлөөтэй, гэхдээ харагдана)
            { "Line", "#CBD5E1" },      // зааглах шугам (гоёл)
            { "LineStrong", "#64748B" },// удирдлагын хүрээ (≥ 3:1)
            { "Accent", "#0F766E" },    // MGL teal
            { "AccentFg", "#FFFFFF" },  // accent товчны текст
            { "AccentSoft", "#E3F3F0" },// accent-ийн цайвар дэвсгэр
            { "AccentDim", "#E3F3F0" }, // = AccentSoft (хуучин самбарын түлхүүр)
            { "Hover", "#EEF2F6" },
            { "Pressed", "#E2E8F0" },
            { "Selected", "#D8EEEA" },
            // Hover/Pressed/Selected дээрх текст — өндөр контрастад (Highlight/HighlightText) ЭСРЭГ болдог тул тусдаа токен.
            { "HoverFg", "#0F172A" }, { "PressedFg", "#0F172A" }, { "SelectedFg", "#0F172A" },
            { "Ok", "#166534" },   { "OkBg", "#DCFCE7" },
            { "Warn", "#92400E" }, { "WarnBg", "#FEF3C7" },
            { "Danger", "#B91C1C" },{ "DangerBg", "#FEE2E2" },
            { "Info", "#1D4ED8" }, { "InfoBg", "#DBEAFE" },
        };

        private static readonly Dictionary<string, string> DarkMap = new Dictionary<string, string>
        {
            { "Bg", "#20252B" },
            { "BgRaised", "#2A3038" },
            { "BgInput", "#2A3038" },
            { "Fg", "#F1F5F9" },
            { "FgMuted", "#B6C0CC" },
            { "FgDisabled", "#6B7683" },
            { "Line", "#4B5563" },
            { "LineStrong", "#8B96A5" },
            { "Accent", "#5EEAD4" },
            { "AccentFg", "#0B1F1C" },
            { "AccentSoft", "#17403A" },
            { "AccentDim", "#17403A" },
            { "Hover", "#343C46" },
            { "Pressed", "#3E4752" },
            { "Selected", "#1F4A44" },
            { "HoverFg", "#F1F5F9" }, { "PressedFg", "#F1F5F9" }, { "SelectedFg", "#F1F5F9" },
            { "Ok", "#4ADE80" },   { "OkBg", "#16301F" },
            { "Warn", "#FBBF24" }, { "WarnBg", "#3A2F12" },
            { "Danger", "#FCA5A5" },{ "DangerBg", "#431B1B" },
            { "Info", "#93C5FD" }, { "InfoBg", "#1C2D4D" },
        };

        public static IReadOnlyDictionary<string, string> Light { get { return LightMap; } }
        public static IReadOnlyDictionary<string, string> Dark { get { return DarkMap; } }

        /// <summary>Токены хүснэгт.  HighContrast → null (WPF давхарга системийн өнгийг ашиглана).</summary>
        public static IReadOnlyDictionary<string, string> For(MglThemeMode mode)
        {
            switch (mode)
            {
                case MglThemeMode.Dark: return DarkMap;
                case MglThemeMode.Light: return LightMap;
                default: return null;
            }
        }
    }

    /// <summary>WCAG 2.x харьцангуй гэрэлтэлт / контраст (хоёр өнгөний хоорондох хамгийн бага 1:1, дээд 21:1).</summary>
    public static class MglContrast
    {
        public static double Ratio(string hexA, string hexB)
        {
            double la = Luminance(hexA);
            double lb = Luminance(hexB);
            double hi = Math.Max(la, lb);
            double lo = Math.Min(la, lb);
            return (hi + 0.05) / (lo + 0.05);
        }

        public static double Luminance(string hex)
        {
            int r, g, b;
            if (!TryParseHex(hex, out r, out g, out b))
                throw new ArgumentException("Өнгө '#RRGGBB' хэлбэртэй байх ёстой: " + hex, "hex");
            return 0.2126 * Channel(r) + 0.7152 * Channel(g) + 0.0722 * Channel(b);
        }

        public static bool TryParseHex(string hex, out int r, out int g, out int b)
        {
            r = g = b = 0;
            if (string.IsNullOrEmpty(hex) || hex.Length != 7 || hex[0] != '#') return false;
            return int.TryParse(hex.Substring(1, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out r)
                && int.TryParse(hex.Substring(3, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out g)
                && int.TryParse(hex.Substring(5, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out b);
        }

        private static double Channel(int v8)
        {
            double c = v8 / 255.0;
            return c <= 0.03928 ? c / 12.92 : Math.Pow((c + 0.055) / 1.055, 2.4);
        }
    }
}
