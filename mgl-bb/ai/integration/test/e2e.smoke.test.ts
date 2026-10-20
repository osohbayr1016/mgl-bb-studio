/**
 * MGL AI · НЭГДСЭН E2E SMOKE — ЗАГВАРГҮЙ, БОДИТ BACKEND + БОДИТ RUNTIME (Session D §12, §18).
 *
 *   ажилтан-шиг клиент (C-ийн `evaluation/lib/e2e.mjs`, хөтчийн orchestrator-ийн яг дараалал)
 *     → локал `wrangler dev` (prod-copy D1, ЭНЭ worktree-д хуулсан)
 *     → echo runtime (`helpers/echoRuntime.ts`, түр MGLAI_DATA_DIR, хөгжүүлэгчийн knowledge.sqlite)
 *     → /plan → /tool → /norm → /context → /generate (echo) → validator.ts гэрээ → /messages
 *
 * ⚠️ ЮУ ХЭМЖИХ / ЮУ ХЭМЖИХГҮЙ.  Хариултын ЧАНАР энд ХЭМЖИГДЭХГҮЙ (echo нь өгүүлбэр
 *    зохиодоггүй) — тэр нь A/C-ийн GOLD suite.  Энд: давхарга бүрийн ГЭРЭЭ + алдааны
 *    семантик (§18) төгсгөл хүртэл амьд үлдэж байгаа эсэх.
 *
 * ⚠️ ШААРДЛАГА (байхгүй бол тест бүхэлдээ `skip`, «давлаа» гэж бичигдэхгүй):
 *    • `backend/.dev.vars` (JWT_SECRET) — үндсэн tree-ээс хуулна (git-д ордоггүй)
 *    • prod-copy локал D1 — үндсэн tree-ийн `.wrangler/state/v3/d1/` хавтсыг ЭНЭ worktree рүү
 *      хуулна (үндсэн tree-ийн DB-д ХЭЗЭЭ Ч бичихгүй)
 *    • `A.Anand` / `admin123` (memory: локал dev нэвтрэлт)
 *    • wrangler dev ~10-20 с эхэлнэ → `--e2e` горимд л ажиллана
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO } from '../src/contracts/sources.ts';
import { startEchoRuntime, SECRET, type EchoRuntime } from './helpers/echoRuntime.ts';

const MAIN_TREE = process.env.MGL_AI_MAIN_TREE ?? 'C:/Users/User/project/mgl-e-c';
const BACKEND = join(REPO, 'backend');
const PORT = Number(process.env.MGL_AI_E2E_PORT ?? 3998);
/** `verify.mjs --e2e` нь backend-ийг ӨӨРӨӨ асаагаад энд дамжуулна; дангаар ажиллуулахад бид асаана. */
const EXTERNAL_API = process.env.MGL_AI_E2E_API ?? null;
const API = EXTERNAL_API ?? `http://127.0.0.1:${PORT}/api`;
const USER = process.env.MGLAI_EVAL_USER ?? 'A.Anand';
const PASS = process.env.MGLAI_EVAL_PASS ?? 'admin123';

let wrangler: ChildProcess | null = null;
let rt: EchoRuntime;
let client: { login: (u: string, p: string) => Promise<unknown>; turn: (...a: unknown[]) => Promise<E2ETurn>; api: (p: string, b?: unknown) => Promise<unknown> };
let ready = false;
let skipReason = '';

interface E2ETurn {
  plan: Record<string, unknown>;
  tools: unknown[];
  ctx: Record<string, unknown>;
  answer: string | null;
  contract: Record<string, unknown> | null;
  rec: Record<string, unknown>;
}

function prepareBackendState(): string | null {
  const devVars = join(BACKEND, '.dev.vars');
  if (!existsSync(devVars)) {
    const src = join(MAIN_TREE, 'backend', '.dev.vars');
    if (!existsSync(src)) return '.dev.vars алга (JWT_SECRET)';
    cpSync(src, devVars);
  }
  // ⚠️ `wrangler dev` нэг удаа ажилласан бол 4 KB хоосон sqlite үүсгэдэг — тэр нь
  //    «DB байна» гэсэн үг БИШ.  1 MB-ээс жижиг бол prod-copy-г ДЭЭР нь хуулна.
  const d1 = join(BACKEND, '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');
  const src = join(MAIN_TREE, 'backend', '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');
  const big = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.sqlite') && statSync(join(dir, f)).size > 1_000_000) : []);
  if (big(d1).length === 0) {
    const files = big(src);
    if (files.length === 0) return 'prod-copy локал D1 алга (үндсэн tree .wrangler/state/v3/d1)';
    mkdirSync(d1, { recursive: true });
    // Хамгийн сүүлд өөрчлөгдсөн том sqlite = амьд DB (miniflare нэрийг database_id-аас гаргадаг).
    const newest = files.sort((a, b) => statSync(join(src, b)).mtimeMs - statSync(join(src, a)).mtimeMs)[0]!;
    for (const suffix of ['', '-wal', '-shm']) {
      const f = join(src, newest + suffix);
      if (existsSync(f)) cpSync(f, join(d1, newest + suffix));
    }
  }
  return null;
}

async function waitFor(url: string, ms: number): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (r.status < 500) return true;
    } catch {
      /* хараахан */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

before(async () => {
  if (process.env.MGL_AI_E2E !== '1') {
    skipReason = 'MGL_AI_E2E=1 биш (verify --e2e тавьдаг)';
    return;
  }
  if (EXTERNAL_API === null) {
    const prep = prepareBackendState();
    if (prep) {
      skipReason = prep;
      return;
    }
  }
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  if (EXTERNAL_API === null) wrangler = spawn(npx, ['wrangler', 'dev', '--local', '--port', String(PORT), '--config', 'wrangler.toml'], {
    cwd: BACKEND,
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
  });
  const up = await waitFor(`${API}/landing/public`, 60_000);
  if (!up) {
    skipReason = 'wrangler dev 60 с-д эхэлсэнгүй';
    return;
  }
  rt = await startEchoRuntime();
  // Session C-ийн харнесс (.mjs, төрөлгүй) — динамик импорт, хэлбэрийг энд л зарлана.
  const e2e = (await import(String('../../evaluation/lib/e2e.mjs'))) as { createClient: (o: unknown) => typeof client };
  client = e2e.createClient({ api: API, rt: rt.base, gen: true, secret: SECRET, maxTokens: 200 });
  await client.login(USER, PASS);
  ready = true;
});

after(async () => {
  if (rt) await rt.close();
  if (wrangler?.pid) {
    if (process.platform === 'win32') {
      try {
        execSync(`taskkill /PID ${wrangler.pid} /T /F`, { stdio: 'ignore' });
      } catch {
        /* аль хэдийн унасан */
      }
    } else wrangler.kill('SIGTERM');
  }
});

const conv = `e2e_${Date.now().toString(36)}`;
const results: Record<string, unknown> = {};

function guard(t: { skip: (r?: string) => void }): boolean {
  if (!ready) {
    t.skip(skipReason || 'E2E орчин бэлэн биш');
    return false;
  }
  return true;
}

test('E2E · ерөнхий (мэндчилгээ): plan → context → echo generate → гэрээ', async (t) => {
  if (!guard(t)) return;
  const r = await client.turn(conv, 'Сайн байна уу?', [], null, 1);
  results.general = { intent: r.plan.intent, mode: r.contract?.answerMode, engine: r.rec.stop };
  assert.equal(typeof r.plan.intent, 'string');
  assert.ok(Array.isArray(r.ctx.turns) && (r.ctx.turns as unknown[]).length >= 2, '/context.turns');
  assert.equal(r.ctx.show_confidence, false, 'мэндчилгээнд итгэлийн шошго ГАРАХГҮЙ');
  assert.ok(typeof r.answer === 'string' && r.answer.length > 0, 'echo хариулт');
  // Echo ӨӨРИЙГӨӨ нэрлэнэ — хуурамч AI биш.
  assert.match(r.answer!, /суугаагүй|echo|хэлний загвар/i);
});

test('E2E · компанийн өгөгдөл: ERP хэрэгсэл ажиллаж, тоо нь гэрээнд орно', async (t) => {
  if (!guard(t)) return;
  const r = await client.turn(conv, 'Идэвхтэй төслүүд хэд байна?', [], null, 2);
  results.company = { tools: r.tools.map((x) => (x as { tool: string }).tool), mode: r.contract?.answerMode };
  assert.ok(r.tools.length > 0, 'хамгийн багадаа нэг ERP хэрэгсэл дуудагдана');
  assert.ok((r.tools as { ok: boolean }[]).some((x) => x.ok), 'хэрэгслийн нэг нь амжилттай');
  assert.ok(r.contract, 'trusted_contract бичигдсэн');
  const facts = (r.contract!.facts as unknown[]) ?? [];
  // ⚠️ ХЭМЖСЭН (2026-09-11, main@0df71a1): `query_entities` ажилласан ч гэрээ `free`, facts=0 —
  //    зохиомол компанийн тоо validator-оор өнгөрнө.  Session C `groundingGuard.ts` яг үүнийг
  //    засаж байна; merge хийгдтэл энэ шалгалт УНАНА (E2E хаалга fail-closed, эзэн C).
  assert.ok(
    r.contract!.answerMode !== 'free' || facts.length > 0,
    `ERP хэрэгсэл ажилласан ч гэрээ '${String(r.contract!.answerMode)}' facts=${facts.length} — зохиомол тоо шүүгдэхгүй (эзэн C: groundingGuard)`,
  );
});

test('E2E · норм: локал /norm → /context.local_norm, эшлэл СЕРВЕР дээр дахин шийдэгдэнэ', async (t) => {
  if (!guard(t)) return;
  if (!rt.knowledgeCopied) return t.skip('knowledge.sqlite алга — нормын хөл шалгагдахгүй');
  const r = await client.turn(conv, 'Барилгын захиалагчийн үүрэг юу вэ?', [], null, 3);
  results.norm = { regulatory: r.plan.regulatory, local_norm: r.ctx.local_norm, mode: r.contract?.answerMode };
  assert.equal(r.plan.regulatory, true, '/plan норм гэж таньсан');
  const ln = r.ctx.local_norm as { used_as_evidence: boolean; status: string } | null;
  assert.ok(ln, '/context.local_norm бөглөгдсөн — локал заалт серверт хүрсэн');
  assert.ok(['verified', 'supported', 'uncertain', 'insufficient_evidence'].includes(ln!.status));
  // Хадгалах → эшлэл сервер дээр дахин шийдэгдэнэ (orchestrator-ийн адил яриаг ЭХЛЭЭД үүсгэнэ)
  await client.api('/mgl-ai/conversations', { conv_uid: conv, surface: 'web', title: 'e2e' });
  const saved = (await client.api('/mgl-ai/messages', {
    conv_uid: conv,
    msg_uid: `m_${Date.now().toString(36)}`,
    role: 'assistant',
    content: r.answer ?? '',
    seq: 3,
    evidence: r.ctx.evidence,
    regulatory: true,
    runtime_variant: 'echo',
    stop_reason: 'stop',
  })) as { msg_uid: string; citations: unknown[]; confidence: string | null; dropped_citations: unknown };
  assert.equal(typeof saved.msg_uid, 'string');
  assert.ok(Array.isArray(saved.citations));
});

test('E2E · §18 — runtime unreachable/not_installed → «хайлт амжаагүй» (norm_unavailable), «олдсонгүй» refusal БИШ', async (t) => {
  if (!guard(t)) return;
  // Хөтчийн orchestrator-ийн ЯГ гэрээ (Session A P0-14): runtime суугаагүй бол `norm_answer: null` +
  // `norm_retrieval: { attempted: true, reason: 'runtime_down' }` (not_installed / timeout / offline / error ч мөн).
  const ask = async (normRetrieval: unknown) =>
    (await client.api('/mgl-ai/context', {
      conv_uid: conv,
      question: 'Барилгын захиалагчийн үүрэг юу вэ?',
      history: [],
      conv_state: null,
      seq: 4,
      tool_results: [],
      norm_answer: null,
      norm_retrieval: normRetrieval,
    })) as {
      trusted_contract?: { noMatch: boolean; answerMode: string };
      answer_contract?: { kind: string; requiredSentence?: string | null };
      local_norm: unknown;
      evidence: unknown[];
    };

  const down = await ask({ attempted: true, reason: 'runtime_down' });
  results.offlineNorm = { kind: down.answer_contract?.kind, noMatch: down.trusted_contract?.noMatch, mode: down.trusted_contract?.answerMode, evidence: down.evidence.length };
  t.diagnostic(`runtime_down → answer_contract.kind=${down.answer_contract?.kind} noMatch=${down.trusted_contract?.noMatch} mode=${down.trusted_contract?.answerMode}`);
  // ⚠️ 2026-09-11-д хэмжсэн цоорхой: wire шалтгаан тээдэггүй тул refusal («эх сурвалж олдсонгүй») болдог байв.
  //    Session A final (norm_retrieval + `norm_unavailable` гэрээ) зассан — энэ шалгалт түүнийг БАРИНА.
  assert.equal(down.answer_contract?.kind, 'norm_unavailable', '§18: хайлт унасан ≠ олдсонгүй — answer_contract.kind нь norm_unavailable байх ёстой');
  assert.notEqual(down.trusted_contract?.noMatch, true, '§18: runtime_down үед noMatch=true болж «олдсонгүй» гэж ХУДАЛ хэлж байна');

  // ⚠️ `norm_retrieval`-гүй хуучин клиент → сервер `not_asked` гэж үзнэ (хайлт ОРОЛДООГҮЙ) → нотолгоогүй
  //    норм асуулт refusal болно — тэр нь ЗӨВ (сервер шалтгаан мэдэхгүй).  Тиймээс гэрээ: хөтөч
  //    `norm_retrieval`-ыг ҮРГЭЛЖ илгээнэ (orchestrator.ts ингэдэг; `drift` тест барих ёстой).
  const legacy = await ask(undefined);
  t.diagnostic(`norm_retrieval алга → answer_contract.kind=${legacy.answer_contract?.kind} (not_asked семантик)`);
});

test('E2E · үргэлжлэл (follow-up): conv_state дамжиж, сервер ээлжийг тайлна', async (t) => {
  if (!guard(t)) return;
  const first = await client.turn(conv, 'Хамгийн ойрын deadline-тай төсөл аль нь вэ?', [], null, 5);
  const state = first.ctx.conv_state_next ?? null;
  const second = await client.turn(conv, 'Тэр төсөл яагаад удаад байна?', [{ role: 'user', content: 'Хамгийн ойрын deadline-тай төсөл аль нь вэ?' }, { role: 'assistant', content: first.answer ?? '' }], state, 6);
  results.followUp = { first: (first.ctx.turn as { kind?: string })?.kind, second: (second.ctx.turn as { kind?: string })?.kind };
  const kind = (second.ctx.turn as { kind?: string } | undefined)?.kind;
  assert.ok(kind && kind !== 'NEW_TOPIC', `2 дахь ээлж үргэлжлэл байх ёстой, гарсан: ${kind}`);
});

test('E2E · тайлан бичих', (t) => {
  if (!ready) return t.skip(skipReason);
  const out = join(REPO, 'ai', 'integration', 'reports', 'e2e-smoke.json');
  writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), api: API, runtime: 'echo', results }, null, 2), 'utf8');
  t.diagnostic(out);
});
