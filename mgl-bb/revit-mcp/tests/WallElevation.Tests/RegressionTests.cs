using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    /// <summary>
    /// Release gate-ийн regression тестүүд (`release-gate/wall-elevation/known-issues.json`).  Тест бүр ЯГ НЭГ алдааны механизмыг барина;
    /// засагдаагүй алдааг <see cref="KnownBugAttribute"/>-оор тэмдэглэнэ — засвар хийхэд атрибутыг ав, тест ногоон болох ёстой.
    /// </summary>
    public static class RegressionTests
    {
        private const double UpperLevelMm = 4500;

        private static WeSlabInfo Slab(long id, WeSlabKind kind, double x0, double y0, double x1, double y1, double z0, double z1)
        {
            return new WeSlabInfo { Id = id, Kind = kind, Min = Fx.P(x0, y0, z0), Max = Fx.P(x1, y1, z1) };
        }

        /// <summary>
        /// Хоёр давхар: доод өрөө 5000×4000 (L01 = 0), дээд айл L02 = 4500 — бүтцийн хавтан 4300–4500, дээд айлын өнгөлгөөний шал
        /// 4500–4560, дээд айлын тавилга (4500–5400) ба шалны хүрээ (4500–4600) доод өрөөний яг дээр.
        /// </summary>
        private static WeRequest TwoStoreys(double roomTopMm)
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            req.Rooms[0].TopZ = Fx.Mm(roomTopMm);
            WeAnnoSources s = req.Sources;
            s.Levels.Add(new WeLevelInfo { Id = 1, Name = "L01", Z = 0 });
            s.Levels.Add(new WeLevelInfo { Id = 2, Name = "L02", Z = Fx.Mm(UpperLevelMm) });
            s.Slabs.Add(Slab(10, WeSlabKind.Floor, 0, 0, 5000, 4000, -50, 0));
            s.Slabs.Add(Slab(11, WeSlabKind.Floor, 0, 0, 5000, 4000, -250, -50));
            s.Slabs.Add(Slab(12, WeSlabKind.Floor, 0, 0, 5000, 4000, 4300, 4500));
            s.Slabs.Add(Slab(13, WeSlabKind.Floor, 0, 0, 5000, 4000, 4500, 4560));
            s.Slabs.Add(Slab(20, WeSlabKind.Ceiling, 0, 0, 5000, 4000, 2750, 2770));
            // Дээд айлын тавилга, хүрээ — хана бүрийн өмнөх бүсэд (өрөөний дотор, ханаас 300 мм).
            s.Taggables.Add(new WeTaggable { Id = 900, CategoryKey = "furniture", Min = Fx.P(1000, 300, 4500), Max = Fx.P(4000, 700, 5400) });
            s.Taggables.Add(new WeTaggable { Id = 901, CategoryKey = "furniture", Min = Fx.P(4300, 1000, 4500), Max = Fx.P(4700, 3000, 5400) });
            s.Taggables.Add(new WeTaggable { Id = 902, CategoryKey = "furniture", Min = Fx.P(1000, 3300, 4500), Max = Fx.P(4000, 3700, 5400) });
            s.Taggables.Add(new WeTaggable { Id = 903, CategoryKey = "furniture", Min = Fx.P(300, 1000, 4500), Max = Fx.P(700, 3000, 5400) });
            return req;
        }

        /// <summary>Дээд давхрын (суурь нь дээд түвшинд эсвэл түүнээс дээш) бөгөөд дэлгээсийн гүнд орсон элемент crop-ийн босоо мужтай давхцсан бол — гоожилт.</summary>
        private static List<string> Leaks(WePlan plan, WeRequest req)
        {
            var leaks = new List<string>();
            double upper = Fx.Mm(UpperLevelMm);
            var upperItems = new List<KeyValuePair<string, KeyValuePair<WeV3, WeV3>>>();
            foreach (WeTaggable t in req.Sources.Taggables)
                if (t.Min.Z >= upper - Fx.Mm(1)) upperItems.Add(new KeyValuePair<string, KeyValuePair<WeV3, WeV3>>("taggable " + t.Id, new KeyValuePair<WeV3, WeV3>(t.Min, t.Max)));
            foreach (WeSlabInfo sl in req.Sources.Slabs)
                if (sl.Min.Z >= upper - Fx.Mm(1)) upperItems.Add(new KeyValuePair<string, KeyValuePair<WeV3, WeV3>>("slab " + sl.Id, new KeyValuePair<WeV3, WeV3>(sl.Min, sl.Max)));

            foreach (WePlannedElevation p in plan.Items.Where(i => i.Frame != null && i.Box != null))
            {
                double oz = p.Frame.Origin.Z;
                double cropLo = oz + p.Box.MinY, cropHi = oz + p.Box.MaxY;
                foreach (var e in upperItems)
                {
                    WeV3 c = (e.Value.Key + e.Value.Value) * 0.5;
                    WeV3 lc = p.Frame.ToLocal(c);
                    bool inFront = lc.X >= p.Box.MinX && lc.X <= p.Box.MaxX && lc.Z >= p.Box.Near && lc.Z <= p.Box.Far;
                    double overlap = Math.Min(cropHi, e.Value.Value.Z) - Math.Max(cropLo, e.Value.Key.Z);
                    if (inFront && overlap > Fx.Mm(1))
                        leaks.Add(p.Label + ": " + e.Key + " (" + Math.Round(overlap * 304.8) + " мм crop дотор, crop дээд хил "
                                  + Math.Round(cropHi * 304.8) + " мм, дээд түвшин " + UpperLevelMm + ")");
                }
            }
            return leaks;
        }

        /// <summary>
        /// WE-BUG-001 — доод өрөөний дэлгээст дээд айлын геометр орж ирдэг.  Механизм (Core дээр хэмжсэн, 2026-10-13):
        /// `WeAnnotationPlanner` хэмжээсний лавлагаа бүрийг (дээд давхрын түвшин, дээд хавтан) хүрээнд багтаах гэж crop-ийн дээд хилийг
        /// `лавлагаа + 100 мм` хүртэл өргөтгөдөг → дээд түвшнээс 100 мм дээш; Elevation харагдац зүсэхгүй тул тэр зурваст дээд айлын шал,
        /// тавилга харагдана.
        /// </summary>
        [Test]
        public static void Lower_room_elevation_shows_no_upper_storey_geometry_with_default_annotations()
        {
            WeRequest req = TwoStoreys(2800);
            List<string> leaks = Leaks(WallElevationPlanner.Plan(req, Fx.Ctx()), req);
            Assert.True(leaks.Count == 0, "дээд айлын геометр: " + string.Join("; ", leaks.Take(3)));
        }

        /// <summary>WE-BUG-001 (хоёр дахь механизм) — өрөөний Upper Limit = дээд түвшин бол тэмдэглэгээгүй ч crop = өрөөний дээд + 150 мм.</summary>
        [Test]
        public static void Room_bounded_by_the_upper_level_shows_no_upper_storey_geometry()
        {
            WeRequest req = TwoStoreys(UpperLevelMm);
            List<string> leaks = Leaks(WallElevationPlanner.Plan(req, Fx.Ctx(s => s.Annotations = string.Empty)), req);
            Assert.True(leaks.Count == 0, "дээд айлын геометр: " + string.Join("; ", leaks.Take(3)));
        }

        /// <summary>
        /// WE-BUG-001-ийн засварын хамгаалалт: хоёр давхар өндөр өрөө (атриум, орой 7000 нь L02 = 4500-аас дээш) завсрын түвшинд ТАСРАХГҮЙ —
        /// хүрээ өрөөний оройгоос дээшх эхний түвшнээр (L03 = 9000) хязгаарлагдана, өрөө бүтэн харагдана.
        /// </summary>
        [Test]
        public static void Double_height_room_is_not_cut_at_the_intermediate_level()
        {
            WeRequest req = TwoStoreys(7000);
            req.Sources.Levels.Add(new WeLevelInfo { Id = 3, Name = "L03", Z = Fx.Mm(9000) });
            foreach (WePlannedElevation p in WallElevationPlanner.Plan(req, Fx.Ctx()).Items.Where(i => i.Frame != null && i.Box != null))
            {
                double top = p.Frame.Origin.Z + p.Box.MaxY;
                Assert.True(top >= Fx.Mm(7000), p.Label + ": хүрээний дээд " + Math.Round(top * 304.8) + " < өрөөний орой 7000");
                Assert.True(top <= Fx.Mm(9000) + Fx.Mm(0.5), p.Label + ": хүрээ L03-аас дээш гарсан " + Math.Round(top * 304.8));
            }
        }

        /// <summary>Хяналт: тэмдэглэгээгүй, өрөө таазандаа хүрдэг (2800) бол дээд айл орохгүй — тест өөрөө гоожилтыг зөв илрүүлдэг эсэхийн суурь.</summary>
        [Test]
        public static void Control_without_annotations_and_a_ceiling_high_room_has_no_leak()
        {
            WeRequest req = TwoStoreys(2800);
            List<string> leaks = Leaks(WallElevationPlanner.Plan(req, Fx.Ctx(s => s.Annotations = string.Empty)), req);
            Assert.True(leaks.Count == 0, string.Join("; ", leaks));
            Assert.True(WallElevationPlanner.Plan(req, Fx.Ctx()).Items.Count(i => i.Box != null) == 4, "4 дэлгээс төлөвлөгдсөн");
        }
    }
}
