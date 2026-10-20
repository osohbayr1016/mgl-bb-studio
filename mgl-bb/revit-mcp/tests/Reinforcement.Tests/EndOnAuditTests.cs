using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement.Tests
{
    /// <summary>
    /// «Арматурын төгсгөлийн тэмдэг»-ийн end-on (харагдацын нормаль дагуух, цэг болж харагдах) арматурын ДАХИН АЖИЛЛУУЛАЛТЫН
    /// idempotency — <see cref="RfEndSymbolMath.AlreadyPlaced"/> нь EndSymbolService.PlaceFor-ийн давхардлын шийдвэрийн ГАНЦ эх сурвалж.
    /// </summary>
    public static class EndOnAuditTests
    {
        /// <summary>PlaceFor-ийн давхардал/гүнгийн логикийг (Revit-гүй) ЯГ ДАГАЖ нэг арматурын нэг ширхгийг боловсруулна; тавигдсан тоог буцаана.</summary>
        private static int Pass(HashSet<string> store, bool endOn, RfPlaceMode place, bool startInDepth, bool endInDepth, bool allowDuplicates = false)
        {
            var endOnPlaced = new HashSet<string>(StringComparer.Ordinal);
            int placed = 0;
            foreach (RfEndKind kind in new[] { RfEndKind.Start, RfEndKind.End })
            {
                if (!RfEndSymbolMath.Wants(place, kind)) continue;
                string key = RfEndSymbolMath.DupKey("R1", kind, 0, true);
                if (!allowDuplicates && RfEndSymbolMath.AlreadyPlaced(k => store.Contains(k), "R1", kind, 0, true, endOn)) continue;
                if (endOn)
                {
                    bool inDepth = kind == RfEndKind.Start ? startInDepth : endInDepth;
                    if (!inDepth) continue;
                    if (!endOnPlaced.Add("R1|0")) continue;
                }
                store.Add(key);
                placed++;
            }
            return placed;
        }

        [Test]
        public static void EndOn_bar_both_ends_in_depth_places_ONE_symbol_and_rerun_places_none()
        {
            var store = new HashSet<string>();
            Assert.Eq(1, Pass(store, true, RfPlaceMode.Both, true, true), "эхний ажиллуулалт: нэг цэгт нэг тэмдэг");
            Assert.Eq(0, Pass(store, true, RfPlaceMode.Both, true, true), "дахин ажиллуулалт: давхар тавихгүй");
            Assert.Eq(0, Pass(store, true, RfPlaceMode.Both, true, true), "гурав дахь ч мөн");
            Assert.Eq(1, store.Count);
        }

        [Test]
        public static void EndOn_old_logic_would_double_place_regression_guard()
        {
            // Хуучин логик: түлхүүр зөвхөн ӨӨРИЙН төгсгөлөөр (endOn=false-тай адил) шалгагдвал 2 дахь ажиллуулалт Төгсгөлд дахин тавина.
            var store = new HashSet<string>();
            Pass(store, true, RfPlaceMode.Both, true, true);
            int secondRunOldRule = 0;
            foreach (RfEndKind kind in new[] { RfEndKind.Start, RfEndKind.End })
            {
                if (!RfEndSymbolMath.AlreadyPlaced(k => store.Contains(k), "R1", kind, 0, true, endOn: false)) secondRunOldRule++;
            }
            Assert.Eq(1, secondRunOldRule, "endOn-гүйгээр шалгавал Төгсгөл «байхгүй» гэж харагдана — ЭНЭ нь засагдсан алдаа");
        }

        [Test]
        public static void EndOn_only_one_end_in_depth_is_still_idempotent()
        {
            var a = new HashSet<string>();
            Assert.Eq(1, Pass(a, true, RfPlaceMode.Both, false, true));
            Assert.Eq(0, Pass(a, true, RfPlaceMode.Both, false, true));

            var b = new HashSet<string>();
            Assert.Eq(1, Pass(b, true, RfPlaceMode.Both, true, false));
            Assert.Eq(0, Pass(b, true, RfPlaceMode.Both, true, false));
        }

        [Test]
        public static void EndOn_placing_Start_only_then_End_only_does_not_stack_a_second_symbol()
        {
            var store = new HashSet<string>();
            Assert.Eq(1, Pass(store, true, RfPlaceMode.StartOnly, true, true));
            Assert.Eq(0, Pass(store, true, RfPlaceMode.EndOnly, true, true), "нэг цэг — тэмдэг аль хэдийн бий");
        }

        [Test]
        public static void Normal_bar_places_both_ends_independently_and_rerun_is_idempotent()
        {
            var store = new HashSet<string>();
            Assert.Eq(2, Pass(store, false, RfPlaceMode.Both, true, true), "энгийн арматур: хоёр төгсгөл тус тусдаа");
            Assert.Eq(0, Pass(store, false, RfPlaceMode.Both, true, true));
            Assert.Eq(2, store.Count);
        }

        [Test]
        public static void Normal_bar_other_end_is_not_blocked_by_the_first()
        {
            var store = new HashSet<string>();
            Assert.Eq(1, Pass(store, false, RfPlaceMode.StartOnly, true, true));
            Assert.Eq(1, Pass(store, false, RfPlaceMode.EndOnly, true, true), "end-on биш үед нөгөө төгсгөл хаагдахгүй");
        }

        [Test]
        public static void Hooks_mode_is_part_of_the_key_so_switching_it_is_not_a_duplicate()
        {
            var store = new HashSet<string> { RfEndSymbolMath.DupKey("R1", RfEndKind.Start, 0, true) };
            Assert.False(RfEndSymbolMath.AlreadyPlaced(k => store.Contains(k), "R1", RfEndKind.Start, 0, false, true));
            Assert.True(RfEndSymbolMath.AlreadyPlaced(k => store.Contains(k), "R1", RfEndKind.Start, 0, true, false));
        }

        [Test]
        public static void Bar_index_and_rebar_are_part_of_the_key()
        {
            var store = new HashSet<string> { RfEndSymbolMath.DupKey("R1", RfEndKind.Start, 0, true) };
            Assert.False(RfEndSymbolMath.AlreadyPlaced(k => store.Contains(k), "R1", RfEndKind.End, 1, true, true), "өөр ширхэг");
            Assert.False(RfEndSymbolMath.AlreadyPlaced(k => store.Contains(k), "R2", RfEndKind.End, 0, true, true), "өөр арматур");
        }
    }
}
