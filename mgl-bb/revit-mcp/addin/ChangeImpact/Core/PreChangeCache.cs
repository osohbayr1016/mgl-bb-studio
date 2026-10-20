using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.ClashCheck.Core;

namespace RevitMcpAddin.ChangeImpact.Core
{
    /// <summary>
    /// Кэшийн түлхүүр: файл + загварын өөрчлөлтийн тэмдэг (`ModelChangeCounter.Stamp`) + эх хана + тохиргоо (линк, гарц).
    /// Тэмдэг өөрчлөгдөхөд түлхүүр өөр болох тул ХУУЧИН кэш автоматаар хэрэглэгдэхээ болино.
    /// </summary>
    public sealed class PreChangeCacheKey : IEquatable<PreChangeCacheKey>
    {
        public string DocumentId { get; set; }
        public string ModelStamp { get; set; }
        public string WallUid { get; set; }
        /// <summary>Линкийн ачаалагдсан байдал + transform-ийн хэш (линк unload/зөөх нь `DocumentChanged` БИШ тул тэмдэгт ордоггүй).</summary>
        public string LinkSignature { get; set; }
        /// <summary>Гарцын тохиргооны хэш (хэрэглэгч гарц өөрчилбөл кэш хүчингүй).</summary>
        public string ConfigSignature { get; set; }

        /// <summary>
        /// Линк/тохиргоог УНШИЖ ЧАДААГҮЙ үед тавигдах ТОГТМОЛ тэмдэг (санамсаргүй биш).  Хоёр тийм тэмдэг тэнцүү ч «өөрчлөгдөөгүй» гэсэн үг БИШ —
        /// түлхүүр хэрэглэгдэхгүй (кэш), хурууны хээ нь `Unverifiable` (`PreChangeStale`).
        /// </summary>
        public const string Unverifiable = "unverifiable";

        /// <summary>Түлхүүр БҮРЭН мэдэгдэж байна: хоосон тэмдэг/uid-тэй эсвэл линк/тохиргоог уншиж чадаагүй түлхүүрээр кэш ХЭЗЭЭ Ч хэрэглэхгүй (fail-closed).</summary>
        public bool IsUsable
        {
            get
            {
                return !string.IsNullOrEmpty(DocumentId) && !string.IsNullOrEmpty(ModelStamp) && !string.IsNullOrEmpty(WallUid)
                    && !string.Equals(LinkSignature, Unverifiable, StringComparison.Ordinal) && !string.Equals(ConfigSignature, Unverifiable, StringComparison.Ordinal);
            }
        }

        public bool Equals(PreChangeCacheKey o)
        {
            return o != null && string.Equals(DocumentId, o.DocumentId, StringComparison.Ordinal) && string.Equals(ModelStamp, o.ModelStamp, StringComparison.Ordinal)
                && string.Equals(WallUid, o.WallUid, StringComparison.Ordinal) && string.Equals(LinkSignature ?? "", o.LinkSignature ?? "", StringComparison.Ordinal)
                && string.Equals(ConfigSignature ?? "", o.ConfigSignature ?? "", StringComparison.Ordinal);
        }

        public override bool Equals(object obj) { return Equals(obj as PreChangeCacheKey); }

        public override int GetHashCode()
        {
            unchecked
            {
                int h = 17;
                foreach (string s in new[] { DocumentId, ModelStamp, WallUid, LinkSignature, ConfigSignature }) h = h * 31 + (s != null ? StringComparer.Ordinal.GetHashCode(s) : 0);
                return h;
            }
        }
    }

    /// <summary>
    /// Document-ын хүрээний ЖИЖИГ кэш (LRU).  ⚠️ Зөвхөн ХУУЛСАН (detached) өгөгдөл, id хадгална — амьд `Document`/`Element`/`GeometryObject`/`View`/`Solid`
    /// ХЭЗЭЭ Ч оруулахгүй (түр хугацаанд ч биш: entry-ийн төрөл үүнийг баталгаажуулна).
    ///
    ///   • Яг ИЖИЛ түлхүүр (файл + тэмдэг + хана + тохиргоо) таарвал л буцаана.
    ///   • `Put` нь ИЖИЛ (файл, хана)-ны өөр тэмдэгтэй хуучин entry-г шууд хасна — хуучирсан кэш санах ойд үлдэхгүй.
    ///   • `PurgeDocument` — файл хаагдах/солигдоход.
    /// </summary>
    public sealed class PreChangeContextCache<TEntry> where TEntry : class
    {
        private readonly object _gate = new object();
        private readonly List<KeyValuePair<PreChangeCacheKey, TEntry>> _items = new List<KeyValuePair<PreChangeCacheKey, TEntry>>();
        private readonly int _capacity;
        public int Hits { get; private set; }
        public int Misses { get; private set; }

        public PreChangeContextCache(int capacity = 4)
        {
            _capacity = Math.Max(1, capacity);
        }

        public int Count { get { lock (_gate) return _items.Count; } }

        public bool TryGet(PreChangeCacheKey key, out TEntry entry)
        {
            entry = null;
            if (key == null || !key.IsUsable) { lock (_gate) Misses++; return false; }
            lock (_gate)
            {
                for (int i = _items.Count - 1; i >= 0; i--)
                {
                    if (!_items[i].Key.Equals(key)) continue;
                    entry = _items[i].Value;
                    var kv = _items[i];
                    _items.RemoveAt(i);
                    _items.Add(kv);          // LRU: хамгийн сүүлд ашигласан нь сүүлд
                    Hits++;
                    return true;
                }
                Misses++;
                return false;
            }
        }

        public void Put(PreChangeCacheKey key, TEntry entry)
        {
            if (key == null || !key.IsUsable || entry == null) return;
            lock (_gate)
            {
                _items.RemoveAll(kv => string.Equals(kv.Key.DocumentId, key.DocumentId, StringComparison.Ordinal)
                    && string.Equals(kv.Key.WallUid, key.WallUid, StringComparison.Ordinal));
                _items.Add(new KeyValuePair<PreChangeCacheKey, TEntry>(key, entry));
                while (_items.Count > _capacity) _items.RemoveAt(0);
            }
        }

        public void PurgeDocument(string documentId)
        {
            lock (_gate) _items.RemoveAll(kv => string.Equals(kv.Key.DocumentId, documentId, StringComparison.Ordinal));
        }

        public void Clear()
        {
            lock (_gate) _items.Clear();
        }
    }

    /// <summary>
    /// ӨМНӨХ төлвийн (хөдөлгөөнгүй) ХУУЛСАН тэмдэглэл — зайнаас ХАМААРАХГҮЙ тул 200 → 300 → 450 мм-ийн дараалсан preview-д дахин уншихгүй.
    /// Кэшийн entry-тэй (ижил файл + тэмдэг + хана) ХАМТ амьдарна — тэмдэг өөрчлөгдөхөд entry-тэй хамт хаягдана.
    ///
    /// ⚠️ ДАРАА төлвийг (зайнаас хамаарна) ХЭЗЭЭ Ч энд хадгалахгүй.  Хүснэгтийн снапшот нь `FinalizeSchedules`-ээр мутаци хийгддэг тул ХУУЛБАРААР буцаана.
    /// </summary>
    public sealed class BeforeMemo
    {
        public ElementPlace Source { get; set; }
        public Dictionary<long, RoomSnap> Rooms { get; } = new Dictionary<long, RoomSnap>();
        public Dictionary<long, DimSnap> Dimensions { get; } = new Dictionary<long, DimSnap>();
        public Dictionary<long, HostedSnap> Hosted { get; } = new Dictionary<long, HostedSnap>();
        public Dictionary<long, ElementPlace> Joined { get; } = new Dictionary<long, ElementPlace>();
        public Dictionary<long, ScheduleSnap> Schedules { get; } = new Dictionary<long, ScheduleSnap>();
        /// <summary>MEP хосын ӨМНӨХ төлөв: түлхүүр = `slot:elementId`.</summary>
        public Dictionary<string, ClashPairState> ClashPairs { get; } = new Dictionary<string, ClashPairState>(StringComparer.Ordinal);
        /// <summary>Нэр дэвшигч бүрт хүрсэн (хос үүсээгүй ч — «clash байхгүй» нь мэдэгдэж байна).</summary>
        public HashSet<string> ClashCandidatesRead { get; } = new HashSet<string>(StringComparer.Ordinal);
        public Dictionary<long, EgressRoute> EgressRoutes { get; } = new Dictionary<long, EgressRoute>();
        public Dictionary<long, ClearanceMemo> Clearance { get; } = new Dictionary<long, ClearanceMemo>();

        public static string ClashKey(int slot, long elementId) { return slot + ":" + elementId; }

        /// <summary>Memo-оос буцаах HostedSnap-ийн ХУУЛБАР — `PreChangeSnapshots.Merge` нь орчны зайн талбарыг мутаци хийдэг тул хуваалцсан обьект өөрчлөгдөх ЁСГҮЙ.</summary>
        public static HostedSnap CloneHosted(HostedSnap h)
        {
            if (h == null) return null;
            return new HostedSnap
            {
                Id = h.Id, Uid = h.Uid, Name = h.Name, Category = h.Category, Exists = h.Exists, HostId = h.HostId, HostKnown = h.HostKnown,
                LocationMm = h.LocationMm, FromRoomId = h.FromRoomId, ToRoomId = h.ToRoomId, FromRoomName = h.FromRoomName, ToRoomName = h.ToRoomName,
                RoomsReadable = h.RoomsReadable, ClearanceMm = h.ClearanceMm, ClearanceEvaluated = h.ClearanceEvaluated, ClearanceNote = h.ClearanceNote,
                FlipKnown = h.FlipKnown, FacingFlipped = h.FacingFlipped, HandFlipped = h.HandFlipped, Mark = h.Mark,
            };
        }

        public static ScheduleSnap CloneSchedule(ScheduleSnap s)
        {
            return s == null ? null : new ScheduleSnap { Id = s.Id, Name = s.Name, Evaluated = s.Evaluated, Members = new HashSet<long>(s.Members) };
        }
    }

    public sealed class ClearanceMemo
    {
        public double? Mm { get; set; }
        public bool Evaluated { get; set; }
        public string Note { get; set; }
    }
}
