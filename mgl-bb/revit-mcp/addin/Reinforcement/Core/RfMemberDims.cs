using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.Reinforcement.Core
{
    // ══════════════════════════════════════════════════════════════════════
    // ОГТЛОЛ: ГИШҮҮНИЙ (дам нуруу, багана) ХЭМЖЭЭС ТЭНХЛЭГ, ХУЧИЛТ, ХАНАТАЙ УЯЛДСАН гадна гинж (2026-10-08, эзний хүсэлт №1).
    //
    //   Зураг 2:  хэвтээ  «150 | 150»  = зүүн нүүр | тэнхлэг | баруун нүүр
    //             босоо   «170 | 330»  = дээд нүүр (= хучилтын дээд) | хучилтын доод | доод нүүр
    // Хомутын «30 | 240 | 30» гинжний ГАДНА эгнээнд (хэвтээ нь дээд талд, босоо нь баруун талд — хомутын гинжтэй ижил тал).
    // Revit-гүй ЦЭВЭР (net48-д ч эмхэтгэгдэнэ).  Лавлагаа = гишүүний бетон нүүр + тэнхлэг + шүргэлцсэн хучилт/ханын нүүр (Revit тал шүүнэ:
    // Revit/RfSectionAnalyzer.CollectAux).  Бүх координат огтлолын харагдацын (u, v), фут.
    // ══════════════════════════════════════════════════════════════════════

    public enum RfAuxKind
    {
        Grid = 0,
        /// <summary>Хучилт / шал (хэвтээ нүүр — дээд, доод).</summary>
        Slab = 1,
        /// <summary>Хана (босоо хажуу нүүр).</summary>
        Wall = 2,
    }

    /// <summary>Гишүүнд шүргэлцсэн элементийн нүүр эсвэл тэнхлэгийн огтлол дахь шугам (харагдацын u/v).</summary>
    public sealed class RfAuxSample
    {
        /// <summary>Revit тал дахь Reference-тэй холбох түлхүүр.</summary>
        public int Id;
        public RfAuxKind Kind;

        /// <summary>Шугам/хавтгай дээрх цэг (харагдацын u, v).</summary>
        public RfV2 Origin;

        /// <summary>Шугамын нормаль (харагдацын хавтгайд, нэгж) — хэмжих чиглэл.</summary>
        public RfV2 Normal;
    }

    public enum RfMemberRefKind
    {
        /// <summary>Гишүүний бетон нүүр (<see cref="RfFaceSample.Id"/>).</summary>
        HostFace = 0,
        Grid = 1,
        /// <summary>Хучилт/ханын нүүр (<see cref="RfAuxSample.Id"/>).</summary>
        Neighbor = 2,
    }

    public sealed class RfMemberRef
    {
        public RfMemberRefKind Kind;
        public int Id;

        /// <summary>Хэмжих тэнхлэгийн дагуух локал координат (фут).</summary>
        public double Pos;
        public RfAuxKind AuxKind;
    }

    /// <summary>Нэг тэнхлэгийн гадна гинж (Revit-д НЭГ Dimension).</summary>
    public sealed class RfMemberChain
    {
        /// <summary>true = хэвтээ (локал U); false = босоо.  Шугамын тал = <see cref="RfSectionOptions.DimSideFor"/> (өгөгдмөл: Дээд / Баруун).</summary>
        public bool AlongU;

        /// <summary>Хэмжээсийн шугамын хөндлөн координат (локал).</summary>
        public double LinePos;
        public readonly List<RfMemberRef> Refs = new List<RfMemberRef>();

        public int Grids { get { return Refs.Count(r => r.Kind == RfMemberRefKind.Grid); } }
        public int Neighbors { get { return Refs.Count(r => r.Kind == RfMemberRefKind.Neighbor); } }
        public List<double> Positions() { return Refs.Select(r => r.Pos).ToList(); }
    }

    public static class RfMemberDims
    {
        /// <summary>Хоёр лавлагааг «ижил байрлал» гэж үзэх (фут) = 1 мм — давхардвал нүүр &gt; тэнхлэг &gt; хөрш үлдэнэ.</summary>
        public static readonly double SameFt = RfTol.MmToFt(1.0);

        /// <summary>Хөрш/тэнхлэгийн шугам локал тэнхлэгтэй «параллель» (≈ 2.6°).</summary>
        public const double AxisCos = 0.999;

        /// <summary>
        /// Хоёр тэнхлэгт (U, V) гадна гинж.  <paramref name="stirrupChains"/> = тэр тэнхлэгт хомутын гинж байгаа эсэх (байвал гадна гинж нэг эгнээ цааш,
        /// ГАНЦХАН нүүр–нүүр (2 лавлагаа) гинж тавигдахгүй — хомутын гинжний нийлбэр аль хэдийн тэр хэмжээ).
        /// </summary>
        public static List<RfMemberChain> Build(RfSectionRect rect, RfSectionFrame frame, IList<RfAuxSample> aux, IList<RfDimChain> stirrupChains,
            RfSectionOptions o, List<RfSectionWarning> warnings)
        {
            var res = new List<RfMemberChain>();
            if (!rect.Valid) return res;
            foreach (bool alongU in new[] { true, false })
            {
                RfSide lo = alongU ? RfSide.Left : RfSide.Bottom, hi = alongU ? RfSide.Right : RfSide.Top;
                if (rect.IsAmbiguous(lo) || rect.IsAmbiguous(hi))
                {
                    if (warnings != null) warnings.Add(new RfSectionWarning(RfSectionWarn.HostFaceAmbiguous, (rect.IsAmbiguous(lo) ? lo : hi).ToString()));
                    continue;
                }
                int fLo = rect.FaceOf(lo), fHi = rect.FaceOf(hi);
                if (fLo < 0 || fHi < 0) continue;
                double pLo = rect.FacePos(lo), pHi = rect.FacePos(hi);

                var raw = new List<RfMemberRef>
                {
                    new RfMemberRef { Kind = RfMemberRefKind.HostFace, Id = fLo, Pos = pLo },
                    new RfMemberRef { Kind = RfMemberRefKind.HostFace, Id = fHi, Pos = pHi },
                };
                if (aux != null)
                {
                    foreach (RfAuxSample a in aux)
                    {
                        RfV2 n = frame.ToLocal(a.Normal);
                        double along = alongU ? n.X : n.Y;
                        if (Math.Abs(along) < AxisCos * Math.Max(n.Length, 1e-9)) continue;
                        RfV2 p = frame.ToLocal(a.Origin);
                        double pos = alongU ? p.X : p.Y;
                        if (pos < pLo - o.MemberReachFt || pos > pHi + o.MemberReachFt) continue;
                        raw.Add(new RfMemberRef
                        {
                            Kind = a.Kind == RfAuxKind.Grid ? RfMemberRefKind.Grid : RfMemberRefKind.Neighbor,
                            Id = a.Id,
                            Pos = pos,
                            AuxKind = a.Kind,
                        });
                    }
                }

                var chain = new RfMemberChain { AlongU = alongU };
                chain.Refs.AddRange(Dedupe(raw));
                bool hasStirrup = stirrupChains != null && stirrupChains.Any(c => c.AlongU == alongU && c.IsValid);
                if (chain.Refs.Count < 2 || (hasStirrup && chain.Refs.Count < 3)) continue;
                // Хомутын гинжтэй ИЖИЛ тал(ууд)-д (хэрэглэгчийн «Байрлал»), түүнээс нэг эгнээ цааш.  «4 талд» бол хоёр талд.
                foreach (RfSide side in o.DimSidesFor(alongU))
                {
                    var c = new RfMemberChain { AlongU = alongU };
                    c.Refs.AddRange(chain.Refs);
                    c.LinePos = RfSectionOptions.OutsideLine(rect, side, o.DimOffsetFt + (hasStirrup ? o.MemberPitchFt : 0));
                    res.Add(c);
                }
            }
            return res;
        }

        /// <summary>Байрлалаар эрэмбэлж, 1 мм дотор давхардсаныг хасна — нүүр (0) &gt; тэнхлэг (1) &gt; хөрш (2) үлдэнэ.</summary>
        public static List<RfMemberRef> Dedupe(IEnumerable<RfMemberRef> refs)
        {
            var kept = new List<RfMemberRef>();
            foreach (RfMemberRef r in refs.OrderBy(x => x.Pos).ThenBy(x => (int)x.Kind).ThenBy(x => x.Id))
            {
                if (kept.Count > 0 && r.Pos - kept[kept.Count - 1].Pos < SameFt)
                {
                    if ((int)r.Kind < (int)kept[kept.Count - 1].Kind) kept[kept.Count - 1] = r;
                    continue;
                }
                kept.Add(r);
            }
            return kept;
        }
    }
}
