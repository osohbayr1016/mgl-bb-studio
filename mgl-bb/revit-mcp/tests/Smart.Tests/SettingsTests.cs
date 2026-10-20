using System;
using System.IO;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.Smart.Tests
{
    public static class SettingsTests
    {
        [Test]
        public static void Settings_DefaultsToTrackingOn_WhenFileMissing()
        {
            var store = new SmartStore(TestDirs.NewTemp());
            SmartSettingsFile f = SmartSettings.Load(store);
            Assert.True(f.ImpactTracking, "бүртгэл өгөгдмөлөөр асаалттай");
        }

        [Test]
        public static void Settings_Persist_AndReload()
        {
            var store = new SmartStore(TestDirs.NewTemp());
            Assert.True(SmartSettings.Save(new SmartSettingsFile { ImpactTracking = false }, store));
            SmartSettingsFile back = SmartSettings.Load(store);
            Assert.False(back.ImpactTracking, "унтраасан тохиргоо хадгалагдсан");
        }

        [Test]
        public static void Settings_CorruptFile_FallsBackToDefaults_AndKeepsQuarantine()
        {
            string root = TestDirs.NewTemp();
            Directory.CreateDirectory(root);
            File.WriteAllText(Path.Combine(root, SmartSettings.FileName), "{ this is not json");
            var store = new SmartStore(root);
            SmartSettingsFile f = SmartSettings.Load(store);          // ШИДЭХГҮЙ
            Assert.True(f.ImpactTracking, "эвдэрсэн файлд анхдагч утга");
            string[] quarantined = Directory.GetFiles(root, "*.corrupt-*");
            Assert.True(quarantined.Length >= 1, "эвдэрсэн файл quarantine-д хадгалагдсан (устгагдаагүй)");
        }

        [Test]
        public static void Settings_NewerSchemaFile_IsNotOverwritten()
        {
            string root = TestDirs.NewTemp();
            Directory.CreateDirectory(root);
            string path = Path.Combine(root, SmartSettings.FileName);
            File.WriteAllText(path, "{\"schema\":" + (SmartSettings.Schema + 5) + ",\"payload\":{\"impactTracking\":false}}");
            var store = new SmartStore(root);
            SmartSettingsFile f = SmartSettings.Load(store);
            Assert.True(f != null);
            bool saved = SmartSettings.Save(new SmartSettingsFile { ImpactTracking = true }, store);
            Assert.False(saved, "шинэ хувилбарын файлыг хуучин add-in ДАРЖ бичихгүй");
            Assert.True(File.ReadAllText(path).Contains("\"schema\":" + (SmartSettings.Schema + 5)), "эх файл хэвээр");
        }
    }
}
