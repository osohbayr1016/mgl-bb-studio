using System;
using System.Globalization;

namespace RevitMcpAddin.ChangeImpact.Core
{
    /// <summary>Preview-ийн «шинэ эсэх» төлөв.  `Unknown` нь `Fresh` БИШ — баталгаажаагүй бол Apply хаалттай (fail-closed).</summary>
    public enum FreshnessState
    {
        Unknown = 0,
        Fresh,
        Stale,
    }

    /// <summary>
    /// Preview ШИНЭ эсэхийг шийдэх ЦЭВЭР дүрэм.
    ///
    ///   ⚠️ Өмнө нь `IsStale()` нь `try { … } catch { return false; }` ба `Fingerprint == null → false` гэж буцаадаг байв — «шалгаж чадаагүй» нь
    ///   «хуучраагүй» гэж ойлгогдож, хуучирсан preview-ийн Apply идэвхжиж болох байв.  Одоо зөвхөн ХУВААСАН нотолгоо л `Fresh`.
    /// </summary>
    public static class PreChangeFreshness
    {
        /// <summary>
        /// `previewStamp` = preview хийх үеийн загварын өөрчлөлтийн тэмдэг; `currentStamp` = одоогийнх (уншиж чадаагүй бол null/шидсэн).
        /// Аль нэг нь хоосон/уншигдаагүй → Unknown.  Тэнцүү → Fresh.  Өөр → Stale.
        /// </summary>
        public static FreshnessState FromStamps(string previewStamp, Func<string> currentStamp)
        {
            if (string.IsNullOrEmpty(previewStamp)) return FreshnessState.Unknown;
            string now;
            try { now = currentStamp != null ? currentStamp() : null; }
            catch (Exception) { return FreshnessState.Unknown; }
            if (string.IsNullOrEmpty(now)) return FreshnessState.Unknown;
            return string.Equals(previewStamp, now, StringComparison.Ordinal) ? FreshnessState.Fresh : FreshnessState.Stale;
        }

        public static FreshnessState Of(PreChangeReport report, Func<string> currentStamp)
        {
            if (report == null || report.Fingerprint == null) return FreshnessState.Unknown;
            return FromStamps(report.Fingerprint.ModelStamp, currentStamp);
        }

        /// <summary>Аливаа шалгалтын функцийг (exception шидэж болох) аюулгүй дуудна: шидвэл Unknown.</summary>
        public static FreshnessState Probe(Func<FreshnessState> check)
        {
            try { return check != null ? check() : FreshnessState.Unknown; }
            catch (Exception) { return FreshnessState.Unknown; }
        }

        public const string UnknownNotice = "⚠ Preview-ийн одоогийн төлөвийг баталгаажуулж чадсангүй. Дахин шалгана уу.";
    }

    public enum ApplyTone
    {
        None = 0,
        Green,
        Amber,
        Red,
        Gray,
    }

    public sealed class ApplyGateInput
    {
        public MoveDecision Decision { get; set; }
        public FreshnessState Freshness { get; set; } = FreshnessState.Unknown;
        /// <summary>Preview/Apply ажиллаж байна.</summary>
        public bool Busy { get; set; }
        public double DistanceMm { get; set; }
    }

    /// <summary>Үндсэн товчийн төлөв.  Мөр бүр «яг юу болохыг» хэлнэ.</summary>
    public sealed class ApplyGateResult
    {
        public bool PrimaryEnabled { get; set; }
        public string PrimaryLabel { get; set; }
        public ApplyTone Tone { get; set; }
        /// <summary>Яагаад идэвхгүй вэ / юуг анхаарах вэ (UI-д жижиг тайлбар).</summary>
        public string Hint { get; set; }
        /// <summary>«Яагаад?» хоёрдогч товч (🔴).</summary>
        public bool ShowWhy { get; set; }
        /// <summary>«Дахин шалгах» / «Шалгалтыг гүйцээх» хоёрдогч товч.</summary>
        public bool ShowRecheck { get; set; }
        public string RecheckLabel { get; set; }
    }

    /// <summary>
    /// Үндсэн «зөөх» товч яг хэзээ идэвхжихийг шийднэ — ЦЭВЭР, тестлэгдэнэ.
    ///
    ///   Дараалал: preview алга → ажиллаж байна → freshness (Unknown/Stale ХААЛТТАЙ) → түр дүн (ХААЛТТАЙ) → 🔴 ХААЛТТАЙ → ⚪ ХААЛТТАЙ → 🟠 «Хянаад N мм зөөх» → 🟢 «N мм зөөх».
    ///
    ///   Хүчээр давах (override) ЗОРИУД БАЙХГҮЙ: 🔴/⚪ дээр «мэдсээр байж» гэсэн товч нэмэхгүй (v1.16).  Ногоон/шар л идэвхтэй.
    /// </summary>
    public static class PreChangeApplyGate
    {
        public static ApplyGateResult Evaluate(ApplyGateInput inp)
        {
            if (inp == null) inp = new ApplyGateInput();
            MoveDecision d = inp.Decision;
            string mm = Math.Round(inp.DistanceMm).ToString("0", CultureInfo.InvariantCulture) + " мм";

            if (d == null)
                return new ApplyGateResult { PrimaryLabel = "Эхлээд нөлөөллийг шалгана", Tone = ApplyTone.Gray };

            if (inp.Busy)
                return new ApplyGateResult { PrimaryLabel = "Шалгаж байна…", Tone = ApplyTone.Gray };

            if (inp.Freshness == FreshnessState.Stale)
                return new ApplyGateResult
                {
                    PrimaryLabel = "Дахин шалгана", Tone = ApplyTone.Gray, Hint = PreChangeText.StalePreview,
                    ShowRecheck = true, RecheckLabel = "Дахин шалгах",
                };
            if (inp.Freshness != FreshnessState.Fresh)
                return new ApplyGateResult
                {
                    PrimaryLabel = "Дахин шалгана", Tone = ApplyTone.Gray, Hint = PreChangeFreshness.UnknownNotice,
                    ShowRecheck = true, RecheckLabel = "Дахин шалгах",
                };

            if (!d.IsFinal || d.IsPending)
                return new ApplyGateResult { PrimaryLabel = "Эцсийн дүн хүлээж байна…", Tone = ApplyTone.Gray, Hint = "Түр дүн — гүн шалгалт (MEP, гарц, хуудас) дуустал зөөх боломжгүй." };

            switch (d.Verdict)
            {
                case MoveVerdict.DoNotMove:
                    return new ApplyGateResult { PrimaryLabel = "Зөөхгүй", Tone = ApplyTone.Red, Hint = "Батлагдсан ноцтой үр дагавартай тул зөөх товч идэвхгүй.", ShowWhy = true };
                case MoveVerdict.Unknown:
                    return new ApplyGateResult
                    {
                        PrimaryLabel = "Дүгнэх боломжгүй", Tone = ApplyTone.Gray, Hint = "Шаардлагатай шалгалт дуусаагүй тул зөөх товч идэвхгүй.",
                        ShowWhy = true, ShowRecheck = true, RecheckLabel = "Шалгалтыг гүйцээх",
                    };
                case MoveVerdict.MoveWithReview:
                    return new ApplyGateResult { PrimaryEnabled = true, PrimaryLabel = "Хянаад " + mm + " зөөх", Tone = ApplyTone.Amber };
                default:
                    return new ApplyGateResult { PrimaryEnabled = true, PrimaryLabel = mm + " зөөх", Tone = ApplyTone.Green };
            }
        }
    }
}
