using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement
{
    /// <summary>«Арматур харуулах»-ын үр дүн.  Тоонууд нь арматурын ЭЛЕМЕНТ (олонлог) тус бүрээр.</summary>
    internal sealed class RfShowReport
    {
        /// <summary>Боловсруулсан арматурын элемент.</summary>
        public int Rebars;
        /// <summary>Горим / ширхгийн харагдац бодитоор өөрчлөгдсөн.</summary>
        public int Changed;
        /// <summary>Аль хэдийн хүссэн байдалтай байсан тул хөндөөгүй.</summary>
        public int AlreadyOk;
        /// <summary>Ганц эсвэл 2 ширхэгтэй — эзний дүрмээр ХӨНДӨӨГҮЙ.</summary>
        public int Small;
        /// <summary>Энэ харагдацад олонлогийн харагдац тохируулах боломжгүй (Revit CanApplyPresentationMode = false).</summary>
        public int CannotApply;
        /// <summary>Харуулах нэг ч ширхэг сонгогдоогүй тул алгассан.</summary>
        public int Empty;
        /// <summary>«Голоос N дэх» нь олонлогийн хүрээнд багтаагүй олонлог.</summary>
        public int OffsetOutOfRange;
        public bool IsReset;
        public long ElapsedMs;
        public readonly List<string> Failures = new List<string>();
        public readonly List<string> Notes = new List<string>();

        public void Add(RfShowReport o)
        {
            if (o == null) return;
            Rebars += o.Rebars; Changed += o.Changed; AlreadyOk += o.AlreadyOk; Small += o.Small; CannotApply += o.CannotApply;
            Empty += o.Empty; OffsetOutOfRange += o.OffsetOutOfRange; ElapsedMs += o.ElapsedMs;
            Failures.AddRange(o.Failures); Notes.AddRange(o.Notes);
        }
    }

    /// <summary>
    /// Арматурын олонлог (bar set)-ийн ХАРАГДАЦ (Presentation) дахь харагдах ширхгийг Revit-д бичнэ.  Ямар ширхэг харагдахыг <see cref="RfShowPlan"/> шийднэ —
    /// энд зөвхөн унших/бичих.
    ///
    /// Revit API: <c>Rebar.CanApplyPresentationMode / GetPresentationMode / SetPresentationMode(view, mode)</c>, <c>IsBarHidden / SetBarHiddenStatus(view, index, hide)</c>
    /// (<c>SetBarHiddenStatus</c> нь зөвхөн <see cref="RebarPresentationMode.Select"/> горимд — тиймээс ЭХЛЭЭД горим, ДАРАА нь ширхэг бүрийн төлөв).
    /// Хүссэн байдал нь бүгд / эхний-сүүлийн бол Revit-ийн УРИЛГЫН горимыг (All / FirstLast) хэрэглэнэ, бусад үед Select.
    /// Арматур бүр ТУСДАА SubTransaction — нэг арматур алдаа гарвал хагас бичигдсэн үлдэхгүй, бусад нь үргэлжилнэ.
    /// </summary>
    internal static class RfShowService
    {
        /// <summary>Идэвхтэй харагдацад харагдах бүх арматур (<see cref="Rebar"/>; Area/Path Reinforcement-ийн арматур биш).</summary>
        public static List<Rebar> RebarsInView(Document doc, View view)
        {
            var list = new List<Rebar>();
            foreach (Element e in new FilteredElementCollector(doc, view.Id).OfClass(typeof(Rebar)))
            {
                Rebar r = e as Rebar;
                if (r != null) list.Add(r);
            }
            return list;
        }

        /// <summary>Тохиргоог олон арматурт хэрэглэнэ (нэг транзакц = нэг Ctrl+Z).</summary>
        public static RfShowReport Apply(Document doc, View view, IEnumerable<Rebar> rebars, RfShowSpec spec, string title)
        {
            return Run(doc, title, rep =>
            {
                foreach (Rebar r in rebars) ApplyOne(doc, view, r, spec, null, rep);
            });
        }

        /// <summary>Нэг товшилт: дарсан цэгт хамгийн ойр ХАРАГДАЖ БУЙ ширхгийг тохиргоонд нэмж хэрэглэнэ (товшилт бүр тусдаа Ctrl+Z).</summary>
        public static RfShowReport ApplyClick(Document doc, View view, Rebar rebar, XYZ clickPoint, RfShowSpec spec, string title)
        {
            return Run(doc, title, rep => ApplyOne(doc, view, rebar, spec, clickPoint, rep));
        }

        /// <summary>Бүх ширхгийг буцааж харуулна (горим = All).  Ганц, 2 ширхэгт хөндөхгүй.</summary>
        public static RfShowReport ShowAll(Document doc, View view, IEnumerable<Rebar> rebars, string title)
        {
            RfShowReport rep = Run(doc, title, r =>
            {
                foreach (Rebar rb in rebars) ResetOne(doc, view, rb, r);
            });
            rep.IsReset = true;
            return rep;
        }

        // ── нэг арматур ────────────────────────────────────────────────────

        private static void ApplyOne(Document doc, View view, Rebar rebar, RfShowSpec spec, XYZ clickPoint, RfShowReport rep)
        {
            rep.Rebars++;
            List<int> existing;
            if (!Eligible(view, rebar, rep, out existing)) return;

            RfPresentation mode = ModeOf(rebar, view);
            List<int> current = RfShowPlan.CurrentVisible(mode, existing, i => rebar.IsBarHidden(view, i));

            int[] clicked = null;
            if (clickPoint != null)
            {
                int bar = NearestVisibleBar(rebar, view, clickPoint, current);
                if (bar < 0)
                {
                    rep.Failures.Add(Label(rebar) + ": " + RfShowText.NoNearestBar);
                    return;
                }
                clicked = new[] { bar };
            }

            // «Одоо харагдаж буйг хадгалах»: ЗӨВХӨН өмнө сонгосон (Select/FirstLast/Middle) ширхгийг.  Горим «Бүгд» (хэзээ ч хөндөөгүй) бол бүх ширхэг
            // харагдаж байгаа нь СОНГОЛТ БИШ — тэгэхгүй бол хадгалах чагттай үед ямар ч ширхэг нуугдахгүй.
            List<int> keep = mode == RfPresentation.All ? new List<int>() : current;
            RfShowDecision d = RfShowPlan.Decide(existing, spec, clicked, keep);
            if (d.Empty)
            {
                rep.Empty++;
                return;
            }
            if (d.OutOfRange.Count > 0) rep.OffsetOutOfRange++;
            if (RfShowPlan.IsAlreadyApplied(d, current, mode))
            {
                rep.AlreadyOk++;
                return;
            }

            using (var st = new SubTransaction(doc))
            {
                st.Start();
                try
                {
                    rebar.SetPresentationMode(view, ToRevit(d.Target));
                    if (d.Target == RfShowTarget.Select)
                    {
                        var hidden = new HashSet<int>(d.Hidden);
                        foreach (int i in existing) rebar.SetBarHiddenStatus(view, i, hidden.Contains(i));
                    }
                    st.Commit();
                    rep.Changed++;
                }
                catch (Exception ex)
                {
                    try { st.RollBack(); }
                    catch { /* аль хэдийн буцсан */ }
                    rep.Failures.Add(Label(rebar) + ": " + ex.Message);
                }
            }
        }

        private static void ResetOne(Document doc, View view, Rebar rebar, RfShowReport rep)
        {
            rep.Rebars++;
            List<int> existing;
            if (!Eligible(view, rebar, rep, out existing)) return;

            if (ModeOf(rebar, view) == RfPresentation.All)
            {
                rep.AlreadyOk++;
                return;
            }
            using (var st = new SubTransaction(doc))
            {
                st.Start();
                try
                {
                    rebar.SetPresentationMode(view, RebarPresentationMode.All);
                    st.Commit();
                    rep.Changed++;
                }
                catch (Exception ex)
                {
                    try { st.RollBack(); }
                    catch { /* аль хэдийн буцсан */ }
                    rep.Failures.Add(Label(rebar) + ": " + ex.Message);
                }
            }
        }

        /// <summary>Эзний дүрэм: ганц, 2 ширхэгтэй олонлогт ХҮРЭХГҮЙ; харагдацын горим тохируулах боломжгүй бол алгасна.</summary>
        private static bool Eligible(View view, Rebar rebar, RfShowReport rep, out List<int> existing)
        {
            existing = null;
            int n;
            try { n = rebar.NumberOfBarPositions; }
            catch { n = 1; }
            if (!RfShowPlan.IsAffected(n))
            {
                rep.Small++;
                return false;
            }
            bool can;
            try { can = rebar.CanApplyPresentationMode(view); }
            catch { can = false; }
            if (!can)
            {
                rep.CannotApply++;
                return false;
            }
            existing = ExistingPositions(rebar, n);
            if (!RfShowPlan.IsAffected(existing.Count))
            {
                rep.Small++;
                return false;
            }
            return true;
        }

        private static List<int> ExistingPositions(Rebar rebar, int n)
        {
            var list = new List<int>(n);
            for (int i = 0; i < n; i++)
            {
                try
                {
                    if (rebar.DoesBarExistAtPosition(i)) list.Add(i);
                }
                catch
                {
                    // Энэ индекс байхгүй.
                }
            }
            return list;
        }

        /// <summary>
        /// Дарсан цэгт хамгийн ойр ХАРАГДАЖ БУЙ ширхэг (нуугдсан ширхгийг дарж болохгүй).  Харагдацын хавтгай дээрх зайгаар —
        /// <see cref="RfRebarEnds"/>-ийн «Сонгосон ширхэг» горимтой ИЖИЛ арга.  Тодорхойлж чадахгүй бол −1 (таамаглахгүй).
        /// </summary>
        private static int NearestVisibleBar(Rebar rebar, View view, XYZ point, IList<int> candidates)
        {
            try
            {
                RfViewFrame frame = RfView.Frame(view);
                RfV3 p3 = RfConv.V(point);
                RfV2 pick = frame.ToView(p3);
                double depth = frame.DepthOf(p3);
                var dist = new List<double>(candidates.Count);
                foreach (int i in candidates)
                {
                    IList<Curve> curves;
                    try
                    {
                        curves = rebar.GetTransformedCenterlineCurves(false, true, false, MultiplanarOption.IncludeOnlyPlanarCurves, i);
                    }
                    catch
                    {
                        curves = null;
                    }
                    dist.Add(RfRebarEnds.DistanceToCurves(curves, frame, pick, depth));
                }
                return RfEndSymbolMath.NearestBar(candidates, dist);
            }
            catch
            {
                return -1;
            }
        }

        private static RfPresentation ModeOf(Rebar rebar, View view)
        {
            try
            {
                switch (rebar.GetPresentationMode(view))
                {
                    case RebarPresentationMode.FirstLast: return RfPresentation.FirstLast;
                    case RebarPresentationMode.Middle: return RfPresentation.Middle;
                    case RebarPresentationMode.Select: return RfPresentation.Select;
                    default: return RfPresentation.All;
                }
            }
            catch
            {
                return RfPresentation.All;
            }
        }

        private static RebarPresentationMode ToRevit(RfShowTarget t)
        {
            switch (t)
            {
                case RfShowTarget.FirstLast: return RebarPresentationMode.FirstLast;
                case RfShowTarget.Select: return RebarPresentationMode.Select;
                default: return RebarPresentationMode.All;
            }
        }

        private static string Label(Rebar r)
        {
            return "Rebar #" + r.Id.Value;
        }

        private static RfShowReport Run(Document doc, string title, Action<RfShowReport> body)
        {
            var rep = new RfShowReport();
            var sw = Stopwatch.StartNew();
            using (var t = new Transaction(doc, title))
            {
                t.Start();
                try
                {
                    body(rep);
                }
                catch (Exception ex)
                {
                    rep.Failures.Add(ex.Message);
                }
                // Нэг ч өөрчлөлтгүй бол загварт ЮУ Ч үлдээхгүй (Ctrl+Z-ийн түүхэнд хоосон бичлэг орохгүй).
                if (rep.Changed > 0) t.Commit();
                else t.RollBack();
            }
            sw.Stop();
            rep.ElapsedMs = sw.ElapsedMilliseconds;
            return rep;
        }
    }

    /// <summary>Тохиргооны цонхны сүүлийн утгууд (хэрэглэгч бүрийн settings хавтаст, <c>rebar-show.json</c>).</summary>
    internal sealed class RfShowPrefs
    {
        public bool First { get; set; } = true;
        public bool Last { get; set; } = true;
        public bool Middle { get; set; } = true;
        public string Offsets { get; set; } = string.Empty;
        public int Side { get; set; }
        public bool Keep { get; set; }

        /// <summary>«Захын, голын арматур» товчны сонголт (өгөгдмөл — гурвууланг).</summary>
        public bool EdgeFirst { get; set; } = true;
        public bool EdgeLast { get; set; } = true;
        public bool EdgeMiddle { get; set; } = true;
        public int PreviewCount { get; set; } = 11;

        private static string PathOf { get { return Path.Combine(global::RevitMcpAddin.SettingsStore.Dir, "rebar-show.json"); } }

        public static RfShowPrefs Load()
        {
            try
            {
                if (File.Exists(PathOf))
                {
                    RfShowPrefs p = JsonSerializer.Deserialize<RfShowPrefs>(File.ReadAllText(PathOf));
                    if (p != null)
                    {
                        if (p.Offsets == null) p.Offsets = string.Empty;
                        if (p.PreviewCount < 3 || p.PreviewCount > 999) p.PreviewCount = 11;
                        return p;
                    }
                }
            }
            catch
            {
                // Эвдэрсэн файл — өгөгдмөл.
            }
            return new RfShowPrefs();
        }

        public void Save()
        {
            try
            {
                Directory.CreateDirectory(global::RevitMcpAddin.SettingsStore.Dir);
                File.WriteAllText(PathOf, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
            }
            catch
            {
                // Тохиргоо хадгалагдаагүй нь команд унагахгүй.
            }
        }
    }
}
