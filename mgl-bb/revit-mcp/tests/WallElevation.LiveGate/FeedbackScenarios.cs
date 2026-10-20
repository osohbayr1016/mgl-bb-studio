using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.ExtensibleStorage;
using Autodesk.Revit.UI;

namespace MglWeGate
{
    /// <summary>
    /// 2026-10-16 «Ханын дэлгээс» сайжруулалтын LIVE сценари (black-box: production командыг ribbon-оор, загварт үүссэнийг уншина):
    ///   W01 REPLAN-HOST-102 — ажил явж байх үед өрөөний хана зөөгдвөл дахин төлөвлөж шинэ геометрээр, давхардалгүй;
    ///   W06 FOCUS-HOST-103  — хэрэглэгч өөр зураг руу шилжсэн бол дуусахад цонх нээхгүй, харагдац солихгүй;
    ///   W07 CROP-STORED-105 — харагдац дээр хадгалсан босоо хүрээ дахин ажиллуулахад тэр дэлгээсэнд, бусад нь хөдлөхгүй;
    ///   W08 SURF-LINK-201A  — тэгш + налуу тааз, тавцан: spot бүр өөрийн нүүр дээр, налуу нь босоо гинжид биш;
    ///   W09 PRESET-*-B102   — «Интерьер» товчоор зориулалт харагдац дээр хадгалагдаж, энгийн товчны дахин ажиллуулалт түүнийг ашиглана.
    /// </summary>
    internal static class FeedbackScenarios
    {
        /// <summary>production <c>WeViewStateStore</c>-ийн схем (GUID, «Data» талбар) — ӨӨР GUID бичвэл production уншихгүй.</summary>
        private static readonly Guid StateSchema = new Guid("c4a7e2d9-6b1f-4f83-a5d0-3e9b7c2f1a58");
        private const string ResultsTitle = "MGL — Ханын дэлгээсийн үр дүн";

        // ── Харагдацын төлөв (W07/W09) ─────────────────────────────

        internal static string StateData(Element e)
        {
            try
            {
                Schema s = Schema.Lookup(StateSchema);
                if (s == null || e == null) return null;
                Entity ent = e.GetEntity(s);
                return ent != null && ent.IsValid() ? ent.Get<string>("Data") : null;
            }
            catch { return null; }
        }

        internal static string StateValue(Element e, string key)
        {
            string data = StateData(e);
            if (data == null) return null;
            foreach (string part in data.Split(';'))
            {
                int eq = part.IndexOf('=');
                if (eq > 0 && part.Substring(0, eq).Trim() == key) return part.Substring(eq + 1).Trim();
            }
            return null;
        }

        private static string WithValues(string data, IDictionary<string, string> set)
        {
            var parts = new List<string>();
            var done = new HashSet<string>(StringComparer.Ordinal);
            foreach (string part in (data ?? "v=1").Split(';'))
            {
                int eq = part.IndexOf('=');
                if (eq <= 0) continue;
                string k = part.Substring(0, eq).Trim();
                string v;
                if (set.TryGetValue(k, out v)) { parts.Add(k + "=" + v); done.Add(k); }
                else parts.Add(part.Trim());
            }
            foreach (KeyValuePair<string, string> kv in set) if (!done.Contains(kv.Key)) parts.Add(kv.Key + "=" + kv.Value);
            return string.Join(";", parts);
        }

        private static bool WriteState(Element e, string data)
        {
            Schema s = Schema.Lookup(StateSchema);
            if (s == null) return false;
            var ent = new Entity(s);
            ent.Set("Data", data);
            e.SetEntity(ent);
            return true;
        }

        private static long Fact(LiveContext L, string key)
        {
            object v;
            return L.R.Facts.TryGetValue(key, out v) ? Convert.ToInt64(v, CultureInfo.InvariantCulture) : 0;
        }

        private static double[] CropZ(View v)
        {
            List<XYZ> c = Geo.CropCorners(v);
            return new[] { U.ToMm(c.Min(p => p.Z)), U.ToMm(c.Max(p => p.Z)) };
        }

        // ── W09 ────────────────────────────────────────────────────

        public static Scenario PresetInterior(string id, string title, string link, string room)
        {
            Scenario g = Scenarios.Generate(id, title, link, room, new Scenarios.ExpectedViews { Min = 4, Max = 4, CheckUpper = false }, "preset");
            g.InteriorCommand = true;
            Action<UIApplication, LiveContext, ScenarioResult, ScnState> inspect = g.Inspect;
            g.Inspect = (app, L, res, st) =>
            {
                inspect(app, L, res, st);
                List<View> views = Inspector.NewElevations(Scenarios.Doc(app), L);
                List<string> bad = views.Where(v => StateValue(v, "preset") != "interior").Select(v => v.Name + "=" + (StateValue(v, "preset") ?? "—")).ToList();
                res.Expect(views.Count > 0 && bad.Count == 0, "preset.stored_interior",
                           views.Count == 0 ? "дэлгээс алга" : bad.Count == 0 ? "бүх " + views.Count + " дэлгээсэнд preset=interior" : string.Join("; ", bad));
            };
            return g;
        }

        public static Scenario PresetKeep(string id, string title, string link, string room)
        {
            Scenario r = Scenarios.Rerun(id, title, link, room);
            r.Category = "preset";
            Func<UIApplication, LiveContext, ScenarioResult, ScnState, bool> setup = r.Setup;
            r.Setup = (app, L, res, st) =>
            {
                List<long> made;
                if (!L.Generated.TryGetValue(room, out made) || made.Count == 0) { res.Add("setup", "BLOCKED", room + "-ийн үүсгэсэн дэлгээс алга (PRESET-INT унасан)"); return false; }
                // Өмнөх ажиллуулалтын ХАДГАЛСАН тохиргоо (зориулалтын мөрүүдтэй) — шинээр бичвэл production хуучин тохиргоог зориулалт руу шилжүүлж
                // (migration) тестийг хуурна.
                string[] saved = File.Exists(LiveContext.ProdPrefs) ? File.ReadAllLines(LiveContext.ProdPrefs, Encoding.UTF8) : new string[0];
                if (!setup(app, L, res, st)) return false;
                if (!saved.Any(l => l.StartsWith("preset.interior=", StringComparison.Ordinal)))
                {
                    res.Add("setup.prefs", "BLOCKED", "өмнөх ажиллуулалт зориулалтын тохиргоог (preset.interior) хадгалаагүй");
                    return false;
                }
                // Ерөнхий («Тусгай») тэмдэглэгээг ӨӨР болгоно: B102 өөрийн «interior» зориулалтаараа бол юу ч өөрчлөгдөхгүй; ерөнхийг хэрэглэвэл
                // тэмдэглэгээ дахин тавигдаж тоо өөрчлөгдөнө.
                L.WritePrefs(saved.Where(l => !l.StartsWith("annotations=", StringComparison.Ordinal) && !l.StartsWith("reviewPanel=", StringComparison.Ordinal)
                                              && !l.StartsWith("livePreview=", StringComparison.Ordinal))
                                  .Concat(new[] { "annotations=walls:dim", "reviewPanel=0", "livePreview=0" }).ToArray());
                return true;
            };
            Action<UIApplication, LiveContext, ScenarioResult, ScnState> inspect = r.Inspect;
            r.Inspect = (app, L, res, st) =>
            {
                inspect(app, L, res, st);   // давхардалгүй, дэлгээс бүрийн тэмдэглэгээний тоо хэвээр
                Document doc = Scenarios.Doc(app);
                List<View> views = L.Generated[room].Select(x => doc.GetElement(new ElementId(x)) as View).Where(v => v != null).ToList();
                List<string> bad = views.Where(v => StateValue(v, "preset") != "interior").Select(v => v.Name + "=" + (StateValue(v, "preset") ?? "—")).ToList();
                res.Expect(views.Count > 0 && bad.Count == 0, "preset.kept_interior", bad.Count == 0 ? "зориулалт «interior» хэвээр (" + views.Count + ")" : string.Join("; ", bad));
            };
            return r;
        }

        // ── W07 ────────────────────────────────────────────────────

        private sealed class CropData
        {
            public object Snapshot;
            public ElementId Target;
            public Dictionary<long, double[]> Before;
            public double FloorMm;
        }

        public static Scenario CropStored(string id, string title, string link, string room)
        {
            Scenario r = Scenarios.Rerun(id, title, link, room);
            r.Category = "editability";
            Func<UIApplication, LiveContext, ScenarioResult, ScnState, bool> setup = r.Setup;
            r.Setup = (app, L, res, st) =>
            {
                Document doc = Scenarios.Doc(app);
                List<long> made;
                if (!L.Generated.TryGetValue(room, out made) || made.Count == 0) { res.Add("setup", "BLOCKED", room + "-ийн үүсгэсэн дэлгээс алга (GEN сценари унасан)"); return false; }
                List<View> views = made.Select(x => doc.GetElement(new ElementId(x)) as View).Where(v => v != null).OrderBy(v => v.Name, StringComparer.Ordinal).ToList();
                if (views.Count == 0) { res.Add("setup", "BLOCKED", "дэлгээс алга"); return false; }
                View target = views[0];
                string data = StateData(target);
                if (data == null) { res.Add("setup.state", "BLOCKED", "харагдацын төлөвийн бичлэг (MglWallElevationState) алга — production бичээгүй"); return false; }
                Geo.LinkedRoom lr = Geo.FindRoom(doc, link, room);
                if (lr == null) { res.Add("setup.room", "BLOCKED", room + " олдсонгүй"); return false; }
                var cd = new CropData { Target = target.Id, Before = views.ToDictionary(v => v.Id.Value, CropZ), FloorMm = U.ToMm(lr.LevelZ) };
                using (var t = new Transaction(doc, "gate: CROP — хадгалсан босоо хүрээ 0…1500"))
                {
                    t.Start();
                    if (!WriteState(target, WithValues(data, new Dictionary<string, string> { { "lo", "0" }, { "up", "1500" } })))
                    {
                        t.RollBack();
                        res.Add("setup.state", "BLOCKED", "төлөвийн схем алга");
                        return false;
                    }
                    t.Commit();
                }
                res.Info("setup.crop", "«" + target.Name + "»: lo=0, up=1500 (өмнө " + data + ")");
                if (!setup(app, L, res, st)) return false;
                cd.Snapshot = st.Data;
                st.Data = cd;
                return true;
            };
            r.Inspect = (app, L, res, st) =>
            {
                var cd = st.Data as CropData;
                if (cd == null) { res.Add("inspect", "BLOCKED", "setup өгөгдөл алга"); return; }
                Document doc = Scenarios.Doc(app);
                List<View> fresh = Inspector.NewElevations(doc, L);
                int sheets = L.Added.Count(x => doc.GetElement(new ElementId(x)) is ViewSheet);
                res.Expect(fresh.Count == 0 && sheets == 0, "crop.no_duplicates", "шинэ дэлгээс " + fresh.Count + ", хуудас " + sheets);
                var target = doc.GetElement(cd.Target) as View;
                if (target == null) { res.Add("crop.target", "FAIL", "тэмдэглэсэн дэлгээс устсан"); return; }
                double[] z = CropZ(target);
                res.Info("crop.target_z", "«" + target.Name + "» crop Z " + U.F(z[0]) + "…" + U.F(z[1]) + " мм (шал " + U.F(cd.FloorMm) + ")");
                res.Expect(Math.Abs(z[0] - cd.FloorMm) <= 5 && Math.Abs(z[1] - z[0] - 1500) <= 5, "crop.applied",
                           "хүлээгдэж буй " + U.F(cd.FloorMm) + "…" + U.F(cd.FloorMm + 1500) + " мм, бодит " + U.F(z[0]) + "…" + U.F(z[1]));
                var moved = new List<string>();
                foreach (KeyValuePair<long, double[]> kv in cd.Before)
                {
                    if (kv.Key == cd.Target.Value) continue;
                    var v = doc.GetElement(new ElementId(kv.Key)) as View;
                    if (v == null) { moved.Add("#" + kv.Key + " устсан"); continue; }
                    double[] now = CropZ(v);
                    if (Math.Abs(now[0] - kv.Value[0]) > 1 || Math.Abs(now[1] - kv.Value[1]) > 1) moved.Add(v.Name + " " + U.F(kv.Value[0]) + "…" + U.F(kv.Value[1]) + " → " + U.F(now[0]) + "…" + U.F(now[1]));
                }
                res.Expect(moved.Count == 0, "crop.others_unchanged", moved.Count == 0 ? "бусад " + (cd.Before.Count - 1) + " дэлгээс хөдлөөгүй" : string.Join("; ", moved));
                string lo = StateValue(target, "lo"), up = StateValue(target, "up");
                res.Expect(lo == "0" && up == "1500", "crop.state_kept", "lo=" + (lo ?? "—") + ", up=" + (up ?? "—"));
                res.Info("crop.target_updated", L.Modified.Contains(cd.Target.Value) ? "дэлгээс шинэчлэгдэв" : "дэлгээс хөндөгдсөнгүй");
            };
            return r;
        }

        // ── W08 ────────────────────────────────────────────────────

        public static Scenario Surfaces(string id, string title, string link, string room)
        {
            Scenario g = Scenarios.Generate(id, title, link, room, new Scenarios.ExpectedViews { Min = 4, Max = 4, CheckUpper = false }, "geometry");
            g.Setup = (app, L, res, st) =>
            {
                // L2-ийн өрөө — tag нь L2 план дээр (Generate-ийн L1 планаар биш).
                Document doc = Scenarios.Doc(app);
                Geo.LinkedRoom lr = Geo.FindRoom(doc, link, room);
                if (lr == null) { res.Add("setup.room", "BLOCKED", link + "/" + room + " өрөө олдсонгүй"); return false; }
                var plan = doc.GetElement(new ElementId(Convert.ToInt64(L.R.Facts["plan_l2"], CultureInfo.InvariantCulture))) as ViewPlan;
                if (!Scenarios.Activate(app, plan, res)) return false;
                Autodesk.Revit.DB.Architecture.RoomTag tag = Geo.TagOf(doc, plan, lr);
                if (tag == null) { res.Add("setup.tag", "BLOCKED", room + "-ийн tag L2 планд алга"); return false; }
                app.ActiveUIDocument.Selection.SetElementIds(new List<ElementId> { tag.Id });
                L.WritePrefs(Scenarios.DefaultPrefs);
                st.Driver.AddRange(Scenarios.GenerateScript(id));
                st.Data = lr;
                return true;
            };
            Action<UIApplication, LiveContext, ScenarioResult, ScnState> inspect = g.Inspect;
            g.Inspect = (app, L, res, st) =>
            {
                inspect(app, L, res, st);
                Document doc = Scenarios.Doc(app);
                long flat = Fact(L, "surf_ceiling_flat"), sloped = Fact(L, "surf_ceiling_sloped");
                long baseF = Fact(L, "surf_floor_base"), plat = Fact(L, "surf_floor_platform");
                if (flat == 0 || sloped == 0 || baseF == 0 || plat == 0) { res.Add("surf.model", "BLOCKED", "201A-ийн шал/тааз загварт үүсээгүй (ModelFactory)"); return; }
                List<View> views = Inspector.NewElevations(doc, L);
                var spots = new Dictionary<long, List<KeyValuePair<long, SpotDimension>>>();
                var dimRefs = new HashSet<long>();
                foreach (View v in views)
                {
                    var list = new List<KeyValuePair<long, SpotDimension>>();
                    foreach (Dimension d in new FilteredElementCollector(doc, v.Id).OfClass(typeof(Dimension)).Cast<Dimension>())
                    {
                        var sd = d as SpotDimension;
                        foreach (Reference rf in d.References)
                        {
                            if (rf == null) continue;
                            if (sd != null) list.Add(new KeyValuePair<long, SpotDimension>(rf.ElementId.Value, sd));
                            else dimRefs.Add(rf.ElementId.Value);
                        }
                    }
                    foreach (SpotDimension sd in new FilteredElementCollector(doc, v.Id).OfClass(typeof(SpotDimension)).Cast<SpotDimension>())
                        foreach (Reference rf in sd.References)
                            if (rf != null && !list.Any(kv => kv.Value.Id == sd.Id && kv.Key == rf.ElementId.Value)) list.Add(new KeyValuePair<long, SpotDimension>(rf.ElementId.Value, sd));
                    spots[v.Id.Value] = list;
                    res.Info("surf.view." + v.Name, "spot: " + string.Join(", ", list.Select(kv => "#" + kv.Key)) + " · хэмжээсийн лавлагаа " + dimRefs.Count);
                }
                View both = views.FirstOrDefault(v => spots[v.Id.Value].Any(kv => kv.Key == flat) && spots[v.Id.Value].Any(kv => kv.Key == sloped));
                res.Expect(both != null, "surf.two_ceiling_spots", both != null ? "«" + both.Name + "»: тэгш ба налуу таазанд тус бүр spot" : "хоёр таазыг хоёуланг нь spot-лосон дэлгээс алга");
                if (both != null)
                {
                    XYZ a = spots[both.Id.Value].First(kv => kv.Key == flat).Value.Origin, b = spots[both.Id.Value].First(kv => kv.Key == sloped).Value.Origin;
                    double dx = Math.Abs((a - b).DotProduct(both.RightDirection)) * 304.8;
                    res.Expect(dx > 500, "surf.spots_apart", "хоёр таазны spot-ын хэвтээ зай " + U.F(dx) + " мм (ижил x дээр бөөгнөрөхгүй)");
                    PlanarFace face = BottomFace(doc, sloped);
                    if (face == null) res.Add("surf.sloped_spot_on_face", "BLOCKED", "налуу таазны доод нүүр уншигдсангүй");
                    else
                    {
                        double want = PlaneZ(face, b);
                        res.Expect(Math.Abs(b.Z - want) * 304.8 <= 5, "surf.sloped_spot_on_face",
                                   "налуу таазны spot-ын цэг " + U.F(b.Z * 304.8) + " мм, тэр цэг дээрх нүүр " + U.F(want * 304.8) + " мм (хайрцгийн доод " + U.F(face.Origin.Z * 304.8) + " биш)");
                    }
                }
                res.Expect(views.Any(v => spots[v.Id.Value].Any(kv => kv.Key == plat)), "surf.step_spot", "тавцанд (+150) тусдаа spot level");
                res.Expect(views.Any(v => spots[v.Id.Value].Any(kv => kv.Key == baseF)), "surf.main_floor_spot", "суурь шал (+50) гол шалны spot");
                res.Expect(!dimRefs.Contains(sloped), "surf.sloped_not_dimensioned", dimRefs.Contains(sloped) ? "налуу тааз хэмжээсийн лавлагаа болсон" : "налуу тааз хэмжээсэнд ороогүй");
                res.Expect(dimRefs.Contains(flat), "surf.flat_ceiling_dimensioned", dimRefs.Contains(flat) ? "тэгш тааз босоо хэмжээсэнд" : "тэгш таазанд хэмжээс алга");
                string log = st.Log ?? string.Empty;
                List<string> lost = Regex.Matches(log, @"[^\n]*spot [^\n]*лавлагаа олдсонгүй[^\n]*").Cast<Match>().Select(m => m.Value.Trim()).ToList();
                res.Expect(lost.Count == 0, "surf.spot_references", lost.Count == 0 ? "бүх spot лавлагаатай" : Scenarios.Trim(string.Join(" | ", lost), 400));
            };
            return g;
        }

        private static PlanarFace BottomFace(Document doc, long id)
        {
            var ho = doc.GetElement(new ElementId(id)) as HostObject;
            if (ho == null) return null;
            try
            {
                foreach (Reference r in HostObjectUtils.GetBottomFaces(ho))
                {
                    var pf = ho.GetGeometryObjectFromReference(r) as PlanarFace;
                    if (pf != null) return pf;
                }
            }
            catch { }
            return null;
        }

        private static double PlaneZ(PlanarFace f, XYZ p)
        {
            XYZ n = f.FaceNormal, o = f.Origin;
            return Math.Abs(n.Z) < 1e-9 ? o.Z : o.Z - (n.X * (p.X - o.X) + n.Y * (p.Y - o.Y)) / n.Z;
        }

        // ── W01 ────────────────────────────────────────────────────

        public static Scenario ReplanHost(string id, string title, string room)
        {
            Scenario g = Scenarios.GenerateHost(id, title, room, 6, "reliability");
            g.TimeoutSec = 600;
            g.During = (app, L, res, st, log) =>
            {
                if (log.Contains("арын ажил #")) { res.Add("during.window", "BLOCKED", "ажил хана зөөхөөс ӨМНӨ дууссан — дахин төлөвлөлт шалгагдсангүй"); return true; }
                if (!log.Contains(" эхэллээ:")) return false;
                Document doc = Scenarios.Doc(app);
                Wall w = WallAt(doc, 10000, 5000, 10000, 8000);   // Synth P5 — 102-ийн дээд хэсгийн зүүн хана
                if (w == null) { res.Add("during.wall", "BLOCKED", "102-ийн P5 хана олдсонгүй"); return true; }
                using (var t = new Transaction(doc, "gate: REPLAN — 102-ийн хана 300 мм зөөх"))
                {
                    t.Start();
                    ElementTransformUtils.MoveElement(doc, w.Id, new XYZ(U.Mm(300), 0, 0));
                    t.Commit();
                }
                res.Info("during.moved", "P5 #" + w.Id.Value + " +300 мм (X) — ажил явж байх үед");
                return true;
            };
            Action<UIApplication, LiveContext, ScenarioResult, ScnState> inspect = g.Inspect;
            g.Inspect = (app, L, res, st) =>
            {
                inspect(app, L, res, st);   // 6 дэлгээс, чиглэл/гүн ОДООГИЙН (зөөсөн) өрөөгөөр
                string log = st.Log ?? string.Empty;
                res.Expect(log.Contains("эх өгөгдөл өөрчлөгдсөн"), "replan.detected", log.Contains("эх өгөгдөл өөрчлөгдсөн") ? "өөрчлөлтийг илрүүлэв" : "лог дээр «эх өгөгдөл өөрчлөгдсөн» алга");
                res.Expect(log.Contains("дахин төлөвлөв"), "replan.replanned", log.Contains("дахин төлөвлөв") ? Scenarios.Trim(Regex.Match(log, @"[^\n]*дахин төлөвлөв[^\n]*").Value.Trim(), 200) : "дахин төлөвлөсөнгүй");
                Document doc = Scenarios.Doc(app);
                int sheets = L.Added.Count(x => doc.GetElement(new ElementId(x)) is ViewSheet);
                res.Expect(sheets == 1, "replan.one_sheet", "шинэ хуудас " + sheets + " (давхардалгүй)");
            };
            return g;
        }

        private static Wall WallAt(Document doc, double x0, double y0, double x1, double y1)
        {
            XYZ a = U.P(x0, y0), b = U.P(x1, y1);
            foreach (Wall w in new FilteredElementCollector(doc).OfClass(typeof(Wall)).Cast<Wall>())
            {
                var lc = w.Location as LocationCurve;
                if (lc == null) continue;
                XYZ p = lc.Curve.GetEndPoint(0), q = lc.Curve.GetEndPoint(1);
                Func<XYZ, XYZ, bool> near = (m, n) => Math.Abs(m.X - n.X) < U.Mm(5) && Math.Abs(m.Y - n.Y) < U.Mm(5);
                if ((near(p, a) && near(q, b)) || (near(p, b) && near(q, a))) return w;
            }
            return null;
        }

        // ── W06 ────────────────────────────────────────────────────

        /// <summary>
        /// F01–F02 (2026-10-16): ribbon-ийн «Санал хүсэлт» товч тестийн Revit-д цонхоо нээж (лицензгүй замаар), оношилгоонд ЭНЭ Revit-ийн он ба
        /// ачаалагдсан production DLL-ийн SHA-256 орсон эсэх.  ⚠️ Хэзээ ч «Илгээх» дарахгүй — production сервер рүү тест хүсэлт явуулахгүй,
        /// хэрэглэгчийн офлайн дараалалд (outbox) юу ч нэмэгдэхгүйг ШАЛГАНА.  Цонхыг хаана.
        /// </summary>
        public static Scenario FeedbackOpen(string id, string title)
        {
            const string W = "MGL — Санал хүсэлт";
            return new Scenario
            {
                Id = id, Title = title, Category = "feedback", ExpectJob = false, TimeoutSec = 180,
                CommandOf = L => L.CmdFeedback,
                Activate = (app, L, res, st) => true,
                Setup = (app, L, res, st) =>
                {
                    if (L.CmdFeedback == null) { res.Add("precondition", "BLOCKED", "«Санал хүсэлт» товч ribbon-оос олдсонгүй"); return false; }
                    st.Data = OutboxFiles();
                    st.Driver.Add("wait \"" + W + "\" 60");
                    st.Driver.Add("try-invoke \"" + W + "\" \"^Юу илгээгдэх вэ\" 10");
                    st.Driver.Add("sleep 600");
                    st.Driver.Add("dump \"" + W + "\" feedback-" + id);
                    st.Driver.Add("finally dismiss \"" + W + "\" 5");
                    return true;
                },
                Inspect = (app, L, res, st) =>
                {
                    string ack = st.Ack != null && File.Exists(st.Ack) ? File.ReadAllText(st.Ack, Encoding.UTF8) : string.Empty;
                    bool opened = ack.Contains("wait \"" + W + "\" 60 → ok");
                    res.Expect(opened, "feedback.window_opened", opened ? "цонх ribbon-оос нээгдэв" : "цонх гарсангүй: " + Scenarios.Trim(ack, 200));
                    string dump = Inspector.ReadDump(L, "feedback-" + id) ?? string.Empty;
                    res.Expect(dump.Contains("Шинэ хүсэлт") && dump.Contains("Миний хүсэлтүүд"), "feedback.form_tabs",
                               dump.Length == 0 ? "dump алга" : "«Шинэ хүсэлт» " + (dump.Contains("Шинэ хүсэлт") ? "✓" : "✗") + " · «Миний хүсэлтүүд» " + (dump.Contains("Миний хүсэлтүүд") ? "✓" : "✗"));
                    string year = app.Application.VersionNumber;
                    object shaObj;
                    string sha = L.R.Facts.TryGetValue("product_sha256", out shaObj) ? Convert.ToString(shaObj) : null;
                    bool schema = dump.Contains("mgl-diag/1"), hasYear = dump.Contains("Revit " + year), hasSha = !string.IsNullOrEmpty(sha) && dump.Contains(sha);
                    res.Expect(schema && hasYear && hasSha, "feedback.diagnostics",
                               "схем " + (schema ? "mgl-diag/1" : "АЛГА") + " · «Revit " + year + "» " + (hasYear ? "✓" : "АЛГА")
                               + " · DLL sha256 " + (hasSha ? sha.Substring(0, 12) + "… = ачаалагдсан DLL" : "таарсангүй (" + (sha ?? "?") + ")"));
                    int before = st.Data is int ? (int)st.Data : -1, after = OutboxFiles();
                    res.Expect(before >= 0 && after == before, "feedback.nothing_queued", "офлайн дараалал (outbox) файл " + before + " → " + after + " — gate хэзээ ч илгээхгүй");
                    IntPtr hw = Scenarios.FindWindow(null, W);
                    if (hw != IntPtr.Zero) Scenarios.PostMessage(hw, 0x0010 /* WM_CLOSE */, IntPtr.Zero, IntPtr.Zero);
                },
            };
        }

        private static int OutboxFiles()
        {
            try
            {
                string root = Path.Combine(LiveContext.ProdDir, "feedback");
                return Directory.Exists(root) ? Directory.GetFiles(root, "*", SearchOption.AllDirectories).Length : 0;
            }
            catch { return -2; }
        }

        public static Scenario NoFocusSteal(string id, string title, string room)
        {
            Scenario g = Scenarios.GenerateHost(id, title, room, 5, "reliability");
            Func<UIApplication, LiveContext, ScenarioResult, ScnState, bool> setup = g.Setup;
            g.Setup = (app, L, res, st) =>
            {
                if (!setup(app, L, res, st)) return false;
                // Үр дүнгийн самбар асаалттай — хэрэглэгч эхэлсэн зураг дээрээ хүлээж байсан бол НЭЭГДЭХ байсан.
                L.WritePrefs(Scenarios.DefaultPrefs.Where(p => !p.StartsWith("reviewPanel=", StringComparison.Ordinal)).Concat(new[] { "reviewPanel=1" }).ToArray());
                // Урьдчилсан нөхцөл: өмнөх сценарийн нээлттэй үлдсэн үр дүнгийн цонхыг ХААНА — эс бөгөөс энэ ажил нээсэн мэт харагдана (live
                // 2026-10-16 run 2: NEG-TEMPLATE-107-ийн цонх 16:45-аас нээлттэй үлдэж FOCUS-HOST-103 худал FAIL болсон).
                IntPtr stale = Scenarios.FindWindow(null, ResultsTitle);
                if (stale != IntPtr.Zero)
                {
                    Scenarios.PostMessage(stale, 0x0010 /* WM_CLOSE */, IntPtr.Zero, IntPtr.Zero);
                    res.Info("setup.closed_stale_results", "өмнөх сценарийн үр дүнгийн цонхыг хаав");
                }
                return true;
            };
            g.During = (app, L, res, st, log) =>
            {
                if (log.Contains("арын ажил #")) { res.Add("during.window", "BLOCKED", "ажил хэрэглэгч шилжихээс ӨМНӨ дууссан"); return true; }
                if (!log.Contains(" эхэллээ:")) return false;
                Document doc = Scenarios.Doc(app);
                View l2 = new FilteredElementCollector(doc).OfClass(typeof(ViewPlan)).Cast<ViewPlan>().FirstOrDefault(v => !v.IsTemplate && v.Name == "L2");
                if (l2 == null) { res.Add("during.view", "BLOCKED", "«L2» план алга"); return true; }
                app.ActiveUIDocument.ActiveView = l2;
                st.Data = new object[] { st.Data, l2.Id };
                res.Info("during.switched", "хэрэглэгч шиг «L2» план руу шилжив (ажил явж байх үед)");
                return true;
            };
            Action<UIApplication, LiveContext, ScenarioResult, ScnState> inspect = g.Inspect;
            g.Inspect = (app, L, res, st) =>
            {
                var arr = st.Data as object[];
                if (arr != null) st.Data = arr[0];
                inspect(app, L, res, st);
                ElementId l2 = arr != null ? arr[1] as ElementId : null;
                View active = app.ActiveUIDocument.ActiveView;
                res.Expect(l2 != null && active != null && active.Id == l2, "focus.active_view_kept",
                           "идэвхтэй харагдац: " + (active != null ? active.ViewType + " «" + active.Name + "»" : "—"));
                IntPtr hw = Scenarios.FindWindow(null, ResultsTitle);
                string log = st.Log ?? string.Empty;
                bool opened = log.Contains("үр дүнгийн самбар нээгдэв");
                res.Expect(hw == IntPtr.Zero && !opened, "focus.no_results_window",
                           hw == IntPtr.Zero && !opened ? "үр дүнгийн цонх нээгдээгүй" : "цонх нээгдсэн (фокус булаав)" + (opened ? " — лог: «самбар нээгдэв»" : " — цонх байна"));
                if (hw != IntPtr.Zero) Scenarios.PostMessage(hw, 0x0010 /* WM_CLOSE */, IntPtr.Zero, IntPtr.Zero);
                res.Expect(log.Contains("фокус булаахгүй"), "focus.logged", log.Contains("фокус булаахгүй") ? "«фокус булаахгүй» бичлэг" : "лог дээр бичлэг алга");
            };
            return g;
        }
    }
}
