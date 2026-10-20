using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.SmartPublish.Core
{
    /// <summary>Профайлын сонголтын дүрмийг хуудсуудад хэрэглэнэ (ЦЭВЭР).</summary>
    public static class ItemSelection
    {
        /// <summary>Дүрмийн төрлийн шүүлт (placeholder, харагдац) — нөхцөлийг ТООЦОХГҮЙ.</summary>
        public static IEnumerable<PublishItem> Eligible(IEnumerable<PublishItem> all, SelectionRule rule)
        {
            rule = rule ?? new SelectionRule();
            foreach (PublishItem it in all)
            {
                if (it.Kind == PublishItemKind.View && !rule.IncludeViews) continue;
                if (it.IsPlaceholder && !rule.IncludePlaceholders) continue;
                yield return it;
            }
        }

        /// <summary>
        /// Профайлын дүрмээр гарах ХУУДАСНУУД (харагдац/placeholder шүүлт + нөхцөл) — «бүрэн гаргалт» гэж юуг хэлэхийг тодорхойлно.
        /// </summary>
        public static List<PublishItem> SheetsByRule(IEnumerable<PublishItem> all, SelectionRule rule)
        {
            var list = new List<PublishItem>();
            foreach (PublishItem it in Eligible(all ?? new PublishItem[0], rule))
                if (it.Kind == PublishItemKind.Sheet && Matches(it, rule)) list.Add(it);
            return list;
        }

        /// <summary>
        /// Гүйлт профайлын дүрмээр гарах БҮХ хуудсыг хамарсан уу.  Change Impact-ийн «гаргалт» шалгах цэг («сүүлийн гаргалтаас хойш») нь «энэ өөрчлөлтийн
        /// дугаар хүртэл БҮХ зүйл гарсан» гэсэн утгатай — 50 хуудасны 3-ыг гаргасан гүйлт тэгж тэмдэглэгдвэл бусад 47 хуудасны өөрчлөлт нуугдана.
        /// </summary>
        public static bool CoversAllSheets(IEnumerable<PublishItem> all, SelectionRule rule, IEnumerable<string> publishedItemIds, out int covered, out int total)
        {
            List<PublishItem> eligible = SheetsByRule(all, rule);
            var published = new HashSet<string>(publishedItemIds ?? new string[0], StringComparer.Ordinal);
            total = eligible.Count;
            covered = eligible.Count(i => published.Contains(i.Id));
            return total > 0 && covered == total;
        }

        /// <summary>Нөхцөл бүрийг хангасан (AND) хуудас.  Нөхцөлгүй дүрэм = бүгд таарна.</summary>
        public static bool Matches(PublishItem item, SelectionRule rule)
        {
            if (rule == null || rule.Conditions == null) return true;
            foreach (ItemCondition c in rule.Conditions)
                if (!Evaluate(item, c)) return false;
            return true;
        }

        public static bool Evaluate(PublishItem item, ItemCondition c)
        {
            if (c == null || string.IsNullOrWhiteSpace(c.Field)) return true;
            string v = (FieldValue(item, c.Field) ?? "").Trim();
            string target = (c.Value ?? "").Trim();
            switch (c.Op)
            {
                case ConditionOp.Equals: return string.Equals(v, target, StringComparison.OrdinalIgnoreCase);
                case ConditionOp.NotEquals: return !string.Equals(v, target, StringComparison.OrdinalIgnoreCase);
                case ConditionOp.Contains: return target.Length == 0 || v.IndexOf(target, StringComparison.OrdinalIgnoreCase) >= 0;
                case ConditionOp.StartsWith: return v.StartsWith(target, StringComparison.OrdinalIgnoreCase);
                case ConditionOp.EndsWith: return v.EndsWith(target, StringComparison.OrdinalIgnoreCase);
                case ConditionOp.NotEmpty: return v.Length > 0;
                case ConditionOp.IsEmpty: return v.Length == 0;
                default: return false;   // танигдаагүй үйлдэл — таарахгүй гэж үзнэ (аюулгүй тал: гаргахгүй)
            }
        }

        public static string FieldValue(PublishItem item, string field)
        {
            if (item == null || field == null) return null;
            string f = field.Trim();
            if (f.StartsWith("Param:", StringComparison.OrdinalIgnoreCase))
            {
                string v;
                return item.Values != null && item.Values.TryGetValue(f.Substring(6).Trim(), out v) ? v : null;
            }
            switch (f.ToLowerInvariant())
            {
                case "sheetnumber":
                case "number": return item.Number;
                case "sheetname":
                case "name": return item.Name;
                case "revision": return item.RevisionNumber;
                case "revisiondescription": return item.RevisionDescription;
                case "viewtype": return item.ViewType;
            }
            return null;
        }
    }

    /// <summary>Анхны суулгацад ЗАСАХ/УСТГАХ боломжтой жишээ профайлууд — хатуу ажлын урсгал БИШ.</summary>
    public static class PublishStarters
    {
        public static List<PublishProfile> Create()
        {
            var list = new List<PublishProfile>();

            list.Add(new PublishProfile
            {
                Name = "Client Issue — захиалагчид",
                Description = "Захиалагчид гаргах PDF; ревиз заавал, байгаа файлыг дарахгүй (_v2).",
                Starter = true,
                Formats = new List<PublishFormat> { PublishFormat.Pdf },
                Revision = new RevisionRule { Required = true },
                Overwrite = OverwriteMode.Version,
                Naming = new NamingSettings { SheetTemplate = "{ProjectNumber}_{SheetNumber}_{SheetName}_Rev{Revision}" },
                Destination = new DestinationRule { SubfolderTemplate = "{Date:yyyy-MM-dd}" },
            });

            list.Add(new PublishProfile
            {
                Name = "Internal Review — дотоод хяналт",
                Description = "Дотоод шалгалтад зориулсан хурдан PDF; байгаа файлыг дарна.",
                Starter = true,
                Formats = new List<PublishFormat> { PublishFormat.Pdf },
                Overwrite = OverwriteMode.Overwrite,
                Naming = new NamingSettings { SheetTemplate = "{SheetNumber}_{SheetName}[_{Revision}]", OnMissing = MissingTokenPolicy.Empty },
                Destination = new DestinationRule { SubfolderTemplate = "Review" },
                Pdf = new PdfSettings { ExportQuality = null, RasterQuality = "Medium" },
            });

            list.Add(new PublishProfile
            {
                Name = "Authority Submission — хянах байгууллагад",
                Description = "Албан ёсны хүргүүлэлт: PDF + IFC; ревиз заавал, файл давхцвал блоклоно.",
                Starter = true,
                Formats = new List<PublishFormat> { PublishFormat.Pdf, PublishFormat.Ifc },
                Revision = new RevisionRule { Required = true },
                Overwrite = OverwriteMode.Fail,
                Naming = new NamingSettings { SheetTemplate = "{ProjectNumber}_{SheetNumber}_{SheetName}_Rev{Revision}" },
                Destination = new DestinationRule { SubfolderTemplate = "{Format}" },
            });

            list.Add(new PublishProfile
            {
                Name = "Construction — барилгын ажилд",
                Description = "Барилгын ажлын PDF + DWG; байгаа файлыг хадгалж шинэ дугаар өгнө.",
                Starter = true,
                Formats = new List<PublishFormat> { PublishFormat.Pdf, PublishFormat.Dwg },
                Overwrite = OverwriteMode.Version,
                Naming = new NamingSettings { SheetTemplate = "{SheetNumber}_{SheetName}[_Rev{Revision}]", OnMissing = MissingTokenPolicy.Empty },
                Destination = new DestinationRule { SubfolderTemplate = "{Format}" },
            });

            list.Add(new PublishProfile
            {
                Name = "Archive — архив",
                Description = "Бүх формат (PDF + DWG + IFC), огноотой хавтас, файл давхцвал блоклоно.",
                Starter = true,
                Formats = new List<PublishFormat> { PublishFormat.Pdf, PublishFormat.Dwg, PublishFormat.Ifc },
                Overwrite = OverwriteMode.Fail,
                Naming = new NamingSettings { SheetTemplate = "{ProjectNumber}_{SheetNumber}_{SheetName}[_Rev{Revision}]", OnMissing = MissingTokenPolicy.Empty },
                Destination = new DestinationRule { SubfolderTemplate = "{ProjectNumber}/{Date:yyyy-MM-dd}/{Format}" },
            });

            return list;
        }
    }

    public sealed class ArtifactCheck
    {
        public bool Ok { get; set; }
        public PublishFailureCode Code { get; set; }
        public string Note { get; set; }
        /// <summary>Баталгаажсан (эсвэл олдсон) файлын БОДИТ зам.</summary>
        public string Path { get; set; }
        public long Length { get; set; }
        public DateTime? LastWriteUtc { get; set; }
        /// <summary>Хүлээгдсэн нэрээс өөр нэрээр (Revit өөрөөр нэрлэсэн) олдсон.</summary>
        public bool NameDiffered { get; set; }
        /// <summary>
        /// `Path` дахь файл ЭНЭ экспортоор үүссэн/шинэчлэгдсэн (экспортын өмнөх жагсаалтад байгаагүй эсвэл хэмжээ/цаг нь өөрчлөгдсөн).  `Ok` нь
        /// үргэлж шинэ; хоосон (0 байт) ч ШИНЭ файл `Fresh`.  Экспортоос өмнө байсан, шинэчлэгдээгүй файл `Fresh` БИШ — тэр нь манай үлдэгдэл биш.
        /// </summary>
        public bool Fresh { get; set; }
    }

    /// <summary>
    /// Экспортын ДАРАА файлыг шалгана (ЦЭВЭР, `IFileSystem` дээр).
    ///
    /// ⚠️ ЭНЭ БОЛ «БАЙДАЛ» шалгалт: файл байгаа, 0-ээс их, ШИНЭ (экспортын өмнөх хуучин файл
    /// биш).  Агуулгын ЗӨВ БАЙДЛЫГ (PDF зөв зурагдсан, DWG нээгдэнэ) БАТАЛДАГГҮЙ — тэр
    /// нь `docs/SMART.md`-ийн гар шалгалтад.
    ///
    /// ⚠️ ШИНЭ ЭСЭХИЙГ цагаар БИШ, экспортын ӨМНӨХ ба ДАРААХ хавтасны хуулбарыг
    /// харьцуулж шийднэ: сүлжээний сервер ба энэ компьютерийн цаг зөрдөг, мөн «Overwrite»
    /// горимд өмнөх амжилттай гаргалтын файл үлдсэн тул экспорт чимээгүй бүтэлгүйтсэн ч
    /// «файл байна» гэж худал амжилт зарлах эрсдэлтэй.
    /// </summary>
    public static class ArtifactValidator
    {
        public static ArtifactCheck Validate(string expectedPath, IReadOnlyList<FileFacts> before, IReadOnlyList<FileFacts> after)
        {
            before = before ?? new FileFacts[0];
            after = after ?? new FileFacts[0];

            // Зам харьцуулахдаа ХОЁР талыг бүтэн зам болгож (`D:/Out` ↔ `D:\Out`, давхар зураас, `..`) жижиг үсгээр харьцуулна —
            // эс бөгөөс хүснэгтэнд «/»-тэй хавтас бичсэн үед хүлээсэн файл олдохгүй ↔ худал бүтэлгүйтэл.
            Func<string, string> norm = p =>
            {
                try { return System.IO.Path.GetFullPath(p ?? "").ToLowerInvariant(); }
                catch (Exception) { return (p ?? "").ToLowerInvariant(); }
            };
            var beforeMap = new Dictionary<string, FileFacts>(StringComparer.Ordinal);
            foreach (FileFacts f in before) beforeMap[norm(f.Path)] = f;

            Func<FileFacts, bool> fresh = f =>
            {
                FileFacts b;
                if (!beforeMap.TryGetValue(norm(f.Path), out b)) return true;      // шинэ
                return b.LastWriteUtc != f.LastWriteUtc || b.Length != f.Length;   // шинэчлэгдсэн
            };

            FileFacts exact = after.FirstOrDefault(f => norm(f.Path) == norm(expectedPath));
            if (exact != null)
            {
                if (!fresh(exact))
                    return new ArtifactCheck
                    {
                        Ok = false,
                        Code = PublishFailureCode.MissingArtifact,
                        Note = "Файл байгаа ч экспортын үеэр шинэчлэгдээгүй (хуучин файл) — экспорт амжилтгүй болсон байж болзошгүй.",
                        Path = exact.Path,
                        Length = exact.Length,
                        LastWriteUtc = exact.LastWriteUtc,
                        Fresh = false,
                    };
                if (exact.Length <= 0)
                    return new ArtifactCheck { Ok = false, Code = PublishFailureCode.EmptyArtifact, Note = "Файл үүссэн ч хоосон (0 байт).", Path = exact.Path, LastWriteUtc = exact.LastWriteUtc, Fresh = true };
                return new ArtifactCheck { Ok = true, Path = exact.Path, Length = exact.Length, LastWriteUtc = exact.LastWriteUtc, Fresh = true };
            }

            // Хүлээсэн нэр олдсонгүй — Revit өөрөөр нэрлэсэн байж болно (DWG-ийн угтвар г.м.):
            // ижил өргөтгөлтэй ШИНЭ файл яг НЭГ бол түүнийг авна.
            string ext = System.IO.Path.GetExtension(expectedPath ?? "");
            List<FileFacts> candidates = after
                .Where(f => string.Equals(System.IO.Path.GetExtension(f.Path), ext, StringComparison.OrdinalIgnoreCase) && fresh(f))
                .ToList();

            // DWG: хуудас бүрийн хажууд xref файлууд (`name-view.dwg`) үүсч болно.  Хүлээсэн нэрээр ЭХЭЛСЭН шинэ файл яг НЭГ бол түүнийг авна;
            // үгүй бол шинэ файл яг нэг байвал.  Хоёр түвшинд ч тодорхойгүй бол ЭНЭ ФАЙЛ ГЭЖ ТААМАГЛАХГҮЙ.
            string baseName = System.IO.Path.GetFileNameWithoutExtension(expectedPath ?? "");
            List<FileFacts> prefixed = string.IsNullOrEmpty(baseName)
                ? new List<FileFacts>()
                : candidates.Where(f => System.IO.Path.GetFileNameWithoutExtension(f.Path).StartsWith(baseName, StringComparison.OrdinalIgnoreCase)).ToList();
            FileFacts chosen = prefixed.Count == 1 ? prefixed[0] : (candidates.Count == 1 ? candidates[0] : null);
            if (chosen != null)
            {
                FileFacts c = chosen;
                if (c.Length <= 0)
                    return new ArtifactCheck { Ok = false, Code = PublishFailureCode.EmptyArtifact, Note = "Файл үүссэн ч хоосон (0 байт).", Path = c.Path, LastWriteUtc = c.LastWriteUtc, NameDiffered = true, Fresh = true };
                return new ArtifactCheck
                {
                    Ok = true,
                    Fresh = true,
                    Path = c.Path,
                    Length = c.Length,
                    LastWriteUtc = c.LastWriteUtc,
                    NameDiffered = true,
                    Note = "Revit файлыг «" + System.IO.Path.GetFileName(c.Path) + "» нэрээр үүсгэсэн (хүлээсэн нэрээс өөр).",
                };
            }

            return new ArtifactCheck
            {
                Ok = false,
                Code = PublishFailureCode.MissingArtifact,
                Note = candidates.Count == 0
                    ? "Хүлээсэн файл үүссэнгүй."
                    : "Хүлээсэн файл олдсонгүй; ижил өргөтгөлтэй " + candidates.Count + " шинэ файл байгаа тул аль нь болохыг тодорхойлж чадсангүй.",
            };
        }
    }
}

namespace RevitMcpAddin.SmartPublish.Core
{
    /// <summary>Дахин оролдох нэг зорилт: (хуудас, формат).  Нэгтгэсэн PDF/IFC-д `ItemId = "*"`.</summary>
    public sealed class RetryTarget
    {
        public string ItemId { get; set; }
        public PublishFormat Format { get; set; }
    }

    /// <summary>
    /// Бүтэлгүйтсэн (эсвэл цуцлагдсан — огт оролдоогүй) файлуудыг ШИНЭ гүйлтээр дахин оролдоно.
    /// ⚠️ Анхны гүйлтийн түүх ХӨНДӨГДӨХГҮЙ: шинэ `PublishRun` (`ParentRunId`-тай) үүснэ.
    /// </summary>
    public static class PublishRetry
    {
        public static List<RetryTarget> Targets(PublishRun run)
        {
            return run.Artifacts
                .Where(a => a.Status == ArtifactStatus.Failed || a.Status == ArtifactStatus.Cancelled)
                .Select(a => new RetryTarget { ItemId = a.ItemId, Format = a.Format })
                .Distinct(new TargetComparer())
                .ToList();
        }

        /// <summary>Дахин оролдоход шаардлагатай хуудсууд (нэгтгэсэн файлын бүх гишүүнийг оруулна).</summary>
        public static List<string> ItemIds(PublishRun run)
        {
            var ids = new List<string>();
            foreach (PublishArtifact a in run.Artifacts.Where(x => x.Status == ArtifactStatus.Failed || x.Status == ArtifactStatus.Cancelled))
            {
                if (a.ItemId == "*") ids.AddRange(a.MemberIds ?? new List<string>());
                else if (!string.IsNullOrEmpty(a.ItemId)) ids.Add(a.ItemId);
            }
            return ids.Distinct(StringComparer.Ordinal).ToList();
        }

        /// <summary>
        /// Дахин төлөвлөхөд ашиглах хуудсууд: ЭХ гүйлтийн БҮХ хуудас, эх дараалалтайгаа.  ⚠️ Зөвхөн бүтэлгүйтсэн хуудсаар төлөвлөвөл
        /// `{Index}`, `{SheetCount}`, `{FirstSheet}`, давхардлын дагавар (`_2`) өөр гарч, дахин оролдлого ӨӨР НЭРТЭЙ файл үүсгэнэ — тиймээс
        /// БҮХ хуудсаар төлөвлөж, дараа нь `Filter`-ээр зорилтуудыг л үлдээнэ.
        /// </summary>
        public static List<string> PlanItemIds(PublishRun run)
        {
            var ids = new List<string>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (string id in run.ItemIds ?? new List<string>())
                if (!string.IsNullOrEmpty(id) && seen.Add(id)) ids.Add(id);
            // Хуучин/дутуу бичигдсэн түүх: бүтэлгүйтсэн артифактын хуудсуудыг нөхнө.
            foreach (string id in ItemIds(run))
                if (seen.Add(id)) ids.Add(id);
            return ids;
        }

        /// <summary>
        /// Дахин оролдлого эх гүйлттэй ЯГ ИЖИЛ «одоо»-гоор төлөвлөнө — `{Date}` токен өөр өдөр/сессид (түүхээс дахин оролдох) өөрчлөгдөж нэр
        /// (мөн огноотой хавтас) шилжихээс сэргийлнэ.  Хуучин түүхэнд (`PlanNowUtc` үгүй) гүйлтийн эхлэх цагийг ашиглана.
        /// </summary>
        public static PublishContext ContextFor(PublishContext project, PublishRun parent)
        {
            project = project ?? new PublishContext();
            var c = new PublishContext
            {
                DocumentTitle = project.DocumentTitle,
                ProjectName = project.ProjectName,
                ProjectNumber = project.ProjectNumber,
                ProjectClient = project.ProjectClient,
                ProjectAddress = project.ProjectAddress,
                ProjectStatus = project.ProjectStatus,
                ProjectValues = new Dictionary<string, string>(project.ProjectValues ?? new Dictionary<string, string>(), StringComparer.OrdinalIgnoreCase),
                Now = project.Now,
            };
            DateTime? then = parent != null ? (parent.PlanNowUtc ?? (parent.StartedUtc == default(DateTime) ? (DateTime?)null : parent.StartedUtc)) : null;
            if (then.HasValue) c.Now = then.Value.ToLocalTime();
            return c;
        }

        /// <summary>
        /// ЭНЭ гүйлт ӨӨРӨӨ диск дээр үлдээсэн (бүрэн бус байж болзошгүй) файлуудын замууд.  ⚠️ Бүтэлгүйтсэн артифактын `Path` БИШ — тэр нь
        /// төлөвлөсөн зам бөгөөд тэнд өөр хүний (`TargetChanged`) эсвэл өмнөх гаргалтын файл байж болно; тэдгээрийг дахин оролдлого ДАРЖ БИЧИХ ЁСГҮЙ.
        /// </summary>
        public static List<string> OwnPartialPaths(PublishRun run)
        {
            // Цуцлагдсан артифакт ч (`CarryForwardPartial`: өмнөх оролдлогын файлыг энэ оролдлого хөндөөгүй) өөрийн үлдээсэн замыг дамжуулж болно.
            return run.Artifacts
                .Where(a => (a.Status == ArtifactStatus.Failed || a.Status == ArtifactStatus.Cancelled) && !string.IsNullOrEmpty(a.PartialPath))
                .Select(a => a.PartialPath)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
        }

        /// <summary>
        /// `OwnPartialPaths` + диск дээрх файл ОДОО ч бидний үлдээсэн хэвээр эсэхийн шалгалт (хэмжээ ба өөрчилсөн цаг таарна).  Хэн нэгэн (гараар экспортолсон,
        /// өөр процесс) тэр замд ӨӨР файл тавьсан бол энэ нь бидний үлдэгдэл БИШ — дахин оролдлого түүнийг нуух/дарж бичих ёсгүй, профайлын «байгаа файл»
        /// дүрэм (алгасах / блоклох / шинэ дугаар / дарах асуулт) хэвээр хэрэглэгдэнэ.  Файл алга бол нуух зүйл байхгүй тул оруулахгүй.
        /// </summary>
        public static List<string> OwnPartialPaths(PublishRun run, IFileSystem fs)
        {
            var result = new List<string>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (PublishArtifact a in run.Artifacts.Where(x => (x.Status == ArtifactStatus.Failed || x.Status == ArtifactStatus.Cancelled) && !string.IsNullOrEmpty(x.PartialPath)))
            {
                if (!seen.Add(PathKey.Of(a.PartialPath))) continue;
                if (StillOurs(a, fs)) result.Add(a.PartialPath);
            }
            return result;
        }

        /// <summary>
        /// Хурууны хээ: хэмжээ тэнцүү, өөрчилсөн цаг ≤ 2 с зөрүүтэй (FAT/exFAT-ийн 2 секундийн нарийвчлал).  Өөрчилсөн цаг тэмдэглэгдээгүй (хуучин
        /// бичлэг) бол зөвхөн хэмжээгээр.
        /// </summary>
        public static bool StillOurs(PublishArtifact art, IFileSystem fs)
        {
            if (art == null || string.IsNullOrEmpty(art.PartialPath) || fs == null) return false;
            FileFacts f = fs.GetFile(art.PartialPath);
            if (f == null) return false;
            if (f.Length != art.SizeBytes) return false;
            if (art.CreatedUtc.HasValue && Math.Abs((f.LastWriteUtc - art.CreatedUtc.Value).TotalSeconds) > 2.0) return false;
            return true;
        }

        /// <summary>
        /// Өмнөх оролдлогын ӨӨРИЙН хэсэгчилсэн файл (`knownKeys` = `PathKey` олонлог) энэ оролдлогод ч бүтэлгүйтсэн/цуцлагдсан артифактын зорилтот зам дээр
        /// ХЭВЭЭР байвал (түгжигдсэн файл `OutputLocked`, хавтас бичигдэхгүй, хэрэглэгч цуцалсан — энэ оролдлого файлыг ХӨНДӨӨГҮЙ) түүнийг энэ артифактад
        /// ДАМЖУУЛНА.  Эс бөгөөс дараагийн оролдлого өөрийн үлдээсэн файлаа «мартаж»: `Skip` горимд эвдэрсэн файлыг «алгассан» гэж хүлээн авна, `Version`-д
        /// `_v2` болгож эвдэрсэн нь үлдэнэ, `Overwrite`-д дарж бичих асуулт гаргана.  Энэ оролдлого өөрөө хэсэгчилсэн файл үлдээсэн (`PartialPath` бөглөгдсөн) бол хөндөхгүй.
        /// </summary>
        public static void CarryForwardPartial(PublishArtifact art, string plannedPath, ICollection<string> knownKeys, IFileSystem fs)
        {
            if (art == null || string.IsNullOrEmpty(plannedPath) || knownKeys == null || knownKeys.Count == 0 || fs == null) return;
            if (art.Status != ArtifactStatus.Failed && art.Status != ArtifactStatus.Cancelled) return;
            if (!string.IsNullOrEmpty(art.PartialPath)) return;
            if (!knownKeys.Contains(PathKey.Of(plannedPath))) return;
            FileFacts f = fs.GetFile(plannedPath);
            if (f == null) return;                                  // файл одоо алга — дамжуулах зүйл байхгүй
            art.PartialPath = f.Path;
            art.SizeBytes = f.Length;
            art.CreatedUtc = f.LastWriteUtc;
            art.Notes.Add("Өмнөх оролдлогын хэсэгчилсэн файл хэвээр үлдсэн: " + System.IO.Path.GetFileName(f.Path));
        }

        /// <summary>Төлөвлөгөөнөөс зөвхөн зорилтуудад (мөн тэдгээрийн нэрийн асуудалд) хамаарах файлуудыг үлдээнэ.</summary>
        public static PublishPlan Filter(PublishPlan plan, IReadOnlyList<RetryTarget> targets)
        {
            var keep = new HashSet<string>(targets.Select(t => t.ItemId + "|" + t.Format), StringComparer.Ordinal);
            return new PublishPlan
            {
                Artifacts = plan.Artifacts.Where(a => keep.Contains(a.ItemId + "|" + a.Format)).ToList(),
                // Бүх хуудсаар төлөвлөсөн тул дахин оролдохгүй хуудсуудын нэрийн асуудал (давхардал, тэмдэгт) preflight-ийг блоклох ёсгүй.
                NameIssues = plan.NameIssues.Where(n => string.IsNullOrEmpty(n.ItemId) || keep.Contains(n.ItemId + "|" + n.Format)).ToList(),
            };
        }

        private sealed class TargetComparer : IEqualityComparer<RetryTarget>
        {
            public bool Equals(RetryTarget x, RetryTarget y) { return x.ItemId == y.ItemId && x.Format == y.Format; }
            public int GetHashCode(RetryTarget t) { return (t.ItemId ?? "").GetHashCode() * 31 + (int)t.Format; }
        }

        /// <summary>
        /// Өмнөх бүтэлгүйтсэн оролдлогын (хэсэгчилсэн) файлыг «байхгүй» мэтээр харуулдаг файлын
        /// систем — дахин оролдлого тэр файлыг `_v2` болгохгүй, ДАРЖ бичнэ.
        /// ⚠️ Замыг БҮТЭН замаар (`D:/Out` ↔ `D:\Out`, давхар зураас, жижиг/том үсэг) харьцуулна — түүхэнд хадгалагдсан `Folder` нь «/»-тэй,
        /// харин файлын жагсаалт «\»-тэй байж болох бөгөөд түүхий тэмдэгтийн харьцуулалт хэсэгчилсэн файлыг нуух ёстой газраа нуухгүй.
        /// </summary>
        public sealed class HidingFileSystem : IFileSystem
        {
            private readonly IFileSystem _inner;
            private readonly HashSet<string> _hidden;

            public HidingFileSystem(IFileSystem inner, IEnumerable<string> hiddenPaths)
            {
                _inner = inner;
                _hidden = new HashSet<string>((hiddenPaths ?? new string[0]).Where(p => !string.IsNullOrEmpty(p)).Select(PathKey.Of), StringComparer.Ordinal);
            }

            private bool Hidden(string path) { return _hidden.Contains(PathKey.Of(path)); }

            public bool FileExists(string path) { return !Hidden(path) && _inner.FileExists(path); }
            public bool DirectoryExists(string path) { return _inner.DirectoryExists(path); }
            public void CreateDirectory(string path) { _inner.CreateDirectory(path); }
            public bool TryProbeWritable(string directory, out string error) { return _inner.TryProbeWritable(directory, out error); }
            public FileFacts GetFile(string path) { return Hidden(path) ? null : _inner.GetFile(path); }
            public IReadOnlyList<FileFacts> ListFiles(string directory)
            {
                return _inner.ListFiles(directory).Where(f => !Hidden(f.Path)).ToList();
            }
        }
    }

    /// <summary>
    /// Файлын замыг ХАРЬЦУУЛАХ түлхүүр: бүтэн зам (`D:/Out` ↔ `D:\Out`, `..`, давхар зураас), жижиг үсгээр.  Харьцуулалт хийдэг БҮХ газар (хэсэгчилсэн
    /// файл нуух, төлөвлөгөө ↔ диск уралдаан) ЭНЭ ганц функцийг хэрэглэнэ — өөр өөр хэлбэртэй бичигдсэн замыг ижил гэж таньна.
    /// </summary>
    public static class PathKey
    {
        public static string Of(string path)
        {
            try { return System.IO.Path.GetFullPath(path ?? "").ToLowerInvariant(); }
            catch (Exception) { return (path ?? "").Replace('/', '\\').ToLowerInvariant(); }
        }
    }

    /// <summary>
    /// ТӨЛӨВЛӨГӨӨ ↔ ДИСК уралдааны шийдвэр (ЦЭВЭР, тестлэгдэнэ).  Planner хавтсын жагсаалтыг гаргалтаас ӨМНӨ уншдаг; гаргалтын үеэр (өөр хэрэглэгч,
    /// өөр процесс, урт гаргалт) зорилтот файл ҮҮССЭН байж болно.
    ///
    /// ⚠️ «Шинэ дугаартай» (`Versioned`) нь ТӨЛӨВЛӨГДСӨН НЭР (`_v2`) дээр шалгана: эх нэрээр файл байсан (`TargetExists`) нь шинэ нэр чөлөөтэй гэсэн
    /// баталгаа БИШ — `_v2`-ийг өөр хүн үүсгэсэн бол Revit тэрийг чимээгүй дарж бичнэ.  Тиймээс `TargetExists` энд ОГТ ашиглагдахгүй.
    /// </summary>
    public static class PublishRace
    {
        /// <summary>Энэ үйлдлийн зорилтот зам экспортын ӨМНӨ чөлөөтэй байх ёстой юу (зорилтот файлыг дарж бичихээр ТӨЛӨВЛӨӨГҮЙ).</summary>
        public static bool MustBeAbsent(PlanAction action)
        {
            return action != PlanAction.Overwrite && action != PlanAction.SkipExisting;
        }

        /// <summary>
        /// true = төлөвлөгөө гарснаас хойш зорилтот файл ҮҮССЭН — дарж бичихгүй (`PublishFailureCode.TargetChanged`).
        /// `isKnownPartial` = дахин оролдлогын өмнөх оролдлогын ӨӨРИЙН хэсэгчилсэн файл (зориуд дарна).
        /// `existsNow` нь ЗӨВХӨН шаардлагатай үед (дарж бичихээр төлөвлөөгүй, мэдэгдэж буй хэсэгчилсэн биш) дуудагдана — диск рүү илүү хандахгүй.
        /// </summary>
        public static bool TargetAppeared(PlanAction action, Func<bool> existsNow, bool isKnownPartial)
        {
            return MustBeAbsent(action) && !isKnownPartial && existsNow();
        }
    }
}
