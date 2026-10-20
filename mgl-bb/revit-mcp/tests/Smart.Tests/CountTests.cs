using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.Smart.Core;
using RevitMcpAddin.SmartCount.Core;

namespace RevitMcpAddin.Smart.Tests
{
    public static class CountTests
    {
        private static ElementRecord Rec(string cat = "Walls", string family = "Basic Wall", string type = "Generic - 200mm", string level = "Level 1", long id = 1)
        {
            return new ElementRecord { ElementIdValue = id, UniqueId = "u" + id, Category = cat, Family = family, Type = type, Level = level };
        }

        private static ElementRecord WithParams(ElementRecord r, params KeyValuePair<string, ParamValue>[] ps)
        {
            foreach (var kv in ps) r.Params[kv.Key] = kv.Value;
            return r;
        }

        private static KeyValuePair<string, ParamValue> P(string name, ParamValue v) { return new KeyValuePair<string, ParamValue>(name, v); }
        private static ParamValue Len(double mm) { return ParamValue.OfNumber(mm, "length", mm + " mm"); }
        private static ParamValue Area(double m2) { return ParamValue.OfNumber(m2, "area", m2 + " m²"); }
        private static ParamValue Vol(double m3) { return ParamValue.OfNumber(m3, "volume", m3 + " m³"); }
        private static ParamValue Ang(double deg) { return ParamValue.OfNumber(deg, "angle", deg + "°"); }

        private static bool M(QueryNode n, ElementRecord r) { return QueryEvaluator.Matches(n, r); }

        /* ------------------------------- UNITS ---------------------------- */

        [Test]
        public static void Units_Length_ToCanonicalMm()
        {
            double v;
            Assert.True(UnitCatalog.ToCanonical(3, "m", "length", out v)); Assert.Near(3000, v, 1e-9);
            Assert.True(UnitCatalog.ToCanonical(12, "in", "length", out v)); Assert.Near(304.8, v, 1e-9);
            Assert.True(UnitCatalog.ToCanonical(1, "ft", "length", out v)); Assert.Near(304.8, v, 1e-9);
            Assert.True(UnitCatalog.ToCanonical(25, "cm", "length", out v)); Assert.Near(250, v, 1e-9);
            Assert.True(UnitCatalog.ToCanonical(500, "mm", "length", out v)); Assert.Near(500, v, 1e-9);
        }

        [Test]
        public static void Units_AreaVolumeAngle()
        {
            double v;
            Assert.True(UnitCatalog.ToCanonical(1, "ft2", "area", out v)); Assert.Near(0.09290304, v, 1e-12);
            Assert.True(UnitCatalog.ToCanonical(50000, "cm2", "area", out v)); Assert.Near(5, v, 1e-9);
            Assert.True(UnitCatalog.ToCanonical(1, "ft3", "volume", out v)); Assert.Near(0.028316846592, v, 1e-12);
            Assert.True(UnitCatalog.ToCanonical(1000, "l", "volume", out v)); Assert.Near(1, v, 1e-9);
            Assert.True(UnitCatalog.ToCanonical(Math.PI, "rad", "angle", out v)); Assert.Near(180, v, 1e-9);
        }

        [Test]
        public static void Units_Mismatch_IsRejected_NotConverted()
        {
            double v;
            Assert.False(UnitCatalog.ToCanonical(1, "mm", "area", out v), "мм-ийг талбайд хэрэглэж болохгүй");
            Assert.False(UnitCatalog.ToCanonical(1, "m3", "length", out v));
            Assert.False(UnitCatalog.ToCanonical(1, "parsec", "length", out v));
        }

        [Test]
        public static void Units_Normalize_AcceptsMongolianAndSymbols()
        {
            Assert.Eq("m2", UnitCatalog.Normalize("м²"));
            Assert.Eq("m2", UnitCatalog.Normalize("м2"));
            Assert.Eq("m3", UnitCatalog.Normalize("м³"));
            Assert.Eq("mm", UnitCatalog.Normalize("мм"));
            Assert.Eq("deg", UnitCatalog.Normalize("°"));
            Assert.Eq("l", UnitCatalog.Normalize("литр"));
            Assert.Null(UnitCatalog.Normalize(" "));
        }

        [Test]
        public static void Units_RoundTrip_FromCanonical()
        {
            Assert.Near(3.0, UnitCatalog.FromCanonical(3000, "m"), 1e-12);
            Assert.Near(1.0, UnitCatalog.FromCanonical(304.8, "ft"), 1e-12);
        }

        [Test]
        public static void ParseNumber_Formats()
        {
            double v;
            string u;
            Assert.True(UnitCatalog.TryParseNumber("3000", out v, out u)); Assert.Near(3000, v, 0); Assert.Null(u);
            Assert.True(UnitCatalog.TryParseNumber("3,5", out v, out u)); Assert.Near(3.5, v, 1e-12);
            Assert.True(UnitCatalog.TryParseNumber("1 200.5", out v, out u)); Assert.Near(1200.5, v, 1e-12);
            Assert.True(UnitCatalog.TryParseNumber("1.200,75", out v, out u)); Assert.Near(1200.75, v, 1e-12);
            Assert.True(UnitCatalog.TryParseNumber("1,200.75", out v, out u)); Assert.Near(1200.75, v, 1e-12);
            Assert.True(UnitCatalog.TryParseNumber("-2.5", out v, out u)); Assert.Near(-2.5, v, 1e-12);
            Assert.True(UnitCatalog.TryParseNumber("3000 мм", out v, out u)); Assert.Eq("мм", u);
            Assert.True(UnitCatalog.TryParseNumber("2.5m²", out v, out u)); Assert.Eq("m²", u);
            Assert.False(UnitCatalog.TryParseNumber("abc", out v, out u));
            Assert.False(UnitCatalog.TryParseNumber("", out v, out u));
            Assert.False(UnitCatalog.TryParseNumber("1.2.3", out v, out u));
        }

        /* ----------------------------- TEXT CLAUSES ----------------------- */

        [Test]
        public static void Text_Equals_CaseInsensitive_AndNfc()
        {
            Assert.True(M(QueryNode.Clause(ClauseField.Level, ClauseOp.Equals, "level 1"), Rec(level: "Level 1")));
            Assert.False(M(QueryNode.Clause(ClauseField.Level, ClauseOp.Equals, "level 1") .Also(n => n.CaseSensitive = true), Rec(level: "Level 1")));
            // Монгол: decomposed «й» = NFC
            Assert.True(M(QueryNode.Clause(ClauseField.Type, ClauseOp.Equals, "Цй"), Rec(type: "Цй")));
        }

        [Test]
        public static void Text_Contains_StartsEnds_NotContains()
        {
            ElementRecord r = Rec(type: "Concrete 200mm Exterior");
            Assert.True(M(QueryNode.Clause(ClauseField.Type, ClauseOp.Contains, "200MM"), r));
            Assert.True(M(QueryNode.Clause(ClauseField.Type, ClauseOp.StartsWith, "concrete"), r));
            Assert.True(M(QueryNode.Clause(ClauseField.Type, ClauseOp.EndsWith, "exterior"), r));
            Assert.True(M(QueryNode.Clause(ClauseField.Type, ClauseOp.NotContains, "brick"), r));
            Assert.False(M(QueryNode.Clause(ClauseField.Type, ClauseOp.NotContains, "200"), r));
        }

        [Test]
        public static void Text_EmptyValue_Semantics()
        {
            Assert.True(M(QueryNode.Clause(ClauseField.Level, ClauseOp.IsEmpty), Rec(level: null)));
            Assert.True(M(QueryNode.Clause(ClauseField.Level, ClauseOp.NotEmpty), Rec(level: "L1")));
            Assert.False(M(QueryNode.Clause(ClauseField.Level, ClauseOp.NotContains, ""), Rec()), "хоосон NotContains юу ч таарахгүй");
        }

        [Test]
        public static void Text_NumericOpOnTextField_IsProblem_NotMatch()
        {
            var st = new EvalStats();
            Assert.False(QueryEvaluator.Matches(QueryNode.Clause(ClauseField.Level, ClauseOp.Greater, "3"), Rec(), st));
            Assert.Eq(1, st.Problems);
        }

        /* --------------------------- PARAMETER CLAUSES -------------------- */

        [Test]
        public static void Param_Numeric_Length_UsesMillimetres_NotInternalFeet()
        {
            // Ханын урт 3000 мм.  «> 2500 мм» таарна; «> 2.5 m» ч таарна; «> 2500» (каноник=мм) таарна.
            ElementRecord r = WithParams(Rec(), P("Length", Len(3000)));
            Assert.True(M(QueryNode.Param("Length", ClauseOp.Greater, "2500"), r));
            Assert.True(M(QueryNode.Param("Length", ClauseOp.Greater, "2.5", unit: "m"), r));
            Assert.True(M(QueryNode.Param("Length", ClauseOp.Greater, "2,5 m"), r));
            Assert.False(M(QueryNode.Param("Length", ClauseOp.Greater, "3.5", unit: "m"), r));
        }

        [Test]
        public static void Param_LengthInFeet_Direction_IsCorrect()
        {
            ElementRecord r = WithParams(Rec(), P("Length", Len(3000)));
            // 3000 мм = 9.84 фут → «> 9 ft» үнэн, «> 10 ft» худал.
            Assert.True(M(QueryNode.Param("Length", ClauseOp.Greater, "9", unit: "ft"), r));
            Assert.False(M(QueryNode.Param("Length", ClauseOp.Greater, "10", unit: "ft"), r));
        }

        [Test]
        public static void Param_Area_Volume_Angle_Units()
        {
            ElementRecord r = WithParams(Rec(), P("Area", Area(12.5)), P("Volume", Vol(2.5)), P("Angle", Ang(45)));
            Assert.True(M(QueryNode.Param("Area", ClauseOp.GreaterOrEqual, "12.5"), r));
            Assert.True(M(QueryNode.Param("Volume", ClauseOp.LessOrEqual, "2.5"), r));
            Assert.True(M(QueryNode.Param("Angle", ClauseOp.Between, "30", "60"), r));
        }

        [Test]
        public static void Param_Area_Between_ConvertedFromSquareFeet()
        {
            ElementRecord r = WithParams(Rec(), P("Area", Area(12.5)));   // 12.5 м² ≈ 134.55 ft²
            Assert.True(M(QueryNode.Param("Area", ClauseOp.Between, "130", "140", unit: "ft2"), r));
            Assert.False(M(QueryNode.Param("Area", ClauseOp.Between, "100", "130", unit: "ft2"), r));
        }

        [Test]
        public static void Param_Volume_Litres_And_Angle_Radians()
        {
            ElementRecord r = WithParams(Rec(), P("Volume", Vol(2.5)), P("Angle", Ang(90)));
            Assert.True(M(QueryNode.Param("Volume", ClauseOp.Equals, "2500", unit: "l"), r));
            Assert.True(M(QueryNode.Param("Angle", ClauseOp.Equals, (Math.PI / 2).ToString(System.Globalization.CultureInfo.InvariantCulture), unit: "rad"), r));
        }

        [Test]
        public static void Param_UnitMismatch_IsProblemAndNoMatch()
        {
            ElementRecord r = WithParams(Rec(), P("Area", Area(12.5)));
            var st = new EvalStats();
            Assert.False(QueryEvaluator.Matches(QueryNode.Param("Area", ClauseOp.Greater, "5", unit: "mm"), r, st));
            Assert.Eq(1, st.Problems);
            Assert.True(st.ProblemNotes.Any(n => n.Contains("таарахгүй")), string.Join("|", st.ProblemNotes));
            // Тэнцүү: мм-ийг талбайд — тоон Equals ч Problem (чимээгүй текст рүү унахгүй).
            var st2 = new EvalStats();
            Assert.False(QueryEvaluator.Matches(QueryNode.Param("Area", ClauseOp.Equals, "12.5", unit: "mm"), r, st2));
            Assert.Eq(1, st2.Problems);
        }

        [Test]
        public static void Param_NonNumericParam_NumericOp_IsProblem()
        {
            ElementRecord r = WithParams(Rec(), P("Mark", ParamValue.OfText("A12")));
            var st = new EvalStats();
            Assert.False(QueryEvaluator.Matches(QueryNode.Param("Mark", ClauseOp.Greater, "5"), r, st));
            Assert.Eq(1, st.Problems);
        }

        [Test]
        public static void Param_NumericEquals_UsesTolerance()
        {
            ElementRecord r = WithParams(Rec(), P("Length", Len(3000.0000000001)));
            Assert.True(M(QueryNode.Param("Length", ClauseOp.Equals, "3000"), r));
            Assert.False(M(QueryNode.Param("Length", ClauseOp.Equals, "3000.5"), r));
            Assert.True(M(QueryNode.Param("Length", ClauseOp.NotEquals, "3000.5"), r));
        }

        [Test]
        public static void Param_Strict_GreaterExcludesEqual_GreaterOrEqualIncludes()
        {
            ElementRecord r = WithParams(Rec(), P("Length", Len(3000)));
            Assert.False(M(QueryNode.Param("Length", ClauseOp.Greater, "3000"), r));
            Assert.True(M(QueryNode.Param("Length", ClauseOp.GreaterOrEqual, "3000"), r));
            Assert.False(M(QueryNode.Param("Length", ClauseOp.Less, "3000"), r));
            Assert.True(M(QueryNode.Param("Length", ClauseOp.LessOrEqual, "3000"), r));
        }

        [Test]
        public static void Param_Between_IsInclusive_AndOrderInsensitive()
        {
            ElementRecord r = WithParams(Rec(), P("Length", Len(3000)));
            Assert.True(M(QueryNode.Param("Length", ClauseOp.Between, "3000", "4000"), r));
            Assert.True(M(QueryNode.Param("Length", ClauseOp.Between, "2000", "3000"), r));
            Assert.True(M(QueryNode.Param("Length", ClauseOp.Between, "4000", "2000"), r), "урвуу дараалал");
            Assert.False(M(QueryNode.Param("Length", ClauseOp.Between, "3001", "4000"), r));
        }

        [Test]
        public static void Param_Missing_OnlyMatchesNotExists_NotNotEquals()
        {
            ElementRecord r = Rec();
            Assert.True(M(QueryNode.Param("Mark", ClauseOp.NotExists), r));
            Assert.False(M(QueryNode.Param("Mark", ClauseOp.Exists), r));
            Assert.False(M(QueryNode.Param("Mark", ClauseOp.NotEquals, "A"), r), "олдоогүй параметр NotEquals-д таарахгүй");
            Assert.False(M(QueryNode.Param("Mark", ClauseOp.Equals, "A"), r));
            Assert.False(M(QueryNode.Param("Mark", ClauseOp.IsEmpty), r));
        }

        [Test]
        public static void Param_EmptyVsMissing()
        {
            ElementRecord r = WithParams(Rec(), P("Mark", ParamValue.OfText("")), P("Comments", ParamValue.OfText("hello")));
            Assert.True(M(QueryNode.Param("Mark", ClauseOp.Exists), r));
            Assert.True(M(QueryNode.Param("Mark", ClauseOp.IsEmpty), r));
            Assert.False(M(QueryNode.Param("Mark", ClauseOp.NotEmpty), r));
            Assert.True(M(QueryNode.Param("Comments", ClauseOp.NotEmpty), r));
        }

        [Test]
        public static void Param_TextOps_OnNumericDisplay_AndYesNo()
        {
            ElementRecord r = WithParams(Rec(), P("Length", Len(3000)), P("Structural", ParamValue.OfNumber(1, "count", "Yes")));
            Assert.True(M(QueryNode.Param("Length", ClauseOp.Contains, "3000"), r));
            Assert.True(M(QueryNode.Param("Structural", ClauseOp.Equals, "Yes"), r), "Yes/No — текстээр");
            Assert.True(M(QueryNode.Param("Structural", ClauseOp.Equals, "1"), r), "Yes/No — тоогоор");
            Assert.False(M(QueryNode.Param("Structural", ClauseOp.Equals, "0"), r));
        }

        [Test]
        public static void Param_Scope_InstanceTypeAny()
        {
            ElementRecord r = Rec();
            r.TypeParams["Fire Rating"] = ParamValue.OfText("2 h");
            r.Params["Mark"] = ParamValue.OfText("W-1");
            r.TypeParams["Mark"] = ParamValue.OfText("TYPE-MARK");

            // Any: instance байвал instance, үгүй бол type.
            Assert.True(M(QueryNode.Param("Fire Rating", ClauseOp.Equals, "2 h"), r));
            Assert.True(M(QueryNode.Param("Mark", ClauseOp.Equals, "W-1"), r));
            Assert.False(M(QueryNode.Param("Mark", ClauseOp.Equals, "TYPE-MARK"), r), "instance давамгайлна");
            // Instance: type параметрийг ХАРАХГҮЙ.
            Assert.False(M(QueryNode.Param("Fire Rating", ClauseOp.Equals, "2 h", scope: ParamScope.Instance), r));
            Assert.True(M(QueryNode.Param("Fire Rating", ClauseOp.Exists, scope: ParamScope.Type), r));
            Assert.True(M(QueryNode.Param("Mark", ClauseOp.Equals, "TYPE-MARK", scope: ParamScope.Type), r));
            Assert.True(M(QueryNode.Param("Fire Rating", ClauseOp.NotExists, scope: ParamScope.Instance), r));
        }

        [Test]
        public static void Param_NameLookup_IsCaseInsensitive()
        {
            ElementRecord r = WithParams(Rec(), P("Unconnected Height", Len(2700)));
            Assert.True(M(QueryNode.Param("unconnected height", ClauseOp.GreaterOrEqual, "2700"), r));
        }

        /* ------------------------------ GROUPS ---------------------------- */

        [Test]
        public static void Group_And_Or_Nested()
        {
            ElementRecord wall200 = WithParams(Rec(type: "Generic - 200mm"), P("Length", Len(5000)));
            QueryNode q = QueryNode.Group(LogicOp.And,
                QueryNode.Clause(ClauseField.Level, ClauseOp.Equals, "Level 1"),
                QueryNode.Group(LogicOp.Or,
                    QueryNode.Clause(ClauseField.Type, ClauseOp.Contains, "300"),
                    QueryNode.Param("Length", ClauseOp.Greater, "4", unit: "m")));
            Assert.True(M(q, wall200));
            Assert.False(M(q, WithParams(Rec(type: "Generic - 200mm"), P("Length", Len(3000)))));
            Assert.False(M(q, WithParams(Rec(level: "Level 2", type: "x"), P("Length", Len(9000)))));
        }

        [Test]
        public static void Group_EmptyAnd_MatchesAll_EmptyOr_MatchesNone()
        {
            Assert.True(M(QueryNode.Group(LogicOp.And), Rec()));
            Assert.False(M(QueryNode.Group(LogicOp.Or), Rec()));
            Assert.True(QueryEvaluator.Matches(null, Rec()));
        }

        [Test]
        public static void Group_UnknownLogic_IsProblem_NotAnd()
        {
            var st = new EvalStats();
            var g = new QueryNode { Kind = "group", Op = LogicOp.Unknown, Children = { QueryNode.Clause(ClauseField.Level, ClauseOp.Equals, "Level 1") } };
            Assert.False(QueryEvaluator.Matches(g, Rec(), st));
            Assert.Eq(1, st.Problems);
        }

        [Test]
        public static void Node_UnknownKind_IsProblem()
        {
            var st = new EvalStats();
            Assert.False(QueryEvaluator.Matches(new QueryNode { Kind = "xor-from-the-future" }, Rec(), st));
            Assert.Eq(1, st.Problems);
        }

        /* ------------------------------ VALIDATE -------------------------- */

        [Test]
        public static void Validate_WholeModelWithoutCategory_IsError()
        {
            var q = new QueryDefinition { Scope = CountScope.WholeModel };
            List<QueryIssue> issues = QueryValidator.Validate(q);
            Assert.False(QueryValidator.IsRunnable(issues));
            q.Categories.Add("OST_Walls");
            Assert.True(QueryValidator.IsRunnable(QueryValidator.Validate(q)));
            Assert.True(QueryValidator.IsRunnable(QueryValidator.Validate(new QueryDefinition { Scope = CountScope.Selection })));
        }

        [Test]
        public static void Validate_CatchesBadClauses()
        {
            var q = new QueryDefinition { Categories = { "OST_Walls" } };
            q.Where.Children.Add(QueryNode.Param("Length", ClauseOp.Greater, "abc"));
            q.Where.Children.Add(QueryNode.Param("", ClauseOp.Equals, "x"));
            q.Where.Children.Add(QueryNode.Param("Area", ClauseOp.Greater, "5", unit: "parsec"));
            q.Where.Children.Add(QueryNode.Clause(ClauseField.Type, ClauseOp.Contains, ""));
            q.Where.Children.Add(QueryNode.Clause(ClauseField.Level, ClauseOp.Greater, "3"));
            q.Where.Children.Add(new QueryNode { Kind = "clause", Field = ClauseField.Unknown, Cmp = ClauseOp.Unknown });
            List<QueryIssue> issues = QueryValidator.Validate(q);
            Assert.False(QueryValidator.IsRunnable(issues));
            Assert.True(issues.Count(i => i.IsError) >= 6, "алдаа: " + issues.Count(i => i.IsError) + " " + string.Join("|", issues.Select(i => i.Message)));
        }

        [Test]
        public static void Validate_ValidQuery_NoErrors()
        {
            var q = new QueryDefinition { Categories = { "OST_Walls" } };
            q.Where.Children.Add(QueryNode.Param("Length", ClauseOp.Between, "2", "5", unit: "m"));
            q.Where.Children.Add(QueryNode.Clause(ClauseField.Level, ClauseOp.Equals, "Level 1"));
            q.GroupBy.Add(new GroupSpec { Field = GroupField.Type });
            Assert.True(QueryValidator.IsRunnable(QueryValidator.Validate(q)));
        }

        [Test]
        public static void Validate_GroupByParameter_NeedsName_AndUnknownFieldFails()
        {
            var q = new QueryDefinition { Categories = { "OST_Walls" } };
            q.GroupBy.Add(new GroupSpec { Field = GroupField.Parameter });
            q.GroupBy.Add(new GroupSpec { Field = GroupField.Unknown });
            Assert.Eq(2, QueryValidator.Validate(q).Count(i => i.IsError));
        }

        [Test]
        public static void Validate_EmptyOrGroup_IsWarningOnly()
        {
            var q = new QueryDefinition { Categories = { "OST_Walls" } };
            q.Where.Children.Add(QueryNode.Group(LogicOp.Or));
            List<QueryIssue> issues = QueryValidator.Validate(q);
            Assert.True(QueryValidator.IsRunnable(issues));
            Assert.Eq(1, issues.Count(i => !i.IsError));
        }

        [Test]
        public static void Validate_TooManyNodes_IsError()
        {
            var q = new QueryDefinition { Categories = { "OST_Walls" } };
            for (int i = 0; i < 250; i++) q.Where.Children.Add(QueryNode.Clause(ClauseField.Level, ClauseOp.Equals, "L" + i));
            Assert.False(QueryValidator.IsRunnable(QueryValidator.Validate(q)));
        }

        /* ------------------------------ PLANNER --------------------------- */

        [Test]
        public static void Plan_PushesOnlyTopLevelAndClauses()
        {
            var q = new QueryDefinition { Categories = { "OST_Walls", "ost_walls", "OST_Doors" } };
            q.Where.Children.Add(QueryNode.Clause(ClauseField.Level, ClauseOp.Equals, "Level 1"));
            q.Where.Children.Add(QueryNode.Param("Length", ClauseOp.Greater, "3", unit: "m", scope: ParamScope.Instance));
            q.Where.Children.Add(QueryNode.Param("Height", ClauseOp.Between, "2", "4", scope: ParamScope.Instance));
            q.Where.Children.Add(QueryNode.Param("TypeParam", ClauseOp.Greater, "1"));   // scope Any — түлхэхгүй
            q.Where.Children.Add(QueryNode.Group(LogicOp.Or,
                QueryNode.Clause(ClauseField.Level, ClauseOp.Equals, "Level 9"),
                QueryNode.Param("Length", ClauseOp.Less, "1", scope: ParamScope.Instance)));
            QueryPlan plan = QueryPlanner.Plan(q);
            Assert.Eq(2, plan.Categories.Count, "давхардал арилна");
            Assert.SeqEq(new[] { "Level 1" }, plan.LevelEquals);
            Assert.Eq(2, plan.NumericBounds.Count);
            NumericBound len = plan.NumericBounds.Single(b => b.Name == "Length");
            Assert.Near(3, len.Min.Value, 0);
            Assert.Null(len.Max);
            Assert.Eq("m", len.MinUnit);
            Assert.Null(len.MaxUnit);
            NumericBound h = plan.NumericBounds.Single(b => b.Name == "Height");
            Assert.Near(2, h.Min.Value, 0);
            Assert.Near(4, h.Max.Value, 0);
            Assert.Null(h.MinUnit);
            Assert.Null(h.MaxUnit);
        }

        /// <summary>Нэгж: тодорхой нэгж > утга дахь дагавар > null — `QueryEvaluator`-тай ИЖИЛ (хоосон/зайтай мөр нэгж БИШ).</summary>
        [Test]
        public static void Plan_UnitPrecedence_MatchesTheEvaluator_BlankUnitFallsBackToTheValueSuffix()
        {
            var q = new QueryDefinition { Categories = { "OST_Walls" } };
            // `c.Unit` = "" (хоосон мөр, null БИШ): урьд нь `""` нь `??`-ийг давж утга дахь «m» дагаврыг АЛДСАН.
            q.Where.Children.Add(QueryNode.Param("Length", ClauseOp.LessOrEqual, "5 m", unit: "", scope: ParamScope.Instance));
            q.Where.Children.Add(QueryNode.Param("Width", ClauseOp.Less, "2 m", unit: "   ", scope: ParamScope.Instance));
            q.Where.Children.Add(QueryNode.Param("Height", ClauseOp.Greater, "30 cm", unit: "mm", scope: ParamScope.Instance));   // тодорхой нэгж давамгайлна
            QueryPlan plan = QueryPlanner.Plan(q);
            Assert.Eq("m", plan.NumericBounds.Single(b => b.Name == "Length").MaxUnit, "хоосон нэгж → утга дахь дагавар");
            Assert.Eq("m", plan.NumericBounds.Single(b => b.Name == "Width").MaxUnit, "зайтай нэгж → утга дахь дагавар");
            Assert.Eq("mm", plan.NumericBounds.Single(b => b.Name == "Height").MinUnit, "тодорхой нэгж дагаврыг дарна");
            Assert.Eq(null, QueryPlanner.UnitOf(null, null));
            Assert.Eq(null, QueryPlanner.UnitOf("", "  "));
            Assert.Eq("cm", QueryPlanner.UnitOf(null, "cm"));
        }

        /// <summary>
        /// `Between` хязгаар бүр ӨӨРИЙН нэгжтэй, min/max-ыг нэгжээс ӨМНӨ сольж болохгүй: `50 cm`…`1 m` = [0.5, 1] м.  Урьд нь сүүлийн дагавар («m») хоёуланд
        /// нь хэрэглэгдэж (50 m…1 m) бас тоогоор (1 < 50) солигдож, native шүүлтүүр 0.7 м-ийн элементийг хасаж байв (суперсет БИШ).
        /// </summary>
        [Test]
        public static void Plan_Between_KeepsPerBoundUnits_AndDoesNotSwapBeforeConversion()
        {
            var q = new QueryDefinition { Categories = { "OST_Walls" } };
            q.Where.Children.Add(QueryNode.Param("Length", ClauseOp.Between, "50 cm", "1 m", scope: ParamScope.Instance));
            NumericBound b = QueryPlanner.Plan(q).NumericBounds.Single();
            Assert.Near(50, b.Min.Value, 0, "эхний утга — дээр нь хөрвүүлэхгүй, ЭХ хэвээр");
            Assert.Eq("cm", b.MinUnit);
            Assert.Near(1, b.Max.Value, 0, "сольсонгүй (1 < 50 боловч нэгж өөр)");
            Assert.Eq("m", b.MaxUnit);

            // Нэгжийг каноник руу хөрвүүлснээр зөв муж (мм): [500, 1000].
            double lo, hi;
            Assert.True(UnitCatalog.ToCanonical(b.Min.Value, b.MinUnit, "length", out lo));
            Assert.True(UnitCatalog.ToCanonical(b.Max.Value, b.MaxUnit, "length", out hi));
            Assert.Near(500, lo, 1e-9);
            Assert.Near(1000, hi, 1e-9);

            // Тодорхой нэгж хоёуланд (дагаврыг дарна).
            var q2 = new QueryDefinition { Categories = { "OST_Walls" } };
            q2.Where.Children.Add(QueryNode.Param("Length", ClauseOp.Between, "50 cm", "1 m", unit: "mm", scope: ParamScope.Instance));
            NumericBound b2 = QueryPlanner.Plan(q2).NumericBounds.Single();
            Assert.Eq("mm", b2.MinUnit);
            Assert.Eq("mm", b2.MaxUnit);

            // Утгын нэг нь тоо биш бол ямар ч хязгаар түлхэхгүй (суперсет — шүүлтүүргүй).
            var q3 = new QueryDefinition { Categories = { "OST_Walls" } };
            q3.Where.Children.Add(QueryNode.Param("Length", ClauseOp.Between, "50 cm", "abc", scope: ParamScope.Instance));
            Assert.Eq(0, QueryPlanner.Plan(q3).NumericBounds.Count);
        }

        /// <summary>Planner-ийн каноник хязгаар evaluator-ийн шийдвэрийн СУПЕРСЕТ (native шүүлтүүр таарах элементийг хасахгүй).</summary>
        [Test]
        public static void Plan_CanonicalBounds_AreASupersetOfTheEvaluator_ForMixedUnitBetween()
        {
            var q = new QueryDefinition { Categories = { "OST_Walls" } };
            q.Where.Children.Add(QueryNode.Param("Length", ClauseOp.Between, "50 cm", "1 m", scope: ParamScope.Instance));
            NumericBound b = QueryPlanner.Plan(q).NumericBounds.Single();
            double lo, hi;
            UnitCatalog.ToCanonical(b.Min.Value, b.MinUnit, "length", out lo);
            UnitCatalog.ToCanonical(b.Max.Value, b.MaxUnit, "length", out hi);
            if (hi < lo) { double t = lo; lo = hi; hi = t; }

            foreach (double mm in new[] { 499.9999995, 500, 700, 999.9999995, 1000 })
            {
                var rec = new ElementRecord { Category = "Walls" };
                rec.Params["Length"] = ParamValue.OfNumber(mm, "length", mm.ToString(System.Globalization.CultureInfo.InvariantCulture));
                bool evaluator = QueryEvaluator.Matches(q.Where, rec);
                bool nativeLike = mm >= lo - 1e-6 && mm <= hi + 1e-6;
                if (evaluator) Assert.True(nativeLike, "evaluator таарсан " + mm + " мм-ийг native хязгаар хасаж болохгүй");
            }
            Assert.True(QueryEvaluator.Matches(q.Where, RecWithLength(700)), "700 мм ∈ [500, 1000]");
            Assert.False(QueryEvaluator.Matches(q.Where, RecWithLength(1500)), "1500 мм мужаас гадуур");
        }

        private static ElementRecord RecWithLength(double mm)
        {
            var rec = new ElementRecord { Category = "Walls" };
            rec.Params["Length"] = ParamValue.OfNumber(mm, "length", mm.ToString(System.Globalization.CultureInfo.InvariantCulture));
            return rec;
        }

        /// <summary>Planner-ийн «тэлэлт» нь evaluator-ийн `Close` хүлцлээс ИХ байх ёстойг (талбай/эзлэхүүнд ч) тогтмол утгаар батална.</summary>
        [Test]
        public static void Evaluator_Tolerances_AreExposedForTheNativeWideningToBeDerivedFrom()
        {
            Assert.Eq(1e-6, QueryEvaluator.AbsTol);
            Assert.Eq(1e-9, QueryEvaluator.RelTol);
            // Эзлэхүүн: AbsTol 1e-6 м³ = 3.5e-5 фут³ — хуучин тогтмол `widen = 1e-5` (фут³) ЭНЭ хүлцлээс бага (суперсет БИШ) байсан.
            double ft3 = 1e-6 / 0.028316846592;
            Assert.True(ft3 > 1e-5, "хуучин 1e-5 нь эзлэхүүний хүлцлийг хамрахгүй: " + ft3);
        }

        /// <summary>Давхрын нэрийн нэгдсэн тодорхойлолт: trim + NFC + том/жижиг үсэг үл хамаарах (evaluator-той ижил).</summary>
        [Test]
        public static void LevelName_Normalization_MatchesTheEvaluator()
        {
            Assert.Eq(QueryEvaluator.Norm("Level 1", false), QueryEvaluator.Norm("  level 1 ", false));
            // «й» = U+0439 (precomposed) ↔ «и» + U+0306 (decomposed): NFC-ээр нэг болно.
            Assert.Eq(QueryEvaluator.Norm("Давхар Нэгдүгээр й", false), QueryEvaluator.Norm("Давхар Нэгдүгээр й", false));
            Assert.True(QueryEvaluator.Norm("A", true) != QueryEvaluator.Norm("a", true), "том/жижиг үсэг мэдэрдэг горимд ялгана");
        }

        [Test]
        public static void Plan_RootOr_PushesNothing()
        {
            var q = new QueryDefinition { Categories = { "OST_Walls" }, Where = QueryNode.Group(LogicOp.Or,
                QueryNode.Clause(ClauseField.Level, ClauseOp.Equals, "Level 1"),
                QueryNode.Param("Length", ClauseOp.Greater, "3", scope: ParamScope.Instance)) };
            QueryPlan plan = QueryPlanner.Plan(q);
            Assert.Eq(0, plan.LevelEquals.Count);
            Assert.Eq(0, plan.NumericBounds.Count);
        }

        [Test]
        public static void Plan_ParamNames_IncludeGroupByAndClauses_Distinct()
        {
            var q = new QueryDefinition { Categories = { "OST_Walls" } };
            q.Where.Children.Add(QueryNode.Param("Length", ClauseOp.Greater, "3"));
            q.Where.Children.Add(QueryNode.Group(LogicOp.Or, QueryNode.Param("length", ClauseOp.Less, "9"), QueryNode.Param("Mark", ClauseOp.Exists)));
            q.GroupBy.Add(new GroupSpec { Field = GroupField.Parameter, ParameterName = "Fire Rating" });
            q.GroupBy.Add(new GroupSpec { Field = GroupField.Type });
            Assert.SeqEq(new[] { "Fire Rating", "Length", "Mark" }, QueryPlanner.Plan(q).ParamNames);
        }

        /* ---------------------------- AGGREGATOR -------------------------- */

        private static List<ElementRecord> Sample()
        {
            var l = new List<ElementRecord>();
            for (int i = 0; i < 6; i++) l.Add(Rec("Walls", "Basic Wall", "W200", "Level 1", i));
            for (int i = 6; i < 9; i++) l.Add(Rec("Walls", "Basic Wall", "W300", "Level 2", i));
            for (int i = 9; i < 11; i++) l.Add(Rec("Doors", "Single", "D900", "Level 1", i));
            l.Add(Rec("Doors", "Single", null, null, 11));
            return l;
        }

        [Test]
        public static void Aggregate_Counts_Sorted_ByCountThenNatural()
        {
            var agg = new CountAggregator(new[] { new GroupSpec { Field = GroupField.Category }, new GroupSpec { Field = GroupField.Type } });
            foreach (ElementRecord r in Sample()) agg.Add(r);
            CountResult res = agg.Build();
            Assert.Eq(12, res.Total);
            Assert.Eq(12, res.Root.Count);
            Assert.SeqEq(new[] { "Walls", "Doors" }, res.Root.Children.Select(c => c.Label));
            CountGroup walls = res.Root.Children[0];
            Assert.Eq(9, walls.Count);
            Assert.SeqEq(new[] { "W200", "W300" }, walls.Children.Select(c => c.Label));
            Assert.Eq(6, walls.Children[0].Count);
            CountGroup doors = res.Root.Children[1];
            Assert.True(doors.Children.Any(c => c.Label == CountAggregator.EmptyLabel && c.Count == 1));
            Assert.Eq("Ангилал", res.Root.Children[0].FieldLabel);
            Assert.Eq("Төрөл", walls.Children[0].FieldLabel);
        }

        [Test]
        public static void Aggregate_NoGroups_AllRowsOnRoot()
        {
            var agg = new CountAggregator(null);
            foreach (ElementRecord r in Sample()) agg.Add(r);
            CountResult res = agg.Build();
            Assert.Eq(12, res.Total);
            Assert.Eq(12, res.Root.RowIndexes.Count);
            Assert.Eq(0, res.Root.Children.Count);
        }

        [Test]
        public static void Aggregate_RowsOf_CollectsLeavesRecursively()
        {
            var agg = new CountAggregator(new[] { new GroupSpec { Field = GroupField.Category }, new GroupSpec { Field = GroupField.Level } });
            foreach (ElementRecord r in Sample()) agg.Add(r);
            CountResult res = agg.Build();
            CountGroup walls = res.Root.Children.First(c => c.Label == "Walls");
            Assert.Eq(9, res.RowsOf(walls).Count);
            Assert.Eq(12, res.RowsOf(res.Root).Count);
        }

        [Test]
        public static void Aggregate_RowCap_KeepsExactCounts_FlagsTruncation()
        {
            var agg = new CountAggregator(new[] { new GroupSpec { Field = GroupField.Category } }, maxRows: 5);
            foreach (ElementRecord r in Sample()) agg.Add(r);
            CountResult res = agg.Build();
            Assert.Eq(12, res.Total, "нийт ЯГ хэвээр");
            Assert.Eq(9, res.Root.Children.First(c => c.Label == "Walls").Count, "бүлгийн тоо ЯГ хэвээр");
            Assert.Eq(5, res.Rows.Count);
            Assert.True(res.RowsTruncated);
            Assert.Eq(5, res.RowsOf(res.Root).Count);
        }

        [Test]
        public static void Aggregate_ByParameter_MissingEmptyAndValue()
        {
            var agg = new CountAggregator(new[] { new GroupSpec { Field = GroupField.Parameter, ParameterName = "Fire Rating" } });
            agg.Add(WithParams(Rec(id: 1), P("Fire Rating", ParamValue.OfText("2 h"))));
            agg.Add(WithParams(Rec(id: 2), P("Fire Rating", ParamValue.OfText("2 h"))));
            agg.Add(WithParams(Rec(id: 3), P("Fire Rating", ParamValue.OfText(""))));
            agg.Add(Rec(id: 4));
            CountResult res = agg.Build();
            Assert.SeqEq(new[] { "2 h", CountAggregator.MissingLabel, CountAggregator.EmptyLabel }, res.Root.Children.Select(c => c.Label), "тэнцүү тоотой бол нэрээр");
        }

        [Test]
        public static void Aggregate_NaturalLabelOrder_OnTies()
        {
            var agg = new CountAggregator(new[] { new GroupSpec { Field = GroupField.Level } });
            foreach (string lvl in new[] { "Level 10", "Level 2", "Level 1" }) agg.Add(Rec(level: lvl));
            Assert.SeqEq(new[] { "Level 1", "Level 2", "Level 10" }, agg.Build().Root.Children.Select(c => c.Label));
        }

        /* ------------------------------ GUARDS ---------------------------- */

        [Test]
        public static void Guards_Select_And_Show()
        {
            Assert.False(CountGuards.ForSelect(0).Allowed);
            Assert.True(CountGuards.ForSelect(10).Allowed && !CountGuards.ForSelect(10).NeedsConfirm);
            Assert.True(CountGuards.ForSelect(CountGuards.ConfirmSelectOver + 1).NeedsConfirm);
            Assert.False(CountGuards.ForSelect(CountGuards.MaxSelect + 1).Allowed);
            Assert.True(CountGuards.ForShow(CountGuards.MaxShow).Allowed);
            Assert.False(CountGuards.ForShow(CountGuards.MaxShow + 1).Allowed);
        }

        /* ------------------------------ STORE ----------------------------- */

        [Test]
        public static void SavedQueries_FirstLoad_SeedsStarters_Once()
        {
            var store = new SmartStore(TestDirs.NewTemp());
            SavedQueriesFile f = SavedQueryStore.Load(store);
            Assert.Eq(3, f.Queries.Count);
            foreach (QueryDefinition q in f.Queries.ToList()) SavedQueryStore.Delete(f, q.Id);
            SavedQueryStore.Save(f, store);
            Assert.Eq(0, SavedQueryStore.Load(store).Queries.Count);
        }

        [Test]
        public static void SavedQueries_RoundTrip_PreservesTreeAndEnums()
        {
            var store = new SmartStore(TestDirs.NewTemp());
            var f = new SavedQueriesFile();
            var q = new QueryDefinition { Name = "Хана > 3м", Categories = { "OST_Walls" }, Scope = CountScope.ActiveView };
            q.Where.Children.Add(QueryNode.Param("Length", ClauseOp.Greater, "3", unit: "m", scope: ParamScope.Instance));
            q.Where.Children.Add(QueryNode.Group(LogicOp.Or, QueryNode.Clause(ClauseField.Level, ClauseOp.Equals, "Level 1"), QueryNode.Clause(ClauseField.Level, ClauseOp.Equals, "Level 2")));
            q.GroupBy.Add(new GroupSpec { Field = GroupField.Parameter, ParameterName = "Fire Rating" });
            SavedQueryStore.Upsert(f, q);
            Assert.True(SavedQueryStore.Save(f, store));

            QueryDefinition back = SavedQueryStore.Load(store).Queries.Single(x => x.Id == q.Id);
            Assert.Eq("Хана > 3м", back.Name);
            Assert.Eq(CountScope.ActiveView, back.Scope);
            Assert.Eq(2, back.Where.Children.Count);
            QueryNode clause = back.Where.Children[0];
            Assert.Eq(ClauseOp.Greater, clause.Cmp);
            Assert.Eq(ParamScope.Instance, clause.Scope);
            Assert.Eq("m", clause.Unit);
            Assert.Eq(LogicOp.Or, back.Where.Children[1].Op);
            Assert.Eq(GroupField.Parameter, back.GroupBy[0].Field);
            Assert.True(QueryEvaluator.Matches(back.Where.Children[1], Rec(level: "Level 2")));
        }

        [Test]
        public static void SavedQueries_Upsert_BumpsVersionOnlyWhenContentChanges()
        {
            var f = new SavedQueriesFile();
            var q = new QueryDefinition { Categories = { "OST_Walls" } };
            SavedQueryStore.Upsert(f, q);
            QueryDefinition same = f.Queries[0].Clone();
            same.Name = "Нэр солив";
            SavedQueryStore.Upsert(f, same);
            Assert.Eq(1, f.Queries[0].Version, "нэр солих нь нөхцөл биш");
            QueryDefinition changed = f.Queries[0].Clone();
            changed.Where.Children.Add(QueryNode.Clause(ClauseField.Level, ClauseOp.Equals, "L1"));
            SavedQueryStore.Upsert(f, changed);
            Assert.Eq(2, f.Queries[0].Version);
        }

        [Test]
        public static void SavedQueries_FileFromFuture_WithUnknownEnums_StillLoads_ButIsNotRunnable()
        {
            string root = TestDirs.NewTemp();
            var store = new SmartStore(root);
            System.IO.File.WriteAllText(store.FullPath("queries.json"),
                "{\"schema\":1,\"payload\":{\"queries\":[{\"id\":\"q1\",\"name\":\"future\",\"categories\":[\"OST_Walls\"],"
                + "\"where\":{\"kind\":\"group\",\"op\":\"and\",\"children\":[{\"kind\":\"clause\",\"field\":\"parameter\",\"name\":\"Length\",\"cmp\":\"approximately\",\"value\":\"3\"}]}}]}}");
            QueryDefinition q = SavedQueryStore.Load(store).Queries.Single();
            Assert.Eq("future", q.Name);
            Assert.Eq(ClauseOp.Unknown, q.Where.Children[0].Cmp);
            Assert.False(QueryValidator.IsRunnable(QueryValidator.Validate(q)), "танигдаагүй үйлдэл бүхий асуулга ЯВАХ ёсгүй");
        }
    }

    internal static class QueryNodeTestExt
    {
        public static QueryNode Also(this QueryNode n, Action<QueryNode> act) { act(n); return n; }
    }
}
