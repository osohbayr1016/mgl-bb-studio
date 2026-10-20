using System;
using System.Collections.Generic;

namespace MglLiraReport.Results
{
    /// <summary>Үр дүнгийн эх: ачаалал эсвэл РСН (тооцооны / нормын).</summary>
    public enum CaseSource { Loading, RsnCalc, RsnNorm }

    /// <summary>Шилжилтийн бүрэлдэхүүн.  XY = √(X² + Y²) (хэвтээ нийлбэр).</summary>
    public enum MoveComponent { X, Y, Z, XY }

    /// <summary>Харах чиглэл: фасад (X тэнхлэг хэвтээ), фасад (Y тэнхлэг хэвтээ), план (дээрээс).</summary>
    public enum ViewKind { ElevationX, ElevationY, Plan }

    /// <summary>LIRA-ийн нэг ачаалал / РСН — LIRA-ийн төрөлгүй хуулбар (засварлагч LiraAPI-г мэдэхгүй).</summary>
    public sealed class LiraCase
    {
        public CaseSource Source;
        public int Index, Sub, Form;
        public string Label;
        public override string ToString() => Label;
        public string Key => Source + ":" + Index + ":" + Sub + ":" + Form;
    }

    /// <summary>Тооцооны тор: зангилаа (индексээр) ба элемент (зангилааны индексүүд).</summary>
    public sealed class LiraMesh
    {
        public int[] NodeNumbers = Array.Empty<int>();
        public double[] X = Array.Empty<double>(), Y = Array.Empty<double>(), Z = Array.Empty<double>();
        /// <summary>Элемент бүрийн зангилааны ИНДЕКС (дугаар биш).  2 = саваа, 3–4 = хавтан.</summary>
        public List<int[]> Elements = new List<int[]>();
        public int NodeCount => X.Length;

        /// <summary>
        /// LIRA-ийн 4 зангилаат хавтан (КЭ 44) «1-2-4-3» дараалалтай — бодит загварт (260921_C_BLOCK_SE_2)
        /// 72 549 хавтан бүгд ийм байсан.  Тэр дарааллаар зурвал олон өнцөгт «эрвээхэй» болж цоорхой гарна.
        /// Элемент бүрийг 3D-д гүдгэр эсэхээр шалгаж, гүдгэр биш бол 3, 4-р зангилааг солино.
        /// </summary>
        public int FixQuadOrder()
        {
            int fixedCount = 0;
            for (int i = 0; i < Elements.Count; i++)
            {
                var e = Elements[i];
                if (e.Length != 4 || IsConvex(e[0], e[1], e[2], e[3])) continue;
                if (IsConvex(e[0], e[1], e[3], e[2])) { Elements[i] = new[] { e[0], e[1], e[3], e[2] }; fixedCount++; }
            }
            return fixedCount;
        }

        bool IsConvex(int a, int b, int c, int d)
        {
            int[] q = { a, b, c, d };
            double rx = 0, ry = 0, rz = 0;
            for (int i = 0; i < 4; i++)
            {
                int p0 = q[i], p1 = q[(i + 1) % 4], p2 = q[(i + 2) % 4];
                double ux = X[p1] - X[p0], uy = Y[p1] - Y[p0], uz = Z[p1] - Z[p0];
                double vx = X[p2] - X[p1], vy = Y[p2] - Y[p1], vz = Z[p2] - Z[p1];
                double cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
                if (i == 0) { rx = cx; ry = cy; rz = cz; }
                else if (rx * cx + ry * cy + rz * cz <= 0) return false;
            }
            return true;
        }
    }

    /// <summary>Зангилаа бүрийн утга (NaN = утгагүй) + нэгжийн сэжүүр.</summary>
    public sealed class NodeField
    {
        public double[] Values;
        /// <summary>LIRA-ийн баганын нэр дэх нэгж («мм», «м»…); олдоогүй бол null.</summary>
        public string UnitHint;
        public string ColumnName;
    }

    /// <summary>Хамгийн бага / их утга, тэдгээр нь аль зангилаанд.</summary>
    public struct FieldStats
    {
        public double Min, Max;
        public int MinNode, MaxNode;
        public int Count;

        public static FieldStats Of(double[] v, int[] nodeNumbers)
        {
            var s = new FieldStats { Min = double.PositiveInfinity, Max = double.NegativeInfinity };
            for (int i = 0; i < v.Length; i++)
            {
                double x = v[i];
                if (double.IsNaN(x)) continue;
                s.Count++;
                if (x < s.Min) { s.Min = x; s.MinNode = nodeNumbers != null && i < nodeNumbers.Length ? nodeNumbers[i] : i + 1; }
                if (x > s.Max) { s.Max = x; s.MaxNode = nodeNumbers != null && i < nodeNumbers.Length ? nodeNumbers[i] : i + 1; }
            }
            if (s.Count == 0) { s.Min = s.Max = 0; }
            return s;
        }

        /// <summary>Абсолют утгаараа хамгийн том нь min уу, max уу (жишээ тайлан шиг «min=220.41mm»).</summary>
        public bool ExtremeIsMin => Math.Abs(Min) > Math.Abs(Max);
        public double Extreme => ExtremeIsMin ? Min : Max;
    }
}
