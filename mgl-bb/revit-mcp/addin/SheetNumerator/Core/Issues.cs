using System;
using System.Collections.Generic;

// «Зургийн хуудас дугаарлах» (SheetNumerator) — ЦЭВЭР логикийн давхарга.
//
// ⚠️ `SheetNumerator/Core/` дотор `Autodesk.Revit` эсвэл `System.Windows` ХЭЗЭЭ Ч гарч болохгүй:
// `tests/SheetNumerator.Tests` эдгээр файлыг шууд эмхэтгэдэг (Revit-гүй машин дээр ч ажиллана).
// Revit-тэй харьцах бүх зүйл `SheetNumerator/Revit/`-д, WPF нь `SheetNumerator/Ui/`-д.
//
// ⚠️ net48 (Revit 2024)-д ч эмхэтгэгдэнэ: `init`, record, Range/Index, Math.Clamp, Dictionary.TryAdd,
// HashCode.Combine, string.Contains(string, StringComparison) ЗЭРЭГ net48-д байхгүй зүйл ашиглахгүй.
namespace RevitMcpAddin.SheetNumerator.Core
{
    /// <summary>Асуудлын ноцтой байдал.  <see cref="Error"/> нь «Хэрэгжүүлэх»-ийг хаана.</summary>
    public enum IssueSeverity
    {
        Info = 0,
        Warning = 1,
        Error = 2,
    }

    /// <summary>Асуудлын код — тест болон UI-ийн дүрс сонгоход.  Текст нь <see cref="ValidationIssue.Message"/>-д.</summary>
    public enum IssueCode
    {
        // ── Хаадаг алдаа ─────────────────────────────────────────────
        DuplicateNumber,
        EmptyNumber,
        ProhibitedCharacter,
        ProhibitedNameCharacter,
        MissingParameter,
        ReadOnlyTarget,
        IncompatibleTarget,
        InvalidNumericConversion,
        NoNumericToken,
        TokenIndexOutOfRange,
        TokenTooLong,
        NumericOverflow,
        PartLimitExceeded,
        SettingsInvalid,
        SheetDeleted,
        SheetChanged,
        MarkerUnavailable,
        MarkerExhausted,

        // ── Анхааруулга ──────────────────────────────────────────────
        MultipleNumericTokens,
        TokenBecameNegative,
        ContainsInvisibleMarker,
        WorkingOrderDiffers,
        PlaceholderSheet,
        EmptyParameterValue,
        NumberTrimmed,
        EmptyGeneratedText,

        // ── Мэдээлэл ─────────────────────────────────────────────────
        MarkerAdded,
        ExternalChange,
    }

    /// <summary>Нэг хуудас (эсвэл бүхэл тохиргоо)-тай холбоотой нэг асуудал.</summary>
    public sealed class ValidationIssue
    {
        public ValidationIssue(IssueSeverity severity, IssueCode code, string message, long sheetId = 0)
        {
            Severity = severity;
            Code = code;
            Message = message ?? string.Empty;
            SheetId = sheetId;
        }

        public IssueSeverity Severity { get; }
        public IssueCode Code { get; }
        public string Message { get; }

        /// <summary>0 = ямар нэг хуудсанд хамаарахгүй (тохиргооны/бүлгийн түвшин).</summary>
        public long SheetId { get; }

        public bool IsBlocking => Severity == IssueSeverity.Error;

        /// <summary>Тохиргооны асуудал бол холбогдох талбар («simple.start», «part2.limit») — UI inline алдаа харуулахад.</summary>
        public string Field { get; set; }

        public override string ToString()
        {
            return Severity + "/" + Code + (SheetId != 0 ? "#" + SheetId : "") + ": " + Message;
        }

        public static ValidationIssue Error(IssueCode code, string message, long sheetId = 0)
        {
            return new ValidationIssue(IssueSeverity.Error, code, message, sheetId);
        }

        public static ValidationIssue Warning(IssueCode code, string message, long sheetId = 0)
        {
            return new ValidationIssue(IssueSeverity.Warning, code, message, sheetId);
        }

        public static ValidationIssue Info(IssueCode code, string message, long sheetId = 0)
        {
            return new ValidationIssue(IssueSeverity.Info, code, message, sheetId);
        }
    }

    /// <summary>Асуудлын жагсаалтын туслахууд.</summary>
    public static class IssueExtensions
    {
        public static IssueSeverity? MaxSeverity(this IEnumerable<ValidationIssue> issues)
        {
            IssueSeverity? best = null;
            if (issues == null)
                return null;
            foreach (ValidationIssue i in issues)
            {
                if (best == null || i.Severity > best.Value)
                    best = i.Severity;
            }
            return best;
        }

        public static bool AnyBlocking(this IEnumerable<ValidationIssue> issues)
        {
            if (issues == null)
                return false;
            foreach (ValidationIssue i in issues)
            {
                if (i.IsBlocking)
                    return true;
            }
            return false;
        }
    }
}
