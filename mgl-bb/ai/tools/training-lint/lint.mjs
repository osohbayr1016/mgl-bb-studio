#!/usr/bin/env node
/**
 * MGL AI · TRAINING-DATA LINTER + TRAIN/EVAL LEAKAGE REPORT (Session C, 2026-09-11).
 *
 *   node ai/tools/training-lint/lint.mjs [--sft <file|dir> ...] [--eval <file|dir> ...] [--json out.json] [--strict]
 *
 * Өгөгдмөл:
 *   --sft   ai/training/out/behavior-sft-<split>.jsonl + ai/data-train-files/<pkg>/{domain_sft_verified,sft_seed}.jsonl
 *   --eval  ai/evaluation/heldout-cases.json + ai/data-train-files/<pkg>/{qa_retrieval_tests,source_citation_tests,calculation_cases}.jsonl
 *
 * ⚠️ ЮУ Ч УСТГАДАГГҮЙ, ЗАСДАГГҮЙ — зөвхөн хяналтын олдвор (мандат §25).  `dataset_lint.py`
 *    (динамик тоо, §35) -тай ДАВХАРДАХГҮЙ: энд бүтэц, давхардал, зөрчил, PII/нууц, хэлний
 *    метадата, ангийн тэнцвэр, эх сурвалжгүй нормын хариулт, train/eval гоожилт (§26).
 *
 * Олдворын кодууд: INVALID_JSONL · NO_MESSAGES · BAD_ROLE_ORDER · EMPTY_ANSWER · EMPTY_QUESTION ·
 *   EXACT_DUPLICATE · NEAR_DUPLICATE · CONTRADICTORY_TARGET · PII_EMAIL · PII_PHONE · SECRET_PATTERN ·
 *   SENTINEL_SECRET · LANGUAGE_MISMATCH · NORM_ANSWER_WITHOUT_SOURCE · UNGROUNDED_NUMBER ·
 *   CLASS_IMBALANCE · TINY_CLASS · EVAL_LEAK_EXACT · EVAL_LEAK_FUZZY
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const args = process.argv.slice(2);
const multi = (name) => {
  const out = [];
  for (let i = 0; i < args.length; i++) if (args[i] === name && args[i + 1]) out.push(args[++i]);
  return out;
};
const opt = (name, def = null) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? true) : def;
};
const STRICT = args.includes('--strict');
const JSON_OUT = opt('--json');
const DATA = path.join(REPO, 'ai', 'data-train-files');

function expand(inputs, patterns) {
  const files = [];
  for (const inp of inputs) {
    const p = path.resolve(inp);
    if (!fs.existsSync(p)) continue;
    if (fs.statSync(p).isDirectory()) {
      for (const f of fs.readdirSync(p)) if (patterns.some((re) => re.test(f))) files.push(path.join(p, f));
      for (const d of fs.readdirSync(p)) {
        const sub = path.join(p, d);
        if (fs.statSync(sub).isDirectory()) for (const f of fs.readdirSync(sub)) if (patterns.some((re) => re.test(f))) files.push(path.join(sub, f));
      }
    } else files.push(p);
  }
  return [...new Set(files)];
}

const sftInputs = multi('--sft');
const evalInputs = multi('--eval');
// Хавтас өгсөн ч SFT/үнэлгээний НЭРИЙН хэв маягаар л шүүнэ — багцын бусад JSONL (заалт,
// дүрэм) нь сургалтын мөр биш.  Тодорхой ФАЙЛ өгвөл шууд авна.
const SFT_PATTERNS = [/^behavior-sft-.*\.jsonl$/, /^domain_sft_verified\.jsonl$/, /^sft_seed\.jsonl$/];
const EVAL_PATTERNS = [/^qa_retrieval_tests\.jsonl$/, /^source_citation_tests\.jsonl$/, /^calculation_cases\.jsonl$/, /^heldout-cases\.json$/, /^latin-aec-roast\.json$/];
const SFT_FILES = expand(sftInputs.length ? sftInputs : [path.join(REPO, 'ai', 'training', 'out'), DATA], SFT_PATTERNS);
const EVAL_FILES = [
  ...(evalInputs.length ? [] : [path.join(REPO, 'ai', 'evaluation', 'heldout-cases.json'), path.join(REPO, 'ai', 'evaluation', 'latin-aec-roast.json')]),
  ...expand(evalInputs.length ? evalInputs : [DATA], EVAL_PATTERNS),
].filter((f) => fs.existsSync(f));

/* ── туслахууд ────────────────────────────────────────────────────── */
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const tokens = (s) => new Set(norm(s).split(' ').filter((t) => t.length > 1));
function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}
const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 16);
const isCyr = (s) => /[А-Яа-яӨөҮүЁё]/.test(s);
const cyrRatio = (s) => {
  const l = (s.match(/\p{L}/gu) ?? []).length;
  return l === 0 ? 0 : (s.match(/[А-Яа-яӨөҮүЁё]/g) ?? []).length / l;
};

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/u;
const PHONE = /(?<!\d)(?:\+976[\s-]?)?(?:[789]\d{7})(?!\d)/u;
const SECRET = /(?:sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|Bearer\s+[A-Za-z0-9._-]{20,}|password\s*[:=]\s*\S{4,}|нууц үг\s*[:=]\s*\S{4,}|\b[a-f0-9]{40,}\b|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})/u;
const SENTINEL = /SECRET_TEST_TOKEN|FAKE_PASSWORD/u;
const NORM_CODE = /(?:БНбД|БД|УББ|СНиП|MNS|МНС|BNbD|BD|UBB)\s*(?:II-)?\d{2}-\d{2,3}-\d{2}/u;
const SOURCE_LINE = /эх сурвалж|source:|заалт\s*\d|хүснэгт\s*\d|х\.\s*\d|хуудас\s*\d|legalinfo\.mn|\[\d+\]/iu;
const ERP_WORDS = /(ажилтан|ажилтн|төсөл|төсл|даалгавар|даалгавр|project|employee|task|хоног үлдсэн|days_remaining|идэвхтэй)/iu;
const NUMBER = /(?<![\p{L}\d.])(\d{1,3}(?:[  ]\d{3})+|\d+(?:[.,]\d+)?)(?![\d])/gu;

/* ── ачаалах ──────────────────────────────────────────────────────── */
async function readJsonl(file, onBad) {
  const rows = [];
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  let n = 0;
  for await (const line of rl) {
    n += 1;
    if (!line.trim()) continue;
    try {
      rows.push({ line: n, row: JSON.parse(line) });
    } catch (err) {
      onBad?.(n, err);
    }
  }
  return rows;
}

const report = { generated_at: new Date().toISOString(), sft_files: SFT_FILES.map((f) => path.relative(REPO, f)), eval_files: EVAL_FILES.map((f) => path.relative(REPO, f)), findings: [], totals: { error: 0, warn: 0, info: 0 }, classes: {}, leakage: [] };
function finding(severity, code, file, message, extra = {}) {
  report.findings.push({ severity, code, file: path.relative(REPO, file), message, ...extra });
  report.totals[severity] += 1;
}

/* ── SFT мөрүүд ───────────────────────────────────────────────────── */
const examples = []; // {file,line,id,q,a,qTok,lang,cls}
const classCounts = {};
for (const file of SFT_FILES) {
  const rel = path.relative(REPO, file);
  const rows = await readJsonl(file, (n, err) => finding('error', 'INVALID_JSONL', file, `мөр ${n}: ${err.message.slice(0, 60)}`, { line: n }));
  const seenExact = new Map();
  const perFileQ = new Map(); // normQ → answers set
  for (const { line, row } of rows) {
    const msgs = Array.isArray(row?.messages) ? row.messages : null;
    if (!msgs) {
      finding('error', 'NO_MESSAGES', file, `мөр ${line}`, { line });
      continue;
    }
    const roles = msgs.map((m) => m?.role);
    const okOrder =
      roles.length >= 2 &&
      roles[roles.length - 1] === 'assistant' &&
      roles.every((r, i) => (i === 0 ? r === 'system' || r === 'user' : r === 'user' || r === 'assistant' || r === 'tool')) &&
      !roles.some((r, i) => i > 0 && r === roles[i - 1] && r !== 'tool');
    if (!okOrder) finding('error', 'BAD_ROLE_ORDER', file, `мөр ${line}: ${roles.join('→')}`, { line });
    const users = msgs.filter((m) => m?.role === 'user');
    const lastUser = users[users.length - 1];
    const answer = msgs[msgs.length - 1];
    const a = typeof answer?.content === 'string' ? answer.content : '';
    const qRaw = typeof lastUser?.content === 'string' ? lastUser.content : '';
    // serving-v2: хэрэглэгчийн ээлж нь хайрцаг + «Асуулт: …» — асуултыг л авна
    const qm = /Асуулт(?:ууд)?:\s*([\s\S]+)$/u.exec(qRaw);
    const q = (qm ? qm[1] : qRaw).trim();
    if (a.trim().length === 0) finding('error', 'EMPTY_ANSWER', file, `мөр ${line}`, { line });
    if (q.length === 0) finding('error', 'EMPTY_QUESTION', file, `мөр ${line}`, { line });

    // PII / нууц — БҮХ ээлжид
    const all = msgs.map((m) => String(m?.content ?? '')).join('\n');
    if (SENTINEL.test(all)) finding('error', 'SENTINEL_SECRET', file, `мөр ${line}: тестийн sentinel нууц сургалтын өгөгдөлд`, { line });
    if (SECRET.test(all)) finding('error', 'SECRET_PATTERN', file, `мөр ${line}: нууц/токен хэлбэрийн мөр`, { line });
    if (EMAIL.test(all)) finding('warn', 'PII_EMAIL', file, `мөр ${line}`, { line });
    if (PHONE.test(all)) finding('warn', 'PII_PHONE', file, `мөр ${line}`, { line });

    // хэлний метадата
    const declared = row.axes?.language ?? row.language ?? row.lang ?? null;
    if (declared) {
      const r = cyrRatio(q);
      const detected = r >= 0.3 ? 'mn-Cyrl' : /[a-z]/i.test(q) ? (r > 0 ? 'mixed' : 'latin') : 'unknown';
      const mismatch = (declared === 'mn-Cyrl' && detected === 'latin') || ((declared === 'mn-Latn' || declared === 'en') && detected === 'mn-Cyrl');
      const explicit = /in english|англиар|english|монголоор|mongoloor|in mongolian/iu.test(qRaw);
      if (mismatch) finding(explicit ? 'info' : 'warn', 'LANGUAGE_MISMATCH', file, `мөр ${line}: зарласан ${declared}, асуулт ${detected}${explicit ? ' (ил хэлний хүсэлттэй — хариултын хэл байж болно)' : ''}`, { line });
    }

    // эх сурвалжгүй нормын хариулт
    if (NORM_CODE.test(a) && !SOURCE_LINE.test(a) && !/<<<MGLAI-EVIDENCE>>>/.test(qRaw)) {
      finding('warn', 'NORM_ANSWER_WITHOUT_SOURCE', file, `мөр ${line}: нормын код дурдсан ч эшлэл/эх сурвалжийн мөргүй`, { line });
    }

    // хайрцагт байхгүй тоо (ERP үгтэй) — жинд шингэх динамик баримт
    const ctx = msgs.slice(0, -1).map((m) => String(m?.content ?? '')).join('\n');
    const ctxNums = new Set([...ctx.matchAll(NUMBER)].map((m) => m[1].replace(/[  ]/g, '').replace(',', '.')));
    // Жагсаалтын дугаар «1)», «2.», хувь «100%», «3-р» — тоо биш; ≤3 нь бараг үргэлж тоолол/жагсаалт.
    const ANSWER_NUMBER = /(?<![\p{L}\d.])(\d{1,3}(?:[  ]\d{3})+|\d+(?:[.,]\d+)?)(?![\d)]|\.|%|\s*хувь|-р|-н)/gu;
    const ansNums = [...a.matchAll(ANSWER_NUMBER)].map((m) => m[1].replace(/[  ]/g, '').replace(',', '.'));
    const ungrounded = ansNums.filter((n) => !ctxNums.has(n) && Number(n) > 3);
    if (ungrounded.length > 0 && ERP_WORDS.test(a) && !NORM_CODE.test(a)) {
      finding('warn', 'UNGROUNDED_NUMBER', file, `мөр ${line}: хариултын тоо [${[...new Set(ungrounded)].slice(0, 4).join(',')}] контекстод байхгүй`, { line });
    }

    const cls = row.key ?? row.intent ?? row.axes?.grounding ?? row.category ?? 'unknown';
    classCounts[cls] = (classCounts[cls] ?? 0) + 1;
    const key = hash(`${norm(qRaw)}|${norm(a)}`);
    if (seenExact.has(key)) finding('warn', 'EXACT_DUPLICATE', file, `мөр ${line} ≡ мөр ${seenExact.get(key)}`, { line });
    else seenExact.set(key, line);
    // ⚠️ Зөрчлийг БҮТЭН хэрэглэгчийн ээлжээр (хайрцаг + асуулт) тулгана — serving-v2
    //    жишээнд ижил асуулт өөр хэрэгслийн утгатай ирдэг тул хариулт ЗОРИУД өөр.
    const nq = norm(qRaw);
    if (nq.length > 0) {
      const set = perFileQ.get(nq) ?? new Set();
      set.add(norm(a).slice(0, 400));
      perFileQ.set(nq, set);
    }
    examples.push({ file, line, id: row.id ?? null, q, a, qTok: tokens(q), cls });
  }
  for (const [nq, answers] of perFileQ) if (answers.size > 1) finding('warn', 'CONTRADICTORY_TARGET', file, `«${nq.slice(0, 70)}» → ${answers.size} өөр хариулт`);
}

/* ── ойролцоо давхардал (файл дотор + хооронд) — O(n²) хязгаартай ─── */
const NEAR = 0.85;
const capped = examples.slice(0, 4000);
let near = 0;
for (let i = 0; i < capped.length; i++) {
  for (let j = i + 1; j < capped.length; j++) {
    const a = capped[i];
    const b = capped[j];
    if (a.qTok.size < 3 || b.qTok.size < 3) continue;
    const s = jaccard(a.qTok, b.qTok);
    if (s >= NEAR && norm(a.q) !== norm(b.q)) {
      near += 1;
      if (near <= 40) finding('info', 'NEAR_DUPLICATE', a.file, `мөр ${a.line} ≈ ${path.relative(REPO, b.file)}:${b.line} (J=${s.toFixed(2)})`, { line: a.line });
    }
  }
}
if (near > 40) finding('info', 'NEAR_DUPLICATE', SFT_FILES[0] ?? REPO, `нийт ${near} ойролцоо давхардал (эхний 40-ийг л жагсаав)`);

/* ── ангийн тэнцвэр ───────────────────────────────────────────────── */
const totalEx = examples.length;
report.classes = classCounts;
for (const [cls, n] of Object.entries(classCounts)) {
  if (totalEx >= 50 && n / totalEx > 0.4) finding('warn', 'CLASS_IMBALANCE', SFT_FILES[0] ?? REPO, `«${cls}» = ${((n / totalEx) * 100).toFixed(0)}% (${n}/${totalEx})`);
  if (totalEx >= 50 && n < 3) finding('info', 'TINY_CLASS', SFT_FILES[0] ?? REPO, `«${cls}» = ${n} жишээ`);
}

/* ── train/eval гоожилт (§26) ─────────────────────────────────────── */
const evalQs = [];
for (const file of EVAL_FILES) {
  if (file.endsWith('.json')) {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      const list = Array.isArray(j) ? j : Array.isArray(j.cases) ? j.cases : [];
      for (const c of list) {
        const turns = Array.isArray(c.turns) ? c.turns : [c];
        for (const t of turns) {
          const q = t.q ?? t.question ?? t.query ?? t.user ?? null;
          if (typeof q === 'string') evalQs.push({ file, id: c.id ?? c.case ?? null, q, tok: tokens(q) });
        }
      }
    } catch {
      /* JSON биш */
    }
    continue;
  }
  for (const { row } of await readJsonl(file)) {
    const q = row.query ?? row.question ?? row.q ?? row.input ?? null;
    if (typeof q === 'string') evalQs.push({ file, id: row.test_id ?? row.case_id ?? row.id ?? null, q, tok: tokens(q) });
  }
}
const trainOnly = examples.filter((e) => !/behavior-sft-(val|test)\.jsonl$/.test(e.file));
const trainExact = new Map(trainOnly.map((e) => [norm(e.q), e]));
let leakExact = 0;
let leakFuzzy = 0;
for (const ev of evalQs) {
  const nq = norm(ev.q);
  if (nq.length === 0) continue;
  const ex = trainExact.get(nq);
  if (ex) {
    leakExact += 1;
    report.leakage.push({ kind: 'exact', eval: path.relative(REPO, ev.file), id: ev.id, train: `${path.relative(REPO, ex.file)}:${ex.line}`, q: ev.q.slice(0, 120) });
    continue;
  }
  if (ev.tok.size < 4) continue;
  for (const e of trainOnly) {
    if (e.qTok.size < 4) continue;
    const s = jaccard(ev.tok, e.qTok);
    if (s >= NEAR) {
      leakFuzzy += 1;
      if (report.leakage.length < 300) report.leakage.push({ kind: 'fuzzy', j: Number(s.toFixed(2)), eval: path.relative(REPO, ev.file), id: ev.id, train: `${path.relative(REPO, e.file)}:${e.line}`, q: ev.q.slice(0, 120) });
      break;
    }
  }
}
if (leakExact > 0) finding('error', 'EVAL_LEAK_EXACT', EVAL_FILES[0] ?? REPO, `${leakExact} үнэлгээний асуулт сургалтын багцад ЯГ ИЖИЛ`);
if (leakFuzzy > 0) finding('warn', 'EVAL_LEAK_FUZZY', EVAL_FILES[0] ?? REPO, `${leakFuzzy} үнэлгээний асуулт сургалтын асуулттай ≥${NEAR} Jaccard`);
report.summary = { sft_examples: totalEx, eval_questions: evalQs.length, leak_exact: leakExact, leak_fuzzy: leakFuzzy, near_duplicates: near, by_code: {} };
for (const f of report.findings) report.summary.by_code[f.code] = (report.summary.by_code[f.code] ?? 0) + 1;

/* ── гаралт ───────────────────────────────────────────────────────── */
if (JSON_OUT) {
  fs.mkdirSync(path.dirname(path.resolve(JSON_OUT)), { recursive: true });
  fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
}
console.log(`MGL AI · training-data lint`);
console.log(`SFT файл ${SFT_FILES.length} · жишээ ${totalEx} · үнэлгээний асуулт ${evalQs.length} (${EVAL_FILES.length} файл)`);
console.log(`алдаа ${report.totals.error} · анхааруулга ${report.totals.warn} · мэдээлэл ${report.totals.info}`);
console.log(`гоожилт: яг ижил ${leakExact} · ойролцоо (J≥${NEAR}) ${leakFuzzy} · ойролцоо давхардал ${near}`);
console.log(`кодоор: ${Object.entries(report.summary.by_code).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}=${n}`).join(' · ') || '—'}`);
const top = Object.entries(classCounts).sort((a, b) => b[1] - a[1]).slice(0, 12);
console.log(`ангиуд (эхний 12): ${top.map(([c, n]) => `${c}=${n}`).join(' · ')}`);
for (const f of report.findings.filter((x) => x.severity === 'error').slice(0, 10)) console.log(`  ✖ ${f.code} ${f.file}: ${f.message}`);
for (const l of report.leakage.slice(0, 8)) console.log(`  ${l.kind === 'exact' ? '✖' : '⚠'} гоожилт ${l.kind}${l.j ? ` J=${l.j}` : ''}: ${l.eval}${l.id ? `#${l.id}` : ''} ↔ ${l.train} «${l.q.slice(0, 70)}»`);
if (JSON_OUT) console.log(`JSON → ${JSON_OUT}`);
if (STRICT && report.totals.error > 0) process.exit(1);
