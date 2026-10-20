using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using Autodesk.Revit.DB;
using RevitMcpAddin.CloneDrawings.Core;

namespace RevitMcpAddin.CloneDrawings
{
    /// <summary>Холбогдсон харагдацыг зорилт бүрд юу хийх.</summary>
    public enum CdViewMode
    {
        /// <summary>Зорилт бүрд ШИНЭ харагдац (зүсэлт, callout, тайрсан план, 3D) үүсгэнэ.</summary>
        NewView,
        /// <summary>Ерөнхий харагдац — зорилт тэнд харагдаж байвал tag, хэмжээсийг ТЭНД нь нэмнэ.</summary>
        InPlace,
        Skip,
    }

    /// <summary>Загвар элементэд холбогдсон нэг харагдац (цонхны нэг мөр).</summary>
    public sealed class CdLinkedView
    {
        public ElementId ViewId;
        public string UniqueId;
        public string Name;
        public string TypeLabel;
        public ViewType ViewType;
        public string SheetNumber;
        public string SheetName;
        public ElementId SheetId;
        public bool CanClone;
        public bool Dedicated;
        public bool Manual;
        /// <summary>Нэрэнд загварын тэмдэг («B1») орсноор олдсон.</summary>
        public bool ByName;
        public bool IsCallout;
        public ElementId CalloutParentId;
        public CdViewMode Mode = CdViewMode.InPlace;
        public int Tags, Dims, Spots, Details, Mra;

        /// <summary>
        /// 1.9.1: загвартай хэрхэн холбогдсон — өөрийн зураг / ерөнхий / бусад элементийн.  Зөвхөн «өөрийн»
        /// өгөгдмөлөөр сонгогдоно (<see cref="ViewRelevanceRule"/>).
        /// </summary>
        public ViewRelevance Relevance = ViewRelevance.Own;
        /// <summary>Яагаад энэ бүлэгт орсон — «B2-д хувилсан», «Багана «C1»-ийн зураг» … (хоосон байж болно).</summary>
        public string RelevanceNote;
        /// <summary>Шүүлтийн төрөл (<see cref="ViewTypeGroups"/>).</summary>
        public string TypeGroup;
        /// <summary>«Бусад харагдац хайх»-аар олдсон (холбогдоогүй нэр дэвшигч).</summary>
        public bool Found;
        /// <summary>Тусгай харагдацын tag/хэмжээс элементийн төрлөөр — цонхны «аль элементийн tag» жагсаалт.</summary>
        public List<CdAnnKind> Kinds = new List<CdAnnKind>();

        public string CountsText
        {
            get
            {
                var parts = new List<string>();
                if (Tags > 0) parts.Add("tag " + Tags);
                if (Dims > 0) parts.Add("хэмжээс " + Dims);
                if (Spots > 0) parts.Add("түвшин " + Spots);
                if (Details > 0) parts.Add("2D " + Details);
                if (Mra > 0) parts.Add("MRA " + Mra);
                if (ByName) parts.Insert(0, "нэрээр");
                if (parts.Count == 0) parts.Add(Manual ? "гараар холбосон" : "—");
                return string.Join(" · ", parts);
            }
        }
    }

    /// <summary>Загвар элементийн шинжилгээ — цонхонд харуулах бүх зүйл.</summary>
    public sealed class CdTemplateInfo
    {
        public ElementId Id;
        public string UniqueId;
        public ElementId CategoryId;
        public string CategoryName;
        /// <summary>Инженерийн нэр — «Дам нуруу», «Ферм», «Багана» …</summary>
        public string Kind;
        public string TypeName;
        public ElementId TypeId;
        public string Mark;
        public string Label;
        public ElementId LevelId;
        public CdFrame Frame;
        /// <summary>Загвар + түүнд суусан элементүүд (арматур, нүх, хаалга …).</summary>
        public HashSet<ElementId> Related = new HashSet<ElementId>();
        public int RebarCount;
        public List<CdLinkedView> Views = new List<CdLinkedView>();
        /// <summary>Загварыг харуулдаг ч tag/хэмжээсгүй — гараар холбож болох харагдацууд.</summary>
        public List<CdLinkedView> Candidates = new List<CdLinkedView>();
        /// <summary>Олдсон харагдацуудын tag/хэмжээс аль төрлийн элементийнх вэ.</summary>
        public List<CdAnnKind> AnnotationKinds = new List<CdAnnKind>();
        public long AnalyzeMs;

        public string Summary =>
            Kind + " · " + TypeName + (string.IsNullOrWhiteSpace(Mark) ? "" : " · тэмдэг «" + Mark + "»")
            + " · ID " + Id.Value;
    }

    /// <summary>Нэг төрлийн элементийн (Ферм, Багана …) tag/хэмжээсийн тоо — цонхны сонголтын мөр.</summary>
    public sealed class CdAnnKind
    {
        public string Kind;
        public bool IsTemplate;
        public int Tags, Dims;

        public string CountsText
        {
            get
            {
                var parts = new List<string>();
                if (Tags > 0) parts.Add("tag " + Tags);
                if (Dims > 0) parts.Add("хэмжээс " + Dims);
                return parts.Count == 0 ? "—" : string.Join(" · ", parts);
            }
        }
    }

    /// <summary>Нэг зорилтын мэдээлэл (цонхны мод-жагсаалтын навч).</summary>
    public sealed class CdTargetInfo
    {
        public ElementId Id;
        public string UniqueId;
        public string Mark;
        public string Label;
        public string TypeName;
        public string LevelName;
        public string GroupKey;
        public string GroupLabel;
        public string Details;
        public int ExistingClones;
        public bool Include = true;
        public TargetFacts Facts;

        public string Row
        {
            get
            {
                string s = Label + "   " + Details;
                if (ExistingClones > 0)
                    s += "   [өмнө хувилсан: " + ExistingClones + "]";
                return s;
            }
        }
    }

    public sealed class CdOptions
    {
        public bool Tags = true;
        public bool Dimensions = true;
        public bool Spots = true;
        public bool Details = true;
        public bool Sheets = true;
        public bool Rebar = true;
        /// <summary>Текст, харагдац/хуудасны нэр дэх загварын тэмдэгийг («B1») зорилтынхоор солино.</summary>
        public bool ReplaceMark = true;
        /// <summary>Өмнө хувилсан харагдац/хуудсыг устгаад шинээр үүсгэнэ.</summary>
        public bool Recreate;
        /// <summary>
        /// Аль төрлийн элементийн tag/хэмжээсийг хувилах («Дам нуруу», «Ферм» …).  null = бүгд.
        /// Загвар ба түүний арматурын tag/хэмжээс ҮРГЭЛЖ хувилагдана.
        /// </summary>
        public HashSet<string> AnnotationKinds;
    }

    /// <summary>
    /// Нэг удаагийн тоолуур.  БҮХ алгасалт тоологдоно — хэрэглэгч «юу шилжээгүй»-г
    /// мэдэж байж л гараар нөхнө.
    /// </summary>
    public sealed class CdReport
    {
        /// <summary>
        /// TargetsDone — бүх алхам нь гүйсэн зорилт.  TargetsFailed — ядаж нэг алхам нь Revit-д буцаагдсан
        /// (1.9.1-ээс алхам тутамд transaction тул бусад алхам нь хадгалагдсан).  TargetsUnfinished — цуцлах
        /// үед дутуу үлдсэн (дахин ажиллуулахад дутууг нь нэмнэ).
        /// </summary>
        public int TargetsDone, TargetsFailed, TargetsUnfinished;
        public int ViewsCreated, ViewsReused, ViewsFailed, ViewsDeleted;
        public int SheetsCreated, SheetsReused, Viewports;
        public int InPlaceTargets, InPlaceHidden, StrayViewersHidden;
        public int Tags, TagsExisting, TagsSkipped, RoomTags, Mras, KindFiltered;
        public int Dims, DimsAdapted, DimsExisting, DimsSkipped, DimsValueMismatch;
        public int Spots, SpotsExisting, SpotsSkipped;
        public int Details, DetailsSkipped;
        public int RebarMatched, RebarUnmatched;
        public int WarningsHidden, InvalidRemoved;
        public readonly List<string> NewViews = new List<string>();
        public readonly List<string> NewSheets = new List<string>();
        public readonly List<string> Notes = new List<string>();
        public readonly List<string> Errors = new List<string>();
        public ElementId FirstSheetId, FirstViewId;

        /// <summary>Энэ удаад ямар нэг шинэ зүйл үүссэн үү (дахин ажиллуулалтыг ялгана).</summary>
        public bool AnythingNew => ViewsCreated + SheetsCreated + Viewports + Tags + Dims + Spots + Details > 0;

        public void Note(string s)
        {
            if (!string.IsNullOrEmpty(s) && !Notes.Contains(s) && Notes.Count < 60)
                Notes.Add(s);
        }

        public void Error(string s)
        {
            if (!string.IsNullOrEmpty(s) && !Errors.Contains(s) && Errors.Count < 60)
                Errors.Add(s);
        }

        private readonly HashSet<string> _failedTargets = new HashSet<string>(StringComparer.Ordinal);
        private readonly HashSet<string> _once = new HashSet<string>(StringComparer.Ordinal);
        private readonly List<string> _onceOrder = new List<string>();

        /// <summary>
        /// Тайланд НЭГ л удаа тоолох зүйл (зорилт × харагдац, зорилтын арматур г.м.) — true = анх удаа.  Ctrl+Z-ийн дараа
        /// зорилтыг дахин хийхэд эхний удаад тоологдсоныг дахин тоолохгүй, тоологдоогүйг тоолно.  Алхам буцвал буцна.
        /// </summary>
        public bool Once(string key)
        {
            if (key == null || !_once.Add(key))
                return false;
            _onceOrder.Add(key);
            return true;
        }

        /// <summary>Зорилтын нэг алхам Revit-д буцаагдсан — зорилтыг «алдаатай» гэж нэг л удаа тоолно.</summary>
        public void TargetError(string targetKey)
        {
            if (targetKey != null && _failedTargets.Add(targetKey))
                TargetsFailed++;
        }

        // ── Алхмын буцаалт ─────────────────────────────────────────────────
        //  1.9.1: алхам бүр өөрийн transaction-тай.  Алхам Revit-д буцаагдвал (commit амжилтгүй, эсвэл
        //  алдаа) тэр алхамд нэмэгдсэн тоолуурыг ч буцаана — эс бөгөөс тайлан «18 харагдац» гэж худлаа
        //  хэлнэ.  Тэмдэглэл (Notes) хадгалагдана: яагаад бүтэлгүйтснийг тайлбарладаг.

        private static readonly System.Reflection.FieldInfo[] IntFields = typeof(CdReport)
            .GetFields(System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.Public)
            .Where(f => f.FieldType == typeof(int)).ToArray();

        public sealed class Snapshot
        {
            internal int[] Ints;
            internal int NewViews, NewSheets, Errors, Once;
            internal ElementId FirstSheetId, FirstViewId;
        }

        public Snapshot Take()
        {
            var s = new Snapshot { Ints = new int[IntFields.Length], NewViews = NewViews.Count, NewSheets = NewSheets.Count,
                Errors = Errors.Count, Once = _onceOrder.Count, FirstSheetId = FirstSheetId, FirstViewId = FirstViewId };
            for (int i = 0; i < IntFields.Length; i++)
                s.Ints[i] = (int)IntFields[i].GetValue(this);
            return s;
        }

        /// <summary>Алхмын өмнөх тоолуур руу буцаана.  <see cref="TargetsFailed"/>-ийг хөндөхгүй (тэр нь буцаалтыг өөрөө тоолдог).</summary>
        /// <param name="dropErrors">
        /// Алхмын элемент тус бүрийн алдааг ч хасна — алхам ДАХИН (нэг нэгээр) хийгдэх үед: жинхэнэ алдаа нь дахин бичигдэнэ;
        /// эс бөгөөс дараа нь амжилттай орсон элементийн «алдаа» тайланд үлдэнэ.  Дахин хийгдэхгүй алхамд үлдээнэ (шалтгааныг тайлбарладаг).
        /// </param>
        public void Restore(Snapshot s, bool dropErrors = false)
        {
            if (s == null)
                return;
            int failed = TargetsFailed;
            for (int i = 0; i < IntFields.Length; i++)
                IntFields[i].SetValue(this, s.Ints[i]);
            TargetsFailed = failed;
            if (NewViews.Count > s.NewViews)
                NewViews.RemoveRange(s.NewViews, NewViews.Count - s.NewViews);
            if (NewSheets.Count > s.NewSheets)
                NewSheets.RemoveRange(s.NewSheets, NewSheets.Count - s.NewSheets);
            if (dropErrors && Errors.Count > s.Errors)
                Errors.RemoveRange(s.Errors, Errors.Count - s.Errors);
            while (_onceOrder.Count > s.Once)
            {
                _once.Remove(_onceOrder[_onceOrder.Count - 1]);
                _onceOrder.RemoveAt(_onceOrder.Count - 1);
            }
            FirstSheetId = s.FirstSheetId;
            FirstViewId = s.FirstViewId;
        }

        private readonly Dictionary<string, List<string>> _byText = new Dictionary<string, List<string>>();

        /// <summary>Ижил шалтгааныг нэг мөрөнд нэгтгэж зорилтуудыг жагсаана: «… — B2, B3, B7».</summary>
        public void NoteFor(string text, string targetLabel)
        {
            if (!_byText.TryGetValue(text, out List<string> list))
            {
                _byText[text] = list = new List<string>();
                Note(text);
            }
            if (!list.Contains(targetLabel))
                list.Add(targetLabel);
        }

        private string Render(string note)
        {
            if (!_byText.TryGetValue(note, out List<string> list) || list.Count == 0)
                return note;
            string who = string.Join(", ", list.Take(8)) + (list.Count > 8 ? " … +" + (list.Count - 8) : "");
            return note + " — " + who;
        }

        public IEnumerable<string> RenderedNotes => Notes.Select(Render);

        /// <param name="background">
        /// Арын горим (1.9.1): алхам бүр тусдаа transaction тул «нэг Ctrl+Z» биш — самбарын «Бүгдийг буцаах».
        /// </param>
        public string Summary(bool background = false)
        {
            var sb = new StringBuilder();
            sb.AppendLine(TargetsDone + " элементэд зураг хувилав"
                + (TargetsFailed > 0 ? "   (" + TargetsFailed + " элементийн зарим алхам бүтэлгүйтсэн — АЛДАА хэсгийг үз)" : "")
                + (TargetsUnfinished > 0 ? "   (" + TargetsUnfinished + " элемент дутуу — цуцалсан)" : "") + ".");
            if (TargetsDone > 0 && !AnythingNew)
                sb.AppendLine("Шинээр нэмэх зүйл алга — бүгд өмнө нь хувилагдсан байна.");
            sb.AppendLine();
            sb.AppendLine("ХАРАГДАЦ, ХУУДАС");
            sb.AppendLine("• Шинэ харагдац: " + ViewsCreated
                + (ViewsReused > 0 ? "   (өмнө хувилсныг ашигласан " + ViewsReused + ")" : "")
                + (ViewsFailed > 0 ? "   (үүсгэж чадаагүй " + ViewsFailed + ")" : "")
                + (ViewsDeleted > 0 ? "   (дахин үүсгэхээр устгасан " + ViewsDeleted + ")" : ""));
            foreach (string v in NewViews.Take(6))
                sb.AppendLine("     – " + v);
            if (NewViews.Count > 6)
                sb.AppendLine("     … +" + (NewViews.Count - 6));
            if (SheetsCreated + SheetsReused > 0)
            {
                sb.AppendLine("• Шинэ хуудас: " + SheetsCreated + (SheetsReused > 0 ? "   (өмнөхийг ашигласан " + SheetsReused + ")" : "")
                    + "   · байрлуулсан харагдац " + Viewports);
                foreach (string s in NewSheets.Take(6))
                    sb.AppendLine("     – " + s);
                if (NewSheets.Count > 6)
                    sb.AppendLine("     … +" + (NewSheets.Count - 6));
            }
            if (InPlaceTargets + InPlaceHidden > 0)
                sb.AppendLine("• Ерөнхий харагдацад нэмсэн: " + InPlaceTargets
                    + (InPlaceHidden > 0 ? "   (зорилт тэнд харагдахгүй тул алгассан " + InPlaceHidden + ")" : ""));
            if (StrayViewersHidden > 0)
                sb.AppendLine("• Клон харагдацад хол байрлах бусад зүсэлтийн тэмдэг нуусан: " + StrayViewersHidden
                    + "   (эх зурагт байгаагүй; хуудсан дээрх байрлалыг эвдэхгүйн тулд)");
            sb.AppendLine();
            sb.AppendLine("ТЭМДЭГЛЭГЭЭ");
            sb.AppendLine("• Tag: " + Tags + Tail(TagsExisting, TagsSkipped));
            if (RoomTags + Mras > 0)
                sb.AppendLine("   ↳ үүнээс өрөөний tag " + RoomTags + ", арматурын MRA " + Mras);
            if (KindFiltered > 0)
                sb.AppendLine("   ↳ сонгоогүй төрлийн элементийн tag/хэмжээс (хувилаагүй): " + KindFiltered);
            sb.AppendLine("• Хэмжээс: " + Dims + Tail(DimsExisting, DimsSkipped)
                + (DimsAdapted > 0 ? "   — үүнээс хэмжээ нь зорилтод тохирсон " + DimsAdapted : ""));
            if (DimsValueMismatch > 0)
                sb.AppendLine("   ↳ " + DimsValueMismatch + " хэмжээс утга нь загвараас зөрсөн тул үүсгээгүй");
            if (Spots + SpotsExisting + SpotsSkipped > 0)
                sb.AppendLine("• Түвшний тэмдэг: " + Spots + Tail(SpotsExisting, SpotsSkipped));
            sb.AppendLine("• 2D (текст, зураас, штрих, detail): " + Details + (DetailsSkipped > 0 ? "   (алгассан " + DetailsSkipped + ")" : ""));
            if (RebarMatched + RebarUnmatched > 0)
                sb.AppendLine("• Арматур тулгасан: " + RebarMatched + (RebarUnmatched > 0 ? "   (тохирох нь олдоогүй " + RebarUnmatched + ")" : ""));
            if (Notes.Count > 0)
            {
                sb.AppendLine().AppendLine("АНХААР");
                foreach (string n in RenderedNotes.Take(10))
                    sb.AppendLine("• " + n);
                if (Notes.Count > 10)
                    sb.AppendLine("• … +" + (Notes.Count - 10));
            }
            if (WarningsHidden + InvalidRemoved > 0)
                sb.AppendLine().AppendLine("Revit-ийн анхааруулга нуусан: " + WarningsHidden
                    + (InvalidRemoved > 0 ? "   · буруу болсон тэмдэглэгээ устгасан: " + InvalidRemoved : ""));
            if (Errors.Count > 0)
            {
                sb.AppendLine().AppendLine("АЛДАА");
                foreach (string e in Errors.Take(10))
                    sb.AppendLine("• " + e);
                if (Errors.Count > 10)
                    sb.AppendLine("• … +" + (Errors.Count - 10));
            }
            sb.AppendLine().Append(background
                ? "Буцаах бол самбарын «Бүгдийг буцаах» товч — энэ хувилалтоор үүссэн бүхнийг нэг дор устгана."
                : "Бүгдийг нэг Ctrl+Z-ээр буцаана.");
            return sb.ToString();
        }

        private static string Tail(int existing, int skipped)
        {
            var parts = new List<string>();
            if (existing > 0) parts.Add("байсан " + existing);
            if (skipped > 0) parts.Add("алгассан " + skipped);
            return parts.Count == 0 ? string.Empty : "   (" + string.Join(", ", parts) + ")";
        }
    }

    /// <summary>
    /// Хувиргалтад гарах анхааруулгыг диалог болгохгүйгээр ТООЛЖ нууна, буруу болсон
    /// тэмдэглэгээг (хэмжээсийн холбоос тасарсан г.м.) Revit-ийн санал болгосон
    /// «устгах» шийдлээр арилгана — эс бөгөөс нэг муу хэмжээс бүх зорилтыг буцаана.
    /// </summary>
    internal sealed class CdFailureHandler : IFailuresPreprocessor
    {
        /// <summary>«Устгах» шийдлээр дахин commit хийх дээд оролдлого — шийдэл нь алдааг арилгахгүй бол гогцоонд орохгүй.</summary>
        private const int MaxResolveRounds = 5;

        private readonly CdReport _rep;
        private readonly bool _silentRollback;
        private int _rounds;

        /// <summary>Шийдэж чадаагүй алдааны Revit-ийн тайлбар (чимээгүй буцаасан үед).</summary>
        public string RolledBackReason { get; private set; }

        /// <param name="silentRollback">
        /// 1.9.1: шийдэгдэхгүй алдаа гарвал Revit-ийн алдааны цонхыг ГАРГАХГҮЙ — тэр алхмыг чимээгүй буцааж,
        /// шалтгааныг тайланд бичнэ.  Арын горимд хэрэглэгч өөр ажил хийж байх үед модаль цонх гарч ирэх нь
        /// ажлыг нь тасална (хуучин зан төлөв: Revit-ийн «Error» цонх).
        /// </param>
        public CdFailureHandler(CdReport rep, bool silentRollback = false)
        {
            _rep = rep;
            _silentRollback = silentRollback;
        }

        public FailureProcessingResult PreprocessFailures(FailuresAccessor accessor)
        {
            // Буцааж буй transaction дээр ProceedWithCommit утгагүй (Revit өөрөө ProceedWithRollBack гэж үзнэ) —
            // «Автомат хэмжээс»-ийн туршлагаар буцаалтын үед commit хүсэх нь Revit-ийг унагаж байсан.
            try
            {
                if (!accessor.IsTransactionBeingCommitted())
                    return FailureProcessingResult.Continue;
            }
            catch
            {
                // Хуучин Revit — доорх энгийн замаар.
            }

            _rounds++;
            bool resolved = false;
            string unresolved = null;
            foreach (FailureMessageAccessor f in accessor.GetFailureMessages())
            {
                FailureSeverity sev = f.GetSeverity();
                if (sev == FailureSeverity.Warning)
                {
                    accessor.DeleteWarning(f);
                    _rep.WarningsHidden++;
                    continue;
                }
                if (sev == FailureSeverity.Error && _rounds <= MaxResolveRounds && f.HasResolutionOfType(FailureResolutionType.DeleteElements))
                {
                    f.SetCurrentResolutionType(FailureResolutionType.DeleteElements);
                    accessor.ResolveFailure(f);
                    _rep.InvalidRemoved++;
                    resolved = true;
                    continue;
                }
                if (unresolved == null)
                {
                    try { unresolved = f.GetDescriptionText(); }
                    catch { unresolved = sev.ToString(); }
                    if (string.IsNullOrWhiteSpace(unresolved))
                        unresolved = sev.ToString();
                }
            }

            if (unresolved != null && _silentRollback)
            {
                RolledBackReason = unresolved.Trim();
                try
                {
                    // Баримт: ProceedWithRollBack-аас ӨМНӨ «буцаахдаа алдааг цэвэрлэх»-ийг тавивал хэрэглэгчид юу ч харагдахгүй.
                    FailureHandlingOptions o = accessor.GetFailureHandlingOptions();
                    o.SetClearAfterRollback(true);
                    accessor.SetFailureHandlingOptions(o);
                }
                catch { }
                return FailureProcessingResult.ProceedWithRollBack;
            }
            return resolved ? FailureProcessingResult.ProceedWithCommit : FailureProcessingResult.Continue;
        }
    }
}
