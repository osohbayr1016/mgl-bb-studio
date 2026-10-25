using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

namespace MglBb.Core
{
    /// <summary>Нэг маркийн (дамнурууны төрлийн) инженерийн оролт: арматурын «6Ø25» бичвэрүүд, хомут; хоосон = компанийн / нормын анхдагч.</summary>
    public sealed class BbRebarRow
    {
        public string Mark = "";
        public bool Enabled = true;
        public string Top = "", Bottom = "", SpanTop = "", AddTop = "", AddBottom = "";
        public int StirrupD;
        public double S1, S2;
        /// <summary>LIRA-ийн шаардлагатай As (мм²), 0 = байхгүй.</summary>
        public double AsTop, AsBottom;
        /// <summary>Хомутын хэлбэр (<see cref="BbStirrupLayout"/>-ийн нэр, хоосон = анхдагч).</summary>
        public string Layout = "";
        /// <summary>Хажуугийн арматур «2Ø12» = тал бүрд 2 эгнээ Ø12; «0» = байхгүй; хоосон = анхдагч.</summary>
        public string Side = "";
        /// <summary>Алгасал бүрийн засвар (дугаар 0-ээс): доод нэмэлт, тулгуурын нэмэлт дээд, s1, s2; Off = энэ алгаслыг үүсгэхгүй.</summary>
        public List<BbSpanRow> Spans = new List<BbSpanRow>();

        public Dictionary<string, object> ToJson()
        {
            return new Dictionary<string, object>
            {
                { "mark", Mark }, { "on", Enabled }, { "top", Top }, { "bottom", Bottom }, { "spanTop", SpanTop }, { "addTop", AddTop },
                { "addBottom", AddBottom }, { "sd", StirrupD }, { "s1", S1 }, { "s2", S2 }, { "asTop", AsTop }, { "asBottom", AsBottom },
                { "layout", Layout }, { "side", Side }, { "spans", Spans.Select(s => (object)s.ToJson()).ToList() },
            };
        }

        public BbSpanRow Span(int i)
        {
            BbSpanRow s = Spans.FirstOrDefault(x => x.Index == i);
            if (s == null) { s = new BbSpanRow { Index = i }; Spans.Add(s); }
            return s;
        }

        public static BbRebarRow FromJson(object o)
        {
            BbRebarRow r = Parse(o);
            r.Layout = BbJson.Str(o, "layout", "");
            r.Side = BbJson.Str(o, "side", "");
            foreach (object s in BbJson.Arr(o, "spans") ?? new List<object>()) r.Spans.Add(BbSpanRow.FromJson(s));
            return r;
        }

        static BbRebarRow Parse(object o)
        {
            return new BbRebarRow
            {
                Mark = BbJson.Str(o, "mark", ""), Enabled = BbJson.Bool(o, "on", true), Top = BbJson.Str(o, "top", ""), Bottom = BbJson.Str(o, "bottom", ""),
                SpanTop = BbJson.Str(o, "spanTop", ""), AddTop = BbJson.Str(o, "addTop", ""), AddBottom = BbJson.Str(o, "addBottom", ""),
                StirrupD = (int)BbJson.Num(o, "sd", 0), S1 = BbJson.Num(o, "s1", 0), S2 = BbJson.Num(o, "s2", 0),
                AsTop = BbJson.Num(o, "asTop", 0), AsBottom = BbJson.Num(o, "asBottom", 0),
            };
        }
    }

    /// <summary>
    /// «Арматур үүсгэх»-ийн төслийн дэвтэр (%APPDATA%\MGL\BbStudio\rebar\&lt;төсөл&gt;.json): горим (компани / норм), бетон, ган, байгаа арматурыг
    /// солих эсэх, марк бүрийн мөр.  Мөрөөс <see cref="Preset"/> = компанийн / нормын анхдагч + инженерийн засвар.
    /// </summary>
    public sealed class BbRebarBook
    {
        public bool Company = true;
        public string Concrete = "B25";
        public BbSteel Steel = BbSteel.A500;
        public BbExposure Exposure = BbExposure.Indoor;
        public bool ReplaceForeign;
        public readonly List<BbRebarRow> Rows = new List<BbRebarRow>();
        public readonly List<BbColumnRow> Cols = new List<BbColumnRow>();

        public BbColumnRow Col(string mark)
        {
            BbColumnRow r = Cols.FirstOrDefault(x => x.Mark == mark);
            if (r == null) { r = new BbColumnRow { Mark = mark }; Cols.Add(r); }
            return r;
        }

        /// <summary>
        /// Баганын preset: компани (<see cref="BbColumnPresets.Company"/>) эсвэл норм + мөрийн утгууд.  Ширхгийн анхдагч = тал бүр ≤ 200 мм алхамтай
        /// (Ø20).
        /// </summary>
        public BbColumnPreset ColumnPreset(BbColumnRow row, double b, double h, List<string> errors = null)
        {
            BbColumnPreset p = Company ? BbColumnPresets.Company(b, h) : BbColumnPresets.Code(b, h);
            if (LearnStyle && ColStyle != null) ColStyle.Apply(p);
            p.Concrete = Concrete;
            p.Steel = Steel;
            p.Exposure = Exposure;
            if (row == null) return p;
            if (!string.IsNullOrWhiteSpace(row.Bars))
            {
                int nb, nh, d;
                if (BbColumnRow.TryParse(row.Bars, out nb, out nh, out d)) { p.Nb = nb; p.Nh = nh; p.D = d; }
                else errors?.Add(row.Mark + ": «" + row.Bars + "» уншигдсангүй (жишээ нь 4×4Ø20).");
            }
            if (row.TieD > 0) p.TieD = row.TieD;
            if (row.S > 0) p.S = row.S;
            if (row.SDense > 0) p.SDense = row.SDense;
            BbColumnTieLayout tl;
            if (!string.IsNullOrWhiteSpace(row.TieLayout))
            {
                if (Enum.TryParse(row.TieLayout, out tl)) p.TieLayout = tl;
                else errors?.Add(row.Mark + ": хомутын хэлбэр «" + row.TieLayout + "» танигдсангүй.");
            }
            return p;
        }

        public BbRebarRow Row(string mark)
        {
            BbRebarRow r = Rows.FirstOrDefault(x => x.Mark == mark);
            if (r == null) { r = new BbRebarRow { Mark = mark }; Rows.Add(r); }
            return r;
        }

        /// <summary>
        /// Мөрийн preset: анхдагч (<see cref="BbBeamPreset.Company"/> эсвэл норм) дээр бичигдсэн утгууд + алгасал бүрийн засвар (<paramref name="firstSpan"/>
        /// = энэ оролтын эхний алгаслын бүхэл дамнурууны дугаар, <paramref name="spanCount"/> = тоо).  Буруу бичвэр → <paramref name="errors"/>.
        /// </summary>
        public BbBeamPreset Preset(BbRebarRow row, double b, List<string> errors, int firstSpan, int spanCount, double h = 0, double dirDeg = 0)
        {
            BbBeamPreset p = Preset(row, b, errors, h, dirDeg);
            if (row == null || row.Spans.Count == 0 || spanCount <= 0) return p;
            p.AddTopBySupport = new BbBarSpec?[spanCount + 1];
            p.AddBottomBySpan = new BbBarSpec?[spanCount];
            p.S1BySpan = new double?[spanCount];
            p.S2BySpan = new double?[spanCount];
            for (int k = 0; k < spanCount; k++)
            {
                BbSpanRow s = row.Spans.FirstOrDefault(x => x.Index == firstSpan + k);
                if (s == null) continue;
                BbBarSpec v;
                if (Spec(s.AddTop, out v, row.Mark, "алгасал " + (s.Index + 1) + " нэмэлт дээд", errors)) p.AddTopBySupport[k] = v;
                if (Spec(s.AddTopEnd, out v, row.Mark, "алгасал " + (s.Index + 1) + " төгсгөлийн нэмэлт дээд", errors)) p.AddTopBySupport[k + 1] = v;
                if (Spec(s.AddBottom, out v, row.Mark, "алгасал " + (s.Index + 1) + " нэмэлт доод", errors)) p.AddBottomBySpan[k] = v;
                if (s.S1 > 0) p.S1BySpan[k] = s.S1;
                if (s.S2 > 0) p.S2BySpan[k] = s.S2;
            }
            return p;
        }

        static bool Spec(string text, out BbBarSpec v, string mark, string what, List<string> errors)
        {
            v = new BbBarSpec(0, 0);
            if (string.IsNullOrWhiteSpace(text)) return false;
            if (BbBarSpecs.TryParse(text, out v)) return true;
            errors?.Add(mark + ": «" + what + "» = «" + text + "» уншигдсангүй.");
            return false;
        }

        /// <summary>Элементийн «Rebar Cover» параметрийг хамгаалах үе болгон ашиглах (тодорхойгүй бол preset-ийнх).</summary>
        public bool UseHostCover = true;

        /// <summary>Загварын гар арматураас сурсан хэв маяг (компанийн горимд анхдагчийг солино; дэвтэрт хадгалагдана — солисны дараа ч хэвээр).</summary>
        public BbRebarStyle Style;
        public BbColumnStyle ColStyle;
        public bool LearnStyle = true;

        /// <param name="h">Өндөр (хомутын Ø огтлолоор), <paramref name="dirDeg"/> = гинжийн чиглэл (дээд хамгаалах үе) — сурсан хэв маягт.</param>
        public BbBeamPreset Preset(BbRebarRow row, double b, List<string> errors = null, double h = 0, double dirDeg = 0)
        {
            BbBeamPreset p = Company ? BbBeamPreset.Company(b) : BbBeamPreset.Ordinary(b);
            if (LearnStyle && Style != null) Style.Apply(p, b, h, dirDeg);
            p.Concrete = Concrete;
            p.Steel = Steel;
            p.Exposure = Exposure;
            if (row == null) return p;
            Apply(row.Top, v => p.Top = v, "Тулгуурын дээд", row, errors);
            Apply(row.Bottom, v => p.Bottom = v, "Доод", row, errors);
            Apply(row.SpanTop, v => p.SpanTop = v, "Голын дээд", row, errors);
            Apply(row.AddTop, v => p.AddTop = v, "Нэмэлт дээд", row, errors);
            Apply(row.AddBottom, v => p.AddBottom = v, "Нэмэлт доод", row, errors);
            if (row.StirrupD > 0) p.StirrupD = row.StirrupD;
            if (row.S1 > 0) p.S1 = row.S1;
            if (row.S2 > 0) p.S2 = row.S2;
            BbStirrupLayout lay;
            if (!string.IsNullOrWhiteSpace(row.Layout))
            {
                if (Enum.TryParse(row.Layout, out lay)) p.Layout = lay;
                else errors?.Add(row.Mark + ": хомутын хэлбэр «" + row.Layout + "» танигдсангүй.");
            }
            if (!string.IsNullOrWhiteSpace(row.Side))
            {
                BbBarSpec sd;
                if (BbBarSpecs.TryParse(row.Side, out sd))
                {
                    p.SideD = sd.Any ? sd.D : 0;
                    p.SideRows = sd.Any ? sd.N : 0;
                    if (sd.Any) p.SideMinH = 0;
                }
                else errors?.Add(row.Mark + ": хажуугийн арматур «" + row.Side + "» уншигдсангүй (жишээ нь 2Ø12, 0 = байхгүй).");
            }
            return p;
        }

        static void Apply(string text, Action<BbBarSpec> set, string what, BbRebarRow row, List<string> errors)
        {
            if (string.IsNullOrWhiteSpace(text)) return;
            BbBarSpec s;
            if (BbBarSpecs.TryParse(text, out s)) set(s);
            else errors?.Add(row.Mark + ": «" + what + "» = «" + text + "» уншигдсангүй (жишээ нь 6Ø25, 0 = байхгүй).");
        }

        /// <summary>
        /// LIRA-ийн шаардлагатай As-аас санал (<see cref="BbRebarCode.PickBars"/>): тулгуурын дээд ба доод — нэг эгнээнд багтах хамгийн бага
        /// талбай.  <paramref name="w"/> = хомут доторх цэвэр өргөн.  As байхгүй бол хоосон.
        /// </summary>
        public static string Suggest(double asMm2, double w, bool top, int maxN = 99)
        {
            if (asMm2 <= 0) return "";
            BbBarSpec s = BbRebarCode.PickBars(asMm2, w, top, 16, 32, 2, maxN);
            if (!s.Any) s = BbRebarCode.PickBars(asMm2, w, top, 16, 32);   // хязгаараас их хэрэгтэй — тоог нэмнэ
            return s.Any ? s.ToString() : "";
        }

        public Dictionary<string, object> ToJson()
        {
            return new Dictionary<string, object>
            {
                { "company", Company }, { "concrete", Concrete }, { "steel", Steel.ToString() }, { "exposure", Exposure.ToString() },
                { "replace", ReplaceForeign }, { "hostCover", UseHostCover }, { "learn", LearnStyle }, { "style", Style?.ToJson() }, { "colStyle", ColStyle?.ToJson() }, { "rows", Rows.Select(r => (object)r.ToJson()).ToList() },
                { "cols", Cols.Select(r => (object)r.ToJson()).ToList() },
            };
        }

        public static BbRebarBook FromJson(object o)
        {
            var b = new BbRebarBook
            {
                Company = BbJson.Bool(o, "company", true), Concrete = BbJson.Str(o, "concrete", "B25"), ReplaceForeign = BbJson.Bool(o, "replace", false),
                UseHostCover = BbJson.Bool(o, "hostCover", true), LearnStyle = BbJson.Bool(o, "learn", true),
            };
            BbSteel st;
            if (Enum.TryParse(BbJson.Str(o, "steel", "A500"), out st)) b.Steel = st;
            BbExposure ex;
            if (Enum.TryParse(BbJson.Str(o, "exposure", "Indoor"), out ex)) b.Exposure = ex;
            foreach (object r in BbJson.Arr(o, "rows") ?? new List<object>()) b.Rows.Add(BbRebarRow.FromJson(r));
            foreach (object r in BbJson.Arr(o, "cols") ?? new List<object>()) b.Cols.Add(BbColumnRow.FromJson(r));
            Dictionary<string, object> sty = BbJson.Obj(o, "style");
            if (sty != null) b.Style = BbRebarStyle.FromJson(sty);
            Dictionary<string, object> cst = BbJson.Obj(o, "colStyle");
            if (cst != null) b.ColStyle = BbColumnStyle.FromJson(cst);
            return b;
        }

        public void Save(string path)
        {
            string dir = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            string tmp = path + ".tmp";
            File.WriteAllText(tmp, BbJson.Write(ToJson()), new System.Text.UTF8Encoding(false));
            if (File.Exists(path)) File.Replace(tmp, path, null);
            else File.Move(tmp, path);
        }

        public static BbRebarBook Load(string path)
        {
            return File.Exists(path) ? FromJson(BbJson.Parse(File.ReadAllText(path))) : new BbRebarBook();
        }

        /// <summary>Файлын нэрэнд тохирох (төслийн нэрээс) — хориотой тэмдэгтийг «_» болгоно.</summary>
        public static string SafeName(string title)
        {
            string s = string.IsNullOrWhiteSpace(title) ? "project" : title.Trim();
            foreach (char c in Path.GetInvalidFileNameChars()) s = s.Replace(c, '_');
            return s;
        }

        /// <summary>
        /// LIRA-аас гаргасан шаардлагатай арматурын CSV: мөр бүр «марк; As дээд; As доод» (см², аравтын таслал ч болно, ; , эсвэл tab).  Эхний
        /// мөр гарчиг байж болно.  Ижил марк олон удаа бол хамгийн их нь.  Буцаана: марк → (дээд, доод) мм².
        /// </summary>
        public static Dictionary<string, double[]> ParseLiraCsv(string text, List<string> errors = null)
        {
            var res = new Dictionary<string, double[]>(StringComparer.Ordinal);
            int line = 0;
            foreach (string raw in (text ?? "").Split('\n'))
            {
                line++;
                string s = raw.Trim().Trim('\r');
                if (s.Length == 0) continue;
                char sep = s.IndexOf('\t') >= 0 ? '\t' : s.IndexOf(';') >= 0 ? ';' : ',';
                string[] f = s.Split(sep).Select(x => x.Trim().Trim('"')).ToArray();
                if (f.Length < 3) { errors?.Add("Мөр " + line + ": 3 багана хэрэгтэй."); continue; }
                double top, bot;
                if (!Num(f[1], out top) || !Num(f[2], out bot))
                {
                    if (line > 1) errors?.Add("Мөр " + line + ": тоо уншигдсангүй.");
                    continue;   // гарчиг
                }
                double[] cur;
                if (!res.TryGetValue(f[0], out cur)) res[f[0]] = cur = new double[2];
                cur[0] = Math.Max(cur[0], top * 100);
                cur[1] = Math.Max(cur[1], bot * 100);
            }
            return res;
        }

        static bool Num(string s, out double v)
        {
            return double.TryParse((s ?? "").Replace(',', '.'), NumberStyles.Float, CultureInfo.InvariantCulture, out v);
        }
    }

    /// <summary>
    /// Нэг алгаслын (тулгуур хоорондын, 0-ээс) засвар: <see cref="AddTop"/> = энэ алгаслын ЭХЛЭЛИЙН тулгуурын нэмэлт дээд (сүүлийн алгасалд
    /// <see cref="AddTopEnd"/> = төгсгөлийн тулгуурынх), <see cref="AddBottom"/> = алгаслын нэмэлт доод; хоосон = мөрийнх; <see cref="Off"/> = үүсгэхгүй.
    /// </summary>
    public sealed class BbSpanRow
    {
        public int Index;
        public bool Off;
        public string AddTop = "", AddTopEnd = "", AddBottom = "";
        public double S1, S2;

        public Dictionary<string, object> ToJson()
        {
            return new Dictionary<string, object>
            {
                { "i", Index }, { "off", Off }, { "addTop", AddTop }, { "addTopEnd", AddTopEnd }, { "addBottom", AddBottom }, { "s1", S1 }, { "s2", S2 },
            };
        }

        public static BbSpanRow FromJson(object o)
        {
            return new BbSpanRow
            {
                Index = (int)BbJson.Num(o, "i", 0), Off = BbJson.Bool(o, "off", false), AddTop = BbJson.Str(o, "addTop", ""), AddTopEnd = BbJson.Str(o, "addTopEnd", ""),
                AddBottom = BbJson.Str(o, "addBottom", ""), S1 = BbJson.Num(o, "s1", 0), S2 = BbJson.Num(o, "s2", 0),
            };
        }
    }

    /// <summary>Нэг баганы маркийн оролт: «4×4Ø20» (B тал × H тал, булан орно), хомут Ø, алхам; хоосон = анхдагч.</summary>
    public sealed class BbColumnRow
    {
        public string Mark = "";
        public bool Enabled = true;
        public string Bars = "";
        public int TieD;
        /// <summary>Хомутын хэлбэр (<see cref="BbColumnTieLayout"/>-ийн нэр, хоосон = анхдагч).</summary>
        public string TieLayout = "";
        public double S, SDense;

        public Dictionary<string, object> ToJson()
        {
            return new Dictionary<string, object> { { "mark", Mark }, { "on", Enabled }, { "bars", Bars }, { "td", TieD }, { "s", S }, { "sd", SDense }, { "layout", TieLayout } };
        }

        public static BbColumnRow FromJson(object o)
        {
            return new BbColumnRow
            {
                Mark = BbJson.Str(o, "mark", ""), Enabled = BbJson.Bool(o, "on", true), Bars = BbJson.Str(o, "bars", ""),
                TieD = (int)BbJson.Num(o, "td", 0), S = BbJson.Num(o, "s", 0), SDense = BbJson.Num(o, "sd", 0), TieLayout = BbJson.Str(o, "layout", ""),
            };
        }

        static readonly Regex Rx = new Regex(@"^\s*(\d+)\s*[xх×*]\s*(\d+)\s*[ØøΦφФфdD⌀]\s*(\d+)\s*$");

        /// <summary>«4×4Ø20», «4x4ф20» → (nb, nh, d).</summary>
        public static bool TryParse(string text, out int nb, out int nh, out int d)
        {
            nb = nh = d = 0;
            Match m = Rx.Match(text ?? "");
            if (!m.Success) return false;
            nb = int.Parse(m.Groups[1].Value); nh = int.Parse(m.Groups[2].Value); d = int.Parse(m.Groups[3].Value);
            return nb >= 2 && nh >= 2 && nb <= 12 && nh <= 12 && BbRebarCode.Diameters.Contains(d);
        }
    }

    public static class BbBarSpecs
    {
        static readonly Regex Rx = new Regex(@"^\s*(\d+)\s*[ØøΦφФфdDxх×⌀]\s*(\d+)\s*$");

        /// <summary>«6Ø25», «6ф25», «6d25», «6x25», «6⌀25»; «0», «—», «-» = байхгүй.</summary>
        public static bool TryParse(string text, out BbBarSpec spec)
        {
            spec = new BbBarSpec(0, 0);
            string t = (text ?? "").Trim();
            if (t == "0" || t == "-" || t == "—") return true;
            Match m = Rx.Match(t);
            if (!m.Success) return false;
            int n = int.Parse(m.Groups[1].Value), d = int.Parse(m.Groups[2].Value);
            if (n < 0 || n > 20 || !BbRebarCode.Diameters.Contains(d)) return false;
            spec = new BbBarSpec(n, d);
            return true;
        }
    }
}
