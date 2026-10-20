using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Revit
{
    /// <summary>Бүлгийн (өрөөний) хуудасны нэмэлт блок — энэ ажиллагаанд олдсон/үүссэн харагдац.</summary>
    internal sealed class WeGroupViews
    {
        public WeGroupInfo Info;
        public ElementId KeyPlan = ElementId.InvalidElementId;
        public ElementId Axon = ElementId.InvalidElementId;
    }

    /// <summary>
    /// «Харагдац + хуудас» горим.  Харагдацын хөдөлгүүрээс ТУСДАА transaction — унавал зөвхөн хуудас буцна,
    /// үүсгэсэн харагдацууд хэвээр.
    ///
    /// W02 (2026-10-16, архитекторуудын хүсэлт) — «БҮХ дэлгээс НЭГ хуудсанд»:
    ///   • өрөө (бүлэг) тус бүр НЭГ хуудас; үргэлжлэлийн хуудас ХЭЗЭЭ Ч автоматаар үүсэхгүй, багтахгүй ч гэсэн (<see cref="WeSingleSheet"/>: дөрвөн
    ///     бүс, харагдахуйц шилжүүлсэн овоолго, туслах блок сул зайд эсвэл хуудасны баруун талд).  Масштаб хэвээр (W03 — түлхүүр план / 3D-г
    ///     хуудсанд багтаахаар ХЭЗЭЭ Ч томруулахгүй), ямар ч зураг хаягдахгүй, тайланд «байрлуулж цэгцлэх»;
    ///   • хэрэглэгч бэлэн хуудас сонгож болно (<see cref="WeSettings.TargetSheetNumber"/>) — тэр хуудасны сул зайд;
    ///   • өмнө нь энэ хэрэгслийн үүсгэсэн хуудсыг (Extensible Storage) дахин ашиглана — хэрэглэгчийн зөөсөн viewport, гарчиг, масштаб, рендерийн
    ///     байрыг ХӨДӨЛГӨХГҮЙ, ЗӨВХӨН шинэ блокийг сул зайд (эсвэл хуудасны баруун талд).  Давхцал / хүрээнээс гарсныг «засах» гэж бусад хуудас руу
    ///     тараахгүй.  Хэрэглэгч өөр хуудас руу зөөсөн харагдац тэндээ үлдэнэ (аль ч хуудсан дээрх viewport-ыг дахин байрлуулахгүй);
    ///   • «Дахин байрлуулах» (<see cref="WeSettings.ResetPlacement"/>, хэрэглэгч ил сонгоход л) — энэ хэрэгслийн хуудсан дээрх ӨӨРИЙН viewport-уудыг
    ///     шинэ хуудасны дүрмээр дахин зохиомжилно;
    ///   • дугаар = загвараар, давхардвал «-2» залгавар (бусдын хуудсыг хэзээ ч эзэмшихгүй);
    ///   • viewport-ийн «Detail Number» = дэлгээсийн тэмдэг («205A»), түлхүүр план «205A-F», 3D «3D».
    /// Өмнөх хувилбаруудын (2026-10-15 хүртэл) үргэлжлэлийн хуудсууд («-2», «(2)») хэвээр үлдэнэ — чимээгүй нэгтгэхгүй.
    /// </summary>
    internal sealed class WeSheetService
    {
        private readonly Document _doc;
        private readonly WeResources _res;
        private readonly WeSettings _s;
        private readonly IWeUnits _units;
        private WePlan _plan;
        private readonly Dictionary<long, List<ElementId>> _sheetDrawn = new Dictionary<long, List<ElementId>>();
        /// <summary>
        /// Хуудас тус бүрийн ЭЗЛЭГДСЭН detail number.  ⚠️ ХЭМЖСЭН (Revit 2027): давхардсан дугаарыг Set() шууд хүлээж аваад COMMIT-ийн үед
        /// «Detail Number is already in use» алдаа өгч ХУУДСЫН БҮХ transaction-ыг буцаасан (өрөө «3»-ын D тал = «3D» = 3D зураг).
        /// Тиймээс давхцлыг урьдчилан шалгана.
        /// </summary>
        private readonly Dictionary<long, HashSet<string>> _detailUsed = new Dictionary<long, HashSet<string>>();

        public WeSheetService(Document doc, WeResources res, WeSettings s, IWeUnits units)
        {
            _doc = doc; _res = res; _s = s; _units = units;
        }

        // ── Хугацааны задаргаа (лог) — хуудасны алхам бодит загварт хамгийн удаан (GATEWAY 310: 18 с) ──
        private readonly System.Diagnostics.Stopwatch _lap = new System.Diagnostics.Stopwatch();
        private readonly List<string> _laps = new List<string>();
        private long _regenMs;
        private int _regens;

        private void Lap(string name)
        {
            _laps.Add(name + " " + _lap.ElapsedMilliseconds);
            _lap.Restart();
        }

        /// <summary>Хуудсанд <c>Regenerate</c> = viewport-уудын харагдацын агуулгыг тооцоолох — бодит загварт хамгийн үнэтэй алхам.</summary>
        private void Regen()
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            Document d = _doc;
            d.Regenerate();
            _regenMs += sw.ElapsedMilliseconds;
            _regens++;
        }

        /// <summary>Сүүлийн <see cref="Place"/>-ийн задаргаа: «хүрээ 900 · хуудас 40 · … · regenerate 6× 9000 мс».</summary>
        public string TimingSummary => string.Join(" · ", _laps) + " · regenerate " + _regens + "× " + _regenMs + " мс";

        /// <summary>Нэг блок (viewport эсвэл перспективын байр).</summary>
        private sealed class Block
        {
            public string Kind;
            public WeRunItem Item;
            public ElementId ViewId = ElementId.InvalidElementId;
            public Viewport Vp;
            public string DetailNumber;
            public int PlaceholderNo;
            /// <summary>Хуудсан дээр аль хэдийн байсан viewport («Дахин байрлуулах») — үүсгэхгүй, зөвхөн хэмжинэ.</summary>
            public bool Existing;
            /// <summary>
            /// ХЭМЖСЭН хэмжээ (хуудасны нэгж): хүрээний өргөн/өндөр, гарчгийн тэгш өнцөгт хүрээний ТӨВӨӨС.  ⚠️ ХЭМЖСЭН (Revit 2027, GATEWAY
            /// 2026-10-07): <c>GetBoxOutline</c> анх удаа ≈ 120 мс (харагдацыг тооцно) ба regenerate/commit бүрийн ДАРАА ДАХИН ≈ 120 мс; зөөх,
            /// гарчиг зөөхөд хэмжээ өөрчлөгдөхгүй, гарчгийн outline regenerate-гүйгээр шинэчлэгдэнэ (2 мс).  Тиймээс viewport үүсгэсэн алхамдаа
            /// НЭГ удаа уншиж хадгална — зохиомж ямар ч уншилтгүй.  Хуучин зам 29 уншилт = 3 с байв.
            /// </summary>
            public bool Measured;
            public double W, H, LMinX, LMinY, LMaxX, LMaxY;
            public bool HasLabel;
            public XYZ LabelOffset;
            /// <summary>Хүрээний (box outline) төв — хуудасны координатаар, хэмжих үед.</summary>
            public double Cx, Cy;
            /// <summary>
            /// Өрөөний давхрын шалны хуудсан дээрх Y − хүрээний төв (NaN = дэлгээс биш / тодорхойгүй).  Мөрийн дэлгээсүүдийг шалаар тэгшлэхэд
            /// (жишээ хуудас 206A-G: «4,00 Давхар 2» бүгд нэг шулуун дээр).
            /// </summary>
            public double LevelRel = double.NaN;
        }

        // ── АЛХАМ АЛХМААР байрлуулалт (2026-10-07) ─────────────────
        // Эзний гомдол: «хуудас үүсгэх дарсны дараа mouse loading болоод Revit-ээ ашиглаж чадахгүй».  Хуудасны НЭГ transaction бодит загварт
        // 15 с үргэлжилсэн (хэмжсэн: title block family нээх 5.4 с, 12 viewport × 360 мс, outline уншилт 3 с).  Одоо алхам бүр богино:
        //   Detail (хэрэгтэй бол) → Frame (EditFamily — дискийн кэштэй) → бүлэг бүрт: хуудас → viewport тус бүр (үүсгэх + хэмжих) →
        //   зохиомж (уншилтгүй).  Синхрон <see cref="Place"/> = ижил алхмууд дараалан.

        private enum SheetPhase { Folders, Detail, Frame, Group, Done }

        /// <summary>Нэг бүлгийн (өрөөний) хуудасны алхмын төлөв.</summary>
        private sealed class GroupRun
        {
            public string Group;
            public ViewSheet First;
            public PageArea Area;
            /// <summary>Зохиомжийн бүх блок (перспективын байр орно).</summary>
            public readonly List<Block> Blocks = new List<Block>();
            /// <summary>Viewport үүсгэх (эсвэл байгааг хэмжих) блок, дараалал.</summary>
            public readonly List<Block> ToPlace = new List<Block>();
            public int Next;
            public bool Composed;
            /// <summary>
            /// Өмнө үүссэн / сонгосон хуудас — бусад блок (хэрэглэгчийн байрлуулалт) хөдлөхгүй, шинэ блок зөвхөн СУЛ ЗАЙД (<see cref="WeSingleSheet.PlaceInFree"/>).
            /// false = шинэ хуудас эсвэл «Дахин байрлуулах» — бүтэн зохиомж (<see cref="WeSingleSheet.Compose"/>).
            /// </summary>
            public bool FreeOnly;
            /// <summary>Хуудсан дээр эзлэгдсэн тэгш өнцөгт (завсартай) — <see cref="FreeOnly"/> үед.</summary>
            public readonly List<double[]> Occupied = new List<double[]>();
        }

        private SheetPhase _sp = SheetPhase.Done;
        private WeRunResult _result;
        private List<WeRunItem> _items, _todo;
        private Dictionary<string, WeGroupViews> _extras;
        private Dictionary<string, List<Block>> _extraTodo;
        private Dictionary<string, ViewSheet> _ourSheets;
        private Dictionary<long, Viewport> _vpOfView;
        private List<string> _groups;
        private int _gi;
        private GroupRun _cur;
        private FamilySymbol _tb;
        private List<View> _legends = new List<View>();
        private double _margin, _band, _gap;
        private bool _needDetail;
        private bool _changed;
        /// <summary>Хэрэглэгчийн сонгосон БЭЛЭН хуудас (<see cref="WeSettings.TargetSheetNumber"/>); null = өрөө тус бүр шинэ / өмнөх хуудас.</summary>
        private ViewSheet _target;
        /// <summary>Ажлын зургийн бүрдэл: цонхонд бүлгийг ӨӨРЧИЛСӨН үед энэ удаагийн өрөөний өмнөх хуудас (шилжүүлнэ).</summary>
        private List<ViewSheet> _folderMoves = new List<ViewSheet>();
        /// <summary>Шинэ хуудасны бүлгийг (эхнийх дээр) Project Browser-ээс шалгасан эсэх.</summary>
        private bool _folderChecked;
        private readonly HashSet<string> _folderFailed = new HashSet<string>(StringComparer.Ordinal);

        /// <summary>Дараагийн/одоогийн алхам («310A-H · viewport 310C») — самбарт.</summary>
        public string StepLabel { get; private set; }
        public bool Finished { get { return _sp == SheetPhase.Done; } }
        /// <summary>
        /// W01: нэг өрөөний хуудасны алхмуудын ДУНД (viewport-ууд тавигдсан, зохиомж хүлээгдэж байна) — энэ үед дахин төлөвлөвөл тэр хуудасны
        /// зохиомж алгасагдана.  Хуудасны алхам бодит харагдацаар ажилладаг тул бүлгийг дуусгаад дараа нь дахин төлөвлөнө.
        /// </summary>
        public bool InGroup { get { return _sp == SheetPhase.Group && _cur != null; } }
        /// <summary>Загвар өөрчлөгдсөн.</summary>
        public bool Changed { get { return _changed; } }
        /// <summary>Үлдсэн алхмын ойролцоо тоо (явцын хувьд).</summary>
        public int RemainingSteps
        {
            get
            {
                if (_sp == SheetPhase.Done) return 0;
                int n = (_sp == SheetPhase.Folders ? 1 : 0) + (_sp <= SheetPhase.Detail && _needDetail ? 1 : 0) + (_sp <= SheetPhase.Frame ? 1 : 0);
                int left = _groups == null ? 0 : _groups.Count - _gi;
                n += left * 4;
                if (_cur != null) n += (_cur.ToPlace.Count - _cur.Next) + (_cur.Composed ? 0 : 1);
                return n;
            }
        }

        /// <summary>Синхрон: бүх алхмыг дараалан (дуудагч TransactionGroup эзэмшинэ).  true = загвар өөрчлөгдсөн.</summary>
        public bool Place(List<WeRunItem> items, WeRunResult result, WePlan plan, Dictionary<string, WeGroupViews> extras)
        {
            if (!Begin(items, result, plan, extras)) return false;
            while (!Finished) Step();
            return _changed;
        }

        /// <summary>
        /// Бэлтгэл (уншина, transaction-гүй): аль хэдийн хуудсан дээрх харагдац, бүлгүүд, өмнөх хуудас.  false = хийх зүйл алга.
        /// </summary>
        public bool Begin(List<WeRunItem> items, WeRunResult result, WePlan plan, Dictionary<string, WeGroupViews> extras)
        {
            _plan = plan ?? new WePlan();
            _result = result;
            _items = items;
            _extras = extras ?? new Dictionary<string, WeGroupViews>();
            _laps.Clear(); _regenMs = 0; _regens = 0; _lap.Restart();
            _sp = SheetPhase.Done;
            _changed = false;
            _cur = null;
            _gi = 0;
            _tb = _res.ResolveTitleBlock(_s);
            // Хэрэглэгчийн сонгосон бэлэн хуудас (W02 «deliberate existing target sheet»).
            _target = null;
            if (!string.IsNullOrWhiteSpace(_s.TargetSheetNumber))
            {
                string want = _s.TargetSheetNumber.Trim();
                _target = new FilteredElementCollector(_doc).OfClass(typeof(ViewSheet)).Cast<ViewSheet>()
                    .FirstOrDefault(sh => !sh.IsPlaceholder && string.Equals(sh.SheetNumber, want, StringComparison.OrdinalIgnoreCase));
                if (_target == null) result.Notes.Add("Сонгосон хуудас «" + want + "» олдсонгүй — өрөө тус бүрд шинэ хуудас үүсгэнэ.");
            }
            if (_tb == null && _target == null)
            {
                result.Notes.Add("Загварт хүрээний хуудас (title block) алга — хуудас үүсгэсэнгүй.");
                return false;
            }

            // Аль хэдийн хуудсан дээр байгаа харагдац — НЭГ collector.  Хэрэглэгч ӨӨР хуудас руу зөөсөн ч энд орно — дахин байрлуулахгүй.
            var onSheet = new HashSet<long>();
            _vpOfView = new Dictionary<long, Viewport>();
            foreach (Viewport vp in new FilteredElementCollector(_doc).OfClass(typeof(Viewport)).Cast<Viewport>())
            {
                onSheet.Add(vp.ViewId.Value);
                _vpOfView[vp.ViewId.Value] = vp;
            }
            Viewport known;
            _needDetail = items.Any(i => !string.IsNullOrWhiteSpace(i.Plan.Label) && _vpOfView.TryGetValue(i.ViewId.Value, out known)
                                         && !string.Equals(DetailOf(known), i.Plan.Label, StringComparison.Ordinal));
            _todo = items.Where(i => !onSheet.Contains(i.ViewId.Value)).ToList();
            _extraTodo = new Dictionary<string, List<Block>>(StringComparer.Ordinal);
            foreach (KeyValuePair<string, WeGroupViews> kv in _extras)
            {
                var list = new List<Block>();
                if (kv.Value.KeyPlan != ElementId.InvalidElementId && !onSheet.Contains(kv.Value.KeyPlan.Value))
                    list.Add(new Block { Kind = WeComposeKind.KeyPlan, ViewId = kv.Value.KeyPlan, DetailNumber = KeyDetail(kv.Value.Info) });
                if (kv.Value.Axon != ElementId.InvalidElementId && !onSheet.Contains(kv.Value.Axon.Value))
                    list.Add(new Block { Kind = WeComposeKind.Axon, ViewId = kv.Value.Axon, DetailNumber = "3D" });
                if (list.Count > 0) _extraTodo[kv.Key] = list;
            }
            // Өмнө үүсгэсэн хуудас (түлхүүрээр).
            _ourSheets = new Dictionary<string, ViewSheet>(StringComparer.Ordinal);
            foreach (KeyValuePair<View, WeRecord> kv in _res.Generated)
            {
                var sh = kv.Key.IsValidObject ? kv.Key as ViewSheet : null;
                if (sh != null && kv.Value.Kind == GeneratedElevationRepository.KindSheet && !_ourSheets.ContainsKey(kv.Value.Key))
                    _ourSheets[kv.Value.Key] = sh;
            }
            // Бүлгийн дараалал = төлөвлөгөөний дараалал.  «Дахин байрлуулах» — шинэ блокгүй ч өмнөх хуудастай өрөө.
            var order = new List<string>();
            foreach (WePlannedElevation p in _plan.Items) if (!order.Contains(p.GroupKey)) order.Add(p.GroupKey);
            Func<string, bool> reset = g => _s.ResetPlacement && _target == null && _ourSheets.ContainsKey(SheetKey(g, 0));
            _groups = order.Where(g => _todo.Any(i => i.Plan.GroupKey == g) || _extraTodo.ContainsKey(g) || reset(g)).ToList();
            foreach (string g in _todo.Select(i => i.Plan.GroupKey).Concat(_extraTodo.Keys)) if (!_groups.Contains(g)) _groups.Add(g);
            _folderMoves = FolderMoves(items);
            _folderChecked = false;
            _folderFailed.Clear();
            if (_groups.Count == 0)
            {
                result.Notes.Add("Бүх дэлгээс аль хэдийн хуудсан дээр байна (хэрэглэгчийн зөөсөн хуудсанд ч) — дахин байрлуулсангүй.");
                // Хэрэглэгчид харуулах хуудас: дэлгээс аль хэдийн байрласан хуудас.
                foreach (WeRunItem i in items)
                {
                    Viewport vp0;
                    if (_vpOfView.TryGetValue(i.ViewId.Value, out vp0) && vp0.IsValidObject && !result.Sheets.Contains(vp0.SheetId)) result.Sheets.Add(vp0.SheetId);
                }
                if (!_needDetail && _folderMoves.Count == 0) return false;
            }
            _margin = _units.MmToInternal(_s.SheetMarginMm);
            _band = _units.MmToInternal(_s.SheetBottomBandMm);
            // 2026-10-08: 10 → 4 мм — жишиг хуудсанд дэлгээсийн хүрээнүүд (тэмдэглэгээний хамт) хоорондоо 0–5 мм, заримдаа давхцдаг.
            _gap = _units.MmToInternal(4);
            var missingLegends = new List<string>();
            _legends = _res.ResolveLegends(_s, missingLegends);
            foreach (string m in missingLegends) result.Notes.Add("Сонгосон legend «" + m + "» олдсонгүй — байрлуулсангүй.");
            _sp = _folderMoves.Count > 0 ? SheetPhase.Folders : _needDetail ? SheetPhase.Detail : SheetPhase.Frame;
            StepLabel = _sp == SheetPhase.Folders ? "хуудасны бүлэг" : _needDetail ? "viewport-ийн дугаар" : "хүрээний хуудас";
            Lap("бэлтгэл");
            return true;
        }

        /// <summary>Нэг богино алхам (нэг transaction эсвэл family унших).  Хэзээ ч шидэхгүй — алдаа тэмдэглэлд.</summary>
        public void Step()
        {
            try
            {
                switch (_sp)
                {
                    case SheetPhase.Folders:
                        StepLabel = "хуудасны бүлэг";
                        InTx("Ханын дэлгээс — хуудасны бүлэг", MoveFolders);
                        _sp = _needDetail ? SheetPhase.Detail : _groups.Count > 0 ? SheetPhase.Frame : SheetPhase.Done;
                        if (_sp == SheetPhase.Done) Finish();
                        return;
                    case SheetPhase.Detail:
                        StepLabel = "viewport-ийн дугаар";
                        InTx("Ханын дэлгээс — viewport дугаар", () => RefreshDetailNumbers(_items, _vpOfView, _result));
                        _sp = _groups.Count > 0 ? SheetPhase.Frame : SheetPhase.Done;
                        if (_sp == SheetPhase.Done) Finish();
                        return;
                    case SheetPhase.Frame:
                        StepLabel = "хүрээний хуудас";
                        // Title block-ийн зурвас (transaction-аас ГАДУУР — EditFamily; дискийн кэштэй).
                        if (_tb != null) FamilyFrame(_tb);
                        var frameSheets = new HashSet<long>(_ourSheets.Values.Select(x => x.Id.Value));
                        if (_target != null) frameSheets.Add(_target.Id.Value);
                        if (frameSheets.Count > 0)
                            foreach (FamilyInstance fi in new FilteredElementCollector(_doc).OfCategory(BuiltInCategory.OST_TitleBlocks)
                                                              .WhereElementIsNotElementType().OfType<FamilyInstance>())
                                if (frameSheets.Contains(fi.OwnerViewId.Value)) FamilyFrame(fi.Symbol);
                        Lap("хүрээ");
                        _sp = SheetPhase.Group;
                        return;
                    case SheetPhase.Group:
                        StepGroup();
                        return;
                }
            }
            catch (Exception ex)
            {
                // Алхмын ГАДУУРХ гэнэтийн алдаа — энэ бүлгийг орхиж үргэлжилнэ.
                WeLog.Error("sheets", "алхам «" + StepLabel + "»", ex);
                _result.Notes.Add("Хуудас (" + StepLabel + "): " + ex.Message);
                _cur = null;
                if (_sp != SheetPhase.Group) { _sp = SheetPhase.Group; }
            }
        }

        private void StepGroup()
        {
            if (_cur == null)
            {
                if (_gi >= _groups.Count) { Finish(); return; }
                string g = _groups[_gi++];
                StepLabel = GroupLabel(g) + " · хуудас";
                GroupRun run = null;
                if (!InTx("Ханын дэлгээс — хуудас " + GroupLabel(g), () => run = BeginGroup(g))) run = null;
                _cur = run;   // null = бүлгийг алгассан
                return;
            }
            GroupRun r = _cur;
            if (r.Next < r.ToPlace.Count)
            {
                Block b = r.ToPlace[r.Next++];
                StepLabel = GroupLabel(r.Group) + " · viewport " + (b.DetailNumber ?? b.Kind);
                if (!InTx("Ханын дэлгээс — viewport " + (b.DetailNumber ?? b.Kind), () => PlaceBlock(r, b)))
                {
                    if (!b.Existing) b.Vp = null;
                    b.Measured = false;
                }
                return;
            }
            if (!r.Composed)
            {
                r.Composed = true;
                StepLabel = GroupLabel(r.Group) + " · зохиомж";
                if (!InTx("Ханын дэлгээс — хуудасны зохиомж " + GroupLabel(r.Group), () => ComposeGroup(r)))
                    _result.Notes.Add(GroupLabel(r.Group) + ": хуудасны зохиомж хийгдсэнгүй — шинэ viewport-ууд хуудасны " + (r.FreeOnly ? "баруун талд" : "голд")
                                      + " үлдсэн; дахин ажиллуулах эсвэл гараар байрлуулна уу.");
                return;
            }
            _cur = null;
            if (_gi >= _groups.Count) Finish();
        }

        private void Finish()
        {
            _sp = SheetPhase.Done;
            _cur = null;
            StepLabel = null;
            Lap("байрлуулалт");
            WeLog.Info("sheets", TimingSummary);
        }

        /// <summary>
        /// Алхмын transaction.  Revit буцаавал/алдаа гарвал тоолуур, хуудасны жагсаалтыг алхмын өмнөх төлөвт буцааж тэмдэглэнэ.  true = commit.
        /// </summary>
        private bool InTx(string name, Action body)
        {
            int sheets = _result.SheetsCreated, vps = _result.ViewportsPlaced, extras = _result.ExtrasPlaced, listed = _result.Sheets.Count;
            bool changed = _changed;
            bool ok = false;
            using (var t = new Transaction(_doc, name))
            {
                WeFailureSwallower sw = WeFailureSwallower.Attach(t);
                t.Start();
                try
                {
                    body();
                    TransactionStatus ts = t.Commit();
                    ok = ts == TransactionStatus.Committed;
                    if (!ok) _result.Notes.Add(name + ": Revit буцаав — " + (sw.LastError ?? ts.ToString()));
                }
                catch (Exception ex)
                {
                    try { if (t.HasStarted() && !t.HasEnded()) t.RollBack(); } catch { }
                    WeLog.Error("sheets", name, ex);
                    _result.Notes.Add(name + ": " + ex.Message);
                }
                _result.WarningsHidden += sw.WarningsHidden;
            }
            if (!ok)
            {
                _result.SheetsCreated = sheets;
                _result.ViewportsPlaced = vps;
                _result.ExtrasPlaced = extras;
                if (_result.Sheets.Count > listed) _result.Sheets.RemoveRange(listed, _result.Sheets.Count - listed);
                _changed = changed;
                _detailUsed.Clear();
            }
            return ok;
        }

        private string GroupLabel(string g)
        {
            WeGroupInfo gi = _plan.Groups.FirstOrDefault(x => x.GroupKey == g);
            if (gi != null && !string.IsNullOrWhiteSpace(gi.Label)) return gi.Label;
            return gi != null && !string.IsNullOrWhiteSpace(gi.GroupLabel) ? gi.GroupLabel : g;
        }

        /// <summary>
        /// Бүлгийн хуудас (шинэ, өмнөх эсвэл хэрэглэгчийн сонгосон), хүрээний талбай, байрлуулах блокууд.  null = алгассан / хийх зүйл алга.
        /// Шинэ хуудас: блок бүрийг дараагийн алхмуудад түр төвд үүсгэж ХЭМЖИНЭ — зохиомж нь хэмжсэн хэмжээгээр.  Өмнөх / сонгосон хуудас: бусад
        /// блок (хэрэглэгчийн байрлуулалт) хөдлөхгүй — эзлэгдсэн хэсгийг ЭНЭ алхамд уншина.
        /// </summary>
        private GroupRun BeginGroup(string g)
        {
            ViewSheet first;
            bool reused = false, target = false;
            if (_target != null && _target.IsValidObject) { first = _target; target = true; }
            else if (_ourSheets.TryGetValue(SheetKey(g, 0), out first) && first != null && first.IsValidObject) reused = true;
            else
            {
                if (_tb == null) { _result.Notes.Add(GroupLabel(g) + ": хүрээний хуудас (title block) алга — хуудас үүсгэсэнгүй."); return null; }
                if (!_tb.IsActive) _tb.Activate();
                first = NewSheet(_tb, Representative(g, _todo), 0);
                _result.SheetsCreated++;
                _changed = true;
            }
            if (reused)
            {
                // Интерьерийн хэрэгсэл: энэ өрөөний ӨМНӨ үүсгэсэн хуудсанд ч тогтмол ангиллыг (зөрсөн бол) бичнэ.  Мөн үсгийн муж өөрчлөгдсөн бол
                // (нэмэлт тал E) хэрэгслийн өгсөн нэрийг шинэчилнэ.
                WePlannedElevation rep = Representative(g, _todo);
                foreach (KeyValuePair<string, ViewSheet> kv in _ourSheets)
                {
                    string kg; int kp;
                    if (!ParseSheetKey(kv.Key, out kg, out kp) || kg != g || !kv.Value.IsValidObject) continue;
                    if (ApplyFixedParams(kv.Value, g)) _changed = true;
                    if (RerangeSheet(kv.Value, rep, kp)) _changed = true;
                }
            }
            if (!_result.Sheets.Contains(first.Id)) _result.Sheets.Add(first.Id);

            // НЭГ regenerate → title block-ийн хэмжээ.  ⚠️ ХЭМЖСЭН: БУСАД (хуучин) хуудасны title block-ийн bbox-ыг асуухад Revit тэр
            // хуудсыг бүхэлд нь дахин тооцдог — зөвхөн ЭНЭ хуудасныхыг уншина.
            Regen();
            PageArea area = AreaOf(first);
            if (area == null)
            {
                _result.Notes.Add("«" + first.SheetNumber + "»: хүрээний хуудасны хэмжээ уншигдсангүй (эсвэл дотор зай / доод зурвас хэт их) — байрлуулсангүй.");
                return null;
            }
            List<WeRunItem> members = _todo.Where(i => i.Plan.GroupKey == g)
                .OrderBy(i => (i.Plan.SideLetter ?? string.Empty).Length).ThenBy(i => i.Plan.SideLetter ?? string.Empty, StringComparer.Ordinal).ToList();
            List<Block> ext;
            _extraTodo.TryGetValue(g, out ext);
            ext = ext ?? new List<Block>();

            var run = new GroupRun { Group = g, First = first, Area = area };
            bool reset = reused && _s.ResetPlacement;
            if (reset)
            {
                // «Дахин байрлуулах»: энэ хуудсан дээрх ӨӨРИЙН viewport-ууд (дэлгээс, түлхүүр план, 3D) — бүтэн зохиомжид (зөвхөн хэмжинэ).
                foreach (Block b in OwnBlocksOn(first)) run.ToPlace.Add(b);
            }
            // Дэлгээсийн тэмдэг эхэлж (түлхүүр план дээрх «205A»-тай ЯГ таарах ёстой), дараа нь түлхүүр план, 3D (давхцвал «-2»).
            run.ToPlace.AddRange(members.Select(m => new Block { Kind = WeComposeKind.Elevation, Item = m, ViewId = m.ViewId, DetailNumber = m.Plan.Label }));
            run.ToPlace.AddRange(ext);
            if (!reused && !target)
                foreach (View lg in _legends) run.ToPlace.Add(new Block { Kind = WeComposeKind.Legend, ViewId = lg.Id });
            run.Blocks.AddRange(run.ToPlace);
            run.FreeOnly = (reused || target) && !reset;
            if (run.FreeOnly)
            {
                if (run.ToPlace.Count == 0) return null;
                CollectOccupied(first, run.Occupied);
                return run;
            }
            // Перспективын байр: шинэ хуудсанд — тохиргооны тоогоор; «Дахин байрлуулах»-д — өмнө зурсан байр (хэрэглэгч рендер тавиагүй бол).
            // W09: рендерийн байрын тоо өрөөний ЗОРИУЛАЛТААР (архитектурын өрөөнд 0).
            int placeholders = reset ? ResetPlaceholders(first) : Math.Max(0, Math.Min(4, GroupSettings(g).Perspectives));
            for (int i = 1; i <= placeholders; i++) run.Blocks.Add(new Block { Kind = WeComposeKind.Placeholder, PlaceholderNo = i });
            if (run.Blocks.Count == 0) return null;
            return run;
        }

        /// <summary>
        /// Нэг viewport-ыг түр байранд үүсгэж (гарчиг дээр — стандарт бол) хэмжинэ.  Шинэ хуудсанд — талбайн голд; өмнөх / сонгосон хуудсанд —
        /// хуудасны баруун талд (хэрэглэгчийн зургийг түр ч дарахгүй).  Байгаа viewport («Дахин байрлуулах») — зөвхөн хэмжинэ.
        /// </summary>
        private void PlaceBlock(GroupRun r, Block b)
        {
            if (b.Existing)
            {
                if (b.Vp != null && b.Vp.IsValidObject) Measure(b, true);
                return;
            }
            if (!Viewport.CanAddViewToSheet(_doc, r.First.Id, b.ViewId))
            {
                if (b.Item != null) b.Item.Message = Append(b.Item.Message, "хуудсан дээр байрлуулах боломжгүй");
                return;
            }
            XYZ c = r.FreeOnly
                ? new XYZ(r.Area.ToSheetArea().SpillX(_gap) + _units.MmToInternal(150), (r.Area.MinY + r.Area.MaxY) / 2, 0)
                : new XYZ((r.Area.MinX + r.Area.MaxX) / 2, (r.Area.MinY + r.Area.MaxY) / 2, 0);
            b.Vp = CreateViewport(r.First.Id, b.ViewId, c, b.DetailNumber);
            if (b.Item != null) _result.ViewportsPlaced++;
            else _result.ExtrasPlaced++;
            _changed = true;
            Measure(b);
        }

        // ── Title block-ийн зурах талбай ─────────────────────────────
        // ХЭМЖСЭН (Revit 2027): title block-ийн FamilyInstance.get_Geometry(...) нь ямар ч Options-оор NULL буцаадаг — шугамыг
        // FAMILY баримтаас (EditFamily, хуудасны төрлийг тохируулж) уншина.  EditFamily нь нээлттэй transaction-д ажиллахгүй тул
        // хуудасны transaction-аас ӨМНӨ, family тус бүрд НЭГ удаа.

        private readonly Dictionary<long, double[]> _frameOfSymbol = new Dictionary<long, double[]>();

        /// <summary>Family координатаар {зурах minX, minY, maxX, maxY, шугамын хүрээ minX, minY, maxX, maxY}; null = уншигдсангүй.</summary>
        private double[] FamilyFrame(FamilySymbol sym)
        {
            double[] r;
            if (sym == null) return null;
            if (_frameOfSymbol.TryGetValue(sym.Id.Value, out r)) return r;
            // ⚠️ ХЭМЖСЭН (GATEWAY): title block family нээх (EditFamily) = 5.4 с — хуудасны алхмын хамгийн удаан хэсэг.  Үр дүнг дискэнд
            // кэшилнэ (family + төрөл + UniqueId); family өөрчлөгдсөн бол <see cref="DrawableArea"/>-ийн 2 %-ийн шалгалт bbox руу буцна.
            string cacheKey = null;
            // «|n4»: зурвасын саадын зүүн талын зай (Notch) нэмэгдсэн.  «|n5» (2026-10-16, W02): доод талын хэсэгчилсэн шугам (баруун доод хүснэгтийн
            // дээд шугам) бүтэн өргөний хил биш, саад — хуучин кэшийг дахин хэмжинэ.
            try { cacheKey = sym.FamilyName + "|" + sym.Name + "|" + (sym.Family != null ? sym.Family.UniqueId : string.Empty) + "|n5"; } catch { }
            if (cacheKey != null && WeFrameCache.TryGet(cacheKey, out r))
            {
                _frameOfSymbol[sym.Id.Value] = r;
                return r;
            }
            r = null;
            Document fam = null;
            try
            {
                if (!_doc.IsModifiable && sym.Family != null && sym.Family.IsEditable)
                {
                    fam = _doc.EditFamily(sym.Family);
                    var segs = new List<double[]>();
                    var obstacles = new List<double[]>();
                    using (var t = new Transaction(fam, "MGL — title block"))
                    {
                        t.Start();
                        FamilyManager fm = fam.FamilyManager;
                        FamilyType ft = fm.Types.Cast<FamilyType>().FirstOrDefault(x => x.Name == sym.Name);
                        if (ft != null && (fm.CurrentType == null || fm.CurrentType.Name != sym.Name)) fm.CurrentType = ft;
                        fam.Regenerate();
                        foreach (CurveElement ce in new FilteredElementCollector(fam).OfClass(typeof(CurveElement)).Cast<CurveElement>())
                        {
                            Parameter vis = ce.get_Parameter(BuiltInParameter.IS_VISIBLE_PARAM);
                            if (vis != null && vis.AsInteger() == 0) continue;
                            var line = ce.GeometryCurve as Line;
                            if (line == null || !line.IsBound) continue;
                            XYZ a = line.GetEndPoint(0), b = line.GetEndPoint(1);
                            segs.Add(new[] { a.X, a.Y, b.X, b.Y });
                        }
                        // Саад: nested family (бичээсийн хүснэгт, лого), текст, бүлэг, дүүргэлт, импорт — шугамаар танигдахгүй зурвас.
                        View fv = new FilteredElementCollector(fam).OfClass(typeof(View)).Cast<View>().FirstOrDefault(x => !x.IsTemplate);
                        foreach (Element e in new FilteredElementCollector(fam).WhereElementIsNotElementType())
                        {
                            if (!(e is FamilyInstance || e is TextElement || e is Group || e is ImportInstance || e is FilledRegion)) continue;
                            Parameter vis = e.get_Parameter(BuiltInParameter.IS_VISIBLE_PARAM);
                            if (vis != null && vis.AsInteger() == 0) continue;
                            BoundingBoxXYZ eb = null;
                            try { eb = fv != null ? e.get_BoundingBox(fv) : null; } catch { }
                            if (eb == null) { try { eb = e.get_BoundingBox(null); } catch { } }
                            if (eb == null) continue;
                            obstacles.Add(new[] { eb.Min.X, eb.Min.Y, eb.Max.X, eb.Max.Y });
                        }
                        t.RollBack();
                    }
                    if (segs.Count >= 4)
                    {
                        double x0 = segs.Min(q => Math.Min(q[0], q[2])), y0 = segs.Min(q => Math.Min(q[1], q[3]));
                        double x1 = segs.Max(q => Math.Max(q[0], q[2])), y1 = segs.Max(q => Math.Max(q[1], q[3]));
                        List<double[]> partial;
                        double[] d = WeSheetFrame.Drawable(segs, x0, y0, x1, y1, out partial);
                        obstacles.AddRange(partial);
                        double[] d2 = WeSheetFrame.AvoidObstacles(d, obstacles, 1.0 / 304.8);
                        double[] notch = WeSheetFrame.Notch(d, d2, obstacles, 1.0 / 304.8);
                        WeLog.Info("sheets", "title block «" + sym.FamilyName + " : " + sym.Name + "»: шугам " + segs.Count + ", саад " + obstacles.Count
                                   + (partial.Count > 0 ? " (хэсэгчилсэн доод шугам " + partial.Count + ")" : string.Empty)
                                   + ", зурах талбай " + Mm(d) + " → " + Mm(d2)
                                   + (notch != null ? ", хүснэгтийн зүүн талд x ≤ " + Math.Round(notch[0] * 304.8) + " мм бол y ≥ " + Math.Round(notch[1] * 304.8) : string.Empty));
                        r = notch != null ? new[] { d2[0], d2[1], d2[2], d2[3], x0, y0, x1, y1, notch[0], notch[1] }
                                          : new[] { d2[0], d2[1], d2[2], d2[3], x0, y0, x1, y1 };
                    }
                }
            }
            catch (Exception ex) { WeLog.Error("sheet", "title block frame", ex); r = null; }
            finally { if (fam != null) { try { fam.Close(false); } catch { } } }
            _frameOfSymbol[sym.Id.Value] = r;
            if (r != null && cacheKey != null) WeFrameCache.Put(cacheKey, r);
            return r;
        }

        private static string Mm(double[] r)
        {
            return string.Join(",", r.Take(4).Select(x => Math.Round(x * 304.8).ToString(CultureInfo.InvariantCulture)));
        }

        /// <summary>
        /// Хуудсан дээрх title block-ийн зурах талбай {minX, minY, maxX, maxY}: family-ийн хүрээ/зурвасын хил instance-ийн байрлалаар;
        /// family-ийн шугамын хүрээ instance-ийн bbox-той (2 %) таарахгүй бол (параметрт хэмжээ, үл мэдэгдэх элемент) bbox.
        /// </summary>
        private double[] DrawableArea(FamilyInstance fi, BoundingBoxXYZ bb)
        {
            var box = new[] { bb.Min.X, bb.Min.Y, bb.Max.X, bb.Max.Y, double.NaN, double.NaN };
            double[] f;
            if (!_frameOfSymbol.TryGetValue(fi.Symbol.Id.Value, out f) || f == null) return box;
            Transform tf = fi.GetTransform();
            XYZ e0 = tf.OfPoint(new XYZ(f[4], f[5], 0)), e1 = tf.OfPoint(new XYZ(f[6], f[7], 0));
            double ew = Math.Abs(e1.X - e0.X), eh = Math.Abs(e1.Y - e0.Y), bw = box[2] - box[0], bh = box[3] - box[1];
            if (Math.Abs(ew - bw) > bw * 0.02 || Math.Abs(eh - bh) > bh * 0.02) return box;
            XYZ d0 = tf.OfPoint(new XYZ(f[0], f[1], 0)), d1 = tf.OfPoint(new XYZ(f[2], f[3], 0));
            double nx = double.NaN, ny = double.NaN;
            // Хүснэгтийн зүүн талын зай — зөвхөн эргүүлээгүй, толин тусгалгүй title block-д (баруун доод булан баруун доод хэвээр).
            if (f.Length >= 10 && tf.BasisX.IsAlmostEqualTo(XYZ.BasisX) && tf.BasisY.IsAlmostEqualTo(XYZ.BasisY))
            {
                XYZ n = tf.OfPoint(new XYZ(f[8], f[9], 0));
                nx = n.X;
                ny = Math.Max(box[1], n.Y);
            }
            return new[]
            {
                Math.Max(box[0], Math.Min(d0.X, d1.X)), Math.Max(box[1], Math.Min(d0.Y, d1.Y)),
                Math.Min(box[2], Math.Max(d0.X, d1.X)), Math.Min(box[3], Math.Max(d0.Y, d1.Y)), nx, ny,
            };
        }

        private sealed class PageArea
        {
            public double MinX, MinY, MaxX, MaxY;
            /// <summary>Title block-ийн булангийн хүснэгтийн зүүн талд (x ≤ NotchMaxX) зураг NotchMinY хүртэл доош; NaN = байхгүй.</summary>
            public double NotchMaxX = double.NaN, NotchMinY = double.NaN;
            /// <summary>Title block-ийн гадна хүрээ (bbox) — хальсан блокийг үүнээс БАРУУН талд (хүрээний бичээсийг дарахгүй).</summary>
            public double OuterMaxX = double.NaN, OuterMaxY = double.NaN;
            public long Sheet;

            public void SetNotch(double[] t, double margin, double band)
            {
                if (t == null || t.Length < 6 || double.IsNaN(t[4]) || double.IsNaN(t[5])) return;
                NotchMaxX = t[4] - margin;
                NotchMinY = Math.Min(MinY, t[5] + margin + band);
                if (NotchMaxX - MinX <= 0) { NotchMaxX = double.NaN; NotchMinY = double.NaN; }
            }

            public WeSheetArea ToSheetArea()
            {
                return new WeSheetArea
                {
                    MinX = MinX, MinY = MinY, MaxX = MaxX, MaxY = MaxY,
                    NotchMaxX = NotchMaxX, NotchMinY = NotchMinY, OuterMaxX = OuterMaxX, OuterMaxY = OuterMaxY,
                };
            }
        }

        // ── Хуудасны зохиомж (НЭГ хуудас) ───────────────────────────

        /// <summary>
        /// Зохиомж — ХЭМЖСЭН хэмжээгээр (outline уншилтгүй).  Шинэ хуудас / «Дахин байрлуулах»: <see cref="WeSingleSheet.Compose"/> (дөрвөн бүс,
        /// овоолго, туслах блок, перспективын байр).  Өмнөх / сонгосон хуудас: зөвхөн ШИНЭ блокийг сул зайд (<see cref="WeSingleSheet.PlaceInFree"/>) —
        /// бусад хөдлөхгүй.  Үргэлжлэлийн хуудас ХЭЗЭЭ Ч үүсэхгүй, масштаб өөрчлөгдөхгүй (W02/W03).
        /// </summary>
        private void ComposeGroup(GroupRun r)
        {
            WeSheetArea sa = r.Area.ToSheetArea();
            // Дараалал: түлхүүр план, 3D, legend (сонгосон дарааллаар), дэлгээс (тэмдгийн дарааллаар — A→зүүн дээд, B→баруун дээд …), перспективын байр.
            List<Block> blocks = r.Blocks.Where(b => b.Kind == WeComposeKind.Placeholder || (b.Vp != null && b.Vp.IsValidObject && b.Measured))
                .OrderBy(b => KindOrder(b.Kind))
                .ThenBy(b => b.Kind == WeComposeKind.Elevation ? (b.DetailNumber ?? string.Empty).Length : 0)
                .ThenBy(b => b.Kind == WeComposeKind.Elevation ? b.DetailNumber ?? string.Empty : string.Empty, StringComparer.Ordinal)
                .ToList();
            if (blocks.Count == 0) return;
            List<XYZ> offsets;
            List<WeComposeItem> items = ItemsOf(blocks, out offsets);
            List<WeSheetSlot> slots;
            if (r.FreeOnly)
            {
                slots = new List<WeSheetSlot>();
                for (int i = 0; i < blocks.Count; i++)
                    if (blocks[i].Vp != null) slots.Add(WeSingleSheet.PlaceInFree(items[i], i, sa, r.Occupied, _gap));
            }
            else
            {
                slots = WeSingleSheet.Compose(items, sa, _gap, _units.MmToInternal(StackStepMm), _units.MmToInternal(55));
                AlignRowTitles(blocks, slots, offsets);
            }
            Func<double, string> mmS = v => Math.Round(_units.InternalToMeters(v) * 1000).ToString(CultureInfo.InvariantCulture);
            WeLog.Info("sheets", (r.FreeOnly ? "сул зайд нэмэх" : "нэг хуудасны зохиомж") + ": талбай " + mmS(sa.MinX) + "," + mmS(sa.MinY) + "," + mmS(sa.MaxX) + "," + mmS(sa.MaxY) + " · "
                                 + string.Join(" · ", slots.Select(sl => items[sl.Index].Kind + " " + mmS(items[sl.Index].W) + "×" + mmS(items[sl.Index].H)
                                                                         + " → (" + mmS(sl.CenterX) + "," + mmS(sl.CenterY) + ")"
                                                                         + (sl.Stacked ? " овоолго" : string.Empty) + (sl.Spill ? " баруун талд" : string.Empty))));
            foreach (WeSheetSlot sl in slots)
            {
                Block b = blocks[sl.Index];
                if (b.Vp == null)
                {
                    using (WeProf.T("sheet.placeholder")) DrawPlaceholder(r.First, b.PlaceholderNo, sl, items[sl.Index]);
                    continue;
                }
                var want = new XYZ(sl.CenterX + offsets[sl.Index].X, sl.CenterY + offsets[sl.Index].Y, 0);
                if (want.DistanceTo(b.Vp.GetBoxCenter()) > 1e-6)
                    using (WeProf.T("vp.setCenter")) b.Vp.SetBoxCenter(want);
                if (b.Item != null && sl.Stacked) b.Item.Message = Append(b.Item.Message, "хуудсанд овоолж тавьсан — байрлуулж цэгцлэх");
                if (b.Item != null && sl.Spill) b.Item.Message = Append(b.Item.Message, "хуудасны баруун талд (хүрээнээс гадна) — байрлуулж цэгцлэх");
            }
            NoteFit(r, slots, items, sa);
            foreach (KeyValuePair<long, List<ElementId>> kv in _sheetDrawn)
            {
                var sheet = _doc.GetElement(new ElementId(kv.Key)) as View;
                if (sheet != null) WeAnnoStore.Write(_doc, sheet, WeAnnoStore.Previous(_doc, sheet).Concat(kv.Value));
            }
            _sheetDrawn.Clear();
            _changed = true;
        }

        /// <summary>Овоолгын шилжилт (цаас, мм) — гарчиг харагдаж, дарж сонгогдохоор.</summary>
        private const double StackStepMm = 12;

        private static int KindOrder(string kind)
        {
            switch (kind)
            {
                case WeComposeKind.KeyPlan: return 0;
                case WeComposeKind.Axon: return 1;
                case WeComposeKind.Legend: return 2;
                case WeComposeKind.Elevation: return 3;
                default: return 4;
            }
        }

        /// <summary>
        /// Хуудасны дүгнэлт тайланд: овоолго, хальсан, хүрээнээс гарсан, давхцал → «байрлуулж цэгцлэх» (хэвлэхэд бэлэн гэж ХЭЗЭЭ Ч хэлэхгүй).
        /// Хэрэглэгч хуудсан дээр гараар зөөнө, эсвэл өөр хуудас үүсгэж сонгосон зургаа зөөнө — масштаб хэвээр.
        /// </summary>
        private void NoteFit(GroupRun r, List<WeSheetSlot> slots, List<WeComposeItem> items, WeSheetArea sa)
        {
            WeSheetFitReport rep = WeSingleSheet.Assess(slots, items, sa, _units.MmToInternal(0.5));
            if (r.FreeOnly)
            {
                // Хуучин зургуудыг үнэлэхгүй (хэрэглэгчийнх) — зөвхөн шинэ блок хальсан эсэх.
                if (rep.Spilled == 0) return;
                _result.Notes.Add("«" + r.First.SheetNumber + "» (" + GroupLabel(r.Group) + "): шинэ " + rep.Spilled + " зураг хуудасны сул зайд багтаагүй — "
                                  + "хуудасны баруун талд (хүрээнээс гадна) тавив.  Байрлуулж цэгцлэх: хуудсан дээр гараар зөөнө үү (масштаб хэвээр).");
                return;
            }
            if (!rep.NeedsArrangement) return;
            _result.Notes.Add("«" + r.First.SheetNumber + "» (" + GroupLabel(r.Group) + "): байрлуулж цэгцлэх — " + rep.Describe() + ".  Бүх зураг ЭНЭ хуудсанд, "
                              + "масштаб хэвээр; хуудсан дээр гараар зөөх, эсвэл өөр хуудас үүсгээд сонгосон зургаа зөөнө үү.");
        }

        private List<WeComposeItem> ItemsOf(List<Block> blocks, out List<XYZ> offsets)
        {
            var items = new List<WeComposeItem>();
            offsets = new List<XYZ>();
            foreach (Block b in blocks)
            {
                if (b.Vp == null)
                {
                    items.Add(new WeComposeItem(b.Kind, _units.MmToInternal(180), _units.MmToInternal(120)));
                    offsets.Add(XYZ.Zero);
                    continue;
                }
                double x0, y0, x1, y1;
                Full(b, out x0, out y0, out x1, out y1);
                items.Add(ComposeItemOf(b, x0, y0, x1, y1));
                // хүрээний төв − бүтэн outline-ийн төв
                offsets.Add(new XYZ(-(x0 + x1) / 2, -(y0 + y1) / 2, 0));
            }
            return items;
        }

        /// <summary>Зохиомжийн блок: бүтэн хэмжээ + дэлгээс бол шалны шугам (дээд захаас).</summary>
        private static WeComposeItem ComposeItemOf(Block b, double x0, double y0, double x1, double y1)
        {
            var it = new WeComposeItem(b.Kind, x1 - x0, y1 - y0);
            if (b.Kind == WeComposeKind.Elevation && !double.IsNaN(b.LevelRel) && b.LevelRel >= y0 - 1e-9 && b.LevelRel <= y1 + 1e-9)
                it.Base = y1 - b.LevelRel;
            return it;
        }

        /// <summary>
        /// Өрөөний давхрын шал хуудсан дээр (хүрээний төвөөс) — харагдацын model→projection ба viewport-ийн projection→sheet хувиргалтаар
        /// (ХЭМЖСЭН: ≈ 1 мс, regenerate шаардахгүй).  Тодорхойгүй бол NaN (тэгшлэхгүй).
        /// </summary>
        private double LevelRelOf(Block b, double cy)
        {
            if (b.Kind != WeComposeKind.Elevation || b.Vp == null) return double.NaN;
            try
            {
                var v = _doc.GetElement(b.Vp.ViewId) as View;
                if (v == null) return double.NaN;
                WePlannedElevation p = b.Item != null ? b.Item.Plan : null;
                Level l = p != null ? LevelNamed(p.LevelName) : null;
                if (l == null)
                {
                    WeRecord rec = GeneratedElevationRepository.Read(v);
                    var room = rec != null && !string.IsNullOrEmpty(rec.RoomUid) ? _doc.GetElement(rec.RoomUid) as SpatialElement : null;
                    if (room != null) l = _doc.GetElement(room.LevelId) as Level;
                }
                double z = l != null ? WeAnnoSourceReader.LevelZ(l) : p != null && p.Frame != null ? p.Frame.Origin.Z : double.NaN;
                if (double.IsNaN(z)) return double.NaN;
                BoundingBoxXYZ cb = v.CropBox;
                XYZ mid = cb.Transform.OfPoint((cb.Min + cb.Max) * 0.5);
                IList<TransformWithBoundary> m2p = v.GetModelToProjectionTransforms();
                if (m2p == null || m2p.Count != 1) return double.NaN;
                XYZ sp = b.Vp.GetProjectionToSheetTransform().OfPoint(m2p[0].GetModelToProjectionTransform().OfPoint(new XYZ(mid.X, mid.Y, z)));
                return sp.Y - cy;
            }
            catch { return double.NaN; }
        }

        private Dictionary<string, Level> _levelsByName;

        private Level LevelNamed(string name)
        {
            if (string.IsNullOrEmpty(name)) return null;
            if (_levelsByName == null)
            {
                _levelsByName = new Dictionary<string, Level>(StringComparer.Ordinal);
                foreach (Level l in new FilteredElementCollector(_doc).OfClass(typeof(Level)).Cast<Level>())
                    if (!_levelsByName.ContainsKey(l.Name)) _levelsByName[l.Name] = l;
            }
            Level r;
            return _levelsByName.TryGetValue(name, out r) ? r : null;
        }

        // ── Хуудасны түлхүүр, талбай ────────────────────────────────

        private static bool ParseSheetKey(string key, out string group, out int page)
        {
            group = null; page = 0;
            if (string.IsNullOrEmpty(key) || !key.StartsWith("sheet|", StringComparison.Ordinal)) return false;
            int i = key.LastIndexOf("|p", StringComparison.Ordinal);
            if (i <= 6) return false;
            group = key.Substring(6, i - 6);
            return int.TryParse(key.Substring(i + 2), NumberStyles.None, CultureInfo.InvariantCulture, out page);
        }

        /// <summary>Title block-ийн зурах талбай (зай, доод зурвас хассан) + гадна хүрээ — тухайн хуудасных (дуудагч өмнө нь regenerate хийнэ).</summary>
        private PageArea AreaOf(ViewSheet sheet)
        {
            foreach (FamilyInstance fi in new FilteredElementCollector(_doc, sheet.Id).OfCategory(BuiltInCategory.OST_TitleBlocks)
                                              .WhereElementIsNotElementType().OfType<FamilyInstance>())
            {
                BoundingBoxXYZ bb = fi.get_BoundingBox(sheet);
                if (bb == null) continue;
                double[] t = DrawableArea(fi, bb);
                var a = new PageArea { MinX = t[0] + _margin, MinY = t[1] + _margin + _band, MaxX = t[2] - _margin, MaxY = t[3] - _margin, Sheet = sheet.Id.Value,
                                       OuterMaxX = bb.Max.X, OuterMaxY = bb.Max.Y };
                a.SetNotch(t, _margin, _band);
                if (a.MaxX - a.MinX <= 0 || a.MaxY - a.MinY <= 0) return null;
                return a;
            }
            return null;
        }

        /// <summary>
        /// Viewport-ийн хэмжээг НЭГ удаа уншиж хадгална (<see cref="Block.Measured"/>); стандарт бол гарчгийг зургийн ДЭЭР тавина.
        /// Масштаб солигдсоны дараа дахин дуудна (хүрээ өөрчлөгдөнө).
        /// </summary>
        private void Measure(Block b, bool placeLabel = true)
        {
            if (b.Vp == null) return;
            if (placeLabel && _res.Standards.LabelAboveFor(_doc)) PutLabelAbove(b.Vp);
            Outline bo;
            using (WeProf.T("vp.boxOutline")) bo = b.Vp.GetBoxOutline();
            double cx = (bo.MinimumPoint.X + bo.MaximumPoint.X) / 2, cy = (bo.MinimumPoint.Y + bo.MaximumPoint.Y) / 2;
            b.Cx = cx; b.Cy = cy;
            b.W = bo.MaximumPoint.X - bo.MinimumPoint.X;
            b.H = bo.MaximumPoint.Y - bo.MinimumPoint.Y;
            using (WeProf.T("vp.levelLine")) b.LevelRel = LevelRelOf(b, cy);
            b.HasLabel = false;
            try
            {
                Outline l;
                using (WeProf.T("vp.labelOutline")) l = b.Vp.GetLabelOutline();
                if (l != null && !l.IsEmpty)
                {
                    b.HasLabel = true;
                    b.LMinX = l.MinimumPoint.X - cx; b.LMinY = l.MinimumPoint.Y - cy;
                    b.LMaxX = l.MaximumPoint.X - cx; b.LMaxY = l.MaximumPoint.Y - cy;
                }
            }
            catch { /* гарчиггүй viewport */ }
            try { b.LabelOffset = b.Vp.LabelOffset; } catch { b.LabelOffset = null; }
            b.Measured = true;
        }

        /// <summary>Бүтэн outline (хүрээ + гарчиг) хүрээний төвөөс — хэмжсэн утгаар.</summary>
        private static void Full(Block b, out double minX, out double minY, out double maxX, out double maxY)
        {
            minX = -b.W / 2; maxX = b.W / 2; minY = -b.H / 2; maxY = b.H / 2;
            if (!b.HasLabel) return;
            minX = Math.Min(minX, b.LMinX); minY = Math.Min(minY, b.LMinY);
            maxX = Math.Max(maxX, b.LMaxX); maxY = Math.Max(maxY, b.LMaxY);
        }

        /// <summary>
        /// Гарчгийг зургийн ДЭЭР: гарчгийн outline-ийн ЗҮҮН зах = хүрээний зүүн зах, доод зах = хүрээний дээд захаас <see cref="LabelClearMm"/>.
        /// ХЭМЖСЭН (MITIC 202A, 2026-10-08): LabelOffset.X = 0 үед viewport төрлийн дугаар («202A») гарчгийн шугамаас 12 мм ЗҮҮН талд гарч
        /// блокийг 12 мм өргөсгөсөн; доод зай 9 мм нь мөр бүрийг 7 мм өндөрсгөсөн (жишиг ИЗД1_A2_42: гарчиг хүрээнээс ≈ 1 мм дээр).
        /// Гарчгийн outline LabelOffset солиход regenerate-гүй шинэчлэгддэг (хэмжсэн) — нэг дахин уншилт.
        /// </summary>
        private void PutLabelAbove(Viewport vp)
        {
            try
            {
                Outline o;
                using (WeProf.T("vp.boxOutline")) o = vp.GetBoxOutline();
                double h = o.MaximumPoint.Y - o.MinimumPoint.Y;
                var first = new XYZ(0, h + _units.MmToInternal(LabelClearMm) - LabelRise(), 0);
                using (WeProf.T("vp.labelOffsetSet")) vp.LabelOffset = first;
                Outline l;
                using (WeProf.T("vp.labelOutline")) l = vp.GetLabelOutline();
                if (l == null || l.IsEmpty) return;
                _labelRise = l.MinimumPoint.Y - (o.MinimumPoint.Y + first.Y);
                double dx = o.MinimumPoint.X - l.MinimumPoint.X;
                double dy = o.MaximumPoint.Y + _units.MmToInternal(LabelClearMm) - l.MinimumPoint.Y;
                if (Math.Abs(dx) > 1e-6 || Math.Abs(dy) > 1e-6)
                    using (WeProf.T("vp.labelOffsetSet")) vp.LabelOffset = new XYZ(first.X + dx, first.Y + dy, 0);
            }
            catch (Exception ex) { WeLog.Info("sheets", "гарчгийн байрлал — " + ex.Message); }
        }

        /// <summary>Гарчгийн outline-ийн доод зах хүрээний доод захаас (LabelOffset.Y) хэр дээр/доор — viewport-ийн төрлөөс; эхний хэмжилтээс.</summary>
        private double LabelRise() { return _labelRise ?? -_units.MmToInternal(4); }
        private double? _labelRise;

        /// <summary>Гарчиг хүрээний дээд захаас дээш (мм, цаас) — гарчгийн OUTLINE-ийн доод захаас.</summary>
        private const double LabelClearMm = 1.5;

        /// <summary>
        /// Жишээ хуудас 206A-G: нэг мөрийн дэлгээсүүдийн ГАРЧИГ нэг шулуун дээр («206A ХАНЫН ДЭЛГЭЭС 206A», «206B …»).  Зохиомж шалаар тэгшилдэг
        /// тул дээрээ бичвэргүй дэлгээсийн хүрээ доогуур — гарчгийг мөрийн хамгийн өндөр хүрээний дээд захаас <see cref="LabelClearMm"/>-д.
        /// Гарчиг зургийн ДЭЭР байх стандарттай үед л (доор бол хөндөхгүй).  Гарчиг мөрийн дээд хилээс хэтрэхгүй — хамгийн өндөр блокийн
        /// гарчиг аль хэдийн тэр өндөрт.
        /// </summary>
        private void AlignRowTitles(List<Block> blocks, List<WeSheetSlot> slots, List<XYZ> offsets)
        {
            if (!_res.Standards.LabelAboveFor(_doc)) return;
            double gap = _units.MmToInternal(LabelClearMm) - LabelRise();
            foreach (IGrouping<long, WeSheetSlot> row in slots.Where(sl => sl.Row >= 0 && blocks[sl.Index].Vp != null && blocks[sl.Index].HasLabel
                                                                        && blocks[sl.Index].Kind == WeComposeKind.Elevation)
                                                             .GroupBy(sl => (long)sl.Page * 100000 + sl.Row))
            {
                List<WeSheetSlot> list = row.ToList();
                if (list.Count < 2) continue;
                double top = list.Max(sl => sl.CenterY + offsets[sl.Index].Y + blocks[sl.Index].H / 2);
                foreach (WeSheetSlot sl in list)
                {
                    Block b = blocks[sl.Index];
                    double boxMinY = sl.CenterY + offsets[sl.Index].Y - b.H / 2;
                    XYZ cur = b.LabelOffset ?? XYZ.Zero;
                    var lo = new XYZ(cur.X, top - boxMinY + gap, 0);
                    if (b.LabelOffset != null && lo.DistanceTo(b.LabelOffset) < 1e-6) continue;
                    b.LabelOffset = lo;
                    if (sl.Page == 0 && b.Vp.IsValidObject) { try { b.Vp.LabelOffset = lo; } catch (Exception ex) { WeLog.Info("sheets", "гарчиг тэгшлэх — " + ex.Message); } }
                }
            }
        }

        /// <summary>Viewport-ийн бүтэн outline: хүрээ + гарчиг (гарчиг доор нь гарч хөршийг дарахгүй).</summary>
        private static Outline FullOutline(Viewport vp)
        {
            Outline o;
            using (WeProf.T("vp.boxOutline")) o = vp.GetBoxOutline();
            try
            {
                Outline l;
                using (WeProf.T("vp.labelOutline")) l = vp.GetLabelOutline();
                if (l != null && !l.IsEmpty)
                    o = new Outline(new XYZ(Math.Min(o.MinimumPoint.X, l.MinimumPoint.X), Math.Min(o.MinimumPoint.Y, l.MinimumPoint.Y), 0),
                                    new XYZ(Math.Max(o.MaximumPoint.X, l.MaximumPoint.X), Math.Max(o.MaximumPoint.Y, l.MaximumPoint.Y), 0));
            }
            catch { /* гарчиггүй viewport */ }
            return o;
        }

        /// <summary>Перспектив / рендер зургийн БАЙР: тэгш өнцөгт + бичвэр (зөвхөн шинэ хуудсанд — хэрэглэгч зураг тавиад устгаж болно).</summary>
        private void DrawPlaceholder(ViewSheet sheet, int no, WeSheetSlot sl, WeComposeItem it)
        {
            var ids = new List<ElementId>();
            try
            {
                double hw = (sl.W > 0 ? sl.W : it.W) / 2, hh = (sl.H > 0 ? sl.H : it.H) / 2;
                var p = new[]
                {
                    new XYZ(sl.CenterX - hw, sl.CenterY - hh, 0), new XYZ(sl.CenterX + hw, sl.CenterY - hh, 0),
                    new XYZ(sl.CenterX + hw, sl.CenterY + hh, 0), new XYZ(sl.CenterX - hw, sl.CenterY + hh, 0),
                };
                for (int i = 0; i < 4; i++) ids.Add(_doc.Create.NewDetailCurve(sheet, Line.CreateBound(p[i], p[(i + 1) % 4])).Id);
                ElementId tt = _doc.GetDefaultElementTypeId(ElementTypeGroup.TextNoteType);
                if (tt != ElementId.InvalidElementId)
                {
                    var opts = new TextNoteOptions(tt) { HorizontalAlignment = HorizontalTextAlignment.Center, VerticalAlignment = VerticalTextAlignment.Middle };
                    ids.Add(TextNote.Create(_doc, sheet.Id, new XYZ(sl.CenterX, sl.CenterY, 0),
                        "ХАРАГДАХ БАЙДАЛ " + no.ToString("00", CultureInfo.InvariantCulture) + "\r(перспектив / рендер зураг байрлуулна)", opts).Id);
                }
            }
            catch (Exception ex) { WeLog.Info("sheets", sheet.SheetNumber + ": перспективын байр — " + ex.Message); }
            List<ElementId> list;
            if (!_sheetDrawn.TryGetValue(sheet.Id.Value, out list)) { list = new List<ElementId>(); _sheetDrawn[sheet.Id.Value] = list; }
            list.AddRange(ids);
        }

        // ── Өмнөх / сонгосон хуудас ─────────────────────────────────

        /// <summary>
        /// Хуудсан дээр ЭЗЛЭГДСЭН тэгш өнцөгт (завсартай): бүх viewport (хүрээ + гарчиг), хуваарь, текст, зураас, растер зураг г.м. (title block-оос
        /// бусад) — шинэ блок тэдгээрийг дарахгүй.  Хэрэглэгчийн зөөсөн зураг ХӨДЛӨХГҮЙ.
        /// </summary>
        private void CollectOccupied(ViewSheet sheet, List<double[]> occupied)
        {
            foreach (ElementId id in sheet.GetAllViewports())
            {
                var vp = _doc.GetElement(id) as Viewport;
                if (vp == null) continue;
                try
                {
                    Outline o = FullOutline(vp);
                    occupied.Add(new[] { o.MinimumPoint.X - _gap, o.MinimumPoint.Y - _gap, o.MaximumPoint.X + _gap, o.MaximumPoint.Y + _gap });
                }
                catch { }
            }
            foreach (Element e in new FilteredElementCollector(_doc, sheet.Id).WhereElementIsNotElementType())
            {
                if (e is Viewport || e.Id == sheet.Id) continue;
                if (e.Category != null && e.Category.Id.Value == (long)BuiltInCategory.OST_TitleBlocks) continue;
                BoundingBoxXYZ bb = null;
                try { bb = e.get_BoundingBox(sheet); } catch { }
                if (bb == null) continue;
                occupied.Add(new[] { bb.Min.X - _gap, bb.Min.Y - _gap, bb.Max.X + _gap, bb.Max.Y + _gap });
            }
        }

        /// <summary>Хуудсан дээрх энэ хэрэгслийн viewport-ууд (дэлгээс, түлхүүр план, 3D) — «Дахин байрлуулах»-д.</summary>
        private List<Block> OwnBlocksOn(ViewSheet sheet)
        {
            var list = new List<Block>();
            foreach (ElementId id in sheet.GetAllViewports())
            {
                var vp = _doc.GetElement(id) as Viewport;
                if (vp == null) continue;
                var v = _doc.GetElement(vp.ViewId) as View;
                WeRecord rec = v != null ? GeneratedElevationRepository.Read(v) : null;
                string kind = rec == null ? null
                    : rec.Kind == GeneratedElevationRepository.KindView ? WeComposeKind.Elevation
                    : rec.Kind == GeneratedElevationRepository.KindKeyPlan ? WeComposeKind.KeyPlan
                    : rec.Kind == GeneratedElevationRepository.KindAxon ? WeComposeKind.Axon : null;
                if (kind == null) continue;
                list.Add(new Block { Kind = kind, Vp = vp, ViewId = vp.ViewId, DetailNumber = DetailOf(vp), Existing = true,
                                     Item = _items.FirstOrDefault(i => i.ViewId == vp.ViewId) });
            }
            return list;
        }

        /// <summary>
        /// «Дахин байрлуулах»: хуудсан дээр энэ хэрэгслийн ЗУРСАН перспективын байрыг устгаж тоог нь буцаана (шинэ зохиомжид дахин зурна).  Хэрэглэгч
        /// рендер зураг тавьсан бол (растер зураг) байрыг ХӨНДӨХГҮЙ — 0.
        /// </summary>
        private int ResetPlaceholders(ViewSheet sheet)
        {
            List<ElementId> drawn = WeAnnoStore.Previous(_doc, sheet);
            int placeholders = drawn.Select(id => _doc.GetElement(id) as TextNote)
                                    .Count(t => t != null && (t.Text ?? string.Empty).StartsWith("ХАРАГДАХ БАЙДАЛ", StringComparison.Ordinal));
            bool hasImages = new FilteredElementCollector(_doc, sheet.Id).OfCategory(BuiltInCategory.OST_RasterImages).WhereElementIsNotElementType().GetElementCount() > 0;
            if (hasImages) return 0;
            if (drawn.Count > 0)
            {
                try { _doc.Delete(drawn.Where(id => _doc.GetElement(id) != null).ToList()); } catch (Exception ex) { WeLog.Info("sheets", "перспективын байр устгах — " + ex.Message); }
                WeAnnoStore.Write(_doc, sheet, new List<ElementId>());
            }
            return placeholders;
        }

        // ── Туслах ──────────────────────────────────────────────────

        private Viewport CreateViewport(ElementId sheetId, ElementId viewId, XYZ center, string detailNumber)
        {
            HashSet<string> used;
            using (WeProf.T("vp.usedNumbers")) used = UsedNumbers(sheetId);
            // Төслийн стандарт гарчгийн төрөл (оффисын «Гарчиг - Доогуур зураас» г.м.).  ⚠️ ХЭМЖСЭН (GATEWAY): үүсгэсний ДАРАА
            // ChangeTypeId = 160 мс (viewport-ийг дахин тооцно) — өгөгдмөл төрлийг ЭНЭ transaction-д түр сольж шууд тэр төрлөөр үүсгэнэ.
            ElementId vpt = _res.Standards.ViewportType;
            ElementId prevDefault = null;
            if (vpt != null && vpt != ElementId.InvalidElementId)
            {
                try
                {
                    ElementId cur = _doc.GetDefaultElementTypeId(ElementTypeGroup.ViewportType);
                    if (cur != vpt && _doc.IsDefaultElementTypeIdValid(ElementTypeGroup.ViewportType, vpt))
                    {
                        _doc.SetDefaultElementTypeId(ElementTypeGroup.ViewportType, vpt);
                        prevDefault = cur;
                    }
                }
                catch { prevDefault = null; }
            }
            Viewport vp;
            try
            {
                using (WeProf.T("vp.create")) vp = Viewport.Create(_doc, sheetId, viewId, center);
            }
            finally
            {
                if (prevDefault != null && prevDefault != ElementId.InvalidElementId)
                {
                    try { _doc.SetDefaultElementTypeId(ElementTypeGroup.ViewportType, prevDefault); } catch { }
                }
            }
            if (vpt != null && vpt != ElementId.InvalidElementId && vp.GetTypeId() != vpt)
            {
                try { using (WeProf.T("vp.changeType")) vp.ChangeTypeId(vpt); } catch (Exception ex) { WeLog.Info("sheets", "viewport type — " + ex.Message); }
            }
            Parameter p = null;
            string auto = null;
            try { p = vp.get_Parameter(BuiltInParameter.VIEWPORT_DETAIL_NUMBER); auto = p != null ? p.AsString() : null; } catch { }
            if (!string.IsNullOrEmpty(auto)) used.Add(auto);
            string want = string.IsNullOrWhiteSpace(detailNumber) ? null : WeNaming.Clean(detailNumber);
            if (want != null && p != null && !p.IsReadOnly && !string.Equals(want, auto, StringComparison.Ordinal))
            {
                string unique = want;
                for (int i = 2; used.Contains(unique) && i < 100; i++) unique = want + "-" + i.ToString(CultureInfo.InvariantCulture);
                if (!used.Contains(unique))
                {
                    try
                    {
                        using (WeProf.T("vp.detailSet")) p.Set(unique);
                        if (!string.IsNullOrEmpty(auto)) used.Remove(auto);
                        used.Add(unique);
                    }
                    catch (Exception ex) { WeLog.Info("sheets", "detail number «" + unique + "» — " + ex.Message); }
                }
            }
            return vp;
        }

        /// <summary>Хуудсан дээрх бүх viewport-ийн detail number (эхний удаа уншина, дараа нь хөтөлнө).</summary>
        /// <summary>
        /// Хуудсан дээр аль хэдийн байгаа дэлгээсийн viewport-ийн дугаарыг (Detail Number) одоогийн тэмдэгт тааруулна — зөвхөн хэрэгслийн
        /// бичсэн хэлбэртэй (Revit-ийн автомат тоо эсвэл тэмдгийн загвартай таарсан) дугаарыг; хэрэглэгчийнхийг хөндөхгүй.  Elevation маркер
        /// энэ дугаарыг түлхүүр план дээр өөрөө харуулдаг тул зөрвөл шууд буруу заана (аудит: үсэг шилжихэд «205B» ↔ «205C»).
        /// Хоёр шаттай: эхлээд түр дугаар, дараа нь жинхэнэ — солилцох (B ↔ C) үед давхардал commit дээр унаж БҮХ хуудсыг буцаадаг (хэмжсэн).
        /// </summary>
        private void RefreshDetailNumbers(List<WeRunItem> items, Dictionary<long, Viewport> vpOfView, WeRunResult result)
        {
            var todo = new List<KeyValuePair<Viewport, string>>();
            foreach (WeRunItem w in items)
            {
                Viewport vp;
                string want = w.Plan.Label;
                if (string.IsNullOrWhiteSpace(want) || !vpOfView.TryGetValue(w.ViewId.Value, out vp)) continue;
                string cur = DetailOf(vp);
                if (string.Equals(cur, want, StringComparison.Ordinal)) continue;
                bool ours = !string.IsNullOrEmpty(cur) && (cur.All(char.IsDigit)
                            || WeNaming.LooksGenerated(_s.LabelPattern, cur, ElevationGenerationCoordinator.PatternValues(w.Plan)));
                if (ours) todo.Add(new KeyValuePair<Viewport, string>(vp, want));
            }
            if (todo.Count == 0) return;
            int changed = 0;
            foreach (IGrouping<long, KeyValuePair<Viewport, string>> sheet in todo.GroupBy(t => t.Key.SheetId.Value))
            {
                var moving = new HashSet<long>(sheet.Select(t => t.Key.Id.Value));
                // Хуудасны бусад (хөдлөхгүй) viewport-ийн дугаар.
                var fixedNums = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                var sh = _doc.GetElement(new ElementId(sheet.Key)) as ViewSheet;
                if (sh != null)
                    foreach (ElementId id in sh.GetAllViewports())
                        if (!moving.Contains(id.Value)) { string n = DetailOf(_doc.GetElement(id) as Viewport); if (!string.IsNullOrEmpty(n)) fixedNums.Add(n); }
                var original = sheet.ToDictionary(t => t.Key.Id.Value, t => DetailOf(t.Key));
                foreach (KeyValuePair<Viewport, string> t in sheet) SetDetail(t.Key, "~we" + t.Key.Id.Value.ToString(System.Globalization.CultureInfo.InvariantCulture));
                var taken = new HashSet<string>(fixedNums, StringComparer.OrdinalIgnoreCase);
                foreach (KeyValuePair<Viewport, string> t in sheet)
                {
                    string target = !taken.Contains(t.Value) ? t.Value : original[t.Key.Id.Value];
                    if (taken.Contains(target)) target = WeNaming.UniqueNumber(t.Value, taken);
                    SetDetail(t.Key, target);
                    taken.Add(target);
                    if (!string.Equals(target, original[t.Key.Id.Value], StringComparison.Ordinal)) changed++;
                }
            }
            _detailUsed.Clear();
            if (changed > 0) result.Notes.Add(changed + " viewport-ийн дугаарыг шинэ тэмдэгт тааруулав (түлхүүр планы тэмдэгтэй ижил).");
        }

        private static string DetailOf(Viewport vp)
        {
            try { return vp == null ? null : vp.get_Parameter(BuiltInParameter.VIEWPORT_DETAIL_NUMBER).AsString(); } catch { return null; }
        }

        private static void SetDetail(Viewport vp, string value)
        {
            try { Parameter p = vp.get_Parameter(BuiltInParameter.VIEWPORT_DETAIL_NUMBER); if (p != null && !p.IsReadOnly) p.Set(value); }
            catch (Exception ex) { WeLog.Info("sheets", "detail number «" + value + "» — " + ex.Message); }
        }

        private HashSet<string> UsedNumbers(ElementId sheetId)
        {
            HashSet<string> set;
            if (_detailUsed.TryGetValue(sheetId.Value, out set)) return set;
            set = new HashSet<string>(StringComparer.Ordinal);
            var sheet = _doc.GetElement(sheetId) as ViewSheet;
            if (sheet != null)
                foreach (ElementId id in sheet.GetAllViewports())
                {
                    try
                    {
                        string n = _doc.GetElement(id).get_Parameter(BuiltInParameter.VIEWPORT_DETAIL_NUMBER).AsString();
                        if (!string.IsNullOrEmpty(n)) set.Add(n);
                    }
                    catch { }
                }
            _detailUsed[sheetId.Value] = set;
            return set;
        }

        private static string KeyDetail(WeGroupInfo g)
        {
            return g == null || string.IsNullOrWhiteSpace(g.Label) ? "КП" : g.Label;
        }

        /// <summary>Бүлгийн төлөөлөх дэлгээс (хуудасны нэр, дугаарт) — энэ ажиллагааных эсвэл төлөвлөгөөний эхнийх.</summary>
        private WePlannedElevation Representative(string group, List<WeRunItem> todo)
        {
            WeRunItem r = todo.FirstOrDefault(i => i.Plan.GroupKey == group);
            return r != null ? r.Plan : _plan.Items.FirstOrDefault(i => i.GroupKey == group) ?? new WePlannedElevation { GroupKey = group };
        }

        private string SideRange(string group)
        {
            WeGroupInfo gi = _plan.Groups.FirstOrDefault(x => x.GroupKey == group);
            if (gi != null) return gi.SideRange ?? string.Empty;
            return WeNaming.SideRange(_plan.Items.Where(i => i.GroupKey == group && i.Frame != null && i.Status <= WeStatus.Warning).Select(i => i.SideLetter));
        }

        /// <summary>
        /// Хуудасны нэр (тохиргооны загвар / төслөөс сурсан, муж = бүлгийн ОДООГИЙН үсэг) — шинэ хуудас ба мужийн шинэчлэлд.
        /// <paramref name="learn"/> = false: төслөөс сурсан загварыг үл тооно (анхны ажиллагаанд хуудас өгөгдмөл загвараар үүсч, дараа нь хэрэгсэл
        /// ТЭР хуудаснаас «суралцдаг» — «/ L1/» ↔ «/L1/»).
        /// </summary>
        private string SheetTitle(WePlannedElevation p, int page, bool learn = true)
        {
            string range = SideRange(p.GroupKey ?? string.Empty);
            string room = p.Kind == WeSourceKind.Room ? (p.RoomNumber ?? string.Empty) : "W";
            Dictionary<string, string> values = WeNaming.Values(p.LevelName, room, p.RoomName, string.Empty, string.Empty, 0, string.Empty, range);
            string namePattern = string.IsNullOrWhiteSpace(_s.SheetNamePattern) ? WeNaming.DefaultSheetNamePattern : _s.SheetNamePattern;
            // Төслийн өөрийн өрөөний хуудасны нэр («218 АЦӨ … ХАНЫН ДЭЛГЭЭС /A BLOCK 2-Р ДАВХАР/ /218A-E/») — тохиргоо өгөгдмөл, энэ давхарт сурсан бол.
            if (learn && p.Kind == WeSourceKind.Room && namePattern == WeNaming.DefaultSheetNamePattern && _res.Standards.Found)
            {
                WeGroupInfo gi = _plan.Groups.FirstOrDefault(x => x.GroupKey == p.GroupKey);
                string zone = gi != null ? _res.Standards.ZoneFor(gi.LevelId) : null;
                if (!string.IsNullOrEmpty(zone))
                {
                    values["{Level}"] = zone;
                    namePattern = WeNaming.LearnedSheetNamePattern(_res.Standards.RoomSeparator);
                }
            }
            string title = p.Kind == WeSourceKind.Room
                ? WeNaming.Expand(namePattern, values)
                : "Ханын дэлгээс — " + (p.LevelName ?? string.Empty);
            if (string.IsNullOrWhiteSpace(title)) title = "Ханын дэлгээс";
            // Жишээ хуудас том үсгээр — өгөгдмөл загварт л (хэрэглэгчийн загварын бичлэгийг хөндөхгүй).
            if (p.Kind == WeSourceKind.Room && (string.IsNullOrWhiteSpace(_s.SheetNamePattern) || _s.SheetNamePattern == WeNaming.DefaultSheetNamePattern))
                title = title.ToUpper(CultureInfo.InvariantCulture);
            return WeNaming.Clean(page > 0 ? title + " (" + (page + 1).ToString(CultureInfo.InvariantCulture) + ")" : title);
        }

        /// <summary>
        /// Өмнө үүсгэсэн хуудасны нэрийн ҮСГИЙН МУЖ (2026-10-14, «+ Хана нэмэх»: E нэмэгдэхэд «/101A-D/» хуудсанд E байрлана) — нэр нь хэрэгслийн
        /// өгсөн хэлбэрээрээ, ЗӨВХӨН муж өөр бол шинэчилнэ (<see cref="WeNaming.Rerange"/>); хэрэглэгч өөрчилсөн нэрийг хөндөхгүй.
        /// </summary>
        private bool RerangeSheet(ViewSheet sh, WePlannedElevation p, int page)
        {
            if (sh == null || !sh.IsValidObject || p == null || p.Kind != WeSourceKind.Room) return false;
            string range = SideRange(p.GroupKey ?? string.Empty);
            // Хуудас аль загвараар үүссэн байж болно (анхны ажиллагаанд өгөгдмөл, дараа нь сурсан) — ТЭР хэлбэрээр нь (зөвхөн муж солигдоно).
            string next = WeNaming.Rerange(sh.Name, SheetTitle(p, page), range) ?? WeNaming.Rerange(sh.Name, SheetTitle(p, page, false), range);
            if (next == null) return false;
            try
            {
                string was = sh.Name;
                sh.Name = next;
                WeLog.Info("sheets", "«" + was + "» → «" + next + "» (үсгийн муж)");
                return true;
            }
            catch (Exception ex) { WeLog.Info("sheets", sh.Name + ": мужийг шинэчилсэнгүй — " + ex.Message); return false; }
        }

        private ViewSheet NewSheet(FamilySymbol tb, WePlannedElevation p, int page)
        {
            string range = SideRange(p.GroupKey ?? string.Empty);
            string room = p.Kind == WeSourceKind.Room ? (p.RoomNumber ?? string.Empty) : "W";
            Dictionary<string, string> values = WeNaming.Values(p.LevelName, room, p.RoomName, string.Empty, string.Empty, 0, string.Empty, range);
            string number = null;
            // W05 (2026-10-16): урьдчилсан дүнд хуваарилсан дугаар (мужаас хэтрэхгүй).  Хооронд нь өөр хүн эзэлсэн бол мужаас дараагийн СУЛ;
            // мужид сул алга бол хуудас ҮҮСГЭХГҮЙ (InTx буцаана, тэмдэглэл) — мужаас хэтрүүлэх, бусдын хуудсыг дугаарлахгүй.
            string planned = null;
            if (page == 0 && _plan.SheetNumbers != null && _plan.SheetNumbers.TryGetValue(p.GroupKey ?? string.Empty, out planned) && !string.IsNullOrEmpty(planned)
                && !_res.SheetNumbers.Contains(planned))
                number = planned;
            else if (_s.SheetNumberMode == WeSheetNumberMode.Range)
            {
                number = WeNumbering.NextFree(_s, _res.SheetNumbers);
                if (number == null)
                    throw new InvalidOperationException("Хуудасны дугаарын муж «" + WeNumbering.SheetNumber(_s.SheetRangePrefix, _s.SheetRangeStart, _s.SheetRangeDigits) + "–"
                                                        + WeNumbering.SheetNumber(_s.SheetRangePrefix, _s.SheetRangeEnd, _s.SheetRangeDigits)
                                                        + "» дүүрсэн — хуудас үүсгэсэнгүй; мужийг өргөтгөөд дахин ажиллуулна уу (мужаас хэтрэхгүй).");
                if (!string.IsNullOrEmpty(planned)) _result.Notes.Add("Хуудасны дугаар «" + planned + "» хооронд нь эзлэгдсэн — мужаас «" + number + "».");
            }
            if (number == null)
            {
                // Төслийн дотор дэлгээсийн хуудасны цуваа («БА413…БА427» → «БА428»), тохиргоо өгөгдмөл хэвээр бол.
                number = string.Equals(_s.SheetNumberPattern, WeNaming.DefaultSheetPattern, StringComparison.Ordinal) && _res.Standards.Found
                    ? _res.Standards.NextSheetNumber(_res.SheetNumbers) : null;
                if (number == null)
                {
                    number = WeNaming.Expand(_s.SheetNumberPattern, values);
                    if (page > 0) number += "-" + (page + 1).ToString(CultureInfo.InvariantCulture);
                }
                number = WeNaming.UniqueNumber(number, _res.SheetNumbers);
            }
            ViewSheet sh = ViewSheet.Create(_doc, tb.Id);
            try { sh.SheetNumber = number; _res.SheetNumbers.Add(number); }
            catch (Autodesk.Revit.Exceptions.ArgumentException)
            {
                _res.SheetNumbers.Add(number);
                number = WeNaming.UniqueNumber(number, _res.SheetNumbers);
                sh.SheetNumber = number;
                _res.SheetNumbers.Add(number);
            }
            sh.Name = SheetTitle(p, page);
            // W09: Project Browser-ийн бүлэг ЭХЛЭЭД, дараа нь өрөөний зориулалтын тогтмол мета — ижил параметрт зориулалтынх давуу (өрөө бүр өөрийн).
            ApplyFolders(sh);
            ApplyFixedParams(sh, p.GroupKey);
            GeneratedElevationRepository.Write(sh, new WeRecord
            {
                Kind = GeneratedElevationRepository.KindSheet,
                Key = SheetKey(p.GroupKey, page),
                RoomUid = p.RoomUid,
                GeneratedName = sh.SheetNumber,
                GeneratorVersion = WeIdentity.GeneratorVersion,
            });
            return sh;
        }

        /// <summary>
        /// Ажлын зургийн бүрдэл (2026-10-14): шинэ хуудсанд цонхонд сонгосон Project Browser-ийн бүлгийг бичнэ.  Эхний хуудсан дээр Revit-ийн
        /// бодит байрлалыг шалгаж, сонгосноос зөрвөл / шүүлтэд орохгүй бол тэмдэглэнэ.
        /// </summary>
        private void ApplyFolders(ViewSheet sh)
        {
            if (_s.SheetFolders == null || _s.SheetFolders.Count == 0) return;
            var failed = new List<string>();
            WeSheetFolderReader.Apply(sh, _s.SheetFolders, null, failed);
            NoteFolderFailures(failed);
            if (_folderChecked) return;
            _folderChecked = true;
            try { _doc.Regenerate(); } catch { }
            bool hidden;
            string where = WeSheetFolderReader.Where(_doc, sh, out hidden);
            bool exact = !string.IsNullOrEmpty(_s.SheetFoldersPath) && _s.SheetFoldersPath.IndexOf('‹') < 0;
            if (where != null && exact && !string.Equals(where, _s.SheetFoldersPath, StringComparison.Ordinal))
                _result.Notes.Add("Шинэ хуудас Project Browser-т «" + where + "» бүлэгт орлоо (сонгосон: «" + _s.SheetFoldersPath + "»).");
            else if (where != null)
                _result.Notes.Add("Шинэ хуудас Project Browser-т: " + where + ".");
            if (hidden)
                _result.Notes.Add("Шинэ хуудас Project Browser-ийн шүүлтэд (Browser Organization → Filtering) орохгүй тул жагсаалтад харагдахгүй байж магадгүй.");
        }

        private readonly HashSet<string> _fixedNoted = new HashSet<string>(StringComparer.Ordinal);
        private int _fixedWritten;

        /// <summary>
        /// Салбарын тогтмол параметр (2026-10-14, интерьерийн хэрэгсэл: «* Classification» = «Интерьер», «* Sub-Discipline» = «Барилга
        /// архитектур») — хуудасны параметрийг НЭРЭЭР тулгаж (<see cref="WeSheetDiscipline.NormalizeName"/>) бичнэ.  true = өөрчилсөн.
        /// </summary>
        private readonly Dictionary<string, WeSettings> _groupSettings = new Dictionary<string, WeSettings>(StringComparer.Ordinal);

        /// <summary>W09: өрөөний (бүлгийн) зориулалтыг хэрэглэсэн тохиргоо — рендерийн байр, хуудасны тогтмол параметр.</summary>
        private WeSettings GroupSettings(string group)
        {
            string key = group ?? string.Empty;
            WeSettings gs;
            if (_groupSettings.TryGetValue(key, out gs)) return gs;
            WePlannedElevation any = _plan != null ? _plan.Items.FirstOrDefault(i => i.GroupKey == key) : null;
            gs = _s.ForPreset(any != null ? any.PresetId : WePresetId.Custom);
            _groupSettings[key] = gs;
            return gs;
        }

        private bool ApplyFixedParams(ViewSheet sh, string group)
        {
            // Өрөөний зориулалтын тогтмол мета (интерьер …) + цонхонд сонгосон («* Type Designator», 2026-10-14 3-р тойрог).
            Dictionary<string, string> all = GroupSettings(group).AllSheetParams();
            if (all.Count == 0 || sh == null || !sh.IsValidObject) return false;
            bool changed = false;
            foreach (KeyValuePair<string, string> kv in all)
            {
                string want = WeSheetDiscipline.NormalizeName(kv.Key);
                bool found = false;
                foreach (Parameter prm in sh.Parameters)
                {
                    if (prm == null || prm.Definition == null || WeSheetDiscipline.NormalizeName(prm.Definition.Name) != want) continue;
                    found = true;
                    if (prm.IsReadOnly || prm.StorageType != StorageType.String)
                    {
                        if (_fixedNoted.Add("ro|" + kv.Key))
                            _result.Notes.Add("Хуудасны «" + prm.Definition.Name + "» параметр " + (prm.IsReadOnly ? "зөвхөн уншигдах" : "бичвэр биш")
                                              + " — «" + kv.Value + "» бичигдсэнгүй.");
                        continue;
                    }
                    if (string.Equals(prm.AsString() ?? string.Empty, kv.Value, StringComparison.Ordinal)) continue;
                    try
                    {
                        if (prm.Set(kv.Value)) { changed = true; _fixedWritten++; }
                    }
                    catch (Exception ex)
                    {
                        if (_fixedNoted.Add("err|" + kv.Key)) _result.Notes.Add("Хуудасны «" + prm.Definition.Name + "» параметрт «" + kv.Value + "» бичигдсэнгүй: " + ex.Message);
                    }
                }
                if (!found && _fixedNoted.Add("missing|" + kv.Key))
                    _result.Notes.Add("Хуудсанд «" + kv.Key + "» параметр алга — «" + kv.Value + "» бичигдсэнгүй (Manage → Project Parameters-д хуудасны ангилалд нэмнэ үү).");
            }
            if (changed && _fixedNoted.Add("done"))
                _result.Notes.Add((_s.InteriorTool ? "Интерьерийн хуудас: " : "Хуудасны параметр: ") + WeSheetDiscipline.Describe(all) + " автоматаар бичигдэв.");
            return changed;
        }

        /// <summary>Цонхонд бүлгийг өөрчилсөн бол: энэ удаагийн өрөөний (бүлгийн) өмнө үүсгэсэн хуудсууд, утга нь зөрсөн.</summary>
        private List<ViewSheet> FolderMoves(List<WeRunItem> items)
        {
            var list = new List<ViewSheet>();
            if (_s.SheetFolders == null || _s.SheetFoldersMove == null || _s.SheetFoldersMove.Count == 0 || _s.Output != WeOutputMode.ViewsAndSheets) return list;
            var groups = new HashSet<string>(items.Select(i => i.Plan.GroupKey ?? string.Empty), StringComparer.Ordinal);
            foreach (KeyValuePair<string, ViewSheet> kv in _ourSheets)
            {
                string g; int page;
                if (!ParseSheetKey(kv.Key, out g, out page) || !groups.Contains(g) || !kv.Value.IsValidObject) continue;
                foreach (string key in _s.SheetFoldersMove)
                {
                    string want;
                    if (_s.SheetFolders.TryGetValue(key, out want) && WeSheetFolderReader.Differs(kv.Value, key, want)) { list.Add(kv.Value); break; }
                }
            }
            return list;
        }

        private void MoveFolders()
        {
            var failed = new List<string>();
            int moved = 0;
            foreach (ViewSheet sh in _folderMoves)
                if (sh.IsValidObject && WeSheetFolderReader.Apply(sh, _s.SheetFolders, _s.SheetFoldersMove, failed)) moved++;
            NoteFolderFailures(failed);
            if (moved == 0) return;
            _changed = true;
            foreach (ViewSheet sh in _folderMoves) if (!_result.Sheets.Contains(sh.Id)) _result.Sheets.Add(sh.Id);
            _result.Notes.Add(moved.ToString(CultureInfo.InvariantCulture) + " өмнөх хуудсыг Project Browser-т «" + (_s.SheetFoldersPath ?? "сонгосон бүлэг") + "» руу шилжүүлэв.");
        }

        private void NoteFolderFailures(List<string> failed)
        {
            foreach (string k in failed)
                if (_folderFailed.Add(k))
                    _result.Notes.Add("Хуудасны бүлгийн параметр (id " + k + ") бичигдсэнгүй — хуудас бүлэгт ороогүй байж магадгүй; Project Browser-ээс гараар зөөнө үү.");
        }

        private static string SheetKey(string group, int page)
        {
            return "sheet|" + group + "|p" + page.ToString(CultureInfo.InvariantCulture);
        }

        private static string Append(string a, string b) { return string.IsNullOrEmpty(a) ? b : a + "; " + b; }
    }
}
