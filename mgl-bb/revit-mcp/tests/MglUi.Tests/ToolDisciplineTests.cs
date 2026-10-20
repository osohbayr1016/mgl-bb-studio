using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.Ui.Core;

namespace RevitMcpAddin.Ui.Tests
{
    /// <summary>Салбараар хэрэгсэл ялгах (2026-10-13): ERP-ийн баг → салбар, нуух төлөвлөгөө, давхцал, кэш.</summary>
    public static class ToolDisciplineTests
    {
        private static IReadOnlyList<RibbonPanelPlan> Full() { return RibbonPlan.For(ToolBuild.Net8Plus); }
        private static ToolMeta T(string name) { return ToolCatalogData.Find(name); }

        private static readonly string[] RebarTools =
        {
            "MglRebarEndSymbol", "MglRebarSectionAnnotation", "MglRebarRefresh",
            "MglRebarShowEdges", "MglRebarShowPick", "MglRebarLengthDim",
        };

        [Test]
        public static void Team_codes_map_to_disciplines()
        {
            Assert.Eq(ToolDiscipline.Architecture, ToolDisciplines.FromTeamCode("BA"));
            Assert.Eq(ToolDiscipline.Architecture, ToolDisciplines.FromTeamCode("ez"));
            Assert.Eq(ToolDiscipline.Structure, ToolDisciplines.FromTeamCode(" BB "));
            Assert.Eq(ToolDiscipline.Interior, ToolDisciplines.FromTeamCode("IZ"));
            foreach (string mep in new[] { "HAS", "TSBU", "TSAH", "HD", "AU" })
                Assert.Eq(ToolDiscipline.Mep, ToolDisciplines.FromTeamCode(mep), mep);
            Assert.Eq(ToolDiscipline.None, ToolDisciplines.FromTeamCode("MGMT"));
            Assert.Eq(ToolDiscipline.None, ToolDisciplines.FromTeamCode(null));
            Assert.Eq(ToolDiscipline.Architecture | ToolDiscipline.Interior,
                ToolDisciplines.FromTeamCodes(new[] { "IZ", "BA", "MGMT" }));
        }

        [Test]
        public static void Unknown_team_or_empty_manual_shows_everything()
        {
            Assert.Eq(ToolDiscipline.All, ToolDisciplines.Resolve(RibbonFilterMode.Auto, ToolDiscipline.None, ToolDiscipline.None));
            Assert.Eq(ToolDiscipline.All, ToolDisciplines.Resolve(RibbonFilterMode.Manual, ToolDiscipline.None, ToolDiscipline.Structure));
            Assert.Eq(ToolDiscipline.All, ToolDisciplines.Resolve(RibbonFilterMode.All, ToolDiscipline.Structure, ToolDiscipline.Structure));
            Assert.Eq(ToolDiscipline.Structure, ToolDisciplines.Resolve(RibbonFilterMode.Auto, ToolDiscipline.Architecture, ToolDiscipline.Structure));
            Assert.Eq(ToolDiscipline.Architecture, ToolDisciplines.Resolve(RibbonFilterMode.Manual, ToolDiscipline.Architecture, ToolDiscipline.Structure));
        }

        [Test]
        public static void Rebar_and_rebar_schedules_are_structure_only()
        {
            foreach (string n in RebarTools.Concat(new[] { "MglScheduleClone", "MglScheduleSync" }))
                Assert.Eq(ToolDiscipline.Structure, T(n).Disciplines, n);
        }

        [Test]
        public static void Wall_elevations_shared_by_architecture_and_interior()
        {
            ToolMeta w = T("MglWallElevations");
            Assert.True(ToolDisciplines.IsVisible(w, ToolDiscipline.Architecture));
            Assert.True(ToolDisciplines.IsVisible(w, ToolDiscipline.Interior));
            Assert.False(ToolDisciplines.IsVisible(w, ToolDiscipline.Structure));
            Assert.False(ToolDisciplines.IsVisible(w, ToolDiscipline.Mep));
        }

        [Test]
        public static void Only_eleven_tools_are_discipline_specific()
        {
            // Бүтээцийн 8 + «Ханын дэлгээс» + Архитектурын «Давхрын план», «Олон өрөөний план».
            Assert.Eq(11, ToolCatalogData.All.Count(t => !ToolDisciplines.IsAll(t.Disciplines)));
            // Нийтлэг хэрэгсэл бүх салбарт харагдана.
            foreach (ToolMeta t in ToolCatalogData.All.Where(x => ToolDisciplines.IsAll(x.Disciplines)))
                foreach (ToolDiscipline d in ToolDisciplines.Each)
                    Assert.True(ToolDisciplines.IsVisible(t, d), t.Name + " " + d);
        }

        [Test]
        public static void Architect_sees_architecture_panel_only_among_discipline_panels()
        {
            RibbonVisibilityPlan p = ToolDisciplines.Plan(Full(), ToolDiscipline.Architecture);
            Assert.SeqEq(new[] { ToolPanelId.Interior, ToolPanelId.Structure }, p.HiddenPanels.OrderBy(x => x));
            Assert.True(p.HiddenTools.Contains("MglScheduleClone"));
            Assert.True(p.HiddenTools.Contains("MglRebarEndSymbol"));
            Assert.False(p.HiddenTools.Contains("MglWallElevations"), "Архитектур самбарт харагдана");
        }

        [Test]
        public static void Structure_engineer_hides_architecture_and_interior_panels()
        {
            RibbonVisibilityPlan p = ToolDisciplines.Plan(Full(), ToolDiscipline.Structure);
            Assert.SeqEq(new[] { "MglFloorPlate", "MglRoomPlan", "MglWallElevations" }, p.HiddenTools.OrderBy(x => x, StringComparer.Ordinal));
            Assert.SeqEq(new[] { ToolPanelId.Architecture, ToolPanelId.Interior }, p.HiddenPanels.OrderBy(x => x));
        }

        [Test]
        public static void Mep_engineer_sees_common_panels_only()
        {
            RibbonVisibilityPlan p = ToolDisciplines.Plan(Full(), ToolDiscipline.Mep);
            Assert.Eq(11, p.HiddenTools.Count);
            Assert.SeqEq(new[] { ToolPanelId.Architecture, ToolPanelId.Interior, ToolPanelId.Structure }, p.HiddenPanels.OrderBy(x => x));
        }

        [Test]
        public static void Common_panels_are_never_hidden()
        {
            foreach (ToolDiscipline d in ToolDisciplines.Each)
            {
                RibbonVisibilityPlan p = ToolDisciplines.Plan(Full(), d);
                foreach (RibbonPanelPlan panel in Full().Where(x => x.Discipline == ToolDiscipline.None))
                    Assert.False(p.HiddenPanels.Contains(panel.Id), d + " " + panel.Title);
            }
        }

        [Test]
        public static void All_hides_nothing()
        {
            RibbonVisibilityPlan p = ToolDisciplines.Plan(Full(), ToolDiscipline.All);
            Assert.Eq(0, p.HiddenTools.Count + p.HiddenPanels.Count);
        }

        [Test]
        public static void Two_disciplines_union()
        {
            RibbonVisibilityPlan p = ToolDisciplines.Plan(Full(), ToolDiscipline.Interior | ToolDiscipline.Structure);
            // Зөвхөн Архитектурын хоёр хэрэгсэл («Ханын дэлгээс» Интерьерт ч бий тул харагдана).
            Assert.SeqEq(new[] { "MglFloorPlate", "MglRoomPlan" }, p.HiddenTools.OrderBy(x => x, StringComparer.Ordinal));
            Assert.SeqEq(new[] { ToolPanelId.Architecture }, p.HiddenPanels);
        }

        [Test]
        public static void Describe_and_keys_round_trip()
        {
            Assert.Eq("Бүх салбар", ToolDisciplines.Describe(ToolDiscipline.All));
            Assert.Eq("БА, Интерьер", ToolDisciplines.Describe(ToolDiscipline.Interior | ToolDiscipline.Architecture));
            ToolDiscipline set = ToolDiscipline.Structure | ToolDiscipline.Mep;
            Assert.Eq(set, ToolDisciplines.FromKeys(ToolDisciplines.ToKeys(set)));
            Assert.Eq(ToolDiscipline.Structure, ToolDisciplines.FromKeys(new[] { "STRUCTURE", "bogus", null }));
            Assert.Eq(RibbonFilterMode.Manual, ToolDisciplines.ParseMode("manual"));
            Assert.Eq(RibbonFilterMode.Auto, ToolDisciplines.ParseMode("garbage"));
        }

        [Test]
        public static void Ribbon_prefs_survive_json_and_are_sanitized()
        {
            var prefs = new UiPrefs();
            prefs.Ribbon.Mode = "manual";
            prefs.Ribbon.Manual = new[] { "interior", "nope" };
            prefs.Ribbon.ErpTeams = new[] { "bb", "BB", " ba ", "", "THIS-CODE-IS-WAY-TOO-LONG" };
            UiPrefs back = UiPrefsJson.Parse(UiPrefsJson.Serialize(prefs));
            Assert.Eq(RibbonFilterMode.Manual, back.Ribbon.FilterMode);
            Assert.Eq(ToolDiscipline.Interior, back.Ribbon.ManualSet);
            Assert.SeqEq(new[] { "BB", "BA" }, back.Ribbon.ErpTeams);
            Assert.Eq(ToolDiscipline.Interior, back.Ribbon.Active);

            UiPrefs old = UiPrefsJson.Parse("{\"schema_version\":1,\"flags\":{}}");
            Assert.NotNull(old.Ribbon, "хуучин файлд ribbon хэсэг байхгүй");
            Assert.Eq(ToolDiscipline.All, old.Ribbon.Active);
            Assert.Eq(ToolDiscipline.All, UiPrefsJson.Parse("{\"ribbon\":null}").Ribbon.Active);
        }
    }
}
