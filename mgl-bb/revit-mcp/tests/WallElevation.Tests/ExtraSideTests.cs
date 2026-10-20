using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    /// <summary>
    /// «+ Хана нэмэх» (2026-10-14, интерьерийн баг: «хана нэмэх дээр дарахад хуудас руу шилжих биш, цонхон дотроо шууд шинэ үсэг гарч ирээд
    /// хэмжээгээ өөрсдөө тохируулаад ханын дэлгээсээ үүсгэнэ»): нэмэлт тал = цонхонд нэмсэн шугам (<see cref="WeExtraSides"/>).  Өрөөний A–D
    /// хөдлөхгүй, нэмсэн нь E, F …, ард нь байгаа хана олдоно, үүссэн нь дахин ажиллуулахад санагдана.
    /// </summary>
    public static class ExtraSideTests
    {
        private static double Mm(double ft) { return Math.Round(ft * WeFixedUnits.MmPerFoot, 1); }

        private static string RoomUid(WeRequest req) { return req.Rooms[0].UniqueId; }

        /// <summary>SquareRoom-ийн хилийн хана: 0 өмнөд, 1 зүүн, 2 хойд, 3 баруун.</summary>
        private static string WallOf(WeRequest req, int segment) { return req.Rooms[0].Loops[0].Segments[segment].WallUniqueId; }

        private static WePlan Plan(WeRequest req, Action<WeSettings> tweak = null)
        {
            return WallElevationPlanner.Plan(req, Fx.Ctx(s =>
            {
                s.Output = WeOutputMode.ViewsAndSheets;
                s.KeyPlan = true;
                if (tweak != null) tweak(s);
            }));
        }

        /// <summary>Өрөөний дундуур (y = 2000), x 1000–4000, хойд зүг рүү харна.</summary>
        private static WeSideOverride Middle()
        {
            return WeSideOverride.Line(Fx.P(1000, 2000), Fx.P(4000, 2000), new WeV3(0, 1, 0));
        }

        /// <summary>Цонхны «+ Хана нэмэх» = тохиргоонд дугаар + тохируулгад шугам.</summary>
        private static Action<WeSettings> With(WeRequest req, params KeyValuePair<string, WeSideOverride>[] sides)
        {
            return s =>
            {
                foreach (KeyValuePair<string, WeSideOverride> kv in sides)
                {
                    s.AddExtraSide(RoomUid(req), kv.Key);
                    s.Overrides[WeExtraSides.Key(RoomUid(req), kv.Key)] = kv.Value;
                }
            };
        }

        private static KeyValuePair<string, WeSideOverride> Side(string id, WeSideOverride line)
        {
            return new KeyValuePair<string, WeSideOverride>(id, line);
        }

        /// <summary>Үүсгэсэн мэт харагдац — шугам нь харагдац дээр хадгалагдсан (Revit-ийн <c>WeOverrideStore</c>).</summary>
        private static List<WeExistingView> Created(WePlan plan)
        {
            List<WeExistingView> views = Fx.AsExisting(plan);
            foreach (WeExistingView v in views)
            {
                WePlannedElevation p = plan.Items.Single(i => i.Key == v.Key);
                v.Override = p.Override != null ? p.Override.Serialize() : null;
            }
            return views;
        }

        [Test]
        public static void Extra_side_is_E_after_A_to_D_and_room_sides_do_not_move()
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            List<WePlannedElevation> orig = Plan(req).Items;
            Assert.Eq(4, orig.Count);
            WePlan plan = Plan(req, With(req, Side("1", Middle())));

            Assert.Eq(5, plan.Items.Count, "4 тал + 1 нэмэлт");
            foreach (WePlannedElevation o in orig)
            {
                WePlannedElevation same = plan.Items.Single(i => i.Key == o.Key);
                Assert.Eq(o.SideLetter, same.SideLetter, "өрөөний талын үсэг хөдлөхгүй: " + o.SideLetter);
                Assert.Eq(o.Signature, same.Signature, "өрөөний талын геометр хөдлөхгүй: " + o.SideLetter);
                Assert.False(same.Manual);
            }
            WePlannedElevation m = plan.Items.Single(i => i.Manual);
            Assert.Eq("E", m.SideLetter, "нэмэлт нь өрөөний талын ДАРАА");
            Assert.Eq(WeExtraSides.Key(RoomUid(req), "1"), m.Key);
            Assert.Eq(plan.Items[0].GroupKey, m.GroupKey, "ижил өрөөний бүлэг (хуудас, түлхүүр план)");
            Assert.True(m.Status <= WeStatus.Warning && m.Action == WeAction.Create && m.Frame != null, m.Status + " " + m.Message);
            Assert.True(m.Frame.Look.Y > 0.999, "харах чиглэл = шугамынх (хойд): " + m.Frame.Look);
            Assert.Eq(3000.0, Mm(m.FaceLength), "шугамын урт");
            Assert.Eq(2000.0, Mm(m.Frame.Origin.Y), "гадаргуу = шугам");
            Assert.Eq(1000.0, Mm(m.PlanA.X));
            Assert.Eq(4000.0, Mm(m.PlanB.X));
            Assert.Eq(WallOf(req, 2), m.WallUid, "ард нь хойд хана (нүх, шошго)");
            Assert.True(m.Message.StartsWith("Нэмэлт тал"), m.Message);
            Assert.True(m.Override != null && m.Override.IsValid, "шугам харагдац дээр хадгалагдана");
            Assert.True(plan.Items.Last() == m, "жагсаалтын төгсгөлд (A, B, C, D, E)");
            Assert.Eq(5, plan.Items.Select(i => i.Name).Distinct().Count(), "нэр давхцахгүй");
        }

        [Test]
        public static void Range_key_plan_and_marker_include_the_extra_side()
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            WePlan plan = Plan(req, With(req, Side("1", Middle())));
            WePlannedElevation m = plan.Items.Single(i => i.Manual);
            WeGroupInfo g = plan.Groups.Single();
            Assert.Eq("A-E", g.SideRange, "хуудасны муж E хүртэл");
            Assert.True(g.KeyPlan.Markers.Any(k => k.ElevationKey == m.Key), "түлхүүр план дээр E-ийн тэмдэг");
            Assert.True(m.Marker != null, "шинэ Elevation маркер");
            WeV3 look = WeMarkerPlanner.SlotLook(m.Marker.Slot, m.Marker.Rotation);
            Assert.True(look.Dot(m.Frame.Look) > 0.999, "маркерын сум харах чиглэлийг заана");
            Assert.True(WeKeyPlanner.InsideRoom(req.Rooms[0], m.Marker.Position), "маркер өрөөн дотор");
        }

        [Test]
        public static void Flipped_line_looks_the_other_way_and_finds_the_opposite_wall()
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            WePlannedElevation m = Plan(req, With(req, Side("1", Middle().Flipped()))).Items.Single(i => i.Manual);
            Assert.True(m.Frame.Look.Y < -0.999, "«⇅ Эсрэг» — өмнөд рүү: " + m.Frame.Look);
            Assert.Eq(WallOf(req, 0), m.WallUid, "ард нь өмнөд хана");
            Assert.Eq("E", m.SideLetter, "үсэг хэвээр");
        }

        [Test]
        public static void Rotated_line_looks_west_at_the_west_wall()
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            WePlannedElevation m = Plan(req, With(req, Side("1", Middle().Rotated90()))).Items.Single(i => i.Manual);
            Assert.True(m.Frame.Look.X < -0.999, "«⟲ 90°» — баруун тийш: " + m.Frame.Look);
            Assert.Eq(WallOf(req, 3), m.WallUid);
            Assert.Eq(2500.0, Mm(m.Frame.Origin.X), "төв хэвээр");
        }

        [Test]
        public static void Line_on_a_wall_face_looking_into_the_room_sees_the_opposite_wall()
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            // Хойд хананы нүүр дээр, өрөө рүү (урагш) харсан шугам — хойд хана биш, өмнөд хана ард нь.
            var line = WeSideOverride.Line(Fx.P(4000, 4000), Fx.P(1000, 4000), new WeV3(0, -1, 0));
            WePlannedElevation m = Plan(req, With(req, Side("1", line))).Items.Single(i => i.Manual);
            Assert.Eq(WallOf(req, 0), m.WallUid);
            Assert.True(m.Box.Far >= Fx.Mm(4000), "хүрээ өмнөд хана хүртэл: " + Mm(m.Box.Far));
        }

        [Test]
        public static void Dragging_the_ends_changes_the_length_not_the_letter()
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            var longer = WeSideOverride.Line(Fx.P(500, 2000), Fx.P(4500, 2000), new WeV3(0, 1, 0));
            WePlannedElevation m = Plan(req, With(req, Side("1", longer))).Items.Single(i => i.Manual);
            Assert.Eq(4000.0, Mm(m.FaceLength));
            Assert.Eq("E", m.SideLetter);
        }

        [Test]
        public static void Two_extra_sides_are_E_and_F_in_added_order()
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            var south = WeSideOverride.Line(Fx.P(4000, 1000), Fx.P(1000, 1000), new WeV3(0, -1, 0));
            WePlan plan = Plan(req, With(req, Side("1", Middle()), Side("2", south)));
            List<WePlannedElevation> m = plan.Items.Where(i => i.Manual).ToList();
            Assert.Eq(2, m.Count);
            Assert.Eq("E", m.Single(i => i.Key == WeExtraSides.Key(RoomUid(req), "1")).SideLetter);
            Assert.Eq("F", m.Single(i => i.Key == WeExtraSides.Key(RoomUid(req), "2")).SideLetter);
            Assert.Eq("A-F", plan.Groups.Single().SideRange);
        }

        [Test]
        public static void Created_extra_side_is_remembered_on_rerun()
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            WePlan first = Plan(req, With(req, Side("1", Middle())));
            req.Existing = Created(first);
            WePlan rerun = Plan(req);   // тохиргоо хоосон — харагдац дээрх түлхүүр + шугамаас
            WePlannedElevation m = rerun.Items.Single(i => i.Manual);
            Assert.Eq(WeAction.Keep, m.Action, "өөрчлөлтгүй — дахин үүсгэхгүй");
            Assert.Eq("E", m.SideLetter);
            Assert.Eq(1000.0, Mm(m.PlanA.X), "шугам харагдац дээрээс");
            Assert.Eq(0, rerun.Orphans.Count, "өнчин биш");
            Assert.Eq(0, rerun.Items.Count(i => i.Action == WeAction.Create), "давхардал үгүй");
        }

        [Test]
        public static void New_side_after_rerun_gets_F_and_the_created_one_keeps_E()
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            req.Existing = Created(Plan(req, With(req, Side("1", Middle()))));
            string next = WeExtraSides.NextId(new[] { "1" });
            Assert.Eq("2", next);
            var south = WeSideOverride.Line(Fx.P(4000, 1000), Fx.P(1000, 1000), new WeV3(0, -1, 0));
            // Тохиргоонд ЗӨВХӨН шинэ нь («2») — гэвч өмнө үүссэн «1»-ийн үсгийг булаахгүй.
            WePlan plan = Plan(req, With(req, Side(next, south)));
            WePlannedElevation e = plan.Items.Single(i => i.Key == WeExtraSides.Key(RoomUid(req), "1"));
            WePlannedElevation f = plan.Items.Single(i => i.Key == WeExtraSides.Key(RoomUid(req), "2"));
            Assert.Eq("E", e.SideLetter);
            Assert.Eq(WeAction.Keep, e.Action);
            Assert.Eq("F", f.SideLetter);
            Assert.Eq(WeAction.Create, f.Action);
        }

        [Test]
        public static void Moving_a_created_side_updates_it()
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            req.Existing = Created(Plan(req, With(req, Side("1", Middle()))));
            var moved = WeSideOverride.Line(Fx.P(1000, 2500), Fx.P(4000, 2500), new WeV3(0, 1, 0));
            WePlan plan = Plan(req, s => s.Overrides[WeExtraSides.Key(RoomUid(req), "1")] = moved);
            WePlannedElevation m = plan.Items.Single(i => i.Manual);
            Assert.Eq(WeAction.Update, m.Action, "шугам өөрчлөгдсөн — тэр харагдацыг шинэчилнэ");
            Assert.Eq(2500.0, Mm(m.Frame.Origin.Y));
            Assert.Eq("E", m.SideLetter);
        }

        [Test]
        public static void Reset_on_an_extra_side_keeps_its_stored_line()
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            req.Existing = Created(Plan(req, With(req, Side("1", Middle()))));
            WePlan plan = Plan(req, s => s.Overrides[WeExtraSides.Key(RoomUid(req), "1")] = new WeSideOverride { Reset = true });
            WePlannedElevation m = plan.Items.Single(i => i.Manual);
            Assert.Eq(WeAction.Keep, m.Action, "«анхных» гэж байхгүй — тал алга болохгүй");
            Assert.Eq(2000.0, Mm(m.Frame.Origin.Y));
            Assert.False(m.ClearStoredOverride, "харагдац дээрх шугам арилахгүй");
        }

        [Test]
        public static void Extra_side_without_a_line_is_skipped_with_a_note()
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            WePlan plan = Plan(req, s => s.AddExtraSide(RoomUid(req), "1"));
            Assert.Eq(4, plan.Items.Count);
            Assert.True(plan.Notes.Any(n => n.Contains("нэмэлт талын байрлал алга")), string.Join(" | ", plan.Notes));
        }

        [Test]
        public static void Created_side_whose_line_is_unreadable_is_an_orphan_with_a_specific_reason()
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            req.Existing = Created(Plan(req, With(req, Side("1", Middle()))));
            foreach (WeExistingView v in req.Existing) if (WeExtraSides.IsExtraKey(v.Key)) v.Override = null;
            WePlan plan = Plan(req);
            Assert.Eq(4, plan.Items.Count);
            WeOrphan o = plan.Orphans.Single();
            Assert.True(o.Reason.StartsWith("Нэмэлт талын байрлал"), o.Reason);
        }

        [Test]
        public static void Linked_wall_behind_warns()
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            req.WallLookup[WallOf(req, 2)].IsLinked = true;
            WePlannedElevation m = Plan(req, With(req, Side("1", Middle()))).Items.Single(i => i.Manual);
            Assert.Eq(WeStatus.Warning, m.Status, m.Message);
            Assert.True(m.Message.Contains("link"), m.Message);
        }

        [Test]
        public static void Initial_line_is_centred_on_the_side_at_half_length()
        {
            WeSideOverride l = WeExtraSides.InitialLine(Fx.P(0, 0), Fx.P(4000, 0), new WeV3(0, 1, 0));
            Assert.Eq(1000.0, Mm(l.A.X));
            Assert.Eq(3000.0, Mm(l.B.X));
            Assert.Eq(0.0, Mm(l.A.Y));
            Assert.True(l.Look.Y > 0.999 && l.IsValid);

            WeRequest req = Fx.SquareRoom(5000, 4000);
            var outline = new List<List<WeV3>> { req.Rooms[0].Loops[0].Segments.Select(s => s.A).ToList() };
            WeSideOverride o = WeExtraSides.InitialLine(outline);
            Assert.Eq(1250.0, Mm(o.A.X));
            Assert.Eq(3750.0, Mm(o.B.X));
            Assert.Eq(2000.0, Mm(o.A.Y), "өрөөний төвөөр");
            Assert.True(o.IsValid);
            Assert.True(WeExtraSides.InitialLine(new List<List<WeV3>>()) == null, "хилгүй бол null");
        }

        [Test]
        public static void First_extra_side_from_a_room_side_lands_inside_the_room_facing_the_same_wall()
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            WePlan before = Plan(req);
            foreach (WePlannedElevation a in before.Items)
            {
                WeSideOverride line = WeExtraSides.InitialLine(a.PlanA, a.PlanB, a.PlanLook, before.Outlines[a.GroupKey]);
                // Цонхны план дээр сонгосон талын шугамтай давхцахгүй — өрөө рүү 300–1200 мм (энд гүний ⅓ > 1200 → 1200).
                double off = Mm(((line.A + line.B) * 0.5 - (a.PlanA + a.PlanB) * 0.5).Dot(-a.PlanLook));
                Assert.Eq(1200.0, Math.Round(off, 1), a.SideLetter + " — өрөө рүү оруулсан зай");
                Assert.True(WeKeyPlanner.InsideRoom(req.Rooms[0], (line.A + line.B) * 0.5), a.SideLetter + " өрөөн дотор");
                WePlannedElevation m = Plan(req, With(req, Side("1", line))).Items.Single(i => i.Manual);
                Assert.True(m.Frame != null && m.Status <= WeStatus.Warning, m.Status + " " + m.Message);
                Assert.Eq("E", m.SideLetter);
                Assert.Eq(Math.Round(Mm(a.FaceLength) / 2, 0), Math.Round(Mm(m.FaceLength), 0), a.SideLetter + " — уртын хагас");
                Assert.True(m.Frame.Look.Dot(a.Frame.Look) > 0.999, a.SideLetter + " — ижил чиглэл");
                Assert.Eq(a.WallUid, m.WallUid, a.SideLetter + " — ижил хана руу харна");
            }
        }

        [Test]
        public static void Initial_offset_shrinks_in_a_shallow_room()
        {
            // 360 мм гүн «өрөө» — гүний ⅓ = 120 → доод хязгаар 300, гэвч 300 > 0.8×360 → гүний хагас (180).
            var outline = new List<List<WeV3>> { new List<WeV3> { Fx.P(0, 0), Fx.P(3000, 0), Fx.P(3000, 360), Fx.P(0, 360) } };
            WeSideOverride l = WeExtraSides.InitialLine(Fx.P(0, 360), Fx.P(3000, 360), new WeV3(0, 1, 0), outline);
            Assert.Eq(180.0, Mm(l.A.Y), "хагас гүнд — эсрэг хананд хүрэхгүй");
            Assert.True(WeExtraSides.InitialLine(Fx.P(0, 360), Fx.P(3000, 360), new WeV3(0, 1, 0), null).A.Y > 0, "хилгүй бол тал дээрээ");
        }

        [Test]
        public static void Rerange_updates_only_the_letter_range_of_tool_names()
        {
            string want = "101-ОФФИС ХАНЫН ДЭЛГЭЭС / L1/ /101A-E/";
            Assert.Eq(want, WeNaming.Rerange("101-ОФФИС ХАНЫН ДЭЛГЭЭС / L1/ /101A-D/", want, "A-E"), "хуудас A-D → A-E");
            Assert.True(WeNaming.Rerange(want, want, "A-E") == null, "ижил — юу ч хийхгүй");
            Assert.True(WeNaming.Rerange("101-ОФФИС миний хуудас /101A-D/", want, "A-E") == null, "хэрэглэгч өөрчилсөн — хөндөхгүй");
            Assert.True(WeNaming.Rerange("102-ОФФИС ХАНЫН ДЭЛГЭЭС / L1/ /102A-D/", want, "A-E") == null, "өөр өрөө");
            Assert.Eq(want + " (2)", WeNaming.Rerange("101-ОФФИС ХАНЫН ДЭЛГЭЭС / L1/ /101A-D/ (2)", want + " (2)", "A-E"), "2-р хуудас");
            Assert.Eq("Түлхүүр байгуулалт — 101A-E", WeNaming.Rerange("Түлхүүр байгуулалт — 101A-D", "Түлхүүр байгуулалт — 101A-E", "A-E"));
            Assert.Eq("Түлхүүр байгуулалт — 101A-B", WeNaming.Rerange("Түлхүүр байгуулалт — 101A", "Түлхүүр байгуулалт — 101A-B", "A-B"), "нэг үсгээс");
            Assert.True(WeNaming.Rerange("3D — 101A-D", "3D — 101A-E", string.Empty) == null, "мужгүй");
        }

        [Test]
        public static void Keys_ids_and_next_id()
        {
            string k = WeExtraSides.Key("r1", "3");
            Assert.True(WeExtraSides.IsExtraKey(k), k);
            Assert.Eq("3", WeExtraSides.IdOf(k));
            Assert.False(WeExtraSides.IsExtraKey(WeIdentity.Key("r1", "w1", "int")), "өрөөний ердийн тал");
            Assert.True(WeExtraSides.IdOf(null) == null);
            Assert.Eq("1", WeExtraSides.NextId(null));
            Assert.Eq("4", WeExtraSides.NextId(new[] { "1", "3", "x" }), "хамгийн их + 1 (устгасан ч давхцахгүй)");
        }

        [Test]
        public static void Settings_keep_extra_sides_per_room_clone_and_do_not_serialize()
        {
            var s = new WeSettings();
            s.AddExtraSide("r1", "1");
            s.AddExtraSide("r1", "1");
            s.AddExtraSide("r1", "2");
            Assert.Eq("1,2", string.Join(",", s.ExtraSidesOf("r1")), "давхардалгүй, нэмсэн дарааллаар");
            WeSettings c = s.Clone();
            c.RemoveExtraSide("r1", "1");
            Assert.True(s.HasExtraSide("r1", "1"), "клон тусдаа");
            Assert.False(c.HasExtraSide("r1", "1"));
            c.RemoveExtraSide("r1", "2");
            Assert.False(c.ExtraSides.ContainsKey("r1"), "хоосон өрөө арилна");
            Assert.Eq(0, c.ExtraSidesOf("r1").Count);
            WeSettings back = WeSettings.Deserialize(s.Serialize());
            Assert.Eq(0, back.ExtraSides.Count, "өрөө тус бүрийн нэмэлт — файлд бичигдэхгүй");
        }
    }
}
