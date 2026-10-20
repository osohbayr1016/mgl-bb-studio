/**
 * Public signing — баримтыг PDF болгон рендерлэх IO давхарга.
 *
 * `routes/publicDocumentSigning.ts` нь ЭНЭ файлыг шууд импортлохгүй (Browser
 * Rendering → `node --test` ачаалж чадахгүй), харин `SigningRenderIo`
 * интерфейсээр авдаг — `driveSigning`/`driveSigningIo`-той ижил хуваалт.
 * `index.ts` бодит хэрэгжүүлэлтийг (`realSigningRender`) дамжуулна.
 */
import { asrFileStem } from './asrNo';
import { launchBrowser, type BrowserSession } from './browser';
import { renderCorrespondencePdf } from './correspondencePdf';
import { signToken } from './jwt';
import type { PublicSigningKind } from './publicSigning';
import type { Env, UserRole } from '../types';

export interface SigningRenderActor {
  sub: number;
  role: UserRole;
}

export interface RenderedDocument {
  bytes: Uint8Array;
  fileName: string;
}

export interface SigningRenderIo {
  /** Каноник баримтыг (RFI/CR эсвэл ЗХ тайлан) серверт PDF болгоно; олдохгүй бол null. */
  render(
    env: Env,
    kind: PublicSigningKind,
    entityId: number,
    actor: SigningRenderActor,
  ): Promise<RenderedDocument | null>;
}

async function renderAsrPdf(
  env: Env,
  reportId: number,
  actor: SigningRenderActor,
): Promise<RenderedDocument | null> {
  const head = await env.DB.prepare(
    `SELECT r.id, r.project_id, r.seq, r.doc_no, r.report_date,
            p.name AS project_name,
            (SELECT t.code FROM author_supervision_report_teams rt
              JOIN teams t ON t.id = rt.team_id
             WHERE rt.report_id = r.id
             ORDER BY rt.sort_order, rt.team_id LIMIT 1) AS team_code
       FROM author_supervision_reports r
       LEFT JOIN projects p ON p.id = r.project_id
      WHERE r.id = ?`,
  )
    .bind(reportId)
    .first<{
      id: number;
      project_id: number;
      seq: number | null;
      doc_no: string | null;
      report_date: string;
      project_name: string | null;
      team_code: string | null;
    }>();
  if (!head) return null;

  const token = await signToken(
    { sub: actor.sub, role: actor.role, purpose: 'print' },
    env.JWT_SECRET,
    1 / 60,
  );
  const url =
    `${env.FRONTEND_URL.replace(/\/+$/, '')}/app/projects/${head.project_id}/asr/${head.id}/print` +
    `?t=${encodeURIComponent(token)}`;

  let browser: BrowserSession | null = null;
  try {
    browser = await launchBrowser(env.BROWSER);
    const page = await browser.newPage();
    await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
    try {
      await page.waitForSelector('body[data-print-ready="true"]', { timeout: 25000 });
    } catch {
      // Render the best available snapshot; same fallback as the existing ASR PDF route.
    }
    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    const stem = asrFileStem({
      reportDate: head.report_date,
      projectName: head.project_name,
      teamCode: head.team_code,
      seq: head.seq,
      docNo: head.doc_no,
    });
    return {
      bytes: pdf instanceof Uint8Array ? pdf : new Uint8Array(pdf as ArrayBuffer),
      fileName: `${stem}.pdf`,
    };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // no-op
      }
    }
  }
}

async function renderCorrespondence(
  env: Env,
  entryId: number,
  actor: SigningRenderActor,
): Promise<RenderedDocument | null> {
  const entry = await env.DB.prepare('SELECT id, doc_type, ref_no FROM correspondence_log WHERE id = ?')
    .bind(entryId)
    .first<{ id: number; doc_type: string | null; ref_no: string | null }>();
  if (!entry) return null;
  const bytes = await renderCorrespondencePdf(env, entryId, actor);
  const prefix = entry.doc_type === 'cr' ? 'CR' : 'RFI';
  return {
    bytes,
    fileName: `${(entry.ref_no ?? `${prefix}-${entry.id}`).replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf`,
  };
}

export const realSigningRender: SigningRenderIo = {
  render(env, kind, entityId, actor) {
    return kind === 'correspondence'
      ? renderCorrespondence(env, entityId, actor)
      : renderAsrPdf(env, entityId, actor);
  },
};

/**
 * «Баримт бичиг»-ийн гаднын link (0397): гарын үсэгтэй Word снапшотыг `/sign/:token/print`
 * хуудсаар (docx-preview) PDF болгоно.  Хуудас бэлэн болоогүй (`data-print-ready`) эсвэл
 * алдаа тэмдэглэсэн (`data-print-error`) бол АЛДАА шиднэ — хоосон/алдааны хуудас PDF болж
 * кэшлэгдвэл захиалагч үүрд тэрийг харна.
 */
export async function renderDriveSignedPdf(env: Env, url: string): Promise<Uint8Array> {
  let browser: BrowserSession | null = null;
  try {
    browser = await launchBrowser(env.BROWSER);
    const page = await browser.newPage();
    await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForSelector('body[data-print-ready="true"]', { timeout: 25000 });
    // Мөр хэлбэрээр — backend-ийн tsconfig-д DOM lib байхгүй (performanceReports.ts-тэй ижил).
    const failed = (await page.evaluate(`document.body.getAttribute('data-print-error')`)) as string | null;
    if (failed) throw new Error(`print page error: ${failed}`);
    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    return pdf instanceof Uint8Array ? pdf : new Uint8Array(pdf as ArrayBuffer);
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // no-op
      }
    }
  }
}
