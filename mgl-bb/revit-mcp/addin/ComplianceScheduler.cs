using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.Threading;

namespace RevitMcpAddin
{
    /* ================================================================== */
    /*  ОРОЛТЫН ГЭРЭЭ — ЭНЭ ФАЙЛЫГ REVIT-ГҮЙ БАЙЛГАДАГ ХИЛ                */
    /* ================================================================== */

    /// <summary>
    /// Нэг бохирдсон элементийн МЭДЭГДЭЖ БУЙ ЗҮЙЛ — дүрмийн гохны индексийн
    /// хайлтад хангалттай, гэхдээ түүнээс ИЛҮҮ ЮМ ЧУХ БАЙХГҮЙ.
    ///
    /// ⚠️ `Category` нь `2-3` §9.5 №14-ийн гэрээ.  `ChangeTracker` нь `long`
    /// id Л хадгалдаг (баталгаажсан: `ChangeTracker.cs`-д `Category` гэсэн үг
    /// НЭГ Ч удаа гардаггүй) ба `LogicalChangeSet.ElementIds` нь `long[]`.
    /// Иймд категори нь ХҮЙТЭН эгнээний `collect_rule_inputs`-ийн `resolve`
    /// горимоос ирж, ЭНД КЭШЛЭГДЭНЭ — халуун зам ӨӨРЧЛӨГДӨХГҮЙ.  Тэр кэш нь
    /// яагаад ажилладаг вэ: хүн нэг ханыг зурж дуустлаа хэдэн арван удаа
    /// хөнддөг тул хоёр дахь мөчлөгөөс эхлээд `resolve` дуудлага ОГТ ГАРАХГҮЙ.
    /// </summary>
    internal sealed class DirtyElement
    {
        public long Id;
        public string ElementUid;
        /// <summary>Revit-ийн ЭХ категорийн нэр — ОРЧУУЛАХГҮЙ (Хавсралт §1.3).</summary>
        public string Category;
        /// <summary>`add` | `modify` | `delete`.</summary>
        public string Change;
    }

    /// <summary>`collect_rule_inputs`-ийн `resolve` горимын НЭГ мөр.</summary>
    internal sealed class ResolvedElement
    {
        public long Id;
        public string Uid;
        public string Category;
        /// <summary>false = загварт БАЙХГҮЙ (устгагдсан / буцаагдсан).</summary>
        public bool Exists;
    }

    /// <summary>Нэг элементэд ямар баримт хэрэгтэй вэ.</summary>
    internal sealed class FactRequest
    {
        public string Uid;
        /// <summary>УГТВАРГҮЙ локал нэрс (Хавсралт §1.1-ийн `requires.params`).</summary>
        public List<string> Facts = new List<string>();
    }

    /// <summary>
    /// `collect_rule_inputs`-ийн хариултын ЗАДАЛСАН хэлбэр.
    ///
    /// ⚠️ `doc` блок нь БАРИМТ ТУТАМД НЭГ УДАА шийдэгдэнэ (Хавсралт §1.1);
    /// `Elements` нь uid тутам.  `FactBag`-ийн шийдэх дараалал 3 > 4 нь
    /// АМЬД `doc.*` нь авторласан толин тусгалыг ДАРНА гэсэн үг — тиймээс
    /// энэ блок хоосон байх нь ЧУХАЛ ялгаа, «мэдэхгүй» гэсэн үг.
    /// </summary>
    internal sealed class FactSetStore
    {
        public readonly Dictionary<string, Dictionary<string, FactValue>> Elements =
            new Dictionary<string, Dictionary<string, FactValue>>(StringComparer.Ordinal);

        public readonly Dictionary<string, FactValue> Doc =
            new Dictionary<string, FactValue>(StringComparer.Ordinal);

        public Dictionary<string, FactValue> For(string uid)
        {
            Dictionary<string, FactValue> d;
            return Elements.TryGetValue(uid ?? "", out d)
                ? d
                : new Dictionary<string, FactValue>(StringComparer.Ordinal);
        }
    }

    /// <summary>
    /// Revit-д хүрэх ЦОРЫН ГАНЦ гарц — ХИЙСВЭРЛЭГДСЭН.
    ///
    /// ⚠️ ЯАГААД ИНТЕРФЕЙС ВЭ: `ComplianceScheduler.cs` ба `ComplianceState.cs`
    /// хоёрт Revit-ийн үндсэн нэрийн орон зайн нэр НЭГ Ч удаа гарах ЁСГҮЙ —
    /// §6-ийн хүлээн авах шалгуур нь тэр мөрийг ГРЕПЭЭР тоолдог тул энэ
    /// тайлбар нь ч түүнийг бичихгүй.  Хэрэгжүүлэлт нь `RuleFactExtractor.cs`-д
    /// (`RuleInputBusSource`) амьдарч, `App.OnStartup` тэднийг холбоно.
    /// Ингэснээр хуваарилагч нь Revit суулгалтгүйгээр `dotnet run`-аар
    /// тестлэгдэнэ, ба хуурамч эх сурвалж хийхэд `RuleEngine`-ийн паритетын
    /// харнесс бэлэн болно.
    /// </summary>
    internal interface IRuleInputSource
    {
        /// <summary>
        /// БҮТЭН СКАН-ы id-ууд (§3.11).  ⚠️ Энэ нь `TryGetByKey`-ийн ЦОРЫН
        /// ГАНЦ дуудагч: тэр нь мөрдөгчийн түгжээний ДОР 500 000 хүртэл id-г
        /// ГҮНЗГИЙ хуулдаг тул 3 секунд тутмын мөчлөгт ХЭРЭГЛЭХГҮЙ.
        /// </summary>
        long[] FullScanIds(string docKey, out bool truncated);

        /// <summary>id → (uid, категори, оршиж буй эсэх).  ХҮЙТЭН эгнээ.</summary>
        bool TryResolve(long[] ids, IList<ResolvedElement> rows, out bool skipped, out bool more);

        /// <summary>uid → баримтууд + `doc` блок.  ХҮЙТЭН эгнээ.</summary>
        bool TryCollect(IList<FactRequest> items, FactSetStore store, out bool skipped, out bool more);
    }

    /* ================================================================== */
    /*  §52 — ДҮРМИЙН ГОХНЫ ИНДЕКС                                        */
    /* ================================================================== */

    /// <summary>
    /// «Энэ категорийн энэ өөрчлөлт ямар дүрмийг ХӨДӨЛГӨЖ БОЛОХ вэ» гэдгийг
    /// ХАЙЛТ болгоно (§52-R3/R4).
    ///
    /// ⚠️ ЯАГААД ИНДЕКС ВЭ: 8 багийн pack × ~40 дүрэм = ~320 дүрэм.  Бохирдсон
    /// элемент бүрд бүх дүрмийг тойрвол 400 элемент × 320 = 128 000 хамаарлын
    /// шалгалт болно — §51-R3-ийн шууд зөрчил.  Индекстэй бол элемент бүр НЭГ
    /// толь бичгийн хайлт: ихэвчлэн 0-3 нэр дэвшигч.
    ///
    /// ⚠️ НЭГ УДАА баригдана — pack солигдоход л дахин.  Индекс барих нь
    /// Revit-ийн API-д ХҮРЭХГҮЙ (`RuleDef` нь цэвэр өгөгдөл).
    ///
    /// ⚠️ PACK БАЙХГҮЙ БАГ = ТЭГ ДҮРЭМ.  `Build` нь ЗӨВХӨН тухайн сессийн
    /// багийн pack-ыг авна.  Pack ирээгүй бол индекс ХООСОН үлдэж,
    /// `Candidates` нь үргэлж хоосон буцаана — ӨӨР БАГИЙН pack, «компани
    /// даяарын» нэгтгэсэн pack, эсвэл ямар нэг ӨГӨГДМӨЛ дүрмийн багц руу
    /// ХЭЗЭЭ Ч ШИЛЖИХГҮЙ (§3.6-ийн ШАТ 0).
    /// </summary>
    internal sealed class RuleTriggerIndex
    {
        /// <summary>
        /// (категори, өөрчлөлт) → нэр дэвшигч дүрмүүд.
        ///
        /// ⚠️ Түлхүүр нь `category + '\0' + change` МӨР — `ValueTuple` БИШ.
        /// net48 (Revit 2024) дээр `ValueTuple` нь NuGet пакет шаарддаг ба
        /// энэ төслийн R24 Configuration түүнийг татдаггүй.
        ///
        /// ⚠️ Категорийн нэр нь Revit-ийн ХЭЛНЭЭС хамаарна (0204:110-ийн
        /// дүрэм) — орчуулахгүй, ЭХ хэлбэрээр нь түлхүүрлэнэ.
        /// </summary>
        private readonly Dictionary<string, List<RuleDef>> _byTrigger =
            new Dictionary<string, List<RuleDef>>(StringComparer.Ordinal);

        /// <summary>
        /// Категори тутмын НЭГТГЭСЭН хувилбар.
        ///
        /// ⚠️ ЯАГААД ХЭРЭГТЭЙ ВЭ: `RawEntry` нь гүйлгээ тутмын `Added` /
        /// `Deleted` / `Modified` ТООГ л хадгалдаг, id тус бүр АЛЬ АНГИД нь
        /// орсныг БИШ (`ChangeTracker.cs:414`).  Иймд «оршин байгаа элемент»
        /// нь `add` уу `modify` юу гэдгийг ХҮЙТЭН эгнээ ЯЛГАЖ ЧАДАХГҮЙ.
        /// Тодорхойгүй үед НЭГТГЭСЭН хувилбар руу унана: илүү үнэлэх нь
        /// АЮУЛГҮЙ (монотон), дутуу үнэлэх нь Хавсралт §4.5-ийн «ХАМГИЙН ХОР
        /// ХӨНӨӨЛТЭЙ АЛДАА» — шалгалт ЧИМЭЭГҮЙ УНТАРНА.
        /// </summary>
        private readonly Dictionary<string, List<RuleDef>> _byCategory =
            new Dictionary<string, List<RuleDef>>(StringComparer.Ordinal);

        /// <summary>Гох зарлаагүй дүрэм — ЗӨВХӨН бүтэн скан дээр ажиллана.</summary>
        private readonly List<RuleDef> _fullScanOnly = new List<RuleDef>();

        private readonly Dictionary<string, RuleDef> _byUid =
            new Dictionary<string, RuleDef>(StringComparer.Ordinal);

        public string PackSha256 { get; private set; }
        public string RulesetVersion { get; private set; }
        public string TeamCode { get; private set; }
        public ConflictTable Conflicts { get; private set; }
        public ProjectBuildContext Context { get; private set; }
        public int RuleCount { get; private set; }

        private static string Key(string category, string change)
        {
            return (category ?? "") + "\0" + (change ?? "modify");
        }

        public static RuleTriggerIndex Build(RulePack.Loaded pack)
        {
            RuleTriggerIndex ix = new RuleTriggerIndex();
            if (pack == null) return ix;

            ix.PackSha256 = pack.PackSha256;
            ix.RulesetVersion = pack.RulesetVersion;
            ix.TeamCode = pack.TeamCode;
            ix.Conflicts = pack.Conflicts;
            ix.Context = pack.Context;

            RuleDef[] rules = pack.Rules ?? new RuleDef[0];
            ix.RuleCount = rules.Length;
            for (int i = 0; i < rules.Length; i++)
            {
                RuleDef r = rules[i];
                if (r == null || string.IsNullOrEmpty(r.RuleUid)) continue;
                ix._byUid[r.RuleUid] = r;

                RuleTrigger[] triggers = r.Requires != null ? r.Requires.TriggeredBy : null;
                if (triggers == null || triggers.Length == 0)
                {
                    // Гох зарлаагүй — өсөлтөт замд ХЭЗЭЭ Ч ажиллахгүй (§3.11-ийн гох №3).
                    ix._fullScanOnly.Add(r);
                    continue;
                }
                for (int t = 0; t < triggers.Length; t++)
                {
                    RuleTrigger tr = triggers[t];
                    if (tr == null) continue;
                    Add(ix._byTrigger, Key(tr.Category, tr.Change), r);
                    Add(ix._byCategory, tr.Category ?? "", r);
                }
            }
            return ix;
        }

        private static void Add(Dictionary<string, List<RuleDef>> map, string key, RuleDef r)
        {
            List<RuleDef> list;
            if (!map.TryGetValue(key, out list))
            {
                list = new List<RuleDef>();
                map[key] = list;
            }
            if (!list.Contains(r)) list.Add(r);
        }

        /// <summary>
        /// Бохирдсон элементийн (категори, өөрчлөлт) → нэр дэвшигчид.
        ///
        /// ⚠️ `change == null` нь «ЯЛГАЖ ЧАДААГҮЙ» гэсэн үг, «өөрчлөлтгүй»
        /// БИШ — тэр үед тухайн категорийн БҮХ гохны нэгдэл буцна.
        /// </summary>
        public IList<RuleDef> Candidates(string category, string change)
        {
            List<RuleDef> list;
            if (change == null)
            {
                return _byCategory.TryGetValue(category ?? "", out list)
                    ? (IList<RuleDef>)list : EmptyRules;
            }
            return _byTrigger.TryGetValue(Key(category, change), out list)
                ? (IList<RuleDef>)list : EmptyRules;
        }

        private static readonly RuleDef[] EmptyRules = new RuleDef[0];

        public IList<RuleDef> FullScanOnly { get { return _fullScanOnly; } }

        public RuleDef ByUid(string uid)
        {
            RuleDef r;
            return uid != null && _byUid.TryGetValue(uid, out r) ? r : null;
        }

        /// <summary>
        /// Гох ба бүтэн-скан хоёулаа хоосон = ЭНЭ багт pack БАЙХГҮЙ
        /// (§3.6-ийн ШАТ 0, §3.11-ийн NO-OP).
        ///
        /// ⚠️ «Дүрэм тэг» ба «pack тэг» хоёрыг ялгах ЦОРЫН ГАНЦ туг.  Эзний
        /// шийдвэр Ш4-ээр `rules` хүснэгт ХООСОН шипдэг тул РЕЛИЗ N-д энэ нь
        /// БҮХ багт үнэн байна — тэр нь алдаа БИШ, ба «0 зөрчил = нийцтэй»
        /// гэж ХЭЗЭЭ Ч уншигдах ЁСГҮЙ.
        /// </summary>
        public bool IsEmpty
        {
            get { return _byTrigger.Count == 0 && _fullScanOnly.Count == 0; }
        }
    }

    /* ================================================================== */
    /*  БҮРТГЭЛ (`rule_run_ledger`-ийн клиент тал)                        */
    /* ================================================================== */

    /// <summary>
    /// §69-ийн тоолуурын ЭХ СУРВАЛЖ.  «Хэдэн дүрэм авч үзсэн / алгассан /
    /// хамаарсан / үнэлсэн» — эдгээргүйгээр «шалгагдсан» ба «шалгагдаагүй»
    /// хоёр ялгагдахгүй ба хоосон самбар нь «цэвэр» мэт харагдана.
    /// </summary>
    internal sealed class RunLedger
    {
        internal sealed class Row
        {
            public string RuleUid;
            public int Considered;
            public int Skipped;
            public int Applicable;
            public int Evaluated;
            /// <summary>Хамгийн сүүлд бичигдсэн алгасах шалтгаан (Хавсралт §9.1).</summary>
            public string LastSkipReason;
        }

        private readonly Dictionary<string, Row> _rows =
            new Dictionary<string, Row>(StringComparer.Ordinal);

        public bool BudgetAborted { get; private set; }

        public ICollection<Row> Rows { get { return _rows.Values; } }
        public int RuleCount { get { return _rows.Count; } }

        private Row Of(string uid)
        {
            Row r;
            if (!_rows.TryGetValue(uid ?? "", out r))
            {
                r = new Row { RuleUid = uid ?? "" };
                _rows[uid ?? ""] = r;
            }
            return r;
        }

        public void Considered(string uid) { Of(uid).Considered++; }

        public void Skipped(string uid, string reason)
        {
            Row r = Of(uid);
            r.Skipped++;
            if (!string.IsNullOrEmpty(reason)) r.LastSkipReason = reason;
        }

        public void Applicable(string uid) { Of(uid).Applicable++; }
        public void Evaluated(string uid) { Of(uid).Evaluated++; }
        public void Aborted() { BudgetAborted = true; }
    }

    /* ================================================================== */
    /*  НЭГ МӨЧЛӨГИЙН ҮР ДҮН                                             */
    /* ================================================================== */

    internal sealed class PassResult
    {
        public int ScanGeneration;

        /// <summary>
        /// ⚠️ КЛИЕНТИЙН талын туг — ribbon-ы бичээс ТОО БИШ, «дүрмийн багц
        /// бэлэн болоогүй» гэж хэлнэ.  Чимээгүй тэг нь эвдэрсэн мэт харагдана.
        /// </summary>
        public bool NoPack;

        /// <summary>`TryCall`-ийн `Gate.Wait(0)` алгасалт — ХЭВИЙН, алдаа БИШ.</summary>
        public bool Skipped;

        /// <summary>`full` | `partial` — §56-ийн «дутуу шалгасан».</summary>
        public string Coverage = "full";

        public int BadgeCount;
        public int Evaluations;
        public int StaledEdit;

        public readonly RunLedger Ledger = new RunLedger();
        public readonly List<EmittedFinding> Emitted = new List<EmittedFinding>();

        public void Emit(FindingRow row, string prevVerdict)
        {
            if (row == null) return;
            Emitted.Add(new EmittedFinding { Row = row, PrevVerdict = prevVerdict });
        }
    }

    /* ================================================================== */
    /*  ХУВААРИЛАГЧ                                                       */
    /* ================================================================== */

    /// <summary>
    /// §51-ийн 3-7-р шат: «нөлөөлсөн элемент → нөлөөлж болох дүрэм → зөвхөн
    /// хамааралтай шалгалт → олдвор → мэдэгдэл».
    ///
    /// ⚠️ ЭНЭ ФАЙЛ REVIT-ИЙН API-Д ХҮРЭХГҮЙ.  Revit-ийн ямар ч төрөл, ямар ч
    /// нэрийн орон зайг НЭГ Ч удаа дурдахгүй — иймд Revit-гүйгээр эмхэтгэгдэж
    /// тестлэгдэнэ.  Revit-д
    /// хүрэх цорын ганц хэсэг нь `IRuleInputSource` бөгөөд тэр нь ХҮЙТЭН
    /// эгнээгээр Revit-ийн үндсэн урсгал руу явдаг `collect_rule_inputs`.
    ///
    /// ⚠️ ӨӨРИЙН урсгалтай, ШИНЭ ТАЙМЕРГҮЙ.  `ChangeTracker`-ийн 3 секундын
    /// таймер нь ДАВТАМЖИТ (`ChangeTracker.cs:313` — гурав дахь аргумент нь
    /// `Timeout.Infinite` БИШ) бөгөөд `Dirty.Clear()` аль хэдийн ажилласан
    /// байдаг тул тэнд 2 секундын үнэлгээ эсвэл сүлжээний дуудлага тавих нь
    /// давхцал үүсгэж, өдрийн ажлыг ЧИМЭЭГҮЙ алдагдуулна.  Иймд ажил нь
    /// ЭНД, зориулалтын `IsBackground` урсгал дээр.
    ///
    /// ⚠️ Мөрдөгчийн түгжээг ЭНД БАРИХГҮЙ.  `2-4` нь POCO хэлбэрээр
    /// (`LogicalChangeSet`) хуулбарыг өгсөн байна; энэ файл түгжээ хөндөхгүй.
    ///
    /// ⚠️ Хэрэглэгчид ХАРАГДАХ ЦОРЫН ГАНЦ гарц нь `BadgeCount` — тоо.  Энэ
    /// давхарга цонх нээхгүй, самбар нээхгүй, фокус булаахгүй, UI урсгал руу
    /// синхрон дуудлага хийхгүй.
    /// </summary>
    internal static class ComplianceScheduler
    {
        /// <summary>Нэг мөчлөгт үнэлэх элементийн ДЭЭД тоо.</summary>
        /// <remarks>
        /// ⚠️ ЯАГААД 400 ВЭ: `collect_rule_inputs` нь дуудлага тутам &lt;= 150
        /// элемент (§3.7) тул 400 нь ХАМГИЙН ИХ гурван зүсэлт.  `MaxPerSlice = 4`
        /// (`RevitToolBus.cs:440`) тул тэр гурав нь хэрэглэгчийн дуудлагатай
        /// ЭЭЛЖЛЭН орно.  Илүү нь дараагийн мөчлөгт үлдэнэ — АЛДАГДАХГҮЙ,
        /// зөвхөн хойшилно (ХҮЙТЭН эгнээ нь ХАМГИЙН САЙН ХИЧЭЭХ).
        ///
        /// ⚠️ ТААМАГ (§9.3 №7) — өдрийн гүйлгээний хурд хэмжигдээгүй.
        /// `timing.log`-ийн `input.collect` p95-ийг хараад л ЭЦЭСЛЭНЭ.
        /// </remarks>
        private const int MaxDirtyPerPass = 400;

        /// <summary>Нэг дуудлагад хүсэх элементийн тоо — §3.7-ийн хатуу дээд.</summary>
        private const int CollectChunk = 150;

        /// <summary>Нэг мөчлөгийн үнэлгээний ХАТУУ таслалт (мс) → coverage=partial.</summary>
        private const int EvalAbortMs = 2000;

        /// <summary>`collect_rule_inputs`-ийн ГАДААД deadline (секунд).</summary>
        internal const int CollectTimeoutSec = 10;

        /// <summary>Хүлээгдэж буй олонлогийн дараалал — хязгаартай.</summary>
        private const int MaxQueued = 64;

        /// <summary>
        /// Ажилчны сэрэлтийн ДЭЭД хүлээлт.  Ажилгүй бол ЭНД унтана.
        ///
        /// ⚠️ БУСЫ МӨЧЛӨГ БИШ: ажил ирэхэд `_wake` дохиогоор ШУУД сэрнэ; энэ
        /// тоо нь зөвхөн «дохио алдагдвал мөнхөд унтахгүй» гэсэн даатгал.
        /// `Timeout.Infinite` нь ч ажиллана, гэхдээ алдагдсан дохио тэр үед
        /// ЧИМЭЭГҮЙ зогсолт болно — 5 секунд тутмын нэг `if` нь хамаагүй хямд.
        /// </summary>
        private const int IdleWaitMs = 5000;

        /// <summary>
        /// ХООСОН индексийг дахин барих хамгийн бага завсар (мс).
        ///
        /// ⚠️ ЯАГААД ХЭРЭГТЭЙ ВЭ: багц серверээс ирж `%APPDATA%`-д
        /// хадгалагдмагц (`RulePack.SaveDownloaded`) Revit-ийг ДАХИН
        /// АСААХГҮЙГЭЭР идэвхжих ёстой.  ГЭХДЭЭ мөчлөг тутам диск уншиж JSON
        /// задлах нь `rules` ХООСОН шипдэг релиз N дээр цэвэр дэмий ажил —
        /// иймд ЗӨВХӨН хоосон индекс дээр, ЗӨВХӨН энэ завсраар.
        /// </summary>
        private const int EmptyPackRecheckMs = 600000;

        private static readonly ConcurrentQueue<LogicalChangeSet> _queue =
            new ConcurrentQueue<LogicalChangeSet>();
        private static readonly SemaphoreSlim _wake = new SemaphoreSlim(0, int.MaxValue);

        private static Thread _worker;
        private static int _started;
        private static volatile bool _disabled;
        private static IRuleInputSource _source;
        private static CancellationToken _ct = CancellationToken.None;

        private static readonly ComplianceState _state = new ComplianceState();

        /// <summary>Багийн код → индекс.  Pack солигдоход Л дахин баригдана.</summary>
        private static RuleTriggerIndex _index;
        private static string _indexTeam;
        private static int _indexBuiltTick;
        private static ComplianceState.PackStamp _stamp;

        /// <summary>
        /// id → (uid, категори).  Баримт тутам.
        ///
        /// ⚠️ Энэ кэш нь `resolve` дуудлагыг ХАМГИЙН ЭХНИЙ мөчлөгт л
        /// хийлгэдэг зүйл.  Хязгаартай: `MaxCacheEntries` хүрэхэд бүхэлдээ
        /// хаягдана (LRU БИШ — энгийн, урьдчилан таамаглагдах, ба алдагдал нь
        /// зөвхөн нэмэлт `resolve` дуудлага).
        /// </summary>
        private static readonly Dictionary<string, Dictionary<long, ResolvedElement>> _resolveCache =
            new Dictionary<string, Dictionary<long, ResolvedElement>>(StringComparer.Ordinal);

        private const int MaxCacheEntries = 20000;

        private static volatile string _lastDocKey;
        private static int _fullScanRequested;

        /* ============================================================== */
        /*  ГАДААД ТӨЛӨВ — ЗӨВХӨН УНШИХ                                    */
        /* ============================================================== */

        /// <summary>Ribbon-ы бичээст очих тоо.  ⚠️ `NoPack` үнэн бол УТГАГҮЙ.</summary>
        public static int BadgeCount { get { return _badge; } }
        private static volatile int _badge;

        /// <summary>
        /// «Энэ багт дүрмийн багц хараахан бэлэн болоогүй».
        ///
        /// ⚠️ Энэ нь `TEAM = UNCERTAIN` (v2 §48) БИШ — баг нь ТОДОРХОЙ, зөвхөн
        /// тулгах дүрэм нь бичигдээгүй (§3.6-ийн ШАТ 0).  Хэрэглэгчээс ЮУ Ч
        /// шаардахгүй; UI нь тоо биш ЭНЭ бичвэрийг харуулна.
        /// </summary>
        public static bool NoPack { get { return _noPack; } }
        private static volatile bool _noPack = true;

        public static string LastCoverage { get { return _coverage; } }
        private static volatile string _coverage = "full";

        public static long PassCount { get { return Interlocked.Read(ref _passes); } }
        private static long _passes;

        public static long SkippedPasses { get { return Interlocked.Read(ref _skips); } }
        private static long _skips;

        public static long DroppedSets { get { return Interlocked.Read(ref _droppedSets); } }
        private static long _droppedSets;

        /// <summary>
        /// Олдвор ИЛГЭЭХ гарц — `POST /api/compliance/findings`-ийн байрлагч.
        ///
        /// ⚠️ NULL БАЙЖ БОЛНО, ба РЕЛИЗ N-д null ХЭВЭЭР: `0224` / `0225` ба
        /// тэдгээрийн маршрут нь `2-3`-ын СЕРВЕР талын ажил бөгөөд тусад нь
        /// шипнэ.  Sink байхгүй үед хөдөлгүүр БҮРЭН ажиллаж, олдвор нь санах
        /// ойд (+ дискний толин тусгалд) амьдарч, ribbon-ы тоо зөв гарна —
        /// зөвхөн сервер рүү ЯВАХГҮЙ.  ЭНЭ НЬ ЗОРИУД: байхгүй маршрут руу
        /// POST хийх нь ажилтны машинд 404-ийн шуурга үүсгэнэ.
        ///
        /// ⚠️ Sink нь АРЫН урсгал дээр дуудагдана ба ХЭЗЭЭ Ч БЛОКЛОХ ЁСГҮЙ.
        /// </summary>
#pragma warning disable CS0649 // Сервер тал (`0224`/`0225` + маршрут) оноодог; энэ релизэд оноогч БАЙХГҮЙ.
        internal static Action<IList<EmittedFinding>, string> FindingSink;
#pragma warning restore CS0649

        /// <summary>
        /// §58-ын хуучруулалтыг сервер рүү хүргэх гарц
        /// (`POST /api/compliance/findings/stale`).  Мөн адил null байж болно.
        /// Аргументууд: docKey, reason, dedup_keys (null = ТЭР БАРИМТЫН БҮГД).
        /// </summary>
#pragma warning disable CS0649 // Мөн адил — `POST /findings/stale` шипмэгц оноогдоно.
        internal static Action<string, string, IList<string>> StaleSink;
#pragma warning restore CS0649

        /* ============================================================== */
        /*  САМБАРЫН ГАДАРГУУ (F5)                                        */
        /* ============================================================== */

        /// <summary>
        /// ОЛДВОРЫГ САМБАРТ ХҮРГЭХ гарц.  `AssistantPane` өөрийн байгуулагч
        /// дээр суулгана (`AttachSurfaceSink`).
        ///
        /// ⚠️ `FindingSink`-ЭЭС ТУСДАА, ЗОРИУД.  `FindingSink` нь ДЕЛЬТА
        ///    (`EmittedFinding` — «энэ мөчлөгт ЮУ ӨӨРЧЛӨГДӨВ») бөгөөд
        ///    `POST /api/compliance/findings`-ийн оролт.  Самбарт хэрэгтэй нь
        ///    ОДООГИЙН БҮТЭН ГАДАРГУУ («яг одоо юу нээлттэй байна») — хоёр
        ///    огт өөр асуулт.  Дельтагаар жагсаалт барих гэвэл самбар нь
        ///    хөдөлгүүрийн амьдралын мөчлөгийг ХОЁР ДАХЬ удаа хэрэгжүүлэхэд
        ///    хүрнэ.
        ///
        /// ⚠️ Аргументууд: (гадаргуу, coverage, бүтэн скан баталгаажсан эсэх).
        ///    Гуравдахь нь ХАМГИЙН ЧУХАЛ: ЗӨВХӨН тэр үнэн байхад л самбар
        ///    «шалгаад цэвэр гарлаа» гэж бичих эрхтэй.  Өсөлтөт мөчлөг нь
        ///    ЗАССАН элементийг Л шалгадаг.
        ///
        /// ⚠️ АРЫН УРСГАЛААС дуудагдана ба ХЭЗЭЭ Ч БЛОКЛОХ ЁСГҮЙ.
        ///    Дуудагдах мөчид `ChangeTracker.Gate` БАРЬСАН БАЙХГҮЙ
        ///    (`TryCall`/`CollectViaSource` нь `RunPass` дотор дуусдаг), гэвч
        ///    хүлээн авагч нь ҮҮНД НАЙДАХ ЁСГҮЙ: `Dispatcher.InvokeAsync`
        ///    (СИНХРОН `Invoke` БИШ) -ээр л UI руу гарна.
        /// </summary>
        internal static Action<IList<FindingFeed.Item>, string, bool> SurfaceSink;

        /// <summary>Самбарын гадаргуу хүргэгддэг эсэх — `FindingFeed.StateOf`-ийн оролт.</summary>
        public static bool SurfaceWired { get { return SurfaceSink != null; } }

        /// <summary>
        /// dedup_key → АМЬД мөр.  ⚠️ `EmittedFinding.Row` нь `ComplianceState._live`
        /// дэх ЯГ ТЭР ОБЪЕКТЫН ЛИНК тул `MarkStale`-ийн `StaleAt`, `Apply`-ийн
        /// `LifecycleState` шинэчлэлт энд АВТОМАТААР харагдана — хоёр дахь
        /// хуулбар барихгүй.
        ///
        /// ⚠️ ЗӨВХӨН АЖИЛЧИН УРСГАЛААС хүрнэ (`ComplianceState`-ийн яг ижил
        /// дүрэм).  Гадагш гарах цорын ганц зүйл нь `SnapshotSurface`-ийн
        /// ХӨЛДӨӨСӨН хуулбар.
        /// </summary>
        private static readonly Dictionary<string, FindingRow> _surface =
            new Dictionary<string, FindingRow>(StringComparer.Ordinal);

        /// <summary>⚠️ ХЯЗГААР — чимээгүй санах ойн өсөлт БАЙХГҮЙ.</summary>
        private const int MaxSurfaceMirror = 5000;

        // ⚠️ `volatile` — `_surfacePublished` нь `AttachSurfaceSink`-ээс (UI
        //    урсгал) ба `PublishSurface`-ээс (ажилчин) ХОЁУЛАНГААС бичигдэнэ.
        private static volatile bool _surfaceDirty;
        private static volatile bool _surfacePublished;

        /// <summary>
        /// Сүүлд ХЭВЛЭСЭН баримт.  ⚠️ Баримт солигдоход гадаргуу «бохирдоогүй»
        /// байж болох ч самбарт БУРУУ файлын жагсаалт үлдэнэ — тиймээс
        /// давхардлын шүүлт нь баримтын түлхүүрийг ЗААВАЛ багтаана.
        /// </summary>
        private static string _publishedDocKey;

        /// <summary>
        /// БҮТЭН СКАН нь БҮРЭН хамрах хүрээтэй дууссан баримт.  null = байхгүй.
        ///
        /// ⚠️ ЭНЭ НЬ «цэвэр» гэж бичих ЭРХИЙН ЦОРЫН ГАНЦ ҮНДЭС.  Өсөлтөт
        /// мөчлөг нь өөрчлөгдсөн элементийг Л шалгадаг тул түүнээс «загварт
        /// зөрчил алга» гэсэн дүгнэлт гаргах нь ЧИМЭЭГҮЙ ТЭНЦЭЛ.
        /// </summary>
        private static volatile string _checkedDocKey;

        /* ============================================================== */
        /*  ЭХЛЭЛ / ЗОГСОЛТ                                                */
        /* ============================================================== */

        /// <summary>
        /// `App.OnStartup`-аас, `BimEmitter.Start()` ба `ChangeTracker.Init()`
        /// -ийн ДАРАА.  ⚠️ ХЭЗЭЭ Ч алдаа шидэхгүй.
        /// </summary>
        public static void Init(IRuleInputSource source, CancellationToken ct)
        {
            if (source == null) return;
            if (Interlocked.CompareExchange(ref _started, 1, 0) != 0) return;
            try
            {
                _source = source;
                _ct = ct;

                // ⚠️ 2-4-ийн дэгээ.  Дэгээ нь `BimEmitter._pump` урсгал дээр
                //    дуудагдана — ТЭНД АЖИЛ ХИЙХГҮЙ.  Тэр урсгал нь `RawRing`
                //    -ийг шавхдаг ба хоёр секунд блоклогдвол цагираг дүүрч
                //    гүйлгээ ХАЯГДАНА (`_droppedRing`).  Иймд дэгээ нь зөвхөн
                //    дараалалд хийж, сэрээнэ.
                BimEmitter.ComplianceHook = OnChangeSet;

                _worker = new Thread(WorkerLoop);
                _worker.IsBackground = true;   // ⚠️ гацсан ч процессыг БАРИХГҮЙ
                _worker.Name = "MglComplianceScheduler";
                _worker.Start();
            }
            catch
            {
                // Урсгал үүсээгүй — add-in бүхэлдээ ХЭВИЙН ажиллана, зөвхөн
                // нийцлийн шалгалт хийгдэхгүй.
            }
        }

        /// <summary>
        /// §3.14 №2 — ШӨНИЙН БАГЦЫН ХОСТОД ТЭГ АЖИЛ.
        ///
        /// ⚠️ `BatchQto` нь 50 файлыг detached нээж, өөр хүмүүсийн
        /// байрлуулалтаас баг тодорхойлж, `Process.Kill()`-ээр төгсдөг.  Тэнд
        /// нийцэл ажиллуулах нь мянга мянган ХАРЬЯАЛЛЫН ХУВЬД БУРУУ олдвор
        /// үйлдвэрлэнэ.
        /// </summary>
        public static void Disable()
        {
            _disabled = true;
            try { BimEmitter.ComplianceHook = null; } catch { }
            LogicalChangeSet ignored;
            while (_queue.TryDequeue(out ignored)) { }
            // ⚠️ Ажилчныг СЭРЭЭНЭ — эс бөгөөс тэр `IdleWaitMs` дуустал
            //    унтсаар байх ба багцын хост тэр хугацаанд дуусч болно.
            try { _wake.Release(); } catch { }
        }

        /// <summary>
        /// УНТРААЛТ — ЗӨВХӨН ДОХИО, ХҮЛЭЭХГҮЙ.
        ///
        /// ⚠️ Цуцлалтын токен нь `App.ComplianceCts` бөгөөд `OnShutdown`-ийн
        /// АЛХАМ 0-д `Cancel()` хийгддэг.  Энд `Join` хийвэл Revit-ийн
        /// хаагдалт хэрэгслийн БҮТЭН deadline хүлээж гацна.
        /// </summary>
        public static void Cancel()
        {
            _disabled = true;
            try { BimEmitter.ComplianceHook = null; } catch { }
            try { _wake.Release(); } catch { }
        }

        /// <summary>ХЯЗГААРТАЙ хүлээлт.  Урсгал нь `IsBackground` тул гацсан ч аюулгүй.</summary>
        public static void Join(int ms)
        {
            Thread t = _worker;
            if (t == null) return;
            try { t.Join(Math.Max(0, ms)); } catch { }
        }

        /// <summary>
        /// §3.11 — БҮТЭН СКАН хүсэх (гох №1: хэрэглэгч товч дарав).
        ///
        /// ⚠️ Pack байхгүй бол ЭНЭ Ч NO-OP: ШАТ 0-ийн хаалтыг дамжина.  Товч
        /// нь алга болохгүй — UI нь `NoPack` уншаад «дүрмийн багц бэлэн
        /// болоогүй» гэж ХЭЛНЭ; чимээгүй юу ч болохгүй байх нь эвдэрсэн мэт
        /// харагдана.
        /// </summary>
        public static bool RequestFullScan(string docKey)
        {
            if (_disabled) return false;
            if (!string.IsNullOrEmpty(docKey)) _lastDocKey = docKey;
            if (string.IsNullOrEmpty(_lastDocKey)) return false;
            Interlocked.Exchange(ref _fullScanRequested, 1);
            try { _wake.Release(); } catch { }
            return true;
        }

        /// <summary>
        /// §58-ын гох №1 — `sync` / `reload latest` ДУУССАН.
        ///
        /// ⚠️ ЯАГААД ЗААВАЛ ВЭ: `OnDocumentChanged` нь `Suppressed` цонхонд
        /// ЭРТ БУЦДАГ (`ChangeTracker.cs:801`) тул БУСАД БАГИЙН өөрчлөлт
        /// бохирдсон олонлогт ХЭЗЭЭ Ч ОРОХГҮЙ.  Энэ дохиогүйгээр BA нь BB-ийн
        /// аль хэдийн зассан хонгил дээр `VIOLATION`-ыг, эсвэл бүр аюултай нь
        /// — BB-ийн дөнгөж эвдсэн хонгил дээр `PASS`-ыг харсаар байна.
        ///
        /// ⚠️ ДУУДАГЧ ХЭРЭГТЭЙ (§9.5 №16).  `Suppressed.Add`/`Remove` нь
        /// `ChangeTracker.cs:622/:633/:715`-д ба тэр файл нь `2-4`-ийн харьяа;
        /// одоогийн `LogicalChangeSet` дээр ийм туг БАЙХГҮЙ.  Тиймээс энэ нь
        /// НЭЭЛТТЭЙ, ил цэг — `2-4` дохиогоо өгмөгц НЭГ мөр залгана.
        /// </summary>
        public static void NotifySyncFinished(string docKey)
        {
            if (string.IsNullOrEmpty(docKey)) return;
            _pendingSync.Enqueue(docKey);
            try { _wake.Release(); } catch { }
        }

        private static readonly ConcurrentQueue<string> _pendingSync = new ConcurrentQueue<string>();

        /* ============================================================== */
        /*  2-4-ИЙН ДЭГЭЭ — ЗӨВХӨН ДАРААЛАЛД ХИЙНЭ                        */
        /* ============================================================== */

        private static void OnChangeSet(LogicalChangeSet set)
        {
            if (set == null || _disabled) return;
            _lastDocKey = set.DocKey;
            if (_queue.Count >= MaxQueued)
            {
                // ⚠️ ЧИМЭЭГҮЙ АЛДАГДАЛ БАЙХГҮЙ: тоолуур нь ил бөгөөд
                //    `coverage` нь дараагийн мөчлөгт `partial` болно.
                Interlocked.Increment(ref _droppedSets);
                _coverage = "partial";
                return;
            }
            _queue.Enqueue(set);
            try { _wake.Release(); } catch { }
        }

        /* ============================================================== */
        /*  АЖИЛЧИН УРСГАЛ                                                 */
        /* ============================================================== */

        private static void WorkerLoop()
        {
            while (true)
            {
                try
                {
                    if (_disabled || _ct.IsCancellationRequested) return;

                    // ⚠️ ХЯЗГААРТАЙ УНТРАЛТ, БУСЫ МӨЧЛӨГ БИШ.  Дүрэм байхгүй
                    //    үед (релиз N-ийн ӨГӨГДМӨЛ) энэ урсгал ЭНД унтаж,
                    //    сэрэх бүрдээ ШАТ 0 дээр шууд буцна — CPU-гийн зардал
                    //    хэмжигдэхгүй.
                    try { _wake.Wait(IdleWaitMs, _ct); }
                    catch (OperationCanceledException) { return; }
                    catch { }

                    if (_disabled || _ct.IsCancellationRequested) return;

                    DrainSyncSignals();

                    LogicalChangeSet set;
                    while (_queue.TryDequeue(out set))
                    {
                        if (_disabled || _ct.IsCancellationRequested) return;
                        RunOne(set, false);
                    }

                    if (Interlocked.Exchange(ref _fullScanRequested, 0) == 1)
                    {
                        RunFullScan(_lastDocKey);
                    }

                    // ⚠️ F5 — САМБАР ХОЖИМ НЭЭГДЭХ ЗАМ.  `AttachSurfaceSink`
                    //    нь ажилчны эргэлтийн ДУНД дуудагдаж болно; тэр үед
                    //    дараалал ХООСОН байвал дээрх мөрүүд юу ч хэвлэхгүй ба
                    //    самбар «хараахан ажиллаагүй» гэж мөнхөд бичнэ.
                    //    Хэвлэлт нь өөрөө давхардлыг шүүдэг тул энэ дуудлага
                    //    IdleWaitMs тутамд ЗАРДАЛГҮЙ.
                    PublishSurface(_lastDocKey, _noPack);
                }
                catch (OperationCanceledException) { return; }
                catch
                {
                    // Мөчлөг ХЭЗЭЭ Ч унах ёсгүй — дараагийн эргэлтэд үргэлжилнэ.
                    try { Thread.Sleep(250); } catch { }
                }
            }
        }

        private static void DrainSyncSignals()
        {
            string docKey;
            while (_pendingSync.TryDequeue(out docKey))
            {
                if (string.IsNullOrEmpty(docKey)) continue;
                // ⚠️ ТЭР БАРИМТЫН БҮГД — `dedup_keys` ҮГҮЙ (§3.10-ийн гох №1).
                //    Хэн юуг зассаныг МЭДЭХГҮЙ тул сонгож хуучруулах нь ХУДАЛ
                //    нарийвчлал болно.
                string key = docKey;
                int n = _state.MarkStale(
                    delegate (FindingRow r) { return string.Equals(r.DocKey, key, StringComparison.Ordinal); },
                    "sync", null);
                DropResolveCache(key);
                _badge = _state.OpenCount();

                // ⚠️ ӨӨР ХҮНИЙ ӨӨРЧЛӨЛТ ИРЛЭЭ — бидний БҮТЭН СКАН нь тэднийг
                //    ХЭЗЭЭ Ч харж байгаагүй.  «Цэвэр» гэж бичих эрх ТЭР ДАРУЙ
                //    унана; эс бөгөөс BB-ийн дөнгөж эвдсэн хонгил дээр самбар
                //    «анхаарах зүйл алга» гэж бичнэ.
                if (string.Equals(_checkedDocKey, key, StringComparison.Ordinal)) _checkedDocKey = null;
                if (n > 0) _surfaceDirty = true;
                PublishSurface(key, _noPack);

                if (n > 0)
                {
                    Action<string, string, IList<string>> sink = StaleSink;
                    if (sink != null) { try { sink(key, "sync", null); } catch { } }
                    try { _state.SaveMirror(key); } catch { }
                }
            }
        }

        private static void RunOne(LogicalChangeSet set, bool fullScan)
        {
            if (set == null || string.IsNullOrEmpty(set.DocKey)) return;

            RuleTriggerIndex index = IndexFor();
            PassResult result = RunPass(set, index, _state, _source, fullScan);

            Interlocked.Increment(ref _passes);
            if (result.Skipped) Interlocked.Increment(ref _skips);

            _noPack = result.NoPack;
            _coverage = result.Coverage;
            if (!result.NoPack) _badge = result.BadgeCount;

            if (result.Emitted.Count > 0)
            {
                Action<IList<EmittedFinding>, string> sink = FindingSink;
                if (sink != null)
                {
                    try { sink(result.Emitted, result.Coverage); } catch { }
                }
                try { _state.SaveMirror(set.DocKey); } catch { }
            }

            // ── F5.  САМБАРЫН ГАДАРГУУ ────────────────────────────────
            // ⚠️ `Emitted.Count > 0`-ЫН ДОТОР БИШ.  Дельта хоосон байх нь
            //    «харуулах юм алга» ГЭСЭН ҮГ БИШ — өмнөх мөчлөгүүдийн
            //    нээлттэй олдворууд хэвээрээ байна, ба ТЭР ЛЭ самбарын
            //    жагсаалт.  Дельтаны дотор байрлуулсан нь F5-ийн эх шалтгаан
            //    байсан.
            AbsorbSurface(result);

            // Бүтэн скан БҮРЭН хамрах хүрээтэй дуусвал Л «цэвэр» гэж бичих
            // эрх төрнө; хамрах хүрээ таслагдвал тэр эрх ТЭР ДАРУЙ УНАНА.
            //
            // ⚠️ `Evaluations > 0` НЬ ЗААВАЛ.  `RunPass` нь ЭРТ буцах ЗУРГААН
            //    зам ({`ids.Length == 0`, `dirty.Count == 0`, `work.Count == 0`,
            //    …}) -тай бөгөөд тэдгээр нь `Coverage = "full"`-ыг ХЭВЭЭР
            //    үлдээдэг.  Тэднийг «бүтэн шалгав» гэж тоовол НЭГ Ч дүрэм
            //    ажиллаагүй байхад самбар «цэвэр» гэж бичнэ — эзний Ш4-ийн
            //    хатуу хориотой зүйл.
            if (fullScan && !result.Skipped && !result.NoPack && result.Evaluations > 0 &&
                string.Equals(result.Coverage, "full", StringComparison.Ordinal))
            {
                _checkedDocKey = set.DocKey;
            }
            else if (!string.Equals(result.Coverage, "full", StringComparison.Ordinal) &&
                     string.Equals(_checkedDocKey, set.DocKey, StringComparison.Ordinal))
            {
                _checkedDocKey = null;
            }

            PublishSurface(set.DocKey, result.NoPack);
        }

        /* ============================================================== */
        /*  F5 — ГАДАРГУУГ БҮРДҮҮЛЖ САМБАРТ ХҮРГЭХ                        */
        /* ============================================================== */

        /// <summary>
        /// Самбар бэлэн болмогц дуудна.  ⚠️ Дуудагдмагц ХЭВЛЭХГҮЙ: ажилчин
        /// урсгал л `_surface`-т хүрч болно (ComplianceState-ийн ижил дүрэм).
        /// Тиймээс зөвхөн ТУГ тавиад урсгалыг СЭРЭЭНЭ.
        ///
        /// ⚠️ БҮТЭН СКАН ХҮСЭХГҮЙ.  Самбар нээх нь дүрэм ажиллуулах шалтгаан
        ///    биш — тэр нь `RequestFullScan`-ийн ил товч.
        /// </summary>
        public static void AttachSurfaceSink(Action<IList<FindingFeed.Item>, string, bool> sink)
        {
            SurfaceSink = sink;
            if (sink == null) return;
            _surfacePublished = false;   // шинэ хүлээн авагч — дахин хүргэнэ
            try { _wake.Release(); } catch { }
        }

        /// <summary>
        /// Мөчлөгийн дельтаг гадаргууд шингээнэ.
        ///
        /// ⚠️ ЗАСАГДСАН (`Fixed`) мөрийг ЭНД ХАЯХГҮЙ — тэр мөр `REOPENED`
        ///    болж эргэж ирж болно ба тэр үед ЯГ ТЭР ОБЪЕКТ шинэчлэгдэнэ.
        ///    Шүүлтийг `SnapshotSurface` хийнэ.
        /// </summary>
        private static void AbsorbSurface(PassResult result)
        {
            if (result == null) return;
            for (int i = 0; i < result.Emitted.Count; i++)
            {
                EmittedFinding e = result.Emitted[i];
                FindingRow row = e == null ? null : e.Row;
                if (row == null || string.IsNullOrEmpty(row.DedupKey)) continue;
                if (!_surface.ContainsKey(row.DedupKey) && _surface.Count >= MaxSurfaceMirror) continue;
                _surface[row.DedupKey] = row;
                _surfaceDirty = true;
            }
            // Хуучруулалт нь дельта үүсгэдэггүй ч ХАРАГДАЦЫГ өөрчилнө.
            if (result.StaledEdit > 0) _surfaceDirty = true;
        }

        /// <summary>
        /// Гадаргууг ХӨЛДӨӨСӨН `FindingFeed.Item`-ийн жагсаалт болгоно.
        ///
        /// ⚠️ ЯАГААД ХУУЛБАР ВЭ: `FindingRow` нь ажилчин урсгалын мутацлагдах
        ///    объект.  Түүнийг UI урсгал руу шууд өгвөл `Apply` бичиж байхад
        ///    WPF уншина.  `Item` нь ЭНЭ урсгал дээр бүтээгдэж, дараа нь
        ///    ХЭЗЭЭ Ч засагдахгүй.
        ///
        /// ⚠️ ХУУЧИРСАН мөрийг ОРУУЛНА (`IsStale = true`).  Ribbon-ы тоо
        ///    (`OpenCount`) тэднийг ТООЛОХГҮЙ — тэр нь ганц ТОО бөгөөд
        ///    тайлбарлах боломжгүй; самбар нь «дахин шалгах шаардлагатай» гэж
        ///    ИЛ бичиж чадна.  Хоёрын зөрүү нь ЗОРИУД.
        ///
        /// ⚠️ ЭШЛЭЛ: `SuppressCitation` үнэн бол `CitationMn` нь ЗААВАЛ null.
        ///    Клиент ХЭЗЭЭ Ч өөрөө заалт зохиохгүй — зөвхөн дүрмийн өөрийн
        ///    эшлэлийг, хавчаар зөвшөөрсөн үед дамжуулна.
        /// </summary>
        private static List<FindingFeed.Item> SnapshotSurface(string docKey)
        {
            var outp = new List<FindingFeed.Item>(_surface.Count);
            RuleTriggerIndex ix = _index;
            foreach (FindingRow r in _surface.Values)
            {
                if (r == null) continue;
                if (!string.Equals(r.DocKey, docKey, StringComparison.Ordinal)) continue;
                if (r.LifecycleState != LifecycleState.Open &&
                    r.LifecycleState != LifecycleState.Reopened) continue;

                RuleDef rule = ix == null ? null : ix.ByUid(r.RuleUid);
                var it = new FindingFeed.Item
                {
                    DedupKey = r.DedupKey,
                    // ⚠️ 0 = СЕРВЕР ДЭЭР БАЙХГҮЙ.  `POST /api/compliance/findings`
                    //    хараахан шипээгүй тул «Хүчингүй болгох» товч НУУГДАНА.
                    ServerId = 0,
                    ElementId = r.ElementId,
                    Verdict = r.Verdict,
                    Severity = r.Severity,
                    IssueClass = r.IssueClass,
                    EvidenceLevel = r.EvidenceLevel,
                    TitleMn = rule == null ? null : rule.TitleMn,
                    TitleEn = rule == null ? null : rule.TitleEn,
                    RecommendationMn = rule == null ? null : rule.RecommendationMn,
                    RecommendationEn = null,
                    CitationMn = r.SuppressCitation ? null : CitationOf(rule),
                    DetectedAtSec = UnixOf(r.LastEvaluatedAt),
                    IsStale = r.StaleAt != null,
                    // ⚠️ ЛОКАЛ ХӨДӨЛГҮҮР `finding_edges` БҮТЭЭДЭГГҮЙ — §77-ийн
                    //    үндэс↔дагаврын граф нь СЕРВЕРИЙН ажил.  Тиймээс
                    //    БҮХ мөр өөрөө үндэс: сүлжээгүйгээр учир шалтгааны
                    //    холбоо ЗОХИОХ нь худал нарийвчлал.
                    RootDedupKey = null,
                    RootMissing = false,
                };
                outp.Add(it);
            }
            return outp;
        }

        /// <summary>Дүрмийн ӨӨРИЙН эшлэл — клиент ЮУ Ч ЗОХИОХГҮЙ.</summary>
        private static string CitationOf(RuleDef rule)
        {
            if (rule == null) return null;
            string clause = rule.ClauseUid;
            string doc = rule.DocumentUid;
            if (string.IsNullOrEmpty(clause) && string.IsNullOrEmpty(doc)) return null;
            if (string.IsNullOrEmpty(clause)) return doc;
            if (string.IsNullOrEmpty(doc)) return clause;
            return doc + " " + clause;
        }

        private static long UnixOf(string iso)
        {
            DateTime dt;
            if (!DateTime.TryParse(iso, CultureInfo.InvariantCulture,
                                   DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal,
                                   out dt)) return 0;
            return (long)(dt - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalSeconds;
        }

        /// <summary>
        /// ⚠️ `noPack` үед ХЭЗЭЭ Ч ХЭВЛЭХГҮЙ.  Хоосон гадаргуу илгээвэл самбар
        ///    түүнийг «шалгаад юу ч олдсонгүй» гэж уншина — F5-ийн яг тэр
        ///    чимээгүй тэнцэл.  Багцгүй үед самбар `NoPack`-ийг өөрөө
        ///    уншиж бичнэ.
        /// </summary>
        private static void PublishSurface(string docKey, bool noPack)
        {
            Action<IList<FindingFeed.Item>, string, bool> sink = SurfaceSink;
            if (sink == null || noPack || string.IsNullOrEmpty(docKey)) return;
            if (_surfacePublished && !_surfaceDirty &&
                string.Equals(_publishedDocKey, docKey, StringComparison.Ordinal)) return;

            List<FindingFeed.Item> items = SnapshotSurface(docKey);
            bool whole = string.Equals(_checkedDocKey, docKey, StringComparison.Ordinal);
            _surfaceDirty = false;
            _surfacePublished = true;
            _publishedDocKey = docKey;
            try { sink(items, _coverage, whole); } catch { }
        }

        private static void RunFullScan(string docKey)
        {
            if (string.IsNullOrEmpty(docKey) || _source == null) return;

            // ⚠️ ШАТ 0-ийн хаалтыг БҮТЭН СКАН Ч ДАМЖИНА.  Pack байхгүй бол
            //    «Нийцлийг бүрэн шалгах» товч ч ТЭГ дүрэм ажиллуулна — өөр
            //    багийн pack руу ХЭЗЭЭ Ч ШИЛЖИХГҮЙ.
            RuleTriggerIndex index = IndexFor();
            if (index == null || index.IsEmpty)
            {
                _noPack = true;
                return;
            }

            bool truncated;
            long[] ids;
            try { ids = _source.FullScanIds(docKey, out truncated); }
            catch { return; }
            if (ids == null) return;

            LogicalChangeSet synthetic = new LogicalChangeSet
            {
                DocKey = docKey,
                ElementIds = ids,
                CloseReason = "fullscan",
                MayCollect = true,
                Coarse = truncated,
                UndoBurst = 0,
                TxnCount = 0,
            };
            RunOne(synthetic, true);
        }

        /// <summary>
        /// Багцыг НЭГ УДАА ачаалж индекс барина.
        ///
        /// ⚠️ PACK БАЙХГҮЙ ҮЕД ДАВТАН ТАТАХГҮЙ.  Хоосон индексийг Ч кэшлэнэ:
        /// эс бөгөөс релиз N (дүрэм ТЭГ) дээр мөчлөг тутам диск уншиж,
        /// JSON задалж, sha256 тооцно — «pack байхгүй бол хямд сул зогсолт»
        /// гэсэн шаардлагын шууд зөрчил.
        ///
        /// ⚠️ Кэш нь БАГИЙН КОДООР хүчингүй болно.  `TeamContext.Current` нь
        /// арын асуулгаар солигдож болох ба тэр үед ӨӨР pack хэрэгтэй.
        /// </summary>
        private static RuleTriggerIndex IndexFor()
        {
            string team = null;
            try
            {
                TeamContext.State st = TeamContext.Current;
                if (st != null) team = st.TeamCode;
            }
            catch { }

            string key = team ?? "";
            if (_index != null && string.Equals(_indexTeam, key, StringComparison.Ordinal))
            {
                // Багц бий — ДАХИН УНШИХГҮЙ.  Хоосон бол ХОВОР давтана
                // (сервер багц нийтэлмэгц Revit дахин асаахгүйгээр идэвхжинэ).
                if (!_index.IsEmpty) return _index;
                if (unchecked(Environment.TickCount - _indexBuiltTick) < EmptyPackRecheckMs)
                {
                    return _index;
                }
            }

            RulePack.Loaded pack = null;
            // ⚠️ Баг нь ТОДОРХОЙГҮЙ (`team_code = null`, 2-1 §3.4) бол ЯМАР Ч
            //    pack ачаалахгүй.  «Мэдэхгүй» үед өгөгдмөл сонгох нь
            //    цахилгаанчинд архитектурын дүрмээр `VIOLATION` гаргах ЭХНИЙ
            //    алхам.
            if (!string.IsNullOrEmpty(team))
            {
                try { pack = RulePack.Load(team); }
                catch { pack = null; }

                // ⚠️ ӨӨР БАГИЙН pack-ыг ХҮЛЭЭЖ АВАХГҮЙ.  `RulePack.Load` нь
                //    диск дээр таарах файл олдохгүй бол ШИГТГЭЭСТЭЙ canary
                //    руу унадаг ба тэр нь `team_code = ""` — түүнийг энэ
                //    багийнх гэж дүр эсгэвэл §46-ийн хилийг ЧИМЭЭГҮЙ давна.
                if (pack != null && !string.IsNullOrEmpty(pack.TeamCode) &&
                    !string.Equals(pack.TeamCode, team, StringComparison.Ordinal))
                {
                    pack = null;
                }
            }

            RuleTriggerIndex ix = RuleTriggerIndex.Build(pack);
            ComplianceState.PackStamp stamp = new ComplianceState.PackStamp
            {
                RulesetVersion = ix.RulesetVersion,
                PackSha256 = ix.PackSha256,
                TeamCode = team,
                TeamSource = SafeTeamSource(),
            };

            // §3.11-ийн гох №2 — `ruleset_version` солигдов ⇒ бүтэн скан.
            // ⚠️ Pack ОРШИН БАЙХЫГ шаардана: pack-гүй багт ГАЛЛАХ ЁСГҮЙ.
            if (_stamp != null && !ix.IsEmpty &&
                !string.Equals(_stamp.RulesetVersion, ix.RulesetVersion, StringComparison.Ordinal))
            {
                Interlocked.Exchange(ref _fullScanRequested, 1);
                // ⚠️ ШИНЭ БАГЦ ⇒ ХУУЧИН БҮТЭН СКАН ХҮЧИНГҮЙ.  Шинэ дүрмүүд
                //    хараахан НЭГ Ч элемент дээр ажиллаагүй байхад «цэвэр»
                //    гэж бичих нь F5-ийн чимээгүй тэнцлийн ХАМГИЙН
                //    магадлалтай хувилбар: багц ирсэн ЯГ ТЭР мөчид самбар
                //    «анхаарах зүйл алга» гэж хэлнэ.
                _checkedDocKey = null;
                _surfaceDirty = true;
            }

            _index = ix;
            _indexTeam = key;
            _indexBuiltTick = Environment.TickCount;
            _stamp = stamp;
            return ix;
        }

        private static string SafeTeamSource()
        {
            try
            {
                TeamContext.State st = TeamContext.Current;
                return st != null ? st.Source : null;
            }
            catch { return null; }
        }

        /* ============================================================== */
        /*  §3.6 — НЭГ ӨСӨЛТӨТ МӨЧЛӨГ                                     */
        /* ============================================================== */

        /// <summary>
        /// ⚠️ ЦЭВЭР(-хэн).  `IRuleInputSource`-оос өөр гадаад ертөнцгүй тул
        /// хуурамч эх сурвалж өгөөд Revit-гүйгээр тестлэгдэнэ.
        /// </summary>
        internal static PassResult RunPass(LogicalChangeSet set, RuleTriggerIndex index,
                                           ComplianceState state, IRuleInputSource src,
                                           bool fullScan)
        {
            PassResult result = new PassResult();
            if (state == null) return result;

            // ── ШАТ 0.  PACK БАЙХГҮЙ БАГ → ТЭГ ДҮРЭМ ──────────────────
            // v2 §46-ийн найман дисциплин Л pack авна (MGMT / EZ / GT авахгүй)
            // ба тэдгээр нь BA-гаас эхлэн ЭЭЛЖЛЭН бичигдэнэ.  Индекс хоосон
            // бол ЯМАР Ч дүрэм ажиллуулахгүй: ӨӨР БАГИЙН pack, «компани
            // даяарын» нэгтгэсэн pack, эсвэл BA-г ӨГӨГДМӨЛ болгох нь ГУРВУУЛАА
            // ХОРИОТОЙ.  Бүртгэл ХООСОН явна — `rule_run_ledger`-т тэр багийн
            // мөр байхгүй нь «энэ багт pack БАЙХГҮЙ» гэдгийг §69-д ил гаргах
            // дохио.  `NoPack` нь тоо БИШ, «дүрмийн багц бэлэн болоогүй».
            if (index == null || index.IsEmpty) { result.NoPack = true; return result; }
            if (src == null) { result.Skipped = true; return result; }

            // ⚠️ ҮЕИЙН ТООЛУУР нь ШАТ 0-ийн ДАРАА нэмэгдэнэ.  Ажиллаагүй скан
            //    үеийг зарцуулбал «энэ мөр аль сканд төрөв» гэсэн §56-ийн
            //    хариулт нь юу ч хийгээгүй хэдэн мянган мөчлөгөөр шингэрнэ.
            result.ScanGeneration = state.NextScanGeneration();

            // ── UNDO-ИЙН ТЭСРЭЛТ ──────────────────────────────────────
            // ⚠️ `undo:` угтвар байх зуур дахин үнэлгээ ХОЙШЛОГДОНО; тэсрэлт
            //    тогтворжсоны дараа НЭГ УДАА үнэлнэ.  Үгүй бол дөчин Ctrl+Z
            //    нь дөчин дахин үнэлгээ, дөчин POST болно (§3.10-ийн доод
            //    тэмдэглэл).  Элементүүд АЛДАГДАХГҮЙ — хойшлуулалтад орно.
            if (!fullScan && set.UndoBurst > 0)
            {
                state.CarryOver(set.DocKey, set.ElementIds, 0);
                result.Coverage = "partial";
                result.BadgeCount = state.OpenCount();
                return result;
            }

            // ── ШАТ 3.  НӨЛӨӨЛСӨН ЭЛЕМЕНТ ─────────────────────────────
            long[] ids = Merge(state.DrainCarry(set.DocKey), set.ElementIds);
            if (ids.Length == 0) { result.BadgeCount = state.OpenCount(); return result; }

            if (ids.Length > MaxDirtyPerPass)
            {
                state.CarryOver(set.DocKey, ids, MaxDirtyPerPass);
                Array.Resize(ref ids, MaxDirtyPerPass);
                result.Coverage = "partial";      // §56-ийн «дутуу шалгасан»
            }
            // Коалесцер id-г ТАЙРСАН бол ҮНЭН нь МЭДЭГДЭХГҮЙ.
            if (set.Coarse) result.Coverage = "partial";

            // ── ШАТ 3б.  id → (uid, категори).  КЭШЭЭС ЭХЭЛНЭ ──────────
            List<DirtyElement> dirty = ResolveDirty(set.DocKey, ids, src, result);
            if (result.Skipped) { result.BadgeCount = state.OpenCount(); return result; }
            if (dirty.Count == 0) { result.BadgeCount = state.OpenCount(); return result; }

            // ── §58-ЫН ГОХ №2 — ХЭРЭГЛЭГЧИЙН ӨӨРИЙН ЗАСВАР ────────────
            // ⚠️ Тааруулалт нь `element_uid`-ЭЭР (ТОГТВОРТОЙ), `element_id`-
            //    ЭЭР БИШ: тойрог хийсний дараа `element_id` нь ӨӨР элемент рүү
            //    заана (`0204:104-105`).  Дараагийн `Apply` нь тэмдгийг ЭРГЭЖ
            //    АРИЛГАНА — өөрөөр хэлбэл хуучирсан гэж тэмдэглэгдэх нь зөвхөн
            //    ДАХИН ҮНЭЛЭГДЭХ ХҮРТЭЛХ цонх.
            HashSet<string> touchedUids = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < dirty.Count; i++)
            {
                if (!string.IsNullOrEmpty(dirty[i].ElementUid)) touchedUids.Add(dirty[i].ElementUid);
            }
            List<string> staled = new List<string>();
            string docKey = set.DocKey;
            result.StaledEdit = state.MarkStale(
                delegate (FindingRow r)
                {
                    return string.Equals(r.DocKey, docKey, StringComparison.Ordinal) &&
                           r.ElementUid != null && touchedUids.Contains(r.ElementUid);
                },
                "edit", staled);
            if (result.StaledEdit > 0)
            {
                Action<string, string, IList<string>> ss = StaleSink;
                if (ss != null) { try { ss(docKey, "edit", staled); } catch { } }
            }

            // ── ШАТ 4.  НӨЛӨӨЛЖ БОЛОХ ДҮРЭМ (индексийн хайлт, скан БИШ) ─
            ProjectBuildContext ctx = index.Context ?? ProjectBuildContext.Empty();
            Dictionary<string, List<RuleDef>> work =
                new Dictionary<string, List<RuleDef>>(StringComparer.Ordinal);
            Dictionary<string, DirtyElement> byUid =
                new Dictionary<string, DirtyElement>(StringComparer.Ordinal);
            List<string> order = new List<string>();

            for (int i = 0; i < dirty.Count; i++)
            {
                DirtyElement d = dirty[i];
                if (string.IsNullOrEmpty(d.ElementUid)) continue;

                IList<RuleDef> cands = index.Candidates(d.Category, d.Change);
                if (cands.Count == 0) continue;

                // ⚠️ УРЬДЧИЛСАН ШҮҮЛТИЙН ХЭСЭГЧИЛСЭН BAG.  `element.category`
                //    нь ЦОРЫН ГАНЦ мэдэгдэж буй элементийн баримт; бусад БҮГД
                //    Missing.  `RuleEngine.MayApply` нь МОНОТОН тул `Unknown`
                //    -ыг `true` гэж уншина — «Unknown → false» гэж бичих нь
                //    Хавсралт §4.5-ийн «ХАМГИЙН ХОР ХӨНӨӨЛТЭЙ АЛДАА».
                FactBag partial = new FactBag(ctx, null, null, d.Category);

                for (int k = 0; k < cands.Count; k++)
                {
                    RuleDef r = cands[k];
                    // §61-R3 — ХАМААРЛЫГ ГҮЙЦЭТГЭХЭЭС ӨМНӨ тогтооно.
                    result.Ledger.Considered(r.RuleUid);
                    string skip;
                    if (!RuleEngine.MayApply(r, partial, out skip))
                    {
                        // NOT_APPLICABLE нь МӨР БИШ — гэхдээ бүртгэлд орно.
                        result.Ledger.Skipped(r.RuleUid, skip);
                        continue;
                    }
                    result.Ledger.Applicable(r.RuleUid);

                    List<RuleDef> list;
                    if (!work.TryGetValue(d.ElementUid, out list))
                    {
                        list = new List<RuleDef>();
                        work[d.ElementUid] = list;
                        byUid[d.ElementUid] = d;
                        order.Add(d.ElementUid);
                    }
                    if (!list.Contains(r)) list.Add(r);
                }
            }
            if (work.Count == 0)
            {
                result.BadgeCount = state.OpenCount();
                return result;   // ХЭВИЙН тохиолдол, алдаа БИШ
            }

            // ── ШАТ 5а.  ХҮЙТЭН: баримт цуглуулах (Revit-ийн үндсэн урсгал) ─
            // ⚠️ `TryCall` (2-4) нь `Gate.Wait(0)` — өрсөлдөөн бол SKIP.
            //    Skip нь ХЭВИЙН: хэрэглэгч ажиллаж байна, дараагийн мөчлөгт
            //    авна.  ХЭН Ч ГУЙГААГҮЙ БОЛОМЖ НЬ ХҮМҮҮСИЙН ХЭРЭГЛЭДЭГ
            //    БОЛОМЖИЙГ ХЭЗЭЭ Ч ЭВДЭЖ БОЛОХГҮЙ.
            FactSetStore facts = new FactSetStore();
            bool collectSkipped, collectMore;
            System.Diagnostics.Stopwatch csw = System.Diagnostics.Stopwatch.StartNew();
            bool ok = CollectViaSource(src, work, order, facts, out collectSkipped, out collectMore);
            csw.Stop();
            try { Metrics.InputCollect.Add(csw.Elapsed.TotalMilliseconds); } catch { }

            if (!ok || collectSkipped)
            {
                // ⚠️ Цуглуулагдаагүй элементүүд АЛДАГДАХГҮЙ — хойшлуулалтад.
                state.CarryOver(set.DocKey, ids, 0);
                result.Skipped = true;
                result.Coverage = "partial";
                result.BadgeCount = state.OpenCount();
                return result;
            }
            if (collectMore) result.Coverage = "partial";

            // ── ШАТ 5б.  ҮНЭЛГЭЭ (цэвэр, Revit-гүй — 2-2-ийн хөдөлгүүр) ──
            System.Diagnostics.Stopwatch sw = System.Diagnostics.Stopwatch.StartNew();
            List<RuleOutcome> perElement = new List<RuleOutcome>();
            List<RuleDef> perElementRules = new List<RuleDef>();

            for (int i = 0; i < order.Count; i++)
            {
                if (sw.ElapsedMilliseconds > EvalAbortMs)
                {
                    // ⚠️ Мөр ҮҮСГЭХГҮЙ, бүртгэлд `budget_abort`, coverage=partial.
                    result.Coverage = "partial";
                    result.Ledger.Aborted();
                    state.CarryOver(set.DocKey, Tail(order, byUid, i), 0);
                    break;
                }
                string uid = order[i];
                DirtyElement d = byUid[uid];
                List<RuleDef> rules = work[uid];

                Dictionary<string, FactValue> elemFacts = facts.For(uid);
                FactBag bag = new FactBag(ctx, facts.Doc, elemFacts, d.Category);

                perElement.Clear();
                perElementRules.Clear();
                for (int k = 0; k < rules.Count; k++)
                {
                    RuleDef r = rules[k];
                    Applicability app;
                    RuleOutcome o;
                    try { o = RuleEngine.Execute(r, bag, out app); }
                    catch
                    {
                        // ⚠️ ҮНЭЛЭГЧИЙН УНАЛТ НЬ ЗӨРЧИЛ БИШ (§3.8).  Хөдөлгүүр
                        //    шидэх ёсгүй ч, шидвэл ЧИМЭЭГҮЙ `VIOLATION`
                        //    гаргахаас алгасах нь ХАМААГҮЙ ДЭЭР.
                        result.Ledger.Skipped(r.RuleUid, "engine_error");
                        continue;
                    }
                    result.Ledger.Evaluated(r.RuleUid);
                    result.Evaluations++;
                    if (o == null)
                    {
                        // NOT_APPLICABLE / `check = {}` — мөр ҮҮСГЭХГҮЙ.
                        continue;
                    }
                    perElement.Add(o);
                    perElementRules.Add(r);
                }
                if (perElement.Count == 0) continue;

                // ── §64.  ЗӨРЧИЛДӨӨНИЙГ ЧИМЭЭГҮЙ ШИЙДЭХГҮЙ ──────────
                RuleOutcome[] reconciled = perElement.ToArray();
                try { reconciled = RuleEngine.Reconcile(reconciled, index.Conflicts); }
                catch { }

                // ── ШАТ 6.  ОЛДВОР (зөвхөн ТӨЛӨВ ӨӨРЧЛӨГДВӨЛ) ────────
                for (int k = 0; k < reconciled.Length; k++)
                {
                    RuleOutcome o = reconciled[k];
                    if (o == null) continue;
                    RuleDef owner = index.ByUid(o.RuleUid);
                    if (owner == null) owner = FindRule(perElementRules, o.RuleUid);
                    if (owner == null) continue;
                    state.Apply(set.DocKey, uid, d.Id, owner, o,
                                result.ScanGeneration, _stamp, result);
                }
            }
            sw.Stop();
            try { Metrics.RuleEval.Add(sw.Elapsed.TotalMilliseconds); } catch { }

            // ── ШАТ 7.  МЭДЭГДЭЛ — ЗӨВХӨН RIBBON-Ы БИЧЭЭС.  Push БАЙХГҮЙ. ─
            result.BadgeCount = state.OpenCount();
            return result;
        }

        private static RuleDef FindRule(List<RuleDef> rules, string uid)
        {
            for (int i = 0; i < rules.Count; i++)
            {
                if (string.Equals(rules[i].RuleUid, uid, StringComparison.Ordinal)) return rules[i];
            }
            return null;
        }

        private static long[] Tail(List<string> order, Dictionary<string, DirtyElement> byUid, int from)
        {
            List<long> rest = new List<long>();
            for (int i = from; i < order.Count; i++)
            {
                DirtyElement d;
                if (byUid.TryGetValue(order[i], out d)) rest.Add(d.Id);
            }
            return rest.ToArray();
        }

        private static long[] Merge(long[] a, long[] b)
        {
            HashSet<long> seen = new HashSet<long>();
            List<long> outp = new List<long>((a != null ? a.Length : 0) + (b != null ? b.Length : 0));
            if (a != null) { for (int i = 0; i < a.Length; i++) if (seen.Add(a[i])) outp.Add(a[i]); }
            if (b != null) { for (int i = 0; i < b.Length; i++) if (seen.Add(b[i])) outp.Add(b[i]); }
            return outp.ToArray();
        }

        /* ============================================================== */
        /*  id → (uid, категори)                                          */
        /* ============================================================== */

        private static Dictionary<long, ResolvedElement> CacheFor(string docKey)
        {
            Dictionary<long, ResolvedElement> map;
            if (!_resolveCache.TryGetValue(docKey, out map))
            {
                map = new Dictionary<long, ResolvedElement>();
                _resolveCache[docKey] = map;
            }
            return map;
        }

        private static void DropResolveCache(string docKey)
        {
            // ⚠️ sync-ийн дараа кэш нь ХУУЧИН: өөр хүн элемент устгасан байж
            //    болно, ба `Suppressed` цонхонд бид түүнийг ХАРААГҮЙ.
            if (!string.IsNullOrEmpty(docKey)) _resolveCache.Remove(docKey);
        }

        private static List<DirtyElement> ResolveDirty(
            string docKey, long[] ids, IRuleInputSource src, PassResult result)
        {
            List<DirtyElement> outp = new List<DirtyElement>(ids.Length);
            Dictionary<long, ResolvedElement> cache = CacheFor(docKey);
            if (cache.Count > MaxCacheEntries) { cache.Clear(); }

            List<long> unknown = new List<long>();
            for (int i = 0; i < ids.Length; i++)
            {
                if (!cache.ContainsKey(ids[i])) unknown.Add(ids[i]);
            }

            if (unknown.Count > 0)
            {
                List<ResolvedElement> rows = new List<ResolvedElement>(unknown.Count);
                bool skipped, more;
                bool ok;
                System.Diagnostics.Stopwatch sw = System.Diagnostics.Stopwatch.StartNew();
                try { ok = src.TryResolve(unknown.ToArray(), rows, out skipped, out more); }
                catch { ok = false; skipped = true; more = false; }
                sw.Stop();
                try { Metrics.InputCollect.Add(sw.Elapsed.TotalMilliseconds); } catch { }

                if (!ok || skipped)
                {
                    result.Skipped = true;
                    return outp;
                }
                if (more) result.Coverage = "partial";
                for (int i = 0; i < rows.Count; i++)
                {
                    ResolvedElement re = rows[i];
                    if (re == null) continue;
                    cache[re.Id] = re;
                }
            }

            for (int i = 0; i < ids.Length; i++)
            {
                ResolvedElement re;
                if (!cache.TryGetValue(ids[i], out re) || re == null) continue;
                if (!re.Exists)
                {
                    // ⚠️ Устгагдсан элемент — баримт УНШИХ БОЛОМЖГҮЙ.  Дүрэм
                    //    ажиллуулах нь утгагүй; түүний олдвор нь дээрх гох
                    //    №2-оор аль хэдийн хуучирсан.
                    continue;
                }
                outp.Add(new DirtyElement
                {
                    Id = re.Id,
                    ElementUid = re.Uid,
                    Category = re.Category,
                    // ⚠️ `null` = «ЯЛГАЖ ЧАДААГҮЙ» — `RawEntry` нь ангилал
                    //    тутмын ТОО л хадгалдаг, id тус бүр АЛЬ АНГИД нь
                    //    орсныг БИШ.  Индекс нь тэр үед категорийн БҮХ гохыг
                    //    нэгтгэнэ (илүү үнэлэх нь аюулгүй, дутуу нь БИШ).
                    Change = null,
                });
            }
            return outp;
        }

        /* ============================================================== */
        /*  ХҮЙТЭН ЦУГЛУУЛАЛТ                                             */
        /* ============================================================== */

        /// <summary>
        /// Дүрмүүдийн `requires.params`-ыг элемент тутам НЭГТГЭЖ, `CollectChunk`
        /// -ээр зүсэж хэрэгсэл рүү явуулна.
        ///
        /// ⚠️ ЗӨВХӨН ХЭРЭГТЭЙ БАРИМТ.  «Бүх боломжит баримтыг ав» гэдэг нь
        /// §51-R3-ийн зөрчил — элемент бүр дээр бүх дүрмийн оролтыг унших нь
        /// индексийн бүх ашгийг устгана.
        /// </summary>
        private static bool CollectViaSource(
            IRuleInputSource src,
            Dictionary<string, List<RuleDef>> work,
            List<string> order,
            FactSetStore store,
            out bool skipped, out bool more)
        {
            skipped = false;
            more = false;

            List<FactRequest> batch = new List<FactRequest>(CollectChunk);
            for (int i = 0; i < order.Count; i++)
            {
                string uid = order[i];
                List<RuleDef> rules = work[uid];
                FactRequest req = new FactRequest { Uid = uid };
                for (int k = 0; k < rules.Count; k++)
                {
                    RuleRequires rq = rules[k].Requires;
                    string[] ps = rq != null ? rq.Params : null;
                    if (ps == null) continue;
                    for (int p = 0; p < ps.Length; p++)
                    {
                        string local = ps[p];
                        if (string.IsNullOrEmpty(local)) continue;
                        // ⚠️ `requires.params` нь УГТВАРГҮЙ (Хавсралт §1.1).
                        //    Угтвартай ирвэл ХАСНА — хоёр талын нэр таарахгүй
                        //    бол баримт ҮРГЭЛЖ Missing болж, бүх дүрэм
                        //    UNCERTAIN болно.
                        if (local.StartsWith("element.", StringComparison.Ordinal))
                            local = local.Substring(8);
                        if (!req.Facts.Contains(local)) req.Facts.Add(local);
                    }
                }
                batch.Add(req);

                if (batch.Count >= CollectChunk || i == order.Count - 1)
                {
                    bool s, m;
                    bool ok;
                    try { ok = src.TryCollect(batch, store, out s, out m); }
                    catch { ok = false; s = true; m = false; }
                    if (!ok || s) { skipped = s; return false; }
                    if (m) more = true;
                    batch.Clear();
                }
            }
            return true;
        }

        /* ============================================================== */
        /*  ОНОШИЛГОО                                                      */
        /* ============================================================== */

        /// <summary>`timing.log` / эрүүл мэндийн тайланд зориулсан НЭГ мөр.</summary>
        public static string Diagnostics()
        {
            RuleTriggerIndex ix = _index;
            return "compliance pack=" + (ix == null ? "none" : (ix.IsEmpty ? "empty" : "ok"))
                 + " team=" + (_indexTeam ?? "?")
                 + " rules=" + (ix == null ? 0 : ix.RuleCount).ToString(CultureInfo.InvariantCulture)
                 + " passes=" + PassCount.ToString(CultureInfo.InvariantCulture)
                 + " skipped=" + SkippedPasses.ToString(CultureInfo.InvariantCulture)
                 + " dropped_sets=" + DroppedSets.ToString(CultureInfo.InvariantCulture)
                 + " open=" + _badge.ToString(CultureInfo.InvariantCulture)
                 + " coverage=" + (_coverage ?? "?")
                 // ⚠️ F5 — ЭНЭ ГУРВЫГ ТАЙЛАНД ЗААВАЛ ГАРГАНА.  «pack=ok
                 //    surface=off» гэсэн хослол нь дүрэм ажиллаж байгаа ч
                 //    хэн Ч ХАРААГҮЙ гэсэн үг — ~20 ПК дээр түүнийг олох
                 //    цорын ганц зам нь эрүүл мэндийн тайлан.
                 + " surface=" + (SurfaceSink == null ? "off" : "on")
                 + " surfaced=" + (_surfacePublished ? "yes" : "no")
                 + " whole_scan=" + (_checkedDocKey == null ? "no" : "yes");
        }
    }
}
