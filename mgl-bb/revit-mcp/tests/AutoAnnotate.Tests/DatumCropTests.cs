using RevitMcpAddin.AutoAnnotate.Core;

namespace RevitMcpAddin.AutoAnnotate.Tests
{
    /// <summary>
    /// 2026-10-08 (эзний хүсэлт №4): огтлол/дэлгээсийн тэнхлэг (босоо), түвшний (хэвтээ) үзүүрийг crop region-ы хилээс хэрэглэгчийн зайд.
    /// Эерэг = crop-оос гадагш, сөрөг = дотогш; бөмбөлгийн тал (эхлэл/төгсгөл) хадгалагдана; crop-оос гадуурх, налуу шугам хөндөгдөхгүй.
    /// </summary>
    public static class DatumCropTests
    {
        private static readonly AaCropRect Crop = new AaCropRect(0, 20, 0, 10);

        [Test]
        public static void Grid_ends_sit_at_the_given_distance_beyond_the_crop_and_keep_their_bubble_end()
        {
            // Тэнхлэг u = 5, доороос дээш зурсан (эхлэл = доод = бөмбөлгийн «1»).
            AaDatumPlan p = AaDatumCrop.Plan(5, -3, 5, 14, Crop, true, 1.5, 0.5);
            Assert.True(p.Ok);
            Assert.Eq(AaDatumOrient.Vertical, p.Orient);
            Assert.Near(-1.5, p.NewStartV, 1e-12, "доод үзүүр (1) = crop-ийн доод − 1.5");
            Assert.Near(10.5, p.NewEndV, 1e-12, "дээд үзүүр (2) = crop-ийн дээд + 0.5");
            Assert.Near(5, p.NewStartU, 1e-12);

            // Дээрээс доош зурсан шугам: эхлэл нь ДЭЭД хэвээр (End0 тал солигдохгүй).
            AaDatumPlan q = AaDatumCrop.Plan(5, 14, 5, -3, Crop, true, 1.5, 0.5);
            Assert.Near(10.5, q.NewStartV, 1e-12);
            Assert.Near(-1.5, q.NewEndV, 1e-12);
        }

        [Test]
        public static void Negative_distance_pulls_the_end_inside_the_crop()
        {
            AaDatumPlan p = AaDatumCrop.Plan(5, -3, 5, 14, Crop, true, -2, -1);
            Assert.Near(2, p.NewStartV, 1e-12);
            Assert.Near(9, p.NewEndV, 1e-12);
        }

        [Test]
        public static void Level_ends_use_left_and_right_distances()
        {
            AaDatumPlan p = AaDatumCrop.Plan(25, 4, -8, 4, Crop, false, 1, 2);
            Assert.True(p.Ok);
            Assert.Eq(AaDatumOrient.Horizontal, p.Orient);
            Assert.Near(22, p.NewStartU, 1e-12, "эхлэл баруун талд байсан — баруун + 2");
            Assert.Near(-1, p.NewEndU, 1e-12, "зүүн − 1");
            Assert.Near(4, p.NewStartV, 1e-12);
        }

        [Test]
        public static void Datums_outside_the_crop_skew_or_collapsing_are_left_alone()
        {
            Assert.Eq(AaDatumSkip.OutsideCrop, AaDatumCrop.Plan(25, 0, 25, 9, Crop, true, 1, 1).Skip);
            Assert.Eq(AaDatumSkip.OutsideCrop, AaDatumCrop.Plan(0, 12, 20, 12, Crop, false, 1, 1).Skip);
            Assert.Eq(AaDatumSkip.WrongOrientation, AaDatumCrop.Plan(0, 0, 3, 9, Crop, true, 1, 1).Skip, "налуу тэнхлэг");
            Assert.Eq(AaDatumSkip.WrongOrientation, AaDatumCrop.Plan(5, 0, 5, 9, Crop, false, 1, 1).Skip, "түвшин босоо биш");
            Assert.Eq(AaDatumSkip.TooShort, AaDatumCrop.Plan(5, 0, 5, 9, Crop, true, -6, -6).Skip, "дотогш зай хэт их");
            Assert.Eq(AaDatumSkip.Degenerate, AaDatumCrop.Plan(5, 5, 5, 5, Crop, true, 1, 1).Skip);
        }

        [Test]
        public static void New_points_stay_on_the_original_3d_line()
        {
            // Харагдацын v = 0 → 10 нь 3D-д 2 → 7 параметр болж хувирсан шугам: s = (target − v0) / (v1 − v0).
            Assert.Near(0.5, AaDatumCrop.ParamFor(0, 10, 5), 1e-12);
            Assert.Near(-0.15, AaDatumCrop.ParamFor(0, 10, -1.5), 1e-12);
            Assert.True(double.IsNaN(AaDatumCrop.ParamFor(0, 0, 5)));
        }

        [Test]
        public static void Options_validate_the_range_and_need_one_kind()
        {
            Assert.True(new AaDatumCropOptions().Validate() == null);
            Assert.True(new AaDatumCropOptions { Grids = false, Levels = false }.Validate() != null);
            Assert.True(new AaDatumCropOptions { GridTopMm = 500 }.Validate() != null);
            Assert.True(new AaDatumCropOptions { GridTopMm = 500, Grids = false }.Validate() == null, "унтраалттай төрлийн утгыг шалгахгүй");
            Assert.True(new AaDatumCropOptions { LevelLeftMm = double.NaN }.Validate() != null);
            Assert.True(new AaDatumCropOptions { GridBottomMm = -20 }.Validate() == null, "сөрөг = дотогш, зөвшөөрнө");
        }
    }
}
