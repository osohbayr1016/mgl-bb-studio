using System;
using System.Collections.Generic;

namespace RevitMcpAddin
{
    /// <summary>
    /// НЭГТГЭГЧИЙН ГАРАЛТ — нэг логик «хэрэглэгчийн үйлдэл».
    ///
    /// ⚠️ REVIT-ИЙН ЯМАР Ч ТӨРӨЛ БАЙХГҮЙ (`Timing.cs:20-21`,
    /// `Nudges.cs:20-23`, `Percentiles.cs:16-18`-ийн дүрэм).  Ингэснээр
    /// `revit-mcp/training/check_changeset.py` нь Revit-гүйгээр `dotnet run`
    /// хийж энэ ангийг тулгаж чадна, мөн net48 (R24) build дээр эмхэтгэгдэнэ.
    /// </summary>
    internal sealed class LogicalChangeSet
    {
        /// <summary>`RevitTools.DocUid(doc)` — ЯГ ТЭР мөр.</summary>
        public string DocKey;

        /// <summary>`RawRing`-т эргэж холбогдох муж (хоёулаа ХАМРАГДАНА).</summary>
        public long FirstSeq, LastSeq;

        /// <summary>Эхний тэжээлийн ба хаалтын мөч (`nowMs`, дуудагчийн цаг).</summary>
        public long OpenedMs, ClosedMs;

        /// <summary>ДАВХАРДААГҮЙ элементийн id.  ХЭЗЭЭ Ч null биш.</summary>
        public long[] ElementIds = new long[0];

        /// <summary>`settle` | `size` | `defer` | `flush`.</summary>
        public string CloseReason;

        /// <summary>
        /// Энэ олонлог дээр COLD цуглуулалт (`collect_rule_inputs`) ЭХЛЭХ
        /// эрхтэй эсэх.
        ///
        /// ⚠️ `defer` ⇒ ҮРГЭЛЖ false.  `maxDeferMs` нь ЯГ ТЭР мөчид асдаг —
        /// хэрэглэгч хоёр минут тасралтгүй хана зурж, нэг ч удаа завсарлаагүй
        /// үед.  Тэнд үндсэн thread-ийн ажил төлөвлөх нь t=15с, 30с, 45с бүрд
        /// ИЛ ХАРАГДАХ цочрол өгнө — тэр цочрол нь хүмүүсийг add-in-ыг
        /// устгахад хүргэдэг зүйл (R7).
        /// </summary>
        public bool MayCollect;

        /// <summary>Элементийн хязгаарт хүрч id ТАЙРАГДСАН.</summary>
        public bool Coarse;

        /// <summary>`undo:` / `redo:` гүйлгээний тоо (`ChangeTracker.cs:753`-аас ҮНЭГҮЙ).</summary>
        public int UndoBurst;

        /// <summary>Энэ олонлогт орсон гүйлгээний тоо.</summary>
        public int TxnCount;
    }

    /// <summary>
    /// ТҮҮХИЙ ҮЙЛ ЯВДАЛ → ЛОГИК ӨӨРЧЛӨЛТИЙН ОЛОНЛОГ (v2 §55).
    ///
    /// ⚠️ ЦЭВЭР.  Revit-ийн API-д хүрэхгүй, диск хөндөхгүй, цаг ӨӨРӨӨ
    /// уншихгүй — `nowMs` нь ДУУДАГЧААС ирнэ.  Энэ нь тестлэх боломжийн
    /// төлөөх шийдвэр: add-in-д C# тест ТЭГ байгаа тул `check_changeset.py`
    /// нь энэ ангийг ганцаар нь эмхэтгэж ажиллуулах ЦОРЫН ГАНЦ арга.
    ///
    /// ⚠️ ХОЁР ХАДГАЛАЛТ, НЭГ УРСГАЛ.  `ChangeTracker.RawRing` = ТҮҮХ
    /// (алдагдалгүй, сургалтад).  Энэ ангийн гаралт = БОДИТ ХУГАЦААНЫ дүн
    /// шинжилгээний оролт (нэгтгэсэн).  Хоёр нь бие биеэ ОРЛУУЛАХГҮЙ —
    /// §55-R3.  `Change`-ийн олонлогийн алгебр нь ЗОРИУД алдагдалтай тул
    /// «хүн юу хийсэн бэ» гэсэн асуултад ЗӨВХӨН `RawRing` хариулна.
    ///
    /// ⚠️ ТҮГЖЭЭГҮЙ.  ЗӨВХӨН `BimEmitter._pump` (нэг worker thread) дуудна.
    /// Хоёр дахь дуудагч гарвал энд түгжээ НЭМЭХ БИШ, тэр дуудагчийг
    /// АРИЛГА — `TryDrain`-тэй ижил шалтгаан (§3.6).
    /// </summary>
    internal sealed class ChangeSetCoalescer
    {
        /// <summary>Намжих цонх.  0228: `bim.compliance.settle_ms` (1200).</summary>
        private readonly int _settleMs;

        /// <summary>Хойшлуулалтын дээд.  0228: `bim.compliance.max_defer_ms` (15000).</summary>
        private readonly int _maxDeferMs;

        /// <summary>Элементийн дээд.  0228: `bim.compliance.max_elements_per_set` (2000).</summary>
        private readonly int _maxElements;

        /// <summary>Нээлттэй олонлогууд — БАРИМТ ТУТАМД НЭГ (§3.18-ын 5-р мөр).</summary>
        private readonly Dictionary<string, Open> _open =
            new Dictionary<string, Open>(StringComparer.Ordinal);

        /// <summary>⚠️ ДЕТЕРМИНИСТ ДАРААЛАЛ.  `Dictionary`-ийн тоологч нь
        /// баталгаатай дараалалгүй; хоёр баримт зэрэг бэлэн болоход аль нь
        /// эхэлж хаагдахыг ТОГТМОЛ байлгах нь тестийг давтагдах болгоно.</summary>
        private readonly List<string> _order = new List<string>();

        private sealed class Open
        {
            public string DocKey;
            public long FirstSeq, LastSeq;
            public long OpenedMs, LastFeedMs;
            public readonly HashSet<long> Ids = new HashSet<long>();
            public bool Coarse;
            public int UndoBurst;
            public int TxnCount;
        }

        public ChangeSetCoalescer(int settleMs, int maxDeferMs, int maxElements)
        {
            _settleMs = Math.Max(1, settleMs);
            _maxDeferMs = Math.Max(_settleMs, maxDeferMs);
            _maxElements = Math.Max(1, maxElements);
        }

        /// <summary>Одоо нээлттэй байгаа олонлогийн тоо (оношилгоо).</summary>
        public int OpenCount { get { return _open.Count; } }

        /// <summary>
        /// `RawRing`-ийн НЭГ бичлэгийг нэмнэ.  ХУРДАН, түгжээгүй.
        ///
        /// ⚠️ `ids` нь ДУУДАГЧИЙН ДАХИН АШИГЛАДАГ буфер — `idsLen` хүртэлх
        /// хэсгийг л уншина, ишийг нь ХАДГАЛАХГҮЙ.
        /// ⚠️ `ids` null байж БОЛНО (түүвэргүй гүйлгээ) — унахгүй.
        /// </summary>
        public void Feed(long seq, long nowMs, string docKey,
                         long[] ids, int idsLen, bool undo)
        {
            if (string.IsNullOrEmpty(docKey)) return;

            Open o;
            if (!_open.TryGetValue(docKey, out o))
            {
                o = new Open
                {
                    DocKey = docKey,
                    FirstSeq = seq,
                    OpenedMs = nowMs,
                };
                _open[docKey] = o;
                _order.Add(docKey);
            }

            // ⚠️ ЦАГ УХРАВАЛ (систем цагийн шилжилт, VM түр зогсолт) цонхыг
            //    ХӨЛДӨӨХГҮЙ: `TryClose` нь сөрөг зөрүүг `defer` гэж уншина.
            o.LastFeedMs = nowMs;
            o.LastSeq = seq;
            o.TxnCount++;
            if (undo) o.UndoBurst++;

            if (ids != null)
            {
                int n = Math.Min(idsLen, ids.Length);
                for (int i = 0; i < n; i++)
                {
                    if (o.Ids.Count >= _maxElements)
                    {
                        // Хязгаарт хүрэв — ЦААШ ЦУГЛУУЛАХГҮЙ, гэхдээ
                        // ТАЙРАГДСАН гэдгээ ИЛ хэлнэ (§3.18-ын 3-р мөр).
                        o.Coarse = true;
                        break;
                    }
                    o.Ids.Add(ids[i]);
                }
            }
        }

        /// <summary>
        /// Хаах цаг болсон уу.  `null` = хараахан үгүй.
        ///
        /// ⚠️ ГУРВАН ХААЛТЫН ШАЛТГААН, ГУРАВ НЬ ӨӨР УТГАТАЙ:
        ///   "size"   — элементийн хязгаарт хүрэв      ⇒ ЦУГЛУУЛЖ БОЛНО
        ///   "defer"  — `maxDeferMs` өнгөрөв           ⇒ ОЛОНЛОГ ҮҮСНЭ,
        ///              ГЭХДЭЭ ЦУГЛУУЛАЛТ ЭХЛЭХГҮЙ (`MayCollect = false`)
        ///   "settle" — жинхэнэ нам гүм цонх өнгөрөв   ⇒ `quiet` үнэн бол
        ///              ЦУГЛУУЛЖ БОЛНО
        ///
        /// ⚠️ ШАЛГАХ ДАРААЛАЛ НЬ ГЭРЭЭ: size → defer → settle.  `defer`-ийг
        /// `settle`-ийн ДАРАА шалгавал тасралтгүй зурж буй хэрэглэгчийн
        /// ажлын дундуур цуглуулалт эхлэх ба тэр нь ЯГ хориглосон цочрол.
        ///
        /// `quiet` = энэ мөчлөгт шинэ бичлэг ирээгүй (`n == 0`).  Шинэ ажил
        /// урсаж байхад «намжсан» гэж үзэхгүй.
        /// </summary>
        public LogicalChangeSet TryClose(long nowMs, bool quiet)
        {
            for (int i = 0; i < _order.Count; i++)
            {
                string key = _order[i];
                Open o;
                if (!_open.TryGetValue(key, out o))
                {
                    _order.RemoveAt(i--);
                    continue;
                }

                if (o.Coarse || o.Ids.Count >= _maxElements)
                    return Close(o, nowMs, "size", true, i);

                long sinceOpen = nowMs - o.OpenedMs;
                if (sinceOpen < 0 || sinceOpen >= _maxDeferMs)
                    return Close(o, nowMs, "defer", false, i);

                long sinceFeed = nowMs - o.LastFeedMs;
                if (sinceFeed >= _settleMs)
                    return Close(o, nowMs, "settle", quiet, i);
            }
            return null;
        }

        /// <summary>
        /// БҮХ нээлттэй олонлогийг хүчээр хаана — унтраалт дээр, дараагийн
        /// нэгийг буцаана (null болтол дуудна).  `MayCollect` нь ҮРГЭЛЖ false:
        /// унтраалт дээр COLD ажил ЭХЛҮҮЛЭХ нь Revit-ийн хаагдалтыг гацаана.
        /// </summary>
        public LogicalChangeSet ForceClose(long nowMs)
        {
            if (_order.Count == 0) return null;
            for (int i = 0; i < _order.Count; i++)
            {
                Open o;
                if (_open.TryGetValue(_order[i], out o))
                    return Close(o, nowMs, "flush", false, i);
                _order.RemoveAt(i--);
            }
            return null;
        }

        private LogicalChangeSet Close(Open o, long nowMs, string reason,
                                       bool mayCollect, int orderIndex)
        {
            var ids = new long[o.Ids.Count];
            o.Ids.CopyTo(ids);
            Array.Sort(ids);   // детерминист гаралт — тулгалт хийх боломжтой

            _open.Remove(o.DocKey);
            _order.RemoveAt(orderIndex);

            return new LogicalChangeSet
            {
                DocKey = o.DocKey,
                FirstSeq = o.FirstSeq,
                LastSeq = o.LastSeq,
                OpenedMs = o.OpenedMs,
                ClosedMs = nowMs,
                ElementIds = ids,
                CloseReason = reason,
                MayCollect = mayCollect,
                Coarse = o.Coarse,
                UndoBurst = o.UndoBurst,
                TxnCount = o.TxnCount,
            };
        }
    }
}
