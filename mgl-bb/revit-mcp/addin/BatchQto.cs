using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using Autodesk.Revit.ApplicationServices;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace RevitMcpAddin
{
    /// <summary>
    /// 24/7 batch горим: scheduler-ийн бичсэн batch-queue.json байвал Revit
    /// асмагц (ApplicationInitialized) файлуудыг DETACHED нээж, тоо хэмжээг
    /// задлаад сервер рүү илгээнэ, дараа нь Revit-ийг унтраана.
    ///
    /// Чухал дүрмүүд:
    ///   - Queue файл БАЙХГҮЙ бол юу ч хийхгүй — энгийн интерактив session.
    ///   - Batch горимд TaskDialog ОГТ харуулахгүй (хүн байхгүй тул түгжирнэ);
    ///     бүх үр дүн/алдаа batch-result.json-д бичигдэнэ.
    ///   - Central файлыг DetachAndPreserveWorksets + OpenAllWorksets горимоор
    ///     нээнэ (Decision #2) — инженерүүдийн ажилд саад болохгүй, read-only.
    /// </summary>
    public static class BatchQto
    {
        private static string Dir =>
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "RevitMcpAddin");

        private static string QueuePath => Path.Combine(Dir, "batch-queue.json");
        private static string ProcessingPath => Path.Combine(Dir, "batch-queue.processing.json");
        private static string ResultPath => Path.Combine(Dir, "batch-result.json");

        /// <summary>
        /// БАГЦЫН ГОРИМ асав уу.  `Hook` дотор тавигдана.
        ///
        /// ⚠️ `BimEmitter` (ба ирээдүйн `ComplianceScheduler`) хоёул үүн дээр
        /// ШУУД буцна.  Багцын хост нь хараа хяналтгүй, DETACHED, олон
        /// төслийн файлыг НЭГ ажилтны токеноор нээдэг — тэнд бүртгэл үүсгэх
        /// нь ХАРЬЯАЛЛЫН хувьд буруу: нэг инженерийн нэр дээр өөрийнх нь ОГТ
        /// нээгээгүй 50 төслийн мөр бичигдэнэ.  Энэ бол `BatchQto` линкийн
        /// задаргаанд аль хэдийн хэрэглэдэг ЯГ ИЖИЛ зорилтот хасалт.
        /// </summary>
        internal static bool IsBatch { get; private set; }

        /// <summary>App.OnStartup-аас дуудна. Queue байхгүй бол subscribe ч хийхгүй.</summary>
        public static void Hook(UIControlledApplication application)
        {
            if (!File.Exists(QueuePath))
                return;
            IsBatch = true;
            application.ControlledApplication.ApplicationInitialized += OnApplicationInitialized;
        }

        private static void OnApplicationInitialized(object sender, EventArgs e)
        {
            var app = sender as Application;
            if (app == null)
                return;

            BatchQueue queue = null;
            var results = new List<BatchFileResult>();
            bool exitWhenDone = true;
            // 1A-6 nonce — queue-ээс уншаад үр дүнд цуурайтуулна.
            string nonce = null;

            try
            {
                // Дахин ачаалахад давхар боловсруулахгүйн тулд queue-г эхэлж
                // processing болгож нэрлэнэ (crash гарсан ч дараагийн session
                // энгийн интерактив хэвээр асна).
                if (!File.Exists(QueuePath))
                    return;
                if (File.Exists(ProcessingPath))
                    File.Delete(ProcessingPath);
                File.Move(QueuePath, ProcessingPath);

                queue = JsonSerializer.Deserialize<BatchQueue>(File.ReadAllText(ProcessingPath));
                if (queue == null || queue.Files == null || queue.Files.Count == 0)
                    return;
                exitWhenDone = queue.Exit;
                // ⚠️ 1A-6 nonce — УНШИНА, ШААРДАХГҮЙ (`BatchQueue.Nonce`
                // дээрх тайлбарыг үз).  null байх нь ХЭВИЙН.
                nonce = queue.Nonce;

                AddinSettings settings = SettingsStore.Load();
                foreach (BatchFile entry in queue.Files)
                {
                    BatchFileResult one = ProcessOne(app, settings, entry);
                    one.Nonce = nonce;
                    results.Add(one);
                }
            }
            catch (Exception ex)
            {
                results.Add(new BatchFileResult
                {
                    Path = "(batch)",
                    Ok = false,
                    Error = "Batch fatal: " + ex.Message,
                    Nonce = nonce,
                });
            }
            finally
            {
                try { WriteResults(results); } catch { /* үр дүн бичигдэхгүй ч гацахгүй */ }
                try { if (File.Exists(ProcessingPath)) File.Delete(ProcessingPath); } catch { }

                // Batch session — ажил дууссан тул Revit-ийг бүхэлд нь унтраана.
                // (RevitBatchProcessor ч мөн адил process-оо шууд дуусгадаг.)
                if (exitWhenDone)
                {
                    // ⚠️ УРЬДЧИЛСАН НӨХЦӨЛ ИРЭЭДҮЙД: өнөөдөр `IsBatch` нь
                    //    `BimEmitter`-ийг БҮРЭН унтраасан тул шавхах юм
                    //    БАЙХГҮЙ (энэ дуудлага 0 буцаана).  Гэвч дуудлага нь
                    //    ХЭВЭЭР байх ёстой: ирээдүйд хэн нэгэн `IsBatch`-ийг
                    //    арилгавал `Kill()` нь дараалалд байгаа мөрийг ЯМАР Ч
                    //    ул мөргүй устгана — энэ мөр тэр өгөгдлийг аварна.
                    try { BimEmitter.DrainBlocking(5000); } catch { }
                    Process.GetCurrentProcess().Kill();
                }
            }
        }

        private static BatchFileResult ProcessOne(
            Application app, AddinSettings settings, BatchFile entry)
        {
            // Batch горим ЗӨВХӨН хост файлыг задалдаг — салбар/link файлууд
            // batch-config.json-д ТУС ТУСДАА мөр байдаг тул энд link expansion
            // хийвэл давхар илгээлт үүснэ (IncludeLinks тохиргоо үл хамаарна).
            var result = new BatchFileResult { Path = entry.Path, ProjectId = entry.ProjectId };
            var watch = Stopwatch.StartNew();

            // ⚠️ ЛИЦЕНЗ + SESSION (1.10.0): багцын горим нь хяналтгүй ажилладаг ч add-in-ий нэг хэсэг —
            // хүчинтэй лиценз, төхөөрөмжийн session заавал.  Session 30 минутын настай тул ФАЙЛ БҮРИЙН
            // өмнө (дуусахад ойртсон бол синхрон) шинэчилж, шинэ токеныг шууд уншина (урт багц дунд
            // `settings` хуучирдаг).
            if (!Licensing.LicenseGate.EnsureForBatch())
            {
                result.Error = "MGL лиценз хүчингүй — ажлын компьютер дээр MGL нэвтрэлтээ шалгана уу.";
                return result;
            }
            string token = SettingsStore.Load().Token;
            if (string.IsNullOrEmpty(token))
            {
                result.Error = "Токен алга — Revit доторх MGL > Тохиргоо-оос нэвтэрнэ үү.";
                return result;
            }
            if (!File.Exists(entry.Path))
            {
                result.Error = "Файл олдсонгүй: " + entry.Path;
                return result;
            }

            Document doc = null;
            try
            {
                doc = OpenDetached(app, entry.Path);

                QtoExtractionResult extraction =
                    QtoExtractor.Extract(doc, app.VersionNumber);
                QtoPayload payload = extraction.Payload;
                payload.ProjectId = entry.ProjectId;

                try
                {
                    QtoPushResult push = Task.Run(() =>
                            ApiClient.PostRevitRunAsync(settings.ApiHost, token, payload))
                        .GetAwaiter().GetResult();
                    result.Ok = true;
                    result.RunId = push.RunId;
                    result.Facts = push.Facts;
                    result.Mapped = push.Mapped;
                    result.Unmapped = push.Unmapped;
                }
                catch (DuplicatePushException dup)
                {
                    // Ижил push аль хэдийн хүлээн авагдсан — амжилттайд тооцно.
                    result.Ok = true;
                    result.RunId = dup.RunId;
                    result.Error = "duplicate push (run #" + dup.RunId + ")";
                }

                result.FileName = payload.FileName;
                result.ElementCount = extraction.ElementCount;
            }
            catch (Exception ex)
            {
                result.Error = ex.Message;
            }
            finally
            {
                try { if (doc != null) doc.Close(false); } catch { }
                result.DurationSec = Math.Round(watch.Elapsed.TotalSeconds, 1);
            }
            return result;
        }

        /// <summary>
        /// Central (workshared) файлыг detach хийж бүх workset-тэй нээнэ.
        /// Workshared биш файл дээр detach үл хамаарна — алдаа гарвал энгийнээр
        /// дахин нээж үзнэ.
        /// </summary>
        private static Document OpenDetached(Application app, string path)
        {
            ModelPath modelPath = ModelPathUtils.ConvertUserVisiblePathToModelPath(path);

            var detached = new OpenOptions
            {
                DetachFromCentralOption = DetachFromCentralOption.DetachAndPreserveWorksets,
            };
            detached.SetOpenWorksetsConfiguration(
                new WorksetConfiguration(WorksetConfigurationOption.OpenAllWorksets));

            try
            {
                return app.OpenDocumentFile(modelPath, detached);
            }
            catch (Autodesk.Revit.Exceptions.ApplicationException)
            {
                // Workshared биш эсвэл detach боломжгүй — энгийн нээлт.
                return app.OpenDocumentFile(modelPath, new OpenOptions());
            }
        }

        private static void WriteResults(List<BatchFileResult> results)
        {
            Directory.CreateDirectory(Dir);
            var doc = new BatchResultDoc
            {
                FinishedAt = DateTime.UtcNow.ToString("o"),
                Results = results,
            };
            File.WriteAllText(ResultPath, JsonSerializer.Serialize(doc,
                new JsonSerializerOptions { WriteIndented = true }));
        }
    }

    /// <summary>batch-queue.json — scheduler script бичнэ, add-in уншина.</summary>
    public class BatchQueue
    {
        [JsonPropertyName("exit")]
        public bool Exit { get; set; } = true;

        [JsonPropertyName("files")]
        public List<BatchFile> Files { get; set; } = new List<BatchFile>();

        /// <summary>
        /// 1A-6-ын nonce.  ⚠️ ЭНЭ РЕЛИЗ ҮҮНИЙГ ЗӨВХӨН УНШИНА, ШААРДАХГҮЙ.
        ///
        /// Урвуулбал (эхлээд ШААРДВАЛ) шөнийн QTO батч нь nonce бичдэг
        /// болоогүй scheduler-тэй тааралдаж ЧИМЭЭГҮЙ ЗОГСОНО — хэн ч өглөө
        /// хүртэл мэдэхгүй.  Шаардлагыг ЗӨВХӨН ДАРААГИЙН релизэд нэмнэ,
        /// түүнээс өмнө scheduler-ийн БҮХ машин nonce бичдэг болсныг батал.
        ///
        /// ⚠️ Одоо ч тэвчээр бий: доорх `JsonSerializer.Deserialize&lt;BatchQueue&gt;`
        /// нь АНХДАГЧ тохиргоотой тул `UnmappedMemberHandling` нь `Skip` —
        /// танихгүй `nonce` талбарыг АЛЬ ХЭДИЙН чимээгүй алгасдаг.  DTO-д
        /// нэмэх нь тэр зан төлөвийг ИЛ ТОД, ЗОРИУДЫН болгож, дараагийн
        /// релизэд шаардлага нэмэх суурийг тавьж байгаа хэрэг.
        /// </summary>
        [JsonPropertyName("nonce")]
        public string Nonce { get; set; }
    }

    public class BatchFile
    {
        [JsonPropertyName("path")]
        public string Path { get; set; }

        [JsonPropertyName("project_id")]
        public int ProjectId { get; set; }
    }

    /// <summary>batch-result.json — add-in бичнэ, scheduler script уншина.</summary>
    public class BatchResultDoc
    {
        [JsonPropertyName("finished_at")]
        public string FinishedAt { get; set; }

        [JsonPropertyName("results")]
        public List<BatchFileResult> Results { get; set; }
    }

    public class BatchFileResult
    {
        [JsonPropertyName("path")]
        public string Path { get; set; }

        [JsonPropertyName("project_id")]
        public int ProjectId { get; set; }

        [JsonPropertyName("ok")]
        public bool Ok { get; set; }

        [JsonPropertyName("run_id")]
        public int RunId { get; set; }

        [JsonPropertyName("facts")]
        public int Facts { get; set; }

        [JsonPropertyName("mapped")]
        public int Mapped { get; set; }

        [JsonPropertyName("unmapped")]
        public int Unmapped { get; set; }

        [JsonPropertyName("file_name")]
        public string FileName { get; set; }

        [JsonPropertyName("element_count")]
        public int ElementCount { get; set; }

        [JsonPropertyName("duration_sec")]
        public double DurationSec { get; set; }

        [JsonPropertyName("error")]
        public string Error { get; set; }

        /// <summary>
        /// Queue-ийн nonce-ыг ЦУУРАЙТУУЛНА — scheduler нь ӨӨРИЙН бичсэн
        /// queue-ийн үр дүн мөн эсэхийг таньж чадна.
        ///
        /// ⚠️ Queue-д nonce байхгүй бол энэ нь null үлдэнэ (хуучин scheduler
        /// нийцтэй хэвээр).
        /// </summary>
        [JsonPropertyName("nonce")]
        public string Nonce { get; set; }
    }
}
