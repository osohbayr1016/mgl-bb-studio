/**
 * `routes/learning.ts` — ЦУГЛУУЛГЫН ХАРИУНЫ ҮНЭН ТООЦООНЫ тест.
 *
 * Run with:  node --test src/routes/learning.ingestAccounting.test.ts
 *
 * ⚠️ ЯАГААД ЭНЭ ТЕСТ ОРШИН БАЙНА ВЭ.  Add-in (`BimEmitter.cs`) нь ЯМАР Ч
 *    2xx хариуг «бүрэн хүлээж авсан» гэж үзээд `sent = take.Count` гээд
 *    мөрүүдээ устгаж, курсороо ахиулдаг — хариуны биеийг ЗАДАЛДАГГҮЙ.
 *    Тэр нь ЗӨВХӨН сервер өөрийн татгалзлаа сессийн тоолуурт бичдэг
 *    учраас Л аюулгүй байсан.  Гэвч `sessionId` NULL үед серверийн
 *    `bumpSessionCounters` АЖИЛЛАХГҮЙ (тэр дуудлага нь `sessionId !== null`
 *    хамгаалалттай) — тэгэхэд сервер 200 буцааж, клиент мөрүүдээ устгаж,
 *    алдагдал ХААНА Ч бүртгэгдэхгүй: ЧИМЭЭГҮЙ БҮРЭН АЛДАГДАЛ.
 *
 *    `ingestOutcome` бол тэр урхийг хаасан ЦЭВЭР ШИЙДВЭР.  Гэрээ нь:
 *      • `accounted` — клиент мөрүүдээ устгах эрхийг ЗӨВХӨН ЭНДЭЭС авна,
 *        HTTP статусаас БИШ.
 *      • Бүхэлдээ татгалзсан багц ХООСОН 200 БУЦААХГҮЙ (422).
 *      • ДАВХАРДАЛ нь татгалзал БИШ — дахин илгээлт 200 хэвээр.
 *
 * ⚠️ Өргөтгөлгүй импортыг Node-ийн ESM loader шийддэггүй — `registerHooks`
 *    (`bimEvents.test.ts:24-31`) ЗААВАЛ, дараа нь `await import`.
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

const M = await import('./learning.ts');

/* ================================================================== */

test('хэвийн багц → 200, accounted', () => {
  const o = M.ingestOutcome({ hasSession: true, sent: 10, accepted: 8, duplicates: 0, lost: 2 });
  assert.equal(o.status, 200);
  assert.equal(o.ok, true);
  assert.equal(o.accounted, true);
  assert.equal(o.error, null);
});

test('ХООСОН багц (зөвхөн сессийн handshake) → 200', () => {
  const o = M.ingestOutcome({ hasSession: true, sent: 0, accepted: 0, duplicates: 0, lost: 0 });
  assert.equal(o.status, 200);
  assert.equal(o.accounted, true);
});

test('ДАХИН ИЛГЭЭЛТ (бүгд давхардсан) → 200, ХЭЗЭЭ Ч 422 БИШ', () => {
  // Сүлжээ тасарсны дараах дахин илгээлт нь ХЭВИЙН.  Үүнийг 422 болговол
  // клиент мөнхөд гацна — add-in-д алсаас засах механизм БАЙХГҮЙ.
  const o = M.ingestOutcome({ hasSession: true, sent: 6, accepted: 0, duplicates: 6, lost: 0 });
  assert.equal(o.status, 200);
  assert.equal(o.ok, true);
  assert.equal(o.accounted, true);
});

test('БҮХЭЛДЭЭ ТАТГАЛЗСАН багц → 422, ХООСОН 200 БИШ', () => {
  const o = M.ingestOutcome({ hasSession: true, sent: 4, accepted: 0, duplicates: 0, lost: 4 });
  assert.equal(o.status, 422);
  assert.equal(o.ok, false);
  assert.equal(o.error, 'batch_rejected');
  // Алдагдал нь сессийн server_dropped_count-д бичигдсэн тул клиент
  // мөрүүдээ устгаж болно; ижил багцыг дахин илгээх нь утгагүй.
  assert.equal(o.accounted, true);
  assert.equal(o.retryable, false);
});

test('СЕСГҮЙ АЛДАГДАЛ → 409, accounted=false, retryable (далд бүрэн алдагдлын зам)', () => {
  const o = M.ingestOutcome({ hasSession: false, sent: 4, accepted: 0, duplicates: 0, lost: 4 });
  assert.equal(o.status, 409);
  assert.equal(o.ok, false);
  assert.equal(o.error, 'loss_unaccounted');
  assert.equal(o.accounted, false, 'клиент мөрүүдээ ХАДГАЛАХ ЁСТОЙ');
  assert.equal(o.retryable, true);
});

test('сесгүй ч алдагдалгүй бол 200 (сессгүй үйл явдал ХЭВИЙН)', () => {
  // `learning_events.session_id` нь NULLABLE — вэб талын батлалт, дүрмийн
  // дүгнэлт зэрэг Revit сессгүй мөр ХЭВИЙН.  Алдагдал БАЙХГҮЙ бол
  // бүртгэх зүйл ч байхгүй.
  const o = M.ingestOutcome({ hasSession: false, sent: 3, accepted: 3, duplicates: 0, lost: 0 });
  assert.equal(o.status, 200);
  assert.equal(o.accounted, true);
});

test('сесгүй, хэсэгчлэн бичигдсэн, алдагдалтай → 409 (200 БИШ)', () => {
  const o = M.ingestOutcome({ hasSession: false, sent: 5, accepted: 3, duplicates: 0, lost: 2 });
  assert.equal(o.status, 409);
  assert.equal(o.accounted, false);
});

test('accounted=false үед ХЭЗЭЭ Ч 2xx буцаахгүй', () => {
  // ⚠️ ИНВАРИАНТ.  Клиент 2xx-ыг «устгаж болно» гэж уншдаг тул
  //    бүртгэгдээгүй алдагдал нь 2xx-тай ХЭЗЭЭ Ч хамт явахгүй.
  for (const hasSession of [true, false]) {
    for (const sent of [0, 1, 5]) {
      for (const accepted of [0, 1, 5]) {
        for (const duplicates of [0, 2]) {
          for (const lost of [0, 1, 5]) {
            const o = M.ingestOutcome({ hasSession, sent, accepted, duplicates, lost });
            if (!o.accounted) {
              assert.ok(o.status >= 400, `accounted=false атлаа status=${o.status}`);
            }
            if (o.status === 200) assert.equal(o.ok, true);
          }
        }
      }
    }
  }
});
