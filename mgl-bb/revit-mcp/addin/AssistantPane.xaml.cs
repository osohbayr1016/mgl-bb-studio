using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace RevitMcpAddin
{
    /// <summary>ComboBox-д харагдах ажил.</summary>
    public sealed class TaskChoice
    {
        public ResolvedTaskDto Data { get; set; }
        public string Label =>
            // Менежерийн `?scope=all` жагсаалтад бусдын ажил ялгарч харагдана.
            (Data != null && !Data.Assigned ? "(бусад) " : "") +
            (string.IsNullOrWhiteSpace(Data?.BlockName) ? "" : Data.BlockName + " · ") +
            (Data?.TaskName ?? "—");
    }

    /// <summary>
    /// Багийн сонгогчийн НЭГ МӨР.
    ///
    /// ⚠️ Жагсаалт нь серверийн АМЬД ростероос (`teams` хүснэгт) бүрдэнэ —
    /// клиентэд багийн код ч, багийн ТОО ч хатуу бичигдээгүй (⛔ хориг 11).
    /// </summary>
    public sealed class TeamChoice
    {
        public string Code { get; set; }
        public string NameMn { get; set; }
        public string Label =>
            string.IsNullOrWhiteSpace(NameMn) ? (Code ?? "—") : Code + " · " + NameMn;
    }

    /// <summary>
    /// НОРМЫН САМБАРЫН НЭГ МӨР — үндэс, дагавар, тайлбарын мөр гурвуулаа.
    ///
    /// ⚠️ `ComplianceState.cs`-ийн `FindingRow`-той ХОЛИХГҮЙ.  Тэр нь
    /// СЕРВЕР РҮҮ ЯВАХ, хөлдөөсөн хувилбартай бүртгэлийн мөр; энэ нь ЗӨВХӨН
    /// харагдац бөгөөд `PublishFindings` бүрд ШИНЭЭР бүтээгдэнэ.
    ///
    /// ⚠️ `INotifyPropertyChanged` ЗОРИУД БАЙХГҮЙ.  Мөр өөрчлөгддөггүй —
    /// жагсаалт бүхэлдээ дахин баригддаг тул `ObservableCollection`-ий
    /// нэмэлт/хасалт хангалттай.  Талбар нэмж мутац хийх шаардлага гарвал
    /// тэр нь «мөрийг засах» БИШ, «дахин барих» гэсэн дохио.
    /// </summary>
    public sealed class FindingViewRow
    {
        // ⚠️ Өнгө энд ТООЦООЛОГДОХГҮЙ: `FgClass`-аар XAML-ийн DataTrigger токен өнгө (Danger/Warn/Fg/FgMuted) сонгоно —
        // тогтмол hex brush нь Light/өндөр контрастад дагахгүй байв.

        /// <summary>Дарж болохгүй мэдээллийн мөр («…бас 4 дагавар»).</summary>
        public bool IsNote { get; set; }
        public bool IsPrimary { get; set; }

        public string DedupKey { get; set; }
        /// <summary>0 = сервер дээр бүртгэгдээгүй → хүчингүй болгох боломжгүй.</summary>
        public long ServerId { get; set; }
        public long ElementId { get; set; }

        public string Title { get; set; }
        public string Sub { get; set; }
        public string Extra { get; set; }
        public string Hint { get; set; }
        public string AckLabel { get; set; }
        public string OverrideLabel { get; set; }

        /// <summary>0 CRITICAL … 4 INFO (`FindingFeed.RankOf`).</summary>
        public int SeverityRank { get; set; }

        /// <summary>«Muted» | «Critical» | «Warn» | «Normal» — XAML-ийн DataTrigger-д.  Утга зөвхөн өнгөөр биш: гарчигт ✖/⚠ тэмдэг орсон.</summary>
        public string FgClass =>
            IsNote ? "Muted"
                   : (SeverityRank <= 1 ? "Critical" : (SeverityRank == 2 ? "Warn" : "Normal"));

        public FontWeight TitleWeight =>
            IsPrimary && !IsNote ? FontWeights.SemiBold : FontWeights.Normal;

        public Thickness Indent =>
            IsPrimary && !IsNote ? new Thickness(0) : new Thickness(11, 0, 0, 0);

        public Visibility SubVisibility =>
            string.IsNullOrWhiteSpace(Sub) ? Visibility.Collapsed : Visibility.Visible;
        public Visibility ExtraVisibility =>
            string.IsNullOrWhiteSpace(Extra) ? Visibility.Collapsed : Visibility.Visible;

        /// <summary>Тайлбарын мөрөнд товч БАЙХГҮЙ — дарах зүйл ч алга.</summary>
        public Visibility ActionsVisibility =>
            IsNote ? Visibility.Collapsed : Visibility.Visible;

        /// <summary>
        /// ⚠️ Сервер дээр байхгүй дүгнэлтэд «Хүчингүй болгох» товч
        /// ХАРУУЛАХГҮЙ.  Хаана ч бичигдэхгүй товч нь хэрэглэгчид «бүртгэгдлээ»
        /// гэж ойлгогдоно — §68-ийн долоон элементийн гинж тасарна.
        /// </summary>
        public Visibility OverrideVisibility =>
            !IsNote && ServerId > 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    /// <summary>Хүчингүй болголтын нэг сонголт (`OVERRIDE_KINDS`-ийн толь).</summary>
    public sealed class OverrideKindChoice
    {
        public string Code { get; set; }
        public string Label { get; set; }
    }

    /// <summary>
    /// Өөрчлөлтийн самбарын НЭГ МӨР — бүлгийн толгой ба элемент хоёуланг нь
    /// илэрхийлнэ.
    ///
    /// ⚠️ ХАВТГАЙ ЖАГСААЛТ нь САНААТАЙ.  `TreeView` нь харанхуй загварт бүтэн
    /// `ControlTemplate` бичихийг шаарддаг (ItemsPresenter, задлагч, сонголтын
    /// өнгө) — энэ самбарын хэв маягт хэт их код.  Толгой мөр өөрөө
    /// хүүхдүүдийнхээ `Visible`-ийг сольдог тул задлах/хураах ижилхэн ажиллана.
    /// </summary>
    public sealed class ChangeRow : INotifyPropertyChanged
    {
        private bool _visible = true;
        private bool _collapsed;

        public bool IsHeader { get; set; }
        /// <summary>Дарж болохгүй мэдээллийн мөр («… + 12»).</summary>
        public bool IsNote { get; set; }
        public string GroupKey { get; set; }
        public long ElementId { get; set; }
        public string Label { get; set; }
        public string Sub { get; set; }
        public string Right { get; set; }
        public string Hint { get; set; }

        public bool Collapsed
        {
            get { return _collapsed; }
            set { _collapsed = value; Raise(nameof(Title)); }
        }

        public bool Visible
        {
            get { return _visible; }
            set { _visible = value; Raise(nameof(RowVisibility)); }
        }

        public string Title => IsHeader ? (_collapsed ? "▸ " : "▾ ") + Label : Label;
        public Visibility RowVisibility => _visible ? Visibility.Visible : Visibility.Collapsed;
        public Visibility SubVisibility =>
            string.IsNullOrWhiteSpace(Sub) ? Visibility.Collapsed : Visibility.Visible;
        public Thickness Indent => IsHeader ? new Thickness(0) : new Thickness(11, 0, 0, 0);
        public FontWeight TitleWeight => IsHeader ? FontWeights.SemiBold : FontWeights.Normal;
        /// <summary>«Header» | «Muted» | «Normal» — XAML-ийн DataTrigger токен өнгө сонгоно.</summary>
        public string FgClass => IsHeader ? "Header" : (IsNote ? "Muted" : "Normal");

        public event PropertyChangedEventHandler PropertyChanged;
        private void Raise(string n) =>
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(n));
    }

    /// <summary>Дэд жагсаалтын нэг мөр.</summary>
    public sealed class ChecklistRow : INotifyPropertyChanged
    {
        private bool _isDone;
        public int Id { get; set; }
        public string Text { get; set; }
        public bool IsDone
        {
            get => _isDone;
            set { _isDone = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(IsDone))); }
        }
        public event PropertyChangedEventHandler PropertyChanged;
    }

    public enum ChatKind { User, Assistant, Tool, Error, System }

    /// <summary>
    /// Яриа хэлцлийн НЭГ мөр.
    ///
    /// ⚠️ Харагдах байдлыг (байрлал, дэвсгэр, өнгө) ЭНД тооцоолж, XAML-д зөвхөн
    /// binding-ээр өгнө.  Ингэснээр converter, DataTemplateSelector, олон
    /// DataTemplate огт хэрэггүй болж, XAML энгийн хэвээр үлддэг.
    /// </summary>
    public sealed class ChatMessage : INotifyPropertyChanged
    {
        private double _maxWidth = 260;

        public ChatKind Kind { get; set; }
        public string Text { get; set; }
        public string Header { get; set; }

        public HorizontalAlignment Align =>
            Kind == ChatKind.User ? HorizontalAlignment.Right
            : Kind == ChatKind.System ? HorizontalAlignment.Center
            : HorizontalAlignment.Left;

        public Thickness EdgeThickness =>
            Kind == ChatKind.Tool || Kind == ChatKind.Error ? new Thickness(1) : new Thickness(0);

        public Visibility HeaderVisibility =>
            string.IsNullOrEmpty(Header) ? Visibility.Collapsed : Visibility.Visible;

        /// <summary>Самбарын өргөнөөс хамаарч C#-аас шинэчлэгддэг.</summary>
        public double MaxWidth
        {
            get => _maxWidth;
            set
            {
                if (Math.Abs(_maxWidth - value) < 0.5) return;
                _maxWidth = value;
                PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(MaxWidth)));
            }
        }

        public event PropertyChangedEventHandler PropertyChanged;
    }

    /// <summary>
    /// «MGL туслах» самбар — Revit доторх өдөр тутмын явцын гарц.
    ///
    /// ⚠️ ХАМГИЙН ЧУХАЛ ДҮРЭМ: `RevitToolBus.Call` нь ExternalEvent-ийн хариуг
    /// БЛОКЛОЖ хүлээдэг.  Revit-ийн UI thread нь ЯГ ТЭР ExternalEvent-ийг
    /// боловсруулдаг тул UI thread-ээс шууд дуудвал ӨӨРИЙГӨӨ хүлээж МӨНХӨД
    /// ГАЦНА.  Тиймээс бүх хэрэгслийн дуудлага `Task.Run(...)` дотор л явна.
    ///
    /// ⚠️ LLM ТҮЛХҮҮР энд БАЙХГҮЙ.  Бүх AI дуудлага сервер рүү явна:
    ///   • тэмдэглэл  → `POST /api/revit/draft`
    ///   • чат агент  → `POST /api/revit/agent/turn`
    /// Anthropic-ийн түлхүүр Cloudflare secret дотор үлддэг.  Агентын
    /// ДАВТАЛТЫГ add-in эзэмшинэ (`AgentChat.cs`), учир нь хэрэгслүүд нь
    /// ЭНЭ компьютер дээрх Revit дотор гүйцэтгэгддэг.
    ///
    /// `IntentParser` нь СҮЛЖЭЭНД ХҮРЭХГҮЙ зургаан үйлдлийг барьж авдаг —
    /// «илгээ», «буцаа» гэх мэт нь товч дарсан шиг хурдан байх ёстой.
    /// </summary>
    public partial class AssistantPane : UserControl
    {
        private readonly ObservableCollection<ChecklistRow> _checklist =
            new ObservableCollection<ChecklistRow>();
        private readonly ObservableCollection<ChatMessage> _chat =
            new ObservableCollection<ChatMessage>();

        private ContextResult _context;
        private DraftResult _draft;
        private object _lastChange;

        /// <summary>
        /// Idempotency түлхүүр — НООРОГ бүрт НЭГ УДАА үүснэ.  Сүлжээ тасарч
        /// дахин илгээхэд ЯГ ИЖИЛ утга явах ёстой, эс бөгөөс хоёр бүртгэл
        /// үүснэ (`revit_submissions.UNIQUE(user_id, draft_uid)` барина).
        /// </summary>
        private string _draftUid;

        private bool _busy;
        private bool _suppressToggle;

        /// <summary>Баримтын товч мэдээлэл — агентын систем зааварт очно.</summary>
        private Dictionary<string, object> _docContext;

        /// <summary>«Локал AI» гэдгийг НЭГ УДАА хэлнэ.</summary>
        private bool _saidLocal;

        /// <summary>Вэбийн алдааг сесс тутамд НЭГ УДАА хэлнэ.</summary>
        private bool _saidWebError;

        /// <summary>«Хуудас холбогдоогүй» санамжийг сесс тутамд НЭГ УДАА хэлнэ.</summary>
        private bool _saidUnbound;

        /// <summary>Өөрчлөлтийн самбарын мөрүүд — толгой ба элемент хавтгайгаар.</summary>
        private readonly ObservableCollection<ChangeRow> _changes =
            new ObservableCollection<ChangeRow>();

        /// <summary>Нормын дүгнэлтийн мөрүүд — үндэс, дагавар, тайлбар хавтгайгаар.</summary>
        private readonly ObservableCollection<FindingViewRow> _findings =
            new ObservableCollection<FindingViewRow>();

        /// <summary>
        /// Хүлээн зөвшөөрөл / хойшлуулалтын СЕССИЙН төлөв.
        ///
        /// ⚠️ ЗӨВХӨН UI урсгалаас хүрнэ (`PublishFindings` нь өөрөө
        /// маршаллдаг) тул түгжээ ШААРДЛАГАГҮЙ.  Дискэнд бичигддэггүй нь
        /// САНААТАЙ: Revit дахин асаахад үлдэх ёстой «Ойлголоо» нь серверийн
        /// `lifecycle_state` — локал файл нь тэр гэрээний ХОЁР ДАХЬ, зөрчилдөх
        /// эх сурвалж болно.
        /// </summary>
        private readonly FindingFeed.State _feedState = new FindingFeed.State();

        /// <summary>Сүүлд нийтэлсэн урсгал — «Ойлголоо»-ийн дараа дахин барихад.</summary>
        private FindingFeed.Result _lastFeed;

        /// <summary>
        /// Хуваарилагчаас ирсэн ТҮҮХИЙ гадаргуу.
        ///
        /// ⚠️ `_lastFeed`-ЭЭС ДАХИН БАРИХГҮЙ.  `Build` нь төсвөөс хэтэрсэн
        /// бүлгийг ХАЯДАГ тул «Ойлголоо»-ийн дараа `_lastFeed`-ээс дахин
        /// барих нь таслагдсан мөрүүдийг МӨНХӨД алга болгоно (нэг мөр
        /// хүлээн зөвшөөрөх нь бусдыг УСТГАХ ёсгүй).
        /// </summary>
        private IList<FindingFeed.Item> _lastSurface;

        /// <summary>
        /// ⚠️ ЧИМЭЭГҮЙ ТЭНЦЛИЙН ЭСРЭГ ТУГ (F5).  Хуваарилагч НЭГ УДАА Ч
        /// ГЭСЭН гадаргуу хүргэсэн үү?  `false` бол хоосон жагсаалт нь
        /// «шалгаад цэвэр гарлаа» ГЭСЭН ҮГ БИШ — «хэн ч юу ч хүргээгүй».
        /// `PublishFindings` энэ тугийг ХЭЗЭЭ Ч тавихгүй: тэр аргыг
        /// `RebuildFindings` өөрөө дууддаг тул тэнд тавибал самбар өөрийгөө
        /// «хүргэгдсэн» гэж итгүүлэх ба F5 буцаж ирнэ.
        /// </summary>
        private bool _surfaceDelivered;

        /// <summary>Хүргэгдсэн гадаргуу нь БҮТЭН СКАНААС гарсан эсэх.</summary>
        private bool _surfaceWholeModel;

        /// <summary>
        /// ЛОКАЛ гадаргууг барихад хэрэглэх хүнд байдлын босго — INFO (4),
        /// өөрөөр хэлбэл ХӨДӨЛГҮҮРИЙН гаргасан БҮГД.
        ///
        /// ⚠️ `bim.compliance.min_severity` нь СЕРВЕРИЙН тохиргоо бөгөөд
        ///    add-in түүнийг хараахан татдаггүй.  Тиймээс энд ХАТУУ тоо
        ///    бичих цорын ганц зөв утга нь ХАМГИЙН СУЛ нь: илүүг харуулах нь
        ///    зөрчлийг ЧИМЭЭГҮЙ нуухаас хамаагүй дээр.  Сервер тал ирэхэд
        ///    жинхэнэ босго нь тэндээс ирнэ.
        /// </summary>
        private const int LocalMinSeverityRank = 4;

        /// <summary>Хүчингүй болголтын мөр аль дүгнэлтэд нээгдсэн бэ.</summary>
        private FindingViewRow _overrideTarget;

        /// <summary>
        /// Хураасан бүлгүүд.  ⚠️ Мөрүүд БИШ, ТҮЛХҮҮР хадгална: жагсаалт дахин
        /// ачаалагдахад мөрийн объектууд шинээр үүсдэг тул хэрэглэгчийн задалсан
        /// байдал эс бөгөөс тухай бүр тэглэгдэнэ.
        /// </summary>
        private readonly HashSet<string> _collapsedGroups =
            new HashSet<string>(StringComparer.Ordinal);

        /// <summary>
        /// Менежер «файлын бүх ажлыг» харахыг хүссэн эсэх (`?scope=all`).
        ///
        /// ⚠️ Анхдагч нь ҮРГЭЛЖ false.  Нэг .rvt файлыг олон салбарын инженер
        /// хуваалцдаг ба хуудасны холбоос нь багийн ХУВААЛЦСАН тул бүх ажлыг
        /// анхдагчаар харуулбал цахилгаанчин архитекторын ажил дээр явц илгээх
        /// эрсдэл үүснэ.  Сервер энэ тугийг зөвхөн admin/senior-д хүлээж авна.
        /// </summary>
        private bool _scopeAll;

        /// <summary>
        /// Сүүлийн амжилттай `GET /team-context`-ийн АМЬД РОСТЕР.
        ///
        /// ⚠️ ЗӨВХӨН UI thread-ээс хүрнэ (`SetTeamChip`, сонгогчийн
        /// хандлагчид).  Арын thread нь `Dispatcher.InvokeAsync` дотор л
        /// бичдэг тул түгжээ ШААРДЛАГАГҮЙ.
        /// </summary>
        private List<TeamRosterDto> _teamRoster = new List<TeamRosterDto>();

        /// <summary>
        /// Chip-ийн харьяалагдах баримт.  `VerifyTeamAsync` нь ЯГ ЭНЭ
        /// `doc_uid`-аар явна — эс бөгөөс хэрэглэгч файл сольсны дараа
        /// залруулга нь БУРУУ баримт дээр бичигдэнэ.
        /// </summary>
        private string _teamDocUid;

        public AssistantPane()
        {
            InitializeComponent();
            // MGL UI-ийн дундын сэдэв (Light / Dark / өндөр контраст; Revit-ийн сэдвийг дагана).  Харанхуй палитр энд
            // хуулбарлагдахаа больсон.  Эхний мөрөнд — `SetConnected` зэрэг нь токен олох ёстой.
            Ui.MglTheme.Apply(this, 12);
            ChecklistBox.ItemsSource = _checklist;
            ChangesBox.ItemsSource = _changes;
            FindingsBox.ItemsSource = _findings;
            ChatList.ItemsSource = _chat;

            // ⚠️ F5 — ДҮГНЭЛТИЙН ЦОРЫН ГАНЦ ҮЙЛДВЭРЛЭГЧ.  Энэ мөр байхгүй
            //    бол `RefreshFindingsChrome` нь `NoProducer` төлөвт орж
            //    ИЛ хашгирна (өмнө нь чимээгүйхэн «анхаарах зүйл алга» гэж
            //    бичдэг байсан — дүрмийн багц ирсэн ӨДӨР л ажиллаж эхлэх
            //    class-1 чимээгүй тэнцэл).
            //
            // ⚠️ Самбар нь `AssistantPaneProvider`-ийн ЗАЛХУУ singleton тул
            //    энэ хаалт нь нэг л удаа суулгагдана.  Хаалт `this`-ийг
            //    барих нь ЗӨВ: singleton хэдийд ч амьд.
            ComplianceScheduler.AttachSurfaceSink(
                delegate (IList<FindingFeed.Item> items, string coverage, bool wholeModel)
                {
                    AcceptSurface(items, wholeModel);
                });

            // Бөмбөлгийн өргөнийг самбарын өргөнд дасгана — dockable pane-ийг
            // хэрэглэгч чирж өргөсгөдөг тул тогтмол утга тохирохгүй.
            SizeChanged += (s, e) => ResizeBubbles();

            // ⚠️ Эхний мөр нь ХЭРЭГЛЭГЧ БИЧИХЭЭС ӨМНӨ гардаг тул хэл нь
            // мэдэгдэхгүй — анхдагчаар монгол.  Гэхдээ англиар бичиж болохыг
            // ЗААВАЛ дурдана: тэгэхгүй бол англиар ярьдаг хүн туслахыг
            // монгол-хэлний зүйл гэж үзээд огт оролдохгүй.
            Say(ChatKind.Assistant,
                "Сайн байна уу. Өдрийн ажлаа надад хэлээрэй — «хийснээ илгээ» гэж бичихэд " +
                "тэмдэглэл, хувийг нь бэлдээд өгнө. «тусламж» гэвэл бүх тушаал гарна.\n" +
                "Кирилл, латин, англи — аль ч хэлээр бичээрэй. / You can also write in English.");

            Loaded += async (s, e) =>
            {
                ResizeBubbles();
                // ⚠️ ЭХЛЭЭД халаана: (1) 918 KB JSON parse нь хэрэглэгчийн
                // ЭХНИЙ мессежийн UI thread дээр биш, АРЫН thread дээр унана;
                // (2) `IntentModel.LoadedVersion` утгатай болох тул доорх sync
                // нь `?have=` илгээж чадна.
                //
                // ⚠️ Уралдааны цонх ҮЛДЭНЭ — `PrewarmAsync` нь async тул
                // `SyncIntentModelSoon` мөрөнд загвар хараахан ачаалагдаагүй
                // байж болно.  Тиймээс тэр арга нь халаалтад НАЙДАХГҮЙ,
                // `IntentModel.VersionForSync()`-ыг өөрөө дууддаг.
                IntentModel.PrewarmAsync();
                SyncIntentModelSoon();
                await ReloadAsync(silent: true);

                // ⚠️ ЭРҮҮЛ МЭНДИЙН ТАЙЛАН — ХАМГИЙН СҮҮЛД.  Энэ нь v2 §74-ийн
                // REPORT HEALTH шат: ~20 ПК дээр «аль машин ямар хувилбартай,
                // юу нь эвдэрсэн» гэдгийг мэдэх ЦОРЫН ГАНЦ суваг.  Дараалал
                // нь ач холбогдолтой: `ReloadAsync` нь `AssistantLog.RevitVersion`
                // -ыг тавьдаг тул түүний ДАРАА дуудвал Revit-ийн build дугаар
                // тайланд ордог.  `App.OnStartup`-аас ХЭЗЭЭ Ч дуудахгүй —
                // тэр нь Revit-ийн ачаалалтын зам.
                ReportHealthSoon();
            };
        }

        private AddinSettings Settings => SettingsStore.Load();

        /* ============================================================== */
        /*  Яриа                                                          */
        /* ============================================================== */

        private void ResizeBubbles()
        {
            double w = ChatScroll?.ActualWidth ?? 0;
            if (w < 60) return;
            double max = Math.Max(140, w - 42);
            foreach (ChatMessage m in _chat) m.MaxWidth = max;
        }

        private ChatMessage Say(ChatKind kind, string text, string header = null)
        {
            var msg = new ChatMessage { Kind = kind, Text = text, Header = header };
            double w = ChatScroll?.ActualWidth ?? 0;
            if (w > 60) msg.MaxWidth = Math.Max(140, w - 42);
            _chat.Add(msg);

            // Хамгийн сүүлийн мөр рүү гүйлгэнэ.  Layout дуустал хүлээх ёстой
            // тул Dispatcher-ийн Background түвшинд хойшлуулна.
            Dispatcher.BeginInvoke(
                System.Windows.Threading.DispatcherPriority.Background,
                new Action(() => ChatScroll?.ScrollToEnd()));
            return msg;
        }

        /// <summary>Сүүлийн туслахын мөрийг ДАРЖ бичнэ — «бодож байна…» гэх мэт.</summary>
        private void Replace(ChatMessage msg, string text)
        {
            if (msg == null) { Say(ChatKind.Assistant, text); return; }
            int i = _chat.IndexOf(msg);
            var fresh = new ChatMessage
            {
                Kind = msg.Kind,
                Text = text,
                Header = msg.Header,
                MaxWidth = msg.MaxWidth,
            };
            if (i >= 0) _chat[i] = fresh; else _chat.Add(fresh);
            Dispatcher.BeginInvoke(
                System.Windows.Threading.DispatcherPriority.Background,
                new Action(() => ChatScroll?.ScrollToEnd()));
        }

        private void SetBusy(bool busy, string what = null)
        {
            _busy = busy;
            RefreshBtn.IsEnabled = !busy;
            SendBtn.IsEnabled = !busy;
            SubmitBtn.IsEnabled = !busy && ConfirmBox.IsChecked == true && _draft != null;
            BusyText.Text = what ?? string.Empty;
            BusyText.Visibility = busy && !string.IsNullOrEmpty(what)
                ? Visibility.Visible
                : Visibility.Collapsed;
            Mouse.OverrideCursor = busy ? Cursors.AppStarting : null;
        }

        private void SetConnected(bool connected, string sub)
        {
            // SetResourceReference: сэдэв солигдоход цэг ӨӨРӨӨ дахин будагдана (FindResource нь нэг удаагийн хуулбар байв).
            StatusDot.SetResourceReference(System.Windows.Shapes.Shape.FillProperty, connected ? "Accent" : "FgMuted");
            SubHeaderText.Text = sub;
        }

        /* ============================================================== */
        /*  Ачаалах                                                       */
        /* ============================================================== */

        private async Task ReloadAsync(bool silent = false)
        {
            if (_busy) return;
            SetBusy(true, "Уншиж байна…");
            try
            {
                AddinSettings st = Settings;
                if (string.IsNullOrEmpty(st.Token))
                {
                    SetConnected(false, "Нэвтрээгүй");
                    Say(ChatKind.Error, "Эхлээд MGL → Тохиргоо цонхноос нэвтэрнэ үү.");
                    return;
                }

                // ⚠️ Task.Run — UI thread дээр ExternalEvent хүлээвэл гацна.
                JsonElement ctxJson = await Task.Run(() => RevitApi.CallTool("get_document_context"));
                string docUid = ctxJson.TryGetProperty("doc_uid", out JsonElement u) ? u.GetString() : null;
                string fileName = ctxJson.TryGetProperty("file_name", out JsonElement f) ? f.GetString() : "";

                // Агентын систем зааварт өгөх товч мэдээлэл.  Зөвхөн ТАЙЛБАРЛАХ
                // талбарууд — id, токен зэрэг нууц зүйл ЭНД ОРОХГҮЙ.
                _docContext = new Dictionary<string, object>();
                foreach (string key in new[]
                         { "file_name", "revit_version", "sheet_count", "is_workshared",
                           "is_link", "project_name", "project_number" })
                {
                    if (ctxJson.TryGetProperty(key, out JsonElement v) &&
                        v.ValueKind != JsonValueKind.Null)
                    {
                        _docContext[key] = v.ToString();
                    }
                }

                if (string.IsNullOrEmpty(docUid))
                {
                    SetConnected(false, "Төсөл нээгээгүй");
                    Say(ChatKind.Error, "Revit-д нээлттэй төсөл алга.");
                    return;
                }

                // ⚠️ БАГИЙН КОНТЕКСТ — ЭНД, `GetContextAsync`-ЫН ӨМНӨ.
                //    Тэр дуудлага нь бүртгэгдээгүй файл дээр 404 шиднэ, гэтэл
                //    `/team-context` нь ХЭЗЭЭ Ч 404 өгдөггүй (шат нь
                //    хэрэглэгчийн профайл хүртэл уруудна).  Доор нь тавьбал
                //    шинэ файл нээх бүрт chip хоосон үлдэнэ — яг тэр үед
                //    багийн мэдээлэл ХАМГИЙН хэрэгтэй байдаг.
                // ⚠️ Блоклохгүй: дотроо `Task.Run`, `await` БАЙХГҮЙ.
                RefreshTeamContextSoon(docUid);

                _context = await Task.Run(() =>
                    RevitApi.GetContextAsync(st.ApiHost, st.Token, docUid, st.ProjectId, _scopeAll));

                // Бүртгэлийн контекст — санамсаргүй мэдээлэл ОРОХГҮЙ.
                AssistantLog.DocUid = docUid;
                AssistantLog.RevitVersion =
                    ctxJson.TryGetProperty("revit_version", out JsonElement rv) ? rv.GetString() : null;
                AssistantLog.ProjectId = st.ProjectId;

                HeaderText.Text = _context?.Document?.ProjectName ?? "MGL туслах";
                SetConnected(true, fileName);

                var choices = (_context?.Resolved ?? new List<ResolvedTaskDto>())
                    .Select(r => new TaskChoice { Data = r })
                    .ToList();
                TaskCombo.ItemsSource = choices;
                if (choices.Count > 0) TaskCombo.SelectedIndex = 0;
                else { _checklist.Clear(); StatusText.Text = Lang.T("Ажил алга", "No tasks"); }

                int unbound = _context?.UnboundSheetUids?.Count ?? 0;
                if (choices.Count == 0)
                {
                    ExplainEmptyTaskList();
                }
                else if (!silent)
                {
                    Say(ChatKind.System, Lang.T(
                        choices.Count + " ажил уншлаа",
                        choices.Count + " tasks loaded"));
                    if (unbound > 0) OfferSheetBinding(unbound);
                }
            }
            catch (ApiException ex) when (ex.StatusCode == 404)
            {
                // ⚠️ ЭНЭ НЬ ХОЛБОЛТЫН АЛДАА БИШ.  Вэб АЖИЛЛАЖ байна; энэ .rvt
                // файл `revit_documents`-д бүртгэгдээгүй л байна.  Урьд нь
                // ерөнхий `catch`-д унаж «Вэб холбогдоогүй» гэж ТӨӨРӨГДҮҮЛЖ,
                // хэрэглэгч сүлжээгээ шалгаж цаг үрдэг байв.
                //
                // Энэ бол ХЭВИЙН эхлэлийн төлөв: шинэ файл нээх бүрд тохиолдоно.
                // Тиймээс алдаа гэж харуулахгүй — ДАРААГИЙН АЛХМЫГ санал болгоно.
                SetConnected(false, Lang.T("Файл холбогдоогүй", "File not linked"));
                OfferRegistration();
            }
            catch (UnauthorizedException)
            {
                SetConnected(false, "Нэвтрэлт дууссан");
                Say(ChatKind.Error, "Нэвтрэлт хүчингүй болжээ. Тохиргоо цонхноос дахин нэвтэрнэ үү.");
            }
            catch (Exception ex)
            {
                SetConnected(false, "Вэб холбогдоогүй");

                // ⚠️ ШАЛТГААНЫГ ЗААВАЛ ХЭЛНЭ.  Урьд нь энэ салаа `silent`
                // үед ЮУ Ч хэлдэггүй байсан тул самбар «Вэб холбогдоогүй»
                // гэж зогсоод, хэрэглэгч ч, засварлагч ч яагаад гэдгийг
                // мэдэх аргагүй байв.  2026-08-25-нд ЯГ ЭНЭ нь Cloudflare-ийн
                // User-Agent хаалтыг (403 / error code 1010) хэдэн цагаар
                // нуусан — токен, хаяг, нэвтрэлт бүгд зөв мөртлөө.
                //
                // Сесс тутамд НЭГ УДАА хэлнэ: дахин ачаалал бүрд давтвал
                // чатыг дүүргэнэ, гэхдээ огт хэлэхгүй байх нь бүр дор.
                if (!_saidWebError)
                {
                    _saidWebError = true;
                    string host = Settings?.ApiHost ?? "?";
                    Say(ChatKind.Error, Lang.T(
                        "Вэб рүү холбогдож чадсангүй — явцын хэсэг ажиллахгүй " +
                        "(чат хэвээр ажиллана).\n" +
                        "  хаяг: " + host + "\n" +
                        "  шалтгаан: " + ex.Message,
                        "Could not reach the web app — progress features are off " +
                        "(chat still works).\n" +
                        "  host: " + host + "\n" +
                        "  reason: " + ex.Message));
                }
                System.Diagnostics.Debug.WriteLine("[MGL] context: " + ex);
            }
            finally
            {
                SetBusy(false);
            }
        }

        /* ============================================================== */
        /*  Багийн контекст — chip ба залруулга (2-1 §3.11)                */
        /* ============================================================== */

        /// <summary>
        /// Chip-ийг шинэчилнэ.  ⚠️ ЯГ ГУРВАН ХОРИГ:
        ///   (1) `SetBusy` ХЭРЭГЛЭХГҮЙ — тэр нь `Mouse.OverrideCursor`-ыг
        ///       АППЛИКЕЙШН ДАМЖУУЛАН тавьдаг; арын chip нь юу ч блоклоогүй
        ///       байхад БҮХ Revit-ийг «завгүй» болгож харагдуулна.
        ///   (2) `DockablePane.Show()` / `Focus()` ХЭЗЭЭ Ч ДУУДАХГҮЙ.  Add-in
        ///       дахь цорын ганц `Show()` нь хэрэглэгчийн ribbon даралт
        ///       (`AssistantPaneProvider.cs:54`).  Самбар хаалттай бол chip
        ///       зүгээр л ХҮЛЭЭНЭ — файл нээх бүрт 300 px булаах нь R7-ийн
        ///       эвдрэл.
        ///   (3) `ChangeTracker.Gate` эсвэл tool-bus `Gate` барьсан thread-ээс
        ///       ХЭЗЭЭ Ч дуудахгүй.  Энэ арга нь ЗӨВХӨН UI thread дээр
        ///       ажиллана; арын дуудагч `Dispatcher.InvokeAsync`
        ///       (галт-мартах) ашиглана, `Invoke` БИШ — UI thread өөрөө
        ///       `lock (Gate)`-д блоклогдож болох тул синхрон marshalling нь
        ///       хоёр thread-ийн deadlock.
        ///
        /// ⚠️ ЮУ Ч ШААРДАХГҮЙ.  Дүрмийн багцгүй баг (MGMT / EZ / GT) нь
        /// МЭДЭГДЭЖ байгаа баг — chip түүнийг НЭРЛЭНЭ («Баг: EZ (дүрмийн
        /// багцгүй)»), «тодорхойгүй» гэж ХЭЛЭХГҮЙ, залруулга ч ШААРДАХГҮЙ.
        /// «тодорхойгүй» нь ЗӨВХӨН жинхэнэ илрүүлэлтийн уналт.
        /// </summary>
        private void SetTeamChip(TeamContext.State s)
        {
            if (s == null)
            {
                // Кэш ч, хариу ч алга — chip-ийг ОГТ харуулахгүй.  Хоосон
                // chip нь «add-in эвдэрсэн» гэж уншигдана.
                TeamChip.Visibility = Visibility.Collapsed;
                TeamPickHost.Visibility = Visibility.Collapsed;
                return;
            }

            bool mn = Lang.Current == UiLang.Mn;
            string text = TeamContext.ChipText(s, mn);

            // Сүлжээгүй хоносон кэш — тоог нь харуулсаар байх нь ЗӨВ
            // (§75-ын доройтол), гэхдээ ХУУЧИН гэдгийг нь хэлнэ.
            if (TeamContext.IsStale(s, DateTimeOffset.UtcNow.ToUnixTimeSeconds()))
                text += mn ? " · хуучин" : " · stale";

            TeamChipText.Text = text;
            TeamChip.ToolTip = mn
                ? "Багийг сервер тодорхойлдог. Буруу бол «…» дээр дарж залруулна уу."
                : "The team is resolved by the server. Use the ... button to correct it.";

            // ⚠️ Залруулгын товч нь СОНГОЛТ, ШААРДЛАГА БИШ.  Ростер ирээгүй
            //    бол сонгох зүйл байхгүй тул нуугдана.
            TeamChipFix.Visibility = _teamRoster != null && _teamRoster.Count > 0
                ? Visibility.Visible
                : Visibility.Collapsed;

            TeamChip.Visibility = Visibility.Visible;
        }

        /// <summary>
        /// Баримт солигдоход арын thread дээр багийн контекст асууна.
        ///
        /// ⚠️ `Task.Run` — HTTP-г UI thread дээр хүлээх нь самбарыг гацаана.
        /// Энэ арга нь tool-bus-д ОГТ хүрэхгүй, зөвхөн HTTP; `ChangeTracker`
        /// -ийн `Gate`-ийг ч хөндөхгүй.
        ///
        /// ⚠️ Алдаа гарвал ЧИМЭЭГҮЙ — кэшийн утга үлдэнэ, хэрэглэгчид юу ч
        /// харагдахгүй (§75).  Сүлжээгүй Revit БҮРЭН хэвийн ажиллана.
        ///
        /// ⚠️ ДУУДАГДАХ ЦОРЫН ГАНЦ ГАЗАР: `ReloadAsync`, `docUid` тодорхой
        /// болсны дараа.  `ReloadAsync` бол `get_document_context`-ыг дахин
        /// уншдаг ГАНЦ зам тул тэр нэг цэг нь самбар ачаалагдах, «Шинэчлэх»
        /// товч, холбоос үүсгэсний дараах дахин уншилт — БҮГДИЙГ хамарна.
        /// Тусдаа `DocumentOpened` захиалга НЭМЭХГҮЙ.
        ///
        /// ⛔ `ChangeTracker.OnDocumentChanged`-ээс ХЭЗЭЭ Ч БИШ.
        /// </summary>
        private void RefreshTeamContextSoon(string docUid)
        {
            _teamDocUid = docUid;

            // Кэшийг ШУУД зурна — сүлжээ удаан/байхгүй байсан ч chip
            // хоосон үлдэхгүй (`App.OnStartup` нь `LoadCache()`-ыг
            // `TeamContext.Current`-д аль хэдийн тавьсан).
            TeamContext.State cached = TeamContext.Current;
            if (cached != null) SetTeamChip(cached);

            AddinSettings st = Settings;
            if (string.IsNullOrEmpty(st.Token)) return;

            long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            if (!TeamContext.ShouldRefresh(cached, now)) return;   // 15 мин доторх — сүлжээ хөндөхгүй

            _ = Task.Run(async () =>
            {
                try
                {
                    TeamContextResult r = await RevitApi
                        .GetTeamContextAsync(st.ApiHost, st.Token, docUid, st.ProjectId,
                                             st.TeamOverride)
                        .ConfigureAwait(false);
                    if (r == null) return;

                    // ⚠️ Талбаруудыг ЗАДЛАЖ өгнө — `TeamContext.cs` нь
                    //    `RevitApi`-гийн DTO-г МЭДЭХГҮЙ (тэр нь Revit-гүй
                    //    тестийн хамрах хүрээнд байхын тулд).
                    TeamContext.State fresh = TeamContext.FromResult(
                        r.TeamCode, r.Confidence, r.Source, r.LastVerified,
                        r.Conflict == null ? null : r.Conflict.ToArray(),
                        r.Candidates == null
                            ? null
                            : r.Candidates.Select(c => c.TeamCode).ToArray(),
                        // ⚠️ Багцтай эсэхийг СЕРВЕРИЙН `scopes`-оос гаргана —
                        //    клиент багцтай багуудын ЖАГСААЛТЫГ ХЭЗЭЭ Ч
                        //    хадгалахгүй (⛔ хориг 11).  `compliance_enabled`
                        //    нь `null` (дүрмийн бүртгэл ХООСОН) үед `scopes`
                        //    нь «TEAM»-ыг АГУУЛСААР байдаг тул энэ буулгалт
                        //    БҮХ багийг «багцгүй» гэж худал шошгохгүй.
                        r.Scopes != null && r.Scopes.Contains("TEAM"),
                        DateTimeOffset.UtcNow.ToUnixTimeSeconds());

                    TeamContext.Current = fresh;
                    TeamContext.SaveCache(fresh);   // диск — АРЫН thread дээр

                    List<TeamRosterDto> roster = r.Teams ?? new List<TeamRosterDto>();
                    await Dispatcher.InvokeAsync(() =>
                    {
                        _teamRoster = roster;
                        SetTeamChip(fresh);
                    });
                }
                catch
                {
                    // Офлайн / 5 секундын timeout / 401 — кэшийн chip хэвээр (§75).
                }
            });
        }

        /// <summary>
        /// «…» — самбар доторх сонгогчийг нээнэ (§71-R2-ийн verification).
        /// ⚠️ МОДАЛЬ ДИАЛОГ БИШ: ажлыг зогсоохгүй, хаах товчтой.
        /// </summary>
        private void TeamChipFix_Click(object sender, RoutedEventArgs e)
        {
            if (TeamPickHost.Visibility == Visibility.Visible)
            {
                TeamPickHost.Visibility = Visibility.Collapsed;
                return;
            }

            List<TeamRosterDto> roster = _teamRoster ?? new List<TeamRosterDto>();
            if (roster.Count == 0) return;

            var choices = roster
                .OrderBy(t => t.SortOrder)
                .Select(t => new TeamChoice { Code = t.Code, NameMn = t.NameMn })
                .ToList();
            TeamPickCombo.ItemsSource = choices;

            // Урьдчилан тэмдэглэх дараалал: одоогийн шийдвэр → эхний нэр
            // дэвшигч → жагсаалтын эхний мөр.  Хэрэглэгч «юу ч сонгоогүй»
            // хоосон combo харах ЁСГҮЙ.
            TeamContext.State cur = TeamContext.Current;
            string preferred = cur == null ? null : cur.TeamCode;
            if (string.IsNullOrEmpty(preferred) &&
                cur != null && cur.Candidates != null && cur.Candidates.Length > 0)
            {
                preferred = cur.Candidates[0];
            }
            int idx = preferred == null
                ? -1
                : choices.FindIndex(
                    x => string.Equals(x.Code, preferred, StringComparison.OrdinalIgnoreCase));
            TeamPickCombo.SelectedIndex = idx >= 0 ? idx : 0;

            TeamPickHost.Visibility = Visibility.Visible;
        }

        private void TeamPickCancel_Click(object sender, RoutedEventArgs e)
        {
            TeamPickHost.Visibility = Visibility.Collapsed;
        }

        /// <summary>
        /// Залруулгыг серверт илгээнэ (`POST /team-context/verify`).
        ///
        /// ⚠️ ЭНЭ БОЛ ХҮСЭЛТ, ЗАРЛАЛ БИШ.  Сервер `user_teams`-ээр эрхийг
        /// шалгаад 403 өгч болно — тэр үед chip ХЭВЭЭР үлдэж, шалтгааныг
        /// чат мөрөнд хэлнэ.
        ///
        /// ⚠️ `SetBusy` ХЭРЭГЛЭХГҮЙ (⛔ хориг 9) — зөвхөн товчийг унтраана.
        /// </summary>
        private void TeamPickApply_Click(object sender, RoutedEventArgs e)
        {
            var pick = TeamPickCombo.SelectedItem as TeamChoice;
            if (pick == null || string.IsNullOrWhiteSpace(pick.Code)) return;

            AddinSettings st = Settings;
            if (string.IsNullOrEmpty(st.Token)) return;

            string docUid = _teamDocUid;
            string code = pick.Code;
            bool sticky = TeamPickSticky.IsChecked == true;

            TeamPickApply.IsEnabled = false;
            _ = Task.Run(async () =>
            {
                TeamContextResult r = null;
                string err = null;
                try
                {
                    r = await RevitApi
                        .VerifyTeamAsync(st.ApiHost, st.Token, docUid, st.ProjectId, code, sticky)
                        .ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    err = RevitApi.FriendlyError(ex);
                }

                TeamContext.State fresh = null;
                if (r != null)
                {
                    fresh = TeamContext.FromResult(
                        r.TeamCode, r.Confidence, r.Source, r.LastVerified,
                        r.Conflict == null ? null : r.Conflict.ToArray(),
                        r.Candidates == null
                            ? null
                            : r.Candidates.Select(c => c.TeamCode).ToArray(),
                        r.Scopes != null && r.Scopes.Contains("TEAM"),
                        DateTimeOffset.UtcNow.ToUnixTimeSeconds());
                    TeamContext.Current = fresh;
                    TeamContext.SaveCache(fresh);
                }

                List<TeamRosterDto> roster = r == null ? null : r.Teams;
                bool stuck = r != null && r.Sticky;
                await Dispatcher.InvokeAsync(() =>
                {
                    TeamPickApply.IsEnabled = true;
                    if (fresh == null)
                    {
                        Say(ChatKind.Error, Lang.T(
                            "Багийг залруулж чадсангүй. " + (err ?? ""),
                            "Could not correct the team. " + (err ?? "")));
                        return;
                    }
                    if (roster != null && roster.Count > 0) _teamRoster = roster;
                    TeamPickHost.Visibility = Visibility.Collapsed;
                    SetTeamChip(fresh);
                    Say(ChatKind.System, Lang.T(
                        "Баг " + code + " гэж тэмдэглэгдлээ" +
                        (stuck ? " (энэ файлд байнга)." : "."),
                        "Team set to " + code + (stuck ? " (sticky on this file)." : ".")));
                });
            });
        }

        /// <summary>
        /// Жагсаалт хоосон байх ГУРВАН өөр шалтгааныг ЯЛГАЖ хэлнэ.
        ///
        /// ⚠️ 2026-08-26 хүртэл гурвуулангийнх нь хариу «Энэ файлд холбогдсон
        /// ажил алга. MGL → Зураг холбох…» гэсэн ГАНЦ мөр байв.  Бодит шалтгаан
        /// нь ихэвчлэн «танд энэ төсөлд ажил хуваарилагдаагүй» байдаг тул
        /// хэрэглэгч 22 хуудсаа гараар холбож үзсэн ч юу ч өөрчлөгддөггүй байсан.
        /// </summary>
        private void ExplainEmptyTaskList()
        {
            ContextResult ctx = _context;
            int bound = ctx?.BoundTaskCount ?? 0;
            bool manager = ctx?.IsManager ?? false;
            bool showingAll = string.Equals(ctx?.Scope, "all", StringComparison.Ordinal);
            string pname = ctx?.Document?.ProjectName;
            if (string.IsNullOrWhiteSpace(pname)) pname = Settings?.ProjectName ?? "—";

            var sb = new System.Text.StringBuilder();
            sb.Append(Lang.T(
                "Танд «" + pname + "» төсөлд хуваарилагдсан ажил алга.",
                "You have no tasks assigned in \u201C" + pname + "\u201D."));

            if (bound > 0 && !showingAll)
            {
                sb.Append(Lang.T(
                    "\nФайлд " + bound + " ажил холбогдсон боловч бүгд өөр хүнийх байна.",
                    "\n" + bound + " task(s) are linked to this file, but none are yours."));
            }
            else
            {
                sb.Append(Lang.T(
                    "\nВэб дээрх «Миний ажил» хуудаснаас ажлаа авбал энд шууд гарна — " +
                    "хуудас холбох шаардлагагүй.",
                    "\nPick up a task on the web \u201CMy tasks\u201D page and it appears " +
                    "here — no sheet linking needed."));
            }
            Say(ChatKind.Assistant, sb.ToString());

            var acts = new List<SuggestItem>();
            if (manager && !showingAll && bound > 0)
            {
                acts.Add(new SuggestItem
                {
                    Intent = UiAction + "scope_all",
                    Label = Lang.T("Файлын бүх ажлыг харах", "Show every task on this file"),
                });
            }
            acts.Add(new SuggestItem
            {
                Intent = UiAction + "settings",
                Label = Lang.T("Өөр төсөл сонгох", "Pick another project"),
            });
            ShowActions(acts.ToArray());
        }

        /// <summary>
        /// Хуудас холбогдоогүй байгааг САНУУЛНА — гэхдээ ЗОГСООХГҮЙ.
        ///
        /// ⚠️ Холбоос нь 2026-08-26-наас хойш ажлын жагсаалтын НӨХЦӨЛ БИШ.
        /// Тэр нь зөвхөн хоёр зүйлийг НЭМДЭГ: дэд жагсаалтыг хуудсаас
        /// автоматаар үүсгэх, «энэ ажлын хуудсыг харуул» гэсэн тусгаарлалт.
        /// Сесс тутамд НЭГ УДАА — дахин ачаалал бүрд давтвал чатыг дүүргэнэ.
        /// </summary>
        private void OfferSheetBinding(int unbound)
        {
            if (_saidUnbound) return;
            _saidUnbound = true;
            Say(ChatKind.System, Lang.T(
                unbound + " хуудас ажилтай холбогдоогүй байна (заавал биш).  " +
                "MGL → «Зураг холбох» товчоор нэг удаа холбовол дэд жагсаалт " +
                "автоматаар үүсч, «энэ ажлын хуудсыг харуул» ажиллана.",
                unbound + " sheet(s) are not linked to a task (optional).  " +
                "Use MGL \u2192 \u201CLink sheets\u201D once and the checklist is " +
                "created for you."));
        }

        /// <summary>
        /// Файл бүртгэгдээгүй үед ДАРААГИЙН АЛХМЫГ санал болгоно.
        ///
        /// ⚠️ Мухар зам байсан: «Вэб холбогдоогүй» гээд зогсох ба хэрэглэгч
        /// туузан цэсний «Зураг холбох» товчийг мэдэхгүй бол гацна.  Судалгаа
        /// үүнийг «бүтээгдэхүүн хэрэглэгдэхгүй болох гол эрсдэл» гэж нэрлэсэн.
        /// </summary>
        private void OfferRegistration()
        {
            AddinSettings st = Settings;

            if (!st.ProjectId.HasValue)
            {
                Say(ChatKind.Assistant, Lang.T(
                    "Энэ файл MGL-д бүртгэгдээгүй байна.\n" +
                    "Эхлээд MGL → Тохиргоо цонхноос ТӨСЛӨӨ сонгоно уу.",
                    "This file is not registered in MGL.\n" +
                    "First pick a PROJECT in MGL → Settings."));
                return;
            }

            string pname = string.IsNullOrWhiteSpace(st.ProjectName)
                ? "#" + st.ProjectId.Value
                : st.ProjectName;

            Say(ChatKind.Assistant, Lang.T(
                "Энэ файл MGL-д бүртгэгдээгүй байна.\n" +
                "Төсөл: " + pname + "\n" +
                "Холбовол явц тань өөрөө тоологдож эхэлнэ.",
                "This file is not registered in MGL yet.\n" +
                "Project: " + pname + "\n" +
                "Linking it makes your progress count automatically."));

            ShowActions(
                new SuggestItem
                {
                    Intent = UiAction + "register",
                    Label = Lang.T("Одоо холбох", "Link it now"),
                },
                new SuggestItem
                {
                    Intent = UiAction + "settings",
                    Label = Lang.T("Өөр төсөл сонгох", "Pick another project"),
                });
        }

        /// <summary>
        /// Баримтыг серверт бүртгэнэ (`POST /api/revit/handshake`).
        ///
        /// ⚠️ Туузан цэсний «Зураг холбох» товч ЯГ ҮҮНИЙГ хийдэг — ялгаа нь
        /// тэр нь дараа нь холбох цонх нээдэг.  Энд зөвхөн БҮРТГЭНЭ: гол
        /// зорилго нь `/context`-ийг 404-өөс гаргах.  Хуудас↔ажлын холбоос
        /// хийхийг дараа нь санал болгоно.
        /// </summary>
        private async Task RegisterDocumentAsync()
        {
            if (_busy) return;
            AddinSettings st = Settings;
            if (!st.ProjectId.HasValue) { OfferRegistration(); return; }

            SetBusy(true, Lang.T("Холбож байна…", "Linking…"));
            try
            {
                // Хуудсуудыг гарцаар уншина — `Task.Run` ЗААВАЛ (урхи №10).
                JsonElement js = await Task.Run(() => RevitApi.CallTool("list_sheets"));
                var sheets = new List<RevitTools.SheetDto>();
                if (js.TryGetProperty("sheets", out JsonElement arr) &&
                    arr.ValueKind == JsonValueKind.Array)
                {
                    foreach (JsonElement x in arr.EnumerateArray())
                    {
                        sheets.Add(new RevitTools.SheetDto
                        {
                            uid = x.TryGetProperty("uid", out JsonElement u) ? u.GetString() : null,
                            number = x.TryGetProperty("number", out JsonElement nn) ? nn.GetString() : "",
                            name = x.TryGetProperty("name", out JsonElement na) ? na.GetString() : "",
                            placed_view_count =
                                x.TryGetProperty("placed_view_count", out JsonElement pc) &&
                                pc.TryGetInt32(out int pv) ? pv : 0,
                        });
                    }
                }

                if (sheets.Count == 0)
                {
                    Say(ChatKind.Error, Lang.T(
                        "Энэ файлд хуудас алга. Явцын бүртгэл ХУУДАС дээр тулгуурладаг — " +
                        "эхлээд хуудсуудаа үүсгэнэ үү.",
                        "This file has no sheets. Progress tracking is sheet-based — " +
                        "create your sheets first."));
                    return;
                }

                JsonElement ctx = await Task.Run(() => RevitApi.CallTool("get_document_context"));
                string docUid = ctx.TryGetProperty("doc_uid", out JsonElement du) ? du.GetString() : null;
                string fileName = ctx.TryGetProperty("file_name", out JsonElement fn) ? fn.GetString() : "";
                string ver = ctx.TryGetProperty("revit_version", out JsonElement rv) ? rv.GetString() : null;
                bool isLink = ctx.TryGetProperty("is_link", out JsonElement il) &&
                              il.ValueKind == JsonValueKind.True;

                await Task.Run(() => RevitApi.HandshakeAsync(
                    st.ApiHost, st.Token, st.ProjectId.Value,
                    docUid, fileName, ver, isLink, sheets));

                Say(ChatKind.System, Lang.T(
                    "Холбогдлоо — " + sheets.Count + " хуудас бүртгэв.",
                    "Linked — " + sheets.Count + " sheets registered."));

                // Дахин уншина: одоо `/context` 200 буцаах ёстой.
                await ReloadAsync(silent: false);
            }
            catch (UnauthorizedException)
            {
                Say(ChatKind.Error, Lang.T(
                    "Нэвтрэлт хүчингүй болжээ. MGL → Тохиргоо цонхноос дахин нэвтэрнэ үү.",
                    "Your session expired. Sign in again in MGL → Settings."));
            }
            catch (Exception ex)
            {
                Say(ChatKind.Error, Lang.T(
                    "Холбож чадсангүй: " + RevitApi.FriendlyError(ex),
                    "Could not link: " + RevitApi.FriendlyError(ex)));
            }
            finally { SetBusy(false); }
        }

        private ResolvedTaskDto Current => (TaskCombo.SelectedItem as TaskChoice)?.Data;

        private void TaskCombo_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            ResolvedTaskDto r = Current;
            ClearDraft();

            _suppressToggle = true;
            _checklist.Clear();
            if (r != null)
            {
                foreach (ChecklistItemDto it in r.Checklist?.Items ?? new List<ChecklistItemDto>())
                    _checklist.Add(new ChecklistRow { Id = it.Id, Text = it.Text, IsDone = it.IsDone == 1 });
                UpdateStatusLine();
            }
            _suppressToggle = false;
        }

        /// <summary>
        /// Тэмдэглэсэн мөрийг кэшлэгдсэн `ResolvedTaskDto`-д буулгана.  `_checklist`
        /// нь ажил солих бүрт ЭНЭ DTO-гоос дахин баригддаг тул зөвхөн UI-г
        /// өөрчилвөл хэрэглэгч ажлаа сольж буцахад тэмдэглэгээ нь алга болж,
        /// «хадгалагдаагүй юм байна» гэж эргэлздэг.
        /// </summary>
        private void SyncChecklistCache(ChecklistRow row)
        {
            ChecklistDto cl = Current?.Checklist;
            if (cl?.Items == null) return;
            foreach (ChecklistItemDto it in cl.Items)
            {
                if (it.Id != row.Id) continue;
                it.IsDone = row.IsDone ? 1 : 0;
                break;
            }
            cl.Done = cl.Items.Count(i => i.IsDone == 1);
            cl.Total = cl.Items.Count;
        }

        private void UpdateStatusLine()
        {
            ResolvedTaskDto r = Current;
            if (r == null) { StatusText.Text = string.Empty; return; }
            int done = _checklist.Count(c => c.IsDone);
            StatusText.Text =
                $"Явц {Math.Round(r.CurrentProgress)}%  ·  дэд жагсаалт {done}/{_checklist.Count}" +
                (r.ReportedToday ? "  ·  өнөөдөр бүртгэсэн" : "");
        }

        /* ============================================================== */
        /*  Өөрчлөлтүүд — «яг юуг нь хийсэн бэ» + тэр рүү нь үсрэх         */
        /* ============================================================== */

        /// <summary>
        /// Нэг л хэсэг нээлттэй байна.  ⚠️ Олон хэсэг (дэд жагсаалт, өөрчлөлт, Revit шинжилгээ, норм шалгалт) зэрэг
        /// задарвал 300–420 DIP самбарт яриа/оролтын мөр доош түлхэгдэж харагдахаа болдог байв.  ЗӨВХӨН хаана —
        /// хэзээ ч өөрөө НЭЭХГҮЙ (самбар/хэсэг өөрөө нээгдэхгүй гэсэн хуучин амлалт хэвээр).
        /// </summary>
        private bool _exclusiveGuard;

        private void CollapseOthers(System.Windows.Controls.Primitives.ToggleButton keep, bool keepFindings)
        {
            if (_exclusiveGuard) return;
            _exclusiveGuard = true;
            try
            {
                foreach (System.Windows.Controls.Primitives.ToggleButton t in new[] { ChecklistToggle, ChangesToggle, IntelToggle })
                    if (!ReferenceEquals(t, keep) && t != null && t.IsChecked == true) t.IsChecked = false;
                if (!keepFindings && FindingsExpander != null && FindingsExpander.IsExpanded) FindingsExpander.IsExpanded = false;
            }
            finally { _exclusiveGuard = false; }
        }

        private async void ChangesToggle_Changed(object sender, RoutedEventArgs e)
        {
            bool open = ChangesToggle.IsChecked == true;
            if (open) CollapseOthers(ChangesToggle, false);
            ChangesHost.Visibility = open ? Visibility.Visible : Visibility.Collapsed;
            if (open && _changes.Count == 0) await LoadChangesAsync(false);
        }

        private async void ChangesRefresh_Click(object sender, RoutedEventArgs e)
        {
            await LoadChangesAsync(false);
        }

        /// <summary>
        /// SESSION R — «MGL AI» хост (strangler, R-1).  Агуулга нь АНХ дарахад л
        /// үүснэ (lazy) — самбар нээгдэх бүрд Intelligence-ийн VM ажиллахгүй.
        /// net48 build-д `Intelligence/` байхгүй тул товч зөвхөн мессеж харуулна.
        /// </summary>
        private void IntelToggle_Changed(object sender, RoutedEventArgs e)
        {
            bool open = IntelToggle.IsChecked == true;
            if (open) CollapseOthers(IntelToggle, false);
            IntelligenceHost.Visibility = open ? Visibility.Visible : Visibility.Collapsed;
            if (!open || IntelligenceHost.Child != null) return;
#if MGL_INTELLIGENCE
            try
            {
                IntelligenceHost.Child = new Intelligence.Ui.IntelligencePanel();
            }
            catch (Exception ex)
            {
                IntelligenceHost.Child = new TextBlock
                {
                    Text = "MGL AI самбар үүсгэж чадсангүй: " + ex.Message,
                    Style = (Style)FindResource("MutedText"),
                    Margin = new Thickness(8),
                };
            }
#else
            IntelligenceHost.Child = new TextBlock
            {
                Text = "MGL AI (Revit Intelligence) нь Revit 2025+ дээр л байна.",
                Style = (Style)FindResource("MutedText"),
                Margin = new Thickness(8),
            };
#endif
        }

        /// <summary>
        /// Суурь дахин тавигдсан үед жагсаалтыг хоослоно.
        /// ⚠️ Эс тэгвээс илгээсний дараа «өөрчлөгдсөн» гэж хуучин мөрүүд үлдэж,
        /// хүн тэднийг ДАХИН тайлагнах эрсдэлтэй.
        /// </summary>
        private void ClearChanges()
        {
            _changes.Clear();
            _collapsedGroups.Clear();
            if (ChangesSummary != null) ChangesSummary.Text = string.Empty;
        }

        private async Task LoadChangesAsync(bool openPanel)
        {
            if (_busy) return;
            SetBusy(true, Lang.T("Өөрчлөлтийг уншиж байна…", "Reading changes…"));
            try
            {
                JsonElement js = await Task.Run(() => RevitApi.CallTool("list_changes"));
                ChangesResult res = JsonSerializer.Deserialize<ChangesResult>(
                    js.GetRawText(), ApiClient.ReadOptions);
                RenderChanges(res);
                if (openPanel && ChangesToggle.IsChecked != true) ChangesToggle.IsChecked = true;
            }
            catch (Exception ex)
            {
                Say(ChatKind.Error, Lang.T(
                    "Өөрчлөлтийн жагсаалтыг уншиж чадсангүй: " + ex.Message,
                    "Could not read the change list: " + ex.Message));
            }
            finally { SetBusy(false); }
        }

        private void RenderChanges(ChangesResult res)
        {
            _changes.Clear();
            if (res == null) { ChangesSummary.Text = string.Empty; return; }

            var warn = new HashSet<string>(
                res.Warnings ?? new List<string>(), StringComparer.Ordinal);

            if (warn.Contains("no_baseline"))
            {
                ChangesSummary.Text = Lang.T(
                    "Суурь тэмдэглэгээ алга — «эхлэл тэмдэглэ» гэнэ үү.",
                    "No baseline yet — say \u201Cset baseline\u201D.");
                return;
            }

            foreach (ChangeGroupDto g in res.Groups ?? new List<ChangeGroupDto>())
            {
                string key = g.Key ?? string.Empty;
                bool collapsed = _collapsedGroups.Contains(key);

                _changes.Add(new ChangeRow
                {
                    IsHeader = true,
                    GroupKey = key,
                    Label = g.Label,
                    Right = g.Count.ToString(CultureInfo.InvariantCulture),
                    Collapsed = collapsed,
                    Hint = Lang.T("Задлах / хураах", "Expand / collapse"),
                });

                foreach (ChangeItemDto it in g.Items ?? new List<ChangeItemDto>())
                {
                    _changes.Add(new ChangeRow
                    {
                        GroupKey = key,
                        ElementId = it.Id,
                        Label = string.IsNullOrWhiteSpace(it.TypeName) ? g.Label : it.TypeName,
                        Sub = SubLineOf(it),
                        Right = it.At,
                        Visible = !collapsed,
                        Hint = Lang.T(
                            "Дарвал энэ элемент рүү үсэрч тодруулна",
                            "Click to jump to this element and highlight it"),
                    });
                }

                if (g.More > 0)
                {
                    _changes.Add(new ChangeRow
                    {
                        IsNote = true,
                        GroupKey = key,
                        Label = "… + " + g.More.ToString(CultureInfo.InvariantCulture),
                        Visible = !collapsed,
                    });
                }
            }

            var sb = new System.Text.StringBuilder();
            sb.Append(res.VisibleTotal).Append(Lang.T(" өөрчлөлт", " changes"));

            // ⚠️ НУУСАН ТООГ ЗААВАЛ ХЭЛНЭ.  Revit нэг хана зөөхөд түүний эскиз,
            // залгаа хана, өрөөний зааг зэргийг ч «өөрчлөгдсөн» гэж мэдэгддэг.
            // Тэднийг чимээгүй хаявал энэ тоо чатын нийт тоотой таарахгүй бөгөөд
            // хэрэглэгч алдаа гэж бодно.
            if (res.HiddenTotal > 0)
            {
                sb.Append(Lang.T(
                    "  ·  " + res.HiddenTotal + " дотоод элемент нуув",
                    "  ·  " + res.HiddenTotal + " internal hidden"));
            }
            if (res.GoneTotal > 0)
            {
                sb.Append(Lang.T(
                    "  ·  " + res.GoneTotal + " устгасан",
                    "  ·  " + res.GoneTotal + " deleted"));
            }
            if (warn.Contains("meta_truncated"))
                sb.Append(Lang.T("  ·  тайлбар дутуу", "  ·  details truncated"));
            if (warn.Contains("items_capped"))
                sb.Append(Lang.T("  ·  жагсаалт таслагдсан", "  ·  list truncated"));

            // ⚠️ «ЭРГЭЛТ» — ЗӨВХӨН ӨӨРТӨӨ.  Нэг зүйлийг дунджаар хэдэн удаа
            // хөндсөн бэ.  Өндөр байх нь МУУ ажилтан гэсэн үг БИШ — суралцаж
            // яваа хүнд хэвийн.  Тиймээс энэ тоо ахлагчийн тайланд ОРДОГГҮЙ,
            // зөвхөн инженер өөрөө «энд хэт удаан эргэлдсэн байна» гэдгээ
            // хармаар бол харна (2026-08-26-ны шийдвэр).
            if (res.VisibleTotal > 0 && res.TotalTouches > res.VisibleTotal)
            {
                double churn = (double)res.TotalTouches / res.VisibleTotal;
                if (churn >= 2.0)
                {
                    string x = churn.ToString("0.#", CultureInfo.InvariantCulture);
                    sb.Append(Lang.T("  ·  эргэлт " + x + "×", "  ·  churn " + x + "×"));
                }
            }

            ChangesSummary.Text = sb.ToString();
        }

        /// <summary>«Хана 12 · Багана 3 · Шал 2» — ноорогт харуулах товч мөр.</summary>
        private static string SummaryLineOf(ChangesResult cr)
        {
            if (cr == null || cr.VisibleTotal == 0)
                return Lang.T("Загварт өөрчлөлт олдсонгүй.", "No model changes found.");

            var parts = new List<string>();
            foreach (ChangeGroupDto g in cr.Groups ?? new List<ChangeGroupDto>())
            {
                if (parts.Count >= 6) break;
                parts.Add(g.Label + " " + g.Count.ToString(CultureInfo.InvariantCulture));
            }
            return string.Join("  ·  ", parts);
        }

        /// <summary>«1-р давхар · зассан · зөөсөн» гэсэн хоёр дахь мөр.</summary>
        private static string SubLineOf(ChangeItemDto it)
        {
            var parts = new List<string>(3);
            if (!string.IsNullOrWhiteSpace(it.Level)) parts.Add(it.Level);
            if (!string.IsNullOrWhiteSpace(it.KindLabel)) parts.Add(it.KindLabel);
            if (!string.IsNullOrWhiteSpace(it.OpLabel) &&
                !string.Equals(it.OpLabel, it.KindLabel, StringComparison.OrdinalIgnoreCase))
            {
                parts.Add(it.OpLabel);
            }
            // «20 удаа» — энэ элемент дээр хэр удаан эргэлдсэн.  ЗӨВХӨН энд;
            // ахлагчийн тайланд хэзээ ч орохгүй.
            if (it.Hits > 1) parts.Add(it.Hits + Lang.T(" удаа", "×"));
            return string.Join("  ·  ", parts);
        }

        private async void ChangeRow_Click(object sender, RoutedEventArgs e)
        {
            var row = (sender as Button)?.Tag as ChangeRow;
            if (row == null || row.IsNote) return;
            if (row.IsHeader) { ToggleGroup(row); return; }
            if (row.ElementId <= 0) return;
            await GotoElementAsync(row);
        }

        private void ToggleGroup(ChangeRow header)
        {
            bool collapse = !header.Collapsed;
            header.Collapsed = collapse;
            if (collapse) _collapsedGroups.Add(header.GroupKey);
            else _collapsedGroups.Remove(header.GroupKey);

            foreach (ChangeRow r in _changes)
            {
                if (r.IsHeader) continue;
                if (!string.Equals(r.GroupKey, header.GroupKey, StringComparison.Ordinal)) continue;
                r.Visible = !collapse;
            }
        }

        /// <summary>
        /// Тухайн элемент рүү үсэрч тодруулна.
        ///
        /// ⚠️ ЭНЭ БОЛ ЦОРЫН ГАНЦ ҮНЭТЭЙ ДУУДЛАГА.  «Аль хуудсанд байгаа» гэдгийг
        /// зөвхөн энд, хэрэглэгч дарсан үед тооцно (2026-08-26-ны шийдвэр) —
        /// жагсаалт гаргахад огт тооцохгүй.  Хэрэгсэл нь өөртөө 2.5 секундын
        /// төсөвтэй тул хамгийн муудаа ч гацахгүй.
        /// </summary>
        private async Task GotoElementAsync(ChangeRow row)
        {
            if (_busy) return;
            SetBusy(true, Lang.T("Олж байна…", "Locating…"));
            try
            {
                JsonElement js = await Task.Run(() =>
                    RevitApi.CallTool("goto_element", new { element_id = row.ElementId }));
                GotoResult g = JsonSerializer.Deserialize<GotoResult>(
                    js.GetRawText(), ApiClient.ReadOptions);

                var sb = new System.Text.StringBuilder();
                sb.Append(row.Label);

                if (!string.IsNullOrWhiteSpace(g?.SheetNumber))
                {
                    sb.Append("  →  ").Append(g.SheetNumber);
                    if (!string.IsNullOrWhiteSpace(g.SheetName)) sb.Append(' ').Append(g.SheetName);
                }
                if (!string.IsNullOrWhiteSpace(g?.ViewName))
                    sb.Append(Lang.T("\nхарагдац: ", "\nview: ")).Append(g.ViewName);

                // Хуудас олдоогүй шалтгааныг ЯЛГАЖ хэлнэ — «байхгүй» ба «шалгаж
                // амжсангүй» хоёр огт өөр зүйл.
                if (g != null && string.IsNullOrWhiteSpace(g.SheetNumber))
                {
                    sb.Append(g.Partial
                        ? Lang.T(
                            "\n(хуудсыг нь олж амжсангүй — " + g.ViewsChecked +
                            " харагдац шалгаад цаг дуусав)",
                            "\n(sheet not found — checked " + g.ViewsChecked +
                            " views before the time budget ran out)")
                        : Lang.T(
                            "\n(энэ элемент ямар ч хуудсанд ороогүй байна)",
                            "\n(this element is not placed on any sheet)"));
                }

                Say(ChatKind.System, sb.ToString());
            }
            catch (Exception ex)
            {
                Say(ChatKind.Error, ex.Message);
            }
            finally { SetBusy(false); }
        }

        private void ChecklistToggle_Changed(object sender, RoutedEventArgs e)
        {
            bool open = ChecklistToggle.IsChecked == true;
            if (open) CollapseOthers(ChecklistToggle, false);
            ChecklistHost.Visibility = open ? Visibility.Visible : Visibility.Collapsed;
            ChecklistToggle.Content = open ? "Дэд жагсаалт ▴" : "Дэд жагсаалт ▾";
        }

        /* ============================================================== */
        /*  Дэд жагсаалт тэмдэглэх                                        */
        /* ============================================================== */

        /// <summary>
        /// ⚠️ Энэ нь `Click` (Checked/Unchecked БИШ).  ItemsControl нь
        /// `Visibility="Collapsed"` доор байхдаа мөрийн контейнерээ үүсгэдэггүй
        /// тул хэрэглэгч дэд жагсаалтыг ДЭЛГЭХ үед л бүх CheckBox үүсч,
        /// тэмдэглэгдсэн мөр БҮР `Checked` үйл явдал өгдөг байв — үр дүнд
        /// сервер рүү утгагүй PATCH явж, бэлдсэн ноорог устдаг.  `Click` нь
        /// зөвхөн ХҮНИЙ үйлдлээр дуудагдана.
        /// </summary>
        private async void Item_Toggled(object sender, RoutedEventArgs e)
        {
            if (_suppressToggle) return;
            if (!((sender as CheckBox)?.DataContext is ChecklistRow row)) return;

            AddinSettings st = Settings;
            try
            {
                await Task.Run(() =>
                    RevitApi.ToggleChecklistAsync(st.ApiHost, st.Token, row.Id, row.IsDone));

                // Кэшлэгдсэн DTO-г ЗААВАЛ дагуулж шинэчилнэ.  TaskCombo-г сольж
                // буцахад `_checklist` нь ЭНЭ DTO-гоос дахин баригддаг тул
                // шинэчлэхгүй бол тэмдэглэсэн зүйл алга болж харагдана.
                SyncChecklistCache(row);
                UpdateStatusLine();

                if (_draft != null)
                {
                    ClearDraft();
                    Say(ChatKind.System, "Дэд жагсаалт өөрчлөгдлөө — ноорогоо дахин гаргана уу.");
                }
            }
            catch (Exception ex)
            {
                // Сервер хүлээж аваагүй бол UI-г БУЦААНА — худал байдал үүсгэхгүй.
                _suppressToggle = true;
                row.IsDone = !row.IsDone;
                _suppressToggle = false;
                Say(ChatKind.Error, "Тэмдэглэж чадсангүй: " + RevitApi.FriendlyError(ex));
            }
        }

        /* ============================================================== */
        /*  Ноорог                                                        */
        /* ============================================================== */

        private void ClearDraft()
        {
            _draft = null;
            _draftUid = null;
            DraftPanel.Visibility = Visibility.Collapsed;
            ConfirmBox.IsChecked = false;
            SubmitBtn.IsEnabled = false;
        }

        private void DiscardBtn_Click(object sender, RoutedEventArgs e)
        {
            ClearDraft();
            Say(ChatKind.System, "Ноорог цуцлагдлаа.");
        }

        /// <summary>
        /// Явцын ноорог гаргана.  `raw` нь хэрэглэгчийн БҮТЭН текст —
        /// «60% болголоо» гэж хэлсэн бол тэр тоог урьдчилж бөглөнө.
        /// </summary>
        private async Task MakeDraftAsync(string raw)
        {
            ResolvedTaskDto r = Current;
            if (r == null)
            {
                Say(ChatKind.Error, Lang.T("Эхлээд ажлаа сонгоно уу.", "Pick your task first."));
                return;
            }
            if (_busy) return;

            ChatMessage thinking = Say(ChatKind.Assistant, "Загварын өөрчлөлтийг шалгаж байна…");
            SetBusy(true, "Шалгаж байна…");
            try
            {
                object change = null;
                try
                {
                    JsonElement diff = await Task.Run(() => RevitApi.CallTool("diff_since_baseline"));
                    var map = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(
                                  diff.GetRawText())
                              ?? new Dictionary<string, JsonElement>();

                    // ⚠️ ЭНД БАЙСАН МӨР ХУДАЛ ХЭЛДЭГ БАЙВ.  Тэр нь
                    // `changed_sheets`-ийн уртыг хэвлэдэг байсан ба тэр талбар
                    // 2026-08-25-наас хойш ҮРГЭЛЖ хоосон массив — өөрөөр хэлбэл
                    // ноорог бүрт «0 хуудас өөрчлөгдсөн байна» гэж гарч,
                    // бодитоор 40 хана зассан ч ялгаагүй байлаа.  Одоо бодит
                    // ангиллын задаргааг харуулна.
                    //
                    // ⚠️ `by_category`-г `change`-д нэмэх нь СЕРВЕРИЙН ӨӨРЧЛӨЛТ
                    // ШААРДАХГҮЙ: `routes/revit.ts` нь `change`-ийг задлахгүйгээр
                    // бүтнээр нь `revit_submissions.change_json`-д хадгалдаг тул
                    // аудитын бичлэг тэр дороо утга учиртай болно.
                    try
                    {
                        JsonElement lc = await Task.Run(() => RevitApi.CallTool("list_changes"));
                        ChangesResult cr = JsonSerializer.Deserialize<ChangesResult>(
                            lc.GetRawText(), ApiClient.ReadOptions);
                        if (cr != null)
                        {
                            var cats = new List<object>();
                            foreach (ChangeGroupDto g in cr.Groups ?? new List<ChangeGroupDto>())
                                cats.Add(new { key = g.Key, label = g.Label, count = g.Count });

                            map["by_category"] = JsonSerializer.SerializeToElement(cats);
                            map["visible_total"] = JsonSerializer.SerializeToElement(cr.VisibleTotal);
                            map["hidden_total"] = JsonSerializer.SerializeToElement(cr.HiddenTotal);

                            // Самбарыг ч шинэчилнэ — хүн илгээхийн өмнө «юуг нь
                            // тайлагнаж байна» гэдгээ жагсаалтаас нь хараад,
                            // мөр дээр дарж шалгаж чадна.
                            RenderChanges(cr);
                            Say(ChatKind.Tool, SummaryLineOf(cr), "list_changes");
                        }
                    }
                    catch
                    {
                        // Задаргаа нь НЭМЭЛТ мэдээлэл — байхгүй нь илгээхийг
                        // зогсоох ёсгүй.
                    }

                    // ⚠️ ТУСДАА дуудлага, САНААТАЙ.  `list_changes` нь самбарын
                    // мөрүүд (хурдан, хуудас хайхгүй); `change_digest` нь
                    // ТАЙЛАНГИЙН баримт бөгөөд бүлэг тутамд хуудсыг нь тогтоохын
                    // тулд 4 секунд хүртэл төсөвтэйгээр харагдац шалгадаг.
                    // Ноорог бэлдэх нь өдөрт нэг удаагийн үйлдэл тул тэр өртөг
                    // зөвтгөгдөнө; самбар нээх бүрд төлөх нь ЗӨВТГӨГДӨХГҮЙ.
                    try
                    {
                        Replace(thinking, Lang.T("Хуудсуудыг тогтоож байна…",
                                                 "Resolving sheets…"));
                        JsonElement dg = await Task.Run(() => RevitApi.CallTool("change_digest"));
                        map["digest"] = JsonSerializer.Deserialize<JsonElement>(dg.GetRawText());
                    }
                    catch
                    {
                        // Хуудас тогтоогдоогүй нь тайланг зогсоохгүй — тэмдэглэл
                        // давхраар нь бичигдэнэ.
                    }

                    change = map;
                    _lastChange = change;
                }
                catch (Exception ex)
                {
                    // Суурь байхгүй / унших боломжгүй нь илгээхийг ЗОГСООХГҮЙ.
                    Say(ChatKind.Tool, "Өөрчлөлтийг уншиж чадсангүй — үргэлжлүүлж байна.", ex.Message);
                }

                Replace(thinking, "Тэмдэглэл бэлдэж байна…");
                SetBusy(true, "Тэмдэглэл бэлдэж байна…");

                AddinSettings st = Settings;
                _draft = await Task.Run(() =>
                    RevitApi.DraftAsync(st.ApiHost, st.Token, r.TaskId, r.SheetUids, change));

                // ⚠️ Idempotency түлхүүрийг ЭНД, НЭГ УДАА үүсгэнэ.
                _draftUid = RevitApi.NewDraftUid();

                double suggested = _draft.SuggestedPercent ?? _draft.CurrentPercent;

                // ⚠️ ХЭРЭГЛЭГЧ ХУВИА ХЭЛСЭН бол ТҮҮНИЙГ авна («БА-01 ыг 60%
                // болголоо»).  Хүн өөрөө тоо хэлсэн байхад загварын таамгийг
                // тулгах нь «сонсдоггүй» мэдрэмж төрүүлнэ — тэр тоог хайж
                // дахин бичих хэрэг гарна.
                //
                // ⚠️ ДЭЭД ХЯЗГААР ХЭВЭЭР ҮЙЛЧИЛНЭ.  `Ceiling` нь ажил бүрэн
                // дуусаагүй үед 99 байдаг тул «100%» гэж хэлсэн ч 99 болно —
                // 100% хаалт нь батламжлах дараалалд ордог, тиймээс санамсаргүй
                // хаалт үүсгэж болохгүй.
                double? said = Slots.Percent(raw);
                bool usedSaid = false;
                if (said.HasValue)
                {
                    double v = Math.Min(said.Value, _draft.Ceiling);
                    if (v > 0) { suggested = v; usedSaid = true; }
                }

                PercentBox.Text = Math.Round(suggested).ToString(CultureInfo.InvariantCulture);
                NoteBox.Text = _draft.NoteMn ?? string.Empty;
                BasisText.Text = string.IsNullOrWhiteSpace(_draft.BasisDetail)
                    ? "гаралтгүй — та өөрөө бичнэ"
                    : _draft.BasisDetail;

                var hints = new List<string>
                {
                    _draft.Fallback
                        ? Lang.T("Загвараар бэлдэв.", "Prepared from the model.")
                        : Lang.T("AI бэлдэв — уншиж, шаардвал засна уу.",
                                 "AI drafted this — read it and edit if needed."),
                };
                // ⚠️ Хэрэглэгчийн хэлсэн тоог авсан бол ХЭЛНЭ.  Чимээгүй
                // солих нь «яагаад ийм тоо гарав?» гэсэн асуулт төрүүлнэ.
                if (usedSaid)
                {
                    hints.Add(Lang.T(
                        "Таны хэлсэн " + Math.Round(suggested) + "%-ийг тавилаа.",
                        "Used the " + Math.Round(suggested) + "% you stated."));
                }
                if (_draft.Warnings?.Contains("no_checklist") == true)
                    hints.Add(Lang.T("Дэд жагсаалт байхгүй тул хувийг та бичнэ.",
                                     "No checklist — enter the percent yourself."));
                if (_draft.Warnings?.Contains("no_baseline") == true)
                    hints.Add(Lang.T("Суурь тэмдэглэгээ алга.", "No baseline is set."));
                if (_draft.Warnings?.Contains("stale_baseline") == true)
                    hints.Add(Lang.T("Суурь 24 цагаас хуучин.", "Baseline is over 24 h old."));
                hints.Add(Lang.T("Дээд хязгаар " + Math.Round(_draft.Ceiling) + "%.",
                                 "Ceiling " + Math.Round(_draft.Ceiling) + "%."));
                AiHint.Text = string.Join(" ", hints);

                DraftPanel.Visibility = Visibility.Visible;
                ConfirmBox.IsChecked = false;
                SubmitBtn.IsEnabled = false;

                Replace(thinking, Lang.T(
                    $"Ноорог бэлэн: {Math.Round(_draft.CurrentPercent)}% → {Math.Round(suggested)}%. " +
                    "Доорх тэмдэглэлийг уншаад, зөв бол баталгаажуулж илгээнэ үү.",
                    $"Draft ready: {Math.Round(_draft.CurrentPercent)}% → {Math.Round(suggested)}%. " +
                    "Read the note below, then confirm and send."));
            }
            catch (Exception ex)
            {
                Replace(thinking, "Ноорог гаргаж чадсангүй.");
                Say(ChatKind.Error, RevitApi.FriendlyError(ex));
            }
            finally
            {
                SetBusy(false);
            }
        }

        private void ConfirmBox_Changed(object sender, RoutedEventArgs e)
        {
            SubmitBtn.IsEnabled = !_busy && _draft != null && ConfirmBox.IsChecked == true;
        }

        /* ============================================================== */
        /*  Илгээх                                                        */
        /* ============================================================== */

        private async void SubmitBtn_Click(object sender, RoutedEventArgs e)
        {
            ResolvedTaskDto r = Current;
            if (r == null || _draft == null || _draftUid == null) return;
            if (ConfirmBox.IsChecked != true)
            {
                Say(ChatKind.Error, "Баталгаажуулах нүдийг тэмдэглэнэ үү.");
                return;
            }
            // ⚠️ Таслалыг ЦЭГ болгож солино.  Монгол гарнаас «45,5» гэж бичихэд
            // InvariantCulture нь таслалыг МЯНГАТЫН тусгаарлагч гэж үзэж
            // (NumberStyles.Any → AllowThousands) 455 болгодог байсан — хүн
            // 45.5% бичээд 455% илгээгддэг.  Float нь мянгатыг зөвшөөрөхгүй.
            string pctRaw = (PercentBox.Text ?? string.Empty).Trim().Replace(',', '.');
            if (!double.TryParse(pctRaw, NumberStyles.Float,
                    CultureInfo.InvariantCulture, out double pct))
            {
                Say(ChatKind.Error, "Хувийг тоогоор бичнэ үү (ж: 45 эсвэл 45.5).");
                return;
            }

            // ⚠️ WPF элементийг ЗААВАЛ UI thread дээр уншина — доорх `Task.Run`
            // лямбда дотор уншвал thread-pool thread дээр биелж
            // `DependencyObject.VerifyAccess()` шидэж, илгээлт бүр унана.
            string noteText = NoteBox.Text ?? string.Empty;

            SetBusy(true, "Илгээж байна…");
            try
            {
                AddinSettings st = Settings;
                SubmissionResult res = await Task.Run(() =>
                    RevitApi.SubmitAsync(
                        st.ApiHost, st.Token, _draftUid, r.TaskId, pct,
                        noteText,
                        _draft.NoteMn, _draft.AiModel, _draft.AiPromptVersion,
                        _context?.Document?.Id, r.SheetUids, _lastChange,
                        Array.Empty<object>()));

                if (res != null && res.Duplicate)
                {
                    Say(ChatKind.System, "Энэ ноорог аль хэдийн илгээгдсэн (давхардал үүсээгүй).");
                }
                else
                {
                    string tail = res != null && res.AwaitingApprover
                        ? " Ахлагчийн баталгаажуулалт хүлээж байна."
                        : "";
                    Say(ChatKind.Assistant, $"Илгээгдлээ — {Math.Round(pct)}%." + tail);
                }

                // Илгээсний дараа суурийг ДАХИН тавина: маргаашийн «юу
                // өөрчлөгдсөн» нь өнөөдрөөс эхэлж тоологдоно.
                try { await Task.Run(() => RevitApi.CallTool("capture_baseline")); } catch { }
                ClearChanges();

                ClearDraft();
                await ReloadAsync(silent: true);
            }
            catch (Exception ex)
            {
                // ⚠️ `_draftUid`-ыг ХЭВЭЭР үлдээнэ.  Дахин оролдоход ижил
                // түлхүүр очих ёстой — эс бөгөөс хоёр бүртгэл үүсэх эрсдэлтэй.
                // MANAGED_ROOT (хуваарилагдсан таск) — дахин оролдсон ч ХЭЗЭЭ Ч амжихгүй, тиймээс «дахин оролд» гэж хэлэхгүй.
                if (RevitApi.IsManagedRoot(ex))
                {
                    Say(ChatKind.Error, RevitApi.FriendlyError(ex));
                    ClearDraft();
                    return;
                }
                Say(ChatKind.Error,
                    RevitApi.FriendlyError(ex) + " — дахин оролдоход давхардал үүсэхгүй.");
            }
            finally
            {
                SetBusy(false);
            }
        }

        /* ============================================================== */
        /*  Тушаалын мөр                                                  */
        /* ============================================================== */

        private void RefreshBtn_Click(object sender, RoutedEventArgs e) => _ = ReloadAsync();

        private void InputBox_TextChanged(object sender, TextChangedEventArgs e)
        {
            SendBtn.IsEnabled = !_busy && !string.IsNullOrWhiteSpace(InputBox.Text);
        }

        private void InputBox_KeyDown(object sender, KeyEventArgs e)
        {
            // Enter = илгээх, Shift+Enter = мөр таслах.
            if (e.Key == Key.Enter &&
                (Keyboard.Modifiers & ModifierKeys.Shift) != ModifierKeys.Shift)
            {
                e.Handled = true;
                SendBtn_Click(sender, null);
            }
        }

        private async void SendBtn_Click(object sender, RoutedEventArgs e)
        {
            // ХЭМЖИЛТ (1C) — END-TO-END.  ЭХНИЙ мөр байх ЁСТОЙ, эс бөгөөс
            // busy-ийн татгалзал ба хоосон мөрийн гарц хэмжигдэхгүй үлдэнэ.
            var T = new Timing();

            // ⚠️ BUSY GUARD — ЗААВАЛ ЭНД.  Enter товч нь `InputBox_KeyDown`-оос
            // ШУУД энэ handler-ыг дууддаг тул `SendBtn.IsEnabled = !busy`
            // (`SetBusy`) нь зөвхөн ХУЛГАНЫГ хаадаг.  Шалгалтгүй үед доорх
            // `AssistantLog.Record(..., acted: true)` нь ХИЙГДЭЭГҮЙ үйлдлийг
            // «хийсэн» гэж бичиж, сургалтын багцыг хордуулна — жинхэнэ
            // гүйцэтгэгч `RunToolAsync` нь `_busy` дээр ЧИМЭЭГҮЙ буцдаг.
            // Инференс нэмэгдэхэд busy цонх миллисекундээс СЕКУНД болно.
            if (_busy)
            {
                Say(ChatKind.System,
                    Lang.T("Өмнөх үйлдэл дуусаагүй байна — түр хүлээнэ үү.",
                           "Still working on the previous request — one moment."));
                // ⚠️ `routeLayer: null` — ЭНЭ мессеж чиглүүлэлт хийгээгүй.
                // ⚠️ ЭНЭ ГАРЦ ДЭЭР ЮУГ Ч ЦЭВЭРЛЭХГҮЙ: `_busy` гэдэг нь
                // ӨМНӨХ мессеж ЯГ ОДОО гүйж байна гэсэн үг бөгөөд
                // `RevitToolBus`/`AgentChat`-ийн «сүүлийн» хэмжилтүүд
                // ТҮҮНИЙХ.  Цэвэрлэвэл гүйж буй мессежийн бүртгэлийн мөр
                // хоосон гарна.
                EndTiming(T, "busy", null, null);
                return;
            }

            string text = InputBox.Text?.Trim();
            if (string.IsNullOrWhiteSpace(text)) { EndTiming(T, "empty", null, null); return; }
            InputBox.Clear();
            Say(ChatKind.User, text);

            HideSuggestions();
            HideFeedback();
            _lastText = text;
            // ⚠️ Хэрэглэгч ямар хэлээр бичсэн, тэр хэлээр нь хариулна.
            Lang.Observe(text);

            // ⚠️ ГУРВАН ДАВХАРГА: түлхүүр үг → сургасан ангилагч → асуух.
            // LLM, API, интернэт ОРООГҮЙ.
            // ХЭМЖИЛТ (1C) — ЧИГЛҮҮЛЭЛТИЙН ҮНЭ.  `Route` нь дотроо
            // `IntentModel.Predict` → `EnsureLoaded` руу орж болзошгүй тул
            // ХҮЙТЭН ачаалалт энэ сегментэд багтаж БОЛНО; `t_model_load_ms`
            // нь тэр хэсгийг тусад нь заана.
            //
            // ⚠️⚠️ ХЭМЖИЛТИЙН ЦЭВЭРЛЭГЭЭ — ЯГ ЭНД, БҮХ АЖЛААС ӨМНӨ.
            //
            // `RevitToolBus.LastCall*` ба `AgentChat.LastTtft/Total` нь
            // «хамгийн сүүлийн» утга бөгөөд урьд нь ЦЭВЭРЛЭГДДЭГГҮЙ байв.
            // Тиймээс хэрэгсэл ч, AI ч хөндөөгүй мессеж (жишээ нь
            // `exit=fallback`) нь ӨМНӨХ мессежийн хугацаануудыг өөрийн
            // бүртгэлийн мөрөнд зөөдөг байсан.
            //
            // ⚠️ ЗААВАЛ `_busy` шалгалтын ДАРАА: busy-гээр татгалзсан
            // дуудлага энд хүрэхгүй тул гүйж буй мессежийн хэмжилтийг
            // цэвэрлэхгүй.  ⚠️ Мөн ЗААВАЛ `Route`-ийн ӨМНӨ: `Route` нь
            // дотроо `IntentModel.EnsureLoaded` руу орж, хүйтэн ачаалалтыг
            // ЭНЭ мессежид тэмдэглэж болзошгүй.
            RevitToolBus.ResetLastCall();
            AgentChat.ResetLastTiming();

            var routeSw = System.Diagnostics.Stopwatch.StartNew();
            RouteResult route = IntentRouter.Route(text);
            routeSw.Stop();
            T.Set("route", routeSw.Elapsed.TotalMilliseconds);
            string routeLayer = IntentRouter.DecidedByTag(route.By);
            Metrics.Route.Add(routeSw.Elapsed.TotalMilliseconds);
            System.Diagnostics.Debug.WriteLine("[MGL] route: " + route.Debug);

            // ⚠️ ХҮЛЭЭГДЭЖ БУЙ АСУУЛТ БАЙНА УУ.  «Аль хуудсыг?» гэж асуусны
            // дараа хэрэглэгч «БА-01» гэж бичихэд тэр нь ШИНЭ тушаал биш,
            // өмнөх асуултын ХАРИУ.  Ийм мөр дангаараа ямар ч санаа биш тул
            // доорх `Fallback` салаанд унах бөгөөд — энэ шалгалт түүнээс
            // ӨМНӨ байх ЁСТОЙ, эс тэгвээс хэзээ ч хүрэхгүй.
            //
            // ⚠️ ГЭХДЭЭ ШИНЭ САНАА ҮРГЭЛЖ ЯЛНА.  Хүн «за яахав, явцаа илгээе»
            // гэвэл түүнийг хуудасны нэр гэж уншиж БОЛОХГҮЙ — тэр нь
            // хэрэглэгчийг гацаанд оруулна (`ShouldYieldTo`).
            Conversation.PendingAsk pending = Conversation.Peek();
            if (pending != null && !Conversation.ShouldYieldTo(route))
            {
                _lastLogId = AssistantLog.Record(route, text, acted: true);
                await ExecuteIntentAsync(pending.Intent, text);
                EndTiming(T, "pending", _lastLogId, routeLayer);
                FlushLogsSoon();
                return;
            }

            // Шинэ сэдэв — хуучин хүлээлтийг хаяна.
            Conversation.Clear();

            // ✅ ИНФЕРЕНСИЙН ЦОРЫН ГАНЦ ЗӨВШӨӨРӨГДСӨН СУУЛГАЦ (seam).
            //
            // Энэ нь хоёр детерминистик давхарга (түлхүүр үг →
            // сургасан ангилагч, `IntentRouter.Route`) АЛЬ АЛЬ НЬ ТАТГАЛЗСАН
            // цэг.  Зөвхөн энд:
            //   • итгэлтэй зам (Keyword / Model) руу ХЭЗЭЭ Ч LLM оруулахгүй —
            //     тэр нь 0-1 мс, офлайн, суудал тутмын өртөг ТЭГ; LLM түүнийг
            //     зөвхөн удаашруулж, үнэ нэмж, найдваргүй болгоно
            //   • tool-bus-ийн handler (`RevitToolEventHandler.Execute`) ба
            //     `ChangeTracker.OnDocumentChanged` дотор ХЭЗЭЭ Ч биш
            //
            // Хэрэгжүүлэхдээ ЗААВАЛ:
            //   • ТУСДАА `HttpClient` — `ApiClient.Http` нь 180 секундын
            //     хугацаатай бөгөөд тэр нь 20,000 мөрийн QTO payload ба MB-ийн
            //     PDF-д зориулагдсан — чатад тэвчихгүй
            //   • богино хугацаа + `CancellationToken` — репо даяар токен
            //     ашигладаг ГАНЦ газар бий: `AgentChat.IsLocalAvailableAsync`-ийн
            //     5 секундын `/health` probe
            //   • хэрэглэгчид ХАРАГДАХ цуцлах товч — одоо самбарт
            //     цуцлах товч БАЙХГҮЙ
            //
            // ⚠️ ЭНЭ РЕЛИЗЭД ИНФЕРЕНС НЭМЭГДЭЭГҮЙ.  Доорх салаа
            // нь сонголт харуулахаас өөр юу ч хийхгүй.
            if (route.By == DecidedBy.Fallback)
            {
                _lastLogId = AssistantLog.Record(route, text, acted: false);
                Say(ChatKind.Assistant,
                    Lang.T("Ойлгосонгүй. Доороос сонгоно уу — сонгосон бүрд чинь сурч байгаа.",
                           "I did not understand. Pick one below — every pick teaches me."));
                ShowSuggestions(route.Suggestions);
                EndTiming(T, "fallback", _lastLogId, routeLayer);
                FlushLogsSoon();
                return;
            }

            _lastLogId = AssistantLog.Record(route, text, acted: true);
            // ⚠️ БҮТЭН текстийг дамжуулна, зөвхөн шифрийг БИШ.  Хүмүүс
            // хуудсыг нэрээр нь дууддаг («фасад харуул»), мөн хувь
            // хэлдэг («60% болголоо») — хоёулаа бүтэн мөрөнд байна.
            await ExecuteIntentAsync(route.Intent, text);

            // 👍/👎 нь ЗӨВХӨН загвар шийдсэн үед хэрэгтэй — тодорхой түлхүүр
            // үг дээр асуух нь хэрэглэгчийг залхаана.
            if (route.By == DecidedBy.Model) ShowFeedback();
            EndTiming(T, "acted", _lastLogId, routeLayer);
            FlushLogsSoon();
        }

        /// <summary>
        /// ХЭМЖИЛТ (1C) — НЭГ МЕССЕЖИЙН хэмжилтийг хаана.
        ///
        /// ⚠️ ХОЁР ХАЯГ РУУ бичнэ:
        ///   1. ЛОКАЛ хуримтлуулагч (`Metrics`) — бүх гарц, бүртгэлийн мөр
        ///      байхгүй үед ч (`empty` / `busy`).  Debug гаралтаас p50/p95/
        ///      p99/max/алдааны хувь ТАВУУЛАА харагдана — p95 дангаараа
        ///      «20-оос 1-д нь ямар байсан»-аас өөр юу ч хэлэхгүй.
        ///   2. Бүртгэлийн мөр (`AssistantLog`) — зөвхөн мөр үүссэн үед.
        ///      ⚠️ `empty`/`busy` дээр мөр ҮҮСГЭХГҮЙ: хоосон текст ба
        ///      хийгдээгүй үйлдэл нь сургалтын багцыг хордуулна.
        ///
        /// ⚠️ Талбарууд нь `assistant_logs`-д тохирох БАГАНА гарах хүртэл
        /// сервер дээр ЧИМЭЭГҮЙ ХАЯГДАНА (`model_version`-тэй яг адил).
        /// Тэр нь хор хоргүй — add-in тал бэлэн, сервер тал гүйцнэ.
        /// </summary>
        /// <summary>
        /// ⚠️ `routeLayer` НЬ ПАРАМЕТР, ТАЛБАР БИШ (2026-08-28).  Урьд нь
        /// `_routeLayer` талбар байсан бөгөөд зөвхөн чиглүүлэлт болсны
        /// ДАРАА оноогддог тул `busy` ба `empty` гарцууд ӨМНӨХ мессежийн
        /// давхаргыг хэвлэдэг байв.  Талбарыг `busy` дээр цэвэрлэх нь бас
        /// БОЛОХГҮЙ — тэр үед ӨМНӨХ мессеж ГҮЙЖ байгаа бөгөөд түүний
        /// `EndTiming` хожим уншина.  Локал хувьсагч нь хоёуланг нь
        /// шийднэ: мессеж бүр өөрийн утгыг өөртөө авч явна.
        /// </summary>
        private void EndTiming(Timing t, string exitPath, string logId, string routeLayer)
        {
            try
            {
                double total = t.TotalMs;
                // ⚠️ `empty` НЬ ХУРИМТЛУУЛАГЧИД ОРОХГҮЙ.  Хоосон мөр дээр
                // Enter дарах нь хэрэглэгчийн ХҮСЭЛТ БИШ — түүний ~0 мс
                // нь p50-ыг хийсвээр доош татаж, «туслах хурдан байна» гэсэн
                // ХУДАЛ дүгнэлт гаргана.
                //
                // ⚠️ `busy` НЬ ОРНО, гэхдээ АЛДАА гэж.  Тэр нь бодит хүсэлт
                // — хүн юм бичээд ТАТГАЛЗУУЛСАн; «хэдий олон удаа
                // татгалзав бэ» гэдэг нь алдааны хувьаар харагдах ёстой.
                if (exitPath != "empty") Metrics.Total.Add(total, ok: exitPath != "busy");

                // ⚠️ ХҮЙТЭН АЧААЛАЛТ НЬ СЕССИЙН ТУРШИД НЭГ УДАА болдог
                // бөгөөд `IntentModel.LastLoadMs` нь түүнийг МӨНХӨД
                // хадгална.  Түүнийг шууд уншвал `t_model_load_ms` нь МӨР
                // БҮРТ давтагдаж, сервер тал «өдөрт 200 хүйтэн ачаалалт»
                // гэж уншина.  `TakeFreshLoad` нь ЯГ ТЭР мессежид л өгнө.
                if (!string.IsNullOrEmpty(logId))
                {
                    // ⚠️ ЗААВАЛ ЭНЭ БЛОКИЙН ДОТОР.  `TakeFreshLoad` нь утгыг
                    // ХЭРЭГЛЭНЭ (нэг л удаа өгнө), тиймээс бүртгэлийн мөр
                    // БАЙХГҮЙ гарц (`empty` / `busy`) дээр дуудвал халаалтын
                    // үед хэмжигдсэн ХҮЙТЭН АЧААЛАЛТ хаягдаж, дараагийн
                    // жинхэнэ мессеж null тайлагнана.  Хоосон мөрөнд Enter
                    // дарах нь 1C-ийн хамгийн чухал тоог устгах ЁСГҮЙ.
                    double? modelLoadMs;
                    string modelLoadSource;
                    IntentModel.TakeFreshLoad(out modelLoadMs, out modelLoadSource);

                    AssistantLog.AttachTiming(
                        logId,
                        totalMs: total,
                        routeMs: t.Get("route"),
                        routeLayer: routeLayer,
                        exitPath: exitPath,
                        modelLoadMs: modelLoadMs,
                        modelLoadSource: modelLoadSource,
                        toolTotalMs: RevitToolBus.LastCallTotalMs,
                        toolQueueMs: RevitToolBus.LastCallQueueMs,
                        toolEventMs: RevitToolBus.LastCallEventMs,
                        toolExecMs: RevitToolBus.LastCallExecMs,
                        agentTtftMs: AgentChat.LastTtftMs,
                        agentTotalMs: AgentChat.LastTotalMs);
                }
                // ⚠️ `Metrics.Emit` — `Debug.WriteLine` БИШ.  Энэ төслийн
                // Configuration нэрс («Release R27» / «Debug R27») нь `DEBUG`
                // тогтмолыг ХЭЗЭЭ Ч тодорхойлдоггүй тул `Debug.WriteLine` нь
                // дуудлага ба аргументийн хамт эмхэтгэлээс ХАСАГДДАГ байв —
                // өөрөөр хэлбэл §3.12-ын зургаан цэг нь хэмжээд ХАЯДАГ.
                // Дэлгэрэнгүй нотолгоо: `Percentiles.cs`-ийн `Metrics.Emit`.
                Metrics.Emit(
                    "[MGL/timing] exit=" + exitPath + " total=" +
                    total.ToString("F0", System.Globalization.CultureInfo.InvariantCulture) +
                    "ms route=" + (routeLayer ?? "-"));
                // Хуримтлуулсан дүн — минутад нэгээс олонгүй (Emit-ийн доторх
                // чадварлалт).  Сессийн эцсийн дүнг `App.OnShutdown` албадана.
                Metrics.EmitSummary();
            }
            catch { /* хэмжилт нь чатыг ХЭЗЭЭ Ч унагаах ёсгүй */ }
        }

        private async Task RunToolAsync(string tool, object args, string okMessage)
        {
            if (_busy) return;
            SetBusy(true, "Гүйцэтгэж байна…");
            try
            {
                await Task.Run(() => RevitApi.CallTool(tool, args));
                Say(ChatKind.Assistant, okMessage);
            }
            catch (Exception ex)
            {
                Say(ChatKind.Error, ex.Message);
            }
            finally { SetBusy(false); }
        }

        /// <summary>
        /// Хуудсыг 3D-д тусгаарлана.  Хэрэглэгч дугаар хэлээгүй бол сонгосон
        /// ажлын ЭХНИЙ хуудсыг авна.
        /// </summary>
        /// <summary>
        /// Хуудсыг ялгаж харуулна.  `raw` нь хэрэглэгчийн БҮТЭН текст —
        /// зөвхөн шифр биш, учир нь хүмүүс хуудсыг НЭРЭЭР нь ч дууддаг
        /// («фасад харуул»).
        ///
        /// ⚠️ 2026-08-25 хүртэл энд мөрийг шууд харьцуулдаг байсан тул
        /// «BA-01» (латин), «БА01» (зураасгүй), «ба 1» (тэггүй) гурвуулаа
        /// ОЛДОХГҮЙ байв.  `Slots.MatchSheet` дөрвөн түвшнээр барина.
        /// </summary>
        private async Task IsolateAsync(string raw)
        {
            // ⚠️ BUSY GUARD.  Доорх `RevitApi.CallTool("list_sheets")` нь busy
            // шалгалтгүйгээр Revit-ийн ҮНДСЭН thread дээр ЖИНХЭНЭ ажил хийдэг,
            // дараа нь доод талын `RunToolAsync` нь `_busy` дээр чимээгүй
            // унадаг — өөрөөр хэлбэл үнэтэй ажил хийгээд үр дүнг нь ХАЯНА.
            if (_busy) return;

            ResolvedTaskDto r = Current;
            string uid = null;
            string matched = null;

            // ⚠️ BUSY ТУГИЙГ ЗААВАЛ ТАВИНА — зөвхөн шалгах нь ХАНГАЛТГҮЙ.
            // Дээрх `if (_busy) return;` нь «ӨӨР ажил явж байвал бүү эхэл»
            // гэдгийг л барина.  Тугийг ТАВИХГҮЙ бол доорх `list_sheets`
            // (том загвар дээр хэдэн секунд) ажиллах ЗУУР `_busy` ХУДАЛ
            // хэвээр байх тул `SendBtn_Click`-ийн busy guard-ыг НЭВТРҮҮЛНЭ,
            // хэрэглэгч Enter дарах бүрт
            // `AssistantLog.Record(..., acted: true)` шинэ мөр бичигдэнэ —
            // §6-ын хүлээн авах шалгуур («Enter-ийг 5 удаа дар →
            // нэмэлт "acted":true мөр НЭГ Ч БИШ») яг энэ замаар унадаг байв.
            SetBusy(true, Lang.T("Хуудсуудыг уншиж байна…", "Reading sheets…"));
            try
            {
                if (!string.IsNullOrWhiteSpace(raw))
                {
                    try
                    {
                        JsonElement sheets = await Task.Run(() => RevitApi.CallTool("list_sheets"));
                        if (sheets.TryGetProperty("sheets", out JsonElement arr) &&
                            arr.ValueKind == JsonValueKind.Array)
                        {
                            var list = new List<Slots.SheetRef>();
                            foreach (JsonElement s in arr.EnumerateArray())
                            {
                                list.Add(new Slots.SheetRef
                                {
                                    Number = s.TryGetProperty("number", out JsonElement n) ? n.GetString() : "",
                                    Name = s.TryGetProperty("name", out JsonElement nm) ? nm.GetString() : "",
                                    Uid = s.TryGetProperty("uid", out JsonElement u) ? u.GetString() : null,
                                });
                            }

                            Conversation.RememberSheets(list);

                            Slots.SheetRef hit = Slots.MatchSheet(list, raw);

                            // ⚠️ Шифр/нэрээр олдоогүй бол ЗААЛТААР үзнэ:
                            // «эхнийхийг», «3 дахийг», «сүүлийнхийг».
                            // Дараалал нь чухал — шифр үргэлж давуу эрхтэй.
                            if (hit == null) hit = Conversation.ResolveOrdinal(raw);

                            if (hit != null) { uid = hit.Uid; matched = hit.Number + " " + hit.Name; }
                        }
                    }
                    catch { }
                }

                // Хуудас нэрлээгүй бол холбогдсон ажлынхаа хуудсыг авна.
                if (uid == null) uid = r?.SheetUids?.FirstOrDefault();

                if (uid == null)
                {
                    // ⚠️ МУХАР ЗАМ БАЙСАН.  Урьд нь энд «Олдсонгүй» гэж хэлээд
                    // дуусдаг тул хэрэглэгч юу хийхээ мэдэхгүй үлддэг байв.
                    // Одоо АСУУНА — энэ бол агент шинжийн хамгийн энгийн хэлбэр.
                    if (Conversation.Ask("isolate_sheet", "sheet"))
                    {
                        var sb = new System.Text.StringBuilder();
                        sb.Append(Lang.T("Аль хуудсыг ялгах вэ?", "Which sheet should I isolate?"));

                        IReadOnlyList<Slots.SheetRef> known = Conversation.LastSheets;
                        if (known.Count > 0)
                        {
                            sb.Append('\n');
                            int shown = 0;
                            foreach (Slots.SheetRef s3 in known)
                            {
                                if (shown >= 8) break;
                                sb.Append("  ").Append(s3.Number);
                                if (!string.IsNullOrWhiteSpace(s3.Name))
                                    sb.Append("  ").Append(s3.Name);
                                sb.Append('\n');
                                shown++;
                            }
                            if (known.Count > shown)
                                sb.Append("  … +").Append(known.Count - shown);
                        }
                        Say(ChatKind.Assistant, sb.ToString().TrimEnd());
                    }
                    else
                    {
                        Say(ChatKind.Error, Lang.T(
                            "Хуудсыг олж чадсангүй. «хуудсуудаа харуул» гэвэл жагсаалт гарна.",
                            "I could not find that sheet. Say \u201Cshow all sheets\u201D for a list."));
                    }
                    return;
                }
            }
            finally
            {
                // ⚠️ ЗААВАЛ ЭНД СУЛЛАНА — доорх `RunToolAsync`-ААС ӨМНӨ.
                // Тэр нь өөрөө `if (_busy) return;`-тэй тул тугийг барьсаар
                // үлдвэл тусгаарлалт ЧИМЭЭГҮЙ хийгдэхгүй өнгөрнө —
                // `WhatsChangedAsync` дээр яг ижил шалтгаанаар самбарыг
                // `finally`-ийн ДАРАА нээдэг.
                SetBusy(false);
            }

            // Олдлоо — хүлээлт дууслаа.
            Conversation.Clear();

            // ⚠️ АЛЬ хуудсыг сонгосноо ХЭЛНЭ.  Буруу хуудас тусгаарласан бол
            // хэрэглэгч тэр дор нь харна — чимээгүй буруу ажиллахаас сэргийлнэ.
            await RunToolAsync("isolate_sheet_elements", new { sheet_uid = uid },
                matched != null
                    ? Lang.T("«" + matched.Trim() + "» тусгаарлалаа. «буцаа» гэвэл цуцална.",
                             "Isolated “" + matched.Trim() + "”. Say “reset” to undo.")
                    : Lang.T("Тусгаарлалаа. «буцаа» гэвэл цуцална.",
                             "Isolated. Say “reset” to undo."));
        }

        /* ============================================================== */
        /*  Санаа таних — гурван давхарга                                  */
        /* ============================================================== */

        /// <summary>Сонголтын товчны холбоос.</summary>
        public sealed class SuggestItem
        {
            public string Intent { get; set; }
            public string Label { get; set; }
        }

        private readonly ObservableCollection<SuggestItem> _suggestions =
            new ObservableCollection<SuggestItem>();

        /// <summary>Сүүлийн бүртгэлийн id — 👍/👎 болон засвар үүн рүү очно.</summary>
        private string _lastLogId;

        /// <summary>Сүүлд бичсэн текст — засвар хийхэд хуудасны дугаар дахин хэрэгтэй.</summary>
        private string _lastText;

        private void ShowSuggestions(IEnumerable<string> intents, bool all = false)
        {
            _suggestions.Clear();
            IEnumerable<string> list = all ? IntentRouter.AllIntents : intents;
            foreach (string i in list)
                _suggestions.Add(new SuggestItem { Intent = i, Label = IntentModel.LabelOf(i) });
            SuggestList.ItemsSource = _suggestions;
            SuggestMoreBtn.Visibility = all ? Visibility.Collapsed : Visibility.Visible;
            SuggestPanel.Visibility = Visibility.Visible;
            FeedbackPanel.Visibility = Visibility.Collapsed;
        }

        private void HideSuggestions() => SuggestPanel.Visibility = Visibility.Collapsed;

        /// <summary>
        /// ⚠️ САНААНЫ сонголт БИШ, UI-ийн ҮЙЛДЛИЙН товч.  Угтвараар ялгана.
        ///
        /// ЯАГААД ЯЛГАХ ЁСТОЙ ВЭ: `Suggest_Click` нь сонголтыг «энэ текст →
        /// ЭНЭ санаа» гэсэн АЛТАН ШОШГО болгож бүртгэдэг.  «Одоо холбох»
        /// товчийг тэгж бүртгэвэл загвар хэрэглэгчийн СҮҮЛИЙН мөрийг
        /// (жишээ нь «minii shinechleltiin tailang beltge») тэр үйлдэлтэй
        /// холбож сурна — сургалтын өгөгдөл ХОРДОНО.
        /// </summary>
        private const string UiAction = "ui:";

        private void ShowActions(params SuggestItem[] items)
        {
            _suggestions.Clear();
            foreach (SuggestItem i in items) _suggestions.Add(i);
            SuggestList.ItemsSource = _suggestions;
            SuggestMoreBtn.Visibility = Visibility.Collapsed;
            SuggestPanel.Visibility = Visibility.Visible;
            FeedbackPanel.Visibility = Visibility.Collapsed;
        }

        private void ShowFeedback()
        {
            FeedbackPanel.Visibility = Visibility.Visible;
            ThumbUpBtn.IsEnabled = true;
            ThumbDownBtn.IsEnabled = true;
        }

        private void HideFeedback()
        {
            FeedbackPanel.Visibility = Visibility.Collapsed;
            FeedbackNoteRow.Visibility = Visibility.Collapsed;
            FeedbackNoteBox.Text = string.Empty;
        }

        private async void Suggest_Click(object sender, RoutedEventArgs e)
        {
            string intent = (sender as System.Windows.Controls.Button)?.Tag as string;
            if (string.IsNullOrEmpty(intent)) return;

            // ⚠️ UI-ийн ҮЙЛДЭЛ бол сургалтад ОГТ БҮРТГЭХГҮЙ — тэр нь
            // «текст → санаа» гэсэн шошго БИШ.  Бүртгэвэл өгөгдөл хордоно.
            if (intent.StartsWith(UiAction, StringComparison.Ordinal))
            {
                HideSuggestions();
                string act = intent.Substring(UiAction.Length);
                if (act == "register") await RegisterDocumentAsync();
                else if (act == "scope_all")
                {
                    // Менежер файлд холбогдсон БУСДЫН ажлыг ч харна.  Сервер
                    // эрхийг дахин шалгадаг тул энэ туг нь шинэ эрх нээхгүй.
                    _scopeAll = true;
                    await ReloadAsync(silent: false);
                }
                else if (act == "settings")
                {
                    Say(ChatKind.System, Lang.T(
                        "MGL → Тохиргоо цонхноос төслөө сонгоно уу.",
                        "Pick your project in MGL → Settings."));
                }
                return;
            }

            // ⚠️ ЭНЭ БОЛ АЛТ.  Хэрэглэгч «энэ текст → ЭНЭ санаа» гэдгийг ӨӨРӨӨ
            // хэлж байна — гараар шошголсонтой ижил чанартай өгөгдөл.
            AssistantLog.Feedback(_lastLogId, null, intent);
            HideSuggestions();
            Say(ChatKind.System, Lang.T("Тэмдэглэлээ — дараагийн удаа санана.",
                                        "Noted — I will remember next time."));
            await ExecuteIntentAsync(intent, _lastText);
            FlushLogsSoon();
        }

        private void SuggestMore_Click(object sender, RoutedEventArgs e)
            => ShowSuggestions(null, all: true);

        private void ThumbUp_Click(object sender, RoutedEventArgs e)
        {
            AssistantLog.Feedback(_lastLogId, 1, null);
            HideFeedback();
            FlushLogsSoon();
        }

        private void ThumbDown_Click(object sender, RoutedEventArgs e)
        {
            // ⚠️ 👎-г ЭНД ШУУД хадгална.  Хэрэглэгч тайлбар бичихгүй, эсвэл
            // «Алгасах» дарж болно — санал нь ямар ч тохиолдолд алдагдах ёсгүй.
            AssistantLog.Feedback(_lastLogId, -1, null);

            // Дахин дарахаас сэргийлнэ; мөр нь ил хэвээр үлдэнэ.
            ThumbUpBtn.IsEnabled = false;
            ThumbDownBtn.IsEnabled = false;

            // 👎 нь «буруу» гэдгийг л хэлнэ.  ЗӨВ нь юу байсныг асуувал
            // сургалтад хамаагүй үнэ цэнтэй — тиймээс сонголтыг мөн харуулна.
            Say(ChatKind.System, Lang.T(
                "Уучлаарай.  Юу нь буруу байсныг бичвэл долоо хоног бүрийн " +
                "хяналтад орно.  Мөн зөв нь аль нь байсныг доороос сонгож болно.",
                "Sorry.  Tell me what went wrong — it goes into the weekly review.  " +
                "You can also pick the right one below."));

            // ⚠️ ДАРААЛАЛ НЬ АЧААЛАЛТАЙ (2026-08-26-ны алдаа).
            // `ShowSuggestions` нь ТӨГСГӨЛДӨӨ `FeedbackPanel`-ийг ХУМИДАГ
            // (мөр 1550) — шинэ сонголт гарахад хуучин санал асуулга нь
            // хуучирсан гэж үздэг ерөнхий дүрэм.  Тиймээс оролтыг ӨМНӨ нь
            // гаргавал тэр даруй нуугдана: хэрэглэгч зөвхөн сонголтуудыг
            // хараад, бичих талбар нь ХЭЗЭЭ Ч гарч ирдэггүй байв.
            //
            // Эхлээд сонголтуудыг гаргаад, ДАРАА нь самбарыг эргүүлж нээнэ.
            ShowSuggestions(null, all: true);

            FeedbackPanel.Visibility = Visibility.Visible;
            FeedbackNoteRow.Visibility = Visibility.Visible;
            FeedbackNoteBox.Text = string.Empty;
            FeedbackNoteBox.Focus();

            FlushLogsSoon();
        }

        /// <summary>
        /// Чөлөөт тайлбарыг хадгална.
        ///
        /// ⚠️ ЭНЭ БОЛ ГОГЦООНЫ ДУТУУ ХЭСЭГ БАЙВ (2026-08-26).  Урьд нь 👎 нь
        /// зөвхөн «-1» гэсэн тоо үлдээдэг байсан тул долоо хоногийн хяналтад
        /// «хүмүүс дургүйцсэн» гэдэг нь харагдах ч ЯАГААД гэдэг нь хэзээ ч
        /// мэдэгддэггүй байв.  Шалтгаангүй гомдол нь засаж болох алдаа биш.
        /// </summary>
        private void FeedbackNoteSend_Click(object sender, RoutedEventArgs e)
        {
            string note = (FeedbackNoteBox.Text ?? string.Empty).Trim();
            if (note.Length > 0)
            {
                AssistantLog.Feedback(_lastLogId, -1, null, note);
                Say(ChatKind.System, Lang.T(
                    "Баярлалаа — тэмдэглэлээ.  Долоо хоног бүр эдгээрийг хараад засна.",
                    "Thank you — noted.  These are reviewed every week."));
            }
            HideFeedback();
            FlushLogsSoon();
        }

        private void FeedbackNoteSkip_Click(object sender, RoutedEventArgs e)
        {
            // 👎 нь аль хэдийн хадгалагдсан — энд юу ч алдагдахгүй.
            HideFeedback();
            FlushLogsSoon();
        }

        private void FeedbackNote_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key != Key.Enter) return;
            e.Handled = true;
            FeedbackNoteSend_Click(sender, e);
        }

        /// <summary>
        /// Санаа таних загварыг арын дэвсгэрт шинэчилнэ — UI хүлээхгүй.
        ///
        /// ⚠️ ӨӨРӨӨ СУРАХ ГОГЦООНЫ ХААГДАХ ЦЭГ.  Хэрэглэгчид сонголт дарж,
        /// 👎 дарж залруулга өгснөөр загварыг дахин сургадаг; энэ дуудлага
        /// л тэр сайжруулалтыг буцааж авчирдаг.  Үүнгүйгээр хүмүүс сургадаг
        /// ч үр дүнг нь хэзээ ч хардаггүй байв.
        ///
        /// ⚠️ ЧИМЭЭГҮЙ.  Сүлжээгүй, токенгүй, сервер унтарсан — бүгд хэвийн.
        /// Шигтгэсэн загвар үргэлж ажиллана, тиймээс энэ нь ЗӨВХӨН нэмэлт.
        /// Хувилбар СОЛИГДСОН үед л нэг мөр хэлнэ — чимээгүй солиулбал
        /// «яагаад өчигдрөөс өөр хариулж байна вэ» гэсэн асуулт төрүүлнэ.
        /// </summary>
        private void SyncIntentModelSoon()
        {
            AddinSettings st = Settings;
            if (string.IsNullOrEmpty(st.Token)) return;

            _ = Task.Run(async () =>
            {
                // ⚠️ `have`-ыг ЭНД, АРЫН thread дээр тооцно.  `VersionForSync()`
                // нь ачаалалтыг ХҮЧЛЭДЭГ тул UI thread дээр дуудвал 918 KB
                // parse тэнд унана.  Өмнө нь энэ мөр `LoadedVersion`-ыг UI
                // thread дээр уншдаг байсан — тэр нь ачаалалтыг хүчилдэггүй
                // тул самбар нээгдэх үед ҮРГЭЛЖ null байж, `?have=` параметр
                // ОГТ илгээгддэггүй, улмаас 918 KB жин СЕСС БҮРТ дахин
                // татагддаг байв.
                string have = IntentModel.VersionForSync();
                string ver = await ApiClient.SyncIntentModelAsync(st.ApiHost, st.Token, have)
                                            .ConfigureAwait(false);
                if (string.IsNullOrEmpty(ver)) return;

                await Dispatcher.InvokeAsync(() =>
                {
                    IntentModel.Reload();
                    // ⚠️ `Reload()` нь зөвхөн талбаруудыг null болгодог —
                    // жинхэнэ 918 KB parse нь ДАРААГИЙН `Predict` дээр,
                    // өөрөөр хэлбэл хэрэглэгчийн дараагийн мессежийн UI
                    // thread дээр унана.  Тиймээс энд ДАХИН халаана.
                    IntentModel.PrewarmAsync();
                    Say(ChatKind.System, Lang.T("Таних загвар шинэчлэгдлээ (" + ver + ").",
                                                "Intent model updated (" + ver + ")."));
                });
            });
        }

        /// <summary>
        /// Суулгалтын өөрийн шалгалтыг ажиллуулж, үр дүнг серверт илгээнэ
        /// (v2 §74 — SELF-CHECK + REPORT HEALTH).
        ///
        /// ⚠️ БҮГД АРЫН THREAD ДЭЭР.  `InstallCheck.Run` нь диск уншиж, нэг
        /// жижиг файлын sha256 тооцдог — UI thread дээр огт байх ЁСГҮЙ.
        ///
        /// ⚠️ ЧИМЭЭГҮЙ.  Сүлжээгүй, токенгүй, сервер унтарсан — бүгд хэвийн.
        /// Эрүүл мэндийн тайлан илгээгдээгүй нь ажилтны ажлыг зогсоох ЁСГҮЙ.
        /// Зөвхөн ХОЁР тохиолдолд нэг мөр хэлнэ: багц ТАНИГДААГҮЙ (албан ёсны
        /// бус build) эсвэл шинэчлэх ШААРДЛАГАТАЙ.  Тэр хоёр нь ажилтны
        /// хийж чадах үйлдэлтэй (IT-д хэлэх) тул харагдах ёстой.
        ///
        /// ⚠️ СЕСС ТУТАМ НЭГ УДАА.  Тогтмол давтахгүй — тогтмол ping нь
        /// телеметрийг ХЯНАЛТ болгоно.
        /// </summary>
        private void ReportHealthSoon()
        {
            // W10 (2026-10-16): тайланг одоо `HealthReporter` (App эхэлснээс 90 с дараа, самбараас ҮЛ ХАМААРАН) илгээдэг.
            // Самбар нь (а) хараахан илгээгдээгүй бол эхлүүлнэ (токен сая орсон г.м.), (б) хариуг чатад харуулна.
            if (HealthReporter.LastReply != null)
            {
                ShowHealthReply(HealthReporter.LastReply);
                return;
            }
            Action<HealthReply> onReply = null;
            onReply = r =>
            {
                HealthReporter.Replied -= onReply;
                ShowHealthReply(r);
            };
            HealthReporter.Replied += onReply;
            HealthReporter.ReportOnce(null, AssistantLog.RevitVersion);
        }

        /// <summary>Эрүүл мэндийн хариуг чатад (зөвхөн хэрэглэгчийн хийж чадах үйлдэлтэй тохиолдолд).</summary>
        private void ShowHealthReply(HealthReply reply)
        {
            _ = Task.Run(async () =>
            {
                try
                {
                    if (reply == null) return;

                    // ⚠️ «ТАНИГДААГҮЙ» гэдгийг ЗӨВХӨН сервер тухайн Revit оны
                    //    ЯМАР НЭГ релизийг мэдэж байгаа үед л хэлнэ.  Тараалт
                    //    эхлэх мөчид `addin_releases` ХООСОН байдаг —
                    //    `latest_version` нь null.  Тэр үед бүх ажилтанд
                    //    «албан ёсны бус багц» гэж хэлэх нь ХУДАЛ дохио бөгөөд
                    //    IT рүү 20 дуудлага үүсгэнэ.  Бүртгэл хоосон байхад
                    //    чимээгүй өнгөрөх нь зөв: сервер талын `recognised`
                    //    үзүүлэлт нь `GET /api/revit-addin/fleet` дээр хэвээр.
                    bool unofficial = !reply.Recognised
                                      && !string.IsNullOrEmpty(reply.LatestVersion);
                    if (!unofficial && !reply.UpgradeRequired && !reply.Revoked) return;

                    await Dispatcher.InvokeAsync(() =>
                    {
                        if (reply.Revoked)
                        {
                            Say(ChatKind.System, Lang.T(
                                "Энэ нэмэлтийн багц ЦУЦЛАГДСАН байна. IT-д хандана уу.",
                                "This add-in package has been revoked. Please contact IT."));
                        }
                        else if (unofficial)
                        {
                            Say(ChatKind.System, Lang.T(
                                "Энэ нэмэлт нь албан ёсны багцаар суугаагүй байна. IT-д хандана уу.",
                                "This add-in was not installed from an official package. Contact IT."));
                        }
                        else
                        {
                            Say(ChatKind.System, Lang.T(
                                "Шинэ хувилбар гарсан байна (" + (reply.LatestVersion ?? "?") + "). IT-д хандана уу.",
                                "A newer version is available (" + (reply.LatestVersion ?? "?") + "). Contact IT."));
                        }
                    });
                }
                catch
                {
                    // ⚠️ Энэ мөрөнд хүрэх алдаа ч ажлыг зогсоох ЁСГҮЙ.
                }
            });
        }

        /// <summary>Бүртгэлийг арын дэвсгэрт илгээнэ — UI хүлээхгүй.</summary>
        private void FlushLogsSoon()
        {
            AddinSettings st = Settings;
            if (string.IsNullOrEmpty(st.Token)) return;
            _ = Task.Run(async () =>
            {
                try { await AssistantLog.FlushAsync(st.ApiHost, st.Token); }
                catch { /* офлайн — дараа дахин оролдоно */ }
            });
        }

        /// <summary>Танигдсан санааг гүйцэтгэнэ.</summary>
        /// <summary>Танигдсан санааг гүйцэтгэнэ.  `raw` нь хэрэглэгчийн БҮТЭН текст.</summary>
        private async Task ExecuteIntentAsync(string intent, string raw)
        {
            switch (intent)
            {
                case "submit_progress":
                    await MakeDraftAsync(raw);
                    break;
                case "list_sheets":
                    await ListSheetsAsync();
                    break;
                case "isolate_sheet":
                    await IsolateAsync(raw);
                    break;
                case "reset_view":
                    await RunToolAsync("reset_isolation", null,
                        Lang.T("Тусгаарлалтыг цуцаллаа.", "Isolation cleared."));
                    break;
                case "whats_changed":
                    await WhatsChangedAsync();
                    break;
                case "set_baseline":
                    await RunToolAsync("capture_baseline", null,
                        Lang.T("Өнөөдрийн загварыг суурь болгож тэмдэглэлээ.",
                               "Saved the current model as the baseline."));
                    ClearChanges();
                    break;
                case "progress_status":
                    ShowProgressStatus();
                    break;
                case "help":
                    Say(ChatKind.Assistant, IntentParser.HelpText);
                    break;
                default:
                    Say(ChatKind.Assistant, IntentParser.HelpText);
                    break;
            }
        }

        /// <summary>Хуудсуудыг уншиж жагсаана.</summary>
        private async Task ListSheetsAsync()
        {
            if (_busy) return;
            SetBusy(true, "Хуудсуудыг уншиж байна…");
            try
            {
                JsonElement j = await Task.Run(() => RevitApi.CallTool("list_sheets"));
                if (!j.TryGetProperty("sheets", out JsonElement arr) ||
                    arr.ValueKind != JsonValueKind.Array)
                {
                    Say(ChatKind.Error, Lang.T("Хуудсуудыг уншиж чадсангүй.",
                                               "I could not read the sheets."));
                    return;
                }
                // ⚠️ САНАЖ ҮЛДЭНЭ — «эхнийхийг нь ялга» гэдэг заалт үүн дээр
                // тогтоно.  Үүнгүйгээр хэрэглэгч бүх шифрийг гараар бичих
                // шаардлагатай болно.
                var remembered = new List<Slots.SheetRef>();
                foreach (JsonElement s2 in arr.EnumerateArray())
                {
                    remembered.Add(new Slots.SheetRef
                    {
                        Number = s2.TryGetProperty("number", out JsonElement rn) ? rn.GetString() : "",
                        Name = s2.TryGetProperty("name", out JsonElement rm) ? rm.GetString() : "",
                        Uid = s2.TryGetProperty("uid", out JsonElement ru) ? ru.GetString() : null,
                    });
                }
                Conversation.RememberSheets(remembered);

                int n = arr.GetArrayLength();
                if (n == 0)
                {
                    Say(ChatKind.Assistant, Lang.T("Энэ файлд хуудас алга.",
                                                   "This file has no sheets."));
                    return;
                }

                var sb = new System.Text.StringBuilder();
                sb.Append(n).Append(Lang.T(" хуудас:\n", " sheets:\n"));
                int shown = 0;
                foreach (JsonElement s in arr.EnumerateArray())
                {
                    if (shown >= 15) break;
                    string num = s.TryGetProperty("number", out JsonElement a) ? a.GetString() : "";
                    string nm = s.TryGetProperty("name", out JsonElement b) ? b.GetString() : "";
                    sb.Append("  ").Append(num).Append("  ").Append(nm).Append('\n');
                    shown++;
                }
                if (n > shown) sb.Append("  … +").Append(n - shown);
                Say(ChatKind.Assistant, sb.ToString().TrimEnd());
            }
            catch (Exception ex)
            {
                Say(ChatKind.Error, ex.Message);
            }
            finally { SetBusy(false); }
        }

        /// <summary>Суурьтай харьцуулж юу өөрчлөгдсөнийг хэлнэ.</summary>
        /// <summary>
        /// Суурь авснаас хойшхи өөрчлөлтийг хэлнэ.
        ///
        /// ⚠️ Одоо `changed_sheets` БИШ, `totals` уншина.  `ChangeTracker` нь
        /// Revit-ийн `DocumentChanged`-ээс хуримтлуулдаг тул хуудсаар биш,
        /// ЭЛЕМЕНТЭЭР тоолдог.  Хуучин код `changed_sheets`-ийн уртыг хардаг
        /// байсан бөгөөд тэр нь одоо үргэлж хоосон — засахгүй бол «өөрчлөлт
        /// алга» гэж ҮРГЭЛЖ ХУДАЛ хэлэх байв.
        /// </summary>
        private async Task WhatsChangedAsync()
        {
            if (_busy) return;
            SetBusy(true, Lang.T("Өөрчлөлтийг шалгаж байна…", "Checking changes…"));

            // ⚠️ Самбарыг `finally`-ийн ДАРАА нээнэ.  `LoadChangesAsync` нь
            // `_busy`-г шалгадаг тул энэ блокийн дотроос дуудвал чимээгүй
            // буцаад, жагсаалт хэзээ ч гарахгүй.
            bool showPanel = false;
            try
            {
                JsonElement j = await Task.Run(() => RevitApi.CallTool("diff_since_baseline"));
                _lastChange = JsonSerializer.Deserialize<object>(j.GetRawText());

                var flags = new HashSet<string>(StringComparer.Ordinal);
                if (j.TryGetProperty("warnings", out JsonElement w) &&
                    w.ValueKind == JsonValueKind.Array)
                {
                    foreach (JsonElement x in w.EnumerateArray())
                    {
                        string s = x.GetString();
                        if (!string.IsNullOrEmpty(s)) flags.Add(s);
                    }
                }

                // ⚠️ Мөрдөгч эхлээгүй бол ЧИМЭЭГҮЙ «0 өөрчлөлт» гэж хэлэх нь
                // ХУДАЛ.  Шалтгааныг нь хэлнэ.
                if (flags.Contains("tracking_unavailable"))
                {
                    Say(ChatKind.Error, Lang.T(
                        "Өөрчлөлт мөрдөгч эхлээгүй байна. Revit-ээ дахин нээгээд үзнэ үү.",
                        "The change tracker did not start. Please restart Revit."));
                    return;
                }

                if (flags.Contains("no_baseline"))
                {
                    // Суурь ДӨНГӨЖ САЯ тавигдлаа — өмнөх мөрүүд утгагүй болсон.
                    ClearChanges();
                    Say(ChatKind.Assistant, Lang.T(
                        "Суурь тэмдэглэгээ байхгүй байсан тул одоо тавилаа. " +
                        "Ажлаа хийгээд дахин асуувал юу өөрчлөгдсөнийг хэлнэ.",
                        "There was no baseline, so I set one now. Do your work and " +
                        "ask again — I will tell you what changed."));
                    return;
                }

                int added = 0, removed = 0, modified = 0;
                if (j.TryGetProperty("totals", out JsonElement t) &&
                    t.ValueKind == JsonValueKind.Object)
                {
                    if (t.TryGetProperty("added", out JsonElement a)) a.TryGetInt32(out added);
                    if (t.TryGetProperty("removed", out JsonElement r)) r.TryGetInt32(out removed);
                    if (t.TryGetProperty("modified", out JsonElement m)) m.TryGetInt32(out modified);
                }

                int total = added + removed + modified;
                if (total == 0)
                {
                    Say(ChatKind.Assistant, Lang.T(
                        "Суурь авснаас хойш өөрчлөлт алга.",
                        "Nothing has changed since the baseline."));

                    // ⚠️ ЭНД `return` ХИЙГЭЭД ЗОГСОХ НЬ АЛДАА БАЙВ (2026-08-26).
                    // `showPanel` нь доор, тоо гаргасны дараа л `true` болдог
                    // байсан тул Ctrl+Z-ээр бүгдийг буцаахад чат «өөрчлөлт алга»
                    // гэж ЗӨВ хэлээд, дээрх Δ самбар нь ХУУЧИН мөрөө барьсаар
                    // үлддэг байв — хэрэглэгч «Шинэчлэх» дарж байж л цэвэрлэгддэг.
                    //
                    // Тэг бол ч гэсэн ШИНЭЧИЛНЭ: жагсаалт хоосон болох ёстой.
                    showPanel = true;
                    return;
                }

                var sb = new System.Text.StringBuilder();
                sb.Append(total).Append(Lang.T(" өөрчлөлт:\n", " changes:\n"));
                if (added > 0)
                    sb.Append(Lang.T("  нэмсэн       ", "  added      ")).Append(added).Append('\n');
                if (removed > 0)
                    sb.Append(Lang.T("  устгасан     ", "  removed    ")).Append(removed).Append('\n');
                if (modified > 0)
                    sb.Append(Lang.T("  засварласан  ", "  modified   ")).Append(modified).Append('\n');

                string since = SinceText(j);
                if (since != null) sb.Append(since);

                // ⚠️ Хязгаарыг ШУДАРГААР хэлнэ.
                if (flags.Contains("truncated"))
                {
                    sb.Append(Lang.T(
                        "\n⚠️ Хэт олон өөрчлөлт — тоо бүрэн бус байж магадгүй.",
                        "\n⚠️ Too many changes — the count may be incomplete."));
                }
                if (flags.Contains("stale_baseline"))
                {
                    sb.Append(Lang.T(
                        "\n⚠️ Суурь 24 цагаас хуучин. «эхлэл тэмдэглэ» гэвэл шинэчилнэ.",
                        "\n⚠️ Baseline is over 24 h old. Say \u201Cset baseline\u201D to reset it."));
                }

                Say(ChatKind.Assistant, sb.ToString().TrimEnd());
                showPanel = true;
            }
            catch (Exception ex)
            {
                Say(ChatKind.Error, ex.Message);
            }
            finally { SetBusy(false); }

            if (showPanel) await LoadChangesAsync(true);
        }

        /// <summary>«09:12-оос хойш» гэсэн мөр — суурь хэзээ тавигдсаныг хэлнэ.</summary>
        private static string SinceText(JsonElement j)
        {
            try
            {
                if (!j.TryGetProperty("baseline", out JsonElement b) ||
                    b.ValueKind != JsonValueKind.Object) return null;
                if (!b.TryGetProperty("captured_at", out JsonElement c)) return null;

                string raw = c.GetString();
                if (string.IsNullOrWhiteSpace(raw)) return null;
                if (!DateTime.TryParse(raw, CultureInfo.InvariantCulture,
                        DateTimeStyles.RoundtripKind, out DateTime at)) return null;

                // ⚠️ Суурь нь UTC-гээр хадгалагддаг; хэрэглэгчид ОРОН НУТГИЙН
                // цагаар харуулна, эс тэгвээс «08:12-оос хойш» гэж 8 цагаар
                // зөрүүтэй харагдана.
                string time = at.ToLocalTime().ToString("HH:mm", CultureInfo.InvariantCulture);
                return Lang.T("\n(" + time + "-оос хойш)", "\n(since " + time + ")");
            }
            catch { return null; }
        }

        /// <summary>Сонгосон ажлын явцыг хэлнэ — сүлжээ хэрэггүй.</summary>
        private void ShowProgressStatus()
        {
            ResolvedTaskDto r = Current;
            if (r == null)
            {
                Say(ChatKind.Assistant,
                    Lang.T("Холбогдсон ажил алга. MGL → «Зураг холбох» товчоор хуудсуудаа холбоно уу.",
                           "No task is linked. Use MGL → “Link sheets” to connect your sheets."));
                return;
            }
            int done = _checklist.Count(c => c.IsDone);
            var sb = new System.Text.StringBuilder();
            sb.Append('«').Append(r.TaskName).Append("»\n");
            sb.Append(Lang.T("Явц: ", "Progress: "))
              .Append(Math.Round(r.CurrentProgress)).Append("%\n");
            sb.Append(Lang.T("Дэд жагсаалт: ", "Checklist: "))
              .Append(done).Append('/').Append(_checklist.Count);
            if (r.ReportedToday)
                sb.Append(Lang.T("\nӨнөөдөр бүртгэсэн байна.",
                                 "\nAlready reported today."));
            Say(ChatKind.Assistant, sb.ToString());
        }

        /* ============================================================== */
        /*  AI агент                                                      */
        /* ============================================================== */

        /// <summary>
        /// Хэрэглэгчийн чөлөөт өгүүлбэрийг AI туслах руу дамжуулна.
        ///
        /// ⚠️ LLM түлхүүр ЭНД БАЙХГҮЙ.  `AgentChat` нь `/api/revit/agent/turn`-
        /// ээр л ярьдаг; хэрэгслүүд нь энэ компьютер дээрх Revit дотор
        /// гүйцэтгэгддэг тул давталтыг add-in эзэмшинэ.
        /// </summary>
        private async Task AskAgentAsync(string text)
        {
            if (_busy) return;
            AddinSettings st = Settings;

            // ⚠️ ЛОКАЛ агент MGL-ийн нэвтрэлт ШААРДАХГҮЙ — тэр нь хэрэглэгчийн
            // Claude захиалгаар ажиллаж, Revit-тэй шууд ярьдаг.  Урьд нь энд
            // токен шаарддаг байсан тул вэбэд нэвтрээгүй хүн AI-г огт
            // ашиглаж чаддаггүй байв.
            bool localUp = await AgentChat.IsLocalAvailableAsync();
            if (!localUp && string.IsNullOrEmpty(st.Token))
            {
                Say(ChatKind.Error,
                    "AI туслах бэлэн биш байна. Локал туслахыг асаах, эсвэл " +
                    "MGL → Тохиргоо цонхноос нэвтэрнэ үү.");
                return;
            }

            if (localUp && !_saidLocal)
            {
                _saidLocal = true;
                Say(ChatKind.System, "Локал AI · таны Claude захиалгаар");
            }

            SetBusy(true, "Бодож байна…");
            ChatMessage pending = null;
            try
            {
                var ev = new AgentEvents
                {
                    OnStatus = s => Dispatcher.Invoke(() =>
                    {
                        SetBusy(true, s);
                        if (pending == null) pending = Say(ChatKind.System, s);
                        else Replace(pending, s);
                    }),
                    OnText = t => Dispatcher.Invoke(() =>
                    {
                        if (pending != null) { Replace(pending, t); pending = null; }
                        else Say(ChatKind.Assistant, t);
                    }),
                    OnToolStart = (name, label) => Dispatcher.Invoke(() =>
                        Say(ChatKind.Tool, label + "…", name)),
                    OnToolDone = (name, ok) => Dispatcher.Invoke(() =>
                    {
                        if (!ok) Say(ChatKind.Error, "«" + name + "» амжилтгүй боллоо.");
                    }),
                    OnDegraded = m => Dispatcher.Invoke(() => Say(ChatKind.System, m)),
                };

                await AgentChat.RunAsync(
                    st.ApiHost, st.Token, text, _docContext, st.ProjectId, ev);
            }
            catch (Exception ex)
            {
                Say(ChatKind.Error, RevitApi.FriendlyError(ex));
            }
            finally
            {
                SetBusy(false);
            }
        }

        /* ============================================================== */
        /*  НОРМ ШАЛГАЛТ — дүгнэлтийн урсгал (Track 2-5)                  */
        /* ============================================================== */

        /// <summary>
        /// «Ойлголоо» / «Хүчингүй болгох»-ыг СЕРВЕР рүү хүргэх гарц.
        ///
        /// ⚠️ NULL БАЙЖ БОЛНО, ба РЕЛИЗ N-д null ХЭВЭЭР — маршрутууд нь
        ///    энэ сессийн СЕРВЕР талд, тусад нь шипнэ.  Байхгүй маршрут руу
        ///    POST хийх нь ажилтны машинд 404-ийн шуурга үүсгэнэ
        ///    (`ComplianceScheduler.FindingSink`-ийн яг ижил үндэслэл).
        ///
        /// ⚠️ Sink нь ХЭЗЭЭ Ч БЛОКЛОХ ЁСГҮЙ — UI урсгалаас дуудагдана.
        ///    Дотроо `Task.Run` хийж, өөрөө шидэхгүй байх нь дуудагдагчийн
        ///    үүрэг; энд ямар ч тохиолдолд `try/catch` барина.
        /// </summary>
#pragma warning disable CS0649 // Сервер тал оноодог; энэ релизэд оноогч БАЙХГҮЙ.
        internal static Action<long, string> FindingAckSink;
        internal static Action<long, string, string, string> FindingOverrideSink;
#pragma warning restore CS0649

        /// <summary>
        /// Хүчингүй болголтын шалтгааны ХАМГИЙН БАГА урт.
        ///
        /// ⚠️ Сервер нь 8 тэмдэгтээс богино шалтгааныг 400 өгнө.  Ижил
        ///    босгыг клиент дээр барих нь хэрэглэгчид серверийн алдааны
        ///    мөрийг харуулахгүйн тулд — DB-ийн CHECK хүртэл хүрэх ёсгүй.
        /// </summary>
        private const int MinOverrideReasonLen = 8;

        private static long FindingNowSec()
        {
            return DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        }

        /// <summary>
        /// Кэшлэгдсэн эрхийн түвшин («0».. «5», эсвэл null = хараахан аваагүй).
        /// ⚠️ Сүлжээ ХӨНДӨХГҮЙ — `ApiClient.RefreshAuthorityLevelAsync` нь
        ///    сесс тутам нэг удаа арын урсгал дээр кэшийг дүүргэдэг.
        /// </summary>
        private static string CachedAuthority()
        {
            try
            {
                AddinSettings st = SettingsStore.Load();
                return st == null ? null : st.AuthorityLevel;
            }
            catch { return null; }
        }

        /// <summary>
        /// Дүгнэлтийг самбарт нийтэлнэ.  ⚠️ ЦОРЫН ГАНЦ ОРУУЛАХ ЦЭГ.
        ///
        /// ⚠️ ЯАГААД ЭНД `SetBusy` ДУУДАХГҮЙ ВЭ: `SetBusy` нь курсорыг
        ///    АППЛИКЕЙШН ДАМЖУУЛАН солидог (`:351`).  Дэвсгэрийн шалгалтад
        ///    түүнийг дуудвал инженер юу ч блоклогдоогүй байхад Revit-ийн
        ///    бүх цонхонд «завгүй» курсор хараад ГАЦСАН гэж ойлгоно.
        ///
        /// ⚠️ ЯАГААД ЭНД САМБАР НЭЭХГҮЙ ВЭ: add-in дахь цорын ганц
        ///    самбар нээх дуудлага нь `AssistantPaneProvider.cs:54` — хэрэглэгчийн
        ///    ribbon товч.  Самбар нь тэнд ЗАЛХУУ singleton тул ХААЛТТАЙ
        ///    байхад ч цуглуулга нь шинэчлэгдэнэ; тоо нь ribbon-ы бичээсээр
        ///    хүрнэ (`FindingFeed.BadgeCaption`).
        ///
        /// ⚠️ ЯАГААД ЭНД ФОКУС АВАХГҮЙ ВЭ: add-in дахь цорын ганц фокус
        ///    шилжүүлэлт нь `:1874` — хүн 👎 дарж, өөрөө бичихээр шийдсэний
        ///    ДАРАА.  Автомат урсгал ХЭЗЭЭ Ч фокус авдаггүй.
        ///
        /// ⚠️ LEVEL 0 (OBSERVE) дээр мөр ОГТ БҮТЭЭГДЭХГҮЙ — цуглуулга нь
        ///    хөдөлгүүрт үргэлжилнэ, гадаргуу нь ХОOСОН.  Энэ бол §80-ийн
        ///    «collect, do not surface» — «сул саарал болгох» БИШ.
        /// </summary>
        /// <remarks>
        /// ⚠️ ,  БИШ:  нь  тул
        /// нийтийн гарын үсэг нь CS0051 өгнө.  Дуудагч нь ямар ч тохиолдолд
        /// ЭНЭ ассемблей дотор (хуваарилагчийн ХҮЙТЭН зүсэлт) байна.
        /// </remarks>
        /// <summary>
        /// ХУВААРИЛАГЧААС ирсэн гадаргууг хүлээж авна — F5-ийн (a) давхарга.
        ///
        /// ⚠️ ЭНД МАРШАЛЛАХ ЁСТОЙ, `PublishFindings`-т НАЙДАЖ БОЛОХГҮЙ:
        ///    `FindingFeed.Build` нь `_feedState`-ийг уншина, тэр нь
        ///    «Ойлголоо» дарахад UI урсгал дээр БИЧИГДДЭГ `Dictionary`.
        ///    Арын урсгалаас `Build` дуудвал тэр толь хоёр урсгалаас зэрэг
        ///    хөндөгдөнө.  Тиймээс ЭХЛЭЭД UI урсгал руу гараад, ДАРАА нь л
        ///    барина.
        ///
        /// ⚠️ `InvokeAsync` (ГАЛТ-МАРТАХ), `Invoke` БИШ — дуудагч урсгал нь
        ///    `ChangeTracker.Gate` барьсан байж болзошгүй ба синхрон
        ///    маршаллалт нь Revit-ийг бүхэлд нь гацаана.
        /// </summary>
        internal void AcceptSurface(IList<FindingFeed.Item> items, bool wholeModel)
        {
            if (!Dispatcher.CheckAccess())
            {
                IList<FindingFeed.Item> copy = items;
                bool whole = wholeModel;
                Dispatcher.InvokeAsync(new Action(() => AcceptSurface(copy, whole)));
                return;
            }

            // ⚠️ null нь «хүргэлт болоогүй» — ТУГИЙГ ТАВИХГҮЙ.  Хоосон
            //    ЖАГСААЛТ (`Count == 0`) нь ӨӨР зүйл: «хүргэсэн, дотор нь юу
            //    ч алга».  Хоёрыг андуурвал F5 буцаж ирнэ.
            if (items == null) return;

            _lastSurface = items;
            _surfaceWholeModel = wholeModel;
            _surfaceDelivered = true;
            PublishFindings(FindingFeed.Build(items, _feedState, FindingNowSec(), LocalMinSeverityRank));
        }

        internal void PublishFindings(FindingFeed.Result r)
        {
            // ⚠️ ХАМГИЙН ЧУХАЛ ХАМГААЛАЛТ.  Дуудагч нь хуваарилагчийн арын
            //    урсгал байж болзошгүй ба тэр урсгал `ChangeTracker.Gate`
            //    барьж байж болно.  `Invoke` (синхрон) нь тэр тохиолдолд
            //    хоёр урсгалын deadlock — Revit бүхэлдээ гацна.  Тиймээс
            //    ГАЛТ-МАРТАХ `InvokeAsync`, ҮРГЭЛЖ.
            if (!Dispatcher.CheckAccess())
            {
                FindingFeed.Result copy = r;
                Dispatcher.InvokeAsync(new Action(() => PublishFindings(copy)));
                return;
            }

            _lastFeed = r;
            _findings.Clear();

            string level = CachedAuthority();
            bool surface = FindingFeed.Surfaces(level);
            bool recommend = FindingFeed.ShowsRecommendation(level);

            if (surface && r != null)
            {
                foreach (FindingFeed.Group g in r.Groups)
                {
                    if (g == null || g.Primary == null) continue;
                    // ⚠️ F4 — `g.Promoted` НЬ ЗААВАЛ ДАМЖИНА.  Тугийг унших
                    //    ёстой цорын ганц газар нь ЭНЭ; орхивол симптом дээр
                    //    «Үндсэн шалтгаан» гэж бичигдэж инженер БУРУУ
                    //    ЭЛЕМЕНТ засна (`compliance.ts:4290`).
                    _findings.Add(RowOf(g.Primary, true, g.Promoted, recommend));
                    foreach (FindingFeed.Item c in g.Consequences)
                    {
                        if (c == null) continue;
                        _findings.Add(RowOf(c, false, g.Promoted, recommend));
                    }

                    int more = g.ConsequenceTotal - g.Consequences.Count;
                    if (more > 0)
                        _findings.Add(NoteRow(Lang.T(
                            "…бас " + more + " дагавар",
                            "…and " + more + " more consequences")));
                }

                // ⚠️ Таслагдсаныг ИЛ хэлнэ — «санамсаргүй N»-г БҮРЭН жагсаалт
                //    гэж ойлгуулах нь `ChangeReport.cs:56-60`-ийн тэмдэглэсэн
                //    алдаа.  Дүгнэлтийн хувьд тэр нь илүү аюултай: инженер
                //    үлдсэн зөрчлийг ХАРААГҮЙ хэвээр файлаа хаана.
                if (r.Truncated > 0)
                    _findings.Add(NoteRow(Lang.T(
                        "+" + r.Truncated + " бүлэг харагдаагүй — хүнд байдлаар эрэмбэлэв.",
                        "+" + r.Truncated + " groups not shown — sorted by severity.")));
            }

            RefreshFindingsChrome();
        }

        /// <summary>Толгой ба хамрах хүрээний мөрийг ОДООГИЙН төлөвөөр дахин бичнэ.</summary>
        private void RefreshFindingsChrome()
        {
            if (FindingsHeaderText == null || FindingsScopeText == null) return;

            string level = CachedAuthority();
            bool surface = FindingFeed.Surfaces(level);
            bool noPack = ComplianceScheduler.NoPack;
            int n = surface && _lastFeed != null ? _lastFeed.Groups.Count : 0;

            // ⚠️ F5 — ШИЙДВЭР ЭНД ГАРАХГҮЙ.  «Дүгнэлт алга»-гийн ЗУРГААН
            //    шалтгааныг ялгах логик нь `FindingFeed.StateOf` дотор,
            //    ЦЭВЭР бөгөөд `check_findingfeed.py`-гаар шалгагддаг.  Энд
            //    `if` бичих нь тестлэгддэггүй WPF файлд «хоосон жагсаалт ⇒
            //    цэвэр» гэсэн чимээгүй тэнцлийг ДАХИН төрүүлэх зам.
            FindingFeed.SurfaceState state = FindingFeed.StateOf(
                level, noPack, ComplianceScheduler.SurfaceWired,
                _surfaceDelivered, _surfaceWholeModel, n);

            FindingsHeaderText.Text =
                state == FindingFeed.SurfaceState.Findings
                    ? Lang.T("Норм шалгалт (" + n + ")", "Compliance (" + n + ")")
                    : (FindingFeed.ClaimsClean(state)
                        ? Lang.T("Норм шалгалт — анхаарах зүйл алга",
                                 "Compliance — nothing to review")
                        // ⚠️ БУСАД БҮХ ТӨЛӨВ нь ТӨВИЙГ САХИСАН толгой авна.
                        //    «Алга» гэсэн үг зөвхөн `Clean`-д харагдана.
                        : Lang.T("Норм шалгалт", "Compliance"));

            var sb = new System.Text.StringBuilder();
            switch (state)
            {
                case FindingFeed.SurfaceState.AuthorityUnknown:
                    // «Хараахан уншаагүй» ба «OBSERVE» хоёр өөр төлөв — хольж
                    // болохгүй, эс бөгөөс сүлжээний асуудал горим мэт харагдана.
                    sb.Append(Lang.T("Эрхийн түвшин хараахан уншигдаагүй — дүгнэлт харагдахгүй.",
                                     "Authority level has not been read yet — findings stay hidden."));
                    break;
                case FindingFeed.SurfaceState.Observe:
                    sb.Append(Lang.T("Ажиглалт горим — дүрмийн үр дүн хараахан харагдахгүй.",
                                     "Observe mode — results are not surfaced yet."));
                    break;
                case FindingFeed.SurfaceState.NoPack:
                    sb.Append(Lang.T(
                        "Энэ багт дүрмийн багц хараахан бэлэн болоогүй — нийцлийн шалгалт хийгдээгүй.",
                        "No rule pack for this team yet — no compliance check has run."));
                    break;
                case FindingFeed.SurfaceState.NoProducer:
                    // ⛔ ЭНЭ НЬ АЛДАА, ХЭВИЙН ТӨЛӨВ БИШ.  Дүрэм ажиллаж
                    //    байгаа ч үр дүн хэн ч харахгүй байна — чимээгүй
                    //    хоосон жагсаалтаас ХАМААГҮЙ дээр.
                    sb.Append(Lang.T(
                        "⚠ Дүрэм ажиллаж байгаа ч үр дүнг хүргэх суваг холбогдоогүй — " +
                        "жагсаалт БҮРЭН БИШ. Мэдээллийн албанд хандана уу.",
                        "⚠ Rules are running but no channel delivers the results — " +
                        "this list is NOT complete. Please report it."));
                    break;
                case FindingFeed.SurfaceState.NotYetRun:
                    sb.Append(Lang.T("Шалгалтын үр дүн хараахан ирээгүй — «цэвэр» гэсэн үг БИШ.",
                                     "No results have arrived yet — this does NOT mean clean."));
                    break;
                case FindingFeed.SurfaceState.PartialClean:
                    // ⚠️ §56 — өсөлтөт мөчлөг нь ЗАССАН элементийг Л шалгасан.
                    //    Түүнээс «загварт зөрчил алга» гэж бичих нь ЧИМЭЭГҮЙ
                    //    ТЭНЦЭЛ.  Бүтэн скан хийхийг ил санал болгоно.
                    sb.Append(Lang.T(
                        "Хийгдсэн шалгалтад анхаарах зүйл гарсангүй — бүтэн загварыг шалгаагүй.",
                        "Nothing found in what was checked — the whole model was not scanned."));
                    break;
                case FindingFeed.SurfaceState.Clean:
                    sb.Append(Lang.T("Бүтэн шалгалтад анхаарах зүйл гарсангүй.",
                                     "A full scan found nothing to review."));
                    break;
            }

            if (surface && !noPack)
            {
                if (!string.Equals(ComplianceScheduler.LastCoverage, "full", StringComparison.Ordinal))
                    sb.Append(Lang.T("  ·  бүх дүрэм амжаагүй — хэсэгчлэн шалгав",
                                     "  ·  partial — not every rule was evaluated"));
                if (_lastFeed != null && _lastFeed.Hidden > 0)
                    sb.Append(Lang.T("  ·  " + _lastFeed.Hidden + " мөр түр нуугдсан",
                                     "  ·  " + _lastFeed.Hidden + " hidden for now"));
                if (_lastFeed != null && _lastFeed.AnyStale)
                    sb.Append(Lang.T("  ·  зарим мөр дахин шалгах шаардлагатай",
                                     "  ·  some rows need a re-check"));
            }

            FindingsScopeText.Text = sb.ToString();
        }

        /// <summary>Нэг дүгнэлт → нэг харагдацын мөр.</summary>
        /// <param name="promoted">
        /// ⚠️ ЭНЭ БҮЛГИЙН ЖИНХЭНЭ ҮНДЭС нь жагсаалтад БАЙХГҮЙ
        /// (`FindingFeed.Group.Promoted`).  Үнэн бол «Үндсэн шалтгаан» гэж
        /// бичих нь ХУДАЛ: жинхэнэ үндэс нь өөр хүний олдвор, хүчингүй
        /// болгогдсон мөр, эсвэл `min_severity`-ийн доор унасан зүйл байж
        /// болно.  Инженер симптомыг үндэс гэж итгээд БУРУУ ЭЛЕМЕНТ засна.
        /// </param>
        private FindingViewRow RowOf(FindingFeed.Item it, bool isPrimary, bool promoted, bool recommend)
        {
            string title = Lang.T(it.TitleMn, it.TitleEn);
            if (string.IsNullOrWhiteSpace(title)) title = Lang.T(it.TitleEn, it.TitleMn);
            if (string.IsNullOrWhiteSpace(title)) title = ClassLabel(it.IssueClass);
            if (string.IsNullOrWhiteSpace(title)) title = Lang.T("Дүгнэлт", "Finding");

            var sub = new System.Text.StringBuilder();
            if (isPrimary)
            {
                // ⚠️ «Үндсэн шалтгаан» гэж бичих ЭРХ нь `promoted == false`
                //    үед Л төрнө.  Нугалагдсан толгой нь зүгээр л ХАРАГДАЖ
                //    БАЙГАА хамгийн хүнд мөр.
                sub.Append(promoted
                    ? Lang.T("Илэрсэн шинж — үндсэн шалтгаан нь энэ жагсаалтад алга",
                             "Symptom — the root cause is not in this list")
                    : Lang.T("Үндсэн шалтгаан", "Primary cause"));
            }
            else
            {
                // ⚠️ Нугалагдсан бүлэгт дагаврууд нь ТОЛГОЙГООС үүдээгүй —
                //    хоёул ХАРАГДАХГҮЙ БАЙГАА нэг үндэснээс үүдсэн.  «Үүнээс
                //    үүдсэн» гэж бичих нь буруу учир шалтгаан заана.
                sub.Append(promoted
                    ? Lang.T("Ижил үндэстэй", "Shares that root cause")
                    : Lang.T("Үүнээс үүдсэн", "Caused by the above"));
            }

            string cls = ClassLabel(it.IssueClass);
            if (!string.IsNullOrEmpty(cls)) sub.Append("  ·  ").Append(cls);

            string ev = EvidenceLine(it);
            if (!string.IsNullOrEmpty(ev)) sub.Append("  ·  ").Append(ev);

            if (it.IsStale)
                sub.Append(Lang.T("  ·  дахин шалгах шаардлагатай", "  ·  needs re-check"));

            // ⚠️ ЗӨВЛӨМЖ нь LEVEL 2 (RECOMMEND)-оос ӨМНӨ ГАРАХГҮЙ.  LEVEL 1
            //    нь «харуул + ЯАГААД», «юу хийхийг хэл» БИШ (§80).
            string extra = null;
            if (recommend)
            {
                extra = Lang.T(it.RecommendationMn, it.RecommendationEn);
                if (string.IsNullOrWhiteSpace(extra)) extra = null;
            }

            return new FindingViewRow
            {
                IsPrimary = isPrimary,
                DedupKey = it.DedupKey,
                ServerId = it.ServerId,
                ElementId = it.ElementId,
                SeverityRank = FindingFeed.RankOf(it.Severity),
                Title = VerdictLabel(it.Verdict) + "  ·  " + title,
                Sub = sub.ToString(),
                Extra = extra,
                Hint = it.ElementId > 0
                    ? Lang.T("Элемент рүү очих", "Go to element")
                    : Lang.T("Энэ дүгнэлт нэг элементэд холбогдоогүй",
                             "This finding is not tied to a single element"),
                // ⚠️ БИЧЭЭС нь ҮНЭНЭЭ ХЭЛНЭ: сервер тал хараахан байхгүй үед
                //    даралт нь ЗӨВХӨН 7 хоногийн локал хойшлуулалт болно, тэр
                //    нь «Ойлголоо» БИШ, «Дараа» юм.  Хоёрыг андуурвал хүн
                //    бүртгэгдээгүй шийдвэрээ бүртгэгдсэн гэж ойлгоно.
                AckLabel = FindingAckSink != null
                    ? Lang.T("Ойлголоо", "Acknowledged")
                    : Lang.T("Дараа", "Later"),
                OverrideLabel = Lang.T("Хүчингүй болгох", "Override"),
            };
        }

        private static FindingViewRow NoteRow(string text)
        {
            return new FindingViewRow { IsNote = true, Title = text, SeverityRank = 4 };
        }

        private static string VerdictLabel(string verdict)
        {
            switch (verdict)
            {
                case "VIOLATION": return Lang.T("Зөрчил", "Violation");
                case "WARNING": return Lang.T("Анхааруулга", "Warning");
                case "PASS": return Lang.T("Тэнцсэн", "Pass");
                // ⚠️ ТАНИХГҮЙ утга нь «тэнцсэн» БИШ.  Үнэлж чадаагүй зүйл нь
                //    зөрчил ч биш, тэнцсэн ч биш — хүн шалгана.
                default: return Lang.T("Тодорхойгүй — хүн шалгана", "Uncertain — needs a human");
            }
        }

        private static string ClassLabel(string issueClass)
        {
            switch (issueClass)
            {
                case "REGULATORY_VIOLATION": return Lang.T("Нормын зөрчил", "Regulatory violation");
                case "MODEL_QUALITY": return Lang.T("Загварын чанар", "Model quality");
                case "PROJECT_INCOMPLETENESS": return Lang.T("Төслийн мэдээлэл дутуу", "Project incompleteness");
                case "TEAM_STANDARD": return Lang.T("Багийн стандарт", "Team standard");
                case "UNKNOWN_NEEDS_REVIEW": return Lang.T("Хүн шалгах шаардлагатай", "Needs review");
                default: return string.Empty;
            }
        }

        /// <summary>
        /// §65 — НОТОЛГООНЫ ТҮВШНИЙ өгүүлбэр.
        ///
        /// ⚠️ ЭШЛЭЛ нь `CitationMn`-ээр ЛЭ гарна.  Тэр талбар нь серверийн
        ///    хавчаараас (`rules.verification_state`) ГАРСАН утга — клиент
        ///    ХЭЗЭЭ Ч өөрөө заалт зохиохгүй.  Хоосон байхад «эх сурвалж»
        ///    гэж бичих нь баталгаажаагүй тоог норм мэт харагдуулна.
        ///
        /// ⚠️ «баталгаажлаа» / «нийцэж байна» гэсэн үг ЭНД ХЭЗЭЭ Ч
        ///    ГАРАХГҮЙ (§69-R3 — энэ нь хуулийн гэрчилгээ БИШ).
        /// </summary>
        private static string EvidenceLine(FindingFeed.Item it)
        {
            string cite = it.CitationMn;
            bool hasCite = !string.IsNullOrWhiteSpace(cite);

            switch (it.EvidenceLevel)
            {
                case "RULE_BACKED":
                    return hasCite
                        ? Lang.T("Эх сурвалж: " + cite, "Source: " + cite)
                        : Lang.T("Эх сурвалж хавсрагдаагүй — заалт харагдахгүй.",
                                 "Source not attached — no clause to show.");
                case "MODEL_DERIVED":
                    return Lang.T("Дотоод шалгуур (эх сурвалж баталгаажаагүй)",
                                  "Internal check (source unverified)");
                case "HUMAN_VERIFIED":
                    return hasCite
                        ? Lang.T("Хүн баталсан: " + cite, "Verified by " + cite)
                        : Lang.T("Хүн баталсан", "Human verified");
                case "AI_INFERRED":
                    return Lang.T("AI-ийн таамаг — норм БИШ. Заавал хүн шалгана.",
                                  "AI inference — not a regulation. Must be checked.");
                default:
                    return Lang.T("Эх сурвалж тодорхойгүй — тооцоонд авахгүй.",
                                  "Unknown provenance — not counted.");
            }
        }

        /// <summary>
        /// Задлах / хураах.  ⚠️ ЭНД СҮЛЖЭЭ Ч, СКАН Ч БАЙХГҮЙ — «Δ
        /// өөрчлөлтүүд» шиг эхний задлалт дээр өгөгдөл татвал инженер
        /// хэсгийг нээх бүрдээ хүлээх болно.  Дүгнэлт нь ДЭЭД урсгалаас
        /// өөрөө ирдэг.
        /// </summary>
        private void FindingsExpander_Changed(object sender, RoutedEventArgs e)
        {
            if (FindingsExpander == null) return;
            if (FindingsExpander.IsExpanded)
            {
                CollapseOthers(null, true);   // норм шалгалт нээгдэхэд бусад хэсэг хаагдана
                RefreshFindingsChrome();
                return;
            }
            // Хураахад хагас бөглөсөн хүчингүй болголтыг ХАЯНА — далд төлөв
            // үлдээвэл дараагийн удаа өөр дүгнэлт дээр нээгдэнэ.
            FindingOverrideHost.Visibility = Visibility.Collapsed;
            _overrideTarget = null;
        }

        /// <summary>
        /// Мөр дээр дарахад тэр элемент рүү үсэрнэ.
        ///
        /// ⚠️ `goto_element` нь харагдац сольж → сонгож → ойртдог ба ямар ч
        ///    цонх гаргадаггүй (`ChangeReport.cs:39-45`).  ШИНЭ ХЭРЭГСЭЛ
        ///    БИЧИХГҮЙ.
        /// </summary>
        private async void FindingRow_Click(object sender, RoutedEventArgs e)
        {
            var btn = sender as Button;
            var row = btn == null ? null : btn.Tag as FindingViewRow;
            if (row == null || row.IsNote) return;
            if (row.ElementId <= 0) return;
            await GotoFindingElementAsync(row);
        }

        private async Task GotoFindingElementAsync(FindingViewRow row)
        {
            if (_busy) return;
            // ⚠️ `SetBusy` нь ЭНД ЗӨВШӨӨРӨГДӨНӨ: хэрэглэгч ӨӨРӨӨ мөр дарсан
            //    тул хүлээлт нь түүний ил хүсэлт.  ДЭВСГЭРИЙН ажилд ХЭЗЭЭ Ч БИШ.
            SetBusy(true, Lang.T("Олж байна…", "Locating…"));
            try
            {
                JsonElement js = await Task.Run(() =>
                    RevitApi.CallTool("goto_element", new { element_id = row.ElementId }));
                GotoResult g = JsonSerializer.Deserialize<GotoResult>(
                    js.GetRawText(), ApiClient.ReadOptions);

                var sb = new System.Text.StringBuilder();
                sb.Append(row.Title);
                if (g != null && !string.IsNullOrWhiteSpace(g.SheetNumber))
                {
                    sb.Append("  →  ").Append(g.SheetNumber);
                    if (!string.IsNullOrWhiteSpace(g.SheetName)) sb.Append(' ').Append(g.SheetName);
                }
                if (g != null && !string.IsNullOrWhiteSpace(g.ViewName))
                    sb.Append(Lang.T("\nхарагдац: ", "\nview: ")).Append(g.ViewName);
                Say(ChatKind.System, sb.ToString());
            }
            catch (Exception ex)
            {
                Say(ChatKind.Error, ex.Message);
            }
            finally { SetBusy(false); }
        }

        /// <summary>
        /// «Ойлголоо» / «Дараа» — мөрийг 7 хоног хойшлуулна.
        ///
        /// ⚠️ `e.Handled = true` нь ЗААВАЛ.  `Click` нь бөмбөлөгдөж дээшилдэг
        ///    тул үүнгүйгээр ГАДНА мөрийн `FindingRow_Click` бас ажиллаж,
        ///    даралт бүр дээр Revit-ийн харагдац солигдоно.
        /// </summary>
        private void FindingAck_Click(object sender, RoutedEventArgs e)
        {
            e.Handled = true;
            var btn = sender as Button;
            var row = btn == null ? null : btn.Tag as FindingViewRow;
            if (row == null || row.IsNote) return;

            FindingFeed.Acknowledge(_feedState, row.DedupKey, FindingNowSec());

            Action<long, string> sink = FindingAckSink;
            if (sink != null)
            {
                try { sink(row.ServerId, row.DedupKey); }
                catch { /* сүлжээ / сервер — локал хойшлуулалт хэвээр (§75) */ }
            }
            RebuildFindings();
        }

        /// <summary>
        /// «Хүчингүй болгох» — самбар доторх МӨР нээнэ.
        /// ⚠️ МОДАЛЬ ЦОНХ БИШ: модаль нь Revit-ийн үндсэн урсгалыг товч
        ///    дарах хүртэл блоклоно (`ChangeReport.cs:39-42`-ийн үндэслэл).
        /// </summary>
        private void FindingOverride_Click(object sender, RoutedEventArgs e)
        {
            e.Handled = true;
            var btn = sender as Button;
            var row = btn == null ? null : btn.Tag as FindingViewRow;
            if (row == null || row.IsNote || row.ServerId <= 0) return;

            _overrideTarget = row;
            FindingOverrideTitle.Text = Lang.T("Хүчингүй болгох: ", "Override: ") + row.Title;
            FindingOverrideKind.ItemsSource = OverrideKindChoices();
            FindingOverrideKind.SelectedIndex = 0;
            FindingOverrideReason.Text = string.Empty;
            UpdateOverrideApplyState();
            FindingOverrideHost.Visibility = Visibility.Visible;
            // ⚠️ ФОКУС АВАХГҮЙ — хүн Revit дээр бичиж байж болно.
        }

        private void FindingOverrideCancel_Click(object sender, RoutedEventArgs e)
        {
            FindingOverrideHost.Visibility = Visibility.Collapsed;
            _overrideTarget = null;
        }

        private void FindingOverrideReason_Changed(object sender, TextChangedEventArgs e)
        {
            UpdateOverrideApplyState();
        }

        private void UpdateOverrideApplyState()
        {
            if (FindingOverrideApply == null || FindingOverrideHint == null) return;
            string reason = (FindingOverrideReason.Text ?? string.Empty).Trim();
            bool ok = _overrideTarget != null && reason.Length >= MinOverrideReasonLen;
            FindingOverrideApply.IsEnabled = ok;
            FindingOverrideHint.Text = ok
                ? Lang.T("Дүгнэлт устахгүй — түүхэнд үлдэнэ.",
                         "The finding is not deleted — it stays in the record.")
                : Lang.T("Шалтгаан заавал (наад зах нь " + MinOverrideReasonLen + " тэмдэгт).",
                         "A reason is required (at least " + MinOverrideReasonLen + " characters).");
        }

        private void FindingOverrideApply_Click(object sender, RoutedEventArgs e)
        {
            FindingViewRow row = _overrideTarget;
            if (row == null) return;

            var kind = FindingOverrideKind.SelectedItem as OverrideKindChoice;
            string reason = (FindingOverrideReason.Text ?? string.Empty).Trim();
            if (kind == null || reason.Length < MinOverrideReasonLen) return;

            FindingOverrideHost.Visibility = Visibility.Collapsed;
            _overrideTarget = null;

            FindingFeed.Acknowledge(_feedState, row.DedupKey, FindingNowSec());

            Action<long, string, string, string> sink = FindingOverrideSink;
            if (sink != null)
            {
                try { sink(row.ServerId, row.DedupKey, kind.Code, reason); }
                catch { /* дараагийн синк дээр дахин оролдоно — мөр нуугдсан хэвээр */ }
                Say(ChatKind.System, Lang.T(
                    "Хаагдлаа. Дүгнэлт устаагүй — түүхэнд үлдэнэ.",
                    "Closed. The finding is not deleted — it stays in the record."));
            }
            else
            {
                // ⚠️ ҮНЭНЭЭ ХЭЛНЭ.  Сервер тал хараахан байхгүй бол хаалт нь
                //    ЗӨВХӨН энэ сессийн харагдац — «түүхэнд үлдэнэ» гэж
                //    хэлэх нь худал бөгөөд §68-ийн гинжийг байхгүй байхад
                //    байгаа мэт харагдуулна.
                Say(ChatKind.System, Lang.T(
                    "Энэ сесст нуулаа — сервер рүү илгээгдээгүй тул бүртгэлд үлдэхгүй.",
                    "Hidden for this session — it was not sent to the server, so it is not recorded."));
            }

            RebuildFindings();
        }

        /// <summary>
        /// §68-ийн зургаан төрөл.
        ///
        /// ⚠️ `FALSE_POSITIVE` ба `ACCEPTED_RISK`-ыг ХЭЗЭЭ Ч НЭГТГЭХГҮЙ:
        ///    эхнийх нь «ДҮРЭМ буруу», сүүлийнх нь «дүрэм ЗӨВ ч зориудаар
        ///    давсан».  Нэгтгэвэл §66-ийн худал дохионы хэмжүүр
        ///    хэмжигдэхээ болино.
        /// </summary>
        private static List<OverrideKindChoice> OverrideKindChoices()
        {
            return new List<OverrideKindChoice>
            {
                new OverrideKindChoice { Code = "FALSE_POSITIVE",
                    Label = Lang.T("Дүрэм буруу ажиллав — загвар зөв", "False positive — the model is right") },
                new OverrideKindChoice { Code = "RULE_WRONG",
                    Label = Lang.T("Дүрмийн утга буруу (босго/нэгж/заалт)", "The rule itself is wrong") },
                new OverrideKindChoice { Code = "NOT_APPLICABLE_HERE",
                    Label = Lang.T("Энэ тохиолдолд хамаарахгүй", "Not applicable here") },
                new OverrideKindChoice { Code = "ACCEPTED_RISK",
                    Label = Lang.T("Зөрчил мөн — мэдсээр байж хүлээн авав", "Accepted risk") },
                new OverrideKindChoice { Code = "DESIGN_EXCEPTION",
                    Label = Lang.T("Зөвшөөрөгдсөн онцгой шийдэл", "Approved design exception") },
                new OverrideKindChoice { Code = "DUPLICATE",
                    Label = Lang.T("Өөр дүгнэлттэй давхардсан", "Duplicate of another finding") },
            };
        }

        /// <summary>
        /// Хүлээн зөвшөөрлийн ДАРАА жагсаалтыг дахин барина.
        ///
        /// ⚠️ Босго нь ДЭЭД урсгалд аль хэдийн хэрэглэгдсэн (эдгээр мөр
        ///    түүнийг давсан) тул энд ХАМГИЙН СУЛ зэрэглэлээр (INFO = 4)
        ///    барина.  Өөр тоо бичих нь серверийн `min_severity`-г C#-д
        ///    ХОЁР ДАХЬ удаа тодорхойлсон хэрэг болно (⛔ хатуу бичихгүй).
        ///
        /// ⚠️ ТҮҮХИЙ ГАДАРГУУГААС барина, `_lastFeed`-ЭЭС БИШ.  `Build` нь
        ///    төсвөөс хэтэрсэн бүлгийг ХАЯДАГ тул үр дүнгээс нь дахин барих
        ///    нь «нэг мөр хүлээн зөвшөөрөх бүрд жагсаалт БАГАСАХ» гэсэн
        ///    ханхлам алдагдал болно — таслагдсан 60 бүлэг хэзээ ч буцаж
        ///    ирэхгүй.  Гадаргуу нь хуваарилагчийн мэдэлд бүтнээрээ байдаг.
        ///
        /// ⚠️ `_surfaceDelivered` тугийг ЭНД ТАВИХГҮЙ.  Дахин барилт нь
        ///    ХҮРГЭЛТ БИШ; тавивал самбар өөрийгөө «хүргэгдсэн» гэж
        ///    итгүүлэх ба F5-ийн чимээгүй тэнцэл буцаж ирнэ.
        /// </summary>
        private void RebuildFindings()
        {
            if (_lastSurface == null) { PublishFindings(null); return; }
            PublishFindings(FindingFeed.Build(
                _lastSurface, _feedState, FindingNowSec(), LocalMinSeverityRank));
        }

        /* ============================================================== */
        /*  Дуу оруулах — БЭЛТГЭЛ ШАТАНД                                  */
        /* ============================================================== */

        // ⚠️ Микрофоны бичлэг + монгол STT нь дараагийн шатанд.  Товчийг
        // үлдээж, дарахад шударгаар «удахгүй» гэж хэлнэ — идэвхгүй саарал
        // товч харагдахаас илүү ойлгомжтой.
        private void MicBtn_Down(object sender, MouseButtonEventArgs e) { }

        private void MicBtn_Up(object sender, MouseButtonEventArgs e)
        {
            Say(ChatKind.System,
                "Дуугаар бичих боломж бэлтгэгдэж байна — одоохондоо бичээд илгээнэ үү.");
        }
    }
}
