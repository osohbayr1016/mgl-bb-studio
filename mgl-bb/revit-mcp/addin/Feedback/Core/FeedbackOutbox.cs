using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace RevitMcpAddin.Feedback.Core
{
    /// <summary>
    /// «Санал хүсэлт»-ийн ОФЛАЙН ДАРААЛАЛ — сервер дугаар олгох хүртэл бичсэн текст, хавсралт хэзээ ч алдагдахгүй.
    ///
    /// Бүтэц: <c>&lt;root&gt;\&lt;scope&gt;\&lt;id&gt;\item.json</c> + <c>files\</c> (сонгосон файлын ЛОКАЛ хуулбар — эх файлыг
    /// хэрэглэгч устгаж/засварласан ч илгээлт эвдрэхгүй) + <c>.lock</c>.
    ///   • хүрээ (<see cref="FeedbackScope"/>) тус бүрд тусдаа хавтас — өөр хэрэглэгчийн дараалал уншигдахгүй;
    ///   • шинэ item эхлээд <c>&lt;id&gt;.partial</c>-д бүрэн бичигдээд НЭГ rename-ээр гарч ирнэ (хагас хуулсан item жагсаалтад үгүй);
    ///   • item.json-ыг атомоор (tmp + replace) — уншигч хуучин эсвэл шинэ бүтэн хувилбарыг л хардаг;
    ///   • ИЛГЭЭХИЙН ӨМНӨ <see cref="TryLease"/> (<c>.lock</c>, FileShare.None + DeleteOnClose) — хоёр Revit процесс НЭГ
    ///     хүсэлтийг зэрэг илгээхгүй; процесс унавал OS түгжээг чөлөөлнө.
    /// Токен, нууц үг энд ХЭЗЭЭ Ч бичигдэхгүй (item-д зөвхөн хэрэглэгчийн id, хост, tenant).
    /// </summary>
    public sealed class FeedbackOutbox
    {
        public const string ItemFile = "item.json";
        private const string LockFile = ".lock";
        private const string FilesDir = "files";
        private const string PartialSuffix = ".partial";
        public const int MaxKeptSubmitted = 50;

        private static readonly JsonSerializerOptions Json = new JsonSerializerOptions { WriteIndented = true };

        public string Root { get; }

        public FeedbackOutbox(string root)
        {
            Root = root ?? throw new ArgumentNullException(nameof(root));
        }

        /// <summary>Өгөгдмөл байршил: <c>%APPDATA%\RevitMcpAddin\feedback</c>.</summary>
        public static string DefaultRoot() =>
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "RevitMcpAddin", "feedback");

        public string ScopeDir(string scope) => Path.Combine(Root, Safe(scope));
        public string ItemDir(string scope, string id) => Path.Combine(ScopeDir(scope), Safe(id));

        /// <summary>Хавсралтын локал хуулбарын бүтэн зам.</summary>
        public string FilePath(FeedbackItem item, FeedbackAttachment a) => Path.Combine(ItemDir(item.Scope, item.Id), FilesDir, a.LocalFile);

        /// <summary>
        /// Шинэ хүсэлтийг дараалалд нэмнэ: файлуудыг хуулж (stream + SHA-256), item.json бичээд нэг rename-ээр нийтэлнэ.
        /// Хязгаар зөрчвөл <see cref="InvalidOperationException"/> (монгол мессежтэй) — юу ч үлдэхгүй.
        /// </summary>
        public FeedbackItem Enqueue(FeedbackItem item, IList<FeedbackSourceFile> files)
        {
            if (item == null) throw new ArgumentNullException(nameof(item));
            if (string.IsNullOrEmpty(item.Id) || string.IsNullOrEmpty(item.Scope)) throw new ArgumentException("item.Id / item.Scope");
            files = files ?? new List<FeedbackSourceFile>();
            long total = 0;
            for (int i = 0; i < files.Count; i++)
            {
                long size = new FileInfo(files[i].Path).Length;
                string problem = FeedbackLimits.FileProblem(files[i].Name, size, total, i);
                if (problem != null) throw new InvalidOperationException(files[i].Name + ": " + problem);
                total += size;
            }

            string final = ItemDir(item.Scope, item.Id);
            string partial = final + PartialSuffix;
            if (Directory.Exists(final)) throw new InvalidOperationException("Энэ хүсэлт дараалалд аль хэдийн байна");
            if (Directory.Exists(partial)) Directory.Delete(partial, true);
            Directory.CreateDirectory(Path.Combine(partial, FilesDir));
            try
            {
                item.Attachments = new List<FeedbackAttachment>();
                for (int i = 0; i < files.Count; i++)
                {
                    FeedbackSourceFile f = files[i];
                    string local = (i + 1).ToString(CultureInfo.InvariantCulture) + "_" + LocalName(f.Name);
                    string dest = Path.Combine(partial, FilesDir, local);
                    long size;
                    string sha = CopyWithHash(f.Path, dest, out size);
                    item.Attachments.Add(new FeedbackAttachment
                    {
                        ClientAttachmentId = FeedbackItem.NewClientId("att"),
                        Name = f.Name,
                        LocalFile = local,
                        Size = size,
                        Sha256 = sha,
                        Kind = string.IsNullOrEmpty(f.Kind) ? "file" : f.Kind,
                    });
                }
                if (string.IsNullOrEmpty(item.State)) item.State = FeedbackStates.Queued;
                WriteAtomic(Path.Combine(partial, ItemFile), JsonSerializer.Serialize(item, Json));
                Directory.Move(partial, final);
            }
            catch
            {
                try { if (Directory.Exists(partial)) Directory.Delete(partial, true); } catch (Exception) { }
                throw;
            }
            return item;
        }

        /// <summary>Хүрээний бүх item (эвдэрсэн/хагас item алгасагдана), үүсгэсэн дарааллаар.</summary>
        public List<FeedbackItem> List(string scope)
        {
            var list = new List<FeedbackItem>();
            string dir = ScopeDir(scope);
            if (!Directory.Exists(dir)) return list;
            foreach (string d in Directory.GetDirectories(dir))
            {
                if (d.EndsWith(PartialSuffix, StringComparison.OrdinalIgnoreCase)) continue;
                FeedbackItem it = TryRead(Path.Combine(d, ItemFile));
                if (it != null) list.Add(it);
            }
            list.Sort((a, b) => string.CompareOrdinal(a.CreatedAt ?? "", b.CreatedAt ?? ""));
            return list;
        }

        public FeedbackItem Load(string scope, string id) => TryRead(Path.Combine(ItemDir(scope, id), ItemFile));

        /// <summary>Атомоор хадгална (item хавтас устсан бол юу ч хийхгүй — цуцлагдсан item дахин гарч ирэхгүй).</summary>
        public bool Save(FeedbackItem item)
        {
            string dir = ItemDir(item.Scope, item.Id);
            if (!Directory.Exists(dir)) return false;
            WriteAtomic(Path.Combine(dir, ItemFile), JsonSerializer.Serialize(item, Json));
            return true;
        }

        /// <summary>
        /// Энэ item-ийг ЗӨВХӨН энэ процесс илгээх түгжээ.  Өөр процесс (өөр Revit) барьж байвал null.
        /// Буцаасан объектыг Dispose хийхэд түгжээ чөлөөлөгдөнө (процесс унавал OS өөрөө).
        /// </summary>
        public IDisposable TryLease(FeedbackItem item)
        {
            string dir = ItemDir(item.Scope, item.Id);
            if (!Directory.Exists(dir)) return null;
            try
            {
                return new FileStream(Path.Combine(dir, LockFile), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None, 1, FileOptions.DeleteOnClose);
            }
            catch (IOException)
            {
                return null;
            }
            catch (UnauthorizedAccessException)
            {
                return null;
            }
        }

        /// <summary>Хавсралтын локал хуулбаруудыг устгана (илгээгдсэн / цуцалсны дараа) — item.json түүх болж үлдэнэ.</summary>
        public void DropFiles(FeedbackItem item)
        {
            string files = Path.Combine(ItemDir(item.Scope, item.Id), FilesDir);
            try { if (Directory.Exists(files)) Directory.Delete(files, true); } catch (Exception) { }
        }

        /// <summary>Item-ийг бүхэлд нь устгана (түгжээтэй бол устгахгүй — илгээж буй процессыг таслахгүй).</summary>
        public bool Delete(FeedbackItem item)
        {
            using (IDisposable lease = TryLease(item))
            {
                if (lease == null) return false;
            }
            string dir = ItemDir(item.Scope, item.Id);
            try
            {
                if (Directory.Exists(dir)) Directory.Delete(dir, true);
                return true;
            }
            catch (Exception)
            {
                return false;
            }
        }

        /// <summary>Хуучин илгээгдсэн / цуцлагдсан item-ийн тоог <see cref="MaxKeptSubmitted"/>-д барина.</summary>
        public int Prune(string scope)
        {
            List<FeedbackItem> done = List(scope).FindAll(i => FeedbackStates.IsTerminal(i.State));
            int removed = 0;
            for (int i = 0; i < done.Count - MaxKeptSubmitted; i++)
                if (Delete(done[i])) removed++;
            return removed;
        }

        /* ────────────────────────────── туслах ────────────────────────────── */

        private static FeedbackItem TryRead(string path)
        {
            try
            {
                if (!File.Exists(path)) return null;
                string text = File.ReadAllText(path, Encoding.UTF8);
                FeedbackItem it = JsonSerializer.Deserialize<FeedbackItem>(text);
                if (it == null || string.IsNullOrEmpty(it.Id) || string.IsNullOrEmpty(it.Scope)) return null;
                if (it.Attachments == null) it.Attachments = new List<FeedbackAttachment>();
                if (it.Fields == null) it.Fields = new FeedbackFields();
                return it;
            }
            catch (Exception)
            {
                return null;
            }
        }

        internal static void WriteAtomic(string path, string text)
        {
            string tmp = path + ".tmp-" + Guid.NewGuid().ToString("N");
            File.WriteAllText(tmp, text, new UTF8Encoding(false));
            try
            {
                if (File.Exists(path)) File.Replace(tmp, path, null, true);
                else File.Move(tmp, path);
            }
            catch
            {
                try { if (File.Exists(tmp)) File.Delete(tmp); } catch (Exception) { }
                throw;
            }
        }

        private static string CopyWithHash(string src, string dest, out long size)
        {
            using (var input = new FileStream(src, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 81920))
            using (var output = new FileStream(dest, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920))
            using (SHA256 sha = SHA256.Create())
            {
                byte[] buf = new byte[81920];
                int n;
                size = 0;
                while ((n = input.Read(buf, 0, buf.Length)) > 0)
                {
                    sha.TransformBlock(buf, 0, n, null, 0);
                    output.Write(buf, 0, n);
                    size += n;
                }
                sha.TransformFinalBlock(new byte[0], 0, 0);
                return Hex(sha.Hash);
            }
        }

        public static string Hex(byte[] b)
        {
            var sb = new StringBuilder(b.Length * 2);
            foreach (byte x in b) sb.Append(x.ToString("x2", CultureInfo.InvariantCulture));
            return sb.ToString();
        }

        /// <summary>Хавтас/файлын нэрэнд аюулгүй (scope, id нь өөрөө аюулгүй тэмдэгттэй ч хамгаалалт).</summary>
        private static string Safe(string s)
        {
            if (string.IsNullOrEmpty(s)) throw new ArgumentException("empty path segment");
            var sb = new StringBuilder(s.Length);
            foreach (char c in s) sb.Append(char.IsLetterOrDigit(c) || c == '_' || c == '-' ? c : '_');
            return sb.ToString();
        }

        /// <summary>Локал хуулбарын нэр: кирилл хадгална, Windows-д хориотой тэмдэгт/зам хасна, уртыг барина.</summary>
        private static string LocalName(string name)
        {
            string n = (name ?? "file").Replace('/', '\\');
            int slash = n.LastIndexOf('\\');
            if (slash >= 0) n = n.Substring(slash + 1);
            var sb = new StringBuilder(n.Length);
            foreach (char c in n)
            {
                if (c < 32 || "<>:\"|?*".IndexOf(c) >= 0) sb.Append('_');
                else sb.Append(c);
            }
            string r = sb.ToString().Trim().TrimEnd('.');
            if (r.Length == 0) r = "file";
            if (r.Length > 120)
            {
                string ext = FeedbackLimits.ExtensionOf(r);
                r = r.Substring(0, 100) + (ext.Length > 0 ? "." + ext : "");
            }
            return r;
        }
    }

    /// <summary>Дараалалд нэмэх эх файл (хэрэглэгчийн сонгосон эсвэл дэлгэцийн зураг).</summary>
    public sealed class FeedbackSourceFile
    {
        public string Path { get; set; }
        public string Name { get; set; }
        public string Kind { get; set; } = "file";
    }
}
