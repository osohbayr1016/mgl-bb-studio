using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Revit
{
    /// <summary>
    /// Цөмийн <see cref="WeAnnotationPlan"/>-ийг Revit-д хэрэгжүүлнэ: лавлагаа (түвшний хавтгай, шал/таазны нүүр, хаалга/цонхны
    /// reference plane, ханын зах) олж хэмжээс, spot level, шошго, keynote үүсгэнэ.  Шинэчлэхэд ЗӨВХӨН өмнө ӨӨРӨӨ тавьсныг
    /// (<see cref="WeAnnoStore"/>) устгаж дахин тавина.  Нэг transaction; Revit-ийн алдаатай гэж үзсэн (зөвхөн энэ ажиллагаанд үүссэн)
    /// элементийг устгаад үргэлжилнэ — нэг муу хэмжээс бусдыг буцаахгүй.
    /// </summary>
    internal sealed class WeAnnotator
    {
        private readonly Document _doc;
        private readonly WeResources _res;
        private readonly WeSettings _s;
        private readonly IWeUnits _u;
        private readonly HashSet<string> _notes = new HashSet<string>(StringComparer.Ordinal);
        private readonly Dictionary<string, ElementId> _tagTypes = new Dictionary<string, ElementId>(StringComparer.Ordinal);
        private readonly Options _geo = new Options { ComputeReferences = true, DetailLevel = ViewDetailLevel.Fine, IncludeNonVisibleObjects = false };
        private DimensionType _dimType;
        private ElementId _spotType = ElementId.InvalidElementId;
        private ElementId _keynoteType = ElementId.InvalidElementId;
        private int _emptyKeynotes;
        /// <summary>Одоогийн дэлгээст ХАРАГДАЖ буй элементүүд (crop, гүн, discipline, VG, view template-ийн дараа).</summary>
        private HashSet<long> _visible;
        /// <summary>Энэ харагдацад keynote-оор тэмдэглэсэн өнгөлгөөний элемент — материалын бичвэр тэдгээрт давхардахгүй.</summary>
        private readonly HashSet<long> _finishKeynoted = new HashSet<long>();
        /// <summary>Үүсгэсэн хэмжээс → «харагдац: эгнээ [лавлагаа]» — Revit алдаагаар устгахад логт аль эгнээ болохыг хэлнэ.</summary>
        private readonly Dictionary<long, string> _what = new Dictionary<long, string>();
        /// <summary>Харагдахгүй тул тэмдэглэгээ тавиагүй элементийн ангиллууд (дараалал хадгална).</summary>
        private readonly List<string> _hidden = new List<string>();
        private string _viewName;
        private BoundingBoxXYZ _crop;
        private readonly List<string> _missingTagFamilies = new List<string>();
        private readonly List<string> _wallsHiddenIn = new List<string>();

        public WeAnnotator(Document doc, WeResources res, WeSettings s, IWeUnits u)
        {
            _doc = doc; _res = res; _s = s; _u = u;
        }

        public void Run(List<WeRunItem> items, WeRunResult result)
        {
            RunItems(items, result);
            Flush(result);
        }

        /// <summary>
        /// Дэлгээс(үүд)-ийн тэмдэглэгээ — НЭГ transaction.  Арын горимд дэлгээс тус бүр өөрийн алхам; ерөнхий тэмдэглэлийг (нуугдсан ангилал,
        /// дутуу family …) бүгд дууссаны дараа НЭГ удаа <see cref="Flush"/>.
        /// </summary>
        public void RunItems(List<WeRunItem> items, WeRunResult result)
        {
            if (items.Count == 0) return;
            var created = new HashSet<long>();
            using (var t = new Transaction(_doc, "Ханын дэлгээс — тэмдэглэгээ"))
            {
                var handler = new WeAnnoFailures(created, _what);
                FailureHandlingOptions o = t.GetFailureHandlingOptions();
                o.SetFailuresPreprocessor(handler);
                o.SetClearAfterRollback(true);
                t.SetFailureHandlingOptions(o);
                t.Start();
                ResolveTypes();
                var perView = new List<KeyValuePair<WeRunItem, List<ElementId>>>();
                foreach (WeRunItem w in items)
                {
                    var v = _doc.GetElement(w.ViewId) as View;
                    if (v == null) continue;
                    try
                    {
                        List<ElementId> old = WeAnnoStore.Previous(_doc, v);
                        if (old.Count > 0)
                        {
                            _doc.Delete(old);
                            result.AnnoRemoved += old.Count;
                        }
                        var ids = new List<ElementId>();
                        WeAnnotationPlan plan = w.Plan.Annotation ?? new WeAnnotationPlan();
                        _visible = VisibleIn(v);
                        _finishKeynoted.Clear();
                        _finishNotes.Clear();
                        _viewName = v.Name;
                        _crop = null;
                        try { if (v.CropBoxActive) _crop = v.CropBox; } catch { }
                        CheckWallVisible(v, w.Plan);
                        if (!plan.IsEmpty) Annotate(v, w, plan, ids, result);
                        if (_s.MaterialNotes || _finishNotes.Count > 0) MaterialNotes(v, w.Plan, ids, result);
                        // Тод/бүдэг хэсэг, улаан хүрээ — ХАМГИЙН СҮҮЛД (бусад detail элементийн дээр; хүрээ нь бүдэг давхаргын дээр).
                        Decorate(v, w.Plan, plan, ids);
                        foreach (ElementId id in ids) created.Add(id.Value);
                        WeAnnoStore.Write(_doc, v, ids);
                        // W01: тэмдэглэгээ ЭНЭ transaction-д тавигдсан — бүтэн тэмдэг (commit унавал хамт буцна → дараагийн удаа дахин тавина).
                        GeneratedElevationRepository.SetSignature(v, w.Plan.Signature);
                        perView.Add(new KeyValuePair<WeRunItem, List<ElementId>>(w, ids));
                    }
                    catch (Exception ex)
                    {
                        WeLog.Error("annotate", v.Name, ex);
                        w.Message = Append(w.Message, "тэмдэглэгээ: " + ex.Message);
                    }
                }
                TransactionStatus ts = t.Commit();
                result.WarningsHidden += handler.WarningsHidden;
                if (ts != TransactionStatus.Committed)
                {
                    result.Notes.Add("Тэмдэглэгээг Revit буцаав: " + (handler.LastError ?? ts.ToString()) + " — харагдацууд хэвээр.");
                    result.AnnoDims = result.AnnoSpots = result.AnnoTags = result.AnnoKeynotes = 0;
                    return;
                }
                // Commit-ийн үед Revit алдаатай гэж устгасан элементийг тоолуураас хасна (тайлан бодит үр дүнтэй таарна).
                foreach (KeyValuePair<WeRunItem, List<ElementId>> kv in perView)
                {
                    int gone = kv.Value.Count(id => _doc.GetElement(id) == null);
                    if (gone > 0)
                    {
                        result.AnnoFailed += gone;
                        kv.Key.Message = Append(kv.Key.Message, gone + " тэмдэглэгээг Revit хүчингүй гэж хасав");
                    }
                }
                result.AnnoDims -= handler.RemovedDims;
                result.AnnoSpots -= handler.RemovedSpots;
                result.AnnoTags -= handler.RemovedTags;
            }
        }

        /// <summary>Хуримтлагдсан ерөнхий тэмдэглэлийг тайланд (нэг удаа).</summary>
        public void Flush(WeRunResult result)
        {
            if (_wallsHiddenIn.Count > 0)
                result.Notes.Add(WallsHiddenNote(_wallsHiddenIn));
            List<string> hiddenElems = _hidden.Where(h => h != LevelLabel).ToList();
            if (hiddenElems.Count > 0)
                result.Notes.Add(string.Join(", ", hiddenElems) + " энэ дэлгээст харагдахгүй (view template, discipline эсвэл Visibility/Graphics нуусан) — "
                                 + "тэдгээрт хэмжээс, spot level, шошго тавиагүй.");
            if (_hidden.Contains(LevelLabel))
                result.Notes.Add("Түвшин (level) зарим дэлгээст харагдахгүй — түвшний шугамын хүрээ (extent) энэ хэсэгт хүрэхгүй эсвэл нуусан тул "
                                 + "давхар хоорондын хэмжээс тавиагүй.  Түвшний үзүүрийг өөр дэлгээс/зүсэлтээс энэ хэсэг хүртэл сунгаад дахин ажиллуулна уу.");
            if (_missingTagFamilies.Count > 0)
                result.Notes.Add("Шошгоны family загварт ачаалаагүй тул шошго тавиагүй: " + string.Join(", ", _missingTagFamilies)
                                 + " (Insert → Load Family → Annotations).");
            if (_multiTagFallback.Count > 0)
                result.Notes.Add("Ангиллын шошго ачаалаагүй тул Multi-Category шошгоор тавив: " + string.Join(", ", _multiTagFallback) + ".");
            if (_emptyKeynotes > 0)
                _notes.Add(_emptyKeynotes + " элементийн төрөлд Keynote утга хоосон — keynote нь «?» эсвэл хоосон харагдана (Type Properties → Keynote).");
            result.Notes.AddRange(_notes);
            _notes.Clear();
            _wallsHiddenIn.Clear();
            _hidden.Clear();
            _missingTagFamilies.Clear();
            _multiTagFallback.Clear();
            _emptyKeynotes = 0;
        }

        // ── Харагдах эсэх ───────────────────────────────────────────

        /// <summary>
        /// Дэлгээст бодитоор харагдах элементүүд.  Revit нь нуугдсан элементийн лавлагаатай хэмжээс, spot, шошгыг ХАРУУЛДАГГҮЙ
        /// (элемент нь үүсдэг ч цаасан дээр гарахгүй) — тиймээс тийм лавлагааг урьдчилан алгасаж, хэрэглэгчид шалтгааныг хэлнэ.
        /// Харагдацын гүн нимгэн (ойролцоо 1 м) тул нэг collector хангалттай хурдан.
        /// </summary>
        private HashSet<long> VisibleIn(View v)
        {
            try
            {
                return new HashSet<long>(new FilteredElementCollector(_doc, v.Id).WhereElementIsNotElementType().ToElementIds().Select(id => id.Value));
            }
            catch (Exception ex)
            {
                WeLog.Info("annotate", v.Name + ": харагдах элемент уншиж чадсангүй — " + ex.Message);
                return null;   // мэдэхгүй бол бүгдийг харагдана гэж үзнэ
            }
        }

        /// <summary>
        /// Элементийн хатуу бие бүхэлдээ харах хавтгайн ӨМНӨ эсвэл far clip-ийн ЦААНА уу (family instance — шалгахгүй, false).  ХЭМЖСЭН (sheet2): пилястрын урд хана
        /// холболтоор хавтгайгаас 2 мм өмнө дуусдаг — Revit зөв нууна, «template нуусан» гэж анхааруулах нь худал.
        /// </summary>
        private bool OutsideDepth(ElementId id)
        {
            // ХЭМЖСЭН: ханын bbox нь холболтын өмнөх бүтэн уртыг (3600 + зузаан) хамардаг — бодит хатуу биеийн оройгоор шалгана
            // (зөвхөн харагдахгүй лавлагаанд, ховор).
            try
            {
                Element e = _doc.GetElement(id);
                if (e == null || _crop == null) return false;
                Transform inv = _crop.Transform.Inverse;
                double tol = 1.0 / 304.8;
                bool any = false, allFront = true, allBack = true;
                foreach (Element src in FaceSources(e))
                {
                    GeometryElement ge = src.get_Geometry(_geo);
                    if (ge == null) continue;
                    foreach (GeometryObject go in ge)
                    {
                        var solid = go as Solid;
                        if (solid == null || solid.Edges.Size == 0) continue;
                        foreach (Edge edge in solid.Edges)
                            foreach (XYZ q in edge.Tessellate())
                            {
                                any = true;
                                double lz = inv.OfPoint(q).Z;
                                if (lz < _crop.Max.Z - tol) allFront = false;
                                if (lz > _crop.Min.Z + tol) allBack = false;
                            }
                    }
                }
                return any && (allFront || allBack);
            }
            catch { return false; }
        }

        private static string Fmt(XYZ p) { return Math.Round(p.X * 304.8) + "," + Math.Round(p.Y * 304.8); }

        private bool Visible(ElementId id) { return _visible == null || id == null || _visible.Contains(id.Value); }

        /// <summary>Лавлагааны элемент харагдахгүй бол ангиллыг тэмдэглээд false.</summary>
        private bool VisibleOrNote(ElementId id)
        {
            if (Visible(id)) return true;
            string label = CategoryLabel(_doc.GetElement(id));
            if (OutsideDepth(id))
            {
                // Харах гүнээс гадуур (хавтгайн өмнө эсвэл far clip-ийн цаана) — дэлгээсийн зориулалтаар харагдахгүй; анхааруулга биш.
                WeLog.Info("annotate", (_viewName ?? "?") + ": " + label + " #" + id.Value + " харах гүнээс гадуур — алгасав");
                return false;
            }
            if (!_hidden.Contains(label)) _hidden.Add(label);
            string where = string.Empty;
            try
            {
                var lc = _doc.GetElement(id)?.Location as LocationCurve;
                if (lc != null) where = " (" + Fmt(lc.Curve.GetEndPoint(0)) + " → " + Fmt(lc.Curve.GetEndPoint(1)) + ")";
            }
            catch { }
            WeLog.Info("annotate", (_viewName ?? "?") + ": " + label + " #" + id.Value + where + " харагдахгүй — лавлагааг алгасав");
            return false;
        }

        private void CheckWallVisible(View v, WePlannedElevation p)
        {
            if (_visible == null || string.IsNullOrEmpty(p.WallUid)) return;
            Element wall = _doc.GetElement(p.WallUid);
            if (wall == null || Visible(wall.Id)) return;
            string why = string.Empty;
            try { if (v.Discipline == ViewDiscipline.Structural) why = "Structural"; } catch { }
            _wallsHiddenIn.Add(v.Name + (why.Length > 0 ? " (discipline: " + why + ")" : string.Empty));
        }

        private static string WallsHiddenNote(List<string> views)
        {
            string list = views.Count <= 3 ? string.Join(", ", views) : string.Join(", ", views.Take(3)) + " … (" + views.Count + ")";
            return "Хана дэлгээст харагдахгүй байна: " + list + ".  Харагдацын төрлийн өгөгдмөл view template эсвэл discipline ханыг нуусан — "
                   + "архитектурын template (жишээ нь «Architectural Section») сонгоод дахин ажиллуулна уу.";
        }

        private const string LevelLabel = "Түвшин (level)";

        private static string CategoryLabel(Element e)
        {
            if (e == null || e.Category == null) return "Элемент";
            long c = e.Category.Id.Value;
            if (c == (long)BuiltInCategory.OST_Walls) return Label(WeAnno.Walls);
            if (c == (long)BuiltInCategory.OST_Doors) return Label(WeAnno.Doors);
            if (c == (long)BuiltInCategory.OST_Windows) return Label(WeAnno.Windows);
            if (c == (long)BuiltInCategory.OST_Ceilings) return Label(WeAnno.Ceilings);
            if (c == (long)BuiltInCategory.OST_Floors) return Label(WeAnno.Floors);
            if (c == (long)BuiltInCategory.OST_Levels) return LevelLabel;
            if (c == (long)BuiltInCategory.OST_Grids) return Label(WeAnno.Grids);
            foreach (KeyValuePair<string, BuiltInCategory> kv in WeRevitCategories.Others)
                if (c == (long)kv.Value) return kv.Key == WeAnno.Electrical || kv.Key == WeAnno.Finishes ? e.Category.Name : Label(kv.Key);
            return e.Category.Name;
        }

        // ── Төрлүүд ──────────────────────────────────────────────────

        private void ResolveTypes()
        {
            if (!string.IsNullOrEmpty(_s.DimTypeName))
            {
                _dimType = _res.DimTypes.FirstOrDefault(t => string.Equals(t.Name, _s.DimTypeName, StringComparison.Ordinal));
                if (_dimType == null) _notes.Add("Сонгосон хэмжээсийн төрөл «" + _s.DimTypeName + "» олдсонгүй — төслийн өгөгдмөлөөр.");
            }
            if (!string.IsNullOrEmpty(_s.SpotTypeName))
            {
                SpotDimensionType st = _res.SpotTypes.FirstOrDefault(t => string.Equals(t.Name, _s.SpotTypeName, StringComparison.Ordinal));
                // 2026-10-14 (интерьерийн баг): сонгосон төрөл ч ДАВХРААС тоолно (шал ±0.00) — төслийн суурьтай бол хувилбарыг нь.
                if (st != null) _spotType = RelativeVariant(st);
                else _notes.Add("Сонгосон spot level-ийн төрөл «" + _s.SpotTypeName + "» олдсонгүй — өгөгдмөлөөр.");
            }
            if (_spotType == ElementId.InvalidElementId && _relativeSpot == null) _relativeSpot = RelativeSpotType();
            FamilySymbol kn = _res.ResolveKeynoteType(_s);
            if (kn != null)
            {
                if (!kn.IsActive) kn.Activate();
                _keynoteType = kn.Id;
            }
        }

        /// <summary>Хэрэгслийн spot төрөл: өгөгдмөл spot-ийн хувилбар, өндрийн суурь = «Relative» (давхраас).</summary>
        public const string RelativeSpotTypeName = "MGL — Spot (давхраас)";
        private ElementId _relativeSpot;

        /// <summary>
        /// Жишээ хуудас 206A-G: spot level ДАВХРААС харьцангуй («0,00» шал, «2,20» хаалганы дээд, «2,70» тааз).  ХЭМЖСЭН (GATEWAY): загварын
        /// цорын ганц spot төрөл «Project Base Point»-оос («20,10») — тиймээс тохиргоонд төрөл сонгоогүй үед өгөгдмөлийг хувилж суурийг
        /// Relative болгоно (хэрэглэгчийн төрлийг хөндөхгүй); spot бүрийн «Relative Base» = өрөөний давхар.
        /// </summary>
        private ElementId RelativeSpotType()
        {
            try
            {
                SpotDimensionType t = new FilteredElementCollector(_doc).OfClass(typeof(SpotDimensionType)).Cast<SpotDimensionType>()
                    .FirstOrDefault(x => x.Name == RelativeSpotTypeName);
                if (t == null)
                {
                    var baseType = _doc.GetElement(_doc.GetDefaultElementTypeId(ElementTypeGroup.SpotElevationType)) as SpotDimensionType
                                   ?? _res.SpotTypes.FirstOrDefault();
                    if (baseType == null) return ElementId.InvalidElementId;
                    t = (SpotDimensionType)baseType.Duplicate(RelativeSpotTypeName);
                    _res.SpotTypes.Add(t);
                }
                Parameter b = t.get_Parameter(BuiltInParameter.SPOT_ELEV_BASE);
                if (b != null && !b.IsReadOnly && b.AsInteger() != SpotBaseRelative) b.Set(SpotBaseRelative);
                if (IsRelative(t)) _relativeTypes.Add(t.Id.Value);
                return t.Id;
            }
            catch (Exception ex)
            {
                WeLog.Info("annotate", "харьцангуй spot төрөл — " + ex.Message);
                return ElementId.InvalidElementId;
            }
        }

        /// <summary>Давхраас тоолох (Relative) spot төрлүүд — эдгээрийн spot бүрд «Relative Base» тавина.</summary>
        private readonly HashSet<long> _relativeTypes = new HashSet<long>();
        public const string RelativeSuffix = " (давхраас)";

        private static bool IsRelative(SpotDimensionType t)
        {
            try
            {
                Parameter b = t != null ? t.get_Parameter(BuiltInParameter.SPOT_ELEV_BASE) : null;
                return b != null && b.AsInteger() == SpotBaseRelative;
            }
            catch { return false; }
        }

        /// <summary>
        /// Хэрэглэгчийн сонгосон spot төрөл төслийн суурь (Project/Survey)-аас тоолдог бол «‹нэр› (давхраас)» хувилбарыг (Elevation Base =
        /// Relative) хувилж хэрэглэнэ — төрлийн бусад тохиргоо (тэмдэг, бичвэр, нэгж) хэвээр, хэрэглэгчийн төрөл хөндөгдөхгүй.
        /// </summary>
        private ElementId RelativeVariant(SpotDimensionType t)
        {
            if (t == null) return ElementId.InvalidElementId;
            try
            {
                if (IsRelative(t)) { _relativeTypes.Add(t.Id.Value); return t.Id; }
                string name = t.Name + RelativeSuffix;
                SpotDimensionType v = new FilteredElementCollector(_doc).OfClass(typeof(SpotDimensionType)).Cast<SpotDimensionType>()
                    .FirstOrDefault(x => x.Name == name);
                if (v == null)
                {
                    v = (SpotDimensionType)t.Duplicate(name);
                    _res.SpotTypes.Add(v);
                }
                Parameter b = v.get_Parameter(BuiltInParameter.SPOT_ELEV_BASE);
                if (b == null || b.IsReadOnly)
                {
                    _notes.Add("Spot level-ийн төрөл «" + t.Name + "»-ийн «Elevation Base»-ийг өөрчилж чадсангүй — түвшин давхраас биш тоологдож магадгүй.");
                    return t.Id;
                }
                if (b.AsInteger() != SpotBaseRelative) b.Set(SpotBaseRelative);
                _relativeTypes.Add(v.Id.Value);
                if (_relativeNoted.Add(t.Id.Value))
                    WeLog.Info("annotate", "spot төрөл «" + t.Name + "» → «" + name + "» (давхраас, " + b.AsValueString() + ")");
                return v.Id;
            }
            catch (Exception ex)
            {
                WeLog.Info("annotate", "spot төрлийн давхраас хувилбар «" + t.Name + "» — " + ex.Message);
                return t.Id;
            }
        }

        private readonly HashSet<long> _relativeNoted = new HashSet<long>();

        /// <summary>SPOT_ELEV_BASE: 0 = Project Base Point, 1 = Survey Point, 2 = Relative.</summary>
        private const int SpotBaseRelative = 2;

        /// <summary>
        /// Шошгоны төрөл: элементийн ӨӨРИЙН ангиллын шошго (цахилгаан цэг: розетк → Electrical Fixture Tag …), эсвэл мөрийн ангиллын
        /// шошго; аль нь ч загварт ачаалаагүй бол Multi-Category шошго (интерьерийн төсөлд ихэвчлэн ганц «ЗТ-05 / Роз-1» маягийн
        /// Type Mark шошго ачаалагддаг).  Аль нь ч байхгүй бол тэмдэглэлээр хэлнэ.
        /// </summary>
        private ElementId TagTypeFor(Element e, string key)
        {
            BuiltInCategory cat;
            bool own = WeRevitCategories.TagCategoryOf(e, out cat);
            if (!own && !WeRevitCategories.TagCategory(key, out cat)) cat = BuiltInCategory.INVALID;
            string cacheKey = own ? "cat:" + (int)cat : key;
            ElementId id;
            if (_tagTypes.TryGetValue(cacheKey, out id)) return id;
            id = cat != BuiltInCategory.INVALID ? DefaultTagType(cat) : ElementId.InvalidElementId;
            if (id == ElementId.InvalidElementId)
            {
                id = DefaultTagType(BuiltInCategory.OST_MultiCategoryTags);
                if (id != ElementId.InvalidElementId && !_multiTagFallback.Contains(Label(key))) _multiTagFallback.Add(Label(key));
            }
            if (id == ElementId.InvalidElementId && !_missingTagFamilies.Contains(Label(key)))
                _missingTagFamilies.Add(Label(key));
            _tagTypes[cacheKey] = id;
            return id;
        }

        private readonly List<string> _multiTagFallback = new List<string>();

        private ElementId DefaultTagType(BuiltInCategory cat)
        {
            ElementId id = ElementId.InvalidElementId;
            try
            {
                ElementId def = _doc.GetDefaultFamilyTypeId(new ElementId(cat));
                if (def != null && def != ElementId.InvalidElementId && _doc.GetElement(def) is FamilySymbol) id = def;
            }
            catch { /* энэ ангилалд өгөгдмөлгүй */ }
            if (id == ElementId.InvalidElementId)
            {
                try
                {
                    Element first = new FilteredElementCollector(_doc).OfCategory(cat).WhereElementIsElementType().FirstElement();
                    if (first != null) id = first.Id;
                }
                catch { }
            }
            var fs = _doc.GetElement(id) as FamilySymbol;
            if (fs != null && !fs.IsActive) { try { fs.Activate(); } catch { } }
            return id;
        }

        // ── Нэг дэлгээс ─────────────────────────────────────────────

        private void Annotate(View v, WeRunItem w, WeAnnotationPlan plan, List<ElementId> ids, WeRunResult result)
        {
            WePlannedElevation p = w.Plan;
            int failed = 0;
            var inner = new List<Element>();   // дэлгээсний ДОТОРХ хэмжээс (цахилгаан цэг) — шошго түүн дээр давхцахгүй
            var singles = new List<double>();   // нэг сегменттэй хэвтээ хэмжээсийн утга (давхардал)
            foreach (WeDimRow row in plan.Rows)
            {
                string err;
                bool skipped;
                Dimension d = CreateRow(v, p, row, out err, out skipped);
                ids.AddRange(_anchorIds);
                _anchorIds.Clear();
                // Гинжийн дунд лавлагаа захтай ижил нүүр болж хоёр лавлагаатай үлдвэл нийт урттай ДАВХАРДАНА (ХЭМЖСЭН MITIC 227D «2150 / 2150»).
                if (d != null && !row.Vertical && row.Group != WeDimGroup.PointPosition)
                {
                    double val = double.NaN;
                    try { if (d.NumberOfSegments == 0 && d.Value.HasValue) val = d.Value.Value; } catch { }
                    if (!double.IsNaN(val))
                    {
                        if (singles.Any(x => Math.Abs(x - val) < Mm(1)))
                        {
                            try { _doc.Delete(d.Id); } catch { }
                            continue;
                        }
                        singles.Add(val);
                    }
                }
                if (d != null && (row.Group == WeDimGroup.PointHeight || row.Group == WeDimGroup.PointPosition)) inner.Add(d);
                if (d != null) { ids.Add(d.Id); result.AnnoDims++; }
                else if (!skipped)
                {
                    failed++;
                    WeLog.Info("annotate", v.Name + ": " + row.What + " — " + err);
                }
            }
            foreach (WeSpot sp in plan.Spots)
            {
                string err;
                bool skipped;
                SpotDimension sd = CreateSpot(v, p, sp, out err, out skipped);
                if (sd != null) { ids.Add(sd.Id); result.AnnoSpots++; }
                else if (!skipped)
                {
                    failed++;
                    WeLog.Info("annotate", v.Name + ": spot " + sp.What + " — " + err);
                }
            }
            FlushPendingBase(v);
            var made = new List<KeyValuePair<IndependentTag, WeTagItem>>();
            foreach (WeTagItem t in plan.Tags)
            {
                // Keynote — бүгд бичвэрээр (QueueKeynote): API нь элементийн keynote үүсгэж чаддаггүй.
                if (t.Keynote) { QueueKeynote(p, t); continue; }
                bool skipped;
                IndependentTag tag = CreateTag(v, p, t, out skipped);
                if (tag != null)
                {
                    ids.Add(tag.Id);
                    made.Add(new KeyValuePair<IndependentTag, WeTagItem>(tag, t));
                    if (t.Keynote) result.AnnoKeynotes++; else result.AnnoTags++;
                    if (t.Keynote && t.CategoryKey == WeAnno.Finishes) _finishKeynoted.Add(t.ElementId);
                }
                else if (!skipped) failed++;
            }
            SpreadTags(v, p, made, inner);
            if (!double.IsNaN(plan.OuterVerticalX)) ExtendLevelHeads(v, p, plan.OuterVerticalX + Paper(4));
            // Дэлгээс бүрийн мөрөнд бичихгүй (27 мөрөнд давтагдаж тайланг дардаг байв) — нийт тоо нэг удаа, дэлгэрэнгүй нь логт.
            if (failed > 0) result.AnnoFailed += failed;
            foreach (string n in plan.Notes) _notes.Add(n);
        }

        // ── Материалын тэмдэглэл ────────────────────────────────────

        /// <summary>Нэг материалын тэмдэглэл: бичвэр ба заагчийн төгсгөл (дэлгээсний дотоод X, Y) — тухайн материалын хамгийн өргөн чөлөөт хэсэгт.</summary>
        private sealed class MatNote
        {
            public string Text;
            public double EndX;
            public double EndY;
            public double Span;
            /// <summary>Заагчийн төгсгөлийн саадаас/нүүрний захаас зай; 0 = хана бүхэлдээ далд (тэмдэглэл тавихгүй).</summary>
            public double Score = 1;
            /// <summary>Өнгөлгөөний keynote (элементийн төрлийн Keynote утга) — материалын нэрээс түрүүлнэ.</summary>
            public bool Keynote;
            /// <summary>Дэлгээсний ДООР (шалны хүрээ); <see cref="BaseY"/> = эхний мөрийн бичвэрийн дээд.</summary>
            public bool Below;
            public double BaseY;
        }

        private readonly List<MatNote> _finishNotes = new List<MatNote>();

        /// <summary>
        /// Өнгөлгөөний keynote-ийг БИЧВЭРЭЭР (заагчтай) — Revit API элементийн keynote-ийн «Key Source»-ийг тогтоох боломжгүй (ХЭМЖСЭН
        /// MITIC 215, Revit 2024: KEY_SOURCE_PARAM зөвхөн уншигдах, IndependentTag.Create нь хоосон keynote «?» үүсгэдэг).  Жишиг keynote
        /// «Key-Түлхүүр,Тайлбар_BIMon» нь Key Value-г л харуулдаг тул ижил бичвэр.  Утга хоосон бол алгасна (материалын нэр нөхнө).
        /// </summary>
        private void QueueKeynote(WePlannedElevation p, WeTagItem t)
        {
            Element e = _doc.GetElement(new ElementId(t.ElementId));
            if (e == null || !VisibleOrNote(e.Id)) return;
            string text = KeynoteValue(e);
            if (string.IsNullOrWhiteSpace(text))
            {
                // Өнгөлгөөнийх — материалын нэр нөхнө; бусад ангилалд (хэрэглэгч keynote сонгосон) утга хоосныг тайланд хэлнэ.
                if (t.CategoryKey != WeAnno.Finishes) _emptyKeynotes++;
                return;
            }
            _finishNotes.Add(new MatNote
            {
                Text = text.Trim(), EndX = t.AnchorX, EndY = t.AnchorY, Span = double.MaxValue, Keynote = true,
                Below = p.Box != null && t.HeadY < p.Box.MinY, BaseY = t.HeadY,
            });
            if (t.CategoryKey == WeAnno.Finishes) _finishKeynoted.Add(t.ElementId);
        }

        private string KeynoteValue(Element e)
        {
            try
            {
                Element type = e.Document.GetElement(e.GetTypeId());
                Parameter pr = type != null ? type.get_Parameter(BuiltInParameter.KEYNOTE_PARAM) : null;
                string v = pr != null && pr.HasValue ? pr.AsString() : null;
                if (string.IsNullOrWhiteSpace(v)) { pr = e.get_Parameter(BuiltInParameter.KEYNOTE_PARAM); v = pr != null && pr.HasValue ? pr.AsString() : null; }
                return v;
            }
            catch { return null; }
        }

        /// <summary>Дэлгээст харагдах элемент (энэ баримтынх эсвэл link-ийнх) — дэлгээсний дотоод тэгш өнцөгт ба гүн.</summary>
        private sealed class Occluder
        {
            public double X0, Y0, X1, Y1, Z0, Z1;
            public Element E;
            public Transform Tf;
            public double[] R { get { return new[] { X0, Y0, X1, Y1 }; } }
            // ⚠️ Element.Document нь дуудлага бүрд ШИНЭ wrapper — ReferenceEquals үргэлж худал (хэмжсэн: хана өөрөө өөрийнхөө саад болж байв).
            public bool Same(Element e) { return e != null && E != null && e.Id == E.Id && e.Document.Equals(E.Document); }
        }

        /// <summary>
        /// Жишээ хуудас 205A-F / 206A-G: дэлгээсний ДЭЭР материалын бичвэр («УЛААН ГОЁЛЫН ХАВТАН», «ШИЛЭН ХАНА»), заагч нь БОСОО доош
        /// сумтайгаар тэр материалын гадаргуу дээр, бичвэр заагчийн хажууд богино мөртэй.  ХЭМЖСЭН гажиг (GATEWAY 310, 2026-10-07): (1) link-ийн
        /// англи нэр «CONCRETE, CAST-IN-PLACE, GRAY», BIMon нэр «ХАВТАН+ГИПСЭН» шууд хэвлэгдсэн → <see cref="WeMaterialLabel"/>; (2) ташуу урт
        /// заагч, 310G-д хоёр бичвэр давхарлаж заагчууд огтлолцсон → <see cref="WeNoteLayout"/> (мөр, тал, огтлолцолгүй); (3) шилэн (curtain)
        /// хананд тэмдэглэл огт байгаагүй → «ШИЛЭН ХАНА»; (4) заагч хаалга/цонхон дээр буух → хамгийн өргөн чөлөөт хэсэгт.  Бичвэрийн төрөл:
        /// төслийн хамгийн их хэрэглэгддэг СУМТАЙ 1.8–2.5 мм төрөл (<see cref="NoteTextType"/>).  Ялгаатай материал бүрд НЭГ тэмдэглэл.
        /// </summary>
        private void MaterialNotes(View v, WePlannedElevation p, List<ElementId> ids, WeRunResult result)
        {
            if (p.Frame == null || p.Box == null) return;
            WeFrame f = p.Frame;
            double scale = Math.Max(1, v.Scale);
            Func<double, double> paper = mm => _u.MmToInternal(mm * scale);
            var found = new List<MatNote>(_finishNotes);
            // Өнгөлгөөний хана keynote-той бол (интерьер) ард нь буй талын хана — суурь, жишигт тэмдэглэгддэггүй (MITIC 215: «ГИПСЭН ХАВТАН» илүүдэл).
            if (_s.MaterialNotes && p.WallUids != null && p.WallUids.Count > 0)
                found.AddRange(DiscoverMaterialNotes(v, p, f, paper, _finishNotes.Any(n => !n.Below)));
            if (found.Count == 0) return;
            // Ижил бичвэр — keynote эхэлж, дараа нь хамгийн өргөн чөлөөт хэсэгтэй нь.
            List<MatNote> notes = found.GroupBy(n => n.Text, StringComparer.OrdinalIgnoreCase)
                                       .Select(g => g.OrderByDescending(n => n.Keynote).ThenByDescending(n => n.Span).First()).ToList();
            TextNoteType tt = NoteTextType();
            if (tt == null) return;
            PlaceNotes(v, p, f, tt, scale, paper, notes.Where(n => !n.Below).ToList(), false, ids, result);
            PlaceNotes(v, p, f, tt, scale, paper, notes.Where(n => n.Below).ToList(), true, ids, result);
        }

        private List<MatNote> DiscoverMaterialNotes(View v, WePlannedElevation p, WeFrame f, Func<double, double> paper, bool skipSides)
        {
            var found = new List<MatNote>();
            XYZ vd = f.ViewDirection.ToXyz();
            List<Occluder> occ = ViewOccluders(v, f, p.Box);
            double tol = _u.MmToInternal(20);
            // Интерьер (MITIC 215, 2026-10-08): 3–25 мм өнгөлгөөний хана (IW_DSP WALL PANEL 3мм) ханан дээр наалдсан — 20 мм-ийн хүлцэлд
            // тэд «өмнө» гэж тоологдохгүй тул ард нь далдлагдсан link-ийн ханын «ГИПСЭН ХАВТАН» гарч байв.  Өмнөх/далдлах шалгалтад 1 мм.
            double thin = _u.MmToInternal(1);
            // Тэмдэглэх хана: талын хана(ууд) + тэдгээрийн ӨМНӨ харагдах параллель хана (link-ийнх ч — ХЭМЖСЭН GATEWAY 310F: бүтцийн link-ийн
            // лифтний бетон хана гипсэн ханыг бүрэн далдалсан тул «ГИПСЭН ХАВТАН» буруу, харагдаж буй нь бетон).
            var subjects = new List<KeyValuePair<Wall, Transform>>();
            foreach (string uid in p.WallUids)
            {
                Wall w = null;
                Transform tf = Transform.Identity;
                RevitLinkInstance li;
                Element le;
                if (WeLinkRef.TryResolve(_doc, uid, out li, out le)) { w = le as Wall; tf = li.GetTotalTransform(); }
                else w = _doc.GetElement(uid) as Wall;
                if (w != null) subjects.Add(new KeyValuePair<Wall, Transform>(w, tf));
            }
            if (subjects.Count == 0) return found;
            int sideCount0 = subjects.Count;
            double sideZ = subjects.Select(kv => Rect(kv.Key, kv.Value, f)).Where(r => r != null).Select(r => r[4]).DefaultIfEmpty(0).Min();
            foreach (Occluder o in occ)
            {
                var ow = o.E as Wall;
                if (ow == null || o.Z0 > sideZ - thin || subjects.Any(kv => o.Same(kv.Key))) continue;
                bool parallel = false;
                try { parallel = Math.Abs(o.Tf.OfVector(ow.Orientation).DotProduct(vd)) > 0.99; } catch { }
                // Дэлгээсний гол хэсгийг эзэлсэн хана л (дээд давхрын ханын доод зах дээд зурваст цухуйсныг тэмдэглэхгүй).
                double ox = Math.Min(o.X1, p.Box.MaxX) - Math.Max(o.X0, p.Box.MinX), oy = Math.Min(o.Y1, p.Box.MaxY) - Math.Max(o.Y0, p.Box.MinY);
                if (parallel && ox >= paper(8) && oy >= (p.Box.MaxY - p.Box.MinY) * 0.4) subjects.Add(new KeyValuePair<Wall, Transform>(ow, o.Tf));
            }
            for (int si = 0; si < subjects.Count; si++)
            {
                KeyValuePair<Wall, Transform> kv = subjects[si];
                if (skipSides && si < sideCount0) continue;
                Wall w = kv.Key;
                Transform tf = kv.Value;
                // Keynote-оор тэмдэглэсэн өнгөлгөөний хана (host) — бичвэр давхардуулахгүй.
                if (tf.IsIdentity && _finishKeynoted.Contains(w.Id.Value)) continue;
                try
                {
                    double[] wr = Rect(w, tf, f);
                    double wz = wr != null ? wr[4] : 0;
                    // Энэ ханын ӨМНӨ (зүсэх хавтгайн ард) харагдах бүх элемент — саад.
                    List<double[]> obstacles = occ.Where(o => !o.Same(w) && o.Z0 < wz - thin && o.Z1 > p.Box.Near).Select(o => o.R).ToList();
                    MatNote n = w.WallType != null && w.WallType.Kind == WallKind.Curtain ? CurtainNote(w, tf, f, p.Box, paper(3), obstacles, paper(6))
                                                                                            : WallNote(w, tf, f, p.Box, vd, paper(3), obstacles, paper(6));
                    if (n != null && n.Score > 0)
                    {
                        // Төрөлд Keynote утгатай (интерьерийн өнгөлгөө) — материалын нэр биш keynote-ийн бичвэр (жишигтэй ижил, давхардахгүй).
                        string key = KeynoteValue(w);
                        if (!string.IsNullOrWhiteSpace(key)) { n.Text = key.Trim(); n.Keynote = true; }
                        found.Add(n);
                    }
                }
                catch (Exception ex) { WeLog.Info("annotate", v.Name + ": материал — " + ex.Message); }
            }
            return found;
        }

        /// <summary>
        /// Тэмдэглэлүүдийг мөрөөр (<see cref="WeNoteLayout"/>): дээд — дэлгээсний дээгүүр; доод (<paramref name="below"/>, шалны хүрээ) —
        /// хамгийн доод хэвтээ хэмжээсний доор, мөр бүр доошоо.
        /// </summary>
        private void PlaceNotes(View v, WePlannedElevation p, WeFrame f, TextNoteType tt, double scale, Func<double, double> paper, List<MatNote> notes, bool below,
                                List<ElementId> ids, WeRunResult result)
        {
            if (notes.Count == 0) return;
            double offset = 0;
            try { Parameter op = tt.get_Parameter(BuiltInParameter.LEADER_OFFSET_SHEET); if (op != null) offset = op.AsDouble(); } catch { }
            var items = new List<WeNoteItem>();
            double lineH = 0;
            foreach (MatNote n in notes)
            {
                double w, h;
                WeTextMeasure.Measure(tt, n.Text, out w, out h);
                lineH = Math.Max(lineH, h * scale);
                items.Add(new WeNoteItem { Key = n.Text, LeaderX = n.EndX, Width = (w + offset) * scale });
            }
            double shoulder = paper(1.5);
            List<WeNotePlace> places = WeNoteLayout.Place(items, p.Box.MinX, p.Box.MaxX, shoulder, paper(2), paper(15));
            double pitch = lineH + paper(1);
            foreach (WeNotePlace pl in places)
            {
                MatNote n = notes.First(x => x.Text == pl.Item.Key);
                double baseBelow = notes.Min(x => x.BaseY);
                double top = below ? baseBelow - pl.Row * pitch : p.Box.MaxY + paper(3) + lineH + pl.Row * pitch;
                double midY = top - lineH / 2;
                double tx = pl.TextOnRight ? pl.TextLeft + offset * scale : pl.TextRight - offset * scale;
                try
                {
                    var opt = new TextNoteOptions(tt.Id) { HorizontalAlignment = pl.TextOnRight ? HorizontalTextAlignment.Left : HorizontalTextAlignment.Right };
                    TextNote tn = TextNote.Create(_doc, v.Id, OnPlane(v, f.ToWorld(tx, top, 0).ToXyz()), n.Text, opt);
                    try { if (pl.TextOnRight) tn.LeaderLeftAttachment = LeaderAtachement.Midpoint; else tn.LeaderRightAttachment = LeaderAtachement.Midpoint; } catch { }
                    Leader ld = tn.AddLeader(pl.TextOnRight ? TextNoteLeaderTypes.TNLT_STRAIGHT_L : TextNoteLeaderTypes.TNLT_STRAIGHT_R);
                    ld.End = OnPlane(v, f.ToWorld(n.EndX, n.EndY, 0).ToXyz());
                    try { ld.Elbow = OnPlane(v, f.ToWorld(n.EndX, midY, 0).ToXyz()); } catch { }
                    ids.Add(tn.Id);
                    if (n.Keynote) result.AnnoKeynotes++; else result.AnnoTags++;
                }
                catch (Exception ex) { WeLog.Info("annotate", v.Name + ": материалын тэмдэглэл «" + n.Text + "» — " + ex.Message); }
            }
        }

        private TextNoteType _noteType;
        private bool _noteTypeResolved;

        /// <summary>
        /// Материалын тэмдэглэлийн бичвэрийн төрөл: төслийн өгөгдмөл нь СУМТАЙ бол тэр; эс бөгөөс 1.8–2.5 мм, сумтай (нэрэнд «сум»/«arrow»)
        /// төрлүүдээс ТӨСӨЛД хамгийн их хэрэглэгдсэн нь (ХЭМЖСЭН GATEWAY: өгөгдмөл «2.5 / Дугуй битүүлсэн 30° 4» цэгтэй — жишээ хуудсанд сум;
        /// «2.5 / Сум битүүлсэн 30°» 414 удаа).  Олдохгүй бол өгөгдмөл.  Төслийн төрлийг ӨӨРЧЛӨХГҮЙ.
        /// </summary>
        private TextNoteType NoteTextType()
        {
            if (_noteTypeResolved) return _noteType;
            _noteTypeResolved = true;
            try
            {
                var def = _doc.GetElement(_doc.GetDefaultElementTypeId(ElementTypeGroup.TextNoteType)) as TextNoteType;
                List<TextNoteType> all = new FilteredElementCollector(_doc).OfClass(typeof(TextNoteType)).Cast<TextNoteType>().ToList();
                Func<TextNoteType, bool> arrow = t =>
                {
                    Parameter ap = t.get_Parameter(BuiltInParameter.LEADER_ARROWHEAD);
                    Element ah = ap != null ? _doc.GetElement(ap.AsElementId()) : null;
                    string nm = ah != null ? ah.Name.ToLowerInvariant() : "";
                    return nm.Contains("сум") || nm.Contains("arrow");
                };
                Func<TextNoteType, double> sizeMm = t => { Parameter sp = t.get_Parameter(BuiltInParameter.TEXT_SIZE); return sp != null ? sp.AsDouble() * 304.8 : 0; };
                if (def != null && arrow(def) && sizeMm(def) >= 1.75 && sizeMm(def) <= 3.05) return _noteType = def;
                Dictionary<long, int> used = new FilteredElementCollector(_doc).OfClass(typeof(TextNote)).Select(e => e.GetTypeId().Value)
                                                 .GroupBy(x => x).ToDictionary(g => g.Key, g => g.Count());
                TextNoteType best = all.Where(t => arrow(t) && sizeMm(t) >= 1.75 && sizeMm(t) <= 2.55 && !t.Name.StartsWith("MGL", StringComparison.Ordinal))
                                       .OrderByDescending(t => { int c; return used.TryGetValue(t.Id.Value, out c) ? c : 0; })
                                       .ThenByDescending(sizeMm).FirstOrDefault();
                _noteType = best ?? def ?? all.FirstOrDefault();
                if (_noteType != null) WeLog.Info("annotate", "материалын тэмдэглэлийн төрөл: " + _noteType.Name);
            }
            catch (Exception ex) { WeLog.Info("annotate", "бичвэрийн төрөл — " + ex.Message); }
            return _noteType;
        }

        // Ханын ӨМНӨ харагдах, заагч буух ёсгүй элементүүд (хаалга, цонх, тавилга, хэрэгсэл, багана …).
        private static readonly BuiltInCategory[] BlockerCats =
        {
            BuiltInCategory.OST_Doors, BuiltInCategory.OST_Windows, BuiltInCategory.OST_CurtainWallPanels, BuiltInCategory.OST_CurtainWallMullions,
            BuiltInCategory.OST_Furniture, BuiltInCategory.OST_FurnitureSystems, BuiltInCategory.OST_Casework, BuiltInCategory.OST_PlumbingFixtures,
            BuiltInCategory.OST_SpecialityEquipment, BuiltInCategory.OST_GenericModel, BuiltInCategory.OST_LightingFixtures,
            BuiltInCategory.OST_ElectricalEquipment, BuiltInCategory.OST_ElectricalFixtures, BuiltInCategory.OST_MechanicalEquipment,
            // OST_StructuralFraming ЗОРИУД алга: ХЭМЖСЭН (GATEWAY бүтцийн link) дам нурууны bbox давхрын бүтэн өндөртэй (y 500..4400) — заагчийг
            // ханын ёроол руу шахсан; дам нуруу таазны дээр, заагч (өндрийн 60 %) түүнд хүрэхгүй.
            BuiltInCategory.OST_Columns, BuiltInCategory.OST_StructuralColumns, BuiltInCategory.OST_Walls,
            BuiltInCategory.OST_Stairs, BuiltInCategory.OST_Railings,
        };

        /// <summary>
        /// Дэлгээст харагдах элементүүд (энэ баримт: харагдацын collector; link: харагдацын хайрцгийг link-ийн координатад шилжүүлсэн bbox
        /// шүүлтүүрээр, host харагдацад нуусан ангилал орохгүй).  ХЭМЖСЭН (GATEWAY 310F, 2026-10-07): гипсэн ханын заагч бүтцийн link-ийн
        /// лифтний хаалган (KONE, h=2400) дээр буусан — link-ийн элементийг огт тооцоогүй байв.
        /// </summary>
        private List<Occluder> ViewOccluders(View v, WeFrame f, WeBox box)
        {
            var res = new List<Occluder>();
            Action<Element, Transform> add = (e, tf) =>
            {
                double[] r = Rect(e, tf, f);
                if (r == null || r[2] < box.MinX || r[0] > box.MaxX || r[3] < box.MinY || r[1] > box.MaxY || r[5] < box.Near || r[4] > box.Far) return;
                res.Add(new Occluder { X0 = r[0], Y0 = r[1], X1 = r[2], Y1 = r[3], Z0 = r[4], Z1 = r[5], E = e, Tf = tf });
            };
            var cats = BlockerCats.Where(c => { try { return !v.GetCategoryHidden(new ElementId(c)); } catch { return true; } }).ToList();
            if (cats.Count == 0) return res;
            try
            {
                foreach (Element e in new FilteredElementCollector(_doc, v.Id).WherePasses(new ElementMulticategoryFilter(cats)).WhereElementIsNotElementType())
                    add(e, Transform.Identity);
            }
            catch (Exception ex) { WeLog.Info("annotate", v.Name + ": саад — " + ex.Message); }
            try
            {
                foreach (RevitLinkInstance li in new FilteredElementCollector(_doc, v.Id).OfClass(typeof(RevitLinkInstance)).Cast<RevitLinkInstance>())
                {
                    Document ld = li.GetLinkDocument();
                    if (ld == null) continue;
                    Transform tf = li.GetTotalTransform(), inv = tf.Inverse;
                    double x0 = double.MaxValue, y0 = double.MaxValue, z0 = double.MaxValue, x1 = double.MinValue, y1 = double.MinValue, z1 = double.MinValue;
                    for (int i = 0; i < 8; i++)
                    {
                        XYZ c = inv.OfPoint(f.ToWorld((i & 1) == 0 ? box.MinX : box.MaxX, (i & 2) == 0 ? box.MinY : box.MaxY, (i & 4) == 0 ? box.Near : box.Far).ToXyz());
                        x0 = Math.Min(x0, c.X); y0 = Math.Min(y0, c.Y); z0 = Math.Min(z0, c.Z);
                        x1 = Math.Max(x1, c.X); y1 = Math.Max(y1, c.Y); z1 = Math.Max(z1, c.Z);
                    }
                    var filter = new LogicalAndFilter(new ElementMulticategoryFilter(cats), new BoundingBoxIntersectsFilter(new Outline(new XYZ(x0, y0, z0), new XYZ(x1, y1, z1))));
                    foreach (Element e in new FilteredElementCollector(ld).WherePasses(filter).WhereElementIsNotElementType()) add(e, tf);
                }
            }
            catch (Exception ex) { WeLog.Info("annotate", v.Name + ": link саад — " + ex.Message); }
            return res;
        }

        /// <summary>Энгийн хана: өрөө рүү харсан өнгөлгөөний материал, заагч нь хаалга/цонх/тавилгаас хамгийн зайтай цэгт (ханын хэсэгт).</summary>
        private MatNote WallNote(Wall w, Transform tf, WeFrame f, WeBox box, XYZ vd, double pad, List<double[]> obstacles, double want)
        {
            Material m = FinishMaterial(w, tf, vd);
            if (m == null) return null;
            string text = MaterialText(m);
            if (string.IsNullOrEmpty(text)) return null;
            var lc = w.Location as LocationCurve;
            if (lc == null || lc.Curve == null) return null;
            double a = f.ToLocal(tf.OfPoint(lc.Curve.GetEndPoint(0)).ToWe()).X, b = f.ToLocal(tf.OfPoint(lc.Curve.GetEndPoint(1)).ToWe()).X;
            double x0 = Math.Max(Math.Min(a, b), box.MinX + pad), x1 = Math.Min(Math.Max(a, b), box.MaxX - pad);
            if (x1 - x0 < pad) return null;
            var holes = new List<double[]>();
            try
            {
                foreach (ElementId iid in w.FindInserts(true, false, true, true))
                {
                    double[] r = XRange(w.Document.GetElement(iid), tf, f);
                    if (r != null) holes.Add(r);
                }
            }
            catch { }
            double[] free = WidestFree(x0, x1, holes, pad);
            double y0 = box.MinY, y1 = box.MaxY;
            double[] yr = YRange(w, tf, f);
            if (yr != null) { y0 = Math.Max(y0, yr[0]); y1 = Math.Min(y1, yr[1]); }
            if (y1 <= y0) { y0 = box.MinY; y1 = box.MaxY; }
            // Саадууд: ханын нүх (link ханад ч) + энэ ханаас ӨМНӨ харагдах элементүүд.
            var obst = new List<double[]>(obstacles ?? new List<double[]>());
            foreach (double[] h in holes) obst.Add(new[] { h[0], y0, h[1], y1 });
            List<double[]> loops = FaceLoops(w, tf, f, vd);
            double ex, ey;
            double score = WeLeaderPoint.Find(x0, x1, y0, y1, (free[0] + free[1]) / 2, y0 + (y1 - y0) * 0.6, obst, loops, want, out ex, out ey);
            return new MatNote { Text = text, EndX = ex, EndY = ey, Span = free[1] - free[0], Score = score };
        }

        /// <summary>
        /// Ханын харагч тийш харсан (өнгөлгөөний) хамгийн ойр хавтгай нүүрнүүдийн хүрээ — дэлгээсний дотоод XY олон өнцөгтөөр (нүх нь дотоод
        /// хүрээ).  Олдохгүй бол хоосон (заагч хязгааргүй).
        /// </summary>
        private static List<double[]> FaceLoops(Wall w, Transform tf, WeFrame f, XYZ vd)
        {
            var res = new List<double[]>();
            try
            {
                GeometryElement ge = w.get_Geometry(new Options { ComputeReferences = false, DetailLevel = ViewDetailLevel.Fine });
                if (ge == null) return res;
                var faces = new List<PlanarFace>();
                foreach (GeometryObject go in ge)
                {
                    var solid = go as Solid;
                    if (solid == null || solid.Faces.Size == 0) continue;
                    foreach (Face face in solid.Faces)
                    {
                        var pf = face as PlanarFace;
                        if (pf != null && tf.OfVector(pf.FaceNormal).DotProduct(vd) > 0.99) faces.Add(pf);
                    }
                }
                if (faces.Count == 0) return res;
                // Харагчид хамгийн ойр нүүр(үүд) — ард байгаа нүүрийг (нүхний ёроол, ханын шилжилт) оруулахгүй.
                Func<PlanarFace, double> depth = pf => f.ToLocal(tf.OfPoint(pf.Origin).ToWe()).Z;
                double near = faces.Min(depth);
                foreach (PlanarFace pf in faces.Where(x => depth(x) <= near + 0.05))
                    foreach (CurveLoop cl in pf.GetEdgesAsCurveLoops())
                    {
                        var pts = new List<double>();
                        foreach (Curve c in cl)
                        {
                            IList<XYZ> tess = c.Tessellate();
                            for (int i = 0; i < tess.Count - 1; i++)
                            {
                                WeV3 l = f.ToLocal(tf.OfPoint(tess[i]).ToWe());
                                pts.Add(l.X);
                                pts.Add(l.Y);
                            }
                        }
                        if (pts.Count >= 6) res.Add(pts.ToArray());
                    }
            }
            catch { res.Clear(); }
            return res;
        }

        /// <summary>
        /// Curtain хана: хавтангийн (хаалганаас бусад) материал ихэнх нь шил (тунгалаг ≥ 30 % эсвэл нэр/ангилалд «шил»/«glass») бол «ШИЛЭН ХАНА»,
        /// эс бөгөөс хавтангийн материалын нэр.  Заагч нь хамгийн том хавтангийн голд.
        /// </summary>
        private MatNote CurtainNote(Wall w, Transform tf, WeFrame f, WeBox box, double pad, List<double[]> obstacles, double want)
        {
            CurtainGrid g = w.CurtainGrid;
            if (g == null) return null;
            Document d = w.Document;
            int glass = 0, solid = 0;
            Material firstSolid = null;
            var panels = new List<KeyValuePair<bool, double[]>>();   // шил эсэх → {x0, y0, x1, y1}
            foreach (ElementId pid in g.GetPanelIds())
            {
                Element pe = d.GetElement(pid);
                if (pe == null || pe.Category == null || pe.Category.Id.Value == (long)BuiltInCategory.OST_Doors) continue;
                bool isGlass = false;
                Material pm = null;
                foreach (ElementId mid in pe.GetMaterialIds(false))
                {
                    var m = d.GetElement(mid) as Material;
                    if (m == null) continue;
                    string nm = (m.Name + " " + m.MaterialClass).ToLowerInvariant();
                    if (m.Transparency >= 30 || nm.Contains("шил") || nm.Contains("glass")) { isGlass = true; break; }
                    if (pm == null) pm = m;
                }
                if (isGlass) glass++; else { solid++; if (firstSolid == null) firstSolid = pm; }
                double[] xr = XRange(pe, tf, f), yr = YRange(pe, tf, f);
                if (xr == null || yr == null) continue;
                double x0 = Math.Max(xr[0], box.MinX + pad), x1 = Math.Min(xr[1], box.MaxX - pad);
                double y0 = Math.Max(yr[0], box.MinY), y1 = Math.Min(yr[1], box.MaxY);
                if (x1 - x0 > pad && y1 - y0 > pad) panels.Add(new KeyValuePair<bool, double[]>(isGlass, new[] { x0, y0, x1, y1 }));
            }
            bool glassWall = glass >= solid && glass > 0;
            string text = glassWall ? WeMaterialLabel.GlassWall : firstSolid != null ? MaterialText(firstSolid) : null;
            if (string.IsNullOrEmpty(text)) return null;
            // Тэмдэглэлийн материалтай хавтангаас (том нь эхэнд) — өмнө нь харагдах элементээс зайтай цэг.
            foreach (double[] r in panels.Where(kv => kv.Key == glassWall).Select(kv => kv.Value).OrderByDescending(r => (r[2] - r[0]) * (r[3] - r[1])))
            {
                var loop = new List<double[]> { new[] { r[0], r[1], r[2], r[1], r[2], r[3], r[0], r[3] } };
                double ex, ey;
                double score = WeLeaderPoint.Find(r[0], r[2], r[1], r[3], (r[0] + r[2]) / 2, r[1] + (r[3] - r[1]) * 0.6, obstacles, loop, want, out ex, out ey);
                if (score > 0) return new MatNote { Text = text, EndX = ex, EndY = ey, Span = r[2] - r[0], Score = score };
            }
            return null;
        }

        private static string MaterialText(Material m)
        {
            string desc = null;
            try { Parameter dp = m.get_Parameter(BuiltInParameter.ALL_MODEL_DESCRIPTION); if (dp != null) desc = dp.AsString(); } catch { }
            return WeMaterialLabel.Label(m.Name, desc, m.MaterialClass);
        }

        /// <summary>[x0, x1] дотроос нүх (хаалга, цонх)-гүй хамгийн өргөн хэсэг; бүгд нүх бол бүтэн хэсэг.</summary>
        private static double[] WidestFree(double x0, double x1, List<double[]> holes, double pad)
        {
            var cuts = holes.Where(h => h[1] > x0 && h[0] < x1).OrderBy(h => h[0]).ToList();
            double[] best = null;
            double cur = x0;
            foreach (double[] h in cuts)
            {
                if (h[0] - cur > (best == null ? 0 : best[1] - best[0])) best = new[] { cur, h[0] };
                cur = Math.Max(cur, h[1]);
            }
            if (x1 - cur > (best == null ? 0 : best[1] - best[0])) best = new[] { cur, x1 };
            return best != null && best[1] - best[0] >= pad ? best : new[] { x0, x1 };
        }

        /// <summary>{x0, y0, x1, y1, zMin, zMax} — bbox-ийн 8 оройг дэлгээсний дотоод координатад.</summary>
        private static double[] Rect(Element e, Transform tf, WeFrame f)
        {
            BoundingBoxXYZ bb = e != null ? e.get_BoundingBox(null) : null;
            if (bb == null) return null;
            double x0 = double.MaxValue, y0 = double.MaxValue, z0 = double.MaxValue, x1 = double.MinValue, y1 = double.MinValue, z1 = double.MinValue;
            for (int i = 0; i < 8; i++)
            {
                var c = new XYZ((i & 1) == 0 ? bb.Min.X : bb.Max.X, (i & 2) == 0 ? bb.Min.Y : bb.Max.Y, (i & 4) == 0 ? bb.Min.Z : bb.Max.Z);
                WeV3 l = f.ToLocal(tf.OfPoint(bb.Transform.OfPoint(c)).ToWe());
                x0 = Math.Min(x0, l.X); x1 = Math.Max(x1, l.X);
                y0 = Math.Min(y0, l.Y); y1 = Math.Max(y1, l.Y);
                z0 = Math.Min(z0, l.Z); z1 = Math.Max(z1, l.Z);
            }
            return new[] { x0, y0, x1, y1, z0, z1 };
        }

        private static double[] XRange(Element e, Transform tf, WeFrame f) { return Range(e, tf, f, true); }

        private static double[] YRange(Element e, Transform tf, WeFrame f) { return Range(e, tf, f, false); }

        private static double[] Range(Element e, Transform tf, WeFrame f, bool x)
        {
            BoundingBoxXYZ bb = e != null ? e.get_BoundingBox(null) : null;
            if (bb == null) return null;
            double lo = double.MaxValue, hi = double.MinValue;
            for (int i = 0; i < 8; i++)
            {
                var c = new XYZ((i & 1) == 0 ? bb.Min.X : bb.Max.X, (i & 2) == 0 ? bb.Min.Y : bb.Max.Y, (i & 4) == 0 ? bb.Min.Z : bb.Max.Z);
                WeV3 l = f.ToLocal(tf.OfPoint(bb.Transform.OfPoint(c)).ToWe());
                double v = x ? l.X : l.Y;
                lo = Math.Min(lo, v);
                hi = Math.Max(hi, v);
            }
            return new[] { lo, hi };
        }

        /// <summary>Өрөө рүү харсан нүүрийн материал: будсан бол будаг, үгүй бол давхаргат ханын тэр талын эхний давхарга.</summary>
        private static Material FinishMaterial(Wall w, Transform tf, XYZ viewDir)
        {
            Document d = w.Document;
            try
            {
                GeometryElement ge = w.get_Geometry(new Options { ComputeReferences = true });
                if (ge != null)
                    foreach (GeometryObject go in ge)
                    {
                        var solid = go as Solid;
                        if (solid == null) continue;
                        foreach (Face face in solid.Faces)
                        {
                            var pf = face as PlanarFace;
                            if (pf == null || tf.OfVector(pf.FaceNormal).DotProduct(viewDir) < 0.99) continue;
                            if (d.IsPainted(w.Id, face))
                            {
                                var pm = d.GetElement(d.GetPaintedMaterial(w.Id, face)) as Material;
                                if (pm != null) return pm;
                            }
                        }
                    }
            }
            catch { }
            try
            {
                CompoundStructure cs = w.WallType != null ? w.WallType.GetCompoundStructure() : null;
                if (cs == null || cs.LayerCount == 0) return null;
                // Давхарга: гаднаас (0) дотогш.  Харагч тал = Orientation (гадна) бол эхний, эс бөгөөс сүүлийн.
                bool exteriorFaces = tf.OfVector(w.Orientation).DotProduct(viewDir) > 0;
                IList<CompoundStructureLayer> layers = cs.GetLayers();
                CompoundStructureLayer l = exteriorFaces ? layers[0] : layers[layers.Count - 1];
                Material m = d.GetElement(l.MaterialId) as Material;
                if (m == null)
                {
                    // Давхаргын материал «By Category» — ханын төрлийн материал параметр.
                    Parameter mp = w.WallType.get_Parameter(BuiltInParameter.STRUCTURAL_MATERIAL_PARAM);
                    if (mp != null) m = d.GetElement(mp.AsElementId()) as Material;
                }
                return m;
            }
            catch { return null; }
        }

        // ── Хэмжээс ─────────────────────────────────────────────────

        private Dimension CreateRow(View v, WePlannedElevation p, WeDimRow row, out string err, out bool skipped)
        {
            int anchorsBefore = _anchorIds.Count;
            bool threw;
            Dimension d = BuildRow(v, p, row, false, out err, out skipped, out threw);
            if (d != null || !threw || !row.Refs.Any(IsExactEdge)) return d;
            // 2026-10-14: Revit тавилгын нүүрний лавлагааг хүлээж аваагүй (family-ийн дотоод геометр) — нэг тавилгаас болж бүх гинж
            // унахгүйн тулд тэр ирмэгүүдийг ЯГ байрлалын туслах шугамаар солиод НЭГ удаа дахин.
            DeleteAnchorsFrom(anchorsBefore);
            string err2;
            d = BuildRow(v, p, row, true, out err2, out skipped, out threw);
            if (d != null) WeLog.Info("annotate", v.Name + ": " + row.What + " — тавилгын нүүр хүлээгдээгүй, туслах шугамаар (" + err + ")");
            else err = Append(err, err2);
            return d;
        }

        private static bool IsExactEdge(WeAnnoRef r)
        {
            return r.Exact && (r.Kind == WeRefKind.ElementLeft || r.Kind == WeRefKind.ElementRight);
        }

        private void DeleteAnchorsFrom(int start)
        {
            if (_anchorIds.Count <= start) return;
            List<ElementId> extra = _anchorIds.GetRange(start, _anchorIds.Count - start);
            _anchorIds.RemoveRange(start, _anchorIds.Count - start);
            try { _doc.Delete(extra); } catch { }
        }

        private Dimension BuildRow(View v, WePlannedElevation p, WeDimRow row, bool anchorExact, out string err, out bool skipped, out bool threw)
        {
            threw = false;
            err = null;
            skipped = false;
            int hidden = 0;
            var ra = new ReferenceArray();
            var used = new List<double>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (WeAnnoRef r in row.Refs)
            {
                Reference rf = anchorExact && IsExactEdge(r) ? null : Resolve(v, p, r);
                bool edge = !row.Vertical && (r.Kind == WeRefKind.FaceStart || r.Kind == WeRefKind.FaceEnd);
                if (edge && rf != null && !Visible(rf.ElementId)) rf = null;
                // Дэлгээсийн ДОТОРХ эгнээнд (цахилгаан цэгийн байрлал) захын туслах шугам эгнээний дэргэд — хүрээний доод талаас
                // урт сунгалтын шугам зурагдахгүй.
                if (rf == null && edge) rf = row.Group == WeDimGroup.PointPosition ? PointAnchor(v, p, row, r.Pos) : EdgeAnchor(v, p, r.Pos);
                bool anchored = false;
                if (rf == null && Anchorable(r.Kind) && VisibleOrNote(new ElementId(r.ElementId)))
                {
                    rf = PointAnchor(v, p, row, r.Pos);
                    anchored = rf != null;
                }
                // 2026-10-14: тавилгын ЯГ ирмэг (бүрхүүлээс) — нүүр/хавтгай таараагүй (дугуй ширээ, налуу ирмэг) бол тэр цэгт үл харагдах
                // туслах шугам: хэмжээсийн утга бодит ирмэгээр, хайрцгаар биш.
                if (rf == null && r.Exact && (r.Kind == WeRefKind.ElementLeft || r.Kind == WeRefKind.ElementRight) && VisibleOrNote(new ElementId(r.ElementId)))
                {
                    rf = row.Vertical ? PointAnchor(v, p, row, r.Pos) : EdgeAnchor(v, p, r.Pos);
                    anchored = rf != null;
                }
                // Харагдахгүй элемент (template цахилгааны тоноглолыг нуусан г.м.) — алдаа биш, тэмдэглэлд шалтгаантай.
                if (rf == null && r.ElementId > 0 && !VisibleOrNote(new ElementId(r.ElementId))) { hidden++; continue; }
                if (rf == null) { err = Append(err, r.Kind + " " + r.ElementId + " олдсонгүй"); continue; }
                if (!edge && !anchored && !VisibleOrNote(rf.ElementId)) { hidden++; continue; }
                string key;
                try { key = rf.ConvertToStableRepresentation(_doc); } catch { key = r.Kind + ":" + r.ElementId + ":" + r.Pos; }
                if (!seen.Add(key)) continue;
                ra.Append(rf);
                used.Add(r.Pos);
            }
            if (ra.Size < 2)
            {
                // Харагдахгүй элементийн улмаас л дутсан бол алдаа биш — тэмдэглэлд шалтгаан нь бий.
                skipped = hidden > 0 && ra.Size + hidden >= 2;
                err = Append(err, "хоёроос цөөн лавлагаа");
                return null;
            }
            double lo = used.Min() - 0.5, hi = used.Max() + 0.5;
            WeFrame f = p.Frame;
            XYZ a = row.Vertical ? OnPlane(v, f.ToWorld(row.At, lo, 0).ToXyz()) : OnPlane(v, f.ToWorld(lo, row.At, 0).ToXyz());
            XYZ b = row.Vertical ? OnPlane(v, f.ToWorld(row.At, hi, 0).ToXyz()) : OnPlane(v, f.ToWorld(hi, row.At, 0).ToXyz());
            try
            {
                Line line = Line.CreateBound(a, b);
                Dimension d = _dimType != null ? _doc.Create.NewDimension(v, line, ra, _dimType) : _doc.Create.NewDimension(v, line, ra);
                if (d != null)
                {
                    FixSmallText(v, d, row, f);
                    _what[d.Id.Value] = v.Name + ": " + row.What + " [" + string.Join(",", row.Refs.Select(r => r.Kind + ":" + r.ElementId)) + "]";
                }
                return d;
            }
            catch (Exception ex)
            {
                threw = true;
                err = Append(err, ex.Message + " [" + DescribeRefs(ra) + "]");
                return null;
            }
        }

        /// <summary>Лог: лавлагаа бүрийн эх (элементийн төрөл, link эсэх, нүүр/шугам) — Revit «Invalid number of references»-ийн шалтгааныг олоход.</summary>
        private string DescribeRefs(ReferenceArray ra)
        {
            var parts = new List<string>();
            foreach (Reference r in ra)
            {
                try
                {
                    Element e = _doc.GetElement(r.ElementId);
                    string what = e == null ? "?" : e is DetailCurve ? "detail" : e.GetType().Name;
                    if (r.LinkedElementId != ElementId.InvalidElementId) what += "→link#" + r.LinkedElementId.Value;
                    else what += "#" + r.ElementId.Value;
                    parts.Add(what + ":" + r.ElementReferenceType);
                }
                catch { parts.Add("?"); }
            }
            return string.Join(", ", parts);
        }

        /// <summary>
        /// Гадаргуугийн ЗАХ (хөрш хана/багана) хэмжих нүүргүй үед (ХЭМЖСЭН, GATEWAY 310C/310D: зах нь харах гүнээс гадуурх хөшиг ханын
        /// mullion, link-ийн ханын нүүр холболтоор алга) — захын байрлалд ҮЛ ХАРАГДАХ богино detail шугам (&lt;Invisible lines&gt;) тавьж
        /// түүнд хэмжинэ.  Үгүй бол дэлгээс ХЭВТЭЭ ХЭМЖЭЭСГҮЙ үлддэг байв (жишээ хуудаст бүх дэлгээс доороо нийт урттай).
        /// Шугам нь дэлгээсийн өөрийн элемент (WeAnnoStore) — дахин ажиллуулахад солигдоно.
        /// </summary>
        private Reference EdgeAnchor(View v, WePlannedElevation p, double x)
        {
            try
            {
                WeFrame f = p.Frame;
                XYZ a = OnPlane(v, f.ToWorld(x, p.Box.MinY, 0).ToXyz());
                XYZ b = OnPlane(v, f.ToWorld(x, p.Box.MinY + Paper(1.5), 0).ToXyz());
                DetailCurve dc = _doc.Create.NewDetailCurve(v, Line.CreateBound(a, b));
                GraphicsStyle inv = InvisibleLines();
                if (inv != null) { try { dc.LineStyle = inv; } catch { } }
                _anchorIds.Add(dc.Id);
                return dc.GeometryCurve.Reference;
            }
            catch (Exception ex)
            {
                WeLog.Info("annotate", v.Name + ": захын туслах шугам — " + ex.Message);
                return null;
            }
        }

        private readonly List<ElementId> _anchorIds = new List<ElementId>();
        private GraphicsStyle _invisible;
        private bool _invisibleResolved;

        private GraphicsStyle InvisibleLines()
        {
            if (_invisibleResolved) return _invisible;
            _invisibleResolved = true;
            try
            {
                Category c = Category.GetCategory(_doc, BuiltInCategory.OST_InvisibleLines);
                _invisible = c != null ? c.GetGraphicsStyle(GraphicsStyleType.Projection) : null;
            }
            catch { _invisible = null; }
            return _invisible;
        }

        /// <summary>
        /// Гинжийн ЗАХЫН маш жижиг сегментийн (цаасан дээр &lt; 3.5 мм — ж: таазаас хучилт хүртэлх 69 мм 1:50-д) бичвэрийг сунгалтын
        /// шугамын цаана, гинжийн гадна зөөнө — хөршийн бичвэр дээр давхцахгүй.  Бусдыг Revit-ийн өгөгдмөлөөр үлдээнэ: бичвэрийн
        /// өргөнийг (фонт, нэгж, бутархай) найдвартай тооцох боломжгүй тул «багтахгүй» гэж таамаглаж зөөх нь (туршсан) байдлыг
        /// дордуулсан.  Чадахгүй бол хэвээр.
        /// </summary>
        private void FixSmallText(View v, Dimension d, WeDimRow row, WeFrame f)
        {
            try
            {
                int n = d.Segments.Size;
                if (n < 2) return;
                double scale = Math.Max(1, v.Scale);
                double tiny = Mm(3.5) * scale;
                var segs = new List<DimensionSegment>();
                for (int i = 0; i < n; i++) segs.Add(d.Segments.get_Item(i));
                if (!segs[0].Value.HasValue || !segs[n - 1].Value.HasValue) return;
                if (segs[0].Value.Value >= tiny && segs[n - 1].Value.Value >= tiny) return;
                _doc.Regenerate();
                double textH = Mm(2.5);   // цаасны өндөр (төрөлд TEXT_SIZE байхгүй бол)
                try
                {
                    Parameter tp = _doc.GetElement(d.GetTypeId())?.get_Parameter(BuiltInParameter.TEXT_SIZE);
                    if (tp != null && tp.HasValue && tp.AsDouble() > 0) textH = tp.AsDouble();
                }
                catch { }
                XYZ dir = (row.Vertical ? f.Up : f.Right).ToXyz().Normalize();
                foreach (int i in new[] { 0, n - 1 })
                {
                    DimensionSegment sg = segs[i];
                    double len = sg.Value ?? 0;
                    if (len >= tiny || !sg.IsTextPositionAdjustable()) continue;
                    XYZ o = sg.Origin, other = segs[i == 0 ? 1 : n - 2].Origin;
                    XYZ along = (o - other).DotProduct(dir) >= 0 ? dir : dir.Negate();
                    double width = (Math.Max(2, (sg.ValueString ?? string.Empty).Length) * 0.8 + 1.0) * textH * scale;
                    sg.TextPosition = sg.TextPosition + along * (len / 2 + width / 2);
                }
            }
            catch (Exception ex)
            {
                WeLog.Info("annotate", v.Name + ": жижиг сегментийн бичвэр — " + ex.Message);
            }
        }

        // ── Spot level ──────────────────────────────────────────────

        private SpotDimension CreateSpot(View v, WePlannedElevation p, WeSpot sp, out string err, out bool skipped)
        {
            err = null;
            skipped = false;
            if (!VisibleOrNote(new ElementId(sp.Target.ElementId))) { skipped = true; return null; }
            WeFrame f = p.Frame;
            XYZ want = f.ToWorld(sp.X, sp.Y, sp.Depth).ToXyz();
            // Эхлээд family-ийн Top/Bottom reference plane, дараа нь бодит геометрийн нүүр (ханын нүхний дээд/доод, тааз).
            ElementId hiddenHost = null;
            foreach (Candidate c in SpotCandidates(p, sp.Target, want))
            {
                // ж: хана нуугдсан → нүхний нүүр биш, family-ийн reference; түүнгүй бол харагдахгүй spot тавихгүй.
                if (!Visible(c.Ref.ElementId)) { hiddenHost = c.Ref.ElementId; continue; }
                XYZ origin = c.Point;
                XYZ end = sp.Leader ? new XYZ(0, 0, 0) : origin;
                XYZ bend = origin;
                if (sp.Leader)
                {
                    WeV3 lo = f.ToLocal(origin.ToWe());
                    end = f.ToWorld(sp.EndX, lo.Y, lo.Z).ToXyz();
                    // ХЭМЖСЭН (Revit 2024, gate DIAG-SPOT-FADE-FRAME, 2026-10-14): бичвэр нь төгсгөлөөс bend-ийн ТАЛД 6.35 мм-т гардаг.
                    // Толин (sp.Mirrored): bend-ийг төгсгөлөөс ЗУРГААС ХОЛДОХ талд → «2,81 ▽———» (жишээ хуудас 232A).  Үгүй бол хуучнаар
                    // (зураг тийш) → «▽ 2,81———».
                    double outward = sp.EndX <= lo.X ? -1 : 1;
                    double side = sp.Mirrored ? outward : -outward;
                    bend = f.ToWorld(sp.EndX + side * Paper(2), lo.Y, lo.Z).ToXyz();
                }
                try
                {
                    SpotDimension sd = _doc.Create.NewSpotElevation(v, c.Ref, origin, bend, end, origin, sp.Leader);
                    if (sd == null) continue;
                    ElementId spotType = _spotType != ElementId.InvalidElementId ? _spotType : (_relativeSpot ?? ElementId.InvalidElementId);
                    if (spotType != ElementId.InvalidElementId && sd.GetTypeId() != spotType)
                    {
                        try { sd.ChangeTypeId(spotType); } catch { }
                    }
                    if (spotType != ElementId.InvalidElementId && _relativeTypes.Contains(spotType.Value)) SetRelativeBase(sd, p);
                    return sd;
                }
                catch (Exception ex)
                {
                    err = Append(err, c.What + ": " + ex.Message);
                }
            }
            if (err == null && hiddenHost != null)
            {
                VisibleOrNote(hiddenHost);
                skipped = true;
                return null;
            }
            if (err == null) err = "лавлагаа олдсонгүй (" + SpotDiag(p, sp.Target) + ")";
            return null;
        }

        /// <summary>Лог: spot-ийн хост элементийн хэвтээ нүүрүүд (өндөр, хүссэн өндрөөс зөрүү) — яагаад лавлагаа олдоогүйг харуулна.</summary>
        private string SpotDiag(WePlannedElevation p, WeAnnoRef t)
        {
            try
            {
                Element e = _doc.GetElement(new ElementId(t.ElementId));
                if (e == null) return "элемент алга #" + t.ElementId;
                var ho = e as HostObject;
                if (ho == null) return e.GetType().Name + " — HostObject биш";
                double z = p.Frame.Origin.Z + t.Pos;
                bool top = t.Kind == WeRefKind.FloorTop;
                IList<Reference> refs = top ? HostObjectUtils.GetTopFaces(ho) : HostObjectUtils.GetBottomFaces(ho);
                var zs = new List<string>();
                foreach (Reference r in refs ?? new List<Reference>())
                {
                    var pf = ho.GetGeometryObjectFromReference(r) as PlanarFace;
                    zs.Add(pf == null ? "муруй" : Math.Round((pf.Origin.Z - z) * 304.8).ToString(CultureInfo.InvariantCulture) + "мм");
                }
                return e.GetType().Name + "#" + t.ElementId + " " + (top ? "дээд" : "доод") + " нүүр " + (zs.Count == 0 ? "0" : string.Join("/", zs));
            }
            catch (Exception ex) { return ex.Message; }
        }

        /// <summary>
        /// Харьцангуй spot-ийн суурь = өрөөний давхрын HOST түвшин (2026-10-14: төлөвлөгчийн <see cref="WeAnnotationPlan.BaseLevelId"/> — өндрөөр
        /// олсон; өмнө нь зөвхөн НЭРЭЭР хайдаг байсан тул link-ийн өрөөний давхрын нэр host-ынхоос өөр (6-р давхар) бол суурь тавигдахгүй, spot
        /// «20,10» гэж үнэмлэхүй өндрөөр гарч байв).  Параметр шууд гарахгүй бол дэлгээсийн spot-ууд дууссаны дараа нэг regenerate-ээр дахин.
        /// </summary>
        private void SetRelativeBase(SpotDimension sd, WePlannedElevation p)
        {
            try
            {
                Level l = BaseLevel(p);
                if (l == null)
                {
                    if (_baseNoted.Add("nolevel|" + (p.LevelName ?? string.Empty)))
                        _notes.Add("Spot level-ийн суурь давхар «" + (p.LevelName ?? "?") + "» host загварт олдсонгүй — түвшин давхраас биш тоологдож магадгүй.");
                    return;
                }
                Parameter rb = sd.get_Parameter(BuiltInParameter.SPOT_ELEV_RELATIVE_BASE);
                if (rb == null || rb.IsReadOnly) { _pendingBase.Add(new KeyValuePair<SpotDimension, Level>(sd, l)); return; }
                if (rb.AsElementId() != l.Id) rb.Set(l.Id);
            }
            catch (Exception ex) { WeLog.Info("annotate", "spot суурь — " + ex.Message); }
        }

        private readonly List<KeyValuePair<SpotDimension, Level>> _pendingBase = new List<KeyValuePair<SpotDimension, Level>>();
        private readonly HashSet<string> _baseNoted = new HashSet<string>(StringComparer.Ordinal);

        private Level BaseLevel(WePlannedElevation p)
        {
            long id = p.Annotation != null ? p.Annotation.BaseLevelId : 0;
            if (id != 0)
            {
                var l = _doc.GetElement(new ElementId(id)) as Level;
                if (l != null) return l;
            }
            return LevelByName(p.LevelName);
        }

        /// <summary>Төрөл солиход «Relative Base» шууд гараагүй spot-ууд — нэг regenerate-ийн дараа дахин.</summary>
        private void FlushPendingBase(View v)
        {
            if (_pendingBase.Count == 0) return;
            try { _doc.Regenerate(); } catch { }
            int failed = 0;
            foreach (KeyValuePair<SpotDimension, Level> kv in _pendingBase)
            {
                try
                {
                    if (!kv.Key.IsValidObject) continue;
                    Parameter rb = kv.Key.get_Parameter(BuiltInParameter.SPOT_ELEV_RELATIVE_BASE);
                    if (rb == null || rb.IsReadOnly) { failed++; continue; }
                    if (rb.AsElementId() != kv.Value.Id) rb.Set(kv.Value.Id);
                }
                catch { failed++; }
            }
            _pendingBase.Clear();
            if (failed > 0)
            {
                WeLog.Info("annotate", v.Name + ": " + failed + " spot-ийн «Relative Base» тавигдсангүй");
                if (_baseNoted.Add("pending")) _notes.Add("Зарим spot level-ийн «Relative Base» тавигдсангүй — түвшин давхраас биш тоологдож магадгүй (логийг үзнэ үү).");
            }
        }

        private Dictionary<string, Level> _levelsByName;

        private Level LevelByName(string name)
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

        private sealed class Candidate
        {
            public Reference Ref;
            public XYZ Point;
            public string What;
        }

        private IEnumerable<Candidate> SpotCandidates(WePlannedElevation p, WeAnnoRef t, XYZ want)
        {
            Element e = _doc.GetElement(new ElementId(t.ElementId));
            if (e == null) yield break;
            double z = p.Frame.Origin.Z + t.Pos;
            switch (t.Kind)
            {
                case WeRefKind.InsertTop:
                case WeRefKind.InsertBottom:
                {
                    var fi = e as FamilyInstance;
                    if (fi == null) yield break;
                    // Ханын нүхний дээд (−Z) / доод (+Z) нүүр — бодит ирмэг, spot level-д хамгийн найдвартай.
                    var host = fi.Host as Wall;
                    if (host != null)
                    {
                        PlanarFace pf;
                        Reference r = HorizontalFace(host, z, t.Kind == WeRefKind.InsertTop ? -1 : 1, want, Math.Max(0.5, HalfWidth(fi) + 0.2), out pf);
                        if (r != null) yield return new Candidate { Ref = r, Point = ProjectTo(pf, want), What = "ханын нүх" };
                    }
                    Reference fr = First(fi, t.Kind == WeRefKind.InsertTop ? FamilyInstanceReferenceType.Top : FamilyInstanceReferenceType.Bottom);
                    if (fr != null) yield return new Candidate { Ref = fr, Point = new XYZ(want.X, want.Y, z), What = "family reference" };
                    break;
                }
                case WeRefKind.CeilingBottom:
                case WeRefKind.FloorBottom:
                case WeRefKind.SlabBottom:
                case WeRefKind.FloorTop:
                {
                    PlanarFace pf;
                    // W08: spot level налуу нүүр дээр ч (цэгийн өндрийг Revit өөрөө бодно); хэмжээсийн лавлагаанд — зөвхөн хэвтээ (доорх замууд).
                    Reference r = HostFace(e, t.Kind == WeRefKind.FloorTop, z, want, out pf, true);
                    // ХЭМЖСЭН (GATEWAY 310, 508): шалны нүүр хүссэн цэгийн доор байхгүй байж болно (шал хэсэг хэсгээр, хөрш өрөөний шал
                    // гадаргуугийн захад) — нүүрийн хавтгай руу проекцлосон цэг «Spot Dimension does not lie on its reference».  Нүүр ДЭЭР
                    // орших цэгийг хайна.
                    XYZ on = r == null ? null : pf != null ? PointOnFace(pf, p, want, t.Pos) : new XYZ(want.X, want.Y, z);
                    if (on != null) { yield return new Candidate { Ref = r, Point = on, What = "нүүр" }; break; }
                    if (t.Kind != WeRefKind.FloorTop) break;
                    // Төлөвлөсөн шалны нүүр энд хүрэхгүй — дэлгээсийн хавтгайн өмнөх (өрөөний) бодит шалыг тэр өндөрт хайна.
                    foreach (Element fl in FloorsNear(p, z))
                    {
                        if (fl.Id == e.Id) continue;
                        PlanarFace pf2;
                        Reference r2 = HostFace(fl, true, z, want, out pf2);
                        XYZ on2 = r2 != null && pf2 != null ? PointOnFace(pf2, p, want, t.Pos) : null;
                        if (on2 != null) { yield return new Candidate { Ref = r2, Point = on2, What = "шалны нүүр" }; break; }
                    }
                    break;
                }
            }
        }

        // ── Лавлагаа ────────────────────────────────────────────────

        private Reference Resolve(View v, WePlannedElevation p, WeAnnoRef r)
        {
            Element e = _doc.GetElement(new ElementId(r.ElementId));
            if (e == null) return null;
            WeFrame f = p.Frame;
            double z = f.Origin.Z + r.Pos;
            XYZ mid = f.ToWorld(0, p.Box.MinY + p.Box.Height / 2, p.Box.Near / 2).ToXyz();
            PlanarFace ignored;
            switch (r.Kind)
            {
                case WeRefKind.Level:
                {
                    var l = e as Level;
                    try { return l != null ? l.GetPlaneReference() : null; } catch { return null; }
                }
                case WeRefKind.FloorTop:
                    return HostFace(e, true, z, new XYZ(mid.X, mid.Y, z), out ignored);
                case WeRefKind.FloorBottom:
                case WeRefKind.SlabBottom:
                case WeRefKind.CeilingBottom:
                    return HostFace(e, false, z, new XYZ(mid.X, mid.Y, z), out ignored);
                case WeRefKind.InsertLeft:
                case WeRefKind.InsertRight:
                {
                    var fi = e as FamilyInstance;
                    if (fi == null) return null;
                    // Family-ийн «Left» нь гарын чиглэлийн (HandOrientation) сөрөг талд — дэлгээсийн баруун чиглэлтэй тулгаж сонгоно.
                    double s = 1;
                    try { s = fi.HandOrientation.DotProduct(f.Right.ToXyz()); } catch { }
                    bool wantLeftType = (r.Kind == WeRefKind.InsertLeft) == (s >= 0);
                    return First(fi, wantLeftType ? FamilyInstanceReferenceType.Left : FamilyInstanceReferenceType.Right);
                }
                case WeRefKind.FaceStart:
                case WeRefKind.FaceEnd:
                    return p.Kind == WeSourceKind.Wall ? WallFaceEdge(e as Wall, f, r) : BoundaryFace(f, p, r);
                case WeRefKind.Grid:
                    return e is Grid ? new Reference(e) : null;
                case WeRefKind.ElementLeft:
                case WeRefKind.ElementRight:
                {
                    var fi = e as FamilyInstance;
                    double bestDx;
                    if (r.Exact)
                    {
                        // 2026-10-14 (эзэн: «тавилгын хэмжээсийг ЗӨВ тавь»): байрлал = харагдах геометрийн бүрхүүл.  (1) Тэр цэг дээрх бодит
                        // босоо нүүр; (2) family-ийн хавтгай — зөвхөн ТЭР цэгт байгааг түр хэмжээсээр баталсан бол (Left/Right нь
                        // загварчлагчийн зурсан хавтгай, тавилгын ирмэгээс 50–300 мм зөрдөг); (3) null → CreateRow ЯГ тэр цэгт туслах шугам.
                        double tol = Math.Max(r.Tol, Mm(1));
                        Reference face = VerticalFace(e, f, r.Pos, tol, out bestDx);
                        if (face != null) return face;
                        return fi != null ? VerifiedFamilyPlane(v, p, fi, r.Pos, tol) : null;
                    }
                    if (fi != null)
                    {
                        // Хуучин зам (бүрхүүлгүй — хайрцгийн байрлал): family-ийн Left/Right зөвхөн ХАВТГАЙ нь хэмжих чиглэлд
                        // перпендикуляр үед.  Хажуу тийш эргүүлсэн тавилгын Left/Right хавтгай харах чиглэлтэй зэрэгцэж «references
                        // invalid» болж бүх гинжийг унагадаг байв.
                        double s = 0;
                        try { s = fi.HandOrientation.DotProduct(f.Right.ToXyz()); } catch { }
                        if (Math.Abs(s) > 0.999)
                        {
                            bool wantLeftType = (r.Kind == WeRefKind.ElementLeft) == (s >= 0);
                            Reference fr = First(fi, wantLeftType ? FamilyInstanceReferenceType.Left : FamilyInstanceReferenceType.Right);
                            if (fr != null) return fr;
                        }
                    }
                    // Family-д зүүн/баруун reference plane байхгүй (in-place, ерөнхий модел …) эсвэл хана — бодит босоо нүүр.
                    return VerticalFace(e, f, r.Pos, Math.Max(r.Tol, Mm(30)), out bestDx);
                }
                case WeRefKind.ElementCenterX:
                case WeRefKind.ElementCenterY:
                {
                    // Розетк/унтраалга: family-ийн «Center (Left/Right)» / «Center (Elevation)» reference plane.  Байхгүй бол null →
                    // CreateRow үл харагдах туслах шугам тавина (байрлал нь элементийн хайрцгийн төв).
                    var fi = e as FamilyInstance;
                    if (fi == null) return null;
                    // ХЭМЖСЭН (MITIC 215B/215D, 2026-10-08): face-based розетк хананд суухад family-ийн тэнхлэг эргэнэ — «Center (Elevation)»-ийн
                    // хавтгай нь ханын нүүр (өндрийг хэмжихгүй), ширээн дээрх/перпендикуляр хананы цэгийн «Center (Left/Right)» нь харах
                    // чиглэлтэй параллель — хэмжээс commit-ийн үед «references invalid» болж бүх тэмдэглэгээг буцаадаг байв.  Хэмжих чиглэлд
                    // (X = дэлгээсийн баруун, Y = дээш) ПЕРПЕНДИКУЛЯР хавтгайг тэнхлэгээр нь сонгоно; олдохгүй бол null → туслах шугам.
                    return CenterRef(fi, r.Kind == WeRefKind.ElementCenterX ? f.Right.ToXyz() : XYZ.BasisZ);
                }
                case WeRefKind.ElementTop:
                case WeRefKind.ElementBottom:
                    return HorizontalElementFace(e, z, r.Kind == WeRefKind.ElementTop ? 1 : -1, Math.Max(r.Tol, Mm(10)));
            }
            return null;
        }

        /// <summary>
        /// Family-ийн хэмжих чиглэлд перпендикуляр хавтгай (Left/Right эсвэл Front/Back) — <paramref name="pos"/> цэгт байгааг ТҮР
        /// хэмжээсээр шалгана: [pos−δ туслах шугам, хавтгай, pos+δ туслах шугам] → хоёр сегмент хоёулаа δ (± tol) бол хавтгай яг тэнд.
        /// Хавтгайн байрлалыг Revit API шууд өгдөггүй (геометргүй лавлагаа).  Түр элементүүд устгагдана.  Олдохгүй бол null.
        /// </summary>
        private Reference VerifiedFamilyPlane(View v, WePlannedElevation p, FamilyInstance fi, double pos, double tol)
        {
            Transform t;
            try { t = fi.GetTransform(); } catch { return null; }
            if (t == null) return null;
            XYZ right = p.Frame.Right.ToXyz();
            FamilyInstanceReferenceType[] types;
            if (Aligned(t.BasisX, right)) types = new[] { FamilyInstanceReferenceType.Left, FamilyInstanceReferenceType.Right };
            else if (Aligned(t.BasisY, right)) types = new[] { FamilyInstanceReferenceType.Front, FamilyInstanceReferenceType.Back };
            else return null;
            foreach (FamilyInstanceReferenceType type in types)
            {
                Reference rf = First(fi, type);
                if (rf != null && PlaneAt(v, p, rf, pos, tol)) return rf;
            }
            return null;
        }

        private static bool Aligned(XYZ axis, XYZ dir)
        {
            double len = axis.GetLength();
            return len > 1e-9 && Math.Abs(axis.DotProduct(dir)) / len > 0.999;
        }

        private bool PlaneAt(View v, WePlannedElevation p, Reference plane, double pos, double tol)
        {
            WeFrame f = p.Frame;
            double delta = Mm(250);
            var temp = new List<ElementId>();
            try
            {
                var ra = new ReferenceArray();
                foreach (double x in new[] { pos - delta, pos + delta })
                {
                    XYZ a = OnPlane(v, f.ToWorld(x, p.Box.MinY, 0).ToXyz()), b = OnPlane(v, f.ToWorld(x, p.Box.MinY + Paper(1.5), 0).ToXyz());
                    DetailCurve dc = _doc.Create.NewDetailCurve(v, Line.CreateBound(a, b));
                    temp.Add(dc.Id);
                    ra.Append(dc.GeometryCurve.Reference);
                    if (ra.Size == 1) ra.Append(plane);
                }
                XYZ l0 = OnPlane(v, f.ToWorld(pos - 2 * delta, p.Box.MinY - Paper(8), 0).ToXyz());
                XYZ l1 = OnPlane(v, f.ToWorld(pos + 2 * delta, p.Box.MinY - Paper(8), 0).ToXyz());
                Dimension d = _doc.Create.NewDimension(v, Line.CreateBound(l0, l1), ra);
                if (d == null) return false;
                temp.Add(d.Id);
                if (d.Segments.Size != 2) return false;
                foreach (DimensionSegment seg in d.Segments)
                {
                    double? val = seg.Value;
                    if (!val.HasValue || Math.Abs(val.Value - delta) > tol) return false;
                }
                return true;
            }
            catch { return false; }
            finally
            {
                try { if (temp.Count > 0) _doc.Delete(temp); } catch { }
            }
        }

        /// <summary>Элементийн хэвтээ нүүр (дээд: normal +Z, доод: −Z) — өндөр нь <paramref name="z"/>-тэй хамгийн ойр (шалны хүрээ, хавтан).</summary>
        private Reference HorizontalElementFace(Element e, double z, int normalZ, double tol)
        {
            Reference best = null;
            double bestDz = double.MaxValue;
            foreach (PlanarFace pf in FaceSources(e).SelectMany(PlanarFaces))
            {
                if (pf.Reference == null || Math.Abs(pf.FaceNormal.Z - normalZ) > 1e-3) continue;
                double dz = Math.Abs(pf.Origin.Z - z);
                if (dz > tol || dz >= bestDz) continue;
                bestDz = dz;
                best = pf.Reference;
            }
            return best;
        }

        /// <summary>
        /// Лавлагаа олдоогүй ЦЭГ (розеткийн төв, хавтангийн ирмэг) — хэмжээсний шугамын дэргэд, хэмжих чиглэлд перпендикуляр богино
        /// үл харагдах detail шугам (<see cref="EdgeAnchor"/>-ийн ижил арга).  Дэлгээсийн өөрийн элемент — дахин ажиллуулахад солигдоно.
        /// </summary>
        private Reference PointAnchor(View v, WePlannedElevation p, WeDimRow row, double pos)
        {
            try
            {
                WeFrame f = p.Frame;
                double len = Paper(3);
                XYZ a = row.Vertical ? OnPlane(v, f.ToWorld(row.At, pos, 0).ToXyz()) : OnPlane(v, f.ToWorld(pos, row.At - len, 0).ToXyz());
                XYZ b = row.Vertical ? OnPlane(v, f.ToWorld(row.At + len, pos, 0).ToXyz()) : OnPlane(v, f.ToWorld(pos, row.At, 0).ToXyz());
                DetailCurve dc = _doc.Create.NewDetailCurve(v, Line.CreateBound(a, b));
                GraphicsStyle inv = InvisibleLines();
                if (inv != null) { try { dc.LineStyle = inv; } catch { } }
                _anchorIds.Add(dc.Id);
                return dc.GeometryCurve.Reference;
            }
            catch (Exception ex)
            {
                WeLog.Info("annotate", v.Name + ": туслах цэгийн шугам — " + ex.Message);
                return null;
            }
        }

        private static bool Anchorable(WeRefKind k)
        {
            return k == WeRefKind.ElementCenterX || k == WeRefKind.ElementCenterY || k == WeRefKind.ElementTop || k == WeRefKind.ElementBottom;
        }

        /// <summary>Family-ийн төвийн reference plane — хэвийн вектор нь <paramref name="dir"/>-тэй параллель (X = Left/Right, Y = Front/Back, Z = Elevation).</summary>
        private static Reference CenterRef(FamilyInstance fi, XYZ dir)
        {
            Transform t;
            try { t = fi.GetTransform(); } catch { return null; }
            if (t == null) return null;
            var cands = new[]
            {
                new KeyValuePair<XYZ, FamilyInstanceReferenceType>(t.BasisX, FamilyInstanceReferenceType.CenterLeftRight),
                new KeyValuePair<XYZ, FamilyInstanceReferenceType>(t.BasisY, FamilyInstanceReferenceType.CenterFrontBack),
                new KeyValuePair<XYZ, FamilyInstanceReferenceType>(t.BasisZ, FamilyInstanceReferenceType.CenterElevation),
            };
            foreach (KeyValuePair<XYZ, FamilyInstanceReferenceType> c in cands)
            {
                double len = c.Key.GetLength();
                if (len < 1e-9 || Math.Abs(c.Key.DotProduct(dir)) / len < 0.999) continue;
                return First(fi, c.Value);
            }
            return null;
        }

        private static Reference First(FamilyInstance fi, FamilyInstanceReferenceType t)
        {
            try
            {
                IList<Reference> refs = fi.GetReferences(t);
                return refs != null && refs.Count > 0 ? refs[0] : null;
            }
            catch { return null; }
        }

        /// <summary>
        /// Шал/таазны дээд эсвэл доод нүүр — <paramref name="z"/>-д хамгийн ойрыг, <paramref name="near"/>-тай хамгийн ойр хэсгийг.  W08:
        /// <paramref name="allowSloped"/> бол налуу хавтгай нүүр ч (өндрийг <paramref name="near"/> цэг дээрх хавтгайгаас) — spot level-д л.
        /// </summary>
        private Reference HostFace(Element e, bool top, double z, XYZ near, out PlanarFace face, bool allowSloped = false)
        {
            face = null;
            var ho = e as HostObject;
            if (ho == null) return null;
            IList<Reference> refs;
            try { refs = top ? HostObjectUtils.GetTopFaces(ho) : HostObjectUtils.GetBottomFaces(ho); }
            catch { return null; }
            Reference best = null;
            double bestScore = double.MaxValue;
            foreach (Reference r in refs ?? new List<Reference>())
            {
                var pf = ho.GetGeometryObjectFromReference(r) as PlanarFace;
                if (pf == null) continue;
                bool flat = Math.Abs(Math.Abs(pf.FaceNormal.Z) - 1) <= 1e-3;
                if (!flat && (!allowSloped || Math.Abs(pf.FaceNormal.Z) < 0.1)) continue;
                double dz = Math.Abs(FaceZAt(pf, near) - z);
                if (dz > Mm(30)) continue;
                // ⚠️ Project нь цэг нүүрнээс ГАДНА проекцлогдвол null — өмнө нь 0 зай гэж үзээд хөрш өрөөний шалны нүүрийг сонгодог байв
                // (GATEWAY 310: «Spot Dimension does not lie on its reference»).  Цэгийг агуулаагүй нүүр хойно.
                double dist = 1e3;
                try
                {
                    IntersectionResult ir = pf.Project(near);
                    if (ir != null) dist = new XYZ(ir.XYZPoint.X - near.X, ir.XYZPoint.Y - near.Y, 0).GetLength();
                }
                catch { dist = 1e3; }
                double score = dz * 10 + dist;
                if (score < bestScore) { bestScore = score; best = r; face = pf; }
            }
            return best;
        }

        /// <summary>Хавтгай нүүрний план цэг дээрх өндөр (хэвтээ нүүрт = Origin.Z — өмнөх зан төлөв).</summary>
        private static double FaceZAt(PlanarFace pf, XYZ p)
        {
            XYZ n = pf.FaceNormal, o = pf.Origin;
            if (Math.Abs(n.Z) < 1e-9 || p == null) return o.Z;
            return o.Z - (n.X * (p.X - o.X) + n.Y * (p.Y - o.Y)) / n.Z;
        }

        /// <summary>Ханын хэвтээ нүүр (нүхний дээд: normal −Z, доод: +Z) — нүхний хүрээнд, өндөр нь таарсан.</summary>
        private Reference HorizontalFace(Wall wall, double z, int normalZ, XYZ near, double radius, out PlanarFace face)
        {
            face = null;
            Reference best = null;
            double bestDist = double.MaxValue;
            foreach (PlanarFace pf in PlanarFaces(wall))
            {
                if (Math.Abs(pf.FaceNormal.Z - normalZ) > 1e-3 || Math.Abs(pf.Origin.Z - z) > Mm(30) || pf.Reference == null) continue;
                XYZ q = ProjectTo(pf, near);
                double d = new XYZ(q.X - near.X, q.Y - near.Y, 0).GetLength();
                if (d > radius || d >= bestDist) continue;
                bestDist = d;
                best = pf.Reference;
                face = pf;
            }
            return best;
        }

        /// <summary>
        /// Өрөөний горим: гадаргуугийн зах = хөрш ханын (өрөө рүү харсан) нүүр.  Захын цэгийн орчмын ханануудаас нормаль нь
        /// дэлгээсийн баруун чиглэлтэй параллель, байрлал нь зорилтод хамгийн ойр нүүр.
        /// </summary>
        private Reference BoundaryFace(WeFrame f, WePlannedElevation p, WeAnnoRef r)
        {
            XYZ end = f.ToWorld(r.Pos, p.Box.MinY + p.Box.Height / 2, 0).ToXyz();
            double d = Math.Max(r.Tol, Mm(50)) + 0.3;
            var outline = new Outline(end - new XYZ(d, d, 2), end + new XYZ(d, d, 2));
            // ХЭМЖСЭН (Revit 2027, sheet2): нэгтгэсэн талын (2 хана + завсар) аль нэг хана нь харах хавтгайн ӨМНӨ (харагдахгүй) байж
            // болно — ижил байрлалд ХАРАГДАХ хана байвал түүнийг илүүд үзнэ (эс бөгөөс хэмжээсний зах алгасагдана).
            Reference best = null;
            double bestDx = double.MaxValue;
            bool bestVis = false;
            foreach (Wall w in new FilteredElementCollector(_doc).OfClass(typeof(Wall)).WherePasses(new BoundingBoxIntersectsFilter(outline)).Cast<Wall>())
            {
                double dx;
                Reference rf = VerticalFace(w, f, r.Pos, Math.Max(r.Tol, Mm(5)), out dx);
                if (rf == null) continue;
                bool vis = Visible(w.Id);
                if (vis && !bestVis || vis == bestVis && dx < bestDx) { bestDx = dx; best = rf; bestVis = vis; }
            }
            // Link загварын хана (бодит төсөлд өрөөний хилийн ихэнх нь бүтцийн link-д) — нүүрийг link-ийн координатаас хөрвүүлж,
            // хэмжээсийн лавлагааг CreateLinkReference-ээр.
            foreach (RevitLinkInstance li in Links())
            {
                Document ld;
                try { ld = li.GetLinkDocument(); } catch { ld = null; }
                if (ld == null) continue;
                Transform tf = li.GetTotalTransform();
                Outline lo = TransformOutline(outline, tf.Inverse);
                if (lo == null) continue;
                bool vis = Visible(li.Id);
                foreach (Wall w in new FilteredElementCollector(ld).OfClass(typeof(Wall)).WherePasses(new BoundingBoxIntersectsFilter(lo)).Cast<Wall>())
                {
                    double dx;
                    Reference rf = LinkedVerticalFace(w, tf, f, r.Pos, Math.Max(r.Tol, Mm(5)), out dx);
                    if (rf == null) continue;
                    Reference lr;
                    lr = WeLinkRef.ForDimension(_doc, rf, li);
                    if (lr == null) continue;
                    if (vis && !bestVis || vis == bestVis && dx < bestDx) { bestDx = dx; best = lr; bestVis = vis; }
                }
            }
            return best;
        }

        private List<RevitLinkInstance> _links;

        private List<RevitLinkInstance> Links()
        {
            if (_links == null)
            {
                try { _links = new FilteredElementCollector(_doc).OfClass(typeof(RevitLinkInstance)).Cast<RevitLinkInstance>().ToList(); }
                catch { _links = new List<RevitLinkInstance>(); }
            }
            return _links;
        }

        private static Outline TransformOutline(Outline o, Transform t)
        {
            XYZ a = o.MinimumPoint, b = o.MaximumPoint;
            double x0 = double.MaxValue, y0 = double.MaxValue, z0 = double.MaxValue, x1 = double.MinValue, y1 = double.MinValue, z1 = double.MinValue;
            foreach (double x in new[] { a.X, b.X })
                foreach (double y in new[] { a.Y, b.Y })
                    foreach (double z in new[] { a.Z, b.Z })
                    {
                        XYZ q = t.OfPoint(new XYZ(x, y, z));
                        x0 = Math.Min(x0, q.X); y0 = Math.Min(y0, q.Y); z0 = Math.Min(z0, q.Z);
                        x1 = Math.Max(x1, q.X); y1 = Math.Max(y1, q.Y); z1 = Math.Max(z1, q.Z);
                    }
            try { return new Outline(new XYZ(x0, y0, z0), new XYZ(x1, y1, z1)); } catch { return null; }
        }

        /// <summary>Link-ийн ханын босоо нүүр (link координатын геометрийг host руу хөрвүүлж шалгана) — лавлагаа нь LINK-ийнх.</summary>
        private Reference LinkedVerticalFace(Wall w, Transform tf, WeFrame f, double targetX, double tol, out double bestDx)
        {
            bestDx = double.MaxValue;
            XYZ right = f.Right.ToXyz();
            Reference best = null;
            GeometryElement ge;
            try { ge = w.get_Geometry(_geo); } catch { return null; }
            if (ge == null) return null;
            foreach (GeometryObject go in ge)
            {
                var solid = go as Solid;
                if (solid == null) continue;
                foreach (PlanarFace pf in Faces(solid))
                {
                    if (pf.Reference == null) continue;
                    XYZ n = tf.OfVector(pf.FaceNormal);
                    if (Math.Abs(Math.Abs(n.DotProduct(right)) - 1) > 1e-3) continue;
                    double dx = Math.Abs(f.ToLocal(tf.OfPoint(pf.Origin).ToWe()).X - targetX);
                    if (dx > tol || dx >= bestDx) continue;
                    bestDx = dx;
                    best = pf.Reference;
                }
            }
            return best;
        }

        /// <summary>Элементийн босоо хавтгай нүүр — нормаль нь дэлгээсийн баруун чиглэлтэй параллель, байрлал нь зорилтод хамгийн ойр.</summary>
        private Reference VerticalFace(Element e, WeFrame f, double targetX, double tol, out double bestDx)
        {
            bestDx = double.MaxValue;
            XYZ right = f.Right.ToXyz();
            Reference best = null;
            foreach (PlanarFace pf in FaceSources(e).SelectMany(PlanarFaces))
            {
                if (pf.Reference == null || Math.Abs(Math.Abs(pf.FaceNormal.DotProduct(right)) - 1) > 1e-3) continue;
                double dx = Math.Abs(f.ToLocal(pf.Origin.ToWe()).X - targetX);
                if (dx > tol || dx >= bestDx) continue;
                bestDx = dx;
                best = pf.Reference;
            }
            return best;
        }

        /// <summary>Хана горим: харагч руу харсан нүүрийн хамгийн зүүн / баруун БОСОО ирмэг — харагдах гадаргуугийн бодит зах.</summary>
        private Reference WallFaceEdge(Wall wall, WeFrame f, WeAnnoRef r)
        {
            if (wall == null) return null;
            bool start = r.Kind == WeRefKind.FaceStart;
            // Хөшиг хана: хатуу биегүй — зах дахь mullion эсвэл хавтангийн босоо нүүр.
            if (wall.CurtainGrid != null)
            {
                double dx;
                return VerticalFace(wall, f, r.Pos, Math.Max(r.Tol, Mm(60)), out dx);
            }
            XYZ vd = f.ViewDirection.ToXyz();
            Reference best = null;
            double bestX = start ? double.MaxValue : double.MinValue;
            foreach (PlanarFace pf in FaceSources(wall).SelectMany(PlanarFaces))
            {
                if (pf.FaceNormal.DotProduct(vd) < 0.999) continue;
                foreach (EdgeArray loop in pf.EdgeLoops)
                    foreach (Edge edge in loop)
                    {
                        var line = edge.AsCurve() as Line;
                        if (line == null || edge.Reference == null || Math.Abs(Math.Abs(line.Direction.Z) - 1) > 1e-3) continue;
                        double x = f.ToLocal(line.GetEndPoint(0).ToWe()).X;
                        if (start ? x < bestX : x > bestX) { bestX = x; best = edge.Reference; }
                    }
            }
            return best;
        }

        /// <summary>
        /// Нүүр авах элементүүд: энгийн элемент өөрөө; давхарласан хана → бүрэлдэхүүн хананууд; хөшиг хана → mullion, хавтангууд
        /// (хөшиг хана өөрөө хатуу биегүй).  Үгүй бол хэмжээсний лавлагаа «олдсонгүй» болдог (хэмжсэн 2026-10-06).
        /// </summary>
        private IEnumerable<Element> FaceSources(Element e)
        {
            var w = e as Wall;
            if (w == null) return new[] { e };
            try
            {
                if (w.CurtainGrid != null)
                    return w.CurtainGrid.GetMullionIds().Concat(w.CurtainGrid.GetPanelIds()).Select(id => _doc.GetElement(id)).Where(x => x != null).ToList();
                if (w.IsStackedWall)
                    return w.GetStackedWallMemberIds().Select(id => _doc.GetElement(id)).Where(x => x != null).ToList();
            }
            catch { }
            return new[] { e };
        }

        private IEnumerable<PlanarFace> PlanarFaces(Element e)
        {
            GeometryElement ge;
            try { ge = e.get_Geometry(_geo); } catch { yield break; }
            if (ge == null) yield break;
            foreach (GeometryObject go in ge)
            {
                var solid = go as Solid;
                if (solid != null)
                {
                    foreach (PlanarFace pf in Faces(solid)) yield return pf;
                    continue;
                }
                // Family instance: дэлхийн координат дахь геометр (лавлагаатай).  2026-10-14: nested family (ширээний шургуулга, сандлын
                // хөл) — дотоод instance-ийг ч дагана, эс бөгөөс тэдний нүүр «олдсонгүй».
                var gi = go as GeometryInstance;
                if (gi == null) continue;
                foreach (PlanarFace pf in InstanceFaces(gi, 0)) yield return pf;
            }
        }

        private static IEnumerable<PlanarFace> InstanceFaces(GeometryInstance gi, int depth)
        {
            if (depth > 6) yield break;
            GeometryElement inst;
            try { inst = gi.GetInstanceGeometry(); } catch { yield break; }
            if (inst == null) yield break;
            foreach (GeometryObject g2 in inst)
            {
                var s2 = g2 as Solid;
                if (s2 != null) { foreach (PlanarFace pf in Faces(s2)) yield return pf; continue; }
                var nested = g2 as GeometryInstance;
                if (nested != null) foreach (PlanarFace pf in InstanceFaces(nested, depth + 1)) yield return pf;
            }
        }

        private static IEnumerable<PlanarFace> Faces(Solid solid)
        {
            if (solid.Faces.Size == 0) yield break;
            foreach (Face face in solid.Faces)
            {
                var pf = face as PlanarFace;
                if (pf != null) yield return pf;
            }
        }

        /// <summary>Дэлгээсийн хавтгайн өмнөх бүсэд (өрөөнд), <paramref name="z"/> өндөрт дээд нүүртэй шалнууд.</summary>
        private IEnumerable<Element> FloorsNear(WePlannedElevation p, double z)
        {
            WeFrame f = p.Frame;
            WeBox b = p.Box;
            var pts = new List<XYZ>();
            foreach (double xk in new[] { 0.0, 1.0 })
                foreach (double dk in new[] { 0.05, 0.95 })
                    pts.Add(f.ToWorld(b.MinX + (b.MaxX - b.MinX) * xk, z - f.Origin.Z, b.Near * dk).ToXyz());
            var lo = new XYZ(pts.Min(q => q.X), pts.Min(q => q.Y), z - 0.15);
            var hi = new XYZ(pts.Max(q => q.X), pts.Max(q => q.Y), z + 0.15);
            List<Element> list;
            try
            {
                list = new FilteredElementCollector(_doc).OfClass(typeof(Floor))
                    .WherePasses(new BoundingBoxIntersectsFilter(new Outline(lo, hi))).ToElements().ToList();
            }
            catch { list = new List<Element>(); }
            return list;
        }

        /// <summary>
        /// Нүүр ДЭЭРХ цэг: эхлээд хүссэн цэгийн проекц; нүүрээс гадна бол дэлгээсийн хүрээгээр (зүүнээс баруун, харах гүний хэд хэдэн
        /// түвшинд) хайж нүүрт буух эхний цэг.  Олдохгүй бол null.
        /// </summary>
        private static XYZ PointOnFace(PlanarFace pf, WePlannedElevation p, XYZ want, double y)
        {
            try
            {
                IntersectionResult ir = pf.Project(want);
                if (ir != null && ir.Distance < 0.05) return ir.XYZPoint;
            }
            catch { }
            WeFrame f = p.Frame;
            WeBox b = p.Box;
            double w = b.MaxX - b.MinX;
            // Гүний харьцаа + ханын дэргэдэх тогтмол гүн (50/300/600 мм) — ХЭМЖСЭН (MITIC 218B/D, 227A): ханын дагуух нарийн таазны зурвас
            // (гол тааз гэж хамралтаар сонгогдсон) гүний 10 %-иас (185 мм) ойр — тэнд л нүүр байна.
            var depths = new List<double> { b.Near * 0.5, b.Near * 0.25, b.Near * 0.75, b.Near * 0.1, b.Near * 0.9 };
            foreach (double mm in new[] { 50.0, 300.0, 600.0 })
            {
                double d = -mm / 304.8;
                if (d >= b.Near) depths.Add(d);
            }
            foreach (double dz in depths)
                for (int k = 0; k <= 20; k++)
                {
                    double x = b.MinX + w * (0.05 + 0.9 * k / 20.0);
                    XYZ q = f.ToWorld(x, y, dz).ToXyz();
                    try
                    {
                        IntersectionResult ir = pf.Project(q);
                        if (ir != null && ir.Distance < 0.05) return ir.XYZPoint;
                    }
                    catch { }
                }
            return null;
        }

        private static XYZ ProjectTo(PlanarFace pf, XYZ p)
        {
            try
            {
                IntersectionResult ir = pf.Project(p);
                if (ir != null) return ir.XYZPoint;
            }
            catch { }
            XYZ n = pf.FaceNormal;
            return p - n * (p - pf.Origin).DotProduct(n);
        }

        private static double HalfWidth(FamilyInstance fi)
        {
            BoundingBoxXYZ bb = fi.get_BoundingBox(null);
            if (bb == null) return 1;
            return Math.Max(bb.Max.X - bb.Min.X, bb.Max.Y - bb.Min.Y) / 2;
        }

        // ── Шошго, keynote ──────────────────────────────────────────

        private IndependentTag CreateTag(View v, WePlannedElevation p, WeTagItem t, out bool skipped)
        {
            skipped = false;
            Element e = _doc.GetElement(new ElementId(t.ElementId));
            if (e == null) return null;
            if (!VisibleOrNote(e.Id)) { skipped = true; return null; }
            // Өнгөлгөөний keynote: төрөлд Keynote утга хоосон бол «?» тавихгүй — материалын тэмдэглэл (MaterialNotes) нөхнө.
            if (t.Keynote && t.CategoryKey == WeAnno.Finishes && !HasKeynote(e)) { skipped = true; return null; }
            ElementId typeId = t.Keynote ? _keynoteType : TagTypeFor(e, t.CategoryKey);
            if (typeId == ElementId.InvalidElementId)
            {
                // Family ачаалаагүй нь тохиргооны асуудал — алдаа биш, тэмдэглэлээр хэлнэ.
                skipped = true;
                if (t.Keynote) _notes.Add("Keynote шошгоны family загварт ачаалаагүй — keynote тавиагүй (Annotate → Keynote → Keynote Settings / Load Family).");
                return null;
            }
            WeFrame f = p.Frame;
            XYZ head = OnPlane(v, f.ToWorld(t.HeadX, t.HeadY, 0).ToXyz());
            try
            {
                var target = new Reference(e);
                IndependentTag tag = IndependentTag.Create(_doc, typeId, v.Id, target, t.Leader, TagOrientation.Horizontal, head);
                if (tag == null) return null;
                if (t.Leader)
                {
                    // ⚠️ Revit 2027 (хэмжсэн): leader-тэй үед Create нь толгойн цэгийг ҮЛ ТООНО — keynote-ийн толгой (−1.9 м, 0, 0)
                    // гэх мэт утгагүй цэгт, ханын шошгоных ханын зах руу очдог.  Leader-ийн төгсгөлийг тогтоосны ДАРАА толгойг дахин
                    // оноовол хоёулаа зөв болно.  Үгүй бол 400 м урт leader-тэй шошго үлдэж, харагдац зураглах үед Revit унасан (2026-10-06).
                    try
                    {
                        tag.LeaderEndCondition = LeaderEndCondition.Free;
                        tag.SetLeaderEnd(target, OnPlane(v, f.ToWorld(t.AnchorX, t.AnchorY, 0).ToXyz()));
                    }
                    catch { /* leader-ийн төгсгөлийг Revit өөрөө байршуулна */ }
                }
                try { tag.TagHeadPosition = head; } catch { }
                if (!PlacedNear(tag, head))
                {
                    WeLog.Info("annotate", v.Name + ": " + (t.Keynote ? "keynote " : "шошго ") + t.CategoryKey + " " + t.ElementId + " — толгой байрандаа очсонгүй, устгав");
                    _doc.Delete(tag.Id);
                    return null;
                }
                if (t.Keynote && !HasKeynote(e)) _emptyKeynotes++;
                return tag;
            }
            catch (Exception ex)
            {
                WeLog.Info("annotate", v.Name + ": " + (t.Keynote ? "keynote " : "шошго ") + t.CategoryKey + " " + t.ElementId + " — " + ex.Message);
                return null;
            }
        }


        /// <summary>
        /// Шошгуудыг ДАВХЦУУЛАХГҮЙ: үүсгэсний дараа НЭГ regenerate хийж бодит хүрээг уншина; бусад шошго/дотор хэмжээстэй давхцсан шошгыг ойрын
        /// чөлөөт байр руу (дээш/доош алхмаар, дараа нь хажуу тийш) зөөж заагч (leader) нэмнэ — жишиг дэлгээсүүдийн тавилга, сантехник, розеткийн
        /// шошго заагчтай (MITIC: 545 keynote · 193 тавилга · 150 розетк — бүгд leader).  ХЭМЖСЭН (MITIC 202A, 2026-10-08): «ЗТ-01/02/03»
        /// сандлууд дээр бие биен дээрээ, «Роз-1» дэлгээсийн нэр дээр.  Зөөх боломжгүй бол хэвээр.
        /// </summary>
        private void SpreadTags(View v, WePlannedElevation p, List<KeyValuePair<IndependentTag, WeTagItem>> tags, List<Element> inner)
        {
            if (tags.Count == 0 || p.Frame == null) return;
            WeFrame f = p.Frame;
            try
            {
                using (WeProf.T("anno.tagRegen")) _doc.Regenerate();
                var placed = new List<double[]>();
                foreach (Element e in inner)
                {
                    double[] r = LocalRect(v, f, e);
                    if (r != null) placed.Add(r);
                }
                var items = new List<KeyValuePair<IndependentTag, double[]>>();
                foreach (KeyValuePair<IndependentTag, WeTagItem> kv in tags)
                {
                    double[] r = LocalRect(v, f, kv.Key);
                    if (r != null) items.Add(new KeyValuePair<IndependentTag, double[]>(kv.Key, r));
                }
                double pad = Paper(0.6);
                double minX = p.Box != null ? p.Box.MinX : double.MinValue, maxX = p.Box != null ? p.Box.MaxX : double.MaxValue;
                int moved = 0;
                // Доороос дээш, зүүнээс баруун — дээш зөөх нь доод шошгыг чөлөөлнө.
                foreach (KeyValuePair<IndependentTag, double[]> it in items.OrderBy(i => i.Value[1]).ThenBy(i => i.Value[0]))
                {
                    double[] r = it.Value;
                    if (!Hits(r, placed, pad)) { placed.Add(r); continue; }
                    double w = r[2] - r[0], h = r[3] - r[1];
                    double[] best = null;
                    double bx = 0, by = 0;
                    foreach (double[] d in Offsets(w + pad, h + pad))
                    {
                        var c = new[] { r[0] + d[0], r[1] + d[1], r[2] + d[0], r[3] + d[1] };
                        if (c[0] < minX || c[2] > maxX) continue;
                        if (Hits(c, placed, pad)) continue;
                        best = c; bx = d[0]; by = d[1];
                        break;
                    }
                    if (best == null) { placed.Add(r); continue; }
                    IndependentTag tag = it.Key;
                    XYZ head0 = tag.TagHeadPosition;
                    XYZ head1 = head0 + f.Right.ToXyz() * bx + f.Up.ToXyz() * by;
                    try
                    {
                        if (!tag.HasLeader) { tag.HasLeader = true; try { tag.LeaderEndCondition = LeaderEndCondition.Attached; } catch { } }
                        tag.TagHeadPosition = head1;
                        if (!PlacedNear(tag, head1)) throw new InvalidOperationException("толгой байрандаа очсонгүй");
                        placed.Add(best);
                        moved++;
                    }
                    catch (Exception ex)
                    {
                        try { tag.TagHeadPosition = head0; } catch { }
                        placed.Add(r);
                        WeLog.Info("annotate", v.Name + ": шошго зөөх — " + ex.Message);
                    }
                }
                if (moved > 0) WeLog.Info("annotate", v.Name + ": " + moved + " шошгыг давхцалгүй байр руу зөөв");
            }
            catch (Exception ex) { WeLog.Info("annotate", v.Name + ": шошгын давхцал — " + ex.Message); }
        }

        /// <summary>Зөөх алхмууд: дээш/доош 1–4 мөр, дараа нь хажуу тийш (цаасны нэгжээр, мөрийн өндөр/өргөнөөр).</summary>
        private static IEnumerable<double[]> Offsets(double w, double h)
        {
            for (int k = 1; k <= 4; k++)
            {
                yield return new[] { 0.0, k * h };
                yield return new[] { 0.0, -k * h };
            }
            for (int k = 1; k <= 2; k++)
            {
                yield return new[] { k * w, 0.0 };
                yield return new[] { -k * w, 0.0 };
                yield return new[] { k * w, h };
                yield return new[] { -k * w, h };
            }
        }

        private static bool Hits(double[] r, List<double[]> others, double pad)
        {
            foreach (double[] o in others)
                if (r[0] < o[2] + pad && o[0] < r[2] + pad && r[1] < o[3] + pad && o[1] < r[3] + pad) return true;
            return false;
        }

        /// <summary>Элементийн харагдацын хүрээ дэлгээсний дотоод (X — баруун тийш, Y — дээш) тэгш өнцөгтөөр; уншигдахгүй бол null.</summary>
        private static double[] LocalRect(View v, WeFrame f, Element e)
        {
            BoundingBoxXYZ bb;
            try { bb = e.get_BoundingBox(v); } catch { return null; }
            if (bb == null) return null;
            double x0 = double.MaxValue, x1 = double.MinValue, y0 = double.MaxValue, y1 = double.MinValue;
            foreach (double x in new[] { bb.Min.X, bb.Max.X })
                foreach (double y in new[] { bb.Min.Y, bb.Max.Y })
                    foreach (double z in new[] { bb.Min.Z, bb.Max.Z })
                    {
                        XYZ q = bb.Transform != null ? bb.Transform.OfPoint(new XYZ(x, y, z)) : new XYZ(x, y, z);
                        WeV3 l = f.ToLocal(q.ToWe());
                        x0 = Math.Min(x0, l.X); x1 = Math.Max(x1, l.X); y0 = Math.Min(y0, l.Y); y1 = Math.Max(y1, l.Y);
                    }
            return x1 > x0 && y1 > y0 ? new[] { x0, y0, x1, y1 } : null;
        }

        /// <summary>Шошгоны толгой хүссэн цэгт (харагдацын хавтгайд, 1 мм-ийн дотор) байгаа эсэх.</summary>
        private bool PlacedNear(IndependentTag tag, XYZ head)
        {
            try
            {
                XYZ got = tag.TagHeadPosition;
                return got != null && got.DistanceTo(head) < Mm(1);
            }
            catch { return false; }
        }

        private bool HasKeynote(Element e)
        {
            try
            {
                Element type = _doc.GetElement(e.GetTypeId());
                Parameter pr = type != null ? type.get_Parameter(BuiltInParameter.KEYNOTE_PARAM) : null;
                if (pr == null) pr = e.get_Parameter(BuiltInParameter.KEYNOTE_PARAM);
                return pr != null && pr.HasValue && !string.IsNullOrWhiteSpace(pr.AsString());
            }
            catch { return true; }
        }

        // ── Түвшний тэмдгийг хэмжээсний гадна ───────────────────────

        /// <summary>
        /// Түвшний шугамыг (ЗӨВХӨН энэ харагдацад) баруун тийш <paramref name="needX"/> хүртэл уртасгана — тэмдэг нь давхар
        /// хоорондын хэмжээсийн гадна гарна.  Хэзээ ч богиносгохгүй; чадахгүй бол хэвээр.
        /// </summary>
        private void ExtendLevelHeads(View v, WePlannedElevation p, double needX)
        {
            WeFrame f = p.Frame;
            double zLo = f.Origin.Z + p.Box.MinY, zHi = f.Origin.Z + p.Box.MaxY;
            foreach (Level l in new FilteredElementCollector(_doc).OfClass(typeof(Level)).Cast<Level>())
            {
                double lz = WeAnnoSourceReader.LevelZ(l);
                if (lz < zLo - 1e-6 || lz > zHi + 1e-6 || !Visible(l.Id)) continue;
                try
                {
                    IList<Curve> cs = l.GetCurvesInView(DatumExtentType.ViewSpecific, v);
                    var line = cs != null && cs.Count == 1 ? cs[0] as Line : null;
                    if (line == null) continue;
                    XYZ e0 = line.GetEndPoint(0), e1 = line.GetEndPoint(1);
                    double x0 = f.ToLocal(e0.ToWe()).X, x1 = f.ToLocal(e1.ToWe()).X;
                    bool endIs1 = x1 >= x0;
                    double cur = Math.Max(x0, x1);
                    if (cur >= needX) continue;
                    XYZ end = endIs1 ? e1 : e0, other = endIs1 ? e0 : e1;
                    XYZ dir = (end - other).Normalize();
                    double k = dir.DotProduct(f.Right.ToXyz());
                    if (k < 0.5) continue;
                    XYZ newEnd = end + dir * ((needX - cur) / k);
                    Line nl = endIs1 ? Line.CreateBound(other, newEnd) : Line.CreateBound(newEnd, other);
                    l.SetDatumExtentType(endIs1 ? DatumEnds.End1 : DatumEnds.End0, v, DatumExtentType.ViewSpecific);
                    if (l.IsCurveValidInView(DatumExtentType.ViewSpecific, v, nl)) l.SetCurveInView(DatumExtentType.ViewSpecific, v, nl);
                }
                catch (Exception ex)
                {
                    WeLog.Info("annotate", v.Name + ": түвшин «" + l.Name + "» — " + ex.Message);
                }
            }
        }

        // ── Тод / бүдэг хэсэг, улаан хүрээ (2026-10-14, интерьерийн баг 3-р тойрог) ──

        /// <summary>
        /// Жишээ хуудас 232: таазнаас дээд хучилт хүртэл БҮДЭГ (opacity <see cref="WeSettings.FadeOpacity"/> %), дэлгээсийг бөөрөнхий улаан тасархай
        /// хүрээгээр.  Бүтээсэн элемент <paramref name="ids"/>-д (дахин ажиллуулахад солигдоно).
        /// </summary>
        /// <summary>Бүдэг хэсгийн доод хил тод хэсгийн оройноос дээш (цаасны мм) — тэр шугам (тааз) бүдгэрэхгүй.</summary>
        internal const double FadeEdgeClearMm = 0.6;

        private void Decorate(View v, WePlannedElevation p, WeAnnotationPlan plan, List<ElementId> ids)
        {
            if (p == null || p.Frame == null || p.Box == null) return;
            WeFrame f = p.Frame;
            WeBox b = p.Box;
            Func<double, double, XYZ> pt = (lx, ly) => OnPlane(v, f.ToWorld(lx, ly, 0).ToXyz());
            // W09: бүдэг хэсэг өрөөний ЗОРИУЛАЛТААР — төлөвлөгч FadeFromY-г зөвхөн бүдэгрүүлэх зориулалтад тооцно.
            if (plan != null && !double.IsNaN(plan.FadeFromY))
            {
                // ХЭМЖСЭН (gate PDF-FADE-101, вектор PDF пикселээр): хил яг таазны шугам дээр байхад тэр шугам ӨӨРӨӨ бүдгэрч (0 → 204) байв —
                // тааз тод байх ёстой.  Цаасан дээр 0.6 мм дээш (шугамын хагас зузаан + нөөц; 1:50-д 30 мм).
                double y0 = Math.Max(plan.FadeFromY + Paper(FadeEdgeClearMm), b.MinY), y1 = b.MaxY;
                if (y1 - y0 >= Paper(1)) Fade(v, pt, b.MinX, y0, b.MaxX, y1, ids);
            }
            if (_s.RedFrame)
                ids.AddRange(WeRedFrame.Draw(_doc, v, pt, f.Right.ToXyz(), f.Up.ToXyz(), b.MinX, b.MinY, b.MaxX, b.MaxY, Paper(1), _notes));
        }

        /// <summary>
        /// Бүдэг хэсэг = MASKING REGION (харагдагдахгүй хүрээтэй) + харагдацад тунгалаг байдал = opacity.  ⚠️ ХЭМЖСЭН (Revit 2024, gate
        /// DIAG-SPOT-FADE-FRAME, PNG пикселээр): энгийн цагаан дүүргэлт + тунгалаг байдал нь зөвхөн ГАДАРГУУГ цайруулж, загварын хар шугамыг ХЭВЭЭР
        /// хар үлдээдэг (0 → 0); masking region нь шугамыг ч бүдгэрүүлдэг (T = 20: хар шугам → 0.8·цаас + 0.2·шугам) — тиймээс masking region.
        /// Тунгалаг байдал тогтоогоогүй бол (буцаан уншиж шалгана) бүрэн далдлах давхарга ҮЛДЭЭХГҮЙ — устгаад тэмдэглэнэ.
        /// </summary>
        private void Fade(View v, Func<double, double, XYZ> pt, double x0, double y0, double x1, double y1, List<ElementId> ids)
        {
            FilledRegion mask = null;
            int opacity = Math.Max(0, Math.Min(100, _s.FadeOpacity));
            try
            {
                XYZ a = pt(x0, y0), bb = pt(x1, y0), c = pt(x1, y1), d = pt(x0, y1);
                var loop = new CurveLoop();
                loop.Append(Line.CreateBound(a, bb));
                loop.Append(Line.CreateBound(bb, c));
                loop.Append(Line.CreateBound(c, d));
                loop.Append(Line.CreateBound(d, a));
                mask = FilledRegion.CreateMaskingRegion(_doc, v.Id, new List<CurveLoop> { loop });
                ElementId inv = InvisibleFillLineStyle();
                if (inv != null) mask.SetLineStyleId(inv);
                else _notes.Add("«<Invisible lines>» шугамын хэв маяг олдсонгүй — бүдэг хэсгийн хил нимгэн шугамаар харагдана.");
                var ogs = new OverrideGraphicSettings();
                ogs.SetSurfaceTransparency(opacity);
                v.SetElementOverrides(mask.Id, ogs);
                if (v.GetElementOverrides(mask.Id).Transparency != opacity)
                {
                    _doc.Delete(mask.Id);
                    _notes.Add("Дэлгээсийн дээд хэсгийг бүдэгрүүлж чадсангүй (тунгалаг байдал тогтсонгүй) — давхаргыг үлдээгээгүй.");
                    return;
                }
                ids.Add(mask.Id);
            }
            catch (Exception ex)
            {
                if (mask != null) { try { if (mask.IsValidObject) _doc.Delete(mask.Id); } catch { } }
                WeLog.Info("annotate", v.Name + ": бүдэг хэсэг — " + ex.Message);
                _notes.Add("Дэлгээсийн дээд хэсгийг бүдэгрүүлж чадсангүй: " + ex.Message);
            }
        }

        private ElementId _invisibleFill;
        private bool _invisibleFillResolved;

        /// <summary>Дүүргэлтийн хилд хэрэглэж болох «&lt;Invisible lines&gt;» (ангиллын хэв маяг, эсвэл нэрээр).</summary>
        private ElementId InvisibleFillLineStyle()
        {
            if (_invisibleFillResolved) return _invisibleFill;
            _invisibleFillResolved = true;
            try
            {
                IList<ElementId> valid = FilledRegion.GetValidLineStyleIdsForFilledRegion(_doc);
                GraphicsStyle cat = InvisibleLines();
                if (cat != null && valid.Contains(cat.Id)) _invisibleFill = cat.Id;
                else
                    _invisibleFill = valid.FirstOrDefault(i =>
                    {
                        var gs = _doc.GetElement(i) as GraphicsStyle;
                        return gs != null && gs.Name.IndexOf("Invisible", StringComparison.OrdinalIgnoreCase) >= 0;
                    });
            }
            catch { _invisibleFill = null; }
            return _invisibleFill;
        }

        // ── Туслах ──────────────────────────────────────────────────

        private static XYZ OnPlane(View v, XYZ p)
        {
            XYZ n = v.ViewDirection;
            return p - n * (p - v.Origin).DotProduct(n);
        }

        private double Paper(double mm) { return _u.MmToInternal(mm * Math.Max(1, _s.Scale)); }

        private double Mm(double mm) { return _u.MmToInternal(mm); }

        private static string Label(string key)
        {
            WeAnno.Row r = WeAnno.Find(key);
            return r != null ? r.Label : key;
        }

        private static string Append(string a, string b) { return string.IsNullOrEmpty(a) ? b : a + "; " + b; }
    }

    /// <summary>Тэмдэглэгээний transaction: анхааруулгыг нууна; ЗӨВХӨН энэ ажиллагаанд үүссэн элементийн алдааг устгаж үргэлжилнэ.</summary>
    internal sealed class WeAnnoFailures : IFailuresPreprocessor
    {
        private readonly HashSet<long> _created;
        private readonly Dictionary<long, string> _what;
        private int _idlessPasses;
        public int WarningsHidden;
        public int RemovedDims;
        public int RemovedSpots;
        public int RemovedTags;
        public string LastError;

        public WeAnnoFailures(HashSet<long> created, Dictionary<long, string> what = null)
        {
            _created = created;
            _what = what ?? new Dictionary<long, string>();
        }

        public FailureProcessingResult PreprocessFailures(FailuresAccessor accessor)
        {
            try
            {
                if (!accessor.IsTransactionBeingCommitted()) return FailureProcessingResult.Continue;
            }
            catch
            {
                return FailureProcessingResult.Continue;
            }
            var delete = new List<ElementId>();
            var idless = new List<FailureMessageAccessor>();
            bool other = false;
            foreach (FailureMessageAccessor f in accessor.GetFailureMessages())
            {
                if (f.GetSeverity() == FailureSeverity.Warning)
                {
                    accessor.DeleteWarning(f);
                    WarningsHidden++;
                    continue;
                }
                // ХЭМЖСЭН (MITIC 2-р давхар, 2026-10-08): «One or more dimension references are or have become invalid» алдааны
                // failing элемент нь ЛАВЛАГДСАН элемент (link instance, тааз) байж, манай хэмжээс нь additional-д л байдаг — өмнө нь
                // «манайх биш» гэж үзээд 6 дэлгээсийн 19 тэмдэглэгээг бүгдийг буцаадаг байв.  Одоо алдаанд оролцсон (failing ∪
                // additional) элементээс ЗӨВХӨН энэ ажиллагаанд үүссэнийг устгана; манай элемент огт оролцоогүй бол буцаана.
                var all = new List<ElementId>();
                try { all.AddRange(f.GetFailingElementIds()); } catch { }
                try { all.AddRange(f.GetAdditionalElementIds()); } catch { }
                List<ElementId> ids = all.Where(id => _created.Contains(id.Value)).Distinct().ToList();
                if (ids.Count == 0 && all.All(id => id == null || id == ElementId.InvalidElementId))
                {
                    // ХЭМЖСЭН: Revit ижил «dimension references invalid» алдааг id-ГҮЙ (-1) хувилбараар ДАВХАР мэдээлдэг.  Өгөгдмөл
                    // шийдлээр (ResolveFailure) шийдвэл тэр нь ДАХИН ДАХИН гарч (1300 удаа, 2026-10-08) эцэст нь бүгд буцаагдсан —
                    // тиймээс эхлээд манай алдаатай хэмжээсийг устгаад дахин commit; id-гүй нь ганцаараа үлдвэл доор.
                    idless.Add(f);
                    continue;
                }
                if (ids.Count == 0)
                {
                    other = true;
                    LastError = f.GetDescriptionText();
                    WeLog.Info("annotate", "Revit алдаа (манай элемент оролцоогүй): " + LastError + " · " + string.Join(", ", all.Select(id => Describe(accessor.GetDocument(), id))));
                    continue;
                }
                WeLog.Info("annotate", "Revit алдаа → манай " + ids.Count + " элементийг устгана: " + f.GetDescriptionText() + " · "
                                       + string.Join(", ", all.Select(id => Describe(accessor.GetDocument(), id) + (_created.Contains(id.Value) ? "*" : "")))
                                       + " · " + string.Join(" | ", ids.Select(id => { string w; return _what.TryGetValue(id.Value, out w) ? w : "?"; })));
                foreach (ElementId id in ids)
                {
                    if (delete.Contains(id)) continue;
                    delete.Add(id);
                    Element e = accessor.GetDocument().GetElement(id);
                    if (e is SpotDimension) RemovedSpots++;
                    else if (e is Dimension) RemovedDims++;
                    else if (e is IndependentTag) RemovedTags++;
                }
            }
            if (other) return FailureProcessingResult.ProceedWithRollBack;
            if (delete.Count == 0 && idless.Count > 0)
            {
                // Манай элемент нэрлэгдээгүй, id-гүй алдаа л үлдсэн: манай хэмжээсүүдээс лавлагаа нь ХҮЧИНГҮЙ болсныг өөрсдөө олж устгана.
                _idlessPasses++;
                Document doc = accessor.GetDocument();
                foreach (long id in _created)
                {
                    var d = doc.GetElement(new ElementId(id)) as Dimension;
                    if (d == null || !InvalidRefs(doc, d)) continue;
                    delete.Add(d.Id);
                    RemovedDims++;
                }
                string what = string.Join(" | ", delete.Select(id => { string w; return _what.TryGetValue(id.Value, out w) ? w : id.Value.ToString(); }));
                if (_idlessPasses == 1)
                    try { WeLog.Info("annotate", "id-гүй алдаа: " + idless[0].GetFailureDefinitionId().Guid + " · " + idless[0].GetDefaultResolutionCaption()
                                                 + " · манай " + _created.Count + " элемент: " + string.Join(", ", _created.Take(80).Select(x => Describe(doc, new ElementId(x))))); }
                    catch { }
                WeLog.Info("annotate", "Revit алдаа (id-гүй, " + _idlessPasses + "-р удаа) " + idless.Count + "× — хүчингүй лавлагаатай манай хэмжээс " + delete.Count
                                       + (delete.Count > 0 ? ": " + what : string.Empty));
                if (delete.Count == 0)
                {
                    if (_idlessPasses > 3) { LastError = idless[0].GetDescriptionText(); return FailureProcessingResult.ProceedWithRollBack; }
                    bool any = false;
                    foreach (FailureMessageAccessor f in idless)
                        try { if (f.HasResolutions()) { accessor.ResolveFailure(f); any = true; } } catch { }
                    return any ? FailureProcessingResult.ProceedWithCommit : FailureProcessingResult.Continue;
                }
            }
            if (delete.Count == 0) return FailureProcessingResult.Continue;
            try { accessor.DeleteElements(delete); }
            catch (Exception ex) { LastError = ex.Message; return FailureProcessingResult.ProceedWithRollBack; }
            return FailureProcessingResult.ProceedWithCommit;
        }

        /// <summary>Хэмжээсийн лавлагааны элемент алга эсвэл хэмжээс сегментгүй — Revit-ийн «references invalid»-ийн шалтгаан.</summary>
        private static bool InvalidRefs(Document doc, Dimension d)
        {
            try
            {
                ReferenceArray refs = d.References;
                if (refs == null || refs.Size < (d is SpotDimension ? 1 : 2)) return true;
                foreach (Reference r in refs)
                {
                    if (r == null) return true;
                    if (r.LinkedElementId != ElementId.InvalidElementId) continue;   // link-ийн лавлагаа — instance нь бий
                    if (doc.GetElement(r.ElementId) == null) return true;
                }
                if (d is SpotDimension) return false;
                if (d.NumberOfSegments == 0) return d.Value == null;
                foreach (DimensionSegment sg in d.Segments) if (sg.Value == null) return true;
                return false;
            }
            catch { return true; }
        }

        private static string Describe(Document doc, ElementId id)
        {
            try
            {
                Element e = doc.GetElement(id);
                return id.Value + (e == null ? "" : ":" + (e.Category != null ? e.Category.Name : e.GetType().Name));
            }
            catch { return id.Value.ToString(); }
        }
    }

    /// <summary>Тэмдэглэгээний мөрийн түлхүүр ↔ Revit-ийн ангилал (элемент ба шошго).</summary>
    internal static class WeRevitCategories
    {
        public static readonly KeyValuePair<string, BuiltInCategory>[] Others =
        {
            new KeyValuePair<string, BuiltInCategory>("curtainpanels", BuiltInCategory.OST_CurtainWallPanels),
            new KeyValuePair<string, BuiltInCategory>("generic", BuiltInCategory.OST_GenericModel),
            new KeyValuePair<string, BuiltInCategory>("furniture", BuiltInCategory.OST_Furniture),
            new KeyValuePair<string, BuiltInCategory>("casework", BuiltInCategory.OST_Casework),
            new KeyValuePair<string, BuiltInCategory>("plumbing", BuiltInCategory.OST_PlumbingFixtures),
            new KeyValuePair<string, BuiltInCategory>("specialty", BuiltInCategory.OST_SpecialityEquipment),
            // Интерьер (2026-10-08): цахилгаан цэг — нэг мөр, олон Revit ангилал (шошго нь элементийн өөрийн ангиллаар).
            new KeyValuePair<string, BuiltInCategory>(WeAnno.Electrical, BuiltInCategory.OST_ElectricalFixtures),
            new KeyValuePair<string, BuiltInCategory>(WeAnno.Electrical, BuiltInCategory.OST_LightingDevices),
            new KeyValuePair<string, BuiltInCategory>(WeAnno.Electrical, BuiltInCategory.OST_LightingFixtures),
            new KeyValuePair<string, BuiltInCategory>(WeAnno.Electrical, BuiltInCategory.OST_DataDevices),
            new KeyValuePair<string, BuiltInCategory>(WeAnno.Electrical, BuiltInCategory.OST_CommunicationDevices),
            new KeyValuePair<string, BuiltInCategory>(WeAnno.Electrical, BuiltInCategory.OST_TelephoneDevices),
            new KeyValuePair<string, BuiltInCategory>(WeAnno.Electrical, BuiltInCategory.OST_SecurityDevices),
            new KeyValuePair<string, BuiltInCategory>(WeAnno.Electrical, BuiltInCategory.OST_FireAlarmDevices),
            new KeyValuePair<string, BuiltInCategory>(WeAnno.Electrical, BuiltInCategory.OST_NurseCallDevices),
            // Шалны хүрээ, хананы бүс (Wall Sweep) — өнгөлгөөний бүсийн ирмэг.
            new KeyValuePair<string, BuiltInCategory>(WeAnno.Finishes, BuiltInCategory.OST_Cornices),
        };

        /// <summary>Элементийн ӨӨРИЙН ангиллын шошгоны ангилал (нэг мөрөнд олон Revit ангилал — цахилгаан цэг).</summary>
        public static bool TagCategoryOf(Element e, out BuiltInCategory cat)
        {
            cat = BuiltInCategory.INVALID;
            if (e == null || e.Category == null) return false;
            switch ((BuiltInCategory)(int)e.Category.Id.Value)
            {
                case BuiltInCategory.OST_ElectricalFixtures: cat = BuiltInCategory.OST_ElectricalFixtureTags; return true;
                case BuiltInCategory.OST_LightingDevices: cat = BuiltInCategory.OST_LightingDeviceTags; return true;
                case BuiltInCategory.OST_LightingFixtures: cat = BuiltInCategory.OST_LightingFixtureTags; return true;
                case BuiltInCategory.OST_DataDevices: cat = BuiltInCategory.OST_DataDeviceTags; return true;
                case BuiltInCategory.OST_CommunicationDevices: cat = BuiltInCategory.OST_CommunicationDeviceTags; return true;
                case BuiltInCategory.OST_TelephoneDevices: cat = BuiltInCategory.OST_TelephoneDeviceTags; return true;
                case BuiltInCategory.OST_SecurityDevices: cat = BuiltInCategory.OST_SecurityDeviceTags; return true;
                case BuiltInCategory.OST_FireAlarmDevices: cat = BuiltInCategory.OST_FireAlarmDeviceTags; return true;
                case BuiltInCategory.OST_NurseCallDevices: cat = BuiltInCategory.OST_NurseCallDeviceTags; return true;
                default: return false;
            }
        }

        public static bool TagCategory(string key, out BuiltInCategory cat)
        {
            switch (key)
            {
                case "walls": cat = BuiltInCategory.OST_WallTags; return true;
                case "doors": cat = BuiltInCategory.OST_DoorTags; return true;
                case "windows": cat = BuiltInCategory.OST_WindowTags; return true;
                case "ceilings": cat = BuiltInCategory.OST_CeilingTags; return true;
                case "floors": cat = BuiltInCategory.OST_FloorTags; return true;
                case "curtainpanels": cat = BuiltInCategory.OST_CurtainWallPanelTags; return true;
                case "generic": cat = BuiltInCategory.OST_GenericModelTags; return true;
                case "furniture": cat = BuiltInCategory.OST_FurnitureTags; return true;
                case "casework": cat = BuiltInCategory.OST_CaseworkTags; return true;
                case "plumbing": cat = BuiltInCategory.OST_PlumbingFixtureTags; return true;
                case "specialty": cat = BuiltInCategory.OST_SpecialityEquipmentTags; return true;
                default: cat = BuiltInCategory.INVALID; return false;
            }
        }
    }
}
