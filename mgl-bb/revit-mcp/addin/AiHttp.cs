using System;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;

namespace RevitMcpAddin
{
    /// <summary>
    /// §75-ын ДОРОЙТЛЫН ТАВАН ШАТ.
    ///
    /// ⚠️ `Off` нь АЛДАА БИШ — эзний унтраалга (`bim.events.logging = off`
    /// эсвэл `bim.compliance.mode = off`).  Тэр үед Revit БҮРЭН хэвийн.
    /// </summary>
    internal enum DegradeState
    {
        /// <summary>Бүх зүйл хариулж байна.</summary>
        Normal = 0,
        /// <summary>AI хариулахгүй — детерминист дүрэм ажилласаар байна.</summary>
        DegradedAi = 1,
        /// <summary>5xx / хугацаа дуусав — ЛОКАЛ дараалал ажилласаар байна.</summary>
        DegradedServer = 2,
        /// <summary>Сүлжээ байхгүй — ЛОКАЛ дараалал ажилласаар байна.</summary>
        DegradedOffline = 3,
        /// <summary>Сервер `{ingest:'off'}` буцаав эсвэл горим унтраагдсан.</summary>
        Off = 4,
    }

    /// <summary>
    /// AI / compliance / BIM-бүртгэлийн ТУСДАА HTTP тээвэр (v2 §32).
    ///
    /// ⚠️ `ApiClient.Http`-ЫГ ДАХИН АШИГЛАХГҮЙ.  Тэр нь 180 СЕКУНДЫН
    /// хугацаатай (`ApiClient.cs:56`) бөгөөд 20 000 мөрийн QTO push ба хэдэн
    /// MB-ийн PDF-д ЗОРИУЛЖ тохируулагдсан.  v2 §32 нь «Do not reuse an
    /// unrelated 180-second HTTP timeout» гэж ШУУД хориглосон: гацсан сервер
    /// дээр илгээгчийн thread гурван минут амьд үлдэх нь «bounded resource
    /// usage» шалгуурыг зөрчинө.
    ///
    /// ⚠️ USER-AGENT-ИЙН УГТВАР ЗААВАЛ ХЭВЭЭР (доорх `Create`-ийг үз).  UA-гүй
    /// хүсэлтийг Cloudflare-ийн «Browser Integrity Check» нь Worker-т
    /// ХҮРЭХЭЭС нь ӨМНӨ **403 (error code 1010)**-аар хаадаг — 2026-08-25-нд
    /// ХЭМЖИЖ баталсан (`ApiClient.cs:58-84`).  ~20 компьютер дээр автомат
    /// шинэчлэл байхгүй тул энэ бол АЛСААС сэргээх БОЛОМЖГҮЙ алдаа.
    /// ⚠️ ТАРААХААС ӨМНӨ НЭГ МАШИН ДЭЭР ТУРШ: хугацаа дууссан токеноор нэг
    /// дуудлага → **401** ирэх ёстой, 403 БИШ.
    ///
    /// ⚠️ REVIT-ИЙН ЯМАР Ч ТӨРӨЛ БАЙХГҮЙ — net48 (R24) build дээр
    /// ч эмхэтгэгдэнэ.
    /// </summary>
    internal static class AiHttp
    {
        /// <summary>§32 «per-operation timeout».</summary>
        internal const int TimeoutSeconds = 20;

        /// <summary>§32 «bounded retry» — НИЙТ оролдлого = 1 + MaxRetries.</summary>
        internal const int MaxRetries = 2;

        /// <summary>§32 «bounded concurrency».  Илгээгч + дүрмийн багц татагч.</summary>
        private const int MaxConcurrency = 2;

        /// <summary>Дахин оролдлогын хоорондох ХАМГИЙН БАГА завсар.  Урт
        /// backoff нь ДУУДАГЧИЙНХ (`BimEmitter`), энэ нь зөвхөн шуургыг
        /// зөөлрүүлнэ.</summary>
        private const int RetryDelayMs = 400;

        private static readonly SemaphoreSlim Concurrency =
            new SemaphoreSlim(MaxConcurrency, MaxConcurrency);

        /// <summary>
        /// ⚠️ ТУСДАА КЛИЕНТ.  `ApiClient.Http`-тай ХЭЗЭЭ Ч холилдохгүй.
        /// `HttpClient` нь thread-safe тул статик нэг instance зөв (socket
        /// exhaustion-оос хамгаална).
        /// </summary>
        internal static readonly HttpClient Http = Create();

        private static HttpClient Create()
        {
            var c = new HttpClient { Timeout = TimeSpan.FromSeconds(TimeoutSeconds) };
            // ⚠️ УГТВАРЫГ БҮҮ УСТГА — дээрх тайлбарыг үз.
            c.DefaultRequestHeaders.UserAgent.ParseAdd("MglRevitAddin/" + BuildInfo.Version);
            c.DefaultRequestHeaders.Accept.ParseAdd("application/json");
            return c;
        }

        private static int _consecutiveFailures;
        private static int _state = (int)DegradeState.Normal;

        /// <summary>§32 «observable status» — самбар ба сесс энэ утгыг уншина.</summary>
        public static DegradeState State
        {
            get { return (DegradeState)Volatile.Read(ref _state); }
        }

        public static int ConsecutiveFailures
        {
            get { return Volatile.Read(ref _consecutiveFailures); }
        }

        /// <summary>Дуудагч (ж: `{ingest:'off'}`) төлөвийг ил тавьж болно.</summary>
        internal static void SetState(DegradeState s)
        {
            Volatile.Write(ref _state, (int)s);
        }

        /// <summary>
        /// Хүсэлт илгээнэ.  §32-ын таван шаардлагыг БҮГДИЙГ хангана:
        /// `CancellationToken`, per-operation timeout, bounded retry,
        /// bounded concurrency, ажиглагдах төлөв.
        ///
        /// ⚠️ `makeRequest` нь ФАБРИК, объект БИШ: `HttpRequestMessage`-ыг
        /// ХОЁР УДАА илгээх боломжгүй (`InvalidOperationException`), тиймээс
        /// дахин оролдлого бүр ШИНЭ объект шаардана.
        ///
        /// ⚠️ ЗӨВХӨН СҮЛЖЭЭНИЙ АЛДАА ба 5xx-д дахин оролдоно.  4xx (401 / 413)
        /// нь ХАРИУЛТ — давтахад ижил үр дүн гарах ба зөвхөн серверийг
        /// дэмий ачаална.
        ///
        /// ⚠️ Хугацаа нь `Metrics.EmitPost`-д бичигдэнэ (амжилтгүй ч бичигдэнэ
        /// — `ok:false` нь алдааны хувь болж хуримтлагдана).
        ///
        /// Буцах утга: хариу, эсвэл БҮХ оролдлого унасан бол `null`.
        /// ⚠️ ХЭЗЭЭ Ч алдаа шидэхгүй (`OperationCanceledException`-оос бусад
        /// нь залгигдана; цуцлалт нь ХЭВИЙН унтраалт тул null буцаана).
        /// </summary>
        public static async Task<HttpResponseMessage> SendAsync(
            Func<HttpRequestMessage> makeRequest, CancellationToken ct)
        {
            if (makeRequest == null) return null;

            var sw = System.Diagnostics.Stopwatch.StartNew();
            bool ok = false;
            try
            {
                try { await Concurrency.WaitAsync(ct).ConfigureAwait(false); }
                catch (OperationCanceledException) { return null; }

                try
                {
                    for (int attempt = 0; attempt <= MaxRetries; attempt++)
                    {
                        if (ct.IsCancellationRequested) return null;

                        HttpRequestMessage req = null;
                        try
                        {
                            req = makeRequest();
                            if (req == null) return null;

                            HttpResponseMessage res =
                                await Http.SendAsync(req, ct).ConfigureAwait(false);

                            int code = (int)res.StatusCode;
                            if (code < 500)
                            {
                                // 2xx / 3xx / 4xx — ЭНЭ БОЛ ХАРИУЛТ.  Токен
                                // хүчингүй (401) байх нь сүлжээний алдаа БИШ
                                // тул дахин оролдохгүй; дуудагч шийднэ.
                                if (code < 400) MarkSuccess();
                                else MarkFailure(DegradeState.DegradedServer);
                                ok = code < 400;
                                return res;
                            }

                            // 5xx — дахин оролдоно.
                            res.Dispose();
                            MarkFailure(DegradeState.DegradedServer);
                        }
                        catch (OperationCanceledException)
                        {
                            // Цуцлалт (унтраалт) ЭСВЭЛ 20 секундын хугацаа —
                            // net48 дээр хоёулаа ижил төрлөөр гарна.
                            if (ct.IsCancellationRequested) return null;
                            MarkFailure(DegradeState.DegradedServer);
                        }
                        catch (HttpRequestException)
                        {
                            // DNS / TCP — сүлжээ БАЙХГҮЙ.
                            MarkFailure(DegradeState.DegradedOffline);
                        }
                        catch (Exception)
                        {
                            MarkFailure(DegradeState.DegradedServer);
                        }
                        finally
                        {
                            try { req?.Dispose(); } catch { }
                        }

                        if (attempt < MaxRetries)
                        {
                            try { await Task.Delay(RetryDelayMs, ct).ConfigureAwait(false); }
                            catch (OperationCanceledException) { return null; }
                        }
                    }
                    return null;
                }
                finally
                {
                    try { Concurrency.Release(); } catch { }
                }
            }
            finally
            {
                sw.Stop();
                try { Metrics.EmitPost.Add(sw.Elapsed.TotalMilliseconds, ok); } catch { }
            }
        }

        private static void MarkSuccess()
        {
            Volatile.Write(ref _consecutiveFailures, 0);
            Volatile.Write(ref _state, (int)DegradeState.Normal);
        }

        private static void MarkFailure(DegradeState s)
        {
            Interlocked.Increment(ref _consecutiveFailures);
            // ⚠️ `Off` нь эзний шийдвэр — сүлжээний алдаа түүнийг ДАРЖ
            //    БИЧИХГҮЙ, эс бөгөөс унтраасан суулгац дахин асна.
            if (Volatile.Read(ref _state) != (int)DegradeState.Off)
                Volatile.Write(ref _state, (int)s);
        }
    }
}
