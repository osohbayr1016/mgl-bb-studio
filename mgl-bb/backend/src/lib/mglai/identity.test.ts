/**
 * MGL AI · ХЭН ЯРЬЖ БАЙНА — ТЕСТ.
 *
 * Run with:  node --test src/lib/mglai/identity.test.ts
 *
 * ⚠️ Энэ файл нь ЗӨВХӨН цэвэр логикийг шалгана.  Хамгийн чухал нь
 *    «биеэс ирсэн role-д ИТГЭХГҮЙ» гэсэн дүрэм — тэр нь функцийн ГАРЫН
 *    ҮСГЭЭР баталгаажсан (payload-аас өөр эх сурвалж БАЙХГҮЙ), гэвч
 *    доорх тест нь танихгүй/хуурамч утга хаалттай унадгийг барина.
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

const { resolveAiMode, resolveAiIdentity, sanitizeAnonKey, isEmployeeTier, isAdminTier, AI_MODES } =
  await import('./identity.ts');

test('role бүр зөв горимд буулгагдана', () => {
  assert.equal(resolveAiMode('admin'), 'admin');
  assert.equal(resolveAiMode('senior'), 'employee');
  assert.equal(resolveAiMode('engineer'), 'employee');
  assert.equal(resolveAiMode('architect'), 'employee');
  assert.equal(resolveAiMode('client'), 'client');
});

test('worker (цэвэрлэгч) нь MGL AI-д ХҮРЭХГҮЙ', () => {
  // workerScope.ts аль хэдийн 403 өгдөг — энэ бол ХОЁРДУГААР давхарга.
  assert.equal(resolveAiMode('worker'), 'denied');
});

test('нэвтрээгүй зочин нь client горим', () => {
  assert.equal(resolveAiMode(null), 'client');
  assert.equal(resolveAiMode(undefined), 'client');
});

test('ТАНИХГҮЙ role нь ХААЛТТАЙ унана, нээлттэй биш', () => {
  // Шинэ role нэмэгдэхэд MGL AI өгөгдмөлөөр хаагдана.
  assert.equal(resolveAiMode('superuser' as never), 'denied');
  assert.equal(resolveAiMode('' as never), 'denied');
});

test('биеэс ирсэн role МЭДЭЭЛЭЛ болж ОРОХГҮЙ', () => {
  // Хорлогдсон биет `role: 'admin'` илгээсэн ч токены role л шийднэ.
  const id = resolveAiIdentity({ sub: 7, role: 'engineer' });
  assert.equal(id.mode, 'employee');
  assert.equal(id.userId, 7);
});

test('voter_key нь нэвтэрсэн/зочныг ялгана', () => {
  assert.equal(resolveAiIdentity({ sub: 12, role: 'admin' }).voterKey, 'u:12');
  assert.equal(resolveAiIdentity(null, 'abc123').voterKey, 'a:abc123');
});

test('санамжийн namespace нь ажилтан/захиалагчийг ХЭЗЭЭ Ч холихгүй', () => {
  assert.equal(resolveAiIdentity({ sub: 1, role: 'engineer' }).memoryNamespace, 'employee');
  assert.equal(resolveAiIdentity({ sub: 2, role: 'client' }).memoryNamespace, 'client');
  assert.equal(resolveAiIdentity({ sub: 3, role: 'admin' }).memoryNamespace, 'employee');
  // Нэвтрээгүй зочин ч захиалагчийн namespace.
  assert.equal(resolveAiIdentity(null).memoryNamespace, 'client');
});

test('buruu sub нь userId-г null болгоно', () => {
  assert.equal(resolveAiIdentity({ sub: 0, role: 'admin' }).userId, null);
  assert.equal(resolveAiIdentity({ sub: -3, role: 'admin' }).userId, null);
  assert.equal(resolveAiIdentity({ sub: 'abc', role: 'admin' }).userId, null);
});

test('anon түлхүүр цэвэрлэгдэнэ — SQL/индексийн аюулгүй байдал', () => {
  assert.equal(sanitizeAnonKey("'; DROP TABLE users--"), 'DROPTABLEusers--');
  assert.equal(sanitizeAnonKey(''), 'unknown');
  assert.equal(sanitizeAnonKey(null), 'unknown');
  assert.equal(sanitizeAnonKey('x'.repeat(200)).length, 64);
});

test('давхаргын туслахууд', () => {
  assert.equal(isEmployeeTier('employee'), true);
  assert.equal(isEmployeeTier('admin'), true);
  assert.equal(isEmployeeTier('client'), false);
  assert.equal(isEmployeeTier('denied'), false);
  assert.equal(isAdminTier('admin'), true);
  assert.equal(isAdminTier('employee'), false);
});

test('AI_MODES нь дөрвөн утгатай, хаалттай', () => {
  assert.deepEqual([...AI_MODES], ['client', 'employee', 'admin', 'denied']);
});
