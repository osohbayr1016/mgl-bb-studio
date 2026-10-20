using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Revit
{
    /// <summary>Нэг дэлгээсний эцсийн үр дүн.</summary>
    internal sealed class WeRunItem
    {
        public WePlannedElevation Plan;
        public WeStatus Status;
        public string Message;
        public string Outcome;
        public ElementId ViewId = ElementId.InvalidElementId;
        public string ViewName;
        public bool Created;
        public bool Changed;
        /// <summary>
        /// W01: энэ ажилд тавьсан тэмдэглэгээний тоо (дэлгээс тус бүр) — эх өгөгдөл өөрчлөгдөж ДАХИН ТӨЛӨВЛӨСӨН ажлын тайланд өмнөх
        /// хэсгийн тоог давхар тоолохгүй нэгтгэнэ (<see cref="WallElevation.WeJob"/>).
        /// </summary>
        public bool Annotated;
        public int Dims;
        public int Spots;
        public int Tags;
        public int Keynotes;
    }

    internal sealed class WeRunResult
    {
        public readonly List<WeRunItem> Items = new List<WeRunItem>();
        public readonly List<string> Notes = new List<string>();
        public WeTimings Timings;
        public int SheetsCreated;
        public int ViewportsPlaced;
        public int WarningsHidden;
        public int MarkersHidden;
        public int AnnoDims;
        public int AnnoSpots;
        public int AnnoTags;
        public int AnnoKeynotes;
        public int AnnoFailed;
        public int AnnoRemoved;
        /// <summary>Түлхүүр план / 3D: шинээр үүсгэсэн ба шинэчилсэн тоо; хуудсанд байрлуулсан нэмэлт блок.</summary>
        public int KeyPlansCreated;
        public int KeyPlansUpdated;
        public int AxonsCreated;
        public int AxonsUpdated;
        public int ExtrasPlaced;
        public bool Committed;
        /// <summary>Энэ ажиллагааны хуудсууд (бүлэг бүрийн эхний хуудас, бүлгийн дарааллаар) — дууссаны дараа эхнийхийг нээнэ.</summary>
        public readonly List<ElementId> Sheets = new List<ElementId>();

        public int Count(Func<WeRunItem, bool> f) { return Items.Count(f); }
    }

    /// <summary>
    /// Төлөвлөгөөг загварт хэрэгжүүлнэ — НЭГ <see cref="TransactionGroup"/> (нэг Ctrl+Z), дотор нь үе шатаар:
    ///   1. харагдац үүсгэх/шинэчлэх (дэлгээс тус бүр SubTransaction — нэг муу хана бусдыг буцаахгүй);
    ///   2. төрөл / масштаб / загвар / far clip;
    ///   3. ШАЛГАЛТ (уншина) — буруу ШИНЭ харагдацыг устгана (хэрэглэгчийн ажлыг хэзээ ч биш);
    ///   4. (сонголтоор) хуудас.
    /// Transaction хана бүрт биш, collector хана бүрт биш, Regenerate зөвхөн эргүүлэх/зөөх ховор замд.
    /// 2026-10-07-оос АЛХМЫН МАШИН (<see cref="Begin"/> → <see cref="Step"/> … → <see cref="Done"/>): арын горим (<see cref="WeJob"/>) алхам
    /// бүрийг Revit-ийн Idling-д, синхрон <see cref="Run"/> бүгдийг нэг TransactionGroup-д ажиллуулна.
    /// </summary>
    internal sealed class ElevationGenerationCoordinator
    {
        private readonly Document _doc;
        /// <summary>Зүсэлт — Section горим ба өмнөх хувилбарын зүсэлтийг шинэчлэхэд.</summary>
        private readonly SectionElevationViewFactory _section;
        /// <summary>Elevation маркер — Elevation горимын ШИНЭ дэлгээс ба Elevation харагдацыг шинэчлэхэд.</summary>
        private readonly ElevationViewFactory _elevation;
        private readonly WeResources _res;
        private readonly WeSettings _s;
        private readonly IWeUnits _units;

        public ElevationGenerationCoordinator(Document doc, IWallElevationViewFactory factory, WeResources res, WeSettings s, IWeUnits units)
        {
            _doc = doc; _res = res; _s = s; _units = units;
            _section = factory as SectionElevationViewFactory ?? new SectionElevationViewFactory();
            _elevation = new ElevationViewFactory(doc, res, s.Scale);
        }

        /// <summary>
        /// СИНХРОН гүйцэтгэл (Revit дотрох шалгалт, арын хост бэлэн биш үед): <see cref="Begin"/> + бүх <see cref="Step"/> НЭГ
        /// <see cref="TransactionGroup"/>-д → нэг Ctrl+Z.  Арын горим (<see cref="WeJob"/>) ЯГ ижил алхмуудыг Revit-ийн Idling-д нэг нэгээр
        /// ажиллуулна — туршсан зам = хэрэглэгчийн зам.
        /// </summary>
        public WeRunResult Run(WePlan plan, WeTimings timings)
        {
            WeRunResult result = Begin(plan, timings);
            if (Done) return result;
            using (var tg = new TransactionGroup(_doc, "MGL — Ханын дэлгээс"))
            {
                tg.Start();
                while (!Done) Step();
                if (result.Committed) tg.Assimilate();
                else tg.RollBack();
            }
            return result;
        }

        // ── Алхам алхмаар (2026-10-07) ─────────────────────────────
        // Эзний хүсэлт: «хуудас үүсгэх дарсны дараа mouse loading болоод Revit-ээ ашиглаж чадахгүй — зураг клонлох шиг хүлээх хооронд
        // дараагийн зургаа хийж суумаар байна».  Нэг алхам = нэг богино ажил (нэг дэлгээс үүсгэх ≈ 0.9 с — Revit-ийн CreateElevation
        // өөрөө 0.8 с; тэмдэглэгээ ≈ 0.25 с; viewport ≈ 0.4 с).  Алхмын хооронд хэрэглэгч Revit-д чөлөөтэй.

        /// <summary>
        /// Үе шатын дараалал.  Elevation горимд түлхүүр план (<see cref="Phase.KeyPlans"/>) дэлгээсээс ӨМНӨ: маркерыг өрөөгөөр тайрсан
        /// түлхүүр план дээр үүсгэвэл Revit-ийн <c>CreateElevation</c> 0.79 с → 0.19 с (ХЭМЖСЭН, GATEWAY 2026-10-07 — давхрын бүтэн план дээр
        /// Revit барилгын 113 м хүрээг тооцдог).  Маркер бүх планд ижил харагдана, суурь планыг устгахад дэлгээс устахгүй (хэмжсэн).
        /// Зүсэлтийн горимд түлхүүр план бичвэр тэмдгээ бодит харагдацаар зурдаг тул дэлгээсийн ДАРАА.
        /// </summary>
        private enum Phase { KeyPlansFirst, Views, Markers, Annotate, Tidy, KeyPlans, Axons, Sheets, References, End, Done }

        private Phase _phase = Phase.Done;
        private int _idx;
        private WePlan _runPlan;
        private WeRunResult _result;
        private WeTimings _timings;
        private List<WeRunItem> _work = new List<WeRunItem>();
        private List<WeRunItem> _kept = new List<WeRunItem>();
        private List<WeRunItem> _touched = new List<WeRunItem>();
        private List<WeRunItem> _placeable = new List<WeRunItem>();
        private ElementId _template;
        /// <summary>W09: зориулалт тус бүрийн view template (дуудлага бүрт дахин хайхгүй).</summary>
        private readonly Dictionary<string, ElementId> _presetTemplates = new Dictionary<string, ElementId>(StringComparer.Ordinal);
        private bool _sheets;
        private WeAnnotator _annotator;
        private WeViewTidy _tidy;
        private readonly Dictionary<string, WeGroupViews> _extras = new Dictionary<string, WeGroupViews>(StringComparer.Ordinal);
        private readonly List<string> _extraNotes = new List<string>();
        private List<WeGroupInfo> _extraSteps;
        private bool _keyFirst;
        private WeKeyPlanService _keySvc;
        private WeAxonService _axonSvc;
        private WeSheetService _sheetSvc;
        private int _unitsDone, _unitsTotal;

        public bool Done { get { return _phase == Phase.Done; } }
        /// <summary>W01: хуудасны бүлгийн дунд — дахин төлөвлөлтийг бүлэг дуустал хойшлуулна (<see cref="WeSheetService.InGroup"/>).</summary>
        public bool MidSheetGroup { get { return _phase == Phase.Sheets && _sheetSvc != null && _sheetSvc.InGroup; } }
        /// <summary>Одоогийн/дараагийн алхам («310A — харагдац үүсгэж байна») — самбарт.</summary>
        public string Status { get; private set; }
        /// <summary>Сүүлд гүйцэтгэсэн алхмын шошго — Undo жагсаалтын нэр («MGL дэлгээс #3 · 310A (1/8) — харагдац үүсгэж байна»).</summary>
        public string LastStepLabel { get; private set; }
        /// <summary>0..1 — алхмын тоогоор (дэлгээс ба viewport-ийн алхам ойролцоо ижил урт).</summary>
        public double Fraction
        {
            get
            {
                if (_phase == Phase.Done) return 1;
                int total = _sheetSvc != null && _phase == Phase.Sheets ? _unitsDone + _sheetSvc.RemainingSteps : _unitsTotal;
                return Math.Min(0.99, (double)_unitsDone / Math.Max(1, Math.Max(total, _unitsDone + 1)));
            }
        }
        public WeRunResult Result { get { return _result; } }
        /// <summary>Энэ ажиллагааны шинэ болон шинэчилсэн дэлгээс (хуудас нээх, тайланд).</summary>
        public IList<WeRunItem> Touched { get { return _touched; } }

        /// <summary>Бэлтгэл (загварт хүрэхгүй): ажлын жагсаалт, төрөл, загвар.  Дараа нь <see cref="Step"/>-ийг <see cref="Done"/> хүртэл.</summary>
        public WeRunResult Begin(WePlan plan, WeTimings timings)
        {
            var result = new WeRunResult { Timings = timings };
            _result = result;
            _timings = timings;
            _runPlan = plan;
            _phase = Phase.Done;
            foreach (WePlannedElevation p in plan.Items)
                result.Items.Add(new WeRunItem { Plan = p, Status = p.Status, Message = p.Message, ViewName = p.Name, Outcome = InitialOutcome(p) });

            _work = result.Items.Where(i => i.Plan.Action == WeAction.Create || i.Plan.Action == WeAction.Update).ToList();
            _kept = result.Items.Where(i => i.Plan.Action == WeAction.Keep && i.Plan.ExistingViewId != 0).ToList();
            foreach (WeRunItem k in _kept) k.ViewId = new ElementId(k.Plan.ExistingViewId);
            _sheets = _s.Output == WeOutputMode.ViewsAndSheets;
            if (_work.Count == 0 && !_sheets) return result;

            bool createOwn;
            _vft = _res.ResolveViewType(_s, out createOwn);
            _createOwn = createOwn;
            if (_vft == null && !createOwn && _work.Any(w => w.Plan.Action == WeAction.Create))
            {
                foreach (WeRunItem w in _work)
                    Fail(w, _s.ViewKind == WeViewKind.Section ? "Зүсэлтийн харагдацын төрөл (Section view type) загварт алга"
                                                             : "Elevation харагдацын төрөл (Building/Interior Elevation) загварт алга");
                return result;
            }
            bool tplMissing;
            _template = _res.ResolveTemplate(_s, out tplMissing);
            if (tplMissing) result.Notes.Add("Сонгосон загвар (view template) олдсонгүй — төрлийн өгөгдмөлөөр.");
            _presetTemplates.Clear();

            _touched = new List<WeRunItem>();
            _extras.Clear();
            _extraNotes.Clear();
            _annotator = null;
            _tidy = null;
            _sheetSvc = null;
            // Алхмын тоо (явц): дэлгээс бүр 3 (үүсгэх, тэмдэглэгээ, цэгцлэх) + тэмдэг нуух + өрөө бүрт түлхүүр план, 3D.
            int groups = _sheets ? plan.Groups.Count : 0;
            // + хуудас: хүрээ, бүлэг бүрт хуудас + зохиомж, viewport бүр (дэлгээс + түлхүүр план + 3D).
            _unitsTotal = _work.Count * 3 + 1 + groups * 2 + (_sheets ? 1 + groups * 4 + plan.Items.Count : 0);
            _unitsDone = 0;
            _idx = 0;
            _extraSteps = null;
            // W09: түлхүүр план өрөөний ЗОРИУЛАЛТААР (төлөвлөгч бүлэг бүрт шийдсэн).
            _keyFirst = _s.ViewKind == WeViewKind.Elevation && _sheets && plan.Groups.Any(g => g.KeyPlan != null);
            _elevation.HostPlans.Clear();
            _phase = _keyFirst ? Phase.KeyPlansFirst : Phase.Views;
            Status = "Эхэлж байна…";
            return result;
        }

        /// <summary>НЭГ богино алхам.  Хэзээ ч шидэхгүй (алдаа дэлгээс/тэмдэглэлд).  Шилжилтийн «хоосон» алхмыг алгасна.</summary>
        public void Step()
        {
            for (int guard = 0; guard < 20 && _phase != Phase.Done; guard++)
            {
                bool worked;
                LastStepLabel = null;
                try { worked = StepPhase(); if (worked) LastStepLabel = Status; }
                catch (Exception ex)
                {
                    // Үе шатын ГАДУУРХ гэнэтийн алдаа — энэ үе шатыг орхиж дараагийнх руу.
                    WeLog.Error("run", "алхам «" + Status + "»", ex);
                    _result.Notes.Add("Алдаа (" + Status + "): " + ex.Message);
                    _idx = int.MaxValue / 2;
                    worked = true;
                }
                if (worked) return;
            }
        }

        private bool StepPhase()
        {
            switch (_phase)
            {
                case Phase.Views:
                    if (_idx >= _work.Count)
                    {
                        _touched = _work.Where(w => w.ViewId != ElementId.InvalidElementId).ToList();
                        Next(Phase.Markers);
                        return false;
                    }
                    {
                        WeRunItem w = _work[_idx++];
                        Status = w.Plan.Label + " (" + _idx + "/" + _work.Count + ") — харагдац " + (w.Plan.Action == WeAction.Create ? "үүсгэж" : "шинэчилж") + " байна";
                        var one = new List<WeRunItem> { w };
                        _timings.Measure("харагдац үүсгэх", () => { if (CreateOrUpdate(one, _result)) _result.Committed = true; });
                        if (w.ViewId != ElementId.InvalidElementId)
                        {
                            ElementId tpl = TemplateFor(w.Plan);
                            _timings.Measure("загвар, масштаб", () => Configure(one, _vft, tpl, _result));
                            _timings.Measure("шалгалт", () => Validate(one, tpl, _result));
                        }
                        _unitsDone++;
                        return true;
                    }

                case Phase.Markers:
                    Next(_touched.Count > 0 ? Phase.Annotate : (_keyFirst ? Phase.Axons : Phase.KeyPlans));
                    if (_s.HideOtherMarkers && _touched.Count + _kept.Count > 0)
                    {
                        Status = "Бусад дэлгээсийн тэмдгийг нууж байна";
                        _timings.Measure("тэмдэг нуух", () => { HideOtherMarkers(_touched.Concat(_kept).ToList(), _touched, _result); HideForeignOnKeyPlans(); HideOwnOnOfficeSheets(); });
                        _unitsDone++;
                        return true;
                    }
                    HideForeignOnKeyPlans();
                    HideOwnOnOfficeSheets();
                    _unitsDone++;
                    return false;

                case Phase.Annotate:
                    if (_annotator == null) _annotator = new WeAnnotator(_doc, _res, _s, _units);
                    if (_idx >= _touched.Count)
                    {
                        _annotator.Flush(_result);
                        Next(Phase.Tidy);
                        return false;
                    }
                    {
                        WeRunItem w = _touched[_idx++];
                        Status = w.Plan.Label + " (" + _idx + "/" + _touched.Count + ") — хэмжээс, тэмдэглэгээ";
                        int d0 = _result.AnnoDims, s0 = _result.AnnoSpots, t0 = _result.AnnoTags, k0 = _result.AnnoKeynotes;
                        _timings.Measure("тэмдэглэгээ", () =>
                        {
                            try { _annotator.RunItems(new List<WeRunItem> { w }, _result); }
                            catch (Exception ex)
                            {
                                WeLog.Error("annotate", "Тэмдэглэгээ", ex);
                                _result.Notes.Add("Тэмдэглэгээ тавьж чадсангүй (харагдацууд хэвээр): " + ex.Message);
                            }
                        });
                        if (_result.AnnoDims < d0 || _result.AnnoSpots < s0 || _result.AnnoTags < t0 || _result.AnnoKeynotes < k0)
                        {
                            // Revit энэ дэлгээсийн тэмдэглэгээг буцаасан (RunItems тоолуурыг тэглэдэг) — ӨМНӨХ дэлгээсүүдийн тоо хэвээр үлдэнэ;
                            // тэмдэг «хүлээгдэж буй» хэвээр тул дараагийн ажиллуулалт энэ дэлгээсийг дахин тэмдэглэнэ.
                            _result.AnnoDims = d0; _result.AnnoSpots = s0; _result.AnnoTags = t0; _result.AnnoKeynotes = k0;
                        }
                        else
                        {
                            w.Annotated = true;
                            w.Dims = _result.AnnoDims - d0;
                            w.Spots = _result.AnnoSpots - s0;
                            w.Tags = _result.AnnoTags - t0;
                            w.Keynotes = _result.AnnoKeynotes - k0;
                        }
                        _unitsDone++;
                        return true;
                    }

                case Phase.Tidy:
                    // Түвшин/тэнхлэгийн шугамыг дэлгээсийн өргөнд, annotation crop-ийг тэмдэглэгээнд — хуудсанд хэмжээ нь зөв (бодит загварт
                    // datum барилгын бүтэн өргөнөөр сунаж viewport-ийг 40 см болгодог байсан).
                    if (_tidy == null) _tidy = new WeViewTidy(_doc, _s, _units);
                    if (_idx >= _touched.Count)
                    {
                        Next(_keyFirst ? Phase.Axons : Phase.KeyPlans);
                        return false;
                    }
                    {
                        WeRunItem w = _touched[_idx++];
                        Status = w.Plan.Label + " (" + _idx + "/" + _touched.Count + ") — түвшин, тэнхлэг цэгцлэх";
                        _timings.Measure("цэгцлэх", () =>
                        {
                            try { _tidy.Run(new List<WeRunItem> { w }, _result); }
                            catch (Exception ex) { WeLog.Error("tidy", "Цэгцлэх", ex); }
                        });
                        _unitsDone++;
                        return true;
                    }

                case Phase.KeyPlansFirst:
                case Phase.KeyPlans:
                case Phase.Axons:
                    {
                        bool axon = _phase == Phase.Axons;
                        if (_extraSteps == null)
                        {
                            PreparePlaceable();
                            _extraSteps = new List<WeGroupInfo>();
                            if (_sheets)
                                foreach (WeGroupInfo g in _runPlan.Groups)
                                {
                                    if (_phase == Phase.KeyPlansFirst ? !PlannedKeys(g.GroupKey).Any() : !_placeable.Any(i => i.Plan.GroupKey == g.GroupKey)) continue;
                                    if (!_extras.ContainsKey(g.GroupKey)) _extras[g.GroupKey] = new WeGroupViews { Info = g };
                                    if (axon ? g.Axon != null : g.KeyPlan != null) _extraSteps.Add(g);   // W09: зориулалтаар төлөвлөгдсөн
                                }
                            _idx = 0;
                        }
                        if (_idx >= _extraSteps.Count)
                        {
                            _extraSteps = null;
                            if (axon && _axonSvc != null && _axonSvc.MsCreate + _axonSvc.MsBox + _axonSvc.MsRegen + _axonSvc.MsCrop > 0)
                                WeLog.Info("axon", "үүсгэх " + _axonSvc.MsCreate + " мс · хайрцаг+чиглэл " + _axonSvc.MsBox + " мс · regenerate " + _axonSvc.MsRegen + " мс · crop " + _axonSvc.MsCrop + " мс");
                            if (_phase == Phase.KeyPlansFirst) { Next(Phase.Views); return false; }
                            if (_phase == Phase.KeyPlans) { Next(Phase.Axons); return false; }
                            foreach (string n in _extraNotes.Distinct()) _result.Notes.Add(n);
                            _extraNotes.Clear();
                            // Дэлгээсгүй болсон өрөө (бүх тал унасан) — хуудас хэрэггүй.
                            foreach (string k in _extras.Keys.ToList())
                                if (!_placeable.Any(i => i.Plan.GroupKey == k)) _extras.Remove(k);
                            Next(_sheets ? Phase.Sheets : Phase.End);
                            return false;
                        }
                        WeGroupInfo g2 = _extraSteps[_idx++];
                        Status = (g2.Label ?? g2.GroupLabel) + " — " + (axon ? "3D харагдах байдал" : "түлхүүр байгуулалт");
                        _timings.Measure(axon ? "3D" : "түлхүүр план", () => { if (ExtraFor(g2, axon)) _result.Committed = true; });
                        _unitsDone++;
                        return true;
                    }

                case Phase.Sheets:
                    if (_sheetSvc == null)
                    {
                        _sheetSvc = new WeSheetService(_doc, _res, _s, _units);
                        bool any = false;
                        _timings.Measure("хуудас", () => any = _sheetSvc.Begin(_placeable, _result, _runPlan, _extras));
                        if (!any) { Next(Phase.End); return false; }
                    }
                    if (_sheetSvc.Finished)
                    {
                        if (_sheetSvc.Changed) _result.Committed = true;
                        Next(Phase.References);
                        return false;
                    }
                    _timings.Measure("хуудас", () => _sheetSvc.Step());
                    Status = "Хуудас — " + (_sheetSvc.StepLabel ?? "дуусгаж байна");
                    _unitsDone++;
                    if (_sheetSvc.Changed) _result.Committed = true;
                    return true;

                case Phase.References:
                    // W07: түлхүүр планы БИЧВЭР тэмдгийн хуудасны дугаар — хуудас байршуулсны ДАРАА бодит дугаартай тулгана (урьдчилан бичсэн
                    // дугаар өөрчлөгдсөн / харагдац хуудсанд ороогүй бол засна).  Revit-ийн Elevation маркер өөрөө шинэчлэгддэг.
                    Next(Phase.End);
                    {
                        int fixedRefs = 0, refilled = 0;
                        _timings.Measure("түлхүүр планы лавлагаа", () => fixedRefs = RefreshKeyPlanReferences());
                        _timings.Measure("түлхүүр планы дүүргэлт", () => refilled = RefillKeyPlansFinal());
                        if (fixedRefs + refilled > 0)
                        {
                            _result.Committed = true;
                            Status = "Түлхүүр планы лавлагаа";
                            return true;
                        }
                    }
                    return false;

                case Phase.End:
                    WeProf.Flush("prof");
                    Status = null;
                    _phase = Phase.Done;
                    return true;
            }
            return false;
        }

        private void Next(Phase p)
        {
            _phase = p;
            _idx = 0;
            _extraSteps = null;
        }

        /// <summary>Хуудсанд орох (хүчинтэй харагдацтай) дэлгээс; түлхүүр план, 3D-ийн үйлчилгээ — нэг удаа.</summary>
        private void PreparePlaceable()
        {
            _placeable = _touched.Concat(_kept)
                .Where(i => i.ViewId != ElementId.InvalidElementId && _doc.GetElement(i.ViewId) != null && i.Status <= WeStatus.Warning).ToList();
            if (_keySvc == null)
            {
                var names = new HashSet<string>(_res.ViewNames, StringComparer.OrdinalIgnoreCase);
                foreach (WeRunItem w in _work.Concat(_kept)) if (!string.IsNullOrEmpty(w.ViewName)) names.Add(w.ViewName);
                _keySvc = new WeKeyPlanService(_doc, _res, _s, _units, names);
                _keySvc.SheetRefOf = ExpectedSheetOf;
                _axonSvc = new WeAxonService(_doc, _res, names);
            }
        }

        /// <summary>
        /// W09: дэлгээсийн view template — өрөөний зориулалтынх (зориулалт загвар заагаагүй / «Тусгай» бол ерөнхий тохиргооных).  Олдохгүй загварыг
        /// нэг удаа тэмдэглэнэ.
        /// </summary>
        private ElementId TemplateFor(WePlannedElevation p)
        {
            string id = p != null && WePresetId.IsKnown(p.PresetId) ? p.PresetId : WePresetId.Custom;
            if (id == WePresetId.Custom) return _template;
            ElementId t;
            if (_presetTemplates.TryGetValue(id, out t)) return t;
            WeSettings ps = _s.ForPreset(id);
            if (string.Equals(ps.TemplateName ?? string.Empty, _s.TemplateName ?? string.Empty, StringComparison.Ordinal)) t = _template;
            else
            {
                bool missing;
                t = _res.ResolveTemplate(ps, out missing);
                if (missing) _result.Notes.Add("«" + WePresetCatalog.Title(id) + "» зориулалтын загвар «" + ps.TemplateName + "» олдсонгүй — төрлийн өгөгдмөлөөр.");
            }
            _presetTemplates[id] = t;
            return t;
        }

        /// <summary>
        /// W07: дэлгээсийн хүлээгдэж буй хуудасны дугаар (<see cref="WeKeyPlanRef.Expected"/>): харагдацын одоогийн хуудас › сонгосон хуудас ›
        /// өрөөний өмнө үүссэн хуудас › шинэ хуудасны урьдчилан хуваарилсан дугаар.  Хуудасгүй горимд null.
        /// </summary>
        private string ExpectedSheetOf(string elevationKey)
        {
            if (!_sheets || string.IsNullOrEmpty(elevationKey)) return null;
            WeRunItem w = _work.Concat(_kept).FirstOrDefault(i => i.Plan.Key == elevationKey);
            if (w == null) return null;
            string group = w.Plan.GroupKey, planned, groupSheet = null;
            if (_runPlan != null && _runPlan.SheetNumbers != null) _runPlan.SheetNumbers.TryGetValue(group ?? string.Empty, out planned); else planned = null;
            string key0 = "sheet|" + group + "|p0";
            foreach (KeyValuePair<View, WeRecord> kv in _res.Generated)
            {
                var sh = kv.Key.IsValidObject ? kv.Key as ViewSheet : null;
                if (sh != null && kv.Value.Kind == GeneratedElevationRepository.KindSheet && kv.Value.Key == key0) { groupSheet = sh.SheetNumber; break; }
            }
            // Шинэчлэх дэлгээс: түлхүүр план (Elevation горимд дэлгээсээс ӨМНӨ) зурагдах үед ViewId хараахан тавигдаагүй — хуучин харагдацынх.
            ElementId vid = w.ViewId != ElementId.InvalidElementId ? w.ViewId
                          : w.Plan.ExistingViewId != 0 ? new ElementId(w.Plan.ExistingViewId) : ElementId.InvalidElementId;
            return WeKeyPlanRef.Expected(PlacedSheetOf(vid), _s.TargetSheetNumber, groupSheet, planned);
        }

        /// <summary>Харагдацын одоогийн хуудасны дугаар (Revit-ийн «Sheet Number» параметр); байршаагүй бол null.</summary>
        private string PlacedSheetOf(ElementId viewId)
        {
            if (viewId == null || viewId == ElementId.InvalidElementId) return null;
            try
            {
                var v = _doc.GetElement(viewId) as View;
                Parameter p = v != null ? v.get_Parameter(BuiltInParameter.VIEWER_SHEET_NUMBER) : null;
                return WeKeyPlanRef.CleanSheet(p != null ? p.AsString() : null);
            }
            catch { return null; }
        }

        /// <summary>W07: хуудасны дараа түлхүүр план бүрийн бичвэр тэмдгийг бодит хуудасны дугаартай тулгана (нэг transaction).  Өөрчилсөн тоо.</summary>
        private int RefreshKeyPlanReferences()
        {
            if (!_sheets || _keySvc == null || _extras.Count == 0) return 0;
            int changed = 0;
            using (var t = new Transaction(_doc, "Ханын дэлгээс — түлхүүр планы лавлагаа"))
            {
                WeFailureSwallower.Attach(t);
                t.Start();
                foreach (KeyValuePair<string, WeGroupViews> kv in _extras)
                {
                    var plan = kv.Value.KeyPlan != ElementId.InvalidElementId ? _doc.GetElement(kv.Value.KeyPlan) as View : null;
                    if (plan == null) continue;
                    var map = new Dictionary<string, string>(StringComparer.Ordinal);
                    foreach (WeRunItem w in _placeable.Where(i => i.Plan.GroupKey == kv.Key))
                    {
                        var v = _doc.GetElement(w.ViewId) as View;
                        if (v == null || v.ViewType == ViewType.Elevation || string.IsNullOrEmpty(w.Plan.Label)) continue;   // Revit-ийн маркер — өөрөө
                        if (!map.ContainsKey(w.Plan.Label)) map[w.Plan.Label] = PlacedSheetOf(w.ViewId);
                    }
                    changed += _keySvc.RefreshReferences(plan, map);
                }
                if (changed > 0) t.Commit(); else t.RollBack();
            }
            if (changed > 0) _result.Notes.Add("Түлхүүр планы " + changed + " тэмдгийн хуудасны дугаарыг бодит байршлаар засав.");
            return changed;
        }

        /// <summary>
        /// Хуудас, лавлагааны ДАРАА түлхүүр план бүрийн өрөөний дүүргэлтийг ЭЦСИЙН шошго/маркерын хайрцгаар тулгана (хайрцаг өөрчлөгдөөгүй бол юу
        /// ч хийхгүй).  ХЭМЖСЭН (live gate 2026-10-16 run 2, PRESET-KEEP-B102): Revit-ийн Elevation маркер харагдац хуудсанд орсны ДАРАА дугаар/хуудсаа
        /// харуулж ТОМОРДОГ, бичвэр тэмдэг лавлагааны үе шатанд хоёр мөр болдог — эхний ажиллуулалт хуудаснаас ӨМНӨ (маркер жижиг), дахин
        /// ажиллуулалт томорсон маркерын доороос нүхэлж хил зөрдөг байв (sketch 12 → 13).  Нэг transaction; дахин зурсан түлхүүр планы тоо.
        /// </summary>
        private int RefillKeyPlansFinal()
        {
            if (_keySvc == null) return 0;
            var plans = new List<ElementId>();
            foreach (KeyValuePair<string, WeGroupViews> kv in _extras)
                if (kv.Value.KeyPlan != ElementId.InvalidElementId && !plans.Contains(kv.Value.KeyPlan)) plans.Add(kv.Value.KeyPlan);
            if (_elevation != null)
                foreach (ElementId id in _elevation.HostPlans.Values) if (id != ElementId.InvalidElementId && !plans.Contains(id)) plans.Add(id);
            if (plans.Count == 0) return 0;
            int changed = 0;
            using (var t = new Transaction(_doc, "Ханын дэлгээс — түлхүүр планы дүүргэлт"))
            {
                WeFailureSwallower.Attach(t);
                t.Start();
                foreach (ElementId id in plans)
                {
                    try { if (_keySvc.RefillAfterMarkers(_doc.GetElement(id) as ViewPlan, true)) changed++; }
                    catch (Exception ex) { WeLog.Error("keyplan", "эцсийн дүүргэлт", ex); }
                }
                if (changed > 0) t.Commit(); else t.RollBack();
            }
            return changed;
        }

        /// <summary>Энэ өрөөнд хуудсанд орох ТӨЛӨВЛӨСӨН дэлгээс (үүсгэх, шинэчлэх, хэвээр).</summary>
        private IEnumerable<WeRunItem> PlannedKeys(string group)
        {
            return _work.Concat(_kept).Where(i => i.Plan.GroupKey == group && i.Status <= WeStatus.Warning);
        }

        /// <summary>Нэг өрөөний түлхүүр план эсвэл 3D — өөрийн transaction (нэг блокийн алдаа нөгөөг нь буцаахгүй).  true = загвар өөрчлөгдсөн.</summary>
        private bool ExtraFor(WeGroupInfo g, bool axon)
        {
            WeGroupViews gv;
            if (!_extras.TryGetValue(g.GroupKey, out gv)) return false;
            HashSet<string> keys, nativeKeys;
            if (_phase == Phase.KeyPlansFirst)
            {
                // Дэлгээс хараахан үүсээгүй — төлөвлөгөөний түлхүүрээр (Elevation горимд шинэ дэлгээс бүгд Revit-ийн маркертай).
                keys = new HashSet<string>(PlannedKeys(g.GroupKey).Select(i => i.Plan.Key), StringComparer.Ordinal);
                nativeKeys = new HashSet<string>(PlannedKeys(g.GroupKey).Where(i => i.Plan.Action == WeAction.Create
                                                                                   || (_doc.GetElement(new ElementId(i.Plan.ExistingViewId)) as View)?.ViewType == ViewType.Elevation)
                                                                       .Select(i => i.Plan.Key), StringComparer.Ordinal);
            }
            else
            {
                keys = new HashSet<string>(_placeable.Where(i => i.Plan.GroupKey == g.GroupKey).Select(i => i.Plan.Key), StringComparer.Ordinal);
                // Elevation харагдацтай дэлгээс — түлхүүр план дээр Revit-ийн маркер өөрөө харагдана.
                nativeKeys = new HashSet<string>(_placeable.Where(i => i.Plan.GroupKey == g.GroupKey
                                                                    && (_doc.GetElement(i.ViewId) as View)?.ViewType == ViewType.Elevation)
                                                            .Select(i => i.Plan.Key), StringComparer.Ordinal);
            }
            bool changed = false;
            using (var t = new Transaction(_doc, axon ? "Ханын дэлгээс — 3D" : "Ханын дэлгээс — түлхүүр план"))
            {
                WeFailureSwallower sw = WeFailureSwallower.Attach(t);
                t.Start();
                bool created = false;
                ElementId id = ElementId.InvalidElementId;
                try
                {
                    if (axon)
                    {
                        View3D ax = _axonSvc.Ensure(g, _extraNotes, out created);
                        if (ax != null) id = ax.Id;
                    }
                    else
                    {
                        ViewPlan kp = _keySvc.Ensure(g, keys, nativeKeys, _extraNotes, out created);
                        if (kp != null)
                        {
                            id = kp.Id;
                            // Энэ өрөөний Elevation маркерыг тайрсан түлхүүр план дээр үүсгэнэ (хурдан — дээрх тайлбар).
                            _elevation.HostPlans[g.GroupKey] = kp.Id;
                        }
                    }
                }
                catch (Exception ex)
                {
                    try { if (t.HasStarted() && !t.HasEnded()) t.RollBack(); } catch { }
                    WeLog.Error(axon ? "axon" : "keyplan", g.GroupLabel, ex);
                    _extraNotes.Add(g.GroupLabel + ": " + (axon ? "3D харагдах байдал" : "түлхүүр план") + " үүсгэж чадсангүй — " + ex.Message);
                    return false;
                }
                TransactionStatus ts = t.Commit();
                _result.WarningsHidden += sw.WarningsHidden;
                if (ts != TransactionStatus.Committed)
                {
                    _extraNotes.Add(g.GroupLabel + ": " + (axon ? "3D" : "түлхүүр план") + " — Revit буцаав: " + (sw.LastError ?? ts.ToString()));
                    return false;
                }
                if (id != ElementId.InvalidElementId)
                {
                    changed = true;
                    if (axon)
                    {
                        gv.Axon = id;
                        if (created) _result.AxonsCreated++; else _result.AxonsUpdated++;
                    }
                    else
                    {
                        gv.KeyPlan = id;
                        if (created) _result.KeyPlansCreated++; else _result.KeyPlansUpdated++;
                    }
                }
            }
            return changed;
        }

        private static string InitialOutcome(WePlannedElevation p)
        {
            switch (p.Action)
            {
                case WeAction.Keep: return "Хэвээр";
                case WeAction.Skip: return "Алгасав";
                default: return "—";
            }
        }

        // ── 1. Үүсгэх / шинэчлэх ───────────────────────────────────

        private ViewFamilyType _vft;
        private bool _createOwn;

        /// <summary>
        /// ХЭМЖСЭН (Revit 2027 загвар): «Building Elevation»-ийн tag («1/2" Square») нь «Filled Arrow and View Name» биетэй — маркерын
        /// сум дээр харагдацын НЭР («WE-L2-205-C») бичигдэж, жишээ хуудасны «205A» гарахгүй.  Өөрийн төрөлд ижил хэлбэрийн
        /// «Detail Number» биетэй tag: сум дээр хуудсан дахь detail number (= «205A»), төвд хуудасны дугаар.  Ийм төрөл загварт
        /// байхгүй бол хөндөхгүй.
        /// </summary>
        private void UseDetailNumberTag(ViewFamilyType vft)
        {
            Parameter tp = vft.get_Parameter(BuiltInParameter.ELEVATN_TAG);
            var baseTag = tp != null && !tp.IsReadOnly ? _doc.GetElement(tp.AsElementId()) as ElementType : null;
            Parameter bp = baseTag != null ? baseTag.get_Parameter(BuiltInParameter.ELEV_SYMBOL_ID) : null;
            if (bp == null || bp.IsReadOnly) return;
            var baseBody = _doc.GetElement(bp.AsElementId()) as FamilySymbol;
            List<FamilySymbol> bodies = new FilteredElementCollector(_doc).OfCategory(BuiltInCategory.OST_ElevationMarks).OfClass(typeof(FamilySymbol))
                .Cast<FamilySymbol>()
                .Where(x => string.Equals(x.Name, "Detail Number", StringComparison.OrdinalIgnoreCase)
                            && x.FamilyName.IndexOf("Body", StringComparison.OrdinalIgnoreCase) >= 0)
                .ToList();
            FamilySymbol body = bodies.FirstOrDefault(x => baseBody != null && x.FamilyName == baseBody.FamilyName) ?? bodies.FirstOrDefault();
            if (body == null || (baseBody != null && baseBody.Id == body.Id)) return;
            ElementType tag = new FilteredElementCollector(_doc).OfClass(typeof(LineAndTextAttrSymbol)).Cast<ElementType>()
                .FirstOrDefault(x => x.FamilyName == baseTag.FamilyName && x.get_Parameter(BuiltInParameter.ELEV_SYMBOL_ID) != null
                                     && x.get_Parameter(BuiltInParameter.ELEV_SYMBOL_ID).AsElementId() == body.Id);
            if (tag == null)
            {
                var names = new HashSet<string>(new FilteredElementCollector(_doc).OfClass(typeof(LineAndTextAttrSymbol)).Cast<ElementType>()
                                                    .Where(x => x.FamilyName == baseTag.FamilyName).Select(x => x.Name), StringComparer.Ordinal);
                string name = WeResources.OwnViewTypeName;
                for (int i = 2; names.Contains(name); i++) name = WeResources.OwnViewTypeName + " " + i;
                tag = baseTag.Duplicate(name);
                tag.get_Parameter(BuiltInParameter.ELEV_SYMBOL_ID).Set(body.Id);
            }
            tp.Set(tag.Id);
        }

        private bool CreateOrUpdate(List<WeRunItem> work, WeRunResult result)
        {
            if (work.Count == 0) return false;
            using (var t = new Transaction(_doc, "Ханын дэлгээс — харагдац"))
            {
                WeFailureSwallower sw = WeFailureSwallower.Attach(t);
                t.Start();
                bool madeType = false;
                if (_vft == null && _createOwn)
                {
                    madeType = true;
                    // Өөрийн төрөл: Project Browser-т «Elevations (Ханын дэлгээс)» / «Sections (Ханын дэлгээс)» бүлэг — бусадтай холилдохгүй.
                    ViewFamilyType baseType = _res.BaseViewType(_s.ViewKind);
                    try { _vft = (ViewFamilyType)baseType.Duplicate(WeResources.OwnViewTypeName); }
                    catch (Autodesk.Revit.Exceptions.ArgumentException)
                    {
                        // Хуучин хувилбарын зүсэлтийн «Ханын дэлгээс» төрөл байгаа үед нэр давхцаж болно.
                        _vft = (ViewFamilyType)baseType.Duplicate(WeResources.OwnElevationTypeAltName);
                    }
                    if (_s.ViewKind == WeViewKind.Elevation)
                    {
                        // ХЭМЖСЭН: Building/Framing Elevation төрөлд «Structural Framing Elevation» загвар автоматаар наалддаг — бүтцийн
                        // discipline-тэй тул архитектурын хана, хаалга зурагдахгүй.  Өөрийн төрөлд загвар тавихгүй (тохиргооны загвар хэрэглэгдэнэ).
                        try { _vft.DefaultTemplateId = ElementId.InvalidElementId; } catch (Exception ex) { WeLog.Error("create", "DefaultTemplateId", ex); }
                        try { UseDetailNumberTag(_vft); } catch (Exception ex) { WeLog.Error("create", "elevation tag", ex); }
                    }
                    _res.TypesOf(_s.ViewKind).Add(_vft);
                    result.Notes.Add("«" + _vft.Name + "» харагдацын төрөл үүсгэв («" + baseType.Name + "»-аас) — Project Browser-т тусдаа бүлэг.");
                }
                ViewFamilyType vft = _vft;
                var names = new HashSet<string>(_res.ViewNames, StringComparer.OrdinalIgnoreCase);
                foreach (WeRunItem w in work)
                {
                    using (var st = new SubTransaction(_doc))
                    {
                        st.Start();
                        try
                        {
                            WePlannedElevation p = w.Plan;
                            View v;
                            string generatedName;
                            if (p.Action == WeAction.Create)
                            {
                                v = (_s.ViewKind == WeViewKind.Section ? (IWallElevationViewFactory)_section : _elevation).Create(_doc, vft.Id, p);
                                w.Created = true;
                                using (WeProf.T("create.setName")) w.ViewName = SetName(v, p.Name, names);
                                generatedName = w.ViewName;
                                w.Outcome = "Үүсгэв";
                            }
                            else
                            {
                                v = _doc.GetElement(new ElementId(p.ExistingViewId)) as View;
                                if (v == null) throw new InvalidOperationException("Хуучин харагдац олдсонгүй");
                                WeRecord rec = GeneratedElevationRepository.Read(v);
                                // Зөвхөн тэмдэглэгээ өөрчлөгдсөн бол харагдацыг зөөхгүй (тэмдэглэгээний үе шат дахин тавина).
                                bool geometry = rec == null
                                                || !string.Equals(WeIdentity.GeometryPart(rec.Signature), WeIdentity.GeometryPart(p.Signature), StringComparison.Ordinal)
                                                || rec.GeneratorVersion != WeIdentity.GeneratorVersion;
                                if (geometry)
                                {
                                    string detail;
                                    IWallElevationViewFactory f = v.ViewType == ViewType.Elevation ? (IWallElevationViewFactory)_elevation : _section;
                                    if (!f.Reposition(_doc, v, p.Frame, p.Box, out detail))
                                        throw new InvalidOperationException(detail ?? "Харагдацыг шинэчилж чадсангүй");
                                    // Шинэчлэлтийг ЭНД (SubTransaction дотор) шалгана: буруу бол буцааж хуучин харагдацыг хэвээр үлдээнэ.
                                    WeViewSnapshot snap = Snapshot(v, null);
                                    snap.IdentityKey = p.Key;
                                    snap.SameKeyCount = 1;
                                    WeValidationIssue hard = WallElevationValidator.Check(p, snap, true).FirstOrDefault(i => i.Severity == WeStatus.Failed);
                                    if (hard != null)
                                        throw new InvalidOperationException("шинэчлэлт шалгалтад унав (" + hard.Message + ") — хуучин харагдац хэвээр");
                                }
                                w.ViewName = p.Rename ? SetName(v, p.Name, names) : v.Name;
                                // Хэрэглэгч нэрийг сольсон бол хуучин «өгсөн нэр»-ийг ХАДГАЛНА — эс бөгөөс дараагийн удаа
                                // хэрэгсэл «нэр нь өгсөнтэйгээ ижил» гэж үзээд хэрэглэгчийн нэрийг дарах байсан.
                                generatedName = p.Rename || rec == null || string.IsNullOrEmpty(rec.GeneratedName) ? w.ViewName : rec.GeneratedName;
                                w.Outcome = "Шинэчлэв";
                            }
                            using (WeProf.T("create.esWrite")) GeneratedElevationRepository.Write(v, GeneratedElevationRepository.RecordFor(p, generatedName));
                            // Хэрэглэгчийн тохируулсан байрлал (2026-10-14) — дахин ажиллуулахад хэвээр.
                            if (p.Override != null) WeOverrideStore.Write(v, p.Override.Serialize());
                            else if (p.ClearStoredOverride || WeOverrideStore.Read(v) != null) WeOverrideStore.Write(v, null);
                            using (WeProf.T("create.subCommit")) st.Commit();
                            w.ViewId = v.Id;
                            w.Changed = true;
                        }
                        catch (Exception ex)
                        {
                            try { st.RollBack(); } catch { }
                            WeLog.Error("create", "«" + w.Plan.Name + "» (" + w.Plan.Key + ")", ex);
                            Fail(w, "Үүсгэж/шинэчилж чадсангүй: " + ex.Message);
                            w.ViewId = ElementId.InvalidElementId;
                        }
                    }
                }
                TransactionStatus ts;
                using (WeProf.T("create.commit")) ts = t.Commit();
                result.WarningsHidden += sw.WarningsHidden;
                if (ts == TransactionStatus.Committed)
                    foreach (WeRunItem w in work.Where(x => x.Changed && !string.IsNullOrEmpty(x.ViewName))) _res.ViewNames.Add(w.ViewName);
                if (ts != TransactionStatus.Committed)
                {
                    if (madeType && _vft != null)
                    {
                        // Буцаагдсан transaction-д үүссэн төрөл хүчингүй — дараагийн алхам дахин үүсгэнэ.
                        _res.TypesOf(_s.ViewKind).Remove(_vft);
                        _vft = null;
                    }
                    foreach (WeRunItem w in work.Where(x => x.Changed))
                    {
                        Fail(w, "Revit буцаав: " + (sw.LastError ?? ts.ToString()));
                        w.ViewId = ElementId.InvalidElementId;
                        w.Changed = false;
                        w.Created = false;
                    }
                    return false;
                }
            }
            return work.Any(w => w.Changed);
        }

        /// <summary>Нэр тавина; давхардвал (өөр агент/хэрэглэгч саяхан нэмсэн) дугаар залгана.</summary>
        private static string SetName(View v, string desired, HashSet<string> names)
        {
            if (string.Equals(v.Name, desired, StringComparison.Ordinal)) return desired;
            string n = WeNaming.Unique(desired, names);
            for (int i = 0; i < 20; i++)
            {
                try
                {
                    v.Name = n;
                    names.Add(n);
                    return n;
                }
                catch (Autodesk.Revit.Exceptions.ArgumentException)
                {
                    names.Add(n);
                    n = WeNaming.Unique(desired, names);
                }
            }
            return v.Name;
        }

        // ── Түлхүүр план, 3D (хуудасны нэмэлт блок) — <see cref="ExtraFor"/> (өрөө тус бүр, блок тус бүр өөрийн алхам). ──

        // ── 2. Төрөл / масштаб / загвар ──────────────────────────────

        private void Configure(List<WeRunItem> items, ViewFamilyType vft, ElementId template, WeRunResult result)
        {
            if (items.Count == 0) return;
            using (var t = new Transaction(_doc, "Ханын дэлгээс — загвар, масштаб"))
            {
                WeFailureSwallower sw = WeFailureSwallower.Attach(t);
                t.Start();
                foreach (WeRunItem w in items)
                {
                    var v = _doc.GetElement(w.ViewId) as View;
                    if (v == null) continue;
                    try
                    {
                        // Төрөл зөвхөн ИЖИЛ гэр бүлд (Elevation ↔ Elevation, Section ↔ Section) — өмнөх хувилбарын зүсэлт зүсэлтээрээ үлдэнэ.
                        bool sameFamily = vft != null && ((v.ViewType == ViewType.Elevation) == (vft.ViewFamily == ViewFamily.Elevation));
                        if (sameFamily && v.GetTypeId() != vft.Id)
                        {
                            try { v.ChangeTypeId(vft.Id); }
                            catch (Exception ex) { Warn(w, "Харагдацын төрлийг сольж чадсангүй"); WeLog.Error("config", "ChangeTypeId " + v.Name, ex); }
                        }
                        // Масштабыг загвараас ӨМНӨ: загвар масштабыг удирддаг бол тэр нь давамгайлна.
                        if (template != null && template == ElementId.InvalidElementId) v.ViewTemplateId = ElementId.InvalidElementId;
                        Parameter sc = v.get_Parameter(BuiltInParameter.VIEW_SCALE_PULLDOWN_METRIC);
                        // W03 (2026-10-16): тохиргооны масштаб ЯГ; хэрэглэгч Revit-д гараар сольсон бол (тохиргоо өөрчлөгдөөгүй үед) хадгална.
                        WeViewState st = WeViewStateStore.Read(v);
                        WeScaleRule.Decision dec = WeScaleRule.Decide(v.Scale, st.Scale, _s.Scale, w.Created, true);
                        if (v.Scale != dec.Apply && (sc == null || !sc.IsReadOnly))
                        {
                            try { v.Scale = dec.Apply; } catch { /* загвар удирдаж байна */ }
                        }
                        if (dec.KeptManual) w.Message = string.IsNullOrEmpty(w.Message) ? "масштабыг гараар 1:" + v.Scale + " болгосныг хадгалав"
                                                                                       : w.Message + "; масштабыг гараар 1:" + v.Scale + " болгосныг хадгалав";
                        st.Scale = dec.Record;
                        // W07: хэрэглэгчийн тогтоосон босоо хүрээ (NaN = авто — хадгалсныг арилгана); дахин ажиллуулахад төлөвлөгч эндээс сэргээнэ.
                        st.CropLowerMm = w.Plan.CropLowerMm;
                        st.CropUpperMm = w.Plan.CropUpperMm;
                        // W09: өрөөний зориулалт — дахин ажиллуулахад (ямар ч товчоор) тэр өрөө ижил зориулалтаар үргэлжилнэ.
                        if (w.Plan.Kind == WeSourceKind.Room && WePresetId.IsKnown(w.Plan.PresetId)) st.Preset = w.Plan.PresetId;
                        WeViewStateStore.Write(v, st);
                        if (template != null && template != ElementId.InvalidElementId && v.ViewTemplateId != template)
                        {
                            if (v.IsValidViewTemplate(template)) v.ViewTemplateId = template;
                            else Warn(w, "Сонгосон загвар энэ харагдацад тохирохгүй");
                        }
                        // Загваргүй харагдац: discipline = Coordination (ХЭМЖСЭН: Snowdon-ий Section/3D/Elevation төрлүүдийн өгөгдмөл нь Structural —
                        // архитектурын хана, хаалга, тавилга зурагдахгүй).  Загвар discipline-ийг удирддаг бол тэр нь давамгайлна.
                        if (v.ViewTemplateId == ElementId.InvalidElementId)
                        {
                            Parameter disc = v.get_Parameter(BuiltInParameter.VIEW_DISCIPLINE);
                            if (disc != null && !disc.IsReadOnly && v.Discipline == ViewDiscipline.Structural)
                            {
                                try { v.Discipline = ViewDiscipline.Coordination; } catch { /* загвар удирдаж байна */ }
                            }
                        }
                        // Viewport-ийн гарчиг («Title on Sheet») — хоосон бол л (хэрэглэгчийн бичсэнийг дарахгүй).
                        WePlannedElevation pl = w.Plan;
                        WeKeyPlanService.SetTitle(v, pl.Title, cur => WeNaming.LooksGenerated(_s.TitlePattern, cur, PatternValues(pl)));
                        // Far clip: «хайчлахгүй» үед гүн үл тоогдоно — «шугамгүй хайчлах» болгоно.
                        Parameter far = v.get_Parameter(BuiltInParameter.VIEWER_BOUND_FAR_CLIPPING);
                        if (far != null && !far.IsReadOnly && far.AsInteger() == 0) far.Set(2);
                        if (!v.CropBoxActive) v.CropBoxActive = true;
                    }
                    catch (Exception ex)
                    {
                        WeLog.Error("config", v.Name, ex);
                        Warn(w, "Тохиргоо бүрэн хэрэгжсэнгүй: " + ex.Message);
                    }
                }
                t.Commit();
                result.WarningsHidden += sw.WarningsHidden;
            }
        }

        /// <summary>
        /// Дэлгээс бүрт БУСАД дэлгээсийн зүсэлтийн тэмдэг (зүсэх хавтгай нь энэ харагдацын эзлэхүүнийг огтолдог) харагдаж
        /// зургийг бохирдуулна (Revit 2027 дээр зургаар шалгасан).  Зөвхөн ЭНЭ хэрэгслийн тэмдгийг нуух — хэрэглэгчийн
        /// өөрийн зүсэлтийг хөндөхгүй.  Нуусныг Revit-ийн «Reveal Hidden Elements»-ээр харж/сэргээж болно.
        /// </summary>
        private void HideOtherMarkers(List<WeRunItem> items, List<WeRunItem> created, WeRunResult result)
        {
            if (items.Count == 0) return;
            // Бүх «манай» дэлгээс: эзлэхүүний план мөр + viewer.  Харагдацын collector БИШ — хэмжсэн: дэлгээс бүрт
            // FilteredElementCollector(doc, viewId) нь Revit-ийг харагдац бүрийг тооцоолуулж 192 дэлгээст 5 с зарцуулав.
            var all = new List<KeyValuePair<long, KeyValuePair<WeFootprint, Element>>>();
            foreach (View gv in GeneratedViews(created))
            {
                Element viewer = SectionElevationViewFactory.FindViewer(_doc, gv);
                if (viewer == null) continue;
                WeViewSnapshot s = Snapshot(gv, null);
                if (!s.Exists) continue;
                all.Add(new KeyValuePair<long, KeyValuePair<WeFootprint, Element>>(gv.Id.Value,
                    new KeyValuePair<WeFootprint, Element>(WeFootprint.Of(s.Center, s.Right, s.ViewDirection, s.Half), viewer)));
            }
            if (all.Count < 2) return;
            var byView = all.ToDictionary(x => x.Key, x => x.Value);
            double tol = _units.MmToInternal(50);

            using (var t = new Transaction(_doc, "Ханын дэлгээс — тэмдэг нуух"))
            {
                WeFailureSwallower sw = WeFailureSwallower.Attach(t);
                t.Start();
                int hidden = 0;
                foreach (WeRunItem w in items)
                {
                    var v = _doc.GetElement(w.ViewId) as View;
                    KeyValuePair<WeFootprint, Element> me;
                    if (v == null || !byView.TryGetValue(v.Id.Value, out me)) continue;
                    try
                    {
                        // Эзлэхүүн нь огтлолцох дэлгээсийн тэмдэг л энэ харагдацад зурагдах боломжтой (илүү нуух нь хор хөнөөлгүй).
                        List<ElementId> ids = all
                            .Where(o => o.Key != v.Id.Value && me.Key.Overlaps(o.Value.Key, tol))
                            .Select(o => o.Value.Value)
                            .Where(e => !e.IsHidden(v) && e.CanBeHidden(v))
                            .Select(e => e.Id)
                            .ToList();
                        if (ids.Count == 0) continue;
                        v.HideElements(ids);
                        hidden += ids.Count;
                    }
                    catch (Exception ex) { WeLog.Error("markers", v.Name, ex); }
                }
                t.Commit();
                result.WarningsHidden += sw.WarningsHidden;
                result.MarkersHidden += hidden;
            }
        }

        /// <summary>Түлхүүр план эхэлж үүссэн (маркерын хост) бол — хөрш өрөөний СҮҮЛД үүссэн маркерыг тэнд нууна.</summary>
        private void HideForeignOnKeyPlans()
        {
            if (_keySvc == null || _runPlan == null || _elevation.HostPlans.Count == 0) return;
            using (var t = new Transaction(_doc, "Ханын дэлгээс — түлхүүр планы тэмдэг"))
            {
                WeFailureSwallower sw = WeFailureSwallower.Attach(t);
                t.Start();
                foreach (WeGroupInfo g in _runPlan.Groups)
                {
                    ElementId id;
                    if (g.GroupKey == null || !_elevation.HostPlans.TryGetValue(g.GroupKey, out id)) continue;
                    var own = new HashSet<long>(_touched.Concat(_kept).Where(w => w.Plan != null && w.Plan.GroupKey == g.GroupKey && w.ViewId != ElementId.InvalidElementId)
                                                        .Select(w => w.ViewId.Value));
                    try { _keySvc.HideForeignMarkersLate(_doc.GetElement(id) as ViewPlan, g, own); }
                    catch (Exception ex) { WeLog.Error("keyplan", g.GroupLabel, ex); }
                    // Маркер одоо бий — өрөөний дүүргэлтийг түүний доороос нүхэлнэ (сонгогдоно, дахин ажиллуулахад ижил зураг).
                    try { _keySvc.RefillAfterMarkers(_doc.GetElement(id) as ViewPlan); }
                    catch (Exception ex) { WeLog.Error("keyplan", g.GroupLabel, ex); }
                }
                t.Commit();
                _result.WarningsHidden += sw.WarningsHidden;
            }
        }

        /// <summary>
        /// Манай дэлгээсийн тэмдэг (elevation маркер, viewer) ОФФИСЫН ХУУДСАН ДЭЭРХ планд харагдахгүй (2026-10-14).  ХЭМЖСЭН (MAX ӨРГӨӨ INT_B,
        /// 2026-10-13): шинэ дэлгээсийн тэмдэг оффисын «ХАНЫН ДЭЛГЭЭСИЙН ТҮЛХҮҮР БАЙГУУЛАЛТ 157.1» болон тавилгын планд гарч хэвлэлтийг
        /// бохирдуулсан.  Хуудсанд байрлаагүй ажлын планд ҮЛДЭНЭ — хэрэглэгч тэмдэг дээр давхар дарж дэлгээс рүү очдог.  Манай түлхүүр план
        /// (бичлэгтэй) хөндөгдөхгүй.  Элементийг өөрчлөхгүй — зөвхөн тэр харагдацад нууна (Reveal Hidden-ээр харагдана).
        /// </summary>
        private void HideOwnOnOfficeSheets()
        {
            if (!_s.HideOwnMarkersOnSheets) return;
            var own = new HashSet<long>(_touched.Concat(_kept).Where(w => w.ViewId != ElementId.InvalidElementId).Select(w => w.ViewId.Value));
            if (own.Count == 0) return;
            try
            {
                var marks = new List<Element>();
                foreach (ElevationMarker m in new FilteredElementCollector(_doc).OfClass(typeof(ElevationMarker)).Cast<ElevationMarker>())
                {
                    for (int i = 0; i < m.MaximumViewCount; i++)
                    {
                        ElementId id;
                        try { id = m.GetViewId(i); } catch { continue; }
                        if (id != ElementId.InvalidElementId && own.Contains(id.Value)) { marks.Add(m); break; }
                    }
                }
                foreach (long id in own)
                {
                    Element viewer = null;
                    try { viewer = SectionElevationViewFactory.FindViewer(_doc, _doc.GetElement(new ElementId(id)) as View); } catch { }
                    if (viewer != null) marks.Add(viewer);
                }
                if (marks.Count == 0) return;

                var onSheet = new HashSet<long>(new FilteredElementCollector(_doc).OfClass(typeof(Viewport)).Cast<Viewport>().Select(vp => vp.ViewId.Value));
                var plans = new List<ViewPlan>();
                foreach (ViewPlan v in new FilteredElementCollector(_doc).OfClass(typeof(ViewPlan)).Cast<ViewPlan>())
                {
                    if (v.IsTemplate || !onSheet.Contains(v.Id.Value)) continue;
                    WeRecord rec = GeneratedElevationRepository.Read(v);
                    if (rec != null) continue;   // манай түлхүүр план
                    plans.Add(v);
                }
                if (plans.Count == 0) return;

                using (var t = new Transaction(_doc, "Ханын дэлгээс — оффисын планд тэмдэг нуух"))
                {
                    WeFailureSwallower sw = WeFailureSwallower.Attach(t);
                    t.Start();
                    int hidden = 0, views = 0;
                    foreach (ViewPlan v in plans)
                    {
                        try
                        {
                            List<ElementId> ids = marks.Where(m => m.IsValidObject && !m.IsHidden(v) && m.CanBeHidden(v)).Select(m => m.Id).ToList();
                            if (ids.Count == 0) continue;
                            v.HideElements(ids);
                            hidden += ids.Count;
                            views++;
                        }
                        catch (Exception ex) { WeLog.Info("markers", v.Name + ": оффисын планд нуусангүй — " + ex.Message); }
                    }
                    t.Commit();
                    _result.WarningsHidden += sw.WarningsHidden;
                    if (hidden > 0)
                    {
                        _result.Notes.Add("Шинэ дэлгээсийн тэмдгийг хуудсан дээрх " + views + " оффисын планд нуув (хуудсанд байрлаагүй ажлын планд харагдсаар; Reveal Hidden-ээр харна).");
                        WeLog.Info("markers", "оффисын хуудсан дээрх " + views + " планд " + hidden + " тэмдэг нуув");
                    }
                }
            }
            catch (Exception ex) { WeLog.Error("markers", "оффисын планд тэмдэг нуух", ex); }
        }

        /// <summary>Бүх «манай» дэлгээс: индекс (ажиллагааны эхэнд) + энэ ажиллагаанд шинээр үүсгэсэн.  Баримтыг дахин гүйлгэхгүй.</summary>
        private IEnumerable<View> GeneratedViews(List<WeRunItem> touched)
        {
            var seen = new HashSet<long>();
            foreach (KeyValuePair<View, WeRecord> kv in _res.Generated)
                if (kv.Value.Kind == GeneratedElevationRepository.KindView && kv.Key.IsValidObject && seen.Add(kv.Key.Id.Value))
                    yield return kv.Key;
            foreach (WeRunItem w in touched)
            {
                var v = _doc.GetElement(w.ViewId) as View;
                if (v != null && seen.Add(v.Id.Value)) yield return v;
            }
        }

        // ── 3. Шалгалт ─────────────────────────────────────────────

        private void Validate(List<WeRunItem> items, ElementId template, WeRunResult result)
        {
            if (items.Count == 0) return;
            // Давхардал: түлхүүр тус бүрийн харагдацын тоо — индекс (ажиллагааны эхэнд уншсан) + энэ ажиллагаанд ШИНЭЭР үүсгэсэн.
            var keyCount = new Dictionary<string, int>(StringComparer.Ordinal);
            Action<string> count = k => { int n; keyCount.TryGetValue(k, out n); keyCount[k] = n + 1; };
            foreach (KeyValuePair<View, WeRecord> kv in _res.Generated)
                if (kv.Value.Kind == GeneratedElevationRepository.KindView && kv.Key.IsValidObject) count(kv.Value.Key);
            foreach (WeRunItem w in items) if (w.Created) count(w.Plan.Key);

            var bad = new List<WeRunItem>();
            foreach (WeRunItem w in items)
            {
                var v = _doc.GetElement(w.ViewId) as View;
                WeViewSnapshot snap = Snapshot(v, template);
                WeRecord rec = v == null ? null : GeneratedElevationRepository.Read(v);
                snap.IdentityKey = rec != null ? rec.Key : null;
                int c;
                snap.SameKeyCount = keyCount.TryGetValue(w.Plan.Key, out c) ? c : 0;
                bool sourceOk = WeLinkRef.Exists(_doc, w.Plan.WallUid)
                                && (string.IsNullOrEmpty(w.Plan.RoomUid) || WeLinkRef.Exists(_doc, w.Plan.RoomUid));

                List<WeValidationIssue> issues = WallElevationValidator.Check(w.Plan, snap, sourceOk);
                foreach (WeValidationIssue i in issues)
                {
                    if (i.Severity > w.Status) w.Status = i.Severity;
                    w.Message = string.IsNullOrEmpty(w.Message) ? i.Message : w.Message + "; " + i.Message;
                }
                if (w.Status == WeStatus.Failed)
                {
                    bad.Add(w);
                    // Оношилгоо: төлөвлөсөн ба бодит хайрцаг (шалгалт унасан шалтгааныг логоос).
                    try
                    {
                        Func<double, string> mm = x => Math.Round(x * 304.8).ToString(System.Globalization.CultureInfo.InvariantCulture);
                        WeV3 o = w.Plan.Frame.Origin, look = w.Plan.Frame.Look;
                        WeMarkerPlacement mk = w.Plan.Marker;
                        WeLog.Info("validate", w.ViewName + ": төлөв " + w.Message + " · төлөвлөсөн o(" + mm(o.X) + "," + mm(o.Y) + ") look(" + Math.Round(look.X, 2) + "," + Math.Round(look.Y, 2)
                                               + ") near " + mm(w.Plan.Box.Near) + " far " + mm(w.Plan.Box.Far) + " half " + mm(w.Plan.Box.Half.X)
                                               + " · бодит c(" + mm(snap.Center.X) + "," + mm(snap.Center.Y) + "," + mm(snap.Center.Z) + ") half(" + mm(snap.Half.X) + "," + mm(snap.Half.Y) + "," + mm(snap.Half.Z) + ")"
                                               + (mk != null ? " · маркер " + mk.Group + " slot " + mk.Slot + " p(" + mm(mk.Position.X) + "," + mm(mk.Position.Y) + ") rot " + Math.Round(mk.Rotation, 3) : ""));
                    }
                    catch { }
                }
            }

            // Буруу ШИНЭ харагдацыг устгана (энэ ажиллагаа үүсгэсэн — хэрэглэгчийн ажил биш).  Шинэчилсэн харагдацыг устгахгүй.
            List<WeRunItem> toDelete = bad.Where(b => b.Created).ToList();
            if (toDelete.Count > 0)
            {
                using (var t = new Transaction(_doc, "Ханын дэлгээс — буруу харагдац цэвэрлэх"))
                {
                    WeFailureSwallower.Attach(t);
                    t.Start();
                    foreach (WeRunItem b in toDelete)
                    {
                        try
                        {
                            ElementId vid = b.ViewId;
                            _doc.Delete(vid);
                            _elevation.DeleteMarkerIfEmpty(_doc, vid);   // энэ ажиллагааны маркер хоосорвол
                            b.Outcome = "Устгав (шалгалт унав)";
                            b.ViewId = ElementId.InvalidElementId;
                        }
                        catch (Exception ex) { WeLog.Error("cleanup", b.ViewName, ex); }
                    }
                    t.Commit();
                }
            }
            foreach (WeRunItem b in bad.Where(x => !x.Created)) b.Outcome = "Шинэчилсэн — гараар шалгана уу";
        }

        private WeViewSnapshot Snapshot(View v, ElementId template)
        {
            var s = new WeViewSnapshot();
            if (v == null) return s;
            try
            {
                // Гүн = БОДИТ far clip (зүсэх хавтгайгаас) — crop-ийн Z нь far clip параметрээс зөрж болно (хэмжсэн:
                // CreateSection-ийн дараа crop Z зөв, far clip 335 м байв).  Хайчлахгүй горимд гүн хязгааргүй.
                BoundingBoxXYZ cb = v.CropBox;
                bool cutAtMax = cb.Transform.BasisZ.DotProduct(v.ViewDirection) > 0;
                double cutZ = cutAtMax ? cb.Max.Z : cb.Min.Z;
                double depth = Math.Abs(cb.Max.Z - cb.Min.Z);
                Parameter farMode = v.get_Parameter(BuiltInParameter.VIEWER_BOUND_FAR_CLIPPING);
                Parameter far = v.get_Parameter(BuiltInParameter.VIEWER_BOUND_OFFSET_FAR);
                if (farMode != null && farMode.AsInteger() == 0) depth = 1e6;
                else if (far != null && far.HasValue) depth = far.AsDouble();
                s.FarClipDepth = depth;
                double farZ = cutAtMax ? cutZ - depth : cutZ + depth;
                var lo = new XYZ(Math.Min(cb.Min.X, cb.Max.X), Math.Min(cb.Min.Y, cb.Max.Y), Math.Min(cutZ, farZ));
                var hi = new XYZ(Math.Max(cb.Min.X, cb.Max.X), Math.Max(cb.Min.Y, cb.Max.Y), Math.Max(cutZ, farZ));
                s.Exists = true;
                s.Center = cb.Transform.OfPoint((lo + hi) * 0.5).ToWe();
                s.Right = v.RightDirection.ToWe();
                s.Up = v.UpDirection.ToWe();
                s.ViewDirection = v.ViewDirection.ToWe();
                s.Half = new WeV3((hi.X - lo.X) / 2, (hi.Y - lo.Y) / 2, (hi.Z - lo.Z) / 2);
                s.CropActive = v.CropBoxActive;
                s.TemplateId = v.ViewTemplateId.Value;
                if (template != null) s.WantedTemplateId = template.Value;
            }
            catch (Exception ex)
            {
                WeLog.Error("validate", "snapshot " + v.Name, ex);
                s.Exists = false;
            }
            return s;
        }

        /// <summary>Загварын тогтмол токены утга (өрөө, түвшин) — <see cref="WeNaming.LooksGenerated"/>-д.</summary>
        internal static Dictionary<string, string> PatternValues(WePlannedElevation p)
        {
            string room = string.IsNullOrWhiteSpace(p.RoomNumber) ? string.Empty : p.RoomNumber.Trim();
            return WeNaming.Values(p.LevelName, room, p.RoomName, null, null, 0, null, null);
        }

        private static void Fail(WeRunItem w, string msg)
        {
            w.Status = WeStatus.Failed;
            w.Message = string.IsNullOrEmpty(w.Message) ? msg : w.Message + "; " + msg;
            w.Outcome = "Алдаа";
        }

        private static void Warn(WeRunItem w, string msg)
        {
            if (w.Status < WeStatus.Warning) w.Status = WeStatus.Warning;
            w.Message = string.IsNullOrEmpty(w.Message) ? msg : w.Message + "; " + msg;
        }
    }
}
