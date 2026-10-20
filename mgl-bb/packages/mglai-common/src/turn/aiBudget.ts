/**
 * MGL AI · ҮЕ ШАТНЫ ХУГАЦААНЫ БОДЛОГО (§9).
 *
 * ⚠️ ЗОРИУД ЦЭВЭР МОДУЛЬ — сүлжээ, React, `apiFetch` ЭНД ОРОХГҮЙ.  Энэ нь
 *    зохион байгуулагчаас САЛГАГДСАН учир нь хоёр шалтгаантай:
 *      1. Энэ бол БОДЛОГО (хэдэн секундэд санаа зовох вэ), гүйцэтгэл биш.
 *      2. Тиймээс `scripts/check-ai-stream.mjs` түүнийг хөтөчийн alias
 *         (`@/shared/...`) шийдэлгүйгээр шууд ачаалж тестлэнэ.
 */
import { STAGE_LABEL, type AiStage } from './aiEvents.ts';

/**
 * ⚠️ ЭДГЭЭР НЬ «БҮТЭЛГҮЙТЭХ» ХУГАЦАА БИШ, «САНАА ЗОВОХ» ХУГАЦАА (§9).
 *    `slowMs`-д хүрэхэд ТӨВИЙГ САХИСАН мөр гарна, ажил ҮРГЭЛЖИЛНЭ.
 *    `hardMs` нь зөвхөн аюулгүйн сүүлчийн хана — гацсан хүсэлт мөнхөд
 *    амьд үлдэхээс сэргийлнэ.
 *
 * ⚠️ ТООНУУД НЬ ХЭМЖИЛТЭЭС ГАРСАН, таамгаас БИШ (2026-09-09, локал):
 *      /plan       ~5 мс      · /context  17-32 мс
 *      /tool       ~37 мс/ш   · локал /norm  8-18 мс
 *    Прод дээр worker-ийн ХҮЙТЭН эхлэлт 9-20 сек хүрдэг (CLAUDE.md), тул
 *    сервер рүү явдаг үе шатны `hardMs` нь түүнээс ХАМААРАЛТАЙ ӨГӨӨМӨР
 *    байх ЁСТОЙ — эс тэгвэл яг хуучин алдаа руугаа буцна.
 */
export const STAGE_BUDGET: Record<AiStage, { slowMs: number; hardMs: number }> = {
  accept: { slowMs: 1_000, hardMs: 5_000 },
  // ⚠️ Хүйтэн worker-ийг БАРЬЖ АВНА: 45 сек нь баримтжуулсан 9-20 сек
  //    хүйтэн эхлэлтээс хамаагүй өгөөмөр.
  plan: { slowMs: 4_000, hardMs: 45_000 },
  tools: { slowMs: 8_000, hardMs: 45_000 },
  norm_retrieval: { slowMs: 3_000, hardMs: 15_000 },
  context: { slowMs: 8_000, hardMs: 60_000 },
  // ⚠️ ҮҮСГЭЛТЭД ХАТУУ ХЯЗГААР ТАВИХГҮЙ (`Infinity`).  Урт хариулт нь
  //    хууль ёсоор минут үргэлжилж болно, харин ЦОХИЛТ нь «амьд эсэх»-ийг
  //    хэлнэ (§10).  Хэрэглэгч «Зогсоох» товчоор бүрэн эрхтэй (§22).
  generation: { slowMs: 20_000, hardMs: Number.POSITIVE_INFINITY },
  // Шалгалт нь детерминист (<1 мс); дахилт нь үүсгэлтийн төсөвтэй.
  validate: { slowMs: 20_000, hardMs: Infinity },
  persist: { slowMs: 5_000, hardMs: 30_000 },
};

/** Цохилт хэдэн мс ирэхгүй бол «холболт сэргээж байна» гэж үзэх вэ (§23). */
export const HEARTBEAT_GAP_MS = 12_000;

/**
 * Үе шатны ХАТУУ хязгаар дуусав.
 *
 * ⚠️ `name` нь `ApiNetworkError`, `timedOut` нь `true` — `classifyError`
 *    нь эдгээр хоёр талбараар шийддэг тул тусад нь салаа бичих
 *    шаардлагагүй.  Энэ нь ЦУЦЛАЛТ БИШ гэдгийг л батална.
 */
export class StageTimeoutError extends Error {
  readonly name = 'ApiNetworkError';
  readonly timedOut = true;
  readonly stage: AiStage;
  constructor(stage: AiStage, budgetMs: number) {
    super(`«${STAGE_LABEL[stage].running}» алхам ${Math.round(budgetMs / 1000)} секундэд дууссангүй.`);
    this.stage = stage;
  }
}

