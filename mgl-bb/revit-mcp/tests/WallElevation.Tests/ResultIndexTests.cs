using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    /// <summary>
    /// W06 (2026-10-16): үр дүнгийн индекс — Өрөө → Дэлгээс → ОДООГИЙН хуудас.  Баримтаас (ES таних тэмдэг + бодит viewport) дахин бүтээгдэнэ:
    /// гараар зөөсөн, хуудаснаас авсан, устгасан, Revit дахин асаасан ч зөв; сүүлийн ажиллагааны «шинэ / шинэчилсэн / үүсгээгүй / алдаа» нэмэлт.
    /// </summary>
    public static class ResultIndexTests
    {
        private static WeResultViewInfo V(string room, string key, string label, long viewId, long sheetId = 0, string sheetNo = null,
                                          WeResultKind kind = WeResultKind.Elevation, bool off = false, bool overlap = false)
        {
            return new WeResultViewInfo
            {
                Kind = kind, Key = key, RoomUid = room, ViewId = viewId, ViewName = "WE-" + label,
                DetailNumber = sheetId != 0 ? label : null, ViewportId = sheetId != 0 ? viewId + 1000 : 0,
                SheetId = sheetId, SheetNumber = sheetNo, SheetName = sheetNo != null ? "Room sheet" : null,
                OutOfFrame = off, Overlaps = overlap,
            };
        }

        private static readonly Func<string, string> Labels = uid => uid == "r205" ? "Өрөө 205 — Гал тогоо" : uid == "r101" ? "Өрөө 101 — Оффис" : null;

        [Test]
        public static void Rooms_group_their_elevations_and_list_the_actual_sheets()
        {
            var views = new List<WeResultViewInfo>
            {
                V("r205", "k205B", "205B", 11, 500, "A-301"),
                V("r205", "k205A", "205A", 10, 500, "A-301"),
                V("r205", "kp205", "205A-B", 12, 500, "A-301", WeResultKind.KeyPlan),
                // Хэрэглэгч 205C-г гараар өөр хуудас руу зөөсөн — тэр хуудсыг харуулна, буцааж татахгүй.
                V("r205", "k205C", "205C", 13, 777, "A-305"),
                V("r101", "k101A", "101A", 20, 600, "A-201"),
            };
            List<WeResultRoom> rooms = WeResultIndex.Build(views, null, Labels);
            Assert.Eq(2, rooms.Count);
            WeResultRoom kitchen = rooms.Single(r => r.RoomUid == "r205");
            Assert.Eq("Өрөө 205 — Гал тогоо", kitchen.Label);
            Assert.SeqEq(new[] { "205A", "205B", "205C", "205A-B" }, kitchen.Rows.Select(r => r.Label), "дэлгээс тэмдгээр, дараа нь түлхүүр план");
            Assert.SeqEq(new[] { "A-301", "A-305" }, kitchen.Sheets.Select(s => s.Value), "өрөөний бүх БОДИТ хуудас (гараар зөөсөн ч)");
            Assert.Eq("A-305", kitchen.Rows.Single(r => r.Key == "k205C").SheetNumber);
            Assert.True(kitchen.Rows.All(r => r.State == WeResultState.Ok));
            Assert.True(kitchen.Rows.Single(r => r.Key == "k205C").Title.Contains("→  A-305"), kitchen.Rows.Single(r => r.Key == "k205C").Title);
        }

        [Test]
        public static void States_reflect_unplaced_arrangement_and_run_failures()
        {
            var views = new List<WeResultViewInfo>
            {
                V("r205", "kA", "205A", 10, 500, "A-301"),
                V("r205", "kB", "205B", 11, 500, "A-301", off: true),
                V("r205", "kC", "205C", 12, 500, "A-301", overlap: true),
                V("r205", "kD", null, 13),   // хуудсаас авсан (эсвэл байршаагүй)
            };
            var run = new List<WeResultRunInfo>
            {
                new WeResultRunInfo { Key = "kA", RoomUid = "r205", Label = "205A", Change = WeResultChange.New },
                new WeResultRunInfo { Key = "kB", RoomUid = "r205", Label = "205B", Change = WeResultChange.Updated },
                new WeResultRunInfo { Key = "kE", RoomUid = "r205", Label = "205E", Failed = true, Message = "Алдаа: шалгалт унав" },
                // Харагдац нь баримтад байгаа бол «алдаа» гэж давхар харуулахгүй.
                new WeResultRunInfo { Key = "kC", RoomUid = "r205", Label = "205C", Failed = true, Message = "хуучин" },
            };
            WeResultRoom room = WeResultIndex.Build(views, run, Labels).Single();
            Func<string, WeResultRow> row = k => room.Rows.Single(r => r.Key == k);
            Assert.Eq(WeResultState.Ok, row("kA").State);
            Assert.Eq(WeResultChange.New, row("kA").Change);
            Assert.Eq(WeResultState.Arrange, row("kB").State, "хүрээнээс гадуур — цэгцлэх");
            Assert.Eq(WeResultChange.Updated, row("kB").Change);
            Assert.Eq(WeResultState.Arrange, row("kC").State, "давхацсан — цэгцлэх");
            Assert.Eq(WeResultState.Unplaced, row("kD").State, "хуудсанд байршаагүй");
            Assert.Eq(WeResultState.Failed, row("kE").State, "энэ ажиллагаанд үүссэнгүй — харагдацгүй мөр");
            Assert.True(row("kE").Note.Contains("шалгалт унав"));
            Assert.Eq(5, room.Rows.Count, "давхардалгүй");
            Assert.Eq(WeResultState.Failed, room.Worst);
            string sum = WeResultIndex.Summary(new List<WeResultRoom> { room });
            Assert.True(sum.Contains("4 дэлгээс") && sum.Contains("1 хуудас") && sum.Contains("2 цэгцлэх") && sum.Contains("1 хуудасгүй") && sum.Contains("1 алдаа"), sum);
        }

        [Test]
        public static void Deleted_views_disappear_and_only_rooms_filters_the_batch()
        {
            var before = new List<WeResultViewInfo> { V("r205", "kA", "205A", 10, 500, "A-301"), V("r205", "kB", "205B", 11, 500, "A-301"), V("r101", "k1", "101A", 20, 600, "A-201") };
            Assert.Eq(3, WeResultIndex.Build(before, null, Labels).Sum(r => r.Rows.Count));
            // Хэрэглэгч 205B-г устгасан — баримтад байхгүй тул жагсаалтад ч алга (хуучин санах ойгоос сэргээхгүй).
            List<WeResultRoom> after = WeResultIndex.Build(before.Where(v => v.Key != "kB"), null, Labels);
            Assert.False(after.SelectMany(r => r.Rows).Any(r => r.Key == "kB"));
            List<WeResultRoom> only = WeResultIndex.Build(before, null, Labels, new HashSet<string> { "r101" });
            Assert.Eq("r101", only.Single().RoomUid, "нэг ажлын өрөөнүүд");
        }

        [Test]
        public static void Unknown_room_labels_fall_back_to_the_run_label_or_the_id()
        {
            var views = new List<WeResultViewInfo> { V("rX", "kX", "9A", 1, 9, "S-9"), V("", "kW", "A", 2) };
            var run = new List<WeResultRunInfo> { new WeResultRunInfo { Key = "kX", RoomUid = "rX", GroupLabel = "Өрөө 9 (link ачаалагдаагүй)" } };
            List<WeResultRoom> rooms = WeResultIndex.Build(views, run, uid => null);
            Assert.Eq("Өрөө 9 (link ачаалагдаагүй)", rooms.Single(r => r.RoomUid == "rX").Label);
            Assert.Eq("Хана (өрөөгүй дэлгээс)", rooms.Single(r => r.RoomUid == "").Label, "хана горимын дэлгээс тусдаа, хамгийн сүүлд");
            Assert.Eq("", rooms.Last().RoomUid);
        }

        [Test]
        public static void Assess_flags_out_of_frame_and_overlap_but_not_touching_edges()
        {
            double[] frame = { 0, 0, 2, 1 };
            var rects = new List<double[]>
            {
                new double[] { 0.1, 0.1, 0.5, 0.5 },      // дотор
                new double[] { 0.5, 0.1, 0.9, 0.5 },      // өмнөхтэй ирмэгээр шүргэнэ — давхцал биш
                new double[] { 1.8, 0.6, 2.4, 0.9 },      // хүрээнээс гадуур
                new double[] { 1.0, 0.1, 1.4, 0.5 },
                new double[] { 1.2, 0.2, 1.6, 0.6 },      // өмнөхтэй давхцана
                null,
            };
            bool[] off, ov;
            WeResultIndex.Assess(rects, frame, out off, out ov);
            Assert.SeqEq(new[] { false, false, true, false, false, false }, off);
            Assert.SeqEq(new[] { false, false, false, true, true, false }, ov);
            WeResultIndex.Assess(rects, null, out off, out ov);
            Assert.False(off.Any(x => x), "title block-гүй хуудас — гадна гэж тооцохгүй");
        }

        [Test]
        public static void Run_rows_map_outcomes_and_skip_user_exclusions()
        {
            Func<WeStatus, WeAction, string, string, WePlannedElevation> P = (st, act, note, msg) =>
                new WePlannedElevation { Key = "k", RoomUid = "r", GroupLabel = "Өрөө", Label = "1A", Status = st, Action = act, ActionNote = note, Message = msg,
                                         Frame = st <= WeStatus.Warning ? new WeFrame() : null };
            Assert.Eq(WeResultChange.New, WeResultIndex.RunRow(P(WeStatus.Ready, WeAction.Create, null, null), "Үүсгэв", null).Change);
            Assert.Eq(WeResultChange.Updated, WeResultIndex.RunRow(P(WeStatus.Ready, WeAction.Update, null, null), "Шинэчлэв", null).Change);
            Assert.Eq(WeResultChange.Updated, WeResultIndex.RunRow(P(WeStatus.Warning, WeAction.Update, null, null), "Шинэчилсэн — гараар шалгана уу", null).Change);
            WeResultRunInfo failed = WeResultIndex.RunRow(P(WeStatus.Ready, WeAction.Create, null, null), "Устгав (шалгалт унав)", "Хана хүрээнд багтсангүй");
            Assert.True(failed.Failed && failed.Message.Contains("багтсангүй"), failed.Message);
            WeResultRunInfo skipped = WeResultIndex.RunRow(P(WeStatus.Unsupported, WeAction.Skip, null, "Муруй хана — дэмжигдэхгүй"), "Алгасав", null);
            Assert.True(skipped.Failed && skipped.Message.StartsWith("Үүсгээгүй"), skipped.Message);
            Assert.Null(WeResultIndex.RunRow(P(WeStatus.Ready, WeAction.Skip, "Та хассан", null), "Алгасав", null), "хэрэглэгч өөрөө хассан — үр дүн биш");
            WeResultRunInfo kept = WeResultIndex.RunRow(P(WeStatus.Ready, WeAction.Keep, null, null), "Хэвээр", null);
            Assert.True(!kept.Failed && kept.Change == WeResultChange.None);
        }
    }
}
