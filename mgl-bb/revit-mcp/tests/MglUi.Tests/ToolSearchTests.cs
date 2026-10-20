using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.Ui.Core;

namespace RevitMcpAddin.Ui.Tests
{
    public static class ToolSearchTests
    {
        private static string First(string q)
        {
            IReadOnlyList<ToolMeta> r = ToolSearch.Filter(ToolCatalogData.All, q);
            return r.Count == 0 ? null : r[0].Name;
        }

        [Test]
        public static void English_and_monglish_terms_find_the_right_tool()
        {
            Assert.Eq("MglSmartClash", First("clash"));
            Assert.Eq("MglSmartCount", First("count"));
            Assert.Eq("MglSmartPublish", First("publish"));
            Assert.Eq("MglCloneDrawings", First("clone"));
            Assert.Eq("MglSheetNumerator", First("huudas dugaar"));
            Assert.Eq("MglSheetNumerator", First("numerator"));
            Assert.Eq("MglBatchSheets", First("batch sheets"));
        }

        [Test]
        public static void Old_ribbon_labels_still_resolve_after_the_rename()
        {
            Assert.Eq("MglCopyToOther", First("Хуулж тавих"));
            Assert.Eq("MglCloneDrawings", First("Зураг клонлох"));
            Assert.Eq("MglAutoAnnotate", First("Автомат хэмжээс"));
            Assert.Eq("MglSmartCount", First("Smart Count"));
            Assert.Eq("MglSmartPublish", First("Smart Publish"));
            Assert.Eq("MglFamilyHub", First("Family Hub"));
            Assert.Eq("MglScheduleSync", First("Түүвэр синк хийх"));
            Assert.Eq("MglRevitBinding", First("Зураг холбох"));
            Assert.Eq("MglLicense", First("MGL нэвтрэлт"));
        }

        [Test]
        public static void Cyrillic_case_and_latin_spelling_fold_together()
        {
            Assert.Eq("MglSmartClash", First("ДАВХЦАЛ"));
            Assert.Eq("MglSmartClash", First("davhtsal"));
            Assert.Eq("MglSheetNumerator", First("Хуудас дугаар"));
        }

        [Test]
        public static void Rebar_query_puts_the_three_rebar_tools_on_top()
        {
            IReadOnlyList<ToolMeta> r = ToolSearch.Filter(ToolCatalogData.All, "armat");
            Assert.True(r.Count >= 3);
            Assert.True(r.Take(3).All(t => t.Panel == ToolPanelId.Rebar), string.Join(",", r.Take(4).Select(t => t.Name)));
        }

        [Test]
        public static void Erp_send_query_ranks_the_three_erp_tools_above_folder_export()
        {
            IReadOnlyList<ToolMeta> r = ToolSearch.Filter(ToolCatalogData.All, "ерп илгээх");
            var top = new HashSet<string>(r.Take(3).Select(t => t.Name));
            Assert.True(top.SetEquals(new[] { "MglQtoExport", "MglPdfExport", "MglScheduleExport" }), string.Join(",", r.Take(4).Select(t => t.Name)));
        }

        [Test]
        public static void Empty_query_lists_everything_in_ribbon_order()
        {
            IReadOnlyList<ToolMeta> r = ToolSearch.Filter(ToolCatalogData.All, "  ");
            Assert.Eq(ToolCatalogData.All.Count, r.Count);
            Assert.Eq(ToolPanelId.Work, r[0].Panel);
            for (int i = 1; i < r.Count; i++)
                Assert.True((int)r[i].Panel >= (int)r[i - 1].Panel, "самбарын дараалал " + i);
        }

        [Test]
        public static void Nonsense_query_returns_nothing_and_null_input_is_safe()
        {
            Assert.Eq(0, ToolSearch.Filter(ToolCatalogData.All, "zzzzqqq").Count);
            Assert.Eq(0, ToolSearch.Filter(null, "clash").Count);
        }

        [Test]
        public static void Every_token_must_match_AND_semantics()
        {
            // «clash» БА «excel» хоёулаа таарах хэрэгсэл алга
            Assert.Eq(0, ToolSearch.Filter(ToolCatalogData.All, "clash excel").Count);
            Assert.True(ToolSearch.Filter(ToolCatalogData.All, "clash шалгах").Any(t => t.Name == "MglSmartClash"));
        }

        [Test]
        public static void Every_tool_is_findable_by_its_own_label_and_by_its_stable_name()
        {
            foreach (ToolMeta t in ToolCatalogData.All)
            {
                Assert.True(ToolSearch.Filter(ToolCatalogData.All, t.LabelOneLine).Any(x => x.Name == t.Name), "шошгоор: " + t.Name);
                Assert.Eq(t.Name, First(t.Name), "тогтвортой нэрээр: " + t.Name);
            }
        }
    }
}
