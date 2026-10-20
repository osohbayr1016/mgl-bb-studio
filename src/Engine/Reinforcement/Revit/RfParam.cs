using System;
using System.Collections.Generic;
using Autodesk.Revit.DB;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement
{
    /// <summary>
    /// Параметрыг ТАНИХ ТЭМДЭГ (ElementId)-аар уншина — харагдах (орчуулагддаг) нэрээр БИШ.  Mongolian/English
    /// Revit-д «Partition» өөр нэртэй байж болох тул нэрээр хайвал буруу.
    /// </summary>
    internal static class RfParam
    {
        /// <summary>
        /// Арматурын «Partition» параметр = ЗӨВХӨН <c>NUMBER_PARTITION_PARAM</c> (RevitAPI.xml: "Partition").
        /// ⚠️ <c>ELEM_PARTITION_PARAM</c> нь «Workset» (RevitAPI.xml: "Workset") — Partition БИШ тул хэзээ ч нэр дэвшигч болгохгүй,
        /// эс бөгөөс workset-ийн нэрсийг «Partition» гэж жагсааж, түүвэрт workset-ээр шүүх болно.
        /// </summary>
        public static readonly BuiltInParameter[] PartitionCandidates =
        {
            BuiltInParameter.NUMBER_PARTITION_PARAM,
        };

        public static bool IsBuiltIn(ElementId id)
        {
            return id != null && id != ElementId.InvalidElementId && id.Value < 0;
        }

        public static bool IsPartitionCandidate(ElementId id)
        {
            if (!IsBuiltIn(id)) return false;
            foreach (BuiltInParameter b in PartitionCandidates)
            {
                if (id.Value == (long)(int)b) return true;
            }
            return false;
        }

        public static string BuiltInName(ElementId id)
        {
            if (!IsBuiltIn(id)) return null;
            try { return ((BuiltInParameter)(int)id.Value).ToString(); }
            catch { return null; }
        }

        /// <summary>Элементээс параметрийг ElementId-аар авна (built-in / shared / project).</summary>
        public static Parameter Get(Document doc, Element e, ElementId paramId)
        {
            if (e == null || paramId == null || paramId == ElementId.InvalidElementId) return null;
            try
            {
                if (IsBuiltIn(paramId))
                    return e.get_Parameter((BuiltInParameter)(int)paramId.Value);

                Element pe = doc.GetElement(paramId);
                SharedParameterElement sp = pe as SharedParameterElement;
                if (sp != null)
                    return e.get_Parameter(sp.GuidValue);
                ParameterElement pm = pe as ParameterElement;
                if (pm != null)
                {
                    InternalDefinition def = pm.GetDefinition();
                    return def == null ? null : e.LookupParameter(def.Name);
                }
            }
            catch
            {
                // Энэ элемент энэ параметрийг дэмждэггүй — «байхгүй».
            }
            return null;
        }

        /// <summary>Параметрийн утгыг мөр болгоно; хоосон/утгагүй бол null.</summary>
        public static string Text(Parameter p)
        {
            if (p == null || !p.HasValue) return null;
            switch (p.StorageType)
            {
                case StorageType.String:
                    return p.AsString();
                case StorageType.Integer:
                case StorageType.Double:
                case StorageType.ElementId:
                    return p.AsValueString();
                default:
                    return null;
            }
        }

        /// <summary>Загвар дахь БҮХ арматур (Rebar ангилал) — геометр уншихгүй, хөнгөн.</summary>
        public static FilteredElementCollector AllRebars(Document doc)
        {
            return new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Rebar).WhereElementIsNotElementType();
        }

        /// <summary>
        /// Загварын БҮХ арматурыг НЭГ удаа (нэг global collector) уншсан дүн: арматур бүрийн <c>NUMBER_PARTITION_PARAM</c> утга.
        /// Partition-ийн индекс, параметрийн сонголт хоёулаа ЭНЭ ганц scan-аас — Partition бүрт дахин scan хийхгүй
        /// (O(арматур), O(Partition × арматур) БИШ).
        /// </summary>
        public sealed class PartitionScan
        {
            public int Rebars;

            /// <summary>Арматур бүрийн NUMBER_PARTITION_PARAM утга (параметр байхгүй/хоосон бол null) — арматурын дарааллаар.</summary>
            public readonly List<string> Number = new List<string>();

            public int NumberNonBlank;

            /// <summary>Partition параметр арматурын аль нэгэнд ч утгатай эсэх.</summary>
            public RfPartitionParam Choice
            {
                get { return RfPartitionChoice.Choose(NumberNonBlank); }
            }

            /// <summary>NUMBER_PARTITION_PARAM — арматур дээр утга байвал; үгүй бол null.</summary>
            public BuiltInParameter? Chosen
            {
                get { return Choice == RfPartitionParam.Number ? (BuiltInParameter?)BuiltInParameter.NUMBER_PARTITION_PARAM : null; }
            }

            /// <summary>Тухайн built-in-ийн утгууд (scan-д ороогүй параметр бол null).</summary>
            public IList<string> ValuesOf(ElementId paramId)
            {
                if (paramId == null || !IsBuiltIn(paramId)) return null;
                if (paramId.Value == (long)(int)BuiltInParameter.NUMBER_PARTITION_PARAM) return Number;
                return null;
            }
        }

        /// <summary>
        /// ⚠️ ЭНЭ нь Partition-ийн ГАНЦ global scan: <c>FilteredElementCollector(OST_Rebar)</c>-ыг НЭГ удаа явж, арматур бүрээс хоёр
        /// built-in-ийг уншина (параметр унших нь геометр биш — хөнгөн).
        /// </summary>
        public static PartitionScan ScanPartitions(Document doc)
        {
            var scan = new PartitionScan();
            foreach (Element e in AllRebars(doc))
            {
                scan.Rebars++;
                string n = ReadBuiltInText(e, BuiltInParameter.NUMBER_PARTITION_PARAM);
                scan.Number.Add(n);
                if (!string.IsNullOrWhiteSpace(n)) scan.NumberNonBlank++;
            }
            return scan;
        }

        private static string ReadBuiltInText(Element e, BuiltInParameter b)
        {
            try { return Text(e.get_Parameter(b)); }
            catch { return null; }
        }
    }
}
