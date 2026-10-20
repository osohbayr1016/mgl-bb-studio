using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.Reinforcement.Core
{
    public enum RfChainRefKind
    {
        /// <summary>Бетон гишүүний нүүр (host face).</summary>
        Face = 0,
        /// <summary>Хомутын (арматурын) ирмэг / тэнхлэг.</summary>
        Stirrup = 1,
    }

    /// <summary>
    /// Гинжин хэмжээсийн (continuous chain dimension) НЭГ лавлагаа: бетон нүүр эсвэл хомутын ирмэг.
    /// <see cref="Pos"/> нь хэмжих тэнхлэг (хэвтээ гинжид гишүүний U, босоод V) дахь ЛОКАЛ координат (фут) — Revit-ийн Reference-ийг энэ
    /// байрлалаар нь (геометрийн дарааллаар) эрэмбэлнэ; ElementId / collector / геометр туулсан дарааллаар ХЭЗЭЭ Ч БИШ.
    /// </summary>
    public sealed class RfChainRef
    {
        public RfChainRefKind Kind;
        public RfSide Side;

        /// <summary>Хэмжих тэнхлэг дэх локал координат (фут).</summary>
        public double Pos;

        /// <summary><see cref="RfChainRefKind.Face"/>: <see cref="RfFaceSample.Id"/>.</summary>
        public int FaceId = -1;

        /// <summary><see cref="RfChainRefKind.Stirrup"/>: арматурын элемент, олонлогийн ширхэг, голч, лавлагааны төрөл.</summary>
        public long StirrupId;
        public int StirrupBarIndex;
        public double StirrupDiameter;
        public RfStirrupRef Ref;

        /// <summary>Хомутын энэ талын ирмэгийн сунаж буй хүрээ (хөндлөн тэнхлэгт) — бодит ирмэгийн Reference хайхад.</summary>
        public double SpanMin, SpanMax;

        public bool AlongU { get { return Side == RfSide.Left || Side == RfSide.Right; } }
    }

    /// <summary>
    /// Нэг тэнхлэгийн (хэвтээ эсвэл босоо) ГИНЖИН хэмжээс: бетон нүүр → хомутын ирмэг → хомутын ирмэг → бетон нүүр.
    /// Revit-д ЯГ НЭГ <c>Dimension</c> (олон reference, олон сегмент) болно — хэмжээс бүрийг тусад нь БИШ.
    /// </summary>
    public sealed class RfDimChain
    {
        /// <summary>true = хэмжих чиглэл U (Зүүн/Баруун талууд, хэвтээ гинж); false = V (Дээд/Доод, босоо гинж).</summary>
        public bool AlongU;

        /// <summary>Хэмжээсийн шугамын хөндлөн координат (U гинжид v, V гинжид u).</summary>
        public double LinePos;

        /// <summary>Хэмжих тэнхлэгийн дагуу өсөх дарааллаар эрэмбэлсэн, давхардалгүй лавлагаа.</summary>
        public readonly List<RfChainRef> Refs = new List<RfChainRef>();

        /// <summary>Нүүр ба хомутын ирмэг давхцсан (зай ≈ 0) тул гинжнээс хасагдсан хомутын лавлагаа (талаар).</summary>
        public readonly List<RfSide> Coincident = new List<RfSide>();

        public int StirrupRefCount { get { return Refs.Count(r => r.Kind == RfChainRefKind.Stirrup); } }

        /// <summary>Хамгийн багадаа хоёр лавлагаа, тэдний дотор нэг хомутын лавлагаа — үгүй бол энэ нь хомутын хэмжээс биш (зөвхөн бетоны өргөн).</summary>
        public bool IsValid { get { return Refs.Count >= 2 && StirrupRefCount >= 1; } }

        /// <summary>Гинжний сегментийн тоо (n лавлагаа ⇒ n − 1).</summary>
        public int SegmentCount { get { return Refs.Count < 2 ? 0 : Refs.Count - 1; } }

        /// <summary>Сегмент бүрийн хүлээгдэж буй урт (фут): дараалсан лавлагааны байрлалын зөрүү.</summary>
        public List<double> ExpectedSegments()
        {
            var list = new List<double>();
            for (int i = 0; i + 1 < Refs.Count; i++) list.Add(Refs[i + 1].Pos - Refs[i].Pos);
            return list;
        }
    }

    /// <summary>
    /// Талуудын хэмжээсийн төлөвлөгөө (<see cref="RfDimPlan"/>)-өөс ГИНЖИН хэмжээс байгуулна (ЦЭВЭР, тестлэгдсэн).
    /// </summary>
    public static class RfDimChains
    {
        /// <summary>
        /// Хэвтээ (Зүүн/Баруун) ба босоо (Дээд/Доод) тэнхлэг тус бүрд ЯГ НЭГ гинж.  Тэнхлэгт тал сонгогдоогүй бол гинж үүсэхгүй.
        /// Лавлагааг тэнхлэгийн дагуух ЛОКАЛ координатаар эрэмбэлж (бүх талын нүүр + хомутын ирмэг), <paramref name="tolerance"/> дотор давхцсаныг
        /// хасна: нүүр ба хомутын ирмэг давхцвал (cover ≈ 0) нүүр үлдэж, хомутын лавлагаа <see cref="RfDimChain.Coincident"/>-д бүртгэгдэнэ.
        /// </summary>
        public static List<RfDimChain> Build(IList<RfDimPlan> dims, double tolerance)
        {
            var chains = new List<RfDimChain>();
            if (dims == null || dims.Count == 0) return chains;

            foreach (bool alongU in new[] { true, false })
            {
                List<RfDimPlan> group = dims.Where(d => d.AlongU == alongU).ToList();
                if (group.Count == 0) continue;

                var raw = new List<RfChainRef>();
                foreach (RfDimPlan d in group)
                {
                    raw.Add(new RfChainRef
                    {
                        Kind = RfChainRefKind.Face,
                        Side = d.Side,
                        Pos = d.FacePos,
                        FaceId = d.FaceId,
                    });
                    raw.Add(new RfChainRef
                    {
                        Kind = RfChainRefKind.Stirrup,
                        Side = d.Side,
                        Pos = d.EdgePos,
                        StirrupId = d.StirrupId,
                        StirrupBarIndex = d.StirrupBarIndex,
                        StirrupDiameter = d.StirrupDiameter,
                        Ref = d.Ref,
                        SpanMin = d.EdgeSpanMin,
                        SpanMax = d.EdgeSpanMax,
                    });
                }

                var chain = new RfDimChain { AlongU = alongU, LinePos = group[0].LinePos };
                chain.Refs.AddRange(OrderAndDedupe(raw, tolerance, chain.Coincident));
                if (chain.Refs.Count > 0) chains.Add(chain);
            }
            return chains;
        }

        /// <summary>
        /// Лавлагааг байрлалаар (өсөх) эрэмбэлж давхардлыг хасна.  Тэнцүү байрлалд НҮҮР нь түрүүлж үлдэнэ (бетон нүүр — найдвартай, хомутын
        /// ирмэг түүнтэй давхцвал тусдаа сегмент үүсгэх боломжгүй).  Давхцсан хомутын лавлагааны тал <paramref name="coincident"/>-д.
        /// Хөрш лавлагаануудыг ЗӨВХӨН дараалсантай нь харьцуулна (гинжин давхардал).
        /// </summary>
        public static List<RfChainRef> OrderAndDedupe(IList<RfChainRef> refs, double tolerance, ICollection<RfSide> coincident)
        {
            var kept = new List<RfChainRef>();
            if (refs == null) return kept;
            // Тогтвортой эрэмбэ: байрлал, дараа нь нүүр (Face = 0) түрүүлнэ, дараа нь тал (тогтмол дараалал).
            List<RfChainRef> sorted = refs
                .OrderBy(r => r.Pos)
                .ThenBy(r => (int)r.Kind)
                .ThenBy(r => (int)r.Side)
                .ToList();
            foreach (RfChainRef r in sorted)
            {
                RfChainRef last = kept.Count == 0 ? null : kept[kept.Count - 1];
                if (last != null && Math.Abs(r.Pos - last.Pos) <= tolerance)
                {
                    // Давхцсан: нүүр үлдэнэ.  Хомутын лавлагаа хасагдсан бол мэдээлнэ.
                    if (r.Kind == RfChainRefKind.Stirrup && coincident != null) coincident.Add(r.Side);
                    else if (last.Kind == RfChainRefKind.Stirrup && r.Kind == RfChainRefKind.Face)
                    {
                        // Нүүр хомутын дараа орж ирсэн (эрэмбэ нүүрийг түрүүлдэг тул зөвхөн хүлцлийн хил дээр) — нүүрээр солино.
                        if (coincident != null) coincident.Add(last.Side);
                        kept[kept.Count - 1] = r;
                    }
                    continue;
                }
                kept.Add(r);
            }
            return kept;
        }
    }
}
