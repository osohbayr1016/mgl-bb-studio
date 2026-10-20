using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.ChangeImpact.Core
{
    /// <summary>
    /// Шинжилгээний «БҮРЭН БИШ» шалтгаануудыг НЭГ газар (ЦЭВЭР) тодорхойлно.
    ///
    ///   ПРИНЦИП: «нөлөөлөл олдсонгүй» нь «өөрчлөгдөөгүй» гэсэн үг БИШ.  Аливаа хязгаар, цоорхой, шалгаагүй хэсэг шинжилгээг
    ///   бүрэн бус болгоно; бүрэн бус үед Smart Publish ямар ч хуудсыг «өөрчлөгдөөгүй» гэж тэмдэглэхгүй.
    ///
    /// Шалтгаан бүр ХҮНД ойлгомжтой нэг өгүүлбэр — UI-ийн анхааруулга, тайлангийн тэмдэглэл, Publish-ийн «яагаад санал болгосон»
    /// гурвуулаа ЭНЭ жагсаалтаас.
    /// </summary>
    public sealed class CompletenessInputs
    {
        public bool GraphComplete = true;
        public IReadOnlyList<string> GraphReasons;
        public int ResolverFailures;
        /// <summary>Хязгаар (cap) хэтэрч орхигдсон холбоо (`ResolverHub.Truncations`).</summary>
        public int ResolverTruncations;
        public IReadOnlyList<string> TruncationReasons;
        /// <summary>Төслийн ерөнхий тохиргоо (Phase, Filter...) өөрчлөгдсөн ч нөлөөллийг ТООЦООЛООГҮЙ.</summary>
        public int GlobalUnenumerated;
        public bool SourcesTruncated;
        /// <summary>Capture хэт олон id-тай багцыг эхний хэсгээр нь л бүртгэсэн.</summary>
        public int TruncatedBatches;
        /// <summary>Устсан, мэдээллийг өмнөөс бүртгээгүй элемент.</summary>
        public int UnresolvedDeleted;
        /// <summary>Устсан, мэдэгдэж буй загварын элемент — аль харагдацад харагдаж байсныг ТОДОРХОЙЛОХ боломжгүй.</summary>
        public int DeletedUnderivable;
        /// <summary>Бүртгэлд цоорхой байж болзошгүй (trim / цэвэрлэсэн / унтраасан / handler алдсан).</summary>
        public bool LogGap;
        public string LogGapReason;
        /// <summary>Бүртгэл ОДОО унтраалттай — өөрчлөлт бүртгэгдэхгүй байна.</summary>
        public bool TrackingDisabled;
        /// <summary>Шинжилгээний зарим хэсгийг (харагдалт, өрөө, хүснэгт) хэрэглэгч сонгоогүй/алгассан.</summary>
        public IReadOnlyList<string> SkippedAnalyses;
        /// <summary>Revit-ийн хувилбарын түүхийг (baseline) хүссэн ч унших боломжгүй байсан.</summary>
        public bool BaselineFailed;
        public string BaselineFailedReason;
        /// <summary>Графт хүрсэн боловч УНШИГДААГҮЙ (устсан / хаалттай workset / линк) зорилт — тайланд ОРООГҮЙ.</summary>
        public int UnknownTargets;
        /// <summary>
        /// ӨӨРЧИЛСӨН ЭХ СУРВАЛЖ элемент (одоо ч, бүртгэлийн кэш/мөрөөс ч) уншигдсангүй — хаалттай workset, линк эсвэл дараа нь устсан.  Тэдний нөлөөлөл
        /// огт тодорхойлогдоогүй (граф тэднээс эхэлж чадаагүй).
        /// </summary>
        public int UnknownSources;
        /// <summary>Холбоосын (эзэн харагдац / хост) зорилт уншигдаагүй тул A/B холбоо орхигдсон тоо.</summary>
        public int UnreadableLinks;
    }

    public static class ImpactCompleteness
    {
        public static List<string> Reasons(CompletenessInputs i)
        {
            var r = new List<string>();
            if (i == null) return r;

            if (i.TrackingDisabled)
                r.Add("Өөрчлөлтийн бүртгэл ОДОО унтраалттай — энэ үеийн өөрчлөлт бүртгэгдэхгүй байна.");
            if (i.LogGap)
                r.Add(string.IsNullOrEmpty(i.LogGapReason)
                    ? "Бүртгэлд цоорхой байж болзошгүй (хуучин өөрчлөлт хасагдсан, цэвэрлэсэн эсвэл бүртгэл түр унтарсан)."
                    : i.LogGapReason);
            if (i.TruncatedBatches > 0)
                r.Add(i.TruncatedBatches + " багц өөрчлөлт хэт олон элементтэй тул зөвхөн эхний хэсгийг нь бүртгэсэн.");
            if (i.SourcesTruncated)
                r.Add("Өөрчилсөн элемент хэт олон — зөвхөн хамгийн сүүлийнхийг шинжиллээ.");
            if (i.UnresolvedDeleted > 0)
                r.Add(i.UnresolvedDeleted + " устсан элементийн мэдээлэл байхгүй (устахаас өмнө бүртгээгүй) — аль харагдац/хуудсанд харагдаж байсныг тодорхойлж чадсангүй.");
            if (i.DeletedUnderivable > 0)
                r.Add(i.DeletedUnderivable + " загварын элемент устсан — устсан элементийн харагдац/хуудсыг ҮНДЭСЛЭЖ БОЛОХГҮЙ (Revit устсан элементийн геометрийг өгөхгүй).");
            if (!i.GraphComplete)
                r.Add(i.GraphReasons != null && i.GraphReasons.Count > 0
                    ? "Нөлөөллийн граф хязгаарт хүрсэн: " + string.Join("; ", i.GraphReasons) + "."
                    : "Нөлөөллийн граф хязгаарт хүрсэн (бүрэн дэлгэгдээгүй).");
            if (i.ResolverTruncations > 0)
                r.Add("Зарим холбоо хязгаарын улмаас орхигдсон" + (i.TruncationReasons != null && i.TruncationReasons.Count > 0
                    ? ": " + string.Join(" ", i.TruncationReasons.Take(3).Select(x => "(" + x.TrimEnd('.') + ")")) : "") + ".");
            if (i.ResolverFailures > 0)
                r.Add(i.ResolverFailures + " резольвер элемент дээр алдаатай — тэр холбоо орхигдсон.");
            if (i.UnknownTargets > 0)
                r.Add(i.UnknownTargets + " нөлөөлөгдөх зорилтыг уншиж чадсангүй (устсан, хаалттай workset-д эсвэл линкд байж болно) — тайланд ороогүй.");
            if (i.UnknownSources > 0)
                r.Add(i.UnknownSources + " өөрчилсөн элементийг уншиж чадсангүй (хаалттай workset, линк эсвэл дараа нь устсан) — тэдний нөлөөлөл тодорхойлогдоогүй.");
            if (i.UnreadableLinks > 0)
                r.Add(i.UnreadableLinks + " холбоосын зорилт (эзэн харагдац эсвэл хост) уншигдсангүй — тэр холбоо орхигдсон.");
            if (i.GlobalUnenumerated > 0)
                r.Add("Төслийн ерөнхий тохиргоо өөрчлөгдсөн (Phase, Filter, Material...) — олон хуудсанд нөлөөлж болох ч нарийвчлан тооцоолоогүй.");
            if (i.SkippedAnalyses != null)
                foreach (string s in i.SkippedAnalyses) r.Add(s);
            if (i.BaselineFailed)
                r.Add("Revit-ийн хувилбарын түүхийг (baseline) уншиж чадсангүй" + (string.IsNullOrEmpty(i.BaselineFailedReason) ? "" : " — " + i.BaselineFailedReason) + ".");
            return r.Distinct().ToList();
        }

        /// <summary>
        /// Бүртгэлд цоорхой байж болзошгүй эсэхийг шийднэ.  `fromSeqExclusive`-аас ХОЙШХИ мужид цоорхой орвол л (`gapThrough &gt; from`).
        ///
        ///   • `lostThroughSeq`     — trim / цэвэрлэсэн / дүүрсэн дараалал / handler алдсанаас болж алдагдсан хамгийн ШИНЭ дугаар
        ///   • `trackingGapThrough` — бүртгэл унтраалттай байсан хугацааны төгсгөл (дахин асаасан мөч)
        ///   • `logUnreadable`      — диск дээрх бүртгэл УНШИГДААГҮЙ (түгжигдсэн) эсвэл хараахан ачаалагдаагүй: хуучин өөрчлөлт огт ороогүй
        ///   • `settingsUnreadable` — тохиргооны файл (бүртгэл унтраасан хугацаа, баримтын цоорхой) УНШИГДААГҮЙ: «цоорхой байхгүй» гэж мэдэх боломжгүй
        /// </summary>
        public static bool HasLogGap(long fromSeqExclusive, long lostThroughSeq, long trackingGapThrough, bool logUnreadable, out string reason, bool settingsUnreadable = false)
        {
            reason = null;
            if (logUnreadable)
            {
                reason = "Хадгалагдсан өөрчлөлтийн бүртгэлийн файл уншигдсангүй (түгжигдсэн?) — өмнөх session-үүдийн өөрчлөлт шинжилгээнд ороогүй.";
                return true;
            }
            if (settingsUnreadable)
            {
                reason = "Тохиргооны файл уншигдсангүй — бүртгэл түр унтарсан эсэх, хаалтын үед хадгалагдаагүй өөрчлөлт байгаа эсэхийг мэдэх боломжгүй.";
                return true;
            }
            if (lostThroughSeq > fromSeqExclusive)
            {
                reason = "Бүртгэл энэ мужид (хуучин өөрчлөлт хасагдсан, цэвэрлэсэн эсвэл handler алдсан) бүрэн БИШ — зарим өөрчлөлт алга байж болно.";
                return true;
            }
            if (trackingGapThrough > fromSeqExclusive)
            {
                reason = "Бүртгэл энэ мужид түр унтраалттай байсан — тэр үеийн өөрчлөлт бүртгэгдээгүй.";
                return true;
            }
            return false;
        }
    }
}
