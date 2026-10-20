using System;
using System.Text;

namespace RevitMcpAddin.Smart.Core
{
    public enum DocumentKind
    {
        Unknown = 0,
        /// <summary>Нэг хэрэглэгчийн (workshared БИШ) файл.</summary>
        Local,
        /// <summary>Workshared (central/local) файл.</summary>
        Workshared,
        /// <summary>Cloud (ACC/BIM 360) загвар.</summary>
        Cloud,
        /// <summary>Хадгалаагүй — түлхүүр нь ЗӨВХӨН энэ session-д хүчинтэй.</summary>
        Unsaved,
    }

    /// <summary>
    /// Revit `Document`-оос ХУУЛСАН, Revit-гүй баримтын мэдээлэл — түлхүүр үүсгэх оролт.
    /// Түүхий зам (`PathName`, `CentralPath`) энд ЗӨВХӨН хэшлэгдэхийн тулд орно:
    /// түлхүүр, лог, JSON-д түүхий зам ХЭЗЭЭ Ч орохгүй (файл серверийн UNC хаяг
    /// байж болно — `Intelligence/Core/DocKeys.cs`-ийн ижил дүрэм).
    /// </summary>
    public sealed class DocumentFacts
    {
        /// <summary>`Document.CreationGUID` — баримт ҮҮСЭХЭД олгогддог, Save As / central / local-д хадгалагдана.</summary>
        public string CreationGuid { get; set; }
        /// <summary>`ProjectInformation.UniqueId` — зөвхөн хуучин `DocKeys`-тэй НЭГДЭХ (`LegacyKey`) зорилгоор.</summary>
        public string ProjectInfoUniqueId { get; set; }
        public bool IsCloud { get; set; }
        public string CloudProjectGuid { get; set; }
        public string CloudModelGuid { get; set; }
        public bool IsWorkshared { get; set; }
        /// <summary>Workshared файлын central-ийн хэрэглэгчид харагдах зам.</summary>
        public string CentralPath { get; set; }
        public string PathName { get; set; }
        public string Title { get; set; }
        public bool IsFamily { get; set; }
        public bool IsLinked { get; set; }
        /// <summary>Хадгалаагүй баримтад: процессын турш тогтвортой санамсаргүй тэмдэг.</summary>
        public string SessionId { get; set; }
    }

    /// <summary>
    /// БАРИМТЫН ТҮЛХҮҮР — хадгалагдсан түүх (clash, impact, publish checkpoint)-ийн эзэн.
    ///
    /// ⚠️ ЯАГААД `PathName` ГАНЦААРАА БИШ: файл нэр солих/зөөх/сервер солих бүрд түүх
    /// алдагдана.  ⚠️ ЯАГААД `ProjectInformation.UniqueId` ТҮРҮҮЛЭГЧ БИШ: компанийн
    /// ЗАГВАР (.rte)-аас эхэлсэн төслүүд загварын элементүүдийг (түүний дотор
    /// Project Information-ыг) хуваалцаж болзошгүй — өөр төслүүдийн түүхийг НЭГТГЭХ нь
    /// чимээгүй буруу.  Тиймээс түрүүлэх дараалал:
    ///
    ///   1. `Document.CreationGUID`  — баримт анх ҮҮСЭХЭД олгогдсон GUID
    ///   2. cloud project + model GUID
    ///   3. workshared central замын хэш
    ///   4. файлын замын хэш (`DocKeys`-ийн `path:` хэлбэр)
    ///   5. хадгалаагүй — түр, `Persistable = false`
    ///
    /// `LegacyKey` нь одоо байгаа `DocKeys.Normalize(RevitTools.DocUid(doc))`-тэй ЯГ
    /// ИЖИЛ (ERP-д бүртгэсэн, WorkTracking/Intelligence-ийн түлхүүр) — нэгтгэхэд л.
    ///
    /// ⚠️ ТАМАГЛАЛ (амьд Revit дээр баталгаажуулах): `CreationGUID` нь файл хадгалж
    /// дахин нээхэд хэвээр, шинэ төсөл (загвараас) бүрд ШИНЭ.  Баталгаажуулах алхам:
    /// `docs/SMART.md` «Гар шалгалт».
    /// </summary>
    public sealed class DocumentKey : IEquatable<DocumentKey>
    {
        public string Id { get; private set; }
        public DocumentKind Kind { get; private set; }
        public bool Persistable { get; private set; }
        /// <summary>ЗӨВХӨН харуулах нэр (файлын гарчиг).  Таних түлхүүрт ОРООГҮЙ.</summary>
        public string Display { get; private set; }
        public string LegacyKey { get; private set; }

        /// <summary>Хавтасны нэр — `Id`-ийн хэш (`:` гэх мэт тэмдэгтгүй, зам задруулахгүй).</summary>
        public string FolderName
        {
            get { return SmartHash.Short(Id ?? string.Empty); }
        }

        internal DocumentKey(string id, DocumentKind kind, bool persistable, string display, string legacyKey)
        {
            Id = id;
            Kind = kind;
            Persistable = persistable;
            Display = display;
            LegacyKey = legacyKey;
        }

        public bool Equals(DocumentKey other)
        {
            return other != null && string.Equals(Id, other.Id, StringComparison.Ordinal);
        }

        public override bool Equals(object obj) { return Equals(obj as DocumentKey); }
        public override int GetHashCode() { return Id == null ? 0 : StringComparer.Ordinal.GetHashCode(Id); }
        public override string ToString() { return Id; }
    }

    public static class DocumentKeyBuilder
    {
        public static DocumentKey Build(DocumentFacts f)
        {
            if (f == null) throw new ArgumentNullException("f");

            DocumentKind kind;
            bool hasPath = !string.IsNullOrWhiteSpace(f.PathName);
            if (f.IsCloud) kind = DocumentKind.Cloud;
            else if (f.IsWorkshared) kind = DocumentKind.Workshared;
            else if (hasPath) kind = DocumentKind.Local;
            else kind = DocumentKind.Unsaved;

            string id;
            bool persist = true;
            string guid = NormalizeGuid(f.CreationGuid);
            string cp = NormalizeGuid(f.CloudProjectGuid);
            string cm = NormalizeGuid(f.CloudModelGuid);

            if (guid != null)
            {
                id = "doc:" + guid;
            }
            else if (f.IsCloud && cp != null && cm != null)
            {
                id = "cloud:" + cp + ":" + cm;
            }
            else if (f.IsWorkshared && !string.IsNullOrWhiteSpace(f.CentralPath))
            {
                id = "ws:" + SmartHash.Short(f.CentralPath.Trim().ToLowerInvariant());
            }
            else if (hasPath)
            {
                id = LegacyPathKey(f.PathName);
            }
            else
            {
                id = "unsaved:" + (string.IsNullOrWhiteSpace(f.SessionId) ? "x" : f.SessionId.Trim());
                persist = false;
                kind = DocumentKind.Unsaved;
            }

            string legacy = !string.IsNullOrWhiteSpace(f.ProjectInfoUniqueId)
                ? f.ProjectInfoUniqueId
                : LegacyPathKey(f.PathName ?? f.Title ?? "unknown");

            return new DocumentKey(id, kind, persist, f.Title, legacy);
        }

        /// <summary>
        /// `DocKeys.Normalize("path:" + raw)`-тэй ЯГ ИЖИЛ: `path:` + SHA-256-ийн эхний 8 байт.
        /// (`Smart.Tests` нь хоёр хэрэгжүүлэлтийн тэнцүү байхыг шалгана.)
        /// </summary>
        public static string LegacyPathKey(string rawPathOrTitle)
        {
            string raw = "path:" + (rawPathOrTitle ?? "unknown");
            return "path:" + SmartHash.Short(raw, 8);
        }

        private static string NormalizeGuid(string g)
        {
            if (string.IsNullOrWhiteSpace(g)) return null;
            Guid parsed;
            if (!Guid.TryParse(g.Trim(), out parsed)) return null;
            if (parsed == Guid.Empty) return null;
            return parsed.ToString("D");
        }
    }

    /// <summary>
    /// ЭЛЕМЕНТИЙН ТҮЛХҮҮР — `ElementId` БИШ (session хооронд тогтворгүй, сэргээн
    /// үүсгэсэн элементийг ялгахгүй).  `Element.UniqueId` + эзэн баримт.
    ///
    /// Линк загварын элемент: `Doc` = ЛИНКИЙН баримтын түлхүүр (нэг файл олон instance-аар
    /// орсон ч элементийн утга нэг), `Via` = host доторх `RevitLinkInstance.UniqueId`
    /// (ИЖИЛ линкийг хоёр удаа оруулсныг ялгана), `HostDoc` = host баримт.
    ///
    /// Устгаж дахин үүсгэсэн элемент = ӨӨР түлхүүр (UniqueId өөр) — зориудаар.
    /// </summary>
    public readonly struct ElementKey : IEquatable<ElementKey>, IComparable<ElementKey>
    {
        public string HostDoc { get; }
        public string Doc { get; }
        public string Via { get; }
        public string Uid { get; }

        private ElementKey(string hostDoc, string doc, string via, string uid)
        {
            HostDoc = hostDoc;
            Doc = doc;
            Via = via;
            Uid = uid;
        }

        public bool IsValid
        {
            get { return !string.IsNullOrEmpty(Doc) && !string.IsNullOrEmpty(Uid); }
        }

        public bool IsLinked
        {
            get { return !string.IsNullOrEmpty(Via); }
        }

        public static ElementKey Host(string docId, string uniqueId)
        {
            return new ElementKey(docId, docId, null, uniqueId);
        }

        public static ElementKey Linked(string hostDocId, string linkInstanceUid, string linkedDocId, string uniqueId)
        {
            return new ElementKey(hostDocId, linkedDocId, linkInstanceUid, uniqueId);
        }

        /// <summary>Host элемент: `doc|uid`.  Линкийн элемент: `host&gt;via&gt;doc|uid`.</summary>
        public override string ToString()
        {
            if (!IsLinked) return (Doc ?? "") + "|" + (Uid ?? "");
            return (HostDoc ?? "") + ">" + Via + ">" + (Doc ?? "") + "|" + (Uid ?? "");
        }

        public static bool TryParse(string text, out ElementKey key)
        {
            key = default(ElementKey);
            if (string.IsNullOrEmpty(text)) return false;
            int bar = text.LastIndexOf('|');
            if (bar <= 0 || bar == text.Length - 1) return false;
            string uid = text.Substring(bar + 1);
            string head = text.Substring(0, bar);
            string[] parts = head.Split('>');
            if (parts.Length == 1)
            {
                key = Host(parts[0], uid);
                return true;
            }
            if (parts.Length == 3)
            {
                key = Linked(parts[0], parts[1], parts[2], uid);
                return true;
            }
            return false;
        }

        public bool Equals(ElementKey other)
        {
            return string.Equals(HostDoc, other.HostDoc, StringComparison.Ordinal)
                && string.Equals(Doc, other.Doc, StringComparison.Ordinal)
                && string.Equals(Via, other.Via, StringComparison.Ordinal)
                && string.Equals(Uid, other.Uid, StringComparison.Ordinal);
        }

        public override bool Equals(object obj) { return obj is ElementKey && Equals((ElementKey)obj); }

        public override int GetHashCode()
        {
            unchecked
            {
                int h = 17;
                h = h * 31 + (HostDoc == null ? 0 : StringComparer.Ordinal.GetHashCode(HostDoc));
                h = h * 31 + (Doc == null ? 0 : StringComparer.Ordinal.GetHashCode(Doc));
                h = h * 31 + (Via == null ? 0 : StringComparer.Ordinal.GetHashCode(Via));
                h = h * 31 + (Uid == null ? 0 : StringComparer.Ordinal.GetHashCode(Uid));
                return h;
            }
        }

        /// <summary>Тогтвортой дараалал — симметр дүрмийн хос (A,B)-г нормчлох, JSON-ийг тогтвортой болгоход.</summary>
        public int CompareTo(ElementKey other)
        {
            return string.CompareOrdinal(ToString(), other.ToString());
        }

        public static bool operator ==(ElementKey a, ElementKey b) { return a.Equals(b); }
        public static bool operator !=(ElementKey a, ElementKey b) { return !a.Equals(b); }
    }
}
