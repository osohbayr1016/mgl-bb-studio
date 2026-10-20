using System;
using System.Collections.Generic;

namespace RevitMcpAddin.Reinforcement.Core
{
    /// <summary>Нэг ялгаатай Partition утга ба түүнд хамаарах арматурын тоо.</summary>
    public sealed class RfPartitionValue
    {
        /// <summary>Загварт хадгалагдсан ЯГ утга (хоосон зайг ч хөндөөгүй — шүүлтүүрт яг ингэж орно).</summary>
        public string Value;

        /// <summary>Энэ утгатай арматурын тоо.</summary>
        public int RebarCount;

        /// <summary>Утгын эхэнд/төгсгөлд хоосон зай байна (инженерийн алдаа байж болзошгүй — анхааруулна, ЗАСАХГҮЙ).</summary>
        public bool HasEdgeWhitespace;

        /// <summary>Өөр нэг утгатай зөвхөн том/жижиг үсгээр (эсвэл захын зайгаар) ялгарна.</summary>
        public bool CaseOrSpaceCollision;
    }

    /// <summary>
    /// Загвар дахь арматурын Partition утгуудын ЯЛГАРСАН (distinct) олонлог.
    ///
    /// ⚠️ Инженерийн өгсөн ҮНЭ ЯЛГААТАЙ нэрсийг ХЭЗЭЭ Ч нэгтгэхгүй: «DN-1» ба «dn-1», «DN-1 » нь тус тусдаа
    /// утга (ordinal).  Харин тэдгээр нь шүүлтүүрт андуурагдаж болзошгүй тул `CaseOrSpaceCollision` тугаар
    /// анхааруулна.  Хоосон утга нь жагсаалтад ОРОХГҮЙ — тоог нь `BlankCount`-д л хадгална.
    /// </summary>
    public sealed class RfPartitionSet
    {
        /// <summary>Байгалийн эрэмбээр (DN-2 &lt; DN-10).</summary>
        public readonly List<RfPartitionValue> Values = new List<RfPartitionValue>();

        /// <summary>Partition-гүй (хоосон / зөвхөн хоосон зайтай) арматурын тоо.</summary>
        public int BlankCount;

        /// <summary>Нийт арматурын тоо (хоосон ч орно).</summary>
        public int TotalRebars;

        public static RfPartitionSet Build(IEnumerable<string> rawValues)
        {
            var set = new RfPartitionSet();
            var counts = new Dictionary<string, int>(StringComparer.Ordinal);
            if (rawValues != null)
            {
                foreach (string raw in rawValues)
                {
                    set.TotalRebars++;
                    if (string.IsNullOrWhiteSpace(raw))
                    {
                        set.BlankCount++;
                        continue;
                    }
                    int c;
                    counts.TryGetValue(raw, out c);
                    counts[raw] = c + 1;
                }
            }

            // Захын зай, том/жижиг үсгийг үл хамаарсан бүлэглэл — зөвхөн ХЭРЭГЛЭГЧИД анхааруулахад.
            var norm = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            foreach (KeyValuePair<string, int> kv in counts)
            {
                string key = kv.Key.Trim();
                int c;
                norm.TryGetValue(key, out c);
                norm[key] = c + 1;
            }

            foreach (KeyValuePair<string, int> kv in counts)
            {
                int groups;
                norm.TryGetValue(kv.Key.Trim(), out groups);
                set.Values.Add(new RfPartitionValue
                {
                    Value = kv.Key,
                    RebarCount = kv.Value,
                    HasEdgeWhitespace = !string.Equals(kv.Key, kv.Key.Trim(), StringComparison.Ordinal),
                    CaseOrSpaceCollision = groups > 1,
                });
            }
            set.Values.Sort((a, b) => RfNaturalComparer.Instance.Compare(a.Value, b.Value));
            return set;
        }

        public RfPartitionValue Find(string value)
        {
            for (int i = 0; i < Values.Count; i++)
            {
                if (string.Equals(Values[i].Value, value, StringComparison.Ordinal))
                    return Values[i];
            }
            return null;
        }
    }
}
