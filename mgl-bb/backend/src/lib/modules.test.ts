/**
 * `lib/modules.ts` — модулийн бүртгэлийн тест.
 *
 * ХАМГИЙН ЧУХАЛ ТЕСТ нь `index.ts`-тэй тулгадаг нь: шинэ route mount хийгээд
 * `API_PREFIXES`-д нэмэхээ мартвал энд барина.  `Record<ApiPrefix, ModuleId>`
 * нь эсрэг чиглэлийг (зарлагдсан ч зураглагдаагүй) compile-аар барьдаг.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { MODULE_IDS, MODULE_LABELS, ALWAYS_ON, API_PREFIXES, MODULE_OF, moduleOfPath, parseModules } =
  await import('./modules.ts');

const { DEFAULT_ORG_CONFIG, orgConfigFromEnv, overlayOrgSettings, ORG_SETTING_KEYS } =
  await import('./orgConfig.ts');

/* ================================================================== */
/*  1. index.ts-тэй тулгах — жинхэнэ хамгаалалт                        */
/* ================================================================== */

/** `src/index.ts`-ээс бодитоор mount хийсэн ялгаатай `/api` угтварууд. */
function mountedApiPrefixes(): string[] {
  const src = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
  const all = [...src.matchAll(/app\.route\('([^']+)'/g)].map((m) => m[1]!);
  return [...new Set(all.filter((p) => p.startsWith('/api')))].sort();
}

test('API_PREFIXES нь index.ts-ийн mount-уудтай ЯГ таарна', () => {
  const mounted = mountedApiPrefixes();
  const declared = [...API_PREFIXES].sort();

  const missing = mounted.filter((p) => !declared.includes(p as never));
  const extra = declared.filter((p) => !mounted.includes(p));

  assert.deepEqual(
    missing,
    [],
    `index.ts-д mount хийсэн ч modules.ts-д зараагүй: ${missing.join(', ')}`,
  );
  assert.deepEqual(
    extra,
    [],
    `modules.ts-д зарласан ч index.ts-д mount хийгээгүй: ${extra.join(', ')}`,
  );
});

test('угтвар бүр ЯГ НЭГ модульд харьяалагдана, давхардаагүй', () => {
  assert.equal(new Set(API_PREFIXES).size, API_PREFIXES.length, 'угтвар давхардсан');
  for (const p of API_PREFIXES) {
    const m = MODULE_OF[p];
    assert.ok(m, `${p} нь модульгүй`);
    assert.ok((MODULE_IDS as readonly string[]).includes(m), `${p} → танихгүй модуль ${m}`);
  }
});

test('модуль бүр шошготой, `core` нь үргэлж асаалттай', () => {
  for (const id of MODULE_IDS) {
    assert.ok(MODULE_LABELS[id]?.mn, `${id} — монгол шошгогүй`);
    assert.ok(MODULE_LABELS[id]?.en, `${id} — англи шошгогүй`);
  }
  assert.ok(ALWAYS_ON.includes('core'));
});

test('модуль бүрийг дор хаяж нэг угтвар ашигладаг (үхсэн модульгүй)', () => {
  const used = new Set(Object.values(MODULE_OF));
  const unused = MODULE_IDS.filter((m) => !used.has(m));
  assert.deepEqual(unused, [], `ямар ч route-гүй модуль: ${unused.join(', ')}`);
});

/* ================================================================== */
/*  2. Зам → модуль                                                    */
/* ================================================================== */

test('moduleOfPath: яг таарах ба дэд зам', () => {
  assert.equal(moduleOfPath('/api/quotes'), 'quotes');
  assert.equal(moduleOfPath('/api/quotes/17/pdf'), 'quotes');
  assert.equal(moduleOfPath('/api/attendance/today'), 'attendance');
  assert.equal(moduleOfPath('/api/auth/login'), 'core');
});

test('moduleOfPath: СЕГМЕНТИЙН хилээр таарна (угтварын давхцал биш)', () => {
  // `/api/attendance` нь `/api/attendance-confirmations`-ыг ЗАЛГИХ ЁСГҮЙ —
  // хоёулаа `attendance` модульд ч, дүрэм нь зөв ажиллаж байгааг батлана.
  assert.equal(moduleOfPath('/api/attendance-confirmations'), 'attendance');
  // Байхгүй, гэхдээ угтвар нь давхцсан зам
  assert.equal(moduleOfPath('/api/leavesX'), null);
  assert.equal(moduleOfPath('/api/quotesarchive'), null);
});

test('moduleOfPath: илүү УРТ угтвар түрүүлж таарна', () => {
  // `/api/landing/v2` нь `/api/landing`-аас өмнө шалгагдана.  Одоо хоёулаа
  // `landing` тул үр дүн ижил ч, ирээдүйд салгахад энэ дараалал ачаалал үүрнэ.
  assert.equal(moduleOfPath('/api/landing/v2/public'), 'landing');
  assert.equal(moduleOfPath('/api/landing/blocks'), 'landing');
});

test('moduleOfPath: танихгүй ба /api биш зам → null', () => {
  assert.equal(moduleOfPath('/api/zzz'), null);
  assert.equal(moduleOfPath('/media/x.png'), null);
  assert.equal(moduleOfPath('/'), null);
});

/* ================================================================== */
/*  3. parseModules                                                    */
/* ================================================================== */

test('parseModules: хоосон/өгөөгүй = ХЯЗГААРЛАЛТГҮЙ (null)', () => {
  assert.equal(parseModules(''), null);
  assert.equal(parseModules('   '), null);
  assert.equal(parseModules(undefined), null);
  assert.equal(parseModules(null), null);
});

test('parseModules: жагсаалт, `core` автоматаар нэмэгдэнэ', () => {
  const s = parseModules('quotes,qto');
  assert.ok(s);
  assert.ok(s!.has('quotes'));
  assert.ok(s!.has('qto'));
  assert.ok(s!.has('core'), 'core нь ямар ч тохиолдолд байх ёстой');
  assert.equal(s!.has('attendance'), false);
});

test('parseModules: танихгүй нэрийг чимээгүй алгасна (хүсэлт унахгүй)', () => {
  const s = parseModules('quotes,байхгүй-модуль,qto');
  assert.ok(s);
  assert.equal(s!.has('quotes'), true);
  assert.equal(s!.has('qto'), true);
  assert.equal(s!.size, 3, 'core + quotes + qto');
});

/* ================================================================== */
/*  4. Тохиргооны давхаргатай холбоос                                  */
/* ================================================================== */

test('ДЕФОЛТ нь ХЯЗГААРЛАЛТГҮЙ — production дээр юу ч хаагдахгүй', () => {
  assert.equal(DEFAULT_ORG_CONFIG.enabledModules, null);
  assert.equal(orgConfigFromEnv({}).enabledModules, null);
});

test('ORG_MODULES_ENABLED env нь хязгаарлалт тавина', () => {
  const c = orgConfigFromEnv({ ORG_MODULES_ENABLED: 'attendance,leave' });
  assert.ok(c.enabledModules);
  assert.ok(c.enabledModules!.has('attendance'));
  assert.ok(c.enabledModules!.has('core'));
  assert.equal(c.enabledModules!.has('quotes'), false);
});

test('DB мөр нь env-ийг дарна, хоосон мөр нь хязгаарлалтыг АВНА', () => {
  const base = orgConfigFromEnv({ ORG_MODULES_ENABLED: 'attendance' });
  assert.ok(base.enabledModules);

  const restricted = overlayOrgSettings(base, new Map([[ORG_SETTING_KEYS.enabledModules, 'qto']]));
  assert.ok(restricted.enabledModules!.has('qto'));
  assert.equal(restricted.enabledModules!.has('attendance'), false);

  const opened = overlayOrgSettings(base, new Map([[ORG_SETTING_KEYS.enabledModules, '']]));
  assert.equal(opened.enabledModules, null, 'хоосон мөр = хязгаарлалтгүй');
});
