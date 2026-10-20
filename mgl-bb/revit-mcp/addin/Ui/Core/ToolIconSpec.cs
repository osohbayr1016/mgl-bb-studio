using System;
using System.Collections.Generic;

namespace RevitMcpAddin.Ui.Core
{
    /// <summary>Нэг дүрсний ТАЙЛБАР: Segoe Fluent/MDL2 глифийн код цэгүүд (эрэмбээр) + өнгө.  Зурах нь `GlyphIcons`.</summary>
    public sealed class ToolIconSpec
    {
        public string Key { get; private set; }
        public int[] CodePoints { get; private set; }
        public string Hex { get; private set; }

        public ToolIconSpec(string key, string hex, params int[] codePoints)
        {
            Key = key; Hex = hex; CodePoints = codePoints;
        }
    }

    /// <summary>
    /// БҮХ хэрэгслийн дүрсний нэг хүснэгт (өмнө нь App.cs / RfRibbon.cs / SmartRibbon.cs-д гурван хуулбар).
    ///
    /// ⚠️ ГЛИФ СОНГОЛТ: одоо байсан код цэгүүдийг (2026-08-24…10-01-д Segoe Fluent Icons дээр НҮДЭЭР шалгасан)
    /// ХӨНДӨӨГҮЙ.  Энэ Mac дээр Segoe фонт байхгүй тул шинэ глифийг ХАРАХ боломжгүй — Windows дээр
    /// 16/32 DIP, Light/Dark хоёуланд нь нүдээр шалгах ёстой (docs/MGL_UI_UX_REDESIGN.md §11).
    ///
    /// Өөрчлөлт (бүгд «андуурагддаг хос»-ыг ялгах):
    ///  • «Файл гаргах» (хавтас) — өмнө нь «Upload» сум (E898) байв, ERP руу илгээхтэй төстэй; одоо ХАВТАС.
    ///  • «ERP-д илгээх» — үүл (E753) → Send (E724) → Upload (E898).
    ///  • «Family сан» — «Зураг холбох»-той ИЖИЛ өнгө (#1F9AA8) байсан → өөр өнгө.
    ///  • «Түүвэр шинэчлэх» — «Хуудас үүсгэх»-тэй ИЖИЛ өнгө (#7C6BC4) байсан → өөр өнгө.
    ///  • Өнгө бүр ДАВХАРДАХГҮЙ (тест барина).
    /// </summary>
    public static class ToolIcons
    {
        private static readonly ToolIconSpec[] Specs =
        {
            new ToolIconSpec("work",            "#3FB984", 0xE823, 0xE121),
            new ToolIconSpec("assistant",       "#D4A853", 0xE99A, 0xE90A),
            new ToolIconSpec("link",            "#1F9AA8", 0xE71B),
            new ToolIconSpec("catalog",         "#6B7A90", 0xE721, 0xE71E),                 // хайлт (Find / Zoom)
            new ToolIconSpec("quantity",        "#4A7FA5", 0xE8EF, 0xE9F9, 0xE80A),
            new ToolIconSpec("pdf",             "#B87333", 0xEA90, 0xE8A5, 0xE749),
            new ToolIconSpec("table",           "#2E9E6B", 0xE80A, 0xEA98, 0xE8A5),
            new ToolIconSpec("erp-send",        "#2B7CD3", 0xE753, 0xE724, 0xE898),         // үүл → ERP/сайт
            new ToolIconSpec("sheets",          "#7C6BC4", 0xE7C4, 0xE8A5, 0xE7C3),
            new ToolIconSpec("sheet-numerator", "#8BAE3E", 0xE8CB, 0xE8FD),
            new ToolIconSpec("copy-to",         "#C75B7A", 0xE8C8, 0xE16F),
            new ToolIconSpec("clone-drawings",  "#E0833A", 0xE8B9, 0xF5ED, 0xE8C8),
            new ToolIconSpec("auto-annotate",   "#3B8FD9", 0xEB3C, 0xED5E),
            new ToolIconSpec("room-plan",      "#268F93", 0xE80F, 0xE8A5),               // apartment / floor plan
            new ToolIconSpec("floor-plate",    "#3D7FA8", 0xE8A9, 0xE80F),               // ViewAll + Home — давхрыг айлуудад хуваах
            new ToolIconSpec("wall-elevation",  "#5E8C61", 0xE80F, 0xE8A1),                 // Home (өрөө) → харагдац — «өрөөний хана»
            new ToolIconSpec("datum-crop",      "#2F8FB5", 0xE7A8),                         // Crop — «тэнхлэг, түвшин crop-оос»
            new ToolIconSpec("family",          "#B26BC9", 0xE896, 0xE8B7, 0xE7C3),
            new ToolIconSpec("smart-count",     "#D49A2A", 0xE9D9, 0xE8EF),
            new ToolIconSpec("clash",           "#D9534F", 0xE7BA, 0xE783),
            new ToolIconSpec("impact",          "#8E6FD8", 0xE81C, 0xE9F5),
            new ToolIconSpec("prechange",       "#3FA7C2", 0xE7B3, 0xE9F5),                  // харах (RedEye) — «өөрчлөхөөс ӨМНӨ харах»
            new ToolIconSpec("publish",         "#1F9A7A", 0xE838, 0xE8B7),                 // ХАВТАС (E898 Upload-ыг орхив)
            new ToolIconSpec("rebar-end",       "#C0504D", 0xE7C8, 0xE81D, 0xE7C1),
            new ToolIconSpec("rebar-section",   "#D08A2E", 0xE8EC, 0xED5E),
            new ToolIconSpec("rebar-refresh",   "#4F9D69", 0xE72C, 0xE895),
            new ToolIconSpec("rebar-show",      "#A5673F", 0xE8A9, 0xE7B3),                 // ViewAll — «захын, голын арматур» (нэг товч)
            new ToolIconSpec("rebar-pick",      "#6C8EBF", 0xE73A, 0xE7C9),                 // CheckboxComposite — ширхэг сонгох
            new ToolIconSpec("rebar-length",    "#9C6ADE", 0xED5E, 0xE7C9),                 // Ruler — «арматурын урт хэмжих»
            new ToolIconSpec("schedule-clone",  "#5B7DB1", 0xE16F, 0xE8C8),
            new ToolIconSpec("schedule-sync",   "#4DA6A0", 0xE8AB, 0xE895),
            new ToolIconSpec("account",         "#C9A227", 0xE72E, 0xE77B),
            new ToolIconSpec("settings",        "#8B94A0", 0xE713, 0xE9F5),
            new ToolIconSpec("feedback",        "#C2410C", 0xED15, 0xE8BD, 0xE90A),         // FeedbackApp → Message → Comment
        };

        public static IReadOnlyList<ToolIconSpec> All { get { return Specs; } }

        public static ToolIconSpec Find(string key)
        {
            if (string.IsNullOrEmpty(key)) return null;
            foreach (ToolIconSpec s in Specs)
                if (string.Equals(s.Key, key, StringComparison.Ordinal)) return s;
            return null;
        }
    }
}
