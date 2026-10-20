using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using RevitMcpAddin.Smart;
using RevitMcpAddin.Smart.Core;
using RevitMcpAddin.SmartCount.Core;
// `Autodesk.Revit.DB` нь мөн `ElementRecord` төрөлтэй — манай цэвэр DTO-г тодорхой нэрлэнэ.
using ElementRecord = RevitMcpAddin.SmartCount.Core.ElementRecord;

namespace RevitMcpAddin.SmartCount
{
    /// <summary>
    /// Smart Count-ийн ХЭСЭГЛЭСЭН ажил (`SmartExecutor`).
    ///
    /// ДАРААЛАЛ:  Prepare (нэг Step)  →  Process (Step бүр ≤ 200 элемент)  →  Finish
    ///
    ///   1. ХУРДАН шүүлтүүр ЭХЭНД: scope (бүх загвар / идэвхтэй харагдац / сонголт) + ангилал
    ///      (`ElementCategoryFilter` / `ElementMulticategoryFilter`) + `WhereElementIsNotElementType`.
    ///   2. ДАРАА нь, ЗӨВХӨН хэрэгтэй үед ЭХ ХУУЛИЙН (native) СААТАЛТАЙ шүүлтүүр: `ElementLevelFilter`
    ///      (Level = X), `ElementParameterFilter` (тоон instance параметр, `ParameterFilterRuleFactory`).
    ///      Эдгээр нь Revit-ийн native кодод ажиллаж, таарахгүй элементүүдэд managed `Element` обьект
    ///      ҮҮСГЭХГҮЙ тул хурдан.  ⚠️ Тэдгээр нь НАРИЙВЧЛАЛ (суперсет, хүлцэл тэлсэн) — эцсийн шийдвэр
    ///      ҮРГЭЛЖ `QueryEvaluator`-д (текст/хүлцэл/нэгжийн онцлог дүнг өөрчлөхгүй).  Шүүлтүүр алдаа
    ///      шидвэл (параметр олдсонгүй, spec таарсангүй) шүүлтүүргүйгээр үргэлжилнэ — зөвхөн удаан.
    ///   3. Элемент бүрийг ХУУЛСАН `ElementRecord` болгоод (параметр нь зөвхөн асуулгад хэрэгтэй нь)
    ///      цэвэр evaluator-оор шалгана; таарсныг л aggregator-д хадгална.
    ///
    /// ⚠️ Step бүр БИЕ ДААСАН: Revit-ийн амьд обьектыг (Element, Parameter...) Step хооронд хадгалахгүй
    /// (зөвхөн `ElementId` жагсаалт).  Step бүрийн эхэнд идэвхтэй баримт ТЭР Ж ГАНЦ баримт мөн эсэх шалгана.
    /// </summary>
    internal sealed class CountJob : ISmartJob
    {
        private const int BatchSize = 200;

        private readonly QueryDefinition _q;
        private readonly DocumentKey _key;
        private readonly IProgress<JobProgress> _progress;
        private readonly StageTimer _timer = new StageTimer();
        private readonly EvalStats _stats = new EvalStats();

        private bool _prepared;
        private Document _doc;
        private List<ElementId> _ids;
        private int _pos;
        private QueryPlan _plan;
        private CountAggregator _agg;
        private ParamReader _reader;
        private string _stampAtStart;
        private readonly Dictionary<long, string> _levelNames = new Dictionary<long, string>();
        // ⚠️ Revit-ийн амьд обьектыг (ElementType г.м.) Step хооронд ХАДГАЛАХГҮЙ — зөвхөн ХУУЛСАН тэмдэгт мөр/утга.
        private sealed class TypeInfo { public bool Exists; public string Family; public string Name; }
        private readonly Dictionary<long, TypeInfo> _typeInfo = new Dictionary<long, TypeInfo>();
        private readonly Dictionary<string, ParamValue> _typeParamCache = new Dictionary<string, ParamValue>(StringComparer.Ordinal);
        private readonly HashSet<string> _ambiguousNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        private readonly List<string> _notes = new List<string>();

        public CountResult Result { get; private set; }
        public string Name { get { return "Smart Count"; } }

        internal CountJob(QueryDefinition q, DocumentKey key, IProgress<JobProgress> progress)
        {
            _q = q;
            _key = key;
            _progress = progress;
        }

        public void OnCancelled() { }

        public bool Step(UIApplication app)
        {
            Document doc = ActiveDocument(app);
            if (!_prepared)
            {
                _timer.Begin("collect");
                Prepare(app, doc);
                _prepared = true;
                Report("Элемент шалгаж байна", 0, _ids.Count);
                return _ids.Count == 0 && Finish(doc);
            }

            _timer.Begin("evaluate");
            int end = Math.Min(_ids.Count, _pos + BatchSize);
            for (; _pos < end; _pos++)
            {
                Element e;
                try { e = doc.GetElement(_ids[_pos]); }
                catch (Exception) { continue; }
                if (e == null) continue;

                ElementRecord rec = BuildRecord(doc, e);
                if (QueryEvaluator.Matches(_q.Where, rec, _stats)) _agg.Add(rec);
            }
            Report("Элемент шалгаж байна", _pos, _ids.Count);
            return _pos >= _ids.Count && Finish(doc);
        }

        /* ============================== PREPARE ============================ */

        private Document ActiveDocument(UIApplication app)
        {
            UIDocument ui = app.ActiveUIDocument;
            Document doc = ui != null ? ui.Document : null;
            if (doc == null) throw new InvalidOperationException("Идэвхтэй баримт алга.");
            if (!_key.Equals(RevitDocumentKeys.Of(doc)))
                throw new InvalidOperationException("Идэвхтэй файл солигдсон — тоолол эхэлсэн файл руугаа буцна уу.");
            // Ижил файл (түлхүүр) ч ХААГДААД ДАХИН НЭЭГДСЭН бол (өөр нээлт) тоолол эхэлсэн баримт биш — хоёр нээлтийн элементийг хольж тоолохгүй.
            if (_doc == null) _doc = doc;
            else if (!SmartDocs.IsAlive(_doc) || !SmartDocs.Same(_doc, doc))      // хаагдсан wrapper-ийн `Equals`-д найдахгүй (undocumented)
                throw new InvalidOperationException("Баримт хаагдаж дахин нээгдсэн — тоололыг дахин эхлүүлнэ үү.");
            else _doc = doc;                   // ижил баримтын шинэ wrapper байж болно — хамгийн сүүлийнхийг ашиглана
            return doc;
        }

        private void Prepare(UIApplication app, Document doc)
        {
            List<QueryIssue> issues = QueryValidator.Validate(_q);
            if (!QueryValidator.IsRunnable(issues))
                throw new InvalidOperationException(string.Join("\n", issues.Where(i => i.IsError).Select(i => i.Message)));

            _plan = QueryPlanner.Plan(_q);
            _reader = new ParamReader(doc);
            _agg = new CountAggregator(_q.GroupBy);
            _stampAtStart = ModelChangeCounter.Stamp(doc);

            string closedNote = ClosedWorksetNote(doc);
            if (closedNote != null) _notes.Add(closedNote);

            FilteredElementCollector collector = Scope(app, doc);
            if (collector == null) { _ids = new List<ElementId>(); return; }

            collector = _q.CountTypes ? collector.WhereElementIsElementType() : collector.WhereElementIsNotElementType();

            List<BuiltInCategory> cats = new List<BuiltInCategory>();
            foreach (string name in _plan.Categories)
            {
                BuiltInCategory bic;
                if (Enum.TryParse(name, true, out bic) && Enum.IsDefined(typeof(BuiltInCategory), bic)) cats.Add(bic);
                else _notes.Add("Ангилал «" + name + "» танигдсангүй — алгасав.");
            }
            if (_plan.Categories.Count > 0 && cats.Count == 0)
            {
                _ids = new List<ElementId>();
                return;
            }
            if (cats.Count == 1) collector = collector.WherePasses(new ElementCategoryFilter(cats[0]));
            else if (cats.Count > 1) collector = collector.WherePasses(new ElementMulticategoryFilter(cats));

            // Level = X: ийм нэртэй давхар загварт байхгүй бол нэр дэвшигч байхгүй (хоосон үр дүн).
            List<ElementId> levelIds = ResolveLevels(doc);
            if (_plan.LevelEquals.Count > 0 && levelIds.Count == 0)
            {
                _notes.Add("Давхар «" + string.Join("», «", _plan.LevelEquals) + "» загварт олдсонгүй.");
                _ids = new List<ElementId>();
                return;
            }

            ElementFilter slow = BuildSlowFilter(app, doc, collector, levelIds, cats);
            if (slow != null)
            {
                try
                {
                    _ids = collector.WherePasses(slow).ToElementIds().ToList();
                    return;
                }
                catch (Exception ex)
                {
                    // Шүүлтүүр буруу (параметр хөрвөөгүй г.м.) — шүүлтүүргүй дахин оролдоно.
                    _notes.Add("Хурдасгах шүүлтүүр ашиглагдсангүй (" + ex.GetType().Name + ") — бүх нэр дэвшигчийг шалгав.");
                    SmartLog.Warn("count", "slow_filter_failed", new { ex = ex.GetType().Name });
                    collector = RebuildQuick(app, doc, cats);
                }
            }
            _ids = collector.ToElementIds().ToList();
        }

        /// <summary>
        /// Хаалттай workset-ийн элементийг Revit ачаалдаггүй тул ямар ч collector тэдгээрийг БУЦААХГҮЙ — тоо нь тэднийгээ ХАСАЖ тоолсон гэдгийг
        /// ИЛ хэлнэ (эс бөгөөс «яг» мэт харагдах дутуу тоо).  Хаалттай workset байхгүй бол null.
        /// </summary>
        private static string ClosedWorksetNote(Document doc)
        {
            try
            {
                if (!doc.IsWorkshared) return null;
                var names = new List<string>();
                foreach (Workset w in new FilteredWorksetCollector(doc).OfKind(WorksetKind.UserWorkset))
                    if (!w.IsOpen) names.Add(w.Name);
                if (names.Count == 0) return null;
                return "⚠ " + names.Count + " workset хаалттай (" + string.Join(", ", names.Take(5)) + (names.Count > 5 ? ", …" : "")
                    + ") — тэдгээрийн элемент ТООЛОГДООГҮЙ; нийт тоо дутуу байж болно.";
            }
            catch (Exception) { return null; }
        }

        /// <summary>Slow шүүлтүүр унасны дараа collector-ыг ХУРДАН шүүлтүүрүүдээр дахин угсарна (collector-ыг дахин ашиглахад аюулгүй).</summary>
        private FilteredElementCollector RebuildQuick(UIApplication app, Document doc, List<BuiltInCategory> cats)
        {
            FilteredElementCollector c = Scope(app, doc);
            c = _q.CountTypes ? c.WhereElementIsElementType() : c.WhereElementIsNotElementType();
            if (cats.Count == 1) c = c.WherePasses(new ElementCategoryFilter(cats[0]));
            else if (cats.Count > 1) c = c.WherePasses(new ElementMulticategoryFilter(cats));
            return c;
        }

        private FilteredElementCollector Scope(UIApplication app, Document doc)
        {
            switch (_q.Scope)
            {
                case CountScope.ActiveView:
                    View v = doc.ActiveView;
                    if (v == null) throw new InvalidOperationException("Идэвхтэй харагдац алга.");
                    // Revit-ийн баримтжуулалт: харагдацын collector нь «харагдаж БОЛОХ» элементийг буцаадаг — crop-оос гадуурх, бусад элементэд
                    // халхлагдсан зарим элемент ч орж болно.  Энэ нь нүдэнд харагдаж буй ЯГ тоо БИШ (хэт тоолох боломжтой).
                    _notes.Add("Идэвхтэй харагдацын тоо нь Revit-ийн «харагдаж болох элемент»-ийн collector-оор — crop-оос гадуурх эсвэл халхлагдсан зарим элемент орсон байж болно (хэт тоолох).");
                    return new FilteredElementCollector(doc, v.Id);

                case CountScope.Selection:
                    ICollection<ElementId> sel = app.ActiveUIDocument.Selection.GetElementIds();
                    if (sel.Count == 0) { _notes.Add("Сонгосон элемент алга."); return null; }
                    // `GetElementIds` нь зөвхөн ЭНЭ баримтын сонгосон элементийг буцаадаг — линкийн элемент, дэд элемент (face, edge) орохгүй.
                    _notes.Add("Сонголтоос тоолсон — линкийн элемент болон дэд элемент (face, edge) тооцогдоогүй.");
                    return new FilteredElementCollector(doc, sel);

                default:
                    return new FilteredElementCollector(doc);
            }
        }

        /// <summary>
        /// Level = X ба тоон instance нөхцөлөөс ЭХ ХУУЛИЙН шүүлтүүр.  Алдаа гарвал null (шүүлтүүргүй).
        /// ⚠️ Тоон шүүлтүүрийн утгыг ДОТООД нэгжид (фут г.м.) хөрвүүлж, хүлцлийг тэлнэ (суперсет).
        /// </summary>
        private List<ElementId> ResolveLevels(Document doc)
        {
            var ids = new List<ElementId>();
            if (_plan.LevelEquals.Count == 0) return ids;
            // Нэрийг evaluator-ийн `Norm`-оор (trim + Юникод NFC + том/жижиг үсэг үл хамаарах) харьцуулна: «Level 1 » эсвэл өөр хэлбэрээр бичсэн кирилл нэр
            // evaluator-т таарч байхад planner таарахгүй гэвэл «давхар олдсонгүй» гэж ХООСОН дүн буцааж дутуу тоолно (суперсет БИШ).
            var wanted = new HashSet<string>(_plan.LevelEquals.Select(n => QueryEvaluator.Norm(n, false)), StringComparer.Ordinal);
            foreach (Level lv in new FilteredElementCollector(doc).OfClass(typeof(Level)).Cast<Level>())
                if (wanted.Contains(QueryEvaluator.Norm(lv.Name, false))) ids.Add(lv.Id);
            return ids;
        }

        /// <summary>
        /// Нэр дэвшигчдийн дунд ЗАГВАР (loadable family)-ын instance (`FamilyInstance`, түүний удам) байна уу.  Эхний элементийн параметрийн id нь
        /// family бүрт ЯАГААД ч ижил биш: нэг family built-in/shared параметртэй, нөгөө нь ИЖИЛ НЭРТЭЙ өөрийн (family) параметртэй байж болох ба
        /// native шүүлтүүр эхнийхийн id-гаар шүүвэл хоёр дахийг хасаж (evaluator нэрээр уншиж таардаг тул) үр дүнг дутуу тоолно — суперсет БИШ.
        /// Систем элемент (хана, шал, дээвэр, өрөө…) дээр built-in/project параметрийн id глобал.  Тодорхойгүй бол (алдаа) «байна» гэж үзнэ — аюулгүй тал.
        /// </summary>
        private bool HasLoadableFamilyInstances(UIApplication app, Document doc, List<BuiltInCategory> cats)
        {
            try
            {
                FilteredElementCollector c = RebuildQuick(app, doc, cats);
                return c.WherePasses(new ElementClassFilter(typeof(FamilyInstance))).GetElementCount() > 0;
            }
            catch (Exception) { return true; }
        }

        private ElementFilter BuildSlowFilter(UIApplication app, Document doc, FilteredElementCollector quick, List<ElementId> levelIds, List<BuiltInCategory> cats)
        {
            var filters = new List<ElementFilter>();
            try
            {
                if (levelIds.Count == 1) filters.Add(new ElementLevelFilter(levelIds[0]));
                else if (levelIds.Count > 1) filters.Add(new LogicalOrFilter(levelIds.Select(i => (ElementFilter)new ElementLevelFilter(i)).ToList()));

                // ⚠️ Тоон шүүлтүүр: (1) ЗӨВХӨН нэг ангилалтай үед — ижил НЭРТЭЙ параметр ангилал бүрт ӨӨР id-тай байж болох тул эхний элементийн параметрийн id-г
                // бүх нэр дэвшигчид хэрэглэвэл бусдыг алдана; (2) ЗАГВАРЫН instance байхгүй үед л (`HasLoadableFamilyInstances`); (3) төрөл тоолоход БИШ (төрлийн
                // параметр family бүрт өөр id) — эс бөгөөс evaluator-ийн суперсет БИШ болж үр дүнг дутуу тоолно.
                if (_plan.NumericBounds.Count > 0 && cats.Count == 1 && !_q.CountTypes)
                {
                    if (HasLoadableFamilyInstances(app, doc, cats))
                    {
                        // Үр дүн ЯГ хэвээр (зөвхөн хурдасгалт хэрэглэгдэхгүй) — хэрэглэгчийн тайланд тэмдэглэхгүй, зөвхөн лог.
                        SmartLog.Info("count", "numeric_pushdown_skipped_family_instances");
                    }
                    else
                    {
                        Element sample = quick.FirstElement();
                        if (sample != null)
                            foreach (NumericBound b in _plan.NumericBounds)
                            {
                                ElementFilter f = NumericFilter(doc, sample, b);
                                if (f != null) filters.Add(f);
                            }
                    }
                }
            }
            catch (Exception ex)
            {
                _notes.Add("Хурдасгах шүүлтүүр үүсгэж чадсангүй (" + ex.GetType().Name + ").");
                SmartLog.Warn("count", "slow_filter_build_failed", new { ex = ex.GetType().Name });
                return null;
            }

            if (filters.Count == 0) return null;
            return filters.Count == 1 ? filters[0] : new LogicalAndFilter(filters);
        }

        /// <summary>
        /// Параметрийн id нь БҮХ элемент дээр ижил байхыг баталгаажуулж чадах эсэх: built-in (id глобал), shared, эсвэл project parameter.
        /// Family-ийн өөрийн (shared биш) параметр нь family бүрт ӨӨР id-тай тул native шүүлтүүрт хэрэглэж БОЛОХГҮЙ.
        /// </summary>
        private static bool IsGlobalParameter(Document doc, Parameter p)
        {
            try
            {
                var def = p.Definition as InternalDefinition;
                if (def != null && def.BuiltInParameter != BuiltInParameter.INVALID) return true;
                if (p.IsShared) return true;
                return doc.GetElement(p.Id) is ParameterElement;
            }
            catch (Exception) { return false; }
        }

        private ElementFilter NumericFilter(Document doc, Element sample, NumericBound b)
        {
            // Нэг нэртэй хэд хэдэн параметр (built-in + shared) байвал аль нь «зөв» нь тодорхойгүй — түлхэхгүй (удаан ч үр дүн зөв).
            IList<Parameter> named = sample.GetParameters(b.Name);
            if (named == null || named.Count != 1) return null;
            Parameter p = named[0];
            if (p.StorageType != StorageType.Double || !IsGlobalParameter(doc, p)) return null;

            ForgeTypeId spec = p.Definition.GetDataType();
            if (!UnitUtils.IsMeasurableSpec(spec)) return null;

            ICollection<ForgeTypeId> valid = UnitUtils.GetValidUnits(spec);
            string family;
            ForgeTypeId canonical;
            if (valid.Contains(UnitTypeId.Millimeters)) { family = "length"; canonical = UnitTypeId.Millimeters; }
            else if (valid.Contains(UnitTypeId.SquareMeters)) { family = "area"; canonical = UnitTypeId.SquareMeters; }
            else if (valid.Contains(UnitTypeId.CubicMeters)) { family = "volume"; canonical = UnitTypeId.CubicMeters; }
            else if (valid.Contains(UnitTypeId.Degrees)) { family = "angle"; canonical = UnitTypeId.Degrees; }
            else return null;   // бусад хэмжигдэхүүнд хөрвүүлэлтгүй — түлхэхгүй

            ElementId pid = p.Id;
            var rules = new List<FilterRule>();
            const double eps = 1e-6;     // дотоод нэгжид (фут г.м.) — хүлцэл
            const double widen = 1e-5;   // суперсет: хил хэсэгт ойролцоо утгыг алдахгүй (дотоод нэгжээр)

            // Хязгаар бүрийг ӨӨРИЙН нэгжээр каноник руу хөрвүүлнэ (evaluator-ийн `TryTarget`-тай ижил), ДАРАА нь сольж харьцуулна.
            double? lo = null, hi = null;
            if (b.Min.HasValue)
            {
                double c;
                if (!UnitCatalog.ToCanonical(b.Min.Value, b.MinUnit, family, out c)) return null;
                lo = c;
            }
            if (b.Max.HasValue)
            {
                double c;
                if (!UnitCatalog.ToCanonical(b.Max.Value, b.MaxUnit, family, out c)) return null;
                hi = c;
            }
            if (lo.HasValue && hi.HasValue && hi.Value < lo.Value) { double t = lo.Value; lo = hi; hi = t; }   // `Between` — evaluator-той ижил

            // Тэлэлт нь evaluator-ийн `Close` хүлцлээс (каноник нэгжээр AbsTol + RelTol·|утга|) ХАМГИЙН БАГАДАА 2 дахин их — эс бөгөөс эзлэхүүн (фут³ ≪ м³)
            // болон талбайн хил дээрх утга evaluator-т таарч байхад native шүүлтүүрт хасагдана (суперсет БИШ).
            if (lo.HasValue)
            {
                double slack = 2 * QueryEvaluator.AbsTol + 2 * QueryEvaluator.RelTol * Math.Abs(lo.Value) + 1e-12;
                double internalMin = UnitUtils.ConvertToInternalUnits(lo.Value - slack, canonical) - widen;
                rules.Add(ParameterFilterRuleFactory.CreateGreaterOrEqualRule(pid, internalMin, eps));
            }
            if (hi.HasValue)
            {
                double slack = 2 * QueryEvaluator.AbsTol + 2 * QueryEvaluator.RelTol * Math.Abs(hi.Value) + 1e-12;
                double internalMax = UnitUtils.ConvertToInternalUnits(hi.Value + slack, canonical) + widen;
                rules.Add(ParameterFilterRuleFactory.CreateLessOrEqualRule(pid, internalMax, eps));
            }
            return rules.Count == 0 ? null : new ElementParameterFilter(rules);
        }

        /* ============================== RECORD ============================= */

        private ElementRecord BuildRecord(Document doc, Element e)
        {
            var r = new ElementRecord { ElementIdValue = e.Id.Value, UniqueId = e.UniqueId };

            try { Category c = e.Category; r.Category = c != null ? c.Name : null; } catch (Exception) { }

            // Төрөл: (id → family/name) тэмдэгт мөрийг л кэшлэнэ.  Амьд ElementType-ийг ЗӨВХӨН энэ дуудлагын дотор ашиглана (Step хооронд хадгалахгүй).
            long typeKey = TypeKeyOf(e);
            ElementType t = null;
            TypeInfo ti = null;
            if (typeKey != NoType && !_typeInfo.TryGetValue(typeKey, out ti))
            {
                t = LiveType(doc, e);
                ti = new TypeInfo { Exists = t != null };
                if (t != null)
                {
                    try { ti.Family = t.FamilyName; } catch (Exception) { }
                    try { ti.Name = t.Name; } catch (Exception) { }
                }
                _typeInfo[typeKey] = ti;
            }
            if (ti != null && ti.Exists) { r.Family = ti.Family; r.Type = ti.Name; }

            // Давхар = Element.LevelId (ElementLevelFilter-ийн «холбогдсон давхар»-тай ЯГ ижил тодорхойлолт —
            // сааталтай шүүлтүүр нь суперсет хэвээр байхын тулд параметрээр нөхөхгүй).
            try
            {
                ElementId lid = e.LevelId;
                if (lid != null && lid != ElementId.InvalidElementId) r.Level = LevelName(doc, lid);
            }
            catch (Exception) { }

            foreach (string name in _plan.ParamNames)
            {
                ParamValue pv = ReadNamed(e, name);
                if (pv.Exists) r.Params[name] = pv;

                if (ti != null && ti.Exists)
                {
                    string ck = typeKey + "|" + name;
                    ParamValue tv;
                    if (!_typeParamCache.TryGetValue(ck, out tv))
                    {
                        if (t == null) t = LiveType(doc, e);          // шинээр авна — өмнөх Step-ийн обьект ашиглахгүй
                        tv = t != null ? ReadNamed(t, name) : ParamValue.Missing;
                        _typeParamCache[ck] = tv;
                    }
                    if (tv.Exists) r.TypeParams[name] = tv;
                }
            }
            return r;
        }

        private const long NoType = long.MinValue;

        /// <summary>Төрлийн кэшийн түлхүүр: төрөл тоолж байвал элемент өөрөө, эс бөгөөс элементийн TypeId.  Төрөлгүй бол `NoType`.</summary>
        private long TypeKeyOf(Element e)
        {
            if (_q.CountTypes) return e is ElementType ? e.Id.Value : NoType;
            try
            {
                ElementId tid = e.GetTypeId();
                return tid == null || tid == ElementId.InvalidElementId ? NoType : tid.Value;
            }
            catch (Exception) { return NoType; }
        }

        /// <summary>Энэ дуудлагад л хэрэглэх АМЬД ElementType (кэшлэхгүй).</summary>
        private ElementType LiveType(Document doc, Element e)
        {
            try
            {
                if (_q.CountTypes) return e as ElementType;
                ElementId tid = e.GetTypeId();
                return tid == null || tid == ElementId.InvalidElementId ? null : doc.GetElement(tid) as ElementType;
            }
            catch (Exception) { return null; }
        }

        /// <summary>
        /// Нэртэй параметрийг ТОГТВОРТОЙ уншина.  `LookupParameter` нь ижил нэртэй хэд хэдэн параметр (built-in + shared/project) байвал
        /// «санамсаргүй нэгийг» буцаадаг тул `GetParameters`: нэг л бол тэр; олон бол утгатай нь эхэнд, дараа нь Id өсөхөөр — мөн
        /// «ойлгомжгүй нэр» гэж тэмдэглэж тайланд ИЛ хэлнэ.
        /// </summary>
        private ParamValue ReadNamed(Element e, string name)
        {
            IList<Parameter> ps;
            try { ps = e.GetParameters(name); } catch (Exception) { return ParamValue.Missing; }
            if (ps == null || ps.Count == 0) return ParamValue.Missing;
            if (ps.Count == 1) return _reader.Read(ps[0]);

            _ambiguousNames.Add(name);
            Parameter pick = ps.OrderByDescending(HasValueSafe).ThenBy(IdSafe).First();
            return _reader.Read(pick);
        }

        private static bool HasValueSafe(Parameter p)
        {
            try { return p.HasValue; } catch (Exception) { return false; }
        }

        private static long IdSafe(Parameter p)
        {
            try { return p.Id.Value; } catch (Exception) { return long.MaxValue; }
        }

        private string LevelName(Document doc, ElementId id)
        {
            string name;
            if (_levelNames.TryGetValue(id.Value, out name)) return name;
            Element lv = doc.GetElement(id);
            name = lv != null ? lv.Name : null;
            _levelNames[id.Value] = name;
            return name;
        }

        /* ============================== FINISH ============================= */

        private bool Finish(Document doc)
        {
            _timer.Begin("finish");
            CountResult res = _agg.Build();
            res.QueryId = _q.Id;
            res.QueryName = _q.Name;
            res.Candidates = _ids.Count;
            res.ComputedUtc = SmartClock.UtcNow;
            res.ModelStamp = _stampAtStart;
            res.Notes.AddRange(_notes.Distinct());       // collector дахин угсарсан (`RebuildQuick`, family шалгалт) үед ижил тэмдэглэл давхардахгүй
            if (_ambiguousNames.Count > 0)
                res.Notes.Add("⚠ «" + string.Join("», «", _ambiguousNames.OrderBy(n => n, StringComparer.CurrentCultureIgnoreCase).Take(5))
                    + "» нэртэй хэд хэдэн параметр олдсон (built-in/shared/project давхцсан) — утгатай эхнийг нь авлаа; нөхцөл өөр параметр дээр ажилласан байж болзошгүй.");
            if (_stats.Problems > 0)
                res.Notes.Add("⚠ " + _stats.Problems + " удаа нөхцөл шалгагдаж чадсангүй: " + string.Join("; ", _stats.ProblemNotes.Take(5)) + ".");
            if (res.RowsTruncated) res.Notes.Add("Мөрийн жагсаалт " + res.Rows.Count + "-аар хязгаарлагдсан; нийт тоо ба бүлгийн тоо ЯГ.");
            if (ModelChangeCounter.Stamp(doc) != _stampAtStart) res.Notes.Add("Тооцоолох явцад загвар өөрчлөгдсөн — үр дүн дахин шалгах хэрэгтэй.");
            res.StageMs = _timer.Snapshot();
            Result = res;
            return true;
        }

        private void Report(string message, int done, int total)
        {
            if (_progress != null) _progress.Report(JobProgress.Of("scan", done, total, message));
        }
    }
}
