using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Serialization;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.SmartCount.Core
{
    /* ====================================================================== */
    /*  SMART COUNT — асуулгын загвар (Revit-гүй, JSON-д хадгалагдана)           */
    /*                                                                        */
    /*  ⚠️ Хадгалагддаг enum-ын 0 утга нь АЮУЛГҮЙ `Unknown`.  Танигдаагүй       */
    /*  үйлдэл/логик бүхий асуулга ЯВАХГҮЙ (`QueryValidator`) — чимээгүй «бусад  */
    /*  зүйл мэт» тайлбарлаж буруу тоо гаргахгүй.                              */
    /* ====================================================================== */

    public enum LogicOp { Unknown = 0, And, Or }

    public enum ClauseField
    {
        Unknown = 0,
        Category,
        Family,
        Type,
        Level,
        Parameter,
    }

    /// <summary>Параметрийг хаанаас хайх вэ.  `Any` = элементийн өөрийн (instance), байхгүй бол ТӨРЛИЙН (type) параметр.</summary>
    public enum ParamScope { Any = 0, Instance, Type }

    public enum ClauseOp
    {
        Unknown = 0,
        Equals,
        NotEquals,
        Contains,
        NotContains,
        StartsWith,
        EndsWith,
        Greater,
        GreaterOrEqual,
        Less,
        LessOrEqual,
        Between,
        /// <summary>Параметр байгаа (утга хоосон ч).</summary>
        Exists,
        NotExists,
        IsEmpty,
        NotEmpty,
    }

    public enum CountScope
    {
        /// <summary>Бүх загвар (ангилал заавал сонгоно).</summary>
        WholeModel = 0,
        ActiveView,
        Selection,
    }

    public enum GroupField { Unknown = 0, Category, Family, Type, Level, Parameter }

    /// <summary>
    /// Нөхцөлийн мод: `kind = "group"` (AND/OR + хүүхдүүд) эсвэл `kind = "clause"` (нэг нөхцөл).
    /// ЯАГААД ХАВТГАЙ (polymorphic БИШ) класс: танигдаагүй `kind`-тэй хуучин/шинэ файл бүхэл асуулгыг
    /// унагахгүй — зөвхөн тэр зангилаа «буруу» гэж тэмдэглэгдэнэ.
    /// </summary>
    public sealed class QueryNode
    {
        public string Kind { get; set; }

        // group
        public LogicOp Op { get; set; }
        public List<QueryNode> Children { get; set; } = new List<QueryNode>();

        // clause
        public ClauseField Field { get; set; }
        /// <summary>`Field = Parameter` үед параметрийн нэр.</summary>
        public string Name { get; set; }
        public ParamScope Scope { get; set; }
        public ClauseOp Cmp { get; set; }
        public string Value { get; set; }
        public string Value2 { get; set; }
        /// <summary>Тоон утгын нэгж (`mm`, `m2`...).  Хоосон = параметрийн анхдагч (урт → мм, талбай → м², эзлэхүүн → м³, өнцөг → °).</summary>
        public string Unit { get; set; }
        public bool CaseSensitive { get; set; }

        [JsonIgnore]
        public bool IsGroup { get { return string.Equals(Kind, "group", StringComparison.OrdinalIgnoreCase); } }

        [JsonIgnore]
        public bool IsClause { get { return string.Equals(Kind, "clause", StringComparison.OrdinalIgnoreCase); } }

        public static QueryNode Group(LogicOp op, params QueryNode[] children)
        {
            return new QueryNode { Kind = "group", Op = op, Children = children.ToList() };
        }

        public static QueryNode Clause(ClauseField field, ClauseOp cmp, string value = null, string name = null,
            string value2 = null, string unit = null, ParamScope scope = ParamScope.Any)
        {
            return new QueryNode { Kind = "clause", Field = field, Cmp = cmp, Value = value, Name = name, Value2 = value2, Unit = unit, Scope = scope };
        }

        public static QueryNode Param(string name, ClauseOp cmp, string value = null, string value2 = null, string unit = null, ParamScope scope = ParamScope.Any)
        {
            return Clause(ClauseField.Parameter, cmp, value, name, value2, unit, scope);
        }
    }

    public sealed class GroupSpec
    {
        public GroupField Field { get; set; }
        /// <summary>`Field = Parameter` үед параметрийн нэр.</summary>
        public string ParameterName { get; set; }

        public string Label
        {
            get
            {
                switch (Field)
                {
                    case GroupField.Category: return "Ангилал";
                    case GroupField.Family: return "Гэр бүл";
                    case GroupField.Type: return "Төрөл";
                    case GroupField.Level: return "Давхар";
                    case GroupField.Parameter: return ParameterName ?? "Параметр";
                    default: return "?";
                }
            }
        }
    }

    public sealed class QueryDefinition
    {
        public string Id { get; set; } = SmartHash.NewId();
        public string Name { get; set; } = "Шинэ хайлт";
        public int Version { get; set; } = 1;
        public CountScope Scope { get; set; }
        /// <summary>Ангилал — `OST_Walls` гэх мэт BuiltInCategory нэр (хэл сольсон ч тогтвортой).</summary>
        public List<string> Categories { get; set; } = new List<string>();
        /// <summary>true = элементийн ТӨРӨЛ (family type)-ийг тоолно, үгүй бол байрлуулсан элементийг.</summary>
        public bool CountTypes { get; set; }
        public QueryNode Where { get; set; } = QueryNode.Group(LogicOp.And);
        public List<GroupSpec> GroupBy { get; set; } = new List<GroupSpec>();

        public QueryDefinition Clone()
        {
            return SmartJson.Deserialize<QueryDefinition>(SmartJson.Serialize(this));
        }
    }

    public sealed class SavedQueriesFile
    {
        public List<QueryDefinition> Queries { get; set; } = new List<QueryDefinition>();
        public string LastQueryId { get; set; }
    }

    /* ---------------------------------------------------------------------- */
    /*  Revit-ээс ХУУЛСАН элемент (detached)                                   */
    /* ---------------------------------------------------------------------- */

    /// <summary>
    /// Параметрийн утга.  Тоон параметрийн `Number` нь ҮРГЭЛЖ каноник нэгжээр:
    /// урт → мм, талбай → м², эзлэхүүн → м³, өнцөг → °; бусад (даралт, урсгал...) → ТӨСЛИЙН нэгж.
    /// Revit-ийн дотоод (фут) утгыг энд ХЭЗЭЭ Ч дамжуулахгүй — «метрийн утгыг дотоод double-тэй
    /// шууд харьцуулах» алдааг бүтцээр хаана.
    /// </summary>
    public sealed class ParamValue
    {
        public bool Exists { get; set; }
        /// <summary>Хоосон биш утга байгаа (`Parameter.HasValue` ба хоосон мөр биш).</summary>
        public bool HasValue { get; set; }
        public string Text { get; set; }
        public bool IsNumeric { get; set; }
        public double Number { get; set; }
        /// <summary>`length` | `area` | `volume` | `angle` | `count` | `other` — каноник нэгжийг тодорхойлно.</summary>
        public string Family { get; set; }

        public static ParamValue Missing = new ParamValue();

        public static ParamValue OfText(string text)
        {
            bool has = !string.IsNullOrWhiteSpace(text);
            return new ParamValue { Exists = true, HasValue = has, Text = text };
        }

        public static ParamValue OfNumber(double value, string family, string display)
        {
            return new ParamValue { Exists = true, HasValue = true, IsNumeric = true, Number = value, Family = family, Text = display };
        }
    }

    public sealed class ElementRecord
    {
        /// <summary>Энэ session-д л (`ElementId.Value`).  Сонгох/харуулахад.</summary>
        public long ElementIdValue { get; set; }
        public string UniqueId { get; set; }
        public string Category { get; set; }
        public string Family { get; set; }
        public string Type { get; set; }
        public string Level { get; set; }
        /// <summary>Асуулгад ШААРДЛАГАТАЙ ӨӨРИЙН (instance) параметрийн нэр → утга (нэр үсгийн том/жижгийг үл хамаарна).</summary>
        public Dictionary<string, ParamValue> Params { get; set; } = new Dictionary<string, ParamValue>(StringComparer.OrdinalIgnoreCase);
        /// <summary>Асуулгад шаардлагатай ТӨРЛИЙН (type) параметрийн нэр → утга.</summary>
        public Dictionary<string, ParamValue> TypeParams { get; set; } = new Dictionary<string, ParamValue>(StringComparer.OrdinalIgnoreCase);

        /// <summary>`Any` = өөрийн (instance) параметр, БАЙХГҮЙ бол төрлийн (type) параметр.</summary>
        public ParamValue Param(string name)
        {
            return Param(name, ParamScope.Any);
        }

        public ParamValue Param(string name, ParamScope scope)
        {
            if (string.IsNullOrEmpty(name)) return ParamValue.Missing;
            ParamValue v;
            switch (scope)
            {
                case ParamScope.Instance:
                    return Params.TryGetValue(name, out v) ? v : ParamValue.Missing;
                case ParamScope.Type:
                    return TypeParams.TryGetValue(name, out v) ? v : ParamValue.Missing;
                default:
                    if (Params.TryGetValue(name, out v) && v.Exists) return v;
                    return TypeParams.TryGetValue(name, out v) ? v : ParamValue.Missing;
            }
        }
    }

    /* ---------------------------------------------------------------------- */
    /*  Үр дүн                                                                 */
    /* ---------------------------------------------------------------------- */

    public sealed class CountGroup
    {
        public string Label { get; set; }
        public int Count { get; set; }
        /// <summary>Энэ бүлгийн (түвшний) тайлбар: «Ангилал», «Давхар»...</summary>
        public string FieldLabel { get; set; }
        public List<CountGroup> Children { get; set; } = new List<CountGroup>();
        /// <summary>Навч бүлэгт: `CountResult.Rows` дахь индексүүд (rows хязгаарт хүрсэн бол дутуу).</summary>
        public List<int> RowIndexes { get; set; } = new List<int>();
    }

    public sealed class CountResult
    {
        public string QueryId { get; set; }
        public string QueryName { get; set; }
        public int Total { get; set; }
        public CountGroup Root { get; set; } = new CountGroup { Label = "Нийт" };
        public List<ElementRecord> Rows { get; set; } = new List<ElementRecord>();
        /// <summary>Мөрийн хязгаарт хүрсэн — `Total` ба бүлгийн тоо ТОВЧГҮЙ, харин drill-down жагсаалт дутуу.</summary>
        public bool RowsTruncated { get; set; }
        public int Candidates { get; set; }
        public Dictionary<string, long> StageMs { get; set; } = new Dictionary<string, long>();
        public List<string> Notes { get; set; } = new List<string>();
        public DateTime ComputedUtc { get; set; }
        /// <summary>Тооцоолох үеийн загварын өөрчлөлтийн тэмдэг — одоогийнхтой тулгаж «хуучирсан» эсэхийг шийднэ.</summary>
        public string ModelStamp { get; set; }

        /// <summary>Бүлэг (мод)-ийн бүх навчны мөрүүд.</summary>
        public List<ElementRecord> RowsOf(CountGroup g)
        {
            var list = new List<ElementRecord>();
            Collect(g, list);
            return list;
        }

        private void Collect(CountGroup g, List<ElementRecord> into)
        {
            foreach (int i in g.RowIndexes) if (i >= 0 && i < Rows.Count) into.Add(Rows[i]);
            foreach (CountGroup c in g.Children) Collect(c, into);
        }
    }
}
