import type { SectionDef, FieldOption } from '@/features/projects/team-reports/types';
import type { TeamTemplateOverrides } from '@/features/report-templates/types/teamTemplateOverrides';

/* =============================================================
 * Merge `team_template_overrides` JSON onto a team's hardcoded
 * `SectionDef<A>[]`. Only modifies labels / hints / placeholders /
 * blurbs / select-option labels — keys, kinds, visibleIf, etc.
 * stay pristine so saved answers + Document renderers don't break.
 *
 * Missing keys in the overrides JSON fall through to the original
 * template values, so a half-filled override is safe.
 * ============================================================= */

export function applyTemplateOverrides<A>(
  base: readonly SectionDef<A>[],
  overrides: TeamTemplateOverrides | null | undefined,
): SectionDef<A>[] {
  if (!overrides?.sections) return base.map((s) => ({ ...s }));
  return base.map((section) => {
    const sec = overrides.sections?.[section.id];
    if (!sec) return section;
    return {
      ...section,
      title: sec.title?.length ? sec.title : section.title,
      blurb: sec.blurb !== undefined ? sec.blurb : section.blurb,
      fields: section.fields.map((f) => {
        const fo = sec.fields?.[f.key as string];
        if (!fo) return f;
        const next: typeof f = {
          ...f,
          label: fo.label?.length ? fo.label : f.label,
          hint: fo.hint !== undefined ? fo.hint : f.hint,
          placeholder: fo.placeholder !== undefined ? fo.placeholder : f.placeholder,
        };
        if (f.options && fo.options && fo.options.length > 0) {
          next.options = mergeOptions(f.options, fo.options);
        }
        return next;
      }),
    };
  });
}

function mergeOptions(
  base: FieldOption[],
  overrides: { value: string; label: string }[],
): FieldOption[] {
  // First pass: relabel existing options. Second pass: append any
  // override whose `value` isn't in the base — those are admin-added
  // custom options. Document renderers may not have a friendly label
  // for them, but they at least render in the form dropdown.
  const baseValues = new Set(base.map((o) => o.value));
  const relabelled = base.map((o) => {
    const ov = overrides.find((x) => x.value === o.value);
    return ov && ov.label.length > 0 ? { ...o, label: ov.label } : o;
  });
  const additions = overrides
    .filter((ov) => !baseValues.has(ov.value) && ov.label.length > 0)
    .map((ov) => ({ value: ov.value, label: ov.label }));
  return [...relabelled, ...additions];
}
