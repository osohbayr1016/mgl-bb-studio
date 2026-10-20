using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
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
    /// `ICountSession`-ий Revit-тэй хэрэгжүүлэлт.  Цонх (модальгүй) Revit API-д ЗӨВХӨН `SmartExecutor`-оор
    /// хүрнэ; session нь `Document`-ийг ХАДГАЛАХГҮЙ (зөвхөн түлхүүр) — Job бүр идэвхтэй баримтыг авч
    /// түлхүүрээр нь тулгана (файл солигдсон бол ойлгомжтой алдаа).
    ///
    /// «Хуучирсан» эсэх: `ModelChangeCounter` (DocumentChanged-ийн тоолуур).  Тулгахад Revit API
    /// шаардлагагүй тул UI thread-ээс шууд (WeakReference-ээр баримтыг барьж).
    /// </summary>
    internal sealed class RevitCountSession : ICountSession
    {
        private readonly DocumentKey _key;
        /// <summary>Загварын өөрчлөлтийн тоолуур — үүсгэх үед (API context) барьж, цонхны thread-ээс `Document`-гүйгээр уншина.</summary>
        private readonly ChangeStamp _changes;

        public string DocumentTitle { get { return _key.Display; } }
        public SavedQueriesFile Queries { get; private set; }

        internal RevitCountSession(Document doc)
        {
            _key = RevitDocumentKeys.Of(doc);
            _changes = ModelChangeCounter.HandleFor(doc);
            Queries = SavedQueryStore.Load();
        }

        public void SaveQueries()
        {
            if (!SavedQueryStore.Save(Queries)) SmartLog.Warn("count", "queries_save_failed");
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

        public bool IsStale(CountResult result)
        {
            if (result == null) return false;
            return _changes == null || _changes.Current != result.ModelStamp;
        }

        /* ============================== CATALOG ============================ */

        public Task<IReadOnlyList<CategoryInfo>> GetCategoriesAsync(CancellationToken ct)
        {
            return SmartExecutor.Run(app => SmartCategories.ModelCategories(Active(app)), ct, "count.categories");
        }

        public Task<IReadOnlyList<string>> GetLevelsAsync(CancellationToken ct)
        {
            return SmartExecutor.Run<IReadOnlyList<string>>(app =>
            {
                Document doc = Active(app);
                return (IReadOnlyList<string>)new FilteredElementCollector(doc).OfClass(typeof(Level)).Cast<Level>()
                    .OrderBy(l => l.Elevation).Select(l => l.Name).ToList();
            }, ct, "count.levels");
        }

        public Task<IReadOnlyList<string>> GetParameterNamesAsync(IReadOnlyList<string> categoryIds, CancellationToken ct)
        {
            return SmartExecutor.Run<IReadOnlyList<string>>(app =>
            {
                Document doc = Active(app);
                var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (string id in categoryIds ?? new List<string>())
                {
                    BuiltInCategory bic;
                    if (!Enum.TryParse(id, true, out bic)) continue;
                    Element sample = new FilteredElementCollector(doc).OfCategory(bic).WhereElementIsNotElementType().FirstElement();
                    if (sample == null) continue;
                    AddNames(sample, names);
                    try
                    {
                        Element type = doc.GetElement(sample.GetTypeId());
                        if (type != null) AddNames(type, names);
                    }
                    catch (Exception) { }
                    if (names.Count > 600) break;
                }
                return (IReadOnlyList<string>)names.OrderBy(n => n, StringComparer.CurrentCultureIgnoreCase).ToList();
            }, ct, "count.params");
        }

        private static void AddNames(Element e, HashSet<string> into)
        {
            try
            {
                foreach (Parameter p in e.Parameters)
                {
                    string n = p.Definition != null ? p.Definition.Name : null;
                    if (!string.IsNullOrWhiteSpace(n)) into.Add(n.Trim());
                }
            }
            catch (Exception) { }
        }

        /* ============================== RUN ================================ */

        public async Task<CountResult> RunAsync(QueryDefinition query, IProgress<JobProgress> progress, CancellationToken ct)
        {
            var job = new CountJob(query, _key, progress);
            await SmartExecutor.RunSteps(job, ct);
            return job.Result;
        }

        /* ============================== SELECT / SHOW ====================== */

        public Task<SelectOutcome> SelectAsync(IReadOnlyList<ElementRecord> rows, CancellationToken ct)
        {
            CountGuards.Verdict v = CountGuards.ForSelect(rows.Count);
            if (!v.Allowed) return Task.FromResult(new SelectOutcome { Requested = rows.Count, Message = v.Message });
            return SmartExecutor.Run(app =>
            {
                Document doc = Active(app);
                List<ElementId> ids = Resolve(doc, rows);
                app.ActiveUIDocument.Selection.SetElementIds(ids);
                return Outcome(rows.Count, ids.Count, "Сонгов");
            }, ct, "count.select");
        }

        public Task<SelectOutcome> ShowAsync(IReadOnlyList<ElementRecord> rows, CancellationToken ct)
        {
            CountGuards.Verdict v = CountGuards.ForShow(rows.Count);
            if (!v.Allowed) return Task.FromResult(new SelectOutcome { Requested = rows.Count, Message = v.Message });
            return SmartExecutor.Run(app =>
            {
                Document doc = Active(app);
                List<ElementId> ids = Resolve(doc, rows);
                if (ids.Count > 0)
                {
                    UIDocument ui = app.ActiveUIDocument;
                    ui.Selection.SetElementIds(ids);
                    ui.ShowElements(ids);
                }
                return Outcome(rows.Count, ids.Count, "Харууллаа");
            }, ct, "count.show");
        }

        /// <summary>UniqueId-аар (session хооронд тогтвортой) — устсан элемент `Missing` болно.</summary>
        private static List<ElementId> Resolve(Document doc, IReadOnlyList<ElementRecord> rows)
        {
            var ids = new List<ElementId>(rows.Count);
            foreach (ElementRecord r in rows)
            {
                Element e = null;
                try { e = doc.GetElement(r.UniqueId); } catch (Exception) { }
                if (e != null) ids.Add(e.Id);
            }
            return ids;
        }

        private static SelectOutcome Outcome(int requested, int applied, string verb)
        {
            int missing = requested - applied;
            return new SelectOutcome
            {
                Requested = requested,
                Applied = applied,
                Missing = missing,
                Message = applied + " элемент " + verb + (missing > 0 ? "; " + missing + " нь загварт олдсонгүй (устсан байж болзошгүй — үр дүнг дахин тоолно уу)." : "."),
            };
        }
    }
}
