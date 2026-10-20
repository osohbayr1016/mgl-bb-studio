using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using RevitMcpAddin.Feedback.Core;

namespace RevitMcpAddin.Feedback.Tests
{
    internal static class Tmp
    {
        public static string Dir(string tag)
        {
            string d = Path.Combine(Path.GetTempPath(), "mgl-fb-tests", tag + "-" + Guid.NewGuid().ToString("N").Substring(0, 8));
            Directory.CreateDirectory(d);
            return d;
        }

        public static string File(string dir, string name, int size, byte seed = 7)
        {
            string p = Path.Combine(dir, name);
            var b = new byte[size];
            for (int i = 0; i < size; i++) b[i] = (byte)((i * 31 + seed) & 0xFF);
            System.IO.File.WriteAllBytes(p, b);
            return p;
        }
    }

    public static class LimitsTests
    {
        [Test]
        public static void Extension_and_problem_rules_mirror_the_server()
        {
            FeedbackLimits.ResetToDefaults();
            Assert.Eq("pdf", FeedbackLimits.ExtensionOf(@"C:\a\b\Тайлан.final.PDF"));
            Assert.Eq("", FeedbackLimits.ExtensionOf("noext"));
            Assert.Eq("rvt", FeedbackLimits.ExtensionOf("dir/model.rvt"));
            Assert.Null(FeedbackLimits.FileProblem("a.png", 1000, 0, 0));
            Assert.NotNull(FeedbackLimits.FileProblem("a.exe", 1000, 0, 0), "exe хориотой");
            Assert.NotNull(FeedbackLimits.FileProblem("a.png", 0, 0, 0), "хоосон");
            Assert.NotNull(FeedbackLimits.FileProblem("a.png", 26L * 1024 * 1024, 0, 0), "энгийн > 25 MiB");
            Assert.Null(FeedbackLimits.FileProblem("a.rvt", 60L * 1024 * 1024, 0, 0), "rvt 60 MiB ок");
            Assert.NotNull(FeedbackLimits.FileProblem("a.rvt", 60L * 1024 * 1024, 50L * 1024 * 1024, 1), "нийт > 100 MiB");
            Assert.NotNull(FeedbackLimits.FileProblem("a.png", 10, 0, 5), "6 дахь файл");
            Assert.False(FeedbackLimits.IsMultipart("rvt", 25L * 1024 * 1024));
            Assert.True(FeedbackLimits.IsMultipart("rvt", 25L * 1024 * 1024 + 1));
            Assert.False(FeedbackLimits.IsMultipart("pdf", 30L * 1024 * 1024), "энгийн өргөтгөл хэзээ ч multipart биш");
            Assert.Eq(4, FeedbackLimits.PartCount(26L * 1024 * 1024 + 5, 8 * 1024 * 1024));
            Assert.Eq(2L * 1024 * 1024 + 5, FeedbackLimits.ExpectedPartSize(26L * 1024 * 1024 + 5, 4, 8 * 1024 * 1024));
            Assert.Eq(-1L, FeedbackLimits.ExpectedPartSize(100, 2, 8 * 1024 * 1024));
        }

        [Test]
        public static void Server_capabilities_override_limits_and_bad_json_is_ignored()
        {
            FeedbackLimits.ResetToDefaults();
            Assert.False(FeedbackLimits.ApplyCapabilities("{not json"));
            Assert.False(FeedbackLimits.ApplyCapabilities("{\"can_submit\":true}"));
            Assert.Eq(5, FeedbackLimits.MaxAttachments);
            bool ok = FeedbackLimits.ApplyCapabilities("{\"limits\":{\"max_attachments\":3,\"max_total_bytes\":52428800,\"max_ordinary_bytes\":10485760,\"part_bytes\":5242880,\"extensions\":{\"png\":{\"large\":false},\"rvt\":{\"large\":true}}}}");
            Assert.True(ok);
            Assert.Eq(3, FeedbackLimits.MaxAttachments);
            Assert.Eq(10L * 1024 * 1024, FeedbackLimits.MaxOrdinaryBytes);
            Assert.False(FeedbackLimits.IsAllowedExtension("pdf"), "серверийн жагсаалтад байхгүй");
            Assert.True(FeedbackLimits.IsLarge("rvt"));
            // мужаас гадуурх утга — өгөгдмөл хэвээр
            FeedbackLimits.ResetToDefaults();
            FeedbackLimits.ApplyCapabilities("{\"limits\":{\"max_attachments\":999,\"part_bytes\":1}}");
            Assert.Eq(5, FeedbackLimits.MaxAttachments);
            Assert.Eq(8 * 1024 * 1024, FeedbackLimits.PartBytes);
            FeedbackLimits.ResetToDefaults();
        }
    }

    public static class ScopeTests
    {
        private static string Jwt(string payloadJson)
        {
            string b64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(payloadJson)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
            return "eyJhbGciOiJIUzI1NiJ9." + b64 + ".sig";
        }

        [Test]
        public static void Scope_separates_host_tenant_and_user()
        {
            string a = FeedbackScope.Key("https://api.example.com/", null, 10);
            Assert.Eq(a, FeedbackScope.Key("HTTPS://API.EXAMPLE.COM", null, 10), "хост хэвийжүүлэлт");
            Assert.True(a != FeedbackScope.Key("https://api.example.com", null, 11), "өөр хэрэглэгч");
            Assert.True(a != FeedbackScope.Key("https://api.example.com", "t2", 10), "өөр tenant");
            Assert.True(a != FeedbackScope.Key("https://other.example.com", null, 10), "өөр сервер");
            Assert.Eq(16, a.Length);
        }

        [Test]
        public static void Token_sub_and_tid_are_read_without_verification()
        {
            Assert.True(FeedbackScope.TryReadToken(Jwt("{\"sub\":75,\"role\":\"admin\"}"), out long sub, out string tid));
            Assert.Eq(75L, sub);
            Assert.Null(tid);
            Assert.True(FeedbackScope.TryReadToken(Jwt("{\"sub\":\"12\",\"tid\":\"acme\"}"), out sub, out tid));
            Assert.Eq(12L, sub);
            Assert.Eq("acme", tid);
            Assert.False(FeedbackScope.TryReadToken("garbage", out sub, out tid));
            Assert.False(FeedbackScope.TryReadToken(Jwt("{\"role\":\"admin\"}"), out sub, out tid), "sub алга");
            Assert.False(FeedbackScope.TryReadToken(Jwt("{\"sub\":0}"), out sub, out tid), "sub 0");
        }
    }

    public static class OutboxTests
    {
        internal static FeedbackItem NewItem(string scope, long user = 10, string title = "Ханын дэлгээс унав")
        {
            return new FeedbackItem
            {
                Id = FeedbackItem.NewClientId("rvt"),
                Scope = scope,
                Host = "https://api.example.com",
                UserId = user,
                CreatedAt = FeedbackTime.Iso(DateTimeOffset.UtcNow),
                Fields = new FeedbackFields { Title = title, Description = "Revit 2027 дээр хуудас үүсгэхгүй", Source = FeedbackSources.WallElevation, ToolId = "MglWallElevations" },
            };
        }

        [Test]
        public static void Enqueue_copies_files_with_hash_and_lists_by_scope()
        {
            string root = Tmp.Dir("outbox");
            string src = Tmp.Dir("src");
            var box = new FeedbackOutbox(root);
            string scopeA = FeedbackScope.Key("https://api.example.com", null, 10);
            string scopeB = FeedbackScope.Key("https://api.example.com", null, 11);
            string f1 = Tmp.File(src, "дэлгэцийн зураг.png", 1000);
            string f2 = Tmp.File(src, "лог.txt", 50);
            FeedbackItem it = box.Enqueue(NewItem(scopeA), new List<FeedbackSourceFile>
            {
                new FeedbackSourceFile { Path = f1, Name = "дэлгэцийн зураг.png", Kind = "screenshot" },
                new FeedbackSourceFile { Path = f2, Name = "лог.txt" },
            });
            Assert.Eq(2, it.Attachments.Count);
            Assert.Eq(FakeServer.Hex(File.ReadAllBytes(f1)), it.Attachments[0].Sha256);
            Assert.True(File.Exists(box.FilePath(it, it.Attachments[0])), "локал хуулбар");
            // эх файлыг устгасан ч хуулбар хэвээр
            File.Delete(f1);
            Assert.True(File.Exists(box.FilePath(it, it.Attachments[0])));
            Assert.Eq(1, box.List(scopeA).Count);
            Assert.Eq(0, box.List(scopeB).Count, "өөр хэрэглэгчийн хүрээнд харагдахгүй");
            Assert.Throws<InvalidOperationException>(() => box.Enqueue(NewItem(scopeA), new List<FeedbackSourceFile> { new FeedbackSourceFile { Path = Tmp.File(src, "x.exe", 10), Name = "x.exe" } }));
            Assert.Eq(1, box.List(scopeA).Count, "буруу файлтай item үлдээгүй");
        }

        [Test]
        public static void Partial_and_corrupt_items_are_never_listed()
        {
            string root = Tmp.Dir("outbox");
            var box = new FeedbackOutbox(root);
            string scope = FeedbackScope.Key("h", null, 1);
            Directory.CreateDirectory(Path.Combine(box.ScopeDir(scope), "rvt_half.partial"));
            File.WriteAllText(Path.Combine(box.ScopeDir(scope), "rvt_half.partial", "item.json"), "{\"id\":\"rvt_half\",\"scope\":\"" + scope + "\"}");
            Directory.CreateDirectory(Path.Combine(box.ScopeDir(scope), "rvt_bad"));
            File.WriteAllText(Path.Combine(box.ScopeDir(scope), "rvt_bad", "item.json"), "{broken");
            box.Enqueue(NewItem(scope, 1), null);
            Assert.Eq(1, box.List(scope).Count);
        }

        [Test]
        public static void Save_is_atomic_and_refuses_removed_items()
        {
            string root = Tmp.Dir("outbox");
            var box = new FeedbackOutbox(root);
            string scope = FeedbackScope.Key("h", null, 1);
            FeedbackItem it = box.Enqueue(NewItem(scope, 1), null);
            it.State = FeedbackStates.RetryWait;
            Assert.True(box.Save(it));
            Assert.Eq(FeedbackStates.RetryWait, box.Load(scope, it.Id).State);
            Assert.Eq(0, Directory.GetFiles(box.ItemDir(scope, it.Id), "*.tmp-*").Length, "tmp файл үлдээгүй");
            Assert.True(box.Delete(it));
            Assert.False(box.Save(it), "устгасан item дахин гарч ирэхгүй");
        }

        [Test]
        public static void Lease_is_exclusive_within_and_across_processes()
        {
            string root = Tmp.Dir("outbox");
            var box = new FeedbackOutbox(root);
            string scope = FeedbackScope.Key("h", null, 1);
            FeedbackItem it = box.Enqueue(NewItem(scope, 1), null);
            string lockPath = Path.Combine(box.ItemDir(scope, it.Id), ".lock");
            using (IDisposable first = box.TryLease(it))
            {
                Assert.NotNull(first);
                Assert.Null(box.TryLease(it), "ижил процесст хоёр дахь lease үгүй");
                Assert.Eq(3, RunProbe(lockPath), "өөр процесс түгжээг авч чадахгүй");
                Assert.False(box.Delete(it), "илгээж буй item устгагдахгүй");
            }
            Assert.Eq(0, RunProbe(lockPath), "чөлөөлсний дараа өөр процесс авна");
            using (IDisposable again = box.TryLease(it)) Assert.NotNull(again);
        }

        /// <summary>Хүүхэд процесс: түгжээг авч чадвал 0, завгүй бол 3.</summary>
        public static int ProbeLock(string path)
        {
            try
            {
                using (new FileStream(path, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None, 1, FileOptions.DeleteOnClose)) return 0;
            }
            catch (IOException)
            {
                return 3;
            }
        }

        private static int RunProbe(string lockPath)
        {
            string host = Environment.ProcessPath;
            string dll = typeof(OutboxTests).Assembly.Location;
            bool viaDotnet = string.Equals(Path.GetFileNameWithoutExtension(host), "dotnet", StringComparison.OrdinalIgnoreCase);
            var psi = new ProcessStartInfo(host) { UseShellExecute = false, CreateNoWindow = true };
            if (viaDotnet) psi.ArgumentList.Add(dll);
            psi.ArgumentList.Add("--probe-lock");
            psi.ArgumentList.Add(lockPath);
            using (Process p = Process.Start(psi))
            {
                if (!p.WaitForExit(30000)) { p.Kill(); return -1; }
                return p.ExitCode;
            }
        }

        [Test]
        public static void Prune_keeps_the_latest_terminal_items()
        {
            string root = Tmp.Dir("outbox");
            var box = new FeedbackOutbox(root);
            string scope = FeedbackScope.Key("h", null, 1);
            for (int i = 0; i < FeedbackOutbox.MaxKeptSubmitted + 3; i++)
            {
                FeedbackItem it = NewItem(scope, 1);
                it.CreatedAt = FeedbackTime.Iso(DateTimeOffset.UtcNow.AddMinutes(i));
                box.Enqueue(it, null);
                it.State = FeedbackStates.Submitted;
                box.Save(it);
            }
            FeedbackItem pending = NewItem(scope, 1);
            pending.CreatedAt = FeedbackTime.Iso(DateTimeOffset.UtcNow.AddMinutes(-100));
            box.Enqueue(pending, null);
            Assert.Eq(3, box.Prune(scope));
            List<FeedbackItem> left = box.List(scope);
            Assert.Eq(FeedbackOutbox.MaxKeptSubmitted + 1, left.Count);
            Assert.True(left.Any(x => x.Id == pending.Id), "дуусаагүй item хэзээ ч устахгүй");
        }
    }

    public static class RetryTests
    {
        [Test]
        public static void Delay_grows_is_capped_and_honours_retry_after()
        {
            Assert.Eq(TimeSpan.FromSeconds(2.5), FeedbackRetry.Delay(1, null, 0));
            Assert.Eq(TimeSpan.FromSeconds(5), FeedbackRetry.Delay(1, null, 1));
            Assert.True(FeedbackRetry.Delay(3, null, 0.5) > FeedbackRetry.Delay(2, null, 0.5));
            Assert.True(FeedbackRetry.Delay(50, null, 1) <= FeedbackRetry.Cap);
            Assert.Eq(TimeSpan.FromSeconds(42), FeedbackRetry.Delay(1, TimeSpan.FromSeconds(42), 0.9));
            Assert.Eq(TimeSpan.FromSeconds(3600), FeedbackRetry.Delay(1, TimeSpan.FromHours(5), 0));
        }

        [Test]
        public static void Classification_separates_transient_auth_and_permanent()
        {
            Assert.Eq(FailureKind.Transient, FeedbackRetry.Classify(new FeedbackNetworkException("dns")));
            Assert.Eq(FailureKind.Transient, FeedbackRetry.Classify(new FeedbackHttpException(503, "STORAGE_UNAVAILABLE", "x")));
            Assert.Eq(FailureKind.Transient, FeedbackRetry.Classify(new FeedbackHttpException(429, null, "x")));
            Assert.Eq(FailureKind.AuthRequired, FeedbackRetry.Classify(new FeedbackHttpException(401, null, "x")));
            Assert.Eq(FailureKind.Permanent, FeedbackRetry.Classify(new FeedbackHttpException(403, "FORBIDDEN", "x")));
            Assert.Eq(FailureKind.Permanent, FeedbackRetry.Classify(new FeedbackHttpException(413, "LIMIT", "x")));
            Assert.Eq(FailureKind.Permanent, FeedbackRetry.Classify(new FeedbackHttpException(422, "BAD_FIELDS", "x")));
            Assert.Eq(FailureKind.Transient, FeedbackRetry.Classify(new FeedbackHttpException(409, "SUBMIT_FAILED", "x")));
        }
    }

    public static class DiagnosticsTests
    {
        [Test]
        public static void User_profile_paths_and_signed_urls_are_masked()
        {
            string m = FeedbackDiagnostics.Mask(@"C:\Users\Bat-Erdene\AppData\Local\MGL\x.dll and https://r2.example/x?X-Amz-Signature=abcd&ok=1");
            Assert.True(m.Contains(@"%USERPROFILE%\AppData\Local\MGL\x.dll"), m);
            Assert.False(m.Contains("Bat-Erdene"), m);
            Assert.False(m.Contains("abcd"), m);
            Assert.True(m.Contains("ok=1"), m);
        }

        [Test]
        public static void Build_is_versioned_bounded_and_drops_secret_keys()
        {
            Exception ex;
            try { throw new InvalidOperationException("boom " + new string('x', 2000)); }
            catch (Exception e) { ex = e; }
            var d = new DiagnosticsInput
            {
                RevitYear = "2027",
                RevitVersionBuild = "27.2.10.64",
                AddinVersion = "1.46.0",
                AddinDllPath = @"C:\Users\someone\AppData\Local\MGL\RevitAddin\2027\versions\1.46.0\RevitMcpAddin.dll",
                AddinDllSha256 = new string('a', 64),
                ToolId = "MglWallElevations",
                Stage = "sheets",
                Error = FeedbackDiagnostics.Describe(ex),
                Extra = new Dictionary<string, string> { ["api_token"] = "SECRET", ["rooms"] = "12", ["Authorization"] = "Bearer x", ["huge"] = new string('y', 200000) },
            };
            string json = FeedbackDiagnostics.Build(d, DateTimeOffset.UtcNow);
            Assert.True(Encoding.UTF8.GetByteCount(json) <= FeedbackLimits.DiagnosticsMaxBytes, "≤ 64 KiB");
            using (JsonDocument doc = JsonDocument.Parse(json))
            {
                JsonElement r = doc.RootElement;
                Assert.Eq(FeedbackDiagnostics.Schema, r.GetProperty("schema").GetString());
                Assert.Eq("2027", r.GetProperty("revit").GetProperty("year").GetString());
                Assert.Eq("27.2.10.64", r.GetProperty("revit").GetProperty("version_build").GetString());
                Assert.True(r.GetProperty("addin").GetProperty("dll_path").GetString().StartsWith("%USERPROFILE%"));
                Assert.Eq("addin", r.GetProperty("error").GetProperty("classification").GetString());
            }
            Assert.False(json.Contains("SECRET"), "нууц түлхүүр хасагдсан");
            Assert.False(json.Contains("Bearer x"));
            Assert.False(json.Contains("someone"));
        }

        [Test]
        public static void Exceptions_are_classified()
        {
            Assert.Eq("environment", FeedbackDiagnostics.Classify(new IOException("disk")));
            Assert.Eq("environment", FeedbackDiagnostics.Classify(new UnauthorizedAccessException("acl")));
            Assert.Eq("unknown", FeedbackDiagnostics.Classify(new ArgumentException("x")));
            Exception thrown;
            try { throw new ArgumentException("ours"); } catch (Exception e) { thrown = e; }
            Assert.Eq("addin", FeedbackDiagnostics.Classify(thrown), "stack-д RevitMcpAddin.* мөр");
        }
    }

    public static class CrashStoreTests
    {
        [Test]
        public static void Crashes_are_offered_once_bounded_and_expire()
        {
            string dir = Tmp.Dir("crash");
            DateTimeOffset now = DateTimeOffset.UtcNow;
            for (int i = 0; i < 7; i++)
                FeedbackCrashStore.Write(dir, new InvalidOperationException("c" + i), "1.46.0", "2027", "MglWallElevations", now.AddSeconds(i));
            Assert.Eq(FeedbackCrashStore.MaxFiles, Directory.GetFiles(dir, "crash-*.json").Length, "≤ 5 файл");
            List<FeedbackCrashStore.CrashRecord> p = FeedbackCrashStore.Pending(dir, now.AddMinutes(1));
            Assert.Eq(5, p.Count);
            Assert.Eq("c6", p[0].Error.Message, "шинэ нь эхэнд");
            FeedbackCrashStore.MarkHandled(p[0]);
            Assert.Eq(4, FeedbackCrashStore.Pending(dir, now.AddMinutes(1)).Count);
            Assert.Eq(0, FeedbackCrashStore.Pending(dir, now.AddDays(15)).Count, "14 хоногоос хуучныг санал болгохгүй");
        }
    }
}
