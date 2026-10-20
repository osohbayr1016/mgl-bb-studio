/**
 * `lib/tenants.ts` + `lib/requestContext.ts` — олон-tenant угсрааны тест.
 *
 * ХАМГИЙН ЧУХАЛ ТЕСТ нь §4-ийн ТУСГААРЛАЛТ: нэг Worker дотор хоёр компанийн
 * хүсэлт `await` дээр СОЛБИЦОХ үед тохиргоо нь холилдох ЁСГҮЙ.  Тэр тест
 * унавал A компанийн хэрэглэгч B-гийн тохиргоогоор ажиллаж эхэлнэ.
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

const { parseTenants, resolveTenant, tenantEnv, TENANT_HEADER } = await import('./tenants.ts');
const { runWithTenant, currentTenantId, hasTenantContext, DEFAULT_TENANT_ID } = await import(
  './requestContext.ts'
);
const { loadOrgConfig, orgConfig, resetOrgConfig, ORG_SETTING_KEYS } = await import(
  './orgConfig.ts'
);

const SPEC = JSON.stringify([
  // Үндсэн компани ч bucket-аа ИЛ бичнэ — «base tenant» гэсэн ойлголт кодод
  // БАЙХГҮЙ бөгөөд оруулахгүй (1A-4 §9 №4).
  {
    id: 'mgl',
    label: 'MGL E&C',
    hosts: ['api.mglenc.com'],
    db: 'DB',
    media: 'MEDIA_BUCKET',
    meeting: 'MEETING_BUCKET',
    legacyMediaOrigin: 'https://legacy.example',
  },
  {
    id: 'acme',
    label: 'ACME',
    hosts: ['api.acme.mn', 'API.ACME.MN'],
    db: 'DB_ACME',
    media: 'MEDIA_ACME',
    meeting: 'MEETING_ACME',
  },
]);

/* ================================================================== */
/*  1. parseTenants                                                    */
/* ================================================================== */

test('parseTenants: тохируулаагүй бол null (нэг-tenant горим)', () => {
  assert.equal(parseTenants(undefined), null);
  assert.equal(parseTenants(''), null);
  assert.equal(parseTenants('   '), null);
});

test('parseTenants: БУРУУ JSON нь Worker-ийг унагаахгүй, null буцаана', () => {
  assert.equal(parseTenants('{ энэ бол JSON биш'), null);
  assert.equal(parseTenants('"мөр"'), null, 'массив биш бол null');
  assert.equal(parseTenants('[]'), null, 'хоосон массив = тохируулаагүйтэй адил');
});

test('parseTenants: id эсвэл db дутуу бичлэгийг алгасна', () => {
  const t = parseTenants(
    JSON.stringify([
      { id: 'a' },
      { db: 'DB_X' },
      { id: 'ok', db: 'DB_OK', media: 'MEDIA_OK', meeting: 'MEET_OK' },
    ]),
  );
  assert.equal(t?.length, 1);
  assert.equal(t?.[0]?.id, 'ok');
});

test('parseTenants: media/meeting заагаагүй бичлэгийг ХАЯНА (bucket гоожихоос сэргийлнэ)', () => {
  // «Дефолт руу унагаах» нь A компанийн файлыг MGL-ийн `/media/:key`-ээр
  // баталгаажуулалтгүй уншигддаг bucket руу чимээгүй бичих байсан.
  const t = parseTenants(
    JSON.stringify([
      { id: 'a', db: 'DB_A', hosts: ['a.mn'] }, // bucket-гүй → хаягдана
      { id: 'b', db: 'DB_B', hosts: ['b.mn'], media: 'MEDIA_B', meeting: 'MEET_B' },
      { id: 'c', db: 'DB_C', hosts: ['c.mn'], media: 'MEDIA_C' }, // meeting дутуу → хаягдана
    ]),
  );
  assert.deepEqual(
    t?.map((x) => x.id),
    ['b'],
  );
});

test('parseTenants: бүх бичлэг bucket-гүй бол null (нэг-tenant горим руу унана)', () => {
  assert.equal(parseTenants(JSON.stringify([{ id: 'a', db: 'DB_A', hosts: ['a.mn'] }])), null);
});

test('parseTenants: legacyMediaOrigin нь СОНГОЛТТОЙ, өгөөгүй бол талбар ОГТ нэмэгдэхгүй', () => {
  const t = parseTenants(
    JSON.stringify([{ id: 'a', db: 'DB_A', media: 'M_A', meeting: 'T_A' }]),
  );
  assert.equal(t?.[0]?.legacyMediaOrigin, undefined);
  const t2 = parseTenants(
    JSON.stringify([
      { id: 'a', db: 'DB_A', media: 'M_A', meeting: 'T_A', legacyMediaOrigin: ' https://x/ ' },
    ]),
  );
  assert.equal(t2?.[0]?.legacyMediaOrigin, 'https://x/');
});

test('parseTenants: host-ыг жижиг үсэг болгоно, label дутвал id-г авна', () => {
  const t = parseTenants(SPEC);
  assert.equal(t?.length, 2);
  assert.deepEqual(t?.[1]?.hosts, ['api.acme.mn'], 'том үсэгтэй давхардал нэгдэнэ');
  assert.equal(t?.[0]?.label, 'MGL E&C');
});

test('parseTenants: ДАВХАРДСАН host-ыг эхний компани эзэмшинэ', () => {
  // Нэг host хоёр компанид харьяалагдвал аль руу нь очих нь тодорхойгүй болж,
  // бүрэн эрхийн давалт үүсэнэ.  Тиймээс хоёр дахийг нь ХАЯНА.
  const t = parseTenants(
    JSON.stringify([
      { id: 'a', hosts: ['shared.mn'], db: 'DB_A', media: 'M_A', meeting: 'T_A' },
      { id: 'b', hosts: ['shared.mn', 'b.mn'], db: 'DB_B', media: 'M_B', meeting: 'T_B' },
    ]),
  );
  assert.deepEqual(t?.[0]?.hosts, ['shared.mn']);
  assert.deepEqual(t?.[1]?.hosts, ['b.mn'], 'давхардсан host хасагдана');
});

test('parseTenants: ДАВХАРДСАН id-г нэг л удаа авна', () => {
  const t = parseTenants(
    JSON.stringify([
      { id: 'dup', db: 'DB_1', media: 'M_1', meeting: 'T_1' },
      { id: 'dup', db: 'DB_2', media: 'M_2', meeting: 'T_2' },
    ]),
  );
  assert.equal(t?.length, 1);
  assert.equal(t?.[0]?.db, 'DB_1');
});

/* ================================================================== */
/*  2. resolveTenant                                                   */
/* ================================================================== */

const TENANTS = parseTenants(SPEC)!;

test('resolveTenant: host-оор олно, порт болон том үсгийг тоохгүй', () => {
  assert.equal(resolveTenant(TENANTS, { host: 'api.acme.mn' })?.tenant.id, 'acme');
  assert.equal(resolveTenant(TENANTS, { host: 'API.Acme.MN:8787' })?.tenant.id, 'acme');
  assert.equal(resolveTenant(TENANTS, { host: 'api.mglenc.com' })?.tenant.id, 'mgl');
});

test('resolveTenant: host давамгайлж, толгойг ДАРНА', () => {
  // Хуурамч `X-Tenant` толгойгоор custom domain-ыг тойрч гарах боломжгүй.
  const r = resolveTenant(TENANTS, { host: 'api.mglenc.com', header: 'acme' });
  assert.equal(r?.tenant.id, 'mgl');
  assert.equal(r?.via, 'host');
});

test('resolveTenant: host таарахгүй бол толгойгоор (workers.dev горим)', () => {
  const r = resolveTenant(TENANTS, { host: 'shared.workers.dev', header: 'ACME' });
  assert.equal(r?.tenant.id, 'acme');
  assert.equal(r?.via, 'header');
});

test('resolveTenant: танихгүй бол null — дефолт компани руу УНАГААХГҮЙ', () => {
  assert.equal(resolveTenant(TENANTS, { host: 'хэн-ч-биш.mn' }), null);
  assert.equal(resolveTenant(TENANTS, { host: '', header: 'байхгүй' }), null);
  assert.equal(resolveTenant(TENANTS, {}), null);
});

test('TENANT_HEADER нь тогтмол', () => {
  assert.equal(TENANT_HEADER, 'X-Tenant');
});

/* ================================================================== */
/*  3. tenantEnv                                                       */
/* ================================================================== */

const FAKE_ENV = {
  DB: 'mgl-db',
  MEDIA_BUCKET: 'mgl-media',
  MEETING_BUCKET: 'mgl-meeting',
  DB_ACME: 'acme-db',
  MEDIA_ACME: 'acme-media',
  MEETING_ACME: 'acme-meeting',
  JWT_SECRET: 'shared',
  // binding БИШ, `[vars]`-ийн мөр — Worker-т ГЛОБАЛ тул `{ ...bag }`-аар
  // tenant бүрийн env рүү урсдаг.  `tenantEnv` үүнийг ДАРНА.
  LEGACY_MEDIA_ORIGIN: 'https://mgl-legacy.example',
};

test('tenantEnv: binding-үүдийг сольж, ЭХ объектыг хөндөхгүй', () => {
  const acme = TENANTS.find((t) => t.id === 'acme')!;
  const scoped = tenantEnv(FAKE_ENV, acme)!;
  assert.equal(scoped.DB, 'acme-db');
  assert.equal(scoped.MEDIA_BUCKET, 'acme-media');
  assert.equal(scoped.MEETING_BUCKET, 'acme-meeting');
  assert.equal(scoped.JWT_SECRET, 'shared', 'бусад талбар дамжина');
  // Эх env хэвээр — isolate-д хуваалцагддаг тул мутаци нь бусад хүсэлтэд гоожно.
  assert.equal(FAKE_ENV.DB, 'mgl-db');
  assert.equal(FAKE_ENV.MEDIA_BUCKET, 'mgl-media');
});

test('tenantEnv: үндсэн компани bucket-аа ИЛ зарлаж, өөрийн binding-ээ авна', () => {
  // Урьд нь энд «media/meeting заагаагүй бол үндсэн binding хэвээр» тест
  // байсан — тэр зан төлөв нь ЯГ T1 цоорхой байсан тул устгасан.  Одоо
  // `TenantSpec.media`/`.meeting` заавал, MGL ч гэсэн ил бичнэ.
  const mgl = TENANTS.find((t) => t.id === 'mgl')!;
  assert.equal(mgl.media, 'MEDIA_BUCKET');
  assert.equal(mgl.meeting, 'MEETING_BUCKET');
  const scoped = tenantEnv(FAKE_ENV, mgl)!;
  assert.equal(scoped.DB, 'mgl-db');
  assert.equal(scoped.MEDIA_BUCKET, 'mgl-media');
  assert.equal(scoped.MEETING_BUCKET, 'mgl-meeting');
});

test('tenantEnv: binding байхгүй бол null (дуудагч 503 өгнө)', () => {
  const base = { id: 'x', label: 'x', hosts: [], media: 'MEDIA_BUCKET', meeting: 'MEETING_BUCKET' };
  assert.equal(tenantEnv(FAKE_ENV, { ...base, db: 'DB_БАЙХГҮЙ' }), null);
  assert.equal(tenantEnv(FAKE_ENV, { ...base, db: 'DB', media: 'MEDIA_БАЙХГҮЙ' }), null);
  assert.equal(tenantEnv(FAKE_ENV, { ...base, db: 'DB', meeting: 'MEETING_БАЙХГҮЙ' }), null);
});

test('tenantEnv: LEGACY_MEDIA_ORIGIN-ыг ҮРГЭЛЖ дарна (компани хооронд дамжуулахаас сэргийлнэ)', () => {
  // Зарлаагүй компанид ХООСОН → `routes/media.ts`-ийн нөхөж татах салаа
  // бүхэлдээ унтарна.  Дарахгүй бол ACME-гийн домэйнээр MGL-ийн файл гарч,
  // дээрээс нь ACME-гийн bucket-д байнгын хуулбар үлдэнэ.
  const acme = TENANTS.find((t) => t.id === 'acme')!;
  assert.equal(acme.legacyMediaOrigin, undefined);
  assert.equal(tenantEnv(FAKE_ENV, acme)!.LEGACY_MEDIA_ORIGIN, '');

  // Зарласан компанид ЯГ өөрийнх нь origin.
  const mgl = TENANTS.find((t) => t.id === 'mgl')!;
  assert.equal(tenantEnv(FAKE_ENV, mgl)!.LEGACY_MEDIA_ORIGIN, 'https://legacy.example');

  // Эх env хэвээр.
  assert.equal(FAKE_ENV.LEGACY_MEDIA_ORIGIN, 'https://mgl-legacy.example');
});

test('tenantEnv: FEEDBACK_BUCKET нь tenant бүрт ДАРЖ тавигдана — үндсэн компанийн хувийн bucket өвлөгдөхгүй', () => {
  const env = { ...FAKE_ENV, FEEDBACK_BUCKET: 'mgl-feedback', FEEDBACK_ACME: 'acme-feedback' };
  const base = { label: 'x', hosts: [] as string[], media: 'MEDIA_BUCKET', meeting: 'MEETING_BUCKET', db: 'DB' };
  // Зарлаагүй → undefined (хавсралтын замууд 503), tenant өөрөө ажилласаар.
  const plain = tenantEnv(env, { ...base, id: 'plain' })!;
  assert.ok(plain, 'feedback дутуу нь tenant-ыг унагахгүй');
  assert.equal(plain.FEEDBACK_BUCKET, undefined);
  // Зарласан → ЯГ өөрийнх.
  assert.equal(tenantEnv(env, { ...base, id: 'acme2', feedback: 'FEEDBACK_ACME' })!.FEEDBACK_BUCKET, 'acme-feedback');
  // Буруу нэр → undefined (үндсэн рүү унахгүй).
  assert.equal(tenantEnv(env, { ...base, id: 'bad', feedback: 'FEEDBACK_БАЙХГҮЙ' })!.FEEDBACK_BUCKET, undefined);
  // parseTenants нь талбарыг хадгална.
  const parsed = parseTenants(JSON.stringify([{ id: 'z', db: 'DB', media: 'M', meeting: 'N', feedback: ' FB ' }]))!;
  assert.equal(parsed[0]!.feedback, 'FB');
  assert.equal(env.FEEDBACK_BUCKET, 'mgl-feedback', 'эх env хэвээр');
});

/* ================================================================== */
/*  4. ТУСГААРЛАЛТ — хамгийн чухал                                     */
/* ================================================================== */

test('requestContext: контекстгүй үед дефолт (нэг-tenant горим)', () => {
  assert.equal(hasTenantContext(), false);
  assert.equal(currentTenantId(), DEFAULT_TENANT_ID);
});

test('requestContext: контекст дотор id зөв, гадна нь буцаад дефолт', () => {
  runWithTenant('acme', () => {
    assert.equal(hasTenantContext(), true);
    assert.equal(currentTenantId(), 'acme');
  });
  assert.equal(hasTenantContext(), false);
});

/** `app_settings` уншилтыг дуурайх, саатал тавих боломжтой D1 хуурмаг. */
function fakeDb(name: string, delayMs = 0) {
  return {
    prepare() {
      return {
        async all() {
          if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
          return { results: [{ key: ORG_SETTING_KEYS.name, value: name }] };
        },
      };
    },
  } as unknown as D1Database;
}

test('🔴 ТУСГААРЛАЛТ: солбицсон хүсэлтүүд тохиргоогоо ХОЛИХГҮЙ', async () => {
  resetOrgConfig();

  // A нь УДААН DB-тэй, B нь хурдан.  A-гийн `await` дундуур B бүрэн
  // ажиллаж дуусна — модулийн түвшний ганц хувьсагч байсан бол яг энд
  // A нь B-гийн нэрээр үргэлжлэх байсан.
  const runA = runWithTenant('a', async () => {
    await loadOrgConfig({ DB: fakeDb('Компани A', 40) });
    // Ачаалсны дараа sync уншилт өөрийн компанийхаа утгыг өгөх ЁСТОЙ
    await new Promise((r) => setTimeout(r, 30));
    return orgConfig().name;
  });

  const runB = runWithTenant('b', async () => {
    await loadOrgConfig({ DB: fakeDb('Компани B', 5) });
    await new Promise((r) => setTimeout(r, 5));
    return orgConfig().name;
  });

  const [a, b] = await Promise.all([runA, runB]);
  assert.equal(a, 'Компани A', 'A нь B-гийн тохиргоог авчихлаа');
  assert.equal(b, 'Компани B', 'B нь A-гийн тохиргоог авчихлаа');
  resetOrgConfig();
});

test('ТУСГААРЛАЛТ: нэг компанийн cache нөгөөгийнхөд нөлөөлөхгүй', async () => {
  resetOrgConfig();
  await runWithTenant('a', () => loadOrgConfig({ DB: fakeDb('A') }, { nowMs: 1000 }));
  await runWithTenant('b', () => loadOrgConfig({ DB: fakeDb('B') }, { nowMs: 1000 }));

  assert.equal(
    runWithTenant('a', () => orgConfig().name),
    'A',
  );
  assert.equal(
    runWithTenant('b', () => orgConfig().name),
    'B',
  );
  // Контекстгүй (cron / нэг-tenant) нь ХОЁУЛАНГААС НЬ хамааралгүй дефолт
  assert.equal(orgConfig().name, 'MGL E&C');
  resetOrgConfig();
});

test('ТУСГААРЛАЛТ: force reload зөвхөн ӨӨРИЙН компанийг шинэчилнэ', async () => {
  resetOrgConfig();
  await runWithTenant('a', () => loadOrgConfig({ DB: fakeDb('A-хуучин') }, { nowMs: 1000 }));
  await runWithTenant('b', () => loadOrgConfig({ DB: fakeDb('B-хуучин') }, { nowMs: 1000 }));

  await runWithTenant('a', () => loadOrgConfig({ DB: fakeDb('A-шинэ') }, { force: true }));

  assert.equal(
    runWithTenant('a', () => orgConfig().name),
    'A-шинэ',
  );
  assert.equal(
    runWithTenant('b', () => orgConfig().name),
    'B-хуучин',
    'B-гийн cache-ыг хөндсөн байна',
  );
  resetOrgConfig();
});
