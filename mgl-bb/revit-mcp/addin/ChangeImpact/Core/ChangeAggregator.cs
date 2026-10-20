using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.ChangeImpact.Core
{
    /// <summary>Өөрчлөлтийн бүртгэлд ОРООГҮЙ (жишээ нь Revit-ийн хувилбарын түүхээс ирсэн) нэмэлт өөрчлөлт.</summary>
    public sealed class ExtraChange
    {
        public long Id { get; set; }
        public ChangeKind Kind { get; set; }
        public long Seq { get; set; }
    }

    /// <summary>Мужийн доторх өөрчлөлтүүдийн НЭГТГЭЛ — шинжилгээний ЭХ СУРВАЛЖУУД.</summary>
    public sealed class AggregatedChanges
    {
        public List<SourceChange> Sources { get; set; } = new List<SourceChange>();
        /// <summary>Элемент тутмын хамгийн сүүлийн ИДЕНТИТИ-тэй (Known) бичлэг — устсан элементийн мэдээлэл.</summary>
        public Dictionary<long, ChangeEntry> Entries { get; set; } = new Dictionary<long, ChangeEntry>();
        public int Added { get; set; }
        public int Modified { get; set; }
        public int Deleted { get; set; }
        /// <summary>Мужийн дотор нэмэгдээд устсан (цэвэр өөрчлөлтгүй) элементийн тоо.</summary>
        public int NetZero { get; set; }
        /// <summary>Устсан, мэдээллийг өмнөөс бүртгээгүй (нөлөөллийг тодорхойлох боломжгүй) элементийн тоо.</summary>
        public int UnresolvedDeleted { get; set; }
        /// <summary>
        /// Устсан, мэдээлэл НЬ мэдэгдэж буй ч харагдацад (owner view) эсвэл хостод холбогдоогүй загварын элемент.  Устсан элементийн
        /// геометрийг Revit өгөхгүй тул аль харагдац/хуудсанд харагдаж байсныг ҮНДЭСЛЭХ боломжгүй — «нөлөөлөл олдсонгүй» гэж дүгнэж БОЛОХГҮЙ.
        /// </summary>
        public int DeletedUnderivable { get; set; }
        /// <summary>Мужид орсон багцуудаас capture хэт олон id-ийн улмаас эхний хэсгээр нь л бүртгэгдсэн (`Truncated`) багцын тоо.</summary>
        public int TruncatedBatches { get; set; }
        public bool Truncated { get; set; }
        public int TotalElements { get; set; }
        public long FromSeq { get; set; }
        public long ToSeq { get; set; }
        public int BatchCount { get; set; }
        public List<string> Notes { get; set; } = new List<string>();
    }

    /// <summary>
    /// Өөрчлөлтийн багцуудыг (транзакц тутмын) нэг элемент = нэг ЭЦСИЙН төлөв болгон нэгтгэнэ.  ЦЭВЭР (Revit-гүй, тестлэгдсэн).
    ///
    ///   Нэг элемент мужийн дотор олон удаа өөрчлөгдөж болно — энэ нь нэг л эх сурвалж.  Дүрэм:
    ///     • хамгийн СҮҮЛИЙН үйл явдал «Устсан»              → Устсан
    ///     • анхны үйл явдал «Нэмэгдсэн» (бас сүүлийнх нь устсан биш) → Нэмэгдсэн
    ///     • нэмэгдээд мөн мужийн дотор УСТСАН                  → цэвэр өөрчлөлт БАЙХГҮЙ (тооцохгүй, `NetZero`)
    ///     • бусад                                           → Өөрчлөгдсөн (Устгаад undo-ор сэргээсэн ч энд)
    /// </summary>
    public static class ChangeAggregator
    {
        private sealed class Agg
        {
            public ChangeKind First, Last;
            public long LastSeq;
            public ChangeEntry Entry;
        }

        /// <summary>
        /// Устсан элементийн нөлөөллийг (аль харагдац/хуудсанд харагдаж байсныг) устсаны ДАРАА ҮНДЭСЛЭЖ чадах эсэх:
        /// харагдац/хуудас/хүснэгт өөрөө, view-specific (owner view мэдэгдэж буй: tag, хэмжээс, detail), эсвэл хостод холбогдсон.
        /// Бусад (хана, шал, тавилга ...) — геометр устсан тул ЧАДАХГҮЙ.
        /// </summary>
        public static bool IsDerivableDeletion(ChangeEntry e)
        {
            if (e == null) return false;
            if (e.OwnerViewId > 0 || e.HostId > 0) return true;
            return e.NodeKind == ImpactNodeKind.Sheet || e.NodeKind == ImpactNodeKind.View || e.NodeKind == ImpactNodeKind.Schedule;
        }

        public static AggregatedChanges Aggregate(
            IReadOnlyList<ChangeBatch> all,
            long fromSeqExclusive,
            long toSeqInclusive,
            IReadOnlyCollection<long> onlyBatchSeqs,
            int maxSources,
            IEnumerable<ExtraChange> extra = null)
        {
            var res = new AggregatedChanges { FromSeq = fromSeqExclusive, ToSeq = fromSeqExclusive };
            HashSet<long> only = onlyBatchSeqs != null ? new HashSet<long>(onlyBatchSeqs) : null;

            List<ChangeBatch> batches = (all ?? new List<ChangeBatch>())
                .Where(b => b.Seq > fromSeqExclusive && b.Seq <= toSeqInclusive && (only == null || only.Contains(b.Seq)))
                .OrderBy(b => b.Seq).ToList();
            res.BatchCount = batches.Count;
            res.TruncatedBatches = batches.Count(b => b.Truncated);
            if (batches.Count > 0) res.ToSeq = batches.Last().Seq;

            var agg = new Dictionary<long, Agg>();
            foreach (ChangeBatch b in batches)
            {
                if (b.Truncated)
                    res.Notes.Add("Нэг багц (" + b.Utc.ToLocalTime().ToString("HH:mm:ss") + ") хэт олон өөрчлөлттэй тул зөвхөн эхний хэсгийг бүртгэсэн (" + b.Total + " нийт).");
                foreach (ChangeEntry c in b.Entries ?? new List<ChangeEntry>())
                {
                    Agg a;
                    if (!agg.TryGetValue(c.Id, out a))
                    {
                        agg[c.Id] = new Agg { First = c.Kind, Last = c.Kind, LastSeq = b.Seq, Entry = c };
                    }
                    else
                    {
                        a.Last = c.Kind;
                        a.LastSeq = b.Seq;
                        if (c.Known || a.Entry == null || !a.Entry.Known) a.Entry = c;      // мэдэгдэж буй (идентититэй) бичлэгийг илүүд үзнэ
                    }
                }
            }

            foreach (ExtraChange x in extra ?? new ExtraChange[0])
            {
                if (agg.ContainsKey(x.Id)) continue;                 // бидний бүртгэл нарийвчилсан — давхар нэмэхгүй
                agg[x.Id] = new Agg { First = x.Kind, Last = x.Kind, LastSeq = x.Seq, Entry = null };
            }

            res.TotalElements = agg.Count;
            var kept = new List<KeyValuePair<long, Agg>>();
            foreach (KeyValuePair<long, Agg> kv in agg)
            {
                if (kv.Value.First == ChangeKind.Added && kv.Value.Last == ChangeKind.Deleted) { res.NetZero++; continue; }
                kept.Add(kv);
            }

            if (kept.Count > maxSources)
            {
                res.Truncated = true;
                kept = kept.OrderByDescending(kv => kv.Value.LastSeq).Take(maxSources).ToList();
                res.Notes.Add("Өөрчилсөн элемент " + agg.Count + " — хамгийн сүүлийн " + maxSources + "-г л шинжиллээ.");
            }

            foreach (KeyValuePair<long, Agg> kv in kept.OrderBy(k => k.Key))
            {
                ChangeKind kind = kv.Value.Last == ChangeKind.Deleted ? ChangeKind.Deleted
                    : kv.Value.First == ChangeKind.Added ? ChangeKind.Added : ChangeKind.Modified;
                res.Sources.Add(new SourceChange { Id = kv.Key, Kind = kind, Seq = kv.Value.LastSeq });
                if (kind == ChangeKind.Added) res.Added++;
                else if (kind == ChangeKind.Deleted) res.Deleted++;
                else res.Modified++;

                if (kv.Value.Entry != null) res.Entries[kv.Key] = kv.Value.Entry;
                if (kind == ChangeKind.Deleted)
                {
                    ChangeEntry de = kv.Value.Entry;
                    if (de == null || !de.Known) res.UnresolvedDeleted++;
                    else if (!IsDerivableDeletion(de)) res.DeletedUnderivable++;
                }
            }

            if (res.NetZero > 0)
                res.Notes.Add(res.NetZero + " элемент мужийн дотор нэмэгдээд устсан тул тооцсонгүй (цэвэр өөрчлөлтгүй).");
            return res;
        }
    }
}
