/**
 * ОЛДВОРЫН АМЬДРАЛЫН МӨЧЛӨГ + ХУУЧРУУЛАЛТ + ГҮЙЛТИЙН БҮРТГЭЛИЙН ТЕСТ
 * — `2-3-compliance-engine` §3.1 / §3.10 / §3.12.
 *
 * Run with:  node --test src/lib/complianceLifecycle.test.ts
 *
 * ⚠️ `registerHooks` — `src/lib/*.ts` нь өргөтгөлгүй харьцангуй импорт
 *    хэрэглэдэг тул `node --test` дор шууд `import` УНАНА (tsc ногоон
 *    хэвээр).  `bimEvents.test.ts` / `ruleApplicability.test.ts`-ийн ЯГ ИЖИЛ
 *    хэв маяг.
 *
 * ⚠️ ЭНЭ ФАЙЛ D1-Д ХҮРЭХГҮЙ.  Маршрутын SQL нь энд тестлэгдэхгүй; тестлэгдэж
 *    байгаа зүйл нь ГЭРЭЭ — хаалттай үгсийн сан, шилжилтийн матриц, ба
 *    «дүрмийн багц байхгүй» / «шалгаад цэвэр» хоёрын ЯЛГАА.  Сүүлийнх нь
 *    эзний шийдвэр Ш4-ийн (rules хүснэгт ХООСОН шипнэ) дараа системийн
 *    гаргаж болох ХАМГИЙН МУУ ХУДАЛ мэдэгдлээс хамгаалах ганц харуул.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const M = await import('./complianceModel.ts');

/* ================================================================== */
/*  1. ГУРВАН ТЭНХЛЭГ ХЭЗЭЭ Ч НЭГТГЭГДЭХГҮЙ                            */
/* ================================================================== */

test('дүгнэлт / ангилал / нотолгооны түвшин нь ГУРВАН ТУСДАА үгсийн сан', () => {
  // Тэд өөр өөр асуултад хариулна.  Нэг `status` багана болгон нурааж
  // болохгүй: тэгвэл `TEAM_STANDARD` нь зохицуулалтын зөрчлөөс ялгагдахаа
  // болино — тэр нь эзний R3-ийн үндэс.
  assert.deepEqual([...M.VERDICTS], ['PASS', 'WARNING', 'VIOLATION', 'UNCERTAIN']);
  assert.equal(M.ISSUE_CLASSES.length, 5);
  assert.equal(M.EVIDENCE_LEVELS.length, 5);

  // Гурван олонлог ХООРОНДОО ОГТЛОЛЦОХГҮЙ — огтлолцвол нэг мөрийн утгыг
  // аль тэнхлэгийнх болохыг таамаглах шаардлагатай болно.
  const all = [...M.VERDICTS, ...M.ISSUE_CLASSES, ...M.EVIDENCE_LEVELS];
  assert.equal(new Set(all).size, all.length, 'гурван тэнхлэг нэг ч токен хуваалцахгүй');
});

test('`NOT_APPLICABLE` нь VERDICTS-д БАЙХГҮЙ ба МӨР БОЛЖ ХУВИРАХГҮЙ', () => {
  assert.equal((M.VERDICTS as readonly string[]).includes('NOT_APPLICABLE'), false);
  assert.equal(M.NOT_APPLICABLE_IS_NOT_A_ROW, true);
  // ГЭХДЭЭ тестийн ХҮЛЭЭЛТЭД нь байна (`rule_test_cases.expect_verdict`).
  assert.equal((M.EXPECT_VERDICTS as readonly string[]).includes('NOT_APPLICABLE'), true);
});

/* ================================================================== */
/*  2. §57 — ЯГ ДОЛООН ТӨЛӨВ, `STALE` НЬ ТЭДНИЙ НЭГ БИШ                */
/* ================================================================== */

test('LIFECYCLE_STATES нь ЯГ долоо ба `STALE` ЭНД БАЙХГҮЙ', () => {
  assert.equal(M.LIFECYCLE_STATES.length, 7);
  assert.equal((M.LIFECYCLE_STATES as readonly string[]).includes('STALE'), false);
  // Хуучруулалт нь НАЙМ ДАХЬ ТӨЛӨВ БИШ, түр тэмдэг — тусдаа үгсийн сантай.
  assert.deepEqual([...M.STALE_REASONS], ['sync', 'edit', 'ruleset', 'central']);
});

test('ALLOWED_TRANSITIONS нь БҮРЭН Record ба зөвхөн хүчинтэй төлөв рүү заана', () => {
  for (const from of M.LIFECYCLE_STATES) {
    const targets = M.ALLOWED_TRANSITIONS[from];
    assert.ok(Array.isArray(targets), `${from} мөр байхгүй`);
    for (const to of targets) {
      assert.ok(
        (M.LIFECYCLE_STATES as readonly string[]).includes(to),
        `${from} -> ${to} нь үгсийн сангаас гадуур`,
      );
      assert.notEqual(to, from, 'өөр рүүгээ заасан ирмэг илүүц');
    }
  }
});

test('INVALIDATED нь ЭЦСИЙН — гарах зам БАЙХГҮЙ', () => {
  assert.deepEqual([...M.ALLOWED_TRANSITIONS.INVALIDATED], []);
  for (const to of M.LIFECYCLE_STATES) {
    if (to === 'INVALIDATED') continue;
    assert.equal(M.canTransition('INVALIDATED', to), false, `INVALIDATED -> ${to} нээлттэй байна`);
  }
});

test('DISMISSED нь ЗӨВХӨН REOPENED рүү буцна (§68 — override нь НЭМЭЛТ)', () => {
  assert.deepEqual([...M.ALLOWED_TRANSITIONS.DISMISSED], ['REOPENED']);
  assert.equal(M.canTransition('DISMISSED', 'OPEN'), false);
  assert.equal(M.canTransition('DISMISSED', 'REOPENED'), true);
});

test('FIXED-ээс REOPENED руу буцах зам НЭЭЛТТЭЙ (§57)', () => {
  assert.equal(M.canTransition('FIXED', 'REOPENED'), true);
  assert.equal(M.canTransition('FIXED', 'OPEN'), false);
});

test('ижил төлөв рүү шилжих нь NO-OP тул ХУУЛЬ ЁСНЫ', () => {
  // Эс бөгөөс сүлжээ тасарч дахин илгээсэн PATCH нь 409 авна.
  for (const s of M.LIFECYCLE_STATES) assert.equal(M.canTransition(s, s), true);
});

/* ================================================================== */
/*  3. §58 — ХУУЧРУУЛЖ БОЛОХ ТӨЛӨВҮҮД                                  */
/* ================================================================== */

test('ХААЛТТАЙ олдвор ХУУЧИРДАГГҮЙ, ACKNOWLEDGED нь ХУУЧИРДАГ', () => {
  const staleable = new Set<string>(M.STALEABLE_LIFECYCLE_STATES);
  // «Ойлголоо» гэсэн олдвор загвар өөрчлөгдөхөд ДАХИН үнэлэгдэх ёстой.
  assert.equal(staleable.has('ACKNOWLEDGED'), true);
  // Зассан ажлыг эргэлзээтэй мэт харуулах нь §58-ын зорилгын ЭСРЭГ.
  assert.equal(staleable.has('FIXED'), false);
  assert.equal(staleable.has('DISMISSED'), false);
  assert.equal(staleable.has('INVALIDATED'), false);
  // Нээлттэй бүх төлөв хуучирна.
  for (const s of M.OPEN_LIFECYCLE_STATES) assert.equal(staleable.has(s), true);
});

/* ================================================================== */
/*  4. `dedup_key` — ХОЁР ТАЛЫН ГЭРЭЭ                                  */
/* ================================================================== */

test('dedup_key нь 16 тэмдэгт, детерминист, ба оролтоороо ЯЛГАГДАНА', async () => {
  const a = await M.dedupKeyOf('BA-HR-CORRIDOR-W-001', 'elem-1');
  const b = await M.dedupKeyOf('BA-HR-CORRIDOR-W-001', 'elem-1');
  const c = await M.dedupKeyOf('BA-HR-CORRIDOR-W-001', 'elem-2');
  const d = await M.dedupKeyOf('BA-HR-CORRIDOR-W-002', 'elem-1');
  assert.equal(a.length, M.DEDUP_KEY_LENGTH);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, d);
});

test('тусгаарлагч нь 0x00 — дүрмийн код ба UniqueId-д ГАРДАГГҮЙ тэмдэгт', async () => {
  assert.equal(M.DEDUP_KEY_SEPARATOR.length, 1);
  assert.equal(M.DEDUP_KEY_SEPARATOR.charCodeAt(0), 0);
  // `':'` эсвэл `'|'`-ээр тусгаарлавал ('BA:X','Y') ба ('BA','X:Y') ИЖИЛ түлхүүр
  // өгнө.  0x00 нь хэвлэгдэх мужаас ГАДУУР тул тэр залгаа БОЛОМЖГҮЙ.
  assert.equal(M.DEDUP_KEY_SEPARATOR.charCodeAt(0) < 32, true);
});

/* ================================================================== */
/*  5. `rule_run_ledger.skipped_reason` — ХАМААРЛЫН ТОЛИЙН НАДЛАГ      */
/* ================================================================== */

test('LEDGER_SKIP_REASONS нь APPLICABILITY_REASONS-ыг БҮРЭН агуулна', () => {
  // Хавсралт §9.1: бүртгэлийн толь нь хамаарлын толийн НАДЛАГ ОЛОНЛОГ.
  // Зөрвөл клиент дүрмийг алгасах, сервер ажилласан гэж тоолох — хаалга
  // НОГООН, шалгалт ХИЙГДЭЭГҮЙ.
  for (const r of M.APPLICABILITY_REASONS) {
    assert.equal(M.isLedgerSkipReason(r), true, `${r} бүртгэлийн тольд алга`);
  }
  for (const extra of ['no_category', 'missing_params', 'budget_abort']) {
    assert.equal(M.isLedgerSkipReason(extra), true, `${extra} алга`);
  }
  assert.equal(M.isLedgerSkipReason('threshold_minus'), false, 'тестийн анги нь шалтгаан БИШ');
});

test('`not_reported` нь ЗӨВШӨӨРӨГДӨНӨ — applicable=0 мөр ХЭЗЭЭ Ч NULL шалтгаантай үлдэхгүй', () => {
  // ⚠️ Энэ нь ХУДАЛ шалтгаан зохиохгүйгээр «шалтгаан мэдэгдэхгүй»-г
  //    ХАДГАЛАХ цорын ганц токен.  NULL үлдээвэл «хэзээ ч ажиллаагүй дүрэм»
  //    ЧИМЭЭГҮЙ болж, §69 түүнийг «цэвэр» гэж уншина.
  assert.equal(M.isLedgerSkipReason('not_reported'), true);
});

/* ================================================================== */
/*  6. «ДҮРМИЙН БАГЦ БАЙХГҮЙ» ба «ШАЛГААД ЦЭВЭР» — ЯЛГАА               */
/* ================================================================== */

test('дүрэм ч, багц ч байхгүй бол `no_rule_pack` — ХЭЗЭЭ Ч `checked` БИШ', () => {
  // Эзний Ш4-ийн ХЭВИЙН эхлэлийн төлөв: `rules` хүснэгт ХООСОН шипнэ.
  assert.equal(
    M.evaluationStateOf({
      rulesPublished: 0,
      packsPublished: 0,
      ledgerRows: 0,
      aborted: 0,
      partialFindings: 0,
      staleFindings: 0,
    }),
    'no_rule_pack',
  );
});

test('дүрэм бий, гэвч мөчлөг ажиллаагүй бол `never_run`', () => {
  assert.equal(
    M.evaluationStateOf({
      rulesPublished: 12,
      packsPublished: 1,
      ledgerRows: 0,
      aborted: 0,
      partialFindings: 0,
      staleFindings: 0,
    }),
    'never_run',
  );
});

test('таслагдсан / хуучирсан / хэсэгчилсэн бол `partial`', () => {
  const base = {
    rulesPublished: 12,
    packsPublished: 1,
    ledgerRows: 4,
    aborted: 0,
    partialFindings: 0,
    staleFindings: 0,
  };
  assert.equal(M.evaluationStateOf({ ...base, aborted: 1 }), 'partial');
  assert.equal(M.evaluationStateOf({ ...base, partialFindings: 1 }), 'partial');
  assert.equal(M.evaluationStateOf({ ...base, staleFindings: 1 }), 'partial');
  assert.equal(M.evaluationStateOf(base), 'checked');
});

test('`checked` нь БАГЦ БАЙХГҮЙ үед ХҮРЭХГҮЙ, бүртгэл хэдий их байсан ч', () => {
  // Хамгийн аюултай хуурамч замыг ил хаана: тэг олдвор + тэг дүрэм нь
  // «нийцсэн» ГЭСЭН ҮГ БИШ.
  assert.equal(
    M.evaluationStateOf({
      rulesPublished: 0,
      packsPublished: 0,
      ledgerRows: 99,
      aborted: 0,
      partialFindings: 0,
      staleFindings: 0,
    }),
    'no_rule_pack',
  );
});

/* ================================================================== */
/*  7. Хаалттай үгсийн сангийн харуулууд                               */
/* ================================================================== */

test('төлөв / шалтгаан / үүрэг / ирмэгийн харуулууд хог утгыг ТАТГАЛЗАНА', () => {
  assert.equal(M.isLifecycleState('OPEN'), true);
  assert.equal(M.isLifecycleState('STALE'), false);
  assert.equal(M.isLifecycleState('open'), false);
  assert.equal(M.isStaleReason('sync'), true);
  assert.equal(M.isStaleReason('rebuild'), false);
  assert.equal(M.isCoverage('partial'), true);
  assert.equal(M.isCoverage('none'), false);
  assert.equal(M.isFindingElementRole('subject'), true);
  assert.equal(M.isFindingElementRole('cause'), false);
  assert.deepEqual([...M.FINDING_EDGE_KINDS], ['causes', 'duplicates', 'conflicts_with']);
  assert.deepEqual([...M.FINDING_TEAM_RELATIONS], ['owner', 'affected', 'responsible']);
});
