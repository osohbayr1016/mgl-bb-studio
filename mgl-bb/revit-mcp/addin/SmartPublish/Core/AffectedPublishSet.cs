using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.ChangeImpact.Core;

namespace RevitMcpAddin.SmartPublish.Core
{
    /// <summary>Хуудасны «өөрчлөлтөөс хойш дахин гаргах хэрэгтэй юу» ангилал.</summary>
    public enum AffectState
    {
        /// <summary>Хуудас биш (харагдац, загвар) — Impact хамаарахгүй.</summary>
        NotApplicable = 0,
        /// <summary>Энэ профайлаар хараахан гаргаагүй — харьцуулах суурь байхгүй.</summary>
        NeverPublished,
        /// <summary>ШУУД (A) нөлөөлөл: гаргалтаас хойш хуудасны агуулгад ТОДОРХОЙ өөрчлөлт орсон.</summary>
        Affected,
        /// <summary>Магадлалтай/боломжтой/сул (B-D) нөлөөлөл, эсвэл «өөрчлөлтгүй» гэж БАТЛАХ боломжгүй — хэрэглэгч шийднэ.</summary>
        Suggested,
        /// <summary>Шинжилгээ хийгдээгүй/унасан.</summary>
        Unknown,
        /// <summary>Бүртгэсэн өөрчлөлтөөр нөлөөлөл олдсонгүй (БАТАЛГАА БИШ — зөвхөн бүртгэсэн өөрчлөлт, мэдэгдэх холбооны хүрээнд).</summary>
        NoImpactFound,
    }

    public sealed class SheetAffect
    {
        public string ItemId { get; set; }
        public AffectState State { get; set; }
        /// <summary>Affected/Suggested үед хамгийн хүчтэй нөлөөллийн итгэл.</summary>
        public ImpactConfidence Confidence { get; set; }
        public List<string> Reasons { get; set; } = new List<string>();
        /// <summary>Хуудасны сүүлийн гаргалтын өөрчлөлтийн дугаар (watermark).</summary>
        public long Watermark { get; set; }
    }

    /// <summary>Шинжилгээний нэг эхлэл: хуудсуудын сүүлийн гаргалтын өөрчлөлтийн дугаар + ТЭР үеийн Revit хувилбарын GUID.</summary>
    public sealed class WatermarkBucket
    {
        public long Seq { get; set; }
        /// <summary>Гаргалтын ЭХЭНД авсан `DocumentVersion` GUID (хувилбарын түүхээр «хойш юу өөрчлөгдсөн»-ийг нэмж шалгахад).  Үл мэдэгдэх бол null.</summary>
        public string VersionGuid { get; set; }
    }

    /// <summary>Нэг watermark-ийн (FromSeq) шинжилгээний үр дүн.</summary>
    public sealed class WatermarkAnalysis
    {
        public long Watermark { get; set; }
        public ImpactReport Report { get; set; }
        /// <summary>Шинжилгээ унасан/цуцлагдсан — энэ бүлгийн хуудсууд `Unknown`.</summary>
        public bool Failed { get; set; }
        public string Error { get; set; }
    }

    /// <summary>
    /// Smart Publish-ийн «ӨӨРЧЛӨГДСӨН ХУУДАС» дүн.  ЦЭВЭР өгөгдөл: Change Impact-ийн тайлан + хуудасны сүүлийн гаргалтын
    /// тэмдгээс гарна.
    ///
    ///   «Нөлөөлөгдсөн» = ЗӨВХӨН A (шууд) + хараахан гаргаагүй.  B/C/D нь «санал болгосон» — ХЭЗЭЭ Ч чимээгүй хасагдахгүй,
    ///   гэхдээ автоматаар «нөлөөлөгдсөн» ч болохгүй.  Бүрэн ГАРГАЛТ (бүх хуудас) үргэлж боломжтой.
    /// </summary>
    public sealed class AffectedPublishSet
    {
        public DateTime Utc { get; set; }
        public Dictionary<string, SheetAffect> BySheet { get; set; } = new Dictionary<string, SheetAffect>(StringComparer.Ordinal);
        public List<string> Notes { get; set; } = new List<string>();
        public int SourceCount { get; set; }
        public bool Incomplete { get; set; }
        /// <summary>
        /// Шинжилгээ аль ПРОФАЙЛД хийгдсэн.  Хуудас бүрийн watermark нь профайл тутмын checkpoint-оос гардаг тул шинжилгээ ӨӨР профайлд
        /// хүчингүй (энэ профайлаар гаргаагүй хуудас нөгөө профайлаар «гарсан» мэт, эсрэгээрээ харагдана).  null = профайлд холбоогүй (хуучин/тест).
        /// </summary>
        public string ProfileId { get; set; }
        /// <summary>Шинжилгээнд тооцсон хуудасны форматын багц (`PublishCheckpointStore.FormatsKey`) — профайлд формат нэмэгдвэл хүчингүй.</summary>
        public string FormatsKey { get; set; }

        /// <summary>Энэ шинжилгээ тухайн профайл + форматын багцад хамаарах уу.  Хамаарахгүй бол цонх шинжилгээг ХАРУУЛАХ/СОНГОХ ёсгүй.</summary>
        public bool AppliesTo(string profileId, IEnumerable<PublishFormat> formats)
        {
            if (string.IsNullOrEmpty(ProfileId) || string.IsNullOrEmpty(profileId)) return false;
            return string.Equals(ProfileId, profileId, StringComparison.Ordinal)
                && string.Equals(FormatsKey ?? "", PublishCheckpointStore.FormatsKey(formats), StringComparison.Ordinal);
        }

        public int Count(AffectState s)
        {
            return BySheet.Values.Count(x => x.State == s);
        }

        public SheetAffect Get(string itemId)
        {
            SheetAffect a;
            return itemId != null && BySheet.TryGetValue(itemId, out a) ? a : null;
        }

        /// <summary>«Зөвхөн нөлөөлөгдсөн» сонголт: шууд (A) нөлөөлөл + хараахан гаргаагүй.</summary>
        public HashSet<string> AffectedIds()
        {
            return new HashSet<string>(BySheet.Values.Where(a => a.State == AffectState.Affected || a.State == AffectState.NeverPublished).Select(a => a.ItemId), StringComparer.Ordinal);
        }

        /// <summary>Нэмж авч үзэх: магадлалтай/боломжтой/сул, шинжлээгүй, «өөрчлөлтгүй гэж батлах боломжгүй».</summary>
        public HashSet<string> SuggestedIds()
        {
            return new HashSet<string>(BySheet.Values.Where(a => a.State == AffectState.Suggested || a.State == AffectState.Unknown).Select(a => a.ItemId), StringComparer.Ordinal);
        }

        public static string StateText(SheetAffect a)
        {
            if (a == null) return "";
            switch (a.State)
            {
                case AffectState.NeverPublished: return "Хараахан гаргаагүй";
                case AffectState.Affected: return "Нөлөөлөгдсөн · " + ImpactConf.Letter(a.Confidence) + " " + ImpactConf.Label(a.Confidence);
                case AffectState.Suggested: return "Санал · " + ImpactConf.Letter(a.Confidence) + " " + ImpactConf.Label(a.Confidence);
                case AffectState.Unknown: return "Шинжлээгүй";
                case AffectState.NoImpactFound: return "Нөлөөлөл олдсонгүй";
                default: return "";
            }
        }
    }

    public static class AffectedPublishResolver
    {
        /// <summary>
        /// Хуудас бүрийн сүүлийн гаргалтын watermark-уудыг ХЯЗГААРТАЙ тооны (≤ `maxGroups`) шинжилгээний эхлэл болгон багцална.
        /// Хуудас бүр ӨӨРИЙН watermark-аас ЭРТ (эсвэл тэнцүү) эхлэлтэй шинжилгээнд хамрагдана — тиймээс хуучин өөрчлөлт
        /// давхар тоологдож болох (хэт тооцоо, аюулгүй тал) ч ХЭЗЭЭ Ч алдагдахгүй.
        /// </summary>
        public static List<long> PlanWatermarks(IEnumerable<long> sheetWatermarks, int maxGroups = 3)
        {
            List<long> distinct = (sheetWatermarks ?? new long[0]).Distinct().OrderBy(x => x).ToList();
            if (maxGroups < 1) maxGroups = 1;
            if (distinct.Count <= maxGroups) return distinct;

            var picked = new SortedSet<long>();
            for (int i = 0; i < maxGroups; i++)
            {
                int idx = maxGroups == 1 ? 0 : (int)Math.Round(i * (distinct.Count - 1) / (double)(maxGroups - 1));
                picked.Add(distinct[idx]);
            }
            return picked.ToList();
        }

        /// <summary>
        /// Хуудсуудын checkpoint-ийг шинжилгээний эхлэлүүд болгон багцлана (≤ `maxGroups`, хамгийн эртний нь үргэлж орно).  Эхлэл бүр ТЭР
        /// өөрчлөлтийн дугаартай checkpoint-ийн Revit хувилбарын GUID-ийг авч явна (baseline).
        /// </summary>
        public static List<WatermarkBucket> PlanBuckets(IEnumerable<SheetCheckpoint> checkpoints, int maxGroups = 3)
        {
            var guidBySeq = new SortedDictionary<long, string>();
            foreach (SheetCheckpoint cp in checkpoints ?? new SheetCheckpoint[0])
            {
                if (cp == null) continue;
                string existing;
                if (!guidBySeq.TryGetValue(cp.ChangeSeq, out existing) || (string.IsNullOrEmpty(existing) && !string.IsNullOrEmpty(cp.DocVersionGuid)))
                    guidBySeq[cp.ChangeSeq] = cp.DocVersionGuid;
            }
            return PlanWatermarks(guidBySeq.Keys, maxGroups)
                .Select(seq => new WatermarkBucket { Seq = seq, VersionGuid = guidBySeq[seq] })
                .ToList();
        }

        private static bool Matches(PublishItem sheet, ImpactItem i)
        {
            if (i.Kind != ImpactNodeKind.Sheet) return false;
            if (sheet.ElementIdValue != 0 && i.Id == sheet.ElementIdValue) return true;
            return !string.IsNullOrEmpty(i.Uid) && string.Equals(i.Uid, sheet.Id, StringComparison.Ordinal);
        }

        /// <param name="profileId">Шинжилгээ хийгдсэн профайл (`AffectedPublishSet.AppliesTo`).</param>
        /// <param name="requiredFormats">Профайлын форматууд: checkpoint-д дутуу формат (профайлд дараа нь нэмэгдсэн) байвал хуудас «бүрэн гараагүй».</param>
        public static AffectedPublishSet Resolve(
            IReadOnlyList<PublishItem> items,
            IReadOnlyDictionary<string, SheetCheckpoint> checkpoints,
            IReadOnlyList<WatermarkAnalysis> analyses,
            string currentVersionGuid,
            DateTime? now = null,
            string profileId = null,
            IEnumerable<PublishFormat> requiredFormats = null)
        {
            var set = new AffectedPublishSet
            {
                Utc = now ?? DateTime.UtcNow,
                ProfileId = profileId,
                FormatsKey = PublishCheckpointStore.FormatsKey(requiredFormats),
            };
            List<PublishFormat> required = PublishCheckpointStore.SheetFormats(requiredFormats);
            analyses = analyses ?? new List<WatermarkAnalysis>();
            set.SourceCount = analyses.Where(a => a.Report != null).Select(a => a.Report.SourceCount).DefaultIfEmpty(0).Max();
            set.Incomplete = analyses.Any(a => a.Failed || (a.Report != null && a.Report.Incomplete));

            foreach (PublishItem it in items ?? new List<PublishItem>())
            {
                var a = new SheetAffect { ItemId = it.Id };
                set.BySheet[it.Id] = a;
                if (it.Kind != PublishItemKind.Sheet) { a.State = AffectState.NotApplicable; continue; }

                SheetCheckpoint cp = null;
                if (checkpoints != null) checkpoints.TryGetValue(it.Id, out cp);
                List<PublishFormat> missingFormats = PublishCheckpointStore.MissingFormats(cp, required);
                if (cp == null || cp.Partial || missingFormats.Count > 0)
                {
                    a.State = AffectState.NeverPublished;
                    a.Reasons.Add(cp == null
                        ? "Энэ профайлаар хараахан гаргаагүй — харьцуулах суурь байхгүй."
                        : missingFormats.Count > 0
                            ? "Профайлд нэмэгдсэн формат (" + string.Join(", ", missingFormats.Select(f => f.ToString().ToUpperInvariant())) + ") хараахан гараагүй — хуудас бүрэн гараагүй."
                            : "Профайлын зарим формат (жишээ нь DWG) хараахан амжилттай гараагүй — хуудас бүрэн гараагүй.");
                    continue;
                }
                a.Watermark = cp.ChangeSeq;

                // Хуудсын watermark-аас ЭРТ эхэлсэн, хамгийн ШИНЭ (хамгийн цөөн хэт тооцоотой) шинжилгээ.
                WatermarkAnalysis an = analyses.Where(x => x.Watermark <= cp.ChangeSeq).OrderByDescending(x => x.Watermark).FirstOrDefault();
                if (an == null || an.Failed || an.Report == null)
                {
                    a.State = AffectState.Unknown;
                    a.Reasons.Add(an != null && an.Failed ? "Шинжилгээ амжилтгүй: " + an.Error : "Шинжилгээ хийгдээгүй.");
                    continue;
                }

                ImpactReport r = an.Report;
                List<ImpactItem> hits = r.Items.Where(i => Matches(it, i)).ToList();
                if (hits.Count > 0)
                {
                    ImpactItem best = hits.OrderBy(h => ImpactConf.Rank(h.Confidence)).First();
                    a.Confidence = ImpactConf.Normalize(best.Confidence);
                    a.State = a.Confidence == ImpactConfidence.A ? AffectState.Affected : AffectState.Suggested;
                    foreach (ImpactItem h in hits.OrderBy(h => ImpactConf.Rank(h.Confidence)).Take(3))
                        a.Reasons.Add("[" + ImpactConf.Letter(h.Confidence) + "] " + (h.Reason ?? h.Relationship) + (string.IsNullOrEmpty(h.SourceLabel) ? "" : " ← " + h.SourceLabel));
                    continue;
                }

                // Нөлөөлөл олдсонгүй — ГЭХДЭЭ «өөрчлөгдөөгүй» гэж баталж чадах эсэх.
                var caveats = new List<string>();
                if (r.Incomplete)
                    caveats.Add("шинжилгээ БҮРЭН БИШ" + (r.IncompleteReasons != null && r.IncompleteReasons.Count > 0
                        ? " (" + string.Join("; ", r.IncompleteReasons.Take(2).Select(x => x.TrimEnd('.'))) + ")" : ""));
                if (r.HasGlobalChange) caveats.Add("төслийн ерөнхий тохиргоо өөрчлөгдсөн (олон хуудсанд нөлөөлж болно)");
                if (r.UnresolvedDeleted > 0) caveats.Add(r.UnresolvedDeleted + " устсан элементийн нөлөөллийг тодорхойлж чадаагүй");
                if (r.DeletedUnderivable > 0) caveats.Add(r.DeletedUnderivable + " загварын элемент устсан — тэдний харагдац/хуудсыг үндэслэх боломжгүй");

                // Revit-ийн хувилбарын түүх: ТҮҮХЭЭР шалгасан (BaselineUsed) бол өөр session/хэрэглэгчийн өөрчлөлт аль хэдийн шинжилгээнд орсон.
                // Шалгаагүй бол л «хувилбар өөрчлөгдсөн» нь сэжигтэй (GUID нь элемент ҮҮССЭНД шинэчлэгддэг — Revit-ийн баримтжуулалт).
                bool guidKnown = !string.IsNullOrEmpty(cp.DocVersionGuid);
                if (!r.BaselineUsed)
                {
                    if (!guidKnown)
                        caveats.Add("гаргалтын үеийн Revit хувилбар тодорхойгүй — бүртгэлд ороогүй өөрчлөлтийг шалгах боломжгүй");
                    else if (!string.IsNullOrEmpty(currentVersionGuid)
                        && !string.Equals(cp.DocVersionGuid, currentVersionGuid, StringComparison.OrdinalIgnoreCase))
                        caveats.Add("Revit-ийн хувилбар гаргалтаас хойш өөрчлөгдсөн, хувилбарын түүхээр шалгаагүй (бүртгэгдээгүй өөрчлөлт байж болно)");
                }

                if (caveats.Count > 0)
                {
                    a.State = AffectState.Suggested;
                    a.Confidence = ImpactConfidence.D;
                    a.Reasons.Add("Шууд нөлөөлөл олдсонгүй, ГЭХДЭЭ «өөрчлөгдөөгүй» гэж батлах боломжгүй: " + string.Join("; ", caveats) + ".");
                }
                else
                {
                    a.State = AffectState.NoImpactFound;
                    a.Reasons.Add("Бүртгэсэн " + r.SourceCount + " өөрчлөлтөөс энэ хуудсанд нөлөөлөх холбоо олдсонгүй (баталгаа БИШ).");
                }
            }

            foreach (WatermarkAnalysis an in analyses)
            {
                if (an.Failed) set.Notes.Add("Шинжилгээ (watermark " + an.Watermark + ") амжилтгүй: " + an.Error);
                else if (an.Report != null) set.Notes.AddRange(an.Report.Notes.Where(n => n.StartsWith("⚠")));
            }
            set.Notes = set.Notes.Distinct().ToList();
            return set;
        }
    }
}
