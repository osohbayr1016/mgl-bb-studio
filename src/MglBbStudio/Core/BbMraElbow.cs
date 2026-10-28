using System;

namespace MglBb.Core
{
    /// <summary>
    /// Хана/хучилтын MRA шошгоны leader-ийн хугарал (ЖИШЭЭ-1 (2027) «4.93 ТҮВШНИЙ ХУЧИЛТЫН ДООД / ДЭЭД ҮЕИЙН АРМАТУРЧЛАЛ», 2026-10-26 хэмжсэн, 63 MRA):
    /// хэмжээсийн шугам шошгоны бичвэртэй ЗЭРЭГЦЭЭ үед хугарал толгойн өндөрт — бичвэр шугамын мужаас эхэлбэл бичвэрийн ЭХЭНД (толгойноос 3.9 мм
    /// зүүн, 40 тохиолдол), үгүй бол бичвэрийн ТӨГСГӨЛД (төгсгөлөөс 0.9 мм дотогш, 23 тохиолдол); тэндээс leader шугам руу.  Шугам бичвэрт
    /// перпендикуляр (босоо) үед хугаралгүй.  Бүх утга харагдацын «right» тэнхлэгийн дагуу.  Revit-гүй.
    /// </summary>
    public static class BbMraElbow
    {
        /// <summary>Хэмжээсийн шугамын чиглэл ба харагдацын right-ийн скаляр үржвэрээр — хугарал тавих эсэх.</summary>
        public static bool Along(double dimDotRight) { return Math.Abs(dimDotRight) > 0.9; }

        /// <summary>
        /// Хугарлын u: <paramref name="textL"/>..<paramref name="textR"/> = leader-гүй бичвэрийн хүрээ, <paramref name="dimU0"/>..<paramref name="dimU1"/>
        /// = хэмжээсийн шугамын муж, <paramref name="leftGap"/> = толгойноос зүүн тийш, <paramref name="rightInset"/> = бичвэрийн төгсгөлөөс дотогш.
        /// </summary>
        public static double U(double headU, double textL, double textR, double dimU0, double dimU1, double leftGap, double rightInset, double tol = 0)
        {
            bool startsOnLine = textL >= Math.Min(dimU0, dimU1) - tol;
            return startsOnLine ? headU - leftGap : textR - rightInset;
        }
    }
}
