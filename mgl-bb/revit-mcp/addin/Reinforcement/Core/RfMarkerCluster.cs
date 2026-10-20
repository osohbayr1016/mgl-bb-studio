using System;
using System.Collections.Generic;

namespace RevitMcpAddin.Reinforcement.Core
{
    /// <summary>Код-оор зурсан тэмдгийн нэг элемент (detail шугам/нум) — харагдацын 2D дунд цэг ба урт.</summary>
    public sealed class RfMarkerPart
    {
        public long Id;
        public RfV2 Mid;
        public double Length;
    }

    /// <summary>
    /// Нэг түлхүүртэй (арматур + төгсгөл + ширхэг) тэмдгийн элементүүдийг ХАМТ БАЙРЛАЛААР нь тусдаа тэмдэг болгон бүлэглэнэ.
    ///
    /// ЯАГААД: Extensible Storage-ийн бичлэг (түлхүүр) тэмдгийн элемент бүр дээр хуулагддаг тул хэрэглэгч тэмдгийг Copy/Paste хийвэл
    /// ХУУЛБАР нь ЯГ ИЖИЛ түлхүүртэй.  Түлхүүрээр ганцхан нэгтгэвэл (1) «Шинэчлэх» хэрэглэгчийн хуулбарыг зөөж, (2) төвийг хоёр тэмдгийн дундаж
    /// болгож буруу тооцоолно.  Иймд элементүүдийг байрлалаар нь (single-linkage) салгаж, хамгийн ЭХ (хамгийн бага id — анх үүссэн)
    /// бүлгийг л «манай тэмдэг» гэж үзэж, бусдыг «хуулбар» гэж тоолно (ХӨНДӨХГҮЙ).
    /// </summary>
    public static class RfMarkerCluster
    {
        /// <summary>Нэг тэмдгийн элементүүдийг холбогдсон гэж үзэх зай = (хоёр элементийн урт)-ийн ихийн ЭНЭ дахин (тойргийн хоёр хагас нумын дунд цэгийн зай 2r ≈ 0.64 × нумын урт πr тул бага зэрэг нөөцтэй).</summary>
        public const double LinkFactor = 0.7;

        /// <summary>Хэлбэр бүрийн бүрэн тэмдэг хэдэн элементтэй: тойрог 2 (хоёр хагас нум), загалмай 2, налуу зураас 1.</summary>
        public static int ExpectedParts(RfMarkerStyle style)
        {
            return style == RfMarkerStyle.Slash ? 1 : 2;
        }

        /// <summary>
        /// Бүлгүүд (индексийн жагсаалт), бүлэг доторх хамгийн бага id-аар эрэмбэлсэн — ЭХНИЙХ нь анхны тэмдэг.  Хоосон оролт ⇒ хоосон.
        /// Хоёр элемент холбогдоно: |дунд цэгийн зай| ≤ <see cref="LinkFactor"/> × max(урт_i, урт_j) (холбоос дамжин: A–B, B–C ⇒ нэг бүлэг).
        /// Тойргийн хоёр хагас нум: дунд цэгийн зай 2r, нумын урт πr ⇒ холбогдоно; «×»-ийн хоёр шугамын дунд цэг давхцана.
        /// </summary>
        public static List<List<int>> Split(IList<RfMarkerPart> parts)
        {
            var groups = new List<List<int>>();
            if (parts == null || parts.Count == 0) return groups;

            int n = parts.Count;
            var parent = new int[n];
            for (int i = 0; i < n; i++) parent[i] = i;

            for (int i = 0; i < n; i++)
            {
                for (int j = i + 1; j < n; j++)
                {
                    double reach = LinkFactor * Math.Max(parts[i].Length, parts[j].Length);
                    if ((parts[i].Mid - parts[j].Mid).Length <= reach) Union(parent, i, j);
                }
            }

            var byRoot = new Dictionary<int, List<int>>();
            var order = new List<int>();
            for (int i = 0; i < n; i++)
            {
                int r = Find(parent, i);
                List<int> g;
                if (!byRoot.TryGetValue(r, out g))
                {
                    g = new List<int>();
                    byRoot[r] = g;
                    order.Add(r);
                }
                g.Add(i);
            }
            foreach (int r in order) groups.Add(byRoot[r]);

            groups.Sort((a, b) => MinId(parts, a).CompareTo(MinId(parts, b)));
            return groups;
        }

        private static long MinId(IList<RfMarkerPart> parts, List<int> g)
        {
            long m = long.MaxValue;
            foreach (int i in g) if (parts[i].Id < m) m = parts[i].Id;
            return m;
        }

        private static int Find(int[] p, int x)
        {
            while (p[x] != x)
            {
                p[x] = p[p[x]];
                x = p[x];
            }
            return x;
        }

        private static void Union(int[] p, int a, int b)
        {
            int ra = Find(p, a), rb = Find(p, b);
            if (ra != rb) p[rb] = ra;
        }
    }
}
