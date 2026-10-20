using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Selection;

namespace RevitMcpAddin.Reinforcement
{
    /// <summary>
    /// «Арматурын урт хэмжих» (2026-10-09): хэрэглэгч арматуруудаа (олноор) сонгоод хэмжээсийн шугамын байрлал дээр ХУЛГАНААР дарна → сонгосон арматуруудын
    /// төгсгөлүүдээр ҮРГЭЛЖИЛСЭН хэмжээс тавигдана (ганц арматурт = урт нь; давхцалтай эгнээнд = «урт | давхцал | урт»).  Багана, дам нуруу, хана, хучилтын
    /// арматур бүгд ижил — план, огтлол, дэлгээс, detail харагдацад.  Хэмжээсийн төрөл = хэрэглэгчийн ОДОО хэрэглэж буй (Revit-ийн Dimension хэрэгслийн өгөгдмөл).
    ///
    /// Давталт: сонгох → цэг дарах → тавигдана → дахин сонгох …  Esc = дуусгах (сонголтын үед), цэг дарах үед Esc = дахин сонгох.  Тавилт бүр тусдаа Ctrl+Z.
    /// Урьдчилан сонгосон арматур байвал эхний удаа түүнийг ашиглана.
    /// </summary>
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public class RebarLengthDimCommand : IExternalCommand
    {
        private const string Title = RfLengthDimService.Title;

        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            UIDocument uidoc;
            Document doc;
            if (!RfGuard.Begin(commandData, Title, out uidoc, out doc)) return Result.Cancelled;

            View view = doc.ActiveView;
            if (RfView.Use(view) == RfViewUse.Unsupported)
            {
                TaskDialog.Show(Title, RfText.UnsupportedView);
                return Result.Cancelled;
            }

            string planeWhy;
            if (!EnsureWorkPlane(doc, view, out planeWhy))
            {
                TaskDialog.Show(Title, "Энэ харагдацад ажлын хавтгай (work plane) тохируулж чадсангүй — хэмжээсийн байрлалыг дарах боломжгүй.\n\n" + planeWhy);
                return Result.Cancelled;
            }

            var filter = new RfRebarPickFilter();
            bool first = true;
            int made = 0, rounds = 0;
            string last = null;

            while (true)
            {
                List<Rebar> rebars = null;
                if (first)
                {
                    int unsupported;
                    List<Rebar> pre = RfRebarCollect.Resolve(Selected(uidoc, doc), out unsupported);
                    if (pre.Count > 0) rebars = pre;
                }
                first = false;

                if (rebars == null)
                {
                    try
                    {
                        IList<Reference> refs = uidoc.Selection.PickObjects(ObjectType.Element, filter, PickPrompt(rounds, last));
                        int unsupported;
                        rebars = RfRebarCollect.Resolve(refs.Select(r => doc.GetElement(r)), out unsupported);
                    }
                    catch (Autodesk.Revit.Exceptions.OperationCanceledException)
                    {
                        break;
                    }
                }
                if (rebars == null || rebars.Count == 0) continue;

                // Цэг дарах үед сонгосон арматур тодорч харагдана.
                try { uidoc.Selection.SetElementIds(rebars.Select(r => r.Id).ToList()); } catch { /* зөвхөн тав тух */ }

                XYZ point;
                try
                {
                    point = uidoc.Selection.PickPoint("Хэмжээсийн шугам тавих байрлал дээр дарна уу (" + rebars.Count + " арматур сонгосон) — Esc = дахин сонгох");
                }
                catch (Autodesk.Revit.Exceptions.OperationCanceledException)
                {
                    ClearSelection(uidoc);
                    continue;
                }
                catch (Exception ex)
                {
                    ClearSelection(uidoc);
                    TaskDialog.Show(Title, "Цэг дарах боломжгүй: " + ex.Message.Split('\n')[0].Trim());
                    break;
                }

                RfLenReport rep;
                try
                {
                    rep = RfLengthDimService.Place(doc, view, rebars, point);
                }
                catch (Exception ex)
                {
                    rep = new RfLenReport();
                    rep.Failures.Add(ex.Message.Split('\n')[0].Trim());
                }
                ClearSelection(uidoc);
                rounds++;
                made += rep.ChainsMade;
                last = Summary(rep);

                if (rep.Failures.Count > 0)
                {
                    RfGuard.ShowReport(Title,
                        rep.ChainsMade > 0 ? "Хэсэгчлэн тавигдлаа" : "Хэмжээс тавигдсангүй",
                        last + (rep.ChainsMade > 0 ? "\n\nCtrl+Z = энэ тавилтыг буцаана." : string.Empty),
                        rep.Failures.Concat(rep.Notes));
                }
            }
            return made > 0 ? Result.Succeeded : Result.Cancelled;
        }

        private static string PickPrompt(int rounds, string last)
        {
            string head = "Хэмжих арматуруудаа сонгоод Finish (Enter) дарна уу — олноор сонгож болно; Esc = дуусгах";
            return rounds == 0 || string.IsNullOrEmpty(last) ? head : "Сүүлд: " + last + ".  " + head;
        }

        internal static string Summary(RfLenReport rep)
        {
            if (rep.ChainsMade == 0) return "хэмжээс тавигдсангүй";
            return rep.ChainsMade + " хэмжээс (" + rep.Segments + " сегмент), " + rep.Rebars + " арматур · төрөл «" + rep.TypeName + "»";
        }

        private static IEnumerable<Element> Selected(UIDocument uidoc, Document doc)
        {
            ICollection<ElementId> ids;
            try { ids = uidoc.Selection.GetElementIds(); }
            catch { return Enumerable.Empty<Element>(); }
            return ids.Select(id => doc.GetElement(id)).Where(e => e != null).ToList();
        }

        private static void ClearSelection(UIDocument uidoc)
        {
            try { uidoc.Selection.SetElementIds(new List<ElementId>()); } catch { /* зөвхөн тав тух */ }
        }

        /// <summary>
        /// <c>PickPoint</c> нь харагдацын ИДЭВХТЭЙ ажлын хавтгай шаарддаг; огтлол/дэлгээс/detail харагдацад ихэвчлэн байдаггүй (тэгвэл Revit «no work plane» гэж
        /// унана).  Байхгүй бол харагдацын хавтгайд ажлын хавтгай тохируулна (тусдаа жижиг транзакц — зөвхөн харагдацын тохиргоо, элемент нэмэхгүй).
        /// </summary>
        private static bool EnsureWorkPlane(Document doc, View view, out string why)
        {
            why = null;
            try
            {
                if (view.SketchPlane != null) return true;
            }
            catch
            {
                // Уншигдахгүй — тохируулахыг оролдоно.
            }
            using (var t = new Transaction(doc, "MGL — Ажлын хавтгай (" + Title + ")"))
            {
                try
                {
                    t.Start();
                    XYZ normal = view.ViewDirection;
                    XYZ origin = RfConv.X(RfView.PlaneOrigin(view));
                    SketchPlane sp = SketchPlane.Create(doc, Plane.CreateByNormalAndOrigin(normal, origin));
                    view.SketchPlane = sp;
                    t.Commit();
                    return true;
                }
                catch (Exception ex)
                {
                    if (t.HasStarted() && !t.HasEnded()) t.RollBack();
                    why = ex.Message.Split('\n')[0].Trim();
                    return false;
                }
            }
        }
    }
}
