using System;
using System.IO;
using System.Reflection;
using System.Windows;
using System.Windows.Markup;

namespace RevitMcpAddin.Ui
{
    /// <summary>
    /// MGL-ийн ДУНДЫН удирдлагын загварыг (Ui/Resources/MglControls.xaml) нэг удаа уншина.
    ///
    /// ⚠️ `pack://` URI ХЭРЭГЛЭХГҮЙ: XAML нь `EmbeddedResource` бөгөөд `XamlReader.Load`-оор уншигдана.
    /// Шалтгаан — repo-д ResourceDictionary/pack:// загвар байхгүй, add-in тусгаарласан assembly-load
    /// context-д ачаалагддаг (csproj EnableDynamicLoading), мөн WPF-ийн хоёр алхамт эмхэтгэл «BG1002»-аар
    /// унадаг (docs/INSTALL_BUNDLE.md:30).  Файлыг scratch төсөлд `Page` болгон эмхэтгэж синтаксийг шалгасан.
    ///
    /// ⚠️ Унавал (`LastError`) цонх ӨӨРЧЛӨГДӨХГҮЙ (системийн анхдагч харагдалттай үлдэнэ) — энэ нь хэрэгслийг
    /// ХЭЗЭЭ Ч эвдэхгүй.  Бүтэлгүйтлийг дахин дахин оролдохгүй (нэг удаа л).
    /// </summary>
    internal static class MglStyles
    {
        internal const string ResourceName = "RevitMcpAddin.Ui.MglControls.xaml";

        private static readonly object Gate = new object();
        private static ResourceDictionary _styles;
        private static bool _tried;

        /// <summary>Сүүлийн алдаа (унасан бол); амжилттай бол null.</summary>
        internal static string LastError { get; private set; }

        /// <summary>Хуваалцсан загвар (нэг instance); ачаалж чадаагүй бол null.  UI thread-ээс дуудна.</summary>
        internal static ResourceDictionary Get()
        {
            lock (Gate)
            {
                if (_tried) return _styles;
                _tried = true;
                try
                {
                    Assembly asm = typeof(MglStyles).Assembly;
                    using (Stream s = asm.GetManifestResourceStream(ResourceName))
                    {
                        if (s == null)
                        {
                            LastError = "Embedded resource олдсонгүй: " + ResourceName;
                            return null;
                        }
                        _styles = (ResourceDictionary)XamlReader.Load(s);
                    }
                }
                catch (Exception ex)
                {
                    LastError = ex.GetType().Name + ": " + ex.Message;
                    _styles = null;
                }
                return _styles;
            }
        }
    }
}
