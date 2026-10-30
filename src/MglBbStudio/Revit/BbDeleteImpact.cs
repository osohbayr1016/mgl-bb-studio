using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;

namespace MglBb.RevitSide
{
    /// <summary>
    /// Арматурыг устгаж дахин үүсгэхээс ӨМНӨ: Revit-ийн <c>Document.Delete</c> устгасан арматурт холбогдсон бүх шошго, хэмжээс, MRA-г (аль ч
    /// харагдацад, хэний ч тавьсан) анхааруулгагүй хамт устгадаг.  Workshared загварт тэр устгалт Synchronize-оор бусдад очиж «хэмжээс, шошго
    /// sync хийхэд алга болсон» мэт харагдана.  Энд хамт устах тэмдэглэгээг тоолно — загвар ӨӨРЧЛӨГДӨХГҮЙ (бүгд RollBack).
    /// </summary>
    internal static class BbDeleteImpact
    {
        internal sealed class Hit
        {
            public string Key;
            public int Annotations;
            public readonly HashSet<string> Views = new HashSet<string>(StringComparer.Ordinal);
        }

        /// <summary>
        /// Нээлттэй Transaction-гүй үед.  <paramref name="sets"/> = (түлхүүр, устгах арматур).  Хамт устах тэмдэглэгээтэйг л буцаана.
        /// </summary>
        public static List<Hit> Scan(Document doc, IEnumerable<KeyValuePair<string, List<ElementId>>> sets)
        {
            var hits = new List<Hit>();
            using (var t = new Transaction(doc, "MGL ББ: устгалтын нөлөө"))
            {
                t.Start();
                try
                {
                    foreach (KeyValuePair<string, List<ElementId>> s in sets)
                    {
                        if (s.Value == null || s.Value.Count == 0) continue;
                        Hit h = One(doc, s.Key, s.Value);
                        if (h != null && h.Annotations > 0) hits.Add(h);
                    }
                }
                finally
                {
                    if (t.HasStarted() && !t.HasEnded()) t.RollBack();
                }
            }
            return hits;
        }

        static Hit One(Document doc, string key, List<ElementId> del)
        {
            ICollection<ElementId> gone;
            using (var st = new SubTransaction(doc))
            {
                st.Start();
                try { gone = doc.Delete(del); }
                catch (Exception) { gone = null; }
                finally { if (st.HasStarted() && !st.HasEnded()) st.RollBack(); }
            }
            if (gone == null) return null;
            // RollBack-ийн дараа элементүүд дахин бий — одоо л ангилж болно.
            var own = new HashSet<long>(del.Select(i => i.Value));
            var mraDims = new HashSet<long>();
            var annos = new List<Element>();
            foreach (ElementId id in gone)
            {
                if (id == null || own.Contains(id.Value)) continue;
                Element e = doc.GetElement(id);
                if (e == null || e.OwnerViewId == ElementId.InvalidElementId) continue;
                if (e is MultiReferenceAnnotation mra) mraDims.Add(mra.DimensionId.Value);
                if (e is IndependentTag || e is Dimension || e is MultiReferenceAnnotation || e is TextNote ||
                    (e.Category != null && e.Category.CategoryType == CategoryType.Annotation))
                    annos.Add(e);
            }
            var h = new Hit { Key = key };
            foreach (Element e in annos)
            {
                if (e is Dimension && mraDims.Contains(e.Id.Value)) continue;   // MRA-ийн дотоод хэмжээс — MRA-тай нэг гэж тоолно
                h.Annotations++;
                View v = doc.GetElement(e.OwnerViewId) as View;
                if (v != null) h.Views.Add(v.Name);
            }
            return h;
        }

        /// <summary>
        /// Нээлттэй Transaction-гүй үед.  Хамт устах тэмдэглэгээ байвал хэрэглэгчээс асууна.  null = болих; эс бөгөөс алгасах түлхүүрүүд
        /// (хоосон = бүгдийг үүсгэ).
        /// </summary>
        public static HashSet<string> Confirm(Document doc, string title, IEnumerable<KeyValuePair<string, List<ElementId>>> sets)
        {
            var skip = new HashSet<string>(StringComparer.Ordinal);
            List<Hit> hits;
            try { hits = Scan(doc, sets); }
            catch (Exception) { return skip; }      // шалгалт унасан ч үүсгэлтийг саатуулахгүй (өмнөх зан төлөв)
            if (hits.Count == 0) return skip;

            var td = new Autodesk.Revit.UI.TaskDialog(title)
            {
                MainIcon = Autodesk.Revit.UI.TaskDialogIcon.TaskDialogIconWarning,
                MainInstruction = hits.Sum(h => h.Annotations) + " шошго / хэмжээс хамт устна",
                MainContent = "Дахин үүсгэхэд хуучин арматур устах бөгөөд Revit түүнд холбогдсон шошго, хэмжээсийг (аль ч харагдацад, хэний ч тавьсан) хамт устгана.  " +
                    "Хамтын загварт Synchronize хийсний дараа бусдаас ч алга болно." + Environment.NewLine + Environment.NewLine + Describe(hits, 10),
                AllowCancellation = true,
            };
            td.AddCommandLink(Autodesk.Revit.UI.TaskDialogCommandLinkId.CommandLink1, "Устгаад үүсгэх");
            td.AddCommandLink(Autodesk.Revit.UI.TaskDialogCommandLinkId.CommandLink2, "Тэдгээрийг алгасах", "Тэмдэглэгээ устахгүй гишүүдийг л үүсгэнэ.");
            td.AddCommandLink(Autodesk.Revit.UI.TaskDialogCommandLinkId.CommandLink3, "Болих");
            Autodesk.Revit.UI.TaskDialogResult r = td.Show();
            if (r == Autodesk.Revit.UI.TaskDialogResult.CommandLink1) return skip;
            if (r == Autodesk.Revit.UI.TaskDialogResult.CommandLink2) { foreach (Hit h in hits) skip.Add(h.Key); return skip; }
            return null;
        }

        /// <summary>Хэрэглэгчид харуулах товч жагсаалт.</summary>
        public static string Describe(List<Hit> hits, int max)
        {
            var lines = hits.Take(max).Select(h => h.Key + ": " + h.Annotations + " (" + string.Join(", ", h.Views.Take(3)) + (h.Views.Count > 3 ? ", …" : "") + ")").ToList();
            if (hits.Count > max) lines.Add("… өөр " + (hits.Count - max));
            return string.Join(Environment.NewLine, lines);
        }
    }
}
