/* =============================================================
 * Per-team form template overrides — opaque JSON patches the
 * frontend resolver folds into each team's hardcoded
 * `SectionDef<A>[]` before rendering the AccordionForm. Stored
 * in `team_template_overrides.overrides_json`.
 *
 * Field KEYS, field KINDS, visibleIf logic, and select-option
 * `value`s stay code-bound — saved answers + Document renderers
 * rely on them. Only HUMAN-READABLE text gets overridden.
 * ============================================================= */

export interface TeamTemplateOptionOverride {
  /** Pristine `value` from the hardcoded template — used as the
   *  key into the options array; not editable. */
  value: string;
  /** New display label for this option. */
  label: string;
}

export interface TeamTemplateFieldOverride {
  /** Optional new label for the field. */
  label?: string;
  /** Optional new hint text shown below the field. */
  hint?: string;
  /** Optional new placeholder for text/textarea/select. */
  placeholder?: string;
  /** Optional override of select option labels (by `value`). */
  options?: TeamTemplateOptionOverride[];
}

export interface TeamTemplateSectionOverride {
  /** Optional new section title. */
  title?: string;
  /** Optional new section blurb (sub-title). */
  blurb?: string;
  /** Map of `field.key` → field-level overrides. */
  fields?: Record<string, TeamTemplateFieldOverride>;
}

export interface TeamTemplateOverrides {
  sections?: Record<string, TeamTemplateSectionOverride>;
}

/** Backend response shape from `GET /team-form-templates/:team_code`. */
export interface TeamTemplateOverridesResponse {
  team_code: string;
  overrides: TeamTemplateOverrides;
  updated_at: string | null;
}

/** Backend response shape from `GET /team-form-templates` (list). */
export interface TeamTemplateOverridesListResponse {
  overrides: Array<{
    team_code: string;
    has_overrides: boolean;
    updated_at: string;
  }>;
}
