using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    /// <summary>
    /// Тэмдэглэгээний төлөвлөгч — эзний дүрэм (2026-10-06): хаалганд зөвхөн дээд spot; цонхонд доод + дээд; таазны доод spot;
    /// босоо 1-р эгнээ = шалны доод · шалны дээд · таазны доод · дээд хучилтын доод; 2-р эгнээ = давхар хоорондын.
    /// </summary>
    public static class AnnotationTests
    {
        private const long LevelLow = 1, LevelHigh = 2;
        private const long FloorFinish = 10, FloorSlab = 11, UpperFinish = 12, UpperSlab = 13;
        private const long Ceiling = 20, NeighbourCeiling = 21, Door = 30, Window = 31, Chair = 40;

        /// <summary>5000×4000 өрөө + шал (100 өнгөлгөө + 200 хавтан), тааз 2750, дээд давхар 4500 (хавтан 4200–4400), хаалга, цонх.</summary>
        private static WeRequest Scene(Action<WeAnnoSources> tweak = null)
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            WeAnnoSources s = req.Sources;
            s.Levels.Add(new WeLevelInfo { Id = LevelLow, Name = "L01", Z = 0 });
            s.Levels.Add(new WeLevelInfo { Id = LevelHigh, Name = "L02", Z = Fx.Mm(4500) });
            s.Slabs.Add(Slab(FloorFinish, WeSlabKind.Floor, 0, 0, 5000, 4000, -100, 0));
            s.Slabs.Add(Slab(FloorSlab, WeSlabKind.Floor, 0, 0, 5000, 4000, -300, -100));
            s.Slabs.Add(Slab(UpperFinish, WeSlabKind.Floor, 0, 0, 5000, 4000, 4400, 4500));
            s.Slabs.Add(Slab(UpperSlab, WeSlabKind.Floor, 0, 0, 5000, 4000, 4200, 4400));
            s.Slabs.Add(Slab(Ceiling, WeSlabKind.Ceiling, 0, 0, 5000, 4000, 2750, 2770));
            // Зүүн талын хөрш өрөөний тааз (ханын цаана) — энэ өрөөний дэлгээст ОРОХГҮЙ.
            s.Slabs.Add(Slab(NeighbourCeiling, WeSlabKind.Ceiling, 5200, 0, 9000, 4000, 2400, 2420));
            WeWallInfo south = Wall(req, 0), east = Wall(req, 1);
            s.Inserts.Add(new WeInsertInfo { Id = Door, Kind = WeInsertKind.Door, HostWallUid = south.UniqueId, Center = Fx.P(1500, 0), HalfWidth = Fx.Mm(450), BottomZ = 0, TopZ = Fx.Mm(2100) });
            s.Inserts.Add(new WeInsertInfo { Id = Window, Kind = WeInsertKind.Window, HostWallUid = east.UniqueId, Center = Fx.P(5000, 2000), HalfWidth = Fx.Mm(600), BottomZ = Fx.Mm(900), TopZ = Fx.Mm(2100) });
            s.Taggables.Add(new WeTaggable { Id = Chair, CategoryKey = "furniture", Min = Fx.P(2000, 3500, 0), Max = Fx.P(2500, 3900, 900) });
            if (tweak != null) tweak(s);
            return req;
        }

        private static WeSlabInfo Slab(long id, WeSlabKind kind, double x0, double y0, double x1, double y1, double z0, double z1)
        {
            return new WeSlabInfo { Id = id, Kind = kind, Min = Fx.P(x0, y0, z0), Max = Fx.P(x1, y1, z1) };
        }

        /// <summary>0 = урд (south), 1 = зүүн (east), 2 = хойд, 3 = баруун хана.</summary>
        private static WeWallInfo Wall(WeRequest req, int i)
        {
            return req.WallLookup[req.Rooms[0].Loops[0].Segments[i].WallUniqueId];
        }

        private static WePlannedElevation Face(WePlan plan, WeRequest req, int wall)
        {
            string uid = Wall(req, wall).UniqueId;
            return plan.Items.Single(i => i.WallUid == uid);
        }

        private static WePlan Run(WeRequest req, Action<WeSettings> tweak = null)
        {
            return WallElevationPlanner.Plan(req, Fx.Ctx(tweak));
        }

        private static double Mm(double ft) { return Math.Round(ft * WeFixedUnits.MmPerFoot, 1); }

        [Test]
        public static void Vertical_rows_follow_the_owner_rule()
        {
            WeRequest req = Scene();
            WePlannedElevation south = Face(Run(req), req, 0);
            List<WeDimRow> vertical = south.Annotation.Rows.Where(r => r.Vertical).OrderBy(r => r.At).ToList();
            Assert.Eq(2, vertical.Count, "босоо хоёр эгнээ");

            WeDimRow r1 = vertical[0];
            Assert.SeqEq(new[] { WeRefKind.FloorBottom, WeRefKind.FloorTop, WeRefKind.CeilingBottom, WeRefKind.SlabBottom }, r1.Refs.Select(r => r.Kind),
                "1-р эгнээ: шалны доод · шалны дээд · таазны доод · дээд хучилтын доод");
            Assert.SeqEq(new[] { -100.0, 0, 2750, 4200 }, r1.Refs.Select(r => Mm(r.Pos)));
            Assert.SeqEq(new[] { FloorFinish, FloorFinish, Ceiling, UpperSlab }, r1.Refs.Select(r => r.ElementId),
                "шалны зузаан = ӨНГӨЛГӨӨНИЙ (хамгийн дээд) шалных; дээд хучилт = хамгийн доод хавтан");

            WeDimRow r2 = vertical[1];
            Assert.SeqEq(new[] { WeRefKind.Level, WeRefKind.Level }, r2.Refs.Select(r => r.Kind));
            Assert.SeqEq(new[] { LevelLow, LevelHigh }, r2.Refs.Select(r => r.ElementId), "2-р эгнээ: давхар хоорондын");
            Assert.True(r1.At > south.Box.MaxX && r2.At > r1.At, "босоо эгнээ хүрээний баруун талд, 2-р нь гадна");
            // 2026-10-14 (интерьерийн баг): зай ЗАГВАРЫН мм — хүрээнээс 300, дараагийнх нь өмнөхөөсөө +300 (масштабаас үл хамаарна).
            Assert.True(Math.Abs(Mm(r1.At - south.Box.MaxX) - 300) < 0.2, "1-р эгнээ хүрээнээс 300 мм: " + Mm(r1.At - south.Box.MaxX));
            Assert.True(Math.Abs(Mm(r2.At - r1.At) - 300) < 0.2, "2-р эгнээ өмнөхөөсөө +300 мм: " + Mm(r2.At - r1.At));
        }

        [Test]
        public static void Crop_is_extended_to_show_the_upper_level()
        {
            WeRequest req = Scene();
            WePlannedElevation south = Face(Run(req), req, 0);
            // WE-BUG-001 (2026-10-13): дээд түвшин хүрээний ЯГ дээд хил дээр — түвшин, «давхар хоорондын» хэмжээс харагдана (Revit 2024/2027
            // live хэмжсэн), харин түүнээс ДЭЭШ (өмнө нь +100 мм) дээд айлын шал, тавилга орж ирдэг байсан тул сунгахгүй.
            Assert.True(Math.Abs(south.Box.MaxY - Fx.Mm(4500)) < Fx.Mm(0.5), "дээд түвшин (4500) хүрээний дээд хил — бодит " + Mm(south.Box.MaxY));
            Assert.True(south.Box.MinY <= Fx.Mm(-200), "шалны доод ирмэг хүрээнд");

            WePlannedElevation without = Face(Run(req, s => s.Annotations = string.Empty), req, 0);
            // Өрөөний дэлгээсийн босоо зай ≤ 150 мм (2026-10-08, жишиг 145 мм).
            Assert.Eq(Mm(Fx.Mm(2800 + 150)), Mm(without.Box.MaxY), "тэмдэглэгээгүй бол хуучин хүрээ");
        }

        [Test]
        public static void Horizontal_chain_has_wall_ends_and_door_jambs_plus_overall()
        {
            WeRequest req = Scene();
            WePlannedElevation south = Face(Run(req), req, 0);
            List<WeDimRow> rows = south.Annotation.Rows.Where(r => !r.Vertical).OrderByDescending(r => r.At).ToList();
            Assert.Eq(2, rows.Count, "гинж + нийт");
            Assert.SeqEq(new[] { WeRefKind.FaceStart, WeRefKind.InsertLeft, WeRefKind.InsertRight, WeRefKind.FaceEnd }, rows[0].Refs.Select(r => r.Kind));
            // Урагш (−Y) харахад баруун = −X: хаалганы төв (x=1500) дотоод +1000.
            Assert.SeqEq(new[] { -2500.0, 550, 1450, 2500 }, rows[0].Refs.Select(r => Mm(r.Pos)));
            Assert.SeqEq(new[] { WeRefKind.FaceStart, WeRefKind.FaceEnd }, rows[1].Refs.Select(r => r.Kind));
            Assert.True(rows[0].At < south.Box.MinY && rows[1].At < rows[0].At, "хэвтээ эгнээ хүрээний доор");
        }

        [Test]
        public static void Door_gets_only_top_spot_window_gets_both()
        {
            WeRequest req = Scene();
            WePlan plan = Run(req);
            WePlannedElevation south = Face(plan, req, 0), east = Face(plan, req, 1);
            List<WeSpot> doorSpots = south.Annotation.Spots.Where(sp => sp.Target.ElementId == Door).ToList();
            Assert.Eq(1, doorSpots.Count, "хаалганд ЗӨВХӨН дээд ирмэг");
            Assert.Eq(WeRefKind.InsertTop, doorSpots[0].Target.Kind);
            Assert.Eq(2100.0, Mm(doorSpots[0].Y));
            Assert.SeqEq(new[] { WeRefKind.InsertBottom, WeRefKind.InsertTop },
                east.Annotation.Spots.Where(sp => sp.Target.ElementId == Window).Select(sp => sp.Target.Kind), "цонх: доод + дээд");
        }

        [Test]
        public static void Ceiling_spot_has_leader_to_the_left_outside_the_crop()
        {
            WeRequest req = Scene();
            WePlannedElevation south = Face(Run(req), req, 0);
            WeSpot c = south.Annotation.Spots.Single(sp => sp.Target.Kind == WeRefKind.CeilingBottom);
            Assert.Eq(Ceiling, c.Target.ElementId);
            Assert.Eq(2750.0, Mm(c.Y));
            Assert.True(c.Leader && c.EndX < south.Box.MinX, "тэмдэг хүрээний гадна зүүн талд");
            Assert.True(c.Depth < 0, "цэг өрөөний талд (тааз тэнд)");
        }

        [Test]
        public static void Floor_spot_is_on_the_finish_top_with_leader_to_the_left()
        {
            // Жишээ хуудас 206A-G: зүүн талд «0,00» — шалны дээд (давхраас харьцангуй — Revit давхарга төрлийг тохируулна).
            WeRequest req = Scene();
            WePlannedElevation south = Face(Run(req), req, 0);
            WeSpot f = south.Annotation.Spots.Single(sp => sp.Target.Kind == WeRefKind.FloorTop);
            Assert.Eq(FloorFinish, f.Target.ElementId, "шалны өнгөлгөөний дээд нүүр (хучилтын биш)");
            Assert.Eq(0.0, Mm(f.Y));
            Assert.True(f.Leader && f.EndX < south.Box.MinX, "тэмдэг хүрээний гадна зүүн талд");
            Assert.True(f.X > -2500 / WeFixedUnits.MmPerFoot && f.X < 0, "цэг гадаргуугийн зүүн хагаст");
            WePlannedElevation off = Face(Run(req, x => x.Annotations = "walls:dim,ceilings:spot"), req, 0);
            Assert.False(off.Annotation.Spots.Any(sp => sp.Target.Kind == WeRefKind.FloorTop), "унтраавал шалны spot алга");
        }

        [Test]
        public static void Old_default_annotation_set_is_upgraded_custom_set_is_kept()
        {
            var old = new WeSettings { Annotations = WeAnno.PreviousDefaultSet };
            Assert.True(WeSettings.Deserialize(old.Serialize()).Annotate(WeAnno.Floors, WeAnno.Spot), "хуучин өгөгдмөл → шалны spot нэмэгдэнэ");
            var custom = new WeSettings { Annotations = "doors:spot,walls:dim" };
            WeSettings r = WeSettings.Deserialize(custom.Serialize());
            Assert.False(r.Annotate(WeAnno.Floors, WeAnno.Spot), "хэрэглэгчийн өөрчилсөн сонголт хэвээр");
            Assert.True(new WeSettings().Annotate(WeAnno.Floors, WeAnno.Spot), "шинэ өгөгдмөлд шалны spot");
        }

        [Test]
        public static void Neighbour_room_ceiling_behind_the_wall_is_ignored()
        {
            WeRequest req = Scene();
            WePlannedElevation east = Face(Run(req), req, 1);
            Assert.False(east.Annotation.Rows.SelectMany(r => r.Refs).Any(r => r.ElementId == NeighbourCeiling), "хөрш өрөөний тааз хэмжээст орохгүй");
            Assert.False(east.Annotation.Spots.Any(sp => sp.Target.ElementId == NeighbourCeiling), "хөрш өрөөний таазанд spot тавихгүй");
        }

        [Test]
        public static void User_choices_switch_each_part_off()
        {
            WeRequest req = Scene();
            WePlannedElevation onlyLevels = Face(Run(req, s => s.Annotations = "levels:dim"), req, 0);
            Assert.Eq(1, onlyLevels.Annotation.Rows.Count, "зөвхөн давхар хоорондын");
            Assert.Eq(0, onlyLevels.Annotation.Spots.Count);
            Assert.Eq(0, onlyLevels.Annotation.Tags.Count);

            WePlannedElevation noDoor = Face(Run(req, s => s.Annotations = "walls:dim,ceilings:spot"), req, 0);
            Assert.SeqEq(new[] { WeRefKind.FaceStart, WeRefKind.FaceEnd }, noDoor.Annotation.Rows.Single().Refs.Select(r => r.Kind),
                "хаалганы хэмжээс унтраалттай — нүхгүй тул нийт эгнээ ч давхардахгүй");
            Assert.Eq(WeRefKind.CeilingBottom, noDoor.Annotation.Spots.Single().Target.Kind);
        }

        [Test]
        public static void Missing_upper_level_is_reported_not_guessed()
        {
            WeRequest req = Scene(s => s.Levels.RemoveAll(l => l.Id == LevelHigh));
            WePlannedElevation south = Face(Run(req), req, 0);
            Assert.False(south.Annotation.Rows.Any(r => r.Refs.Any(x => x.Kind == WeRefKind.Level)), "дээд түвшингүй бол давхар хоорондын хэмжээсгүй");
            Assert.True(south.Annotation.Notes.Any(n => n.Contains("Дээд давхрын түвшин")), "шалтгааныг хэлнэ");
        }

        [Test]
        public static void Tags_and_keynotes_go_where_the_user_asked()
        {
            WeRequest req = Scene();
            WePlannedElevation south = Face(Run(req), req, 0);
            WeTagItem door = south.Annotation.Tags.Single();
            Assert.Eq(Door, door.ElementId, "өгөгдмөл: хаалга, цонхны шошго");
            Assert.False(door.Keynote || door.Leader);

            WePlannedElevation north = Face(Run(req, s => s.Annotations = "furniture:tag,walls:keynote"), req, 2);
            Assert.True(north.Annotation.Tags.Any(t => t.ElementId == Chair && !t.Keynote), "тавилгын шошго");
            WeTagItem k = north.Annotation.Tags.Single(t => t.Keynote);
            Assert.Eq(Wall(req, 2).Id, k.ElementId, "ханын keynote");
            Assert.True(k.Leader && k.HeadY > north.Box.MaxY, "keynote хүрээний дээр, leader-тэй");

            WePlannedElevation southChair = Face(Run(req, s => s.Annotations = "furniture:tag"), req, 0);
            Assert.Eq(0, southChair.Annotation.Tags.Count, "урд хананы дэлгээст хойд хананы сандал орохгүй");
        }

        [Test]
        public static void Furniture_above_the_ceiling_is_not_tagged()
        {
            // ХЭМЖСЭН MAX ӨРГӨӨ 153 (2026-10-13): трибуны доорх АЦӨ — трибун дээрх суудал таазны ДЭЭР, дэлгээсийн хүрээнд багтдаг.
            // Тааз 2750; хойд ханын дэргэд: доор сандал (Chair, 0–900), таазны дээр «трибуны суудал» (3000–3600) → зөвхөн доорх нь.
            const long TribuneSeat = 41;
            WeRequest req = Scene(s => s.Taggables.Add(new WeTaggable { Id = TribuneSeat, CategoryKey = "furniture", Min = Fx.P(3000, 3500, 3000), Max = Fx.P(3500, 3900, 3600) }));
            WePlannedElevation north = Face(Run(req, s => s.Annotations = "furniture:tag"), req, 2);
            Assert.True(north.Annotation.Tags.Any(t => t.ElementId == Chair), "таазны доорх сандал шошготой");
            Assert.False(north.Annotation.Tags.Any(t => t.ElementId == TribuneSeat), "таазны дээрх суудал шошгогүй");

            // Тааз байхгүй өрөө: дээд хучилтын (4200) доор, хүрээ дотор (2000–2600) бол хэвээр шошголно.
            WeRequest open = Scene(s =>
            {
                s.Slabs.RemoveAll(x => x.Kind == WeSlabKind.Ceiling);
                s.Taggables.Add(new WeTaggable { Id = TribuneSeat, CategoryKey = "furniture", Min = Fx.P(3000, 3500, 2000), Max = Fx.P(3500, 3900, 2600) });
            });
            WePlannedElevation northOpen = Face(Run(open, s => s.Annotations = "furniture:tag"), open, 2);
            Assert.True(northOpen.Annotation.Tags.Any(t => t.ElementId == TribuneSeat), "тааздгүй өрөөнд хучилтын доорх элемент шошготой");
        }

        [Test]
        public static void Room_under_a_tribune_or_stair_is_cut_at_the_ceiling()
        {
            // Эзний шийдвэр (2026-10-14): трибун/шатны доорх өрөө (MAX ӨРГӨӨ 153) — хүрээ таазаар; энгийн өрөө дээд түвшин хүртэл хэвээр.
            const long TribuneSeat = 41, Stair = 42;
            WeRequest req = Scene(s => s.Taggables.Add(new WeTaggable { Id = TribuneSeat, CategoryKey = "furniture", Min = Fx.P(3000, 3500, 3000), Max = Fx.P(3500, 3900, 3600) }));
            WePlan plan = Run(req);
            WePlannedElevation north = Face(plan, req, 2), south = Face(plan, req, 0);
            Assert.True(Math.Abs(north.Box.MaxY - Fx.Mm(2770 + 50)) < Fx.Mm(0.5), "хойд дэлгээс таазны дээд нүүр + 50 — бодит " + Mm(north.Box.MaxY));
            Assert.False(north.Annotation.Rows.Any(r => r.Group == WeDimGroup.Vertical2), "давхар хоорондын эгнээгүй");
            Assert.False(north.Annotation.Rows.SelectMany(r => r.Refs).Any(r => r.Pos > north.Box.MaxY + 1e-6), "хүрээнээс дээш лавлагаа алга");
            Assert.True(north.Annotation.Notes.Any(n => n.Contains("таазаар таслав")), "тэмдэглэлд шалтгаантай");
            Assert.True(Math.Abs(south.Box.MaxY - Fx.Mm(4500)) < Fx.Mm(0.5), "суудал урд талын өмнө биш — хэвээр " + Mm(south.Box.MaxY));

            // Шат (link-д): шалнаас дээд түвшин хүртэл, хойд ханын дэргэд.
            WeRequest st = Scene(s => s.Overheads.Add(new WeTaggable { Id = Stair, CategoryKey = "stairs", Min = Fx.P(500, 3000, 0), Max = Fx.P(4500, 3900, 4400) }));
            Assert.True(Math.Abs(Face(Run(st), st, 2).Box.MaxY - Fx.Mm(2820)) < Fx.Mm(0.5), "шатны доорх өрөө таазаар");
            // Нойтон өрөөний 200 мм-ээр доошлуулсан дээд хавтан — трибун биш, тасрахгүй.
            WeRequest wet = Scene(s => s.Slabs.Add(Slab(77, WeSlabKind.Floor, 0, 0, 5000, 4000, 4100, 4300)));
            Assert.True(Math.Abs(Face(Run(wet), wet, 2).Box.MaxY - Fx.Mm(4500)) < Fx.Mm(0.5), "доошлуулсан хавтан — тасрахгүй");
            // Таазны дээрх тавцан (шал, 3000–3200).
            WeRequest deck = Scene(s => s.Slabs.Add(Slab(78, WeSlabKind.Floor, 0, 2500, 5000, 4000, 3000, 3200)));
            Assert.True(Math.Abs(Face(Run(deck), deck, 2).Box.MaxY - Fx.Mm(2820)) < Fx.Mm(0.5), "таазны дээрх тавцан — таазаар");
        }

        [Test]
        public static void Wall_keynote_avoids_openings_and_grid_lines()
        {
            // Урд ханын хамгийн урт чөлөөт хэсэг (хаалганаас баруун тийш x 1950–5000, төв 3475) дээр тэнхлэг x=3500.
            WeRequest req = Scene(s => s.Grids.Add(new WeGridInfo { Id = 52, Name = "F", A = Fx.P(3500, -3000), B = Fx.P(3500, 9000) }));
            WePlannedElevation south = Face(Run(req, s => s.Annotations = "walls:keynote"), req, 0);
            WeTagItem k = south.Annotation.Tags.Single(t => t.Keynote);
            double gridX = 2500 - 3500;   // урагш харахад баруун = −X, өрөөний төв x = 2500
            double doorLo = 2500 - 1950, doorHi = 2500 - 1050;
            Assert.True(Math.Abs(Mm(k.HeadX) - gridX) >= 6 * 50 - 1, "keynote-ийн leader тэнхлэгийн шугамаас ≥ 6 мм (цаас) зайтай — " + Mm(k.HeadX));
            Assert.True(Mm(k.HeadX) < doorLo || Mm(k.HeadX) > doorHi, "keynote хаалган дээр биш");
            Assert.True(Math.Abs(k.HeadX - k.AnchorX) < 1e-9, "leader босоо");
        }

        [Test]
        public static void Close_keynotes_are_staggered()
        {
            WeRequest req = Scene(s =>
            {
                s.Inserts.Add(new WeInsertInfo { Id = 32, Kind = WeInsertKind.Window, HostWallUid = s.Inserts[0].HostWallUid, Center = Fx.P(3000, 0), HalfWidth = Fx.Mm(300), BottomZ = Fx.Mm(900), TopZ = Fx.Mm(1800) });
                s.Inserts.Add(new WeInsertInfo { Id = 33, Kind = WeInsertKind.Window, HostWallUid = s.Inserts[0].HostWallUid, Center = Fx.P(3800, 0), HalfWidth = Fx.Mm(300), BottomZ = Fx.Mm(900), TopZ = Fx.Mm(1800) });
            });
            WePlannedElevation south = Face(Run(req, s => s.Annotations = "windows:keynote"), req, 0);
            List<WeTagItem> k = south.Annotation.Tags.OrderBy(t => t.HeadX).ToList();
            Assert.Eq(2, k.Count);
            Assert.True(Math.Abs(k[0].HeadY - k[1].HeadY) > Fx.Mm(1), "800 мм зайтай (1:50-д 16 мм) хоёр keynote өөр өндөрт");
        }

        [Test]
        public static void Annotation_change_updates_view_without_moving_it()
        {
            WeRequest req = Scene();
            WePlan first = Run(req);
            req.Existing = Fx.AsExisting(first);
            WePlan same = Run(req);
            Assert.True(same.Items.All(i => i.Action == WeAction.Keep || i.Action == WeAction.Skip), "өөрчлөлтгүй → хэвээр");

            req.Sources.Inserts[0].Center = Fx.P(2000, 0);   // хаалга 500 мм зөөгдөв
            WePlan moved = Run(req);
            WePlannedElevation south = Face(moved, req, 0);
            Assert.Eq(WeAction.Update, south.Action);
            Assert.Eq("Тэмдэглэгээ шинэчлэгдэнэ", south.ActionNote);
            Assert.Eq(WeIdentity.GeometryPart(Face(first, req, 0).Signature), WeIdentity.GeometryPart(south.Signature), "харагдацын геометр хэвээр");
            Assert.True(moved.Items.Where(i => i != south).All(i => i.Action == WeAction.Keep || i.Action == WeAction.Skip), "бусад дэлгээс хөндөгдөхгүй");
        }

        [Test]
        public static void No_annotation_keeps_the_old_signature_shape()
        {
            WeRequest req = Scene();
            // 3-р тойрог (2026-10-14): бүдэг хэсэг, улаан хүрээ ч тэмдэгт ордог — хоёуланг унтраасан үед л хуучин хэлбэр.
            WePlannedElevation south = Face(Run(req, s => { s.Annotations = string.Empty; s.FadeMode = WeFadeMode.None; s.RedFrame = false; }), req, 0);
            Assert.True(south.Annotation.IsEmpty);
            Assert.Eq(string.Empty, WeIdentity.AnnotationPart(south.Signature), "тэмдэглэгээгүй бол тэмдэгт залгахгүй (хуучин харагдац хэвээр)");
            WePlannedElevation decorated = Face(Run(req, s => s.Annotations = string.Empty), req, 0);
            Assert.True(decorated.Annotation.IsEmpty);
            Assert.True(WeIdentity.AnnotationPart(decorated.Signature).Length > 0, "бүдэг хэсэг/хүрээ асаалттай бол тэмдэгт залгана (хуучин дэлгээс дахин ажиллуулахад шинэчлэгдэнэ)");
        }

        [Test]
        public static void Wall_mode_measures_wall_ends_and_its_own_openings()
        {
            WeRequest req = Scene();
            var only = new WeRequest { Sources = req.Sources };
            only.Walls.Add(Wall(req, 0));
            WePlannedElevation ext = WallElevationPlanner.Plan(only, Fx.Ctx()).Items.Single();
            WeDimRow chain = ext.Annotation.Rows.Where(r => !r.Vertical).OrderByDescending(r => r.At).First();
            Assert.SeqEq(new[] { WeRefKind.FaceStart, WeRefKind.InsertLeft, WeRefKind.InsertRight, WeRefKind.FaceEnd }, chain.Refs.Select(r => r.Kind));
            Assert.True(chain.Refs[0].Tol >= Fx.Mm(100), "ханын зах ± хагас зузаан");
            Assert.Eq(0.0, ext.Annotation.Spots.Single(sp => sp.Target.ElementId == Door).Depth, "хана горимд нүхний цэг ханын тэнхлэг дээр");
        }

        /// <summary>
        /// Ариун цэврийн өрөө (эзний жишээ): урд ханын дэлгээст тэнхлэг, сантехник, дундах тусгаарлах хана, тусгай тоног
        /// төхөөрөмжийн зах хоорондын зай хэвтээ гинжид — зөвхөн хэрэглэгчийн сонгосон ангилал.
        /// </summary>
        [Test]
        public static void Bathroom_chain_includes_only_the_chosen_elements()
        {
            WeRequest req = Scene(s =>
            {
                s.Inserts.Clear();
                // Тэнхлэг x=2500 (урд ханыг огтолно); x=4000-д ханатай ПАРАЛЛЕЛЬ тэнхлэг — орохгүй.
                s.Grids.Add(new WeGridInfo { Id = 50, Name = "A1", A = Fx.P(2500, -3000), B = Fx.P(2500, 9000) });
                s.Grids.Add(new WeGridInfo { Id = 51, Name = "B", A = Fx.P(-3000, 1000), B = Fx.P(9000, 1000) });
                // Жорлон урд ханын өмнө (x 600–1000), угаалтуур (x 3200–3800).
                s.Taggables.Add(new WeTaggable { Id = 60, CategoryKey = "plumbing", Min = Fx.P(600, 100, 0), Max = Fx.P(1000, 800, 800) });
                s.Taggables.Add(new WeTaggable { Id = 61, CategoryKey = "plumbing", Min = Fx.P(3200, 100, 800), Max = Fx.P(3800, 600, 950) });
                // Хойд ханын өмнөх угаалтуур — урд ханын дэлгээст орохгүй (харах бүсээс гадна).
                s.Taggables.Add(new WeTaggable { Id = 62, CategoryKey = "plumbing", Min = Fx.P(1000, 3400, 800), Max = Fx.P(1600, 3900, 950) });
                // Тусгаарлах хана (урд ханаас өрөө рүү, x = 1800, зузаан 100).
                s.Taggables.Add(new WeTaggable { Id = 70, CategoryKey = "walls", Min = Fx.P(1750, 0, 0), Max = Fx.P(1850, 1500, 2000),
                    HasLine = true, LineA = Fx.P(1800, 0), LineB = Fx.P(1800, 1500), Width = Fx.Mm(100) });
                s.Taggables.Add(new WeTaggable { Id = 80, CategoryKey = "specialty", Min = Fx.P(4200, 50, 1200), Max = Fx.P(4500, 200, 1500) });
            });
            // Нэг холимог гинжийн горим (2026-10-06-ны зан төлөв хэвээр) — тусдаа эгнээг DimGroupTests шалгана.
            WePlannedElevation all = Face(Run(req, x => { x.Annotations = "walls:dim,grids:dim,plumbing:dim,specialty:dim"; x.DimGrouping = WeDimGrouping.Combined; }), req, 0);
            WeDimRow chain = all.Annotation.Rows.Where(r => !r.Vertical).OrderByDescending(r => r.At).First();
            // Урагш харахад баруун = −X: дотоод x = 2500 − X.
            Assert.SeqEq(new[]
                {
                    "FaceStart -2500", "ElementLeft -2000", "ElementRight -1700", "ElementLeft -1300", "ElementRight -700",
                    "Grid 0", "ElementLeft 650", "ElementRight 750", "ElementLeft 1500", "ElementRight 1900", "FaceEnd 2500",
                },
                chain.Refs.Select(r => r.Kind + " " + Mm(r.Pos)));
            Assert.SeqEq(new long[] { 80, 80, 61, 61, 50, 70, 70, 60, 60 }, chain.Refs.Skip(1).Take(9).Select(r => r.ElementId));
            Assert.True(all.Annotation.Rows.Any(r => !r.Vertical && r.Refs.Count == 2), "нийт урт 2-р эгнээнд");

            WePlannedElevation onlyGrid = Face(Run(req, x => { x.Annotations = "walls:dim,grids:dim"; x.DimGrouping = WeDimGrouping.Combined; }), req, 0);
            Assert.SeqEq(new long[] { 50, 70, 70 },
                onlyGrid.Annotation.Rows.Where(r => !r.Vertical).OrderByDescending(r => r.At).First().Refs.Skip(1).Take(3).Select(r => r.ElementId),
                "сантехник, тоног төхөөрөмж сонгоогүй — зөвхөн тэнхлэг, дундах хана");
        }

        [Test]
        public static void Annotation_settings_round_trip_and_drop_nonsense()
        {
            var s = new WeSettings { Annotations = "doors:spot,levels:tag,foo:dim,walls:keynote,walls:spot", DimTypeName = "Linear 2.5", DimOffsetMm = 450 };
            WeSettings r = WeSettings.Deserialize(s.Serialize());
            Assert.Eq("walls:keynote,doors:spot", WeAnno.Format(WeAnno.Parse(r.Annotations)), "хамааралгүй нүд хаягдана");
            Assert.Eq("Linear 2.5", r.DimTypeName);
            Assert.Eq(450.0, r.DimOffsetMm);
            Assert.Eq(300.0, r.DimStepMm, "өгөгдмөл алхам 300 мм");
            Assert.True(new WeSettings().Annotate(WeAnno.Doors, WeAnno.Spot), "өгөгдмөл: хаалганы spot");
            Assert.False(new WeSettings().Annotate(WeAnno.Walls, WeAnno.Keynote), "өгөгдмөл: keynote унтраалттай");
        }

        [Test]
        public static void Spot_levels_count_from_the_rooms_own_storey_found_by_height()
        {
            // 2026-10-14 (интерьерийн баг): spot level давхраас («0,00»).  Link-ийн өрөөний давхрын нэр host-ынхоос өөр байсан ч суурь
            // = өрөөний өндөр дэх HOST түвшин (нэрээр биш).
            WeRequest req = Scene();
            req.Rooms[0].LevelName = "6-Р ДАВХАР (link)";
            WePlannedElevation south = Face(Run(req), req, 0);
            Assert.True(south.Annotation.Spots.Count > 0, "spot төлөвлөгдсөн");
            Assert.Eq(LevelLow, south.Annotation.BaseLevelId, "суурь = өрөөний давхрын host түвшин");
            Assert.Eq("L01", south.Annotation.BaseLevelName);
            Assert.False(south.Annotation.Notes.Any(n => n.Contains("host загварт түвшин алга")), "түвшин олдсон — тэмдэглэлгүй");

            // Суурь солигдвол тэмдэг өөрчлөгдөнө (хуучин үнэмлэхүй spot-той дэлгээс шинэчлэгдэнэ).
            WeRequest other = Scene(s => s.Levels[0].Id = 777);
            WePlannedElevation south2 = Face(Run(other), other, 0);
            Assert.True(south.Annotation.Digest != south2.Annotation.Digest, "суурийн түвшин тэмдэгт орсон");
        }

        [Test]
        public static void Old_paper_spacing_keys_are_ignored_for_the_300mm_model_rule()
        {
            // 2026-10-14-өөс өмнөх файл: «annoOffsetMm=4», «annoStepMm=5» (цаасны мм) — загварын 300/300 руу шилжинэ.
            WeSettings r = WeSettings.Deserialize("version=1\nviewKind=Elevation\nannoOffsetMm=4\nannoStepMm=5\n");
            Assert.Eq(300.0, r.DimOffsetMm);
            Assert.Eq(300.0, r.DimStepMm);
            Assert.Eq(0, new WeSettings().Validate().Count, "өгөгдмөл тохиргоо зөв");
            Assert.True(new WeSettings { DimStepMm = 5 }.Validate().Count > 0, "5 мм (хуучин цаасны утга) — хэт бага");
        }
    }
}
