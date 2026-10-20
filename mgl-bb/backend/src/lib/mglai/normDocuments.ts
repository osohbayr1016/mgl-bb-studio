/**
 * MGL AI · НОРМЫН БАРИМТ ОЛОХ (L1 сэдвийн чиглүүлэгч → чатын хариулт), 2026-09-18.
 *
 * ⚠️ ЯАГААД ЭНЭ ФАЙЛ ОРШИН БАЙНА.  «Цахилгаантай холбоотой өндөр барилгын норм дүрэм юу вэ?»
 *    гэсэн асуултад загвар САНАХУЙГААС нэг-хоёр норм таамаглаж хариулдаг байв — L0 бүртгэлийн
 *    хайлт (`localNorm.registry`) зөвхөн оношилгоо руу явж, prompt/гэрээнд хүрдэггүй байсан.
 *    Одоо ажилтны PC-ийн runtime `/norm` → `registry.topic_router` (ai/retrieval/src/topicRouter.ts,
 *    жишиг topic_lookup.py-той байт-ижил) нь сэдэвт хамаарах БҮХ баримтыг код · нэр · албан
 *    холбоос · төлөвтэй нь өгдөг; энэ модуль түүнийг СИНТЕТИК ХЭРЭГСЭЛ (`norm_documents`) болгож
 *    prompt-ын хайрцагт, мөн ДЕТЕРМИНИСТ загвар (template) + баримт болгож гэрээнд оруулна.
 *
 * ⚠️ ХЭЗЭЭ асна (`isDocumentDiscoveryQuestion`): асуулт «ямар норм/дүрэм/баримт байна» гэсэн
 *    ОЛОХ асуулт бөгөөд техникийн утга (хэд вэ, утга, м², заалт, хүснэгт, тоо) асуугаагүй үед Л.
 *    Детерминист шийдвэр (TrustedNormResult) гарсан ээлжид ХЭЗЭЭ Ч асахгүй — заалтын хариулт
 *    жагсаалтаар СОЛИГДОХГҮЙ.  «Гэрэлтүүлгийн норм хэд вэ?» → олох горим БИШ (заалтын зам хэвээр).
 *
 * ⚠️ ЗААЛТ, ТОО, ХҮСНЭГТ ЭНДЭЭС ХЭЗЭЭ Ч ГАРАХГҮЙ.  2025 оны бүртгэлийн мөр нь заалт биш;
 *    гүн хариулт GOLD багц (norm/engine, локал заалтын хайлт) руу явна.  Prompt-ын дүрэм ч,
 *    гэрээний `template` ч зөвхөн код/нэр/холбоос/төлөв.
 *
 * ⚠️ ТӨЛӨВ БОЛГООМЖТОЙ.  `STATUS_REQUIRES_VERIFICATION` = 2025 оны жагсаалтад байсан, 2026 оны
 *    хүчин төгөлдөр байдал шалгагдаагүй — хариултад «шалгагдаагүй» гэж ИЛ; ACTIVE зөвхөн MCIS-ээр
 *    баталгаажсан куратор мөрөнд (Worker `localNorm.ts` тэр тугийг ДАХИН шийддэг).
 *
 * ⚠️ ЦЭВЭР ФУНКЦ — `normDocuments.test.ts`.
 */
import { foldText } from '../textFold';
import type { LocalNormTopicRoute, LocalNormTopicRouteEntry } from './localNorm';
import type { ToolOutcome } from './promptFrame';

export const NORM_DOCUMENTS_TOOL = 'norm_documents';
/** Prompt-ын хайрцагт орох дээд тоо (төсвийн асуулт 113 мөр буцаадаг — 8B загварын контекст). */
export const NORM_DOCUMENTS_PROMPT_LIMIT = 15;
/** Гэрээнд ЗААВАЛ дурдагдах баримтын дээд тоо — үүнээс олон бол template л бүрэн жагсаалт. */
export const NORM_DOCUMENTS_MUST_MENTION_LIMIT = 15;

/** «Ямар норм/дүрэм/баримт бичиг байна» — олох асуултын дохио (кирилл + латин + англи). */
const DISCOVERY_CUES: readonly RegExp[] = [
  /норм/iu,
  /дүрэм|дүрм/iu,
  /баримт бичг/iu,
  /стандарт/iu,
  /\bnorms?\b|\bstandards?\b|\bregulations?\b|\bcodes?\b/i,
  /\bnorm\b|\bduram\b|\bnormuud\b/i,
];
/** Техникийн утга асуусан дохио — олох горим БИШ, заалтын зам. */
// ⚠️ ASCII `\b` кирилл үсгийн хажууд ҮҮСДЭГГҮЙ — үгийн хилийг `(?<![\p{L}])…(?![\p{L}])`-ээр.
const TECHNICAL_CUES: readonly RegExp[] = [
  /хэд\s*вэ|хэдэн|хэдээс|хэд\s*байх/iu,
  /утга|хэмжээ|(?<![\p{L}])зай(?![\p{L}])|зайг|өндөр\s*(нь|ыг)|зузаан|нягт|коэффициент|(?<![\p{L}])хувь(?![\p{L}])|хувийг/iu,
  /м²|м2|м³|м3|кпа|мпа|°c|°с|мдж|квт|люкс|(?<![\p{L}])(лк|мм|м)(?![\p{L}])/iu,
  /заалт|хүснэгт|томьёо|тооц|хавсралт|ангилал|ангилла|бүлэг\s*\d/iu,
  /\d/u, // ямар ч тоо = техникийн оролт (g=1800, 28 °C, 1:5000)
  /how (much|many|high|far|thick)|what (is|are) the (value|minimum|maximum|distance|height)|clause|table|formula|calculate/i,
];

export function isDocumentDiscoveryQuestion(question: string): boolean {
  const q = question.trim();
  if (q.length === 0) return false;
  if (!DISCOVERY_CUES.some((re) => re.test(q))) return false;
  return !TECHNICAL_CUES.some((re) => re.test(q));
}

export interface NormDocumentItem {
  n: number;
  code: string | null;
  title: string;
  url: string;
  status: string;
  status_note: string;
  superseded_by: string | null;
}

export interface NormDocumentsData {
  detected_topics: string[];
  /** Runtime-ийн БҮХ таарсан баримтын тоо. */
  count: number;
  /** Хайрцагт орсон тоо (≤ NORM_DOCUMENTS_PROMPT_LIMIT). */
  shown: number;
  /** Prompt-ын хайрцгийн мөрүүд (≤ NORM_DOCUMENTS_PROMPT_LIMIT). */
  documents: NormDocumentItem[];
  /**
   * Template-д орох БҮХ мөр (Worker-ийн parse тааз хүртэл) — кодтой нь эхэнд, кодгүй (ЗГ тогтоол, тушаал)
   * төгсгөлд; чиглүүлэгчийн эрэмбэ тус бүр дотроо хэвээр.  `documents` = үүний эхний хэсэг.
   */
  all_documents: NormDocumentItem[];
  /** Төлөвөөр тоо — толгойн мөрөнд. */
  status_counts: { verified: number; unverified: number; superseded: number; other: number };
  excluded_cost: number;
  excluded_labour: number;
  unverified_count: number;
  /** Төлөвийн шошгын тайлбар — НЭГ удаа (мөр бүрд давтахгүй). */
  legend: string;
  note: string;
  /**
   * Асуултад нэрлэсэн барилгын ТӨРӨЛ (худалдааны төв, зочид буудал …), үр дүнгийн аль ч баримтын нэрэнд байхгүй —
   * «тусгай норм бүртгэлд алга; доорх нь сэдвийн ерөнхий нормууд» гэж жагсаалтын ӨМНӨ ил хэлнэ (2026-09-28).
   */
  building_gap: { label: string; topics: string[] } | null;
}

/**
 * Төлөвийн шошго — ЗОРИУД НЭГ ҮГ (зураастай нийлмэл).  Баримт бүрийн мөрөнд давтагддаг тул урт хэллэг
 * («2025 оны бүртгэлд; …») нь `dataset_lint.py`-ийн 4-грамын давталтад унаж (хэмжсэн 2026-09-18), мөн загварыг
 * давталт руу түлхдэг.  Утгыг НЭГ удаа `legend`-д тайлбарлана.
 */
const STATUS_MN: Record<string, string> = {
  ACTIVE: 'MCIS-хүчинтэй',
  STATUS_REQUIRES_VERIFICATION: 'ШАЛГАГДААГҮЙ',
  CANDIDATE_NEEDS_STATUS_CHECK: 'ШАЛГАГДААГҮЙ',
  SUPERSEDED: 'СОЛИГДСОН',
  HISTORICAL: 'ТҮҮХЭН',
  DRAFT: 'ТӨСӨЛ',
  GUIDANCE: 'ЗААВАР',
};
const STATUS_EN: Record<string, string> = {
  ACTIVE: 'MCIS-in-force',
  STATUS_REQUIRES_VERIFICATION: 'UNVERIFIED',
  CANDIDATE_NEEDS_STATUS_CHECK: 'UNVERIFIED',
  SUPERSEDED: 'SUPERSEDED',
  HISTORICAL: 'HISTORICAL',
  DRAFT: 'DRAFT',
  GUIDANCE: 'GUIDANCE',
};
const LEGEND_MN = 'Төлөвийн тайлбар: MCIS-хүчинтэй = MCIS-ийн бүртгэлд «Хүчин төгөлдөр»; ШАЛГАГДААГҮЙ = 2025 оны бүртгэлд байсан, 2026 оны хүчин төгөлдөр байдал албан бүртгэлээр шалгагдаагүй; СОЛИГДСОН = одоо мөрдөгдөж буй хувилбарыг үз.';
const LEGEND_EN = 'Status legend: MCIS-in-force = «in force» in the MCIS register; UNVERIFIED = listed in the 2025 register, current (2026) legal status not verified against the official register; SUPERSEDED = see the version now in force.';

function statusLabel(e: LocalNormTopicRouteEntry, lang: 'mn-Cyrl' | 'en'): string {
  const base = (lang === 'en' ? STATUS_EN : STATUS_MN)[e.status] ?? e.status;
  if (e.status === 'SUPERSEDED' && e.supersededBy) return `${base}→${e.supersededBy}`;
  return base;
}

/**
 * БАРИЛГЫН ТӨРӨЛ — жагсаалтын ТАЙЛБАРТ л (чиглүүлэлтэд БИШ).  Эзний бодит чат (2026-09-28): «Mongold hudaldaanii tov
 * barilaa gehed, tog us avah norm durem baidag uu» → цахилгаан + ус хангамжийн жагсаалт зөв, гэвч «худалдааны төвийн
 * тусгай норм» бүртгэлд БАЙХГҮЙ гэдгийг хэлэхгүй бол хэрэглэгч эдгээрийг худалдааны төвийн норм гэж ойлгоно.
 * `stems` — кирилл/латин/англи хэлбэр; модуль ачаалахад `foldText`-ээр НЭГ хэлбэрт (давхар үсэг хураагдана:
 * «shopping» → «shoping») орж ҮГИЙН ЭХНЭЭС таарна.  Тухайн төрлийн үг үр дүнгийн баримтын НЭРЭНД байвал «тусгай
 * норм бий» гэж үзнэ.  L1 сэдэвтэй төрөл (сургууль, цэцэрлэг, эмнэлэг, оффис, зогсоол …) энд ОРОХГҮЙ — тэр нь
 * чиглүүлэгчийн сэдэв болж өөрийн баримтуудаа авчирна.
 */
const BUILDING_TYPES: ReadonlyArray<{ stems: readonly string[]; mn: string; en: string }> = [
  { stems: ['худалдаа', 'дэлгүүр', 'hudaldaa', 'delguur', 'shopping', 'supermarket'], mn: 'худалдааны төв, дэлгүүр', en: 'shopping centres and shops' },
  { stems: ['зочид буудал', 'zochid buudal', 'hotel'], mn: 'зочид буудал', en: 'hotels' },
  { stems: ['ресторан', 'хоолны газар', 'restoran', 'hoolnii gazar', 'restaurant', 'кафе', 'kafe', 'cafe'], mn: 'ресторан, хоолны газар', en: 'restaurants and cafés' },
  { stems: ['спорт заал', 'спортын заал', 'спорт цогцолбор', 'спортын цогцолбор', 'sport zaal', 'sportiin zaal', 'sport tsogtsolbor', 'фитнесс', 'fitness', 'стадион', 'stadion', 'gym'], mn: 'спорт заал, цогцолбор', en: 'sports halls and complexes' },
  { stems: ['кино театр', 'кинотеатр', 'театр', 'соёлын төв', 'kino teatr', 'teatr', 'soyoliin tov', 'cinema', 'theatre', 'theater'], mn: 'театр, кино, соёлын төв', en: 'theatres, cinemas and cultural centres' },
  { stems: ['авто угаалга', 'угаалгын газар', 'машин угаа', 'avto ugaalga', 'ugaalgiin gazar', 'mashin ugaa', 'car wash'], mn: 'авто угаалга', en: 'car washes' },
  { stems: ['банкны барилга', 'bankiin barilga', 'bank building'], mn: 'банк', en: 'banks' },
];
const TOPIC_LABEL_MN: Readonly<Record<string, string>> = {
  electrical: 'цахилгаан', water_supply: 'ус хангамж', sewerage: 'ариутгах татуурга', hvac: 'халаалт, агаар сэлгэлт', gas_supply: 'хийн хангамж',
  fire_safety: 'галын аюулгүй байдал', fire_alarm: 'галын дохиолол', lighting: 'гэрэлтүүлэг', telecom_signal: 'холбоо, дохиолол',
  structural: 'барилгын бүтээц', loads: 'ачаалал', seismic: 'газар хөдлөлт', foundation: 'суурь', accessibility: 'хүртээмж',
  energy_efficiency: 'дулаан хамгаалалт', elevator: 'лифт', acoustics: 'дуу чимээ', grounding: 'газардуулга', lightning_protection: 'аянга хамгаалалт',
};
const TOPIC_LABEL_EN: Readonly<Record<string, string>> = {
  electrical: 'electrical', water_supply: 'water supply', sewerage: 'sewerage', hvac: 'heating and ventilation', gas_supply: 'gas supply',
  fire_safety: 'fire safety', fire_alarm: 'fire alarm', lighting: 'lighting', telecom_signal: 'telecom and signalling',
  structural: 'structures', loads: 'loads', seismic: 'seismic', foundation: 'foundations', accessibility: 'accessibility',
  energy_efficiency: 'thermal protection', elevator: 'lifts', acoustics: 'acoustics', grounding: 'earthing', lightning_protection: 'lightning protection',
};

/** Асуултад нэрлэсэн барилгын төрөл үр дүнгийн баримтын нэрэнд алга бол түүний шошго (эс бөгөөс null). */
const BUILDING_TYPES_F = BUILDING_TYPES.map((b) => ({ ...b, stems: [...new Set(b.stems.map((st) => ` ${foldText(st)}`))] }));
export function buildingTypeGap(question: string, titles: readonly string[], lang: 'mn-Cyrl' | 'en'): string | null {
  const fq = ` ${foldText(question).replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  const hay = titles.map((t) => ` ${foldText(t).replace(/[^\p{L}\p{N}]+/gu, ' ')} `);
  for (const b of BUILDING_TYPES_F) {
    if (!b.stems.some((st) => fq.includes(st))) continue;
    if (hay.some((h) => b.stems.some((st) => h.includes(st)))) continue;
    return lang === 'en' ? b.en : b.mn;
  }
  return null;
}

export function normDocumentsData(route: LocalNormTopicRoute, lang: 'mn-Cyrl' | 'en', question?: string): NormDocumentsData {
  // Танилцуулгын эрэмбэ: кодтой баримт эхэнд (чиглүүлэгчийн эрэмбээр), кодгүй нь төгсгөлд.  Чиглүүлэгчийн
  //    өөрийн эрэмбэ (жишиг topic_lookup.py-той байт-ижил) ХӨНДӨГДӨХГҮЙ — энэ зөвхөн харуулах дараалал.
  //    Бүлэг: норм/дүрэм (БНбД, БД, УББ …) → MNS стандарт → кодгүй (тогтоол, тушаал); бүлэг бүр дотроо чиглүүлэгчийн эрэмбэ.
  //    Эс тэгвэл латин «MNS …» кириллээс өмнө эрэмбэлэгдэж, «Барилгын бүтээц» асуултад стандарт нормоос түрүүлж байв.
  // ⚠️ ASCII `\b` кириллд ҮҮСДЭГГҮЙ (мөн python heredoc-оор `\b` нь backspace болж regex хэзээ ч таардаггүй болсон
  //    байсан — хэмжсэн 2026-09-18); «MNS» дараа нь үсэг биш байвал стандарт.
  const tier = (e: LocalNormTopicRouteEntry): number => (e.code === null ? 2 : /^MNS(?!\p{L})/iu.test(e.code) ? 1 : 0);
  const ordered = [0, 1, 2].flatMap((t) => route.results.filter((e) => tier(e) === t));
  const all: NormDocumentItem[] = ordered.map((e, i) => ({
    n: i + 1,
    code: e.code,
    title: e.titleMn,
    url: e.url,
    status: e.status,
    status_note: statusLabel(e, lang),
    superseded_by: e.supersededBy,
  }));
  const shown = all.slice(0, NORM_DOCUMENTS_PROMPT_LIMIT);
  const documents = shown;
  const unverified = route.results.filter((e) => !e.statusVerified).length;
  const counts = { verified: 0, unverified: 0, superseded: 0, other: 0 };
  for (const e of route.results) {
    if (e.status === 'ACTIVE') counts.verified += 1;
    else if (e.status === 'STATUS_REQUIRES_VERIFICATION' || e.status === 'CANDIDATE_NEEDS_STATUS_CHECK') counts.unverified += 1;
    else if (e.status === 'SUPERSEDED') counts.superseded += 1;
    else counts.other += 1;
  }
  const hidden = route.total - shown.length;
  const noteMn = [
    'Баримт олох давхарга (L1, 2025 оны нормын бүртгэл): зөвхөн код · нэр · албан холбоос · төлөв. Заалт, тоо, хүснэгт эндээс гарахгүй.',
    hidden > 0 ? `Хайрцагт эхний ${shown.length}-ийг л оруулав; нийт ${route.total} (үлдсэн ${hidden} баримтыг харуулаагүй гэж хэл).` : '',
    route.excluded.cost > 0 || route.excluded.labour > 0 ? `Төсвийн ${route.excluded.cost}, хөдөлмөр зарцуулалтын ${route.excluded.labour} баримтыг зориуд хассан (ил асуувал орно).` : '',
  ].filter((s) => s.length > 0).join(' ');
  const noteEn = [
    'Document-discovery layer (L1, 2025 norm register): code · title · official link · status only. No clauses, numbers or tables come from here.',
    hidden > 0 ? `Only the first ${shown.length} are in this box; ${route.total} in total (say that ${hidden} more are not shown).` : '',
    route.excluded.cost > 0 || route.excluded.labour > 0 ? `${route.excluded.cost} cost-estimation and ${route.excluded.labour} labour-norm records were deliberately excluded (included only when asked).` : '',
  ].filter((s) => s.length > 0).join(' ');
  return {
    detected_topics: route.detectedTopics,
    count: route.total,
    shown: shown.length,
    documents,
    all_documents: all,
    status_counts: counts,
    excluded_cost: route.excluded.cost,
    excluded_labour: route.excluded.labour,
    unverified_count: unverified,
    legend: lang === 'en' ? LEGEND_EN : LEGEND_MN,
    note: lang === 'en' ? noteEn : noteMn,
    building_gap: (() => {
      if (!question) return null;
      const label = buildingTypeGap(question, route.results.map((e) => e.titleMn), lang);
      if (label === null) return null;
      const labels = lang === 'en' ? TOPIC_LABEL_EN : TOPIC_LABEL_MN;
      return { label, topics: route.detectedTopics.map((t) => labels[t]).filter((x): x is string => typeof x === 'string') };
    })(),
  };
}

/**
 * Синтетик хэрэгслийн үр дүн — `rawToolResults`-д (revit_selection-ий ижил загвар).
 * ⚠️ Prompt-д `all_documents` ОРОХГҮЙ (113 мөр = 8B-ийн контекст) — хайрцагт зөвхөн `documents` (≤15).
 */
export function normDocumentsTool(route: LocalNormTopicRoute, lang: 'mn-Cyrl' | 'en'): ToolOutcome | null {
  if (route.results.length === 0) return null;
  const { all_documents: _all, ...box } = normDocumentsData(route, lang);
  return { tool: NORM_DOCUMENTS_TOOL, ok: true, data: box };
}

/** Холбоосын товч шошго — домэйнээр (URL-ыг харуулахгүй, markdown холбоос). */
export function linkLabel(url: string, lang: 'mn-Cyrl' | 'en'): string {
  const page = /#page=(\d+)/.exec(url)?.[1] ?? null;
  if (/^https:\/\/(www\.)?mcis\.gov\.mn\//.test(url)) return /\.pdf(\?|#|$)/i.test(url) ? 'MCIS PDF' : 'MCIS';
  if (/legalinfo\.mn/.test(url)) return 'legalinfo.mn';
  if (/gazar\.gov\.mn/.test(url)) return page ? (lang === 'en' ? `Register p.${page}` : `Бүртгэл х.${page}`) : lang === 'en' ? 'Register' : 'Бүртгэл';
  return lang === 'en' ? 'Link' : 'Холбоос';
}

/** Markdown хүснэгтийн нүдэнд `|` ба мөр таслалт байж болохгүй. */
const cell = (s: string): string => s.replace(/\|/g, '∣').replace(/\s+/g, ' ').trim();

/**
 * ДЕТЕРМИНИСТ ХАРИУЛТ (гэрээний `template`) — олох горимд ЭНЭ Л харагдана (`templateOnly`): загвар жагсаалт
 * бичихдээ холбоос орхиж, `*` алдаж, «ШАЛГАГДААГҮЙ»-г «хүчинтэй» гэж дээшлүүлж байсан (бодит чат, 2026-09-18).
 *
 * Markdown хүснэгт: № · Код · Нэр · Төлөв · Холбоос — БҮХ мөр (`all_documents`), хайрцгийн ≤15 биш.
 * ⚠️ Нэг баримт = нэг мөр (хөтчийн `dedupeSentences` ижил мөрийг хасдаг тул төлөвийг тусдаа мөрөнд бичихгүй).
 * ⚠️ Төлөвийн болгоомжлол (`normDocumentsTrailer`) ЭНД ОРОХГҮЙ — гэрээний `trailerText`-ээр НЭГ удаа наагдана
 *    (өмнө нь template + trailer давхардаж хоёр удаа гарч байв).
 */
export function renderNormDocuments(data: NormDocumentsData, lang: 'mn-Cyrl' | 'en'): string {
  const en = lang === 'en';
  const c = data.status_counts;
  const parts: string[] = [];
  if (c.verified > 0) parts.push(en ? `MCIS-in-force ${c.verified}` : `MCIS-хүчинтэй ${c.verified}`);
  if (c.unverified > 0) parts.push(en ? `unverified ${c.unverified}` : `шалгагдаагүй ${c.unverified}`);
  if (c.superseded > 0) parts.push(en ? `superseded ${c.superseded}` : `солигдсон ${c.superseded}`);
  if (c.other > 0) parts.push(en ? `other ${c.other}` : `бусад ${c.other}`);
  const lines: string[] = [];
  if (data.building_gap) {
    const g = data.building_gap;
    const topics = g.topics.join(', ');
    lines.push(
      en
        ? `The norm register has no norm specific to ${g.label}. ${topics ? `The documents below are the general ${topics} norms that apply to buildings of every type:` : 'The documents below are the general norms found for the topic of your question:'}`
        : `Нормын бүртгэлд «${g.label}» гэсэн төрлийн барилгад зориулсан тусгай норм алга. ${topics ? `Доорх нь бүх төрлийн барилгад хамаарах ерөнхий нормууд (сэдэв: ${topics}):` : 'Доорх нь асуултын сэдвээр олдсон ерөнхий нормууд:'}`,
    );
    lines.push('');
  }
  lines.push(`**${en ? 'Related documents found' : 'Олдсон холбогдох баримт'}: ${data.count}**${parts.length ? ` (${parts.join(' · ')})` : ''}`);
  lines.push('');
  lines.push(en ? '| № | Code | Title | Status | Link |' : '| № | Код | Нэр | Төлөв | Холбоос |');
  lines.push('|---|---|---|---|---|');
  for (const d of data.all_documents) lines.push(normDocumentLine(d, lang));
  if (data.count > data.all_documents.length) lines.push(en ? `… ${data.count - data.all_documents.length} more not shown.` : `… дахин ${data.count - data.all_documents.length} баримт харуулаагүй.`);
  lines.push('');
  lines.push(data.legend);
  if (data.excluded_cost > 0 || data.excluded_labour > 0) {
    lines.push(
      en
        ? `Cost-estimation (${data.excluded_cost}) and labour-norm (${data.excluded_labour}) records are excluded from design queries; ask for them explicitly.`
        : `Төсвийн (${data.excluded_cost}) ба хөдөлмөр зарцуулалтын (${data.excluded_labour}) баримтыг зураг төслийн асуултад оруулаагүй; ил асуувал өгнө.`,
    );
  }
  return lines.join('\n');
}

/** Нэг баримт = хүснэгтийн нэг мөр: `| № | **КОД** | Нэр | Төлөв | [шошго](url) |`. */
export function normDocumentLine(d: NormDocumentItem, lang: 'mn-Cyrl' | 'en'): string {
  const code = d.code ? `**${cell(d.code)}**` : '—';
  return `| ${d.n} | ${code} | ${cell(d.title)} | ${cell(d.status_note)} | [${linkLabel(d.url, lang)}](${d.url}) |`;
}

/** Төлөвийн болгоомжлол — гэрээний trailer (шалгагдаагүй мөр байвал ЗААВАЛ). */
export function normDocumentsTrailer(data: NormDocumentsData, lang: 'mn-Cyrl' | 'en'): string {
  if (data.unverified_count === 0) {
    return lang === 'en'
      ? 'Discovery layer only: this list locates documents; technical requirements come from the verified clause packs.'
      : 'Энэ бол баримт олох давхарга: жагсаалт нормыг олоход л зориулагдсан; техникийн шаардлага баталгаажсан заалтын багцаас гарна.';
  }
  return lang === 'en'
    ? `Caution: ${data.unverified_count} of these were taken from the 2025 register and their current legal status has not been verified — confirm with the official register before relying on them. Technical requirements come from the verified clause packs, not from this list.`
    : `Анхаарах нь: эдгээрийн ${data.unverified_count} нь 2025 оны бүртгэлийн жагсаалтаас бөгөөд одоогийн хүчин төгөлдөр байдал нь шалгагдаагүй — ашиглахын өмнө албан бүртгэлээр баталгаажуулна уу. Техникийн шаардлага энэ жагсаалтаас биш, баталгаажсан заалтын багцаас гарна.`;
}

/* ================================================================== */
/*  ОЛОХ АСУУЛТЫН СЭДЭВ САНД АЛГА (2026-09-23, эзний HL08)              */
/* ================================================================== */

/**
 * Олох асуултын ЕРӨНХИЙ үгс (фолд хэлбэрийн УГТВАР) — сэдэв биш: барилга/барих/газар/төсөл, норм/дүрэм/шаардлага,
 * байдаг/байна/ямар …  Эдгээрээс бусад ≥4 үсэгтэй үг нь асуултын СЭДЭВ («avto», «ugaalgiin»).
 */
const DISCOVERY_GENERIC: readonly string[] = [
  'barilg', 'barih', 'bariul', 'baigulam', 'gazar', 'obekt', 'tosol', 'tosl', 'zurag', 'zurg', 'ajil', 'ajl', 'hiih', 'hihe',
  'norm', 'durem', 'durm', 'standart', 'standard', 'juram', 'zuram', 'shardlag', 'tavigd', 'tavih', 'hamar', 'holbogd', 'zaavar',
  'mordo', 'murdu', 'huchint', 'baidag', 'bdag', 'baina', 'baigaa', 'bgaa', 'bolno', 'boloh', 'heregt', 'heregl', 'iamar', 'imar',
  'manai', 'minii', 'tanii', 'odoo', 'shine', 'gesen', 'tuhai', 'talaar', 'deer', 'dotor',
  'building', 'build', 'construct', 'code', 'regulat', 'require', 'appl', 'which', 'what', 'there', 'have', 'need', 'must', 'going',
];

/**
 * ⚠️ «avto ugaalgiin gazar barih gej bna. barilgad ni ymar norm shaardlaga bdag ve» — бүртгэлийн чиглүүлэгч сэдэв
 *    олоогүй (авто угаалгын норм санд БАЙХГҮЙ), харин локал хайлт «барилга, барих, газар, шаардлага» гэсэн ЕРӨНХИЙ
 *    үгсээр БНбД 31-17-10-ийн 6.1 (инженер-геологийн хайгуул)-ийг `supported` гэж буцааж, тэр нь «хамгийн ойр заалт»
 *    хариулт болж байв (хэмжсэн, прод 2026-09-23; өмнө нь СНиП-ийн ХАА-н үйлдвэрийн заалт).  Хайлтын хаалга эдгээр
 *    үгийг корпуст «түгээмэл биш» (≤15 %) гэж тоолдог тул ТЭНД барих боломжгүй.
 *
 * Асуултын СЭДВИЙН үг нотолгооны аль ч хэсэгт (үгийн эхнээс, фолдоор) байхгүй бол нотолгоо тэр асуултын тухай БИШ.
 * Буцаах утга: нотолгоонд олдоогүй сэдвийн үгс; сэдэвгүй эсвэл бүгд олдсон бол `null`.
 * ⚠️ Зөвхөн ОЛОХ асуулт + чиглүүлэгч ХООСОН үед дуудагдана (`routes/mglAi.ts`) — заалтын асуултад хэрэглэхгүй.
 */
export function missingDiscoverySubject(question: string, evidenceTexts: readonly string[]): string[] | null {
  const subject = [...new Set(foldText(question).split(/[^\p{L}\p{N}]+/u))].filter(
    (t) => t.length >= 4 && !/^\d/.test(t) && !DISCOVERY_GENERIC.some((g) => t.startsWith(g)),
  );
  if (subject.length === 0) return null;
  const hay = evidenceTexts.map((x) => ` ${foldText(x).replace(/[^\p{L}\p{N}]+/gu, ' ')} `);
  const missing = subject.filter((t) => {
    const stem = t.slice(0, Math.max(4, t.length - 2));
    return !hay.some((h) => h.includes(` ${stem}`));
  });
  return missing.length > 0 ? missing : null;
}

/** Сэдэв санд алга үеийн шударга хариулт — сэдвийн үгийг ДАВТАХГҮЙ (латин асуултын үгс кирилл хариултад орохгүй). */
export function discoverySubjectAbsentText(lang: 'mn-Cyrl' | 'en'): { sentence: string; text: string } {
  if (lang === 'en') {
    const sentence = 'The knowledge base and the norm register have no norm specific to this type of building, so I will not make up requirements.';
    return {
      sentence,
      text: [
        sentence,
        '',
        'What you can do:',
        '• Search the official norm register MCIS (mcis.gov.mn) for this building type.',
        '• Ask about a specific issue — e.g. the fire hazard category of a room, fire alarm or extinguishing systems, loads, engineering-geological surveys or geodetic work: norms on these are in the knowledge base.',
      ].join('\n'),
    };
  }
  const sentence = 'Энэ төрлийн барилга, байгууламжид зориулсан тусгай норм мэдлэгийн сан болон нормын бүртгэлд олдсонгүй, тиймээс шаардлагыг зохиож хэлэхгүй.';
  return {
    sentence,
    text: [
      sentence,
      '',
      'Хийж болох зүйл:',
      '• Нормын албан бүртгэл MCIS (mcis.gov.mn)-ээс энэ төрлийн барилгын нормыг хайж үзэх.',
      '• Тодорхой асуудлаар асуух — жишээ нь өрөөний галын аюулын ангилал, галын дохиолол, гал унтраах систем, ачаалал, инженер-геологийн судалгаа, геодезийн ажил: эдгээр чиглэлийн нормууд санд бий.',
    ].join('\n'),
  };
}
