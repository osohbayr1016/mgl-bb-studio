// Run with:  node --test src/lib/webPush.test.ts   (Node ≥ 22.18 / 24 strips types)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import {
  __encryptAes128gcmForTest,
  b64urlToBytes,
  bytesToB64url,
  truncateUtf8,
} from './webPush.ts';

// Апп-ын эх код нь өргөтгөлгүй импорт бичдэг (`from './webPush'`) — Worker-ийн
// bundler (esbuild) болон tsc-ийн "Bundler" moduleResolution үүнийг шийддэг;
// Node-ийн ESM loader шийддэггүй.  tsconfig-д `allowImportingTsExtensions`
// асаагаагүй тул эх кодыг `.ts`-тэй бичих ч боломжгүй.  Тиймээс ЗӨВХӨН тестийн
// хүрээнд өргөтгөлгүй, харьцангуй импортыг `.ts` руу буулгана.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

// Дээрх hook-ийн ДАРАА ачаалагдах ёстой тул динамик импорт (static import нь
// модулийн биеийг ажиллуулахаас өмнө шийдэгддэг).
const { CATEGORY_OF, PUSH_CATEGORIES, resolvePrefs } = await import('./pushSweep.ts');

/* ------------------------------------------------------------------ */
/*  RFC 8291 §5 — published push message encryption test vector        */
/* ------------------------------------------------------------------ */
//
// Энэ ганц тест дараах ЧИМЭЭГҮЙ алдаануудыг бүгдийг нь барина.  Тэдгээр
// нь бүгд push service-ээс 201 буцаадаг ч браузер мессежийг задалж
// чадахгүй тул хаядаг — өөрөөр оношлох бараг боломжгүй:
//   * key_info дэх ua_public / as_public-ийн ДАРААЛАЛ солигдох,
//   * "Content-Encoding: aes128gcm\0" / "nonce\0" info мөр буруу байх,
//   * бичлэгийн төгсгөлийн тусгаарлагч 0x02-ийн оронд 0x01 байх,
//   * `rs`-ийг little-endian бичих,
//   * толгойн байрлал (salt/rs/idlen/as_public) хазайх.

const RFC_PLAINTEXT = 'When I grow up, I want to be a watermelon';
const RFC_UA_PUBLIC =
  'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';
const RFC_AUTH_SECRET = 'BTBZMqHH6r4Tts7J_aSIgg';
const RFC_AS_PUBLIC =
  'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8';
const RFC_AS_PRIVATE = 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw';
const RFC_SALT = 'DGv6ra1nlYgDCS1FRnbzlw';
// RFC 8291 §5-ийн эцсийн мессежийн бие (мөрийн таслалыг нь наасан).
const RFC_EXPECTED_BODY =
  'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
  'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
  'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN';

/** RFC-ийн тогтмол илгээгчийн түлхүүрийг ECDH хос болгон импортлоно. */
async function rfcSenderKeyPair(): Promise<CryptoKeyPair> {
  const asPub = b64urlToBytes(RFC_AS_PUBLIC);
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: bytesToB64url(asPub.subarray(1, 33)),
      y: bytesToB64url(asPub.subarray(33, 65)),
      d: RFC_AS_PRIVATE,
    },
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  const publicKey = await crypto.subtle.importKey(
    'raw',
    asPub,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    [],
  );
  return { privateKey, publicKey };
}

test('aes128gcm: reproduces the RFC 8291 §5 body byte-for-byte', async () => {
  const body = await __encryptAes128gcmForTest(
    b64urlToBytes(RFC_UA_PUBLIC),
    b64urlToBytes(RFC_AUTH_SECRET),
    new TextEncoder().encode(RFC_PLAINTEXT),
    { salt: b64urlToBytes(RFC_SALT), ephemeral: await rfcSenderKeyPair() },
  );

  assert.equal(bytesToB64url(body), RFC_EXPECTED_BODY);
  // 86 байтын толгой + (41 текст + 1 тусгаарлагч + 16 GCM tag).
  assert.equal(body.length, 144);
});

test('aes128gcm: header layout — salt(16) ‖ rs=4096 BE ‖ idlen=65 ‖ as_public(65)', async () => {
  const body = await __encryptAes128gcmForTest(
    b64urlToBytes(RFC_UA_PUBLIC),
    b64urlToBytes(RFC_AUTH_SECRET),
    new TextEncoder().encode(RFC_PLAINTEXT),
    { salt: b64urlToBytes(RFC_SALT), ephemeral: await rfcSenderKeyPair() },
  );

  assert.equal(bytesToB64url(body.subarray(0, 16)), RFC_SALT);
  // Big-endian 4096 == 00 00 10 00.  Little-endian бол 00 10 00 00 болно.
  assert.deepEqual([...body.subarray(16, 20)], [0x00, 0x00, 0x10, 0x00]);
  assert.equal(body[20], 65);
  assert.equal(bytesToB64url(body.subarray(21, 86)), RFC_AS_PUBLIC);
});

test('aes128gcm: rejects malformed subscription keys', async () => {
  const good = b64urlToBytes(RFC_UA_PUBLIC);
  const auth = b64urlToBytes(RFC_AUTH_SECRET);
  const pt = new TextEncoder().encode('x');

  await assert.rejects(() => __encryptAes128gcmForTest(good.subarray(0, 64), auth, pt), /p256dh/);
  await assert.rejects(() => __encryptAes128gcmForTest(good, auth.subarray(0, 8), pt), /auth/);
});

/* ------------------------------------------------------------------ */
/*  truncateUtf8 — Монгол кирилл (2 байт/тэмдэгт)                      */
/* ------------------------------------------------------------------ */

const decoder = new TextDecoder('utf-8', { fatal: false });
const enc = new TextEncoder();

/** Тайрсан мөр нь UTF-8-аар БҮРЭН БҮТЭН эсэх — задалж, дахин кодлоход
 *  ижил гарах ба U+FFFD (replacement char) огт байхгүй байх ёстой. */
function assertCleanUtf8(s: string) {
  const round = decoder.decode(enc.encode(s));
  assert.equal(round, s);
  assert.ok(!s.includes('�'), `replacement character found in ${JSON.stringify(s)}`);
}

test('truncateUtf8: returns the string untouched when it already fits', () => {
  assert.equal(truncateUtf8('Сайн байна уу', 100), 'Сайн байна уу');
  // 13 тэмдэгт → 25 байт (12 кирилл × 2 + 1 зай)… яг таарсан хязгаар.
  const s = 'Сайн';
  assert.equal(truncateUtf8(s, enc.encode(s).length), s);
});

test('truncateUtf8: never splits a 2-byte Cyrillic code point at the boundary', () => {
  const s = 'Ажил баталгаажлаа';
  // Кирилл нь 2 байт тул сондгой хязгаар бүр нэг тэмдэгтийн дунд таарна.
  for (let max = 1; max <= enc.encode(s).length + 2; max++) {
    const out = truncateUtf8(s, max);
    assert.ok(
      enc.encode(out).length <= max,
      `max=${max}: ${enc.encode(out).length} байт гарлаа (${JSON.stringify(out)})`,
    );
    assertCleanUtf8(out);
  }
});

test('truncateUtf8: appends an ellipsis only when it actually truncated', () => {
  const s = 'Танд шинэ даалгавар оноогдлоо';
  const out = truncateUtf8(s, 20);
  assert.ok(out.endsWith('…'));
  assert.ok(enc.encode(out).length <= 20);
  assert.ok(s.startsWith(out.slice(0, -1)));
  assert.equal(truncateUtf8(s, 1000), s);
  assert.equal(truncateUtf8(s, 0), '');
});

test('truncateUtf8: handles surrogate pairs (emoji) without splitting them', () => {
  const s = 'Дууслаа 🎉🎉🎉';
  for (let max = 1; max <= enc.encode(s).length + 2; max++) {
    const out = truncateUtf8(s, max);
    assert.ok(enc.encode(out).length <= max);
    assertCleanUtf8(out);
  }
});

/* ------------------------------------------------------------------ */
/*  Ангиллын зураглал                                                  */
/* ------------------------------------------------------------------ */

/*
 * БҮРЭН ХАМРАЛТЫГ ЭНД ШАЛГАХГҮЙ.
 *
 * `CATEGORY_OF` нь `Record<NotificationType, PushCategory>` гэж
 * тэмдэглэгдсэн тул types.ts-д шинэ төрөл нэмэхэд ЭНЭ ФАЙЛ БИШ, харин
 * pushSweep.ts өөрөө compile алдаа өгнө — өөрөөр хэлбэл хамралт нь
 * төрлийн системээр баталгаажсан, тойрч гарах боломжгүй.
 *
 * Урьд нь энд 14 нэрийн хатуу жагсаалт байсан бөгөөд өөр хөгжүүлэгч
 * шинэ төрөл ЗӨВ нэмэх бүрд (ASR-ийн 3 төрөл гэх мэт) тест унаж, deploy
 * зогсдог байв — тестийн үнэ цэнэгүй эмзэг байдал.  Иймд доор зөвхөн
 * төрлийн систем шалгаж ЧАДАХГҮЙ зүйлсийг шалгана.
 */

test('CATEGORY_OF: түлхүүр бүр яг нэг удаа, хоосон утгагүй', () => {
  const keys = Object.keys(CATEGORY_OF);
  assert.ok(keys.length > 0, 'CATEGORY_OF хоосон байна');
  assert.equal(new Set(keys).size, keys.length, 'давхардсан түлхүүр байна');
  for (const [type, cat] of Object.entries(CATEGORY_OF)) {
    assert.ok(cat, `${type}-д ангилал оноогдоогүй`);
  }
});

test('CATEGORY_OF: ангилал бүрийг дор хаяж нэг төрөл ашигладаг', () => {
  // Ашиглагдахгүй ангилал = Тохиргоо дээр хэзээ ч ажиллахгүй унтраалга.
  // Үүнийг төрлийн систем барьж чадахгүй.
  const used = new Set(Object.values(CATEGORY_OF));
  for (const cat of PUSH_CATEGORIES) {
    assert.ok(used.has(cat), `'${cat}' ангилалд ямар ч мэдэгдлийн төрөл хамаарахгүй байна`);
  }
});

test('CATEGORY_OF: every value is a known push category', () => {
  for (const [type, cat] of Object.entries(CATEGORY_OF)) {
    assert.ok(PUSH_CATEGORIES.includes(cat), `${type} → ${cat} нь танигдахгүй ангилал`);
  }
});

test('resolvePrefs: defaults on null / malformed JSON, merges known keys only', () => {
  // ⚠️ ХАТУУ БИЧСЭН объект БИШ — `PUSH_CATEGORIES`-аас УРГУУЛНА.
  //
  // Урьд нь зургаан түлхүүр гараар бичигдсэн байсан.  `deadlines` ангилал
  // нэмэгдэхэд тест хуучирч, репод «мэдэгдэж буй унасан тест» болж удаан
  // хугацаагаар үлдсэн — тэр байдал нь `resolvePrefs` дээр ирэх ЖИНХЭНЭ
  // регрессийг далдлах байсан (хоёр дахь алдаа гарсан ч тоо нь 1-ээс
  // өөрчлөгдөхгүй тул хэн ч анзаарахгүй).  Эх сурвалжаас нь ургуулснаар
  // шинэ ангилал нэмэхэд тест ӨӨРӨӨ дагана.
  const allOn = Object.fromEntries(PUSH_CATEGORIES.map((cat) => [cat, true]));
  assert.deepEqual(resolvePrefs(null), allOn);
  assert.deepEqual(resolvePrefs('not json'), allOn);
  assert.deepEqual(resolvePrefs('[1,2,3]'), allOn);
  assert.deepEqual(resolvePrefs('{"leaves":false,"unknown":true,"tasks":"yes"}'), {
    ...allOn,
    leaves: false,
  });
});
