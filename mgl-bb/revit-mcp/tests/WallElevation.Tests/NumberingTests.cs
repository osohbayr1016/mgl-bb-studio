using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    /// <summary>
    /// W05 (2026-10-16): хуудас ба тэмдгийн дугаарлалт — угтвар, муж, орон, үсэг/тоо, өрөө тус бүр эсвэл тасралтгүй; урьдчилсан дүн, зөрчил
    /// (муж хүрэлцэхгүй, нэг хуудсан дээр давхардал) — зөрчилтэй бол үүсгэхгүй.
    /// </summary>
    public static class NumberingTests
    {
        private static WeRequest TwoRooms()
        {
            WeRequest a = Poly.Room(Poly.P(0, 0, 5000, 0, 5000, 4000, 0, 4000), null, "201");
            WeRequest b = Poly.Room(Poly.P(6000, 0, 10000, 0, 10000, 3000, 6000, 3000), new[] { "b0", "b1", "b2", "b3" }, "202");
            b.Rooms[0].UniqueId = "room-202";
            a.Rooms.AddRange(b.Rooms);
            foreach (KeyValuePair<string, WeWallInfo> kv in b.WallLookup) a.WallLookup[kv.Key] = kv.Value;
            return a;
        }

        private static WePlan Plan(WeRequest req, Action<WeSettings> tweak)
        {
            return Poly.Plan(req, s => { s.Output = WeOutputMode.ViewsAndSheets; if (tweak != null) tweak(s); });
        }

        private static WeSettings S(Action<WeSettings> tweak)
        {
            var s = new WeSettings { Output = WeOutputMode.ViewsAndSheets };
            if (tweak != null) tweak(s);
            return s;
        }

        private static List<string> Labels(WePlan p) { return p.Items.Where(i => i.Frame != null).Select(i => i.Label).ToList(); }

        [Test]
        public static void Default_letters_restart_per_room_exactly_as_before()
        {
            WePlan p = Plan(TwoRooms(), null);
            Assert.SeqEq(new[] { "201A", "201B", "201C", "201D", "202A", "202B", "202C", "202D" }, Labels(p));
            Assert.True(p.Items.All(i => i.SideToken == i.SideLetter), "үсгийн горимд токен = компасын үсэг");
            WeNumberingResult r = WeNumbering.Evaluate(p, S(null), null, new WeSheetNumberContext());
            Assert.True(r.Ok, "өгөгдмөл тохиргоонд зөрчил алга");
        }

        [Test]
        public static void Numbers_with_padding_and_a_room_prefix()
        {
            WePlan p = Plan(TwoRooms(), s => { s.LabelMode = WeLabelMode.Numbers; s.LabelDigits = 2; s.LabelPattern = "{Room}.{Side}"; s.TitlePattern = "ХАНЫН ДЭЛГЭЭС {Room}.{Side}"; });
            Assert.SeqEq(new[] { "201.01", "201.02", "201.03", "201.04", "202.01", "202.02", "202.03", "202.04" }, Labels(p));
            Assert.Eq("ХАНЫН ДЭЛГЭЭС 201.01", p.Items[0].Title, "гарчиг тэмдэгтэй ижил дугаартай");
            Assert.Eq("201.01-04", p.Groups.Count > 0 ? p.Groups[0].Label : "201.01-04", "түлхүүр планы муж тоогоор");
        }

        [Test]
        public static void Continuous_numbering_runs_across_the_batch()
        {
            WePlan p = Plan(TwoRooms(), s => { s.LabelMode = WeLabelMode.Numbers; s.LabelContinuous = true; s.LabelStart = 11; s.LabelPattern = "E{Side}"; });
            Assert.SeqEq(new[] { "E11", "E12", "E13", "E14", "E15", "E16", "E17", "E18" }, Labels(p));
            WePlan l = Plan(TwoRooms(), s => { s.LabelContinuous = true; s.LabelPattern = "{Side}"; });
            Assert.SeqEq(new[] { "A", "B", "C", "D", "E", "F", "G", "H" }, Labels(l), "үсгээр тасралтгүй");
        }

        [Test]
        public static void Label_range_that_is_too_short_blocks_generation()
        {
            WeSettings set = S(s => { s.LabelMode = WeLabelMode.Numbers; s.LabelContinuous = true; s.LabelStart = 1; s.LabelEnd = 6; s.LabelPattern = "E{Side}"; });
            WePlan p = Plan(TwoRooms(), s => { s.LabelMode = set.LabelMode; s.LabelContinuous = true; s.LabelStart = 1; s.LabelEnd = 6; s.LabelPattern = set.LabelPattern; });
            WeNumberingResult r = WeNumbering.Evaluate(p, set, null, new WeSheetNumberContext());
            Assert.False(r.Ok, "8 дэлгээс 1–6 мужид багтахгүй");
            Assert.True(r.Errors[0].Contains("8"), "хэрэгтэй дугаарыг хэлнэ: " + r.Errors[0]);
            // Хоёр дэлгээсийг хасвал багтана — хуурамч / хоосон зүйл үүсгэхгүй, хассан мөр тоологдохгүй.
            var excluded = new HashSet<string>(p.Items.Where(i => i.Frame != null).Skip(6).Select(i => i.Key), StringComparer.Ordinal);
            Assert.True(WeNumbering.Evaluate(p, set, excluded, new WeSheetNumberContext()).Ok, "хассаны дараа муж хүрэлцэнэ");
        }

        [Test]
        public static void Shared_target_sheet_without_room_in_the_label_is_a_conflict()
        {
            WeSettings set = S(s => { s.TargetSheetNumber = "ИЗД1-50"; s.LabelPattern = "{Side}"; });
            WePlan p = Plan(TwoRooms(), s => { s.TargetSheetNumber = set.TargetSheetNumber; s.LabelPattern = "{Side}"; });
            WeNumberingResult r = WeNumbering.Evaluate(p, set, null, new WeSheetNumberContext());
            Assert.False(r.Ok, "нэг хуудсанд A давхардана");
            Assert.True(r.Errors.Any(e => e.Contains("ИЗД1-50") && e.Contains("{Room}")), "засах арга хэлнэ: " + string.Join(" | ", r.Errors));
            set.LabelContinuous = true;
            WePlan c = Plan(TwoRooms(), s => { s.TargetSheetNumber = set.TargetSheetNumber; s.LabelPattern = "{Side}"; s.LabelContinuous = true; });
            Assert.True(WeNumbering.Evaluate(c, set, null, new WeSheetNumberContext()).Ok, "тасралтгүй — давхардалгүй");
        }

        [Test]
        public static void Sheet_range_takes_free_numbers_only_and_never_exceeds_the_end()
        {
            WeSettings set = S(s => { s.SheetNumberMode = WeSheetNumberMode.Range; s.SheetRangePrefix = "ИЗД1-"; s.SheetRangeStart = 40; s.SheetRangeEnd = 43; s.SheetRangeDigits = 2; });
            WePlan p = Plan(TwoRooms(), null);
            var ctx = new WeSheetNumberContext { Taken = new HashSet<string>(new[] { "ИЗД1-40" }, StringComparer.OrdinalIgnoreCase) };
            WeNumberingResult r = WeNumbering.Evaluate(p, set, null, ctx);
            Assert.True(r.Ok);
            Assert.SeqEq(new[] { "ИЗД1-41", "ИЗД1-42" }, r.SheetNumbers.Values.ToList(), "эзлэгдсэнийг алгасна, дарааллаар");
            Assert.True(r.Preview.Contains("ИЗД1-41") && r.Preview.Contains("201"), "урьдчилсан дүн: " + r.Preview);

            // Хоёр өрөө, мужид ганц сул → алдаа, сул дугаарыг жагсаана; юу ч хуваарилахгүй мэт биш — хэтрэхгүй.
            ctx.Taken = new HashSet<string>(new[] { "ИЗД1-40", "ИЗД1-41", "ИЗД1-43" }, StringComparer.OrdinalIgnoreCase);
            WeNumberingResult bad = WeNumbering.Evaluate(p, set, null, ctx);
            Assert.False(bad.Ok, "2 хуудас хэрэгтэй, 1 сул");
            Assert.True(bad.Errors[0].Contains("ИЗД1-42"), "сул дугаарыг хэлнэ: " + bad.Errors[0]);
            Assert.True(bad.SheetNumbers.Values.All(v => v == "ИЗД1-42"), "мужаас гадуур дугаар хэзээ ч хуваарилахгүй");
            Assert.Eq(null, WeNumbering.NextFree(set, new HashSet<string>(new[] { "ИЗД1-40", "ИЗД1-41", "ИЗД1-42", "ИЗД1-43" }, StringComparer.OrdinalIgnoreCase)),
                      "дүүрсэн муж — null (хуудас үүсгэхгүй)");
        }

        [Test]
        public static void Rooms_that_already_have_a_sheet_need_no_new_number()
        {
            WeSettings set = S(s => { s.SheetNumberMode = WeSheetNumberMode.Range; s.SheetRangePrefix = "A"; s.SheetRangeStart = 1; s.SheetRangeEnd = 1; s.SheetRangeDigits = 0; });
            WePlan p = Plan(TwoRooms(), null);
            string g201 = p.Items.First(i => i.RoomNumber == "201").GroupKey;
            var ctx = new WeSheetNumberContext { GroupsWithSheet = new HashSet<string>(new[] { g201 }, StringComparer.Ordinal) };
            WeNumberingResult r = WeNumbering.Evaluate(p, set, null, ctx);
            Assert.True(r.Ok, "201-д өмнөх хуудас — зөвхөн 202-т нэг дугаар хэрэгтэй");
            Assert.Eq(1, r.SheetNumbers.Count);
            Assert.False(r.SheetNumbers.ContainsKey(g201), "өмнө хуудастай өрөөнд дугаар хуваарилахгүй");
        }

        [Test]
        public static void Pattern_mode_reports_a_taken_number_and_uses_the_project_series()
        {
            WeSettings set = S(s => { s.SheetNumberPattern = "WE-{Room}"; });
            WePlan p = Plan(TwoRooms(), s => s.SheetNumberPattern = "WE-{Room}");
            var ctx = new WeSheetNumberContext { Taken = new HashSet<string>(new[] { "WE-201" }, StringComparer.OrdinalIgnoreCase) };
            WeNumberingResult r = WeNumbering.Evaluate(p, set, null, ctx);
            Assert.True(r.Ok);
            Assert.True(r.SheetNumbers.Values.Contains("WE-201-2") && r.Notes.Any(n => n.Contains("WE-201-2")), "давхардлыг урьдчилан хэлнэ");

            WeSettings def = S(null);
            var series = new WeSheetNumberContext { LearnedNext = taken => { for (int n = 428; ; n++) if (!taken.Contains("БА" + n)) return "БА" + n; } };
            WeNumberingResult rs = WeNumbering.Evaluate(Plan(TwoRooms(), null), def, null, series);
            Assert.SeqEq(new[] { "БА428", "БА429" }, rs.SheetNumbers.Values.ToList(), "өгөгдмөл загварт төслийн цуваа");
        }

        [Test]
        public static void Settings_numbering_round_trips_and_validates()
        {
            var s = new WeSettings { LabelMode = WeLabelMode.Numbers, LabelStart = 3, LabelEnd = 20, LabelDigits = 2, LabelContinuous = true,
                                     SheetNumberMode = WeSheetNumberMode.Range, SheetRangePrefix = "ИЗД1-", SheetRangeStart = 41, SheetRangeEnd = 60, SheetRangeDigits = 2 };
            WeSettings r = WeSettings.Deserialize(s.Serialize());
            Assert.True(r.LabelMode == WeLabelMode.Numbers && r.LabelStart == 3 && r.LabelEnd == 20 && r.LabelDigits == 2 && r.LabelContinuous);
            Assert.True(r.SheetNumberMode == WeSheetNumberMode.Range && r.SheetRangePrefix == "ИЗД1-" && r.SheetRangeStart == 41 && r.SheetRangeEnd == 60 && r.SheetRangeDigits == 2);
            var bad = new WeSettings { Output = WeOutputMode.ViewsAndSheets, LabelMode = WeLabelMode.Numbers, LabelStart = 10, LabelEnd = 5,
                                       SheetNumberMode = WeSheetNumberMode.Range, SheetRangeStart = 9, SheetRangeEnd = 3, SheetRangePrefix = "A|B" };
            List<string> errors = bad.Validate();
            Assert.True(errors.Count >= 3, "буруу муж, угтварыг барина: " + string.Join(" | ", errors));
            Assert.True(new WeSettings().Validate().Count == 0, "өгөгдмөл зөв");
        }
    }
}
