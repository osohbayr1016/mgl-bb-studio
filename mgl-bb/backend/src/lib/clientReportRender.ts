/* =============================================================
 * Client-facing design-progress report — orchestration.
 * -------------------------------------------------------------
 * Ties together: load perf-report context → buildClientReportData (compute) →
 * inline cover/logo images as data URIs → buildClientReportHtml → (PDF) render
 * via the WeasyPrint container. Imported by BOTH the route
 * (routes/performanceReports.ts) and the MCP `generate_report` tool so they
 * produce byte-identical output.
 * ============================================================= */
import { Buffer } from 'node:buffer';
import type { Env, JWTPayload } from '../types';
import {
  buildClientReportData,
  type PerfReportInput,
  type RiskRow,
  type Rag,
  type ReportAudience,
  type ReportLang,
} from './clientReport';
import { buildClientReportHtml } from './clientReportHtml';
import { renderPdf } from './weasyprint';

type ReportUser = { sub: number; role: JWTPayload['role'] };

interface PerfRow {
  report_no: number;
  period_start: string;
  period_end: string;
  status: 'draft' | 'issued';
  issued_at: string | null;
  team_progress_json: string | null;
  progress_timeseries_json: string | null;
  status_meetings_json: string | null;
  client_summary_md: string | null;
  risks_json: string | null;
  next_plan_json: string | null;
}

function parseArr<T>(json: string | null | undefined): T[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

const RAGS: Rag[] = ['green', 'amber', 'red', 'unknown'];
function sanitizeRisks(raw: unknown[]): RiskRow[] {
  return raw
    .map((r): RiskRow | null => {
      if (!r || typeof r !== 'object') return null;
      const o = r as Record<string, unknown>;
      const risk = typeof o.risk === 'string' ? o.risk.trim() : '';
      const owner = typeof o.owner === 'string' ? o.owner.trim() : '';
      const mitigation = typeof o.mitigation === 'string' ? o.mitigation.trim() : '';
      const impact = RAGS.includes(o.impact as Rag) ? (o.impact as Rag) : 'unknown';
      if (!risk && !owner && !mitigation) return null;
      return { risk, owner, mitigation, impact };
    })
    .filter((r): r is RiskRow => r !== null);
}

/** Load the perf-report row as the PerfReportInput the compute layer wants. */
export async function loadPerfReportInput(
  env: Env,
  projectId: number,
  reportId: number,
): Promise<PerfReportInput | null> {
  const row = await env.DB.prepare(
    `SELECT report_no, period_start, period_end, status, issued_at,
            team_progress_json, progress_timeseries_json, status_meetings_json,
            client_summary_md, risks_json, next_plan_json
       FROM project_performance_reports WHERE id = ? AND project_id = ?`,
  )
    .bind(reportId, projectId)
    .first<PerfRow>();
  if (!row) return null;
  return {
    report_no: row.report_no,
    period_start: row.period_start,
    period_end: row.period_end,
    status: row.status,
    issued_at: row.issued_at,
    team_progress: parseArr(row.team_progress_json),
    progress_timeseries: parseArr(row.progress_timeseries_json),
    status_meetings: parseArr(row.status_meetings_json),
    client_summary_md: row.client_summary_md ?? null,
    risks: sanitizeRisks(parseArr(row.risks_json)),
    next_plan: parseArr<unknown>(row.next_plan_json)
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      .map((s) => s.trim()),
  };
}

/** The latest issued report for a project, falling back to the latest draft. */
export async function latestReportId(env: Env, projectId: number): Promise<number | null> {
  const issued = await env.DB.prepare(
    `SELECT id FROM project_performance_reports
      WHERE project_id = ? AND status = 'issued'
      ORDER BY report_no DESC LIMIT 1`,
  )
    .bind(projectId)
    .first<{ id: number }>();
  if (issued) return issued.id;
  const row = await env.DB.prepare(
    `SELECT id FROM project_performance_reports
      WHERE project_id = ? ORDER BY report_no DESC LIMIT 1`,
  )
    .bind(projectId)
    .first<{ id: number }>();
  return row?.id ?? null;
}

function guessImageType(key: string): string {
  const k = key.toLowerCase();
  if (k.endsWith('.svg')) return 'image/svg+xml';
  if (k.endsWith('.jpg') || k.endsWith('.jpeg')) return 'image/jpeg';
  if (k.endsWith('.webp')) return 'image/webp';
  if (k.endsWith('.gif')) return 'image/gif';
  return 'image/png';
}

/** Inline an image URL as a base64 data URI (WeasyPrint renders these
 *  deterministically). /media/* paths are read straight from R2 (no hop). */
async function inlineImage(env: Env, url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    if (url.startsWith('/media/')) {
      const key = decodeURIComponent(url.slice('/media/'.length));
      const obj = await env.MEDIA_BUCKET.get(key);
      if (!obj) return null;
      const buf = Buffer.from(await obj.arrayBuffer());
      const ct = obj.httpMetadata?.contentType || guessImageType(key);
      return `data:${ct};base64,${buf.toString('base64')}`;
    }
    if (/^https?:\/\//i.test(url)) {
      const res = await fetch(url);
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      const ct = res.headers.get('content-type') || guessImageType(url);
      return `data:${ct};base64,${buf.toString('base64')}`;
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** The frontend's logo.svg inlined as a data URI for the cover. */
async function fetchLogoDataUri(env: Env): Promise<string | null> {
  try {
    const res = await fetch(`${env.FRONTEND_URL.replace(/\/+$/, '')}/logo.svg`);
    if (!res.ok) return null;
    const svg = await res.text();
    // logo.svg's artwork sits in a small region of its 1920×1080 canvas; crop
    // the viewBox tightly to the mark so it fills the cover (same as the
    // perf-report PDF footer logo handling in routes/performanceReports.ts).
    const cropped = svg.replace(/viewBox="0 0 1920 1080"/, 'viewBox="735 345 470 390"');
    return `data:image/svg+xml,${encodeURIComponent(cropped)}`;
  } catch {
    return null;
  }
}

export interface RenderOpts {
  projectId: number;
  reportId: number | null;
  audience: ReportAudience;
  lang: ReportLang;
}

/** Build the full HTML document (web or pdf mode). */
export async function buildClientReportHtmlDoc(
  env: Env,
  user: ReportUser,
  opts: RenderOpts & { mode: 'web' | 'pdf' },
): Promise<string> {
  const report =
    opts.reportId != null ? await loadPerfReportInput(env, opts.projectId, opts.reportId) : null;
  const data = await buildClientReportData({
    env,
    user,
    projectId: opts.projectId,
    report,
    audience: opts.audience,
    lang: opts.lang,
  });
  const [logo, keyImg] = await Promise.all([
    fetchLogoDataUri(env),
    inlineImage(env, data.project.key_image_url),
  ]);
  return buildClientReportHtml(data, { mode: opts.mode, logoDataUri: logo, keyImageDataUri: keyImg });
}

/** Build the HTML and render it to PDF via the WeasyPrint container. */
export async function renderClientReportPdf(
  env: Env,
  user: ReportUser,
  opts: RenderOpts,
): Promise<Uint8Array> {
  const html = await buildClientReportHtmlDoc(env, user, { ...opts, mode: 'pdf' });
  return renderPdf(env, html);
}
