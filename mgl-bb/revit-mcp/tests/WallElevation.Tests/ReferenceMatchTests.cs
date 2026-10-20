using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    /// <summary>
    /// MITIC жишиг хуудастай (ИЗД1_A2_39 … 51, 2026-10-08) тулгасан дүрмүүд: хэвтээ/босоо гинжид жижиг сегментгүй, гол тааз л, таазны гэрэлд
    /// шошго/хэмжээсгүй, урд талын хаалганд шошго.
    /// </summary>
    public static class ReferenceMatchTests
    {
        private static double Mm(double ft) { return Math.Round(ft * WeFixedUnits.MmPerFoot, 1); }

        private static WeAnnoRef R(WeRefKind k, double posMm, long id = 1)
        {
            return new WeAnnoRef { Kind = k, ElementId = id, Pos = Fx.Mm(posMm) };
        }

        [Test]
        public static void Chain_drops_segments_shorter_than_the_minimum_keeping_face_ends_grids_and_openings()
        {
            var refs = new List<WeAnnoRef>
            {
                R(WeRefKind.FaceStart, -2500), R(WeRefKind.ElementLeft, -2490, 2), R(WeRefKind.ElementRight, -2480, 2),
                R(WeRefKind.ElementLeft, -1300, 3), R(WeRefKind.ElementRight, -1280, 3),
                R(WeRefKind.ElementLeft, -10, 4), R(WeRefKind.Grid, 0, 5), R(WeRefKind.InsertLeft, 800, 6), R(WeRefKind.ElementRight, 820, 7),
                R(WeRefKind.ElementRight, 2490, 8), R(WeRefKind.FaceEnd, 2500),
            };
            List<WeAnnoRef> r = WeAnnotationPlanner.SimplifyChain(refs, Fx.Mm(35));
            Assert.SeqEq(new[] { -2500.0, -1300, 0, 800, 2500 }, r.Select(x => Mm(x.Pos)), "зах · хаалт · тэнхлэг · нүх · зах");
            Assert.SeqEq(new[] { WeRefKind.FaceStart, WeRefKind.ElementLeft, WeRefKind.Grid, WeRefKind.InsertLeft, WeRefKind.FaceEnd }, r.Select(x => x.Kind));
            for (int i = 1; i < r.Count; i++) Assert.True(r[i].Pos - r[i - 1].Pos >= Fx.Mm(35) - 1e-9, "сегмент ≥ 35 мм");
        }

        [Test]
        public static void Chain_of_small_steps_never_leaves_a_short_segment()
        {
            var refs = Enumerable.Range(0, 10).Select(i => R(WeRefKind.ElementLeft, i * 30, i + 1)).ToList();
            List<WeAnnoRef> r = WeAnnotationPlanner.SimplifyChain(refs, Fx.Mm(35));
            Assert.True(r.Count >= 2, "хоёроос дээш үлдэнэ");
            for (int i = 1; i < r.Count; i++) Assert.True(r[i].Pos - r[i - 1].Pos >= Fx.Mm(35) - 1e-9, "сегмент ≥ 35 мм");
        }

        [Test]
        public static void Vertical_chain_keeps_the_finish_floor_and_drops_the_thin_screed_bottom()
        {
            var refs = new List<WeAnnoRef>
            {
                R(WeRefKind.FloorBottom, 100), R(WeRefKind.FloorTop, 105), R(WeRefKind.ElementBottom, 150), R(WeRefKind.ElementTop, 200),
                R(WeRefKind.CeilingBottom, 2780), R(WeRefKind.CeilingBottom, 2800, 9),
            };
            List<WeAnnoRef> r = WeAnnotationPlanner.SimplifyChain(refs, Fx.Mm(35), true);
            Assert.SeqEq(new[] { WeRefKind.FloorTop, WeRefKind.ElementBottom, WeRefKind.ElementTop, WeRefKind.CeilingBottom }, r.Select(x => x.Kind));
            Assert.SeqEq(new[] { 105.0, 150, 200, 2780 }, r.Select(x => Mm(x.Pos)));
        }

        /// <summary>5000×4000 өрөө, урд (y = 0) хана: гол тааз 2700 бүтэн, гэрлийн суваг 2400 (урд ханын дагуу 1000 мм), гүнд 3000.</summary>
        private static WeRequest Room(double bulkheadLenMm)
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            WeAnnoSources s = req.Sources;
            s.Levels.Add(new WeLevelInfo { Id = 1, Name = "L01", Z = 0 });
            s.Levels.Add(new WeLevelInfo { Id = 2, Name = "L02", Z = Fx.Mm(4000) });
            s.Slabs.Add(new WeSlabInfo { Id = 10, Kind = WeSlabKind.Floor, Min = Fx.P(0, 0, -100), Max = Fx.P(5000, 4000, 0) });
            s.Slabs.Add(new WeSlabInfo { Id = 20, Kind = WeSlabKind.Ceiling, Min = Fx.P(0, 0, 2700), Max = Fx.P(5000, 4000, 2720) });
            s.Slabs.Add(new WeSlabInfo { Id = 21, Kind = WeSlabKind.Ceiling, Min = Fx.P(0, 0, 2400), Max = Fx.P(bulkheadLenMm, 600, 2420) });
            s.Slabs.Add(new WeSlabInfo { Id = 22, Kind = WeSlabKind.Ceiling, Min = Fx.P(0, 2000, 3000), Max = Fx.P(5000, 4000, 3020) });
            // Таазны гэрэл (ханын дэргэд, таазан дээр) ба хананы гэрэл (1800 мм).
            s.Taggables.Add(new WeTaggable { Id = 40, CategoryKey = WeAnno.Electrical, Lighting = true, Min = Fx.P(2000, 50, 2600), Max = Fx.P(2300, 300, 2700) });
            s.Taggables.Add(new WeTaggable { Id = 41, CategoryKey = WeAnno.Electrical, Lighting = true, Min = Fx.P(3000, 0, 1750), Max = Fx.P(3200, 120, 1850) });
            s.Taggables.Add(new WeTaggable { Id = 42, CategoryKey = WeAnno.Electrical, Min = Fx.P(500, 0, 300), Max = Fx.P(580, 40, 380) });
            return req;
        }

        private static WePlannedElevation South(WePlan plan)
        {
            return plan.Items.Single(i => i.Frame.Look.AlmostEquals(new WeV3(0, -1, 0), 1e-6));
        }

        [Test]
        public static void Only_ceilings_covering_the_face_are_dimensioned_and_spotted()
        {
            WePlannedElevation p = South(WallElevationPlanner.Plan(Room(1000), Fx.Ctx(s => s.Annotations = WeAnno.DefaultSet)));
            List<long> ceil = p.Annotation.Rows.SelectMany(r => r.Refs).Where(x => x.Kind == WeRefKind.CeilingBottom).Select(x => x.ElementId).Distinct().ToList();
            Assert.SeqEq(new long[] { 20 }, ceil, "гол тааз л (гэрлийн суваг 20 %, гүн дэх тааз гадаргууд хүрээгүй)");
            Assert.SeqEq(new long[] { 20 }, p.Annotation.Spots.Where(sp => sp.Target.Kind == WeRefKind.CeilingBottom).Select(sp => sp.Target.ElementId));

            WePlannedElevation wide = South(WallElevationPlanner.Plan(Room(2500), Fx.Ctx(s => s.Annotations = WeAnno.DefaultSet)));
            Assert.SeqEq(new long[] { 21, 20 }, wide.Annotation.Spots.Where(sp => sp.Target.Kind == WeRefKind.CeilingBottom).Select(sp => sp.Target.ElementId),
                         "гадаргуугийн хагасыг хамарсан суваг — хоёр тааз, доороос дээш");
        }

        [Test]
        public static void L_shaped_ceiling_whose_box_covers_the_face_but_its_outline_does_not_is_ignored()
        {
            // MITIC 219D: 3000-ийн тааз хөрш өрөөнүүдийг L хэлбэрээр хамарсан — хайрцаг нь урд ханыг бүрхэвч нүүр нь энд байхгүй.
            WeRequest req = Room(1000);
            var l = new WeSlabInfo { Id = 24, Kind = WeSlabKind.Ceiling, Min = Fx.P(-3000, -3000, 2600), Max = Fx.P(8000, 4000, 2620) };
            l.Faces = new List<List<List<WeV3>>> { new List<List<WeV3>> { new List<WeV3> {
                Fx.P(-3000, -3000), Fx.P(8000, -3000), Fx.P(8000, 4000), Fx.P(6000, 4000), Fx.P(6000, -1000), Fx.P(-3000, -1000) } } };
            req.Sources.Slabs.Add(l);
            WePlannedElevation p = South(WallElevationPlanner.Plan(req, Fx.Ctx(s => s.Annotations = WeAnno.DefaultSet)));
            Assert.False(p.Annotation.Spots.Any(sp => sp.Target.ElementId == 24), "контураар өрөөнд байхгүй тааз — spot-гүй");
            Assert.False(p.Annotation.Rows.SelectMany(r => r.Refs).Any(x => x.ElementId == 24), "хэмжээсгүй");
            Assert.True(new WeSlabInfo { Faces = l.Faces }.Covers(Fx.P(7000, 0)) && !new WeSlabInfo { Faces = l.Faces }.Covers(Fx.P(2500, 200)), "контурын шалгалт");
        }

        [Test]
        public static void Ceiling_lights_get_no_tag_or_dimension_wall_lights_and_sockets_do()
        {
            WePlannedElevation p = South(WallElevationPlanner.Plan(Room(1000), Fx.Ctx(s => s.Annotations = WeAnno.DefaultSet)));
            var tagged = new HashSet<long>(p.Annotation.Tags.Where(t => t.CategoryKey == WeAnno.Electrical).Select(t => t.ElementId));
            Assert.False(tagged.Contains(40), "таазны гэрэл — шошгогүй");
            Assert.True(tagged.Contains(41), "хананы гэрэл — шошготой");
            Assert.True(tagged.Contains(42), "розетк — шошготой");
            Assert.False(p.Annotation.Rows.SelectMany(r => r.Refs).Any(x => x.ElementId == 40), "таазны гэрэлд хэмжээсгүй");
        }

        [Test]
        public static void Door_in_a_partition_in_front_of_the_face_is_tagged_edge_on_door_is_not()
        {
            WeRequest req = Room(1000);
            WeAnnoSources s = req.Sources;
            // Урд ханаас 1500 мм-т зэрэгцээ хаалт хана, түүнд 800 мм хаалга (нүүрээрээ); перпендикуляр хаалт хананы хаалга (ирмэгээрээ).
            s.Inserts.Add(new WeInsertInfo { Id = 50, Kind = WeInsertKind.Door, HostWallUid = "partition-1", Center = Fx.P(2500, 1500), HalfWidth = Fx.Mm(400), BottomZ = 0, TopZ = Fx.Mm(2100) });
            s.Taggables.Add(new WeTaggable { Id = 50, CategoryKey = WeAnno.Doors, Min = Fx.P(2100, 1450), Max = Fx.P(2900, 1550, 2100) });
            s.Inserts.Add(new WeInsertInfo { Id = 51, Kind = WeInsertKind.Door, HostWallUid = "partition-2", Center = Fx.P(4000, 2000), HalfWidth = Fx.Mm(400), BottomZ = 0, TopZ = Fx.Mm(2100) });
            s.Taggables.Add(new WeTaggable { Id = 51, CategoryKey = WeAnno.Doors, Min = Fx.P(3950, 1600), Max = Fx.P(4050, 2400, 2100) });
            WePlannedElevation p = South(WallElevationPlanner.Plan(req, Fx.Ctx(st => st.Annotations = WeAnno.DefaultSet)));
            var doors = p.Annotation.Tags.Where(t => t.CategoryKey == WeAnno.Doors).Select(t => t.ElementId).ToList();
            Assert.True(doors.Contains(50), "нүүрээрээ харагдах хаалга — шошготой");
            Assert.False(doors.Contains(51), "ирмэгээрээ харагдах хаалга — шошгогүй");
            Assert.False(p.Annotation.Rows.SelectMany(r => r.Refs).Any(x => x.ElementId == 50), "урд талын хаалга хэмжээсийн «нүх» биш");

            // Загварт давхар орсон ижил төрлийн хаалга (MITIC 227F «X-6» хоёр удаа) — нэг шошго.
            s.Taggables.Single(t => t.Id == 50).TypeId = 900;
            s.Inserts.Add(new WeInsertInfo { Id = 52, Kind = WeInsertKind.Door, HostWallUid = "partition-3", Center = Fx.P(2520, 1500), HalfWidth = Fx.Mm(400), BottomZ = 0, TopZ = Fx.Mm(2100) });
            s.Taggables.Add(new WeTaggable { Id = 52, CategoryKey = WeAnno.Doors, TypeId = 900, Min = Fx.P(2120, 1450), Max = Fx.P(2920, 1550, 2100) });
            WePlannedElevation dup = South(WallElevationPlanner.Plan(req, Fx.Ctx(st => st.Annotations = WeAnno.DefaultSet)));
            Assert.Eq(1, dup.Annotation.Tags.Count(t => t.CategoryKey == WeAnno.Doors && (t.ElementId == 50 || t.ElementId == 52)), "давхар хаалга — нэг шошго");
        }

        [Test]
        public static void Vertical_chain_runs_level_floor_top_main_ceiling_upper_level_like_the_reference()
        {
            // MITIC 218/219: өнгөлгөөний шал 30–100 мм (бүтцийн хавтан link-д), гол тааз 2700, гүнд 3000-ийн тааз, дээд хучилт алга.
            WeRequest req = Room(1000);
            WeAnnoSources s = req.Sources;
            s.Slabs.RemoveAll(sl => sl.Id == 10);
            s.Slabs.Add(new WeSlabInfo { Id = 11, Kind = WeSlabKind.Floor, Min = Fx.P(0, 0, 30), Max = Fx.P(5000, 4000, 100) });
            s.Slabs.Add(new WeSlabInfo { Id = 23, Kind = WeSlabKind.Ceiling, Min = Fx.P(0, 0, 2800), Max = Fx.P(2500, 600, 2820) });
            WePlannedElevation p = South(WallElevationPlanner.Plan(req, Fx.Ctx(st => st.Annotations = WeAnno.DefaultSet)));
            WeDimRow r1 = p.Annotation.Rows.Single(r => r.Group == WeDimGroup.Vertical1);
            Assert.SeqEq(new[] { WeRefKind.Level, WeRefKind.FloorTop, WeRefKind.CeilingBottom, WeRefKind.Level }, r1.Refs.Select(x => x.Kind),
                         "«80 · 2720 · 1200»: түвшин · шалны дээд · гол тааз · дээд түвшин");
            Assert.SeqEq(new[] { 0.0, 100, 2700, 4000 }, r1.Refs.Select(x => Mm(x.Pos)));
            Assert.True(p.Annotation.Spots.Count(sp => sp.Target.Kind == WeRefKind.CeilingBottom) == 2, "хоёрдогч тааз (2800) spot level-ээр");
            Assert.True(p.Annotation.Rows.Any(r => r.Group == WeDimGroup.Vertical2), "давхар хоорондын «4000» хэвээр");
        }

        [Test]
        public static void Hidden_recess_and_thin_partition_end_are_not_elevations()
        {
            // 219: урд хананд 140 мм өргөн 20 мм гүн хонхор (219J), 800 мм-ийн хаалганы хонхор (218I), зүүн хананаас 380 мм цухуйсан 20 мм-ийн
            // хаалт (219G/I); 900 мм өргөн 400 мм гүн жинхэнэ нишийг ҮЛДЭЭНЭ.
            WeRequest req = Poly.Room(Poly.P(0, 0, 1750, 0, 1750, -20, 1890, -20, 1890, 0, 3160, 0,
                                             3160, 900, 2780, 900, 2780, 920, 3160, 920, 3160, 2840, 2000, 2840, 2000, 3240, 1100, 3240, 1100, 2840,
                                             0, 2840, 0, 2000, -20, 2000, -20, 1200, 0, 1200),
                                      new[] { "s", Poly.Other, "r", Poly.Other, "s", "e", "f1", "fe", "f2", "e", "n", "x1", "x2", "x3", "n",
                                              "w", Poly.Other, "d", Poly.Other, "w" });
            var skipped = new List<KeyValuePair<WeBoundarySegment, string>>();
            List<WeRoomSide> sides = RoomBoundaryAnalyzer.Sides(req.Rooms[0], skipped, true, Fx.Mm(WallElevationPlanner.MaxJogMm), Fx.Mm(WallElevationPlanner.LineTolMm));
            Assert.False(sides.Any(sd => sd.AnchorWallUid == "wall-r" || sd.AnchorWallUid == "wall-d"), "хонхор — том талын дэлгээст");
            Assert.False(sides.Any(sd => sd.AnchorWallUid == "wall-f1" || sd.AnchorWallUid == "wall-f2"), "нимгэн хаалтын хоёр нүүр");
            Assert.True(sides.Any(sd => sd.AnchorWallUid == "wall-x2" && Math.Abs(Mm(sd.Length) - 900) < 1), "400 мм гүн ниш — тусдаа дэлгээс хэвээр");
            Assert.True(skipped.Any(k => k.Value.Contains("хонхор")) && skipped.Any(k => k.Value.Contains("нимгэн хаалт")), "тайланд шалтгаантай");
        }

        [Test]
        public static void Complex_room_157_drops_sides_shorter_than_a_metre()
        {
            // MAX ӨРГӨӨ INT_B 157 «Бэлтгэх өрөө» — бодит хил (2026-10-13 Revit 2024-өөс уншсан 50 хэрчим, мм).  1.39.0: 27 дэлгээс, оффисын
            // жишиг 10.  Эзний шийдвэр (2026-10-14): 1 м-ээс богино булангийн хэсэг хөрш дэлгээст — тусдаа дэлгээсгүй.
            var keys = new string[50];
            foreach (int k in new[] { 10, 35, 37, 40, 42 }) keys[k] = Poly.Other;
            WeRequest req = Poly.Room(Poly.P(85850, 5550, 79850, 5550, 79850, 3200, 80250, 3200, 80250, 2525, 79850, 2525, 79850, 750, 80450, 750,
                                             80450, -450, 85400, -450, 87375, -450, 87375, -500, 87550, -500, 87550, 835, 88450, 835, 88450, 212,
                                             91780, 2710, 91477, 3114, 92037, 3534, 92340, 3130, 95595, 5571, 95595, 6450, 90000, 6450, 90000, 5500,
                                             90000, 5195, 88000, 5195, 88000, 3200, 88250, 3200, 88250, 2600, 87750, 2600, 87750, 3150, 87750, 5245,
                                             87750, 5450, 86050, 5450, 86050, 3150, 86050, 2650, 86000, 2650, 86000, 810, 86295, 810, 86295, 730,
                                             86295, 275, 86245, 275, 86245, 730, 85950, 730, 85950, 810, 85950, 2600, 85550, 2600, 85550, 3200,
                                             85850, 3200, 85850, 5500), keys, "157", 4000);
            var skipped = new List<KeyValuePair<WeBoundarySegment, string>>();
            List<WeRoomSide> sides = RoomBoundaryAnalyzer.Sides(req.Rooms[0], skipped, true, Fx.Mm(WallElevationPlanner.MaxJogMm), Fx.Mm(WallElevationPlanner.LineTolMm));
            Console.WriteLine("       157: " + sides.Count + " тал — " + string.Join(", ", sides.Select(sd => Math.Round(Mm(sd.Length)).ToString())));
            Assert.True(sides.All(sd => Mm(sd.Length) >= 999), "1 м-ээс богино тал үлдэхгүй");
            Assert.True(skipped.Count(k => k.Value.Contains("1 м-ээс богино")) >= 10, "тайланд шалтгаантай");
            WePlan plan = Poly.Plan(req);
            Assert.Eq(sides.Count, plan.Items.Count(i => i.Action == WeAction.Create), "тал бүр нэг дэлгээс");
            Assert.True(plan.Notes.Any(n => n.Contains("1 м-ээс богино тал")), "тэмдэглэлд нэг мөр");
        }

        [Test]
        public static void Front_of_a_box_protruding_from_a_long_wall_is_shown_in_that_walls_elevation()
        {
            // 211: зүүн хананаас 625 мм цухуйсан 1000 мм-ийн хайрцаг — урд нүүр нь 211C (7900)-д, хажуу нүүрүүд (625) тусдаа (жишиг 211F, 211G).
            WeRequest req = Poly.Room(Poly.P(0, 0, 4000, 0, 4000, 5000, 3375, 5000, 3375, 6000, 4000, 6000, 4000, 7900, 0, 7900),
                                      new[] { "s", "e", "b1", "bf", "b2", "e", "n", "w" });
            var skipped = new List<KeyValuePair<WeBoundarySegment, string>>();
            List<WeRoomSide> sides = RoomBoundaryAnalyzer.Sides(req.Rooms[0], skipped, true, Fx.Mm(WallElevationPlanner.MaxJogMm), Fx.Mm(WallElevationPlanner.LineTolMm));
            WeRoomSide east = sides.Single(sd => sd.AnchorWallUid == "wall-e");
            Assert.Eq(7900.0, Mm(east.Length), "зүүн тал хайрцгийг давна");
            Assert.False(sides.Any(sd => sd.AnchorWallUid == "wall-bf"), "хайрцгийн урд нүүр — зүүн талын дэлгээст");
            // Хажуу нүүрүүд (625) — жишигт 211F/G байсан ч эзний 2026-10-14-ний шийдвэрээр 1 м-ээс богино булангийн хэсэг тусдаа дэлгээсгүй.
            Assert.False(sides.Any(sd => sd.AnchorWallUid == "wall-b1" || sd.AnchorWallUid == "wall-b2"), "625 мм-ийн хажуу нүүр — дэлгээсгүй");
            Assert.True(skipped.Any(k => k.Value.Contains("цухуйсан")), "тайланд шалтгаантай");
        }

        [Test]
        public static void Project_sheet_names_teach_the_zone_and_the_room_separator()
        {
            string sep, zone;
            Assert.True(WeNaming.TryParseRoomSheetName("218 АЦӨ /ЭМЭГТЭЙ/ ӨРӨӨ ХАНЫН ДЭЛГЭЭС /A BLOCK 2-Р ДАВХАР//218A-E/", out sep, out zone));
            Assert.Eq(" ", sep);
            Assert.Eq("A BLOCK 2-Р ДАВХАР", zone);
            Assert.True(WeNaming.TryParseRoomSheetName("205-АМРАЛТЫН ӨРӨӨ/ ТАМИРЧДЫН ЛОУНЖ/ ХАНЫН ДЭЛГЭЭС /A BLOCK 2-Р ДАВХАР/ /205A-F/", out sep, out zone));
            Assert.Eq("-", sep);
            Assert.True(WeNaming.TryParseRoomSheetName("203- КОРИДОР ХАНЫН ДЭЛГЭЭС /A BLOCK 2-Р ДАВХАР/ /203E-H/", out sep, out zone));
            Assert.Eq("-", sep);
            Assert.True(WeNaming.TryParseRoomSheetName("221, 226 VIP АЦӨ /ЭМЭГТЭЙ/ ӨРӨӨ ХАНЫН ДЭЛГЭЭС/A  BLOCK 2-Р ДАВХАР//221A-D, 226A-D/", out sep, out zone));
            Assert.Eq("A BLOCK 2-Р ДАВХАР", zone, "давхар зай нэгтгэгдэнэ");
            Assert.False(WeNaming.TryParseRoomSheetName("205-АМРАЛТЫН ӨРӨӨ/ТАМИРЧДЫН ЛОУНЖ/ ХАНЫН ДЭЛГЭЭС /205O-Q, 204A-D/", out sep, out zone), "үсгийн муж — бүс биш");
            Assert.False(WeNaming.TryParseRoomSheetName("2-Р ДАВХРЫН ХАНЫН ДЭЛГЭЭСИЙН БАЙГУУЛАЛТ / А БЛОК/", out sep, out zone), "давхрын байгуулалт — өрөөний хуудас биш");
            var v = WeNaming.Values("Давхар 2", "218", "АЦӨ /ЭМЭГТЭЙ/ ӨРӨӨ", "", "", 0, "", "A-E");
            v["{Level}"] = "A BLOCK 2-Р ДАВХАР";
            Assert.Eq("218 АЦӨ /ЭМЭГТЭЙ/ ӨРӨӨ ХАНЫН ДЭЛГЭЭС /A BLOCK 2-Р ДАВХАР/ /218A-E/", WeNaming.Expand(WeNaming.LearnedSheetNamePattern(" "), v));
        }

        [Test]
        public static void Sheet_number_series_accepts_a_prefix_with_digits_only_before_an_underscore()
        {
            string pf; int n, d;
            Assert.True(WeNaming.SplitSheetNumber("ИЗД1_A2_96", out pf, out n, out d));
            Assert.Eq("ИЗД1_A2_", pf);
            Assert.Eq(96, n);
            Assert.Eq(2, d);
            Assert.True(WeNaming.SplitSheetNumber("БА413", out pf, out n, out d));
            Assert.Eq("БА", pf);
            Assert.False(WeNaming.SplitSheetNumber("БА107.1", out pf, out n, out d), "дэд хуудас");
            Assert.False(WeNaming.SplitSheetNumber("ИЗД1_СПОРТ ЗААЛ", out pf, out n, out d));
        }
    }
}
