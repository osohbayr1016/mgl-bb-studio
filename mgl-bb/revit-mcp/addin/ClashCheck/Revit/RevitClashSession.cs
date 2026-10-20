using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using RevitMcpAddin.ClashCheck.Core;
using RevitMcpAddin.Smart;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.ClashCheck
{
    /// <summary>
    /// `IClashSession`-ий Revit-тэй хэрэгжүүлэлт.  Цонх (модальгүй) Revit API-д ЗӨВХӨН `SmartExecutor`-оор
    /// хүрнэ; session нь `Document`-ийг ХАДГАЛАХГҮЙ (зөвхөн түлхүүр + сул лавлагаа).
    ///
    /// ШИНЭ ТӨЛӨВ: шалгалт ДУУСТАЛ хадгалагдахгүй, `ClashStateStore.Update` (нэг түгжээ) — хэрэглэгчийн төлөв
    /// солилт ба шалгалтын дүн хоёр бие биеийнхээ өөрчлөлтийг дарахгүй.
    ///
    /// «Харуулах/сонгох»: host элементийг `Selection.SetElementIds`.  ⚠️ Линкийн элементийг Revit API-аар
    /// сонгох боломжгүй (`Selection`-д reference-ээр сонгох арга олдсонгүй) — тиймээс зөвхөн clash-ийн хайрцаг
    /// руу ойртуулж (`UIView.ZoomAndCenterRectangle`) харуулна, ил хэлнэ.
    /// </summary>
    internal sealed class RevitClashSession : IClashSession
    {
        private readonly DocumentKey _key;
        /// <summary>Загварын өөрчлөлтийн тоолуур — үүсгэх үед (API context) барьж, цонхны thread-ээс `Document`-гүйгээр уншина.</summary>
        private readonly ChangeStamp _changes;

        public string DocumentTitle { get { return _key.Display; } }
        public ClashRulesFile Rules { get; private set; }

        internal RevitClashSession(Document doc)
        {
            _key = RevitDocumentKeys.Of(doc);
            _changes = ModelChangeCounter.HandleFor(doc);
            Rules = ClashRuleStore.Load();
        }

        public void SaveRules()
        {
            if (!ClashRuleStore.Save(Rules)) SmartLog.Warn("clash", "rules_save_failed");
        }

        public ClashState LoadState()
        {
            return ClashStateStore.Load(_key);
        }

        public bool UpdateState(Action<ClashState> mutate, out string error)
        {
            return ClashStateStore.Update(_key, mutate, out error);
        }

        private Document Active(UIApplication app)
        {
            UIDocument ui = app.ActiveUIDocument;
            Document doc = ui != null ? ui.Document : null;
            if (doc == null) throw new InvalidOperationException("Идэвхтэй баримт алга.");
            if (!_key.Equals(RevitDocumentKeys.Of(doc)))
                throw new InvalidOperationException("Идэвхтэй файл «" + doc.Title + "» — энэ цонх «" + _key.Display + "» файлынх. Тэр файл руугаа шилжинэ үү.");
            return doc;
        }

        public bool IsStale(ClashRunRecord lastRun)
        {
            if (lastRun == null || string.IsNullOrEmpty(lastRun.ModelStamp)) return false;
            return _changes == null || _changes.Current != lastRun.ModelStamp;
        }

        public Task<IReadOnlyList<CategoryInfo>> GetCategoriesAsync(CancellationToken ct)
        {
            return SmartExecutor.Run(app => SmartCategories.ModelCategories(Active(app)), ct, "clash.categories");
        }

        public async Task<ClashRunOutcome> RunAsync(ClashRule rule, IProgress<JobProgress> progress, CancellationToken ct)
        {
            var job = new ClashJob(rule, _key, progress);
            await SmartExecutor.RunSteps(job, ct);
            if (job.Result == null) throw new InvalidOperationException("Шалгалтын дүн гарсангүй.");
            return job.Result;
        }

        /* ============================== SELECT / SHOW ====================== */

        private static List<ElementKey> Targets(ClashIssue issue, ClashTarget target)
        {
            var keys = new List<ElementKey>();
            if (target == ClashTarget.A || target == ClashTarget.Both) keys.Add(issue.A.ElementKey);
            if (target == ClashTarget.B || target == ClashTarget.Both) keys.Add(issue.B.ElementKey);
            return keys.Where(k => k.IsValid).ToList();
        }

        private sealed class Resolution
        {
            public readonly List<ElementId> HostIds = new List<ElementId>();
            /// <summary>Линкийн элемент бүрийн host-level Reference (`Reference.CreateLinkReference`).</summary>
            public readonly List<Reference> LinkRefs = new List<Reference>();
            /// <summary>Линк дотор байгаа элементийн тоо (Reference үүсгэж чадсан эсэхээс үл хамааран).</summary>
            public int Linked;
            /// <summary>Бодитоор сонгогдсон линкийн элементийн тоо.</summary>
            public int LinkSelected;
            public int Missing;
            public int Unknown;
        }

        /// <summary>UniqueId-аар (session хооронд тогтвортой).  Устсан → Missing; линк → Linked (+ Reference).</summary>
        private static Resolution Resolve(Document host, IEnumerable<ElementKey> keys)
        {
            var r = new Resolution();
            foreach (ElementKey k in keys)
            {
                try
                {
                    if (!k.IsLinked)
                    {
                        Element e = host.GetElement(k.Uid);
                        if (e != null) r.HostIds.Add(e.Id); else r.Missing++;
                        continue;
                    }

                    var inst = host.GetElement(k.Via) as RevitLinkInstance;
                    Document ld = inst != null ? inst.GetLinkDocument() : null;
                    if (ld == null) { r.Unknown++; continue; }
                    Element le = ld.GetElement(k.Uid);
                    if (le == null) { r.Missing++; continue; }
                    r.Linked++;
                    try { r.LinkRefs.Add(new Reference(le).CreateLinkReference(inst)); }
                    catch (Exception) { /* Reference үүсгэж чадсангүй — зөвхөн «Харуулах»-аар ойртуулна */ }
                }
                catch (Exception) { r.Unknown++; }
            }
            return r;
        }

        /// <summary>
        /// Host + линкийн элементийг НЭГ удаа сонгоно.  Линкийн элемент байвал `SetReferences` (Revit энэ нь «host эсвэл линкийн
        /// элемент» гэж баримтжуулсан); амжилтгүй бол host-ыг л `SetElementIds`-аар сонгож, линкийнхийг сонгож чадаагүйгээ ИЛ хэлнэ.
        /// </summary>
        private static void ApplySelection(UIDocument ui, Resolution r)
        {
            r.LinkSelected = 0;
            if (r.LinkRefs.Count == 0)
            {
                if (r.HostIds.Count > 0) ui.Selection.SetElementIds(r.HostIds);
                return;
            }

            try
            {
                var refs = new List<Reference>();
                foreach (ElementId id in r.HostIds)
                {
                    Element e = ui.Document.GetElement(id);
                    if (e != null) refs.Add(new Reference(e));
                }
                refs.AddRange(r.LinkRefs);
                ui.Selection.SetReferences(refs);
                r.LinkSelected = r.LinkRefs.Count;
            }
            catch (Exception ex)
            {
                SmartLog.Warn("clash", "select_link_failed", new { err = SmartLog.Scrub(ex.Message) });
                if (r.HostIds.Count > 0) ui.Selection.SetElementIds(r.HostIds);
            }
        }

        public Task<SelectOutcome> SelectAsync(ClashIssue issue, ClashTarget target, CancellationToken ct)
        {
            List<ElementKey> keys = Targets(issue, target);
            return SmartExecutor.Run(app =>
            {
                Document doc = Active(app);
                Resolution r = Resolve(doc, keys);
                ApplySelection(app.ActiveUIDocument, r);
                return Outcome(keys.Count, r, "Сонгов");
            }, ct, "clash.select");
        }

        public Task<SelectOutcome> ShowAsync(ClashIssue issue, CancellationToken ct)
        {
            List<ElementKey> keys = Targets(issue, ClashTarget.Both);
            double[] box = issue.Box;
            return SmartExecutor.Run(app =>
            {
                Document doc = Active(app);
                UIDocument ui = app.ActiveUIDocument;
                Resolution r = Resolve(doc, keys);
                ApplySelection(ui, r);

                bool zoomed = TryZoom(ui, doc, box);
                if (!zoomed && r.HostIds.Count > 0) ui.ShowElements(r.HostIds);
                SelectOutcome o = Outcome(keys.Count, r, zoomed ? "Харууллаа (clash руу ойртуулав)" : "Харууллаа");
                if (!zoomed && r.HostIds.Count == 0 && r.Linked > 0)
                    o.Message += " Идэвхтэй харагдацад ойртуулж чадсангүй (clash-ийн байршил олдсонгүй).";
                return o;
            }, ct, "clash.show");
        }

        /// <summary>Идэвхтэй харагдацыг clash-ийн хайрцаг руу ойртуулна.  Хуудас/хүснэгт гэх мэт тохирохгүй харагдацад false.</summary>
        private static bool TryZoom(UIDocument ui, Document doc, double[] boxMm)
        {
            if (boxMm == null || boxMm.Length != 6) return false;
            try
            {
                View v = doc.ActiveView;
                if (v == null || v is ViewSheet || v is ViewSchedule) return false;
                UIView uv = ui.GetOpenUIViews().FirstOrDefault(x => x.ViewId == v.Id);
                if (uv == null) return false;

                const double padMm = 500;     // clash-ийн эргэн тойронд ~0.5 м зай
                double k = 1.0 / ClashUnits.FeetToMm;
                var min = new XYZ((boxMm[0] - padMm) * k, (boxMm[1] - padMm) * k, (boxMm[2] - padMm) * k);
                var max = new XYZ((boxMm[3] + padMm) * k, (boxMm[4] + padMm) * k, (boxMm[5] + padMm) * k);
                uv.ZoomAndCenterRectangle(min, max);
                return true;
            }
            catch (Exception)
            {
                return false;
            }
        }

        private static SelectOutcome Outcome(int requested, Resolution r, string verb)
        {
            var parts = new List<string>();
            if (r.HostIds.Count > 0) parts.Add(r.HostIds.Count + " элемент " + verb);
            if (r.LinkSelected > 0) parts.Add(r.LinkSelected + " линкийн элемент " + verb);
            int linkNotSelected = r.Linked - r.LinkSelected;
            if (linkNotSelected > 0)
                parts.Add(linkNotSelected + " нь ЛИНК загварынх — сонгож чадсангүй (Revit линкийн элементийн Reference өгөөгүй); «Харуулах»-аар ойртуулна");
            if (r.Missing > 0) parts.Add(r.Missing + " нь загварт олдсонгүй (устсан, эсвэл хаалттай workset-д байж болно — дахин шалгана уу)");
            if (r.Unknown > 0) parts.Add(r.Unknown + " нь шалгагдаагүй (линк unload хийгдсэн байж болно)");
            if (parts.Count == 0) parts.Add("Элемент олдсонгүй");
            return new SelectOutcome
            {
                Requested = requested,
                Applied = r.HostIds.Count + r.LinkSelected,
                Missing = r.Missing,
                Message = string.Join("; ", parts) + ".",
            };
        }
    }
}
