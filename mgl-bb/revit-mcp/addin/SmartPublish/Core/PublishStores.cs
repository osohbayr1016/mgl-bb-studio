using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.SmartPublish.Core
{
    public sealed class PublishProfilesFile
    {
        public List<PublishProfile> Profiles { get; set; } = new List<PublishProfile>();
        /// <summary>Жишээ профайлууд нэг удаа суулгагдсан — хэрэглэгч бүгдийг устгавал дахин БИШ.</summary>
        public bool StartersSeeded { get; set; }
        public string LastProfileId { get; set; }
        /// <summary>Профайл тутмын сүүлд сонгосон гаргах хавтас (профайлд хавтас заагаагүй үед санал болгоно).</summary>
        public Dictionary<string, string> LastFolders { get; set; } = new Dictionary<string, string>();
    }

    /// <summary>
    /// Профайлын ХЭРЭГЛЭГЧИЙН ГЛОБАЛ хадгалалт (`profiles.json`) — төсөл хооронд дахин ашиглагдана.
    /// Эхний удаа `PublishStarters`-ийн жишээ профайлуудыг суулгана (ЗАСАХ/УСТГАХ боломжтой).
    /// </summary>
    public static class PublishProfileStore
    {
        public const int Schema = 1;
        public const string FileName = "profiles.json";

        public static PublishProfilesFile Load(SmartStore store = null)
        {
            store = store ?? SmartStore.Default;
            LoadResult<PublishProfilesFile> r = store.Load<PublishProfilesFile>(FileName, Schema, () => new PublishProfilesFile());
            PublishProfilesFile file = r.Value ?? new PublishProfilesFile();
            if (file.Profiles == null) file.Profiles = new List<PublishProfile>();

            // Мөр бүрийн null талбаруудыг хамгаална (гараар засварласан/хуучин файл).
            foreach (PublishProfile p in file.Profiles) Normalize(p);

            if (!file.StartersSeeded && file.Profiles.Count == 0)
            {
                file.Profiles.AddRange(PublishStarters.Create());
                file.StartersSeeded = true;
                // Файл уншигдаагүй (түгжигдсэн) эсвэл шинэ хувилбарынх бол жишээг ЗӨВХӨН санах ойд — диск дээрх
                // бодит профайлуудыг (хэрэглэгчийн засвар) ДАРЖ БИЧИХГҮЙ.
                if (r.Status != LoadStatus.Unreadable && r.Status != LoadStatus.NewerSchema) Save(file, store);
            }
            return file;
        }

        public static bool Save(PublishProfilesFile file, SmartStore store = null)
        {
            store = store ?? SmartStore.Default;
            return store.Save(FileName, Schema, file);
        }

        /// <summary>
        /// Профайлыг нэмнэ/солино.  Агуулга өөрчлөгдсөн (`Version`-оос бусад) бол `Version`-ийг
        /// ӨСГӨНӨ — гаргалтын түүх «аль хувилбарын профайлаар гарсан»-ыг тэмдэглэнэ.
        /// </summary>
        public static PublishProfile Upsert(PublishProfilesFile file, PublishProfile profile)
        {
            Normalize(profile);
            int idx = file.Profiles.FindIndex(p => p.Id == profile.Id);
            if (idx < 0)
            {
                if (profile.Version < 1) profile.Version = 1;
                file.Profiles.Add(profile);
                return profile;
            }

            PublishProfile old = file.Profiles[idx];
            int oldVersion = old.Version;
            string a = ContentJson(old);
            string b = ContentJson(profile);
            profile.Version = a == b ? oldVersion : oldVersion + 1;
            file.Profiles[idx] = profile;
            return profile;
        }

        public static bool Delete(PublishProfilesFile file, string profileId)
        {
            return file.Profiles.RemoveAll(p => p.Id == profileId) > 0;
        }

        /// <summary>Жишээ профайлуудыг (нэр давхцахгүйгээр) дахин нэмнэ.</summary>
        public static int RestoreStarters(PublishProfilesFile file)
        {
            int added = 0;
            foreach (PublishProfile s in PublishStarters.Create())
            {
                if (file.Profiles.Any(p => string.Equals(p.Name, s.Name, StringComparison.OrdinalIgnoreCase))) continue;
                file.Profiles.Add(s);
                added++;
            }
            file.StartersSeeded = true;
            return added;
        }

        private static string ContentJson(PublishProfile p)
        {
            PublishProfile c = p.Clone();
            c.Version = 0;
            return SmartJson.Serialize(c);
        }

        /// <summary>Файлаас ирсэн профайлын null талбаруудыг анхдагчаар дүүргэнэ (шинэ талбар нэмэгдсэн хуучин файл).</summary>
        public static void Normalize(PublishProfile p)
        {
            if (p == null) return;
            if (string.IsNullOrWhiteSpace(p.Id)) p.Id = SmartHash.NewId();
            if (p.Formats == null) p.Formats = new List<PublishFormat>();
            if (p.Selection == null) p.Selection = new SelectionRule();
            if (p.Selection.Conditions == null) p.Selection.Conditions = new List<ItemCondition>();
            if (p.Naming == null) p.Naming = new NamingSettings();
            if (p.Destination == null) p.Destination = new DestinationRule();
            if (p.Pdf == null) p.Pdf = new PdfSettings();
            if (p.Dwg == null) p.Dwg = new DwgSettings();
            if (p.Ifc == null) p.Ifc = new IfcSettings();
            if (p.Ifc.ExtraOptions == null) p.Ifc.ExtraOptions = new Dictionary<string, string>();
            if (p.Revision == null) p.Revision = new RevisionRule();
            if (p.RequiredParameters == null) p.RequiredParameters = new List<string>();
            if (p.SeverityOverrides == null) p.SeverityOverrides = new Dictionary<string, PreflightSeverity>();
            if (p.Overwrite == OverwriteMode.Unknown) p.Overwrite = OverwriteMode.Version;
            if (p.Naming.OnMissing == MissingTokenPolicy.Unknown) p.Naming.OnMissing = MissingTokenPolicy.Error;
            if (p.Naming.Duplicates == DuplicateNamePolicy.Unknown) p.Naming.Duplicates = DuplicateNamePolicy.Block;
            if (p.Version < 1) p.Version = 1;
        }
    }

    /// <summary>Файл тутмын гаргалтын түүх.  Ачаалах/хадгалах нь `DocStore`-ийн гэрээг дагана.</summary>
    public static class PublishHistoryStore
    {
        public const int Schema = 1;
        public const int MaxRuns = 200;

        private static readonly DocStore<PublishHistory> Store =
            new DocStore<PublishHistory>("publish-history.json", Schema, () => new PublishHistory(), indented: false);

        public static PublishHistory Load(DocumentKey key)
        {
            PublishHistory h = Store.Load(key).Value ?? new PublishHistory();
            if (h.Runs == null) h.Runs = new List<PublishRun>();
            return h;
        }

        /// <summary>Гүйлтийг нэмнэ; ижил `Id` байвал (Running → дууссан) СОЛИНО.  Хуучин түүхийг MaxRuns-д тайрна.</summary>
        public static bool Upsert(DocumentKey key, PublishRun run, out string error)
        {
            PublishHistory h = Load(key);
            int idx = h.Runs.FindIndex(r => r.Id == run.Id);
            if (idx >= 0) h.Runs[idx] = run;
            else h.Runs.Insert(0, run);
            if (h.Runs.Count > MaxRuns) h.Runs.RemoveRange(MaxRuns, h.Runs.Count - MaxRuns);
            return Store.Save(key, h, out error);
        }
    }

    /// <summary>Хуудас тутмын «хамгийн сүүлд АМЖИЛТТАЙ гаргасан» тэмдэг (`PublishCheckpoints`).</summary>
    public static class PublishCheckpointStore
    {
        public const int Schema = 1;

        private static readonly DocStore<PublishCheckpoints> Store =
            new DocStore<PublishCheckpoints>("publish-checkpoints.json", Schema, () => new PublishCheckpoints(), indented: false);

        public static PublishCheckpoints Load(DocumentKey key)
        {
            LoadResult<PublishCheckpoints> r = Store.Load(key);
            PublishCheckpoints c = r.Value ?? new PublishCheckpoints();
            if (c.Profiles == null) c.Profiles = new Dictionary<string, Dictionary<string, SheetCheckpoint>>();
            // Диск дээрх хамгийн ИХ өөрчлөлтийн дугаарыг тэмдэглэнэ: системийн цаг ухарсан ч шинэ дугаар (watermark) хуучнаас бага гарахгүй.
            if (r.Status == LoadStatus.Ok || r.Status == LoadStatus.Migrated)
            {
                long max = 0;
                foreach (Dictionary<string, SheetCheckpoint> map in c.Profiles.Values)
                {
                    if (map == null) continue;
                    foreach (SheetCheckpoint cp in map.Values)
                    {
                        if (cp == null) continue;
                        max = Math.Max(max, cp.ChangeSeq);
                        if (cp.Formats != null)
                            foreach (FormatStamp fs in cp.Formats.Values) if (fs != null) max = Math.Max(max, fs.ChangeSeq);
                    }
                }
                ImpactSeq.Observe(max);
            }
            return c;
        }

        public static bool Save(DocumentKey key, PublishCheckpoints c, out string error)
        {
            return Store.Save(key, c, out error);
        }

        private static string Key(PublishFormat f)
        {
            return f.ToString().ToLowerInvariant();
        }

        /// <summary>
        /// Хуудас тутмын checkpoint-д ОРОХ форматууд.  ⚠️ IFC нь ЗАГВАРЫН түвшний нэг файл (`ItemId "*"`, гишүүнгүй) — ямар ч хуудсанд хамаарахгүй
        /// тул хуудасны «бүрэн гарсан» нөхцөлд ОРОХГҮЙ.  Үгүй бол IFC-тэй профайл (Authority/Archive жишээ) хуудсыг ХЭЗЭЭ Ч «бүрэн гарсан» болгохгүй:
        /// нэг ч хуудас «Хэсэгчлэн»-ээс гарахгүй, «нөлөөлөгдсөн хуудас» шинжилгээ бүгдийг «хараахан гаргаагүй» гэж үзнэ.
        /// </summary>
        public static List<PublishFormat> SheetFormats(IEnumerable<PublishFormat> formats)
        {
            return (formats ?? new PublishFormat[0]).Where(f => f != PublishFormat.Unknown && f != PublishFormat.Ifc).Distinct().ToList();
        }

        /// <summary>
        /// Checkpoint-д ДУТУУ формат — жишээ нь профайлд DWG нэмсэний дараа хуучин «PDF-only» checkpoint.  Формат тэмдэггүй хуучин checkpoint-д
        /// (`Formats == null`) тэр үеийн форматыг мэдэх боломжгүй тул хоосон буцаана (өмнөх зан төлөв).
        /// </summary>
        public static List<PublishFormat> MissingFormats(SheetCheckpoint cp, IEnumerable<PublishFormat> required)
        {
            var missing = new List<PublishFormat>();
            if (cp == null || cp.Formats == null) return missing;
            foreach (PublishFormat f in SheetFormats(required))
                if (!cp.Formats.ContainsKey(Key(f))) missing.Add(f);
            return missing;
        }

        /// <summary>Форматуудын тогтвортой түлхүүр («dwg+pdf») — шинжилгээ аль профайл/формат багцад хийгдсэнийг тэмдэглэнэ.</summary>
        public static string FormatsKey(IEnumerable<PublishFormat> formats)
        {
            return string.Join("+", SheetFormats(formats).Select(Key).OrderBy(x => x, StringComparer.Ordinal));
        }

        /// <summary>
        /// ЗӨВХӨН АМЖИЛТТАЙ ШИНЭЭР гарсан форматын тэмдгийг ахиулна.  Бүтэлгүйтсэн / цуцлагдсан / АЛГАССАН файл тэмдгээ ӨӨРЧЛӨХГҮЙ —
        /// хүлээгдэж буй өөрчлөлт алдагдахгүй.
        ///
        /// ФОРМАТ БҮРЭЭР: хуудасны нэг форматын БҮХ файл (хуудас тутмын + нэгтгэсэн PDF/DWG-ийн гишүүнчлэл) амжилттай болсон бол л тэр
        /// форматын тэмдэг шинэчлэгдэнэ.  Хуудасны checkpoint = профайлын БҮХ ХУУДАСНЫ форматын ХАМГИЙН ЭРТ тэмдэг (min): DWG-ийг ДАХИН ОРОЛДОЖ
        /// амжилттай болгоход PDF нь хуучин хэвээр байвал checkpoint шинэ болохгүй.  Профайлын зарим формат хараахан амжилттай гараагүй
        /// бол checkpoint `Partial` (бүрэн гараагүй).  IFC (загварын түвшний) хуудасны checkpoint-д ОРОХГҮЙ — `SheetFormats`.
        /// «Алгассан» (SkipExisting) нь ШИНЭ гаргалт БИШ: байгаа файл хуучин агуулгатай байж болно.
        /// </summary>
        public static void Advance(PublishCheckpoints cps, PublishRun run, IReadOnlyDictionary<string, string> revisionByItem)
        {
            if (cps.Profiles == null) cps.Profiles = new Dictionary<string, Dictionary<string, SheetCheckpoint>>();
            Dictionary<string, SheetCheckpoint> map;
            if (!cps.Profiles.TryGetValue(run.ProfileId, out map))
            {
                map = new Dictionary<string, SheetCheckpoint>(StringComparer.Ordinal);
                cps.Profiles[run.ProfileId] = map;
            }

            List<PublishFormat> profileFormats = SheetFormats(run.Formats);
            var stamp = new FormatStamp
            {
                RunId = run.Id,
                Utc = run.EndedUtc ?? run.StartedUtc,
                ChangeSeq = run.ChangeSeqAtStart ?? 0,
                DocVersionGuid = run.DocVersionGuidAtStart,
            };

            foreach (string itemId in run.ItemIds ?? new List<string>())
            {
                // IFC/Unknown артифакт ямар ч хуудсанд хамаарахгүй (IFC = загвар, `MemberIds` хоосон); хамгаалалтаар шүүнэ.
                List<PublishArtifact> related = run.Artifacts
                    .Where(a => a.Format != PublishFormat.Ifc && a.Format != PublishFormat.Unknown
                        && (a.ItemId == itemId || (a.MemberIds != null && a.MemberIds.Contains(itemId))))
                    .ToList();
                if (related.Count == 0) continue;

                // Формат бүрд: хуудсанд хамаарах БҮХ файл амжилттай ШИНЭЭР гарсан үед л тэр формат шинэчлэгдэнэ.
                var fresh = new List<PublishFormat>();
                foreach (IGrouping<PublishFormat, PublishArtifact> g in related.GroupBy(a => a.Format))
                    if (g.All(a => a.Status == ArtifactStatus.Succeeded)) fresh.Add(g.Key);
                if (fresh.Count == 0) continue;

                // Шаардагдах формат = профайлын хуудасны формат ∪ энэ гүйлтэд энэ хуудсанд оролдсон формат (профайл тодорхойгүй ч аюулгүй).
                var required = new List<PublishFormat>(profileFormats);
                foreach (PublishFormat f in related.Select(a => a.Format).Distinct())
                    if (!required.Contains(f)) required.Add(f);

                SheetCheckpoint prev;
                map.TryGetValue(itemId, out prev);
                var formats = new Dictionary<string, FormatStamp>(StringComparer.OrdinalIgnoreCase);
                if (prev != null)
                {
                    if (prev.Formats != null)
                    {
                        foreach (KeyValuePair<string, FormatStamp> kv in prev.Formats) formats[kv.Key] = kv.Value;
                    }
                    else if (!prev.Partial)
                    {
                        // Хуучин (формат тэмдэггүй) бүрэн checkpoint: тэр гаргалтын БҮХ формат нэг тэмдэгтэй байсан.
                        foreach (PublishFormat f in required)
                            formats[Key(f)] = new FormatStamp { RunId = prev.RunId, Utc = prev.PublishedUtc, ChangeSeq = prev.ChangeSeq, DocVersionGuid = prev.DocVersionGuid };
                    }
                }
                foreach (PublishFormat f in fresh) formats[Key(f)] = stamp;

                bool complete = required.All(f => formats.ContainsKey(Key(f)));
                // Watermark = байгаа (шаардагдах) форматуудын ХАМГИЙН ЭРТ тэмдэг.
                FormatStamp oldest = required.Where(f => formats.ContainsKey(Key(f))).Select(f => formats[Key(f)])
                    .OrderBy(x => x.ChangeSeq).ThenBy(x => x.Utc).First();

                string rev;
                map[itemId] = new SheetCheckpoint
                {
                    RunId = stamp.RunId,
                    // «Гаргасан» огноо = watermark-тай ЯГ ИЖИЛ (хамгийн эртний формат).  PDF 10-р сарын 1-нд, DWG 2-нд гарсан бол хуудас «10/1-ээр
                    // шинэчлэгдсэн» (10/2 БИШ) — эс бөгөөс 10/1–10/2-ын засвар PDF-д ороогүй атлаа хуудас шинэхэн мэт харагдана.
                    PublishedUtc = oldest.Utc,
                    ChangeSeq = oldest.ChangeSeq,
                    DocVersionGuid = oldest.DocVersionGuid,
                    RevisionNumber = revisionByItem != null && revisionByItem.TryGetValue(itemId, out rev) ? rev : (prev != null ? prev.RevisionNumber : null),
                    Formats = formats,
                    Partial = !complete,
                };
            }
        }
    }
}
