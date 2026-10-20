using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.Smart;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.ChangeImpact
{
    /// <summary>Нөлөөллийн шинжилгээг бусад дэд систем (Smart Publish)-д өгөх нимгэн гарц.</summary>
    internal static class ImpactService
    {
        /// <summary>Одоогийн өөрчлөлтийн дугаарын хаалт — гаргалтын ЭХЭНД авна (checkpoint).</summary>
        internal static long Mark()
        {
            return ImpactSeq.Mark();
        }

        internal static async Task<ImpactReport> AnalyzeAsync(DocumentKey key, ImpactRequest request, IProgress<JobProgress> progress, CancellationToken ct)
        {
            var job = new ImpactJob(request, key, progress);
            await SmartExecutor.RunSteps(job, ct);
            if (job.Result == null) throw new InvalidOperationException("Шинжилгээний дүн гарсангүй.");
            return job.Result;
        }
    }

    /// <summary>
    /// `IImpactSession`-ий Revit-тэй хэрэгжүүлэлт.  Цонх (модальгүй) Revit API-д ЗӨВХӨН `SmartExecutor`-оор хүрнэ;
    /// session нь `Document`-ийг ХАДГАЛАХГҮЙ (түлхүүр + сул лавлагаа).
    ///
    /// «Харуулах»: хуудас/харагдацыг `RequestViewChange`-ээр (асинхрон, зөвшөөрөгдсөн үед) нээнэ; бусад элементийг
    /// сонгож `ShowElements`.  Загварыг ӨӨРЧИЛӨХГҮЙ.
    /// </summary>
    internal sealed class RevitImpactSession : IImpactSession
    {
        private readonly DocumentKey _key;
        /// <summary>Тоолуур ба бүртгэлийн tracker — үүсгэх үед (API context) барьж, цонхны thread-ээс `Document`-гүйгээр уншина.</summary>
        private readonly ChangeStamp _changes;
        private readonly ImpactCapture.DocTracker _tracker;

        public string DocumentTitle { get { return _key.Display; } }

        internal RevitImpactSession(Document doc)
        {
            _key = RevitDocumentKeys.Of(doc);
            _changes = ModelChangeCounter.HandleFor(doc);
            _tracker = ImpactCapture.TrackerFor(doc);
        }

        public bool TrackingEnabled
        {
            get { return ImpactCapture.Enabled; }
            set { ImpactCapture.Enabled = value; }
        }

        public int DroppedBatches
        {
            get { return ImpactCapture.DroppedCount(_tracker); }       // хуулбаргүй, Revit API-гүй (цонхны thread-ээс аюулгүй)
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

        // Бүртгэл өөрчлөгдөөгүй бол (хувилбар ижил) хуулбарыг дахин үүсгэхгүй — цонхны 10 секундийн шинэчлэл хямд байна.
        private IReadOnlyList<ChangeBatch> _cachedBatches;
        private int _cachedRev = -1;

        public Task<IReadOnlyList<ChangeBatch>> GetBatchesAsync(CancellationToken ct)
        {
            return SmartExecutor.Run<IReadOnlyList<ChangeBatch>>(app =>
            {
                Document doc = Active(app);
                ImpactCapture.DocTracker t = ImpactCapture.TrackerFor(doc);
                // Хүлээгдэж буй идентитиг НЭГ хэсгээр (≤ `ResolveSliceIds`) уншина — нэг Step-д олон хэсэг давтвал Revit-ийн UI секундээр гацна; үлдсэн нь
                // арын resolve timer (өөрөө дахин товлогддог) эсвэл цонхны дараагийн шинэчлэлтээр.
                ImpactCapture.ResolveSome(t, doc, ImpactCapture.ResolveSliceIds);

                int rev = ImpactCapture.Revision(doc);
                IReadOnlyList<ChangeBatch> cached = _cachedBatches;
                if (cached != null && rev == _cachedRev) return cached;

                int dropped, snapRev;
                List<ChangeBatch> fresh = ImpactCapture.Snapshot(doc, out dropped, out snapRev);
                _cachedBatches = fresh;
                _cachedRev = snapRev;
                return fresh;
            }, ct, "impact.batches");
        }

        public IReadOnlyList<ModelCheckpoint> Checkpoints()
        {
            return CheckpointStore.Load(_key).Items.OrderByDescending(i => i.Utc).ToList();
        }

        public Task<ModelCheckpoint> AddCheckpointAsync(string label, CancellationToken ct)
        {
            return SmartExecutor.Run(app =>
            {
                Document doc = Active(app);
                var cp = new ModelCheckpoint
                {
                    Utc = SmartClock.UtcNow,
                    Label = string.IsNullOrWhiteSpace(label) ? "Шалгах цэг" : label.Trim(),
                    Kind = "user",
                    ChangeSeq = ImpactSeq.Mark(),
                };
                try
                {
                    DocumentVersion v = Document.GetDocumentVersion(doc);
                    cp.VersionGuid = v.VersionGUID.ToString();
                    cp.NumberOfSaves = v.NumberOfSaves;
                }
                catch (Exception) { /* хувилбар уншигдсангүй — ChangeSeq л үлдэнэ */ }

                string err;
                if (!CheckpointStore.Add(_key, cp, out err))
                    throw new InvalidOperationException("Шалгах цэгийг хадгалж чадсангүй: " + SmartLog.Scrub(err));
                return cp;
            }, ct, "impact.checkpoint");
        }

        public void DeleteCheckpoint(string id)
        {
            string err;
            bool removed;
            if (!CheckpointStore.Remove(_key, id, out removed, out err))
                throw new InvalidOperationException("Шалгах цэгийг устгаж чадсангүй (хадгалагдсангүй): " + SmartLog.Scrub(err));
        }

        public Task<ImpactReport> AnalyzeAsync(ImpactRequest request, IProgress<JobProgress> progress, CancellationToken ct)
        {
            return ImpactService.AnalyzeAsync(_key, request, progress, ct);
        }

        public ImpactReport LastReport()
        {
            return ImpactReportStore.Load(_key).Last;
        }

        public IReadOnlyList<ImpactReportHeader> History()
        {
            return ImpactReportStore.Load(_key).History;
        }

        public bool IsStale(ImpactReport report)
        {
            if (report == null || string.IsNullOrEmpty(report.ModelStamp)) return false;
            return _changes == null || _changes.Current != report.ModelStamp;
        }

        public Task ClearLogAsync(CancellationToken ct)
        {
            return SmartExecutor.Run(app =>
            {
                Document doc = Active(app);
                ImpactCapture.Clear(doc);
                return 0;
            }, ct, "impact.clear");
        }

        public Task<SelectOutcome> ShowAsync(ImpactItem item, CancellationToken ct)
        {
            return SmartExecutor.Run(app =>
            {
                Document doc = Active(app);
                UIDocument ui = app.ActiveUIDocument;

                Element e = null;
                try { if (!string.IsNullOrEmpty(item.Uid)) e = doc.GetElement(item.Uid); } catch (Exception) { }
                if (e == null) { try { e = doc.GetElement(new ElementId(item.Id)); } catch (Exception) { } }
                if (e == null)
                    return new SelectOutcome { Requested = 1, Applied = 0, Missing = 1, Message = "Элемент загварт олдсонгүй (устсан байж болзошгүй)." };

                var view = e as View;
                if (view != null && !view.IsTemplate && (item.Kind == ImpactNodeKind.Sheet || item.Kind == ImpactNodeKind.View || item.Kind == ImpactNodeKind.Schedule))
                {
                    try
                    {
                        ui.RequestViewChange(view);
                        return new SelectOutcome { Requested = 1, Applied = 1, Message = "«" + view.Name + "» нээгдэж байна." };
                    }
                    catch (Exception ex)
                    {
                        return new SelectOutcome { Requested = 1, Applied = 0, Message = "Харагдацыг нээж чадсангүй: " + SmartLog.Scrub(ex.Message) };
                    }
                }

                var ids = new List<ElementId> { e.Id };
                ui.Selection.SetElementIds(ids);
                try { ui.ShowElements(ids); } catch (Exception) { }
                return new SelectOutcome { Requested = 1, Applied = 1, Message = "Элементийг сонгов." };
            }, ct, "impact.show");
        }
    }
}
