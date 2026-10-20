using System;

namespace RevitMcpAddin.AutoAnnotate.Core
{
    // ══════════════════════════════════════════════════════════════════════
    // ТЭНХЛЭГ, ТҮВШНИЙ ҮЗҮҮРИЙГ CROP REGION-ООС ЗААСАН ЗАЙД (2026-10-08, эзний хүсэлт №4).
    //
    // Огтлол/дэлгээсэд тэнхлэг (Grid) босоо, түвшин (Level) хэвтээ шугам болж харагдана.  Хэрэглэгч үзүүр бүрийн crop-ийн хилээс зайг
    // ЦААСАН мм-ээр өгнө (эерэг = crop-оос ГАДАГШ, сөрөг = ДОТОГШ) — шугамыг ЗӨВХӨН энэ харагдацад (2D / ViewSpecific) уртасгаж/богиносгоно.
    // Revit-гүй ЦЭВЭР тооцоо (net48-д ч эмхэтгэгдэнэ); Revit тал: AutoAnnotate/AaDatumCropService.cs.
    // Бүх координат харагдацын (u = баруун, v = дээш) хавтгайд, загварын фут.
    // ══════════════════════════════════════════════════════════════════════

    /// <summary>Харагдац дахь шугамын чиглэл.</summary>
    public enum AaDatumOrient
    {
        /// <summary>Босоо (тэнхлэг огтлол/дэлгээсэд).</summary>
        Vertical = 0,

        /// <summary>Хэвтээ (түвшин).</summary>
        Horizontal = 1,

        /// <summary>Налуу — энэ хэрэгсэл хөндөхгүй.</summary>
        Skew = 2,

        /// <summary>Урт ≈ 0.</summary>
        Degenerate = 3,
    }

    /// <summary>Crop region-ы хүрээ (харагдацын u/v, фут).</summary>
    public struct AaCropRect
    {
        public double MinU, MaxU, MinV, MaxV;

        public AaCropRect(double minU, double maxU, double minV, double maxV)
        {
            MinU = minU;
            MaxU = maxU;
            MinV = minV;
            MaxV = maxV;
        }

        public bool Valid { get { return MaxU > MinU && MaxV > MinV; } }
    }

    /// <summary>Хэрэглэгчийн тохиргоо — ЦААСАН мм (масштабаар үржигдэнэ).  Эерэг = crop-оос гадагш, сөрөг = дотогш.</summary>
    public sealed class AaDatumCropOptions
    {
        public bool Grids { get; set; } = true;
        public bool Levels { get; set; } = true;

        /// <summary>Тэнхлэгийн ДООД үзүүр (зурган дээрх «1» — ихэвчлэн бөмбөлөгтэй).</summary>
        public double GridBottomMm { get; set; } = 10;

        /// <summary>Тэнхлэгийн ДЭЭД үзүүр (зурган дээрх «2»).</summary>
        public double GridTopMm { get; set; } = 5;

        /// <summary>Түвшний ЗҮҮН үзүүр.</summary>
        public double LevelLeftMm { get; set; } = 10;

        /// <summary>Түвшний БАРУУН үзүүр.</summary>
        public double LevelRightMm { get; set; } = 10;

        /// <summary>Нэг зайн хязгаар (цаасан мм).  Хэт том утга шугамыг хуудаснаас хол гаргана.</summary>
        public const double MaxAbsMm = 200;

        public AaDatumCropOptions Clone() { return (AaDatumCropOptions)MemberwiseClone(); }

        /// <summary>null = зөв; үгүй бол Монгол мессеж.</summary>
        public string Validate()
        {
            if (!Grids && !Levels) return "Тэнхлэг эсвэл түвшний ядаж нэгийг сонгоно уу.";
            if (Grids && (!Ok(GridBottomMm) || !Ok(GridTopMm)))
                return "Тэнхлэгийн үзүүрийн зай −" + MaxAbsMm + "…" + MaxAbsMm + " мм байна.";
            if (Levels && (!Ok(LevelLeftMm) || !Ok(LevelRightMm)))
                return "Түвшний үзүүрийн зай −" + MaxAbsMm + "…" + MaxAbsMm + " мм байна.";
            return null;
        }

        private static bool Ok(double v)
        {
            return !double.IsNaN(v) && !double.IsInfinity(v) && Math.Abs(v) <= MaxAbsMm;
        }
    }

    /// <summary>Алгасах шалтгаан.</summary>
    public enum AaDatumSkip
    {
        None = 0,

        /// <summary>Шугам налуу (тэнхлэг босоо биш / түвшин хэвтээ биш).</summary>
        WrongOrientation,

        /// <summary>Шугам crop-ийн хүрээнд ороогүй (энэ харагдацад харагдахгүй).</summary>
        OutsideCrop,

        /// <summary>Дотогш зай хэт их — хоёр үзүүр давхцаж/солигдож шугам үгүй болно.</summary>
        TooShort,

        /// <summary>Шугамын урт ≈ 0.</summary>
        Degenerate,
    }

    /// <summary>Нэг datum-ийн шинэ үзүүр (харагдацын u/v).  <see cref="NewStart"/> нь ХУУЧИН эхлэлийн талд — бөмбөлгийн тал (End0/End1) хадгалагдана.</summary>
    public sealed class AaDatumPlan
    {
        public AaDatumSkip Skip;
        public AaDatumOrient Orient;
        public double NewStartU, NewStartV, NewEndU, NewEndV;
        public bool Ok { get { return Skip == AaDatumSkip.None; } }
    }

    public static class AaDatumCrop
    {
        /// <summary>«Босоо/хэвтээ» гэж үзэх: |cos| ≥ энэ (≈ 0.8°).</summary>
        public const double AxisCos = 0.9999;

        /// <summary>Шинэ шугамын хамгийн бага урт (фут ≈ 3 мм) — Revit-ийн «хэт богино муруй»-гаас сэргийлнэ.</summary>
        public const double MinLengthFt = 0.01;

        public static AaDatumOrient Orientation(double u0, double v0, double u1, double v1)
        {
            double du = u1 - u0, dv = v1 - v0;
            double len = Math.Sqrt(du * du + dv * dv);
            if (!(len > 1e-9)) return AaDatumOrient.Degenerate;
            if (Math.Abs(dv) / len >= AxisCos) return AaDatumOrient.Vertical;
            if (Math.Abs(du) / len >= AxisCos) return AaDatumOrient.Horizontal;
            return AaDatumOrient.Skew;
        }

        /// <summary>
        /// Шугамын (харагдацад) шинэ үзүүр.  <paramref name="wantVertical"/> = тэнхлэг (босоо байх ёстой), false = түвшин (хэвтээ).
        /// Зай бүр ФУТ (цаасан мм-ийг дуудагч масштабаар хөрвүүлсэн), эерэг = crop-оос гадагш.
        /// Тэнхлэг: доод үзүүр v = MinV − bottom, дээд v = MaxV + top; u хэвээр (crop-ийн u мужид байх ёстой).
        /// Түвшин: зүүн u = MinU − left, баруун u = MaxU + right; v хэвээр (crop-ийн v мужид).
        /// </summary>
        public static AaDatumPlan Plan(double u0, double v0, double u1, double v1, AaCropRect crop, bool wantVertical,
            double bottomOrLeftFt, double topOrRightFt)
        {
            var p = new AaDatumPlan { Orient = Orientation(u0, v0, u1, v1) };
            if (p.Orient == AaDatumOrient.Degenerate) { p.Skip = AaDatumSkip.Degenerate; return p; }
            if (wantVertical ? p.Orient != AaDatumOrient.Vertical : p.Orient != AaDatumOrient.Horizontal)
            {
                p.Skip = AaDatumSkip.WrongOrientation;
                return p;
            }
            if (!crop.Valid) { p.Skip = AaDatumSkip.OutsideCrop; return p; }

            if (wantVertical)
            {
                double u = (u0 + u1) / 2;
                if (u < crop.MinU || u > crop.MaxU) { p.Skip = AaDatumSkip.OutsideCrop; return p; }
                double lo = crop.MinV - bottomOrLeftFt, hi = crop.MaxV + topOrRightFt;
                if (!(hi - lo >= MinLengthFt)) { p.Skip = AaDatumSkip.TooShort; return p; }
                bool startIsLow = v0 <= v1;
                p.NewStartU = u0;
                p.NewEndU = u1;
                p.NewStartV = startIsLow ? lo : hi;
                p.NewEndV = startIsLow ? hi : lo;
            }
            else
            {
                double v = (v0 + v1) / 2;
                if (v < crop.MinV || v > crop.MaxV) { p.Skip = AaDatumSkip.OutsideCrop; return p; }
                double lo = crop.MinU - bottomOrLeftFt, hi = crop.MaxU + topOrRightFt;
                if (!(hi - lo >= MinLengthFt)) { p.Skip = AaDatumSkip.TooShort; return p; }
                bool startIsLeft = u0 <= u1;
                p.NewStartV = v0;
                p.NewEndV = v1;
                p.NewStartU = startIsLeft ? lo : hi;
                p.NewEndU = startIsLeft ? hi : lo;
            }
            return p;
        }

        /// <summary>
        /// 3D шугамын параметр: харагдацын тэнхлэг дагуух координатыг <paramref name="target"/> болгох t (P(t) = P0 + d·t, d нэгж бус байж болно).
        /// <paramref name="rate"/> = d·(харагдацын тэнхлэг) — 0 бол NaN.  Шинэ цэг ХУУЧИН 3D шугам дээр үлдэнэ (Revit «шугам coplanar байх ёстой»).
        /// </summary>
        public static double ParamFor(double startCoord, double rate, double target)
        {
            if (Math.Abs(rate) < 1e-12) return double.NaN;
            return (target - startCoord) / rate;
        }
    }
}
