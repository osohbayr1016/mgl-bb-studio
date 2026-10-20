/**
 * «PROJECT DESCRIPTION» баримт ⇄ паспорт — цэвэр хөрвүүлэгчийн шалгалт.
 *
 *   node scripts/check-passport-doc.mjs        (frontend/ хавтаснаас)
 *
 * Юуг хамгаална: төслийн «Мэдээлэл» таб паспортыг Word баримт шиг үзүүлж
 * тэр дээр нь засварлуулдаг (`passport/passportDoc.ts`).  Баримтын талбар ба
 * DB-ийн багана нэг-нэг биш тул гурван хөрвүүлэлт л алдаа гаргах газар:
 * CEO мөр ⇄ `client_contacts[0]` (утас/имэйл алдагдахгүй), «Бичиг баримт»
 * мөрийн diff (шинэ ≠ байгаа; санамсаргүй id-г байгаа гэж андуурахгүй),
 * ба патч → багана (хоосон → null).
 */
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');
const LIB = join(SRC, 'features', 'projects', 'components', 'passport');

/* `formatting.ts` → `config/brand.ts` нь `import.meta.env` уншдаг (Vite л
 * өгнө).  Нэрийн эргүүлэлтэд brand хэрэггүй тул тэр модулийг хоосноор орлуулна. */
const BRAND_STUB = 'stub:brand';

registerHooks({
  load(url, context, nextLoad) {
    if (url === BRAND_STUB) {
      return { format: 'module', shortCircuit: true, source: 'export const brand = {};' };
    }
    return nextLoad(url, context);
  },
  resolve(specifier, context, nextResolve) {
    if (specifier === '@/shared/config/brand') return { url: BRAND_STUB, shortCircuit: true };
    /* `@/` alias → src/ (vite.config-ийн ижил дүрэм). */
    if (specifier.startsWith('@/')) {
      const abs = join(SRC, specifier.slice(2));
      const withTs = existsSync(`${abs}.ts`) ? `${abs}.ts` : `${abs}.tsx`;
      return nextResolve(pathToFileURL(withTs).href, context);
    }
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      const base = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : LIB;
      const asFile = join(base, `${specifier}.ts`);
      if (existsSync(asFile)) return nextResolve(`${specifier}.ts`, context);
      return nextResolve(`${specifier}/index.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const M = await import(pathToFileURL(join(LIB, 'passportDoc.ts')).href);

let n = 0;
const ok = (name, fn) => {
  fn();
  n += 1;
  console.log(`  ✓ ${name}`);
};

const passport = (over = {}) => ({
  project_id: 7,
  full_title: null,
  drawing_no: null,
  doc_no: null,
  scope: null,
  director: null,
  client_pm: null,
  start_date: null,
  finish_date: null,
  extension_date: null,
  meeting_30: null,
  meeting_50: null,
  meeting_100: null,
  disciplines: [],
  client_contacts: [],
  scope_rows: [],
  timeline: [],
  meetings: [],
  notes: null,
  updated_at: '',
  updated_by_id: null,
  ...over,
});

const doc = (id, over = {}) => ({
  id,
  project_id: 7,
  sort_order: id,
  doc_name: `Doc ${id}`,
  doc_no: null,
  doc_date: null,
  source: null,
  description: null,
  status: 'pending',
  provided_at: null,
  provided_by_id: null,
  file_url: null,
  file_name: null,
  created_at: '',
  updated_at: '',
  ...over,
});

console.log('passportDoc.ts');

/* ---------------- CEO ---------------- */
ok('ceoDisplay: DB «Овог Нэр» → «Нэр Овог (Албан тушаал)»', () => {
  assert.equal(
    M.ceoDisplay([{ full_name: 'Ганбат Батбаяр', position: 'Захирал', phone: '', email: '' }]),
    'Батбаяр Ганбат (Захирал)',
  );
  assert.equal(M.ceoDisplay([{ full_name: 'Ганбат Батбаяр', position: '', phone: '', email: '' }]), 'Батбаяр Ганбат');
  assert.equal(M.ceoDisplay([]), '');
  assert.equal(M.ceoDisplay(null), '');
});

ok('ceoToContacts: round-trip нь утас/имэйл, бусад харилцагчийг хадгална', () => {
  const contacts = [
    { full_name: 'Ганбат Батбаяр', position: 'Захирал', phone: '9911', email: 'a@b.mn' },
    { full_name: 'Дорж Бат', position: 'ПМ', phone: '8800', email: '' },
  ];
  const shown = M.ceoDisplay(contacts);
  const back = M.ceoToContacts(shown, contacts);
  assert.deepEqual(back, contacts);
});

ok('ceoToContacts: нэр солиход албан тушаал, утас хэвээр', () => {
  const contacts = [{ full_name: 'Ганбат Батбаяр', position: 'Захирал', phone: '9911', email: '' }];
  const back = M.ceoToContacts('Сүх Дорж (Захирал)', contacts);
  assert.deepEqual(back, [{ full_name: 'Дорж Сүх', position: 'Захирал', phone: '9911', email: '' }]);
});

ok('ceoToContacts: хаалт устгавал албан тушаал хоосон; хаалт солиход шинэ', () => {
  const contacts = [{ full_name: 'Ганбат Батбаяр', position: 'Захирал', phone: '', email: '' }];
  assert.equal(M.ceoToContacts('Батбаяр Ганбат', contacts)[0].position, '');
  assert.equal(M.ceoToContacts('Батбаяр Ганбат (Менежер)', contacts)[0].position, 'Менежер');
});

ok('ceoToContacts: хоосон мөр → эхний харилцагч хасагдана, бусад үлдэнэ', () => {
  const contacts = [
    { full_name: 'A B', position: '', phone: '', email: '' },
    { full_name: 'C D', position: 'x', phone: '', email: '' },
  ];
  assert.deepEqual(M.ceoToContacts('   ', contacts), [contacts[1]]);
  assert.deepEqual(M.ceoToContacts('', []), []);
});

ok('ceoToContacts: харилцагчгүй паспорт дээр шинэ мөр үүснэ', () => {
  assert.deepEqual(M.ceoToContacts('Батбаяр Ганбат', []), [
    { full_name: 'Ганбат Батбаяр', position: '', phone: '', email: '' },
  ]);
});

/* ---------------- draft ---------------- */
ok('passportToDocDraft: null багана → хоосон мөр, түгжсэн талбар гаднаас', () => {
  const d = M.passportToDocDraft({
    passport: passport({ full_title: 'T', disciplines: ['BA'] }),
    documents: [{ id: 'cd-1', name: 'x', no: '', date: '', description: '' }],
    clientName: 'Захиалагч ХХК',
    location: 'УБ',
  });
  assert.equal(d.projectTitle, 'T');
  assert.equal(d.drawingNo, '');
  assert.equal(d.clientName, 'Захиалагч ХХК');
  assert.equal(d.location, 'УБ');
  assert.deepEqual(d.disciplines, ['BA']);
  assert.equal(d.documents.length, 1);
  // «Doc. No.» мөр 2026-09-28-нд хасагдсан — draft-д ч байхгүй.
  assert.equal('docNo' in d, false);
  // «Client» засагдана (project_clients руу `client_name`-ээр), байршил түгжээтэй.
  assert.deepEqual(M.LOCKED_FIELDS, ['location']);
});

ok('docPatchToPassport: хоосон → null, түгжсэн/баримтын түлхүүр орохгүй', () => {
  const cur = passport({ client_contacts: [{ full_name: 'Г Б', position: 'З', phone: '1', email: '' }] });
  assert.deepEqual(M.docPatchToPassport({ drawingNo: '  ' }, cur), { drawing_no: null });
  // docNo нь паспортад буцаж бичигдэхгүй (мөр хасагдсан).
  assert.deepEqual(M.docPatchToPassport({ docNo: 'MGL-PD-1' }, cur), {});
  // clientName нь паспортын багана БИШ — `ProjectInfoTab` `client_name`-ээр тусад нь илгээнэ.
  assert.deepEqual(M.docPatchToPassport({ clientName: 'x', location: 'y', documents: [] }, cur), {});
  const ceo = M.docPatchToPassport({ ceo: 'Б Г (З)' }, cur);
  assert.deepEqual(ceo, { client_contacts: [{ full_name: 'Г Б', position: 'З', phone: '1', email: '' }] });
  assert.deepEqual(M.docPatchToPassport({ disciplines: ['BB'] }, cur), { disciplines: ['BB'] });
});

/* ---------------- documents diff ---------------- */
ok('existingDocId: cd-<n> л байгаа мөр; doc-1234567 (санамсаргүй) шинэ', () => {
  assert.equal(M.existingDocId('cd-12'), 12);
  assert.equal(M.existingDocId('doc-1234567'), null);
  assert.equal(M.existingDocId('cd-x'), null);
  assert.equal(M.docRowId(5), 'cd-5');
});

ok('docRowsFromClientDocs: description байхгүй бол source', () => {
  const rows = M.docRowsFromClientDocs([doc(1, { source: 'Захиалагч' }), doc(2, { description: 'd', source: 's' })]);
  assert.equal(rows[0].description, 'Захиалагч');
  assert.equal(rows[1].description, 'd');
  assert.equal(rows[0].id, 'cd-1');
});

ok('diffDocRows: өөрчлөлтгүй → хоосон', () => {
  const before = [doc(1), doc(2)];
  const after = M.docRowsFromClientDocs(before);
  assert.deepEqual(M.diffDocRows(before, after), { create: [], update: [], remove: [] });
});

ok('diffDocRows: шинэ (нэртэй л), засвар, устгал, эрэмбэ', () => {
  const before = [doc(1), doc(2), doc(3)];
  const after = [
    { id: 'cd-2', name: 'Doc 2', no: '', date: '', description: '' }, // эрэмбэ 1 болов → update
    { id: 'doc-abc1', name: 'Шинэ', no: '7', date: '2026-01-01', description: '' }, // create
    { id: 'doc-abc2', name: '   ', no: '', date: '', description: '' }, // нэргүй шинэ → алгасна
    { id: 'cd-1', name: 'Doc 1 засав', no: '', date: '', description: '' }, // update
    // cd-3 алга → remove
  ];
  const d = M.diffDocRows(before, after);
  assert.deepEqual(d.create.map((c) => [c.row.name, c.sort_order]), [['Шинэ', 2]]);
  assert.deepEqual(d.update.map((u) => [u.id, u.sort_order]), [[2, 1], [1, 4]]);
  assert.deepEqual(d.remove, [3]);
});

ok('diffDocRows: байгаа мөрийн нэрийг арилгавал устгах хүсэлт', () => {
  const d = M.diffDocRows([doc(1)], [{ id: 'cd-1', name: '', no: '', date: '', description: '' }]);
  assert.deepEqual(d, { create: [], update: [], remove: [1] });
});

ok('diffDocRows: зөвхөн зай нэмсэн нь өөрчлөлт БИШ', () => {
  const d = M.diffDocRows([doc(1, { doc_no: 'A' })], [{ id: 'cd-1', name: ' Doc 1 ', no: 'A ', date: '', description: '' }]);
  assert.deepEqual(d, { create: [], update: [], remove: [] });
});

/* ---- Он.сар.өдөр маск + шинэ төслийн өгөгдмөл (2026-09-25) ---- */
const D = await import(pathToFileURL(join(SRC, 'shared/lib/dottedDate.ts')).href);
const S = await import(pathToFileURL(join(LIB, 'passportSections.ts')).href);

ok('maskDottedDate: цифр бичихэд цэгийг систем тавина', () => {
  const steps = ['2', '20260', '202609', '2026092', '20260925', '202609251'];
  assert.deepEqual(steps.map(D.maskDottedDate), ['2', '2026.0', '2026.09', '2026.09.2', '2026.09.25', '2026.09.25']);
  // Бичиж байх үеийн дутуу утгыг ДҮҮРГЭХГҮЙ (2 → 02 болгохгүй).
  assert.equal(D.maskDottedDate('2026.09.2'), '2026.09.2');
  assert.equal(D.maskDottedDate('2026.09.25'), '2026.09.25');
});

ok('maskDottedDate: зураас/үсэг хаягдана, буулгасан бүтэн огноо хэвэнд орно', () => {
  assert.equal(D.maskDottedDate('2026-09-25'), '2026.09.25');
  assert.equal(D.maskDottedDate('2026/9/5'), '2026.09.05');
  assert.equal(D.maskDottedDate('2026.9.5'), '2026.09.05');
  assert.equal(D.maskDottedDate('2026.09-2a5'), '2026.09.25');
  assert.equal(D.maskDottedDate('abc'), '');
});

ok('toDottedDate: ISO → цэгтэй, чөлөөт текст хэвээр; caretAfterDigits', () => {
  assert.equal(D.toDottedDate('2026-09-25'), '2026.09.25');
  assert.equal(D.toDottedDate('2025 оны 12 сар'), '2025 оны 12 сар');
  assert.equal(D.toDottedDate(null), '');
  assert.equal(D.caretAfterDigits('2026.09.2', 5), 6);
  assert.equal(D.caretAfterDigits('2026.09.2', 4), 4);
  assert.equal(D.caretAfterDigits('2026.09.2', 0), 0);
  // Хадгалах зам цэгтэй хэлбэрийг ISO болгоно.
  assert.equal(S.toIsoDate('2026.09.25'), '2026-09-25');
});

ok('шинэ төслийн 1.2: бүх 11 дисциплин, ЕТ-тэй, тогтмол id, цэгтэй огноогоор файлын нэр', () => {
  const rows = S.defaultScopeRows('MGL-260925-ABC-AZ', '2026.09.25');
  assert.equal(rows.length, 11);
  assert.deepEqual(rows.map((r) => r.code), ['EZ', 'ET', 'BA', 'BB', 'HAS', 'TSBU', 'TSAH', 'HD', 'AU', 'IZ', 'GT']);
  assert.equal(rows[1].id, 'sc-ET');
  assert.equal(rows[1].identification, 'Орчны ЕТ, өндөржилт');
  assert.equal(rows[2].fileName, '260925_MGL_260925_ABC_AZ_BA_A');
});

ok('шинэ төслийн 1.3: өнөөдрөөр бөглөнө, засаагүй Дуусах/Сунгалт хадгалагдахгүй', () => {
  const rows = S.prefilledTimelineRows('2026.09.25');
  assert.deepEqual(rows.map((r) => r.date), ['2026.09.25', '2026.09.25', '2026.09.25']);
  const untouched = new Set(['tl-finish', 'tl-ext']);
  assert.deepEqual(S.dropUntouchedPrefill(rows, untouched).map((r) => r.date), ['2026.09.25', '', '']);
  const edited = rows.map((r) => (r.id === 'tl-finish' ? { ...r, date: '2027.03.01' } : r));
  assert.deepEqual(
    S.dropUntouchedPrefill(edited, new Set(['tl-ext'])).map((r) => r.date),
    ['2026.09.25', '2027.03.01', ''],
  );
});

ok('уулзалтын хуваарь: 10 / 40 / 80 / 100 %', () => {
  assert.deepEqual(S.defaultMeetingRows().map((r) => r.label), ['10%', '40%', '80%', '100%']);
});

console.log(`\n${n} шалгалт ногоон`);
