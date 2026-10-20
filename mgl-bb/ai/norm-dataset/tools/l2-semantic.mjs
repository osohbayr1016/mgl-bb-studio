/**
 * L2.1 · СЕМАНТИК ШАЛГАГЧ — нэр дэвшигч тайлбар нь ЭХ ЗААЛТЫН УТГЫГ хадгалсан эсэхийг ДЕТЕРМИНИСТ шалгана.
 *
 * Хэлбэр биш, УТГА: заавал ↔ хориглол ↔ зөвшөөрөл ↔ зөвлөмж урвуулалт; -гүй үгүйсгэлийн урвуулалт; нөхцөл/онцгой
 * нөхцөл алдагдах, зохиогдох; хамрах хүрээ тэлэх («бүх», «ямар ч») / нарийсах («зөвхөн»); субъект солигдох; тоо, нэгж,
 * харьцуулалтын үг («багагүй» ↔ «ихгүй») зөрөх; эхэд байхгүй үндэслэл («учир нь»), хүчин төгөлдөр байдлын мэдэгдэл;
 * эхээр батлагдаагүй мэдэгдэл (claim-level coverage).  Нэг ч МАТЕРИАЛ зөрчил → FAIL.  Байгалийн хэлний бүрэн утгыг
 * шалгах оролдлого БИШ — гэвч 2026-09-18-нд syntax validator-оор өнгөрсөн утгын урвуулалт (2.2, 1.1) энд баригдана.
 *
 * ⚠️ ASCII `\b` кириллд үүсдэггүй — үгийн хил `(?<![\p{L}])…(?![\p{L}])`.  Монгол залгаварын тулгалт: үгийн эхний
 *    5 тэмдэгт (`key`) — одоо байгаа `localNorm.ts contentOverlap`-тай ижил зарчим.
 *
 * Хэрэглэгч: build-l2.mjs (нэр дэвшигч → PASS/FAIL), evaluation/l2-explain.mjs (adversarial кейс), retrieval/test.
 */

const W = (s) => new RegExp(`(?<![\\p{L}])(?:${s})(?![\\p{L}])`, 'iu');
const WG = (s) => new RegExp(`(?<![\\p{L}])(?:${s})(?![\\p{L}])`, 'giu');

export const LEXICON = {
  // Модаль: заавал / хориглол / зөвшөөрөл / зөвлөмж — Монгол хэлний төгсгөлийн үйл үг + туслах хэлбэр.
  obligation: W('ёстой|шаардлагатай|заавал|мөрдөнө|хангана|хангасан байна|тооцно|тооцоолно|авна|байна|байгуулна|төлөвлөнө|тавина|хийнэ|гүйцэтгэнэ|үзүүлнэ|тогтооно|тодорхойлно|сонгоно|хэрэглэнэ|байрлуулна|ашиглана|хийгдэнэ|тоноглоно|хангагдана|төлөвлөгдөнө|шаардана|хамруулна|батлуулсан байх ёстой|үзнэ|бодолцох|шаардлага тавигдана|болгоно|мөрдлөгө болгоно|шийднэ|хамгаална|тусгана|авч үзнэ'),
  prohibition: W('хориглоно|хориглох|болохгүй|зөвшөөрөхгүй|үл зөвшөөрнө|байж болохгүй|байрлуулахгүй|тавихгүй|хийхгүй|хэрэглэхгүй|оруулахгүй|тооцохгүй|хамаарахгүй|үл хамаарна|хүлээн зөвшөөрөхгүй|ёсгүй|болохгүй'),
  permission: W('зөвшөөрнө|зөвшөөрөгдөнө|байж болно|хийж болно|авч болно|тооцож болно|ашиглаж болно|төлөвлөж болно|болно|зөвшөөрөгдөх'),
  recommendation: W('зөвлөнө|зүйтэй|зүйтэй гэж|зохимжтой|сайн байна|болох нь зүйтэй|зөвлөмж болгоно|болно гэж үзнэ|хүсэлтэй|зохино|байвал зохино|хийвэл зохино'),
  // ⚠️ «дагуу» (… -ийн дагуу), «бүрд», «тутамд» нь НӨХЦӨЛ БИШ — тэднийг оруулахад «Зуны засварын үед …» нөхцөл алдагдсан ч
  //    «… даалгаврын дагуу шийдэж болно» гэсэн нэр дэвшигч нөхцөлтэй мэт өнгөрч байв (хэмжсэн, 8.10).
  condition: W('нөхцөлд|тохиолдолд|үед|бол|байвал|байгаа бол|хэрэв|хамаарч|шаардлага тавигдаагүй нөхцөлд'),
  // ⚠️ Ганц «бусад» («болон бусад тээврийн хэрэгсэл») онцгой нөхцөл БИШ — зөвхөн «-аас бусад» / «бусад тохиолдолд».
  exception: /(?:(?<![\p{L}])(?:бусад тохиолдолд|үл хамаарна|хамаарахгүй|оруулахгүй|тооцохгүй|шаардахгүй|хамааруулахгүй|үүнд хамаарахгүй|үл хамаарах)(?![\p{L}])|(?:аас|ээс|оос|өөс)\s+бусад)/iu,
  universal: W('бүх|бүгд|бүхий л|ямар ч|үргэлж|дандаа|хаана ч|хэзээ ч|ямар нэгэн|нийт бүх|бүх тохиолдолд|заавал бүх'),
  restrictive: W('зөвхөн|ганцхан|л'),
  rationale: W('учир нь|яагаад гэвэл|шалтгаан нь|үндэслэл нь|зорилго нь|зорилготой|үүднээс|болохоор|тул|тиймээс|иймээс|ингэснээр|улмаас|хамгаалахын тулд|аюулгүй байдлыг хангахын тулд|because|so that|in order to'),
  status: W('хүчинтэй|хүчингүй|хуучирсан|мөрдөгдөж байгаа|мөрдөгдөж буй|батлагдсан|солигдсон|шинэчлэгдсэн|хүчин төгөлдөр|одоогийн байдлаар|is valid|in force|superseded'),
  comparator: W('багагүй|ихгүй|хэтрэхгүй|доошгүй|дээшгүй|дээш|доош|хүртэл|бага|их|тэнцүү|хэтрүүлэхгүй|-аас багагүй|түүнээс олон|түүнээс дээш|түүнээс бага|дор хаяж|наад зах нь|дээд тал нь'),
};

/** Тайлбарын ЭРХЭМ ҮГС — эхэд байхгүй ч тайлбарт байж болох (шошго, холбоос, мета) — coverage-д тооцохгүй. */
const META_WORDS = new Set([
  'энэ', 'заалт', 'заалтын', 'заалтад', 'заалтаар', 'энгийнээр', 'тайлбар', 'шаардлага', 'шаардаж', 'шаарддаг', 'хэлбэл', 'гэвэл', 'гэдэг', 'гэсэн', 'утга', 'утгатай',
  'буюу', 'эсвэл', 'өөрөөр', 'хэлбэл', 'мөн', 'болон', 'ба', 'нь', 'бол', 'юм', 'тухай', 'талаар', 'хувьд', 'дагуу', 'үед', 'үндсэн', 'хэсэг', 'хэсэгт',
  'заавал', 'биелүүлэх', 'хориглосон', 'зөвшөөрсөн', 'зүйл', 'норм', 'нормын', 'дүрэм', 'дүрмийн', 'баримт', 'бичвэр', 'эх', 'эхэд', 'тогтоосон', 'заасан', 'заана',
  'хамаарна', 'хамаарах', 'хамаарч', 'байна', 'байх', 'байдаг', 'болно', 'ёстой', 'хэрэгтэй', 'тохиолдолд', 'нөхцөлд', 'үүнд', 'тэдгээр', 'тэр', 'тус', 'тусад',
  'дараах', 'дараахь', 'гэж', 'гэх', 'мэт', 'зэрэг', 'бүр', 'бүрийг', 'бүрд', 'хийнэ', 'хийх', 'авна', 'авах', 'тавина', 'ямар', 'хэрхэн', 'яаж', 'юу', 'вэ', 'бэ',
  'the', 'a', 'of', 'to', 'and', 'is', 'are', 'this', 'clause', 'that',
  // Детерминист fallback-ийн толгой өгүүлбэрийн үгс (заалтын ТӨРЛИЙН нэр) — агуулга биш
  'хэрэглэх', 'хүрээг', 'хүрээ', 'тогтоосон', 'тодорхойлсон', 'хориглол', 'зөвшөөрөл', 'олгосон', 'заасан', 'дараалал', 'журам', 'мэдээлэл', 'өгсөн', 'нөхцөл', 'онцгой', 'тавьсан', 'хамаарах', 'нэр', 'томьёог', 'томьёо', 'өөр', 'руу', 'хамаарах', 'хориглосон',
]);

export function keyOf(word) {
  const w = word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  return w.length >= 3 ? w.slice(0, 5) : null;
}
export function contentKeys(text) {
  const keys = [];
  for (const raw of text.split(/[^\p{L}\p{N}]+/u)) {
    const w = raw.toLowerCase();
    if (w.length < 3 || META_WORDS.has(w) || /^\d/.test(w)) continue;
    const k = keyOf(w);
    if (k) keys.push(k);
  }
  return keys;
}

/** Өгүүлбэр хуваагч — build-l2.mjs-тэй ижил дүрэм (тоо доторх цэг таслал таслахгүй). */
export function splitSentences(text) {
  const out = [];
  for (const p of text.split(/(?<=[.;:!?])\s+(?=[А-ЯӨҮA-Z\-–•«"“])/u)) {
    for (const seg of p.split(/\s+(?=[-–•]\s*[А-ЯӨҮ])/u)) {
      const t = seg.trim().replace(/^[-–•]\s*/u, '');
      if (t) out.push(t);
    }
  }
  return out.length ? out : [text.trim()];
}

/* ── Тоо / нэгж / харьцуулалт ───────────────────────────────────────── */
const UNIT_SYM = 'м²|м2|м³|м3|мм|см|км|м\\/с|м\\/сек|кН\\/м²|кН\\/м2|кН\\/М|кН\\/м|кН|кПа|кпа|МПа|мпа|кгс\\/м²|кгс\\/м2|кгс\\/м|кгс|кг\\/м²|кг\\/м2|кг|л\\/с|л|%|°C|°С|Вт|кВт|кВ|В|лк|дБ|м';
const UNIT_WORD = 'метр|километр|сантиметр|миллиметр|градус|давхар|давхр|хүн|цаг|минут|мин|секунд|сек|хувь|литр|тонн|балл|зэрэглэл|зэрэг|эгнээ|бүс';
// «1-р давхраас», «2-р зэрэглэл» — дугаарын залгавар («-р») нэгжийн өмнө байж болно.
const NUM_RE = new RegExp(`(?<![\\p{L}\\d])(\\d+(?:[.,]\\d+)?(?:\\s*[-–]\\s*\\d+(?:[.,]\\d+)?)?)\\s*(?:(${UNIT_SYM})(?![\\p{L}\\d])|(?:[-–]?\\s*(?:р|Р|дугаар|дүгээр)\\s*)?(${UNIT_WORD})(?=[\\p{L}]*(?![\\d])))?`, 'gu');
const DOC_CODE = /(?:БНбД|БНОД|БД|УББ|MNS|СНиП|СанПиН|СанПин|ГОСТ|СТ СЭВ|ISO|СП)\s*[-–]?\s*[A-ZА-Я]*\s*[-–]?\s*\d+(?:[.\-–/]\d+)*(?:\*\/?\d+)?/gu;
const ADDRESS = /(?<![\d.])\d+(?:\.\d+)+\.?(?!\d)\s*(?:-?р|-?Р|-?ын|-?ийн|-?д|-?т|-?ыг|-?ийг)?\s*(?:заалт|зүйл|хүснэгт|хавсралт|бүлэг|хэсэг)?/gu;
const RATIO = /(?<![\d/])(\d+\/\d+)(?![\d/])/g;
/** «14-р хүснэгт», «2-р хавсралт», «3-р бүлэг» — БАРИМТЫН ХАЯГ, тоо биш.  «1-р давхар», «1-р зэрэглэл» нь АГУУЛГА (тоо). */
const ORDINAL_ADDRESS = /(?<![\p{L}\d.])\d+\s*[-–]?\s*(?:р|Р|дугаар|дүгээр)\s*(?:хүснэгт|хавсралт|бүлэг|хэсэг|заалт|зүйл)(?![\p{L}])/gu;

/** Нэгжийн ТИПОГРАФИЙН л жигдрэл (утга өөрчлөгдөхгүй нь батлагдсан хос): м² ≡ м2, кПа ≡ кпа, кН/М ≡ кН/м. */
export function normalizeUnit(u) {
  if (!u) return null;
  return u.replace(/²/g, '2').replace(/³/g, '3').replace(/°С/g, '°C').replace(/^кпа$/i, 'кпа').replace(/^кН\/М$/, 'кН/м').toLowerCase();
}
/** Тоон утгын ТИПОГРАФИЙН л жигдрэл: зай хасна.  «1,0» ≠ «1.0» ≠ «1» — таслал/цэг/аравтын орон утгыг ХӨНДӨЖ болзошгүй тул ялгаатай хэвээр. */
export function normalizeNumber(n) {
  return n.replace(/\s+/g, '');
}

export function numericFacts(text) {
  const masked = text.replace(DOC_CODE, (m) => ' '.repeat(m.length)).replace(ADDRESS, (m) => ' '.repeat(m.length)).replace(ORDINAL_ADDRESS, (m) => ' '.repeat(m.length));
  const facts = [];
  for (const m of masked.matchAll(RATIO)) facts.push({ literal: m[1], number: m[1], unit: 'ratio', index: m.index, comparators: comparatorsNear(masked, m.index, m[0].length) });
  const noRatio = masked.replace(RATIO, (m) => ' '.repeat(m.length));
  for (const m of noRatio.matchAll(NUM_RE)) {
    const unit = normalizeUnit(m[2] ?? m[3] ?? null);
    facts.push({ literal: m[0].trim(), number: normalizeNumber(m[1]), unit, index: m.index, comparators: comparatorsNear(noRatio, m.index, m[0].length) });
  }
  return facts;
}
const COMPARATOR_WORDS = ['багагүй', 'ихгүй', 'хэтрэхгүй', 'доошгүй', 'дээшгүй', 'дээш', 'доош', 'хүртэл', 'тэнцүү', 'хэтрүүлэхгүй', 'олон', 'бага', 'их', 'дор хаяж', 'наад зах нь'];
const COMPARATOR_CLASS = { багагүй: '>=', 'дор хаяж': '>=', 'наад зах нь': '>=', доошгүй: '>=', дээш: '>=', олон: '>=', ихгүй: '<=', хэтрэхгүй: '<=', хэтрүүлэхгүй: '<=', дээшгүй: '<=', доош: '<=', хүртэл: '<=', тэнцүү: '=', бага: '<', их: '>' };
function comparatorsNear(text, index, len) {
  // Тооны АРД ирэх 40 тэмдэгт («6м-ээс ихгүй», «2 болон түүнээс олон») + өмнөх 12 («дор хаяж 3»).
  const after = text.slice(index + len, index + len + 40).toLowerCase();
  const before = text.slice(Math.max(0, index - 14), index).toLowerCase();
  const found = new Set();
  for (const w of COMPARATOR_WORDS) {
    if (W(w).test(after.split(/[.;]/)[0] ?? '') || W(w).test(before)) found.add(COMPARATOR_CLASS[w]);
  }
  return [...found];
}

/* ── Модаль ба үгүйсгэл ────────────────────────────────────────────── */
export function modalityOf(sentence) {
  const s = sentence.toLowerCase();
  if (LEXICON.prohibition.test(s)) return 'prohibition';
  if (LEXICON.recommendation.test(s)) return 'recommendation';
  if (LEXICON.permission.test(s)) return 'permission';
  if (LEXICON.obligation.test(s)) return 'obligation';
  return null;
}
/** Үгүйсгэлтэй үйл үгийн язгуур: «зөвшөөрөхгүй» → зөвшө(-), «зөвшөөрнө» → зөвшө(+). */
export function polarityStems(sentence) {
  const out = new Map();
  for (const raw of sentence.toLowerCase().split(/[^\p{L}]+/u)) {
    if (raw.length < 5 || META_WORDS.has(raw)) continue;
    const neg = /гүй$/u.test(raw);
    const stem = raw.replace(/(?:хгүй|гүй)$/u, '').replace(/(?:нө|нэ|на|но|ох|эх|ах|өх|ж|ы|ий)$/u, '').slice(0, 5);
    if (stem.length < 4) continue;
    const prev = out.get(stem) ?? { pos: false, neg: false };
    if (neg) prev.neg = true; else prev.pos = true;
    out.set(stem, prev);
  }
  return out;
}

/** Тайлбарын ШОШГО (fallback, digest, загварын ноорогт гардаг) — агуулга биш, хасна.  Жагсаалтаас гадуурх «…:» хэвээр. */
const LABEL_PREFIX = /^\s*(?:Энгийнээр|Шаардлага|Нөхцөл|Хамаарах нөхцөл|Онцгой нөхцөл|Хориглосон|Зөвшөөрсөн|Юуны тухай|Иш татсан|Хэрэглэх хүрээ|Заалтад дурдсан тоо|Товчоор|In plain terms|Requirement|Conditions?|Exceptions?)\s*:\s*/gmu;

/**
 * Нөхцөлийн «ТОЛГОЙ» — эх өгүүлбэр дэх нөхцөлийн маркер («… ашиглалтын ҮЕД», «… байрлуулахгүй НӨХЦӨЛД») бүрийн ӨМНӨХ 2
 * агуулгын түлхүүр.  Маркер олон байхад нэгийг нь хасвал тайлбарт өөр маркер үлдэж «нөхцөлтэй» мэт харагддаг (9.18); тиймээс
 * маркер бүрийн толгойг тусад нь шалгана.
 */
function conditionHeads(sentence) {
  const heads = [];
  const rx = new RegExp(LEXICON.condition.source, 'giu');
  for (const m of sentence.matchAll(rx)) {
    const before = sentence.slice(Math.max(0, m.index - 70), m.index);
    const keys = contentKeys(before).slice(-2);
    if (keys.length > 0) heads.push({ marker: m[0], keys });
  }
  return heads;
}

/* ── Гол шалгагч ───────────────────────────────────────────────────── */
const HARD = new Set(['LOST_NUMBER', 'REVERSED_NEGATION', 'REVERSED_OBLIGATION', 'REVERSED_PROHIBITION', 'PERMISSION_TO_REQUIREMENT', 'REQUIREMENT_TO_PERMISSION', 'REQUIREMENT_TO_RECOMMENDATION', 'LOST_CONDITION', 'INVENTED_CONDITION', 'LOST_EXCEPTION', 'INVENTED_EXCEPTION', 'SCOPE_WIDENED', 'SCOPE_NARROWED', 'WRONG_SUBJECT', 'WRONG_NUMBER', 'WRONG_UNIT', 'WRONG_OPERATOR', 'UNSUPPORTED_RATIONALE', 'UNSUPPORTED_STATUS', 'UNSUPPORTED_CLAIM', 'QUESTION_FRAGMENT', 'EMPTY', 'FOREIGN_CODE']);

/**
 * @param {object} input
 * @param {string} input.sourceText  ЭХ заалт (хөдлөшгүй)
 * @param {string} input.candidate   нэр дэвшигч тайлбар
 * @param {string} [input.clauseUid]
 * @param {string[]} [input.subject] семантик хүрээний subject (эхээс)
 * @returns {{verdict:'PASS'|'FAIL', claims:Array, failures:Array, stats:object}}
 */
export function verifyExplanation(input) {
  const src = input.sourceText ?? '';
  const cand = (input.candidate ?? '').trim();
  const uid = input.clauseUid ?? null;
  const failures = [];
  const claims = [];
  const fail = (code, claim, detail) => failures.push({ code, claim, detail, hard: HARD.has(code) });
  if (cand.length < 20) {
    fail('EMPTY', cand, 'нэр дэвшигч хоосон/хэт богино');
    return { verdict: 'FAIL', claims, failures, stats: { claims: 0 } };
  }
  const srcSentences = splitSentences(src);
  const srcKeysAll = new Set(contentKeys(src));
  // Монгол залгавар 5 дахь үсгийг өөрчилдөг («бичгүүдэд» ↔ «бичгийг») — 4 тэмдэгтийн угтвараар ч дэмжигдэнэ.
  const srcKeys4 = new Set([...srcKeysAll].map((k) => k.slice(0, 4)));
  const supportedKey = (k) => srcKeysAll.has(k) || srcKeys4.has(k.slice(0, 4));
  const srcNums = numericFacts(src);
  const srcCodes = new Set([...src.matchAll(DOC_CODE)].map((m) => m[0].replace(/[\s\-–]/g, '').toLowerCase()));
  const srcLower = src.toLowerCase();
  const srcPolarity = polarityStems(src);
  const srcSentInfo = srcSentences.map((s) => ({ text: s, keys: new Set(contentKeys(s)), modality: modalityOf(s), condition: LEXICON.condition.test(s.toLowerCase()), exception: LEXICON.exception.test(s.toLowerCase()) }));

  // Шошго («Энгийнээр:», «Шаардлага:») хасаад өгүүлбэрээр.  ⚠️ Зөвхөн МЭДЭГДЭЖ БУЙ шошго — өмнө нь 30 хүртэлх тэмдэгттэй
  //    ямар ч «…:» угтварыг хасдаг байсан тул «Богино хугацааны Pt ачаалалд: а) …» гэсэн АНГИЛЛЫН толгой шошго мэт хаягдаж,
  //    «Онцгой Ps» → «Богино хугацааны Pt» солилт PASS болж байв (БНбД 20-04-17 5.6, хэмжсэн 2026-09-23).
  const candSentences = splitSentences(cand.replace(/\*\*[^*]+\*\*\s*:?/g, ' ').replace(LABEL_PREFIX, ''));
  for (const claim of candSentences) {
    const lower = claim.toLowerCase();
    const keys = contentKeys(claim);
    const codes = [];
    const entry = { claim, supported_by: [], verdict: 'SUPPORTED', codes };
    claims.push(entry);
    if (/\?\s*$/.test(claim) || /(?<![\p{L}])(?:вэ|бэ|уу|үү)\s*\??\s*$/iu.test(claim)) { codes.push('QUESTION_FRAGMENT'); fail('QUESTION_FRAGMENT', claim, 'тайлбарт асуулт байж болохгүй'); }
    // Баримтын код — эхэд байхгүй код зохиох
    for (const m of claim.matchAll(DOC_CODE)) {
      const c = m[0].replace(/[\s\-–]/g, '').toLowerCase();
      if (!srcCodes.has(c) && !(input.normCode && c === input.normCode.replace(/[\s\-–]/g, '').toLowerCase())) { codes.push('FOREIGN_CODE'); fail('FOREIGN_CODE', claim, `эхэд байхгүй баримтын код: ${m[0]}`); }
    }
    // Хамгийн сайн тулгарах эх өгүүлбэр
    let best = null;
    for (const si of srcSentInfo) {
      const inter = keys.filter((k) => si.keys.has(k)).length;
      const ratio = keys.length ? inter / keys.length : 0;
      if (best === null || ratio > best.ratio || (ratio === best.ratio && inter > best.inter)) best = { si, ratio, inter };
    }
    const coveredAll = keys.filter((k) => supportedKey(k)).length;
    const coverage = keys.length ? coveredAll / keys.length : 1;
    if (best && best.inter >= 2) entry.supported_by.push({ clause_uid: uid, source_span: best.si.text });
    // Батлагдаагүй мэдэгдэл: агуулгын үгсийн ≥40% эхэд алга (мета үгс тооцохгүй) — материал бол
    const material = keys.length >= 3;
    // Эхэд байхгүй агуулгын үг ≥2 = зохиомол агуулга (синоним 1 үг л зөвшөөрөгдөнө, тэр ч coverage ≥ 0.8 үед).
    //    Хэмжсэн (2026-09-18, 273 нэр дэвшигч): «агаарын температур, хурд» (эхэд алга) 3 үгтэй 0.79 coverage-оор өнгөрч байв.
    const unsupported = keys.filter((k) => !supportedKey(k));
    if (material && (unsupported.length >= 2 || (unsupported.length === 1 && coverage < 0.8))) { codes.push('UNSUPPORTED_CLAIM'); fail('UNSUPPORTED_CLAIM', claim, `эхэд байхгүй үгс: ${unsupported.join(', ')} (coverage ${coverage.toFixed(2)})`); }
    // Субъект: эхний агуулгын үг эхэд байх ёстой
    if (keys.length >= 2 && !supportedKey(keys[0]) && !(input.subject ?? []).some((s) => contentKeys(s).includes(keys[0]))) { codes.push('WRONG_SUBJECT'); fail('WRONG_SUBJECT', claim, `тайлбарын субъект «${keys[0]}…» эхэд алга`); }
    // Үндэслэл / хүчин төгөлдөр байдал
    if (LEXICON.rationale.test(lower) && !LEXICON.rationale.test(best?.si.text.toLowerCase() ?? '') && !LEXICON.rationale.test(srcLower)) { codes.push('UNSUPPORTED_RATIONALE'); fail('UNSUPPORTED_RATIONALE', claim, 'эхэд байхгүй шалтгаан/зорилго/үндэслэл'); }
    if (LEXICON.status.test(lower) && !LEXICON.status.test(srcLower)) { codes.push('UNSUPPORTED_STATUS'); fail('UNSUPPORTED_STATUS', claim, 'хүчин төгөлдөр байдлын мэдэгдэл — L2-ийн ажил биш'); }
    // Хамрах хүрээ
    for (const m of lower.matchAll(WG('бүх|бүгд|бүхий л|ямар ч|үргэлж|дандаа|хаана ч|хэзээ ч|ямар нэгэн'))) {
      if (!W(m[0]).test(srcLower)) { codes.push('SCOPE_WIDENED'); fail('SCOPE_WIDENED', claim, `«${m[0]}» эхэд алга`); break; }
    }
    // «зөвхөн» эхэд алга → нарийсалт; тулгарсан эх өгүүлбэр нь ӨӨРӨӨ онцгой нөхцөлтэй («-аас бусад») бол л зөвшөөрнө.
    if (/(?<![\p{L}])(зөвхөн|ганцхан)(?![\p{L}])/iu.test(lower) && !/(?<![\p{L}])(зөвхөн|ганцхан)(?![\p{L}])/iu.test(srcLower) && !(best && best.inter >= 2 && best.si.exception)) { codes.push('SCOPE_NARROWED'); fail('SCOPE_NARROWED', claim, '«зөвхөн» эхэд алга'); }
    // Үгүйсгэлийн урвуулалт (ижил үйл үгийн язгуур, эсрэг туйл)
    const cp = polarityStems(claim);
    for (const [stem, p] of cp) {
      const s = srcPolarity.get(stem);
      if (!s) continue;
      if (p.neg && !p.pos && s.pos && !s.neg) { codes.push('REVERSED_NEGATION'); fail('REVERSED_NEGATION', claim, `«${stem}…» эхэд эерэг, тайлбарт үгүйсгэл`); }
      if (p.pos && !p.neg && s.neg && !s.pos) { codes.push('REVERSED_NEGATION'); fail('REVERSED_NEGATION', claim, `«${stem}…» эхэд үгүйсгэл, тайлбарт эерэг`); }
    }
    // Модалийн урвуулалт — тулгарсан эх өгүүлбэртэй (≥2 түлхүүр)
    const cm = modalityOf(claim);
    if (cm && best && best.inter >= 2) {
      const sm = best.si.modality;
      const anySrcWithClaimModality = srcSentInfo.some((si) => si.modality === cm && keys.filter((k) => si.keys.has(k)).length >= 2);
      if (!anySrcWithClaimModality && sm && sm !== cm) {
        const code = cm === 'prohibition' && (sm === 'permission' || sm === 'obligation') ? 'REVERSED_OBLIGATION'
          : (cm === 'permission' || cm === 'obligation') && sm === 'prohibition' ? 'REVERSED_PROHIBITION'
          : cm === 'obligation' && sm === 'permission' ? 'PERMISSION_TO_REQUIREMENT'
          : cm === 'permission' && sm === 'obligation' ? 'REQUIREMENT_TO_PERMISSION'
          : cm === 'recommendation' && sm === 'obligation' ? 'REQUIREMENT_TO_RECOMMENDATION'
          : null;
        if (code) { codes.push(code); fail(code, claim, `эх: ${sm}, тайлбар: ${cm}`); }
      }
    }
    // Нөхцөл / онцгой нөхцөл: тулгарсан эх өгүүлбэрт байгаа бол тайлбарт ч байх ёстой; тайлбарт байгаа бол эхэд байх ёстой
    if (best && best.ratio >= 0.4 && best.inter >= 2) {
      const cHasCond = LEXICON.condition.test(lower);
      const cHasExc = LEXICON.exception.test(lower);
      if (best.si.condition && !cHasCond && cm !== null) { codes.push('LOST_CONDITION'); fail('LOST_CONDITION', claim, `эх өгүүлбэрийн нөхцөл алдагдав: «${best.si.text.slice(0, 80)}»`); }
      else if (best.si.condition && keys.length >= 3) {
        // Маркер тус бүрийн толгой (өмнөх 2 түлхүүр) тайлбарт огт алга бол тэр нөхцөл алдагдсан — модаль үг байхгүй ч
        //    («… тооцох хэрэгтэй»), эсвэл өөр нөхцөл үлдсэн ч (9.18 «Байгууламжийн ашиглалтын үед» хасагдсан).
        // Толгойг БҮХ тайлбарын түлхүүртэй тулгана — өөр мэдэгдэлд («2. барилгад: а) …») байгаа нөхцөл алдагдаагүй (11.1.5).
        const claimKeys = new Set(contentKeys(cand));
        const claimKeys4 = new Set([...claimKeys].map((k) => k.slice(0, 4)));
        // 5 үсэгтэй түлхүүр ЯГ таарах ёстой («барих» ≠ «барилгын» — 4 үсгийн угтвар «бари» хоёуланд таардаг, 1.4 хэмжсэн);
        //    богино (< 5) түлхүүрт л 4 үсгийн угтвар.
        const lost = conditionHeads(best.si.text).filter((h) => !h.keys.some((k) => claimKeys.has(k) || (k.length < 5 && claimKeys4.has(k.slice(0, 4)))));
        if (lost.length > 0) { codes.push('LOST_CONDITION'); fail('LOST_CONDITION', claim, `эх өгүүлбэрийн нөхцөл алдагдав: «… ${lost[0].keys.join(' ')} … ${lost[0].marker}»`); }
      }
      if (best.si.exception && !cHasExc && !cHasCond && cm !== null) { codes.push('LOST_EXCEPTION'); fail('LOST_EXCEPTION', claim, `эх өгүүлбэрийн онцгой нөхцөл алдагдав: «${best.si.text.slice(0, 80)}»`); }
      if (cHasCond && !LEXICON.condition.test(srcLower)) { codes.push('INVENTED_CONDITION'); fail('INVENTED_CONDITION', claim, 'эхэд нөхцөл байхгүй'); }
      else if (cHasCond && !best.si.condition) {
        // Нөхцөлийн үгс (маркерын ӨМНӨХ хэсэг) эхэд байх ёстой
        const m = /^(.*?)(?<![\p{L}])(?:нөхцөлд|тохиолдолд|үед|бол|байвал|хэрэв)(?![\p{L}])/iu.exec(lower);
        const condKeys = m ? contentKeys(m[1]).slice(-4) : [];
        if (condKeys.length > 0 && condKeys.filter((k) => supportedKey(k)).length < Math.ceil(condKeys.length / 2)) { codes.push('INVENTED_CONDITION'); fail('INVENTED_CONDITION', claim, `нөхцөлийн үгс эхэд алга: ${condKeys.join(', ')}`); }
      }
      if (cHasExc && !LEXICON.exception.test(srcLower)) { codes.push('INVENTED_EXCEPTION'); fail('INVENTED_EXCEPTION', claim, 'эхэд онцгой нөхцөл байхгүй'); }
    }
    // Тоон БОСГО алдагдав: тулгарсан эх өгүүлбэрт харьцуулалттай тоо (≥/≤) байгаа атлаа энэ (модальтай) мэдэгдэлд тоо огт алга.
    //    Хэмжсэн (2026-09-18, A14.6:14.6.12): «0,0015-аас багагүй» → «тэр бодитоос их байх ёстой» гэж тоогүй өнгөрч байв.
    const claimFacts = numericFacts(claim);
    // Зөвхөн эх өгүүлбэрийг БОДИТООР давтсан мэдэгдэлд (≥4 түлхүүр, ≥60 % давхцал); томьёотой өгүүлбэр («=», «{») орохгүй.
    //    Нэг мэдэгдэл эхийн ХЭД ХЭДЭН өгүүлбэрийг нэгтгэж болно («дүүргэх ёстой; … их байх ёстой») — босготой өгүүлбэр БҮРТЭЙ тулгана.
    if (cm !== null && claimFacts.length === 0 && keys.length >= 4) {
      const keySet = new Set(keys);
      for (const si of srcSentInfo) {
        if (/[={]/.test(si.text) || si.keys.size < 4) continue;
        const inter = [...si.keys].filter((k) => keySet.has(k)).length;
        if (inter < 4 || inter / si.keys.size < 0.7) continue;
        const srcThresholds = numericFacts(si.text).filter((x) => x.comparators.length > 0);
        if (srcThresholds.length > 0) { codes.push('LOST_NUMBER'); fail('LOST_NUMBER', claim, `эх өгүүлбэрийн тоон босго алдагдав: ${srcThresholds.map((x) => x.literal).join(', ')}`); break; }
      }
    }
    // Тоо / нэгж / харьцуулалт
    for (const f of claimFacts) {
      const sameNumber = srcNums.filter((s) => s.number === f.number);
      if (sameNumber.length === 0) { codes.push('WRONG_NUMBER'); fail('WRONG_NUMBER', claim, `тоо «${f.literal}» эхэд алга`); continue; }
      const unitOk = sameNumber.some((s) => (s.unit ?? null) === (f.unit ?? null));
      if (!unitOk) { codes.push('WRONG_UNIT'); fail('WRONG_UNIT', claim, `«${f.literal}»: нэгж эхэд ${sameNumber.map((s) => s.unit ?? '(нэгжгүй)').join('/')}, тайлбарт ${f.unit ?? '(нэгжгүй)'}`); continue; }
      const sameUnit = sameNumber.filter((s) => (s.unit ?? null) === (f.unit ?? null));
      const srcComp = new Set(sameUnit.flatMap((s) => s.comparators));
      // Эхэд ижил тоо ОЛОН газар байвал («1-р зэрэглэл» ×3, нэг нь л «-ээс их»): харьцуулалт АЛДАГДСАН гэж зөвхөн эхийн
      //    БҮХ тохиолдол харьцуулалттай үед л хэлнэ; харин ЭХЭД БАЙХГҮЙ харьцуулалт нэмэх нь үргэлж алдаа.
      const allSrcHaveComp = sameUnit.every((s) => s.comparators.length > 0);
      const claimComp = f.comparators;
      if (claimComp.some((c) => !srcComp.has(c))) { codes.push('WRONG_OPERATOR'); fail('WRONG_OPERATOR', claim, `«${f.literal}»: харьцуулалт эхэд [${[...srcComp].join(',')}], тайлбарт [${claimComp.join(',')}]`); }
      else if (allSrcHaveComp && srcComp.size > 0 && claimComp.length === 0 && material && cm !== null) { codes.push('WRONG_OPERATOR'); fail('WRONG_OPERATOR', claim, `«${f.literal}»: эхийн харьцуулалт [${[...srcComp].join(',')}] тайлбарт алдагдав`); }
    }
    if (codes.length > 0) entry.verdict = 'REJECTED';
  }
  const hard = failures.filter((f) => f.hard);
  return { verdict: hard.length === 0 ? 'PASS' : 'FAIL', claims, failures, stats: { claims: claims.length, rejected: claims.filter((c) => c.verdict === 'REJECTED').length } };
}
