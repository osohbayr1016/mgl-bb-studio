using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Selection;
using MglBb.Core;
using MglBb.RevitSide;
using WCombo = System.Windows.Controls.ComboBox;
using WBrushes = System.Windows.Media.Brushes;
using WTextBox = System.Windows.Controls.TextBox;
using Transform = Autodesk.Revit.DB.Transform;

namespace MglBb.DimLines
{
    /// <summary>
    /// «Шугамаар хэмжээс» (ModPlus-ийн Dimensions by line): хэрэглэгч хоёр цэгээр шугам заана — тэр шугамыг огтолсон, сонгосон тохиргооны ангиллын
    /// элементүүдийн нүүр / төв, тэнхлэг, түвшин, шугам, reference plane-д нэг хэмжээсийн гинж тавина.  Тохиргоонууд (хэдэн ч) бүх төсөлд хуваалцана
    /// (%APPDATA%\MGL\BbStudio\dimlines.json).  «Давтах» бол Esc дарах хүртэл дахин дахин.  Хэмжээс бүр тусдаа undo.
    /// </summary>
    internal static class DimLineFlow
    {
        internal const string Title = "MGL ББ — Шугамаар хэмжээс";
        internal static string BookPath { get { return Path.Combine(Paths.Root, "dimlines.json"); } }
        private static readonly double Tol = BbGeom.Ft(1);

        private const ObjectSnapTypes Snaps = ObjectSnapTypes.Endpoints | ObjectSnapTypes.Midpoints | ObjectSnapTypes.Nearest | ObjectSnapTypes.WorkPlaneGrid |
            ObjectSnapTypes.Intersections | ObjectSnapTypes.Centers | ObjectSnapTypes.Perpendicular | ObjectSnapTypes.Tangents | ObjectSnapTypes.Quadrants | ObjectSnapTypes.Points;

        public static Result Run(UIDocument uidoc)
        {
            Document doc = uidoc.Document;
            View view = uidoc.ActiveView;
            if (!Supported(view))
            {
                TaskDialog.Show(Title, "Төлөвлөгөө, огтлол, фасад, дэлгээс эсвэл drafting харагдац нээнэ үү (3D, хуудас, түүвэрт хэмжээс тавихгүй).");
                return Result.Cancelled;
            }
            BbDimLines book;
            try { book = BbDimLines.Load(BookPath); }
            catch { try { File.Copy(BookPath, BookPath + ".broken", true); } catch { } book = BbDimLines.Default(); }

            List<string> dimTypes = new FilteredElementCollector(doc).OfClass(typeof(DimensionType)).Cast<DimensionType>()
                .Where(t => t.StyleType == DimensionStyleType.Linear && !string.IsNullOrEmpty(t.Name)).Select(t => t.Name).Distinct()
                .OrderBy(s => s, StringComparer.CurrentCulture).ToList();
            var win = new DimLineWindow(book, dimTypes, view is ViewPlan);
            try { new WindowInteropHelper(win).Owner = uidoc.Application.MainWindowHandle; } catch { }
            if (win.ShowDialog() != true) return Result.Cancelled;
            try { book.Save(BookPath); } catch { /* сонголт хадгалагдаагүй ч ажиллана */ }
            BbDimConfig cfg = book.Find(book.Current);
            if (cfg == null || cfg.Cats.Count == 0) { TaskDialog.Show(Title, "Тохиргоонд ангилал сонгоогүй байна."); return Result.Cancelled; }

            DimensionType type = string.IsNullOrEmpty(book.DimType) ? null
                : new FilteredElementCollector(doc).OfClass(typeof(DimensionType)).Cast<DimensionType>()
                    .FirstOrDefault(t => t.StyleType == DimensionStyleType.Linear && t.Name == book.DimType);
            EnsureWorkPlane(doc, view);

            int made = 0;
            ObjectSnapTypes snap = book.Snap ? Snaps : ObjectSnapTypes.None;
            while (true)
            {
                XYZ p0, p1, at = null;
                try
                {
                    p0 = uidoc.Selection.PickPoint(snap, "«" + cfg.Name + "»: шугамын ЭХНИЙ цэг (Esc — дуусгах)");
                    p1 = uidoc.Selection.PickPoint(snap, "«" + cfg.Name + "»: шугамын ХОЁР ДАХЬ цэг");
                }
                catch (Autodesk.Revit.Exceptions.OperationCanceledException) { break; }
                if (p0.DistanceTo(p1) < BbGeom.Ft(5)) continue;

                List<BbDimCand> refs = Collect(doc, view, p0, p1, cfg, book.Linked);
                if (refs.Count < 2)
                {
                    TaskDialog.Show(Title, "Шугам «" + cfg.Name + "» тохиргооны ангиллын элементийн хэмжих нүүр / тэнхлэгийг " + refs.Count + " удаа л огтолсон — " +
                        "хэмжээсэд 2-оос доошгүй хэрэгтэй.  Шугамыг элементүүдийн нүүрэнд перпендикуляр татна уу.");
                    if (!book.WorkCycle) break;
                    continue;
                }

                using (var tg = new TransactionGroup(doc, "MGL ББ: шугамаар хэмжээс"))
                {
                    tg.Start();
                    ElementId preview = ElementId.InvalidElementId;
                    if (book.Preview && book.PickLocation && view is ViewPlan) preview = DrawPreview(doc, view, p0, p1);
                    if (book.PickLocation)
                    {
                        if (book.Preview) { try { uidoc.Selection.SetElementIds(Owners(refs)); } catch { } }
                        try { at = uidoc.Selection.PickPoint(snap, "Хэмжээсийн шугамын байрлал (" + refs.Count + " лавлагаа)"); }
                        catch (Autodesk.Revit.Exceptions.OperationCanceledException) { tg.RollBack(); break; }
                        finally { if (book.Preview) { try { uidoc.Selection.SetElementIds(new List<ElementId>()); } catch { } } }
                    }
                    string err;
                    using (var t = new Transaction(doc, "MGL ББ: шугамаар хэмжээс «" + cfg.Name + "»"))
                    {
                        t.Start();
                        if (preview != ElementId.InvalidElementId) { try { doc.Delete(preview); } catch { } }
                        err = Place(doc, view, p0, p1, at, refs, type);
                        if (err == null) t.Commit(); else t.RollBack();
                    }
                    if (err == null) { tg.Assimilate(); made++; }
                    else { tg.RollBack(); TaskDialog.Show(Title, "Хэмжээс тавьж чадсангүй: " + err); }
                }
                if (!book.WorkCycle) break;
            }
            return made > 0 ? Result.Succeeded : Result.Cancelled;
        }

        internal static bool Supported(View v)
        {
            if (v == null || v.IsTemplate) return false;
            switch (v.ViewType)
            {
                case ViewType.FloorPlan: case ViewType.CeilingPlan: case ViewType.EngineeringPlan: case ViewType.AreaPlan:
                case ViewType.Section: case ViewType.Elevation: case ViewType.Detail: case ViewType.DraftingView:
                    return true;
                default: return false;
            }
        }

        /// <summary>Огтлол/фасадад ажлын хавтгай байхгүй бол PickPoint ажиллахгүй — харагдацын хавтгайгаар тохируулна.</summary>
        private static void EnsureWorkPlane(Document doc, View view)
        {
            if (view.SketchPlane != null) return;
            using (var t = new Transaction(doc, "MGL ББ: ажлын хавтгай"))
            {
                t.Start();
                view.SketchPlane = SketchPlane.Create(doc, Plane.CreateByNormalAndOrigin(view.ViewDirection, view.Origin));
                t.Commit();
            }
        }

        private static ElementId DrawPreview(Document doc, View view, XYZ p0, XYZ p1)
        {
            using (var t = new Transaction(doc, "MGL ББ: шугамын урьдчилсан харагдац"))
            {
                t.Start();
                try
                {
                    DetailCurve dc = doc.Create.NewDetailCurve(view, Line.CreateBound(OnPlane(view, p0), OnPlane(view, p1)));
                    t.Commit();
                    return dc.Id;
                }
                catch { t.RollBack(); return ElementId.InvalidElementId; }
            }
        }

        private static List<ElementId> Owners(List<BbDimCand> refs)
        {
            var res = new List<ElementId>();
            foreach (string o in refs.Select(r => r.Owner).Distinct())
                if (o.IndexOf(':') < 0 && long.TryParse(o, out long v)) res.Add(new ElementId(v));
            return res;
        }

        private static XYZ OnPlane(View view, XYZ p)
        {
            XYZ n = view.ViewDirection;
            return p - n * (p - view.Origin).DotProduct(n);
        }

        /// <summary>Хэмжээс тавина (нээлттэй Transaction дотор).  Алдаа бол шалтгаан.</summary>
        internal static string Place(Document doc, View view, XYZ p0, XYZ p1, XYZ at, List<BbDimCand> refs, DimensionType type)
        {
            XYZ d = (p1 - p0).Normalize();
            XYZ n = view.ViewDirection.CrossProduct(d).Normalize();
            double off = at == null ? 0 : (at - p0).DotProduct(n);
            double a = Math.Min(0, refs[0].At), b = Math.Max(p0.DistanceTo(p1), refs[refs.Count - 1].At);
            XYZ q0 = p0 + d * a + n * off, q1 = p0 + d * b + n * off;
            if (!(view is ViewPlan)) { q0 = OnPlane(view, q0); q1 = OnPlane(view, q1); }
            var ra = new ReferenceArray();
            foreach (BbDimCand r in refs) ra.Append((Reference)r.Ref);
            try
            {
                Line line = Line.CreateBound(q0, q1);
                Dimension dim = type != null ? doc.Create.NewDimension(view, line, ra, type) : doc.Create.NewDimension(view, line, ra);
                return dim == null ? "Revit хэмжээс үүсгэсэнгүй." : null;
            }
            catch (Exception ex) { return ex.Message.Split('\n')[0]; }
        }

        // ── Лавлагаа цуглуулах ───────────────────────────────────────────

        /// <summary>Шугамын хүрээ: R = шугамын чиглэл, U = харагдацын хавтгай дахь перпендикуляр, V = харагдацын чиглэл.</summary>
        private sealed class Ctx
        {
            public BbFrame F;
            public double Len;
            public View View;
            public BbDimConfig Cfg;
            public readonly List<BbDimCand> Out = new List<BbDimCand>();

            public double Along(XYZ p) { return (p - F.O).DotProduct(F.R); }
            public double Side(XYZ p) { return (p - F.O).DotProduct(F.U); }
            public bool InRange(double at) { return at >= -Tol && at <= Len + Tol; }
        }

        /// <summary>Шугам p0→p1-ийг огтолсон лавлагаанууд (тохиргооны дүрмээр сонгож, байрлалаар эрэмбэлсэн).</summary>
        internal static List<BbDimCand> Collect(Document doc, View view, XYZ p0, XYZ p1, BbDimConfig cfg, bool linked)
        {
            XYZ a = OnPlane(view, p0), b = OnPlane(view, p1);
            var c = new Ctx { F = BbFrame.Make(a, b - a, view.ViewDirection.CrossProduct(b - a)), Len = a.DistanceTo(b), View = view, Cfg = cfg };
            var cats = new List<BuiltInCategory>();
            foreach (BbDimCat k in cfg.Cats)
                if (Enum.TryParse(k.Key, out BuiltInCategory bic)) cats.Add(bic);
            if (cats.Count == 0) return c.Out;

            foreach (Element e in new FilteredElementCollector(doc, view.Id).WherePasses(new ElementMulticategoryFilter(cats)).WhereElementIsNotElementType())
                Visit(c, e, null, e.Id.Value.ToString());

            if (linked && view.ViewType != ViewType.DraftingView)
                foreach (RevitLinkInstance li in new FilteredElementCollector(doc, view.Id).OfClass(typeof(RevitLinkInstance)).Cast<RevitLinkInstance>())
                {
                    if (li.GetLinkDocument() == null) continue;
                    IEnumerable<Element> els;
                    try { els = new FilteredElementCollector(doc, view.Id, li.Id).WherePasses(new ElementMulticategoryFilter(cats)).WhereElementIsNotElementType().ToList(); }
                    catch { continue; }
                    foreach (Element e in els) Visit(c, e, li, li.Id.Value + ":" + e.Id.Value);
                }
            return BbDimLines.Pick(c.Out, cfg, Tol);
        }

        private static void Visit(Ctx c, Element e, RevitLinkInstance li, string owner)
        {
            Category cat = e.Category;
            if (cat == null) return;
            string key;
            try { key = ((BuiltInCategory)cat.Id.Value).ToString(); } catch { return; }
            BbDimCat dc = c.Cfg.Find(key);
            if (dc == null) return;
            Transform T = li?.GetTotalTransform() ?? Transform.Identity;
            if (!(e is Level) && !Crosses(c, e.get_BoundingBox(li == null ? c.View : null) ?? e.get_BoundingBox(null), T)) return;

            Action<int, double, Reference> add = (kind, at, r) =>
            {
                if (r == null || !c.InRange(at)) return;
                if (li != null) { try { r = r.CreateLinkReference(li); } catch { return; } }
                c.Out.Add(new BbDimCand { Owner = owner, Cat = key, Kind = kind, At = at, Ref = r });
            };

            switch (e)
            {
                case Autodesk.Revit.DB.Grid g:
                    if (g.Curve is Line gl && Vertical(c, T, gl, out double ga)) add(BbDimCand.Single, ga, new Reference(g));
                    return;
                case Level lv:
                    if (Math.Abs(c.F.R.Z) < 0.999) return;
                    double z = T.OfPoint(new XYZ(0, 0, lv.ProjectElevation)).Z;
                    Reference lr = null;
                    try { lr = lv.GetPlaneReference(); } catch { }
                    add(BbDimCand.Single, (z - c.F.O.Z) / c.F.R.Z, lr);
                    return;
                case ReferencePlane rp:
                    if (Math.Abs(T.OfVector(rp.Normal).DotProduct(c.F.R)) < 0.999) return;
                    add(BbDimCand.Single, c.Along(T.OfPoint(rp.BubbleEnd)), rp.GetReference());
                    return;
                case CurveElement ce:
                    if (ce.GeometryCurve is Line cl && Perp(c, T, cl, out double ca, bounded: true)) add(BbDimCand.Single, ca, cl.Reference);
                    return;
            }

            if (dc.Center)
            {
                if (e is FamilyInstance fi) Center(c, fi, T, add);
                else if (e is MEPCurve) CenterLines(c, e, T, li == null, add);
            }
            Faces(c, e, T, li == null, add);
        }

        /// <summary>Элементийн bbox (загвар → <paramref name="T"/>) шугамыг огтолж байгаа эсэх (харагдацын хавтгайд).</summary>
        private static bool Crosses(Ctx c, BoundingBoxXYZ b, Transform T)
        {
            if (b == null) return false;
            Transform t = T.Multiply(b.Transform ?? Transform.Identity);
            double a0 = double.MaxValue, a1 = double.MinValue, s0 = double.MaxValue, s1 = double.MinValue;
            for (int i = 0; i < 8; i++)
            {
                XYZ p = t.OfPoint(new XYZ((i & 1) == 0 ? b.Min.X : b.Max.X, (i & 2) == 0 ? b.Min.Y : b.Max.Y, (i & 4) == 0 ? b.Min.Z : b.Max.Z));
                double a = c.Along(p), s = c.Side(p);
                a0 = Math.Min(a0, a); a1 = Math.Max(a1, a); s0 = Math.Min(s0, s); s1 = Math.Max(s1, s);
            }
            return s0 <= Tol && s1 >= -Tol && a1 >= -Tol && a0 <= c.Len + Tol;
        }

        /// <summary>Хэвтээ шугамаар үүсэх БОСОО хавтгай (тэнхлэг, дамнурууны тэнхлэг) шугамд перпендикуляр бол байрлал — төлөвлөгөө, огтлол хоёуланд.</summary>
        private static bool Vertical(Ctx c, Transform T, Line l, out double at)
        {
            at = 0;
            XYZ q0 = T.OfPoint(l.GetEndPoint(0)), dir = T.OfVector(l.Direction);
            XYZ nrm = dir.CrossProduct(XYZ.BasisZ);
            if (nrm.GetLength() < 1e-6 || Math.Abs(nrm.Normalize().DotProduct(c.F.R)) < 0.999) return false;
            at = c.Along(q0);
            return true;
        }

        /// <summary>Харагдацын хавтгай дахь шулуун (detail шугам, хоолойн тэнхлэг) перпендикуляр бөгөөд огтлолцох эсэх; <paramref name="at"/> = огтлолцлын байрлал.</summary>
        private static bool Perp(Ctx c, Transform T, Line l, out double at, bool bounded = false)
        {
            at = 0;
            XYZ q0 = T.OfPoint(l.GetEndPoint(0)), q1 = T.OfPoint(l.GetEndPoint(1));
            XYZ dir = (q1 - q0).Normalize();
            if (Math.Abs(dir.DotProduct(c.F.R)) > 0.02) return false;
            double s0 = c.Side(q0), s1 = c.Side(q1);
            if (Math.Abs(s1 - s0) < 1e-9) return false;
            if (bounded && (Math.Min(s0, s1) > Tol || Math.Max(s0, s1) < -Tol)) return false;
            at = c.Along(q0 + (q1 - q0) * (-s0 / (s1 - s0)));
            return true;
        }

        /// <summary>Шугамын чиглэлд перпендикуляр, шугам огтолсон хавтгай нүүрүүд.</summary>
        private static void Faces(Ctx c, Element e, Transform T, bool host, Action<int, double, Reference> add)
        {
            var opts = new List<Options>();
            if (host) opts.Add(new Options { ComputeReferences = true, View = c.View });
            opts.Add(new Options { ComputeReferences = true, DetailLevel = ViewDetailLevel.Fine });
            foreach (Options opt in opts)
            {
                GeometryElement ge;
                try { ge = e.get_Geometry(opt); }
                catch { continue; }
                if (ge == null) continue;
                int found = 0;
                BbElevTopChain.Walk(ge, T, (s, tr) =>
                {
                    foreach (Face fc in s.Faces)
                    {
                        if (!(fc is PlanarFace pf) || pf.Reference == null) continue;
                        if (Math.Abs(tr.OfVector(pf.FaceNormal).DotProduct(c.F.R)) < 0.999) continue;
                        double at = c.Along(tr.OfPoint(pf.Origin));
                        if (!c.InRange(at)) continue;
                        // Нүүр шугамд перпендикуляр тул харагдацад шулуун болж харагдана — түүний хажуугийн (U) муж шугамыг (U = 0) агуулбал огтолсон.
                        double s0 = double.MaxValue, s1 = double.MinValue;
                        foreach (EdgeArray loop in pf.EdgeLoops)
                            foreach (Edge ed in loop)
                                foreach (XYZ q in ed.Tessellate())
                                {
                                    double sv = c.Side(tr.OfPoint(q));
                                    if (sv < s0) s0 = sv;
                                    if (sv > s1) s1 = sv;
                                }
                        if (s0 > Tol || s1 < -Tol) continue;
                        add(BbDimCand.Face, at, pf.Reference);
                        found++;
                    }
                });
                if (found > 0) return;
            }
        }

        /// <summary>Family-ийн төвийн reference plane: шугамд перпендикуляр нь — цэгэн элементэд Left/Right (HandOrientation) эсвэл Front/Back,
        /// шугаман элементэд (дамнуруу) тэнхлэгийг агуулсан Front/Back.</summary>
        private static void Center(Ctx c, FamilyInstance fi, Transform T, Action<int, double, Reference> add)
        {
            XYZ at;
            FamilyInstanceReferenceType kind;
            if (fi.Location is LocationCurve lc && lc.Curve is Line ln)
            {
                if (!Vertical(c, T, ln, out double a)) return;
                at = c.F.O + c.F.R * a;
                kind = FamilyInstanceReferenceType.CenterFrontBack;
            }
            else if (fi.Location is LocationPoint lp)
            {
                at = T.OfPoint(lp.Point);
                XYZ hand, facing;
                try { hand = T.OfVector(fi.HandOrientation); facing = T.OfVector(fi.FacingOrientation); } catch { return; }
                if (Math.Abs(hand.DotProduct(c.F.R)) > 0.98) kind = FamilyInstanceReferenceType.CenterLeftRight;
                else if (Math.Abs(facing.DotProduct(c.F.R)) > 0.98) kind = FamilyInstanceReferenceType.CenterFrontBack;
                else return;
            }
            else return;
            IList<Reference> refs;
            try { refs = fi.GetReferences(kind); } catch { return; }
            if (refs != null && refs.Count > 0) add(BbDimCand.Center, c.Along(at), refs[0]);
        }

        /// <summary>Хоолой, суваг, кабелийн тавиурын тэнхлэгийн шугам (харагдацын геометрт, нуугдмал ч).</summary>
        private static void CenterLines(Ctx c, Element e, Transform T, bool host, Action<int, double, Reference> add)
        {
            var opt = host ? new Options { ComputeReferences = true, View = c.View, IncludeNonVisibleObjects = true }
                           : new Options { ComputeReferences = true, DetailLevel = ViewDetailLevel.Fine, IncludeNonVisibleObjects = true };
            GeometryElement ge;
            try { ge = e.get_Geometry(opt); } catch { return; }
            if (ge == null) return;
            foreach (GeometryObject go in ge)
                if (go is Line l && l.Reference != null && Perp(c, T, l, out double at, bounded: true)) { add(BbDimCand.Center, at, l.Reference); return; }
        }
    }

    /// <summary>Үндсэн цонх (ModPlus-ийн «DIMENSIONS BY LINE»): тохиргоо сонгох / нэмэх / засах / устгах, ажиллах сонголтууд.</summary>
    internal sealed class DimLineWindow : Window
    {
        private readonly BbDimLines _book;
        private readonly WCombo _cfg = new WCombo { MinWidth = 220, VerticalAlignment = VerticalAlignment.Center };
        private readonly CheckBox _cycle, _snap, _loc, _linked, _preview;
        private readonly WCombo _type = new WCombo();

        public DimLineWindow(BbDimLines book, IList<string> dimTypes, bool plan)
        {
            _book = book;
            Title = DimLineFlow.Title;
            Width = 460;
            SizeToContent = SizeToContent.Height;
            ResizeMode = ResizeMode.NoResize;
            WindowStartupLocation = WindowStartupLocation.CenterOwner;
            ShowInTaskbar = false;
            FontFamily = new FontFamily("Segoe UI");
            FontSize = 13;

            var root = new StackPanel { Margin = new Thickness(16) };
            var top = new DockPanel { Margin = new Thickness(0, 0, 0, 8) };
            var lbl = new TextBlock { Text = "Тохиргоо:", VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 8, 0) };
            DockPanel.SetDock(lbl, Dock.Left);
            top.Children.Add(lbl);
            var del = IconBtn("✕", "Тохиргоог устгах", Delete);
            var edit = IconBtn("✎", "Тохиргоог засах", () => EditConfig(_book.Find(_cfg.SelectedItem as string)));
            var add = IconBtn("+", "Шинэ тохиргоо", () => EditConfig(null));
            foreach (Button b in new[] { del, edit, add }) { DockPanel.SetDock(b, Dock.Right); top.Children.Add(b); }
            top.Children.Add(_cfg);
            root.Children.Add(top);

            _cycle = Check(root, "Давтах (Esc дарах хүртэл)", book.WorkCycle, "Work Cycle: хэмжээс тавьсны дараа дараагийн шугамыг шууд заана.");
            _snap = Check(root, "Цэг заахдаа объектын snap ашиглах", book.Snap, "Object snap when specifying points.");
            _loc = Check(root, "Хэмжээсийн шугамын байрлалыг заах", book.PickLocation, "Specify the location of the dimension line: гурав дахь цэгээр. Үгүй бол заасан шугам дээр.");
            _linked = Check(root, "Холбосон (link) файлын элементүүдийг хэмжих", book.Linked, "Proceed linked files.");
            _preview = Check(root, "Төлөвлөгөөнд шугамыг урьдчилан харуулах", book.Preview, "Line preview on Plan: байрлал заах үед шугам ба хэмжигдэх элементүүд тодорно.");
            _preview.IsEnabled = plan;

            var tr = new DockPanel { Margin = new Thickness(0, 8, 0, 0) };
            var tl = new TextBlock { Text = "Хэмжээсийн төрөл:", VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 8, 0) };
            DockPanel.SetDock(tl, Dock.Left);
            tr.Children.Add(tl);
            _type.Items.Add("(харагдацын өгөгдмөл)");
            foreach (string s in dimTypes) _type.Items.Add(s);
            _type.SelectedIndex = Math.Max(0, dimTypes.IndexOf(book.DimType) + 1);
            tr.Children.Add(_type);
            root.Children.Add(tr);

            root.Children.Add(Buttons("Үргэлжлүүлэх", Continue, 14));
            Content = root;
            FillConfigs(book.Find(book.Current)?.Name ?? book.Configs.FirstOrDefault()?.Name);
        }

        /// <summary>Голлосон «үндсэн | Болих» товчны мөр (Enter = үндсэн, Esc = болих).</summary>
        internal static StackPanel Buttons(string main, Action onMain, double top)
        {
            var row = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, top, 0, 0) };
            var go = new Button { Content = main, MinWidth = 110, Padding = new Thickness(10, 4, 10, 4), IsDefault = true, Margin = new Thickness(0, 0, 8, 0) };
            go.Click += (s, e) => onMain();
            row.Children.Add(go);
            row.Children.Add(new Button { Content = "Болих", MinWidth = 90, Padding = new Thickness(10, 4, 10, 4), IsCancel = true });
            return row;
        }

        private static CheckBox Check(System.Windows.Controls.Panel p, string label, bool value, string tip)
        {
            var c = new CheckBox { Content = label, IsChecked = value, ToolTip = tip, Margin = new Thickness(0, 3, 0, 3) };
            p.Children.Add(c);
            return c;
        }

        private static Button IconBtn(string glyph, string tip, Action a)
        {
            var b = new Button { Content = glyph, ToolTip = tip, Width = 30, Height = 26, Margin = new Thickness(4, 0, 0, 0), FontSize = 15, Padding = new Thickness(0) };
            b.Click += (s, e) => a();
            return b;
        }

        private void FillConfigs(string select)
        {
            _cfg.Items.Clear();
            foreach (BbDimConfig c in _book.Configs) _cfg.Items.Add(c.Name);
            _cfg.SelectedItem = select != null && _book.Find(select) != null ? _book.Find(select).Name : _cfg.Items.Cast<string>().FirstOrDefault();
        }

        private void EditConfig(BbDimConfig c)
        {
            var w = new DimConfigWindow(_book, c) { Owner = this };
            if (w.ShowDialog() != true) return;
            if (c != null) _book.Configs[_book.Configs.IndexOf(c)] = w.Result;
            else _book.Configs.Add(w.Result);
            Save();
            FillConfigs(w.Result.Name);
        }

        private void Delete()
        {
            BbDimConfig c = _book.Find(_cfg.SelectedItem as string);
            if (c == null) return;
            if (MessageBox.Show(this, "«" + c.Name + "» тохиргоог устгах уу?", DimLineFlow.Title, MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
            _book.Configs.Remove(c);
            Save();
            FillConfigs(null);
        }

        private void Save()
        {
            try { _book.Save(DimLineFlow.BookPath); }
            catch (Exception ex) { MessageBox.Show(this, "Хадгалж чадсангүй: " + ex.Message, DimLineFlow.Title); }
        }

        private void Continue()
        {
            BbDimConfig c = _book.Find(_cfg.SelectedItem as string);
            if (c == null) { MessageBox.Show(this, "Тохиргоо сонгоно уу («+» — шинэ).", DimLineFlow.Title); return; }
            if (c.Cats.Count == 0) { MessageBox.Show(this, "«" + c.Name + "» тохиргоонд ангилал алга — «✎»-ээр засна уу.", DimLineFlow.Title); return; }
            _book.Current = c.Name;
            _book.WorkCycle = _cycle.IsChecked == true;
            _book.Snap = _snap.IsChecked == true;
            _book.PickLocation = _loc.IsChecked == true;
            _book.Linked = _linked.IsChecked == true;
            if (_preview.IsEnabled) _book.Preview = _preview.IsChecked == true;
            _book.DimType = _type.SelectedIndex > 0 ? _type.SelectedItem as string : "";
            DialogResult = true;
        }
    }

    /// <summary>Тохиргоо үүсгэх / засах цонх (ModPlus-ийн «CREATE CONFIGURATION»): нэр, салбарын шүүлт, ангилал бүрийн сонголт.</summary>
    internal sealed class DimConfigWindow : Window
    {
        private sealed class Row
        {
            public BbDimCatInfo Info;
            public Border Box;
            public CheckBox On, Edges, Center;
        }

        private readonly BbDimLines _book;
        private readonly BbDimConfig _self;
        private readonly WTextBox _name = new WTextBox { Margin = new Thickness(0, 2, 0, 6), Padding = new Thickness(2) };
        private readonly List<CheckBox> _disc = new List<CheckBox>();
        private readonly List<Row> _rows = new List<Row>();
        private readonly TextBlock _status = new TextBlock { Foreground = WBrushes.Firebrick, TextWrapping = TextWrapping.Wrap };

        public BbDimConfig Result { get; private set; }

        public DimConfigWindow(BbDimLines book, BbDimConfig self)
        {
            _book = book;
            _self = self;
            Title = self == null ? "MGL ББ — Тохиргоо үүсгэх" : "MGL ББ — «" + self.Name + "» тохиргоо засах";
            Width = 620;
            Height = 640;
            ResizeMode = ResizeMode.CanResize;
            WindowStartupLocation = WindowStartupLocation.CenterOwner;
            ShowInTaskbar = false;
            FontFamily = new FontFamily("Segoe UI");
            FontSize = 13;

            var root = new DockPanel { Margin = new Thickness(16) };
            var head = new StackPanel();
            DockPanel.SetDock(head, Dock.Top);
            head.Children.Add(new TextBlock { Text = "Тохиргооны нэр", FontWeight = FontWeights.SemiBold });
            _name.Text = self?.Name ?? "";
            head.Children.Add(_name);
            var dp = new WrapPanel { Margin = new Thickness(0, 0, 0, 6) };
            dp.Children.Add(new TextBlock { Text = "Салбар:", Margin = new Thickness(0, 2, 8, 2) });
            foreach (string d in BbDimLines.Disciplines)
            {
                var cb = new CheckBox { Content = d, IsChecked = true, Margin = new Thickness(0, 2, 12, 2) };
                cb.Checked += (s, e) => Filter(); cb.Unchecked += (s, e) => Filter();
                _disc.Add(cb);
                dp.Children.Add(cb);
            }
            head.Children.Add(dp);
            root.Children.Add(head);

            var bottom = new StackPanel { Margin = new Thickness(0, 8, 0, 0) };
            DockPanel.SetDock(bottom, Dock.Bottom);
            bottom.Children.Add(new TextBlock
            {
                Text = "«Зөвхөн захын нүүр» — элемент бүрийн хоёр гадна нүүр; «Төвөөр» — төв (хоёулаа = нүүр | төв | нүүр); аль нь ч үгүй — шугам огтолсон бүх нүүр.",
                Foreground = WBrushes.DimGray, TextWrapping = TextWrapping.Wrap,
            });
            bottom.Children.Add(_status);
            bottom.Children.Add(DimLineWindow.Buttons("Хадгалах", Accept, 8));
            root.Children.Add(bottom);

            var list = new StackPanel();
            foreach (BbDimCatInfo info in BbDimLines.Catalog.OrderBy(c => c.Name, StringComparer.CurrentCulture))
            {
                BbDimCat cur = self?.Find(info.Key);
                var r = new Row { Info = info, On = new CheckBox { Content = info.Name, IsChecked = cur != null, VerticalAlignment = VerticalAlignment.Center } };
                var line = new DockPanel();
                var opts = new StackPanel { Orientation = Orientation.Horizontal };
                DockPanel.SetDock(opts, Dock.Right);
                if (info.HasEdges) { r.Edges = new CheckBox { Content = "Зөвхөн захын нүүр", IsChecked = cur?.Edges == true, Margin = new Thickness(12, 0, 0, 0) }; opts.Children.Add(r.Edges); }
                if (info.HasCenter) { r.Center = new CheckBox { Content = "Төвөөр", IsChecked = cur?.Center == true, Margin = new Thickness(12, 0, 0, 0) }; opts.Children.Add(r.Center); }
                line.Children.Add(opts);
                line.Children.Add(r.On);
                r.Box = new Border { BorderBrush = WBrushes.Gainsboro, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(3), Padding = new Thickness(8, 5, 8, 5), Margin = new Thickness(0, 0, 4, 4), Child = line };
                r.On.Checked += (s, e) => Enable(r); r.On.Unchecked += (s, e) => Enable(r);
                Enable(r);
                _rows.Add(r);
                list.Children.Add(r.Box);
            }
            root.Children.Add(new ScrollViewer { Content = list, VerticalScrollBarVisibility = ScrollBarVisibility.Auto });
            Content = root;
            Loaded += (s, e) => _name.Focus();
        }

        private static void Enable(Row r)
        {
            bool on = r.On.IsChecked == true;
            if (r.Edges != null) r.Edges.IsEnabled = on;
            if (r.Center != null) r.Center.IsEnabled = on;
        }

        /// <summary>Салбарын шүүлт — сонгосон ангилал үргэлж харагдана.</summary>
        private void Filter()
        {
            var on = new HashSet<string>(_disc.Where(c => c.IsChecked == true).Select(c => (string)c.Content));
            foreach (Row r in _rows)
                r.Box.Visibility = r.On.IsChecked == true || r.Info.Disciplines.Any(on.Contains) ? System.Windows.Visibility.Visible : System.Windows.Visibility.Collapsed;
        }

        private void Accept()
        {
            string name = (_name.Text ?? "").Trim();
            string p = _book.NameProblem(name, _self);
            if (p != null) { _status.Text = p; return; }
            var c = new BbDimConfig { Name = name };
            foreach (Row r in _rows.Where(r => r.On.IsChecked == true))
                c.Cats.Add(new BbDimCat { Key = r.Info.Key, Edges = r.Edges?.IsChecked == true, Center = r.Center?.IsChecked == true });
            if (c.Cats.Count == 0) { _status.Text = "Дор хаяж нэг ангилал сонгоно уу."; return; }
            Result = c;
            DialogResult = true;
        }
    }
}
