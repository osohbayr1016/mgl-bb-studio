/**
 * `routes/learning.ts` — `bim.compliance.*` АРВАН ДУГУЙН УНШИГЧИЙН тест.
 *
 * Run with:  node --test src/routes/learning.complianceConfig.test.ts
 *
 * ⚠️ ЯАГААД ЭНЭ ТЕСТ ОРШИН БАЙНА ВЭ.  `assistant.min_confidence` (0195:163)
 *    нь `app_settings`-д ХЭРЭГЖСЭН, ГЭВЧ УНШИГЧГҮЙ мөр: босго нь DLL дотор
 *    эмхэтгэгдсэн тул эзэн утгыг сольж «унтраалаа» гэж боддог, бодитоор ЮУ Ч
 *    БОЛОХГҮЙ.  0228 (8 түлхүүр) + 0230 (2 түлхүүр) нь ЯГ ТЭР урхинд дахин
 *    орох ЁСГҮЙ, тиймээс энд түлхүүр БҮРИЙГ нэрээр нь тулгана:
 *      1. `COMPLIANCE_KEYS` нь миграцын мөрүүдтэй ЯГ ТААРНА (арав, арав).
 *      2. Түлхүүр бүрийн утга ХӨДӨЛГӨХӨД тохиргоо ХӨДӨЛНӨ (уншигдаж байна).
 *      3. Хог утга нь 500 БИШ, АНХДАГЧ болно (handshake нь БҮХ машиныг
 *         офлайн болгож болохгүй).
 *
 * ⚠️ Өргөтгөлгүй импортыг Node-ийн ESM loader шийддэггүй — `registerHooks`
 *    (`bimEvents.test.ts:24-31`) ЗААВАЛ, дараа нь `await import`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const M = await import('./learning.ts');

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, '..', '..', 'migrations');

/** 0228 + 0230-ийн БҮХ түлхүүр — миграцаас уншиж, кодтой тулгана. */
function keysFromMigrations(): string[] {
  const found = new Set<string>();
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8')
      .split(/\r?\n/)
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n');
    for (const m of sql.matchAll(/'(bim\.compliance\.[a-z_]+)'/g)) found.add(m[1]!);
  }
  return [...found].sort();
}

/** Утга бүр нь мөр — `app_settings.value` нь TEXT. */
function cfgOf(entries: Record<string, string>) {
  return M.parseComplianceConfig(new Map(Object.entries(entries)));
}

/* ================================================================== */

test('миграцын АРВАН түлхүүр бүр УНШИГЧТАЙ — уншигчгүй дугуй БАЙХГҮЙ', () => {
  const fromSql = keysFromMigrations();
  assert.equal(fromSql.length, 10, `миграцад ${fromSql.length} түлхүүр: ${fromSql.join(', ')}`);

  const src = readFileSync(join(HERE, 'learning.ts'), 'utf8');
  const missing = fromSql.filter((k) => !src.includes(`'${k}'`));
  assert.deepEqual(
    missing,
    [],
    'миграцад байгаа ч learning.ts уншдаггүй түлхүүр: ' + missing.join(', '),
  );
});

test('түлхүүр бүр GET /settings-ийн compliance объектоор add-in руу гардаг', () => {
  const src = readFileSync(join(HERE, 'learning.ts'), 'utf8');
  const block = src.slice(src.indexOf('compliance: {'));
  for (const field of [
    'mode:',
    'authority_level:',
    'rollout_pct:',
    'settle_ms:',
    'max_defer_ms:',
    'max_elements_per_set:',
    'raw_ring_max:',
    'emit_batch_max:',
    'min_severity:',
    'snooze_hours:',
  ]) {
    assert.ok(block.includes(field), `compliance объектод ${field} алга`);
  }
});

test('ХООСОН DB — арван талбар бүр 0228/0230-ийн анхдагчтай ТААРНА', () => {
  const cfg = cfgOf({});
  assert.deepEqual(cfg, {
    mode: 'observe',
    authorityLevel: 0,
    rolloutPct: 0,
    settleMs: 1200,
    maxDeferMs: 15000,
    maxElementsPerSet: 2000,
    rawRingMax: 4000,
    emitBatchMax: 100,
    minSeverity: 'HIGH',
    snoozeHours: 24,
  });
});

test('түлхүүр БҮР ХӨДӨЛГӨХӨД тохиргоо ХӨДӨЛНӨ (уншигдаж байгаагийн нотолгоо)', () => {
  const moved = cfgOf({
    'bim.compliance.mode': 'off',
    'bim.compliance.authority_level': '2',
    'bim.compliance.rollout_pct': '35',
    'bim.compliance.settle_ms': '900',
    'bim.compliance.max_defer_ms': '20000',
    'bim.compliance.max_elements_per_set': '500',
    'bim.compliance.raw_ring_max': '250',
    'bim.compliance.emit_batch_max': '50',
    'bim.compliance.min_severity': 'CRITICAL',
    'bim.compliance.snooze_hours': '6',
  });
  assert.deepEqual(moved, {
    mode: 'off',
    authorityLevel: 2,
    rolloutPct: 35,
    settleMs: 900,
    maxDeferMs: 20000,
    maxElementsPerSet: 500,
    rawRingMax: 250,
    emitBatchMax: 50,
    minSeverity: 'CRITICAL',
    snoozeHours: 6,
  });
});

test('УНТРААХ ТОВЧ — mode-ийн дөрвөн утга бүрэн, танихгүй нь observe руу унана', () => {
  for (const m of ['off', 'observe', 'explain', 'recommend']) {
    assert.equal(cfgOf({ 'bim.compliance.mode': m }).mode, m);
  }
  assert.equal(cfgOf({ 'bim.compliance.mode': 'OFF' }).mode, 'off', 'том үсэг зөвшөөрөгдөнө');
  assert.equal(cfgOf({ 'bim.compliance.mode': ' off ' }).mode, 'off', 'зай тайрагдана');
  assert.equal(cfgOf({ 'bim.compliance.mode': 'banana' }).mode, 'observe');
  assert.equal(cfgOf({ 'bim.compliance.mode': '' }).mode, 'observe');
});

test('min_severity нь §67-ийн ТАВАН утгыг л хүлээж авна', () => {
  for (const s of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']) {
    assert.equal(cfgOf({ 'bim.compliance.min_severity': s }).minSeverity, s);
  }
  assert.equal(cfgOf({ 'bim.compliance.min_severity': 'high' }).minSeverity, 'HIGH');
  assert.equal(cfgOf({ 'bim.compliance.min_severity': 'HIGHH' }).minSeverity, 'HIGH');
});

test('rollout_pct нь ТЭГ БАЙЖ ЧАДНА ба 0-100 руу хавчигдана', () => {
  // ⚠️ Энэ бол num()-ийн «> 0» шалгуурын урхи: 0 бол «утга алга» БИШ,
  //    0230-ийн ҮРЭЭСЛЭГЧ УТГА мөн.
  assert.equal(cfgOf({ 'bim.compliance.rollout_pct': '0' }).rolloutPct, 0);
  assert.equal(cfgOf({ 'bim.compliance.rollout_pct': '100' }).rolloutPct, 100);
  assert.equal(cfgOf({ 'bim.compliance.rollout_pct': '999' }).rolloutPct, 100);
  assert.equal(cfgOf({ 'bim.compliance.rollout_pct': '-5' }).rolloutPct, 0);
  assert.equal(cfgOf({ 'bim.compliance.rollout_pct': '12.7' }).rolloutPct, 12);
  assert.equal(cfgOf({ 'bim.compliance.rollout_pct': 'abc' }).rolloutPct, 0);
});

test('authority_level нь ХОГ УТГА дээр LEVEL 0 (OBSERVE) руу унана', () => {
  assert.equal(cfgOf({ 'bim.compliance.authority_level': '5' }).authorityLevel, 5);
  for (const junk of ['', ' ', '9', '-1', 'RECOMMEND', '0x2', '1.5']) {
    assert.equal(
      cfgOf({ 'bim.compliance.authority_level': junk }).authorityLevel,
      0,
      `${JSON.stringify(junk)} нь LEVEL 0 руу унах ёстой`,
    );
  }
});

test('тоон дугуй бүр хог утга дээр анхдагч руу унана, ШИДЭХГҮЙ', () => {
  const junk = cfgOf({
    'bim.compliance.settle_ms': 'abc',
    'bim.compliance.max_defer_ms': '0',
    'bim.compliance.max_elements_per_set': '-1',
    'bim.compliance.raw_ring_max': '',
    'bim.compliance.emit_batch_max': 'NaN',
    'bim.compliance.snooze_hours': 'Infinity',
  });
  assert.equal(junk.settleMs, 1200);
  assert.equal(junk.maxDeferMs, 15000);
  assert.equal(junk.maxElementsPerSet, 2000);
  assert.equal(junk.rawRingMax, 4000);
  assert.equal(junk.emitBatchMax, 100);
  assert.equal(junk.snoozeHours, 24);
});

test('loadComplianceConfig нь D1-ийн мөрүүдийг уншина — асуулга унавал анхдагч', async () => {
  const asked: unknown[][] = [];
  const fakeDb = {
    prepare(sql: string) {
      assert.ok(sql.includes('key IN ('), 'key IN (...) байх ёстой — LIKE БИШ');
      assert.ok(!/LIKE/i.test(sql), 'алсын D1 нь том TEXT дээрх LIKE-ыг татгалздаг');
      return {
        bind(...args: unknown[]) {
          asked.push(args);
          return {
            all: async () => ({
              results: [
                { key: 'bim.compliance.mode', value: 'explain' },
                { key: 'bim.compliance.authority_level', value: '1' },
                { key: 'bim.compliance.rollout_pct', value: '20' },
              ],
            }),
          };
        },
      };
    },
  } as unknown as D1Database;

  const cfg = await M.loadComplianceConfig(fakeDb);
  assert.equal(cfg.mode, 'explain');
  assert.equal(cfg.authorityLevel, 1);
  assert.equal(cfg.rolloutPct, 20);
  assert.equal(cfg.snoozeHours, 24, 'ирээгүй түлхүүр анхдагч дээр үлдэнэ');
  assert.equal(asked[0]?.length, 10, 'АРВАН түлхүүр bind хийгдэнэ');

  const brokenDb = {
    prepare() {
      return {
        bind() {
          return { all: async () => Promise.reject(new Error('D1 unav')) };
        },
      };
    },
  } as unknown as D1Database;
  const fallback = await M.loadComplianceConfig(brokenDb);
  assert.equal(fallback.mode, 'observe');
  assert.equal(fallback.authorityLevel, 0, 'DB унасан үед ХАМГИЙН БАГА эрх');
});
