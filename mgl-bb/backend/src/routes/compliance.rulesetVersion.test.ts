/**
 * `routes/compliance.ts` — `ruleset_version` нь ЦАГИЙН БИШ, АГУУЛГЫН функц.
 *
 * Run with:  node --test src/routes/compliance.rulesetVersion.test.ts
 *
 * ⚠️ ЯАГААД ЭНЭ ТЕСТ ОРШИН БАЙНА ВЭ.  `rulesetVersionOf` нь өмнө нь
 *    `<өнөөдрийн огноо>.<digest>` буцаадаг байсан.  `ruleset_version` нь
 *    ХЭШЛЭГДЭХ биед орж (§7.5), `packSha256` нь ЗӨВХӨН `pack_sha256` +
 *    `generated_at` ХОЁРЫГ маскладаг тул UTC шөнө дунд бүрд `pack_sha256`
 *    шалтгаангүйгээр ХӨДӨЛДӨГ байв:
 *      · `2-3`-ын ГУРАВДАХЬ хуучруулах өдөөгч → төсөл БҮРИЙН олдвор БҮР
 *        `stale_reason='ruleset'` болно, дүрэм НЭГ Ч өөрчлөгдөөгүй байхад,
 *      · `?have=` товчлол өдрийн эхний хүсэлтэд ОНОХГҮЙ → ~20 машин өдөр бүр
 *        багцаа дахин татна,
 *      · `ON CONFLICT (team_code, ruleset_version) DO NOTHING` ХЭЗЭЭ Ч
 *        ажиллахгүй → `rule_pack_versions` баг тутамд өдрийн мөр хуримтлуулна.
 *
 * ⚠️ `ruleApplicability.test.ts`-ийн `packSha256: generated_at ...` тест нь
 *    ҮҮНИЙГ БАРЬЖ ЧАДДАГГҮЙ: тэр нь `ruleset_version`-ыг ГАРААР ТОГТМОЛ
 *    өгдөг тул ХООСОН ДАВНА.  Энд ХУВИЛБАРЫГ ӨӨРИЙГ нь гаргуулж, огноог
 *    ХУУРАМЧЛАН ӨӨРЧИЛЖ тулгана.
 *
 * ⚠️ `registerHooks` — эх файлууд өргөтгөлгүй харьцангуй импорт хэрэглэдэг тул
 *    `node --test` дор шууд `import` УНАНА (tsc ногоон хэвээр).
 *    `bimEvents.test.ts:24-31`-ийн ЯГ ИЖИЛ хэв маяг.
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

const C = await import('./compliance.ts');
const P = await import('../lib/rulePack.ts');
const M = await import('../lib/complianceModel.ts');

type RuleDbRow = import('../lib/rulePack.ts').RuleDbRow;
type ParsedRule = import('../lib/rulePack.ts').ParsedRule;
type ConflictEntry = import('../lib/complianceModel.ts').ConflictEntry;

const APPLICABILITY = {
  all: [
    { 'project.height_m': { gt: 51 } },
    { 'element.category': { eq: 'Rooms' } },
  ],
};

const CHECK = {
  if: { 'element.length_m': { gt: 10 } },
  then: { 'element.clear_width_mm': { gte: 1500 } },
  else: { 'element.clear_width_mm': { gte: 1200 } },
};

function dbRow(over: Partial<RuleDbRow> = {}): RuleDbRow {
  return {
    id: 1,
    rule_uid: 'BA-HR-CORRIDOR-W-001',
    version: 1,
    semantic_hash: 'x'.repeat(64),
    team_code: 'BA',
    title_mn: 'Хонгилын цэвэр өргөн',
    title_en: 'Corridor clear width',
    document_uid: 'BNBD-31-03',
    clause_uid: null,
    edition_ref: null,
    effective_from: null,
    verification_state: 'UNVERIFIED',
    issue_class: 'REGULATORY_VIOLATION',
    severity: 'HIGH',
    unit: 'MM',
    coordinate_system: 'none',
    expect_applicable: 1,
    requires_context_json: JSON.stringify(['project.height_m']),
    applicability_json: JSON.stringify(APPLICABILITY),
    check_json: JSON.stringify(CHECK),
    requires_params_json: JSON.stringify(['clear_width_mm', 'length_m']),
    requires_triggered_json: JSON.stringify([{ category: 'Rooms', change: 'modify' }]),
    exceptions_json: '[]',
    recommendation_mn: 'Хонгилын цэвэр өргөнийг 1500 мм хүртэл нэмэгдүүлнэ.',
    status: 'published',
    authored_by: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: '2026-08-31T00:00:00Z',
    ...over,
  };
}

function parsed(over: Partial<RuleDbRow> = {}): ParsedRule {
  const p = P.parseRuleRow(dbRow(over));
  assert.ok(p, 'fixture дүрэм задлагдах ЁСТОЙ');
  return p;
}

const RULES: readonly ParsedRule[] = [parsed()];

/**
 * `Date`-ыг ТОГТМОЛ мөч дээр барина.  Маршрут нь `generated_at`-д
 * `new Date().toISOString()` дуудсаар байгаа тул ХОЁУЛАНГ нь энэ хуурамч цаг
 * тэжээнэ — «дараагийн хуанлийн өдөр» яг ингэж дуурайгдана.
 */
async function atDate<T>(iso: string, fn: () => Promise<T>): Promise<T> {
  const Real = globalThis.Date;
  const fixed = Real.parse(iso);
  class FakeDate extends Real {
    constructor(...args: ConstructorParameters<typeof Real>) {
      if (args.length === 0) super(fixed);
      else super(...(args as [number]));
    }
    static override now(): number {
      return fixed;
    }
  }
  globalThis.Date = FakeDate as unknown as DateConstructor;
  try {
    return await fn();
  } finally {
    globalThis.Date = Real;
  }
}

/** Маршрутын `/pack` угсралтыг ЯГ ТЭР ДАРААЛЛААР дуурайна. */
async function packAt(
  iso: string,
  rules: readonly ParsedRule[] = RULES,
  conflicts: readonly ConflictEntry[] = [],
) {
  return atDate(iso, async () => {
    const version = await C.rulesetVersionOf('BA', rules, conflicts);
    const pack = await P.buildPack({
      teamCode: 'BA',
      rulesetVersion: version,
      generatedAt: new Date().toISOString(),
      context: null,
      rules,
      conflicts,
    });
    return { version, sha: pack.packSha256, body: pack.body };
  });
}

/* ================================================================== */

test('ХУУРАМЧ ЦАГ АЖИЛЛАЖ БАЙНА — эс бөгөөс доорх тестүүд ХООСОН ДАВНА', async () => {
  const seen = await atDate('2026-09-01T03:00:00Z', async () => new Date().toISOString());
  assert.equal(seen, '2026-09-01T03:00:00.000Z');
  assert.notEqual(new Date().toISOString(), seen, 'Date СЭРГЭЭГДЭХ ЁСТОЙ');
});

test('ruleset_version: ХУАНЛИЙН ӨДӨР СОЛИГДОХОД ХӨДЛӨХГҮЙ (системийн цагийн функц БИШ)', async () => {
  const a = await packAt('2026-09-01T23:59:59Z');
  const b = await packAt('2026-09-02T00:00:01Z');
  const c = await packAt('2027-03-14T12:00:00Z');
  assert.equal(b.version, a.version, 'UTC шөнө дунд хувилбарыг ХӨДӨЛГӨХ ЁСГҮЙ');
  assert.equal(c.version, a.version, 'хагас жилийн дараа ч ИЖИЛ');
});

test('pack_sha256: ижил агуулга нь ӨДӨР СОЛИГДОХОД ИЖИЛ хэш өгнө (§7.5)', async () => {
  const a = await packAt('2026-09-01T23:59:59Z');
  const b = await packAt('2026-09-02T00:00:01Z');
  assert.equal(b.sha, a.sha, 'шөнө дунд stale_reason=ruleset ҮҮСГЭХ ЁСГҮЙ');
  assert.notEqual(
    a.body['generated_at'],
    b.body['generated_at'],
    'generated_at нь ҮНЭХЭЭР зөрсөн байх ЁСТОЙ — эс бөгөөс тест хоосон давна',
  );
});

test('ruleset_version: хэлбэр нь r<тоо>.<хэш12>, ?have= 64 тэмдэгтийн шалнаас доогуур', async () => {
  const a = await packAt('2026-09-01T00:00:00Z');
  assert.match(a.version, /^r\d+\.[0-9a-f]{12}$/);
  assert.ok(a.version.length <= 64, 'str(c.req.query("have"), 64) таслах ЁСГҮЙ');
  assert.ok(a.version.startsWith('r1.'), 'дүрмийн ТОО нь хүнд уншигдах угтвар');
  assert.ok(!/^\d{4}-\d{2}-\d{2}\./.test(a.version), 'ОГНООНЫ угтвар БУЦАЖ ОРСОН');
});

test('ruleset_version: дүрэм НЭМЭГДЭХЭД хөдөлнө', async () => {
  const one = await packAt('2026-09-01T00:00:00Z');
  const two = await packAt('2026-09-01T00:00:00Z', [
    parsed(),
    parsed({ id: 2, rule_uid: 'BA-HR-CORRIDOR-W-002' }),
  ]);
  assert.notEqual(two.version, one.version);
  assert.ok(two.version.startsWith('r2.'));
});

test('ruleset_version: semantic_hash ХӨДӨЛГӨДӨГГҮЙ гишүүн өөрчлөгдөхөд Ч хөдөлнө', async () => {
  // ⚠️ ЭНЭ НЬ ЗАСВАРЫН ХОЁРДАХЬ ХАГАС.  `semanticHash` нь ЗӨВХӨН
  //    `applicability` + `check` + `unit`-ыг нэрлэдэг тул түүн дээр суурилсан
  //    цэвэр функц нь `severity` / `recommendation_mn`-ыг ОГТ ХАРАХГҮЙ байх
  //    байсан — тэр өөрчлөлтүүд `?have=` дээр «unchanged» болж, ~20 машин руу
  //    ХЭЗЭЭ Ч хүрэхгүй.  Тиймээс хувилбарыг БҮТЭН БАГЦЫН БИЕЭС гаргана.
  const base = await packAt('2026-09-01T00:00:00Z');
  const sev = await packAt('2026-09-01T00:00:00Z', [parsed({ severity: 'CRITICAL' })]);
  const rec = await packAt('2026-09-01T00:00:00Z', [
    parsed({ recommendation_mn: 'Өөр зөвлөмж.' }),
  ]);
  const ver = await packAt('2026-09-01T00:00:00Z', [parsed({ version: 2 })]);
  assert.notEqual(sev.version, base.version, 'severity');
  assert.notEqual(rec.version, base.version, 'recommendation_mn');
  assert.notEqual(ver.version, base.version, 'rule version');
});

test('ruleset_version: ЗӨРЧИЛДӨӨН нэмэгдэхэд хөдөлнө (багцын биед явдаг)', async () => {
  const rules = [parsed(), parsed({ id: 2, rule_uid: 'BA-HR-CORRIDOR-W-002' })];
  const base = await packAt('2026-09-01T00:00:00Z', rules);
  const withConflict = await packAt('2026-09-01T00:00:00Z', rules, [
    {
      ruleUidA: 'BA-HR-CORRIDOR-W-001',
      ruleUidB: 'BA-HR-CORRIDOR-W-002',
      conflictKind: 'threshold',
      scope: 'intra_pack',
      precedence: null,
      noteMn: null,
    },
  ]);
  assert.notEqual(withConflict.version, base.version);
});

test('ruleset_version: БАГААР ялгаатай', async () => {
  const ba = await C.rulesetVersionOf('BA', RULES, []);
  const iz = await C.rulesetVersionOf('IZ', RULES, []);
  assert.notEqual(iz, ba);
});

test('ruleset_version: ТӨСЛИЙН КОНТЕКСТООС ХАМААРАХГҮЙ — ?have= төсөл сольсон ч ононо', async () => {
  const version = await C.rulesetVersionOf('BA', RULES, []);
  const withCtx = await P.buildPack({
    teamCode: 'BA',
    rulesetVersion: version,
    generatedAt: '2026-09-01T00:00:00Z',
    context: { ...M.emptyBuildContext(7, 'doc-1'), heightM: 62 },
    rules: RULES,
    conflicts: [],
  });
  const noCtx = await P.buildPack({
    teamCode: 'BA',
    rulesetVersion: version,
    generatedAt: '2026-09-01T00:00:00Z',
    context: null,
    rules: RULES,
    conflicts: [],
  });
  assert.equal(withCtx.body['ruleset_version'], noCtx.body['ruleset_version']);
  assert.notEqual(withCtx.packSha256, noCtx.packSha256, 'контекст нь хэшийг ХӨДӨЛГӨНӨ (§7.5)');
});
