// Types for the Тоо хэмжээ (QTO) workspace — mirror of the backend /api/qto/*
// payloads. The data source is the Revit add-in (source 'revit'), which POSTs
// aggregated fact rows; legacy in-browser IFC runs (source 'ifc') remain
// readable as history but carry no fact rows.
//
// Kept dependency-free on purpose (no React imports) — shared by the pure
// pivot/diff helpers, the Excel exporter and the UI components.

export type QtoRunSource = 'ifc' | 'revit';

/** One row of GET /api/qto/projects-overview — a project + its latest run. */
export interface QtoProjectOverviewItem {
  project_id: number;
  project_name: string;
  display_title: string | null;
  status: string;
  latest_run_id: number | null;
  latest_run_at: string | null;
  latest_file_name: string | null;
  latest_run_source: QtoRunSource | null;
  element_count: number | null;
  total_volume_m3: number | null;
  total_area_m2: number | null;
  run_count: number;
  /** Phase-2 (шифр classification) counter — returned but not rendered yet. */
  unmapped_facts: number;
}

/** One run of GET /api/qto/runs?project_id=N. */
export interface QtoRunListItem {
  id: number;
  project_id: number;
  created_by: number;
  created_by_name: string | null;
  model_url: string | null;
  file_name: string | null;
  file_size: number | null;
  schema_version: string | null;
  element_count: number;
  flag_count: number;
  total_volume_m3: number | null;
  total_area_m2: number | null;
  source: QtoRunSource | null;
  created_at: string;
  fact_count: number;
  /** Phase-2 (шифр) counter — ignored by the UI for now. */
  unmapped_facts: number;
}

/* ---- run summaries (qto_runs.summary_json) ------------------------------ */

/** Totals block of a `revit-1` summary. */
export interface RevitTotals {
  count: number;
  length_m: number | null;
  area_m2: number | null;
  volume_m3: number | null;
  mass_kg: number | null;
}

export interface RevitCategoryRow {
  category: string;
  count: number;
  volume_m3: number | null;
  mass_kg: number | null;
}

/** Summary shape written by the Revit add-in pipeline (schema `revit-1`). */
export interface RevitSummary {
  schema_version: string;
  source: 'revit';
  revit_version?: string | null;
  totals: RevitTotals;
  by_category: RevitCategoryRow[];
  /** Phase-2 mapping stats — present but not rendered yet. */
  mapped?: {
    facts: number;
    mapped: number;
    unmapped: number;
    distinct_unmapped_keys: number;
  };
}

/** Minimal readable subset of the legacy in-browser IFC summary (schema '1').
 *  Only what the compact history card needs — the full legacy shape
 *  (classes/storeys/flags/…) is deliberately not modelled anymore. */
export interface LegacyMaterialRow {
  material: string;
  volume_m3: number | null;
  mass_kg: number | null;
  count: number;
}

export interface LegacySummary {
  schema_version?: string | null;
  element_count?: number;
  total_volume_m3?: number | null;
  total_area_m2?: number | null;
  total_mass_kg?: number | null;
  materials?: LegacyMaterialRow[];
}

export type QtoRunSummary = RevitSummary | LegacySummary;

/** Narrow a stored summary to the revit shape (legacy summaries have no
 *  `source` discriminator, so its presence is the reliable signal). */
export function isRevitSummary(s: QtoRunSummary | null | undefined): s is RevitSummary {
  return !!s && (s as RevitSummary).source === 'revit';
}

/** GET /api/qto/runs/:id → `{ run: QtoRunDetail }`. */
export interface QtoRunDetail extends QtoRunListItem {
  summary: QtoRunSummary | null;
}

/* ---- Самбар (multi-file dashboard) --------------------------------------- */

/** One file entry of GET /api/qto/projects/:id/dashboard — the latest revit
 *  run per distinct file_name. */
export interface QtoDashboardFile {
  run_id: number;
  file_name: string | null;
  source: QtoRunSource;
  created_at: string;
  created_by_name: string | null;
  element_count: number;
  fact_count: number;
  unmapped_facts: number;
  totals: RevitTotals;
}

/** Pre-aggregated (run_id × category) row. */
export interface QtoDashboardCategoryRow {
  run_id: number;
  category: string | null;
  count: number;
  length_m: number;
  area_m2: number;
  volume_m3: number;
  mass_kg: number;
  /** Категори доторх жинхэнэ (cap-гүй) төрлийн тоо — картын «+N төрөл» хөл.
   *  Optional: deploy-ийн дараах ≤60с edge-cache-тэй хуучин payload-д байхгүй. */
  type_count?: number;
}

/** Pre-aggregated (run_id × level × category) row. */
export interface QtoDashboardLevelRow extends QtoDashboardCategoryRow {
  level: string | null;
}

/** Pre-aggregated (run_id × category × family × type) row — Самбарын карт,
 *  хайлт, Table горимын эх; глобал 4000 мөр cap-тай (count DESC). */
export interface QtoDashboardTypeRow extends QtoDashboardCategoryRow {
  family: string | null;
  type_name: string | null;
  /** 0120: төрлийн марк (Хн3.6, ХБ-21х29…) — optional (хуучин payload). */
  type_mark?: string | null;
  assembly_code?: string | null;
}

/** Өрөөний ведомостын нэг мөр (0120) — талбайтай өрөөнүүд л ирдэг. */
export interface QtoDashboardRoomRow {
  run_id: number;
  number: string;
  name: string;
  level: string;
  area_m2: number | null;
}

export interface QtoDashboardResponse {
  files: QtoDashboardFile[];
  by_category: QtoDashboardCategoryRow[];
  by_level: QtoDashboardLevelRow[];
  /** Optional — stale-edge-cache guard (deploy-ийн дараах ≤60с). */
  by_type?: QtoDashboardTypeRow[];
  /** 0120: өрөөний ведомость — optional (хуучин payload/run-д байхгүй). */
  by_room?: QtoDashboardRoomRow[];
  /** true = by_level 10k мөрийн cap-д хүрч хураангуйлагдсан. */
  truncated: boolean;
  /** true = by_type 4k мөрийн cap-д хүрсэн. */
  by_type_truncated?: boolean;
  rooms_truncated?: boolean;
  generated_at: string;
}

/** One row of GET /api/qto/projects/:id/views — план PDF бүртгэл. */
export interface QtoViewExport {
  id: number;
  qto_run_id: number | null;
  view_name: string;
  file_name: string | null;
  media_url: string;
  created_at: string;
  created_by_name: string | null;
}

/* ---- Ведомость (Revit Schedule, 0121) ------------------------------------ */

/** GET /api/qto/projects/:id/schedules — мета мөр (rows_json-гүй). */
export interface QtoScheduleMeta {
  id: number;
  file_name: string;
  name: string;
  category: string;
  row_count: number;
  created_at: string;
  created_by_name: string | null;
}

/** GET /api/qto/schedules/:id — бүрэн агуулга. */
export interface QtoScheduleDetail extends Omit<QtoScheduleMeta, 'created_by_name'> {
  project_id: number;
  columns: string[];
  rows: string[][];
}

/* ---- fact rows ----------------------------------------------------------- */

/** One aggregated fact row — GET /api/qto/runs/:id/facts (up to 20k rows).
 *  The resource_* / mapped_via fields belong to Phase-2 classification and
 *  are usually null — carried in the type but not rendered. */
export interface QtoFactRow {
  id: number;
  category: string | null;
  family: string | null;
  type_name: string | null;
  level: string | null;
  material: string | null;
  count: number;
  length_m: number | null;
  area_m2: number | null;
  volume_m3: number | null;
  mass_kg: number | null;
  /** 0120: төсөвчний талбарууд — хуучин run-уудад null. */
  type_mark: string | null;
  marks: string | null;
  thickness_mm: number | null;
  assembly_code: string | null;
  keynote: string | null;
  combo_key: string;
  resource_code: string | null;
  mapped_via: string | null;
  resource_name: string | null;
  resource_group: string | null;
  resource_unit: string | null;
}
