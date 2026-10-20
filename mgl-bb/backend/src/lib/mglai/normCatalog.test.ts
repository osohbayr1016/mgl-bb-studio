/**
 * MGL AI · МЭДЛЭГИЙН САНГИЙН КАТАЛОГ — ТЕСТ.
 *
 * Run with:  node --test src/lib/mglai/normCatalog.test.ts
 *
 * ⚠️ ЮУГ ХАМГААЛЖ БАЙНА ВЭ (2026-09-18, хэмжсэн гажиг): «chamd ymar norm durmuud baigaa ve»
 *    NORMATIVE болж, нотолгоогүй татгалзал/prompt-ын цуурай гарч байв.  Одоо:
 *      · жагсаалтын асуулт (кирилл · латин · англи) → META + `inventory`;
 *      · нэрлэсэн баримтын тойм («УББ 12-01-01 юуны тухай вэ») → META + `document`;
 *      · СЭДЭВТЭЙ асуулт («сургуулийн барилгад ямар норм байна», «В2 галын ачаалал»)
 *        → null (норм / чиглүүлэгчийн зам ХЭВЭЭР) — энэ нь хамгийн чухал сөрөг тест;
 *      · хөтчөөс ирсэн каталог цагаан жагсаалтаар, template детерминист, гэрээ grounded.
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

const { detectNormCatalogAsk, extractNormCode, parseNormCatalog, normCatalogTemplate, normCatalogTool, withNormCatalog } = await import('./normCatalog.ts');
const { classifyIntent, isNormativeQuestion } = await import('./intent.ts');
const { planTurn } = await import('./turnPlan.ts');
const { buildTrustedContract } = await import('./trustedFacts.ts');
const { applyGroundingGuard } = await import('./groundingGuard.ts');

/* ── 1. Жагсаалтын асуулт ─────────────────────────────────────────── */

const INVENTORY = [
  'chamd ymar norm durmuud baigaa ve',
  'Чамд ямар норм дүрмүүд байгаа вэ?',
  'чи ямар норм мэддэг вэ',
  'Ямар стандартууд байгаа вэ?',
  'Танд ямар норм дүрэм суусан бэ',
  'нормын санд юу байгаа вэ',
  'Ямар баримт бичиг шингээсэн бэ?',
  'which norms do you have',
  'What standards do you know?',
  'list the norms you have',
  'хэдэн норм байгаа вэ',
  'бүх нормоо жагсаа',
];

for (const q of INVENTORY) {
  test(`inventory · «${q}»`, () => {
    assert.deepEqual(detectNormCatalogAsk(q), { kind: 'inventory' });
    assert.equal(classifyIntent(q).intent, 'META');
    assert.equal(isNormativeQuestion(q), false, 'regulatory байж болохгүй — татгалзлын гэрээ бичнэ');
  });
}

/* ── 2. Нэг баримтын тойм ─────────────────────────────────────────── */

const DOCUMENT: Array<[string, string]> = [
  ['УББ 12-01-01 юуны тухай вэ?', 'УББ 12-01-01'],
  ['БНбД 21-04-05 юуны тухай баримт вэ', 'БНбД 21-04-05'],
  ['БД 21-101-12-ийн агуулгыг танилцуулаач', 'БД 21-101-12'],
  ['bnbd 31-23-12 yunii tuhai ve', 'БНбД 31-23-12'],
  ['СНиП II-97-76 гэж юу вэ', 'СНиП II-97-76'],
  ['what is BNbD 11-08-23 about?', 'БНбД 11-08-23'],
  ['УББ 12-204-01-д юу заасан бэ?', 'УББ 12-204-01'],
  ['21-101-12 ямар дүрэм вэ', '21-101-12'],
  ['БД 17-652-88 gej yu ve', 'БД 17-652-88'],
  ['ubb 12-204-01 yunii tuhai barimt ve', 'УББ 12-204-01'],
];

for (const [q, code] of DOCUMENT) {
  test(`document · «${q}» → ${code}`, () => {
    assert.equal(extractNormCode(q), code);
    assert.deepEqual(detectNormCatalogAsk(q), { kind: 'document', code });
    assert.equal(classifyIntent(q).intent, 'META');
    assert.equal(isNormativeQuestion(q), false);
  });
}

/* ── 3. СӨРӨГ — сэдэвтэй / заалтын асуулт нормын зам ХЭВЭЭР ──────── */

const NOT_CATALOG = [
  'Сургуулийн барилгад ямар норм байна вэ?',
  'Цахилгаантай холбоотой өндөр барилгын норм дүрэм юу вэ?',
  'g=1800 MJ/m2 бол В2 юу В3 юу',
  'Галын гарц хэдэн байх ёстой вэ',
  'БНбД 21-04-05-д галын дохиоллын тухай юу заасан бэ',
  'УББ 12-01-01-ийн 2.5-р заалт юу гэж байна',
  'ямар нормын шаардлага байгаа вэ',
  'Барилгын өндөрт ямар норм хамаарах вэ',
  'Хэдэн төсөл байна?',
  'Сайн уу',
  'чи юу хийж чадах вэ',
  'нормын хүснэгт 4-т юу байна',
];

for (const q of NOT_CATALOG) {
  test(`not catalog · «${q}»`, () => {
    assert.equal(detectNormCatalogAsk(q), null);
  });
}

test('not catalog · нормын асуулт NORMATIVE хэвээр, мета асуулт META хэвээр', () => {
  assert.equal(classifyIntent('Галын гарц хэдэн байх ёстой вэ').intent, 'NORMATIVE');
  assert.equal(classifyIntent('Сургуулийн барилгад ямар норм байна вэ?').intent, 'NORMATIVE');
  assert.equal(classifyIntent('чи юу хийж чадах вэ').intent, 'META');
  assert.equal(classifyIntent('Хэдэн төсөл байна?').intent, 'COMPANY_FACT');
});

/* ── 4. planTurn — /plan ба /context-ийн хамтын цөм ───────────────── */

test('planTurn · жагсаалтын асуулт: regulatory=false, askLocalNorm=false, normCatalog=inventory, хэрэгсэлгүй', () => {
  const p = planTurn({ question: 'chamd ymar norm durmuud baigaa ve', rawState: null, seq: 0, visibleTools: ['list_projects', 'get_active_employees'] });
  assert.equal(p.regulatory, false);
  assert.equal(p.askLocalNorm, false);
  assert.deepEqual(p.normCatalog, { kind: 'inventory' });
  assert.deepEqual(p.tools, []);
  assert.equal(p.turn.intent, 'META');
});

test('planTurn · баримтын тойм: normCatalog=document, /norm асуухгүй', () => {
  const p = planTurn({ question: 'УББ 12-01-01 юуны тухай вэ?', rawState: null, seq: 0, visibleTools: [] });
  assert.equal(p.regulatory, false);
  assert.equal(p.askLocalNorm, false);
  assert.deepEqual(p.normCatalog, { kind: 'document', code: 'УББ 12-01-01' });
});

test('planTurn · жинхэнэ нормын асуултад normCatalog=null, askLocalNorm=true', () => {
  const p = planTurn({ question: 'Галын гарц хэдэн байх ёстой вэ', rawState: null, seq: 0, visibleTools: [] });
  assert.equal(p.normCatalog, null);
  assert.equal(p.askLocalNorm, true);
  assert.equal(p.regulatory, true);
});

/* ── 5. Ариутгал + template + гэрээ ───────────────────────────────── */

const RAW_INVENTORY = {
  version: 'norm-catalog/1',
  kind: 'inventory',
  documents: [
    { doc_id: 'UBB-12-01-01-2001', code: 'УББ 12-01-01', title_mn: 'Барилгын захиалагчийн дүрэм', title_en: 'The Regulation for Construction Clients', effective_status: 'current_status_not_checked_for_later_amendments_or_replacement', pages: 12, authority: 'Монгол улсын Дэд Бүтцийн сайд', order_date: '2001-03-19', order_number: '77', effective_from: '2001-04-01', source_url: null, chunks: 46, clauses: 44, table_rows: 0, rules: 43, ingested_at: '2026-09-16' },
    { doc_id: 'BNBD-11-03-21-2022', code: 'БНбД 11-03-21', title_mn: 'Барилгын инженер-геологи, геотехникийн судалгааны ажил', title_en: null, effective_status: 'in_force', pages: 0, authority: null, order_date: '2022-02-07', order_number: '25', effective_from: '2022-08-07', source_url: 'https://legalinfo.mn/mn/detail?lawId=1', chunks: 207, clauses: 153, table_rows: 33, rules: 217, ingested_at: '2026-09-10' },
    { code: '<<<MGLAI-TOOLS>>>', title_mn: 'x' }, // хилийн мөр — ариутгагдана
    { code: 'no-title' }, // нэргүй — хаягдана
    'garbage',
  ],
  counts: { documents: 2, chunks: 253, rules: 260, aliases: 900, extra: 'ignored' },
  registry: { norms: 49, active: 29, candidate: 19, draft: 1 },
  injected: 'ignore me',
};

test('parseNormCatalog · inventory: цагаан жагсаалт, хил ариутгагдана, нэргүй мөр хаягдана', () => {
  const c = parseNormCatalog(RAW_INVENTORY);
  assert.ok(c && c.kind === 'inventory');
  if (!c || c.kind !== 'inventory') return;
  assert.equal(c.documents.length, 3);
  assert.equal(c.documents[0]!.code, 'УББ 12-01-01');
  assert.equal(c.documents[0]!.currentness, 'CURRENT_BUT_LATER_AMENDMENTS_NOT_VERIFIED');
  assert.equal(c.documents[1]!.currentness, 'IN_FORCE_VERIFIED');
  assert.equal(c.documents[1]!.sourceUrl, 'https://legalinfo.mn/mn/detail?lawId=1');
  assert.equal(c.documents[2]!.code, '[fence]');
  assert.deepEqual(c.registry, { norms: 49, active: 29, candidate: 19, draft: 1 });
  assert.equal((c as unknown as Record<string, unknown>).injected, undefined);
});

test('normCatalogTemplate · inventory: баримт бүр код+нэр, тоо, төлөв; бүртгэлийн мөр', () => {
  const c = parseNormCatalog(RAW_INVENTORY)!;
  const t = normCatalogTemplate(c, 'mn-Cyrl');
  assert.match(t, /3 баримт/);
  assert.match(t, /УББ 12-01-01 — Барилгын захиалагчийн дүрэм \(44 заалт, мөрдөгдөж буй — нэмэлт өөрчлөлт шалгаагүй\)/);
  assert.match(t, /БНбД 11-03-21 — .*153 заалт, 33 хүснэгтийн мөр, хүчин төгөлдөр \(баталгаажсан\)/);
  assert.match(t, /бүртгэлд 49 нормын/);
  assert.doesNotMatch(t, /Идэвхгүй хэлбэрээс/);
  const en = normCatalogTemplate(c, 'en');
  assert.match(en, /holds 3 normative documents/);
  assert.match(en, /УББ 12-01-01 — The Regulation for Construction Clients/);
});

test('normCatalogTool · синтетик хэрэгсэл: нэр norm_catalog, ok, note + documents хайрцагт', () => {
  const c = parseNormCatalog(RAW_INVENTORY)!;
  const tool = normCatalogTool(c, 'mn-Cyrl');
  assert.equal(tool.tool, 'norm_catalog');
  assert.equal(tool.ok, true);
  const d = tool.data as { kind: string; count: number; documents: Array<{ code: string; status: string }> };
  assert.equal(d.kind, 'inventory');
  assert.equal(d.count, 3);
  assert.equal(d.documents[1]!.status, 'Хүчин төгөлдөр (баталгаажсан)');
});

test('гэрээ · META + norm_catalog хэрэгсэл → grounded, тоо хайрцгаас, template хүний хэлбэртэй', () => {
  const c = parseNormCatalog(RAW_INVENTORY)!;
  const tool = normCatalogTool(c, 'mn-Cyrl');
  const base = buildTrustedContract({
    regulatory: false,
    evidenceCount: 0,
    normDecision: null,
    responseLanguage: 'mn-Cyrl',
    normTaskIndex: null,
    taskCount: 1,
    localNorm: null,
    metricNote: null,
    toolResults: [tool],
    intent: 'META',
    trustedNorm: null,
    normRetrievalFailed: false,
  });
  const guarded = applyGroundingGuard(base, { intent: 'META', toolResults: [tool], revitContextPresent: false, responseLanguage: 'mn-Cyrl' });
  assert.equal(guarded.answerMode, 'grounded');
  assert.ok(guarded.allowedNumbers !== null && guarded.allowedNumbers.includes(44) && guarded.allowedNumbers.includes(153));
  const final = withNormCatalog(guarded, c, 'mn-Cyrl');
  assert.equal(final.answerMode, 'grounded');
  assert.match(final.template ?? '', /^Энэ компьютерийн нормын санд 3 баримт/);
  assert.equal(final.noMatch, false);
  assert.match(final.reason, /norm_catalog:inventory/);
});

const RAW_DOC = {
  kind: 'document',
  document: { code: 'УББ 12-01-01', title_mn: 'Барилгын захиалагчийн дүрэм', effective_status: 'current_status_not_checked_for_later_amendments_or_replacement', pages: 12, authority: 'Монгол улсын Дэд Бүтцийн сайд', order_date: '2001-03-19', order_number: '77', effective_from: '2001-04-01', chunks: 46, clauses: 44, table_rows: 0, rules: 43 },
  sections: [
    { path: 'Нэг. Нийтлэг үндэслэл', n: 12, clause_from: '1.1', clause_to: '1.12', kind: 'clauses' },
    { path: 'Хоёр. Захиалагчийн үүрэг', n: 24, clause_from: '2.1', clause_to: '2.24', kind: 'clauses' },
    { path: 'Тав. Захиалагчийн хариуцлага', n: 1, clause_from: '5.1', clause_to: '5.1', kind: 'clauses' },
    { path: 'бүтэцгүй', n: 'x', kind: 'weird' },
  ],
  sections_total: 5,
  appendices: [],
  tables: ['Хүснэгт 1 — Жишээ'],
};

test('parseNormCatalog + template · document: бүлэг дарааллаар, заалтын муж, төлөвийн тэмдэглэл trailer', () => {
  const c = parseNormCatalog(RAW_DOC);
  assert.ok(c && c.kind === 'document');
  if (!c || c.kind !== 'document') return;
  assert.equal(c.sections.length, 4);
  assert.equal(c.sections[3]!.kind, 'other');
  assert.equal(c.sectionsTotal, 5);
  const t = normCatalogTemplate(c, 'mn-Cyrl');
  assert.match(t, /^УББ 12-01-01 «Барилгын захиалагчийн дүрэм» — мөрдөгдөж буй — нэмэлт өөрчлөлт шалгаагүй\./);
  assert.match(t, /2001-03-19, №77 тушаалаар батлагдсан/);
  assert.match(t, /• Хоёр\. Захиалагчийн үүрэг \(заалт 2\.1–2\.24\)/);
  assert.match(t, /• Тав\. Захиалагчийн хариуцлага \(заалт 5\.1\)/);
  assert.match(t, /мөн 1 бүлэг/);
  assert.match(t, /Хүснэгтүүд: Хүснэгт 1 — Жишээ/);
  assert.doesNotMatch(t, /дараагийн нэмэлт, өөрчлөлтийн хүчин төгөлдөр байдлыг/, 'тэмдэглэл нь trailer, template-д давхардахгүй');
  const contract = withNormCatalog(
    { version: 'tfc-1', answerMode: 'free', risk: 'low', facts: [], allowedNumbers: null, allowedCategories: null, requiredSentence: null, trailerText: null, requiredCitations: [], noMatch: false, forbiddenPhrases: [], template: null, taskIndex: null, legacyKind: 'free', reason: 'test', norm: null } as never,
    c,
    'mn-Cyrl',
  );
  assert.deepEqual(contract.requiredCitations, ['УББ 12-01-01']);
  assert.match(contract.trailerText ?? '', /нэмэлт, өөрчлөлт/);
});

test('not_found · санд ч бүртгэлд ч байхгүй → noMatch, агуулга тайлбарлахгүй', () => {
  const c = parseNormCatalog({ kind: 'not_found', code: 'БНбД 99-99-99', registry: null });
  assert.ok(c && c.kind === 'not_found');
  const t = normCatalogTemplate(c!, 'mn-Cyrl');
  assert.match(t, /БНбД 99-99-99 энэ компьютерийн нормын санд шингээгээгүй/);
  const contract = withNormCatalog({ version: 'tfc-1', answerMode: 'grounded', risk: 'medium', facts: [], allowedNumbers: [], allowedCategories: null, requiredSentence: null, trailerText: null, requiredCitations: [], noMatch: false, forbiddenPhrases: [], template: null, taskIndex: null, legacyKind: 'free', reason: 'test', norm: null } as never, c!, 'mn-Cyrl');
  assert.equal(contract.noMatch, true);
  const reg = parseNormCatalog({ kind: 'not_found', code: 'БНбД 41-01-11', registry: { code: 'БНбД 41-01-11', title_mn: 'Барилгын дулаан хамгаалалт', status: 'ACTIVE', source_url: 'https://mcis.gov.mn/x' } });
  assert.match(normCatalogTemplate(reg!, 'mn-Cyrl'), /Бүртгэлд «Барилгын дулаан хамгаалалт» \(ACTIVE\) гэж бий; албан эх сурвалж: https:\/\/mcis\.gov\.mn\/x/);
});

test('parseNormCatalog · хог оролт null', () => {
  assert.equal(parseNormCatalog(null), null);
  assert.equal(parseNormCatalog('x'), null);
  assert.equal(parseNormCatalog({ kind: 'weird' }), null);
  assert.equal(parseNormCatalog({ kind: 'document', document: { code: 'A' } }), null);
});

test('rank (2026-09-28, эзний бодит чат) · «хамгийн хэцүү норм» → хэмжээгээр эрэмбэлсэн жагсаалт + орлуулга гэдгийг ил хэлнэ', () => {
  for (const q of ['hamgiin hetsuu norm durmiin jagsaaltiig beltge', 'Хамгийн хэцүү норм дүрмийн жагсаалтыг бэлтгэ', 'Хамгийн төвөгтэй нормууд аль вэ?', 'List the hardest norms']) {
    assert.deepEqual(detectNormCatalogAsk(q), { kind: 'inventory', rank: 'size' }, q);
  }
  for (const q of ['Хамгийн чухал норм дүрмүүд аль вэ?', 'hamgiin chuhal normuud ali ve', 'What are the most important norms?']) {
    assert.deepEqual(detectNormCatalogAsk(q), { kind: 'inventory', rank: 'judgement' }, q);
  }
  // Сэдэвтэй бол үнэлгээний жагсаалт БИШ — чиглүүлэгч/заалтын зам хэвээр.
  for (const q of ['Галын аюулгүй байдлын хамгийн хэцүү норм аль вэ?', 'Хамгийн их өндөртэй барилгын норм', 'hamgiin undur barilgiin norm']) {
    assert.equal(detectNormCatalogAsk(q)?.kind === 'inventory' && 'rank' in (detectNormCatalogAsk(q) ?? {}), false, q);
  }
  const c = parseNormCatalog(RAW_INVENTORY)!;
  const t = normCatalogTemplate(c, 'mn-Cyrl', { kind: 'inventory', rank: 'size' });
  assert.ok(t.startsWith('«Хэцүү» гэдгийг хэмжих албан үзүүлэлт байхгүй'), t.slice(0, 80));
  // Хэмжээгээр (заалт + хүснэгтийн мөр) буурах: 11-03-21 (153+33) → 12-01-01 (44).
  const i1 = t.indexOf('БНбД 11-03-21');
  const i2 = t.indexOf('УББ 12-01-01');
  assert.ok(i1 > 0 && i2 > i1, 'хэмжээгээр эрэмбэлсэн');
  assert.match(t, /^1\. БНбД 11-03-21/m);
  assert.match(t, /Барилгын төрөл эсвэл сэдвээ/);
  const j = normCatalogTemplate(c, 'mn-Cyrl', { kind: 'inventory', rank: 'judgement' });
  assert.match(j, /ерөнхийд нь эрэмбэлж чадахгүй/);
  // Эрэмбэгүй хуучин зан төлөв ХӨНДӨГДӨӨГҮЙ.
  assert.equal(normCatalogTemplate(c, 'mn-Cyrl'), normCatalogTemplate(c, 'mn-Cyrl', { kind: 'inventory' }));
});
