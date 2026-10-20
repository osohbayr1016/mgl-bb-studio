using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.SmartPublish.Core;

namespace RevitMcpAddin.Smart.Tests
{
    public static class NamingTests
    {
        private sealed class Dict : ITokenSource
        {
            private readonly Dictionary<string, string> _v;
            public Dict(params string[] kv)
            {
                _v = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                for (int i = 0; i + 1 < kv.Length; i += 2) _v[kv[i]] = kv[i + 1];
            }
            public string Get(string name, string arg)
            {
                string key = arg == null ? name : name + ":" + arg;
                string v;
                return _v.TryGetValue(key, out v) ? v : null;
            }
        }

        private static NameResult Eval(string tpl, ITokenSource src, NamingSettings s = null)
        {
            ParsedTemplate p = NamingEngine.Parse(tpl);
            Assert.True(p.IsValid, string.Join("; ", p.Errors));
            return NamingEngine.Evaluate(p, src, s ?? new NamingSettings());
        }

        /* ------------------------------ ПАРС ------------------------------ */

        [Test]
        public static void Parse_UnknownToken_IsAnError()
        {
            ParsedTemplate p = NamingEngine.Parse("{SheetNumbr}_{SheetName}");
            Assert.False(p.IsValid);
            Assert.True(p.Errors.Any(e => e.Contains("SheetNumbr")), string.Join("|", p.Errors));
        }

        [Test]
        public static void Parse_UnclosedBraceAndBracket_AreErrors()
        {
            Assert.False(NamingEngine.Parse("{SheetNumber").IsValid);
            Assert.False(NamingEngine.Parse("[_{Revision}").IsValid);
            Assert.False(NamingEngine.Parse("{SheetNumber}]").IsValid);
            Assert.False(NamingEngine.Parse("{SheetNumber}}").IsValid);
            Assert.False(NamingEngine.Parse("").IsValid);
            Assert.False(NamingEngine.Parse(null).IsValid);
        }

        [Test]
        public static void Parse_ParamAndProject_RequireArgument()
        {
            Assert.False(NamingEngine.Parse("{Param}").IsValid);
            Assert.False(NamingEngine.Parse("{Project}").IsValid);
            Assert.True(NamingEngine.Parse("{Param:Discipline}").IsValid);
            Assert.True(NamingEngine.Parse("{Project:Phase}").IsValid);
        }

        [Test]
        public static void Parse_BadModifiers_AreErrors()
        {
            Assert.False(NamingEngine.Parse("{SheetName|shout}").IsValid);
            Assert.False(NamingEngine.Parse("{SheetName|max}").IsValid);
            Assert.False(NamingEngine.Parse("{SheetName|max=abc}").IsValid);
            Assert.False(NamingEngine.Parse("{SheetName|pad=0}").IsValid);
            Assert.True(NamingEngine.Parse("{SheetName|upper|max=10}").IsValid);
        }

        [Test]
        public static void Parse_TokenNamesAreCaseInsensitive_AndAliased()
        {
            ParsedTemplate p = NamingEngine.Parse("{sheetnumber}{Number}{ProjectCode}{name}");
            Assert.True(p.IsValid);
            Assert.SeqEq(new[] { "SheetNumber", "SheetNumber", "ProjectNumber", "SheetName" }, p.Tokens().Select(t => t.Name));
        }

        [Test]
        public static void Parse_EscapedBraces_AreLiteral()
        {
            NameResult r = Eval("\\{{SheetNumber}\\}", new Dict("SheetNumber", "A-101"));
            // `{` `}` файлын нэрт хориотой биш тул утга хэвээр орно.
            Assert.True(r.Name.Contains("A-101"), r.Name);
        }

        /* ------------------------------ ТООЦОО ---------------------------- */

        [Test]
        public static void Eval_Basic_Substitution()
        {
            NameResult r = Eval("{ProjectNumber}_{SheetNumber}_{SheetName}", new Dict("ProjectNumber", "P1", "SheetNumber", "A-101", "SheetName", "Floor Plan"));
            Assert.Eq("P1_A-101_Floor Plan", r.Name);
            Assert.Eq(0, r.MissingTokens.Count);
        }

        [Test]
        public static void Eval_Mongolian_Unicode_IsPreserved()
        {
            NameResult r = Eval("{SheetNumber}_{SheetName}", new Dict("SheetNumber", "АР-101", "SheetName", "Нэгдүгээр давхрын план"));
            Assert.Eq("АР-101_Нэгдүгээр давхрын план", r.Name);
        }

        [Test]
        public static void Eval_Mongolian_DecomposedForm_IsNormalizedToNfc()
        {
            // «й» = и + U+0306 (decomposed).  NFC-д нэг тэмдэгт болно — ижил харагдах хоёр нэр давхцах ёстой.
            string decomposed = "Цй";
            string composed = "Цй";
            NameResult a = Eval("{SheetName}", new Dict("SheetName", decomposed));
            NameResult b = Eval("{SheetName}", new Dict("SheetName", composed));
            Assert.Eq(b.Name, a.Name);
        }

        [Test]
        public static void Eval_OptionalGroup_Dropped_WhenTokenMissing()
        {
            NameResult withRev = Eval("{SheetNumber}[_Rev{Revision}]", new Dict("SheetNumber", "A1", "Revision", "B"));
            Assert.Eq("A1_RevB", withRev.Name);
            NameResult noRev = Eval("{SheetNumber}[_Rev{Revision}]", new Dict("SheetNumber", "A1"));
            Assert.Eq("A1", noRev.Name);
            Assert.Eq(0, noRev.MissingTokens.Count, "бүлгийн токен «дутуу» гэж тооцогдохгүй");
        }

        [Test]
        public static void Eval_NestedOptionalGroups_AreIndependent()
        {
            string tpl = "{SheetNumber}[_{Revision}[-{RevisionDate}]]";
            Assert.Eq("A1_B-2026", Eval(tpl, new Dict("SheetNumber", "A1", "Revision", "B", "RevisionDate", "2026")).Name);
            Assert.Eq("A1_B", Eval(tpl, new Dict("SheetNumber", "A1", "Revision", "B")).Name);
            Assert.Eq("A1", Eval(tpl, new Dict("SheetNumber", "A1")).Name);
        }

        [Test]
        public static void Eval_MissingToken_Policies()
        {
            var src = new Dict("SheetNumber", "A1");
            NameResult err = Eval("{SheetNumber}_{SheetName}", src, new NamingSettings { OnMissing = MissingTokenPolicy.Error });
            Assert.Eq(1, err.MissingTokens.Count);
            Assert.Eq("A1", err.Name);

            NameResult empty = Eval("{SheetNumber}_{SheetName}", src, new NamingSettings { OnMissing = MissingTokenPolicy.Empty });
            Assert.Eq("A1", empty.Name);

            NameResult ph = Eval("{SheetNumber}_{SheetName}", src, new NamingSettings { OnMissing = MissingTokenPolicy.Placeholder, MissingText = "NA" });
            Assert.Eq("A1_NA", ph.Name);
        }

        [Test]
        public static void Eval_WhitespaceOnlyValue_CountsAsMissing()
        {
            NameResult r = Eval("{SheetNumber}_{SheetName}", new Dict("SheetNumber", "A1", "SheetName", "   "));
            Assert.Eq(1, r.MissingTokens.Count);
        }

        [Test]
        public static void Eval_Modifiers()
        {
            var src = new Dict("SheetName", "floor plan", "Param:Discipline", "Architecture", "SheetNumber", "7", "Index", "3");
            Assert.Eq("FLOOR PLAN", Eval("{SheetName|upper}", src).Name);
            Assert.Eq("Arc", Eval("{Param:Discipline|max=3}", src).Name);
            Assert.Eq("floorplan", Eval("{SheetName|nospace}", src).Name);
            Assert.Eq("floor_plan", Eval("{SheetName|underscore}", src).Name);
            Assert.Eq("007", Eval("{SheetNumber|pad=3}", src).Name);
            Assert.Eq("ARC", Eval("{Param:Discipline|max=3|upper}", src).Name);
        }

        [Test]
        public static void Eval_Pad_OnlyForDigits()
        {
            Assert.Eq("A7", Eval("{SheetNumber|pad=3}", new Dict("SheetNumber", "A7")).Name);
        }

        [Test]
        public static void Eval_BadDateFormat_DoesNotThrow()
        {
            PublishContext ctx = Samples.Project();
            PublishItem it = Samples.Sheet("1", "A1", "Plan");
            NameResult r = NamingEngine.Evaluate(NamingEngine.Parse("{SheetNumber}_{Date:%%%}"), PublishTokens.ForItem(ctx, it, PublishFormat.Pdf, 1), new NamingSettings());
            Assert.NotNull(r.Name);   // шидээгүй
        }

        /* ---------------------------- ЦЭВЭРЛЭГЭЭ -------------------------- */

        [Test]
        public static void Sanitize_InvalidChars_AreReplaced()
        {
            bool rep, tr;
            string s = NamingEngine.SanitizeSegment("A/B\\C:D*E?F\"G<H>I|J", "_", 120, out rep, out tr);
            Assert.Eq("A_B_C_D_E_F_G_H_I_J", s);
            Assert.True(rep);
        }

        [Test]
        public static void Sanitize_ReplacementCanBeEmpty()
        {
            bool rep, tr;
            Assert.Eq("AB", NamingEngine.SanitizeSegment("A:B", "", 120, out rep, out tr));
        }

        [Test]
        public static void Sanitize_ControlChars_AndTrailingDots()
        {
            bool rep, tr;
            Assert.Eq("A_B", NamingEngine.SanitizeSegment("A\tB...", "_", 120, out rep, out tr));
            Assert.Eq("A", NamingEngine.SanitizeSegment("  A. . ", "_", 120, out rep, out tr));
        }

        [Test]
        public static void Sanitize_ReservedDeviceNames()
        {
            bool rep, tr;
            Assert.Eq("_CON", NamingEngine.SanitizeSegment("CON", "_", 120, out rep, out tr));
            Assert.Eq("_nul", NamingEngine.SanitizeSegment("nul", "_", 120, out rep, out tr));
            Assert.Eq("_COM1", NamingEngine.SanitizeSegment("COM1", "_", 120, out rep, out tr));
            Assert.Eq("CONFIG", NamingEngine.SanitizeSegment("CONFIG", "_", 120, out rep, out tr));
        }

        [Test]
        public static void Sanitize_EmptyAfterCleaning_IsEmpty()
        {
            bool rep, tr;
            Assert.Eq("", NamingEngine.SanitizeSegment("...", "_", 120, out rep, out tr));
            Assert.Eq("", NamingEngine.SanitizeSegment("   ", "_", 120, out rep, out tr));
            Assert.Eq("", NamingEngine.SanitizeSegment(null, "_", 120, out rep, out tr));
        }

        [Test]
        public static void Sanitize_CollapsesDuplicateSeparators()
        {
            bool rep, tr;
            Assert.Eq("A_B-C D", NamingEngine.SanitizeSegment("A___B--C   D", "_", 120, out rep, out tr));
        }

        [Test]
        public static void Sanitize_Truncates_WithoutSplittingSurrogatePairs()
        {
            bool rep, tr;
            string emojiName = "AB" + "\U0001F600\U0001F600\U0001F600";
            string s = NamingEngine.SanitizeSegment(emojiName, "_", 5, out rep, out tr);
            Assert.True(tr);
            Assert.True(s.Length <= 5);
            Assert.False(char.IsHighSurrogate(s[s.Length - 1]), "суррогат хос тасрахгүй");
        }

        [Test]
        public static void Sanitize_LongMongolianName_IsTruncatedToMax()
        {
            bool rep, tr;
            string s = NamingEngine.SanitizeSegment(new string('Ө', 300), "_", 120, out rep, out tr);
            Assert.Eq(120, s.Length);
            Assert.True(tr);
        }

        [Test]
        public static void Eval_ResultIsTrimmed_WhenTrailingTokenEmpty()
        {
            NameResult r = Eval("{SheetNumber}_{SheetName}", new Dict("SheetNumber", "A1"), new NamingSettings { OnMissing = MissingTokenPolicy.Empty });
            Assert.Eq("A1", r.Name);   // төгсгөлийн `_` үлдэхгүй
        }

        [Test]
        public static void Eval_AllEmpty_GivesEmptyName()
        {
            NameResult r = Eval("{SheetNumber}", new Dict(), new NamingSettings { OnMissing = MissingTokenPolicy.Empty });
            Assert.True(r.IsEmpty);
        }

        /* ------------------------- PublishTokens -------------------------- */

        [Test]
        public static void Tokens_ProjectAndDateAndFormat()
        {
            PublishContext ctx = Samples.Project(new DateTime(2026, 10, 1, 9, 30, 0));
            PublishItem it = Samples.Sheet("u1", "A-101", "Plan", "C");
            var t = PublishTokens.ForItem(ctx, it, PublishFormat.Dwg, 4);
            Assert.Eq("MGL-251006", t.Get("ProjectNumber", null));
            Assert.Eq("20261001", t.Get("Date", null));
            Assert.Eq("2026-10-01 0930", t.Get("Date", "yyyy-MM-dd HHmm"));
            Assert.Eq("DWG", t.Get("Format", null));
            Assert.Eq("0004", t.Get("Index", "4"));
            Assert.Eq("DD", t.Get("Project", "phase"));
            Assert.Eq("Architecture", t.Get("Param", "discipline"));
            Assert.Null(t.Get("Param", "Missing"));
            Assert.Eq("C", t.Get("Revision", null));
        }

        [Test]
        public static void Tokens_SetHasNoSheetTokens_ButHasRangeTokens()
        {
            PublishContext ctx = Samples.Project();
            var items = new List<PublishItem> { Samples.Sheet("1", "A-101", "One"), Samples.Sheet("2", "A-102", "Two"), Samples.Sheet("3", "A-103", "Three") };
            var t = PublishTokens.ForSet(ctx, items, PublishFormat.Pdf, 1);
            Assert.Null(t.Get("SheetNumber", null));
            Assert.Eq("3", t.Get("SheetCount", null));
            Assert.Eq("A-101", t.Get("FirstSheet", null));
            Assert.Eq("A-103", t.Get("LastSheet", null));
        }
    }
}
