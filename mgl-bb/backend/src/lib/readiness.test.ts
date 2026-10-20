/**
 * §69 «ХЯНАХАД БЭЛЭН» ХААЛГА + §59 + §66-ИЙН ТЕСТ — `2-7-readiness-and-quality`.
 *
 * Run with:  node --test src/lib/readiness.test.ts
 *
 * ⚠️ `registerHooks` — `src/lib/*.ts` нь өргөтгөлгүй харьцангуй импорт
 *    хэрэглэдэг тул `node --test` дор шууд `import` УНАНА (tsc ногоон
 *    хэвээр).  `bimEvents.test.ts` / `complianceSurface.test.ts`-ийн ЯГ
 *    ИЖИЛ хэв маяг.
 *
 * ⚠️ ЭНЭ ФАЙЛ D1-Д ХҮРЭХГҮЙ.  Маршрутын SQL нь энд тестлэгдэхгүй;
 *    тестлэгдэж байгаа зүйл нь ГЭРЭЭ:
 *      · `UNKNOWN` нь `NOT_READY` рүү ч, `READY` рүү ч НУРААГДАХГҮЙ,
 *      · дүрмийн багц ХООСОН үед (эзний Ш4) хаалга НОГООН БОЛОХГҮЙ,
 *      · багийн тоо АМЬД — литерал БАЙХГҮЙ,
 *      · хэмжигдэхгүй шалгуур ХУВААРЬТ ОРОХГҮЙ,
 *      · хаалганы шошго ГЭРЧИЛГЭЭНИЙ ХЭЛ ХЭРЭГЛЭХГҮЙ (§69-R3).
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

const R = await import('./readiness.ts');
const M = await import('./complianceModel.ts');

type Sev = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

/** Найман тоологдох + хоёр хэмжигдэхгүй — `COMPLETENESS_SPEC`-ийн бодит хэлбэр. */
function completeness(overrides: Record<string, 'unknown' | 'asserted_absent' | 'asserted_present'> = {}) {
  return M.COMPLETENESS_CHECKS.map((check) => ({
    check,
    state: overrides[check] ?? ('asserted_present' as const),
    countable: M.countableCompletenessCheck(check),
  }));
}

/** «Бүх зүйл төгс» суурь — тест бүр ҮҮНЭЭС НЭГ зүйлийг л өөрчилнө. */
function perfectInput() {
  return {
    open_by_severity: R.emptySeverityCounts(),
    uncertain_open: 0,
    completeness: completeness(),
    team_checks: [
      { team_code: 'BA', ran: true },
      { team_code: 'BB', ran: true },
    ],
    ledger: {
      evaluation_state: 'checked' as const,
      expected_but_inapplicable: 0,
      aborted: 0,
      empty: false,
      unpublished_pack_sessions: 0,
      partial_findings: 0,
      stale_findings: 0,
    },
  };
}

const keys = (r: { blockers: ReadonlyArray<{ key: string }> }) => r.blockers.map((b) => b.key);

/* ================================================================== */
/*  1–4. ТОДОРХОЙГҮЙ — «хэмжигдээгүй» нь «сайн» ГЭСЭН ҮГ БИШ           */
/* ================================================================== */

test('1. Бүртгэл ХООСОН → UNKNOWN, NOT_READY БИШ', () => {
  const input = perfectInput();
  input.ledger.empty = true;
  input.ledger.evaluation_state = 'never_run';
  const r = R.computeReadiness(input);
  assert.equal(r.status, 'UNKNOWN');
  assert.notEqual(r.status, 'NOT_READY');
  assert.ok(keys(r).includes('readiness.blocker.ledgerEmpty'));
});

test('2. `expect_applicable` дүрэм хамаарахгүй болов → UNKNOWN', () => {
  const input = perfectInput();
  input.ledger.expected_but_inapplicable = 3;
  const r = R.computeReadiness(input);
  assert.equal(r.status, 'UNKNOWN');
  assert.deepEqual(
    r.blockers.find((b) => b.key === 'readiness.blocker.expectedInapplicable')?.count,
    3,
  );
});

test('3. Дүрэм тасалдсан (`aborted > 0`) → UNKNOWN', () => {
  const input = perfectInput();
  input.ledger.aborted = 1;
  assert.equal(R.computeReadiness(input).status, 'UNKNOWN');
});

test('4. Нийтлэгдээгүй дүрмийн багцаар ажилласан → UNKNOWN', () => {
  const input = perfectInput();
  input.ledger.unpublished_pack_sessions = 2;
  const r = R.computeReadiness(input);
  assert.equal(r.status, 'UNKNOWN');
  assert.ok(keys(r).includes('readiness.blocker.unpublishedPack'));
});

/* ================================================================== */
/*  5–8. БЭЛЭН БИШ                                                     */
/* ================================================================== */

test('5. CRITICAL = 1, бусад бүх зүйл төгс → NOT_READY', () => {
  const input = perfectInput();
  input.open_by_severity.CRITICAL = 1;
  const r = R.computeReadiness(input);
  assert.equal(r.status, 'NOT_READY');
  assert.deepEqual(keys(r), ['readiness.blocker.critical']);
});

test('6. HIGH = 1 → NOT_READY', () => {
  const input = perfectInput();
  input.open_by_severity.HIGH = 1;
  const r = R.computeReadiness(input);
  assert.equal(r.status, 'NOT_READY');
  assert.ok(keys(r).includes('readiness.blocker.high'));
});

test('7. Тодорхойгүй олдвор = 1 → NOT_READY', () => {
  const input = perfectInput();
  input.uncertain_open = 1;
  const r = R.computeReadiness(input);
  assert.equal(r.status, 'NOT_READY');
  assert.ok(keys(r).includes('readiness.blocker.uncertain'));
});

test('8. Багийн шалгалт 1/2 → NOT_READY, blocker count = 1', () => {
  const input = perfectInput();
  input.team_checks = [
    { team_code: 'BA', ran: true },
    { team_code: 'BB', ran: false },
  ];
  const r = R.computeReadiness(input);
  assert.equal(r.status, 'NOT_READY');
  assert.equal(r.team_checks_done, 1);
  assert.equal(r.team_checks_total, 2);
  assert.equal(r.blockers.find((b) => b.key === 'readiness.blocker.teamChecks')?.count, 1);
});

/* ================================================================== */
/*  9–11. БЭЛЭН · ХУВААРЬ                                              */
/* ================================================================== */

test('9. Бүх зүйл цэвэр → READY', () => {
  const r = R.computeReadiness(perfectInput());
  assert.equal(r.status, 'READY');
  assert.deepEqual(r.blockers, []);
  assert.equal(r.completeness_pct, 100);
});

test('10. `countable = false` шалгуур ХУВААРЬТ ОРОХГҮЙ', () => {
  const rows = completeness();
  const c = R.computeCompleteness(rows);
  const unavailable = M.COMPLETENESS_CHECKS.filter((k) => !M.countableCompletenessCheck(k));
  assert.ok(unavailable.length > 0, 'хэмжигдэхгүй шалгуур ЗААВАЛ байх ёстой');
  assert.equal(c.total, M.COMPLETENESS_CHECKS.length - unavailable.length);
  assert.equal(c.pct, 100, 'хэмжигдэхгүй шалгуур хувийг БУУРУУЛАХГҮЙ');
});

test('11. Бүх шалгуур `unknown` → pct = 0, total > 0', () => {
  const rows = M.COMPLETENESS_CHECKS.map((check) => ({
    check,
    state: 'unknown' as const,
    countable: M.countableCompletenessCheck(check),
  }));
  const c = R.computeCompleteness(rows);
  assert.equal(c.pct, 0);
  assert.ok(c.total > 0);
  assert.equal(c.known, 0);
});

/* ================================================================== */
/*  12–13. §66 — БАГЦЫН УХРАЛТ                                         */
/* ================================================================== */

test('12. CRITICAL recall 0.98 → 0.97 нь УХРАЛТ (тэвчээр ТЭГ)', () => {
  const out = R.packRegressed({ CRITICAL: 0.98 }, { CRITICAL: 0.97 }, 0.9, 0.9);
  assert.equal(out.regressed, true);
  assert.ok(out.reasons.some((x) => x.startsWith('CRITICAL')));
});

test('13. MEDIUM recall 0.90 → 0.87 нь УХРАЛТ БИШ (0.05 дотор)', () => {
  const out = R.packRegressed({ MEDIUM: 0.9 }, { MEDIUM: 0.87 }, 0.9, 0.9);
  assert.equal(out.regressed, false);
});

/* ================================================================== */
/*  14. §69-R3 — ГЭРЧИЛГЭЭНИЙ ХЭЛ ХОРИОТОЙ                             */
/* ================================================================== */

test('14. §69-R3: хаалганы шошго гэрчилгээний хэл ХЭРЭГЛЭХГҮЙ', () => {
  const labels = [
    R.checkedLabel('2026-09-01.1', 14),
    R.coverageLabel(12, 9),
    R.coverageLabel(0, 0),
    R.noPackLabel(),
    ...M.SURFACE_STATES.map((s) => M.SURFACE_RENDER[s].labelMn),
    ...M.SURFACE_STATES.map((s) => M.SURFACE_RENDER[s].labelEn),
  ];
  for (const label of labels) {
    const hit = R.containsForbiddenGateWord(label);
    assert.equal(hit, null, `«${hit}» нь «${label}» дотор гарч БОЛОХГҮЙ`);
  }
});

/* ================================================================== */
/*  15–19. ЭЗНИЙ Ш4 — `rules` ХООСОН ШИПНЭ                             */
/* ================================================================== */

test('15. Дүрмийн багц БАЙХГҮЙ + тэг олдвор → UNKNOWN, ХЭЗЭЭ Ч READY БИШ', () => {
  // ⚠️ ЭНЭ БОЛ ЭНЭ ФАЙЛЫН ХАМГИЙН ЧУХАЛ ТЕСТ.  `rules` хүснэгт ХООСОН
  //    шипнэ (эзний шийдвэр Ш4) тул ЭНЭ нь эхний релизийн АНХДАГЧ төлөв.
  //    `READY` буцаах нь инженерт «таны зураг шалгалт давлаа» гэж хэлэх
  //    ба тэр шалгалт ХЭЗЭЭ Ч БОЛООГҮЙ.
  const input = perfectInput();
  input.ledger.evaluation_state = 'no_rule_pack';
  input.ledger.empty = true;
  input.team_checks = [];
  const r = R.computeReadiness(input);
  assert.equal(r.status, 'UNKNOWN');
  assert.notEqual(r.status, 'READY');
  assert.ok(keys(r).includes('readiness.blocker.noRulePack'));
  assert.ok(keys(r).includes('readiness.blocker.noTeamPack'));
});

test('16. Багцтай баг ТЭГ (MGMT/EZ/GT л оролцсон) → UNKNOWN, «0/0» гэж НОГООН БОЛОХГҮЙ', () => {
  const input = perfectInput();
  input.team_checks = [];
  const r = R.computeReadiness(input);
  assert.equal(r.status, 'UNKNOWN');
  assert.equal(r.team_checks_total, 0);
  assert.ok(keys(r).includes('readiness.blocker.noTeamPack'));
});

test('17. Танихгүй `severity` нь ЧИМЭЭГҮЙ АЛГА БОЛОХГҮЙ → UNKNOWN', () => {
  const fold = R.foldSeverityRows([
    { severity: 'HIGH', n: 2 },
    { severity: 'КРИТИК', n: 5 },
    { severity: null, n: 1 },
  ]);
  assert.equal(fold.counts.HIGH, 2);
  assert.equal(fold.unknownSeverity, 6);

  const input = perfectInput();
  input.unknown_severity_open = fold.unknownSeverity;
  assert.equal(R.computeReadiness(input).status, 'UNKNOWN');
});

test('18. Багийн хуваарь нь АМЬД — литерал тоо БАЙХГҮЙ', () => {
  // Баг нэмэхэд хуваарь ШУУД өснө; кодод 7 ч, 8 ч, 9 ч гэсэн тоо байхгүй.
  for (const size of [1, 2, 5, 9, 11]) {
    const input = perfectInput();
    input.team_checks = Array.from({ length: size }, (_, i) => ({
      team_code: `T${i}`,
      ran: true,
    }));
    const r = R.computeReadiness(input);
    assert.equal(r.team_checks_total, size);
    assert.equal(r.status, 'READY');
  }
});

test('19. Нэг шалгуур `unknown` бол босго давахгүй → NOT_READY', () => {
  const input = perfectInput();
  input.completeness = completeness({ rooms: 'unknown' });
  const r = R.computeReadiness(input);
  assert.equal(r.status, 'NOT_READY');
  assert.ok(r.completeness_pct < R.READY_MIN_COMPLETENESS_PCT);
  assert.equal(r.blockers.find((b) => b.key === 'readiness.blocker.completeness')?.count, 1);
});

/* ================================================================== */
/*  20–22. §59 — ГУРВАН ТӨЛӨВ ба ХЭМЖИГДЭЭГҮЙ                          */
/* ================================================================== */

test('20. `asserted_absent` нь «МЭДЭГДСЭН» — `unknown`-той НЭГТГЭГДЭХГҮЙ', () => {
  // `AccordionForm.tsx:41-49`: чагтлаагүй нүд = «ХЭЛЭЭГҮЙ», «үгүй» БИШ.
  assert.equal(M.completenessStateOfFlag(false), 'asserted_absent');
  assert.equal(M.completenessStateOfFlag(true), 'asserted_present');
  assert.equal(M.completenessStateOfFlag(null), 'unknown');
  assert.equal(M.completenessStateOfFlag(undefined), 'unknown');
  assert.equal(M.completenessStateOfFlag(''), 'unknown');
  assert.equal(M.completenessStateOfFlag([]), 'asserted_absent');

  const input = perfectInput();
  input.completeness = completeness({ rooms: 'asserted_absent' });
  const r = R.computeReadiness(input);
  assert.equal(r.completeness_pct, 100, '«үгүй гэж хэлсэн» нь бүрэн гүйцэд хариулт');
  assert.equal(r.status, 'READY');
});

test('21. ХЭМЖИГДЭЭГҮЙ тоолуур нь `asserted_absent` БИШ', () => {
  // «Тоо хэмжээ илгээгээгүй» ба «өрөө байхгүй» хоёр ӨӨР.
  assert.equal(M.completenessStateOfCount(0, false), 'unknown');
  assert.equal(M.completenessStateOfCount(0, true), 'asserted_absent');
  assert.equal(M.completenessStateOfCount(5, true), 'asserted_present');
});

test('22. Хэмжих боломжтой шалгуур ҮГҮЙ → UNKNOWN, «0%» гэж NOT_READY БИШ', () => {
  const input = perfectInput();
  input.completeness = M.COMPLETENESS_CHECKS.filter((k) => !M.countableCompletenessCheck(k)).map(
    (check) => ({ check, state: 'unknown' as const, countable: false }),
  );
  const r = R.computeReadiness(input);
  assert.equal(r.status, 'UNKNOWN');
  assert.ok(keys(r).includes('readiness.blocker.completenessUnmeasurable'));
});

/* ================================================================== */
/*  23–25. §66 — ХЭМЖИГДЭЭГҮЙ нь ТЭГ БИШ                               */
/* ================================================================== */

test('23. Хуваарь тэг үед харьцаа нь `null`, `0` БИШ', () => {
  // `run_golden.py:315-316` — хоосон хуваарь нь БЛОКЛОНО, «0%» гэж
  // харуулбал хэмжигдээгүй байдал ТӨГС ГҮЙЦЭТГЭЛ мэт уншигдана.
  const r = R.rateOf(0, 0);
  assert.equal(r.value, null);
  assert.equal(r.measured, false);

  const measured = R.rateOf(3, 12);
  assert.equal(measured.measured, true);
  assert.equal(measured.value, 0.25);
});

test('24. `fpRates` нь ноцтой байдал бүрд ТУСДАА, хэмжигдээгүйг ялгана', () => {
  const emitted = R.emptySeverityCounts();
  const fp = R.emptySeverityCounts();
  emitted.HIGH = 10;
  fp.HIGH = 4;
  const rates = R.fpRates(emitted, fp);
  assert.equal(rates.HIGH.value, 0.4);
  assert.equal(rates.CRITICAL.measured, false, 'CRITICAL олдвор гараагүй → хэмжигдээгүй');
  assert.equal(rates.CRITICAL.value, null);
});

test('25. `recallOf` — хүлээгдэж буй кейс байхгүй бол хэмжигдээгүй', () => {
  assert.equal(R.recallOf(0, 0).measured, false);
  const r = R.recallOf(10, 2);
  assert.equal(r.measured, true);
  assert.equal(r.value, 0.8);
});

test('26. `packRegressed` — хэмжигдээгүй хуваарийг УНАЛТ гэж ТООЦОХГҮЙ', () => {
  // `run_golden.py:315`-ийн философи: блоклох ажил нь ТЭНД, энд БИШ.
  const out = R.packRegressed({ CRITICAL: 0.99 }, {}, 0.9, 0.9);
  assert.equal(out.regressed, false);
  const out2 = R.packRegressed({}, { CRITICAL: 0.1 }, 0.9, 0.9);
  assert.equal(out2.regressed, false);
});

test('27. Нийт recall 0.02-оос илүү буурвал багц ГАРАХГҮЙ', () => {
  assert.equal(R.packRegressed({}, {}, 0.9, 0.87).regressed, true);
  assert.equal(R.packRegressed({}, {}, 0.9, 0.885).regressed, false);
});

/* ================================================================== */
/*  28. §59-ийн ТОЛЬ нь ХААЛТТАЙ БАГЦ                                  */
/* ================================================================== */

test('28. `COMPLETENESS_SPEC` нь арван шалгуурыг БҮРЭН хамарна', () => {
  assert.equal(M.COMPLETENESS_CHECKS.length, 10);
  for (const check of M.COMPLETENESS_CHECKS) {
    const spec = M.COMPLETENESS_SPEC[check];
    assert.ok(spec, `${check} нь тольд БАЙХГҮЙ`);
    assert.ok(M.isIssueClass(spec.issue_class));
    assert.ok(M.isSeverity(spec.severity));
    assert.ok(M.COMPLETENESS_SOURCES.includes(spec.source));
    // ⚠️ `unavailable` бол ЯАГААДЫГ ЗААВАЛ хэлнэ — чимээгүй нуугдахгүй.
    if (spec.source === 'unavailable') {
      assert.ok(
        (spec.blocked_reason ?? '').length > 0,
        `${check} нь хэмжигдэхгүй боловч шалтгаангүй`,
      );
    }
    // §69-R3 — толины шошго ч гэрчилгээний хэл хэрэглэхгүй.
    assert.equal(R.containsForbiddenGateWord(spec.label_mn), null);
    assert.equal(R.containsForbiddenGateWord(spec.label_en), null);
  }
});

/* ================================================================== */
/*  29–35. F1 — `partial` ТӨЛӨВ ХАЯГДАЖ БАЙСАН (ЧИМЭЭГҮЙ НОГООН)       */
/*                                                                     */
/*  ⚠️ ЭНЭ БЛОК НЬ ХЭМЖИГДСЭН УНАЛТЫГ барина: `evaluationStateOf` нь    */
/*     `aborted > 0 || partialFindings > 0 || staleFindings > 0` үед    */
/*     `partial` буцаадаг атлаа `computeReadiness` нь ЗӨВХӨН            */
/*     `no_rule_pack` ба `never_run`-ыг уншдаг байв.  Үр дүн:           */
/*     `evaluation_state: 'partial'` + бусад бүх зүйл цэвэр →           */
/*     `{"status":"READY","blockers":[]}`.                             */
/*     `2-5`-ын `surfaceStateOf` нь ЯГ ТЭР баримтыг «Шалгалт            */
/*     хэсэгчилсэн» гэж ҮНЭНЭЭР харуулж байсан — хоёр гадаргуу нэг      */
/*     баримтын талаар ЗӨРЧИЛДӨЖ байв.                                 */
/* ================================================================== */

test('29. F1: `evaluation_state = partial` + бусад БҮХ ЗҮЙЛ цэвэр → READY БОЛОХГҮЙ', () => {
  const input = perfectInput();
  input.ledger.evaluation_state = 'partial';
  const r = R.computeReadiness(input);
  assert.notEqual(r.status, 'READY', '`partial` нь ХЭЗЭЭ Ч ногоон болохгүй');
  assert.equal(r.status, 'UNKNOWN', 'нотолгоо БАЙГАА ч найдваргүй → UNKNOWN');
  assert.ok(r.blockers.length > 0, '`blockers[]` ХООСОН үлдэж БОЛОХГҮЙ');
  assert.ok(keys(r).includes('readiness.blocker.partialEvaluation'));
});

test('30. F1: БҮХ нотолгоо ХУУЧИРСАН гурван CRITICAL → UNKNOWN, тоо нь ХАДГАЛАГДАНА', () => {
  // Хэмжсэн хувилбар: 3 CRITICAL → инженер загвараа заслаа →
  // `POST /findings/stale` гурвуулангийн `stale_at`-ыг тавина →
  // маршрутын `open_by_severity` нь ТЭГ болно.  Тэр ТЭГ нь «цэвэр» БИШ.
  const input = perfectInput();
  input.ledger.evaluation_state = 'partial';
  input.ledger.stale_findings = 3;
  const r = R.computeReadiness(input);
  assert.equal(r.status, 'UNKNOWN');
  assert.equal(r.blockers.find((b) => b.key === 'readiness.blocker.staleFindings')?.count, 3);
  // ⚠️ enum нь ТООГ хаяхгүй — «яагаад» гэдэгт ТООТОЙ хариулна.
  assert.ok(!keys(r).includes('readiness.blocker.partialEvaluation'), 'тодорхой шалтгаан бий бол ерөнхий салаа ХЭРЭГГҮЙ');
});

test('31. F1: `coverage = partial` олдвор → UNKNOWN', () => {
  const input = perfectInput();
  input.ledger.evaluation_state = 'partial';
  input.ledger.partial_findings = 7;
  const r = R.computeReadiness(input);
  assert.equal(r.status, 'UNKNOWN');
  assert.equal(r.blockers.find((b) => b.key === 'readiness.blocker.partialCoverage')?.count, 7);
});

test('32. F1: тоолуур нь `checked` төлөвөөс ҮЛ ХАМААРАН ХААНА', () => {
  // Хамгаалалт: `evaluation_state` ба тоолуур ЗӨРЧИЛДВӨЛ ч хуучирсан
  // нотолгоо нь хаалгыг НЭЭХГҮЙ.
  const input = perfectInput();
  input.ledger.stale_findings = 1;
  assert.equal(R.computeReadiness(input).status, 'UNKNOWN');

  const input2 = perfectInput();
  input2.ledger.partial_findings = 1;
  assert.equal(R.computeReadiness(input2).status, 'UNKNOWN');
});

test('33. F1: `EvaluationState`-ийн ДӨРВӨН утга бүр хариулттай', () => {
  // ⚠️ Энэ тест нь `EVALUATION_STATES`-д ШИНЭ утга нэмэгдэхэд УНАНА —
  //    зориуд.  Шинэ төлөв нь хаалганы салаагүйгээр орж ирвэл тэр нь
  //    анхдагчаар `READY` руу унана.
  const seen: Record<string, string> = {};
  for (const state of M.EVALUATION_STATES) {
    const input = perfectInput();
    input.ledger.evaluation_state = state;
    // `never_run` нь бүртгэл хоосон гэсэн үг — түүнийг ҮНЭНЭЭР загварчилъя.
    if (state === 'never_run' || state === 'no_rule_pack') input.ledger.empty = true;
    seen[state] = R.computeReadiness(input).status;
  }
  assert.equal(seen['no_rule_pack'], 'UNKNOWN');
  assert.equal(seen['never_run'], 'UNKNOWN');
  assert.equal(seen['partial'], 'UNKNOWN');
  assert.equal(seen['checked'], 'READY', 'ЗӨВХӨН `checked` нь ногоон болох эрхтэй');
  assert.equal(M.EVALUATION_STATES.length, 4, 'шинэ төлөв нэмэгдвэл хаалганы салаа НЭМ');
});

test('34. F1: `evaluationStateOf` ба хаалга НЭГ баримт дээр ЗӨРЧИЛДӨХГҮЙ', () => {
  // `2-3`-ын функц болон `2-7`-ын хаалгыг ЯГ ИЖИЛ оролтоор жолоодоно.
  const cases = [
    { partialFindings: 0, staleFindings: 3, aborted: 0 },
    { partialFindings: 2, staleFindings: 0, aborted: 0 },
    { partialFindings: 0, staleFindings: 0, aborted: 1 },
  ];
  for (const c of cases) {
    const state = M.evaluationStateOf({
      rulesPublished: 12,
      packsPublished: 1,
      ledgerRows: 40,
      ...c,
    });
    assert.equal(state, 'partial', 'урьдчилсан нөхцөл');
    const input = perfectInput();
    input.ledger.evaluation_state = state;
    input.ledger.partial_findings = c.partialFindings;
    input.ledger.stale_findings = c.staleFindings;
    input.ledger.aborted = c.aborted;
    const r = R.computeReadiness(input);
    assert.equal(r.status, 'UNKNOWN', `${JSON.stringify(c)} нь ногоон болов`);
    assert.ok(r.blockers.length > 0);
  }
});

test('35. F1: хуучирсан хаалганы шошго ГЭРЧИЛГЭЭНИЙ хэл хэрэглэхгүй', () => {
  // §69-R3 — шинэ blocker түлхүүрүүд ч дүрмээс гарахгүй.
  const input = perfectInput();
  input.ledger.evaluation_state = 'partial';
  input.ledger.stale_findings = 2;
  input.ledger.partial_findings = 1;
  for (const b of R.computeReadiness(input).blockers) {
    assert.equal(R.containsForbiddenGateWord(b.key), null);
    assert.ok(b.key.startsWith('readiness.blocker.'), 'түлхүүр нь i18n, чөлөөт бичвэр БИШ');
    assert.ok(Number.isFinite(b.count));
  }
});

/* ================================================================== */
/*  36–38. АУДИТ 2026-08-31 — «ШАЛГАВ» ГЭДЭГ НЬ БҮРТГЭЛИЙН ФУНКЦ,      */
/*         БАГЦ ОРШИХЫН ФУНКЦ БИШ.                                     */
/*                                                                     */
/*  ⚠️ ОЛДСОН АЛДАА.  `routes/compliance.ts`-ийн бэлэн байдлын карт    */
/*     `checked_label`-ыг `pack ? checkedLabel(...) : noPackLabel()`   */
/*     гэж сонгодог байв — өөрөөр хэлбэл НИЙТЛЭГДСЭН БАГЦ ОРШИХ нь     */
/*     «... N дүрмээр шалгав» гэсэн ӨНГӨРСӨН ЦАГИЙН БАТАЛГАА бичих     */
/*     ХАНГАЛТТАЙ нөхцөл байлаа.  Бодит SQL дээр хэмжсэн: `rules` +    */
/*     `rule_pack_versions` дүүрэн, `rule_run_ledger` ХООСОН төсөл     */
/*     (`evaluation_state = 'never_run'`) дээр карт                    */
/*     «Дүрмийн багц 2026-09-01.1, 1 дүрмээр шалгав» гэж хэвлэдэг      */
/*     байв.  `status` нь `UNKNOWN` байсан нь ХАМГААЛАЛТ БИШ:          */
/*     `ReadinessPanel.tsx:227` нь тэр МӨРИЙГ ШУУД хэвлэдэг тул        */
/*     хэрэглэгчийн уншсан өгүүлбэр нь ХУДАЛ баталгаа байсан.          */
/* ================================================================== */

test('36. АУДИТ: `notRunLabel` нь «шалгав» гэж ХЭЗЭЭ Ч бичихгүй', () => {
  const s = R.notRunLabel('2026-09-01.1', 14);
  assert.ok(!/шалгав/.test(s), `«шалгав» гэсэн баталгаа гарав: ${s}`);
  assert.equal(R.containsForbiddenGateWord(s), null);
  // Багцын хувилбар ба тоо нь ХЭВЭЭР харагдана — инженер юу татагдсаныг мэдэх ёстой.
  assert.ok(s.includes('2026-09-01.1'), 'багцын хувилбар алга болов');
  assert.ok(s.includes('14'), 'дүрмийн тоо алга болов');
  // Ажиллаагүй гэдгийг ИЛ хэлнэ.
  assert.ok(/ажиллаагүй/.test(s), `«ажиллаагүй» гэсэн ил мэдэгдэл алга: ${s}`);
});

test('37. АУДИТ: `checkedLabel` ба `notRunLabel` нь ХЭЗЭЭ Ч ижил мөр өгөхгүй', () => {
  // Хоёр төлөв ЯЛГАГДАХ ЁСТОЙ — эс бөгөөс засвар нь гоо сайхны өөрчлөлт л болно.
  assert.notEqual(R.checkedLabel('2026-09-01.1', 14), R.notRunLabel('2026-09-01.1', 14));
  // `checkedLabel` нь ЖИНХЭНЭ шалгалтын мөр тул «шалгав» гэж бичих ЭРХТЭЙ.
  assert.ok(/шалгав/.test(R.checkedLabel('2026-09-01.1', 14)));
  // ГУРВАН шошго ГУРВУУЛАА ялгаатай (багцгүй / ажиллаагүй / шалгасан).
  const three = new Set([
    R.noPackLabel(),
    R.notRunLabel('2026-09-01.1', 14),
    R.checkedLabel('2026-09-01.1', 14),
  ]);
  assert.equal(three.size, 3, 'хоёр төлөв нэг мөр хуваалцаж байна');
});

test('38. АУДИТ: `coverageNotMeasuredLabel` нь ШИЙДВЭР ГАРСАН мэт уншигдахгүй', () => {
  const s = R.coverageNotMeasuredLabel();
  assert.equal(R.containsForbiddenGateWord(s), null);
  // `coverageLabel(0, 0)` нь «хамаарах дүрэм ОЛДСОНГҮЙ» — ХАЙСАН, ОЛООГҮЙ
  // гэж уншигдана.  Юу ч ажиллаагүй үед тэр нь ХУДАЛ: бид ХЭМЖЭЭГҮЙ.
  assert.notEqual(s, R.coverageLabel(0, 0), 'хоёр өөр баримт нэг мөр хуваалцав');
  assert.ok(!/олдсонгүй/.test(s), `«олдсонгүй» нь хайлт хийсэн гэж уншигдана: ${s}`);
  assert.ok(/хэмжигдээгүй/.test(s), `«хэмжигдээгүй» гэсэн ил мэдэгдэл алга: ${s}`);
});
