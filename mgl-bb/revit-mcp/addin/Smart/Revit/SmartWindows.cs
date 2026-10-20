using System;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Interop;
using Autodesk.Revit.DB;

namespace RevitMcpAddin.Smart
{
    /// <summary>
    /// Модальгүй (modeless) цонхны амьдралын мөчлөг: төрөл тутамд НЭГ instance, Revit-ийн
    /// эзэмшилд.  Хоёр дахь удаа дарахад шинээр нээхгүй, байгааг нь урд гаргана.
    ///
    /// ⚠️ ЯАГААД ЭЗЭН: эзэнгүй цонх Revit-ийн ард орж алга болдог (App.ShowOwned-ийн
    /// тайлбар) — `ShowInTaskbar=false` цонхыг буцааж гаргах арга үлдэхгүй.
    /// ⚠️ ЦОНХ ДОТОР Revit API ХЭЗЭЭ Ч шууд дуудахгүй — зөвхөн `SmartExecutor`-оор.
    /// ⚠️ ЦОНХ НЬ ТЭР ФАЙЛЫН СЕССТЭЙ (`documentId`): өөр файл руу шилжээд дахин дарвал хуучин файлын цонхыг ЗАСВАРЛАЖ ӨГӨХГҮЙ
    /// (бүх үйлдэл «энэ цонх өөр файлынх» гэж унана) — хааж (ажиллаж буй шалгалтыг цуцлаж), идэвхтэй файлаар шинээр нээнэ.
    /// </summary>
    internal static class SmartWindows
    {
        private sealed class Entry
        {
            public Window Window;
            public string DocumentId;
        }

        private static readonly Dictionary<Type, Entry> Open = new Dictionary<Type, Entry>();
        /// <summary>
        /// Хаагдахаас татгалзсан (`Closing` дээр `Cancel` хийсэн — «ажиллаж байна, хаах уу?» г.м.) хуучин цонхнууд.  `Open` дахь бүртгэлийг шинэ цонх
        /// дарж бичсэн ч эдгээр `CloseAll`-д (Revit хаагдах/add-in унших үед) үлдэхгүй байх ёсгүй — эс бөгөөс эзэнгүй цонх Revit-ийг саатуулна.
        /// </summary>
        private static readonly List<Window> Orphans = new List<Window>();

        /// <summary>
        /// Цонхны ТАНИЛТ = баримтын тогтвортой түлхүүр + энэ НЭЭЛТИЙН id (`ChangeStamp.Id`, баримт хаагдаад дахин нээгдэх бүрд өөр).  Түлхүүр
        /// ганцаараа хангалтгүй: A файлыг хаагаад дахин нээхэд ижил `DocumentKey` гарч, хуучин нээлтийн (хуучирсан tracker, хуучин өөрчлөлтийн тоолуур)
        /// цонхыг шинэ нээлтэд буруугаар дахин ашиглана.
        /// </summary>
        internal static string IdentityOf(Document doc)
        {
            string key = RevitDocumentKeys.Of(doc).Id;
            ChangeStamp stamp = ModelChangeCounter.HandleFor(doc);
            return stamp != null ? key + "@" + stamp.Id : key;
        }

        /// <param name="documentId">Цонх холбогдох баримтын нээлтийн танилт (`SmartWindows.IdentityOf(doc)`).</param>
        internal static T ShowModeless<T>(string documentId, Func<T> factory) where T : Window
        {
            Entry existing;
            if (Open.TryGetValue(typeof(T), out existing) && existing.Window != null && existing.Window.IsLoaded)
            {
                if (string.Equals(existing.DocumentId, documentId, StringComparison.Ordinal))
                {
                    try
                    {
                        if (existing.Window.WindowState == WindowState.Minimized) existing.Window.WindowState = WindowState.Normal;
                        existing.Window.Activate();
                        return (T)existing.Window;
                    }
                    catch (InvalidOperationException)
                    {
                        // Хаагдах дундуур — доор шинээр үүсгэнэ.
                    }
                }
                else
                {
                    // Өөр файлын (эсвэл өөр нээлтийн) цонх — хаана (цонхууд хаагдахдаа ажиллаж буй шалгалтаа цуцалдаг), идэвхтэй файлаар шинээр нээнэ.
                    Window old = existing.Window;
                    try { old.Close(); }
                    catch (InvalidOperationException) { /* аль хэдийн хаагдаж байна */ }
                    // Цонх хаагдахаас татгалзсан бол (`Closing` цуцалсан) хэвээр нээлттэй — бүртгэлээс алдахгүй, `CloseAll` хаана.
                    if (old.IsLoaded && !Orphans.Contains(old))
                    {
                        Orphans.Add(old);
                        old.Closed += (s, e) => Orphans.Remove(old);
                    }
                }
            }

            T w = factory();
            ApplyOwner(w);
            w.Closed += (s, e) =>
            {
                Entry cur;
                if (Open.TryGetValue(typeof(T), out cur) && ReferenceEquals(cur.Window, w)) Open.Remove(typeof(T));
            };
            Open[typeof(T)] = new Entry { Window = w, DocumentId = documentId };
            w.Show();
            return w;
        }

        internal static void ApplyOwner(Window w)
        {
            try
            {
                IntPtr owner = App.MainWindowHandle;
                if (owner != IntPtr.Zero)
                    new WindowInteropHelper(w).Owner = owner;
            }
            catch (Exception)
            {
                // Эзэнгүй ч нээнэ.
            }
        }

        internal static void CloseAll()
        {
            foreach (Entry e in new List<Entry>(Open.Values))
            {
                try { if (e.Window != null) e.Window.Close(); } catch (Exception) { }
            }
            foreach (Window w in new List<Window>(Orphans))
            {
                try { w.Close(); } catch (Exception) { }
            }
            Open.Clear();
            Orphans.Clear();
        }
    }
}
