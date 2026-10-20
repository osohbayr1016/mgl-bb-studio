using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement
{
    /// <summary>Эх түүврийн нэг талбар (шүүлтүүр тавьж болох).</summary>
    internal sealed class RfFieldInfo
    {
        public ScheduleFieldId Id;
        public int Index;
        public string Name;
        public ElementId ParameterId;
        public bool Hidden;
        public bool IsPartitionCandidate;
    }

    /// <summary>Эх түүврийн шинжилгээ — юу ч өөрчлөхгүй.</summary>
    internal sealed class RfTemplateInfo
    {
        public ViewSchedule Schedule;
        public readonly List<RfFieldInfo> Fields = new List<RfFieldInfo>();

        /// <summary><see cref="Fields"/> доторх автоматаар танисан Partition талбарын индекс; олдоогүй бол −1.</summary>
        public int DetectedIndex = -1;

        /// <summary>Түүвэрт талбар нь алга ч нуугдсан талбар болгон НЭМЖ болох Partition параметр; үгүй бол null.</summary>
        public ElementId AddableParameterId;
    }

    internal sealed class RfCloneRequest
    {
        public ViewSchedule Template;
        public ElementId ParamId;
        public bool AddHiddenField;
        public List<RfClonePlanItem> Items = new List<RfClonePlanItem>();

        /// <summary>Төлөвлөгөөнд орсон боловч гүйцэтгэхгүй (✓ Байгаа / Алгасах / Мөргөлдөөн) Partition-ы тоо — тайланд «алгасав» болно.</summary>
        public int PlannedSkips;

        /// <summary>PlannedSkips-ийн «аль хэдийн зөв» хэсэг.</summary>
        public int PlannedUpToDate;

        /// <summary>PlannedSkips-ийн «мөргөлдөөн (хөндөөгүй)» хэсэг.</summary>
        public int PlannedConflicts;

        /// <summary>Хөндөөгүй (мөргөлдөөн) Partition бүрийн шалтгаан — тайлангийн дэлгэрэнгүйд.</summary>
        public List<string> PlannedNotes = new List<string>();
    }

    internal sealed class RfCloneReport
    {
        public int Created, Updated, Replaced, SheetsReplaced;

        /// <summary>Алгасагдсан (төлөвлөгөөнөөс + гүйцэтгэх үед: өөр хэрэглэгч эзэмшсэн, шүүлтүүрийн хязгаар).</summary>
        public int Skipped;

        /// <summary>Skipped-ийн задаргаа: аль хэдийн зөв / мөргөлдөөн (хөндөөгүй).  Үлдсэн нь бусад алгасалт (эзэмшигч, шүүлтүүрийн хязгаар…).</summary>
        public int UpToDate, Conflicts;

        /// <summary>Revit Partition шүүлтүүрийн утгыг хүлээж авсангүй (ж: Partition талбар текст биш) — үлдсэн түүврийг дахин оролдохгүй.</summary>
        public bool FilterRejected;
        public long ElapsedMs;
        public int WarningsHidden;
        public readonly List<string> Failures = new List<string>();
        public readonly List<string> Notes = new List<string>();
        public readonly List<ElementId> CreatedIds = new List<ElementId>();
    }

    /// <summary>
    /// «Түүвэр хувилах» / «Түүвэр синк хийх»-ийн Revit давхарга.  Бүх шийдвэр (юу үүсгэх, мөргөлдөөн) Core-ийн
    /// planner-т; энд зөвхөн Revit-ийг уншиж/бичнэ.
    ///
    /// ПРИНЦИП: инженерийн форматласан эх түүврийг <b>View.Duplicate(Duplicate)</b>-аар хуулж, ЗӨВХӨН Partition
    /// шүүлтүүрийг солино — талбар, формат, эрэмбэ, тооцоолсон талбарыг гараар дахин байгуулахгүй.
    /// </summary>
    internal sealed class RfScheduleSession
    {
        public readonly Document Doc;
        private readonly Dictionary<long, RfPartitionSet> _partitionCache = new Dictionary<long, RfPartitionSet>();
        private Dictionary<long, List<ScheduleSheetInstance>> _placements;
        private RfParam.PartitionScan _scan;

        public RfScheduleSession(Document doc) { Doc = doc; }

        // ── Эх түүврийн жагсаалт ───────────────────────────────────────

        /// <summary>Эх түүвэр болох боломжтой: арматурын (Rebar) ангиллын энгийн түүвэр.</summary>
        public List<ViewSchedule> Templates()
        {
            var list = new List<ViewSchedule>();
            ElementId rebarCat = new ElementId(BuiltInCategory.OST_Rebar);
            foreach (ViewSchedule s in new FilteredElementCollector(Doc).OfClass(typeof(ViewSchedule)).Cast<ViewSchedule>())
            {
                if (s.IsTemplate || s.IsTitleblockRevisionSchedule) continue;
                try
                {
                    ScheduleDefinition d = s.Definition;
                    if (d.CategoryId != rebarCat || d.IsKeySchedule || d.IsMaterialTakeoff) continue;
                }
                catch
                {
                    continue;
                }
                list.Add(s);
            }
            list.Sort((a, b) => RfNaturalComparer.Instance.Compare(a.Name, b.Name));
            return list;
        }

        /// <summary>
        /// Загварын БҮХ арматурын Partition-ийг НЭГ global collector-оор НЭГ удаа уншсан дүн (кэштэй).  Параметрийн сонголт
        /// (NUMBER тэргүүлнэ) болон Partition-ийн индекс хоёулаа ЭНЭ scan-аас — session дотор дахин scan хийхгүй.
        /// </summary>
        public RfParam.PartitionScan Scan()
        {
            if (_scan == null) _scan = RfParam.ScanPartitions(Doc);
            return _scan;
        }

        public RfTemplateInfo Inspect(ViewSchedule template)
        {
            var info = new RfTemplateInfo { Schedule = template };
            ScheduleDefinition def = template.Definition;
            RfParam.PartitionScan scan = Scan();
            ElementId probed = scan.Chosen.HasValue ? new ElementId(scan.Chosen.Value) : null;

            int count = def.GetFieldCount();
            for (int i = 0; i < count; i++)
            {
                ScheduleField f = def.GetField(i);
                if (f.FieldType != ScheduleFieldType.Instance && f.FieldType != ScheduleFieldType.ElementType) continue;
                ElementId pid = f.ParameterId;
                if (pid == null || pid == ElementId.InvalidElementId) continue;
                bool filterable;
                try { filterable = def.CanFilterByValue(f.FieldId); }
                catch { filterable = false; }
                if (!filterable) continue;
                info.Fields.Add(new RfFieldInfo
                {
                    Id = f.FieldId,
                    Index = i,
                    Name = FieldName(f),
                    ParameterId = pid,
                    Hidden = f.IsHidden,
                    IsPartitionCandidate = RfParam.IsPartitionCandidate(pid),
                });
            }

            // Автомат таних: эхлээд арматур дээр БОДИТ утгатай built-in-тэй таарах талбар, дараа нь аль ч нэр дэвшигч.
            for (int i = 0; i < info.Fields.Count; i++)
            {
                if (probed != null && info.Fields[i].ParameterId == probed) { info.DetectedIndex = i; break; }
            }
            if (info.DetectedIndex < 0)
            {
                for (int i = 0; i < info.Fields.Count; i++)
                {
                    if (info.Fields[i].IsPartitionCandidate) { info.DetectedIndex = i; break; }
                }
            }

            if (info.DetectedIndex < 0)
            {
                try
                {
                    foreach (SchedulableField sf in def.GetSchedulableFields())
                    {
                        ElementId pid = sf.ParameterId;
                        if (!RfParam.IsPartitionCandidate(pid)) continue;
                        if (probed != null && pid != probed) continue;
                        info.AddableParameterId = pid;
                        break;
                    }
                    if (info.AddableParameterId == null && probed != null)
                    {
                        foreach (SchedulableField sf in def.GetSchedulableFields())
                        {
                            if (RfParam.IsPartitionCandidate(sf.ParameterId)) { info.AddableParameterId = sf.ParameterId; break; }
                        }
                    }
                }
                catch
                {
                    // Schedulable талбар унших боломжгүй — нэмэх сонголт гарахгүй.
                }
            }
            return info;
        }

        private static string FieldName(ScheduleField f)
        {
            try
            {
                string n = f.GetName();
                if (!string.IsNullOrEmpty(n)) return n;
            }
            catch { }
            return f.ColumnHeading ?? string.Empty;
        }

        // ── Partition утгууд ───────────────────────────────────────────

        /// <summary>
        /// Загварын арматураас ЯЛГАРСАН Partition утгууд (параметр л уншина — геометр БИШ).  Кэштэй.
        /// NUMBER/ELEM built-in бол ЭНЭ session-ийн ганц scan-аас (<see cref="Scan"/>) авна — Partition тус бүрд, эсвэл
        /// түүвэр солих бүрд арматурыг ДАХИН уншихгүй.  Өөр (built-in биш) параметр дээр л тусдаа дамжлага хэрэгтэй.
        /// </summary>
        public RfPartitionSet Partitions(ElementId paramId)
        {
            RfPartitionSet set;
            if (_partitionCache.TryGetValue(paramId.Value, out set)) return set;

            IList<string> raw = Scan().ValuesOf(paramId);
            if (raw == null)
            {
                var other = new List<string>();
                foreach (Element e in RfParam.AllRebars(Doc))
                    other.Add(RfParam.Text(RfParam.Get(Doc, e, paramId)));
                raw = other;
            }
            set = RfPartitionSet.Build(raw);
            _partitionCache[paramId.Value] = set;
            return set;
        }

        /// <summary>Түүврийн Partition талбар дээрх шүүлтүүрийн утга («тэнцүү», мөр); байхгүй бол null.</summary>
        public static string FilterValueOf(ScheduleDefinition d, ElementId paramId)
        {
            try
            {
                int fc = d.GetFilterCount();
                for (int i = 0; i < fc; i++)
                {
                    ScheduleFilter flt = d.GetFilter(i);
                    ScheduleField field;
                    try { field = d.GetField(flt.FieldId); }
                    catch { continue; }
                    if (field.ParameterId != paramId) continue;
                    if (flt.FilterType == ScheduleFilterType.Equal && flt.IsStringValue)
                        return flt.GetStringValue();
                    return null;
                }
            }
            catch
            {
                // Шүүлтүүр уншигдахгүй — «шүүлтүүргүй».
            }
            return null;
        }

        // ── Байгаа түүврүүдийн зураг ──────────────────────────────────

        private Dictionary<long, List<ScheduleSheetInstance>> Placements()
        {
            if (_placements != null) return _placements;
            _placements = new Dictionary<long, List<ScheduleSheetInstance>>();
            foreach (ScheduleSheetInstance ssi in new FilteredElementCollector(Doc).OfClass(typeof(ScheduleSheetInstance)).Cast<ScheduleSheetInstance>())
            {
                List<ScheduleSheetInstance> l;
                long key = ssi.ScheduleId.Value;
                if (!_placements.TryGetValue(key, out l)) _placements[key] = l = new List<ScheduleSheetInstance>();
                l.Add(ssi);
            }
            return _placements;
        }

        public List<RfExistingSchedule> Snapshot(ViewSchedule template, ElementId paramId)
        {
            var result = new List<RfExistingSchedule>();
            ElementId cat = template.Definition.CategoryId;
            Dictionary<long, List<ScheduleSheetInstance>> places = Placements();
            foreach (ViewSchedule s in new FilteredElementCollector(Doc).OfClass(typeof(ViewSchedule)).Cast<ViewSchedule>())
            {
                if (s.IsTemplate || s.IsTitleblockRevisionSchedule) continue;
                bool compatible = false;
                string filterValue = null;
                int segments = 1;
                bool bySheet = false;
                try
                {
                    ScheduleDefinition d = s.Definition;
                    compatible = d.CategoryId == cat && !d.IsKeySchedule && !d.IsMaterialTakeoff;
                    if (compatible) filterValue = FilterValueOf(d, paramId);
                    if (compatible)
                    {
                        try { segments = Math.Max(1, s.GetSegmentCount()); }
                        catch { segments = 1; }
                        try { bySheet = d.IsFilteredBySheet; }
                        catch { bySheet = false; }
                    }
                }
                catch
                {
                    compatible = false;
                }
                string genPartition = compatible ? RfScheduleStore.ReadPartition(s) : null;
                List<ScheduleSheetInstance> pl;
                places.TryGetValue(s.Id.Value, out pl);
                result.Add(new RfExistingSchedule
                {
                    Id = s.Id.Value,
                    Name = s.Name,
                    Compatible = compatible,
                    FilterValue = filterValue,
                    SheetPlacements = pl == null ? 0 : pl.Count,
                    GeneratedPartition = genPartition,
                    GeneratedFromThisTemplate = genPartition != null
                        && string.Equals(RfScheduleStore.ReadTemplateUid(s), template.UniqueId, StringComparison.Ordinal),
                    SegmentCount = segments,
                    FilteredBySheet = bySheet,
                });
            }
            return result;
        }

        // ── Гүйцэтгэл ──────────────────────────────────────────────────

        /// <summary>⚠️ Нээлттэй Transaction-гүй үед л дуудна.  Бүгд НЭГ TransactionGroup → нэг Ctrl+Z.</summary>
        public RfCloneReport Execute(RfCloneRequest req)
        {
            var rep = new RfCloneReport { Skipped = req.PlannedSkips, UpToDate = req.PlannedUpToDate, Conflicts = req.PlannedConflicts };
            rep.Notes.AddRange(req.PlannedNotes);
            var sw = Stopwatch.StartNew();
            string templateUid = req.Template.UniqueId;
            var swallow = new RfWarningSwallower();

            // Эх түүвэр 8 шүүлтүүртэй бөгөөд Partition шүүлтүүргүй бол ШИНЭ шүүлтүүр нэмэх боломжгүй — Duplicate хийхээс ӨМНӨ нэг удаа
            // шалгаж, үүсгэх (Create/Replace) бүгдийг алгасна.  «Filter шинэчлэх» нь байгаа түүврийн өөрийн шүүлтүүрийг солино.
            string limitProblem = null;
            int limited = 0;
            try { limitProblem = FilterLimitProblem(req.Template, req.ParamId); }
            catch { limitProblem = null; }

            using (var tg = new TransactionGroup(Doc, RfText.CloneTitle))
            {
                tg.Start();
                bool filterRejected = false;
                try
                {
                    using (var t = new Transaction(Doc, RfText.CloneTitle))
                    {
                        t.Start();
                        FailureHandlingOptions fho = t.GetFailureHandlingOptions();
                        fho.SetFailuresPreprocessor(swallow);
                        t.SetFailureHandlingOptions(fho);

                        foreach (RfClonePlanItem item in req.Items)
                        {
                            switch (item.Action)
                            {
                                case RfCloneAction.Create:
                                    if (limitProblem != null || filterRejected) { limited++; break; }
                                    CreateOne(req, item, templateUid, rep, replacing: false);
                                    filterRejected = filterRejected || rep.FilterRejected;
                                    break;
                                case RfCloneAction.UpdateFilter:
                                    if (filterRejected) { limited++; break; }
                                    UpdateOne(req, item, rep);
                                    filterRejected = filterRejected || rep.FilterRejected;
                                    break;
                                case RfCloneAction.Replace:
                                    if (limitProblem != null || filterRejected) { limited++; break; }
                                    ReplaceOne(req, item, templateUid, rep);
                                    filterRejected = filterRejected || rep.FilterRejected;
                                    break;
                            }
                        }
                        if (limited > 0)
                        {
                            rep.Skipped += limited;
                            rep.Failures.Add(filterRejected && limitProblem == null ? RfText.FilterRejectedSkipped(limited) : RfText.FilterLimitSkipped(limited));
                        }

                        TransactionStatus st = t.Commit();
                        if (st != TransactionStatus.Committed)
                        {
                            rep.Failures.Add("Revit өөрчлөлтийг буцаасан (" + st + ").");
                            rep.Created = rep.Updated = rep.Replaced = rep.SheetsReplaced = 0;
                            rep.CreatedIds.Clear();
                        }
                    }
                }
                catch (Exception ex)
                {
                    rep.Failures.Add(ex.Message);
                    rep.Created = rep.Updated = rep.Replaced = rep.SheetsReplaced = 0;
                    rep.CreatedIds.Clear();
                }

                if (rep.Created + rep.Updated + rep.Replaced > 0) tg.Assimilate();
                else tg.RollBack();
            }

            rep.WarningsHidden = swallow.Hidden;
            _placements = null;
            _partitionCache.Clear();
            rep.ElapsedMs = sw.ElapsedMilliseconds;
            return rep;
        }

        private void CreateOne(RfCloneRequest req, RfClonePlanItem item, string templateUid, RfCloneReport rep, bool replacing)
        {
            using (var st = new SubTransaction(Doc))
            {
                st.Start();
                try
                {
                    if (!req.Template.CanViewBeDuplicated(ViewDuplicateOption.Duplicate))
                        throw new InvalidOperationException(RfText.TemplateNotDuplicable);
                    ElementId id = req.Template.Duplicate(ViewDuplicateOption.Duplicate);
                    ViewSchedule copy = Doc.GetElement(id) as ViewSchedule;
                    if (copy == null) throw new InvalidOperationException("Duplicate нь хүснэгт буцаасангүй.");

                    try { copy.Name = item.ProposedName; }
                    catch (Exception ex) { throw new InvalidOperationException(RfText.NameRefused(item.ProposedName, ex.Message)); }

                    string err;
                    bool rejected;
                    if (!ApplyPartitionFilter(copy, req.ParamId, item.Partition, req.AddHiddenField, out err, out rejected))
                    {
                        rep.FilterRejected = rep.FilterRejected || rejected;
                        throw new InvalidOperationException(err);
                    }

                    // Тэмдэглэгээ бичигдэхгүй бол түүвэр «манай» гэж танигдахгүй (синк, «Солих» ажиллахгүй) — үлдээхгүй.
                    if (!RfScheduleStore.Write(copy, templateUid, item.Partition))
                        throw new InvalidOperationException(RfText.ScheduleMarkerNotWritten);
                    st.Commit();
                    if (!replacing) rep.Created++;
                    rep.CreatedIds.Add(id);
                }
                catch (Exception ex)
                {
                    if (st.HasStarted() && !st.HasEnded()) st.RollBack();
                    rep.Failures.Add(RfText.ItemFailed(item.Partition, ex.Message));
                    if (replacing) throw;
                }
            }
        }

        private void UpdateOne(RfCloneRequest req, RfClonePlanItem item, RfCloneReport rep)
        {
            using (var st = new SubTransaction(Doc))
            {
                st.Start();
                try
                {
                    ViewSchedule s = Doc.GetElement(new ElementId(item.ExistingId)) as ViewSchedule;
                    if (s == null) throw new InvalidOperationException("Түүвэр олдсонгүй.");
                    string owner = OwnerProblem(s.Id);
                    if (owner != null)
                    {
                        st.RollBack();
                        rep.Skipped++;
                        rep.Notes.Add(item.Partition + ": " + owner);
                        return;
                    }
                    // Гүн хамгаалалт (planner-ээс гадна): гараар хийсэн, Partition шүүлтүүргүй түүвэрт шүүлтүүр НЭМЭХГҮЙ.
                    if (RfScheduleStore.ReadPartition(s) == null && FilterValueOf(s.Definition, req.ParamId) == null)
                    {
                        st.RollBack();
                        rep.Skipped++;
                        rep.Notes.Add(item.Partition + ": " + RfText.ReasonLabel(RfCloneReason.HandMadeNoPartitionFilter));
                        return;
                    }
                    string err;
                    bool rejected;
                    if (!ApplyPartitionFilter(s, req.ParamId, item.Partition, req.AddHiddenField, out err, out rejected))
                    {
                        rep.FilterRejected = rep.FilterRejected || rejected;
                        throw new InvalidOperationException(err);
                    }
                    // Метадатаг ЗӨВХӨН аль хэдийн энэ хэрэгслийнх бол шинэчилнэ — хэрэглэгчийн өөрийн түүврийг «манайх» болгохгүй.
                    if (RfScheduleStore.ReadPartition(s) != null)
                        RfScheduleStore.Write(s, req.Template.UniqueId, item.Partition);
                    st.Commit();
                    rep.Updated++;
                }
                catch (Exception ex)
                {
                    if (st.HasStarted() && !st.HasEnded()) st.RollBack();
                    rep.Failures.Add(RfText.ItemFailed(item.Partition, ex.Message));
                }
            }
        }

        private sealed class SheetSite
        {
            public ElementId Sheet;
            public XYZ Point;
            public int Segment;
            public ViewportRotation Rotation;
        }

        /// <summary>
        /// «Солих»: хуучныг устгаад шинийг үүсгэж, хуудсан дээрх БҮХ байрлалыг (цэг, сегмент, эргэлт) сэргээнэ.
        /// ⚠️ ATOMIC: аль нэг алхам (үүсгэх, хуудсанд дахин байрлуулах — ж: хуудсыг өөр хэрэглэгч эзэмшсэн) унавал БҮГД
        /// буцаж ХУУЧИН түүвэр, хуудсан дээрх байрлал нь хэвээр үлдэнэ.
        /// </summary>
        private void ReplaceOne(RfCloneRequest req, RfClonePlanItem item, string templateUid, RfCloneReport rep)
        {
            ViewSchedule old = Doc.GetElement(new ElementId(item.ExistingId)) as ViewSchedule;
            if (old == null)
            {
                // Байхгүй болсон бол энгийн үүсгэлт.
                CreateOne(req, item, templateUid, rep, replacing: false);
                return;
            }

            string owner = OwnerProblem(old.Id);
            if (owner != null)
            {
                rep.Skipped++;
                rep.Notes.Add(item.Partition + ": " + owner);
                return;
            }

            // Хуудсан дээрх байрлалыг ӨМНӨ нь тэмдэглэнэ (устгавал алга болно).
            var sites = new List<SheetSite>();
            List<ScheduleSheetInstance> pl;
            if (Placements().TryGetValue(old.Id.Value, out pl))
            {
                foreach (ScheduleSheetInstance ssi in pl)
                {
                    sites.Add(new SheetSite
                    {
                        Sheet = ssi.OwnerViewId,
                        Point = ssi.Point,
                        Segment = ssi.SegmentIndex,
                        Rotation = ssi.Rotation,
                    });
                }
            }

            int idsBefore = rep.CreatedIds.Count;
            using (var st = new SubTransaction(Doc))
            {
                st.Start();
                try
                {
                    Doc.Delete(old.Id);
                    CreateOne(req, item, templateUid, rep, replacing: true);
                    if (rep.CreatedIds.Count == idsBefore) throw new InvalidOperationException("Шинэ түүвэр үүссэнгүй.");
                    ElementId newId = rep.CreatedIds[rep.CreatedIds.Count - 1];

                    foreach (SheetSite site in sites)
                    {
                        ScheduleSheetInstance inst = ScheduleSheetInstance.Create(Doc, site.Sheet, newId, site.Point, site.Segment);
                        if (site.Rotation != ViewportRotation.None)
                            inst.Rotation = site.Rotation;
                    }
                    st.Commit();
                    rep.Replaced++;
                    rep.SheetsReplaced += sites.Count;
                }
                catch (Exception ex)
                {
                    if (st.HasStarted() && !st.HasEnded()) st.RollBack();
                    // Буцсан тул үүсгэсэн id-г тоолуураас хасна.
                    while (rep.CreatedIds.Count > idsBefore) rep.CreatedIds.RemoveAt(rep.CreatedIds.Count - 1);
                    // CreateOne дотроо `replacing` үед алдаагаа өөрөө бичсэн; давхар бичихгүй.
                    if (!rep.Failures.Exists(f => f.StartsWith(item.Partition + ":", StringComparison.Ordinal)))
                        rep.Failures.Add(RfText.ItemFailed(item.Partition, RfText.ReplaceRolledBack(ex.Message)));
                }
            }
        }

        /// <summary>
        /// Устгах (синк-ийн «Сонгосныг устгах»).  Нээлттэй Transaction-гүй үед.  Устгахын өмнө Revit дээр ДАХИН шалгана (диалог нээгдсэнээс хойш
        /// өөрчлөгдсөн байж болно): ЗӨВХӨН ViewSchedule, эх түүвэр БИШ, өөр хэрэглэгч эзэмшээгүй.  Устаагүйг шалтгаантай нь <paramref name="failed"/>-д.
        /// </summary>
        public int DeleteSchedules(IList<long> ids, long templateId, out List<string> failed)
        {
            failed = new List<string>();
            int n = 0;
            using (var t = new Transaction(Doc, RfText.SyncTitle))
            {
                t.Start();
                foreach (long id in ids)
                {
                    string label = id.ToString();
                    try
                    {
                        ViewSchedule vs = Doc.GetElement(new ElementId(id)) as ViewSchedule;
                        if (vs == null) { failed.Add(label + ": " + RfText.DeleteNotFound); continue; }
                        label = vs.Name;
                        if (id == templateId) { failed.Add(label + ": " + RfText.DeleteIsTemplate); continue; }
                        string owner = OwnerProblem(vs.Id);
                        if (owner != null) { failed.Add(label + ": " + owner); continue; }
                        Doc.Delete(vs.Id);
                        n++;
                    }
                    catch (Exception ex)
                    {
                        // Нэг нь устгагдахгүй (ж: идэвхтэй харагдац) бол бусдыг үргэлжлүүлнэ, ГЭХДЭЭ чимээгүй алгасахгүй.
                        failed.Add(label + ": " + ex.Message);
                    }
                }
                if (n > 0) t.Commit();
                else t.RollBack();
            }
            _placements = null;
            return n;
        }

        // ── Шүүлтүүр ───────────────────────────────────────────────────

        /// <summary>
        /// Workshared файлд тухайн түүврийг ӨӨР хэрэглэгч эзэмшиж байвал мэдэгдэл (эзний нэрээр), үгүй бол null.
        /// ⚠️ Revit-ийн баримтаар <c>GetCheckoutStatus</c> нь локал кэш — «яг одоо засах боломжтой» гэсэн ҮНЭМШЛЭХГҮЙ баталгаа
        /// БИШ.  Тиймээс энэ нь зөвхөн хэрэглэгчид тайлагнах; бодит унасан Transaction тусдаа (SubTransaction буцаана) нэг түүвэр
        /// бүрт тусгаарлагдсан.
        /// </summary>
        private string OwnerProblem(ElementId id)
        {
            try
            {
                if (!Doc.IsWorkshared) return null;
                string owner;
                CheckoutStatus st = WorksharingUtils.GetCheckoutStatus(Doc, id, out owner);
                if (st == CheckoutStatus.OwnedByOtherUser)
                    return RfText.OwnedByOther(string.IsNullOrEmpty(owner) ? "?" : owner);
            }
            catch
            {
                // Төлөв уншигдахгүй — шалгалтгүй үргэлжлүүлнэ (Revit өөрөө татгалзвал SubTransaction буцаана).
            }
            return null;
        }

        /// <summary>
        /// Түүвэрт Partition шүүлтүүр тавьж БОЛОХ эсэх (Revit-ийн 8 шүүлтүүрийн хязгаар): аль хэдийн Partition шүүлтүүртэй бол
        /// СОЛИНО (тоо өөрчлөгдөхгүй), үгүй бол одоогийн шүүлтүүр 8-аас бага байх ёстой.  Боломжгүй бол Монгол мэдэгдэл, үгүй бол null.
        /// </summary>
        internal static string FilterLimitProblem(ViewSchedule s, ElementId paramId)
        {
            ScheduleDefinition d = s.Definition;
            ScheduleField field = FindField(d, paramId);
            // Partition талбар байхгүй бол (нуугдсан талбар шинээр нэмэгдэнэ) одоогийн шүүлтүүрүүд дээр ЯМАР Ч талбар таарахгүй (−1).
            RfFilterDecision dec = RfFilterPlan.Decide(CurrentFilterFields(d), field == null ? int.MinValue : field.FieldId.IntegerValue);
            return dec.Op == RfFilterOp.TooMany ? RfText.TooManyFilters : null;
        }

        /// <summary>Түүврийн одоогийн шүүлтүүр бүрийн талбарын id (шүүлтүүрийн дарааллаар) — Core-ийн <see cref="RfFilterPlan"/>-д.</summary>
        private static List<int> CurrentFilterFields(ScheduleDefinition d)
        {
            var ids = new List<int>();
            int fc = d.GetFilterCount();
            for (int i = 0; i < fc; i++) ids.Add(d.GetFilter(i).FieldId.IntegerValue);
            return ids;
        }

        /// <summary>Нээлттэй Transaction дотор.  Partition талбар дээр «Тэнцүү» шүүлтүүр тавина.</summary>
        internal static bool ApplyPartitionFilter(ViewSchedule s, ElementId paramId, string value, bool addHiddenField, out string error, out bool rejectedByRevit)
        {
            error = null;
            rejectedByRevit = false;
            ScheduleDefinition d = s.Definition;

            ScheduleField field = FindField(d, paramId);
            if (field == null)
            {
                if (!addHiddenField)
                {
                    error = RfText.NoPartitionField;
                    return false;
                }
                SchedulableField match = null;
                foreach (SchedulableField sf in d.GetSchedulableFields())
                {
                    if (sf.ParameterId == paramId) { match = sf; break; }
                }
                if (match == null)
                {
                    error = RfText.NoPartitionField;
                    return false;
                }
                field = d.AddField(match);
                field.IsHidden = true;
            }

            bool filterable;
            try { filterable = d.CanFilterByValue(field.FieldId); }
            catch { filterable = false; }
            if (!filterable)
            {
                error = RfText.TemplateNotFilterable;
                return false;
            }

            // ЯГ ТЭНЦҮҮ (Equal) — Contains/StartsWith БИШ: «DN-1» нь «DN-10»-той таарахгүй.
            var nf = new ScheduleFilter(field.FieldId, ScheduleFilterType.Equal, value);

            // Бусад шүүлтүүрийг ХӨНДӨХГҮЙ: зөвхөн Partition-ийн шүүлтүүрийг SetFilter(index) / AddFilter-ээр.  (SetFilters(list) нь бүх
            // жагсаалтыг дахин бичдэг тул ашиглахгүй.)  Revit-ийн хязгаар: нэг түүвэрт ≤ 8 шүүлтүүр — 9 дэхийг нэмэх гэж оролдохгүй.
            RfFilterDecision dec = RfFilterPlan.Decide(CurrentFilterFields(d), field.FieldId.IntegerValue);
            try
            {
                switch (dec.Op)
                {
                    case RfFilterOp.Set:
                        d.SetFilter(dec.Index, nf);
                        break;
                    case RfFilterOp.Add:
                        d.AddFilter(nf);
                        break;
                    default:
                        error = RfText.TooManyFilters;
                        return false;
                }
            }
            catch (Autodesk.Revit.Exceptions.ArgumentException ex)
            {
                // Revit энэ талбар дээр ТЕКСТ «Тэнцүү» шүүлтүүрийг хүлээж авсангүй (ж: Partition талбар текст биш, эсвэл утга буруу).
                error = RfText.FilterRejected(ex.Message);
                rejectedByRevit = true;
                return false;
            }
            return true;
        }

        private static ScheduleField FindField(ScheduleDefinition d, ElementId paramId)
        {
            ScheduleField first = null;
            int count = d.GetFieldCount();
            for (int i = 0; i < count; i++)
            {
                ScheduleField f = d.GetField(i);
                if (f.ParameterId != paramId) continue;
                // «Тэнцүү» шүүлтүүртэй талбарыг түрүүлж сонгоно.
                int fc = d.GetFilterCount();
                for (int k = 0; k < fc; k++)
                {
                    if (d.GetFilter(k).FieldId.IntegerValue == f.FieldId.IntegerValue) return f;
                }
                if (first == null) first = f;
            }
            return first;
        }
    }
}
