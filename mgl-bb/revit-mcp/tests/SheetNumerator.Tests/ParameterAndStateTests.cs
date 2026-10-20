using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.SheetNumerator.Core;

namespace RevitMcpAddin.SheetNumerator.Tests
{
    /// <summary>Параметрийн түлхүүр/хөрвүүлэлт, хуучирсан байдал, apply хүсэлт, тохиргооны хадгалалт/шилжилт.</summary>
    public static class ParameterAndStateTests
    {
        // ── Параметрийн түлхүүр ─────────────────────────────────────
        [Test]
        public static void ParameterKey_RoundTrips_AndDistinguishesSameNameBuiltIns()
        {
            ParameterKey a = ParameterKey.BuiltIn(-1007401);   // Sheet Number
            ParameterKey b = ParameterKey.BuiltIn(-1006601);   // VIEWER_SHEET_NUMBER — нэр нь ижил «Sheet Number»
            Assert.False(a.Equals(b));
            ParameterKey r;
            Assert.True(ParameterKey.TryParse(a.Stable, out r));
            Assert.True(a.Equals(r));

            Guid g = Guid.NewGuid();
            Assert.True(ParameterKey.TryParse(ParameterKey.Shared(g).Stable, out r));
            Assert.Eq(g, r.SharedGuid);
            Assert.True(ParameterKey.TryParse("prj:Миний параметр", out r));
            Assert.Eq("Миний параметр", r.Name);
        }

        [Test]
        public static void ParameterKey_RejectsGarbage()
        {
            ParameterKey r;
            Assert.False(ParameterKey.TryParse("", out r));
            Assert.False(ParameterKey.TryParse("bip:abc", out r));
            Assert.False(ParameterKey.TryParse("guid:nope", out r));
            Assert.False(ParameterKey.TryParse("prj:", out r));
            Assert.False(ParameterKey.TryParse("xyz:1", out r));
        }

        // ── Хөрвүүлэлт ──────────────────────────────────────────────
        private static SheetParameterInfo Info(ParamValueKind kind, bool ro = false)
        {
            return Fx.Param(ParameterKey.Project("T"), "T", kind, ro);
        }

        [Test]
        public static void Convert_String_Success()
        {
            ParameterWrite w; string err;
            Assert.True(ParameterRules.TryConvert(Info(ParamValueKind.Text), "A-01", out w, out err));
            Assert.Eq(ParamWriteKind.Text, w.Kind);
            Assert.Eq("A-01", w.Text);
        }

        [Test]
        public static void Convert_Integer_Success_And_Invalid()
        {
            ParameterWrite w; string err;
            Assert.True(ParameterRules.TryConvert(Info(ParamValueKind.Integer), "007", out w, out err));
            Assert.Eq(7L, w.IntValue);
            Assert.False(ParameterRules.TryConvert(Info(ParamValueKind.Integer), "A-01", out w, out err));
            Assert.True(err.Contains("бүхэл тоо"));
            Assert.False(ParameterRules.TryConvert(Info(ParamValueKind.Integer), "3000000000", out w, out err), "Int32-оос хэтэрсэн");
            Assert.False(ParameterRules.TryConvert(Info(ParamValueKind.Integer), "", out w, out err));
        }

        [Test]
        public static void Convert_UnitlessNumber_OK_ButNeverDimensionalOrYesNoOrElementId()
        {
            ParameterWrite w; string err;
            Assert.True(ParameterRules.TryConvert(Info(ParamValueKind.Number), "12.5", out w, out err));
            Assert.Eq(12.5, w.NumberValue);
            Assert.False(ParameterRules.TryConvert(Info(ParamValueKind.Number), "1,5x", out w, out err));
            foreach (ParamValueKind k in new[] { ParamValueKind.Dimensional, ParamValueKind.YesNo, ParamValueKind.ElementReference, ParamValueKind.Other })
                Assert.False(ParameterRules.TryConvert(Info(k), "5", out w, out err), "incompatible: " + k);
        }

        [Test]
        public static void Convert_ReadOnly_And_Missing()
        {
            ParameterWrite w; string err;
            Assert.False(ParameterRules.TryConvert(Info(ParamValueKind.Text, ro: true), "x", out w, out err));
            Assert.True(err.Contains("зөвхөн унших"));
            Assert.False(ParameterRules.TryConvert(null, "x", out w, out err));
        }

        [Test]
        public static void ParameterInfo_IsWritable_Rules()
        {
            Assert.True(Info(ParamValueKind.Text).IsWritable);
            Assert.True(Info(ParamValueKind.Integer).IsWritable);
            Assert.True(Info(ParamValueKind.Number).IsWritable);
            Assert.False(Info(ParamValueKind.Text, ro: true).IsWritable);
            Assert.False(Info(ParamValueKind.Dimensional).IsWritable);
            Assert.False(Info(ParamValueKind.YesNo).IsWritable);
            Assert.False(Info(ParamValueKind.ElementReference).IsWritable);
        }

        // ── Хуучирсан байдал ────────────────────────────────────────
        private static DocumentSnapshot Snap(params SheetSnapshot[] sheets)
        {
            return Fx.Doc(sheets);
        }

        private static DocumentStamp Stamp(string key, params SheetStamp[] sheets)
        {
            return new DocumentStamp { HasDocument = true, DocumentKey = key, Sheets = sheets.ToList() };
        }

        private static SheetStamp St(SheetSnapshot s, string number = null, string name = null)
        {
            return new SheetStamp { SheetId = s.SheetId, UniqueId = s.UniqueId, Number = number ?? s.Number, Name = name ?? s.Name };
        }

        [Test]
        public static void Freshness_Unchanged_IsFresh()
        {
            var a = Fx.Sheet(1, "A"); var b = Fx.Sheet(2, "B");
            FreshnessResult r = FreshnessChecker.Compare(Snap(a, b), Stamp("doc-1", St(a), St(b)), null);
            Assert.True(r.IsFresh);
        }

        [Test]
        public static void Freshness_DocumentSwitched_IsDocumentChanged()
        {
            var a = Fx.Sheet(1, "A");
            FreshnessResult r = FreshnessChecker.Compare(Snap(a), Stamp("OTHER", St(a)), null);
            Assert.Eq(FreshnessStatus.DocumentChanged, r.Status);
        }

        [Test]
        public static void Freshness_NoDocument()
        {
            var a = Fx.Sheet(1, "A");
            Assert.Eq(FreshnessStatus.NoDocument, FreshnessChecker.Compare(Snap(a), new DocumentStamp { HasDocument = false }, null).Status);
            Assert.Eq(FreshnessStatus.NoDocument, FreshnessChecker.Compare(Snap(a), null, null).Status);
        }

        [Test]
        public static void Freshness_DeletedNumberChangedAndNameChanged()
        {
            var a = Fx.Sheet(1, "A"); var b = Fx.Sheet(2, "B"); var c = Fx.Sheet(3, "C", name: "Old");
            FreshnessResult r = FreshnessChecker.Compare(Snap(a, b, c), Stamp("doc-1", St(b, number: "B2"), St(c, name: "New")), null);
            Assert.Eq(FreshnessStatus.SheetsChanged, r.Status);
            Assert.Eq(3, r.Details.Count);   // a устсан, b дугаар, c нэр
        }

        [Test]
        public static void Freshness_AffectedOnly_IgnoresUnrelatedChangesAndNewSheets()
        {
            var a = Fx.Sheet(1, "A"); var b = Fx.Sheet(2, "B");
            var added = new SheetStamp { SheetId = 9, UniqueId = "u9", Number = "Z", Name = "Z" };
            DocumentStamp live = Stamp("doc-1", St(a), St(b, number: "B-CHANGED"), added);
            FreshnessResult r = FreshnessChecker.Compare(Snap(a, b), live, new HashSet<long> { 1 });
            Assert.True(r.IsFresh, "зөвхөн хөндөгдөх хуудсыг шалгана");
            r = FreshnessChecker.Compare(Snap(a, b), live, null);
            Assert.False(r.IsFresh, "цонхны баннер: БҮХ хуудас + шинээр нэмэгдсэн");
        }

        [Test]
        public static void Freshness_UniqueIdMismatch_CountsAsDeleted()
        {
            var a = Fx.Sheet(1, "A");
            var live = Stamp("doc-1", new SheetStamp { SheetId = 1, UniqueId = "different", Number = "A", Name = a.Name });
            Assert.False(FreshnessChecker.Compare(Snap(a), live, null).IsFresh);
        }

        [Test]
        public static void LiveDuplicateCheck_UsesRealCurrentNumbers()
        {
            // Snapshot авсны ДАРАА өөр хэрэглэгч хуудас 5-д «X1» дугаар өгсөн.
            var items = new List<ApplyItem>
            {
                new ApplyItem { SheetId = 1, ExpectedNumber = "A", NewNumber = "X1" },
            };
            DocumentStamp live = Stamp("doc-1",
                new SheetStamp { SheetId = 1, UniqueId = "u1", Number = "A", Name = "n" },
                new SheetStamp { SheetId = 5, UniqueId = "u5", Number = "X1", Name = "n" });
            IReadOnlyList<DuplicateHit> hits = FreshnessChecker.FindLiveDuplicates(live, UniquenessMode.PerSheetCollection, items);
            Assert.Eq(1, hits.Count);
            Assert.Eq(1L, hits[0].SheetId);
        }

        // ── Apply хүсэлт ────────────────────────────────────────────
        [Test]
        public static void ApplyRequest_ContainsOnlyChangedRows_WithExpectedValues()
        {
            List<SheetSnapshot> sheets = Fx.Sheets("1", "2", "9");
            RenumberPlan p = Fx.Plan(sheets, Fx.SimpleSettings());
            ApplyRequest req = ApplyRequestBuilder.Build(p, Fx.Doc(sheets));
            Assert.Eq(1, req.Items.Count);
            Assert.Eq(3L, req.Items[0].SheetId);
            Assert.Eq("9", req.Items[0].ExpectedNumber);
            Assert.Eq("3", req.Items[0].NewNumber);
            Assert.Null(req.Items[0].NewName);
            Assert.Eq("doc-1", req.DocumentKey);
            Assert.Eq("MGL – Зургийн хуудас дугаарлах", req.Label);
        }

        // ── Тохиргооны хадгалалт ────────────────────────────────────
        [Test]
        public static void Prefs_RoundTrip_PreservesUsefulSettings()
        {
            var prefs = new SheetNumeratorPrefs { DisplayMode = DisplayMode.AllInOne, SortByName = true, HidePreview = true, UnicodeWarningAccepted = true };
            prefs.Window = new WindowPrefs { Left = 10, Top = 20, Width = 900, Height = 600 };
            RenumberSettings s = prefs.Settings;
            s.Mode = NumberingMode.Advanced;
            s.Simple.Prefix = "A-"; s.Simple.Start = -3; s.Simple.Width = 4; s.Simple.UseStartNumber = false;
            s.Advanced.Parts[1].Enabled = true; s.Advanced.Parts[1].Limit = 9; s.Advanced.Parts[1].WrapAtLimit = true; s.Advanced.Parts[1].ValueMode = PartValueMode.Decrement;
            s.Advanced.Separators[0] = "/";
            s.UseParameterPrefix = true; s.PrefixParameter = ParameterKey.BuiltIn(-1007404);
            s.WriteResultToParameter = true; s.ResultParameter = ParameterKey.Project("Mark"); s.ResultSource = GeneratedValueSource.Part2Number;
            s.WriteGroupCount = true; s.CountParameter = ParameterKey.Shared(Guid.Parse("11111111-2222-3333-4444-555555555555")); s.CountScope = CountWriteScope.AllSheets;
            s.NameAtStart = true; s.NameSeparator = " – "; s.NameSource = GeneratedValueSource.Part1Number;
            s.ShiftAmount = 5; s.ShiftTokenIndex = 1;
            s.UseUnicodeMarkers = true; s.MarkerChar = '⁠';

            SheetNumeratorPrefs back = PrefsSerializer.Deserialize(PrefsSerializer.Serialize(prefs));
            Assert.Eq(DisplayMode.AllInOne, back.DisplayMode);
            Assert.True(back.SortByName); Assert.True(back.HidePreview); Assert.True(back.UnicodeWarningAccepted);
            Assert.Eq(900.0, back.Window.Width);
            RenumberSettings r = back.Settings;
            Assert.Eq(NumberingMode.Advanced, r.Mode);
            Assert.Eq("A-", r.Simple.Prefix); Assert.Eq(-3L, r.Simple.Start); Assert.Eq(4, r.Simple.Width); Assert.False(r.Simple.UseStartNumber);
            Assert.True(r.Advanced.Parts[1].Enabled); Assert.Eq(9L, r.Advanced.Parts[1].Limit.Value); Assert.True(r.Advanced.Parts[1].WrapAtLimit);
            Assert.Eq(PartValueMode.Decrement, r.Advanced.Parts[1].ValueMode);
            Assert.Eq("/", r.Advanced.Separators[0]);
            Assert.Eq("bip:-1007404", r.PrefixParameter.Stable);
            Assert.Eq("prj:Mark", r.ResultParameter.Stable);
            Assert.Eq(GeneratedValueSource.Part2Number, r.ResultSource);
            Assert.Eq(CountWriteScope.AllSheets, r.CountScope);
            Assert.Eq(" – ", r.NameSeparator);
            Assert.Eq(5L, r.ShiftAmount); Assert.Eq(1, r.ShiftTokenIndex);
            Assert.True(r.UseUnicodeMarkers); Assert.Eq('⁠', r.MarkerChar);
        }

        [Test]
        public static void Prefs_SessionStateIsNeverRestored()
        {
            var prefs = new SheetNumeratorPrefs();
            prefs.Settings.MoveRenumber = true;
            prefs.Settings.StartFromSelected = true;
            prefs.Settings.ShiftActive = true;
            prefs.Settings.CleanMarkers = true;
            SheetNumeratorPrefs back = PrefsSerializer.Deserialize(PrefsSerializer.Serialize(prefs));
            Assert.False(back.Settings.MoveRenumber);
            Assert.False(back.Settings.StartFromSelected);
            Assert.False(back.Settings.ShiftActive);
            Assert.False(back.Settings.CleanMarkers);
        }

        [Test]
        public static void Prefs_Garbage_FallsBackToDefaults_NoThrow()
        {
            foreach (string bad in new[] { null, "", "   ", "not json", "[1,2,3]", "{\"simple\": 5, \"window\": \"x\"}", "{\"schema_version\":\"abc\"}" })
            {
                SheetNumeratorPrefs p = PrefsSerializer.Deserialize(bad);
                Assert.NotNull(p);
                Assert.Eq(1L, p.Settings.Simple.Start);
                Assert.Eq(DisplayMode.Grouped, p.DisplayMode);
            }
        }

        [Test]
        public static void Prefs_OutOfRangeValues_AreSanitized()
        {
            string json = "{\"schema_version\":1,\"simple\":{\"start\":99999999999999999,\"width\":500},"
                + "\"advanced\":{\"parts\":[{\"enabled\":true,\"step\":0,\"width\":-4,\"value_mode\":\"bogus\"}]},"
                + "\"shift\":{\"amount\":-5,\"token_index\":-99},\"marker\":{\"char\":\"U+0041\"},"
                + "\"window\":{\"left\":1,\"top\":1,\"width\":5,\"height\":5}}";
            SheetNumeratorPrefs p = PrefsSerializer.Deserialize(json);
            Assert.Eq(1L, p.Settings.Simple.Start);
            Assert.Eq(NumberFormatting.MaxWidth, p.Settings.Simple.Width);
            Assert.Eq(1L, p.Settings.Advanced.Parts[0].Step);
            Assert.Eq(0, p.Settings.Advanced.Parts[0].Width);
            Assert.Eq(PartValueMode.Increment, p.Settings.Advanced.Parts[0].ValueMode);
            Assert.Eq(1L, p.Settings.ShiftAmount);
            Assert.Eq(ExistingNumberShift.LastToken, p.Settings.ShiftTokenIndex);
            Assert.Eq('​', p.Settings.MarkerChar, "танигдаагүй тэмдэг → өгөгдмөл");
            Assert.False(p.Window.HasBounds, "хэт жижиг цонх хаягдана");
        }

        [Test]
        public static void Prefs_MigratesPreReleaseFlatKeys_ToSimple()
        {
            // v0 (pre-release): хавтгай түлхүүрүүд, schema_version байхгүй.
            string v0 = "{\"prefix\":\"AR-\",\"suffix\":\"-X\",\"start_number\":\"5\",\"number_width\":3}";
            SheetNumeratorPrefs p = PrefsSerializer.Deserialize(v0);
            Assert.Eq("AR-", p.Settings.Simple.Prefix);
            Assert.Eq("-X", p.Settings.Simple.Suffix);
            Assert.Eq(5L, p.Settings.Simple.Start);
            Assert.Eq(3, p.Settings.Simple.Width);
            Assert.Eq(SheetNumeratorPrefs.CurrentVersion, p.SchemaVersion);
        }

        [Test]
        public static void Prefs_FutureVersion_ReadsKnownFieldsWithoutCrashing()
        {
            string future = "{\"schema_version\":99,\"simple\":{\"prefix\":\"F-\"},\"brand_new_section\":{\"x\":1}}";
            SheetNumeratorPrefs p = PrefsSerializer.Deserialize(future);
            Assert.Eq("F-", p.Settings.Simple.Prefix);
        }

        [Test]
        public static void Prefs_UnknownParameterKey_ReadsAsNull_LeavingValidatorToClearIt()
        {
            string json = "{\"schema_version\":1,\"param_prefix\":{\"enabled\":true,\"key\":\"weird:thing\"}}";
            SheetNumeratorPrefs p = PrefsSerializer.Deserialize(json);
            Assert.Null(p.Settings.PrefixParameter);
            Assert.True(p.Settings.UseParameterPrefix);   // ViewModel нь байхгүй параметрийг ачаалахдаа цэвэрлэнэ
        }
    }
}
