#!/usr/bin/env node
/**
 * MGL AI · «ЭНЭ ХҮСЭЛТ ЯАГААД УНАВ?» — нэг яриа/мессежийн оношилгооны мөр (Session C, 2026-09-11, §42).
 *
 *   node ai/tools/diagnose-request.mjs --conv <conv_uid> [--db <sqlite>] [--json]
 *   node ai/tools/diagnose-request.mjs --msg  <msg_uid>  [--db <sqlite>]
 *   node ai/tools/diagnose-request.mjs --recent [N]      [--db <sqlite>]   # сүүлийн N яриа
 *
 * Локал D1 (miniflare sqlite) эсвэл `wrangler d1 export`-оос гаргасан sqlite-ийг ЗӨВХӨН УНШИНА.
 * Нэг мөшгилтөд: хэрэглэгчийн мессеж → хэрэгслийн аудит (decision/duration/result/error) →
 * туслахын мессеж (stop_reason, error, diag_json зөрчил, first_token/total, model_version, эшлэл,
 * confidence) → санал хүсэлт.  Prod-ын D1 руу ХЭЗЭЭ Ч холбогдохгүй — файл л.
 *
 * ⚠️ Хэрэглэгчийн текстийг `redaction.ts`-ээр маскална — оношилгооны гаралт хуваалцагдаж болно.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const args = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = args.indexOf(n);
  return i >= 0 ? (args[i + 1] ?? true) : d;
};

registerHooks({
  resolve(sp, c, n) {
    if (/^\.{1,2}\//.test(sp) && !/\.[cm]?[jt]s$/.test(sp)) return n(`${sp}.ts`, c);
    return n(sp, c);
  },
});
const { redact } = await import(pathToFileURL(path.join(REPO, 'backend', 'src', 'lib', 'mglai', 'redaction.ts')).href);

function findLocalDb() {
  const dir = path.join(REPO, 'backend', '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sqlite')).map((f) => path.join(dir, f));
  files.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
  return files[0] ?? null;
}

const DB_PATH = opt('--db') ?? findLocalDb();
if (!DB_PATH || !fs.existsSync(DB_PATH)) {
  console.error('sqlite олдсонгүй — --db <path> өг (локал: backend/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite)');
  process.exit(2);
}
const db = new DatabaseSync(DB_PATH, { readOnly: true });
const q = (sql, ...p) => db.prepare(sql).all(...p);
const JSON_MODE = args.includes('--json');

function parseJson(s) {
  if (typeof s !== 'string') return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function traceConversation(convUid) {
  const conv = q('SELECT * FROM ai_conversations WHERE conv_uid = ?', convUid)[0] ?? null;
  const messages = q('SELECT * FROM ai_messages WHERE conv_uid = ? ORDER BY seq ASC, id ASC', convUid);
  const audits = q('SELECT * FROM ai_action_audits WHERE conv_uid = ? ORDER BY requested_at ASC, id ASC', convUid);
  const feedback = q('SELECT msg_uid, vote, reason_codes_json, reason_text, review_state, created_at FROM ai_feedback WHERE conv_uid = ?', convUid);
  const byMsg = new Map();
  for (const a of audits) {
    const k = a.msg_uid ?? '(msg_uid-гүй)';
    if (!byMsg.has(k)) byMsg.set(k, []);
    byMsg.get(k).push(a);
  }
  const steps = [];
  for (const m of messages) {
    const diag = parseJson(m.diag_json);
    const step = {
      seq: m.seq,
      role: m.role,
      msg_uid: m.msg_uid,
      at: m.created_at,
      content: redact(String(m.content ?? '')).slice(0, 240),
      model_version: m.model_version,
      runtime_variant: m.runtime_variant,
      stop_reason: m.stop_reason,
      error: m.error ? redact(m.error) : null,
      first_token_ms: m.first_token_ms,
      total_ms: m.total_ms,
      tokens: m.prompt_tokens != null || m.completion_tokens != null ? { prompt: m.prompt_tokens, completion: m.completion_tokens } : null,
      confidence: m.confidence,
      evidence_count: m.evidence_count,
      citations: (parseJson(m.citations_json) ?? []).length,
      contract: diag ? { mode: diag.mode, risk: diag.risk, attempts: diag.attempts, final: diag.final, buffered: diag.buffered, violations: diag.violations } : null,
      tools: (byMsg.get(m.msg_uid) ?? []).map((a) => ({ tool: a.tool_name, kind: a.tool_kind, decision: a.decision, level: a.permission_level, result: a.result, error: a.error, ms: a.duration_ms })),
      feedback: feedback.filter((f) => f.msg_uid === m.msg_uid).map((f) => ({ vote: f.vote, reasons: parseJson(f.reason_codes_json), state: f.review_state })),
    };
    steps.push(step);
  }
  // msg_uid-гүй аудит (хуучин клиент) — ярианы төгсгөлд
  const orphan = byMsg.get('(msg_uid-гүй)') ?? [];

  // ── ОНОШ: яагаад унав? ─────────────────────────────────────────
  const verdicts = [];
  for (const s of steps) {
    if (s.role !== 'assistant') continue;
    if (s.error) verdicts.push(`seq ${s.seq}: алдаа «${s.error}»`);
    if (s.stop_reason && s.stop_reason !== 'stop') verdicts.push(`seq ${s.seq}: зогсох шалтгаан ${s.stop_reason}${s.stop_reason === 'length' ? ' (max_tokens-д хүрсэн — хариулт тасарсан байж болно)' : ''}`);
    if (s.contract?.final === 'template') verdicts.push(`seq ${s.seq}: загвар ${s.contract.attempts} удаа гэрээ зөрчсөн → детерминист template (${(s.contract.violations ?? []).map((v) => v.join('+')).join(' | ')})`);
    else if (s.contract && (s.contract.violations ?? []).some((v) => v.length > 0)) verdicts.push(`seq ${s.seq}: гэрээний зөрчил засагдав (${(s.contract.violations ?? []).map((v) => v.join('+')).join(' | ')}) → ${s.contract.final}`);
    for (const t of s.tools) if (t.result !== 'ok') verdicts.push(`seq ${s.seq}: хэрэгсэл ${t.tool} → ${t.decision}/${t.result}${t.error ? ` (${t.error})` : ''}`);
    if (s.confidence && /insufficient|хүрэлцэхгүй/i.test(String(s.confidence))) verdicts.push(`seq ${s.seq}: итгэл ${s.confidence}, нотолгоо ${s.evidence_count}, эшлэл ${s.citations}`);
    if (s.first_token_ms != null && s.first_token_ms > 5000) verdicts.push(`seq ${s.seq}: эхний токен ${s.first_token_ms} мс (удаан — runtime ачаалал/дараалал?)`);
  }
  for (const a of orphan) if (a.result !== 'ok') verdicts.push(`msg_uid-гүй аудит: ${a.tool_name} → ${a.decision}/${a.result}${a.error ? ` (${a.error})` : ''}`);

  return { conv: conv ? { conv_uid: conv.conv_uid, user_id: conv.user_id, mode: conv.mode, surface: conv.surface, model_version: conv.model_version, system_prompt_version: conv.system_prompt_version, tool_schema_version: conv.tool_schema_version, created_at: conv.created_at, message_count: conv.message_count } : null, steps, orphan_audits: orphan.length, verdicts };
}

function print(t) {
  if (!t.conv) {
    console.log('яриа олдсонгүй');
    return;
  }
  const c = t.conv;
  console.log(`яриа ${c.conv_uid} · user ${c.user_id} · ${c.mode}/${c.surface} · model ${c.model_version} · prompt ${c.system_prompt_version} · tools ${c.tool_schema_version} · ${c.created_at}`);
  for (const s of t.steps) {
    console.log(`\n[${s.seq}] ${s.role.toUpperCase()} ${s.at ?? ''}${s.msg_uid ? ` ${s.msg_uid}` : ''}`);
    console.log(`    «${s.content.replace(/\s+/g, ' ')}»`);
    if (s.role === 'assistant') {
      console.log(`    stop=${s.stop_reason ?? '—'} error=${s.error ?? '—'} first=${s.first_token_ms ?? '—'}мс total=${s.total_ms ?? '—'}мс model=${s.model_version}/${s.runtime_variant ?? '—'} conf=${s.confidence ?? '—'} ev=${s.evidence_count} cit=${s.citations}`);
      if (s.contract) console.log(`    гэрээ: ${s.contract.mode}/${s.contract.risk} · оролдлого ${s.contract.attempts} · эцсийн ${s.contract.final}${s.contract.buffered ? ' · буферлэсэн' : ''} · зөрчил ${JSON.stringify(s.contract.violations)}`);
    }
    for (const tool of s.tools) console.log(`    хэрэгсэл ${tool.tool} (${tool.kind}) → ${tool.decision}/${tool.result} ${tool.ms ?? '?'}мс${tool.error ? ` ✖ ${tool.error}` : ''} [${tool.level}]`);
    for (const f of s.feedback) console.log(`    санал: ${f.vote} ${JSON.stringify(f.reasons ?? [])} (${f.state})`);
  }
  console.log(`\nОНОШ (${t.verdicts.length}):`);
  for (const v of t.verdicts) console.log(`  • ${v}`);
  if (t.verdicts.length === 0) console.log('  • гэмтлийн шинж илрээгүй');
}

const conv = opt('--conv');
const msg = opt('--msg');
if (conv) {
  const t = traceConversation(conv);
  if (JSON_MODE) console.log(JSON.stringify(t, null, 2));
  else print(t);
} else if (msg) {
  const row = q('SELECT conv_uid FROM ai_messages WHERE msg_uid = ?', msg)[0] ?? q('SELECT conv_uid FROM ai_action_audits WHERE msg_uid = ?', msg)[0];
  if (!row) {
    console.log('msg_uid олдсонгүй');
    process.exit(1);
  }
  const t = traceConversation(row.conv_uid);
  if (JSON_MODE) console.log(JSON.stringify(t, null, 2));
  else print(t);
} else {
  const n = Number(opt('--recent', 10)) || 10;
  const rows = q('SELECT c.conv_uid, c.user_id, c.mode, c.created_at, c.message_count, (SELECT COUNT(*) FROM ai_messages m WHERE m.conv_uid = c.conv_uid AND m.error IS NOT NULL) AS errors, (SELECT COUNT(*) FROM ai_action_audits a WHERE a.conv_uid = c.conv_uid AND a.result <> ?) AS failed_tools FROM ai_conversations c ORDER BY c.created_at DESC LIMIT ?', 'ok', n);
  console.log(`сүүлийн ${rows.length} яриа (${path.basename(DB_PATH)}):`);
  for (const r of rows) console.log(`  ${r.conv_uid}  user ${r.user_id} ${r.mode}  ${r.created_at}  msgs ${r.message_count}  errors ${r.errors}  failed_tools ${r.failed_tools}`);
  console.log('\n--conv <uid> гэж дэлгэрэнгүй мөшгилт авна');
}
