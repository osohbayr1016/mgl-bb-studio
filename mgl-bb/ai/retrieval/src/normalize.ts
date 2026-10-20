/**
 * MGL AI · АСУУЛТЫН НОРМЧЛОГЧ (§11-ийн «normalizer → entity extraction»).
 *
 * ⚠️ ЗӨВХӨН ЦЭВЭР ФУНКЦ.  SQLite, сүлжээ, файл БАЙХГҮЙ — тиймээс энэ файлын
 *    бүх зан төлөв нэгжийн тестээр хаагдана.  Хайлтын чанарын алдаа нь
 *    хамгийн олон удаа ЭНД гардаг (үгийн тасралт, нэгжийн хэлбэр), тул
 *    хөдөлгүүрээс нь ТУСГААРЛАСАН.
 *
 * ⚠️ ГУРВАН БИЧГИЙН СИСТЕМ.  Ажилтан «300 м² агуулах», «300 m2 aguulakh»,
 *    «300 sqm warehouse» гэж бичнэ — гурвуулаа ижил мөрийг олох ёстой.
 *    Тиймээс индекс нь кирилл, латин галиг, фолдолсон хэлбэр ГУРВУУЛАНГ
 *    агуулна (`ingest.ts`), энэ файл нь асуултын талыг бэлдэнэ.
 *
 * ⚠️ ФОЛД НЬ ГАЛИГИЙГ БҮРЭН НЭГТГЭДЭГГҮЙ.  Багцын галиг нь «ө → u»
 *    («төхөөрөмж» → «tukhuurumj»), `foldText` нь «ө → o» («tohoromj»).
 *    Тэднийг нийлүүлэхийн тулд `foldText`-ийг өөрчлөх нь ERP-ийн хайлтыг
 *    эвдэнэ.  ОРОЛДОХГҮЙ: индексийн ХОЁР БАГАНА (text_mn + text_latin) нь
 *    аль алиныг нь шууд барьдаг тул фолд нь ГУРАВ ДАХЬ гүүр, шаардлага биш.
 *
 * ⚠️ ALIAS НЬ ХАЙЛТЫГ ӨРГӨТГӨНӨ, ХУУЛИЙН УТГЫГ ӨӨРЧЛӨХГҮЙ.  «sprinkler»
 *    гэсэн үг ГУАТ-ын мөрийг олоход тусална — гэвч хариултын томьёолол нь
 *    эх сурвалжийн үгээр гарна.  Энэ ялгааг алдвал орчуулга нь норм болно.
 */
import { foldText } from './fold.ts';

export type QueryScript = 'mn-Cyrl' | 'mn-Latn' | 'en' | 'mixed';

/** Асуултаас гаргаж авсан бүтэцтэй нөхцөл — `rules.ts`-ийн оролт. */
export interface QueryEntities {
  area_m2?: number;
  volume_m3?: number;
  facility_volume_m3?: number;
  height_m?: number;
  rack_height_m?: number;
  floors?: number;
  vehicle_count?: number;
  cable_count?: number;
  item_count?: number;
  voltage_kv?: number;
  voltage_v?: number;
  power_mva?: number;
  transformer_power_mva?: number;
  fire_hazard_category?: string;
  fire_resistance_degree?: string;
  structural_fire_class?: string;
  floor_position?: string;
  parking_type?: string;
  direct_exit?: boolean;
}

/** Асуултад шууд нэрлэсэн эх сурвалжийн хаяг. */
/**
 * Хавсралтын үсгийн латин товчлол ↔ кирилл (MCIS багцуудын `APP-V` ↔ `appendix:В`,
 * «Appendix D» ↔ «Хавсралт Д»).  ⚠️ Зөвхөн багцуудад ТААРАЛДСАН хос; «Ё»/«И» зэрэг
 * маргаантай үсгийг зохиохгүй.  Хоёр чиглэлд нэг хүснэгт — хос бичвэл зөрнө.
 */
export const APPENDIX_LATIN_TO_CYRILLIC: Readonly<Record<string, string>> = { A: 'А', B: 'Б', V: 'В', G: 'Г', D: 'Д', E: 'Е', J: 'Ж', Z: 'З' };
export const APPENDIX_CYRILLIC_TO_LATIN: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(APPENDIX_LATIN_TO_CYRILLIC).map(([lat, cyr]) => [cyr, lat]),
);
/** Аль ч чиглэлийн хос: «В» → «V», «V» → «В»; хосгүй бол өөрөө. */
export function appendixLetterTwin(letter: string): string {
  return APPENDIX_LATIN_TO_CYRILLIC[letter] ?? APPENDIX_CYRILLIC_TO_LATIN[letter] ?? letter;
}

export interface DocRef {
  /** Каноник код («БД 21-101-12», «УББ 12-01-01») — угтвар нь кириллээр жигдэрсэн. */
  code?: string;
  /** Кодын тоон хэсэг («21-101-12») — FTS токеноос ХАСАХАД. */
  codeDigits?: string;
  table?: number;
  row?: string;
  clause?: string;
  page?: number;
  /** Хавсралтын үсэг («Хавсралт В», «А.1 хавсралт» → «А.1») — 2026-09-11. */
  appendix?: string;
}

export interface NormQuery {
  /** Түүхий асуулт — ХЭЗЭЭ Ч алдагдахгүй, эшлэлийн аудитад хэрэгтэй. */
  raw: string;
  /** Нэгж жигдэрсэн хэлбэр — FTS-д очих текст. */
  normalized: string;
  folded: string;
  script: QueryScript;
  tokens: string[];
  entities: QueryEntities;
  docRef: DocRef;
  /** Хэрэглэгч ГУАТ / ГМДХ-ийн алиныг нь асуув. */
  asks: { guat: boolean; gmdh: boolean };
}

/* ── Нэгжийн жигдрэл ──────────────────────────────────────────────── */

/**
 * ⚠️ ДАРААЛАЛ АЧААЛАЛТАЙ.  Урт хэлбэрээс богино руу: «кв.м» нь «м»-ээс
 *    ӨМНӨ солигдох ёстой, эсрэгээр бол «кв.» гэсэн хог үлдэнэ.  Мөн
 *    «м2»/«м3» нь ганц «м»-ээс ӨМНӨ — эс тэгвэл «м» нь тэднийг таслана.
 *
 * ⚠️⚠️ ASCII `\b`-ИЙГ КИРИЛЛ ҮСГИЙН ХАЖУУД ХЭРЭГЛЭЖ БОЛОХГҮЙ.  JS-ийн
 *    `\b` нь `[A-Za-z0-9_]`-ээр тодорхойлогддог — `u` тугтай ч ӨӨРЧЛӨГДӨХГҮЙ.
 *    Тиймээс `/\bм2\b/u` нь «300 м2» дотор ХЭЗЭЭ Ч таарахгүй: зайны ба
 *    «м»-ийн хооронд ASCII-ийн утгаар хил БАЙХГҮЙ.  Энэ нь 2026-09-08-нд
 *    хэмжигдсэн бөгөөд «м2», «кВ», «МВА», «БНбД» ДӨРВҮҮЛЭЭ чимээгүй
 *    ажиллахгүй байв — нэгж таних, эх сурвалж таних хоёул үхмэл байсан.
 *    Оронд нь Unicode үсгийн харцаар (`(?<![\p{L}])` … `(?![\p{L}\d])`)
 *    хил тавина.
 */
const NOT_LETTER_BEFORE = String.raw`(?<![\p{L}])`;
const NOT_LETTER_DIGIT_AFTER = String.raw`(?![\p{L}\d])`;

const unit = (body: string): RegExp =>
  new RegExp(`${NOT_LETTER_BEFORE}(?:${body})${NOT_LETTER_DIGIT_AFTER}`, 'giu');

const UNIT_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [unit(String.raw`кв\.?\s*метр|кв\.?\s*м|квадрат\s*метр|square\s*met(?:er|re)s?|sq\.?\s*m|sqm`), ' m2'],
  [unit(String.raw`куб\.?\s*метр|куб\.?\s*м|кубометр|cubic\s*met(?:er|re)s?|cu\.?\s*m|cbm`), ' m3'],
  [/м²|m²/gu, ' m2'],
  [/м³|m³/gu, ' m3'],
  [unit('м2|m2'), ' m2'],
  [unit('м3|m3'), ' m3'],
  [unit('мва|mva'), ' MVA'],
  [unit('квт|kw'), ' kW'],
  [unit('кв|kv'), ' kV'],
  [unit('вольт|volts?'), ' V'],
  // ⚠️ ГАНЦ «м» НЬ ХАМГИЙН СҮҮЛД.  Дээрх бүх дүрэм түүнийг агуулдаг тул
  //    эрт тавибал «м2» → « m2» болохын оронд « m 2» болж эвдэрнэ.
  [unit(String.raw`метр|met(?:er|re)s?|м|m`), ' m'],
];

/** Нэгжийг нэг хэлбэрт буулгана.  ⚠️ ЗӨВХӨН ХАЙЛТАД — тоог өөрчлөхгүй. */
export function normalizeUnits(input: string): string {
  let out = input;
  for (const [re, rep] of UNIT_RULES) out = out.replace(re, rep);
  return out.replace(/\s+/g, ' ').trim();
}

/* ── Бичгийн систем ──────────────────────────────────────────────── */

/**
 * ⚠️ «mixed» нь БОДИТ тохиолдол, ирмэгийн тохиолдол БИШ.  Ажилтан
 *    «GUAT хэрэгтэй юу?» гэж бичдэг.  Түүнийг «en» гэж ангилвал кирилл
 *    индексийн хөл унтарна.
 */
export function detectScript(input: string): QueryScript {
  const cyr = (input.match(/\p{Script=Cyrillic}/gu) ?? []).length;
  const lat = (input.match(/[A-Za-z]/g) ?? []).length;
  if (cyr > 0 && lat > 0) return 'mixed';
  if (cyr > 0) return 'mn-Cyrl';
  if (lat === 0) return 'mn-Cyrl';
  // Латин үсэг Л байна: монгол галиг уу, англи уу?  Англи хэлний түгээмэл
  // үйлчилгээний үгс нь ялгах хамгийн хямд дохио.
  return /\b(?:what|which|does|do|is|are|required|need|for|the|and|of|with|fire|building|area)\b/i.test(
    input,
  )
    ? 'en'
    : 'mn-Latn';
}

/* ── Тоон нөхцөл ──────────────────────────────────────────────────── */

/** «2 500», «2,500» → 2500.  ⚠️ Буруу уншсан тоо нь буруу норм. */
function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/[\s  ]/g, '').replace(/,(?=\d{3}\b)/g, '');
  const n = Number(cleaned.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

const NUM = String.raw`(\d[\d\s  ,.]*)`;

/**
 * Тооны АРД нэгж хайна.  ⚠️ Урд талын тоог АВАХГҮЙ — «2000 м²-ээс их
 * барилга» дахь 2000 нь талбай мөн, харин «барилга 2000» гэдэг нь биш.
 */
function matchNumberUnit(text: string, unitPattern: string): number | null {
  const re = new RegExp(`${NUM}\\s*(?:${unitPattern})`, 'iu');
  const m = re.exec(text);
  if (!m || m[1] === undefined) return null;
  return parseNumber(m[1]);
}

const FIRE_HAZARD =
  /(?:галын\s+аюулын\s+)?\b(В[1-4]|[АБВГД]|A|B|V[1-4]?|G|D)\s*(?:ангилл?ын|ангилал|ангилалын|category|class)/iu;
const RESIST_DEGREE = /(?:гал\s+тэсвэршилт(?:ийн)?\s+)?\b([IVX]{1,4})\s*(?:зэрэг|зэргийн|зэрэгтэй|degree)/iu;
const STRUCT_CLASS = /\b([CС][0-3])\b/u;

/**
 * Асуултаас бүтэцтэй нөхцөлийг гаргана.
 *
 * ⚠️ ОЛДООГҮЙ ТАЛБАР НЬ `undefined` — 0 БИШ.  `rules.ts` нь «дутуу
 *    нөхцөл» ба «тэг утга»-г ЯЛГАНА: эхнийх нь тодруулах асуулт үүсгэнэ,
 *    хоёр дахь нь босго давуулна.  Хольвол 0 м² барилга нормд нийцнэ.
 */
export function extractEntities(text: string): QueryEntities {
  const t = normalizeUnits(text);
  const e: QueryEntities = {};

  const area = matchNumberUnit(t, 'm2\\b');
  if (area !== null) e.area_m2 = area;

  const vol = matchNumberUnit(t, 'm3\\b');
  if (vol !== null) e.volume_m3 = vol;

  const kv = matchNumberUnit(t, 'kV\\b');
  if (kv !== null) e.voltage_kv = kv;

  const mva = matchNumberUnit(t, 'MVA\\b');
  if (mva !== null) e.power_mva = mva;

  // ⚠️ Өндөр нь `m2`/`m3`-ыг ЗАЛГИХГҮЙ байх ёстой — `m` нь тэдгээрийн
  //    угтвар.  Тиймээс араас нь үсэг/тоо ирэхгүй гэдгийг шаардана.
  const height = matchNumberUnit(t, 'm(?![\\w²³])');
  if (height !== null) e.height_m = height;

  const racks = /(\d+(?:[.,]\d+)?)\s*(?:m|м)?[^\p{L}]{0,4}(?:ээс\s+)?өндөр\s+тавиур|тавиур(?:тай)?\s+(\d+(?:[.,]\d+)?)/iu.exec(
    text,
  );
  if (racks) {
    const v = parseNumber(racks[1] ?? racks[2] ?? '');
    if (v !== null) e.rack_height_m = v;
  }

  const floors = /(\d+)\s*(?:давхар|floors?|storey|storeys|stories)/iu.exec(t);
  if (floors?.[1]) {
    const v = parseNumber(floors[1]);
    if (v !== null) e.floors = v;
  }

  const vehicles =
    /(\d+)\s*(?:авто(?:машин|машины)?|тээврийн\s+хэрэгсэл|машин|vehicles?|cars?|parking\s+spaces?)/iu.exec(t);
  if (vehicles?.[1]) {
    const v = parseNumber(vehicles[1]);
    if (v !== null) e.vehicle_count = v;
  }

  const cables = /(\d+)\s*(?:кабел[ьи]?|cables?)/iu.exec(t);
  if (cables?.[1]) {
    const v = parseNumber(cables[1]);
    if (v !== null) e.cable_count = v;
  }

  // ⚠️ «600 мянган нэгж баримт» → item_count = 600 000 (БНбД 21-04-05 Хүснэгт 3: архив/номын сан ≥ 500 мянга →
  //    ГУАТ, < 500 мянга → ГМДХ).  Өмнө нь тоо огт уншигдахгүй `uncertain` (missing item_count) буцаж, чат
  //    зохиомол «ГУАТ 100 000 хүртэл» гэж хариулж байв (хэмжсэн 2026-09-18, прод).
  const items = /(\d+(?:[.,]\d+)?)\s*(мянга?н?|myanga?n?|thousand|k)?\s*(?:нэгж|negj|items?|units?|ширхэг|shirheg)/iu.exec(t);
  if (items?.[1]) {
    const v = parseNumber(items[1]);
    if (v !== null) e.item_count = items[2] ? Math.round(v * 1000) : v;
  }

  const hazard = FIRE_HAZARD.exec(text);
  if (hazard?.[1]) e.fire_hazard_category = hazard[1].toUpperCase();

  const degree = RESIST_DEGREE.exec(text);
  if (degree?.[1]) e.fire_resistance_degree = degree[1].toUpperCase();

  const struct = STRUCT_CLASS.exec(text);
  if (struct?.[1]) e.structural_fire_class = struct[1].replace(/С/u, 'C').toUpperCase();

  // ⚠️ ҮНДСЭЭР ТААРУУЛНА.  Монгол хэл залгавартай — «зоорийн», «зоорьт»
  //    гэж бичигдэнэ.  «зоорь» гэсэн БҮТЭН хэлбэрийг шаардвал тэдгээрийн
  //    НЭГ Ч таарахгүй (2026-09-08-нд тестээр баригдсан).
  if (/зоор[ьи]|подвал|basement/iu.test(text)) {
    e.floor_position = /хагас\s*(?:давхар|зоор[ьи])|semi[-\s]?basement/iu.test(text)
      ? 'semi_basement'
      : 'basement';
  } else if (/газрын\s+дээр|above[-\s]?ground|дээд\s+давхар/iu.test(text)) {
    e.floor_position = 'above_ground';
  }

  if (/битүү\s*(?:авто)?\s*зогсоол|enclosed\s+parking|underground\s+parking/iu.test(text)) {
    e.parking_type = 'enclosed';
  } else if (/задгай\s*(?:авто)?\s*зогсоол|open\s+parking/iu.test(text)) {
    e.parking_type = 'open';
  }

  if (/шууд\s+гарц(?:тай)?|direct\s+exit/iu.test(text)) e.direct_exit = true;

  return e;
}

/* ── Эх сурвалжийн шууд хаяг ──────────────────────────────────────── */

/**
 * «БНбД 21-04-05 Хүснэгт 3, мөр 9.1.2» гэж бичсэн асуултыг ШУУД барина.
 *
 * ⚠️ ЭНЭ НЬ ХАЙЛТААС ДЭЭГҮҮР.  Хэрэглэгч эх сурвалжаа нэрлэсэн бол
 *    ойролцоо утгаар өөр мөр санал болгох нь БУРУУ хариу — `pipeline.ts`
 *    үүнийг бүтэцтэй нэр дэвшигч болгож хамгийн дээр тавина.
 */
/** Нормын кодын угтварыг кирилл каноник хэлбэрт: BD→БД, UBB→УББ, BNbD→БНбД, SNiP→СНиП. */
export function canonicalDocPrefix(raw: string): string {
  const u = raw.toUpperCase();
  if (u === 'BD' || u === 'БД') return 'БД';
  if (u === 'UBB' || u === 'УББ') return 'УББ';
  if (u === 'BNBD' || u === 'БНБД') return 'БНбД';
  if (u === 'SNIP' || u === 'СНИП') return 'СНиП';
  if (u === 'MNS') return 'MNS';
  return raw;
}

export function extractDocRef(text: string): DocRef {
  const ref: DocRef = {};

  // ⚠️ `\b` АШИГЛАХГҮЙ — «БНбД» нь кирилл тул ASCII-ийн үгийн хил түүний
  //    хажууд ҮҮСЭХГҮЙ.  Өмнөх хувилбар нь эх сурвалж таних чадварыг
  //    БҮХЭЛД НЬ үхмэл болгож байсан (хэмжсэн).
  // ⚠️ КАТАЛОГООС ХАМААРАХГҮЙ детектор (2026-09-11): УББ/UBB, латин BD/SNiP
  //    угтварыг ч таана; «БД 21-101-12-ын» гэсэн залгаварын өмнөх зураасыг
  //    тайрна (өмнө нь «БД 21-101-12-» гэж сүүлийн зураастай гардаг байв).
  //    Энэ код нь `requestedDocument`-д ХАТУУ ШҮҮЛТ болно — санд байхгүй
  //    баримт нэрлэвэл өөр баримтаас хариулахгүй (`named_document_absent`).
  const code =
    /(?<![\p{L}])(БНбД|BNbD|BNBD|БД|BD|УББ|UBB|MNS|СНиП|SNiP|SNIP)\s*[-–]?\s*(\d{2}[-–]\d{2,3}[-–]\d{2}(?:[-–]\d{2})?|II[-–]\d{2}[-–]\d{2}\*?|\d[\d\-–.]*\d)/iu.exec(text);
  if (code?.[1] && code[2]) {
    const prefix = canonicalDocPrefix(code[1]);
    const digits = code[2].replace(/–/g, '-').replace(/[-.]+$/g, '');
    ref.code = `${prefix} ${digits}`;
    ref.codeDigits = digits;
  }

  /**
   * ⚠️⚠️ МОНГОЛ ХЭЛЭНД ТОО НЬ НЭР ТОМЬЁОНЫ ӨМНӨ ЗОГСДОГ.
   *
   *    англи:  «clause 1.1», «table 3»
   *    монгол: «1.1 заалтад», «3 дугаар хүснэгт», «9 дүгээр мөр»
   *
   *    Зөвхөн «үг → тоо» дарааллыг барих нь МОНГОЛ АСУУЛТЫГ БҮГДИЙГ
   *    алдана.  Хэмжсэн (2026-09-09): «УББ 12-01-01-ийн 1.1 заалтад юу гэж
   *    заасан бэ?» гэсэн асуулт заалтаа ИЛ нэрлэсэн атлаа бүтэцтэй хөл
   *    огт ажиллаагүй — УББ багцын Recall@5 78.2% болж хязгаарлагдав.
   *
   *    Тиймээс ХОЁР дарааллыг ХОЁУЛАНГ нь барина.  «дугаар/дүгээр/-р/-ийн»
   *    зэрэг завсрын үг нь заавал биш.
   */
  const both = (keywords: string, valuePattern: string): string | null => {
    const after = new RegExp(`(?:${keywords})\\s*№?\\s*(${valuePattern})`, 'iu').exec(text);
    if (after?.[1]) return after[1];
    const before = new RegExp(
      `(${valuePattern})\\s*(?:-?[а-яөүёA-Za-z]{0,4}\\s+)?(?:дугаар|дүгээр|дэх|дахь)?\\s*(?:${keywords})`,
      'iu',
    ).exec(text);
    return before?.[1] ?? null;
  };

  // ⚠️ БҮХЭЛ ТООТОЙ хүснэгт л (`table_no` INTEGER).  «7.1-р хүснэгт», «Д.1-р хүснэгт»,
  //    «Хүснэгт 16.2.1» (norm-dataset багц) нь ЭНД орохгүй — өмнө нь «7.1»-ийн «1» нь
  //    `table: 1` болж СНиП-ийн 1-р хүснэгтийг татаж байв (хэмжсэн 2026-09-21, 20-04-17).
  //    Цэгтэй/үсэгтэй дугаарыг `search.ts`-ийн `section_path = 'хүснэгт <id>'` хаяг олно.
  const table = both('хүснэгт|khusnegt|table', String.raw`(?<![\d.]|[А-ЯЁ]\.\s?)\d+(?!\d|\.\d)`);
  if (table !== null) ref.table = Number(table);

  const row = both('мөр|mur|row', String.raw`\d+(?:\.\d+)*`);
  if (row !== null) ref.row = row;

  const clause = both('заалт|зүйл|zaalt|clause', String.raw`\d+(?:\.\d+)*`);
  if (clause !== null) ref.clause = clause;

  const page = both('хуудас|khuudas|page', String.raw`\d+`);
  if (page !== null) ref.page = Number(page);

  /**
   * ⚠️ ХАВСРАЛТЫН ҮСЭГ НЬ ХАЯГ (2026-09-11).  «БНбД 31-23-12-ийн Хавсралт В юу
   *    шаарддаг вэ?» — FTS нэг үсэгтэй «В» токеныг ялгаж чаддаггүй тул зургаан
   *    хавсралтын хэсэг ижил оноотой болж, В ба Г нь эхний 5-д ороогүй (хэмжсэн:
   *    308 тестийн 2).  Үсэг нь ГАНЦААРАА зогсох ёстой — «хавсралтын» дахь «ы»,
   *    «-ийн хавсралт» дахь «н» үсэг биш; ASCII `\b` кириллд үүсдэггүй тул
   *    lookaround.  «А.1 хавсралт» (11-08-23) хэлбэрийг ч авна.
   */
  // «B-10», «А.1», «V-2» гэсэн дэд дугаартай хавсралт бүтнээрээ (11-03-21-д B-1…B-12).
  const appendix = both('хавсралт|havsralt|appendix', String.raw`(?<![\p{L}\d])[A-ZА-ЯЁ](?:[.\-–]\d+)*(?![\p{L}\d])`);
  if (appendix !== null) ref.appendix = appendix.toUpperCase();

  return ref;
}

/* ── Токен ────────────────────────────────────────────────────────── */

/**
 * ⚠️ 3 ТЭМДЭГТИЙН ДООД ХЯЗГААР — «нь», «ба», «of», «is» нь дуу чимээ.
 *    ГЭХДЭЭ ТООГООР ЭХЭЛСЭН токен ХАДГАЛАГДАНА: «300» бол нормын хамгийн
 *    ялгамжтай токен.  Богино тоог хаявал 3 м³ савны дүрэм олдохгүй.
 */
/**
 * ЗОГСООХ ҮГС — асуултын хэлбэрийг бүрдүүлдэг ч АГУУЛГА заадаггүй үгс.
 *
 * ⚠️ ЯАГААД ХЭРЭГТЭЙ БОЛОВ.  Хэмжигдсэн (2026-09-10): «Хамгийн хоцорсон
 *    таскууд юу байна» гэсэн ERP асуултад FTS нь «хамгийн*», «байна*»
 *    гэсэн токеноор УББ-11-201-00-ын заалтыг олж, хоолой `supported`
 *    төлөвтэй ЭШЛЭЛ буцаасан — норм ч биш асуултад.  BM25 нь «хамгийн
 *    бага муу» мөрийг эрэмбэлдэг болохоос ХАМААРАЛТАЙ эсэхийг хэлдэггүй.
 *    Тиймээс (а) эдгээр үгийг хайлтад ОРУУЛАХГҮЙ, (б) `pipeline.ts`-ийн
 *    хамаарлын хаалга АГУУЛГЫН токен таарахыг шаардана.
 *
 * ⚠️ Кирилл + латин галиг хоёулаа.  Нормын НЭР ТОМЬЁО («ачаалал», «гарц»)
 *    ЭНД ОРОХГҮЙ — тэд яг агуулга.
 */
export const STOPWORDS: ReadonlySet<string> = new Set([
  // асуултын үг
  'юу', 'юм', 'ямар', 'хэд', 'хэдэн', 'хэзээ', 'хаана', 'хэн', 'яаж', 'яагаад', 'хэрхэн', 'аль', 'алийг',
  'yu', 'yuu', 'yamar', 'ymar', 'hed', 'heden', 'hezee', 'haana', 'hen', 'yaj', 'yaaj', 'yagaad', 'ali',
  // туслах үйл үг, холбоос
  'байна', 'байгаа', 'байх', 'байсан', 'болно', 'болох', 'бол', 'болж', 'гэж', 'гэсэн', 'гэдэг', 'гэх',
  'bna', 'baina', 'baigaa', 'bgaa', 'baih', 'bolno', 'boloh', 'bol', 'gej', 'gesen',
  'нь', 'бас', 'мөн', 'ба', 'буюу', 'эсвэл', 'харин', 'тэгвэл', 'тэгээд', 'дараа', 'дээр', 'дотор',
  'bas', 'mun', 'esvel', 'tegvel', 'tegeed', 'deer', 'dotor',
  // төлөөний үг, тодотгол
  'энэ', 'тэр', 'эдгээр', 'тэдгээр', 'манай', 'миний', 'таны', 'бид', 'та', 'би', 'өөрийн',
  'ene', 'ter', 'manai', 'minii', 'tanai', 'bid', 'chi',
  'хамгийн', 'маш', 'их', 'бага', 'зөвхөн', 'бүх', 'бүгд', 'нэг', 'хэсэг',
  'hamgiin', 'mash', 'zovhon', 'buh', 'neg',
  'хэрэгтэй', 'шаардлагатай', 'болох', 'болно', 'уу', 'үү', 'вэ', 'бэ', 'ёстой', 'estoi', 'yostoi',
  'heregtei', 've', 'uu',
  // ерөнхий үйл үг — агуулга заадаггүй («хийж чадах», «авах», «өгөөч»)
  'сайн', 'хийх', 'хийж', 'хийсэн', 'хийнэ', 'чадах', 'чадна', 'чадаж', 'авах', 'авна', 'авч',
  'өгөх', 'өгнө', 'өгөөч', 'мэдэх', 'мэдэж', 'хэлэх', 'хэлж', 'харах', 'үзэх', 'хүсэж', 'туслах', 'туслаач',
  'sain', 'hiih', 'hiij', 'chadah', 'chadna', 'avah', 'ugeh', 'ogoh', 'medeh', 'heleh', 'harah', 'tuslah',
  'help', 'please', 'tell', 'show', 'give', 'know', 'want', 'need',
  // англи
  'the', 'and', 'for', 'what', 'which', 'when', 'where', 'who', 'how', 'many', 'much', 'this', 'that',
  'are', 'was', 'does', 'can', 'should', 'must', 'with', 'from', 'into', 'about', 'there',
]);

export function isStopword(token: string): boolean {
  return STOPWORDS.has(token.toLowerCase());
}

/**
 * ХҮСЭЛТИЙН / ЯРИАНЫ ҮГС (2026-09-23) — хариултын ХЭЛБЭРИЙГ хүсдэг, агуулга заадаггүй:
 * «энгийн үгээр тайлбарлаад өгөөч», «гол гол-ийг нь хэлж өгөөч», «удахгүй барилга барих гэж байна».
 *
 * ⚠️ ЯАГААД STOPWORDS-ООС ТУСДАА.  STOPWORDS нь FTS-д ОРСООР байна (хасахад G005 унасан, дээрх
 *    тайлбар).  Эдгээр нь харин эх бичвэрт бараг БАЙХГҮЙ тул FTS-ийн BM25-д «ховор» үг мэт жин
 *    авч, хүний ярианы хэлбэрээр асуусан асуултын эрэмбийг бохирдуулж байв (хэмжсэн, эзний HL01/HL03:
 *    «…engiin ugeer tailbarlaad ogooch» → «тайлбар» агуулсан хамааралгүй заалт урагшилсан).
 *    Угтвараар таарна.
 */
const INSTRUCTION_PREFIXES: readonly string[] = [
  'тайлбарла', 'tailbarla', 'энгийн', 'engiin', 'үгээр', 'ugeer', 'өгөөч', 'ogooch', 'ugooch',
  'хэлээч', 'heleech', 'хэлж', 'helj', 'товчхон', 'tovchhon', 'товчоор', 'tovchoor', 'дэлгэрэнгүй', 'delgerengui',
  'ойлгомжтой', 'oilgomjtoi', 'удахгүй', 'udahgui', 'бна', 'bna', 'bgaa',
];

export function isInstructionWord(token: string): boolean {
  const t = token.toLowerCase();
  return INSTRUCTION_PREFIXES.some((p) => t.startsWith(p));
}

export function tokenize(input: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const rawTok of normalizeUnits(input).toLowerCase().split(/[^\p{L}\p{N}.]+/u)) {
    const tok = rawTok.replace(/^\.+|\.+$/g, '');
    if (tok.length === 0) continue;
    const isNumber = /^\d/.test(tok);
    // ⚠️ «В2»/«V2» гэсэн ангиллын тэмдэг нь 2 тэмдэгттэй ч ХАМГИЙН ялгамжтай
    //    токен — галын аюулын ангиллын асуултыг тэр л заана.  Богино гэж
    //    хаявал «V2 galyn achaalal» нь зөвхөн «галын» гэсэн ерөнхий үгээр
    //    хайгдаж хамааралгүй заалт олно (хэмжсэн 2026-09-10).
    const isCategory = /^[вv][1-4]$/u.test(tok);
    if (!isNumber && !isCategory && tok.length < 3) continue;
    // ⚠️ ЗОГСООХ ҮГИЙГ ЭНД ХАСАХГҮЙ.  Хэмжсэн (2026-09-10): «нэг», «хэдэн»-ийг
    //    FTS-ээс хасахад BM25-ийн эрэмбэ шилжиж, G005 алтан кейс унасан
    //    («нэг захиалагч томилно» гэсэн заалтад «нэг» нь дохио).  Зогсоох
    //    үг нь зөвхөн `pipeline.contentTokens`-ийн ХАМААРЛЫН ХААЛГАНД
    //    үйлчилнэ — эрэмбэ хэвээр, гоожилт хаагдана.
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
  }
  return out;
}

// ⚠️ ХОЁР ЗАСВАР, ХОЁУЛАА ХЭМЖИЛТЭЭР.
//   1. `\b` нь кирилл товчлолын хажууд ҮҮСЭХГҮЙ — «ГУАТ», «ГМДХ» гэж
//      кириллээр асуухад НЭГ Ч таарахгүй байсан.
//   2. «спринклер» нь КИРИЛЛЭЭР бичигддэг.  Зөвхөн латин `sprinkler`-ыг
//      барих нь монгол ажилтны асуултыг алдана.
const GUAT_HINT =
  /гуат|\bguat\b|гал\s+унтраах|автомат\s+гал|унтраагуур|спринклер|sprinkler|fire\s+(?:suppress|exting)/iu;
const GMDH_HINT = /гмдх|\bgmdh\b|дохиолол|мэдээлэгч|мэдээлэх|detector|fire\s+alarm|detection/iu;

/**
 * ⚠️ «solongos kompani manai tosliin zurgiig hiij boloh uu» (эзний HL05, прод дахин шалгалт 2026-09-23): нормын бичвэр
 *    «ГАДААДЫН байгууллага» гэж бичдэг, «солонгос», «хятад» гэх мэт улсын нэр БНбД 11-03-02-т огт байхгүй тул хайлт тэр
 *    журмын 3.2 (ажлын зураг)-ыг л олж, яг хариулт болох 1.3, 2.1.a, 2.2-ыг олдоггүй байв («gadaadyn kompani» гэвэл
 *    бүгд эхний 8-д).  Улсын нэр + байгууллагын нэр үг ХАМТ байвал «гадаадын» токен нэмнэ — дангаараа улсын нэр
 *    («Орос норм», «англи хэл») хөндөгдөхгүй.  Фолдоор — кирилл, латин, англи нэг дүрмээр.
 */
const FOREIGN_NATION_F = /(?:^| )(?:solongos|hiatad|iapon|japan|oros|amerik|german|franc|angli|turk|kazah|enetheg|vetnam|vietnam|taivan|itali|ispani|kanad|avstrali|korea|chines|russia|french|turkish)/;
const FOREIGN_ORG_F = /(?:^| )(?:kompani|compani|baigulag|firm|pus|korporac|corporat)/;
export function foreignOrgExpansion(raw: string): string[] {
  const f = ` ${foldText(raw).replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  return FOREIGN_NATION_F.test(f) && FOREIGN_ORG_F.test(f) && !/(?:^| )gadad/.test(f) ? ['гадаадын'] : [];
}

export function normalizeQuery(raw: string): NormQuery {
  const normalized = normalizeUnits(raw);
  const asksGuat = GUAT_HINT.test(raw);
  const asksGmdh = GMDH_HINT.test(raw);
  const tokens = tokenize(raw);
  for (const t of foreignOrgExpansion(raw)) if (!tokens.includes(t)) tokens.push(t);
  return {
    raw,
    normalized,
    folded: foldText(normalized),
    script: detectScript(raw),
    tokens,
    entities: extractEntities(raw),
    docRef: extractDocRef(raw),
    // ⚠️ ХОЁУЛАА ХУДАЛ бол ХОЁУЛАА асуусан гэж үзнэ — норм нь хосоороо
    //    хариулагддаг ба «юу хэрэгтэй вэ?» гэсэн нээлттэй асуултад нэгийг
    //    нь дуугүй орхих нь дутуу хариу.
    asks: asksGuat || asksGmdh ? { guat: asksGuat, gmdh: asksGmdh } : { guat: true, gmdh: true },
  };
}
