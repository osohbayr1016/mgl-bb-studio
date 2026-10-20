using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace RevitMcpAddin.SheetNumerator.Core
{
    /// <summary>
    /// Дугаарлалтын ЦЭВЭР хөдөлгүүр: snapshot + тохиргоо + WorkingOrder → <see cref="RenumberPlan"/>.
    ///
    /// ⚠️ Revit-ийн модельд ЮУ Ч БИЧИХГҮЙ, Revit-ийн API ДУУДАХГҮЙ — урьдчилсан харалт нь хуудас бүр дээр
    /// түр утга бичихгүй (тест, preview, apply бүгд ЭНЭ ГАНЦ хөдөлгүүрээс).  Preview нь ҮРГЭЛЖ snapshot-ын
    /// АНХНЫ утга + одоогийн тохиргооноос тооцогдоно → дахин тооцоход угтвар/дагавар давхарлагдахгүй.
    ///
    /// Дараалал: тохиргооны шалгалт → (горимоор) үндсэн дугаар → параметрийн угтвар/дагавар → тайрах/шалгах →
    /// (сонголтоор) үл үзэгдэх тэмдгээр давхардал ялгах → давхардал (БҮХ хуудастай) → нэр → параметр бичих.
    /// </summary>
    public static class NumberingEngine
    {
        public static RenumberPlan Compute(NumberingInput input)
        {
            RenumberSettings s = input.Settings;
            DocumentSnapshot doc = input.Document;
            IReadOnlyList<SheetSnapshot> order = input.WorkingOrder ?? new SheetSnapshot[0];
            EffectiveMode mode = s.EffectiveMode;

            var rows = new List<PlannedRow>(order.Count);
            for (int i = 0; i < order.Count; i++)
                rows.Add(new PlannedRow(order[i], i));

            int start = 0;
            if (s.StartFromSelected && mode != EffectiveMode.Move && mode != EffectiveMode.CleanMarkers
                && input.SelectedIndex >= 0)
            {
                start = Math.Min(input.SelectedIndex, order.Count);
            }

            var plan = new RenumberPlan(input.Group != null ? input.Group.Key : null, mode, rows, start);

            // Дараалал Browser-оос өөр (Move горимд энэ нь ХЭВИЙН — шалтгаан нь дугаар дагаж байгаа).
            if (input.Group != null && mode != EffectiveMode.Move && OrderDiffers(input.Group.Sheets, order))
                plan.GlobalIssues.Add(ValidationIssue.Warning(IssueCode.WorkingOrderDiffers, Msg.WorkingOrderDiffers));

            List<ValidationIssue> settingsIssues = SettingsValidator.Validate(s, doc, input.Markers);
            plan.GlobalIssues.AddRange(settingsIssues);
            if (settingsIssues.AnyBlocking())
                return plan;   // Тохиргоо буруу — юу ч үүсгэхгүй, мөрүүд хэвээр.

            for (int i = start; i < rows.Count; i++)
                rows[i].Affected = true;

            switch (mode)
            {
                case EffectiveMode.Move:
                    GenerateMove(input, rows);
                    break;
                case EffectiveMode.Shift:
                    GenerateShift(s, rows, start);
                    break;
                case EffectiveMode.CleanMarkers:
                    GenerateClean(rows, start);
                    break;
                case EffectiveMode.Advanced:
                    GenerateAdvanced(s, doc, rows, start);
                    break;
                default:
                    GenerateSimple(s, doc, rows, start);
                    break;
            }

            // Placeholder: зөвхөн ӨӨРЧЛӨГДӨЖ буй үед сануулна (хэвийн үед жагсаалтын «Placeholder» тэмдэг л).
            foreach (PlannedRow r in rows)
            {
                if (r.Sheet.IsPlaceholder && r.Affected && r.NumberChanged)
                    r.Issues.Add(ValidationIssue.Warning(IssueCode.PlaceholderSheet, Msg.PlaceholderSheet, r.Sheet.SheetId));
            }

            if (s.UseUnicodeMarkers && (mode == EffectiveMode.Simple || mode == EffectiveMode.Advanced || mode == EffectiveMode.Shift))
                DisambiguateWithMarkers(s, doc, rows);

            foreach (PlannedRow r in rows)
            {
                if (r.NumberChanged && UnicodeMarkers.ContainsMarker(r.NewNumber))
                {
                    r.NumberDiagnostic = UnicodeMarkers.Escape(r.NewNumber);
                    if (!r.MarkerAdded)
                        r.Issues.Add(ValidationIssue.Warning(IssueCode.ContainsInvisibleMarker, Msg.ContainsMarker(r.NumberDiagnostic), r.Sheet.SheetId));
                }
                else if (!r.NumberChanged && UnicodeMarkers.ContainsMarker(r.Sheet.Number) && r.Affected)
                {
                    r.NumberDiagnostic = UnicodeMarkers.Escape(r.Sheet.Number);
                }
            }

            // «Үл үзэгдэх тэмдэг цэвэрлэх» нь тусдаа, санаатай команд — нэр/параметр бичих сонголтыг ХЭРЭГЛЭХГҮЙ.
            if (mode != EffectiveMode.CleanMarkers)
            {
                ApplyNameNumbering(s, rows);
                ApplyParameterWrites(s, doc, rows, mode);
            }
            ValidateDuplicates(doc, rows);

            return plan;
        }

        // ══════════════════════════════════════════════════════════════
        //  Горим бүрийн үндсэн дугаар
        // ══════════════════════════════════════════════════════════════

        private static void GenerateSimple(RenumberSettings s, DocumentSnapshot doc, List<PlannedRow> rows, int start)
        {
            SimpleNumberingSettings simple = s.Simple;
            for (int i = start; i < rows.Count; i++)
            {
                PlannedRow row = rows[i];
                int k = i - start;
                var parts = new PartsResult();
                parts.Present[0] = true;

                if (simple.UseStartNumber)
                {
                    long v;
                    if (!NumberFormatting.TryAddScaled(simple.Start, 1, k, out v))
                    {
                        AddError(row, IssueCode.NumericOverflow, Msg.NumericOverflow);
                        continue;
                    }
                    string num = NumberFormatting.Format(v, simple.Width);
                    parts.Number[0] = num;
                    parts.Values[0] = v;
                    parts.Full[0] = simple.Prefix + num + simple.Suffix;
                }
                else
                {
                    parts.Number[0] = row.Sheet.Number;
                    parts.Full[0] = simple.Prefix + row.Sheet.Number + simple.Suffix;
                }
                parts.Composite = parts.Full[0];
                row.Parts = parts;

                FinishGenerated(s, row, parts.Composite, true);
            }
        }

        private static void GenerateAdvanced(RenumberSettings s, DocumentSnapshot doc, List<PlannedRow> rows, int start)
        {
            var seq = new PartSequence(s.Advanced);
            for (int i = start; i < rows.Count; i++)
            {
                PlannedRow row = rows[i];
                PartsResult pr = seq.Current();
                seq.Advance();
                row.Parts = pr;

                if (pr.Overflow)
                {
                    AddError(row, IssueCode.NumericOverflow, Msg.NumericOverflow);
                    continue;
                }
                if (pr.LimitExceeded)
                {
                    AddError(row, IssueCode.PartLimitExceeded, Msg.PartLimitExceeded(pr.ExceededPart));
                    continue;
                }
                FinishGenerated(s, row, pr.Composite, true);
            }
        }

        private static void GenerateShift(RenumberSettings s, List<PlannedRow> rows, int start)
        {
            long delta = s.ShiftDirection >= 0 ? s.ShiftAmount : -s.ShiftAmount;
            for (int i = start; i < rows.Count; i++)
            {
                PlannedRow row = rows[i];
                ShiftResult r = ExistingNumberShift.Shift(row.Sheet.Number, delta, s.ShiftTokenIndex);
                if (!r.Success)
                {
                    switch (r.Error)
                    {
                        case ShiftError.NoNumericToken:
                            AddError(row, IssueCode.NoNumericToken, Msg.NoNumericToken);
                            break;
                        case ShiftError.TokenIndexOutOfRange:
                            AddError(row, IssueCode.TokenIndexOutOfRange, Msg.TokenIndexOutOfRange(r.UsedTokenIndex + 1));
                            break;
                        case ShiftError.TokenTooLong:
                            AddError(row, IssueCode.TokenTooLong, Msg.TokenTooLong);
                            break;
                        default:
                            AddError(row, IssueCode.NumericOverflow, Msg.NumericOverflow);
                            break;
                    }
                    continue;
                }

                if (r.MultipleTokens)
                {
                    row.Issues.Add(ValidationIssue.Warning(IssueCode.MultipleNumericTokens,
                        Msg.MultipleTokens(r.TokenCount, r.UsedTokenIndex + 1), row.Sheet.SheetId));
                }
                if (r.BecameNegative)
                    row.Issues.Add(ValidationIssue.Warning(IssueCode.TokenBecameNegative, Msg.TokenBecameNegative, row.Sheet.SheetId));

                FinishGenerated(s, row, r.Result, false);
            }
        }

        private static void GenerateClean(List<PlannedRow> rows, int start)
        {
            for (int i = start; i < rows.Count; i++)
            {
                PlannedRow row = rows[i];
                if (!UnicodeMarkers.ContainsMarker(row.Sheet.Number))
                    continue;
                string cleaned = UnicodeMarkers.RemoveKnownMarkers(row.Sheet.Number);
                FinishGenerated(null, row, cleaned, false);
            }
        }

        /// <summary>
        /// «Зөөхөд дугаар дагуулах»: бүлгийн АНХНЫ дугааруудын дараалал (OriginalOrder-ийн байрлал бүрийн дугаар)
        /// хэвээр, зөвхөн хуудсууд WorkingOrder-ийн дагуу тэдгээрийг авна.  Тоон задлал ШААРДАХГҮЙ — дугаарын
        /// СТРИНГ өөрөө дахин оноогдоно (A-001, «ЕХ-А», хэн хэнийг ч).  Тэмдэг, зай хөндөгдөхгүй.
        /// </summary>
        private static void GenerateMove(NumberingInput input, List<PlannedRow> rows)
        {
            IReadOnlyList<SheetSnapshot> original = input.Group != null ? input.Group.Sheets : null;
            if (original == null || original.Count != rows.Count)
                return;
            for (int i = 0; i < rows.Count; i++)
            {
                rows[i].NewNumber = original[i].Number;
                rows[i].BaseNumber = original[i].Number;
            }
        }

        // ══════════════════════════════════════════════════════════════
        //  Нийтлэг: параметрийн угтвар/дагавар, тайрах, шалгах
        // ══════════════════════════════════════════════════════════════

        /// <param name="applyAffix">Параметрийн угтвар/дагавар хэрэглэх (Энгийн/Нарийвчилсан горим).</param>
        private static void FinishGenerated(RenumberSettings s, PlannedRow row, string composite, bool applyAffix)
        {
            string text = composite;

            if (applyAffix && s != null)
            {
                string prefix = string.Empty;
                string suffix = string.Empty;
                bool failed = false;
                if (s.UseParameterPrefix)
                    failed |= !ResolveAffix(row, s.PrefixParameter, out prefix);
                if (s.UseParameterSuffix)
                    failed |= !ResolveAffix(row, s.SuffixParameter, out suffix);
                if (failed)
                    return; // Параметр байхгүй — мөр АЛДААТАЙ, дугаар өөрчлөгдөхгүй (гэнэтийн үр дүн гаргахгүй).
                text = prefix + text + suffix;
            }

            string normalized = RevitSheetRules.Normalize(text);
            if (!string.Equals(normalized, text, StringComparison.Ordinal))
                row.Issues.Add(ValidationIssue.Warning(IssueCode.NumberTrimmed, Msg.NumberTrimmed, row.Sheet.SheetId));

            if (normalized.Length == 0)
            {
                AddError(row, IssueCode.EmptyNumber, Msg.EmptyNumber);
                return;
            }

            IReadOnlyList<char> bad = RevitSheetRules.FindProhibited(normalized);
            if (bad.Count > 0)
            {
                AddError(row, IssueCode.ProhibitedCharacter, Msg.ProhibitedInNumber(RevitSheetRules.DescribeChars(bad)));
                return;
            }

            row.NewNumber = normalized;
            row.BaseNumber = normalized;
        }

        /// <summary>Параметрийн утгыг хуудаснаас уншина.  false = параметр хуудсанд БАЙХГҮЙ (алдаа нэмсэн).</summary>
        private static bool ResolveAffix(PlannedRow row, ParameterKey key, out string text)
        {
            bool present, hasValue;
            text = row.Sheet.GetParameterText(key, out present, out hasValue);
            if (!present)
            {
                text = string.Empty;
                AddError(row, IssueCode.MissingParameter, Msg.MissingParameterOnSheet(key != null ? key.ToString() : "?"));
                return false;
            }
            if (!hasValue || text.Length == 0)
            {
                text = string.Empty;
                row.Issues.Add(ValidationIssue.Warning(IssueCode.EmptyParameterValue,
                    Msg.EmptyParameterOnSheet(key.ToString()), row.Sheet.SheetId));
            }
            return true;
        }

        // ══════════════════════════════════════════════════════════════
        //  Үл үзэгдэх тэмдгээр давхардал ялгах
        // ══════════════════════════════════════════════════════════════

        /// <summary>
        /// Өөрчлөгдөж буй мөрүүдийг WorkingOrder-оор нь явж, тухайн ХҮРЭЭНД аль хэдийн эзлэгдсэн дугаартай давхцвал
        /// маркер (U+200B гэх мэт) × k нэмнэ.  Өөрчлөгдөөгүй (бусад бүлэг, нуугдсан, assembly, эхлэлээс өмнөх)
        /// хуудасны дугаарыг ХЭЗЭЭ Ч өөрчлөхгүй — тэд нь «эзлэгдсэн» олонлогийг үүсгэнэ; ижил дугаартай
        /// өөрчлөгдөж буй хоёр мөрөөс ЭХНИЙХ нь тэмдэггүй үлдэнэ.
        /// </summary>
        private static void DisambiguateWithMarkers(RenumberSettings s, DocumentSnapshot doc, List<PlannedRow> rows)
        {
            var changed = new HashSet<long>();
            foreach (PlannedRow r in rows)
            {
                if (r.NumberChanged)
                    changed.Add(r.Sheet.SheetId);
            }
            if (changed.Count == 0)
                return;

            var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (SheetSnapshot sh in doc.Sheets)
            {
                if (!changed.Contains(sh.SheetId))
                    used.Add(DuplicateValidationService.KeyOf(sh.ScopeKey(doc.Uniqueness), sh.Number));
            }
            // Бүлгийн хуудас doc.Sheets-д байхгүй (тест) бол тэдний өөрчлөгдөөгүй дугаарыг ч оруулна.
            foreach (PlannedRow r in rows)
            {
                if (!r.NumberChanged)
                    used.Add(DuplicateValidationService.KeyOf(r.Sheet.ScopeKey(doc.Uniqueness), r.Sheet.Number));
            }

            foreach (PlannedRow r in rows)
            {
                if (!r.NumberChanged)
                    continue;
                string scope = r.Sheet.ScopeKey(doc.Uniqueness);
                string key = DuplicateValidationService.KeyOf(scope, r.NewNumber);
                if (!used.Contains(key))
                {
                    used.Add(key);
                    continue;
                }

                int k;
                string unique = UnicodeMarkers.MakeUnique(r.NewNumber, s.MarkerChar,
                    cand => used.Contains(DuplicateValidationService.KeyOf(scope, cand)), 64, out k);
                if (unique == null)
                {
                    AddError(r, IssueCode.MarkerExhausted, Msg.MarkerExhausted);
                    continue;
                }
                r.NewNumber = unique;
                r.MarkerAdded = true;
                used.Add(DuplicateValidationService.KeyOf(scope, unique));
                r.Issues.Add(ValidationIssue.Info(IssueCode.MarkerAdded,
                    Msg.MarkerAdded(UnicodeMarkers.Escape(unique)), r.Sheet.SheetId));
            }
        }

        // ══════════════════════════════════════════════════════════════
        //  Хуудасны нэр, параметр бичих
        // ══════════════════════════════════════════════════════════════

        /// <summary>Эх сурвалж → бичвэр.  Хэсгийн эх сурвалж зөвхөн Энгийн/Нарийвчилсан горимд (шалгалт хийгдсэн).</summary>
        private static string SourceText(GeneratedValueSource src, PlannedRow row)
        {
            PartsResult p = row.Parts;
            switch (src)
            {
                case GeneratedValueSource.FullNumber:
                    return row.BaseNumber ?? row.NewNumber;
                case GeneratedValueSource.Part1Full:
                    return p != null ? p.Full[0] : string.Empty;
                case GeneratedValueSource.Part1Number:
                    return p != null ? p.Number[0] : string.Empty;
                case GeneratedValueSource.Part2Full:
                    return p != null ? p.Full[1] : string.Empty;
                case GeneratedValueSource.Part2Number:
                    return p != null ? p.Number[1] : string.Empty;
                case GeneratedValueSource.Part3Full:
                    return p != null ? p.Full[2] : string.Empty;
                case GeneratedValueSource.Part3Number:
                    return p != null ? p.Number[2] : string.Empty;
                default:
                    return string.Empty;
            }
        }

        private static void ApplyNameNumbering(RenumberSettings s, List<PlannedRow> rows)
        {
            if (!s.NameAtStart && !s.NameAtEnd)
                return;
            string sep = s.NameSeparator ?? string.Empty;

            foreach (PlannedRow row in rows)
            {
                if (!row.Affected || row.HasBlockingError)
                    continue;

                // Эх бичвэр нь ҮРГЭЛЖ snapshot-ын АНХНЫ нэр (preview-г дахин тооцоход давхарлагдахгүй).
                string gen = SourceText(s.NameSource, row);
                if (string.IsNullOrEmpty(gen))
                {
                    row.Issues.Add(ValidationIssue.Warning(IssueCode.EmptyGeneratedText, Msg.EmptyGeneratedText, row.Sheet.SheetId));
                    continue;
                }

                string name = row.Sheet.Name ?? string.Empty;
                if (s.NameAtStart)
                    name = gen + sep + name;
                if (s.NameAtEnd)
                    name = name + sep + gen;
                name = RevitSheetRules.Normalize(name);

                IReadOnlyList<char> bad = RevitSheetRules.FindProhibited(name);
                if (bad.Count > 0)
                {
                    AddError(row, IssueCode.ProhibitedNameCharacter, Msg.ProhibitedInName(RevitSheetRules.DescribeChars(bad)));
                    continue;
                }
                row.NewName = name;
            }
        }

        private static void ApplyParameterWrites(RenumberSettings s, DocumentSnapshot doc, List<PlannedRow> rows, EffectiveMode mode)
        {
            if (s.WriteResultToParameter && s.ResultParameter != null)
            {
                SheetParameterInfo target = doc.FindParameter(s.ResultParameter);
                foreach (PlannedRow row in rows)
                {
                    if (!row.Affected || row.HasBlockingError)
                        continue;
                    string text = SourceText(s.ResultSource, row);
                    AddWrite(row, target, text);
                }
            }

            if (s.WriteGroupCount && s.CountParameter != null)
            {
                SheetParameterInfo target = doc.FindParameter(s.CountParameter);
                string countText = rows.Count.ToString(CultureInfo.InvariantCulture);
                foreach (PlannedRow row in rows)
                {
                    if (!row.Affected || row.HasBlockingError)
                        continue;
                    AddWrite(row, target, countText);
                    if (s.CountScope == CountWriteScope.FirstSheet)
                        break; // эхний ӨӨРЧЛӨГДӨЖ БУЙ (Affected) хуудас л
                }
            }
        }

        private static void AddWrite(PlannedRow row, SheetParameterInfo target, string text)
        {
            // Хуудсанд тэр параметр байхгүй бол — «хаана байхгүйг» яг заана.
            bool present, hasValue;
            string current = row.Sheet.GetParameterText(target.Key, out present, out hasValue);
            if (!present)
            {
                AddError(row, IssueCode.MissingParameter, Msg.MissingParameterOnSheet(target.DisplayName));
                return;
            }

            ParameterWrite write;
            string error;
            if (!ParameterRules.TryConvert(target, text, out write, out error))
            {
                IssueCode code = target.ValueKind == ParamValueKind.Integer || target.ValueKind == ParamValueKind.Number
                    ? IssueCode.InvalidNumericConversion
                    : IssueCode.IncompatibleTarget;
                AddError(row, code, error);
                return;
            }

            // Утга аль хэдийн ижил бол өөрчлөлт биш (хэрэгжүүлсний дараах харалт «өөрчлөлтгүй» болно).
            if (ParameterRules.IsUnchanged(write, current, hasValue))
                return;
            row.Writes.Add(write);
        }

        // ══════════════════════════════════════════════════════════════
        //  Давхардал
        // ══════════════════════════════════════════════════════════════

        private static void ValidateDuplicates(DocumentSnapshot doc, List<PlannedRow> rows)
        {
            var projected = new Dictionary<long, string>();
            foreach (PlannedRow r in rows)
            {
                if (r.NumberChanged && !r.HasBlockingError)
                    projected[r.Sheet.SheetId] = r.NewNumber;
            }
            if (projected.Count == 0)
                return;

            // Бүх хуудас (doc) + бүлгийн хуудас (doc-д байхгүй бол).
            var entries = new List<NumberEntry>(doc.Sheets.Count + 4);
            var changed = new HashSet<long>(projected.Keys);
            var seen = new HashSet<long>();
            foreach (SheetSnapshot sh in doc.Sheets)
            {
                seen.Add(sh.SheetId);
                string p;
                string number = projected.TryGetValue(sh.SheetId, out p) ? p : sh.Number;
                entries.Add(new NumberEntry(sh.SheetId, number, sh.ScopeKey(doc.Uniqueness)));
            }
            foreach (PlannedRow r in rows)
            {
                if (seen.Add(r.Sheet.SheetId))
                {
                    string p;
                    string number = projected.TryGetValue(r.Sheet.SheetId, out p) ? p : r.Sheet.Number;
                    entries.Add(new NumberEntry(r.Sheet.SheetId, number, r.Sheet.ScopeKey(doc.Uniqueness)));
                }
            }

            IReadOnlyList<DuplicateHit> hits = DuplicateValidationService.Find(entries, changed);
            if (hits.Count == 0)
                return;

            Dictionary<long, PlannedRow> byId = rows.ToDictionary(r => r.Sheet.SheetId);
            foreach (ValidationIssue issue in DuplicateValidationService.ToIssues(hits, doc))
            {
                PlannedRow row;
                if (byId.TryGetValue(issue.SheetId, out row))
                    row.Issues.Add(issue);
            }
        }

        // ══════════════════════════════════════════════════════════════
        //  Туслахууд
        // ══════════════════════════════════════════════════════════════

        private static void AddError(PlannedRow row, IssueCode code, string message)
        {
            row.Issues.Add(ValidationIssue.Error(code, message, row.Sheet.SheetId));
        }

        /// <summary>WorkingOrder нь АНХНЫ дараалалтай ижил биш.</summary>
        public static bool OrderDiffers(IReadOnlyList<SheetSnapshot> original, IReadOnlyList<SheetSnapshot> working)
        {
            if (original.Count != working.Count)
                return true;
            for (int i = 0; i < original.Count; i++)
            {
                if (original[i].SheetId != working[i].SheetId)
                    return true;
            }
            return false;
        }
    }
}
