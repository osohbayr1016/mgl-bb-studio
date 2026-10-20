/**
 * MGL AI · ЛОКАЛ НОРМЫН ХАРИУЛТЫН ХҮРЭЭ — асуултын ХЭЛБЭРЭЭР (2026-09-23).
 *
 * ⚠️ ЯАГААД.  2026-09-18-аас локал нормын хариулт БҮХЭЛДЭЭ детерминист (`templateOnly`) болсон: адаптер 0.4
 *    заалтаас хугацаа, нөхцөл ЗОХИОДОГ байв.  Үр дүнд нь хэрэглэгч «даамал ажлыг зогсоож чадах уу?» гэсэн
 *    асуултад 300 тэмдэгтээр тасалсан гурван заалтын жагсаалт л авч, «тийм/үгүй» ч, «яагаад» ч, «надад
 *    хамаарах уу» ч хариулт авдаггүй байв (эзний HL01–HL10, 2026-09-23, 0/10).  Энд загваргүйгээр — зөвхөн
 *    асуултын хэлбэр, заалтын төрөл, заалтын ТЕКСТЭЭР — хүнд ойлгомжтой эхний өгүүлбэрийг сонгоно.
 *    Заалтын текст ХЭВЭЭР (үг үсгээр) — тайлбарлан найруулах нь дараагийн адаптерын ажил.
 *
 * ⚠️ ЦЭВЭР — DB-гүй, сүлжээгүй.  `localNormFrame.test.ts`.
 */
import { foldText } from '../textFold';

export type AskForm = 'why' | 'status' | 'concept' | 'requirement' | 'ability' | 'duties' | 'general';

/** Фолдолсон асуултад ҮГИЙН ЭХНЭЭС (кирилл ↔ латин нэг хэлбэрт). */
const WHY_F = /(?:^| )(?:iagad|iagaad|iunas bolj|iamar uchirtai|why)(?: |$)/;
const STATUS_F = /(?:^| )(?:huchin|hurchin|hereglegd|mordogd|murdugd|murdogd|mordod|huchingu|still (?:valid|used|in force)|in force|superseded)/;
const CONCEPT_F = /(?:^| )(?:ialga|ialgatai|gedeg n iu|difference|what is the difference)/;
const CONCEPT_WHAT_F = /(?:^| )gej iu ve(?: |$)/;
const REQUIREMENT_F = /(?:^| )(?:bolj chad|bolohin tuld|shalgur|tursh|gerchilg|iu dutu|dutu bain|dutu bn)/;
const ABILITY_F = /(?:^| )(?:chadah u|chadna u|chadag u|boloh u|bolno u|erhtei iu|erhtei u|can (?:he|she|they|i|we|the|a)(?: |$))/;
// «…үүрэг юу вэ», «ямар эрхтэй вэ», «ямар хариуцлага хүлээх вэ» — ЖАГСААЛТ хүссэн асуулт (тийм/үгүй биш).
const DUTIES_F = /(?:^| )(?:ureg(?! dalgavar)|urg(?:ud|iin)|iamar erh|iamar hariucl|duties|obligation|what rights)/;

/**
 * ⚠️ ДАРААЛАЛ ЧУХАЛ: «яагаад» > «хүчинтэй юу» > «ялгаа» > «болж чадах» > «чадах уу» > «үүрэг».
 *    «SNiP одоо ч хэрэглэгддэг үү? … ашиглаж болох уу» нь ХҮЧИН ТӨГӨЛДӨР БАЙДЛЫН асуулт (эрх биш).
 */
export function askForm(question: string): AskForm {
  const f = ` ${foldText(question ?? '')} `;
  if (WHY_F.test(f)) return 'why';
  if (STATUS_F.test(f)) return 'status';
  if (CONCEPT_F.test(f)) return 'concept';
  if (REQUIREMENT_F.test(f)) return 'requirement';
  if (ABILITY_F.test(f)) return 'ability';
  if (DUTIES_F.test(f)) return 'duties';
  if (CONCEPT_WHAT_F.test(f)) return 'concept';
  return 'general';
}

/** «…яагаад чухал вэ» гэсэн ДАГАЛДАХ шалтгааны асуулт (гол асуулт өөр — ж. утга). */
export function alsoAsksWhy(question: string): boolean {
  return WHY_F.test(` ${foldText(question ?? '')} `);
}

/** «Манай төсөлд ашиглаж болох уу», «надад хамаарах уу» — өөрийн нөхцөлд хэрэглэх асуулт. */
export function asksApplicability(question: string): boolean {
  const f = ` ${foldText(question ?? '')} `;
  return /(?:^| )(?:manai|minii|namaig|nadad|tanai)(?: [a-z]+){0,3} (?:ashigl|hamaar|heregl)/.test(f) || /(?:^| )ashiglaj boloh/.test(f);
}

/**
 * ҮЙЛДЛИЙН УГТВАР — «X-ийг ЗОГСООЖ чадах уу?» → `zogs`.  `ai/retrieval/src/questionKind.ts`-ийн `actionPrefix`-ийн
 * ИХЭР (runtime нь тэр үгээр эрхийн заалтыг урагшлуулдаг; энд тэр үгийг агуулсан заалтыг л жагсаана).
 * ⚠️ ХОЁУЛАНГ НЬ ЗЭРЭГ ӨӨРЧИЛНӨ.
 */
const ABILITY_WORDS = new Set(['chadah', 'chadna', 'chadag', 'boloh', 'bolno', 'erhtei']);
const GENERIC_VERB = new Set(['hij', 'hih', 'hiih', 'bolj', 'baij', 'gej', 'ni', 'n', 'ch', 'bas', 'odo', 'ter', 'ene']);
export function actionPrefix(question: string): string | null {
  const words = foldText(question ?? '').split(' ').filter((w) => w.length > 0);
  const at = words.findIndex((w) => ABILITY_WORDS.has(w));
  if (at <= 0) return null;
  for (let i = at - 1; i >= 0 && i >= at - 3; i -= 1) {
    const w = words[i]!;
    if (GENERIC_VERB.has(w) || w.length < 4) continue;
    return w.slice(0, Math.max(4, w.length - 2));
  }
  return null;
}

/** Текст энэ фолдолсон угтвартай ҮГ агуулж байна уу. */
export function hasWordPrefix(text: string, prefix: string): boolean {
  return ` ${foldText(text)} `.includes(` ${prefix}`);
}

/**
 * ЖИЛИЙН ШААРДЛАГЫН ХАРЬЦУУЛАЛТ — «би 2 жил … ажилласан» ↔ «…3-аас доошгүй жил…».
 * ⚠️ ЗӨВХӨН хоёр ИЛ тоо байхад (асуулт + заалт), өөр таамаг БАЙХГҮЙ.  Хоёр тоо олдохгүй бол `null`.
 */
export function yearsGap(question: string, clause: string): { have: number; need: number } | null {
  const q = /(?<![\d.,])(\d{1,2})\s*(?:жил|jil)(?![\p{L}])/iu.exec(question ?? '');
  const c = /(?<![\d.,])(\d{1,2})\s*-?\s*(?:аас|ээс|оос|өөс|иас)?\s*доошгүй\s+жил/iu.exec(clause ?? '');
  if (!q || !c) return null;
  const have = Number(q[1]);
  const need = Number(c[1]);
  if (!Number.isFinite(have) || !Number.isFinite(need) || need <= 0) return null;
  return { have, need };
}

/** ГУАТ / ГМДХ — БНбД 21-04-05-ын нэр томьёо (баримтын гарчиг «гал унтраах автомат төхөөрөмж, дохиоллын хэрэгсэл»). */
export const ACRONYMS: ReadonlyArray<{ re: RegExp; mn: string; en: string }> = [
  { re: /(?<![\p{L}])(?:гуат|guat)(?![\p{L}])/iu, mn: 'ГУАТ — гал унтраах автомат төхөөрөмж (галыг автоматаар унтраадаг систем)', en: 'ГУАТ — automatic fire-extinguishing system (puts the fire out automatically)' },
  { re: /(?<![\p{L}])(?:гмдх|gmdh)(?![\p{L}])/iu, mn: 'ГМДХ — галын дохиоллын хэрэгсэл (галыг илрүүлж дохио өгдөг систем; өөрөө унтраадаггүй)', en: 'ГМДХ — fire alarm system (detects the fire and raises the alarm; it does not extinguish)' },
];
