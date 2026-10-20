using System;
using System.Collections.Generic;
using System.Globalization;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>
    /// Хэрэглэгчийн ТОХИРУУЛСАН дэлгээсийн байрлал (2026-10-14, эзэн: «урьдчилсан планаас тухайн үсэг, хэмжээсийг нь тавиад хүссэн газрынхаа
    /// хүссэн дэлгээсийг өөрөө тохируулж авдаг болго»).  План дахь ЗҮСЭХ ШУГАМ (A→B) + харах чиглэл: дэлгээс тэр шугамаас <see cref="Look"/>
    /// чиглэлд, шугамын уртаар харна; ар тал нь харах чиглэлийн өрөөний хил (хана) хүртэл.  Дотоод нэгж (фут), план XY.
    /// Харагдац дээр (Extensible Storage) хадгалагдаж дахин ажиллуулахад хэвээр.
    /// </summary>
    public sealed class WeSideOverride
    {
        public WeV3 A;
        public WeV3 B;
        /// <summary>Харах чиглэл (план, нэгж).</summary>
        public WeV3 Look;
        /// <summary>Хэрэглэгч «анхны байрлал руу» буцаасан — хадгалсан тохиргоог үл тооно (дараагийн бичилтэд арилна).</summary>
        public bool Reset;

        public double Length { get { return (B - A).Flat().Length; } }

        public bool IsValid
        {
            get
            {
                if (Reset) return true;
                WeV3 d = (B - A).Flat();
                WeV3 l = Look.Flat();
                return d.Length > 1e-3 && !l.IsZero && Math.Abs(d.Normalized().Dot(l.Normalized())) < 0.05;
            }
        }

        public WeSideOverride Clone() { return new WeSideOverride { A = A, B = B, Look = Look, Reset = Reset }; }

        public static WeSideOverride Line(WeV3 a, WeV3 b, WeV3 look)
        {
            return new WeSideOverride { A = a.Flat(), B = b.Flat(), Look = look.Flat().Normalized() };
        }

        /// <summary>«v1;ax;ay;bx;by;lx;ly» (InvariantCulture).  Reset → «reset».</summary>
        public string Serialize()
        {
            if (Reset) return "reset";
            Func<double, string> f = v => v.ToString("R", CultureInfo.InvariantCulture);
            return "v1;" + f(A.X) + ";" + f(A.Y) + ";" + f(B.X) + ";" + f(B.Y) + ";" + f(Look.X) + ";" + f(Look.Y);
        }

        public static WeSideOverride Parse(string text)
        {
            if (string.IsNullOrWhiteSpace(text)) return null;
            if (text.Trim() == "reset") return new WeSideOverride { Reset = true };
            string[] p = text.Split(';');
            if (p.Length != 7 || p[0] != "v1") return null;
            var v = new double[6];
            for (int i = 0; i < 6; i++)
                if (!double.TryParse(p[i + 1], NumberStyles.Float, CultureInfo.InvariantCulture, out v[i]) || double.IsNaN(v[i]) || double.IsInfinity(v[i])) return null;
            var o = Line(new WeV3(v[0], v[1], 0), new WeV3(v[2], v[3], 0), new WeV3(v[4], v[5], 0));
            return o.IsValid ? o : null;
        }

        /// <summary>Шугамыг ижил чиглэлтэй хэвээр эргүүлнэ: 90° цагийн эсрэг (харах чиглэл ч эргэнэ).  Төв нь хэвээр.</summary>
        public WeSideOverride Rotated90()
        {
            WeV3 c = (A + B) * 0.5, h = (B - A) * 0.5;
            var rh = new WeV3(-h.Y, h.X, 0);
            return Line(c - rh, c + rh, new WeV3(-Look.Y, Look.X, 0));
        }

        /// <summary>Харах чиглэлийг эсрэг болгоно (шугам хэвээр).</summary>
        public WeSideOverride Flipped() { return Line(B, A, -Look); }
    }

    /// <summary>Тохиргооны хадгалагдахгүй хэсэг: дэлгээс тус бүрийн тохируулга (түлхүүр → байрлал).</summary>
    public sealed class WeOverrides : Dictionary<string, WeSideOverride>
    {
        public WeOverrides() : base(StringComparer.Ordinal) { }

        public WeOverrides Copy()
        {
            var c = new WeOverrides();
            foreach (KeyValuePair<string, WeSideOverride> kv in this) if (kv.Value != null) c[kv.Key] = kv.Value.Clone();
            return c;
        }
    }
}
