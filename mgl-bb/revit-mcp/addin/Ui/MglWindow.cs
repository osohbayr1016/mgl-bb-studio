using System;
using System.Runtime.CompilerServices;
using System.Windows;
using RevitMcpAddin.Ui.Core;

namespace RevitMcpAddin.Ui
{
    /// <summary>
    /// MGL цонхны хэмжээ, байрлалыг ЭЗЭН (Revit)-ийн ДЭЛГЭЦИЙН ажлын талбарт тохируулна.
    ///
    /// Өмнөх `RfUi.Setup` нь ЗӨВХӨН үндсэн дэлгэцийн `SystemParameters.WorkArea`-г хэрэглэж, `Left/Top`-г
    /// хязгаарладаггүй, `App.ShowOwned` дараа нь эзэн дээр дахин төвлөрүүлдэг байв.  Одоо:
    ///   • хэмжээ, ДООД хэмжээ ЭЗЭН дэлгэцийн ажлын талбараас ХЭЗЭЭ Ч том биш (WPF MinWidth-ийг албадна);
    ///   • дэлгэц салгаж хадгалсан хил нь дахин ашиглагдахгүй (`WindowFit` тестлэгдсэн);
    ///   • цонх эзний дэлгэц дээр, эзэн дээр төвлөрнө;
    ///   • `App.ShowOwned` нь `IsManaged` цонхны байрлалыг ДАРАХГҮЙ.
    /// Хадгалалт: ЗӨВХӨН UI сонголт (`ui-prefs.json`) — RVT-д бичихгүй.
    ///
    /// ⚠️ Мэдэгдэж буй хязгаар: цонхыг нээсний ДАРАА өөр DPI-тэй дэлгэц рүү чирэхэд дахин тохируулахгүй.
    /// ⚠️ Revit-ийн процессын DPI-awareness-ийг энэ repo-оос тогтоох боломжгүй — `MglNative` хоёр хувилбарыг
    /// (system / per-monitor) хоёуланг нь боддог; амьд Revit дээр 100/125/150/200 %-аар шалгах ёстой (docs §11).
    /// </summary>
    internal static class MglWindow
    {
        private static readonly ConditionalWeakTable<Window, object> Managed = new ConditionalWeakTable<Window, object>();

        /// <summary>Энэ цонхны хэмжээ/байрлалыг MglWindow зохицуулсан эсэх (App.ShowOwned шалгана).</summary>
        internal static bool IsManaged(Window w)
        {
            object o;
            return w != null && Managed.TryGetValue(w, out o);
        }

        /// <summary>
        /// Хэмжээ, байрлалыг тооцож тавина.  <paramref name="prefsKey"/> өгвөл хаахад хил хадгалагдаж, дараагийн
        /// удаа сэргээгдэнэ.  <paramref name="sizeToContentHeight"/> бол өндрийг агуулгаар (өргөнийг л хязгаарлана).
        /// </summary>
        /// <summary>
        /// Revit-ийн үндсэн цонхны HWND-ийг буцаах функц — `App.OnStartup` тавина.  `App`-д ШУУД хамаарахгүй: энэ файл Revit-гүй
        /// smoke төслүүдэд (SheetNumerator.UiSmoke, Smart.UiSmoke) ч эмхэтгэгдэх ёстой.  Тавигдаагүй бол эзэнгүй (үндсэн дэлгэц).
        /// </summary>
        internal static Func<IntPtr> OwnerHandleProvider;

        private static IntPtr OwnerHandle()
        {
            try { Func<IntPtr> p = OwnerHandleProvider; return p != null ? p() : IntPtr.Zero; }
            catch { return IntPtr.Zero; }
        }

        /// <summary>
        /// Өөрөө хэмжээгээ (Width/Height/MinWidth/MinHeight/ResizeMode/SizeToContent) аль хэдийн тохируулсан цонхыг (кодоор угсарсан
        /// Smart цонхнууд) ЭЗЭН дэлгэцийн ажлын талбарт багтаана — тохируулсан утгыг нь `Setup`-д буцааж өгнө.
        /// </summary>
        internal static void Adopt(Window w, string prefsKey)
        {
            if (w == null) return;
            Setup(w, w.Title, w.Width, w.Height, w.MinWidth, w.MinHeight, prefsKey,
                resizable: w.ResizeMode != ResizeMode.NoResize,
                sizeToContentHeight: w.SizeToContent == SizeToContent.Height || w.SizeToContent == SizeToContent.WidthAndHeight);
        }

        internal static void Setup(Window w, string title, double width, double height, double minWidth, double minHeight,
                                   string prefsKey = null, bool resizable = true, bool sizeToContentHeight = false,
                                   UiRect? savedOverride = null)
        {
            if (w == null) return;
            w.Title = title;
            w.ShowInTaskbar = false;

            UiRect workArea;
            UiRect? owner = null;
            try
            {
                MglNative.MonitorInfo mon = MglNative.ForOwner(OwnerHandle());
                if (mon != null) { workArea = mon.WorkAreaDip; owner = mon.OwnerDip; }
                else workArea = FromSystemParameters();
            }
            catch
            {
                workArea = FromSystemParameters();
            }

            UiRect? saved = savedOverride;
            if (saved == null && !string.IsNullOrEmpty(prefsKey))
            {
                UiRect r;
                if (MglUiPrefs.Load().TryGetWindow(prefsKey, out r)) saved = r;
            }

            FitResult fit = WindowFit.Compute(new FitRequest
            {
                DesiredWidth = width, DesiredHeight = height, MinWidth = minWidth, MinHeight = minHeight,
                WorkArea = workArea, Owner = owner, Saved = saved,
            });

            w.MinWidth = fit.MinWidth;
            w.MaxWidth = fit.MaxWidth;
            w.MaxHeight = fit.MaxHeight;
            w.Width = fit.Width;
            if (sizeToContentHeight)
            {
                w.SizeToContent = SizeToContent.Height;
            }
            else
            {
                w.MinHeight = fit.MinHeight;
                w.Height = fit.Height;
            }
            w.ResizeMode = resizable ? ResizeMode.CanResizeWithGrip : ResizeMode.NoResize;
            w.WindowStartupLocation = WindowStartupLocation.Manual;
            w.Left = fit.Left;
            w.Top = fit.Top;
            try { Managed.Add(w, null); } catch (ArgumentException) { /* аль хэдийн бүртгэлтэй */ }

            if (!string.IsNullOrEmpty(prefsKey))
            {
                string key = prefsKey;
                w.Closing += (s, e) => SaveBounds(w, key);
            }
        }

        /// <summary>Хаахад дуудагдана; зөвхөн хэвийн (maximize биш) төлөвт хил хадгална.</summary>
        internal static void SaveBounds(Window w, string key)
        {
            if (w == null || string.IsNullOrEmpty(key)) return;
            try
            {
                Rect r = w.WindowState == WindowState.Normal ? new Rect(w.Left, w.Top, w.ActualWidth, w.ActualHeight) : w.RestoreBounds;
                if (r.Width < 100 || r.Height < 60 || double.IsNaN(r.Left) || double.IsNaN(r.Top)) return;
                MglUiPrefs.Update(p => p.SetWindow(key, new UiRect(r.Left, r.Top, r.Width, r.Height)));
            }
            catch { /* хил хадгалагдахгүй байх нь цонх хаагдахаас чухал биш */ }
        }

        private static UiRect FromSystemParameters()
        {
            try
            {
                Rect wa = SystemParameters.WorkArea;
                return new UiRect(wa.Left, wa.Top, wa.Width, wa.Height);
            }
            catch
            {
                return new UiRect(0, 0, 1280, 720);
            }
        }
    }
}
