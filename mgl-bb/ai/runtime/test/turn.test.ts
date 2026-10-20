/**
 * `POST /turn` — ажилтны PC-ийн runtime дээрх хуваалцсан ээлж (Session R, Phase 5).
 *
 * Гурван хуурамч сервер: Worker (plan/context/messages/conversations), «өөрөө»
 * (/norm 503, /generate SSE), ба `handleTurn`-ийг хостлох жижиг http сервер.
 * Шалгах: (1) Revit-ийн `revit_context` + `surface` Worker-т ЯГ хүрнэ, (2) SSE
 * урсгал `ai` үйл явдлууд + төгсгөлийн `result`, (3) ERP токен байхгүй → 401,
 * (4) хоосон асуулт → 400, (5) `erp_token` нь Bearer болж явна, хариуд ГАРАХГҮЙ.
 *
 *   node --test runtime/test/turn.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { handleTurn, parseTurnBody, publicResult } from '../src/turn.ts';

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return chunks.length ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>) : {};
}

function listen(s: Server): Promise<string> {
  return new Promise((resolve) => s.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(s.address() as AddressInfo).port}`)));
}

async function harness() {
  const seen: { path: string; auth: string | undefined; body: Record<string, unknown> }[] = [];
  const worker = createServer(async (req, res) => {
    const body = await readJson(req);
    seen.push({ path: req.url ?? '', auth: req.headers.authorization, body });
    const reply = (o: unknown) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url === '/api/mgl-ai/plan') return reply({ intent: 'general', regulatory: false, detected_language: 'mn-Cyrl', tools: [], done: true, memory_hints: [] });
    if (req.url === '/api/mgl-ai/context')
      return reply({
        conv_uid: body.conv_uid, turns: [{ role: 'system', content: 'sys' }, { role: 'user', content: body.question }], tools: [], evidence: [],
        regulatory: false, response_language: 'mn-Cyrl', detected_language: 'mn-Cyrl', language_explicit: false, intent: 'general',
        intent_reason: 't', evidence_required: false, show_confidence: false, verification_states: [], filtered_out: { count: 0 },
      });
    return reply({ ok: true, citations: [], confidence: null });
  });
  const self = createServer(async (req, res) => {
    await readJson(req);
    if (req.url === '/norm') { res.writeHead(503, { 'Content-Type': 'application/json' }); return res.end('{"error":"not installed"}'); }
    if (req.url === '/generate') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('event: start\ndata: {"engine":{"engine":"fake"}}\n\n');
      res.write('event: token\ndata: {"text":"Хана "}\n\n');
      res.write('event: token\ndata: {"text":"200 мм."}\n\n');
      res.write('event: done\ndata: {"stop_reason":"stop","first_token_ms":3,"total_ms":9,"engine":"fake","runtime_variant":"test","usage":{"promptTokens":1,"completionTokens":2}}\n\n');
      return res.end();
    }
    res.writeHead(404); res.end();
  });
  const workerUrl = await listen(worker);
  const selfUrl = await listen(self);
  let paired: string | null = null;
  const host = createServer(async (req, res) => {
    const body = await readJson(req);
    await handleTurn(req, res, body, {
      controlPlaneUrl: workerUrl,
      selfUrl,
      secret: 's3cret',
      pairedToken: async () => paired,
      runtimeInfo: async () => ({ active_model: 'fake' }),
    });
  });
  const hostUrl = await listen(host);
  return { seen, hostUrl, setPaired: (t: string | null) => { paired = t; }, close: () => { worker.close(); self.close(); host.close(); } };
}

function parseSse(text: string): { event: string; data: Record<string, unknown> }[] {
  const out: { event: string; data: Record<string, unknown> }[] = [];
  for (const frame of text.split('\n\n')) {
    let event = 'message'; let data = '';
    for (const line of frame.split('\n')) { if (line.startsWith('event:')) event = line.slice(6).trim(); else if (line.startsWith('data:')) data += line.slice(5).trim(); }
    if (data) out.push({ event, data: JSON.parse(data) as Record<string, unknown> });
  }
  return out;
}

test('/turn: Revit surface streams ai events and a result; revit_context reaches the Worker; token is Bearer only', async () => {
  const h = await harness();
  try {
    const revit = { docTitle: 'MGL-AI-TEST', docUid: 'k', selection: [{ id: '2786', category: 'Walls' }] };
    const res = await fetch(`${h.hostUrl}/turn`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Энэ хана хэдэн мм вэ?', conv_uid: 'revit-1', seq: 1, surface: 'revit', revit_context: revit, erp_token: 'x'.repeat(40) }),
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
    const frames = parseSse(await res.text());
    const result = frames.find((f) => f.event === 'result');
    assert.ok(result, 'result frame');
    assert.equal(result!.data.answer, 'Хана 200 мм.');
    assert.equal(result!.data.error, null);
    assert.ok(!('cache' in result!.data), 'cache is never sent');
    assert.ok(frames.some((f) => f.event === 'ai' && f.data.type === 'request.accepted'));
    const ctx = h.seen.find((s) => s.path === '/api/mgl-ai/context')!;
    assert.deepEqual(ctx.body.revit_context, revit);
    assert.equal(ctx.auth, 'Bearer ' + 'x'.repeat(40));
    const conv = h.seen.find((s) => s.path === '/api/mgl-ai/conversations')!;
    assert.equal(conv.body.surface, 'revit');
    assert.ok(!JSON.stringify(frames).includes('x'.repeat(40)), 'erp token never echoed');
  } finally { h.close(); }
});

test('/turn: no erp_token and not paired → 401; paired token is used when caller sends none', async () => {
  const h = await harness();
  try {
    const r1 = await fetch(`${h.hostUrl}/turn`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'q', conv_uid: 'c' }) });
    assert.equal(r1.status, 401);
    h.setPaired('p'.repeat(40));
    const r2 = await fetch(`${h.hostUrl}/turn`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'q', conv_uid: 'c' }) });
    assert.equal(r2.status, 200);
    await r2.text();
    assert.equal(h.seen.find((s) => s.path === '/api/mgl-ai/plan')!.auth, 'Bearer ' + 'p'.repeat(40));
  } finally { h.close(); }
});

test('/turn: bad body → 400', async () => {
  const h = await harness();
  try {
    const r = await fetch(`${h.hostUrl}/turn`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conv_uid: 'c' }) });
    assert.equal(r.status, 400);
  } finally { h.close(); }
});

test('parseTurnBody: defaults, limits, surface whitelist', () => {
  const p = parseTurnBody({ question: ' x ', surface: 'bogus', history: [{ role: 'user', content: 'a' }, { role: 'nope', content: 'b' }], seq: 3.7 });
  assert.ok(p.ok);
  if (p.ok) {
    assert.equal(p.body.surface, 'web');
    assert.equal(p.body.history!.length, 1);
    assert.equal(p.body.seq, 3);
    assert.ok(p.body.conv_uid.startsWith('conv_'));
  }
  assert.equal(parseTurnBody({ question: 'a'.repeat(5000) }).ok, false);
  assert.equal(publicResult({ answer: 'a', cache: { plan: {} } } as never).answer, 'a');
  assert.ok(!('cache' in publicResult({ answer: 'a', cache: {} } as never)));
});
