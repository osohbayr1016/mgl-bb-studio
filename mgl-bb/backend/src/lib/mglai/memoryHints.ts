/**
 * MGL AI · ЛОКАЛ САНАМЖИЙН ДОХИО (§34–36, ярианы кернелийн 3-р түвшин).
 *
 * ⚠️ ГУРВАН ТҮВШИН, ГУРВАН ӨӨР АМЬДРАЛ:
 *      1. ээлжийн төлөв       — `turn.ts`, нэг ээлж
 *      2. ярианы төлөв        — `convState.ts`, нэг яриа (клиентээр дамжина)
 *      3. урт хугацааны санамж — ЭНЭ, ажилтны PC дээр (хөтчийн localStorage,
 *                                 `memory_namespace`-аар), Cloudflare руу
 *                                 ХЭЗЭЭ Ч хадгалагдахгүй
 *
 * ⚠️ СЕРВЕР ЗӨВХӨН ДОХИОГ ТАНЬЖ, ХЭЛБЭРИЙГ ШИЙДНЭ.  «Хариултаа богино
 *    бичээрэй» гэсэн ИЛ хүсэлтийг энд танина; ХАДГАЛАХ эсэхийг хөтөч
 *    (хэрэглэгч) шийднэ, хадгалагдсан санамж prompt-д орохдоо
 *    `/context`-ийн `local_memory`-оор дамжиж `sanitizeMemory`-оор
 *    ариутгагдана.  Ингэснээр «сервер таньж, хэрэглэгч эзэмшинэ».
 *
 * ⚠️ САНАМСАРГҮЙ БАРИМТ САНАХГҮЙ (§34).  «Өнөөдөр төсөл A-ийн хурал»
 *    гэдэг нь санамж БИШ — зөвхөн ХЭВ МАЯГ, НЭР ТОМЬЁО, ИЛ баталсан
 *    тохиргоо.  Тиймээс энд ил хэлбэрийн («үргэлж», «цаашид», «бичээрэй»)
 *    ГАНЦ загварыг л танина; таамаглахгүй.
 *
 * ⚠️ ЦЭВЭР ФУНКЦ — тестлэгдэнэ.
 */
import { normalizeLatinMongolian } from './lang';

export const MEMORY_TYPES = ['answer_length', 'response_language', 'address_as', 'terminology', 'format'] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export interface MemoryCandidate {
  type: MemoryType;
  value: string;
  /** Prompt-д орох мөр — БИД бичнэ, хэрэглэгчийн текст биш. */
  text: string;
  /** Хэрэглэгчид харуулах товч. */
  label: string;
  /** Илрүүлсэн загвар — оношилгоо. */
  reason: string;
}

function fold(q: string): string {
  const lower = q.toLowerCase();
  return `${lower} ${normalizeLatinMongolian(lower).toLowerCase()}`;
}

/**
 * ⚠️ ГОЛ ФУНКЦ.  Асуултаас ИЛ тохиргооны хүсэлтийг гаргана.  Ихэнх
 *    асуултад ХООСОН массив — тэр нь зөв.
 */
export function detectMemoryHints(question: string): MemoryCandidate[] {
  const q = ` ${fold(question)} `;
  const out: MemoryCandidate[] = [];

  // Ил байнгын хүсэлт эсэх: «үргэлж», «цаашид», «дандаа», «бичээрэй/хариулаарай».
  // ⚠️ «-дэг болоорой» (= зуршил болго) нь ил байнгын хэлбэр: «хариултаа
  //    англиар бичдэг болоорой».  Хуучин загварт «-аарай» гэх мэт залгавар
  //    ЗУРААСТАЙ бичигдсэн тул жинхэнэ текстэнд («хэлээрэй») хэзээ ч
  //    таардаггүй байсан — SFT угсрагчийн manifest 5 удаа «hint алга» гэж барьсан.
  //    ASCII `\b` кирилл үсгийн хажууд үүсдэггүй тул үгийн төгсгөлийг
  //    `(?![\p{L}])`-ээр барина.
  const standing = /үргэлж|цаашид|дандаа|байнга|(?:аарай|ээрэй|оорой|өөрэй)(?![\p{L}])|бай(?![\p{L}])|болоорой|бол(?:оо|о)?рой|urgelj|tsaashid|dandaa|(?:aarai|eerei|ooroi|oorei)(?![\p{L}])|bolo+roi|always|from now on|going forward/u.test(q);

  if (/богино|товч|товчхон|хураангуй|богиноор|bogino|tovch|short answers?|answers? short|keep (?:it|them) short|shorter|brief|concise/u.test(q) && /хариул|бич|хэл|hariul|bich|answer|reply|keep/u.test(q)) {
    out.push({
      type: 'answer_length',
      value: 'short',
      text: 'Хариултаа БОГИНО, товч бич — 3–5 өгүүлбэр, шаардлагагүй тайлбаргүй.',
      label: 'Богино хариулт',
      reason: 'богино/товч + хариул',
    });
  } else if (/дэлгэрэнгүй|нарийвчилсан|урт|delgerengui|detailed|long answers?/u.test(q) && /хариул|бич|хэл|hariul|bich|answer|reply/u.test(q)) {
    out.push({
      type: 'answer_length',
      value: 'long',
      text: 'Хариултаа ДЭЛГЭРЭНГҮЙ, алхам алхмаар, жишээтэй бич.',
      label: 'Дэлгэрэнгүй хариулт',
      reason: 'дэлгэрэнгүй + хариул',
    });
  }

  // Хэл + үйл үг тус тусдаа: «англиар хариул», «хариултаа англиар бичдэг
  // болоорой», «answer in English», «write in English» бүгд нэг тохиргоо.
  // «English» гэсэн үг ГАНЦААРАА («English хэлний сургалт») санамж биш.
  const langVerb = /хариул|бич|хэл|ярь|hariul|bich|hel|answer|reply|write|respond/u.test(q);
  if (/англиар|англи хэлээр|англи хэл дээр|angliar|angli heleer|in english|english only/u.test(q) && langVerb) {
    out.push({ type: 'response_language', value: 'en', text: 'Reply in English.', label: 'Англиар хариулах', reason: 'англиар + хариул/бич' });
  } else if (/монголоор|монгол хэлээр|монгол хэл дээр|кириллээр|кирилл үсгээр|mongoloor|mongol heleer|kirilleer|in mongolian|in cyrillic/u.test(q) && langVerb) {
    out.push({ type: 'response_language', value: 'mn-Cyrl', text: 'Монгол кириллээр хариул.', label: 'Монголоор хариулах', reason: 'монголоор + хариул/бич' });
  }

  const addr = /(?:намайг|намайг\s+үргэлж|namaig)\s+«?([\p{L}\-. ]{2,30}?)»?\s+гэж\s+(?:дууд|хэл)|call me\s+([A-Za-z\p{L}\-. ]{2,30})/u.exec(question);
  const name = (addr?.[1] ?? addr?.[2])?.trim();
  if (name && name.length <= 30) {
    out.push({
      type: 'address_as',
      value: name,
      text: `Хэрэглэгчийг «${name}» гэж дууд.`,
      label: `«${name}» гэж дуудах`,
      reason: 'намайг X гэж дууд',
    });
  }

  if (/хүснэгтээр|хүснэгт хэлбэрээр|husnegteer|as a table|in table form/u.test(q) && /хариул|үзүүл|харуул|бич|hariul|show|answer/u.test(q)) {
    out.push({ type: 'format', value: 'table', text: 'Жагсаалт, харьцуулалтыг ХҮСНЭГТЭЭР үзүүл.', label: 'Хүснэгтээр', reason: 'хүснэгтээр + хариул' });
  }

  // ⚠️ Зөвхөн ИЛ байнгын хүсэлтийг санамж болгоно.  «Энэ удаа богино»
  //    гэдэг нь нэг удаагийн — хэлбэр танигдана, гэвч `standing` ХУДАЛ бол
  //    хөтөч түүнийг хадгалахгүй (тэр ялгааг ЭНД тэмдэглэнэ).
  return standing ? out : out.map((c) => ({ ...c, reason: `${c.reason} (нэг удаагийн)` }));
}

/** Хөтчөөс ирсэн санамжийг ариутгана — prompt-д орох ЦОРЫН ГАНЦ зам. */
export interface LocalMemoryLine {
  type: MemoryType;
  text: string;
  /** Бүтэцтэй утга (`en`, `mn-Cyrl`, `short`, …) — байвал; prompt-д ОРОХГҮЙ. */
  value?: string;
}

const MAX_MEMORY_LINES = 6;
const MAX_MEMORY_TEXT = 160;

export function sanitizeMemory(raw: unknown): LocalMemoryLine[] {
  if (!Array.isArray(raw)) return [];
  const out: LocalMemoryLine[] = [];
  const seenTypes = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const type = typeof r.type === 'string' && (MEMORY_TYPES as readonly string[]).includes(r.type) ? (r.type as MemoryType) : null;
    const text = typeof r.text === 'string' ? r.text.replace(/[\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim() : '';
    if (type === null || text.length === 0) continue;
    // Нэг төрлөөс НЭГ Л мөр — «богино» ба «дэлгэрэнгүй» зэрэг орж болохгүй.
    if (type !== 'terminology' && seenTypes.has(type)) continue;
    seenTypes.add(type);
    const value = typeof r.value === 'string' && /^[\p{L}\p{N}\- .]{1,40}$/u.test(r.value) ? r.value : undefined;
    out.push(value === undefined ? { type, text: text.slice(0, MAX_MEMORY_TEXT) } : { type, text: text.slice(0, MAX_MEMORY_TEXT), value });
    if (out.length >= MAX_MEMORY_LINES) break;
  }
  return out;
}

/**
 * Хадгалсан санамжаас ХАРИУЛТЫН ХЭЛИЙГ гаргана (`response_language` мөр).
 *
 * ⚠️ Prompt-ын мөр («Reply in English.») ганцаараа ХАНГАЛТГҮЙ — `/context`-ийн
 *    `response_language` нь `/generate` ба хэлний засварт очдог тул хэлийг
 *    ТҮҮГЭЭР ч тавихгүй бол загвар англиар бичээд засвар буцаан монгол болгоно.
 *    `value` байвал түүгээр, эс бөгөөс текстээс (хуучин хөтөч `value` илгээдэггүй).
 */
export function memoryResponseLanguage(lines: readonly LocalMemoryLine[]): 'en' | 'mn-Cyrl' | null {
  const m = lines.find((l) => l.type === 'response_language');
  if (!m) return null;
  const v = (m.value ?? '').toLowerCase();
  if (v === 'en' || v === 'mn-cyrl') return v === 'en' ? 'en' : 'mn-Cyrl';
  if (/english|англи/iu.test(m.text)) return 'en';
  if (/монгол|кирилл|mongol|cyrillic/iu.test(m.text)) return 'mn-Cyrl';
  return null;
}

/** Хадгалсан `answer_length` санамж → гүний тохиргоо (`depth.ts`-д). */
export function memoryAnswerLength(lines: readonly LocalMemoryLine[]): 'short' | 'long' | null {
  const m = lines.find((l) => l.type === 'answer_length');
  if (!m) return null;
  const v = (m.value ?? '').toLowerCase();
  if (v === 'short' || v === 'long') return v;
  if (/богино|товч|short|brief/iu.test(m.text)) return 'short';
  if (/дэлгэрэнгүй|detailed|long/iu.test(m.text)) return 'long';
  return null;
}
