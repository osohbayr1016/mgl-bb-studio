/**
 * RFI/CR бичгийн PDF — `routes/authorSupervision.ts`-ийн `/:id/pdf`-ийн ЯГ ТЭР
 * жор: 1 минутын print токен → frontend-ийн `/correspondence/:id/print?t=…`
 * (ProtectedRoute-ийн ГАДНА — захиалагчийн токеноор ч ачаалагдана) →
 * `body[data-print-ready="true"]` → `page.pdf()`.
 *
 * Хадгалалт нь КЭШ: байтууд ХУВИЙН `MEETING_BUCKET`-д (`client/correspondence-pdf/…`),
 * түлхүүр нь `correspondence_log.pdf_key`.  Эх үнэн нь DB мөр — кэш алга эсвэл
 * хуучирсан (`pdfIsCurrent` false) бол `GET /:id/pdf` шууд дахин рендерлэнэ.
 * Тиймээс гарын үсэг/хүсэлтийн зам дээр `waitUntil`-д рендер хийх нь зөвхөн
 * ХУРД (захиалагч дарахад бэлэн байх), зөв ажиллагааны нөхцөл БИШ.
 *
 * ⚠️ Print токен нь ДУУДАГЧИЙН өөрийн identity — захиалагч зурсан бол
 *    захиалагчийн (role=client) токеноор рендерлэнэ; print хуудасны API
 *    (`GET /api/correspondence/:id`) захиалагчид уншихыг зөвшөөрдөг тул
 *    хэн нэгний нэрээр impersonate хийх шаардлагагүй.
 */
import type { Env, UserRole } from '../types';
import { launchBrowser, type BrowserSession } from './browser';
import { signToken } from './jwt';
import { correspondencePdfKey } from './correspondenceSignature';

/** `frontend/.../correspondencePrintStyles.ts`-ийн `CORR_PAGE_MARGIN_MM`-тэй ЗААВАЛ ТЭНЦҮҮ. */
const PAGE_MARGIN = { top: '14mm', right: '19.05mm', bottom: '20mm', left: '19.05mm' } as const;

export async function renderCorrespondencePdf(
  env: Env,
  entryId: number,
  actor: { sub: number; role: UserRole },
): Promise<Uint8Array> {
  const printToken = await signToken(
    { sub: actor.sub, role: actor.role, purpose: 'print' },
    env.JWT_SECRET,
    1 / 60,
  );
  const base = env.FRONTEND_URL.replace(/\/+$/, '');
  const printUrl = `${base}/correspondence/${entryId}/print?t=${encodeURIComponent(printToken)}`;

  let browser: BrowserSession | null = null;
  try {
    browser = await launchBrowser(env.BROWSER);
    const page = await browser.newPage();
    await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 1 });
    await page.goto(printUrl, { waitUntil: 'networkidle0', timeout: 30000 });
    try {
      await page.waitForSelector('body[data-print-ready="true"]', { timeout: 25000 });
    } catch {
      /* юу зурагдсаныг нь авна */
    }

    // Хөл — ASR/Гүйцэтгэлийн тайлантай ижил: лого зүүн доод, «Хуудас x / y».
    let footerLogoHtml =
      '<span style="font-weight:700; color:#0F243E; letter-spacing:1px;">MGL E&amp;C</span>';
    try {
      const logoRes = await fetch(`${base}/logo.svg`);
      if (logoRes.ok) {
        const svg = await logoRes.text();
        const cropped = svg.replace(/viewBox="0 0 1920 1080"/, 'viewBox="735 345 470 390"');
        footerLogoHtml = `<img src="data:image/svg+xml,${encodeURIComponent(cropped)}" style="height:9mm; width:auto;" alt="MGL E&amp;C" />`;
      }
    } catch {
      /* үгэн тэмдэг хэвээр */
    }
    const footerTemplate = `
      <div style="width:100%; font-family:Arial,Helvetica,sans-serif; font-size:8px; color:#777; padding:5mm 19.05mm 0 19.05mm; box-sizing:border-box;">
        <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid #ddd; padding-top:4px;">
          ${footerLogoHtml}
          <span>Хуудас <span class="pageNumber"></span> / <span class="totalPages"></span></span>
        </div>
      </div>`;

    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate,
      margin: { ...PAGE_MARGIN },
    });
    return pdf instanceof Uint8Array ? pdf : new Uint8Array(pdf as ArrayBuffer);
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* swallow */
      }
    }
  }
}

/**
 * Рендерлээд хувийн bucket-д хадгалж, мөрийн `pdf_key`-г шинэчилнэ; хуучин
 * объектыг ДАРАА нь устгана (UPDATE амжилттай болсны дараа — `mediaReplace.ts`-ийн
 * ижил дүрэм).  Буцаах утга = шинэ түлхүүр.
 *
 * ⚠️ `pdf_generated_at`-ыг ЭХЛЭХ мөчөөр биш ДУУСАХ мөчөөр бичнэ — рендерийн
 *    дундуур ирсэн засварыг `pdfIsCurrent` (updated_at ≤ generated_at) алдахгүй
 *    байх нь чухал, гэвч дундуур засвар орсон бол print хуудас ХУУЧИН
 *    агуулгыг зурсан байж болно.  Тиймээс UPDATE-д `updated_at` хөдлөөгүй
 *    (`updated_at = ?` хуучин утгатайгаа тэнцүү) гэсэн нөхцөл тавина — зөрвөл
 *    кэш бичигдэхгүй, дараагийн GET дахин рендерлэнэ.
 */
export async function refreshCorrespondencePdf(
  env: Env,
  entry: { id: number; updated_at: string; pdf_key: string | null },
  actor: { sub: number; role: UserRole },
): Promise<string | null> {
  const bytes = await renderCorrespondencePdf(env, entry.id, actor);
  return storeCorrespondencePdf(env, entry, bytes, actor);
}

/** Аль хэдийн рендерлэсэн байтуудыг кэшлэнэ (GET /:id/pdf нэг л удаа рендерлэдэг). */
export async function storeCorrespondencePdf(
  env: Env,
  entry: { id: number; updated_at: string; pdf_key: string | null },
  bytes: Uint8Array,
  actor: { sub: number; role: UserRole },
): Promise<string | null> {
  const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  const key = correspondencePdfKey(entry.id, Date.now(), rand);
  await env.MEETING_BUCKET.put(key, bytes, {
    httpMetadata: { contentType: 'application/pdf' },
    customMetadata: { correspondenceId: String(entry.id), renderedBy: String(actor.sub) },
  });
  const res = await env.DB.prepare(
    `UPDATE correspondence_log
        SET pdf_key = ?, pdf_generated_at = ?
      WHERE id = ? AND updated_at = ?`,
  )
    .bind(key, new Date().toISOString(), entry.id, entry.updated_at)
    .run();
  if (!res.meta.changes) {
    // Мөр дундуур өөрчлөгдсөн — шинэ объект хэрэггүй, устгаад дараагийн GET-д үлдээнэ.
    await env.MEETING_BUCKET.delete(key).catch(() => undefined);
    return null;
  }
  if (entry.pdf_key && entry.pdf_key !== key) {
    await env.MEETING_BUCKET.delete(entry.pdf_key).catch(() => undefined);
  }
  return key;
}
