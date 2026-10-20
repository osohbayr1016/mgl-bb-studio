/* =============================================================
 * Shared types for the team-report feature.
 * -------------------------------------------------------------
 * Each discipline (BA, BB, HAS, …) plugs in its own answers
 * shape, section list and printable document; the surrounding
 * load/save shell + form + print page work off these generic
 * types and don't need to know which team's report they're
 * rendering.
 * ============================================================= */
import type { ReactNode } from 'react';

/** Discipline short code as stored in the `teams` table. */
export type TeamCode = string;

/** BA's frame-system discriminator. Other teams currently don't use a
 *  building-type variant, but the column is kept on the row so we can
 *  add one later without another migration. */
export type BaBuildingType = 'rc' | 'steel';

/** Loose record because the form persists everything as JSON. Each
 *  team-specific module narrows the shape at its boundaries.  Used as
 *  the default generic param; team modules may pass a richer typed
 *  shape (e.g. `BaReportAnswers`) without needing an index signature. */
export type TeamReportAnswers = Record<string, unknown>;

/** Generic section + field definitions consumed by the shared
 *  accordion form. A team's `template.ts` produces a list of these.
 *  Note the generic intentionally has *no* `extends Record<...>`
 *  constraint — that would force every team's answer interface to
 *  declare an index signature, which is a poor fit for the strongly
 *  typed shapes we want (e.g. BA's per-field union types). */
export type FieldKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select'
  | 'checkbox'
  | 'block-rows' // bespoke widget — repeated rows for multi-block layout
  | 'floor-rows' // bespoke widget — per-floor purpose rows
  | 'zone-rows' // bespoke widget — interior zones × finish facets (IZ)
  | 'floor-areas-rows'; // bespoke widget — render index: floor → {area, pages}[] (IZ)

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldDef<A = TeamReportAnswers> {
  key: keyof A & string;
  label: string;
  kind: FieldKind;
  suffix?: string;
  hint?: string;
  placeholder?: string;
  span?: 'full' | 'half';
  options?: FieldOption[];
  /** Skip rendering when the predicate returns false. */
  visibleIf?: (a: A) => boolean;
  /** Hide field when the team's "variant" (e.g. BA's building_type)
   *  doesn't match. Teams without a variant ignore this. */
  variants?: string[];
}

export interface SectionDef<A = TeamReportAnswers> {
  id: string;
  title: string;
  blurb?: string;
  fields: FieldDef<A>[];
  /** Hide section entirely based on the current variant. */
  variants?: string[];
  /** Optional one-click pre-fill. The form renders a button below the
   *  section blurb; clicking it merges `values` into the answers via
   *  the form's onChange handler. Useful for canned defaults like
   *  "Улаанбаатар климат" so engineers don't retype the same numbers
   *  on every project. The `confirm` flag (default true) prompts before
   *  overwriting an already-filled field. */
  preset?: {
    label: string;
    description?: string;
    values: Partial<A>;
    confirm?: boolean;
  };
}

/** Per-team plug-in. The outer TeamReportsTab looks up which module
 *  to render for the active sub-tab; teams without a module show a
 *  "тодорхойлогдоогүй" placeholder. */
export interface TeamReportModule<A = TeamReportAnswers> {
  teamCode: TeamCode;
  /** Optional top-level variant picker. BA uses this for its
   *  ТБ / Металл каркас choice; other teams leave it undefined. */
  variantPicker?: {
    label: string;
    options: { value: string; title: string; subtitle: string }[];
  };
  sections: SectionDef<A>[];
  /** Override the answers' starting shape (e.g. for default field
   *  values). Most teams can omit and accept `{}`. */
  defaults?: () => Partial<A>;
  /** Render the printable document. Receives the saved answers
   *  and the current variant (if any). */
  renderDocument: (answers: A, variant: string | null) => ReactNode;
}

/** Saved report shape returned by GET /projects/:id/team-reports/:teamCode. */
export interface TeamReportResource {
  project_id: number;
  team_code: TeamCode;
  building_type: BaBuildingType | null;
  answers: TeamReportAnswers;
  updated_at: string;
  updated_by_id: number | null;
}
