using System.Collections.Generic;
using System.Text.Json;
using RevitMcpAddin.WorkPane.Core;

namespace RevitMcpAddin.WorkPane.Tests
{
    /// <summary>
    /// «MGL ажил» самбарын цэвэр дүрэм.  Гол инвариант: таскийг ТААМАГЛАЖ
    /// хэзээ ч сонгохгүй; хувь нь серверийн `revitProgress.ts`-тэй ижил дүрмээр.
    /// </summary>
    public static class WorkPaneRulesTests
    {
        private static readonly int[] One = { 100 };
        private static readonly int[] Two = { 100, 101 };

        /* ---------------- Таскийн сонголт ---------------- */

        [Test]
        public static void NoOpenTasks_NoTasks_AndClearsStaleCurrent()
        {
            TaskDecision c = WorkPaneRules.DecideTask(new int[0], 55, true, null, "single");
            Assert.Eq(TaskDecisionKind.NoTasks, c.Kind);
            Assert.True(c.ClearStale, "дууссан таск дээр тоолол үргэлжлэх ёсгүй");
        }

        [Test]
        public static void CurrentOpenTask_Kept()
        {
            TaskDecision c = WorkPaneRules.DecideTask(Two, 101, true, 100, "my_tasks");
            Assert.Eq(TaskDecisionKind.KeepCurrent, c.Kind);
            Assert.Eq(101, c.TaskId.Value);
            Assert.False(c.ClearStale);
        }

        [Test]
        public static void RememberedPick_RestoredEvenWhenManyTasks()
        {
            TaskDecision c = WorkPaneRules.DecideTask(Two, null, false, 101, "my_tasks");
            Assert.Eq(TaskDecisionKind.Restore, c.Kind);
            Assert.Eq(101, c.TaskId.Value);
        }

        [Test]
        public static void SingleTask_OnConfirmedProject_AutoSelected()
        {
            foreach (string src in new[] { "single", "hint" })
            {
                TaskDecision c = WorkPaneRules.DecideTask(One, null, false, null, src);
                Assert.Eq(TaskDecisionKind.AutoSingle, c.Kind, src);
                Assert.Eq(100, c.TaskId.Value);
            }
        }

        [Test]
        public static void SingleTask_OnInferredProject_NotAutoSelected()
        {
            // `my_tasks` = олон бүртгэлээс дүгнэсэн → таамаглал.
            TaskDecision c = WorkPaneRules.DecideTask(One, null, false, null, "my_tasks");
            Assert.Eq(TaskDecisionKind.NeedsChoice, c.Kind);
            Assert.Null(c.TaskId);
        }

        [Test]
        public static void ManyTasks_NoMemory_NeverPicksFirst()
        {
            TaskDecision c = WorkPaneRules.DecideTask(Two, null, false, null, "single");
            Assert.Eq(TaskDecisionKind.NeedsChoice, c.Kind);
            Assert.Null(c.TaskId, "эхний таскийг хэзээ ч сонгохгүй");
        }

        [Test]
        public static void StaleCurrent_WithRememberedOpen_RestoresAndClears()
        {
            // Хост 55 (дууссан) дээр, санамжид 100 нээлттэй.
            TaskDecision c = WorkPaneRules.DecideTask(Two, 55, true, 100, "single");
            Assert.Eq(TaskDecisionKind.Restore, c.Kind);
            Assert.True(c.ClearStale);
        }

        [Test]
        public static void CurrentFromOtherProject_IsNotStale()
        {
            // Хост ӨӨР төслийн таск дээр (өөр баримт) — энэ төслийн шийдвэр түүнийг хөндөхгүй.
            TaskDecision c = WorkPaneRules.DecideTask(Two, 999, false, null, "single");
            Assert.Eq(TaskDecisionKind.NeedsChoice, c.Kind);
            Assert.False(c.ClearStale);
        }

        /* ---------------- Хувь ---------------- */

        [Test]
        public static void Percent_CommaIsDecimal_NotThousands()
        {
            double p;
            Assert.Eq(PercentCheckCode.Ok, WorkPaneRules.CheckPercent("45,5", 10, false, out p));
            Assert.Eq(45.5, p);
            Assert.Eq(PercentCheckCode.Ok, WorkPaneRules.CheckPercent(" 60 % ", 10, false, out p));
            Assert.Eq(60.0, p);
        }

        [Test]
        public static void Percent_ServerTwinRules()
        {
            double p;
            Assert.Eq(PercentCheckCode.Empty, WorkPaneRules.CheckPercent("  ", 0, false, out p));
            Assert.Eq(PercentCheckCode.NotANumber, WorkPaneRules.CheckPercent("abc", 0, false, out p));
            Assert.Eq(PercentCheckCode.BelowCurrent, WorkPaneRules.CheckPercent("30", 40, false, out p));
            Assert.Eq(PercentCheckCode.Ok, WorkPaneRules.CheckPercent("40", 40, false, out p), "ижил хувиар өдрийн тэмдэглэл");
            Assert.Eq(PercentCheckCode.Ok, WorkPaneRules.CheckPercent("99", 40, false, out p));
            Assert.Eq(PercentCheckCode.AboveCeiling, WorkPaneRules.CheckPercent("99.5", 40, false, out p));
            Assert.Eq(PercentCheckCode.AboveCeiling, WorkPaneRules.CheckPercent("100", 40, false, out p),
                "100 нь зөвхөн «хаах» замаар");
        }

        [Test]
        public static void Percent_CompletingIsAlways100()
        {
            double p;
            Assert.Eq(PercentCheckCode.Ok, WorkPaneRules.CheckPercent("12", 40, true, out p));
            Assert.Eq(100.0, p);
            Assert.Eq(PercentCheckCode.AboveCeiling, WorkPaneRules.CheckPercent(null, 100, true, out p),
                "аль хэдийн дууссан таскийг дахин хаахгүй");
        }

        /* ---------------- Дуусгалтын асуулт ---------------- */

        private static List<CompletionQuestionDto> Qs() => new List<CompletionQuestionDto>
        {
            new CompletionQuestionDto { Id = "done", Text = "Та юу хийж дуусгасан бэ?" },
            new CompletionQuestionDto { Id = "issues", Text = "Тулгарсан асуудал?" },
            new CompletionQuestionDto { Id = "next", Text = "Дараагийн алхам?" },
        };

        [Test]
        public static void MissingAnswers_BlankAndWhitespaceCount()
        {
            var a = new Dictionary<string, string> { { "done", "Фасад" }, { "issues", "   " } };
            List<string> m = WorkPaneRules.MissingAnswers(Qs(), a);
            Assert.Eq(2, m.Count);
            Assert.Eq("Тулгарсан асуудал?", m[0]);
        }

        [Test]
        public static void CompletionQaJson_OnlyQuestionIds_Trimmed()
        {
            var a = new Dictionary<string, string>
            {
                { "done", "  Фасад  " }, { "issues", "Байхгүй" }, { "next", "Хяналт" }, { "evil", "x" },
            };
            string json = WorkPaneRules.CompletionQaJson(Qs(), a);
            var back = JsonSerializer.Deserialize<Dictionary<string, string>>(json);
            Assert.Eq(3, back.Count, "асуултад байхгүй түлхүүр орохгүй");
            Assert.Eq("Фасад", back["done"]);
        }

        /* ---------------- Илгээгдээгүй тайлан ---------------- */

        [Test]
        public static void OutboxKind_SentHidden_FailedAlwaysRejected()
        {
            Assert.Null(WorkPaneRules.OutboxKind("sent", true, false), "илгээгдсэн тайлан дараалалд харагдахгүй");
            foreach (bool online in new[] { true, false })
                foreach (bool auth in new[] { true, false })
                    Assert.Eq(OutboxLineKind.Rejected, WorkPaneRules.OutboxKind("failed", online, auth).Value,
                        "татгалзсан нь сүлжээ/нэвтрэлтээс үл хамааран «Илгээгдсэнгүй»");
        }

        [Test]
        public static void OutboxKind_PendingFollowsConnection()
        {
            Assert.Eq(OutboxLineKind.Sending, WorkPaneRules.OutboxKind("pending", true, false).Value);
            Assert.Eq(OutboxLineKind.Offline, WorkPaneRules.OutboxKind("pending", false, false).Value);
            Assert.Eq(OutboxLineKind.NeedsLogin, WorkPaneRules.OutboxKind("pending", true, true).Value,
                "токен хүчингүй бол сүлжээтэй ч илгээгдэхгүй");
            Assert.Eq(OutboxLineKind.Offline, WorkPaneRules.OutboxKind(null, false, false).Value,
                "танигдахгүй төлөв = дараалалд (нуухгүй)");
        }

        [Test]
        public static void OutboxHeadline_NameFallback_Pct_OtherDaySuffix()
        {
            Assert.Eq("⚠ Илгээгдсэнгүй: Фасад · 45.5%",
                WorkPaneRules.OutboxHeadline(OutboxLineKind.Rejected, " Фасад ", 7, 45.5, "2026-09-29", "2026-09-29"));
            Assert.Eq("⏳ Сүлжээ сэргэхэд илгээгдэнэ: Таск #7 · 60% · 09-28",
                WorkPaneRules.OutboxHeadline(OutboxLineKind.Offline, null, 7, 60, "2026-09-28", "2026-09-29"),
                "өөр өдөр бичсэн тайланд сар-өдөр");
            Assert.Eq("⏳ Илгээж байна: Фасад · 100%",
                WorkPaneRules.OutboxHeadline(OutboxLineKind.Sending, "Фасад", 7, 100, null, "2026-09-29"),
                "огноогүй бол дагавар байхгүй");
            Assert.Eq("⏳ Дахин нэвтэрсний дараа илгээгдэнэ: Фасад · 10%",
                WorkPaneRules.OutboxHeadline(OutboxLineKind.NeedsLogin, "Фасад", 7, 10, "бусад", "2026-09-29"),
                "буруу хэлбэрийн огноо дагавар болохгүй");
        }

        /* ---------------- Хариуны DTO ---------------- */

        [Test]
        public static void WorkContextDto_ParsesServerShape()
        {
            const string body = "{\"me\":{\"id\":3,\"role\":\"engineer\",\"is_manager\":false}," +
                "\"document\":{\"revit_document_id\":5,\"project_id\":41,\"project_name\":\"EVERGREEN\",\"project_status\":\"active\",\"file_name\":\"a.rvt\"}," +
                "\"resolved_by\":\"single\",\"ambiguous\":false,\"registrations\":[{\"revit_document_id\":5,\"project_id\":41,\"project_name\":\"EVERGREEN\",\"project_status\":\"active\"}]," +
                "\"doc_code\":\"MGL-251006\",\"suggestions\":[]," +
                "\"project\":{\"id\":41,\"name\":\"EVERGREEN\",\"status\":\"active\",\"progress_mode\":\"tasks\"}," +
                "\"tasks\":[{\"task_id\":100,\"task_name\":\"Фасад\",\"drawing_name\":\"BA\",\"block_name\":\"А\",\"current_progress\":40,\"progress_mode\":\"tasks\",\"reported_today\":true,\"marked_today\":false}]," +
                "\"ceiling\":99,\"completion_questions\":[{\"id\":\"done\",\"text\":\"?\"}]}";
            WorkContextDto d = JsonSerializer.Deserialize<WorkContextDto>(body);
            Assert.Eq(41, d.Document.ProjectId);
            Assert.Eq("single", d.ResolvedBy);
            Assert.Eq(1, d.Tasks.Count);
            Assert.Eq("А · BA · Фасад  (40%, өнөөдөр ✓)", d.Tasks[0].Label);
            Assert.False(d.Tasks[0].IsHoursMode);
            Assert.Eq(1, d.CompletionQuestions.Count);
        }
    }
}
