/**
 * L1 БАРИМТ ОЛОХ (norm_documents) — асуултын хаалга · синтетик хэрэгсэл · детерминист template ·
 * гэрээ (trustedFacts) · validator-ын хэрэгжүүлэлт (packages/mglai-common).
 *
 * Run with:  node --test src/lib/mglai/normDocuments.test.ts
 *
 * Хамгаалж буй зүйл: олох асуултад ГАНЦ таамагласан норм биш БҮХ жагсаалт; загвар баримт орхивол
 * validator детерминист нэмнэ; зохиомол тоо/заалт хасагдана; загвар хоёр удаа зөрвөл серверийн
 * жагсаалт ХЭВЭЭР харагдана; STATUS_REQUIRES_VERIFICATION «хүчин төгөлдөр» болж дээшлэхгүй; техникийн
 * асуулт (хэд вэ, тоо) олох горимд ОРОХГҮЙ; детерминист шийдвэртэй ээлжид жагсаалт солихгүй.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
});

const ND = await import('./normDocuments.ts');
const LN = await import('./localNorm.ts');
const TF = await import('./trustedFacts.ts');
const AC = await import('./answerContract.ts');
const PF = await import('./promptFrame.ts');
const NE = await import('./norm/engine.ts');
// ⚠️ Багцын symlink нь node_modules дор шийдэгдэж type-stripping унадаг тул БОДИТ замаар (репогийн packages/).
const V = await import('../../../../packages/mglai-common/src/turn/validator.ts');

/** Runtime `/norm` → `registry.topic_router`-ийн бодит хэлбэр (ai/retrieval topicRouter.ts, electrical+highrise). */
const RAW_ROUTE = {
  detected_topics: ['highrise', 'electrical'],
  detection: 'exact',
  wants_cost: false,
  wants_labour: false,
  count: 11,
  excluded: { cost: 0, labour: 0 },
  answer_mode: 'LINKS_ONLY',
  results: [
    { registry_id: 'mn-construction:efa9c834c1f527ec3773', code: 'БНбД 31-17-10', title_mn: 'Өндөр барилгын төлөвлөлт', status: 'ACTIVE', status_note_mn: 'MCIS-ийн хүчин төгөлдөр нормын бүртгэлд «Хүчин төгөлдөр».', url: 'https://mcis.gov.mn/storage/uploads/process/202206/file_1654224802226730_161611878330710.pdf', legal_source_url: 'https://legalinfo.mn/mn/detail/7524', superseded_by: null, scope_classes: ['technical_or_regulatory'], topics: ['highrise'], router_score: 100, router_reason: 'curated_highrise_overlay' },
    { registry_id: 'mn-construction:682f9dc8992da0dd159d', code: 'БД 43-101-03*12', code_pkg: 'БД 43-101-03 БД 43-101-03*12', title_mn: 'Цахилгаан байгууламжийн дүрэм', status: 'ACTIVE', url: 'https://mcis.gov.mn/storage/uploads/watermarkedPdf/2022111611.pdf', superseded_by: null, scope_classes: ['technical_or_regulatory'], topics: ['electrical'], router_score: 99.9, router_reason: 'curated_highrise_overlay' },
    { registry_id: 'mn-construction:a2cc01086652cd4af4ae', code: 'БД 43-102-07', title_mn: 'Орон сууц, олон нийтийн барилгын цахилгаан төхөөрөмжийг төсөллөх', status: 'CANDIDATE_NEEDS_STATUS_CHECK', url: 'https://mcis.gov.mn/main/single/16201345259112', superseded_by: null, scope_classes: ['technical_or_regulatory'], topics: ['electrical'], router_score: 99.8, router_reason: 'curated_highrise_overlay' },
    { registry_id: 'mn-construction:63e30f793eb451cf26aa', code: 'БД 43-103-08', title_mn: 'Барилга, байгууламжийн аянга хамгаалалтын зураг төсөл зохиох', status: 'ACTIVE', url: 'https://mcis.gov.mn/storage/uploads/process/x.pdf', superseded_by: null, scope_classes: ['technical_or_regulatory'], topics: ['lightning_protection'], router_score: 99.7, router_reason: 'curated_highrise_overlay' },
    { registry_id: 'mn-construction:43c7973ecbc6711e97a3', code: 'БД 43-104-12', title_mn: 'Цахилгааны хийц арматур, угсралтын галын аюулгүй байдлын шаардлага', status: 'STATUS_REQUIRES_VERIFICATION', status_note_mn: '2025 оны нормын бүртгэлийн жагсаалтад байсан; 2026 оны хүчин төгөлдөр байдал ШАЛГАГДААГҮЙ', url: 'https://www1.gazar.gov.mn/upload/news_files/16-202504161017426.pdf#page=44', superseded_by: null, scope_classes: ['technical_or_regulatory'], topics: ['electrical', 'fire_safety'], router_score: 99.6, router_reason: 'curated_highrise_overlay' },
    { registry_id: 'mn-construction:a36605d3b059e68c23f7', code: 'БД 43-105-12', title_mn: 'Цахилгааны кабель шугамын галын аюулын зэрэглэлийн ангилал', status: 'STATUS_REQUIRES_VERIFICATION', url: 'https://www1.gazar.gov.mn/upload/news_files/16-202504161017426.pdf#page=44', superseded_by: null, scope_classes: ['technical_or_regulatory'], topics: ['electrical'], router_score: 99.5, router_reason: 'curated_highrise_overlay' },
    { registry_id: 'mn-construction:44e080f26c01c09a1bc2', code: 'БД 43-107-19', title_mn: 'Барилга байгууламжийн цахилгаан төхөөрөмжийн газардуулгын эсэргүүцлийг хэмжих', status: 'STATUS_REQUIRES_VERIFICATION', url: 'https://www1.gazar.gov.mn/upload/news_files/16-202504161017426.pdf#page=45', superseded_by: null, scope_classes: ['technical_or_regulatory'], topics: ['grounding'], router_score: 99.4, router_reason: 'curated_highrise_overlay' },
    { registry_id: 'mn-construction:53c4ab68fb63320dfcc9', code: 'БД 43-108-24', title_mn: 'Барилгын холбоо, дохиоллын зураг төсөл төлөвлөлт', status: 'STATUS_REQUIRES_VERIFICATION', url: 'https://www1.gazar.gov.mn/upload/news_files/16-202504161017426.pdf#page=45', superseded_by: null, scope_classes: ['technical_or_regulatory'], topics: ['telecom_signal'], router_score: 99.3, router_reason: 'curated_highrise_overlay' },
    { registry_id: 'mn-construction:61b01920f6a16b70690d', code: 'БНбД 23-02-08', title_mn: 'Байгалийн ба зохиомол гэрэлтүүлэг', status: 'ACTIVE', url: 'https://mcis.gov.mn/storage/uploads/process/202510/file_1760.pdf', superseded_by: null, scope_classes: ['technical_or_regulatory'], topics: ['lighting'], router_score: 99.2, router_reason: 'curated_highrise_overlay' },
    { registry_id: 'mn-construction:e83b9b26edf44e34a6a4', code: 'БНбД 21-04-05*/18', title_mn: 'Барилга, байгууламжийн гал унтраах автомат төхөөрөмж, дохиолол', status: 'ACTIVE', url: 'https://mcis.gov.mn/storage/uploads/process/y.pdf', superseded_by: null, scope_classes: ['technical_or_regulatory'], topics: ['fire_alarm'], router_score: 99.1, router_reason: 'curated_highrise_overlay' },
    { registry_id: 'mn-construction:455da4aea1775d62b849', code: 'БНбД 3.05.06-90', title_mn: 'Цахилгаан техникийн ажил', status: 'STATUS_REQUIRES_VERIFICATION', url: 'https://www1.gazar.gov.mn/upload/news_files/16-202504161017426.pdf#page=46', superseded_by: null, scope_classes: ['construction_execution'], topics: ['electrical', 'construction_execution'], router_score: 99, router_reason: 'curated_highrise_overlay' },
  ],
};

test('эрэмбэ · норм/дүрэм → MNS стандарт → кодгүй; чиглүүлэгчийн эрэмбэ бүлэг дотроо хэвээр', () => {
  const rows = [
    { registry_id: 'r1', code: null, title_mn: 'ЗГ-ын тогтоол', status: 'STATUS_REQUIRES_VERIFICATION', url: 'https://www1.gazar.gov.mn/a.pdf#page=8' },
    { registry_id: 'r2', code: 'MNS GB/T 1499-1:2024', title_mn: 'Ган туйван', status: 'STATUS_REQUIRES_VERIFICATION', url: 'https://www1.gazar.gov.mn/a.pdf#page=71' },
    { registry_id: 'r3', code: 'MNS ISO 12480-1:2022', title_mn: 'Кран', status: 'STATUS_REQUIRES_VERIFICATION', url: 'https://www1.gazar.gov.mn/a.pdf#page=72' },
    { registry_id: 'r4', code: 'БД 11-123-20', title_mn: 'Тооцооны тайлан', status: 'STATUS_REQUIRES_VERIFICATION', url: 'https://www1.gazar.gov.mn/a.pdf#page=16' },
    { registry_id: 'r5', code: 'БНбД 52-01-10', title_mn: 'Бетон бүтээц', status: 'ACTIVE', url: 'https://mcis.gov.mn/storage/x.pdf' },
  ].map((x) => ({ ...x, scope_classes: ['technical_or_regulatory'], topics: ['structural'], router_score: 85, router_reason: 'topic_match:structural' }));
  const r = LN.parseLocalNormTopicRoute({ detected_topics: ['structural'], detection: 'exact', count: 5, excluded: { cost: 0, labour: 0 }, results: rows })!;
  const d = ND.normDocumentsData(r, 'mn-Cyrl');
  assert.deepEqual(d.all_documents.map((x) => x.code), ['БД 11-123-20', 'БНбД 52-01-10', 'MNS GB/T 1499-1:2024', 'MNS ISO 12480-1:2022', null]);
  assert.deepEqual(d.all_documents.map((x) => x.n), [1, 2, 3, 4, 5]);
  assert.match(ND.renderNormDocuments(d, 'mn-Cyrl'), /\| 5 \| — \| ЗГ-ын тогтоол \|/);
});
const route = LN.parseLocalNormTopicRoute(RAW_ROUTE)!;
const Q = 'Цахилгаантай холбоотой өндөр барилгын бүх норм дүрмийг нэр, код, линктэй нь өг.';

function contractFor(r = route, lang: 'mn-Cyrl' | 'en' = 'mn-Cyrl', extra: Record<string, unknown> = {}) {
  const data = ND.normDocumentsData(r, lang);
  const tool = ND.normDocumentsTool(r, lang)!;
  const nd = { count: data.count, template: ND.renderNormDocuments(data, lang), trailer: ND.normDocumentsTrailer(data, lang) };
  const base = {
    regulatory: true,
    evidenceCount: 0,
    normDecision: null,
    responseLanguage: lang,
    normTaskIndex: null,
    taskCount: 1,
    localNorm: null,
    metricNote: null,
    trustedNorm: null,
    normRetrievalFailed: false,
    normDocuments: nd,
    toolResults: [tool],
    intent: 'NORMATIVE',
    retrievalNoMatch: true, // заалтын хайлт «олдсонгүй» гэсэн ч жагсаалт байгаа тул FAKE_CITATION болохгүй
    ...extra,
  };
  return { data, tool, nd, contract: TF.buildTrustedContract(base as never), legacy: AC.buildAnswerContract(base as never) };
}

test('isDocumentDiscoveryQuestion · олох асуулт → true; техникийн утга/тоо/заалт асуусан → false', () => {
  for (const q of [Q, 'Гэрэлтүүлэгтэй холбоотой бүх норм дүрмийг өг.', 'Цахилгаантай холбоотой өндөр барилгын норм дүрэм юу вэ?', 'Газардуулгатай холбоотой норм дүрэм', 'high-rise electrical norms Mongolia, official links', 'Which lighting standards apply in Mongolia?', 'Аянга хамгаалалтын норм дүрэм'])
    assert.equal(ND.isDocumentDiscoveryQuestion(q), true, q);
  for (const q of ['Гэрэлтүүлгийн норм хэд вэ?', 'g = 1800 МДж/м² бол ямар ангилал вэ?', 'БНбД 31-17-10-ын 5.2 заалт юу гэж заадаг вэ?', 'Өндөр барилгын лифтний хурд хэдэн м/с байх ёстой вэ?', 'Хүснэгт 4-ийн утга', 'Сайн байна уу', 'Идэвхтэй төслүүд хэд вэ?', 'what is the minimum distance in the electrical code'])
    assert.equal(ND.isDocumentDiscoveryQuestion(q), false, q);
});

test('norm_documents хэрэгсэл · 11 баримт бүгд код/нэр/URL/төлөвтэй; template детерминист жагсаалт; шалгагдаагүй тоо ил', () => {
  const { data, tool, nd } = contractFor();
  assert.equal(tool.tool, 'norm_documents');
  assert.equal(data.count, 11);
  assert.equal(data.shown, 11);
  assert.equal(data.unverified_count, 6, 'ACTIVE биш 6 мөр (CANDIDATE 1 + REQUIRES_VERIFICATION 5)');
  for (const d of data.documents) {
    assert.ok(d.code && d.title && /^https:\/\//.test(d.url) && d.status_note.length > 0);
    assert.ok(!('clause' in d) && !('value' in d));
  }
  // Markdown хүснэгт: толгой + тоо, мөр бүр | № | **код** | нэр | төлөв | [шошго](url) |
  assert.match(nd.template, /^\*\*Олдсон холбогдох баримт: 11\*\* \(MCIS-хүчинтэй 5 · шалгагдаагүй 6\)/);
  assert.match(nd.template, /^\| № \| Код \| Нэр \| Төлөв \| Холбоос \|$/m);
  assert.match(nd.template, /^\| 1 \| \*\*БНбД 31-17-10\*\* \| Өндөр барилгын төлөвлөлт \| MCIS-хүчинтэй \| \[MCIS PDF\]\(https:\/\/mcis\.gov\.mn\/storage\/[^)]+\.pdf\) \|$/m);
  assert.match(nd.template, /^\| \d+ \| \*\*БД 43-104-12\*\* \| [^|]+ \| ШАЛГАГДААГҮЙ \| \[Бүртгэл х\.44\]\(https:\/\/www1\.gazar\.gov\.mn[^)]+#page=44\) \|$/m);
  assert.match(nd.template, /^\| \d+ \| \*\*БД 43-102-07\*\* \| [^|]+ \| ШАЛГАГДААГҮЙ \| \[MCIS\]\(https:\/\/mcis\.gov\.mn\/main\/single\/16201345259112\) \|$/m);
  assert.match(nd.template, /Төлөвийн тайлбар: MCIS-хүчинтэй = .*ШАЛГАГДААГҮЙ = 2025 оны бүртгэлд байсан/);
  assert.equal((nd.template.match(/^\| \d+ \| /gm) ?? []).length, 11, 'бүх 11 мөр template-д');
  // нэг баримт = нэг мөр: хөтчийн dedupeSentences (бүх горимд, гэрээний өмнө) ижил мөр хасах ёсгүй
  assert.equal(V.dedupeSentences(nd.template).removed, 0, 'template-ийн мөр давхардав');
  // трейлер template-д ОРОХГҮЙ (гэрээний trailerText нэг удаа наана — өмнө нь хоёр удаа гарч байв)
  assert.ok(!nd.template.includes('Анхаарах нь'), 'трейлер template дотор давхардав');
  assert.match(nd.trailer, /6 нь 2025 оны бүртгэлийн жагсаалтаас .* шалгагдаагүй/);
  // fallbackAnswer = template + trailer ЯГ НЭГ удаа
  const { contract } = contractFor();
  const fb = V.fallbackAnswer(contract, 'mn-Cyrl');
  assert.equal((fb.match(/Анхаарах нь:/g) ?? []).length, 1, 'трейлер хоёр удаа');
  assert.equal((fb.match(/Төлөвийн тайлбар:/g) ?? []).length, 1);
  // prompt-ын хайрцаг: дүрэм + бүх код
  const box = PF.renderToolResults([tool], '2026-09-18');
  assert.match(box, /дүрэм \(norm_documents\)/);
  for (const c of ['БНбД 31-17-10', 'БД 43-107-19', 'БНбД 3.05.06-90']) assert.ok(box.includes(c), c);
  assert.ok(!box.includes('ТАСАРСАН'), 'хайрцаг тасраагүй');
});

test('гэрээ · norm_documents: grounded/medium, канон татгалзал БАЙХГҮЙ, template = жагсаалт, 15 баримт заавал, noMatch=false', () => {
  const { contract, legacy } = contractFor();
  assert.equal(legacy.kind, 'norm_documents');
  assert.equal(contract.answerMode, 'grounded');
  assert.equal(contract.risk, 'medium');
  assert.equal(contract.requiredSentence, null, '«эх сурвалж олдсонгүй» гэж хэлэхгүй');
  assert.equal(contract.noMatch, false);
  assert.match(contract.template ?? '', /Олдсон холбогдох баримт: 11\*\*/);
  assert.match(contract.trailerText ?? '', /шалгагдаагүй/);
  // ДЕТЕРМИНИСТ Л: хөтөч/runtime engine загвар үүсгэлтгүй template-ийг шууд харуулна
  assert.equal(contract.templateOnly, true);
  const must = contract.facts.filter((f) => f.mustMention);
  assert.equal(must.length, 11);
  assert.ok(must.every((f) => f.authority === 'retrieval' && f.kind === 'text'));
  assert.ok(Array.isArray(contract.allowedNumbers) && contract.allowedNumbers.includes(11));
  // жагсаалтгүй ижил оролт → хуучин norm_refusal (регресс биш, өмнөх зан төлөв хэвээр)
  const { legacy: refusal } = contractFor(route, 'mn-Cyrl', { normDocuments: null, toolResults: [] });
  assert.equal(refusal.kind, 'norm_refusal');
});

test('validator · загварын бүрэн жагсаалт зөрчилгүй; баримт орхисон → FACT_MISSING → детерминист нэмэлт; зохиомол тоо/заалт хасагдана', () => {
  const { contract, nd } = contractFor();
  // (templateOnly горимд загвар оролцохгүй; validator нь хуучин клиент / Revit-ийн хамгаалалт хэвээр)
  // 1) загвар template-ийг өөрийн үгээр давтав (бүх код) → OK
  const good = `${nd.template.replace('**Олдсон холбогдох баримт: 11**', 'Өндөр барилгын цахилгаантай холбоотой 11 баримт олдлоо:')}

${nd.trailer}`;
  const ok = V.enforceContract(good, contract, 'mn-Cyrl');
  assert.equal(ok.validation.ok, true, JSON.stringify(ok.before.violations));
  assert.equal(ok.outcome, 'model');
  // 2) загвар ГАНЦ норм таамаглав (хуучин зан төлөв / богино адаптер) → FACT_MISSING = ХАТУУ → серверийн
  //    БҮРЭН template (код · нэр · линк · төлөв), factsLine-ийн линкгүй хагас засвар БИШ
  const one = 'Өндөр барилгын цахилгаанд БНбД 31-17-10 хамаарна. Линк: https://mcis.gov.mn/storage/uploads/process/202206/file_1654224802226730_161611878330710.pdf';
  const fixed = V.enforceContract(one, contract, 'mn-Cyrl');
  assert.ok(fixed.before.violations.some((v: { code: string; hard?: boolean }) => v.code === 'FACT_MISSING' && v.hard === true));
  assert.ok(V.hasHardViolation(fixed.before));
  assert.ok(fixed.answer.startsWith('**Олдсон холбогдох баримт: 11**'), 'template биш');
  for (const c of ['БД 43-104-12', 'БД 43-108-24', 'БНбД 23-02-08']) assert.ok(fixed.answer.includes(`**${c}**`), `${c} мөр алга`);
  assert.ok(fixed.answer.includes('#page=45'), 'холбоос алга');
  assert.equal(fixed.validation.ok, true);
  // 3) зохиомол заалт/тоо: «300 лк» хайрцагт байхгүй → UNSUPPORTED_NUMBER → өгүүлбэр хасагдана, жагсаалт хэвээр
  const invented = `${good}\nБНбД 23-02-08-д ажлын байрны гэрэлтүүлэг 300 лк-ээс багагүй байхаар заасан.`;
  const cut = V.enforceContract(invented, contract, 'mn-Cyrl');
  assert.ok(cut.before.violations.some((v: { code: string }) => v.code === 'UNSUPPORTED_NUMBER'));
  assert.ok(!cut.answer.includes('300 лк'));
  assert.ok(cut.answer.includes('БД 43-107-19'));
  // 4) хоёр удаа зөрсөн → серверийн жагсаалт (fallbackAnswer) бүхэлдээ, болгоомжлолтой
  const fb = V.fallbackAnswer(contract, 'mn-Cyrl');
  assert.ok(fb.includes('Олдсон холбогдох баримт: 11') && fb.includes('БНбД 3.05.06-90') && /шалгагдаагүй/.test(fb));
});

test('төлөв болгоомжтой · Worker parse нь runtime-ийн status_verified тугийг үл тоож ACTIVE-ийг л баталгаажсан гэнэ; template «шалгагдаагүй» гэж ил', () => {
  const r = LN.parseLocalNormTopicRoute({ ...RAW_ROUTE, results: RAW_ROUTE.results.map((x) => ({ ...x, status_verified: true })) })!;
  assert.equal(r.results.filter((x) => x.statusVerified).length, 5);
  const { data, nd } = contractFor(r);
  assert.equal(data.unverified_count, 6);
  assert.ok(!/\*\*БД 43-104-12\*\* \| [^|]+ \| MCIS/.test(nd.template));
  // англи хэл: ижил бүтэц, англи шошго
  const { nd: en } = contractFor(r, 'en');
  assert.match(en.template, /^\*\*Related documents found: 11\*\*/);
  assert.match(en.template, /\| UNVERIFIED \| \[Register p\.44\]/);
  assert.match(en.template, /Status legend: .*UNVERIFIED = listed in the 2025 register/);
});

test('cost/labour · төсвийн 113 мөр: хайрцагт эхний 15, count=113, template «харуулаагүй» гэж; хассан тоо note-д', () => {
  const many = { ...RAW_ROUTE, detected_topics: ['cost_estimation'], wants_cost: true, count: 113, excluded: { cost: 0, labour: 2 }, results: Array.from({ length: 113 }, (_, i) => ({ ...RAW_ROUTE.results[4]!, registry_id: `mn-construction:${String(i).padStart(20, '0')}`, code: `БД 81-1${String(i).padStart(2, '0')}-11`, title_mn: `Төсвийн норм ${i}` })) };
  const r = LN.parseLocalNormTopicRoute(many)!;
  assert.equal(r.total, 113);
  const { data, nd, contract } = contractFor(r);
  assert.equal(r.truncated, false, '113 < 160 тааз');
  assert.equal(data.shown, 15, 'prompt-ын хайрцаг ≤15');
  assert.equal(data.count, 113);
  // template нь БҮХ мөрийг (Worker parse тааз 160 хүртэл) харуулна — өмнө нь 15 л харагдаж байв
  assert.equal(data.all_documents.length, 113);
  assert.equal((nd.template.match(/^\| \d+ \| /gm) ?? []).length, 113);
  assert.ok(!nd.template.includes('харуулаагүй'));
  assert.match(data.note, /хөдөлмөр зарцуулалтын 2/);
  assert.equal(contract.facts.filter((f) => f.mustMention).length, 15);
  const box = PF.renderToolResults([ND.normDocumentsTool(r, 'mn-Cyrl')!], '2026-09-18');
  assert.ok(!box.includes('ТАСАРСАН'), `хайрцаг ${box.length} тэмдэгт`);
});

test('детерминист шийдвэртэй ээлж · norm_documents хэрэгсэл байсан ч TrustedNormResult гэрээ ЯЛНА (жагсаалт заалтын хариултыг солихгүй)', () => {
  const { tool, nd } = contractFor();
  // Бодит TrustedNormResult (нэрлэсэн баримт санд алга — детерминист татгалзал) — хөдөлгүүрийн үүсгэгч.
  const tn = NE.namedDocumentAbsentResult('УББ 11-202-00');
  const c = TF.buildTrustedContract({
    regulatory: true, evidenceCount: 0, normDecision: null, responseLanguage: 'mn-Cyrl', normTaskIndex: null, taskCount: 1, localNorm: null, metricNote: null,
    trustedNorm: tn as never, normRetrievalFailed: false, normDocuments: nd, toolResults: [tool], intent: 'NORMATIVE', retrievalNoMatch: false,
  } as never);
  assert.notEqual(c.legacyKind, 'norm_documents');
  assert.ok(c.norm !== null || c.answerMode === 'authoritative' || c.answerMode === 'refusal');
});

test('барилгын төрөл (2026-09-28, эзний бодит чат) — «худалдааны төв» тусгай норм алга гэж жагсаалтын ӨМНӨ ил хэлнэ', () => {
  const q = 'Mongold hudaldaanii tov barilaa gehed, tog us avah norm durem baidag uu';
  const d = ND.normDocumentsData(route, 'mn-Cyrl', q);
  assert.deepEqual(d.building_gap, { label: 'худалдааны төв, дэлгүүр', topics: ['цахилгаан'] });
  const t = ND.renderNormDocuments(d, 'mn-Cyrl');
  assert.ok(t.startsWith('Нормын бүртгэлд «худалдааны төв, дэлгүүр» гэсэн төрлийн барилгад зориулсан тусгай норм алга.'), t.slice(0, 120));
  assert.match(t, /сэдэв: цахилгаан/);
  // Кирилл ижил; англи хариулт англи шошготой.
  assert.equal(ND.normDocumentsData(route, 'mn-Cyrl', 'Худалдааны төв барихад тог, ус авах норм байдаг уу').building_gap?.label, 'худалдааны төв, дэлгүүр');
  assert.equal(ND.normDocumentsData(route, 'en', 'Which norms apply to electricity for a shopping mall?').building_gap?.label, 'shopping centres and shops');
  // Төрөл нэрлээгүй, эсвэл үр дүнгийн баримтын нэрэнд байгаа бол тайлбаргүй (өмнөх зан төлөв).
  assert.equal(ND.normDocumentsData(route, 'mn-Cyrl', 'Цахилгаантай холбоотой норм').building_gap, null);
  assert.equal(ND.normDocumentsData(route, 'mn-Cyrl').building_gap, null);
  assert.equal(ND.buildingTypeGap('shatahuun tugeeh stants barih', ['Шатахуун түгээх станц. Галын аюулгүйн норм'], 'mn-Cyrl'), null);
  assert.equal(ND.buildingTypeGap('зочид буудал барих', ['Шатахуун түгээх станц'], 'mn-Cyrl'), 'зочид буудал');
  // Гэрээ: тайлбар нь template-д, тоо агуулаагүй тул validator-ын тоон шалгалтад саад болохгүй.
  assert.ok(!/\d/.test(t.split('\n')[0]!));
});
