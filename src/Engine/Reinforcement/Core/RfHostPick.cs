using System;
using System.Text;

namespace RevitMcpAddin.Reinforcement.Core
{
    public enum RfHostPickAction
    {
        /// <summary>Яг нэг хүчинтэй дам нуруу/багана урьдчилан сонгогдсон — дахин сонгуулахгүй, шууд ашиглана.</summary>
        UsePreselected = 0,
        /// <summary>Хүчинтэй элемент урьдчилан сонгогдоогүй — хэрэглэгчээс нэг дам нуруу/багана сонгуулна.</summary>
        PromptPick = 1,
        /// <summary>Хэд хэдэн хүчинтэй элемент урьдчилан сонгогдсон — ТОДОРХОЙГҮЙ: дур зоргоор нэгийг нь сонгохгүй, нэгийг нь сонгуулна.</summary>
        PromptPickAmbiguous = 2,
    }

    /// <summary>
    /// «Огтлолын арматурын тэмдэглэгээ»-ний эзэн элементийг сонгох ЦЭВЭР бодлого (Revit-гүй, тестлэгдсэн).  Ангилал, host эсэхийг Revit талаас
    /// (<c>RfSectionAnalyzer</c>) уншиж, шийдвэрийг энд гаргана.
    /// </summary>
    public static class RfHostPick
    {
        /// <summary>Эзэн болох элемент: Structural Framing / Structural Column БА арматур агуулах боломжтой.  Санамсаргүй загварын элемент хүлээн авахгүй.</summary>
        public static bool Accepts(bool isBeamOrColumn, bool canHostRebar)
        {
            return isBeamOrColumn && canHostRebar;
        }

        /// <summary>
        /// Урьдчилан сонгосон ХҮЧИНТЭЙ элементийн тоо → юу хийх.  Хүчингүй (ханан, шал г.м.) сонголтыг тоолохгүй — тэднийг алгасаж хүчинтэйгээс шийднэ.
        /// </summary>
        public static RfHostPickAction Decide(int validPreselected)
        {
            if (validPreselected == 1) return RfHostPickAction.UsePreselected;
            return validPreselected > 1 ? RfHostPickAction.PromptPickAmbiguous : RfHostPickAction.PromptPick;
        }

        /// <summary>
        /// Хэрэглэгчид харуулах элементийн тодорхойлолт: <c>Mark · Family : Type  [Ангилал]</c>.  Хоосон хэсгийг алгасна.  Түүхий ElementId-г ЭНД оруулахгүй
        /// (хоёрдогч мэдээлэл — дуудагч тусад нь харуулна); бүх хэсэг хоосон бол хоосон мөр буцаана.
        /// </summary>
        public static string Describe(string mark, string familyName, string typeName, string categoryName)
        {
            var sb = new StringBuilder();
            string m = (mark ?? string.Empty).Trim();
            string f = (familyName ?? string.Empty).Trim();
            string t = (typeName ?? string.Empty).Trim();
            string c = (categoryName ?? string.Empty).Trim();
            if (m.Length > 0) sb.Append(m);

            string ft;
            if (f.Length > 0 && t.Length > 0 && !string.Equals(f, t, StringComparison.OrdinalIgnoreCase)) ft = f + " : " + t;
            else ft = t.Length > 0 ? t : f;
            if (ft.Length > 0)
            {
                if (sb.Length > 0) sb.Append(" · ");
                sb.Append(ft);
            }
            if (c.Length > 0)
            {
                if (sb.Length > 0) sb.Append("  ");
                sb.Append('[').Append(c).Append(']');
            }
            return sb.ToString();
        }
    }
}
