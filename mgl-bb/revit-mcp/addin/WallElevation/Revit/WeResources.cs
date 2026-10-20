using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Revit
{
    /// <summary>
    /// Командын туршид ДАХИН ашиглах нөөц — НЭГ удаа цуглуулна (collector хана бүрт биш):
    /// зүсэлтийн харагдацын төрөл, харагдацын загвар (template), хүрээний хуудас (title block),
    /// бүх харагдацын нэр, хуудасны дугаар.
    /// </summary>
    internal sealed class WeResources
    {
        public readonly List<ViewFamilyType> SectionTypes = new List<ViewFamilyType>();
        /// <summary>Elevation төрлүүд (View → Elevation: «Building Elevation», «Interior Elevation», «Framing Elevation» …).</summary>
        public readonly List<ViewFamilyType> ElevationTypes = new List<ViewFamilyType>();
        /// <summary>Загвар биш давхрын план (Elevation маркер үүсгэхэд түвшин тус бүр нэг план хэрэгтэй).</summary>
        public readonly List<ViewPlan> FloorPlans = new List<ViewPlan>();
        public readonly List<View> Templates = new List<View>();
        public readonly List<FamilySymbol> TitleBlocks = new List<FamilySymbol>();
        public readonly HashSet<string> ViewNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        public readonly HashSet<string> SheetNumbers = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        /// <summary>Энэ хэрэгслийн үүсгэсэн харагдац + хуудас (Extensible Storage) — нэрс, загвартай НЭГ гүйлтээр уншсан.</summary>
        public readonly List<KeyValuePair<View, WeRecord>> Generated = new List<KeyValuePair<View, WeRecord>>();
        /// <summary>Шугаман хэмжээсийн төрлүүд (нэрээр эрэмбэлсэн).</summary>
        public readonly List<DimensionType> DimTypes = new List<DimensionType>();
        public readonly List<SpotDimensionType> SpotTypes = new List<SpotDimensionType>();
        public readonly List<FamilySymbol> KeynoteTypes = new List<FamilySymbol>();
        /// <summary>Legend харагдацууд (олон хуудсанд байрлуулж болдог цорын ганц харагдац) — материал, тэмдэглэгээний самбар.</summary>
        public readonly List<View> Legends = new List<View>();
        /// <summary>Түлхүүр планд — эхний «Floor Plan» төрөл.</summary>
        public ViewFamilyType FloorPlanType;
        /// <summary>3D харагдах байдалд — эхний 3D төрөл.</summary>
        public ViewFamilyType ThreeDType;
        /// <summary>Төслийн өөрийн дотор дэлгээсийн стандарт (оффисын хуудаснаас суралцсан) — «автомат» тохиргоонд хэрэглэгдэнэ.</summary>
        public WeProjectStandards Standards = new WeProjectStandards();
        /// <summary>Түлхүүр план / 3D-д хэрэглэх template (стандартаас; null = хэрэглэхгүй).</summary>
        public View KeyPlanTemplate;
        public View AxonTemplate;

        /// <summary>
        /// Хэрэгслийн өөрийн зүсэлтийн төрөл: Project Browser-т «Sections (Ханын дэлгээс)» бүлэг болж бусад зүсэлтээс
        /// тусдаа харагдана.  Тохиргоонд хоосон нэр = энэ төрөл (байхгүй бол эхний ажиллагаанд үүснэ).
        /// </summary>
        public const string OwnViewTypeName = "Ханын дэлгээс";
        /// <summary>Elevation төрлийн нэр зүсэлтийн «Ханын дэлгээс»-тэй давхцаж Revit татгалзвал (хуучин хувилбарын төрөл байгаа үед).</summary>
        public const string OwnElevationTypeAltName = "Ханын дэлгээс (Elevation)";

        public static WeResources Collect(Document doc)
        {
            var r = new WeResources();
            foreach (ViewFamilyType t in new FilteredElementCollector(doc).OfClass(typeof(ViewFamilyType)).Cast<ViewFamilyType>())
            {
                if (t.ViewFamily == ViewFamily.Section) r.SectionTypes.Add(t);
                else if (t.ViewFamily == ViewFamily.Elevation) r.ElevationTypes.Add(t);
                else if (t.ViewFamily == ViewFamily.FloorPlan && (r.FloorPlanType == null || string.CompareOrdinal(t.Name, r.FloorPlanType.Name) < 0)) r.FloorPlanType = t;
                else if (t.ViewFamily == ViewFamily.ThreeDimensional && (r.ThreeDType == null || string.CompareOrdinal(t.Name, r.ThreeDType.Name) < 0)) r.ThreeDType = t;
            }
            r.SectionTypes.Sort((a, b) => string.Compare(a.Name, b.Name, StringComparison.CurrentCulture));
            r.ElevationTypes.Sort((a, b) => string.Compare(a.Name, b.Name, StringComparison.CurrentCulture));

            Autodesk.Revit.DB.ExtensibleStorage.Schema schema = Autodesk.Revit.DB.ExtensibleStorage.Schema.Lookup(GeneratedElevationRepository.SchemaGuid);
            foreach (View v in new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>())
            {
                if (v.IsTemplate)
                {
                    // Зүсэлтэд хэрэглэж болох загвар: Section ба Elevation төрлийнх (бусдыг Revit татгалзана).
                    if (v.ViewType == ViewType.Section || v.ViewType == ViewType.Elevation) r.Templates.Add(v);
                    continue;
                }
                r.ViewNames.Add(v.Name);
                if (v.ViewType == ViewType.Legend) r.Legends.Add(v);
                var vp = v as ViewPlan;
                if (vp != null && vp.ViewType == ViewType.FloorPlan && vp.GenLevel != null) r.FloorPlans.Add(vp);
                if (schema != null)
                {
                    WeRecord rec = GeneratedElevationRepository.Read(v, schema);
                    if (rec != null && !string.IsNullOrEmpty(rec.Key)) r.Generated.Add(new KeyValuePair<View, WeRecord>(v, rec));
                }
                var sheet = v as ViewSheet;
                if (sheet != null && !string.IsNullOrEmpty(sheet.SheetNumber)) r.SheetNumbers.Add(sheet.SheetNumber);
            }
            r.Templates.Sort((a, b) => string.Compare(a.Name, b.Name, StringComparison.CurrentCulture));
            r.Legends.Sort((a, b) => string.Compare(a.Name, b.Name, StringComparison.CurrentCulture));

            foreach (DimensionType dt in new FilteredElementCollector(doc).OfClass(typeof(DimensionType)).Cast<DimensionType>())
            {
                DimensionStyleType st;
                try { st = dt.StyleType; } catch { continue; }
                var spot = dt as SpotDimensionType;
                if (spot != null && st == DimensionStyleType.SpotElevation) r.SpotTypes.Add(spot);
                else if (spot == null && st == DimensionStyleType.Linear && !string.IsNullOrEmpty(dt.Name)) r.DimTypes.Add(dt);
            }
            r.DimTypes.Sort((a, b) => string.Compare(a.Name, b.Name, StringComparison.CurrentCulture));
            r.SpotTypes.Sort((a, b) => string.Compare(a.Name, b.Name, StringComparison.CurrentCulture));
            foreach (FamilySymbol k in new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_KeynoteTags).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>())
                r.KeynoteTypes.Add(k);
            r.KeynoteTypes.Sort((a, b) => string.Compare(TitleBlockLabel(a), TitleBlockLabel(b), StringComparison.CurrentCulture));

            foreach (FamilySymbol s in new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_TitleBlocks)
                                          .OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>())
                r.TitleBlocks.Add(s);
            // Нүүр хуудасны хүрээ («Cover» — Snowdon-д том лого, бичвэр голдоо) ХАМГИЙН СҮҮЛД: өгөгдмөл нь энгийн зургийн хүрээ байх ёстой
            // (хэмжсэн: эхнийх нь «E1 30 x 42 Cover_Snowdon» сонгогдож перспективын байр логон дээр давхцав).
            r.TitleBlocks.Sort((a, b) =>
            {
                int c = IsCoverTitleBlock(a).CompareTo(IsCoverTitleBlock(b));
                return c != 0 ? c : string.Compare(TitleBlockLabel(a), TitleBlockLabel(b), StringComparison.CurrentCulture);
            });

            r.Standards = WeProjectStandards.Learn(doc);
            if (r.Standards.Found)
            {
                if (r.Standards.PlanType != null) r.FloorPlanType = r.Standards.PlanType;
                if (r.Standards.ThreeDType != null) r.ThreeDType = r.Standards.ThreeDType;
                r.KeyPlanTemplate = r.Standards.PlanTemplate;
                r.AxonTemplate = r.Standards.ThreeDTemplate;
            }
            return r;
        }

        public static bool IsCoverTitleBlock(FamilySymbol s)
        {
            string t = TitleBlockLabel(s);
            return t.IndexOf("cover", StringComparison.OrdinalIgnoreCase) >= 0 || t.IndexOf("нүүр", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        public static string TitleBlockLabel(FamilySymbol s)
        {
            return s == null ? string.Empty : s.FamilyName + " : " + s.Name;
        }

        /// <summary>
        /// Тохиргооны нэрээр төрөл.  Хоосон нэр = өөрийн «Ханын дэлгээс» төрөл; тэр байхгүй бол null + <paramref name="createOwn"/>
        /// (coordinator нэг удаа үүсгэнэ).  Нэрлэсэн төрөл устсан бол өөрийн төрөл рүү буцна.
        /// </summary>
        public ViewFamilyType ResolveViewType(WeSettings s, out bool createOwn)
        {
            createOwn = false;
            List<ViewFamilyType> types = TypesOf(s.ViewKind);
            // «Автомат» (хоосон нэр) + төслийн дотор дэлгээсийн стандарт байвал оффисын төрөл (маркер, гарчиг нь тэдний).
            if (string.IsNullOrWhiteSpace(s.ViewTypeName) && s.ViewKind == WeViewKind.Elevation && Standards.ElevationType != null
                && Standards.ElevationType.IsValidObject)
                return Standards.ElevationType;
            string want = string.IsNullOrWhiteSpace(s.ViewTypeName) ? OwnViewTypeName : s.ViewTypeName;
            ViewFamilyType t = types.FirstOrDefault(x => string.Equals(x.Name, want, StringComparison.Ordinal)) ?? OwnType(s.ViewKind);
            if (t != null) return t;
            createOwn = types.Count > 0;
            return null;
        }

        public List<ViewFamilyType> TypesOf(WeViewKind kind)
        {
            return kind == WeViewKind.Section ? SectionTypes : ElevationTypes;
        }

        /// <summary>Хэрэгслийн өөрийн төрөл (байвал).</summary>
        public ViewFamilyType OwnType(WeViewKind kind)
        {
            List<ViewFamilyType> types = TypesOf(kind);
            return types.FirstOrDefault(x => string.Equals(x.Name, OwnViewTypeName, StringComparison.Ordinal))
                   ?? (kind == WeViewKind.Elevation ? types.FirstOrDefault(x => string.Equals(x.Name, OwnElevationTypeAltName, StringComparison.Ordinal)) : null);
        }

        /// <summary>Өөрийн төрлийг хуулбарлах суурь: зүсэлт — «Section»; Elevation — «Interior Elevation», эсвэл «Building Elevation», эсвэл эхнийх.</summary>
        public ViewFamilyType BaseViewType(WeViewKind kind)
        {
            if (kind == WeViewKind.Section)
                return SectionTypes.FirstOrDefault(x => string.Equals(x.Name, "Section", StringComparison.OrdinalIgnoreCase)) ?? SectionTypes.FirstOrDefault();
            return ElevationTypes.FirstOrDefault(x => x.Name.IndexOf("Interior", StringComparison.OrdinalIgnoreCase) >= 0)
                   ?? ElevationTypes.FirstOrDefault(x => x.Name.IndexOf("Building", StringComparison.OrdinalIgnoreCase) >= 0)
                   ?? ElevationTypes.FirstOrDefault();
        }

        /// <summary>Цонхны жагсаалт: эхнийх нь өөрийн төрөл (тохиргоонд хоосон нэр), дараа нь тухайн төрлийн бусад харагдацын төрөл.</summary>
        public List<string> ViewTypeChoices(WeViewKind kind = WeViewKind.Elevation)
        {
            ViewFamilyType own = OwnType(kind);
            if (kind == WeViewKind.Elevation && Standards.ElevationType != null)
            {
                // Эхний мөр (хоосон нэр) = төслийн стандарт.
                var l2 = new List<string> { "‹Төслийн стандарт› " + Standards.ElevationType.Name };
                l2.AddRange(TypesOf(kind).Select(x => x.Name));
                return l2;
            }
            var list = new List<string> { own != null ? own.Name : OwnViewTypeName + " (шинээр үүснэ)" };
            list.AddRange(TypesOf(kind).Where(x => own == null || x.Id != own.Id).Select(x => x.Name));
            return list;
        }

        /// <summary>
        /// Elevation маркер үүсгэх план (<c>ElevationMarker.CreateElevation</c>-д заавал): ижил нэртэй түвшний давхрын план, эсвэл аль нэг
        /// давхрын план (маркер тэр планы түвшинд).  null = загварт давхрын план огт алга.
        /// </summary>
        public ViewPlan PlanForLevel(string levelName)
        {
            ViewPlan exact = FloorPlans.Where(v => v.IsValidObject && v.GenLevel != null && string.Equals(v.GenLevel.Name, levelName ?? string.Empty, StringComparison.Ordinal))
                                       .OrderBy(v => v.Id.Value).FirstOrDefault();
            return exact ?? FloorPlans.Where(v => v.IsValidObject).OrderBy(v => v.Id.Value).FirstOrDefault();
        }

        /// <summary>
        /// null = төрлийн өгөгдмөлийг хөндөхгүй; InvalidElementId = загваргүй; бусад = загварын id.
        /// Нэр нь олдохгүй бол null (өгөгдмөл) + <paramref name="missing"/> = true.
        /// </summary>
        public ElementId ResolveTemplate(WeSettings s, out bool missing)
        {
            missing = false;
            if (string.IsNullOrEmpty(s.TemplateName) || s.TemplateName == WeSettings.TemplateTypeDefault)
                return UsesStandardType(s) && Standards.ElevationTemplate != null && Standards.ElevationTemplate.IsValidObject ? Standards.ElevationTemplate.Id : null;
            if (s.TemplateName == WeSettings.TemplateNone) return ElementId.InvalidElementId;
            View t = Templates.FirstOrDefault(x => string.Equals(x.Name, s.TemplateName, StringComparison.Ordinal));
            if (t == null) { missing = true; return null; }
            return t.Id;
        }

        /// <summary>Сонгосон keynote төрөл; хоосон / олдохгүй бол файлын өгөгдмөл, эсвэл эхнийх.</summary>
        public FamilySymbol ResolveKeynoteType(WeSettings s)
        {
            FamilySymbol t = KeynoteTypes.FirstOrDefault(x => string.Equals(TitleBlockLabel(x), s.KeynoteTypeName, StringComparison.Ordinal));
            if (t != null) return t;
            if (KeynoteTypes.Count == 0) return null;
            // Төсөлд ХАМГИЙН ИХ хэрэглэгдсэн keynote шошго (MITIC: «Key-Түлхүүр,Тайлбар_BIMon : Стандарт» — жишээ дэлгээсүүдэд) — өгөгдмөл
            // төрөл нь ихэвчлэн Revit-ийн анхны «Keynote Tag : Keynote Number» (дугаар л харуулна).
            try
            {
                var used = new FilteredElementCollector(KeynoteTypes[0].Document).OfCategory(BuiltInCategory.OST_KeynoteTags)
                    .WhereElementIsNotElementType().Select(e => e.GetTypeId()).Where(id => id != null && id != ElementId.InvalidElementId)
                    .GroupBy(id => id.Value).OrderByDescending(g => g.Count()).ThenBy(g => g.Key).Select(g => g.Key).ToList();
                foreach (long id in used)
                {
                    FamilySymbol m = KeynoteTypes.FirstOrDefault(x => x.Id.Value == id);
                    if (m != null) return m;
                }
            }
            catch { /* тоолж чадахгүй — өгөгдмөлөөр */ }
            try
            {
                Document doc = KeynoteTypes[0].Document;
                ElementId def = doc.GetDefaultFamilyTypeId(new ElementId(BuiltInCategory.OST_KeynoteTags));
                FamilySymbol d = KeynoteTypes.FirstOrDefault(x => x.Id == def);
                if (d != null) return d;
            }
            catch { /* өгөгдмөлгүй */ }
            return KeynoteTypes[0];
        }

        /// <summary>Тохиргооны legend-үүд (нэрээр, сонгосон дарааллаар); олдоогүй нэр <paramref name="missing"/>-д.</summary>
        public List<View> ResolveLegends(WeSettings s, List<string> missing)
        {
            var r = new List<View>();
            foreach (string name in WeSettings.CleanLegends(s.LegendNames))
            {
                View v = Legends.FirstOrDefault(x => x.IsValidObject && string.Equals(x.Name, name, StringComparison.Ordinal));
                if (v != null) { if (!r.Any(x => x.Id == v.Id)) r.Add(v); }
                else if (missing != null) missing.Add(name);
            }
            return r;
        }

        /// <summary>Ижил бичлэгтэй БҮХ харагдац (хэрэглэгч хуулбал бичлэг дагаж ирдэг — давхардлыг илрүүлэхэд).</summary>
        public List<View> FindAllGenerated(string kind, string key)
        {
            return Generated.Where(kv => kv.Key.IsValidObject && kv.Value.Kind == kind && string.Equals(kv.Value.Key, key, StringComparison.Ordinal))
                            .Select(kv => kv.Key).ToList();
        }

        /// <summary>Энэ хэрэгслийн үүсгэсэн харагдац (бичлэгийн төрөл + түлхүүрээр) — түлхүүр план, 3D.</summary>
        public View FindGenerated(string kind, string key)
        {
            foreach (KeyValuePair<View, WeRecord> kv in Generated)
                if (kv.Key.IsValidObject && kv.Value.Kind == kind && string.Equals(kv.Value.Key, key, StringComparison.Ordinal)) return kv.Key;
            return null;
        }

        public FamilySymbol ResolveTitleBlock(WeSettings s)
        {
            FamilySymbol t = TitleBlocks.FirstOrDefault(x => string.Equals(TitleBlockLabel(x), s.TitleBlockName, StringComparison.Ordinal));
            if (t != null) return t;
            if (string.IsNullOrWhiteSpace(s.TitleBlockName) && Standards.TitleBlock != null && Standards.TitleBlock.IsValidObject) return Standards.TitleBlock;
            return TitleBlocks.FirstOrDefault();
        }

        /// <summary>Цонхны «Хүрээний хуудас» жагсаалтын эхний мөр (хоосон нэр = автомат).</summary>
        public string AutoTitleBlockLabel()
        {
            FamilySymbol t = Standards.TitleBlock ?? TitleBlocks.FirstOrDefault();
            return (Standards.TitleBlock != null ? "‹Төслийн стандарт› " : "‹Автомат› ") + (t != null ? TitleBlockLabel(t) : "-");
        }

        /// <summary>Тохиргоо «автомат» төрөлтэй бөгөөд төслийн стандарт төрөл хэрэглэгдэх үү.</summary>
        public bool UsesStandardType(WeSettings s)
        {
            return string.IsNullOrWhiteSpace(s.ViewTypeName) && s.ViewKind == WeViewKind.Elevation && Standards.ElevationType != null;
        }

        /// <summary>Харагдацын тохиргооны тэмдэг: өөрчлөгдвөл өмнө үүсгэсэн харагдац «шинэчлэх» болно.</summary>
        public string SetupToken(WeSettings s)
        {
            // Нэрээр (id биш): өөрийн төрөл ЭНЭ ажиллагаанд үүсэхэд дараагийн ажиллагааны тэмдэг өөрчлөгдөхгүй.
            // Төрөл (Elevation/Section) тэмдэгт ОРОХГҮЙ: өмнө зүсэлтээр үүссэн дэлгээс Elevation горимд ч зүсэлтээрээ хэвээр (хувиргахгүй) —
            // горим солиход бүх дэлгээс «шинэчлэгдэнэ» гэж худал харуулахгүй.
            string type = UsesStandardType(s) ? Standards.ElevationType.Name : string.IsNullOrWhiteSpace(s.ViewTypeName) ? OwnViewTypeName : s.ViewTypeName;
            bool missing;
            ElementId tpl = ResolveTemplate(s, out missing);
            string tplTok = tpl == null ? "default" : IdText(tpl);
            return "type:" + type + "|tpl:" + tplTok + "|scale:" + s.Scale.ToString(System.Globalization.CultureInfo.InvariantCulture);
        }

        public static string IdText(ElementId id)
        {
            return id == null ? "-" : id.Value.ToString(System.Globalization.CultureInfo.InvariantCulture);
        }
    }
}
