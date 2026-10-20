// Revit add-in-ий лиценз (0374) — цэвэр дүрэм: Windows ↔ хөтчийн профайлын тулгалт,
// шийдвэр, гарын үсэгтэй лиценз.  Тулгалтын жишээнүүд нь прод дээрх БОДИТ
// `attendance_devices.hw_json` утгууд (2026-10-01-нд нэргүйгээр уншсан).
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

const L = await import('./revitLicense.ts');

/** ЗӨВХӨН ТЕСТИЙН түлхүүр — add-in-ий release build үүнд ХЭЗЭЭ Ч итгэхгүй.
 *  `revit-mcp/tests/Licensing.Tests`-ийн тест векторууд ижил түлхүүрээр. */
export const TEST_KEY_JSON =
  '{"kid":"test-0001","kty":"EC","crv":"P-256","d":"bOJ9ULu0YkNP8ywDgnEjRY-9Zwb19Y8ORTDIwF9-Lcs","x":"4u4bnjuUzrYh_tLI0GSzO2rD2ZKO_hAbIrhAZybljuk","y":"n6YABSm6JZQPoQIqNAOQyuXJbCAJJNY0hlOkjBvgqPo"}';

const BROWSER = {
  gpu: 'nvidia geforce rtx 3070',
  cores: 20,
  screen: '3440x1440',
  platform: 'win32',
  tz: 'Asia/Ulaanbaatar',
  memory: 8,
};

test('normalizeNativeProfile: Windows-ийн нэрсийг хөтчийн хэлбэрт, хог утгыг хасна', () => {
  const p = L.normalizeNativeProfile({
    gpus: ['NVIDIA GeForce RTX 3070', 'Microsoft Basic Display Adapter', 'NVIDIA GeForce RTX 3070', 42],
    cores: 20,
    screens: ['3440x1440', '1920X1080', 'bad', '3440x1440'],
  });
  assert.deepEqual(p, {
    gpus: ['nvidia geforce rtx 3070'],
    cores: 20,
    screens: ['3440x1440', '1920x1080'],
  });
  assert.equal(L.normalizeNativeProfile(null), null);
  assert.equal(L.normalizeNativeProfile({ gpus: [], screens: [] }), null);
});

test('gpuMatches: ижил нэр, хөтчийн ЕРӨНХИЙ нэр → Windows-ийн бүтэн нэр', () => {
  assert.ok(L.gpuMatches('nvidia geforce rtx 3070', ['nvidia geforce rtx 3070']));
  assert.ok(L.gpuMatches('intel(r) uhd graphics', ['intel(r) uhd graphics 770']));
  assert.ok(L.gpuMatches('amd radeon(tm) graphics', ['amd radeon(tm) graphics']));
  // Зөөврийн компьютер: хөтөч NVIDIA-г, Windows хоёуланг нь мэднэ.
  assert.ok(
    L.gpuMatches('nvidia geforce rtx 3050 ti laptop gpu', [
      'intel(r) uhd graphics',
      'nvidia geforce rtx 3050 ti laptop gpu',
    ]),
  );
  // 3070 ≠ 3070 ti, 1080 ≠ 1080 ti (угтвар нь ҮГЭЭР — «3070» нь «3070 ti»-ийн угтвар
  // боловч хөтөч нарийн, Windows ерөнхий байх тохиолдол ХУДАЛ эерэг өгнө).
  assert.ok(!L.gpuMatches('nvidia geforce rtx 3070 ti', ['nvidia geforce rtx 3070']));
  assert.ok(!L.gpuMatches('nvidia geforce rtx 3070', ['nvidia geforce rtx 3070 ti']));
  assert.ok(!L.gpuMatches('nvidia geforce gtx 1080', ['nvidia geforce gtx 1080 ti']));
  assert.ok(!L.gpuMatches('nvidia geforce rtx 2060', ['nvidia geforce rtx 3060']));
  // Brave хөтөч GPU-гээ нуудаг (прод дээр «brave»).
  assert.ok(!L.gpuMatches('brave', ['nvidia geforce rtx 3070']));
});

test('screenMatches: Windows-ийн масштаб / хөтчийн zoom-ыг харьцаагаар тулгана', () => {
  // Прод дээр хэмжсэн: 3440×1440 монитор → 3018×1264, 2752×1152, 3128×1310.
  for (const css of ['3440x1440', '3018x1264', '2752x1152', '3128x1310']) {
    assert.ok(L.screenMatches(css, ['3440x1440']), css);
  }
  assert.ok(L.screenMatches('1920x1080', ['3840x2160'])); // 4K 200 %
  assert.ok(L.screenMatches('1536x864', ['1920x1080'])); // 125 %
  assert.ok(L.screenMatches('1920x1080', ['2560x1440', '1920x1080'])); // хоёр монитор
  assert.ok(!L.screenMatches('1920x1080', ['3440x1440'])); // өөр харьцаа
  assert.ok(!L.screenMatches('1920x1080', ['1920x1200']));
  assert.ok(!L.screenMatches('1920x1080', []));
});

test('profileMatches: цөм + GPU + дэлгэц гурвуулаа', () => {
  const native = { gpus: ['nvidia geforce rtx 3070'], cores: 20, screens: ['3440x1440'] };
  assert.ok(L.profileMatches(BROWSER, native));
  assert.ok(!L.profileMatches(BROWSER, { ...native, cores: 24 }));
  assert.ok(!L.profileMatches(BROWSER, { ...native, gpus: ['nvidia geforce rtx 4060'] }));
  assert.ok(!L.profileMatches(BROWSER, { ...native, screens: ['1920x1080'] }));
  // Хөтчийн профайл хангалтгүй (GPU-гүй) бол хэзээ ч таарахгүй.
  assert.ok(!L.profileMatches({ ...BROWSER, gpu: null }, native));
  assert.ok(!L.profileMatches(BROWSER, null));
});

test('decideLicense: дараалал — идэвхгүй → role → хаасан → зөвшөөрсөн → тулгалт', () => {
  const native = { gpus: ['nvidia geforce rtx 3070'], cores: 20, screens: ['3440x1440'] };
  const work = [{ id: 7, hw_json: JSON.stringify(BROWSER) }];
  const user = { status: 'active', role: 'engineer' };

  assert.deepEqual(L.decideLicense({ user, deviceStatus: null, native, attendance: work }), {
    ok: true,
    via: 'match',
    attendanceDeviceId: 7,
  });
  assert.deepEqual(
    L.decideLicense({ user: { status: 'inactive', role: 'engineer' }, deviceStatus: 'approved', native, attendance: work }),
    { ok: false, code: 'USER_INACTIVE' },
  );
  for (const role of ['client', 'worker', null]) {
    assert.deepEqual(
      L.decideLicense({ user: { status: 'active', role }, deviceStatus: null, native, attendance: work }),
      { ok: false, code: 'ROLE_NOT_ALLOWED' },
    );
  }
  assert.deepEqual(L.decideLicense({ user, deviceStatus: 'blocked', native, attendance: work }), {
    ok: false,
    code: 'DEVICE_BLOCKED',
  });
  // Админ зөвшөөрсөн бол тулгалт таарахгүй ч (өөр GPU) ажиллана.
  assert.deepEqual(
    L.decideLicense({ user, deviceStatus: 'approved', native: null, attendance: [] }),
    { ok: true, via: 'approved', attendanceDeviceId: null },
  );
  assert.deepEqual(L.decideLicense({ user, deviceStatus: 'auto', native: null, attendance: work }), {
    ok: false,
    code: 'NO_HW_PROFILE',
  });
  assert.deepEqual(L.decideLicense({ user, deviceStatus: null, native, attendance: [] }), {
    ok: false,
    code: 'NO_WORK_PC_PROFILE',
  });
  // hw_json-гүй (0328-ын legacy) мөр нь ажлын компьютерын профайл биш.
  assert.deepEqual(
    L.decideLicense({ user, deviceStatus: null, native, attendance: [{ id: 1, hw_json: null }] }),
    { ok: false, code: 'NO_WORK_PC_PROFILE' },
  );
  assert.deepEqual(
    L.decideLicense({
      user,
      deviceStatus: null,
      native: { ...native, gpus: ['nvidia geforce rtx 4060'] },
      attendance: work,
    }),
    { ok: false, code: 'NOT_WORK_PC' },
  );
});

test('decideLicense: account горим — ажлын компьютер биш ч идэвхтэй ажилтны бүртгэлээр; хориг хэвээр', () => {
  const native = { gpus: ['nvidia geforce rtx 3070'], cores: 20, screens: ['3440x1440'] };
  const work = [{ id: 7, hw_json: JSON.stringify(BROWSER) }];
  const user = { status: 'active', role: 'engineer' };
  const acc = { accountMode: true } as const;
  const byAccount = { ok: true, via: 'account', attendanceDeviceId: null };
  // Таарвал «ажлын компьютер» гэж тэмдэглэгдсээр (админы харагдац).
  assert.deepEqual(L.decideLicense({ user, deviceStatus: null, native, attendance: work, ...acc }), {
    ok: true,
    via: 'match',
    attendanceDeviceId: 7,
  });
  // Гэрийн компьютер, ирцийн PC бүртгэлгүй, VM/RDP (техник шинжгүй) — бүгд бүртгэлээр.
  assert.deepEqual(
    L.decideLicense({ user, deviceStatus: null, native: { ...native, gpus: ['nvidia geforce rtx 4060'] }, attendance: work, ...acc }),
    byAccount,
  );
  assert.deepEqual(L.decideLicense({ user, deviceStatus: null, native, attendance: [], ...acc }), byAccount);
  assert.deepEqual(L.decideLicense({ user, deviceStatus: null, native: null, attendance: work, ...acc }), byAccount);
  // Идэвхгүй, эрхгүй role, admin хаасан — бүртгэлээр ч ХОРИГЛОНО.
  assert.deepEqual(L.decideLicense({ user: { status: 'inactive', role: 'engineer' }, deviceStatus: null, native, attendance: [], ...acc }), {
    ok: false,
    code: 'USER_INACTIVE',
  });
  for (const role of ['client', 'worker', null]) {
    assert.deepEqual(
      L.decideLicense({ user: { status: 'active', role }, deviceStatus: null, native, attendance: [], ...acc }),
      { ok: false, code: 'ROLE_NOT_ALLOWED' },
    );
  }
  assert.deepEqual(L.decideLicense({ user, deviceStatus: 'blocked', native, attendance: [], ...acc }), {
    ok: false,
    code: 'DEVICE_BLOCKED',
  });
});

test('decideLicense: уягдсан төхөөрөмж — дэлгэц өөрчлөгдсөн ч GPU + цөм таарвал', () => {
  const user = { status: 'active', role: 'engineer' };
  const work = [{ id: 7, hw_json: JSON.stringify(BROWSER) }];
  const undocked = { gpus: ['nvidia geforce rtx 3070'], cores: 20, screens: ['1920x1200'] };
  assert.deepEqual(L.decideLicense({ user, deviceStatus: 'auto', native: undocked, attendance: work }), {
    ok: false,
    code: 'NOT_WORK_PC',
  });
  assert.deepEqual(
    L.decideLicense({ user, deviceStatus: 'auto', native: undocked, attendance: work, boundAttendanceDeviceId: 7 }),
    { ok: true, via: 'match', attendanceDeviceId: 7 },
  );
  // Уягдсан мөр revoke хийгдсэн (attendance-д алга) → дахин бүрэн тулгалт.
  assert.deepEqual(
    L.decideLicense({ user, deviceStatus: 'auto', native: undocked, attendance: work, boundAttendanceDeviceId: 99 }),
    { ok: false, code: 'NOT_WORK_PC' },
  );
  assert.deepEqual(
    L.decideLicense({
      user,
      deviceStatus: 'auto',
      native: { ...undocked, cores: 16 },
      attendance: work,
      boundAttendanceDeviceId: 7,
    }),
    { ok: false, code: 'NOT_WORK_PC' },
  );
});

test('parseSigningKey: зөвхөн бүрэн EC P-256 JWK + kid', () => {
  const k = L.parseSigningKey(TEST_KEY_JSON);
  assert.equal(k?.kid, 'test-0001');
  assert.equal(L.parseSigningKey(undefined), null);
  assert.equal(L.parseSigningKey('nope'), null);
  const o = JSON.parse(TEST_KEY_JSON) as Record<string, string>;
  assert.equal(L.parseSigningKey(JSON.stringify({ ...o, d: undefined })), null);
  assert.equal(L.parseSigningKey(JSON.stringify({ ...o, crv: 'P-384' })), null);
  assert.equal(L.parseSigningKey(JSON.stringify({ ...o, kid: 'X' })), null);
});

test('signLease → verifyLease: гарын үсэг, хугацаа, хэлбэр', async () => {
  const key = L.parseSigningKey(TEST_KEY_JSON)!;
  const payload = L.buildLeasePayload({
    kid: key.kid,
    user: { id: 12, username: 'bat', full_name: 'Б.Бат', role: 'engineer' },
    deviceId: 'a'.repeat(64),
    via: 'match',
    nowSec: 1_790_000_000,
  });
  assert.equal(payload.exp - payload.iat, 12 * 3600); // 0375: 72 цагаас 12 цаг
  assert.equal(payload.rfa - payload.iat, 3600);
  assert.equal(payload.aud, 'mgl-revit-addin');

  const token = await L.signLease(payload, key);
  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  // r‖s (IEEE P1363) — 64 байт; .NET-ийн ECDsa.VerifyData-ийн хэлбэр.
  assert.equal(L.b64urlDecode(token.split('.')[1]!).length, 64);

  const pub = { x: key.jwk.x, y: key.jwk.y };
  assert.deepEqual(await L.verifyLease(token, pub), payload);

  // Нэг тэмдэгт өөрчилсөн payload → гарын үсэг таарахгүй.
  const [head, sig] = token.split('.') as [string, string];
  const forged = JSON.parse(new TextDecoder().decode(L.b64urlDecode(head))) as Record<string, unknown>;
  forged.exp = 4_000_000_000;
  const forgedHead = L.b64urlEncode(new TextEncoder().encode(JSON.stringify(forged)));
  assert.equal(await L.verifyLease(`${forgedHead}.${sig}`, pub), null);
  assert.equal(await L.verifyLease('garbage', pub), null);
});

test('isDeviceId: зөвхөн 64 тэмдэгтийн жижиг hex', () => {
  assert.ok(L.isDeviceId('0123456789abcdef'.repeat(4)));
  assert.ok(!L.isDeviceId('0123456789ABCDEF'.repeat(4)));
  assert.ok(!L.isDeviceId('abc'));
  assert.ok(!L.isDeviceId(undefined));
});
