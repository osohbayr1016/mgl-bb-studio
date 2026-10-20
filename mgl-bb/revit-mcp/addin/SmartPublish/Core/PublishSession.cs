using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.SmartPublish.Core
{
    /// <summary>
    /// Smart Publish цонхны ХАНДАЛТЫН гэрээ — цонх Revit-ийн төрлийг огт мэдэхгүй.  Revit-тэй хэрэгжүүлэлт
    /// (`RevitPublishSession`) загвараас мэдээллийг хуулж авдаг; тестэд (`tests/Smart.UiSmoke`) хуурамч
    /// хэрэгжүүлэлтээр цонхыг Revit-гүйгээр ажиллуулна.
    /// </summary>
    public interface IPublishSession
    {
        string DocumentTitle { get; }
        IReadOnlyList<PublishItem> Items { get; }
        PublishContext Project { get; }
        IReadOnlyCollection<string> DwgSetupNames { get; }
        IReadOnlyCollection<string> ThreeDViewNames { get; }
        PublishProfilesFile Profiles { get; }
        IFileSystem Fs { get; }
        /// <summary>Профайлд хамаарах орчны баримт (PDF тохиргооны зөв байдал г.м.).</summary>
        EnvironmentFacts EnvFor(PublishProfile profile);
        /// <summary>Профайлын хадгалалт.  false = хадгалж чадсангүй (файл түгжигдсэн, шинэ хувилбар г.м.) — цонх хэрэглэгчид ИЛ хэлнэ.</summary>
        bool SaveProfiles();
        PublishHistory History();
        /// <summary>Хуудас тутмын сүүлийн АМЖИЛТТАЙ гаргалтын тэмдэг (профайл тус бүрээр).  Байхгүй бол хоосон.</summary>
        IReadOnlyDictionary<string, SheetCheckpoint> CheckpointsFor(string profileId);
        /// <summary>
        /// «Өөрчлөгдсөн хуудас» шинжилгээний сүүлийн дүн (Change Impact).  Шинжилгээ хийгээгүй бол null — тэр үед хуудас бүр
        /// «шинжлээгүй» гэж үзэгдэж, ХЭЗЭЭ Ч «өөрчлөгдөөгүй» гэж тооцогдохгүй.  Шинжилгээг команд (Revit API контекст) хийнэ.
        /// </summary>
        AffectedPublishSet Affected { get; }
    }

    /// <summary>Цонхны сонгох жагсаалтууд (Revit-ийн enum-ын НЭРСтэй таарна).</summary>
    public static class PublishChoices
    {
        public static readonly string[] PaperFormats =
        {
            "Default", "ISO_A0", "ISO_A1", "ISO_A2", "ISO_A3", "ISO_A4", "ISO_B1", "ISO_B2", "ISO_B3", "ISO_B4",
            "ANSI_A", "ANSI_B", "ANSI_C", "ANSI_D", "ANSI_E", "ARCH_A", "ARCH_B", "ARCH_C", "ARCH_D", "ARCH_E", "ARCH_E1", "ARCH_E2", "ARCH_E3",
        };
        public static readonly string[] Orientations = { "Auto", "Portrait", "Landscape" };
        public static readonly string[] Placements = { "Center", "LowerLeft", "Margins" };
        public static readonly string[] ZoomTypes = { "FitToPage", "Zoom" };
        public static readonly string[] ColorDepths = { "Color", "GrayScale", "BlackLine" };
        public static readonly string[] RasterQualities = { "Low", "Medium", "High", "Presentation" };
        public static readonly string[] ExportQualities = { "", "DPI72", "DPI144", "DPI300", "DPI600", "DPI1200" };
        public static readonly string[] IfcVersions =
        {
            "Default", "IFC2x3", "IFC2x3CV2", "IFC4", "IFC4RV", "IFC4DTV", "IFC4x3", "IFC4x3RV", "IFC4x3DTV",
            "IFCCOBIE", "IFC2x3BFM", "IFC2x3FM", "IFCBCA", "IFCSG", "IFC2x2",
        };
        public static readonly string[] SelectionFields = { "SheetNumber", "SheetName", "Revision", "RevisionDescription", "ViewType" };

        /// <summary>Нэршлийн токены товч лавлах (профайлын засварлагчид).</summary>
        public static string TokenHelp
        {
            get
            {
                return "Токен: {ProjectNumber} {ProjectName} {ProjectClient} {Doc} {SheetNumber} {SheetName} {Revision} "
                     + "{RevisionDescription} {RevisionDate} {ViewType} {Date:yyyyMMdd} {Format} {Index:3} "
                     + "{Param:Параметрийн нэр} {Project:Параметрийн нэр} {SheetCount} {FirstSheet} {LastSheet}\n"
                     + "Засагч: {SheetName|upper|max=20}  (upper lower trim nospace underscore max=N pad=N)\n"
                     + "[ ... ] бүлэг: доторх токен хоосон бол бүлэг алгасагдана — жишээ нь [_Rev{Revision}]";
            }
        }
    }

    /// <summary>
    /// Цонхны «Хуудас» жагсаалтын тэмдэглэгээний сүүлийн гаргалтын төлөв.  ЦЭВЭР.
    /// </summary>
    public static class LastPublishInfo
    {
        public const string Never = "Хараахан гаргаагүй";
        public const string PartialPrefix = "Хэсэгчлэн";

        /// <param name="requiredFormats">
        /// Профайлын ОДООГИЙН форматууд.  Профайлд дараа нь формат (жишээ нь DWG) нэмэгдсэн бол хуучин «PDF-only» checkpoint «бүрэн гарсан» биш —
        /// «Хэсэгчлэн · … · DWG дутуу» гэж харуулна.  null = форматыг шалгахгүй (хуучин дуудлага).
        /// </param>
        public static string Describe(SheetCheckpoint cp, IEnumerable<PublishFormat> requiredFormats = null)
        {
            if (cp == null) return Never;
            string when = cp.PublishedUtc.ToLocalTime().ToString("yyyy-MM-dd HH:mm") + (string.IsNullOrEmpty(cp.RevisionNumber) ? "" : " · Rev " + cp.RevisionNumber);
            List<PublishFormat> missing = PublishCheckpointStore.MissingFormats(cp, requiredFormats);
            if (missing.Count > 0)
                return PartialPrefix + " · " + when + " · " + string.Join(", ", missing.Select(f => f.ToString().ToUpperInvariant())) + " дутуу";
            // Профайлын зарим формат (жишээ нь DWG) хараахан амжилттай гараагүй — «бүрэн гарсан» гэж харуулахгүй.
            return cp.Partial ? PartialPrefix + " · " + when : when;
        }

        /// <summary>«Хараахан гаргаагүй» ба «хэсэгчлэн» (бүх формат гараагүй) — дахин гаргах шаардлагатай.</summary>
        public static bool NeedsPublish(string described)
        {
            return described == Never || (described != null && described.StartsWith(PartialPrefix, StringComparison.Ordinal));
        }
    }
}
