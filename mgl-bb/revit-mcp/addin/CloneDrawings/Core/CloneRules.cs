using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace RevitMcpAddin.CloneDrawings.Core
{
    // ══════════════════════════════════════════════════════════════════════
    //  «Зураг клонлох»-ын Revit-гүй ЦЭВЭР дүрмүүд (2026-09-30).
    //
    //  ⚠️ Энд `Autodesk.Revit` / `System.Windows` ОРОХГҮЙ — `tests/CloneDrawings.Tests`
    //  энэ файлыг шууд эмхэтгэдэг.  Revit-тэй холбоотой бүх шийдвэрийн «тоон»
    //  хэсэг (сунгалт, тусгай/ерөнхий харагдац, нэр, бүлэг) энд тестлэгдэнэ.
    // ══════════════════════════════════════════════════════════════════════

    /// <summary>
    /// Загвар элементийн орон нутгийн хайрцгаас зорилтот элементийн хайрцаг руу
    /// нэг тэнхлэгийн координатыг буулгана («ухаалаг тохируулга»-ын үндэс).
    ///
    ///   • Хайрцгийн ГАДНА (tag-ийн толгой, хэмжээсийн шугам, тайрах хүрээний
    ///     зах) — ойрын нүүрнээс хэмжсэн ЗАЙГАА хадгална: 300 мм доор байсан
    ///     хэмжээсийн шугам урт/өндөр өөр элемент дээр ч 300 мм доор байна.
    ///   • Хайрцгийн ДОТОР — хувь хэмжээгээр: 45%-д байсан зүсэлт 45%-д.
    ///
    /// Хэмжээ нь ижил бол энэ нь энгийн шилжүүлэлт (хатуу хувиргалт) болно.
    /// </summary>
    public static class Stretch
    {
        public static double Axis(double q, double minA, double maxA, double minB, double maxB)
        {
            double sizeA = maxA - minA;
            double sizeB = maxB - minB;
            if (q <= minA)
                return minB + (q - minA);
            if (q >= maxA)
                return maxB + (q - maxA);
            if (sizeA < 1e-9)
                return minB + (q - minA);
            return minB + (q - minA) * (sizeB / sizeA);
        }
    }

    /// <summary>
    /// Харагдац загвар элементэд «ТУСГАЙЛАН» зориулагдсан уу (зорилт бүрд шинэ
    /// харагдац үүсгэнэ), эсвэл олон элементийг харуулдаг ЕРӨНХИЙ харагдац уу
    /// (зорилт тэнд аль хэдийн харагдаж байвал tag, хэмжээс нь тэнд л нэмэгдэнэ).
    /// Тайрах хүрээ элементийн хэмжээнээс 4 дахин (эсвэл +3 м) их бол ерөнхий.
    /// </summary>
    public static class DedicatedRule
    {
        public const double RatioLimit = 4.0;
        /// <summary>Жижиг элементийн (багана ~0.5 м) «+3 м» зай, фут.</summary>
        public const double MarginFt = 10.0;

        public static bool IsDedicated(double cropW, double cropH, double elemW, double elemH)
        {
            if (!(cropW > 0) || !(cropH > 0))
                return false;
            return Fits(cropW, elemW) && Fits(cropH, elemH);
        }

        public static bool IsDedicated3(double cropX, double cropY, double cropZ,
            double elemX, double elemY, double elemZ)
        {
            if (!(cropX > 0) || !(cropY > 0) || !(cropZ > 0))
                return false;
            return Fits(cropX, elemX) && Fits(cropY, elemY) && Fits(cropZ, elemZ);
        }

        private static bool Fits(double crop, double elem)
        {
            double e = Math.Max(0, elem);
            return crop <= Math.Max(e * RatioLimit, e + MarginFt);
        }
    }

    /// <summary>Шинэ харагдац, хуудас, текстийн нэр.</summary>
    public static class CloneNaming
    {
        /// <summary>
        /// Тэмдэгийг (Mark) нэр/текстэд солих аюулгүй юу.  «1», «12» зэрэг зөвхөн
        /// тоо нь «Level 1», «Section 12»-той андуурагдана — солихгүй, нэрний
        /// ард нэмнэ.  Үсэгтэй, зайгүй, 2+ тэмдэгттэй бол аюулгүй (B1, C-12, Б3).
        /// </summary>
        public static bool IsReplaceableMark(string mark)
        {
            if (string.IsNullOrEmpty(mark) || mark.Length < 2)
                return false;
            bool letter = false;
            foreach (char ch in mark)
            {
                if (char.IsWhiteSpace(ch) || ch == '\n' || ch == '\r')
                    return false;
                if (char.IsLetter(ch))
                    letter = true;
            }
            return letter;
        }

        /// <summary>
        /// <paramref name="text"/> дахь <paramref name="oldMark"/>-ийг БҮТЭН үгээр
        /// (өмнө/ард нь үсэг, цифр биш) солино.  «B1» нь «B12»-ийн дотор солигдохгүй.
        /// </summary>
        public static bool TryReplaceMark(string text, string oldMark, string newMark, out string result)
        {
            result = text;
            if (string.IsNullOrEmpty(text) || !IsReplaceableMark(oldMark) || string.IsNullOrEmpty(newMark)
                || string.Equals(oldMark, newMark, StringComparison.Ordinal))
                return false;
            var sb = new StringBuilder();
            bool any = false;
            int i = 0;
            while (i < text.Length)
            {
                int at = text.IndexOf(oldMark, i, StringComparison.Ordinal);
                if (at < 0)
                {
                    sb.Append(text, i, text.Length - i);
                    break;
                }
                bool leftOk = at == 0 || !char.IsLetterOrDigit(text[at - 1]);
                int end = at + oldMark.Length;
                bool rightOk = end >= text.Length || !char.IsLetterOrDigit(text[end]);
                sb.Append(text, i, at - i);
                if (leftOk && rightOk)
                {
                    sb.Append(newMark);
                    any = true;
                }
                else
                {
                    sb.Append(oldMark);
                }
                i = end;
            }
            if (!any)
                return false;
            result = sb.ToString();
            return true;
        }

        /// <summary>
        /// Зорилтын харагдацын нэр: эх нэрэнд загварын тэмдэг байвал түүнийг
        /// зорилтын тэмдэгээр солино («B1 - Зүсэлт 1» → «B2 - Зүсэлт 1»), үгүй бол
        /// ард нь « - {шошго}» нэмнэ.
        /// </summary>
        public static string ViewName(string sourceName, string templateMark, string targetMark, string targetLabel)
        {
            if (TryReplaceMark(sourceName, templateMark, targetMark, out string replaced))
                return replaced;
            return sourceName + " - " + targetLabel;
        }

        public static string SheetNumber(string sourceNumber, string templateMark, string targetMark, string targetLabel)
        {
            if (TryReplaceMark(sourceNumber, templateMark, targetMark, out string replaced))
                return replaced;
            return sourceNumber + "-" + Compact(targetLabel);
        }

        public static string SheetName(string sourceName, string templateMark, string targetMark, string targetLabel)
        {
            if (TryReplaceMark(sourceName, templateMark, targetMark, out string replaced))
                return replaced;
            return sourceName + " (" + targetLabel + ")";
        }

        /// <summary>Хуудасны дугаарт зай, хаалт хэрэггүй: «ID 1234» → «ID1234».</summary>
        public static string Compact(string label)
        {
            if (string.IsNullOrEmpty(label))
                return "X";
            var sb = new StringBuilder();
            foreach (char ch in label)
            {
                if (char.IsLetterOrDigit(ch) || ch == '-' || ch == '.' || ch == '_')
                    sb.Append(ch);
            }
            return sb.Length == 0 ? "X" : sb.ToString();
        }

        /// <summary>Давтагдашгүй нэр: «нэр», «нэр 2», «нэр 3» …</summary>
        public static string MakeUnique(string name, Func<string, bool> exists, string separator = " ")
        {
            if (!exists(name))
                return name;
            for (int i = 2; i < 10000; i++)
            {
                string n = name + separator + i.ToString(CultureInfo.InvariantCulture);
                if (!exists(n))
                    return n;
            }
            return name + separator + Guid.NewGuid().ToString("N").Substring(0, 6);
        }

        /// <summary>Зорилтын шошго: тэмдэг байвал түүнийг, үгүй бол «ID 123456».</summary>
        public static string TargetLabel(string mark, long elementId) =>
            string.IsNullOrWhiteSpace(mark) ? "ID " + elementId.ToString(CultureInfo.InvariantCulture) : mark.Trim();
    }

    /// <summary>Нэг зорилтын загвартай харьцуулсан хэмжилтүүд (Revit-гүй).</summary>
    public sealed class TargetFacts
    {
        public bool SameType;
        public string TypeName;
        /// <summary>Загварын орон нутгийн хайрцгийн хэмжээ (фут), X/Y/Z.</summary>
        public double[] SizeA = new double[3];
        public double[] SizeB = new double[3];
        /// <summary>Загвар → зорилтын хэвтээ эргэлт, градус (-180, 180].</summary>
        public double PlanAngleDeg;
        public bool Mirrored;
        public bool SameLevel = true;
        /// <summary>"curve" | "point" | "box" — урт/өндрийг аль тэнхлэгээс унших.</summary>
        public string FrameKind = "box";
        /// <summary>Шугаман элементийн тэнхлэг босоо уу (налуу багана).</summary>
        public bool VerticalAxis;
    }

    /// <summary>«Зорилтот элементүүдийн дэлгэрэнгүй бүлэг».</summary>
    public static class TargetGrouping
    {
        /// <summary>Хэмжээ «өөр» гэж тооцох босго, фут (~6 мм).</summary>
        public const double SizeTol = 0.02;

        public static bool SizeDiffers(TargetFacts f)
        {
            for (int i = 0; i < 3; i++)
            {
                if (Math.Abs(f.SizeA[i] - f.SizeB[i]) > SizeTol)
                    return true;
            }
            return false;
        }

        /// <summary>Эргэлтийг хамгийн ойр бүхэл градус руу, (-180, 180] мужид.</summary>
        public static int AngleBucket(double deg)
        {
            double a = deg % 360.0;
            if (a <= -180) a += 360;
            if (a > 180) a -= 360;
            int r = (int)Math.Round(a);
            return r == -180 ? 180 : r;
        }

        /// <summary>Бүлгийн түлхүүр — ижил түлхүүртэй зорилтууд нэг бүлэгт.</summary>
        public static string GroupKey(TargetFacts f)
        {
            return (f.SameType ? "0" : "1") + "|" + f.TypeName + "|" + (SizeDiffers(f) ? "S" : "=")
                + "|" + AngleBucket(f.PlanAngleDeg).ToString(CultureInfo.InvariantCulture) + "|" + (f.Mirrored ? "M" : "-")
                + "|" + (f.SameLevel ? "L" : "l");
        }

        /// <summary>«W12x26 — ижил хэмжээ», «W12x26 — урт өөр · 90°» …</summary>
        public static string GroupLabel(TargetFacts f)
        {
            var parts = new List<string>();
            if (SizeDiffers(f))
                parts.Add(SizeWord(f) + " өөр");
            int a = AngleBucket(f.PlanAngleDeg);
            if (a != 0)
                parts.Add(a.ToString(CultureInfo.InvariantCulture) + "° эргэсэн");
            if (f.Mirrored)
                parts.Add("толин");
            if (!f.SameLevel)
                parts.Add("өөр давхарт");
            string variant = parts.Count == 0 ? "ижил хэмжээ, ижил чиг" : string.Join(" · ", parts);
            string type = f.SameType ? f.TypeName : f.TypeName + " (өөр төрөл)";
            return type + " — " + variant;
        }

        /// <summary>Аль хэмжээ нь зөрсөн: шугаман элементэд «урт», баганад «өндөр», бусдад «хэмжээ».</summary>
        public static string SizeWord(TargetFacts f)
        {
            int axis = LongAxis(f);
            bool onlyLong = true;
            for (int i = 0; i < 3; i++)
            {
                if (i != axis && Math.Abs(f.SizeA[i] - f.SizeB[i]) > SizeTol)
                    onlyLong = false;
            }
            if (!onlyLong || axis < 0)
                return "хэмжээ";
            return axis == 2 ? "өндөр" : "урт";
        }

        /// <summary>Урт/өндрийн тэнхлэг: шугаман → X (босоо бол Z), цэгэн family → Z (багана).</summary>
        public static int LongAxis(TargetFacts f)
        {
            if (f.FrameKind == "curve")
                return f.VerticalAxis ? 2 : 0;
            if (f.FrameKind == "point")
                return 2;
            return -1;
        }

        /// <summary>Нэг мөрийн тайлбар: «L = 7 200 мм · 90° · Level 2».</summary>
        public static string Details(TargetFacts f, string levelName)
        {
            var parts = new List<string>();
            int axis = LongAxis(f);
            if (axis >= 0)
            {
                string word = axis == 2 ? "H" : "L";
                parts.Add(word + " = " + Mm(f.SizeB[axis]) + " мм");
            }
            int a = AngleBucket(f.PlanAngleDeg);
            if (a != 0)
                parts.Add(a.ToString(CultureInfo.InvariantCulture) + "°");
            if (f.Mirrored)
                parts.Add("толин");
            if (!string.IsNullOrEmpty(levelName))
                parts.Add(levelName);
            return string.Join(" · ", parts);
        }

        public static string Mm(double feet)
        {
            double mm = feet * 304.8;
            return Math.Round(mm).ToString("#,0", CultureInfo.InvariantCulture).Replace(",", " ");
        }
    }
}
