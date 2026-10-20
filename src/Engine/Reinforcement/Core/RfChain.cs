using System;
using System.Collections.Generic;

namespace RevitMcpAddin.Reinforcement.Core
{
    /// <summary>Гинжийн нэг муруй: эхлэл/төгсгөлийн цэг ба параметрийн ӨСӨХ чиглэлийн шүргэгч (Revit-гүй).</summary>
    public struct RfSeg
    {
        public RfV3 A, B;
        /// <summary>A дээрх шүргэгч — муруйн ДОТОГШ (параметр өсөх) чиглэл.</summary>
        public RfV3 TA;
        /// <summary>B дээрх шүргэгч — параметр өсөх чиглэл (муруйн дотроос ГАДАГШ).</summary>
        public RfV3 TB;

        public RfSeg(RfV3 a, RfV3 b, RfV3 ta, RfV3 tb)
        {
            A = a; B = b; TA = ta; TB = tb;
        }
    }

    /// <summary>Гинжийн нэг үзүүр: цэг ба муруйн дотроос ГАДАГШ нэгж чиглэл.</summary>
    public struct RfChainEnd
    {
        public RfV3 Position;
        public RfV3 Outward;
    }

    /// <summary>
    /// Арматурын centerline гинжийн ЛОГИК эхлэл/төгсгөл.
    ///
    /// ⚠️ Revit-ийн баримт `GetCenterlineCurves`-ийг зөвхөн «chain of curves» гэдэг, ЧИГЛЭЛИЙГ нь (муруй бүр дараагийн
    /// муруйтайгаа эхлэл→төгсгөл залгагдсан эсэхийг) баталгаажуулдаггүй.  Тиймээс «curves[0]-ийн эхлэл, сүүлийнхийн
    /// төгсгөл» гэж ТААМАГЛАХГҮЙ: үзүүр бүрийг ХОЛБОЛТООР (өөр муруйтай давхцдаггүй, чөлөөт үзүүр) олно.
    /// Дараалал нь Revit-ийнхтэй ижил байх: чөлөөт үзүүрээс индекс нь бага муруйных = ЭХЛЭЛ.
    /// Хаалттай гогцоо / тодорхойгүй бол curves[0].A ба curves[last].B руу унана.
    /// </summary>
    public static class RfChain
    {
        public static bool FindEnds(IList<RfSeg> segs, out RfChainEnd start, out RfChainEnd end)
        {
            start = new RfChainEnd();
            end = new RfChainEnd();
            if (segs == null || segs.Count == 0) return false;

            // (segment индекс, үзүүр 0=A / 1=B) тус бүрийн чөлөөт эсэх
            var free = new List<int[]>();
            for (int i = 0; i < segs.Count; i++)
            {
                for (int e = 0; e < 2; e++)
                {
                    RfV3 p = e == 0 ? segs[i].A : segs[i].B;
                    bool shared = false;
                    for (int j = 0; j < segs.Count && !shared; j++)
                    {
                        if (j == i)
                        {
                            // Нэг муруйн хоёр үзүүр давхцвал (хаалттай муруй) өөр өөртэйгөө залгагдсан гэж үзнэ.
                            RfV3 other = e == 0 ? segs[i].B : segs[i].A;
                            if (segs[i].A.DistanceTo(segs[i].B) <= RfTol.PointFt && p.DistanceTo(other) <= RfTol.PointFt) shared = true;
                            continue;
                        }
                        if (segs[j].A.DistanceTo(p) <= RfTol.PointFt || segs[j].B.DistanceTo(p) <= RfTol.PointFt) shared = true;
                    }
                    if (!shared) free.Add(new[] { i, e });
                }
            }

            if (segs.Count == 1 || free.Count != 2)
            {
                // Нэг муруй, хаалттай гогцоо, эсвэл салаалсан/давхцсан гинж — Revit-ийн дарааллаар.
                RfSeg f = segs[0], l = segs[segs.Count - 1];
                start = new RfChainEnd { Position = f.A, Outward = (-f.TA).Normalized() };
                end = new RfChainEnd { Position = l.B, Outward = l.TB.Normalized() };
                return true;
            }

            // Индекс нь бага муруйн чөлөөт үзүүр = эхлэл.
            int[] s0 = free[0], s1 = free[1];
            if (s1[0] < s0[0]) { int[] t = s0; s0 = s1; s1 = t; }
            start = EndOf(segs, s0);
            end = EndOf(segs, s1);
            return true;
        }

        private static RfChainEnd EndOf(IList<RfSeg> segs, int[] e)
        {
            RfSeg s = segs[e[0]];
            return e[1] == 0
                ? new RfChainEnd { Position = s.A, Outward = (-s.TA).Normalized() }
                : new RfChainEnd { Position = s.B, Outward = s.TB.Normalized() };
        }
    }
}
