using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.Ui.Core
{
    public enum RibbonSlotKind
    {
        /// <summary>Нэг том товч (`AddItem`).</summary>
        Large = 0,
        /// <summary>2–3 жижиг товч (`AddStackedItems`).</summary>
        Stack = 1,
        /// <summary>Нэр бүхий pulldown (`PulldownButtonData`) — ТОДОРХОЙ холбоотой сонголтууд.</summary>
        Pulldown = 2,
    }

    public sealed class RibbonSlot
    {
        public RibbonSlotKind Kind;
        public List<ToolMeta> Tools = new List<ToolMeta>();
        /// <summary>Зөвхөн Pulldown.</summary>
        public string PulldownName;
        public string PulldownLabel;
        public string PulldownToolTip;
        public string PulldownIconKey;
        internal int SortKey;
    }

    public sealed class RibbonPanelPlan
    {
        public ToolPanelId Id;
        public string Title;
        /// <summary>Салбарын самбар бол тэр салбар (ганц туг); нийтлэг самбар бол None.</summary>
        public ToolDiscipline Discipline;
        public List<RibbonSlot> Slots = new List<RibbonSlot>();
    }

    /// <summary>
    /// Ribbon-ы бүтэц — ӨГӨГДӨЛ.  `App`/`RibbonBuilder` үүгээр самбар, товч үүсгэнэ.  Ингэснээр:
    ///  • R24-д байхгүй хэрэгслийн самбар (Шалгалт) ХООСОН гарахгүй;
    ///  • нэг товчтой «stack» үүсэхгүй (Revit `AddStackedItems` 2–3 шаарддаг);
    ///  • «ERP-д илгээх» нь ИЛ pulldown — split button БИШ, тиймээс «өгөгдмөл үйлдэл» чимээгүй
    ///    солигдож өөр хаяг руу өгөгдөл явуулахгүй.
    ///
    /// ⚠️ App.cs-д баримтжсан ДАРААХ САЙЫГ САНА: нэг өргөн самбар Revit-д НЭГ унжих товч болж
    /// хуйлагдсан (journal.0064).  Тиймээс том товчны тоо 23 → 16 болж, жижиг товчийг stack-д
    /// хийв.  Одоогийн бүтэц хуйлагдах эсэх нь Revit дээр ХЭМЖИГДЭЭГҮЙ.
    /// </summary>
    public static class RibbonPlan
    {
        /// <summary>
        /// Самбарын дараалал (2026-10-13): Ажил → САЛБАРЫН самбарууд (ажилтан зөвхөн өөрийнхөө салбарынхыг харна) →
        /// нийтлэг Зураг · Шалгалт · Экспорт · Сан.  Rebar/Schedule нь салбарын самбар доторх БҮЛЭГ л — тэнд нийтлэг
        /// хэрэгсэл байвал (одоо байхгүй) энд байрлана.
        /// </summary>
        public static readonly ToolPanelId[] PanelOrder =
        {
            ToolPanelId.Work,
            ToolPanelId.Architecture, ToolPanelId.Interior, ToolPanelId.Structure, ToolPanelId.Mep,
            ToolPanelId.Drawing, ToolPanelId.Rebar, ToolPanelId.Schedule, ToolPanelId.Check, ToolPanelId.Export, ToolPanelId.Library,
        };

        /// <summary>Салбарын самбар → салбар (бусад → None).</summary>
        public static ToolDiscipline DisciplineOf(ToolPanelId id)
        {
            switch (id)
            {
                case ToolPanelId.Architecture: return ToolDiscipline.Architecture;
                case ToolPanelId.Interior: return ToolDiscipline.Interior;
                case ToolPanelId.Structure: return ToolDiscipline.Structure;
                case ToolPanelId.Mep: return ToolDiscipline.Mep;
                default: return ToolDiscipline.None;
            }
        }

        public static ToolPanelId PanelOf(ToolDiscipline d)
        {
            switch (d)
            {
                case ToolDiscipline.Architecture: return ToolPanelId.Architecture;
                case ToolDiscipline.Interior: return ToolPanelId.Interior;
                case ToolDiscipline.Structure: return ToolPanelId.Structure;
                default: return ToolPanelId.Mep;
            }
        }

        /// <summary>Нийтлэг хэрэгсэл үү (бүх салбарт, үйл ажиллагааны самбарт байрлана).</summary>
        public static bool IsCommon(ToolMeta t)
        {
            ToolDiscipline own = t.Disciplines & ToolDiscipline.All;
            return own == ToolDiscipline.None || own == ToolDiscipline.All;
        }

        /// <summary>Хэрэгсэл ribbon-ы аль самбар(ууд)-д байрлах — салбарын хэрэгсэлд туг бүрийн самбар.</summary>
        public static IReadOnlyList<ToolPanelId> PanelsOf(ToolMeta t)
        {
            if (IsCommon(t)) return new[] { t.Panel };
            return ToolDisciplines.Each.Where(d => (t.Disciplines & d) != 0).Select(PanelOf).ToArray();
        }

        /// <summary>Каталог, хайлтад: «Архитектур / Интерьер» эсвэл «Зураг».</summary>
        public static string WhereTitles(ToolMeta t)
        {
            return string.Join(" / ", PanelsOf(t).Select(PanelTitles.Of));
        }

        /// <summary>
        /// Товчны `PushButtonData.Name`.  Нийтлэг болон ганц салбартай хэрэгсэлд тогтвортой `Name` ХЭВЭЭР.  Олон салбарт
        /// давтагдах хэрэгсэлд ЭХНИЙ салбарынх нь `Name`, бусад нь `Name_салбар` — нэг табд ижил нэртэй хоёр товч
        /// үүсэхгүй, салбар бүрийн команд ID тогтвортой.
        /// </summary>
        public static string ButtonName(ToolMeta t, ToolDiscipline panelDiscipline)
        {
            if (panelDiscipline == ToolDiscipline.None || IsCommon(t)) return t.Name;
            ToolDiscipline first = ToolDisciplines.Each.FirstOrDefault(d => (t.Disciplines & d) != 0);
            return panelDiscipline == first ? t.Name : t.Name + "_" + ToolDisciplines.Key(panelDiscipline);
        }

        public static IReadOnlyList<RibbonPanelPlan> For(ToolBuild running)
        {
            return For(running, ToolCatalogData.All);
        }

        public static IReadOnlyList<RibbonPanelPlan> For(ToolBuild running, IEnumerable<ToolMeta> tools)
        {
            var panels = new List<RibbonPanelPlan>();
            List<ToolMeta> inBuild = tools.Where(t => ToolAvailability.IsInBuild(t, running)).ToList();

            foreach (ToolPanelId id in PanelOrder)
            {
                ToolDiscipline discipline = DisciplineOf(id);
                // Салбарын самбарт эрэмбэ = үйл ажиллагааны бүлэг (арматур → түүвэр), дараа нь Order.
                Func<ToolMeta, int> key = discipline == ToolDiscipline.None
                    ? (Func<ToolMeta, int>)(t => t.Order)
                    : (t => Array.IndexOf(PanelOrder, t.Panel) * 1000 + t.Order);
                List<ToolMeta> members = (discipline == ToolDiscipline.None
                        ? inBuild.Where(t => IsCommon(t) && t.Panel == id)
                        : inBuild.Where(t => !IsCommon(t) && (t.Disciplines & discipline) != 0))
                    .OrderBy(key).ToList();
                if (members.Count == 0) continue;

                var panel = new RibbonPanelPlan { Id = id, Title = PanelTitles.Of(id), Discipline = discipline };
                var slots = new List<RibbonSlot>();

                foreach (ToolMeta t in members.Where(m => m.Presentation == ToolPresentation.Large))
                    slots.Add(new RibbonSlot { Kind = RibbonSlotKind.Large, Tools = { t }, SortKey = key(t) });

                // Stack: 2–3 жижиг; үлдэгдэл нэг бол өмнөх бүлгээс авч 2+2 болгоно, ганц бол Large болгоно.
                List<ToolMeta> stacked = members.Where(m => m.Presentation == ToolPresentation.Stacked).ToList();
                foreach (List<ToolMeta> chunk in Chunk(stacked))
                {
                    if (chunk.Count == 1)
                        slots.Add(new RibbonSlot { Kind = RibbonSlotKind.Large, Tools = { chunk[0] }, SortKey = key(chunk[0]) });
                    else
                        slots.Add(new RibbonSlot { Kind = RibbonSlotKind.Stack, Tools = chunk, SortKey = key(chunk[0]) });
                }

                List<ToolMeta> pulled = members.Where(m => m.Presentation == ToolPresentation.Pulldown).ToList();
                if (pulled.Count > 0)
                {
                    slots.Add(new RibbonSlot
                    {
                        Kind = RibbonSlotKind.Pulldown,
                        Tools = pulled,
                        PulldownName = ToolPulldowns.ErpSendName,
                        PulldownLabel = ToolPulldowns.ErpSendLabel,
                        PulldownToolTip = ToolPulldowns.ErpSendToolTip,
                        PulldownIconKey = ToolPulldowns.ErpSendIconKey,
                        SortKey = key(pulled[0]),
                    });
                }

                panel.Slots = slots.OrderBy(s => s.SortKey).ToList();
                if (panel.Slots.Count > 0) panels.Add(panel);
            }
            return panels;
        }

        internal static IEnumerable<List<ToolMeta>> Chunk(List<ToolMeta> items)
        {
            var result = new List<List<ToolMeta>>();
            int i = 0;
            while (i < items.Count)
            {
                int remaining = items.Count - i;
                int take = remaining <= 3 ? remaining : (remaining == 4 ? 2 : 3);
                result.Add(items.GetRange(i, take));
                i += take;
            }
            return result;
        }
    }

    /// <summary>
    /// Revit-ийн ribbon команд ID-ийн УРЬДЧИЛСАН таамаг.  ⚠️ БАТАЛГААЖААГҮЙ: Revit ID-г
    /// tab/panel/(pulldown)/Name-ээс гаргадаг гэж ойлгосон, амьд Revit-д `LookupCommandId`-аар
    /// шалгах ёстой.  Хэрэглэгч нь каталогийн «Нээх» — таамаг буруу бол `LookupCommandId` null
    /// буцааж, «Нээх» нь ТАЙЛБАРТАЙ татгалзана (хэзээ ч эвдэрсэн товч биш).
    /// </summary>
    public static class RibbonIds
    {
        public static string Predict(string tab, string panelTitle, string pulldownName, string toolName)
        {
            if (string.IsNullOrEmpty(pulldownName))
                return "CustomCtrl_%CustomCtrl_%" + tab + "%" + panelTitle + "%" + toolName;
            return "CustomCtrl_%CustomCtrl_%CustomCtrl_%" + tab + "%" + panelTitle + "%" + pulldownName + "%" + toolName;
        }
    }
}
