using System;
using System.Collections.Generic;

namespace RevitMcpAddin.SheetNumerator.Core
{
    /// <summary>Одоогийн (Revit дэх) хуудасны хөнгөн «тамга» — хуучирсан эсэхийг шалгахад.</summary>
    public sealed class SheetStamp
    {
        public long SheetId { get; set; }
        public string UniqueId { get; set; }
        public string Number { get; set; }
        public string Name { get; set; }
        public long CollectionId { get; set; }
        public bool IsAssemblySheet { get; set; }
        public long AssemblyId { get; set; }

        public string ScopeKey(UniquenessMode mode)
        {
            if (IsAssemblySheet)
                return "A" + AssemblyId;
            return mode == UniquenessMode.PerSheetCollection ? "C" + CollectionId : "G";
        }
    }

    /// <summary>Идэвхтэй document-ийн одоогийн байдал (Revit-ээс уншсан, хөнгөн).</summary>
    public sealed class DocumentStamp
    {
        public bool HasDocument { get; set; }
        public string DocumentKey { get; set; }
        public List<SheetStamp> Sheets { get; set; } = new List<SheetStamp>();
    }

    public enum FreshnessStatus
    {
        Fresh = 0,

        /// <summary>Идэвхтэй document байхгүй.</summary>
        NoDocument = 1,

        /// <summary>Идэвхтэй document ӨӨР болсон (цонх өөр document-ийг төлөөлж байна).</summary>
        DocumentChanged = 2,

        /// <summary>Хуудас устсан/нэмэгдсэн/дугаар, нэр нь гаднаас өөрчлөгдсөн.</summary>
        SheetsChanged = 3,
    }

    public sealed class FreshnessResult
    {
        public FreshnessStatus Status { get; set; }
        public List<string> Details { get; } = new List<string>();
        public bool IsFresh => Status == FreshnessStatus.Fresh;
    }

    /// <summary>
    /// Modeless цонх нээлттэй байхад document өөрчлөгдөж болно — snapshot-ыг хэзээ ч «үүрд хүчинтэй» гэж
    /// үзэхгүй.  Энэ нь ЦЭВЭР харьцуулалт (Revit-ийн уншилт нь `Revit/` дотор).
    /// </summary>
    public static class FreshnessChecker
    {
        /// <param name="affectedIds">null = БҮХ хуудсыг (цонхны баннер); эс бөгөөс зөвхөн эдгээрийг (Apply-ийн өмнө).</param>
        public static FreshnessResult Compare(DocumentSnapshot snapshot, DocumentStamp live, ISet<long> affectedIds)
        {
            var result = new FreshnessResult();
            if (live == null || !live.HasDocument)
            {
                result.Status = FreshnessStatus.NoDocument;
                return result;
            }
            if (!string.Equals(snapshot.DocumentKey, live.DocumentKey, StringComparison.Ordinal))
            {
                result.Status = FreshnessStatus.DocumentChanged;
                return result;
            }

            var liveById = new Dictionary<long, SheetStamp>(live.Sheets.Count);
            foreach (SheetStamp s in live.Sheets)
                liveById[s.SheetId] = s;

            foreach (SheetSnapshot snap in snapshot.Sheets)
            {
                if (affectedIds != null && !affectedIds.Contains(snap.SheetId))
                    continue;

                SheetStamp cur;
                if (!liveById.TryGetValue(snap.SheetId, out cur) || !string.Equals(cur.UniqueId, snap.UniqueId, StringComparison.Ordinal))
                {
                    result.Details.Add(Msg.SheetNoLongerExists(snap.Number, snap.Name));
                    continue;
                }
                if (!string.Equals(cur.Number, snap.Number, StringComparison.Ordinal))
                    result.Details.Add(Msg.SheetNumberChangedExternally(snap.Number, cur.Number));
                if (!string.Equals(cur.Name, snap.Name, StringComparison.Ordinal))
                    result.Details.Add(Msg.SheetNameChangedExternally(snap.Number, snap.Name, cur.Name));
            }

            if (affectedIds == null)
            {
                var known = new HashSet<long>();
                foreach (SheetSnapshot snap in snapshot.Sheets)
                    known.Add(snap.SheetId);
                foreach (SheetStamp s in live.Sheets)
                {
                    if (!known.Contains(s.SheetId))
                        result.Details.Add(Msg.SheetAddedExternally(s.Number, s.Name));
                }
            }

            result.Status = result.Details.Count == 0 ? FreshnessStatus.Fresh : FreshnessStatus.SheetsChanged;
            return result;
        }

        /// <summary>
        /// Apply-ийн өмнөх ДАХИН давхардлын шалгалт — ҮНЭН (Revit-ийн) одоогийн дугаарууд дээр.
        /// Хэрэглэгчийн бусад хуудас гаднаас шинэ дугаар авсан бол snapshot-ийн шалгалт хуучирсан байж болно.
        /// </summary>
        public static IReadOnlyList<DuplicateHit> FindLiveDuplicates(DocumentStamp live, UniquenessMode mode, IReadOnlyList<ApplyItem> items)
        {
            var projected = new Dictionary<long, string>();
            foreach (ApplyItem it in items)
            {
                if (it.NumberChanges)
                    projected[it.SheetId] = it.NewNumber;
            }
            var entries = new List<NumberEntry>(live.Sheets.Count);
            var changed = new HashSet<long>(projected.Keys);
            foreach (SheetStamp s in live.Sheets)
            {
                string p;
                string number = projected.TryGetValue(s.SheetId, out p) ? p : s.Number;
                entries.Add(new NumberEntry(s.SheetId, number, s.ScopeKey(mode)));
            }
            return DuplicateValidationService.Find(entries, changed);
        }
    }
}
