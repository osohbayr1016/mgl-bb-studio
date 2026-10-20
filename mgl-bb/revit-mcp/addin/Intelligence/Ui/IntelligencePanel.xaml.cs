using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using RevitMcpAddin.Intelligence.Contracts;
using RevitMcpAddin.Intelligence.Revit;

namespace RevitMcpAddin.Intelligence.Ui
{
    /// <summary>
    /// «MGL AI» дэд самбарын код — ЗӨВХӨН UI-ийн залгаас; бүх логик
    /// `IntelligenceViewModel` ба `RevitIntelligenceHost`-д.  Revit-ийн API
    /// ЭНД ХЭЗЭЭ Ч дуудагдахгүй (WPF thread-ээс `RevitToolBus.Call` гацна —
    /// урхи №10; хост өөрөө `Task.Run` хийдэг).
    /// </summary>
    public partial class IntelligencePanel : UserControl
    {
        private readonly IntelligenceViewModel _vm;

        public IntelligencePanel()
        {
            InitializeComponent();
            // Эх самбар (AssistantPane) аль хэдийн сэдэв тавьсан; ганцаараа ч (тест/хост) зөв харагдахын тулд өөрийн
            // Resources-д ч токен нэмнэ (давхар нэмэх нь аюулгүй — ижил түлхүүр, ойрхон нь ялна).
            // ⚠️ `global::` — энэ namespace-д `Ui` нь `RevitMcpAddin.Intelligence.Ui`-г заадаг тул.
            global::RevitMcpAddin.Ui.MglTheme.Apply(this, 12);
            // DEV/тест таб ӨГӨГДМӨЛӨӨР НУУЦ — зөвхөн MGL_DEV_MODE=1 үед ил (UI-ийн ил байдал ЗӨВХӨН; хамгаалалт хэвээр).
            if (RevitMcpAddin.Intelligence.Core.DevMode.IsEnabled()) DevTab.Visibility = Visibility.Visible;
            _vm = new IntelligenceViewModel(RevitIntelligenceHost.Instance, Dispatcher);
            DataContext = _vm;
            _vm.Context.PropertyChanged += (s, e) =>
            {
                if (e.PropertyName == "ShowSuggestions" || e.PropertyName == "LinkConfirmed") SyncLinkButtons();
            };
            SyncLinkButtons();
        }

        private void SyncLinkButtons()
        {
            LinkSuggestPanel.Visibility = _vm.Context.ShowSuggestions ? Visibility.Visible : Visibility.Collapsed;
            UnlinkBtn.Visibility = _vm.Context.LinkConfirmed ? Visibility.Visible : Visibility.Collapsed;
        }

        private void RefreshAll_Click(object sender, RoutedEventArgs e) { _vm.RefreshAll(); }

        private void ConfirmLink_Click(object sender, RoutedEventArgs e)
        {
            _vm.Context.PickedSuggestion = SuggestCombo.SelectedItem as ProjectLinkSuggestion;
            if (_vm.Context.PickedSuggestion == null && SuggestCombo.Items.Count > 0) _vm.Context.PickedSuggestion = SuggestCombo.Items[0] as ProjectLinkSuggestion;
            _vm.ConfirmLink();
        }

        private void Unlink_Click(object sender, RoutedEventArgs e) { _vm.Unlink(); }

        private void TaskList_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            _vm.SelectTask(TaskList.SelectedItem as TaskRowVm);
        }

        private void TaskPrev_Click(object sender, RoutedEventArgs e) { _vm.Navigate(-1); }
        private void TaskNext_Click(object sender, RoutedEventArgs e) { _vm.Navigate(+1); }
        private void TaskSelectAll_Click(object sender, RoutedEventArgs e) { _vm.SelectAllCandidates(); }
        private void TaskReviewed_Click(object sender, RoutedEventArgs e) { _vm.MarkCurrentReviewed(); }

        private static IssueRowVm RowOf(object sender)
        {
            var b = sender as Button;
            return b != null ? b.Tag as IssueRowVm : null;
        }

        private void IssueShow_Click(object sender, RoutedEventArgs e) { _vm.ShowIssue(RowOf(sender)); }
        private void IssueExplain_Click(object sender, RoutedEventArgs e) { _vm.ExplainIssue(RowOf(sender)); }
        private void IssueSelect_Click(object sender, RoutedEventArgs e)
        {
            IssueRowVm r = RowOf(sender);
            if (r == null) return;
            RevitIntelligenceHost.Instance?.SelectElementsAsync(r.Issue.ElementIds);
        }

        private void Report_Click(object sender, RoutedEventArgs e) { _vm.GenerateReport(); }

        /* ---------------- DEV / TEST (NON-PRODUCTION) ---------------- */
        private async void DevNewProject_Click(object sender, RoutedEventArgs e) { await _vm.DevToolAsync("test_project_new", "{}", "Тест төсөл"); }
        private async void DevGate_Click(object sender, RoutedEventArgs e) { await _vm.DevToolAsync("test_model_gate", "{}", "Хаалт"); }
        private async void DevCreate_Click(object sender, RoutedEventArgs e) { await _vm.DevToolAsync("test_model_create", "{}", "Тест загвар"); }
        private async void DevMove_Click(object sender, RoutedEventArgs e) { await _vm.DevToolAsync("test_model_mutate", "{\"op\":\"move_interior_wall\"}", "Ханыг зөөх"); }
        private async void DevDelete_Click(object sender, RoutedEventArgs e) { await _vm.DevToolAsync("test_model_mutate", "{\"op\":\"delete_interior_wall\"}", "Ханыг устгах"); }
        private async void DevDeleteDoor_Click(object sender, RoutedEventArgs e) { await _vm.DevToolAsync("test_model_mutate", "{\"op\":\"delete_door\"}", "Хаалга устгах"); }
        private async void DevSave_Click(object sender, RoutedEventArgs e) { await _vm.DevToolAsync("test_model_save", "{}", "Хадгалах"); }
        private void DevEvaluate_Click(object sender, RoutedEventArgs e) { System.Threading.Tasks.Task.Run(() => RevitIntelligenceHost.Instance?.EvaluateAllCurrent()); }

        private async void Ask_Click(object sender, RoutedEventArgs e) { await _vm.AskAsync(); }

        /* R4.1 — санал → preview → ИЛ баталгаа (Apply) */
        private async void ProposalPreview_Click(object sender, RoutedEventArgs e)
        {
            var item = ProposalParam.SelectedItem as System.Windows.Controls.ComboBoxItem;
            await _vm.ProposeAsync(item != null ? item.Content as string : "Comments");
        }
        private async void ProposalApply_Click(object sender, RoutedEventArgs e) { await _vm.ApplyAsync(); }
        private void ProposalDiscard_Click(object sender, RoutedEventArgs e) { _vm.DiscardProposal(); }

        private async void AiQuestion_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Enter && (Keyboard.Modifiers & ModifierKeys.Shift) == 0)
            {
                e.Handled = true;
                await _vm.AskAsync();
            }
        }
    }
}
