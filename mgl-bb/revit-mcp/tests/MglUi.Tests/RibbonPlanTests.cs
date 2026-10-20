using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.Ui.Core;

namespace RevitMcpAddin.Ui.Tests
{
    /// <summary>Ribbon-ы бүтэц: build бүрд зөв — хоосон самбар, нэг товчтой stack, давхардал байхгүй.</summary>
    public static class RibbonPlanTests
    {
        private static IReadOnlyList<RibbonPanelPlan> Full() { return RibbonPlan.For(ToolBuild.Net8Plus); }
        private static IReadOnlyList<RibbonPanelPlan> R24() { return RibbonPlan.For(ToolBuild.All); }
        private static IEnumerable<ToolMeta> Placed(IReadOnlyList<RibbonPanelPlan> p)
        {
            return p.SelectMany(x => x.Slots).SelectMany(s => s.Tools);
        }
        private static RibbonPanelPlan Panel(IReadOnlyList<RibbonPanelPlan> p, ToolPanelId id) { return p.FirstOrDefault(x => x.Id == id); }
        private static string[] Names(RibbonSlot s) { return s.Tools.Select(t => t.Name).ToArray(); }

        [Test]
        public static void Full_build_panels_work_then_disciplines_then_common()
        {
            // 2026-10-13: салбарын самбарууд Ажил-ын ДАРАА; «Инженерийн шугам» хэрэгсэлгүй тул үүсэхгүй;
            // «Арматур»/«Түүвэр» самбар байхгүй (арматур, арматурын түүвэр → «Бүтээц», «Элемент тоолох» → «Шалгалт»).
            Assert.SeqEq(
                new[] { "Ажил", "Архитектур", "Интерьер", "Бүтээц", "Зураг", "Шалгалт", "Экспорт", "Сан ба тохиргоо" },
                Full().Select(p => p.Title));
        }

        [Test]
        public static void Every_tool_is_placed_once_per_discipline_it_belongs_to()
        {
            List<ToolMeta> placed = Placed(Full()).ToList();
            Assert.Eq(34, placed.Count);                                    // 33 хэрэгсэл + «Ханын дэлгээс»-ийн Интерьер товч
            Assert.Eq(33, placed.Select(t => t.Name).Distinct().Count());
            foreach (ToolMeta t in ToolCatalogData.All)
                Assert.Eq(RibbonPlan.PanelsOf(t).Count, placed.Count(x => x.Name == t.Name), t.Name);
        }

        [Test]
        public static void Large_buttons_and_one_pulldown()
        {
            var slots = Full().SelectMany(p => p.Slots).ToList();
            Assert.Eq(20, slots.Count(s => s.Kind == RibbonSlotKind.Large));      // 17 + «Ханын дэлгээс» Интерьер самбарт + «Давхрын план», «Олон өрөөний план»
            Assert.Eq(1, slots.Count(s => s.Kind == RibbonSlotKind.Pulldown));
            Assert.Eq(4, slots.Count(s => s.Kind == RibbonSlotKind.Stack));
        }

        [Test]
        public static void Discipline_panels_hold_only_discipline_tools_and_common_panels_only_common()
        {
            foreach (RibbonPanelPlan p in Full())
                foreach (ToolMeta t in p.Slots.SelectMany(s => s.Tools))
                {
                    if (p.Discipline == ToolDiscipline.None) Assert.True(RibbonPlan.IsCommon(t), p.Title + ": " + t.Name);
                    else Assert.True((t.Disciplines & p.Discipline) != 0 && !RibbonPlan.IsCommon(t), p.Title + ": " + t.Name);
                }
        }

        [Test]
        public static void Structure_panel_holds_rebar_then_rebar_schedules()
        {
            RibbonPanelPlan s = Panel(Full(), ToolPanelId.Structure);
            Assert.Eq(ToolDiscipline.Structure, s.Discipline);
            Assert.SeqEq(
                new[] { "MglRebarEndSymbol", "MglRebarSectionAnnotation", "MglRebarRefresh", "MglRebarShowEdges", "MglRebarShowPick", "MglRebarLengthDim", "MglScheduleClone", "MglScheduleSync" },
                s.Slots.SelectMany(x => x.Tools).Select(t => t.Name));
        }

        [Test]
        public static void Wall_elevation_gets_one_button_per_discipline_with_distinct_names()
        {
            ToolMeta w = ToolCatalogData.Find("MglWallElevations");
            Assert.True(w.VariesByDiscipline);
            Assert.SeqEq(new[] { "MglWallElevations" }, Names(Panel(Full(), ToolPanelId.Architecture).Slots[0]));
            Assert.SeqEq(new[] { "MglWallElevations" }, Names(Panel(Full(), ToolPanelId.Interior).Slots[0]));
            Assert.Eq("MglWallElevations", RibbonPlan.ButtonName(w, ToolDiscipline.Architecture));   // QAT-ын тогтвортой нэр
            Assert.Eq("MglWallElevations_interior", RibbonPlan.ButtonName(w, ToolDiscipline.Interior));
            Assert.Eq("MglSheetNumerator", RibbonPlan.ButtonName(ToolCatalogData.Find("MglSheetNumerator"), ToolDiscipline.None));
            Assert.Eq("MglRebarEndSymbol", RibbonPlan.ButtonName(ToolCatalogData.Find("MglRebarEndSymbol"), ToolDiscipline.Structure));
            Assert.Eq("Архитектур / Интерьер", RibbonPlan.WhereTitles(w));
        }

        [Test]
        public static void Button_names_are_unique_across_the_tab()
        {
            foreach (IReadOnlyList<RibbonPanelPlan> plan in new[] { Full(), R24() })
            {
                var names = plan.SelectMany(p => p.Slots.SelectMany(s => s.Tools).Select(t => RibbonPlan.ButtonName(t, p.Discipline))).ToList();
                Assert.Eq(names.Count, names.Distinct().Count());
            }
        }

        [Test]
        public static void Work_panel_layout()
        {
            RibbonPanelPlan w = Panel(Full(), ToolPanelId.Work);
            Assert.SeqEq(new[] { "MglWorkPane" }, Names(w.Slots[0]));
            Assert.SeqEq(new[] { "MglAssistantPane" }, Names(w.Slots[1]));
            Assert.Eq(RibbonSlotKind.Stack, w.Slots[2].Kind);
            Assert.SeqEq(new[] { "MglToolCatalog", "MglRevitBinding" }, Names(w.Slots[2]));
        }

        [Test]
        public static void Drawing_and_library_stacks_hold_the_secondary_commands()
        {
            RibbonPanelPlan d = Panel(Full(), ToolPanelId.Drawing);
            Assert.SeqEq(new[] { "MglSheetNumerator" }, Names(d.Slots[0]));
            Assert.SeqEq(new[] { "MglCloneDrawings" }, Names(d.Slots[1]));
            Assert.SeqEq(new[] { "MglAutoAnnotate" }, Names(d.Slots[2]));
            Assert.SeqEq(new[] { "MglCopyToOther", "MglBatchSheets", "MglDatumCrop" }.OrderBy(x => x), Names(d.Slots[3]).OrderBy(x => x));
            Assert.Eq(4, d.Slots.Count);   // «Ханын дэлгээс» → Архитектур / Интерьер самбар
            RibbonPanelPlan l = Panel(Full(), ToolPanelId.Library);
            Assert.SeqEq(new[] { "MglFamilyHub" }, Names(l.Slots[0]));
            Assert.SeqEq(new[] { "MglLicense", "MglQtoSettings", "MglFeedback" }, Names(l.Slots[1]));
        }

        [Test]
        public static void Erp_send_is_an_explicit_pulldown_with_the_three_erp_commands()
        {
            RibbonPanelPlan e = Panel(Full(), ToolPanelId.Export);
            RibbonSlot pd = e.Slots.Single(s => s.Kind == RibbonSlotKind.Pulldown);
            Assert.Eq(ToolPulldowns.ErpSendName, pd.PulldownName);
            Assert.SeqEq(new[] { "MglQtoExport", "MglPdfExport", "MglScheduleExport" }, Names(pd));
            // Folder export нь pulldown-д БИШ — ERP-ийн сонголттой андуурагдахгүй.
            Assert.False(Names(pd).Contains("MglSmartPublish"));
            Assert.True(pd.PulldownLabel.Contains("ERP"));
        }

        [Test]
        public static void R24_has_no_empty_panel_and_no_excluded_tools()
        {
            IReadOnlyList<RibbonPanelPlan> p = R24();
            Assert.SeqEq(new[] { "Ажил", "Архитектур", "Интерьер", "Бүтээц", "Зураг", "Экспорт", "Сан ба тохиргоо" }, p.Select(x => x.Title));
            foreach (RibbonPanelPlan panel in p) Assert.True(panel.Slots.Count > 0, panel.Title + " хоосон");
            var excluded = new[] { "MglWorkPane", "MglFamilyHub", "MglSmartCount", "MglSmartClash", "MglSmartImpact", "MglSmartPreChange", "MglSmartPublish" };
            foreach (ToolMeta t in Placed(p)) Assert.False(excluded.Contains(t.Name), "R24-д байж болохгүй: " + t.Name);
            Assert.Eq(27, Placed(p).Count());    // 26 хэрэгсэл + «Ханын дэлгээс»-ийн Интерьер товч
            Assert.Eq(26, Placed(p).Select(t => t.Name).Distinct().Count());
        }

        [Test]
        public static void R24_keeps_all_17_legacy_tools_that_exist_on_revit_2024()
        {
            var legacyOnR24 = ToolCatalogData.LegacyStableNames
                .Where(n => new[] { "MglWorkPane", "MglFamilyHub", "MglSmartCount", "MglSmartClash", "MglSmartImpact", "MglSmartPreChange", "MglSmartPublish" }.All(x => x != n)).ToList();
            Assert.Eq(17, legacyOnR24.Count);
            var placed = new HashSet<string>(Placed(R24()).Select(t => t.Name));
            foreach (string n in legacyOnR24) Assert.True(placed.Contains(n), "R24-аас алга: " + n);
        }

        [Test]
        public static void R24_work_panel_degrades_cleanly_when_the_work_pane_is_missing()
        {
            RibbonPanelPlan w = Panel(R24(), ToolPanelId.Work);
            Assert.SeqEq(new[] { "MglAssistantPane" }, Names(w.Slots[0]));
            Assert.SeqEq(new[] { "MglToolCatalog", "MglRevitBinding" }, Names(w.Slots[1]));
            RibbonPanelPlan s = Panel(R24(), ToolPanelId.Structure);
            Assert.SeqEq(new[] { "MglScheduleClone", "MglScheduleSync" }, s.Slots.Skip(s.Slots.Count - 2).Select(x => x.Tools[0].Name));
            RibbonPanelPlan e = Panel(R24(), ToolPanelId.Export);
            Assert.Eq(1, e.Slots.Count);
            Assert.Eq(RibbonSlotKind.Pulldown, e.Slots[0].Kind);
        }

        [Test]
        public static void Stacks_always_hold_two_or_three_tools_never_one()
        {
            foreach (IReadOnlyList<RibbonPanelPlan> plan in new[] { Full(), R24() })
                foreach (RibbonSlot s in plan.SelectMany(p => p.Slots))
                {
                    if (s.Kind == RibbonSlotKind.Stack) Assert.True(s.Tools.Count >= 2 && s.Tools.Count <= 3, "stack " + s.Tools.Count);
                    if (s.Kind == RibbonSlotKind.Large) Assert.Eq(1, s.Tools.Count);
                }
        }

        [Test]
        public static void A_lone_stacked_tool_becomes_a_large_button()
        {
            // Зөвхөн нэг жижиг хэрэгсэлтэй самбар: Revit AddStackedItems 2–3 шаарддаг.
            ToolMeta only = ToolCatalogData.Find("MglQtoSettings");
            var plan = RibbonPlan.For(ToolBuild.Net8Plus, new[] { only });
            Assert.Eq(1, plan.Count);
            Assert.Eq(RibbonSlotKind.Large, plan[0].Slots[0].Kind);
        }

        [Test]
        public static void Chunking_never_leaves_a_single_leftover()
        {
            Func<int, List<ToolMeta>> mk = n => ToolCatalogData.All.Take(n).ToList();
            Func<int, int[]> sizes = n => RibbonPlan.Chunk(mk(n)).Select(c => c.Count).ToArray();
            Assert.SeqEq(new[] { 2 }, sizes(2));
            Assert.SeqEq(new[] { 3 }, sizes(3));
            Assert.SeqEq(new[] { 2, 2 }, sizes(4));
            Assert.SeqEq(new[] { 3, 2 }, sizes(5));
            Assert.SeqEq(new[] { 3, 3 }, sizes(6));
            Assert.SeqEq(new[] { 1 }, sizes(1));   // ганц бол дуудагч Large болгоно
        }

        [Test]
        public static void Slots_inside_a_panel_follow_declared_order()
        {
            // Салбарын самбарт эрэмбэ = үйл ажиллагааны бүлэг (арматур → түүвэр), дараа нь Order.
            foreach (RibbonPanelPlan p in Full())
            {
                int[] keys = p.Slots.Select(s => s.Tools.Min(t => Array.IndexOf(RibbonPlan.PanelOrder, t.Panel) * 1000 + t.Order)).ToArray();
                for (int i = 1; i < keys.Length; i++) Assert.True(keys[i] >= keys[i - 1], p.Title + " дараалал");
            }
        }

        [Test]
        public static void Predicted_command_ids_follow_the_documented_revit_scheme()
        {
            Assert.Eq("CustomCtrl_%CustomCtrl_%MGL%Зураг%MglSheetNumerator", RibbonIds.Predict("MGL", "Зураг", null, "MglSheetNumerator"));
            Assert.Eq("CustomCtrl_%CustomCtrl_%CustomCtrl_%MGL%Экспорт%MglErpSendMenu%MglPdfExport",
                RibbonIds.Predict("MGL", "Экспорт", "MglErpSendMenu", "MglPdfExport"));
        }

        [Test]
        public static void Panel_titles_changed_so_the_id_change_is_documented_not_accidental()
        {
            // Хуучин самбарууд («Ажлын явц», «Сайт руу илгээх», «Загвар», «Smart», «Тохиргоо») ОДОО ашиглагдахгүй —
            // самбарын нэр нь Revit команд ID-д ордог тул QAT/гарын товчлуур дахин тохируулах шаардлагатай (docs §5.3).
            var legacy = new[] { "Ажлын явц", "Сайт руу илгээх", "Загвар", "Smart", "Тохиргоо" };
            foreach (string old in legacy)
                Assert.False(Full().Any(p => p.Title == old), old);
        }
    }
}
