/**
 * `lib/clientDriveShares.ts`-ийн ЦЭВЭР дүрэм (харагдах эсэх, breadcrumb тайралт)
 * + `lib/clientInviteMailBody.ts` (урилгын имэйлийн бичвэр).  DB/Drive рүү
 * дуудлага хийдэг хэсэг энд ОРОЛЦОХГҮЙ.
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

const { visibleAncestor, trimPathToShare } = await import('./clientDriveShares.ts');
const { buildInviteMail } = await import('./clientInviteMailBody.ts');

const ROOT = { id: 'root-folder-id-000', name: 'MGL-251006 EVERGREEN' };
const ARCH = { id: 'arch-folder-id-000', name: 'Архитектур' };
const SUB = { id: 'sub-folder-id-0000', name: 'Хувилбар B' };
const FILE = { id: 'file-id-0000000000', name: 'AR-01.pdf' };
const PATH = [ROOT, ARCH, SUB, FILE];

const folder = (id: string) => ({ drive_item_id: id, item_kind: 'folder' as const, revoked_at: null });
const file = (id: string) => ({ drive_item_id: id, item_kind: 'file' as const, revoked_at: null });

test('visibleAncestor: нээлтгүй = -1 (өгөгдмөл хаалттай)', () => {
  assert.equal(visibleAncestor(PATH, []), -1);
  assert.equal(visibleAncestor([ROOT], []), -1);
});

test('visibleAncestor: нээсэн хавтасны ДЭД МОД харагдана — хамгийн дээд хавтасны индекс', () => {
  assert.equal(visibleAncestor(PATH, [folder(ARCH.id)]), 1);
  assert.equal(visibleAncestor(PATH, [folder(SUB.id)]), 2);
  // Хоёулаа нээгдсэн бол дээд нь — breadcrumb тэндээс эхэлнэ.
  assert.equal(visibleAncestor(PATH, [folder(SUB.id), folder(ARCH.id)]), 1);
  // Үндэс өөрөө нээгдвэл бүх зүйл.
  assert.equal(visibleAncestor(PATH, [folder(ROOT.id)]), 0);
});

test('visibleAncestor: нээсэн ФАЙЛ зөвхөн өөрийгөө харуулна', () => {
  assert.equal(visibleAncestor(PATH, [file(FILE.id)]), 3);
  // Файлын нээлт нь түүний хавтсыг нээхгүй.
  assert.equal(visibleAncestor([ROOT, ARCH, SUB], [file(FILE.id)]), -1);
  // Хавтасны id-г «файл» гэж нээсэн бол дэд мод нээгдэхгүй (төрөл чухал).
  assert.equal(visibleAncestor(PATH, [file(ARCH.id)]), -1);
});

test('visibleAncestor: хаасан (revoked) мөр тооцогдохгүй', () => {
  assert.equal(visibleAncestor(PATH, [{ ...folder(ARCH.id), revoked_at: '2026-09-18T00:00:00Z' }]), -1);
});

test('trimPathToShare: нээсэн хавтаснаас доош + виртуал үндэс; дээрх нэрс ил гарахгүй', () => {
  const trimmed = trimPathToShare(PATH, 1, 'Төсөл');
  assert.deepEqual(trimmed, [{ id: 'root', name: 'Төсөл' }, ARCH, SUB, FILE]);
  assert.equal(trimmed.some((n) => n.id === ROOT.id), false);
  assert.deepEqual(trimPathToShare(PATH, -1, 'Төсөл'), []);
  assert.deepEqual(trimPathToShare(PATH, 3, 'Төсөл'), [{ id: 'root', name: 'Төсөл' }, FILE]);
});

test('buildInviteMail: урилга — байгууллага, төсөл, холбоос, хугацаа', () => {
  const m = buildInviteMail({
    to: 'a@b.mn',
    full_name: 'Бат',
    kind: 'invite',
    url: 'https://erp.example/client/invite/abc',
    org_name: 'Эрдэнэ ХХК',
    project_name: 'MGL-251006 EVERGREEN',
    inviter_name: 'А.Ананд',
  });
  assert.match(m.subject, /EVERGREEN/);
  assert.match(m.text, /Эрдэнэ ХХК/);
  assert.match(m.text, /7 хоногийн/);
  assert.match(m.text, /https:\/\/erp\.example\/client\/invite\/abc/);
  assert.match(m.html, /href="https:\/\/erp\.example\/client\/invite\/abc"/);
  assert.match(m.text, /А\.Ананд/);
});

test('buildInviteMail: нууц үг сэргээх — 2 цаг, урилгын үг байхгүй; HTML escape', () => {
  const m = buildInviteMail({ to: 'a@b.mn', full_name: '<x>', kind: 'reset', url: 'https://e/r?t=1&u=2' });
  assert.match(m.subject, /нууц үг/);
  assert.match(m.text, /2 цагийн/);
  assert.doesNotMatch(m.text, /урьж байна/);
  assert.match(m.html, /&lt;x&gt;/);
  assert.match(m.html, /t=1&amp;u=2/);
});
