using System;
using RevitMcpAddin.Ui.Core;

namespace RevitMcpAddin.Ui.Tests
{
    /// <summary>Цонхны хэмжээ/байрлал: ажлын талбараас хэтрэхгүй, дэлгэц салгахад аврагдана, олон дэлгэцэд зөв.</summary>
    public static class WindowFitTests
    {
        // 1366×768 физик, 125 % масштаб → ажлын талбар (таскбар хасаад) ≈ 1093 × 582 DIP
        private static readonly UiRect Laptop125 = new UiRect(0, 0, 1093, 582);
        private static readonly UiRect Full1080 = new UiRect(0, 0, 1920, 1040);

        private static FitRequest Req(double w, double h, double minW, double minH, UiRect wa)
        {
            return new FitRequest { DesiredWidth = w, DesiredHeight = h, MinWidth = minW, MinHeight = minH, WorkArea = wa };
        }

        private static void AssertInside(FitResult r, UiRect wa)
        {
            Assert.True(r.Left >= wa.Left - 1e-9 && r.Top >= wa.Top - 1e-9, "зүүн/дээд хилээс гарсан: " + r.Left + "," + r.Top);
            Assert.True(r.Left + r.Width <= wa.Right + 1e-9, "баруун хилээс гарсан");
            Assert.True(r.Top + r.Height <= wa.Bottom + 1e-9, "доод хилээс гарсан");
        }

        [Test]
        public static void Big_window_is_clamped_to_a_small_work_area()
        {
            // SheetNumerator 1180×780 (min 960×620) 1366×768@125% дээр
            FitResult r = WindowFit.Compute(Req(1180, 780, 960, 620, Laptop125));
            Assert.Eq(1093.0, r.Width);
            Assert.Eq(582.0, r.Height);
            Assert.Eq(960.0, r.MinWidth);
            Assert.Eq(582.0, r.MinHeight, "доод өндөр ажлын талбараас том байж болохгүй");
            AssertInside(r, Laptop125);
        }

        [Test]
        public static void Minimum_size_never_exceeds_work_area_at_150_percent()
        {
            // 1366×768@150% ≈ 911 × 485 DIP: ChangeImpact min 1000×620-ийг WPF албадах тул ЭНД хязгаарлана.
            var wa = new UiRect(0, 0, 911, 485);
            FitResult r = WindowFit.Compute(Req(1320, 820, 1000, 620, wa));
            Assert.Eq(911.0, r.MinWidth);
            Assert.Eq(485.0, r.MinHeight);
            Assert.Eq(911.0, r.MaxWidth);
            Assert.Eq(485.0, r.MaxHeight);
            Assert.Eq(911.0, r.Width);
            AssertInside(r, wa);
        }

        [Test]
        public static void Window_smaller_than_work_area_is_kept_and_centred_on_work_area_without_owner()
        {
            FitResult r = WindowFit.Compute(Req(800, 600, 600, 400, Full1080));
            Assert.Eq(800.0, r.Width);
            Assert.Eq(600.0, r.Height);
            Assert.Eq(560.0, r.Left);
            Assert.Eq(220.0, r.Top);
            Assert.True(r.Centered);
            Assert.False(r.UsedSaved);
        }

        [Test]
        public static void Window_is_centred_over_the_owner_not_over_the_primary_monitor()
        {
            // Revit хоёр дахь (зүүн) дэлгэц дээр: ажлын талбар X = −1920…0
            var secondary = new UiRect(-1920, 0, 1920, 1040);
            var owner = new UiRect(-1700, 100, 1400, 800);      // Revit цонх дэлгэцийн дунд хэсэгт
            var req = Req(800, 600, 600, 400, secondary);
            req.Owner = owner;
            FitResult r = WindowFit.Compute(req);
            Assert.Eq(-1700 + (1400 - 800) / 2.0, r.Left);
            Assert.Eq(100 + (800 - 600) / 2.0, r.Top);
            AssertInside(r, secondary);
        }

        [Test]
        public static void Owner_hanging_off_the_work_area_still_yields_a_fully_visible_window()
        {
            var req = Req(800, 600, 600, 400, Full1080);
            req.Owner = new UiRect(1500, 800, 1000, 700);   // Revit цонх дэлгэцээс хагас хальсан
            FitResult r = WindowFit.Compute(req);
            AssertInside(r, Full1080);
        }

        [Test]
        public static void Saved_bounds_on_a_removed_monitor_are_ignored()
        {
            // Хадгалсан цонх X=3000 дээр байсан (3 дахь дэлгэц) — одоо ганц 1920-ийн дэлгэц.
            var req = Req(1000, 700, 700, 500, Full1080);
            req.Saved = new UiRect(3000, 100, 1000, 700);
            FitResult r = WindowFit.Compute(req);
            Assert.False(r.UsedSaved, "дэлгэц салгасан тул хадгалсан хилийг ашиглаж болохгүй");
            Assert.True(r.Centered);
            AssertInside(r, Full1080);
        }

        [Test]
        public static void Saved_bounds_that_are_mostly_offscreen_but_still_reachable_are_pulled_back_inside()
        {
            // 200 DIP нь л харагдаж байгаа (≥ 120×80) — ашиглана, гэхдээ бүхэлд нь дотогш татна.
            var req = Req(1000, 700, 700, 500, Full1080);
            req.Saved = new UiRect(1720, 300, 1000, 700);
            FitResult r = WindowFit.Compute(req);
            Assert.True(r.UsedSaved);
            AssertInside(r, Full1080);
            Assert.Eq(1000.0, r.Width);
        }

        [Test]
        public static void Saved_bounds_with_only_a_sliver_visible_are_rejected()
        {
            var req = Req(1000, 700, 700, 500, Full1080);
            req.Saved = new UiRect(1890, 1020, 1000, 700);   // 30×20 л харагдана — гарт барих боломжгүй
            Assert.False(WindowFit.Compute(req).UsedSaved);
        }

        [Test]
        public static void Saved_bounds_with_nan_or_tiny_size_are_rejected()
        {
            var a = Req(1000, 700, 700, 500, Full1080);
            a.Saved = new UiRect(double.NaN, 10, 800, 600);
            Assert.False(WindowFit.Compute(a).UsedSaved);
            var b = Req(1000, 700, 700, 500, Full1080);
            b.Saved = new UiRect(10, 10, 20, 20);
            Assert.False(WindowFit.Compute(b).UsedSaved);
            var c = Req(1000, 700, 700, 500, Full1080);
            c.Saved = new UiRect(10, 10, double.PositiveInfinity, 600);
            Assert.False(WindowFit.Compute(c).UsedSaved);
        }

        [Test]
        public static void Saved_size_is_re_clamped_when_the_work_area_shrank()
        {
            // Өмнө 1900 өргөн хадгалсан (том дэлгэц), одоо 1093 DIP-ийн ноутбук.
            var req = Req(1000, 700, 700, 500, Laptop125);
            req.Saved = new UiRect(0, 0, 1900, 1000);
            FitResult r = WindowFit.Compute(req);
            Assert.True(r.UsedSaved);
            Assert.Eq(1093.0, r.Width);
            Assert.Eq(582.0, r.Height);
            AssertInside(r, Laptop125);
        }

        [Test]
        public static void Degenerate_work_area_falls_back_to_a_safe_default()
        {
            FitResult r = WindowFit.Compute(Req(800, 600, 600, 400, new UiRect(0, 0, 0, 0)));
            Assert.True(r.Width > 0 && r.Height > 0);
            Assert.True(r.MaxWidth >= r.Width);
        }

        [Test]
        public static void Pixels_convert_to_dips_by_dpi_scale()
        {
            UiRect d = UiRect.PixelsToDips(new UiRect(0, 0, 1366, 728), 1.25);
            Assert.True(Math.Abs(d.Width - 1092.8) < 1e-9);
            Assert.True(Math.Abs(d.Height - 582.4) < 1e-9);
            // 0 / сөрөг масштаб → 1 гэж үзнэ (хуваалтын алдаа гаргахгүй)
            Assert.Eq(1366.0, UiRect.PixelsToDips(new UiRect(0, 0, 1366, 700), 0).Width);
        }
    }
}
