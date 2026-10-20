using System;
using System.Collections.Generic;

namespace RevitMcpAddin.SheetNumerator.Core
{
    /// <summary>Нэг хуудасны эцсийн дугаар + давхцлын хүрээ (давхардал шалгах оролт).</summary>
    public sealed class NumberEntry
    {
        public NumberEntry(long sheetId, string number, string scope)
        {
            SheetId = sheetId;
            Number = number ?? string.Empty;
            Scope = scope ?? string.Empty;
        }

        public long SheetId { get; }
        public string Number { get; }
        public string Scope { get; }
    }

    /// <summary>Нэг давхардал: өөрчлөгдөж буй хуудас + тэр дугаарыг эзэлж буй бусад хуудсууд.</summary>
    public sealed class DuplicateHit
    {
        public DuplicateHit(long sheetId, string number, IReadOnlyList<long> others)
        {
            SheetId = sheetId;
            Number = number;
            Others = others;
        }

        public long SheetId { get; }
        public string Number { get; }
        public IReadOnlyList<long> Others { get; }
    }

    /// <summary>
    /// Давхардлыг шалгах ГАНЦ ГАЗАР — UI-ийн event handler бүрт тарсан шалгалт БАЙХГҮЙ.
    ///
    /// ⚠️ Өөрчлөгдөж буй мөрүүдийг ЗӨВХӨН хооронд нь биш, document-ийн БҮХ хуудастай (өөр бүлэг, нуугдсан,
    /// placeholder, assembly, «Сонгосон хуудаснаас эхлэх»-ээр хөндөгдөөгүй өмнөх хуудсууд) тулгана — тэд ч
    /// Revit-ийн давхардлын хүрээнд оролцоно.
    ///
    /// ⚠️ O(n): бүх хуудсыг НЭГ Dictionary-д хүрээ + дугаараар хураана (O(n²) биш).
    /// ⚠️ Харьцуулалт том/жижиг үсэг үл ялгана (Revit-ийг хэмжсэн), харин Unicode НОРМЧЛОЛГҮЙ → үл үзэгдэх
    /// тэмдэгтээр ялгарсан хоёр дугаар ӨӨР.
    /// </summary>
    public static class DuplicateValidationService
    {
        private const char Sep = '\u0001';

        public static string KeyOf(string scope, string number)
        {
            return scope + Sep + number;
        }

        /// <summary>
        /// <paramref name="finalEntries"/> = бүх хуудасны ЭЦСИЙН (төсөөлсөн) дугаар.  <paramref name="changedIds"/> дахь
        /// хуудас давхцсан бол hit буцаана; өөрчлөгдөөгүй хоёр хуудас хоорондоо давхцах нь (Revit-д боломжгүй) орхигдоно.
        /// </summary>
        public static IReadOnlyList<DuplicateHit> Find(IEnumerable<NumberEntry> finalEntries, ISet<long> changedIds)
        {
            var map = new Dictionary<string, List<NumberEntry>>(StringComparer.OrdinalIgnoreCase);
            foreach (NumberEntry e in finalEntries)
            {
                List<NumberEntry> list;
                string key = KeyOf(e.Scope, e.Number);
                if (!map.TryGetValue(key, out list))
                {
                    list = new List<NumberEntry>(1);
                    map[key] = list;
                }
                list.Add(e);
            }

            var hits = new List<DuplicateHit>();
            foreach (List<NumberEntry> list in map.Values)
            {
                if (list.Count < 2)
                    continue;
                foreach (NumberEntry e in list)
                {
                    if (!changedIds.Contains(e.SheetId))
                        continue;
                    var others = new List<long>();
                    foreach (NumberEntry o in list)
                    {
                        if (o.SheetId != e.SheetId)
                            others.Add(o.SheetId);
                    }
                    hits.Add(new DuplicateHit(e.SheetId, e.Number, others));
                }
            }
            return hits;
        }

        /// <summary>Document-ийн snapshot + төлөвлөсөн дугаарууд (хуудасны id → шинэ дугаар) → давхардлууд.</summary>
        public static IReadOnlyList<DuplicateHit> Find(DocumentSnapshot doc, IReadOnlyDictionary<long, string> projected)
        {
            var entries = new List<NumberEntry>(doc.Sheets.Count);
            var changed = new HashSet<long>();
            foreach (SheetSnapshot s in doc.Sheets)
            {
                string number = s.Number;
                string p;
                if (projected != null && projected.TryGetValue(s.SheetId, out p))
                {
                    number = p;
                    changed.Add(s.SheetId);
                }
                entries.Add(new NumberEntry(s.SheetId, number, s.ScopeKey(doc.Uniqueness)));
            }
            return Find(entries, changed);
        }

        /// <summary>Давхардлыг хэрэглэгчид харуулах ValidationIssue болгоно.</summary>
        public static List<ValidationIssue> ToIssues(IReadOnlyList<DuplicateHit> hits, DocumentSnapshot doc)
        {
            var issues = new List<ValidationIssue>();
            foreach (DuplicateHit h in hits)
            {
                var sb = new System.Text.StringBuilder(Msg.DuplicateNumber(h.Number));
                foreach (long other in h.Others)
                {
                    SheetSnapshot o = doc != null ? doc.FindSheet(other) : null;
                    if (o != null)
                        sb.Append('\n').Append(Msg.DuplicateWith(o.Number, o.Name, !o.SatisfiesBrowserFilter));
                }
                issues.Add(ValidationIssue.Error(IssueCode.DuplicateNumber, sb.ToString(), h.SheetId));
            }
            return issues;
        }
    }
}
