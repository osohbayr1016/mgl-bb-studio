/**
 * MGL AI runtime · ЛОКАЛ ХАМГААЛАЛТ — ТЕСТ.
 *
 * Run with:  node --test runtime/test/auth.test.ts
 *
 * ⚠️ ГОЛ АМЛАЛТ (§48): «Do not expose unauthenticated localhost endpoints
 *    that any random webpage can invoke.»  Репогийн аюулгүй байдлын #7
 *    (`revit-mcp/server/`-ийн баталгаажуулалтгүй Roslyn) -ийг ДАВТАХГҮЙ.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SessionStore,
  authenticate,
  originAllowed,
  isTrustedBrowserOrigin,
  safeEqual,
  newSecret,
  SESSION_TTL_MS,
} from '../src/auth.ts';

const ALLOWED = ['https://mgl-design-system.pages.dev', 'http://localhost:5173'];

function cfg(secret: string, sessions = new SessionStore()) {
  return { secret, sessions, allowedOrigins: ALLOWED };
}

/* ================================================================== */
/*  1. Итгэлцэлгүй хүсэлт                                              */
/* ================================================================== */

test('итгэлцэлгүй хүсэлт ТАТГАЛЗАНА', () => {
  const r = authenticate({}, cfg('s'.repeat(64)));
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, 'no_credential');
});

test('буруу нууц ТАТГАЛЗАНА', () => {
  const r = authenticate({ secret: 'буруу' }, cfg('a'.repeat(64)));
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, 'bad_secret');
});

test('зөв нууц ЗӨВШӨӨРНӨ', () => {
  const secret = newSecret();
  const r = authenticate({ secret }, cfg(secret));
  assert.equal(r.ok, true);
  assert.equal(r.ok === true && r.via, 'secret');
});

/* ================================================================== */
/*  2. Хортой вэб хуудас                                               */
/* ================================================================== */

test('ХОРТОЙ ХУУДАС нь зөв нууцтай ч Origin-оороо баригдана', () => {
  // XSS-ээр нууц алдагдсан ч хөтөч Origin-ыг ХУУРЧ чадахгүй.
  const secret = newSecret();
  const r = authenticate({ origin: 'https://evil.example.com', secret }, cfg(secret));
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, 'bad_origin');
});

test('зөвшөөрөгдсөн гарал үүсэл нэвтэрнэ', () => {
  const secret = newSecret();
  for (const origin of ALLOWED) {
    const r = authenticate({ origin, secret }, cfg(secret));
    assert.equal(r.ok, true, origin);
  }
});

test('Origin-гүй дуудагч (add-in, CLI) нь нууцаараа нэвтэрнэ', () => {
  const secret = newSecret();
  assert.equal(originAllowed(undefined, ALLOWED), true);
  assert.equal(originAllowed('null', ALLOWED), true);
  // Гэхдээ нууцгүйгээр ХЭЗЭЭ Ч биш.
  assert.equal(authenticate({}, cfg(secret)).ok, false);
});

/* ================================================================== */
/*  3. Сесс                                                            */
/* ================================================================== */

test('сессийн токен ажиллана, хуурамч нь ажиллахгүй', () => {
  const store = new SessionStore();
  const secret = newSecret();
  const { token } = store.issue();

  assert.equal(authenticate({ session: token }, cfg(secret, store)).ok, true);
  assert.equal(authenticate({ session: 'zohioson' }, cfg(secret, store)).ok, false);
});

test('хугацаа нь дууссан сесс ажиллахгүй', () => {
  const store = new SessionStore();
  const now = Date.now();
  const { token } = store.issue(now);
  assert.equal(store.valid(token, now + 1000), true);
  assert.equal(store.valid(token, now + SESSION_TTL_MS + 1), false);
  // Хугацаа дуусахад бүртгэлээс ХАСАГДАНА — санах ой хуримтлагдахгүй.
  assert.equal(store.size, 0);
});

test('цуцалсан сесс шууд ажиллахгүй', () => {
  const store = new SessionStore();
  const { token } = store.issue();
  store.revoke(token);
  assert.equal(store.valid(token), false);
});

test('хоосон/буруу төрлийн токен нь унахгүй, худал буцаана', () => {
  const store = new SessionStore();
  assert.equal(store.valid(''), false);
  assert.equal(store.valid(null), false);
  assert.equal(store.valid(undefined), false);
});

/* ================================================================== */
/*  4. Нууцын чанар                                                    */
/* ================================================================== */

test('нууц нь 32 байт (64 hex) ба давтагдахгүй', () => {
  const a = newSecret();
  const b = newSecret();
  assert.equal(a.length, 64);
  assert.notEqual(a, b);
});

test('safeEqual нь урт өөр байсан ч унахгүй', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abcdef'), false);
  assert.equal(safeEqual('', ''), true);
});

/* ================================================================== */
/*  ORIGIN НЬ ИТГЭМЖЛЭЛ — 2026-09-09-ны загварын өөрчлөлт              */
/* ================================================================== */

test('ERP-ийн гарал үүслээс НУУЦГҮЙГЭЭР нэвтэрнэ', () => {
  // ⚠️ Эзний заавар: ERP-д нэвтэрсэн ажилтнаас дахин «нууц» асуухгүй.
  //    `Origin`-ыг хөтөч өөрөө тавьдаг тул энэ нь найдвартай итгэмжлэл.
  const sessions = new SessionStore();
  const out = authenticate(
    { origin: 'https://mgl-design-system.pages.dev' },
    { secret: 'S'.repeat(64), sessions, allowedOrigins: ALLOWED },
  );
  assert.equal(out.ok, true);
  assert.equal(out.ok && out.via, 'origin');
});

test('ХОРТОЙ хуудас нууцгүйгээр нэвтэрч ЧАДАХГҮЙ', () => {
  // ⚠️ ХАМГИЙН ЧУХАЛ ТЕСТ.  Нууцыг хассан нь хаалгыг нээгээгүй гэдгийг
  //    батална: хортой хуудасны Origin нь жагсаалтад БАЙХГҮЙ тул
  //    `bad_origin` дээр унана.
  const sessions = new SessionStore();
  for (const origin of [
    'https://evil.example.com',
    'http://mgl-design-system.pages.dev', // http — өөр origin
    'https://mgl-design-system.pages.dev.evil.com', // угтвар заль
    'https://sub.mgl-design-system.pages.dev',
  ]) {
    const out = authenticate(
      { origin },
      { secret: 'S'.repeat(64), sessions, allowedOrigins: ALLOWED },
    );
    assert.equal(out.ok, false, `${origin} нэвтэрсэн!`);
    assert.equal(out.ok === false && out.reason, 'bad_origin', origin);
  }
});

test('ORIGIN-ГҮЙ дуудагч (curl, скрипт) НУУЦ ШААРДАНА', () => {
  // ⚠️ Хөтөч БИШ клиент нь Origin илгээхгүй.  Тэднийг нууцгүйгээр
  //    оруулбал тухайн машин дээрх ДУРЫН процесс AI-г ашиглана.
  const sessions = new SessionStore();
  const noCred = authenticate(
    {},
    { secret: 'S'.repeat(64), sessions, allowedOrigins: ALLOWED },
  );
  assert.equal(noCred.ok, false);
  assert.equal(noCred.ok === false && noCred.reason, 'no_credential');

  const withSecret = authenticate(
    { secret: 'S'.repeat(64) },
    { secret: 'S'.repeat(64), sessions, allowedOrigins: ALLOWED },
  );
  assert.equal(withSecret.ok, true);
  assert.equal(withSecret.ok && withSecret.via, 'secret');
});

test('isTrustedBrowserOrigin нь Origin-гүйг ИТГЭХГҮЙ', () => {
  assert.equal(isTrustedBrowserOrigin(undefined, ALLOWED), false);
  assert.equal(isTrustedBrowserOrigin('null', ALLOWED), false);
  assert.equal(isTrustedBrowserOrigin('https://evil.example.com', ALLOWED), false);
  assert.equal(isTrustedBrowserOrigin('https://mgl-design-system.pages.dev', ALLOWED), true);
});

test('БУРУУ нууц нь Origin-оор ГЭТЭЛЖ БОЛОХГҮЙ', () => {
  // ⚠️ Нууц ИЛГЭЭСЭН атлаа буруу бол — Origin зөв ч гэсэн ТАТГАЛЗАНА.
  //    Эс тэгвэл халдагч буруу нууц илгээгээд Origin руу «унаж» орно.
  const sessions = new SessionStore();
  const out = authenticate(
    { origin: 'https://mgl-design-system.pages.dev', secret: 'БУРУУ' },
    { secret: 'S'.repeat(64), sessions, allowedOrigins: ALLOWED },
  );
  assert.equal(out.ok, false);
  assert.equal(out.ok === false && out.reason, 'bad_secret');
});
