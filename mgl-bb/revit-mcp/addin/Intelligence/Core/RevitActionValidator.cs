using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using RevitMcpAddin.Intelligence.Contracts;

namespace RevitMcpAddin.Intelligence.Core
{
    /// <summary>
    /// TYPED ҮЙЛДЛИЙН СХЕМИЙН ШАЛГАЛТ (§47–49) — ГҮЙЦЭТГЭЛГҮЙ.
    ///
    /// Энэ релизэд `ExecutableNow` нь бичих үйлдэлд ҮРГЭЛЖ false
    /// (`WRITE_ACTION_DISABLED_IN_THIS_RELEASE`).  Навигаци (`SELECT_ELEMENTS`,
    /// `SHOW_ELEMENT`) л гүйцэтгэгдэж болно — тэр ч `RevitToolBus`-аар (R-2).
    /// </summary>
    public static class RevitActionValidator
    {
        private static readonly Regex CodeLike = new Regex(
            @"[;{}]|\b(using|new|class|void|return|eval|exec|Transaction|FilteredElementCollector|System\.)\b|=>|\(\s*\)",
            RegexOptions.CultureInvariant);

        private static readonly Dictionary<RevitActionKind, string[]> AllowedParams = new Dictionary<RevitActionKind, string[]>
        {
            { RevitActionKind.MOVE_ELEMENT, new[] { "dx_mm", "dy_mm", "dz_mm" } },
            { RevitActionKind.SET_PARAMETER, new[] { "name", "value", "unit" } },
            { RevitActionKind.CHANGE_TYPE, new[] { "type_id", "type_name" } },
            { RevitActionKind.CREATE_WALL, new[] { "start_mm", "end_mm", "level_id", "type_id", "height_mm" } },
            { RevitActionKind.CREATE_FLOOR, new[] { "level_id", "type_id", "boundary_mm" } },
            { RevitActionKind.PLACE_DOOR, new[] { "host_id", "point_mm", "type_id" } },
            { RevitActionKind.PLACE_WINDOW, new[] { "host_id", "point_mm", "type_id" } },
            { RevitActionKind.DELETE_ELEMENT, new string[0] },
            { RevitActionKind.SELECT_ELEMENTS, new string[0] },
            { RevitActionKind.SHOW_ELEMENT, new[] { "zoom" } },
        };

        public static ActionValidation Validate(RevitActionEnvelope a, IDictionary<long, SceneNode> knownNodes = null)
        {
            var v = new ActionValidation();
            if (a == null) { v.Codes.Add(ActionValidationCode.MISSING_ACTION_ID); return v; }
            if (string.IsNullOrWhiteSpace(a.ActionId)) v.Codes.Add(ActionValidationCode.MISSING_ACTION_ID);
            if (string.IsNullOrWhiteSpace(a.DocKey)) v.Codes.Add(ActionValidationCode.MISSING_DOC_KEY);
            bool needsTargets = a.Action != RevitActionKind.CREATE_WALL && a.Action != RevitActionKind.CREATE_FLOOR;
            if (needsTargets && (a.TargetElementIds == null || a.TargetElementIds.Count == 0))
            {
                v.Codes.Add(a.Action == RevitActionKind.MOVE_ELEMENT ? ActionValidationCode.TARGETS_REQUIRED_FOR_MOVE : ActionValidationCode.NO_TARGETS);
            }
            if (a.Reason == null || string.IsNullOrWhiteSpace(a.Reason.SummaryMn)) v.Codes.Add(ActionValidationCode.MISSING_REASON);
            if (a.RequestedBy == null || string.IsNullOrWhiteSpace(a.RequestedBy.Kind)) v.Codes.Add(ActionValidationCode.MISSING_REQUESTER);
            if (a.SafetyLevel > ActionSafety.MaxLevel) v.Codes.Add(ActionValidationCode.SAFETY_LEVEL_EXCEEDS_SESSION_MAX);

            string[] allowed;
            if (AllowedParams.TryGetValue(a.Action, out allowed) && a.Parameters != null)
            {
                foreach (KeyValuePair<string, string> kv in a.Parameters)
                {
                    if (Array.IndexOf(allowed, kv.Key) < 0) v.Codes.Add(ActionValidationCode.UNKNOWN_PARAMETER_FOR_ACTION);
                    if (kv.Value != null && (kv.Value.Length > 512 || CodeLike.IsMatch(kv.Value)))
                        v.Codes.Add(ActionValidationCode.PARAMETER_VALUE_LOOKS_LIKE_CODE);
                }
            }

            if (knownNodes != null && a.TargetElementIds != null)
            {
                foreach (long id in a.TargetElementIds)
                {
                    SceneNode n;
                    if (knownNodes.TryGetValue(id, out n) && n.Scope == ElementScope.LINKED_DOCUMENT && ActionSafety.IsWrite(a.Action))
                    {
                        v.Codes.Add(ActionValidationCode.LINKED_ELEMENT_NOT_WRITABLE);
                        break;
                    }
                }
            }

            // R4.1: ЗӨВХӨН EnabledWriteKinds (SET_PARAMETER · MOVE_ELEMENT · CHANGE_TYPE) — бусад бичих үйлдэл хаалттай хэвээр.
            if (ActionSafety.IsWrite(a.Action) && !ActionSafety.IsEnabledWrite(a.Action)) v.Codes.Add(ActionValidationCode.WRITE_ACTION_DISABLED_IN_THIS_RELEASE);

            v.Ok = v.Codes.Count == 0 || (v.Codes.Count == 1 && v.Codes[0] == ActionValidationCode.WRITE_ACTION_DISABLED_IN_THIS_RELEASE);
            // Бичих үйлдэл ХЭЗЭЭ Ч «одоо гүйцэтгэх» биш — preview + хэрэглэгчийн ИЛ баталгаа (ActionPreconditions + VerifyConfirmation).
            v.ExecutableNow = v.Codes.Count == 0 && !ActionSafety.IsWrite(a.Action);
            if (v.Codes.Count == 0) v.Codes.Add(ActionValidationCode.OK);
            return v;
        }
    }
}
