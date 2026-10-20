using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.Ui.Core
{
    // ══════════════════════════════════════════════════════════════════════════
    //  САЛБАРААР ХЭРЭГСЭЛ ЯЛГАХ (2026-10-13, эзний шийдвэр).
    //
    //  • Нэг «MGL» таб хэвээр; ажилтан НИЙТЛЭГ самбарууд + ӨӨРИЙН салбарын самбарыг харна, бусад салбарын самбар
    //    нуугдана (үүссэн хэвээр — зөвхөн `Visible = false`; «Хэрэгсэл хайх» каталог бүгдийг харуулсаар).
    //  • Нэг хэрэгсэл ОЛОН салбарт хамаарч болно (flags) — тэгвэл салбар бүрийн самбарт ТУСДАА товч гарна.  «Ханын
    //    дэлгээс»: БА ба Интерьер өөр template, Интерьер render зургийн хэсэгтэй болох тул (`ToolMeta.VariesByDiscipline`)
    //    товч бүр аль салбарынх болохоо мэдэх ёстой.
    //  • Салбар нь ERP-ийн багаас (`/api/auth/me` → `teams`, үндсэн БА нэмэлт хоёулаа), ажилтан Тохиргооноос
    //    өөрчилж болно (гараар сонгох / бүх хэрэгсэл).
    //  • Мэдэгдэхгүй (нэвтрээгүй, баггүй, Менежмент) → БҮХ хэрэгсэл харагдана.  Хэрэгсэл нуух нь хэрэгслийг
    //    ОЛДОХГҮЙ болгохоос дээр биш — эргэлзвэл харуулна.
    //
    //  ⚠️ Revit/WPF-гүй ЦЭВЭР — `tests/MglUi.Tests` шалгана.
    // ══════════════════════════════════════════════════════════════════════════

    /// <summary>Хэрэгслийн салбар (flags).  `All` = нийтлэг хэрэгсэл.</summary>
    [Flags]
    public enum ToolDiscipline
    {
        None = 0,
        /// <summary>Барилга архитектур (БА) — Эскиз (EZ), Гадна тохижилт (GT) орно.</summary>
        Architecture = 1,
        /// <summary>Барилга бүтээц (ББ).</summary>
        Structure = 2,
        /// <summary>Интерьер зураг (IZ).</summary>
        Interior = 4,
        /// <summary>Инженерийн шугам: ХАС, ЦБУ, Цахилгаан, ХД, АУ.</summary>
        Mep = 8,
        All = Architecture | Structure | Interior | Mep,
    }

    /// <summary>Туузан цэсэнд аль хэрэгслийг харуулах горим.</summary>
    public enum RibbonFilterMode
    {
        /// <summary>ERP-ийн багаас автоматаар.</summary>
        Auto = 0,
        /// <summary>Ажилтан өөрөө сонгосон салбарууд.</summary>
        Manual = 1,
        /// <summary>Бүх хэрэгсэл.</summary>
        All = 2,
    }

    /// <summary>
    /// Юуг нуух вэ.  Нуух НЭГЖ нь САМБАР: салбарын хэрэгсэл зөвхөн салбарын самбарт байрладаг (`RibbonPlan`) тул ажилтны
    /// салбарт хамаарахгүй салбарын самбар бүхэлдээ нуугдана; нийтлэг самбар хэзээ ч нуугдахгүй.
    /// </summary>
    public sealed class RibbonVisibilityPlan
    {
        public readonly HashSet<ToolPanelId> HiddenPanels = new HashSet<ToolPanelId>();
        /// <summary>Аль ч харагдах самбарт үлдээгүй хэрэгслүүд (төлөвийн мөр, каталогт).</summary>
        public readonly HashSet<string> HiddenTools = new HashSet<string>(StringComparer.Ordinal);
    }

    public static class ToolDisciplines
    {
        /// <summary>Тохиргооны цонхонд харагдах дараалал.</summary>
        public static readonly ToolDiscipline[] Each =
        {
            ToolDiscipline.Architecture, ToolDiscipline.Structure, ToolDiscipline.Interior, ToolDiscipline.Mep,
        };

        public static string Label(ToolDiscipline d)
        {
            switch (d)
            {
                case ToolDiscipline.Architecture: return "Архитектур (БА)";
                case ToolDiscipline.Structure: return "Бүтээц (ББ)";
                case ToolDiscipline.Interior: return "Интерьер";
                case ToolDiscipline.Mep: return "Инженерийн шугам (ХАС, ЦБУ, Цахилгаан, ХД, АУ)";
                default: return d.ToString();
            }
        }

        /// <summary>Богино нэр — төлөвийн мөр, каталогт.</summary>
        public static string ShortLabel(ToolDiscipline d)
        {
            switch (d)
            {
                case ToolDiscipline.Architecture: return "БА";
                case ToolDiscipline.Structure: return "ББ";
                case ToolDiscipline.Interior: return "Интерьер";
                case ToolDiscipline.Mep: return "Инженерийн шугам";
                default: return d.ToString();
            }
        }

        /// <summary>«БА, Интерьер» / «Бүх салбар».</summary>
        public static string Describe(ToolDiscipline set)
        {
            if (IsAll(set)) return "Бүх салбар";
            List<string> parts = Each.Where(d => (set & d) != 0).Select(ShortLabel).ToList();
            return parts.Count == 0 ? "Бүх салбар" : string.Join(", ", parts);
        }

        public static bool IsAll(ToolDiscipline set)
        {
            return (set & ToolDiscipline.All) == ToolDiscipline.All;
        }

        /// <summary>
        /// ERP-ийн `teams.code` → салбар.  Мэдэгдэхгүй код (MGMT, шинэ баг) → None (бүгдийг харуулах шийдвэрийг
        /// `Resolve` гаргана).  ⚠️ Кодууд нь backend migration-ийн `teams` мөрүүдтэй ИЖИЛ (BA, BB, HAS, TSBU, TSAH,
        /// HD, AU, IZ, EZ, GT, MGMT) — шинэ баг нэмэгдвэл ЭНД нэм.
        /// </summary>
        public static ToolDiscipline FromTeamCode(string code)
        {
            if (string.IsNullOrWhiteSpace(code)) return ToolDiscipline.None;
            switch (code.Trim().ToUpperInvariant())
            {
                case "BA":
                case "EZ":
                case "GT":
                    return ToolDiscipline.Architecture;
                case "BB":
                    return ToolDiscipline.Structure;
                case "IZ":
                    return ToolDiscipline.Interior;
                case "HAS":
                case "TSBU":
                case "TSAH":
                case "HD":
                case "AU":
                    return ToolDiscipline.Mep;
                default:
                    return ToolDiscipline.None;
            }
        }

        /// <summary>Ажилтны бүх баг (үндсэн + нэмэлт) → салбаруудын нэгдэл.</summary>
        public static ToolDiscipline FromTeamCodes(IEnumerable<string> codes)
        {
            ToolDiscipline set = ToolDiscipline.None;
            if (codes == null) return set;
            foreach (string c in codes) set |= FromTeamCode(c);
            return set;
        }

        /// <summary>
        /// Одоо хүчинтэй салбарын олонлог.  Үр дүн ХЭЗЭЭ Ч None биш: мэдэгдэхгүй бол All (бүгдийг харуулна).
        /// </summary>
        public static ToolDiscipline Resolve(RibbonFilterMode mode, ToolDiscipline manual, ToolDiscipline erp)
        {
            ToolDiscipline chosen;
            switch (mode)
            {
                case RibbonFilterMode.All: chosen = ToolDiscipline.All; break;
                case RibbonFilterMode.Manual: chosen = manual; break;
                default: chosen = erp; break;
            }
            chosen &= ToolDiscipline.All;
            return chosen == ToolDiscipline.None ? ToolDiscipline.All : chosen;
        }

        /// <summary>Хэрэгсэл энэ салбарын олонлогт харагдах уу.  Хэрэгслийн `None` = нийтлэг (хамгаалалт).</summary>
        public static bool IsVisible(ToolMeta tool, ToolDiscipline active)
        {
            if (tool == null) return false;
            ToolDiscipline own = tool.Disciplines & ToolDiscipline.All;
            if (own == ToolDiscipline.None || own == ToolDiscipline.All) return true;
            if (IsAll(active)) return true;
            return (own & active) != 0;
        }

        /// <summary>Салбарын самбар энэ салбарын олонлогт харагдах уу (нийтлэг самбар үргэлж харагдана).</summary>
        public static bool IsPanelVisible(RibbonPanelPlan panel, ToolDiscipline active)
        {
            if (panel == null) return false;
            ToolDiscipline d = panel.Discipline & ToolDiscipline.All;
            return d == ToolDiscipline.None || IsAll(active) || (d & active) != 0;
        }

        /// <summary>Ribbon-ы төлөвлөгөөнөөс юуг нуухыг тооцно.</summary>
        public static RibbonVisibilityPlan Plan(IEnumerable<RibbonPanelPlan> panels, ToolDiscipline active)
        {
            var plan = new RibbonVisibilityPlan();
            if (panels == null) return plan;
            var shown = new HashSet<string>(StringComparer.Ordinal);
            var all = new HashSet<string>(StringComparer.Ordinal);
            foreach (RibbonPanelPlan p in panels)
            {
                bool visible = IsPanelVisible(p, active);
                if (!visible) plan.HiddenPanels.Add(p.Id);
                foreach (ToolMeta t in p.Slots.SelectMany(s => s.Tools))
                {
                    all.Add(t.Name);
                    if (visible) shown.Add(t.Name);
                }
            }
            foreach (string n in all)
                if (!shown.Contains(n)) plan.HiddenTools.Add(n);
            return plan;
        }

        // ── ui-prefs.json-д хадгалах түлхүүр (уншигдахуйц) ─────────────

        public static string Key(ToolDiscipline d)
        {
            switch (d)
            {
                case ToolDiscipline.Architecture: return "architecture";
                case ToolDiscipline.Structure: return "structure";
                case ToolDiscipline.Interior: return "interior";
                case ToolDiscipline.Mep: return "mep";
                default: return null;
            }
        }

        public static string[] ToKeys(ToolDiscipline set)
        {
            return Each.Where(d => (set & d) != 0).Select(Key).ToArray();
        }

        public static ToolDiscipline FromKeys(IEnumerable<string> keys)
        {
            ToolDiscipline set = ToolDiscipline.None;
            if (keys == null) return set;
            foreach (string k in keys)
            {
                if (k == null) continue;
                foreach (ToolDiscipline d in Each)
                    if (string.Equals(Key(d), k.Trim(), StringComparison.OrdinalIgnoreCase)) set |= d;
            }
            return set;
        }

        public static string ModeKey(RibbonFilterMode mode)
        {
            return mode == RibbonFilterMode.Manual ? "manual" : mode == RibbonFilterMode.All ? "all" : "auto";
        }

        public static RibbonFilterMode ParseMode(string key)
        {
            string k = (key ?? string.Empty).Trim().ToLowerInvariant();
            return k == "manual" ? RibbonFilterMode.Manual : k == "all" ? RibbonFilterMode.All : RibbonFilterMode.Auto;
        }
    }
}
