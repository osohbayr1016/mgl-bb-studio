using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using MglBb.Core;

namespace MglBb.RevitSide
{
    /// <summary>
    /// Хуудсанд байрлуулах — ЖИШЭЭ-1-ийн «5-1 ДАМНУРУУ ДН-1 АРМАТУРЧЛАЛ, ОГТЛОЛ, ТҮҮВЭР» (A2 «Булангын_хүснэгт_2021 : E@C A2») загвараар:
    /// хэвтээ дэлгээсийн хэсгүүд ДЭЭРЭЭС доош давхарлана (эхнийх «Гарчиг - Доогуур зураас», бусад «"Хоосон"»), огтлолууд доор нь мөр мөрөөр
    /// («Гарчиг - Огтлол»), баруун талд арматурын/бетоны хүснэгтэд ≈ 200 мм чөлөөлнө.  Босоо (баганын) дэлгээс зүүнээс баруун тийш, огтлол
    /// түүний баруун талд.  Багтахгүй бол дараагийн хуудас («… (2)»).  Хуудасны дугаар — компанийн цувралын дараагийн чөлөөт дугаар (<see cref="BbSheetSeries"/>).
    /// Нээлттэй Transaction дотор.
    /// </summary>
    internal static class BbSheets
    {
        private static double Mm(double mm) { return mm / 304.8; }

        [ThreadStatic] private static bool _reserve;

        /// <summary>
        /// Эхлээд ЖИШЭЭ-1 шиг баруун талд хүснэгтийн (түүвэр) зурвастай; нэг хуудсанд багтахгүй бол буцааж БҮТЭН өргөнөөр (хуудас цөөн).
        /// Дараа нь хуудас бүрд огтлол 1, 2, 3 …, дэлгээс тэдний дараа дугаартай (гарчиг «ОГТЛОЛ 1 - 1»).
        /// </summary>
        public static List<ViewSheet> Place(Document doc, string mark, BbMemberKind kind, IList<View> elevs, IList<View> secs, BbStandard std,
            List<BbIssue> issues, List<string> notes)
        {
            List<ViewSheet> res;
            if (kind == BbMemberKind.Slab)
            {
                // Хучилтын төлөвлөгөө бүтэн хуудсыг эзэлдэг (ЖИШЭЭ-1 7-10 … 7-12) — түүврийн зурвас нөөцлөхгүй.
                _reserve = false;
                res = PlaceOnce(doc, mark, kind, elevs, secs, std, issues, notes);
                Number(doc, res, secs);
                return res;
            }
            using (var st = new SubTransaction(doc))
            {
                st.Start();
                _reserve = true;
                var i1 = new List<BbIssue>();
                var n1 = new List<string>();
                res = PlaceOnce(doc, mark, kind, elevs, secs, std, i1, n1);
                if (res.Count <= 1)
                {
                    st.Commit();
                    issues.AddRange(i1);
                    notes.AddRange(n1);
                    Number(doc, res, secs);
                    return res;
                }
                st.RollBack();
            }
            _reserve = false;
            res = PlaceOnce(doc, mark, kind, elevs, secs, std, issues, notes);
            if (res.Count > 0) notes.Add(mark + ": хүснэгтийн (түүвэр) зурвасгүйгээр бүтэн өргөнөөр байрлуулав — түүврийг зайтай хэсэгт/дараагийн хуудсанд.");
            Number(doc, res, secs);
            return res;
        }

        private static void Number(Document doc, List<ViewSheet> sheets, IList<View> secs)
        {
            var secIds = new List<ElementId>((secs ?? new List<View>()).Select(v => v.Id));
            foreach (ViewSheet sh in sheets)
            {
                var vps = sh.GetAllViewports().Select(id => doc.GetElement(id)).OfType<Viewport>().ToList();
                int t = 0;
                foreach (Viewport vp in vps) Set(vp, "~" + (++t));     // түр — дугаар хуудсанд давтагдахгүй байх ёстой
                int k = 0;
                foreach (Viewport vp in vps.Where(v => secIds.Contains(v.ViewId)).OrderBy(v => secIds.IndexOf(v.ViewId))) Set(vp, (++k).ToString());
                foreach (Viewport vp in vps.Where(v => !secIds.Contains(v.ViewId))) Set(vp, (++k).ToString());
            }
        }

        private static void Set(Viewport vp, string no)
        {
            try { vp.get_Parameter(BuiltInParameter.VIEWPORT_DETAIL_NUMBER)?.Set(no); } catch { }
        }

        private static List<ViewSheet> PlaceOnce(Document doc, string mark, BbMemberKind kind, IList<View> elevs, IList<View> secs, BbStandard std,
            List<BbIssue> issues, List<string> notes)
        {
            var sheets = new List<ViewSheet>();
            if ((elevs == null || elevs.Count == 0) && (secs == null || secs.Count == 0)) return sheets;
            BbSheetStandard ss = std.Sheet;
            FamilySymbol tb = TitleBlock(doc, ss.TitleBlock, mark, issues);
            if (tb == null) return sheets;
            if (!tb.IsActive) tb.Activate();
            string baseName = BaseName(ss, kind, mark);
            ElementId vpElev = ViewportType(doc, string.IsNullOrEmpty(ss.ElevViewportType) ? "Гарчиг - Доогуур зураас" : ss.ElevViewportType);
            ElementId vpPart = ViewportType(doc, ss.ElevPartViewportType);
            ElementId vpSec = ViewportType(doc, ss.SecViewportType);

            Page cur = NewSheet(doc, tb, baseName, sheets, ss, kind);
            if (cur == null) return sheets;
            double gap = Mm(Math.Max(1, ss.GapMm));

            // ── Дэлгээс.  Хэмжээ = ХАРАГДАХ агуулга (crop + энэ харагдацын тэмдэглэгээ + гарчиг) — annotation crop-ын өгөгдмөл зай БИШ
            //    (ЖИШЭЭ-1-д инженер viewport-ын хүрээг давхцуулдаг; хүрээгээр байрлуулбал ДН-1 нэг хуудсанд багтдаггүй байв).
            int n = 0;
            foreach (View v in elevs ?? new List<View>())
            {
                if (!Viewport.CanAddViewToSheet(doc, cur.Sheet.Id, v.Id)) { notes.Add("«" + v.Name + "» аль хэдийн хуудсанд байрласан — алгасав."); continue; }
                Viewport vp = Make(doc, cur.Sheet, v, n == 0 || kind == BbMemberKind.Wall ? vpElev : (vpPart ?? vpElev));
                Rect r = Content(doc, vp, v);
                if (r.W >= r.H)
                {
                    // хэвтээ: дээрээс доош, хэвтээгээр БҮТЭН өргөний голд (хүснэгтийн зурвас дэлгээсийн доор л)
                    if (cur.Y - r.H < cur.Y0 && cur.Used) { cur = NewSheet(doc, tb, baseName, sheets, ss, kind); if (cur == null) break; vp = MoveTo(doc, vp, cur.Sheet); r = Content(doc, vp, v); }
                    // Хана: зүүн тийш (ЖИШЭЭ-1 6-11 — баруун талд огтлол, түүвэр); дамнуруу: бүтэн өргөний голд.
                    double x0 = kind == BbMemberKind.Wall ? cur.XF0 : Math.Max(cur.XF0, (cur.XF0 + cur.XF1) / 2 - r.W / 2);
                    Put(vp, r, x0, cur.Y);
                    cur.ElevRight = Math.Max(cur.ElevRight, x0 + r.W);
                    if (r.W > cur.XF1 - cur.XF0) notes.Add("«" + v.Name + "» хуудасны өргөнөөс урт (" + (r.W * 304.8).ToString("0") + " мм) — хэсэглэх уртыг (стандарт) багасгана уу.");
                    cur.Y -= r.H + gap;
                }
                else
                {
                    // босоо (багана): зүүнээс баруун тийш
                    if (cur.X + r.W > cur.XF1 && cur.Used) { cur = NewSheet(doc, tb, baseName, sheets, ss, kind); if (cur == null) break; vp = MoveTo(doc, vp, cur.Sheet); r = Content(doc, vp, v); }
                    Put(vp, r, cur.X, cur.Top);
                    cur.X += r.W + gap;
                }
                cur.Used = true;
                n++;
            }

            // ── Огтлол: «тавиур» (shelf) байрлал бүсүүдэд — (1) босоо дэлгээсийн / хэвтээ дэлгээсийн БАРУУН талын чөлөө, (2) дэлгээсийн ДООР.
            //    Бүс бүрд мөр мөрөөр; аль ч бүсэд багтахгүй бол дараагийн хуудас (бүтэн бүс).
            List<Shelf> shelves = Shelves(cur, gap);
            foreach (View v in secs ?? new List<View>())
            {
                if (!Viewport.CanAddViewToSheet(doc, cur.Sheet.Id, v.Id)) { notes.Add("«" + v.Name + "» аль хэдийн хуудсанд байрласан — алгасав."); continue; }
                Viewport vp = Make(doc, cur.Sheet, v, vpSec);
                Rect r = Content(doc, vp, v);
                Shelf hit = shelves.FirstOrDefault(sh => sh.Fit(r.W, r.H, gap));
                if (hit == null)
                {
                    cur = NewSheet(doc, tb, baseName, sheets, ss, kind);
                    if (cur == null) break;
                    vp = MoveTo(doc, vp, cur.Sheet);
                    r = Content(doc, vp, v);
                    shelves = Shelves(cur, gap);
                    hit = shelves.FirstOrDefault(sh => sh.Fit(r.W, r.H, gap)) ?? shelves[shelves.Count - 1];
                }
                hit.Place(r.W, r.H, gap, out double px, out double py);
                Put(vp, r, px, py);
                cur.Used = true;
            }

            foreach (ViewSheet s in sheets)
                issues.Add(new BbIssue
                {
                    Tool = "Хуудсанд байрлуулах", Severity = BbSeverity.Info, Member = mark, Sheet = s.SheetNumber, ViewId = s.Id.Value,
                    Problem = "Хуудас «" + s.SheetNumber + " " + s.Name + "» үүслээ — дугаар нь цувралын («" + Prefix(ss, kind) + "») дараагийн чөлөөт дугаар.",
                    Proposal = "Зургийн жагсаалтын дарааллаар дугаарыг шалгах (гишүүний тэмдгийн дарааллаар бол засах).",
                    Key = "sheet|" + mark + "|" + s.Name,
                });
            return sheets;
        }

        internal static string Prefix(BbSheetStandard ss, BbMemberKind kind)
        {
            switch (kind)
            {
                case BbMemberKind.Column: return ss.ColumnSheetPrefix;
                case BbMemberKind.Wall: return ss.WallSheetPrefix;
                case BbMemberKind.Slab: return ss.SlabSheetPrefix;
                default: return ss.BeamSheetPrefix;
            }
        }

        private static string BaseName(BbSheetStandard ss, BbMemberKind kind, string mark)
        {
            if (kind == BbMemberKind.Slab) return mark;                                    // хучилт: хуудасны нэр = төлөвлөгөөний нэр
            if (kind == BbMemberKind.Wall) return ss.WallSheetNamePattern.Replace("{mark}", mark);
            string pattern = kind == BbMemberKind.Column ? ss.ColumnSheetNamePattern : ss.BeamSheetNamePattern;
            if (kind == BbMemberKind.BeamAux && !pattern.StartsWith("ТУСЛАХ", StringComparison.Ordinal)) pattern = "ТУСЛАХ " + pattern;
            return pattern.Replace("{mark}", mark);
        }

        /// <summary>Түүвэр зураг дээр багтахгүй үед тусдаа «… ТҮҮВЭР» хуудас (ЖИШЭЭ-1: «4-4 БАГАНА Б-1 АРМАТУРЧЛАЛ ТҮҮВЭР»).</summary>
        internal static ViewSheet ScheduleSheet(Document doc, string mark, BbMemberKind kind, BbStandard std, List<BbIssue> issues)
        {
            BbSheetStandard ss = std.Sheet;
            FamilySymbol tb = TitleBlock(doc, ss.TitleBlock, mark, issues);
            if (tb == null) return null;
            if (!tb.IsActive) tb.Activate();
            string name = BaseName(ss, kind, mark);
            int i = name.IndexOf(',');
            name = (i > 0 ? name.Substring(0, i) : name) + " ТҮҮВЭР";
            Page p = NewSheet(doc, tb, name, new List<ViewSheet>(), ss, kind);
            return p?.Sheet;
        }

        private sealed class Page
        {
            public ViewSheet Sheet;
            public double X0, X1, XF0, XF1, Y0, Top, Y, X;
            public double ElevRight = double.MinValue;
            public bool Used;
        }

        /// <summary>Тэгш өнцөгт бүсэд мөр мөрөөр (зүүнээс баруун, дээрээс доош) байрлуулах.</summary>
        private sealed class Shelf
        {
            public double X0, X1, Top, Bottom;
            private double _x, _rowTop, _rowH;
            private bool _started;

            public Shelf(double x0, double x1, double top, double bottom) { X0 = x0; X1 = x1; Top = top; Bottom = bottom; _x = x0; _rowTop = top; }

            public bool Fit(double w, double h, double gap)
            {
                if (w > X1 - X0) return false;
                double x = _x, rowTop = _rowTop;
                if (_started && x + w > X1) { rowTop -= _rowH + gap; }
                return rowTop - h >= Bottom;
            }

            public void Place(double w, double h, double gap, out double px, out double py)
            {
                if (_started && _x + w > X1) { _x = X0; _rowTop -= _rowH + gap; _rowH = 0; }
                px = _x;
                py = _rowTop;
                _x += w + gap;
                _rowH = Math.Max(_rowH, h);
                _started = true;
            }
        }

        private static List<Shelf> Shelves(Page cur, double gap)
        {
            var res = new List<Shelf>();
            double min = Mm(50);
            if (cur.X > cur.X0)
            {
                // Босоо (баганы) дэлгээсийн баруун талд — бүтэн өндөр.
                res.Add(new Shelf(cur.X, cur.X1, cur.Top, cur.Y0));
                return res;
            }
            if (cur.ElevRight > double.MinValue && cur.X1 - (cur.ElevRight + gap) >= min && cur.Y < cur.Top)
                res.Add(new Shelf(cur.ElevRight + gap, cur.X1, cur.Top, cur.Y));
            res.Add(new Shelf(cur.X0, cur.X1, cur.Y, cur.Y0));
            return res;
        }

        private static Page NewSheet(Document doc, FamilySymbol tb, string baseName, List<ViewSheet> sheets, BbSheetStandard ss, BbMemberKind kind)
        {
            ViewSheet s;
            try { s = ViewSheet.Create(doc, tb.Id); }
            catch { return null; }
            string name = sheets.Count == 0 ? baseName : baseName + " (" + (sheets.Count + 1) + ")";
            try { s.Name = name; } catch { }
            // Компанийн цуврал (дамнуруу 5-, багана 4-) + Project Browser-ийн бүлэглэлт.
            string prefix = Prefix(ss, kind);
            string num = BbSheetSeries.Next(doc, prefix, null, s.Id);
            if (num != null) { try { s.SheetNumber = num; } catch { } }
            BbSheetSeries.ApplyParams(doc, s, prefix, kind == BbMemberKind.Column ? ss.ColumnSheetParams : kind == BbMemberKind.Wall ? ss.WallSheetParams : kind == BbMemberKind.Slab ? ss.SlabSheetParams : ss.BeamSheetParams);
            sheets.Add(s);
            doc.Regenerate();
            BoundingBoxXYZ bb = null;
            foreach (Element e in new FilteredElementCollector(doc, s.Id).OfCategory(BuiltInCategory.OST_TitleBlocks).WhereElementIsNotElementType())
            {
                bb = e.get_BoundingBox(s);
                if (bb != null) break;
            }
            double x0, x1, y0, y1;
            if (bb != null) { x0 = bb.Min.X; x1 = bb.Max.X; y0 = bb.Min.Y; y1 = bb.Max.Y; }
            else { x0 = -Mm(594); x1 = 0; y0 = 0; y1 = Mm(420); }
            // ЖИШЭЭ-1: зүүн хүрээ ≈ 20 мм, дээд ≈ 8 мм; баруун талд хүснэгтийн зурвас ≈ 200 мм (дамнуруу), доор булангийн хүснэгт.
            double left = Mm(Math.Max(5, ss.LeftMarginMm)), right = Mm(_reserve ? 200 : 8);
            var sh = new Page { Sheet = s, X0 = x0 + left, X1 = x1 - right, XF0 = x0 + left, XF1 = x1 - Mm(8), Y0 = y0 + Mm(12), Top = y1 - Mm(8) };
            sh.Y = sh.Top;
            sh.X = sh.X0;
            return sh;
        }

        internal struct Rect
        {
            public double X0, Y0, X1, Y1;
            public double W { get { return X1 - X0; } }
            public double H { get { return Y1 - Y0; } }
        }

        private static Viewport Make(Document doc, ViewSheet sheet, View v, ElementId type)
        {
            Viewport vp = Viewport.Create(doc, sheet.Id, v.Id, XYZ.Zero);
            SetType(vp, type);
            doc.Regenerate();
            return vp;
        }

        /// <summary>Харагдах агуулгын хүрээ ХУУДСАН дээр: crop-ын тэгш өнцөгт + энэ харагдацын тэмдэглэгээ (хэмжээс, шошго, MRA, текст) + viewport-ын гарчиг.</summary>
        internal static Rect Content(Document doc, Viewport vp, View v)
        {
            double x0 = double.MaxValue, y0 = double.MaxValue, x1 = double.MinValue, y1 = double.MinValue;
            Transform mp = Transform.Identity;
            try
            {
                IList<TransformWithBoundary> tws = v.GetModelToProjectionTransforms();
                if (tws != null && tws.Count > 0) mp = tws[0].GetModelToProjectionTransform();
            }
            catch { }
            Transform ps = vp.GetProjectionToSheetTransform();
            Action<XYZ> add = p =>
            {
                XYZ q = ps.OfPoint(mp.OfPoint(p));
                x0 = Math.Min(x0, q.X); x1 = Math.Max(x1, q.X); y0 = Math.Min(y0, q.Y); y1 = Math.Max(y1, q.Y);
            };
            BoundingBoxXYZ cb = v.CropBox;
            Transform ct = cb.Transform ?? Transform.Identity;
            foreach (double x in new[] { cb.Min.X, cb.Max.X })
                foreach (double y in new[] { cb.Min.Y, cb.Max.Y })
                    add(ct.OfPoint(new XYZ(x, y, cb.Max.Z)));
            foreach (Element e in new FilteredElementCollector(doc, v.Id).OwnedByView(v.Id).WhereElementIsNotElementType())
            {
                if (!(e is Dimension || e is IndependentTag || e is MultiReferenceAnnotation || e is TextNote)) continue;
                BoundingBoxXYZ b;
                try { b = e.get_BoundingBox(v); } catch { continue; }
                if (b == null) continue;
                Transform bt = b.Transform ?? Transform.Identity;
                foreach (double x in new[] { b.Min.X, b.Max.X })
                    foreach (double y in new[] { b.Min.Y, b.Max.Y })
                        foreach (double z in new[] { b.Min.Z, b.Max.Z })
                            add(bt.OfPoint(new XYZ(x, y, z)));
            }
            // Түвшин/тэнхлэгийн шугам + толгой (BbDatums.Trim-ээр crop-д тайрсан).
            BbDatums.AddExtents(doc, v, add);
            // Гарчгийг агуулгын зүүн доод буланд (ЖИШЭЭ-1 «Гарчиг - Доогуур зураас» — зургийн доор шууд).
            if (x0 <= x1 && AlignLabel(vp, x0, y0)) doc.Regenerate();
            try
            {
                Outline lo = vp.GetLabelOutline();
                if (lo != null && !lo.IsEmpty)
                {
                    x0 = Math.Min(x0, lo.MinimumPoint.X); x1 = Math.Max(x1, lo.MaximumPoint.X);
                    y0 = Math.Min(y0, lo.MinimumPoint.Y); y1 = Math.Max(y1, lo.MaximumPoint.Y);
                }
            }
            catch { }
            if (x0 > x1)
            {
                Outline o = vp.GetBoxOutline();
                return new Rect { X0 = o.MinimumPoint.X, Y0 = o.MinimumPoint.Y, X1 = o.MaximumPoint.X, Y1 = o.MaximumPoint.Y };
            }
            return new Rect { X0 = x0, Y0 = y0, X1 = x1, Y1 = y1 };
        }

        /// <summary>Гарчгийн зүүн дээд буланг (x, y − 2 мм)-д.  Өөрчилсөн бол true.</summary>
        private static bool AlignLabel(Viewport vp, double x, double y)
        {
            try
            {
                Outline lo = vp.GetLabelOutline();
                if (lo == null || lo.IsEmpty) return false;
                double dx = x - lo.MinimumPoint.X, dy = (y - Mm(2)) - lo.MaximumPoint.Y;
                if (Math.Abs(dx) < Mm(0.5) && Math.Abs(dy) < Mm(0.5)) return false;
                vp.LabelOffset = vp.LabelOffset + new XYZ(dx, dy, 0);
                return true;
            }
            catch { return false; }
        }

        /// <summary>Агуулгын хүрээний зүүн дээд буланг (x0, top)-д тавина.</summary>
        private static void Put(Viewport vp, Rect r, double x0, double top)
        {
            XYZ c = vp.GetBoxCenter();
            vp.SetBoxCenter(new XYZ(c.X + (x0 - r.X0), c.Y + (top - r.Y1), c.Z));
        }

        private static Viewport MoveTo(Document doc, Viewport vp, ViewSheet target)
        {
            ElementId view = vp.ViewId, type = vp.GetTypeId();
            doc.Delete(vp.Id);
            return Make(doc, target, (View)doc.GetElement(view), type);
        }

        private static void SetType(Viewport vp, ElementId type)
        {
            if (vp == null || type == null || type == ElementId.InvalidElementId) return;
            try { vp.ChangeTypeId(type); } catch { }
        }

        private static ElementId ViewportType(Document doc, string name)
        {
            if (string.IsNullOrEmpty(name)) return null;
            string bare = name.StartsWith("Viewport : ", StringComparison.Ordinal) ? name.Substring("Viewport : ".Length) : name;
            ElementType t = new FilteredElementCollector(doc).OfClass(typeof(ElementType)).Cast<ElementType>()
                .FirstOrDefault(e => e.FamilyName == "Viewport" && e.Name == bare);
            return t?.Id;
        }

        private static FamilySymbol TitleBlock(Document doc, string familyAndType, string mark, List<BbIssue> issues)
        {
            var all = new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_TitleBlocks).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>().ToList();
            FamilySymbol t = all.FirstOrDefault(s => s.FamilyName + " : " + s.Name == familyAndType);
            if (t != null) return t;
            t = all.FirstOrDefault();
            issues.Add(new BbIssue
            {
                Tool = "Хуудсанд байрлуулах", Severity = t == null ? BbSeverity.Error : BbSeverity.Warning, Member = mark,
                Problem = t == null ? "Төсөлд хуудасны хүрээ (title block) алга — хуудас үүсгэсэнгүй." : "Стандартын хүрээ «" + familyAndType + "» алга — «" + t.FamilyName + " : " + t.Name + "»-ээр.",
                Proposal = "Компанийн A2 хүрээг ачаалах.",
                Key = "sheet|tb|" + familyAndType,
            });
            return t;
        }
    }
}
