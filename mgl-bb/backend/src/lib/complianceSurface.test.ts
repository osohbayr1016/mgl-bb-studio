/**
 * ДҮГНЭЛТИЙН ГАДАРГУУГИЙН ТЕСТ — `2-5-finding-surface` §3.1 / §65 / §67 /
 * §68 / §77 / §80.
 *
 * Run with:  node --test src/lib/complianceSurface.test.ts
 *
 * ⚠️ `registerHooks` — `src/lib/*.ts` нь өргөтгөлгүй харьцангуй импорт
 *    хэрэглэдэг тул `node --test` дор шууд `import` УНАНА (tsc ногоон
 *    хэвээр).  `bimEvents.test.ts` / `complianceLifecycle.test.ts`-ийн ЯГ
 *    ИЖИЛ хэв маяг.
 *
 * ⚠️ ЭНЭ ФАЙЛ D1-Д ХҮРЭХГҮЙ.  Маршрутын SQL нь энд тестлэгдэхгүй;
 *    тестлэгдэж байгаа зүйл нь ГЭРЭЭ:
 *      · нотолгооны түвшин нь ЯМАР мэдэгдэл гаргахыг зөвшөөрөх вэ (§65),
 *      · ЭРЭМБЭ нь ТАСЛАЛТААС ӨМНӨ болдог эсэх (§67 + `ChangeReport.cs:56-60`),
 *      · үндсэн шалтгааны граф мөчлөгт УНАХГҮЙ эсэх (§77),
 *      · хүчингүй болголтын зургаан төрөл НЭГТГЭГДЭЭГҮЙ эсэх (§66/§68),
 *      · «харагдахгүй» ба «юу ч алга» хоёр ЯЛГААТАЙ эсэх (§80 + эзний Ш4).
 *    Сүүлийнх нь релиз N-ий ХАМГИЙН МУУ ХУДАЛ мэдэгдлээс хамгаалах харуул.
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
const A = await import('./complianceAuthority.ts');

/* ================================================================== */
/*  1. §65 — НОТОЛГООНЫ ТҮВШИН БОЛ ДӨРӨВ ДЭХ ТЭНХЛЭГ                   */
/* ================================================================== */

test('EVIDENCE_RENDER нь ТАВАН түвшин БҮРИЙГ хамарна (TOTAL Record)', () => {
  assert.equal(Object.keys(M.EVIDENCE_RENDER).length, M.EVIDENCE_LEVELS.length);
  for (const level of M.EVIDENCE_LEVELS) {
    assert.ok(M.EVIDENCE_RENDER[level], `${level} дутуу`);
    assert.ok(M.EVIDENCE_RENDER[level].labelMn.length > 0);
    assert.ok(M.EVIDENCE_RENDER[level].labelEn.length > 0);
  }
});

test('нотолгоогүй түвшин нь НОРМЫН ЭШЛЭЛ хэвлэх эрхгүй', () => {
  // §65 (v2:2158) — «A model-generated explanation without evidence must
  // never be presented as a verified regulatory fact.»
  assert.equal(M.EVIDENCE_RENDER.AI_INFERRED.citation, false);
  assert.equal(M.EVIDENCE_RENDER.UNKNOWN.citation, false);
  assert.equal(M.EVIDENCE_RENDER.MODEL_DERIVED.citation, false);
  assert.equal(M.EVIDENCE_RENDER.RULE_BACKED.citation, true);
  assert.equal(M.EVIDENCE_RENDER.HUMAN_VERIFIED.citation, true);
});

test('AI-ийн таамаг нь бэлэн байдалд ТООЛОГДОХГҮЙ, сургалтад ОРОХГҮЙ', () => {
  assert.equal(M.countsForReadiness('AI_INFERRED'), false);
  assert.equal(M.countsForReadiness('UNKNOWN'), false);
  assert.equal(M.EVIDENCE_RENDER.AI_INFERRED.trainingCandidate, false);
  // Загвараас гаргасан шалгуур нь бэлэн байдалд ТООЛОГДОНО (тэр нь бодит
  // геометрийн хэмжилт), гэвч СУРГАЛТАД орохгүй — эх сурвалж нь дүрэм БИШ.
  assert.equal(M.countsForReadiness('MODEL_DERIVED'), true);
  assert.equal(M.EVIDENCE_RENDER.MODEL_DERIVED.trainingCandidate, false);
});

test('clampByEvidence нь ЗӨВХӨН ХАРАГДАЦЫГ сулруулна, түүхийг БИШ', () => {
  const strong = M.clampByEvidence({ verdict: 'VIOLATION', evidenceLevel: 'RULE_BACKED' });
  assert.equal(strong.verdict, 'VIOLATION');
  assert.equal(strong.clamped, false);

  // MODEL_DERIVED нь VIOLATION гэж хэлэх эрхгүй — «дотоод шалгуур».
  const derived = M.clampByEvidence({ verdict: 'VIOLATION', evidenceLevel: 'MODEL_DERIVED' });
  assert.equal(derived.verdict, 'WARNING');
  assert.equal(derived.rawVerdict, 'VIOLATION', 'ЖИНХЭНЭ дүгнэлт ҮРГЭЛЖ буцна');
  assert.equal(derived.clamped, true);

  // AI-ийн таамаг нь VIOLATION ч, PASS ч гэж хэлэх эрхгүй: «тэнцлээ» гэдэг
  // нь БАС мэдэгдэл бөгөөд нотолгоогүй үед ХУДАЛ БАТАЛГАА болно.
  assert.equal(M.clampByEvidence({ verdict: 'VIOLATION', evidenceLevel: 'AI_INFERRED' }).verdict, 'UNCERTAIN');
  assert.equal(M.clampByEvidence({ verdict: 'PASS', evidenceLevel: 'AI_INFERRED' }).verdict, 'UNCERTAIN');
  assert.equal(M.clampByEvidence({ verdict: 'PASS', evidenceLevel: 'UNKNOWN' }).verdict, 'UNCERTAIN');

  // MODEL_DERIVED дээр PASS нь ХЭВЭЭР — тэр нь бодит хэмжилт.
  assert.equal(M.clampByEvidence({ verdict: 'PASS', evidenceLevel: 'MODEL_DERIVED' }).verdict, 'PASS');
});

test('VERDICT_CLAIM_STRENGTH нь ДӨРВӨН дүгнэлт БҮРИЙГ хамарна', () => {
  for (const v of M.VERDICTS) {
    assert.equal(typeof M.VERDICT_CLAIM_STRENGTH[v], 'number', `${v} дутуу`);
  }
  assert.ok(M.VERDICT_CLAIM_STRENGTH.UNCERTAIN < M.VERDICT_CLAIM_STRENGTH.PASS);
  assert.ok(M.VERDICT_CLAIM_STRENGTH.PASS < M.VERDICT_CLAIM_STRENGTH.WARNING);
  assert.ok(M.VERDICT_CLAIM_STRENGTH.WARNING < M.VERDICT_CLAIM_STRENGTH.VIOLATION);
});

test('нотолгооны түвшин нь source_type / provenance-тэй НЭГТГЭГДЭЭГҮЙ', () => {
  // 0215-ийн `source_type` дээр `RULE_BACKED` / `MODEL_DERIVED` /
  // `AI_INFERRED` БАЙХГҮЙ — тэднийг тэр CHECK рүү оруулах нь INSERT-ийг
  // «CHECK constraint failed» болгоно.
  const sourceTypes = ['HUMAN', 'HUMAN_CORRECTED', 'HUMAN_VERIFIED', 'RULE_VERIFIED',
    'SYNTHETIC', 'AI_GENERATED', 'IMPORTED', 'UNKNOWN'];
  const overlap = M.EVIDENCE_LEVELS.filter((l) => sourceTypes.includes(l));
  assert.deepEqual(overlap, ['HUMAN_VERIFIED', 'UNKNOWN'],
    'Давхцаж БОЛОХ нь ЗӨВХӨН энэ хоёр — өөр нэр давхцвал хоёр таксономи нийлж эхэлсэн гэсэн үг');
});

/* ================================================================== */
/*  2. §67 — ЭРЭМБЭ ХИЙГЭЭД Л ТАСЛАНА                                  */
/* ================================================================== */

test('SEVERITY_DISPLAY_RANK нь SEVERITY_RANK-ийн ЯГ ЭСРЭГ дараалал', () => {
  // ⚠️ Хоёр тогтмол ЗОРИУД эсрэг чиглэлтэй (нэг нь ОНОО, нөгөө нь ИНДЕКС).
  //    Аль нэгийг нь дангаар нь өөрчлөх нь жагсаалтыг ЧИМЭЭГҮЙ УРВУУЛНА.
  const byScore = [...M.SEVERITIES].sort((a, b) => M.SEVERITY_RANK[b] - M.SEVERITY_RANK[a]);
  const byIndex = [...M.SEVERITIES].sort(
    (a, b) => M.SEVERITY_DISPLAY_RANK[a] - M.SEVERITY_DISPLAY_RANK[b],
  );
  assert.deepEqual(byIndex, byScore);
  assert.equal(M.SEVERITY_DISPLAY_RANK.CRITICAL, 0, 'CRITICAL нь ҮРГЭЛЖ ЭХЭНД');
});

interface Row {
  id: number;
  dedupKey: string;
  severity: (typeof M.SEVERITIES)[number];
  rootId: number | null;
  isStale: boolean;
  detectedAtMs: number;
}

const row = (over: Partial<Row> & { id: number }): Row => ({
  dedupKey: `k${over.id}`,
  severity: 'MEDIUM',
  rootId: null,
  isStale: false,
  detectedAtMs: 1000,
  ...over,
});

test('CRITICAL нь INFO-гоос ӨМНӨ, ЗАГВАРЫН СҮҮЛД ирсэн ч', () => {
  const rows = [row({ id: 1, severity: 'INFO' }), row({ id: 2, severity: 'CRITICAL' })];
  const sorted = [...rows].sort(M.compareFindingsForDisplay);
  assert.equal(sorted[0]!.id, 2);
});

test('ижил хүнд байдалд СҮҮЛД илрүүлсэн нь ДЭЭР, тэнцвэл id нь ТОГТВОРТОЙ таслагч', () => {
  const rows = [
    row({ id: 1, detectedAtMs: 100 }),
    row({ id: 2, detectedAtMs: 900 }),
    row({ id: 3, detectedAtMs: 900 }),
  ];
  const sorted = [...rows].sort(M.compareFindingsForDisplay);
  assert.deepEqual(sorted.map((r) => r.id), [2, 3, 1]);
});

test('хуучирсан мөр нь ижил хүнд байдалд ДООР', () => {
  const rows = [row({ id: 1, isStale: true, detectedAtMs: 9000 }), row({ id: 2, isStale: false })];
  const sorted = [...rows].sort(M.compareFindingsForDisplay);
  assert.equal(sorted[0]!.id, 2, 'хуучирсан нь ШИНЭ байсан ч ДООР — тэр нь ОДООГИЙН дүгнэлт БИШ');
});

test('ЭРЭМБЭЛЭХЭЭС ӨМНӨ ТАСЛАХГҮЙ — сүүлд ирсэн ГАНЦ CRITICAL ХАРАГДАНА', () => {
  // ⚠️ ЭНЭ БОЛ ЭНЭ ФАЙЛЫН ОРШИН БАЙХ ШАЛТГААН (`ChangeReport.cs:56-60`).
  //    100 мөр, төсөв 40, CRITICAL нь ХАМГИЙН СҮҮЛД.
  const rows: Row[] = [];
  for (let i = 1; i <= 99; i += 1) rows.push(row({ id: i, severity: 'LOW', detectedAtMs: 1000 + i }));
  rows.push(row({ id: 100, severity: 'CRITICAL', detectedAtMs: 1 }));

  const grouped = M.groupByRootCause(rows, [], { maxGroups: 40, maxConsequences: 9 });
  assert.equal(grouped.groups.length, 40);
  assert.equal(grouped.truncated, 60, 'таслагдсаныг ИЛ хэлнэ');
  assert.equal(grouped.groups[0]!.primary.id, 100, 'CRITICAL нь эрэмбийн ДАРАА таслагдсан ч үлдэнэ');
});

/* ================================================================== */
/*  3. §77 — ҮНДСЭН ШАЛТГААНЫ ГРАФ                                     */
/* ================================================================== */

const causes = (from: number, to: number) => ({ from, to, kind: 'causes' as const });

test('resolveRootCause нь causes ирмэгийн дээгүүр ДЭЭШ явна', () => {
  const r = M.resolveRootCause(3, [causes(1, 2), causes(2, 3)]);
  assert.equal(r.rootId, 1);
  assert.deepEqual(r.chain, [2, 1]);
  assert.equal(r.cyclic, false);
});

test('МӨЧЛӨГ нь МӨНХ ДАВТАЛТ ҮҮСГЭХГҮЙ', () => {
  // `finding_edges` дээр мөчлөгийг хориглосон CHECK БАЙХГҮЙ (0225) —
  // хамгаалалтгүй бол Worker CPU хязгаараар үхнэ.
  const r = M.resolveRootCause(1, [causes(1, 2), causes(2, 1)]);
  assert.equal(r.cyclic, true);
  assert.ok(r.rootId === 1 || r.rootId === 2);
});

test('олон эцэгтэй үед ХАМГИЙН БАГА id — ТОГТВОРТОЙ сонголт', () => {
  const a = M.resolveRootCause(9, [causes(5, 9), causes(2, 9)]);
  const b = M.resolveRootCause(9, [causes(2, 9), causes(5, 9)]);
  assert.equal(a.rootId, 2);
  assert.equal(b.rootId, 2, 'ирмэгийн дараалал өөрчлөгдөхөд хариу ХӨДӨЛӨХГҮЙ');
});

test('нэг үндэс + гурван дагавар нь НЭГ бүлэг', () => {
  const rows = [
    row({ id: 1, severity: 'HIGH' }),
    row({ id: 2, rootId: 1 }),
    row({ id: 3, rootId: 1 }),
    row({ id: 4, rootId: 1 }),
  ];
  const edges = [causes(1, 2), causes(1, 3), causes(1, 4)];
  const g = M.groupByRootCause(rows, edges, { maxGroups: 40, maxConsequences: 9 });
  assert.equal(g.groups.length, 1);
  assert.equal(g.groups[0]!.primary.id, 1);
  assert.equal(g.groups[0]!.consequences.length, 3);
  assert.equal(g.groups[0]!.promoted, false);
});

test('20 дагавар нь 9 харагдаж, БҮТЭН тоо нь ИЛ үлдэнэ', () => {
  const rows: Row[] = [row({ id: 1, severity: 'HIGH' })];
  const edges = [];
  for (let i = 2; i <= 21; i += 1) {
    rows.push(row({ id: i, rootId: 1 }));
    edges.push(causes(1, i));
  }
  const g = M.groupByRootCause(rows, edges, { maxGroups: 40, maxConsequences: 9 });
  assert.equal(g.groups.length, 1);
  assert.equal(g.groups[0]!.consequences.length, 9);
  assert.equal(g.groups[0]!.consequenceTotal, 20, 'нугалахаас ӨМНӨХ бүтэн тоо');
});

test('үндэс нь ХАРАГДАХГҮЙ бол бүлэг АЛГА БОЛОХГҮЙ — дагавар өргөмжлөгдөнө', () => {
  // Үндэс (id 1) нь жагсаалтад БАЙХГҮЙ: хаагдсан, эсвэл өөр хүн илрүүлсэн.
  const rows = [row({ id: 2, rootId: 1, severity: 'HIGH' }), row({ id: 3, rootId: 1 })];
  const edges = [causes(1, 2), causes(1, 3)];
  const g = M.groupByRootCause(rows, edges, { maxGroups: 40, maxConsequences: 9 });
  // ⚠️ БҮЛЭГ ЗАДРАХГҮЙ: хоёр дагавар нь ижил (үл харагдах) үндэсний доор
  //    НЭГ бүлэг хэвээр — задалбал инженер НЭГ асуудлыг ХОЁР удаа засна.
  assert.equal(g.groups.length, 1);
  assert.equal(g.groups[0]!.primary.id, 2, 'хамгийн хүнд дагавар нь ТҮР толгой болно');
  assert.equal(g.groups[0]!.consequences.length, 1);
  assert.equal(g.groups[0]!.consequenceTotal, 1);
  assert.equal(g.groups[0]!.promoted, true, '«Үндсэн шалтгаан» гэж бичих ЭРХГҮЙ гэдгийг ил хэлнэ');
});

/* ================================================================== */
/*  4. §68 — ХҮЧИНГҮЙ БОЛГОЛТ                                          */
/* ================================================================== */

test('OVERRIDE_KINDS нь ЗУРГААН утга ба OVERRIDE_MEANING нь TOTAL', () => {
  assert.equal(M.OVERRIDE_KINDS.length, 6);
  for (const kind of M.OVERRIDE_KINDS) assert.ok(M.OVERRIDE_MEANING[kind], `${kind} дутуу`);
});

test('ХУДАЛ ДОХИО ба ХҮЛЭЭН ЗӨВШӨӨРСӨН ЭРСДЭЛ нь ХЭЗЭЭ Ч нэг утга БИШ', () => {
  // Нэгтгэвэл §66-ийн худал дохионы хувь хэмжигдэхээ болино.
  assert.equal(M.OVERRIDE_MEANING.FALSE_POSITIVE.falseSignal, true);
  assert.equal(M.OVERRIDE_MEANING.RULE_WRONG.falseSignal, true);
  assert.equal(M.OVERRIDE_MEANING.ACCEPTED_RISK.falseSignal, false);
  assert.equal(M.OVERRIDE_MEANING.NOT_APPLICABLE_HERE.falseSignal, false);
  // Мэдсээр байж давсан зөрчил нь ЗӨРЧИЛ ХЭВЭЭР — эс бөгөөс §69-ийн хаалгыг
  // «бүгдийг хүлээн зөвшөөрөх» товчоор НОГООН болгож болно.
  assert.equal(M.OVERRIDE_MEANING.ACCEPTED_RISK.stillAViolation, true);
  assert.equal(M.OVERRIDE_MEANING.DESIGN_EXCEPTION.stillAViolation, true);
  assert.equal(M.OVERRIDE_MEANING.FALSE_POSITIVE.stillAViolation, false);
});

test('REVIEW_STATES нь 0215-ийн ДӨРВӨН утгыг БАЙТ БАЙТААР давтана', () => {
  assert.deepEqual([...M.REVIEW_STATES], ['pending', 'reviewed', 'verified', 'rejected']);
  // Хянагч ГАРААР `pending` бичих зам БАЙХГҮЙ.
  assert.ok(!(M.REVIEW_DECISIONS as readonly string[]).includes('pending'));
});

test('ХЯНАГДААГҮЙ хүчингүй болголт нь СУРГАЛТАД ХЭЗЭЭ Ч ОРОХГҮЙ', () => {
  const base = {
    overrideKind: 'FALSE_POSITIVE' as const,
    evidenceLevelAtOverride: 'RULE_BACKED' as const,
    reason: 'хаалганы өргөн зурагт зөв, дүрэм буруу уншив',
  };
  assert.equal(M.isOverrideTrainingEligible({ ...base, reviewState: 'pending' }), false);
  assert.equal(M.isOverrideTrainingEligible({ ...base, reviewState: 'rejected' }), false);
  assert.equal(M.isOverrideTrainingEligible({ ...base, reviewState: 'reviewed' }), true);
  assert.equal(M.isOverrideTrainingEligible({ ...base, reviewState: 'verified' }), true);
});

test('AI-ийн таамаг дээрх хүчингүй болголт нь сургалтын өгөгдөл БИШ', () => {
  assert.equal(
    M.isOverrideTrainingEligible({
      overrideKind: 'FALSE_POSITIVE',
      reviewState: 'verified',
      evidenceLevelAtOverride: 'AI_INFERRED',
      reason: 'энэ бол зүгээр л таамаг байсан',
    }),
    false,
  );
});

test('ХООСОН ШАЛТГААН нь ӨГӨГДӨЛ БИШ', () => {
  assert.equal(
    M.isOverrideTrainingEligible({
      overrideKind: 'RULE_WRONG',
      reviewState: 'verified',
      evidenceLevelAtOverride: 'RULE_BACKED',
      reason: 'ok',
    }),
    false,
  );
  assert.ok(M.MIN_OVERRIDE_REASON_LEN >= 8);
});

/* ================================================================== */
/*  5. §80 — ЭРХИЙН ТҮВШИН НЬ RE-EXPORT, ХУУЛБАР БИШ                   */
/* ================================================================== */

test('AUTHORITY_CAPS нь ЯГ НЭГ обьект — хоёр хүснэгт ОРШИХГҮЙ', () => {
  // ⚠️ ЭНЭ БОЛ ХАМГИЙН ЧУХАЛ ХАРУУЛ.  Хоёр caps хүснэгт орших нь `surface`
  //    нэг талдаа true, нөгөө талдаа false болох өдөр л илэрнэ — тэр нь
  //    дүгнэлт ХАРАГДАХ ба ЧИМЭЭГҮЙ НУУГДАХ хоёрын ялгаа.
  assert.equal(M.AUTHORITY_CAPS, A.AUTHORITY_CAPS, 'ХУУЛБАРЛАСАН байна — RE-EXPORT байх ЁСТОЙ');
  assert.equal(M.AUTHORITY_LEVELS, A.AUTHORITY_LEVELS);
  assert.equal(M.authorityFromSetting, A.authorityFromSetting);
});

test('релиз N нь OBSERVE — цуглуулна, ХАРУУЛАХГҮЙ', () => {
  assert.equal(M.AUTHORITY_CAPS.OBSERVE.collect, true);
  assert.equal(M.AUTHORITY_CAPS.OBSERVE.surface, false);
  assert.equal(M.AUTHORITY_CAPS.OBSERVE.write, false);
  assert.equal(M.authorityFromSetting('0'), 'OBSERVE');
  // Хог утга бүр ХАМГИЙН БАГА эрх рүү унана.
  for (const bad of ['9', '', 'abc', '-1', '0x2', '1e0', ' ', null, undefined]) {
    assert.equal(M.authorityFromSetting(bad as string | null | undefined), 'OBSERVE', `${String(bad)}`);
  }
});

test('AUTHORITY_GATES нь ЗУРГААН түвшин БҮРИЙГ хамарна ба хатуурч явна', () => {
  assert.equal(Object.keys(M.AUTHORITY_GATES).length, M.AUTHORITY_LEVELS.length);
  const order = ['UNVERIFIED', 'CLAUSE_CITED', 'HUMAN_VERIFIED'];
  let prevMin = -1;
  let prevParts = -1;
  for (const level of M.AUTHORITY_LEVELS) {
    const gate = M.AUTHORITY_GATES[level];
    assert.equal(gate.level, level);
    const idx = order.indexOf(gate.minVerificationState);
    assert.ok(idx >= prevMin, `${level} нь өмнөх түвшнээс СУЛ шаардлагатай байна`);
    assert.ok(gate.requiredPartitions.length >= prevParts, `${level} нь golden шаардлагаа БУУРУУЛЖЭЭ`);
    prevMin = idx;
    prevParts = gate.requiredPartitions.length;
  }
  // Загварыг БИЧИХ эрх нь албан ёсны баримтгүйгээр нээгдэхгүй.
  assert.equal(M.AUTHORITY_GATES.HUMAN_APPROVED_EXECUTE.minVerificationState, 'HUMAN_VERIFIED');
  assert.equal(M.AUTHORITY_GATES.LIMITED_AUTONOMOUS_EXECUTE.minVerificationState, 'HUMAN_VERIFIED');
});

/* ================================================================== */
/*  6. «ХАРАГДАХГҮЙ» ба «ЮУ Ч АЛГА» — ХАМГИЙН ЧУХАЛ ЯЛГАА              */
/* ================================================================== */

test('OBSERVE дээр гадаргуу нь ҮРГЭЛЖ «дарагдсан», ХЭЗЭЭ Ч «цэвэр» БИШ', () => {
  assert.equal(
    M.surfaceStateOf({ authority: 'OBSERVE', evaluationState: 'checked', visibleCount: 0 }),
    'suppressed_by_authority',
  );
  assert.equal(
    M.surfaceStateOf({ authority: 'OBSERVE', evaluationState: 'checked', visibleCount: 17 }),
    'suppressed_by_authority',
  );
});

test('ДҮРЭМГҮЙ ТЭГ нь ШАЛГААД ОЛДООГҮЙ ТЭГ-ЭЭС ЯЛГААТАЙ', () => {
  // Эзний Ш4 — `rules` ХООСОН шипнэ.  Энэ хоёрыг нэг болгох нь системийн
  // гаргаж болох ХАМГИЙН МУУ ХУДАЛ мэдэгдэл.
  assert.equal(
    M.surfaceStateOf({ authority: 'EXPLAIN', evaluationState: 'no_rule_pack', visibleCount: 0 }),
    'no_rule_pack',
  );
  assert.equal(
    M.surfaceStateOf({ authority: 'EXPLAIN', evaluationState: 'never_run', visibleCount: 0 }),
    'never_run',
  );
  assert.equal(
    M.surfaceStateOf({ authority: 'EXPLAIN', evaluationState: 'checked', visibleCount: 0 }),
    'clean',
  );
  assert.equal(
    M.surfaceStateOf({ authority: 'EXPLAIN', evaluationState: 'partial', visibleCount: 0 }),
    'partial',
  );
  assert.equal(
    M.surfaceStateOf({ authority: 'EXPLAIN', evaluationState: 'checked', visibleCount: 3 }),
    'findings',
  );
});

test('ДҮРМИЙН БАГЦГҮЙ үед мөр ЖАГСААХГҮЙ — «цэвэр» гэж уншигдах боломжгүй', () => {
  assert.equal(M.SURFACE_RENDER.no_rule_pack.listsFindings, false);
  assert.equal(M.SURFACE_RENDER.suppressed_by_authority.listsFindings, false);
});

test('UI-ийн бичвэрт «баталгаажлаа» / «нийцлээ» гэсэн УТГА ХЭЗЭЭ Ч ГАРАХГҮЙ', () => {
  // §69-R3 (v2:2238) — «This should never be a legal certification.»
  const banned = [
    'баталгаажл', 'нийцэж байна', 'нийцлээ', 'зөвшөөрөгдлөө', 'батал',
    'compliant', 'certif', 'approved', 'conforms',
  ];
  for (const state of M.SURFACE_STATES) {
    const r = M.SURFACE_RENDER[state];
    for (const word of banned) {
      assert.ok(
        !r.labelMn.toLowerCase().includes(word) && !r.labelEn.toLowerCase().includes(word),
        `${state} дээр хориотой үг: ${word}`,
      );
    }
    assert.ok(r.labelMn.length > 0 && r.labelEn.length > 0);
  }
});

test('SURFACE_RENDER нь ЗУРГААН төлөв БҮРИЙГ хамарна (TOTAL Record)', () => {
  assert.equal(Object.keys(M.SURFACE_RENDER).length, M.SURFACE_STATES.length);
});

/* ================================================================== */
/*  АУДИТ 2026-08-31 — ШҮҮЛТЭД УНАСАН МӨР «ЦЭВЭР» БОЛЖ ХУВИРЧ БАЙВ    */
/*                                                                     */
/*  ⚠️ ОЛДСОН АЛДАА (бодит SQL дээр хэмжсэн).  `surfaceStateOf` нь     */
/*     ЗӨВХӨН `visibleCount` (ШҮҮСНИЙ ДАРААХ тоо) хардаг байсан тул    */
/*     `min_severity = 'HIGH'` (0228-ийн анхдагч) үед НЭЭЛТТЭЙ ГУРВАН  */
/*     MEDIUM `VIOLATION`-тэй, БҮТЭН СКАН хийгдсэн төсөл дээр          */
/*     `/findings/surface` нь `clean` буцааж «Дүрмийн багцаар шалгав — */
/*     анхаарах зүйл олдсонгүй.» гэж бичдэг байв — ЯГ ТЭР үед §69-ийн  */
/*     хаалга `NOT_READY` + `MEDIUM: 3` гэж хэлж байлаа.               */
/*     Нэг төсөл, нэг баримт, ХОЁР ЭСРЭГ хариулт.                      */
/* ================================================================== */

test('АУДИТ: шүүлтэд унасан мөр байхад `clean` ХЭЗЭЭ Ч буцахгүй', () => {
  const base = { authority: 'EXPLAIN', evaluationState: 'checked' } as const;

  // Мөр БАЙХГҮЙ — `clean` нь ЗӨВ (хяналтын кейс, эс бөгөөс засвар нь
  // `clean`-ыг бүхэлд нь хүрч болшгүй болгосон эсэхийг ялгахгүй).
  assert.equal(M.surfaceStateOf({ ...base, visibleCount: 0, hiddenCount: 0 }), 'clean');
  assert.equal(M.surfaceStateOf({ ...base, visibleCount: 0 }), 'clean');

  // Мөр БИЙ, зүгээр л ноцтой байдлын шүүлтээс доор — «олдсонгүй» гэж
  // бичих ЭРХГҮЙ.
  assert.notEqual(M.surfaceStateOf({ ...base, visibleCount: 0, hiddenCount: 3 }), 'clean');
  assert.equal(M.surfaceStateOf({ ...base, visibleCount: 0, hiddenCount: 3 }), 'findings');
  assert.equal(M.surfaceStateOf({ ...base, visibleCount: 0, hiddenCount: 1 }), 'findings');
});

test('АУДИТ: нуугдсан мөр нь ӨМНӨХ хатуу төлөвүүдийг ДАРАХГҮЙ', () => {
  // Дараалал ачаалалтай: «юу ч шалгаагүй» нь «доор нь мөр бий»-гээс ЧУХАЛ.
  assert.equal(
    M.surfaceStateOf({ authority: 'EXPLAIN', evaluationState: 'no_rule_pack', visibleCount: 0, hiddenCount: 9 }),
    'no_rule_pack',
  );
  assert.equal(
    M.surfaceStateOf({ authority: 'EXPLAIN', evaluationState: 'never_run', visibleCount: 0, hiddenCount: 9 }),
    'never_run',
  );
  assert.equal(
    M.surfaceStateOf({ authority: 'EXPLAIN', evaluationState: 'partial', visibleCount: 0, hiddenCount: 9 }),
    'partial',
  );
  // Эрхийн дарангуйлал нь БҮГДИЙГ дарна.
  assert.equal(
    M.surfaceStateOf({ authority: 'OBSERVE', evaluationState: 'checked', visibleCount: 0, hiddenCount: 9 }),
    'suppressed_by_authority',
  );
});

test('АУДИТ: `clean` нь ЦОРЫН ГАНЦ «цэвэр» шошготой төлөв хэвээр', () => {
  // Засвар нь `findings` рүү чиглүүлдэг тул `findings`-ийн шошго нь ЯМАР Ч
  // «олдсонгүй / цэвэр» гэсэн мэдэгдэл агуулж БОЛОХГҮЙ.
  const f = M.SURFACE_RENDER['findings'];
  // ⚠️ «алга» ЭНД БАЙХГҮЙ: тэр нь «шАЛГАв» гэсэн ЗӨВ үгийн ДЭД МӨР тул
  //    дэд-мөрийн шалгалт худал эерэг өгнө.  «Алга» гэсэн мэдэгдлийг
  //    `SURFACE_RENDER.clean` дээр Л зөвшөөрөх шалгалт нь дээрх
  //    `banned` жагсаалтын тест — энэ нь ЗӨВХӨН `findings`-ийг барина.
  for (const w of ['олдсонгүй', 'цэвэр', 'nothing', 'clean', 'no issues']) {
    assert.ok(
      !f.labelMn.toLowerCase().includes(w) && !f.labelEn.toLowerCase().includes(w),
      `findings шошго «цэвэр» гэж уншигдана: ${w}`,
    );
  }
});
