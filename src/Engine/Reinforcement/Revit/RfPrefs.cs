using System;
using System.IO;
using System.Text.Json;
using Autodesk.Revit.DB;

namespace RevitMcpAddin.Reinforcement
{
    /// <summary>«Арматурын төгсгөлийн тэмдэг»-ийн сонголт.</summary>
    public sealed class RfEndSymbolPrefs
    {
        /// <summary>
        /// ⚠️ ElementId ХЭЗЭЭ Ч хадгалахгүй (файл бүрд өөр) — зөвхөн Family + Type НЭР.  Файл дотор нэрээр нь дахин олно.
        /// </summary>
        public string SymbolFamily { get; set; } = "";
        public string SymbolType { get; set; } = "";
        /// <summary>Хуучин («Family : Type» нэг мөр) тохиргоо — зөвхөн УНШИХ (үүнээс <see cref="SymbolFamily"/>/<see cref="SymbolType"/> гарна).</summary>
        public string SymbolName { get; set; } = "";
        /// <summary>true = family биш, код-оор зурсан тэмдэг (тойрог/загалмай/налуу зураас).</summary>
        public bool UseMarker { get; set; } = false;
        /// <summary>circle | cross | slash</summary>
        public string MarkerStyle { get; set; } = "circle";
        /// <summary>Код-оор зурсан тэмдгийн ЦААСАН хэмжээ, мм (тойргийн диаметр / ×-ийн диагональ).</summary>
        public double MarkerSizeMm { get; set; } = 3.0;
        /// <summary>both | start | end</summary>
        public string Place { get; set; } = "both";
        /// <summary>auto = арматурын чиглэлээр | fixed = тогтмол өнцөг</summary>
        public string Orientation { get; set; } = "auto";
        /// <summary>⚠️ ХУУЧИН (нэг өнцөг) — зөвхөн УНШИГДАНА: <see cref="StartRotationDeg"/>/<see cref="EndRotationDeg"/> байхгүй хуучин файлыг шилжүүлэхэд.</summary>
        public double FixedAngleDeg { get; set; } = 0;
        /// <summary>
        /// Эхлэлийн тэмдгийн эргэлт (°), Төгсгөлийнхөөс ТУСДАА.  «Арматур дагуу» горимд автомат чиглэл ДЭЭР нэмэгдэх өнцөг (offset);
        /// «Тогтмол» горимд харагдацын хавтгай дахь абсолют өнцөг.  null = хуучин файл (<see cref="RfPrefs.Load"/> шилжүүлнэ).
        /// </summary>
        public double? StartRotationDeg { get; set; }
        public double? EndRotationDeg { get; set; }
        /// <summary>Тэмдгийн «заах чиглэл» family-д X тэнхлэгээс хэдэн градус хазайсан (family өөр чиглэлтэй зурагдсан бол).</summary>
        public double SymbolAngleOffsetDeg { get; set; } = 0;
        /// <summary>Төгсгөлөөс (арматурын чиглэлээр гадагш) зөөх зай, мм.</summary>
        public double OffsetMm { get; set; } = 0;
        /// <summary>Дэгээний үзүүрийг төгсгөл гэж үзэх (өгөгдмөл) эсэх; үгүй бол дэгээг тооцохгүй, шулуун хэсгийн төгсгөл.</summary>
        public bool IncludeHooks { get; set; } = true;
        /// <summary>Олонлог (bar set): nearest = дарсан цэгт ойр ширхэг (өгөгдмөл) | all = бүх ширхэг | first = ЗӨВХӨН эхний ширхэг | firstlast = эхний ба сүүлийн.</summary>
        public string BarSet { get; set; } = "nearest";
        /// <summary>Яг ижил төгсгөлд давхар тавихыг зөвшөөрөх (өгөгдмөл — үгүй).</summary>
        public bool AllowDuplicates { get; set; } = false;
        /// <summary>«Дараагийн удаа санах» — ЗӨВХӨН энэ true үед сонголт хадгалагдана.</summary>
        public bool Remember { get; set; } = false;
    }

    /// <summary>«Түүвэр хувилах»-ын сонголт.</summary>
    public sealed class RfSchedulePrefs
    {
        /// <summary>0 = Алгасах, 1 = Filter шинэчлэх, 2 = Солих.  ⚠️ Өгөгдмөл нь аюулгүй: Алгасах.</summary>
        public int Policy { get; set; } = 0;
    }

    public sealed class RfPrefsData
    {
        public RfEndSymbolPrefs EndSymbol { get; set; } = new RfEndSymbolPrefs();
        public RfSchedulePrefs Schedule { get; set; } = new RfSchedulePrefs();
    }

    /// <summary>
    /// Тохиргоо `%APPDATA%\RevitMcpAddin\reinforcement.json` (settings.json-оос тусдаа — `AaPrefs`-ийн ижил).
    /// Эвдэрсэн файл → өгөгдмөл; хадгалж чадаагүй нь ажиллагаанд саад биш.
    /// </summary>
    public static class RfPrefs
    {
        private static string PathOf { get { return Path.Combine(SettingsStore.Dir, "reinforcement.json"); } }

        public static RfPrefsData Load()
        {
            try
            {
                if (File.Exists(PathOf))
                {
                    RfPrefsData d = JsonSerializer.Deserialize<RfPrefsData>(File.ReadAllText(PathOf));
                    if (d != null)
                    {
                        if (d.EndSymbol == null) d.EndSymbol = new RfEndSymbolPrefs();
                        MigrateRotation(d.EndSymbol);
                        if (d.Schedule == null) d.Schedule = new RfSchedulePrefs();
                        return d;
                    }
                }
            }
            catch
            {
                // Эвдэрсэн файл — өгөгдмөл.
            }
            var fresh = new RfPrefsData();
            MigrateRotation(fresh.EndSymbol);
            return fresh;
        }

        /// <summary>
        /// Эргэлтийн хуучин тохиргооноос ШИЛЖИЛТ (хэрэглэгчийн сонголтыг чимээгүй АЛДАХГҮЙ): шинэ талбарууд (Эхлэл/Төгсгөл) байхгүй бол хуучин «Тогтмол»
        /// өнцөг хоёуланд (хуучин ганц өнцөг хоёр төгсгөлд ижил байсан); «Арматур дагуу» байсан бол 0 (offset байхгүй = өмнөх харагдац).
        /// </summary>
        internal static void MigrateRotation(RfEndSymbolPrefs p)
        {
            if (p == null) return;
            double s, e;
            Core.RfEndSymbolMath.MigrateRotation(p.Orientation, p.FixedAngleDeg, p.StartRotationDeg, p.EndRotationDeg, out s, out e);
            p.StartRotationDeg = s;
            p.EndRotationDeg = e;
        }

        public static void Save(RfPrefsData d)
        {
            try
            {
                Directory.CreateDirectory(SettingsStore.Dir);
                File.WriteAllText(PathOf, JsonSerializer.Serialize(d, new JsonSerializerOptions { WriteIndented = true }));
            }
            catch
            {
                // Хадгалж чадаагүй нь ажиллагаанд саад биш.
            }
        }
    }

    /// <summary>
    /// ТОГТМОЛ мм ↔ ТӨСЛИЙН урт нэгж.  Хэрэглэгч оффсет/зайг төслийн нэгжээр (мм, см, м, дюйм…) харж, бичнэ;
    /// дотор нь фут/мм-ээр тооцно.
    /// </summary>
    internal static class RfUnits
    {
        private static ForgeTypeId LengthUnit(Document doc)
        {
            try { return doc.GetUnits().GetFormatOptions(SpecTypeId.Length).GetUnitTypeId(); }
            catch { return UnitTypeId.Millimeters; }
        }

        public static string LengthLabel(Document doc)
        {
            try { return LabelUtils.GetLabelForUnit(LengthUnit(doc)); }
            catch { return "mm"; }
        }

        /// <summary>мм → төслийн нэгж (UI-д харуулах).</summary>
        public static double MmToProject(Document doc, double mm)
        {
            try { return UnitUtils.ConvertFromInternalUnits(mm / 304.8, LengthUnit(doc)); }
            catch { return mm; }
        }

        /// <summary>Төслийн нэгж → мм (UI-аас унших).</summary>
        public static double ProjectToMm(Document doc, double value)
        {
            try { return UnitUtils.ConvertToInternalUnits(value, LengthUnit(doc)) * 304.8; }
            catch { return value; }
        }
    }
}
