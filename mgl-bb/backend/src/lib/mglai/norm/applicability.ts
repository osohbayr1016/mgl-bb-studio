/**
 * MGL AI · НОРМЫН ХЭРЭГЛЭГДЭХ БАЙДЛЫН ХААЛГА (NORM-INTEL v3, 2026-10-04).
 *
 * ⚠️ ЯАГААД.  Холбогдох заалт ОЛДСОН нь тэр заалт ЭНЭ тохиолдолд ХАМААРНА гэсэн үг БИШ.  «25 давхар болохоор
 *    өндөр барилгын бүх шаардлага үйлчилнэ» гэж ТАМГААР БОДОХГҮЙ — хэрэглэгдэх эсэх нь барилгын зориулалт, өндөр,
 *    ачаалал, галын шийдэл гэх мэт оролтоос хамаарах бөгөөд дутуу оролтыг ЗОХИОХГҮЙ, АСУУНА.
 *
 * ⚠️ Оролтын жагсаалтыг (1) олдсон ДҮРМИЙН өөрийнх нь `missing_context` (runtime), (2) байхгүй бол сэдвийн
 *    (`generalGuidance.TOPIC_GUIDANCE.needs`) жагсаалтаас ГАРГАНА — «төслийн нэр» гэх мэт хамааралгүй зүйл асуухгүй.
 *
 * ЦЭВЭР ФУНКЦ — `norm/intelligence.test.ts`.
 */
import type { ApplicabilityStatus, NormCurrentnessState } from '@mgl/mglai-common/normIntel';
import { foldText } from '../../textFold';
import { INPUT_LABEL, type InputKey } from './generalGuidance';

const INPUT_PATTERNS: Record<InputKey, RegExp> = {
  building_use: /(?:орон\s*сууц|оффис|албан\s*байр|сургуул|цэцэрлэг|эмнэл|худалдааны|зочид\s*буудал|үйлдвэр|агуулах|театр|спорт\s*заал|residential|apartment|office|school|kindergarten|hospital|hotel|\bmall\b|factory|warehouse|парк|нийтийн\s*байр|барилгын\s*зориулалт)/iu,
  height_levels: /(?:\d+\s*(?:давхар|метр|м(?![\p{L}])|floors?|storeys?|stories|m(?![\p{L}]))|өндөр\s*\d+|давхрын\s*тоо|барилгын\s*өндөр)/iu,
  occupancy: /(?:\d+\s*(?:хүн|иргэн|people|persons|occupants|хэрэглэгч|сурагч|оршин\s*суугч)|хүний\s*тоо|ачаалал\s*\d+|occupant\s*load)/iu,
  fire_strategy: /(?:спринклер|sprinkler|дохиол|гал\s*унтраах\s*автомат|утаа\s*соруул|агаар\s*шах|pressuri|smoke\s*control)/iu,
  space_type: /(?:унтлагын|гал\s*тогоо|зочны\s*өрөө|коридор|шатны|шат\b|хаалга|угаалгын|бие\s*засах|bedroom|kitchen|living\s*room|corridor|stair|door|ramp|toilet|зогсоол|parking|налуу\s*зам|лифт|lift)/iu,
  structure: /(?:төмөр\s*бетон|бетон|ган\s*хийц|ган\b|тоосго|мод\b|concrete|steel|masonry|timber|бүтээцийн\s*систем)/iu,
  door_use: /(?:эвакуацын\s*гарц|орцны\s*хаалга|гадна\s*хаалга|дотор\s*хаалга|entrance|exit\s*door|internal\s*door|escape\s*door|аврах\s*хаалга)/iu,
};

/** Хэрэглэгчийн асуулт (болон ярианы төлөв) дотор аль оролтууд ӨГӨГДСӨН бэ. */
export function extractProvidedInputs(texts: readonly string[], state?: Record<string, unknown> | null): Set<InputKey> {
  const out = new Set<InputKey>();
  const hay = texts.join(' \n ');
  const folded = foldText(hay);
  for (const [k, re] of Object.entries(INPUT_PATTERNS) as [InputKey, RegExp][]) {
    if (re.test(hay)) out.add(k);
  }
  // Латин монгол: фолдын түлхүүрүүд
  if (/(?:^| )(?:oron suc|ofis|surguul|cecerleg|emneleg|hudaldaan|zocid budal|uildver|aguulah)/.test(folded)) out.add('building_use');
  if (/(?:^| )\d+ (?:davhar|metr|m)(?: |$)/.test(folded)) out.add('height_levels');
  if (/(?:^| )\d+ (?:hun|irgen)(?: |$)/.test(folded)) out.add('occupancy');
  // Ярианы төлөвийн оролт (өмнөх ээлжээс)
  if (state) {
    for (const key of Object.keys(state)) {
      if (/height|floors|storey/i.test(key)) out.add('height_levels');
      if (/occup|people|persons|count/i.test(key)) out.add('occupancy');
    }
  }
  return out;
}

/** Runtime-ийн дүрмийн дутуу талбарын түлхүүр → оролтын төрөл (танигдахгүй бол `null` — хэрэглэгчид харуулахгүй). */
const RULE_KEY_TO_INPUT: Record<string, InputKey> = {
  height_m: 'height_levels',
  floors: 'height_levels',
  building_height_m: 'height_levels',
  area_m2: 'space_type',
  count: 'occupancy',
  item_count: 'occupancy',
  occupants: 'occupancy',
  vehicle_count: 'occupancy',
};

export function inputsFromRuleMissing(keys: readonly string[]): InputKey[] {
  const out: InputKey[] = [];
  for (const k of keys) {
    const i = RULE_KEY_TO_INPUT[k];
    if (i && !out.includes(i)) out.push(i);
  }
  return out;
}

export interface ApplicabilityInput {
  needs: readonly InputKey[];
  provided: ReadonlySet<InputKey>;
  /** Олдсон ДҮРМИЙН өөрийнх нь дутуу оролтууд — тэргүүлнэ. */
  ruleMissing: readonly InputKey[];
  /** Холбогдох эх сурвалжуудын тоо (өөр өөр баримт). */
  distinctDocuments: number;
  /** Асуултад баримтыг ИЛ нэрлэсэн эсэх. */
  documentNamed: boolean;
  sourceCurrentness: readonly NormCurrentnessState[];
  explicitNotApplicable?: boolean;
  /** Сэдвийн оролтыг (needs) шаардах уу — зөвхөн «хэзээ/ямар үед» гэсэн хэрэгдэх байдлын асуулт. */
  requireTopicInputs: boolean;
}

export interface ApplicabilityResult {
  status: ApplicabilityStatus;
  considered: string[];
  missing: string[];
  missingKeys: InputKey[];
}

const USABLE = new Set<NormCurrentnessState>(['IN_FORCE_VERIFIED', 'CURRENT_BUT_LATER_AMENDMENTS_NOT_VERIFIED', 'LISTED_CURRENT_NOT_SOURCE_VERIFIED']);

export function evaluateApplicability(i: ApplicabilityInput): ApplicabilityResult {
  const considered: InputKey[] = [];
  const missingKeys: InputKey[] = [];
  const topicKeys = i.requireTopicInputs || i.ruleMissing.length > 0 ? [...i.ruleMissing, ...(i.ruleMissing.length === 0 ? i.needs : [])] : [];
  for (const k of i.needs) if (i.provided.has(k)) considered.push(k);
  for (const k of topicKeys) if (!i.provided.has(k) && !missingKeys.includes(k)) missingKeys.push(k);
  const missing = missingKeys.map((k) => INPUT_LABEL[k].mn);
  const consideredLabels = considered.map((k) => INPUT_LABEL[k].mn);

  if (i.explicitNotApplicable) return { status: 'DOES_NOT_APPLY', considered: consideredLabels, missing: [], missingKeys: [] };
  const usable = i.sourceCurrentness.filter((c) => USABLE.has(c)).length;
  const unusable = i.sourceCurrentness.length - usable;
  if (usable > 0 && unusable > 0) return { status: 'CONFLICTING_SOURCES', considered: consideredLabels, missing, missingKeys };
  if (missingKeys.length > 0) return { status: 'MISSING_CONTEXT', considered: consideredLabels, missing, missingKeys };
  if (i.distinctDocuments > 1 && !i.documentNamed) return { status: 'AMBIGUOUS_SCOPE', considered: consideredLabels, missing, missingKeys };
  return { status: 'APPLIES', considered: consideredLabels, missing, missingKeys };
}
