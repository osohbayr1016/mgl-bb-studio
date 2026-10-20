/**
 * `lib/asrSafety.ts`-ийн цэвэр дүрмийн тест — биеийн шалгалт, баталгааны
 * хүчинтэй байдал, бичвэрийн hash.  D1 ба route энд оролцохгүй.
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

const {
  ASR_SAFETY_ACK_VALID_MS,
  ASR_SAFETY_CONTENT,
  ackProblem,
  asrSafetyContentHash,
  validateAckBody,
} = await import('./asrSafety.ts');

const CURRENT = { version: 'v-test', hash: 'h-test' };
const SIG = '/media/7-1700000000000-abcdef123456-signature-1234.png';

const goodBody = () => ({
  confirmed: true,
  signature_url: SIG,
  content_version: 'v-test',
  content_hash: 'h-test',
});

test('validateAckBody: зөв бие → ok, төсөлгүй', () => {
  const r = validateAckBody(goodBody(), 7, CURRENT);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.projectId, null);
    assert.equal(r.signatureUrl, SIG);
  }
});

test('validateAckBody: project_id тоо/мөр хоёулаа хүлээн авна', () => {
  const a = validateAckBody({ ...goodBody(), project_id: 30 }, 7, CURRENT);
  const b = validateAckBody({ ...goodBody(), project_id: '30' }, 7, CURRENT);
  assert.equal(a.ok && a.projectId, 30);
  assert.equal(b.ok && b.projectId, 30);
  const c = validateAckBody({ ...goodBody(), project_id: 'x' }, 7, CURRENT);
  assert.equal(c.ok, false);
  if (!c.ok) assert.equal(c.code, 'BAD_PROJECT');
});

test('validateAckBody: чагт ЯГ true байх ёстой', () => {
  for (const confirmed of [undefined, false, 'true', 1]) {
    const r = validateAckBody({ ...goodBody(), confirmed }, 7, CURRENT);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, 'NOT_CONFIRMED');
  }
});

test('validateAckBody: гарын үсэг заавал, нэг сегмент /media/', () => {
  for (const signature_url of [undefined, '', 'https://x/y.png', '/media/a/b.png', '/media/7%2Fx.png']) {
    const r = validateAckBody({ ...goodBody(), signature_url }, 7, CURRENT);
    assert.equal(r.ok, false, String(signature_url));
    if (!r.ok) assert.equal(r.code, 'SIGNATURE_REQUIRED');
  }
});

test('validateAckBody: өөр хэрэглэгчийн upload-ыг гарын үсэг болгохгүй', () => {
  const r = validateAckBody(goodBody(), 8, CURRENT);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'SIGNATURE_NOT_OWNED');
  // `7-` угтвар нь `77-`-г хамарч болохгүй
  const r2 = validateAckBody({ ...goodBody(), signature_url: '/media/77-1-a-s.png' }, 7, CURRENT);
  assert.equal(r2.ok, false);
});

test('validateAckBody: хуучирсан хувилбар/hash → 409 STALE_CONTENT', () => {
  const a = validateAckBody({ ...goodBody(), content_version: 'old' }, 7, CURRENT);
  const b = validateAckBody({ ...goodBody(), content_hash: 'old' }, 7, CURRENT);
  for (const r of [a, b]) {
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.status, 409);
      assert.equal(r.code, 'STALE_CONTENT');
    }
  }
});

test('ackProblem: хүчинтэй баталгаа → null', () => {
  const now = Date.parse('2026-09-21T03:00:00Z');
  const row = {
    id: 1,
    user_id: 7,
    project_id: null,
    acknowledged_at: '2026-09-21T02:30:00Z',
    report_id: null,
  };
  assert.equal(ackProblem(row, { userSub: 7, projectId: 30, nowMs: now }), null);
  // Төсөлтэй зурсан баталгаа тэр төсөлд OK
  assert.equal(ackProblem({ ...row, project_id: 30 }, { userSub: 7, projectId: 30, nowMs: now }), null);
});

test('ackProblem: хаах шалтгаанууд', () => {
  const now = Date.parse('2026-09-21T03:00:00Z');
  const row = {
    id: 1,
    user_id: 7,
    project_id: null,
    acknowledged_at: '2026-09-21T02:30:00Z',
    report_id: null,
  };
  assert.equal(ackProblem(null, { userSub: 7, projectId: 30, nowMs: now }), 'missing');
  assert.equal(ackProblem({ ...row, user_id: 8 }, { userSub: 7, projectId: 30, nowMs: now }), 'other_user');
  assert.equal(ackProblem({ ...row, report_id: 99 }, { userSub: 7, projectId: 30, nowMs: now }), 'already_used');
  assert.equal(ackProblem({ ...row, project_id: 31 }, { userSub: 7, projectId: 30, nowMs: now }), 'other_project');
  assert.equal(
    ackProblem(row, { userSub: 7, projectId: 30, nowMs: now + ASR_SAFETY_ACK_VALID_MS + 1 }),
    'expired',
  );
  assert.equal(
    ackProblem({ ...row, acknowledged_at: '2026-09-21T04:00:00Z' }, { userSub: 7, projectId: 30, nowMs: now }),
    'future',
  );
  assert.equal(ackProblem({ ...row, acknowledged_at: 'garbage' }, { userSub: 7, projectId: 30, nowMs: now }), 'bad_timestamp');
});

test('asrSafetyContentHash: детерминист, бичвэр өөрчлөгдвөл өөр', async () => {
  const h1 = await asrSafetyContentHash(ASR_SAFETY_CONTENT);
  const h2 = await asrSafetyContentHash({ ...ASR_SAFETY_CONTENT });
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
  const changed = await asrSafetyContentHash({
    ...ASR_SAFETY_CONTENT,
    sections: [{ heading: 'x', items: ['y'] }],
  });
  assert.notEqual(h1, changed);
  // `intro`/`placeholder` нь hash-д ОРОХГҮЙ — зөвшөөрсөн шаардлагын хэсэг биш
  const meta = await asrSafetyContentHash({ ...ASR_SAFETY_CONTENT, intro: 'other', placeholder: false });
  assert.equal(h1, meta);
});

test('ASR_SAFETY_CONTENT: бүтэц бүрэн', () => {
  assert.ok(ASR_SAFETY_CONTENT.version);
  assert.ok(ASR_SAFETY_CONTENT.title);
  assert.ok(ASR_SAFETY_CONTENT.sections.length >= 1);
  for (const s of ASR_SAFETY_CONTENT.sections) {
    assert.ok(s.heading);
    assert.ok(s.items.length >= 1);
  }
  assert.ok(ASR_SAFETY_CONTENT.confirmText);
});
