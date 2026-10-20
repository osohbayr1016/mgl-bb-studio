using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading.Tasks;
using RevitMcpAddin.SheetNumerator.Core;

namespace RevitMcpAddin.SheetNumerator.Ui
{
    /// <summary>
    /// ViewModel-ийн ТОХИРГООНЫ хэсэг: цонхны талбарууд (түүхий текст) ↔ <see cref="RenumberSettings"/>.
    ///
    /// ⚠️ Текст талбарыг ХЭЗЭЭ Ч шууд тоо болгон барьдаггүй: хэрэглэгч бичиж байхдаа түр буруу утгатай байж болно.
    /// <see cref="SyncFromFields"/> тооцоо бүрийн өмнө задалж, задрахгүйг <see cref="_parseErrors"/>-т хийнэ → тэр
    /// талбарыг улаанаар тэмдэглэж, «Хэрэгжүүлэх»-ийг хаана (өмнөх хүчинтэй утга моделд хэвээр).
    /// </summary>
    public sealed partial class SheetNumeratorViewModel
    {
        // ── Задлалтын алдаа, талбарын алдаа ─────────────────────────
        private readonly Dictionary<string, string> _parseErrors = new Dictionary<string, string>();
        private static readonly IReadOnlyDictionary<string, string> NoErrors = new Dictionary<string, string>();

        private IReadOnlyDictionary<string, string> _fieldErrors = NoErrors;
        private IReadOnlyList<string> _settingsErrors = new string[0];

        /// <summary>Талбар → алдааны мессеж.  Converter-оор улаан хүрээ + tooltip болно.</summary>
        public IReadOnlyDictionary<string, string> FieldErrors
        {
            get { return _fieldErrors; }
            private set
            {
                _fieldErrors = value;
                Raise("FieldErrors");
            }
        }

        public IReadOnlyList<string> SettingsErrors => _settingsErrors;
        public bool HasSettingsErrors => _settingsErrors.Count > 0;

        private void RebuildFieldErrors()
        {
            var dict = new Dictionary<string, string>();
            var list = new List<string>();
            if (_plan != null)
            {
                foreach (ValidationIssue i in _plan.GlobalIssues)
                {
                    if (i.Severity != IssueSeverity.Error || string.IsNullOrEmpty(i.Field))
                        continue;
                    if (!dict.ContainsKey(i.Field))
                        dict[i.Field] = i.Message;
                    if (!list.Contains(i.Message))
                        list.Add(i.Message);
                }
            }
            _settingsErrors = list;
            FieldErrors = dict;
            Raise("SettingsErrors");
            Raise("HasSettingsErrors");
            Raise("GlobalWarnings");
            Raise("HasGlobalWarnings");
            Raise("GlobalWarningText");
        }

        // ══════════════════════════════════════════════════════════════
        //  Цонхны талбарууд
        // ══════════════════════════════════════════════════════════════
        public PartViewModel Part1 { get; }
        public PartViewModel Part2 { get; }
        public PartViewModel Part3 { get; }

        private PartViewModel[] Parts
        {
            get { return new[] { Part1, Part2, Part3 }; }
        }

        /// <summary>XAML-ийн ItemsControl-д: гурван хэсэг НЭГ загвараар.</summary>
        public IReadOnlyList<PartViewModel> PartList
        {
            get { return Parts; }
        }

        private string _simplePrefix = string.Empty;
        private string _simpleSuffix = string.Empty;
        private bool _simpleUseStart = true;
        private string _simpleStartText = "1";
        private string _simpleWidthText = "1";
        private string _separator1 = "-";
        private string _separator2 = "-";
        private string _shiftValueText = "+1";
        private bool _shiftInc;
        private bool _shiftDec;
        private bool _cleanActive;
        private string _nameSeparator = " ";

        public IReadOnlyList<string> SeparatorChoices { get; } = new[] { "-", ".", "_", "/", " ", "" };

        public int NumberingTabIndex
        {
            get { return Settings.Mode == NumberingMode.Advanced ? 1 : 0; }
            set
            {
                NumberingMode m = value == 1 ? NumberingMode.Advanced : NumberingMode.Simple;
                if (Settings.Mode == m)
                    return;
                Settings.Mode = m;
                Raise("NumberingTabIndex");
                RaiseModeProperties();
                RequestRecompute(true);
            }
        }

        // ── Энгийн ──────────────────────────────────────────────────
        public string SimplePrefix { get { return _simplePrefix; } set { if (Set(ref _simplePrefix, value ?? string.Empty)) RequestRecompute(false); } }
        public string SimpleSuffix { get { return _simpleSuffix; } set { if (Set(ref _simpleSuffix, value ?? string.Empty)) RequestRecompute(false); } }
        public bool SimpleUseStart { get { return _simpleUseStart; } set { if (Set(ref _simpleUseStart, value)) { Raise("SimpleStartEnabled"); RequestRecompute(true); } } }
        public string SimpleStartText { get { return _simpleStartText; } set { if (Set(ref _simpleStartText, value ?? string.Empty)) RequestRecompute(false); } }
        public string SimpleWidthText { get { return _simpleWidthText; } set { if (Set(ref _simpleWidthText, value ?? string.Empty)) RequestRecompute(false); } }
        public bool SimpleStartEnabled => _simpleUseStart;

        // ── Нарийвчилсан: тусгаарлагч ───────────────────────────────
        public string Separator1 { get { return _separator1; } set { if (Set(ref _separator1, value ?? string.Empty)) RequestRecompute(false); } }
        public string Separator2 { get { return _separator2; } set { if (Set(ref _separator2, value ?? string.Empty)) RequestRecompute(false); } }

        // ── Одоогийн дугаарын тоон хэсгийг өөрчлөх ──────────────────
        public string ShiftValueText { get { return _shiftValueText; } set { if (Set(ref _shiftValueText, value ?? string.Empty)) RequestRecompute(false); } }

        public bool ShiftIncreaseOn
        {
            get { return _shiftInc; }
            set
            {
                if (!Set(ref _shiftInc, value))
                    return;
                if (value)
                {
                    _shiftDec = false;
                    Raise("ShiftDecreaseOn");
                    TurnOffOtherModes(shift: true);
                }
                AfterShiftToggle();
            }
        }

        public bool ShiftDecreaseOn
        {
            get { return _shiftDec; }
            set
            {
                if (!Set(ref _shiftDec, value))
                    return;
                if (value)
                {
                    _shiftInc = false;
                    Raise("ShiftIncreaseOn");
                    TurnOffOtherModes(shift: true);
                }
                AfterShiftToggle();
            }
        }

        private void AfterShiftToggle()
        {
            Settings.ShiftActive = _shiftInc || _shiftDec;
            RaiseModeProperties();
            RequestRecompute(true);
        }

        public IReadOnlyList<EnumOption<int>> ShiftTokenOptions { get; } = new[]
        {
            new EnumOption<int>(ExistingNumberShift.LastToken, "Сүүлийн тоон хэсэг"),
            new EnumOption<int>(0, "1-р тоон хэсэг"),
            new EnumOption<int>(1, "2-р тоон хэсэг"),
            new EnumOption<int>(2, "3-р тоон хэсэг"),
            new EnumOption<int>(3, "4-р тоон хэсэг"),
        };

        private EnumOption<int> _shiftToken;

        public EnumOption<int> ShiftToken
        {
            get { return _shiftToken; }
            set
            {
                if (value != null && Set(ref _shiftToken, value))
                {
                    Settings.ShiftTokenIndex = value.Value;
                    RequestRecompute(true);
                }
            }
        }

        // ── Параметрээс угтвар / дагавар ────────────────────────────
        private ParameterOption _prefixParam = ParameterOption.None;
        private ParameterOption _suffixParam = ParameterOption.None;
        private ParameterOption _resultParam = ParameterOption.None;
        private ParameterOption _countParam = ParameterOption.None;

        public IReadOnlyList<ParameterOption> SourceParameterOptions { get; private set; } = new[] { ParameterOption.None };
        public IReadOnlyList<ParameterOption> TargetParameterOptions { get; private set; } = new[] { ParameterOption.None };

        public bool UseParameterPrefix { get { return Settings.UseParameterPrefix; } set { Settings.UseParameterPrefix = value; Raise("UseParameterPrefix"); RequestRecompute(true); } }
        public bool UseParameterSuffix { get { return Settings.UseParameterSuffix; } set { Settings.UseParameterSuffix = value; Raise("UseParameterSuffix"); RequestRecompute(true); } }

        public ParameterOption PrefixParameter
        {
            get { return _prefixParam; }
            set { if (value != null && Set(ref _prefixParam, value)) { Settings.PrefixParameter = value.Key; RequestRecompute(true); } }
        }

        public ParameterOption SuffixParameter
        {
            get { return _suffixParam; }
            set { if (value != null && Set(ref _suffixParam, value)) { Settings.SuffixParameter = value.Key; RequestRecompute(true); } }
        }

        // ── Үр дүнг параметрт бичих ─────────────────────────────────
        public bool WriteResult { get { return Settings.WriteResultToParameter; } set { Settings.WriteResultToParameter = value; Raise("WriteResult"); RequestRecompute(true); } }

        public ParameterOption ResultParameter
        {
            get { return _resultParam; }
            set { if (value != null && Set(ref _resultParam, value)) { Settings.ResultParameter = value.Key; RequestRecompute(true); } }
        }

        private static readonly EnumOption<GeneratedValueSource>[] AllSources =
        {
            new EnumOption<GeneratedValueSource>(GeneratedValueSource.FullNumber, "Бүтэн дугаар"),
            new EnumOption<GeneratedValueSource>(GeneratedValueSource.Part1Full, "Хэсэг 1 (бүтэн)"),
            new EnumOption<GeneratedValueSource>(GeneratedValueSource.Part1Number, "Хэсэг 1 (тоон утга)"),
            new EnumOption<GeneratedValueSource>(GeneratedValueSource.Part2Full, "Хэсэг 2 (бүтэн)"),
            new EnumOption<GeneratedValueSource>(GeneratedValueSource.Part2Number, "Хэсэг 2 (тоон утга)"),
            new EnumOption<GeneratedValueSource>(GeneratedValueSource.Part3Full, "Хэсэг 3 (бүтэн)"),
            new EnumOption<GeneratedValueSource>(GeneratedValueSource.Part3Number, "Хэсэг 3 (тоон утга)"),
        };

        private IReadOnlyList<EnumOption<GeneratedValueSource>> _sourceOptions = AllSources;
        private EnumOption<GeneratedValueSource> _resultSource = AllSources[0];
        private EnumOption<GeneratedValueSource> _nameSource = AllSources[0];

        /// <summary>Ашиглаж болох эх сурвалжууд — горимоос хамаарна (Part N зөвхөн Нарийвчилсанд).</summary>
        public IReadOnlyList<EnumOption<GeneratedValueSource>> SourceOptions
        {
            get { return _sourceOptions; }
            private set { Set(ref _sourceOptions, value); }
        }

        public EnumOption<GeneratedValueSource> ResultSource
        {
            get { return _resultSource; }
            set { if (value != null && Set(ref _resultSource, value)) { Settings.ResultSource = value.Value; RequestRecompute(true); } }
        }

        public EnumOption<GeneratedValueSource> NameSource
        {
            get { return _nameSource; }
            set { if (value != null && Set(ref _nameSource, value)) { Settings.NameSource = value.Value; RequestRecompute(true); } }
        }

        // ── Бүлгийн хуудасны тоо ────────────────────────────────────
        public bool WriteGroupCount { get { return Settings.WriteGroupCount; } set { Settings.WriteGroupCount = value; Raise("WriteGroupCount"); RequestRecompute(true); } }

        public ParameterOption CountParameter
        {
            get { return _countParam; }
            set { if (value != null && Set(ref _countParam, value)) { Settings.CountParameter = value.Key; RequestRecompute(true); } }
        }

        public bool CountToFirst
        {
            get { return Settings.CountScope == CountWriteScope.FirstSheet; }
            set { if (value) { Settings.CountScope = CountWriteScope.FirstSheet; Raise("CountToFirst"); Raise("CountToAll"); RequestRecompute(true); } }
        }

        public bool CountToAll
        {
            get { return Settings.CountScope == CountWriteScope.AllSheets; }
            set { if (value) { Settings.CountScope = CountWriteScope.AllSheets; Raise("CountToFirst"); Raise("CountToAll"); RequestRecompute(true); } }
        }

        // ── Хуудасны нэрэнд дугаар ──────────────────────────────────
        public bool NameAtStart { get { return Settings.NameAtStart; } set { Settings.NameAtStart = value; Raise("NameAtStart"); RequestRecompute(true); } }
        public bool NameAtEnd { get { return Settings.NameAtEnd; } set { Settings.NameAtEnd = value; Raise("NameAtEnd"); RequestRecompute(true); } }
        public string NameSeparator { get { return _nameSeparator; } set { if (Set(ref _nameSeparator, value ?? string.Empty)) { Settings.NameSeparator = _nameSeparator; RequestRecompute(false); } } }

        // ── Сонгосон хуудаснаас эхлэх, зөөхөд дугаар дагах ──────────
        public bool StartFromSelected
        {
            get { return Settings.StartFromSelected; }
            set { Settings.StartFromSelected = value; Raise("StartFromSelected"); RequestRecompute(true); }
        }

        public bool MoveRenumber
        {
            get { return Settings.MoveRenumber; }
            set
            {
                if (value && !CanToggleMoveRenumber)
                {
                    Raise("MoveRenumber");
                    return;
                }
                if (Settings.MoveRenumber == value)
                    return;
                Settings.MoveRenumber = value;
                if (value)
                    TurnOffOtherModes(move: true);
                Raise("MoveRenumber");
                RaiseModeProperties();
                RequestRecompute(true);
            }
        }

        /// <summary>
        /// «Зөөхөд дугаар дагуулах»-ыг ЗӨВХӨН жагсаалтын дараалал анхных хэвээр (эсвэл аль хэдийн асаалттай) үед
        /// асаана.  Дараалал Move-гүйгээр зөөгдсөн бол: хэрэгжүүлэх эсвэл жагсаалтыг шинэчлэх хүртэл асахгүй.
        /// </summary>
        public bool CanToggleMoveRenumber
        {
            get { return !IsOrderDirty || Settings.MoveRenumber; }
        }

        private void TurnOffOtherModes(bool move = false, bool shift = false, bool clean = false)
        {
            if (!move && Settings.MoveRenumber)
            {
                Settings.MoveRenumber = false;
                Raise("MoveRenumber");
            }
            if (!shift && (_shiftInc || _shiftDec))
            {
                _shiftInc = false;
                _shiftDec = false;
                Settings.ShiftActive = false;
                Raise("ShiftIncreaseOn");
                Raise("ShiftDecreaseOn");
            }
            if (!clean && _cleanActive)
            {
                _cleanActive = false;
                Settings.CleanMarkers = false;
                Raise("CleanActive");
            }
        }

        // ── Үл үзэгдэх Unicode тэмдэг ───────────────────────────────
        private MarkerCapabilities _markerCaps;

        public MarkerCapabilities MarkerCaps
        {
            get { return _markerCaps; }
            private set { _markerCaps = value; Raise("MarkerCaps"); RebuildMarkerOptions(); }
        }

        public IReadOnlyList<EnumOption<char>> MarkerOptions { get; private set; } = new EnumOption<char>[0];

        /// <summary>
        /// ComboBox-ийн сонголт — ТЭМДЭГ ӨӨРӨӨР (<c>SelectedValue</c>), <see cref="EnumOption{T}"/> объектоор БИШ.
        /// Жагсаалт дахин байгуулагдах бүрд (probe, дахин идэвхжүүлэлт) объектууд шинэ болдог; `SelectedItem`-ээр холбоход
        /// WPF ComboBox хуучин объектыг барьсан хэвээр (SelectedIndex = -1) ХООСОН харагддаг (UiSmoke-д хэмжсэн).
        /// </summary>
        public char MarkerChar
        {
            get { return Settings.MarkerChar; }
            set
            {
                if (Settings.MarkerChar == value)
                    return;
                Settings.MarkerChar = value;
                Raise("MarkerChar");
                RequestRecompute(true);
            }
        }

        public bool UseMarkers
        {
            get { return Settings.UseUnicodeMarkers; }
            set
            {
                var _ = SetUseMarkersAsync(value);
            }
        }

        public string MarkerStatus
        {
            get
            {
                if (_markerCaps == null)
                    return string.Empty;
                if (!_markerCaps.IsProbed)
                    return _markerCaps.ProbeError ?? string.Empty;
                return "Revit хүлээн авсан: " + _markerCaps.Accepted.Count + " / " + UnicodeMarkerCatalog.Candidates.Count + " тэмдэг";
            }
        }

        private void RebuildMarkerOptions()
        {
            var list = new List<EnumOption<char>>();
            if (_markerCaps != null && _markerCaps.IsProbed)
            {
                foreach (MarkerCandidate c in UnicodeMarkerCatalog.Candidates)
                {
                    if (_markerCaps.IsAccepted(c.Char))
                        list.Add(new EnumOption<char>(c.Char, c.CodeText + "  " + c.Name));
                }
            }
            else
            {
                MarkerCandidate def = UnicodeMarkerCatalog.Find(Settings.MarkerChar) ?? UnicodeMarkerCatalog.Candidates[0];
                list.Add(new EnumOption<char>(def.Char, def.CodeText + "  " + def.Name + " (шалгаагүй)"));
            }
            MarkerOptions = list;
            Raise("MarkerOptions");
            Raise("MarkerChar");   // ComboBox шинэ жагсаалтаас тэмдгээр нь дахин сонгоно
            Raise("MarkerStatus");
        }

        private async Task SetUseMarkersAsync(bool on)
        {
            if (!on)
            {
                Settings.UseUnicodeMarkers = false;
                Raise("UseMarkers");
                RequestRecompute(true);
                return;
            }

            if (!Prefs.UnicodeWarningAccepted)
            {
                if (!_prompts.Confirm(Msg.ToolTitle, Msg.MarkerFirstUseWarning, false))
                {
                    Raise("UseMarkers");
                    return;
                }
                Prefs.UnicodeWarningAccepted = true;
                SaveSoon();
            }

            if (!await EnsureMarkerProbeAsync())
            {
                _prompts.ShowInfo(Msg.ToolTitle, _markerCaps != null && !string.IsNullOrEmpty(_markerCaps.ProbeError)
                    ? _markerCaps.ProbeError : Msg.MarkerNoneAvailable);
                Settings.UseUnicodeMarkers = false;
                Raise("UseMarkers");
                RequestRecompute(true);
                return;
            }

            Settings.MarkerChar = _markerCaps.Preferred(Settings.MarkerChar);
            Settings.UseUnicodeMarkers = true;
            RebuildMarkerOptions();
            Raise("UseMarkers");
            RequestRecompute(true);
        }

        /// <summary>Probe хийгдсэн (Revit хэрэглэх боломжтой тэмдэгтэй) эсэх.  Дутуу бол НЭГ удаа Revit-ээр шалгана.</summary>
        private async Task<bool> EnsureMarkerProbeAsync()
        {
            if (_markerCaps != null && _markerCaps.IsProbed)
                return _markerCaps.AnyAvailable;
            SetBusy(true, "Үл үзэгдэх тэмдэг Revit-д хадгалагдах эсэхийг шалгаж байна…");
            try
            {
                MarkerCaps = await _gateway.ProbeMarkersAsync();
            }
            catch (Exception ex)
            {
                MarkerCaps = new MarkerCapabilities { IsProbed = false, ProbeError = ex.Message };
            }
            finally
            {
                SetBusy(false, string.Empty);
            }
            return _markerCaps != null && _markerCaps.AnyAvailable;
        }

        /// <summary>Өмнөх сессээс «тэмдэг ашиглах» хадгалагдсан бол ачаалсны дараа probe-ийг дуусгана.</summary>
        private async Task ResumeMarkerProbeAsync()
        {
            if (!Settings.UseUnicodeMarkers || (_markerCaps != null && _markerCaps.IsProbed))
                return;
            bool ok = await EnsureMarkerProbeAsync();
            if (!ok)
            {
                Settings.UseUnicodeMarkers = false;
                Raise("UseMarkers");
            }
            else
            {
                Settings.MarkerChar = _markerCaps.Preferred(Settings.MarkerChar);
                RebuildMarkerOptions();
            }
            RequestRecompute(true);
        }

        // ── Хэвлэгддэггүй тэмдэг цэвэрлэх ───────────────────────────
        public bool CleanActive
        {
            get { return _cleanActive; }
            private set { if (Set(ref _cleanActive, value)) Settings.CleanMarkers = value; }
        }

        public bool CanCleanMarkers
        {
            get
            {
                return _currentGroup != null && !_busy && (_cleanActive || _currentGroup.Sheets.Any(s => UnicodeMarkers.ContainsMarker(s.Number)));
            }
        }

        private void ToggleCleanMarkers()
        {
            bool on = !_cleanActive;
            if (on && _currentGroup != null && !_currentGroup.Sheets.Any(s => UnicodeMarkers.ContainsMarker(s.Number)))
            {
                _prompts.ShowInfo(Msg.ToolTitle, Msg.CleanMarkersNothing);
                return;
            }
            CleanActive = on;
            if (on)
                TurnOffOtherModes(clean: true);
            RaiseModeProperties();
            Raise("CleanActive");   // ToggleButton-ыг VM-ийн бодит төлөвтэй дахин тааруулна
            RequestRecompute(true);
        }

        // ══════════════════════════════════════════════════════════════
        //  Горимоос хамаарах идэвхжилт
        // ══════════════════════════════════════════════════════════════
        public bool IsGeneratingMode
        {
            get
            {
                EffectiveMode m = Settings.EffectiveMode;
                return m == EffectiveMode.Simple || m == EffectiveMode.Advanced;
            }
        }

        /// <summary>Энгийн/Нарийвчилсан дугаарлалтын талбарууд идэвхтэй (Move, Shift, Clean үед идэвхгүй).</summary>
        public bool NumberingControlsEnabled => IsGeneratingMode && !_busy;

        public bool ShiftControlsEnabled => !Settings.MoveRenumber && !_cleanActive && !_busy;
        public bool ExtrasEnabled => !_cleanActive && !_busy;
        public bool StartFromSelectedEnabled => !Settings.MoveRenumber && !_cleanActive && !_busy;

        public string ModeHint
        {
            get
            {
                switch (Settings.EffectiveMode)
                {
                    case EffectiveMode.Move:
                        return "Зөөхөд дугаарыг дагуулж шинэчилж байна — хуудас бүр өөрийн байрлалын дугаарыг авна. Доорх дугаарлалтын тохиргоо идэвхгүй.";
                    case EffectiveMode.Shift:
                        return "Одоогийн дугаарын тоон хэсгийг "
                            + (Settings.ShiftDirection >= 0 ? "+" : "−") + Settings.ShiftAmount + "-аар өөрчилж байна.";
                    case EffectiveMode.CleanMarkers:
                        return "Хэвлэгддэггүй Unicode тэмдгийг дугаараас цэвэрлэж байна.";
                    default:
                        return string.Empty;
                }
            }
        }

        public bool HasModeHint => !string.IsNullOrEmpty(ModeHint);

        private void RaiseModeProperties()
        {
            RefreshSourceOptions();
            Raise("IsGeneratingMode");
            Raise("NumberingControlsEnabled");
            Raise("ShiftControlsEnabled");
            Raise("ExtrasEnabled");
            Raise("StartFromSelectedEnabled");
            Raise("ModeHint");
            Raise("HasModeHint");
            Raise("MoveRenumber");
            Raise("CanToggleMoveRenumber");
        }

        private void RefreshSourceOptions()
        {
            EffectiveMode mode = Settings.EffectiveMode;
            List<EnumOption<GeneratedValueSource>> allowed = AllSources.Where(o => SettingsValidator.IsSourceAllowed(o.Value, mode)).ToList();
            if (_sourceOptions.Count != allowed.Count || !_sourceOptions.SequenceEqual(allowed))
            {
                SourceOptions = allowed;
                if (!allowed.Contains(_resultSource))
                {
                    _resultSource = AllSources[0];
                    Settings.ResultSource = GeneratedValueSource.FullNumber;
                    Raise("ResultSource");
                }
                if (!allowed.Contains(_nameSource))
                {
                    _nameSource = AllSources[0];
                    Settings.NameSource = GeneratedValueSource.FullNumber;
                    Raise("NameSource");
                }
            }
        }

        // ══════════════════════════════════════════════════════════════
        //  Талбар ↔ модель
        // ══════════════════════════════════════════════════════════════
        private void InitSettingsProxies()
        {
            // Бүх талбар LoadFieldsFromSettings-д.
        }

        /// <summary>Settings → цонхны талбарууд (анх эхлэхэд).</summary>
        private void LoadFieldsFromSettings()
        {
            RenumberSettings s = Settings;
            _simplePrefix = s.Simple.Prefix;
            _simpleSuffix = s.Simple.Suffix;
            _simpleUseStart = s.Simple.UseStartNumber;
            _simpleStartText = s.Simple.Start.ToString(CultureInfo.InvariantCulture);
            _simpleWidthText = s.Simple.Width.ToString(CultureInfo.InvariantCulture);
            _separator1 = s.Advanced.Separators[0];
            _separator2 = s.Advanced.Separators[1];
            _nameSeparator = s.NameSeparator;
            _shiftValueText = (s.ShiftAmount >= 0 ? "+" : "") + s.ShiftAmount.ToString(CultureInfo.InvariantCulture);
            _shiftToken = ShiftTokenOptions.FirstOrDefault(o => o.Value == s.ShiftTokenIndex) ?? ShiftTokenOptions[0];
            _shiftInc = false;
            _shiftDec = false;
            _cleanActive = false;
            for (int i = 0; i < AdvancedNumberingSettings.PartCount; i++)
                Parts[i].LoadFrom(s.Advanced.Parts[i]);
            _resultSource = AllSources.First(o => o.Value == s.ResultSource);
            _nameSource = AllSources.First(o => o.Value == s.NameSource);
            RebuildMarkerOptions();
            Raise(string.Empty);
        }

        /// <summary>Цонхны талбарууд → <see cref="Settings"/>.  Задрахгүй текст нь <see cref="_parseErrors"/>-д.</summary>
        private void SyncFromFields()
        {
            _parseErrors.Clear();
            RenumberSettings s = Settings;

            s.Simple.Prefix = _simplePrefix;
            s.Simple.Suffix = _simpleSuffix;
            s.Simple.UseStartNumber = _simpleUseStart;
            if (_simpleUseStart)
                s.Simple.Start = ParseLong("simple.start", _simpleStartText, s.Simple.Start);
            s.Simple.Width = ParseInt("simple.width", _simpleWidthText, s.Simple.Width);

            s.Advanced.Separators[0] = _separator1;
            s.Advanced.Separators[1] = _separator2;
            PartViewModel[] parts = Parts;
            for (int i = 0; i < parts.Length; i++)
            {
                PartViewModel pv = parts[i];
                NumberPartSettings p = s.Advanced.Parts[i];
                string f = "part" + (i + 1) + ".";
                p.Enabled = pv.Enabled;
                p.Prefix = pv.Prefix;
                p.Suffix = pv.Suffix;
                p.ValueMode = pv.ValueMode.Value;
                if (pv.Enabled && pv.HasNumber)
                {
                    p.Start = ParseLong(f + "start", pv.StartText, p.Start);
                    p.Width = ParseInt(f + "width", pv.WidthText, p.Width);
                }
                if (pv.Enabled && pv.IsAdvancing)
                {
                    p.Step = ParseLong(f + "step", pv.StepText, p.Step);
                    p.WrapAtLimit = pv.Wrap;
                    if (string.IsNullOrWhiteSpace(pv.LimitText))
                    {
                        p.Limit = null;
                    }
                    else
                    {
                        long lim;
                        if (NumberFormatting.TryParse(pv.LimitText, out lim))
                            p.Limit = lim;
                        else
                            _parseErrors[f + "limit"] = Msg.ValueOutOfRange;
                    }
                }
            }

            s.NameSeparator = _nameSeparator;

            s.ShiftActive = _shiftInc || _shiftDec;
            s.ShiftDirection = _shiftInc ? 1 : -1;
            if (s.ShiftActive)
            {
                long amount = ParseLong("shift.amount", _shiftValueText, s.ShiftAmount);
                s.ShiftAmount = Math.Abs(amount);
            }
            s.ShiftTokenIndex = _shiftToken != null ? _shiftToken.Value : ExistingNumberShift.LastToken;
            s.CleanMarkers = _cleanActive;
        }

        private long ParseLong(string field, string text, long fallback)
        {
            long v;
            if (NumberFormatting.TryParse(text, out v))
                return v;
            _parseErrors[field] = "Бүхэл тоо оруулна уу (хэт том утга зөвшөөрөгдөхгүй).";
            return fallback;
        }

        private int ParseInt(string field, string text, int fallback)
        {
            long v;
            if (NumberFormatting.TryParse(text, out v) && v >= 0 && v <= int.MaxValue)
                return (int)v;
            _parseErrors[field] = "0 эсвэл эерэг бүхэл тоо оруулна уу.";
            return fallback;
        }

        // ══════════════════════════════════════════════════════════════
        //  Параметрийн каталог
        // ══════════════════════════════════════════════════════════════
        private void RebuildOptionLists()
        {
            var all = new List<ParameterOption> { ParameterOption.None };
            var targets = new List<ParameterOption> { ParameterOption.None };
            foreach (SheetParameterInfo info in _snapshot.ParameterCatalog)
            {
                var opt = new ParameterOption(info);
                all.Add(opt);
                if (info.IsWritable)
                    targets.Add(opt);
            }
            SourceParameterOptions = all;
            TargetParameterOptions = targets;
            Raise("SourceParameterOptions");
            Raise("TargetParameterOptions");

            _prefixParam = Match(all, Settings.PrefixParameter);
            _suffixParam = Match(all, Settings.SuffixParameter);
            _resultParam = Match(targets, Settings.ResultParameter);
            _countParam = Match(targets, Settings.CountParameter);
            Raise("PrefixParameter");
            Raise("SuffixParameter");
            Raise("ResultParameter");
            Raise("CountParameter");
        }

        private static ParameterOption Match(IReadOnlyList<ParameterOption> options, ParameterKey key)
        {
            if (key == null)
                return ParameterOption.None;
            foreach (ParameterOption o in options)
            {
                if (o.Key != null && o.Key.Equals(key))
                    return o;
            }
            return ParameterOption.None;
        }

        /// <summary>
        /// Хадгалагдсан параметр энэ төсөлд ОЛДОХГҮЙ бол сонголтыг ЦЭВЭРЛЭНЭ (асаасан туг хамт унтарна) —
        /// эхлэхэд exception, «параметр олдсонгүй» гэсэн тогтмол алдаа гарахгүй.
        /// </summary>
        private void ReconcileSettingsWithCatalog()
        {
            RenumberSettings s = Settings;
            if (s.PrefixParameter != null && _snapshot.FindParameter(s.PrefixParameter) == null)
            {
                s.PrefixParameter = null;
                s.UseParameterPrefix = false;
            }
            if (s.SuffixParameter != null && _snapshot.FindParameter(s.SuffixParameter) == null)
            {
                s.SuffixParameter = null;
                s.UseParameterSuffix = false;
            }
            SheetParameterInfo ri = s.ResultParameter != null ? _snapshot.FindParameter(s.ResultParameter) : null;
            if (s.ResultParameter != null && (ri == null || !ri.IsWritable))
            {
                s.ResultParameter = null;
                s.WriteResultToParameter = false;
            }
            SheetParameterInfo ci = s.CountParameter != null ? _snapshot.FindParameter(s.CountParameter) : null;
            if (s.CountParameter != null && (ci == null || !ci.IsWritable))
            {
                s.CountParameter = null;
                s.WriteGroupCount = false;
            }
            Raise("UseParameterPrefix");
            Raise("UseParameterSuffix");
            Raise("WriteResult");
            Raise("WriteGroupCount");
        }
    }
}
