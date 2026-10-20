using System;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Autodesk.Revit.UI;

namespace RevitMcpAddin
{
    /// <summary>
    /// Revit external application entry point. On startup it creates the
    /// ExternalEvent that marshals work onto Revit's main thread and starts a
    /// small localhost HTTP server that the Python MCP server talks to.
    /// </summary>
    public class App : IExternalApplication
    {
#if MCP_EXECUTOR
        private HttpServer _server;
#endif

        /// <summary>
        /// COMPLIANCE-ИЙН ЦУЦЛАЛТЫН ТОКЕН — процессын турш НЭГ.
        ///
        /// ⚠️ `App` нь ЭЗЭМШИГЧ, `2-3`-ын `ComplianceScheduler` нь
        /// ХЭРЭГЛЭГЧ (`App.ComplianceCts.Token`).  Унтраалтын АЛХАМ 0-д
        /// `Cancel()` хийгддэг — `RevitToolBus.CancelAll()`-ЫН ӨМНӨ, ямар ч
        /// `Join`-ЫН ӨМНӨ.  Тэр дараалал нь `OnShutdown`-д бичигдсэн ба
        /// түүнийг өөрчлөх нь Revit-ийн хаагдалтыг гацаана.
        ///
        /// ⚠️ Планировщик хараахан шипээгүй ч энэ талбар ОДООНООС оршино:
        /// цуцлалтын дараалал нь дараа нь «нэмэх» зүйл БИШ, унтраалтын
        /// зөв байдлын үндэс.
        /// </summary>
        internal static readonly System.Threading.CancellationTokenSource ComplianceCts =
            new System.Threading.CancellationTokenSource();

        public Result OnStartup(UIControlledApplication application)
        {
            // ⚠️ Typed хэрэгслийн гарц — ЭНЭ НЬ `#if MCP_EXECUTOR` дотор байж
            // БОЛОХГҮЙ.  «MGL туслах» самбар болон «Зураг холбох» хоёул үүгээр
            // явдаг бөгөөд MCP код-гүйцэтгэгчээс (Roslyn) огт хамааралгүй —
            // зөвхөн ExternalEvent хэрэгтэй, тэр нь Revit-ийн бүх хувилбарт бий.
            // Урьд нь `#if` дотор байсан тул Revit 2024 (net48) build дээр гарц
            // хэзээ ч эхлэхгүй, самбарын үйлдэл бүр «Хэрэгслийн гарц эхлээгүй
            // байна» гэж унадаг байв.
            //
            // ExternalEvent-ийг ҮҮСГЭХ нь ЗӨВХӨН OnStartup дээр (Revit-ийн API
            // дүрэм) — дараа нь дурын thread-ээс Raise хийж болно.
            //
            // Тусдаа try: эндээс шидэгдсэн алдаа OnStartup-аас гарвал Revit
            // add-in-ыг «унасан» гэж үзэж, доорх самбарын бүртгэл ба туузан цэс
            // хоёулаа огт үүсэхгүй.  TaskDialog харуулахгүй — batch горимд хүн
            // байхгүй тул модаль цонх бүх автоматыг түгжинэ.
            // ⚠️ ХЭМЖИЛТИЙН АРЫН БИЧИГЧ — ЭХЛЭЛД, ХАМГИЙН ЭХЭНД.
            //
            // `Metrics.Emit` нь эхний дуудлагадаа thread үүсгэж, бичих
            // замыг JIT хийдэг — ХЭМЖСЭН нь 4.0 мс.  Түүнийг энд төлөхгүй
            // бол тэр өртөг хэрэглэгчийн ЭХНИЙ мессежийн UI thread дээр
            // унаж, `t_total_ms`-д нэмэгдэнэ: хэмжигч нь хэмжиж буй тоогоо
            // өөрөө өсгөнө.  Revit-ийн ачаалалт дээр 4 мс нь харагдахгүй.
            //
            // ⚠️ ХЭЗЭЭ Ч алдаа шидэхгүй, гэхдээ OnStartup-ийн бусад
            // блокуудтай адил тусдаа try — хэмжилт нь add-in-ыг унагаах
            // ЁСГҮЙ.
            try { Metrics.Start(); } catch { }

            try
            {
                RevitToolBus.Init();
            }
            catch
            {
                // Гарц эхлээгүй — самбар нь өөрөө ойлгомжтой алдаа харуулна.
            }

            // ⚠️ BIM ҮЙЛ ЯВДЛЫН ИЛГЭЭГЧ — `Metrics.Start()`-ийн ДАРАА,
            // `ChangeTracker.Init`-ийн ӨМНӨ.  Тэр дараалал нь шаардлагатай:
            // илгээгчийн `_post` thread нь курсорыг дискнээс уншиж дуустал
            // `_pump` мөрийн дугаар олгохгүй, харин `ChangeTracker` нь
            // бүртгэгдмэгц ЭХНИЙ гүйлгээ цагирагт орж болно.
            //
            // ⚠️ ЭНД ДИСК ХӨНДӨХГҮЙ — `Start` нь зөвхөн хоёр `IsBackground`
            // thread үүсгэнэ; файл унших нь тэдний дотор.
            //
            // ⚠️ ТУСДАА try — эндээс шидэгдсэн алдаа add-in-ыг унагаах ЁСГҮЙ.
            // Илгээгчгүй ч Revit БҮРЭН хэвийн ажиллана; зөвхөн сургалтын
            // дэвтэр хоосон үлдэнэ.
            try
            {
                BimEmitter.Start(
                    application.ControlledApplication?.VersionNumber,
                    application.ControlledApplication?.VersionBuild);
            }
            catch
            {
                // Илгээгч эхлээгүй — бүртгэлгүйгээр үргэлжилнэ.
            }

            // ⚠️ ӨӨРЧЛӨЛТ МӨРДӨГЧ — ЗӨВХӨН энд бүртгэж болно.  Revit-ийн
            // `DocumentChanged` үйл явдалд OnStartup дээр л холбогдоно.
            //
            // Үүнгүйгээр «юу өөрчлөгдсөн» нь хуудас бүрийн харагдац бүрийг
            // regenerate хийж сканнердах ба бодит төсөл дээр 120 секундын
            // хугацаа дуусдаг байв (2026-08-25-ны гомдол).  Одоо Revit
            // өөрөө хэлдэг тул зардал нь тэг.
            //
            // Тусдаа try: бүртгэл унавал ХЯМД нөөц зам ажиллана, харин
            // OnStartup-аас алдаа гарвал add-in бүхэлдээ ачаалагдахгүй.
            try
            {
                ChangeTracker.Init(application.ControlledApplication);
            }
            catch
            {
                // Мөрдөгч эхлээгүй — `RevitTools` нөөц зам руу шилжинэ.
            }

            // Багийн контекстийн КЭШ — диск + JSON, Revit API БАЙХГҮЙ.
            // ⚠️ Тусдаа try: кэш эвдэрсэн бол баг «тодорхойгүй» болно,
            //    add-in бүхэлдээ ачаалагдахгүй байх нь ХАМААГҮЙ дор.
            // ⚠️ `LoadCache()` нь `TeamContext.Current`-ыг ЧУХ БӨГЛӨНӨ —
            //    `ShouldRefresh` тэндээс тооцогдоно.  `null` үлдвэл эхний
            //    асуулга ЗААВАЛ явна (`ShouldRefresh(null, …) == true`).
            try { TeamContext.Current = TeamContext.LoadCache(); }
            catch { /* кэшгүй эхэлнэ — сервер эхний хүсэлтэд хариулна */ }

            // ⚠️ НИЙЦЛИЙН ХУВААРИЛАГЧ — `BimEmitter.Start()` ба
            // `ChangeTracker.Init()`-ийн ДАРАА, `TeamContext.LoadCache()`-ийн
            // ДАРАА.  Гурвуулаа шаардлагатай: дэгээ нь илгээгчийн `_pump`
            // урсгал дээр суудаг, өөрчлөлт нь мөрдөгчөөс ирдэг, ба ямар
            // дүрмийн багц ачаалахыг багийн кэш шийднэ.
            //
            // ⚠️ Revit-д хүрэх талыг ЭНД холбоно (`RuleInputBusSource`).
            // `ComplianceScheduler.cs` нь `Autodesk.Revit`-ийн ямар ч төрөл
            // дурддаггүй — тэр нь Revit суулгалтгүйгээр тестлэгдэх нөхцөл.
            //
            // ⚠️ ШИНЭ ТАЙМЕР БАЙХГҮЙ.  Хуваарилагч нь өөрийн `IsBackground`
            // урсгалтай; `ChangeTracker`-ийн 3 секундын ДАВТАМЖИТ таймер дээр
            // ажил нэмэх нь өдрийн өөрчлөлтийг ЧИМЭЭГҮЙ алдагдуулна.
            //
            // Тусдаа try: нэг дэд системийн уналт add-in-ыг БҮХЭЛД НЬ
            // унагаах ЁСГҮЙ.
            try
            {
                ComplianceScheduler.Init(new RuleInputBusSource(), ComplianceCts.Token);
            }
            catch
            {
                // Хуваарилагч эхлээгүй — зурах, чат, QTO БҮГД хэвийн.
            }

#if MGL_INTELLIGENCE
            // SESSION R — Revit Intelligence хост: `ComplianceScheduler.Init`-ийн ДАРАА
            // (`BimEmitter.ComplianceHook`-д `+=`-ээр залгадаг тул тэр `=`-ийн дараа
            // байх ёстой), самбарын бүртгэлээс ӨМНӨ.  Тусдаа try — Intelligence
            // унасан ч add-in-ийн бусад хэсэг ажиллана.
            try { Intelligence.Revit.RevitIntelligenceHost.Init(application); } catch { }
#endif

#if MGL_WORK_TRACKING
            // Автомат цаг бүртгэл (Session 4) — Revit-ийн үйл явдалд холбогдоод арын
            // timer эхлүүлнэ.  Диск/сүлжээ энд БАЙХГҮЙ (арын thread).  Тусдаа try.
            try { WorkTracking.WorkTrackingHost.Init(application); } catch { }
#endif

#if MGL_SMART
            // MGL Smart (Publish / Count / Clash / Impact) — ExternalEvent гарц, өөрчлөлтийн бүртгэл.
            // Тусдаа try: энэ дэд системийн уналт add-in-ийг ачаалагдахгүй болгох ёсгүй.
            try { Smart.SmartHost.Init(application); } catch { }
            // «Revit-д шууд зөөхөд шалгах»: сонголт + DocumentChanged-аар цэвэр зөөлтийг таньж, мөргөлдөөн/дагах элемент байвал жижиг цонх гаргана.
            try { ChangeImpact.PostMoveWatch.Init(application); } catch { }
#endif

#if MCP_EXECUTOR
            // MCP код-гүйцэтгэгч (Roslyn) зөвхөн net8/net10 (Revit 2025-2027) build-д
            // байна; net48/Revit 2024-д хасагдана.
            try
            {
                int port = ReadPort();

                // Локал bridge-ийн session токен.  Үүнээс өмнө /execute нь
                // ТОКЕНГҮЙ дурын C# ажиллуулдаг байсан (аюулгүй байдлын нүх).
                BridgeAuth.Issue(port);

                var handler = new CodeExecutorEventHandler();
                ExternalEvent externalEvent = ExternalEvent.Create(handler);
                _server = new HttpServer(externalEvent, handler, port);
                _server.Start();
            }
            catch
            {
                // Порт эзлэгдсэн (ж: өөр Revit instance нээлттэй) — bridge-гүйгээр
                // үргэлжилнэ. TaskDialog харуулж БОЛОХГҮЙ: batch горимд хүн байхгүй
                // тул модаль цонх бүх автоматыг түгжинэ. Bridge ажиллаж байгаа
                // эсэхийг http://localhost:5005/health-ээр шалгаж болно.
                _server = null;
            }
#endif

            // MGL UI-ийн дундын сэдэв: Revit-ийн Light/Dark сэдвийг WPF давхаргад дамжуулна (Ui/Revit/RevitThemeBridge.cs).
            // Тусдаа try: сэдвийн холболт унасан ч add-in-ийн бусад хэсэг ажиллана (цонх цайвар/системийн хэвээр).
            try { Ui.Revit.RevitThemeBridge.Attach(application); } catch { }

            // «MGL туслах» самбарыг бүртгэнэ.  RegisterDockablePane нь ЗӨВХӨН
            // OnStartup дотор ажилладаг (Revit-ийн API-ийн хатуу шаардлага) —
            // командаас дуудвал алдаа өгнө.  Бүртгэл амжилтгүй болсон ч бусад
            // товчнууд ажиллах ёстой тул тусад нь барина.
            try
            {
                application.RegisterDockablePane(
                    AssistantPaneProvider.PaneId,
                    "MGL туслах",
                    new AssistantPaneProvider());
            }
            catch (Exception ex)
            {
                TaskDialog.Show("MGL", "«MGL туслах» самбарыг бүртгэж чадсангүй:\n\n" + ex.Message);
            }

#if MGL_WORK_TRACKING
            // «MGL ажил» самбар (Revit work tracking MVP, 2026-09-29) — нэвтрэх, файл →
            // төсөл → таск сонголт, явц/өдрийн тайлан.  Цаг тоолох нь `WorkTrackingHost`
            // (дээр Init хийгдсэн); самбар хаалттай ч тоолол үргэлжилнэ.
            // ⚠️ RegisterDockablePane ЗӨВХӨН OnStartup-д.  Тусдаа try — бусад самбар,
            //    туузан цэсэд нөлөөлөхгүй; TaskDialog-гүй (batch горимд хүн байхгүй).
            try
            {
                application.RegisterDockablePane(
                    WorkPane.WorkPaneProvider.PaneId,
                    "MGL ажил",
                    new WorkPane.WorkPaneProvider());
            }
            catch
            {
                // Самбаргүй ч цаг бүртгэл (хост) ажиллана — туузан цэсний товч алдааг хэлнэ.
            }
#endif

            // «MGL — Ажлын явц» самбар + арын горимын хост (2026-10-01 «Зураг хувилах»; 2026-10-07-оос «Ханын дэлгээс» ч): ажил Revit-ийн Idling дээр
            // алхам алхмаар явж, хэрэглэгч Revit-д үргэлжлүүлэн ажиллана.  ⚠️ RegisterDockablePane ба Idling /
            // DocumentChanged-ийн бүртгэл ЗӨВХӨН OnStartup-д.  Тусдаа try — унасан ч «Зураг хувилах» хуучин синхрон
            // замаар ажиллана (самбаргүй бол тайлан цонхоор).  TaskDialog-гүй (batch горимд хүн байхгүй).
            try
            {
                application.RegisterDockablePane(
                    CloneDrawings.CdJobPaneProvider.PaneId,
                    "MGL — Ажлын явц",
                    new CloneDrawings.CdJobPaneProvider());
            }
            catch
            {
                // Самбаргүй ч арын горим ажиллана.
            }
            try { CloneDrawings.CdJobHost.Init(application); } catch { }
            // «Ханын дэлгээс» (2026-10-14): хуудсан дээрх render зургийг перспективын байранд ойртуулахад тайрч дүүргэнэ (CdJobHost.Post-оор).
            try { WallElevation.Revit.WeImageFill.Init(application); } catch { }

            // «MGL — Давхрын план» самбар (2026-10-14, Finch маяг): «Давхрын план» дарахад зүүн талд олон зуун хувилбараас шилдэг 20-ыг
            // харуулна; Revit-д тавих, тавилга нь самбарын товчоор `CdJobHost.Post`-оор (Idling).  ⚠️ RegisterDockablePane ЗӨВХӨН OnStartup-д.
            // Тусдаа try — унасан ч бусад самбар, туузан цэсэд нөлөөлөхгүй.
            try
            {
                application.RegisterDockablePane(
                    RoomPlan.FloorStudioPaneProvider.PaneId,
                    "MGL — Давхрын план",
                    new RoomPlan.FloorStudioPaneProvider());
            }
            catch
            {
                // Самбаргүй бол «Давхрын план» самбар харагдахгүй — Revit-ийн бусад ажил хэвээр.
            }

            // Модаль цонхнуудын эзэн (owner) — доорх ShowOwned-д хэрэглэнэ.  `MglWindow` нь Revit-ийн дэлгэцийн ажлын талбарыг
            // эндээс авна (App-д шууд хамаарахгүй — Revit-гүй smoke төслүүдэд ч эмхэтгэгдэхийн тулд).
            Ui.MglWindow.OwnerHandleProvider = () => MainWindowHandle;
            try
            {
                RememberMainWindow(application.MainWindowHandle);
            }
            catch
            {
                // Гар авалгүй ч ажиллана — ShowOwned нь эзэнгүйгээр нээнэ.
            }

            // ЛИЦЕНЗ (1.9.0) — license.json-ыг уншаад, токен байвал арын дэвсгэрт
            // серверээс шинэчилнэ.  UI-гүй, сүлжээ арын thread дээр.  Тусдаа try:
            // унасан ч Revit ачаалагдана — хэрэгсэл бүр `LicenseGate.Ensure()`-ээр
            // ХААЛТТАЙГААР унана (fail-closed).
            try { Licensing.LicenseGate.Init(application.ControlledApplication?.VersionNumber); } catch { }

            // W10 (2026-10-16): эрүүл мэндийн тайлан «MGL туслах» самбараас САЛСАН (самбар анхдагчаар нуугдсан) — App эхэлснээс
            // 90 с дараа, арын thread, Revit API-гүй (он/build-ийг одоо барина).  Шөнийн багцын хостод тайлан илгээхгүй.
            // Хуучин хувилбарын «нээлттэй» самбарыг нэг удаа хаах нь эхний Idling-д (UIApplication хэрэгтэй).
            try
            {
                string hy = application.ControlledApplication?.VersionNumber;
                string hb = application.ControlledApplication?.VersionBuild;
                if (!BatchQto.IsBatch) HealthReporter.ScheduleAfterStartup(hy, hb, TimeSpan.FromSeconds(90));
                application.Idling += HideAssistantOnceAfterUpgrade;
            }
            catch { }

            // «САНАЛ ХҮСЭЛТ» (2026-10-16): офлайн дарааллын арын илгээгч (Revit API-гүй, 20 с дараа эхэлнэ) +
            // MGL-ийн барьж чадаагүй алдааны ЛОКАЛ бүртгэл (дараагийн нээлтэд асууна; автоматаар юу ч илгээхгүй).
            // Тусдаа try: унасан ч Revit, бусад хэрэгсэл ачаалагдана.
            try
            {
                string feedbackYear = application.ControlledApplication?.VersionNumber;
                Feedback.FeedbackService.Instance.Start(feedbackYear);
                Feedback.FeedbackCrashCapture.Install(application, feedbackYear);
            }
            catch { }

            // Ribbon-ы алдаа HTTP bridge-ийг унагаах ёсгүй тул тусад нь барина.
            try
            {
                CreateRibbon(application);
            }
            catch (Exception ex)
            {
                TaskDialog.Show("MGL", "MGL туузан цэсийг үүсгэж чадсангүй:\n\n" + ex.Message);
            }

            // 24/7 batch горим: batch-queue.json байвал ApplicationInitialized
            // дээр файлуудыг боловсруулаад Revit-ээ унтраана (BatchQto.cs).
            // Batch hook-ийн алдаа интерактив session-д саад болох ёсгүй.
            try
            {
                BatchQto.Hook(application);
            }
            catch
            {
                // Queue байхгүй/эвдэрсэн үед энгийн session хэвээр үргэлжилнэ.
            }

            // ⚠️ ШӨНИЙН БАГЦЫН ХОСТОД НИЙЦЭЛ ТЭГ (`2-3` §3.14 №2).
            //
            // `BatchQto` нь 50 файлыг detached нээж, өөр хүмүүсийн
            // байрлуулалтаас баг тодорхойлж, `Process.GetCurrentProcess().Kill()`
            // -ээр төгсдөг.  Тэнд олдвор үйлдвэрлэх нь ХАРЬЯАЛЛЫН ХУВЬД БУРУУ
            // мянга мянган мөр гаргана — `BimEmitter`-ийн `_pump`/`_post`
            // хоёр ч ЯГ ЭНЭ шалтгаанаар тэнд эрт буцдаг.
            //
            // ⚠️ `Hook`-ИЙН ДАРАА: `IsBatch` нь тэнд тавигдана.
            try { if (BatchQto.IsBatch) ComplianceScheduler.Disable(); } catch { }

            return Result.Succeeded;
        }

        /// <summary>
        /// W10: «MGL туслах» анхдагчаар нуугдсан (<c>VisibleByDefault = false</c>) ч Revit өмнөх сессийн «нээлттэй» төлөвийг
        /// санадаг тул шинэчилсэн хэрэглэгчид самбар гарсаар байна.  Эхний Idling-д НЭГ удаа (ui-prefs туг) хаана; дараа нь
        /// хэрэглэгч өөрөө нээвэл Revit түүнийг санаж, бид дахин хаахгүй.
        /// </summary>
        private static void HideAssistantOnceAfterUpgrade(object sender, Autodesk.Revit.UI.Events.IdlingEventArgs e)
        {
            var uiapp = sender as UIApplication;
            try { if (uiapp != null) uiapp.Idling -= HideAssistantOnceAfterUpgrade; } catch { }
            try
            {
                const string flag = "assistant_hidden_by_default_v1";
                if (Ui.MglUiPrefs.GetFlag(flag)) return;
                Ui.MglUiPrefs.SetFlag(flag, true);
                if (uiapp == null || BatchQto.IsBatch) return;
                DockablePane pane = uiapp.GetDockablePane(AssistantPaneProvider.PaneId);
                if (pane != null && pane.IsShown()) pane.Hide();
            }
            catch
            {
                // Самбар бүртгэгдээгүй (хуучин Revit) г.м. — юу ч хийхгүй.
            }
        }

        public Result OnShutdown(UIControlledApplication application)
        {
            // ⚠️ ЭНЭ БЛОК `#if MCP_EXECUTOR`-ЫН ГАДНА байх ЁСТОЙ.  Урьд нь
            // энэ аргын БҮХ БИЕ нь тэр дотор байсан тул net48 (Revit 2024)
            // build дээр `OnShutdown` нь БҮРЭН ХООСОН байв — `DocumentChanged`
            // ба бусад 7 захиалга, мөн flush таймер нь тэр target дээр
            // БОЛЗОЛГҮЙ алдагддаг байсан.
            //
            // ⚠️⚠️ УНТРААЛТЫН ДАРААЛАЛ — ЭХЛЭЭД ДОХИО, ДАРАА НЬ ХҮЛЭЭЛТ.
            //
            // `ChangeTracker.Shutdown` нь `FlushDirty()`-г Revit-ийн ҮНДСЭН
            // thread дээр СИНХРОНООР дуудна, тэр нь `Gate`-ыг авна.  Хэрэв
            // арын мөчлөг тэр агшинд `RevitToolBus`-ийн дуудлагыг хүлээж
            // байвал Revit-ийн хаагдалт тэр дуудлагын БҮТЭН хугацаагаар
            // гацна.  Тиймээс ХАМГИЙН ЭХЭНД зөвхөн ДОХИО өгнө — `Join`
            // ХИЙХГҮЙ.

            // ── АЛХАМ 0 — ЗӨВХӨН ДОХИО.  ХҮЛЭЭХГҮЙ. ──────────────────
            // ⚠️ `ComplianceCts` нь ЭНД амьдардаг (App нь энэ токеныг
            //    эзэмшигч бөгөөд `2-3`-ын `ComplianceScheduler` түүнийг
            //    ХЭРЭГЛЭНЭ).  Планировщик хараахан шипээгүй ч цуцлалт нь
            //    ЭНД БАЙХ ЁСТОЙ: дараалал нь кодоор бичигдсэн байх нь
            //    ирээдүйн хүн түүнийг ДУНД нь оруулахаас хамгаална.
            try { ComplianceCts.Cancel(); } catch { }

            // ⚠️ ЗӨВХӨН ДОХИО, ХҮЛЭЭХГҮЙ.  `ChangeTracker.Shutdown` (АЛХАМ 2)
            //    нь `FlushDirty()`-г Revit-ийн ҮНДСЭН урсгал дээр СИНХРОНООР
            //    дуудна; хэрэв хуваарилагч тэр агшинд хэрэгслийн дуудлагыг
            //    хүлээж байвал ЭНД `Join` хийх нь Revit-ийн хаагдалтыг тэр
            //    дуудлагын БҮТЭН deadline-аар гацаана.  `Join` нь АЛХАМ 3-т.
#if MGL_INTELLIGENCE
            try { Intelligence.Revit.RevitIntelligenceHost.Shutdown(); } catch { }
#endif
#if MGL_WORK_TRACKING
            // Цаг бүртгэл: одоо хүртэл тоолж ДИСКЭНД хадгалаад, сүүлийн heartbeat-ийг
            // (ended) ≤1.5 с оролдоно — амжаагүй бол дараагийн асаалтад илгээгдэнэ.
            try { WorkTracking.WorkTrackingHost.Shutdown(); } catch { }
#endif
#if MGL_SMART
            try { Smart.SmartHost.Shutdown(); } catch { }
#endif
            // «Зураг хувилах»-ын арын ажил — зөвхөн төлөв (алхмын хооронд тул нээлттэй transaction байхгүй).
            try { CloneDrawings.CdJobHost.Shutdown(); } catch { }
            // «Санал хүсэлт»-ийн илгээлт — ЗӨВХӨН цуцлах дохио (явж буй item queued болж дараагийн нээлтэд үргэлжилнэ).
            try { Feedback.FeedbackService.Instance.Shutdown(); } catch { }
            try { ComplianceScheduler.Cancel(); } catch { }

            // ⚠️ `BimEmitter.Cancel()` нь ДОХИО ӨГӨХИЙН ӨМНӨ нээлттэй сесс
            //    бүрд `SESSION_END`-ийг ДАРААЛАЛД хийнэ.  Тэр нь ЗӨВХӨН
            //    дараалалд хийх үйлдэл — ХҮЛЭЭЛТГҮЙ; илгээх эсэхийг доорх
            //    `Join(400)` шийднэ, амжаагүй мөр нь JSONL-д үлдэж
            //    ДАРААГИЙН асаалтад илгээгдэнэ (курсорын гэрээ).
            try { BimEmitter.Cancel(); } catch { }

            // ── АЛХАМ 1 — дараалалд байгаа хэрэгслийн дуудлага бүрийг
            //    `Abandoned = true` болгож `Done.Set()` хийнэ, шинийг хүлээж
            //    авахаа болино.  ⚠️ `ExternalEvent`-ыг DISPOSE ХИЙХГҮЙ — тэр
            //    нь `RevitToolBus.Shutdown()`-ийн ажил ба доор яагаад
            //    ХАМГИЙН СҮҮЛД байх ёстойг тайлбарласан. ────────────────
            try { RevitToolBus.CancelAll(); } catch { }

            // ── АЛХАМ 2 — БАЙРЛАЛ ӨӨРЧЛӨГДӨӨГҮЙ.  Одоо түүний `FlushDirty`
            //    нь `Gate`-ыг чөлөөтэй авна: арын мөчлөг хаана ч зогсоогүй.
            //
            // ⚠️ `ControlledApplication` нь энд null ирж болзошгүй (Revit-ийн
            // хувилбар бүр дээр батлагдаагүй).  `Shutdown` нь тэр тохиолдолд
            // ч таймерыг Dispose хийж, сүүлийн өөрчлөлтийг диск рүү бичнэ.
            try { ChangeTracker.Shutdown(application?.ControlledApplication); }
            catch { /* унтраалт дээр чимээгүй */ }

            // ── АЛХАМ 3 — ХЯЗГААРТАЙ ХҮЛЭЭЛТ.  Илгээгчийн хоёр thread нь
            //    `IsBackground = true` тул гацсан ч процессыг БАРИХГҮЙ; 400
            //    мс нь `SESSION_END`-ийг дискэнд буулгахад хангалттай.
            try { BimEmitter.Join(400); } catch { }

            // ⚠️ ХЯЗГААРТАЙ.  Хуваарилагчийн урсгал нь `IsBackground = true`
            //    тул гацсан ч процессыг БАРИХГҮЙ.  Энэ мөр нь `BimEmitter`
            //    -ийн `Join`-ийн ХАЖУУД, `RevitToolBus.Shutdown()`-ийн ӨМНӨ
            //    байх ЁСТОЙ: `Shutdown` нь `ExternalEvent`-ыг сулладаг тул
            //    түүний ДАРАА хүлээх нь хариу ХЭЗЭЭ Ч ирэхгүй дуудлагыг
            //    хүлээхтэй тэнцүү.
            try { ComplianceScheduler.Join(400); } catch { }

            // ⚠️ `Current` нь сүүлийн амжилттай асуулгын төлөв; NULL бол
            //    (нэг ч асуулга гараагүй) юу ч бичихгүй.  Диск бичилт нь
            //    `RevitToolBus.Shutdown`-ЭЭС ӨМНӨ, гэхдээ tool bus-д хүрэхгүй
            //    тул унтраалтын дараалал ӨӨРЧЛӨГДӨХГҮЙ.
            try { if (TeamContext.Current != null) TeamContext.SaveCache(TeamContext.Current); }
            catch { /* унтраалт дээр чимээгүй */ }

            // ⚠️ ДАРААЛАЛ НЬ ЧУХАЛ.  Доорх гурав нь бүгд «статик төлөв
            // сулла» (§2.12) бөгөөд ЭНЭ дарааллаар:
            //
            //   1. Сессийн ЭЦСИЙН хэмжилтийн дүн (p50/p95/p99/max/алдаа).
            //      `force: true` — энэ ганц мөр нь тухайн ажилтны машин
            //      дээрх бүхэл өдрийн зураг.  ⚠️ `Debug.WriteLine` нь энэ
            //      төслийн АЛЬ Ч Configuration дээр гүйцэтгэгддэггүй тул
            //      `Metrics.Emit` нь ажилтны машин дээр хэмжилт хүрдэг
            //      ЦОРЫН ГАНЦ хаяг (нотолгоо: `Percentiles.cs`).
            //   2. `AssistantLog` — санах ойд үлдсэн, илгээгдээгүй мөрүүдийн
            //      цагийн утгыг дискэнд бичнэ.  `AttachTiming` нь мессеж
            //      бүрт бүтэн файл дахин бичихээ зориуд БОЛИСОН тул энэ
            //      сүүлчийн бичилт хэрэгтэй.
            //   3. `RevitToolBus` — `ExternalEvent` сулалж, дараалалд
            //      үлдсэн ажлыг хаяна.  ХАМГИЙН СҮҮЛД: дээрх хоёр нь
            //      хэрэгсэл дуудахгүй ч, урвуу дараалал нь ирээдүйд
            //      «хаагдсан bus руу бичих» алдааг далдална.
            try { Metrics.EmitSummary(force: true); } catch { }
            // ⚠️ ЭНЭ МӨР ЗААВАЛ ДЭЭД МӨРИЙН ДАРАА.  `Metrics.Emit` нь
            // 2026-08-28-наас хойш буфферлэж, АРЫН thread дискэнд гаргадаг
            // (`IsBackground = true` — процессыг барихгүй).  Ийм учраас
            // дээрх эцсийн дүн нь зөвхөн ДАРААЛАЛД орсон байх бөгөөд
            // `Shutdown()` түүнийг гаргаж өгөхгүй бол Revit хаагдахад
            // АЛДАГДАНА.  Хүлээлт нь хязгаартай (750 мс).
            try { Metrics.Shutdown(); } catch { }
            try { AssistantLog.Shutdown(); } catch { }
            try { RevitToolBus.Shutdown(); } catch { }

#if MCP_EXECUTOR
            try { _server?.Stop(); } catch { /* ignore on shutdown */ }
            // Токеныг хүчингүй болгож, гар барих файлыг устгана — Revit
            // хаагдсаны дараа хуучин токен диск дээр үлдэх ёсгүй.
            try { BridgeAuth.Revoke(); } catch { /* ignore on shutdown */ }
#endif
            return Result.Succeeded;
        }

        /// <summary>
        /// Revit-ийн үндсэн цонхны HWND.  Модаль WPF цонх бүрт Owner болгож
        /// өгнө.  Эзэнгүй ShowDialog нь Revit-ийн үндсэн цонхыг идэвхгүй болгодог
        /// ч Z-order-ын холбоо байхгүй тул хэрэглэгч Revit дээр дарвал диалог
        /// АРД нь ороод алга болно; манай цонхнууд `ShowInTaskbar="False"` тул
        /// буцааж гаргах ямар ч арга үлдэхгүй — Revit бүрэн гацсан мэт харагдаж,
        /// хүн хүчээр хаадаг (хадгалаагүй ажил алдагдана).
        /// </summary>
        internal static IntPtr MainWindowHandle { get; private set; }

        /// <summary>Мэдэгдэж байгаа бол Revit-ийн үндсэн цонхны бариулыг санана.</summary>
        internal static void RememberMainWindow(IntPtr handle)
        {
            if (handle != IntPtr.Zero)
                MainWindowHandle = handle;
        }

        /// <summary>
        /// Цонхыг Revit-ийн эзэмшилд өгөөд модалиар нээнэ.  Модаль цонх нээх
        /// БҮХ газар үүнийг ашиглана — шинэ дуудлага эзэн тавихаа мартах
        /// боломжгүй болгох нь энэ helper-ийн гол зорилго.
        /// </summary>
        internal static bool? ShowOwned(System.Windows.Window window, IntPtr owner)
        {
            RememberMainWindow(owner);
            try
            {
                if (MainWindowHandle != IntPtr.Zero)
                {
                    new System.Windows.Interop.WindowInteropHelper(window).Owner = MainWindowHandle;
                    // Эзэнтэй болсны дараа олон дэлгэцтэй үед Revit байгаа
                    // дэлгэцэн дээр гарах нь зөв.
                    // ⚠️ `MglWindow.Setup` хийсэн цонх эзний ДЭЛГЭЦИЙН ажлын талбарт аль хэдийн тохируулагдсан
                    // (хэмжээ + байрлал) — CenterOwner түүнийг дахин дарж хальж болзошгүй тул ХӨНДӨХГҮЙ.
                    if (!Ui.MglWindow.IsManaged(window))
                        window.WindowStartupLocation = System.Windows.WindowStartupLocation.CenterOwner;
                }
            }
            catch
            {
                // Эзэн тавьж чадаагүй ч цонхыг нээх нь нээхгүй байхаас дээр.
            }
            return window.ShowDialog();
        }

        /// <summary>Эзний бариул гарт байхгүй үед — App.OnStartup-д санасныг хэрэглэнэ.</summary>
        internal static bool? ShowOwned(System.Windows.Window window)
        {
            return ShowOwned(window, IntPtr.Zero);
        }

#if MCP_EXECUTOR
        private static int ReadPort()
        {
            string raw = Environment.GetEnvironmentVariable("REVIT_MCP_PORT");
            return int.TryParse(raw, out int p) && p > 0 ? p : 5005;
        }
#endif

        /// <summary>
        /// Ribbon-ыг бүтээнэ.  ⚠️ Бүх товч, самбар, tooltip, дүрс нь одоо НЭГ эх сурвалжаас:
        ///   • бүтэц  — `Ui/Core/RibbonPlan.cs` (ӨГӨГДӨЛ; R24-д хоосон самбар үүсэхгүй),
        ///   • текст  — `Ui/Core/ToolCatalogData.cs` (tooltip, дэлгэрэнгүй заавар, нэршил),
        ///   • дүрс   — `Ui/Core/ToolIconSpec.cs` → `GlyphIcons`,
        ///   • бүтээгч — `Ui/Revit/RibbonBuilder.cs`.
        /// Өмнө нь энд 23 товч, 7 самбарыг гараар (App.cs + Smart/Revit/SmartRibbon.cs + Reinforcement/RfRibbon.cs
        /// гурван хуулбар MakeButton-оор) бүтээж, алдааг ЛОГГҮЙ залгидаг байв.
        ///
        /// ⚠️ ДАРААХ САЙЫГ САНА (App.cs-ийн хуучин тайлбарын гол сургамж, journal.0064): НЭГ өргөн самбар Revit-д НЭГ
        ///    унждаг товч болж хуйлагдсан.  Ribbon нь самбар бүрт зай хуваарилдаг тул олон НАРИЙН самбар, жижиг
        ///    товчийг stack-д.  Том товчны тоо 23 → 15 (+ нэг pulldown) болсон; хуйлагдах эсэх амьд Revit дээр ХЭМЖИГДЭЭГҮЙ.
        /// ⚠️ Товчны `Name` (PushButtonData.Name) ХЭВЭЭР — гэхдээ самбар/pulldown нэр Revit команд ID-д орох тул QAT/гарын
        ///    товчлуурыг дахин тохируулах шаардлагатай байж болно (docs/MGL_UI_UX_REDESIGN.md §5.3).
        /// </summary>
        private static void CreateRibbon(UIControlledApplication application)
        {
            // Ribbon табын нэр.  Урьд нь `const "MGL"` байсан тул өөр компанид
            // Revit-ийн туузан цэсэнд харь брэнд гарч ирдэг байв.  `MGL_RIBBON_TAB`
            // орчны хувьсагчаар дарж бичнэ; тохируулаагүй бол өмнөхтэй адил "MGL".
            string tabEnv = Environment.GetEnvironmentVariable("MGL_RIBBON_TAB");
            string tabName = string.IsNullOrWhiteSpace(tabEnv) ? "MGL" : tabEnv.Trim();
            try
            {
                application.CreateRibbonTab(tabName);
            }
            catch (Autodesk.Revit.Exceptions.ArgumentException)
            {
                // Таб аль хэдийн үүссэн байна.
            }

            string assemblyPath = System.Reflection.Assembly.GetExecutingAssembly().Location;
            Ui.Revit.RibbonBuilder.Build(application, tabName, assemblyPath);

            // Ажилтны салбараар (БА / ББ / Интерьер / Инженерийн шугам) хэрэгсэл нуух — кэшээр шууд, ERP-ээс арын дэвсгэрт.
            // Тусдаа try: шүүлт унавал бүх товч харагдсаар (хамгийн аюулгүй төлөв).
            try { Ui.Revit.RibbonDisciplines.Init(); }
            catch (Exception ex) { Ui.Revit.RibbonBuilder.LogFailure("Салбарын шүүлт эхлүүлэх", ex); }
        }
    }
}
