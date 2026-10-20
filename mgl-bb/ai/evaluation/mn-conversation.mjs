#!/usr/bin/env node
/**
 * MGL AI · МОНГОЛ ЯРИАНЫ ДАВХАРГЫН ШАЛГАЛТ (§17).
 *
 * `npm run ai:eval:mn`               — одоогийн бүтэн хоолойг шалгана
 * `npm run ai:eval:mn -- --ab`       — ХУУЧИН ба ШИНЭ prompt-ыг A/B хийнэ
 *
 * ⚠️ ЭНЭ НЬ ЗАГВАРЫГ БИШ, ХООЛОЙГ шалгана.  Qwen3 нь монголоор төгс
 *    бичихгүй (тэр нь fine-tune-ийн ажил).  Энд шалгаж байгаа зүйл нь:
 *      · латин монгол → КИРИЛЛ хариу
 *      · англи асуулт → АНГЛИ хариу
 *      · мэндчилгээ/мета → нотолгооны сэрэмжлүүлэг ГАРАХГҮЙ
 *      · норм → баталгаажсан эх сурвалж ШААРДАНА
 *      · компанийн баримт → ERP хэрэгсэл ДУУДНА
 *      · `&#x20;`, `svg` зэрэг тээврийн гажиг ГАРАХГҮЙ
 *
 * ⚠️ ЛОКАЛ RUNTIME + WORKER ХОЁУЛАА АЖИЛЛАЖ БАЙХ ЁСТОЙ.
 *      npm run ai:start                    (ai/)
 *      npx wrangler dev --port 3000        (backend/)
 */
import { readFileSync } from 'node:fs';

const WORKER = process.env.MGLAI_WORKER ?? 'http://127.0.0.1:3000/api/mgl-ai';
const RUNTIME = process.env.MGLAI_RUNTIME ?? 'http://127.0.0.1:39217';
const ORIGIN = 'https://mgl-design-system.pages.dev';
const TOKEN = process.env.MGLAI_TOKEN ?? readFileSync(process.env.TOKEN_FILE ?? '/dev/null', 'utf8').trim();
const AB = process.argv.includes('--ab');

/* ── Шалгах багц (§17-ийн найман оролт) ───────────────────────────── */

const CASES = [
  {
    id: 1,
    q: 'chi ymar asuultand hariulj chadah ve',
    expectLang: 'mn-Cyrl',
    expectIntent: 'META',
    noEvidenceWarning: true,
  },
  {
    id: 2,
    q: 'mongoloor hariulaarai',
    expectLang: 'mn-Cyrl',
    noEvidenceWarning: true,
  },
  {
    id: 3,
    q: 'ene project yagaad udaad bna',
    expectLang: 'mn-Cyrl',
    expectIntent: 'ERP_ANALYSIS',
  },
  {
    id: 4,
    q: 'Revit deer songoson wall yu bna',
    expectLang: 'mn-Cyrl',
    expectIntent: 'REVIT_READ',
  },
  {
    id: 5,
    q: 'g=1800 MJ/m2 bol V2 yu V3 yu',
    expectLang: 'mn-Cyrl',
    expectIntent: 'NORMATIVE',
    requiresEvidence: true,
  },
  {
    id: 6,
    q: 'What can you do?',
    expectLang: 'en',
    expectIntent: 'META',
    noEvidenceWarning: true,
  },
  {
    id: 7,
    q: 'ene task deadline hezee ve',
    expectLang: 'mn-Cyrl',
    expectErpTools: true,
  },
  {
    id: 8,
    q: 'manai company heden ajiltantai ve',
    expectLang: 'mn-Cyrl',
    expectErpTools: true,
  },
];

/* ── Туслахууд ────────────────────────────────────────────────────── */

const TECH =
  /\b(?:revit|view|family|type|parameter|deadline|task|project|erp|server|api|model|ai|gpu|sheet|schedule|wall|area|mj|m2)\b/gi;

function mnRatio(text) {
  const stripped = text.replace(TECH, ' ');
  const letters = stripped.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return 1;
  return letters.filter((c) => /[Ѐ-ӿ]/.test(c)).length / letters.length;
}

async function ctxFor(q, toolResults = []) {
  const r = await fetch(`${WORKER}/context`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ conv_uid: 'conv_eval', question: q, history: [], tool_results: toolResults }),
  });
  if (!r.ok) throw new Error(`/context ${r.status}`);
  return r.json();
}

/** Асуулт нь ERP өгөгдөл шаардаж байвал хэрэгсэл дуудна. */
async function runTools(q, tools) {
  const avail = new Set((tools ?? []).map((t) => t.name));
  const lower = q.toLowerCase();
  const want = [];
  if (/project|төсөл|tusul|task|deadline/.test(lower) && avail.has('list_projects')) {
    want.push({ name: 'list_projects', args: { limit: 20 } });
  }
  if (/ajiltan|ажилтан|employee|company/.test(lower) && avail.has('get_active_employees')) {
    want.push({ name: 'get_active_employees', args: {} });
  }
  const out = [];
  for (const w of want) {
    const r = await fetch(`${WORKER}/tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ conv_uid: 'conv_eval', name: w.name, args: w.args }),
    });
    const j = await r.json().catch(() => ({}));
    out.push({ tool: w.name, ok: j.ok === true, data: j.data ?? null, error: j.error ?? null });
  }
  return out;
}

async function generate(turns, maxTokens = 220) {
  const res = await fetch(`${RUNTIME}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ turns, max_tokens: maxTokens }),
  });
  let text = '';
  let buf = '';
  for await (const chunk of res.body) {
    buf += Buffer.from(chunk).toString('utf8');
    const parts = buf.split('\n\n');
    buf = parts.pop() ?? '';
    for (const p of parts) {
      const line = p.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      try {
        const j = JSON.parse(line.slice(6));
        if (typeof j.text === 'string') text += j.text;
      } catch {
        /* start/done */
      }
    }
  }
  return text.trim();
}

/**
 * ХУУЧИН PROMPT — A/B харьцуулалтад (§17: «A/B test it against the
 * current prompt»).
 *
 * ⚠️ Энэ нь 2026-09-08-ны бодит заавар: хэлний тушаалгүй, санааны
 *    ангилалгүй, нотолгооны дүрэм нь БҮХ асуултад.
 */
const OLD_SYSTEM =
  'MGL AI 1.0\n\n' +
  'Чи бол «MGL AI» — Монголын архитектур, барилгын компанийн дотоод AI туслах.\n' +
  'Хэрэглэгч монголоор бичвэл МОНГОЛООР, англиар бичвэл англиар хариул.\n' +
  'ТОВЧ, ШУУД хариул.\n\n' +
  'Чи КОМПАНИЙН АЖИЛТАНТАЙ ярьж байна.\n\n' +
  'Норм, стандартын ТООН шаардлага (БНбД, БД, MNS) асуувал: зөвхөн доор өгсөн ' +
  'нотолгоонд тулгуурла, [1] гэж эшил, тоо ЗОХИОХГҮЙ. Бусад асуултад энэ дүрэм ' +
  'ХАМААРАХГҮЙ — хэвийн, тусламжтай хариул.';

/* ── Ажиллуулах ───────────────────────────────────────────────────── */

if (!TOKEN) {
  process.stderr.write('\n  ✖ MGLAI_TOKEN эсвэл TOKEN_FILE тохируулаагүй байна.\n\n');
  process.exit(1);
}

const session = await (
  await fetch(`${WORKER}/session`, { headers: { Authorization: `Bearer ${TOKEN}` } })
).json();

let pass = 0;
let fail = 0;
const failures = [];

process.stdout.write(`\nMGL AI · монгол ярианы шалгалт — ${CASES.length} тохиолдол\n`);
process.stdout.write(AB ? '  (A/B: хуучин prompt vs шинэ)\n' : '');
process.stdout.write('─'.repeat(72) + '\n');

for (const c of CASES) {
  const tools = await runTools(c.q, session.tools);
  const ctx = await ctxFor(c.q, tools);
  const answer = await generate(ctx.turns);

  const checks = [];
  const add = (name, ok, detail = '') => checks.push({ name, ok, detail });

  // 1. ХЭЛ — сервер зөв шийдсэн үү.
  add('хэлний чиглүүлэлт', ctx.response_language === c.expectLang,
    `${ctx.response_language} (хүлээсэн ${c.expectLang})`);

  // 2. ХАРИУЛТЫН хэл — загвар дагасан уу.
  const ratio = mnRatio(answer);
  if (c.expectLang === 'mn-Cyrl') {
    add('хариу КИРИЛЛЭЭР', ratio >= 0.5, `кирилл ${(ratio * 100).toFixed(0)}%`);
  } else {
    add('хариу АНГЛИАР', ratio < 0.5, `кирилл ${(ratio * 100).toFixed(0)}%`);
  }

  // 3. САНАА.
  if (c.expectIntent) {
    add('санааны ангилал', ctx.intent === c.expectIntent, `${ctx.intent}`);
  }

  // 4. Нотолгооны сэрэмжлүүлэг ГАРАХГҮЙ (§4).
  if (c.noEvidenceWarning) {
    add('шошго харуулахгүй', ctx.show_confidence === false, `show_confidence=${ctx.show_confidence}`);
    add('«нотолгоо» гэж хэлэхгүй',
      !/нотолгоо\s+хүрэлцэхгүй|баталгаажсан эх сурвалж олдсонгүй/i.test(answer));
  }

  // 5. Норм — нотолгоо ШААРДАНА.
  if (c.requiresEvidence) {
    add('нотолгоо шаардсан', ctx.evidence_required === true);
    // ⚠️ НОТОЛГООГҮЙ ҮЕД ЮУГ ШАЛГАХ ВЭ.  Эхний хувилбар нь «олдсонгүй»
    //    гэсэн ҮГ хайдаг байсан бөгөөд тэр нь хэтэрхий нарийн: загвар
    //    «V2, V3 нь тодорхой бус, стандартаар тодорхойлно» гэж ЗӨВ
    //    татгалзсан ч уначихдаг байв.
    //
    //    Бодит ЭРСДЭЛ нь «тодорхой ангиллыг БАТАЛЖ хэлэх».  Хуучин
    //    prompt яг тэрийг хийсэн: «V2 = 1800 MJ/m²  V3 = 1800 MJ/m²».
    //    Тиймээс ТОДОРХОЙЛОЛТЫН хэв маягийг хайна.
    if ((ctx.evidence?.length ?? 0) === 0) {
      const fabricated =
        /[ВVвv][1-4]\s*(?:=|нь)\s*\d/.test(answer) ||
        /[ВVвv][1-4]\s*ангилалд\s*(?:орно|багтана|хамаарна)/i.test(answer);
      add('ангиллыг ЗОХИОГООГҮЙ', !fabricated, 'нотолгоогүйгээр ангилал баталсан');

      // Мөн эх сурвалж хэрэгтэйг ЯМАР НЭГ хэлбэрээр илэрхийлэх ёстой.
      add(
        'эх сурвалж хэрэгтэйг хэлсэн',
        /олдсонгүй|алга|тодорхой\s*бус|стандарт|норм|шалга|хэрэгтэй|эх сурвалж/i.test(answer),
      );
    }
  }

  // 6. ERP хэрэгсэл.
  if (c.expectErpTools) {
    add('ERP хэрэгсэл дуудсан', tools.length > 0, `${tools.length} хэрэгсэл`);
  }

  // 7. Тээврийн гажиг ГАРАХГҮЙ (§13).
  add('`&#x20;` алга', !/&#x?[0-9a-f]+;/i.test(answer));
  // Түүхий SVG ТЭМДЭГ (<svg …>) хариултад орохгүй — «svgҮсэг» гэсэн хуулбарын гажиг нь
  // UI-ийн DOM-ын асуудал (frontend/scripts/check-ai-ui-leak.mjs), загварын текстийнх биш.
  add('түүхий SVG тэмдэг гоожоогүй', !/<\/?svg/i.test(answer));
  add('escape гоожоогүй', !/\\\*\\\*/.test(answer));

  const bad = checks.filter((x) => !x.ok);
  if (bad.length === 0) pass += 1;
  else {
    fail += 1;
    failures.push({ id: c.id, q: c.q, bad });
  }

  process.stdout.write(
    `\n${bad.length === 0 ? '✅' : '❌'} ${c.id}. ${c.q}\n` +
      `   ${ctx.intent} · ${ctx.response_language} · нотолгоо ${ctx.evidence?.length ?? 0} · хэрэгсэл ${tools.length}\n` +
      `   💬 ${answer.replace(/\n+/g, ' ').slice(0, 150)}\n`,
  );
  for (const b of bad) process.stdout.write(`   ⚠️  ${b.name}${b.detail ? ` — ${b.detail}` : ''}\n`);

  // ── A/B: ижил асуултыг ХУУЧИН prompt-оор ─────────────────────────
  if (AB) {
    const oldAnswer = await generate([
      { role: 'system', content: OLD_SYSTEM },
      { role: 'user', content: c.q },
    ]);
    const oldRatio = mnRatio(oldAnswer);
    const oldOk = c.expectLang === 'mn-Cyrl' ? oldRatio >= 0.5 : oldRatio < 0.5;
    process.stdout.write(
      `   ── ХУУЧИН prompt: ${oldOk ? '✔' : '✖'} кирилл ${(oldRatio * 100).toFixed(0)}%  ` +
        `«${oldAnswer.replace(/\n+/g, ' ').slice(0, 90)}»\n`,
    );
  }
}

process.stdout.write(`\n${'─'.repeat(72)}\n`);
process.stdout.write(`  ${pass}/${CASES.length} тохиолдол өнгөрөв\n`);
if (failures.length > 0) {
  process.stdout.write('\n  УНАСАН:\n');
  for (const f of failures) {
    process.stdout.write(`    ${f.id}. ${f.q}\n`);
    for (const b of f.bad) process.stdout.write(`       · ${b.name}${b.detail ? ` — ${b.detail}` : ''}\n`);
  }
}
process.stdout.write('\n');
process.exitCode = fail > 0 ? 1 : 0;
