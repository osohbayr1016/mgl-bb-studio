/**
 * MGL AI · LLAMA.CPP ХӨДӨЛГҮҮР — ПРОДАКШНЫ ЛОКАЛ ИНФЕРЕНС.
 *
 * ⚠️ ЯАГААД NATIVE BINDING БИШ, ДЭД ПРОЦЕСС ВЭ.  `node-llama-cpp` зэрэг
 *    уяа нь N-API-г эмхэтгэхийг шаарддаг: Windows дээр Visual Studio Build
 *    Tools + CUDA toolkit хэрэгтэй болж, 40 ажилтны машин бүрд суулгах нь
 *    бодит бус.  `llama-server` нь llama.cpp-ийн албан ёсны, урьдчилан
 *    бүтээгдсэн CUDA хоёртын файл — татаад л ажиллана.  Мөн процессын
 *    тусгаарлалт нь загвар унасан үед Node-ыг ХАМТ УНАГААХГҮЙ.
 *
 * ⚠️ ПРОЦЕСС НЬ БАЙНГА АСААЛТТАЙ.  §40: «persistent loaded model».  4B
 *    Q4_K_M-ийг ачаалахад секунд орчим — хүсэлт тутам ачаалах нь эхний
 *    токены хугацааг ХОЁР дахин муутгана.  Тиймээс `load()` нэг удаа
 *    асааж, процесс амьд үлдэнэ.
 *
 * ⚠️ ЗӨВХӨН 127.0.0.1.  `llama-server` нь ямар ч нэвтрэлтгүй — гадаад
 *    интерфейст холбогдвол сүлжээн дэх хэн ч ажилтны загварыг ашиглана.
 *    `--host 127.0.0.1` нь ХЭЛЭЛЦЭХГҮЙ.
 *
 * ⚠️ ТӨЛБӨРТЭЙ API РУУ ХЭЗЭЭ Ч ЗАЛГАХГҮЙ.  Энэ файлд гарч буй ганц
 *    сүлжээний хаяг нь `127.0.0.1:<port>`.  `test/engine.test.ts` нь энэ
 *    файлыг grep-дэж гадаад хостыг барина.
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { setPriority, constants as osConstants } from 'node:os';
import type {
  EngineHealth,
  EngineInfo,
  GenerateChunk,
  GenerateRequest,
  InferenceEngine,
} from './InferenceEngine.ts';
import { presetFor, isQuantized } from './samplingPreset.ts';
import { buildLlamaArgs, type LaunchPlan } from '../perfProfile.ts';
import { sampleGpu } from '../hardware.ts';
import { readTrainingLock, TRAINING_LOCK_MESSAGE } from '../trainingLock.ts';

export interface LlamaCppOptions {
  /** `llama-server` хоёртын файлын зам. */
  binaryPath: string;
  /** GGUF загварын зам. */
  modelPath: string;
  /** Локал порт — ЗӨВХӨН 127.0.0.1 дээр сонсоно. */
  port: number;
  /**
   * ⚠️ ГҮЙЦЭТГЭЛИЙН ТӨЛӨВЛӨГӨӨ — `contextTokens`/`gpuLayers`-ыг ОРЛОВ.
   *
   *    Өмнө нь энэ хоёр тоо Л дамждаг байсан бөгөөд thread, багц, KV
   *    кэшийн төрөл, процессын priority нь llama.cpp-ийн ӨГӨГДМӨЛӨӨР
   *    үлддэг байв.  Тэр өгөгдмөлүүд нь БЕНЧМАРКТ оновчлогдсон:
   *    бүх цөм, том багц, өндөр priority — өөрөөр хэлбэл яг
   *    «компьютерыг хөшилгө» гэсэн тохиргоо.  Одоо бүхэл төлөвлөгөө
   *    `perfProfile.ts`-ээс ирнэ (§7–§13).
   */
  plan: LaunchPlan;
  /**
   * LoRA адаптерын зам, эсвэл `null` (§15, §17).
   *
   * ⚠️ АДАПТЕР НЬ СУУРЬ ЗАГВАРААС ТУСДАА ФАЙЛ.  MGL AI 1.1 → 1.2
   *    шинэчлэлт нь ингэснээр 5 GB БИШ, хэдэн зуун MB болно (§19).
   */
  loraPath?: string | null;
  adapterVersion?: string | null;
  runtimeVariant: string;
  modelVersion: string | null;
  quantization: string | null;
  /** Процесс асахыг хүлээх дээд хугацаа, мс. */
  startupTimeoutMs?: number;
  /**
   * `<dataDir>/training.lock` — QLoRA сургалт GPU-г барьж байх үед ачаалахаас ТАТГАЛЗАНА
   * (`../trainingLock.ts`).  null = шалгахгүй (тест, echo).
   */
  trainingLockPath?: string | null;
  /** Дэд процессын stderr-ийг хаана бичих. */
  onLog?: (line: string) => void;
}

const DEFAULT_STARTUP_TIMEOUT_MS = 120_000;

/**
 * GPU-ийн backend АЧААЛАГДСАН эсэхийг шалгана.
 *
 * ⚠️ ЛОГ УНШИЖ ШАЛГАХ НЬ АЖИЛЛАХГҮЙ.  Эхний оролдлого нь эхлэлтийн
 *    логоос «offloaded N/N layers to GPU» гэсэн мөр хайдаг байсан.  Гэвч
 *    llama.cpp build b10850 нь тэр мөрийг ОГТ ХЭВЛЭДЭГГҮЙ (verbosity 3
 *    дээр ч) — үр дүнд нь загвар GPU дээр байхад «CPU дээр байна» гэсэн
 *    ХУДАЛ сэрэмжлүүлэг гардаг байв.  Худал дохио нь дохио байхгүйгээс
 *    ДОР: дараагийн хүн үүнийг үл тоомсорлож сурна.
 *
 * ⚠️ `--list-devices` нь АЛБАН ЁСНЫ хариулт бөгөөд 193 мс.  «(none)» гэж
 *    буцаавал CUDA backend ачаалагдаагүй нь тодорхой — ихэвчлэн CUDA-гийн
 *    runtime dll нь ТУСДАА «cudart-…» архивт байдгийг мартсанаас.
 *
 * ⚠️ Алдаа гарвал `true` буцаана — «мэдэхгүй» үед сэрэмжлүүлэхгүй.
 */
function hasGpuDevice(binaryPath: string): boolean {
  try {
    const out = execFileSync(binaryPath, ['--list-devices'], {
      encoding: 'utf8',
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (/^\s*\(none\)\s*$/m.test(out)) return false;
    return /CUDA\d|Vulkan\d|ROCm\d|SYCL\d|Metal/i.test(out);
  } catch {
    return true;
  }
}

export class LlamaCppEngine implements InferenceEngine {
  readonly #opts: LlamaCppOptions;
  #proc: ChildProcess | null = null;
  #loadedAt: number | null = null;
  /** CPU руу чимээгүй унасан бол шалтгааны тайлбар — `/info`-д гарна. */
  #gpuWarning: string | null = null;
  #loading: Promise<void> | null = null;
  /**
   * ⚠️ СУЛ ЗОГСОЛТЫН ХЭМЖҮҮР (§6).  Загвар нь 5-7 GB VRAM эзэлдэг тул
   *    ажилтан AI-г өдөржин нээхгүй бол тэр санах ойг барих нь ШУУД
   *    хохирол — Revit, хөтөч тэр VRAM-ыг хүсэж байна.  Гэхдээ хүсэлт
   *    бүрд ачаалж/буулгах нь эхний токены хугацааг сүйтгэнэ, тиймээс
   *    шийдвэр нь ХУГАЦААНЫ ХАРААР (`server.ts`-ийн сул зогсолтын
   *    таймер), хүсэлтийн тоогоор БИШ.
   */
  #lastUsedAt: number | null = null;
  /** Яг одоо явж буй үүсгэлтийн тоо — 0 болтол буулгахгүй. */
  #inFlight = 0;
  /**
   * ⚠️ ХЭМЖСЭН VRAM — ТААМАГЛААГҮЙ (§42).
   *
   *    `plan.estimatedVramPeakMb` нь ТӨЛӨВЛӨЛТИЙН тоо: загвар
   *    ачаалахаас ӨМНӨ шийдвэр гаргахад хэрэгтэй.  Ачаалсны дараа
   *    БОДИТ тоо мэдэгдэнэ — тайланд, диагностикт ТҮҮНИЙГ харуулна.
   *    Таамгийг хэмжилт мэт үзүүлэх нь §42-ийн зөрчил.
   *
   *    `null` = хэмжиж чадсангүй (nvidia-smi байхгүй), 0 ГЭСЭН ҮГ БИШ.
   */
  #measuredVramMb: number | null = null;

  constructor(opts: LlamaCppOptions) {
    this.#opts = opts;
  }

  get #base(): string {
    // ⚠️ Хатуу 127.0.0.1 — тохируулах боломжгүй байх нь ЗОРИУД.
    return `http://127.0.0.1:${this.#opts.port}`;
  }

  /** ⚠️ ИДЕМПОТЕНТ: зэрэгцээ дуудлагууд НЭГ процесс хуваалцана. */
  async load(): Promise<void> {
    if (this.#loadedAt !== null) return;
    if (this.#loading) return this.#loading;

    this.#loading = this.#start().finally(() => {
      this.#loading = null;
    });
    return this.#loading;
  }

  async #start(): Promise<void> {
    const { binaryPath, modelPath, port, plan } = this.#opts;
    const gpuLayers = plan.gpuLayers;

    if (!existsSync(binaryPath)) {
      throw new Error(
        `llama-server олдсонгүй: ${binaryPath}. «npm run ai:setup» ажиллуулж хоёртын файлыг суулгана уу.`,
      );
    }
    if (!existsSync(modelPath)) {
      throw new Error(
        `Загварын файл олдсонгүй: ${modelPath}. «npm run ai:model -- pull» ажиллуулна уу.`,
      );
    }
    // ⚠️ §2 — сургалт GPU-г барьж байвал 5.7 GB нэмж ачаалахгүй; хоёулаа sysmem руу халина.
    const lock = this.#opts.trainingLockPath ? readTrainingLock(this.#opts.trainingLockPath) : null;
    if (lock) {
      this.#opts.onLog?.(TRAINING_LOCK_MESSAGE(lock));
      throw new Error(TRAINING_LOCK_MESSAGE(lock));
    }
    // ⚠️ АДАПТЕР БАЙХГҮЙ БОЛ СУУРЬ ЗАГВАРААР ҮРГЭЛЖЛҮҮЛНЭ, УНАХГҮЙ.
    //    Тасарсан шинэчлэлт нь MGL AI-г бүхэлд нь зогсоох ЁСГҮЙ (§18).
    let loraPath = this.#opts.loraPath ?? null;
    if (loraPath !== null && !existsSync(loraPath)) {
      this.#opts.onLog?.(`⚠️ адаптер олдсонгүй, суурь загвараар үргэлжлүүлнэ: ${loraPath}`);
      loraPath = null;
    }

    const args = buildLlamaArgs({ modelPath, port, plan, loraPath, metrics: true });

    const proc = spawn(binaryPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.#proc = proc;

    /**
     * ⚠️ WINDOWS ПРОЦЕССЫН ЗЭРЭГЛЭЛ (§9) — `--prio`-ООС ӨӨР ДАВХАРГА.
     *
     *    `--prio` нь llama.cpp-ийн ДОТООД ажлын урсгалуудын зэрэглэлийг
     *    тохируулдаг; энэ нь ПРОЦЕСС бүхэлдээ Windows-ийн хуваарилагчид
     *    ямар жинтэй байхыг тодорхойлно.  Хоёулаа хэрэгтэй: эхнийх нь
     *    llama-ийн доторх, хоёр дахь нь llama vs ХӨТӨЧ.
     *
     * ⚠️ REALTIME/HIGH РУУ ХЭЗЭЭ Ч ТАВИХГҮЙ (§9-ийн хатуу шаардлага).
     *    BELOW_NORMAL нь MGL AI-г бусад програмд ЗАМ ТАВЬДАГ болгоно.
     *    Тэр нь яг зорилго: MGL AI бол ХОЙД ДЭВСГЭРИЙН туслах, benchmark
     *    БИШ.
     *
     * ⚠️ АЛДААГ ЗАЛГИНА.  Зэрэглэл тохируулах эрх байхгүй байх нь
     *    (бүлгийн бодлого, дүрэм) MGL AI-г ажиллуулахгүй байх ШАЛТГААН БИШ.
     */
    if (typeof proc.pid === 'number') {
      try {
        setPriority(
          proc.pid,
          plan.processPriority === 'below_normal'
            ? osConstants.priority.PRIORITY_BELOW_NORMAL
            : osConstants.priority.PRIORITY_NORMAL,
        );
        this.#opts.onLog?.(`процессын зэрэглэл: ${plan.processPriority} (pid ${proc.pid})`);
      } catch (err) {
        this.#opts.onLog?.(`⚠️ процессын зэрэглэл тохируулж чадсангүй: ${(err as Error).message}`);
      }
    }

    proc.stderr?.on('data', (b: Buffer) => this.#opts.onLog?.(b.toString().trimEnd()));
    proc.stdout?.on('data', (b: Buffer) => this.#opts.onLog?.(b.toString().trimEnd()));

    proc.on('exit', (code) => {
      this.#opts.onLog?.(`llama-server гарлаа, код=${code}`);
      this.#proc = null;
      this.#loadedAt = null;
    });

    const timeout = this.#opts.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    const deadline = Date.now() + timeout;

    // Эрүүл мэндийн хүлээлт — процесс эрт унавал шууд алдаа өгнө.
    while (Date.now() < deadline) {
      if (this.#proc === null) {
        const [code] = (await once(proc, 'exit').catch(() => [null])) as [number | null];
        throw new Error(`llama-server эхлэхгүй унав (код=${code ?? 'тодорхойгүй'}).`);
      }
      try {
        const res = await fetch(`${this.#base}/health`, { signal: AbortSignal.timeout(1500) });
        if (res.ok) {
          this.#loadedAt = Date.now();
          // ⚠️ ЧИМЭЭГҮЙ CPU-Д УНАСАНЫГ ИЛ ХЭЛНЭ.  GPU хүссэн атлаа
          //    аваагүй бол ажилтан «MGL AI удаан» гэж дүгнэхээс өмнө
          //    шалтгааныг нь мэдэх ёстой.
          /**
           * ⚠️ АЧААЛСНЫ ДАРАА БОДИТ VRAM-ЫГ ХЭМЖИНЭ.  Хүлээхгүй —
           *    хэмжилт нь `nvidia-smi` асаадаг (~15 мс) бөгөөд ачаалалт
           *    аль хэдийн дууссан тул хэрэглэгчийг саатуулахгүй.
           */
          void sampleGpu().then((g) => {
            if (g?.vramUsedMb != null) this.#measuredVramMb = g.vramUsedMb;
          });
          if (gpuLayers !== 0 && !hasGpuDevice(binaryPath)) {
            this.#gpuWarning =
              'GPU руу буулгаж ЧАДСАНГҮЙ — CPU дээр ажиллаж байна (10 дахин удаан). ' +
              'Ихэвчлэн CUDA-гийн runtime dll (cudart64_*.dll, cublas64_*.dll) дутсанаас болдог: ' +
              'тэдгээр нь llama.cpp-ийн ТУСДАА «cudart-…» архивт байдаг. ' +
              '«llama-server.exe --list-devices» нь (none) гэж хэлж байвал яг энэ шалтгаан.';
            this.#opts.onLog?.(`⚠️ ${this.#gpuWarning}`);
          }
          return;
        }
      } catch {
        // хараахан асаагүй — дахин оролдоно
      }
      await new Promise((r) => setTimeout(r, 400));
    }

    await this.unload();
    throw new Error(`llama-server ${timeout} мс дотор бэлэн болсонгүй.`);
  }

  async unload(): Promise<void> {
    const proc = this.#proc;
    this.#proc = null;
    this.#loadedAt = null;
    if (!proc || proc.killed) return;
    proc.kill();
    // Зөөлөн зогсоохыг 3 секунд хүлээгээд албадана — процесс үлдээх нь
    // VRAM-ыг барьж, дараагийн ачаалалт унана.
    const timer = setTimeout(() => proc.kill('SIGKILL'), 3000);
    await once(proc, 'exit').catch(() => undefined);
    clearTimeout(timer);
  }

  info(): EngineInfo {
    return {
      engine: 'llama.cpp',
      runtimeVariant: this.#opts.runtimeVariant,
      modelVersion: this.#opts.modelVersion,
      artifact: this.#opts.modelPath.split(/[\\/]/).pop() ?? null,
      quantization: this.#opts.quantization,
      contextTokens: this.#opts.plan.contextTokens,
      loaded: this.#loadedAt !== null,
      degradedReason: this.#gpuWarning,
      perfProfile: this.#opts.plan.profile,
      gpuLayers: this.#opts.plan.gpuLayers,
      estimatedVramPeakMb: this.#opts.plan.estimatedVramPeakMb,
      measuredGpuTotalMb: this.#measuredVramMb,
      adapterVersion: this.#opts.adapterVersion ?? null,
      idleMs: this.idleMs,
    };
  }

  /** ⚠️ §6 — сул зогсолтын шийдвэрт.  Хүсэлт ЯВЖ БАЙВАЛ буулгаж БОЛОХГҮЙ. */
  get busy(): boolean {
    return this.#inFlight > 0;
  }

  /** Сүүлд ашигласнаас хойших мс.  Ачаалагдаагүй бол `null`. */
  get idleMs(): number | null {
    if (this.#loadedAt === null) return null;
    return Date.now() - (this.#lastUsedAt ?? this.#loadedAt);
  }

  /** Одоо ачаалагдсан төлөвлөгөө — сул зогсолтоос сэрэхэд дахин хэрэглэнэ. */
  get plan(): LaunchPlan {
    return this.#opts.plan;
  }

  async health(): Promise<EngineHealth> {
    if (this.#loadedAt === null) {
      return { ok: false, loaded: false, detail: 'ачаалагдаагүй', uptimeMs: null };
    }
    try {
      const res = await fetch(`${this.#base}/health`, { signal: AbortSignal.timeout(2000) });
      return {
        ok: res.ok,
        loaded: true,
        detail: res.ok ? 'бэлэн' : `llama-server ${res.status}`,
        uptimeMs: Date.now() - this.#loadedAt,
      };
    } catch (err) {
      return {
        ok: false,
        loaded: true,
        detail: `холбогдож чадсангүй: ${(err as Error).message}`,
        uptimeMs: Date.now() - this.#loadedAt,
      };
    }
  }

  /**
   * ⚠️ ГЭРЭЭ: урсгал ЗААВАЛ `done` эсвэл `error`-оор дуусна.  `finally`
   *    блок нь тэрийг барина — дуусаагүй урсгал нь UI-ийн spinner-ийг
   *    мөнхөд эргүүлнэ.
   */
  async *generate(req: GenerateRequest): AsyncIterable<GenerateChunk> {
    // ⚠️ ТООЛУУРЫГ АЧААЛАХААС ӨМНӨ ӨСГӨНӨ.  Ачаалалт нь 10-20 секунд
    //    үргэлжилж болох ба тэр хугацаанд сул зогсолтын таймер асвал
    //    дөнгөж асаасан процессоо буулгана — мөнхийн эргэлт.
    this.#inFlight += 1;
    this.#lastUsedAt = Date.now();
    try {
      yield* this.#generate(req);
    } finally {
      this.#inFlight = Math.max(0, this.#inFlight - 1);
      this.#lastUsedAt = Date.now();
    }
  }

  async *#generate(req: GenerateRequest): AsyncIterable<GenerateChunk> {
    try {
      await this.load();
    } catch (err) {
      yield { type: 'error', message: (err as Error).message };
      return;
    }

    /**
     * ⚠️ ТҮҮВЭРЛЭЛТИЙН ӨГӨГДМӨЛ НЬ ЗАГВАРААС ГАРНА, ЭНД ХАТУУ БИЧИГДЭХГҮЙ.
     *
     *    Өмнө нь энд `temperature ?? 0.3`, `top_p ?? 0.9` гэж хатуу
     *    бичигдсэн байсан бөгөөд `top_k`, `min_p`, `presence_penalty`
     *    ОГТ илгээгддэггүй байв.  Qwen3-ийн загварын карт нь шуналт
     *    декодчилол «endless repetitions» үүсгэдэг гэж ТОДОРХОЙ
     *    сануулдаг ба 0.3 нь тэр рүү хальтирсан утга.  ХЭМЖСЭН: 0.3
     *    дээр 24 гүйлтийн 4 нь төгсгөлгүй давталтад орсон.
     *
     *    ⚠️ Танихгүй загварт `preset` нь `null` — тэр үед бид ЮУ Ч
     *       тулгахгүй, llama.cpp-ийн өөрийн өгөгдмөл үлдэнэ (§3-ын
     *       «Do not apply Qwen3 settings indiscriminately»).
     */
    // ⚠️ `info().artifact` -ыг дахин ашиглана: замыг таслах дүрэм НЭГ газар байх ёстой.
    const preset = presetFor(this.info().artifact);
    const quantized = isQuantized(this.#opts.quantization);

    const sampling: Record<string, number> = {};
    const put = (key: string, override: number | undefined, fallback: number | undefined) => {
      const v = override ?? fallback;
      if (v !== undefined) sampling[key] = v;
    };
    put('temperature', req.temperature, preset?.temperature);
    put('top_p', req.topP, preset?.topP);
    put('top_k', req.topK, preset?.topK);
    put('min_p', req.minP, preset?.minP);
    // ⚠️ Квантчилаагүй загварт торгууль тулгахгүй — Qwen3-ийн заавар нь
    //    үүнийг ЯЛАНГУЯА квантчилсан хувилбарт зөвлөдөг, мөн өндөр утга
    //    нь хэл холилдуулж болзошгүй гэж сануулдаг.
    put('presence_penalty', req.presencePenalty, quantized ? preset?.presencePenalty : undefined);

    const payload = {
      messages: req.turns.map((t) => ({ role: t.role, content: t.content })),
      max_tokens: req.maxTokens ?? 1024,
      ...sampling,
      /**
       * ⚠️ СЭТГЭХ ГОРИМЫГ УНТРААНА.
       *
       * Qwen3-ийн үндсэн загварууд (жишээ нь `Qwen3-8B`) нь `<think>`
       * блокт дотоод сэтгэлгээ үүсгэдэг ба тэр нь ӨГӨГДМӨЛӨӨР АСААЛТТАЙ.
       * Хэмжсэн (2026-09-09): `max_tokens: 180` дээр загвар БҮХ токеноо
       * сэтгэлгээнд зарцуулж, ХАРАГДАХ хариу ОГТ гаргаагүй —
       * `stop_reason: "length"`, хоосон текст.  Хэрэглэгчид «AI хариу
       * өгөхгүй байна» гэж харагдана.
       *
       * Бидний хэрэглээнд сэтгэх горим буруу: хариу нь ЭШЛЭЛТЭЙ, хайлтаар
       * баталгаажсан байх ёстой болохоос загварын дотоод дүгнэлтээр биш
       * (§15).  Мөн §40-ийн хурдны зорилтыг устгана.
       *
       * ⚠️ Сэтгэдэггүй загварт (`…-Instruct-2507`) ЭНЭ ТАЛБАР ХОРГҮЙ —
       *    Jinja template нь танихгүй kwargs-ыг зүгээр үл тоомсорлоно.
       */
      chat_template_kwargs: { enable_thinking: false },
      stop: req.stop ?? [],
      stream: true,
    };

    let res: Response;
    try {
      res = await fetch(`${this.#base}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: req.signal,
      });
    } catch (err) {
      const aborted = (err as Error).name === 'AbortError';
      yield aborted
        ? { type: 'done', stopReason: 'aborted', usage: { promptTokens: null, completionTokens: null } }
        : { type: 'error', message: `llama-server руу залгаж чадсангүй: ${(err as Error).message}` };
      return;
    }

    if (!res.ok || !res.body) {
      yield { type: 'error', message: `llama-server ${res.status}` };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let stopReason = 'stop';
    let usage: { promptTokens: number | null; completionTokens: number | null } = {
      promptTokens: null,
      completionTokens: null,
    };
    let finished = false;

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE — мөрүүд `\n\n`-ээр тусгаарлагдана.
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);

          for (const line of frame.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') {
              finished = true;
              continue;
            }
            let parsed: Record<string, unknown>;
            try {
              parsed = JSON.parse(data) as Record<string, unknown>;
            } catch {
              continue;
            }
            const choice = (parsed.choices as Record<string, unknown>[] | undefined)?.[0];
            const delta = choice?.delta as { content?: string } | undefined;
            if (delta?.content) yield { type: 'token', text: delta.content };
            if (typeof choice?.finish_reason === 'string') stopReason = choice.finish_reason;
            const u = parsed.usage as Record<string, number> | undefined;
            if (u) {
              usage = {
                promptTokens: u.prompt_tokens ?? null,
                completionTokens: u.completion_tokens ?? null,
              };
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') stopReason = 'aborted';
      else {
        yield { type: 'error', message: (err as Error).message };
        return;
      }
    } finally {
      reader.cancel().catch(() => undefined);
    }

    yield { type: 'done', stopReason: finished ? stopReason : stopReason || 'stop', usage };
  }
}
