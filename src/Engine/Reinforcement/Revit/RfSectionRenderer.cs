using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement
{
    internal sealed class RfRenderContext
    {
        public Document Doc;
        public View View;
        public RfSectionContext Ctx;
        public RfSectionFrame Frame;
        public DimensionType DimType;

        /// <summary>Multi-leader шошгонд leader-үүдийг нэгтгэх (Merge Leaders).</summary>
        public bool MergeLeaders;

        /// <summary>Leader-ийн 3→2 (хэвтээ хэсэг) ба 2→1 (налуу хэсгийн хэвтээ зай), цаасан мм.  0 = Revit-ийн автомат.</summary>
        public double LeaderLandingMm, LeaderRunMm;
        public int Scale = 100;
        public readonly List<ElementId> Created = new List<ElementId>();

        /// <summary>Огтлолын локал (a, b) → annotation хавтгай дээрх загварын цэг.</summary>
        public XYZ Model(RfV2 local)
        {
            return RfConv.X(Ctx.AnnotFrame.ToModel(Frame.ToView(local)));
        }

        public XYZ Model(double a, double b) { return Model(new RfV2(a, b)); }

        /// <summary>Цаасан мм → загварын фут (энэ харагдацын масштабаар).</summary>
        public double PaperToFt(double paperMm)
        {
            return paperMm * Scale / RfTol.MmPerFoot;
        }
    }

    /// <summary>Рендерийн гүйцэтгэлийн хязгаарууд.</summary>
    internal static class RfRenderCaps
    {
        /// <summary>
        /// Арматурын бодит лавлагаа хайх нь ширхэг бүрийн геометр + <c>GetBarIndexFromReference</c> дууддаг тул олонлог том бол удаан.
        /// Энэ ширхгээс дээш олонлогт лавлагаа хайхгүй — тэр талыг ХУУРАМЧ лавлагаагүйгээр алгасаж мэдэгдэнэ.
        /// </summary>
        public const int NativeSetCap = 200;
    }

    /// <summary>
    /// Арматурын БОДИТ геометрээс Reference хайх.  ⚠️ Зөвхөн <c>Element.get_Geometry(Options{ComputeReferences = true})</c>-ийн ЖИНХЭНЭ
    /// объектын (шулуун Edge / Line / цилиндр нүүр) өөрийнх нь Reference — геометрийг хөрвүүлж (transform) хуулбарласны дараа Reference-ийг
    /// ашиглахгүй.  Хөрвүүлэлт нь ЗӨВХӨН ангилал, байрлал шалгах тооцоонд (математик) ашиглагдана.
    ///
    /// ХЭМЖСЭН (2026-10-05, Revit 2027, бодит «ДН-1 S 1» огтлол): хомутын шулуун хэсэг нь цилиндр тул solid-д ирмэгийн дагуух Edge БАЙХГҮЙ.
    /// Харин <c>Options{ View = огтлол, IncludeNonVisibleObjects = true }</c> нь хомутын тал бүрт харагдацын хавтгайд ГУРВАН далд
    /// (<c>Visibility = Highlight</c>) шугам буцаадаг — гадна ирмэг, тэнхлэг, дотор ирмэг; stable хэлбэр нь <c>&lt;uid&gt;:2000000:1101xxx</c> /
    /// <c>…:1100xxx</c> / <c>…:1102xxx</c> (xxx = сегмент).  Инженерийн гараар тавьсан хэмжээс ЯГ эдгээрийг заадаг (Ø8: 22 / 26 / 30 мм).
    /// Эдгээр нь олонлогийн бүх ширхгийг огтлолын хавтгай руу проекцолсон НЭГ дүрслэл тул <c>GetBarIndexFromReference</c> нь хамгийн ойр
    /// ширхгийн биш, ҮРГЭЛЖ 0-ийг буцаадаг — тиймээс харагдацын геометрт ширхгийн индексийг хатуу тулгахгүй (хоёр дахь шат).
    /// Лавлагаа нь хүлээсэн физик байрлалд (0.5 мм) таарсан тохиолдолд л хүлээн авагдана; үгүй бол ХУУРАМЧ лавлагаа (нэмэлт шугам г.м.)
    /// ҮҮСГЭХГҮЙ — дуудагч тэр талыг алгасаж тайланд хэлнэ.  Хоёр Options хувилбарыг дарааллаар: (1) <c>View = идэвхтэй харагдац</c>
    /// + <c>IncludeNonVisibleObjects</c>, (2) <c>DetailLevel = Fine</c> (Revit-ийн баримтаар <c>View</c> ба <c>DetailLevel</c>-ийг ХАМТ
    /// тавьж болохгүй).
    /// </summary>
    internal static class RfRebarRefs
    {
        /// <summary>Хайлтын статистик (шалтгааныг тайланд тодорхой хэлэхэд).</summary>
        public sealed class Stats
        {
            public int Lines, Cylinders, WithReference, InPosition;

            public override string ToString()
            {
                return "шугам " + Lines + " · цилиндр " + Cylinders + " · лавлагаатай " + WithReference + " · хүлээсэн байрлалд " + InPosition;
            }
        }

        /// <summary>
        /// Арматурыг tag-лахад ашиглах Reference нэр дэвшигчид, ДАРААЛАЛТАЙ.  ⚠️ Бодит Revit 2027 дээр хэмжсэн (2026-10-05): дэлгээсэд
        /// <c>new Reference(rebar)</c> нь «The reference can not be tagged» гэж унадаг; гараар тавьсан шошго нь арматурын ДЭД-ЭЛЕМЕНТИЙН лавлагаа
        /// <c>&lt;uid&gt;:2000000:SUBELEMENT</c> (2000000 + ширхгийн индекс; олонлогийн харагдаж буй ширхэг) ашигладаг.  Огтлолд <c>new Reference(rebar)</c> ажилладаг.
        /// </summary>
        /// <param name="subFirst">true = дэд-элементийн лавлагааг эхэлж (дэлгээс), false = элементийг эхэлж (огтлол).</param>
        public static List<Reference> TagReferences(Rebar rebar, int barIndex, bool subFirst)
        {
            var list = new List<Reference>();
            var subs = new List<Reference>();
            foreach (int k in barIndex > 0 ? new[] { barIndex, 0 } : new[] { 0 })
            {
                try { subs.Add(Reference.ParseFromStableRepresentation(rebar.Document, rebar.UniqueId + ":" + (2000000 + k) + ":SUBELEMENT")); }
                catch { /* Энэ ширхэг байхгүй — дараагийнх. */ }
            }
            if (subFirst) list.AddRange(subs);
            try { list.Add(new Reference(rebar)); }
            catch { /* Reference үүсэхгүй. */ }
            if (!subFirst) list.AddRange(subs);
            return list;
        }

        /// <summary>
        /// Харагдацын геометр: <c>IncludeNonVisibleObjects</c> нь хомутын гадна/тэнхлэг/дотор ирмэгийн далд (Highlight) шугамуудыг оруулдаг —
        /// гараар хэмжээс тавихад Revit-ийн өөрийн ашигладаг лавлагаанууд (дээрх тайлбарыг үз).
        /// </summary>
        public static GeometryElement ViewGeometry(Rebar rebar, View view)
        {
            try { return rebar.get_Geometry(new Options { ComputeReferences = true, View = view, IncludeNonVisibleObjects = true }); }
            catch { return null; }
        }

        public static GeometryElement FineGeometry(Rebar rebar)
        {
            try { return rebar.get_Geometry(new Options { ComputeReferences = true, DetailLevel = ViewDetailLevel.Fine }); }
            catch { return null; }
        }

        /// <summary>
        /// Хомутын (бар индекс <c>r.StirrupBarIndex</c>) шулуун ирмэг/шугам, хэмжих тэнхлэгт <c>r.Pos</c> (локал) дээр, харагдацын хавтгайд
        /// параллель, хомутын хүрээнд — Reference.  Олдохгүй бол null (<paramref name="stats"/> нь юуг үзсэнийг хэлнэ).
        ///
        /// Дараалал: (1) харагдацын геометр, ширхгийн индекс ТААРСАН; (2) Fine геометр, индекс таарсан; (3) харагдацын геометр, индексгүй —
        /// огтлолын проекцолсон дүрслэлийн лавлагаа индекс 0-ийг буцаадаг тул (хэмжсэн).  Байрлал/хүрээний шалгалт гурван шатанд ИЖИЛ, дуудагч
        /// түр хэмжээсээр (trial) утгыг дахин батална.
        /// </summary>
        public static Reference FindLineReference(RfRenderContext c, Rebar rebar, RfChainRef r, out Stats stats)
        {
            stats = new Stats();
            try
            {
                if (rebar.NumberOfBarPositions > RfRenderCaps.NativeSetCap) return null;
            }
            catch { }
            GeometryElement byView = ViewGeometry(rebar, c.View);
            Reference found = byView == null ? null : Walk(c, rebar, r, byView, stats, false);
            if (found != null) return found;
            GeometryElement fine = FineGeometry(rebar);
            found = fine == null ? null : Walk(c, rebar, r, fine, stats, false);
            if (found != null) return found;
            return byView == null ? null : Walk(c, rebar, r, byView, stats, true);
        }

        /// <summary>
        /// «Тэнхлэг» горим: хомутын цилиндр нүүрний лавлагаа (цилиндрийн тэнхлэг хэмжих чиглэлд перпендикуляр, ХЭМЖИХ ТЭНХЛЭГТ <c>r.Pos</c> дээр).
        /// Revit цилиндр нүүрэнд хэмжээс тавивал тэнхлэгийг хэмждэг гэж ТААМАГЛАСАН — зөвхөн дуудагчийн утгын шалгалт (trial) баталгаажуулна.
        /// </summary>
        public static Reference FindAxisReference(RfRenderContext c, Rebar rebar, RfChainRef r, Stats stats)
        {
            try
            {
                if (rebar.NumberOfBarPositions > RfRenderCaps.NativeSetCap) return null;
                // ⚠️ Options.View ба DetailLevel ХАМТ тавивал InvalidOperationException (Revit-ийн баримт) — зөвхөн DetailLevel.
                var opt = new Options { ComputeReferences = true, DetailLevel = ViewDetailLevel.Fine };
                GeometryElement ge = rebar.get_Geometry(opt);
                if (ge == null) return null;
                foreach (GeometryObject go in ge)
                {
                    Solid s = go as Solid;
                    if (s == null) continue;
                    foreach (Face f in s.Faces)
                    {
                        CylindricalFace cf = f as CylindricalFace;
                        if (cf == null) continue;
                        stats.Cylinders++;
                        Reference cr = null;
                        try { cr = cf.Reference; }
                        catch { cr = null; }
                        if (cr == null) continue;
                        stats.WithReference++;
                        int bar;
                        try { bar = rebar.GetBarIndexFromReference(cr); }
                        catch { bar = -1; }
                        if (bar != r.StirrupBarIndex) continue;

                        // Цилиндрийн тэнхлэг хэмжих чиглэлд перпендикуляр (босоо хэмжээсэд босоо) байх ёстой.
                        RfV2 axis = c.Frame.ToLocal(c.Ctx.AnnotFrame.ToViewVec(RfConv.V(cf.Axis).Normalized()));
                        double len = axis.Length;
                        if (len < RfTol.ParallelCos) continue; // тэнхлэг харагдацын хавтгайд биш
                        double along = r.AlongU ? Math.Abs(axis.Y) : Math.Abs(axis.X);
                        if (along / len < RfTol.ParallelCos) continue;

                        RfV2 o = c.Frame.ToLocal(c.Ctx.AnnotFrame.ToView(RfConv.V(cf.Origin)));
                        double pos = r.AlongU ? o.X : o.Y;
                        if (Math.Abs(pos - r.Pos) > RfTol.DimMatchFt) continue;
                        stats.InPosition++;
                        return cr;
                    }
                }
            }
            catch
            {
                // Геометр/лавлагаа авч чадсангүй.
            }
            return null;
        }

        /// <param name="anyBar">true = ширхгийн индексийг тулгахгүй (огтлолын проекцолсон дүрслэл — <see cref="FindLineReference"/>).</param>
        private static Reference Walk(RfRenderContext c, Rebar rebar, RfChainRef r, GeometryElement ge, Stats stats, bool anyBar)
        {
            foreach (GeometryObject go in ge)
            {
                Solid s = go as Solid;
                if (s != null)
                {
                    foreach (Edge e in s.Edges)
                    {
                        Line ln = null;
                        try { ln = e.AsCurve() as Line; }
                        catch { ln = null; }
                        if (ln == null) continue;
                        stats.Lines++;
                        Reference er = null;
                        try { er = e.Reference; }
                        catch { er = null; }
                        if (er == null) continue;
                        stats.WithReference++;
                        if (Matches(c, rebar, r, ln, er, stats, anyBar)) return er;
                    }
                    continue;
                }

                Line l = go as Line;
                if (l != null)
                {
                    stats.Lines++;
                    Reference lr = null;
                    try { lr = l.Reference; }
                    catch { lr = null; }
                    if (lr == null) continue;
                    stats.WithReference++;
                    if (Matches(c, rebar, r, l, lr, stats, anyBar)) return lr;
                    continue;
                }

                GeometryInstance gi = go as GeometryInstance;
                if (gi != null)
                {
                    GeometryElement sub = null;
                    // Revit-ийн баримт: GetInstanceGeometry нь хуулбар — түүний Reference хэмжээс тавихад тохирохгүй.  Symbol геометр (трансформгүй).
                    try { sub = gi.GetSymbolGeometry(); }
                    catch { sub = null; }
                    if (sub != null)
                    {
                        Reference found = Walk(c, rebar, r, sub, stats, anyBar);
                        if (found != null) return found;
                    }
                }
            }
            return null;
        }

        private static bool Matches(RfRenderContext c, Rebar rebar, RfChainRef r, Line ln, Reference reference, RfRebarRefs.Stats stats, bool anyBar)
        {
            // Тухайн хомутын ширхгээс (олонлогийн бусад ширхгийн ирмэг БИШ).  Огтлолын проекцолсон дүрслэлийн лавлагаа индекс 0-ийг буцаадаг тул
            // (хэмжсэн) тэр шатанд (anyBar) индексийг тулгахгүй — лавлагаа энэ арматурын геометрээс, байрлал/хүрээ доор ижил шалгагдана.
            if (!anyBar)
            {
                int bar;
                try { bar = rebar.GetBarIndexFromReference(reference); }
                catch { bar = -1; }
                if (bar >= 0 ? bar != r.StirrupBarIndex : !SingleBar(rebar)) return false;
            }

            RfV3 a = RfConv.V(ln.GetEndPoint(0)), b = RfConv.V(ln.GetEndPoint(1));
            RfV3 d = b - a;
            double len = d.Length;
            if (len < RfTol.PointFt) return false;

            // Харагдацын хавтгайд параллель (хавтгайн нормалиар урсах шугам — цилиндрийн төгсгөлийн нум г.м. — биш).
            if (c.Ctx.AnnotFrame.ToViewVec(d).Length / len < RfTol.ParallelCos) return false;

            RfV2 la = c.Frame.ToLocal(c.Ctx.AnnotFrame.ToView(a));
            RfV2 lb = c.Frame.ToLocal(c.Ctx.AnnotFrame.ToView(b));
            double pa = r.AlongU ? la.X : la.Y, pb = r.AlongU ? lb.X : lb.Y;
            // Хэмжих тэнхлэгт хоёр үзүүр хүлээсэн ирмэгийн координат дээр (шугам нүүртэй параллель, зөв байрлалд).
            if (Math.Abs(pa - r.Pos) > RfTol.DimMatchFt || Math.Abs(pb - r.Pos) > RfTol.DimMatchFt) return false;

            // Шугамын сунаж буй хэсэг хомутын энэ талын хүрээнд.
            double ca = r.AlongU ? la.Y : la.X, cb = r.AlongU ? lb.Y : lb.X;
            double lo = Math.Min(r.SpanMin, r.SpanMax) - RfTol.DimMatchFt, hi = Math.Max(r.SpanMin, r.SpanMax) + RfTol.DimMatchFt;
            if (!(ca >= lo && ca <= hi && cb >= lo && cb <= hi)) return false;
            stats.InPosition++;
            return true;
        }

        private static bool SingleBar(Rebar rebar)
        {
            try { return rebar.NumberOfBarPositions <= 1; }
            catch { return false; }
        }
    }

    /// <summary>Нэг гинжин хэмжээсийн үр дүн.</summary>
    internal sealed class RfChainOutcome
    {
        public RfDimChain Chain;
        public bool Created;

        /// <summary>Төлөвлөсөн / бодитоор ашигласан лавлагааны тоо; сегментийн тоо (n лавлагаа ⇒ n − 1).</summary>
        public int RefsPlanned, RefsUsed, Segments;

        /// <summary>Лавлагаа нь олдоогүй (эсвэл утга таараагүй) тул гинжнээс хасагдсан талууд.</summary>
        public readonly List<RfSide> MissingSides = new List<RfSide>();

        public readonly List<string> Reasons = new List<string>();

        /// <summary>Төлөвлөсөн БҮХ лавлагаатай бүрэн гинж үүссэн.</summary>
        public bool Complete { get { return Created && RefsUsed == RefsPlanned; } }
    }

    /// <summary>Гишүүний гадна гинжийн (тэнхлэг, хучилт, хана) үр дүн.</summary>
    internal sealed class RfMemberOutcome
    {
        public RfMemberChain Chain;
        public bool Created;
        public int Segments, Grids, Neighbors;

        /// <summary>Бүх лавлагаагаар бүтээгүй — хөршийн (хучилт/хана) нүүрийг хассан хувилбараар үүссэн.</summary>
        public bool DroppedNeighbors;
        public readonly List<string> Reasons = new List<string>();
    }

    /// <summary>
    /// RENDER шат: гинжин хэмжээс (<see cref="RfDimChain"/>) ба tag-ийг Revit-д үүсгэнэ.
    ///
    /// ⚠️ ХЭМЖЭЭС ЗӨВХӨН арматурын БОДИТ геометрийн Reference + бетон нүүрний Reference-аар.  Лавлагаа олдохгүй бол ХУУРАМЧ
    /// лавлагаа (нэмэлт шугам, үл үзэгдэх гэх мэт) үүсгэхгүй, тэр талыг алгасаж «Арматурын хэмжээсийн лавлагаа олдсонгүй.» гэж мэдэгдэнэ —
    /// буруу/төөрөгдүүлэх зураг тавихаас дутуу хэмжээс дээр.
    /// </summary>
    internal static class RfSectionRenderer
    {
        private sealed class Resolved
        {
            public RfChainRef Info;
            public Reference Ref;
        }

        public static List<RfChainOutcome> RenderChains(RfRenderContext c, RfSectionPlan plan)
        {
            var outcomes = new List<RfChainOutcome>();
            foreach (RfDimChain chain in plan.Chains)
            {
                var o = new RfChainOutcome { Chain = chain, RefsPlanned = chain.Refs.Count };
                outcomes.Add(o);
                if (!chain.IsValid)
                {
                    o.Reasons.Add(RfText.CoverTooSmall);
                    continue;
                }
                try
                {
                    RenderChain(c, chain, o);
                }
                catch (Exception ex)
                {
                    o.Created = false;
                    o.Reasons.Add(ex.Message);
                }
            }
            return outcomes;
        }

        /// <summary>
        /// Гишүүний гадна гинж: нүүр + тэнхлэг + хучилт/ханын нүүр → НЭГ Dimension; сегмент бүрийн утгыг хүлээсэнтэй тулгана.  Revit бүтээж/тулгаж чадахгүй бол
        /// хучилт/ханын нүүрийг хасаж (нүүр + тэнхлэг) дахин оролдоно — буруу утгатай хэмжээс ХЭЗЭЭ Ч үлдэхгүй.
        /// </summary>
        public static List<RfMemberOutcome> RenderMemberChains(RfRenderContext c, RfSectionPlan plan)
        {
            var outcomes = new List<RfMemberOutcome>();
            foreach (RfMemberChain chain in plan.MemberChains)
            {
                var o = new RfMemberOutcome { Chain = chain };
                outcomes.Add(o);
                bool hasStirrup = plan.Chains.Any(x => x.AlongU == chain.AlongU && x.IsValid);
                var attempts = new List<List<RfMemberRef>> { chain.Refs.ToList() };
                if (chain.Neighbors > 0)
                    attempts.Add(RfMemberDims.Dedupe(chain.Refs.Where(r => r.Kind != RfMemberRefKind.Neighbor)));
                for (int k = 0; k < attempts.Count && !o.Created; k++)
                {
                    List<RfMemberRef> refs = attempts[k];
                    if (refs.Count < 2 || (hasStirrup && refs.Count < 3))
                    {
                        if (k > 0) o.Reasons.Add(RfText.MemberNothingLeft);
                        continue;
                    }
                    string why;
                    Dimension d = TryMember(c, chain, refs, out why);
                    if (d == null)
                    {
                        o.Reasons.Add(why);
                        continue;
                    }
                    c.Created.Add(d.Id);
                    o.Created = true;
                    o.Segments = refs.Count - 1;
                    o.Grids = refs.Count(r => r.Kind == RfMemberRefKind.Grid);
                    o.Neighbors = refs.Count(r => r.Kind == RfMemberRefKind.Neighbor);
                    o.DroppedNeighbors = k > 0;
                }
            }
            return outcomes;
        }

        private static Dimension TryMember(RfRenderContext c, RfMemberChain chain, List<RfMemberRef> refs, out string why)
        {
            why = null;
            var ra = new ReferenceArray();
            foreach (RfMemberRef r in refs)
            {
                Reference rf;
                bool ok = r.Kind == RfMemberRefKind.HostFace ? c.Ctx.FaceRefs.TryGetValue(r.Id, out rf) : c.Ctx.AuxRefs.TryGetValue(r.Id, out rf);
                if (!ok || rf == null)
                {
                    why = RfText.NoReference;
                    return null;
                }
                ra.Append(rf);
            }
            double p0 = refs[0].Pos, p1 = refs[refs.Count - 1].Pos;
            RfV2 a = chain.AlongU ? new RfV2(p0, chain.LinePos) : new RfV2(chain.LinePos, p0);
            RfV2 b = chain.AlongU ? new RfV2(p1, chain.LinePos) : new RfV2(chain.LinePos, p1);
            using (var st = new SubTransaction(c.Doc))
            {
                st.Start();
                try
                {
                    Line line = Line.CreateBound(c.Model(a), c.Model(b));
                    Dimension d = c.DimType != null ? c.Doc.Create.NewDimension(c.View, line, ra, c.DimType) : c.Doc.Create.NewDimension(c.View, line, ra);
                    if (d == null) throw new InvalidOperationException(RfText.NoReference);
                    string typeWhy;
                    if (!global::RevitMcpAddin.AutoAnnotate.AaDimType.Enforce(d, c.DimType, out typeWhy))
                    {
                        st.RollBack();
                        why = typeWhy;
                        return null;
                    }
                    c.Doc.Regenerate();
                    string bad = RfElevationService.VerifySegments(d, refs.Select(r => r.Pos).ToList());
                    if (bad != null)
                    {
                        st.RollBack();
                        why = bad;
                        return null;
                    }
                    st.Commit();
                    return d;
                }
                catch (Exception ex)
                {
                    if (st.HasStarted() && !st.HasEnded()) st.RollBack();
                    why = ex.Message.Split('\n')[0].Trim().TrimEnd('.');
                    return null;
                }
            }
        }

        private static void RenderChain(RfRenderContext c, RfDimChain chain, RfChainOutcome o)
        {
            // 1. Тал бүрийн лавлагааг (нүүр + хомутын ирмэг) бодит геометрээс олно.  Нэг тал тасрах (лавлагаа олдохгүй / утга таарахгүй) бол
            //    ТЭР талын нүүр + хомутыг хамт хасна (нүүр нь өөр хомутын ирмэгтэй хольж «найруулсан» сегмент үүсгэхгүйн тулд).
            var kept = new List<Resolved>();
            foreach (RfSide side in chain.Refs.Select(r => r.Side).Distinct().ToList())
            {
                RfChainRef faceInfo = chain.Refs.FirstOrDefault(r => r.Kind == RfChainRefKind.Face && r.Side == side);
                RfChainRef stirInfo = chain.Refs.FirstOrDefault(r => r.Kind == RfChainRefKind.Stirrup && r.Side == side);

                Reference faceRef = null;
                if (faceInfo != null && !c.Ctx.FaceRefs.TryGetValue(faceInfo.FaceId, out faceRef)) faceRef = null;

                if (stirInfo == null)
                {
                    // Нүүр ба хомутын ирмэг давхцсан (cover ≈ 0) — хомутын лавлагаа хасагдсан, нүүр нь хомутын ирмэгийн оронд.
                    if (faceInfo != null && faceRef != null) kept.Add(new Resolved { Info = faceInfo, Ref = faceRef });
                    else
                    {
                        // Нүүрний лавлагаа ч олдоогүй — чимээгүй алдахгүй, шалтгаантай хасна.
                        o.MissingSides.Add(side);
                        o.Reasons.Add(RfText.SideName(side) + ": " + RfText.NoFaceReference);
                    }
                    continue;
                }

                string why;
                Reference stirRef = ResolveStirrup(c, stirInfo, out why);
                if (faceRef == null)
                {
                    o.MissingSides.Add(side);
                    o.Reasons.Add(RfText.SideName(side) + ": " + RfText.NoFaceReference);
                    continue;
                }
                if (stirRef == null)
                {
                    o.MissingSides.Add(side);
                    o.Reasons.Add(RfText.SideName(side) + ": " + why);
                    continue;
                }
                // Утгын шалгалт (trial): энэ хоёр лавлагаагаар хэмжээс үүсгээд ХҮЛЭЭСЭН зайтай таарч байгааг батлаад БУЦААНА.
                string trialWhy;
                if (!TrialPair(c, chain, faceInfo, faceRef, stirInfo, stirRef, out trialWhy))
                {
                    o.MissingSides.Add(side);
                    o.Reasons.Add(RfText.SideName(side) + ": " + trialWhy);
                    continue;
                }
                kept.Add(new Resolved { Info = faceInfo, Ref = faceRef });
                kept.Add(new Resolved { Info = stirInfo, Ref = stirRef });
            }

            // Байрлалаар (хэмжих тэнхлэгийн дагуу) эрэмбэлнэ — ElementId / геометр туулсан дарааллаар БИШ.
            List<Resolved> ordered = kept.OrderBy(k => k.Info.Pos).ThenBy(k => (int)k.Info.Kind).ToList();
            if (ordered.Count < 2 || !ordered.Any(k => k.Info.Kind == RfChainRefKind.Stirrup))
            {
                o.Reasons.Insert(0, RfText.NoRebarRef);
                return;
            }

            // 2. НЭГ Dimension (олон reference, олон сегмент).
            using (var st = new SubTransaction(c.Doc))
            {
                st.Start();
                try
                {
                    var ra = new ReferenceArray();
                    foreach (Resolved k in ordered) ra.Append(k.Ref);
                    Line line = DimLineFor(c, chain, ordered[0].Info.Pos, ordered[ordered.Count - 1].Info.Pos);
                    Dimension d = c.DimType != null
                        ? c.Doc.Create.NewDimension(c.View, line, ra, c.DimType)
                        : c.Doc.Create.NewDimension(c.View, line, ra);
                    // Revit-ийн баримт: хэмжээс үүсгэж чадаагүй бол null.
                    if (d == null) throw new InvalidOperationException(RfText.NoReference);

                    // Сонгосон хэмжээсийн төрлөөр үүссэнийг баталгаажуулна — өөр төрлөөр чимээгүй үлдэхгүй.
                    string typeWhy;
                    if (!global::RevitMcpAddin.AutoAnnotate.AaDimType.Enforce(d, c.DimType, out typeWhy))
                    {
                        st.RollBack();
                        o.Reasons.Add(typeWhy);
                        return;
                    }

                    // Regenerate-ийн алдааг НЭЛЭЭХГҮЙ — доорх catch буцааж шалтгааныг тайланд бичнэ.
                    c.Doc.Regenerate();
                    string verifyWhy;
                    if (!VerifyChain(d, ordered, out verifyWhy))
                    {
                        st.RollBack();
                        o.Reasons.Add(verifyWhy);
                        return;
                    }
                    st.Commit();
                    c.Created.Add(d.Id);
                    o.Created = true;
                    o.RefsUsed = ordered.Count;
                    o.Segments = ordered.Count - 1;
                }
                catch (Exception ex)
                {
                    if (st.HasStarted() && !st.HasEnded()) st.RollBack();
                    o.Reasons.Add(ex.Message);
                }
            }
        }

        /// <summary>
        /// Хомутын нэг ирмэгийн БОДИТ Reference: «Тэнхлэг» горимд цилиндр нүүр (эсвэл тэнхлэгийн шугам), «Гадна/Дотор»-д хүлээсэн физик ирмэгийн
        /// байрлал дахь шулуун ирмэг.  Олдохгүй бол null + шалтгаан.
        /// </summary>
        private static Reference ResolveStirrup(RfRenderContext c, RfChainRef r, out string why)
        {
            why = null;
            Rebar rebar;
            if (!c.Ctx.Rebars.TryGetValue(r.StirrupId, out rebar))
            {
                why = RfText.NoRebarRef + " (" + RfText.NoReference + ")";
                return null;
            }
            try
            {
                if (rebar.NumberOfBarPositions > RfRenderCaps.NativeSetCap)
                {
                    why = RfText.NoRebarRef + " (" + RfText.SetTooLarge + ")";
                    return null;
                }
            }
            catch { }

            // Шугамын лавлагаа ЭХЛЭЭД (гурван горимд): огтлол дээр Revit тэнхлэгийн ч (1100xxx), ирмэгийн ч далд шугамыг өгдөг (хэмжсэн).
            // Цилиндрийн нүүр нь зөвхөн «Тэнхлэг» горимын нөөц — түүнд хэмжээс тавихад Revit тэнхлэгийг хэмждэг гэдэг нь ТААМАГ.
            var axisStats = new RfRebarRefs.Stats();
            RfRebarRefs.Stats lineStats;
            Reference found = RfRebarRefs.FindLineReference(c, rebar, r, out lineStats);
            if (found == null && r.Ref == RfStirrupRef.Center) found = RfRebarRefs.FindAxisReference(c, rebar, r, axisStats);
            if (found == null)
            {
                string diag = (r.Ref == RfStirrupRef.Center ? RfText.CylinderStats(axisStats.ToString()) + "; " : string.Empty) + lineStats;
                why = RfText.NoRebarRef + " (" + diag + ")" + (r.Ref == RfStirrupRef.Center ? string.Empty : " " + RfText.TryCenterHint);
                return null;
            }
            return found;
        }

        /// <summary>
        /// Нэг талын (нүүр ↔ хомутын ирмэг) түр хэмжээсийг үүсгэж, БОДИТ утгыг хүлээсэн зайтай (0.5 мм) тулгана, ЗАВАЛ буцаана (үлдээхгүй).
        /// Лавлагаа буруу ирмэг/тэнхлэгийг заасан бол (Revit тэнхлэгийг хэмжсэн г.м.) энд баригдана — буруу хэмжээс гинжинд орохгүй.
        /// </summary>
        private static bool TrialPair(RfRenderContext c, RfDimChain chain, RfChainRef faceInfo, Reference faceRef,
            RfChainRef stirInfo, Reference stirRef, out string why)
        {
            why = null;
            double expected = Math.Abs(stirInfo.Pos - faceInfo.Pos);
            if (expected < RfTol.DimMatchFt)
            {
                why = RfText.CoverTooSmall;
                return false;
            }
            using (var st = new SubTransaction(c.Doc))
            {
                st.Start();
                try
                {
                    var ra = new ReferenceArray();
                    if (faceInfo.Pos <= stirInfo.Pos)
                    {
                        ra.Append(faceRef);
                        ra.Append(stirRef);
                    }
                    else
                    {
                        ra.Append(stirRef);
                        ra.Append(faceRef);
                    }
                    Line line = DimLineFor(c, chain, Math.Min(faceInfo.Pos, stirInfo.Pos), Math.Max(faceInfo.Pos, stirInfo.Pos));
                    Dimension d = c.DimType != null
                        ? c.Doc.Create.NewDimension(c.View, line, ra, c.DimType)
                        : c.Doc.Create.NewDimension(c.View, line, ra);
                    if (d == null)
                    {
                        st.RollBack();
                        why = RfText.NoRebarRef + " (" + RfText.NoReference + ")";
                        return false;
                    }
                    c.Doc.Regenerate();
                    double actual;
                    bool ok = ReadSingleValue(d, out actual) && Math.Abs(actual - expected) <= RfTol.DimMatchFt;
                    st.RollBack(); // ТҮР: хэзээ ч үлдээхгүй
                    if (!ok) why = RfText.NoRebarRef + " (" + RfText.ValueMismatch(actual, expected) + ")";
                    return ok;
                }
                catch (Exception ex)
                {
                    if (st.HasStarted() && !st.HasEnded()) st.RollBack();
                    why = RfText.NoRebarRef + " (" + ex.Message + ")";
                    return false;
                }
            }
        }

        private static Line DimLineFor(RfRenderContext c, RfDimChain chain, double fromPos, double toPos)
        {
            RfV2 a = chain.AlongU ? new RfV2(fromPos, chain.LinePos) : new RfV2(chain.LinePos, fromPos);
            RfV2 b = chain.AlongU ? new RfV2(toPos, chain.LinePos) : new RfV2(chain.LinePos, toPos);
            return Line.CreateBound(c.Model(a), c.Model(b));
        }

        private static bool ReadSingleValue(Dimension d, out double value)
        {
            value = double.NaN;
            object raw = d.Value; // double? (Revit-ийн баримт: олон сегменттэй хэмжээсэд утгагүй)
            if (raw == null) return false;
            value = (double)raw;
            return true;
        }

        /// <summary>
        /// Үүссэн хэмжээсийн БОДИТ бүтцийг шалгана: reference-ийн тоо, сегментийн тоо (n лавлагаа ⇒ n − 1), сегмент бүрийн утга = дараалсан
        /// лавлагааны байрлалын зөрүү (0.5 мм).  Таарахгүй бол false (дуудагч буцаана).
        /// </summary>
        private static bool VerifyChain(Dimension d, List<Resolved> refs, out string why)
        {
            why = null;
            int n = refs.Count;
            var expected = new List<double>();
            for (int i = 0; i + 1 < n; i++) expected.Add(refs[i + 1].Info.Pos - refs[i].Info.Pos);

            ReferenceArray dr = d.References;
            if (dr != null && dr.Size != n)
            {
                why = RfText.ChainReferenceCount(dr.Size, n);
                return false;
            }

            if (n == 2)
            {
                double actual;
                if (!ReadSingleValue(d, out actual) || Math.Abs(actual - expected[0]) > RfTol.DimMatchFt)
                {
                    why = RfText.ValueMismatch(actual, expected[0]);
                    return false;
                }
                return true;
            }

            int segCount = d.NumberOfSegments;
            if (segCount != n - 1)
            {
                why = RfText.ChainSegmentCount(segCount, n - 1);
                return false;
            }
            int k = 0;
            foreach (DimensionSegment seg in d.Segments)
            {
                object raw = seg.Value;
                if (raw == null)
                {
                    why = RfText.ChainSegmentValue(k + 1, double.NaN, expected[k]);
                    return false;
                }
                double v = (double)raw;
                if (Math.Abs(v - expected[k]) > RfTol.DimMatchFt)
                {
                    why = RfText.ChainSegmentValue(k + 1, v, expected[k]);
                    return false;
                }
                k++;
            }
            return true;
        }

        // ── Tag ────────────────────────────────────────────────────────

        /// <summary>Tag-ийн төрөл Structural Rebar Tag мөн эсэх (ангилалаар).</summary>
        public static bool IsRebarTagType(FamilySymbol fs)
        {
            try { return fs != null && fs.Category != null && fs.Category.Id.Value == (long)BuiltInCategory.OST_RebarTags; }
            catch { return false; }
        }

        /// <summary>
        /// IndependentTag-ууд.  Tag бүр арматурын Reference-д холбогдсон (associative); бичвэр нь инженерийн tag family-аас.
        ///
        /// ХАМГААЛАЛТ (tag «үүсэхгүй» гэсэн алдаа): (1) сонгосон төрөл заавал Structural Rebar Tag; (2) tag-ийн ангилал энэ харагдацад нуугдсан бол
        /// үүсгэхгүй (үүсвэл харагдахгүй — чимээгүй «амжилт» болохгүй); (3) tag-ийн family-г ЭХЛЭЭД идэвхжүүлж <c>Regenerate</c> хийнэ;
        /// (4) үүссэний ДАРАА tag бодитоор арматурт холбогдсон эсэхийг (<c>GetTaggedLocalElementIds</c>) шалгана; (5) бүх алдаа ИЛ тайланд.
        ///
        /// ⚠️ `IndependentTag.Create(..., addLeader: true, ..., pnt)`-ийн `pnt` нь Revit-ийн баримтаар толгойн БИШ, LEADER-ИЙН
        /// ТӨГСГӨЛИЙН цэг.  Иймд `pnt` = арматурын цэг (Target), дараа нь толгойг `TagHeadPosition`-оор зөөнө, leader-ийн төгсгөлийг
        /// ЧӨЛӨӨТЭЙ болгоно (олонлогийн ЯГ тэр ширхэгт).  Эдгээр алхам унавал tag хэвээр (leader нь арматур дээр холбогдсон) — гэхдээ ИЛ мэдэгдэнэ.
        /// </summary>
        public static int RenderTags(RfRenderContext c, RfSectionPlan plan, ElementId mainTypeId, ElementId stirrupTypeId,
            List<string> failures, List<string> notes)
        {
            if (plan.Tags.Count == 0) return 0;

            // Tag-ийн ангилал энэ харагдацад нуугдсан бол tag үүсгэх нь утгагүй (үүссэн ч харагдахгүй).
            try
            {
                if (c.View.GetCategoryHidden(new ElementId(BuiltInCategory.OST_RebarTags)))
                {
                    failures.Add(RfText.TagCategoryHidden);
                    return 0;
                }
            }
            catch
            {
                // Ангилал нуугдах эсэх уншигдахгүй — үргэлжлүүлнэ.
            }

            // Төрөл бүрийг ЭХЛЭЭД шалгаж, идэвхжүүлнэ (нэг удаа), дараа нь Regenerate.
            var usable = new Dictionary<long, FamilySymbol>();
            bool activated = false;
            foreach (bool stirrup in new[] { false, true })
            {
                if (!plan.Tags.Any(t => t.IsStirrup == stirrup)) continue;
                ElementId typeId = stirrup ? stirrupTypeId : mainTypeId;
                if (typeId == null || typeId == ElementId.InvalidElementId)
                {
                    string noType = RfText.NoTagType(stirrup);
                    if (!failures.Contains(noType)) failures.Add(noType);
                    continue;
                }
                if (usable.ContainsKey(typeId.Value)) continue;
                FamilySymbol fs = c.Doc.GetElement(typeId) as FamilySymbol;
                if (fs == null || !IsRebarTagType(fs))
                {
                    string notRebar = RfText.TagTypeNotForRebar;
                    if (!failures.Contains(notRebar)) failures.Add(notRebar);
                    continue;
                }
                if (!fs.IsActive)
                {
                    try
                    {
                        fs.Activate();
                        activated = true;
                    }
                    catch (Exception ex)
                    {
                        failures.Add(RfText.TagTypeActivateFailed(fs.Name, ex.Message));
                        continue;
                    }
                }
                usable[typeId.Value] = fs;
            }
            if (activated)
            {
                try { c.Doc.Regenerate(); }
                catch (Exception ex)
                {
                    failures.Add(RfText.TagFailedGeneral(ex.Message));
                    return 0;
                }
            }

            int made = 0;
            double landingFt = c.PaperToFt(c.LeaderLandingMm), runFt = c.PaperToFt(c.LeaderRunMm);
            bool shapeLeaders = c.LeaderLandingMm > 0 || c.LeaderRunMm > 0;
            foreach (RfTagPlan t in plan.Tags)
            {
                ElementId typeId = t.IsStirrup ? stirrupTypeId : mainTypeId;
                if (typeId == null || typeId == ElementId.InvalidElementId || !usable.ContainsKey(typeId.Value)) continue;
                Rebar rebar;
                if (!c.Ctx.Rebars.TryGetValue(t.Id, out rebar))
                {
                    failures.Add(RfText.TagNoRebar(t.Id.ToString()));
                    continue;
                }
                // Шошгоны БОДИТ өргөн (3→2 зайг шошгоны ирмэгээс хэмжихэд) — нээлттэй SubTransaction-ий ГАДНА хэмжинэ.
                double measuredWidth = -1;
                if (shapeLeaders)
                {
                    bool multiProbe = !t.IsStirrup && t.BarIndices.Count >= 2;
                    measuredWidth = RfLeaderPlacer.MeasureWidth(c.Doc, c.View, typeId, RfRebarRefs.TagReferences(rebar, multiProbe ? t.BarIndices[0] : 0, multiProbe), c.Model(t.Head));
                }
                using (var st = new SubTransaction(c.Doc))
                {
                    st.Start();
                    try
                    {
                        XYZ head = c.Model(t.Head);
                        XYZ target = c.Model(t.Target);
                        // Хэрэглэгчийн заасан 3→2 / 2→1 зай: шошго (хоёулаа заасан бол) зөөгдөж, elbow-ийн байрлал гарна.
                        XYZ elbowPt = null;
                        if (shapeLeaders)
                        {
                            XYZ headPlanned = head;
                            string shapeNote;
                            if (RfLeaderPlacer.Plan(c.View, target, headPlanned, measuredWidth > 0 ? measuredWidth : t.Width, landingFt, runFt, out head, out elbowPt, out shapeNote)
                                && shapeNote != null)
                                notes.Add("Шошго (арматур " + t.Id + "): " + shapeNote);
                        }
                        // Reference нэр дэвшигчид: элемент (огтлолд ажилладаг) → дэд-элемент (дэлгээсэд хэмжсэн, `RfRebarRefs.TagReferences`).
                        Reference reference = null;
                        IndependentTag tag = null;
                        Exception createEx = null;
                        // Multi-leader шошго: ширхэг бүр өөрийн дэд-элементийн лавлагаатай тул ЭХНИЙ ширхгээр дэд-элементийн лавлагааг түрүүлж оролдоно.
                        bool multi = !t.IsStirrup && t.BarIndices.Count >= 2;
                        foreach (Reference cand in RfRebarRefs.TagReferences(rebar, multi ? t.BarIndices[0] : 0, multi))
                        {
                            try
                            {
                                tag = IndependentTag.Create(c.Doc, typeId, c.View.Id, cand, true, TagOrientation.Horizontal, target);
                                reference = cand;
                                break;
                            }
                            catch (Exception ex)
                            {
                                createEx = ex;
                            }
                        }
                        if (tag == null) throw createEx ?? new InvalidOperationException("IndependentTag.Create → null");

                        // Үүссэн tag ЯГ сонгосон төрөлтэй, ЭНЭ харагдацад мөн эсэх (хатуу).  Арматурт холбогдсон эсэх нь Revit-ийн баримтаар (олонлогийн
                        // reference-д юу буцаахыг) тодорхойгүй тул ЗӨВХӨН мэдэгдэл — үнэн tag-ийг буруу буцаахгүй.
                        string soft;
                        string hard = VerifyTag(c, tag, rebar, typeId, out soft);
                        if (hard != null)
                        {
                            st.RollBack();
                            failures.Add(RfText.TagFailed(t.Id.ToString(), hard));
                            continue;
                        }
                        if (soft != null && !notes.Contains(soft)) notes.Add(soft);

                        string leaderProblem = null;
                        try { tag.TagHeadPosition = head; }
                        catch (Exception ex) { leaderProblem = ex.Message; }
                        try
                        {
                            tag.LeaderEndCondition = LeaderEndCondition.Free;
                            IList<Reference> tagged = tag.GetTaggedReferences();
                            Reference tr = tagged != null && tagged.Count > 0 ? tagged[0] : reference;
                            tag.SetLeaderEnd(tr, target);
                        }
                        catch (Exception ex)
                        {
                            leaderProblem = leaderProblem ?? ex.Message;
                        }
                        if (leaderProblem != null)
                            notes.Add(RfText.TagLeaderNote(t.Id.ToString(), leaderProblem));

                        if (multi) AddSetLeaders(c, tag, rebar, t, notes);

                        if (elbowPt != null)
                        {
                            try { c.Doc.Regenerate(); }
                            catch { /* regenerate амжилтгүй — elbow-г шууд оролдоно */ }
                            string elbowProblem = RfLeaderPlacer.Apply(tag, reference, elbowPt);
                            if (elbowProblem != null)
                                notes.Add("Шошго (арматур " + t.Id + "): leader-ийн elbow-г заасан зайгаар тавьж чадсангүй (" + elbowProblem + ") — Revit-ийн автомат elbow-оор үлдлээ.");
                        }

                        st.Commit();
                        c.Created.Add(tag.Id);
                        made++;
                    }
                    catch (Exception ex)
                    {
                        if (st.HasStarted() && !st.HasEnded()) st.RollBack();
                        failures.Add(RfText.TagFailed(t.Id.ToString(), ex.Message));
                    }
                }
            }
            return made;
        }

        /// <summary>
        /// MULTI-LEADER: нэг олонлогийн ЭХНИЙ ширхгээс бусад бүх харагдаж буй ширхгийг ИЖИЛ шошгонд (<c>IndependentTag.AddReferences</c>) нэмж, ширхэг бүрийн
        /// leader-ийн төгсгөлийг тэр ширхэг дээр тавина; <see cref="RfRenderContext.MergeLeaders"/> бол leader-үүдийг нэг ишээр нэгтгэнэ (<c>MergeElbows</c>).
        /// Нэмж чадаагүй ширхэг, нэгтгэж чадаагүй бол шошго хэвээр (нэг leader-тэй) үлдэж ИЛ мэдэгдэнэ — шошго алга болохгүй.
        /// </summary>
        private static void AddSetLeaders(RfRenderContext c, IndependentTag tag, Rebar rebar, RfTagPlan t, List<string> notes)
        {
            string who = t.Id.ToString();
            var extra = new List<Reference>();
            var extraIdx = new List<int>();
            for (int i = 1; i < t.BarIndices.Count; i++)
            {
                try
                {
                    Reference r = Reference.ParseFromStableRepresentation(rebar.Document, rebar.UniqueId + ":" + (2000000 + t.BarIndices[i]) + ":SUBELEMENT");
                    extra.Add(r);
                    extraIdx.Add(i);
                }
                catch
                {
                    // Энэ ширхгийн дэд-элементийн лавлагаа үүсэхгүй — алгасна.
                }
            }
            if (extra.Count == 0)
            {
                notes.Add("Multi-leader (арматур " + who + "): бусад ширхгийн лавлагаа олдсонгүй — нэг leader-тэй үлдлээ.");
                return;
            }
            int added = 0;
            try
            {
                tag.AddReferences(extra);
                added = extra.Count;
            }
            catch (Exception ex)
            {
                // Бүгдийг нэг дор нэмж чадаагүй бол нэг нэгээр нь оролдоно (зарим ширхэг буруу байж болно).
                foreach (Reference r in extra)
                {
                    try { tag.AddReferences(new List<Reference> { r }); added++; }
                    catch { }
                }
                if (added == 0)
                {
                    notes.Add("Multi-leader (арматур " + who + "): ширхгүүдийг нэг шошгонд нэмж чадсангүй (" + ex.Message.Split('\n')[0].Trim().TrimEnd('.') + ") — нэг leader-тэй үлдлээ.");
                    return;
                }
            }

            // Leader-ийн төгсгөл бүрийг ТЭР ширхэг дээр: шошгонд нэмэгдсэн дарааллаар (эхнийх нь аль хэдийн тавигдсан).
            try
            {
                IList<Reference> tagged = tag.GetTaggedReferences();
                int n = Math.Min(tagged == null ? 0 : tagged.Count, 1 + added);
                for (int k = 0; k < n; k++)
                {
                    int planIdx = k == 0 ? 0 : (k - 1 < extraIdx.Count ? extraIdx[k - 1] : -1);
                    if (planIdx < 0 || planIdx >= t.BarTargets.Count) continue;
                    try { tag.SetLeaderEnd(tagged[k], c.Model(t.BarTargets[planIdx])); }
                    catch { /* Leader-ийн төгсгөл зөөгдөхгүй — Revit-ийн өгөгдмөл. */ }
                }
            }
            catch
            {
                // Tagged лавлагаа уншигдахгүй — Revit-ийн өгөгдмөл leader.
            }
            if (c.MergeLeaders)
            {
                try { tag.MergeElbows = true; }
                catch (Exception ex) { notes.Add("Multi-leader (арматур " + who + "): leader нэгтгэж чадсангүй (" + ex.Message.Split('\n')[0].Trim().TrimEnd('.') + ")."); }
            }
            if (1 + added < t.BarIndices.Count)
                notes.Add("Multi-leader (арматур " + who + "): " + t.BarIndices.Count + " ширхгээс " + (1 + added) + "-ийг холбов.");
        }

        /// <summary>
        /// Үүссэн tag зөв эсэх.  Буцаах утга = ХАТУУ алдаа (төрөл/харагдац буруу ⇒ tag буцна), null = зөв; <paramref name="soft"/> = зөвхөн мэдэгдэл
        /// (арматурт холбогдсоныг батлах боломжгүй).  Холбоосыг <c>GetTaggedLocalElementIds</c> БА <c>GetTaggedReferences</c> хоёроор шалгана.
        /// </summary>
        private static string VerifyTag(RfRenderContext c, IndependentTag tag, Rebar rebar, ElementId typeId, out string soft)
        {
            soft = null;
            try
            {
                if (tag.GetTypeId() != typeId) return RfText.TagWrongType;
                if (tag.OwnerViewId != c.View.Id) return RfText.TagWrongView;
            }
            catch
            {
                // Шалгах боломжгүй — tag-ийг хүлээн авна (Create амжилттай болсон).
                return null;
            }
            try
            {
                bool found = false, anyInfo = false;
                ICollection<ElementId> local = tag.GetTaggedLocalElementIds();
                if (local != null && local.Count > 0)
                {
                    anyInfo = true;
                    if (local.Contains(rebar.Id)) found = true;
                }
                IList<Reference> refs = tag.GetTaggedReferences();
                if (!found && refs != null && refs.Count > 0)
                {
                    anyInfo = true;
                    foreach (Reference r in refs)
                    {
                        if (r != null && r.ElementId == rebar.Id)
                        {
                            found = true;
                            break;
                        }
                    }
                }
                if (anyInfo && !found) soft = RfText.TagNotOnRebar;
            }
            catch
            {
                // Холбоосыг уншиж чадсангүй — мэдэгдэхгүй.
            }
            return null;
        }
    }
}
