using System;

namespace RevitMcpAddin.Reinforcement.Core
{
    /// <summary>
    /// Арматурын шошгоны leader-ийн ГУРВАН цэг (Revit-гүй, тестлэгдсэн):
    ///   1 = leader-ийн төгсгөл (арматур дээр) · 2 = elbow (хугарал) · 3 = шошго (толгой).
    /// Хэрэглэгч хоёр зайг цаасан мм-ээр заана: <b>3→2</b> (шошгоны ирмэгээс elbow хүртэлх ХЭВТЭЭ хэсэг, landing) ба
    /// <b>2→1</b> (elbow-оос арматур хүртэлх налуу хэсгийн ХЭВТЭЭ зай, run).  0 = Revit-ийн автомат.
    ///
    /// Бүх тооцоо ХАРАГДАЦЫН хавтгайд (X = баруун, Y = дээш) — шошгоны бичвэр үргэлж харагдацад хэвтээ, тиймээс огтлол/дэлгээс/эргэсэн
    /// гишүүн бүрд ижил.  Elbow ҮРГЭЛЖ шошгоны төвийн түвшинд (Y) байна — тэгвэл 3→2 нь жинхэнэ хэвтээ шугам.
    /// </summary>
    public struct RfLeaderShape
    {
        /// <summary>false = юу ч өөрчлөхгүй (Revit-ийн автомат).</summary>
        public bool Applied;

        /// <summary>Шошгоны шинэ төв (хоёр зай хоёулаа заагдсан бол хэвтээ чиглэлд зөөгдөнө).</summary>
        public RfV2 Head;

        public RfV2 Elbow;

        /// <summary>Зөвхөн мэдэгдэл: зайг бүрэн биелүүлж чадаагүй (elbow хаалтад хүрсэн г.м.).  null = бүрэн.</summary>
        public string Note;
    }

    public static class RfLeaderElbow
    {
        /// <summary>Хоёр зайн аль нэг нь энэ утгаас их бол заасан гэж үзнэ (фут; ≈ 0.003 мм).</summary>
        private const double On = 1e-5;

        /// <summary>Шошго ба арматурын хэвтээ зөрүү энэ хэмжээнээс бага бол «яг дээр/доор» — тал нь сонгогдохгүй, <paramref name="fallback"/> хэрэглэнэ.</summary>
        private const double SameColumn = 1e-4;

        /// <summary>Шошго арматураас аль талд (−1 = зүүн, +1 = баруун).  Тод зөрүүгүй бол <paramref name="fallback"/>.</summary>
        public static int SideSign(double headX, double targetX, int fallback)
        {
            double dx = headX - targetX;
            if (Math.Abs(dx) <= SameColumn) return fallback < 0 ? -1 : 1;
            return dx < 0 ? -1 : 1;
        }

        /// <summary>
        /// <paramref name="target"/> = 1, <paramref name="head"/> = шошгоны төв, <paramref name="tagWidth"/> = шошгоны харагдац дахь өргөн.
        /// <paramref name="landing"/> = 3→2, <paramref name="run"/> = 2→1 (фут, 0 = автомат).
        /// <list type="bullet">
        /// <item>ХОЁУЛАА заасан: elbow = арматураас <c>run</c>, шошго = elbow-оос <c>landing</c> (+ хагас өргөн) — шошго хэвтээ чиглэлд ЗӨӨГДӨНӨ
        ///   (хоёр зайг яг биелүүлэх цорын ганц арга).</item>
        /// <item>Зөвхөн <c>landing</c>: шошго хэвээр, elbow шошгоны ирмэгээс <c>landing</c>-д.  Арматурыг гатлах гэвэл арматур дээр хаана (run = 0) + мэдэгдэл.</item>
        /// <item>Зөвхөн <c>run</c>: шошго хэвээр, elbow арматураас <c>run</c>-д.  Шошгонд орох гэвэл ирмэгт хаана (landing = 0) + мэдэгдэл.</item>
        /// </list>
        /// </summary>
        public static RfLeaderShape Shape(RfV2 target, RfV2 head, double tagWidth, double landing, double run, int fallbackSide)
        {
            var r = new RfLeaderShape { Applied = false, Head = head, Elbow = head };
            bool hasL = landing > On, hasR = run > On;
            if (!hasL && !hasR) return r;

            double half = Math.Max(tagWidth, 0) / 2;
            int s = SideSign(head.X, target.X, fallbackSide);
            double elbowX, headX = head.X;

            if (hasL && hasR)
            {
                elbowX = target.X + s * run;
                headX = elbowX + s * (landing + half);
            }
            else if (hasL)
            {
                elbowX = head.X - s * (half + landing);
                if (s * (elbowX - target.X) < 0)
                {
                    elbowX = target.X;
                    r.Note = "3→2 зай шошго–арматурын зайнаас урт тул elbow арматур дээр тавигдлаа (шошго зөөгдөөгүй).";
                }
            }
            else
            {
                elbowX = target.X + s * run;
                if (s * (head.X - s * half - elbowX) < 0)
                {
                    elbowX = head.X - s * half;
                    r.Note = "2→1 зай шошго руу хүрэхээр байсан тул elbow шошгоны ирмэгт тавигдлаа (шошго зөөгдөөгүй).";
                }
            }

            r.Applied = true;
            r.Head = new RfV2(headX, head.Y);
            r.Elbow = new RfV2(elbowX, head.Y);
            return r;
        }
    }
}
