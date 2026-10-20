using System.Windows.Threading;

namespace RevitMcpAddin
{
    /// <summary>
    /// WPF-ийн "DoEvents": дараалалд хуримтлагдсан input/render мессежүүдийг нэг
    /// удаа шавхана. Урт ажлыг Revit-ийн UI thread дээр гүйцэтгэх үед progress
    /// цонхыг будуулахад ашиглана (UseWindowsForms=false тул WinForms-ийн
    /// DoEvents байхгүй).
    /// </summary>
    internal static class UiPump
    {
        public static void DoEvents()
        {
            var frame = new DispatcherFrame();
            Dispatcher.CurrentDispatcher.BeginInvoke(
                DispatcherPriority.Background,
                new DispatcherOperationCallback(ExitFrame),
                frame);
            Dispatcher.PushFrame(frame);
        }

        private static object ExitFrame(object state)
        {
            ((DispatcherFrame)state).Continue = false;
            return null;
        }
    }
}
