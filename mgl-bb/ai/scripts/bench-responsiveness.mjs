/**
 * MGL AI · ХАРИУ ҮЙЛДЛИЙН ХЭМЖИЛТ (§7, §41, §42).
 *
 * ⚠️ ЭНЭ НЬ ТОКЕН/СЕК ХЭМЖДЭГ БЕНЧМАРК БИШ.  `ai:benchmark` нь хурдыг
 *    хэмждэг; ЭНЭ нь «үүсгэлт явж байхад КОМПЬЮТЕР ХЭР ХӨШИЖ БАЙНА»
 *    гэдгийг хэмжинэ.  Хоёр өөр асуулт бөгөөд бид эхнийхийг нь бага
 *    зэрэг золиослож хоёр дахийг нь сайжруулж байгаа тул ХОЁУЛАНГ нь
 *    хэмжих ёстой (§42).
 *
 * ХЭРХЭН ХЭМЖИХ ВЭ — ГУРВАН ХЭМЖҮҮР:
 *
 *   1. ХУВААРИЛАЛТЫН ХОЦРОГДОЛ (jitter).  8 мс тутам сэрэх ёстой таймер
 *      ХЭР ОРОЙТОЖ сэрж байна.  Энэ нь «хөтөч гацаж байна», «бичихэд
 *      үсэг хожимдож байна» гэсэн гомдлын ХЭМЖИГДЭХ хэлбэр: Windows-ийн
 *      хуваарилагч интерактив процессод цаг өгч чадахгүй бол яг энэ
 *      тоо өснө.  ⚠️ Энэ нь ХӨТЧИЙН биш, NODE-ийн хоцрогдол — гэхдээ
 *      хоёулаа ЖИРИЙН priority-тэй хэрэглэгчийн процесс тул ижил
 *      хуваарилагчийн дор өрсөлддөг.  Төгс бус ч ДАВТАГДАХ прокси.
 *
 *   2. АЖЛЫН ГҮЙЦЭТГЭЛ (throughput probe).  Тогтмол хэмжээний цэвэр CPU
 *      ажлыг (JSON задлан шинжлэл) давтаж, секундэд хэдэн удаа
 *      гүйцэтгэснийг тоолно.  Jitter нь «хэзээ сэрэв», энэ нь «сэрээд
 *      хэр их ажил хийж чадав» — хоёр өөр гажиг.
 *
 *   3. СИСТЕМИЙН НӨӨЦ.  llama-server-ийн CPU хугацаа, GPU ашиглалт,
 *      VRAM.  `nvidia-smi` байхгүй бол GPU хэсэг нь `null` — «GPU
 *      байхгүй» ГЭСЭН ҮГ БИШ.
 *
 * ХЭРЭГЛЭЭ:
 *   node scripts/bench-responsiveness.mjs                    # бүтэн
 *   node scripts/bench-responsiveness.mjs --label before     # шошготой
 *   node scripts/bench-responsiveness.mjs --idle             # зөвхөн суурь
 *
 * Үр дүн нь `ai/evaluation/benchmarks/responsiveness-<label>.json`-д.
 */
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';

const exec = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const AI_DIR = dirname(HERE);
const OUT_DIR = join(AI_DIR, 'evaluation', 'benchmarks');

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const next = args[i + 1];
  return next && !next.startsWith('--') ? next : true;
};

const LABEL = String(flag('label', 'run'));
const IDLE_ONLY = flag('idle', false) === true;
const ENGINE_PORT = Number(flag('engine-port', process.env.MGLAI_ENGINE_PORT ?? 39218));
const MAX_TOKENS = Number(flag('max-tokens', 400));

/** Хэмжилтийн үргэлжлэх хугацааны доод хязгаар — суурийг хэмжихэд. */
const IDLE_MS = Number(flag('idle-ms', 6000));

/* ================================================================== */
/*  1. ХУВААРИЛАЛТЫН ХОЦРОГДОЛ + АЖЛЫН ГҮЙЦЭТГЭЛ                       */
/* ================================================================== */

/**
 * ⚠️ ХОЁР ЗҮЙЛИЙГ НЭГ ГОГЦООНД ХЭМЖИНЭ.  Таймер сэрэх бүрд (а) хэр
 *    оройтсоныг, (б) тэр завсарт хэдэн нэгж ажил хийснийг бичнэ.
 *    Тусад нь хэмжвэл хоёр гүйлт өөр ачаалалтай таарна.
 */
function startProbe() {
  const TICK_MS = 8;
  const lateness = [];
  const workUnits = [];
  let stopped = false;
  let expected = performance.now() + TICK_MS;

  // Нэг «ажлын нэгж» — тогтмол хэмжээний цэвэр CPU ажил.
  const payload = JSON.stringify({
    rows: Array.from({ length: 60 }, (_, i) => ({ i, name: `мөр-${i}`, v: i * 3.14159 })),
  });
  const unit = () => {
    const o = JSON.parse(payload);
    let s = 0;
    for (const r of o.rows) s += r.v;
    return s;
  };

  const tick = () => {
    if (stopped) return;
    const now = performance.now();
    lateness.push(Math.max(0, now - expected));

    // ⚠️ Тогтмол ЦАГИЙН ХАЙРЦАГТ хэдэн нэгж багтсаныг тоолно — тогтмол
    //    нэгжийг хэдэн мс-д хийснийг БИШ.  Эхнийх нь хөшилтөд шууд
    //    мэдрэмтгий, хоёр дахь нь дунджаар нуугдана.
    const budgetEnd = performance.now() + 2;
    let n = 0;
    while (performance.now() < budgetEnd) {
      unit();
      n += 1;
    }
    workUnits.push(n);

    expected = now + TICK_MS;
    setTimeout(tick, TICK_MS);
  };
  setTimeout(tick, TICK_MS);

  return {
    stop() {
      stopped = true;
      return { lateness, workUnits };
    },
  };
}

function pct(sorted, p) {
  if (sorted.length === 0) return null;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Number(sorted[i].toFixed(2));
}

function summarize(samples) {
  if (samples.length === 0) return null;
  const s = [...samples].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return {
    n: s.length,
    mean: Number(mean.toFixed(2)),
    p50: pct(s, 50),
    p95: pct(s, 95),
    p99: pct(s, 99),
    max: Number(s[s.length - 1].toFixed(2)),
  };
}

/* ================================================================== */
/*  2. СИСТЕМИЙН НӨӨЦ                                                  */
/* ================================================================== */

async function gpuSample() {
  try {
    const { stdout } = await exec(
      'nvidia-smi',
      ['--query-gpu=utilization.gpu,memory.used', '--format=csv,noheader,nounits'],
      { timeout: 4000, windowsHide: true },
    );
    const [util, mem] = stdout.trim().split('\n')[0].split(',').map((s) => Number(s.trim()));
    return { utilPct: util, vramMb: mem };
  } catch {
    // ⚠️ `null` = ХЭМЖИЖ ЧАДСАНГҮЙ.  0 гэж бичих нь ХУДАЛ тоо болно.
    return null;
  }
}

/**
 * llama-server-ийн CPU хугацаа (секунд).  Ялгавраар нь CPU% гаргана.
 *
 * ⚠️ WMI-гаар авна — `tasklist` нь CPU хугацаа өгдөггүй.  Олдохгүй бол
 *    `null`, тэгэхээр тайланд «хэмжигдээгүй» гэж гарна.
 */
async function procCpuSeconds() {
  if (process.platform !== 'win32') return null;
  try {
    const { stdout } = await exec(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        "(Get-Process llama-server -ErrorAction SilentlyContinue | Measure-Object -Property CPU -Sum).Sum",
      ],
      { timeout: 8000, windowsHide: true },
    );
    const v = Number(stdout.trim());
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/* ================================================================== */
/*  3. ҮҮСГЭЛТ                                                         */
/* ================================================================== */

const PROMPT_MN =
  'Барилгын ажлын гүйцэтгэлийн тайланд ямар үндсэн хэсгүүд байх ёстойг дэлгэрэнгүй тайлбарлаж, ' +
  'жагсаалтаар гаргаж бичнэ үү. Хариултаа монголоор, тодорхой бүтэцтэй бич.';

async function generate(signalMs) {
  const started = performance.now();
  let firstTokenMs = null;
  let tokens = 0;
  let text = '';

  const res = await fetch(`http://127.0.0.1:${ENGINE_PORT}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: PROMPT_MN }],
      max_tokens: MAX_TOKENS,
      temperature: 0.7,
      top_p: 0.8,
      top_k: 20,
      min_p: 0,
      presence_penalty: 1.0,
      chat_template_kwargs: { enable_thinking: false },
      stream: true,
    }),
    signal: AbortSignal.timeout(signalMs),
  });
  if (!res.ok || !res.body) throw new Error(`llama-server ${res.status}`);

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const d = line.slice(5).trim();
        if (d === '[DONE]') continue;
        let p;
        try {
          p = JSON.parse(d);
        } catch {
          continue;
        }
        const t = p.choices?.[0]?.delta?.content;
        if (t) {
          if (firstTokenMs === null) firstTokenMs = performance.now() - started;
          tokens += 1;
          text += t;
        }
      }
    }
  }

  const totalMs = performance.now() - started;
  const genMs = firstTokenMs === null ? totalMs : totalMs - firstTokenMs;
  return {
    firstTokenMs: firstTokenMs === null ? null : Number(firstTokenMs.toFixed(1)),
    totalMs: Number(totalMs.toFixed(1)),
    tokens,
    tokensPerSec: genMs > 0 ? Number(((tokens / genMs) * 1000).toFixed(2)) : null,
    chars: text.length,
  };
}

/* ================================================================== */

async function measureWindow(label, ms, during) {
  const probe = startProbe();
  const gpuSamples = [];
  const cpuBefore = await procCpuSeconds();
  const wallStart = performance.now();

  const sampler = setInterval(async () => {
    const g = await gpuSample();
    if (g) gpuSamples.push(g);
  }, 700);

  let result = null;
  if (during) {
    result = await during();
  } else {
    await new Promise((r) => setTimeout(r, ms));
  }

  clearInterval(sampler);
  const wallMs = performance.now() - wallStart;
  const cpuAfter = await procCpuSeconds();
  const { lateness, workUnits } = probe.stop();

  const utils = gpuSamples.map((g) => g.utilPct);
  const vrams = gpuSamples.map((g) => g.vramMb);

  return {
    label,
    wallMs: Number(wallMs.toFixed(0)),
    // ⚠️ ХОЦРОГДОЛ — 8 мс таймер хэр оройтов.  Хамгийн чухал тоо.
    schedulingLatencyMs: summarize(lateness),
    // ⚠️ АЖЛЫН ГҮЙЦЭТГЭЛ — 2 мс хайрцагт хэдэн нэгж.  ӨНДӨР нь сайн.
    workPerTick: summarize(workUnits),
    // «Урт ажил» — 50 мс-ээс дээш оройтсон тохиолдлын тоо.  Хөтөч дээр
    // энэ нь ХАРАГДАХ гацалт.
    longStalls50ms: lateness.filter((x) => x >= 50).length,
    longStalls250ms: lateness.filter((x) => x >= 250).length,
    gpu:
      utils.length > 0
        ? {
            utilMeanPct: Number((utils.reduce((a, b) => a + b, 0) / utils.length).toFixed(1)),
            utilMaxPct: Math.max(...utils),
            vramPeakMb: Math.max(...vrams),
            samples: utils.length,
          }
        : null,
    llamaCpuSeconds:
      cpuBefore !== null && cpuAfter !== null ? Number((cpuAfter - cpuBefore).toFixed(2)) : null,
    /**
     * ⚠️ «CPU ЦӨМИЙН ЭКВИВАЛЕНТ» — CPU секунд / хана секунд.  20 логик
     *    урсгалтай машин дээр 12.0 гэдэг нь 12 урсгалыг бүтэн эзэлсэн
     *    гэсэн үг.  Энэ нь §10-ийн «бүх CPU-г бүү ид» шаардлагын
     *    ХЭМЖИГДЭХҮҮН.
     */
    llamaCpuCoresEquivalent:
      cpuBefore !== null && cpuAfter !== null && wallMs > 0
        ? Number((((cpuAfter - cpuBefore) * 1000) / wallMs).toFixed(2))
        : null,
    generation: result,
  };
}

async function main() {
  const os = await import('node:os');
  console.log(`\n  MGL AI · хариу үйлдлийн хэмжилт — «${LABEL}»`);
  console.log(`  CPU: ${os.cpus()[0]?.model?.trim()} (${os.cpus().length} логик)\n`);

  console.log('  1/2  Суурь (үүсгэлтгүй)…');
  const idle = await measureWindow('idle', IDLE_MS, null);
  console.log(
    `       хоцрогдол p95 ${idle.schedulingLatencyMs?.p95} мс · ажил/тик ${idle.workPerTick?.p50}`,
  );

  let load = null;
  if (!IDLE_ONLY) {
    console.log('  2/2  Үүсгэлт явж байхад…');
    try {
      load = await measureWindow('generating', 0, () => generate(180_000));
      console.log(
        `       хоцрогдол p95 ${load.schedulingLatencyMs?.p95} мс · ажил/тик ${load.workPerTick?.p50}` +
          ` · ${load.generation?.tokensPerSec} tok/s · TTFT ${load.generation?.firstTokenMs} мс`,
      );
    } catch (err) {
      console.error(`       ⚠️ Үүсгэлт амжилтгүй: ${err.message}`);
      console.error('       llama-server ажиллаж байгаа эсэхийг шалгана уу (npm run ai:status).');
    }
  }

  const report = {
    label: LABEL,
    at: new Date().toISOString(),
    host: {
      cpu: os.cpus()[0]?.model?.trim() ?? null,
      logicalCpus: os.cpus().length,
      ramMb: Math.round(os.totalmem() / 1024 / 1024),
      platform: `${os.platform()} ${os.release()}`,
    },
    enginePort: ENGINE_PORT,
    maxTokens: MAX_TOKENS,
    idle,
    load,
    /**
     * ⚠️ ХАРЬЦАА нь абсолют тооноос ЧУХАЛ.  Машин бүр өөр суурьтай тул
     *    «үүсгэлт явахад хоцрогдол ХЭД ДАХИН өссөн» гэдэг нь машин
     *    хооронд харьцуулагдана.
     */
    degradation:
      load && idle.schedulingLatencyMs && load.schedulingLatencyMs
        ? {
            latencyP95Ratio: Number(
              (load.schedulingLatencyMs.p95 / Math.max(0.01, idle.schedulingLatencyMs.p95)).toFixed(2),
            ),
            workP50Ratio:
              idle.workPerTick && load.workPerTick
                ? Number((load.workPerTick.p50 / Math.max(0.01, idle.workPerTick.p50)).toFixed(2))
                : null,
          }
        : null,
  };

  await mkdir(OUT_DIR, { recursive: true });
  const out = join(OUT_DIR, `responsiveness-${LABEL}.json`);
  await writeFile(out, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n  → ${out}\n`);

  if (report.degradation) {
    console.log(`  ХОЦРОГДЛЫН ӨСӨЛТ  p95 ×${report.degradation.latencyP95Ratio}`);
    console.log(`  АЖЛЫН УНАЛТ       p50 ×${report.degradation.workP50Ratio}`);
    console.log(`  50мс+ гацалт      ${load.longStalls50ms} (суурь ${idle.longStalls50ms})`);
    console.log(`  250мс+ гацалт     ${load.longStalls250ms} (суурь ${idle.longStalls250ms})`);
    if (load.llamaCpuCoresEquivalent !== null) {
      console.log(`  llama CPU цөм     ${load.llamaCpuCoresEquivalent} / ${os.cpus().length}`);
    }
    if (load.gpu) {
      console.log(`  GPU               ${load.gpu.utilMeanPct}% дунджаар · VRAM ${load.gpu.vramPeakMb} MB`);
    }
    console.log('');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
