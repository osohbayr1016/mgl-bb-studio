using System.Windows;

namespace RevitMcpAddin.SheetNumerator.Ui
{
    /// <summary>
    /// Нэг мөр текст асуух («Хуудасны нэр өөрчлөх»).  Өмнө нь тусдаа Window хуулбар байсан — одоо дундын
    /// <c>Ui/MglPrompt</c> (токен сэдэв, LabeledBy, ажлын талбарт багтана) руу дамжуулна.  Revit-ийн төрөл ашиглахгүй тул UI smoke-д ч ажиллана.
    /// </summary>
    public static class TextPromptDialog
    {
        /// <summary>Асууна.  Null = хэрэглэгч болиулсан.  Хоосон бичвэрийг хүлээн авна (дуудагч шийднэ).</summary>
        public static string Ask(Window owner, string title, string prompt, string initial)
        {
            return RevitMcpAddin.Ui.MglPrompt.Ask(owner, title, prompt, initial, requireText: false);
        }
    }
}
