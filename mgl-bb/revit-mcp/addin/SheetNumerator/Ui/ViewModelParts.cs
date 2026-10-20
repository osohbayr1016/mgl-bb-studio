using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using RevitMcpAddin.SheetNumerator.Core;

namespace RevitMcpAddin.SheetNumerator.Ui
{
    /// <summary>
    /// Хэрэглэгчтэй харилцах цонхууд (баталгаа, текст асуух, алдаа) — ViewModel-ийг Revit/TaskDialog-оос
    /// ТУСГААРЛАХ хаалга.  Бодит Revit-д TaskDialog + WPF-ийн жижиг цонх; тест/smoke-д хуурамч.
    /// </summary>
    public interface IUserPrompts
    {
        /// <param name="destructive">true → устгах мэт эмнэлттэй үйлдэл (анхдагч нь «Болих»).</param>
        bool Confirm(string title, string message, bool destructive);

        /// <summary>Null = хэрэглэгч болиулсан.</summary>
        string AskText(string title, string prompt, string initial);

        void ShowError(string title, string message, string detail);

        void ShowInfo(string title, string message);
    }

    /// <summary>ComboBox-ийн «нэр + утга» хос.</summary>
    public sealed class EnumOption<T>
    {
        public EnumOption(T value, string label)
        {
            Value = value;
            Label = label;
        }

        public T Value { get; }
        public string Label { get; }

        public override string ToString()
        {
            return Label;
        }
    }

    /// <summary>Параметрийн сонголт (null Info = «—», сонгоогүй).</summary>
    public sealed class ParameterOption
    {
        public static readonly ParameterOption None = new ParameterOption(null);

        public ParameterOption(SheetParameterInfo info)
        {
            Info = info;
        }

        public SheetParameterInfo Info { get; }

        public ParameterKey Key => Info != null ? Info.Key : null;

        public string Label
        {
            get { return Info == null ? "—" : (Info.Label ?? Info.DisplayName); }
        }

        public override string ToString()
        {
            return Label;
        }
    }

    /// <summary>Нарийвчилсан дугаарлалтын нэг хэсгийн ЦОНХНЫ төлөв (түүхий текстүүд — зөвхөн engine-д задлагдана).</summary>
    public sealed class PartViewModel : ObservableObject
    {
        private readonly Action _changed;
        private bool _enabled;
        private string _prefix = string.Empty;
        private string _suffix = string.Empty;
        private EnumOption<PartValueMode> _valueMode;
        private string _startText = "1";
        private string _stepText = "1";
        private string _widthText = "1";
        private string _limitText = string.Empty;
        private bool _wrap;

        public PartViewModel(int index, Action changed)
        {
            Index = index;
            _changed = changed;
            ValueModes = new[]
            {
                new EnumOption<PartValueMode>(PartValueMode.None, "Тоогүй"),
                new EnumOption<PartValueMode>(PartValueMode.Fixed, "Тогтмол"),
                new EnumOption<PartValueMode>(PartValueMode.Increment, "Өсөх дараалал"),
                new EnumOption<PartValueMode>(PartValueMode.Decrement, "Буурах дараалал"),
            };
            _valueMode = ValueModes[2];
        }

        public int Index { get; }
        public string Title => "Хэсэг " + (Index + 1);
        public IReadOnlyList<EnumOption<PartValueMode>> ValueModes { get; }

        public bool Enabled { get { return _enabled; } set { if (Set(ref _enabled, value)) Changed(); } }
        public string Prefix { get { return _prefix; } set { if (Set(ref _prefix, value ?? string.Empty)) Changed(); } }
        public string Suffix { get { return _suffix; } set { if (Set(ref _suffix, value ?? string.Empty)) Changed(); } }

        public EnumOption<PartValueMode> ValueMode
        {
            get { return _valueMode; }
            set
            {
                if (value != null && Set(ref _valueMode, value))
                {
                    Raise("HasNumber");
                    Raise("IsAdvancing");
                    Changed();
                }
            }
        }

        public string StartText { get { return _startText; } set { if (Set(ref _startText, value ?? string.Empty)) Changed(); } }
        public string StepText { get { return _stepText; } set { if (Set(ref _stepText, value ?? string.Empty)) Changed(); } }
        public string WidthText { get { return _widthText; } set { if (Set(ref _widthText, value ?? string.Empty)) Changed(); } }
        public string LimitText { get { return _limitText; } set { if (Set(ref _limitText, value ?? string.Empty)) Changed(); } }
        public bool Wrap { get { return _wrap; } set { if (Set(ref _wrap, value)) Changed(); } }

        /// <summary>Тоон утгатай (None БИШ) — эхлэх/орон талбарууд харагдана.</summary>
        public bool HasNumber => _valueMode.Value != PartValueMode.None;

        /// <summary>Өөрчлөгддөг (өсөх/буурах) — алхам, хязгаар, буцах харагдана.</summary>
        public bool IsAdvancing => _valueMode.Value == PartValueMode.Increment || _valueMode.Value == PartValueMode.Decrement;

        private void Changed()
        {
            if (_changed != null)
                _changed();
        }

        public void LoadFrom(NumberPartSettings p)
        {
            _enabled = p.Enabled;
            _prefix = p.Prefix;
            _suffix = p.Suffix;
            _valueMode = ValueModes.First(v => v.Value == p.ValueMode);
            _startText = p.Start.ToString(System.Globalization.CultureInfo.InvariantCulture);
            _stepText = p.Step.ToString(System.Globalization.CultureInfo.InvariantCulture);
            _widthText = p.Width.ToString(System.Globalization.CultureInfo.InvariantCulture);
            _limitText = p.Limit.HasValue ? p.Limit.Value.ToString(System.Globalization.CultureInfo.InvariantCulture) : string.Empty;
            _wrap = p.WrapAtLimit;
            Raise(string.Empty);
        }
    }

    /// <summary>Мөрийн төлөвийн ангилал — XAML-ийн DataTrigger-т.</summary>
    public enum RowState
    {
        Normal = 0,
        Changed = 1,
        Warning = 2,
        Error = 3,
    }

    /// <summary>Жагсаалтын нэг мөр.  Revit объектгүй — <see cref="SheetSnapshot"/> + төлөвлөсөн үр дүн.</summary>
    public sealed class SheetRowViewModel : ObservableObject
    {
        private string _newNumber;
        private string _newName;
        private string _statusText = string.Empty;
        private string _tooltip = string.Empty;
        private RowState _state;
        private bool _numberChanged;
        private bool _nameChanged;
        private bool _previewHidden;

        public SheetRowViewModel(SheetSnapshot sheet)
        {
            Sheet = sheet;
            _newNumber = sheet.Number;
            _newName = sheet.Name;
        }

        public SheetSnapshot Sheet { get; }
        public long SheetId => Sheet.SheetId;

        public string CurrentNumber
        {
            get
            {
                return UnicodeMarkers.ContainsMarker(Sheet.Number) ? UnicodeMarkers.Escape(Sheet.Number) : Sheet.Number;
            }
        }

        public string CurrentName => Sheet.Name;
        public bool IsPlaceholder => Sheet.IsPlaceholder;
        public bool IsAssemblySheet => Sheet.IsAssemblySheet;

        /// <summary>Шинэ дугаар (өөрчлөгдөөгүй бол хоосон, урьдчилсан харалт нуугдсан үед ч хоосон).</summary>
        public string NewNumberDisplay
        {
            get
            {
                if (_previewHidden || !_numberChanged)
                    return string.Empty;
                return UnicodeMarkers.ContainsMarker(_newNumber) ? UnicodeMarkers.Escape(_newNumber) : _newNumber;
            }
        }

        /// <summary>Нэр: өөрчлөгдөх бол шинэ нэр (урьдчилсан харалт нуугдсан үед одоогийнх).</summary>
        public string NameDisplay
        {
            get { return _previewHidden || !_nameChanged ? Sheet.Name : _newName; }
        }

        public bool NameWillChange => !_previewHidden && _nameChanged;
        public bool NumberWillChange => !_previewHidden && _numberChanged;

        public string StatusText => _statusText;
        public string Tooltip => _tooltip;
        public RowState State => _state;

        /// <summary>«Placeholder», «Assembly» зэрэг тогтмол шошго.</summary>
        public string Kind
        {
            get
            {
                if (Sheet.IsPlaceholder)
                    return "Placeholder";
                if (Sheet.IsAssemblySheet)
                    return "Assembly";
                return string.Empty;
            }
        }

        public void Update(PlannedRow row, bool previewHidden)
        {
            _previewHidden = previewHidden;
            _newNumber = row.NewNumber;
            _newName = row.NewName;
            _numberChanged = row.NumberChanged;
            _nameChanged = row.NameChanged;

            IssueSeverity? max = row.MaxSeverity;
            if (max == IssueSeverity.Error)
                _state = RowState.Error;
            else if (max == IssueSeverity.Warning)
                _state = RowState.Warning;
            else if (row.IsChanged)
                _state = RowState.Changed;
            else
                _state = RowState.Normal;

            // Хамгийн ноцтой асуудлыг товчоор, бүгдийг tooltip-д.
            ValidationIssue top = row.Issues.OrderByDescending(i => i.Severity).FirstOrDefault();
            string first = top != null ? top.Message.Split('\n')[0] : string.Empty;
            int more = row.Issues.Count - 1;
            _statusText = top == null ? string.Empty : (more > 0 ? first + " (+" + more + ")" : first);

            var tip = new List<string>();
            foreach (ValidationIssue i in row.Issues.OrderByDescending(i => i.Severity))
                tip.Add(i.Message);
            if (row.NumberDiagnostic != null && !tip.Any(t => t.Contains(row.NumberDiagnostic)))
                tip.Add("Дугаар: " + row.NumberDiagnostic);
            if (row.Writes.Count > 0)
                tip.Add("Параметр: " + string.Join(", ", row.Writes.Select(w => w.DisplayName + " = " + w.Describe())));
            _tooltip = string.Join("\n", tip);

            Raise(string.Empty);
        }

        public void ClearPreview(bool previewHidden)
        {
            _previewHidden = previewHidden;
            _newNumber = Sheet.Number;
            _newName = Sheet.Name;
            _numberChanged = false;
            _nameChanged = false;
            _state = RowState.Normal;
            _statusText = string.Empty;
            _tooltip = string.Empty;
            Raise(string.Empty);
        }
    }

    /// <summary>Модны нэг зангилаа (TreeView).</summary>
    public sealed class GroupNodeViewModel : ObservableObject
    {
        private bool _isSelected;
        private bool _isExpanded = true;
        private bool _dirty;
        private readonly Action<GroupNodeViewModel> _selected;

        public GroupNodeViewModel(GroupNode node, Action<GroupNodeViewModel> selected)
        {
            Node = node;
            _selected = selected;
            Children = new ObservableCollection<GroupNodeViewModel>();
            foreach (GroupNode c in node.Children)
                Children.Add(new GroupNodeViewModel(c, selected));
        }

        public GroupNode Node { get; }
        public SheetGroup Group => Node.Group;
        public string Title => Node.Title;
        public bool HasGroup => Node.Group != null;
        public GroupNodeKind Kind => Node.Kind;
        public ObservableCollection<GroupNodeViewModel> Children { get; }

        /// <summary>Бүлгийн ӨӨРИЙН хуудасны тоо; хүүхэдтэй зангилаа бол нийт.</summary>
        public string CountText
        {
            get
            {
                int own = Node.Group != null ? Node.Group.Sheets.Count : 0;
                int total = Node.TotalSheets;
                return Children.Count == 0 || own == total ? "(" + total + ")" : "(" + own + " / " + total + ")";
            }
        }

        public bool IsSelected
        {
            get { return _isSelected; }
            set
            {
                if (Set(ref _isSelected, value) && value && _selected != null)
                    _selected(this);
            }
        }

        public bool IsExpanded { get { return _isExpanded; } set { Set(ref _isExpanded, value); } }

        /// <summary>Энэ бүлгийн жагсаалтын дараалал өөрчлөгдсөн, хэрэгжүүлээгүй (●).</summary>
        public bool IsDirty { get { return _dirty; } set { Set(ref _dirty, value); } }

        public IEnumerable<GroupNodeViewModel> Flatten()
        {
            yield return this;
            foreach (GroupNodeViewModel c in Children)
            {
                foreach (GroupNodeViewModel d in c.Flatten())
                    yield return d;
            }
        }

        /// <summary>Selected callback-ийг дуудахгүйгээр сонголтыг тавина.</summary>
        public void SetSelectedSilently(bool selected)
        {
            _isSelected = selected;
            Raise("IsSelected");
        }
    }
}
