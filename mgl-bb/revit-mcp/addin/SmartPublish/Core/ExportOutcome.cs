using System;
using System.Collections.Generic;

namespace RevitMcpAddin.SmartPublish.Core
{
    /// <summary>Нэг экспортын дуудлагын ДҮН — «true/false» БИШ: ямар шалтгаанаар, дахин оролдох уу.</summary>
    public sealed class ExportOutcome
    {
        /// <summary>Revit-ийн `Export` дуудагдсан.</summary>
        public bool Called { get; set; }
        /// <summary>Revit `true` буцаасан.  PDF-д `false` = ямар нэг харагдац бүтэлгүйтсэн (зарим файл үүссэн байж болно).</summary>
        public bool RevitSaidTrue { get; set; }
        public PublishFailureCode? Failure { get; set; }
        public string Message { get; set; }
        public string ExceptionType { get; set; }
        public bool Retryable { get; set; }

        internal static ExportOutcome Ok()
        {
            return new ExportOutcome { Called = true, RevitSaidTrue = true };
        }

        internal static ExportOutcome Fail(PublishFailureCode code, string message, Exception ex = null, bool retryable = false, bool called = false)
        {
            return new ExportOutcome
            {
                Called = called,
                Failure = code,
                Message = message,
                ExceptionType = ex != null ? ex.GetType().Name : null,
                Retryable = retryable,
            };
        }
    }


    /// <summary>`ExportOutcome` + файлын шалгалтаас → артифактын эцсийн ШИЙДЭЛ (ЦЭВЭР, тестлэгдэнэ).</summary>
    public sealed class ArtifactVerdict
    {
        public ArtifactStatus Status { get; set; }
        public PublishFailureCode Code { get; set; }
        public string Message { get; set; }
        public bool Retryable { get; set; }
        public string ExceptionType { get; set; }
        public bool Validated { get; set; }
        public string Path { get; set; }
        public long SizeBytes { get; set; }
        public DateTime? CreatedUtc { get; set; }
        public List<string> Notes { get; set; } = new List<string>();
        /// <summary>
        /// Бүтэлгүйтсэн ч ЭНЭ экспортоор үүссэн/шинэчлэгдсэн (бүрэн бус байж болзошгүй) файлын зам.  Экспортоос ӨМНӨ байсан, шинэчлэгдээгүй
        /// (хуучин/өөр хүний) файл ЭНД ОРОХГҮЙ — дахин оролдлого зөвхөн энэ замыг дарж бичнэ.
        /// </summary>
        public string PartialPath { get; set; }
    }

    /// <summary>
    /// «Revit юу гэв» + «файл бодитоор юу болсон»-оос артифактыг ХАРИУЦЛАГАТАЙ ангилна.
    ///
    ///   • Exception        → Failed (хэсэгчилсэн файл үүссэн бол ЗАМЫГ тэмдэглэнэ, УСТГАХГҮЙ)
    ///   • Revit `false`    → Failed (PDF-д: ямар нэг харагдац бүтэлгүй; зарим файл үүссэн байж болно)
    ///   • `true`, файл алга/хоосон/хуучин → Failed (худал амжилт зарлахгүй)
    ///   • `true`, файл шинэ, хоосон биш   → Succeeded (БАЙДАЛ шалгагдсан; агуулгын зөв байдал БИШ)
    /// </summary>
    public static class ArtifactClassifier
    {
        /// <summary>
        /// Файл ЭНЭ экспортоор үүссэн/шинэчлэгдсэн үү.  `Ok` нь үргэлж шинэ гэсэн үг; `Fresh` нь Ok биш (хоосон 0 байт) ч шинэ файлыг таниулна.
        /// Экспортоос ӨМНӨ байсан, шинэчлэгдээгүй файл ЭНД ОРОХГҮЙ (хуучин/өөр хүний файлыг «манай хэсэгчилсэн файл» гэж таслахгүй).
        /// </summary>
        private static bool Ours(ArtifactCheck check)
        {
            return check != null && !string.IsNullOrEmpty(check.Path) && (check.Ok || check.Fresh);
        }

        public static ArtifactVerdict Classify(ExportOutcome outcome, ArtifactCheck check, string expectedPath, int memberCount)
        {
            var v = new ArtifactVerdict { Path = expectedPath };

            if (outcome.Failure.HasValue)
            {
                v.Status = ArtifactStatus.Failed;
                v.Code = outcome.Failure.Value;
                v.Message = outcome.Message;
                v.Retryable = outcome.Retryable;
                v.ExceptionType = outcome.ExceptionType;
                if (Ours(check))
                {
                    v.Path = check.Path;
                    v.PartialPath = check.Path;
                    v.SizeBytes = check.Length;
                    v.CreatedUtc = check.LastWriteUtc;       // хэмжээ + өөрчилсөн цаг = «энэ нь бидний үлдээсэн файл хэвээр үү» гэж дахин оролдлогод шалгах хурууны хээ
                    v.Notes.Add("Экспорт алдаатай дууссан ч файл үүссэн (хэсэгчилсэн/бүрэн бус байж болзошгүй): " + System.IO.Path.GetFileName(v.Path));
                }
                return v;
            }

            if (!outcome.RevitSaidTrue)
            {
                v.Status = ArtifactStatus.Failed;
                v.Code = PublishFailureCode.ExportRejected;
                v.Retryable = true;
                v.Message = memberCount > 1
                    ? "Revit нэгтгэсэн экспортыг амжилтгүй гэж мэдээллээ (ядаж нэг харагдац экспортлогдоогүй)."
                    : "Revit экспортыг амжилтгүй гэж мэдээллээ.";
                if (Ours(check))
                {
                    v.Path = check.Path;
                    v.PartialPath = check.Path;
                    v.SizeBytes = check.Length;
                    v.CreatedUtc = check.LastWriteUtc;
                    v.Notes.Add("Файл үүссэн (" + System.IO.Path.GetFileName(check.Path) + ") ч Revit экспортыг амжилтгүй гэж мэдээлсэн — хэсэгчилсэн байж болзошгүй.");
                }
                return v;
            }

            if (check == null || !check.Ok)
            {
                v.Status = ArtifactStatus.Failed;
                v.Code = check != null ? check.Code : PublishFailureCode.MissingArtifact;
                v.Message = check != null ? check.Note : "Файлыг шалгаж чадсангүй.";
                v.Retryable = true;
                // Хоосон (0 байт) ч ШИНЭЭР үүссэн файл = манай үлдэгдэл; хуучин (шинэчлэгдээгүй) файл БИШ.
                if (Ours(check))
                {
                    v.PartialPath = check.Path;
                    v.SizeBytes = check.Length;
                    v.CreatedUtc = check.LastWriteUtc;
                }
                return v;
            }

            v.Status = ArtifactStatus.Succeeded;
            v.Validated = true;
            v.Path = check.Path;
            v.SizeBytes = check.Length;
            v.CreatedUtc = check.LastWriteUtc;
            if (!string.IsNullOrEmpty(check.Note)) v.Notes.Add(check.Note);
            return v;
        }
    }
}
