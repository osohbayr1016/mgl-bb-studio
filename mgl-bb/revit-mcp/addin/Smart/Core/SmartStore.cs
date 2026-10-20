using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace RevitMcpAddin.Smart.Core
{
    public enum LoadStatus
    {
        /// <summary>Файл байхгүй — анхдагч утга.</summary>
        Missing,
        Ok,
        /// <summary>Хуучин схемээс шинэчлэгдсэн (диск дээр хуучин хэвээр — дараагийн Save шинэчилнэ).</summary>
        Migrated,
        /// <summary>Эвдэрсэн — `.corrupt-*` руу нүүлгэж анхдагч утга буцаасан.</summary>
        Corrupt,
        /// <summary>Файл ШИНЭ хувилбарын add-in-аар бичигдсэн — хөндөхгүй, анхдагч утга.</summary>
        NewerSchema,
        /// <summary>
        /// Файл БАЙГАА ч уншиж чадсангүй (түгжигдсэн/эрхгүй — антивирус, нөөцлөлт) — файлыг ХӨНДӨӨГҮЙ, анхдагч утга буцаасан.
        /// ⚠️ Эвдэрсэн (`Corrupt`) БИШ: тэр утгыг буцаан хадгалбал жинхэнэ түүх устна — тиймээс `Save` энэ файлыг
        /// дараагийн АМЖИЛТТАЙ `Load` хүртэл ДАРЖ БИЧИХГҮЙ.
        /// </summary>
        Unreadable,
    }

    public sealed class LoadResult<T> where T : class
    {
        public T Value { get; set; }
        public LoadStatus Status { get; set; }
        public int SchemaOnDisk { get; set; }
        public string Note { get; set; }
        public bool UsedDefault
        {
            get { return Status == LoadStatus.Missing || Status == LoadStatus.Corrupt || Status == LoadStatus.NewerSchema || Status == LoadStatus.Unreadable; }
        }
    }

    /// <summary>
    /// Нэг схемийн алхам: `FromSchema` → `FromSchema + 1`.  Ачаалах үед диск дээрх
    /// схемээс одоогийнх хүртэл дарааллаар дуудагдана.  Бичвэр (payload)-ийг `JsonObject`
    /// хэлбэрээр засна — төрөлт DTO-д хамаарахгүй тул хуучин DTO-г хадгалах шаардлагагүй.
    /// </summary>
    public interface ISchemaMigration
    {
        int FromSchema { get; }
        JsonObject Apply(JsonObject payload);
    }

    /// <summary>
    /// Хувилбарлагдсан, АТОМ, эвдрэлд тэсвэртэй JSON хадгалалт.
    ///
    /// Файлын хэлбэр: `{ "schema": N, "savedUtc": "...", "payload": { ... } }`.
    ///
    /// ⚠️ ГЭРЭЭ (энэ дэд системийн бүх хадгалалт энэ дүрмийг дагана):
    ///   • Эвдэрсэн ХЭРЭГГҮЙ түүх/тохиргоо Revit-ийг ЭХЭЛЖ ЧАДАХГҮЙ болгох ёсгүй —
    ///     `Load` НЭГ Ч УДАА шидэхгүй; эвдэрсэн файлыг `.corrupt-<цаг>` болгож НҮҮЛГЭЭД
    ///     (устгахгүй — гараар сэргээж болно) анхдагч утга буцаана.
    ///   • Хагас бичилт БАЙХГҮЙ: түр файлд бичээд `File.Replace` (хуучин нь `.bak`);
    ///     процесс унавал хуучин файл бүтэн үлдэнэ.
    ///   • Шинэ add-in-ийн бичсэн (`schema` > одоогийн) файлыг хуучин add-in ДАРЖ
    ///     БИЧИХГҮЙ — буцаж хуучин хувилбар суулгасан хүний түүх устахаас сэргийлнэ.
    ///   • Хуучин схем → автоматаар шинэчилж, шинэчлэхээс өмнөх хуулбарыг
    ///     `.premigrate-v&lt;N&gt;.bak` болгож нэг удаа хадгална.
    /// </summary>
    public sealed class SmartStore
    {
        private static readonly ConcurrentDictionary<string, object> Locks =
            new ConcurrentDictionary<string, object>(StringComparer.OrdinalIgnoreCase);

        private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false);

        /// <summary>
        /// Сүүлийн `Load` нь файлыг УНШИЖ ЧАДААГҮЙ (IOException/эрхгүй) зам.  Эдгээрт `Save` татгалзана: дуудагчийн
        /// барьж буй утга нь анхдагчаас гарсан тул хадгалбал бодит файл устна.  Дараагийн амжилттай `Load` цэвэрлэнэ.
        /// </summary>
        private static readonly ConcurrentDictionary<string, bool> UnreadablePaths =
            new ConcurrentDictionary<string, bool>(StringComparer.OrdinalIgnoreCase);

        /// <summary>Тест/оношилгоо: энэ зам «уншигдаагүй» гэж тэмдэглэгдсэн үү.</summary>
        public bool IsMarkedUnreadable(string relative)
        {
            bool v;
            return UnreadablePaths.TryGetValue(FullPath(relative), out v);
        }

        public string Root { get; private set; }

        public SmartStore(string root)
        {
            if (string.IsNullOrWhiteSpace(root)) throw new ArgumentException("root");
            Root = root;
        }

        /// <summary>Одоогийн `SmartPaths.Root` дээрх хадгалалт (тест үндсийг сольж болно тул тогтмол биш).</summary>
        public static SmartStore Default
        {
            get { return new SmartStore(SmartPaths.Root); }
        }

        public string FullPath(string relative)
        {
            if (string.IsNullOrWhiteSpace(relative)) throw new ArgumentException("relative");
            // `..` -ээр үндсээс гарахыг хаана — харьцангуй зам нь ҮНДЭС ДОТОР.
            string full = Path.GetFullPath(Path.Combine(Root, relative));
            string root = Path.GetFullPath(Root);
            if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("path escapes store root");
            return full;
        }

        public bool Exists(string relative)
        {
            return File.Exists(FullPath(relative));
        }

        public bool Delete(string relative)
        {
            string path = FullPath(relative);
            lock (LockFor(path))
            {
                try
                {
                    if (File.Exists(path)) File.Delete(path);
                    return true;
                }
                catch (IOException) { return false; }
                catch (UnauthorizedAccessException) { return false; }
            }
        }

        private static object LockFor(string path)
        {
            return Locks.GetOrAdd(path, _ => new object());
        }

        /* ============================================================== */
        /*  LOAD                                                          */
        /* ============================================================== */

        public LoadResult<T> Load<T>(string relative, int currentSchema, Func<T> createDefault,
            IReadOnlyList<ISchemaMigration> migrations = null) where T : class
        {
            string path = FullPath(relative);
            lock (LockFor(path))
            {
                var result = new LoadResult<T>();
                string text;
                try
                {
                    // ⚠️ `File.Exists` ХЭЗЭЭ Ч ашиглахгүй: тэр нь эрхгүй/түгжигдсэн/сүлжээний алдаанд ч `false` буцааж «файл байхгүй» гэж худал хэлдэг →
                    // дуудагч анхдагч утгаас эхлээд дараа нь бодит түүхийг дарна.  Файлыг ШУУД нээж, ЗӨВХӨН «олдсонгүй» (FileNotFound/DirectoryNotFound) нь
                    // «байхгүй», бусад IO/эрхийн алдаа нь «уншигдахгүй» (хадгалахыг хориглоно).
                    text = ReadAllTextWithRetry(path);
                }
                catch (Exception ex) when (ex is FileNotFoundException || ex is DirectoryNotFoundException)
                {
                    UnreadablePaths.TryRemove(path, out _);
                    result.Status = LoadStatus.Missing;
                    result.Value = createDefault();
                    return result;
                }
                catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
                {
                    // Уншиж чадахгүй (түгжигдсэн, эрхгүй) — файлыг ХӨНДӨХГҮЙ, анхдагч утга, ДАРЖ БИЧИХИЙГ ХОРИГЛОНО.
                    SmartLog.Warn("store", "read_failed", new { file = Path.GetFileName(path), ex = ex.GetType().Name });
                    UnreadablePaths[path] = true;
                    result.Status = LoadStatus.Unreadable;
                    result.Note = "unreadable: " + ex.GetType().Name;
                    result.Value = createDefault();
                    return result;
                }

                // Файл амжилттай уншигдлаа — өмнөх «уншигдаагүй» тэмдэг хүчингүй (дуудагч одоо бодит агуулгаас эхэлнэ).
                UnreadablePaths.TryRemove(path, out _);

                // ⚠️ `JsonNode.Parse` нь объектыг ЭРГЭЦТЭЙ (lazy) байгуулдаг: давхардсан түлхүүр (`{"schema":1,"schema":2}`) нь Parse-д БИШ, анхны
                // `root["schema"]` хандалтад `ArgumentException` шиддэг.  Тиймээс задлалт + дугтуйн бүх хандалт ХАМТ нэг `try` дотор —
                // `Load` НЭГ Ч УДАА шидэхгүй (гэрээ): `JsonException`, давхардсан түлхүүр, хэт гүн үүрлэлт, зөв биш UTF-8 зэрэг ямар ч алдаа
                // «эвдэрсэн файл» болж `.corrupt-*` руу нүүнэ — Revit-ийг эхлүүлэхэд саад болохгүй.
                JsonObject payload = null;
                int schemaOnDisk = 0;
                bool envelopeOk = false;
                try
                {
                    var root = JsonNode.Parse(text, null, new JsonDocumentOptions
                    {
                        AllowTrailingCommas = true,
                        CommentHandling = JsonCommentHandling.Skip,
                    }) as JsonObject;
                    if (root != null)
                    {
                        JsonNode schemaNode = root["schema"];
                        payload = root["payload"] as JsonObject;
                        envelopeOk = payload != null && schemaNode != null && TryInt(schemaNode, out schemaOnDisk);
                    }
                }
                catch (Exception)
                {
                    envelopeOk = false;
                }
                if (!envelopeOk)
                {
                    return Quarantine(path, "not an envelope", createDefault);
                }

                result.SchemaOnDisk = schemaOnDisk;

                if (schemaOnDisk > currentSchema)
                {
                    SmartLog.Warn("store", "newer_schema", new { file = Path.GetFileName(path), disk = schemaOnDisk, cur = currentSchema });
                    result.Status = LoadStatus.NewerSchema;
                    result.Note = "file schema " + schemaOnDisk + " > " + currentSchema;
                    result.Value = createDefault();
                    return result;
                }

                bool migrated = false;
                if (schemaOnDisk < currentSchema)
                {
                    // Шинэчлэхээс өмнөх хуулбар — нэг удаа.
                    TryBackup(path, schemaOnDisk);
                    int s = schemaOnDisk;
                    while (s < currentSchema)
                    {
                        ISchemaMigration step = migrations == null
                            ? null
                            : migrations.FirstOrDefault(m => m.FromSchema == s);
                        if (step == null)
                            return Quarantine(path, "no migration from schema " + s, createDefault);
                        try
                        {
                            payload = step.Apply(payload) ?? payload;
                        }
                        catch (Exception ex)
                        {
                            SmartLog.Warn("store", "migration_failed", new { file = Path.GetFileName(path), from = s, ex = ex.GetType().Name });
                            return Quarantine(path, "migration " + s + " failed: " + ex.GetType().Name, createDefault);
                        }
                        s++;
                    }
                    migrated = true;
                }

                T value;
                try
                {
                    value = payload.Deserialize<T>(SmartJson.Compact);
                }
                catch (Exception ex)
                {
                    // Төрөл таарахгүй, хэт том тоо, буруу формат... — ямар ч алдаа «эвдэрсэн» (гэрээ: Load шидэхгүй).
                    return Quarantine(path, "payload deserialize failed: " + ex.GetType().Name, createDefault);
                }
                if (value == null)
                    return Quarantine(path, "empty payload", createDefault);

                result.Value = value;
                result.Status = migrated ? LoadStatus.Migrated : LoadStatus.Ok;
                return result;
            }
        }

        private static bool TryInt(JsonNode n, out int v)
        {
            v = 0;
            try
            {
                v = n.GetValue<int>();
                return true;
            }
            catch (Exception) { }
            try
            {
                v = (int)n.GetValue<long>();
                return true;
            }
            catch (Exception) { }
            return false;
        }

        /// <summary>
        /// Антивирус/индексатор/нөөцлөлт файлыг хэсэг түгжих нь элбэг — 3 удаа богино завсартай дахин оролдоно
        /// (хамгийн ихдээ ~240 мс).  Тэр ч үед чадахгүй бол IOException гаргана → `Unreadable`.
        /// </summary>
        private static string ReadAllTextWithRetry(string path)
        {
            for (int attempt = 0; ; attempt++)
            {
                try
                {
                    return ReadAllTextShared(path);
                }
                // «Олдсонгүй» нь түр түгжээ БИШ — дахин оролдож хугацаа үрэхгүй (анхны удаа файл байхгүй нь хэвийн).
                catch (IOException ex) when (attempt < 3 && !(ex is FileNotFoundException) && !(ex is DirectoryNotFoundException))
                {
                    System.Threading.Thread.Sleep(40 * (attempt + 1));
                }
            }
        }

        private static string ReadAllTextShared(string path)
        {
            using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            using (var sr = new StreamReader(fs, Utf8, true))
                return sr.ReadToEnd();
        }

        private LoadResult<T> Quarantine<T>(string path, string reason, Func<T> createDefault) where T : class
        {
            string moved = null;
            try
            {
                string stamp = DateTime.UtcNow.ToString("yyyyMMddHHmmss");
                moved = path + ".corrupt-" + stamp;
                File.Move(path, moved);
                PruneQuarantine(path);
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
            {
                moved = null;
                // Эвдэрсэн (эсвэл шинэчилж чадаагүй) файлыг нүүлгэж ЧАДСАНГҮЙ — энэ нь гараар сэргээж болох ЦОРЫН ГАНЦ хуулбар.  Хоосон анхдагчаар
                // дарж бичихийг хориглоно (`Save` татгалзана); дараагийн амжилттай `Load` (нүүлгэж чадвал) цэвэрлэнэ.
                UnreadablePaths[path] = true;
            }
            SmartLog.Warn("store", "quarantined", new { file = Path.GetFileName(path), reason = reason, moved = moved != null });
            return new LoadResult<T>
            {
                Status = LoadStatus.Corrupt,
                Note = reason,
                Value = createDefault(),
            };
        }

        private static void PruneQuarantine(string path)
        {
            try
            {
                string dir = Path.GetDirectoryName(path);
                string pattern = Path.GetFileName(path) + ".corrupt-*";
                var old = new DirectoryInfo(dir).GetFiles(pattern)
                    .OrderByDescending(f => f.Name, StringComparer.Ordinal).Skip(3).ToList();
                foreach (FileInfo f in old)
                {
                    try { f.Delete(); } catch (IOException) { } catch (UnauthorizedAccessException) { }
                }
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException) { }
        }

        private static void TryBackup(string path, int schema)
        {
            try
            {
                string bak = path + ".premigrate-v" + schema + ".bak";
                if (!File.Exists(bak)) File.Copy(path, bak);
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException) { }
        }

        /* ============================================================== */
        /*  SAVE                                                          */
        /* ============================================================== */

        public bool Save<T>(string relative, int schema, T payload, out string error, bool indented = true) where T : class
        {
            error = null;
            string path = FullPath(relative);
            lock (LockFor(path))
            {
                try
                {
                    // Сүүлийн Load файлыг УНШИЖ ЧАДААГҮЙ бол дуудагчийн утга анхдагчаас гарсан — дарж бичвэл бодит түүх устна.
                    bool unreadable;
                    if (UnreadablePaths.TryGetValue(path, out unreadable))
                    {
                        error = "file was unreadable at the last load; refusing to overwrite it";
                        SmartLog.Warn("store", "save_refused_unreadable", new { file = Path.GetFileName(path) });
                        return false;
                    }

                    // Шинэ add-in-ийн бичсэн файлыг дарж бичихгүй.
                    int onDisk = PeekSchema(path);
                    if (onDisk < 0)
                    {
                        error = "cannot inspect the existing file (locked?); refusing to overwrite it";
                        SmartLog.Warn("store", "save_refused_uninspectable", new { file = Path.GetFileName(path) });
                        return false;
                    }
                    if (onDisk > schema)
                    {
                        error = "file schema " + onDisk + " is newer than " + schema;
                        SmartLog.Warn("store", "save_refused_newer", new { file = Path.GetFileName(path), disk = onDisk, cur = schema });
                        return false;
                    }

                    var envelope = new JsonObject
                    {
                        ["schema"] = schema,
                        ["savedUtc"] = DateTime.UtcNow.ToString("o"),
                        ["payload"] = JsonSerializer.SerializeToNode(payload, SmartJson.Compact),
                    };
                    string text = envelope.ToJsonString(indented ? SmartJson.Indented : SmartJson.Compact);

                    Directory.CreateDirectory(Path.GetDirectoryName(path));
                    AtomicWrite(path, text);
                    return true;
                }
                catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException
                                            || ex is JsonException || ex is NotSupportedException)
                {
                    error = ex.GetType().Name + ": " + SmartLog.Scrub(ex.Message);
                    SmartLog.Warn("store", "save_failed", new { file = Path.GetFileName(path), ex = ex.GetType().Name });
                    return false;
                }
            }
        }

        public bool Save<T>(string relative, int schema, T payload, bool indented = true) where T : class
        {
            string err;
            return Save(relative, schema, payload, out err, indented);
        }

        /// <summary>
        /// Файлын `schema`-г ЗӨВХӨН толгойгоос нь уншина (бүтэн задлахгүй).  Байхгүй/толгойгүй = 0;
        /// УНШИЖ ЧАДААГҮЙ (түгжигдсэн/эрхгүй) = -1 — «шинэ хувилбар мөн эсэх» ТОДОРХОЙГҮЙ тул дуудагч дарж бичихгүй.
        /// </summary>
        private static int PeekSchema(string path)
        {
            try
            {
                // `File.Exists` биш — нээж үзнэ (эрхгүй/түгжигдсэнийг «байхгүй» гэж үзвэл шинэ add-in-ийн файлыг дарж бичнэ).
                using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                {
                    byte[] buf = new byte[512];
                    int n = fs.Read(buf, 0, buf.Length);
                    string head = Utf8.GetString(buf, 0, n);
                    int i = head.IndexOf("\"schema\"", StringComparison.Ordinal);
                    if (i < 0) return 0;
                    i = head.IndexOf(':', i);
                    if (i < 0) return 0;
                    i++;
                    while (i < head.Length && char.IsWhiteSpace(head[i])) i++;
                    int j = i;
                    while (j < head.Length && char.IsDigit(head[j])) j++;
                    int v;
                    return j > i && int.TryParse(head.Substring(i, j - i), out v) ? v : 0;
                }
            }
            catch (Exception ex) when (ex is FileNotFoundException || ex is DirectoryNotFoundException)
            {
                return 0;   // файл байхгүй — шинэ файл бичихэд саад алга
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
            {
                return -1;
            }
        }

        /// <summary>
        /// Түр файлд бичээд солино.  Антивирус/индексатор файлыг хэсэг түгжих нь элбэг тул
        /// IOException дээр 3 удаа богино завсартай дахин оролдоно.
        /// </summary>
        public static void AtomicWrite(string path, string text)
        {
            string tmp = path + ".tmp-" + Guid.NewGuid().ToString("N").Substring(0, 8);
            try
            {
                using (var fs = new FileStream(tmp, FileMode.Create, FileAccess.Write, FileShare.None))
                {
                    byte[] bytes = Utf8.GetBytes(text);
                    fs.Write(bytes, 0, bytes.Length);
                    fs.Flush(true);
                }

                for (int attempt = 0; ; attempt++)
                {
                    try
                    {
                        if (File.Exists(path)) File.Replace(tmp, path, path + ".bak", true);
                        else File.Move(tmp, path);
                        return;
                    }
                    catch (IOException) when (attempt < 3)
                    {
                        System.Threading.Thread.Sleep(40 * (attempt + 1));
                    }
                }
            }
            finally
            {
                try { if (File.Exists(tmp)) File.Delete(tmp); } catch (IOException) { } catch (UnauthorizedAccessException) { }
            }
        }
    }
}
