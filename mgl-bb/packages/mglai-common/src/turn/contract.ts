/**
 * MGL AI · ХАРИУЛТЫН ГЭРЭЭ ТУЛГАГЧ (§25, §33 — «trusted result wins»).
 *
 * ⚠️ ЯАГААД ХӨТӨЧ ДЭЭР ВЭ.  Үүсгэлт нь ажилтны PC дээр явагдаж, хариулт
 *    хамгийн түрүүнд ЭНД харагдана — Worker түүнийг үүсгэлтийн дараа
 *    (`/messages`) л хардаг.  Тиймээс «загвар зөрсөн эсэх»-ийг
 *    харуулахаас ӨМНӨ шалгах цорын ганц цэг нь хөтөч.
 *
 * ⚠️ ГЭРЭЭГ СЕРВЕР БИЧНЭ, ЭНД ЗӨВХӨН ТУЛГАНА.  Татгалзлын өгүүлбэр,
 *    зөвшөөрөгдсөн тоо, заавал дурдах ангилал бүгд `/context`-ийн
 *    `answer_contract`-аас ирнэ (`backend/src/lib/mglai/answerContract.ts`).
 *    Энд хос тогтмол БАЙХГҮЙ — зөрөх юм байхгүй.
 *
 * ⚠️ ЗАСВАР НЬ ДЕТЕРМИНИСТ, ЗАГВАР ДАХИН ДУУДАХГҮЙ.  Хэмжигдсэн
 *    (2026-09-10): загвар «эх сурвалж олдсонгүй» гэж эхлэх тушаалыг
 *    үл хайхарч, шийдвэр байхад ч зохиомол тоо бичсэн.  Дахин
 *    үүсгэх нь ижил магадлалт замаар явна; энд харин:
 *      · татгалзал ЗААВАЛ байх бол — байхгүй үед нь НЭМНЭ, тоотой
 *        өгүүлбэрийг ХАСНА (татгалзалд тоо байж болохгүй);
 *      · шийдвэр байвал — детерминист хураангуйг ЭХЭНД тавьж, блокт
 *        байхгүй тоо агуулсан өгүүлбэрийг ХАСНА.
 *    Хассан бүрд `notices`-д тэмдэглэнэ — хэрэглэгчээс НУУХГҮЙ.
 *
 * ⚠️ ЦЭВЭР ФУНКЦ — `scripts/check-ai-contract.mjs` тестлэнэ.
 */

export interface AnswerContract {
  /** `norm_trusted` / `norm_review` / `norm_unavailable` — TrustedNormResult-ийн ээлж (2026-09-11). */
  kind: 'norm_refusal' | 'norm_decision' | 'norm_legal_review' | 'norm_trusted' | 'norm_review' | 'norm_unavailable' | 'analysis_metric' | 'none';
  requiredSentence: string | null;
  mustMention: string[];
  allowedNumbers: number[] | null;
  trustedText: string | null;
  /** ТӨГСГӨЛД заавал байх мөр — хуучин баримт, шинжилгээний хэмжүүрийн анхааруулга. */
  trailerText?: string | null;
  taskIndex: number | null;
  reason: string;
}

export interface ContractOutcome {
  answer: string;
  /** Хэрэглэгчид харуулах ТӨВИЙГ САХИСАН тэмдэглэл — юу засагдав. */
  notices: string[];
  /** Оношилгоо: хассан өгүүлбэрийн тоо, нэмсэн мөр. */
  removedSentences: number;
  prependedTrusted: boolean;
  appendedRequired: boolean;
}

/** Текстээс тоонуудыг гаргана — «1 800», «1,5», «2200» бүгд. */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(?<![\p{L}\d])(\d{1,3}(?:[ \u00A0]\d{3})+|\d+(?:[.,]\d+)?)(?![\d])/gu)) {
    const v = Number(m[1]!.replace(/[ \u00A0]/g, '').replace(',', '.'));
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

/**
 * Өгүүлбэрт хуваана — markdown жагсаалт, мөр, «.», «!», «?»-ээр.
 *
 * ⚠️ Тоо агуулсан ӨГҮҮЛБЭРИЙГ Л хасна, бүх хариултыг биш — загварын
 *    зөв тайлбарын хэсэг үлдэнэ.
 */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * ТОО-БИШ тоонууд — огноо (2026-09-10), цаг (10:30), нормын баримтын код
 * (БД 21-101-12, БНбД 21-04-05), гурван түвшний заалт (4.2.1), «заалт 4.20».
 *
 * ⚠️ Баримтын кодыг маскалахгүй бол «БД 21-101-12» гэсэн ЗӨВ эшлэл нь
 *    «21, 101, 12» гэсэн гурван зөвшөөрөгдөөгүй тоо болж, эшлэлтэй
 *    өгүүлбэр хасагдана — үнэнийг хамгаалах гэж байгаад үнэнийг устгана.
 */
const NOT_A_NUMBER = [
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b\d{1,2}:\d{2}\b/g,
  /\b\d{2}-\d{2,3}-\d{2}(?:-\d{2})?\b/g,
  /\b\d+\.\d+\.\d+\b/g,
  /(?:заалт|п\.|§|clause|хэсэг)\s*\d+(?:\.\d+)*/giu,
];

function forbiddenNumbers(sentence: string, allowed: readonly number[]): number[] {
  let cleaned = sentence;
  for (const re of NOT_A_NUMBER) cleaned = cleaned.replace(re, ' ');
  const set = new Set(allowed);
  return numbersIn(cleaned).filter((n) => !set.has(n));
}

/**
 * Хариултаас гэрээнд хамаарах ХЭСГИЙГ тусгаарлана.  Олон даалгаварт
 * «2)» хэсэг л; нэг даалгаварт бүхэлдээ.
 */
function sectionOf(
  answer: string,
  taskIndex: number | null,
): { before: string; marker: string; body: string; after: string } {
  if (taskIndex === null) return { before: '', marker: '', body: answer, after: '' };
  const re = new RegExp(`(^|\\n)(\\s*${taskIndex}\\)\\s*)`, 'u');
  const m = re.exec(answer);
  // Загвар дугаарлаагүй — бүхэл хариултыг «before» гэж үзээд гэрээний
  // хэсгийг ТӨГСГӨЛД нэмнэ (алдахгүй).
  if (!m) return { before: answer.length > 0 ? `${answer}\n\n` : '', marker: `${taskIndex}) `, body: '', after: '' };
  const markerStart = m.index + m[1]!.length;
  const start = markerStart + m[2]!.length;
  const next = new RegExp(`\\n\\s*${taskIndex + 1}\\)`, 'u').exec(answer.slice(start));
  const end = next ? start + next.index : answer.length;
  return {
    before: answer.slice(0, markerStart),
    marker: m[2]!,
    body: answer.slice(start, end),
    after: answer.slice(end),
  };
}

/** ⚠️ ГОЛ ФУНКЦ.  Гэрээг хариултад тулгаж, шаардлагатай бол засна. */
export function applyContract(answer: string, contract: AnswerContract | null | undefined): ContractOutcome {
  const base: ContractOutcome = {
    answer,
    notices: [],
    removedSentences: 0,
    prependedTrusted: false,
    appendedRequired: false,
  };
  if (!contract || contract.kind === 'none') return base;

  const { before, marker, body, after } = sectionOf(answer, contract.taskIndex);
  // ⚠️ Хураангуй өөрөө хуудас, хүснэгтийн тоо агуулдаг — түүнийг шалгалтаас
  //    ГАРГАНА, эс тэгвэл өөрийнхөө үнэнийг хасна.
  const hadTrusted = contract.trustedText !== null && body.includes(contract.trustedText);
  let text = contract.trustedText ? body.split(contract.trustedText).join('').trim() : body;

  // ── 1. Зөвшөөрөгдөөгүй тоотой өгүүлбэрийг хасна ────────────────
  if (contract.allowedNumbers !== null) {
    const kept: string[] = [];
    for (const s of splitSentences(text)) {
      const bad = forbiddenNumbers(s, contract.allowedNumbers);
      if (bad.length > 0) {
        base.removedSentences += 1;
        continue;
      }
      kept.push(s);
    }
    if (base.removedSentences > 0) {
      text = kept.join('\n');
      base.notices.push(
        contract.kind === 'norm_refusal'
          ? 'Баталгаагүй тоо агуулсан өгүүлбэрийг хаслаа — эх сурвалжгүй тоо хэлэхгүй.'
          : 'Баталгаажсан шийдвэрт байхгүй тоо агуулсан өгүүлбэрийг хаслаа.',
      );
    }
  }

  // ── 2. Заавал байх өгүүлбэр (татгалзал) ────────────────────────
  if (contract.requiredSentence && !text.includes(contract.requiredSentence)) {
    text = text.length > 0 ? `${contract.requiredSentence}\n\n${text}` : contract.requiredSentence;
    base.appendedRequired = true;
  }

  // ── 3. Детерминист хураангуй ЭХЭНД ─────────────────────────────
  if (contract.trustedText) {
    const mentionsAll = contract.mustMention.every((m) => text.includes(m));
    // ⚠️ ҮРГЭЛЖ нэмнэ — загвар ангиллыг дурдсан ч хураангуй нь үнэний
    //    баталгаа.  Давхардахгүй: хураангуй аль хэдийн байвал алгасна.
    text = text.length > 0 ? `${contract.trustedText}\n\n${text}` : contract.trustedText;
    base.prependedTrusted = !hadTrusted;
    if (!mentionsAll) {
      base.notices.push('Загварын тайлбар шийдвэрийн ангиллыг дурдаагүй тул баталгаажсан хураангуйг эхэнд тавилаа.');
    }
  }

  // ── 4. Трейлер ТӨГСГӨЛД (хуучин баримт / шинжилгээний хэмжүүр) ──
  // ⚠️ Загвар өөрөө бичсэн бол давхардуулахгүй; бичээгүй бол ЗААВАЛ нэмнэ —
  //    «албан ёсны KPI биш», «хүний хяналт шаардлагатай» гэдэг нь
  //    хэрэглэгчийн шийдвэрт нөлөөлөх мөр тул загварын дуулгавартай
  //    байдалд найдахгүй (§17, §23).
  let full = `${before}${marker}${text}${after}`.trim();
  if (contract.trailerText && !full.includes(contract.trailerText)) {
    full = full.length > 0 ? `${full}

${contract.trailerText}` : contract.trailerText;
    base.appendedRequired = true;
  }
  base.answer = full;
  return base;
}
