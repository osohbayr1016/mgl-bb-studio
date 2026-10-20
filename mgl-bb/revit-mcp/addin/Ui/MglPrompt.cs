using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;

namespace RevitMcpAddin.Ui
{
    /// <summary>
    /// Нэг мөр бичвэр асуух ДУНДЫН модаль цонх.  Өмнө нь хоёр давхардсан хуулбар байв (`SheetNumerator/Ui/TextPromptDialog` — «Зөв»,
    /// `ChangeImpact/Ui/PromptDialog` — «Хадгалах»), хоёулаа системийн анхдагч (цайвар) загвартай, ажлын талбарт тохируулаагүй, нэр бүхий
    /// автоматжуулалтгүй.  Одоо нэг: токен сэдэв, шошго-оролт холбоотой (LabeledBy), Enter = хадгалах, Esc = болих.
    /// Revit-гүй (smoke төслүүдэд эмхэтгэгдэнэ).
    /// </summary>
    internal static class MglPrompt
    {
        /// <param name="requireText">true бол хоосон үед «Хадгалах» идэвхгүй, үр дүн тайрагдсан.</param>
        /// <returns>Бичсэн бичвэр; хэрэглэгч «Болих» дарсан бол null.</returns>
        internal static string Ask(Window owner, string title, string prompt, string initial, bool requireText)
        {
            var w = new Window { ShowInTaskbar = false };
            MglWindow.Setup(w, title, 480, 0, 400, 0, prefsKey: null, resizable: false, sizeToContentHeight: true);
            MglTheme.Apply(w, 13);

            var label = new TextBlock { Text = prompt, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 6) };
            var box = new TextBox { Text = initial ?? string.Empty };
            MglAuto.LabelFor(label, box);

            string result = null;
            var ok = new Button { Content = "Хадгалах", MinWidth = 100, IsDefault = true };
            MglUi.Primary(ok);
            ok.Click += (s, e) => { result = box.Text; w.DialogResult = true; };
            var cancel = new Button { Content = "Болих", MinWidth = 90, Margin = new Thickness(8, 0, 0, 0), IsCancel = true };
            cancel.Click += (s, e) => { w.DialogResult = false; };

            var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 14, 0, 0) };
            buttons.Children.Add(ok);
            buttons.Children.Add(cancel);

            var panel = new StackPanel { Margin = new Thickness(18, 16, 18, 16) };
            panel.Children.Add(label);
            panel.Children.Add(box);
            panel.Children.Add(buttons);
            w.Content = panel;

            if (requireText)
            {
                ok.IsEnabled = !string.IsNullOrWhiteSpace(box.Text);
                box.TextChanged += (s, e) => ok.IsEnabled = !string.IsNullOrWhiteSpace(box.Text);
            }
            w.Loaded += (s, e) => { box.Focus(); box.SelectAll(); };

            if (owner != null && owner.IsLoaded) w.Owner = owner;
            bool? dialog = w.ShowDialog();
            if (dialog != true) return null;
            return requireText ? (string.IsNullOrWhiteSpace(result) ? null : result.Trim()) : result;
        }
    }
}
