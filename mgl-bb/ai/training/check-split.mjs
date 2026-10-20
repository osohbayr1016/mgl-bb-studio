#!/usr/bin/env node
/**
 * `npm run ai:train:split [-- --json <out>] [--strict]`
 *
 * GAP-024 — сургалт / шалгалт / held-out / GOLD багцын тусгаарлалтыг `training/split-manifest.json`-оор
 * ХЭМЖИНЭ.  Асуулт бүрийг хэвийжүүлж (жижиг үсэг, цэг таслал/зайг нэгтгэх) тулгана:
 *   • train/val ↔ eval  ЯГ ИЖИЛ — 0 байх ЁСТОЙ (сургалтын жишээ нь үнэлгээний асуулт байж болохгүй);
 *   • train/val ↔ eval  ОЙРОЛЦОО (токены Jaccard ≥ 0.85) — 0 байх ёстой;
 *   • test ↔ eval — мэдээлэл (test нь сургалтад ордоггүй, held-out тийшээ ЗОРИУД шилждэг);
 *   • excluded_from_training ↔ eval — мэдээлэл: «дахин ангилсан» давхцлын тоо (багцын SFT толь).
 * `--strict` (эсвэл өгөгдмөл) train/val давхцалтай бол exit 1.
 *
 * ⚠️ Багцын SFT файл (`domain_sft_verified.jsonl`, `sft_seed.jsonl`) сургалтад ОРДОГГҮЙ — `train_lora.py
 *    --dataset behavior` зөвхөн training/out-ыг уншина (хэмжсэн: тэднийг уншдаг скрипт репод байхгүй).
 *    Энэ хэрэгсэл тэр баталгааг ил тоо болгоно; Session C-ийн training-lint нь тэднийг «SFT» гэж
 *    ерөнхийд нь уншдаг тул 902 яг ижил гоожилт гэж ХАРУУЛДАГ — тэр нь хэрэглэгддэггүй файлын давхцал.
 */
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const AI = resolve(HERE, '..');
const args = process.argv.slice(2);
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const manifest = JSON.parse(readFileSync(join(HERE, 'split-manifest.json'), 'utf8'));

// `data-train-files/<багц>/x.jsonl` хэлбэрийн glob (нэг түвшний од).
function expand(pattern) {
  const p = pattern.replace(/\\/g, '/');
  const star = p.indexOf('/*/');
  if (star < 0) return existsSync(join(AI, p)) ? [join(AI, p)] : [];
  const base = join(AI, p.slice(0, star));
  const rest = p.slice(star + 3);
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .map((d) => join(base, d, rest))
    .filter((f) => existsSync(f));
}

const normQ = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[«»"'“”‘’()[\]{}.,;:!?…\-–—/\\]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const tokens = (s) => new Set(normQ(s).split(' ').filter((t) => t.length > 1));
function jaccard(a, b) {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function readJsonl(file) {
  const out = [];
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (t.length === 0) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      /* lint нь тусдаа */
    }
  }
  return out;
}

/** SFT мөр → сүүлийн хэрэглэгчийн асуулт (serving-v2: «Асуулт: …» хэсэг). */
function sftQuestions(file) {
  const qs = [];
  for (const row of readJsonl(file)) {
    const msgs = Array.isArray(row?.messages) ? row.messages : [];
    const users = msgs.filter((m) => m?.role === 'user');
    const raw = String(users[users.length - 1]?.content ?? '');
    const m = /Асуулт(?:ууд)?:\s*([\s\S]+)$/u.exec(raw);
    const q = (m ? m[1] : raw).trim();
    if (q.length > 0) qs.push({ file, q });
  }
  return qs;
}

/** Үнэлгээний файл → асуултууд (JSON held-out, багцын тест/кейс, .mjs дотор бичсэн мөр). */
function evalQuestions(file) {
  const qs = [];
  const push = (q) => {
    if (typeof q === 'string' && q.trim().length > 0) qs.push({ file, q: q.trim() });
  };
  if (file.endsWith('.json')) {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    for (const c of j.cases ?? []) {
      push(c.question);
      for (const t of c.turns ?? []) push(t.q ?? t.question);
    }
  } else if (file.endsWith('.jsonl')) {
    for (const row of readJsonl(file)) {
      push(row.query);
      push(row.query_mn);
      push(row.query_latin);
      push(row.query_en);
      push(row.question);
    }
  } else if (file.endsWith('.mjs')) {
    // Алтан suite-ийн мөрүүд — 12+ тэмдэгттэй монгол/латин мөр литерал (кирилл эсвэл асуултын тэмдэгтэй).
    const src = readFileSync(file, 'utf8');
    // Ганц/давхар хашилтат, нэг мөрт, >=12 тэмдэгттэй литерал — кирилл агуулсан эсвэл «?»-ээр төгссөн.
    for (const m of src.matchAll(/'([^'\n]{12,})'|"([^"\n]{12,})"/g)) {
      const s = m[1] ?? m[2];
      if (/[А-Яа-яӨөҮүЁё]/.test(s) || /\?\s*$/.test(s)) push(s);
    }
  }
  return qs;
}

const sets = {};
for (const key of ['train', 'val', 'test']) sets[key] = manifest[key].flatMap(expand).flatMap(sftQuestions);
const evalFiles = Object.values(manifest.eval).flat().flatMap(expand);
const evalQs = evalFiles.flatMap(evalQuestions);
const excludedFiles = manifest.excluded_from_training.files.flatMap(expand);
const excludedQs = excludedFiles.flatMap(sftQuestions);

const evalExact = new Map();
for (const e of evalQs) {
  const k = normQ(e.q);
  if (!evalExact.has(k)) evalExact.set(k, e);
}
const evalTok = evalQs.map((e) => ({ e, t: tokens(e.q) }));

function overlap(list) {
  const exact = [];
  const fuzzy = [];
  for (const s of list) {
    const k = normQ(s.q);
    const hit = evalExact.get(k);
    if (hit !== undefined) {
      exact.push({ sft: basename(s.file), q: s.q.slice(0, 80), eval: basename(hit.file) });
      continue;
    }
    const t = tokens(s.q);
    if (t.size < 3) continue;
    const near = evalTok.find((x) => jaccard(t, x.t) >= 0.85);
    if (near !== undefined) fuzzy.push({ sft: basename(s.file), q: s.q.slice(0, 80), eval: basename(near.e.file), evalQ: near.e.q.slice(0, 80) });
  }
  return { exact, fuzzy };
}

const report = {
  manifest_version: manifest.version,
  counts: { train: sets.train.length, val: sets.val.length, test: sets.test.length, eval: evalQs.length, eval_files: evalFiles.length, excluded: excludedQs.length, excluded_files: excludedFiles.length },
  train_vs_eval: overlap(sets.train),
  val_vs_eval: overlap(sets.val),
  test_vs_eval: overlap(sets.test),
  excluded_vs_eval: overlap(excludedQs),
};
const n = (o) => `яг ${o.exact.length} · ойролцоо ${o.fuzzy.length}`;
console.log('MGL AI · сургалт/үнэлгээний тусгаарлалт (split-manifest.json)');
console.log(`  train ${report.counts.train} · val ${report.counts.val} · test ${report.counts.test} · eval асуулт ${report.counts.eval} (${report.counts.eval_files} файл) · сургалтаас хассан ${report.counts.excluded} (${report.counts.excluded_files} файл)`);
console.log(`  train ↔ eval:   ${n(report.train_vs_eval)}   ← 0 байх ЁСТОЙ`);
console.log(`  val   ↔ eval:   ${n(report.val_vs_eval)}   ← 0 байх ЁСТОЙ`);
console.log(`  test  ↔ eval:   ${n(report.test_vs_eval)}   (held-out нь test рүү ЗОРИУД шилждэг — мэдээлэл)`);
console.log(`  хассан ↔ eval:  ${n(report.excluded_vs_eval)}   (багцын SFT толь = дахин ангилсан давхцал; сургалтад ОРОХГҮЙ)`);
for (const x of [...report.train_vs_eval.exact, ...report.val_vs_eval.exact].slice(0, 10)) console.log(`   ✖ ${x.sft} ↔ ${x.eval}: «${x.q}»`);
for (const x of [...report.train_vs_eval.fuzzy, ...report.val_vs_eval.fuzzy].slice(0, 10)) console.log(`   ~ ${x.sft} ↔ ${x.eval}: «${x.q}» ≈ «${x.evalQ}»`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 2));
const bad = report.train_vs_eval.exact.length + report.train_vs_eval.fuzzy.length + report.val_vs_eval.exact.length + report.val_vs_eval.fuzzy.length;
if (bad > 0) {
  console.error(`  ✖ сургалтын багц үнэлгээний асуулт агуулж байна (${bad}) — build_behavior_sft.mjs-ийн хасалтыг шалга.`);
  process.exit(1);
}
console.log('  ✔ train/val нь үнэлгээний асуулт агуулаагүй.');
