using System;
using System.Collections.Generic;

namespace RevitMcpAddin.SheetNumerator.Core
{
    /// <summary>
    /// Тохиргооны ШАЛГАЛТ.  Зөвхөн ОДООГИЙН (effective) горимд хамаарах хэсгийг шалгана — ашиглагдаагүй
    /// «Нарийвчилсан» таб дахь буруу утга энгийн дугаарлалтыг хаах ёсгүй.
    ///
    /// Алдаа бүр <see cref="ValidationIssue.Field"/>-тэй → UI тухайн талбарын дэргэд inline харуулна.
    /// </summary>
    public static class SettingsValidator
    {
        public static List<ValidationIssue> Validate(RenumberSettings s, DocumentSnapshot doc, MarkerCapabilities markers)
        {
            var issues = new List<ValidationIssue>();
            EffectiveMode mode = s.EffectiveMode;

            switch (mode)
            {
                case EffectiveMode.Simple:
                    ValidateSimple(s.Simple, issues);
                    break;
                case EffectiveMode.Advanced:
                    ValidateAdvanced(s.Advanced, issues);
                    break;
                case EffectiveMode.Shift:
                    if (s.ShiftAmount < 0 || s.ShiftAmount > NumberFormatting.MaxAbsValue)
                        Add(issues, "shift.amount", Msg.ValueOutOfRange);
                    if (s.ShiftTokenIndex < ExistingNumberShift.LastToken)
                        Add(issues, "shift.token", Msg.ValueOutOfRange);
                    break;
            }

            bool generates = mode == EffectiveMode.Simple || mode == EffectiveMode.Advanced;

            if (generates)
            {
                if (s.UseParameterPrefix)
                    CheckSource(s.PrefixParameter, doc, "affix.prefix", issues);
                if (s.UseParameterSuffix)
                    CheckSource(s.SuffixParameter, doc, "affix.suffix", issues);
            }

            // «Үл үзэгдэх тэмдэг цэвэрлэх» нь тусдаа команд — нэр/параметр бичих сонголт хамаарахгүй.
            bool extras = mode != EffectiveMode.CleanMarkers;

            if (extras && s.WriteResultToParameter)
            {
                CheckTarget(s.ResultParameter, doc, "write.parameter", issues);
                CheckSourceAllowed(s.ResultSource, mode, "write.source", issues);
            }

            if (extras && s.WriteGroupCount)
            {
                CheckTarget(s.CountParameter, doc, "count.parameter", issues);
                if (s.WriteResultToParameter && s.ResultParameter != null && s.CountParameter != null
                    && s.ResultParameter.Equals(s.CountParameter))
                {
                    Add(issues, "count.parameter", Msg.SameTargetParameter);
                }
            }

            if (extras && (s.NameAtStart || s.NameAtEnd))
            {
                CheckSourceAllowed(s.NameSource, mode, "name.source", issues);
                IReadOnlyList<char> bad = RevitSheetRules.FindProhibited(s.NameSeparator);
                if (bad.Count > 0)
                    Add(issues, "name.separator", Msg.ProhibitedInNameSeparator(RevitSheetRules.DescribeChars(bad)));
            }

            if (s.UseUnicodeMarkers && mode != EffectiveMode.CleanMarkers)
            {
                if (markers == null || !markers.IsProbed)
                    issues.Add(Field("markers.char", ValidationIssue.Error(IssueCode.MarkerUnavailable, Msg.MarkerNotProbed)));
                else if (!markers.IsAccepted(s.MarkerChar))
                    issues.Add(Field("markers.char", ValidationIssue.Error(IssueCode.MarkerUnavailable, Msg.MarkerNotAccepted)));
            }

            return issues;
        }

        // ── Энгийн ──────────────────────────────────────────────────
        private static void ValidateSimple(SimpleNumberingSettings simple, List<ValidationIssue> issues)
        {
            if (simple.UseStartNumber && !NumberFormatting.InRange(simple.Start))
                Add(issues, "simple.start", Msg.ValueOutOfRange);
            if (simple.Width < 0 || simple.Width > NumberFormatting.MaxWidth)
                Add(issues, "simple.width", Msg.WidthOutOfRange);
            CheckAffix(simple.Prefix, "simple.prefix", issues);
            CheckAffix(simple.Suffix, "simple.suffix", issues);
        }

        // ── Нарийвчилсан ────────────────────────────────────────────
        private static void ValidateAdvanced(AdvancedNumberingSettings adv, List<ValidationIssue> issues)
        {
            bool any = false;
            for (int i = 0; i < AdvancedNumberingSettings.PartCount; i++)
            {
                NumberPartSettings p = adv.Parts[i];
                if (!p.Enabled)
                    continue;
                any = true;
                string f = "part" + (i + 1) + ".";

                CheckAffix(p.Prefix, f + "prefix", issues);
                CheckAffix(p.Suffix, f + "suffix", issues);

                if (p.ValueMode == PartValueMode.None)
                    continue;

                if (!NumberFormatting.InRange(p.Start))
                    Add(issues, f + "start", Msg.ValueOutOfRange);
                if (p.Width < 0 || p.Width > NumberFormatting.MaxWidth)
                    Add(issues, f + "width", Msg.WidthOutOfRange);

                if (p.IsAdvancing)
                {
                    if (p.Step < 1 || p.Step > NumberFormatting.MaxAbsValue)
                        Add(issues, f + "step", Msg.StepOutOfRange);
                    if (p.Limit.HasValue)
                    {
                        if (!NumberFormatting.InRange(p.Limit.Value))
                            Add(issues, f + "limit", Msg.ValueOutOfRange);
                        else if (p.ValueMode == PartValueMode.Increment && p.Limit.Value < p.Start)
                            Add(issues, f + "limit", Msg.LimitBelowStart);
                        else if (p.ValueMode == PartValueMode.Decrement && p.Limit.Value > p.Start)
                            Add(issues, f + "limit", Msg.LimitAboveStart);
                    }
                }
            }

            if (!any)
                Add(issues, "part1.enabled", Msg.NoPartEnabled);

            for (int i = 0; i < adv.Separators.Length; i++)
                CheckAffix(adv.Separators[i], "separator" + (i + 1), issues);
        }

        // ── Туслахууд ───────────────────────────────────────────────
        private static void CheckAffix(string text, string field, List<ValidationIssue> issues)
        {
            IReadOnlyList<char> bad = RevitSheetRules.FindProhibited(text);
            if (bad.Count > 0)
                Add(issues, field, Msg.ProhibitedInSetting(RevitSheetRules.DescribeChars(bad)));
        }

        private static void CheckSource(ParameterKey key, DocumentSnapshot doc, string field, List<ValidationIssue> issues)
        {
            if (key == null)
            {
                Add(issues, field, Msg.ParameterNotSelected);
                return;
            }
            if (doc.FindParameter(key) == null)
                Add(issues, field, Msg.ParameterNotFound(key.ToString()));
        }

        private static void CheckTarget(ParameterKey key, DocumentSnapshot doc, string field, List<ValidationIssue> issues)
        {
            if (key == null)
            {
                Add(issues, field, Msg.ParameterNotSelected);
                return;
            }
            SheetParameterInfo info = doc.FindParameter(key);
            if (info == null)
            {
                Add(issues, field, Msg.ParameterNotFound(key.ToString()));
                return;
            }
            if (info.IsReadOnly)
                Add(issues, field, Msg.TargetReadOnly(info.DisplayName));
            else if (!info.IsWritable)
                Add(issues, field, Msg.TargetIncompatible(info.DisplayName));
        }

        /// <summary>Хэсгийн эх сурвалж (Part N) нь Нарийвчилсан горимд л байна; Энгийнд 1-р хэсэг; бусдад зөвхөн бүтэн дугаар.</summary>
        public static bool IsSourceAllowed(GeneratedValueSource source, EffectiveMode mode)
        {
            if (source == GeneratedValueSource.FullNumber)
                return true;
            if (mode == EffectiveMode.Advanced)
                return true;
            if (mode == EffectiveMode.Simple)
                return source == GeneratedValueSource.Part1Full || source == GeneratedValueSource.Part1Number;
            return false;
        }

        private static void CheckSourceAllowed(GeneratedValueSource source, EffectiveMode mode, string field, List<ValidationIssue> issues)
        {
            if (!IsSourceAllowed(source, mode))
                Add(issues, field, Msg.SourceNotAvailable);
        }

        private static void Add(List<ValidationIssue> issues, string field, string message)
        {
            issues.Add(Field(field, ValidationIssue.Error(IssueCode.SettingsInvalid, message)));
        }

        private static ValidationIssue Field(string field, ValidationIssue issue)
        {
            issue.Field = field;
            return issue;
        }
    }
}
