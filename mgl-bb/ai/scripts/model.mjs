#!/usr/bin/env node
/**
 * `npm run ai:model -- <list|pull|activate|rollback|prune>`
 * `npm run ai:model -- <adapter-list|adapter-install <run>|adapter-activate <uid>|adapter-rollback|adapter-deactivate>`
 *
 * ⚠️ АДАПТЕРЫН ЛОКАЛ ПРОМОУШН (§24, 2026-09-11).  Сургасан нэр дэвшигч
 *    (`ai/models/adapters/<run>/<run>.lora.gguf`) нь ЭНЭ МАШИНЫ runtime-д л
 *    суулгагдана — `ModelManager`-ийн `candidateAdapter → activeAdapter →
 *    previousAdapter` гэсэн ижил төлөвөөр (updater.ts-ийн манифестийн замтай
 *    ИЖИЛ хэлбэр), тул `adapter-rollback` нь ГАНЦ тушаалаар өмнөх адаптер руу
 *    буцна, суурь GGUF-ыг ХӨНДӨХГҮЙ.  Бусад ажилтан руу ТАРААХГҮЙ — тэр нь
 *    D1 `ai_model_releases` + R2 артефакт (эзний релиз), энэ скрипт биш.
 *
 * ⚠️ ЗӨВХӨН БИДНИЙ МАНИФЕСТААС ТАТНА (§37).  HuggingFace эсвэл дурын URL
 *    руу заах туг ЭНЭ СКРИПТЭД БАЙХГҮЙ — тэр нь хорлогдсон артефактын
 *    хамгийн энгийн зам.  Артефакт бүр SHA-256-аар шалгагдана.
 *
 * ⚠️ ТОКЕН ХЭРЭГТЭЙ.  `MGLAI_TOKEN` орчны хувьсагчид ERP-ийн сессийн JWT.
 *    Манифест нь эрхээр хамгаалагдсан — ажилтны 4B ба захиалагчийн Lite
 *    нь ӨӨР хариу.
 */
import { loadConfig } from '../runtime/src/config.ts';
import { ModelManager } from '../runtime/src/modelManager.ts';
import { detectHardware, meetsRequirements } from '../runtime/src/hardware.ts';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const cfg = loadConfig();
const manager = new ModelManager({
  modelsDir: cfg.modelsDir,
  stateFile: cfg.stateFile,
  controlPlane: cfg.controlPlaneUrl,
});

const [cmd = 'list', arg] = process.argv.slice(2);
const token = process.env.MGLAI_TOKEN ?? '';

function need(v, msg) {
  if (!v) {
    process.stderr.write(`\n  ✖ ${msg}\n\n`);
    process.exit(1);
  }
}

switch (cmd) {
  case 'list': {
    const state = await manager.reconcile();
    process.stdout.write('\nСуулгасан загварууд\n');
    if (state.installed.length === 0) {
      process.stdout.write('  (байхгүй)\n');
    }
    for (const m of state.installed) {
      const marks = [
        m.releaseUid === state.active ? 'ИДЭВХТЭЙ' : null,
        m.releaseUid === state.previous ? 'буцах' : null,
      ]
        .filter(Boolean)
        .join(' ');
      process.stdout.write(
        `  ${m.version.padEnd(10)} ${m.runtimeVariant.padEnd(16)} ` +
          `${String(m.quantization ?? '?').padEnd(8)} ${Math.round(m.bytes / 1048576)} MB  ${marks}\n`,
      );
    }
    process.stdout.write(`\nДиск: ${Math.round((await manager.diskUsageBytes()) / 1048576)} MB\n\n`);
    break;
  }

  case 'pull': {
    need(token, 'MGLAI_TOKEN тохируулаагүй байна (ERP-ийн сессийн токен).');
    const hw = await detectHardware();
    const releases = await manager.fetchManifest(token);

    if (releases.length === 0) {
      // ⚠️ ХООСОН нь АЛДАА БИШ — админ хараахан релиз нийтлээгүй, эсвэл
      //    лиценз шалгагдаагүй (`license_cleared = 0`).
      process.stdout.write(
        '\n  Зөвшөөрөгдсөн релиз байхгүй байна.\n' +
          '  Шалтгаан нь ихэвчлэн: (а) админ релиз нийтлээгүй, эсвэл\n' +
          '  (б) суурь загварын лиценз хараахан шалгагдаагүй\n' +
          '      (`ai_model_releases.license_cleared = 0`).\n\n',
      );
      process.exit(0);
    }

    const target = arg ? releases.find((r) => r.version === arg) : releases[0];
    need(target, `«${arg}» хувилбар манифестад алга.`);

    const fit = meetsRequirements(hw, {
      minVramMb: target.min_vram_mb,
      minRamMb: target.min_ram_mb,
    });
    if (!fit.ok) {
      process.stderr.write(`\n  ✖ Энэ машин шаардлага хангахгүй: ${fit.reason}\n\n`);
      process.exit(1);
    }

    process.stdout.write(`\n  Татаж байна: ${target.version} · ${target.quantization}\n`);
    let lastPct = -1;
    const installed = await manager.install(target, token, (pct) => {
      if (pct !== lastPct && pct % 5 === 0) {
        lastPct = pct;
        process.stdout.write(`\r  ${pct}%`.padEnd(12));
      }
    });
    process.stdout.write(`\r  ✔ Суулгав: ${installed.version} (${Math.round(installed.bytes / 1048576)} MB)\n`);
    process.stdout.write(`  SHA-256 шалгагдсан.\n`);
    process.stdout.write(`\n  Идэвхжүүлэх:  npm run ai:model -- activate ${installed.releaseUid}\n\n`);
    break;
  }

  case 'activate': {
    need(arg, 'release_uid шаардлагатай.');
    const state = await manager.activate(arg);
    process.stdout.write(`\n  ✔ Идэвхтэй: ${state.active}\n  буцах: ${state.previous ?? '—'}\n`);
    process.stdout.write('\n  ⚠️ Локал үйлчилгээг ДАХИН асаа эсвэл /model/activate дуудна уу.\n\n');
    break;
  }

  case 'rollback': {
    const state = await manager.rollback();
    process.stdout.write(`\n  ✔ Буцлаа. Идэвхтэй: ${state.active}\n\n`);
    break;
  }

  case 'prune': {
    const removed = await manager.prune(Number(arg ?? 2));
    process.stdout.write(
      removed.length === 0
        ? '\n  Устгах зүйл алга.\n\n'
        : `\n  ✔ Устгав: ${removed.join(', ')}\n\n`,
    );
    break;
  }

  /* ── Адаптер (LoRA) — локал промоушн ────────────────────────────────── */
  case 'adapter-list': {
    const state = await manager.readState();
    process.stdout.write('\nСуулгасан адаптерууд\n');
    if (state.adapters.length === 0) process.stdout.write('  (байхгүй — суурь загвар л ажиллана)\n');
    for (const a of state.adapters) {
      const marks = [
        a.releaseUid === state.activeAdapter ? 'ИДЭВХТЭЙ' : null,
        a.releaseUid === state.previousAdapter ? 'буцах' : null,
        a.releaseUid === state.candidateAdapter ? 'НЭР ДЭВШИГЧ' : null,
      ].filter(Boolean).join(' ');
      process.stdout.write(`  ${a.releaseUid.padEnd(34)} ${a.version.padEnd(12)} ${Math.round(a.bytes / 1048576)} MB  ${a.sha256.slice(0, 12)}…  ${marks}\n`);
    }
    process.stdout.write(`\n  идэвхтэй: ${state.activeAdapter ?? '— (суурь)'} · буцах: ${state.previousAdapter ?? '—'} · нэр дэвшигч: ${state.candidateAdapter ?? '—'}\n\n`);
    break;
  }

  case 'adapter-install': {
    // `adapter-install <run>` — ai/models/adapters/<run>/<run>.lora.gguf → <dataDir>/models/adapters/<uid>.adapter.gguf (НЭР ДЭВШИГЧ гэж тэмдэглэнэ, идэвхжүүлэхгүй).
    need(arg, 'сургалтын run нэр шаардлагатай (ж: mgl-adapter-0.3).');
    const src = join(AI_DIR, 'models', 'adapters', arg, `${arg}.lora.gguf`);
    need(existsSync(src), `GGUF LoRA олдсонгүй: ${src}  (эхлээд: npm run ai:train:export -- --run ${arg})`);
    const exportReport = join(AI_DIR, 'training', 'reports', `export-${arg}.json`);
    const trainReport = join(AI_DIR, 'training', 'reports', `train-${arg}.json`);
    const exp = existsSync(exportReport) ? JSON.parse(readFileSync(exportReport, 'utf8')) : null;
    const tr = existsSync(trainReport) ? JSON.parse(readFileSync(trainReport, 'utf8')) : null;
    // ⚠️ Хэмжээгүй нэр дэвшигчийг суулгахгүй: compare-candidate-ийн тайлан байх ёстой, ДҮГНЭЛТ нь эзний шийдвэр.
    const compareDir = join(AI_DIR, 'training', 'reports');
    const { readdirSync } = await import('node:fs');
    const compares = readdirSync(compareDir).filter((f) => f.startsWith('candidate-vs-baseline-') && f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(compareDir, f), 'utf8'))).filter((r) => r.candidate === arg);
    need(compares.length > 0, `${arg}-ийн candidate-vs-baseline тайлан алга — эхлээд ai:eval:heldout + ai:compare (§24: үнэлгээгүй адаптер суулгагдахгүй).`);
    const latestCmp = compares.sort((a, b) => String(a.compared_at).localeCompare(String(b.compared_at))).at(-1);
    process.stdout.write(`\n  харьцуулалт: ${latestCmp.compared_at} → ${latestCmp.verdict}\n`);
    if (latestCmp.verdict !== 'CANDIDATE_APPROVED_FOR_REVIEW') process.stdout.write('  ⚠️ Дүгнэлт нь APPROVED_FOR_REVIEW биш — суулгаж болно, гэвч идэвхжүүлэх нь ЭЗНИЙ шийдвэр.\n');
    const bytes = statSync(src).size;
    const sha = createHash('sha256').update(readFileSync(src)).digest('hex');
    if (exp?.gguf?.sha256 && exp.gguf.sha256 !== sha) need(false, `SHA-256 зөрүү: экспортын тайлан ${exp.gguf.sha256.slice(0, 12)} ≠ файл ${sha.slice(0, 12)} — файл өөрчлөгдсөн.`);
    const uid = `local:${arg}`;
    const dir = join(cfg.modelsDir, 'adapters');
    mkdirSync(dir, { recursive: true });
    const dst = join(dir, `${uid.replace(/[^A-Za-z0-9._-]/g, '_')}.adapter.gguf`);
    copyFileSync(src, dst);
    const state = await manager.readState();
    state.adapters = [...state.adapters.filter((a) => a.releaseUid !== uid), {
      releaseUid: uid, version: arg, baseReleaseUid: null, path: dst, bytes, sha256: sha, installedAt: new Date().toISOString(),
      trainReport: tr ? { dataset: tr.dataset?.version, base_revision: tr.base_revision, eval_loss: tr.eval?.eval_loss } : null,
      compare: { at: latestCmp.compared_at, verdict: latestCmp.verdict },
    }];
    state.candidateAdapter = uid;
    await manager.writeState(state);
    process.stdout.write(`  ✔ Нэр дэвшигч суулгав: ${uid} → ${dst} (${Math.round(bytes / 1048576)} MB, sha ${sha.slice(0, 12)}…)\n`);
    process.stdout.write(`  Идэвхжүүлэх (ЭЗНИЙ шийдвэр):  npm run ai:model -- adapter-activate ${uid}\n\n`);
    break;
  }

  case 'adapter-activate': {
    need(arg, 'adapter uid шаардлагатай (adapter-list үз).');
    const state = await manager.activateAdapter(arg);
    process.stdout.write(`\n  ✔ Идэвхтэй адаптер: ${state.activeAdapter}\n  буцах: ${state.previousAdapter ?? '— (суурь)'}\n`);
    process.stdout.write('\n  ⚠️ Локал үйлчилгээг ДАХИН асаа: npm run ai:stop && npm run ai:start  (llama-server нь --lora-г эхлэхдээ уншина).\n\n');
    break;
  }

  case 'adapter-deactivate': {
    const state = await manager.activateAdapter(null);
    process.stdout.write(`\n  ✔ Адаптергүй (суурь загвар).  буцах: ${state.previousAdapter ?? '—'}\n  ⚠️ npm run ai:stop && npm run ai:start\n\n`);
    break;
  }

  case 'adapter-rollback': {
    const state = await manager.rollbackAdapter();
    process.stdout.write(`\n  ✔ Буцлаа.  Идэвхтэй адаптер: ${state.activeAdapter ?? '— (суурь)'}  ·  буцах: ${state.previousAdapter ?? '—'}\n  ⚠️ npm run ai:stop && npm run ai:start\n\n`);
    break;
  }

  default:
    process.stderr.write(`\n  Танихгүй тушаал: ${cmd}\n  list | pull | activate | rollback | prune | adapter-list | adapter-install <run> | adapter-activate <uid> | adapter-deactivate | adapter-rollback\n\n`);
    process.exit(1);
}
