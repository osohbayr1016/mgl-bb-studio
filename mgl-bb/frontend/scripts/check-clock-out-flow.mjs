/**
 * «Гарсан бүртгэл»-ийн дүрмийн шалгалт.
 *
 *   node scripts/check-clock-out-flow.mjs        (frontend/ хавтаснаас)
 *
 * `src/features/attendance/clockOutFlow.ts` — Ирц хуудас, Хяналтын самбарын
 * widget, цэвэрлэгчийн хуудас гурвуулаа үүгээр шийднэ.  Анхны гэмтэл
 * (прод 2026-10-16, user 84): кэшийн хуучирсан `progress_logged_today`-оор
 * товч идэвхгүй болж, дарахад юу ч болоогүй тул ажилтан «гарлаа» гэж бодоод
 * явсан — маргааш нь ирэх бүртгэл түгжигдсэн.  Эзний шаардлага (2026-10-19):
 * гарах бүртгэл хийгдээгүй бол шалтгаан нь монголоор ТЭР агшинд харагдана;
 * сервер дээр гарсан бол (хариу алдагдсан ч) амжилт гэж тооцно.
 */
import assert from 'node:assert/strict';

const { clockOutPreflight, resolveClockOutError, hhmmOf } = await import(
  '../src/features/attendance/clockOutFlow.ts'
);

let n = 0;
const ok = (name, fn) => {
  fn();
  n++;
  console.log(`  ✓ ${name}`);
};

const staff = { exempt: false, pgpMissing: false, projectsUnavailable: false };
const working = (over = {}) => ({
  clocked_in: true,
  on_office_ip: true,
  require_office_ip: true,
  client_ip: '138.252.29.38',
  progress_logged_today: true,
  session: { clock_in: '2026-10-16T08:48:37+08:00', clock_out: null },
  ...over,
});
const kinds = (r) => (r.kind === 'blocked' ? r.blocks.map((b) => b.kind) : r.kind);

console.log('clockOutPreflight');
ok('бүх нөхцөл хангагдсан → popup нээнэ', () => {
  assert.equal(clockOutPreflight(working(), staff).kind, 'ready');
});
ok('төлвийг уншиж чадсангүй → «сервертэй холбогдсонгүй» (чимээгүй биш)', () => {
  assert.deepEqual(kinds(clockOutPreflight(null, staff)), ['offline']);
});
ok('явц бүртгээгүй (2026-10-16) → шалтгаан «progress»', () => {
  assert.deepEqual(kinds(clockOutPreflight(working({ progress_logged_today: false }), staff)), ['progress']);
});
ok('хэд хэдэн шалтгаан → БҮГДИЙГ нэг дор (сүлжээ, явц, PGP)', () => {
  const r = clockOutPreflight(
    working({ on_office_ip: false, progress_logged_today: false }),
    { ...staff, pgpMissing: true },
  );
  assert.deepEqual(kinds(r), ['network', 'progress', 'pgp']);
  assert.equal(r.blocks[0].ip, '138.252.29.38');
});
ok('IP шалгалт унтраалттай бол сүлжээ шалтгаан БИШ', () => {
  assert.equal(
    clockOutPreflight(working({ on_office_ip: false, require_office_ip: false }), staff).kind,
    'ready',
  );
});
ok('IP «unknown» бол IP-гүй мессеж', () => {
  const r = clockOutPreflight(working({ on_office_ip: false, client_ip: 'unknown' }), staff);
  assert.equal(r.blocks[0].ip, null);
});
ok('admin/онцгойлсон → явц, PGP, төсөл шаардахгүй; сүлжээг шаардана', () => {
  const ex = { exempt: true, pgpMissing: true, projectsUnavailable: true };
  assert.equal(clockOutPreflight(working({ progress_logged_today: false }), ex).kind, 'ready');
  assert.deepEqual(kinds(clockOutPreflight(working({ on_office_ip: false }), ex)), ['network']);
});
ok('төслийн жагсаалт ачаалагдсангүй → шалтгаан', () => {
  assert.deepEqual(
    kinds(clockOutPreflight(working(), { ...staff, projectsUnavailable: true })),
    ['projects_unavailable'],
  );
});
ok('аль хэдийн гарсан (өөр таб/төхөөрөмж) → алдаа БИШ, «гарсан» гэж хэлнэ', () => {
  const r = clockOutPreflight(
    working({ clocked_in: false, session: { clock_in: '2026-10-16T08:48:37+08:00', clock_out: '2026-10-16T18:06:58+08:00' } }),
    staff,
  );
  assert.equal(r.kind, 'already_out');
  assert.equal(r.clockOut, '2026-10-16T18:06:58+08:00');
});
ok('өнөөдөр ирсэн бүртгэл огт алга → «not_clocked_in»', () => {
  assert.deepEqual(kinds(clockOutPreflight(working({ clocked_in: false, session: null }), staff)), ['not_clocked_in']);
});

console.log('resolveClockOutError');
const apiErr = (status, code, message, payload = {}) => ({
  name: 'ApiError',
  status,
  code,
  message,
  payload: { ...payload, ...(code ? { code } : {}) },
});
ok('сүлжээ тасарсан → төлвийг дахин шалгана (хариу алдагдсан амжилт байж болно)', () => {
  const r = resolveClockOutError({ name: 'ApiNetworkError', message: 'Сүлжээний алдаа' });
  assert.equal(r.kind, 'verify');
  assert.equal(r.fallback.kind, 'offline');
});
ok('ApiError биш энгийн алдаа → шалгана', () => {
  assert.equal(resolveClockOutError(new Error('boom')).kind, 'verify');
});
ok('NO_OPEN_SESSION / ALREADY_CLOCKED_OUT → шалгана (давтан дарсан)', () => {
  assert.equal(resolveClockOutError(apiErr(404, 'NO_OPEN_SESSION', 'Өнөөдөр нээлттэй …')).kind, 'verify');
  assert.equal(resolveClockOutError(apiErr(409, 'ALREADY_CLOCKED_OUT', 'Гарсан бүртгэл аль хэдийн …')).kind, 'verify');
});
ok('PROGRESS_REQUIRED → «хийгдээгүй» цонх, шалтгаан явц', () => {
  const r = resolveClockOutError(apiErr(400, 'PROGRESS_REQUIRED', 'Гарахын өмнө ажлын явцаа оруулна уу'));
  assert.deepEqual(r, { kind: 'block', block: { kind: 'progress' } });
});
ok('OFFICE_NETWORK (403) → сүлжээ шалтгаан, IP-тай', () => {
  const r = resolveClockOutError(
    apiErr(403, 'OFFICE_NETWORK', 'Оффисын сүлжээнд холбогдоно уу', { client_ip: '1.2.3.4' }),
  );
  assert.deepEqual(r, { kind: 'block', block: { kind: 'network', ip: '1.2.3.4' } });
});
ok('5xx → шалгана (сервер дээр бичигдсэн байж магадгүй)', () => {
  assert.equal(resolveClockOutError(apiErr(500, undefined, 'API Request Failed')).kind, 'verify');
});
ok('төсөл сонгоогүй → popup дотор засна (монгол мессеж)', () => {
  const r = resolveClockOutError(apiErr(400, 'PROJECT_REQUIRED', 'Тарах үеийн төслөө сонгоно уу'));
  assert.deepEqual(r, { kind: 'inline', message: 'Тарах үеийн төслөө сонгоно уу' });
});
ok('англи мессежтэй тодорхойгүй 400 хэрэглэгчид англиар ГАРАХГҮЙ', () => {
  assert.equal(resolveClockOutError(apiErr(400, undefined, 'API Request Failed')).kind, 'verify');
});
ok('монгол мессежтэй бусад татгалзал → цонхонд яг тэр мессеж', () => {
  const r = resolveClockOutError(apiErr(400, 'NON_PROJECT_NOTE', '«Бусад» ажлын тайлбарыг бичнэ үү'));
  assert.deepEqual(r, { kind: 'block', block: { kind: 'server', message: '«Бусад» ажлын тайлбарыг бичнэ үү' } });
});

console.log('hhmmOf');
ok('УБ цагийн бичвэрээс HH:MM', () => {
  assert.equal(hhmmOf('2026-10-16T18:06:58+08:00'), '18:06');
  assert.equal(hhmmOf(null), '');
});

console.log(`\n${n} шалгалт давлаа`);
