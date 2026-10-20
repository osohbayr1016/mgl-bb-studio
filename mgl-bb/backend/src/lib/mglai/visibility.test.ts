/**
 * MGL AI · НУУЦЛАЛЫН ШҮҮЛТ — ТЕСТ (§46-ийн «Security tests»).
 *
 * Run with:  node --test src/lib/mglai/visibility.test.ts
 *
 * ⚠️ ЭНЭ ФАЙЛЫН ГОЛ АМЛАЛТ: «Client should NEVER retrieve employee-private
 *    data.»  Доорх тестүүд нь тэрийг ЦЭВЭР функцийн түвшинд барина —
 *    интеграцын тест бол хоёрдугаар давхарга, энэ нь эхнийх.
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

const { filterEvidence, evidenceDropReason, budgetEvidence } = await import('./visibility.ts');

type Ev = Parameters<typeof evidenceDropReason>[0];
type Vw = Parameters<typeof evidenceDropReason>[1];

function ev(over: Partial<Ev> = {}): Ev {
  return {
    id: 'e1',
    kind: 'chunk',
    title: 'гарчиг',
    text: 'агуулга',
    classification: 'internal',
    visibilityScope: 'company',
    allowedRoles: [],
    ...over,
  } as Ev;
}

const CLIENT: Vw = { mode: 'client', role: 'client', userId: 9, projectIds: [30], orgId: 4 };
const ENGINEER: Vw = { mode: 'employee', role: 'engineer', userId: 5, projectIds: [30], orgId: null };
const ADMIN: Vw = { mode: 'admin', role: 'admin', userId: 2, projectIds: [], orgId: null };

/* ================================================================== */
/*  1. Захиалагч — хамгийн чухал хил                                   */
/* ================================================================== */

test('ЗАХИАЛАГЧ нь internal ангилалд ХЭЗЭЭ Ч хүрэхгүй', () => {
  const r = evidenceDropReason(ev({ classification: 'internal' }), CLIENT);
  assert.equal(r, 'classification_too_high');
});

test('ЗАХИАЛАГЧ нь confidential ангилалд ХЭЗЭЭ Ч хүрэхгүй', () => {
  assert.equal(
    evidenceDropReason(ev({ classification: 'confidential', visibilityScope: 'public' }), CLIENT),
    'classification_too_high',
  );
});

test('ЗАХИАЛАГЧ нь public ангилалтай ч company хамрах хүрээтэй мөрийг АВАХГҮЙ', () => {
  // Ангилал ба хамрах хүрээ ХОЁУЛАА таарах ёстой — «public тул зүгээр»
  // гэсэн нэг талын дүгнэлт нь дотоод тэмдэглэлийг задруулна.
  const r = evidenceDropReason(
    ev({ classification: 'public', visibilityScope: 'company' }),
    CLIENT,
  );
  assert.equal(r, 'client_needs_public_scope');
});

test('ЗАХИАЛАГЧ нь public/public мөрийг АВНА', () => {
  assert.equal(
    evidenceDropReason(ev({ classification: 'public', visibilityScope: 'public' }), CLIENT),
    null,
  );
});

test('ЗАХИАЛАГЧ нь ӨӨРИЙН байгууллагын материалыг АВНА, өөрийнхийг БИШ', () => {
  const mine = ev({ classification: 'public', visibilityScope: 'org', orgId: 4 });
  const other = ev({ classification: 'public', visibilityScope: 'org', orgId: 5 });
  assert.equal(evidenceDropReason(mine, CLIENT), null);
  assert.equal(evidenceDropReason(other, CLIENT), 'org_mismatch');
});

test('ЗАХИАЛАГЧ нь өөрийн төслийн материалыг Л авна', () => {
  const mine = ev({ classification: 'public', visibilityScope: 'project', projectId: 30 });
  const other = ev({ classification: 'public', visibilityScope: 'project', projectId: 31 });
  assert.equal(evidenceDropReason(mine, CLIENT), null);
  assert.equal(evidenceDropReason(other, CLIENT), 'project_out_of_scope');
});

/* ================================================================== */
/*  2. restricted — ХЭН Ч уншихгүй                                     */
/* ================================================================== */

test('restricted ангилалд АДМИН ч хүрэхгүй', () => {
  const e = ev({ classification: 'restricted', visibilityScope: 'company' });
  assert.equal(evidenceDropReason(e, ADMIN), 'classification_too_high');
  assert.equal(evidenceDropReason(e, ENGINEER), 'classification_too_high');
  assert.equal(evidenceDropReason(e, CLIENT), 'classification_too_high');
});

/* ================================================================== */
/*  3. Хаалттай-анхдагч                                                */
/* ================================================================== */

test('ТАНИХГҮЙ ангилал ХАСАГДАНА', () => {
  assert.equal(
    evidenceDropReason(ev({ classification: 'secret' as never }), ADMIN),
    'unknown_classification',
  );
});

test('ТАНИХГҮЙ хамрах хүрээ ХАСАГДАНА', () => {
  assert.equal(
    evidenceDropReason(ev({ visibilityScope: 'everyone' as never }), ADMIN),
    'unknown_scope',
  );
});

test('denied горим нь БҮГДИЙГ хасна', () => {
  const denied: Vw = { mode: 'denied', role: 'worker', userId: 8, projectIds: [], orgId: null };
  assert.equal(
    evidenceDropReason(ev({ classification: 'public', visibilityScope: 'public' }), denied),
    'mode_denied',
  );
});

/* ================================================================== */
/*  4. Role ба төслийн хамрах хүрээ                                    */
/* ================================================================== */

test('allowedRoles тавигдсан бол таарахгүй role ХАСАГДАНА', () => {
  const e = ev({ allowedRoles: ['admin', 'senior'] });
  assert.equal(evidenceDropReason(e, ENGINEER), 'role_not_allowed');
  assert.equal(evidenceDropReason(e, ADMIN), null);
});

test('ажилтан нь гишүүн БИШ төслийн мөрийг авахгүй, админ авна', () => {
  const e = ev({ visibilityScope: 'project', projectId: 99 });
  assert.equal(evidenceDropReason(e, ENGINEER), 'project_out_of_scope');
  assert.equal(evidenceDropReason(e, ADMIN), null);
});

test('owner хамрах хүрээ нь ЗӨВХӨН эзэнд', () => {
  const mine = ev({ visibilityScope: 'owner', ownerUserId: 5 });
  const other = ev({ visibilityScope: 'owner', ownerUserId: 6 });
  assert.equal(evidenceDropReason(mine, ENGINEER), null);
  assert.equal(evidenceDropReason(other, ENGINEER), 'not_owner');
  // Админ ч бусдын хувийн санамжийг АВАХГҮЙ.
  assert.equal(evidenceDropReason(other, ADMIN), 'not_owner');
});

/* ================================================================== */
/*  5. filterEvidence — шалтгаантай хасалт                             */
/* ================================================================== */

test('filterEvidence нь хассан мөрийн ШАЛТГААНЫГ буцаана', () => {
  const items = [
    ev({ id: 'ok', classification: 'public', visibilityScope: 'public' }),
    ev({ id: 'secret', classification: 'confidential' }),
  ];
  const out = filterEvidence(items, CLIENT);
  assert.deepEqual(
    out.kept.map((e) => e.id),
    ['ok'],
  );
  assert.deepEqual(out.dropped, [{ id: 'secret', reason: 'classification_too_high' }]);
});

test('захиалагчийн хувьд нууц мөр prompt руу ОГТ хүрэхгүй', () => {
  const items = [
    ev({ id: 'income', classification: 'confidential', text: 'Компанийн 2026 оны орлого 4.2 тэрбум' }),
    ev({ id: 'contract', classification: 'restricted', text: 'Гэрээний нууц нөхцөл' }),
    ev({ id: 'brochure', classification: 'public', visibilityScope: 'public', text: 'Бидний тухай' }),
  ];
  const out = filterEvidence(items, CLIENT);
  const joined = out.kept.map((e) => e.text).join(' ');
  assert.equal(out.kept.length, 1);
  assert.equal(joined.includes('орлого'), false);
  assert.equal(joined.includes('Гэрээний'), false);
});

/* ================================================================== */
/*  6. Төсөв                                                           */
/* ================================================================== */

test('budgetEvidence нь оноогоор эрэмбэлж, төсөвт багтаана', () => {
  const items = [
    ev({ id: 'lo', text: 'x'.repeat(100), score: 0.1 }),
    ev({ id: 'hi', text: 'y'.repeat(100), score: 0.9 }),
  ];
  const out = budgetEvidence(items, 200);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.id, 'hi');
});

/**
 * ⚠️ ДАВХАРДСАН НОТОЛГОО НЬ ЗАГВАРЫГ ДАВТАЛТ РУУ ТҮЛХДЭГ (2026-09-09).
 *    Ижил догол мөр prompt-д хоёр удаа орох нь «энэ хэллэгийг давт»
 *    гэсэн дохио болно.  Хоёр хөл (локал нормын сан + D1) ижил заалтыг
 *    ӨӨР id-тайгаар буцаадаг тул id-гаар шүүх нь хангалтгүй.
 */
test('budgetEvidence нь ижил ТЕКСТИЙГ давхардуулахгүй (өөр id ч гэсэн)', () => {
  const text = 'Захиалагч нь зөвшөөрөл авах үүрэгтэй. '.repeat(3);
  const items = [
    ev({ id: 'local:UBB:clause:2.5', text, score: 0.9 }),
    ev({ id: 'd1-chunk-77', text, score: 0.8 }),
    ev({ id: 'other', text: 'Огт өөр агуулга.', score: 0.7 }),
  ];
  const out = budgetEvidence(items, 10_000);
  assert.equal(out.length, 2, `давхардал үлдэв: ${out.map((o) => o.id).join(', ')}`);
  assert.equal(out[0]!.id, 'local:UBB:clause:2.5', 'өндөр оноотой хувилбар үлдэх ёстой');
});

test('budgetEvidence нь ижил id-г хоёр удаа авахгүй', () => {
  const items = [ev({ id: 'a', text: 'нэг', score: 1 }), ev({ id: 'a', text: 'хоёр', score: 2 })];
  assert.equal(budgetEvidence(items, 10_000).length, 1);
});

test('budgetEvidence нь ЗАЙН зөрүүтэй ижил текстийг давхардал гэж үзнэ', () => {
  const items = [
    // ⚠️ Мөр таслалт, давхар зайг ЗОРИУД оруулав — PDF-ээс гаргаж авсан
    //    текст яг ийм хэлбэртэй ирдэг тул хэвийжүүлэлт ажиллах ёстой.
    ev({ id: 'x', text: `Заалт  2.5:${String.fromCharCode(10)}  зөвшөөрөл  авна.`, score: 1 }),
    ev({ id: 'y', text: 'Заалт 2.5: зөвшөөрөл авна.', score: 0.5 }),
  ];
  assert.equal(budgetEvidence(items, 10_000).length, 1);
});

test('budgetEvidence нь ӨӨР текстийг хадгална (хэт түрэмгий шүүхгүй)', () => {
  const items = [
    ev({ id: 'a', text: 'Захиалагчийн үүрэг: зөвшөөрөл авах.', score: 1 }),
    ev({ id: 'b', text: 'Гүйцэтгэгчийн үүрэг: норм дагах.', score: 0.9 }),
    ev({ id: 'c', text: 'Хянагчийн үүрэг: акт үйлдэх.', score: 0.8 }),
  ];
  assert.equal(budgetEvidence(items, 10_000).length, 3);
});

test('budgetEvidence нь төсөв хүрэлцвэл БҮГДИЙГ авна', () => {
  const items = [ev({ id: 'a', text: 'aa', score: 1 }), ev({ id: 'b', text: 'bb', score: 2 })];
  assert.equal(budgetEvidence(items, 10_000).length, 2);
});
