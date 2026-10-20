using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using RevitMcpAddin.CloneDrawings;
using RevitMcpAddin.CloneDrawings.Core;

namespace RevitMcpAddin.Reinforcement
{
    /// <summary>Загварын харагдацаас юуг хуулах.</summary>
    internal sealed class RfTemplateOptions
    {
        public bool Dims = true;
        public bool Tags = true;
        public bool Details = true;

        public bool Any { get { return Dims || Tags || Details; } }
    }

    /// <summary>Цонхноос командад: аль харагдацаас, аль элементийг загвар болгож хуулах.</summary>
    internal sealed class RfTemplatePick
    {
        public long ViewId;
        public string ViewName = string.Empty;
        public long HostId;
        public RfTemplateOptions Options = new RfTemplateOptions();
    }

    /// <summary>Загвар харагдацаас тодорхойлсон дам нуруу/багана — тэмдэглэгээний лавлагаа хамгийн олонтой нь эхэнд.</summary>
    internal sealed class RfTemplateHosts
    {
        public List<Element> Hosts = new List<Element>();
        public bool Ambiguous;
    }

    internal sealed class RfTemplateRunReport
    {
        public CdReport Cd = new CdReport();
        public bool Flipped;
        public bool Ran;
        public int SourceTags, SourceMras, SourceDims, SourceDetails;
        public int TemplateScale, TargetScale;
        public readonly List<string> Failures = new List<string>();
        public long ElapsedMs;

        /// <summary>Бодитоор үүссэн тэмдэглэгээ (хэмжээс + tag + 2D).</summary>
        public int Made { get { return Cd.Dims + Cd.Tags + Cd.Details; } }

        /// <summary>Загварт хуулах гэж байсан нийт (төлөвлөсөн).  MRA нь tag-д орно.</summary>
        public int Planned { get { return SourceDims + SourceTags + SourceMras + SourceDetails; } }
    }

    /// <summary>
    /// Цонхонд өгөх «загвар харагдац»-ын эх үүсвэр: нэр дэвшигчдийг НЭГ удаа (нэг collector) цуглуулж, сонгосон харагдацын
    /// загварын элементийг (кэштэй) тодорхойлно.  Revit-ийг зөвхөн уншина.
    /// </summary>
    internal sealed class RfTemplateSource
    {
        private readonly Document _doc;
        private readonly Dictionary<long, RfTemplateHosts> _hosts = new Dictionary<long, RfTemplateHosts>();

        public List<OntoViewRules.ViewRow> Rows { get; private set; }

        public RfTemplateSource(Document doc, View active)
        {
            _doc = doc;
            try { Rows = RfTemplateService.Candidates(doc, active); }
            catch { Rows = new List<OntoViewRules.ViewRow>(); }
        }

        public RfTemplateHosts Resolve(long viewId)
        {
            RfTemplateHosts h;
            if (_hosts.TryGetValue(viewId, out h)) return h;
            View v = _doc.GetElement(new ElementId(viewId)) as View;
            try { h = v == null ? new RfTemplateHosts() : RfTemplateService.FindHosts(_doc, v); }
            catch { h = new RfTemplateHosts(); }
            _hosts[viewId] = h;
            return h;
        }
    }

    /// <summary>
    /// «Загвар харагдацаас хуулах»: инженер гараар зурсан төстэй харагдацаа НЭРЭЭР сонгоно → түүний хэмжээс, arматурын tag (MRA),
    /// текстийг ИДЭВХТЭЙ харагдацын дам нуруу/багана дээр ижил байдлаар нэмнэ.  Хөдөлгүүр нь «Зураг клонлох»-ын (<see cref="CdOntoView"/>) —
    /// арматурын тулгалт, лавлагааг зорилтын нүүр рүү буулгах, үүссэн хэмжээсийн утга шалгах, давхардал хасах бүгд тэндээс.
    /// Хуурамч (үл үзэгдэх) геометр ХЭЗЭЭ Ч үүсэхгүй; буулгаж чадаагүй зүйл алгасагдаж тайланд бичигдэнэ.  Гараар тавьсан зүйл ХЭЗЭЭ Ч устахгүй.
    /// </summary>
    internal static class RfTemplateService
    {
        /// <summary>
        /// Загвар болох харагдацууд: хэмжээс эсвэл tag-тай, идэвхтэй биш, дэмжигдсэн төрлийн (план/зүсэлт/detail).
        /// Нэг collector-оор БҮХ харагдацын тоог авна (харагдац бүрт тусдаа collector ажиллуулахгүй).
        /// </summary>
        public static List<OntoViewRules.ViewRow> Candidates(Document doc, View active)
        {
            RfViewUse activeUse = RfView.Use(active);
            var dims = new Dictionary<long, int>();
            var tags = new Dictionary<long, int>();
            var notes = new Dictionary<long, int>();

            var filter = new ElementMulticlassFilter(new List<Type> { typeof(Dimension), typeof(IndependentTag), typeof(TextNote) });
            foreach (Element e in new FilteredElementCollector(doc).WherePasses(filter).WhereElementIsNotElementType())
            {
                ElementId vid = e.OwnerViewId;
                if (vid == null || vid == ElementId.InvalidElementId) continue;
                long k = vid.Value;
                if (e is TextNote) Bump(notes, k);
                else if (e is IndependentTag) Bump(tags, k);
                else if (e is Dimension && !(e is SpotDimension)) Bump(dims, k);
            }

            var rows = new List<OntoViewRules.ViewRow>();
            var ids = new HashSet<long>(dims.Keys);
            foreach (long k in tags.Keys) ids.Add(k);
            foreach (long id in ids)
            {
                if (active != null && id == active.Id.Value) continue;
                View v = doc.GetElement(new ElementId(id)) as View;
                RfViewUse use = RfView.Use(v);
                if (use != RfViewUse.Plan && use != RfViewUse.Section && use != RfViewUse.Detail) continue;
                int d = dims.ContainsKey(id) ? dims[id] : 0, t = tags.ContainsKey(id) ? tags[id] : 0;
                rows.Add(new OntoViewRules.ViewRow
                {
                    Id = id,
                    Name = v.Name,
                    TypeLabel = RfText.ViewKindName(use),
                    Dims = d,
                    Tags = t,
                    Notes = notes.ContainsKey(id) ? notes[id] : 0,
                    SameKind = use == activeUse,
                });
            }
            return OntoViewRules.OrderViews(rows);
        }

        private static void Bump(Dictionary<long, int> map, long key)
        {
            int n;
            map[key] = (map.TryGetValue(key, out n) ? n : 0) + 1;
        }

        /// <summary>
        /// Загвар харагдацын дам нуруу/багана: түүний хэмжээс, tag-ийн лавлагаа (арматур → эзэн нь; дам нуруу/багана өөрөө)-аар.
        /// Хамгийн олон лавлагаатай нь эхэнд.  Лавлагаагүй бол хоосон (дуудагч «тодорхойлж чадсангүй» гэж хэлнэ).
        /// </summary>
        public static RfTemplateHosts FindHosts(Document doc, View templateView)
        {
            var counts = new Dictionary<long, int>();
            var hosts = new Dictionary<long, Element>();

            Action<IEnumerable<ElementId>> credit = elementIds =>
            {
                var seen = new HashSet<long>();
                foreach (ElementId eid in elementIds)
                {
                    Element h = HostOf(doc, doc.GetElement(eid));
                    if (h == null || !seen.Add(h.Id.Value)) continue;
                    Bump(counts, h.Id.Value);
                    hosts[h.Id.Value] = h;
                }
            };

            foreach (Dimension d in new FilteredElementCollector(doc).OwnedByView(templateView.Id).OfClass(typeof(Dimension)).Cast<Dimension>())
            {
                if (d is SpotDimension) continue;
                ReferenceArray refs;
                try { refs = d.References; }
                catch { continue; }
                if (refs == null) continue;
                credit(refs.Cast<Reference>().Where(r => r != null && r.LinkedElementId == ElementId.InvalidElementId).Select(r => r.ElementId));
            }
            foreach (IndependentTag t in new FilteredElementCollector(doc).OwnedByView(templateView.Id).OfClass(typeof(IndependentTag)).Cast<IndependentTag>())
            {
                IList<Reference> refs;
                try { refs = t.GetTaggedReferences(); }
                catch { continue; }
                if (refs == null) continue;
                credit(refs.Where(r => r != null && r.LinkedElementId == ElementId.InvalidElementId).Select(r => r.ElementId));
            }

            bool ambiguous;
            List<long> order = OntoViewRules.OrderHosts(counts, out ambiguous);
            var result = new RfTemplateHosts { Ambiguous = ambiguous };
            foreach (long id in order) result.Hosts.Add(hosts[id]);
            return result;
        }

        /// <summary>Арматур бол эзэн нь, дам нуруу/багана бол өөрөө; бусад (хана, тэнхлэг г.м.) null.</summary>
        private static Element HostOf(Document doc, Element e)
        {
            if (e == null) return null;
            Rebar rb = e as Rebar;
            if (rb != null)
            {
                ElementId hid = rb.GetHostId();
                Element h = hid == null || hid == ElementId.InvalidElementId ? null : doc.GetElement(hid);
                return RfSectionAnalyzer.IsAcceptableHost(h) ? h : null;
            }
            return RfSectionAnalyzer.IsAcceptableHost(e) ? e : null;
        }

        /// <summary>
        /// Хуулалтыг НЭГ TransactionGroup + НЭГ Transaction-д (нэг Ctrl+Z) хийнэ.  Юу ч үүсээгүй, эсвэл Revit transaction-ыг
        /// буцаасан бол БҮГД буцаж, тоолуур цэвэрлэгдэнэ.  ⚠️ Нээлттэй Transaction-гүй үед л дуудна.
        /// </summary>
        public static RfTemplateRunReport Run(Document doc, View active, Element targetHost, View templateView, Element templateHost,
            RfTemplateOptions opt)
        {
            var rep = new RfTemplateRunReport();
            var sw = Stopwatch.StartNew();

            // Өөр хэрэглэгч эзэмшсэн харагдац (workshared) — юу ч нэмж болохгүй.
            if (!RfSectionStore.CanWrite(doc, active))
            {
                rep.Failures.Add(RfText.ViewNotWritable);
                return rep;
            }

            var options = new CdOptions
            {
                Tags = opt.Tags,
                Dimensions = opt.Dims,
                Spots = false,
                Details = opt.Details,
                Sheets = false,
                Rebar = true,
                ReplaceMark = true,
                Recreate = false,
            };
            CdReport.Snapshot snap = rep.Cd.Take();
            var handler = new CdFailureHandler(rep.Cd, true);

            using (var tg = new TransactionGroup(doc, RfText.TplTitle))
            {
                tg.Start();
                bool changed = false;
                try
                {
                    using (var t = new Transaction(doc, RfText.TplTitle))
                    {
                        t.Start();
                        FailureHandlingOptions fho = t.GetFailureHandlingOptions();
                        fho.SetFailuresPreprocessor(handler);
                        t.SetFailureHandlingOptions(fho);

                        CdOntoView.Outcome o = CdOntoView.Run(doc, templateView, templateHost, active, targetHost, options, rep.Cd);
                        rep.Flipped = o.Flipped;
                        rep.Ran = o.Ran;
                        rep.SourceTags = o.SourceTags;
                        rep.SourceMras = o.SourceMras;
                        rep.SourceDims = o.SourceDims;
                        rep.SourceDetails = o.SourceDetails;
                        rep.TemplateScale = o.TemplateScale;
                        rep.TargetScale = o.TargetScale;
                        if (o.Problem != null) rep.Failures.Add(o.Problem);

                        if (rep.Made > 0)
                        {
                            TransactionStatus st = t.Commit();
                            changed = st == TransactionStatus.Committed;
                            if (!changed)
                                rep.Failures.Add(string.IsNullOrEmpty(handler.RolledBackReason) ? RfText.TplRolledBack : handler.RolledBackReason);
                        }
                        else
                        {
                            t.RollBack();
                        }
                    }
                }
                catch (Exception ex)
                {
                    rep.Failures.Add(ex.Message);
                    changed = false;
                }

                if (changed) tg.Assimilate();
                else
                {
                    // Буцсан тул тоолуурыг цэвэрлэнэ (тайлан «үүссэн» гэж худал хэлэхгүй).
                    // Алдаа, тэмдэглэл (Errors/Notes) ҮЛДЭНЭ — яагаад буцсаныг тайлбарладаг.
                    rep.Cd.Restore(snap);
                    tg.RollBack();
                }
            }
            rep.ElapsedMs = sw.ElapsedMilliseconds;
            return rep;
        }
    }
}
