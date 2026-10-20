using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement.Tests
{
    /// <summary>Тэмдгийн элементүүдийг байрлалаар нь салгах: Copy/Paste хуулбар, хагас устгагдсан тэмдэг, давхцсан тэмдэг.</summary>
    public static class MarkerClusterTests
    {
        private static List<RfMarkerPart> PartsOf(long idBase, RfMarkerStyle style, RfV2 c, double r)
        {
            var list = new List<RfMarkerPart>();
            int k = 0;
            foreach (RfMarkerPrim p in RfMarkerGeometry.Build(style, c, r, 0.3))
            {
                double len = p.Kind == RfPrimKind.Line ? (p.B - p.A).Length : Math.PI * p.Radius;
                list.Add(new RfMarkerPart { Id = idBase + k++, Mid = p.Mid, Length = len });
            }
            return list;
        }

        [Test]
        public static void One_marker_of_every_style_is_a_single_cluster_with_the_expected_part_count()
        {
            foreach (RfMarkerStyle st in new[] { RfMarkerStyle.Circle, RfMarkerStyle.Cross, RfMarkerStyle.Slash })
            {
                List<RfMarkerPart> parts = PartsOf(100, st, new RfV2(5, 5), 0.4);
                List<List<int>> g = RfMarkerCluster.Split(parts);
                Assert.Eq(1, g.Count, st + " нэг бүлэг");
                Assert.Eq(RfMarkerCluster.ExpectedParts(st), g[0].Count, st + " элементийн тоо");
            }
        }

        [Test]
        public static void Pasted_copy_is_a_separate_cluster_and_the_original_stays_primary()
        {
            // Эх (id 100–101) + Copy/Paste хийсэн хуулбар (id 200–201), 3 м зайтай.
            var parts = new List<RfMarkerPart>();
            parts.AddRange(PartsOf(100, RfMarkerStyle.Circle, new RfV2(0, 0), 0.4));
            parts.AddRange(PartsOf(200, RfMarkerStyle.Circle, new RfV2(3, 0), 0.4));
            List<List<int>> g = RfMarkerCluster.Split(parts);
            Assert.Eq(2, g.Count);
            Assert.True(g[0].All(i => parts[i].Id < 200), "эхний бүлэг = анх үүссэн (бага id)");
            Assert.True(g[1].All(i => parts[i].Id >= 200), "хуулбар = тусдаа бүлэг");
        }

        [Test]
        public static void Primary_is_chosen_by_lowest_id_even_if_the_copy_is_listed_first()
        {
            var parts = new List<RfMarkerPart>();
            parts.AddRange(PartsOf(300, RfMarkerStyle.Cross, new RfV2(9, 9), 0.4));   // хуулбар (шинэ id) эхэлж орсон
            parts.AddRange(PartsOf(100, RfMarkerStyle.Cross, new RfV2(0, 0), 0.4));   // эх
            List<List<int>> g = RfMarkerCluster.Split(parts);
            Assert.Eq(2, g.Count);
            Assert.True(g[0].All(i => parts[i].Id < 200), "жагсаалтын дараалал биш id шийднэ");
        }

        [Test]
        public static void Half_deleted_circle_is_one_cluster_with_fewer_parts_than_expected()
        {
            List<RfMarkerPart> parts = PartsOf(100, RfMarkerStyle.Circle, new RfV2(0, 0), 0.4);
            parts.RemoveAt(1);
            List<List<int>> g = RfMarkerCluster.Split(parts);
            Assert.Eq(1, g.Count);
            Assert.True(g[0].Count < RfMarkerCluster.ExpectedParts(RfMarkerStyle.Circle), "гэмтсэн (1 < 2) — дуудагч «гэмтсэн» гэж тоолно");
        }

        [Test]
        public static void Pasted_copy_right_on_top_merges_with_the_original()
        {
            // Яг давхцуулж paste хийвэл (ижил байрлал) салгах боломжгүй — нэг бүлэг (4 элемент).  Дуудагч «хэт олон элемент» гэж таньж хөндөхгүй.
            var parts = new List<RfMarkerPart>();
            parts.AddRange(PartsOf(100, RfMarkerStyle.Cross, new RfV2(0, 0), 0.4));
            parts.AddRange(PartsOf(200, RfMarkerStyle.Cross, new RfV2(0, 0), 0.4));
            List<List<int>> g = RfMarkerCluster.Split(parts);
            Assert.Eq(1, g.Count);
            Assert.True(g[0].Count > RfMarkerCluster.ExpectedParts(RfMarkerStyle.Cross), "хэт олон элемент");
        }

        [Test]
        public static void Empty_and_null_inputs_give_no_clusters()
        {
            Assert.Eq(0, RfMarkerCluster.Split(null).Count);
            Assert.Eq(0, RfMarkerCluster.Split(new List<RfMarkerPart>()).Count);
        }
    }
}
