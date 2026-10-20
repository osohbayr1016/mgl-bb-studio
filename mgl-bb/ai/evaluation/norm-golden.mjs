#!/usr/bin/env node
/**
 * `npm run ai:eval:norm [-- --db <зам>] [--doc <doc_id>] [--json <гаралт>]`
 *
 * НОРМАТИВ ХООЛОЙН АЛТАН ТЕСТ.
 *
 * ⚠️ ЭНЭ НЬ «СУРГАЛТ АЖИЛЛАВ УУ» ГЭДГИЙГ ХЭМЖИХ ЦОРЫН ГАНЦ ЭХ СУРВАЛЖ.
 *    CLAUDE.md-ийн дүрэм: хэмжээгүй тоог баримтад бичихийг хориглоно.
 *
 * ХЭМЖИХ ЗҮЙЛС:
 *    Recall@5              — хүлээгдэж буй эх мөр эхний 5 нотолгоонд орсон эсэх
 *    Rule-match accuracy   — хоолой ЯГ тэр дүрмийг сонгосон эсэх
 *    Threshold accuracy    — 299 vs 300 м², 15 vs 16 хоног шийдвэр зөв эсэх
 *    Citation accuracy     — эшлэлийн хуудас таарсан эсэх
 *    Unverified leakage    — баталгаажаагүй дүрэм «verified» болж гоожсон эсэх
 *
 * ⚠️ БАРИМТ ТУС БҮРЭЭР БАС ЗАДЛАНА.  Нэгтгэсэн тоо нь нэг баримтын
 *    доройтлыг нөгөөгийнхөө сайжралтаар НУУНА — хоёр багц шингэсний дараа
 *    энэ нь бодит эрсдэл.
 *
 * ⚠️ LEAKAGE 0-ЭЭС ӨӨР БОЛ ЭНЭ СКРИПТ УНАНА (exit 1).  Тэр нь
 *    хэрэгжүүлэлтийн алдаа биш, БОДЛОГЫН эвдрэл.
 */
import { resolve, dirname, join } from 'node:path';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../runtime/src/config.ts';
import { openKnowledgeDb } from '../retrieval/src/db.ts';
import { askNorm } from '../retrieval/src/pipeline.ts';
import { isExecutableVerification } from '../retrieval/src/rules.ts';
import { isCitable } from '../retrieval/src/citation.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : (argv[i + 1] ?? null);
};

const allMisses = [];
const MISSES_OUT = flag('misses');

const cfg = loadConfig();
const dbPath = resolve(flag('db') ?? cfg.knowledgeDb);
if (!existsSync(dbPath)) {
  process.stderr.write(
    `\n  ✖ Мэдлэгийн сан олдсонгүй: ${dbPath}\n` +
      '    Эхлээд:  npm run ai:ingest:norm -- --all\n\n',
  );
  process.exit(1);
}

const db = openKnowledgeDb({ path: dbPath });
const onlyDoc = flag('doc');

/* ── Лавлах хүснэгтүүд ────────────────────────────────────────────── */

const ruleChunk = new Map();
const ruleVerify = new Map();
const ruleKind = new Map();
for (const r of db.prepare('SELECT rule_id, chunk_id, verification_status, rule_kind FROM ai_rules').all()) {
  ruleChunk.set(r.rule_id, r.chunk_id);
  ruleVerify.set(r.rule_id, r.verification_status);
  ruleKind.set(r.rule_id, r.rule_kind);
}
const chunkKind = new Map();
for (const c of db.prepare('SELECT chunk_id, kind FROM ai_chunks').all()) chunkKind.set(c.chunk_id, c.kind);
/**
 * ТООН дүрэмтэй хэсгүүд (өөрийн эсвэл `<хэсэг>:table:…` угтвартай дүрмээр).
 * ⚠️ Хүлээгдэх id нь дүрэм биш ХЭСЭГ байхад л хэрэглэнэ — гал түймрийн
 *    C011 (`…:clause:5`, `apply_clause_5: true`) нь тоон дүрэмгүй заалт тул
 *    эх сурвалж олдсон эсэхээр л шалгагдах ёстой; boolean байгаа гэдгээр
 *    тоон кейс гэж үзвэл тэр кейс ХУДАЛ унана (хэмжсэн).
 */
const NUMERIC_KINDS = new Set(['table_row', 'threshold', 'deadline']);
const chunkHasNumericRule = new Set();
for (const [ruleId, kind] of ruleKind) {
  if (!NUMERIC_KINDS.has(kind)) continue;
  const chunk = ruleChunk.get(ruleId);
  chunkHasNumericRule.add(chunk);
  const i = chunk.indexOf(':table:');
  if (i > 0) chunkHasNumericRule.add(chunk.slice(0, i));
}

/**
 * Хоолойн сонгосон дүрэм нь ХҮЛЭЭГДЭЖ БУЙ хаягт хамаарах уу.
 *
 * ⚠️ БНбД 11-03-21 нь `rule_id`-г ХЭСГИЙН id-тэй ИЖИЛ өгдөг («…:clause:3.9»),
 *    харин санд тэр заалтын дүрэм нь `…:clause:3.9:numeric`, хүснэгтийн мөр нь
 *    `…:clause:5.2:table:5-1:simple:low` гэсэн УГТВАРТАЙ id-тай (нэг заалтад
 *    олон дүрэм — PK мөргөлдөнө).  Угтвар нь «энэ дүрэм тэр заалтынх» гэсэн
 *    машин уншихуйц холбоос тул түүгээр тулгана.  Яг таарах нь хэвээр эхний
 *    сонголт; өмнөх гурван багцад энэ салаа ХЭЗЭЭ Ч хүрэхгүй.
 */
function ruleBelongs(gotRuleId, expectedRuleId, expectedChunk) {
  if (gotRuleId === null || gotRuleId === undefined) return false;
  if (gotRuleId === expectedRuleId) return true;
  const gotChunk = ruleChunk.get(gotRuleId) ?? null;
  if (expectedChunk !== null && gotChunk === expectedChunk) return true;
  const prefix = `${expectedChunk ?? expectedRuleId}:`;
  return gotRuleId.startsWith(prefix) || (gotChunk !== null && gotChunk.startsWith(prefix));
}

/**
 * Хүлээгдэх тугийн НЭРИЙГ хоолойн нэрлэсэн үр дүнтэй тааруулна.
 *
 * ⚠️ Багц бүр өөр үг хэрэглэдэг: `meets_depth`, `within_range`, `meets_minimum`.
 *    Дүрэм: (1) яг ижил нэр; (2) `meets_/within_/required_/…` гэсэн хэлбэрийн
 *    үгийг хасаад үлдсэн үг (`depth`, `count`, `interval`, `range`) хоолойн
 *    түлхүүрт ОРСОН байвал тэр; (3) юу ч үлдэхгүй бол ГАНЦ шийдэгдсэн
 *    (null биш) туг байвал тэр.  `overall*` нь БҮХ тугийн AND — нэг нь ч
 *    null бол `null` (шийдэгдээгүй, худал биш).
 */
const FLAG_FILLER = new Set(['meets', 'within', 'required', 'requirement', 'minimum', 'met', 'ok', 'is']);
function matchFlag(key, got) {
  const keys = Object.keys(got);
  if (/^overall/.test(key)) {
    if (keys.length === 0) return undefined;
    const vals = keys.map((k) => got[k]);
    return vals.some((v) => v === null || v === undefined) ? null : vals.every((v) => v === true);
  }
  if (key in got) return got[key];
  const toks = key.split('_').filter((t) => !FLAG_FILLER.has(t));
  if (toks.length > 0) {
    const hit = keys.filter((k) => toks.every((t) => k.includes(t)));
    if (hit.length === 1) return got[hit[0]];
  }
  if (keys.length === 1) return got[keys[0]];
  // Нийлмэл дүрмийн нэгдсэн туг («үйлдвэрлэл зогсоох эрх бий юу») — хөдөлгүүр
  // `all_conditions`-ыг зөвхөн `evaluate_all_conditions` бодлоготой дүрэмд өгнө.
  if ('all_conditions' in got) return got.all_conditions;
  const decided = keys.filter((k) => got[k] !== null && got[k] !== undefined);
  return decided.length === 1 ? got[decided[0]] : undefined;
}

const docs = db
  .prepare('SELECT doc_id, code, title_mn, effective_status FROM ai_documents ORDER BY doc_id')
  .all()
  .filter((d) => onlyDoc === null || d.doc_id === onlyDoc);

/** Баримт тус бүрийн хураангуй. */
const perDoc = new Map();
const bucket = (docId) => {
  if (!perDoc.has(docId)) {
    perDoc.set(docId, {
      tests: 0,
      recall: 0,
      rule: 0,
      cite: 0,
      leakage: 0,
      byLang: new Map(),
      cases: 0,
      casesOk: 0,
      caseFails: [],
      caseBlocked: [],
      misses: [],
      // GOLD v3: «Эх сурвалж: … — URL» гэрээ.  Зөвхөн `expected_source`-тэй
      // тестэд хэмжигдэнэ — байхгүй баримтад 0% гэж бичих нь худал.
      srcN: 0,
      srcOk: 0,
      srcFails: [],
    });
  }
  return perDoc.get(docId);
};

/* ── 1. Хайлтын тестүүд ───────────────────────────────────────────── */

const leaks = [];

for (const d of docs) {
  const tests = db.prepare('SELECT * FROM ai_query_tests WHERE doc_id = ?').all(d.doc_id);
  const b = bucket(d.doc_id);

  for (const t of tests) {
    const ans = askNorm(db, t.query, { evidenceLimit: 5 });

    // ⚠️ ХОЁР БАГЦ ХОЁР ЗҮЙЛ ХҮЛЭЭДЭГ: БНбД нь ДҮРМИЙН id-г, УББ нь
    //    ХЭСГИЙН id-г.  Аль байгааг нь ашиглана; дүрмийн id өгсөн бол
    //    түүний эх хэсэг рүү хөрвүүлж Recall-ыг ижил нэгжээр хэмжинэ.
    const expectedChunk =
      t.expected_chunk_id ?? (t.expected_rule_id ? (ruleChunk.get(t.expected_rule_id) ?? null) : null);

    const inTop5 = expectedChunk !== null && ans.evidence.some((e) => e.chunk_id === expectedChunk);

    // ⚠️ ДҮРМИЙН ТААРЦЫГ ЗӨВХӨН ДҮРЭМ ХҮЛЭЭСЭН ТЕСТЭД ХЭМЖИНЭ.  УББ-ийн
    //    тестүүд заалт хүлээдэг тул тэднийг «дүрэм таараагүй» гэж тоолох
    //    нь хэмжүүрийг утгагүй болгоно.
    const ruleMeasured = t.expected_rule_id !== null;
    const exactRule = ruleMeasured && ruleBelongs(ans.rule_id, t.expected_rule_id, expectedChunk);

    const citeOk =
      t.expected_page === null || (ans.citation !== null && ans.citation.page === t.expected_page);

    // ⚠️ ГООЖИЛТЫН ТОДОРХОЙЛОЛТ: баталгаажаагүй дүрмээр `verified` төлөв.
    //    Дүрмийг ХАЙЖ олох нь зөв; түүгээр ИТГЭЛТЭЙ хариулах нь БУРУУ.
    // ⚠️ ХААЛГАТАЙГАА НЭГ ЖАГСААЛТААС (`rules.ts` EXECUTABLE_VERIFICATION).  Энд
    //    `'verified_from_page_image'` гэж хатуу бичсэн байсан — CLAUDE.md-ийн
    //    «гурван газар давхардсан мөр» яг энэ файлд ҮЛДСЭН байв: legalinfo-оос
    //    шалгасан багц орж ирмэгц зөв хариу бүр «гоожилт» гэж тоологдож,
    //    скрипт exit 1 өгөх байсан.
    if (ans.status === 'verified' && !isExecutableVerification(ruleVerify.get(ans.rule_id) ?? '')) {
      b.leakage += 1;
      if (leaks.length < 10) leaks.push({ doc: d.doc_id, test: t.test_id, rule: ans.rule_id });
    }

    // ⚠️ ЭХ СУРВАЛЖИЙН URL — v3 гэрээ (`answer_must_include_source`).  Хоолойн
    //    эшлэл нь ЯГ тэр албан ёсны URL-ыг үүрэх ёстой; зохиосон/өөр URL = унана.
    //    Зөв заалт олдоогүй бол энэ ч унана (эшлэл өөр хэсгээс гарна).
    const raw = JSON.parse(t.expected_json ?? '{}');
    // СНиП багц ХОЁР эх сурвалж (Монголын жагсаалт + техникийн mirror) хүлээдэг
    // — `expected_sources` массив; эшлэлийн URL аль нэгтэй нь таарвал зөв.
    const wantUrls = [
      ...(raw.expected_source?.url ? [raw.expected_source.url] : []),
      ...(Array.isArray(raw.expected_sources) ? raw.expected_sources.map((x) => x?.url).filter(Boolean) : []),
    ];
    if (raw.answer_must_include_source === true && wantUrls.length > 0) {
      b.srcN += 1;
      const url = ans.citation?.source_url ?? null;
      if (url !== null && wantUrls.includes(url) && inTop5) b.srcOk += 1;
      else if (b.srcFails.length < 5) b.srcFails.push({ test: t.test_id, got: url, want: wantUrls[0] });
    }

    b.tests += 1;
    if (inTop5) b.recall += 1;
    // Оношилгоо: --misses <файл> → БҮХ алдсан тестийг бичнэ (хаалгын өөрчлөлтийг харьцуулахад).
    if (!inTop5 && MISSES_OUT !== null) allMisses.push({ doc: d.doc_id, test: t.test_id, lang: t.language, query: t.query, expected: expectedChunk, got: (ans.evidence ?? []).slice(0, 3).map((e) => e.chunk_id), status: ans.status, reason: ans.no_match_reason ?? null });
    if (exactRule) b.rule += 1;
    if (citeOk) b.cite += 1;
    if (!inTop5 && b.misses.length < 8) {
      b.misses.push({ lang: t.language, query: t.query.slice(0, 66), expected: expectedChunk });
    }

    const lb = b.byLang.get(t.language) ?? { n: 0, recall: 0, rule: 0, ruleN: 0 };
    lb.n += 1;
    if (inTop5) lb.recall += 1;
    if (ruleMeasured) {
      lb.ruleN += 1;
      if (exactRule) lb.rule += 1;
    }
    b.byLang.set(t.language, lb);
  }
}

/* ── 2. Тооцооны алтан кейс ───────────────────────────────────────── */

/**
 * ⚠️ ХҮЛЭЭГДЭХ ҮР ДҮН НЬ БАГЦ БҮРД ӨӨР НЭРТЭЙ.  БНбД нь `{GUAT, GMDH}`,
 *    УББ нь `{independent_client_office_mandatory: true}`,
 *    `{deadline_met: false}` гэх мэт.  Багц нь машин уншихуйц түлхүүр
 *    ӨГДӨГГҮЙ тул нэрээр тулгах боломжгүй — ГЭВЧ логик утга нь ганц.
 *    Тиймээс: хүлээгдэх объектоос BOOLEAN утгуудыг гаргаж авна.
 *      • `GUAT`/`GMDH` нэртэй бол ижил нэрийн үр дүнтэй тулгана
 *      • өөр тохиолдолд ГАНЦ boolean байвал хоолойн ГАНЦ шийдвэртэй тулгана
 *    Boolean огт байхгүй кейс (эрх жагсаах, алхам жагсаах) нь тоон
 *    шийдвэрийн кейс БИШ — эх сурвалж олдсон эсэхээр л шалгана.
 */
function expectedBooleans(expected) {
  const out = {};
  for (const [k, v] of Object.entries(expected)) {
    if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

/**
 * ⚠️ WORKER-ИЙН БҮРТГЭЛД ТООЦООЛОГДОХ БАГЦ (БД 21-101-12, 2026-09-11).  Дүрэм бүр
 *    `decision_policy = text_only_executable_in_worker_registry`: локал хайлт ЗӨВХӨН заалт
 *    олно, харин томьёо/босго/дэд ангиллыг Cloudflare Worker-ийн хөрвүүлсэн бүртгэл
 *    (`backend/src/lib/mglai/norm/`) тооцоолно — `calculators.test.ts` 14 кейсийг тэнд
 *    ажиллуулдаг.  Тэдгээр тоон кейсийг эндхийн хайлтын алтан хувьд ТООЦОХГҮЙ, харин
 *    тусад нь тоолж ил бичнэ («бүртгэлд тооцоолно»).
 */
const workerRegistryDocs = new Set(
  db
    .prepare(
      `SELECT doc_id FROM ai_rules GROUP BY doc_id
         HAVING SUM(CASE WHEN decision_policy = 'text_only_executable_in_worker_registry' THEN 0 ELSE 1 END) = 0`,
    )
    .all()
    .map((r) => r.doc_id),
);

for (const d of docs) {
  const cases = db.prepare('SELECT * FROM ai_calculation_cases WHERE doc_id = ?').all(d.doc_id);
  const b = bucket(d.doc_id);

  for (const c of cases) {
    const ctx = JSON.parse(c.context_json);
    const expected = JSON.parse(c.expected_json);
    const wantBools = expectedBooleans(expected);
    const numericExpected = Object.values(expected).some((v) => typeof v === 'number' || typeof v === 'boolean');
    if (workerRegistryDocs.has(d.doc_id) && numericExpected) {
      b.casesWorker = (b.casesWorker ?? 0) + 1;
      continue;
    }
    const ans = askNorm(db, c.query_mn, { context: ctx, evidenceLimit: 5 });

    b.cases += 1;

    const expectedChunk = c.expected_rule_id ? (ruleChunk.get(c.expected_rule_id) ?? c.expected_rule_id) : null;
    const kind = c.expected_rule_id ? (ruleKind.get(c.expected_rule_id) ?? null) : null;
    // ⚠️ Хүлээгдэх id нь ХЭСГИЙН id байж болно (БНбД 11-03-21) — тэгвэл дүрмийн
    //    ангилал мэдэгдэхгүй.  Boolean хүлээсэн, хуулийн ТӨЛӨВИЙН хэсэг биш бол
    //    тоон кейс гэж үзнэ: хоолой шийдвэр гаргах ЁСТОЙ, зөвхөн олох биш.
    const numeric =
      kind === 'table_row' ||
      kind === 'threshold' ||
      kind === 'deadline' ||
      (kind === null &&
        Object.keys(wantBools).length > 0 &&
        chunkKind.get(expectedChunk) !== 'legal_status' &&
        chunkHasNumericRule.has(expectedChunk));

    // ⚠️ ТООН БУС КЕЙСИЙГ ТООН НАРИЙВЧЛАЛД ТООЦВОЛ ХЭМЖҮҮР ГАЖНА.
    //    «Захиалагчийн эрх юу вэ?» гэсэн кейст босго БАЙХГҮЙ — түүнийг
    //    эх сурвалж олсон эсэхээр шалгах нь ЗӨВ хэмжүүр.
    if (!numeric || Object.keys(wantBools).length === 0) {
      const found =
        expectedChunk !== null &&
        (ans.evidence.some((e) => e.chunk_id === expectedChunk) || ans.rule_id === c.expected_rule_id);
      if (found) b.casesOk += 1;
      else b.caseFails.push({ case: c.case_id, why: 'эх заалт эхний 5-д ороогүй' });
      continue;
    }

    const okRule = ruleBelongs(ans.rule_id, c.expected_rule_id, expectedChunk);

    // Хүлээгдэх туг бүрийг хоолойн үр дүнтэй тулгана.
    const got = ans.decisions ?? {};
    let okFlags = true;
    const flagNotes = [];
    for (const [k, want] of Object.entries(wantBools)) {
      /**
       * ⚠️ ЗАРИМ АЛТАН КЕЙС «ШИЙДВЭР ГАРГАЖ БОЛОХГҮЙ» ГЭЖ ШААРДДАГ.
       *
       *    УББ-ийн G006: {elapsed_days: 50} + «хүлээлгэн өгснөөс хойш 2
       *    САРЫН дотор» → `requires_calendar_month_evaluation: true`.
       *    Энэ нь «үнэн» гэсэн үр дүн БИШ — «хоногоор шийдэж БОЛОХГҮЙ,
       *    хуанлиар тоолох ёстой» гэсэн ЗААВАР.  2 сар нь 59-62 хоног
       *    байж болох тул 50 хоног нь багтах эсэх нь хуанлиас хамаарна.
       *
       *    Хоолой яг үүнийг `null`-аар илэрхийлдэг (нэгж таарахгүй тул
       *    `missing`).  Тиймээс ийм түлхүүрийг `null` хүлээж шалгана —
       *    `true`-тэй тулгах нь хоолойг ХУДАЛ ИТГЭЛТЭЙ болгохыг шаардана.
       */
      // ⚠️ `_check` түлхүүр (`requires_4_20_upgrade_check`, `requires_spacing_check`) нь БД 21-101-12-ын
      //    follow-up ТУГ — Worker-ийн хөдөлгүүр `true` гэж ШИЙДДЭГ (шийдвэргүй биш); тэдгээр кейс
      //    дээрх `workerRegistryDocs`-оор тусдаа тоологдоно.  Энд зөвхөн `_evaluation` (хуанли).
      const wantsNonDecision = /^requires_.*_evaluation$/.test(k) && want === true;
      const actual = matchFlag(k, got);

      if (wantsNonDecision) {
        if (actual !== null && actual !== undefined) {
          okFlags = false;
          flagNotes.push(`${k}: детерминист шийдвэр гарах ЁСГҮЙ байсан (${actual})`);
        }
        continue;
      }
      if (actual !== want) {
        okFlags = false;
        flagNotes.push(`${k} ${actual} ≠ ${want}`);
      }
    }

    // ⚠️ ХУУДАС ЗААВАЛ БИШ — `citation.ts`-ийн `isCitable`-тай ижил дүрэм: хуудас
    //    ЭСВЭЛ заалт ЭСВЭЛ хүснэгт.  БНбД 11-03-21 заалтын хуудсыг ЗОРИУД
    //    зохиодоггүй (README) — заалтын дугаар нь хуулийн хаяг.
    // ⚠️ НЭГ ЭХ СУРВАЛЖ: `citation.ts`-ийн `isCitable` — өмнө нь энд гурван талбарыг
    //    ДАХИН бичсэн байсан тул хавсралтын хаягийг хүлээн авах засвар (2026-09-11)
    //    хоолойд орж, хэмжүүрт ороогүй байх байв.
    const okCite = c.must_cite_source === 0 || (ans.citation !== null && isCitable(ans.citation));

    // GAP-025: зөв дүрэм олдсон ч түүний баталгаажилтын төлөв цагаан жагсаалтад БАЙХГҮЙ тул
    //    хөдөлгүүр зориуд шийдвэр гаргаагүй (`blocked_unverified`) — энэ нь хайлт/хөдөлгүүрийн
    //    АЛДАА биш, ЭЗНИЙ whitelist шийдвэр хүлээж буй хаалт.  Хувь (`casesOk`) ХЭВЭЭР унана
    //    (ногоон болгохгүй), гэвч тусад нь тоолж, ямар төлөв хаасныг ил бичнэ.
    const ruleStatus = okRule && ans.rule_id ? ruleVerify.get(ans.rule_id) : undefined;
    const blockedByPolicy =
      okRule && !okFlags && ruleStatus !== undefined && !isExecutableVerification(ruleStatus) && Object.keys(got).length === 0;
    if (okRule && okFlags && okCite) b.casesOk += 1;
    else if (blockedByPolicy) {
      b.casesBlocked = (b.casesBlocked ?? 0) + 1;
      b.caseBlocked.push({ case: c.case_id, status: ruleStatus });
    } else {
      b.caseFails.push({
        case: c.case_id,
        why: [
          okRule ? null : `дүрэм ${ans.rule_id} ≠ ${c.expected_rule_id}`,
          ...flagNotes,
          okCite ? null : 'эшлэлгүй',
        ]
          .filter(Boolean)
          .join(' · '),
      });
    }
  }
}

/* ── 3. Захиалагчийн тусгаарлалт (§6) ─────────────────────────────── */

const anyTest = db.prepare('SELECT query FROM ai_query_tests LIMIT 1').get();
const clientProbe = askNorm(db, anyTest?.query ?? 'галын дохиолол', { audience: 'client' });
const clientLeak =
  clientProbe.evidence.length === 0
    ? { n: 0 }
    : db
        .prepare(
          `SELECT COUNT(*) AS n FROM ai_chunks
            WHERE visibility <> 'public_norm'
              AND chunk_id IN (${clientProbe.evidence.map(() => '?').join(',')})`,
        )
        .get(...clientProbe.evidence.map((e) => e.chunk_id));

/* ── 4. NO_MATCH зөв эсэх (§23–24) ─────────────────────────────────── */
/**
 * ⚠️ ХАМААРАЛГҮЙ асуултад хоолой `insufficient_evidence` буцаах ЁСТОЙ.
 *    Хэмжигдсэн (2026-09-10): хаалга нэмэхээс өмнө «Хамгийн хоцорсон
 *    таскууд юу байна» гэсэн ERP асуултад ч УББ-11-201-00-ын заалт
 *    `supported` төлөвтэй ЭШЛЭЛТЭЙ буцдаг байв.  Recall@5 нь энэ
 *    доройтлыг ХЭЗЭЭ Ч барихгүй — тэр зөвхөн «зөв мөр орсон уу» гэж
 *    асуудаг, «хамааралгүй мөр орсон уу» гэж биш.
 *
 * ⚠️ Энэ жагсаалт нь корпуст БАЙХГҮЙ сэдвүүд.  Шинэ багц (жишээ нь
 *    ажилтны дүрэм) шингэвэл тухайн мөрийг ЭНДЭЭС ХАС — тэр үед
 *    «олдох» нь зөв болно.
 */
const NO_MATCH_QUERIES = [
  'Хамгийн хоцорсон таскууд юу байна',
  'Манай компанид хэдэн ажилтан байна',
  'Deadline hamgiin oir project ali ve',
  'Сайн байна уу, чи юу хийж чадах вэ',
  // ⚠️ «Revit дээр wall-ийн area» ЭНД ОРОХГҮЙ: «area → нийт талбай» гэсэн
  //    alias нь зориудын гүүр бөгөөд БНбД-ийн талбайн мөрийг олдог; тэр
  //    асуултыг сервер ОГТ норм руу явуулдаггүй (REVIT_READ санаа).
  'Цалингийн орлогын албан татвар хэдэн хувь вэ',
  'Автомашины улсын дугаар солих журам',
  'Excel файлыг PDF болгож өгөөч',
  'What is the weather in Ulaanbaatar today',
];
const noMatch = { n: NO_MATCH_QUERIES.length, ok: 0, fails: [] };
for (const nq of NO_MATCH_QUERIES) {
  const a = askNorm(db, nq, { evidenceLimit: 5 });
  if (a.status === 'insufficient_evidence') noMatch.ok += 1;
  else noMatch.fails.push({ query: nq, status: a.status, cite: a.citation?.label_mn ?? null });
}

/* ── Тайлан ───────────────────────────────────────────────────────── */

const pct = (a, b) => (b === 0 ? 0 : Math.round((a / b) * 1000) / 10);

let totTests = 0;
let totRecall = 0;
let totCite = 0;
let totLeak = 0;
let totCases = 0;
let totCasesOk = 0;
let totCasesBlocked = 0;
let totRuleN = 0;
let totRule = 0;

process.stdout.write('\nMGL AI · норматив алтан тест\n');
process.stdout.write(`  сан: ${dbPath}\n`);

const report = { measured_at: new Date().toISOString(), db: dbPath, documents: {} };

for (const d of docs) {
  const b = perDoc.get(d.doc_id);
  if (b === undefined || (b.tests === 0 && b.cases === 0)) continue;

  const ruleN = [...b.byLang.values()].reduce((a, x) => a + x.ruleN, 0);
  totTests += b.tests;
  totRecall += b.recall;
  totCite += b.cite;
  totLeak += b.leakage;
  totCases += b.cases;
  totCasesOk += b.casesOk;
  totCasesBlocked += b.casesBlocked ?? 0;
  totRuleN += ruleN;
  totRule += b.rule;

  process.stdout.write(`\n── ${d.code} · ${d.title_mn}\n`);
  process.stdout.write(`   Хайлтын тест:       ${b.tests}\n`);
  process.stdout.write(`   Recall@5:           ${pct(b.recall, b.tests)}%  (${b.recall}/${b.tests})\n`);
  if (ruleN > 0) {
    process.stdout.write(`   Rule-match:         ${pct(b.rule, ruleN)}%  (${b.rule}/${ruleN})\n`);
  }
  process.stdout.write(`   Citation (хуудас):  ${pct(b.cite, b.tests)}%  (${b.cite}/${b.tests})\n`);
  process.stdout.write(`   Алтан кейс:         ${pct(b.casesOk, b.cases)}%  (${b.casesOk}/${b.cases})${b.casesWorker ? `  + ${b.casesWorker} тоон кейс Worker-ийн бүртгэлд (backend calculators.test.ts)` : ''}\n`);
  process.stdout.write(`   Unverified leakage: ${b.leakage}   ← 0 байх ЁСТОЙ\n`);
  if (b.srcN > 0) {
    process.stdout.write(`   Эх сурвалжийн URL:  ${pct(b.srcOk, b.srcN)}%  (${b.srcOk}/${b.srcN})\n`);
    for (const f of b.srcFails) process.stdout.write(`     ✖ ${f.test}: ${f.got ?? 'URL алга'}\n`);
  }
  process.stdout.write('   Хэлээр:\n');
  for (const [lang, x] of b.byLang) {
    const rulePart = x.ruleN > 0 ? `   rule ${String(pct(x.rule, x.ruleN)).padStart(5)}%` : '';
    process.stdout.write(
      `     ${lang.padEnd(8)}  recall@5 ${String(pct(x.recall, x.n)).padStart(5)}%${rulePart}   (${x.n})\n`,
    );
  }
  if (b.misses.length > 0) {
    process.stdout.write('   Олдоогүй жишээ:\n');
    for (const m of b.misses) process.stdout.write(`     [${m.lang}] ${m.query}…  → ${m.expected}\n`);
  }
  if (b.caseFails.length > 0) {
    process.stdout.write('   Кейсийн алдаа:\n');
    for (const f of b.caseFails) process.stdout.write(`     ${f.case}: ${f.why}\n`);
  }
  if (b.caseBlocked.length > 0) {
    const statuses = [...new Set(b.caseBlocked.map((x) => x.status))].join(', ');
    process.stdout.write(`   Хаалттай кейс (төлөв цагаан жагсаалтад байхгүй — эзний шийдвэр): ${b.caseBlocked.length} · ${statuses}\n`);
    process.stdout.write(`     ${b.caseBlocked.map((x) => x.case).join(', ')}\n`);
  }

  report.documents[d.doc_id] = {
    code: d.code,
    effective_status: d.effective_status,
    retrieval_tests: b.tests,
    recall_at_5: pct(b.recall, b.tests),
    rule_match_accuracy: ruleN > 0 ? pct(b.rule, ruleN) : null,
    citation_accuracy: pct(b.cite, b.tests),
    golden_cases: `${b.casesOk}/${b.cases}`,
    golden_case_accuracy: pct(b.casesOk, b.cases),
    unverified_rule_leakage: b.leakage,
    source_url_accuracy: b.srcN > 0 ? pct(b.srcOk, b.srcN) : null,
    by_language: Object.fromEntries(
      [...b.byLang].map(([k, v]) => [
        k,
        { n: v.n, recall_at_5: pct(v.recall, v.n), rule_match: v.ruleN > 0 ? pct(v.rule, v.ruleN) : null },
      ]),
    ),
  };
}

process.stdout.write('\n── НИЙТ\n');
process.stdout.write(`   Recall@5:           ${pct(totRecall, totTests)}%  (${totRecall}/${totTests})\n`);
if (totRuleN > 0) {
  process.stdout.write(`   Rule-match:         ${pct(totRule, totRuleN)}%  (${totRule}/${totRuleN})\n`);
}
process.stdout.write(`   Citation:           ${pct(totCite, totTests)}%  (${totCite}/${totTests})\n`);
process.stdout.write(
  `   Алтан кейс:         ${pct(totCasesOk, totCases)}%  (${totCasesOk}/${totCases})` +
    (totCasesBlocked > 0 ? `  — үүнээс ${totCasesBlocked} нь цагаан жагсаалтгүй төлөвөөр ХААЛТТАЙ (GAP-025, эзний шийдвэр)` : '') +
    '\n',
);
process.stdout.write(`   Unverified leakage: ${totLeak}\n`);
process.stdout.write(
  `   Захиалагчийн тусгаарлалт: ${clientLeak.n === 0 ? '✔ нээлттэй норм Л' : `✖ ${clientLeak.n} хаалттай мөр гоожив`}\n`,
);
process.stdout.write(`   NO_MATCH зөв:       ${pct(noMatch.ok, noMatch.n)}%  (${noMatch.ok}/${noMatch.n})\n`);
if (noMatch.fails.length > 0) {
  process.stdout.write('\n  ✖ ХАМААРАЛГҮЙ асуултад эшлэл гарав (хаалга цоорсон):\n');
  for (const f of noMatch.fails) process.stdout.write(`    «${f.query}» → ${f.status} ${f.cite ?? ''}\n`);
}

if (leaks.length > 0) {
  process.stdout.write('\n  ✖ ГООЖИЛТ (баталгаажаагүй дүрэм итгэлтэй хариу болов):\n');
  for (const l of leaks) process.stdout.write(`    ${l.doc}  ${l.rule}\n`);
}

report.total = {
  retrieval_tests: totTests,
  recall_at_5: pct(totRecall, totTests),
  rule_match_accuracy: totRuleN > 0 ? pct(totRule, totRuleN) : null,
  citation_accuracy: pct(totCite, totTests),
  golden_case_accuracy: pct(totCasesOk, totCases),
  golden_cases_blocked_by_whitelist: totCasesBlocked,
  unverified_rule_leakage: totLeak,
  client_isolation_leak: clientLeak.n,
  no_match_correct: `${noMatch.ok}/${noMatch.n}`,
  no_match_failures: noMatch.fails,
};
// ⚠️ Вектор хөл ӨНӨӨДӨР унтарсан — тоог «бүрэн гибрид»-ийнх мэт ишлэхээс
//    сэргийлж тайланд ИЛ бичнэ (§12).
report.vector_leg = 'disabled (NullVectorIndex — sqlite-vec / embedding загвар суулгаагүй)';

const out =
  flag('json') ??
  join(HERE, 'benchmarks', `norm-golden-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
process.stdout.write(`\n  → ${out}\n\n`);
if (MISSES_OUT !== null) {
  writeFileSync(MISSES_OUT, JSON.stringify(allMisses, null, 1), 'utf8');
  process.stdout.write(`  → алдсан тест ${allMisses.length}: ${MISSES_OUT}
`);
}

db.close();

// ⚠️ ГООЖИЛТ нь БОДЛОГЫН эвдрэл — build-ыг УНАГААНА.
if (totLeak > 0 || clientLeak.n > 0) process.exitCode = 1;
