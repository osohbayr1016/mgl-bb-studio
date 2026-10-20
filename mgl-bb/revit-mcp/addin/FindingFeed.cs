using System;
using System.Collections.Generic;

namespace RevitMcpAddin
{
    /// <summary>
    /// Дүгнэлтийн ХАРАГДАХ дараалал — дедуп → хойшлуулалт → хүлээн
    /// зөвшөөрөл → үндэс рүү нугалах → төсөв.
    ///
    /// ⚠️ ЭНЭ ФАЙЛ REVIT-ИЙН ЯМАР Ч ТӨРӨЛ АШИГЛАХГҮЙ.  `Nudges.cs`,
    ///    `Timing.cs`, `Percentiles.cs`-ийн хэв маяг: `check_findingfeed.py`
    ///    нь ЭНЭ ГАНЦ файлыг `dotnet run`-аар Revit-гүйгээр компиляцлаж
    ///    бүх дүрмийг шалгана.  Revit-ийн төрөл оруулбал add-in дахь
    ///    ЦОРЫН ГАНЦ автомат тест боломжгүй болно (C# тест ТЭГ).
    ///
    /// ⚠️ ЭНЭ ФАЙЛ UI-Д ХҮРЭХГҮЙ.  WPF-ийн маршаллагчийг дууддаггүй,
    ///    самбарын хавтанг мэдэхгүй, `Lang`-ийг ч мэдэхгүй (ганц файлаар
    ///    компиляцлагдах ёстой).  Дуудагч нь үр дүнг аваад UI урсгал дээр
    ///    зурна.  Шалтгаан: `ChangeTracker.Gate` барих боломжтой урсгалаас
    ///    UI руу СИНХРОН маршаллах нь хоёр урсгалын deadlock.
    ///
    /// ⚠️ ДҮРМИЙН БҮРТГЭЛ ХООСОН ШИПНЭ (эзний шийдвэр Ш4).  Тиймээс
    ///    «дүгнэлт алга» нь ХОЁР огт өөр зүйл байж болно — «багц байхгүй
    ///    тул ШАЛГААГҮЙ» ба «шалгаад цэвэр гарсан».  Энэ файл түүнийг
    ///    ЯЛГАЖ ЧАДАХГҮЙ (тэр ялгаа нь `ComplianceScheduler.NoPack`-д
    ///    байна) тул `Result` нь ЭНД «нийцэж байна» гэсэн утга ХЭЗЭЭ Ч
    ///    үүсгэхгүй: `Result` нь зөвхөн ТООГ хэлнэ.
    ///
    /// ⚠️ ЯЛГААГ ГАРГАХ ШИЙДВЭР нь `StateOf` — ЦЭВЭР функц, самбарын
    ///    бичвэрийг сонгодог.  Самбар өөрөө `if`-үүд бичих ЁСГҮЙ: тэр нь
    ///    тестлэгддэггүй WPF файлд «хоосон жагсаалт ⇒ анхаарах зүйл алга»
    ///    гэсэн чимээгүй тэнцлийг дахин төрүүлэх зам (F5).
    /// </summary>
    internal static class FindingFeed
    {
        /* ============================================================== */
        /*  Төсөв                                                          */
        /* ============================================================== */

        /// <summary>
        /// Самбарт нэг удаад харуулах ДЭЭД мөр.
        ///
        /// ⚠️ Самбарын жагсаалтууд нь ВИРТУАЛЖУУЛААГҮЙ `ItemsControl`
        ///    (`AssistantPane.xaml`-ийн `ChecklistBox`, `ChangesBox`,
        ///    `FindingsBox`) — мөр бүр нэг удаа бүтээгдээд санах ойд
        ///    үлддэг.  Хязгаарыг ДЭЭД урсгалд тавина.
        /// </summary>
        public const int MaxVisible = 40;

        /// <summary>
        /// Самбарт нэг удаад бүтээх ДЭЭД МӨР — БҮЛЭГ БИШ.
        ///
        /// ⚠️ `MaxVisible` нь БҮЛГИЙГ тоолдог ба бүлэг бүр `MaxConsequencesShown`
        ///    дагавар авч явна.  Зөвхөн бүлгээр төсөвлөвөл 40 × (1 + 9) = 400
        ///    мөр ВИРТУАЛЖУУЛААГҮЙ `FindingsBox` руу орно — тэр нь яг энэ
        ///    тогтмолын урьдчилан сэргийлэх ёстой зүйл.  Серверийн
        ///    `MAX_SURFACE_GROUPS` бас БҮЛЭГ тоолдог тул хамгаалалт нь ЭНД
        ///    байх ёстой, сервер дээр биш.
        ///
        /// ⚠️ Самбар нэмээд бүлэг тутамд «…бас N дагавар», төгсгөлд нь
        ///    «+N бүлэг харагдаагүй» гэсэн ТАЙЛБАРЫН мөр нэмнэ — тэдгээр нь
        ///    энэ төсөвт ОРООГҮЙ (дээд тал нь +41 мөр).  Зориуд: тайлбарын
        ///    мөрийг таслах нь «жагсаалт бүрэн» гэж уншигдана.
        /// </summary>
        public const int MaxVisibleRows = 120;

        /// <summary>Нэг үндсэн шалтгааны дор нугалж харуулах дагаврын дээд тоо.</summary>
        public const int MaxConsequencesShown = 9;

        /// <summary>Хүлээн зөвшөөрөгдсөн мөрийг дахин гаргах хамгийн бага завсар (хоног).</summary>
        public const int SnoozeDays = 7;

        /* ============================================================== */
        /*  Оролт / гаралт                                                 */
        /* ============================================================== */

        internal sealed class Item
        {
        // ⚠️ CS0649 нь ЭНД ХҮЛЭЭГДСЭН, ба тэр нь ГЭРЭЭНИЙ БАРИМТ:
        //    `Item`-ийг бөглөдөг код нь `GET /api/compliance/findings`-ийн
        //    хариуг задлагч бөгөөд тэр нь СЕРВЕР тал шипсэний ДАРАА
        //    нэмэгдэнэ.  `Nudges.Ctx` (13 ижил анхааруулга) ба
        //    `ComplianceScheduler.FindingSink` нь яг ижил хэв маяг.
        //    Анхааруулгыг дарж байгаа нь «хэрэглэгддэггүй» гэсэн үг БИШ —
        //    «оноогч нь өөр релизэд байна» гэсэн үг.
#pragma warning disable CS0649
            /// <summary>sha256(rule_uid + '\0' + element_uid) эхний 16 тэмдэгт.</summary>
            public string DedupKey;

            /// <summary>
            /// Серверийн `compliance_findings.id`.  0 = ЗӨВХӨН ЛОКАЛ.
            ///
            /// ⚠️ ХЭРЭГТЭЙ, УЧИР НЬ хүчингүй болголт нь
            /// `POST /api/compliance/findings/:id/override` — дедуп түлхүүр
            /// БИШ, ID-аар явдаг.  Тэг байхад самбар «Хүчингүй болгох»
            /// товчийг НУУНА: хаана ч бичигдэхгүй бүртгэлийг санал болгох
            /// нь хэрэглэгчийг хуурсан хэрэг.  Релиз N-д илгээгч (sink)
            /// байхгүй тул ЭНЭ нь ердийн зам, онцгой тохиолдол БИШ.
            /// </summary>
            public long ServerId;

            public long ElementId;         // goto_element-д дамжуулна
            public string Verdict;         // PASS | WARNING | VIOLATION | UNCERTAIN
            public string Severity;        // CRITICAL | HIGH | MEDIUM | LOW | INFO
            public string IssueClass;
            public string EvidenceLevel;   // RULE_BACKED | MODEL_DERIVED | HUMAN_VERIFIED | AI_INFERRED | UNKNOWN
            public string TitleMn, TitleEn;
            public string RecommendationMn, RecommendationEn;
            public string CitationMn;      // ⚠️ EvidenceLevel зөвшөөрөөгүй бол NULL байх ЁСТОЙ
            public long DetectedAtSec;     // unix, эрэмбэлэлтэд
            public bool IsStale;
            public string RootDedupKey;    // өөрөө үндэс бол null

            /// <summary>
            /// СЕРВЕРИЙН `promoted` (`compliance.ts:4290`) — ЭНЭ мөр бүлгийн
            /// толгой болсон ч ЖИНХЭНЭ ҮНДЭС нь жагсаалтад БАЙХГҮЙ.
            ///
            /// ⚠️ Серверийн гэрээ: «UI нь «Үндсэн шалтгаан» гэж бичих
            ///    ЭРХГҮЙ».  Жинхэнэ үндэс нь ӨӨР ХҮНИЙ олдвор байж болно,
            ///    хүчингүй болгогдсон байж болно, эсвэл `min_severity`-ийн
            ///    доор унасан байж болно.  Симптомыг «үндсэн шалтгаан» гэж
            ///    нэрлэвэл инженер БУРУУ ЭЛЕМЕНТ засна.
            ///
            /// ⚠️ Энэ нь `RootDedupKey != null`-тэй ХОЁР ӨӨР зүйл:
            ///    `RootDedupKey` нь «миний үндэс ЭНЭ түлхүүр», `RootMissing`
            ///    нь «тэр түлхүүрийг чи ХЭЗЭЭ Ч ХАРАХГҮЙ».  Сервер үндсийг
            ///    нь өөрөө нугалж, заагчийг цэвэрлэсэн байж болох тул
            ///    ялгааг клиент ТААМАГЛАЖ БОЛОХГҮЙ — тусдаа талбар хэрэгтэй.
            /// </summary>
            public bool RootMissing;
#pragma warning restore CS0649
        }

        internal sealed class State
        {
            /// <summary>
            /// Хүлээн зөвшөөрсөн түлхүүр → хэзээ (unix сек).
            ///
            /// ⚠️ ЭНЭ НЬ САНАХ ОЙД, СЕССИЙН ТУРШ.  Revit дахин асаахад
            /// үлдэх ёстой «Ойлголоо» нь СЕРВЕРИЙН амьдралын мөчлөг
            /// (`lifecycle_state = 'ACKNOWLEDGED'`) — сервер тэр мөрийг
            /// буцаахаа больсноор л жинхэнэ тогтвортой болно.  Клиент
            /// зөвхөн ХУГАЦААГ барина.
            /// </summary>
            public readonly Dictionary<string, long> AckedAt =
                new Dictionary<string, long>(StringComparer.Ordinal);

            /// <summary>
            /// СҮҮЛИЙН `Build`-д харуулсан үндсэн түлхүүрүүд.
            ///
            /// ⚠️ `Build` бүрд ЦЭВЭРЛЭГДЭНЭ.  «Хэзээ нэгэн цагт харагдсан»
            /// БИШ, «ОДОО харагдаж байгаа» гэсэн утгатай: бичээс / сануулгын
            /// ирээдүйн жолоодогч «шинээр гарч ирсэн үү» гэдгийг ЭНЭ
            /// олонлогийн ЗӨРҮҮГЭЭР олно, хуримтлагдвал тэр зөрүү мөнхөд
            /// хоосон болж дохио чимээгүй үхнэ.
            /// </summary>
            public readonly HashSet<string> ShownKeys =
                new HashSet<string>(StringComparer.Ordinal);
        }

        internal sealed class Group
        {
            /// <summary>
            /// Бүлгийн ТОЛГОЙ.  ⚠️ `Promoted` үнэн бол энэ нь ҮНДСЭН
            /// ШАЛТГААН БИШ — зөвхөн харагдаж байгаа хамгийн хүнд СИМПТОМ.
            /// </summary>
            public Item Primary;
            public readonly List<Item> Consequences = new List<Item>();
            public int ConsequenceTotal;               // нугалахаас ӨМНӨХ бүтэн тоо

            /// <summary>
            /// ⚠️ ЖИНХЭНЭ ҮНДЭС НЬ ЭНЭ ЖАГСААЛТАД БАЙХГҮЙ.
            ///
            /// Хоёр эх сурвалж, ХОЁУЛАА ижил утгатай:
            ///  (1) `Item.RootMissing` — серверийн `promoted` тугийг зөөв;
            ///  (2) `Build`-ийн дотоод нугалалт — үндэс нь ЭНД шүүлтэд унасан
            ///      (хүлээн зөвшөөрөгдсөн / `minSeverityRank`-аас доогуур /
            ///      огт ирээгүй) тул хамгийн хүнд дагаврыг толгой болгов.
            ///
            /// ⚠️ Самбар ЭНЭ ТУГИЙГ УНШИХ ЁСТОЙ.  Уншихгүй бол симптом дээр
            ///    «Үндсэн шалтгаан» гэж бичигдэж, инженер БУРУУ ЭЛЕМЕНТ засна
            ///    (`compliance.ts:4290`-ийн ил бичсэн гэрээ).
            /// </summary>
            public bool Promoted;
        }

        internal sealed class Result
        {
            public readonly List<Group> Groups = new List<Group>();
            public int TotalFindings;    // шүүхээс ӨМНӨХ бүтэн тоо
            public int Hidden;           // хүлээн зөвшөөрөгдсөн / хойшлуулсан
            public int Truncated;        // ЭРЭМБЭЛСНИЙ ДАРАА таслагдсан тоо
            public bool AnyStale;
        }

        /* ============================================================== */
        /*  §80 — ЭРХИЙН ТҮВШИН (КЛИЕНТ ТАЛЫН ТОЛЬ)                        */
        /* ============================================================== */

        /// <summary>
        /// Эрхийн түвшний ЦОРЫН ГАНЦ ЭХ СУРВАЛЖ нь СЕРВЕР
        /// (`app_settings['bim.compliance.authority_level']` →
        /// `backend/src/lib/complianceAuthority.ts`-ийн `AUTHORITY_CAPS`).
        /// Энд байгаа нь ТҮҮНИЙ ТОЛЬ бөгөөд ЗӨВХӨН ХААХ чиглэлд ажиллана:
        /// сервер хаасныг клиент нээж ЧАДАХГҮЙ (мөр огт ирэхгүй), клиент
        /// хаасныг сервер нээж ЧАДАХГҮЙ (энэ шалгуур).  ХОЁУЛАА зөвшөөрсөн
        /// үед л харагдана — зөрвөл ХАТУУ нь ялна.
        ///
        /// ⚠️ `null` нь 0 БИШ.  «Хараахан уншаагүй» ба «OBSERVE гэж
        /// ТОДОРХОЙ хэлсэн» хоёр өөр төлөв (`ApiClient.CachedAuthorityLevel`
        /// -ийн тайлбартай ижил үндэслэл).  Хоёулаа ХААЛТТАЙ, гэхдээ самбар
        /// өөр өгүүлбэр бичнэ — «горим» ба «уншаагүй» хоёрыг хольж болохгүй.
        ///
        /// ⚠️ ЭНД ХАТУУ БИЧСЭН ЦОРЫН ГАНЦ ЗҮЙЛ нь ТҮВШНИЙ ДУГААР — босго,
        /// дүрэм, багийн код БИШ.  Түвшин нь сервер дээр НЭГ UPDATE-ээр
        /// өөрчлөгддөг тул DLL дахин тараах шаардлага үүсэхгүй хэвээр.
        /// </summary>
        public static int LevelOf(string authorityLevel)
        {
            if (string.IsNullOrEmpty(authorityLevel)) return -1;
            string s = authorityLevel.Trim();
            if (s.Length != 1 || s[0] < '0' || s[0] > '5') return -1;
            return s[0] - '0';
        }

        /// <summary>LEVEL 0 = OBSERVE — цуглуулна, ХАРУУЛАХГҮЙ (§80).</summary>
        public static bool Surfaces(string authorityLevel)
        {
            return LevelOf(authorityLevel) >= 1;
        }

        /// <summary>
        /// LEVEL 2 = RECOMMEND — засварыг ТЕКСТЭЭР санал болгохыг зөвшөөрнө.
        /// LEVEL 1 (EXPLAIN) дээр дүгнэлт ба ЯАГААД нь харагдана, зөвлөмж
        /// ХАРАГДАХГҮЙ.
        /// </summary>
        public static bool ShowsRecommendation(string authorityLevel)
        {
            return LevelOf(authorityLevel) >= 2;
        }

        /* ============================================================== */
        /*  ГАДАРГУУГИЙН ТӨЛӨВ — «ЧИМЭЭГҮЙ ТЭНЦЭЛ»-ИЙН ЭСРЭГ ЦОРЫН ГАНЦ    */
        /*  ШИЙДВЭР ГАРГАГЧ                                                */
        /* ============================================================== */

        /// <summary>
        /// «Дүгнэлт алга» гэдэг НЭГ Ч УТГАГҮЙ — доорх ЗУРГААН огт өөр
        /// шалтгааны аль нэг нь байна.  Тэднийг НЭГ өгүүлбэрээр бичих нь
        /// ЧИМЭЭГҮЙ ТЭНЦЭЛ (class-1): шалгаагүй загварыг «цэвэр» гэж
        /// уншуулна.
        /// </summary>
        public enum SurfaceState
        {
            /// <summary>Эрхийн түвшин хараахан уншигдаагүй (сүлжээ / шинэ сесс).</summary>
            AuthorityUnknown = 0,
            /// <summary>LEVEL 0 — цуглуулна, ХАРУУЛАХГҮЙ (§80).</summary>
            Observe = 1,
            /// <summary>Дүрмийн багц ирээгүй — ЮУ Ч ШАЛГААГҮЙ (Ш4-ийн ердийн төлөв).</summary>
            NoPack = 2,
            /// <summary>
            /// ⛔ АЛДАА: дүрэм ажиллаж байна, ГЭВЧ үр дүнг самбарт хүргэх
            /// суваг ХОЛБОГДООГҮЙ.  Хэрэглэгчид ИЛ хэлнэ — чимээгүй хоосон
            /// жагсаалт нь «цэвэр» гэж уншигдана.
            /// </summary>
            NoProducer = 3,
            /// <summary>Суваг бий, гэхдээ хараахан НЭГ Ч мөчлөг хүрч ирээгүй.</summary>
            NotYetRun = 4,
            /// <summary>Шалгав — гэхдээ зөвхөн ХЭСГИЙГ.  «Цэвэр» ГЭСЭН ҮГ БИШ.</summary>
            PartialClean = 5,
            /// <summary>Бүтэн шалгав, дүгнэлт гарсангүй.  ⚠️ ЦОРЫН ГАНЦ «цэвэр».</summary>
            Clean = 6,
            /// <summary>Харуулах дүгнэлт бий.</summary>
            Findings = 7,
        }

        /// <summary>
        /// ⚠️ ЭНЭ ФУНКЦИЙН ГЭРЭЭ: `delivered == false` ЭСВЭЛ
        ///    `producerWired == false` үед `Clean` ХЭЗЭЭ Ч БУЦАХГҮЙ.
        ///    `check_findingfeed.py` энэ хоёр хувиргалыг бүрэн тоочиж шалгана.
        ///
        /// Дараалал нь ЗОРИУД: «багц алга» нь өдөр тутмын, тайлбарласан
        /// төлөв тул `NoProducer`-оос ӨМНӨ шалгагдана — эс бөгөөс дүрмийн
        /// багцгүй шипдэг суурь суулгалт бүр «суваг холбогдоогүй» гэж
        /// хашгирах ба тэр дохио утгаа алдана.  Багц ИРСЭН мөчид (F5-ийн яг
        /// тэр хором) суваг байхгүй бол дохио ГАРНА.
        /// </summary>
        /// <param name="noPack">`ComplianceScheduler.NoPack`.</param>
        /// <param name="producerWired">Дүгнэлт хүргэх sink суулгагдсан эсэх.</param>
        /// <param name="delivered">Хүргэгч НЭГ УДАА Ч ГЭСЭН үр дүн өгсөн эсэх.</param>
        /// <param name="wholeModelChecked">
        /// ЭНЭ баримт дээр БҮТЭН СКАН бүрэн хамрах хүрээтэй дууссан эсэх.
        /// ⚠️ Өсөлтөт мөчлөг нь ЗАССАН элементийг Л шалгадаг тул түүнээс
        /// «загвар цэвэр» гэсэн дүгнэлт ГАРГАЖ БОЛОХГҮЙ.
        /// </param>
        public static SurfaceState StateOf(string authorityLevel, bool noPack,
                                           bool producerWired, bool delivered,
                                           bool wholeModelChecked, int groupCount)
        {
            if (LevelOf(authorityLevel) < 0) return SurfaceState.AuthorityUnknown;
            if (!Surfaces(authorityLevel)) return SurfaceState.Observe;
            if (noPack) return SurfaceState.NoPack;
            if (!producerWired) return SurfaceState.NoProducer;
            if (!delivered) return SurfaceState.NotYetRun;
            if (groupCount > 0) return SurfaceState.Findings;
            return wholeModelChecked ? SurfaceState.Clean : SurfaceState.PartialClean;
        }

        /// <summary>
        /// «Шалгаад цэвэр гарлаа» гэж УНШИГДАХ ЦОРЫН ГАНЦ төлөв.
        ///
        /// ⚠️ Шинэ төлөв нэмэхдээ ЭНД нэмэх эсэхээ ТУСГАЙ шийд — энэ функц
        ///    нь тестийн зангуу бөгөөд «хоосон жагсаалт = цэвэр» гэсэн
        ///    регрессийг барих ганц газар.
        /// </summary>
        public static bool ClaimsClean(SurfaceState s)
        {
            return s == SurfaceState.Clean;
        }

        /* ============================================================== */
        /*  Эрэмбэ                                                         */
        /* ============================================================== */

        private static int SeverityRank(string s)
        {
            switch (s)
            {
                case "CRITICAL": return 0;
                case "HIGH": return 1;
                case "MEDIUM": return 2;
                case "LOW": return 3;
                default: return 4; // INFO ба танихгүй утга
            }
        }

        /// <summary>Самбарын өнгө / бүлэглэлтэд хэрэгтэй — ижил хүснэгт хоёр удаа бичихгүй.</summary>
        public static int RankOf(string severity) { return SeverityRank(severity); }

        /// <summary>
        /// ⚠️ ЭРЭМБЭ → ДАРАА нь ТАСЛАХ.  Урвуулбал `ChangeReport.cs:56-60`-д
        ///    тэмдэглэсэн регресс давтагдана: хэрэглэгч «санамсаргүй N»-г
        ///    БҮРЭН жагсаалт гэж үзээд үлдсэн зөрчлийг засахгүй.  Дүгнэлтийн
        ///    хувьд энэ нь өмнөх алдаанаас ХАМААГҮЙ аюултай.
        /// </summary>
        private static int Compare(Item a, Item b)
        {
            int r = SeverityRank(a.Severity).CompareTo(SeverityRank(b.Severity));
            if (r != 0) return r;
            // Үндэс нь дагавраасаа ДЭЭР (§77 — «show the primary cause first»).
            bool ra = a.RootDedupKey == null, rb = b.RootDedupKey == null;
            if (ra != rb) return ra ? -1 : 1;
            // Хуучирсан нь ДООР — одоогийн дүгнэлт БИШ (§58).
            if (a.IsStale != b.IsStale) return a.IsStale ? 1 : -1;
            // Сүүлд илрүүлсэн нь ДЭЭР.
            return b.DetectedAtSec.CompareTo(a.DetectedAtSec);
        }

        /* ============================================================== */
        /*  Гол функц — ЦЭВЭР                                              */
        /* ============================================================== */

        /// <summary>
        /// `raw` бол серверээс ирсэн бүтэн жагсаалт.  ЦЭВЭР функц: ижил
        /// оролтод ижил гаралт, гадаад төлөв уншихгүй (цаг нь ч аргумент).
        ///
        /// ⚠️ `minSeverityRank` нь `bim.compliance.min_severity`-оос ирнэ —
        ///    C#-д ХАТУУ БИЧИХГҮЙ.  Босгыг DLL-д шатаавал түүнийг өөрчлөх
        ///    нь ~20 PC дээр дахин суулгалт болно.
        /// </summary>
        public static Result Build(IList<Item> raw, State state, long nowSec, int minSeverityRank)
        {
            var res = new Result();
            if (raw == null || state == null) return res;
            res.TotalFindings = raw.Count;
            state.ShownKeys.Clear();

            // --- 1. ШҮҮЛТ: хүнд байдал, хүлээн зөвшөөрөл, хойшлуулалт ---
            var kept = new List<Item>(raw.Count);
            foreach (Item it in raw)
            {
                if (it == null || string.IsNullOrEmpty(it.DedupKey)) continue;
                if (SeverityRank(it.Severity) > minSeverityRank) { res.Hidden++; continue; }

                long ackAt;
                if (state.AckedAt.TryGetValue(it.DedupKey, out ackAt))
                {
                    // ⚠️ Хүлээн зөвшөөрөл нь ДҮРМИЙН semantic_hash солигдоход л
                    //    хүчингүй болно — тэр шийдвэрийг СЕРВЕР гаргаж, мөрийг
                    //    буцаахаа болино.  Клиент зөвхөн хугацааг барина.
                    if (nowSec - ackAt < SnoozeDays * 86400L) { res.Hidden++; continue; }
                }
                if (it.IsStale) res.AnyStale = true;
                kept.Add(it);
            }

            // --- 2. ЭРЭМБЭ (таслахаас ӨМНӨ) ---
            kept.Sort(Compare);

            // --- 3. ҮНДЭС РҮҮ НУГАЛАХ (§77 + §76-R3) ---
            var byKey = new Dictionary<string, Group>(StringComparer.Ordinal);
            var order = new List<Group>();
            foreach (Item it in kept)
            {
                string rootKey = it.RootDedupKey ?? it.DedupKey;
                Group g;
                if (!byKey.TryGetValue(rootKey, out g))
                {
                    g = new Group();
                    byKey[rootKey] = g;
                    order.Add(g);
                }
                if (it.RootDedupKey == null && g.Primary == null) { g.Primary = it; continue; }
                g.ConsequenceTotal++;
                if (g.Consequences.Count < MaxConsequencesShown) g.Consequences.Add(it);
            }

            // ⚠️ Үндэс нь шүүлтэд унасан (жишээ нь хүлээн зөвшөөрөгдсөн) бол
            //    хамгийн хүнд дагаврыг ТҮР үндэс болгоно — бүлэг толгойгүй
            //    үлдвэл дагаврууд нь харагдахаа болино.
            foreach (Group g in order)
            {
                if (g.Primary == null && g.Consequences.Count > 0)
                {
                    g.Primary = g.Consequences[0];
                    g.Consequences.RemoveAt(0);
                    g.ConsequenceTotal--;
                    // ⚠️ ТОЛГОЙ нь ҮНДЭС БОЛООГҮЙ — зөвхөн ХАРАГДАЖ БАЙГАА
                    //    хамгийн хүнд симптом.  Тугийг ЭНД тавихгүй бол
                    //    самбар түүн дээр «Үндсэн шалтгаан» гэж бичнэ.
                    g.Promoted = true;
                }
                // Серверийн `promoted` — толгой нь өөрөө «үндэс нь алга» гэж
                // хэлж байвал ХҮНДЭТГЭНЭ (дотоод нугалалт болоогүй ч).
                if (g.Primary != null && g.Primary.RootMissing) g.Promoted = true;
            }

            // --- 4. ТӨСӨВ (эрэмбэлсний ДАРАА) ---
            //
            // ⚠️ ХОЁР ТӨСӨВ: БҮЛЭГ (`MaxVisible`) ба МӨР (`MaxVisibleRows`).
            //    Мөрийн төсөвгүй бол 40 бүлэг × 10 мөр = 400 мөр
            //    ВИРТУАЛЖУУЛААГҮЙ жагсаалтад орно.
            //
            // ⚠️ АЛЬ НЭГ төсөв дүүрмэгц ДАРААГИЙН БҮХ БҮЛГИЙГ таслана —
            //    «энэ бүлэг том тул алгасаад дараагийн жижгийг нь авъя» гэвэл
            //    ХӨНГӨН бүлэг ХҮНД бүлгийг тойрч гарах ба энэ файлын оршин
            //    байх шалтгаан («эрэмбэ → дараа нь таслах») үхнэ.
            int shown = 0;
            int rows = 0;
            bool budgetFull = false;
            foreach (Group g in order)
            {
                if (g.Primary == null) continue;
                int cost = 1 + g.Consequences.Count;
                if (budgetFull || shown >= MaxVisible || rows + cost > MaxVisibleRows)
                {
                    budgetFull = true;
                    res.Truncated++;
                    continue;
                }
                res.Groups.Add(g);
                state.ShownKeys.Add(g.Primary.DedupKey);
                shown++;
                rows += cost;
            }
            return res;
        }

        /// <summary>Хүн «Ойлголоо» дарахад — төсвөөс ХАСАХГҮЙ, зөвхөн хугацаа.</summary>
        public static void Acknowledge(State s, string dedupKey, long nowSec)
        {
            if (s == null || string.IsNullOrEmpty(dedupKey)) return;
            s.AckedAt[dedupKey] = nowSec;
        }

        /* ============================================================== */
        /*  Туузны бичээс                                                  */
        /* ============================================================== */

        /// <summary>
        /// ⚠️ ЭНД САМБАР НЭЭХ ДУУДЛАГА ЮУ Ч БАЙХГҮЙ.  Тоог ribbon товчны бичээсээр
        ///    хүргэнэ.  Самбарыг кодоос нээх нь файл нээх бүрд ~300 px ба
        ///    фокус хулгайлна — эзний R7-ийн хамгийн магадлалтай регресс.
        /// </summary>
        public static string BadgeCaption(Result r)
        {
            if (r == null || r.Groups.Count == 0) return "Норм\nшалгалт";
            return "Норм\nшалгалт (" + r.Groups.Count + ")";
        }

        /// <summary>
        /// Эрхийн түвшинг ХҮНДЭТГЭСЭН бичээс.
        ///
        /// ⚠️ LEVEL 0 дээр ТОО Ч ГАРАХГҮЙ.  «Ажиглалт» гэдэг нь «чимээгүй
        ///    цуглуул» гэсэн үг: туузан дээрх «(7)» гэсэн тоо нь өөрөө
        ///    мэдэгдэл бөгөөд инженерийг самбар нээхэд хүргэнэ.
        /// </summary>
        public static string BadgeCaption(Result r, string authorityLevel)
        {
            return Surfaces(authorityLevel) ? BadgeCaption(r) : BadgeCaption(null);
        }
    }
}
