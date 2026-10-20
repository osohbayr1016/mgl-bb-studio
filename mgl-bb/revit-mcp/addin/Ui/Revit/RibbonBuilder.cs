using System;
using System.Collections.Generic;
using System.IO;
using System.Windows.Media.Imaging;
using Autodesk.Revit.UI;
using RevitMcpAddin.Ui.Core;

namespace RevitMcpAddin.Ui.Revit
{
    /// <summary>
    /// Ribbon-ыг `RibbonPlan` (ӨГӨГДӨЛ) + `ToolCatalogData` (текст)-ээс БАРИНА.  Өмнө нь App.cs / SmartRibbon.cs /
    /// RfRibbon.cs гурван газар 23 товч, 7 самбарыг тус тусад нь, хуулсан MakeButton-оор бүтээж, алдааг ЛОГГҮЙ
    /// залгидаг байв.  Одоо:
    ///   • самбар/товч/stack/pulldown НЭГ төлөвлөгөөнөөс; R24-д байхгүй хэрэгслийн самбар хоосон үүсэхгүй;
    ///   • tooltip/LongDescription/шошго/дүрс нь метадатаас — ribbon ба каталог зөрөхгүй;
    ///   • `PushButtonData.Name` ХЭВЭЭР (metadata тест хуучин 23 нэрийг тогтоосон);
    ///   • алдаа бүр `ribbon-startup.log`-д (panel эсвэл нэг товч унавал бусад үргэлжилнэ).
    ///
    /// ⚠️ Самбар/pulldown нэр нь Revit команд ID-д орно → QAT/гарын товчлуурт ХЭСЭГ ЗҮЙЛ дахин тохируулах шаардлагатай
    ///    (docs/MGL_UI_UX_REDESIGN.md §5.3).  Амьд Revit дээр шалгаагүй.
    /// ⚠️ Nuance: `typeof(Command).FullName` — анги нэр солигдвол эмхэтгэл УНАНА (өмнөх string нь ажиллах үед л унадаг байв).
    /// </summary>
    internal static class RibbonBuilder
    {
        /// <summary>R24 (net48) = All; R25–R27 (net8/net10) = Net8Plus — csproj-ийн `MGL_*` тогтмолуудтай ЯГ ижил нөхцөл.</summary>
        internal static ToolBuild Running
        {
            get
            {
#if NET8_0_OR_GREATER
                return ToolBuild.Net8Plus;
#else
                return ToolBuild.All;
#endif
            }
        }

        private sealed class Binding
        {
            public readonly Type Command;
            public readonly Type Availability;   // null → үргэлж идэвхтэй
            public Binding(Type command, Type availability) { Command = command; Availability = availability; }
        }

        private static readonly Dictionary<string, Binding> Bindings = CreateBindings();

        private static Dictionary<string, Binding> CreateBindings()
        {
            var d = new Dictionary<string, Binding>(StringComparer.Ordinal);

            // ── Бүх Revit хувилбар (R24 орно) ──
            d["MglToolCatalog"] = new Binding(typeof(ToolCatalogCommand), typeof(ToolCatalogAvailability));
            d["MglAssistantPane"] = new Binding(typeof(AssistantPaneCommand), typeof(ProgressCommandAvailability));
            d["MglRevitBinding"] = new Binding(typeof(BindingCommand), typeof(ProgressCommandAvailability));
            d["MglQtoExport"] = new Binding(typeof(QtoExportCommand), typeof(QtoCommandAvailability));
            d["MglPdfExport"] = new Binding(typeof(PdfViewExportCommand), typeof(PdfViewAvailability));
            d["MglScheduleExport"] = new Binding(typeof(ScheduleExportCommand), typeof(QtoCommandAvailability));
            d["MglBatchSheets"] = new Binding(typeof(BatchSheetCommand), typeof(QtoCommandAvailability));
            d["MglSheetNumerator"] = new Binding(typeof(SheetNumerator.SheetNumeratorCommand), typeof(QtoCommandAvailability));
            d["MglCopyToOther"] = new Binding(typeof(CopyToOtherCommand), typeof(CopyToOtherAvailability));
            d["MglCloneDrawings"] = new Binding(typeof(CloneDrawings.CloneDrawingsCommand), typeof(CloneDrawingsAvailability));
            d["MglAutoAnnotate"] = new Binding(typeof(AutoAnnotate.AutoAnnotateCommand), typeof(AutoAnnotate.AutoAnnotateAvailability));
            d["MglRoomPlan"] = new Binding(typeof(RoomPlan.RoomPlanBatchCommand), typeof(CopyToOtherAvailability));
            d["MglVentilation"] = new Binding(typeof(Ventilation.Revit.VentilationCommand), typeof(QtoCommandAvailability));
            d["MglFloorPlate"] = new Binding(typeof(RoomPlan.RoomPlanFloorCommand), typeof(CopyToOtherAvailability));
            d["MglWallElevations"] = new Binding(typeof(WallElevation.WallElevationCommand), typeof(QtoCommandAvailability));
            d["MglDatumCrop"] = new Binding(typeof(AutoAnnotate.DatumCropCommand), typeof(AutoAnnotate.DatumCropAvailability));
            d["MglRebarEndSymbol"] = new Binding(typeof(Reinforcement.RebarEndSymbolCommand), typeof(Reinforcement.RfViewAvailability));
            d["MglRebarSectionAnnotation"] = new Binding(typeof(Reinforcement.SectionAnnotationCommand), typeof(SectionAnnotationAvailability));
            d["MglRebarRefresh"] = new Binding(typeof(Reinforcement.RefreshAnnotationsCommand), typeof(Reinforcement.RfViewAvailability));
            d["MglRebarShowEdges"] = new Binding(typeof(Reinforcement.RebarShowEdgesCommand), typeof(Reinforcement.RfViewAvailability));
            d["MglRebarShowPick"] = new Binding(typeof(Reinforcement.RebarShowPickCommand), typeof(Reinforcement.RfViewAvailability));
            d["MglRebarLengthDim"] = new Binding(typeof(Reinforcement.RebarLengthDimCommand), typeof(Reinforcement.RfViewAvailability));
            d["MglScheduleClone"] = new Binding(typeof(Reinforcement.ScheduleCloneCommand), typeof(QtoCommandAvailability));
            d["MglScheduleSync"] = new Binding(typeof(Reinforcement.ScheduleSyncCommand), typeof(QtoCommandAvailability));
            d["MglLicense"] = new Binding(typeof(Licensing.LicenseCommand), typeof(Licensing.LicenseAvailability));
            d["MglQtoSettings"] = new Binding(typeof(QtoSettingsCommand), null);   // тохиргоо — үргэлж идэвхтэй
            d["MglFeedback"] = new Binding(typeof(Feedback.FeedbackCommand), typeof(Feedback.FeedbackAvailability));   // лицензгүй ч нээгдэнэ

#if NET8_0_OR_GREATER
            // ── Зөвхөн Revit 2025+ (csproj: net48-д Compile Remove) ──
            d["MglWorkPane"] = new Binding(typeof(WorkPane.WorkPaneCommand), typeof(WorkPane.WorkPaneAvailability));
            d["MglFamilyHub"] = new Binding(typeof(FamilyHub.Revit.FamilyHubCommand), typeof(QtoCommandAvailability));
            d["MglSmartImpact"] = new Binding(typeof(ChangeImpact.ChangeImpactCommand), typeof(QtoCommandAvailability));
            d["MglSmartPreChange"] = new Binding(typeof(ChangeImpact.PreChangeCommand), typeof(QtoCommandAvailability));
            d["MglSmartCount"] = new Binding(typeof(SmartCount.SmartCountCommand), typeof(QtoCommandAvailability));
            d["MglSmartClash"] = new Binding(typeof(ClashCheck.ClashCheckCommand), typeof(QtoCommandAvailability));
            d["MglSmartPublish"] = new Binding(typeof(SmartPublish.SmartPublishCommand), typeof(QtoCommandAvailability));
#endif
            return d;
        }

        /// <summary>
        /// САЛБАРЫН хувилбарын командын холбоос (2026-10-13): түлхүүр = `Name@салбар` (ж: `MglWallElevations@interior`).
        /// `ToolMeta.VariesByDiscipline`-тэй хэрэгслийн логик салбараар салахад (БА / Интерьерийн өөр template, Интерьерийн
        /// render зургийн хэсэг) ТЭР салбарын командын ангийг ЭНД бүртгэнэ — ribbon-ы бүтэц, нэр, ID хөдлөхгүй.
        /// Бүртгэлгүй бол ерөнхий `Bindings[Name]` (одоо БҮГД тийм — хэрэгслийн логик хараахан салбараас хамаарахгүй).
        /// </summary>
        private static readonly Dictionary<string, Binding> DisciplineBindings = new Dictionary<string, Binding>(StringComparer.Ordinal)
        {
            // 2026-10-14: интерьерийн «Ханын дэлгээс» — хуудсанд интерьерийн ангилал (* Classification / * Sub-Discipline) автоматаар.
            { "MglWallElevations@interior", new Binding(typeof(WallElevation.WallElevationInteriorCommand), typeof(QtoCommandAvailability)) },
        };

        /// <summary>Tab-ийн нэрийг `App` тооцоолно (MGL_RIBBON_TAB).  Алдаа бүр ЛОГ-д; нэг самбар унавал бусад үргэлжилнэ.</summary>
        internal static void Build(UIControlledApplication application, string tabName, string assemblyPath)
        {
            IReadOnlyList<RibbonPanelPlan> plan = RibbonPlan.For(Running);
            // Салбарын шүүлт (2026-10-13): самбар бүрийг бүртгэж, `RibbonDisciplines.Init()` салбарын самбарыг нууж/харуулна.
            RibbonDisciplines.Begin(plan);
            foreach (RibbonPanelPlan panelPlan in plan)
            {
                try
                {
                    RibbonPanel panel = application.CreateRibbonPanel(tabName, panelPlan.Title);
                    RibbonDisciplines.TrackPanel(panelPlan.Id, panel);
                    foreach (RibbonSlot slot in panelPlan.Slots)
                    {
                        try { AddSlot(panel, slot, tabName, panelPlan, assemblyPath); }
                        catch (Exception ex) { LogFailure("«" + panelPlan.Title + "» самбар, " + Describe(slot), ex); }
                    }
                }
                catch (Exception ex)
                {
                    LogFailure("«" + panelPlan.Title + "» самбар үүсгэх", ex);
                }
            }
        }

        private static void AddSlot(RibbonPanel panel, RibbonSlot slot, string tab, RibbonPanelPlan panelPlan, string assemblyPath)
        {
            string panelTitle = panelPlan.Title;
            ToolDiscipline discipline = panelPlan.Discipline;
            switch (slot.Kind)
            {
                case RibbonSlotKind.Large:
                {
                    ToolMeta t = slot.Tools[0];
                    PushButtonData data = MakeData(t, true, assemblyPath, discipline);
                    if (data == null) return;
                    panel.AddItem(data);
                    ToolLauncher.Register(t.Name, data.Name, tab, panelTitle, null, discipline);
                    break;
                }
                case RibbonSlotKind.Stack:
                {
                    var datas = new List<PushButtonData>();
                    var names = new List<string>();
                    foreach (ToolMeta t in slot.Tools)
                    {
                        PushButtonData d = MakeData(t, false, assemblyPath, discipline);
                        if (d == null) continue;
                        datas.Add(d);
                        names.Add(t.Name);
                    }
                    if (datas.Count == 3) panel.AddStackedItems(datas[0], datas[1], datas[2]);
                    else if (datas.Count == 2) panel.AddStackedItems(datas[0], datas[1]);
                    else if (datas.Count == 1) panel.AddItem(datas[0]);   // нэг нь холбогдож чадаагүй — Revit 2–3 шаарддаг
                    for (int i = 0; i < datas.Count; i++) ToolLauncher.Register(names[i], datas[i].Name, tab, panelTitle, null, discipline);
                    break;
                }
                case RibbonSlotKind.Pulldown:
                {
                    var pdd = new PulldownButtonData(slot.PulldownName, slot.PulldownLabel) { ToolTip = slot.PulldownToolTip };
                    ApplyIcons(pdd, slot.PulldownIconKey, true);
                    PulldownButton pd = panel.AddItem(pdd) as PulldownButton;
                    if (pd == null) return;
                    foreach (ToolMeta t in slot.Tools)
                    {
                        PushButtonData d = MakeData(t, false, assemblyPath, discipline);
                        if (d == null) continue;
                        pd.AddPushButton(d);
                        ToolLauncher.Register(t.Name, d.Name, tab, panelTitle, slot.PulldownName, discipline);
                    }
                    break;
                }
            }
        }

        private static PushButtonData MakeData(ToolMeta t, bool large, string assemblyPath, ToolDiscipline discipline)
        {
            Binding b = null;
            string variantKey = discipline == ToolDiscipline.None ? null : t.Name + "@" + ToolDisciplines.Key(discipline);
            if ((variantKey == null || !DisciplineBindings.TryGetValue(variantKey, out b)) && !Bindings.TryGetValue(t.Name, out b))
            {
                LogFailure("«" + t.Name + "» товчны холбоос (command class) бүртгэгдээгүй", null);
                return null;
            }

            // Large товч: 2 мөртэй шошго; stack/pulldown: нэг мөр.
            string text = large ? t.Label : t.LabelOneLine;
            var data = new PushButtonData(RibbonPlan.ButtonName(t, discipline), text, assemblyPath, b.Command.FullName)
            {
                ToolTip = t.ToolTip,
                LongDescription = t.LongDescription,
            };
            if (b.Availability != null) data.AvailabilityClassName = b.Availability.FullName;
            ApplyIcons(data, t.IconKey, large);
            return data;
        }

        /// <summary>Дүрс зурагдахгүй бол (фонт байхгүй) товч зөвхөн бичигтэй ажиллана — ribbon УНАХГҮЙ.</summary>
        private static void ApplyIcons(ButtonData data, string iconKey, bool large)
        {
            BitmapSource big = large ? ToolIconRenderer.Render(iconKey, 32) : null;
            BitmapSource small = ToolIconRenderer.Render(iconKey, 16);
            if (big != null) data.LargeImage = big;
            if (small != null) data.Image = small;
        }

        private static string Describe(RibbonSlot slot)
        {
            return slot.Kind + ": " + (slot.Tools.Count > 0 ? slot.Tools[0].Name : "?");
        }

        internal static void LogFailure(string what, Exception ex)
        {
            try
            {
                Directory.CreateDirectory(SettingsStore.Dir);
                string path = Path.Combine(SettingsStore.Dir, "ribbon-startup.log");
                FileInfo fi = new FileInfo(path);
                if (fi.Exists && fi.Length > 200 * 1024) File.Delete(path);
                string line = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + what
                    + (ex == null ? string.Empty : "  — " + ex.GetType().Name + ": " + ex.Message);
                File.AppendAllText(path, line + Environment.NewLine);
            }
            catch
            {
                // Лог бичигдэхгүй байх нь ribbon-д нөлөөлөхгүй.
            }
        }
    }
}
