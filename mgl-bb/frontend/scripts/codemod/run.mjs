#!/usr/bin/env node
/**
 * Дизайн токены автомат шүүрдэлт.
 *
 *   node scripts/codemod/run.mjs                 # хуурай гүйлт (анхдагч)
 *   node scripts/codemod/run.mjs --write         # бодитоор бичнэ
 *   node scripts/codemod/run.mjs --only "src/features/teams/**"
 *
 * АРГА ЗҮЙ: TypeScript compiler API-аар класс мөрүүдийг БАЙРЛУУЛЖ,
 * байт-офсетоор ХАЙЧИЛЖ солино. AST-ыг ДАХИН ХЭВЛЭХГҮЙ.
 *
 * Яагаад: jscodeshift / ts-morph / recast бүгд файлыг AST-аас дахин
 * хэвлэдэг. Энэ repo-д 176 файл prettier-цэвэр биш тул нэг класс
 * солиход 3,000 мөрийн diff гарч, зэрэг ажиллаж буй бусад агентын
 * гартай толгой мөргөнө. Офсет хайчилбар нь мөрийн тоог хэзээ ч
 * өөрчлөхгүй — мөргөлдөөн гарлаа ч нэг класс мөр л байна.
 *
 * Идемпотент: `bg-success/10` нь `TOKEN_RE`-д таарахгүй (гэр бүлийн
 * жагсаалтад семантик нэр байхгүй) тул дахин ажиллуулах нь no-op.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, join } from 'node:path';
import ts from 'typescript';

import config from './sweep.config.mjs';
import { rewriteClassString } from './lib/classString.mjs';
import { detectIdentityPalette } from './lib/identity.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..'); // frontend/
const OUT_DIR = resolve(ROOT, '.codemod-out');

const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const onlyIdx = argv.indexOf('--only');
const ONLY = onlyIdx >= 0 ? argv[onlyIdx + 1] : null;

/* ─────────────────────────── glob → regex ─────────────────────────── */
function globToRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?'; // `**/` — дурын гүнтэй лавлах, тэг ч байж болно
          i += 2;
        } else {
          re += '.*'; // `**` — юу ч байж болно, `/` орсон ч
          i += 1;
        }
      } else {
        re += '[^/]*'; // `*` — зөвхөн нэг сегментийн дотор
      }
    } else if (c === '?') re += '[^/]';
    else if ('.+^${}()|[]\\'.includes(c)) re += '\\' + c;
    else re += c;
  }
  return new RegExp(`^${re}$`);
}
const reCache = new Map();
const matches = (path, glob) => {
  let re = reCache.get(glob);
  if (!re) reCache.set(glob, (re = globToRe(glob)));
  return re.test(path);
};

/* ───────────────────────────  skiplist  ──────────────────────────── */
function dirtyFiles() {
  if (!config.skipDirty) return new Map();
  try {
    const out = execFileSync('git', ['-C', config.mainRepoPath, 'status', '--porcelain', '-z'], {
      encoding: 'utf8',
    });
    const map = new Map();
    for (const entry of out.split('\0')) {
      if (!entry) continue;
      const p = entry.slice(3);
      if (p.startsWith('frontend/src/')) map.set(p.replace(/^frontend\//, ''), 'DIRTY');
    }
    return map;
  } catch (err) {
    console.error(
      `⚠ Гол checkout-ын git status уншигдсангүй (${config.mainRepoPath}): ${err.message}\n` +
        `  Бохир файлын хамгаалалтгүйгээр ҮРГЭЛЖЛҮҮЛЭХГҮЙ — бусад агентын ажил дарагдана.`,
    );
    process.exit(2);
  }
}

function skipReason(rel, dirty) {
  for (const [glob, reason] of config.exceptions) if (matches(rel, glob)) return reason;
  if (config.skipHandRedesign && config.handRedesign.includes(rel)) return 'HAND_REDESIGN (4-р үе)';
  if (dirty.has(rel)) return 'DIRTY (өөр агентын гарт)';
  return null;
}

/* ─────────────────────────  файлын жагсаалт  ──────────────────────── */
function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (/\.tsx?$/.test(name)) acc.push(full);
  }
  return acc;
}

/* ──────────────────────────────  гүйлт  ──────────────────────────── */
const dirty = dirtyFiles();
const files = walk(resolve(ROOT, 'src'));

const stats = { scanned: 0, skipped: 0, changed: 0, edits: 0 };
const skipped = [];
const review = [];
const diffs = [];

for (const abs of files) {
  const rel = relative(ROOT, abs).replace(/\\/g, '/');
  if (ONLY && !matches(rel, ONLY)) continue;

  const reason = skipReason(rel, dirty);
  if (reason) {
    skipped.push({ rel, reason });
    stats.skipped++;
    continue;
  }
  stats.scanned++;

  const src = readFileSync(abs, 'utf8');
  const sf = ts.createSourceFile(
    abs,
    src,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const edits = [];
  const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;

  const visit = (node) => {
    const isStr =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      node.kind === ts.SyntaxKind.TemplateHead ||
      node.kind === ts.SyntaxKind.TemplateMiddle ||
      node.kind === ts.SyntaxKind.TemplateTail;

    if (isStr && node.text) {
      const res = rewriteClassString(node.text);
      const hasWork = res.changed || res.undecidable.length > 0;
      if (hasWork) {
        const id = detectIdentityPalette(ts, node);
        if (id.identity) {
          review.push({
            rel,
            line: lineOf(node.getStart(sf)),
            reason: 'IDENTITY_PALETTE',
            detail: `${id.container} — ${id.families.length} гэр бүл (${id.families.join(', ')})`,
          });
        } else {
          for (const u of res.undecidable)
            review.push({ rel, line: lineOf(node.getStart(sf)), reason: u.reason, detail: u.token });
          if (res.changed) {
            /* Зөвхөн ХАШИЛТЫН ДОТОР талыг сольно.
             *
             * ⚠ Төгсгөлийн офсет ТӨРЛӨӨС хамаарна:
             *   StringLiteral                  'text'   → −1 (хашилт)
             *   NoSubstitutionTemplateLiteral  `text`   → −1 (backtick)
             *   TemplateTail                   }text`   → −1 (backtick)
             *   TemplateHead                   `text${  → −2 («${»)
             *   TemplateMiddle                 }text${  → −2 («${»)
             * Бүгдэд −1 хэрэглэвэл `${`-ийн `$` идэгдэж
             * `${fn(x)}` → `{fn(x)}` болж хувьсагч чимээгүй үхнэ.
             * Энэ алдаа бодитоор гарч, tsc (Gate A) барьсан. */
            const tailLen =
              node.kind === ts.SyntaxKind.TemplateHead ||
              node.kind === ts.SyntaxKind.TemplateMiddle
                ? 2
                : 1;
            edits.push({
              start: node.getStart(sf) + 1,
              end: node.getEnd() - tailLen,
              text: res.text,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (!edits.length) continue;
  stats.changed++;
  stats.edits += edits.length;

  let out = src;
  for (const e of edits.sort((a, b) => b.start - a.start))
    out = out.slice(0, e.start) + e.text + out.slice(e.end);

  // ── Хамгаалалт 1: мөрийн тоо ХЭЗЭЭ Ч өөрчлөгдөх ёсгүй.
  const before = src.split('\n').length;
  const after = out.split('\n').length;
  if (before !== after) {
    console.error(`✗ ${rel}: мөрийн тоо ${before} → ${after}. Хайчилбар алдаатай, зогслоо.`);
    process.exit(2);
  }

  /* ── Хамгаалалт 2: үр дүн нь ЗӨВ ПАРСЛАГДАХ ёстой.
   * Офсетоор хайчлах нь хурдан, гэхдээ нэг байт зөрөхөд синтаксийг
   * чимээгүй эвдэнэ (жишээ нь `${` дундуур орж `$`-ыг идэх). Ийм алдаа
   * бодитоор гарсан. Эндээс баривал файл огт бичигдэхгүй. */
  const reparsed = ts.createSourceFile(abs, out, ts.ScriptTarget.Latest, true, sf.languageVariant === ts.LanguageVariant.JSX ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const diags = reparsed.parseDiagnostics ?? [];
  if (diags.length) {
    const d = diags[0];
    const { line } = reparsed.getLineAndCharacterOfPosition(d.start ?? 0);
    console.error(
      `✗ ${rel}:${line + 1}: хайчилбарын дараа синтаксийн алдаа — ` +
        `${ts.flattenDiagnosticMessageText(d.messageText, ' ')}. Зогслоо, файл бичигдээгүй.`,
    );
    process.exit(2);
  }

  diffs.push({ rel, edits: edits.length });
  if (WRITE) writeFileSync(abs, out);
}

/* ─────────────────────────────  тайлан  ──────────────────────────── */
mkdirSync(OUT_DIR, { recursive: true });

const byReason = {};
for (const r of review) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;

const md = [
  `# Codemod review — ${WRITE ? 'БИЧСЭН' : 'хуурай гүйлт'}`,
  '',
  `Скан хийсэн: ${stats.scanned} файл · алгассан: ${stats.skipped} · өөрчилсөн: ${stats.changed} файл / ${stats.edits} класс мөр`,
  '',
  '## Codemod ШИЙДЭЖ ЧАДААГҮЙ (хүн харна)',
  '',
  ...Object.entries(byReason)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `- **${k}** — ${v}`),
  '',
];
for (const [reason] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
  md.push(`### ${reason}`, '');
  const items = review.filter((r) => r.reason === reason);
  const seen = new Set();
  for (const r of items) {
    const key = `${r.rel}:${r.line}:${r.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    md.push(`- \`${r.rel}:${r.line}\` — ${r.detail}`);
  }
  md.push('');
}
writeFileSync(resolve(OUT_DIR, 'review.md'), md.join('\n'));

writeFileSync(
  resolve(OUT_DIR, 'skipped.md'),
  [
    '# Алгассан файлууд',
    '',
    'Эдгээрийн `DIRTY` хэсэг нь бусад агентын ажил дуусахад ДАХИН ажиллуулах',
    'ёстой хоёр дахь дамжлагын ажлын жагсаалт. Codemod идемпотент.',
    '',
    ...skipped
      .sort((a, b) => a.reason.localeCompare(b.reason) || a.rel.localeCompare(b.rel))
      .map((s) => `- \`${s.rel}\` — ${s.reason}`),
  ].join('\n'),
);

writeFileSync(
  resolve(OUT_DIR, 'changed.json'),
  JSON.stringify({ mode: WRITE ? 'write' : 'dry-run', stats, diffs }, null, 2),
);

console.log(
  `${WRITE ? '✍ БИЧСЭН' : '👀 хуурай гүйлт'} · скан ${stats.scanned} · алгассан ${stats.skipped} · ` +
    `өөрчилсөн ${stats.changed} файл / ${stats.edits} класс мөр · шийдэгдээгүй ${review.length}`,
);
console.log(`тайлан: ${relative(process.cwd(), OUT_DIR).replace(/\\/g, '/')}/`);
