/* Row shapes for the project setup tree.
 *
 * Moved verbatim out of `AdminProjectSetupPage.tsx` when that ~5 700-line
 * module was split up. Data only — no behavioural change. */

export interface Block {
  id: number;
  name: string;
  weight_percent: number | string;
  sort_order: number;
  team_id?: number | null;
}
export interface Drawing {
  id: number;
  block_id: number;
  name: string;
  weight_percent: number | string;
  sort_order: number;
}
export interface Comp {
  id: number;
  drawing_id: number;
  name: string;
  weight_percent: number | string;
  sort_order: number;
}
export interface AssigneeSummary {
  user_id: number;
  full_name: string;
}
export interface Task {
  id: number;
  component_id: number;
  name: string;
  weight_percent: number | string;
  assigned_to: number | null;
  assignees: AssigneeSummary[];
  due_date: string | null;
  start_date: string | null;
  sort_order: number;
  /** Latest approved progress %, surfaced from the hierarchy endpoint.
   *  Doubles as the seed value for the "Анхны явц" baseline editor —
   *  admins type the carry-over % from their old Excel tracker here so
   *  long-running tasks don't reset to 0% the moment the project is
   *  imported into the system. */
  progress?: number;
}

export type Banner = { kind: 'success' | 'error'; text: string } | null;
