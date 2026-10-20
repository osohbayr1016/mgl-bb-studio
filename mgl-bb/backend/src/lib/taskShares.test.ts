/**
 * `lib/taskShares.ts` — `creditSplit` цэвэр функцийн тест (migration 0322).
 * Файл нь D1 төрлөөс өөр импортгүй тул `registerHooks` шаардлагагүй.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creditSplit } from './taskShares.ts';

const sum = (xs: Array<{ fraction: number }>) => xs.reduce((s, x) => s + x.fraction, 0);

test('мөргүй бол илгээгч 100%', () => {
  assert.deepEqual(creditSplit([], 7), [{ user_id: 7, fraction: 1 }]);
});

test('мөргүй, fallback ч байхгүй бол хоосон (baseline task, assigned_to null)', () => {
  assert.deepEqual(creditSplit([], null), []);
});

test('80 / 20 — илгээгч хэн байснаас үл хамааран', () => {
  const split = creditSplit(
    [
      { user_id: 1, share_percent: 80 },
      { user_id: 2, share_percent: 20 },
    ],
    2,
  );
  assert.deepEqual(split, [
    { user_id: 1, fraction: 0.8 },
    { user_id: 2, fraction: 0.2 },
  ]);
  assert.equal(sum(split), 1);
});

test('нийлбэр 100 биш бол нормчилно (unclaim-аар нэг мөр устсан үед)', () => {
  const split = creditSplit(
    [
      { user_id: 1, share_percent: 60 },
      { user_id: 2, share_percent: 20 },
    ],
    1,
  );
  assert.equal(split[0]!.fraction, 0.75);
  assert.equal(split[1]!.fraction, 0.25);
});

test('0%-тэй мөр оноо авахгүй, тоололд ч орохгүй', () => {
  const split = creditSplit(
    [
      { user_id: 1, share_percent: 100 },
      { user_id: 2, share_percent: 0 },
    ],
    2,
  );
  assert.deepEqual(split, [{ user_id: 1, fraction: 1 }]);
});

test('бүх мөр 0 бол fallback руу буцна', () => {
  assert.deepEqual(creditSplit([{ user_id: 1, share_percent: 0 }], 9), [
    { user_id: 9, fraction: 1 },
  ]);
});

test('гурван хүн тэнцүү', () => {
  const split = creditSplit(
    [1, 2, 3].map((id) => ({ user_id: id, share_percent: 33.33 })),
    1,
  );
  assert.equal(split.length, 3);
  assert.ok(Math.abs(sum(split) - 1) < 1e-9);
});

// ---------------------------------------------------------------------------
// shareEditPolicy / validateShareList (2026-09-18, self_joined 0326)
// ---------------------------------------------------------------------------
import { shareEditPolicy, validateShareList } from './taskShares.ts';

const S = (...ids: number[]) => new Set(ids);
const staff = { role: 'engineer', canSelfClaim: true };

test('policy: эзэн — хувь засна, хүн нэмнэ, нэгдэх шаардлагагүй', () => {
  const p = shareEditPolicy({ ...staff, userId: 1, owners: S(1), members: S(1, 2) });
  assert.deepEqual(p, {
    is_manager: false,
    is_owner: true,
    is_member: true,
    can_edit: true,
    can_add_others: true,
    can_join: false,
  });
});

test('policy: өөрөө нэгдсэн хамтрагч — хувь засна, хүн НЭМЭХГҮЙ', () => {
  const p = shareEditPolicy({ ...staff, userId: 2, owners: S(1), members: S(1, 2) });
  assert.equal(p.is_owner, false);
  assert.equal(p.is_member, true);
  assert.equal(p.can_edit, true);
  assert.equal(p.can_add_others, false);
  assert.equal(p.can_join, false);
});

test('policy: оролцогч биш ажилтан — зөвхөн өөрийгөө нэмнэ', () => {
  const p = shareEditPolicy({ ...staff, userId: 3, owners: S(1), members: S(1, 2) });
  assert.equal(p.can_edit, false);
  assert.equal(p.can_add_others, false);
  assert.equal(p.can_join, true);
});

test('policy: эзэнгүй таск дээр ч нэгдэж болно (= claim)', () => {
  const p = shareEditPolicy({ ...staff, userId: 3, owners: S(), members: S() });
  assert.equal(p.can_join, true);
  assert.equal(p.can_edit, false);
});

test('policy: role нь claim хийх эрхгүй бол нэгдэхгүй (энгийн admin)', () => {
  const p = shareEditPolicy({ role: 'admin', canSelfClaim: false, userId: 9, owners: S(1), members: S(1) });
  assert.equal(p.is_manager, true);
  assert.equal(p.can_edit, true);
  assert.equal(p.can_add_others, true);
  assert.equal(p.can_join, false);
});

test('validate: manager юу ч хийж болно (эзнийг ч хасна)', () => {
  const p = shareEditPolicy({ role: 'senior', canSelfClaim: true, userId: 9, owners: S(1), members: S(1, 2) });
  assert.equal(validateShareList(p, S(1), S(1, 2), S(2)), null);
  assert.equal(validateShareList(p, S(1), S(1, 2), S()), null);
});

test('validate: эзэн хамтрагч нэмж/хасна, өөрийгөө хасахгүй, хуваалтыг арилгаж болно', () => {
  const p = shareEditPolicy({ ...staff, userId: 1, owners: S(1), members: S(1, 2) });
  assert.equal(validateShareList(p, S(1), S(1, 2), S(1, 2, 3)), null);
  assert.equal(validateShareList(p, S(1), S(1, 2), S(1)), null);
  assert.equal(validateShareList(p, S(1), S(1, 2), S()), null);
  const err = validateShareList(p, S(1), S(1, 2), S(2));
  assert.equal(err?.error, 'owner must stay in the list');
  assert.equal(err?.owner_id, 1);
});

test('validate: өөрөө нэгдсэн хамтрагч — жагсаалт ЯГ одоогийн оролцогчид', () => {
  const p = shareEditPolicy({ ...staff, userId: 2, owners: S(1), members: S(1, 2) });
  assert.equal(validateShareList(p, S(1), S(1, 2), S(1, 2)), null);
  assert.equal(validateShareList(p, S(1), S(1, 2), S(1, 2, 3))?.error, 'members only');
  assert.equal(validateShareList(p, S(1), S(1, 2), S(2))?.error, 'members only');
  assert.equal(validateShareList(p, S(1), S(1, 2), S())?.error, 'members only');
});

test('validate: хуваалт байхад нэгдсэн гурав дахь хүн өөрийгөө хуваалтад оруулж чадна', () => {
  // members = assignees ∪ shares = {1,2,3}; share rows зөвхөн {1,2} байсан ч
  // 3 нь member тул {1,2,3} жагсаалт «ЯГ оролцогчид» шалгалтыг давна.
  const p = shareEditPolicy({ ...staff, userId: 3, owners: S(1), members: S(1, 2, 3) });
  assert.equal(p.can_edit, true);
  assert.equal(validateShareList(p, S(1), S(1, 2, 3), S(1, 2, 3)), null);
});

test('validate: оролцогч биш хүн хадгалж чадахгүй', () => {
  const p = shareEditPolicy({ ...staff, userId: 5, owners: S(1), members: S(1, 2) });
  assert.equal(validateShareList(p, S(1), S(1, 2), S(1, 2))?.error, 'Forbidden');
});

// ---------------------------------------------------------------------------
// autoJoinSplit — нэгдэх үеийн автомат хуваалт (хийгдсэн → эзэд, үлдсэн → шинэ)
// ---------------------------------------------------------------------------
import { autoJoinSplit } from './taskShares.ts';

const total = (rows: Array<{ share_percent: number }>) =>
  Math.round(rows.reduce((s, r) => s + r.share_percent, 0) * 100) / 100;

test('auto: 80% хийгдсэн, нэг эзэн → 80 / 20', () => {
  assert.deepEqual(autoJoinSplit(80, [{ user_id: 1 }], 2), [
    { user_id: 1, share_percent: 80 },
    { user_id: 2, share_percent: 20 },
  ]);
});

test('auto: 33.33% → 33.33 / 66.67, нийлбэр яг 100', () => {
  const rows = autoJoinSplit(33.33, [{ user_id: 1 }], 2)!;
  assert.deepEqual(rows, [
    { user_id: 1, share_percent: 33.33 },
    { user_id: 2, share_percent: 66.67 },
  ]);
  assert.equal(total(rows), 100);
});

test('auto: одоогийн хуваалт 60/40, 50% хийгдсэн → 30 / 20 / 50', () => {
  const rows = autoJoinSplit(
    50,
    [
      { user_id: 1, share_percent: 60 },
      { user_id: 3, share_percent: 40 },
    ],
    2,
  );
  assert.deepEqual(rows, [
    { user_id: 1, share_percent: 30 },
    { user_id: 3, share_percent: 20 },
    { user_id: 2, share_percent: 50 },
  ]);
});

test('auto: хувьгүй хоёр эзэн, 33.33% → тэнцүү, үлдэгдэл том мөрөнд, нийлбэр 100', () => {
  const rows = autoJoinSplit(33.33, [{ user_id: 1 }, { user_id: 3 }], 2)!;
  assert.equal(total(rows), 100);
  assert.equal(rows.find((r) => r.user_id === 2)!.share_percent, 66.67);
  const owners = rows.filter((r) => r.user_id !== 2).map((r) => r.share_percent);
  assert.equal(Math.round((owners[0]! + owners[1]!) * 100) / 100, 33.33);
});

test('auto: хуваалтад байхгүй (0%) гишүүн 0 хэвээр, шинэ хүн үлдсэнийг авна', () => {
  const rows = autoJoinSplit(
    75,
    [
      { user_id: 1, share_percent: 100 },
      { user_id: 3, share_percent: 0 },
    ],
    2,
  );
  assert.deepEqual(rows, [
    { user_id: 1, share_percent: 75 },
    { user_id: 3, share_percent: 0 },
    { user_id: 2, share_percent: 25 },
  ]);
});

test('auto: 0% болон 100% -д хуваалт ҮГҮЙ (null)', () => {
  assert.equal(autoJoinSplit(0, [{ user_id: 1 }], 2), null);
  assert.equal(autoJoinSplit(100, [{ user_id: 1 }], 2), null);
  assert.equal(autoJoinSplit(Number.NaN, [{ user_id: 1 }], 2), null);
});

test('auto: гишүүнгүй (эзэнгүй = claim) бол null; шинэ хүн өөрөө жагсаалтад байвал хасагдана', () => {
  assert.equal(autoJoinSplit(40, [], 2), null);
  assert.deepEqual(autoJoinSplit(40, [{ user_id: 2 }, { user_id: 1 }], 2), [
    { user_id: 1, share_percent: 40 },
    { user_id: 2, share_percent: 60 },
  ]);
});
