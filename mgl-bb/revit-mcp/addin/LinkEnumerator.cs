using System;
using System.Collections.Generic;
using System.IO;
using Autodesk.Revit.DB;

namespace RevitMcpAddin
{
    /// <summary>
    /// Нэг илгээлтийн бай: хост эсвэл link документ. Document == null бол
    /// алгасах бай (SkipReason-д шалтгаан нь).
    /// </summary>
    public sealed class QtoTarget
    {
        public Document Document { get; set; }
        public string FileName { get; set; }
        public bool IsHost { get; set; }
        public string SkipReason { get; set; }
    }

    /// <summary>
    /// Илгээх файлуудын жагсаалтыг бүрдүүлнэ: хост + ачаалагдсан top-level
    /// RVT/IFC-link документууд. Read-only, UI-гүй.
    ///
    /// Dedupe хоёр давхаргатай: (1) нэг RevitLinkType-ийн олон instance →
    /// GetTypeId() HashSet; (2) ижил файл хоёр өөр type-оор орсон ховор
    /// тохиолдол → linkDoc.PathName (case-insensitive).
    /// </summary>
    public static class LinkEnumerator
    {
        public static List<QtoTarget> CollectTargets(Document hostDoc, bool includeLinks)
        {
            var targets = new List<QtoTarget>
            {
                new QtoTarget
                {
                    Document = hostDoc,
                    IsHost = true,
                    FileName = SafeFileName(hostDoc),
                },
            };
            if (!includeLinks)
                return targets;

            var seenTypes = new HashSet<ElementId>();
            var seenPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            FilteredElementCollector collector =
                new FilteredElementCollector(hostDoc).OfClass(typeof(RevitLinkInstance));
            foreach (Element element in collector)
            {
                var instance = (RevitLinkInstance)element;
                ElementId typeId = instance.GetTypeId();
                if (!seenTypes.Add(typeId))
                    continue; // нэг type-ийн хоёр дахь instance

                var linkType = hostDoc.GetElement(typeId) as RevitLinkType;
                if (linkType == null)
                    continue;

                bool nested;
                try { nested = linkType.IsNestedLink; }
                catch { nested = false; }
                if (nested)
                    continue; // v1: зөвхөн top-level link

                Document linkDoc = instance.GetLinkDocument();
                if (linkDoc == null)
                {
                    targets.Add(new QtoTarget
                    {
                        FileName = linkType.Name,
                        SkipReason = DescribeStatus(linkType),
                    });
                    continue;
                }

                string key = string.IsNullOrEmpty(linkDoc.PathName)
                    ? linkDoc.Title
                    : linkDoc.PathName;
                if (!seenPaths.Add(key))
                    continue; // ижил файл давхар link-лэгдсэн

                targets.Add(new QtoTarget
                {
                    Document = linkDoc,
                    FileName = SafeFileName(linkDoc),
                });
            }
            return targets;
        }

        /// <summary>Ачаалагдаагүй link-ийн шалтгааныг хүнд ойлгомжтойгоор.</summary>
        private static string DescribeStatus(RevitLinkType linkType)
        {
            try
            {
                LinkedFileStatus status = linkType.GetLinkedFileStatus();
                switch (status)
                {
                    case LinkedFileStatus.NotFound: return "файл олдсонгүй";
                    case LinkedFileStatus.Unloaded: return "ачаалагдаагүй (unload)";
                    case LinkedFileStatus.LocallyUnloaded: return "ачаалагдаагүй (локал unload)";
                    case LinkedFileStatus.InClosedWorkset: return "хаалттай workset-д";
                    default: return "ачаалагдаагүй";
                }
            }
            catch
            {
                return "ачаалагдаагүй";
            }
        }

        private static string SafeFileName(Document doc)
        {
            try
            {
                string pathName = doc.PathName;
                if (!string.IsNullOrEmpty(pathName))
                {
                    string name = Path.GetFileName(pathName);
                    if (!string.IsNullOrEmpty(name))
                        return name;
                }
            }
            catch (ArgumentException)
            {
                // Cloud зам г.м — Title fallback руу
            }
            return doc.Title + ".rvt";
        }
    }
}
