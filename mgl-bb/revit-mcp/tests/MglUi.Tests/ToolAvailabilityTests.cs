using System;
using RevitMcpAddin.Ui.Core;

namespace RevitMcpAddin.Ui.Tests
{
    /// <summary>Хэрэгсэл ОДОО яагаад нээгдэхгүй вэ — зургаан шалтгаан ТУСДАА, зөөлөн нөхцөл ТУСДАА.</summary>
    public static class ToolAvailabilityTests
    {
        private static ToolMeta T(string n) { return ToolCatalogData.Find(n); }

        private static ToolContext Ready(ToolViewKind view)
        {
            return new ToolContext
            {
                HasDocument = true, IsFamilyDocument = false, ViewKind = view, ViewIsTemplate = false,
                License = ToolLicenseState.Valid, ErpProjectSelected = true, CommandBusy = false, RunningBuild = ToolBuild.Net8Plus,
            };
        }

        [Test]
        public static void Ready_context_lets_every_tool_launch()
        {
            foreach (ToolMeta t in ToolCatalogData.All)
            {
                // Тохирох харагдацыг сонгоно: план (ихэнх нь), план зөвшөөрдөггүй хэрэгсэлд (ж: «Тэнхлэг, түвшин» — огтлол/дэлгээс л) огтлол.
                ToolViewKind v = (t.AllowedViews & ToolViews.Plan) != 0 ? ToolViewKind.Plan : ToolViewKind.Section;
                ToolAvailabilityResult r = ToolAvailability.Evaluate(t, Ready(v));
                Assert.True(r.CanLaunch, t.Name + " " + v + " дээр нээгдэх ёстой: " + r.Reason);
                Assert.Eq(ToolSetup.None, r.Setup, t.Name);
            }
        }

        [Test]
        public static void Missing_document_is_reported_with_how_to_fix()
        {
            ToolContext c = Ready(ToolViewKind.None); c.HasDocument = false;
            ToolAvailabilityResult r = ToolAvailability.Evaluate(T("MglSheetNumerator"), c);
            Assert.Eq(ToolBlock.NoDocument, r.Block);
            Assert.False(r.CanLaunch);
            Assert.True(r.Resolution.Contains(".rvt"));
        }

        [Test]
        public static void Family_document_is_a_separate_reason_from_missing_document()
        {
            ToolContext c = Ready(ToolViewKind.Plan); c.IsFamilyDocument = true;
            ToolAvailabilityResult r = ToolAvailability.Evaluate(T("MglQtoExport"), c);
            Assert.Eq(ToolBlock.FamilyDocument, r.Block);
            Assert.True(r.Reason.Contains("Family"));
        }

        [Test]
        public static void Unsupported_view_names_the_current_view_and_the_supported_ones()
        {
            ToolAvailabilityResult r = ToolAvailability.Evaluate(T("MglCopyToOther"), Ready(ToolViewKind.Section));
            Assert.Eq(ToolBlock.UnsupportedView, r.Block);
            Assert.True(r.Reason.Contains("зүсэлт"), r.Reason);
            Assert.True(r.Resolution.Contains("План"), r.Resolution);

            // Зураг хувилах: план/зүсэлт/фасад/detail/3D боломжтой, хуудас дээр үгүй.
            Assert.True(ToolAvailability.Evaluate(T("MglCloneDrawings"), Ready(ToolViewKind.Section)).CanLaunch);
            Assert.True(ToolAvailability.Evaluate(T("MglCloneDrawings"), Ready(ToolViewKind.ThreeD)).CanLaunch);
            Assert.Eq(ToolBlock.UnsupportedView, ToolAvailability.Evaluate(T("MglCloneDrawings"), Ready(ToolViewKind.Sheet)).Block);
        }

        [Test]
        public static void Section_annotation_refuses_elevation_like_the_command_does()
        {
            // RfViewAvailability нь фасадыг зөвшөөрдөг ч команд өөрөө татгалздаг — каталог ҮНЭНИЙГ хэлнэ.
            Assert.Eq(ToolBlock.UnsupportedView, ToolAvailability.Evaluate(T("MglRebarSectionAnnotation"), Ready(ToolViewKind.Elevation)).Block);
            Assert.True(ToolAvailability.Evaluate(T("MglRebarEndSymbol"), Ready(ToolViewKind.Elevation)).CanLaunch);
            Assert.True(ToolAvailability.Evaluate(T("MglRebarSectionAnnotation"), Ready(ToolViewKind.Detail)).CanLaunch);
        }

        [Test]
        public static void View_template_is_its_own_reason()
        {
            ToolContext c = Ready(ToolViewKind.Plan); c.ViewIsTemplate = true;
            Assert.Eq(ToolBlock.TemplateView, ToolAvailability.Evaluate(T("MglCopyToOther"), c).Block);
            Assert.Eq(ToolBlock.TemplateView, ToolAvailability.Evaluate(T("MglAutoAnnotate"), c).Block);
            // Загварт хамаагүй хэрэгсэл
            Assert.True(ToolAvailability.Evaluate(T("MglSheetNumerator"), c).CanLaunch);
        }

        [Test]
        public static void No_active_view_blocks_view_restricted_tools_but_not_unrestricted_ones()
        {
            ToolContext c = Ready(ToolViewKind.None);
            Assert.Eq(ToolBlock.UnsupportedView, ToolAvailability.Evaluate(T("MglAutoAnnotate"), c).Block);
            Assert.True(ToolAvailability.Evaluate(T("MglBatchSheets"), c).CanLaunch);
        }

        [Test]
        public static void Pdf_export_works_on_sheets_but_not_on_schedules()
        {
            Assert.True(ToolAvailability.Evaluate(T("MglPdfExport"), Ready(ToolViewKind.Sheet)).CanLaunch);
            Assert.Eq(ToolBlock.UnsupportedView, ToolAvailability.Evaluate(T("MglPdfExport"), Ready(ToolViewKind.Schedule)).Block);
        }

        [Test]
        public static void Busy_is_a_separate_reason_and_applies_to_every_tool()
        {
            ToolContext c = Ready(ToolViewKind.Plan); c.CommandBusy = true;
            foreach (ToolMeta t in ToolCatalogData.All)
                Assert.Eq(ToolBlock.Busy, ToolAvailability.Evaluate(t, c).Block, t.Name);
        }

        [Test]
        public static void Tool_not_compiled_on_this_build_is_explained_and_never_launchable()
        {
            ToolContext c = Ready(ToolViewKind.Plan); c.RunningBuild = ToolBuild.All;   // Revit 2024
            foreach (string n in new[] { "MglSmartCount", "MglSmartClash", "MglSmartImpact", "MglSmartPreChange", "MglSmartPublish", "MglFamilyHub", "MglWorkPane" })
            {
                ToolAvailabilityResult r = ToolAvailability.Evaluate(T(n), c);
                Assert.Eq(ToolBlock.NotInThisBuild, r.Block, n);
                Assert.False(r.CanLaunch, n);
                Assert.True(r.Resolution.Contains("2025"), n + ": " + r.Resolution);
            }
            // R24-д байгаа хэрэгсэл хэвийн
            Assert.True(ToolAvailability.Evaluate(T("MglSheetNumerator"), c).CanLaunch);
        }

        [Test]
        public static void Not_in_build_outranks_every_other_reason()
        {
            ToolContext c = new ToolContext { HasDocument = false, CommandBusy = true, RunningBuild = ToolBuild.All };
            Assert.Eq(ToolBlock.NotInThisBuild, ToolAvailability.Evaluate(T("MglSmartCount"), c).Block);
        }

        [Test]
        public static void Signin_pending_and_missing_erp_project_are_soft_notes_not_blocks()
        {
            ToolContext c = Ready(ToolViewKind.Plan);
            c.License = ToolLicenseState.SignInRequired;
            ToolAvailabilityResult a = ToolAvailability.Evaluate(T("MglSheetNumerator"), c);
            Assert.True(a.CanLaunch, "нэвтрээгүй ч команд өөрөө нэвтрэх цонх гаргана");
            Assert.Eq(ToolSetup.SignIn, a.Setup);

            c.License = ToolLicenseState.Pending;
            Assert.Eq(ToolSetup.LicensePending, ToolAvailability.Evaluate(T("MglSheetNumerator"), c).Setup);

            c.License = ToolLicenseState.Valid; c.ErpProjectSelected = false;
            ToolAvailabilityResult e = ToolAvailability.Evaluate(T("MglQtoExport"), c);
            Assert.True(e.CanLaunch);
            Assert.Eq(ToolSetup.ErpProject, e.Setup);
            Assert.True(e.Resolution.Contains("Тохиргоо"));
            // ERP төсөл шаарддаггүй хэрэгсэлд энэ сануулга гарахгүй
            Assert.Eq(ToolSetup.None, ToolAvailability.Evaluate(T("MglBatchSheets"), c).Setup);
        }

        [Test]
        public static void Unknown_licence_state_is_not_guessed()
        {
            ToolContext c = Ready(ToolViewKind.Plan); c.License = ToolLicenseState.Unknown;
            Assert.Eq(ToolSetup.None, ToolAvailability.Evaluate(T("MglSheetNumerator"), c).Setup);
        }

        [Test]
        public static void Always_available_tools_ignore_document_view_and_licence()
        {
            var c = new ToolContext { HasDocument = false, License = ToolLicenseState.SignInRequired, ViewKind = ToolViewKind.None, RunningBuild = ToolBuild.Net8Plus };
            foreach (string n in new[] { "MglLicense", "MglQtoSettings", "MglToolCatalog", "MglWorkPane", "MglFeedback" })
            {
                ToolAvailabilityResult r = ToolAvailability.Evaluate(T(n), c);
                Assert.True(r.CanLaunch, n);
                Assert.Eq(ToolSetup.None, r.Setup, n);
            }
        }

        [Test]
        public static void Null_context_is_treated_as_empty_not_a_crash()
        {
            ToolAvailabilityResult r = ToolAvailability.Evaluate(T("MglSheetNumerator"), null);
            Assert.Eq(ToolBlock.NoDocument, r.Block);
            Assert.Throws<ArgumentNullException>(() => ToolAvailability.Evaluate(null, new ToolContext()));
        }

        [Test]
        public static void Effects_text_never_claims_nothing_when_something_happens()
        {
            foreach (ToolMeta t in ToolCatalogData.All)
            {
                var lines = ToolEffectsText.Describe(t);
                Assert.True(lines.Count >= 1, t.Name);
                if (t.Effects != ToolEffects.None) Assert.False(lines.Contains("Загварт хүрэхгүй, юу ч илгээхгүй"), t.Name);
            }
            Assert.True(ToolEffectsText.Describe(T("MglPdfExport")).Contains("Загварт ТҮР өөрчлөлт хийж, буцаана"));
            Assert.True(ToolEffectsText.Describe(T("MglSmartPublish")).Contains("Файл үүсгэнэ"));
            Assert.True(ToolEffectsText.Describe(T("MglQtoExport")).Contains("ERP руу илгээнэ"));
        }
    }
}
