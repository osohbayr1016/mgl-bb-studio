using System;
using System.Collections.Concurrent;
using System.Threading;
using Autodesk.Revit.UI;

namespace RevitMcpAddin
{
    /// <summary>Нэг typed хэрэгслийн дуудлага — хүсэлт ба хариу нэг объектод.</summary>
    public class ToolCall
    {
        public string Tool;
        public string ArgsJson;

        public bool Success;
        /// <summary>Амжилттай үед JSON мөр.</summary>
        public string ResultJson;
        public string Error;

        public readonly ManualResetEventSlim Done = new ManualResetEventSlim(false);

        /// <summary>
        /// Хугацаа дуусаад дуудагч ЯВСАН эсэх.
        ///
        /// ⚠️ ЭНЭ БАЙХГҮЙ БАЙСАН нь «дахин дахин 120 секунд» гэсэн гомдлын
        /// ЖИНХЭНЭ ШАЛТГААН (2026-08-25).  Хугацаа дуусахад `Call` буцдаг ч
        /// `ToolCall` нь ДАРААЛАЛД ҮЛДДЭГ байв.  Revit эцэст нь thread
        /// чөлөөлөхөд тэр «сүнс» ажлыг БҮТНЭЭР нь гүйцэтгэж, хэн ч хүлээхгүй
        /// үр дүн гаргадаг.  Дараагийн дуудлага түүний ард дараалалд орох тул
        /// БАТАЛГААТАЙ дахин хугацаа дуусна — хэрэглэгч дахин дахин унасан
        /// гэж хардаг.  Одоо тэмдэглэгдсэн дуудлагыг `Execute` АЛГАСНА.
        /// </summary>
        public volatile bool Abandoned;

        /// <summary>
        /// Өрсөлдөөнөөс болж ОГТ ДУУДАГДААГҮЙ.
        ///
        /// ⚠️ `TimedOut`-ТОЙ ХОЛИХГҮЙ: хугацаа дуусах нь АСУУДАЛ (хэрэглэгч
        /// хүлээсэн, юу ч болоогүй), алгасалт нь ХЭВИЙН (арын мөчлөг Revit-ийг
        /// завгүй байхад нь БУЛААГААГҮЙ).  Хоёрыг нэг тоолуурт нийлүүлбэл
        /// «add-in өдөрт 400 удаа унадаг» гэсэн худал зураг гарна.
        /// </summary>
        public bool Skipped;

        /* ============================================================== */
        /*  ХЭМЖИЛТ (1C) — ЗУРГААН СЕГМЕНТ                                 */
        /*                                                                */
        /*  ⚠️ ЗӨВХӨН ХЭМЖИНЭ — зан төлөв өөрчлөхгүй.  Ганц тоо нь БУРУУ   */
        /*  зүйл оптимизац хийлгэнэ: 8 секундын дуудлага нь «Revit удаан»  */
        /*  гэсэн үг байж болно, эсвэл «өмнөх дуудлага Gate-ыг барьсан»    */
        /*  байж болно — хоёрын шийдэл нь ТЭС ӨӨР.                         */
        /* ============================================================== */

        /// <summary>`Gate.Wait` — ӨМНӨХ дуудлага дуусахыг хүлээсэн мс.</summary>
        public double MsQueueWait;

        /// <summary>
        /// `Gate`-ээс `Queue.Enqueue` хүртэлх мс.
        ///
        /// ⚠️ `Raise()`-ийн ӨРТӨГ ЭНД ОРОХГҮЙ — тэр нь `MsEventWait`-д
        /// ордог (2026-08-28).  Урьд нь энэ сегмент `Raise`-ийн ДАРАА
        /// хэмжигддэг байсан атал `MsEventWait` нь `EnqueuedTicks`-ээс,
        /// өөрөөр хэлбэл `Raise`-ээс ӨМНӨХ мөчөөс эхэлдэг — `Raise`-ийн
        /// хугацаа ХОЁР сегментэд ДАВХАР тоологдож байв.
        ///
        /// `EnqueuedTicks`-ийг `Raise`-ийн ард зөөх нь БОЛОХГҮЙ: Revit-ийн
        /// үндсэн thread нь `Raise` буцахаас ӨМНӨ dequeue хийж амжвал тэр
        /// талбарыг 0 гэж уншина (уралдаан).  Тиймээс энэ сегментийг
        /// богиносгож, зургуулаа ЯГ давхцахгүй болгов.
        /// </summary>
        public double MsEnqueue;

        /// <summary>`Raise`-ээс `Execute` нь ЭНЭ дуудлагыг dequeue хийх хүртэлх мс.</summary>
        public double MsEventWait;

        /// <summary>
        /// `RevitTools.Run` — Revit-ийн ажил.
        /// ⚠️ JSON СЕРИАЛЧЛАЛ ҮҮН ДОТОР БАЙНА (`Run` нь JSON мөр буцаадаг).
        /// Тусад нь ялгах бол `RevitTools.cs`-ийн 10 функцийг БҮГДИЙГ нь
        /// хөндөнө — эхний релизэд зориуд НЭГТГЭСЭН.
        /// </summary>
        public double MsRevitExec;

        /// <summary>
        /// `Done.Set`-ээс `Call` буцах хүртэлх мс (хүлээлтийн сүүл).
        ///
        /// ⚠️ ШУУД ХЭМЖИНЭ, ХАСАХ АРГААР БИШ (2026-08-28).  Урьд нь
        /// `total − queue − enq − event − exec` гэж бодогддог байсан бөгөөд
        /// `enq` ба `event` хоёрын ДАВХЦАЛААС болж бараг үргэлж сөрөг гараад
        /// `Math.Max(0, …)`-д 0 болж хавчуулагддаг байв.  Үр дүнд нь
        /// `Wait(50)` мөчлөгийн үлдэгдэл — 50 мс хүртэл байж БОЛОХ бөгөөд
        /// end-to-end латентад шууд ордог хэсэг — ХЭЗЭЭ Ч харагддаггүй байв.
        /// Одоо `DoneTicks`-ээс шууд тооцно.
        /// </summary>
        public double MsResponse;

        /// <summary>`Call`-ийн эхнээс төгсгөл хүртэлх мс — БҮХ гарцад бичигдэнэ.</summary>
        public double MsTotal;

        /// <summary>Хугацаа дууссан (`Abandoned`) зам мөн үү.</summary>
        public bool TimedOut;

        /// <summary>
        /// `Queue.Enqueue` хийсэн мөчийн `Stopwatch.GetTimestamp()`.
        /// ⚠️ `Execute` нь ӨӨР thread (Revit-ийн үндсэн) дээр уншина —
        /// `Stopwatch`-ийн тоолуур процессын хэмжээнд нэгдмэл тул аюулгүй.
        /// </summary>
        public long EnqueuedTicks;

        /// <summary>
        /// `Done.Set()` дуудахын ӨМНӨХ мөчийн `Stopwatch.GetTimestamp()`.
        ///
        /// ⚠️ `Done.Set`-ЭЭС ӨМНӨ бичигдэнэ — `Set` нь санах ойн хаалт
        /// тавьдаг тул сэрсэн дуудагч ЗААВАЛ бичигдсэн утгыг харна.
        /// Хугацаа дууссан (`Abandoned`) зам дээр дуудагч аль хэдийн явсан
        /// тул 0 үлдэнэ — `MsResponse` тэр үед утгагүй.
        /// </summary>
        public long DoneTicks;
    }

    /// <summary>
    /// Typed хэрэгслийг Revit-ийн ҮНДСЭН thread дээр гүйцэтгүүлэх гарц.
    ///
    /// ⚠️ Revit-ийн API-г дурын thread-ээс дуудаж БОЛОХГҮЙ; Transaction нээх нь
    /// бүр ч болохгүй.  Цорын ганц зөв арга бол `ExternalEvent` — үүнийг Raise
    /// хийхэд Revit сул зуураа `Execute(UIApplication)`-ыг үндсэн thread дээрээ
    /// дуудна.  Панель болон HTTP bridge ХОЁУЛАА энэ гарцаар л явна.
    ///
    /// Гурван нарийн зүйл (эдгээрийг алдвал үе үе гацна):
    ///
    ///  1. ХУГАЦААГ deadline-аар барина, давталт тоолж БИШ.  `Wait(50)` бүрийг
    ///     нэг секунд гэж тоолвол 120 секундын хугацаа бодитоор ~6 секунд болно.
    ///
    ///  2. `Raise()` нь `Pending` буцааж БОЛНО — өмнөх raise хараахан
    ///     боловсруулагдаагүй үед.  Энэ нь АЛДАА БИШ; дараалалд орсон хэвээр.
    ///     `Accepted` биш бүрийг алдаа гэж үзвэл ажиллах ёстой дуудлагыг
    ///     хаяж, дараагийнх нь өмнөхийн хариуг харах эрсдэлтэй.
    ///
    ///  3. НЭГЖ УРСГАЛ (single-flight).  `HttpServer.RunOnRevit` өөрийн
    ///     `SemaphoreSlim`-тэй; энд БАС хэрэгтэй, эс бөгөөс панель + bridge
    ///     хоёр зэрэг дуудахад дараалал холилдоно.
    /// </summary>
    public static class RevitToolBus
    {
        private static readonly SemaphoreSlim Gate = new SemaphoreSlim(1, 1);
        private static readonly ConcurrentQueue<ToolCall> Queue = new ConcurrentQueue<ToolCall>();
        private static ExternalEvent _event;
        private static RevitToolEventHandler _handler;

        /// <summary>App.OnStartup-аас НЭГ УДАА дуудна.</summary>
        public static void Init()
        {
            if (_event != null) return;
            _handler = new RevitToolEventHandler(Queue);
            _event = ExternalEvent.Create(_handler);
        }

        public static bool IsReady => _event != null;

        /* ============================================================== */
        /*  ҮЛ БЛОКЛОХ COLD ОРОЛТ (Track 2 · 2-4)                          */
        /* ============================================================== */

        /// <summary>
        /// ХЭРЭГЛЭГЧ АЖИЛЛАЖ БАЙНА гэсэн туг.  `AssistantPane.SetBusy`
        /// тавьж/буулгана.  Арын мөчлөг үүнийг үнэн үед мөчлөгөө АЛГАСНА.
        ///
        /// ⚠️ Compliance / илгээгч нь `SetBusy`-г ХЭЗЭЭ Ч ДУУДАХГҮЙ — тэр нь
        /// `Mouse.OverrideCursor`-ыг АПП ДАЯАР тавьдаг.  Энэ туг нь тэднээс
        /// ЗӨВХӨН УНШИГДАНА.
        /// </summary>
        public static volatile bool UserBusy;

        /// <summary>Унтраалт эхэлсэн — шинэ дуудлага хүлээж авахгүй.</summary>
        private static volatile bool _cancelled;

        /// <summary>
        /// ⛔ ХОРИГЛОЛТ №7-ЫН ДИБАГ ХАМГААЛАЛТ — `ChangeTracker.Gate`-ыг
        /// барьсан thread-ээс bus руу орох нь `OnDocumentChanged`-ыг
        /// Revit-ийн үндсэн thread дээр ХЭРЭГСЛИЙН БҮТЭН ХУГАЦААГААР гацаана.
        ///
        /// ⚠️ `DEBUG` тогтмол нь энэ төслийн АЛЬ Ч Configuration дээр
        /// тодорхойлогддоггүй («Release R27» → TRACE;MCP_EXECUTOR;RELEASE_R27)
        /// тул энэ шалгалт ОДООГООР гүйцэтгэгддэггүй — гэрээг КОДООР бичих,
        /// ирээдүйн Debug build дээр барих зорилготой.
        /// </summary>
        [System.Diagnostics.Conditional("DEBUG")]
        private static void AssertNotHoldingTrackerGate(string tool)
        {
            try
            {
                if (ChangeTracker.GateHeldByCurrentThread)
                {
                    throw new InvalidOperationException(
                        "ChangeTracker.Gate барьсан хэвээр RevitToolBus руу орлоо: " + tool);
                }
            }
            catch (InvalidOperationException) { throw; }
            catch { }
        }

        /// <summary>
        /// ҮЛ БЛОКЛОХ дуудлага.  Өрсөлдөөн байвал ДАРААЛАЛД ОРУУЛАХГҮЙ,
        /// ХҮЛЭЭХГҮЙ — `Skipped = true` гэж ШУУД буцна.
        ///
        /// ⚠️ ЯАГААД ЭНЭ ХЭРЭГТЭЙ ВЭ: `Gate` нь ЧАТ, QTO ба ирээдүйн
        /// compliance-тэй ХУВААЛЦСАН ГЛОБАЛ семафор, ба `CallCore` нь
        /// deadline-ыг `Gate.Wait`-ЭЭС ӨМНӨ эхлүүлдэг.  Модаль цонх нээлттэй
        /// үед `ExternalEvent` гүйцэтгэгддэггүй.  Тиймээс арын мөчлөг энгийн
        /// `Call`-ыг хэрэглэвэл `Gate`-ыг өөрийн БҮТЭН хугацаагаар барьж,
        /// хэрэглэгчийн ДАРААГИЙН «Зураг холбох» дуудлага «Хугацаа дууслаа
        /// (30s) — өмнөх үйлдэл дуусаагүй байна» гэсэн мессежийг авна.
        /// ХЭН Ч ХҮСЭЭГҮЙ ФУНКЦ НЬ ХЭРЭГЛЭДЭГ ФУНКЦИЙГ ЭВДЭХ ЁСГҮЙ (R7).
        ///
        /// ⚠️ АЛГАСАЛТ нь ХЭВИЙН тохиолдол, АЛДАА БИШ.  Дуудагч дараагийн
        /// мөчлөгт дахин оролдоно; COLD эгнээ нь BEST-EFFORT.
        ///
        /// ⚠️ Revit-ийн ҮНДСЭН thread-ЭЭС ДУУДАХГҮЙ — `Call`-ийн дүрэм
        /// `TryCall`-д ч ЯГ АДИЛХАН хамаарна (`ExternalEvent`-ийг зөвхөн
        /// үндсэн thread гүйцэтгэдэг тул өөрийгөө хүлээж гацна).
        /// </summary>
        public static ToolCall TryCall(string tool, string argsJson, int timeoutSeconds = 10)
        {
            AssertNotHoldingTrackerGate(tool);

            var call = new ToolCall { Tool = tool, ArgsJson = argsJson };
            if (_event == null || _cancelled || UserBusy)
            {
                call.Skipped = true;
                call.Success = false;
                return call;
            }

            var sw = System.Diagnostics.Stopwatch.StartNew();

            // ⚠️ `Wait(0)` — ХҮЛЭЭЛТГҮЙ.  `CallCore`-ийн
            //    `Wait(timeoutSeconds * 1000)`-ыг ЭНД ХЭЗЭЭ Ч хэрэглэхгүй.
            if (!Gate.Wait(0))
            {
                call.Skipped = true;
                call.Success = false;
                call.MsQueueWait = sw.Elapsed.TotalMilliseconds;
                return call;
            }

            try
            {
                // ⚠️ ЭНЭ БИЕ НЬ `CallCore`-ийн `Gate`-ийн ДАРААХ хэсэгтэй
                //    ЗОРИУД ҮГ ҮСГЭЭР ИЖИЛ.  Хамтын туслах арга болгож
                //    гаргах нь `Call` / `CallCore`-ийн шипсэн замыг хөндөнө —
                //    тэр зам нь чат ба QTO-гийнх бөгөөд §4-т «ӨӨРЧЛӨХГҮЙ»
                //    гэж тэмдэглэгдсэн.
                int deadline = Environment.TickCount + Math.Max(1, timeoutSeconds) * 1000;
                call.MsQueueWait = sw.Elapsed.TotalMilliseconds;

                Queue.Enqueue(call);
                call.EnqueuedTicks = System.Diagnostics.Stopwatch.GetTimestamp();
                call.MsEnqueue = sw.Elapsed.TotalMilliseconds - call.MsQueueWait;

                ExternalEventRequest raised = _event.Raise();
                if (raised != ExternalEventRequest.Accepted && raised != ExternalEventRequest.Pending)
                {
                    call.Success = false;
                    call.Error = "Revit хүсэлтийг хүлээж авсангүй: " + raised;
                    return call;
                }

                while (!call.Done.IsSet)
                {
                    if (call.Done.Wait(50)) break;
                    if (unchecked(Environment.TickCount - deadline) > 0)
                    {
                        // ⚠️ ЗААВАЛ ТЭМДЭГЛЭНЭ — эс бөгөөс Revit «сүнс» ажлыг
                        //    БҮТНЭЭР гүйцэтгэж, дараагийн дуудлага баталгаатай
                        //    хугацаа дуусна.
                        call.Abandoned = true;
                        call.TimedOut = true;
                        call.Success = false;
                        call.Error =
                            $"Хугацаа дууслаа ({timeoutSeconds}s). Revit завгүй байх эсвэл модаль цонх нээлттэй байж магадгүй.";
                        return call;
                    }
                }

                long doneTicks = call.DoneTicks;
                call.MsResponse = doneTicks == 0
                    ? 0
                    : (System.Diagnostics.Stopwatch.GetTimestamp() - doneTicks)
                      * 1000.0 / System.Diagnostics.Stopwatch.Frequency;
            }
            finally
            {
                Gate.Release();
                call.MsTotal = sw.Elapsed.TotalMilliseconds;
            }
            return call;
        }

        /// <summary>
        /// УНТРААЛТЫН АЛХАМ 1.  Дараалалд байгаа БҮХ дуудлагыг `Abandoned`
        /// болгож `Done`-ыг тавина, шинэ дуудлагыг хүлээж авахаа болино.
        ///
        /// ⚠️ `ExternalEvent`-ыг DISPOSE ХИЙХГҮЙ — тэр нь `Shutdown()`-ийн
        /// ажил бөгөөд `App.OnShutdown` нь яагаад түүнийг ХАМГИЙН СҮҮЛД
        /// дууддагийг тайлбарласан.  `CancelAll` бол ТЭР ДАРААЛЛЫГ
        /// ӨӨРЧЛӨХГҮЙГЭЭР хүлээгчдийг сулладаг ХАМГИЙН БАГА примитив:
        /// `ChangeTracker.Shutdown`-ийн синхрон `FlushDirty` нь `Gate`-ыг
        /// чөлөөтэй авах ёстой, эс бөгөөс Revit-ийн хаагдалт арын мөчлөгийн
        /// бүтэн хугацаагаар гацна.
        ///
        /// ⚠️ ХЭЗЭЭ Ч алдаа шидэхгүй.
        /// </summary>
        public static void CancelAll()
        {
            _cancelled = true;
            ToolCall pending;
            while (Queue.TryDequeue(out pending))
            {
                try
                {
                    pending.Abandoned = true;
                    pending.Success = false;
                    pending.Error = "Revit хаагдаж байна.";
                    pending.Done.Set();
                }
                catch { }
            }
        }

        /// <summary>
        /// УНТРААЛТ — `ExternalEvent`-ыг сулалж, дараалалд үлдсэн ажлыг
        /// хаяна.  `App.OnShutdown`-аас НЭГ УДАА дуудна.
        ///
        /// ⚠️ ЯАГААД: `_event` / `_handler` нь СТАТИК бөгөөд `Init()` нь
        /// тэднийг зөвхөн ҮҮСГЭДЭГ, ХЭЗЭЭ Ч сулладаггүй байв (§2.12
        /// «унтраалт нь юуг ч сулладаггүй»).  `ExternalEvent` нь Revit-ийн
        /// ресурс — эзэн add-in нь буулгагдсаны дараа ч бүртгэлтэй үлдэх нь
        /// зөв биш.
        ///
        /// ⚠️ Дарааллыг ХООСЛОНО, гэхдээ хүлээгчийг ХУУРАХГҮЙ: `Call` нь
        /// `Done` дохиогоор хүлээдэг тул хаягдсан ажил бүрийн `Done`-ыг
        /// тавьж өгнө, эс бөгөөс унтраалтын мөчид хүлээж байсан thread нь
        /// timeout-оо дуустал (120 сек) гацна.
        ///
        /// ⚠️ ХЭЗЭЭ Ч алдаа шидэхгүй — унтраалт дээр шидэгдсэн алдаа нь
        /// Revit-ийн хаагдалтыг гацаана.
        /// </summary>
        public static void Shutdown()
        {
            ExternalEvent ev = _event;
            _event = null;
            _handler = null;

            ToolCall pending;
            while (Queue.TryDequeue(out pending))
            {
                try
                {
                    pending.Success = false;
                    pending.Error = "Revit хаагдаж байна.";
                    pending.Done.Set();
                }
                catch { }
            }

            try { ev?.Dispose(); }
            catch { /* Dispose нь боломжгүй бол ч унтраалт үргэлжилнэ */ }
        }

        /// <summary>
        /// Боловсруулагч зүсэлтийн хязгаартаа хүрээд дараалалд ажил үлдсэн
        /// үед дуудна.  ⚠️ `Execute` ДОТРООС `Raise` хийх нь аюулгүй —
        /// Revit дараагийн боломжит мөчид дахин дуудна.
        /// </summary>
        internal static void RaiseAgain()
        {
            try { _event?.Raise(); } catch { }
        }

        /// <summary>
        /// Хэрэгслийг дуудаж, үр дүнг хүлээнэ.  Дурын thread-ээс дуудаж болно
        /// (гэхдээ Revit-ийн ҮНДСЭН thread-ээс БИШ — тэгвэл өөрийгөө хүлээж
        /// гацна; UI thread-ээс дуудахдаа `Task.Run`-аар оруул).
        /// </summary>
        public static ToolCall Call(string tool, string argsJson, int timeoutSeconds = 120)
        {
            // ⚠️ ЗӨВХӨН DEBUG build дээр — Хориглолт №7-ийн гэрээ.  Ажиллах
            //    үеийн зан төлөвт НӨЛӨӨЛӨХГҮЙ (`Conditional("DEBUG")`).
            AssertNotHoldingTrackerGate(tool);

            var call = new ToolCall { Tool = tool, ArgsJson = argsJson };

            // ⚠️ ХЭМЖИЛТ (1C): цагийг `Gate`-ЭЭС ӨМНӨ эхлүүлнэ — яг л
            // `deadline`-тэй адил шалтгаанаар.  `Gate`-ийн дараа эхлүүлбэл
            // дарааллын хүлээлт хэмжилтээс АЛГА болж, «Revit удаан» гэсэн
            // худал дүгнэлт гарна.
            var sw = System.Diagnostics.Stopwatch.StartNew();

            // ⚠️⚠️ `Finish` НЬ `Gate`-ЭЭС ГАДНА АЖИЛЛАНА (2026-08-28).
            //
            // Урьд нь `Finish(call, sw)` нь `Call`-ийн ГУРВАН гарц дээр
            // `finally { Gate.Release(); }`-ийн ДОТОР дуудагддаг байв.
            // `Finish` нь `Metrics.Emit` дууддаг бөгөөд тэр үед `Emit` нь
            // СИНХРОН дискний бичилт хийдэг байсан — өөрөөр хэлбэл
            // ХЭМЖИЛТИЙН I/O нь семафорыг барьж, ДАРААГИЙН дуудлагын
            // `MsQueueWait`-ыг ӨӨРӨӨ уртасгаж байлаа.  Хэмжигч нь хэмжиж
            // буй тоогоо гажуудуулж байсан гэсэн үг.
            //
            // Хоёр давхар засвар, хоёулаа хэрэгтэй:
            //   1. `Metrics.Emit` одоо буфферлэдэг — өнөөдрийн зардал ~0.
            //   2. `Finish` нь `CallCore` буцаж, `Gate` СУЛАРСНЫ ДАРАА
            //      ажиллана — ирээдүйд `Finish` дотор ямар нэг үнэтэй зүйл
            //      нэмэгдэхэд семафор дахин бохирдохгүй.
            //
            // ⚠️ `finally` — `CallCore` алдаа шидсэн ч хэмжилт бичигдэнэ.
            try
            {
                CallCore(call, sw, timeoutSeconds);
            }
            finally
            {
                Finish(call, sw);
            }
            return call;
        }

        /// <summary>
        /// `Call`-ийн бие.  ⚠️ `Gate`-ийг ЭНД авч, ЭНД суллана; хэмжилтийн
        /// бичилт (`Finish`) нь энэ метод БУЦСАНЫ дараа гүйцэтгэгдэнэ.
        /// </summary>
        private static void CallCore(
            ToolCall call, System.Diagnostics.Stopwatch sw, int timeoutSeconds)
        {
            if (_event == null)
            {
                call.Success = false;
                call.Error = "Хэрэгслийн гарц эхлээгүй байна (App.OnStartup амжилтгүй болсон уу?).";
                return;
            }

            // ⚠️ ХУГАЦААГ ЭНД ЭХЛҮҮЛНЭ, `Gate`-ийн ДАРАА БИШ.
            //
            // Урьд нь `Gate.Wait()` нь ХУГАЦААГҮЙ бөгөөд deadline-ийг түүний
            // ДАРАА тооцдог байв.  Өмнөх дуудлага 120 секунд барьж байвал энэ
            // дуудлага 120 секунд түгжээнд хүлээгээд, ДАРАА НЬ өөрийн 120
            // секундээ эхлүүлдэг — бодит хүлээлт 240 секунд.  Гэтэл алдааны
            // мессеж нь «120s дууслаа» гэж ХУДАЛ хэлдэг байсан тул
            // оношилгоо хийх боломжгүй байв (2026-08-25).
            int deadline = Environment.TickCount + Math.Max(1, timeoutSeconds) * 1000;

            if (!Gate.Wait(Math.Max(1, timeoutSeconds) * 1000))
            {
                call.MsQueueWait = sw.Elapsed.TotalMilliseconds;
                call.TimedOut = true;
                call.Success = false;
                call.Error =
                    $"Хугацаа дууслаа ({timeoutSeconds}s) — өмнөх үйлдэл дуусаагүй байна.";
                return;
            }

            call.MsQueueWait = sw.Elapsed.TotalMilliseconds;

            try
            {
                Queue.Enqueue(call);
                call.EnqueuedTicks = System.Diagnostics.Stopwatch.GetTimestamp();
                // ⚠️ `Raise()`-ЭЭС ӨМНӨ хаана.  `MsEventWait` нь дээрх
                // `EnqueuedTicks`-ээс эхэлдэг тул `Raise`-ийн дараа хаавал
                // тэр хугацаа хоёр сегментэд давхар тоологдоно (`MsEnqueue`
                // талбарын тайлбарыг үз).
                call.MsEnqueue = sw.Elapsed.TotalMilliseconds - call.MsQueueWait;

                ExternalEventRequest raised = _event.Raise();
                // `Pending` = өмнөх raise хараахан боловсруулагдаагүй.  Бидний
                // дуудлага дараалалд орсон тул ХҮЛЭЭНЭ, алдаа гэж үзэхгүй.
                if (raised != ExternalEventRequest.Accepted && raised != ExternalEventRequest.Pending)
                {
                    call.Success = false;
                    call.Error = "Revit хүсэлтийг хүлээж авсангүй: " + raised;
                    return;
                }

                while (!call.Done.IsSet)
                {
                    if (call.Done.Wait(50)) break;
                    // `Environment.TickCount` нь ~49 хоногт эргэдэг; ялгаварыг
                    // int-ээр тооцвол эргэлт дээр ч зөв ажиллана.
                    if (unchecked(Environment.TickCount - deadline) > 0)
                    {
                        // ⚠️ ЗААВАЛ ТЭМДЭГЛЭНЭ.  Үүнгүйгээр дуудлага дараалалд
                        // үлдэж, Revit эцэст нь түүнийг БҮТНЭЭР гүйцэтгэдэг —
                        // дараагийн дуудлага түүний ард хүлээж, баталгаатай
                        // дахин унадаг байв.
                        call.Abandoned = true;
                        call.TimedOut = true;
                        call.Success = false;
                        call.Error =
                            $"Хугацаа дууслаа ({timeoutSeconds}s). Revit завгүй байх эсвэл модаль цонх нээлттэй байж магадгүй.";
                        return;
                    }
                }

                // `Done.Set`-ээс энэ мөр хүртэлх сүүл — `Wait(50)`-ийн
                // мөчлөгийн үлдэгдэл энд харагдана.
                //
                // ⚠️ ШУУД ХЭМЖИНЭ.  Хасах арга нь `MsEnqueue`/`MsEventWait`
                // давхцалаас болж бараг үргэлж 0 өгдөг байв.
                long doneTicks = call.DoneTicks;
                call.MsResponse = doneTicks == 0
                    ? 0
                    : (System.Diagnostics.Stopwatch.GetTimestamp() - doneTicks)
                      * 1000.0 / System.Diagnostics.Stopwatch.Frequency;
            }
            finally
            {
                Gate.Release();
            }
        }

        /* ============================================================== */
        /*  ХЭМЖИЛТ (1C) — хуримтлуулагч ба «сүүлийн дуудлага»              */
        /* ============================================================== */

        /// <summary>
        /// `Call`-ийн БҮХ гарцад дуудагдана — `MsTotal`-ыг бичиж,
        /// хуримтлуулагчид нэмнэ.  ⚠️ ХЭЗЭЭ Ч алдаа шидэхгүй.
        /// </summary>
        private static void Finish(ToolCall call, System.Diagnostics.Stopwatch sw)
        {
            try
            {
                call.MsTotal = sw.Elapsed.TotalMilliseconds;
                _lastTotalMs = call.MsTotal;
                _lastQueueMs = call.MsQueueWait;
                _lastEventMs = call.MsEventWait;
                _lastExecMs = call.MsRevitExec;
                bool ok = call.Success && !call.TimedOut;
                Metrics.ToolTotal.Add(call.MsTotal, ok);
                Metrics.ToolQueue.Add(call.MsQueueWait, ok);
                Metrics.ToolEvent.Add(call.MsEventWait, ok);
                Metrics.ToolExec.Add(call.MsRevitExec, ok);
                // ⚠️ `Metrics.Emit` — `Debug.WriteLine` БИШ.  `DEBUG` тогтмол
                // энэ төслийн АЛЬ Ч Configuration дээр тодорхойлогддоггүй
                // («Release R27» → TRACE;MCP_EXECUTOR;RELEASE_R27), тул
                // `Debug.WriteLine` нь хэзээ ч гүйцэтгэгддэггүй байв.
                // Нотолгоо ба хаяг: `Percentiles.cs`-ийн `Metrics.Emit`.
                //
                // ⚠️ ЭНЭ АРГА нь ДУУДАГЧИЙН thread дээр (ердийн үед
                // `Task.Run`-ы арын thread) ажиллана — Revit-ийн ҮНДСЭН
                // thread дээр БИШ.  ГЭХДЭЭ энд ФАЙЛЫН I/O ХИЙХГҮЙ:
                // `Metrics.Emit` нь буфферлэж, арын бичигч дискэнд гаргана.
                // Мөн `Call` нь энэ аргыг `Gate` СУЛАРСНЫ ДАРАА дууддаг.
                Metrics.Emit(string.Format(
                    System.Globalization.CultureInfo.InvariantCulture,
                    "[MGL/timing] tool={0} total={1:F0} queue={2:F0} enq={3:F0} " +
                    "event={4:F0} exec={5:F0} resp={6:F0} timedOut={7}",
                    call.Tool, call.MsTotal, call.MsQueueWait, call.MsEnqueue,
                    call.MsEventWait, call.MsRevitExec, call.MsResponse, call.TimedOut));
            }
            catch { }
        }

        private static double? _lastTotalMs;
        private static double? _lastQueueMs;
        private static double? _lastEventMs;
        private static double? _lastExecMs;

        /// <summary>
        /// Хамгийн сүүлийн хэрэгслийн дуудлагын хэмжилт — бүртгэлийн мөрөнд
        /// хавсаргахад.  ⚠️ Дуудлага огт болоогүй бол null.
        /// ⚠️ Нэг мессежид ХЭД ХЭДЭН хэрэгсэл дуудагдвал ЗӨВХӨН СҮҮЛИЙНХ нь
        /// бичигдэнэ — задаргаа нь `Metrics`-д бүрэн хуримтлагдана.
        /// </summary>
        public static double? LastCallTotalMs => _lastTotalMs;
        public static double? LastCallQueueMs => _lastQueueMs;
        public static double? LastCallEventMs => _lastEventMs;
        public static double? LastCallExecMs => _lastExecMs;

        /// <summary>
        /// ХЭМЖИЛТИЙН ЦЭВЭРЛЭГЭЭ — мессеж БҮРИЙН эхэнд дуудна.
        ///
        /// ⚠️ ЯАГААД ЗААВАЛ ХЭРЭГТЭЙ ВЭ: дээрх дөрвөн талбар нь «хамгийн
        /// сүүлийн дуудлага» бөгөөд ЦЭВЭРЛЭГДДЭГГҮЙ байв.  `AssistantPane`
        /// нь мессеж бүрийн төгсгөлд тэднийг УНШИЖ `assistant_logs`-д
        /// бичдэг тул хэрэгсэл ОГТ дуудаагүй мессеж (жишээ нь
        /// `exit=fallback`) нь ӨМНӨХ мессежийн `t_tool_*` утгуудыг өөрийн
        /// болгож зөөдөг байсан.  Сервер тал дээр тэр нь «fallback зам 8
        /// секунд хэрэгсэл дуудсан» гэсэн ХУДАЛ хэв маяг үүсгэнэ.
        ///
        /// ⚠️ Хуримтлуулагч (`Metrics.Tool*`) ЦЭВЭРЛЭГДЭХГҮЙ — тэдгээр нь
        /// сессийн туршид хуримтлагдах ЁСТОЙ.
        ///
        /// ⚠️ `busy` гарц дээр БҮҮ ДУУД: тэр үед ӨМНӨХ мессеж ГҮЙЖ байгаа
        /// бөгөөд эдгээр талбарууд түүнийх.
        /// </summary>
        public static void ResetLastCall()
        {
            _lastTotalMs = null;
            _lastQueueMs = null;
            _lastEventMs = null;
            _lastExecMs = null;
        }
    }

    /// <summary>
    /// Revit-ийн ҮНДСЭН thread дээр ажиллана.  Дарааллаас дуудлага авч
    /// `RevitTools.Run`-д шилжүүлнэ.  Энд Transaction нээх нь АЮУЛГҮЙ.
    /// </summary>
    public class RevitToolEventHandler : IExternalEventHandler
    {
        private readonly ConcurrentQueue<ToolCall> _queue;

        public RevitToolEventHandler(ConcurrentQueue<ToolCall> queue) => _queue = queue;

        public string GetName() => "MglRevitTools";

        /// <summary>
        /// ⚠️ НЭГ ЗҮСЭЛТЭД БОЛОВСРУУЛАХ ДЭЭД ТОО.
        ///
        /// Урьд нь `while` нь дарааллыг ХООСРОХ хүртэл эргэлддэг байв.  Revit
        /// энэ хугацаанд мессежийн давталтаа эргүүлж чадахгүй тул програм
        /// БҮХЭЛДЭЭ хөлддөг.  Одоо хязгаартай — үлдсэн нь дараагийн зүсэлтэд
        /// (`Raise` дахин дуудагдана) боловсрогдоно.
        /// </summary>
        private const int MaxPerSlice = 4;

        /// <summary>
        /// ⛔ ИНФЕРЕНС ЭНД ХЭЗЭЭ Ч БАЙХГҮЙ.
        ///
        /// Энэ арга нь Revit-ийн ҮНДСЭН thread дээр, `ExternalEvent`-ийн
        /// зүсэлт дотор ажиллана.  Сүлжээний дуудлага (LLM) нь Revit-ийн
        /// мессежийн давталтыг бүхэлд нь барих тул програм ХӨЛДӨНӨ —
        /// `MaxPerSlice` хязгаар нь ЯГ ТЭР шалтгаанаар оршдог.
        ///
        /// Хэрэгслийн үр дүнг ЭНДЭЭС гаргаж, LLM-ийн дуудлагыг
        /// `AgentChat.RunAsync`-ийн давталт дотор (АРЫН thread) хий.
        /// Зөвшөөрөгдсөн цорын ганц суулгац нь `AssistantPane`-ийн
        /// `DecidedBy.Fallback` салаа.
        /// </summary>
        public void Execute(UIApplication app)
        {
            int done = 0;
            while (done < MaxPerSlice && _queue.TryDequeue(out ToolCall call))
            {
                // ⚠️ ХЭМЖИЛТ (1C): `Raise`-ээс энэ мөч хүртэлх хугацаа —
                // «Revit биднийг хэр удаан хүлээлгэсэн бэ».
                // ⚠️ `Abandoned` салаанд Ч бичнэ: «хаягдсан дуудлага хэдэн
                // секунд дараалалд байсан» гэдэг нь ӨӨРӨӨ оношилгоо.
                if (call.EnqueuedTicks != 0)
                {
                    call.MsEventWait =
                        (System.Diagnostics.Stopwatch.GetTimestamp() - call.EnqueuedTicks)
                        * 1000.0 / System.Diagnostics.Stopwatch.Frequency;
                }

                // ⚠️ Дуудагч нь аль хэдийн ЯВСАН — үнэтэй ажлыг хийх утгагүй.
                // Энэ шалгалтгүйгээр «сүнс» ажил Revit-ийг барьж, дараагийн
                // бодит дуудлагыг унагадаг байв.
                if (call.Abandoned)
                {
                    call.Done.Set();
                    continue;
                }

                done++;
                long execStart = System.Diagnostics.Stopwatch.GetTimestamp();
                try
                {
                    call.ResultJson = RevitTools.Run(app, call.Tool, call.ArgsJson);
                    call.Success = true;
                }
                catch (Exception ex)
                {
                    call.Success = false;
                    call.Error = ex.GetType().Name + ": " + ex.Message;
                }
                finally
                {
                    // ⚠️ ХЭМЖИЛТ: `Done.Set`-ЭЭС ӨМНӨ бич — дуудагч тэр
                    // мөчид сэрж, утгыг уншиж магадгүй.
                    long endTicks = System.Diagnostics.Stopwatch.GetTimestamp();
                    call.MsRevitExec =
                        (endTicks - execStart)
                        * 1000.0 / System.Diagnostics.Stopwatch.Frequency;
                    // ⚠️ `MsResponse`-ийн ЭХЛЭЛ.  Дуудагч тал `Wait(50)`
                    // мөчлөгөөр сэрдэг тул «Done тавигдсанаас хойш хэдэн мс
                    // үрэгдсэн»-ийг ЗӨВХӨН эндээс шууд хэмжиж болно.
                    call.DoneTicks = endTicks;
                    // Хэзээ ч тавихаа мартаж болохгүй — дуудагч мөнхөд хүлээнэ.
                    call.Done.Set();
                }
            }

            // ⚠️ Дараалалд үлдсэн бол ДАХИН дуудуулна.  Үүнгүйгээр хязгаар нь
            // үлдсэн дуудлагыг мөнхөд хүлээлгэнэ — тэд `Raise` хийгдсэн боловч
            // энэ зүсэлтэд хүрээгүй байна.
            if (!_queue.IsEmpty) RevitToolBus.RaiseAgain();
        }
    }
}
