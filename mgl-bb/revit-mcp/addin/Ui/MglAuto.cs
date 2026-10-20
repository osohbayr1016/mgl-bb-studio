using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;

namespace RevitMcpAddin.Ui
{
    /// <summary>
    /// Хандалтын (UI Automation) туслахууд.  SheetNumerator-ийн 41 AutomationId, 6 KeyBinding-ийг ХӨНДӨХГҮЙ —
    /// тэр загварыг бусад цонхонд өргөтгөнө: дүрс/тэмдэгт товчинд Name, шошгыг оролттой холбох, ID.
    /// </summary>
    internal static class MglAuto
    {
        /// <summary>Дэлгэцийн уншигчид хэлэх нэр (+ нэмэлт тайлбар).  Дүрс/тэмдэгт ганцаараа товчинд ЗААВАЛ.</summary>
        internal static T Name<T>(T element, string name, string help = null) where T : DependencyObject
        {
            if (element == null) return element;
            if (!string.IsNullOrEmpty(name)) AutomationProperties.SetName(element, name);
            if (!string.IsNullOrEmpty(help)) AutomationProperties.SetHelpText(element, help);
            return element;
        }

        internal static T Id<T>(T element, string automationId) where T : DependencyObject
        {
            if (element != null && !string.IsNullOrEmpty(automationId)) AutomationProperties.SetAutomationId(element, automationId);
            return element;
        }

        /// <summary>Бичвэр шошгыг оролттой холбоно (LabeledBy) — уншигч «Нэвтрэх нэр, бичвэр оруулах талбар» гэж хэлнэ.</summary>
        internal static void LabelFor(UIElement label, UIElement target)
        {
            if (label == null || target == null) return;
            AutomationProperties.SetLabeledBy(target, label);
            var l = label as Label;
            if (l != null) l.Target = target;
        }
    }
}
