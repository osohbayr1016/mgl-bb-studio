using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.Ui.Core;

namespace RevitMcpAddin.Ui.Tests
{
    /// <summary>Хэрэгслийн метадата: тогтвортой нэр, батлагдсан нэршил, tooltip-ийн хэмжээ ба тууштай байдал.</summary>
    public static class ToolCatalogTests
    {
        // Батлагдсан нэршлийн хүснэгт (docs/MGL_UI_UX_REDESIGN.md §5.2): тогтвортой нэр → (богино шошго, бүтэн нэр)
        private static readonly string[][] Approved =
        {
            new[] { "MglWorkPane", "Миний ажил", "Миний ажил — таск, идэвхтэй цаг, тайлан" },
            new[] { "MglAssistantPane", "AI туслах", "AI туслах — асуух, өөрчлөлт харах, тайлангийн ноорог бэлтгэх" },
            new[] { "MglRevitBinding", "Ажилтай холбох", "Revit-ийн хуудсыг ERP-ийн ажилтай холбох" },
            new[] { "MglQtoExport", "Тоо хэмжээ илгээх", "Загварын тоо хэмжээг ERP-д илгээх" },
            new[] { "MglPdfExport", "PDF илгээх", "Идэвхтэй харагдацын PDF-ийг ERP-д илгээх" },
            new[] { "MglScheduleExport", "Түүвэр илгээх", "Revit-ийн түүврийн хүснэгтийг ERP-д илгээх" },
            new[] { "MglBatchSheets", "Хуудас үүсгэх", "Олон зургийн хуудас үүсгэх" },
            new[] { "MglSheetNumerator", "Хуудас дугаарлах", "Зургийн хуудсыг эрэмбэлж, дугаарлах" },
            new[] { "MglCopyToOther", "Элемент хуулах", "Элемент болон тэмдэглэгээг өөр хэсэгт хуулах" },
            new[] { "MglCloneDrawings", "Зураг хувилах", "Ижил элементийн ажлын зургийг хувилах" },
            new[] { "MglAutoAnnotate", "Хэмжээс, тэмдэглэгээ", "Хэмжээс, тэмдэглэгээ автоматаар тавих" },
            new[] { "MglFamilyHub", "Family сан", "Family хайх, төсөлд ачаалах, байрлуулах" },
            new[] { "MglSmartCount", "Элемент тоолох", "Элементийг шүүж, тоолж, загварт харуулах" },
            new[] { "MglSmartClash", "Давхцал шалгах", "Элементүүдийн геометрийн давхцал шалгах" },
            new[] { "MglSmartImpact", "Өөрчлөлтийн нөлөө", "Өөрчлөлтөд өртсөн элемент, харагдац, хуудсыг шинжлэх" },
            new[] { "MglSmartPublish", "Файл гаргах", "PDF, DWG, IFC файлыг хавтсанд гаргах" },
            new[] { "MglRebarEndSymbol", "Төгсгөлийн тэмдэг", "Арматурын төгсгөлийн тэмдэг тавих" },
            new[] { "MglRebarSectionAnnotation", "Хуулбарлаж зурах", "Хуулбарлаж зурах — загвар харагдацаас" },
            new[] { "MglRebarRefresh", "Тэмдэглэгээ шинэчлэх", "MGL-ийн арматурын тэмдэглэгээг шинэчлэх" },
            new[] { "MglRebarShowEdges", "Захын, голын арматур", "Захын, голын арматурыг харуулах" },
            new[] { "MglRebarShowPick", "Ширхэг харуулах", "Арматурын ширхэг сонгож харуулах" },
            new[] { "MglScheduleClone", "Түүвэр хувилах", "Арматурын түүврийг бүлэг бүрээр хувилах" },
            new[] { "MglScheduleSync", "Түүвэр шинэчлэх", "Арматурын түүврийн зөрүүг шалгаж, засах" },
            new[] { "MglLicense", "Бүртгэл, эрх", "Компанийн бүртгэл, компьютерын ашиглах эрх" },
            new[] { "MglQtoSettings", "Тохиргоо", "ERP төсөл, холболт, харагдах байдлын тохиргоо" },
            new[] { "MglFeedback", "Санал хүсэлт", "Програм хариуцагчид алдаа, санал илгээх" },
        };

        [Test]
        public static void The_23_legacy_stable_command_names_are_all_present_exactly_once()
        {
            // PushButtonData.Name нь Quick Access Toolbar / гарын товчлуурт хадгалагддаг — ХЭЗЭЭ Ч өөрчлөхгүй.
            Assert.Eq(23, ToolCatalogData.LegacyStableNames.Length);
            foreach (string n in ToolCatalogData.LegacyStableNames)
                Assert.Eq(1, ToolCatalogData.All.Count(t => t.Name == n), "нэр " + n);
        }

        [Test]
        public static void Catalog_has_the_23_plus_catalog_and_pre_change_tools_and_names_are_unique()
        {
            Assert.Eq(33, ToolCatalogData.All.Count);       // 23 хуучин + MglToolCatalog + MglSmartPreChange + MglRebarShowEdges + MglRebarShowPick + MglWallElevations + MglDatumCrop + MglRebarLengthDim + MglRoomPlan + MglFloorPlate + MglFeedback
            Assert.Eq(33, ToolCatalogData.All.Select(t => t.Name).Distinct().Count());
            Assert.NotNull(ToolCatalogData.Find("MglFeedback"));
            Assert.NotNull(ToolCatalogData.Find("MglSmartPreChange"));
            Assert.NotNull(ToolCatalogData.Find("MglToolCatalog"));
            Assert.Null(ToolCatalogData.Find("NoSuchTool"));
            Assert.Null(ToolCatalogData.Find(null));
        }

        [Test]
        public static void Stable_names_are_plain_ascii_identifiers()
        {
            foreach (ToolMeta t in ToolCatalogData.All)
            {
                Assert.True(t.Name.StartsWith("Mgl", StringComparison.Ordinal), t.Name);
                Assert.True(t.Name.All(c => c < 128 && char.IsLetterOrDigit(c)), "ASCII биш: " + t.Name);
            }
        }

        [Test]
        public static void Ribbon_labels_and_full_names_match_the_approved_naming_map()
        {
            foreach (string[] row in Approved)
            {
                ToolMeta t = ToolCatalogData.Find(row[0]);
                Assert.NotNull(t, row[0]);
                Assert.Eq(row[1], t.LabelOneLine, row[0] + " шошго");
                Assert.Eq(row[2], t.FullName, row[0] + " бүтэн нэр");
            }
        }

        [Test]
        public static void Ribbon_labels_are_at_most_two_short_lines_to_protect_panel_width()
        {
            // App.cs-ийн хуучин сургамж: өргөн самбар Revit-д НЭГ унжих товч болж хуйлагдсан.
            // Хуучин хамгийн урт мөр 18 тэмдэгт («Огтлолын арматурын») байсан; одоо ≤ 12.
            foreach (ToolMeta t in ToolCatalogData.All)
            {
                string[] lines = t.Label.Split('\n');
                Assert.True(lines.Length <= 2, t.Name + ": " + lines.Length + " мөр");
                foreach (string l in lines)
                    Assert.True(l.Length <= 12, t.Name + ": «" + l + "» " + l.Length + " тэмдэгт");
            }
        }

        [Test]
        public static void Every_tool_has_complete_user_facing_text()
        {
            foreach (ToolMeta t in ToolCatalogData.All)
            {
                Assert.False(string.IsNullOrWhiteSpace(t.Purpose), t.Name + " purpose");
                Assert.False(string.IsNullOrWhiteSpace(t.ToolTip), t.Name + " tooltip");
                Assert.False(string.IsNullOrWhiteSpace(t.LongDescription), t.Name + " long");
                Assert.False(string.IsNullOrWhiteSpace(t.IconKey), t.Name + " icon");
                Assert.False(string.IsNullOrWhiteSpace(t.Destination), t.Name + " destination");
                Assert.True(t.HowTo != null && t.HowTo.Length >= 2 && t.HowTo.Length <= 5, t.Name + " howto 2–5 алхам");
                Assert.True(t.Aliases != null && t.Aliases.Length >= 4, t.Name + " alias");
            }
        }

        [Test]
        public static void Short_tooltips_are_concise_and_long_help_is_bounded()
        {
            foreach (ToolMeta t in ToolCatalogData.All)
            {
                Assert.True(t.ToolTip.Length <= 430, t.Name + " tooltip " + t.ToolTip.Length + " тэмдэгт — богино байх ёстой");
                Assert.True(t.LongDescription.Length <= 2600, t.Name + " long " + t.LongDescription.Length + " тэмдэгт");
                Assert.True(t.ToolTip.Length >= 60, t.Name + " tooltip хэт богино");
            }
        }

        [Test]
        public static void Tooltip_destination_claims_follow_the_declared_effects()
        {
            foreach (ToolMeta t in ToolCatalogData.All)
            {
                bool sends = (t.Effects & ToolEffects.SendsToErp) != 0;
                if (sends)
                    Assert.True(t.ToolTip.Contains("ERP"), t.Name + " ERP руу илгээдэг ч tooltip-д ERP байхгүй");
                // Локал хэрэгслийн tooltip «ERP руу илгээнэ» гэж ХУДАЛ хэлж болохгүй.
                if (!sends)
                {
                    Assert.False(t.ToolTip.Contains("ERP-ийн сонгосон төсөлд илгээнэ"), t.Name);
                    Assert.False(t.ToolTip.Contains("ERP руу илгээнэ."), t.Name);
                }
            }
            // Хавтсанд гаргадаг хэрэгсэл ERP руу ЮУ Ч илгээхгүйгээ ИЛ хэлнэ (F3).
            ToolMeta pub = ToolCatalogData.Find("MglSmartPublish");
            Assert.True(pub.ToolTip.Contains("ERP руу юу ч илгээхгүй"));
            Assert.Eq(ToolEffects.None, pub.Effects & ToolEffects.SendsToErp);
            // Локал тоолуур ERP руу илгээдэггүйгээ ИЛ хэлнэ.
            ToolMeta count = ToolCatalogData.Find("MglSmartCount");
            Assert.True(count.ToolTip.Contains("ERP руу юу ч илгээхгүй"));
        }

        [Test]
        public static void Model_changing_tools_state_how_to_undo_truthfully()
        {
            foreach (ToolMeta t in ToolCatalogData.All.Where(x => (x.Effects & ToolEffects.ChangesModel) != 0))
            {
                Assert.False(string.IsNullOrWhiteSpace(t.Undo), t.Name + " загварыг өөрчилдөг ч Undo тайлбаргүй");
            }
            // Мэдэгдэж буй, ХУДАЛ байсан мэдэгдлүүд дахин орж ирэхгүй.
            ToolMeta clone = ToolCatalogData.Find("MglCloneDrawings");
            Assert.True(clone.Undo.Contains("БУЦАХГҮЙ"), "Зураг хувилах нэг Ctrl+Z-ээр буцахгүй");
            Assert.False(clone.ToolTip.Contains("атом"));
            ToolMeta end = ToolCatalogData.Find("MglRebarEndSymbol");
            Assert.True(end.Undo.Contains("товшилт бүр"), "Төгсгөлийн тэмдэг: дараалан дарсан бол товшилт бүр тусдаа");
            Assert.False(end.ToolTip.Contains("Esc = загварт юу ч өөрчлөхгүй"));
        }

        [Test]
        public static void Known_stale_help_claims_are_gone()
        {
            ToolMeta copy = ToolCatalogData.Find("MglCopyToOther");
            Assert.False(copy.LongDescription.Contains("одоохондоо байхгүй"), "эргүүлэх/толин тусгал ажилладаг");
            Assert.True(copy.LongDescription.Contains("Толин тусгал") && copy.LongDescription.Contains("Эргүүлж байрлуулах"));
            Assert.True(copy.LongDescription.Contains("ӨӨРЧЛӨГДӨХГҮЙ"), "эх элемент хөдөлдөггүй — «Шилжүүлэх» нэр андуурахгүй");

            ToolMeta sec = ToolCatalogData.Find("MglRebarSectionAnnotation");
            Assert.False(sec.LongDescription.Contains("үл үзэгдэх лавлагаа шугамд"), "хуурамч лавлагаа ОГТ үүсгэдэггүй");
            Assert.True(sec.LongDescription.Contains("ХУУРАМЧ шугам үүсгэхгүй"));
            Assert.True(sec.LongDescription.Contains("Загвар харагдацаас хуулах"), "1.13.0-ийн горим тооцогдсон");

            ToolMeta sched = ToolCatalogData.Find("MglScheduleExport");
            Assert.False(sched.ToolTip.Contains("загварт хадгалагдана"), "settings.json, загвар биш");
            Assert.True(sched.LongDescription.Contains("settings.json"));
        }

        [Test]
        public static void Partition_is_never_confused_with_workset()
        {
            foreach (string n in new[] { "MglScheduleClone", "MglScheduleSync" })
            {
                ToolMeta t = ToolCatalogData.Find(n);
                Assert.True(t.ToolTip.Contains("(Partition)") && (t.ToolTip.Contains("Арматурын бүлэг") || t.ToolTip.Contains("Арматурын бүлгүүд")), n + ": Partition-ыг «Арматурын бүлэг/бүлгүүд (Partition)» гэж тайлбарлах");
            }
            Assert.True(ToolCatalogData.Find("MglScheduleClone").LongDescription.Contains("Workset БИШ"));
        }

        [Test]
        public static void Tools_without_requirements_say_they_are_always_enabled()
        {
            foreach (ToolMeta t in ToolCatalogData.All)
            {
                bool unconditional = !t.RequiresProjectDocument && t.AllowedViews == ToolViews.Any;
                if (unconditional) Assert.True(t.ToolTip.Contains("үргэлж идэвхтэй"), t.Name);
                else Assert.True(t.ToolTip.Contains("Идэвхгүй") || t.ToolTip.Contains("идэвхгүй"), t.Name + " яагаад идэвхгүй болохыг tooltip хэлэх ёстой");
            }
        }

        [Test]
        public static void Net8Plus_tools_are_exactly_the_ones_excluded_from_R24()
        {
            // csproj-ийн <Compile Remove> + #if MGL_*: FamilyHub, WorkPane, Smart (Count/Clash/Impact/PreChange/Publish).
            var expected = new HashSet<string> { "MglWorkPane", "MglFamilyHub", "MglSmartCount", "MglSmartClash", "MglSmartImpact", "MglSmartPreChange", "MglSmartPublish" };
            var actual = new HashSet<string>(ToolCatalogData.All.Where(t => t.Build == ToolBuild.Net8Plus).Select(t => t.Name));
            Assert.True(expected.SetEquals(actual), "Net8Plus: " + string.Join(",", actual.OrderBy(x => x)));
        }
    }
}
