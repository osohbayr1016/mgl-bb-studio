using System;
using System.Windows;
using Autodesk.Revit.UI;
using RevitMcpAddin.SheetNumerator.Core;
using RevitMcpAddin.SheetNumerator.Ui;

namespace RevitMcpAddin.SheetNumerator.Revit
{
    /// <summary>
    /// ViewModel-ийн баталгаа/алдааны цонхууд — MGL-ийн бусад командтой ИЖИЛ хэв маяг (`TaskDialog`, гарчиг
    /// «MGL — …»).  Нэр өөрчлөхөд асуух текст нь Revit-ийн төрөлгүй жижиг WPF цонх.
    /// </summary>
    internal sealed class RevitUserPrompts : IUserPrompts
    {
        private const string TitlePrefix = "MGL — ";

        /// <summary>Тексттэй цонхны эзэн (дугаарлалтын цонх).</summary>
        public Window Owner { get; set; }

        public bool Confirm(string title, string message, bool destructive)
        {
            var td = new TaskDialog(TitlePrefix + title)
            {
                MainInstruction = FirstLine(message),
                MainContent = Rest(message),
                CommonButtons = TaskDialogCommonButtons.Yes | TaskDialogCommonButtons.No,
                DefaultButton = destructive ? TaskDialogResult.No : TaskDialogResult.Yes,
                MainIcon = destructive ? TaskDialogIcon.TaskDialogIconWarning : TaskDialogIcon.TaskDialogIconNone,
            };
            return td.Show() == TaskDialogResult.Yes;
        }

        public string AskText(string title, string prompt, string initial)
        {
            return TextPromptDialog.Ask(Owner, title, prompt, initial);
        }

        public void ShowError(string title, string message, string detail)
        {
            var td = new TaskDialog(TitlePrefix + title)
            {
                MainInstruction = FirstLine(message),
                MainContent = Rest(message),
                CommonButtons = TaskDialogCommonButtons.Close,
                MainIcon = TaskDialogIcon.TaskDialogIconWarning,
            };
            if (!string.IsNullOrWhiteSpace(detail))
                td.ExpandedContent = detail;
            td.Show();
        }

        public void ShowInfo(string title, string message)
        {
            var td = new TaskDialog(TitlePrefix + title)
            {
                MainInstruction = FirstLine(message),
                MainContent = Rest(message),
                CommonButtons = TaskDialogCommonButtons.Close,
            };
            td.Show();
        }

        private static string FirstLine(string s)
        {
            if (string.IsNullOrEmpty(s))
                return string.Empty;
            int i = s.IndexOf('\n');
            return i < 0 ? s : s.Substring(0, i);
        }

        private static string Rest(string s)
        {
            if (string.IsNullOrEmpty(s))
                return string.Empty;
            int i = s.IndexOf('\n');
            return i < 0 ? string.Empty : s.Substring(i + 1);
        }
    }
}
