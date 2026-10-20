using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Media;
using System.Windows.Threading;
using RevitMcpAddin.Intelligence.Contracts;
using RevitMcpAddin.Intelligence.Core;
using RevitMcpAddin.Intelligence.Revit;

namespace RevitMcpAddin.Intelligence.Ui
{
    /* ================================================================== */
    /*  VIEWMODELS (§16–17, R-1) — хостын үйл явдал → WPF (Dispatcher)       */
    /*                                                                    */
    /*  Хост арын thread дээр дохио өгнө; энд ЗӨВХӨН уншиж, Dispatcher-ээр  */
    /*  UI thread рүү marshal хийнэ.  Revit-ийн API ЭНД ХЭЗЭЭ Ч БАЙХГҮЙ.     */
    /* ================================================================== */

    public abstract class VmBase : INotifyPropertyChanged
    {
        public event PropertyChangedEventHandler PropertyChanged;
        protected void Set<T>(ref T field, T value, [CallerMemberName] string name = null)
        {
            if (EqualityComparer<T>.Default.Equals(field, value)) return;
            field = value;
            Raise(name);
        }
        protected void Raise(string name)
        {
            PropertyChangedEventHandler h = PropertyChanged;
            if (h != null) h(this, new PropertyChangedEventArgs(name));
        }
    }

    public sealed class KeyValueRow
    {
        public string Key { get; set; }
        public string Value { get; set; }
        public Brush ValueBrush { get; set; }
    }

    /// <summary>Нэг сонгосон элементийн карт — детерминист мөрүүд, таамаггүй.</summary>
    public sealed class ElementCardVm
    {
        public long ElementId { get; set; }
        public string Title { get; set; }
        public string Sub { get; set; }
        public ObservableCollection<KeyValueRow> Rows { get; } = new ObservableCollection<KeyValueRow>();

        public static ElementCardVm From(RevitElementSummary e)
        {
            var c = new ElementCardVm { ElementId = e.ElementId };
            c.Title = (e.Category ?? e.Kind.ToString()) + " #" + e.ElementId;
            string fam = string.IsNullOrEmpty(e.Family) ? "" : e.Family + " : ";
            c.Sub = fam + (e.Type ?? e.Name ?? "—");
            if (e.Level != null) c.Rows.Add(new KeyValueRow { Key = "Давхар", Value = e.Level });
            if (e.PhaseCreated != null) c.Rows.Add(new KeyValueRow { Key = "Үе шат", Value = e.PhaseCreated });
            if (e.Host != null) c.Rows.Add(new KeyValueRow { Key = "Хост", Value = (e.Host.Category ?? "") + " #" + e.Host.ElementId });
            foreach (Measure m in e.Dimensions) c.Rows.Add(new KeyValueRow { Key = LabelMn(m.Name), Value = UnitsBoundary.Format(m) + SourceTag(m) });
            if (e.Rooms != null)
            {
                if (e.Rooms.FromRoom != null) c.Rows.Add(new KeyValueRow { Key = "Өрөөнөөс", Value = e.Rooms.FromRoom.Name ?? ("#" + e.Rooms.FromRoom.ElementId) });
                if (e.Rooms.ToRoom != null) c.Rows.Add(new KeyValueRow { Key = "Өрөө рүү", Value = e.Rooms.ToRoom.Name ?? ("#" + e.Rooms.ToRoom.ElementId) });
                if (e.Rooms.InRoom != null) c.Rows.Add(new KeyValueRow { Key = "Өрөөнд", Value = e.Rooms.InRoom.Name ?? ("#" + e.Rooms.InRoom.ElementId) });
            }
            if (e.Worksharing != null)
            {
                string ed = e.Worksharing.Editable == null ? "мэдэхгүй" : (e.Worksharing.Editable.Value ? "тийм" : "үгүй");
                string own = OwnershipMn(e.Worksharing.Ownership);
                c.Rows.Add(new KeyValueRow { Key = "Засварлах", Value = ed + (own != null ? " · " + own : "") + (e.Worksharing.Pinned ? " · бэхэлсэн" : "") });
                if (e.Worksharing.Workset != null) c.Rows.Add(new KeyValueRow { Key = "Workset", Value = e.Worksharing.Workset });
            }
            if (e.Scope == ElementScope.LINKED_DOCUMENT) c.Rows.Add(new KeyValueRow { Key = "Хамрах", Value = "ХОЛБОСОН баримт (бичихгүй)" });
            foreach (RevitParamValue p in e.Params)
            {
                if (p.Measure != null && p.Measure.Unit != Units.None) continue; // хэмжээсээр аль хэдийн харуулсан
                if (string.IsNullOrEmpty(p.Value)) continue;
                c.Rows.Add(new KeyValueRow { Key = p.Name + (p.IsTypeParam ? " (T)" : ""), Value = p.Value });
            }
            if (e.Materials.Count > 0) c.Rows.Add(new KeyValueRow { Key = "Материал", Value = string.Join(", ", e.Materials) });
            foreach (string w in e.Warnings) c.Rows.Add(new KeyValueRow { Key = "⚠", Value = w });
            return c;
        }

        private static string SourceTag(Measure m)
        {
            switch (m.Source)
            {
                case MeasureSource.BUILTIN_GEOMETRY: return "";
                case MeasureSource.TYPED_PARAM: return "";
                case MeasureSource.UNTYPED_PARAM: return " (нэгжгүй параметр)";
                default: return " (тооцсон)";
            }
        }

        internal static string LabelMn(string name)
        {
            switch (name)
            {
                case "width_mm": return "Өргөн";
                case "length_mm": return "Урт";
                case "height_mm": return "Өндөр";
                case "thickness_mm": return "Зузаан";
                case "area_m2": return "Талбай";
                case "volume_m3": return "Эзлэхүүн";
                case "perimeter_mm": return "Периметр";
                case "unbounded_height_mm": return "Өндөр (хязгааргүй)";
                case "elevation_mm": return "Түвшин";
                case "head_height_mm": return "Дээд өндөр";
                case "sill_height_mm": return "Доод өндөр";
                case "bbox_x_mm": return "Хэмжээ X";
                case "bbox_y_mm": return "Хэмжээ Y";
                case "bbox_z_mm": return "Хэмжээ Z";
                default: return name;
            }
        }

        internal static string OwnershipMn(ElementOwnership o)
        {
            switch (o)
            {
                case ElementOwnership.NOT_WORKSHARED: return null;
                case ElementOwnership.OWNED_BY_CURRENT_USER: return "би эзэмшиж байна";
                case ElementOwnership.OWNED_BY_OTHER_USER: return "өөр хүн эзэмшиж байна";
                case ElementOwnership.NOT_OWNED: return "эзэмшигчгүй";
                default: return "эзэмшил тодорхойгүй";
            }
        }
    }

    public sealed class ContextVm : VmBase
    {
        private string _state, _stateDetail, _timing, _linkText, _linkHint;
        private bool _linkConfirmed, _showSuggestions;
        public string State { get { return _state; } set { Set(ref _state, value); } }
        public string StateDetail { get { return _stateDetail; } set { Set(ref _stateDetail, value); } }
        public string Timing { get { return _timing; } set { Set(ref _timing, value); } }
        public string LinkText { get { return _linkText; } set { Set(ref _linkText, value); } }
        public string LinkHint { get { return _linkHint; } set { Set(ref _linkHint, value); } }
        public bool LinkConfirmed { get { return _linkConfirmed; } set { Set(ref _linkConfirmed, value); } }
        public bool ShowSuggestions { get { return _showSuggestions; } set { Set(ref _showSuggestions, value); } }
        public ObservableCollection<KeyValueRow> Document { get; } = new ObservableCollection<KeyValueRow>();
        public ObservableCollection<KeyValueRow> View { get; } = new ObservableCollection<KeyValueRow>();
        public ObservableCollection<ElementCardVm> Selection { get; } = new ObservableCollection<ElementCardVm>();
        public ObservableCollection<ProjectLinkSuggestion> Suggestions { get; } = new ObservableCollection<ProjectLinkSuggestion>();
        public ProjectLinkSuggestion PickedSuggestion { get; set; }
    }

    public sealed class TaskRowVm
    {
        public RevitTaskItem Task { get; set; }
        public string Label { get { return Task.Title + (Task.ChecklistTotal > 0 ? "  (" + Task.ChecklistDone + "/" + Task.ChecklistTotal + ")" : ""); } }
    }

    public sealed class TasksVm : VmBase
    {
        private string _status, _interpretation, _candidates, _navigation;
        private TaskRowVm _selected;
        private int _index = -1;
        public string Status { get { return _status; } set { Set(ref _status, value); } }
        public string Interpretation { get { return _interpretation; } set { Set(ref _interpretation, value); } }
        public string Candidates { get { return _candidates; } set { Set(ref _candidates, value); } }
        public string Navigation { get { return _navigation; } set { Set(ref _navigation, value); } }
        public TaskRowVm Selected { get { return _selected; } set { Set(ref _selected, value); } }
        public int Index { get { return _index; } set { Set(ref _index, value); } }
        public ObservableCollection<TaskRowVm> Tasks { get; } = new ObservableCollection<TaskRowVm>();
        public TaskCandidateSet CandidateSet { get; set; }
    }

    public sealed class IssueRowVm
    {
        public RevitComplianceIssue Issue { get; set; }
        public string Title { get { return Issue.TitleMn; } }
        public string Detail { get { return Issue.DetailMn; } }
        public string ClassLabel
        {
            get
            {
                switch (Issue.Class)
                {
                    case IssueClass.VERIFIED_NORM: return "БАТАЛГААЖСАН НОРМ";
                    case IssueClass.MODEL_QUALITY: return "ЗАГВАРЫН ЧАНАР";
                    default: return "ХҮНИЙ ХЯНАЛТ";
                }
            }
        }
        public string SourceLabel
        {
            get
            {
                if (Issue.Source == null) return "";
                if (Issue.Source.Kind == RuleSourceKind.VERIFIED_NORM) return (Issue.Source.DocumentCode ?? "") + (Issue.Source.Clause != null ? " · " + Issue.Source.Clause : "");
                return Issue.Source.LabelMn ?? Issue.Source.Kind.ToString();
            }
        }
        public string Severity { get { return Issue.Severity.ToString(); } }
        /// <summary>«Danger» | «Warn» | «Muted» — XAML-ийн DataTrigger токен өнгө (Danger/Warn/LineStrong) сонгоно.  Нэрлэсэн WPF brush (IndianRed…) Light/өндөр контрастад дагахгүй байв.</summary>
        public string ClassKey
        {
            get
            {
                switch (Issue.Class)
                {
                    case IssueClass.VERIFIED_NORM: return "Danger";
                    case IssueClass.MODEL_QUALITY: return "Warn";
                    default: return "Muted";
                }
            }
        }
        public long FirstElementId { get { return Issue.ElementIds.Count > 0 ? Issue.ElementIds[0] : 0; } }
    }

    public sealed class IssuesVm : VmBase
    {
        private string _status, _explanation;
        public string Status { get { return _status; } set { Set(ref _status, value); } }
        public string Explanation { get { return _explanation; } set { Set(ref _explanation, value); } }
        public ObservableCollection<IssueRowVm> Issues { get; } = new ObservableCollection<IssueRowVm>();
    }

    public sealed class ReportsVm : VmBase
    {
        private string _text, _status;
        private int _periodIndex, _audienceIndex;
        public string Text { get { return _text; } set { Set(ref _text, value); } }
        public string Status { get { return _status; } set { Set(ref _status, value); } }
        public int PeriodIndex { get { return _periodIndex; } set { Set(ref _periodIndex, value); } }
        public int AudienceIndex { get { return _audienceIndex; } set { Set(ref _audienceIndex, value); } }
        public RevitReport Last { get; set; }
    }

    /// <summary>DEV / TEST — синтетик тест загварын товчнууд (NON-PRODUCTION).</summary>
    public sealed class DevVm : VmBase
    {
        private string _status, _gate;
        private bool _busy, _noDocument, _isTest;
        public string Status { get { return _status; } set { Set(ref _status, value); } }
        public string Gate { get { return _gate; } set { Set(ref _gate, value); } }
        public bool Busy { get { return _busy; } set { Set(ref _busy, value); } }
        public bool NoDocument { get { return _noDocument; } set { Set(ref _noDocument, value); } }
        public bool IsTestDoc { get { return _isTest; } set { Set(ref _isTest, value); } }
    }

    public sealed class AiVm : VmBase
    {
        private string _status, _answer, _question, _proposalValue, _proposalText, _proposalResult;
        private bool _busy, _canPropose = true, _hasPreview, _canApply;
        public string Status { get { return _status; } set { Set(ref _status, value); } }
        public string Answer { get { return _answer; } set { Set(ref _answer, value); } }
        public string Question { get { return _question; } set { Set(ref _question, value); } }
        public bool Busy { get { return _busy; } set { Set(ref _busy, value); } }
        /* R4.1 CONFIRM_WRITE */
        public string ProposalValue { get { return _proposalValue; } set { Set(ref _proposalValue, value); } }
        public string ProposalText { get { return _proposalText; } set { Set(ref _proposalText, value); } }
        public string ProposalResult { get { return _proposalResult; } set { Set(ref _proposalResult, value); } }
        public bool CanPropose { get { return _canPropose; } set { Set(ref _canPropose, value); } }
        public bool HasPreview { get { return _hasPreview; } set { Set(ref _hasPreview, value); } }
        /// <summary>Apply ЗӨВХӨН шалгалт тэнцсэн, хэрэглэгдээгүй preview дээр — баталгааны цорын ганц эх (§20).</summary>
        public bool CanApply { get { return _canApply; } set { Set(ref _canApply, value); } }
        public ActionPreview Preview;
    }

    /// <summary>Үндэс — хостын үйл явдлыг сонсож, UI thread дээр таван дэд VM-ийг шинэчилнэ.</summary>
    internal sealed class IntelligenceViewModel : VmBase
    {
        private readonly Dispatcher _ui;
        private readonly RevitIntelligenceHost _host;
        private string _banner;
        public ContextVm Context { get; } = new ContextVm();
        public TasksVm Tasks { get; } = new TasksVm();
        public IssuesVm Issues { get; } = new IssuesVm();
        public ReportsVm Reports { get; } = new ReportsVm();
        public AiVm Ai { get; } = new AiVm();
        public DevVm Dev { get; } = new DevVm();
        public string Banner { get { return _banner; } set { Set(ref _banner, value); } }

        public IntelligenceViewModel(RevitIntelligenceHost host, Dispatcher ui)
        {
            _host = host;
            _ui = ui;
            if (host == null)
            {
                Banner = "Intelligence хост эхлээгүй (App.OnStartup).";
                return;
            }
            host.ContextChanged += () => Post(RefreshContext);
            host.TasksChanged += () => Post(RefreshTasks);
            host.IssuesChanged += () => Post(RefreshIssues);
            host.GraphChanged += () => Post(RefreshGraphLine);
            host.Status += s => Post(() => Banner = s);
            Post(RefreshContext); Post(RefreshTasks); Post(RefreshIssues);
            Task.Run(host.ProbeRuntimeAsync);
        }

        private void Post(Action a)
        {
            if (_ui == null) { try { a(); } catch { } return; }
            _ui.BeginInvoke(DispatcherPriority.Background, new Action(() => { try { a(); } catch (Exception ex) { Banner = ex.GetType().Name + ": " + ex.Message; } }));
        }

        /* ---------------- Контекст ---------------- */

        private void RefreshContext()
        {
            RevitContextSnapshot s = _host.Current;
            ContextVm c = Context;
            c.Document.Clear(); c.View.Clear(); c.Selection.Clear();
            if (s == null) { c.State = "Контекст хараахан уншаагүй"; c.StateDetail = "Revit-д баримт нээж, элемент сонгоно уу."; Dev.NoDocument = true; Dev.Gate = "Revit-д төсөл нээгээгүй байна."; return; }
            Dev.NoDocument = s.State == RevitErrorState.NO_DOCUMENT || s.Document == null;
            Dev.IsTestDoc = s.Document != null && s.Document.IsTestFixture;
            if (Dev.NoDocument) Dev.Gate = "Revit-д төсөл нээгээгүй байна.";
            else if (Dev.IsTestDoc) Dev.Gate = "Энэ баримт MGL-AI-TEST тэмдэгтэй — синтетик тест (NON-PRODUCTION).";
            else Dev.Gate = "Тест загварыг ЗӨВХӨН хоосон, хадгалаагүй төсөлд үүсгэнэ; агуулгатай баримтад ТАТГАЛЗАНА.";
            c.State = StateMn(s.State);
            c.StateDetail = s.State == RevitErrorState.OK || s.State == RevitErrorState.NO_SELECTION ? null : s.State.ToString();
            if (s.Document != null)
            {
                RevitDocumentContext d = s.Document;
                c.Document.Add(new KeyValueRow { Key = "Файл", Value = d.FileName ?? d.Title });
                c.Document.Add(new KeyValueRow { Key = "Revit", Value = d.RevitVersion ?? "?" });
                if (d.ProjectName != null) c.Document.Add(new KeyValueRow { Key = "Төслийн нэр (Revit)", Value = d.ProjectName });
                if (d.ProjectNumber != null) c.Document.Add(new KeyValueRow { Key = "Төслийн дугаар", Value = d.ProjectNumber });
                c.Document.Add(new KeyValueRow { Key = "Worksharing", Value = WorksharingMn(d) });
                if (d.ActivePhase != null) c.Document.Add(new KeyValueRow { Key = "Үе шат", Value = d.ActivePhase });
                if (d.ActiveDesignOption != null) c.Document.Add(new KeyValueRow { Key = "Design option", Value = d.ActiveDesignOption });
                if (d.LinkCount > 0) c.Document.Add(new KeyValueRow { Key = "Холбосон загвар", Value = d.LinkCount.ToString() });
                if (s.WarningCount != null && s.WarningCount > 0) c.Document.Add(new KeyValueRow { Key = "Revit анхааруулга", Value = s.WarningCount.ToString() });
                c.Document.Add(new KeyValueRow { Key = "Түлхүүр", Value = d.DocKey, ValueBrush = Brushes.Gray });
            }
            if (s.ActiveView != null)
            {
                RevitViewContext v = s.ActiveView;
                c.View.Add(new KeyValueRow { Key = "Харагдац", Value = v.Name });
                c.View.Add(new KeyValueRow { Key = "Төрөл", Value = v.ViewType + (v.SheetNumber != null ? " · " + v.SheetNumber : "") });
                if (v.Level != null) c.View.Add(new KeyValueRow { Key = "Давхар", Value = v.Level });
                if (v.Scale != null) c.View.Add(new KeyValueRow { Key = "Масштаб", Value = "1:" + v.Scale });
                if (v.Phase != null) c.View.Add(new KeyValueRow { Key = "Үе шат", Value = v.Phase });
                if (v.Discipline != null) c.View.Add(new KeyValueRow { Key = "Салбар", Value = v.Discipline + (v.DetailLevel != null ? " · " + v.DetailLevel : "") });
                if (v.TemplateName != null) c.View.Add(new KeyValueRow { Key = "Загвар (template)", Value = v.TemplateName });
                if (v.IsCropped == true) c.View.Add(new KeyValueRow { Key = "Crop", Value = "идэвхтэй" });
            }
            foreach (RevitElementSummary e in s.Selection) c.Selection.Add(ElementCardVm.From(e));
            if (s.SelectionTotal > s.Selection.Count)
            {
                c.Selection.Add(new ElementCardVm { Title = "… бас " + (s.SelectionTotal - s.Selection.Count) + " элемент", Sub = "хураангуйд ороогүй (дээд " + s.Selection.Count + ")" });
            }
            RefreshLink(s.ProjectLink);
            RefreshGraphLine();
        }

        private void RefreshLink(RevitProjectLink l)
        {
            ContextVm c = Context;
            c.Suggestions.Clear();
            c.LinkConfirmed = l != null && l.State == ProjectLinkState.CONFIRMED;
            c.ShowSuggestions = false;
            if (l == null) { c.LinkText = "ERP төсөл: тодорхойгүй"; c.LinkHint = null; return; }
            switch (l.State)
            {
                case ProjectLinkState.CONFIRMED:
                    c.LinkText = "ERP төсөл: " + (l.ProjectName ?? ("#" + l.ProjectId)) + " ✓";
                    c.LinkHint = l.ConfirmedBy == "USER_CONFIRMED" ? "хэрэглэгч баталгаажуулсан" : "сервер бүртгэлээр";
                    break;
                case ProjectLinkState.SUGGESTED:
                    c.LinkText = "ERP төсөл: БАТАЛГААЖААГҮЙ — санал байна";
                    c.LinkHint = "Таамаг нь холбоос БИШ. Аль төсөл болохыг сонгоод «Баталгаажуулах» дарна.";
                    foreach (ProjectLinkSuggestion sg in l.Suggestions) c.Suggestions.Add(sg);
                    c.ShowSuggestions = true;
                    break;
                case ProjectLinkState.ERP_OFFLINE:
                    c.LinkText = "ERP төсөл: ERP OFFLINE"; c.LinkHint = "Сервер хүрэхгүй эсвэл нэвтрээгүй — Тохиргоо."; break;
                case ProjectLinkState.UNLINKED:
                    c.LinkText = "ERP төсөл: холбоогүй"; c.LinkHint = "Тохиргооноос төсөл сонгоно уу."; break;
                default:
                    c.LinkText = "ERP төсөл: тодорхойгүй"; c.LinkHint = null; break;
            }
        }

        private void RefreshGraphLine()
        {
            SceneGraphStore g = _host.CurrentGraph;
            MglAiRuntimeStatusText();
            Context.Timing = (g == null ? "граф: —" : "граф: " + g.NodeCount + " зангилаа · " + g.EdgeCount + " ирмэг · v" + g.Version)
                + " · сонголт " + _host.LastSnapshotMs + " мс (нийт " + _host.LastSnapshotRoundTripMs + ")"
                + (_host.LastRefreshMs > 0 ? " · шинэчлэл " + _host.LastRefreshMs + " мс" : "")
                + (_host.LastEvaluateMs > 0 ? " · үнэлгээ " + _host.LastEvaluateMs + " мс" : "");
        }

        private void MglAiRuntimeStatusText()
        {
            var rt = _host.Runtime;
            RuleProviderResult rules = _host.Rules;
            string r = rules == null ? "дүрэм: —" : (rules.Status == RuleProviderStatus.OK ? "дүрэм: " + rules.Rules.Count + " (" + rules.Note + ")" : "дүрэм: " + rules.Status);
            string ai = rt == null ? "MGL AI runtime: шалгаж байна…" : (rt.Reachable ? "MGL AI runtime: амьд" + (rt.Model != null ? " · " + rt.Model : "") : "MGL AI runtime: OFFLINE (" + (rt.Error ?? "") + ")");
            Ai.Status = ai + " · холболт: " + _host.Ai.Binding + " · " + r;
        }

        /* ---------------- Даалгавар ---------------- */

        private void RefreshTasks()
        {
            RevitTaskContext t = _host.CurrentTasks;
            TasksVm v = Tasks;
            v.Tasks.Clear();
            if (t == null) { v.Status = "Даалгавар уншаагүй"; return; }
            switch (t.Status)
            {
                case TaskContextStatus.OK: v.Status = t.Tasks.Count + " даалгавар" + (t.FromCache ? " (кэш " + t.FetchedAt + ")" : ""); break;
                case TaskContextStatus.NO_TASKS: v.Status = "Энэ төсөлд танд хуваарилагдсан даалгавар алга"; break;
                case TaskContextStatus.ERP_OFFLINE: v.Status = "ERP OFFLINE" + (t.FromCache ? " — кэшлэгдсэн жагсаалт (" + t.FetchedAt + ")" : "") + (t.Error != null ? " · " + t.Error : ""); break;
                case TaskContextStatus.AUTH_REQUIRED: v.Status = "Нэвтрэлт шаардлагатай (MGL → Тохиргоо)"; break;
                case TaskContextStatus.PROJECT_NOT_LINKED: v.Status = "ERP төсөл баталгаажаагүй — Контекст таб"; break;
            }
            foreach (RevitTaskItem it in t.Tasks) v.Tasks.Add(new TaskRowVm { Task = it });
        }

        public void SelectTask(TaskRowVm row)
        {
            TasksVm v = Tasks;
            v.Selected = row;
            v.Index = -1;
            v.Navigation = null;
            if (row == null) { v.Interpretation = null; v.Candidates = null; v.CandidateSet = null; return; }
            RevitTaskInterpretation interp;
            TaskCandidateSet set = _host.SelectTask(row.Task, out interp);
            v.CandidateSet = set;
            var sb = new System.Text.StringBuilder();
            sb.Append("TASK_INTERPRETATION (").Append(interp.Confidence).Append(", ").Append(interp.Intent).Append("): ");
            if (interp.TargetKinds.Count > 0) sb.Append(string.Join("/", interp.TargetKinds));
            else sb.Append("BIM төрөл танигдсангүй");
            if (interp.TargetLevels.Count > 0) sb.Append(" · давхар ").Append(string.Join(",", interp.TargetLevels));
            if (interp.UnresolvedTerms.Count > 0) sb.Append(" · тайлагдаагүй: ").Append(string.Join(", ", interp.UnresolvedTerms));
            v.Interpretation = sb.ToString();
            if (interp.Query == null) v.Candidates = "Боломжит элемент: — (тайлал байхгүй)";
            else
            {
                var parts = new List<string>();
                foreach (KeyValuePair<string, int> kv in set.ByKind) parts.Add(kv.Value + " " + kv.Key);
                v.Candidates = "Боломжит элемент: " + set.ElementIds.Count + (parts.Count > 0 ? " (" + string.Join(", ", parts) + ")" : "")
                    + (set.Truncated ? " · таслагдсан" : "")
                    + " · шалгасан " + set.ReviewedIds.Count
                    + " · явц: " + set.Progress;
            }
        }

        public void Navigate(int delta)
        {
            TasksVm v = Tasks;
            if (v.CandidateSet == null || v.CandidateSet.ElementIds.Count == 0) return;
            int n = v.CandidateSet.ElementIds.Count;
            int i = v.Index < 0 ? (delta >= 0 ? 0 : n - 1) : ((v.Index + delta) % n + n) % n;
            v.Index = i;
            long id = v.CandidateSet.ElementIds[i];
            v.Navigation = (i + 1) + "/" + n + " · #" + id;
            _host.ShowElementAsync(id);
        }

        public void MarkCurrentReviewed()
        {
            TasksVm v = Tasks;
            if (v.CandidateSet == null || v.Index < 0 || v.Selected == null) return;
            long id = v.CandidateSet.ElementIds[v.Index];
            _host.MarkReviewed(v.Selected.Task.TaskId, id);
            if (!v.CandidateSet.ReviewedIds.Contains(id)) v.CandidateSet.ReviewedIds.Add(id);
            SelectTaskKeepIndex();
        }

        private void SelectTaskKeepIndex()
        {
            TasksVm v = Tasks;
            int idx = v.Index; string nav = v.Navigation;
            SelectTask(v.Selected);
            v.Index = idx; v.Navigation = nav;
        }

        public void SelectAllCandidates()
        {
            TasksVm v = Tasks;
            if (v.CandidateSet == null || v.CandidateSet.ElementIds.Count == 0) return;
            _host.SelectElementsAsync(v.CandidateSet.ElementIds);
        }

        /* ---------------- Асуудал ---------------- */

        private void RefreshIssues()
        {
            IssuesVm v = Issues;
            v.Issues.Clear();
            IssueStore store = _host.CurrentIssues;
            RuleProviderResult rules = _host.Rules;
            if (store == null) { v.Status = "Баримт алга"; return; }
            List<RevitComplianceIssue> list = store.All(false);
            foreach (RevitComplianceIssue i in list) v.Issues.Add(new IssueRowVm { Issue = i });
            string ruleNote = rules == null ? "" : (rules.Status == RuleProviderStatus.OK ? " · продакшны норм: NO_EXECUTABLE_BIM_RULES, загварын чанар: " + rules.Rules.Count : " · " + rules.Status);
            v.Status = (list.Count == 0 ? "Нээлттэй асуудал алга (шалгасан хүрээнд)" : list.Count + " нээлттэй асуудал") + ruleNote;
        }

        public void ShowIssue(IssueRowVm row)
        {
            if (row == null || row.FirstElementId == 0) return;
            _host.ShowElementAsync(row.FirstElementId);
        }

        public void ExplainIssue(IssueRowVm row)
        {
            if (row == null) return;
            RevitComplianceIssue i = row.Issue;
            var sb = new System.Text.StringBuilder();
            sb.Append(i.TitleMn).Append('\n').Append(i.DetailMn ?? "").Append('\n');
            sb.Append("Анги: ").Append(row.ClassLabel).Append(" · эрх бүхий: ").Append(i.Authoritative ? "тийм" : "үгүй").Append('\n');
            if (i.Source != null) sb.Append("Эх сурвалж: ").Append(i.Source.ProvenanceNote ?? i.Source.LabelMn ?? i.Source.Kind.ToString()).Append('\n');
            if (i.Measured != null) sb.Append("Хэмжсэн: ").Append(UnitsBoundary.Format(i.Measured)).Append(" · шаардлага: ").Append(UnitsBoundary.Format(i.Required)).Append('\n');
            sb.Append("Дүрэм: ").Append(i.RuleId).Append(" v").Append(i.RuleVersion).Append(" · граф v").Append(i.SceneVersion).Append(" · ").Append(i.DetectedAt);
            if (i.EvidenceEdges.Count > 0) sb.Append("\nИрмэг: ").Append(string.Join("; ", i.EvidenceEdges));
            sb.Append("\n(Тайлбар нь детерминист — MGL AI-ийн үглэл SESSION_D_BINDING_REQUIRED.)");
            Issues.Explanation = sb.ToString();
        }

        /* ---------------- Тайлан ---------------- */

        public void GenerateReport()
        {
            ReportsVm v = Reports;
            ReportPeriodKind p = v.PeriodIndex == 0 ? ReportPeriodKind.TODAY : (v.PeriodIndex == 1 ? ReportPeriodKind.THIS_SESSION : ReportPeriodKind.TASK);
            ReportAudience a = v.AudienceIndex == 0 ? ReportAudience.TECHNICAL_SELF_REPORT : (v.AudienceIndex == 1 ? ReportAudience.TEAM_TASK_REPORT : ReportAudience.MANAGER_REPORT);
            int? taskId = p == ReportPeriodKind.TASK && Tasks.Selected != null ? Tasks.Selected.Task.TaskId : (int?)null;
            RevitReport r = _host.BuildReport(p, a, taskId);
            v.Last = r;
            var sb = new System.Text.StringBuilder();
            sb.Append(r.TitleMn).Append(" — ").Append(r.Rendering).Append(", урьдчилсан харагдац\n\n");
            for (int i = 0; i < r.LinesMn.Count; i++) sb.Append("• ").Append(r.LinesMn[i]).Append('\n');
            sb.Append("\nБаримт: ").Append(r.Evidence.Facts.Count).Append(" · нүх: ").Append(r.Evidence.Gaps.Count);
            v.Text = sb.ToString();
            v.Status = "ERP руу ИЛГЭЭХГҮЙ — зөвхөн урьдчилсан харагдац (§36).";
        }

        /* ---------------- AI ---------------- */

        public async Task AskAsync()
        {
            AiVm v = Ai;
            string q = (v.Question ?? "").Trim();
            if (q.Length == 0 || v.Busy) return;
            v.Busy = true;
            try
            {
                RevitTurnResult r = await _host.AskAsync(q, CancellationToken.None);
                v.Answer = r.AnswerMn + (r.Notices.Count > 0 ? "\n\n[" + string.Join(", ", r.Notices) + "]" : "");
                // R4.2 — загварын санал: preview байвал картыг дүүргэнэ; Apply ХЭВЭЭР хэрэглэгчийн товч.  БИЧИХГҮЙ.
                if (r.ActionPreview != null)
                {
                    v.Preview = r.ActionPreview;
                    v.ProposalText = string.Join("\n", r.ActionPreview.LinesMn) + "\n(эх: MODEL — загварын санал, гүйцэтгэх эрхгүй)";
                    v.HasPreview = true;
                    v.CanApply = r.ActionPreview.Validation != null && r.ActionPreview.Validation.Ok;
                    v.ProposalResult = v.CanApply ? "Загварын санал preview бэлэн (" + r.ActionPreview.PreviewId + ") — Apply дарж ИЛ баталгаажуулна." : "Загварын санал шалгалт тэнцсэнгүй — Apply хаалттай.";
                }
                else if (r.ActionBindCodes.Count > 0)
                {
                    v.ProposalResult = "Загварын санал хаягдав: " + string.Join(", ", r.ActionBindCodes) + (string.IsNullOrEmpty(r.ActionBindNote) ? "" : " — " + r.ActionBindNote);
                }
                else if (!v.HasPreview)
                {
                    // Санал ч, хаялт ч ирээгүй ээлж: ӨМНӨХ ээлжийн мессежийг үлдээвэл хуучин хаялт «дахин гарсан» мэт харагдана.
                    v.ProposalResult = "Энэ ээлжинд загвар өөрчлөлтийн санал гаргаагүй (блок алга) — дахин асууж болно.";
                }
            }
            catch (Exception ex) { v.Answer = "Алдаа: " + ex.Message; }
            finally { v.Busy = false; }
        }

        /* ---------------- R4.1 CONFIRM_WRITE ---------------- */

        public async Task ProposeAsync(string choice)
        {
            AiVm v = Ai;
            if (!v.CanPropose) return;
            v.CanPropose = false; v.CanApply = false; v.HasPreview = false; v.ProposalResult = "Preview …";
            try
            {
                string val = (v.ProposalValue ?? "").Trim();
                ActionPreview pv;
                if (choice == "Зөөх Y (мм)") pv = await _host.ProposeFromUiAsync(RevitActionKind.MOVE_ELEMENT, new Dictionary<string, string> { { "dx_mm", "0" }, { "dy_mm", val }, { "dz_mm", "0" } }, "Хэрэглэгчийн хүсэлт (AI самбар)");
                else if (choice == "Зөөх X (мм)") pv = await _host.ProposeFromUiAsync(RevitActionKind.MOVE_ELEMENT, new Dictionary<string, string> { { "dx_mm", val }, { "dy_mm", "0" }, { "dz_mm", "0" } }, "Хэрэглэгчийн хүсэлт (AI самбар)");
                else if (choice == "Төрөл солих") pv = await _host.ProposeFromUiAsync(RevitActionKind.CHANGE_TYPE, new Dictionary<string, string> { { "type_name", val } }, "Хэрэглэгчийн хүсэлт (AI самбар)");
                else pv = await _host.ProposeSetParameterAsync(choice, val, "Хэрэглэгчийн хүсэлт (AI самбар)");
                v.Preview = pv;
                if (pv == null) { v.ProposalText = ""; v.ProposalResult = "Preview үүссэнгүй — яг НЭГ элемент сонгосон байх ёстой."; return; }
                v.ProposalText = string.Join("\n", pv.LinesMn);
                v.HasPreview = true;
                v.CanApply = pv.Validation != null && pv.Validation.Ok;
                v.ProposalResult = v.CanApply ? "Preview бэлэн (" + pv.PreviewId + ") — Apply дарж ИЛ баталгаажуулна." : "Шалгалт тэнцсэнгүй — Apply хаалттай.";
            }
            catch (Exception ex) { v.ProposalResult = "Алдаа: " + ex.Message; }
            finally { v.CanPropose = true; }
        }

        /// <summary>ЗӨВХӨН Apply товчноос — энэ бол хэрэглэгчийн ил баталгаа; өөр эх ХЭЗЭЭ Ч (§20).</summary>
        public async Task ApplyAsync()
        {
            AiVm v = Ai;
            if (!v.CanApply || v.Preview == null) return;
            v.CanApply = false; v.CanPropose = false; v.ProposalResult = "Хэрэглэж байна …";
            try
            {
                ActionExecution ex = await _host.ApplyFromUiAsync(v.Preview);
                if (ex == null) { v.ProposalResult = "Гүйцэтгэл хариу өгсөнгүй (REVIT_BUSY?)."; return; }
                switch (ex.Status)
                {
                    case ActionExecutionStatus.APPLIED: v.ProposalResult = "✓ Хэрэглэж, баталгаажууллаа (audit #" + ex.AuditSeq + ", " + ex.ElapsedMs + " мс)."; v.HasPreview = false; v.Preview = null; break;
                    case ActionExecutionStatus.ROLLED_BACK: v.ProposalResult = "✗ Буцаалаа — postcondition унав: " + ex.RollbackReason; v.HasPreview = false; v.Preview = null; break;
                    case ActionExecutionStatus.STALE: v.ProposalResult = "⟳ Загвар preview-ээс хойш өөрчлөгдсөн — шинэ Preview хий (STALE_ACTION_PREVIEW)."; v.HasPreview = false; v.Preview = null; break;
                    default: v.ProposalResult = "⛔ " + ex.Status + ": " + string.Join(", ", ex.Codes); v.HasPreview = false; v.Preview = null; break;
                }
            }
            catch (Exception ex) { v.ProposalResult = "Алдаа: " + ex.Message; }
            finally { v.CanPropose = true; }
        }

        public void DiscardProposal()
        {
            AiVm v = Ai;
            v.Preview = null; v.HasPreview = false; v.CanApply = false; v.ProposalText = ""; v.ProposalResult = "Саналыг хаялаа (бичээгүй).";
        }

        public void ConfirmLink()
        {
            ProjectLinkSuggestion s = Context.PickedSuggestion;
            if (s == null) return;
            _host.ConfirmProjectLink(s.ProjectId, s.ProjectName);
        }

        public void Unlink() { _host.UnlinkProject(); }

        /* ---------------- DEV / TEST (NON-PRODUCTION) ---------------- */

        public async Task DevToolAsync(string tool, string argsJson, string label)
        {
            if (Dev.Busy) return;
            Dev.Busy = true;
            Dev.Status = label + " …";
            try
            {
                ToolCall c = await _host.CallToolAsync(tool, argsJson, 120);
                if (!c.Success) { Dev.Status = label + ": АЛДАА — " + (c.TimedOut ? "REVIT_BUSY" : c.Error); return; }
                Dev.Status = label + ": " + Summarize(tool, c.ResultJson);
                if (tool == "test_model_create" || tool == "test_model_mutate")
                {
                    await Task.Delay(1800); // нэгтгэгчийн 1200 мс намжилт + шинэчлэл
                    await Task.Run(() => _host.EvaluateAllCurrent());
                    Post(RefreshIssues);
                }
            }
            catch (Exception ex) { Dev.Status = label + ": " + ex.GetType().Name + " " + ex.Message; }
            finally { Dev.Busy = false; }
        }

        private static string Summarize(string tool, string json)
        {
            try
            {
                using (var d = System.Text.Json.JsonDocument.Parse(json))
                {
                    var data = d.RootElement.GetProperty("data");
                    switch (tool)
                    {
                        case "test_model_gate":
                            return (data.GetProperty("allowed").GetBoolean() ? "ЗӨВШӨӨРНӨ" : "ТАТГАЛЗАНА") + " (" + data.GetProperty("reason").GetString() + ", элемент " + data.GetProperty("model_element_count").GetInt32() + ")";
                        case "test_model_create":
                            {
                                var el = data.GetProperty("elements");
                                string cnt = "давхар " + el.GetProperty("levels").GetArrayLength() + " · хана " + el.GetProperty("walls").GetArrayLength() + " · шал " + el.GetProperty("floors").GetArrayLength()
                                    + " · өрөө " + el.GetProperty("rooms").GetArrayLength() + " · хаалга " + el.GetProperty("doors").GetArrayLength() + " · цонх " + el.GetProperty("windows").GetArrayLength();
                                var st = new List<string>();
                                foreach (var s in data.GetProperty("states").EnumerateArray()) st.Add(s.GetString());
                                return cnt + " · " + data.GetProperty("elapsed_ms").GetDouble() + " мс · " + string.Join(", ", st);
                            }
                        case "test_model_save": return data.GetProperty("saved_path").GetString();
                        case "test_project_new": return data.GetProperty("state").GetString() + " · " + data.GetProperty("path").GetString();
                        default: return data.GetRawText().Length > 200 ? data.GetRawText().Substring(0, 200) + "…" : data.GetRawText();
                    }
                }
            }
            catch { return json != null && json.Length > 200 ? json.Substring(0, 200) : json; }
        }

        public void RefreshAll()
        {
            _host.RequestContextRefresh();
            Task.Run(() => { _host.RefreshTasks(); _host.ProbeRuntimeAsync().Wait(); });
        }

        private static string StateMn(RevitErrorState s)
        {
            switch (s)
            {
                case RevitErrorState.OK: return "Revit контекст: бэлэн";
                case RevitErrorState.NO_DOCUMENT: return "Баримт нээгээгүй";
                case RevitErrorState.NO_SELECTION: return "Сонгосон элемент алга";
                case RevitErrorState.REVIT_BUSY: return "Revit завгүй — дараа дахин";
                case RevitErrorState.REVIT_API_ERROR: return "Revit API алдаа";
                default: return s.ToString();
            }
        }

        private static string WorksharingMn(RevitDocumentContext d)
        {
            switch (d.Worksharing)
            {
                case DocumentWorksharing.NOT_WORKSHARED: return "үгүй";
                case DocumentWorksharing.CENTRAL: return "төв файл";
                case DocumentWorksharing.LOCAL: return "локал хуулбар";
                case DocumentWorksharing.DETACHED: return "салгасан";
                default: return "?";
            }
        }
    }
}
