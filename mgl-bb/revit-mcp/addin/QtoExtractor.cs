using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;

namespace RevitMcpAddin
{
    /// <summary>
    /// Result of one extraction: the payload ready to POST plus stats for the
    /// confirmation dialog.
    /// </summary>
    public class QtoExtractionResult
    {
        public QtoPayload Payload { get; set; }
        public int ElementCount { get; set; }
        public int RowCount { get; set; }
        public int MaterialsWithoutDensity { get; set; }
        public List<KeyValuePair<string, int>> TopCategories { get; set; }
    }

    /// <summary>
    /// Read-only aggregated quantity take-off over the active document.
    /// Загварыг огт өөрчлөхгүй — Transaction нээхгүй.
    /// </summary>
    public static class QtoExtractor
    {
        private const string NoLevelName = "(түвшингүй)";
        private const string NoMaterialName = "(материалгүй)";
        private const int TopCategoryCount = 15;
        private const int HostRecursionCap = 3;

        private static readonly BuiltInParameter[] LevelParams =
        {
            BuiltInParameter.FAMILY_LEVEL_PARAM,
            BuiltInParameter.SCHEDULE_LEVEL_PARAM,
            BuiltInParameter.INSTANCE_REFERENCE_LEVEL_PARAM,
            BuiltInParameter.INSTANCE_SCHEDULE_ONLY_LEVEL_PARAM,
            BuiltInParameter.WALL_BASE_CONSTRAINT,
            BuiltInParameter.LEVEL_PARAM,
            BuiltInParameter.ROOF_BASE_LEVEL_PARAM,
            BuiltInParameter.STAIRS_BASE_LEVEL_PARAM,
        };

        private static readonly BuiltInParameter[] LengthParams =
        {
            BuiltInParameter.CURVE_ELEM_LENGTH,
            BuiltInParameter.STRUCTURAL_FRAME_CUT_LENGTH,
            BuiltInParameter.INSTANCE_LENGTH_PARAM,
        };

        private sealed class Agg
        {
            public int Count;
            public double LengthM;
            public bool HasLength;
            public double AreaM2;
            public bool HasArea;
            public double VolumeM3;
            public bool HasVolume;
            public double MassKg;
            public bool HasMass;
            // 0120: төсөвчний талбарууд — type-түвшний утгууд бүлэгт нэг л удаа
            // онооно; instance марк-ууд түүвэр олонлогт цугларна.
            public string TypeMark;
            public string AssemblyCode;
            public string Keynote;
            public double? ThicknessMm;
            public HashSet<string> Marks;
        }

        private sealed class MaterialTake
        {
            public string Name;
            public double VolumeM3;
            public double AreaM2;
            public double? MassKg;
        }

        /// <summary>Нэг ElementType-ийн төсөвчний талбарууд (нэг удаа уншаад кэшилнэ).</summary>
        private sealed class TypeInfo
        {
            public string TypeMark;
            public string AssemblyCode;
            public string Keynote;
            /// <summary>Материалын нэр → давхаргын нийлбэр зузаан (мм). CompoundStructure-гүй бол хоосон.</summary>
            public Dictionary<string, double> LayerThicknessMm = new Dictionary<string, double>();
        }

        /// <summary>Instance марк түүврийн дээд хэмжээ: цуглуулах 24, харуулах 8.</summary>
        private const int MarksCollectCap = 24;
        private const int MarksShowCap = 8;

        public static QtoExtractionResult Extract(Document doc, string revitVersion)
        {
            return Extract(doc, revitVersion, null);
        }

        /// <summary>
        /// progressTick — боловсруулсан элементийн тоог үе үе мэдэгдэнэ (progress
        /// цонхны будалтад). null байж болно; дуудагч нь throttle хийнэ.
        /// </summary>
        public static QtoExtractionResult Extract(
            Document doc, string revitVersion, Action<int> progressTick)
        {
            var groups =
                new Dictionary<(string Cat, string Fam, string Typ, string Lvl, string Mat), Agg>();
            var categoryCounts = new Dictionary<string, int>();
            var densityCache = new Dictionary<ElementId, double?>();
            var typeInfoCache = new Dictionary<ElementId, TypeInfo>();
            int materialsWithoutDensity = 0;
            int elementCount = 0;

            FilteredElementCollector collector = new FilteredElementCollector(doc)
                .WhereElementIsNotElementType()
                .WhereElementIsViewIndependent();

            foreach (Element e in collector)
            {
                Category cat = e.Category;
                if (cat == null ||
                    cat.CategoryType != CategoryType.Model ||
                    !cat.HasMaterialQuantities)
                {
                    continue;
                }
                if (e is RevitLinkInstance || e is ImportInstance || e is Group)
                    continue;

                elementCount++;
                progressTick?.Invoke(elementCount);
                string categoryName = cat.Name;
                categoryCounts.TryGetValue(categoryName, out int seen);
                categoryCounts[categoryName] = seen + 1;

                string family = categoryName;
                string typeName = string.Empty;
                ElementType elementType = doc.GetElement(e.GetTypeId()) as ElementType;
                if (elementType != null)
                {
                    if (!string.IsNullOrEmpty(elementType.FamilyName))
                        family = elementType.FamilyName;
                    typeName = elementType.Name ?? string.Empty;
                }

                TypeInfo typeInfo = GetTypeInfo(doc, e.GetTypeId(), elementType, typeInfoCache);
                string instanceMark = ReadString(e, BuiltInParameter.ALL_MODEL_MARK);
                string level = ResolveLevelName(doc, e, 0);
                double? length = GetLengthMeters(e);
                double? hostArea =
                    ReadConverted(e, BuiltInParameter.HOST_AREA_COMPUTED, UnitTypeId.SquareMeters);
                double? hostVolume =
                    ReadConverted(e, BuiltInParameter.HOST_VOLUME_COMPUTED, UnitTypeId.CubicMeters);

                var takes = new List<MaterialTake>();
                foreach (ElementId matId in e.GetMaterialIds(false))
                {
                    double volumeM3 = UnitUtils.ConvertFromInternalUnits(
                        e.GetMaterialVolume(matId), UnitTypeId.CubicMeters);
                    if (volumeM3 <= 1e-9)
                        continue;

                    double areaM2 = UnitUtils.ConvertFromInternalUnits(
                        e.GetMaterialArea(matId, false), UnitTypeId.SquareMeters);
                    Material material = doc.GetElement(matId) as Material;
                    double? density =
                        GetDensityKgM3(doc, matId, densityCache, ref materialsWithoutDensity);

                    takes.Add(new MaterialTake
                    {
                        Name = material != null ? material.Name : "(нэргүй материал)",
                        VolumeM3 = volumeM3,
                        AreaM2 = areaM2,
                        MassKg = density.HasValue ? density.Value * volumeM3 : (double?)null,
                    });
                }

                if (takes.Count == 0)
                {
                    // Материалгүй элемент: элементийн түвшний хэмжээсээр нэг мөр.
                    Accumulate(groups, (categoryName, family, typeName, level, NoMaterialName),
                        1, length, hostArea, hostVolume, null,
                        typeInfo, instanceMark, null);
                }
                else
                {
                    int primary = 0;
                    for (int i = 1; i < takes.Count; i++)
                    {
                        if (takes[i].VolumeM3 > takes[primary].VolumeM3)
                            primary = i;
                    }

                    for (int i = 0; i < takes.Count; i++)
                    {
                        bool isPrimary = i == primary;
                        double thickness;
                        double? thicknessMm =
                            typeInfo.LayerThicknessMm.TryGetValue(takes[i].Name, out thickness)
                                ? thickness
                                : (double?)null;
                        Accumulate(groups,
                            (categoryName, family, typeName, level, takes[i].Name),
                            isPrimary ? 1 : 0,
                            isPrimary ? length : null,
                            takes[i].AreaM2,
                            takes[i].VolumeM3,
                            takes[i].MassKg,
                            typeInfo,
                            isPrimary ? instanceMark : null,
                            thicknessMm);
                    }
                }
            }

            List<QtoRow> rows = groups
                .OrderBy(kv => kv.Key.Cat)
                .ThenBy(kv => kv.Key.Fam)
                .ThenBy(kv => kv.Key.Typ)
                .ThenBy(kv => kv.Key.Lvl)
                .ThenBy(kv => kv.Key.Mat)
                .Select(kv => new QtoRow
                {
                    Category = kv.Key.Cat,
                    Family = kv.Key.Fam,
                    TypeName = kv.Key.Typ,
                    Level = kv.Key.Lvl,
                    Material = kv.Key.Mat,
                    Count = kv.Value.Count,
                    LengthM = Round3OrNull(kv.Value.HasLength, kv.Value.LengthM),
                    AreaM2 = Round3OrNull(kv.Value.HasArea, kv.Value.AreaM2),
                    VolumeM3 = Round3OrNull(kv.Value.HasVolume, kv.Value.VolumeM3),
                    MassKg = Round3OrNull(kv.Value.HasMass, kv.Value.MassKg),
                    TypeMark = kv.Value.TypeMark,
                    Marks = FormatMarks(kv.Value.Marks),
                    ThicknessMm = kv.Value.ThicknessMm,
                    AssemblyCode = kv.Value.AssemblyCode,
                    Keynote = kv.Value.Keynote,
                })
                .ToList();

            var payload = new QtoPayload
            {
                FileName = ResolveFileName(doc),
                RevitVersion = revitVersion ?? string.Empty,
                PushId = Guid.NewGuid().ToString("N"),
                Rows = rows,
                Rooms = ExtractRooms(doc),
            };

            return new QtoExtractionResult
            {
                Payload = payload,
                ElementCount = elementCount,
                RowCount = rows.Count,
                MaterialsWithoutDensity = materialsWithoutDensity,
                TopCategories = categoryCounts
                    .OrderByDescending(kv => kv.Value)
                    .ThenBy(kv => kv.Key)
                    .Take(TopCategoryCount)
                    .ToList(),
            };
        }

        private static void Accumulate(
            Dictionary<(string Cat, string Fam, string Typ, string Lvl, string Mat), Agg> groups,
            (string Cat, string Fam, string Typ, string Lvl, string Mat) key,
            int count, double? lengthM, double? areaM2, double? volumeM3, double? massKg,
            TypeInfo typeInfo, string instanceMark, double? thicknessMm)
        {
            if (!groups.TryGetValue(key, out Agg agg))
            {
                agg = new Agg();
                groups[key] = agg;
            }

            agg.Count += count;
            if (lengthM.HasValue) { agg.LengthM += lengthM.Value; agg.HasLength = true; }
            if (areaM2.HasValue) { agg.AreaM2 += areaM2.Value; agg.HasArea = true; }
            if (volumeM3.HasValue) { agg.VolumeM3 += volumeM3.Value; agg.HasVolume = true; }
            if (massKg.HasValue) { agg.MassKg += massKg.Value; agg.HasMass = true; }

            // Type-түвшний утгууд бүлгийн хэмжээнд тогтмол — эхний хоосон биш нь ялна.
            if (typeInfo != null)
            {
                if (agg.TypeMark == null && !string.IsNullOrEmpty(typeInfo.TypeMark))
                    agg.TypeMark = typeInfo.TypeMark;
                if (agg.AssemblyCode == null && !string.IsNullOrEmpty(typeInfo.AssemblyCode))
                    agg.AssemblyCode = typeInfo.AssemblyCode;
                if (agg.Keynote == null && !string.IsNullOrEmpty(typeInfo.Keynote))
                    agg.Keynote = typeInfo.Keynote;
            }
            if (!agg.ThicknessMm.HasValue && thicknessMm.HasValue)
                agg.ThicknessMm = Math.Round(thicknessMm.Value, 1);

            // Instance марк — capped түүвэр (мөрийн тоог өсгөхгүйн тулд бүлэглэлтийн
            // түлхүүрт оруулдаггүй; бодит моделд нэг төрөлд ~10 өөр марк байдаг).
            if (!string.IsNullOrEmpty(instanceMark))
            {
                if (agg.Marks == null)
                    agg.Marks = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                if (agg.Marks.Count < MarksCollectCap)
                    agg.Marks.Add(instanceMark);
            }
        }

        /// <summary>Марк түүврийг "А, Б, В +N" хэлбэрт (эхний 8, үлдсэн нь тоогоор).</summary>
        private static string FormatMarks(HashSet<string> marks)
        {
            if (marks == null || marks.Count == 0)
                return null;
            List<string> sorted = marks.OrderBy(m => m, StringComparer.OrdinalIgnoreCase).ToList();
            string joined = string.Join(", ", sorted.Take(MarksShowCap));
            int hidden = sorted.Count - MarksShowCap;
            // MarksCollectCap-д тулсан бол "+" тоо нь доод хязгаар гэдгийг мэднэ.
            if (hidden > 0)
                joined += " +" + hidden + (marks.Count >= MarksCollectCap ? "+" : "");
            return joined;
        }

        /// <summary>
        /// ElementType-ийн төсөвчний талбарууд: Type Mark / Assembly Code / Keynote +
        /// CompoundStructure давхаргуудын материал→зузаан(мм) зураглал. Type бүрд
        /// нэг л удаа тооцоологдож кэшлэгдэнэ (548 төрөл ~ хэдхэн мс).
        /// </summary>
        private static TypeInfo GetTypeInfo(
            Document doc, ElementId typeId, ElementType elementType,
            Dictionary<ElementId, TypeInfo> cache)
        {
            if (cache.TryGetValue(typeId, out TypeInfo cached))
                return cached;

            var info = new TypeInfo();
            if (elementType != null)
            {
                info.TypeMark = ReadString(elementType, BuiltInParameter.ALL_MODEL_TYPE_MARK);
                info.Keynote = ReadString(elementType, BuiltInParameter.KEYNOTE_PARAM);
                Parameter asm = elementType.LookupParameter("Assembly Code");
                if (asm != null && asm.HasValue)
                {
                    string v = asm.AsString();
                    if (!string.IsNullOrEmpty(v))
                        info.AssemblyCode = v;
                }

                var host = elementType as HostObjAttributes;
                CompoundStructure cs = null;
                try { cs = host?.GetCompoundStructure(); } catch { }
                if (cs != null)
                {
                    foreach (CompoundStructureLayer layer in cs.GetLayers())
                    {
                        Material mat = doc.GetElement(layer.MaterialId) as Material;
                        if (mat == null || string.IsNullOrEmpty(mat.Name))
                            continue;
                        double mm = UnitUtils.ConvertFromInternalUnits(
                            layer.Width, UnitTypeId.Millimeters);
                        if (mm <= 0)
                            continue;
                        // Ижил материал олон давхаргад → нийлбэр зузаан.
                        info.LayerThicknessMm.TryGetValue(mat.Name, out double sum);
                        info.LayerThicknessMm[mat.Name] = sum + mm;
                    }
                }
            }
            cache[typeId] = info;
            return info;
        }

        private static string ReadString(Element e, BuiltInParameter bip)
        {
            Parameter p = e.get_Parameter(bip);
            if (p == null || !p.HasValue)
                return null;
            string v = p.AsString();
            return string.IsNullOrEmpty(v) ? null : v;
        }

        /// <summary>
        /// Өрөөний ведомость: талбайтай (тавигдсан, хашигдсан) өрөөнүүд л орно.
        /// Судалгаагаар зөвхөн BA host файлд өрөө байдаг — link-үүдэд хоосон
        /// жагсаалт буцаад л өнгөрнө.
        /// </summary>
        private static List<QtoRoom> ExtractRooms(Document doc)
        {
            var rooms = new List<QtoRoom>();
            try
            {
                FilteredElementCollector collector = new FilteredElementCollector(doc)
                    .OfCategory(BuiltInCategory.OST_Rooms)
                    .WhereElementIsNotElementType();
                foreach (Element e in collector)
                {
                    Parameter areaParam = e.get_Parameter(BuiltInParameter.ROOM_AREA);
                    if (areaParam == null || !areaParam.HasValue)
                        continue;
                    double areaM2 = UnitUtils.ConvertFromInternalUnits(
                        areaParam.AsDouble(), UnitTypeId.SquareMeters);
                    if (areaM2 <= 0.001)
                        continue; // тавигдаагүй/хашигдаагүй өрөө

                    Parameter numParam = e.get_Parameter(BuiltInParameter.ROOM_NUMBER);
                    Parameter nameParam = e.get_Parameter(BuiltInParameter.ROOM_NAME);
                    string levelName = string.Empty;
                    Level lvl = doc.GetElement(e.LevelId) as Level;
                    if (lvl != null)
                        levelName = lvl.Name;

                    rooms.Add(new QtoRoom
                    {
                        Number = numParam != null && numParam.HasValue
                            ? numParam.AsString() ?? string.Empty : string.Empty,
                        Name = nameParam != null && nameParam.HasValue
                            ? nameParam.AsString() ?? string.Empty : string.Empty,
                        Level = levelName,
                        AreaM2 = Math.Round(areaM2, 2),
                    });
                }
            }
            catch
            {
                // Өрөөний ведомость нэмэлт мэдээлэл — алдаа нь push-ийг унагахгүй.
            }
            return rooms;
        }

        private static string ResolveLevelName(Document doc, Element e, int depth)
        {
            ElementId levelId = e.LevelId;
            if (levelId != null && levelId != ElementId.InvalidElementId)
            {
                Level level = doc.GetElement(levelId) as Level;
                if (level != null)
                    return level.Name;
            }

            foreach (BuiltInParameter bip in LevelParams)
            {
                Parameter p = e.get_Parameter(bip);
                if (p == null || p.StorageType != StorageType.ElementId || !p.HasValue)
                    continue;
                ElementId id = p.AsElementId();
                if (id == null || id == ElementId.InvalidElementId)
                    continue;
                Level level = doc.GetElement(id) as Level;
                if (level != null)
                    return level.Name;
            }

            // Түвшингүй бол хостоороо дамжуулж хайна (жишээ нь хананд суусан хаалга).
            if (depth < HostRecursionCap && e is FamilyInstance instance && instance.Host != null)
                return ResolveLevelName(doc, instance.Host, depth + 1);

            return NoLevelName;
        }

        private static double? GetLengthMeters(Element e)
        {
            foreach (BuiltInParameter bip in LengthParams)
            {
                double? v = ReadConverted(e, bip, UnitTypeId.Meters);
                if (v.HasValue && v.Value > 0)
                    return v;
            }

            LocationCurve locationCurve = e.Location as LocationCurve;
            if (locationCurve != null && locationCurve.Curve != null)
            {
                return UnitUtils.ConvertFromInternalUnits(
                    locationCurve.Curve.Length, UnitTypeId.Meters);
            }

            return null;
        }

        private static double? ReadConverted(Element e, BuiltInParameter bip, ForgeTypeId unit)
        {
            Parameter p = e.get_Parameter(bip);
            if (p == null || p.StorageType != StorageType.Double || !p.HasValue)
                return null;
            return UnitUtils.ConvertFromInternalUnits(p.AsDouble(), unit);
        }

        private static double? GetDensityKgM3(
            Document doc,
            ElementId matId,
            Dictionary<ElementId, double?> cache,
            ref int materialsWithoutDensity)
        {
            if (cache.TryGetValue(matId, out double? cached))
                return cached;

            double? density = null;
            Material material = doc.GetElement(matId) as Material;
            if (material != null &&
                material.StructuralAssetId != null &&
                material.StructuralAssetId != ElementId.InvalidElementId)
            {
                PropertySetElement propertySet =
                    doc.GetElement(material.StructuralAssetId) as PropertySetElement;
                if (propertySet != null)
                {
                    StructuralAsset asset = null;
                    try { asset = propertySet.GetStructuralAsset(); }
                    catch { /* физик asset биш байж болно */ }

                    if (asset != null && asset.Density > 0)
                    {
                        density = UnitUtils.ConvertFromInternalUnits(
                            asset.Density, UnitTypeId.KilogramsPerCubicMeter);
                        // Үйлдвэрлэгчийн family-ийн эвдэрхий asset (float-max
                        // placeholder ~3.4e38) → хогийн сав нарнаас хүнд болдог.
                        // Осми 22,590 кг/м³ = байгалийн дээд хязгаар; түүнээс
                        // дээшийг нягтгүйд тооцно.
                        if (density.Value > 25_000)
                            density = null;
                    }
                }
            }

            if (!density.HasValue)
                materialsWithoutDensity++;
            cache[matId] = density;
            return density;
        }

        private static double? Round3OrNull(bool has, double value)
        {
            if (!has)
                return null;
            double rounded = Math.Round(value, 3);
            return rounded == 0 ? (double?)null : rounded;
        }

        private static string ResolveFileName(Document doc)
        {
            string pathName = doc.PathName;
            if (!string.IsNullOrEmpty(pathName))
            {
                try
                {
                    string name = Path.GetFileName(pathName);
                    if (!string.IsNullOrEmpty(name))
                        return name;
                }
                catch (ArgumentException)
                {
                    // Cloud загварын зам стандарт бус байж болно.
                }
            }
            return doc.Title + ".rvt";
        }
    }
}
