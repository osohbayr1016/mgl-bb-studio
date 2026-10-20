using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Linq;
using System.Windows;

namespace RevitMcpAddin
{
    /// <summary>Сонгогчийн нэг мөр.</summary>
    public sealed class SchedulePickItem : INotifyPropertyChanged
    {
        private bool _isChecked;

        public string Name { get; set; }
        public string Category { get; set; }
        public int RowCount { get; set; }
        public string RowLabel => "(" + RowCount + " мөр)";

        public bool IsChecked
        {
            get { return _isChecked; }
            set
            {
                _isChecked = value;
                PropertyChanged?.Invoke(this, new PropertyChangedEventArgs("IsChecked"));
            }
        }

        public event PropertyChangedEventHandler PropertyChanged;
    }

    /// <summary>
    /// Хүснэгт сонгох цонх: хайлттай checkbox жагсаалт (категори — нэр — мөр).
    /// Сонголт settings.json-д хадгалагдаж дараагийн удаад автоматаар сэргэнэ.
    /// </summary>
    public partial class SchedulePickerDialog : Window
    {
        private readonly List<SchedulePickItem> _all;
        private readonly ObservableCollection<SchedulePickItem> _visible =
            new ObservableCollection<SchedulePickItem>();

        public List<string> SelectedNames { get; } = new List<string>();

        public SchedulePickerDialog(List<SchedulePickItem> items, List<string> previouslySelected)
        {
            InitializeComponent();
            // MGL UI-ийн дундын давхарга: эзэн Revit-ийн дэлгэцэд тохируулах, сэдэв, хандалтын нэр.
            Ui.MglWindow.Setup(this, Title, 560, 620, 440, 420, prefsKey: "schedule-picker");
            Ui.MglTheme.Apply(this);
            Ui.MglUi.Primary(OkBtn);
            Ui.MglAuto.LabelFor(SearchLabel, SearchBox);
            Ui.MglAuto.Name(OkBtn, "ERP-д илгээх", "Сонгосон хүснэгтүүдийг ERP-ийн сонгосон төсөл рүү илгээнэ");
            _all = items;

            var previous = new HashSet<string>(
                previouslySelected ?? new List<string>(), StringComparer.OrdinalIgnoreCase);
            foreach (SchedulePickItem item in _all)
            {
                if (previous.Contains(item.Name))
                    item.IsChecked = true;
                item.PropertyChanged += (s, e) => UpdateCount();
            }

            ScheduleList.ItemsSource = _visible;
            ApplyFilter();
        }

        private void ApplyFilter()
        {
            string q = (SearchBox.Text ?? string.Empty).Trim().ToLowerInvariant();
            _visible.Clear();
            foreach (SchedulePickItem item in _all)
            {
                if (q.Length == 0 ||
                    item.Name.ToLowerInvariant().Contains(q) ||
                    item.Category.ToLowerInvariant().Contains(q))
                {
                    _visible.Add(item);
                }
            }
            UpdateCount();
        }

        private void UpdateCount()
        {
            int selected = _all.Count(i => i.IsChecked);
            string text = Ui.MglUiText.SelectedOf(selected, _all.Count);
            // Шүүлтээр нуугдсан ч сонгогдсон хүснэгт ИЛГЭЭГДЭНЭ — үүнийг нууж болохгүй.
            int hiddenSelected = _all.Count(i => i.IsChecked && !_visible.Contains(i));
            if (hiddenSelected > 0) text += " (шүүлтээр нуугдсан " + hiddenSelected + " орно)";
            CountText.Text = text;
            if (selected > 0) ErrorText.Visibility = System.Windows.Visibility.Collapsed;
        }

        private void SearchBox_TextChanged(object sender, System.Windows.Controls.TextChangedEventArgs e)
        {
            ApplyFilter();
        }

        private void SelectAllBtn_Click(object sender, RoutedEventArgs e)
        {
            // Зөвхөн харагдаж (шүүгдэж) байгааг сонгоно.
            foreach (SchedulePickItem item in _visible)
                item.IsChecked = true;
        }

        private void ClearBtn_Click(object sender, RoutedEventArgs e)
        {
            foreach (SchedulePickItem item in _all)
                item.IsChecked = false;
        }

        private void OkBtn_Click(object sender, RoutedEventArgs e)
        {
            SelectedNames.Clear();
            SelectedNames.AddRange(_all.Where(i => i.IsChecked).Select(i => i.Name));
            if (SelectedNames.Count == 0)
            {
                // Модаль MessageBox-гүй: алдааг товчны хажууд, өнгө + тэмдэгтэй (өнгө ганцаараа биш) харуулна.
                ErrorText.Text = "✖ Дор хаяж нэг хүснэгт сонгоно уу.";
                ErrorText.Visibility = System.Windows.Visibility.Visible;
                return;
            }
            DialogResult = true;
        }
    }
}
