#!/usr/bin/env node
/**
 * §21 — хэв маягийн lint-ийг «муу → зөв» хосууд дээр ХЭМЖИНЭ.
 *
 *   node ai/evaluation/style-pairs.mjs            (npm run ai:eval:style)
 *
 * Хаалга: муу талын ≥ 70% нь баригдана, зөв тал дээр ХУДАЛ ЭЕРЭГ 0.
 * Утгын зөрчилтэй хосууд (contradiction-with-count, misreading-zero-as-missing,
 * missing-unit-and-source) нь validator-ын ажил тул lint-ийн миссэд ТООЦОХГҮЙ.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { styleLint, summarizeStyle } from './lib/style.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILES = ['mn_style_pairs.jsonl', 'mn_style_pairs_norm.jsonl'].map((f) => path.join(here, '..', 'training', f)).filter((f) => fs.existsSync(f));
// «Утгын» (semantic) асуудлууд — регексээр барих БОЛОМЖГҮЙ (бүрэн утгагүй монгол, зохиомол хэмжээс, үнэн зөв байдал,
// үсгийн алдаа): тэдгээр нь validator/гэрээ/загварын (SFT) ажил.  Lint-ийн «миссэд» ТООЦОХГҮЙ — гэхдээ ИЛ жагсаасан.
const SEMANTIC = new Set([
  'contradiction-with-count', 'misreading-zero-as-missing', 'missing-unit-and-source', 'garbled-too-short', 'too-short-drops-answer', 'entity-dropped', 'invented-sections', 'vague-instead-of-refusal',
  // 2026-09-30/10-04 нэмэгдсэн: утгын нуралт, зохиомол хэмжээс/баттай байдал, үсгийн алдаа, домэйн алдаа
  'unnatural-wording', 'spelling', 'garbled-employee-wording', 'garbled-hedging', 'invented-engineering-size', 'garbled-aec-definition', 'garbled-diagnosis',
  'wrong-domain-answer', 'generic-filler', 'unsafe-certainty', 'typo-and-unsafe-mep', 'tool-confusion', 'garbled-applicability', 'garbled-compliance-advice',
  'wrong-domain-generic', 'excessive-apology', 'erp-contamination', 'invented-number-after-disclaimer', 'draft-as-active-semantic', 'superseded-as-current-semantic',
]);

const rows = FILES.flatMap((file) => fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l)));
const ids = new Set();
for (const r of rows) {
  if (ids.has(r.id)) throw new Error(`давхар id: ${r.id}`);
  ids.add(r.id);
  if (typeof r.bad !== 'string' || typeof r.good !== 'string' || !r.issue) throw new Error(`талбар дутуу: ${r.id}`);
}

const badScores = [];
const goodScores = [];
const misses = [];
const falsePos = [];
let lintable = 0;
for (const r of rows) {
  const b = styleLint(r.bad);
  const g = styleLint(r.good);
  badScores.push(b);
  goodScores.push(g);
  if (!SEMANTIC.has(r.issue)) {
    lintable++;
    if (b.total === 0) misses.push(`${r.id} (${r.issue})`);
  }
  if (g.total > 0) falsePos.push(`${r.id}: ${JSON.stringify(g.hits)}`);
}
const caught = lintable - misses.length;
const bad = summarizeStyle(badScores);
const good = summarizeStyle(goodScores);

console.log(`ХЭВ МАЯГИЙН ХОС: ${rows.length} (lint-ээр барих ёстой ${lintable}, утгын ${rows.length - lintable})`);
console.log(`  муу тал баригдсан: ${caught}/${lintable} (${Math.round((caught / lintable) * 100)}%) · зөв тал дээр худал эерэг: ${falsePos.length}`);
console.log(`  муу тал: ${bad.avgPerHundredWords} гажиг/100 үг · зөв тал: ${good.avgPerHundredWords}`);
console.log(`  төрлөөр (муу): ${Object.entries(bad.byKind).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(' ')}`);
if (misses.length) console.log(`  алдсан: ${misses.join(', ')}`);
if (falsePos.length) console.log(`  ХУДАЛ ЭЕРЭГ: ${falsePos.join(' | ')}`);

const issues = {};
for (const r of rows) issues[r.issue] = (issues[r.issue] ?? 0) + 1;
console.log(`  асуудлын төрөл: ${Object.keys(issues).length} — ${Object.entries(issues).map(([k, v]) => `${k}×${v}`).join(', ')}`);

const ok = caught / lintable >= 0.7 && falsePos.length === 0;
console.log(ok ? '\nOK' : '\nFAIL');
process.exit(ok ? 0 : 1);
