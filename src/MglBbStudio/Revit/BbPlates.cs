using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using MglBb.Core;
using RevitMcpAddin.Reinforcement;

namespace MglBb.RevitSide
{
    /// <summary>Нэг тэмдэгтэй, нэг шугам дээрх ханын хэсгүүд (ЖИШЭЭ-1: ЦХ-1 = давхар бүрийн тусдаа хана, 51 м урт).</summary>
    internal sealed class BbWallStack
    {
        public string Mark = "";
        public readonly List<Wall> Members = new List<Wall>();
        public XYZ Origin, Axis, Normal;          // Axis хэвтээ нэгж, Normal = Z × Axis
        public double S0, S1, Bottom, Top, N0, N1; // тэнхлэгийн дагуу / Z / нормалийн дагуу (фут, Origin-оос)
        public int RebarCount;

        public double Station(XYZ p) { return (p - Origin).DotProduct(Axis); }
        public double Across(XYZ p) { return (p - Origin).DotProduct(Normal); }
    }

    /// <summary>Нэг түвшний хучилтууд.</summary>
    internal sealed class BbSlabLevel
    {
        public Level Level;
        public string LevelText = "";
        public readonly List<Floor> Floors = new List<Floor>();
        public double X0, Y0, X1, Y1;
        public int RebarCount;
    }

    /// <summary>
    /// ХАНА ба ХУЧИЛТЫН ажлын зураг (ЖИШЭЭ-1 6-n, 7-n хуудсын хэлбэр): харагдацыг стандартын төрөл/загвар/масштабаар үүсгэж, арматурын олонлог бүрд MRA-г
    /// үндсэн plugin-ий <c>RfSetMraService</c>-ээр (линкээр, өөрчлөлтгүй) тавина.  Хүрээ, хэсгийн байрлалын шийдвэр энд; MRA-ийн байрлал хөдөлгүүрт.
    /// </summary>
    internal static class BbPlates
    {
        public const string RoleForm = "form", RoleRebar = "rebar", RoleCross = "cross", RoleCutForm = "cut-form", RoleCutRebar = "cut-rebar",
            RoleSlabForm = "slab-form", RoleSlabBottom = "slab-bottom", RoleSlabTop = "slab-top";

        // ── Хана ─────────────────────────────────────────────────────────

        public static bool IsWallHost(Element e)
        {
            return e is Wall w && w.Location is LocationCurve lc && lc.Curve is Line && BbGeom.Mark(w).Length > 0;
        }

        public static BbWallStack WallStack(Document doc, Wall seed)
        {
            var st = new BbWallStack { Mark = BbGeom.Mark(seed) };
            Line l0 = (seed.Location as LocationCurve)?.Curve as Line;
            if (l0 == null) { st.Members.Add(seed); return st; }
            XYZ d = new XYZ(l0.Direction.X, l0.Direction.Y, 0).Normalize();
            st.Axis = d;
            st.Normal = XYZ.BasisZ.CrossProduct(d).Normalize();
            st.Origin = new XYZ(l0.GetEndPoint(0).X, l0.GetEndPoint(0).Y, 0);
            foreach (Wall w in new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Walls).OfClass(typeof(Wall)).Cast<Wall>())
            {
                if (!string.Equals(BbGeom.Mark(w), st.Mark, StringComparison.Ordinal)) continue;
                Line l = (w.Location as LocationCurve)?.Curve as Line;
                if (l == null) continue;
                XYZ dd = new XYZ(l.Direction.X, l.Direction.Y, 0);
                if (dd.GetLength() < 1e-6 || Math.Abs(dd.Normalize().DotProduct(d)) < 0.999) continue;
                if (Math.Abs(st.Across(l.GetEndPoint(0))) > BbGeom.Ft(150)) continue;     // нэг шугам дээр
                st.Members.Add(w);
            }
            if (st.Members.Count == 0) st.Members.Add(seed);
            st.S0 = st.Bottom = st.N0 = double.MaxValue;
            st.S1 = st.Top = st.N1 = double.MinValue;
            foreach (Wall w in st.Members)
            {
                BoundingBoxXYZ bb = w.get_BoundingBox(null);
                if (bb == null) continue;
                Line l = (w.Location as LocationCurve).Curve as Line;
                double a = st.Station(l.GetEndPoint(0)), b = st.Station(l.GetEndPoint(1));
                double half = w.Width / 2;
                double c = st.Across(l.GetEndPoint(0));
                st.S0 = Math.Min(st.S0, Math.Min(a, b)); st.S1 = Math.Max(st.S1, Math.Max(a, b));
                st.N0 = Math.Min(st.N0, c - half); st.N1 = Math.Max(st.N1, c + half);
                st.Bottom = Math.Min(st.Bottom, bb.Min.Z); st.Top = Math.Max(st.Top, bb.Max.Z);
                try { st.RebarCount += RebarHostData.GetRebarHostData(w)?.GetRebarsInHost().Count ?? 0; } catch { }
            }
            return st;
        }

        public static BbGenResult CreateWall(Document doc, BbWallStack st, BbStandard std, BbGenOptions opt, Dictionary<long, string> roles)
        {
            BbPlateStandard ps = std.Plate;
            var res = new BbGenResult { Mark = st.Mark, Kind = BbMemberKind.Wall };
            string mark = st.Mark;
            double L = st.S1 - st.S0, H = st.Top - st.Bottom;
            double crop = BbGeom.Ft(ps.WallCropMm);
            // Хуудсанд (түүврийн зурвастай) багтах эсэхээр: ЦХ-7 6.8 м → 1:50, ЦХ-2 28 м → 1:100 (ЖИШЭЭ-1).
            int elevScale = BbGeom.ToMm(L + 2 * crop) / Math.Max(1, ps.WallElevScaleShort) <= ps.WallElevMaxPaperMm ? ps.WallElevScaleShort : ps.WallElevScaleLong;
            XYZ R = st.Axis, U = XYZ.BasisZ, V = R.CrossProduct(U).Normalize();         // V = −Normal
            // Харагчийн тал: V чиглэлд.  Нормалийн координат (Across) V = −Normal тул харагч руу ойр нүүр = N0.
            double planeAcross = st.N0 - BbGeom.Ft(ps.WallPlaneOutMm);
            double depth = (st.N1 - planeAcross) + BbGeom.Ft(ps.WallFarBeyondMm);
            double midS = (st.S0 + st.S1) / 2, midZ = (st.Bottom + st.Top) / 2;
            XYZ o = st.Origin + R * midS + st.Normal * planeAcross;
            o = new XYZ(o.X, o.Y, midZ);
            double hw = L / 2 + crop, hh = H / 2 + crop;

            if (opt.Elevation)
            {
                foreach (var spec in new[]
                {
                    new { Vft = ps.WallFormViewType, Tpl = ps.WallFormTemplate, Name = ps.WallFormName, Role = RoleForm },
                    new { Vft = ps.WallRebarViewType, Tpl = ps.WallRebarTemplate, Name = ps.WallRebarName, Role = RoleRebar },
                })
                {
                    string name = ps.WallName(spec.Name, mark) + opt.NameSuffix;
                    if (Exists(doc, name) && opt.Existing == "skip") { res.Notes.Add("«" + name + "» аль хэдийн байгаа — алгасав."); continue; }
                    ViewFamilyType vft = Vft(doc, spec.Vft, mark, res);
                    if (vft == null) continue;
                    ViewSection v = BbViews.CreateDetail(doc, vft, o, R, U, V, -hw, hw, -hh, hh, depth, res, mark);
                    if (v == null) continue;
                    BbViews.Configure(doc, v, Template(doc, spec.Tpl, mark, res), elevScale, depth, BbGeom.UniqueViewName(doc, name), res, mark);
                    res.Elevations.Add(v);
                    roles[v.Id.Value] = spec.Role;
                }
            }

            if (opt.Sections)
            {
                int n = 0;
                // 1) Хэвний БОСОО огтлол (тэнхлэгийн дагуу харж) — ханын дунд.
                {
                    n++;
                    string name = ps.WallName(ps.WallSecName, mark, n) + opt.NameSuffix;
                    ViewFamilyType vft = Vft(doc, ps.WallFormViewType, mark, res);
                    if (vft != null && !(Exists(doc, name) && opt.Existing == "skip"))
                    {
                        XYZ cV = st.Axis.Negate(), cU = XYZ.BasisZ, cR = cU.CrossProduct(cV).Normalize();
                        XYZ co = st.Origin + st.Axis * midS + st.Normal * ((st.N0 + st.N1) / 2);
                        co = new XYZ(co.X, co.Y, midZ);
                        double side = (st.N1 - st.N0) / 2 + BbGeom.Ft(ps.WallCrossSideMm);
                        ViewSection v = BbViews.CreateDetail(doc, vft, co, cR, cU, cV, -side, side, -H / 2 - BbGeom.Ft(300), H / 2 + BbGeom.Ft(300), BbGeom.Ft(300), res, mark);
                        if (v != null)
                        {
                            BbViews.Configure(doc, v, Template(doc, ps.WallFormTemplate, mark, res), ps.WallCrossScale, BbGeom.Ft(300), BbGeom.UniqueViewName(doc, name), res, mark);
                            res.Sections.Add(v);
                            roles[v.Id.Value] = RoleCross;
                        }
                    }
                }
                // 2–3) Хэвтээ (дээрээс) огтлол — ханын эхний үзүүрийн ≈ 3.5 м, доод давхрын голын өндөрт.  Хэв 1:50, арматур 1:25.
                Wall low = st.Members.OrderBy(w => w.get_BoundingBox(null)?.Min.Z ?? 0).First();
                BoundingBoxXYZ lb = low.get_BoundingBox(null);
                double zCut = lb != null ? (lb.Min.Z + Math.Min(lb.Max.Z, lb.Min.Z + BbGeom.Ft(3000))) / 2 : midZ;
                double cutLen = Math.Min(L, BbGeom.Ft(ps.WallCutLengthMm));
                foreach (var spec in new[]
                {
                    new { Vft = ps.WallFormViewType, Tpl = ps.WallFormTemplate, Scale = ps.WallCutFormScale, Role = RoleCutForm },
                    new { Vft = ps.WallRebarViewType, Tpl = ps.WallCutRebarTemplate, Scale = ps.WallCutRebarScale, Role = RoleCutRebar },
                })
                {
                    n++;
                    string name = ps.WallName(ps.WallSecName, mark, n) + opt.NameSuffix;
                    if (Exists(doc, name) && opt.Existing == "skip") { res.Notes.Add("«" + name + "» аль хэдийн байгаа — алгасав."); continue; }
                    ViewFamilyType vft = Vft(doc, spec.Vft, mark, res);
                    if (vft == null) continue;
                    XYZ pR = st.Axis, pV = XYZ.BasisZ, pU = pV.CrossProduct(pR).Normalize();   // дээрээс: R × U = Z
                    double sMid = st.S0 + cutLen / 2;
                    XYZ po = st.Origin + st.Axis * sMid + st.Normal * ((st.N0 + st.N1) / 2);
                    po = new XYZ(po.X, po.Y, zCut);
                    double side = (st.N1 - st.N0) / 2 + BbGeom.Ft(ps.WallCutSideMm);
                    double hl = cutLen / 2 + BbGeom.Ft(ps.WallCutSideMm);
                    // pU = Z × Axis = Normal → u = Across − mid
                    ViewSection v = BbViews.CreateDetail(doc, vft, po, pR, pU, pV, -hl, hl, -side, side, BbGeom.Ft(500), res, mark);
                    if (v == null) continue;
                    BbViews.Configure(doc, v, Template(doc, spec.Tpl, mark, res), spec.Scale, BbGeom.Ft(500), BbGeom.UniqueViewName(doc, name), res, mark);
                    res.Sections.Add(v);
                    roles[v.Id.Value] = spec.Role;
                }
            }
            if (st.RebarCount == 0)
                res.Issues.Add(Issue(mark, BbSeverity.Warning, "Хана «" + mark + "»-д загварчилсан арматур алга — арматурчлалын харагдац хоосон.", "Арматурыг загварчилсны дараа дахин ажиллуулах.", "wall-norebar"));
            return res;
        }

        // ── Хучилт ───────────────────────────────────────────────────────

        public static bool IsSlabHost(Element e)
        {
            return e is Floor f && f.LevelId != ElementId.InvalidElementId;
        }

        public static BbSlabLevel SlabLevel(Document doc, Floor seed)
        {
            var s = new BbSlabLevel { Level = doc.GetElement(seed.LevelId) as Level };
            s.LevelText = LevelText(s.Level);
            s.X0 = s.Y0 = double.MaxValue; s.X1 = s.Y1 = double.MinValue;
            foreach (Floor f in new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Floors).OfClass(typeof(Floor)).Cast<Floor>())
            {
                if (f.LevelId != seed.LevelId) continue;
                bool structural = false;
                try { structural = f.get_Parameter(BuiltInParameter.FLOOR_PARAM_IS_STRUCTURAL)?.AsInteger() == 1; } catch { }
                int reb = 0;
                try { reb = RebarHostData.GetRebarHostData(f)?.GetRebarsInHost().Count ?? 0; } catch { }
                if (!structural && reb == 0 && f.Id != seed.Id) continue;
                s.Floors.Add(f);
                s.RebarCount += reb;
                BoundingBoxXYZ bb = f.get_BoundingBox(null);
                if (bb == null) continue;
                s.X0 = Math.Min(s.X0, bb.Min.X); s.Y0 = Math.Min(s.Y0, bb.Min.Y); s.X1 = Math.Max(s.X1, bb.Max.X); s.Y1 = Math.Max(s.Y1, bb.Max.Y);
            }
            return s;
        }

        /// <summary>ЖИШЭЭ-1: «4.93», «-0.07» — түвшний нэр тоо бол түүнийг, эс бөгөөс өндрийг метрээр 2 оронтой.</summary>
        public static string LevelText(Level lv)
        {
            if (lv == null) return "?";
            string n = (lv.Name ?? "").Trim().TrimStart('+');
            if (double.TryParse(n.Replace(',', '.'), NumberStyles.Float, CultureInfo.InvariantCulture, out _)) return n;
            return (lv.ProjectElevation * 0.3048).ToString("0.00", CultureInfo.InvariantCulture);
        }

        public static BbGenResult CreateSlab(Document doc, BbSlabLevel sl, BbStandard std, BbGenOptions opt, Dictionary<long, string> roles)
        {
            BbPlateStandard ps = std.Plate;
            var res = new BbGenResult { Mark = sl.LevelText, Kind = BbMemberKind.Slab };
            string mark = sl.LevelText;
            if (sl.Level == null) { res.Issues.Add(Issue(mark, BbSeverity.Error, "Хучилтын түвшин тодорхойгүй.", "Хучилтын Level параметрийг шалгах.", "slab-level")); return res; }
            if (!opt.Elevation) return res;
            double m = BbGeom.Ft(ps.SlabCropMm);
            foreach (var spec in new[]
            {
                new { Vft = ps.SlabFormViewType, Tpl = ps.SlabFormTemplate, Name = ps.SlabFormName, Role = RoleSlabForm },
                new { Vft = ps.SlabBottomViewType, Tpl = ps.SlabBottomTemplate, Name = ps.SlabBottomName, Role = RoleSlabBottom },
                new { Vft = ps.SlabTopViewType, Tpl = ps.SlabTopTemplate, Name = ps.SlabTopName, Role = RoleSlabTop },
            })
            {
                string name = spec.Name.Replace("{level}", mark) + opt.NameSuffix;
                if (Exists(doc, name) && opt.Existing == "skip") { res.Notes.Add("«" + name + "» аль хэдийн байгаа — алгасав."); continue; }
                ViewFamilyType vft = BbGeom.FindVft(doc, spec.Vft, ViewFamily.StructuralPlan);
                if (vft == null) { res.Issues.Add(Issue(mark, BbSeverity.Error, "«Structural Plan» төрөл энэ төсөлд алга.", "Төрлийг template-ээс оруулах.", "slab-vft")); return res; }
                if (vft.Name != spec.Vft)
                    res.Issues.Add(Issue(mark, BbSeverity.Warning, "Стандартын төлөвлөгөөний төрөл «" + spec.Vft + "» алга — «" + vft.Name + "»-ээр.", "Компанийн template-ээс тэр төрлийг оруулах.", "slab-vft|" + spec.Role));
                ViewPlan v;
                try { v = ViewPlan.Create(doc, vft.Id, sl.Level.Id); }
                catch (Exception ex) { res.Notes.Add(mark + ": төлөвлөгөө үүсгэж чадсангүй (" + ex.Message + ")"); continue; }
                BbAnnoStore.MarkGenerated(v);
                try { v.Name = BbGeom.UniqueViewName(doc, name); } catch (Exception ex) { res.Notes.Add(mark + ": нэр тавигдсангүй (" + ex.Message + ")"); }
                View tpl = Template(doc, spec.Tpl, mark, res);
                if (tpl != null) { try { v.ViewTemplateId = tpl.Id; } catch (Exception ex) { res.Notes.Add(mark + ": загвар тавигдсангүй (" + ex.Message + ")"); } }
                try { if (v.Scale != ps.SlabScale) v.Scale = ps.SlabScale; } catch { }
                if (sl.X0 < sl.X1)
                {
                    try
                    {
                        BoundingBoxXYZ cb = v.CropBox;
                        cb.Min = new XYZ(sl.X0 - m, sl.Y0 - m, cb.Min.Z);
                        cb.Max = new XYZ(sl.X1 + m, sl.Y1 + m, cb.Max.Z);
                        v.CropBoxActive = true;
                        v.CropBox = cb;
                    }
                    catch (Exception ex) { res.Notes.Add(mark + ": crop тавигдсангүй (" + ex.Message + ")"); }
                }
                res.Plans.Add(v);
                roles[v.Id.Value] = spec.Role;
            }
            if (sl.RebarCount == 0)
                res.Issues.Add(Issue(mark, BbSeverity.Warning, mark + " түвшний хучилтад загварчилсан арматур алга — арматурчлалын төлөвлөгөө хоосон.", "Арматурыг загварчилсны дараа дахин ажиллуулах.", "slab-norebar"));
            res.Notes.Add(mark + ": хучилтын огтлолын байрлалыг (ЖИШЭЭ-1 «ОГТЛОЛ 1-1 …», 1:20) инженер сонгоно — автоматаар үүсгээгүй.");
            return res;
        }

        // ── Тэмдэглэх ───────────────────────────────────────────────────

        /// <summary>Нээлттэй Transaction-гүй үед.  Арматурын харагдацад олонлог бүрд MRA; хэвний дэлгээсэд ханын ерөнхий хэмжээс.</summary>
        /// <param name="hideForeign">Ханын бус арматурыг энэ харагдацад нуух.</param>
        /// <param name="neighbourMiddle">Хөрш (өөр тэмдэгтэй) хана/хавтангийн арматурыг ч «Middle» болгох — тэдгээрийн элементийг засна.</param>
        public static void Annotate(Document doc, View view, string role, IList<Element> hosts, BbPlateStandard ps, BbAnnoReport rep, string mark,
            bool hideForeign = true, bool neighbourMiddle = true)
        {
            bool slab = role.StartsWith("slab", StringComparison.Ordinal);
            bool rebar = role == RoleRebar || role == RoleCutRebar || role == RoleSlabBottom || role == RoleSlabTop;
            // ЖИШЭЭ-1: хананы хэв/арматурын дэлгээс ба хучилтын бүх төлөвлөгөөнд тэнхлэг(/түвшин)-ий гинж.
            bool grids = role == RoleForm || role == RoleRebar || slab;
            if (!rebar && !grids) return;
            var ui = new RfSetMraUi
            {
                MraTypeId = rebar ? MraType(doc, slab ? ps.SlabMraType : ps.WallMraType, rep, mark) : ElementId.InvalidElementId,
                OffsetMm = ps.MraOffsetPaperMm,
                TagGapMm = ps.MraTagGapPaperMm,
                Mra = rebar,
                Tags = false,
                Overall = false,
                // Хөдөлгүүрийн давхцлын үргэлжилсэн гинж (8450 | 400 | 7600 …) нь ЖИШЭЭ-1-ийн «800» давхцлын хэмжээсээс өөр бөгөөд тэнхлэгийн
                // гинжтэй давхцдаг (ЦХ-1, хэмжсэн) — унтраалттай.  Давхцлын хэмжээсийг инженер гараар.
                LapChain = false,
            };
            DimensionType dimType = rebar ? DimType(doc, slab ? ps.SlabMraDimType : ps.WallMraDimType, rep, mark) : null;
            ui.DimTypeId = dimType?.Id ?? ElementId.InvalidElementId;
            DimensionType gridType = grids ? DimType(doc, slab ? ps.SlabGridDimType : ps.WallDimType, rep, mark) : null;
            using (var t = new Transaction(doc, "MGL ББ: " + (slab ? "хучилтын" : "ханын") + " тэмдэглэгээ"))
            {
                t.Start();
                FailureHandlingOptions fho = t.GetFailureHandlingOptions();
                fho.SetFailuresPreprocessor(new BbSwallowWarnings());
                t.SetFailureHandlingOptions(fho);
                int removed = BbAnnoStore.DeletePrevious(doc, view);
                if (removed > 0) { doc.Regenerate(); rep.Replaced += removed; }
                HashSet<long> before = BbAnnoStore.Owned(doc, view);
                int made = 0;
                if (hideForeign && (role == RoleRebar || role == RoleCutRebar)) HideForeignSlabBars(doc, view);
                if (role == RoleRebar || role == RoleSlabBottom || role == RoleSlabTop) made += MiddlePresentation(doc, view, hosts, neighbourMiddle);
                foreach (Element h in rebar ? hosts : new List<Element>())
                {
                    try
                    {
                        RfSetMraContext ctx = RfSetMraService.Analyze(doc, view, h);
                        if (rebar && ctx.Sets.Count == 0) continue;
                        RfSetMraReport r = RfSetMraService.Render(ctx, ui, dimType);
                        if (r.Made > 0) rep.ElevMraElbows += BbMraElbows.Apply(doc, view, r.Created, ps);
                        made += r.Made + r.OverallMade + r.ChainsMade;
                        rep.ElevLaps += r.ChainsMade;
                        rep.ElevMras += r.Made;
                        foreach (string f in r.Failures.Take(3))
                            rep.Issues.Add(new BbIssue { Tool = "Тэмдэглэх", Severity = BbSeverity.Warning, Member = mark, View = view.Name, ViewId = view.Id.Value, ElementId = h.Id.Value, Problem = f, Proposal = "MRA-г гараар нөхөх.", Key = "plate|" + view.Name + "|" + f.GetHashCode() });
                        foreach (string n in r.Notes.Take(2)) rep.Notes.Add(mark + " «" + view.Name + "»: " + n);
                    }
                    catch (Exception ex)
                    {
                        rep.Notes.Add(mark + " «" + view.Name + "»: " + ex.Message.Split('\n')[0]);
                    }
                }
                if (grids)
                {
                    int g = slab ? BbGridDims.SlabPlan(doc, view, hosts, gridType, rep.Notes) : BbGridDims.WallElevation(doc, view, hosts, gridType, rep.Notes);
                    rep.ElevSpans += g;
                    made += g;
                }
                if (made > 0)
                {
                    BbAnnoStore.Record(doc, view, before);
                    t.Commit();
                    rep.Views++;
                }
                // Шинэ тэмдэглэгээ үүсээгүй бол өмнөхийг ч устгахгүй (буруу ангилал/хоосон үр дүн хэрэглэгчийн зургийг арилгахгүй).
                else t.RollBack();
            }
        }

        /// <summary>
        /// ЖИШЭЭ-1-ийн хана/хучилтын арматурчлалд олонлог бүр «Middle» (ЦХ-1: Middle 30 · Select 30) — бүх ширхэг зурагдвал зураг уншигдахгүй.
        /// Зөвхөн «бүгдийг харуулах» төлөвтэй олонлогийг өөрчилнө (инженерийн «Select»-ийг хөндөхгүй).  Нээлттэй Transaction дотор.
        /// Тоог буцаана (бүртгэлд орохгүй — арматурын харагдацын тохиргоо).
        /// </summary>
        /// <summary>
        /// Ханын арматурчлалд ХАНЫН БУС арматур (хучилт, багана, дамнурууны хомут/ажлын арматур) дэлгээсийг өтгөн зураасаар дүүргэдэг
        /// (ЦХ-1: 239 олонлогийн 207 нь ханын бус, хэмжсэн).  ЖИШЭЭ-1-ийн инженер тэдгээрийг «Select» (юу ч сонгоогүй) болгож нуусан
        /// (Middle 30 · Select 30) — энд ЭНЭ харагдацад нууна.
        /// </summary>
        private static void HideForeignSlabBars(Document doc, View view)
        {
            var hide = new List<ElementId>();
            foreach (Rebar r in new FilteredElementCollector(doc, view.Id).OfClass(typeof(Rebar)).Cast<Rebar>())
            {
                try
                {
                    Element h = doc.GetElement(r.GetHostId());
                    if (!(h is Wall) && r.CanBeHidden(view)) hide.Add(r.Id);
                }
                catch { }
            }
            if (hide.Count > 0) { try { view.HideElements(hide); } catch { } }
        }

        private static int MiddlePresentation(Document doc, View view, IList<Element> hosts, bool neighbours)
        {
            var hostIds = new HashSet<long>(hosts.Select(h => h.Id.Value));
            int n = 0;
            foreach (Rebar r in new FilteredElementCollector(doc, view.Id).OfClass(typeof(Rebar)).Cast<Rebar>())
            {
                try
                {
                    // Зэргэлдээ (өөр тэмдэгтэй) хана/хавтангийн олонлог ч энэ харагдацад бүтнээрээ зурагдана (ЦХ-1: 2 олонлог) — ижил төрлийн хостынх бүгд.
                    Element hh = doc.GetElement(r.GetHostId());
                    bool sameKind = neighbours && hh != null && hosts.Count > 0 && hh.GetType() == hosts[0].GetType();
                    if ((!hostIds.Contains(r.GetHostId().Value) && !sameKind) || r.NumberOfBarPositions < 2) continue;
                    if (r.GetPresentationMode(view) != RebarPresentationMode.All) continue;
                    r.SetPresentationMode(view, RebarPresentationMode.Middle);
                    n++;
                }
                catch { }
            }
            if (n > 0) doc.Regenerate();
            return 0;
        }

        /// <summary>Хэрэглэгчийн сонгосон (өөр хэрэгслээр үүсгэсэн) хана/хучилтын харагдацыг таних: үүрэг + хостууд.  null = танихгүй.</summary>
        public static string Classify(Document doc, View v, BbPlateStandard ps, out List<Element> hosts, out string mark)
        {
            hosts = new List<Element>();
            mark = "";
            string name = v.Name ?? "";
            if (v is ViewPlan vp && vp.GenLevel != null)
            {
                string role = name.IndexOf("ДООД", StringComparison.OrdinalIgnoreCase) >= 0 ? RoleSlabBottom
                    : name.IndexOf("ДЭЭД", StringComparison.OrdinalIgnoreCase) >= 0 ? RoleSlabTop
                    : name.IndexOf("ХЭВ", StringComparison.OrdinalIgnoreCase) >= 0 ? RoleSlabForm : null;
                if (role == null) return null;
                ElementId lid = vp.GenLevel.Id;
                hosts.AddRange(new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Floors).OfClass(typeof(Floor)).Cast<Floor>().Where(f => f.LevelId == lid));
                mark = LevelText(vp.GenLevel);
                return hosts.Count > 0 ? role : null;
            }
            if (!(v is ViewSection) || !v.CropBoxActive) return null;
            // Нэрэнд байгаа ханын тэмдэг (урт нь эхэнд — «ЦХ-12» нь «ЦХ-1»-ийг дарна).
            var walls = new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Walls).OfClass(typeof(Wall)).Cast<Wall>().Where(w => BbGeom.Mark(w).Length > 0).ToList();
            string hit = walls.Select(BbGeom.Mark).Distinct().OrderByDescending(x => x.Length).FirstOrDefault(x => BbNames.IndexOfMark(name, x) >= 0);
            if (hit == null) return null;
            mark = hit;
            hosts.AddRange(walls.Where(w => BbGeom.Mark(w) == hit));
            bool isRebar = name.IndexOf("АРМАТУР", StringComparison.OrdinalIgnoreCase) >= 0;
            bool plan = Math.Abs(v.ViewDirection.Z) > 0.99;
            if (plan) return isRebar ? RoleCutRebar : RoleCutForm;
            return isRebar ? RoleRebar : RoleForm;
        }

        /// <summary>
        /// Ханын харагдацуудын бие биен дээрх тэмдгийг цэгцэлнэ: хэвтээ огтлолын (2-2, 3-3) тэмдэг дэлгээс дээр хана дагуу урт улаан шугам болж
        /// хуудсыг хөндлөн гардаг (ЦХ-7, хэмжсэн) — нуух; дэлгээсийн тэмдэг огтлол дээр — нуух.  Босоо огтлолын (1-1) тэмдэг дэлгээс дээр ҮЛДЭНЭ
        /// (ЖИШЭЭ-1 6-11: «1 — 1» тэмдэг).  Нээлттэй Transaction дотор.  Нуусан тоо.
        /// </summary>
        public static int TidyMarks(Document doc, IList<View> views, Dictionary<long, string> roles)
        {
            var viewers = new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Viewers).WhereElementIsNotElementType().ToList();
            int n = 0;
            foreach (View w in views)
            {
                if (!roles.TryGetValue(w.Id.Value, out string wr)) continue;
                bool hideEverywhere = wr == RoleCutForm || wr == RoleCutRebar || wr == RoleForm || wr == RoleRebar;
                if (!hideEverywhere) continue;
                var marks = viewers.Where(e => e.Name == w.Name).Select(e => e.Id).ToList();
                if (marks.Count == 0) continue;
                foreach (View v in views)
                {
                    if (v.Id == w.Id) continue;
                    var can = marks.Where(id => { try { return doc.GetElement(id).CanBeHidden(v); } catch { return false; } }).ToList();
                    if (can.Count == 0) continue;
                    try { v.HideElements(can); n += can.Count; } catch { }
                }
            }
            return n;
        }

        // ── Туслах ──────────────────────────────────────────────────────

        private static ViewFamilyType Vft(Document doc, string name, string mark, BbGenResult res)
        {
            ViewFamilyType vft = BbGeom.FindVft(doc, name, ViewFamily.Detail);
            if (vft == null) { res.Issues.Add(Issue(mark, BbSeverity.Error, "«Detail View» төрөл энэ төсөлд алга.", "Төрлийг template-ээс оруулах.", "vft")); return null; }
            if (!string.IsNullOrEmpty(name) && vft.Name != name)
                res.Issues.Add(Issue(mark, BbSeverity.Warning, "Стандартын харагдацын төрөл «" + name + "» алга — «" + vft.Name + "»-ээр.", "Компанийн template-ээс тэр төрлийг оруулах.", "vft|" + name));
            return vft;
        }

        private static View Template(Document doc, string name, string mark, BbGenResult res)
        {
            View t = BbGeom.FindTemplate(doc, name);
            if (t == null && !string.IsNullOrEmpty(name))
                res.Issues.Add(Issue(mark, BbSeverity.Warning, "Харагдацын загвар «" + name + "» алга — загваргүй үүсгэв.", "Компанийн template-ээс тэр view template-ийг оруулах.", "tpl|" + name));
            return t;
        }

        private static ElementId MraType(Document doc, string name, BbAnnoReport rep, string mark)
        {
            return BbAnnotate.MraTypeId(doc, name, rep, mark);
        }

        private static DimensionType DimType(Document doc, string name, BbAnnoReport rep, string mark)
        {
            ElementId id = BbAnnotate.DimTypeId(doc, name, rep, mark);
            return id == ElementId.InvalidElementId ? null : doc.GetElement(id) as DimensionType;
        }

        private static bool Exists(Document doc, string name)
        {
            return new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>().Any(v => !v.IsTemplate && v.Name == name);
        }

        private static BbIssue Issue(string mark, BbSeverity sev, string problem, string proposal, string code)
        {
            return new BbIssue { Tool = "Ажлын зураг үүсгэх", Severity = sev, Member = mark, Problem = problem, Proposal = proposal, Key = "gen|" + mark + "|" + code };
        }
    }
}
