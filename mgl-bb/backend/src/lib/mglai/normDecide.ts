/**
 * MGL AI · НОРМЫН ШИЙДВЭРИЙН ХӨДӨЛГҮҮР (§10, §15).
 *
 * ⚠️ ЭНЭ ФАЙЛЫН ГАНЦ ХАМГИЙН ЧУХАЛ ДҮРЭМ:
 *    ЗАГВАР АНГИЛАЛ СОНГОХГҮЙ.  Босго харьцуулалт нь ЭНД, тодорхойлогдсон
 *    кодоор, тестээр хаагдсан байдлаар хийгдэнэ.  Загварт зөвхөн БЭЛЭН
 *    шийдвэрийг өгч, МОНГОЛООР тайлбарлуулна.
 *
 *    Яагаад:  «1800 МДж/м² бол ямар ангилал вэ?» гэсэн асуултад буруу
 *    хариулах нь галын аюулгүй байдлын шийдвэрт нөлөөлнө.  Хэмжсэн
 *    (2026-09-09): хуучин prompt нь «V2 = 1800 MJ/m²» гэж ЗОХИОСОН.
 *    Магадлалт загварыг энэ гинжнээс БҮРМӨСӨН гаргана.
 *
 * ⚠️ ГУРВАН ТӨЛӨВИЙГ ЯЛГАНА (хэрэглэгчийн шаардлага A/B/C):
 *      A. `verified`            — баталгаажсан дүрэм олдож, тооцоологдов
 *      B. `needs_human_review`  — дүрэм БАЙГАА ч баталгаажаагүй →
 *                                 ЭРХ БҮХИЙ хариу ӨГӨХГҮЙ
 *      C. `no_rule`             — тохирох дүрэм алга → «эх сурвалж олдсонгүй»
 *    ⚠️ B ба C-г ХОЛИХГҮЙ.  B бол «бид мэднэ, гэхдээ хүн шалгаагүй» —
 *       тэрийг «мэдэхгүй» гэж хэлэх нь мэдээллийг нуух; харин эрх бүхий
 *       мэт хэлэх нь баталгаажаагүй норм тарааx.  Хоёулаа буруу.
 *
 * ⚠️ ЦЭВЭР ФУНКЦ — I/O байхгүй.  Дүрмийн мөрийг дуудагч авчирна
 *    (D1-ээс эсвэл локал SQLite-ээс).  Ингэснээр шийдвэрийн логик нэг
 *    газар, бүрэн тестлэгдэнэ.
 */
import type { NormEntities } from './normEntities';

/** Баталгаажилтын төлөв — dataset-ийн `verification_status`-ийн толь. */
export type NormVerification = 'verified_from_page_image' | 'needs_human_review' | string;

/** Босгын дүрмийн бүтэцтэй мөр (жишээ нь В дэд ангилал). */
export interface NormThresholdRule {
  ruleId: string;
  documentCode: string;
  category: string;
  page: number;
  tableNo: number | null;
  /** Хэмжигдэхүүний нэр — одоогоор зөвхөн `g_mj_m2`. */
  quantity: 'g_mj_m2';
  minValue: number | null;
  maxValue: number | null;
  minExclusive: boolean;
  maxExclusive: boolean;
  /** Дараагийн алхмын арга («apply_4_20» гэх мэт). */
  method: string | null;
  verification: NormVerification;
}

export type NormStatus = 'verified' | 'needs_human_review' | 'no_rule' | 'missing_input';

export interface NormDecision {
  status: NormStatus;
  /**
   * Шийдвэрийн ГОРИМ.
   *   classify — g өгөгдсөн, ангиллыг ТОДОРХОЙЛОВ («g=1800 → В2»)
   *   lookup   — ангилал нэрлэсэн, g алга; тэр ангиллын МУЖИЙГ өгнө
   *              («В2-ийн галын ачаалал хэдээс хэд вэ?»)
   *
   * ⚠️ `lookup` нь `missing_input`-ийг ОРЛОНО — хэрэглэгч g-г ангилахыг
   *    биш, мужийг асууж байгаа тул «g хэрэгтэй» гэж буцаах нь буруу.
   *    Хэмжигдсэн (2026-09-10): энэ горимгүйгээр «В2 галын ачаалал хэд
   *    вэ?» гэсэн асуулт нь локал сангийн хамааралгүй заалт руу унаж,
   *    загвар «10–20 м²» гэсэн зохиомол тоо бичиж байв.
   */
  mode: 'classify' | 'lookup';
  decision: { initial_category: string } | null;
  inputs_used: Record<string, number>;
  additional_checks: { required: boolean; missing_inputs: string[]; method: string | null };
  source: { document: string; table: number | null; page: number } | null;
  /**
   * БҮХ ангиллын муж — загвар хөршийн заагийг ЗОХИОХООС сэргийлнэ.
   *
   * ⚠️ ЯАГААД ХЭРЭГТЭЙ БОЛОВ.  Зөвхөн «В2» гэж өгөхөд 8B загвар «В3 нь
   *    1800-аас ИХ түвшинд багтдаг» гэсэн БУРУУ тайлбар зохиосон
   *    (үнэндээ В3 = 181–1400, БАГА).  Ангилал зөв байсан ч босгыг
   *    зохиосон нь §15-ын зөрчил.  Бодит мужуудыг өгвөл зохиох
   *    шаардлагагүй болно.
   */
  ranges: { category: string; min: number | null; max: number | null; exclusiveMin: boolean }[];
  /** Оношилгоонд — яагаад ийм үр дүн гарсан. */
  reason: string;
}

/** ⚠️ БАТАЛГААЖСАН гэж тооцох ЦОРЫН ГАНЦ утга. */
export function isVerified(v: NormVerification): boolean {
  return v === 'verified_from_page_image';
}

/**
 * Утга дүрмийн мужид багтаж байна уу.
 *
 * ⚠️ ХИЛИЙН ТООЦООЛОЛ НАРИЙН.  В1 нь `g > 2200` (ХАТУУ их), В2 нь
 *    `1401 ≤ g ≤ 2200` (багтаасан).  2200 нь В2-т ХАМААРНА, В1-д БИШ.
 *    `min_exclusive` / `max_exclusive`-ийг үл тоовол хилийн утга дээр
 *    хоёр ангилал давхцах эсвэл цоорхой үүснэ.
 */
export function inRange(value: number, rule: NormThresholdRule): boolean {
  if (rule.minValue !== null) {
    if (rule.minExclusive ? value <= rule.minValue : value < rule.minValue) return false;
  }
  if (rule.maxValue !== null) {
    if (rule.maxExclusive ? value >= rule.maxValue : value > rule.maxValue) return false;
  }
  return true;
}

/**
 * Аргаас шаардлагатай НЭМЭЛТ оролтыг гаргана.
 *
 * ⚠️ ЭНЭ НЬ ТОГТМОЛ ТОЛЬ, ЗАГВАРЫН ТААМАГ БИШ.  «apply_4_20» гэдэг нь
 *    БД 21-101-12-ын 4.20-ын `Q ≥ 0.64·g·H²` нөхцөл — түүнд `Q` ба `H`
 *    хэрэгтэй.  Загвараас «юу дутуу вэ» гэж асуувал зохиож эхэлнэ.
 */
const METHOD_REQUIREMENTS: Readonly<Record<string, readonly string[]>> = {
  apply_4_20: ['Q', 'H'],
  '10m2_arbitrary_section_and_spacing': ['S', 'spacing'],
  normalization_not_required: [],
};

function missingFor(method: string | null, e: NormEntities): string[] {
  if (method === null) return [];
  const need = METHOD_REQUIREMENTS[method] ?? [];
  const have: Record<string, boolean> = {
    Q: e.qMj !== undefined,
    H: e.hM !== undefined,
    S: e.sM2 !== undefined,
    spacing: false,
  };
  return need.filter((k) => have[k] !== true);
}

/**
 * ⚠️ ГОЛ ФУНКЦ.  Хувийн галын ачааллаас В дэд ангиллыг ТОДОРХОЙЛНО.
 *
 * @param entities  `extractNormEntities`-ийн үр дүн.
 * @param rules     Тухайн баримтын БҮХ босгын дүрэм (баталгаажаагүйг ч
 *                  ОРУУЛНА — тэднийг ялгах нь энэ функцийн үүрэг).
 */
export function decideVSubcategory(
  entities: NormEntities,
  rules: readonly NormThresholdRule[],
): NormDecision {
  const g = entities.gMjM2;
  const relevant = rules.filter((r) => r.quantity === 'g_mj_m2');

  const empty: NormDecision = {
    status: 'no_rule',
    mode: 'classify',
    decision: null,
    inputs_used: {},
    additional_checks: { required: false, missing_inputs: [], method: null },
    source: null,
    ranges: [],
    reason: '',
  };

  // ── C. Дүрэм ОГТ алга ────────────────────────────────────────────
  if (relevant.length === 0) {
    return { ...empty, reason: 'Энэ хэмжигдэхүүнд тохирох дүрэм суулгаагүй байна.' };
  }

  // ── Ангиллын МУЖИЙН лавлагаа — g алга, ангилал нэрлэсэн ──────────
  // ⚠️ «В2-ийн галын ачаалал хэдээс хэд вэ?» гэдэг нь ангилах хүсэлт
  //    БИШ, мужийн лавлагаа.  Босгын хүснэгт хариуг аль хэдийн агуулж
  //    байгаа тул түүнийг ЭРХ БҮХИЙ блок болгож өгнө — текстэн хайлт
  //    руу унагаах нь хамааралгүй заалт (өөр баримт) орж ирэх зам.
  if (g === undefined && entities.mentionedCategories.length > 0) {
    const cats = entities.mentionedCategories;
    const hits = relevant.filter((r) => cats.includes(r.category));
    if (hits.length > 0) {
      const verifiedHits = hits.filter((r) => isVerified(r.verification));
      const first = (verifiedHits[0] ?? hits[0])!;
      if (verifiedHits.length === 0) {
        return {
          ...empty,
          mode: 'lookup',
          status: 'needs_human_review',
          source: { document: first.documentCode, table: first.tableNo, page: first.page },
          reason:
            `${cats.join(', ')} ангиллын дүрэм байгаа боловч хүний баталгаажуулалт ` +
            `хийгдээгүй (${first.verification}).  Эрх бүхий хариу өгөхгүй.`,
        };
      }
      return {
        status: 'verified',
        mode: 'lookup',
        decision: { initial_category: verifiedHits.map((r) => r.category).join(', ') },
        inputs_used: {},
        additional_checks: { required: false, missing_inputs: [], method: null },
        source: { document: first.documentCode, table: first.tableNo, page: first.page },
        ranges: relevant
          .filter((x) => isVerified(x.verification))
          .map((x) => ({
            category: x.category,
            min: x.minValue,
            max: x.maxValue,
            exclusiveMin: x.minExclusive,
          }))
          .sort((a, b) => (b.min ?? 0) - (a.min ?? 0)),
        reason: `${verifiedHits.map((r) => r.category).join(', ')} ангиллын мужийг босгын хүснэгтээс уншив.`,
      };
    }
  }

  // ── Оролт дутуу ──────────────────────────────────────────────────
  // ⚠️ Энэ нь `no_rule` БИШ.  Дүрэм БАЙНА, гэхдээ утга алга — хэрэглэгчээс
  //    ЮУ хэрэгтэйг нэрлэж асуух ёстой.  «Эх сурвалж олдсонгүй» гэж
  //    хэлэх нь ТӨӨРӨГДҮҮЛНЭ.
  if (g === undefined) {
    return {
      ...empty,
      status: 'missing_input',
      additional_checks: { required: true, missing_inputs: ['g'], method: null },
      reason: 'Хувийн галын ачааллын утга (g, МДж/м²) асуултаас олдсонгүй.',
    };
  }

  const matched = relevant.filter((r) => inRange(g, r));

  if (matched.length === 0) {
    return {
      ...empty,
      inputs_used: { g_mj_m2: g },
      reason: `g=${g} МДж/м² нь суулгасан дүрмийн аль ч мужид багтахгүй байна.`,
    };
  }

  // ⚠️ БАТАЛГААЖСАНЫГ ЭХЭНД.  Хэрэв нэг муж дээр баталгаажсан ба
  //    баталгаажаагүй дүрэм ХОЁУЛАА байвал баталгаажсаныг Л ашиглана.
  const verified = matched.filter((r) => isVerified(r.verification));

  // ── B. Дүрэм байгаа ч БАТАЛГААЖААГҮЙ ─────────────────────────────
  if (verified.length === 0) {
    const r = matched[0]!;
    return {
      ...empty,
      status: 'needs_human_review',
      inputs_used: { g_mj_m2: g },
      // ⚠️ ЭХ СУРВАЛЖИЙГ ХЭЛНЭ, ШИЙДВЭРИЙГ БИШ.  Хүн шалгах гарц өгнө.
      source: { document: r.documentCode, table: r.tableNo, page: r.page },
      reason:
        `g=${g} МДж/м²-д тохирох дүрэм байгаа боловч хүний баталгаажуулалт ` +
        `хийгдээгүй (${r.verification}).  Эрх бүхий хариу өгөхгүй.`,
    };
  }

  // ⚠️ ХОЁР БАТАЛГААЖСАН ДҮРЭМ ДАВХЦВАЛ — өгөгдлийн алдаа.  Чимээгүй
  //    нэгийг нь сонгох нь буруу ангилал өгөх эрсдэл; ил хэлнэ.
  if (verified.length > 1) {
    return {
      ...empty,
      status: 'needs_human_review',
      inputs_used: { g_mj_m2: g },
      source: {
        document: verified[0]!.documentCode,
        table: verified[0]!.tableNo,
        page: verified[0]!.page,
      },
      reason:
        `g=${g} МДж/м² нь ${verified.length} дүрэмд зэрэг таарч байна ` +
        `(${verified.map((r) => r.category).join(', ')}) — өгөгдлийн зөрчил, хүн шалгах ёстой.`,
    };
  }

  // ── A. БАТАЛГААЖСАН ШИЙДВЭР ──────────────────────────────────────
  const r = verified[0]!;
  const missing = missingFor(r.method, entities);
  const inputs: Record<string, number> = { g_mj_m2: g };
  if (entities.qMj !== undefined) inputs.q_mj = entities.qMj;
  if (entities.hM !== undefined) inputs.h_m = entities.hM;

  return {
    status: 'verified',
    mode: 'classify',
    decision: { initial_category: r.category },
    inputs_used: inputs,
    additional_checks: {
      // ⚠️ «Нэмэлт шалгалт хэрэгтэй» гэдэг нь ангиллыг ҮГҮЙСГЭХГҮЙ —
      //    эхний ангилал ҮНЭН, зөвхөн ДЭЭШЛҮҮЛЭХ магадлал үлдэнэ.
      required: missing.length > 0 || (r.method !== null && r.method !== 'normalization_not_required'),
      missing_inputs: missing,
      method: r.method,
    },
    source: { document: r.documentCode, table: r.tableNo, page: r.page },
    // ⚠️ ЗӨВХӨН БАТАЛГААЖСАН мужуудыг өгнө — баталгаажаагүй дүрмийн
    //    босгыг загварт харуулах нь түүнийг эрх бүхий мэт давтуулна.
    ranges: relevant
      .filter((x) => isVerified(x.verification))
      .map((x) => ({
        category: x.category,
        min: x.minValue,
        max: x.maxValue,
        exclusiveMin: x.minExclusive,
      }))
      .sort((a, b) => (b.min ?? 0) - (a.min ?? 0)),
    reason: `g=${g} МДж/м² нь ${r.category} ангиллын мужид багтав (${r.ruleId}).`,
  };
}

/**
 * Шийдвэрийг prompt-д тавих ЭРХ БҮХИЙ блок болгоно.
 *
 * ⚠️ ЗАГВАР ҮҮНИЙГ ӨӨРЧИЛЖ БОЛОХГҮЙ.  Заавар нь ил хэлнэ: ангилал,
 *    босго, эх сурвалж, дутуу оролт — дөрвүүлэн нь ТОГТМОЛ.  Загварын
 *    үүрэг нь ЗӨВХӨН монголоор тайлбарлах.
 *
 * ⚠️ `no_rule` үед ХООСОН мөр буцаана — тэр үед `promptFrame`-ийн
 *    «эх сурвалж олдсонгүй» команд ажиллана.
 */
export function renderNormDecision(d: NormDecision): string {
  if (d.status === 'no_rule') return '';

  const lines: string[] = ['<<<MGLAI-NORM-DECISION>>>'];
  lines.push(`төлөв: ${d.status}`);

  if (d.status === 'verified' && d.decision) {
    lines.push(
      d.mode === 'lookup'
        ? `ХҮСЭЛТ: ${d.decision.initial_category} ангиллын муж (доор)`
        : `ЭХНИЙ АНГИЛАЛ: ${d.decision.initial_category}`,
    );
  }
  for (const [k, v] of Object.entries(d.inputs_used)) lines.push(`оролт ${k}: ${v}`);

  if (d.additional_checks.required) {
    lines.push(`нэмэлт шалгалт: ШААРДЛАГАТАЙ (${d.additional_checks.method ?? '—'})`);
    if (d.additional_checks.missing_inputs.length > 0) {
      lines.push(`дутуу оролт: ${d.additional_checks.missing_inputs.join(', ')}`);
    }
  }
  // ⚠️ БҮХ МУЖИЙГ ИЛ БИЧНЭ.  Загвар хөршийн заагийг мэдэхгүй бол
  //    зохионо — хэмжсэн алдаа.
  for (const r of d.ranges) {
    const lo = r.min === null ? '—' : `${r.exclusiveMin ? '>' : '≥'}${r.min}`;
    const hi = r.max === null ? '' : ` … ≤${r.max}`;
    lines.push(`муж ${r.category}: ${lo}${hi} МДж/м²`);
  }
  if (d.source) {
    lines.push(
      `эх сурвалж: ${d.source.document}` +
        (d.source.table !== null ? `, хүснэгт ${d.source.table}` : '') +
        `, хуудас ${d.source.page}`,
    );
  }
  lines.push(`тайлбар: ${d.reason}`);
  lines.push('<<<END-MGLAI-NORM-DECISION>>>');
  return lines.join('\n');
}

/* ================================================================== */
/*  D1-ээс дүрэм ачаалах                                               */
/* ================================================================== */

/** D1-ийн `norm_threshold_rules` мөрийн хэлбэр. */
export interface NormRuleRow {
  rule_id: string;
  document_code: string;
  category: string;
  quantity: string;
  min_value: number | null;
  max_value: number | null;
  min_exclusive: number;
  max_exclusive: number;
  method: string | null;
  page: number;
  table_no: number | null;
  verification_status: string;
}

/**
 * ⚠️ ЦЭВЭР ХӨРВҮҮЛЭГЧ.  SQL-ийн мөрийг шийдвэрийн хөдөлгүүрийн типэд
 *    буулгана.  Хөрвүүлэлтийг тусад нь гаргасан нь тестлэгдэх боломж
 *    өгнө — `0`/`1` -ийг `boolean` болгох нь чимээгүй алдаа гаргамтгай.
 */
export function rowToRule(r: NormRuleRow): NormThresholdRule {
  return {
    ruleId: r.rule_id,
    documentCode: r.document_code,
    category: r.category,
    page: r.page,
    tableNo: r.table_no,
    quantity: 'g_mj_m2',
    minValue: r.min_value,
    maxValue: r.max_value,
    minExclusive: r.min_exclusive === 1,
    maxExclusive: r.max_exclusive === 1,
    method: r.method,
    verification: r.verification_status,
  };
}
