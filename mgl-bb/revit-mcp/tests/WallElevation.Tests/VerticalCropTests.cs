using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    /// <summary>
    /// W07 (2026-10-16): дэлгээс тус бүрийн босоо хүрээ (доод/дээд хил, мм — өрөөний шалнаас).  Тогтоосон хил ЯГ, тэмдэглэгээ түүний ДОТОР,
    /// харагдац дээр хадгалагдаж дахин ажиллуулахад сэргэнэ, хэсэгчилсэн хүрээ ЗОРИУД (шалгагч «ханын өндрөөс бага» гэж унагахгүй, харин
    /// тогтоосон хилтэй таарахыг шалгана), дээд давхрын түвшнээс дээш бол анхааруулна.
    /// </summary>
    public static class VerticalCropTests
    {
        private const long LevelLow = 1, LevelHigh = 2, FloorFinish = 10, UpperSlab = 13, Ceiling = 20, Door = 30, Window = 31;

        /// <summary>AnnotationTests-ийн үзэгдэл: 5000×4000 өрөө, шал −100…0, тааз 2750, дээд давхар 4500 (хавтан 4200–4400), хаалга 0–2100, цонх 900–2100.</summary>
        private static WeRequest Scene()
        {
            WeRequest req = Fx.SquareRoom(5000, 4000);
            WeAnnoSources s = req.Sources;
            s.Levels.Add(new WeLevelInfo { Id = LevelLow, Name = "L01", Z = 0 });
            s.Levels.Add(new WeLevelInfo { Id = LevelHigh, Name = "L02", Z = Fx.Mm(4500) });
            s.Slabs.Add(Slab(FloorFinish, WeSlabKind.Floor, -100, 0));
            s.Slabs.Add(Slab(UpperSlab, WeSlabKind.Floor, 4200, 4400));
            s.Slabs.Add(Slab(Ceiling, WeSlabKind.Ceiling, 2750, 2770));
            WeWallInfo south = Wall(req, 0), east = Wall(req, 1);
            s.Inserts.Add(new WeInsertInfo { Id = Door, Kind = WeInsertKind.Door, HostWallUid = south.UniqueId, Center = Fx.P(1500, 0), HalfWidth = Fx.Mm(450), BottomZ = 0, TopZ = Fx.Mm(2100) });
            s.Inserts.Add(new WeInsertInfo { Id = Window, Kind = WeInsertKind.Window, HostWallUid = east.UniqueId, Center = Fx.P(5000, 2000), HalfWidth = Fx.Mm(600), BottomZ = Fx.Mm(900), TopZ = Fx.Mm(2100) });
            return req;
        }

        private static WeSlabInfo Slab(long id, WeSlabKind kind, double z0, double z1)
        {
            return new WeSlabInfo { Id = id, Kind = kind, Min = Fx.P(0, 0, z0), Max = Fx.P(5000, 4000, z1) };
        }

        private static WeWallInfo Wall(WeRequest req, int i) { return req.WallLookup[req.Rooms[0].Loops[0].Segments[i].WallUniqueId]; }

        private static WePlannedElevation Face(WePlan plan, WeRequest req, int wall)
        {
            string uid = Wall(req, wall).UniqueId;
            return plan.Items.Single(i => i.WallUid == uid);
        }

        private static string SouthKey(WeRequest req) { return Face(WallElevationPlanner.Plan(req, Fx.Ctx()), req, 0).Key; }

        private static WePlan Run(WeRequest req, Action<WeSettings> tweak = null) { return WallElevationPlanner.Plan(req, Fx.Ctx(tweak)); }

        private static Action<WeSettings> Crop(string key, double lo, double up)
        {
            return s => s.Crops[key] = new WeCropOverride { LowerMm = lo, UpperMm = up };
        }

        private static double Mm(double ft) { return Math.Round(ft * WeFixedUnits.MmPerFoot, 1); }

        /// <summary>Төлөвлөгөөг «үүсгэсэн» харагдац болгоно — босоо хүрээг харагдацын төлөвт хадгалсан мэт (Configure-ийн бичилт).</summary>
        private static List<WeExistingView> Existing(WePlan plan)
        {
            List<WeExistingView> list = Fx.AsExisting(plan);
            foreach (WeExistingView e in list)
            {
                WePlannedElevation p = plan.Items.Single(i => i.Key == e.Key);
                e.CropLowerMm = p.CropLowerMm;
                e.CropUpperMm = p.CropUpperMm;
            }
            return list;
        }

        // ── Дүрэм ─────────────────────────────────────────────────────

        [Test]
        public static void Resolve_prefers_the_dialog_then_the_view_then_auto()
        {
            WeVerticalCrop.Resolved r = WeVerticalCrop.Resolve(new WeCropOverride { LowerMm = -100, UpperMm = 2500 }, -150, 2400);
            Assert.Eq(-100.0, r.LowerMm, "цонхны утга харагдац дээр хадгалснаас давуу");
            Assert.Eq(2500.0, r.UpperMm);
            Assert.False(r.FromView);

            r = WeVerticalCrop.Resolve(null, -150, 2400);
            Assert.Eq(-150.0, r.LowerMm, "цонхонд өөрчлөөгүй — харагдац дээрх утга сэргэнэ");
            Assert.True(r.FromView);

            r = WeVerticalCrop.Resolve(new WeCropOverride(), -150, 2400);
            Assert.False(r.Declared, "хоёр тал хоосон = «Авто» — харагдац дээрх утга арилна");

            r = WeVerticalCrop.Resolve(null, double.NaN, double.NaN);
            Assert.False(r.Declared, "хадгалаагүй = авто");
            Assert.Null(r.Error);

            r = WeVerticalCrop.Resolve(null, 2000, 2050);
            Assert.False(r.Declared, "хүчингүй хадгалсан утга → авто");
            Assert.NotNull(r.Error, "шалтгаан чимээгүй алдагдахгүй");

            r = WeVerticalCrop.Resolve(new WeCropOverride { UpperMm = 1e9 }, double.NaN, double.NaN);
            Assert.False(r.Declared);
            Assert.NotNull(r.Error);
        }

        [Test]
        public static void Field_parser_accepts_blank_auto_and_numbers_only()
        {
            double v;
            Assert.True(WeVerticalCrop.TryParseField("", out v) && double.IsNaN(v), "хоосон = авто");
            Assert.True(WeVerticalCrop.TryParseField(" авто ", out v) && double.IsNaN(v));
            Assert.True(WeVerticalCrop.TryParseField("-150", out v) && v == -150);
            Assert.True(WeVerticalCrop.TryParseField("2 400 мм", out v) && v == 2400);
            Assert.True(WeVerticalCrop.TryParseField("−50", out v) && v == -50, "юникод хасах");
            Assert.True(WeVerticalCrop.TryParseField("1,5", out v) && Math.Abs(v - 1.5) < 1e-9);
            Assert.False(WeVerticalCrop.TryParseField("abc", out v));
            Assert.False(WeVerticalCrop.TryParseField("1e999", out v));
        }

        // ── Төлөвлөгч ─────────────────────────────────────────────────

        [Test]
        public static void Declared_crop_is_exact_and_annotation_does_not_grow_it()
        {
            WeRequest req = Scene();
            string key = SouthKey(req);
            WePlannedElevation auto = Face(Run(req), req, 0);
            Assert.True(auto.Box.MaxY > Fx.Mm(4000), "авто: дээд давхрын түвшин хүртэл");
            Assert.False(auto.HasDeclaredCrop);

            WePlannedElevation p = Face(Run(req, Crop(key, -150, 2400)), req, 0);
            Assert.Eq(-150.0, Mm(p.Box.MinY), "доод хил ЯГ");
            Assert.Eq(2400.0, Mm(p.Box.MaxY), "дээд хил ЯГ — тэмдэглэгээний лавлагаа (тааз 2750, түвшин 4500) томруулахгүй");
            Assert.True(p.HasDeclaredCrop);
            Assert.Eq(WeStatus.Ready, p.Status, "хэсэгчилсэн хүрээ ЗОРИУД — алдаа биш: " + p.Message);
            Assert.True((p.Message ?? string.Empty).Contains("хэсэгчилсэн"), "мессежид тэмдэглэнэ: " + p.Message);
            Assert.Eq(WeAction.Create, p.Action);
        }

        [Test]
        public static void Only_the_declared_side_is_fixed()
        {
            WeRequest req = Scene();
            string key = SouthKey(req);
            WePlannedElevation p = Face(Run(req, Crop(key, -50, double.NaN)), req, 0);
            Assert.Eq(-50.0, Mm(p.Box.MinY), "доод тал тогтоосон");
            Assert.Eq(4500.0, Mm(p.Box.MaxY), "дээд тал авто — дээд давхрын түвшин (WE-BUG-001-ийн хязгаар хэвээр)");
            Assert.True(double.IsNaN(p.CropUpperMm));
        }

        [Test]
        public static void Annotations_outside_the_declared_crop_are_dropped_with_a_note()
        {
            WeRequest req = Scene();
            string key = SouthKey(req);
            WePlannedElevation p = Face(Run(req, Crop(key, -150, 2400)), req, 0);
            foreach (WeDimRow r in p.Annotation.Rows.Where(r => r.Vertical))
                foreach (WeAnnoRef x in r.Refs)
                    Assert.True(x.Pos >= p.Box.MinY - 1e-6 && x.Pos <= p.Box.MaxY + 1e-6, "босоо лавлагаа хүрээнд: " + x.Kind + " " + Mm(x.Pos));
            Assert.False(p.Annotation.Spots.Any(sp => sp.Target.Kind == WeRefKind.CeilingBottom), "таазны spot (2750) хүрээнээс гадуур — хасагдана");
            Assert.True(p.Annotation.Spots.Any(sp => sp.Target.ElementId == Door), "хаалганы дээд spot (2100) хүрээнд — үлдэнэ");
            Assert.True(p.Annotation.Notes.Any(n => n.Contains("босоо хүрээнээс гадуур")), "хассаныг тэмдэглэнэ: " + string.Join(" | ", p.Annotation.Notes));
            Assert.True(double.IsNaN(p.Annotation.CeilingCutY), "таазаар таслах автомат хязгаар тогтоосон дээд хилд үйлчлэхгүй");

            // Хаалга бүхэлдээ хүрээнээс доош (2200–2800) — ирмэг, spot, шошго хаалганд ОГТ тавигдахгүй.
            WePlannedElevation high = Face(Run(req, Crop(key, 2200, 2800)), req, 0);
            Assert.False(high.Annotation.Spots.Any(sp => sp.Target.ElementId == Door), "хаалга харагдахгүй — spot алга");
            Assert.False(high.Annotation.Rows.SelectMany(r => r.Refs).Any(x => x.ElementId == Door), "хаалганы ирмэгийн хэмжээс алга");
            Assert.False(high.Annotation.Tags.Any(t => t.ElementId == Door), "хаалганы шошго алга");
        }

        [Test]
        public static void Declared_top_replaces_the_automatic_ceiling_cut()
        {
            // Таазны дээр шат (AnnotationTests-ийн трибун) — авто горимд хүрээ таазаар тасарна; хэрэглэгч дээд хил тогтоовол ТЭР хил.
            WeRequest req = Scene();
            req.Sources.Overheads.Add(new WeTaggable { Id = 60, CategoryKey = "stairs", Min = Fx.P(500, 3000, 0), Max = Fx.P(4500, 3900, 4400) });
            WePlannedElevation auto = Face(Run(req), req, 2);   // хойд хана — шат түүний өмнөх бүсэд
            Assert.False(double.IsNaN(auto.Annotation.CeilingCutY), "авто: таазаар таслах нөхцөл үүссэн (тест утгагүй биш)");
            Assert.Eq(2820.0, Mm(auto.Box.MaxY), "авто: таазны дээд нүүр + 50");

            WePlannedElevation p = Face(Run(req, Crop(auto.Key, -150, 3500)), req, 2);
            Assert.Eq(3500.0, Mm(p.Box.MaxY), "тогтоосон дээд хил ЯГ");
            Assert.True(double.IsNaN(p.Annotation.CeilingCutY), "тогтоосон дээд хилд таазаар таслах автомат дүрэм үйлчлэхгүй");
            Assert.False(p.Annotation.Notes.Any(n => n.Contains("таазаар таслав")), string.Join(" | ", p.Annotation.Notes));
        }

        [Test]
        public static void Annotation_planner_reports_the_fixed_bounds_and_places_rows_relative_to_them()
        {
            WeRequest req = Scene();
            WePlannedElevation src = Face(Run(req), req, 0);
            var item = new WePlannedElevation
            {
                Key = src.Key, Kind = src.Kind, WallUid = src.WallUid, WallUids = src.WallUids, WallIds = src.WallIds, WallId = src.WallId,
                Frame = src.Frame, FaceLength = src.FaceLength, FaceHeight = src.FaceHeight, Status = WeStatus.Ready,
                Box = new WeBox { MinX = src.Box.MinX, MaxX = src.Box.MaxX, MinY = Fx.Mm(600), MaxY = Fx.Mm(2400), Near = src.Box.Near, Far = src.Box.Far },
            };
            var input = new WeAnnoInput
            {
                Item = item, FaceLength = src.FaceLength, FaceHeight = src.FaceHeight, LevelZ = 0,
                FixedMinY = Fx.Mm(600), FixedMaxY = Fx.Mm(2400),
            };
            var s = new WeSettings();
            double minY, maxY;
            WeAnnotationPlan plan = WeAnnotationPlanner.Plan(input, req.Sources, s, Fx.Units, out minY, out maxY);
            Assert.Eq(600.0, Mm(minY), "доод хил ЯГ (лавлагааг багтаах гэж томрохгүй)");
            Assert.Eq(2400.0, Mm(maxY), "дээд хил ЯГ");
            List<WeDimRow> horizontal = plan.Rows.Where(r => !r.Vertical).ToList();
            Assert.True(horizontal.Count > 0, "хэвтээ гинж үлдэнэ (хаалганы ирмэг 0–2100 хүрээнд огтлолцоно)");
            Assert.True(horizontal.All(r => r.At < Fx.Mm(600) && r.At > Fx.Mm(600 - s.DimOffsetMm - 3 * s.DimStepMm)),
                "хэвтээ эгнээ тогтоосон доод хилийн ДООР: " + string.Join(", ", horizontal.Select(r => Mm(r.At))));
            Assert.False(plan.Rows.Any(r => r.Vertical && r.Refs.Any(x => x.Pos < Fx.Mm(599) || x.Pos > Fx.Mm(2401))), "босоо лавлагаа хүрээнд");
        }

        [Test]
        public static void Declared_top_above_the_next_level_warns_about_upstairs_geometry()
        {
            WeRequest req = Scene();
            string key = SouthKey(req);
            WePlannedElevation p = Face(Run(req, Crop(key, -150, 5200)), req, 0);
            Assert.Eq(5200.0, Mm(p.Box.MaxY), "хэрэглэгчийн ил шийдвэр — дээд давхрын түвшингөөр таслахгүй");
            Assert.Eq(WeStatus.Warning, p.Status, "дээд давхрын элемент харагдана — анхааруулга (хаахгүй)");
            Assert.True(p.Message.Contains("дээд давхрын"), p.Message);
            Assert.Eq(WeAction.Create, p.Action, "анхааруулгатай ч үүсгэнэ");

            WePlannedElevation deep = Face(Run(req, Crop(key, -900, 2400)), req, 0);
            Assert.Eq(WeStatus.Warning, deep.Status, "шалнаас 600 мм-ээс доош — доод давхрын элемент: " + deep.Message);
        }

        [Test]
        public static void Crop_that_misses_the_wall_is_review_and_not_generated()
        {
            WeRequest req = Scene();
            string key = SouthKey(req);
            WePlannedElevation p = Face(Run(req, Crop(key, 3000, 3500)), req, 0);
            Assert.Eq(WeStatus.RequiresReview, p.Status, "ханын гадаргуу (0–2800) огт харагдахгүй: " + p.Message);
            Assert.Eq(WeAction.Skip, p.Action, "таахгүй — үүсгэхгүй");

            WePlannedElevation inverted = Face(Run(req, Crop(key, 4000, double.NaN)), req, 0);
            Assert.Eq(WeStatus.RequiresReview, inverted.Status, "доод хил авто дээд хилээс дээш: " + inverted.Message);
        }

        [Test]
        public static void Invalid_dialog_values_fall_back_to_auto_with_the_reason()
        {
            WeRequest req = Scene();
            string key = SouthKey(req);
            WePlannedElevation p = Face(Run(req, Crop(key, 2000, 2050)), req, 0);
            Assert.False(p.HasDeclaredCrop, "100 мм-ээс бага өндөр — авто");
            Assert.True(p.Message.Contains("100 мм"), "шалтгаан: " + p.Message);
        }

        [Test]
        public static void Probe_points_move_into_the_visible_part()
        {
            WeRequest req = Scene();
            string key = SouthKey(req);
            WePlannedElevation p = Face(Run(req, Crop(key, 2000, 2600)), req, 0);
            foreach (WeV3 w in p.ProbePoints)
            {
                double y = p.Frame.ToLocal(w).Y;
                Assert.True(y > Fx.Mm(2000) && y < Fx.Mm(2600), "шалгалтын цэг харагдах хэсэгт: " + Mm(y));
            }
        }

        // ── Тэмдэг, хадгалалт, дахин ажиллуулах ─────────────────────

        [Test]
        public static void Signature_marks_a_declared_crop_and_auto_keeps_the_old_format()
        {
            WeRequest req = Scene();
            string key = SouthKey(req);
            WePlannedElevation auto = Face(Run(req), req, 0);
            Assert.False(auto.Signature.Contains(WeIdentity.CropMarker), "авто — хуучин тэмдэг (өмнө үүссэн харагдац Keep хэвээр)");
            WePlannedElevation p = Face(Run(req, Crop(key, -150, 2400)), req, 0);
            Assert.True(WeIdentity.GeometryPart(p.Signature).Contains(WeIdentity.CropMarker + "-150,2400"), "тогтоосон хил геометрийн хэсэгт: " + p.Signature);
            WePlannedElevation half = Face(Run(req, Crop(key, double.NaN, 2400)), req, 0);
            Assert.True(half.Signature.Contains(WeIdentity.CropMarker + "a,2400"), half.Signature);
        }

        [Test]
        public static void Rerun_restores_the_crop_from_the_view_and_reset_returns_to_auto()
        {
            WeRequest req = Scene();
            string key = SouthKey(req);
            WePlan first = Run(req, Crop(key, -150, 2400));
            req.Existing.AddRange(Existing(first));

            // Цонхонд юу ч өөрчлөөгүй — харагдац дээрх хүрээ сэргэж, харагдацад хүрэхгүй.
            WePlannedElevation again = Face(Run(req), req, 0);
            Assert.True(again.HasDeclaredCrop && again.CropFromView, "харагдац дээрх хүрээ сэргэнэ");
            Assert.Eq(2400.0, Mm(again.Box.MaxY));
            Assert.Eq(WeAction.Keep, again.Action, "өөрчлөлтгүй — Keep: " + again.ActionNote);

            // «Авто» — хадгалсныг арилгаж харагдацыг шинэчилнэ (хайрцаг өөрчлөгдөнө, тэмдэгт хүрээний тэмдэглэгээ алга).
            WePlannedElevation reset = Face(Run(req, s => s.Crops[key] = new WeCropOverride()), req, 0);
            Assert.False(reset.HasDeclaredCrop);
            Assert.Eq(WeAction.Update, reset.Action, "авто руу буцаахад шинэчилнэ");
            Assert.False(reset.Signature.Contains(WeIdentity.CropMarker));

            // Өөр хил — шинэчилнэ.
            WePlannedElevation changed = Face(Run(req, Crop(key, -150, 2600)), req, 0);
            Assert.Eq(WeAction.Update, changed.Action);
            Assert.Eq(2600.0, Mm(changed.Box.MaxY));
        }

        [Test]
        public static void Reset_is_an_update_even_when_the_declared_box_equals_the_auto_box()
        {
            WeRequest req = Fx.SquareRoom(4000, 3000);   // тэмдэглэгээний эх өгөгдөлгүй: авто = −150 … 2950
            WePlan auto = WallElevationPlanner.Plan(req, Fx.Ctx());
            WePlannedElevation a0 = auto.Items[0];
            string key = a0.Key;
            WePlan declared = WallElevationPlanner.Plan(req, Fx.Ctx(Crop(key, Mm(a0.Box.MinY), Mm(a0.Box.MaxY))));
            WePlannedElevation d0 = declared.Items.Single(i => i.Key == key);
            Assert.Eq(Mm(a0.Box.MaxY), Mm(d0.Box.MaxY), "хайрцаг ижил");
            Assert.False(a0.Signature == d0.Signature, "тогтоосон ↔ авто тэмдгээр ялгарна — «Авто» болгоход төлөв дахин бичигдэнэ");
        }

        // ── Шалгагч ──────────────────────────────────────────────────

        [Test]
        public static void Validator_accepts_an_intentional_partial_crop_and_checks_the_declared_bounds()
        {
            WeRequest req = Scene();
            string key = SouthKey(req);
            WePlannedElevation p = Face(Run(req, Crop(key, 900, 2400)), req, 0);
            List<WeValidationIssue> ok = WallElevationValidator.Check(p, Fx.SnapshotOf(p), true);
            Assert.True(ok.All(i => i.Severity <= WeStatus.Ready), "зөв хэрэгжсэн хэсэгчилсэн хүрээ — асуудалгүй: " + string.Join(" | ", ok.Select(i => i.Message)));

            // Revit тогтоосон хилийг хэрэгжүүлээгүй (өрөөний бүтэн өндөр гарсан) — «шалгах».
            WeViewSnapshot wrong = Fx.SnapshotOf(p);
            wrong.Center = p.Frame.ToWorld(p.Box.LocalCenter.X, Fx.Mm(1400), p.Box.LocalCenter.Z);
            wrong.Half = new WeV3(p.Box.Half.X, Fx.Mm(1550), p.Box.Half.Z);
            List<WeValidationIssue> off = WallElevationValidator.Check(p, wrong, true);
            Assert.True(off.Any(i => i.Severity == WeStatus.RequiresReview && i.Message.Contains("тохируулсан хил")), string.Join(" | ", off.Select(i => i.Message)));
            Assert.False(off.Any(i => i.Message.Contains("ханын өндрөөс бага")), "тогтоосон хүрээнд «ханын өндрөөс бага» шалгалт хэрэглэгдэхгүй");

            // Чиглэл, эх элементийн шалгалт тогтоосон хүрээнд ч хэвээр.
            WeViewSnapshot flipped = Fx.SnapshotOf(p);
            flipped.ViewDirection = -flipped.ViewDirection;
            Assert.True(WallElevationValidator.Check(p, flipped, true).Any(i => i.Severity == WeStatus.Failed), "буруу тал — Failed хэвээр");
            Assert.True(WallElevationValidator.Check(p, Fx.SnapshotOf(p), false).Any(i => i.Severity == WeStatus.Failed), "эх нь устсан — Failed хэвээр");
        }

        [Test]
        public static void Validator_still_fails_accidental_missing_coverage_without_a_declared_crop()
        {
            WeRequest req = Scene();
            WePlannedElevation p = Face(Run(req), req, 0);
            WeViewSnapshot shortView = Fx.SnapshotOf(p);
            shortView.Half = new WeV3(p.Box.Half.X, Fx.Mm(1000), p.Box.Half.Z);
            List<WeValidationIssue> issues = WallElevationValidator.Check(p, shortView, true);
            Assert.True(issues.Any(i => i.Severity == WeStatus.Failed && i.Message.Contains("ханын өндрөөс бага")),
                "санамсаргүй дутуу хүрээ — Failed хэвээр: " + string.Join(" | ", issues.Select(i => i.Message)));
        }

        [Test]
        public static void Wall_mode_crop_is_relative_to_the_wall_base()
        {
            var req = new WeRequest();
            WeWallInfo w = Fx.Wall(Fx.P(0, 0), Fx.P(4000, 0), new WeV3(0, -1, 0), 200, 3000);
            w.BottomZ = Fx.Mm(500);
            w.TopZ = Fx.Mm(3500);
            req.Walls.Add(w);
            WePlan first = WallElevationPlanner.Plan(req, Fx.Ctx(s => s.WallSide = WeWallSidePick.Exterior));
            WePlannedElevation a = Fx.Only(first);
            WePlannedElevation p = Fx.Only(WallElevationPlanner.Plan(req, Fx.Ctx(s => { s.WallSide = WeWallSidePick.Exterior; Crop(a.Key, 0, 1000)(s); })));
            Assert.Eq(500.0, Mm(p.Frame.Origin.Z), "суурь = ханын доод");
            Assert.Eq(0.0, Mm(p.Box.MinY));
            Assert.Eq(1000.0, Mm(p.Box.MaxY));
            Assert.Eq(500.0 + 1000.0, Mm(p.Frame.Origin.Z + p.Box.MaxY), "дээд хил дэлхийн 1500 мм");
        }
    }
}
