using System;
using System.IO;
using RevitMcpAddin.Smart.Core;
using RevitMcpAddin.SmartPublish.Core;

namespace RevitMcpAddin.Smart.Tests
{
    /// <summary>
    /// Түгжигдсэн/уншигдахгүй файл ХЭЗЭЭ Ч «хоосон» гэж уншигдаж, дараа нь хадгалагдан бодит түүхийг устгах ёсгүй
    /// (Clash/Impact/Publish-ийн хараат бус хяналтаас гурван удаа гарсан ЭРСДЭЛ).
    /// </summary>
    public static class StoreSafetyTests
    {
        private static SampleDoc Default() { return new SampleDoc { Name = "default" }; }

        /// <summary>Файлыг ЭКСКЛЮЗИВ нээж барьдаг (антивирус/нөөцлөлтийн түгжээг дууриана).</summary>
        private static FileStream Lock(string path)
        {
            return new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
        }

        [Test]
        public static void LockedFile_Load_IsUnreadable_NotCorrupt_AndFileUntouched()
        {
            string root = TestDirs.NewTemp();
            var store = new SmartStore(root);
            var real = new SampleDoc { Name = "МИНИЙ ТҮҮХ", Numbers = { 1, 2, 3 } };
            Assert.True(store.Save("history.json", 1, real));
            string path = store.FullPath("history.json");
            string before = File.ReadAllText(path);

            using (Lock(path))
            {
                LoadResult<SampleDoc> r = store.Load("history.json", 1, Default);
                Assert.Eq(LoadStatus.Unreadable, r.Status, "түгжигдсэн = Unreadable (Corrupt БИШ)");
                Assert.True(r.UsedDefault);
                Assert.Eq("default", r.Value.Name);
                Assert.True(r.Note.StartsWith("unreadable"));
                Assert.True(store.IsMarkedUnreadable("history.json"));
            }
            Assert.Eq(0, Directory.GetFiles(root, "history.json.corrupt-*").Length, "quarantine хийгдээгүй");
            Assert.Eq(before, File.ReadAllText(path), "эх файл ХӨНДӨГДӨӨГҮЙ");
        }

        [Test]
        public static void AfterUnreadableLoad_Save_IsRefused_UntilARealLoadSucceeds()
        {
            string root = TestDirs.NewTemp();
            var store = new SmartStore(root);
            Assert.True(store.Save("history.json", 1, new SampleDoc { Name = "бодит" }));
            string path = store.FullPath("history.json");

            using (Lock(path)) store.Load("history.json", 1, Default);

            // Түгжээ суллагдсан ч дуудагчийн барьж буй утга анхдагчаас гарсан → дарж бичих ХОРИГТОЙ.
            string err;
            Assert.False(store.Save("history.json", 1, Default(), out err), "анхдагч утгаар бодит файлыг дарахыг хориглоно");
            Assert.True(err != null && err.Contains("unreadable"), err);
            Assert.Eq("бодит", SmartJson.Deserialize<SampleDoc>(
                System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(path))["payload"].ToJsonString()).Name, "диск дээрх бодит өгөгдөл хэвээр");

            // Амжилттай Load → дуудагч бодит утгаас эхэлнэ → Save зөвшөөрөгдөнө.
            LoadResult<SampleDoc> again = store.Load("history.json", 1, Default);
            Assert.Eq(LoadStatus.Ok, again.Status);
            Assert.Eq("бодит", again.Value.Name);
            Assert.False(store.IsMarkedUnreadable("history.json"));
            again.Value.Name = "шинэчлэгдсэн";
            Assert.True(store.Save("history.json", 1, again.Value, out err), err);
        }

        [Test]
        public static void Save_OnLockedFile_NeverLoaded_IsRefused_NotOverwritten()
        {
            string root = TestDirs.NewTemp();
            var store = new SmartStore(root);
            Assert.True(store.Save("state.json", 1, new SampleDoc { Name = "A" }));
            string path = store.FullPath("state.json");
            string before = File.ReadAllText(path);
            using (Lock(path))
            {
                string err;
                Assert.False(store.Save("state.json", 1, new SampleDoc { Name = "B" }, out err), "толгойг шалгаж чадахгүй → дарахгүй");
                Assert.True(err != null);
            }
            Assert.Eq(before, File.ReadAllText(path));
            // Түгжээ суллагдсаны дараа ердийн хадгалалт ажиллана.
            Assert.True(store.Save("state.json", 1, new SampleDoc { Name = "B" }));
        }

        [Test]
        public static void MissingFile_AfterUnreadable_ClearsFlag()
        {
            string root = TestDirs.NewTemp();
            var store = new SmartStore(root);
            Assert.True(store.Save("x.json", 1, Default()));
            string path = store.FullPath("x.json");
            using (Lock(path)) store.Load("x.json", 1, Default);
            Assert.True(store.IsMarkedUnreadable("x.json"));
            File.Delete(path);                                   // хэрэглэгч файлыг устгав
            Assert.Eq(LoadStatus.Missing, store.Load("x.json", 1, Default).Status);
            Assert.False(store.IsMarkedUnreadable("x.json"));
            Assert.True(store.Save("x.json", 1, Default()));
        }

        [Test]
        public static void PublishProfiles_LockedFile_DoesNotReseedStartersOverUserProfiles()
        {
            string root = TestDirs.NewTemp();
            var store = new SmartStore(root);
            // Хэрэглэгчийн өөрийн профайл.
            PublishProfilesFile mine = PublishProfileStore.Load(store);
            mine.Profiles.Clear();
            mine.Profiles.Add(new PublishProfile { Name = "МИНИЙ ПРОФАЙЛ" });
            mine.StartersSeeded = true;
            Assert.True(PublishProfileStore.Save(mine, store));
            string path = store.FullPath(PublishProfileStore.FileName);
            string before = File.ReadAllText(path);

            using (Lock(path))
            {
                PublishProfilesFile locked = PublishProfileStore.Load(store);
                Assert.True(locked.Profiles.Count > 0, "UI-д жишээ профайл (зөвхөн санах ойд)");
            }
            Assert.Eq(before, File.ReadAllText(path), "хэрэглэгчийн профайлын файл ДАРАГДААГҮЙ");

            // Түгжээ суларсны дараа бодит профайлууд буцаж ирнэ.
            PublishProfilesFile back = PublishProfileStore.Load(store);
            Assert.Eq(1, back.Profiles.Count);
            Assert.Eq("МИНИЙ ПРОФАЙЛ", back.Profiles[0].Name);
        }

        [Test]
        public static void DocStore_InMemoryKey_IsThreadSafe_AndRoundTrips()
        {
            var ds = new DocStore<SampleDoc>("m.json", 1, Default);
            DocumentKey k = DocumentKeyBuilder.Build(new DocumentFacts { Title = "t", SessionId = Guid.NewGuid().ToString("N") });
            Assert.False(k.Persistable, "хадгалаагүй баримт диск рүү бичигдэхгүй");
            Assert.Eq(LoadStatus.Missing, ds.Load(k).Status);
            var threads = new System.Threading.Thread[4];
            for (int t = 0; t < threads.Length; t++)
            {
                int n = t;
                threads[t] = new System.Threading.Thread(() =>
                {
                    for (int i = 0; i < 200; i++) ds.Save(k, new SampleDoc { Name = "v" + n + "-" + i });
                });
                threads[t].Start();
            }
            foreach (var th in threads) th.Join();
            Assert.Eq(LoadStatus.Ok, ds.Load(k).Status);
        }

        /* ------------- 2-р хяналт: `File.Exists` ≠ «файл байхгүй» ------------- */

        [Test]
        public static void Load_MissingFile_ReturnsMissing_WithoutRetrySleeps()
        {
            var store = new SmartStore(TestDirs.NewTemp());
            var sw = System.Diagnostics.Stopwatch.StartNew();
            LoadResult<SampleDoc> r = store.Load("nope.json", 1, Default);
            sw.Stop();
            Assert.Eq(LoadStatus.Missing, r.Status);
            Assert.False(store.IsMarkedUnreadable("nope.json"));
            Assert.True(sw.ElapsedMilliseconds < 200, "«олдсонгүй» нь түр түгжээ БИШ — дахин оролдож (3 × 40-120 мс) хугацаа үрэх ёсгүй: " + sw.ElapsedMilliseconds + " мс");
        }

        [Test]
        public static void Load_MissingDirectory_ReturnsMissing_AndFirstSaveCreatesIt()
        {
            string root = Path.Combine(TestDirs.NewTemp(), "a", "b");     // хавтас ч байхгүй
            var store = new SmartStore(root);
            Assert.Eq(LoadStatus.Missing, store.Load("deep\\x.json", 1, Default).Status);
            Assert.True(store.Save("deep\\x.json", 1, Default()));
            Assert.Eq(LoadStatus.Ok, store.Load("deep\\x.json", 1, Default).Status);
        }

        [Test]
        public static void Load_PathThatIsADirectory_IsUnreadable_NotMissing()
        {
            // Нээгдэхгүй боловч «олдсонгүй» БИШ байгаа зам (энд: файлын оронд хавтас) — `File.Exists` false буцааж «Missing» гэж худал хэлдэг тохиолдол.
            string root = TestDirs.NewTemp();
            Directory.CreateDirectory(Path.Combine(root, "x.json"));
            var store = new SmartStore(root);
            LoadResult<SampleDoc> r = store.Load("x.json", 1, Default);
            Assert.Eq(LoadStatus.Unreadable, r.Status, "эрх/төрлийн алдаа = Unreadable");
            Assert.True(store.IsMarkedUnreadable("x.json"));
            string err;
            Assert.False(store.Save("x.json", 1, Default(), out err), "уншигдаагүй зам дээр бичихгүй");
        }

        [Test]
        [WindowsOnly("Windows mandatory file locking (FileShare): on Unix a held read stream does not block File.Move")]
        public static void Quarantine_WhenTheMoveFails_MarksTheFileUnreadable_SoTheOnlyCopyIsNotOverwritten()
        {
            string root = TestDirs.NewTemp();
            var store = new SmartStore(root);
            string path = store.FullPath("bad.json");
            File.WriteAllText(path, "{ not json at all");                    // эвдэрсэн
            // Өөр процесс (антивирус) файлыг УНШИХААР барьсан, гэхдээ устгах/нэр солихыг ЗӨВШӨӨРӨӨГҮЙ (FileShare.Delete байхгүй) → бидний унших нь
            // амжилттай, харин `File.Move` (quarantine) бүтэлгүйтнэ.
            using (var held = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                LoadResult<SampleDoc> r = store.Load("bad.json", 1, Default);
                Assert.Eq(LoadStatus.Corrupt, r.Status);
                Assert.Eq(0, Directory.GetFiles(root, "bad.json.corrupt-*").Length, "нүүлгэж чадаагүй");
                Assert.True(store.IsMarkedUnreadable("bad.json"), "нүүлгэж чадаагүй эвдэрсэн файл = гараар сэргээж болох цорын ганц хуулбар");
                string err;
                Assert.False(store.Save("bad.json", 1, Default(), out err), "хоосон анхдагчаар дарж бичихийг хориглоно");
            }
            Assert.Eq("{ not json at all", File.ReadAllText(path), "файл хэвээр");

            // Түгжээ суларсны дараа дахин ачаалбал нүүлгэж чадна → тэмдэг арилж, бичих боломжтой болно.
            LoadResult<SampleDoc> again = store.Load("bad.json", 1, Default);
            Assert.Eq(LoadStatus.Corrupt, again.Status);
            Assert.Eq(1, Directory.GetFiles(root, "bad.json.corrupt-*").Length, "одоо quarantine хийгдсэн");
            Assert.True(store.Save("bad.json", 1, Default()), "хуулбар аюулгүй хадгалагдсан тул бичиж болно");
        }

        [Test]
        public static void Load_NeverThrows_OnAnyMalformedEnvelope()
        {
            string root = TestDirs.NewTemp();
            var store = new SmartStore(root);
            string[] bad =
            {
                "",                                                  // хоосон
                "null",                                              // JSON null
                "[1,2,3]",                                           // массив
                "{\"schema\":1,\"payload\":42}",                     // payload объект биш
                "{\"schema\":\"x\",\"payload\":{}}",                 // schema тоо биш
                "{\"schema\":1,\"payload\":{\"name\":{\"nested\":1},\"numbers\":\"not-a-list\"}}",   // төрөл таарахгүй
                new string('[', 5000),                               // хэт гүн үүрлэлт
                "{\"schema\":1,\"schema\":2,\"payload\":{}}",        // давхардсан түлхүүр
                "\u0000\u0001garbage",
            };
            for (int i = 0; i < bad.Length; i++)
            {
                string rel = "m" + i + ".json";
                File.WriteAllText(store.FullPath(rel), bad[i]);
                LoadResult<SampleDoc> r = null;
                try { r = store.Load(rel, 1, Default); }
                catch (Exception ex) { throw new AssertFailed("Load шидлээ [" + i + "]: " + ex.GetType().Name + " " + ex.Message); }
                Assert.True(r.Value != null, "анхдагч утга буцаах ёстой [" + i + "]");
                // Давхардсан түлхүүрийг ажиллах орчин (runtime) өөр өөрөөр хэлж болно (алдаа / сүүлийнх нь) — гол нь ШИДЭХГҮЙ, `Unreadable` БИШ.
                Assert.True(r.Status == LoadStatus.Corrupt || r.Status == LoadStatus.Ok || r.Status == LoadStatus.NewerSchema, "[" + i + "] " + r.Status);
            }
        }

        [Test]
        public static void Save_AfterTransientAbsence_DoesNotOverwriteANewerSchemaFile()
        {
            // `PeekSchema` нь `File.Exists`-аас биш, нээж үзэхээс шийднэ: шинэ add-in-ийн файлыг (schema 9) хуучин add-in дарахгүй.
            string root = TestDirs.NewTemp();
            var store = new SmartStore(root);
            File.WriteAllText(store.FullPath("n.json"), "{\"schema\":9,\"savedUtc\":\"x\",\"payload\":{\"name\":\"future\"}}");
            string err;
            Assert.False(store.Save("n.json", 1, Default(), out err));
            Assert.True(err != null && err.Contains("newer"), err);
            Assert.True(File.ReadAllText(store.FullPath("n.json")).Contains("future"));
        }

        [Test]
        public static void Settings_Save_CachesOnlyAfterASuccessfulWrite_AndFlagsUnreadableLoads()
        {
            // `store` өгсөн үед кэш ашиглагдахгүй — `Unreadable` тэмдэг ба Save-ийн үр дүнг шалгана.
            string root = TestDirs.NewTemp();
            var store = new SmartStore(root);
            Assert.True(SmartSettings.Save(new SmartSettingsFile { ImpactTracking = false, TrackingGapThroughSeq = 77 }, store));
            string path = store.FullPath(SmartSettings.FileName);

            using (Lock(path))
            {
                SmartSettingsFile locked = SmartSettings.Load(store);
                Assert.True(locked.Unreadable, "түгжигдсэн тохиргоо = анхдагч, ТЭР нь бодит биш гэдгийг тэмдэглэнэ");
                Assert.True(locked.ImpactTracking, "анхдагч утга");
                Assert.False(SmartSettings.Save(new SmartSettingsFile { ImpactTracking = true }, store), "уншигдаагүй файлыг дарахгүй");
            }
            SmartSettingsFile real = SmartSettings.Load(store);
            Assert.False(real.Unreadable);
            Assert.False(real.ImpactTracking, "диск дэх бодит тохиргоо хэвээр");
            Assert.Eq(77L, real.TrackingGapThroughSeq);
        }
    }
}
