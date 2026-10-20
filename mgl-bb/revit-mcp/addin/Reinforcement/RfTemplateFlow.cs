using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using Autodesk.Revit.UI;
using RevitMcpAddin.Reinforcement.Core;
using RevitMcpAddin.Reinforcement.Ui;

namespace RevitMcpAddin.Reinforcement
{
    /// <summary>
    /// «Хуулбарлаж зурах»-ын команд талын урсгал: зорилтот элементүүдийг цуглуулах, хуулалтыг ажиллуулж тайлан харуулах.  Өмнө нь
    /// <c>SectionAnnotationCommand</c> дотор байсан; «Хэмжээс, тэмдэглэгээ» хэрэгсэлд нэгтгэхэд (ЗӨВХӨН энд) шилжсэн — давхар код ҮГҮЙ.
    /// </summary>
    internal static class RfTemplateFlow
    {
        /// <summary>Нэг ажиллагаанд харуулах зорилтот элементийн дээд тоо (план дээр олон мянган багана байж болно).</summary>
        private const int MaxTargets = 60;

        /// <summary>
        /// Идэвхтэй харагдацад харагдаж буй арматур агуулах дам нуруу/багана.  Сонгосон нь эхэнд (өгөгдмөл), дараа нь арматуртай нь.  Хүчингүй (хана г.м.) сонголтыг
        /// ХАСНА — зөвхөн <see cref="RfSectionAnalyzer.IsAcceptableHost"/>.
        /// </summary>
        public static List<RfTemplateTarget> Targets(Document doc, View view, ICollection<ElementId> selection)
        {
            var selected = new HashSet<long>();
            if (selection != null) foreach (ElementId id in selection) selected.Add(id.Value);

            var rows = new List<KeyValuePair<int, RfTemplateTarget>>();
            int scanned = 0;
            foreach (BuiltInCategory cat in new[] { BuiltInCategory.OST_StructuralFraming, BuiltInCategory.OST_StructuralColumns })
            {
                foreach (Element e in new FilteredElementCollector(doc, view.Id).OfCategory(cat).WhereElementIsNotElementType())
                {
                    if (++scanned > 400) break;
                    if (!RfSectionAnalyzer.IsAcceptableHost(e)) continue;
                    // Эрэмбэ: сонгосон (0) → арматуртай (1) → бусад (2); эхнийх нь өгөгдмөл.
                    int rank = selected.Contains(e.Id.Value) ? 0 : HasRebar(e) ? 1 : 2;
                    rows.Add(new KeyValuePair<int, RfTemplateTarget>(rank, new RfTemplateTarget
                    {
                        Host = e,
                        Label = RfSectionAnalyzer.Describe(doc, e) + "   Id " + e.Id.Value + (rank == 0 ? "   ✓" : string.Empty),
                    }));
                }
            }
            List<RfTemplateTarget> list = rows
                .OrderBy(r => r.Key).ThenBy(r => r.Value.Label, StringComparer.CurrentCultureIgnoreCase)
                .Take(MaxTargets).Select(r => r.Value).ToList();
            return list;
        }

        private static bool HasRebar(Element e)
        {
            try
            {
                RebarHostData hd = RebarHostData.IsValidHost(e) ? RebarHostData.GetRebarHostData(e) : null;
                return hd != null && hd.GetRebarsInHost().Count > 0;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// Гараар зурсан загвар харагдацын хэмжээс, tag, текстийг ИДЭВХТЭЙ харагдацын <paramref name="host"/> дээр шууд нэмнэ
        /// (<see cref="RfTemplateService.Run"/>).  Шинэ харагдац үүсгэхгүй; гараар тавьсан зүйл хэзээ ч устахгүй.
        /// </summary>
        public static Result Run(Document doc, View view, Element host, RfTemplatePick pick, ref string message)
        {
            View templateView = doc.GetElement(new ElementId(pick.ViewId)) as View;
            Element templateHost = doc.GetElement(new ElementId(pick.HostId));
            if (templateView == null || templateHost == null)
            {
                TaskDialog.Show(RfText.TplTitle, RfText.TplHostNone);
                return Result.Cancelled;
            }

            RfTemplateRunReport rep;
            try
            {
                rep = RfTemplateService.Run(doc, view, host, templateView, templateHost, pick.Options);
            }
            catch (Exception ex)
            {
                message = ex.Message;
                TaskDialog.Show(RfText.TplTitle, RfText.Error(ex.Message));
                return Result.Failed;
            }

            var details = new List<string>();
            details.AddRange(rep.Failures);
            details.AddRange(rep.Cd.Errors);
            details.AddRange(rep.Cd.RenderedNotes);
            bool any = rep.Made > 0;
            bool nothingToCopy = rep.Ran && rep.Planned == 0;
            bool partial = any && (rep.Cd.DimsSkipped > 0 || rep.Cd.TagsSkipped > 0 || rep.Cd.DetailsSkipped > 0 || rep.Cd.DimsValueMismatch > 0);
            string body = RfText.TplResult(rep, templateView.Name, view.Name);
            if (nothingToCopy) body += Environment.NewLine + RfText.TplNoSource;
            // Ctrl+Z-ийн сануулга ЗӨВХӨН бодитоор зүйл нэмэгдсэн үед.
            RfGuard.ShowReport(RfText.TplTitle,
                any ? (partial ? RfText.TplPartial : RfText.TplDone) : RfText.TplNothing,
                body + (any ? Environment.NewLine + Environment.NewLine + RfText.Ctrlz : string.Empty) + "  (" + rep.ElapsedMs + " ms)",
                details);
            return any ? Result.Succeeded : (rep.Failures.Count > 0 ? Result.Failed : Result.Cancelled);
        }
    }
}
