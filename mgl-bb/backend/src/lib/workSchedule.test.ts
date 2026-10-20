/**
 * `lib/workSchedule.ts` — ГУРВАН ээлж + «хэзээнээс хүчинтэй» логик.
 *
 * ⚠️ `workSchedule.ts` нь өргөтгөлгүй харьцангуй import (`./time`,
 *    `./orgConfig`) агуулдаг тул `node --test` дор ШУУД import хийвэл унана
 *    (tsc нь ногоон хэвээр тул эвдрэл нь тестийг ажиллуулах хүртэл
 *    үл үзэгдэнэ).  `leaveWindow.test.ts` / `orgConfig.test.ts`-тэй ижил
 *    `registerHooks` resolver-ийг эхлээд суулгана.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const {
  SHIFTS,
  SCHEDULE_KEYS,
  isScheduleKey,
  shortShiftLabel,
  effectiveSchedule,
  selectedSchedule,
  latestAssignment,
  scheduleEffectiveFrom,
  scheduleOutlook,
} = await import('./workSchedule.ts');

/* Тохиргоогүй (MGL-ийн дефолт) орчин: standard 09–18, early 08–17,
 * mid 08:30–17:30, зун = 6,7,8 сар. */

test('гурван ээлж — дефолт утга ба дараалал', () => {
  assert.deepEqual([...SCHEDULE_KEYS], ['early', 'mid', 'standard']);
  assert.equal(SHIFTS.early.startMinutes, 8 * 60);
  assert.equal(SHIFTS.early.endMinutes, 17 * 60);
  assert.equal(SHIFTS.mid.startMinutes, 8 * 60 + 30);
  assert.equal(SHIFTS.mid.endMinutes, 17 * 60 + 30);
  assert.equal(SHIFTS.standard.startMinutes, 9 * 60);
  assert.equal(SHIFTS.standard.endMinutes, 18 * 60);
  // Гурвуулаа 9 цагийн зай = 8 цагийн ажил + 1 цагийн цай.  Тайлангийн
  // `EXPECTED_DAY_MINUTES = 480` энэ таамаглал дээр тогтдог.
  for (const k of SCHEDULE_KEYS) {
    assert.equal(SHIFTS[k].endMinutes - SHIFTS[k].startMinutes, 9 * 60, k);
  }
});

test('isScheduleKey нь танихгүй мөрийг таслана', () => {
  assert.equal(isScheduleKey('mid'), true);
  assert.equal(isScheduleKey('early'), true);
  assert.equal(isScheduleKey('standard'), true);
  assert.equal(isScheduleKey('banana'), false);
  assert.equal(isScheduleKey(null), false);
  assert.equal(isScheduleKey(undefined), false);
});

test('shortShiftLabel — хуучин "08-17"/"09-18" БАЙТ ЧУХАМ хэвээр', () => {
  // Тайлангийн багана ба XLSX экспорт хоёул эдгээр яг мөрийг хүлээдэг.
  assert.equal(shortShiftLabel(SHIFTS.early), '08-17');
  assert.equal(shortShiftLabel(SHIFTS.standard), '09-18');
  // Минуттай ээлж бол бүтэн хэлбэрээр.
  assert.equal(shortShiftLabel(SHIFTS.mid), '08:30-17:30');
});

test('зуны албадлага БҮХ сонголтоос дээгүүр (6–8 сар)', () => {
  for (const k of SCHEDULE_KEYS) {
    assert.equal(effectiveSchedule(null, '2026-06-01', [{ schedule: k, effective_from: '2026-01-01' }]), 'early');
    assert.equal(effectiveSchedule(null, '2026-07-15', [{ schedule: k, effective_from: '2026-01-01' }]), 'early');
    assert.equal(effectiveSchedule(null, '2026-08-31', [{ schedule: k, effective_from: '2026-01-01' }]), 'early');
  }
});

test('хуваарилалтгүй үед хуучин багана мөрдөгдөнө (хойшоо нийцтэй)', () => {
  assert.equal(effectiveSchedule('standard', '2026-09-01'), 'standard');
  assert.equal(effectiveSchedule('early', '2026-09-01'), 'early');
  assert.equal(effectiveSchedule(null, '2026-09-01'), 'standard');
  // Хог утга DB-д үлдсэн байсан ч 'standard' руу уналгүй сүйрэхгүй.
  assert.equal(effectiveSchedule('banana' as never, '2026-09-01'), 'standard');
});

test('хуваарилалт нь эффектив огнооноосоо ӨМНӨ үйлчлэхгүй', () => {
  const a = [{ schedule: 'mid' as const, effective_from: '2026-09-01' }];
  // 8-р сар — зун тул ямар ч байсан early.
  assert.equal(effectiveSchedule('standard', '2026-08-26', a), 'early');
  // Зун дууссан ч эффектив огноо болоогүй бол хуучин багана.
  assert.equal(effectiveSchedule('standard', '2025-09-30', a), 'standard');
  // Яг тэр өдрөөс — ОРУУЛААД.
  assert.equal(effectiveSchedule('standard', '2026-09-01', a), 'mid');
  assert.equal(effectiveSchedule('standard', '2026-12-31', a), 'mid');
});

test('олон хуваарилалтаас тухайн өдөрт хамгийн СҮҮЛИЙНХ нь сонгогдоно', () => {
  const a = [
    { schedule: 'mid' as const, effective_from: '2026-09-01' },
    { schedule: 'standard' as const, effective_from: '2026-10-15' },
    { schedule: 'early' as const, effective_from: '2027-01-05' },
  ];
  assert.equal(effectiveSchedule(null, '2026-09-30', a), 'mid');
  assert.equal(effectiveSchedule(null, '2026-10-15', a), 'standard');
  assert.equal(effectiveSchedule(null, '2026-12-01', a), 'standard');
  assert.equal(effectiveSchedule(null, '2027-01-05', a), 'early');
  // Дараалал холилдсон ч ижил хариу — функц өөрөө эрэмбэлдэг.
  const shuffled = [a[2]!, a[0]!, a[1]!];
  assert.equal(effectiveSchedule(null, '2026-12-01', shuffled), 'standard');
});

test('selectedSchedule — зунаар дарагдсан ч СОНГОЛТоо буцаана', () => {
  const a = [{ schedule: 'mid' as const, effective_from: '2026-09-01' }];
  // Бодит ээлж нь зуны улмаас early, гэхдээ picker-т mid идэвхтэй байх ёстой.
  assert.equal(effectiveSchedule('standard', '2026-08-26', a), 'early');
  assert.equal(selectedSchedule('standard', a), 'mid');
  // Хуваарилалтгүй бол хуучин багана.
  assert.equal(selectedSchedule('standard', []), 'standard');
  assert.equal(selectedSchedule(null, null), 'standard');
});

test('latestAssignment — СҮҮЛИЙН шийдвэр (ирээдүйн огноо ч мөн), сонгоогүй бол null', () => {
  // Сонгоогүй хүн — админ жагсаалтад «сонгоогүй» гэж тэмдэглэгдэнэ.
  assert.equal(latestAssignment(undefined), null);
  assert.equal(latestAssignment(null), null);
  assert.equal(latestAssignment([]), null);

  // Огноо нь ИРЭЭДҮЙД байхад ч сүүлийнх нь буцна — `effectiveSchedule`-ийн
  // «өнөөдөрт хүчинтэй» логиктой АДИЛГҮЙ гэдгийг энэ тест барина.
  const a = [
    { schedule: 'standard' as const, effective_from: '2026-09-02' },
    { schedule: 'mid' as const, effective_from: '2027-01-05' },
  ];
  assert.deepEqual(latestAssignment(a), { schedule: 'mid', effective_from: '2027-01-05' });
  assert.equal(effectiveSchedule(null, '2026-09-10', a), 'standard');

  // Дараалал холилдсон ч ижил хариу.
  assert.deepEqual(latestAssignment([a[1]!, a[0]!]), {
    schedule: 'mid',
    effective_from: '2027-01-05',
  });

  // `selectedSchedule` нь яг үүн дээр тогтоно.
  assert.equal(selectedSchedule('early', a), 'mid');

  // `created_by` нь дамжин гардаг — `GET /api/users` түүгээр «ажилтан өөрөө
  // сонгосон уу, админ тохируулсан уу» гэдгийг ялгадаг (миграци 0199).
  const withAuthor = [
    { schedule: 'early' as const, effective_from: '2026-09-02', created_by: 7 },
    { schedule: 'mid' as const, effective_from: '2026-09-10', created_by: 1 },
  ];
  assert.equal(latestAssignment(withAuthor)?.created_by, 1);
  // Цэвэр функцууд түүнийг ОГТ уншдаггүй — ээлж нь өөрчлөгдөхгүй.
  assert.equal(selectedSchedule(null, withAuthor), 'mid');
  assert.equal(effectiveSchedule(null, '2026-09-05', withAuthor), 'early');
});

test('scheduleEffectiveFrom — зуны үед 9-р сарын 1 хүртэл хойшилно', () => {
  // Эзний шаардлага: 8-р сард сонговол 2026-09-01-нээс.
  assert.equal(scheduleEffectiveFrom('2026-08-26'), '2026-09-01');
  assert.equal(scheduleEffectiveFrom('2026-06-01'), '2026-09-01');
  assert.equal(scheduleEffectiveFrom('2026-08-31'), '2026-09-01');
  // 5-р сарын 31-нд сонговол маргааш нь зуны эхэн — мөн 9-р сар хүртэл.
  assert.equal(scheduleEffectiveFrom('2026-05-31'), '2026-09-01');
  // Зунаас гадуур — ЗҮГЭЭР Л МАРГААШ (өнөөдрийн хоцролтоо арилгах гарц хаалттай).
  assert.equal(scheduleEffectiveFrom('2026-09-01'), '2026-09-02');
  assert.equal(scheduleEffectiveFrom('2026-12-31'), '2027-01-01');
  assert.equal(scheduleEffectiveFrom('2027-05-30'), '2027-05-31');
});

test('scheduleOutlook — «маргааш ч 08:00, 09-01-нээс 08:30» сануулгын өгөгдөл', () => {
  const a = [{ schedule: 'mid' as const, effective_from: '2026-09-01' }];
  const o = scheduleOutlook('standard', '2026-08-26', a);
  assert.equal(o.effective, 'early'); // өнөөдөр (зун) — 08:00–17:00
  assert.equal(o.selected, 'mid'); // picker-т идэвхтэй
  assert.deepEqual(o.changesTo, { schedule: 'mid', date: '2026-09-01' });
});

test('scheduleOutlook — сонголт хийгээгүй ч зун дуусахад цаг өөрчлөгдөнө', () => {
  // 33 ажилтны `users.work_schedule` нь 'standard' — тэдэнд 9-р сарын 1-нд
  // ажил 09:00 болно.  Товч дараагүй ч сануулга харагдах ЁСТОЙ.
  const o = scheduleOutlook('standard', '2026-08-26', []);
  assert.equal(o.effective, 'early');
  assert.deepEqual(o.changesTo, { schedule: 'standard', date: '2026-09-01' });
});

test('scheduleOutlook — 08:00-ынхан зун дуусахад өөрчлөлтгүй', () => {
  const o = scheduleOutlook('early', '2026-08-26', []);
  assert.equal(o.effective, 'early');
  assert.equal(o.selected, 'early');
  assert.equal(o.changesTo, null); // жилийн турш 08:00 — сануулга шаардлагагүй
});

test('scheduleOutlook — ирэх зун дахин 08:00 болохыг УРЬДЧИЛЖ хэлнэ', () => {
  // «5.31 хүртэл энэ шинэчлэлт ажиллана, 6.1-нээс 8-5 болго» (эзэн, 2026-08-26).
  const a = [{ schedule: 'mid' as const, effective_from: '2026-09-01' }];
  const o = scheduleOutlook('standard', '2027-05-28', a);
  assert.equal(o.effective, 'mid');
  assert.deepEqual(o.changesTo, { schedule: 'early', date: '2027-06-01' });
});
