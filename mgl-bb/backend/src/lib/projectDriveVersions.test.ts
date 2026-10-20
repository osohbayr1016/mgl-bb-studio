/**
 * `lib/projectDriveVersions.ts` — хувилбарын түүхийн ЦЭВЭР хэсэг: өөрчлөлтийн
 * ангилал, хуулбарын төлөвлөгөө, тогтсон эсэх, API хэлбэр.  Drive/R2/D1
 * хөндөгдөхгүй (тэр нь `projectDriveSync.ts`, `node --test`-д ачаалагдахгүй).
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

const { classifyChange, isSettled, snapshotFileName, snapshotPlan, versionR2Key, versionView } =
  await import('./projectDriveVersions.ts');

type Row = Parameters<typeof versionView>[0];

function row(over: Partial<Row> = {}): Row {
  return {
    id: 1,
    root_folder_id: 'ROOT000000001',
    file_id: 'FILE000000001',
    file_name: 'Тайлан.pdf',
    mime_type: 'application/pdf',
    parent_id: 'ROOT000000001',
    size: 100,
    md5: 'aaa',
    drive_version: '5',
    drive_modified_at: '2026-09-15T01:00:00.000Z',
    modified_by_name: 'BA баг',
    modified_by_email: 'ba@mglenc.com',
    change_kind: 'created',
    r2_key: 'drive-versions/ROOT000000001/FILE000000001/1-abc',
    snapshot_mime: 'application/pdf',
    restored_from_version_id: null,
    restored_by_user_id: null,
    created_at: '2026-09-15 01:03:00',
    ...over,
  };
}

/* ---------------- snapshotPlan ---------------- */

test('snapshotPlan: энгийн файл → эх байт, буцаагдана', () => {
  const p = snapshotPlan('application/pdf');
  assert.equal(p.kind, 'download');
  assert.equal(p.mime, 'application/pdf');
  assert.equal(p.restorable, true);
});

test('snapshotPlan: Docs/Sheets/Slides → Office экспорт, буцаагдана; Drawing → PNG, буцаагдахгүй', () => {
  assert.deepEqual(snapshotPlan('application/vnd.google-apps.document'), {
    kind: 'export',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: '.docx',
    restorable: true,
  });
  assert.equal(snapshotPlan('application/vnd.google-apps.spreadsheet').ext, '.xlsx');
  assert.equal(snapshotPlan('application/vnd.google-apps.presentation').ext, '.pptx');
  const d = snapshotPlan('application/vnd.google-apps.drawing');
  assert.equal(d.kind, 'export');
  assert.equal(d.restorable, false);
});

test('snapshotPlan: хавтас, товчлол, Forms → none', () => {
  assert.equal(snapshotPlan('application/vnd.google-apps.folder').kind, 'none');
  assert.equal(snapshotPlan('application/vnd.google-apps.shortcut').kind, 'none');
  assert.equal(snapshotPlan('application/vnd.google-apps.form').kind, 'none');
});

test('snapshotFileName: экспортлогдсон Google баримт өргөтгөлөө авна, бусад нь эх нэрээ', () => {
  assert.equal(snapshotFileName({ file_name: 'Тайлан', mime_type: 'application/vnd.google-apps.document' }), 'Тайлан.docx');
  assert.equal(snapshotFileName({ file_name: 'Тайлан.docx', mime_type: 'application/vnd.google-apps.document' }), 'Тайлан.docx');
  assert.equal(snapshotFileName({ file_name: 'план.dwg', mime_type: 'application/acad' }), 'план.dwg');
});

/* ---------------- classifyChange ---------------- */

test('classifyChange: анх илэрсэн → created (агуулга авна); хогийн саванд анх илэрсэн → юу ч биш', () => {
  assert.deepEqual(classifyChange(null, { id: 'F', name: 'a', mimeType: 'application/pdf', md5Checksum: 'x' }), {
    kind: 'created',
    contentChanged: true,
  });
  assert.equal(classifyChange(null, { id: 'F', name: 'a', mimeType: 'application/pdf', trashed: true }), null);
});

test('classifyChange: md5 өөрчлөгдвөл modified; ижил бол нэр → renamed; эцэг → moved; юу ч үгүй → null', () => {
  const prev = row();
  const base = { id: prev.file_id, name: prev.file_name, mimeType: prev.mime_type, parents: [prev.parent_id!] };
  assert.deepEqual(classifyChange(prev, { ...base, md5Checksum: 'bbb' }), { kind: 'modified', contentChanged: true });
  assert.deepEqual(classifyChange(prev, { ...base, md5Checksum: 'aaa', name: 'Шинэ нэр.pdf' }), {
    kind: 'renamed',
    contentChanged: false,
  });
  assert.deepEqual(classifyChange(prev, { ...base, md5Checksum: 'aaa', parents: ['OTHER00000001'] }), {
    kind: 'moved',
    contentChanged: false,
  });
  assert.equal(classifyChange(prev, { ...base, md5Checksum: 'aaa' }), null);
});

test('classifyChange: агуулга > нэр > байрлал давуу эрэмбэ', () => {
  const prev = row();
  const cls = classifyChange(prev, {
    id: prev.file_id,
    name: 'өөр',
    mimeType: prev.mime_type,
    parents: ['OTHER00000001'],
    md5Checksum: 'zzz',
  });
  assert.equal(cls?.kind, 'modified');
});

test('classifyChange: Google баримт (md5-гүй) → modifiedTime-аар', () => {
  const prev = row({ mime_type: 'application/vnd.google-apps.document', md5: null });
  const base = { id: prev.file_id, name: prev.file_name, mimeType: prev.mime_type, parents: [prev.parent_id!] };
  assert.equal(classifyChange(prev, { ...base, modifiedTime: prev.drive_modified_at! }), null);
  assert.equal(classifyChange(prev, { ...base, modifiedTime: '2026-09-15T02:00:00.000Z' })?.kind, 'modified');
});

test('classifyChange: хогийн сав руу / буцах; устсан гэж бүртгэсэн нь дахин гарвал created', () => {
  const prev = row();
  const base = { id: prev.file_id, name: prev.file_name, mimeType: prev.mime_type, md5Checksum: 'aaa' };
  assert.equal(classifyChange(prev, { ...base, trashed: true })?.kind, 'trashed');
  assert.equal(classifyChange(row({ change_kind: 'trashed' }), { ...base, trashed: true }), null);
  assert.equal(classifyChange(row({ change_kind: 'trashed' }), { ...base })?.kind, 'untrashed');
  assert.deepEqual(classifyChange(row({ change_kind: 'deleted', r2_key: null }), { ...base }), {
    kind: 'created',
    contentChanged: true,
  });
});

test('classifyChange: restored мөрийн дараа ижил md5 → давхар мөр үүсгэхгүй', () => {
  const prev = row({ change_kind: 'restored', md5: 'rrr', restored_from_version_id: 1, restored_by_user_id: 2 });
  assert.equal(
    classifyChange(prev, { id: prev.file_id, name: prev.file_name, mimeType: prev.mime_type, md5Checksum: 'rrr' }),
    null,
  );
});

/* ---------------- isSettled ---------------- */

test('isSettled: сүүлийн засвараас хойш quietMs өнгөрсөн байх ёстой; огноогүй → тогтсон', () => {
  const now = Date.parse('2026-09-15T10:00:00Z');
  assert.equal(isSettled('2026-09-15T09:58:30Z', now, 3 * 60_000), false);
  assert.equal(isSettled('2026-09-15T09:56:00Z', now, 3 * 60_000), true);
  assert.equal(isSettled(undefined, now, 3 * 60_000), true);
  assert.equal(isSettled('not-a-date', now, 3 * 60_000), true);
});

/* ---------------- versionR2Key / versionView ---------------- */

test('versionR2Key: drive-versions/<root>/<file>/… угтвар, дуудлага бүрд өөр', () => {
  const a = versionR2Key('ROOT000000001', 'FILE000000001', 1000);
  const b = versionR2Key('ROOT000000001', 'FILE000000001', 1000);
  assert.ok(a.startsWith('drive-versions/ROOT000000001/FILE000000001/1000-'));
  assert.notEqual(a, b);
});

test('versionView: has_snapshot/restorable, засварлагч, сэргээгч', () => {
  const v = versionView({ ...row(), restored_by_name: null });
  assert.equal(v.has_snapshot, true);
  assert.equal(v.restorable, true);
  assert.deepEqual(v.modified_by, { name: 'BA баг', email: 'ba@mglenc.com' });
  assert.equal(v.restored_by, null);

  const deleted = versionView({ ...row({ change_kind: 'deleted', r2_key: null, snapshot_mime: null }), restored_by_name: null });
  assert.equal(deleted.has_snapshot, false);
  assert.equal(deleted.restorable, false);

  const anon = versionView({ ...row({ modified_by_name: null, modified_by_email: null }), restored_by_name: null });
  assert.equal(anon.modified_by, null);

  const drawing = versionView({
    ...row({ mime_type: 'application/vnd.google-apps.drawing', snapshot_mime: 'image/png' }),
    restored_by_name: null,
  });
  assert.equal(drawing.has_snapshot, true);
  assert.equal(drawing.restorable, false);

  const restored = versionView({
    ...row({ change_kind: 'restored', restored_from_version_id: 1, restored_by_user_id: 7 }),
    restored_by_name: 'А. Ананд',
  });
  assert.deepEqual(restored.restored_by, { id: 7, name: 'А. Ананд' });
});
