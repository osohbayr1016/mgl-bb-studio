import type { PdfBlockContext } from '@/features/performance-reports/components/PdfBlockRenderer';
import type { CoverOverride } from '@/features/performance-reports/types/performanceReportBlocks';
import { resolveProjectIdentity } from '@/shared/lib/projectIdentity';

/* =============================================================
 * Блокийн render model-ийг авто (ctx-ээс) тооцоод override-ийг
 * түүн дээр талбараар нь давхарлана. Renderer ба editor хоёулаа
 * үүнийг ашиглаж нэг эх сурвалжтай байна.
 * ============================================================= */

/** Cover-ийн бүрэн render model (CoverPageProps-тэй ижил). */
export interface CoverModel {
  reportNo: number;
  periodStart: string;
  periodEnd: string;
  projectFullTitle: string | null;
  projectName: string;
  clientName: string | null;
  drawingNo: string | null;
}

/** Cover-ийн авто model-ийг PdfBlockContext-ээс гаргана
 *  (PdfBlockRenderer-ийн одоогийн cover mapping-тэй яг адил). */
export function resolveCoverAuto(ctx: PdfBlockContext): CoverModel {
  /* ⚠️ Гарчиг ба шифрийн шатлалыг ЭНД БИТГИЙ БИЧ — `shared/lib/
   * projectIdentity.ts` нь §1, нүүр хуудас, гүйцэтгэлийн хураангуй ба
   * захиалагчийн PDF дөрвүүлэнгийн ЦОРЫН ГАНЦ эх сурвалж.  Урьд нь энэ
   * мөр `full_title ?? name` гэж §1-ийн хуулбарыг барьдаг байсан тул
   * `display_title`-тай, паспортгүй төсөл дээр нүүр хуудас нь §1-ээс
   * ӨӨР нэр хэвлэдэг байв. */
  const identity = resolveProjectIdentity({
    project: ctx.project.project,
    passport: ctx.passport,
  });
  return {
    reportNo: ctx.report.report_no,
    periodStart: ctx.report.period_start,
    periodEnd: ctx.report.period_end,
    projectFullTitle: identity.title,
    projectName: identity.shortName,
    /* ⚠️ Захиалагчийг ЗОРИУД resolver-ээс АВАХГҮЙ.  Resolver нь §1-ийн
     * хэлбэрийг («"А ХХК", "Б ХХК"» — хашилттай, бүгдийг таслалаар)
     * буцаадаг бол нүүр хуудас нь ЭХНИЙ захиалагчийг хашилтгүй хэвлэдэг.
     * Хэлбэрийг нэгтгэх нь ОЛГОГДСОН тайлангийн нүүрийг чимээгүй
     * дахин бичих тул тусдаа шийдвэр (эзний баталгаа шаардана). */
    clientName: ctx.project.clients?.[0]?.name ?? null,
    /* `ctx.drawingNo` нь дуудагчийн тооцоолсон утга (бүх зам дээр
     * `passport.drawing_no`).  Паспортаас ХООСОН ирэхэд л сүүлийн шат
     * болж үлдэнэ — TemplatePreview-ийн stub зам эвдрэхгүй. */
    drawingNo: identity.drawingNo || ctx.drawingNo,
  };
}

/** Хоосон/undefined талбарыг хасаж зөвхөн жинхэнэ override-уудыг үлдээнэ. */
function compactCoverOverride(ov: CoverOverride | null | undefined): Partial<CoverModel> {
  if (!ov) return {};
  const out: Partial<CoverModel> = {};
  if (ov.projectFullTitle != null && ov.projectFullTitle !== '')
    out.projectFullTitle = ov.projectFullTitle;
  if (ov.clientName != null && ov.clientName !== '') out.clientName = ov.clientName;
  if (typeof ov.reportNo === 'number' && Number.isFinite(ov.reportNo)) out.reportNo = ov.reportNo;
  if (ov.periodStart != null && ov.periodStart !== '') out.periodStart = ov.periodStart;
  if (ov.periodEnd != null && ov.periodEnd !== '') out.periodEnd = ov.periodEnd;
  if (ov.drawingNo != null && ov.drawingNo !== '') out.drawingNo = ov.drawingNo;
  return out;
}

/** Авто model дээр override-ийг талбараар нь давхарлана. */
export function resolveCover(
  ctx: PdfBlockContext,
  override: CoverOverride | null | undefined,
): CoverModel {
  return { ...resolveCoverAuto(ctx), ...compactCoverOverride(override) };
}

/** Editor-д: override-ийн аль талбар жинхэнэ override болсныг шалгана
 *  ("Өөрчилсөн" badge + reset). */
export function coverHasOverride(override: CoverOverride | null | undefined): boolean {
  return Object.keys(compactCoverOverride(override)).length > 0;
}

/** Аль ч блок override-той эсэх (жагсаалтын "Өөрчилсөн" badge-д).
 *  Sub-project бүр өөрийн төрлийг энд нэмнэ. */
export function blockHasOverride(block: { type: string; content: unknown }): boolean {
  if (block.type === 'cover') {
    const c = block.content as { override?: CoverOverride | null };
    return coverHasOverride(c.override);
  }
  return false;
}

/* =============================================================
 * ТАЙЛАНГИЙН ХАРАГДАХ ДУГААР — НЭГ ЭХ СУРВАЛЖ
 * -------------------------------------------------------------
 * Нүүр хуудасны том дугаарыг хэрэглэгч гараар өөрчилж болдог
 * (`CoverOverride.reportNo`).  Гэтэл хуудас бүрийн жижиг толгой
 * («Гүйцэтгэлийн тайлан №NN») болон PDF-ийн давтагдах header нь
 * `report.report_no` буюу ӨГӨГДЛИЙН САНГИЙН утгыг уншдаг байсан тул
 * нүүрэн дээр №02 гэж бичсэн атал бусад хуудсууд №04 гэж гарч байв
 * (2026-08-25-нд хэрэглэгч илрүүлсэн).
 *
 * Одооноос нүүр хуудасны override нь БҮХ ГАЗАР мөрдөгдөнө.
 * `report_no` нь DB-д хэвээр үлдэнэ — тэр нь төслийн доторх дараалал,
 * давхардлын түлхүүр (UNIQUE(project_id, report_no)) тул хөндөхгүй.
 * ============================================================= */
export function effectiveReportNo(
  blocks: ReadonlyArray<{ type: string; content: unknown }>,
  fallback: number,
): number {
  const cover = blocks.find((b) => b.type === 'cover');
  if (!cover) return fallback;
  const ov = (cover.content as { override?: CoverOverride | null } | null)?.override;
  if (ov && typeof ov.reportNo === 'number' && Number.isFinite(ov.reportNo)) return ov.reportNo;
  return fallback;
}
