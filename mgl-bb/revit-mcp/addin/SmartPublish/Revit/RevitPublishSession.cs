using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.Smart;
using RevitMcpAddin.Smart.Core;
using RevitMcpAddin.SmartPublish.Core;

namespace RevitMcpAddin.SmartPublish
{
    /// <summary>
    /// `IPublishSession`-ий Revit-тэй хэрэгжүүлэлт: цонхонд ХУУЛСАН (detached) өгөгдлийг өгч, Revit-ийн
    /// амьд обьектыг цонх руу ЗӨВХӨН нэг удаа (бүтээгдэх үед) ХУУЛЖ өгнө.  Цонх Revit API-д хүрэхгүй.
    ///
    /// ⚠️ Revit-ийн үндсэн thread, хүчинтэй API контекстод л бүтээнэ (IExternalCommand.Execute).
    /// </summary>
    internal sealed class RevitPublishSession : IPublishSession
    {
        private readonly Document _doc;
        private readonly HashSet<string> _dwg;
        private readonly HashSet<string> _threeD;
        private readonly bool _isFamily;

        internal DocumentKey Key { get; private set; }

        public string DocumentTitle { get; private set; }
        public IReadOnlyList<PublishItem> Items { get; private set; }
        public PublishContext Project { get; private set; }
        public PublishProfilesFile Profiles { get; private set; }
        public IFileSystem Fs { get { return RealFileSystem.Instance; } }
        public IReadOnlyCollection<string> DwgSetupNames { get { return _dwg; } }
        public IReadOnlyCollection<string> ThreeDViewNames { get { return _threeD; } }

        /// <summary>Командын хийсэн «өөрчлөгдсөн хуудас» шинжилгээ (дараагийн цонхонд дамжина).  Гаргалтын дараа цэвэрлэгдэнэ.</summary>
        public AffectedPublishSet Affected { get; internal set; }

        internal RevitPublishSession(Document doc)
        {
            _doc = doc;
            Key = RevitDocumentKeys.Of(doc);
            DocumentTitle = Key.Display;
            Project = PublishCollector.CollectContext(doc);
            Items = PublishCollector.CollectItems(doc, includeViews: true);

            EnvironmentFacts env = PublishCollector.CollectEnvironment(doc, null);
            _dwg = env.DwgSetupNames;
            _threeD = env.ThreeDViewNames;
            _isFamily = env.IsFamilyDocument;

            Profiles = PublishProfileStore.Load();
        }

        public EnvironmentFacts EnvFor(PublishProfile profile)
        {
            var env = new EnvironmentFacts
            {
                DwgSetupNames = _dwg,
                ThreeDViewNames = _threeD,
                IsFamilyDocument = _isFamily,
            };
            // PDF тохиргооны enum нэрсийг Revit-ийн enum-д задалж шалгана (шинэ PDFExportOptions үүсгэнэ — API контекстод).
            if (profile != null && profile.Pdf != null) PdfOptionsBuilder.Validate(profile.Pdf, env.InvalidPdfSettings);
            return env;
        }

        public bool SaveProfiles()
        {
            if (PublishProfileStore.Save(Profiles)) return true;
            SmartLog.Warn("publish", "profiles_save_failed");
            return false;
        }

        public PublishHistory History()
        {
            return PublishHistoryStore.Load(Key);
        }

        public IReadOnlyDictionary<string, SheetCheckpoint> CheckpointsFor(string profileId)
        {
            Dictionary<string, SheetCheckpoint> map;
            return PublishCheckpointStore.Load(Key).Profiles.TryGetValue(profileId ?? "", out map)
                ? map
                : new Dictionary<string, SheetCheckpoint>();
        }
    }
}
