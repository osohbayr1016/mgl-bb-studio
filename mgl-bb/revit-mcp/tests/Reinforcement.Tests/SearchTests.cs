using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement.Tests
{
    /// <summary>
    /// Тэмдгийн (Family / Type) сонгогч ба эх түүврийн сонгогчийн «шууд хайлт» — ХОЁУЛАА ижил <see cref="RfSearch"/> / <see cref="RfFilteredList{T}"/>.
    /// Revit-ийн жагсаалтыг нэг удаа цуглуулж, энд санах ойд шүүнэ.
    /// </summary>
    public static class SearchTests
    {
        private sealed class Sym
        {
            public string Family, Type;
            public override string ToString() { return Family + " : " + Type; }
        }

        private static List<Sym> Symbols()
        {
            return new List<Sym>
            {
                new Sym { Family = "MGL End Mark", Type = "Circle 3mm" },
                new Sym { Family = "MGL End Mark", Type = "Cross 3mm" },
                new Sym { Family = "Detail Item Generic", Type = "Slash" },
                new Sym { Family = "Арматурын тэмдэг", Type = "Дугуй" },
                new Sym { Family = "Өргөн Үзүүр", Type = "ТОМ" },
            };
        }

        private static Func<Sym, string> Hay { get { return s => RfSearch.SymbolHaystack(s.Family, s.Type); } }

        [Test]
        public static void Marker_search_matches_family_name()
        {
            List<Sym> r = RfSearch.Filter(Symbols(), Hay, "detail item");
            Assert.Eq(1, r.Count);
            Assert.Eq("Slash", r[0].Type);
        }

        [Test]
        public static void Marker_search_matches_type_name()
        {
            List<Sym> r = RfSearch.Filter(Symbols(), Hay, "cross");
            Assert.Eq(1, r.Count);
            Assert.Eq("Cross 3mm", r[0].Type);
        }

        [Test]
        public static void Marker_search_matches_combined_family_and_type_text()
        {
            Assert.Eq(1, RfSearch.Filter(Symbols(), Hay, "MGL End Mark : Circle").Count, "Family : Type бүтнээр");
            Assert.Eq(1, RfSearch.Filter(Symbols(), Hay, "end circle").Count, "Family-ийн хэсэг + Type-ийн хэсэг (AND)");
            Assert.Eq(2, RfSearch.Filter(Symbols(), Hay, "mgl 3mm").Count);
        }

        [Test]
        public static void Marker_search_is_case_insensitive_for_cyrillic_and_latin()
        {
            Assert.Eq(1, RfSearch.Filter(Symbols(), Hay, "ДУГУЙ").Count, "ТОМ үсэг → жижиг");
            Assert.Eq(1, RfSearch.Filter(Symbols(), Hay, "арматурын").Count);
            Assert.Eq(1, RfSearch.Filter(Symbols(), Hay, "АРМАТУРЫН ТЭМДЭГ").Count);
            Assert.Eq(2, RfSearch.Filter(Symbols(), Hay, "mgl end mark").Count);
            Assert.Eq(2, RfSearch.Filter(Symbols(), Hay, "MGL END MARK").Count);
            // Монгол Ө/Ү: том үсгээр хадгалагдсан нэрийг жижиг үсгээр хайна.
            Assert.Eq(1, RfSearch.Filter(Symbols(), Hay, "өргөн үзүүр").Count);
            Assert.Eq(1, RfSearch.Filter(Symbols(), Hay, "ТОМ").Count);
            Assert.Eq(1, RfSearch.Filter(Symbols(), Hay, "том").Count);
        }

        [Test]
        public static void Search_empty_or_blank_query_returns_everything_in_original_order()
        {
            List<Sym> all = Symbols();
            Assert.SeqEq(all, RfSearch.Filter(all, Hay, ""));
            Assert.SeqEq(all, RfSearch.Filter(all, Hay, "   "));
            Assert.SeqEq(all, RfSearch.Filter(all, Hay, null));
        }

        [Test]
        public static void Search_extra_spaces_are_ignored()
        {
            Assert.Eq(1, RfSearch.Filter(Symbols(), Hay, "   end     CIRCLE ").Count);
        }

        [Test]
        public static void Search_no_match_is_reported_and_list_is_empty()
        {
            var list = new RfFilteredList<Sym>(Symbols(), Hay);
            list.SetQuery("zzzz-нэг-ч-үгүй");
            Assert.True(list.NoMatch, "«Илэрц олдсонгүй»");
            Assert.Eq(0, list.Items.Count);
            list.SetQuery("");
            Assert.False(list.NoMatch);
            Assert.Eq(Symbols().Count, list.Items.Count);
        }

        [Test]
        public static void Search_selection_is_preserved_while_filtering_and_never_silently_changed()
        {
            List<Sym> all = Symbols();
            var list = new RfFilteredList<Sym>(all, Hay);
            list.Select(all[1]); // Cross 3mm

            list.SetQuery("cross");
            Assert.True(list.SelectedVisible, "шүүгдсэн жагсаалтад үлдсэн — сонголт хэвээр");
            Assert.True(ReferenceEquals(all[1], list.Selected));

            // Сонгосон нь шүүлтээр НУУГДСАН ч сонголт ӨӨРЧЛӨГДӨХГҮЙ (хадгалсан тохиргоог чимээгүй солихгүй).
            list.SetQuery("slash");
            Assert.False(list.SelectedVisible);
            Assert.True(ReferenceEquals(all[1], list.Selected), "сонголт өөрчлөгдөөгүй");

            list.SetQuery("zzz");
            Assert.True(ReferenceEquals(all[1], list.Selected), "илэрцгүй үед ч хэвээр");

            // Хайлтыг арилгахад дахин харагдана.
            list.SetQuery("");
            Assert.True(list.SelectedVisible);

            // Зөвхөн хэрэглэгч ӨӨР зүйл ИЛ сонгосон үед л солигдоно.
            list.SetQuery("slash");
            list.Select(list.Items[0]);
            Assert.True(ReferenceEquals(all[2], list.Selected));
        }

        // ── Эх түүвэр ──────────────────────────────────────────────────

        private static List<string> ScheduleNames()
        {
            // Revit-ийн дарааллаар (эрэмбэгүй) ирнэ; Templates() нь байгалийн эрэмбээр эрэмбэлдэг.
            var l = new List<string> { "ДН-10", "Beam DN-3 Reinforcement", "ДН-2", "ДН-1", "Колонн К-1", "dn-4 лавлах" };
            l.Sort(RfNaturalComparer.Instance);
            return l;
        }

        [Test]
        public static void Source_schedule_search_by_cyrillic_partial_name_keeps_natural_order()
        {
            List<string> r = RfSearch.Filter(ScheduleNames(), s => s, "дн");
            // «ДН-1», «ДН-2», «ДН-10» — байгалийн эрэмбэ (1 < 2 < 10), «DN»-ийг (латин) агуулаагүй.
            Assert.SeqEq(new[] { "ДН-1", "ДН-2", "ДН-10" }, r);
        }

        [Test]
        public static void Source_schedule_search_is_case_insensitive_latin_and_cyrillic()
        {
            Assert.Eq(2, RfSearch.Filter(ScheduleNames(), s => s, "DN").Count, "Beam DN-3 + dn-4 (том/жижиг үсэг үл хамаарна)");
            Assert.Eq(1, RfSearch.Filter(ScheduleNames(), s => s, "колонн").Count);
            Assert.Eq(1, RfSearch.Filter(ScheduleNames(), s => s, "КОЛОНН К-1").Count);
        }

        [Test]
        public static void Source_schedule_search_no_match_and_selection_preserved()
        {
            var list = new RfFilteredList<string>(ScheduleNames(), s => s);
            list.Select("ДН-2");
            list.SetQuery("ДН-1");
            Assert.SeqEq(new[] { "ДН-1", "ДН-10" }, list.Items); // подстрока: «ДН-10» мөн орно
            Assert.False(list.SelectedVisible, "ДН-2 нуугдсан ч сонгогдсон хэвээр");
            Assert.Eq("ДН-2", list.Selected);
            list.SetQuery("олдохгүй");
            Assert.True(list.NoMatch);
            list.SetQuery("дн-2");
            Assert.True(list.SelectedVisible);
        }

        [Test]
        public static void Source_schedule_natural_order_DN1_DN2_DN10()
        {
            var l = new List<string> { "ДН-10", "ДН-2", "ДН-1" };
            l.Sort(RfNaturalComparer.Instance);
            Assert.SeqEq(new[] { "ДН-1", "ДН-2", "ДН-10" }, l);
        }
    }
}
