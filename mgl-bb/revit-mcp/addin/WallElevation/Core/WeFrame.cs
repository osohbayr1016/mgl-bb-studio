using System;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>
    /// Дэлгээсний ДОТООД координат.  Харагч ханын урд зогсож <see cref="Look"/> чиглэлд (ханаруу) харна:
    ///   • <see cref="Right"/> = дэлгэцийн баруун (ханын дагуу), <c>Right = Look × Up</c>;
    ///   • <see cref="Up"/>    = босоо (+Z);
    ///   • <see cref="ViewDirection"/> = −Look — Revit-ийн <c>View.ViewDirection</c> (харагч руу) -тай ТЭНЦҮҮ байх ёстой.
    /// Right × Up = ViewDirection (баруун гарын систем) — <see cref="WallFrameCalculator.IsValid"/> шалгана.
    /// <see cref="Origin"/> = харах гадаргуу (эсвэл location line) -ийн ДУНД цэг, суурийн өндөр дээр.
    /// </summary>
    public sealed class WeFrame
    {
        public WeV3 Origin;
        public WeV3 Right;
        public WeV3 Up;
        public WeV3 Look;

        public WeV3 ViewDirection { get { return -Look; } }

        /// <summary>Дотоод (x = Right, y = Up, z = Look) → дэлхийн цэг.</summary>
        public WeV3 ToWorld(double x, double y, double z)
        {
            return Origin + Right * x + Up * y + Look * z;
        }

        /// <summary>Дэлхийн цэг → дотоод координат.</summary>
        public WeV3 ToLocal(WeV3 p)
        {
            WeV3 d = p - Origin;
            return new WeV3(d.Dot(Right), d.Dot(Up), d.Dot(Look));
        }
    }

    /// <summary>
    /// Дэлгээсний хайрцаг <see cref="WeFrame"/>-ийн ДОТООД координатаар.  z тэнхлэг = Look:
    /// <see cref="Near"/> (&lt; 0) = зүсэх хавтгай (харагч тал), <see cref="Far"/> (&gt; 0) = алсын хязгаар (ханын ард).
    /// </summary>
    public sealed class WeBox
    {
        public double MinX;
        public double MaxX;
        public double MinY;
        public double MaxY;
        public double Near;
        public double Far;

        public double Width { get { return MaxX - MinX; } }
        public double Height { get { return MaxY - MinY; } }
        public double Depth { get { return Far - Near; } }

        /// <summary>Хайрцгийн төв (дотоод).</summary>
        public WeV3 LocalCenter
        {
            get { return new WeV3((MinX + MaxX) / 2, (MinY + MaxY) / 2, (Near + Far) / 2); }
        }

        /// <summary>Хагас хэмжээ (x = өргөн/2, y = өндөр/2, z = гүн/2).</summary>
        public WeV3 Half
        {
            get { return new WeV3(Width / 2, Height / 2, Depth / 2); }
        }

        /// <summary>Дотоод цэг хайрцагт (хүлцэлтэй) багтах уу.</summary>
        public bool ContainsLocal(WeV3 p, double tol)
        {
            return p.X >= MinX - tol && p.X <= MaxX + tol
                && p.Y >= MinY - tol && p.Y <= MaxY + tol
                && p.Z >= Near - tol && p.Z <= Far + tol;
        }
    }

    /// <summary>
    /// Ханын координатын систем.  ⚠️ <c>Wall.Orientation</c>-д СОХРООР итгэхгүй: чиглэлийг location line /
    /// өрөөний хилийн сегментээс бодож, Orientation-оос ЗӨВХӨН ТЭМДЭГ (аль тал нь гадна) авна; дараа нь
    /// тэгш өнцөгт байдал, хэвтээ байдлыг шалгана.
    /// </summary>
    public static class WallFrameCalculator
    {
        /// <summary>Шулууны хэвтээ нэгж чиглэл (a → b); хэт богино бол Zero.</summary>
        public static WeV3 Tangent(WeV3 a, WeV3 b)
        {
            WeV3 d = (b - a).Flat();
            return d.Length < WeTol.MinWallLength ? WeV3.Zero : d.Normalized();
        }

        /// <summary>Шулууны ЗҮҮН талын нормаль (дээрээс харахад): Up × t.</summary>
        public static WeV3 LeftNormal(WeV3 tangent)
        {
            return WeV3.UnitZ.Cross(tangent).Normalized();
        }

        /// <summary>
        /// Ханын ГАДНА талын нормалыг шугамаас бодно; тэмдгийг <paramref name="orientationHint"/> (Wall.Orientation)-аас.
        /// Hint нь шугамд перпендикуляр биш (|cos| &lt; 0.5) эсвэл тэг бол false — тааж зохиохгүй.
        /// </summary>
        public static bool TryExteriorNormal(WeV3 tangent, WeV3 orientationHint, out WeV3 exterior)
        {
            exterior = WeV3.Zero;
            if (tangent.IsZero) return false;
            WeV3 left = LeftNormal(tangent);
            WeV3 hint = orientationHint.Flat().Normalized();
            if (hint.IsZero) return false;
            double c = hint.Dot(left);
            if (Math.Abs(c) < 0.5) return false;
            exterior = c > 0 ? left : -left;
            return true;
        }

        /// <summary>
        /// Хүрээ үүсгэнэ.  <paramref name="look"/> = харагчаас хана руу (хэвтээ, шугамд перпендикуляр байх ёстой).
        /// Origin = a-b шугамын дунд, <paramref name="baseZ"/> өндөрт.
        /// </summary>
        public static bool TryCreate(WeV3 a, WeV3 b, WeV3 look, double baseZ, out WeFrame frame, out string error)
        {
            frame = null;
            error = null;
            WeV3 t = Tangent(a, b);
            if (t.IsZero) { error = "Хэт богино хана/гадаргуу"; return false; }
            WeV3 l = look.Flat().Normalized();
            if (l.IsZero) { error = "Харах чиглэл тодорхойгүй"; return false; }
            if (Math.Abs(l.Dot(t)) > WeTol.Direction) { error = "Харах чиглэл ханад перпендикуляр биш"; return false; }

            WeV3 up = WeV3.UnitZ;
            WeV3 right = l.Cross(up).Normalized();
            WeV3 mid = (a + b) * 0.5;
            frame = new WeFrame
            {
                Origin = new WeV3(mid.X, mid.Y, baseZ),
                Right = right,
                Up = up,
                Look = l,
            };
            if (!IsValid(frame)) { error = "Координатын систем буруу"; frame = null; return false; }
            return true;
        }

        /// <summary>Нэгж, харилцан перпендикуляр, Look хэвтээ, Right × Up = ViewDirection.</summary>
        public static bool IsValid(WeFrame f)
        {
            if (f == null) return false;
            const double e = WeTol.Direction;
            if (Math.Abs(f.Right.Length - 1) > e || Math.Abs(f.Up.Length - 1) > e || Math.Abs(f.Look.Length - 1) > e) return false;
            if (Math.Abs(f.Right.Dot(f.Up)) > e || Math.Abs(f.Right.Dot(f.Look)) > e || Math.Abs(f.Up.Dot(f.Look)) > e) return false;
            if (Math.Abs(f.Look.Z) > e || f.Up.Z < 1 - e) return false;
            return f.Right.Cross(f.Up).AlmostEquals(f.ViewDirection, e);
        }

        /// <summary>
        /// Хүрээ <paramref name="facePoint"/> гадаргууг ЗӨВ ТАЛААС харж байна уу: харагчийн тал (−Look) нь
        /// <paramref name="viewerSideNormal"/>-той нэг тийш.
        /// </summary>
        public static bool FacesFromSide(WeFrame f, WeV3 viewerSideNormal)
        {
            WeV3 n = viewerSideNormal.Flat().Normalized();
            return !n.IsZero && f.ViewDirection.Dot(n) > 1 - WeTol.Direction;
        }
    }

    /// <summary>
    /// Хүрээ (crop) ба гүнийг хямд өгөгдлөөс бодно — асар том crop үүсгэхгүй.
    /// Бүх утга фут (дотоод нэгж).
    /// </summary>
    public static class ElevationBoundsCalculator
    {
        /// <summary>Хэт том хүрээг (~ 300 м) алдаа гэж үзнэ — эвдэрсэн өгөгдлөөс асар том харагдац үүсгэхгүй.</summary>
        public const double MaxExtent = 1000.0;

        /// <param name="faceLength">Харах гадаргуугийн хэвтээ урт.</param>
        /// <param name="bottomZ">Доод өндөр (дэлхийн Z).</param>
        /// <param name="topZ">Дээд өндөр (дэлхийн Z).</param>
        /// <param name="originZ">Хүрээний Origin-ий Z.</param>
        /// <param name="faceInFront">Лавлах шугамаас харагч тал руу гадаргуу хэр хол байж болох (location line биш бол зузаан).</param>
        /// <param name="faceToBack">Лавлах шугамаас ханын АР тал хүртэл.</param>
        /// <param name="nearOffset">Гадаргуугаас зүсэх хавтгай хүртэл (харагч тал руу).</param>
        /// <param name="farDepth">Ханын ар талаас цааш харах нөөц.</param>
        /// <param name="padding">Хүрээний зай (хэвтээ ба босоо).</param>
        /// <param name="verticalPadding">Босоо зай (сөрөг = <paramref name="padding"/>).  Өрөөний дэлгээс: давхрын шалнаас доош, дээд давхраас дээш
        /// бага зай — жишиг (MITIC ХАНЫН ДЭЛГЭЭС 218A) шалнаас 145 мм, дээд түвшнээс 70 мм; 300 мм нь мөр бүрийг 6 мм өндөрсгөсөн.</param>
        public static bool TryCompute(double faceLength, double bottomZ, double topZ, double originZ,
                                      double faceInFront, double faceToBack, double nearOffset, double farDepth, double padding,
                                      out WeBox box, out string error, double verticalPadding = -1)
        {
            double vpad = verticalPadding >= 0 ? verticalPadding : padding;
            box = null;
            error = null;
            if (!(faceLength > WeTol.MinWallLength)) { error = "Хэт богино"; return false; }
            if (!(topZ - bottomZ > WeTol.Length)) { error = "Өндөр тодорхойгүй (дээд ≤ доод)"; return false; }
            if (faceLength > MaxExtent || topZ - bottomZ > MaxExtent) { error = "Хэт том хэмжээ — өгөгдөл буруу байж магадгүй"; return false; }
            if (nearOffset < 0 || farDepth < 0 || padding < 0 || faceInFront < 0 || faceToBack < 0)
            {
                error = "Сөрөг зай";
                return false;
            }

            box = new WeBox
            {
                MinX = -faceLength / 2 - padding,
                MaxX = faceLength / 2 + padding,
                MinY = bottomZ - originZ - vpad,
                MaxY = topZ - originZ + vpad,
                Near = -(faceInFront + nearOffset),
                Far = faceToBack + farDepth,
            };
            if (box.Depth < WeTol.Length) { error = "Гүн хэт бага"; box = null; return false; }
            return true;
        }
    }
}
