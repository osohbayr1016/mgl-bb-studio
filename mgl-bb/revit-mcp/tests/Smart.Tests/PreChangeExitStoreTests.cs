using System;
using System.Collections.Generic;
using System.IO;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.Smart.Tests
{
    /// <summary>Гарцын хаалганы тохиргоо — файл тус бүрд, UniqueId-аар, локал диск дээр.</summary>
    public static class PreChangeExitStoreTests
    {
        private static DocumentKey NewKey()
        {
            return DocumentKeyBuilder.Build(new DocumentFacts { CreationGuid = Guid.NewGuid().ToString() });
        }

        private static List<ExitInfo> Exits()
        {
            return new List<ExitInfo>
            {
                new ExitInfo { Uid = "uid-1", Id = 101, Name = "Гарц А", Level = "L1" },
                new ExitInfo { Uid = "uid-2", Id = 102, Name = "Гарц Б", Level = "L2" },
            };
        }

        [Test]
        public static void ExitStore_RoundTripsOnDisk()
        {
            string root = TestDirs.NewTemp();
            SmartPaths.OverrideRoot(root);
            try
            {
                DocumentKey key = NewKey();
                Assert.True(key.Persistable);
                Assert.Eq(0, PreChangeExitStore.Load(key).Count, "файл байхгүй бол хоосон жагсаалт");
                string err;
                Assert.True(PreChangeExitStore.Save(key, Exits(), out err), err);
                Assert.True(Directory.GetFiles(root, "prechange-exits.json", SearchOption.AllDirectories).Length == 1, "диск дээр бичигдсэн");

                List<ExitInfo> back = PreChangeExitStore.Load(key);
                Assert.Eq(2, back.Count);
                Assert.Eq("uid-1", back[0].Uid);
                Assert.Eq(101L, back[0].Id);
                Assert.Eq("Гарц А", back[0].Name);
                Assert.Eq("L1", back[0].Level);
                Assert.Eq("uid-2", back[1].Uid);
            }
            finally { SmartPaths.OverrideRoot(null); }
        }

        [Test]
        public static void ExitStore_IsPerDocument_AndClearedBySavingEmptyList()
        {
            string root = TestDirs.NewTemp();
            SmartPaths.OverrideRoot(root);
            try
            {
                DocumentKey a = NewKey(), b = NewKey();
                string err;
                Assert.True(PreChangeExitStore.Save(a, Exits(), out err), err);
                Assert.Eq(0, PreChangeExitStore.Load(b).Count, "өөр файлын тохиргоо тусдаа");
                Assert.True(PreChangeExitStore.Save(a, new List<ExitInfo>(), out err), err);
                Assert.Eq(0, PreChangeExitStore.Load(a).Count);
                Assert.True(PreChangeExitStore.Save(a, null, out err), err);
                Assert.Eq(0, PreChangeExitStore.Load(a).Count, "null → хоосон");
            }
            finally { SmartPaths.OverrideRoot(null); }
        }

        [Test]
        public static void ExitStore_OverwritesPreviousExits()
        {
            string root = TestDirs.NewTemp();
            SmartPaths.OverrideRoot(root);
            try
            {
                DocumentKey key = NewKey();
                string err;
                Assert.True(PreChangeExitStore.Save(key, Exits(), out err), err);
                Assert.True(PreChangeExitStore.Save(key, new List<ExitInfo> { new ExitInfo { Uid = "only", Id = 5, Name = "Ганц" } }, out err), err);
                List<ExitInfo> back = PreChangeExitStore.Load(key);
                Assert.Eq(1, back.Count);
                Assert.Eq("only", back[0].Uid);
            }
            finally { SmartPaths.OverrideRoot(null); }
        }

        [Test]
        public static void ExitStore_UnsavedDocument_RoundTripsInMemory_NeverTouchesDisk()
        {
            string root = TestDirs.NewTemp();
            SmartPaths.OverrideRoot(root);
            try
            {
                DocumentKey k = DocumentKeyBuilder.Build(new DocumentFacts { Title = "t", SessionId = Guid.NewGuid().ToString("N") });
                Assert.False(k.Persistable);
                string err;
                Assert.True(PreChangeExitStore.Save(k, Exits(), out err), err);
                Assert.Eq(2, PreChangeExitStore.Load(k).Count);
                Assert.Eq(0, Directory.GetFiles(root, "*", SearchOption.AllDirectories).Length, "хадгалаагүй баримт диск рүү бичигдэхгүй");
            }
            finally { SmartPaths.OverrideRoot(null); }
        }

        [Test]
        public static void ExitStore_Constants()
        {
            Assert.Eq(1, PreChangeExitStore.Schema);
            Assert.Eq(12, PreChangeExitStore.MaxExits);
        }
    }
}
