/* =====================================================================
 * Browser Rendering (puppeteer) — ЗАЛХУУ (lazy) ачаалагч
 * ---------------------------------------------------------------------
 *
 * ⚠️ `@cloudflare/puppeteer`-ийг ХЭЗЭЭ Ч route файлын дээд талд
 *    `import puppeteer from '@cloudflare/puppeteer'` гэж бүү оруул.
 *    Үргэлж энэ файлын `launchBrowser()`-ыг дуудна.
 *
 * ЯАГААД (хэмжсэн, 2026-08-24):
 *   Cloudflare нь worker-ийн isolate-ыг машин бүр дээр тусад нь асаадаг.
 *   Хүйтэн машинд тохирсон анхны хүсэлт нь script-ийн БҮХ дээд түвшний
 *   код гүйцэтгэгдэж дуустал хариу өгөхгүй хүлээнэ.  `@cloudflare/puppeteer`
 *   нь bundle-ийн ~640 КБ (rxjs + 45 КБ-ийн Device хүснэгт + олон зуун
 *   классын тодорхойлолт) бөгөөд PDF үүсгэх 6 гарцаас өөр хаана ч
 *   хэрэглэгддэггүй — гэтэл 5 route файлын дээд талаас статикаар
 *   импортлогдож байснаас болж ХҮСЭЛТ БҮРИЙН хүйтэн эхлэлт түүнийг
 *   гүйцэтгэдэг байв.
 *
 *   Хэмжилт (ULN colo, 8 шинэ холболт × 4 хүсэлт): хүйтэн машин дээр
 *   эхний 1-2 хүсэлт >9000 мс хариугүй, дулаарсны дараа 5-6 мс.  Шинэ
 *   холболтын ~40% нь ингэж өлгөгдөж, frontend-ийн `/auth/me` мөнхөд
 *   гацаж «Уншиж байна…» дэлгэц дээр зогсдог байв.
 *
 * `await import()` нь модулийн дээд түвшний кодыг ЭХНИЙ ДУУДЛАГА хүртэл
 * хойшлуулна.  PDF гарцууд нь аль хэдийн секунд хэмжигддэг тул тэнд нэмэгдэх
 * нэг удаагийн ачаалалт мэдэгдэхгүй; харин бусад БҮХ гарц түүнийг огт
 * төлөхгүй болно.
 *
 * `typeof import(...)` нь ЗӨВХӨН төрлийн байрлалд бичигдсэн тул build үед
 * бүрэн арилна — статик импорт үүсгэхгүй.
 *
 * Ижил загвар: `routes/performanceReports.ts`-ийн `html-to-docx`
 * (`await import('html-to-docx')`, ~2.2 МБ хамаарал).
 * ===================================================================== */

type PuppeteerModule = typeof import('@cloudflare/puppeteer');

/** Нээлттэй browser сесс — өмнөх `Awaited<ReturnType<typeof puppeteer.launch>>`-ийн орлуулга. */
export type BrowserSession = Awaited<ReturnType<PuppeteerModule['default']['launch']>>;

/**
 * Browser Rendering сесс нээнэ.  `binding` нь `c.env.BROWSER`.
 *
 * Дуудагч талд `finally { await browser?.close(); }` хийх үүрэг хэвээр —
 * энэ туслах нь зөвхөн импортыг хойшлуулна, өөр юу ч өөрчлөхгүй.
 */
export async function launchBrowser(binding: Fetcher): Promise<BrowserSession> {
  const { default: puppeteer } = await import('@cloudflare/puppeteer');
  return puppeteer.launch(binding);
}
