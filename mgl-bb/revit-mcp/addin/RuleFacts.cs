using System;
using System.Collections.Generic;

namespace RevitMcpAddin
{
    /// <summary>
    /// `2-2` §3.8 нь зөвхөн ТООН `Quantity`-г тодорхойлсон, гэтэл дүрмүүд МӨР
    /// баримт БАС харьцуулдаг (`element.category eq "Rooms"`).  Тиймээс
    /// `Quantity`-г БҮРЭН ХЭВЭЭР үлдээж, түүнийг АГУУЛАХ `FactValue` нэмэв
    /// (Хавсралт §4.1).
    /// </summary>
    internal enum RuleFactKind
    {
        Missing = 0,
        Number = 1,
        Text = 2,
    }

    internal struct FactValue
    {
        public RuleFactKind Kind;
        public Quantity Num;
        public string Text;

        internal static FactValue Missing()
        {
            FactValue v = new FactValue();
            v.Kind = RuleFactKind.Missing;
            v.Num = Quantity.Absent();
            return v;
        }

        internal static FactValue OfText(string text)
        {
            if (string.IsNullOrEmpty(text)) return Missing();
            FactValue v = new FactValue();
            v.Kind = RuleFactKind.Text;
            v.Text = text;
            return v;
        }

        internal static FactValue OfNumber(Quantity q)
        {
            if (q.Missing) return Missing();
            FactValue v = new FactValue();
            v.Kind = RuleFactKind.Number;
            v.Num = q;
            return v;
        }
    }

    /// <summary>
    /// ⚠️ `null` = «мэдэхгүй», «үгүй» БИШ.  Тэр ялгаа нь `OpensHighRiseDocumentSet`
    /// нь `false` биш «мэдэхгүй» буцаадгийн БҮХ шалтгаан.
    ///
    /// ⚠️ `StoriesAboveGrade` нь `double?`, `int?` БИШ: `FactValue` бүх тоог
    /// `double`-аар авдаг тул `int` рүү хөрвүүлэх цэг бүр нь TS ↔ C#
    /// паритетын зөрүү үүсгэх боломж.  ХЭЗЭЭ Ч бүхэл болгож дугуйруулахгүй.
    ///
    /// ⚠️ TS тал нь энэ төрлийг `BuildContext` гэж нэрлэдэг.  ХОЁР НЭР, НЭГ
    /// ХЭЛБЭР — гурав дахь нэр ЗОХИОХГҮЙ (Хавсралт §3).
    /// </summary>
    internal sealed class ProjectBuildContext
    {
        public int ProjectId;
        public string DocUid;

        public string BuildingType;
        public string OccupancyClass;
        public double? OccupantLoad;
        public double? GrossAreaM2;

        /// <summary>⚠️ ЯЛГАВАР (дээд давхрын түвшин − газрын түвшний давхар),
        /// ҮНЭМЛЭХҮЙ БИШ.  `Level.ProjectElevation` нь shared coordinate дээр
        /// Улаанбаатарын ~1300 м газрын өндрийг агуулж болно.</summary>
        public double? HeightM;
        public string HeightBasis;
        public string GradeLevelName;
        public string TopLevelName;

        public double? StoriesAboveGrade;
        public double? StoriesBelowGrade;

        public string Jurisdiction;
        public string ProjectPhase;
        public string FireSafetyClass;
        public string SeismicIntensity;
        /// <summary>АВТОРЛОСОН утга.  АМЬД баримтын `doc.room_boundary_location`
        /// нь үүнийг ДАРНА (Хавсралт §4.4-ийн 3 > 4).</summary>
        public string RoomBoundaryLocation;

        public string[] SpecialRequirements;

        internal static ProjectBuildContext Empty()
        {
            ProjectBuildContext c = new ProjectBuildContext();
            c.ProjectId = 0;
            c.DocUid = "";
            c.HeightBasis = "unknown";
            c.Jurisdiction = "MN";
            c.SpecialRequirements = new string[0];
            return c;
        }
    }

    /// <summary>Нэг баримтыг шийдсэн үр дүн + илэрсэн асуудал.</summary>
    internal struct FactResolution
    {
        public FactValue Value;
        /// <summary>null | "mixed_units" | "mixed_provenance"</summary>
        public string Problem;
    }

    /// <summary>
    /// ШИЙДЭХ ДАРААЛАЛ (Хавсралт §4.4, ХОЁР ТАЛД ИЖИЛ, өөрчилж БОЛОХГҮЙ):
    ///   1. `element.category` → `DirtyElement.Category`  (Revit уншихаас ӨМНӨ)
    ///   2. `element.*`        → `collect_rule_inputs`-ийн `facts[uid][local]`
    ///   3. `doc.*`            → хариултын `doc[local]`   (АМЬД баримтын утга)
    ///   4. `doc.*`            → `ProjectBuildContext`-ийн толин тусгал
    ///   5. `project.*`        → `ProjectBuildContext`
    ///   —  аль нь ч биш      → Missing
    ///
    /// ⚠️ НЭГЖИЙН ТУЛГАЛТ нь ЭНД болно.  Зөрвөл `Quantity.RequireSame` шидэж,
    /// `Problem = "mixed_units"` болно — ЧИМЭЭГҮЙ ХӨРВҮҮЛЭЛТ БАЙХГҮЙ.
    /// </summary>
    internal sealed class FactBag
    {
        private readonly ProjectBuildContext _ctx;
        private readonly Dictionary<string, FactValue> _doc;
        private readonly Dictionary<string, FactValue> _element;
        private readonly string _dirtyCategory;

        internal FactBag(
            ProjectBuildContext ctx,
            Dictionary<string, FactValue> doc,
            Dictionary<string, FactValue> element,
            string dirtyCategory)
        {
            _ctx = ctx;
            _doc = doc ?? new Dictionary<string, FactValue>(StringComparer.Ordinal);
            _element = element ?? new Dictionary<string, FactValue>(StringComparer.Ordinal);
            _dirtyCategory = dirtyCategory;
        }

        internal FactResolution Resolve(string name)
        {
            FactValue raw = Raw(name);
            FactResolution r = new FactResolution();
            r.Value = raw;
            r.Problem = null;
            if (raw.Kind != RuleFactKind.Number) return r;

            string expected = Units.ForFactName(name);
            try
            {
                Quantity.RequireSame(expected, raw.Num.Unit);
            }
            catch (UnitMismatchException)
            {
                r.Value = FactValue.Missing();
                r.Problem = "mixed_units";
                return r;
            }

            if (!Quantity.ConversionAllowed(raw.Num.Source, raw.Num.SpecId))
            {
                r.Value = FactValue.Missing();
                r.Problem = "mixed_provenance";
            }
            return r;
        }

        private FactValue Raw(string name)
        {
            if (string.Equals(name, "element.category", StringComparison.Ordinal))
            {
                FactValue fromDirty = FactValue.OfText(_dirtyCategory);
                if (fromDirty.Kind != RuleFactKind.Missing) return fromDirty;
            }
            string local = Units.LocalName(name);
            FactValue hit;
            if (name.StartsWith("element.", StringComparison.Ordinal))
            {
                return _element.TryGetValue(local, out hit) ? hit : FactValue.Missing();
            }
            if (name.StartsWith("doc.", StringComparison.Ordinal))
            {
                if (_doc.TryGetValue(local, out hit) && hit.Kind != RuleFactKind.Missing) return hit;
                if (_ctx != null && string.Equals(local, "room_boundary_location", StringComparison.Ordinal))
                {
                    return FactValue.OfText(_ctx.RoomBoundaryLocation);
                }
                return FactValue.Missing();
            }
            if (name.StartsWith("project.", StringComparison.Ordinal) && _ctx != null)
            {
                return FromContext(local);
            }
            return FactValue.Missing();
        }

        private FactValue FromContext(string local)
        {
            switch (local)
            {
                case "height_m": return Num(_ctx.HeightM, "project.height_m");
                case "stories_above_grade": return Num(_ctx.StoriesAboveGrade, "project.stories_above_grade");
                case "stories_below_grade": return Num(_ctx.StoriesBelowGrade, "project.stories_below_grade");
                case "gross_area_m2": return Num(_ctx.GrossAreaM2, "project.gross_area_m2");
                case "occupant_load": return Num(_ctx.OccupantLoad, "project.occupant_load");
                case "building_type": return FactValue.OfText(_ctx.BuildingType);
                case "occupancy_class": return FactValue.OfText(_ctx.OccupancyClass);
                case "project_phase": return FactValue.OfText(_ctx.ProjectPhase);
                case "jurisdiction": return FactValue.OfText(_ctx.Jurisdiction);
                case "fire_safety_class": return FactValue.OfText(_ctx.FireSafetyClass);
                case "seismic_intensity": return FactValue.OfText(_ctx.SeismicIntensity);
                default: return FactValue.Missing();
            }
        }

        private static FactValue Num(double? value, string name)
        {
            if (!value.HasValue || double.IsNaN(value.Value) || double.IsInfinity(value.Value))
            {
                return FactValue.Missing();
            }
            return FactValue.OfNumber(
                Quantity.Of(value.Value, Units.ForFactName(name), QuantitySource.Computed, null));
        }
    }
}
