using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    /// <summary>
    /// Интерьерийн ханын дэлгээс (жишээ хуудас 205A-F, 205G-N, 206A-G — MAX ӨРГӨӨ A блок): баруун талын нарийн гинж
    /// «шал · шалны хүрээ 100 · хавтан 850 · тааз · хучилт» + «шалнаас тааз хүртэл»; розеткийн байрлал (шалнаас төв, ханын захаас төв);
    /// розеткийн шошго тэмдгийн дээр.
    /// </summary>
    public static class InteriorTests
    {
        private const long LevelLow = 1, LevelHigh = 2;
        private const long FloorFinish = 10, FloorSlab = 11, UpperSlab = 13, Ceiling = 20;
        private const long Sweep = 50, Wainscot = 51, Outlet1 = 60, Outlet2 = 61, CeilingLight = 62, Cabinet = 63;

        /// <summary>5000×4000 өрөө, урд ханан дээр: шалны хүрээ (0–100, 15 мм), гоёлын хавтан (нимгэн хана 30 мм, 0–850), хоёр розетк (z=1000).</summary>
        private static WeRequest Scene(Action<WeAnnoSources> tweak = null)
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            WeAnnoSources s = req.Sources;
            s.Levels.Add(new WeLevelInfo { Id = LevelLow, Name = "L01", Z = 0 });
            s.Levels.Add(new WeLevelInfo { Id = LevelHigh, Name = "L02", Z = Fx.Mm(4000) });
            s.Slabs.Add(Slab(FloorFinish, WeSlabKind.Floor, -100, 0));
            s.Slabs.Add(Slab(FloorSlab, WeSlabKind.Floor, -300, -100));
            s.Slabs.Add(Slab(UpperSlab, WeSlabKind.Floor, 3900, 4000));
            s.Slabs.Add(Slab(Ceiling, WeSlabKind.Ceiling, 2700, 2720));
            s.Taggables.Add(new WeTaggable { Id = Sweep, CategoryKey = WeAnno.Finishes, Min = Fx.P(0, 0, 0), Max = Fx.P(5000, 15, 100) });
            s.Taggables.Add(new WeTaggable
            {
                Id = Wainscot, CategoryKey = WeAnno.Walls, Min = Fx.P(0, 25, 0), Max = Fx.P(5000, 55, 850),
                HasLine = true, LineA = Fx.P(0, 40), LineB = Fx.P(5000, 40), Width = Fx.Mm(30), WallUid = "wainscot",
            });
            // Урд ханыг урагш (−Y) харна: дотоод x = 2500 − X.  Розетк X=1220 → x=1280, X=900 → x=1600.
            s.Taggables.Add(Box(Outlet1, WeAnno.Electrical, 1180, 1260, 0, 40, 960, 1040));
            s.Taggables.Add(Box(Outlet2, WeAnno.Electrical, 860, 940, 0, 40, 960, 1040));
            s.Taggables.Add(Box(CeilingLight, WeAnno.Electrical, 2400, 2600, 1500, 1700, 2650, 2700));
            // Гүн шүүгээ (600 мм) — өнгөлгөөний бүс биш.
            s.Taggables.Add(Box(Cabinet, "casework", 3000, 4000, 0, 600, 0, 900));
            if (tweak != null) tweak(s);
            return req;
        }

        private static WeSlabInfo Slab(long id, WeSlabKind kind, double z0, double z1)
        {
            return new WeSlabInfo { Id = id, Kind = kind, Min = Fx.P(0, 0, z0), Max = Fx.P(5000, 4000, z1) };
        }

        private static WeTaggable Box(long id, string key, double x0, double x1, double y0, double y1, double z0, double z1)
        {
            return new WeTaggable { Id = id, CategoryKey = key, Min = Fx.P(x0, y0, z0), Max = Fx.P(x1, y1, z1) };
        }

        private static WePlannedElevation South(WeRequest req, Action<WeSettings> tweak = null)
        {
            WePlan plan = WallElevationPlanner.Plan(req, Fx.Ctx(tweak));
            string uid = req.WallLookup[req.Rooms[0].Loops[0].Segments[0].WallUniqueId].UniqueId;
            return plan.Items.Single(i => i.WallUid == uid);
        }

        private static double Mm(double ft) { return Math.Round(ft * WeFixedUnits.MmPerFoot, 1); }

        [Test]
        public static void Finish_bands_join_the_detailed_vertical_chain()
        {
            WePlannedElevation south = South(Scene());
            List<WeDimRow> vertical = south.Annotation.Rows.Where(r => r.Vertical && r.Group != WeDimGroup.PointHeight).OrderBy(r => r.At).ToList();
            Assert.SeqEq(new[] { WeDimGroup.Vertical1, WeDimGroup.Vertical2 }, vertical.Select(r => r.Group),
                "давхар хоорондын эгнээтэй үед: нарийн гинж · давхар хоорондын (MITIC 215A-D)");
            vertical = South(Scene(), s => s.Annotations = WeAnno.DefaultSet.Replace("levels:dim,", string.Empty))
                .Annotation.Rows.Where(r => r.Vertical && r.Group != WeDimGroup.PointHeight).OrderBy(r => r.At).ToList();
            Assert.SeqEq(new[] { WeDimGroup.Vertical1, WeDimGroup.ClearHeight }, vertical.Select(r => r.Group),
                "давхар хоорондыгүй үед: нарийн гинж · шалнаас тааз (MAX ӨРГӨӨ 206A-G)");
            WeDimRow r1 = vertical[0];
            Assert.SeqEq(new[] { -100.0, 0, 100, 850, 2700, 3900 }, r1.Refs.Select(r => Mm(r.Pos)),
                "шалны зузаан · шалны хүрээ 100 · хавтан 850 · тааз · хучилт");
            Assert.SeqEq(new[] { Sweep, Wainscot }, r1.Refs.Where(r => r.Kind == WeRefKind.ElementTop).Select(r => r.ElementId));
            Assert.SeqEq(new[] { 0.0, 2700, 3900 }, vertical[1].Refs.Select(r => Mm(r.Pos)), "2700 · 1200 — жишээ хуудасны гадна гинж");
            Assert.True(vertical[0].At < vertical[1].At, "дотроос гадагш");
            Assert.Eq(2, south.Annotation.Census.Single(c => c.CategoryKey == WeAnno.Finishes).Count, "шалны хүрээ + хавтан танигдана");
        }

        [Test]
        public static void Without_bands_the_vertical_rows_stay_as_before()
        {
            WeRequest req = Scene(s => s.Taggables.RemoveAll(t => t.Id == Sweep || t.Id == Wainscot));
            WePlannedElevation south = South(req);
            Assert.False(south.Annotation.Rows.Any(r => r.Group == WeDimGroup.ClearHeight), "бүсгүй бол «шалнаас тааз» эгнээ нэмэгдэхгүй");
            WePlannedElevation off = South(Scene(), s => s.Annotations = WeAnno.DefaultSet.Replace("finishes:dim,", string.Empty));
            Assert.False(off.Annotation.Rows.SelectMany(r => r.Refs).Any(r => r.Kind == WeRefKind.ElementTop), "унтраавал бүсийн ирмэг хэмжигдэхгүй");
        }

        [Test]
        public static void Deep_casework_is_not_a_finish_band()
        {
            WePlannedElevation south = South(Scene());
            Assert.False(south.Annotation.Rows.SelectMany(r => r.Refs).Any(r => r.ElementId == Cabinet && (r.Kind == WeRefKind.ElementTop || r.Kind == WeRefKind.ElementBottom)),
                "600 мм гүн шүүгээ — хавтан биш");
        }

        [Test]
        public static void Outlets_get_height_and_position_dimensions_inside_the_elevation()
        {
            WePlannedElevation south = South(Scene());
            WeDimRow h = south.Annotation.Rows.Single(r => r.Group == WeDimGroup.PointHeight);
            Assert.SeqEq(new[] { WeRefKind.FloorTop, WeRefKind.ElementCenterY }, h.Refs.Select(r => r.Kind), "шалнаас розеткийн төв хүртэл");
            Assert.SeqEq(new[] { 0.0, 1000 }, h.Refs.Select(r => Mm(r.Pos)));
            Assert.Eq(Outlet1, h.Refs[1].ElementId, "бүлгийн зүүн розетк");
            Assert.True(h.At > south.Box.MinX && h.At < Fx.Mm(1280 - 40), "босоо хэмжээс розеткийн зүүн талд, дэлгээс дотор");

            WeDimRow p = south.Annotation.Rows.Single(r => r.Group == WeDimGroup.PointPosition);
            Assert.SeqEq(new[] { WeRefKind.ElementCenterX, WeRefKind.ElementCenterX, WeRefKind.FaceEnd }, p.Refs.Select(r => r.Kind),
                "ойрын (баруун) ханын захаас розетк бүрийн төв хүртэл");
            Assert.SeqEq(new[] { 1280.0, 1600, 2500 }, p.Refs.Select(r => Mm(r.Pos)));
            Assert.True(p.At > Fx.Mm(1040) && p.At < south.Box.MaxY, "розеткийн дээгүүр");
            Assert.False(south.Annotation.Rows.SelectMany(r => r.Refs).Any(r => r.ElementId == CeilingLight), "таазны гэрэл хэмжигдэхгүй");
            Assert.Eq(2, south.Annotation.Census.Single(c => c.CategoryKey == WeAnno.Electrical).Count, "таазны гэрэл танилтад ч орохгүй");
        }

        [Test]
        public static void Outlets_at_different_heights_get_separate_groups()
        {
            WeRequest req = Scene(s => s.Taggables.Add(Box(70, WeAnno.Electrical, 2000, 2080, 0, 40, 1360, 1440)));
            WePlannedElevation south = South(req);
            Assert.Eq(2, south.Annotation.Rows.Count(r => r.Group == WeDimGroup.PointHeight), "1000 ба 1400 — хоёр босоо");
            Assert.Eq(2, south.Annotation.Rows.Count(r => r.Group == WeDimGroup.PointPosition), "хоёр хэвтээ гинж");
            WeDimRow upper = south.Annotation.Rows.Where(r => r.Group == WeDimGroup.PointPosition).OrderBy(r => r.At).Last();
            // X=2040 → x=460 — зүүн (−2500) захаас хол, баруун (2500) захаас ч хол; ойр нь баруун.
            Assert.SeqEq(new[] { 460.0, 2500 }, upper.Refs.Select(r => Mm(r.Pos)));
        }

        [Test]
        public static void Outlet_tags_sit_above_the_symbol()
        {
            WePlannedElevation south = South(Scene());
            List<WeTagItem> tags = south.Annotation.Tags.Where(t => t.CategoryKey == WeAnno.Electrical).OrderBy(t => t.ElementId).ToList();
            Assert.SeqEq(new[] { Outlet1, Outlet2 }, tags.Select(t => t.ElementId), "розетк бүрд шошго, таазны гэрэлд үгүй");
            Assert.True(tags.All(t => !t.Leader && t.HeadY > Fx.Mm(1040)), "шошго тэмдгийн дээр (тэмдгийг далдлахгүй)");
            Assert.Eq(1280.0, Mm(tags[0].HeadX));
        }

        [Test]
        public static void Previous_defaults_upgrade_to_the_interior_default()
        {
            foreach (string old in WeAnno.PreviousDefaultSets)
            {
                var s = new WeSettings { Annotations = old };
                WeSettings r = WeSettings.Deserialize(s.Serialize());
                Assert.True(r.Annotate(WeAnno.Electrical, WeAnno.Dim) && r.Annotate(WeAnno.Finishes, WeAnno.Dim) && r.Annotate("furniture", WeAnno.Tag),
                    "хуучин өгөгдмөл → интерьерийн мөрүүд нэмэгдэнэ");
            }
            Assert.True(WeAnno.Applicable(WeAnno.Electrical, WeAnno.Tag) && !WeAnno.Applicable(WeAnno.Finishes, WeAnno.Tag), "өнгөлгөөний бүсэд шошго байхгүй");
        }

        [Test]
        public static void Finish_keynotes_wall_panel_above_and_sweep_below()
        {
            WePlannedElevation south = South(Scene());
            List<WeTagItem> k = south.Annotation.Tags.Where(t => t.Keynote && t.CategoryKey == WeAnno.Finishes).OrderBy(t => t.ElementId).ToList();
            Assert.SeqEq(new[] { Sweep, Wainscot }, k.Select(t => t.ElementId), "шалны хүрээ + хавтан — тус бүр нэг keynote");
            Assert.True(k.All(t => t.Leader), "leader-тэй");
            WeTagItem sweep = k[0], panel = k[1];
            double lowest = south.Annotation.Rows.Where(r => !r.Vertical && r.At < south.Box.MinY).Select(r => r.At).DefaultIfEmpty(south.Box.MinY).Min();
            Assert.True(sweep.HeadY < lowest, "шалны хүрээний keynote хамгийн доод хэвтээ хэмжээсний ДООР");
            Assert.True(sweep.AnchorY > 0 && sweep.AnchorY < Fx.Mm(100), "заагч шалны хүрээн дээр");
            Assert.True(panel.HeadY > south.Box.MaxY, "хавтангийн keynote дэлгээсийн ДЭЭР");
            Assert.True(panel.AnchorY > Fx.Mm(500) && panel.AnchorY < Fx.Mm(850), "заагч хавтангийн дээд хэсэгт");
        }

        [Test]
        public static void Finish_keynotes_one_per_type()
        {
            // Хоёр ижил төрлийн шалны хүрээ (урд ханын хоёр хэсэг) — нэг keynote, урт хэсэг дээр.
            WeRequest req = Scene(s =>
            {
                s.Taggables.RemoveAll(t => t.Id == Sweep);
                s.Taggables.Add(new WeTaggable { Id = 52, CategoryKey = WeAnno.Finishes, TypeId = 900, Min = Fx.P(0, 0, 0), Max = Fx.P(1500, 15, 100) });
                s.Taggables.Add(new WeTaggable { Id = 53, CategoryKey = WeAnno.Finishes, TypeId = 900, Min = Fx.P(1600, 0, 0), Max = Fx.P(5000, 15, 100) });
            });
            WePlannedElevation south = South(req);
            List<WeTagItem> k = south.Annotation.Tags.Where(t => t.Keynote && t.CategoryKey == WeAnno.Finishes && t.ElementId != Wainscot).ToList();
            Assert.Eq(1, k.Count, "төрөл бүрээс нэг");
            Assert.Eq(53L, k[0].ElementId, "харагдах хэсэг нь урт");
            WePlannedElevation off = South(Scene(), s => s.Annotations = WeAnno.DefaultSet.Replace(",finishes:keynote", string.Empty));
            Assert.False(off.Annotation.Tags.Any(t => t.CategoryKey == WeAnno.Finishes), "унтраавал keynote-гүй");
        }

        [Test]
        public static void Interior_annotations_change_the_digest()
        {
            WePlannedElevation with = South(Scene());
            WePlannedElevation without = South(Scene(s => s.Taggables.RemoveAll(t => t.Id == Outlet1)));
            Assert.True(with.Annotation.Digest != without.Annotation.Digest, "розетк хасагдвал дэлгээсийн тэмдэглэгээ шинэчлэгдэнэ");
        }
    }
}
