using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    /// <summary>
    /// 2026-10-14 (интерьерийн баг: «хуудсыг ажлын зургийн бүрдлийн аль бүлэг, хэсэгт байрлуулахыг сонгодог болго»): Project Browser-ийн
    /// бүлэглэлтээс сонголт, анхны утга, тохиргоо гаргах цэвэр дүрэм.
    /// </summary>
    public static class SheetFolderTests
    {
        private static WeSheetFolders Sample(bool subSettable = true)
        {
            var f = new WeSheetFolders { Organization = "Бүлэг / Хэсэг" };
            f.Levels.Add(new WeFolderLevel { Key = "9001", Name = "Бүлэг", Settable = true });
            f.Levels.Add(new WeFolderLevel { Key = "9002", Name = "Хэсэг", Settable = subSettable, Why = subSettable ? null : "дугаараас" });
            f.AddPath(new[] { "3. АРХИТЕКТУР", "3.1. План" });
            f.AddPath(new[] { "4. ИНТЕРЬЕР", "4.10. Тааз" });
            f.AddPath(new[] { "4. ИНТЕРЬЕР", "4.2. Дотор дэлгээс" });
            f.AddPath(new[] { "4. ИНТЕРЬЕР", "4.2. Дотор дэлгээс" });
            f.AddPath(new[] { "4. ИНТЕРЬЕР", "???" });
            f.AddPath(new[] { "10. ЦАХИЛГААН", "10.1. Гэрэлтүүлэг" });
            f.Default = new List<string> { "4. ИНТЕРЬЕР", "4.2. Дотор дэлгээс" };
            return f;
        }

        [Test]
        public static void Top_level_lists_every_group_in_natural_order()
        {
            WeSheetFolders f = Sample();
            Assert.SeqEq(new[] { "3. АРХИТЕКТУР", "4. ИНТЕРЬЕР", "10. ЦАХИЛГААН" }, f.OptionsFor(0, null));
        }

        [Test]
        public static void Section_list_follows_the_chosen_group()
        {
            WeSheetFolders f = Sample();
            // «???» (хоосон) сонголт биш; «4.2» < «4.10» тоогоор.
            Assert.SeqEq(new[] { "4.2. Дотор дэлгээс", "4.10. Тааз" }, f.OptionsFor(1, new[] { "4. ИНТЕРЬЕР", "" }));
            Assert.SeqEq(new[] { "3.1. План" }, f.OptionsFor(1, new[] { "3. архитектур", "" }), "том жижиг үсэг ялгахгүй");
            Assert.Eq(0, f.OptionsFor(1, new[] { "5. ШИНЭ БҮЛЭГ", "" }).Count, "шинэ бүлэгт хэсэг алга — хэрэглэгч бичнэ");
        }

        [Test]
        public static void Unsettable_upper_level_does_not_filter()
        {
            var f = new WeSheetFolders();
            f.Levels.Add(new WeFolderLevel { Key = "-1007400", Name = "Sheet Number", Settable = false, Why = "дугаараас" });
            f.Levels.Add(new WeFolderLevel { Key = "9002", Name = "Хэсэг", Settable = true });
            f.AddPath(new[] { "А", "А.1" });
            f.AddPath(new[] { "Б", "Б.1" });
            Assert.SeqEq(new[] { "А.1", "Б.1" }, f.OptionsFor(1, new[] { "", "" }));
            Assert.Eq("Sheets › ‹Sheet Number› › Б.1", f.Describe(new[] { "", "Б.1" }));
            Assert.SeqEq(new[] { "9002" }, f.ToSettings(new[] { "", "Б.1" }).Keys.ToList(), "бичигдэхгүй түвшин тохиргоонд орохгүй");
        }

        [Test]
        public static void Settings_carry_values_and_only_the_levels_the_user_changed()
        {
            WeSheetFolders f = Sample();
            var chosen = new List<string> { "4. ИНТЕРЬЕР", "4.10. Тааз" };
            Dictionary<string, string> d = f.ToSettings(chosen);
            Assert.Eq("4. ИНТЕРЬЕР", d["9001"]);
            Assert.Eq("4.10. Тааз", d["9002"]);
            Assert.SeqEq(new[] { "9002" }, f.Changed(chosen).ToList(), "бүлэг хөндөгдөөгүй — зөвхөн хэсэг шилжинэ");
            Assert.Eq(0, f.Changed(f.Default).Count, "өөрчлөөгүй бол өмнөх хуудсыг хөндөхгүй");
            Assert.Eq("Sheets › 4. ИНТЕРЬЕР › ???", f.Describe(new[] { "4. ИНТЕРЬЕР", " " }));
            Assert.Eq("", f.ToSettings(new[] { "4. ИНТЕРЬЕР", "???" })["9002"], "«???» = хоосон");
        }

        [Test]
        public static void Sheet_collection_is_an_optional_top_level()
        {
            // Revit 2025+: бүрдэл (Sheet Collection) — хоосон нь «???» биш, Sheets-ийн шууд доор; хуудасгүй бүрдэл ч сонгогдоно.
            var f = new WeSheetFolders();
            var c = new WeFolderLevel { Key = WeSheetFolders.CollectionKey, Name = "Бүрдэл", Settable = true, IsCollection = true };
            c.Known.Add("Интерьер зураг");
            c.Known.Add("Ажлын зураг");
            f.Levels.Add(c);
            f.Levels.Add(new WeFolderLevel { Key = "9001", Name = "Бүлэг", Settable = true });
            f.AddPath(new[] { "Ажлын зураг", "3. АРХИТЕКТУР" });
            f.AddPath(new[] { "", "0. ЕРӨНХИЙ" });
            Assert.SeqEq(new[] { "Ажлын зураг", "Интерьер зураг" }, f.OptionsFor(0, null));
            Assert.Eq(0, f.OptionsFor(1, new[] { "Интерьер зураг", "" }).Count, "шинэ бүрдэлд бүлэг алга");
            Assert.SeqEq(new[] { "0. ЕРӨНХИЙ" }, f.OptionsFor(1, new[] { "", "" }));
            Assert.Eq("Sheets › 0. ЕРӨНХИЙ", f.Describe(new[] { "", "0. ЕРӨНХИЙ" }));
            Assert.Eq("Sheets › Интерьер зураг › ???", f.Describe(new[] { "Интерьер зураг", "" }));
            Assert.Eq("Интерьер зураг", f.ToSettings(new[] { "Интерьер зураг", "" })[WeSheetFolders.CollectionKey]);
        }

        [Test]
        public static void Default_is_the_most_common_office_path()
        {
            List<string> p = WeSheetFolders.CommonPath(new IList<string>[]
            {
                new[] { "4. ИНТЕРЬЕР", "4.2. Дотор дэлгээс" },
                new[] { "4. ИНТЕРЬЕР", "4.3. Нүүр тал" },
                new[] { "4. ИНТЕРЬЕР", "4.2. Дотор дэлгээс" },
            });
            Assert.SeqEq(new[] { "4. ИНТЕРЬЕР", "4.2. Дотор дэлгээс" }, p);
            Assert.Null(WeSheetFolders.CommonPath(new IList<string>[0]));
        }

        [Test]
        public static void Folder_named_by_a_prefix_of_the_value_is_not_settable()
        {
            Assert.True(WeSheetFolders.ValueDrivesFolder(new[]
            {
                new KeyValuePair<string, string>("4. ИНТЕРЬЕР", "4. ИНТЕРЬЕР"),
                new KeyValuePair<string, string>("???", null),
            }));
            // «Эхний 2 тэмдэгтээр» бүлэглэсэн: нэр «БА», утга «БА413» — утгыг бичвэл өөр бүлэгт орно.
            Assert.False(WeSheetFolders.ValueDrivesFolder(new[] { new KeyValuePair<string, string>("БА", "БА413") }));
        }

        [Test]
        public static void Folder_choice_is_not_saved_to_the_settings_file_but_survives_clone()
        {
            var s = new WeSettings();
            s.SheetFolders["9001"] = "4. ИНТЕРЬЕР";
            s.SheetFoldersMove.Add("9001");
            WeSettings c = s.Clone();
            c.SheetFolders["9001"] = "5. ӨӨР";
            Assert.Eq("4. ИНТЕРЬЕР", s.SheetFolders["9001"], "clone нь гүн хуулбар");
            Assert.True(c.SheetFoldersMove.Contains("9001"));
            Assert.False(s.Serialize().Contains("ИНТЕРЬЕР"), "төсөл бүр өөр бүлэгтэй — файлд хадгалахгүй");
            Assert.Eq(0, WeSettings.Deserialize(s.Serialize()).SheetFolders.Count);
        }
    }
}
