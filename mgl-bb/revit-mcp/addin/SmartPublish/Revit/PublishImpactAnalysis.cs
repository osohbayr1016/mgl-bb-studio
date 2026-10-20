using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using RevitMcpAddin.ChangeImpact;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.Smart.Core;
using RevitMcpAddin.SmartPublish.Core;
using RevitMcpAddin.SmartPublish.Ui;

namespace RevitMcpAddin.SmartPublish
{
    /// <summary>
    /// «Өөрчлөгдсөн хуудас» шинжилгээг ЯВУУЛНА — Smart Publish-ийн гаргалтаас хойших өөрчлөлтийг Change Impact-ээр шинжилнэ.
    ///
    /// ⚠️ ЯАГААД КОМАНДЫН API КОНТЕКСТОД (SmartExecutor БИШ): Publish цонх МОДАЛЬ — Revit нь add-in-ийн модаль цонх
    /// нээлттэй үед ExternalEvent ГҮЙЦЭТГЭХГҮЙ.  Тиймээс цонх хаагдаад команд (хүчинтэй API контекст) шинжилгээг шууд,
    /// хэсэг хэсгээр (`ImpactJob.Step`) явуулж, прогресс цонхыг `UiPump`-аар шинэчилнэ; дараа нь цонхыг дахин нээнэ.
    ///
    /// ХУУДАС БҮРИЙН watermark (сүүлийн АМЖИЛТТАЙ гаргалтын өөрчлөлтийн дугаар) өөр өөр байж болох тул ≤ 3 эхлэлээр багцлан
    /// (хамгийн эртний нь үргэлж орно) шинжилнэ — хуудас бүр өөрийн watermark-аас ЭРТ эхэлсэн шинжилгээнд хамрагдана.
    /// Хуучин өөрчлөлт давхар тоологдож болно (хэт санал), ГЭХДЭЭ ХЭЗЭЭ Ч алдагдахгүй.
    /// </summary>
    internal static class PublishImpactAnalysis
    {
        internal static AffectedPublishSet Run(UIApplication app, Document doc, RevitPublishSession session, PublishProfile profile, IntPtr owner)
        {
            IReadOnlyDictionary<string, SheetCheckpoint> cps = session.CheckpointsFor(profile.Id);
            List<PublishFormat> required = PublishCheckpointStore.SheetFormats(profile.Formats);
            List<PublishItem> sheets = session.Items.Where(i => i.Kind == PublishItemKind.Sheet).ToList();
            // Зөвхөн БҮРЭН гарсан (бүх формат) хуудас watermark-тай — «хэсэгчлэн/дутуу формат» хуудас `Resolve`-д «хараахан гаргаагүй» болох тул
            // тэдний watermark-аар шинжилгээ хийх нь зөвхөн хугацаа үрнэ.
            List<WatermarkBucket> marks = AffectedPublishResolver.PlanBuckets(
                sheets.Where(s => cps.ContainsKey(s.Id) && !cps[s.Id].Partial && PublishCheckpointStore.MissingFormats(cps[s.Id], required).Count == 0)
                      .Select(s => cps[s.Id]), 3);

            var analyses = new List<WatermarkAnalysis>();
            if (marks.Count > 0)
            {
                var progress = new PublishProgressWindow("MGL — Өөрчлөлт шинжилж байна", "Шинжилж байна", "Зогсоож байна…");
                using (new RevitMcpAddin.Smart.Ui.OwnerLock(owner))
                try
                {
                    if (owner != IntPtr.Zero) new System.Windows.Interop.WindowInteropHelper(progress).Owner = owner;
                    progress.Show();
                    UiPump.DoEvents();

                    for (int i = 0; i < marks.Count; i++)
                    {
                        long w = marks[i].Seq;
                        if (progress.Token.IsCancellationRequested)
                        {
                            analyses.Add(new WatermarkAnalysis { Watermark = w, Failed = true, Error = "Хэрэглэгч зогсоосон." });
                            continue;
                        }

                        // Baseline = ТЭР гаргалтын үеийн Revit хувилбар: бидний бүртгэлд ОРООГҮЙ (өөр session/хэрэглэгч) өөрчлөлтийг
                        // `Document.GetChangedElements`-ээр нэмж шинжилнэ.  Хүчингүй/үл мэдэгдэх бол шинжилгээ «бүрэн БИШ» болно.
                        var req = new ImpactRequest { FromSeqExclusive = w, BaselineVersionGuid = marks[i].VersionGuid };
                        var job = new ImpactJob(req, session.Key, new PrefixProgress(progress, marks.Count > 1 ? "(" + (i + 1) + "/" + marks.Count + ") " : ""));
                        try
                        {
                            while (!job.Step(app))
                            {
                                UiPump.DoEvents();
                                if (progress.Token.IsCancellationRequested) throw new OperationCanceledException();
                            }
                            if (job.Result == null) throw new InvalidOperationException("Шинжилгээний дүн гарсангүй.");
                            analyses.Add(new WatermarkAnalysis { Watermark = w, Report = job.Result });
                        }
                        catch (OperationCanceledException)
                        {
                            job.OnCancelled();
                            analyses.Add(new WatermarkAnalysis { Watermark = w, Failed = true, Error = "Хэрэглэгч зогсоосон." });
                        }
                        catch (Exception ex)
                        {
                            SmartLog.Error("publish", "impact_analysis_failed", ex);
                            analyses.Add(new WatermarkAnalysis { Watermark = w, Failed = true, Error = SmartLog.Scrub(ex.Message) });
                        }
                    }
                }
                finally
                {
                    progress.Finish();
                }
            }

            string currentGuid = null;
            try { currentGuid = Document.GetDocumentVersion(doc).VersionGUID.ToString(); }
            catch (Exception) { /* хувилбар уншигдсангүй — зөвхөн бүртгэлд найдна */ }

            // Шинжилгээг ПРОФАЙЛ + форматын багцад холбоно — цонх өөр профайл руу шилжихэд үүнийг хүчингүй гэж үзнэ (`AffectedPublishSet.AppliesTo`).
            return AffectedPublishResolver.Resolve(session.Items, cps, analyses, currentGuid, null, profile.Id, profile.Formats);
        }

        /// <summary>Олон watermark-ийн шинжилгээг (1/2, 2/2) прогрессд нэрлэнэ.</summary>
        private sealed class PrefixProgress : IProgress<JobProgress>
        {
            private readonly IProgress<JobProgress> _inner;
            private readonly string _prefix;

            public PrefixProgress(IProgress<JobProgress> inner, string prefix)
            {
                _inner = inner;
                _prefix = prefix;
            }

            public void Report(JobProgress p)
            {
                _inner.Report(JobProgress.Of(p.Stage, p.Done, p.Total, _prefix + (p.Message ?? "")));
            }
        }
    }
}
