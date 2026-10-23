using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using MglBb.Core;
using RevitMcpAddin.Reinforcement;
using RevitMcpAddin.Reinforcement.Core;

namespace MglBb.RevitSide
{
    /// <summary>
    /// Дамнурууны дэлгээсийн арматурын төгсгөлийн тэмдэг — үндсэн plugin-ий «Төгсгөлийн тэмдэг» хэрэгслийн (<see cref="EndSymbolService"/>) бүртгэлээс
    /// инженерийн дүрмийг сурч (<see cref="Learn"/>), тэмдэглэхэд тэр хэрэгслийг сурсан тохиргоогоор дуудна (<see cref="Apply"/>).  Ширхэг: олонлогийн
    /// харагчид хамгийн ойр нэг ширхэг — хэрэгслийн «дарсан цэгт ойр» горимд харагчийн талын цэгийг өгнө (дэлгээсэд ширхгүүд давхцдаг тул гүнээр
    /// ялгагдана).  Хөдөлгүүрийн давхардлын хамгаалалт дахин ажиллуулахад давхардуулахгүй.  <c>src/Engine</c>-ийг засахгүй.
    /// </summary>
    internal static class BbElevEndSymbols
    {
        private static bool IsStirrup(Document doc, Rebar rb)
        {
            try { return (doc.GetElement(rb.GetShapeId()) as RebarShape)?.RebarStyle == RebarStyle.StirrupTie; } catch { return false; }
        }

        /// <summary>Олонлогийн харагчид хамгийн ойр (харагдацын V хамгийн их) байрлалын индекс.</summary>
        private static int FrontIndex(Rebar rb, BbFrame f)
        {
            int best = -1;
            double bz = double.MinValue;
            int n = Math.Min(rb.NumberOfBarPositions, 200);
            for (int i = 0; i < n; i++)
            {
                try
                {
                    if (!rb.DoesBarExistAtPosition(i)) continue;
                    IList<Curve> cs = rb.GetTransformedCenterlineCurves(false, true, true, MultiplanarOption.IncludeOnlyPlanarCurves, i);
                    if (cs.Count == 0) continue;
                    double z = f.Local(cs[0].Evaluate(0.5, true)).Z;
                    if (z > bz) { bz = z; best = i; }
                }
                catch { }
            }
            return best;
        }

        /// <summary>«Стандарт сурах»: харагдацын тэмдгийн бүртгэлээс (дамнурууны дэлгээс).</summary>
        public static void Learn(Document doc, View view, BbFrame f, double hu0, double hu1, double sc, string k, BbSamples s)
        {
            Dictionary<string, RfPlacedEnd> placed;
            try { placed = RfEndSymbolStore.Previous(doc, view); } catch { return; }
            var marked = new HashSet<string>(placed.Values.Select(p => p.RebarUid), StringComparer.Ordinal);
            // Гараар (хуулж) тавьсан тэмдэг ч тооцогдоно — ДН-5: доод #2-ын 4 үзүүрт гараар, бүртгэлгүй (арматурын үзүүрээс 0 мм).
            var tool = new HashSet<long>(placed.Values.Where(p => p.Instance != null).Select(p => p.Instance.Id.Value));
            var manual = new List<KeyValuePair<XYZ, FamilyInstance>>();
            foreach (FamilyInstance fi in new FilteredElementCollector(doc).OwnedByView(view.Id).OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>())
                if (!tool.Contains(fi.Id.Value) && fi.Location is LocationPoint lp) manual.Add(new KeyValuePair<XYZ, FamilyInstance>(f.Local(lp.Point), fi));
            FamilyInstance manualHit = null;
            double near = BbGeom.Ft(1.5 * sc);
            int bars = 0;
            foreach (Rebar rb in new FilteredElementCollector(doc, view.Id).OfClass(typeof(Rebar)).Cast<Rebar>())
            {
                if (IsStirrup(doc, rb)) continue;
                BbBarRole? layer = BbElevRules.Layer(rb, f, hu0, hu1);
                if (layer == null) continue;
                bars++;
                FamilyInstance hit = manual.Count > 0 ? EndsNear(rb, f, manual, near) : null;
                if (hit != null && manualHit == null) manualHit = hit;
                bool has = marked.Contains(rb.UniqueId) || hit != null;
                s.Bool(k + "ElevEndSym" + (layer == BbBarRole.Top ? "Top" : layer == BbBarRole.Bottom ? "Bottom" : "Side"), has);
            }
            if (bars == 0) return;
            // ТДН-4: бүх тэмдэг гараар (бүртгэлгүй) — тэр ч тэмдэг тавьдаг гэсэн үг; төрлийг тэр instance-аас.
            s.Bool(k + "ElevEndSymbols", placed.Count > 0 || manualHit != null);
            if (placed.Count == 0 && manualHit != null) s.Str(k + "ElevEndSymbolType", manualHit.Symbol.FamilyName + " : " + manualHit.Symbol.Name);
            foreach (RfPlacedEnd p in placed.Values)
            {
                if (p.IsMarker || p.Instance == null) continue;
                s.Str(k + "ElevEndSymbolType", p.Instance.Symbol.FamilyName + " : " + p.Instance.Symbol.Name);
                s.Bool(k + "ElevEndSymHooks", p.Hooks);
                s.Bool(k + "ElevEndSymAuto", p.Auto);
                s.Num(k + "ElevEndSymOffsetPaperMm", BbGeom.ToMm(p.OffsetFt) / sc);
                // Хадгалсан «natural» = family-ийн чиглэл − хэрэглэгчийн эргэлт → family = 0 гэвэл эргэлт = −natural.  Доод үеийнх тусдаа.
                double deg = RfEndSymbolMath.NormalizeDegrees(-p.Natural * 180 / Math.PI);
                var rb = doc.GetElement(p.RebarUid) as Rebar;
                string pre = rb != null && BbElevRules.Layer(rb, f, hu0, hu1) == BbBarRole.Bottom ? "ElevEndSymBot" : "ElevEndSym";
                s.Num(k + pre + (p.Kind == RfEndKind.Start ? "StartDeg" : "EndDeg"), deg);
                if (rb != null && rb.NumberOfBarPositions > 1) s.Bool(k + "ElevEndSymFront", p.BarIndex == FrontIndex(rb, f));
            }
        }

        /// <summary>Арматурын аль нэг ширхгийн тэнхлэгийн үзүүрт (<paramref name="tol"/> дотор) гараар тавьсан тэмдэг байгаа эсэх.</summary>
        private static FamilyInstance EndsNear(Rebar rb, BbFrame f, List<KeyValuePair<XYZ, FamilyInstance>> pts, double tol)
        {
            try
            {
                int n = Math.Min(rb.NumberOfBarPositions, 60);
                for (int i = 0; i < n; i++)
                {
                    IList<Curve> cs = rb.GetTransformedCenterlineCurves(false, true, true, MultiplanarOption.IncludeOnlyPlanarCurves, i);
                    if (cs.Count == 0) continue;
                    foreach (XYZ e in new[] { f.Local(cs[0].GetEndPoint(0)), f.Local(cs[cs.Count - 1].GetEndPoint(1)) })
                    {
                        var hit = pts.FirstOrDefault(p => Math.Abs(p.Key.X - e.X) < tol && Math.Abs(p.Key.Y - e.Y) < tol);
                        if (hit.Value != null) return hit.Value;
                    }
                }
            }
            catch { }
            return null;
        }

        /// <summary>⚠️ Нээлттэй Transaction-гүй үед (хэрэгсэл өөрөө TransactionGroup нээнэ).  Тавьсан тэмдгийн тоо.</summary>
        public static int Apply(Document doc, ViewSection view, IList<Element> hosts, BbMemberStandard ms, BbAnnoReport rep, string mark)
        {
            var log = new System.Text.StringBuilder();
            try { return ApplyCore(doc, view, hosts, ms, rep, mark, log); }
            finally
            {
                // Оношлогоо: алхам бүрийн үр дүн (тэмдэг яагаад тавигдаагүйг харуулна).
                try { System.IO.File.WriteAllText(System.IO.Path.Combine(Paths.Root, "endsym-log.txt"), DateTime.Now.ToString("s") + " «" + view.Name + "»" + Environment.NewLine + log, new System.Text.UTF8Encoding(true)); }
                catch { }
            }
        }

        private static int ApplyCore(Document doc, ViewSection view, IList<Element> hosts, BbMemberStandard ms, BbAnnoReport rep, string mark, System.Text.StringBuilder log)
        {
            log.AppendLine("enabled " + ms.ElevEndSymbols + " type «" + ms.ElevEndSymbolType + "» hosts " + (hosts?.Count ?? 0) + " top " + ms.ElevEndSymTop + " bottom " + ms.ElevEndSymBottom
                           + " side " + ms.ElevEndSymSide + " front " + ms.ElevEndSymFront + " start " + ms.ElevEndSymStartDeg + " end " + ms.ElevEndSymEndDeg);
            if (!ms.ElevEndSymbols || string.IsNullOrWhiteSpace(ms.ElevEndSymbolType) || hosts == null || hosts.Count == 0) return 0;
            FamilySymbol fs = EndSymbolService.Resolve(EndSymbolService.ListSymbols(doc), null, null, ms.ElevEndSymbolType);
            log.AppendLine("symbol " + (fs == null ? "NOT FOUND" : fs.Id.Value.ToString()));
            if (fs == null)
            {
                rep?.Issues.Add(new BbIssue
                {
                    Tool = "Тэмдэглэх", Severity = BbSeverity.Warning, Member = mark, View = view.Name, ViewId = view.Id.Value,
                    Problem = "Арматурын төгсгөлийн тэмдэг «" + ms.ElevEndSymbolType + "» энэ төсөлд ачаалагдаагүй — тэмдэг тавигдсангүй.",
                    Proposal = "Тэр family-г төсөлд ачаалах (Insert → Load Family).",
                    Key = "endsym|" + ms.ElevEndSymbolType,
                });
                return 0;
            }
            BbFrame f = BbFrame.Of(view);
            // Үе: хамгийн олон арматуртай гишүүний өндрөөр (гинжийн гүн хэсэг ангиллыг гажуудуулахгүй).
            Element main = hosts.OrderByDescending(h => { try { return RebarHostData.GetRebarHostData(h)?.GetRebarsInHost().Count ?? 0; } catch { return 0; } }).First();
            BoundingBoxXYZ mb = main.get_BoundingBox(null);
            if (mb == null) return 0;
            f.Extent(mb, out XYZ ma, out XYZ mz);
            int scale = view.Scale > 0 ? view.Scale : 50;
            int placed = 0;
            var seen = new HashSet<long>();
            HashSet<long> existing = ToolSymbolIds(doc, view);
            foreach (Element h in hosts)
            {
                IList<Rebar> inHost;
                try { inHost = RebarHostData.GetRebarHostData(h)?.GetRebarsInHost(); } catch { continue; }
                log.AppendLine("host " + h.Id.Value + " rebars " + (inHost?.Count ?? 0));
                if (inHost == null) continue;
                foreach (Rebar rb in inHost)
                {
                    if (!seen.Add(rb.Id.Value) || IsStirrup(doc, rb)) continue;
                    bool hidden = false;
                    try { hidden = rb.IsHidden(view); } catch { }
                    BbBarRole? layer = BbElevRules.Layer(rb, f, ma.Y, mz.Y);
                    bool want = layer == BbBarRole.Top ? ms.ElevEndSymTop : layer == BbBarRole.Bottom ? ms.ElevEndSymBottom : layer == BbBarRole.Side && ms.ElevEndSymSide;
                    log.Append("  rebar " + rb.Id.Value + " layer " + layer + " hidden " + hidden + " want " + want);
                    if (hidden || !want) { log.AppendLine(); continue; }
                    var o = new RfEndSymbolOptions
                    {
                        Symbol = fs,
                        Place = RfPlaceMode.Both,
                        AutoOrient = ms.ElevEndSymAuto,
                        StartRotationDeg = layer == BbBarRole.Bottom ? ms.ElevEndSymBotStartDeg : ms.ElevEndSymStartDeg,
                        EndRotationDeg = layer == BbBarRole.Bottom ? ms.ElevEndSymBotEndDeg : ms.ElevEndSymEndDeg,
                        SymbolNaturalDeg = 0,
                        OffsetFt = BbGeom.Ft(ms.ElevEndSymOffsetPaperMm * scale),
                        IncludeHooks = ms.ElevEndSymHooks,
                        BarSet = ms.ElevEndSymFront ? RfBarSetMode.Nearest : RfBarSetMode.All,
                    };
                    if (ms.ElevEndSymFront)
                    {
                        // Харагчийн талд хол цэг: харагдацын хавтгайд ширхгүүд давхцдаг тул хэрэгсэл гүнээр — харагчид ойрыг сонгоно.
                        try
                        {
                            IList<Curve> cs = rb.GetTransformedCenterlineCurves(false, true, true, MultiplanarOption.IncludeOnlyPlanarCurves, 0);
                            if (cs.Count > 0) o.PickPoint = RfConv.V(cs[0].Evaluate(0.5, true) + view.ViewDirection * 1000);
                        }
                        catch { }
                    }
                    try
                    {
                        RfEndSymbolReport r = EndSymbolService.Place(doc, view, new List<Rebar> { rb }, o);
                        placed += r.Placed;
                        log.AppendLine(" → placed " + r.Placed + " dup " + r.Duplicates + " endOn " + r.EndOn + " outsideCrop " + r.OutsideCrop + " hiddenBars " + r.HiddenBars
                                       + " notVisible " + r.NotVisible + " outsideDepth " + r.OutsideDepth + " unsupported " + r.Unsupported + " noGeom " + r.NoGeometry
                                       + " fallback " + r.NearestFallback + (r.Failures.Count > 0 ? " FAIL " + string.Join(" | ", r.Failures.Take(3)) : "")
                                       + (r.Notes.Count > 0 ? " NOTE " + string.Join(" | ", r.Notes.Take(3)) : ""));
                        foreach (string fl in r.Failures.Take(2)) rep?.Notes.Add(mark + " «" + view.Name + "»: төгсгөлийн тэмдэг — " + fl);
                    }
                    catch (Exception ex)
                    {
                        log.AppendLine(" → EXCEPTION " + ex.GetType().Name + ": " + ex.Message);
                        rep?.Notes.Add(mark + " «" + view.Name + "»: төгсгөлийн тэмдэг — " + (ex.Message ?? "").Split('\n')[0]);
                    }
                }
            }
            // Энэ удаа тавьсан тэмдгийг plugin-ий бүртгэлд — дараагийн тэмдэглэхэд солигдоно; гараар (хэрэгслээр) тавьсныг хөндөхгүй.
            List<Element> fresh = ToolSymbolIds(doc, view).Where(id => !existing.Contains(id)).Select(id => doc.GetElement(new ElementId(id))).Where(e => e != null).ToList();
            log.AppendLine("recorded " + fresh.Count);
            if (fresh.Count > 0)
            {
                using (var t = new Transaction(doc, "MGL ББ: төгсгөлийн тэмдгийн бүртгэл"))
                {
                    t.Start();
                    BbAnnoStore.Append(view, fresh);
                    t.Commit();
                }
            }
            return placed;
        }

        /// <summary>Энэ харагдацын «Төгсгөлийн тэмдэг» хэрэгслийн тэмдгүүдийн элемент (family / код-оор зурсан хэсгүүд).</summary>
        private static HashSet<long> ToolSymbolIds(Document doc, View view)
        {
            var res = new HashSet<long>();
            try
            {
                foreach (RfPlacedEnd p in RfEndSymbolStore.Previous(doc, view).Values)
                {
                    if (p.Instance != null) res.Add(p.Instance.Id.Value);
                    foreach (Element e in p.Parts) res.Add(e.Id.Value);
                }
            }
            catch { }
            return res;
        }
    }
}
