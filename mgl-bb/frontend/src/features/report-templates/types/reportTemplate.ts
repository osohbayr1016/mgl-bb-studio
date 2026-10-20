import type { ReportBlockRaw } from '@/features/performance-reports/types/performanceReportBlocks';

/* =============================================================
 * Тайлангийн загвар — saved block lists reusable across projects.
 * Mirrors the per-report shape but the parent isn't bound to a
 * project. When picked at report creation time the template's
 * blocks are COPIED into the new report.
 * ============================================================= */

export interface ReportTemplate {
  id: number;
  name: string;
  description: string | null;
  is_default: boolean;
  /** Discipline scope — when set, the template only shows in this
   *  team's filter. `null` keeps the template firm-wide / visible
   *  across every team's view. */
  team_code: string | null;
  block_count?: number;
  created_by_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface ReportTemplateDetail extends ReportTemplate {
  blocks: ReportBlockRaw[];
}

export interface ReportTemplateListResponse {
  templates: ReportTemplate[];
}

export interface ReportTemplateResponse {
  template: ReportTemplateDetail;
}
