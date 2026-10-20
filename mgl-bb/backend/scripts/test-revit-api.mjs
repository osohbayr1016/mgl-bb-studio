// /api/revit-ийн БҮТЭН урсгалыг Revit-ГҮЙГЭЭР тестлэнэ.
// Хиймэл хуудсуудыг бодит зургийн нэрнээс үүсгэж, handshake → bindings →
// context → draft → submissions гэсэн замыг дуудаж, DB-д юу бичигдснийг шалгана.
import { DatabaseSync } from 'node:sqlite';

const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const DB = process.argv[2];
const USER = process.env.MGL_USER || 'A.Anand';
const PASS = process.env.MGL_PASS || 'admin123';

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS  ' + m); };
const no = (m, d) => { fail++; console.log('  FAIL  ' + m + (d ? '\n        ' + d : '')); };

async function api(method, path, token, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: 'Bearer ' + token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  const text = await res.text();
  try { json = JSON.parse(text); } catch { json = { _raw: text.slice(0, 300) }; }
  return { status: res.status, json };
}

// ---------------------------------------------------------------- 1. login
console.log('\n=== 1. Нэвтрэх ===');
const login = await api('POST', '/api/auth/login', null, { username: USER, password: PASS });
if (login.status !== 200 || !login.json?.token) {
  no('нэвтрэлт', `status=${login.status} ${JSON.stringify(login.json).slice(0, 200)}`);
  console.log('\nТокенгүй тул үргэлжлүүлэх боломжгүй.');
  process.exit(1);
}
const token = login.json.token;
const role = login.json.user?.role;
const userId = login.json.user?.id;
ok(`нэвтрэв — ${USER}, role=${role}, id=${userId}`);

// ------------------------------------------------------- 2. төсөл сонгох
console.log('\n=== 2. Зураг + ажилтай төсөл сонгох ===');
const db = new DatabaseSync(DB);
const project = db.prepare(`
  SELECT p.id, p.name, COUNT(DISTINCT d.id) dn, COUNT(DISTINCT t.id) tn
    FROM projects p
    INNER JOIN blocks b     ON b.project_id = p.id
    INNER JOIN drawings d   ON d.block_id = b.id
    INNER JOIN components c ON c.drawing_id = d.id
    INNER JOIN tasks t      ON t.component_id = c.id
   WHERE p.status = 'active'
   GROUP BY p.id HAVING dn >= 2 AND tn >= 3
   ORDER BY tn DESC LIMIT 1`).get();
if (!project) { no('тохирох төсөл олдсонгүй'); process.exit(1); }
ok(`төсөл #${project.id} «${project.name}» (${project.dn} зураг, ${project.tn} ажил)`);

const drawings = db.prepare(`
  SELECT d.id, d.name FROM drawings d
   INNER JOIN blocks b ON b.id = d.block_id
   WHERE b.project_id = ? ORDER BY b.sort_order, d.sort_order LIMIT 3`).all(project.id);
const tasks = db.prepare(`
  SELECT t.id, t.name, c.drawing_id FROM tasks t
   INNER JOIN components c ON c.id = t.component_id
   INNER JOIN drawings d   ON d.id = c.drawing_id
   INNER JOIN blocks b     ON b.id = d.block_id
   WHERE b.project_id = ?`).all(project.id);

const firstWord = (s) => (s || '').trim().split(/[\s—–-]+/)[0] || 'BA';
const sheets = [];
drawings.forEach((d, di) => {
  const code = firstWord(d.name);
  tasks.filter((t) => t.drawing_id === d.id).slice(0, 3).forEach((t, ti) => {
    sheets.push({
      uid: `test-uid-${di}-${ti}`,
      number: `${code}-${String(di * 10 + ti + 1).padStart(2, '0')}`,
      name: t.name,
      placed_view_count: 1,
    });
  });
});
console.log(`  ${sheets.length} хиймэл хуудас үүсгэв (${sheets.map((s) => s.number).join(', ')})`);

// ------------------------------------------------------- 3. эрхийн хаалт
console.log('\n=== 3. Эрхийн хаалт ===');
const noTok = await api('POST', '/api/revit/handshake', null, {});
noTok.status === 401 ? ok('токенгүй → 401') : no('токенгүй → 401', 'status=' + noTok.status);

// ---------------------------------------------------------- 4. handshake
console.log('\n=== 4. POST /api/revit/handshake ===');
const DOC_UID = 'apitest-doc-' + Date.now();
const hs = await api('POST', '/api/revit/handshake', token, {
  project_id: project.id,
  doc_uid: DOC_UID,
  uid_source: 'project_info',
  file_name: 'ApiTest_BA.rvt',
  revit_version: '2027',
  is_link: false,
  sheets,
});
if (hs.status !== 200) { no('handshake', `status=${hs.status} ${JSON.stringify(hs.json).slice(0, 300)}`); process.exit(1); }
ok(`handshake 200 — document #${hs.json.document?.id}`);
const docId = hs.json.document.id;
const bindings = hs.json.bindings || [];
const withTask = bindings.filter((b) => b.task_id);
console.log(`  ${bindings.length} холбоос, ${withTask.length} ажилтай`);
for (const b of bindings.slice(0, 5)) {
  console.log(`    ${String(b.sheet_number).padEnd(12)} -> зураг ${b.drawing_id ?? '—'} ажил ${b.task_id ?? '—'} (${b.match_source ?? '—'} ${b.confidence})`);
}
withTask.length > 0 ? ok(`таарц ${withTask.length}/${bindings.length}`) : no('нэг ч ажил таарсангүй');

// handshake ДАХИН — давхардал үүсэх ёсгүй
const hs2 = await api('POST', '/api/revit/handshake', token, {
  project_id: project.id, doc_uid: DOC_UID, file_name: 'ApiTest_BA_renamed.rvt',
  revit_version: '2027', is_link: false, sheets,
});
hs2.status === 200 && (hs2.json.bindings?.length === bindings.length)
  ? ok('дахин handshake — холбоос давхардаагүй, файлын нэр шинэчлэгдэв')
  : no('дахин handshake', `status=${hs2.status} bindings=${hs2.json.bindings?.length}`);

// ---------------------------------------------------------- 5. bindings
console.log('\n=== 5. PUT /api/revit/bindings (+ дэд жагсаалт) ===');
const target = withTask[0];
if (!target) { no('батлах холбоос алга'); process.exit(1); }
const sameTask = withTask.filter((b) => b.task_id === target.task_id);
const save = await api('PUT', '/api/revit/bindings', token, {
  revit_document_id: docId,
  items: sameTask.map((b) => ({
    sheet_uid: b.sheet_uid, drawing_id: b.drawing_id, task_id: b.task_id, status: 'confirmed',
  })),
  seed_checklist: true,
});
save.status === 200 ? ok(`bindings 200 — saved=${save.json.saved}`) : no('bindings', `status=${save.status} ${JSON.stringify(save.json).slice(0,200)}`);
const seeded = save.json.checklist_seeded?.[0];
seeded && seeded.added > 0
  ? ok(`дэд жагсаалт АВТОМАТААР үүсэв — ажил ${seeded.task_id}, +${seeded.added} мөр (нийт ${seeded.total})`)
  : no('дэд жагсаалт үүсээгүй', JSON.stringify(save.json.checklist_seeded));

const clRows = db.prepare('SELECT id, text, is_done FROM task_checklist_items WHERE task_id=? AND user_id=? ORDER BY sort_order').all(target.task_id, userId);
for (const r of clRows.slice(0, 6)) console.log(`    [${r.is_done ? 'x' : ' '}] ${r.text}`);

// ----------------------------------------------------------- 6. context
console.log('\n=== 6. GET /api/revit/context ===');
const ctx = await api('GET', `/api/revit/context?doc_uid=${encodeURIComponent(DOC_UID)}&project_id=${project.id}`, token);
ctx.status === 200 ? ok(`context 200 — ${ctx.json.resolved?.length} ажил`) : no('context', `status=${ctx.status} ${JSON.stringify(ctx.json).slice(0,200)}`);
const resolved = ctx.json.resolved?.find((r) => r.task_id === target.task_id);
if (resolved) {
  console.log(`    ажил «${resolved.task_name}» · явц ${resolved.current_progress}% · checklist ${resolved.checklist.done}/${resolved.checklist.total}`);
  console.log(`    basis=${resolved.percent_basis} derived=${resolved.derived_percent} suggested=${resolved.suggested_percent} ceiling=${resolved.ceiling}`);
  resolved.ceiling === 99 ? ok('таг = 99 (Revit-ээс 100% боломжгүй)') : no('таг', String(resolved.ceiling));
} else no('сонгосон ажил context-д алга');

// checklist-ийн хагасыг тэмдэглэнэ
console.log('\n=== 7. Дэд жагсаалт тэмдэглэх ===');
const half = Math.max(1, Math.floor(clRows.length / 2));
for (const r of clRows.slice(0, half)) {
  const t = await api('PATCH', `/api/tasks/checklist/${r.id}`, token, { is_done: true });
  if (t.status !== 200) { no(`checklist #${r.id}`, 'status=' + t.status); break; }
}
ok(`${half}/${clRows.length} мөр тэмдэглэв`);

// ------------------------------------------------------------- 8. draft
console.log('\n=== 8. POST /api/revit/draft ===');
const draft = await api('POST', '/api/revit/draft', token, {
  task_id: target.task_id,
  sheet_uids: sameTask.map((b) => b.sheet_uid),
  change: { totals: { added: 191, removed: 16, modified: 3 }, self_reported: true },
});
draft.status === 200 ? ok('draft 200') : no('draft', `status=${draft.status} ${JSON.stringify(draft.json).slice(0,300)}`);
if (draft.status === 200) {
  const d = draft.json;
  console.log(`    хувь: одоо ${d.current_percent}% → санал ${d.suggested_percent}% (derived ${d.derived_percent}, basis ${d.percent_basis})`);
  console.log(`    гаралт: ${d.basis_detail || '(хоосон)'}`);
  console.log(`    AI: model=${d.ai_model ?? 'загвар'} fallback=${d.fallback}`);
  console.log(`    warnings: ${JSON.stringify(d.warnings)}`);
  console.log(`    ТЭМДЭГЛЭЛ:\n      ${(d.note_mn || '').replace(/\n/g, '\n      ')}`);
  (d.note_mn || '').length > 10 ? ok('монгол тэмдэглэл гарлаа') : no('тэмдэглэл хоосон');
  d.suggested_percent !== null && d.suggested_percent <= d.ceiling
    ? ok('санал таг дотор')
    : no('санал таг давсан', `${d.suggested_percent} > ${d.ceiling}`);
}

// -------------------------------------------------------- 9. submissions
console.log('\n=== 9. POST /api/revit/submissions ===');
const d = draft.json;
const pct = d.suggested_percent ?? d.current_percent;
const DRAFT_UID = 'apitest-' + Date.now();
const common = {
  draft_uid: DRAFT_UID, confirmed: true, task_id: target.task_id, percentage: pct,
  notes: (d.note_mn || 'тест') + ' [ТЕСТ]', ai_notes: d.note_mn,
  ai_model: d.ai_model, ai_prompt_version: d.ai_prompt_version,
  revit_document_id: docId, sheet_uids: sameTask.map((b) => b.sheet_uid),
  change: { totals: { added: 191 } }, evidence: [],
};

// баталгаажуулалтгүй → 400
const noConfirm = await api('POST', '/api/revit/submissions', token, { ...common, confirmed: false });
noConfirm.status === 400 && noConfirm.json.error === 'confirmation_required'
  ? ok('confirmed:false → 400 confirmation_required') : no('баталгаажуулалтын хаалт', `status=${noConfirm.status} ${JSON.stringify(noConfirm.json)}`);

// тоо биш → 400
const strPct = await api('POST', '/api/revit/submissions', token, { ...common, percentage: String(pct) });
strPct.status === 400 ? ok('percentage:"62" (мөр) → 400') : no('тоон төрлийн хаалт', 'status=' + strPct.status);

// 100 → таг
const over = await api('POST', '/api/revit/submissions', token, { ...common, percentage: 100 });
over.status === 400 && over.json.error === 'percentage_above_ceiling'
  ? ok('percentage:100 → 400 above_ceiling')
  : (over.status === 409 && over.json.error === 'already_at_ceiling'
      ? ok('percentage:100 → 409 already_at_ceiling (ажил аль хэдийн 99%+)')
      : no('тагийн хаалт', `status=${over.status} ${JSON.stringify(over.json).slice(0,200)}`));

// бодит илгээлт
const sub = await api('POST', '/api/revit/submissions', token, common);
if (sub.status === 201) {
  ok(`илгээлт 201 — entry #${sub.json.entry_id}, status=${sub.json.status}, ${sub.json.percentage}%`);
  console.log(`    мессеж: ${sub.json.message}`);
} else if (sub.status === 409) {
  console.log(`  (409 ${sub.json.error} — ${sub.json.message || ''})`);
  ok('сервер зөв татгалзав (409) — хаалт ажиллаж байна');
} else {
  no('илгээлт', `status=${sub.status} ${JSON.stringify(sub.json).slice(0,300)}`);
}

// ДАХИН — idempotency
if (sub.status === 201) {
  const again = await api('POST', '/api/revit/submissions', token, common);
  again.json.duplicate === true
    ? ok('ижил draft_uid-аар дахин → duplicate:true, шинэ мөр үүсээгүй')
    : no('idempotency', `status=${again.status} ${JSON.stringify(again.json).slice(0,200)}`);

  const rows = db.prepare(`SELECT id, percentage, status, source, notes FROM progress_entries
                            WHERE task_id=? AND user_id=? ORDER BY id DESC LIMIT 3`).all(target.task_id, userId);
  const mine = rows.find((r) => r.id === sub.json.entry_id);
  mine ? ok(`DB: progress_entries #${mine.id} source='${mine.source}' status='${mine.status}' ${mine.percentage}%`)
       : no('DB-д мөр олдсонгүй');
  mine && mine.source === 'revit' ? ok("source='revit' зөв бичигдэв") : no('source буруу', mine?.source);

  const subs = db.prepare('SELECT claim_state, progress_entry_id, edited_by_human, percent_basis, checklist_done, checklist_total FROM revit_submissions WHERE draft_uid=?').get(DRAFT_UID);
  subs ? ok(`аудит: claim_state='${subs.claim_state}' entry=${subs.progress_entry_id} edited_by_human=${subs.edited_by_human} basis=${subs.percent_basis} checklist=${subs.checklist_done}/${subs.checklist_total}`)
       : no('аудит мөр алга');
  subs && subs.claim_state === 'sealed' ? ok("claim_state='sealed'") : no('claim_state', subs?.claim_state);
  subs && subs.edited_by_human === 1 ? ok('edited_by_human=1 (сервер тооцов — бид тэмдэглэл зассан)') : no('edited_by_human', String(subs?.edited_by_human));
}

console.log(`\n================  PASS ${pass}   FAIL ${fail}  ================`);
if (fail > 0) process.exitCode = 1;
