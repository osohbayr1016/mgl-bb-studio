using System.Collections.Generic;
using Autodesk.Revit.DB;

namespace RevitMcpAddin.CloneDrawings
{
    /// <summary>
    /// СИНХРОН гүйцэтгэл — UI-гүй, нэг TransactionGroup (нэг Ctrl+Z).  2026-10-01-ээс «Зураг хувилах» товч АРЫН
    /// горимд (<see cref="CdJobHost"/>) ажилладаг; энэ нь ижил <see cref="CdJob"/> алхмуудыг дараалан гүйлгэнэ —
    /// Revit доторх тест харness (reflection-оор) ба арын хост ажиллахгүй үеийн нөөц зам.
    /// </summary>
    public static class CdRunner
    {
        /// <summary>
        /// Бүх зорилтыг нэг TransactionGroup дотор.  Алхам бүр (харагдац, тэмдэглэгээ, хуудас) өөрийн Transaction-тай:
        /// нэг алхам Revit-д буцаагдвал бусад нь хэвээр, шалтгаан нь тайланд.
        /// ⚠️ Нээлттэй Transaction-гүй үед л дуудна.
        /// </summary>
        public static CdReport Run(Document doc, Element tpl, CdTemplateInfo info, CdHostIndex hosts,
            List<CdLinkedView> views, List<ElementId> targetIds, CdOptions options, List<string> manualViewUids)
        {
            var job = new CdJob(doc, tpl, info, hosts, views, targetIds, options, manualViewUids);
            using (var tg = new TransactionGroup(doc, "MGL: Зураг хувилах"))
            {
                tg.Start();
                job.RunToEnd();
                if (job.Report.TargetsDone > 0 || job.LinksSaved)
                    tg.Assimilate();
                else
                    tg.RollBack();
            }
            return job.Report;
        }
    }
}
