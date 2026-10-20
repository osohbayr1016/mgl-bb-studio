using System;
using System.Collections.Generic;
using System.Runtime.CompilerServices;
using Autodesk.Revit.DB;

namespace RevitMcpAddin.Smart
{
    /// <summary>
    /// `Document` обьектын ижил эсэхийг Revit-ийн ГЭРЭЭГЭЭР тодорхойлно.
    ///
    /// ⚠️ ЯАГААД `ReferenceEquals` БИШ: Revit-ийн баримтжуулалт — «хоёр Document обьект нь Revit session-д ТЭР ИЖИЛ нээлттэй
    /// баримтыг төлөөлж байвал `Equals` үнэн» ба `GetHashCode` нь тэдэнд ижил.  Ижил баримтыг төлөөлсөн ӨӨР wrapper
    /// ирж болзошгүй тул reference-ээр харьцуулбал: (а) шалгалт бүр «баримт дахин нээгдсэн» гэж унана, (б) линкийн solid
    /// кэш Step бүрд цэвэрлэгдэнэ, (в) өөрчлөлтийн тоолуур хэзээ ч өсөхгүй (шинэчлэгдэх ёстой «хуучирсан» тэмдэг тасарна).
    /// </summary>
    internal static class SmartDocs
    {
        public static bool Same(Document a, Document b)
        {
            if (ReferenceEquals(a, b)) return true;
            if (a == null || b == null) return false;
            try { return a.Equals(b); }
            catch (Exception) { return false; }
        }

        /// <summary>Хаагдсан/устсан баримт дээр Revit API дуудах боломжгүй — энэ шалгалт шидэхгүй.</summary>
        public static bool IsAlive(Document d)
        {
            if (d == null) return false;
            try { return d.IsValidObject; }
            catch (Exception) { return false; }
        }

        public static int HashOf(Document d)
        {
            try { return d.GetHashCode(); }
            catch (Exception) { return RuntimeHelpers.GetHashCode(d); }
        }
    }

    /// <summary>
    /// Баримт тутмын мэдээллийн хүснэгт — `ConditionalWeakTable&lt;Document, T&gt;`-ийн оронд (тэр нь reference-ээр таниулдаг).
    /// Түлхүүр = Revit-ийн `GetHashCode` + `Equals`.
    ///
    /// ⚠️ Баримтыг ХҮЧТЭЙ (strong) лавлана: сул (weak) лавласан үед Revit-ийн өгсөн `Document` wrapper GC-д орвол (баримт нээлттэй байхад)
    /// мөр «үхсэн» гэж тооцогдож, дараагийн `DocumentChanged` ШИНЭ tracker үүсгэнэ — хуучин tracker-ийн хадгалагдаагүй өөрчлөлт, ChangeStamp
    /// тоолуур ЧИМЭЭГҮЙ алдагдана.  Wrapper нь жижиг (managed) обьект; баримт хаагдахад `IsValidObject = false` болж, мөр
    /// `PurgeDead()`-ээр (баримт хаагдсаны дараа үндсэн thread дээр) эсвэл шинэ мөр нэмэх үед (хүйтэн зам) цэвэрлэгдэнэ.
    /// Халуун зам (`DocumentChanged`) зөвхөн хайлт.
    /// </summary>
    internal sealed class DocumentTable<T> where T : class
    {
        private sealed class Entry
        {
            public Document Doc;
            public T Value;
        }

        private readonly object _gate = new object();
        private readonly Dictionary<int, List<Entry>> _map = new Dictionary<int, List<Entry>>();

        /// <summary>
        /// Хайх.  `Equals` үнэн боловч хадгалсан wrapper аль хэдийн ХААГДСАН (invalid) бол тохирохгүй гэж үзнэ: Revit-ийн дотоод хаяг дахин
        /// ашиглагдаж шинээр нээгдсэн ӨӨР баримттай «тэнцүү» гарч болзошгүй — хаагдсан баримтын мөр шинэ баримтад ХЭЗЭЭ Ч хамаарахгүй.
        /// </summary>
        private static bool Matches(Entry e, Document doc)
        {
            return SmartDocs.Same(e.Doc, doc) && SmartDocs.IsAlive(e.Doc);
        }

        public bool TryGet(Document doc, out T value)
        {
            value = null;
            if (doc == null) return false;
            int h = SmartDocs.HashOf(doc);
            lock (_gate)
            {
                List<Entry> list;
                if (!_map.TryGetValue(h, out list)) return false;
                foreach (Entry e in list)
                {
                    if (Matches(e, doc)) { value = e.Value; return true; }
                }
            }
            return false;
        }

        public T GetOrAdd(Document doc, Func<T> factory)
        {
            if (doc == null) throw new ArgumentNullException("doc");
            int h = SmartDocs.HashOf(doc);
            lock (_gate)
            {
                List<Entry> list;
                if (_map.TryGetValue(h, out list))
                {
                    foreach (Entry e in list)
                    {
                        if (Matches(e, doc)) return e.Value;
                    }
                }

                PurgeDeadLocked();                       // шинэ мөр = хүйтэн зам
                if (!_map.TryGetValue(h, out list))
                {
                    list = new List<Entry>(1);
                    _map[h] = list;
                }
                var created = new Entry { Doc = doc, Value = factory() };
                list.Add(created);
                return created.Value;
            }
        }

        public void Remove(Document doc)
        {
            if (doc == null) return;
            int h = SmartDocs.HashOf(doc);
            lock (_gate)
            {
                List<Entry> list;
                if (!_map.TryGetValue(h, out list)) return;
                list.RemoveAll(e => SmartDocs.Same(e.Doc, doc));
                if (list.Count == 0) _map.Remove(h);
            }
        }

        /// <summary>
        /// Хаагдсан (`IsValidObject = false`) баримтын мөрийг цэвэрлэнэ.  Үндсэн thread (Revit API).  `DocumentClosed` үед дуудаж, хаагдсан
        /// баримтын том кэш (tracker) санах ойд үлдэхээс сэргийлнэ.  Хаалт цуцлагдсан (баримт нээлттэй хэвээр) бол мөр хөндөгдөхгүй.
        /// </summary>
        public int PurgeDead()
        {
            lock (_gate) return PurgeDeadLocked();
        }

        private int PurgeDeadLocked()
        {
            int removed = 0;
            List<int> emptied = null;
            foreach (KeyValuePair<int, List<Entry>> kv in _map)
            {
                removed += kv.Value.RemoveAll(e => !SmartDocs.IsAlive(e.Doc));
                if (kv.Value.Count == 0)
                {
                    if (emptied == null) emptied = new List<int>();
                    emptied.Add(kv.Key);
                }
            }
            if (emptied != null) foreach (int k in emptied) _map.Remove(k);
            return removed;
        }
    }
}
