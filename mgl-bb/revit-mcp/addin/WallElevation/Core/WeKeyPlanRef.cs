using System;
using System.Collections.Generic;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>
    /// W07 (2026-10-16): түлхүүр план дээрх БИЧВЭР тэмдгийн лавлагаа — «205A» + шинэ мөрөнд хуудасны дугаар.  Revit-ийн Elevation маркер (Detail
    /// Number + Sheet Number) өөрөө шинэчлэгддэг тул энэ дүрэм зөвхөн бичвэр тэмдэгт (зүсэлт / хуучин харагдац).  Revit давхарга манай хэлбэрийн
    /// бичвэрийг олж <see cref="Desired"/>-ыг тавина; энд текстийн дүрэм л (Revit-гүй, тесттэй).
    /// </summary>
    public static class WeKeyPlanRef
    {
        /// <summary>Revit-ийн «харагдац хуудсанд байршаагүй» утга.</summary>
        public const string NotPlaced = "---";

        /// <summary>Хуудасны дугаарыг цэвэрлэнэ: хоосон / «---» → null.</summary>
        public static string CleanSheet(string sheetNumber)
        {
            string s = (sheetNumber ?? string.Empty).Trim();
            return s.Length == 0 || s == NotPlaced ? null : s;
        }

        /// <summary>Тэмдгийн бичвэр: «205A» эсвэл «205A\rA-301» (Revit TextNote-ийн мөр таслал \r).</summary>
        public static string Desired(string label, string sheetNumber)
        {
            string l = (label ?? string.Empty).Trim();
            string s = CleanSheet(sheetNumber);
            return s == null ? l : l + "\r" + s;
        }

        /// <summary>Бичвэрийн эхний мөр (тэмдэг) — Revit-ийн текст \r, \n, «\r\n»-ээр мөр таслана.</summary>
        public static string LabelOf(string text)
        {
            string t = (text ?? string.Empty).Replace("\r\n", "\r").Replace('\n', '\r');
            int i = t.IndexOf('\r');
            return (i < 0 ? t : t.Substring(0, i)).Trim();
        }

        /// <summary>Одоогийн бичвэр хүссэнтэй ижил үү (төгсгөлийн мөр таслал, «\r\n» ялгааг үл тооно).</summary>
        public static bool Same(string current, string desired)
        {
            Func<string, string> n = x => (x ?? string.Empty).Replace("\r\n", "\r").Replace('\n', '\r').TrimEnd('\r', ' ');
            return string.Equals(n(current), n(desired), StringComparison.Ordinal);
        }

        /// <summary>
        /// Хуудсанд байршуулахаас ӨМНӨХ хүлээгдэж буй хуудасны дугаар: харагдацын одоогийн хуудас (гараар зөөсөн ч) › хэрэглэгчийн сонгосон
        /// хуудас › өрөөний өмнө үүссэн хуудас › шинэ хуудасны урьдчилан хуваарилсан дугаар (W05).  Олдохгүй бол null (нэг мөр).  Хуудасны дараа
        /// бодит дугаараар дахин шалгана.
        /// </summary>
        public static string Expected(string placedSheet, string targetSheet, string groupSheet, string plannedSheet)
        {
            return CleanSheet(placedSheet) ?? CleanSheet(targetSheet) ?? CleanSheet(groupSheet) ?? CleanSheet(plannedSheet);
        }
    }
}
