/**
 * `lib/orgConfig.ts`-ийн тест.
 *
 * Хамгийн чухал шалгуур нь ЭХНИЙХ: тохиргоо огт өгөөгүй үед үр дүн нь
 * MGL-ийн ӨМНӨХ hardcode-той яг таарах ёстой.  Энэ тест унавал тохиргооны
 * давхарга нь ажиллаж байгаа production-ы зан төлөвийг өөрчилсөн гэсэн үг.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// `orgConfig.ts` нь өргөтгөлгүй харьцангуй импорт бичдэггүй ч, түүнийг
// уншдаг `time.ts`/`workSchedule.ts` бичдэг — `leaveWindow.test.ts`-ийн
// адил зөвхөн тестийн хүрээнд `.ts` руу буулгана.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const {
  DEFAULT_ORG_CONFIG,
  ORG_SETTING_KEYS,
  orgConfigFromEnv,
  overlayOrgSettings,
  parseShift,
  parseMonths,
  parseOptionalUserId,
  parseUserIds,
  orgConfig,
  resetOrgConfig,
  setOrgConfig,
} = await import('./orgConfig.ts');

const { isSummerSchedule } = await import('./time.ts');
const { SHIFTS, effectiveSchedule } = await import('./workSchedule.ts');
const { excludeCeoSql, leaderboardMemberSql, isCeo } = await import('./ceo.ts');
const { excludeSystemUsersSql, isSystemUser } = await import('./systemUsers.ts');

/* ================================================================== */
/*  1. Тохиргоогүй үед = ӨМНӨХ ЗАН ТӨЛӨВ                               */
/* ================================================================== */

test('дефолт нь MGL-ийн өмнөх hardcode-той яг таарна', () => {
  resetOrgConfig();
  const c = orgConfig();
  assert.equal(c.timezone, 'Asia/Ulaanbaatar');
  assert.equal(c.ceoUserId, 2);
  assert.equal(c.nameShort, 'MGL');
  assert.equal(c.name, 'MGL E&C');
  assert.equal(c.appName, 'MGL Progress');
  assert.deepEqual([...c.summerMonths], [6, 7, 8]);
});

test('SHIFTS нь тохиргоогүй үед 09:00–18:00 / 08:00–17:00', () => {
  resetOrgConfig();
  assert.equal(SHIFTS.standard.startMinutes, 9 * 60);
  assert.equal(SHIFTS.standard.endMinutes, 18 * 60);
  assert.equal(SHIFTS.early.startMinutes, 8 * 60);
  assert.equal(SHIFTS.early.endMinutes, 17 * 60);
});

test('зуны хуваарь нь тохиргоогүй үед 6/7/8 сар', () => {
  resetOrgConfig();
  assert.equal(isSummerSchedule('2026-06-01'), true);
  assert.equal(isSummerSchedule('2026-07-15'), true);
  assert.equal(isSummerSchedule('2026-08-31'), true);
  assert.equal(isSummerSchedule('2026-05-31'), false);
  assert.equal(isSummerSchedule('2026-09-01'), false);
  assert.equal(isSummerSchedule('2026-01-15'), false);
});

test('CEO-гийн SQL хэлтэрхий нь тохиргоогүй үед өмнөхтэйгээ ижил', () => {
  resetOrgConfig();
  assert.equal(excludeCeoSql(), 'u.id != 2');
  assert.equal(excludeCeoSql('x'), 'x.id != 2');
  assert.equal(
    leaderboardMemberSql('u', true),
    "(u.role IN ('engineer','architect','senior') OR u.id = 2)",
  );
  assert.equal(leaderboardMemberSql('u', false), "(u.role IN ('engineer','architect','senior'))");
  assert.equal(isCeo(2), true);
  assert.equal(isCeo(3), false);
});

test('систем дансны SQL хэлтэрхий нь тохиргоогүй үед хэнийг ч хасахгүй', () => {
  resetOrgConfig();
  assert.deepEqual([...orgConfig().systemUserIds], []);
  assert.equal(excludeSystemUsersSql(), '1=1');
  assert.equal(isSystemUser(61), false);
});

test('ORG_SYSTEM_USER_IDS тохируулбал roster-оос хасна', () => {
  setOrgConfig(orgConfigFromEnv({ ORG_SYSTEM_USER_IDS: '61, 62' }));
  assert.deepEqual([...orgConfig().systemUserIds], [61, 62]);
  assert.equal(excludeSystemUsersSql(), 'u.id NOT IN (61,62)');
  assert.equal(excludeSystemUsersSql('x'), 'x.id NOT IN (61,62)');
  assert.equal(isSystemUser(61), true);
  assert.equal(isSystemUser(2), false);
  resetOrgConfig();
  assert.equal(excludeSystemUsersSql(), '1=1');
});

test('app_settings давхарга нь систем дансны жагсаалтыг бичнэ', () => {
  setOrgConfig(
    overlayOrgSettings(DEFAULT_ORG_CONFIG, new Map([[ORG_SETTING_KEYS.systemUserIds, '61']])),
  );
  assert.equal(excludeSystemUsersSql(), 'u.id NOT IN (61)');
  resetOrgConfig();
});

test('parseUserIds: хоосон = хасалтгүй, буруу утга = null', () => {
  assert.deepEqual(parseUserIds('61,62'), [61, 62]);
  assert.deepEqual(parseUserIds(' 61 , 61 '), [61]);
  assert.deepEqual(parseUserIds(''), []);
  assert.equal(parseUserIds('61,abc'), null);
  assert.equal(parseUserIds('0'), null);
  assert.equal(parseUserIds('-1'), null);
  assert.equal(parseUserIds(undefined), null);
});

/* ================================================================== */
/*  2. Задлан шинжлэгчид                                               */
/* ================================================================== */

test('parseShift: зөв формат, en-dash, буруу утга', () => {
  assert.deepEqual(parseShift('09:00-18:00'), {
    startMinutes: 540,
    endMinutes: 1080,
    label: '09:00–18:00',
  });
  // en-dash ба зайтай хувилбар мөн ажиллана
  assert.deepEqual(parseShift(' 08:30 – 17:30 ')?.startMinutes, 510);
  assert.equal(parseShift('9:00-18:00'), null, 'нэг оронтой цаг таарахгүй');
  assert.equal(parseShift('18:00-09:00'), null, 'дуусах нь эхлэхээс өмнө байж болохгүй');
  assert.equal(parseShift('09:00-09:00'), null, 'тэг урттай ээлж байж болохгүй');
  assert.equal(parseShift('25:00-26:00'), null);
  assert.equal(parseShift(''), null);
  assert.equal(parseShift(undefined), null);
});

test('parseMonths: жагсаалт, хоосон, буруу', () => {
  assert.deepEqual(parseMonths('6,7,8'), [6, 7, 8]);
  assert.deepEqual(parseMonths(' 1 , 12 '), [1, 12]);
  assert.deepEqual(parseMonths('7,7,7'), [7], 'давхардсаныг нэгтгэнэ');
  assert.deepEqual(parseMonths(''), [], 'хоосон = улирлын албадлагагүй');
  assert.equal(parseMonths('0'), null);
  assert.equal(parseMonths('13'), null);
  assert.equal(parseMonths('зун'), null);
  assert.equal(parseMonths(undefined), null);
});

test('parseOptionalUserId: тоо, унтраах, буруу', () => {
  assert.equal(parseOptionalUserId('7', 2), 7);
  assert.equal(parseOptionalUserId('none', 2), null);
  assert.equal(parseOptionalUserId('0', 2), null);
  assert.equal(parseOptionalUserId(undefined, 2), 2, 'өгөөгүй бол fallback');
  assert.equal(parseOptionalUserId('', 2), 2);
  assert.equal(parseOptionalUserId('abc', 2), 2, 'буруу утга fallback руу унана');
});

/* ================================================================== */
/*  3. ENV давхарга                                                    */
/* ================================================================== */

test('orgConfigFromEnv: хоосон env бол дефолттой яг ижил', () => {
  assert.deepEqual(orgConfigFromEnv({}), DEFAULT_ORG_CONFIG);
});

test('orgConfigFromEnv: зөвхөн өгсөн талбарыг дарж бичнэ', () => {
  const c = orgConfigFromEnv({ ORG_NAME: 'Acme Design', ORG_TIMEZONE: 'Asia/Seoul' });
  assert.equal(c.name, 'Acme Design');
  assert.equal(c.timezone, 'Asia/Seoul');
  assert.equal(c.nameShort, DEFAULT_ORG_CONFIG.nameShort, 'өгөөгүй талбар хэвээр');
  assert.equal(c.ceoUserId, 2);
});

test('orgConfigFromEnv: буруу ээлж/сар нь дефолт руу унана (хүсэлт унахгүй)', () => {
  const c = orgConfigFromEnv({ ORG_SHIFT_STANDARD: 'хог', ORG_SUMMER_MONTHS: '99' });
  assert.deepEqual(c.shiftStandard, DEFAULT_ORG_CONFIG.shiftStandard);
  assert.deepEqual([...c.summerMonths], [6, 7, 8]);
});

test('orgConfigFromEnv: төслийн кодын угтварыг ЗОРИУДААР хоосон болгож болно', () => {
  assert.equal(orgConfigFromEnv({ ORG_PROJECT_CODE_PREFIX: '' }).projectCodePrefix, '');
  assert.equal(orgConfigFromEnv({}).projectCodePrefix, 'MGL');
});

test('orgConfigFromEnv: CEO-г бүрэн унтраана', () => {
  assert.equal(orgConfigFromEnv({ ORG_CEO_USER_ID: 'none' }).ceoUserId, null);
});

/* ================================================================== */
/*  4. DB давхарга                                                     */
/* ================================================================== */

test('overlayOrgSettings: DB нь ENV-ийг дарна', () => {
  const base = orgConfigFromEnv({ ORG_NAME: 'From Env' });
  const rows = new Map([[ORG_SETTING_KEYS.name, 'From DB']]);
  assert.equal(overlayOrgSettings(base, rows).name, 'From DB');
});

test('overlayOrgSettings: хоосон map бол суурь хэвээр', () => {
  const base = orgConfigFromEnv({ ORG_NAME: 'From Env' });
  assert.deepEqual(overlayOrgSettings(base, new Map()), base);
});

test('overlayOrgSettings: буруу мөр суурийг ЭВДЭХГҮЙ', () => {
  const base = DEFAULT_ORG_CONFIG;
  const rows = new Map([
    [ORG_SETTING_KEYS.shiftStandard, 'бүтэн өдөр'],
    [ORG_SETTING_KEYS.summerMonths, '-4'],
  ]);
  const c = overlayOrgSettings(base, rows);
  assert.deepEqual(c.shiftStandard, base.shiftStandard);
  assert.deepEqual([...c.summerMonths], [6, 7, 8]);
});

test('ORG_SETTING_KEYS нь бүх талбарыг хамарна, түлхүүр давхардаагүй', () => {
  const fieldCount = Object.keys(DEFAULT_ORG_CONFIG).length;
  const keys = Object.values(ORG_SETTING_KEYS);
  assert.equal(keys.length, fieldCount);
  assert.equal(new Set(keys).size, keys.length, 'түлхүүр давхардсан байна');
  for (const k of keys) assert.match(k, /^org\./, `${k} нь 'org.' угтвартай байх ёстой`);
});

/* ================================================================== */
/*  5. Тохиргоо БОДИТООР үйлчилж байгаа эсэх                           */
/* ================================================================== */

test('өөр компанийн тохиргоо доод түвшний функцүүдэд хүрнэ', async () => {
  const { setOrgConfig } = await import('./orgConfig.ts');
  setOrgConfig(
    orgConfigFromEnv({
      ORG_NAME_SHORT: 'ACME',
      ORG_CEO_USER_ID: 'none',
      ORG_SHIFT_STANDARD: '10:00-19:00',
      ORG_SUMMER_MONTHS: '', // улирлын албадлагагүй компани
    }),
  );

  // Ээлж — getter учраас шинэ утга шууд харагдана
  assert.equal(SHIFTS.standard.startMinutes, 10 * 60);
  assert.equal(SHIFTS.standard.endMinutes, 19 * 60);

  // Зуны албадлага унтарсан тул 7 сард ч хадгалсан хуваарь хүчинтэй
  assert.equal(isSummerSchedule('2026-07-15'), false);
  assert.equal(effectiveSchedule('standard', '2026-07-15'), 'standard');

  // CEO-гүй компанид SQL хэлтэрхий хэн ч хасахгүй болно
  assert.equal(excludeCeoSql(), '1=1');
  assert.equal(leaderboardMemberSql('u', true), "(u.role IN ('engineer','architect','senior'))");
  assert.equal(isCeo(2), false);

  resetOrgConfig();
  // Цэвэрлэсний дараа MGL-ийн зан төлөв бүрэн сэргэнэ
  assert.equal(SHIFTS.standard.startMinutes, 9 * 60);
  assert.equal(excludeCeoSql(), 'u.id != 2');
  assert.equal(isSummerSchedule('2026-07-15'), true);
});

/* ================================================================== */
/*  6. loadOrgConfig — cache ба `force`                                */
/*     (2026-08-21: локал дээр бодитоор ажиллуулж илрүүлсэн алдааны    */
/*      регрессийн цоож — доорх «force» тест унавал тохиргоо засмагц   */
/*      хүчин төгөлдөр болохоо больсон гэсэн үг.)                      */
/* ================================================================== */

const { loadOrgConfig } = await import('./orgConfig.ts');

/** `app_settings` уншилтыг дуурайх хамгийн бага D1 хуурмаг. */
function fakeDb(rows: Array<{ key: string; value: string }>) {
  let calls = 0;
  return {
    calls: () => calls,
    db: {
      prepare() {
        return {
          all() {
            calls += 1;
            return Promise.resolve({ results: rows });
          },
        };
      },
    } as unknown as D1Database,
  };
}

test('loadOrgConfig: DB-гийн утга ENV-ийг дарна', async () => {
  resetOrgConfig();
  const { db } = fakeDb([{ key: ORG_SETTING_KEYS.name, value: 'From DB' }]);
  const cfg = await loadOrgConfig({ DB: db, ORG_NAME: 'From Env' });
  assert.equal(cfg.name, 'From DB');
  assert.equal(orgConfig().name, 'From DB', 'sync getter мөн шинэчлэгдэнэ');
  resetOrgConfig();
});

test('loadOrgConfig: TTL дотор DB рүү дахин очихгүй', async () => {
  resetOrgConfig();
  const f = fakeDb([{ key: ORG_SETTING_KEYS.name, value: 'A' }]);
  await loadOrgConfig({ DB: f.db }, { nowMs: 1_000 });
  await loadOrgConfig({ DB: f.db }, { nowMs: 1_500 });
  await loadOrgConfig({ DB: f.db }, { nowMs: 60_000 });
  assert.equal(f.calls(), 1, 'TTL (60с) дотор ганц л уншилт');
  resetOrgConfig();
});

test('loadOrgConfig: TTL дууссаны дараа дахин уншина', async () => {
  resetOrgConfig();
  const f = fakeDb([{ key: ORG_SETTING_KEYS.name, value: 'A' }]);
  await loadOrgConfig({ DB: f.db }, { nowMs: 1_000 });
  await loadOrgConfig({ DB: f.db }, { nowMs: 1_000 + 60_001 });
  assert.equal(f.calls(), 2);
  resetOrgConfig();
});

test('РЕГРЕСС: `force` нь cache-ийг ХӨЛДӨӨХГҮЙ', async () => {
  resetOrgConfig();
  // Урьд нь `force`-ийн оронд ирээдүйн `nowMs` дамжуулдаг байсан нь
  // `loadedAtMs`-ийг ирээдүй рүү түлхэж, дараагийн бүх уншилтыг 10 минут
  // хөлдөөдөг байв.  Энд яг тэр дарааллыг дуурайна.
  const first = fakeDb([{ key: ORG_SETTING_KEYS.name, value: 'Хуучин' }]);
  await loadOrgConfig({ DB: first.db }, { nowMs: 1_000 });
  assert.equal(orgConfig().name, 'Хуучин');

  // «Админ утгыг сольлоо» → force-оор дахин уншина
  const second = fakeDb([{ key: ORG_SETTING_KEYS.name, value: 'Шинэ' }]);
  const forced = await loadOrgConfig({ DB: second.db }, { force: true, nowMs: 1_100 });
  assert.equal(forced.name, 'Шинэ', 'force нь шинэ утгыг ЗААВАЛ авчирна');

  // ХАМГИЙН ЧУХАЛ: force-ийн ДАРАА ердийн уншилт хөлдөөгүй байх ёстой.
  const third = fakeDb([{ key: ORG_SETTING_KEYS.name, value: 'Хамгийн шинэ' }]);
  const after = await loadOrgConfig({ DB: third.db }, { nowMs: 1_100 + 60_001 });
  assert.equal(after.name, 'Хамгийн шинэ', 'force нь ирээдүйн цаг тавьж хөлдөөсөн байна');
  assert.equal(third.calls(), 1);
  resetOrgConfig();
});

test('loadOrgConfig: DB унавал ENV давхарга үлдэж, хүсэлт унахгүй', async () => {
  resetOrgConfig();
  const brokenDb = {
    prepare() {
      return {
        all() {
          return Promise.reject(new Error('no such table: app_settings'));
        },
      };
    },
  } as unknown as D1Database;
  const cfg = await loadOrgConfig({ DB: brokenDb, ORG_NAME: 'Зөвхөн ENV' });
  assert.equal(cfg.name, 'Зөвхөн ENV');
  resetOrgConfig();
});
