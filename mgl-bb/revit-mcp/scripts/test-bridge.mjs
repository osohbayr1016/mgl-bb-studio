// Revit-ийн локал bridge-ийг шалгана.  Revit 2027 нээлттэй, MGL add-in
// ачаалагдсан байх шаардлагатай.  Төслийн файл нээлттэй байвал бүх хэрэгсэл
// шалгагдана; хоосон байвал зөвхөн /health.
//
// Ажиллуулах:  node <энэ файл>
import fs from 'node:fs';
import path from 'node:path';

const HS = path.join(process.env.APPDATA || '', 'RevitMcpAddin', 'bridge.json');

let pass = 0, fail = 0, skip = 0;
const ok = (m) => { pass++; console.log('  PASS  ' + m); };
const no = (m, d) => { fail++; console.log('  FAIL  ' + m + (d ? '\n        ' + d : '')); };
const sk = (m) => { skip++; console.log('  SKIP  ' + m); };

console.log('=== 1. Гар барих файл ===');
let hs = null;
try {
  hs = JSON.parse(fs.readFileSync(HS, 'utf8'));
  ok(`bridge.json уншигдав — порт ${hs.port}, pid ${hs.pid}`);
  hs.token && hs.token.length >= 32
    ? ok(`токен урт ${hs.token.length}`)
    : no('токен байхгүй/хэт богино');
} catch (e) {
  no('bridge.json уншигдсангүй: ' + HS, e.message);
  console.log('\n  → Revit 2027 нээлттэй байна уу?  MGL таб харагдаж байна уу?');
  console.log('  → Харагдахгүй бол add-in ачаалагдаагүй (доорх заавраас үз).');
  process.exit(1);
}

const BASE = `http://localhost:${hs.port || 5005}`;
const auth = { authorization: 'Bearer ' + hs.token };

async function get(p, headers) {
  const res = await fetch(BASE + p, { headers: headers || {} });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
async function tool(name, args, headers) {
  const res = await fetch(BASE + '/tool', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(headers ?? auth) },
    body: JSON.stringify({ tool: name, args: args || {} }),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

console.log('\n=== 2. /health (токенгүй ажиллах ёстой) ===');
try {
  const h = await get('/health');
  h.status === 200 ? ok(`health 200 — ${JSON.stringify(h.json)}`) : no('health', 'status=' + h.status);
} catch (e) {
  no('health хүрсэнгүй', e.message);
  console.log('\n  → Revit нээлттэй ч add-in-ий сервер асаагүй байж магадгүй.');
  process.exit(1);
}

console.log('\n=== 3. Аюулгүй байдал ===');
const noTok = await tool('list_sheets', {}, {});
noTok.status === 401 ? ok('токенгүй /tool → 401') : no('токенгүй → 401', 'status=' + noTok.status);

const badTok = await tool('list_sheets', {}, { authorization: 'Bearer wrong' });
badTok.status === 401 ? ok('буруу токен → 401') : no('буруу токен → 401', 'status=' + badTok.status);

const exec = await fetch(BASE + '/execute', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...auth },
  body: JSON.stringify({ code: 'return Doc.Title;' }),
});
if (exec.status === 403) ok('/execute → 403 (дурын код анхдагчаар унтраалттай) ✔');
else if (exec.status === 200) sk('/execute → 200 — MGL_ALLOW_EXEC=1 тавигдсан байна');
else no('/execute', 'status=' + exec.status);

console.log('\n=== 4. get_document_context ===');
const ctx = await tool('get_document_context');
if (ctx.status !== 200 || !ctx.json?.success) {
  sk('баримт нээгээгүй байна: ' + (ctx.json?.error || ctx.status));
  console.log('\n  → Revit дотор .rvt файл нээгээд дахин ажиллуулна уу.');
  console.log(`\n================  PASS ${pass}  FAIL ${fail}  SKIP ${skip}  ================`);
  process.exit(fail > 0 ? 1 : 0);
}
const doc = JSON.parse(ctx.json.result);
ok('баримт уншигдав');
console.log('    title      : ' + doc.title);
console.log('    file_name  : ' + doc.file_name);
console.log('    doc_uid    : ' + doc.doc_uid);
console.log('    version    : ' + doc.revit_version);
console.log('    sheets     : ' + doc.sheet_count);
console.log('    workshared : ' + doc.is_workshared);
console.log('    project    : ' + (doc.project_name || '(хоосон)') + ' / ' + (doc.project_number || '(хоосон)'));

console.log('\n  >>> ЭНЭ doc_uid-ыг ХУУЛЖ ЯВУУЛААРАЙ:');
console.log('  >>> ' + doc.doc_uid);
console.log('  >>> (өөр төслийн файл нээгээд дахин ажиллуулж, ХОЁРЫГ харьцуулна)');

console.log('\n=== 5. list_sheets ===');
const ls = await tool('list_sheets');
if (ls.json?.success) {
  const sheets = JSON.parse(ls.json.result).sheets || [];
  ok(`${sheets.length} хуудас`);
  for (const s of sheets.slice(0, 8)) {
    console.log(`    ${String(s.number).padEnd(14)} ${String(s.name).slice(0, 44).padEnd(46)} views=${s.placed_view_count}`);
  }
  if (sheets.length > 8) console.log(`    … +${sheets.length - 8}`);
  if (sheets.length === 0) console.log('    (хуудас байхгүй — холбох тест хийхийн тулд хуудас үүсгэх шаардлагатай)');
} else no('list_sheets', ls.json?.error);

console.log('\n=== 6. capture_baseline → diff_since_baseline ===');
const cb = await tool('capture_baseline');
if (cb.json?.success) {
  const b = JSON.parse(cb.json.result);
  ok(`суурь авав — ${b.element_count} элемент, ${b.sheet_count} хуудас`);
} else no('capture_baseline', cb.json?.error);

const df = await tool('diff_since_baseline');
if (df.json?.success) {
  const d = JSON.parse(df.json.result);
  ok(`ялгавар: added=${d.totals?.added} removed=${d.totals?.removed} өөрчлөгдсөн хуудас=${d.changed_sheets?.length}`);
  console.log('    warnings: ' + JSON.stringify(d.warnings));
  d.self_reported === true ? ok('self_reported=true (сервер баталгаажуулаагүй гэдгээ хэлж байна)') : no('self_reported алга');
  (d.changed_sheets?.length ?? 0) === 0
    ? ok('суурь авсны дараа шууд ялгавар 0 — зөв')
    : sk('ялгавар 0 биш (модель өөрчлөгдсөн байж магадгүй)');
} else no('diff_since_baseline', df.json?.error);

console.log('\n=== 7. Танихгүй хэрэгсэл ===');
const bad = await tool('no_such_tool');
bad.json?.success === false && /Танихгүй|Unknown/i.test(bad.json?.error || '')
  ? ok('танихгүй хэрэгсэл → ойлгомжтой алдаа')
  : no('танихгүй хэрэгслийн зан', JSON.stringify(bad.json).slice(0, 160));

console.log(`\n================  PASS ${pass}  FAIL ${fail}  SKIP ${skip}  ================`);
if (fail > 0) process.exitCode = 1;
