using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    /// <summary>
    /// W08 (2026-10-16): шал/таазны БОДИТ нүүр дэлгээсийн дагуу — олон өндрийн тааз (spot бүр өөрийн нүүр дээр), тавцан/алхам (гол шал биш,
    /// тусдаа spot), налуу шал/тааз (хавтгайгаар өндөр, босоо гинжид орохгүй).  Загварт байхгүй алхам/заадас зохиохгүй.
    /// </summary>
    public static class SurfaceProfileTests
    {
        private static double Mm(double ft) { return Math.Round(ft * WeFixedUnits.MmPerFoot, 1); }

        private static List<List<List<WeV3>>> Rect(double x0, double y0, double x1, double y1)
        {
            return new List<List<List<WeV3>>> { new List<List<WeV3>> { new List<WeV3> { Fx.P(x0, y0), Fx.P(x1, y0), Fx.P(x1, y1), Fx.P(x0, y1) } } };
        }

        private static WeSlabInfo Slab(long id, WeSlabKind kind, double x0, double y0, double x1, double y1, double z0, double z1, bool faces = true)
        {
            var s = new WeSlabInfo { Id = id, Kind = kind, Min = Fx.P(x0, y0, z0), Max = Fx.P(x1, y1, z1) };
            if (faces)
            {
                s.Faces = Rect(x0, y0, x1, y1);
                double z = kind == WeSlabKind.Ceiling ? z0 : z1;
                s.Planes = new List<WeSlabPlane> { new WeSlabPlane { Origin = Fx.P(x0, y0, z), Normal = new WeV3(0, 0, kind == WeSlabKind.Ceiling ? -1 : 1) } };
            }
            return s;
        }

        /// <summary>5000×4000 өрөө (0,0)–(5000,4000), давхар 0 / 4000, бүтэн шал 0.</summary>
        private static WeRequest Room()
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            WeAnnoSources s = req.Sources;
            s.Levels.Add(new WeLevelInfo { Id = 1, Name = "L01", Z = 0 });
            s.Levels.Add(new WeLevelInfo { Id = 2, Name = "L02", Z = Fx.Mm(4000) });
            s.Slabs.Add(Slab(10, WeSlabKind.Floor, 0, 0, 5000, 4000, -100, 0));
            return req;
        }

        private static WePlannedElevation South(WeRequest req)
        {
            WePlan plan = WallElevationPlanner.Plan(req, Fx.Ctx(s => s.Annotations = WeAnno.DefaultSet));
            return plan.Items.Single(i => i.Frame.Look.AlmostEquals(new WeV3(0, -1, 0), 1e-6));
        }

        private static WeV3 WorldOf(WePlannedElevation p, WeSpot sp) { return p.Frame.ToWorld(sp.X, sp.Y, sp.Depth); }

        [Test]
        public static void Height_comes_from_the_face_plane_and_respects_holes()
        {
            var c = new WeSlabInfo { Id = 1, Kind = WeSlabKind.Ceiling, Min = Fx.P(0, 0, 2400), Max = Fx.P(5000, 4000, 2920) };
            c.Faces = new List<List<List<WeV3>>> { new List<List<WeV3>>
            {
                new List<WeV3> { Fx.P(0, 0), Fx.P(5000, 0), Fx.P(5000, 4000), Fx.P(0, 4000) },
                new List<WeV3> { Fx.P(2000, 1500), Fx.P(3000, 1500), Fx.P(3000, 2500), Fx.P(2000, 2500) },   // нүх (гэрлийн нүх)
            } };
            // x дагуу 5000 мм-т 500 мм өгсөх налуу (доод нүүр, нормаль доош).
            WeV3 n = new WeV3(Fx.Mm(500), 0, -Fx.Mm(5000)).Normalized();
            c.Planes = new List<WeSlabPlane> { new WeSlabPlane { Origin = Fx.P(0, 0, 2400), Normal = n } };
            double z;
            int face;
            Assert.True(c.HeightAt(Fx.P(1000, 500), out z, out face) && face == 0);
            Assert.Eq(2500.0, Mm(z), "налуу хавтгай: x = 1000 → 2500");
            Assert.True(c.HeightAt(Fx.P(4000, 500), out z, out face));
            Assert.Eq(2800.0, Mm(z));
            Assert.False(c.HeightAt(Fx.P(2500, 2000), out z, out face), "нүхэнд нүүр байхгүй");
            Assert.True(c.HasSlope);
            var box = new WeSlabInfo { Id = 2, Kind = WeSlabKind.Floor, Min = Fx.P(0, 0, -100), Max = Fx.P(5000, 4000, 30) };
            Assert.True(box.HeightAt(Fx.P(10, 10), out z, out face) && face == -1);
            Assert.Eq(30.0, Mm(z), "контургүй шал — хайрцгийн дээд (өмнөх зан төлөв)");
            Assert.False(box.HasSlope);
        }

        [Test]
        public static void Two_ceiling_heights_each_get_a_spot_on_their_own_face()
        {
            WeRequest req = Room();
            req.Sources.Slabs.Add(Slab(20, WeSlabKind.Ceiling, 2500, 0, 5000, 4000, 2700, 2720));
            req.Sources.Slabs.Add(Slab(21, WeSlabKind.Ceiling, 0, 0, 2500, 4000, 2400, 2420));
            WePlannedElevation p = South(req);
            List<WeSpot> spots = p.Annotation.Spots.Where(sp => sp.Target.Kind == WeRefKind.CeilingBottom).ToList();
            Assert.SeqEq(new long[] { 21, 20 }, spots.Select(sp => sp.Target.ElementId), "хоёр тааз, доороос дээш");
            foreach (WeSpot sp in spots)
            {
                WeSlabInfo c = req.Sources.Slabs.Single(sl => sl.Id == sp.Target.ElementId);
                WeV3 w = WorldOf(p, sp);
                Assert.True(c.Covers(w), "spot нь ӨӨРИЙН таазны нүүр дээр: " + sp.Target.ElementId);
                Assert.Eq(Mm(c.Min.Z), Mm(w.Z), "өндөр = нүүр");
            }
            Assert.True(Math.Abs(spots[0].X - spots[1].X) > Fx.Mm(500), "ижил x дээр бөөгнөрөхгүй");
            Assert.True(p.Annotation.Notes.Any(n => n.Contains("Тааз 2 өөр өндөртэй") && n.Contains("2400") && n.Contains("2700")),
                        string.Join(" | ", p.Annotation.Notes));
        }

        [Test]
        public static void A_single_flat_ceiling_keeps_the_previous_spot_position()
        {
            WeRequest req = Room();
            req.Sources.Slabs.Add(Slab(20, WeSlabKind.Ceiling, 0, 0, 5000, 4000, 2700, 2720));
            WePlannedElevation p = South(req);
            WeSpot sp = p.Annotation.Spots.Single(s => s.Target.Kind == WeRefKind.CeilingBottom);
            double half = p.FaceLength / 2;
            Assert.Eq(Mm(Math.Min(-half + Fx.Mm(250), 0)), Mm(sp.X), "x = гадаргуугийн эхнээс 250 мм (өмнөхтэй ижил)");
            Assert.Eq(Mm(p.Box.Near / 2), Mm(sp.Depth), "гүн хэвээр");
            Assert.Eq(2700.0, Mm(sp.Y + p.Frame.Origin.Z));
            Assert.False(p.Annotation.Notes.Any(n => n.Contains("өөр өндөртэй") || n.Contains("налуу")), "нэг өндөр — тайлбаргүй");
        }

        [Test]
        public static void A_raised_platform_is_a_step_not_the_main_floor()
        {
            WeRequest req = Room();
            req.Sources.Slabs.Add(Slab(12, WeSlabKind.Floor, 3500, 0, 5000, 4000, 0, 150));   // тавцан баруун 1.5 м-т
            req.Sources.Slabs.Add(Slab(20, WeSlabKind.Ceiling, 0, 0, 5000, 4000, 2700, 2720));
            WePlannedElevation p = South(req);
            WeDimRow r1 = p.Annotation.Rows.Single(r => r.Group == WeDimGroup.Vertical1);
            Assert.True(r1.Refs.Any(x => x.Kind == WeRefKind.FloorTop && x.ElementId == 10), "гол шал = гадаргуугийн ихэнхэд харагдах (0,00)");
            Assert.False(r1.Refs.Any(x => x.ElementId == 12), "тавцан босоо гинжид биш");
            WeSpot main = p.Annotation.Spots.Single(sp => sp.Target.Kind == WeRefKind.FloorTop && sp.Target.ElementId == 10);
            Assert.Eq(0.0, Mm(main.Y + p.Frame.Origin.Z));
            WeSpot step = p.Annotation.Spots.Single(sp => sp.Target.Kind == WeRefKind.FloorTop && sp.Target.ElementId == 12);
            WeV3 w = WorldOf(p, step);
            Assert.True(req.Sources.Slabs.Single(sl => sl.Id == 12).Covers(w), "алхмын spot тавцан дээр");
            Assert.Eq(150.0, Mm(w.Z));
            Assert.False(step.Leader, "гадаргуугийн дунд — заагчгүй");
            Assert.True(p.Annotation.Notes.Any(n => n.Contains("Шал 2 өөр өндөртэй") && n.Contains("150")), string.Join(" | ", p.Annotation.Notes));
        }

        [Test]
        public static void Finish_floor_over_the_structural_slab_stays_the_main_floor()
        {
            // Өнгөлгөөний шал (30–100) бүтцийн хавтан (−200…0)-ийн ДЭЭР бүтэн — алхам биш, хамгийн өндөр нь гол (өмнөх дүрэм хэвээр).
            WeRequest req = Room();
            req.Sources.Slabs.Add(Slab(11, WeSlabKind.Floor, 0, 0, 5000, 4000, 30, 100));
            req.Sources.Slabs.Add(Slab(20, WeSlabKind.Ceiling, 0, 0, 5000, 4000, 2700, 2720));
            WePlannedElevation p = South(req);
            Assert.True(p.Annotation.Spots.Any(sp => sp.Target.Kind == WeRefKind.FloorTop && sp.Target.ElementId == 11), "өнгөлгөөний шал = гол");
            Assert.False(p.Annotation.Spots.Any(sp => sp.Target.Kind == WeRefKind.FloorTop && sp.Target.ElementId == 10), "бүтцийн хавтан харагдахгүй — spot-гүй");
            Assert.False(p.Annotation.Notes.Any(n => n.Contains("Шал") && n.Contains("өөр өндөртэй")));
        }

        [Test]
        public static void A_sloped_ceiling_spot_sits_on_its_plane_and_stays_out_of_the_vertical_chain()
        {
            WeRequest req = Room();
            var c = Slab(30, WeSlabKind.Ceiling, 0, 0, 5000, 4000, 2400, 2920);
            c.Planes[0] = new WeSlabPlane { Origin = Fx.P(0, 0, 2400), Normal = new WeV3(Fx.Mm(500), 0, -Fx.Mm(5000)).Normalized() };
            req.Sources.Slabs.Add(c);
            WePlannedElevation p = South(req);
            WeSpot sp = p.Annotation.Spots.Single(s => s.Target.Kind == WeRefKind.CeilingBottom);
            WeV3 w = WorldOf(p, sp);
            Assert.Eq(Math.Round(Mm(c.Planes[0].ZAt(w.X, w.Y)), 1), Mm(w.Z), "spot налуу нүүр ДЭЭР");
            Assert.True(Mm(w.Z) > 2401, "хайрцгийн доод (2400) биш — цэгийн бодит өндөр");
            Assert.False(p.Annotation.Rows.SelectMany(r => r.Refs).Any(x => x.Kind == WeRefKind.CeilingBottom && x.ElementId == 30),
                         "налуу тааз хэвтээ түвшинтэй зэрэгцээ биш — босоо хэмжээсгүй");
            Assert.True(p.Annotation.Notes.Any(n => n.StartsWith("Налуу тааз")), string.Join(" | ", p.Annotation.Notes));
            Assert.True(p.Annotation.Notes.Any(n => n.Contains("Тааз") && n.Contains("налуу")), "профайлын тайлбар");
        }

        [Test]
        public static void A_slope_across_the_view_reads_as_one_height_but_stays_out_of_the_chain()
        {
            // Налуу нь харах чиглэлд (зүүн/баруун хана): энэ дэлгээсийн дагуу өндөр тогтмол — тайлбарт «налуу X → X» гэж худал заахгүй.
            WeRequest req = Room();
            var c = Slab(30, WeSlabKind.Ceiling, 0, 0, 5000, 4000, 2400, 2920);
            c.Planes[0] = new WeSlabPlane { Origin = Fx.P(0, 0, 2400), Normal = new WeV3(Fx.Mm(500), 0, -Fx.Mm(5000)).Normalized() };
            req.Sources.Slabs.Add(c);
            WePlan plan = WallElevationPlanner.Plan(req, Fx.Ctx(s => s.Annotations = WeAnno.DefaultSet));
            WePlannedElevation east = plan.Items.Single(i => i.Frame.Look.AlmostEquals(new WeV3(1, 0, 0), 1e-6));
            Assert.False(east.Annotation.Notes.Any(n => n.Contains("Тааз") && n.Contains("налуу") && n.Contains("→")),
                         "тогтмол өндөр — «налуу X → X» биш: " + string.Join(" | ", east.Annotation.Notes));
            Assert.False(east.Annotation.Rows.SelectMany(r => r.Refs).Any(x => x.ElementId == 30), "налуу хавтгай — босоо гинжид орохгүй");
            Assert.True(east.Annotation.Spots.Any(sp => sp.Target.ElementId == 30), "spot level хэвээр");
        }

        [Test]
        public static void Profile_runs_follow_the_visible_surface_along_the_face()
        {
            WeRequest req = Room();
            req.Sources.Slabs.Add(Slab(20, WeSlabKind.Ceiling, 2500, 0, 5000, 4000, 2700, 2720));
            req.Sources.Slabs.Add(Slab(21, WeSlabKind.Ceiling, 0, 0, 2500, 4000, 2400, 2420));
            req.Sources.Slabs.Add(Slab(22, WeSlabKind.Ceiling, 0, 0, 1000, 4000, 2900, 2920));   // 21-ийн ДЭЭР (харагдахгүй)
            WePlannedElevation p = South(req);
            double half = p.FaceLength / 2;
            List<WeSurfaceRun> runs = WeSurfaceProfile.Along(p.Frame, req.Sources.Slabs, WeSlabKind.Ceiling, -half, half, -Fx.Mm(300),
                                                             double.NegativeInfinity, double.PositiveInfinity, Fx.Units);
            Assert.Eq(2, runs.Count, "хамгийн нам нь харагдана — 22 нь 21-ийн ард");
            Assert.True(runs.All(r => r.SlabId == 20 || r.SlabId == 21));
            Assert.Eq(Mm(p.FaceLength), Math.Round(Mm(runs.Sum(r => r.Length))), "бүтэн гадаргуу");
            Assert.SeqEq(new[] { 2400.0, 2700.0 }, WeSurfaceProfile.FlatHeights(runs, Fx.Mm(5)).Select(y => Mm(y + p.Frame.Origin.Z)));
            Assert.False(WeSurfaceProfile.AllSloped(runs, 20));
            Assert.Null(WeSurfaceProfile.Describe("Тааз", runs.Where(r => r.SlabId == 20), 0, Fx.Units), "нэг өндөр — тайлбаргүй");
            Assert.Eq(0, WeSurfaceProfile.Along(p.Frame, req.Sources.Slabs, WeSlabKind.Floor, -half, half, -Fx.Mm(300), Fx.Mm(500), Fx.Mm(600), Fx.Units).Count,
                      "өндрийн мужаас гадуур — хоосон");
        }
    }
}
