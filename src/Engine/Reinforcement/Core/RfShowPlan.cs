using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace RevitMcpAddin.Reinforcement.Core
{
    /// <summary>«Голоос N дэх» ширхгийг аль талд авах: <see cref="Both"/> = хоёр талд, <see cref="Start"/> = эхний ширхэг (индекс 0) тал, <see cref="End"/> = сүүлийн ширхгийн тал.</summary>
    public enum RfShowSide
    {
        Both = 0,
        Start = 1,
        End = 2,
    }

    /// <summary>
    /// «Арматур харуулах»-ын тохиргоо: олонлог (bar set) дотроос ЯМАР ширхгүүд харагдахыг тодорхойлно.
    /// Хоосон (нэг ч ширхэг сонгоогүй, <see cref="KeepVisible"/> худал) тохиргоо бол <see cref="RfShowPlan.Decide"/> нь «хоосон» гэж буцаана — бүх ширхгийг нуух гэж ХЭЗЭЭ Ч тайлбарлахгүй.
    /// </summary>
    public sealed class RfShowSpec
    {
        public bool First = true;
        public bool Last = true;
        public bool Middle = true;

        /// <summary>«Голын ширхгээс хажуу тийш N дэх» (N ≥ 1).  Жишээ нь {2} = голоос 2 ширхэгийн зайтай ширхэг(үүд).</summary>
        public List<int> Offsets = new List<int>();

        public RfShowSide Side = RfShowSide.Both;

        /// <summary>Одоо харагдаж буй ширхгүүдийг ХАДГАЛАХ (дээр нь нэмнэ).</summary>
        public bool KeepVisible;

        /// <summary>Нэг товчны горим: захын (эхний, сүүлийн) + голын ширхэг.</summary>
        public static RfShowSpec EdgesAndMiddle()
        {
            return new RfShowSpec { First = true, Last = true, Middle = true };
        }
    }

    /// <summary>Revit-д бичих СУУРЬ горим: бүгд / эхний-сүүлийн / сонгосон (Select).</summary>
    public enum RfShowTarget
    {
        All = 0,
        FirstLast = 1,
        Select = 2,
    }

    public sealed class RfShowDecision
    {
        /// <summary>Харагдах ширхгийн ҮНЭХ индекс (Revit-ийн bar position index), өсөх дарааллаар.</summary>
        public List<int> Visible = new List<int>();

        /// <summary>Нуугдах ширхгийн үнэн индекс.</summary>
        public List<int> Hidden = new List<int>();

        public RfShowTarget Target = RfShowTarget.All;

        /// <summary>Олонлогийн хүрээнээс гарсан тул тооцогдоогүй «голоос N» утгууд (жишээ нь 7 ширхэгтэй багцад N = 5).</summary>
        public List<int> OutOfRange = new List<int>();

        /// <summary>Харуулах нэг ч ширхэг сонгогдоогүй — энэ олонлогт юу ч бичихгүй.</summary>
        public bool Empty;
    }

    /// <summary>
    /// Арматурын олонлог (bar set)-ийн «харагдах ширхэг»-ийн ЦЭВЭР дүрэм (Revit-гүй, тестлэгдсэн).  Revit тал (<c>RfShowService</c>) зөвхөн
    /// индексүүдийг уншиж/бичнэ; ямар ширхэг харагдахыг ЭНД шийднэ.
    ///
    /// ⚠️ ДҮРЭМ (эзний 2026-10-05):
    ///  • Ганц арматур эсвэл 2 ширхэгтэй олонлогт ХҮРЧ БОЛОХГҮЙ (<see cref="MinPositions"/> = 3).
    ///  • «Гол» = байгаа ширхгүүдийн дундах — тоо тэгш бол төгсгөлийн талын төв ширхэг (n / 2, 0-ээс эхэлсэн).  Яг ганц «гол» байхгүй тул
    ///    тэгш тоотой үед нөгөө төв ширхгийг «голоос 1 дэх»-ээр авна.
    ///  • Индекс нь БАЙГАА ширхгүүдийн (DoesBarExistAtPosition) жагсаалтын байрлал — дутуу ширхэгтэй олонлог ч зөв.
    /// </summary>
    public static class RfShowPlan
    {
        /// <summary>Энэ хэдээс цөөн ширхэгтэй олонлогт хүрэхгүй (ганц, 2 ширхэг).</summary>
        public const int MinPositions = 3;

        public static bool IsAffected(int existingCount)
        {
            return existingCount >= MinPositions;
        }

        /// <summary>Голын ширхгийн байрлал (0-ээс).  n ≥ 1.</summary>
        public static int MiddleOf(int count)
        {
            return count <= 0 ? 0 : count / 2;
        }

        /// <summary>
        /// Одоогийн горимоос ЯГ харагдаж буй ширхгүүд.  <paramref name="isHidden"/> нь зөвхөн <see cref="RfPresentation.Select"/> үед уншигдана.
        /// ⚠️ <see cref="RfPresentation.Middle"/> дахь «гол» тэгш тоотой үед Revit-ийн өөрийн сонголттой таарахгүй байж болзошгүй (баталгаажаагүй) —
        /// <see cref="MiddleOf"/>-оор ойролцоолно.
        /// </summary>
        public static List<int> CurrentVisible(RfPresentation mode, IList<int> existing, Func<int, bool> isHidden)
        {
            var result = new List<int>();
            if (existing == null || existing.Count == 0) return result;
            switch (mode)
            {
                case RfPresentation.FirstLast:
                    result.Add(existing[0]);
                    if (existing.Count > 1) result.Add(existing[existing.Count - 1]);
                    break;
                case RfPresentation.Middle:
                    result.Add(existing[MiddleOf(existing.Count)]);
                    break;
                case RfPresentation.Select:
                    foreach (int i in existing)
                    {
                        bool hid;
                        try { hid = isHidden != null && isHidden(i); }
                        catch { hid = false; }
                        if (!hid) result.Add(i);
                    }
                    break;
                default:
                    result.AddRange(existing);
                    break;
            }
            return result.Distinct().OrderBy(i => i).ToList();
        }

        /// <summary>
        /// Тохиргооноос харагдах/нуугдах ширхгийг гаргана.
        /// </summary>
        /// <param name="existing">Байгаа ширхгүүдийн ҮНЭН индекс (өсөх).</param>
        /// <param name="clickedBars">Хэрэглэгчийн дарсан ширхгийн ҮНЭН индекс(үүд) — байхгүй бол null.</param>
        /// <param name="currentVisible"><see cref="RfShowSpec.KeepVisible"/> үед хадгалах ширхгүүд.</param>
        public static RfShowDecision Decide(IList<int> existing, RfShowSpec spec, IEnumerable<int> clickedBars, IList<int> currentVisible)
        {
            var d = new RfShowDecision();
            int n = existing == null ? 0 : existing.Count;
            if (n == 0 || spec == null)
            {
                d.Empty = true;
                return d;
            }

            var pos = new SortedSet<int>();
            if (spec.First) pos.Add(0);
            if (spec.Last) pos.Add(n - 1);
            int mid = MiddleOf(n);
            if (spec.Middle) pos.Add(mid);

            if (spec.Offsets != null)
            {
                foreach (int k in spec.Offsets.Distinct().OrderBy(x => x))
                {
                    if (k < 1) continue;
                    bool any = false;
                    if (spec.Side != RfShowSide.End)
                    {
                        int p = mid - k;
                        if (p >= 0 && p < n) { pos.Add(p); any = true; }
                    }
                    if (spec.Side != RfShowSide.Start)
                    {
                        int p = mid + k;
                        if (p >= 0 && p < n) { pos.Add(p); any = true; }
                    }
                    if (!any) d.OutOfRange.Add(k);
                }
            }

            if (clickedBars != null)
            {
                foreach (int bar in clickedBars)
                {
                    int p = IndexOf(existing, bar);
                    if (p >= 0) pos.Add(p);
                }
            }

            if (spec.KeepVisible && currentVisible != null)
            {
                foreach (int bar in currentVisible)
                {
                    int p = IndexOf(existing, bar);
                    if (p >= 0) pos.Add(p);
                }
            }

            if (pos.Count == 0)
            {
                d.Empty = true;
                return d;
            }

            foreach (int p in pos) d.Visible.Add(existing[p]);
            foreach (int bar in existing)
                if (!d.Visible.Contains(bar)) d.Hidden.Add(bar);

            if (d.Hidden.Count == 0) d.Target = RfShowTarget.All;
            else if (n >= 3 && d.Visible.Count == 2 && pos.Contains(0) && pos.Contains(n - 1)) d.Target = RfShowTarget.FirstLast;
            else d.Target = RfShowTarget.Select;
            return d;
        }

        /// <summary>Харагдах ширхгүүдийн олонлог, горим хоёр аль хэдийн хүссэнтэй ЯГ ижил үү (бичих шаардлагагүй).</summary>
        public static bool IsAlreadyApplied(RfShowDecision d, IList<int> currentVisible, RfPresentation currentMode)
        {
            if (d == null || d.Empty || currentVisible == null) return false;
            if (currentVisible.Count != d.Visible.Count) return false;
            var cur = new HashSet<int>(currentVisible);
            foreach (int v in d.Visible)
                if (!cur.Contains(v)) return false;
            switch (d.Target)
            {
                case RfShowTarget.All: return currentMode == RfPresentation.All;
                case RfShowTarget.FirstLast: return currentMode == RfPresentation.FirstLast;
                default: return currentMode == RfPresentation.Select;
            }
        }

        /// <summary>
        /// «2», «1,3», «2 4» гэх мэт бүхэл тоонуудыг уншина (таслал, цэг таслал, зай).  Хоосон бол хоосон жагсаалт (амжилттай).
        /// Тоо биш, 1-ээс бага эсвэл хэт том утга байвал false.
        /// </summary>
        public static bool TryParseOffsets(string text, out List<int> offsets)
        {
            offsets = new List<int>();
            if (string.IsNullOrWhiteSpace(text)) return true;
            string[] parts = text.Split(new[] { ',', ';', ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
            foreach (string p in parts)
            {
                int v;
                if (!int.TryParse(p, NumberStyles.Integer, CultureInfo.InvariantCulture, out v) || v < 1 || v > 999)
                {
                    offsets = new List<int>();
                    return false;
                }
                if (!offsets.Contains(v)) offsets.Add(v);
            }
            offsets.Sort();
            return true;
        }

        /// <summary>Хэрэглэгчид харуулах 1-ээс эхэлсэн дугаар («1, 6, 11»).  Урьдчилан харалтад.</summary>
        public static string DescribeVisible(IList<int> existing, RfShowDecision d)
        {
            if (existing == null || d == null || d.Empty) return string.Empty;
            return string.Join(", ", d.Visible.Select(v => (IndexOf(existing, v) + 1).ToString(CultureInfo.InvariantCulture)));
        }

        private static int IndexOf(IList<int> list, int value)
        {
            for (int i = 0; i < list.Count; i++)
                if (list[i] == value) return i;
            return -1;
        }
    }
}
