// Revit-ийн өөрчлөлтийн мэдэгдэл — цэвэр дүрмүүд (lib/revitChangeNotices.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanRevitUsername,
  collectConflictUsernames,
  computeRecipients,
  mergeReasons,
  mergeResolution,
  noticeTitle,
  normRevitUsername,
  reasonsForUsername,
  removeUnresolved,
  sanitizeNoticeBody,
  isStaffRole,
  seesAllNotices,
} from './revitChangeNotices.ts';
import type { ConflictItem } from './revitChangeNotices.ts';

const base = {
  client_uid: '3f2a9c1e-0000-4000-8000-000000000001',
  doc_title: 'MGL-251006_EVERGREEN_AR.rvt',
  moved: { label: 'Хана · 200 · #1001', category: 'Walls', ids: [1001], unique_ids: ['u-1001'] },
  offset_mm: [500, 0, 0],
  distance_mm: 500,
  verdict: 'MoveWithReview',
  headline: 'Хана 500 мм зөөгдөнө — 2 мөргөлдөөн',
  moved_at: '2026-10-06T09:15:00Z',
};

test('normRevitUsername: trim + lower, хоосон / урт → null', () => {
  assert.equal(normRevitUsername('  ZYA '), 'zya');
  assert.equal(normRevitUsername('anandoctane4ZDUG2'), 'anandoctane4zdug2');
  assert.equal(normRevitUsername(''), null);
  assert.equal(normRevitUsername('   '), null);
  assert.equal(normRevitUsername(42), null);
  assert.equal(normRevitUsername('x'.repeat(129)), null);
  assert.deepEqual(cleanRevitUsername(' Bat '), { display: 'Bat', norm: 'bat' });
});

test('roles: staff ба «бүгд» харах эрх', () => {
  assert.ok(isStaffRole('architect'));
  assert.ok(!isStaffRole('worker'));
  assert.ok(!isStaffRole('client'));
  assert.ok(seesAllNotices('senior'));
  assert.ok(!seesAllNotices('engineer'));
});

test('sanitizeNoticeBody: заавал талбар, хязгаар, ариутгал', () => {
  const ok = sanitizeNoticeBody({
    ...base,
    conflicts: [
      { key: 'h:1', element_id: 1, label: 'Багана', confirmed: true, creator: ' ZYA ', evil: '<script>' },
      { key: 'h:1', element_id: 1, label: 'давхар' },
      { key: '', element_id: 2 },
      { key: 'l:2:9', element_id: 9 },
    ],
    issues: [{ mark: '!', text: 'Өрөө 101 хуваагдана' }, { mark: 'x' }],
    manual_user_ids: [4, '5', 4, -1, 'abc'],
    note: 'n'.repeat(3000),
  });
  assert.ok(ok.ok);
  if (!ok.ok) return;
  assert.equal(ok.value.conflicts.length, 2, 'давхар key ба key-гүй хасагдана');
  assert.equal(ok.value.conflicts[0]?.creator, 'ZYA');
  assert.equal((ok.value.conflicts[0] as unknown as Record<string, unknown>).evil, undefined);
  assert.equal(ok.value.conflicts[1]?.label, '#9');
  assert.equal(ok.value.conflicts[1]?.confirmed, false);
  assert.equal(ok.value.issues.length, 1);
  assert.deepEqual(ok.value.manual_user_ids, [4, 5]);
  assert.equal(ok.value.note?.length, 2000);

  assert.equal(sanitizeNoticeBody({ ...base, client_uid: '' }).ok, false);
  assert.equal(sanitizeNoticeBody({ ...base, offset_mm: [1, 2] }).ok, false);
  assert.equal(sanitizeNoticeBody({ ...base, moved_at: 'yesterday' }).ok, false);
  assert.equal(sanitizeNoticeBody({ ...base, moved: { ids: [] } }).ok, false);
  assert.equal(sanitizeNoticeBody({ ...base, conflicts: new Array(201).fill({ key: 'k', element_id: 1 }) }).ok, false);
  assert.equal(sanitizeNoticeBody({ ...base, manual_user_ids: new Array(31).fill(1) }).ok, false);
  assert.equal(sanitizeNoticeBody(null).ok, false);
});

const conflicts: ConflictItem[] = [
  { key: 'h:1', element_id: 1, label: 'Багана', confirmed: true, creator: 'ZYA', last_changed_by: 'bat' },
  { key: 'h:2', element_id: 2, label: 'Хана', confirmed: false, creator: 'zya', owner: 'Dorj' },
  { key: 'l:2:3', element_id: 3, label: 'Шат', confirmed: true, last_changed_by: 'ghost' },
];

test('collectConflictUsernames: norm-оор бүлэглэж шалтгаан + key цуглуулна', () => {
  const m = collectConflictUsernames(conflicts);
  assert.deepEqual([...m.keys()], ['zya', 'bat', 'dorj', 'ghost']);
  assert.deepEqual(m.get('zya'), { norm: 'zya', display: 'ZYA', reasons: ['creator'], keys: ['h:1', 'h:2'] });
  assert.deepEqual(m.get('dorj')?.reasons, ['owner']);
  assert.deepEqual(reasonsForUsername(conflicts, 'bat'), { reasons: ['last_changed'], keys: ['h:1'] });
  assert.deepEqual(reasonsForUsername(conflicts, 'none'), { reasons: [], keys: [] });
});

test('mergeResolution: alias түрүүлнэ (сүүлд харагдсан эхэнд), үгүй бол username', () => {
  const u = (id: number) => ({ id, full_name: `U${id}`, position: null, team_name: null });
  const res = mergeResolution(
    ['zya', 'bat', 'ghost'],
    [
      { ...u(2), norm: 'zya', last_seen_at: '2026-10-01 00:00:00' },
      { ...u(3), norm: 'zya', last_seen_at: '2026-10-05 00:00:00' },
    ],
    [
      { ...u(9), norm: 'zya' },
      { ...u(4), norm: 'bat' },
    ],
  );
  assert.deepEqual(res.get('zya')?.map((x) => x.id), [3, 2], 'alias байхад username fallback хэрэглэгдэхгүй');
  assert.deepEqual(res.get('bat')?.map((x) => x.id), [4]);
  assert.deepEqual(res.get('ghost'), []);
});

test('computeRecipients: creators − excluded − sender + manual; холбогдоогүй нэрс', () => {
  const usernames = collectConflictUsernames(conflicts);
  const resolved = new Map<string, { id: number }[]>([
    ['zya', [{ id: 2 }]],
    ['bat', [{ id: 1 }]], // илгээгч
    ['dorj', [{ id: 5 }]],
    ['ghost', []],
  ]);
  const { recipients, unresolved } = computeRecipients({
    usernames,
    resolved,
    manualUserIds: [6, 1, 5],
    excludedUserIds: [5],
    senderId: 1,
  });
  assert.deepEqual(unresolved, ['ghost']);
  const byId = new Map(recipients.map((r) => [r.user_id, r]));
  assert.deepEqual([...byId.keys()].sort(), [2, 5, 6]);
  assert.deepEqual(byId.get(2), { user_id: 2, reasons: ['creator'], element_keys: ['h:1', 'h:2'] });
  assert.deepEqual(byId.get(5)?.reasons, ['manual'], 'excluded нь manual-аар буцаж нэмэгдэнэ (owner шалтгаангүй)');
  assert.deepEqual(byId.get(6), { user_id: 6, reasons: ['manual'], element_keys: [] });
  assert.ok(!byId.has(1), 'илгээгч хэзээ ч хүлээн авагч биш');
});

test('туслахууд: unresolved хасах, шалтгаан нэгтгэх, гарчиг', () => {
  assert.deepEqual(removeUnresolved(['ZYA', 'Ghost', 'zya '], 'zya'), ['Ghost']);
  assert.deepEqual(mergeReasons(['manual'], ['creator', 'bogus']), ['creator', 'manual']);
  assert.match(noticeTitle('Хана', ['manual']), /танд мэдэгдэл$/);
  assert.match(noticeTitle('Хана', ['creator', 'manual']), /огтлолцоно$/);
});
