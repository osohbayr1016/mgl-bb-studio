using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using RevitMcpAddin.Intelligence.Core;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.Smart.Tests
{
    public enum SampleKind { Unknown = 0, Alpha, BetaGamma }

    public sealed class SampleDoc
    {
        public string Name { get; set; }
        public SampleKind Kind { get; set; }
        public SampleKind? Opt { get; set; }
        public List<int> Numbers { get; set; } = new List<int>();
    }

    public static class TestDirs
    {
        public static string NewTemp()
        {
            string d = Path.Combine(Path.GetTempPath(), "smart-tests-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(d);
            return d;
        }
    }

    public static class FoundationTests
    {
        /* ------------------------------ JSON ------------------------------ */

        [Test]
        public static void Json_Enum_WritesCamelCase_ReadsAnyCase()
        {
            string json = SmartJson.Serialize(new SampleDoc { Name = "x", Kind = SampleKind.BetaGamma });
            Assert.True(json.Contains("\"betaGamma\""), json);
            var back = SmartJson.Deserialize<SampleDoc>("{\"name\":\"x\",\"kind\":\"BETAGAMMA\"}");
            Assert.Eq(SampleKind.BetaGamma, back.Kind);
            var snake = SmartJson.Deserialize<SampleDoc>("{\"kind\":\"beta_gamma\"}");
            Assert.Eq(SampleKind.BetaGamma, snake.Kind);
        }

        [Test]
        public static void Json_Enum_UnknownValue_FallsBackToDefault_NotException()
        {
            var d = SmartJson.Deserialize<SampleDoc>("{\"kind\":\"fromTheFuture\",\"opt\":\"alsoNew\",\"numbers\":[1,2]}");
            Assert.Eq(SampleKind.Unknown, d.Kind);
            Assert.Eq(SampleKind.Unknown, d.Opt.Value);
            Assert.SeqEq(new[] { 1, 2 }, d.Numbers);
            var n = SmartJson.Deserialize<SampleDoc>("{\"kind\":99}");
            Assert.Eq(SampleKind.Unknown, n.Kind);
        }

        [Test]
        public static void Json_NullableEnum_NullStaysNull()
        {
            var d = SmartJson.Deserialize<SampleDoc>("{\"opt\":null}");
            Assert.False(d.Opt.HasValue);
            string s = SmartJson.Serialize(new SampleDoc { Opt = null });
            Assert.False(s.Contains("opt"), s);
        }

        [Test]
        public static void Json_TryDeserialize_GarbageReturnsFalse()
        {
            SampleDoc d;
            Assert.False(SmartJson.TryDeserialize("{not json", out d));
            Assert.False(SmartJson.TryDeserialize("", out d));
            Assert.True(SmartJson.TryDeserialize("{\"name\":\"a\"}", out d));
            Assert.Eq("a", d.Name);
        }

        /* --------------------------- DocumentKey -------------------------- */

        [Test]
        public static void DocKey_CreationGuid_WinsOverEverything()
        {
            string g = Guid.NewGuid().ToString();
            DocumentKey k = DocumentKeyBuilder.Build(new DocumentFacts
            {
                CreationGuid = g,
                IsCloud = true,
                CloudProjectGuid = Guid.NewGuid().ToString(),
                CloudModelGuid = Guid.NewGuid().ToString(),
                IsWorkshared = true,
                CentralPath = @"\\srv\central.rvt",
                PathName = @"C:\a.rvt",
                Title = "A",
            });
            Assert.Eq("doc:" + g, k.Id);
            Assert.Eq(DocumentKind.Cloud, k.Kind);
            Assert.True(k.Persistable);
            Assert.Eq("A", k.Display);
        }

        [Test]
        public static void DocKey_EmptyOrZeroGuid_IsIgnored()
        {
            DocumentKey cloud = DocumentKeyBuilder.Build(new DocumentFacts
            {
                CreationGuid = Guid.Empty.ToString(),
                IsCloud = true,
                CloudProjectGuid = "11111111-1111-1111-1111-111111111111",
                CloudModelGuid = "22222222-2222-2222-2222-222222222222",
            });
            Assert.Eq("cloud:11111111-1111-1111-1111-111111111111:22222222-2222-2222-2222-222222222222", cloud.Id);

            DocumentKey ws = DocumentKeyBuilder.Build(new DocumentFacts
            {
                CreationGuid = "not-a-guid",
                IsWorkshared = true,
                CentralPath = @"\\SRV\Proj\Central.rvt",
            });
            Assert.True(ws.Id.StartsWith("ws:"), ws.Id);
            Assert.Eq(DocumentKind.Workshared, ws.Kind);
        }

        [Test]
        public static void DocKey_Workshared_CentralPathCaseAndWhitespaceInsensitive()
        {
            DocumentKey a = DocumentKeyBuilder.Build(new DocumentFacts { IsWorkshared = true, CentralPath = @"\\SRV\P\C.rvt" });
            DocumentKey b = DocumentKeyBuilder.Build(new DocumentFacts { IsWorkshared = true, CentralPath = "  \\\\srv\\p\\c.rvt " });
            Assert.Eq(a.Id, b.Id);
        }

        [Test]
        public static void DocKey_PathFallback_MatchesExistingDocKeysNormalize()
        {
            const string path = @"\\fileserver\projects\Тенис ордон\model.rvt";
            DocumentKey k = DocumentKeyBuilder.Build(new DocumentFacts { PathName = path, Title = "model" });
            Assert.Eq(DocKeys.Normalize("path:" + path), k.Id);
            Assert.Eq(DocumentKind.Local, k.Kind);
            // Түүхий зам түлхүүрт ОРООГҮЙ.
            Assert.False(k.Id.Contains("fileserver"));
        }

        [Test]
        public static void DocKey_LegacyKey_IsProjectInfoUid_ElsePathKey()
        {
            DocumentKey a = DocumentKeyBuilder.Build(new DocumentFacts
            {
                CreationGuid = Guid.NewGuid().ToString(),
                ProjectInfoUniqueId = "abc-000123",
            });
            Assert.Eq("abc-000123", a.LegacyKey);
            // RevitTools.DocUid(): ProjectInformation байхгүй → "path:" + (PathName ?? Title ?? "unknown")
            DocumentKey b = DocumentKeyBuilder.Build(new DocumentFacts { PathName = @"C:\x.rvt" });
            Assert.Eq(DocKeys.Normalize("path:" + @"C:\x.rvt"), b.LegacyKey);
            DocumentKey c = DocumentKeyBuilder.Build(new DocumentFacts { Title = "Untitled" });
            Assert.Eq(DocKeys.Normalize("path:Untitled"), c.LegacyKey);
        }

        [Test]
        public static void DocKey_Unsaved_IsNotPersistable()
        {
            DocumentKey k = DocumentKeyBuilder.Build(new DocumentFacts { SessionId = "s1", Title = "Untitled" });
            Assert.Eq(DocumentKind.Unsaved, k.Kind);
            Assert.False(k.Persistable);
            Assert.Eq("unsaved:s1", k.Id);
        }

        [Test]
        public static void DocKey_FolderName_IsStableAndPathSafe()
        {
            DocumentKey a = DocumentKeyBuilder.Build(new DocumentFacts { CreationGuid = "3f2504e0-4f89-11d3-9a0c-0305e82c3301" });
            DocumentKey b = DocumentKeyBuilder.Build(new DocumentFacts { CreationGuid = "3F2504E0-4F89-11D3-9A0C-0305E82C3301" });
            Assert.Eq(a.FolderName, b.FolderName);
            Assert.Eq(16, a.FolderName.Length);
            Assert.True(a.FolderName.All(Uri.IsHexDigit));
            Assert.True(a.Equals(b));
        }

        [Test]
        public static void DocKey_NullFacts_Throws()
        {
            Assert.Throws<ArgumentNullException>(() => DocumentKeyBuilder.Build(null));
        }

        /* --------------------------- ElementKey --------------------------- */

        [Test]
        public static void ElementKey_Host_RoundTrips()
        {
            ElementKey k = ElementKey.Host("doc:abc", "e3c1-0001f2");
            Assert.Eq("doc:abc|e3c1-0001f2", k.ToString());
            ElementKey p;
            Assert.True(ElementKey.TryParse(k.ToString(), out p));
            Assert.True(p == k);
            Assert.False(p.IsLinked);
        }

        [Test]
        public static void ElementKey_Linked_DistinguishesInstancesOfSameLink()
        {
            ElementKey a = ElementKey.Linked("doc:host", "inst-1", "doc:link", "uid-9");
            ElementKey b = ElementKey.Linked("doc:host", "inst-2", "doc:link", "uid-9");
            Assert.False(a == b, "ижил линкийн хоёр instance ялгагдах ёстой");
            ElementKey p;
            Assert.True(ElementKey.TryParse(a.ToString(), out p));
            Assert.True(p == a);
            Assert.True(p.IsLinked);
            Assert.Eq("doc:link", p.Doc);
            Assert.Eq("doc:host", p.HostDoc);
        }

        [Test]
        public static void ElementKey_TryParse_RejectsGarbage()
        {
            ElementKey k;
            Assert.False(ElementKey.TryParse("", out k));
            Assert.False(ElementKey.TryParse("nobar", out k));
            Assert.False(ElementKey.TryParse("|uid", out k));
            Assert.False(ElementKey.TryParse("doc|", out k));
            Assert.False(ElementKey.TryParse("a>b|uid", out k));
        }

        [Test]
        public static void ElementKey_CompareTo_IsStable()
        {
            var keys = new[]
            {
                ElementKey.Host("d", "b"), ElementKey.Host("d", "a"), ElementKey.Host("c", "z"),
            };
            var sorted = keys.OrderBy(k => k).Select(k => k.ToString()).ToArray();
            Assert.SeqEq(new[] { "c|z", "d|a", "d|b" }, sorted);
        }

        /* ---------------------------- SmartHash --------------------------- */

        [Test]
        public static void Hash_Of_PartBoundariesMatter()
        {
            Assert.False(SmartHash.Of("ab", "c") == SmartHash.Of("a", "bc"));
            Assert.Eq(SmartHash.Of("a", "b"), SmartHash.Of("a", "b"));
            Assert.Eq(16, SmartHash.Of("x").Length);
            Assert.Eq(8, SmartHash.Short("x", 4).Length);
        }

        /* ---------------------------- SmartStore -------------------------- */

        private static SampleDoc Default() { return new SampleDoc { Name = "default" }; }

        [Test]
        public static void Store_Missing_ReturnsDefault()
        {
            var store = new SmartStore(TestDirs.NewTemp());
            LoadResult<SampleDoc> r = store.Load("a/b.json", 1, Default);
            Assert.Eq(LoadStatus.Missing, r.Status);
            Assert.Eq("default", r.Value.Name);
            Assert.True(r.UsedDefault);
        }

        [Test]
        public static void Store_RoundTrip_WithUnicode()
        {
            var store = new SmartStore(TestDirs.NewTemp());
            var doc = new SampleDoc { Name = "Хуудас А-101 «Анхны давхар»", Kind = SampleKind.Alpha, Numbers = { 1, 2, 3 } };
            string err;
            Assert.True(store.Save("docs/x/state.json", 3, doc, out err), err);
            LoadResult<SampleDoc> r = store.Load("docs/x/state.json", 3, Default);
            Assert.Eq(LoadStatus.Ok, r.Status);
            Assert.Eq(doc.Name, r.Value.Name);
            Assert.SeqEq(doc.Numbers, r.Value.Numbers);
            Assert.Eq(3, r.SchemaOnDisk);
        }

        [Test]
        public static void Store_Corrupt_IsQuarantined_NotThrown_NotLost()
        {
            string root = TestDirs.NewTemp();
            var store = new SmartStore(root);
            string path = store.FullPath("h.json");
            File.WriteAllText(path, "{ this is not json");
            LoadResult<SampleDoc> r = store.Load("h.json", 1, Default);
            Assert.Eq(LoadStatus.Corrupt, r.Status);
            Assert.Eq("default", r.Value.Name);
            Assert.False(File.Exists(path), "эвдэрсэн файл байрнаасаа нүүгдэх ёстой");
            Assert.True(Directory.GetFiles(root, "h.json.corrupt-*").Length == 1, "устгахгүй, нүүлгэнэ");
            // Дахин ачаалахад Missing, дараа нь шинээр хадгалж болно.
            Assert.Eq(LoadStatus.Missing, store.Load("h.json", 1, Default).Status);
            Assert.True(store.Save("h.json", 1, Default()));
        }

        [Test]
        public static void Store_NotAnEnvelope_IsQuarantined()
        {
            string root = TestDirs.NewTemp();
            var store = new SmartStore(root);
            File.WriteAllText(store.FullPath("raw.json"), "{\"name\":\"no envelope\"}");
            Assert.Eq(LoadStatus.Corrupt, store.Load("raw.json", 1, Default).Status);
        }

        [Test]
        public static void Store_NewerSchema_NotOverwritten()
        {
            string root = TestDirs.NewTemp();
            var store = new SmartStore(root);
            string path = store.FullPath("s.json");
            File.WriteAllText(path, "{\"schema\":7,\"payload\":{\"name\":\"from future\"}}");
            LoadResult<SampleDoc> r = store.Load("s.json", 2, Default);
            Assert.Eq(LoadStatus.NewerSchema, r.Status);
            Assert.Eq("default", r.Value.Name);
            string err;
            Assert.False(store.Save("s.json", 2, new SampleDoc { Name = "old addin" }, out err));
            Assert.True(err != null && err.Contains("newer"), err);
            Assert.True(File.ReadAllText(path).Contains("from future"), "ирээдүйн файл хөндөгдөөгүй");
        }

        private sealed class AddNumbersMigration : ISchemaMigration
        {
            public int FromSchema { get { return 1; } }
            public JsonObject Apply(JsonObject p)
            {
                p["numbers"] = new JsonArray(10, 20);
                return p;
            }
        }

        private sealed class RenameMigration : ISchemaMigration
        {
            public int FromSchema { get { return 2; } }
            public JsonObject Apply(JsonObject p)
            {
                p["name"] = ((string)p["name"]) + "-v3";
                return p;
            }
        }

        [Test]
        public static void Store_Migrates_StepByStep_AndKeepsBackup()
        {
            string root = TestDirs.NewTemp();
            var store = new SmartStore(root);
            string path = store.FullPath("m.json");
            File.WriteAllText(path, "{\"schema\":1,\"payload\":{\"name\":\"n\"}}");
            var migrations = new ISchemaMigration[] { new AddNumbersMigration(), new RenameMigration() };
            LoadResult<SampleDoc> r = store.Load("m.json", 3, Default, migrations);
            Assert.Eq(LoadStatus.Migrated, r.Status);
            Assert.Eq("n-v3", r.Value.Name);
            Assert.SeqEq(new[] { 10, 20 }, r.Value.Numbers);
            Assert.True(File.Exists(path + ".premigrate-v1.bak"), "шинэчлэхийн өмнөх хуулбар");
            // Нэг удаа л нөөцлөнө — дахин ачаалахад дарахгүй.
            File.WriteAllText(path + ".premigrate-v1.bak", "KEEP");
            store.Load("m.json", 3, Default, migrations);
            Assert.Eq("KEEP", File.ReadAllText(path + ".premigrate-v1.bak"));
        }

        [Test]
        public static void Store_MissingMigrationStep_QuarantinesInsteadOfGuessing()
        {
            string root = TestDirs.NewTemp();
            var store = new SmartStore(root);
            File.WriteAllText(store.FullPath("g.json"), "{\"schema\":1,\"payload\":{\"name\":\"n\"}}");
            LoadResult<SampleDoc> r = store.Load("g.json", 3, Default, new ISchemaMigration[] { new AddNumbersMigration() });
            Assert.Eq(LoadStatus.Corrupt, r.Status);
            Assert.True(r.Note.Contains("no migration from schema 2"), r.Note);
        }

        private sealed class ThrowingMigration : ISchemaMigration
        {
            public int FromSchema { get { return 1; } }
            public JsonObject Apply(JsonObject p) { throw new InvalidOperationException("boom"); }
        }

        [Test]
        public static void Store_FailingMigration_Quarantines()
        {
            string root = TestDirs.NewTemp();
            var store = new SmartStore(root);
            File.WriteAllText(store.FullPath("t.json"), "{\"schema\":1,\"payload\":{\"name\":\"n\"}}");
            LoadResult<SampleDoc> r = store.Load("t.json", 2, Default, new ISchemaMigration[] { new ThrowingMigration() });
            Assert.Eq(LoadStatus.Corrupt, r.Status);
        }

        [Test]
        public static void Store_Save_Twice_KeepsBackupOfPrevious()
        {
            string root = TestDirs.NewTemp();
            var store = new SmartStore(root);
            Assert.True(store.Save("w.json", 1, new SampleDoc { Name = "first" }));
            Assert.True(store.Save("w.json", 1, new SampleDoc { Name = "second" }));
            Assert.Eq("second", store.Load("w.json", 1, Default).Value.Name);
            string bak = store.FullPath("w.json") + ".bak";
            Assert.True(File.Exists(bak));
            Assert.True(File.ReadAllText(bak).Contains("first"));
            Assert.Eq(0, Directory.GetFiles(root, "*.tmp-*").Length, "түр файл үлдэхгүй");
        }

        [Test]
        public static void Store_PathEscape_IsRejected()
        {
            var store = new SmartStore(TestDirs.NewTemp());
            Assert.Throws<ArgumentException>(() => store.FullPath("../outside.json"));
            Assert.Throws<ArgumentException>(() => store.FullPath(""));
        }

        [Test]
        public static void Store_UnknownEnumInFile_DoesNotCorruptWholeFile()
        {
            string root = TestDirs.NewTemp();
            var store = new SmartStore(root);
            File.WriteAllText(store.FullPath("e.json"),
                "{\"schema\":1,\"payload\":{\"name\":\"keep me\",\"kind\":\"addedInV9\",\"numbers\":[5]}}");
            LoadResult<SampleDoc> r = store.Load("e.json", 1, Default);
            Assert.Eq(LoadStatus.Ok, r.Status);
            Assert.Eq("keep me", r.Value.Name);
            Assert.Eq(SampleKind.Unknown, r.Value.Kind);
        }

        [Test]
        public static void Store_ConcurrentSaves_NeverLeaveCorruptFile()
        {
            string root = TestDirs.NewTemp();
            var store = new SmartStore(root);
            var threads = new List<System.Threading.Thread>();
            for (int t = 0; t < 4; t++)
            {
                int id = t;
                var th = new System.Threading.Thread(() =>
                {
                    for (int i = 0; i < 25; i++)
                        store.Save("c.json", 1, new SampleDoc { Name = "t" + id + "-" + i, Numbers = Enumerable.Range(0, 200).ToList() });
                });
                threads.Add(th);
                th.Start();
            }
            foreach (var th in threads) th.Join();
            LoadResult<SampleDoc> r = store.Load("c.json", 1, Default);
            Assert.Eq(LoadStatus.Ok, r.Status);
            Assert.Eq(200, r.Value.Numbers.Count);
        }

        /* ----------------------------- SmartLog --------------------------- */

        [Test]
        public static void Log_Scrub_RemovesPathsAndNames()
        {
            string s = SmartLog.Scrub("Could not open C:\\Users\\bat\\Секрет төсөл\\a.rvt and \\\\srv\\share\\b.rvt for \"Хуудас А-101\"");
            Assert.False(s.Contains("Users"), s);
            Assert.False(s.Contains("srv"), s);
            Assert.False(s.Contains("А-101"), s);
            Assert.True(s.Contains("<path>"));
            Assert.True(SmartLog.Scrub(new string('x', 500)).Length <= 200);
            Assert.Eq("", SmartLog.Scrub(null));
        }

        [Test]
        public static void Log_WritesJsonLines_WithoutBlocking_AndFlushes()
        {
            string dir = TestDirs.NewTemp();
            SmartLog.Configure(dir);
            try
            {
                SmartLog.Info("test", "hello", new { count = 3 });
                SmartLog.Error("test", "failed", new InvalidOperationException("bad at C:\\secret\\x.rvt"), new { stage = "geometry" });
                Assert.True(SmartLog.Flush(3000), "flush timed out");
                string path = Path.Combine(dir, "smart.log.jsonl");
                Assert.True(File.Exists(path));
                string[] lines = File.ReadAllLines(path);
                Assert.Eq(2, lines.Length);
                Assert.True(lines[0].Contains("\"e\":\"hello\"") && lines[0].Contains("\"count\":3"), lines[0]);
                Assert.True(lines[1].Contains("InvalidOperationException"));
                Assert.False(lines[1].Contains("secret"), "зам логт орох ёсгүй");
                foreach (string l in lines) System.Text.Json.JsonDocument.Parse(l).Dispose();
            }
            finally { SmartLog.Configure(null); }
        }

        [Test]
        public static void Log_Id_IsHashedNotRaw()
        {
            string id = SmartLog.Id("e3c1b2a0-0000-0000-0000-000000000001-0001f2");
            Assert.Eq(8, id.Length);
            Assert.False(id.Contains("e3c1b2a0-"));
            Assert.Eq("", SmartLog.Id(null));
        }

        /* -------------------------- Progress / timer ---------------------- */

        [Test]
        public static void Progress_Fraction_ClampedAndIndeterminate()
        {
            Assert.Near(0.5, JobProgress.Of("s", 5, 10).Fraction.Value, 1e-9);
            Assert.Near(1.0, JobProgress.Of("s", 20, 10).Fraction.Value, 1e-9);
            Assert.False(JobProgress.Of("s", 3, 0).Fraction.HasValue);
        }

        [Test]
        public static void StageTimer_AccumulatesPerStage()
        {
            var t = new StageTimer();
            t.Begin("a");
            System.Threading.Thread.Sleep(5);
            t.Begin("b");
            t.Begin("a");
            System.Threading.Thread.Sleep(5);
            Dictionary<string, long> snap = t.Snapshot();
            Assert.True(snap.ContainsKey("a") && snap.ContainsKey("b"));
            Assert.True(snap["a"] >= 8, "a=" + snap["a"]);
        }

        [Test]
        public static void RunStatus_ZeroValueIsPending_SoUnknownFileValuesAreSafe()
        {
            var back = SmartJson.Deserialize<Dictionary<string, RunStatus>>("{\"x\":\"somethingNew\",\"y\":\"cancelled\"}");
            Assert.Eq(RunStatus.Pending, back["x"]);
            Assert.Eq(RunStatus.Cancelled, back["y"]);
        }
    }
}
