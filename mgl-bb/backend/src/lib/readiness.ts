/**
 * §69 «ХЯНАХАД БЭЛЭН» ХААЛГА + §66 ХУДАЛ ДОХИОНЫ ХЯНАЛТ — ЦЭВЭР ТООЦООЛОЛ.
 *
 * Track 2 · сесс `2-7-readiness-and-quality` · v2 §59 · §60 · §66 · §69.
 *
 * ⚠️ ЭНЭ НЬ ХУУЛЬ ЗҮЙН ГЭРЧИЛГЭЭ БИШ (v2 §69-R3).  Энэ нь инженерийн
 *    УРЬДЧИЛСАН хяналтын хаалга.  Гаралтын мөр бүр «шалгав» гэж бичнэ —
 *    `FORBIDDEN_GATE_WORDS`-д жагсаасан үгсийг ХЭЗЭЭ Ч бичихгүй.
 *    `readiness.test.ts` үүнийг мөрөөр нь барина.
 *
 * ⚠️ НЭГТГЭСЭН ЗҮЙЛ Л ОРНО.  Оролт бүр нь тоолуур; хэрэглэгчийн танигч,
 *    нэр, элементийн эзэн энд ОГТ БАЙХГҮЙ (`0201:23-32`, `0203:25-31`,
 *    `0205:42-46`, `routes/learning.ts:67-71`-ийн хувийн нууцын үл хөдлөх
 *    дүрэм, `revitNoteAi.test.ts:262`-оор түгжсэн).  Тэдгээр багана нэрсийн
 *    НЭГ Ч ТЭМДЭГТ энэ файлд байхыг §6-ийн `grep` хориглоно.
 *
 * ⚠️ D1 БАЙХГҮЙ, Hono БАЙХГҮЙ, `Autodesk.*` БАЙХГҮЙ.  Ганц импорт нь
 *    `complianceModel.ts`-ийн ХААЛТТАЙ ҮГСИЙН САН — тиймээс `node --test`
 *    доор Revit ч, D1 ч байхгүйгээр ачаалагдана (`leaveWindow.test.ts`,
 *    `complianceSurface.test.ts`-ийн загвар).
 *
 * ⚠️ БАГИЙН ТООГ ХААНА Ч ХАТУУ БИЧИХГҮЙ.  `Team checks: n/n`-ийн `n` нь
 *    АМЬД бүртгэлээс (төсөлд оролцож буй баг ∩ дүрмийн багцтай баг)
 *    аргумент болж ирнэ.  Эзний баталсан НАЙМ (v2 §46) нь ТӨЛӨВЛӨЛТИЙН
 *    тоо — ЭНЭ ФАЙЛД ЛИТЕРАЛ БОЛЖ ОРОХГҮЙ.
 */
import { SEVERITIES, type EvaluationState, type Severity } from './complianceModel';

/* ================================================================== */
/*  1. ОРОЛТЫН ГЭРЭЭ                                                   */
/* ================================================================== */

/** §67-ийн таван түвшин — `complianceModel.ts`-ийн `SEVERITIES`-тэй НЭГ. */
export type SeverityCounts = Record<Severity, number>;

/** Бүх тоолуур тэгтэй шинэ бичлэг — маршрут нь ЭНЭ функцээр эхэлнэ. */
export function emptySeverityCounts(): SeverityCounts {
  const out = {} as SeverityCounts;
  for (const s of SEVERITIES) out[s] = 0;
  return out;
}

/**
 * `GROUP BY severity` мөрүүдийг тоолуур болгон нугалах.
 *
 * ⚠️ ТАНИХГҮЙ `severity` УТГЫГ ЧИМЭЭГҮЙ ХАЯХГҮЙ.  D1-д гараар бичигдсэн
 *    буруу утга нь `unknownSeverity`-д хуримтлагдана; хаалга түүнийг
 *    `UNKNOWN` болгоно — «танихгүй ноцтой байдал» нь «ноцтой биш» ГЭСЭН
 *    ҮГ БИШ.
 */
export interface SeverityFold {
  readonly counts: SeverityCounts;
  readonly unknownSeverity: number;
}

export function foldSeverityRows(
  rows: ReadonlyArray<{ severity: unknown; n: unknown }>,
): SeverityFold {
  const counts = emptySeverityCounts();
  let unknownSeverity = 0;
  for (const r of rows) {
    const n = Number(r.n) || 0;
    const sev = String(r.severity ?? '');
    if ((SEVERITIES as readonly string[]).includes(sev)) counts[sev as Severity] += n;
    else unknownSeverity += n;
  }
  return { counts, unknownSeverity };
}

/** §59-ийн гурван төлөв — `AccordionForm.isFilled`-ийн шийдвэрийг давтав. */
export type CompletenessRowState = 'unknown' | 'asserted_absent' | 'asserted_present';

export type ReadinessInput = {
  /** OPEN/REOPENED, хуучраагүй олдворууд ноцтой байдлаар. */
  open_by_severity: SeverityCounts;
  /** Танихгүй `severity`-тэй нээлттэй олдвор — байвал хаалга `UNKNOWN`. */
  unknown_severity_open?: number;
  /** `verdict = 'UNCERTAIN'` мөрийн тоо (мөн OPEN/REOPENED). */
  uncertain_open: number;
  /** §59-ийн шалгуурын төлөв. */
  completeness: ReadonlyArray<{
    check: string;
    state: CompletenessRowState;
    /** `unavailable` эх сурвалжтай шалгуур ХУВААРЬТ ОРОХГҮЙ. */
    countable: boolean;
  }>;
  /** Багийн хамрах хүрээ — «төсөлд оролцож буй баг ∩ багцтай баг», АМЬДААР. */
  team_checks: ReadonlyArray<{ team_code: string; ran: boolean }>;
  /** `rule_run_ledger`-ийн эрүүл мэнд. */
  ledger: {
    /**
     * `2-3`-ын `evaluationStateOf`-ийн гаралт.  ⚠️ ЭНЭ ТАЛБАР НЬ ЭНЭ
     * ФАЙЛЫН ХАМГИЙН ЧУХАЛ ОРОЛТ: `rules` хүснэгт ХООСОН шипнэ (эзний
     * шийдвэр Ш4) тул `no_rule_pack` нь ХЭВИЙН эхлэлийн төлөв бөгөөд
     * тэр үед тэг олдвор нь «шалгаад цэвэр» ГЭСЭН ҮГ БИШ.
     */
    evaluation_state: EvaluationState;
    /** `rules.expect_applicable = 1` атлаа `applicable = 0` болсон дүрмийн тоо. */
    expected_but_inapplicable: number;
    /** `aborted`-ын нийлбэр. */
    aborted: number;
    /**
     * `coverage = 'partial'` олдворын тоо — ЭНЭ ТӨСЛИЙН хүрээнд.
     *
     * ⚠️ ЗААВАЛ ХАРАГДАХ ЁСТОЙ ОРОЛТ.  `evaluationStateOf` (`2-3`) үүнийг
     *    `partial` төлөв болгодог ба `2-5`-ын гадаргуу түүнийг «Шалгалт
     *    хэсэгчилсэн» гэж ҮНЭНЭЭР харуулдаг.  Хаалга үүнийг УНШИХГҮЙ бол
     *    хоёр гадаргуу ИЖИЛ БАРИМТЫН талаар ЗӨРЧИЛДӨНӨ.
     */
    partial_findings: number;
    /**
     * `stale_at IS NOT NULL` олдворын тоо — ЭНЭ ТӨСЛИЙН хүрээнд.
     *
     * ⚠️ ХУУЧИРСАН = «хөдөлгүүр өөрөө энэ мөрийг найдваргүй гэж зарлав»
     *    (§58).  Загвар өөрчлөгдөхөд бүх мөр хуучирдаг тул ГУРВАН CRITICAL
     *    хуучирсны дараа «нээлттэй, шинэ» тоолуур ТЭГ болно — тэр ТЭГИЙГ
     *    «цэвэр» гэж уншвал энэ хөтөлбөрийн ХАМГИЙН АЮУЛТАЙ гаралт гарна.
     *    Дараагийн амжилттай гүйлт мөрийг дахин илрүүлбэл `stale_at` нь
     *    NULL болж (`routes/compliance.ts`-ийн upsert) тоолуур өөрөө сална.
     */
    stale_findings: number;
    /** Бүртгэлд ямар ч мөр байхгүй эсэх. */
    empty: boolean;
    /** Нийтлэгдээгүй `pack_sha256`-аар ажилласан гүйлтийн тоо. */
    unpublished_pack_sessions: number;
  };
};

/* ================================================================== */
/*  2. ХАТУУ ТООНУУД, тус бүр нь ШАЛТГААНТАЙ                           */
/* ================================================================== */

/** Ноцтой зөрчил үлдээд «бэлэн» гэж хэлэх боломжгүй. */
export const READY_MAX_CRITICAL = 0;
/** HIGH нь §67-R2-оор CRITICAL-тай ижил хатуу хаалгатай. */
export const READY_MAX_HIGH = 0;
/**
 * UNCERTAIN = «бид шийдэж чадаагүй».  Шийдэгдээгүй эргэлзээтэйгээр
 * «бэлэн» гэвэл §65 (нотолгоонд суурилсан) утгагүй болно.  Хүн
 * ACKNOWLEDGED / DISMISSED болговол тоолуураас гардаг тул энэ нь ажлыг
 * гацаахгүй — шийдвэр гаргахыг л шаардана.
 */
export const READY_MAX_UNCERTAIN = 0;
/**
 * 95% нь дурын тоо БИШ: `unavailable` шалгуурууд хуваарьт ороогүй тул
 * хуваарь нь ойролцоогоор найм.  8-аас нэг нь `unknown` бол 87.5% — тэр нь
 * БЭЛЭН БИШ байх ёстой.  Тиймээс босго нь 100-аас доогуур, гэхдээ нэг ч
 * шалгуур дутахыг зөвшөөрөхгүй өндөр.
 *
 * ⚠️ ХЭМЖИГДЭЭГҮЙ ТААМАГ (§9.2-7).  Эхний сарын дараа бодит өгөгдлөөр
 *    тохируулна — ЭНД БИЧСЭН нь тэр өдөр хаанаас засахыг заана.
 */
export const READY_MIN_COMPLETENESS_PCT = 95;

/* ================================================================== */
/*  3. ГУРВАН ТӨЛӨВТ ХААЛГА                                            */
/* ================================================================== */

export type ReadinessStatus = 'READY' | 'NOT_READY' | 'UNKNOWN';

export type ReadinessBlocker = { key: string; count: number };

export type ReadinessResult = {
  status: ReadinessStatus;
  /** Яагаад бэлэн биш / яагаад тодорхойгүй — i18n түлхүүр + тоо.  Чөлөөт бичвэр БИШ. */
  blockers: ReadonlyArray<ReadinessBlocker>;
  completeness_pct: number;
  completeness_known: number;
  completeness_total: number;
  team_checks_done: number;
  team_checks_total: number;
};

/**
 * §59-ийн бүрэн бүтэн байдлын хувь.
 *
 * ⚠️ `countable = false` шалгуур нь ХУВААРЬТ ОРОХГҮЙ.  «Хэмжиж чадахгүй»
 *    зүйлийг «дутуу» гэж тоолбол хувь нь мөнхөд 80% дээр зогсож, хаалга
 *    утгагүй болно.  Тэр шалгуурууд нь `gaps[]`-д `unavailable` гэж
 *    ХАРАГДСАН хэвээр үлдэнэ — нуугдахгүй.
 *
 * ⚠️ `asserted_absent` нь МЭДЭГДСЭН — «хэлээгүй» БИШ.  «Өрөө байхгүй» гэж
 *    хэлсэн нь бүрэн гүйцэд хариулт мөн (`AccordionForm.tsx:41-49`).  Хоёрыг
 *    нэгтгэвэл шинэ загвар бүр дээр бүх шалгуур «дутуу» болж, §66-ийн
 *    худал дохионы хамгийн том эх сурвалж болно.
 */
export function computeCompleteness(rows: ReadinessInput['completeness']): {
  pct: number;
  known: number;
  total: number;
} {
  const countable = rows.filter((r) => r.countable);
  const total = countable.length;
  if (total === 0) return { pct: 0, known: 0, total: 0 };
  const known = countable.filter((r) => r.state !== 'unknown').length;
  return { pct: Math.round((known / total) * 100), known, total };
}

/**
 * §69-ийн `Team checks: n/n`.
 *
 * ⚠️ ХУВААРЬ НЬ АМЬД БҮРТГЭЛ.  Ямар ч тогтмол тоо БИШ — төсөлд оролцож
 *    БУЙ баг (`project_team_shares.share_percent > 0`) ба дүрмийн багцТАЙ
 *    багийн ОГТЛОЛЦОЛ.  Админ ажиллаж байхад баг нэмж чадна
 *    (`POST /api/teams`), багц ч нэмэгдэж болно.
 *
 * ⚠️ ЭЗЭН БАТАЛСАН 2026-08-30 (v2 §46): дүрмийн багц авах салбар нь
 *    BA · BB · HAS · TSBU · TSAH · HD · AU · IZ; MGMT · EZ · GT нь багц
 *    АВАХГҮЙ тул хуваарьт ОРОХГҮЙ — эс бөгөөс MGMT-тэй төсөл мөнхөд
 *    улаан үлдэнэ.  Тэр жагсаалт ЭНД БАЙХГҮЙ: шүүлт нь маршрутын SQL дэх
 *    багцын ОРШИХУЙН (`EXISTS … rules … status='published'`) шалгалт,
 *    тоо БИШ.  Багцгүй баг нь `TEAM = UNCERTAIN` ч БИШ — түүний илрүүлэлт
 *    амжилттай, зөвхөн нийцлийн шалгалт алгасагдана (`2-1` §3.4).
 */
export function computeTeamChecks(rows: ReadinessInput['team_checks']): {
  done: number;
  total: number;
} {
  return { done: rows.filter((r) => r.ran).length, total: rows.length };
}

/**
 * ГУРВАН ТӨЛӨВТ ХААЛГА.
 *
 * ⚠️ `UNKNOWN` нь `NOT_READY`-ЭЭС ӨӨР бөгөөд ЗААВАЛ БАЙХ ЁСТОЙ, БАС
 *    `READY` рүү ХЭЗЭЭ Ч уначихгүй байх ёстой: «хэмжигдээгүй» гэдэг нь
 *    «зөрчилгүй» гэсэн үг БИШ (`eval/run_golden.py:352-353`-ын шийдвэрийг
 *    давтав).  Хөдөлгүүр огт ажиллаагүй загварыг НОГООН харуулбал инженер
 *    «Хянахад бэлэн» гэж уншаад ШАЛГАГДААГҮЙ загварыг хяналтад өгнө —
 *    энэ хөтөлбөрийн гаргаж болох ХАМГИЙН АЮУЛТАЙ гаралт.
 *
 * ДАРААЛАЛ АЧААЛАЛТАЙ: «хэмжигдсэн үү» гэсэн асуулт «үр дүн ямар вэ»
 * гэсэн асуултаас ӨМНӨ.  Урвуулбал дүрэмгүй, шалгалтгүй төсөл нь
 * «0 зөрчил» тул `READY` болно.
 *
 * ⚠️ `EvaluationState`-ийн ДӨРВӨН утга БҮГД энд хариултгүй үлдэж БОЛОХГҮЙ.
 *    `no_rule_pack` ба `never_run` нь ил салаатай; `partial` нь
 *    `stale_findings` / `partial_findings` / `aborted` тоолуураар ба
 *    сүүлийн хамгаалалт (h)-аар орно; `checked` Л ГАНЦААРАА `READY` рүү
 *    үргэлжлэх эрхтэй.  ⛔ `partial`-ыг УНШИХГҮЙ ОРХИВОЛ бүх нотолгоо нь
 *    ХУУЧИРСАН төсөл «Хянахад бэлэн» гэж НОГООН гарна — `2-5`-ын гадаргуу
 *    ЯГ ТЭР ФАКТЫГ «Шалгалт хэсэгчилсэн» гэж үнэнээр харуулж байхад.
 */
export function computeReadiness(input: ReadinessInput): ReadinessResult {
  const c = computeCompleteness(input.completeness);
  const t = computeTeamChecks(input.team_checks);

  /* --- 1. ТОДОРХОЙГҮЙ: хөдөлгүүр найдвартай ажиллаагүй --- */
  const unknown: ReadinessBlocker[] = [];

  // (a) Дүрмийн багц ОГТ БАЙХГҮЙ.  Эзний Ш4-ийн эхлэлийн төлөв: `rules`
  //     ХООСОН шипнэ.  Тэг олдвор нь ЭНД «шалгаад цэвэр» ГЭСЭН ҮГ БИШ.
  if (input.ledger.evaluation_state === 'no_rule_pack') {
    unknown.push({ key: 'readiness.blocker.noRulePack', count: 1 });
  } else if (input.ledger.evaluation_state === 'never_run' || input.ledger.empty) {
    // (b) Дүрэм бий, гэвч энэ төсөл дээр мөчлөг НЭГ Ч удаа ажиллаагүй.
    unknown.push({ key: 'readiness.blocker.ledgerEmpty', count: 1 });
  }

  // (c) Энэ төслийн НЭГ Ч салбар дүрмийн багцтай биш.  Хуваарь тэг үед
  //     «Багийн шалгалт 0/0» нь бүрэн гүйцэд мэт УНШИГДАНА — тэр нь яг
  //     `READY`-ийн хамгийн аюултай хэлбэр.  Тиймээс ил `UNKNOWN`.
  if (t.total === 0) unknown.push({ key: 'readiness.blocker.noTeamPack', count: 1 });

  // (d) Хэмжих боломжтой НЭГ Ч шалгуур үлдээгүй (бүгд `unavailable`).
  if (c.total === 0) unknown.push({ key: 'readiness.blocker.completenessUnmeasurable', count: 1 });

  if (input.ledger.expected_but_inapplicable > 0) {
    unknown.push({
      key: 'readiness.blocker.expectedInapplicable',
      count: input.ledger.expected_but_inapplicable,
    });
  }
  if (input.ledger.aborted > 0) {
    unknown.push({ key: 'readiness.blocker.aborted', count: input.ledger.aborted });
  }
  // (e) ХУУЧИРСАН НОТОЛГОО (§58).  ⚠️ ЭНЭ САЛАА БАЙХГҮЙ БАЙВ: маршрутын
  //     ноцтой байдлын асуулга нь `stale_at IS NULL` гэж шүүдэг тул
  //     хуучирсан ГУРВАН CRITICAL нь `open_by_severity`-ээс ГАРЧ, хаалга
  //     «0 зөрчил» гэж уншаад НОГООН болдог байлаа.  Хуучирсан мөр нь
  //     «зөрчил алга» ГЭСЭН ҮГ БИШ — «хөдөлгүүр өөрөө найдваргүй гэж
  //     зарласан» гэсэн үг, ба тэр нь тодорхойлолтоороо `UNKNOWN`.
  if (input.ledger.stale_findings > 0) {
    unknown.push({ key: 'readiness.blocker.staleFindings', count: input.ledger.stale_findings });
  }
  // (f) ХЭСЭГЧИЛСЭН ХАМРАЛТ.  Дүрэм ажилласан ч загварын ХЭСГИЙГ л үзсэн:
  //     үзээгүй хэсэгт юу байсныг МЭДЭХГҮЙ, тиймээс «цэвэр» гэж хэлэх
  //     үндэсгүй.
  if (input.ledger.partial_findings > 0) {
    unknown.push({
      key: 'readiness.blocker.partialCoverage',
      count: input.ledger.partial_findings,
    });
  }
  if (input.ledger.unpublished_pack_sessions > 0) {
    unknown.push({
      key: 'readiness.blocker.unpublishedPack',
      count: input.ledger.unpublished_pack_sessions,
    });
  }
  // (g) Танихгүй `severity` — тоолуур нь аль хаалганд орохыг МЭДЭХГҮЙ.
  const unknownSev = input.unknown_severity_open ?? 0;
  if (unknownSev > 0) {
    unknown.push({ key: 'readiness.blocker.unknownSeverity', count: unknownSev });
  }

  // (h) СҮҮЛИЙН ХАМГААЛАЛТ.  `2-3` нь төлөвийг `partial` гэж зарласан
  //     атлаа дээрх ТООЛУУРЫН НЭГ Ч НЬ (aborted / stale / partial)
  //     яагаадыг тайлбарлаагүй бол тоолуур ба төлөв ЗӨРЧИЛДӨЖ БАЙНА.
  //     Тийм үед `READY` рүү унах нь ЯГ ТЭР ЧИМЭЭГҮЙ НОГООН — тиймээс
  //     ил `UNKNOWN`.  ⚠️ Энэ бол `evaluation_state` ба хаалганы хоорондох
  //     ЦОРЫН ГАНЦ шууд холбоос: `EvaluationState`-д шинэ утга нэмэгдвэл
  //     энэ салаа түүнийг АНХДАГЧААР «тодорхойгүй» гэж авна, «бэлэн» ГЭЖ
  //     БИШ.
  if (unknown.length === 0 && input.ledger.evaluation_state === 'partial') {
    unknown.push({ key: 'readiness.blocker.partialEvaluation', count: 1 });
  }

  if (unknown.length > 0) {
    return { status: 'UNKNOWN', blockers: unknown, ...spread(c, t) };
  }

  /* --- 2. БЭЛЭН БИШ --- */
  const blockers: ReadinessBlocker[] = [];
  if (input.open_by_severity.CRITICAL > READY_MAX_CRITICAL) {
    blockers.push({ key: 'readiness.blocker.critical', count: input.open_by_severity.CRITICAL });
  }
  if (input.open_by_severity.HIGH > READY_MAX_HIGH) {
    blockers.push({ key: 'readiness.blocker.high', count: input.open_by_severity.HIGH });
  }
  if (input.uncertain_open > READY_MAX_UNCERTAIN) {
    blockers.push({ key: 'readiness.blocker.uncertain', count: input.uncertain_open });
  }
  if (c.pct < READY_MIN_COMPLETENESS_PCT) {
    blockers.push({ key: 'readiness.blocker.completeness', count: c.total - c.known });
  }
  if (t.done < t.total) {
    blockers.push({ key: 'readiness.blocker.teamChecks', count: t.total - t.done });
  }

  return { status: blockers.length === 0 ? 'READY' : 'NOT_READY', blockers, ...spread(c, t) };
}

function spread(
  c: { pct: number; known: number; total: number },
  t: { done: number; total: number },
) {
  return {
    completeness_pct: c.pct,
    completeness_known: c.known,
    completeness_total: c.total,
    team_checks_done: t.done,
    team_checks_total: t.total,
  };
}

/* ================================================================== */
/*  4. §69-R3 — ГЭРЧИЛГЭЭНИЙ ХЭЛ ХОРИОТОЙ                              */
/* ================================================================== */

/**
 * ⚠️ Хаалганы шошго ҮРГЭЛЖ «шалгав» — юу шалгасныг нь хувилбартай нь
 *    хамт хэлнэ.  Доорх үгс нь МЭРГЭЖЛИЙН ХАРИУЦЛАГЫН мэдэгдэл болно;
 *    дүрмүүд өөрсдөө `UNVERIFIED` (`2-2`) байхад тэр нь ХУДАЛ мэдэгдэл.
 *
 * ⚠️ ЭНЭ ЖАГСААЛТ БОЛ ЭНЭ ФАЙЛ ДАХЬ ТЭДГЭЭР ҮГСИЙН ЦОРЫН ГАНЦ ГАЗАР.
 *    §6-ийн `grep` тэднийг өөр мөрөнд олвол шошго бичигдсэн гэсэн үг.
 */
export const FORBIDDEN_GATE_WORDS = [
  'баталгаажлаа',
  'баталгаажсан',
  'зөвшөөрөгдсөн',
  'нийцсэн',
  'certified',
  'approved',
  'compliant',
] as const;

/** Дурын шошгыг хориотой үгээр шалгах — тест ба маршрут хоёулаа ЭНЭ функцээр орно. */
export function containsForbiddenGateWord(text: string): string | null {
  const low = text.toLowerCase();
  for (const w of FORBIDDEN_GATE_WORDS) {
    if (low.includes(w.toLowerCase())) return w;
  }
  return null;
}

/** «Дүрмийн багц 2026-09-01.1, 14 дүрмээр шалгав» */
export function checkedLabel(rulesetVersion: string, ruleCount: number): string {
  return `Дүрмийн багц ${rulesetVersion}, ${ruleCount} дүрмээр шалгав`;
}

/**
 * ⚠️ Багц ХООСОН үед «Дүрмийн багц , 0 дүрмээр шалгав» гэж бичих нь
 *    ХУДАЛ: юу ч шалгаагүй.  Эзний Ш4 (`rules` ХООСОН шипнэ) тул энэ
 *    салаа нь эхний релизийн ГОЛ зам — онцгой тохиолдол БИШ.
 */
export function noPackLabel(): string {
  return 'Дүрмийн багц ачаалагдаагүй — шалгалт хийгдээгүй';
}

/**
 * ⚠️ БАГЦ БАЙГАА Ч НЭГ Ч УДАА АЖИЛЛААГҮЙ.  `checkedLabel` нь «шалгав»
 *    гэсэн ӨНГӨРСӨН ЦАГИЙН БАТАЛГАА тул `rule_run_ledger` ХООСОН байхад
 *    түүнийг бичих нь ХУДАЛ: багц НИЙТЛЭГДСЭН нь шалгалт АЖИЛЛАСАН гэсэн
 *    үг БИШ.  Хэмжсэн (2026-08-31): `evaluation_state = 'never_run'`
 *    төсөл дээр самбар «Дүрмийн багц 2026-09-01.1, 1 дүрмээр шалгав» гэж
 *    бичдэг байв — өөрөөр хэлбэл дүрэм НЭГ Ч удаа ажиллаагүй загвар
 *    «шалгав» гэсэн баталгаа авдаг байсан.  Энэ бол §69-ийн ХАМГИЙН
 *    АЮУЛТАЙ гаралт: хаалганы `status` нь `UNKNOWN` байсан ч ХЭРЭГЛЭГЧ
 *    уншдаг МӨР нь шалгалт болсон гэж хэлж байлаа.
 */
export function notRunLabel(rulesetVersion: string, ruleCount: number): string {
  return `Дүрмийн багц ${rulesetVersion}, ${ruleCount} дүрэм ачаалагдсан — шалгалт хараахан ажиллаагүй`;
}

/**
 * ⚠️ ХАМРАХ ХҮРЭЭ ХЭМЖИГДЭЭГҮЙ.  Бүртгэл хоосон үед `coverageLabel(0, 0)`
 *    нь «Энэ загварт хамаарах дүрэм олдсонгүй» гэж бичдэг ба тэр нь
 *    ШИЙДВЭР ГАРСАН мэт уншигдана («хайсан, олдсонгүй»).  Юу ч ажиллаагүй
 *    үед бид хамаарлыг ХЭМЖЭЭГҮЙ — тэр хоёр ӨӨР баримт.
 */
export function coverageNotMeasuredLabel(): string {
  return 'Хамрах хүрээ хараахан хэмжигдээгүй';
}

/**
 * «12 дүрмээс 9 нь шалгагдав» — «бүгд OK» ГЭЖ ХЭЗЭЭ Ч бичихгүй.
 *
 * ⚠️ `applicable === 0` бол «0 дүрмээс 0 нь шалгагдав» гэж бичих нь
 *    ХООСОН баталгаа — тиймээс ТУСДАА мөр.
 */
export function coverageLabel(applicable: number, evaluated: number): string {
  if (applicable <= 0) return 'Энэ загварт хамаарах дүрэм олдсонгүй';
  return `${applicable} дүрмээс ${evaluated} нь шалгагдав`;
}

/* ================================================================== */
/*  5. §66 — ХУДАЛ ЭЕРЭГ / ХУДАЛ СӨРӨГ                                 */
/* ================================================================== */

/**
 * ⚠️ ХЭМЖИГДЭЭГҮЙ нь ТЭГ БИШ.  Хуваарь тэг үед `null` буцаана — `0`
 *    буцаавал самбар «худал дохио 0%» гэж бичих ба тэр нь хэмжигдээгүй
 *    байдлыг ТӨГС ГҮЙЦЭТГЭЛ мэт уншуулна (`eval/run_golden.py:315-316` —
 *    хоосон хуваарь нь БЛОКЛОНО, алгасахгүй).
 */
export type Rate = {
  value: number | null;
  measured: boolean;
  numerator: number;
  denominator: number;
};

export function rateOf(numerator: number, denominator: number): Rate {
  if (denominator <= 0) return { value: null, measured: false, numerator, denominator };
  return { value: numerator / denominator, measured: true, numerator, denominator };
}

/** `false_positive[sev] / emitted[sev]` — ноцтой байдал бүрд тусад нь. */
export function fpRates(
  emitted: SeverityCounts,
  falsePositive: SeverityCounts,
): Record<Severity, Rate> {
  const out = {} as Record<Severity, Rate>;
  for (const s of SEVERITIES) out[s] = rateOf(falsePositive[s], emitted[s]);
  return out;
}

/** `1 − missed / expected` — golden гүйлтийн мэдрэмж. */
export function recallOf(expected: number, missed: number): Rate {
  return rateOf(Math.max(0, expected - missed), expected);
}

/**
 * §66-R3 — «олон сануулга гаргаад ноцтой зөрчлийг алддаг систем нь
 * АМЖИЛТГҮЙ».  Тиймээс энэ нь ТАТГАЛЗАХ шалгуур: нийт нарийвчлал
 * сайжирсан ч CRITICAL-ийн recall буурсан бол багц ГАРАХГҮЙ.
 *
 * ⚠️ Тэвчээрийн тоонууд нь `pull_and_retrain.py`-ийн шипсэн
 *    `--max-drop 0.02` / `--max-drop-intent 0.05`-ыг ЗОРИУД давтав,
 *    гэхдээ CRITICAL дээр ТЭГ: ноцтой зөрчлийн мэдрэмж буурахыг «бага
 *    зэрэг» гэж зөвшөөрөх боломжгүй.
 */
export const RECALL_MAX_DROP_OVERALL = 0.02;
export const RECALL_MAX_DROP_PER_SEVERITY = 0.05;
export const RECALL_MAX_DROP_CRITICAL = 0.0;

export function packRegressed(
  prev: Partial<Record<Severity, number>>,
  next: Partial<Record<Severity, number>>,
  overallPrev: number,
  overallNext: number,
): { regressed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (overallPrev - overallNext > RECALL_MAX_DROP_OVERALL) {
    reasons.push(`overall recall ${overallPrev.toFixed(3)} → ${overallNext.toFixed(3)}`);
  }
  for (const sev of SEVERITIES) {
    const p = prev[sev];
    const n = next[sev];
    // ⚠️ ЭНЭ САЛАА ЗААВАЛ.  `run_golden.py:315`-ийн философи: хэмжигдээгүй
    //    хуваарийг «унасан» гэж тооцвол шинэ ноцтой байдал нэмэх бүрд багц
    //    блоклогдоно; «дамжсан» гэж тооцвол хэмжилтгүй багц гарна.  Тиймээс
    //    ЭНД дамжуулж, БЛОКЛОХ ажлыг `run_golden.py`-ийн хоосон-хуваарийн
    //    дүрэмд үлдээнэ (тэр нь аль хэдийн `exit 2` хийдэг).
    if (p == null || n == null) continue;
    const limit = sev === 'CRITICAL' ? RECALL_MAX_DROP_CRITICAL : RECALL_MAX_DROP_PER_SEVERITY;
    if (p - n > limit) reasons.push(`${sev} recall ${p.toFixed(3)} → ${n.toFixed(3)}`);
  }
  return { regressed: reasons.length > 0, reasons };
}

/**
 * §66-ийн ОНЛАЙН ОЙРОЛЦООЛОЛ (PROXY) — «өмнөх дүрмийн багц үүнийг алдсан».
 *
 * ⚠️ АЛБАН ЁСНЫ FN-ийг ЭНЭ ОРЛОХГҮЙ.  «Алдсан зөрчил» гэдэг нь
 *    тодорхойлолтоороо хөдөлгүүр ГАРГААГҮЙ мөр — түүнийг олдворын
 *    хүснэгтээс тоолох БОЛОМЖГҮЙ.  Албан ёсны хэмжилт нь
 *    `revit-mcp/eval/run_golden.py --kind rules`.  Самбар дээр энэ тоо нь
 *    `readiness.quality.proxy` шошготой ЗААВАЛ гарна.
 */
export const LATE_CATCH_IS_PROXY_ONLY = true as const;
