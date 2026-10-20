using System;
using System.Collections.Generic;
using Autodesk.Revit.DB;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.Smart
{
    /// <summary>
    /// Revit `Document` → `DocumentKey` (Revit-гүй `DocumentKeyBuilder`-ийн оролтыг ЦУГЛУУЛНА).
    ///
    /// ⚠️ Бүх унших нь `try` дотор: `GetCloudModelPath()`, `GetWorksharingCentralModelPath()` нь
    /// тохирохгүй баримтад `InvalidOperationException` шиддэг (баримтжуулсан).  Нэг талбар
    /// унавал ТЭР талбар null болж, түлхүүр дараагийн шатны (central зам → файлын зам) руу
    /// унана — бүхэл түлхүүр унахгүй.
    /// </summary>
    internal static class RevitDocumentKeys
    {
        /// <summary>Хадгалаагүй баримтад: Document объект тутамд нэг удаа үүсгэсэн тэмдэг.</summary>
        private static readonly DocumentTable<string> SessionIds = new DocumentTable<string>();

        internal static DocumentKey Of(Document doc)
        {
            if (doc == null) throw new ArgumentNullException("doc");
            return DocumentKeyBuilder.Build(FactsOf(doc));
        }

        /// <summary>Хаагдсан баримтын түр тэмдгийг цэвэрлэнэ (`DocumentClosed` үед, үндсэн thread).</summary>
        internal static void PurgeClosed()
        {
            SessionIds.PurgeDead();
        }

        internal static DocumentFacts FactsOf(Document doc)
        {
            var f = new DocumentFacts();

            try { f.CreationGuid = doc.CreationGUID.ToString(); } catch (Exception) { }
            try { f.ProjectInfoUniqueId = doc.ProjectInformation != null ? doc.ProjectInformation.UniqueId : null; } catch (Exception) { }
            try { f.PathName = doc.PathName; } catch (Exception) { }
            try { f.Title = doc.Title; } catch (Exception) { }
            try { f.IsFamily = doc.IsFamilyDocument; } catch (Exception) { }
            try { f.IsLinked = doc.IsLinked; } catch (Exception) { }

            try { f.IsCloud = doc.IsModelInCloud; } catch (Exception) { }
            if (f.IsCloud)
            {
                try
                {
                    ModelPath p = doc.GetCloudModelPath();
                    f.CloudProjectGuid = p.GetProjectGUID().ToString();
                    f.CloudModelGuid = p.GetModelGUID().ToString();
                }
                catch (Exception) { }
            }

            try { f.IsWorkshared = doc.IsWorkshared; } catch (Exception) { }
            if (f.IsWorkshared)
            {
                try
                {
                    ModelPath central = doc.GetWorksharingCentralModelPath();
                    if (central != null)
                        f.CentralPath = ModelPathUtils.ConvertModelPathToUserVisiblePath(central);
                }
                catch (Exception) { }
            }

            f.SessionId = SessionIds.GetOrAdd(doc, () => Guid.NewGuid().ToString("N").Substring(0, 12));
            return f;
        }
    }

    /// <summary>
    /// Нэг host баримтын хүрээнд `ElementKey` үүсгэгч — баримт/линкийн түлхүүрийг НЭГ удаа
    /// тооцож, элемент бүрт дахин тооцохгүй (хэдэн арван мянган элемент дээр хэмнэлттэй).
    /// </summary>
    internal sealed class RevitKeyScope
    {
        private readonly string _hostId;
        private readonly Dictionary<long, string> _linkDocIds = new Dictionary<long, string>();

        internal DocumentKey HostKey { get; private set; }

        internal RevitKeyScope(Document host)
        {
            HostKey = RevitDocumentKeys.Of(host);
            _hostId = HostKey.Id;
        }

        internal ElementKey Host(Element e)
        {
            return ElementKey.Host(_hostId, e.UniqueId);
        }

        /// <summary>
        /// Линк загварын элемент.  `linkDoc` = `RevitLinkInstance.GetLinkDocument()`;
        /// `via` = host доторх линкийн instance.  Линкийн баримтын түлхүүр instance тутамд
        /// нэг удаа тооцогдоно.
        /// </summary>
        internal ElementKey Linked(RevitLinkInstance via, Document linkDoc, Element e)
        {
            string linkDocId;
            long viaId = via.Id.Value;
            if (!_linkDocIds.TryGetValue(viaId, out linkDocId))
            {
                linkDocId = RevitDocumentKeys.Of(linkDoc).Id;
                _linkDocIds[viaId] = linkDocId;
            }
            return ElementKey.Linked(_hostId, via.UniqueId, linkDocId, e.UniqueId);
        }
    }
}
