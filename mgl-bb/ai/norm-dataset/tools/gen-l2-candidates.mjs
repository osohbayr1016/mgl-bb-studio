#!/usr/bin/env node
/**
 * L2.1 · ЗААЛТЫН ТАЙЛБАРЫН НЭР ДЭВШИГЧ (MODEL_DRAFT) ҮҮСГЭГЧ — локал Qwen (runtime `/generate`), сургалт БИШ, инференс л.
 *
 *   node ai/norm-dataset/tools/gen-l2-candidates.mjs norm-dataset/documents/BNbD_31-17-10 [--runtime http://127.0.0.1:39217]
 *        [--out l2/candidates.jsonl] [--only uid1,uid2] [--limit N] [--resume]
 *
 * Гаралт: `l2/candidates.jsonl` — мөр бүр `{clause_uid, candidate, model, generated_at, elapsed_ms, prompt_sha256}`.
 * Энэ файл ЭХ БИЧВЭР БИШ, ТАЙЛБАР Ч БИШ — зөвхөн нэр дэвшигч.  `build-l2.mjs --candidates` нь семантик шалгагчаар
 * (`l2-semantic.mjs`) нэг бүрчлэн шалгаж, PASS-ыг л `plain_mn_candidate` болгоно; FAIL → детерминист fallback хэвээр.
 * ⚠️ Загварын гаралтыг ЭНД шүүхгүй, засахгүй — шалгагч л шийднэ (нотолгоо үлдэнэ).
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const argv = process.argv.slice(2);
const dir = resolve(argv.find((a) => !a.startsWith('--')) ?? '');
const arg = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 ? (argv[i + 1] ?? d) : d; };
const runtime = arg('--runtime', 'http://127.0.0.1:39217');
const out = resolve(dir, arg('--out', 'l2/candidates.jsonl'));
const only = arg('--only');
const limit = Number(arg('--limit', '0'));
const resume = argv.includes('--resume');
const secret = readFileSync(join(process.env.LOCALAPPDATA ?? '', 'MglAi', 'secret.txt'), 'utf8').trim();

const recs = readFileSync(join(dir, 'l2', 'clause_explanations.jsonl'), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const done = new Set(resume && existsSync(out) ? readFileSync(out, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l).clause_uid) : []);
if (!resume && existsSync(out)) writeFileSync(out, '', 'utf8');
const wanted = recs.filter((r) => (only ? only.split(',').includes(r.clause_uid) : true) && !done.has(r.clause_uid)).slice(0, limit > 0 ? limit : undefined);

const SYSTEM = [
  'Чи Монголын барилгын нормын заалтыг инженерүүдэд ЭНГИЙН, ойлгомжтой мэргэжлийн монголоор тайлбарлагч.',
  'Дүрэм: (1) Зөвхөн өгсөн эх бичвэрт БАЙГАА утгыг 2–4 өгүүлбэрээр өөр үгээр, ойлгомжтой хэлнэ.',
  '(2) Эхийн «ёстой / хориглоно / зөвшөөрнө / болно» гэсэн заавал–хориглол–зөвшөөрлийн утгыг ЯГ хадгална — эсрэгээр нь хэлэхгүй.',
  '(3) Нөхцөл («… нөхцөлд», «… үед», «… бол») ба онцгой нөхцөл («…-аас бусад») бүрийг ХАДГАЛНА; шинэ нөхцөл, онцгой нөхцөл, хамрах хүрээ НЭМЭХГҮЙ («бүх», «ямар ч», «зөвхөн» гэж эхэд байхгүй бол бичихгүй).',
  '(4) Тоо, нэгж, харьцуулалтыг («багагүй», «ихгүй», «хүртэл») эхэд байгаа ЯГ хэлбэрээр; тооцоо, дүгнэлт хийхгүй.',
  '(5) Шалтгаан, зорилго, инженерийн үндэслэл, аюулгүй байдлын үр дагавар, хүчинтэй эсэх — эхэд байхгүй бол ХЭЛЭХГҮЙ.',
  '(6) Асуулт бичихгүй, шошго, гарчиг, жагсаалт, markdown хэрэглэхгүй; зөвхөн энгийн өгүүлбэрүүд.',
].join(' ');

const sha = (s) => createHash('sha256').update(s).digest('hex');
async function draft(rec) {
  const user = `Норм: ${rec.norm_code}. Заалт ${rec.clause_id}${rec.scope === 'appendix' ? ` (${rec.appendix}-р хавсралт)` : ''}. Хэсэг: ${rec.heading_path.join(' › ')}.\nЭх бичвэр: «${rec.source_text}»\nЭнгийн тайлбар (2–4 өгүүлбэр, монголоор):`;
  const turns = [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }];
  const t0 = Date.now();
  const r = await fetch(`${runtime}/generate`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mglai-secret': secret }, body: JSON.stringify({ turns, max_tokens: 320, response_language: 'mn-Cyrl' }) });
  const text = await r.text();
  let outText = '';
  let model = null;
  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue;
    try {
      const ev = JSON.parse(line.slice(5));
      if (ev.text) outText += ev.text;
      if (ev.model || ev.artifact) model = ev.model ?? ev.artifact;
    } catch { /* skip */ }
  }
  return { candidate: outText.replace(/<think>[\s\S]*?<\/think>/g, '').trim(), elapsed_ms: Date.now() - t0, model, prompt_sha256: sha(SYSTEM + user) };
}

let n = 0;
for (const rec of wanted) {
  n += 1;
  try {
    const d = await draft(rec);
    appendFileSync(out, JSON.stringify({ clause_uid: rec.clause_uid, candidate: d.candidate, model: d.model ?? 'runtime-default', generated_at: new Date().toISOString(), elapsed_ms: d.elapsed_ms, prompt_sha256: d.prompt_sha256, source_text_sha256: rec.source_text_sha256 }) + '\n', 'utf8');
    process.stderr.write(`\r  ${n}/${wanted.length} ${rec.clause_uid} ${d.elapsed_ms} ms   `);
  } catch (err) {
    appendFileSync(out, JSON.stringify({ clause_uid: rec.clause_uid, candidate: null, error: err instanceof Error ? err.message : String(err), generated_at: new Date().toISOString() }) + '\n', 'utf8');
    process.stderr.write(`\r  ${n}/${wanted.length} ${rec.clause_uid} АЛДАА   `);
  }
}
process.stderr.write(`\nнэр дэвшигч ${n} → ${out}\n`);
