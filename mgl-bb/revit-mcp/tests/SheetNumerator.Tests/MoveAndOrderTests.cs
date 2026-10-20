using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.SheetNumerator.Core;

namespace RevitMcpAddin.SheetNumerator.Tests
{
    /// <summary>«Зөөхөд дугаар дагуулах», OriginalOrder / WorkingOrder, зөөх үйлдлүүд.</summary>
    public static class MoveAndOrderTests
    {
        private static RenumberSettings Move()
        {
            return new RenumberSettings { MoveRenumber = true };
        }

        private static List<SheetSnapshot> Work(List<SheetSnapshot> sheets, params int[] ids)
        {
            return ids.Select(id => sheets.First(s => s.SheetId == id)).ToList();
        }

        [Test]
        public static void Move_CEntersBetweenAAndB_NumbersFollowPositions()
        {
            // Эзний жишээ: A=A-01 B=A-02 C=A-03; C-г A ба B-ийн дунд → A-01, C=A-02, B=A-03.
            List<SheetSnapshot> sheets = Fx.Sheets("A-01", "A-02", "A-03");   // ids 1,2,3
            RenumberPlan p = Fx.Plan(sheets, Move(), working: Work(sheets, 1, 3, 2));
            Assert.SeqEq(new long[] { 1, 3, 2 }, p.Rows.Select(r => r.Sheet.SheetId));
            Assert.SeqEq(new[] { "A-01", "A-02", "A-03" }, Fx.Numbers(p));
            Assert.Eq("A-02", p.Rows[1].NewNumber);          // sheet 3
            Assert.Eq(3L, p.Rows[1].Sheet.SheetId);
            Assert.True(p.Rows[1].NumberChanged);            // A-03 → A-02
            Assert.True(p.Rows[2].NumberChanged);            // A-02 → A-03
            Assert.False(p.Rows[0].NumberChanged);
            Assert.Eq(2, p.NumberChangedCount);
        }

        [Test]
        public static void Move_NoNumericParsingRequired_TextualSequence()
        {
            List<SheetSnapshot> sheets = Fx.Sheets("ЕХ-А", "ЕХ-Б", "ЕХ-В");
            RenumberPlan p = Fx.Plan(sheets, Move(), working: Work(sheets, 3, 1, 2));
            // Байрлал бүр өөрийн дугаараа хадгална: [ЕХ-А, ЕХ-Б, ЕХ-В] → sheet3=ЕХ-А, sheet1=ЕХ-Б, sheet2=ЕХ-В.
            Assert.Eq("ЕХ-А", p.Rows[0].NewNumber);
            Assert.Eq(3L, p.Rows[0].Sheet.SheetId);
            Assert.Eq("ЕХ-Б", p.Rows[1].NewNumber);
            Assert.Eq("ЕХ-В", p.Rows[2].NewNumber);
        }

        [Test]
        public static void Move_PositionsKeepNumbers_EvenWhenOriginalNotSortedByNumber()
        {
            List<SheetSnapshot> sheets = Fx.Sheets("B", "A", "C");   // эхний дараалал нэрээр (дугаараар биш)
            RenumberPlan p = Fx.Plan(sheets, Move(), working: Work(sheets, 2, 1, 3));
            Assert.Eq("B", p.Rows[0].NewNumber);   // sheet 2 (A) → байрлал 0 = «B»
            Assert.Eq("A", p.Rows[1].NewNumber);   // sheet 1 (B) → байрлал 1 = «A»
            Assert.Eq("C", p.Rows[2].NewNumber);
        }

        [Test]
        public static void Move_PreservesExistingMarkers_AndWhitespace()
        {
            List<SheetSnapshot> sheets = Fx.Sheets("A-01​", "A-01", "A-02");
            RenumberPlan p = Fx.Plan(sheets, Move(), working: Work(sheets, 2, 1, 3));
            Assert.Eq("A-01​", p.Rows[0].NewNumber);
            Assert.Eq("A-01", p.Rows[1].NewNumber);
        }

        [Test]
        public static void Move_IgnoresOtherNumberingSettings_EvenInvalidOnes()
        {
            List<SheetSnapshot> sheets = Fx.Sheets("1", "2");
            var s = Fx.SimpleSettings(prefix: "ЭНЭ:ХОРИОТОЙ", width: 99);
            s.MoveRenumber = true;
            RenumberPlan p = Fx.Plan(sheets, s, working: Work(sheets, 2, 1));
            Assert.False(p.HasBlockingErrors, "Move горимд энгийн тохиргоо хамаарахгүй");
            Assert.Eq("1", p.Rows[0].NewNumber);
        }

        [Test]
        public static void Move_UnmovedList_ChangesNothing()
        {
            List<SheetSnapshot> sheets = Fx.Sheets("A-01", "A-02");
            RenumberPlan p = Fx.Plan(sheets, Move());
            Assert.False(p.HasChanges);
        }

        [Test]
        public static void Move_ThreeCycle_NoDuplicates()
        {
            List<SheetSnapshot> sheets = Fx.Sheets("1", "2", "3");
            RenumberPlan p = Fx.Plan(sheets, Move(), working: Work(sheets, 2, 3, 1));
            Assert.SeqEq(new[] { "1", "2", "3" }, Fx.Numbers(p));
            Assert.False(p.AllIssues.Any(i => i.Code == IssueCode.DuplicateNumber));
        }

        [Test]
        public static void DirtyOrder_WithMoveOff_ShowsNonBlockingWarning()
        {
            List<SheetSnapshot> sheets = Fx.Sheets("a", "b", "c");
            RenumberPlan p = Fx.Plan(sheets, Fx.SimpleSettings(), working: Work(sheets, 2, 1, 3));
            ValidationIssue w = p.GlobalIssues.Single(i => i.Code == IssueCode.WorkingOrderDiffers);
            Assert.Eq(IssueSeverity.Warning, w.Severity);
            Assert.Eq("Жагсаалтын дараалал Project Browser-оос өөрчлөгдсөн байна.", w.Message);
            Assert.False(p.HasBlockingErrors, "анхааруулга хаахгүй");
            // Энгийн дугаарлалт WorkingOrder-оор: sheet2 → «1», sheet1 → «2».
            Assert.Eq("1", p.Rows[0].NewNumber);
            Assert.Eq(2L, p.Rows[0].Sheet.SheetId);
        }

        [Test]
        public static void DirtyOrder_WithMoveOn_NoOrderWarning()
        {
            List<SheetSnapshot> sheets = Fx.Sheets("a", "b");
            RenumberPlan p = Fx.Plan(sheets, Move(), working: Work(sheets, 2, 1));
            Assert.False(p.GlobalIssues.Any(i => i.Code == IssueCode.WorkingOrderDiffers));
        }

        // ── WorkingOrderState ───────────────────────────────────────
        private static WorkingOrderState State(params string[] numbers)
        {
            return new WorkingOrderState(Fx.GroupOf(Fx.Sheets(numbers)));
        }

        private static ISet<long> Ids(params long[] ids)
        {
            return new HashSet<long>(ids);
        }

        [Test]
        public static void WorkingOrder_MoveSingleDown_ToIndex()
        {
            WorkingOrderState st = State("a", "b", "c", "d");
            // 1-р хуудсыг «3-р байрны ӨМНӨ» (insertIndex=3) → b, c, a, d
            Assert.True(st.MoveSelectedTo(Ids(1), 3));
            Assert.SeqEq(new long[] { 2, 3, 1, 4 }, st.Working.Select(s => s.SheetId));
            Assert.True(st.IsDirty);
        }

        [Test]
        public static void WorkingOrder_MoveSingleUp()
        {
            WorkingOrderState st = State("a", "b", "c", "d");
            Assert.True(st.MoveSelectedTo(Ids(4), 1));
            Assert.SeqEq(new long[] { 1, 4, 2, 3 }, st.Working.Select(s => s.SheetId));
        }

        [Test]
        public static void WorkingOrder_DropOntoSelf_IsNoChange()
        {
            WorkingOrderState st = State("a", "b", "c");
            Assert.False(st.MoveSelectedTo(Ids(2), 1));
            Assert.False(st.MoveSelectedTo(Ids(2), 2));
            Assert.False(st.IsDirty);
        }

        [Test]
        public static void WorkingOrder_BatchMove_PreservesRelativeOrder()
        {
            WorkingOrderState st = State("a", "b", "c", "d", "e");
            // b ба d-г (дарааллаа хадгалан) төгсгөл рүү
            Assert.True(st.MoveSelectedTo(Ids(4, 2), 5));
            Assert.SeqEq(new long[] { 1, 3, 5, 2, 4 }, st.Working.Select(s => s.SheetId));
        }

        [Test]
        public static void WorkingOrder_BatchMove_ToMiddle_AdjustsForRemovedBefore()
        {
            WorkingOrderState st = State("a", "b", "c", "d", "e");
            // a, b-г «d-ийн өмнө» (insertIndex=3) → c, a, b, d, e
            Assert.True(st.MoveSelectedTo(Ids(1, 2), 3));
            Assert.SeqEq(new long[] { 3, 1, 2, 4, 5 }, st.Working.Select(s => s.SheetId));
        }

        [Test]
        public static void WorkingOrder_UpDownTopBottom()
        {
            WorkingOrderState st = State("a", "b", "c", "d");
            Assert.True(st.MoveUp(Ids(3)));
            Assert.SeqEq(new long[] { 1, 3, 2, 4 }, st.Working.Select(s => s.SheetId));
            Assert.True(st.MoveDown(Ids(1)));
            Assert.SeqEq(new long[] { 3, 1, 2, 4 }, st.Working.Select(s => s.SheetId));
            Assert.True(st.MoveToTop(Ids(4)));
            Assert.SeqEq(new long[] { 4, 3, 1, 2 }, st.Working.Select(s => s.SheetId));
            Assert.True(st.MoveToBottom(Ids(4, 3)));
            Assert.SeqEq(new long[] { 1, 2, 4, 3 }, st.Working.Select(s => s.SheetId));
        }

        [Test]
        public static void WorkingOrder_MoveUp_AtTop_IsNoOp_AndBlockStaysTogether()
        {
            WorkingOrderState st = State("a", "b", "c");
            Assert.False(st.MoveUp(Ids(1)));
            Assert.False(st.MoveUp(Ids(1, 2)), "блок аль хэдийн хамгийн дээр");
            Assert.True(st.MoveUp(Ids(2, 3)));
            Assert.SeqEq(new long[] { 2, 3, 1 }, st.Working.Select(s => s.SheetId));
        }

        [Test]
        public static void WorkingOrder_ResetRestoresOriginal()
        {
            WorkingOrderState st = State("a", "b", "c");
            st.MoveToBottom(Ids(1));
            st.Reset();
            Assert.False(st.IsDirty);
            Assert.SeqEq(new long[] { 1, 2, 3 }, st.Working.Select(s => s.SheetId));
        }

        [Test]
        public static void WorkingOrder_RebaseKeepsOrder_DropsDeleted_AppendsNew()
        {
            WorkingOrderState st = State("a", "b", "c", "d");
            st.MoveToBottom(Ids(1));   // b c d a
            // Дахин уншсан: c устсан, шинэ e(id 9) нэмэгдсэн.
            var fresh = new SheetGroup(GroupKey.All(), "g", new List<SheetSnapshot>
            {
                Fx.Sheet(1, "a"), Fx.Sheet(2, "b"), Fx.Sheet(4, "d"), Fx.Sheet(9, "e"),
            });
            WorkingOrderState re = WorkingOrderState.Rebase(st, fresh);
            Assert.SeqEq(new long[] { 2, 4, 1, 9 }, re.Working.Select(s => s.SheetId));
            Assert.True(re.IsDirty);
        }

        [Test]
        public static void WorkingOrder_Rebase_WhenNotDirty_IsFreshOrder()
        {
            WorkingOrderState st = State("a", "b");
            var fresh = new SheetGroup(GroupKey.All(), "g", new List<SheetSnapshot> { Fx.Sheet(2, "b"), Fx.Sheet(1, "a") });
            WorkingOrderState re = WorkingOrderState.Rebase(st, fresh);
            Assert.SeqEq(new long[] { 2, 1 }, re.Working.Select(s => s.SheetId));
            Assert.False(re.IsDirty);
        }
    }
}
