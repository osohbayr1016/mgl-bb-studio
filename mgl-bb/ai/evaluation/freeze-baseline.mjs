#!/usr/bin/env node
/**
 * `npm run ai:baseline:freeze [-- --gen <conv-e2e-gen file>] [--heldout <heldout-gen file>] [--norm <file>] [--company <file>] [--label <text>]`
 *
 * СУРГАЛТЫН ӨМНӨХ СУУРИЙГ ХӨЛДӨӨНӨ (§9) — хувилбартай, ӨӨРЧЛӨГДӨХГҮЙ файл.
 *
 * ⚠️ ЯАГААД ЭНЭ ФАЙЛ ХЭРЭГТЭЙ ВЭ.  Адаптер бүр «СУУРЬТАЙ харьцуулахад
 *    ямар вэ» гэдгээр л шүүгдэнэ.  Суурь нь зөвхөн жин биш — систем заавар,
 *    гэрээ, хэрэгслийн схем, мэдлэгийн сан, түүвэрлэлт, үнэлгээний багц
 *    бүгд хариултад нөлөөлдөг.  Эдгээрийн АЛЬ НЭГ нь солигдвол «сайжрал»
 *    нь адаптерынх уу, өөр зүйлийнх үү гэдгийг ялгах боломжгүй.  Тиймээс
 *    бүгдийг НЭГ id-тай баримтад хөлдөөж, тайлан бүр тэр id-г эшилнэ.
 *
 * ⚠️ ЭНД ХЭМЖЭЭГҮЙ ТОО БАЙХГҮЙ.  Хэш бүр файлаас, хувилбар бүр эх кодоос,
 *    runtime-ийн мэдээлэл амьд `/info`-оос.  Олдохгүй зүйл `null` — таамаглахгүй.
 *
 * ⚠️ id = `base-<огноо>-<prompt_version>-<артефактын sha8>` — ижил хослол
 *    дээр дахин ажиллуулбал ижил файл ДАХИН БИЧИГДЭХГҮЙ (`--force`-гүйгээр).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(sp, c, n) {
    if (/^\.{1,2}\//.test(sp) && !/\.[cm]?[jt]sx?$/.test(sp)) return n(sp + '.ts', c);
    return n(sp, c);
  },
});

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const REPO = path.resolve(HERE, '..', '..');
const OUT_DIR = path.join(HERE, 'baselines');
const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i === -1 ? d : (argv[i + 1] ?? d);
};
const sha256File = (p) => (fs.existsSync(p) ? createHash('sha256').update(fs.readFileSync(p)).digest('hex') : null);
const sha256Text = (t) => createHash('sha256').update(t).digest('hex');
const gitHash = (p) => {
  try {
    return execFileSync('git', ['log', '-1', '--format=%h %cI', '--', p], { cwd: REPO, encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
};
const gitHead = () => {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
};
const fileUrl = (p) => `file:///${p.replace(/\\/g, '/')}`;

/* ── Систем хувилбарууд — ЭХ КОДООС ─────────────────────────────── */
const B = path.join(REPO, 'backend', 'src', 'lib', 'mglai');
const VER = await import(fileUrl(path.join(B, 'version.ts')));
const TF = await import(fileUrl(path.join(B, 'trustedFacts.ts')));
const SP = await import(fileUrl(path.join(REPO, 'ai', 'runtime', 'src', 'engine', 'samplingPreset.ts')));

/* ── Суурь загвар — registry ─────────────────────────────────────── */
const reg = JSON.parse(fs.readFileSync(path.join(REPO, 'ai', 'registry', 'models.json'), 'utf8'));
const variantName = flag('variant', 'employee-8b-q4');
const cand = reg.candidates.find((c) => c.runtime_variant === variantName) ?? null;
if (!cand) throw new Error(`registry-д ${variantName} алга`);

/* ── Runtime — амьд /info + локал мэдлэг ─────────────────────────── */
const RT = flag('rt', 'http://127.0.0.1:39217');
let secret = '';
try {
  secret = fs.readFileSync(path.join(process.env.LOCALAPPDATA ?? '', 'MglAi', 'secret.txt'), 'utf8').trim();
} catch {}
async function rt(p) {
  try {
    const r = await fetch(`${RT}${p}`, { headers: { 'X-MglAi-Secret': secret } });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
const info = await rt('/info');
const normInfo = await rt('/norm/info');
let llamaVersion = null;
try {
  // llama-server нь хувилбараа STDERR-т бичдэг.
  const r = spawnSync(path.join(process.env.LOCALAPPDATA ?? '', 'MglAi', 'bin', 'llama-server.exe'), ['--version'], { encoding: 'utf8' });
  llamaVersion = `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n').map((l) => l.trim()).find((l) => /version|build/i.test(l)) ?? null;
} catch {
  llamaVersion = null;
}
const modelsDir = path.join(process.env.LOCALAPPDATA ?? '', 'MglAi', 'models');
const artifactPath = info?.engine?.artifact ? path.join(modelsDir, info.engine.artifact) : null;
const artifactBytes = artifactPath && fs.existsSync(artifactPath) ? fs.statSync(artifactPath).size : null;
// ⚠️ 5 GB-ийн хэшийг дахин тооцохгүй — registry-ийн хэмжсэн утгыг ХЭМЖЭЭ таарвал л авна.
const artifactSha = artifactBytes !== null && artifactBytes === cand.artifact_bytes && info?.engine?.artifact === cand.gguf_file ? cand.artifact_sha256 : sha256File(artifactPath ?? '');

/* ── Үнэлгээний багц — файлын хэш ────────────────────────────────── */
const evalFiles = {
  'conversation-e2e.mjs': path.join(HERE, 'conversation-e2e.mjs'),
  'heldout-gen.mjs': path.join(HERE, 'heldout-gen.mjs'),
  'heldout-cases.json': path.join(HERE, 'heldout-cases.json'),
  'norm-golden.mjs': path.join(HERE, 'norm-golden.mjs'),
  'company-golden.mjs': path.join(HERE, 'company-golden.mjs'),
  'mn-conversation.mjs': path.join(HERE, 'mn-conversation.mjs'),
  'style-pairs.mjs': path.join(HERE, 'style-pairs.mjs'),
  'mn_style_pairs.jsonl': path.join(REPO, 'ai', 'training', 'mn_style_pairs.jsonl'),
  'lib/repetition.mjs': path.join(HERE, 'lib', 'repetition.mjs'),
  'lib/style.mjs': path.join(HERE, 'lib', 'style.mjs'),
};
const evaluation = Object.fromEntries(Object.entries(evalFiles).map(([k, p]) => [k, sha256File(p)]));

/* ── Кернел / зохион байгуулалт — контентын хэш + git ────────────── */
const kernelFiles = fs.readdirSync(B).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).sort();
const kernelHash = sha256Text(kernelFiles.map((f) => `${f}\n${fs.readFileSync(path.join(B, f), 'utf8')}`).join('\n'));
const orchestratorPath = path.join(REPO, 'frontend', 'src', 'features', 'mgl-ai', 'lib', 'orchestrator.ts');
const validatorPath = path.join(REPO, 'frontend', 'src', 'features', 'mgl-ai', 'lib', 'validator.ts');
const routePath = path.join(REPO, 'backend', 'src', 'routes', 'mglAi.ts');

const promptVersion = VER.MGL_AI_PROMPT_VERSION;
const id = `base-${new Date().toISOString().slice(0, 10)}-${promptVersion}-${(artifactSha ?? 'nohash').slice(0, 8)}`;
const outPath = path.join(OUT_DIR, `${id}.json`);
if (fs.existsSync(outPath) && !argv.includes('--force')) {
  console.log(`суурь аль хэдийн хөлдөөсөн: ${outPath} (--force дахин бичнэ)`);
  process.exit(0);
}

const baseline = {
  baseline_id: id,
  label: flag('label', 'pre-training baseline'),
  frozen_at: new Date().toISOString(),
  git_head: gitHead(),
  foundation: {
    model: cand.base_model,
    revision: cand.base_model_revision ?? null,
    license: cand.license?.spdx ?? null,
    license_file_sha256: cand.license?.license_file_sha256 ?? null,
    license_cleared_by_owner: cand.license_cleared === true,
  },
  serving_artifact: {
    repo: cand.gguf_repo ?? null,
    repo_revision: cand.gguf_repo_revision ?? null,
    file: info?.engine?.artifact ?? cand.gguf_file,
    bytes: artifactBytes,
    sha256: artifactSha,
    quantization: info?.engine?.quantization ?? cand.quantization,
    adapter: info?.engine?.adapterVersion ?? null,
    model_version_tag: info?.engine?.modelVersion ?? null,
  },
  runtime: {
    runtime_version: info?.runtime_version ?? null,
    engine: info?.engine?.engine ?? null,
    llama_cpp: llamaVersion,
    context_tokens: info?.engine?.contextTokens ?? null,
    perf_profile: info?.perf?.profile ?? null,
    plan: info?.perf?.plan ? { kvCacheType: info.perf.plan.kvCacheType, gpuLayers: info.perf.plan.gpuLayers, ubatchSize: info.perf.plan.ubatchSize, flashAttention: info.perf.plan.flashAttention } : null,
    sampling: SP.presetFor(info?.engine?.artifact ?? cand.gguf_file),
    enable_thinking: false,
  },
  system: {
    product_version: VER.MGL_AI_VERSION,
    system_prompt_version: promptVersion,
    tool_schema_version: VER.MGL_AI_TOOL_SCHEMA_VERSION,
    retrieval_version: VER.MGL_AI_RETRIEVAL_VERSION,
    contract_version: TF.TRUSTED_CONTRACT_VERSION,
    kernel_files: kernelFiles.length,
    kernel_sha256: kernelHash,
    orchestrator: { sha256: sha256File(orchestratorPath), git: gitHash(orchestratorPath) },
    validator: { sha256: sha256File(validatorPath), git: gitHash(validatorPath) },
    route: { sha256: sha256File(routePath), git: gitHash(routePath) },
  },
  knowledge: normInfo
    ? {
        installed: normInfo.installed,
        documents: (normInfo.documents ?? []).map((d) => ({ doc_id: d.doc_id, code: d.code, effective_status: d.effective_status, ingested_at: d.ingested_at })),
        counts: normInfo.counts ?? null,
        vector: normInfo.vector ?? null,
        db_sha256: sha256File(normInfo.path ?? ''),
      }
    : null,
  evaluation,
  outputs: {
    conv_e2e_gen: flag('gen', null),
    heldout_gen: flag('heldout', null),
    norm_golden: flag('norm', null),
    company_golden: flag('company', null),
  },
};
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(baseline, null, 2) + '\n', 'utf8');
console.log(`суурь хөлдөөв → ${outPath}`);
console.log(JSON.stringify({ id, foundation: baseline.foundation.model, revision: baseline.foundation.revision, artifact: baseline.serving_artifact.sha256?.slice(0, 12), prompt: promptVersion, contract: baseline.system.contract_version, knowledge_docs: baseline.knowledge?.documents.length ?? null }, null, 1));
