using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    /// <summary>
    /// Хэвтээ хэмжээсийг АНГИЛЛААР тусдаа эгнээнд (эзний шаардлага): тоноглол · хаалга, цонх · хана, тэнхлэг · нийт урт;
    /// ангиллын танилт (census); босоо дүрэм хэвээр.
    /// </summary>
    public static class DimGroupTests
    {
        private static double Mm(double ft) { return Math.Round(ft * WeFixedUnits.MmPerFoot, 1); }

        /// <summary>Ариун цэврийн өрөө 5000×4000: урд ханад хаалга, жорлон, угаалтуур, хаалт хана, тэнхлэг, сандал (өрөөний гүнд).</summary>
        private static WeRequest Bathroom()
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            WeAnnoSources s = req.Sources;
            s.Levels.Add(new WeLevelInfo { Id = 1, Name = "L01", Z = 0 });
            s.Levels.Add(new WeLevelInfo { Id = 2, Name = "L02", Z = Fx.Mm(4500) });
            s.Slabs.Add(new WeSlabInfo { Id = 10, Kind = WeSlabKind.Floor, Min = Fx.P(0, 0, -200), Max = Fx.P(5000, 4000, 0) });
            s.Slabs.Add(new WeSlabInfo { Id = 11, Kind = WeSlabKind.Floor, Min = Fx.P(0, 0, 4300), Max = Fx.P(5000, 4000, 4500) });
            s.Slabs.Add(new WeSlabInfo { Id = 20, Kind = WeSlabKind.Ceiling, Min = Fx.P(0, 0, 2700), Max = Fx.P(5000, 4000, 2720) });
            string south = req.Rooms[0].Loops[0].Segments[0].WallUniqueId;
            s.Inserts.Add(new WeInsertInfo { Id = 30, Kind = WeInsertKind.Door, HostWallUid = south, Center = Fx.P(4200, 0), HalfWidth = Fx.Mm(400), BottomZ = 0, TopZ = Fx.Mm(2100) });
            s.Grids.Add(new WeGridInfo { Id = 50, Name = "A1", A = Fx.P(2500, -3000), B = Fx.P(2500, 9000) });
            s.Taggables.Add(new WeTaggable { Id = 60, CategoryKey = "plumbing", Min = Fx.P(600, 100, 0), Max = Fx.P(1000, 800, 800) });
            s.Taggables.Add(new WeTaggable { Id = 61, CategoryKey = "plumbing", Min = Fx.P(3200, 100, 800), Max = Fx.P(3800, 600, 950) });
            s.Taggables.Add(new WeTaggable { Id = 70, CategoryKey = "walls", Min = Fx.P(1750, 0, 0), Max = Fx.P(1850, 1500, 2000),
                HasLine = true, LineA = Fx.P(1800, 0), LineB = Fx.P(1800, 1500), Width = Fx.Mm(100) });
            s.Taggables.Add(new WeTaggable { Id = 80, CategoryKey = "furniture", Min = Fx.P(2000, 1700, 0), Max = Fx.P(2400, 2100, 900) });
            return req;
        }

        private static WePlannedElevation South(WePlan plan)
        {
            return plan.Items.Single(i => i.Frame.Look.AlmostEquals(new WeV3(0, -1, 0), 1e-6));
        }

        private static WePlan Run(WeRequest req, string anno, Action<WeSettings> tweak = null)
        {
            return WallElevationPlanner.Plan(req, Fx.Ctx(s => { s.Annotations = anno; if (tweak != null) tweak(s); }));
        }

        [Test]
        public static void Rows_are_separated_by_category_from_inside_out()
        {
            WePlannedElevation p = South(Run(Bathroom(), "walls:dim,doors:dim,grids:dim,plumbing:dim"));
            List<WeDimRow> h = p.Annotation.Rows.Where(r => !r.Vertical).OrderByDescending(r => r.At).ToList();
            Assert.SeqEq(new[] { WeDimGroup.Elements, WeDimGroup.Openings, WeDimGroup.Reference, WeDimGroup.Overall }, h.Select(r => r.Group),
                "дэлгээснээс гадагш: тоноглол · нүх · хана/тэнхлэг · нийт");
            // Эгнээ бүр ханын хоёр захаар хаагдана, бусад ангилал холилдохгүй.
            foreach (WeDimRow r in h)
            {
                Assert.Eq(WeRefKind.FaceStart, r.Refs.First().Kind, r.Group);
                Assert.Eq(WeRefKind.FaceEnd, r.Refs.Last().Kind, r.Group);
            }
            Assert.SeqEq(new long[] { 61, 61, 60, 60 }, h[0].Refs.Skip(1).Take(4).Select(r => r.ElementId), "зөвхөн сантехник");
            Assert.SeqEq(new long[] { 30, 30 }, h[1].Refs.Skip(1).Take(2).Select(r => r.ElementId), "зөвхөн хаалга");
            Assert.SeqEq(new[] { WeRefKind.Grid, WeRefKind.ElementLeft, WeRefKind.ElementRight }, h[2].Refs.Skip(1).Take(3).Select(r => r.Kind), "тэнхлэг, хаалт хана");
            Assert.Eq(2, h[3].Refs.Count, "нийт урт");
            // Эгнээний зай = тохиргоо.
            double step = Fx.Mm(new WeSettings().DimStepMm);
            for (int i = 1; i < h.Count; i++) Assert.True(Math.Abs(h[i - 1].At - h[i].At - step) < 1e-9, "эгнээ хоорондын зай");
        }

        [Test]
        public static void Empty_rows_are_skipped_and_overall_can_be_switched_off()
        {
            WeRequest req = Bathroom();
            req.Sources.Taggables.RemoveAll(t => t.Id == 70);   // хаалт ханагүй
            WePlannedElevation p = South(Run(req, "walls:dim,doors:dim"));
            Assert.SeqEq(new[] { WeDimGroup.Openings, WeDimGroup.Overall }, p.Annotation.Rows.Where(r => !r.Vertical).OrderByDescending(r => r.At).Select(r => r.Group));
            WePlannedElevation q = South(Run(req, "walls:dim,doors:dim", s => s.OverallRow = false));
            Assert.SeqEq(new[] { WeDimGroup.Openings }, q.Annotation.Rows.Where(r => !r.Vertical).Select(r => r.Group));
            // Зөвхөн хана: нийт урт ганцаараа (унтраасан ч — эс бөгөөс хэвтээ хэмжээс огт үгүй болно).
            WePlannedElevation w = South(Run(req, "walls:dim", s => s.OverallRow = false));
            Assert.SeqEq(new[] { WeDimGroup.Overall }, w.Annotation.Rows.Where(r => !r.Vertical).Select(r => r.Group));
            // Хаалт ханатай: «хана» сонголт дундах ханыг өөрийн эгнээнд гаргана.
            WePlannedElevation r2 = South(Run(Bathroom(), "walls:dim,doors:dim"));
            Assert.SeqEq(new[] { WeDimGroup.Openings, WeDimGroup.Reference, WeDimGroup.Overall },
                r2.Annotation.Rows.Where(r => !r.Vertical).OrderByDescending(r => r.At).Select(r => r.Group));
        }

        [Test]
        public static void Without_wall_dims_rows_are_not_closed_and_need_two_refs()
        {
            WePlannedElevation p = South(Run(Bathroom(), "doors:dim,plumbing:dim"));
            List<WeDimRow> h = p.Annotation.Rows.Where(r => !r.Vertical).OrderByDescending(r => r.At).ToList();
            Assert.SeqEq(new[] { WeDimGroup.Elements, WeDimGroup.Openings }, h.Select(r => r.Group));
            Assert.True(h.All(r => r.Refs.All(x => x.Kind != WeRefKind.FaceStart && x.Kind != WeRefKind.FaceEnd)), "захгүй");
            Assert.Eq(2, h[1].Refs.Count, "хаалганы өргөн");
        }

        [Test]
        public static void Combined_mode_reproduces_the_single_chain()
        {
            WePlannedElevation p = South(Run(Bathroom(), "walls:dim,doors:dim,grids:dim,plumbing:dim", s => s.DimGrouping = WeDimGrouping.Combined));
            List<WeDimRow> h = p.Annotation.Rows.Where(r => !r.Vertical).OrderByDescending(r => r.At).ToList();
            Assert.SeqEq(new[] { WeDimGroup.Combined, WeDimGroup.Overall }, h.Select(r => r.Group));
            // зах 2 + хаалга 2 + тэнхлэг 1 + хаалт хана 2 + сантехник 4 − давхцал 1 (угаалтуурын зах = хаалганы ирмэг, x −1300)
            Assert.Eq(10, h[0].Refs.Count, "нэг гинжинд бүгд");
        }

        [Test]
        public static void Vertical_rules_are_unchanged_by_grouping()
        {
            foreach (WeDimGrouping g in new[] { WeDimGrouping.Separated, WeDimGrouping.Combined })
            {
                WePlannedElevation p = South(Run(Bathroom(), WeAnno.DefaultSet, s => s.DimGrouping = g));
                WeDimRow v1 = p.Annotation.Rows.Single(r => r.Group == WeDimGroup.Vertical1);
                Assert.SeqEq(new[] { WeRefKind.FloorBottom, WeRefKind.FloorTop, WeRefKind.CeilingBottom, WeRefKind.SlabBottom }, v1.Refs.Select(r => r.Kind));
                WeDimRow v2 = p.Annotation.Rows.Single(r => r.Group == WeDimGroup.Vertical2);
                Assert.Eq(4500.0, Mm(v2.Refs[1].Pos - v2.Refs[0].Pos), "давхар хоорондын");
                Assert.True(v2.At > v1.At, "2-р эгнээ гадна");
                Assert.SeqEq(new[] { WeRefKind.InsertTop }, p.Annotation.Spots.Where(s => s.Target.ElementId == 30).Select(s => s.Target.Kind), "хаалганд зөвхөн дээд spot");
            }
        }

        [Test]
        public static void Census_recognises_every_category_in_the_elevation()
        {
            WePlannedElevation p = South(Run(Bathroom(), "walls:dim,doors:dim,doors:spot,plumbing:tag"));
            Dictionary<string, WeCensusEntry> c = p.Annotation.Census.ToDictionary(x => x.CategoryKey);
            Assert.Eq(1, c[WeAnno.Doors].Count);
            Assert.True(c[WeAnno.Doors].Dimensioned && c[WeAnno.Doors].Spotted && !c[WeAnno.Doors].Tagged);
            Assert.Eq(2, c["plumbing"].Count);
            Assert.True(c["plumbing"].Tagged && !c["plumbing"].Dimensioned);
            Assert.Eq(2, c[WeAnno.Walls].Count, "харах хана + хаалт хана");
            Assert.Eq(1, c[WeAnno.Grids].Count);
            Assert.Eq(1, c[WeAnno.Ceilings].Count);
            Assert.Eq(2, c[WeAnno.Floors].Count, "шал + дээд хучилт");
            Assert.Eq(1, c["furniture"].Count, "өрөөний дунд хүртэл харах гүнд сандал харагдана");
            Assert.False(c.ContainsKey(WeAnno.Windows), "энэ ханад цонхгүй");
            Assert.SeqEq(WeAnno.Rows.Select(r => r.Key).Where(c.ContainsKey), p.Annotation.Census.Select(x => x.CategoryKey), "хүснэгтийн дараалал");
        }

        [Test]
        public static void Census_is_computed_even_without_annotations_and_does_not_change_the_signature()
        {
            WeRequest req = Bathroom();
            // Бүдэг хэсэг, улаан хүрээ (2026-10-14) унтраасан — тэдгээр ч тэмдэгт ордог.
            WePlannedElevation none = South(Run(req, string.Empty, s => { s.FadeMode = WeFadeMode.None; s.RedFrame = false; }));
            Assert.True(none.Annotation.IsEmpty);
            Assert.True(none.Annotation.Census.Count >= 5);
            Assert.True(none.Annotation.Census.All(x => !x.Dimensioned && !x.Tagged && !x.Spotted));
            Assert.Eq(WeIdentity.GeometryPart(none.Signature), none.Signature, "тэмдэглэгээгүй → тэмдэгт «|a:» залгахгүй");
        }

        [Test]
        public static void Fixed_depth_excludes_furniture_in_the_middle_of_the_room()
        {
            WePlannedElevation p = South(Run(Bathroom(), "furniture:dim", s => s.DepthMode = WeDepthMode.Fixed));
            Assert.False(p.Annotation.Census.Any(x => x.CategoryKey == "furniture"), "600 мм-ийн гүнд сандал (1700 мм) орохгүй");
            Assert.False(p.Annotation.Rows.Any(r => r.Group == WeDimGroup.Elements));
        }

        [Test]
        public static void Settings_round_trip_new_fields()
        {
            var s = new WeSettings
            {
                DimGrouping = WeDimGrouping.Combined, OverallRow = false, MergeCollinear = false, DepthMode = WeDepthMode.Fixed, MaxDepthMm = 4000,
                LabelPattern = "{Room}-{WallIndex}", TitlePattern = "", SheetNamePattern = "{Room} {RoomName} /{SideRange}/", KeyPlan = false, KeyPlanScale = 75,
                KeyPlanMarginMm = 800, Axon = false, AxonScale = 75, Perspectives = 3, LegendNames = new List<string> { "Материал", "Тэмдэглэгээ", "Материал", " " }, Output = WeOutputMode.ViewsAndSheets,
            };
            WeSettings r = WeSettings.Deserialize(s.Serialize());
            Assert.Eq(WeDimGrouping.Combined, r.DimGrouping);
            Assert.False(r.OverallRow);
            Assert.False(r.MergeCollinear);
            Assert.Eq(WeDepthMode.Fixed, r.DepthMode);
            Assert.Eq(4000.0, r.MaxDepthMm);
            Assert.Eq("{Room}-{WallIndex}", r.LabelPattern);
            Assert.Eq(string.Empty, r.TitlePattern, "хоосон гарчиг = тавихгүй (хадгалагдана)");
            Assert.Eq("{Room} {RoomName} /{SideRange}/", r.SheetNamePattern);
            Assert.False(r.KeyPlan);
            Assert.Eq(75, r.KeyPlanScale);
            Assert.Eq(800.0, r.KeyPlanMarginMm);
            Assert.False(r.Axon);
            Assert.Eq(75, r.AxonScale);
            Assert.Eq(3, r.Perspectives);
            Assert.SeqEq(new[] { "Материал", "Тэмдэглэгээ" }, r.LegendNames, "олон legend, давхардал/хоосон хасагдана");
            Assert.SeqEq(new[] { "Хуучин legend" }, WeSettings.Deserialize("legend=Хуучин legend\n").LegendNames, "хуучин файлын ганц legend");
            Assert.Eq(0, WeSettings.Deserialize("legends=\nlegend=Хуучин\n").LegendNames.Count, "шинэ түлхүүр (хоосон) хуучнаас давуу");
            Assert.Eq(0, r.Validate().Count, string.Join("; ", r.Validate()));

            // Хуучин (шинэ түлхүүргүй) файл → шинэ өгөгдмөл.
            WeSettings old = WeSettings.Deserialize("version=1\nscale=25\n");
            Assert.Eq(WeDimGrouping.Separated, old.DimGrouping);
            Assert.True(old.MergeCollinear && old.OverallRow && old.KeyPlan && old.Axon);
            Assert.Eq(WeDepthMode.HalfRoom, old.DepthMode);
            Assert.Eq(WeNaming.DefaultLabelPattern, old.LabelPattern);

            var bad = new WeSettings { LabelPattern = "{Room}{Foo}", Perspectives = 9, KeyPlanScale = 0 };
            List<string> errs = bad.Validate();
            Assert.True(errs.Any(e => e.Contains("{Foo}")) && errs.Any(e => e.Contains("Перспектив")) && errs.Any(e => e.Contains("Түлхүүр")), string.Join("; ", errs));
        }
    }
}
