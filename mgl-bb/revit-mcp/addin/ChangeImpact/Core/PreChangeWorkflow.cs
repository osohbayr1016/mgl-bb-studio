using System;
using System.Linq;

namespace RevitMcpAddin.ChangeImpact.Core
{
    /// <summary>
    /// Цонхны ажлын урсгалын ЦЭВЭР дүрмүүд (WPF-гүй, тестлэгдэнэ): зайн сонголт, сүүдрийн өнгө, төлөвийн мөр, Revit-ийн сонголт өөрчлөгдсөн эсэх.
    /// Цонх зөвхөн үүнийг дуудна — бизнес дүрэм WPF-д БИШ.
    /// </summary>
    public static class PreChangeWorkflow
    {
        /// <summary>Нэг товшилтын зайны сонголт (мм).  Чөлөөт бичвэр (`PreChangeRequestRules.ParseDistanceMm`) хамт байна.</summary>
        public static readonly int[] ChipDistances = { 100, 200, 300, 500, 1000 };

        public const int DefaultDistanceMm = 300;

        /// <summary>Хэрэглэгчийн бичсэн зай нь аль нэг товчтой тэнцүү бол тэр товчийн индекс, үгүй бол -1.</summary>
        public static int ChipIndexOf(double? mm)
        {
            if (!mm.HasValue) return -1;
            for (int i = 0; i < ChipDistances.Length; i++)
                if (Math.Abs(ChipDistances[i] - mm.Value) < 1e-6) return i;
            return -1;
        }

        /// <summary>
        /// Сүүдрийн өнгө = шийдвэр: 🟢 ногоон, 🟠 шар, 🔴 улаан, ⚪ (дүгнэх боломжгүй / түр дүн) саарал.
        /// Шийдвэр байхгүй (шинжилгээ хараахан хийгдээгүй) бол саарал — «шалгагдсан» мэт харагдуулахгүй.
        /// </summary>
        public static ApplyTone ToneFor(MoveDecision d)
        {
            if (d == null || !d.IsFinal || d.IsPending) return ApplyTone.Gray;
            switch (d.Verdict)
            {
                case MoveVerdict.MoveOk: return ApplyTone.Green;
                case MoveVerdict.MoveWithReview: return ApplyTone.Amber;
                case MoveVerdict.DoNotMove: return ApplyTone.Red;
                default: return ApplyTone.Gray;
            }
        }

        /// <summary>
        /// «Нарийвчилсан» хэсгийн толгойн төлөвийн мөр: «Өрөө ✓ Хэмжээс ✓ MEP ✓ Гарц — тохируулаагүй Норм — шалгаагүй».
        /// Чип бүрийн текстийг шийдвэрийн хөдөлгүүрээс (ганц эх сурвалж) аваад зайгаар залгана.  «Хуудас» чип энд ОРООГҮЙ — тэр нь картад (хянах тоо) харагдана.
        /// </summary>
        public static string StatusLine(MoveDecision d)
        {
            if (d == null || d.Checks == null || d.Checks.Count == 0) return "";
            return string.Join(" ", d.Checks.Where(c => c.Key != "sheets" && !string.IsNullOrWhiteSpace(c.Text)).Select(c => c.Text.Trim()));
        }

        /// <summary>
        /// Revit-д сонгосон хана өөрчлөгдсөн эсэх: ШИНЭ сонголт хүчинтэй хана бөгөөд одоогийнхоос ӨӨР UniqueId-тай бол л true.
        /// Сонголт арилсан / хүчингүй (хана биш) → false: хэрэглэгч Revit-д өөр зүйл товшихдоо preview-ээ алдахгүй.
        /// </summary>
        public static bool SelectionChanged(PreChangeSelection current, PreChangeSelection next)
        {
            if (next == null || !next.Valid) return false;
            if (current == null || !current.Valid) return true;
            return !string.Equals(current.SourceUid, next.SourceUid, StringComparison.Ordinal) || current.SourceId != next.SourceId;
        }
    }
}
