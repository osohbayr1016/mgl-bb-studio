using System;
using Autodesk.Revit.UI;

namespace RevitMcpAddin.Ui.Revit
{
    /// <summary>
    /// Revit-ийн сэдвийг (`UIThemeManager.CurrentTheme`) MGL-ийн WPF сэдэв рүү дамжуулна.  `UIThemeManager`,
    /// `UIControlledApplication.ThemeChanged` нь 2024–2027 бүх API хувилбарт байгааг NuGet XML-ээр шалгасан;
    /// эмхэтгэл бүр (R24–R27) баталгаажуулна.  Энэ класс ЗӨВХӨН Revit төрөл мэддэг — WPF давхарга (`MglTheme`)
    /// Revit-д хамааралгүй, функц (`Func&lt;string&gt;`)-ээр л холбогдоно.
    /// </summary>
    internal static class RevitThemeBridge
    {
        /// <summary>"Dark" / "Light"; уншиж чадахгүй бол null (WPF давхарга цайвар руу унана).</summary>
        internal static string CurrentThemeName()
        {
            try
            {
                return UIThemeManager.CurrentTheme == UITheme.Dark ? "Dark" : "Light";
            }
            catch
            {
                return null;
            }
        }

        /// <summary>`App.OnStartup`-аас НЭГ удаа дуудна.  Алдаа гарвал сэдэв «цайвар/системийн» хэвээр.</summary>
        internal static void Attach(UIControlledApplication application)
        {
            MglTheme.SetRevitThemeProvider(CurrentThemeName);
            try
            {
                if (application != null)
                    application.ThemeChanged += (s, e) =>
                    {
                        try { MglTheme.NotifyRevitThemeChanged(); } catch { /* сэдэв шинэчлэгдэхгүй ч Revit-д нөлөөлөхгүй */ }
                    };
            }
            catch
            {
                // Event-д бүртгэж чадаагүй — эхлэх үеийн сэдвээр үлдэнэ.
            }
        }
    }
}
