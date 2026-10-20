using System;
using System.Collections.Generic;
using System.Linq;

namespace MglBb.Core
{
    /// <summary>Дэлгээсийн нэг хомутын бүс (нэг MRA).  Бүх утга host frame-д (u = гишүүний дагуу, v = гишүүнээс гадагш сөрөг), фут.</summary>
    public sealed class BbMraZone
    {
        public long Id;
        public double U0, U1;
        public int Count;

        /// <summary>Leader-гүй шошгоны бичвэрийн хүрээ ТОЛГОЙН цэгээс (DL ≤ 0 ≤ DR, DB ≤ 0 ≤ DT байх нь элбэг).</summary>
        public double DL, DR, DB, DT;

        // ── Гаралт
        public bool Short, Mid;
        public bool NearRow;
        public double LineV, HeadU, HeadV;

        public double Center { get { return (U0 + U1) / 2; } }
        public double TextL { get { return HeadU + DL; } }
        public double TextR { get { return HeadU + DR; } }
    }

    /// <summary>ЖИШЭЭ-1-ийн 235 дэлгээсээс хэмжсэн MRA-ийн байрлалын дүрэм (цаасан мм-ийг фут болгож дамжуулна).</summary>
    public sealed class BbMraRules
    {
        /// <summary>Энэ тооноос ихгүй ширхэгтэй бүс = «богино» (туслах дам нурууны дэргэдэх 3 ширхэг × 50 мм).</summary>
        public int ShortMaxBars = 3;

        /// <summary>Сүүлийн (гишүүнд ойр) эгнээнээс MRA-ийн бичвэрийн дээд ирмэг хүртэл.</summary>
        public double GapFt;

        /// <summary>Хэмжээсийн эгнээ хоорондын алхам (ойр ↔ хол эгнээ).</summary>
        public double PitchFt;

        /// <summary>Толгой хэмжээсийн шугамаас гишүүн рүү: богино (ойр эгнээ), урт (хол эгнээ), дунд (хол эгнээ, хэмжээсийн бичвэрийн ДЭЭР).</summary>
        public double NearHeadFt, FarHeadFt, MidHeadFt;

        /// <summary>Энэ тооноос ихгүй (ба богиноос их) ширхэгтэй бүс = «дунд» — бүс богино тул шошго хэмжээсийн бичвэрийн дээр.</summary>
        public int MidMaxBars = 7;

        /// <summary>Толгойн u бүсийн эхнээс (харьцаа): урт бүсэд 0.7 (хэмжээсийн бичвэр голд, шошго баруун талд), дунд бүсэд 0.4.</summary>
        public double LongRel = 0.7, MidRel = 0.4;

        /// <summary>Богино бүсийн бичвэр бүсийн ирмэгээс энэ зайд (гадна талд).</summary>
        public double ShortGapFt;

        /// <summary>Хоёр богино бүс энэ зайнаас ойр бол «хос» — бичвэрүүд бие биеэсээ ХОЛ тийш.</summary>
        public double PairFt;

        /// <summary>Нэг эгнээний хөрш бичвэр хоорондын хамгийн бага зай.</summary>
        public double MinTagGapFt;
    }

    /// <summary>
    /// Компанийн (ЖИШЭЭ-1) хомутын MRA-ийн байрлал — үндсэн хөдөлгүүрийн «бүх MRA нэг эгнээнд, толгой шугамаас гадагш» загварын оронд:
    /// <list type="bullet">
    /// <item>богино бүс (≤ 3 ширхэг) гишүүнд ОЙР эгнээнд, урт/дунд бүс ХОЛ эгнээнд (хэмжсэн: 711/737 ба 911/941);</item>
    /// <item>толгой нь хэмжээсийн шугамаас ГИШҮҮН РҮҮ (шугам хамгийн гадна);</item>
    /// <item>урт бүсийн бичвэр бүсийн голд; богино бүсийнх бүсийн гадна — хөрш нь богино бол түүнээс ХОЛ, урт бол түүн рүү (579/593, 377/418).</item>
    /// </list>
    /// Цэвэр функц (Revit-гүй) — тесттэй.
    /// </summary>
    public static class BbMraLayout
    {
        /// <param name="cursor">Гишүүний доод талын хамгийн гадна эгнээ (шошго/давхцлын хэмжээс), эсвэл гишүүний ирмэг.</param>
        public static void Plan(IList<BbMraZone> zones, double cursor, BbMraRules r)
        {
            if (zones == null || zones.Count == 0) return;
            foreach (BbMraZone z in zones)
            {
                z.Short = z.Count <= r.ShortMaxBars;
                z.Mid = !z.Short && z.Count <= r.MidMaxBars;
            }
            bool anyShort = zones.Any(z => z.Short), anyLong = zones.Any(z => !z.Short);
            bool twoRows = anyShort && anyLong;

            if (twoRows)
            {
                double dtShort = zones.Where(z => z.Short).Max(z => z.DT);
                double dtLong = zones.Where(z => !z.Short && !z.Mid).Select(z => z.DT).DefaultIfEmpty(0).Max();
                double near = cursor - r.GapFt - r.NearHeadFt - dtShort;
                double far = near - r.PitchFt;
                // Урт бүсийн бичвэр ойр эгнээний шугамд хүрэхгүй (дунд бүс ойр эгнээний бүсийн хажууд — инженер ч ингэж давхардуулдаг).
                double farTop = far + r.FarHeadFt + dtLong;
                if (farTop > near - r.MinTagGapFt * 0.25) far -= farTop - (near - r.MinTagGapFt * 0.25);
                foreach (BbMraZone z in zones)
                {
                    z.NearRow = z.Short;
                    z.LineV = z.Short ? near : far;
                    z.HeadV = z.LineV + HeadDv(z, r);
                }
            }
            else
            {
                double line = cursor - r.GapFt - zones.Max(z => HeadDv(z, r) + z.DT);
                foreach (BbMraZone z in zones)
                {
                    z.NearRow = true;
                    z.LineV = line;
                    z.HeadV = line + HeadDv(z, r);
                }
            }

            // Хэвтээ байрлал.
            var ordered = zones.OrderBy(z => z.Center).ToList();
            foreach (BbMraZone z in ordered)
            {
                if (!z.Short)
                {
                    // Хэмжээсийн бичвэр («100x19») бүсийн голд — урт бүсэд шошго түүний баруун талд, дунд бүсэд бичвэрийн дээр (ЖИШЭЭ-1: 0.7 / 0.4).
                    z.HeadU = z.U0 + (z.U1 - z.U0) * (z.Mid ? r.MidRel : r.LongRel);
                    continue;
                }
                int side = ShortSide(z, ordered, r.PairFt);
                z.HeadU = side < 0 ? z.U0 - r.ShortGapFt - z.DR : z.U1 + r.ShortGapFt - z.DL;
            }

            // Эгнээ тус бүрд давхцал арилгана (зүүнээс баруун, дараа нь баруунаас зүүн — шилжилтийг хоёр тийш хуваана).
            foreach (bool nearRow in new[] { true, false })
            {
                var row = ordered.Where(z => z.NearRow == nearRow).OrderBy(z => (z.TextL + z.TextR) / 2).ToList();
                Separate(row, r.MinTagGapFt);
            }
        }

        private static double HeadDv(BbMraZone z, BbMraRules r) { return z.Short ? r.NearHeadFt : z.Mid ? r.MidHeadFt : r.FarHeadFt; }

        /// <summary>-1 = зүүн, +1 = баруун.</summary>
        public static int ShortSide(BbMraZone z, IList<BbMraZone> all, double pairFt)
        {
            BbMraZone nb = null;
            double best = double.MaxValue;
            foreach (BbMraZone o in all)
            {
                if (ReferenceEquals(o, z)) continue;
                double d = Math.Abs(o.Center - z.Center);
                if (d < best) { best = d; nb = o; }
            }
            if (nb == null) return -1;
            if (nb.Short)
            {
                if (best <= pairFt) return nb.Center > z.Center ? -1 : 1;   // хосоос ХОЛ
                BbMraZone nl = all.Where(o => !o.Short).OrderBy(o => Math.Abs(o.Center - z.Center)).FirstOrDefault();
                if (nl != null) return nl.Center > z.Center ? 1 : -1;
                return nb.Center > z.Center ? -1 : 1;
            }
            return nb.Center > z.Center ? 1 : -1;                              // урт хөрш рүү (түүний дээгүүр ойр эгнээ сул)
        }

        /// <summary>Нэг эгнээний бичвэрүүдийг давхцахгүй болгоно — анхны байрлалаас хамгийн бага шилжилтээр (хоёр тийш дамжуулж дундажлана).</summary>
        public static void Separate(IList<BbMraZone> row, double gap)
        {
            int n = row.Count;
            if (n < 2) return;
            double[] want = row.Select(z => z.HeadU).ToArray();
            double[] fwd = (double[])want.Clone();
            for (int i = 1; i < n; i++)
            {
                double minHead = fwd[i - 1] + row[i - 1].DR + gap - row[i].DL;
                if (fwd[i] < minHead) fwd[i] = minHead;
            }
            double[] bwd = (double[])want.Clone();
            for (int i = n - 2; i >= 0; i--)
            {
                double maxHead = bwd[i + 1] + row[i + 1].DL - gap - row[i].DR;
                if (bwd[i] > maxHead) bwd[i] = maxHead;
            }
            // Дундаж нь дахин давхцаж болзошгүй — эцэст нь урагш дамжуулж баталгаажуулна.
            double[] res = new double[n];
            for (int i = 0; i < n; i++) res[i] = (fwd[i] + bwd[i]) / 2;
            for (int i = 1; i < n; i++)
            {
                double minHead = res[i - 1] + row[i - 1].DR + gap - row[i].DL;
                if (res[i] < minHead) res[i] = minHead;
            }
            for (int i = 0; i < n; i++) row[i].HeadU = res[i];
        }
    }
}
