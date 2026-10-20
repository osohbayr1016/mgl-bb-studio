using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    /// <summary>
    /// 2026-10-14 (эзэн: «тавилгын хэмжээсийг ЗӨВ тавь»): тавилгын хэвтээ хэмжээс бодит харагдах геометрийн бүрхүүлээр (<see cref="WeTaggable.Hull"/>),
    /// bounding box-оор биш — хайрцаг нь далд/clearance геометр, дэлхийн тэнхлэгт зэрэгцсэн хэлбэрийн улмаас томордог.
    /// </summary>
    public static class FurnitureDimTests
    {
        private const long Table = 41;

        private static WeRequest Scene(bool hull)
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            WeAnnoSources s = req.Sources;
            s.Levels.Add(new WeLevelInfo { Id = 1, Name = "L01", Z = 0 });
            // Ширээ урд ханын өмнө: бодит хэлбэр x 2000–3000, y 200–800, өндөр 750; хайрцаг нь сандлын clearance-ийг агуулж x 1500–3500.
            var t = new WeTaggable { Id = Table, CategoryKey = "furniture", Min = Fx.P(1500, 100, 0), Max = Fx.P(3500, 1500, 900) };
            if (hull)
            {
                t.Hull = new List<WeV3> { Fx.P(2000, 200), Fx.P(3000, 200), Fx.P(3000, 800), Fx.P(2000, 800) };
                t.HullBottomZ = 0;
                t.HullTopZ = Fx.Mm(750);
            }
            s.Taggables.Add(t);
            return req;
        }

        private static WeDimRow ElementRow(WeRequest req)
        {
            WePlan plan = WallElevationPlanner.Plan(req, Fx.Ctx(x => x.Annotations = "walls:dim,furniture:dim"));
            string south = req.Rooms[0].Loops[0].Segments[0].WallUniqueId;
            WePlannedElevation p = plan.Items.Single(i => i.WallUid == south);
            return p.Annotation.Rows.SingleOrDefault(r => r.Group == WeDimGroup.Elements);
        }

        private static double Mm(double ft) { return Math.Round(ft * WeFixedUnits.MmPerFoot, 1); }

        [Test]
        public static void Furniture_is_dimensioned_by_its_visible_outline_not_its_box()
        {
            WeDimRow row = ElementRow(Scene(true));
            Assert.True(row != null, "тавилгын эгнээ");
            List<WeAnnoRef> table = row.Refs.Where(r => r.ElementId == Table).ToList();
            // Урагш харахад баруун = −X: дотоод x = 2500 − X.  Бодит ирмэг X 3000 → −500, X 2000 → 500 (хайрцаг −1000 / 1000 байсан).
            Assert.SeqEq(new[] { "ElementLeft -500", "ElementRight 500" }, table.Select(r => r.Kind + " " + Mm(r.Pos)), "бодит ирмэгээр");
            Assert.True(table.All(r => r.Exact), "ЯГ байрлал — Revit тал зөвхөн тэр цэгт таарсныг авна");
            Assert.True(table.All(r => Mm(r.Tol) <= 3.0), "хүлцэл 3 мм");
        }

        [Test]
        public static void Furniture_without_outline_keeps_the_old_box_behaviour()
        {
            WeDimRow row = ElementRow(Scene(false));
            List<WeAnnoRef> table = row.Refs.Where(r => r.ElementId == Table).ToList();
            Assert.SeqEq(new[] { "ElementLeft -1000", "ElementRight 1000" }, table.Select(r => r.Kind + " " + Mm(r.Pos)), "хайрцгаар");
            Assert.True(table.All(r => !r.Exact), "бүрхүүлгүй — ЯГ биш");
            Assert.True(table.All(r => Mm(r.Tol) >= 29.9), "хуучин хүлцэл 30 мм");
        }

        [Test]
        public static void Outline_digest_is_stable_between_runs()
        {
            // Ижил загвар дахин ажиллуулахад «шинэчлэгдэнэ» гэж худал хэлэхгүй (ЯГ лавлагааны «,x» тэмдэг тогтвортой).
            WeRequest req = Scene(true);
            Func<string> digest = () => WallElevationPlanner.Plan(req, Fx.Ctx(x => x.Annotations = "walls:dim,furniture:dim"))
                .Items.Single(i => i.WallUid == req.Rooms[0].Loops[0].Segments[0].WallUniqueId).Annotation.Digest;
            Assert.Eq(digest(), digest(), "тогтвортой");
        }

        [Test]
        public static void Convex_hull_keeps_only_the_outline()
        {
            var pts = new List<WeV3>
            {
                Fx.P(0, 0), Fx.P(1000, 0), Fx.P(1000, 600), Fx.P(0, 600),
                Fx.P(500, 300), Fx.P(500, 0), Fx.P(1000, 300), Fx.P(0, 0), Fx.P(250, 100),
            };
            List<WeV3> hull = WeHull.Convex(pts);
            Assert.Eq(4, hull.Count, "4 булан (дотоод, давхардсан, нэг шулуун дээрх цэг хасагдана)");
            Assert.Eq(0.0, Mm(hull.Min(p => p.X)), "зүүн");
            Assert.Eq(1000.0, Mm(hull.Max(p => p.X)), "баруун");
            Assert.Eq(600.0, Mm(hull.Max(p => p.Y)), "дээд");
            Assert.Eq(0, WeHull.Convex(new List<WeV3>()).Count, "хоосон");
        }
    }
}
