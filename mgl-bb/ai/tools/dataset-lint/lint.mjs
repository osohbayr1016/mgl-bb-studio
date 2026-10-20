#!/usr/bin/env node
/**
 * MGL AI · DATASET QUALITY AUDITOR — норматив багцуудын БИЕ ДААСАН lint (Session C, 2026-09-11).
 *
 *   node ai/tools/dataset-lint/lint.mjs [--root <dir>] [--json <out.json>] [--strict] [--quiet]
 *
 * Өгөгдмөл root: `ai/data-train-files/` (gitignore-д; ажилтны PC дээр).  85+ багц руу
 * масштаблагдана — файл бүрийг мөр мөрөөр урсгалаар уншина, санах ойд бүхэлд нь авахгүй.
 *
 * ⚠️ ЮУ Ч ЗАСДАГГҮЙ.  Эх сурвалжийн агуулга (норматив утга, заалт, дүрэм) энд ХЭЗЭЭ Ч
 *    өөрчлөгдөхгүй — зөвхөн ТАЙЛАН.  Синтаксийн хэвийжүүлэлтийг санал болгож болох ч
 *    автоматаар хэрэглэхгүй (мандат §23).
 *
 * ⚠️ Session A-ийн `datasetProfiles.ts` (хэлбэр таних адаптер) ба `ingest.ts`-ээс ХАМААРАХГҮЙ —
 *    энэ нь шингээлтийн ӨМНӨХ, багцын ӨӨРИЙН бүрэн бүтэн байдлын шалгалт.  Гүйцэтгэх
 *    боломжтой баталгаажилтын цагаан жагсаалтыг л `ai/retrieval/src/rules.ts`-ээс уншина
 *    (нэг эх сурвалж; хос бичихгүй).
 *
 * Шалгалтууд (мандат §23, §24):
 *   MANIFEST_MISSING · MANIFEST_FILE_MISSING · MANIFEST_SHA_MISMATCH · MANIFEST_BYTES_MISMATCH ·
 *   UNLISTED_FILE · ZERO_BYTE_FILE · MALFORMED_JSONL · MALFORMED_JSON · DUPLICATE_ID ·
 *   DUPLICATE_RULE · CONTRADICTORY_RANGE · INVERTED_RANGE · MISSING_PAGE · INVALID_PAGE ·
 *   UNKNOWN_VERIFICATION_STATUS · NEEDS_REVIEW_EXECUTABLE_LEAK · FORMULA_NO_PROVENANCE ·
 *   FORMULA_NO_EXPRESSION · BAD_CODE_ALIAS · ALIAS_COLLISION_ACROSS_DOCS · PYTHON_REPR ·
 *   BAD_ENCODING · BROKEN_CYRILLIC · MISSING_LANGUAGE_ALIAS · MISSING_REQUIRED_FIELD ·
 *   CROSS_PACKAGE_ID_COLLISION · CROSS_PACKAGE_CODE_COLLISION
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');

/* ── аргумент ─────────────────────────────────────────────────────── */
const args = process.argv.slice(2);
const opt = (name, def = null) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? true) : def;
};
const ROOT = path.resolve(opt('--root', path.join(REPO, 'ai', 'data-train-files')));
const JSON_OUT = opt('--json');
const STRICT = args.includes('--strict');
const QUIET = args.includes('--quiet');

/* ── гүйцэтгэх боломжтой баталгаажилт — rules.ts-ээс (нэг эх сурвалж) ── */
let EXECUTABLE = new Set();
try {
  registerHooks({
    resolve(sp, c, n) {
      if (/^\.{1,2}\//.test(sp) && !/\.[cm]?[jt]s$/.test(sp)) return n(`${sp}.ts`, c);
      return n(sp, c);
    },
  });
  const R = await import(pathToFileURL(path.join(REPO, 'ai', 'retrieval', 'src', 'rules.ts')).href);
  EXECUTABLE = new Set(R.EXECUTABLE_VERIFICATION);
} catch (err) {
  console.error(`⚠️ rules.ts-ийн EXECUTABLE_VERIFICATION уншигдсангүй (${err.message}) — leak шалгалт хязгаарлагдмал.`);
}
/** Багцуудад тааралддаг, ГҮЙЦЭТГЭХГҮЙ ч ТАНИГДСАН төлвүүд. */
const KNOWN_NON_EXECUTABLE = new Set([
  'verified', 'unverified', 'needs_human_review', 'damaged_source_render_review', 'paraphrase',
  'verified_official', 'verified_current', 'quarantined', 'pending', 'ocr_uncertain', 'human_review_required',
]);

/* ── тайлангийн хуримтлуулагч ─────────────────────────────────────── */
const SEV = { error: 0, warn: 1, info: 2 };
const report = { root: ROOT, generated_at: new Date().toISOString(), packages: [], cross: [], totals: { error: 0, warn: 0, info: 0 } };

/**
 * Олдвор.  `extra.agg` өгвөл ижил (code, file, agg) олдворууд НЭГ мөрөнд нэгтгэгдэж
 * `count` + эхний 3 жишээ үлдээнэ — 85 багц × 300 мөрийн давтагдсан анхааруулга нь
 * тайланг уншигдахгүй болгодог (хэмжсэн: 4 861 анхааруулгын 4 000 нь 12 хэлбэр).
 */
function finding(pkg, severity, code, file, message, extra = {}) {
  const { agg, ...rest } = extra;
  if (agg !== undefined) {
    const key = `${code}|${file}|${agg}`;
    const prev = pkg.aggIndex.get(key);
    if (prev) {
      prev.count += 1;
      if (prev.examples.length < 3) prev.examples.push(message);
      return prev;
    }
    const f = { severity, code, file, message: `${agg}`, count: 1, examples: [message], ...rest };
    pkg.aggIndex.set(key, f);
    pkg.findings.push(f);
    pkg.counts[severity] += 1;
    report.totals[severity] += 1;
    return f;
  }
  const f = { severity, code, file, message, ...rest };
  pkg.findings.push(f);
  pkg.counts[severity] += 1;
  report.totals[severity] += 1;
  return f;
}

/* ── туслахууд ────────────────────────────────────────────────────── */
function sha256(file) {
  const h = createHash('sha256');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}

async function* jsonlRows(file, pkg, rel) {
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  let n = 0;
  let bad = 0;
  for await (const line of rl) {
    n += 1;
    if (line.trim().length === 0) continue;
    try {
      yield [n, JSON.parse(line)];
    } catch (err) {
      bad += 1;
      if (bad <= 5) finding(pkg, 'error', 'MALFORMED_JSONL', rel, `мөр ${n}: ${err.message.slice(0, 80)}`, { line: n });
    }
  }
  if (bad > 5) finding(pkg, 'error', 'MALFORMED_JSONL', rel, `нийт ${bad} гажуудсан мөр`, { count: bad });
}

/** Python repr / буруу кодчилол / эвдэрсэн кирилл — текстийн талбар. */
const PY_REPR = /(?:^|\s)(?:\{'|\['|\('|True\b|False\b|None\b|OrderedDict\(|Decimal\()/u;
const MOJIBAKE = /[ÐÑÃâ€™]{2,}|�/u;
const LATIN_IN_CYRILLIC = /[А-Яа-яӨөҮүЁё]+[a-zA-Z]+[А-Яа-яӨөҮүЁё]+/u;

function textIssues(s) {
  const out = [];
  if (typeof s !== 'string') return out;
  if (PY_REPR.test(s)) out.push('PYTHON_REPR');
  if (MOJIBAKE.test(s)) out.push('BAD_ENCODING');
  if (LATIN_IN_CYRILLIC.test(s)) out.push('BROKEN_CYRILLIC');
  return out;
}

/** Баримтын кодыг ХАРЬЦУУЛАХ түлхүүр — БД ≠ БНбД (§24) хадгалагдана. */
export function docCodeKey(code) {
  if (typeof code !== 'string') return null;
  const c = code.trim().toUpperCase().replace(/\s+/g, ' ');
  // Угтварыг ХАДГАЛНА: «БД» ба «БНБД» нь өөр өөр стандартын гэр бүл.
  const m = /^(БНБД|БД|УББ|СНИП|MNS|МНС|BNBD|BD|UBB|SNIP|ГОСТ|GOST)\s*[-]?\s*(.+)$/u.exec(c);
  if (!m) return c;
  const family = { BNBD: 'БНБД', BD: 'БД', UBB: 'УББ', SNIP: 'СНИП', МНС: 'MNS', GOST: 'ГОСТ' }[m[1]] ?? m[1];
  return `${family} ${m[2].replace(/\s+/g, '')}`;
}

const ID_FIELDS = ['chunk_id', 'rule_id', 'formula_id', 'record_id', 'test_id', 'case_id', 'id'];
const PAGE_FIELDS = ['page', 'printed_page', 'pdf_page', 'expected_page'];

/* ── багц бүрийн шалгалт ──────────────────────────────────────────── */
async function lintPackage(dir) {
  const name = path.basename(dir);
  const pkg = { name, dir, findings: [], aggIndex: new Map(), counts: { error: 0, warn: 0, info: 0 }, stats: { files: 0, rows: 0, chunks: 0, rules: 0, verification: {} }, ids: new Map(), docCodes: new Set(), aliases: new Map() };
  const files = fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile());
  pkg.stats.files = files.length;

  // 1. manifest
  const manifestPath = path.join(dir, 'manifest.json');
  let manifest = null;
  if (!fs.existsSync(manifestPath)) {
    finding(pkg, 'error', 'MANIFEST_MISSING', 'manifest.json', 'manifest.json байхгүй — файлын SHA, гарал үүсэл баталгаажихгүй');
  } else {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      finding(pkg, 'error', 'MALFORMED_JSON', 'manifest.json', err.message.slice(0, 100));
    }
  }
  const listed = manifest && manifest.files && typeof manifest.files === 'object' ? manifest.files : null;
  if (manifest && !listed) finding(pkg, 'warn', 'MANIFEST_NO_FILES', 'manifest.json', 'manifest.files байхгүй — SHA шалгалт боломжгүй');
  if (listed) {
    for (const [f, meta] of Object.entries(listed)) {
      const p = path.join(dir, f);
      if (!fs.existsSync(p)) {
        finding(pkg, 'error', 'MANIFEST_FILE_MISSING', f, 'manifest-д бүртгэлтэй атлаа байхгүй');
        continue;
      }
      const st = fs.statSync(p);
      if (typeof meta?.bytes === 'number' && meta.bytes !== st.size) finding(pkg, 'error', 'MANIFEST_BYTES_MISMATCH', f, `manifest ${meta.bytes} ≠ диск ${st.size}`);
      if (typeof meta?.sha256 === 'string') {
        if (meta.sha256.length !== 64) finding(pkg, 'error', 'MANIFEST_SHA_INVALID', f, 'sha256 64 тэмдэгт биш');
        else if (sha256(p) !== meta.sha256.toLowerCase()) finding(pkg, 'error', 'MANIFEST_SHA_MISMATCH', f, 'SHA-256 таарахгүй — файл өөрчлөгдсөн эсвэл manifest хуучирсан');
      } else finding(pkg, 'warn', 'MANIFEST_NO_SHA', f, 'sha256 байхгүй');
    }
    for (const f of files) if (f !== 'manifest.json' && !(f in listed)) finding(pkg, 'warn', 'UNLISTED_FILE', f, 'manifest-д бүртгэлгүй файл');
  }

  // 2. файл бүр
  const numericRules = []; // {file, id, quantity, min, max, category}
  for (const f of files) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.size === 0) {
      finding(pkg, 'info', 'ZERO_BYTE_FILE', f, 'хоосон файл (профайлд хоосон байх нь зөвшөөрөгдөж болно)');
      continue;
    }
    if (f.endsWith('.json')) {
      let j;
      try {
        j = JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch (err) {
        finding(pkg, 'error', 'MALFORMED_JSON', f, err.message.slice(0, 100));
        continue;
      }
      if (f === 'document.json') {
        const code = j.code ?? j.current_code ?? null;
        if (code) pkg.docCodes.add(docCodeKey(code));
        if (j.doc_id) pkg.docId = j.doc_id;
        for (const k of ['doc_id', 'title_mn']) if (!(k in j)) finding(pkg, 'warn', 'MISSING_REQUIRED_FIELD', f, `document.${k} байхгүй`);
      }
      if (f === 'aliases.json') lintAliases(pkg, f, j);
      continue;
    }
    if (!f.endsWith('.jsonl')) continue;

    const isChunks = f === 'knowledge_chunks.jsonl';
    const isRules = /rules\.jsonl$|numeric_requirements\.jsonl$|thresholds?\.jsonl$/.test(f);
    const isFormulas = f === 'formulas.jsonl';
    const isSft = /sft/.test(f);
    const isTests = /tests?\.jsonl$/.test(f);
    const seenIds = new Map();
    let rows = 0;
    for await (const [line, row] of jsonlRows(p, pkg, f)) {
      rows += 1;
      pkg.stats.rows += 1;
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        finding(pkg, 'error', 'MALFORMED_JSONL', f, `мөр ${line}: объект биш`, { line });
        continue;
      }
      // id давхардал
      const idField = ID_FIELDS.find((k) => typeof row[k] === 'string');
      if (idField) {
        const id = row[idField];
        const prev = seenIds.get(id);
        if (prev !== undefined) {
          // ⚠️ Зарим профайлд нэг заалтын олон тоон мөр ИЖИЛ rule_id-тай (адаптер
          //    хэсгийн id-аар угтварлаж ялгадаг, CLAUDE.md) — info, нэгтгэсэн.
          //    Хэсэг/тестийн id давхардал бол ЖИНХЭНЭ алдаа.
          if (isRules) finding(pkg, 'info', 'DUPLICATE_RULE', f, `мөр ${line}: ${idField}=${id} (эхлээд мөр ${prev})`, { agg: 'ижил rule_id-тай олон мөр (адаптер ялгах ёстой)' });
          else finding(pkg, isChunks || isTests ? 'error' : 'warn', 'DUPLICATE_ID', f, `мөр ${line}: ${idField}=${id} (эхлээд мөр ${prev})`, { line, id });
        } else seenIds.set(id, line);
        if (!pkg.ids.has(id)) pkg.ids.set(id, `${f}:${line}`);
      } else if (isChunks || isRules || isFormulas) {
        finding(pkg, 'warn', 'MISSING_REQUIRED_FIELD', f, `мөр ${line}`, { agg: `id талбар (${ID_FIELDS.slice(0, 5).join('|')}) байхгүй` });
      } else if (isTests) {
        finding(pkg, 'info', 'MISSING_TEST_ID', f, `мөр ${line}`, { agg: 'test_id байхгүй — регрессийг нэрээр мөшгих боломжгүй' });
      }
      // текстийн чанар
      for (const [k, v] of Object.entries(row)) {
        if (typeof v !== 'string' || v.length < 4) continue;
        for (const code of textIssues(v)) finding(pkg, code === 'PYTHON_REPR' ? 'error' : 'warn', code, f, `мөр ${line} · ${k}: «${v.slice(0, 70).replace(/\s+/g, ' ')}…»`, { agg: `${k} талбарт` });
      }
      // баталгаажилтын төлөв
      const vs = row.verification_status ?? row.source?.verification_status;
      if (typeof vs === 'string') {
        pkg.stats.verification[vs] = (pkg.stats.verification[vs] ?? 0) + 1;
        if (!EXECUTABLE.has(vs) && !KNOWN_NON_EXECUTABLE.has(vs)) finding(pkg, 'warn', 'UNKNOWN_VERIFICATION_STATUS', f, `мөр ${line}`, { agg: `«${vs}» — rules.ts цагаан жагсаалт ба мэдэгдэж буй төлөвт байхгүй; адаптер тааруулах ёстой`, status: vs });
      }
      // хуудас
      if (isChunks) {
        pkg.stats.chunks += 1;
        const urlSourced = typeof row.source_url === 'string' || typeof row.answer_source?.url === 'string';
        for (const k of ['chunk_id', 'text_mn']) if (!(k in row)) finding(pkg, 'error', 'MISSING_REQUIRED_FIELD', f, `мөр ${line}: ${k} байхгүй`, { line });
        // doc_id: URL-эх сурвалжтай (amended_rules профайл) хэсэгт байхгүй байж болно — info.
        if (!('doc_id' in row)) finding(pkg, urlSourced ? 'info' : 'error', 'MISSING_REQUIRED_FIELD', f, `мөр ${line}`, { agg: urlSourced ? 'doc_id байхгүй (URL-эх сурвалжтай профайл — document.json-ы doc_id хэрэглэгдэнэ)' : 'doc_id байхгүй' });
        if (typeof row.text_mn !== 'string' || row.text_mn.trim().length === 0) finding(pkg, 'error', 'EMPTY_TEXT', f, `мөр ${line}: text_mn хоосон`, { line });
        if (row.text_en === null || row.text_en === undefined) pkg.stats.noEn = (pkg.stats.noEn ?? 0) + 1;
        const hasPage = PAGE_FIELDS.some((k) => Number.isInteger(row[k]) && row[k] > 0);
        const badPage = PAGE_FIELDS.some((k) => row[k] !== undefined && row[k] !== null && (!Number.isInteger(row[k]) || row[k] <= 0 || row[k] > 2000));
        if (badPage) finding(pkg, 'error', 'INVALID_PAGE', f, `мөр ${line}: хуудасны утга буруу`, { line });
        const hasLocator = typeof row.section === 'string' || typeof row.clause === 'string' || typeof row.answer_source?.locator === 'string';
        if (!hasPage && !hasLocator) finding(pkg, urlSourced ? 'info' : 'warn', 'MISSING_PAGE', f, `мөр ${line}`, { agg: urlSourced ? 'хуудас/заалтгүй, зөвхөн URL (эшлэл URL-аар — v3 гэрээ)' : 'хуудас ч, заалт/хэсгийн хаяг ч байхгүй' });
        if (typeof vs !== 'string') finding(pkg, 'warn', 'MISSING_VERIFICATION_STATUS', f, `мөр ${line}`, { agg: 'verification_status байхгүй (хэсэг бүр төлөвтэй байх ёстой — эс бөгөөс адаптер баримтын провенансаас өвлүүлнэ)' });
      }
      if (isRules) {
        pkg.stats.rules += 1;
        // гүйцэтгэх дүрэм (харьцуулагч/муж) атлаа хүний хяналт хүлээж буй → гоожилтын эрсдэл
        const executableShape = 'operator' in row || 'g_mj_m2' in row || 'min' in row || 'max' in row || 'value' in row || 'threshold' in row || 'conditions' in row;
        if (executableShape && typeof vs === 'string' && (vs === 'needs_human_review' || vs === 'damaged_source_render_review') && row.usable_for_current_compliance === true) {
          finding(pkg, 'error', 'NEEDS_REVIEW_EXECUTABLE_LEAK', f, `мөр ${line}: ${vs} атлаа usable_for_current_compliance=true`, { line });
        }
        if (executableShape && typeof vs === 'string' && !EXECUTABLE.has(vs) && row.usable_for_current_compliance === true && vs !== 'verified') {
          finding(pkg, 'warn', 'NON_EXECUTABLE_MARKED_USABLE', f, `мөр ${line}`, { agg: `«${vs}» цагаан жагсаалтад байхгүй ч usable_for_current_compliance=true — адаптер тааруулаагүй бол ЧИМЭЭГҮЙ хүний хяналт руу унана`, status: vs });
        }
        // муж
        const range = row.g_mj_m2 && typeof row.g_mj_m2 === 'object' ? row.g_mj_m2 : ('min' in row || 'max' in row ? row : null);
        if (range) {
          const min = range.min ?? range.gt ?? range.gte ?? null;
          const max = range.max ?? range.lt ?? range.lte ?? null;
          if (min !== null && max !== null && Number(min) > Number(max)) finding(pkg, 'error', 'INVERTED_RANGE', f, `мөр ${line}: min ${min} > max ${max}`, { line });
          const quantity = row.quantity ?? (row.g_mj_m2 ? 'g_mj_m2' : row.name ?? null);
          numericRules.push({ file: f, line, id: row[idField] ?? null, quantity, category: row.category ?? null, min: min === null ? -Infinity : Number(min), max: max === null ? Infinity : Number(max), minEx: 'gt' in range, maxEx: 'lt' in range });
        }
      }
      if (isFormulas) {
        const hasExpr = ['equation_latex', 'expression', 'formula', 'equation', 'python', 'js'].some((k) => typeof row[k] === 'string' && row[k].trim().length > 0);
        const hasProv = ['page', 'section', 'clause'].some((k) => row[k] !== undefined && row[k] !== null) || typeof row.source === 'object';
        if (!hasProv) finding(pkg, 'warn', 'FORMULA_NO_PROVENANCE', f, `мөр ${line}`, { agg: 'хуудас/заалт/эх сурвалжгүй томьёо' });
        if (!hasExpr) finding(pkg, 'warn', 'FORMULA_NO_EXPRESSION', f, `мөр ${line}`, { agg: 'томьёоны метадата бий, гүйцэтгэх илэрхийлэл алга' });
        else if (!row.inputs || !row.output) finding(pkg, 'info', 'FORMULA_NO_IO', f, `мөр ${line}`, { agg: 'inputs/output тодорхойлоогүй — тооцоолуурт холбогдохгүй' });
      }
      if (isSft) {
        const msgs = Array.isArray(row.messages) ? row.messages : null;
        if (!msgs) finding(pkg, 'error', 'MISSING_REQUIRED_FIELD', f, `мөр ${line}: messages байхгүй`, { line });
        else {
          const roles = msgs.map((m) => m?.role);
          const ok = roles.length >= 2 && roles[roles.length - 1] === 'assistant' && roles.filter((r) => r === 'user').length >= 1;
          if (!ok) finding(pkg, 'error', 'BAD_ROLE_ORDER', f, `мөр ${line}: ${roles.join('→')}`, { line });
          const last = msgs[msgs.length - 1];
          if (last?.role === 'assistant' && (typeof last.content !== 'string' || last.content.trim().length === 0)) finding(pkg, 'error', 'EMPTY_ANSWER', f, `мөр ${line}`, { line });
        }
      }
    }
    if (rows === 0) finding(pkg, 'info', 'EMPTY_JSONL', f, 'мөргүй');
  }

  // 3. зөрчилдсөн мужууд — ижил quantity дотор давхцах интервал (ялгаатай ангилалд)
  const byQ = new Map();
  for (const r of numericRules) {
    if (!r.quantity) continue;
    if (!byQ.has(r.quantity)) byQ.set(r.quantity, []);
    byQ.get(r.quantity).push(r);
  }
  for (const [q, list] of byQ) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.category && b.category && a.category === b.category) continue;
        if (!a.category || !b.category) continue; // ангилалгүй мужууд нь өөр нөхцөлтэй байж болно
        const lo = Math.max(a.min, b.min);
        const hi = Math.min(a.max, b.max);
        const overlap = lo < hi || (lo === hi && !(a.maxEx || b.maxEx || a.minEx || b.minEx) && Number.isFinite(lo));
        if (overlap) finding(pkg, 'warn', 'CONTRADICTORY_RANGE', a.file, `${q}: ${a.category} [${a.min},${a.max}] ∩ ${b.category} [${b.min},${b.max}] (мөр ${a.line} ↔ ${b.line})`);
      }
    }
  }

  return pkg;
}

function lintAliases(pkg, f, j) {
  const entries = Array.isArray(j) ? j : Array.isArray(j?.aliases) ? j.aliases : null;
  if (Array.isArray(j?.global_aliases)) {
    const seen = new Set();
    for (const a of j.global_aliases) {
      if (typeof a !== 'string' || a.trim().length === 0) {
        finding(pkg, 'warn', 'BAD_CODE_ALIAS', f, 'хоосон global alias');
        continue;
      }
      const k = a.trim().toLowerCase();
      if (seen.has(k)) finding(pkg, 'info', 'DUPLICATE_ALIAS', f, `«${a}»`);
      seen.add(k);
      if (/^\d{2}-\d{2,3}-\d{2}$/.test(a.trim())) {
        // угтваргүй код — БД/БНбД ялгагдахгүй тул §24-ийн мөргөлдөөний эх
        finding(pkg, 'info', 'BARE_CODE_ALIAS', f, `«${a}» угтваргүй — БД/БНбД ялгагдахгүй, мөргөлдөж болзошгүй`);
      }
      pkg.aliases.set(k, pkg.docId ?? pkg.name);
    }
    if (!j.global_aliases.some((a) => /[А-Яа-яӨөҮүЁё]/.test(String(a)))) finding(pkg, 'warn', 'MISSING_LANGUAGE_ALIAS', f, 'кирилл alias байхгүй');
    if (!j.global_aliases.some((a) => /^[A-Za-z0-9 .-]+$/.test(String(a)))) finding(pkg, 'warn', 'MISSING_LANGUAGE_ALIAS', f, 'латин/англи alias байхгүй');
    return;
  }
  if (!entries) {
    finding(pkg, 'warn', 'BAD_CODE_ALIAS', f, 'aliases.json хэлбэр танигдсангүй (массив ч, {global_aliases} ч биш)');
    return;
  }
  const canonToAliases = new Map();
  for (const e of entries) {
    const canon = e?.canonical;
    if (typeof canon !== 'string') {
      finding(pkg, 'warn', 'BAD_CODE_ALIAS', f, 'canonical байхгүй бүртгэл');
      continue;
    }
    const all = [...(e.mn ?? []), ...(e.latin ?? []), ...(e.en ?? [])].filter((x) => typeof x === 'string');
    if (!(e.mn ?? []).length) finding(pkg, 'warn', 'MISSING_LANGUAGE_ALIAS', f, `«${canon}»: mn alias алга`);
    if (!(e.latin ?? []).length && !(e.en ?? []).length) finding(pkg, 'warn', 'MISSING_LANGUAGE_ALIAS', f, `«${canon}»: латин/англи alias алга`);
    for (const a of all) {
      const k = a.trim().toLowerCase();
      const prev = canonToAliases.get(k);
      if (prev && prev !== canon) finding(pkg, 'warn', 'ALIAS_COLLISION_ACROSS_DOCS', f, `«${a}» нь «${prev}» ба «${canon}» хоёуланд`);
      canonToAliases.set(k, canon);
      pkg.aliases.set(k, canon);
    }
    if (/^(БД|БНбД|УББ|СНиП)\s/u.test(canon)) pkg.docCodes.add(docCodeKey(canon));
  }
}

/* ── багц хоорондын мөргөлдөөн (§24) ─────────────────────────────── */
function crossPackage(pkgs) {
  const idOwner = new Map();
  const pairs = new Map(); // "a↔b" → {count, sameDoc, examples}
  for (const p of pkgs) {
    for (const [id, where] of p.ids) {
      const prev = idOwner.get(id);
      if (prev && prev.pkg !== p.name) {
        // Ижил баримтын v2/v3 хувилбар нь зориудын давхардал — тэмдэглэнэ, гэвч алдаа биш
        const sameDoc = !!(p.docId && prev.docId && p.docId === prev.docId);
        const key = `${prev.pkg}|${p.name}`;
        const agg = pairs.get(key) ?? { severity: sameDoc ? 'info' : 'warn', code: 'CROSS_PACKAGE_ID_COLLISION', a: prev.pkg, b: p.name, same_document: sameDoc, count: 0, examples: [] };
        agg.count += 1;
        if (agg.examples.length < 3) agg.examples.push(`${id} (${prev.where} | ${where})`);
        pairs.set(key, agg);
      } else if (!prev) idOwner.set(id, { pkg: p.name, where, docId: p.docId });
    }
  }
  for (const agg of pairs.values()) {
    report.cross.push(agg);
    report.totals[agg.severity] += 1;
  }
  const codeOwner = new Map();
  for (const p of pkgs) {
    for (const code of p.docCodes) {
      const prev = codeOwner.get(code);
      if (prev && prev !== p.name) {
        report.cross.push({ severity: 'info', code: 'CROSS_PACKAGE_CODE_COLLISION', doc_code: code, a: prev, b: p.name, note: 'ижил баримтын хоёр багц (хувилбар) — шингээхдээ нэгийг л сонго' });
        report.totals.info += 1;
      } else codeOwner.set(code, p.name);
    }
  }
  // БД vs БНбД ялгаа хадгалагдсан эсэх — түлхүүр өөр байх ЁСТОЙ
  const bd = docCodeKey('BD 21-101-12');
  const bnbd = docCodeKey('BNbD 21-101-12');
  if (bd === bnbd) {
    report.cross.push({ severity: 'error', code: 'CODE_NORMALIZATION_MERGES_FAMILIES', a: 'BD 21-101-12', b: 'BNbD 21-101-12' });
    report.totals.error += 1;
  }
  // alias-аар өөр баримт руу заах
  const aliasOwner = new Map();
  for (const p of pkgs) {
    for (const [alias, canon] of p.aliases) {
      if (alias.length < 6) continue;
      const prev = aliasOwner.get(alias);
      if (prev && prev.canon !== canon && prev.pkg !== p.name && !(p.docId && prev.docId === p.docId)) {
        report.cross.push({ severity: 'info', code: 'CROSS_PACKAGE_ALIAS_COLLISION', alias, a: `${prev.pkg} → ${prev.canon}`, b: `${p.name} → ${canon}` });
        report.totals.info += 1;
      } else if (!prev) aliasOwner.set(alias, { pkg: p.name, canon, docId: p.docId });
    }
  }
}

/* ── main ─────────────────────────────────────────────────────────── */
async function main() {
  if (!fs.existsSync(ROOT)) {
    console.error(`root байхгүй: ${ROOT}`);
    process.exit(2);
  }
  const dirs = fs.readdirSync(ROOT).map((d) => path.join(ROOT, d)).filter((d) => fs.statSync(d).isDirectory());
  const pkgs = [];
  for (const d of dirs) pkgs.push(await lintPackage(d));
  crossPackage(pkgs);
  report.packages = pkgs.map((p) => ({ name: p.name, doc_id: p.docId ?? null, counts: p.counts, stats: p.stats, findings: p.findings }));
  report.summary = {
    packages: pkgs.length,
    rows: pkgs.reduce((a, p) => a + p.stats.rows, 0),
    chunks: pkgs.reduce((a, p) => a + p.stats.chunks, 0),
    rules: pkgs.reduce((a, p) => a + p.stats.rules, 0),
    by_code: {},
  };
  for (const p of pkgs) for (const f of p.findings) report.summary.by_code[f.code] = (report.summary.by_code[f.code] ?? 0) + 1;
  for (const f of report.cross) report.summary.by_code[f.code] = (report.summary.by_code[f.code] ?? 0) + 1;

  if (JSON_OUT) {
    fs.mkdirSync(path.dirname(path.resolve(JSON_OUT)), { recursive: true });
    fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
  }
  if (!QUIET) {
    console.log(`MGL AI · dataset lint · ${ROOT}`);
    console.log(`багц ${report.summary.packages} · мөр ${report.summary.rows} · хэсэг ${report.summary.chunks} · дүрэм ${report.summary.rules}`);
    console.log(`алдаа ${report.totals.error} · анхааруулга ${report.totals.warn} · мэдээлэл ${report.totals.info}\n`);
    for (const p of pkgs) {
      const top = Object.entries(p.findings.reduce((m, f) => ((m[f.code] = (m[f.code] ?? 0) + 1), m), {}))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([c, n]) => `${c}×${n}`)
        .join(' ');
      console.log(`  ${p.counts.error > 0 ? '✖' : p.counts.warn > 0 ? '⚠' : '✔'} ${p.name.padEnd(58)} e${p.counts.error} w${p.counts.warn} i${p.counts.info}  ${top}`);
      for (const f of p.findings.filter((x) => x.severity === 'error').slice(0, 5)) console.log(`      ✖ ${f.code} ${f.file}: ${f.message}${f.count ? ` x${f.count} — ${f.examples[0]}` : ''}`);
    }
    if (report.cross.length > 0) {
      console.log(`\n  багц хоорондын мөргөлдөөн: ${report.cross.length}`);
      for (const c of report.cross.slice(0, 12)) console.log(`    ${c.severity === 'error' ? '✖' : c.severity === 'warn' ? '⚠' : '·'} ${c.code} ${c.doc_code ?? c.alias ?? ''}${c.count ? ` x${c.count}${c.same_document ? ' (ижил баримт)' : ''}` : ''}: ${c.a} | ${c.b}`);
      if (report.cross.length > 12) console.log(`    … ${report.cross.length - 12} бусад (JSON тайланд)`);
    }
    console.log(`\n  кодоор: ${Object.entries(report.summary.by_code).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}=${n}`).join(' · ')}`);
    if (JSON_OUT) console.log(`\n  JSON → ${JSON_OUT}`);
  }
  if (STRICT && report.totals.error > 0) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
