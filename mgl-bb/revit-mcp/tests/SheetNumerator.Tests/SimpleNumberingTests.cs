using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.SheetNumerator.Core;

namespace RevitMcpAddin.SheetNumerator.Tests
{
    /// <summary>Энгийн дугаарлалт + «Сонгосон хуудаснаас эхлэх» + параметрийн угтвар/дагавар.</summary>
    public static class SimpleNumberingTests
    {
        [Test]
        public static void Sequential_NoPadding()
        {
            RenumberPlan p = Fx.Plan(Fx.Sheets("X1", "X2", "X3"), Fx.SimpleSettings());
            Assert.SeqEq(new[] { "1", "2", "3" }, Fx.Numbers(p));
            Assert.False(p.HasBlockingErrors);
            Assert.True(p.HasChanges);
        }

        [Test]
        public static void Sequential_WidthTwo_AndThree()
        {
            Assert.SeqEq(new[] { "01", "02", "03" }, Fx.Numbers(Fx.Plan(Fx.Sheets("a", "b", "c"), Fx.SimpleSettings(width: 2))));
            Assert.SeqEq(new[] { "009", "010", "011" }, Fx.Numbers(Fx.Plan(Fx.Sheets("a", "b", "c"), Fx.SimpleSettings(start: 9, width: 3))));
        }

        [Test]
        public static void Sequential_NeverTruncatesSignificantDigits()
        {
            RenumberPlan p = Fx.Plan(Fx.Sheets("a", "b", "c"), Fx.SimpleSettings(start: 998, width: 2));
            Assert.SeqEq(new[] { "998", "999", "1000" }, Fx.Numbers(p));
        }

        [Test]
        public static void Sequential_NegativeStart_CrossesZero()
        {
            RenumberPlan p = Fx.Plan(Fx.Sheets("a", "b", "c"), Fx.SimpleSettings(start: -1, width: 3));
            Assert.SeqEq(new[] { "-001", "000", "001" }, Fx.Numbers(p));
        }

        [Test]
        public static void PrefixAndSuffix()
        {
            RenumberPlan p = Fx.Plan(Fx.Sheets("a", "b"), Fx.SimpleSettings(prefix: "A-", suffix: "-X", width: 2));
            Assert.SeqEq(new[] { "A-01-X", "A-02-X" }, Fx.Numbers(p));
        }

        [Test]
        public static void ExistingNumberMode_AddsPrefixSuffixOnly()
        {
            RenumberPlan p = Fx.Plan(Fx.Sheets("101", "102"), Fx.SimpleSettings(prefix: "P-", suffix: "-S", useStart: false));
            Assert.SeqEq(new[] { "P-101-S", "P-102-S" }, Fx.Numbers(p));
        }

        [Test]
        public static void Preview_IsIdempotent_NoStacking()
        {
            // Preview-г олон дахин тооцоход угтвар давхарлагдахгүй (бүгд snapshot-ын анхны утгаас).
            List<SheetSnapshot> sheets = Fx.Sheets("101", "102");
            RenumberSettings s = Fx.SimpleSettings(prefix: "P-", useStart: false);
            Fx.Plan(sheets, s);
            Fx.Plan(sheets, s);
            RenumberPlan p = Fx.Plan(sheets, s);
            Assert.SeqEq(new[] { "P-101", "P-102" }, Fx.Numbers(p));
        }

        [Test]
        public static void ProhibitedCharacterInPrefix_BlocksWithSettingsError()
        {
            RenumberPlan p = Fx.Plan(Fx.Sheets("a"), Fx.SimpleSettings(prefix: "A:"));
            Assert.True(p.HasBlockingErrors);
            Assert.False(p.HasChanges, "буруу тохиргоо дугаар үүсгэхгүй");
            Assert.True(p.GlobalIssues.Any(i => i.Field == "simple.prefix"));
        }

        [Test]
        public static void StartOutOfRange_IsSettingsError()
        {
            RenumberPlan p = Fx.Plan(Fx.Sheets("a"), Fx.SimpleSettings(start: NumberFormatting.MaxAbsValue + 1));
            Assert.True(p.HasBlockingErrors);
            Assert.True(p.GlobalIssues.Any(i => i.Field == "simple.start"));
        }

        [Test]
        public static void OverflowDuringSequence_FlagsOnlyOverflowingRows()
        {
            RenumberPlan p = Fx.Plan(Fx.Sheets("a", "b", "c"), Fx.SimpleSettings(start: NumberFormatting.MaxAbsValue - 1));
            Assert.Eq(NumberFormatting.MaxAbsValue - 1 + "", p.Rows[0].NewNumber);
            Assert.Eq(NumberFormatting.MaxAbsValue + "", p.Rows[1].NewNumber);
            Assert.True(p.Rows[2].Issues.Any(i => i.Code == IssueCode.NumericOverflow));
            Assert.True(p.HasBlockingErrors);
        }

        [Test]
        public static void UnchangedRow_IsNotChanged()
        {
            RenumberPlan p = Fx.Plan(Fx.Sheets("1", "2", "9"), Fx.SimpleSettings());
            Assert.False(p.Rows[0].NumberChanged);
            Assert.False(p.Rows[1].NumberChanged);
            Assert.True(p.Rows[2].NumberChanged);
            Assert.Eq(1, p.ChangedCount);
        }

        // ── Сонгосон хуудаснаас эхлэх ───────────────────────────────
        [Test]
        public static void StartFromSelected_First_Middle_Last()
        {
            RenumberSettings s = Fx.SimpleSettings(prefix: "N", width: 1);
            s.StartFromSelected = true;

            RenumberPlan first = Fx.Plan(Fx.Sheets("a", "b", "c", "d"), s, selected: 0);
            Assert.SeqEq(new[] { "N1", "N2", "N3", "N4" }, Fx.Numbers(first));

            RenumberPlan middle = Fx.Plan(Fx.Sheets("a", "b", "c", "d"), s, selected: 2);
            Assert.SeqEq(new[] { "a", "b", "N1", "N2" }, Fx.Numbers(middle));
            Assert.False(middle.Rows[0].Affected);
            Assert.True(middle.Rows[2].Affected);

            RenumberPlan last = Fx.Plan(Fx.Sheets("a", "b", "c", "d"), s, selected: 3);
            Assert.SeqEq(new[] { "a", "b", "c", "N1" }, Fx.Numbers(last));
        }

        [Test]
        public static void StartFromSelected_Off_IgnoresSelection()
        {
            RenumberSettings s = Fx.SimpleSettings(prefix: "N");
            RenumberPlan p = Fx.Plan(Fx.Sheets("a", "b", "c"), s, selected: 2);
            Assert.SeqEq(new[] { "N1", "N2", "N3" }, Fx.Numbers(p));
        }

        [Test]
        public static void StartFromSelected_UnaffectedEarlierSheetsStillCollide()
        {
            // Эзний жишээ: 01 02 03 04, 3-р мөрөөс эхлээд 01, 02 үүсгэвэл өөрчлөгдөөгүй 01, 02-той ДАВХАРДАНА.
            RenumberSettings s = Fx.SimpleSettings(start: 1, width: 2);
            s.StartFromSelected = true;
            RenumberPlan p = Fx.Plan(Fx.Sheets("01", "02", "03", "04"), s, selected: 2);

            Assert.False(p.Rows[0].IsChanged);
            Assert.False(p.Rows[1].IsChanged);
            Assert.True(p.Rows[2].Issues.Any(i => i.Code == IssueCode.DuplicateNumber), "3-р мөр давхцсан");
            Assert.True(p.Rows[3].Issues.Any(i => i.Code == IssueCode.DuplicateNumber), "4-р мөр давхцсан");
            Assert.True(p.HasBlockingErrors);
        }

        [Test]
        public static void StartFromSelected_NoCollision_WhenStartContinuesSequence()
        {
            RenumberSettings s = Fx.SimpleSettings(start: 3, width: 2);
            s.StartFromSelected = true;
            RenumberPlan p = Fx.Plan(Fx.Sheets("01", "02", "09", "10"), s, selected: 2);
            Assert.SeqEq(new[] { "01", "02", "03", "04" }, Fx.Numbers(p));
            Assert.False(p.HasBlockingErrors);
        }

        // ── Параметрээс угтвар / дагавар ────────────────────────────
        [Test]
        public static void ParameterPrefixSuffix_FromSheetParameter()
        {
            ParameterKey disc = ParameterKey.BuiltIn(-1007404);
            ParameterKey rev = ParameterKey.Project("Revision");
            SheetSnapshot a = Fx.WithParams(Fx.Sheet(1, "x1"), Fx.P(disc, "AR"), Fx.P(rev, "R1"));
            SheetSnapshot b = Fx.WithParams(Fx.Sheet(2, "x2"), Fx.P(disc, "ST"), Fx.P(rev, "R2"));
            var sheets = new List<SheetSnapshot> { a, b };
            DocumentSnapshot doc = Fx.Doc(sheets, UniquenessMode.PerSheetCollection,
                Fx.Param(disc, "Drawn By", ParamValueKind.Text), Fx.Param(rev, "Revision", ParamValueKind.Text));

            RenumberSettings s = Fx.SimpleSettings(width: 2);
            s.UseParameterPrefix = true;
            s.PrefixParameter = disc;
            s.UseParameterSuffix = true;
            s.SuffixParameter = rev;
            RenumberPlan p = Fx.Plan(sheets, s, doc: doc);
            Assert.SeqEq(new[] { "AR01R1", "ST02R2" }, Fx.Numbers(p));
        }

        [Test]
        public static void ParameterPrefix_MissingOnSomeSheets_ErrorsExactlyThoseSheets()
        {
            ParameterKey disc = ParameterKey.BuiltIn(-1007404);
            SheetSnapshot a = Fx.WithParams(Fx.Sheet(1, "x1"), Fx.P(disc, "AR"));
            SheetSnapshot b = Fx.Sheet(2, "x2");   // параметр БАЙХГҮЙ
            var sheets = new List<SheetSnapshot> { a, b };
            DocumentSnapshot doc = Fx.Doc(sheets, UniquenessMode.PerSheetCollection, Fx.Param(disc, "Drawn By", ParamValueKind.Text));

            RenumberSettings s = Fx.SimpleSettings();
            s.UseParameterPrefix = true;
            s.PrefixParameter = disc;
            RenumberPlan p = Fx.Plan(sheets, s, doc: doc);

            Assert.False(p.Rows[0].HasBlockingError);
            Assert.True(p.Rows[1].Issues.Any(i => i.Code == IssueCode.MissingParameter && i.SheetId == 2));
            Assert.Eq("x2", p.Rows[1].NewNumber, "алдаатай мөрийн дугаар гэнэтийн утгаар өөрчлөгдөхгүй");
            Assert.True(p.HasBlockingErrors);
        }

        [Test]
        public static void ParameterPrefix_EmptyValue_IsWarningNotError()
        {
            ParameterKey disc = ParameterKey.BuiltIn(-1007404);
            SheetSnapshot a = Fx.WithParams(Fx.Sheet(1, "x1"), Fx.P(disc, "", hasValue: false));
            var sheets = new List<SheetSnapshot> { a };
            DocumentSnapshot doc = Fx.Doc(sheets, UniquenessMode.PerSheetCollection, Fx.Param(disc, "Drawn By", ParamValueKind.Text));
            RenumberSettings s = Fx.SimpleSettings();
            s.UseParameterPrefix = true;
            s.PrefixParameter = disc;
            RenumberPlan p = Fx.Plan(sheets, s, doc: doc);
            Assert.False(p.HasBlockingErrors);
            Assert.Eq("1", p.Rows[0].NewNumber);
            Assert.True(p.Rows[0].Issues.Any(i => i.Code == IssueCode.EmptyParameterValue && i.Severity == IssueSeverity.Warning));
        }

        [Test]
        public static void SelectedParameterNotInCatalog_IsSettingsError()
        {
            RenumberSettings s = Fx.SimpleSettings();
            s.UseParameterPrefix = true;
            s.PrefixParameter = ParameterKey.Project("Gone");
            RenumberPlan p = Fx.Plan(Fx.Sheets("a"), s);
            Assert.True(p.HasBlockingErrors);
            Assert.True(p.GlobalIssues.Any(i => i.Field == "affix.prefix"));
        }

        // ── Тайрах, хоосон, хориглосон ──────────────────────────────
        [Test]
        public static void EdgeWhitespace_IsTrimmedLikeRevit_WithWarning()
        {
            RenumberPlan p = Fx.Plan(Fx.Sheets("a"), Fx.SimpleSettings(prefix: "A ", useStart: true));
            Assert.Eq("A 1", p.Rows[0].NewNumber);   // дунд зай хэвээр

            RenumberPlan t = Fx.Plan(Fx.Sheets("a"), Fx.SimpleSettings(suffix: " ", useStart: true));
            Assert.Eq("1", t.Rows[0].NewNumber);
            Assert.True(t.Rows[0].Issues.Any(i => i.Code == IssueCode.NumberTrimmed));
        }

        [Test]
        public static void BlankResult_IsError()
        {
            var s = Fx.SimpleSettings(prefix: " ", suffix: " ", useStart: false);
            RenumberPlan p = Fx.Plan(Fx.Sheets("   "), s);
            Assert.True(p.Rows[0].Issues.Any(i => i.Code == IssueCode.EmptyNumber));
        }

        // ── Хуудасны нэрэнд дугаар ──────────────────────────────────
        [Test]
        public static void NameNumbering_PrefixAndSuffix_FromFullNumber()
        {
            RenumberSettings s = Fx.SimpleSettings(prefix: "A-", width: 2);
            s.NameAtStart = true;
            s.NameAtEnd = true;
            s.NameSeparator = " · ";
            List<SheetSnapshot> sheets = Fx.Sheets("x", "y");
            sheets[0].Name = "План";
            sheets[1].Name = "Зүсэлт";
            RenumberPlan p = Fx.Plan(sheets, s);
            Assert.Eq("A-01 · План · A-01", p.Rows[0].NewName);
            Assert.Eq("A-02 · Зүсэлт · A-02", p.Rows[1].NewName);
        }

        [Test]
        public static void NameNumbering_BasedOnOriginalName_NotStacked()
        {
            RenumberSettings s = Fx.SimpleSettings(width: 2);
            s.NameAtStart = true;
            List<SheetSnapshot> sheets = Fx.Sheets("x");
            sheets[0].Name = "План";
            Fx.Plan(sheets, s);
            RenumberPlan p = Fx.Plan(sheets, s);
            Assert.Eq("01 План", p.Rows[0].NewName);
        }

        [Test]
        public static void NameNumbering_ProhibitedSeparator_IsSettingsError()
        {
            RenumberSettings s = Fx.SimpleSettings();
            s.NameAtStart = true;
            s.NameSeparator = ":";
            RenumberPlan p = Fx.Plan(Fx.Sheets("x"), s);
            Assert.True(p.GlobalIssues.Any(i => i.Field == "name.separator"));
        }

        // ── Параметр бичих, бүлгийн тоо ─────────────────────────────
        [Test]
        public static void WriteResult_ToTextParameter_FullAndPart()
        {
            ParameterKey target = ParameterKey.Project("Mark");
            List<SheetSnapshot> sheets = Fx.Sheets("a", "b");
            foreach (SheetSnapshot sh in sheets)
                Fx.WithParams(sh, Fx.P(target, ""));
            DocumentSnapshot doc = Fx.Doc(sheets, UniquenessMode.PerSheetCollection, Fx.Param(target, "Mark", ParamValueKind.Text));

            RenumberSettings s = Fx.SimpleSettings(prefix: "P", width: 2);
            s.WriteResultToParameter = true;
            s.ResultParameter = target;
            s.ResultSource = GeneratedValueSource.Part1Number;
            RenumberPlan p = Fx.Plan(sheets, s, doc: doc);
            Assert.Eq("01", p.Rows[0].Writes.Single().Text);
            Assert.Eq("02", p.Rows[1].Writes.Single().Text);

            s.ResultSource = GeneratedValueSource.FullNumber;
            p = Fx.Plan(sheets, s, doc: doc);
            Assert.Eq("P01", p.Rows[0].Writes.Single().Text);
        }

        [Test]
        public static void WriteResult_ToIntegerParameter_RequiresInteger()
        {
            ParameterKey target = ParameterKey.Project("Seq");
            List<SheetSnapshot> sheets = Fx.Sheets("a");
            Fx.WithParams(sheets[0], Fx.P(target, "0"));
            DocumentSnapshot doc = Fx.Doc(sheets, UniquenessMode.PerSheetCollection, Fx.Param(target, "Seq", ParamValueKind.Integer));

            RenumberSettings s = Fx.SimpleSettings(prefix: "P", width: 3);
            s.WriteResultToParameter = true;
            s.ResultParameter = target;
            s.ResultSource = GeneratedValueSource.Part1Full;     // «P001» — бүхэл тоо БИШ
            RenumberPlan p = Fx.Plan(sheets, s, doc: doc);
            Assert.True(p.Rows[0].Issues.Any(i => i.Code == IssueCode.InvalidNumericConversion));
            Assert.True(p.HasBlockingErrors);

            s.ResultSource = GeneratedValueSource.Part1Number;   // «001» → 1
            p = Fx.Plan(sheets, s, doc: doc);
            Assert.False(p.HasBlockingErrors);
            Assert.Eq(1L, p.Rows[0].Writes.Single().IntValue);
        }

        [Test]
        public static void WriteResult_ToReadOnlyOrDimensionalTarget_IsBlocked()
        {
            ParameterKey ro = ParameterKey.BuiltIn(-1007412);
            ParameterKey dim = ParameterKey.BuiltIn(-1007411);
            List<SheetSnapshot> sheets = Fx.Sheets("a");
            DocumentSnapshot doc = Fx.Doc(sheets, UniquenessMode.PerSheetCollection,
                Fx.Param(ro, "Current Revision", ParamValueKind.Text, readOnly: true),
                Fx.Param(dim, "Sheet Height", ParamValueKind.Dimensional));

            RenumberSettings s = Fx.SimpleSettings();
            s.WriteResultToParameter = true;
            s.ResultParameter = ro;
            Assert.True(Fx.Plan(sheets, s, doc: doc).GlobalIssues.Any(i => i.Field == "write.parameter"), "read-only");

            s.ResultParameter = dim;
            Assert.True(Fx.Plan(sheets, s, doc: doc).GlobalIssues.Any(i => i.Field == "write.parameter"), "хэмжигдэхүйц (урт)");
        }

        [Test]
        public static void GroupCount_FirstSheetOnly_And_AllSheets()
        {
            ParameterKey target = ParameterKey.Project("Total");
            List<SheetSnapshot> sheets = Fx.Sheets("a", "b", "c");
            foreach (SheetSnapshot sh in sheets)
                Fx.WithParams(sh, Fx.P(target, ""));
            DocumentSnapshot doc = Fx.Doc(sheets, UniquenessMode.PerSheetCollection, Fx.Param(target, "Total", ParamValueKind.Text));

            RenumberSettings s = Fx.SimpleSettings();
            s.WriteGroupCount = true;
            s.CountParameter = target;
            s.CountScope = CountWriteScope.FirstSheet;
            RenumberPlan p = Fx.Plan(sheets, s, doc: doc);
            Assert.Eq(1, p.Rows.Count(r => r.Writes.Count > 0));
            Assert.Eq("3", p.Rows[0].Writes.Single().Text);

            s.CountScope = CountWriteScope.AllSheets;
            p = Fx.Plan(sheets, s, doc: doc);
            Assert.Eq(3, p.Rows.Count(r => r.Writes.Count > 0));
        }

        [Test]
        public static void GroupCount_WithStartFromSelected_WritesToFirstAffectedSheet()
        {
            ParameterKey target = ParameterKey.Project("Total");
            List<SheetSnapshot> sheets = Fx.Sheets("a", "b", "c");
            foreach (SheetSnapshot sh in sheets)
                Fx.WithParams(sh, Fx.P(target, ""));
            DocumentSnapshot doc = Fx.Doc(sheets, UniquenessMode.PerSheetCollection, Fx.Param(target, "Total", ParamValueKind.Text));
            RenumberSettings s = Fx.SimpleSettings(prefix: "N");
            s.WriteGroupCount = true;
            s.CountParameter = target;
            s.StartFromSelected = true;
            RenumberPlan p = Fx.Plan(sheets, s, selected: 1, doc: doc);
            Assert.Eq(0, p.Rows[0].Writes.Count, "эхлэлээс өмнөх хуудас хөндөгдөхгүй");
            Assert.Eq("3", p.Rows[1].Writes.Single().Text, "тоо нь бүлгийн БҮТЭН хуудасны тоо");
        }

        [Test]
        public static void WriteResult_AlreadyEqualValue_IsNotAChange()
        {
            // Дугаарууд аль хэдийн «P01», «P02» — зөвхөн параметрийн утга шийднэ.
            ParameterKey target = ParameterKey.Project("Mark");
            List<SheetSnapshot> sheets = Fx.Sheets("P01", "P02", "P03");
            Fx.WithParams(sheets[0], Fx.P(target, "P01"));                  // ижил → бичихгүй
            Fx.WithParams(sheets[1], Fx.P(target, "хуучин"));               // өөр → бичнэ
            Fx.WithParams(sheets[2], Fx.P(target, "", hasValue: false));    // утгагүй → бичнэ
            DocumentSnapshot doc = Fx.Doc(sheets, UniquenessMode.PerSheetCollection, Fx.Param(target, "Mark", ParamValueKind.Text));

            RenumberSettings s = Fx.SimpleSettings(prefix: "P", width: 2);
            s.WriteResultToParameter = true;
            s.ResultParameter = target;
            RenumberPlan p = Fx.Plan(sheets, s, doc: doc);

            Assert.False(p.Rows[0].IsChanged, "ижил утгатай мөр өөрчлөлт БИШ");
            Assert.Eq(0, p.Rows[0].Writes.Count);
            Assert.Eq("P02", p.Rows[1].Writes.Single().Text);
            Assert.Eq("P03", p.Rows[2].Writes.Single().Text);
            Assert.Eq(2, p.ChangedCount, "зөвхөн бодит өөрчлөлтийг тоолно");
            Assert.Eq(2, ApplyRequestBuilder.Build(p, doc).Items.Count, "Apply-д ижил утгатай мөр орохгүй");
        }

        [Test]
        public static void WriteResult_IntegerAndNumber_EqualityRules()
        {
            ParameterKey seq = ParameterKey.Project("Seq");
            ParameterKey num = ParameterKey.Project("Ratio");
            List<SheetSnapshot> sheets = Fx.Sheets("1", "2");
            Fx.WithParams(sheets[0], Fx.P(seq, "1"), Fx.P(num, "1"));
            Fx.WithParams(sheets[1], Fx.P(seq, "9"), Fx.P(num, "2"));
            DocumentSnapshot doc = Fx.Doc(sheets, UniquenessMode.PerSheetCollection,
                Fx.Param(seq, "Seq", ParamValueKind.Integer), Fx.Param(num, "Ratio", ParamValueKind.Number));

            RenumberSettings s = Fx.SimpleSettings();
            s.WriteResultToParameter = true;
            s.ResultParameter = seq;
            RenumberPlan p = Fx.Plan(sheets, s, doc: doc);
            Assert.Eq(0, p.Rows[0].Writes.Count, "бүхэл тоо ижил → бичихгүй");
            Assert.Eq(2L, p.Rows[1].Writes.Single().IntValue, "бүхэл тоо өөр → бичнэ");

            // Нэгжгүй тоо: Revit-ийн харуулах текст дугуйруулагддаг тул «ижил» гэж таамаглахгүй — үргэлж бичнэ.
            s.ResultParameter = num;
            p = Fx.Plan(sheets, s, doc: doc);
            Assert.Eq(1, p.Rows[0].Writes.Count, "нэгжгүй тоо үргэлж бичигдэнэ (ижил харагдсан ч)");
            Assert.Eq(1, p.Rows[1].Writes.Count);
        }

        [Test]
        public static void IsUnchanged_Rules()
        {
            Assert.True(ParameterRules.IsUnchanged(new ParameterWrite { Kind = ParamWriteKind.Text, Text = "A" }, "A", true));
            Assert.False(ParameterRules.IsUnchanged(new ParameterWrite { Kind = ParamWriteKind.Text, Text = "A" }, "a", true), "том/жижиг үсгийг ялгана");
            Assert.True(ParameterRules.IsUnchanged(new ParameterWrite { Kind = ParamWriteKind.Text, Text = "" }, "", false), "утгагүй + хоосон бичвэр = ижил");
            Assert.False(ParameterRules.IsUnchanged(new ParameterWrite { Kind = ParamWriteKind.Text, Text = "A" }, "", false));
            Assert.True(ParameterRules.IsUnchanged(new ParameterWrite { Kind = ParamWriteKind.Integer, IntValue = 7 }, " 7 ", true));
            Assert.False(ParameterRules.IsUnchanged(new ParameterWrite { Kind = ParamWriteKind.Integer, IntValue = 7 }, "7", false), "утгагүй бүхэл тоо");
            Assert.False(ParameterRules.IsUnchanged(new ParameterWrite { Kind = ParamWriteKind.Integer, IntValue = 7 }, "7.0", true), "бүхэл тоо биш бичвэр");
            Assert.False(ParameterRules.IsUnchanged(new ParameterWrite { Kind = ParamWriteKind.Number, NumberValue = 2 }, "2", true), "нэгжгүй тоо танигдахгүй");
            Assert.False(ParameterRules.IsUnchanged(null, "x", true));
        }

        [Test]
        public static void SameTargetForResultAndCount_IsError()
        {
            ParameterKey target = ParameterKey.Project("Mark");
            List<SheetSnapshot> sheets = Fx.Sheets("a");
            DocumentSnapshot doc = Fx.Doc(sheets, UniquenessMode.PerSheetCollection, Fx.Param(target, "Mark", ParamValueKind.Text));
            RenumberSettings s = Fx.SimpleSettings();
            s.WriteResultToParameter = true;
            s.ResultParameter = target;
            s.WriteGroupCount = true;
            s.CountParameter = target;
            Assert.True(Fx.Plan(sheets, s, doc: doc).GlobalIssues.Any(i => i.Code == IssueCode.SettingsInvalid && i.Field == "count.parameter"));
        }

        [Test]
        public static void PartSource_NotAllowedInSimpleForPart2()
        {
            ParameterKey target = ParameterKey.Project("Mark");
            List<SheetSnapshot> sheets = Fx.Sheets("a");
            DocumentSnapshot doc = Fx.Doc(sheets, UniquenessMode.PerSheetCollection, Fx.Param(target, "Mark", ParamValueKind.Text));
            RenumberSettings s = Fx.SimpleSettings();
            s.WriteResultToParameter = true;
            s.ResultParameter = target;
            s.ResultSource = GeneratedValueSource.Part2Number;
            Assert.True(Fx.Plan(sheets, s, doc: doc).GlobalIssues.Any(i => i.Field == "write.source"));
        }

        [Test]
        public static void PlaceholderRow_GetsWarning_OnlyWhenChanged()
        {
            List<SheetSnapshot> sheets = Fx.Sheets("a", "b");
            sheets[1] = Fx.Sheet(2, "b", placeholder: true);
            RenumberPlan p = Fx.Plan(sheets, Fx.SimpleSettings());
            Assert.True(p.Rows[1].Issues.Any(i => i.Code == IssueCode.PlaceholderSheet));
            Assert.False(p.HasBlockingErrors, "placeholder нь хаахгүй");

            RenumberPlan unchanged = Fx.Plan(Fx.Sheets("1", "2"), Fx.SimpleSettings());
            Assert.False(unchanged.AllIssues.Any(i => i.Code == IssueCode.PlaceholderSheet));
        }
    }
}
