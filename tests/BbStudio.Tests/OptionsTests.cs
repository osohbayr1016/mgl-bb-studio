using System;
using System.IO;
using MglBb.Core;

namespace MglBb.Tests
{
    public static class OptionsTests
    {
        private static BbStandard Learned()
        {
            var std = new BbStandard();
            std.Beam.BarTagType = "Rebar Tag : 2.5";
            std.Beam.StirrupTagType = "Rebar Tag : Хомут";
            std.Beam.MraType = "Хомут MRA";
            std.Column.BarTagType = "Rebar Tag : 2.5";
            std.Plate.WallMraType = "(Поз)⌀Диаметр-Алхам";
            return std;
        }

        [Test]
        public static void BaseOptionKeepsLearnedValues()
        {
            var book = new BbOptionBook();
            BbStandard std = book.Apply(Learned(), "C:\\a.rvt", out string name);
            Assert.Eq(BbOptionBook.BaseName, name);
            Assert.Eq("Rebar Tag : 2.5", std.Beam.BarTagType);
            Assert.Eq("Хомут MRA", std.Beam.MraType);
        }

        [Test]
        public static void NewOptionStartsAsCopyAndOverridesOnlyTags()
        {
            BbStandard learned = Learned();
            var book = new BbOptionBook();
            BbOption o = book.Add(BbOption.FromStandard("Төсөл Б", learned));
            Assert.Eq("Хомут MRA", o.Beam.MraType);
            o.Beam.MraType = "Хомут MRA 3.5";
            o.Column.StirrupTagType = "Rebar Tag : Хомут 3.5";
            o.SlabMraType = "";                     // хоосон = сурсан утга
            book.SetActive("C:\\b.rvt", "Төсөл Б");

            BbStandard std = book.Apply(Learned(), "C:\\b.rvt", out string name);
            Assert.Eq("Төсөл Б", name);
            Assert.Eq("Хомут MRA 3.5", std.Beam.MraType);
            Assert.Eq("Rebar Tag : Хомут 3.5", std.Column.StirrupTagType);
            Assert.Eq(new BbPlateStandard().SlabMraType, std.Plate.SlabMraType);
            Assert.Eq(50, std.Beam.ElevScale);      // тагаас бусад утга хөндөгдөхгүй
            // Өөр төсөл — «Үндсэн».
            Assert.Eq("Хомут MRA", book.Apply(Learned(), "C:\\a.rvt", out name).Beam.MraType);
            Assert.Eq(BbOptionBook.BaseName, name);
        }

        [Test]
        public static void NamesAreValidated()
        {
            var book = new BbOptionBook();
            book.Add(new BbOption { Name = "А" });
            Assert.True(book.NameProblem("") != null);
            Assert.True(book.NameProblem(BbOptionBook.BaseName) != null);
            Assert.True(book.NameProblem(" а ") != null);
            Assert.Eq(null, book.NameProblem("Б"));
            bool threw = false;
            try { book.Add(new BbOption { Name = "а" }); } catch (ArgumentException) { threw = true; }
            Assert.True(threw);
        }

        [Test]
        public static void RemovingActiveOptionFallsBackToBase()
        {
            var book = new BbOptionBook();
            book.Add(new BbOption { Name = "А" });
            book.SetActive("p1", "А");
            Assert.Eq("А", book.ActiveFor("p1"));
            Assert.True(book.Remove("А"));
            Assert.Eq(BbOptionBook.BaseName, book.ActiveFor("p1"));
            Assert.False(book.Remove(BbOptionBook.BaseName));
        }

        [Test]
        public static void SaveLoadRoundTrip()
        {
            string dir = Path.Combine(Path.GetTempPath(), "bbopt-" + Guid.NewGuid().ToString("N"));
            string path = Path.Combine(dir, "options.json");
            try
            {
                var book = new BbOptionBook();
                BbOption o = book.Add(BbOption.FromStandard("Төсөл Б", Learned()));
                o.BeamAux.BarTagType = "Rebar Tag : Туслах";
                book.SetActive("C:\\b.rvt", "Төсөл Б");
                book.Save(path);
                book.Save(path);                    // байгаа файлыг солино

                BbOptionBook back = BbOptionBook.Load(path);
                Assert.Eq(1, back.Options.Count);
                Assert.Eq("Rebar Tag : Туслах", back.Find("төсөл б").BeamAux.BarTagType);
                Assert.Eq("(Поз)⌀Диаметр-Алхам", back.Find("Төсөл Б").WallMraType);
                Assert.Eq("Төсөл Б", back.ActiveFor("c:\\B.rvt"));
                Assert.Eq(0, BbOptionBook.Load(Path.Combine(dir, "none.json")).Options.Count);
            }
            finally { try { Directory.Delete(dir, true); } catch { } }
        }
    }
}
