using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using MglBb.Core;
using MglBb.Flows;
using MglBb.Infra;
using MglBb.RevitSide;

namespace MglBb.Breaks
{
    /// <summary>«Break line»: сонгосон (Project Browser / хуудас) эсвэл идэвхтэй дамнурууны огтлолд crop-ын ирмэгийг дайрсан хучилтад break line тавина.</summary>
    internal static class BreakFlow
    {
        public static Result Run(UIDocument uidoc)
        {
            Document doc = uidoc.Document;
            var views = new List<ViewSection>();
            foreach (ElementId id in uidoc.Selection.GetElementIds())
            {
                Element e = doc.GetElement(id);
                if (e is ViewSheet sh)
                {
                    foreach (ElementId vp in sh.GetAllViewports())
                        if (doc.GetElement(vp) is Viewport p && doc.GetElement(p.ViewId) is ViewSection vs) views.Add(vs);
                }
                else if (e is Viewport vpt && doc.GetElement(vpt.ViewId) is ViewSection vs2) views.Add(vs2);
                else if (e is ViewSection vs3) views.Add(vs3);
            }
            if (views.Count == 0 && uidoc.ActiveView is ViewSection av) views.Add(av);
            if (views.Count == 0 && uidoc.ActiveView is ViewSheet ash)
                foreach (ElementId vp in ash.GetAllViewports())
                    if (doc.GetElement(vp) is Viewport p && doc.GetElement(p.ViewId) is ViewSection vs) views.Add(vs);
            views = views.Where(v => !v.IsTemplate).GroupBy(v => v.Id.Value).Select(g => g.First()).ToList();

            // Зөвхөн дамнурууны огтлол.
            var beamSecs = new List<KeyValuePair<ViewSection, BbViewSample>>();
            foreach (ViewSection v in views)
            {
                BbViewSample smp = BbLearner.Classify(doc, v);
                if (smp != null && smp.IsSection && (smp.Kind == BbMemberKind.Beam || smp.Kind == BbMemberKind.BeamAux))
                    beamSecs.Add(new KeyValuePair<ViewSection, BbViewSample>(v, smp));
            }
            if (beamSecs.Count == 0)
            {
                TaskDialog.Show("MGL ББ — Break line", "Дамнурууны огтлол нээх, эсвэл Project Browser / хуудаснаас огтлол (эсвэл хуудас) сонгоно уу.");
                return Result.Cancelled;
            }

            var dlg = new BbDialog("MGL ББ — Break line", "Дамнурууны огтлолын crop-ын зүүн/баруун ирмэгийг дайрсан хучилтад break line тавина " +
                "(хучилтын дээд, доод ирмэгээр).  Энэ хэрэгслийн өмнө тавьсан нь солигдоно, гараар тавьсан break line хөндөгдөхгүй.");
            dlg.Section("Огтлол (" + beamSecs.Count + ")");
            dlg.List(beamSecs.Select(x => x.Key.Name), Math.Min(160, 26 + 18 * beamSecs.Count));
            var optBox = FlowCommon.OptionCombo(dlg, doc, out BbOptionBook book);
            if (!dlg.Show(uidoc.Application.MainWindowHandle)) return Result.Cancelled;
            BbStandard std = FlowCommon.StandardFor(doc, book, optBox, out string src);

            var rep = new BbAnnoReport();
            using (var tg = new TransactionGroup(doc, "MGL ББ: break line"))
            {
                tg.Start();
                try
                {
                    foreach (var x in beamSecs) BbBreaks.Section(doc, x.Key, std.For(x.Value.Kind), rep, x.Value.Mark);
                    tg.Assimilate();
                }
                catch
                {
                    if (tg.HasStarted() && !tg.HasEnded()) tg.RollBack();
                    throw;
                }
            }
            var lines = new List<string> { "Огтлол " + beamSecs.Count + ", break line " + rep.Breaks, "Стандарт: " + src, "" };
            lines.AddRange(rep.Notes.Take(8));
            FlowCommon.Summary(uidoc, "Break line", rep.Breaks + " break line тавилаа.", lines, rep.Issues);
            return Result.Succeeded;
        }
    }
}
