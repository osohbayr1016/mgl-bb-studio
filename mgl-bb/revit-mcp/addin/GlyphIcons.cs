using System;
using System.Collections.Generic;
using System.Globalization;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace RevitMcpAddin
{
    /// <summary>
    /// Ribbon товчны дүрсийг runtime үед фонтын глифээс зурна — repo-д binary
    /// asset хадгалахгүй. WPF өнгөт emoji (COLR font) дэмждэггүй тул Windows-ийн
    /// "Segoe Fluent Icons" (Win11) / "Segoe MDL2 Assets" (Win10) monochrome
    /// глифүүдийг брэндийн өнгөөр буддаг. Алдаа гарвал null → товч дүрсгүй үлдэнэ.
    ///
    /// ⚠️ ГЕОМЕТРИЙН ДҮРЭМ (2026-08-24-ний алдааны гол шалтгаан).
    /// RenderTargetBitmap(px, px, 192, 192) нь ЗУРГИЙН pixel-ийг авдаг ч, дотор нь
    /// зурах координат нь DIP — өөрөөр хэлбэл зурах талбай нь px / (192/96) = px/2
    /// DIP л байдаг.  Хуучин код emSize-д `px * 0.72` (=46 DIP) өгөөд, 32 DIP-ийн
    /// талбайд зурж, төвлүүлэхдээ pixel (px) ба DIP (text.Width)-ийг ХОЛИЖ бодож
    /// байсан.  Үр дүнд глиф ~1.4 дахин том, баруун доош гулссан → товч бүр дээр
    /// глифийн ЗҮСЭГДСЭН БУЛАН харагддаг байв (paper plane → «L», хүснэгт → «F»).
    /// Тиймээс доорх код:
    ///   • бүх тооцоог DIP-ээр хийнэ (талбай = pixel × pixel DIP),
    ///   • глифийн layout box биш, ЯГ БЭХИЙН хүрээг (BuildGeometry().Bounds) авч
    ///     оптик төвд нь тавина (layout box-д мөрийн зай багтдаг тул босоо тэнхлэгт
    ///     гулсдаг),
    ///   • масштабыг `natural` (фонт зохиогчийн харьцаа) дээр барьж, зөвхөн бэх нь
    ///     хайрцгаас хальсан тохиолдолд л багасгана → 7 товчны зурааны зузаан жигд.
    /// </summary>
    internal static class GlyphIcons
    {
        /// <summary>
        /// Нэг дүрсний код цэгүүд — эрэмбээр.  Segoe Fluent Icons (Win11) ба Segoe
        /// MDL2 Assets (Win10) хоёрын глифийн багц яг ижил БИШ тул эхнийх нь
        /// байхгүй бол дараагийнх руу шилжинэ (шалгалт: CharacterToGlyphMap).
        /// </summary>
        internal sealed class Glyph
        {
            public readonly int[] CodePoints;
            public Glyph(params int[] codePoints) { CodePoints = codePoints; }
        }

        // ── Товч тус бүрийн дүрс.  Бүгдийг 2026-08-24-нд Segoe Fluent Icons дээр
        //    нүдээр шалгасан (contact sheet render).  Сэлбэг код цэгүүд нь мөн
        //    шалгагдсан — «буруу зураг» гарахгүй.
        /// <summary>Тоо хэмжээ — тооцооны машин.</summary>
        public static readonly Glyph Quantity = new Glyph(0xE8EF, 0xE9F9, 0xE80A);
        /// <summary>PDF — «PDF» гэж бичсэн хуудас.</summary>
        public static readonly Glyph Pdf = new Glyph(0xEA90, 0xE8A5, 0xE749);
        /// <summary>Хүснэгт (Revit Schedule) — тор.</summary>
        public static readonly Glyph Table = new Glyph(0xE80A, 0xEA98, 0xE8A5);
        /// <summary>Тохиргоо — араа.</summary>
        public static readonly Glyph Settings = new Glyph(0xE713, 0xE9F5);
        /// <summary>Хуудас үүсгэх — давхарласан хоёр хуудас.</summary>
        public static readonly Glyph Sheets = new Glyph(0xE7C4, 0xE8A5, 0xE7C3);
        /// <summary>Хуудас дугаарлах — дээш/доош сумтай «эрэмбэлэх» (Sort, E8CB).  Segoe Fluent Icons дээр нүдээр шалгасан (2026-10-01); сэлбэг нь жагсаалт.</summary>
        public static readonly Glyph SheetNumerator = new Glyph(0xE8CB, 0xE8FD);
        /// <summary>Зураг холбох — гинжин холбоос.</summary>
        public static readonly Glyph Link = new Glyph(0xE71B);
        /// <summary>MGL туслах — робот (AI).</summary>
        public static readonly Glyph Assistant = new Glyph(0xE99A, 0xE90A);
        /// <summary>Хуулж тавих — хоёр давхарласан хуудас (Copy).  Нүдээр шалгаагүй (2026-09-28).</summary>
        public static readonly Glyph CopyTo = new Glyph(0xE8C8, 0xE16F);
        /// <summary>Зураг клонлох — давхарласан зургийн цуглуулга.  Segoe Fluent Icons дээр нүдээр шалгасан (2026-09-30).</summary>
        public static readonly Glyph CloneDrawings = new Glyph(0xE8B9, 0xF5ED, 0xE8C8);
        /// <summary>Автомат хэмжээс — гурвалжин ба шугам (drafting).  Segoe Fluent Icons дээр нүдээр шалгасан (2026-09-30); сэлбэг нь шугам (ruler).</summary>
        public static readonly Glyph AutoAnnotate = new Glyph(0xEB3C, 0xED5E);
        /// <summary>MGL нэвтрэлт (1.9.0 лиценз) — цоож (Lock, E72E); сэлбэг нь хүн (Contact, E77B).  Нүдээр шалгаагүй.</summary>
        public static readonly Glyph Account = new Glyph(0xE72E, 0xE77B);

        /// <summary>Icon фонтууд — эрэмбээр (Win11 → Win10).</summary>
        private static readonly string[] FontNames = { "Segoe Fluent Icons", "Segoe MDL2 Assets" };

        /// <summary>
        /// glyph-ийг pixel×pixel DIP хэмжээтэй товчны дүрс болгон зурна.  HiDPI
        /// дэлгэцэд цэвэрхэн байхын тулд bitmap нь 2× (192 DPI) — WPF/Revit нь DPI
        /// метадатаг уншиж DIP-ээр байрлуулна.
        /// </summary>
        /// <param name="glyph">Код цэгийн эрэмбэлсэн жагсаалт.</param>
        /// <param name="pixel">Товчны логик хэмжээ DIP-ээр (32 = Large, 16 = Small).</param>
        /// <param name="brush">Будах өнгө.  Хөлдөөсөн (Frozen) байвал хамгийн хурдан.</param>
        public static BitmapSource TryRender(Glyph glyph, int pixel, Brush brush)
        {
            if (glyph == null || glyph.CodePoints == null || pixel <= 0 || brush == null)
                return null;

            try
            {
                Typeface typeface;
                int codePoint;
                if (!Resolve(glyph, out typeface, out codePoint))
                    return null;

                const double Dpi = 192.0;              // 2× supersample
                double pixelsPerDip = Dpi / 96.0;
                int bitmapPx = (int)Math.Round(pixel * pixelsPerDip);
                double box = pixel;                    // зурах талбай DIP-ээр

                // emSize-ийг хайрцагтай тэнцүү авна: MDL2/Fluent глифүүд em дөрвөлжинг
                // бараг дүүргэж зурагдсан тул бэх нь ~0.75–1.0 em болно.
                var text = new FormattedText(
                    char.ConvertFromUtf32(codePoint),
                    CultureInfo.InvariantCulture,
                    FlowDirection.LeftToRight,
                    typeface,
                    box,
                    brush,
                    pixelsPerDip);

                Geometry geometry = text.BuildGeometry(new Point(0, 0));
                if (geometry == null)
                    return null;
                Rect ink = geometry.Bounds;            // ЯГ бэхийн хүрээ (layout box биш)
                if (ink.IsEmpty || ink.Width <= 0.01 || ink.Height <= 0.01)
                    return null;                       // хоосон/байхгүй глиф

                // 16px товчинд захын зай бага байх ёстой, эс бөгөөс дүрс уншигдахгүй.
                double margin = pixel <= 16 ? 0.04 : 0.09;
                double natural = 1.0 - 2.0 * margin;
                double fit = (box * natural) / Math.Max(ink.Width, ink.Height);
                double scale = Math.Min(natural, fit); // хальсан үед л багасгана

                var transform = new TransformGroup();
                transform.Children.Add(new TranslateTransform(
                    -ink.X - ink.Width / 2.0,
                    -ink.Y - ink.Height / 2.0));       // бэхийн төвийг эх рүү
                transform.Children.Add(new ScaleTransform(scale, scale));
                transform.Children.Add(new TranslateTransform(box / 2.0, box / 2.0));

                var visual = new DrawingVisual();
                using (DrawingContext dc = visual.RenderOpen())
                {
                    dc.PushTransform(transform);
                    dc.DrawGeometry(brush, null, geometry);
                    dc.Pop();
                }

                var bmp = new RenderTargetBitmap(
                    bitmapPx, bitmapPx, Dpi, Dpi, PixelFormats.Pbgra32);
                bmp.Render(visual);
                bmp.Freeze(); // ribbon өөр dispatcher context-оос ашиглаж болно
                return bmp;
            }
            catch
            {
                return null; // фонт байхгүй г.м — дүрсгүй, чимээгүй
            }
        }

        /* ============================================================== */
        /*  ФОНТЫН КЭШ                                                     */
        /* ============================================================== */

        /// <summary>Нэг глифийн шийдэгдсэн үр дүн (олдоогүй нь ч кэшлэгдэнэ).</summary>
        private sealed class Resolved
        {
            public Typeface Face;
            public int CodePoint;
            public bool Ok;
        }

        private static readonly object CacheGate = new object();
        private static readonly Dictionary<Glyph, Resolved> ResolveCache =
            new Dictionary<Glyph, Resolved>();
        private static List<KeyValuePair<Typeface, GlyphTypeface>> _fonts;

        /// <summary>
        /// Icon фонтуудыг НЭГ УДАА ачаална.
        ///
        /// ⚠️ ЯАГААД ЭНЭ ЧУХАЛ ВЭ (2026-08-26): урьд нь `Resolve` дуудлага бүрт
        /// `new FontFamily(name)` + `TryGetGlyphTypeface()` хийдэг байв.  Тэр нь
        /// фонтын файлыг уншиж, `CharacterToGlyphMap`-ийг (Segoe Fluent Icons-д
        /// мянга гаруй глиф) бүтээдэг.  Туузан цэсэнд 7 товч × 2 хэмжээ = 14
        /// дуудлага, глиф нь эхний фонтод байхгүй бол хоёр дахийг нь бас
        /// ачаалдаг — өөрөөр хэлбэл Revit-ийн ЭХЛЭЛИЙН thread дээр фонтыг
        /// 14-28 удаа дахин ачаалж байсан.
        ///
        /// Одоо: фонт хоёуланг нь нэг удаа, глиф бүрийн шийдлийг нэг удаа.
        /// </summary>
        private static List<KeyValuePair<Typeface, GlyphTypeface>> Fonts()
        {
            if (_fonts != null) return _fonts;

            var list = new List<KeyValuePair<Typeface, GlyphTypeface>>();
            foreach (string name in FontNames)
            {
                try
                {
                    var candidate = new Typeface(
                        new FontFamily(name),
                        FontStyles.Normal, FontWeights.Normal, FontStretches.Normal);

                    GlyphTypeface probe;
                    if (!candidate.TryGetGlyphTypeface(out probe) || probe.CharacterToGlyphMap == null)
                        continue;

                    list.Add(new KeyValuePair<Typeface, GlyphTypeface>(candidate, probe));
                }
                catch
                {
                    // Энэ фонт байхгүй — дараагийнх руу.
                }
            }

            _fonts = list;
            return _fonts;
        }

        /// <summary>
        /// Тухайн глифийг АГУУЛСАН эхний фонт + код цэгийг олно.  Зөвхөн фонтын
        /// НЭРИЙГ шалгах нь хангалтгүй: Segoe MDL2 Assets байгаа ч шинэ код цэг
        /// (ж: EA90 «PDF») дотор нь байхгүй байж болно — тэр үед хоосон дөрвөлжин
        /// (.notdef) зурагдана.  Тиймээс `CharacterToGlyphMap`-аар шалгана.
        ///
        /// Үр дүн нь глиф тутамд НЭГ УДАА тооцогдоод кэшлэгдэнэ.
        /// </summary>
        private static bool Resolve(Glyph glyph, out Typeface typeface, out int codePoint)
        {
            lock (CacheGate)
            {
                Resolved hit;
                if (ResolveCache.TryGetValue(glyph, out hit))
                {
                    typeface = hit.Face;
                    codePoint = hit.CodePoint;
                    return hit.Ok;
                }

                var found = new Resolved();
                foreach (KeyValuePair<Typeface, GlyphTypeface> kv in Fonts())
                {
                    foreach (int cp in glyph.CodePoints)
                    {
                        if (!kv.Value.CharacterToGlyphMap.ContainsKey(cp)) continue;
                        found.Face = kv.Key;
                        found.CodePoint = cp;
                        found.Ok = true;
                        break;
                    }
                    if (found.Ok) break;
                }

                // ⚠️ ОЛДООГҮЙГ Ч КЭШЛЭНЭ.  Эс тэгвээс байхгүй глиф дуудагдах бүрт
                // хоёр фонтыг дахин тэмтэрнэ.
                ResolveCache[glyph] = found;
                typeface = found.Face;
                codePoint = found.CodePoint;
                return found.Ok;
            }
        }
    }
}
