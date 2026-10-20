using System;
using System.Collections.Generic;
using Autodesk.Revit.DB;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement
{
    /// <summary>
    /// Шошгоны leader-ийн elbow-г хэрэглэгчийн заасан зайгаар тавих Revit талын залгаас (цэвэр тооцоо нь <see cref="RfLeaderElbow"/>).
    /// Огтлол ба дэлгээсийн шошго хоёулаа ЭНЭ ганц газраар — харагдацын Right/Up тэнхлэгээр, тиймээс эргэсэн гишүүн/багана ч ижил.
    ///
    /// ⚠️ Revit дээр ажиллуулж үзээгүй: <c>IndependentTag.SetLeaderElbow</c> нь зөвхөн <c>LeaderEndCondition.Free</c> үед ажиллана — дуудагч төгсгөлийг
    /// ЭХЛЭЭД чөлөөтэй болгож, толгойг зөөсний ДАРАА elbow-г тавина (толгойг зөөхөд Revit elbow-г дахин тооцдог).  Алдаа бүр ИЛ мэдэгдэл.
    /// </summary>
    internal static class RfLeaderPlacer
    {
        /// <summary>Хоёр зайн аль нэг нь заагдсан эсэх (фут).</summary>
        public static bool IsOn(double landingFt, double runFt)
        {
            return landingFt > 1e-5 || runFt > 1e-5;
        }

        /// <summary>
        /// Шошгоны шинэ толгой ба elbow (загварын цэг).  Харагдацын хавтгайд тооцоод, анхны <paramref name="head"/>-ийн гүн (ViewDirection)-ийг хадгална.
        /// </summary>
        public static bool Plan(View view, XYZ target, XYZ head, double tagWidthFt, double landingFt, double runFt, out XYZ newHead, out XYZ elbow, out string note)
        {
            newHead = head;
            elbow = null;
            note = null;
            if (!IsOn(landingFt, runFt)) return false;
            XYZ right = view.RightDirection, up = view.UpDirection;
            var t = new RfV2(target.DotProduct(right), target.DotProduct(up));
            var h = new RfV2(head.DotProduct(right), head.DotProduct(up));
            RfLeaderShape s = RfLeaderElbow.Shape(t, h, tagWidthFt, landingFt, runFt, -1);
            if (!s.Applied) return false;
            newHead = head + right * (s.Head.X - h.X) + up * (s.Head.Y - h.Y);
            elbow = head + right * (s.Elbow.X - h.X) + up * (s.Elbow.Y - h.Y);
            note = s.Note;
            return true;
        }

        /// <summary>
        /// Шошгоны БОДИТ харагдах өргөн (харагдацын хэвтээ дагуу, фут): leader-гүй түр шошго үүсгэж хэмжээд буцаана (SubTransaction-ыг RollBack).
        /// Агуулга бүрд өөр (2 Ø22 ≠ Ø8@200) тул таамаглал биш хэмжинэ.  Хэмжиж чадахгүй бол −1 (дуудагч төлөвлөсөн хэмжээгээ хэрэглэнэ).
        /// ⚠️ Нээлттэй SubTransaction-ий ДОТОР дуудахгүй.
        /// </summary>
        public static double MeasureWidth(Document doc, View view, ElementId typeId, IEnumerable<Reference> candidates, XYZ at)
        {
            foreach (Reference cand in candidates)
            {
                using (var st = new SubTransaction(doc))
                {
                    st.Start();
                    try
                    {
                        IndependentTag probe = IndependentTag.Create(doc, typeId, view.Id, cand, false, TagOrientation.Horizontal, at);
                        double w = -1;
                        if (probe != null)
                        {
                            doc.Regenerate();
                            BoundingBoxXYZ bb = probe.get_BoundingBox(view);
                            if (bb != null)
                            {
                                XYZ right = view.RightDirection;
                                double lo = double.MaxValue, hi = double.MinValue;
                                foreach (double x in new[] { bb.Min.X, bb.Max.X })
                                    foreach (double y in new[] { bb.Min.Y, bb.Max.Y })
                                        foreach (double z in new[] { bb.Min.Z, bb.Max.Z })
                                        {
                                            double p = new XYZ(x, y, z).DotProduct(right);
                                            if (p < lo) lo = p;
                                            if (p > hi) hi = p;
                                        }
                                w = hi - lo;
                            }
                        }
                        st.RollBack();
                        if (w > 1e-5) return w;
                    }
                    catch
                    {
                        if (st.HasStarted() && !st.HasEnded()) st.RollBack();
                    }
                }
            }
            return -1;
        }

        /// <summary>
        /// Elbow-г тавина.  Шошго нэгээс олон leader-тэй (multi-leader) бол ЭХНИЙ leader-ийнх л — бусад нь Revit-ийн автомат.
        /// Буцаах: null = амжилттай, үгүй бол мэдэгдлийн бичвэр (шошго хэвээр үлдэнэ).
        /// </summary>
        public static string Apply(IndependentTag tag, Reference fallbackRef, XYZ elbow)
        {
            if (tag == null || elbow == null) return null;
            try
            {
                IList<Reference> tagged = tag.GetTaggedReferences();
                Reference tr = tagged != null && tagged.Count > 0 ? tagged[0] : fallbackRef;
                if (tr == null) return "leader-ийн лавлагаа олдсонгүй";
                if (tag.LeaderEndCondition != LeaderEndCondition.Free) tag.LeaderEndCondition = LeaderEndCondition.Free;
                tag.SetLeaderElbow(tr, elbow);
                return null;
            }
            catch (Exception ex)
            {
                return ex.Message.Split('\n')[0].Trim().TrimEnd('.');
            }
        }
    }
}
