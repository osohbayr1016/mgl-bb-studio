using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    /// <summary>
    /// W09 (2026-10-16): нэг хэрэгсэл интерьер, архитектурт — өрөө тус бүр ЗОРИУЛАЛТТАЙ (Интерьер / Архитектур / Ариун цэврийн өрөө / Тусгай).
    /// Зориулалт = тэмдэглэгээ, тод/бүдэг, түлхүүр план / 3D / рендерийн байр, загвар, хуудасны мета.  «Тусгай» өгөгдмөл = өмнөх зан төлөв ЯГ.
    /// Санал нь тодорхой дүрэм (ариун цэврийн өрөө — нэр эсвэл ≥ 2 сантехник), «Тусгай» үед зөвхөн харагдана.
    /// </summary>
    public static class PresetTests
    {
        // ── Хадгалалт, шилжилт ───────────────────────────────────────

        [Test]
        public static void Preset_round_trips_and_parse_never_throws()
        {
            WePreset p = WePresetCatalog.BuiltIn(WePresetId.Bathroom);
            p.TemplateName = "Interior Elevation 1:50";
            p.Perspectives = 2;
            WePreset r = WePreset.Parse(WePresetId.Bathroom, p.Serialize(), null);
            Assert.True(r.SameAs(p), "буцаж уншина: " + p.Serialize() + " ↔ " + r.Serialize());
            Assert.Eq("Интерьер", r.SheetParams[WeSheetDiscipline.ClassificationParam]);
            foreach (string bad in new[] { null, "", ";;", "fade=Nope;persp=99;keyplan=x;sheet=::|a", "annotations=walls:dim garbage:zz" })
            {
                WePreset b = WePreset.Parse(WePresetId.Architecture, bad, WePresetCatalog.BuiltIn(WePresetId.Architecture));
                Assert.True(b.Perspectives >= 0 && b.Perspectives <= 4, "буруу утга → суурь («" + bad + "»)");
            }
        }

        [Test]
        public static void Settings_keep_presets_and_globals_independent()
        {
            var s = new WeSettings { Annotations = "walls:dim", FadeMode = WeFadeMode.None };
            WePreset bath = s.PresetOf(WePresetId.Bathroom);
            bath.Annotations = "plumbing:dim,plumbing:tag";
            s.SetPreset(bath);
            WeSettings back = WeSettings.Deserialize(s.Serialize());
            Assert.Eq("walls:dim", back.Annotations, "«Тусгай» = ерөнхий утгууд хэвээр");
            Assert.Eq("plumbing:dim,plumbing:tag", back.PresetOf(WePresetId.Bathroom).Annotations, "зориулалт файлд хадгалагдана");
            Assert.Eq("walls:dim", back.PresetOf(WePresetId.Custom).Annotations);
            // «Тусгай»-г SetPreset-ээр засвал ерөнхий утга өөрчлөгдөнө.
            WePreset custom = back.PresetOf(WePresetId.Custom);
            custom.Perspectives = 1;
            back.SetPreset(custom);
            Assert.Eq(1, back.Perspectives);
            Assert.Eq(3, back.PresetOf(WePresetId.Interior).Perspectives, "бусад зориулалт хөндөгдөхгүй");
        }

        [Test]
        public static void Old_file_customisations_flow_into_interior_and_architecture()
        {
            // Зориулалтгүй (өмнөх хувилбарын) файл, хэрэглэгч тэмдэглэгээ ба 3D-г өөрчилсөн.
            const string old = "version=1\nviewKind=Elevation\nannotations=walls:dim,doors:tag\naxon=0\nperspectives=3\n";
            WeSettings s = WeSettings.Deserialize(old);
            foreach (string id in new[] { WePresetId.Interior, WePresetId.Architecture })
            {
                WePreset p = s.PresetOf(id);
                Assert.Eq("walls:dim,doors:tag", p.Annotations, id + ": хэрэглэгчийн тэмдэглэгээ хадгалагдана");
                Assert.False(p.Axon, id + ": хэрэглэгчийн «3D-гүй» хадгалагдана");
            }
            Assert.Eq(WeAnno.Format(WeAnno.Parse(WePresetCatalog.BathroomAnnotations)), s.PresetOf(WePresetId.Bathroom).Annotations, "шинэ зориулалт — суурь утга");
            Assert.Eq(WeFadeMode.AboveCeiling, s.PresetOf(WePresetId.Interior).FadeMode, "өөрчлөөгүй талбар — тухайн зориулалтын суурь утга");
            Assert.Eq(WeFadeMode.None, s.PresetOf(WePresetId.Architecture).FadeMode);

            // Хэрэглэгч өөрчлөөгүй файл → суурь утгууд.
            WeSettings d = WeSettings.Deserialize("version=1\nviewKind=Elevation\nannotations=" + WeAnno.DefaultSet + "\n");
            Assert.Eq(WeAnno.Format(WeAnno.Parse(WePresetCatalog.ArchitectureAnnotations)), d.PresetOf(WePresetId.Architecture).Annotations);
        }

        [Test]
        public static void For_preset_applies_bundle_and_sheet_metadata()
        {
            var s = new WeSettings { TemplateName = "Мой", FixedSheetParams = WeSheetDiscipline.Interior() };
            WeSettings arch = s.ForPreset(WePresetId.Architecture);
            Assert.Eq(WeFadeMode.None, arch.FadeMode);
            Assert.Eq(0, arch.Perspectives);
            Assert.Eq(0, arch.FixedSheetParams.Count, "архитектурын өрөөнд ангиллыг хөндөхгүй");
            Assert.Eq(string.Empty, arch.TemplateName, "зориулалтын загвар (суурь — төрлийн өгөгдмөл)");
            WeSettings custom = s.ForPreset(WePresetId.Custom);
            Assert.Eq("Мой", custom.TemplateName, "«Тусгай» = ерөнхий утгууд");
            Assert.Eq(2, custom.FixedSheetParams.Count, "«Тусгай» товчны хуудасны метаг өвлөнө");
            Assert.Eq("Интерьер", s.ForPreset(WePresetId.Bathroom).FixedSheetParams[WeSheetDiscipline.ClassificationParam]);
        }

        // ── Санал ─────────────────────────────────────────────────────

        [Test]
        public static void Suggests_only_bathrooms_with_a_reason()
        {
            string why;
            Assert.Eq(WePresetId.Bathroom, WePresetSuggester.Suggest("Ариун цэврийн өрөө", "105", null, out why));
            Assert.True(why.Contains("ариун цэврийн"), "шалтгаанд нэрэн доторх бүтэн үг: " + why);
            Assert.Eq(WePresetId.Bathroom, WePresetSuggester.Suggest("Угаалгын өрөө", "", null, out why), "«угаалга» → «угаалгын»");
            Assert.Eq(WePresetId.Bathroom, WePresetSuggester.Suggest("WC-2", "", null, out why));
            Assert.Eq(WePresetId.Bathroom, WePresetSuggester.Suggest("Master Bathroom", "", null, out why));
            Assert.Eq(WePresetId.Bathroom, WePresetSuggester.Suggest("Өрөө", "12", new WeRoomContents { Plumbing = 2 }, out why), "≥ 2 сантехник");
            Assert.True(why.Contains("2 сантехник"), why);
            Assert.Null(WePresetSuggester.Suggest("Гал тогоо", "3", new WeRoomContents { Plumbing = 3 }, out why), "гал тогоо — угаалтуур байсан ч биш");
            Assert.Null(WePresetSuggester.Suggest("Оффис", "201", new WeRoomContents { Furniture = 9 }, out why), "бусад өрөө — санал алга (товчны өгөгдмөл)");
            Assert.Null(WePresetSuggester.Suggest("Newcastle office", "", null, out why), "үгийн ДОТОР «wc» (ne-wc-astle) таарахгүй");
            Assert.Null(WePresetSuggester.Suggest("Өрөө", "1", new WeRoomContents { Plumbing = 1 }, out why), "ганц сантехник — хангалтгүй");
        }

        // ── Төлөвлөгч ────────────────────────────────────────────────

        private const long LevelLow = 1, LevelHigh = 2, Ceiling = 20;

        /// <summary>Хоёр өрөө: 101 «Оффис» (0,0)–(5000,4000), 102 «WC» (6000,0)–(9000,3000) — тус бүр тааз, хоёр сантехник WC-д.</summary>
        private static WeRequest TwoRooms()
        {
            WeRequest a = Fx.SquareRoom(5000, 4000, true, "101");
            WeRequest b = Fx.SquareRoom(3000, 3000, true, "102");
            WeRoomInfo wc = b.Rooms[0];
            wc.Name = "WC";
            // 102-ыг x+6000-д шилжүүлнэ.
            var shift = Fx.P(6000, 0);
            foreach (WeWallInfo w in b.WallLookup.Values) { w.Start = w.Start + shift; w.End = w.End + shift; a.WallLookup[w.UniqueId] = w; }
            foreach (WeRoomLoop l in wc.Loops) foreach (WeBoundarySegment sg in l.Segments) { sg.A = sg.A + shift; sg.B = sg.B + shift; }
            wc.Id = 501;
            a.Rooms.Add(wc);
            WeAnnoSources s = a.Sources;
            s.Levels.Add(new WeLevelInfo { Id = LevelLow, Name = "L01", Z = 0 });
            s.Levels.Add(new WeLevelInfo { Id = LevelHigh, Name = "L02", Z = Fx.Mm(4500) });
            s.Slabs.Add(new WeSlabInfo { Id = Ceiling, Kind = WeSlabKind.Ceiling, Min = Fx.P(0, 0, 2600), Max = Fx.P(9000, 4000, 2620) });
            s.Taggables.Add(new WeTaggable { Id = 70, CategoryKey = "plumbing", Min = Fx.P(6200, 200, 0), Max = Fx.P(6600, 900, 800) });
            s.Taggables.Add(new WeTaggable { Id = 71, CategoryKey = "plumbing", Min = Fx.P(8000, 200, 800), Max = Fx.P(8600, 600, 950) });
            return a;
        }

        private static WePlan Run(WeRequest req, Action<WeSettings> tweak) { return WallElevationPlanner.Plan(req, Fx.Ctx(tweak)); }

        [Test]
        public static void Custom_default_keeps_the_old_behaviour_and_only_shows_the_suggestion()
        {
            WeRequest req = TwoRooms();
            WePlan plan = Run(req, s => { s.Annotations = "walls:dim"; });
            WePlannedElevation wc = plan.Items.First(i => i.RoomNumber == "102");
            Assert.Eq(WePresetId.Custom, wc.PresetId, "«Тусгай» өгөгдмөл — саналыг автоматаар хэрэглэхгүй");
            Assert.Eq(WePresetId.Bathroom, wc.SuggestedPreset, "санал харагдана");
            Assert.True(wc.SuggestedReason.Contains("wc"), wc.SuggestedReason);
            Assert.True(plan.Items.All(i => i.Annotation.Tags.Count == 0), "бүх өрөөнд хэрэглэгчийн хүснэгт (шошгогүй)");
        }

        [Test]
        public static void Interior_default_applies_the_bathroom_suggestion_per_room()
        {
            WeRequest req = TwoRooms();
            WePlan plan = Run(req, s => { s.DefaultPreset = WePresetId.Interior; });
            WePlannedElevation office = plan.Items.First(i => i.RoomNumber == "101"), wc = plan.Items.First(i => i.RoomNumber == "102");
            Assert.Eq(WePresetId.Interior, office.PresetId);
            Assert.Eq(WePresetSource.Default, office.PresetSource);
            Assert.Eq(WePresetId.Bathroom, wc.PresetId, "ариун цэврийн өрөө — өөрийн зориулалт");
            Assert.Eq(WePresetSource.Suggested, wc.PresetSource);
            // Холимог багц: нэг хүснэгт хоёр өрөөнд хүчлэгдэхгүй — WC-д сантехникийн хэмжээс, оффист байхгүй (оффист сантехник ч алга).
            Assert.True(plan.Items.Where(i => i.RoomNumber == "102").Any(i => i.Annotation.Rows.Any(r => r.Group == WeDimGroup.Elements || r.Group == WeDimGroup.Combined)
                                                                           || i.Annotation.Tags.Any(t => t.CategoryKey == "plumbing")),
                "WC-д сантехникийн хэмжээс/шошго");
        }

        [Test]
        public static void Chosen_and_stored_presets_win_in_order()
        {
            WeRequest req = TwoRooms();
            string officeUid = req.Rooms[0].UniqueId;
            WePlan chosen = Run(req, s => { s.DefaultPreset = WePresetId.Interior; s.RoomPresets[officeUid] = WePresetId.Architecture; });
            WePlannedElevation office = chosen.Items.First(i => i.RoomNumber == "101");
            Assert.Eq(WePresetId.Architecture, office.PresetId);
            Assert.Eq(WePresetSource.Chosen, office.PresetSource);

            // Үүсгэсэн харагдац дээр хадгалсан зориулалт — дараагийн ажиллуулалт (ямар ч товчоор) сэргэнэ.
            foreach (WeExistingView e in Fx.AsExisting(chosen))
            {
                e.Preset = chosen.Items.Single(i => i.Key == e.Key).PresetId;
                req.Existing.Add(e);
            }
            WePlan again = Run(req, s => { });
            WePlannedElevation officeAgain = again.Items.First(i => i.RoomNumber == "101");
            Assert.Eq(WePresetId.Architecture, officeAgain.PresetId, "харагдац дээрх зориулалт");
            Assert.Eq(WePresetSource.Stored, officeAgain.PresetSource);
        }

        [Test]
        public static void Key_plan_3d_and_fade_follow_each_rooms_preset()
        {
            WeRequest req = TwoRooms();
            string officeUid = req.Rooms[0].UniqueId;
            WePlan plan = Run(req, s =>
            {
                s.Output = WeOutputMode.ViewsAndSheets;
                s.DefaultPreset = WePresetId.Interior;
                WePreset arch = s.PresetOf(WePresetId.Architecture);
                arch.Axon = false;
                s.SetPreset(arch);
                s.RoomPresets[officeUid] = WePresetId.Architecture;
            });
            WeGroupInfo office = plan.Groups.Single(g => g.RoomNumber == "101"), wc = plan.Groups.Single(g => g.RoomNumber == "102");
            Assert.Null(office.Axon, "архитектурын өрөө — 3D-гүй (зориулалтаар)");
            Assert.NotNull(office.KeyPlan);
            Assert.NotNull(wc.Axon, "ариун цэврийн өрөө — 3D-тэй");
            Assert.Eq(WePresetId.Architecture, office.PresetId);
            Assert.True(plan.Items.Where(i => i.RoomNumber == "101").All(i => double.IsNaN(i.Annotation.FadeFromY)), "архитектур — бүдэгрүүлэхгүй");
            Assert.True(plan.Items.Where(i => i.RoomNumber == "102").Any(i => !double.IsNaN(i.Annotation.FadeFromY)), "ариун цэврийн өрөө — тааз хүртэл тод");
        }
    }
}
