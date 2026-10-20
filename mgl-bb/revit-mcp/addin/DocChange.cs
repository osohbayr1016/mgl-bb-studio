using System;
using System.Collections.Generic;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Events;

namespace RevitMcpAddin
{
    /// <summary>
    /// `DocumentChangedEventArgs`-ийн ЗӨВХӨН MGL-ийн ажиглагчдад хэрэгтэй хэсэг.  Амьд үйл явдал (`LiveDocChange`) ба хойшлуулсан-дахин
    /// тоглуулсан хуулбар (`DetachedDocChange`) нэг интерфейстэй тул ажиглагч (ChangeTracker, ImpactCapture...) ӨӨРИЙН логикоо ХОЁР ЗАМД ИЖИЛ ажиллуулна.
    ///
    /// ЯАГААД: «Өөрчлөхөөс өмнө шалгах»-ын Apply нь `TransactionGroup { Transaction.Commit → settled төлөв тулгах → Assimilate | RollBack }`.  Дотоод commit-ийн
    /// `DocumentChanged` нь бүлгийг баталгаажуулах/буцаах шийдвэрээс ӨМНӨ ирдэг тул ажиглагчид үүнийг шууд бүртгэж болохгүй (дараа нь буцвал «хэзээ ч
    /// болоогүй өөрчлөлт» түүхэнд үлдэнэ).  `ImpactSimulationScope.BeginDeferral` үед тэд алгасаж, үйл явдлыг ЭНЭ хуулбараар хойшлуулж, Assimilate-ийн ДАРАА
    /// `ImpactObservationSinks.Replay`-аар НЭГ удаа дахин тоглуулна.
    ///
    /// ⚠️ `LiveDocChange` нь struct — ChangeTracker-ийн халуун замд хуваарилалт (alloc) нэмэхгүй (generic `where T : IDocChange` нь JIT-д тусгайлан эмхэтгэгдэнэ).
    /// </summary>
    internal interface IDocChange
    {
        Document GetDocument();
        UndoOperation Operation { get; }
        IList<string> GetTransactionNames();
        ICollection<ElementId> GetAddedElementIds();
        ICollection<ElementId> GetDeletedElementIds();
        ICollection<ElementId> GetModifiedElementIds();
    }

    internal struct LiveDocChange : IDocChange
    {
        private readonly DocumentChangedEventArgs _e;
        internal LiveDocChange(DocumentChangedEventArgs e) { _e = e; }
        public Document GetDocument() { return _e.GetDocument(); }
        public UndoOperation Operation { get { return _e.Operation; } }
        public IList<string> GetTransactionNames() { return _e.GetTransactionNames(); }
        public ICollection<ElementId> GetAddedElementIds() { return _e.GetAddedElementIds(); }
        public ICollection<ElementId> GetDeletedElementIds() { return _e.GetDeletedElementIds(); }
        public ICollection<ElementId> GetModifiedElementIds() { return _e.GetModifiedElementIds(); }
    }

    /// <summary>
    /// Үйл явдлын ХУУЛСАН (Revit обьектгүй) дүр — id, үйлдлийн нэр, транзакцийн нэр.  `Document`-ийг ЗӨВХӨН дахин тоглуулах хүртэл (нэг Apply-ийн хугацаанд)
    /// барина; удаан хадгалахгүй.
    /// </summary>
    internal sealed class DetachedDocChange : IDocChange
    {
        private readonly Document _doc;
        private readonly List<ElementId> _added, _deleted, _modified;
        private readonly string[] _txNames;
        public UndoOperation Operation { get; private set; }

        private DetachedDocChange(Document doc, UndoOperation op, string[] tx, List<ElementId> a, List<ElementId> d, List<ElementId> m)
        {
            _doc = doc; Operation = op; _txNames = tx; _added = a; _deleted = d; _modified = m;
        }

        /// <summary>Амьд үйл явдлаас хуулна.  ЗӨВХӨН handler ДОТОР (Revit API хүчинтэй үед).  Алдвал null — дуудагч «бүртгэгдээгүй» гэж тэмдэглэнэ.</summary>
        internal static DetachedDocChange From(DocumentChangedEventArgs e)
        {
            try
            {
                Document d = e.GetDocument();
                string[] tx;
                try { IList<string> names = e.GetTransactionNames(); var arr = new string[names != null ? names.Count : 0]; if (names != null) names.CopyTo(arr, 0); tx = arr; }
                catch (Exception) { tx = new string[0]; }
                return new DetachedDocChange(d, e.Operation, tx, Copy(e.GetAddedElementIds()), Copy(e.GetDeletedElementIds()), Copy(e.GetModifiedElementIds()));
            }
            catch (Exception) { return null; }
        }

        private static List<ElementId> Copy(ICollection<ElementId> ids)
        {
            var l = new List<ElementId>(ids != null ? ids.Count : 0);
            if (ids != null) foreach (ElementId id in ids) l.Add(new ElementId(id.Value));
            return l;
        }

        public Document GetDocument() { return _doc; }
        public IList<string> GetTransactionNames() { return _txNames; }
        public ICollection<ElementId> GetAddedElementIds() { return _added; }
        public ICollection<ElementId> GetDeletedElementIds() { return _deleted; }
        public ICollection<ElementId> GetModifiedElementIds() { return _modified; }
        internal int TotalIds { get { return _added.Count + _deleted.Count + _modified.Count; } }
    }

    /// <summary>
    /// Хойшлуулсан өөрчлөлтийг БАТАЛГААЖСНЫ дараа тоглуулах MGL-ийн sink-үүд (ажиглагч бүр өөрийгөө НЭГ удаа бүртгэнэ).
    /// ⚠️ Гуравдагч талын add-in-ийг энд оруулахгүй — тэд `DocumentChanged`-ийг ӨӨРСДӨӨ харна (баримтжуулсан хязгаар).
    /// </summary>
    internal static class ImpactObservationSinks
    {
        private static readonly object Gate = new object();
        private static readonly Dictionary<string, Action<DetachedDocChange>> Sinks = new Dictionary<string, Action<DetachedDocChange>>(StringComparer.Ordinal);

        /// <summary>Нэрээр идемпотент: ижил нэр дахин бүртгэгдвэл СОЛИГДОНО (давхар тоглуулахгүй).</summary>
        internal static void Register(string name, Action<DetachedDocChange> sink)
        {
            if (string.IsNullOrEmpty(name) || sink == null) return;
            lock (Gate) Sinks[name] = sink;
        }

        internal static void Unregister(string name)
        {
            if (string.IsNullOrEmpty(name)) return;
            lock (Gate) Sinks.Remove(name);
        }

        /// <summary>Нэг үйл явдлыг БҮХ sink-д өгнө.  Sink бүр тусдаа try/catch — нэг нь унахад бусад нь үргэлжилнэ.  Унасан тоог буцаана.</summary>
        internal static int Replay(DetachedDocChange change)
        {
            if (change == null) return 0;
            List<Action<DetachedDocChange>> list;
            lock (Gate) list = new List<Action<DetachedDocChange>>(Sinks.Values);
            int failed = 0;
            foreach (Action<DetachedDocChange> s in list)
            {
                try { s(change); }
                catch (Exception) { failed++; }
            }
            return failed;
        }

        internal static int Count { get { lock (Gate) return Sinks.Count; } }
    }
}
