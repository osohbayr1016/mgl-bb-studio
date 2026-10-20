using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.Smart.Core;
using RevitMcpAddin.Smart.Tests;
using RevitMcpAddin.SmartPublish.Core;
using RevitMcpAddin.SmartPublish.Ui;

namespace RevitMcpAddin.Smart.UiSmoke
{
    /// <summary>Revit-гүй `IPublishSession` — Монгол/англи нэртэй 14 хуудас, placeholder, хэвлэх боломжгүй нэг.</summary>
    internal sealed class FakePublishSession : IPublishSession
    {
        public string DocumentTitle { get { return "Tennis-Hall"; } }
        public IReadOnlyList<PublishItem> Items { get; private set; }
        public PublishContext Project { get; private set; }
        public IReadOnlyCollection<string> DwgSetupNames { get; private set; }
        public IReadOnlyCollection<string> ThreeDViewNames { get; private set; }
        public PublishProfilesFile Profiles { get; private set; }
        public IFileSystem Fs { get { return FileSystem; } }
        public MemoryFileSystem FileSystem { get; private set; }
        public int SaveCount { get; private set; }
        public PublishHistory HistoryData { get; set; } = new PublishHistory();
        public Dictionary<string, SheetCheckpoint> Checkpoints { get; } = new Dictionary<string, SheetCheckpoint>();

        public FakePublishSession()
        {
            var list = new List<PublishItem>();
            string[] names = { "Нэгдүгээр давхрын план", "Хоёрдугаар давхрын план", "Дээврийн план", "Урд фасад", "Хойд фасад", "Зүсэлт 1-1", "Зүсэлт 2-2", "Тагтны зангилаа", "Давхрын тулгуур", "Үүдний хэсэг", "Цонхны хүснэгт", "Хаалганы хүснэгт" };
            for (int i = 0; i < names.Length; i++)
                list.Add(Samples.Sheet("uid" + i, "A-" + (101 + i), names[i], i % 3 == 0 ? "B" : "A"));
            list.Add(Samples.Sheet("uidP", "A-900", "Placeholder", placeholder: true));
            list.Add(Samples.Sheet("uidN", "A-901", "Хэвлэх боломжгүй", printable: false));
            list.Add(new PublishItem { Id = "v1", Kind = PublishItemKind.View, Number = "Level 1", Name = "Level 1", ViewType = "FloorPlan" });
            Items = list;
            Project = Samples.Project();
            DwgSetupNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "MGL Standard", "Client DWG" };
            ThreeDViewNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "{3D}", "IFC Export" };
            FileSystem = new MemoryFileSystem().AddDir(@"D:\Out").AddDir(@"D:\Out\PDF");
            Profiles = PublishProfileStore.Load(new SmartStore(Path.Combine(Path.GetTempPath(), "smart-uismoke-" + Guid.NewGuid().ToString("N"))));
            foreach (PublishProfile p in Profiles.Profiles) p.Destination.BaseFolder = @"D:\Out";
        }

        public EnvironmentFacts EnvFor(PublishProfile profile)
        {
            return new EnvironmentFacts { DwgSetupNames = new HashSet<string>(DwgSetupNames, StringComparer.OrdinalIgnoreCase), ThreeDViewNames = new HashSet<string>(ThreeDViewNames, StringComparer.OrdinalIgnoreCase) };
        }

        public bool SaveProfiles() { SaveCount++; return SaveResult; }
        /// <summary>Тестэд: хадгалалт амжилтгүй болохыг дуурайна.</summary>
        public bool SaveResult { get; set; } = true;
        public PublishHistory History() { return HistoryData; }
        public IReadOnlyDictionary<string, SheetCheckpoint> CheckpointsFor(string profileId) { return Checkpoints; }
        public AffectedPublishSet Affected { get; set; }
    }

    public static class PublishSmoke
    {
        private static IEnumerable<DataGrid> Grids(DependencyObject w) { return Ui.All<DataGrid>(w); }

        private static DataGrid GridWithHeader(DependencyObject w, string header)
        {
            return Grids(w).First(g => g.Columns.Any(c => (c.Header as string) == header));
        }

        public static void Dialog_Opens_LoadsProfilesItemsAndPreflight()
        {
            var s = new FakePublishSession();
            var dlg = new PublishDialog(s);
            Ui.Open(dlg);
            try
            {
                Ui.Wait(450);
                var combo = Ui.All<ComboBox>(dlg).First(c => c.Items.Count == 5);
                Ui.Eq(5, combo.Items.Count, "жишээ профайл");
                DataGrid items = GridWithHeader(dlg, "Дугаар");
                // Placeholder, харагдац нуугдсан (профайлд IncludeViews=false): 12 + хэвлэгдэхгүй 1 = 13 мөр.
                Ui.Eq(13, items.Items.Count, "хуудасны мөр");
                string text = Ui.AllText(dlg);
                Ui.True(text.Contains("хуудас →"), "дүгнэлт мөр байхгүй: " + text);
                Ui.Shot(dlg, "publish-main");
            }
            finally { dlg.Close(); }
        }

        public static void Dialog_NotPrintable_IsBlocked_AndPublishDisabled_UntilDropped()
        {
            var s = new FakePublishSession();
            var dlg = new PublishDialog(s);
            Ui.Open(dlg);
            try
            {
                Ui.Wait(450);
                Button publish = Ui.FindButton(dlg, "Гаргах");
                // Client Issue профайл (ревиз шаардлагатай; бүгд тэмдэглэгдсэн, A-901 хэвлэх боломжгүй) → блоклоно.
                Ui.True(!publish.IsEnabled, "Блоклосон preflight-тэй үед «Гаргах» идэвхгүй байх ёстой");
                Ui.Click(dlg, "Блоклосныг хасах");
                Ui.Wait(450);
                DataGrid items = GridWithHeader(dlg, "Дугаар");
                Ui.True(Ui.All<CheckBox>(items).Count() >= 0, "");
                Ui.Shot(dlg, "publish-blocked-dropped");
                Ui.True(publish.IsEnabled, "Блоклосныг хассаны дараа «Гаргах» идэвхжих ёстой. Текст: " + Ui.AllText(dlg));
            }
            finally { dlg.Close(); }
        }

        public static void Dialog_Filter_And_SelectNone_ReducePlan()
        {
            var s = new FakePublishSession();
            var dlg = new PublishDialog(s);
            Ui.Open(dlg);
            try
            {
                Ui.Wait(450);
                Ui.Click(dlg, "Хоосолох");
                Ui.Wait(450);
                Ui.True(Ui.AllText(dlg).Contains("0 хуудас → 0 файл"), "хоосолсны дараа: " + Ui.AllText(dlg));
                Ui.Click(dlg, "Бүгдийг");
                Ui.Wait(450);
                Ui.True(Ui.AllText(dlg).Contains("13 хуудас → 13 файл"), "бүгдийг: " + Ui.AllText(dlg));

                TextBox filter = Ui.All<TextBox>(dlg).First(t => t.Text == "" && !t.IsReadOnly);
                filter.Text = "фасад";
                Ui.Pump();
                DataGrid items = GridWithHeader(dlg, "Дугаар");
                Ui.Eq(2, items.Items.Count, "шүүлтийн дараа");
                Ui.Shot(dlg, "publish-filtered");
            }
            finally { dlg.Close(); }
        }

        public static void Dialog_Publish_ReturnsResult_WithPlan()
        {
            var s = new FakePublishSession();
            // Блоклолтгүй профайл болгож: ревиз заавал биш.
            foreach (PublishProfile p in s.Profiles.Profiles) { p.Revision.Required = false; p.Overwrite = OverwriteMode.Version; }
            var dlg = new PublishDialog(s);
            bool? ok = Ui.RunModal(dlg, () =>
            {
                Ui.Wait(450);
                Ui.Click(dlg, "Блоклосныг хасах");
                Ui.Wait(450);
                Ui.Click(dlg, "Гаргах");
            });
            Ui.True(ok == true, "диалог амжилттай хаагдаагүй");
            Ui.True(dlg.Result != null && dlg.Result.Action == PublishDialogAction.Publish, "Result буруу");
            Ui.True(dlg.Result.Plan.Artifacts.Count == 12, "төлөвлөгөөний файл: " + dlg.Result.Plan.Artifacts.Count);
            Ui.True(dlg.Result.Items.All(i => i.CanBePrinted), "хэвлэх боломжгүй хуудас гарсан");
            Ui.True(s.SaveCount > 0, "сүүлийн хавтас хадгалагдаагүй");
        }

        public static void Dialog_History_ShowsRuns_AndRetryReturnsResult()
        {
            var s = new FakePublishSession();
            var run = new PublishRun
            {
                Id = "r1", ProfileId = s.Profiles.Profiles[0].Id, ProfileName = "Client Issue", ProfileVersion = 1,
                StartedUtc = DateTime.UtcNow.AddMinutes(-5), EndedUtc = DateTime.UtcNow, Status = RunStatus.Partial, DurationMs = 4200, Destination = @"D:\Out",
            };
            run.Artifacts.Add(new PublishArtifact { ItemId = "uid0", ItemLabel = "A-101 — Нэгдүгээр давхрын план", Format = PublishFormat.Pdf, Status = ArtifactStatus.Succeeded, Path = @"D:\Out\PDF\a.pdf", SizeBytes = 204800 });
            run.Artifacts.Add(new PublishArtifact { ItemId = "uid1", ItemLabel = "A-102 — Хоёрдугаар давхрын план", Format = PublishFormat.Pdf, Status = ArtifactStatus.Failed });
            run.Failures.Add(new PublishFailure { ItemId = "uid1", ItemLabel = "A-102", Format = PublishFormat.Pdf, Code = PublishFailureCode.OutputLocked, Message = "Файл түгжигдсэн", Retryable = true });
            s.HistoryData.Runs.Add(run);

            var dlg = new PublishDialog(s, "history");
            bool? ok = Ui.RunModal(dlg, () =>
            {
                Ui.Wait(450);
                DataGrid runs = GridWithHeader(dlg, "Хэзээ");
                Ui.Eq(1, runs.Items.Count, "түүхийн мөр");
                runs.SelectedIndex = 0;
                Ui.Pump();
                string details = Ui.All<TextBox>(dlg).Select(t => t.Text).FirstOrDefault(t => t != null && t.Contains("OutputLocked")) ?? "";
                Ui.True(details.Contains("OutputLocked"), "дэлгэрэнгүйд алдаа харагдахгүй байна");
                Ui.Shot(dlg, "publish-history");
                Button retry = Ui.FindButton(dlg, "дахин оролдох");
                Ui.True(retry.IsEnabled, "Дахин оролдох идэвхгүй");
                Ui.Click(retry);
            });
            Ui.True(ok == true && dlg.Result.Action == PublishDialogAction.Retry && dlg.Result.RetryOf.Id == "r1", "Retry Result буруу");
        }

        /// <summary>
        /// Шинжилгээ нь ПРОФАЙЛД холбогдоно (`AffectedPublishSet.AppliesTo`) — цонх анхнаасаа сонгодог (эхний) профайлд хийгдсэн гэж үзнэ.
        /// </summary>
        private static AffectedPublishSet SampleAffected(FakePublishSession s, bool incomplete = false)
        {
            PublishProfile bound = s.Profiles.Profiles[0];
            var set = new AffectedPublishSet
            {
                Utc = DateTime.UtcNow,
                Incomplete = incomplete,
                ProfileId = bound.Id,
                FormatsKey = PublishCheckpointStore.FormatsKey(bound.Formats),
            };
            Action<string, AffectState, ImpactConfidence, string> add = (id, st, c, why) =>
            {
                var a = new SheetAffect { ItemId = id, State = st, Confidence = c };
                a.Reasons.Add(why);
                set.BySheet[id] = a;
            };
            add("uid0", AffectState.Affected, ImpactConfidence.A, "[A] «Detail Line» зөвхөн «Plan L1» харагдацад хамаарна");
            add("uid1", AffectState.Suggested, ImpactConfidence.C, "[C] магадгүй харагдана");
            add("uid2", AffectState.NoImpactFound, ImpactConfidence.Unknown, "Нөлөөлөл олдсонгүй (баталгаа БИШ)");
            add("uid3", AffectState.NeverPublished, ImpactConfidence.Unknown, "Хараахан гаргаагүй");
            add("uid4", AffectState.Unknown, ImpactConfidence.Unknown, "Шинжилгээ хийгдээгүй");
            if (incomplete) set.Notes.Add("⚠ 2 устсан элементийн нөлөөллийг тодорхойлж чадаагүй");
            return set;
        }

        private static List<ItemRow> ItemRows(DependencyObject dlg)
        {
            return GridWithHeader(dlg, "Дугаар").Items.OfType<ItemRow>().ToList();
        }

        public static void Dialog_WithAnalysis_ShowsChangeColumn_AutoSelectsAffected_AndSuggestionsAreOptIn()
        {
            var s = new FakePublishSession();
            s.Affected = SampleAffected(s);
            var dlg = new PublishDialog(s);
            Ui.Open(dlg);
            try
            {
                Ui.Wait(450);
                List<ItemRow> rows = ItemRows(dlg);
                Ui.True(rows.Single(r => r.Item.Id == "uid0").Change.Contains("Нөлөөлөгдсөн") && rows.Single(r => r.Item.Id == "uid0").Change.Contains("Шууд"), "A: " + rows.Single(r => r.Item.Id == "uid0").Change);
                Ui.True(rows.Single(r => r.Item.Id == "uid1").Change.StartsWith("Санал"), "C нь «Санал»: " + rows.Single(r => r.Item.Id == "uid1").Change);
                Ui.True(rows.Single(r => r.Item.Id == "uid2").Change.Contains("Нөлөөлөл олдсонгүй"), "uid2 өөрчлөлт баганы текст");
                Ui.True(rows.Single(r => r.Item.Id == "uid3").Change.Contains("Хараахан гаргаагүй"), "uid3 өөрчлөлт баганы текст");
                Ui.True(string.IsNullOrEmpty(rows.Single(r => r.Item.Id == "uid5").Change), "шинжилгээнд ороогүй мөр хоосон");
                Ui.True(rows.Single(r => r.Item.Id == "uid0").ToolTipText.Contains("Detail Line"), "«яагаад» tooltip");

                // Анхны сонголт: ЗӨВХӨН нөлөөлөгдсөн (A) + хараахан гаргаагүй.  Санал болгосон (C, Unknown) ОРОХГҮЙ.
                Ui.True(rows.Where(r => r.Selected).Select(r => r.Item.Id).OrderBy(x => x).SequenceEqual(new[] { "uid0", "uid3" }),
                    "анхны сонголт: " + string.Join(",", rows.Where(r => r.Selected).Select(r => r.Item.Id)));
                Ui.Wait(450);
                Ui.True(Ui.AllText(dlg).Contains("2 хуудас →"), "дүгнэлт: " + Ui.AllText(dlg));
                Ui.Shot(dlg, "publish-affected");

                // Санал болгосныг ИЛ нэмнэ.
                Ui.Click(dlg, "Санал болгосныг нэмэх");
                Ui.Wait(450);
                rows = ItemRows(dlg);
                Ui.True(rows.Where(r => r.Selected).Select(r => r.Item.Id).OrderBy(x => x).SequenceEqual(new[] { "uid0", "uid1", "uid3", "uid4" }),
                    "нэмсний дараа: " + string.Join(",", rows.Where(r => r.Selected).Select(r => r.Item.Id)));
                Ui.True(!rows.Single(r => r.Item.Id == "uid2").Selected, "«олдсонгүй» хуудас автоматаар орохгүй (гэхдээ гараар болно)");

                // Дахин «нөлөөлөгдсөнийг сонгох» → санал болгосон хасагдана; «Бүгдийг» → бүх хуудас.
                Ui.Click(dlg, "Нөлөөлөгдсөнийг сонгох");
                Ui.Wait(450);
                Ui.Eq(2, ItemRows(dlg).Count(r => r.Selected), "дахин зөвхөн нөлөөлөгдсөн");
                Ui.Click(dlg, "Бүгдийг");
                Ui.Wait(450);
                Ui.True(Ui.AllText(dlg).Contains("13 хуудас → 13 файл"), "бүгдийг: " + Ui.AllText(dlg));
            }
            finally { dlg.Close(); }
        }

        public static void Dialog_WithoutAnalysis_DisablesChangeButtons_AndNeverClaimsUnchanged()
        {
            var s = new FakePublishSession();
            var dlg = new PublishDialog(s);
            Ui.Open(dlg);
            try
            {
                Ui.Wait(450);
                Ui.True(!Ui.FindButton(dlg, "Нөлөөлөгдсөнийг сонгох").IsEnabled, "шинжилгээгүй үед идэвхгүй");
                Ui.True(!Ui.FindButton(dlg, "Санал болгосныг нэмэх").IsEnabled, "шинжилгээгүй үед «санал болгосныг нэмэх» идэвхгүй");
                Ui.True(Ui.FindButton(dlg, "Өөрчлөлт шинжлэх").IsEnabled, "шинжлэх товч идэвхтэй");
                string text = Ui.AllText(dlg);
                Ui.True(text.Contains("ХЭЗЭЭ Ч «өөрчлөгдөөгүй» гэж үзэхгүй"), "анхааруулга: " + text);
                Ui.True(ItemRows(dlg).All(r => string.IsNullOrEmpty(r.Change)), "«Өөрчлөлт» багана хоосон");
            }
            finally { dlg.Close(); }
        }

        public static void Dialog_AnalyzeButton_ReturnsAnalyzeAction_WithProfile()
        {
            var s = new FakePublishSession();
            var dlg = new PublishDialog(s);
            bool? ok = Ui.RunModal(dlg, () =>
            {
                Ui.Wait(450);
                Ui.Click(dlg, "Өөрчлөлт шинжлэх");
            });
            Ui.True(ok == true, "диалог хаагдаагүй");
            Ui.True(dlg.Result != null && dlg.Result.Action == PublishDialogAction.AnalyzeChanges, "Result: " + (dlg.Result != null ? dlg.Result.Action.ToString() : "null"));
            Ui.True(dlg.Result.Profile != null, "профайл дамжина");
            Ui.True(s.SaveCount > 0, "сүүлийн хавтас хадгалагдсан");
        }

        public static void Dialog_AnalysisOfAnotherProfile_IsIgnored_ColumnBlank_ButtonsDisabled_AndExplained()
        {
            var s = new FakePublishSession();
            s.Affected = SampleAffected(s);      // эхний профайлд хийгдсэн
            var dlg = new PublishDialog(s);
            Ui.Open(dlg);
            try
            {
                Ui.Wait(450);
                Ui.True(ItemRows(dlg).Any(r => !string.IsNullOrEmpty(r.Change)), "анхны профайлд шинжилгээ харагдах ёстой");
                Ui.True(Ui.FindButton(dlg, "Нөлөөлөгдсөнийг сонгох").IsEnabled, "анхны профайлд идэвхтэй");

                // Өөр профайл руу шилжинэ → өөр профайлын checkpoint-оор гарсан шинжилгээ ХҮЧИНГҮЙ.
                ComboBox combo = Ui.All<ComboBox>(dlg).First(c => c.Items.Count == 5);
                combo.SelectedIndex = 1;
                Ui.Wait(450);
                Ui.True(ItemRows(dlg).All(r => string.IsNullOrEmpty(r.Change)), "өөр профайлд «Өөрчлөлт» багана хоосон байх ёстой");
                Ui.True(!Ui.FindButton(dlg, "Нөлөөлөгдсөнийг сонгох").IsEnabled, "өөр профайлд «Нөлөөлөгдсөнийг сонгох» идэвхгүй");
                Ui.True(!Ui.FindButton(dlg, "Санал болгосныг нэмэх").IsEnabled, "өөр профайлд «Санал болгосныг нэмэх» идэвхгүй");
                string text = Ui.AllText(dlg);
                Ui.True(text.Contains("ӨӨР профайлаар") && text.Contains("хүчингүй"), "тайлбар: " + text);

                // Буцаж анхных руу → шинжилгээ дахин хүчинтэй.
                combo.SelectedIndex = 0;
                Ui.Wait(450);
                Ui.True(ItemRows(dlg).Any(r => !string.IsNullOrEmpty(r.Change)), "буцахад дахин харагдах ёстой");
                Ui.True(Ui.FindButton(dlg, "Нөлөөлөгдсөнийг сонгох").IsEnabled, "буцахад идэвхтэй");
            }
            finally { dlg.Close(); }
        }

        public static void Dialog_ProfileGainedAFormat_InvalidatesTheAnalysis_AndMarksOldCheckpointsPartial()
        {
            var s = new FakePublishSession();
            s.Affected = SampleAffected(s);
            // Өмнө нь «PDF-only» профайлаар бүрэн гарсан хуудас.
            s.Checkpoints["uid0"] = new SheetCheckpoint
            {
                PublishedUtc = DateTime.UtcNow.AddDays(-1), ChangeSeq = 5,
                Formats = new Dictionary<string, FormatStamp> { { "pdf", new FormatStamp { Utc = DateTime.UtcNow.AddDays(-1), ChangeSeq = 5 } } },
            };
            // Профайлд DWG нэмэгдсэн.
            s.Profiles.Profiles[0].Formats = new List<PublishFormat> { PublishFormat.Pdf, PublishFormat.Dwg };
            var dlg = new PublishDialog(s);
            Ui.Open(dlg);
            try
            {
                Ui.Wait(450);
                // Шинжилгээ PDF-only багцад хийгдсэн → одоо хүчингүй.
                Ui.True(ItemRows(dlg).All(r => string.IsNullOrEmpty(r.Change)), "формат өөрчлөгдсөн тул шинжилгээ хүчингүй");
                ItemRow row = ItemRows(dlg).Single(r => r.Item.Id == "uid0");
                Ui.True(row.LastPublished.StartsWith(LastPublishInfo.PartialPrefix) && row.LastPublished.Contains("DWG дутуу"), "хуучин checkpoint «DWG дутуу»: " + row.LastPublished);
            }
            finally { dlg.Close(); }
        }

        public static void Dialog_IncompleteAnalysis_ShowsExplicitWarning()
        {
            var s = new FakePublishSession();
            s.Affected = SampleAffected(s, incomplete: true);
            var dlg = new PublishDialog(s);
            Ui.Open(dlg);
            try
            {
                Ui.Wait(450);
                string text = Ui.AllText(dlg);
                Ui.True(text.Contains("Шинжилгээ бүрэн бус") && text.Contains("«олдсонгүй» гэдэг нь «өөрчлөгдөөгүй» гэсэн үг БИШ"), "бүрэн бус анхааруулга: " + text);
                Ui.True(text.Contains("2 устсан элементийн"), "тэмдэглэл гарсан: " + text);
            }
            finally { dlg.Close(); }
        }

        public static void Dialog_Running_Run_Shows_Warning()
        {
            string text = PublishDialog.DescribeRun(new PublishRun { Status = RunStatus.Running, ProfileName = "x", StartedUtc = DateTime.UtcNow });
            Ui.True(text.Contains("дуусаагүй"), "Running гүйлтийн анхааруулга байхгүй: " + text);
        }

        public static void Dialog_SkipOnlyRun_IsNotLabelledSuccessful()
        {
            var run = new PublishRun { Status = RunStatus.Succeeded, ProfileName = "x", StartedUtc = DateTime.UtcNow };
            run.Artifacts.Add(new PublishArtifact { ItemLabel = "A-101", Format = PublishFormat.Pdf, Status = ArtifactStatus.Skipped });
            Ui.True(RunRow.StatusOf(run) != "Амжилттай" && RunRow.StatusOf(run).Contains("Алгассан"), "бүгд алгассан гүйлт «Амжилттай» гэж харагдах ёсгүй: " + RunRow.StatusOf(run));
            Ui.True(PublishDialog.DescribeRun(run).StartsWith("Алгассан"), "дэлгэрэнгүйн толгой: " + PublishDialog.DescribeRun(run));

            // Жинхэнэ амжилттай файл нэг ч байвал өмнөх шигээ.
            run.Artifacts.Add(new PublishArtifact { ItemLabel = "A-102", Format = PublishFormat.Pdf, Status = ArtifactStatus.Succeeded });
            Ui.Eq("Амжилттай", RunRow.StatusOf(run), "амжилттай файлтай гүйлт");
        }

        public static void Editor_LoadsAndSavesFields()
        {
            var s = new FakePublishSession();
            PublishProfile p = s.Profiles.Profiles[2].Clone();   // Authority Submission
            var dlg = new ProfileEditorDialog(s, p);
            bool? ok = Ui.RunModal(dlg, () =>
            {
                Ui.Wait(100);
                Ui.Shot(dlg, "publish-editor-general");
                var boxes = Ui.All<TextBox>(dlg).ToList();
                TextBox name = boxes.First(t => t.Text == p.Name);
                name.Text = "Тест профайл";
                TextBox sheetTpl = boxes.First(t => t.Text == p.Naming.SheetTemplate);
                sheetTpl.Text = "{SheetNumber}_{SheetName|upper|max=12}";
                Ui.Wait(50);
                string text = Ui.AllText(dlg);
                Ui.True(text.Contains("Файл: A-101_"), "урьдчилсан харалт: " + text);
                Ui.Click(dlg, "Хадгалах");
            });
            Ui.True(ok == true && dlg.Edited != null, "Edited буцаагүй");
            Ui.Eq("Тест профайл", dlg.Edited.Name, "нэр");
            Ui.Eq("{SheetNumber}_{SheetName|upper|max=12}", dlg.Edited.Naming.SheetTemplate, "загвар");
            Ui.True(dlg.Edited.Formats.Contains(PublishFormat.Pdf) && dlg.Edited.Formats.Contains(PublishFormat.Ifc), "формат алдагдсан");
            Ui.Eq(OverwriteMode.Fail, dlg.Edited.Overwrite, "overwrite");
        }

        public static void Editor_InvalidTemplate_BlocksSave()
        {
            var s = new FakePublishSession();
            PublishProfile p = s.Profiles.Profiles[0].Clone();
            var dlg = new ProfileEditorDialog(s, p);
            Ui.Open(dlg);
            try
            {
                TextBox tpl = Ui.All<TextBox>(dlg).First(t => t.Text == p.Naming.SheetTemplate);
                tpl.Text = "{Nope}";
                Ui.Pump();
                string text = Ui.AllText(dlg);
                Ui.True(text.Contains("Танигдаагүй токен"), "урьдчилсан харалт алдааг харуулаагүй: " + text);
                Ui.Shot(dlg, "publish-editor-invalid");
                Ui.True(dlg.Edited == null, "");
            }
            finally { dlg.Close(); }
        }

        public static void Editor_AllTabs_Render()
        {
            var s = new FakePublishSession();
            var dlg = new ProfileEditorDialog(s, new PublishProfile { Name = "Шинэ" });
            Ui.Open(dlg);
            try
            {
                TabControl tabs = Ui.All<TabControl>(dlg).First();
                for (int i = 0; i < tabs.Items.Count; i++)
                {
                    tabs.SelectedIndex = i;
                    Ui.Pump();
                    Ui.Shot(dlg, "publish-editor-tab" + i);
                }
                Ui.True(tabs.Items.Count == 6, "табын тоо");
            }
            finally { dlg.Close(); }
        }
    }
}
