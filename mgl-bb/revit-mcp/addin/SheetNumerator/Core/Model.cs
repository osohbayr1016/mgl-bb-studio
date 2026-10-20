using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace RevitMcpAddin.SheetNumerator.Core
{
    public enum GroupKind
    {
        /// <summary>«Бүгдийг нэг бүлэгт» горимын цорын ганц бүлэг.</summary>
        AllSheets = 0,

        /// <summary>Project Browser-ийн (одоогийн Browser Organization-ий) folder.  Зам нь хоосон байж болно (үндэс).</summary>
        BrowserFolder = 1,

        /// <summary>Хуудасны цуглуулга (Sheet Collection, Revit 2025+) дотор.</summary>
        SheetCollection = 2,

        /// <summary>Assembly instance-ийн хуудас.</summary>
        Assembly = 3,
    }

    /// <summary>Project Browser-ийн нэг түвшний folder: нэр + бүлэглэж буй параметрийн id.</summary>
    public sealed class FolderSegment : IEquatable<FolderSegment>
    {
        public FolderSegment(string name, long parameterId)
        {
            Name = name ?? string.Empty;
            ParameterId = parameterId;
        }

        public string Name { get; }

        /// <summary>Бүлэглэж буй параметрийн ElementId утга (built-in бол сөрөг).  0 = мэдэхгүй.</summary>
        public long ParameterId { get; }

        public bool Equals(FolderSegment other)
        {
            return other != null && ParameterId == other.ParameterId && string.Equals(Name, other.Name, StringComparison.Ordinal);
        }

        public override bool Equals(object obj)
        {
            return Equals(obj as FolderSegment);
        }

        public override int GetHashCode()
        {
            unchecked
            {
                return (StringComparer.Ordinal.GetHashCode(Name) * 397) ^ ParameterId.GetHashCode();
            }
        }

        public override string ToString()
        {
            return Name;
        }
    }

    /// <summary>
    /// Бүлгийн ТӨРЛӨӨР ТАНИГДДАГ түлхүүр.
    ///
    /// ⚠️ ХАРАГДАХ НЭРИЙГ ХЭЗЭЭ Ч ТАНИГЧ БОЛГОХГҮЙ.  Browser folder «ARCH», цуглуулга «ARCH», assembly «ARCH»
    /// гурав нэг нэртэй ч ХОЁР ӨӨР бүлэг: түлхүүр нь (төрөл, folder-ийн зам, цуглуулгын id, assembly-ийн id)
    /// бүгдээрээ тэнцэх үед л тэнцүү.  Нэр нь ердөө тайлбар (<see cref="SheetGroup.Title"/>).
    /// </summary>
    public sealed class GroupKey : IEquatable<GroupKey>
    {
        private static readonly IReadOnlyList<FolderSegment> NoPath = new FolderSegment[0];

        private GroupKey(GroupKind kind, IEnumerable<FolderSegment> path, long collectionId, long assemblyId)
        {
            Kind = kind;
            var list = new List<FolderSegment>();
            if (path != null)
                list.AddRange(path);
            BrowserPath = list.Count == 0 ? NoPath : list;
            CollectionElementId = collectionId;
            AssemblyElementId = assemblyId;
            StableId = Build();
        }

        public GroupKind Kind { get; }
        public IReadOnlyList<FolderSegment> BrowserPath { get; }

        /// <summary>Хуудасны цуглуулгын ElementId утга; 0 = цуглуулгагүй.</summary>
        public long CollectionElementId { get; }

        /// <summary>Assembly instance-ийн ElementId утга; 0 = assembly биш.</summary>
        public long AssemblyElementId { get; }

        /// <summary>Тайлбартай, хоёрдмол утгагүй хэлбэр — Dictionary-ийн түлхүүр, tree node-ийн танигч.</summary>
        public string StableId { get; }

        public static GroupKey All()
        {
            return new GroupKey(GroupKind.AllSheets, null, 0, 0);
        }

        public static GroupKey Folder(IEnumerable<FolderSegment> path)
        {
            return new GroupKey(GroupKind.BrowserFolder, path, 0, 0);
        }

        public static GroupKey Collection(long collectionId, IEnumerable<FolderSegment> path)
        {
            return new GroupKey(GroupKind.SheetCollection, path, collectionId, 0);
        }

        public static GroupKey Assembly(long assemblyId)
        {
            return new GroupKey(GroupKind.Assembly, null, 0, assemblyId);
        }

        private string Build()
        {
            // Уртыг тэмдэгтийн ӨМНӨ бичнэ → «:» «/» г.м. тусгаарлагч нэр дотор байсан ч хоёрдмол утгагүй.
            var sb = new StringBuilder();
            sb.Append((int)Kind).Append('|')
              .Append(CollectionElementId.ToString(CultureInfo.InvariantCulture)).Append('|')
              .Append(AssemblyElementId.ToString(CultureInfo.InvariantCulture)).Append('|');
            foreach (FolderSegment s in BrowserPath)
            {
                sb.Append(s.ParameterId.ToString(CultureInfo.InvariantCulture)).Append(':')
                  .Append(s.Name.Length.ToString(CultureInfo.InvariantCulture)).Append(':')
                  .Append(s.Name).Append(';');
            }
            return sb.ToString();
        }

        public bool Equals(GroupKey other)
        {
            return other != null && string.Equals(StableId, other.StableId, StringComparison.Ordinal);
        }

        public override bool Equals(object obj)
        {
            return Equals(obj as GroupKey);
        }

        public override int GetHashCode()
        {
            return StringComparer.Ordinal.GetHashCode(StableId);
        }

        public override string ToString()
        {
            return StableId;
        }
    }

    public enum UniquenessMode
    {
        /// <summary>Revit 2024: хуудасны дугаар бүх (assembly биш) хуудсанд ГЛОБАЛ давхцахгүй.</summary>
        Global = 0,

        /// <summary>
        /// Revit 2025+: «Model-д шууд байгаа хуудсуудад нэг, цуглуулга бүрт нэг» (BuiltInFailures.SheetFailures.
        /// SheetNumberDuplicatedPerSheetCollection).  Хэмжсэн (2027.2): X-01 нь цуглуулгагүй + A + B-д зэрэг оршино.
        /// </summary>
        PerSheetCollection = 1,
    }

    /// <summary>Browser Organization-ийн тойм (оношилгоо, эрэмбэ).</summary>
    public sealed class BrowserInfo
    {
        public string OrganizationName { get; set; }
        public bool HasGrouping { get; set; }
        public bool SortDescending { get; set; }
        public string SortParameterName { get; set; }
    }

    /// <summary>Хуудасны цуглуулга (Revit 2025+) — зөвхөн нэр харуулахад.</summary>
    public sealed class CollectionInfo
    {
        public long Id { get; set; }
        public string Name { get; set; }
    }

    /// <summary>
    /// Нэг хуудасны ЦАГИЙН ЗУРАГ.  Revit объект ХЭЗЭЭ Ч хадгалахгүй — энгийн утгууд л (WPF-ийн ViewModel
    /// урт хугацаанд амьд `ViewSheet`/`Parameter` барьж болохгүй).
    /// </summary>
    public sealed class SheetSnapshot
    {
        public long SheetId { get; set; }
        public string UniqueId { get; set; }

        /// <summary>Snapshot авах үеийн дугаар (Revit-д хадгалагдсан хэлбэрээр).</summary>
        public string Number { get; set; }

        public string Name { get; set; }
        public bool IsPlaceholder { get; set; }

        public bool IsAssemblySheet { get; set; }
        public long AssemblyId { get; set; }
        public string AssemblyName { get; set; }

        /// <summary>0 = цуглуулгагүй (эсвэл Revit 2024).</summary>
        public long CollectionId { get; set; }

        public string CollectionName { get; set; }

        /// <summary>Browser-ийн folder-ийн зам (дээрээс доош).  Хоосон = «all» зэрэг бүлэглэлтгүй.</summary>
        public IReadOnlyList<FolderSegment> BrowserPath { get; set; } = new FolderSegment[0];

        /// <summary>false = Browser Organization-ий шүүлтээр НУУГДСАН (харин давхардлын хувьд хэвээр тооцогдоно).</summary>
        public bool SatisfiesBrowserFilter { get; set; } = true;

        /// <summary>Browser-ийн эрэмбэлэх параметрийн утга (текст).</summary>
        public string SortKey { get; set; }

        /// <summary>Document дахь тоологдсон дараалал — эрэмбийн сүүлчийн тогтвортой тааруулагч.</summary>
        public int DocumentIndex { get; set; }

        /// <summary>Параметрийн утгууд — түлхүүр: <see cref="ParameterKey.Stable"/>.</summary>
        public IReadOnlyDictionary<string, SheetParameterValue> Parameters { get; set; } = new Dictionary<string, SheetParameterValue>();

        /// <summary>
        /// Дугаарын давхцлын ХҮРЭЭ.  Хэмжсэн (Revit 2027.2): assembly хуудас нь ӨӨРИЙН assembly-ийнхээ дотор
        /// (instance бүрээр тусдаа); энгийн/placeholder хуудас — цуглуулга бүрээр (цуглуулгагүй нь нэг хүрээ).
        /// </summary>
        public string ScopeKey(UniquenessMode mode)
        {
            if (IsAssemblySheet)
                return "A" + AssemblyId.ToString(CultureInfo.InvariantCulture);
            if (mode == UniquenessMode.PerSheetCollection)
                return "C" + CollectionId.ToString(CultureInfo.InvariantCulture);
            return "G";
        }

        public string GetParameterText(ParameterKey key, out bool present, out bool hasValue)
        {
            present = false;
            hasValue = false;
            if (key == null || Parameters == null)
                return string.Empty;
            SheetParameterValue v;
            if (!Parameters.TryGetValue(key.Stable, out v))
                return string.Empty;
            present = true;
            hasValue = v.HasValue;
            return v.Text ?? string.Empty;
        }
    }

    /// <summary>Нээлттэй document-ийн бүрэн ЗУРАГ (бүх хуудас — нуугдсан, placeholder, assembly-г оруулаад).</summary>
    public sealed class DocumentSnapshot
    {
        /// <summary>Document-ийн таних тэмдэг (төслийн UniqueId + гарчиг + зам).  Идэвхтэй document солигдсоныг барина.</summary>
        public string DocumentKey { get; set; }

        public string DocumentTitle { get; set; }
        public string RevitVersion { get; set; }
        public int RevitVersionNumber { get; set; }
        public bool IsWorkshared { get; set; }

        public UniquenessMode Uniqueness { get; set; }

        /// <summary>БҮХ хуудас — давхардлын шалгалт эдгээрийг БҮГДИЙГ харна.</summary>
        public IReadOnlyList<SheetSnapshot> Sheets { get; set; } = new SheetSnapshot[0];

        public IReadOnlyList<SheetParameterInfo> ParameterCatalog { get; set; } = new SheetParameterInfo[0];

        /// <summary>Идэвхтэй харагдац хуудас бол түүний id, үгүй бол 0.</summary>
        public long ActiveSheetId { get; set; }

        public BrowserInfo Browser { get; set; } = new BrowserInfo();

        public IReadOnlyList<CollectionInfo> Collections { get; set; } = new CollectionInfo[0];

        public DateTime CapturedUtc { get; set; }

        public SheetParameterInfo FindParameter(ParameterKey key)
        {
            if (key == null || ParameterCatalog == null)
                return null;
            foreach (SheetParameterInfo p in ParameterCatalog)
            {
                if (p.Key.Equals(key))
                    return p;
            }
            return null;
        }

        public SheetSnapshot FindSheet(long sheetId)
        {
            foreach (SheetSnapshot s in Sheets)
            {
                if (s.SheetId == sheetId)
                    return s;
            }
            return null;
        }
    }

    /// <summary>Нэг логик бүлэг — Түлхүүр, гарчиг, хуудсууд (АНХНЫ дарааллаар).</summary>
    public sealed class SheetGroup
    {
        public SheetGroup(GroupKey key, string title, IReadOnlyList<SheetSnapshot> sheets)
        {
            Key = key;
            Title = title ?? string.Empty;
            Sheets = sheets;
        }

        public GroupKey Key { get; }

        /// <summary>Тайлбар нэр — таних түлхүүр БИШ.</summary>
        public string Title { get; }

        /// <summary>OriginalOrder: Revit-ээс уншсан, Browser-ийн эрэмбээр.</summary>
        public IReadOnlyList<SheetSnapshot> Sheets { get; }
    }

    public enum GroupNodeKind
    {
        Root = 0,
        Section = 1,
        Folder = 2,
        Group = 3,
    }

    /// <summary>Бүлгийн мод (Project Browser-ийн бүтцийг дууриана).  Түвшний тоо хязгааргүй.</summary>
    public sealed class GroupNode
    {
        public GroupNode(string id, string title, GroupNodeKind kind)
        {
            Id = id;
            Title = title;
            Kind = kind;
            Children = new List<GroupNode>();
        }

        public string Id { get; }
        public string Title { get; set; }
        public GroupNodeKind Kind { get; set; }

        /// <summary>Энэ зангилаа ӨӨРӨӨ хуудастай бол бүлэг (бусад нь зөвхөн агуулагч).</summary>
        public SheetGroup Group { get; set; }

        public List<GroupNode> Children { get; }

        /// <summary>Энэ ба доорх БҮХ бүлгийн хуудасны нийлбэр.</summary>
        public int TotalSheets
        {
            get
            {
                int n = Group != null ? Group.Sheets.Count : 0;
                foreach (GroupNode c in Children)
                    n += c.TotalSheets;
                return n;
            }
        }
    }
}
