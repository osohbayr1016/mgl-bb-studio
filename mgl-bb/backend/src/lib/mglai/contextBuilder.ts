/**
 * MGL AI · КОНТЕКСТ УГСРАГЧ (ярианы кернел, 3-р хэсэг).
 *
 * ⚠️ ЯРИАНЫ ТҮҮХ ≠ PROMPT-ЫН КОНТЕКСТ.  Энэ файлын оршин байх шалтгаан
 *    нь тэр тэгш бус байдал.  Загварт ӨНДӨР ДОХИОТОЙ зүйл л очно:
 *
 *      СИСТЕМ ЦӨМ + ОДООГИЙН АСУУЛТ + ХАМААРАЛТАЙ СҮҮЛИЙН ЭЭЛЖ
 *      + БҮТЭЦТЭЙ ИДЭВХТЭЙ ТӨЛӨВ + ХАМААРАЛТАЙ ХАЙЛТ + ХЭРЭГСЛИЙН ҮР ДҮН
 *
 *    ОРОХГҮЙ: өмнөх бүх мессеж, өмнөх хайлтын үр дүн, өмнөх ERP-ийн
 *    тоо, хамааралгүй төсөл, хуучирсан Revit төлөв.  Тэдгээр нь prompt-д
 *    орсноор (а) гоожилт, (б) давталт, (в) 8K контекст халих — гурван
 *    хэмжигдсэн гажиг үүсгэдэг байсан.
 *
 * ⚠️ PERSONA БОЛ ДАЛД КОНТЕКСТ, ЧИМЭГ БИШ.  Хэрэглэгчийн нэр, албан
 *    тушаал, баг, Revit эрх нь prompt-д ҮРГЭЛЖ ордог байсан тул загвар
 *    хариулж чадахгүй үедээ тэдгээрийг ДҮҮРГЭГЧ болгон давтдаг байв
 *    («Та X багийн инженер, Revit эрх READ_ONLY…» — асуугаагүй байхад).
 *    Одоо persona нь ЗӨВХӨН дараах үед орно:
 *      1. хэрэглэгч ӨӨРИЙНХӨӨ тухай асуусан («миний даалгавар»)
 *      2. мэндчилгээ/мета — нэр Л (албан тушаалгүй)
 *      3. `get_my_assignments` төлөвлөгдсөн
 *    Бусад үед ОГТ орохгүй — гоожих юм байхгүй бол гоожилт байхгүй.
 *
 * ⚠️ ЦЭВЭР ФУНКЦ — D1-гүй, тестлэгдэнэ (`contextBuilder.test.ts`).
 */
import type { ChatTurn } from './promptFrame';
import type { EmployeePersona } from './persona';
import type { TurnInterpretation, TurnKind } from './turn';
import { isSelfReference } from './turn';
import type { ConvSubject } from './convState';

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Өмнөх ХАРИУЛТЫГ хэдэн тэмдэгтээр тайрах вэ — ээлжийн төрлөөр. */
const ASSISTANT_CAP: Record<TurnKind, number> = {
  NEW_TOPIC: 0,
  MULTI_INTENT: 0,
  CONTINUATION: 500,
  FOLLOW_UP: 700,
  CLARIFICATION: 700,
  CORRECTION: 500,
  // Лавлагаа («хоёр дахь нь?») нь өмнөх ЖАГСААЛТЫГ бүхэлд нь шаарддаг.
  REFERENCE_TO_PRIOR_RESULT: 1400,
};
const USER_CAP = 300;

/** Тайрахдаа ӨГҮҮЛБЭРИЙН хил дээр зогсоно — хагас үг prompt-д орохгүй. */
export function clipText(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (max <= 0) return '';
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const cut = Math.max(head.lastIndexOf('. '), head.lastIndexOf('\n'), head.lastIndexOf('; '));
  const clipped = cut > max * 0.5 ? head.slice(0, cut + 1) : head;
  return `${clipped.trimEnd()} …`;
}

/**
 * Түүхээс ЭНЭ ээлжид хэрэгтэй мессежийг сонгоно.
 *
 * ⚠️ NEW_TOPIC / MULTI_INTENT → ХООСОН.  Гоожилтын гол хаалга энэ.
 * ⚠️ Бусад төрөлд сүүлийн `historyMessages` мессеж, туслахын хариулт
 *    ТАЙРАГДСАН — өмнөх 900 токены хариулт бүтнээрээ орвол загвар
 *    түүнийг ДАХИН бичих хандлагатай (давталтын програм талын эх).
 * ⚠️ Алдаатай/хоосон мессеж ОРОХГҮЙ.
 */
export interface SelectHistoryOptions {
  /**
   * ⚠️ ДЕТЕРМИНИСТ НОРМЫН ҮР ДҮН ГАРСАН ЭЭЛЖ (TrustedNormResult) — өмнөх ТУСЛАХЫН
   *    хариултыг prompt-д ОГТ оруулахгүй, хэрэглэгчийн мессеж хэвээр.  Хэмжсэн
   *    (GOLD multi-turn, 2026-09-11): «g=1800 → В2» хариулсны дараа «Q=50000, H=6»
   *    гэхэд загвар өмнөх «В2» хариултаа шинэ шийдвэрийн (В1) дээгүүр давтаж
   *    байв.  Шийдвэрийн блок нь ЦОРЫН ГАНЦ үнэн — өмнөх хариулт нь бохирдол.
   *    Хэрэглэгчийн өмнөх мессеж («g=1800 МДж/м²») харин ОРОЛТ тул үлдэнэ.
   */
  dropAssistant?: boolean;
}

export function selectHistory(
  history: readonly HistoryMessage[],
  turn: TurnInterpretation,
  opts: SelectHistoryOptions = {},
): ChatTurn[] {
  const n = turn.historyMessages;
  if (n <= 0) return [];
  const cap = opts.dropAssistant ? 0 : ASSISTANT_CAP[turn.kind];
  const tail = history.filter((m) => m.content.trim().length > 0).slice(-n);
  const out: ChatTurn[] = [];
  for (const m of tail) {
    const content = m.role === 'assistant' ? clipText(m.content, cap) : clipText(m.content, USER_CAP);
    if (content.length === 0) continue;
    out.push({ role: m.role, content });
  }
  // Түүх ҮРГЭЛЖ хэрэглэгчийн мессежээр эхэлнэ — эс тэгвэл загварын
  // хариулт «өмнөх хариултын үргэлжлэл» мэт уншигдана.
  while (out.length > 0 && out[0]!.role === 'assistant') out.shift();
  return out;
}

/**
 * Идэвхтэй сэдвийн НЭГ мөр — бүтэцтэй төлөв prompt-д ингэж орно.
 *
 * ⚠️ ЗӨВХӨН ҮРГЭЛЖЛЭЛ ДЭЭР.  Шинэ сэдэвт сэдвийн мөр байхгүй —
 *    «Идэвхтэй сэдэв: Төсөл A» гэсэн мөр нормын асуултад орвол яг тэр
 *    гоожилт буцаж ирнэ.
 */
export function subjectLine(turn: TurnInterpretation): string | null {
  if (turn.kind === 'NEW_TOPIC' || turn.kind === 'MULTI_INTENT') return null;
  const s: ConvSubject | null = turn.subject;
  if (s === null) return null;
  if (s.kind === 'project') {
    return turn.kind === 'CORRECTION'
      ? `ИДЭВХТЭЙ СЭДЭВ (хэрэглэгч ЗАСВАРЛАВ — өмнөх төслийг МАРТ): төсөл «${s.name}» (id ${s.id}).`
      : `ИДЭВХТЭЙ СЭДЭВ: төсөл «${s.name}» (id ${s.id}). «энэ», «тэр», «яагаад» нь энэ төслийг заана.`;
  }
  if (s.kind === 'norm') return `ИДЭВХТЭЙ СЭДЭВ: норм ${s.label}.`;
  return `ИДЭВХТЭЙ СЭДЭВ: ${s.label}.`;
}

/* ================================================================== */
/*  Persona                                                            */
/* ================================================================== */

export type PersonaPolicy = 'none' | 'name_only' | 'full';

/**
 * Persona-г prompt-д ЯМАР ХЭМЖЭЭГЭЭР оруулах вэ.
 *
 * ⚠️ ӨГӨГДМӨЛ нь `none`.  Дүүргэгч болж гоожсон нь хэмжигдсэн тул
 *    «магадгүй хэрэгтэй» гэж оруулахгүй — хэрэгтэй үед нь Л.
 */
export function personaPolicy(input: {
  intent: string;
  question: string;
  plannedTools: readonly string[];
}): PersonaPolicy {
  if (input.plannedTools.includes('get_my_assignments')) return 'full';
  if (isSelfReference(input.question)) return 'full';
  if (input.intent === 'CASUAL' || input.intent === 'META') return 'name_only';
  return 'none';
}

/** Persona-г бодлогын дагуу мөр болгоно — `personaLine`-ийн хязгаарлагдсан хос. */
export function personaText(p: EmployeePersona | null, policy: PersonaPolicy): string | null {
  if (p === null || policy === 'none') return null;
  if (policy === 'name_only') return `Хэрэглэгчийн нэр: ${p.name}.`;
  const bits = [`Хэрэглэгчийн нэр: ${p.name}.`];
  if (p.position) bits.push(`Албан тушаал: ${p.position}.`);
  if (p.teamName) bits.push(`Баг: ${p.teamName}${p.teamCode ? ` (${p.teamCode})` : ''}.`);
  if (p.openTaskCount > 0) bits.push('Түүнд дуусгаагүй даалгавар бий; тодорхой жагсаалтыг хэрэгслээр ав.');
  if (p.nextDueDate) bits.push(`Хамгийн ойрын товлосон хугацаа: ${p.nextDueDate}.`);
  return bits.join(' ');
}

/** Revit эрхийн мөрийг ЗӨВХӨН Revit-ийн санаанд оруулна. */
export function revitLevelVisible(intent: string, hasRevitContext: boolean): boolean {
  return intent === 'REVIT_READ' || intent === 'REVIT_ACTION' || hasRevitContext;
}
