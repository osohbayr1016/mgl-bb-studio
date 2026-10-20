using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading;

namespace RevitMcpAddin
{
    /// <summary>
    /// BIM ҮЙЛ ЯВДЛЫН БАТ БӨХ ИЛГЭЭГЧ — `POST /api/learning/events`.
    ///
    /// ⚠️ ЭНЭ БОЛ 0201-0210-ЫН ЦОРЫН ГАНЦ ҮЙЛДВЭРЛЭГЧ.  Схем бүрэн шипсэн,
    /// сервер тал (`learning.ts`) хүлээж байсан, гэвч C# илгээгч БАЙХГҮЙ тул
    /// таван хүснэгт БҮГД ХООСОН байв.  Эзний R1 («алдаагүйгээр өгөгдөл
    /// цуглуулах») нь ЯГ ЭНЭ файл дээр блоклогдож байсан.
    ///
    /// ⚠️ ЛОКАЛ ЭХЛЭЭД.  Мөр нь ЭХЛЭЭД дискэнд (`bim-events.jsonl`), ДАРАА НЬ
    /// сүлжээнд.  `AssistantLog.FlushAsync`-ийн батлагдсан хэв маяг: илгээлт
    /// бүтэлгүйтвэл мөр локалд ҮЛДЭНЭ.
    ///
    /// ⚠️ БҮТЭН ДАХИН БИЧИЛТ ХЭЗЭЭ Ч ХИЙХГҮЙ.  `AssistantLog`-ийн бүтэн
    /// цувралт нь 3000 мөрийг дахин бичдэг ба тэр нь мессеж бүрд дуудагдаж
    /// чатыг удаашруулж байсан.  JSONL нь ЗАЛГАМАЛ — залгах бичилт хангалттай.
    ///
    /// ⚠️ `Sent` ТУГИЙН АЛДААГ ДАВТАХГҮЙ.  `AssistantLog.cs:108` нь түүнийг
    /// сериалчлалаас ХАСДАГ тул Revit асах бүрд БҮХ хуучин мөрийг ДАХИН
    /// илгээдэг — сервер `ON CONFLICT`-оор шүүдэг тул хор хөнөөлгүй ч бодит
    /// хүргэлтийн алдааг НУУНА.  Энд тусдаа КУРСОР файл (`bim-events.cursor`)
    /// нь баталгаажсан локал мөрийн дугаарыг хадгална, tmp+move-оор атомаар.
    /// Нэг флашд НЭГ жижиг бичилт, 3000 мөрийн цувралт БИШ.
    ///
    /// ⚠️ REVIT-ИЙН ЯМАР Ч ТӨРӨЛ ХЭРЭГЛЭХГҮЙ.  Хоёр thread нь Revit-ийн
    /// үндсэн thread-ээс ГАДНА ажиллах ба Revit API нь тэндээс хүрэх
    /// БОЛОМЖГҮЙ.  Баримтын баримтуудыг `ChangeTracker.FactsOf` нь
    /// `DocumentOpened` дээр урьдчилан уншсан МӨР болгож өгнө.
    ///
    /// ⚠️ UI-Д ХЭЗЭЭ Ч ХҮРЭХГҮЙ — WPF рүү marshal хийхгүй, самбар нээхгүй
    /// (Хориглолт №8, №9).  Түгжээ барьж болох thread-ээс UI рүү marshal
    /// хийх нь ХОЁР THREAD-ИЙН ГАЦАА бөгөөд хэрэглэгчид «Revit өлгөгдлөө»
    /// гэж харагдана.
    /// </summary>
    internal static class BimEmitter
    {
        /* ============================================================== */
        /*  ЗАМ, ХЯЗГААР                                                   */
        /* ============================================================== */

        private static string Dir
        {
            get
            {
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "RevitMcpAddin");
            }
        }

        /// <summary>
        /// ПРОЦЕССЫН ӨВӨРМӨЦ ТАГ — файлын нэрэнд ордог.
        ///
        /// ⚠️ ЯАГААД ЗААВАЛ ВЭ (2026-09-01, `check_emitter.py` T6-аар
        /// ХЭМЖИГДСЭН).  Өмнө нь бүх процесс ГАНЦ `bim-events.jsonl` /
        /// `.cursor` / `bim-sessions.json` рүү бичдэг байв.  Нэг PC дээр
        /// ХОЁР Revit нээх нь ердийн зүйл бөгөөд тэр үед:
        ///   (1) `File.AppendAllText` нь `FileShare.Read`-ээр нээдэг тул
        ///       нөгөө процессын залгалт «хуваалцлын зөрчил»-өөр УНАНА —
        ///       хэмжилтээр 600 мөрийн 59 нь дискэнд ХЭЗЭЭ Ч хүрээгүй;
        ///   (2) `bim-sessions.json` нь бүтэн дахин бичигддэг тул СҮҮЛИЙН
        ///       бичигч нөгөөгийн толгойг ДАРНА — хоёр сессийн нэг нь
        ///       алга болж, дахин асаахад тэр сессийн БҮХ мөр
        ///       «толгойгүй» гэж хаягдана (хэмжилтээр 250 мөр);
        ///   (3) `_lineNo` нь процесс тус бүрд тусдаа тул хоёулаа ижил
        ///       `n` олгож, нэгнийх нь курсор нөгөөгийнхийг «баталгаажсан»
        ///       гэж тэмдэглэнэ;
        ///   (4) `TryCompact` нь файлыг ӨӨРИЙН `unsent`-ээс бүтэн дахин
        ///       бичдэг тул нөгөө процессын мөрийг УСТГАНА.
        /// Нийт 600 үйл явдлын 307 нь серверт ХЭЗЭЭ Ч хүрээгүй.
        ///
        /// ⚠️ ШИЙДЭЛ: файл БҮР нэг эзэнтэй.  Процесс бүр өөрийн
        /// `<tag>` -тай багц файлтай, өөрийнхөө л дотор бичнэ — тиймээс
        /// хуваалцлын зөрчил, толгойн дарагдалт, `n`-ийн давхцал БҮГД
        /// боломжгүй болно.  Унасан процессын үлдэгдлийг дараагийн
        /// процесс `AdoptOrphans`-аар ӨВЛӨНӨ (доороос үз).
        /// </summary>
        private static string _inst;

        private static string Inst
        {
            get
            {
                string s = _inst;
                if (s != null) return s;
                try
                {
                    s = Pid + "-" + ProcessStartTicks().ToString(CultureInfo.InvariantCulture);
                }
                catch { s = "0-0"; }
                Interlocked.CompareExchange(ref _inst, s, null);
                return _inst;
            }
        }

        private static string LogPath { get { return Path.Combine(Dir, "bim-events." + Inst + ".jsonl"); } }
        private static string CursorPath { get { return Path.Combine(Dir, "bim-events." + Inst + ".cursor"); } }

        /// <summary>ЭЗЭМШЛИЙН ТҮГЖЭЭ.  Процессын БҮХ АМЬДРАЛЫН турш
        /// `FileShare.None`-оор нээлттэй байна; өөр процесс түүнийг нээж
        /// чадвал эзэн нь ҮХСЭН гэсэн үг (`OrphanIsFree`).</summary>
        private static string LockPath { get { return Path.Combine(Dir, "bim-events." + Inst + ".lock"); } }

        /// <summary>ХУУЧИН (тагггүй) файлууд — 1.2.1 ба түүнээс өмнөх
        /// хувилбарын үлдэгдэл.  Шинэчлэлтийн дараа тэдгээрийг ЗААВАЛ
        /// өвлөх ёстой, эс бөгөөс ажилтны сүүлийн офлайн өдөр алга болно.</summary>
        private const string LegacyLog = "bim-events.jsonl";
        private const string LegacyCursor = "bim-events.cursor";
        private const string LegacySessions = "bim-sessions.json";

        /// <summary>
        /// СЕССИЙН ТОЛГОЙН САЙДКАР.
        ///
        /// ⚠️ ЯАГААД ЗААВАЛ ВЭ: `POST /api/learning/events` нь `session`
        /// объектгүй бол `sessionId === null` болж ГҮЙЛГЭЭ БҮР
        /// `rejected.txns`-д унана (`learning.ts:508-509`) — багц 200
        /// буцаах ч НЭГ Ч мөр бичигдэхгүй.  Revit унасны дараа JSONL-д
        /// үлдсэн мөрүүд нь ӨМНӨХ процессын `session_uid`-ыг заана; тэр
        /// толгойг сэргээх өөр эх сурвалж БАЙХГҮЙ.
        ///
        /// ⚠️ ЭНЭ НЬ «БҮТЭН ДАХИН БИЧИЛТ» БИШ — сесс нь баримт тутам НЭГ,
        /// нэг өдөрт хэдхэн ширхэг.  Файл нь хэдэн KB.
        /// </summary>
        private static string SessionsPath { get { return Path.Combine(Dir, "bim-sessions." + Inst + ".json"); } }

        /// <summary>Санах ойн дараалал.  `Percentiles.cs`-ийн хэв маяг.</summary>
        private const int MaxPending = 4096;

        /// <summary>Дараалсан алдааны дараах таслуур.  §32 «bounded retry».</summary>
        private const int BreakerFailures = 5;
        private const int BreakerProbeMs = 5 * 60 * 1000;

        private static readonly int[] BackoffMs = { 2000, 4000, 8000, 16000, 32000, 60000 };

        /// <summary>Файлын дээд хэмжээ.  Хэтэрвэл ЗӨВХӨН баталгаажсан мөрийг
        /// хаяж НЯГТРУУЛНА (ховор, атомаар, pid-тэй tmp).</summary>
        private const long MaxLogBytes = 2 * 1024 * 1024;

        /// <summary>Санах ойд барих илгээгдээгүй мөрийн дээд тоо.</summary>
        private const int MaxUnsent = 20000;

        /* ── БАГЦЫН ГУРВАН ХЯЗГААР (§3.9.a-ийн 5-р хэсэг) ──────────────
         *
         * ⚠️ 100 × 24 = 2400 > 2000.  Тиймээс `emit_batch_max`-ыг ганцаараа
         *    шалгах нь ХҮРЭЛЦЭХГҮЙ: бүх гүйлгээ дүүрэн түүвэртэй үед багц нь
         *    ~83 гүйлгээн дээр `touches`-ийн хязгаарт хүрнэ.  Угсрагч
         *    ГУРВАН тоолуурыг ЗЭРЭГ явуулж, аль нэг нь хязгаарт хүрмэгц
         *    багцыг хаана.  Үүнгүйгээр эхний том наалт 413 авах ба тэр нь
         *    «хагаслаад дахин оролдох» замаар ажиллах ч ЯЛГААГҮЙ АЛДАА. */

        /// <summary>`learning.ts:88` — `MAX_TOUCH_BATCH`.</summary>
        private const int MaxTouchBatch = 2000;

        /// <summary>`learning.ts` — `txn_batch_max`-ийн ХАТУУ дээд (0208).</summary>
        private const int HardTxnBatch = 200;

        /// <summary>0228: `bim.compliance.emit_batch_max`.  413 дээр ХАГАСЛАНА.</summary>
        private static int _batchMax = 100;

        /* ── НЭГТГЭГЧИЙН ТОХИРГОО (0228) ───────────────────────────── */
        private const int SettleMs = 1200;
        private const int MaxDeferMs = 15000;
        private const int MaxElementsPerSet = 2000;

        /* ============================================================== */
        /*  ТӨЛӨВ                                                          */
        /* ============================================================== */

        private static readonly BlockingCollection<string> Pending =
            new BlockingCollection<string>(new ConcurrentQueue<string>(), MaxPending);

        private static CancellationTokenSource _cts;
        private static Thread _pump;   // (1) ШАВХАХ + ENVELOPE ҮҮСГЭХ
        private static Thread _post;   // (2) JSONL + HTTP

        /// <summary>`Start` нь давхар дуудагдахаас хамгаална
        /// (`Percentiles.cs:417`-ийн `CompareExchange` хэв маяг).</summary>
        private static int _started;

        /// <summary>`_post` нь курсор ба мөрийн дугаарыг дискнээс уншиж
        /// дуустал `_pump` дугаар ОЛГОХГҮЙ — эс бөгөөс `n` давхардаж
        /// курсор буруу мөрийг «баталгаажсан» гэж тэмдэглэнэ.</summary>
        private static readonly ManualResetEventSlim _ready =
            new ManualResetEventSlim(false);

        /// <summary>Дараалал дүүрч алдагдсан мөр → `bim_sessions.dropped_count`.</summary>
        private static long _dropped;

        /// <summary>`RawRing` дүүрч алдагдсан гүйлгээ → мөн `dropped_count`.</summary>
        private static long _droppedRing;

        /* ── ДИСКНИЙ БҮТЭЛГҮЙТЛИЙН ТООЛУУР (ОЛОЛТ B, 2026-09-01) ────────
         *
         * ⚠️ ЮУ ЭВДЭРЧ БАЙСАН БЭ.  `AppendLines` нь диск дүүрсэн / эрх
         *    байхгүй / вирусны хөтөлбөр файлыг түгжсэн БҮХ тохиолдлыг
         *    ХООСОН `catch {}`-аар залгидаг байв, ТООЛУУРГҮЙ.  Санах ойн
         *    хуулбар нь POST хийгдсээр байдаг тул (T7-оор батлагдсан
         *    доройтол) машин нь СЕРВЕР ТАЛААС БҮРЭН ЭРҮҮЛ харагдана —
         *    гэтэл `%APPDATA%` нь бичигдэхгүй, Revit унамагц тэр өдрийн
         *    бүх офлайн ажил АЛГА БОЛНО, аль ч талд НЭГ Ч тоолуургүй.
         *
         * ⚠️ ЯАГААД `dropped_count` РУУ НЭМЭХГҮЙ ВЭ.  `dropped_count`-ийн
         *    утга нь «бодит байдалд байсан, энэ хүснэгтэд БАЙХГҮЙ»
         *    (`learning.ts:1002-1010`).  Дискэнд бичигдээгүй ЧУ амжилттай
         *    POST хийгдсэн мөр нь хүснэгтэд БАЙГАА — түүнийг «алдагдсан»
         *    гэж тоолох нь `declared_dropped` тулгалтыг (`learning.ts:1192`)
         *    худал болгоно.  Тиймээс энэ нь ТУСДАА хэмжигдэхүүн.
         *
         * ⚠️ СЕРВЕРТ ХҮРЭХ ЗАМ: `session.perf` → `bim_sessions.perf_json`
         *    (0226).  `lib/bimEvents.ts:403` нь ЯГ ҮҮНИЙГ зааж өгсөн:
         *    «⛔ ДАРААГИЙН бодит багана нэмэхгүй: шинэ гүйцэтгэлийн тоо
         *    `perf_json` дотор».  `routes/learning.ts:162` `perfJson()` нь
         *    объектыг ШУУД `JSON.stringify` хийдэг тул сервер талд НЭГ Ч
         *    мөр өөрчлөхгүйгээр хүрнэ.
         *
         * ⚠️ ҮЛДЭГДЭЛ ЭРСДЭЛ (зориудаар хүлээн авсан).  Унтраалтын
         *    шавхалтад алдагдсан мөр (`_diskLostLines`) нь ЭНЭ сессид
         *    хэзээ ч POST хийгдэхгүй — тэр агшинд сүлжээний давхарга
         *    аль хэдийн зогссон, диск нь бичигдэхгүй тул хадгалах ч
         *    аргагүй.  ГЭХДЭЭ бичигдэхгүй `%APPDATA%` нь сессийн ЭХНИЙ
         *    залгалтаас эхлэн унадаг тул `fail_writes` нь ХАМГИЙН ОЙРЫН
         *    POST-оор аль хэдийн серверт хүрсэн байна — тэр л «энэ машин
         *    эрүүл БИШ» гэдгийг төвд харуулах механизм.
         */

        /// <summary>Дискэнд бичих ОРОЛДЛОГЫН бүтэлгүйтлийн тоо.</summary>
        private static long _diskFailWrites;

        /// <summary>Дискэнд ХҮРЭЭГҮЙ мөрийн тоо (эрсдэлд орсон, заавал
        /// алдагдсан гэсэн үг БИШ — сүлжээ ажиллаж байвал хүргэгдэнэ).</summary>
        private static long _diskFailLines;

        /// <summary>Амжилттай залгалтын тоо — «0 бүтэлгүйтэл» ба «огт
        /// бичээгүй» хоёрыг ялгах цорын ганц зам.</summary>
        private static long _diskOkWrites;

        /// <summary>ҮНЭХЭЭР АЛДАГДСАН мөр: унтраалтын эцсийн шавхалтад
        /// дискэнд бичигдэж ЧАДААГҮЙ бөгөөд POST ч хийгдээгүй.  Энэ нь
        /// `_dropped`-д БАС нэмэгдэнэ (жинхэнэ алдагдал мөн).</summary>
        private static long _diskLostLines;

        /// <summary>Сүүлийн онцгой тохиолдлын ТӨРЛИЙН НЭР (48 тэмдэгт).
        /// ⚠️ Замын нэр / мессеж ХЭЗЭЭ Ч БИШ — тэдгээр нь хэрэглэгчийн нэр,
        /// сүлжээний хуваалцлын зам агуулж болно.</summary>
        private static volatile string _diskLastError;

        /* ── СЕРВЕРИЙН ХАРИУГ ТУЛГАХ ТООЛУУР (ОЛОЛТ D, 2026-09-01) ─────
         *
         * ⚠️ ЮУ ЭВДЭРЧ БАЙСАН БЭ.  `SendOneBatch` нь ЯМАР Ч 2xx-ыг «БҮРЭН
         *    ХҮЛЭЭН АВСАН» гэж үзэж, биеийг УНШИЛГҮЙ курсорыг урагшлуулдаг
         *    байв.  `POST /api/learning/events` нь 200 буцаагаад БҮХ
         *    гүйлгээг `rejected.txns`-д хаях нь ХЭВИЙН ЗАМ (толгойгүй сесс,
         *    `learning.ts:508-509`; төсвийн таслалт; хэлбэрийн алдаа).
         *    Тэр үед клиент «илгээгдлээ» гэж бодоод мөрийг устгана.
         *
         * ⚠️ ГЭХДЭЭ КУРСОР ХЭВЭЭР УРАГШИЛНА.  Татгалзсан мөрийг ДАХИН
         *    илгээх нь ЯГ ИЖИЛ татгалзал өгнө (шалтгаан нь мөрийн ӨӨРИЙНХ
         *    нь хэлбэр) — дараалал МӨНХӨД тээглэнэ.  Тиймээс шийдэл нь
         *    «дахин оролдох» БИШ, «ТООЛЖ мэдээлэх».
         *
         * ⚠️ ЭДГЭЭР НЬ `_dropped`-Д ОРОХГҮЙ.  Сервер өөрөө
         *    `rejected + dropped`-ыг `bim_sessions.dropped_count` дээр
         *    нэмдэг (`learning.ts:1004-1010`) — клиент дахин нэмбэл
         *    ХОЁР ДАХИН тоологдоно.
         */

        /// <summary>Серверийн `rejected.*`-ийн нийлбэр.</summary>
        private static long _srvRejected;

        /// <summary>Серверийн `dropped.*`-ийн нийлбэр (fallback-д ч ороогүй).</summary>
        private static long _srvDropped;

        /// <summary>`sent − accepted − duplicates − rejected − dropped &gt; 0`
        /// — сервер ТАЙЛБАРЛААГҮЙ зөрүү.  Хэзээ ч тэгээс өөр байх ЁСГҮЙ;
        /// байвал гэрээ зөрчигдсөн.</summary>
        private static long _srvUnaccounted;

        /// <summary>`degraded:true` буцаасан багцын тоо (мөр тус бүрийн
        /// fallback ажилласан — серверийн эмгэг).</summary>
        private static long _srvDegraded;

        /// <summary>Тулгагдсан багцын тоо (танигдсан хэлбэртэй хариу).</summary>
        private static long _srvBatches;

        /// <summary>Локал мөрийн дугаар.  ⚠️ `Interlocked` -ээр л өснө.</summary>
        private static long _lineNo;

        /// <summary>Баталгаажсан ХИЛ: `n <= _cursor` бүх мөр сервер дээр байна.</summary>
        private static long _cursor;

        /// <summary>
        /// ДИСКЭНД БИЧИГДСЭН ХАМГИЙН ӨНДӨР `n`.
        ///
        /// ⚠️ КУРСОРЫН ДЭЭД ХЯЗГААР.  `_lineNo` нь ОЛГОГДСОН дугаар —
        /// `Pending`-д хараахан дискэнд хүрээгүй мөр байж болно.  Курсорыг
        /// `_lineNo` хүртэл урагшлуулбал тэр мөрүүд «баталгаажсан» болж,
        /// Revit тэр агшинд унавал БҮРМӨСӨН алдагдана.  `Enqueue` нь
        /// дугаарыг өсөх дарааллаар олгож, `Pending` нь FIFO тул дискэнд
        /// хүрсэн бүх `n` нь дараалалд үлдсэн бүх `n`-ээс БАГА — тиймээс энэ
        /// нэг тоо аюулгүй хил болно.
        /// </summary>
        private static long _maxAppended;

        /// <summary>
        /// ДИСКЭН ДЭЭР БАЙГАА ЧУ САНАХ ОЙД АЧААЛААГҮЙ ХАМГИЙН БАГА `n`.
        ///
        /// ⚠️ ЯАГААД ЗААВАЛ ВЭ (`check_emitter.py` T5b-ээр ХЭМЖИГДСЭН).
        /// `unsent` нь `MaxUnsent` (20 000) мөрөөр хязгаарлагдана — сүлжээгүй
        /// бүтэн өдрийн ажил тэрнээс их байж БОЛНО.  Хэтэрсэн мөрүүд нь
        /// ДИСКЭН ДЭЭР БАЙСААР байдаг ч `unsent`-д ОРДОГГҮЙ.  `TryCompact`
        /// нь файлыг ЗӨВХӨН `unsent`-ээс дахин бичдэг тул тэдгээрийг
        /// БҮРМӨСӨН УСТГАНА — хэмжилтээр 500 мөр, `dropped` тоолуур 0
        /// (өөрөөр хэлбэл ЧИМЭЭГҮЙ АЛДАГДАЛ, 0202-ийн гэрээг зөрчсөн).
        ///
        /// ⚠️ Энэ тоо нь ХОЁР зүйлийг барина:
        ///   (1) `TryCompact` нь энэ тоо тодорхой байхад нягтралт ХИЙХГҮЙ
        ///       (лог түр томрох нь өгөгдөл алдахаас ХАМААГҮЙ дээр);
        ///   (2) `AdvanceCursor` нь курсорыг үүнээс ЦААШ урагшлуулахгүй —
        ///       эс бөгөөс ачаалаагүй мөрүүд «баталгаажсан» болно.
        /// `unsent` хоосрох бүрд `ReloadFromDisk` дискнээс дахин ачаална.
        /// </summary>
        private static long _minUnloadedN = long.MaxValue;

        /// <summary>Процессын амьдралын турш барих эзэмшлийн түгжээ.</summary>
        private static FileStream _ownLock;

        /// <summary>Сервер `{accepted:null, ingest:'off'}` буцаав — энэ сессид
        /// ДАХИН ОРОЛДОХГҮЙ (`learning.ts:304`, `revit.ts`-ийн хэв маяг).</summary>
        private static volatile bool _ingestOff;

        /// <summary>docKey → сесс.  ⚠️ ЗӨВХӨН `_pump` бичнэ.</summary>
        private static readonly Dictionary<string, Session> _sessions =
            new Dictionary<string, Session>(StringComparer.Ordinal);

        /// <summary>session_uid → толгой.  `_pump` бичнэ, `_post` уншина.</summary>
        private static readonly ConcurrentDictionary<string, SessionHeader> _headers =
            new ConcurrentDictionary<string, SessionHeader>(StringComparer.Ordinal);

        /* ── ПРОЦЕССЫН ТҮВШНИЙ ТОГТМОЛУУД ──────────────────────────── */
        private static string _machineHash;
        private static string _revitVersion = "";
        private static string _revitBuild;
        private static string _addinVersion = "";
        private static string _addinChannel = "prod";
        private static int _tzOffsetMin;
        private static long _procStartTicks;

        private static ChangeSetCoalescer _coalescer;

        /// <summary>
        /// `2-3` бүртгэдэг СОНГОЛТОТ дэгээ.
        ///
        /// ⚠️ NULL БАЙЖ БОЛНО — тэр үед ч цуглуулга ЯВСААР БАЙНА.  R1
        /// (өгөгдөл цуглуулах) нь compliance-ийн `authority_level`-ээс ч,
        /// дүрмийн багцаас ч, `ComplianceScheduler` шипсэн эсэхээс ч
        /// ХАМААРАХГҮЙ.
        /// </summary>
#pragma warning disable CS0649 // 2-3 (`ComplianceScheduler`) оноодог; энэ релизэд оноогч БАЙХГҮЙ.
        internal static Action<LogicalChangeSet> ComplianceHook;
#pragma warning restore CS0649

        private sealed class Session
        {
            public string Uid;
            public string DocKey;
            public string StartedAtIso;
            /// <summary>⚠️ ГҮЙЛГЭЭНИЙ `seq`-ЭЭС ТУСДАА ТООЛУУР.  `learning_events`
            /// нь `(stream_id, seq)`-ээр өвөрмөц, `revit_transactions` нь
            /// `(session_id, seq)`-ээр.  Нэг тоолуурыг хуваалцвал үйл явдлын
            /// дугаарууд нүхтэй болж `/events/head`-ийн `MAX(seq)` resume нь
            /// мөр АЛГАСНА.</summary>
            public long EventSeq;
            public bool Ended;
        }

        /// <summary>⚠️ ТАЛБАР БИШ, ШИНЖ ЧАНАР.  `System.Text.Json` нь
        /// анхдагчаараа ТАЛБАРЫГ ОГТ сериалчилдаггүй — сайдкар файл чимээгүй
        /// `{}` болж, дараагийн асаалт бүх мөрийг толгойгүй болгоно.</summary>
        private sealed class SessionHeader
        {
            public string SessionUid { get; set; }
            public string StartedAt { get; set; }
            public string DocUid { get; set; }
            public string DocTitle { get; set; }
            public bool IsLink { get; set; }
            public string CentralPathHash { get; set; }
            public string MachineHash { get; set; }
            public string Worksharing { get; set; }
            public string RevitVersion { get; set; }
            public string RevitBuild { get; set; }
            public string AddinVersion { get; set; }
            public string AddinChannel { get; set; }
            public int TzOffsetMin { get; set; }
            public string EndedAt { get; set; }
        }

        /// <summary>Дискэнд бичигдсэн, хараахан баталгаажаагүй мөр.</summary>
        private struct Line
        {
            public long N;
            public string Json;
            public long QueuedTicks;
        }

        /* ============================================================== */
        /*  ЭХЛЭЛ / ЗОГСОЛТ                                                */
        /* ============================================================== */

        /// <summary>
        /// `App.OnStartup`-аас, `Metrics.Start()`-ийн ДАРАА дуудна.
        ///
        /// ⚠️ ХЭЗЭЭ Ч алдаа шидэхгүй — эндээс шидэгдсэн алдаа add-in-ыг
        /// унагаах ЁСГҮЙ.
        /// ⚠️ ЭНД ДИСК ХӨНДӨХГҮЙ.  Файл унших нь `_post` thread дээр,
        /// `_ready` дохионы ард (Revit-ийн ачаалалтыг сааруулахгүй).
        /// </summary>
        public static void Start(string revitVersion, string revitBuild)
        {
            if (Interlocked.CompareExchange(ref _started, 1, 0) != 0) return;
            try
            {
                _revitVersion = Trunc(revitVersion, 16) ?? "";
                _revitBuild = Trunc(revitBuild, 32);
                _addinVersion = Trunc(BuildInfo.Version, 32) ?? "";
                _procStartTicks = ProcessStartTicks();
                _machineHash = MachineHash();
                // ⚠️ JS-ийн `getTimezoneOffset()` тэмдэглэгээ: UTC − локал.
                //    Улаанбаатар (+08:00) → -480.
                _tzOffsetMin = -(int)Math.Round(
                    TimeZoneInfo.Local.GetUtcOffset(DateTime.Now).TotalMinutes);
                _coalescer = new ChangeSetCoalescer(SettleMs, MaxDeferMs, MaxElementsPerSet);

                _cts = new CancellationTokenSource();

                _post = new Thread(PostLoop);
                _post.IsBackground = true;   // ⚠️ гацсан ч процессыг БАРИХГҮЙ
                _post.Name = "MglBimEmitterPost";
                _post.Start();

                _pump = new Thread(PumpLoop);
                _pump.IsBackground = true;   // ⚠️ гацсан ч процессыг БАРИХГҮЙ
                _pump.Name = "MglBimEmitterPump";
                _pump.Start();
            }
            catch
            {
                // Thread үүсээгүй — add-in бүхэлдээ ХЭВИЙН ажиллана, зөвхөн
                // бүртгэл хийгдэхгүй.
            }
        }

        /// <summary>Дараалалд байгаа мөрийн тоо (оношилгоо, самбар).</summary>
        public static int PendingCount { get { return Pending.Count; } }

        /// <summary>Хаягдсан мөрийн НИЙТ тоо (дараалал дүүрсэн + цагираг дүүрсэн).</summary>
        public static long DroppedCount
        {
            get { return Interlocked.Read(ref _dropped) + Interlocked.Read(ref _droppedRing); }
        }

        /// <summary>ДИСКЭНД БИЧИХ бүтэлгүйтсэн ОРОЛДЛОГЫН тоо (ОЛОЛТ B).
        /// ⚠️ `DroppedCount`-ЭЭС ТУСДАА: бичигдээгүй мөр нь сүлжээгээр
        /// хүргэгдсэн байж БОЛНО.  `session.perf.disk`-ээр серверт хүрнэ.</summary>
        public static long DiskFailCount { get { return Interlocked.Read(ref _diskFailWrites); } }

        /// <summary>Дискэнд хүрээгүй МӨРИЙН тоо (эрсдэлд орсон).</summary>
        public static long DiskFailLines { get { return Interlocked.Read(ref _diskFailLines); } }

        /// <summary>Унтраалтын шавхалтад БҮРМӨСӨН алдагдсан мөр — `_dropped`-д
        /// БАС нэмэгдсэн.</summary>
        public static long DiskLostLines { get { return Interlocked.Read(ref _diskLostLines); } }

        /// <summary>Сервер ТАТГАЛЗСАН мөрийн нийт тоо (ОЛОЛТ D).</summary>
        public static long ServerRejectedCount { get { return Interlocked.Read(ref _srvRejected); } }

        /// <summary>Серверийн `dropped.*`-ийн нийт (ОЛОЛТ D).</summary>
        public static long ServerDroppedCount { get { return Interlocked.Read(ref _srvDropped); } }

        /// <summary>Сервер ТАЙЛБАРЛААГҮЙ зөрүү — гэрээ зөрчигдсөний дохио.</summary>
        public static long ServerUnaccountedCount { get { return Interlocked.Read(ref _srvUnaccounted); } }

        /// <summary>
        /// ХЭЗЭЭ Ч БЛОКЛОХГҮЙ.  Дараалал дүүрвэл мөрийг ХАЯЖ `_dropped++`.
        ///
        /// ⚠️ ЧИМЭЭГҮЙ АЛДАГДАЛ БАЙХГҮЙ: тоолуур нь сессийн толгойн
        /// `dropped_count`-д хүрч, «юу ч болоогүй» ба «алдсан» хоёр
        /// ЯЛГАГДАНА (0202-ийн зорилго).
        /// </summary>
        public static void Enqueue(string envelopeJson)
        {
            if (string.IsNullOrEmpty(envelopeJson)) return;
            try
            {
                if (Pending.IsAddingCompleted || !Pending.TryAdd(envelopeJson))
                    Interlocked.Increment(ref _dropped);
            }
            catch
            {
                Interlocked.Increment(ref _dropped);
            }
        }

        /// <summary>
        /// УНТРААЛТЫН АЛХАМ 0.  ⚠️ ХҮЛЭЭЛТ БАЙХГҮЙ.
        ///
        /// Нээлттэй сесс БҮРД `SESSION_END`-ийг дараалалд хийгээд ДАРАА НЬ
        /// дохио өгнө.  Илгээх эсэхийг `Join(400)` шийднэ; амжаагүй мөр нь
        /// JSONL-д үлдэж ДАРААГИЙН асаалтад илгээгдэнэ (курсорын гэрээ).
        ///
        /// ⚠️ ХЭЗЭЭ Ч алдаа шидэхгүй — унтраалт дээр шидэгдсэн алдаа нь
        /// Revit-ийн хаагдалтыг гацаана.
        /// </summary>
        public static void Cancel()
        {
            try
            {
                // ⚠️ `_sessions` -ыг ЗӨВХӨН `_pump` бичдэг; энд УНШИНА.
                //    `_pump` нь энэ мөчид `TryDrain`-д байж болох ч тэр нь
                //    шинэ түлхүүр НЭМЭХ л боломжтой — тоологч завсарлахаас
                //    хамгаалж хуулбар авна.
                Session[] open;
                lock (_sessions)
                {
                    var list = new List<Session>(_sessions.Count);
                    foreach (KeyValuePair<string, Session> kv in _sessions)
                        if (!kv.Value.Ended) list.Add(kv.Value);
                    open = list.ToArray();
                }

                string nowIso = Iso(DateTime.UtcNow);
                for (int i = 0; i < open.Length; i++)
                {
                    Session s = open[i];
                    s.Ended = true;
                    SessionHeader h;
                    if (_headers.TryGetValue(s.Uid, out h)) h.EndedAt = nowIso;
                    // ⚠️ ДУУДАХ ЦЭГ 3 — нээлттэй сесс бүрд НЭГ `SESSION_END`.
                    BimEmitter.Enqueue(EventEnvelope(s, "SESSION_END", nowIso, "s1"));
                }
                try { SaveSessions(); } catch { }
            }
            catch { }

            try { if (_cts != null) _cts.Cancel(); } catch { }
            try { ChangeTracker.Wake.Set(); } catch { }
        }

        /// <summary>
        /// ХЯЗГААРТАЙ ХҮЛЭЭЛТ — хоёр thread-ийг НИЙТ `ms` миллисекундэд
        /// хуваана (тус бүрд `ms` БИШ).  Хоёулаа арын (background) thread тул
        /// гацсан ч процессыг барихгүй.
        /// </summary>
        public static void Join(int ms)
        {
            try
            {
                int budget = Math.Max(0, ms);
                var sw = System.Diagnostics.Stopwatch.StartNew();
                Thread p = _pump;
                if (p != null) { try { p.Join(budget); } catch { } }
                int left = budget - (int)sw.ElapsedMilliseconds;
                Thread q = _post;
                if (q != null) { try { q.Join(Math.Max(0, left)); } catch { } }
            }
            catch { }
        }

        /// <summary>
        /// ЗӨВХӨН `BatchQto`-д, `Process.Kill()`-ийн ӨМНӨ.
        ///
        /// ⚠️ Өнөөдөр `BatchQto.IsBatch` нь илгээгчийг БҮРЭН унтраасан тул
        /// шавхах юм БАЙХГҮЙ.  Дуудлага нь ХЭВЭЭР байх ёстой: ирээдүйд хэн
        /// нэгэн `IsBatch`-ийг арилгавал энэ мөр өгөгдлийг аварна.
        /// </summary>
        public static int DrainBlocking(int ms)
        {
            try
            {
                int budget = Math.Max(0, ms);
                var sw = System.Diagnostics.Stopwatch.StartNew();
                int wrote = 0;
                var buf = new List<string>();
                while (sw.ElapsedMilliseconds < budget && Pending.Count > 0)
                {
                    string line;
                    if (!Pending.TryTake(out line)) break;
                    buf.Add(line);
                }
                if (buf.Count > 0) { AppendLines(buf); wrote = buf.Count; }
                return wrote;
            }
            catch { return 0; }
        }

        /* ============================================================== */
        /*  THREAD 1 — ШАВХАХ + ENVELOPE                                   */
        /* ============================================================== */

        /// <summary>
        /// ⚠️ `ChangeTracker.RawRing`-ийг ШАВХАХ ЦОРЫН ГАНЦ КОД.  Хоёр дахь
        /// дуудагч гарвал `_ringDrainedSeq`-ийг хоёул урагшлуулж, гүйлгээний
        /// тал нь сургалтын дэвтэрт, нөгөө тал нь дүрмийн үнэлгээнд
        /// ЧИМЭЭГҮЙ алга болно.
        ///
        /// ⚠️ JSON НЬ ЗӨВХӨН ЭНД ҮҮСНЭ.  Халуун зам дээр `JsonSerializer`,
        /// `string.Format`, `+` ХЭЗЭЭ Ч байхгүй — `RawEntry` нь тоо ба хоёр
        /// ишийн хуулбар.
        ///
        /// ⚠️ `ChangeTracker.Gate`-ЫГ ЗӨВХӨН `TryDrain`-ИЙН ДОТОР,
        /// `TryEnter`-ЭЭР ХӨНДӨНӨ (Хориглолт №7).  Envelope үүсгэх,
        /// дараалалд хийх, коалесцер тэжээх — БҮГД түгжээнээс ГАДНА.
        /// </summary>
        private static void PumpLoop()
        {
            CancellationToken ct = _cts.Token;
            var buf = new ChangeTracker.RawEntry[256];
            var ids = new long[256 * ChangeTracker.SamplePerTxn];
            var scratch = new long[ChangeTracker.SamplePerTxn];

            try { _ready.Wait(60000, ct); }
            catch (OperationCanceledException) { return; }
            catch { }

            while (!ct.IsCancellationRequested)
            {
                try
                {
                    // §3.13 — шөнийн багцын хостод ТЭГ ажил.  Тэнд detached,
                    // олон төслийн файл нэг ажилтны токеноор нээгддэг тул
                    // бүртгэл нь ХАРЬЯАЛЛЫН хувьд буруу мөр үүсгэнэ.
                    if (BatchQto.IsBatch) return;
                    if (_ingestOff) return;

                    // ⚠️ ХЯЗГААРТАЙ УНТРАЛТ, ТАЙМЕР БИШ.  `_flushTimer` дээр
                    //    суух нь тэр таймерын давхцлын алдааг ЖИГД болгоно.
                    try { ChangeTracker.Wake.Wait(250, ct); }
                    catch (OperationCanceledException) { break; }

                    long from, dropped;
                    int n = ChangeTracker.TryDrain(buf, ids, out from, out dropped);
                    if (dropped > 0) Interlocked.Add(ref _droppedRing, dropped);

                    long nowMs = NowMs();
                    var csw = System.Diagnostics.Stopwatch.StartNew();

                    for (int i = 0; i < n; i++)
                    {
                        ChangeTracker.RawEntry r = buf[i];
                        if (string.IsNullOrEmpty(r.DocKey)) continue;

                        Session ses = SessionOf(r.DocKey, r.Sec);
                        if (ses == null) continue;

                        // ⚠️ ДУУДАХ ЦЭГ 1 — гүйлгээ тутам НЭГ envelope,
                        //    түүний `touches` ЭНЭ МӨРНИЙ ДОТОР.  Салгавал
                        //    эцэггүй `touches` СЕРВЕР ДЭЭР ЧИМЭЭГҮЙ хаягдана
                        //    (`learning.ts:612-616`).
                        BimEmitter.Enqueue(TxnEnvelope(ses, r, ids));

                        // ⚠️ ЗҮСМЭЛИЙГ ХУУЛНА.  `ids` нь БҮХ бичлэгийн
                        //    хуваалцсан буфер бөгөөд энэ бичлэгийнх нь
                        //    `r.SampleOff`-оос эхэлдэг; `Feed` нь ТЭГЭЭС
                        //    уншдаг тул шууд дамжуулбал ӨӨР гүйлгээний id-г
                        //    энэ олонлогт нэмнэ (чимээгүй өгөгдөл эвдрэл).
                        //    `scratch` нь мөчлөгөөс ГАДНА нэг удаа
                        //    хуваарилагдсан — арын thread дээр ч дэмий GC
                        //    ачаалал үүсгэхгүй.
                        int sl = r.SampleLen;
                        if (sl > 0 && r.SampleOff >= 0 &&
                            r.SampleOff + sl <= ids.Length)
                            Array.Copy(ids, r.SampleOff, scratch, 0, sl);
                        else sl = 0;
                        _coalescer.Feed(r.Seq, nowMs, r.DocKey, scratch, sl, r.Undo);
                    }

                    LogicalChangeSet set = _coalescer.TryClose(nowMs, n == 0);
                    csw.Stop();
                    if (n > 0 || set != null)
                    {
                        try { Metrics.Coalesce.Add(csw.Elapsed.TotalMilliseconds); } catch { }
                    }

                    if (set != null && set.MayCollect)
                    {
                        // ⚠️ НЭГ УНШИЛТ — `ComplianceHook` нь дурын мөчид
                        //    солигдож болно (2-3 бүртгэнэ / салгана).
                        Action<LogicalChangeSet> hook = ComplianceHook;
                        if (hook != null) { try { hook(set); } catch { } }
                    }
                }
                catch (OperationCanceledException) { break; }
                catch
                {
                    // Мөчлөг ХЭЗЭЭ Ч унах ёсгүй — дараагийн эргэлтэд үргэлжилнэ.
                    try { Thread.Sleep(250); } catch { }
                }
            }
        }

        /// <summary>
        /// ⚠️ ДУУДАХ ЦЭГ 2 — тухайн баримтын ЭХНИЙ бичлэг дээр л
        /// `SESSION_START` гарна.
        ///
        /// ⚠️ МӨР НЬ ЗАРЛАГДАХАД БИШ, АЖИЛ ГАРАХАД ҮҮСНЭ.  Нээгээд хаагдсан
        /// баримт нь `bim_sessions`-д мөр ҮҮСГЭХГҮЙ — «хэрэглэгч ажиллаагүй»
        /// ба «бид алдсан» хоёрын ялгаа хадгалагдана.  `App.OnStartup`-д
        /// гаргах нь БОЛОМЖГҮЙ: тэр агшинд НЭГ Ч баримт нээгдээгүй тул
        /// `doc_uid` / `doc_title` / `is_link` БАЙХГҮЙ.
        /// </summary>
        private static Session SessionOf(string docKey, long sec)
        {
            Session s;
            lock (_sessions)
            {
                if (_sessions.TryGetValue(docKey, out s)) return s;
            }

            // session_uid = sha256(machine | processStartTicks | docKey)[:32]
            //
            // ⚠️ ДЕТЕРМИНИСТ.  Нэг процессын ажиллагаа дотор ижил баримт ижил
            //    uid авна — сүлжээ тасраад дахин илгээхэд `upsertBimSession`
            //    нь ШИНЭ мөр биш, ИЖИЛ мөрийг олно.
            // ⚠️ ПРОЦЕСС ДАХИН АСАХАД ШИНЭ: Revit унасны дараах ажил нь өөр
            //    сесс, өөр `started_at`.
            string full = ChangeTracker.Sha256Hex(
                (_machineHash ?? "") + "|" +
                _procStartTicks.ToString(CultureInfo.InvariantCulture) + "|" + docKey);
            if (full == null) return null;
            string uid = full.Substring(0, 32);

            string startedAt = Iso(FromUnix(sec));
            s = new Session { Uid = uid, DocKey = docKey, StartedAtIso = startedAt, EventSeq = 0 };

            ChangeTracker.DocFacts f = ChangeTracker.FactsOf(docKey);
            var h = new SessionHeader
            {
                SessionUid = uid,
                StartedAt = startedAt,
                DocUid = Trunc(docKey, 128),
                DocTitle = f == null ? "" : (Trunc(f.Title, 200) ?? ""),
                IsLink = f != null && f.IsLink,
                CentralPathHash = f == null ? null : f.CentralPathHash,
                MachineHash = _machineHash,
                Worksharing = f == null ? "none" : (f.Worksharing ?? "none"),
                RevitVersion = _revitVersion,
                RevitBuild = _revitBuild,
                AddinVersion = _addinVersion,
                AddinChannel = _addinChannel,
                TzOffsetMin = _tzOffsetMin,
                EndedAt = null,
            };
            _headers[uid] = h;

            lock (_sessions) { _sessions[docKey] = s; }
            try { SaveSessions(); } catch { }

            // ⚠️ ДУУДАХ ЦЭГ 2.
            BimEmitter.Enqueue(EventEnvelope(s, "SESSION_START", startedAt, "s0"));
            return s;
        }

        /* ============================================================== */
        /*  ENVELOPE                                                       */
        /* ============================================================== */

        /// <summary>
        /// `RawEntry` → `t:"txn"` мөр.
        ///
        /// ⚠️ `categories`, `view_uid`, `sheet_uid`, `cause_event_uid`,
        /// `parent_txn_uid`, `element_artifact_sha256` -ыг ИЛГЭЭХГҮЙ: халуун
        /// зам тэднийг МЭДЭХГҮЙ (шинэ Revit API дуудлагагүй).  Байхгүй нь
        /// `null`, ХУДАЛ УТГА БИШ.
        ///
        /// ⚠️ `touches[].category` НЬ ХООСОН ҮЛДЭНЭ — МЭДЭГДСЭН ХЯЗГААР,
        /// АЛДАА БИШ.  Категори унших нь `doc.GetElement(id).Category` гэсэн
        /// ШИНЭ Revit дуудлага бөгөөд `ChangeTracker.cs:792-795`-ийн ⛔
        /// гэрээг зөрчинө.  Үр дагавар нь ХЭМЖИГДСЭН: `parts_missing > 0`
        /// болж мөр `DATASET_ELIGIBLE_SQL`-ийг ДАВАХГҮЙ — өөрөөр хэлбэл
        /// БҮРТГЭЛД бүрэн, СУРГАЛТАД хараахан биш.  ЭНЭ НЬ ЗӨВ АНХДАГЧ:
        /// `category`-г ХУДЛААР бөглөх нь дутуу мөрийг сургалтад ЭРХГҮЙГЭЭР
        /// оруулна.
        /// </summary>
        private static string TxnEnvelope(Session ses, ChangeTracker.RawEntry r, long[] ids)
        {
            string txnUid = ses.Uid + ":" + r.Seq.ToString(CultureInfo.InvariantCulture);
            string opName = r.OpName ?? "?";
            string opClass = OpClassOf(opName);

            var sb = new StringBuilder(256 + r.SampleLen * 48);
            sb.Append("{\"n\":").Append(NextLineNo().ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"s\":").Append(Q(ses.Uid));
            sb.Append(",\"t\":\"txn\",\"b\":{");
            sb.Append("\"txn_uid\":").Append(Q(txnUid));
            sb.Append(",\"seq\":").Append(r.Seq.ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"occurred_at\":").Append(Q(Iso(FromUnix(r.Sec))));
            sb.Append(",\"op_name\":").Append(Q(Trunc(opName, 128)));
            sb.Append(",\"op_class\":").Append(Q(opClass));
            sb.Append(",\"added_count\":").Append(r.Added.ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"deleted_count\":").Append(r.Deleted.ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"modified_count\":").Append(r.Modified.ToString(CultureInfo.InvariantCulture));
            // ⚠️ Релиз N-д ҮРГЭЛЖ `human`: sync/reload-ийн гүйлгээ цагирагт
            //    ОГТ ОРДОГГҮЙ (`Suppressed` эрт буцалт) тул `sync` үүсэхгүй,
            //    багцын хост дээр илгээгч бүхэлдээ унтарсан тул `script` ч
            //    үүсэхгүй.  AI-аас үүдсэн гүйлгээ (`ai`) нь `cause_event_uid`
            //    -тэй хамт ХОЖМЫН релизийн ажил.
            sb.Append(",\"origin\":\"human\"");

            sb.Append(",\"touches\":[");
            int len = r.SampleLen;
            for (int i = 0; i < len; i++)
            {
                int idx = r.SampleOff + i;
                if (idx < 0 || idx >= ids.Length) break;
                if (i > 0) sb.Append(',');
                sb.Append("{\"txn_uid\":").Append(Q(txnUid));
                sb.Append(",\"element_id\":")
                  .Append(ids[idx].ToString(CultureInfo.InvariantCulture));
                sb.Append(",\"change\":").Append(Q(ChangeOf(i, r)));
                sb.Append('}');
            }
            sb.Append("]}}");
            return sb.ToString();
        }

        /// <summary>
        /// ТҮҮВРИЙН `i` дэх элементийн ангилал.
        ///
        /// ⚠️ ЭНЭ ДАРААЛАЛ НЬ ГЭРЭЭ.  Түүврийн буфер нь `add → delete →
        /// modify` гэсэн ЯГ ТЭР дарааллаар дүүрдэг (`ChangeTracker`-ийн
        /// гурван давталт) ба гурван тоолуур нь ҮНЭН ЗӨВ.  Дарааллыг сольвол
        /// `change` нь ЧИМЭЭГҮЙ буруу болно — сургалтын мөр «устгасан»-ыг
        /// «нэмсэн» гэж хэлнэ.
        /// </summary>
        private static string ChangeOf(int i, ChangeTracker.RawEntry r)
        {
            if (i < r.Added) return "add";
            if (i < r.Added + r.Deleted) return "delete";
            return "modify";
        }

        private static string OpClassOf(string opName)
        {
            if (opName == null) return "edit";
            if (opName.StartsWith("undo:", StringComparison.Ordinal)) return "undo";
            if (opName.StartsWith("redo:", StringComparison.Ordinal)) return "redo";
            return "edit";
        }

        /// <summary>
        /// `SESSION_START` / `SESSION_END` — `learning_events`-ийн ЖИНХЭНЭ мөр.
        /// `REQUIRED_PARTS_OF` нь хоёуланд нь ХООСОН тул `parts_missing = 0`.
        ///
        /// ⚠️ `provenance` нь `MACHINE_GENERATED` — клиентэд зөвшөөрөгдсөн
        /// ДЭЭД нь (`ingestProvenance`).  Add-in өөрийгөө «баталгаажсан» гэж
        /// зарлаж чадах ЁСГҮЙ.
        /// ⚠️ `user_id`, `notice_version`, `capture_policy` -ыг ХЭЗЭЭ Ч
        /// илгээхгүй: эхнийх нь токеноос, сүүлийн хоёр нь серверийн шийдвэр.
        /// </summary>
        private static string EventEnvelope(Session ses, string kind, string occurredAt, string suffix)
        {
            long seq = ses.EventSeq++;
            var sb = new StringBuilder(320);
            sb.Append("{\"n\":").Append(NextLineNo().ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"s\":").Append(Q(ses.Uid));
            sb.Append(",\"t\":\"event\",\"b\":{");
            sb.Append("\"event_uid\":").Append(Q(ses.Uid + ":" + suffix));
            // 0205: add-in талд `stream_id` === `session_uid`.
            sb.Append(",\"stream_id\":").Append(Q(ses.Uid));
            sb.Append(",\"seq\":").Append(seq.ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"kind\":").Append(Q(kind));
            sb.Append(",\"actor_kind\":\"system\"");
            sb.Append(",\"occurred_at\":").Append(Q(occurredAt));
            sb.Append(",\"doc_uid\":").Append(Q(Trunc(ses.DocKey, 128)));
            sb.Append(",\"provenance\":\"MACHINE_GENERATED\"");

            SessionHeader h;
            _headers.TryGetValue(ses.Uid, out h);
            sb.Append(",\"payload\":{\"revit_version\":").Append(Q(_revitVersion));
            sb.Append(",\"addin_version\":").Append(Q(_addinVersion));
            sb.Append(",\"is_link\":").Append(h != null && h.IsLink ? "true" : "false");
            sb.Append('}');
            sb.Append("}}");
            return sb.ToString();
        }

        private static long NextLineNo()
        {
            return Interlocked.Increment(ref _lineNo);
        }

        /* ============================================================== */
        /*  THREAD 2 — JSONL + HTTP                                        */
        /* ============================================================== */

        private static void PostLoop()
        {
            CancellationToken ct = _cts.Token;
            var unsent = new List<Line>();

            try { LoadState(unsent); }
            catch { }
            finally { try { _ready.Set(); } catch { } }

            int failures = 0;
            int backoffIdx = 0;
            int nextAttemptTick = 0;
            bool waiting = false;

            try
            {
                while (!ct.IsCancellationRequested)
                {
                    if (BatchQto.IsBatch) return;

                    // ── 1) Дараалал → диск.  ЭХЛЭЭД ЛОКАЛ. ──────────────
                    var fresh = new List<string>();
                    try
                    {
                        string first;
                        if (Pending.TryTake(out first, 500, ct)) fresh.Add(first);
                        while (fresh.Count < _batchMax * 2)
                        {
                            string more;
                            if (!Pending.TryTake(out more)) break;
                            fresh.Add(more);
                        }
                    }
                    catch (OperationCanceledException) { break; }
                    catch { }

                    if (fresh.Count > 0)
                    {
                        AppendLines(fresh);
                        long now = System.Diagnostics.Stopwatch.GetTimestamp();
                        for (int i = 0; i < fresh.Count; i++)
                        {
                            long fn = LineNoOf(fresh[i]);
                            if (fn > _maxAppended) _maxAppended = fn;
                            if (unsent.Count >= MaxUnsent)
                            {
                                // ⚠️ ХАЯГДААГҮЙ — ДИСКЭН ДЭЭР БАЙНА.  Зөвхөн
                                //    санах ойд багтсангүй.  `_minUnloadedN` нь
                                //    нягтралт ба курсорыг хоёуланг нь барина;
                                //    `unsent` хоосрох үед `ReloadFromDisk`
                                //    түүнийг эргүүлж авчирна.
                                if (fn > 0 && fn < _minUnloadedN) _minUnloadedN = fn;
                                continue;
                            }
                            unsent.Add(new Line { N = fn, Json = fresh[i], QueuedTicks = now });
                        }
                    }

                    if (_ingestOff) { unsent.Clear(); continue; }
                    if (unsent.Count == 0) continue;

                    // ── 2) Таслуур / backoff ────────────────────────────
                    // ⚠️ `Environment.TickCount` нь ~49 хоногт эргэдэг;
                    //    ялгаварыг int-ээр тооцвол эргэлт дээр ч зөв ажиллана
                    //    (`RevitToolBus.CallCore`-ийн ижил хэв маяг).
                    if (waiting && unchecked(Environment.TickCount - nextAttemptTick) < 0)
                        continue;
                    waiting = false;

                    // ── 3) Илгээх ───────────────────────────────────────
                    AddinSettings cfg = null;
                    try { cfg = SettingsStore.Load(); } catch { }
                    if (cfg == null || string.IsNullOrEmpty(cfg.Token) ||
                        string.IsNullOrEmpty(cfg.ApiHost))
                    {
                        // Нэвтрээгүй — мөрүүд ЛОКАЛД үлдэнэ, дараа илгээгдэнэ.
                        nextAttemptTick = unchecked(Environment.TickCount + 30000);
                        waiting = true;
                        continue;
                    }

                    int sentCount = 0;
                    bool ok = SendOneBatch(cfg, unsent, ct, out sentCount);

                    if (ok)
                    {
                        failures = 0;
                        backoffIdx = 0;
                        waiting = false;
                        if (sentCount > 0) AdvanceCursor(unsent);

                        // ⚠️ `unsent` хоосров — дискэн дээр `MaxUnsent`-ээс
                        //    хэтэрсэн мөр үлдсэн бол ЭНД эргүүлж авчирна.
                        //    Үүнгүйгээр тэдгээр нь мөнхөд дискэн дээр хэвтэж,
                        //    нягтралт ч хийгдэхгүй (лог хязгааргүй өснө).
                        if (_minUnloadedN != long.MaxValue && unsent.Count == 0)
                            ReloadFromDisk(unsent);
                    }
                    else
                    {
                        failures++;
                        int wait = BackoffMs[Math.Min(backoffIdx, BackoffMs.Length - 1)];
                        if (backoffIdx < BackoffMs.Length - 1) backoffIdx++;
                        // ⚠️ ТАСЛУУР — 5 дараалсан алдааны дараа 5 минут
                        //    тутам НЭГ шалгах хүсэлт (§32 «bounded retry»).
                        if (failures >= BreakerFailures) wait = BreakerProbeMs;
                        nextAttemptTick = unchecked(Environment.TickCount + wait);
                        waiting = true;
                    }

                    TryCompact(unsent);
                }
            }
            catch { }
            finally
            {
                // ⚠️ ЭЦСИЙН ШАВХАЛТ — ЗӨВХӨН ДИСК, СҮЛЖЭЭ БИШ.  `Cancel()`
                //    нь `SESSION_END`-ийг дараалалд хийсэн байж болно; тэр
                //    мөр JSONL-д ороогүй бол БҮРМӨСӨН алдагдана.
                try
                {
                    // ⚠️ ХЯЗГААРГҮЙ ШАВХАЛТ (өмнө нь 512-оор таслагдаж, үлдсэн
                    //    нь ЧИМЭЭГҮЙ алдагддаг байв — `Pending` нь 4096 хүртэл
                    //    багтдаг тул зөрүү нь бодит).  `MaxPending` нь дээд
                    //    хязгаар тул энэ мөчлөг ЗААВАЛ дуусна.
                    var tail = new List<string>();
                    string line;
                    while (Pending.TryTake(out line))
                    {
                        tail.Add(line);
                        if (tail.Count >= 1024) { FlushTail(tail); tail.Clear(); }
                    }
                    if (tail.Count > 0) FlushTail(tail);
                }
                catch { }
                try { if (_ownLock != null) _ownLock.Dispose(); } catch { }
            }
        }

        /// <summary>
        /// НЭГ СЕССИЙН мөрүүдээс биеийг угсарч илгээнэ.
        ///
        /// ⚠️ `session` НЬ POST БҮРД ЗААВАЛ.  `session_uid` байхгүй бол
        /// `sessionId === null` болж ГҮЙЛГЭЭ БҮР `rejected.txns`-д унана —
        /// багц 200 буцаах ч НЭГ Ч мөр бичигдэхгүй.
        ///
        /// Буцах утга: `true` = сүлжээ ажиллав (хүлээн авсан ЭСВЭЛ 4xx).
        /// `sent` = баталгаажсан мөрийн тоо.
        /// </summary>
        private static bool SendOneBatch(AddinSettings cfg, List<Line> unsent,
                                         CancellationToken ct, out int sent)
        {
            sent = 0;
            var docs = new List<JsonDocument>();
            var take = new List<int>();          // `unsent` дэх индексүүд
            string sessionUid = null;
            int txnN = 0, touchN = 0, eventN = 0;

            try
            {
                for (int i = 0; i < unsent.Count; i++)
                {
                    JsonDocument d;
                    try { d = JsonDocument.Parse(unsent[i].Json); }
                    catch { take.Add(i); continue; }   // эвдэрсэн мөр — хаяна

                    JsonElement root = d.RootElement;
                    JsonElement se, te, be;
                    if (!root.TryGetProperty("s", out se) ||
                        !root.TryGetProperty("t", out te) ||
                        !root.TryGetProperty("b", out be))
                    { d.Dispose(); take.Add(i); continue; }

                    string s = se.GetString();
                    if (sessionUid == null) sessionUid = s;
                    else if (!string.Equals(sessionUid, s, StringComparison.Ordinal))
                    { d.Dispose(); break; }   // өөр сесс — дараагийн багцад

                    bool isTxn = string.Equals(te.GetString(), "txn", StringComparison.Ordinal);
                    if (isTxn)
                    {
                        int tc = 0;
                        JsonElement touches;
                        if (be.TryGetProperty("touches", out touches) &&
                            touches.ValueKind == JsonValueKind.Array)
                            tc = touches.GetArrayLength();

                        if (txnN + 1 > Math.Min(_batchMax, HardTxnBatch) ||
                            touchN + tc > MaxTouchBatch)
                        { d.Dispose(); break; }

                        txnN++;
                        touchN += tc;
                    }
                    else
                    {
                        if (eventN + 1 > HardTxnBatch) { d.Dispose(); break; }
                        eventN++;
                    }

                    docs.Add(d);
                    take.Add(i);
                }

                if (docs.Count == 0)
                {
                    // Зөвхөн эвдэрсэн мөр байсан — тэднийг хасаад амжилт гэж үзнэ.
                    if (take.Count > 0) { RemoveIndexes(unsent, take); return true; }
                    return true;
                }

                SessionHeader header;
                if (sessionUid == null || !_headers.TryGetValue(sessionUid, out header))
                {
                    // Толгойгүй сесс — илгээх нь БҮХ мөрийг татгалзуулна.
                    // Сайдкар алдагдсан (гараар устгасан) тохиолдол; мөрүүдийг
                    // хаяна, эс бөгөөс дараалал МӨНХӨД тээглэнэ.
                    RemoveIndexes(unsent, take);
                    Interlocked.Add(ref _dropped, take.Count);
                    return true;
                }

                string body = BuildBody(header, docs);
                string url = ApiClient.Url(cfg.ApiHost, "/api/learning/events");
                string token = cfg.Token;

                long qStart = unsent.Count > 0 ? unsent[0].QueuedTicks : 0;

                var task = AiHttp.SendAsync(() =>
                {
                    var req = new HttpRequestMessage(HttpMethod.Post, url);
                    req.Content = new StringContent(body, Encoding.UTF8, "application/json");
                    req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                    return req;
                }, ct);

                HttpResponseMessage res = null;
                try { res = task.GetAwaiter().GetResult(); }
                catch { res = null; }

                if (res == null) return false;

                try
                {
                    int code = (int)res.StatusCode;
                    if (code == 413)
                    {
                        // ⚠️ Багцыг ХАГАСЛААД дахин оролдоно, шинэ хэмжээг
                        //    МӨЧЛӨГТ хадгална.  413-ыг ЗӨВХӨН серверийн
                        //    тохиргоо гэнэт БУУРСАН үед харах ёстой —
                        //    хэвийн үед гурван хязгаар нь урьдчилан барина.
                        _batchMax = Math.Max(1, _batchMax / 2);
                        return true;
                    }
                    if (code == 401)
                    {
                        // ⚠️ ЧИМЭЭГҮЙ.  Токен хугацаа дуусах нь ажилтны буруу
                        //    биш; мөрүүд локалд үлдэж дахин нэвтрэхэд илгээгдэнэ.
                        AiHttp.SetState(DegradeState.DegradedServer);
                        return false;
                    }
                    // ⚠️ БИЕИЙГ 4xx ДЭЭР Ч УНШИНА (ОЛОЛТ D).  0243-ийн
                    //    гэрээгээр 409 ба 422 нь ХОЁУЛАА БҮТЭЦТЭЙ хариу
                    //    бөгөөд `accounted` талбар нь «мөрүүдээ устгаж
                    //    болно» гэсэн ЭРХ олгодог.  Статусаар шийдэх нь
                    //    `routes/learning.ts:1078` -д ШУУД хориглогдсон:
                    //    «⚠️ HTTP статусаар БҮҮ шийд».
                    string txt = null;
                    try { txt = res.Content.ReadAsStringAsync().GetAwaiter().GetResult(); }
                    catch { txt = null; }

                    if (code < 200 || code >= 300)
                    {
                        // ⚠️ 422 `batch_rejected`: `accounted:true`,
                        //    `retryable:false` — сервер алдагдлыг
                        //    `server_dropped_count`-д БҮРТГЭСЭН, ижил багцыг
                        //    дахин илгээх нь ЯГ ИЖИЛ хариу өгнө.  Мөрийг
                        //    ХАДГАЛВАЛ дараалал МӨНХӨД тээглэж, түүний ард
                        //    байгаа БҮХ шинэ ажил бас илгээгдэхгүй болно.
                        if (IsAccountedFinal(txt))
                        {
                            ReconcileResponse(txt, txnN, touchN, eventN);
                            sent = take.Count;
                            RemoveIndexes(unsent, take);
                            return true;
                        }
                        // ⚠️ 409 `loss_unaccounted` (`accounted:false`) ба
                        //    бусад БҮХ алдаа: мөрүүд ЛОКАЛД ҮЛДЭНЭ.
                        return false;
                    }

                    if (txt != null && txt.IndexOf("\"ingest\":\"off\"",
                                                   StringComparison.Ordinal) >= 0)
                    {
                        // ⚠️ ЭЗНИЙ УНТРААЛГА.  Энэ сессид ДАХИН ОРОЛДОХГҮЙ.
                        _ingestOff = true;
                        AiHttp.SetState(DegradeState.Off);
                        return true;
                    }

                    if (qStart != 0)
                    {
                        try
                        {
                            Metrics.EmitQueue.Add(
                                (System.Diagnostics.Stopwatch.GetTimestamp() - qStart)
                                * 1000.0 / System.Diagnostics.Stopwatch.Frequency);
                        }
                        catch { }
                    }

                    // ⚠️ ОЛОЛТ D — БИЕИЙГ УНШИНА.  Өмнө нь энэ мөр 2xx-ыг
                    //    БҮРЭН ХҮЛЭЭН АВСАН гэж таамаглаж курсорыг
                    //    урагшлуулдаг байв; сервер нь 200 буцаагаад БҮХ
                    //    гүйлгээг татгалзаж чадна.  `txnN`/`touchN`/`eventN`
                    //    нь ЯГ `BuildBody`-ийн бичсэн тоо.
                    ReconcileResponse(txt, txnN, touchN, eventN);

                    sent = take.Count;
                    RemoveIndexes(unsent, take);
                    return true;
                }
                finally { try { res.Dispose(); } catch { } }
            }
            catch { return false; }
            finally
            {
                for (int i = 0; i < docs.Count; i++)
                { try { docs[i].Dispose(); } catch { } }
            }
        }

        /// <summary>
        /// ⚠️ ГҮЙЛГЭЭ ба ТҮҮНИЙ `touches` НЬ ДАРААЛАЛД НЭГ МӨРӨНД байсан;
        /// энд л ХОЁР массив болж сална.  Салгалт нь ЗӨВХӨН нэг POST-ийн
        /// дотор болно — өөр өөр POST-д унавал эцэггүй `touches` нь СЕРВЕР
        /// ДЭЭР ЧИМЭЭГҮЙ ХАЯГДАНА (0204-ийн ЧАНГА БҮТЭЛГҮЙТЭЛ).
        /// </summary>
        private static string BuildBody(SessionHeader h, List<JsonDocument> docs)
        {
            using (var ms = new MemoryStream(8192))
            {
                using (var w = new Utf8JsonWriter(ms))
                {
                    w.WriteStartObject();

                    w.WritePropertyName("session");
                    w.WriteStartObject();
                    w.WriteString("session_uid", h.SessionUid);
                    w.WriteString("started_at", h.StartedAt);
                    w.WriteString("client_now", Iso(DateTime.UtcNow));
                    if (h.DocUid != null) w.WriteString("doc_uid", h.DocUid);
                    w.WriteString("doc_title", h.DocTitle ?? "");
                    w.WriteBoolean("is_link", h.IsLink);
                    if (h.CentralPathHash != null)
                        w.WriteString("central_path_hash", h.CentralPathHash);
                    if (h.MachineHash != null) w.WriteString("machine_hash", h.MachineHash);
                    w.WriteString("worksharing", h.Worksharing ?? "none");
                    w.WriteString("revit_version", h.RevitVersion ?? "");
                    if (h.RevitBuild != null) w.WriteString("revit_build", h.RevitBuild);
                    w.WriteString("addin_version", h.AddinVersion ?? "");
                    w.WriteString("addin_channel", h.AddinChannel ?? "prod");
                    w.WriteNumber("capture_schema", 1);
                    w.WriteNumber("client_tz_offset_min", h.TzOffsetMin);
                    w.WriteNumber("dropped_count", DroppedCount);
                    if (h.EndedAt != null) w.WriteString("ended_at", h.EndedAt);

                    // ⚠️ ГҮЙЦЭТГЭЛИЙН БЛОБ (0226-ийн `perf_json`).  Бүх талбар
                    //    хэмжигдээгүй бол `Snapshot()` нь `null` буцаана —
                    //    `{}` БИШ.  Тэр ялгаа нь «ХЭМЖЭЭГҮЙ» ба «тэр үе шат
                    //    болоогүй» хоёрыг ялгах цорын ганц зам.
                    WritePerf(w);
                    w.WriteEndObject();

                    w.WritePropertyName("transactions");
                    w.WriteStartArray();
                    for (int i = 0; i < docs.Count; i++)
                    {
                        JsonElement root = docs[i].RootElement;
                        if (!IsTxn(root)) continue;
                        w.WriteStartObject();
                        foreach (JsonProperty p in root.GetProperty("b").EnumerateObject())
                        {
                            if (string.Equals(p.Name, "touches", StringComparison.Ordinal)) continue;
                            p.WriteTo(w);
                        }
                        w.WriteEndObject();
                    }
                    w.WriteEndArray();

                    w.WritePropertyName("touches");
                    w.WriteStartArray();
                    for (int i = 0; i < docs.Count; i++)
                    {
                        JsonElement root = docs[i].RootElement;
                        if (!IsTxn(root)) continue;
                        JsonElement touches;
                        if (!root.GetProperty("b").TryGetProperty("touches", out touches)) continue;
                        if (touches.ValueKind != JsonValueKind.Array) continue;
                        foreach (JsonElement t in touches.EnumerateArray()) t.WriteTo(w);
                    }
                    w.WriteEndArray();

                    w.WritePropertyName("events");
                    w.WriteStartArray();
                    for (int i = 0; i < docs.Count; i++)
                    {
                        JsonElement root = docs[i].RootElement;
                        if (IsTxn(root)) continue;
                        root.GetProperty("b").WriteTo(w);
                    }
                    w.WriteEndArray();

                    w.WriteEndObject();
                }
                return Encoding.UTF8.GetString(ms.ToArray());
            }
        }

        /// <summary>
        /// `session.perf` — 0226-ийн `perf_json` руу ЯГ ЭНЭ ОБЪЕКТ орно.
        ///
        /// ⚠️ ЯАГААД ЭНД ВЭ (ОЛОЛТ B + D).  `lib/bimEvents.ts:403` нь
        /// «⛔ ДАРААГИЙН бодит багана нэмэхгүй: шинэ гүйцэтгэлийн тоо
        /// `perf_json` дотор» гэж ЗААСАН.  `routes/learning.ts:162`
        /// `perfJson()` нь дурын объектыг ШУУД `JSON.stringify` хийдэг тул
        /// дискний бүтэлгүйтэл ба серверийн татгалзал СЕРВЕР ТАЛД НЭГ Ч
        /// МӨР ӨӨРЧЛӨХГҮЙГЭЭР төвд харагдана.
        ///
        /// ⚠️ NULL vs `{}`-ИЙН ИНВАРИАНТ (0226:29-40) ХЭВЭЭР.  Хэмжих зүйл
        /// БАЙХГҮЙ бол `perf` талбарыг ОГТ БИЧИХГҮЙ — сервер `null` бичнэ
        /// («ХЭМЖЭЭГҮЙ»).  Хоосон объект нь «хэмжсэн, тэр үе шат болоогүй»
        /// гэсэн ӨӨР УТГА болно.
        /// </summary>
        private static void WritePerf(Utf8JsonWriter w)
        {
            string perf = null;
            try { perf = Metrics.Snapshot(); } catch { }

            long dFail = Interlocked.Read(ref _diskFailWrites);
            long dLines = Interlocked.Read(ref _diskFailLines);
            long dLost = Interlocked.Read(ref _diskLostLines);
            long dOk = Interlocked.Read(ref _diskOkWrites);

            long sRej = Interlocked.Read(ref _srvRejected);
            long sDrop = Interlocked.Read(ref _srvDropped);
            long sUnacc = Interlocked.Read(ref _srvUnaccounted);
            long sDeg = Interlocked.Read(ref _srvDegraded);

            bool haveDisk = dFail > 0 || dLost > 0;
            bool haveIngest = sRej > 0 || sDrop > 0 || sUnacc > 0 || sDeg > 0;
            if (perf == null && !haveDisk && !haveIngest) return;

            w.WritePropertyName("perf");
            w.WriteStartObject();

            // ⚠️ `Metrics.Snapshot()`-ийн түлхүүрүүдийг ЭХЛЭЭД, гэхдээ манай
            //    хоёр нэрийг ХАСАЖ — эс бөгөөс `Utf8JsonWriter` нь ижил
            //    нэрийг ХОЁР УДАА бичиж JSON-ыг эвдэнэ.
            if (perf != null)
            {
                try
                {
                    using (JsonDocument p = JsonDocument.Parse(perf))
                    {
                        if (p.RootElement.ValueKind == JsonValueKind.Object)
                        {
                            foreach (JsonProperty pr in p.RootElement.EnumerateObject())
                            {
                                if (string.Equals(pr.Name, "disk", StringComparison.Ordinal)) continue;
                                if (string.Equals(pr.Name, "ingest", StringComparison.Ordinal)) continue;
                                pr.WriteTo(w);
                            }
                        }
                    }
                }
                catch { }
            }

            if (haveDisk)
            {
                w.WritePropertyName("disk");
                w.WriteStartObject();
                w.WriteNumber("fail_writes", dFail);
                w.WriteNumber("fail_lines", dLines);
                w.WriteNumber("ok_writes", dOk);
                // ⚠️ `lost_lines` нь `dropped_count`-д БАС тоологдсон; хоёрын
                //    ЗӨРҮҮ нь «эрсдэлд орсон ч сүлжээгээр аврагдсан» мөр.
                w.WriteNumber("lost_lines", dLost);
                string le = _diskLastError;
                if (le != null) w.WriteString("last_error", le);
                w.WriteEndObject();
            }

            if (haveIngest)
            {
                w.WritePropertyName("ingest");
                w.WriteStartObject();
                w.WriteNumber("rejected", sRej);
                w.WriteNumber("dropped", sDrop);
                w.WriteNumber("unaccounted", sUnacc);
                w.WriteNumber("degraded_batches", sDeg);
                w.WriteNumber("batches", Interlocked.Read(ref _srvBatches));
                w.WriteEndObject();
            }

            w.WriteEndObject();
        }

        /// <summary>
        /// «Мөрүүдээ УСТГАЖ БОЛНО» — 0243-ийн `accounted` гэрээ.
        ///
        /// `routes/learning.ts:1076-1082`: `accounted: true` = илгээсэн мөр
        /// БҮР эсвэл бичигдсэн, эсвэл `bim_sessions.server_dropped_count`-д
        /// ТООЛОГДСОН; `retryable: false` = ижил багцыг дахин илгээх нь
        /// утгагүй.  ХОЁУЛАА хангагдсан үед Л мөрийг хаяна.
        ///
        /// ⚠️ БОЛГООМЖТОЙ АНХДАГЧ.  Бие хоосон, JSON биш, эсвэл аль нэг
        /// талбар байхгүй бол `false` — мөрүүд ЛОКАЛД ҮЛДЭНЭ.  Хуучин
        /// сервер (эдгээр талбаргүй) -ийн эсрэг энэ нь ЯГ ӨМНӨХ зан үйл.
        /// </summary>
        private static bool IsAccountedFinal(string txt)
        {
            if (string.IsNullOrEmpty(txt)) return false;
            try
            {
                using (JsonDocument d = JsonDocument.Parse(txt))
                {
                    JsonElement root = d.RootElement;
                    if (root.ValueKind != JsonValueKind.Object) return false;
                    JsonElement acc, retry;
                    if (!root.TryGetProperty("accounted", out acc)) return false;
                    if (acc.ValueKind != JsonValueKind.True) return false;
                    if (!root.TryGetProperty("retryable", out retry)) return false;
                    return retry.ValueKind == JsonValueKind.False;
                }
            }
            catch { return false; }
        }

        /// <summary>`root[group][kind]` бүхэл тоо, эсвэл 0.</summary>
        private static int CountOf(JsonElement root, string group, string kind)
        {
            try
            {
                JsonElement g, v;
                if (!root.TryGetProperty(group, out g)) return 0;
                if (g.ValueKind != JsonValueKind.Object) return 0;
                if (!g.TryGetProperty(kind, out v)) return 0;
                if (v.ValueKind != JsonValueKind.Number) return 0;
                int n;
                if (!v.TryGetInt32(out n)) return 0;
                return n > 0 ? n : 0;
            }
            catch { return 0; }
        }

        /// <summary>
        /// ОЛОЛТ D — 2xx-ЫГ «БҮРЭН ХҮЛЭЭН АВСАН» ГЭЖ ТААМАГЛАХАА БОЛИВ.
        ///
        /// `POST /api/learning/events` нь `{accepted, duplicates, rejected,
        /// dropped, degraded}` буцаадаг ба эхний дөрөв нь `{txns, touches,
        /// events}` бүтэцтэй (`routes/learning.ts:1022-1032`,
        /// `lib/bimEvents.ts:1196-1204`).  200 буцаагаад БҮХ гүйлгээг
        /// `rejected.txns`-д хаях нь ХЭВИЙН ЗАМ (толгойгүй сесс —
        /// `learning.ts:508-509`; төсвийн таслалт; хэлбэрийн алдаа), тиймээс
        /// биеийг УНШИХГҮЙ бол клиент ЧИМЭЭГҮЙ өгөгдөл алдана.
        ///
        /// ⚠️ КУРСОР ХЭВЭЭР УРАГШИЛНА, ДАХИН ОРОЛДОХГҮЙ.  Татгалзлын
        /// шалтгаан нь мөрийн ӨӨРИЙНХ нь хэлбэр тул дахин илгээх нь ЯГ ИЖИЛ
        /// хариу өгч дарааллыг МӨНХӨД тээглүүлнэ.  Зөв хариу нь «ТООЛЖ,
        /// мэдээлэх» — `session.perf.ingest`.
        ///
        /// ⚠️ `_dropped`-Д ОГТ НЭМЭХГҮЙ.  Сервер өөрөө `rejected + dropped`-ыг
        /// `bim_sessions.dropped_count` дээр нэмдэг (`learning.ts:1004-1010`);
        /// клиент дахин нэмбэл ХОЁР ДАХИН тоологдож `declared_dropped`
        /// тулгалт (`learning.ts:1192`) худал болно.
        ///
        /// ⚠️ ХУУЧИН / ТАНИХГҮЙ ХАРИУ = ӨМНӨХ ЗАН ҮЙЛ.  Бие хоосон, JSON биш,
        /// эсвэл `accepted` нь объект БИШ бол ЮУ Ч тоолохгүй — шинэ клиент
        /// хуучин серверийн эсрэг ХУДАЛ дохио өгөх ЁСГҮЙ.
        /// </summary>
        private static void ReconcileResponse(string txt, int txnSent,
                                              int touchSent, int eventSent)
        {
            if (string.IsNullOrEmpty(txt)) return;
            try
            {
                using (JsonDocument d = JsonDocument.Parse(txt))
                {
                    JsonElement root = d.RootElement;
                    if (root.ValueKind != JsonValueKind.Object) return;

                    JsonElement acc;
                    if (!root.TryGetProperty("accepted", out acc)) return;
                    if (acc.ValueKind != JsonValueKind.Object) return;

                    Interlocked.Increment(ref _srvBatches);

                    string[] kinds = { "txns", "touches", "events" };
                    int[] sentOf = { txnSent, touchSent, eventSent };
                    long rej = 0, drop = 0, unacc = 0;
                    for (int i = 0; i < kinds.Length; i++)
                    {
                        int a = CountOf(root, "accepted", kinds[i]);
                        int u = CountOf(root, "duplicates", kinds[i]);
                        int r = CountOf(root, "rejected", kinds[i]);
                        int dr = CountOf(root, "dropped", kinds[i]);
                        rej += r;
                        drop += dr;
                        // ⚠️ `duplicates` нь АЛДАГДАЛ БИШ — тэр мөр серверт
                        //    аль хэдийн БАЙГАА (дахин илгээлт).  Зөвхөн ямар
                        //    ч ангилалд ороогүй зөрүүг тоолно.
                        int miss = sentOf[i] - a - u - r - dr;
                        if (miss > 0) unacc += miss;
                    }

                    JsonElement deg;
                    if (root.TryGetProperty("degraded", out deg) &&
                        deg.ValueKind == JsonValueKind.True)
                        Interlocked.Increment(ref _srvDegraded);

                    if (rej > 0) Interlocked.Add(ref _srvRejected, rej);
                    if (drop > 0) Interlocked.Add(ref _srvDropped, drop);
                    if (unacc > 0) Interlocked.Add(ref _srvUnaccounted, unacc);
                }
            }
            catch { }
        }

        private static bool IsTxn(JsonElement root)
        {
            JsonElement t;
            if (!root.TryGetProperty("t", out t)) return false;
            return string.Equals(t.GetString(), "txn", StringComparison.Ordinal);
        }

        private static void RemoveIndexes(List<Line> unsent, List<int> idx)
        {
            for (int i = idx.Count - 1; i >= 0; i--)
            {
                int k = idx[i];
                if (k >= 0 && k < unsent.Count) unsent.RemoveAt(k);
            }
        }

        /* ============================================================== */
        /*  ДИСК                                                           */
        /* ============================================================== */

        /// <summary>
        /// ⚠️ ЗАЛГАЛТ, БҮТЭН ДАХИН БИЧИЛТ БИШ.  `AssistantLog`-ийн 3000
        /// мөрийн цувралт нь UI thread дээр чатыг удаашруулж байсан алдаа;
        /// JSONL нь залгамал формат тул нэг бичилт хангалттай.
        /// ⚠️ Энэ нь ЗӨВХӨН `_post` thread дээр ажиллана (эсвэл
        /// `DrainBlocking` — унтраалт дээр НЭГ УДАА).
        /// </summary>
        /// <summary>
        /// Буцах утга: `true` = мөрүүд ДИСКЭН ДЭЭР байна.
        ///
        /// ⚠️ ОЛОЛТ B.  Өмнө нь энэ функц `void` байсан ба диск дүүрэх /
        /// эрхгүй / вирусны хөтөлбөр түгжих БҮГДИЙГ ХООСОН `catch {}`-аар
        /// залгидаг байв.  Дуудагч нь ялгаж мэдэх БОЛОМЖГҮЙ, тоолуур ч
        /// БАЙХГҮЙ — тиймээс бичигдэхгүй `%APPDATA%`-тай машин серверээс
        /// БҮРЭН ЭРҮҮЛ харагдана.  Одоо: бүтэлгүйтэл ТООЛОГДОЖ,
        /// `session.perf.disk` -ээр серверт хүрнэ.
        ///
        /// ⚠️ ХЭВЭЭР ШИДЭХГҮЙ.  Revit-ийн хариу үйлдэл дискнээс ХАМААРАХ
        /// ЁСГҮЙ — дуудагч нь БУЦАХ УТГЫГ шалгана, онцгой тохиолдол UI
        /// thread рүү ХЭЗЭЭ Ч гарахгүй (Хориглолт №8, №9).
        /// </summary>
        private static bool AppendLines(List<string> lines)
        {
            if (lines == null || lines.Count == 0) return true;
            try
            {
                Directory.CreateDirectory(Dir);
                var sb = new StringBuilder(lines.Count * 256);
                for (int i = 0; i < lines.Count; i++) sb.Append(lines[i]).Append('\n');
                File.AppendAllText(LogPath, sb.ToString(), new UTF8Encoding(false));
                Interlocked.Increment(ref _diskOkWrites);
                return true;
            }
            catch (Exception ex)
            {
                // Диск дүүрсэн / эрх байхгүй / вирусны хөтөлбөр түгжсэн —
                // илгээлт САНАХ ОЙНООС үргэлжилнэ (T7-ийн доройтол),
                // ГЭХДЭЭ ЧИМЭЭГҮЙ БИШ: ТООЛОГДОНО.
                Interlocked.Increment(ref _diskFailWrites);
                Interlocked.Add(ref _diskFailLines, lines.Count);
                // ⚠️ ЗӨВХӨН ТӨРЛИЙН НЭР.  `ex.Message` нь замын нэр
                //    (хэрэглэгчийн нэр, сүлжээний хуваалцал) агуулдаг.
                try { _diskLastError = Trunc(ex.GetType().Name, 48); } catch { }
                return false;
            }
        }

        /// <summary>
        /// УНТРААЛТЫН ЭЦСИЙН ШАВХАЛТ — ЭНД БҮТЭЛГҮЙТЭХ НЬ ЖИНХЭНЭ АЛДАГДАЛ.
        ///
        /// ⚠️ ЯЛГАА НЬ ЗАГВАРЫН ХУВЬД ЧУХАЛ.  Ажиллах үеийн залгалт унавал
        /// мөр `unsent`-д ҮЛДЭЖ дараагийн POST-оор хүргэгдэнэ — тиймээс тэр
        /// нь «эрсдэлд орсон», алдагдсан БИШ.  Харин `PostLoop`-ийн
        /// `finally` доторх шавхалт нь ХАМГИЙН СҮҮЛИЙН боломж: сүлжээний
        /// давхарга аль хэдийн зогссон, процесс дуусаж байна.  Тэнд
        /// бичигдэж чадаагүй мөр нь ДИСКЭНД Ч, СЕРВЕР ДЭЭР Ч БАЙХГҮЙ —
        /// тодорхойлолтоороо `dropped`, тиймээс `_dropped`-д НЭМНЭ.
        /// </summary>
        private static void FlushTail(List<string> tail)
        {
            if (tail == null || tail.Count == 0) return;
            if (AppendLines(tail)) return;
            Interlocked.Add(ref _diskLostLines, tail.Count);
            Interlocked.Add(ref _dropped, tail.Count);
        }

        private static void LoadState(List<Line> unsent)
        {
            try { Directory.CreateDirectory(Dir); } catch { }

            // ⚠️ ЭЗЭМШЛИЙН ТҮГЖЭЭГ ХАМГИЙН ТҮРҮҮНД.  Түүнгүйгээр зэрэг асаж
            //    буй нөгөө процесс манай логийг «эзгүй» гэж үзэж ӨВЛӨН УСТГАНА.
            try
            {
                _ownLock = new FileStream(LockPath, FileMode.Create,
                                          FileAccess.Write, FileShare.None);
            }
            catch { _ownLock = null; }

            long cursor = ReadCursorFrom(CursorPath);
            _cursor = cursor;

            // Өөрийн БОЛОН хуучин (тагггүй) сайдкараас толгойг сэргээнэ.
            try { LoadSessionsFrom(SessionsPath); } catch { }
            try { LoadSessionsFrom(Path.Combine(Dir, LegacySessions)); } catch { }

            long maxN = cursor;
            try
            {
                if (File.Exists(LogPath))
                {
                    foreach (string raw in File.ReadLines(LogPath))
                    {
                        if (string.IsNullOrWhiteSpace(raw)) continue;
                        long n = LineNoOf(raw);
                        if (n > maxN) maxN = n;
                        if (n <= cursor) continue;
                        if (unsent.Count >= MaxUnsent)
                        {
                            // ⚠️ ХАЯГДААГҮЙ — дискэн дээр БАЙНА.  `_minUnloadedN`
                            //    нь нягтралт ба курсорыг хоёуланг нь барина.
                            if (n > 0 && n < _minUnloadedN) _minUnloadedN = n;
                            continue;
                        }
                        unsent.Add(new Line { N = n, Json = raw, QueuedTicks = 0 });
                    }
                }
            }
            catch { }

            // ⚠️ ШИНЭ МӨРИЙН ДУГААР НЬ ХУУЧНААС ДЭЭШ ЭХЛЭНЭ.  Тэглэвэл
            //    курсор нь өмнөх сессийн илгээгдээгүй мөрийг «баталгаажсан»
            //    гэж уншиж, тэр ажил БҮРМӨСӨН алдагдана.
            // ⚠️ ЗӨВХӨН ӨСГӨНӨ, ХЭЗЭЭ Ч БУУРУУЛАХГҮЙ.  `_pump` нь `_ready`-г
            //    ХЯЗГААРТАЙ хүлээдэг тул онолын хувьд энэ мөчид аль хэдийн
            //    дугаар олгосон байж болно; `Exchange` тэднийг БУЦААХ ба
            //    хоёр мөр нэг `n`-тэй болж курсор буруу мөрийг баталгаажуулна.
            RaiseLineNo(maxN);
            _maxAppended = Interlocked.Read(ref _lineNo);

            // ⚠️ ӨВЛӨЛТ ХАМГИЙН СҮҮЛД — өөрийн дугаарын мөр тогтсоны дараа.
            try { AdoptOrphans(unsent); } catch { }
        }

        /// <summary>`_lineNo`-г ЗӨВХӨН дээш чиглэлд шинэчилнэ.</summary>
        private static void RaiseLineNo(long value)
        {
            while (true)
            {
                long cur = Interlocked.Read(ref _lineNo);
                if (cur >= value) return;
                if (Interlocked.CompareExchange(ref _lineNo, value, cur) == cur) return;
            }
        }

        private static long ReadCursorFrom(string path)
        {
            try
            {
                if (path == null || !File.Exists(path)) return 0;
                string s = File.ReadAllText(path, Encoding.UTF8).Trim();
                long v;
                if (long.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out v))
                    return Math.Max(0, v);
            }
            catch { }
            return 0;
        }

        /// <summary>
        /// УНАСАН ПРОЦЕССЫН ҮЛДЭГДЛИЙГ ӨВЛӨХ.
        ///
        /// ⚠️ Хуучин хувилбарын тагггүй файл БОЛОН унасан шинэ процессын
        /// хоёуланг нь барина.  Эзэн нь АМЬД эсэхийг `.lock` файлыг
        /// `FileShare.None`-оор нээж шалгана — нээгдвэл эзэн нь үхсэн.
        ///
        /// ⚠️ МӨРИЙГ ДАХИН ДУГААРЛАНА.  `n` нь ЗӨВХӨН ЛОКАЛ данс бөгөөд
        /// серверт ХЭЗЭЭ Ч илгээгддэггүй (POST нь `b`-г л авдаг), тиймээс
        /// дахин дугаарлах нь аюулгүй — харин ҮҮНГҮЙГЭЭР өвлөсөн мөрийн `n`
        /// нь манайхтай давхцаж курсор БУРУУ мөрийг баталгаажуулна.
        ///
        /// ⚠️ ЭХЛЭЭД ЗАЛГАЖ, ДАРАА НЬ УСТГАНА.  Хооронд нь унавал дараагийн
        /// асаалт мөрүүдийг ДАХИН өвлөнө — ДАВХАРДАЛ үүснэ, харин АЛДАГДАЛ
        /// үүсэхгүй.  Сервер `ON CONFLICT`-оор давхардлыг шүүдэг тул энэ нь
        /// зөв тал руугаа алдах сонголт.
        /// </summary>
        private static void AdoptOrphans(List<Line> unsent)
        {
            string[] logs;
            try { logs = Directory.GetFiles(Dir, "bim-events.*.jsonl"); }
            catch { return; }

            var work = new List<string[]>();   // {log, cursor, lock, sessions}
            string mine = LogPath;
            for (int i = 0; i < logs.Length; i++)
            {
                string p = logs[i];
                if (string.Equals(p, mine, StringComparison.OrdinalIgnoreCase)) continue;
                string name = Path.GetFileName(p);
                // ⚠️ Windows-ийн орлуулагч нь 8.3 нэрийн улмаас ИЛҮҮ таарч
                //    чаддаг (`*.jsonl` нь `.jsonl.1234.tmp`-ыг барих эрсдэл).
                //    Нягтралтын түр файлыг «эзгүй лог» гэж өвлөвөл ТАСАРСАН
                //    бичилтийг бүртгэлд оруулна — тодорхой шүүлт ЗААВАЛ.
                if (!name.EndsWith(".jsonl", StringComparison.OrdinalIgnoreCase)) continue;
                // "bim-events." (11) + tag + ".jsonl" (6)
                if (name.Length <= 17) continue;
                string tag = name.Substring(11, name.Length - 17);
                if (tag.Length == 0) continue;
                work.Add(new string[]
                {
                    p,
                    Path.Combine(Dir, "bim-events." + tag + ".cursor"),
                    Path.Combine(Dir, "bim-events." + tag + ".lock"),
                    Path.Combine(Dir, "bim-sessions." + tag + ".json"),
                });
            }

            // ХУУЧИН хувилбарын тагггүй багц — түгжээ БАЙХГҮЙ тул үргэлж эзгүй.
            string legacy = Path.Combine(Dir, LegacyLog);
            try
            {
                if (File.Exists(legacy))
                    work.Add(new string[]
                    {
                        legacy,
                        Path.Combine(Dir, LegacyCursor),
                        null,
                        Path.Combine(Dir, LegacySessions),
                    });
            }
            catch { }

            for (int i = 0; i < work.Count; i++)
            {
                string[] w = work[i];
                if (!OrphanIsFree(w[2])) continue;   // эзэн нь АМЬД — хөндөхгүй
                try { AdoptOne(w[0], w[1], w[2], w[3], unsent); } catch { }
            }
        }

        private static bool OrphanIsFree(string lockPath)
        {
            try
            {
                if (lockPath == null || !File.Exists(lockPath)) return true;
                using (new FileStream(lockPath, FileMode.Open, FileAccess.Write,
                                      FileShare.None)) { }
                return true;
            }
            catch { return false; }
        }

        private static void AdoptOne(string logPath, string cursorPath, string lockPath,
                                     string sessionsPath, List<Line> unsent)
        {
            // ⚠️ ТОЛГОЙГ ЭХЛЭЭД.  Мөрүүд өвлөгдөөд толгой нь өвлөгдөхгүй бол
            //    тэдгээр нь «толгойгүй сесс» гэж ХАЯГДАНА (`SendOneBatch`).
            try { LoadSessionsFrom(sessionsPath); } catch { }

            long cur = ReadCursorFrom(cursorPath);
            var moved = new List<string>();
            var carry = new List<Line>();
            bool complete = false;
            try
            {
                if (File.Exists(logPath))
                {
                    foreach (string raw in File.ReadLines(logPath))
                    {
                        if (string.IsNullOrWhiteSpace(raw)) continue;
                        long n = LineNoOf(raw);
                        if (n <= cur) continue;
                        long nn = NextLineNo();
                        string re = Renumber(raw, nn);
                        if (re == null) continue;   // эвдэрсэн мөр — өвлөхгүй
                        moved.Add(re);
                        carry.Add(new Line { N = nn, Json = re, QueuedTicks = 0 });
                    }
                }
                complete = true;
            }
            catch { }

            if (moved.Count > 0)
            {
                AppendLines(moved);
                for (int i = 0; i < carry.Count; i++)
                {
                    if (carry[i].N > _maxAppended) _maxAppended = carry[i].N;
                    if (unsent.Count >= MaxUnsent)
                    {
                        if (carry[i].N < _minUnloadedN) _minUnloadedN = carry[i].N;
                        continue;
                    }
                    unsent.Add(carry[i]);
                }
                // ⚠️ Өвлөсөн толгойг ӨӨРИЙН сайдкарт бататгана — эс бөгөөс
                //    энэ процесс унавал мөр нь үлдэж толгой нь алга болно.
                try { SaveSessions(); } catch { }
            }

            if (!complete) return;   // бүтэн уншиж чадаагүй — УСТГАХГҮЙ
            TryDelete(logPath);
            TryDelete(cursorPath);
            TryDelete(sessionsPath);
            TryDelete(lockPath);
        }

        /// <summary>`{"n":&lt;цифр&gt;,` толгойг шинэ дугаараар солино.</summary>
        private static string Renumber(string json, long n)
        {
            if (string.IsNullOrEmpty(json)) return null;
            if (!json.StartsWith("{\"n\":", StringComparison.Ordinal)) return null;
            int c = json.IndexOf(',', 5);
            if (c <= 5) return null;
            return "{\"n\":" + n.ToString(CultureInfo.InvariantCulture) + json.Substring(c);
        }

        private static void TryDelete(string path)
        {
            try { if (path != null && File.Exists(path)) File.Delete(path); } catch { }
        }

        /// <summary>
        /// `MaxUnsent`-ээс хэтэрсэн улмаас ачаалагдаагүй мөрийг дискнээс
        /// ЭРГҮҮЛЖ АВЧИРНА.  ⚠️ ЗӨВХӨН `unsent` ХООСОН үед дуудагдана —
        /// тэгснээр давхардал БОЛОМЖГҮЙ.
        /// </summary>
        private static void ReloadFromDisk(List<Line> unsent)
        {
            try
            {
                _minUnloadedN = long.MaxValue;
                if (!File.Exists(LogPath)) return;
                foreach (string raw in File.ReadLines(LogPath))
                {
                    if (string.IsNullOrWhiteSpace(raw)) continue;
                    long n = LineNoOf(raw);
                    if (n <= _cursor) continue;
                    if (unsent.Count >= MaxUnsent)
                    {
                        if (n > 0 && n < _minUnloadedN) _minUnloadedN = n;
                        continue;
                    }
                    unsent.Add(new Line { N = n, Json = raw, QueuedTicks = 0 });
                }
            }
            catch { }
        }

        private static long LineNoOf(string json)
        {
            try
            {
                using (JsonDocument d = JsonDocument.Parse(json))
                {
                    JsonElement n;
                    if (d.RootElement.TryGetProperty("n", out n) &&
                        n.ValueKind == JsonValueKind.Number)
                        return n.GetInt64();
                }
            }
            catch { }
            return 0;
        }

        /// <summary>
        /// БАТАЛГААЖСАН ХИЛ = илгээгдээгүй ХАМГИЙН БАГА `n` − 1.
        ///
        /// ⚠️ ЗӨВХӨН ЗАЛГАМАЛ ХИЛ.  «Хамгийн их илгээгдсэн `n`» гэж бичих нь
        /// БУРУУ: багц нь СЕССЭЭР бүлэглэгддэг тул илүү жижиг `n`-тэй өөр
        /// сессийн мөр илгээгдээгүй үлдэж болно, ба тэр мөр дараагийн
        /// асаалтад АЛГА БОЛНО.
        /// </summary>
        private static void AdvanceCursor(List<Line> unsent)
        {
            try
            {
                long boundary = _maxAppended;
                // ⚠️ ДИСКЭН ДЭЭР БАЙГАА Ч САНАХ ОЙД АЧААЛААГҮЙ МӨР байвал
                //    курсор түүнээс ЦААШ урагшлах ЁСГҮЙ — эс бөгөөс тэдгээр нь
                //    «баталгаажсан» болж БҮРМӨСӨН алдагдана.
                if (_minUnloadedN != long.MaxValue && _minUnloadedN - 1 < boundary)
                    boundary = _minUnloadedN - 1;
                for (int i = 0; i < unsent.Count; i++)
                {
                    long n = unsent[i].N;
                    if (n > 0 && n - 1 < boundary) boundary = n - 1;
                }
                if (boundary <= _cursor) return;
                _cursor = boundary;
                WriteCursor(boundary);
            }
            catch { }
        }

        private static void WriteCursor(long value)
        {
            try
            {
                Directory.CreateDirectory(Dir);
                // ⚠️ tmp+move — атомаар.  pid нь хоёр Revit нэг `%APPDATA%`-г
                //    хуваалцах тохиолдлыг барина.
                string tmp = CursorPath + "." + Pid + ".tmp";
                File.WriteAllText(tmp, value.ToString(CultureInfo.InvariantCulture),
                                  new UTF8Encoding(false));
                AtomicReplace(tmp, CursorPath);
            }
            catch { }
        }

        /// <summary>
        /// Файл `MaxLogBytes`-ээс том БА курсор > 0 бол НЯГТРУУЛНА —
        /// ЗӨВХӨН баталгаажсан мөрийг хаяна.
        /// ⚠️ Илгээгдээгүй мөрийг ХЭЗЭЭ Ч хаяхгүй; тэр нь дараагийн асаалтын
        /// цорын ганц эх сурвалж.
        /// </summary>
        private static void TryCompact(List<Line> unsent)
        {
            try
            {
                if (_cursor <= 0) return;
                // ⚠️ ДИСК ДЭЭР БАЙГАА ЧУ САНАХ ОЙД АЧААЛААГҮЙ МӨР БАЙВАЛ ЗОГСОНО.
                //    Нягтралт нь файлыг `unsent`-ээс БҮТЭН ДАХИН БИЧДЭГ тул
                //    тэдгээрийг ЧИМЭЭГҮЙ УСТГАНА (`check_emitter.py` T5b:
                //    500 мөр, `dropped` тоолуур 0).  Лог түр томрох нь өгөгдөл
                //    алдахаас ХАМААГҮЙ ДЭЭР; `ReloadFromDisk` тэднийг эргүүлж
                //    авчрах үед нягтралт дахин нээгдэнэ.
                if (_minUnloadedN != long.MaxValue) return;
                var fi = new FileInfo(LogPath);
                if (!fi.Exists || fi.Length <= MaxLogBytes) return;

                string tmp = LogPath + "." + Pid + ".tmp";
                using (var sw = new StreamWriter(tmp, false, new UTF8Encoding(false)))
                {
                    for (int i = 0; i < unsent.Count; i++)
                    {
                        sw.Write(unsent[i].Json);
                        sw.Write('\n');
                    }
                }
                AtomicReplace(tmp, LogPath);
            }
            catch { }
        }

        /* ── СЕССИЙН ТОЛГОЙН САЙДКАР ────────────────────────────────── */

        /// <summary>⚠️ `SaveSessions` -ыг `_pump` (шинэ сесс) БА `Cancel()`
        /// (Revit-ийн үндсэн thread) ХОЁУЛАА дууддаг; түр файлын нэр нь
        /// pid-ээр л ялгагддаг тул хоёр зэрэг бичилт нэг нэр рүү очно.</summary>
        private static readonly object _sessionsFileGate = new object();

        private static void SaveSessions()
        {
            try
            {
                lock (_sessionsFileGate)
                {
                Directory.CreateDirectory(Dir);
                var list = new List<SessionHeader>(_headers.Values);
                // Хэт олон болвол ХАМГИЙН ХУУЧНЫГ хаяна (нэг процесс дээр
                // 64 баримт нээх нь эмгэг тохиолдол).
                // ⚠️ ТАСЛАГДСАН ТОЛГОЙ = тэр сессийн БҮХ мөр хаягдана
                //    (`SendOneBatch`-ийн «толгойгүй сесс» салаа).  Өвлөлт нь
                //    унасан процессын толгойг ч оруулдаг тул 64 нь дөнгөж байв.
                if (list.Count > 512) list = list.GetRange(list.Count - 512, 512);
                string json = JsonSerializer.Serialize(list);
                string tmp = SessionsPath + "." + Pid + ".tmp";
                File.WriteAllText(tmp, json, new UTF8Encoding(false));
                AtomicReplace(tmp, SessionsPath);
                }
            }
            catch { }
        }

        private static void LoadSessionsFrom(string path)
        {
            try
            {
                if (path == null || !File.Exists(path)) return;
                var list = JsonSerializer.Deserialize<List<SessionHeader>>(
                    File.ReadAllText(path, Encoding.UTF8));
                if (list == null) return;
                for (int i = 0; i < list.Count; i++)
                {
                    SessionHeader h = list[i];
                    if (h != null && !string.IsNullOrEmpty(h.SessionUid))
                        _headers[h.SessionUid] = h;
                }
            }
            catch { }
        }

        /// <summary>
        /// АТОМ СОЛИЛТ.
        ///
        /// ⚠️ `File.Delete` + `File.Move` НЬ АТОМ БИШ — хоорондох
        /// агшинд цахилгаан тасрахад ФАЙЛ БҮРМӨСӨН алга болно (курсорын
        /// хувьд бүхэл лог ДАХИН илгээгдэнэ, сайдкарын хувьд БҮХ толгой
        /// алга болж мөрүүд хаягдана).  `File.Replace` нь NTFS дээр АТОМ.
        /// </summary>
        private static void AtomicReplace(string tmp, string dest)
        {
            try
            {
                if (File.Exists(dest)) { File.Replace(tmp, dest, null); return; }
            }
            catch { }
            try { if (File.Exists(dest)) File.Delete(dest); } catch { }
            try { File.Move(tmp, dest); } catch { }
        }

        /* ============================================================== */
        /*  ЖИЖИГ ТУСЛАГЧИД                                                */
        /* ============================================================== */

        private static readonly DateTime Epoch =
            new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);

        private static DateTime FromUnix(long sec)
        {
            try { return Epoch.AddSeconds(sec); }
            catch { return DateTime.UtcNow; }
        }

        /// <summary>⚠️ ЯГ 3 БУТАРХАЙ ОРОН.  Сервер нь `str(v, 40)` -оор
        /// таслаад `Date.parse` дууддаг; «o» форматын 7 орон нь V8 дээр
        /// баталгаагүй.</summary>
        private static string Iso(DateTime utc)
        {
            return utc.ToUniversalTime()
                      .ToString("yyyy-MM-ddTHH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
        }

        private static long NowMs()
        {
            long f = System.Diagnostics.Stopwatch.Frequency / 1000;
            if (f <= 0) f = 1;
            return System.Diagnostics.Stopwatch.GetTimestamp() / f;
        }

        private static string Q(string s)
        {
            return s == null ? "null" : JsonSerializer.Serialize(s);
        }

        private static string Trunc(string s, int max)
        {
            if (s == null) return null;
            return s.Length <= max ? s : s.Substring(0, max);
        }

        private static string Pid
        {
            get
            {
                try
                {
                    return System.Diagnostics.Process.GetCurrentProcess().Id
                                 .ToString(CultureInfo.InvariantCulture);
                }
                catch { return "0"; }
            }
        }

        private static long ProcessStartTicks()
        {
            try { return System.Diagnostics.Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks; }
            catch { return DateTime.UtcNow.Ticks; }
        }

        /// <summary>⚠️ МАШИНЫ НЭР ХАДГАЛАХГҮЙ — ЗӨВХӨН sha256 (0202-ийн
        /// нууцлалын гэрээ).  Сервер `isSha256` -аар шалгана.</summary>
        private static string MachineHash()
        {
            try
            {
                string raw = Environment.MachineName + "|" +
                             Environment.UserDomainName + "|" +
                             Environment.UserName;
                return ChangeTracker.Sha256Hex(raw);
            }
            catch { return null; }
        }
    }
}
