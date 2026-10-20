/**
 * MGL AI · НОРМЫН АСУУЛТААС ХЭМЖИГДЭХҮҮН ГАРГАХ (§10, алхам 2–3).
 *
 * ⚠️ ЯАГААД ЭНЭ ЦЭВЭР ФУНКЦ ВЭ.  Нормын шийдвэрийн ГИНЖИН ХЭЛХЭЭ нь:
 *      асуулт → ХЭМЖИГДЭХҮҮН → дүрэм хайх → ТООЦООЛОХ → эх сурвалж
 *    Эхний алхам буруу бол бүх гинж буруу.  Загварт «1800 гэсэн тоог ол»
 *    гэж даалгах нь тэр гинжийг магадлалт болгоно — тиймээс regex-ээр,
 *    тестээр хаагдсан кодоор гаргана.
 *
 * ⚠️ КИРИЛЛ, ЛАТИН, АНГЛИ ГУРВУУЛАНГ НЬ БАРИНА.  Ажилтан «1800 МДж/м²»,
 *    «1800 MJ/m2», «g=1800» гэж бичиж болно — гурвуулаа бодит хэрэглээ.
 *
 * ⚠️ БАЙХГҮЙ УТГЫГ ТААМАГЛАХГҮЙ.  Олдоогүй хэмжигдэхүүн нь `undefined`
 *    хэвээр үлдэнэ.  «Магадгүй 1800 байх» гэж таамаглах нь §15-ын
 *    зөрчил рүү хөтөлнө.
 */

export interface NormEntities {
  /** Хувийн галын ачаалал, МДж/м² (`g`). */
  gMjM2?: number;
  /** Галын ачаалал, МДж (`Q`). */
  qMj?: number;
  /** Талбай, м². */
  sM2?: number;
  /** Өндөр, м (`H`). */
  hM?: number;
  /** Тэсрэлтийн илүүдэл даралт, кПа. */
  deltaPKpa?: number;
  /** Авалцан асах хэм, °C. */
  flashPointC?: number;
  /** Асуултад дурдагдсан ангиллын нэр («В2», «V3»). */
  mentionedCategories: string[];
  /**
   * ХОЁРДМОЛ тоо (GAP-022): «1.800» = 1800 (цэгэн мянгат) эсвэл 1.8 (аравтын) — хэл/контекстгүй
   * аюулгүй уншигдахгүй тул ТААМАГЛАХГҮЙ: хэмжигдэхүүн `undefined` үлдэж, энд бүртгэгдэнэ →
   * хөдөлгүүр «тодруулна уу» гэж insufficient_context өгнө.
   */
  ambiguous: { quantity: string; raw: string }[];
  /** Оношилгоонд — юуг хаанаас олсон. */
  trace: string[];
}

export interface ParsedNumber {
  value?: number;
  /** «1.800» хэлбэр — цэгийн ард ЯГ 3 орон: мянгат уу, аравтын уу тодорхойгүй. */
  ambiguous?: boolean;
}

/**
 * ТООН ТОКЕН — оронгийн бүлэг зай/таслал/цэгээр тусгаарлагдсан: «2 200», «24,000», «1800,5»,
 * «1.800», «1 401».  Бүлгийн ХООРОНД ганц тусгаарлагч; «1800, S=30» дээр «1800» дээр зогсоно.
 */
export const NUMBER_TOKEN = String.raw`\d+(?:[\s.,]\d+)*`;

/**
 * Тоог задлана — таслал ба цэгийн аль алиныг хүлээж авна.
 *
 * ⚠️ «1 800» гэсэн зайтай бичлэгийг ч барина (монголд түгээмэл).
 */
/**
 * Тоог задлана (GAP-022 хэлбэрүүд):
 *   «2 200» / «1 401»  → зайн мянгат           → 2200 / 1401
 *   «24,000» / «1,401» → таслалт мянгат (ЯГ 3 орон, validator.ts-ийн ижил дүрэм) → 24000
 *   «1,5» / «1800,5»   → монгол аравтын таслал  → 1.5 / 1800.5
 *   «1.8» / «1800.5»   → аравтын цэг            → 1.8 / 1800.5
 *   «1.800» / «2.500»  → ХОЁРДМОЛ (цэгийн ард яг 3 орон) → `ambiguous`, утга ӨГӨХГҮЙ
 * ⚠️ Өмнө нь «24,000» → 24 болж GOLD-B06 g=0.8 гэж ямар ч мужид таарахгүй байв (2026-09-11).
 */
export function parseNumber(raw: string): ParsedNumber {
  const compact = raw.replace(/\s/g, '').replace(/[.,]+$/, '');
  if (compact.length === 0) return {};
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(compact)) return { value: Number(compact.replace(/,/g, '')) };
  if (/^\d{1,3}(?:\.\d{3})+$/.test(compact)) return { ambiguous: true };
  const cleaned = compact.replace(',', '.');
  const v = Number(cleaned);
  return Number.isFinite(v) ? { value: v } : {};
}

function num(raw: string): number | undefined {
  return parseNumber(raw).value;
}

/**
 * Нэгжийн хэлбэрүүд — кирилл, латин, өргөтгөсөн тэмдэгт.
 *
 * ⚠️ `м²` (өргөтгөсөн) ба `м2` (энгийн) ХОЁУЛАА.  Хэрэглэгч аль нэгийг
 *    нь бичнэ; аль нэгийг алдвал хэмжигдэхүүн олдохгүй.
 */
// ⚠️ Зураас заавал биш — «мджм2», «MJ m2» гэсэн бичлэг ч МДж/м² (GAP-022).
const MJ_M2 = String.raw`(?:МДж|МДЖ|мдж|MJ|mj|Мдж)\s*\/?\s*(?:м2|м²|m2|m²|М2)`;
const MJ = String.raw`(?:МДж|МДЖ|мдж|MJ|mj|Мдж)`;
const M2 = String.raw`(?:м2|м²|m2|m²|М2)`;

/**
 * ⚠️ ГОЛ ФУНКЦ.  Асуултаас нормын хэмжигдэхүүнийг гаргана.
 *
 * ⚠️ ДАРААЛАЛ ЧУХАЛ: `МДж/м²`-ыг `МДж`-ээс ӨМНӨ шалгана.  Эс тэгвэл
 *    «1800 МДж/м²» гэсэн бичлэгээс `qMj = 1800` гэж БУРУУ гаргана —
 *    тэр нь өөр хэмжигдэхүүн, өөр дүрэм, өөр хариу.
 */
export function extractNormEntities(question: string): NormEntities {
  const q = question ?? '';
  const out: NormEntities = { mentionedCategories: [], ambiguous: [], trace: [] };
  const take = (quantity: string, raw: string | undefined): number | undefined => {
    if (raw === undefined) return undefined;
    const p = parseNumber(raw);
    if (p.ambiguous) {
      out.ambiguous.push({ quantity, raw: raw.trim() });
      out.trace.push(`${quantity}: «${raw.trim()}» хоёрдмол (мянгат/аравтын)`);
      return undefined;
    }
    return p.value;
  };

  // ── 1. Хувийн галын ачаалал (g), МДж/м² ─────────────────────────
  //    «g=1800», «g = 1800 MJ/m2», «1800 МДж/м²», «хувийн галын ачаалал 1800»
  // «g = 1800», «g нь 2200», «g ni 2200», «g: 1800» — тэнцүү/холбох үг бүр (GAP-022).
  const gPatterns: readonly [RegExp, string][] = [
    [new RegExp(String.raw`(?:^|[\s(,;])g\s*(?:=|:|нь|ni)\s*(${NUMBER_TOKEN})\s*(?:${MJ_M2})?`, 'i'), 'g= хэлбэр'],
    [new RegExp(String.raw`(${NUMBER_TOKEN})\s*${MJ_M2}`, 'i'), 'нэгжтэй тоо'],
    [
      new RegExp(
        String.raw`(?:хувийн\s+галын\s+ачаалал|khuviin\s+galyn\s+achaalal|specific\s+fire\s+load)\D{0,12}(${NUMBER_TOKEN})`,
        'i',
      ),
      'нэрлэсэн хэмжигдэхүүн',
    ],
  ];
  for (const [re, label] of gPatterns) {
    const m = re.exec(q);
    if (m?.[1] === undefined) continue;
    const v = take('g', m[1]);
    if (v !== undefined && v > 0) {
      out.gMjM2 = v;
      out.trace.push(`g=${v} (${label})`);
      break;
    }
    if (out.ambiguous.some((a) => a.quantity === 'g')) break;
  }

  // ── 2. Галын ачаалал Q, МДж — ЗӨВХӨН `/м²`-гүй бичлэгээс ────────
  //
  // ⚠️ ГАДНА ХАМГААЛАЛТ БАЙХГҮЙ, ЗОРИУД.  Эхний хувилбар нь «g олдсон
  //    бөгөөд текстэд МДж/м² байвал Q хайхгүй» гэсэн хамгаалалттай
  //    байсан.  Тэр нь ХЭТ ӨРГӨН: «g=1800 МДж/м², Q=50000 МДж» гэсэн
  //    хоёулаа өгсөн асуултад Q-г алддаг байв (тестээр баригдсан) —
  //    үр дүнд нь «Q дутуу» гэж БУРУУ мэдээлнэ.
  //
  //    Оронд нь сөрөг lookahead `(?!\s*\/)` нь «1800 МДж/м²»-ийн «МДж»-ыг
  //    Q гэж уншихаас хангалттай сэргийлнэ: араас нь «/» ирвэл таарахгүй.
  {
    const qRe = new RegExp(String.raw`\bQ\s*(?:=|:|нь|ni)\s*(${NUMBER_TOKEN})\s*(?:${MJ})?`, 'i');
    // ⚠️ «2200 мджм2» (зураасгүй МДж/м²) нь Q БИШ — араас нь м² ирвэл таарахгүй.
    const alt = new RegExp(String.raw`(${NUMBER_TOKEN})\s*${MJ}(?!\s*\/?\s*${M2})`, 'i');
    const m = qRe.exec(q) ?? alt.exec(q);
    const v = m?.[1] === undefined ? undefined : take('Q', m[1]);
    if (v !== undefined && v > 0) {
      out.qMj = v;
      out.trace.push(`Q=${v} МДж`);
    }
  }

  // ── 3. Талбай S, м² ─────────────────────────────────────────────
  {
    const re = new RegExp(String.raw`\bS\s*(?:=|:|нь|ni)\s*(${NUMBER_TOKEN})|(${NUMBER_TOKEN})\s*${M2}(?!\s*[\/·])`, 'i');
    const m = re.exec(q);
    const v = take('S', m?.[1] ?? m?.[2]);
    // ⚠️ `МДж/м²`-ийн «м²» -ыг талбай гэж уншихгүй — дээрх lookahead
    //    хангалтгүй тохиолдолд `g` олдсон бол алгасна.
    if (v !== undefined && v > 0 && !new RegExp(String.raw`${MJ}\s*\/\s*${M2}`, 'i').test(q)) {
      out.sM2 = v;
      out.trace.push(`S=${v} м²`);
    }
  }

  // ── 4. Өндөр H, м ───────────────────────────────────────────────
  //
  // ⚠️ КИРИЛЛИЙН ДАРАА `\b` АШИГЛАЖ БОЛОХГҮЙ.  JavaScript-ийн `\b` нь
  //    ЗӨВХӨН ASCII үгийн тэмдэгт дээр тодорхойлогддог тул «6 м» гэсэн
  //    бичлэгт кирилл «м» ба хоосон зайны хооронд ХИЛ ҮҮСЭХГҮЙ бөгөөд
  //    regex унана.  «H=11 м» нь `H=` салаагаар олдож байсан тул алдаа
  //    ХАГАС нуугдсан — «өндөр 6 м» дээр л илэрсэн.
  //
  //    ⚠️ ЭНЭ УРХИ ЭНЭ РЕПОД ХОЁР ДАХЬ УДАА тааралдав (`chunk.ts`-ийн
  //    гарчиг таних regex).  Кирилл текст дээр `\b`-г ХААНА Ч бүү ашигла —
  //    ил тодорхой lookahead бич.
  {
    const re = new RegExp(
      String.raw`\bH\s*(?:=|:|нь|ni)\s*(${NUMBER_TOKEN})|(?:өндөр|undur|height)\D{0,10}(${NUMBER_TOKEN})\s*(?:м|m)(?=[\s,.)?]|$)`,
      'i',
    );
    const m = re.exec(q);
    const v = take('H', m?.[1] ?? m?.[2]);
    if (v !== undefined && v > 0) {
      out.hM = v;
      out.trace.push(`H=${v} м`);
    }
  }

  // ── 5. Тэсрэлтийн илүүдэл даралт, кПа ───────────────────────────
  {
    const m = new RegExp(String.raw`(${NUMBER_TOKEN})\s*(?:кПа|kPa|кпа)`, 'i').exec(q);
    const v = m?.[1] === undefined ? undefined : take('ΔP', m[1]);
    if (v !== undefined && v > 0) {
      out.deltaPKpa = v;
      out.trace.push(`ΔP=${v} кПа`);
    }
  }

  // ── 6. Авалцан асах хэм, °C ─────────────────────────────────────
  {
    const m = new RegExp(String.raw`(${NUMBER_TOKEN})\s*(?:°\s*C|℃|градус)`, 'i').exec(q);
    const v = m?.[1] === undefined ? undefined : take('t', m[1]);
    if (v !== undefined) {
      out.flashPointC = v;
      out.trace.push(`t=${v}°C`);
    }
  }

  // ── 7. Дурдагдсан ангилал («В2», «V3», «в2») ────────────────────
  //    ⚠️ Кирилл «В» ба латин «V» нь дэлгэц дээр ялгагдахгүй тул
  //       ХОЁУЛАНГ нь барина.  Кирилл хэлбэрт нь ХЭВИЙЖҮҮЛНЭ —
  //       баримт нь кириллээр бичигдсэн.
  //    ⚠️ Залгавартай хэлбэр «В2-ийн», «V3-т» ч ангилал (хэмжсэн 2026-09-18: «В2-ийн галын
  //       ачааллын муж хэд вэ?» дурдсан ангилалгүй үлдэж, муж лавлагаа асаагүй).
  for (const m of q.matchAll(/(?:^|[\s=(,])([ВвVv])\s?([1-4])(?=[\s,)?.]|-(?:ийн|ын|д|т|ийг|ыг|тэй|тай|iin|in|d|t)(?!\p{L})|$)/gu)) {
    const cat = `В${m[2]}`;
    if (!out.mentionedCategories.includes(cat)) out.mentionedCategories.push(cat);
  }
  if (out.mentionedCategories.length > 0) {
    out.trace.push(`дурдсан: ${out.mentionedCategories.join(', ')}`);
  }

  return out;
}
