using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.SheetNumerator.Core
{
    /// <summary>Тооцооны оролт — Revit-гүй, цэвэр.</summary>
    public sealed class NumberingInput
    {
        public DocumentSnapshot Document { get; set; }

        /// <summary>Тооцоолж буй бүлэг (<see cref="SheetGroup.Sheets"/> = OriginalOrder).</summary>
        public SheetGroup Group { get; set; }

        /// <summary>WorkingOrder — хэрэглэгчийн зөөсөн дараалал (Group.Sheets-ийн сэлгэмэл).</summary>
        public IReadOnlyList<SheetSnapshot> WorkingOrder { get; set; }

        /// <summary>«Сонгосон хуудас» — WorkingOrder доторх индекс (-1 = сонголтгүй).</summary>
        public int SelectedIndex { get; set; } = -1;

        public RenumberSettings Settings { get; set; }

        /// <summary>Үл үзэгдэх тэмдгийн probe-ийн үр дүн; null/probe хийгээгүй бол функц боломжгүй.</summary>
        public MarkerCapabilities Markers { get; set; }
    }

    /// <summary>Нэг хуудасны төлөвлөсөн өөрчлөлт (урьдчилсан харалт).</summary>
    public sealed class PlannedRow
    {
        public PlannedRow(SheetSnapshot sheet, int index)
        {
            Sheet = sheet;
            Index = index;
            NewNumber = sheet.Number;
            BaseNumber = sheet.Number;
            NewName = sheet.Name;
            Writes = new List<ParameterWrite>();
            Issues = new List<ValidationIssue>();
        }

        public SheetSnapshot Sheet { get; }

        /// <summary>WorkingOrder доторх индекс.</summary>
        public int Index { get; }

        /// <summary>Энэ мөрөнд дугаарлалт хамаарна (Сонгосон хуудаснаас эхлэх үед өмнөх мөрүүд false).</summary>
        public bool Affected { get; set; }

        /// <summary>Эцсийн дугаар (маркертай бол маркерыг оруулаад).  Өөрчлөгдөөгүй бол анхных.</summary>
        public string NewNumber { get; set; }

        public string NewName { get; set; }

        /// <summary>
        /// Үл үзэгдэх тэмдэг НЭМЭГДЭХЭЭС ӨМНӨХ дугаар.  Хуудасны нэр, параметрт бичих утгын эх сурвалж нь ЭНЭ —
        /// давхардлыг ялгах тэмдэг нь зөвхөн SheetNumber-д л байх ёстой, нэр/параметрт гоожих ёсгүй.
        /// </summary>
        public string BaseNumber { get; set; }

        /// <summary>Үл үзэгдэх тэмдэгтэй бол оношилгооны хэлбэр «A-01⟦U+200B × 2⟧», үгүй бол null.</summary>
        public string NumberDiagnostic { get; set; }

        public bool MarkerAdded { get; set; }

        public PartsResult Parts { get; set; }

        public List<ParameterWrite> Writes { get; }
        public List<ValidationIssue> Issues { get; }

        public bool NumberChanged => !string.Equals(NewNumber, Sheet.Number, StringComparison.Ordinal);
        public bool NameChanged => !string.Equals(NewName, Sheet.Name, StringComparison.Ordinal);
        public bool IsChanged => NumberChanged || NameChanged || Writes.Count > 0;

        public IssueSeverity? MaxSeverity => Issues.MaxSeverity();
        public bool HasBlockingError => Issues.AnyBlocking();
    }

    /// <summary>Тооцооны үр дүн: мөр бүрийн шинэ дугаар/нэр/параметр + асуудлууд.  Revit-д юу ч бичихгүй.</summary>
    public sealed class RenumberPlan
    {
        public RenumberPlan(GroupKey group, EffectiveMode mode, IReadOnlyList<PlannedRow> rows, int startIndex)
        {
            Group = group;
            Mode = mode;
            Rows = rows;
            StartIndex = startIndex;
            GlobalIssues = new List<ValidationIssue>();
        }

        public GroupKey Group { get; }
        public EffectiveMode Mode { get; }
        public IReadOnlyList<PlannedRow> Rows { get; }
        public int StartIndex { get; }

        /// <summary>Тохиргоо, бүлгийн түвшний асуудлууд (SheetId = 0).</summary>
        public List<ValidationIssue> GlobalIssues { get; }

        public int ChangedCount => Rows.Count(r => r.IsChanged);
        public int NumberChangedCount => Rows.Count(r => r.NumberChanged);
        public int ErrorCount => Rows.Sum(r => r.Issues.Count(i => i.Severity == IssueSeverity.Error)) + GlobalIssues.Count(i => i.Severity == IssueSeverity.Error);
        public int WarningCount => Rows.Sum(r => r.Issues.Count(i => i.Severity == IssueSeverity.Warning)) + GlobalIssues.Count(i => i.Severity == IssueSeverity.Warning);

        public bool HasChanges => Rows.Any(r => r.IsChanged);
        public bool HasBlockingErrors => GlobalIssues.AnyBlocking() || Rows.Any(r => r.HasBlockingError);

        /// <summary>Урьдчилсан харалтад БАЙХ мөрүүд — өөрчлөгдөх мөр бүр.</summary>
        public IEnumerable<PlannedRow> ChangedRows => Rows.Where(r => r.IsChanged);

        /// <summary>Бүх асуудал (тест, дүгнэлт).</summary>
        public IEnumerable<ValidationIssue> AllIssues => GlobalIssues.Concat(Rows.SelectMany(r => r.Issues));
    }
}
