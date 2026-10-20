using System;
using System.Linq;

namespace RevitMcpAddin.ChangeImpact.Core
{
    public enum StaleReason
    {
        None = 0,
        NoFingerprint,
        DocumentChanged,
        SourceMissing,
        SourceMoved,
        TypeChanged,
        VectorChanged,
        DependenciesChanged,
        ModelChanged,
        /// <summary>Линк/гарцын тохиргоог уншиж чадсангүй — «хуучраагүй» гэж батлах боломжгүй (fail-closed).</summary>
        Unverifiable,
    }

    public sealed class StaleVerdict
    {
        public bool IsStale { get { return Reason != StaleReason.None; } }
        public StaleReason Reason { get; set; }
        public string Message { get; set; }
    }

    /// <summary>
    /// Preview хуучирсан эсэх (Apply дарах мөчид) — ЦЭВЭР.  Хуучирсан preview-г ХЭЗЭЭ Ч чимээгүй хэрэгжүүлэхгүй.
    ///
    /// Дараалал нь «хамгийн тодорхой шалтгаан эхэнд»: эх элемент устсан → файл солигдсон → эх хөдөлсөн → төрөл → вектор → хамаарал →
    /// загварын ерөнхий өөрчлөлтийн тоолуур.  Тоолуур (`ModelStamp`) өөрчлөгдсөн бол аль ч нөхцөл тодорхойгүй ч дахин шалгана
    /// (аюулгүй тал): хэрэглэгч өөр зүйл засах нь preview-ийн хамаарлыг өөрчилсөн байж болно.
    /// </summary>
    public static class PreChangeStale
    {
        public static StaleVerdict Evaluate(PreChangeFingerprint preview, PreChangeFingerprint current, PreChangeRequest intended)
        {
            if (preview == null) return Stale(StaleReason.NoFingerprint, "Preview-ийн хурууны хээ алга");
            if (current == null) return Stale(StaleReason.NoFingerprint, "Одоогийн төлөвийг уншиж чадсангүй");

            if (!string.Equals(preview.DocumentId, current.DocumentId, StringComparison.Ordinal))
                return Stale(StaleReason.DocumentChanged, "Идэвхтэй файл солигдсон");
            PreChangeOperationKind op = PreChangeOperations.Of(intended);
            string cap = PreChangeOperations.NounCap(op);
            if (!current.SourceExists || !string.Equals(preview.SourceUid, current.SourceUid, StringComparison.Ordinal) || preview.SourceId != current.SourceId)
                return Stale(StaleReason.SourceMissing, cap + " устсан эсвэл солигдсон");
            if (!SameLocation(preview.Location, current.Location))
                return Stale(StaleReason.SourceMoved, cap + " preview хийснээс хойш хөдөлсөн");
            if (preview.TypeId != current.TypeId)
                return Stale(StaleReason.TypeChanged, (op == PreChangeOperationKind.DoorMove ? "Хаалганы" : "Хананы") + " төрөл солигдсон");
            if (intended != null && !SameVector(preview.VectorMm, intended.VectorMm))
                return Stale(StaleReason.VectorChanged, "Зөөх зай/чиглэл preview-ээс өөр");
            if (!string.Equals(preview.DependencyHash, current.DependencyHash, StringComparison.Ordinal))
                return Stale(StaleReason.DependenciesChanged, op == PreChangeOperationKind.DoorMove
                    ? "Хаалгатай холбоотой бүтэц (хост, нүх, өрөө) өөрчлөгдсөн"
                    : "Ханатай холбоотой бүтэц (хаалга, өрөө, join) өөрчлөгдсөн");
            if (!string.Equals(preview.ModelStamp, current.ModelStamp, StringComparison.Ordinal))
                return Stale(StaleReason.ModelChanged, "Загварт өөрчлөлт орсон");
            // Уншиж чадаагүй (хоёр талд ижил «unverifiable» тэмдэг ч) тэнцүү гэж ҮЗЭХГҮЙ — «хуучраагүй» гэж батлах боломжгүй.
            if (IsUnverifiable(preview) || IsUnverifiable(current))
                return new StaleVerdict { Reason = StaleReason.Unverifiable, Message = PreChangeFreshness.UnknownNotice };
            // Линк (unload/зөөх/шинэчлэх) ба гарцын тохиргоо нь host-ын `DocumentChanged`-д ордоггүй — тэмдгээс тусад нь тулгана.
            if (!string.Equals(preview.LinkSignature ?? "", current.LinkSignature ?? "", StringComparison.Ordinal))
                return Stale(StaleReason.ModelChanged, "Линк загвар өөрчлөгдсөн");
            if (!string.Equals(preview.ConfigSignature ?? "", current.ConfigSignature ?? "", StringComparison.Ordinal))
                return Stale(StaleReason.ModelChanged, "Гарцын тохиргоо өөрчлөгдсөн");

            return new StaleVerdict { Reason = StaleReason.None };
        }

        private static bool IsUnverifiable(PreChangeFingerprint f)
        {
            return string.Equals(f.LinkSignature, PreChangeCacheKey.Unverifiable, StringComparison.Ordinal)
                || string.Equals(f.ConfigSignature, PreChangeCacheKey.Unverifiable, StringComparison.Ordinal);
        }

        private static StaleVerdict Stale(StaleReason reason, string detail)
        {
            return new StaleVerdict { Reason = reason, Message = PreChangeText.StalePreview + " (" + detail + ")" };
        }

        private static bool SameLocation(double[] a, double[] b)
        {
            if (a == null || b == null) return a == null && b == null;
            if (a.Length != b.Length) return false;
            for (int i = 0; i < a.Length; i++)
                if (Math.Abs(a[i] - b[i]) > PreChangeTolerance.LengthMm) return false;
            return true;
        }

        private static bool SameVector(double[] a, double[] b)
        {
            if (a == null || b == null) return false;
            return PreChangeTolerance.SameVectorMm(a, b);
        }

        /// <summary>Байрлал, вектор, хамаарлын хэшийг тогтвортой болгох — хүлцэлд квантлана.</summary>
        public static string Hash(params string[] parts)
        {
            return RevitMcpAddin.Smart.Core.SmartHash.Short(string.Join("|", parts ?? new string[0]));
        }

        public static string LocationKey(double[] loc)
        {
            if (loc == null) return "-";
            return string.Join(",", loc.Select(v => PreChangeTolerance.Quantize(v, PreChangeTolerance.LengthMm).ToString("0.#", System.Globalization.CultureInfo.InvariantCulture)));
        }
    }
}
