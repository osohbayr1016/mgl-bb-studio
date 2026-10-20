// Run with:  node --test src/lib/mediaUrl.test.ts   (Node >= 22.18 / 24 strips types)
//
// `lib/mediaUrl.ts` нь юу ч импортлодоггүй тул `webPush.test.ts` /
// `leaveWindow.test.ts`-ийн `registerHooks` заль энд ХЭРЭГГҮЙ — энгийн
// статик импорт хангалттай.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSingleSegmentKey, isSingleSegmentMediaUrl } from './mediaUrl.ts';

test('isSingleSegmentKey: хавтасгүй хууль ёсны түлхүүр', () => {
  assert.equal(isSingleSegmentKey('a.png'), true);
  // `upload.ts:33`-ийн бодит хэлбэр: `<userSub>-<timestamp>-<name>`
  assert.equal(isSingleSegmentKey('2-1756000000-a.png'), true);
  assert.equal(isSingleSegmentKey('default-profile-photo.png'), true);
  // `email.ts:917`-ийн ХАВТАСГҮЙ болгосон лежерийн хавсралт
  assert.equal(isSingleSegmentKey('corr-att-12-34-scan.pdf'), true);
});

test('isSingleSegmentKey: бодит `/`-той хавтастай түлхүүр', () => {
  assert.equal(isSingleSegmentKey('email/5/x'), false);
  assert.equal(isSingleSegmentKey('email/5/x/body.html'), false);
  assert.equal(isSingleSegmentKey('revit-addin/RevitMcpAddin-Revit2027.zip'), false);
  assert.equal(isSingleSegmentKey('client-reports/30-48-uuid.pdf'), false);
});

test('isSingleSegmentKey: %2F дамжлага — ЭНЭ БОЛ ГОЛ КЕЙС', () => {
  // Hono нь `c.req.param()` дээр аль хэдийн нэг удаа задалдаг тул бодит
  // нөхцөлд энд ЗАДАРСАН утга ирнэ.  Гэхдээ бичих тал (D1-д хадгалагдах
  // мөр) нь кодлогдсон хэвээр ирдэг учир ХОЁУЛАНГ нь барина.
  assert.equal(isSingleSegmentKey('email%2F5%2Fx'), false);
  assert.equal(isSingleSegmentKey('email%2F5%2Fx%2Fbody.html'), false);
});

test('isSingleSegmentKey: %2f ЖИЖИГ үсгийн хувилбар мөн хаагдана', () => {
  // Продакшнд хэмжсэн: `%2f` нь `%2F`-тэй яг адил 200 буцаадаг байсан.
  assert.equal(isSingleSegmentKey('email%2f5%2fx'), false);
  assert.equal(isSingleSegmentKey('revit-addin%2fRevitMcpAddin-Revit2027.zip'), false);
});

test('isSingleSegmentKey: давхар кодлолт (§9 №6-ийн шийдвэр)', () => {
  assert.equal(isSingleSegmentKey('email%252F5'), false);
  assert.equal(isSingleSegmentKey('email%25252F5'), false);
});

test('isSingleSegmentKey: хоосон, гэмтсэн, тусгай тэмдэгт', () => {
  assert.equal(isSingleSegmentKey(''), false);
  assert.equal(isSingleSegmentKey('%zz'), false); // decodeURIComponent шидэнэ
  assert.equal(isSingleSegmentKey('a\u005Cb'), false); // урвуу ташуу
  assert.equal(isSingleSegmentKey('a%5Cb'), false); // кодлогдсон урвуу ташуу
  assert.equal(isSingleSegmentKey('a\0b'), false); // NUL
  assert.equal(isSingleSegmentKey('a%00b'), false); // кодлогдсон NUL
});

test('isSingleSegmentMediaUrl: хүлээн авах хэлбэр', () => {
  assert.equal(isSingleSegmentMediaUrl('/media/a.png'), true);
  assert.equal(isSingleSegmentMediaUrl('/media/2-1756000000-a.png'), true);
});

test('isSingleSegmentMediaUrl: татгалзах хэлбэрүүд', () => {
  assert.equal(isSingleSegmentMediaUrl('/media/a%2Fb.png'), false);
  assert.equal(isSingleSegmentMediaUrl('/media/a%2fb.png'), false);
  assert.equal(isSingleSegmentMediaUrl('/media/email%2F5%2Fx%2Fbody.html'), false);
  assert.equal(isSingleSegmentMediaUrl('/media/email/5/x/body.html'), false);
  assert.equal(isSingleSegmentMediaUrl('/media/'), false); // хоосон түлхүүр
  // Гаднын URL-ыг тайлан руу шургуулж, хэвлэх хуудсаар ачаалуулах гарц
  assert.equal(isSingleSegmentMediaUrl('https://evil/x.png'), false);
  assert.equal(isSingleSegmentMediaUrl('//evil/x.png'), false);
  assert.equal(isSingleSegmentMediaUrl('data:image/png;base64,AAAA'), false);
  // Угтвар нь ЯГ `/media/` байх ёстой
  assert.equal(isSingleSegmentMediaUrl('/mediax/a.png'), false);
  assert.equal(isSingleSegmentMediaUrl('media/a.png'), false);
});

test('isSingleSegmentMediaUrl: мөр биш утга', () => {
  assert.equal(isSingleSegmentMediaUrl(null), false);
  assert.equal(isSingleSegmentMediaUrl(undefined), false);
  assert.equal(isSingleSegmentMediaUrl(42), false);
  assert.equal(isSingleSegmentMediaUrl({ url: '/media/a.png' }), false);
  assert.equal(isSingleSegmentMediaUrl(['/media/a.png']), false);
});
