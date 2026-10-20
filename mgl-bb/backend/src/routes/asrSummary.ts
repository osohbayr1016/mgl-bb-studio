/**
 * Зохиогчийн хяналтын НЭГТГЭЛ ТАЙЛАН (эзний хүсэлт 2026-10-01).
 *
 *   GET /api/author-supervision/summary       — нэгтгэлийн өгөгдөл (JSON)
 *   GET /api/author-supervision/summary/pdf   — серверийн PDF (Browser Rendering)
 *
 * Дүрэм, тоолох аргачлал бүгд `lib/asrSummary.ts`-д.  Хэвлэх хуудас
 * (`/app/asr/summary/print`), Excel, Word гурвуулаа ЭНЭ JSON-оос угсрагдана —
 * тоо нэг газар бодогдож, гурван файл хоорондоо зөрөхгүй.
 *
 * Эрх: ЗӨВХӨН админ (эзний шийдвэр).  Админ бүх тайланг хардаг
 * (`asrVisibleSql`) тул багийн харагдацын шүүлт энд хэрэггүй; ноорог
 * хэзээ ч орохгүй (`summaryWhere`).
 *
 * `/api/author-supervision` дээрх ДАХИН нэг mount — `index.ts`-д ҮНДСЭН
 * router-ээс ӨМНӨ (тэр нь `GET /:id`, `GET /:id/pdf`-тэй тул `/summary`,
 * `/summary/pdf`-ийг залгина; `authorSupervisionStats.ts`-ийн ижил урхи).
 */
import { Hono } from 'hono';
import { launchBrowser, type BrowserSession } from '../lib/browser';
import { signToken } from '../lib/jwt';
import { PROJECT_CONTRACT_SQL } from '../lib/asrContractNo';
import { asrLabelSql, asrProjectId } from '../lib/asrProjectName';
import { redBookStatusOf } from '../lib/asrRedBook';
import { isAsrReportType } from '../lib/asrReportType';
import {
  SUMMARY_MAX_REPORTS,
  asrSummaryFileStem,
  buildAsrSummary,
  parseSummaryQuery,
  summaryWhere,
  type AsrSummaryFilters,
  type SummaryCompanionRow,
  type SummaryReportRow,
  type SummaryResolutionRow,
  type SummaryTeamRow,
} from '../lib/asrSummary';
import { isAdminRole } from '../types';
import type { Env, AppVariables } from '../types';

const router = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/** Зургийн тоо — `photos_json` массивын урт; гэмтсэн JSON 0 (`authorSupervisionStats.ts`). */
const PHOTO_COUNT_SQL = `CASE WHEN json_valid(r.photos_json) THEN json_array_length(r.photos_json) ELSE 0 END`;

type RawReportRow = Omit<SummaryReportRow, 'red_book_status' | 'contract_no'> & {
  report_contract_no: string | null;
  project_contract_no: string | null;
  red_book_photo_url: string | null;
  red_book_verified_at: string | null;
  red_book_absent: number | null;
  origin: string | null;
  legacy_author_name: string | null;
};

async function loadSummary(db: D1Database, filters: AsrSummaryFilters) {
  const where = summaryWhere(filters);

  const [reportsRes, teamsRes, companionsRes, resolutionsRes, projectRow] = await Promise.all([
    db
      .prepare(
        // ⚠️ `r.*` БИШ: зураг, гарын үсэг, транскрипт гэх мэт том баганууд
        //    нэгтгэлд хэрэггүй.  Шифр = тайлангийн хүчингүйлэгч ?? паспорт
        //    (`shapeRow`-ийн ижил дүрэм); гэрээний дугаар = тайлангийн ?? төслийн (0365).
        `SELECT r.id, r.project_id, ${asrLabelSql('p')} AS project_name, p.name AS base_name,
                COALESCE(NULLIF(TRIM(r.shifr), ''), NULLIF(TRIM(pp.drawing_no), '')) AS shifr,
                NULLIF(TRIM(r.contract_no), '') AS report_contract_no,
                ${PROJECT_CONTRACT_SQL} AS project_contract_no,
                r.doc_no, r.report_date, r.report_type, r.meeting_platform,
                r.meeting_place, r.meeting_start, r.meeting_end, r.meeting_parties, r.meeting_purpose,
                r.status, r.description, r.work_report, r.site_tasks, r.defects,
                r.red_book_photo_url, r.red_book_verified_at, r.red_book_absent,
                r.author_id, u.full_name AS author_name, r.origin, r.legacy_author_name,
                rv.full_name AS reviewer_name, r.reviewed_at,
                ${PHOTO_COUNT_SQL} AS photo_count
           FROM author_supervision_reports r
           JOIN projects p ON p.id = r.project_id
           LEFT JOIN project_passport pp ON pp.project_id = r.project_id
           LEFT JOIN users u  ON u.id = r.author_id
           LEFT JOIN users rv ON rv.id = r.reviewed_by
          WHERE ${where.sql}
          ORDER BY r.report_date, r.id
          LIMIT ?`,
      )
      .bind(...where.args, SUMMARY_MAX_REPORTS + 1)
      .all<RawReportRow>(),
    db
      .prepare(
        `SELECT rt.report_id, t.code, t.name_mn, rt.work_note
           FROM author_supervision_report_teams rt
           JOIN teams t ON t.id = rt.team_id
           JOIN author_supervision_reports r ON r.id = rt.report_id
          WHERE ${where.sql}
          ORDER BY rt.report_id, rt.sort_order, t.sort_order`,
      )
      .bind(...where.args)
      .all<SummaryTeamRow>(),
    db
      .prepare(
        `SELECT c.report_id, c.user_id, cu.full_name
           FROM asr_report_companions c
           JOIN author_supervision_reports r ON r.id = c.report_id
           LEFT JOIN users cu ON cu.id = c.user_id
          WHERE ${where.sql}
          ORDER BY c.report_id, c.sort_order, c.user_id`,
      )
      .bind(...where.args)
      .all<SummaryCompanionRow>(),
    db
      .prepare(
        // Өмнөх тайлангийн дугаар/огноог АМЬДААР, устсан бол цооногоор (`loadResolutions`).
        `SELECT res.report_id,
                COALESCE(pr.doc_no, res.prev_doc_no) AS prev_doc_no,
                COALESCE(pr.report_date, res.prev_report_date) AS prev_report_date,
                res.issue_text, res.resolution_text
           FROM asr_issue_resolutions res
           JOIN author_supervision_reports r ON r.id = res.report_id
           LEFT JOIN author_supervision_reports pr ON pr.id = res.prev_report_id
          WHERE ${where.sql}
          ORDER BY res.report_id, res.sort_order, res.id`,
      )
      .bind(...where.args)
      .all<SummaryResolutionRow>(),
    filters.projectId != null
      ? db
          .prepare(`SELECT p.id, p.name, ${asrLabelSql('p')} AS label FROM projects p WHERE p.id = ?`)
          .bind(filters.projectId)
          .first<{ id: number; name: string; label: string }>()
      : Promise.resolve(null),
  ]);

  const raw = reportsRes.results ?? [];
  const truncated = raw.length > SUMMARY_MAX_REPORTS;
  const reports: SummaryReportRow[] = raw.slice(0, SUMMARY_MAX_REPORTS).map((r) => ({
    ...r,
    contract_no: r.report_contract_no ?? r.project_contract_no,
    // Нөхөж бүртгэсэн хуучин тайлан (0332): файл дээрх зохиогчийн нэр нь үнэн
    // (author_id нь тулгагдаагүй үед импортлогч өөрөө байдаг).
    author_name:
      r.origin === 'legacy' && r.legacy_author_name ? r.legacy_author_name : r.author_name,
    red_book_status: redBookStatusOf(r),
  }));

  const summary = buildAsrSummary({
    filters,
    reports,
    teams: teamsRes.results ?? [],
    companions: companionsRes.results ?? [],
    resolutions: resolutionsRes.results ?? [],
    truncated,
    isType: isAsrReportType,
  });

  return {
    ...summary,
    /** Нэг төслийн нэгтгэл бол тэр төсөл (байхгүй id → null). */
    project: projectRow ? { id: projectRow.id, name: projectRow.label } : null,
    file_stem: asrSummaryFileStem({
      projectCode: projectRow ? asrProjectId(projectRow.name) : null,
      period: summary.period,
    }),
  };
}

router.get('/summary', async (c) => {
  const user = c.get('user');
  if (!isAdminRole(user.role)) return c.json({ error: 'Forbidden' }, 403);

  const parsed = parseSummaryQuery(c.req.query(), isAsrReportType);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  const data = await loadSummary(c.env.DB, parsed.filters);
  return c.json({
    ...data,
    generated_at: new Date().toISOString(),
    generated_by: user.sub,
  });
});

/**
 * Серверийн PDF — `GET /:id/pdf`-ийн ЯГ тэр жор: 1 минутын print токен →
 * `/app/asr/summary/print?…&t=` → `body[data-print-ready="true"]` → `page.pdf()`.
 * Хэвлэх хуудас өөрөө `@page { size: A4 }` + зайгаа зарладаг тул
 * `preferCSSPageSize` ба margin 0 (давхарлахгүй).
 */
router.get('/summary/pdf', async (c) => {
  const user = c.get('user');
  if (!isAdminRole(user.role)) return c.json({ error: 'Forbidden' }, 403);

  const parsed = parseSummaryQuery(c.req.query(), isAsrReportType);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const f = parsed.filters;

  // Файлын нэр — JSON-ийн `file_stem`-тэй ижил (Excel/Word-той нэг нэр).
  const head = await loadSummary(c.env.DB, f);

  const qs = new URLSearchParams();
  if (f.from) qs.set('from', f.from);
  if (f.to) qs.set('to', f.to);
  if (f.projectId != null) qs.set('project_id', String(f.projectId));
  if (f.reportType) qs.set('report_type', f.reportType);
  if (f.status !== 'counted') qs.set('status', f.status);

  const printToken = await signToken(
    { sub: user.sub, role: user.role, purpose: 'print' },
    c.env.JWT_SECRET,
    1 / 60, // цаг → 1 минут
  );
  qs.set('t', printToken);
  const printUrl = `${c.env.FRONTEND_URL.replace(/\/+$/, '')}/app/asr/summary/print?${qs.toString()}`;

  let browser: BrowserSession | null = null;
  try {
    browser = await launchBrowser(c.env.BROWSER);
    const page = await browser.newPage();
    await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 1 });
    await page.goto(printUrl, { waitUntil: 'networkidle0', timeout: 30000 });
    try {
      await page.waitForSelector('body[data-print-ready="true"]', { timeout: 25000 });
    } catch {
      /* юу зурагдсаныг нь авна */
    }
    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });

    const stem = head.file_stem;
    return new Response(pdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition':
          `attachment; filename="${stem.replace(/[^ -~]/g, '_')}.pdf"; ` +
          `filename*=UTF-8''${encodeURIComponent(stem + '.pdf')}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[asr-summary-pdf] render failed', err);
    return c.json(
      {
        error: 'PDF үүсгэхэд алдаа гарлаа',
        detail: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* swallow */
      }
    }
  }
});

export default router;
