using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using MglBb.Core;
using MglBb.Flows;
using MglBb.Infra;
using MglBb.RevitSide;

namespace MglBb.EndSymbols
{
    /// <summary>
    /// «Төгсгөлийн тэмдэг»: сонгосон (Project Browser / хуудас) эсвэл идэвхтэй дамнурууны дэлгээсэд арматурын төгсгөлийн тэмдгийг СУРСАН дүрмээр
    /// (<see cref="BbElevEndSymbols"/>) тавина — дэлгээсийг дахин тэмдэглэхгүйгээр.  Энэ хэрэгслийн өмнө тавьсан нь солигдоно, гараар (үндсэн plugin-ий
    /// «Төгсгөлийн тэмдэг»-ээр) тавьсан тэмдэг хөндөгдөхгүй.
    /// </summary>
    internal static class EndSymbolFlow
    {
        private const string Title = "MGL ББ — Төгсгөлийн тэмдэг";

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

            // Зөвхөн дамнурууны дэлгээс.
            var elevs = new List<KeyValuePair<ViewSection, BbViewSample>>();
            foreach (ViewSection v in views)
            {
                BbViewSample smp = BbLearner.Classify(doc, v);
                if (smp != null && !smp.IsSection && (smp.Kind == BbMemberKind.Beam || smp.Kind == BbMemberKind.BeamAux))
                    elevs.Add(new KeyValuePair<ViewSection, BbViewSample>(v, smp));
            }
            if (elevs.Count == 0)
            {
                TaskDialog.Show(Title, "Дамнурууны дэлгээс нээх, эсвэл Project Browser / хуудаснаас дэлгээс (эсвэл хуудас) сонгоно уу.");
                return Result.Cancelled;
            }

            var dlg = new BbDialog(Title, "Дамнурууны дэлгээсэд арматурын төгсгөлийн тэмдгийг сурсан дүрмээр тавина (тэмдэг, аль үе, аль ширхэг, эргэлт).  " +
                "Энэ хэрэгслийн өмнө тавьсан нь солигдоно, гараар тавьсан тэмдэг хөндөгдөхгүй.");
            dlg.Section("Дэлгээс (" + elevs.Count + ")");
            dlg.List(elevs.Select(x => x.Key.Name), Math.Min(160, 26 + 18 * elevs.Count));
            var optBox = FlowCommon.OptionCombo(dlg, doc, out BbOptionBook book);
            if (!dlg.Show(uidoc.Application.MainWindowHandle)) return Result.Cancelled;
            BbStandard std = FlowCommon.StandardFor(doc, book, optBox, out string src);

            var rep = new BbAnnoReport();
            int placed = 0, skipped = 0;
            using (var tg = new TransactionGroup(doc, "MGL ББ: төгсгөлийн тэмдэг"))
            {
                tg.Start();
                try
                {
                    foreach (var x in elevs)
                    {
                        BbMemberStandard ms = std.For(x.Value.Kind);
                        if (!ms.ElevEndSymbols || string.IsNullOrWhiteSpace(ms.ElevEndSymbolType)) { skipped++; continue; }
                        // Өмнө энэ хэрэгслийн тавьсныг (бүртгэлээр) устгаад шинээр — дахин ажиллуулахад тохиргоо шинэчлэгдэнэ.
                        using (var t = new Transaction(doc, "MGL ББ: төгсгөлийн тэмдэг солих"))
                        {
                            t.Start();
                            BbEndSymbolsCleanup(doc, x.Key);
                            t.Commit();
                        }
                        placed += BbElevEndSymbols.Apply(doc, x.Key, BbAnnotate.ElevationHosts(doc, x.Key, x.Value), ms, rep, x.Value.Mark);
                    }
                    tg.Assimilate();
                }
                catch
                {
                    if (tg.HasStarted() && !tg.HasEnded()) tg.RollBack();
                    throw;
                }
            }
            var lines = new List<string> { "Дэлгээс " + elevs.Count + ", тэмдэг " + placed, "Стандарт: " + src, "" };
            if (skipped > 0) lines.Insert(1, "Тэмдэг сураагүй тул алгассан: " + skipped + " (тэмдэгтэй дэлгээсээс «Стандарт сурах»)");
            lines.AddRange(rep.Notes.Take(8));
            FlowCommon.Summary(uidoc, "Төгсгөлийн тэмдэг", placed + " тэмдэг тавилаа.", lines, rep.Issues);
            return Result.Succeeded;
        }

        /// <summary>Энэ хэрэгслийн (бүртгэлд байгаа) төгсгөлийн тэмдгийг устгана — дэлгээсийн бусад тэмдэглэгээг хөндөхгүй.</summary>
        private static void BbEndSymbolsCleanup(Document doc, View view)
        {
            var mine = new HashSet<string>(BbAnnoStore.Read(view), StringComparer.Ordinal);
            if (mine.Count == 0) return;
            foreach (var p in RevitMcpAddin.Reinforcement.RfEndSymbolStore.Previous(doc, view).Values)
            {
                foreach (Element e in p.Parts.Concat(p.Instance != null ? new Element[] { p.Instance } : new Element[0]))
                    if (e != null && mine.Contains(e.UniqueId) && e.IsValidObject) { try { doc.Delete(e.Id); } catch { } }
            }
        }
    }
}
