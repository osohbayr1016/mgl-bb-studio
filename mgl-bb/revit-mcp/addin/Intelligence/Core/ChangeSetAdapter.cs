using System;
using System.Collections.Generic;
using System.Threading;
using RevitMcpAddin.Intelligence.Contracts;

namespace RevitMcpAddin.Intelligence.Core
{
    /// <summary>
    /// `LogicalChangeSet` (Track 2-ийн `ChangeSetCoalescer`, 1200/15000/2000
    /// тохиргоо ХЭВЭЭР — R-14) + `ChangeTracker.Change`-ийн нэмсэн/зассан/
    /// устгасан олонлог → `RevitChangeSet`.
    ///
    /// ⚠️ ЦЭВЭР: `ChangeTracker.Change` нь Revit-ийн файлд байдаг тул энд
    ///    ТҮҮНИЙГ биш, олонлогуудыг нь авна — тест Revit-гүй ажиллана.
    /// ⚠️ Ангилал: устгагдсан > нэмэгдсэн > зассан > тодорхойгүй.  Нэмээд
    ///    устгасан элемент «устгагдсан» (графаас хасах ёстой); хэзээ ч
    ///    хоёр жагсаалтад давхар орохгүй.
    /// </summary>
    internal static class ChangeSetAdapter
    {
        public static RevitChangeSet FromLogical(
            LogicalChangeSet set,
            ISet<long> trackerAdded,
            ISet<long> trackerModified,
            ISet<long> trackerDeleted,
            IList<string> transactionNames,
            DateTime? nowUtc = null)
        {
            if (set == null) throw new ArgumentNullException(nameof(set));
            var r = new RevitChangeSet
            {
                DocKey = set.DocKey,
                FirstSeq = set.FirstSeq,
                LastSeq = set.LastSeq,
                OpenedMs = set.OpenedMs,
                ClosedMs = set.ClosedMs,
                CloseReason = set.CloseReason,
                MayCollect = set.MayCollect,
                Coarse = set.Coarse,
                UndoBurst = set.UndoBurst,
                TxnCount = set.TxnCount,
                CapturedAt = (nowUtc ?? DateTime.UtcNow).ToString("o"),
            };
            var seen = new HashSet<long>();
            long[] ids = set.ElementIds ?? new long[0];
            foreach (long id in ids)
            {
                if (!seen.Add(id)) continue;
                if (trackerDeleted != null && trackerDeleted.Contains(id)) r.Deleted.Add(id);
                else if (trackerAdded != null && trackerAdded.Contains(id)) r.Added.Add(id);
                else if (trackerModified != null && trackerModified.Contains(id)) r.Modified.Add(id);
                else r.Unclassified.Add(id);
            }
            r.Added.Sort(); r.Modified.Sort(); r.Deleted.Sort(); r.Unclassified.Sort();
            if (transactionNames != null)
            {
                var names = new HashSet<string>(StringComparer.Ordinal);
                foreach (string n in transactionNames)
                {
                    if (string.IsNullOrWhiteSpace(n)) continue;
                    if (names.Add(n)) r.TransactionNames.Add(n);
                    if (r.TransactionNames.Count >= 50) break;
                }
            }
            return r;
        }

        /// <summary>Хэд хэдэн олонлогийг НЭГ болгож нийлүүлнэ (сүүлийн төлөв алдагдахгүй, §55).</summary>
        public static RevitChangeSet Merge(IList<RevitChangeSet> sets)
        {
            if (sets == null || sets.Count == 0) return null;
            if (sets.Count == 1) return sets[0];
            var m = new RevitChangeSet
            {
                DocKey = sets[0].DocKey,
                FirstSeq = sets[0].FirstSeq,
                LastSeq = sets[sets.Count - 1].LastSeq,
                OpenedMs = sets[0].OpenedMs,
                ClosedMs = sets[sets.Count - 1].ClosedMs,
                CloseReason = "merged",
                CapturedAt = sets[sets.Count - 1].CapturedAt,
            };
            var deleted = new HashSet<long>();
            var added = new HashSet<long>();
            var modified = new HashSet<long>();
            var uncl = new HashSet<long>();
            var txn = new HashSet<string>(StringComparer.Ordinal);
            foreach (RevitChangeSet s in sets)
            {
                foreach (long id in s.Deleted) deleted.Add(id);
                foreach (long id in s.Added) added.Add(id);
                foreach (long id in s.Modified) modified.Add(id);
                foreach (long id in s.Unclassified) uncl.Add(id);
                foreach (string t in s.TransactionNames) if (txn.Add(t)) m.TransactionNames.Add(t);
                m.MayCollect |= s.MayCollect;
                m.Coarse |= s.Coarse;
                m.UndoBurst += s.UndoBurst;
                m.TxnCount += s.TxnCount;
            }
            foreach (long id in deleted) { added.Remove(id); modified.Remove(id); uncl.Remove(id); }
            foreach (long id in added) { modified.Remove(id); uncl.Remove(id); }
            foreach (long id in modified) uncl.Remove(id);
            m.Deleted.AddRange(deleted); m.Added.AddRange(added); m.Modified.AddRange(modified); m.Unclassified.AddRange(uncl);
            m.Deleted.Sort(); m.Added.Sort(); m.Modified.Sort(); m.Unclassified.Sort();
            return m;
        }
    }

    /// <summary>
    /// Жижиг debounce — сонголт/харагдацын үйл явдлыг нэгтгэнэ (§17, §55).
    /// Revit-ийн үйл явдлын дотор `Trigger()` л дуудагдана (ХЯМД); ажил нь
    /// ThreadPool дээр `delayMs`-ийн дараа НЭГ УДАА ажиллана.  Дахин
    /// `Trigger()` хийвэл таймер шинээр эхэлнэ — сүүлийн төлөв алдагдахгүй.
    /// </summary>
    public sealed class Debouncer : IDisposable
    {
        private readonly int _delayMs;
        private readonly Action _work;
        private readonly Timer _timer;
        private int _pending;
        private int _disposed;

        public Debouncer(int delayMs, Action work)
        {
            _delayMs = Math.Max(1, delayMs);
            _work = work ?? throw new ArgumentNullException(nameof(work));
            _timer = new Timer(Fire, null, Timeout.Infinite, Timeout.Infinite);
        }

        public void Trigger()
        {
            if (_disposed != 0) return;
            Interlocked.Exchange(ref _pending, 1);
            try { _timer.Change(_delayMs, Timeout.Infinite); } catch (ObjectDisposedException) { }
        }

        private void Fire(object _)
        {
            if (Interlocked.Exchange(ref _pending, 0) == 0) return;
            try { _work(); } catch { /* ажил өөрөө алдаагаа барих ёстой */ }
        }

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
            _timer.Dispose();
        }
    }
}
