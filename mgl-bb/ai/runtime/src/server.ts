/**
 * MGL AI · ЛОКАЛ ҮЙЛЧИЛГЭЭ (§39).
 *
 * ⚠️ ЗӨВХӨН 127.0.0.1.  Хост нь `config.ts`-д тогтмол — тохируулах
 *    боломжгүй байх нь аюулгүй байдлын шийдвэр.
 *
 * ⚠️ ГАРЦУУД:
 *      GET  /health          — нэвтрэлтгүй, ЗӨВХӨН «амьд эсэх».  Порт
 *                              эзэлсэн эсэхийг шалгахад хэрэгтэй бөгөөд
 *                              ямар ч мэдээлэл задруулахгүй.
 *      POST /session         — нууцыг богино хугацаат токен болгож солино
 *      GET  /info            — хөдөлгүүр, төхөөрөмж, загварын байдал
 *      POST /generate        — SSE урсгал  ← ГОЛ ГАРЦ
 *      POST /bench           — гүйцэтгэлийн хэмжилт
 *      POST /model/activate  — суулгасан хувилбар руу солих
 *      POST /shutdown        — зөв зогсоох
 *
 * ⚠️ `/generate` нь PROMPT-ЫГ УГСАРДАГГҮЙ.  Угсралт нь Worker-ийн
 *    `/api/mgl-ai/context`-д, ЭРХИЙН ШҮҮЛТИЙН ДАРАА явагдана.  Хэрэв
 *    локал үйлчилгээ өөрөө контекст цуглуулбал нууцлалын шүүлт нь
 *    ажилтны PC дээр давхардаж, хоёр хувилбар нэг өдөр зөрнө.  Локал
 *    үйлчилгээ нь ТОКЕН ҮҮСГЭГЧ, шийдвэр гаргагч БИШ.
 */
import { handleTurn } from './turn.ts';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { loadConfig, RUNTIME_VERSION, BIND_HOST, serverBinaryName, type RuntimeConfig } from './config.ts';
import { StreamingRepetitionGuard } from './repetition.ts';
import { estimateTokens, flattenTurns } from './engine/InferenceEngine.ts';
import { SessionStore, authenticate, newSecret } from './auth.ts';
import { detectHardware, planVariant, sampleGpu, type HardwareProfile } from './hardware.ts';
import { ModelManager } from './modelManager.ts';
import {
  autoProfile,
  isPerfProfile,
  kvBytesPerToken,
  planLaunch,
  PERF_PROFILES,
  PROFILE_LABEL_MN,
  type LaunchPlan,
  type PerfProfile,
} from './perfProfile.ts';
import { CredentialStore, Updater, idleStatus, type UpdateStatus } from './updater.ts';
import { EchoEngine } from './engine/EchoEngine.ts';
import { LlamaCppEngine } from './engine/LlamaCppEngine.ts';
import type { InferenceEngine, EngineTurn } from './engine/InferenceEngine.ts';
import type { DatabaseSync } from 'node:sqlite';
import { existsSync, statSync } from 'node:fs';
import { openKnowledgeDb, knowledgeSchemaVersion, SCHEMA_VERSION, isKnowledgeInfrastructureError, KnowledgeUnavailableError } from '../../retrieval/src/db.ts';
import { askNorm, datasetIdentityOf } from '../../retrieval/src/pipeline.ts';
import { createHash } from 'node:crypto';
import { identityLines, fingerprintFromHex, toWire, type NormDocumentIdentity } from '@mgl/mglai-common/normIdentity';
import { executableVerificationSql } from '../../retrieval/src/rules.ts';
import { normCatalog } from '../../retrieval/src/catalog.ts';
import { searchRegistry, lookupRegistryCode, registryCount } from '../../retrieval/src/registry.ts';
import { routeTopics, topicCatalog, topicRouterCount } from '../../retrieval/src/topicRouter.ts';
import { explainForAnswer, explanationCounts, explainedDocIdForCode, explanationByClause, sectionExplanation, documentExplanation, tableByNo, formulaByLabel, objectCounts, EXPLANATION_SCHEMA } from '../../retrieval/src/explain.ts';
// Session B — суулгац/флот/health давхарга.  Runtime-ийн дотоод төлөв рүү ордоггүй,
// өөрийн нийтийн гарцаар л шалгадаг (`ai/deployment/src/agent.ts`).
import { createDeploymentAgent, type DeploymentAgent } from '../../deployment/src/agent.ts';
import { isTelemetryLevel } from '../../deployment/src/telemetry.ts';
import { resolveLayout } from '../../deployment/src/layout.ts';
import { readPointer, activateSingleComponent, readUpdateState, switchModel } from '../../deployment/src/activation.ts';
import { resolveKnowledgeDb, runningCodeVersion } from '../../deployment/src/probes.ts';
import { InstalledStateStore } from '../../deployment/src/installedState.ts';

const MAX_BODY_BYTES = 1_000_000;

function log(msg: string): void {
  process.stdout.write(`[mgl-ai] ${new Date().toISOString()} ${msg}\n`);
}

/**
 * ХЭРЭГЛЭГЧИЙН ТОХИРГОО (§13).
 *
 * ⚠️ ЭНЭ ФАЙЛ БАЙХГҮЙ БАЙХ НЬ ХЭВИЙН — суулгацын дараа хэрэглэгч ЮУ Ч
 *    тохируулаагүй байх нь ХҮССЭН байдал (§3, §13: «Do not force users
 *    to configure this during installation»).  Тэр үед профайл нь
 *    төхөөрөмжөөс АВТОМАТААР сонгогдоно.
 */
interface RuntimeSettings {
  perfProfile: PerfProfile | null;
}

async function readSettings(cfg: RuntimeConfig): Promise<RuntimeSettings> {
  try {
    const raw = await readFile(cfg.settingsFile, 'utf8');
    const parsed = JSON.parse(raw) as Partial<RuntimeSettings>;
    return { perfProfile: isPerfProfile(parsed.perfProfile) ? parsed.perfProfile : null };
  } catch {
    return { perfProfile: null };
  }
}

async function writeSettings(cfg: RuntimeConfig, next: RuntimeSettings): Promise<void> {
  await mkdir(cfg.dataDir, { recursive: true });
  await writeFile(cfg.settingsFile, JSON.stringify(next, null, 2), 'utf8');
}

/**
 * Хүчинтэй профайлыг шийднэ.
 *
 * ⚠️ ДАРААЛАЛ: env (хөгжүүлэлт) → хэрэглэгчийн сонголт → АВТОМАТ.
 *    Автомат нь ЭЦСИЙН ЗАМ бөгөөд яг тэр нь §13-ийн «Auto-select
 *    initially, allow optional setting later» шаардлага.
 */
function resolveProfile(
  cfg: RuntimeConfig,
  settings: RuntimeSettings,
  hw: HardwareProfile,
): { profile: PerfProfile; source: 'env' | 'user' | 'auto' } {
  if (cfg.perfProfileEnv !== null && isPerfProfile(cfg.perfProfileEnv)) {
    return { profile: cfg.perfProfileEnv, source: 'env' };
  }
  if (settings.perfProfile !== null) return { profile: settings.perfProfile, source: 'user' };
  return { profile: autoProfile(hw), source: 'auto' };
}

async function ensureSecret(cfg: RuntimeConfig): Promise<string> {
  await mkdir(cfg.dataDir, { recursive: true });
  try {
    const existing = (await readFile(cfg.secretFile, 'utf8')).trim();
    if (existing.length >= 32) return existing;
  } catch {
    // байхгүй — доор үүсгэнэ
  }
  const secret = newSecret();
  // ⚠️ 0o600 — зөвхөн эзэн уншина.  Windows дээр энэ горим бүрэн
  //    хэрэгжихгүй ч LOCALAPPDATA нь аль хэдийн хэрэглэгчийн ACL-тэй.
  await writeFile(cfg.secretFile, secret, { encoding: 'utf8', mode: 0o600 });
  log(`Шинэ суулгацын нууц үүсгэв: ${cfg.secretFile}`);
  return secret;
}

/**
 * Файлын нэрнээс quantization-ыг таана («…-Q4_K_M.gguf» → «Q4_K_M»).
 *
 * ⚠️ Зөвхөн ТЭМДЭГЛЭГЭЭНД — гүйцэтгэлд нөлөөлөхгүй.  Таамаглаж чадахгүй
 *    бол `null` буцаана: буруу шошго нааснаас тодорхойгүй нь дээр.
 */
function quantFromName(name: string): string | null {
  const m = /[-_.](IQ\d[A-Z_]*|Q\d(?:_[A-Z0-9]+)*|F16|BF16|F32)\.gguf$/i.exec(name);
  return m ? m[1]!.toUpperCase() : null;
}

/**
 * Файлын нэрнээс `runtime_variant` шошгыг гаргана
 * («Qwen3-8B-Q4_K_M.gguf» → «employee-8b-q4»).
 *
 * ⚠️ ШОШГО ҮНЭН БАЙХ ЁСТОЙ.  Өмнө нь `planVariant`-ийн хатуу бичсэн
 *    'employee-4b-q4' -ийг ашигладаг байсан тул 8B загвар ажиллаж байхад
 *    метадата «4b» гэж ХУДАЛ хэлдэг байв.  Гүйцэтгэлийн хэмжилт, санал
 *    хүсэлт, релизийн бүртгэл бүгд `runtime_variant`-аар бүлэглэгддэг —
 *    худал шошго нь бүгдийг буруу загварт хамааруулна.
 */
function variantFromName(name: string): string {
  const size = /(\d+(?:\.\d+)?)\s*B[-_.]/i.exec(name)?.[1]?.toLowerCase() ?? '?';
  const quant = quantFromName(name);
  const q = quant ? quant.split('_')[0]!.toLowerCase() : 'unknown';
  return `employee-${size}b-${q}`;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error('Хүсэлтийн бие хэт том.');
    chunks.push(c as Buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

/** CORS — ЗӨВХӨН цагаан жагсаалтын гарал үүсэлд. */
function cors(req: IncomingMessage, res: ServerResponse, cfg: RuntimeConfig): boolean {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && cfg.allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-MglAi-Secret, X-MglAi-Session');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}

/* ================================================================== */

export interface RuntimeState {
  cfg: RuntimeConfig;
  secret: string;
  sessions: SessionStore;
  hardware: HardwareProfile;
  manager: ModelManager;
  engine: InferenceEngine;
  /** Яагаад энэ хөдөлгүүр сонгогдсоныг ил хэлнэ. */
  engineReason: string;
  /**
   * Локал норматив мэдлэгийн сан (§10, §11), эсвэл `null`.
   *
   * ⚠️ `null` НЬ АЛДАА БИШ.  Ажилтан багцаа хараахан шингээгээгүй байж
   *    болно — тэр тохиолдолд `/norm` нь 503-аар «мэдлэг суулгаагүй»
   *    гэж ИЛ хэлнэ.  ЧИМЭЭГҮЙ хоосон хариу буцаах нь хамгийн муу:
   *    ажилтан «энэ норм байхгүй юм байна» гэж ойлгоно.
   *
   * ⚠️ ПРОЦЕССЫН НАСААР НЭЭЛТТЭЙ.  §3: загвар VRAM-д ҮЛДЭХ ёстой, мөн
   *    адил SQLite-ийн холболт нээлттэй үлдэнэ — асуулт бүрд дахин
   *    нээх нь FTS5-ийн кэшийг хаяна.
   */
  knowledge: DatabaseSync | null;
  /** Санд бичигдсэн схемийн хувилбар — `SCHEMA_VERSION`-тэй зөрвөл /norm 503. */
  knowledgeSchema: number | null;
  /** Нээсэн мэдлэгийн сангийн БОДИТ зам (заагчийн эсвэл хуучин шууд зам). */
  knowledgePath?: string;
  /** Хүчинтэй гүйцэтгэлийн профайл ба хаанаас ирсэн (§13). */
  profile: PerfProfile;
  profileSource: 'env' | 'user' | 'auto';
  /** Одоогийн хөдөлгүүрийн эхлүүлэх төлөвлөгөө — `/metrics`-д ил гарна. */
  plan: LaunchPlan | null;
  /** ХОСОЛСОН ERP токен (§4) — хэрэглэгч хэзээ ч харахгүй. */
  credentials: CredentialStore;
  /** Чимээгүй шинэчлэлт (§16–§20). */
  updater: Updater;
  updateStatus: () => UpdateStatus;
  /**
   * ⚠️ СУЛ ЗОГСОЛТЫН ТАЙМЕР (§6).  `createRuntimeServer` нь энэ
   *    таймерыг АСААХГҮЙ — `main()` асаана.  Тестүүд сервер үүсгээд
   *    таймер өнчрөх ёсгүй.
   */
  idleTimer: NodeJS.Timeout | null;
  /**
   * Хөдөлгүүрийг ДАХИН барих — профайл/адаптер/загвар солигдоход.
   *
   * ⚠️ `buildState` дотор л утга авна (хаалтад `state`-ийг барих
   *    шаардлагатай).  Тестийн хийсвэр төлөвт байхгүй байж болно.
   */
  rebuildEngine?: () => Promise<void>;
  /**
   * Session B deployment agent — health тайлан, флотын heartbeat, диагностик.
   * ⚠️ Байхгүй байж болно (тест, эсвэл үүсгэлт унасан) — runtime түүнгүйгээр
   *    бүрэн ажиллана; `/deploy/*` гарцууд 503 буцаана.
   */
  deploy?: DeploymentAgent | null;
}

/**
 * Хөдөлгүүрийг СОНГОНО, мөн ГҮЙЦЭТГЭЛИЙН ТӨЛӨВЛӨГӨӨГ гаргана.
 *
 * ⚠️ ЗАДГАЙ ХЭЛНЭ.  Загвар байхгүй үед `EchoEngine` рүү унана, ГЭХДЭЭ
 *    шалтгааныг `engineReason`-д бичиж, `/info`-оор frontend рүү гаргана.
 *    Чимээгүй буулт нь хэрэглэгчид «MGL AI муу хариулж байна» гэж
 *    санагдуулна — үнэндээ загвар суугаагүй байхад.
 *
 * ⚠️ 2026-09-09-ЭЭС: ТӨЛӨВЛӨГӨӨ НЬ `planVariant` БИШ, `planLaunch`.
 *    Хуучин нь зөвхөн (контекст, GPU давхарга) хоёрыг шийддэг байсан тул
 *    thread, багц, KV кэшийн төрөл, процессын зэрэглэл llama.cpp-ийн
 *    ӨГӨГДМӨЛӨӨР үлддэг байв — тэдгээр нь БЕНЧМАРКТ оновчлогдсон утгууд
 *    бөгөөд яг тэр нь «компьютер хөшиж байна» гэсэн гомдлын шалтгаан
 *    (VRAM 7505/8192 MiB хэмжигдсэн).  `planVariant` нь ЗАГВАР СОНГОХОД
 *    (ажиллах уу, үгүй юу) ХЭВЭЭР хэрэглэгдэнэ.
 */
export async function selectEngine(
  cfg: RuntimeConfig,
  hw: HardwareProfile,
  manager: ModelManager,
  profile: PerfProfile,
): Promise<{ engine: InferenceEngine; reason: string; plan: LaunchPlan | null }> {
  if (cfg.forceEcho) {
    return {
      engine: new EchoEngine(),
      reason: 'MGLAI_ENGINE=echo гэж гараар тохируулсан.',
      plan: null,
    };
  }

  const variant = planVariant(hw);
  if (!variant.viable) {
    return { engine: new EchoEngine(), reason: variant.reason, plan: null };
  }

  const binaryPath = join(cfg.binDir, serverBinaryName());

  /** ⚠️ Дискнээс хэмжинэ — GGUF-ийн бодит хэмжээ нь VRAM-ын төсвийн үндэс. */
  const sizeOf = (path: string): number => {
    try {
      return statSync(path).size;
    } catch {
      // ⚠️ Мэдэхгүй бол ӨГӨӨМӨР таамаг (5 GB) — бага таамаглах нь
      //    VRAM хэтрэх ба тэр нь яг тэр хөшилтийг үүсгэнэ.
      return 5_000_000_000;
    }
  };

  const makePlan = (modelPath: string, desiredCtx: number): LaunchPlan => {
    const artifactName = modelPath.split(/[\\/]/).pop() ?? null;
    return planLaunch({
      hardware: hw,
      profile,
      model: {
        bytesOnDisk: sizeOf(modelPath),
        kvBytesPerTokenF16: kvBytesPerToken(artifactName),
        artifactName,
      },
      desiredContextTokens: desiredCtx,
    });
  };

  // ⚠️ АДАПТЕР — суурь загвараас ТУСДАА (§15, §17).  Байхгүй нь хэвийн.
  const adapter = await manager.activeAdapterRow();

  // ── ХӨГЖҮҮЛЭЛТ / ҮНЭЛГЭЭНИЙ ЗАМ ────────────────────────────────
  // ⚠️ `MGLAI_MODEL_PATH` нь релизийн бүртгэлийг ТОЙРНО.  Энэ нь
  //    ЗӨВШӨӨРӨГДСӨН тойролт: лицензийн хаалга нь ТҮГЭЭЛТИЙГ хаадаг,
  //    хөгжүүлэгчийн өөрийн машин дээрх үнэлгээг биш.  Гэвч тэмдэглэгээ
  //    нь `dev-local` тул продакшны релизтэй ХЭЗЭЭ Ч андуурагдахгүй.
  if (cfg.devModelPath !== null) {
    const plan = makePlan(cfg.devModelPath, variant.contextTokens);
    return {
      plan,
      engine: new LlamaCppEngine({
        binaryPath,
        modelPath: cfg.devModelPath,
        port: cfg.enginePort,
        plan,
        // ⚠️ MGLAI_LORA_PATH нь бүртгэлтэй адаптерыг ДАРНА — зөвхөн үнэлгээнд.
        loraPath: cfg.devLoraPath ?? adapter?.path ?? null,
        adapterVersion: cfg.devLoraPath ? `dev-candidate:${cfg.devLoraPath.replace(/^.*[\\/]/, '')}` : (adapter?.version ?? null),
        runtimeVariant: variantFromName(cfg.devModelPath),
        modelVersion: 'dev-local',
        quantization: cfg.devModelQuant ?? quantFromName(cfg.devModelPath),
        onLog: (line) => log(`engine: ${line}`),
        trainingLockPath: join(cfg.dataDir, 'training.lock'),
      }),
      reason:
        `⚠️ ХӨГЖҮҮЛЭЛТИЙН ЗАГВАР (MGLAI_MODEL_PATH): ${cfg.devModelPath}.  ` +
        (cfg.devLoraPath ? `⚠️ НЭР ДЭВШИГЧ АДАПТЕР (MGLAI_LORA_PATH): ${cfg.devLoraPath}.  ` : '') +
        `Релизийн бүртгэлд ОРООГҮЙ, ажилтан руу ТАРААГҮЙ.  ${plan.reason}`,
    };
  }

  const model = await manager.activeModel();
  if (model === null) {
    // ⚠️ БҮРТГЭГДЭЭГҮЙ ч ДИСКЭН ДЭЭР байгаа загварыг ОЛНО.  Үүнгүйгээр
    //    хэрэглэгч 2.3 GB татаж тавиад «загвар суулгаагүй» гэсэн хариу
    //    авдаг байсан бөгөөд бүтээгдэхүүн бүхэлдээ ажиллахгүй мэт
    //    харагддаг байв (2026-09-08).
    const found = await manager.discoverLocalModel();
    if (found !== null) {
      const plan = makePlan(found.path, variant.contextTokens);
      return {
        plan,
        engine: new LlamaCppEngine({
          binaryPath,
          modelPath: found.path,
          port: cfg.enginePort,
          plan,
          loraPath: adapter?.path ?? null,
          adapterVersion: adapter?.version ?? null,
          // ⚠️ ХУВИЛБАРЫН ШОШГЫГ БОДИТ ФАЙЛААС гаргана, `planVariant`-аас
          //    БИШ.  Тэр нь төхөөрөмжийн төлөвлөгөө боловч шошго нь
          //    'employee-4b-q4' гэж ХАТУУ бичигдсэн тул 8B загвар
          //    ажиллаж байхад «4b» гэж ХУДАЛ мэдээлдэг байв (2026-09-09).
          runtimeVariant: variantFromName(found.name),
          modelVersion: 'dev-local',
          quantization: quantFromName(found.name),
          onLog: (line) => log(`engine: ${line}`),
          trainingLockPath: join(cfg.dataDir, 'training.lock'),
        }),
        reason:
          `Дискнээс олдсон загвар: ${found.name} (${(found.bytes / 1e9).toFixed(2)} GB). ` +
          `⚠️ Релизийн бүртгэлд ОРООГҮЙ — «dev-local» гэж тэмдэглэгдэнэ. ${plan.reason}`,
      };
    }

    return {
      engine: new EchoEngine(),
      plan: null,
      reason:
        'Идэвхтэй загвар суулгаагүй байна.  «npm run ai:model -- pull» ажиллуулж эсвэл ' +
        'админаас релиз нийтлэхийг хүснэ үү.',
    };
  }

  const plan = makePlan(model.path, Math.min(model.contextTokens, variant.contextTokens));
  return {
    plan,
    engine: new LlamaCppEngine({
      binaryPath,
      modelPath: model.path,
      port: cfg.enginePort,
      plan,
      loraPath: adapter?.path ?? null,
      adapterVersion: adapter?.version ?? null,
      runtimeVariant: model.runtimeVariant,
      modelVersion: model.version,
      quantization: model.quantization,
      onLog: (line) => log(`engine: ${line}`),
    }),
    reason: plan.reason,
  };
}

export async function buildState(env = process.env): Promise<RuntimeState> {
  const cfg = loadConfig(env);
  await mkdir(cfg.modelsDir, { recursive: true });
  await mkdir(cfg.binDir, { recursive: true });

  const secret = await ensureSecret(cfg);
  const hardware = await detectHardware();
  const settings = await readSettings(cfg);
  const { profile, source } = resolveProfile(cfg, settings, hardware);

  const manager = new ModelManager({
    modelsDir: cfg.modelsDir,
    stateFile: cfg.stateFile,
    controlPlane: cfg.controlPlaneUrl,
  });
  await manager.reconcile();

  const { engine, reason, plan } = await selectEngine(cfg, hardware, manager, profile);

  // ⚠️ ЗӨВХӨН БАЙГАА БОЛ НЭЭНЭ.  `openKnowledgeDb` нь байхгүй файлыг
  //    ҮҮСГЭДЭГ — тэр нь энд БУРУУ зан төлөв: хоосон сан нь «мэдлэг
  //    суулгасан ч юу ч олдохгүй» гэсэн төөрөгдүүлсэн байдал үүсгэнэ.
  //    Байхгүй бол `null` үлдээж, `/norm` нь шалтгааныг ил хэлнэ.
  // Session B (P0-5/P0-6): мэдлэгийн санг ЗААГЧААС (knowledge/current.knowledge.json),
  // заагчгүй хуучин суулгацад шууд замаас.  Ямар хувилбар нээгдсэн нь /info.deployment.running-д.
  // ⚠️ Session A (P0-14): ЗӨВХӨН УНШИНА — бичих горимоор нээхэд `openKnowledgeDbEx` схем хуучирсан бол
  //    хүснэгтүүдийг ЧИМЭЭГҮЙ устгадаг байв; readOnly + схемийн хувилбарыг тулгаж, зөрвөл /norm 503
  //    «дахин шингээнэ үү».  (Session D нэгтгэл 2026-09-14: B-ийн заагч + A-ийн readOnly/схем ХОЁУЛАА.)
  const knowledgePath = (await resolveKnowledgeDb(resolveLayout(cfg.dataDir), cfg.knowledgeDb)) ?? cfg.knowledgeDb;
  const knowledge = existsSync(knowledgePath) ? openKnowledgeDb({ path: knowledgePath, readOnly: true }) : null;
  const knowledgeSchema = knowledge === null ? null : knowledgeSchemaVersion(knowledge);

  const credentials = new CredentialStore(cfg.credentialFile);

  const state: RuntimeState = {
    cfg,
    secret,
    sessions: new SessionStore(),
    hardware,
    manager,
    engine,
    engineReason: reason,
    knowledge,
    knowledgeSchema,
    knowledgePath,
    profile,
    profileSource: source,
    plan,
    credentials,
    // ⚠️ Түр орлуулагч — доор жинхэнэ `Updater`-ээр солино.  `state`-ийг
    //    хаалтад (closure) барих шаардлагатай тул дараалал ийм.
    updater: null as unknown as Updater,
    updateStatus: () => idleStatus(),
    idleTimer: null,
  };

  /**
   * ХӨДӨЛГҮҮРИЙГ ДАХИН БАРИНА — профайл солигдох, адаптер солигдох,
   * загвар солигдоход.
   *
   * ⚠️ ХУУЧНЫГ ЗААВАЛ БУУЛГАНА.  Буулгахгүй бол хоёр `llama-server`
   *    процесс зэрэг VRAM эзэлж, яг тэр «бүх компьютер зогсов» гэсэн
   *    мөчийг үүсгэнэ — өөрөөр хэлбэл засаж байгаа гажгаа өөрөө хийнэ.
   */
  state.rebuildEngine = async (): Promise<void> => {
    await state.engine.unload().catch(() => undefined);
    const next = await selectEngine(state.cfg, state.hardware, state.manager, state.profile);
    state.engine = next.engine;
    state.engineReason = next.reason;
    state.plan = next.plan;
  };

  const updater = new Updater({
    manager,
    credentials,
    runtimeVersion: RUNTIME_VERSION,
    knowledgeDir: cfg.knowledgeDir,
    controlPlane: cfg.controlPlaneUrl,
    isBusy: () => engineBusy(state),
    reloadEngine: () => state.rebuildEngine!(),
    // ⚠️ SMOKE ТЕСТ = ЗАГВАР ҮНЭХЭЭР АЧААЛАГДАХ (§18).  Файл байгаа
    //    эсэхийг шалгах нь ХАНГАЛТГҮЙ: эвдэрсэн GGUF, тохирохгүй
    //    адаптер нь зөвхөн АЧААЛАХ үед л илэрнэ.
    smokeTest: () => state.engine.load(),
    /**
     * Session B (P0-5): мэдлэгийн багц нь ИДЭВХЖҮҮЛЭЛТИЙН ХӨДӨЛГҮҮРЭЭР
     * (`deployment/src/activation.ts`) — staging → SHA → versions/<v>/ → заагч.
     * Runtime-д заагч бичих хоёр дахь зам БАЙХГҮЙ.  Шинэ санг runtime дараагийн
     * асаалтдаа нээнэ (`restartRequired`).
     */
    activateKnowledge: async (pack, token) => {
      const layout = resolveLayout(cfg.dataDir);
      const store = new InstalledStateStore(layout.installedFile);
      const r = await activateSingleComponent(
        {
          layout,
          store,
          download: async (url, dest, onProgress) => {
            const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
            if (!res.ok || !res.body) throw new Error(`Татаж чадсангүй: HTTP ${res.status}`);
            const total = pack.bytes ?? Number(res.headers.get('content-length') ?? 0);
            let got = 0;
            const { createWriteStream } = await import('node:fs');
            const { pipeline } = await import('node:stream/promises');
            const { Readable } = await import('node:stream');
            const src = Readable.fromWeb(res.body as never);
            src.on('data', (c: Buffer) => {
              got += c.length;
              if (total > 0) onProgress?.(Math.round((got / total) * 100));
            });
            await pipeline(src, createWriteStream(dest));
          },
          // Заагч солигдсон; сан нь ДАРААГИЙН асаалтад нээгдэнэ — энд health нь файлын
          // түвшний л (SHA аль хэдийн давсан).  Бүтэн health-ийг DeploymentAgent дараа хийнэ.
          healthCheck: async () => ({ ok: true, code: 'KNOWLEDGE_STAGED_PENDING_RESTART' }),
          log,
        },
        'knowledge',
        { id: pack.pack_id, version: pack.version, sha256: pack.sha256, url: pack.url, sizeBytes: pack.bytes, meta: { fileName: 'knowledge.sqlite' } },
        null,
      );
      return { ok: r.ok, code: r.code, restartRequired: r.ok && r.activated.includes('knowledge') };
    },
    installedKnowledgeVersion: async () => {
      const store = new InstalledStateStore(resolveLayout(cfg.dataDir).installedFile);
      return (await store.read()).components.knowledge?.version ?? null;
    },
    log,
  });
  state.updater = updater;

  try {
    state.deploy = await createDeploymentAgent({
      dataDir: cfg.dataDir,
      runtimeUrl: `http://${BIND_HOST}:${cfg.port}`,
      runtimeSecret: secret,
      controlPlane: cfg.controlPlaneUrl,
      runtimeVersion: RUNTIME_VERSION,
      legacyKnowledgeDb: cfg.knowledgeDb,
      runtimeEntry: process.argv[1] ?? null,
      hardware,
      token: () => credentials.valid(),
      activeModel: async () => {
        const m = await manager.activeModel();
        return m ? { version: m.version, sha256: m.sha256, path: m.path, releaseUid: m.releaseUid } : null;
      },
      activeAdapter: async () => {
        const a = await manager.activeAdapterRow();
        return a ? { version: a.version, sha256: a.sha256 } : null;
      },
      updateStatus: () => {
        const u = updater.status;
        return { phase: u.phase, what: u.what, percent: u.percent, error: u.error };
      },
      // P0-6: процессын БОДИТ хувилбарууд — heartbeat/диагностикт заагчаас гадна.
      runningVersions: async () => (await deploymentSummary(state))?.running ?? {},
      extraLogFiles: [join(cfg.dataDir, 'runtime.log'), join(cfg.dataDir, 'supervisor.log'), join(cfg.dataDir, 'install.log')],
      log,
    });
  } catch (err) {
    log(`⚠️ deployment agent үүсгэж чадсангүй (runtime үргэлжилнэ): ${(err as Error).message}`);
    state.deploy = null;
  }
  state.updateStatus = () => updater.status;

  return state;
}

/**
 * Хөдөлгүүр яг одоо ажиллаж байгаа эсэх (§6, §35).
 *
 * ⚠️ `EchoEngine`-Д `busy` ГЭСЭН ТАЛБАР БАЙХГҮЙ — интерфейст ороогүй.
 *    Байхгүйг «завгүй биш» гэж үзнэ; тэр нь зөв, учир нь echo нь
 *    агшинд хариулдаг ба ямар ч нөөц эзэлдэггүй.
 */
function engineBusy(state: RuntimeState): boolean {
  const e = state.engine as unknown as { busy?: boolean };
  return e.busy === true;
}

/**
 * СУЛ ЗОГСОЛТЫН ДАРААХ БУУЛГАЛТ (§6).
 *
 * ⚠️ ЯАГААД ЭНЭ ХЭРЭГТЭЙ ВЭ.  Ачаалагдсан 8B загвар нь ХЭМЖИГДСЭНЭЭР
 *    6541 MiB VRAM-ыг ЗҮГЭЭР эзэлж байдаг — асуулт асуугаагүй ч.  8 GB
 *    картан дээр тэр нь Revit, хөтөч, ажлын талбарт 1.6 GB Л үлдээнэ.
 *    Ажилтан өглөө нэг асуулт асуугаад өдөржин Revit дээр ажиллавал
 *    MGL AI нь тэр өдрийг бүхэлд нь ХОРЛОНО.
 *
 * ⚠️ ГЭХДЭЭ ТАСРАЛТГҮЙ БУУЛГАЖ/АЧААЛАХГҮЙ (§6-ийн «avoid constant
 *    unload/reload»).  Босго нь 20 минут: тэр нь «цайны цаг» ба «өөр
 *    ажил руу шилжсэн» хоёрын хооронд.  Мөн ҮҮСГЭЛТ ЯВЖ БАЙВАЛ ХЭЗЭЭ Ч
 *    буулгахгүй.
 */
export function startIdleWatcher(state: RuntimeState): NodeJS.Timeout | null {
  if (state.cfg.idleUnloadMs <= 0) return null;
  // Босгын дөрөвний нэг тутамд шалгана — 20 минутын босгод 5 минут.
  const tick = Math.max(30_000, Math.floor(state.cfg.idleUnloadMs / 4));
  const timer = setInterval(() => {
    void (async () => {
      const info = state.engine.info();
      if (!info.loaded) return;
      if (engineBusy(state)) return;
      const idle = info.idleMs;
      // ⚠️ `undefined` (хөдөлгүүр энэ талбарыг өгдөггүй) нь «мэдэхгүй» —
      //    мэдэхгүй үед буулгахгүй.  Таамаглаж буулгах нь ажиллаж буй
      //    загварыг санамсаргүй унтраах эрсдэлтэй.
      if (idle === null || idle === undefined || idle < state.cfg.idleUnloadMs) return;
      log(
        `сул зогсолт ${Math.round(idle / 60000)} мин — загварыг буулгаж VRAM чөлөөлж байна ` +
          '(дараагийн асуултад автоматаар дахин ачаална).',
      );
      await state.engine.unload().catch((err: unknown) => {
        log(`⚠️ буулгаж чадсангүй: ${(err as Error).message}`);
      });
    })();
  }, tick);
  timer.unref?.();
  state.idleTimer = timer;
  return timer;
}

/**
 * ХОЙД ДЭВСГЭРИЙН ШИНЭЧЛЭЛТИЙН ТАЙМЕР (§20, §35).
 *
 * ⚠️ ЭХЛЭЛТЭД ШУУД ШАЛГАХГҮЙ.  Процесс дөнгөж асахад ажилтан нэвтэрч
 *    байгаа мөч байх магадлалтай — тэр үед сүлжээ, диск идэх нь Windows-
 *    ийн нэвтрэлтийг удаашруулна.  2 минут хүлээнэ.
 */
export function startUpdateWatcher(state: RuntimeState): NodeJS.Timeout | null {
  if (state.cfg.updateCheckMs <= 0) return null;
  const first = setTimeout(() => void state.updater.check(), 120_000);
  first.unref?.();
  const timer = setInterval(() => void state.updater.check(), state.cfg.updateCheckMs);
  timer.unref?.();
  return timer;
}

/* ================================================================== */

function parseTurns(raw: unknown): EngineTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: EngineTurn[] = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue;
    const r = (t as Record<string, unknown>).role;
    const content = (t as Record<string, unknown>).content;
    if ((r === 'system' || r === 'user' || r === 'assistant') && typeof content === 'string') {
      out.push({ role: r, content });
    }
  }
  return out;
}

/**
 * Session B (P0-6): ХҮССЭН (заагч/installed.json) ба АЖИЛЛАЖ БУЙ хувилбар ХОЁУЛАА.
 *   running.runtime   — энэ процессын кодын package.json version (заагч биш, бодит файл)
 *   running.knowledge — нээсэн сангийн зам заагчийнхтай таарвал заагчийн хувилбар,
 *                       хуучин шууд зам бол 'legacy', нээгээгүй бол байхгүй
 *   running.model     — хөдөлгүүрийн ачаалсан/сонгосон загварын хувилбар
 * Зөрүү = health-ийн VERSION_MISMATCH (probes.ts), heartbeat-д running_versions.
 */
async function deploymentSummary(state: RuntimeState): Promise<{
  installation_id: string;
  channel: string;
  versions: Record<string, string>;
  running: Record<string, string>;
  release: string | null;
  update_phase: string | null;
} | null> {
  const agent = state.deploy;
  if (!agent) return null;
  try {
    await agent.syncInstalled();
    const s = await agent.store.read();
    const versions: Record<string, string> = {};
    for (const [k, v] of Object.entries(s.components)) if (v) versions[k] = v.version;
    const running: Record<string, string> = {};
    const codeVersion = await runningCodeVersion(process.argv[1] ?? null);
    if (codeVersion) running.runtime = codeVersion;
    const kp = await readPointer(agent.layout, 'knowledge');
    if (state.knowledgePath && state.knowledge !== null) {
      running.knowledge = kp && kp.path === state.knowledgePath ? kp.version : 'legacy';
    }
    const active = await state.manager.activeModel();
    const adapter = await state.manager.activeAdapterRow();
    if (active) running.model = adapter ? `${active.version}+${adapter.version}` : active.version;
    const upd = await readUpdateState(agent.layout);
    return { installation_id: s.installationId, channel: s.channel, versions, running, release: s.currentRelease, update_phase: upd?.phase ?? null };
  } catch {
    return null;
  }
}

export function createRuntimeServer(state: RuntimeState) {
  const { cfg } = state;

  return createServer(async (req, res) => {
    if (cors(req, res, cfg)) return;

    const url = new URL(req.url ?? '/', `http://${BIND_HOST}`);
    const path = url.pathname;

    // ── Нэвтрэлтгүй: зөвхөн «амьд эсэх» ───────────────────────────
    if (path === '/health' && req.method === 'GET') {
      // ⚠️ Мэдээлэл ЗАДРУУЛАХГҮЙ — загварын нэр, хувилбар, төхөөрөмж
      //    энд ГАРАХГҮЙ.  Зөвхөн «MGL AI энэ порт дээр байна».
      return json(res, 200, { service: 'mgl-ai-runtime', version: RUNTIME_VERSION, ok: true });
    }

    // ── Бусад бүх гарц нэвтрэлт шаардана ──────────────────────────
    const auth = authenticate(
      {
        origin: req.headers.origin,
        secret: req.headers['x-mglai-secret'] as string | undefined,
        session: req.headers['x-mglai-session'] as string | undefined,
      },
      { secret: state.secret, sessions: state.sessions, allowedOrigins: cfg.allowedOrigins },
    );
    if (!auth.ok) {
      return json(res, 401, { error: 'Нэвтрэх эрхгүй.', code: auth.reason });
    }

    try {
      if (path === '/session' && req.method === 'POST') {
        if (auth.via !== 'secret') {
          // Сессийг ЗӨВХӨН нууцаар авна — сессээр сесс сунгах нь мөнхийн
          // токен болно.
          return json(res, 403, { error: 'Сесс авахад суулгацын нууц шаардлагатай.' });
        }
        const token = state.sessions.issue();
        return json(res, 200, token);
      }

      if (path === '/info' && req.method === 'GET') {
        const [health, model, diskBytes] = await Promise.all([
          state.engine.health(),
          state.manager.activeModel(),
          state.manager.diskUsageBytes(),
        ]);
        const mgrState = await state.manager.readState();
        return json(res, 200, {
          service: 'mgl-ai-runtime',
          runtime_version: RUNTIME_VERSION,
          engine: state.engine.info(),
          engine_reason: state.engineReason,
          engine_health: health,
          hardware: state.hardware,
          plan: planVariant(state.hardware),
          active_model: model,
          installed: mgrState.installed.map((m) => ({
            release_uid: m.releaseUid,
            version: m.version,
            runtime_variant: m.runtimeVariant,
            bytes: m.bytes,
            installed_at: m.installedAt,
          })),
          rollback_available: mgrState.previous !== null,
          disk_bytes: diskBytes,
          /**
           * ⚠️ ГҮЙЦЭТГЭЛИЙН ПРОФАЙЛ (§13).  Хэвийн хэрэглэгчийн UI нь
           *    үүнийг ХАРУУЛАХГҮЙ — зөвхөн тохиргооны хуудас, диагностик.
           */
          perf: {
            profile: state.profile,
            source: state.profileSource,
            label: PROFILE_LABEL_MN[state.profile],
            options: PERF_PROFILES.map((k) => ({ key: k, ...PROFILE_LABEL_MN[k] })),
            plan: state.plan,
            /**
             * ⚠️ ХЭРЭГЛЭГЧИД ХЭЛЭХ ЁСТОЙ БУУЛТУУД.  «Контекстыг 8K → 4K
             *    болгов» гэдэг нь техникийн дэлгэрэнгүй мэт харагдавч
             *    ХАРИУЛТЫН ЧАНАРТ шууд нөлөөлнө — нуух нь хэрэглэгчийг
             *    төөрөгдүүлнэ.
             */
            notices: state.plan?.notices ?? [],
          },
          /** Адаптерын хувилбар — «MGL AI 1.2» гэсэн шошго эндээс (§17). */
          adapter: await state.manager.activeAdapterRow(),
          /** Чимээгүй шинэчлэлтийн явц (§20). */
          update: state.updateStatus(),
          /**
           * ⚠️ ХОСОЛСОН ЭСЭХ — ХЭРЭГЛЭГЧИД ХАРАГДАХГҮЙ, зөвхөн хуудас
           *    «дахин хосло» гэдгийг шийдэхэд.  ТОКЕН ӨӨРӨӨ ХЭЗЭЭ Ч
           *    буцаагдахгүй.
           */
          paired: (await state.credentials.valid()) !== null,
          /**
           * Session B — суулгацын таних тэмдэг + бүрэлдэхүүн тус бүрийн хувилбар.
           * Хөтөч санал хүсэлтээ тамгалахад (`/fleet/message-context`) хэрэглэнэ.
           * ⚠️ installation_id нь санамсаргүй UUID — хардверийн хээ биш.
           */
          deployment: await deploymentSummary(state),
        });
      }

      /* ============================================================ */
      /*  АВТОМАТ ХОСОЛТ (§4, §5) — ХЭРЭГЛЭГЧ ЮУ Ч ОРУУЛАХГҮЙ           */
      /* ============================================================ */

      /**
       * ⚠️ ХӨТӨЧ ӨӨРИЙН ERP ТОКЕНОО ЛОКАЛ ҮЙЛЧИЛГЭЭНД ӨГНӨ.
       *
       *    Ажилтан ERP-д АЛЬ ХЭДИЙН нэвтэрсэн байна.  Хуудас нээгдэхэд
       *    тэр токеныг энд дамжуулж, runtime нь түүгээр манифест
       *    шалгах, артефакт татах эрхтэй болно.  Ажилтан ямар ч
       *    түлхүүр ХАРААГҮЙ, ХУУЛААГҮЙ — §4-ийн шаардлага яг энэ.
       *
       * ⚠️ ЗӨВХӨН ЗӨВШӨӨРӨГДСӨН ГАРАЛ ҮҮСЛЭЭС.  Дээрх `authenticate`
       *    нь аль хэдийн шалгасан: дурын вэб хуудас энд хүрч чадахгүй,
       *    учир нь `Origin`-ыг хөтөч өөрөө тавьдаг ба JS түүнийг хуурч
       *    чадахгүй.  Өөрөөр хэлбэл хортой хуудас өөрийн токеноо энд
       *    суулгаж чадахгүй.
       *
       * ⚠️ RUNTIME ТОКЕНЫГ БАТАЛГААЖУУЛДАГГҮЙ, БАЙЖ Ч БОЛОХГҮЙ.
       *    `JWT_SECRET` нь ажилтны машин дээр БАЙХ ЁСГҮЙ.  Токен
       *    хүчинтэй эсэхийг Worker өөрөө хүсэлт бүрд шийднэ; энд
       *    зөвхөн `exp`-ийг уншиж дэмий хүсэлтээс сэргийлнэ.
       */
      if (path === '/pair' && req.method === 'POST') {
        if (auth.via !== 'origin' && auth.via !== 'secret') {
          return json(res, 403, { error: 'Хосолт нь ERP-ийн хуудаснаас Л хийгдэнэ.' });
        }
        const body = (await readBody(req)) as Record<string, unknown>;
        const token = typeof body.token === 'string' ? body.token.trim() : '';
        if (token.length < 20) return json(res, 400, { error: 'Токен буруу.' });
        const cred = await state.credentials.save(token);
        log(`ERP-тэй хосллоо (хэрэглэгч ${cred.userId ?? '?'})`);
        // Session B — хосолмогц флотод бүртгүүлнэ (heartbeat өмнө нь дуудагчгүй байсан).
        setTimeout(() => void state.deploy?.heartbeat().catch(() => undefined), 5000).unref?.();
        // ⚠️ Хосолсны ДАРАА ШУУД шалгана — анхны суулгацад загвар/мэдлэг
        //    энэ мөчид татагдаж эхэлнэ (§37-ийн эхний ажиллуулалт).
        void state.updater.check();
        return json(res, 200, {
          ok: true,
          user_id: cred.userId,
          expires_at: cred.expiresAtMs,
          update: state.updateStatus(),
        });
      }

      /* ============================================================ */
      /*  УРЬДЧИЛСАН АЧААЛАЛТ (§6)                                     */
      /* ============================================================ */

      /**
       * ⚠️ ЯАГААД ЭНЭ ГАРЦ ОРШИН БАЙНА, ЯАГААД ЭХЛЭЛТЭД АЧААЛАХАА БОЛИВ.
       *
       *    2026-09-08-нд `main()` нь процесс асахад ЛА загварыг ачаалдаг
       *    болсон — өдрийн эхний асуулт 7 411 мс хүлээдэг байсныг засах
       *    гэж.  Тэр нь TTFT-д зөв ч §6-ийн эсрэг: ажилтан AI-г огт
       *    нээхгүй өдөр ч 6.5 GB VRAM өдөржин баригдана.  8 GB картан
       *    дээр тэр нь Revit-д шууд хохирол.
       *
       *    Одоо: процесс асахдаа ЮУ Ч АЧААЛАХГҮЙ (хөнгөн), харин ХУУДАС
       *    НЭЭГДЭХЭД хөтөч энэ гарцыг дуудна.  Ажилтан асуултаа бичих
       *    хэдэн секундэд загвар ачаалагдана — TTFT-ийн ашиг ХЭВЭЭР,
       *    сул зогсолтын өртөг АРИЛНА.
       *
       * ⚠️ ХАРИУГ ХҮЛЭЭХГҮЙ.  Ачаалалт 10-20 секунд үргэлжилж болох ба
       *    хуудас түүнийг хүлээх ёсгүй.  Явцыг `/info`-ийн
       *    `engine_health` хэлнэ.
       */
      if (path === '/warmup' && req.method === 'POST') {
        const info = state.engine.info();
        if (info.loaded) return json(res, 200, { state: 'ready' });
        void state.engine.load().catch((err: unknown) => {
          log(`⚠️ урьдчилсан ачаалалт амжилтгүй: ${(err as Error).message}`);
        });
        // ⚠️ Сул зогсолтоос сэрэхэд НЭР ДЭВШИГЧ адаптер байвал ЭНД
        //    хэрэглэнэ — хэрэглэгч завгүй биш байх цорын ганц мөч.
        void state.updater.applyPendingAdapter().catch(() => undefined);
        return json(res, 200, { state: 'loading' });
      }

      /* ============================================================ */
      /*  ДИАГНОСТИК (§28) — ХЭВИЙН ХЭРЭГЛЭГЧИД ХАРАГДАХГҮЙ            */
      /* ============================================================ */

      if (path === '/metrics' && req.method === 'GET') {
        const [health, gpu] = await Promise.all([state.engine.health(), sampleGpu()]);
        const mem = process.memoryUsage();
        const info = state.engine.info();
        return json(res, 200, {
          runtime_version: RUNTIME_VERSION,
          engine: info,
          engine_health: health,
          busy: engineBusy(state),
          idle_ms: info.idleMs,
          idle_unload_ms: state.cfg.idleUnloadMs,
          plan: state.plan,
          profile: state.profile,
          hardware: state.hardware,
          /** ⚠️ `null` = ХЭМЖИЖ ЧАДСАНГҮЙ.  0 гэж бичих нь ХУДАЛ тоо. */
          gpu,
          runtime_process: {
            rss_mb: Math.round(mem.rss / 1048576),
            heap_mb: Math.round(mem.heapUsed / 1048576),
            uptime_s: Math.round(process.uptime()),
          },
          update: state.updateStatus(),
          knowledge_installed: state.knowledge !== null,
          measured_at: new Date().toISOString(),
        });
      }

      /* ============================================================ */
      /*  ГҮЙЦЭТГЭЛИЙН ПРОФАЙЛ (§13)                                   */
      /* ============================================================ */

      /**
       * ⚠️ ПРОФАЙЛ СОЛИХОД ЗАГВАР ДАХИН АЧААЛАГДАНА.  Тэр нь хэдэн
       *    секунд ба VRAM-ын хөдөлгөөн — тиймээс ҮҮСГЭЛТ ЯВЖ БАЙВАЛ
       *    ТАТГАЛЗАНА, дундуур нь тасалж хэрэглэгчийн хариултыг
       *    хаяхгүй.
       */
      if (path === '/profile' && req.method === 'POST') {
        const body = (await readBody(req)) as Record<string, unknown>;
        const next = body.profile;
        if (!isPerfProfile(next)) {
          return json(res, 400, { error: 'profile нь eco | balanced | performance байх ёстой.' });
        }
        if (engineBusy(state)) {
          return json(res, 409, {
            error: 'Хариулт бичиж байна — дуусахад дахин оролдоно уу.',
            code: 'busy',
          });
        }
        await writeSettings(state.cfg, { perfProfile: next });
        state.profile = next;
        state.profileSource = 'user';
        await state.rebuildEngine?.();
        log(`гүйцэтгэлийн профайл: ${next} — ${state.plan?.reason ?? ''}`);
        return json(res, 200, { ok: true, profile: state.profile, plan: state.plan });
      }

      /* ============================================================ */
      /*  ШИНЭЧЛЭЛТ (§16–§20)                                          */
      /* ============================================================ */

      if (path === '/update/status' && req.method === 'GET') {
        return json(res, 200, state.updateStatus());
      }

      if (path === '/update/check' && req.method === 'POST') {
        const body = (await readBody(req).catch(() => ({}))) as Record<string, unknown>;
        // ⚠️ ХАРИУГ ХҮЛЭЭХГҮЙ — татаж авалт минутаар үргэлжилж болно.
        //    Хуудас `/update/status`-аар явцыг харна (§20).
        void state.updater.check({ force: body.force === true });
        return json(res, 202, state.updateStatus());
      }

      /**
       * НОРМАТИВ АСУУЛТ — ДЕТЕРМИНИСТ ХАРИУ (§11).
       *
       * ⚠️ ЭНЭ ГАРЦ ЗАГВАР ДУУДАХГҮЙ, ЗОРИУД.  Гаралт нь бүтэцтэй
       *    шийдвэр + эшлэл: `{status, decision, rule_id, citation,
       *    evidence, missing_context}`.  Загварын үүрэг нь түүнийг
       *    МОНГОЛ ӨГҮҮЛБЭР болгох — тоо, босго, эшлэлийг НЭГЭНТ шийдсэн
       *    байна.  Ингэснээр 4B загвар «300 м²-ээс их» гэдгийг буруу
       *    уншсан ч хариултын ТОО зөв хэвээр үлдэнэ.
       *
       * ⚠️ `/generate`-ИЙГ ХӨНДӨӨГҮЙ.  Prompt угсрах нь Cloudflare
       *    Worker-ийн ажил (§8) — runtime нь түүнийг дахин бичих ёсгүй.
       *    Тиймээс энэ нь НЭМЭЛТ гарц: чат эхлээд үүнийг дуудаад, үр
       *    дүнг нотолгоо болгон `/generate` рүү дамжуулна.
       *
       * ⚠️ `audience` НЬ КЛИЕНТЭЭС ИРНЭ, ГЭВЧ ТЭР НЬ ЭРХ БИШ.  Локал
       *    runtime дээрх мэдлэг нь БҮГД `public_norm` — нууц компанийн
       *    баримт энд ОРОХГҮЙ (тэр нь D1-ийн ажил, §8).  `client` горим
       *    нь ЗӨВХӨН нэмэлт хаалт: ирээдүйд дотоод гарын авлага
       *    шингээхэд аль хэдийн зөв шүүнэ.  Жинхэнэ эрхийн шийдвэр нь
       *    Worker дээр (§5).
       */
      if (path === '/norm' && req.method === 'POST') {
        if (state.knowledge === null) {
          return json(res, 503, {
            error: 'Норматив мэдлэг суулгаагүй байна.',
            hint: 'npm run ai:ingest:norm -- <багцын-хавтас>',
            expected_path: state.cfg.knowledgeDb,
          });
        }
        if (state.knowledgeSchema !== SCHEMA_VERSION) {
          // Схем хуучирсан/шинэ — «олдсонгүй» гэж хэлэхгүй: сан хэрэглэх боломжгүй.
          return json(res, 503, {
            error: 'Норматив мэдлэгийн сангийн бүтэц runtime-тай зөрж байна — дахин шингээнэ үү.',
            reason: 'knowledge_schema_mismatch',
            expected_schema: SCHEMA_VERSION,
            actual_schema: state.knowledgeSchema,
            hint: 'npm run ai:ingest:norm -- --all',
          });
        }
        const body = (await readBody(req)) as Record<string, unknown>;
        const query = typeof body.query === 'string' ? body.query.trim() : '';
        if (query.length === 0) return json(res, 400, { error: 'query хоосон байна.' });

        const started = Date.now();
        let answer;
        try {
          answer = askNorm(state.knowledge, query, {
            audience: body.audience === 'client' ? 'client' : 'employee',
            context:
              typeof body.context === 'object' && body.context !== null
                ? (body.context as Record<string, string | number | boolean | null>)
                : undefined,
            evidenceLimit: typeof body.evidence_limit === 'number' ? body.evidence_limit : 5,
            // ⚠️ Оношилгоо ЗӨВХӨН хөгжүүлэлтэд: `MGLAI_DEBUG=1` + `debug:true` хоёулаа (§13).
            debug: body.debug === true && process.env.MGLAI_DEBUG === '1',
          });
        } catch (err) {
          // ⚠️ ХАЙЛТ УНАСАН ≠ ОЛДСОНГҮЙ (P0-14).  Дахин шингээлт явж байх үеийн «no such
          //    table», түгжээ, гэмтсэн файл → 503; хөтөч `reason: error` гэж дамжуулж
          //    backend `retrieval_failed` гэж ялгана.  Бусад алдаа ч 503 — 200-тай хоосон
          //    «олдсонгүй» биш.
          const infra = err instanceof KnowledgeUnavailableError || isKnowledgeInfrastructureError(err);
          console.error(`[norm] хайлт унав (${infra ? 'дэд бүтэц' : 'дотоод'}): ${err instanceof Error ? err.message : String(err)}`);
          return json(res, 503, {
            error: infra ? 'Норматив мэдлэгийн сан түр хүрэлцэхгүй байна (дахин шингээлт явж байж болзошгүй).' : 'Нормын хайлт дотоод алдаагаар унав.',
            reason: infra ? 'knowledge_unavailable' : 'retrieval_error',
          });
        }

        // L0 БҮРТГЭЛ (ai/norm-dataset, 2026-09-16) — заалтын хайлтаас ТУСДАА давхарга.  Нэрлэсэн
        //    баримт санд байхгүй (`named_document.absent`) ч бүртгэлд байвал код/нэр/төлөв/албан
        //    холбоосыг өгнө — заалт ЗОХИОГДОХГҮЙ, «гүн шингээгээгүй» гэдэг нь ил.  Мөн асуултын
        //    баг/сэдвээр холбогдох нормын жагсаалт (LINKS_ONLY).  Бүртгэл шингээгээгүй хуучин
        //    санд `null` — `/norm`-ийн гэрээ өөрчлөгдөхгүй.
        let registry: Record<string, unknown> | null = null;
        try {
          const namedCode = answer.named_document?.code ?? null;
          const named = namedCode ? lookupRegistryCode(state.knowledge, namedCode) : null;
          const search = searchRegistry(state.knowledge, query, { limit: 8 });
          // L1 сэдвийн чиглүүлэгч (2026-09-18): сэдэв → ОЛОН баримт (код · нэр · албан холбоос · төлөв), LINKS_ONLY.
          //    L1 хүснэгт шингээгээгүй хуучин санд null — `/norm`-ийн гэрээ өөрчлөгдөхгүй.
          let topicRouter: ReturnType<typeof routeTopics> | null = null;
          try {
            topicRouter = topicRouterCount(state.knowledge) ? routeTopics(state.knowledge, query) : null;
          } catch (err) {
            console.error(`[norm] сэдвийн чиглүүлэгч унав: ${err instanceof Error ? err.message : String(err)}`);
          }
          registry = {
            named: named
              ? { ...named, deep_ingested: answer.named_document?.absent !== true, note_mn: answer.named_document?.absent ? 'Энэ норм бүртгэлд байгаа ч заалтын түвшинд шингээгээгүй — заалт зохиохгүй, албан холбоосыг л өгнө.' : null }
              : null,
            interpretation: search.interpretation,
            matches: search.matches,
            excluded_non_current: search.excluded_non_current,
            answer_mode: search.answer_mode,
            topic_router: topicRouter,
          };
        } catch (err) {
          console.error(`[norm] бүртгэлийн хайлт унав: ${err instanceof Error ? err.message : String(err)}`);
        }

        // L2 — НОРМ ОЙЛГОХ ДАВХАРГА (2026-09-18, эхлээд зөвхөн БНбД 31-17-10): `askNorm` олсон заалтын
        //    (яг/ойролцоо), нэрлэсэн баримтын хэсэг/баримтын тайлбарын бичлэг.  ХАЙЛТ БИШ — олдсон хэсгийн
        //    `chunk_id`-аар л; баримтын цоож хэвээр; `computable:false`; тайлбаргүй баримтад null.
        let explanation: ReturnType<typeof explainForAnswer> = null;
        try {
          explanation = explainForAnswer(state.knowledge, answer, query);
        } catch (err) {
          console.error(`[norm] L2 тайлбар унав: ${err instanceof Error ? err.message : String(err)}`);
        }

        return json(res, 200, {
          status: answer.status,
          registry,
          explanation,
          // ⚠️ `decisions` нь НЭРЛЭСЭН үр дүн — баримт бүр өөр түлхүүртэй
          //    (гал: GUAT/GMDH, захиалагчийн дүрэм: effect).  `decision` нь
          //    ХОЦРОГДСОН хос, зөвхөн гэрээний нийцлийн төлөө үлдсэн.
          decisions: answer.decisions,
          decision: answer.decision,
          rule_id: answer.rule_id,
          no_match_reason: answer.no_match_reason ?? null,
          // Нэрлэсэн баримт (цоож / санд байхгүй / солигдсон холбоо) — backend
          // `localNorm.ts` үүгээр «named_document_absent» ба цоожийг ялгана (P0-3).
          named_document: answer.named_document ?? null,
          diagnostics: answer.diagnostics ?? null,
          rule_kind: answer.rule_kind,
          rule_object_mn: answer.rule_object_mn,
          rule_actor: answer.rule_actor,
          inputs_used: answer.inputs_used,
          missing_context: answer.missing_context,
          citation: answer.citation,
          evidence: answer.evidence,
          note_mn: answer.note_mn,
          // ⚠️ Аль хөл олсныг ил гаргана — хайлтын алдааг оношлох цорын
          //    ганц арга.  Нууц мэдээлэл агуулаагүй.
          legs: answer.legs,
          elapsed_ms: Date.now() - started,
        });
      }

      /**
       * L2 ТАЙЛБАР — ШУУД ХАЯГААР (2026-09-18): `{code, clause?, appendix?, section?}`.  Хайлтгүй; баримт L2-гүй
       *    эсвэл заалт байхгүй бол `found:false` (ЗОХИОХГҮЙ).  Оношилгоо/үнэлгээ/«энэ юу гэсэн үг вэ» follow-up-д.
       */
      if (path === '/norm/explain' && req.method === 'POST') {
        if (state.knowledge === null) return json(res, 503, { error: 'Норматив мэдлэг суулгаагүй байна.' });
        const body = (await readBody(req)) as Record<string, unknown>;
        const code = typeof body.code === 'string' ? body.code.trim() : '';
        if (code.length === 0) return json(res, 400, { error: 'code хоосон байна.' });
        const docId = explainedDocIdForCode(state.knowledge, code);
        if (docId === null) return json(res, 200, { schema: EXPLANATION_SCHEMA, found: false, reason: 'document_not_explained', code });
        const clause = typeof body.clause === 'string' ? body.clause.trim() : '';
        const section = typeof body.section === 'string' || typeof body.section === 'number' ? String(body.section).trim() : '';
        const appendix = typeof body.appendix === 'string' ? body.appendix.trim() : null;
        // L2 (2026-09-23): хүснэгт / томьёо шууд хаягаар — хайлтгүй, байхгүй бол found:false.
        const table = typeof body.table === 'string' || typeof body.table === 'number' ? String(body.table).trim() : '';
        const formula = typeof body.formula === 'string' ? body.formula.trim() : '';
        if (table.length > 0) {
          const t = tableByNo(state.knowledge, docId, table);
          if (t === null) return json(res, 200, { schema: EXPLANATION_SCHEMA, found: false, reason: 'table_not_in_document', code, table });
          return json(res, 200, { schema: EXPLANATION_SCHEMA, found: true, mode: 'table', document: { doc_id: docId, code: t.norm_code }, clause: null, candidates: [], ambiguity: null, section: null, documentExplanation: null, table: t, table_matched_rows: [], formulas: [], classification: null, computable: false, currentness_routed: false });
        }
        if (formula.length > 0) {
          const f = formulaByLabel(state.knowledge, docId, formula);
          if (f === null) return json(res, 200, { schema: EXPLANATION_SCHEMA, found: false, reason: 'formula_not_in_document', code, formula });
          return json(res, 200, { schema: EXPLANATION_SCHEMA, found: true, mode: 'formula', document: { doc_id: docId, code: f.norm_code }, clause: null, candidates: [], ambiguity: null, section: null, documentExplanation: null, table: null, table_matched_rows: [], formulas: [f], classification: null, computable: false, currentness_routed: false });
        }
        if (clause.length > 0) {
          const { record, alternatives } = explanationByClause(state.knowledge, docId, clause, appendix);
          if (record === null) return json(res, 200, { schema: EXPLANATION_SCHEMA, found: false, reason: 'clause_not_in_document', code, clause });
          return json(res, 200, { schema: EXPLANATION_SCHEMA, found: true, mode: 'exact_clause', document: { doc_id: docId, code: record.norm_code }, clause: record, candidates: [], ambiguity: alternatives.length > 0 ? { chosen: record.clause_uid, alternatives: alternatives.map((a) => a.clause_uid) } : null, section: null, documentExplanation: null, computable: false, currentness_routed: false });
        }
        if (section.length > 0) {
          const sec = sectionExplanation(state.knowledge, docId, section);
          if (sec === null) return json(res, 200, { schema: EXPLANATION_SCHEMA, found: false, reason: 'section_not_in_document', code, section });
          return json(res, 200, { schema: EXPLANATION_SCHEMA, found: true, mode: 'section', document: { doc_id: docId, code: sec.norm_code }, clause: null, candidates: [], ambiguity: null, section: sec, documentExplanation: null, computable: false, currentness_routed: false });
        }
        const doc = documentExplanation(state.knowledge, docId);
        if (doc === null) return json(res, 200, { schema: EXPLANATION_SCHEMA, found: false, reason: 'document_not_explained', code });
        return json(res, 200, { schema: EXPLANATION_SCHEMA, found: true, mode: 'document', document: { doc_id: docId, code: doc.norm_code }, clause: null, candidates: [], ambiguity: null, section: null, documentExplanation: doc, computable: false, currentness_routed: false });
      }

      /**
       * L0 бүртгэлийн чиглүүлэгч — «ямар норм хамаарах вэ» (LINKS_ONLY).  Заалт, тоо ЭНДЭЭС ХЭЗЭЭ Ч
       * гарахгүй.  `include_non_current: true` бол DRAFT/SUPERSEDED/HISTORICAL ч гарна (төлөвтэйгөө).
       */
      if (path === '/norm/registry' && req.method === 'POST') {
        if (state.knowledge === null) return json(res, 503, { error: 'Норматив мэдлэг суулгаагүй байна.', hint: 'npm run ai:ingest:registry' });
        const body = (await readBody(req)) as Record<string, unknown>;
        const query = typeof body.query === 'string' ? body.query.trim() : '';
        if (query.length === 0) return json(res, 400, { error: 'query хоосон байна.' });
        const counts = registryCount(state.knowledge);
        if (counts === null || counts.norms === 0) return json(res, 503, { error: 'Нормын бүртгэл шингээгээгүй байна.', hint: 'npm run ai:ingest:registry' });
        const r = searchRegistry(state.knowledge, query, {
          limit: typeof body.limit === 'number' ? Math.min(25, Math.max(1, body.limit)) : 10,
          includeNonCurrent: body.include_non_current === true,
        });
        const code = typeof body.code === 'string' ? lookupRegistryCode(state.knowledge, body.code) : null;
        // L1 сэдвийн чиглүүлэгч — БҮХ таарсан баримт (хязгааргүй; төсөв/хөдөлмөр зөвхөн ил хүсэлтээр).
        const topicRouter = topicRouterCount(state.knowledge)
          ? routeTopics(state.knowledge, query, {
              includeCost: body.include_cost === true,
              includeLabour: body.include_labour === true,
              stemFallback: body.stem_fallback !== false,
            })
          : null;
        return json(res, 200, { ...r, named: code, counts, topic_router: topicRouter, topic_router_counts: topicRouterCount(state.knowledge) });
      }

      /** L1 сэдвийн каталог — id · монгол нэр · alias/баримтын тоо (UI, оношилгоо). */
      if (path === '/norm/topics' && req.method === 'GET') {
        if (state.knowledge === null) return json(res, 503, { error: 'Норматив мэдлэг суулгаагүй байна.', hint: 'npm run ai:ingest:registry' });
        const c = topicRouterCount(state.knowledge);
        if (c === null || c.topics === 0) return json(res, 503, { error: 'L1 сэдвийн чиглүүлэгч шингээгээгүй байна.', hint: 'npm run ai:ingest:registry' });
        return json(res, 200, { counts: c, topics: topicCatalog(state.knowledge) });
      }

      /** Шингээсэн мэдлэгийн товч — «юу мэдэж байна вэ». */
      if (path === '/norm/info' && req.method === 'GET') {
        if (state.knowledge === null) {
          return json(res, 200, { installed: false, expected_path: state.cfg.knowledgeDb });
        }
        // Session D §8 (2026-09-14): баримт бүрийн БАГЦЫН ТАНИХ ТЭМДЭГ (A-ийн `datasetIdentityOf` —
        //    ingest бүрд `metadata_json.dataset_identity`-д бичигддэг) + схемийн хувилбар + мэдлэгийн
        //    хурууны хээ.  B-ийн `NormSubsystemVersionProvider` (`knowledge_version`/`schema_version`) ба
        //    Worker-ийн бүртгэлтэй тулгах (`NORM_DATA_VERSION_MISMATCH`) хоёулаа ЭНДЭЭС уншина.
        //    Шинэ үнэн БИШ — A-ийн бичсэн тэмдгийг л ил гаргана.
        const docRows = state.knowledge
          .prepare(
            `SELECT doc_id, code, title_mn, effective_status, pages, ingested_at, metadata_json AS doc_metadata_json
               FROM ai_documents ORDER BY ingested_at DESC LIMIT 50`,
          )
          .all() as Array<{ doc_id: string; code: string; title_mn: string; effective_status: string; pages: number; ingested_at: string; doc_metadata_json: string }>;
        const identities: NormDocumentIdentity[] = docRows.map((r) => {
          const ident = datasetIdentityOf(r);
          return { documentId: r.doc_id, documentCode: r.code, datasetId: ident.id, datasetVersion: ident.version, datasetSha256: ident.sha256 };
        });
        const wire = toWire(identities);
        const docs = docRows.map(({ doc_metadata_json: _m, ...rest }, i) => ({ ...rest, ...wire[i] }));
        const knowledgeFingerprint = fingerprintFromHex('kf1', createHash('sha256').update(identityLines(identities)).digest('hex'));
        const counts = state.knowledge
          .prepare(
            `SELECT (SELECT COUNT(*) FROM ai_chunks) AS chunks,
                    (SELECT COUNT(*) FROM ai_rules) AS rules,
                    -- ⚠️ ХААЛГАТАЙГАА НЭГ ЖАГСААЛТААС.  Энэ тоо rules.ts-ийн
                    -- EXECUTABLE_VERIFICATION-ээс ЗӨРВӨЛ UI «82 мөр баталгаажаагүй»
                    -- гэж бичих ба хөдөлгүүр тэднийг ГҮЙЦЭТГЭСЭН хэвээр байна —
                    -- хамгийн төөрөгдүүлэх төрлийн зөрүү.
                    (SELECT COUNT(*) FROM ai_rules
                      WHERE verification_status NOT IN (${executableVerificationSql()})) AS unverified_rules,
                    (SELECT COUNT(*) FROM ai_aliases) AS aliases`,
          )
          .get();
        return json(res, 200, {
          installed: true,
          path: state.knowledgePath ?? state.cfg.knowledgeDb,
          documents: docs,
          counts,
          /** SQLite схемийн хувилбар (`ai_schema_meta`) — runtime-ийн `SCHEMA_VERSION`-тэй тэнцүү байх ёстой (§15). */
          schema_version: state.knowledgeSchema,
          runtime_schema_version: SCHEMA_VERSION,
          /** `kf1:<16 hex>` — баримт бүрийн `dataset_sha256`-аас детерминист (packages/mglai-common normIdentity). */
          knowledge_version: knowledgeFingerprint,
          /** Worker-ийн бүртгэлийн хурууны хээг PC мэдэхгүй — deployment агент `/api/mgl-ai/norm-registry`-ээс тулгана. */
          registry_version: null,
          /** L0 нормын бүртгэл (ai/norm-dataset) — шингээгээгүй бол null. */
          norm_registry: registryCount(state.knowledge),
          /** L1 сэдвийн чиглүүлэгч (2025 оны бүртгэлийн 524 мөр + 41 сэдэв) — шингээгээгүй бол null. */
          topic_router: topicRouterCount(state.knowledge),
          /** L2 заалтын тайлбар (ai/norm-dataset/documents/<Doc>/l2) — шингээгээгүй бол null. */
          explanations: explanationCounts(state.knowledge),
          explanation_objects: objectCounts(state.knowledge),
          // ⚠️ Вектор хөл унтарсныг ИЛ хэлнэ (§12) — «бүрэн гибрид хайлт»
          //    гэж ойлгуулах нь хэмжүүрийг гуйвуулна.
          vector_index: 'disabled (NullVectorIndex)',
        });
      }

      /**
       * МЭДЛЭГИЙН САНГИЙН КАТАЛОГ (2026-09-18) — «чамд ямар норм байгаа вэ» / «БНбД X юуны тухай вэ».
       *
       * ⚠️ ЭНЭ НЬ ХАЙЛТ БИШ, ЖАГСААЛТ.  `/norm` нь заалт хайдаг; энэ нь `ai_documents` +
       *    `section_path`-аас код · нэр · төлөв · тоо · бүлгийн гарчиг өгнө (`retrieval/src/catalog.ts`).
       *    Заалтын агуулга ЭНДЭЭС ХЭЗЭЭ Ч гарахгүй.  Worker (`/context`) үүнийг хэрэгслийн
       *    хайрцаг болгож, загвар зөвхөн НАЙРУУЛНА.  `code` байхгүй = бүх сан; байвал тэр баримт.
       */
      if (path === '/norm/catalog' && req.method === 'POST') {
        if (state.knowledge === null) {
          return json(res, 503, { error: 'Норматив мэдлэг суулгаагүй байна.', reason: 'not_installed', expected_path: state.cfg.knowledgeDb });
        }
        if (state.knowledgeSchema !== SCHEMA_VERSION) {
          return json(res, 503, { error: 'Норматив мэдлэгийн сангийн бүтэц runtime-тай зөрж байна — дахин шингээнэ үү.', reason: 'knowledge_schema_mismatch' });
        }
        const body = (await readBody(req)) as Record<string, unknown>;
        const code = typeof body.code === 'string' ? body.code.trim().slice(0, 64) : null;
        try {
          return json(res, 200, { ...normCatalog(state.knowledge, code), elapsed_ms: 0 });
        } catch (err) {
          const infra = err instanceof KnowledgeUnavailableError || isKnowledgeInfrastructureError(err);
          console.error(`[norm/catalog] унав (${infra ? 'дэд бүтэц' : 'дотоод'}): ${err instanceof Error ? err.message : String(err)}`);
          return json(res, 503, { error: 'Норматив мэдлэгийн сан түр хүрэлцэхгүй байна.', reason: infra ? 'knowledge_unavailable' : 'catalog_error' });
        }
      }

      // SESSION R (Phase 5) — SHARED_CLIENT_NEUTRAL_TURN_FOUNDATION.  Revit одоо энэ замаар,
      // хөтөч паритет тэнцсэний ДАРАА шилжинэ (одоо `orchestrator.ts` хэвээр);
      // plan → tools ‖ norm → context → generate → validate → messages
      // (`@mgl/mglai-common/turn`).  `/generate`-тэй ижил хаалганы ард.
      if (path === '/turn' && req.method === 'POST') {
        const body = await readBody(req);
        return handleTurn(req, res, body, {
          controlPlaneUrl: state.cfg.controlPlaneUrl,
          selfUrl: `http://${BIND_HOST}:${state.cfg.port}`,
          secret: state.secret,
          pairedToken: () => state.credentials.valid(),
          // Хөтчийн `probe()`-той ижил: runtime ХҮРЭГДЭЖ байвал «installed» — загваргүй үед
          // EchoEngine өөрийгөө ил зарладаг (CLAUDE.md «Загваргүйгээр ч ажиллана»).
          runtimeInfo: async () => ({ active_model: await state.manager.activeModel(), engine: state.engine.info() }),
        });
      }

      if (path === '/generate' && req.method === 'POST') {
        const body = (await readBody(req)) as Record<string, unknown>;
        const turns = parseTurns(body.turns);
        if (turns.length === 0) {
          return json(res, 400, { error: 'turns хоосон байна.' });
        }

        /**
         * КОНТЕКСТЫН ТӨСӨВ (§3) — ОРОЛТ + ГАРАЛТ НЬ ЦОНХОНД БАГТАХ ЁСТОЙ.
         *
         * ⚠️ ЭНЭ ШАЛГАЛТ БАЙХГҮЙ БАЙСАН.  Prompt нь цонхноос хэтэрвэл
         *    llama-server нь ТҮҮХИЙ 400 буцаадаг (хэмжсэн) бөгөөд
         *    хэрэглэгчид «Локал MGL AI алдаа: 400» гэж харагдана — юу
         *    буруу болсныг хэн ч ойлгохгүй.
         *
         * ⚠️ ТООЦООЛОЛ НЬ ОЙРОЛЦОО.  `estimateTokens` нь кирилл үсгийг
         *    2.2, бусдыг 4 тэмдэгт/токеноор тооцдог — жинхэнэ
         *    tokenizer БИШ.  Тиймээс аюулгүйн зай (`SAFETY`) үлдээнэ,
         *    мөн зөвхөн `max_tokens`-ыг БАГАСГАНА, prompt-ыг ОГТ
         *    таслахгүй: асуулт эсвэл заалтыг таслах нь дуугүй буруу
         *    хариу төрүүлнэ (даалгаврын §5-ийн «truncation that removes
         *    the question or instructions»).
         */
        const ctxTokens = state.engine.info().contextTokens;
        const promptTokens = estimateTokens(flattenTurns(turns));
        const SAFETY = 256;
        const MIN_OUTPUT = 128;
        const requested = typeof body.max_tokens === 'number' ? body.max_tokens : 1024;
        const room = ctxTokens - promptTokens - SAFETY;

        if (room < MIN_OUTPUT) {
          // ⚠️ ЧИМЭЭГҮЙ ТАСЛАХГҮЙ, ИЛ ХЭЛНЭ.  Дуудагч нотолгоогоо
          //    багасгах эсвэл түүхээ богиносгох ёстой.
          return json(res, 413, {
            error: 'Асуулт болон нотолгоо нь контекстын цонхонд багтахгүй байна.',
            code: 'context_overflow',
            context_tokens: ctxTokens,
            estimated_prompt_tokens: promptTokens,
          });
        }
        const maxTokens = Math.min(requested, room);

        // ── SSE ──────────────────────────────────────────────────
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });

        const controller = new AbortController();
        // Хэрэглэгч табаа хаавал үүсгэлтийг ЗОГСООНО — GPU-г дэмий
        // эзэлсэн урсгал нь дараагийн хүсэлтийг удаашруулна.
        req.on('close', () => controller.abort());

        const started = Date.now();
        let firstTokenMs: number | null = null;
        const send = (event: string, data: unknown) => {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        send('start', { engine: state.engine.info(), at: started });

        /**
         * ⚠️ ЦОХИЛТ (§10) — «АМЬД ЭСЭХ» ба «ТОКЕН» ХОЁР ӨӨР ЗҮЙЛ.
         *
         *    Урт prompt дээр llama.cpp-ийн prefill нь эхний токен гарахаас
         *    ӨМНӨ хэдэн секунд үргэлжилж болно.  Тэр чимээгүй хугацаанд
         *    хөтөч «холболт тасарсан уу, эсвэл ажиллаж байна уу» гэдгийг
         *    ЯЛГАЖ ЧАДАХГҮЙ байв — яг тэр тодорхойгүй байдал нь «20
         *    секундэд хариу өгсөнгүй» гэсэн улаан алдааг зөв мэт
         *    харагдуулж байсан.
         *
         * ⚠️ ЦОХИЛТ НЬ UI-Д ШИНЭ МӨР НЭМЭХГҮЙ.  Тэр нь зөвхөн «процесс
         *    амьд» гэсэн дохио — хөтөч түүгээр «ажиллаж байна»-г
         *    «холболт тасарсан»-аас ялгана (§10-ийн гурван төлөв).
         *
         * ⚠️ ЭХНИЙ ТОКЕН ГАРМАГЦ ЗОГСОНО.  Токен өөрөө хамгийн сайн
         *    цохилт — давхардуулах нь SSE-г дэмий дүүргэнэ.
         */
        const HEARTBEAT_MS = 2000;
        const heartbeat = setInterval(() => {
          if (firstTokenMs !== null) return;
          send('heartbeat', { stage: 'generation', elapsed_ms: Date.now() - started });
        }, HEARTBEAT_MS);
        heartbeat.unref?.();

        /**
         * ДАВТАЛТЫН ХАМГААЛАЛТ (§7) — ЗӨВХӨН ЭНД ХИЙЖ БОЛНО.
         *
         * ⚠️ ЯАГААД RUNTIME ДЭЭР, FRONTEND ДЭЭР БИШ ВЭ.  Даалгаврын
         *    шаардлага: «Do not merely hide repeated output while leaving
         *    generation running.»  Үүсгэлтийг ҮНЭХЭЭР зогсоох цорын ганц
         *    газар нь энэ — `controller.abort()` нь llama-server руу
         *    очиж буй HTTP урсгалыг таслах ба GPU суллагдана.  Хөтөч
         *    дээр илрүүлэх нь зөвхөн НУУНА, загвар 900 токен дуустал
         *    ажилласаар байна.
         *
         * ⚠️ АЛГОРИТМЫГ ДАВХАРДУУЛАХГҮЙ.  Нэг хэрэгжүүлэлт энд байна;
         *    хөтөч нь `stop_reason: 'repetition'` гэсэн ТУГИЙГ Л уншина.
         *    Хоёр газар илрүүлэх нь хосын зөрүү үүсгэнэ.
         */
        const repGuard = new StreamingRepetitionGuard();
        let repetitionTripped = false;

        /**
         * ХАТУУ ХУГАЦААНЫ ХЯЗГААР (§7).
         *
         * ⚠️ `max_tokens` нь ХАНГАЛТГҮЙ: маш удаан токен/сек үед 900 токен
         *    хэдэн минут үргэлжилж болно.  Энэ нь «Requests cannot run
         *    indefinitely» шаардлагын хоёр дахь тал.
         */
        let timedOut = false;
        const genTimeout = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, cfg.generateTimeoutMs);
        genTimeout.unref?.();

        try {
          for await (const chunk of state.engine.generate({
            turns,
            maxTokens,
            /**
             * ⚠️ ЭНД ӨГӨГДМӨЛ УТГА ТАВИХГҮЙ — `undefined` нь «загварын
             *    албан ёсны тохиргоог хэрэглэ» гэсэн утгатай
             *    (`engine/samplingPreset.ts`).
             *
             *    Өмнө нь энд `?? 0.3` гэж бичигдсэн байсан бөгөөд
             *    клиент temperature ХЭЗЭЭ Ч илгээдэггүй тул хүсэлт бүр
             *    0.3-аар явдаг байв.  Тэр нь Qwen3-ийн «DO NOT use
             *    greedy decoding … endless repetitions» гэсэн
             *    сануулгын яг эсрэг тал.  Хөдөлгүүрийн preset-ийг
             *    зассан ч ЭНЭ МӨР түүнийг чимээгүй дарж байх байсан.
             */
            temperature: typeof body.temperature === 'number' ? body.temperature : undefined,
            stop: Array.isArray(body.stop) ? (body.stop as string[]) : undefined,
            signal: controller.signal,
          })) {
            if (chunk.type === 'token') {
              if (firstTokenMs === null) {
                firstTokenMs = Date.now() - started;
                clearInterval(heartbeat);
              }
              send('token', { text: chunk.text });

              // ⚠️ ТОКЕН ИЛГЭЭСНИЙ ДАРАА шалгана.  Аль хэдийн явсан
              //    текстийг буцаах боломжгүй тул хөтөч нь `done`-ийн
              //    тугаар «энэ хариулт ХҮЧИНГҮЙ» гэдгийг мэдэж, түүнийг
              //    ЗӨВ хариулт болгон ХАДГАЛАХГҮЙ (§7).
              const verdict = repGuard.push(chunk.text);
              if (verdict.repeating) {
                repetitionTripped = true;
                /**
                 * ⚠️ ДАВТАГДСАН ХЭЛЛЭГИЙГ ЛОГ РУУ БИЧНЭ — ХУДАЛ ЭЕРЭГИЙГ
                 *    ОНОШЛОХ ЦОРЫН ГАНЦ АРГА.  Илрүүлэгч ЗӨВ хариултыг
                 *    барьсан эсэхийг дараа нь шалгах боломжгүй бол
                 *    хэрэглэгчийн гомдлыг баталгаажуулах аргагүй болно.
                 *
                 * ⚠️ ЗӨВХӨН МӨЧЛӨГ (дээд тал нь 120 тэмдэгт), БҮТЭН
                 *    ХАРИУЛТ БИШ.  Лог нь ажилтны PC дээр үлдэнэ; нууц
                 *    баримтын агуулга энд ОРОХГҮЙ.
                 */
                log(
                  `давталт илрэв: ${verdict.cycleWords} үгийн мөчлөг ×${verdict.repeats} ` +
                    `— үүсгэлтийг зогсоов :: ${JSON.stringify(verdict.phrase.slice(0, 120))}`,
                );
                controller.abort(); // ⚠️ GPU-г ҮНЭХЭЭР суллана
                break;
              }
            } else if (chunk.type === 'done') {
              /**
               * ⚠️ ЭЦСИЙН ШАЛГАЛТ ЗААВАЛ.  Урсгалын хамгаалагч нь 48
               *    тэмдэгт тутамд Л шалгадаг (CPU-г хэмнэх) тул сүүлийн
               *    хэсэгт л босгыг давсан давталт МӨЛХӨЖ ГАРНА.
               *
               *    ХЭМЖСЭН (2026-09-09, 24 амьд гүйлт): яг ийм нэг
               *    тохиолдол гарсан — хариулт 900 токены таазанд хүрч
               *    давтагдсан атлаа `stop_reason` нь `length` гэж
               *    мэдээлэгдэж, програм түүнийг ЗӨВ хариулт гэж
               *    хадгалах байсан.
               *
               * ⚠️ ЭНД ҮҮСГЭЛТ АЛЬ ХЭДИЙН ДУУССАН тул зогсоох юм алга.
               *    Гэвч ТЭМДЭГЛЭХ нь чухал: §7-ийн «Treat detection as a
               *    failed/incomplete response, not a correct answer».
               */
              if (!repetitionTripped && repGuard.finish().repeating) {
                repetitionTripped = true;
                log(
                  `давталт ЭЦЭСТ илрэв: ${repGuard.verdict.cycleWords} үгийн мөчлөг ` +
                    `×${repGuard.verdict.repeats} :: ${JSON.stringify(repGuard.verdict.phrase.slice(0, 120))}`,
                );
              }
              send('done', {
                // ⚠️ ДАВТАЛТ нь `stop`/`length`-ээс ӨӨР зогсох шалтгаан.
                //    Хөтөч үүнийг БҮТЭЛГҮЙТЭЛ гэж үзнэ, амжилт гэж БИШ.
                // ⚠️ ГУРВАН ӨӨР ЗОГСОХ ШАЛТГААН.  `aborted` нь ХЭРЭГЛЭГЧ
                //    зогсоосон гэсэн утгатай тул хугацаа дууссаныг түүнтэй
                //    хольж болохгүй — хоёрын UI өөр (§20).
                stop_reason: repetitionTripped
                  ? 'repetition'
                  : timedOut
                    ? 'timeout'
                    : chunk.stopReason,
                repetition: repetitionTripped
                  ? {
                      cycle_words: repGuard.verdict.cycleWords,
                      repeats: repGuard.verdict.repeats,
                    }
                  : null,
                usage: chunk.usage,
                first_token_ms: firstTokenMs,
                total_ms: Date.now() - started,
                engine: state.engine.info().engine,
                runtime_variant: state.engine.info().runtimeVariant,
              });
            } else {
              send('error', { message: chunk.message });
            }
          }
        } catch (err) {
          send('error', { message: (err as Error).message });
        } finally {
          clearInterval(heartbeat);
          clearTimeout(genTimeout);
        }

        // ⚠️ УРСГАЛ ТАСРАХАД `done` ИЛГЭЭГДЭЭГҮЙ ҮЛДЭЖ БОЛНО.  Давталт
        //    илэрч `break` хийсэн, эсвэл хугацаа дууссан тохиолдолд
        //    хөдөлгүүрийн `done` хэсэг хүрэхгүй байж болзошгүй — тэр үед
        //    хөтөч мөнхөд хүлээнэ.  Тиймээс ЭНД баталгаажуулна.
        if (repetitionTripped) {
          send('done', {
            stop_reason: 'repetition',
            repetition: {
              cycle_words: repGuard.verdict.cycleWords,
              repeats: repGuard.verdict.repeats,
            },
            usage: { promptTokens: null, completionTokens: null },
            first_token_ms: firstTokenMs,
            total_ms: Date.now() - started,
            engine: state.engine.info().engine,
            runtime_variant: state.engine.info().runtimeVariant,
          });
        }
        res.end();
        return;
      }

      if (path === '/bench' && req.method === 'POST') {
        const body = (await readBody(req)) as Record<string, unknown>;
        const result = await runBenchmark(
          state,
          typeof body.max_tokens === 'number' ? body.max_tokens : 128,
        );
        return json(res, 200, result);
      }

      if (path === '/model/activate' && req.method === 'POST') {
        const body = (await readBody(req)) as Record<string, unknown>;
        const uid = typeof body.release_uid === 'string' ? body.release_uid : '';
        if (!uid) return json(res, 400, { error: 'release_uid шаардлагатай.' });

        // ⚠️ P0-5: идэвхжүүл → хөдөлгүүр дахин барих → SMOKE (§38) → унавал буцаах нь
        //    activation.ts-ийн `switchModel` — updater.ts-тэй ИЖИЛ семантик, энд давхардуулахгүй.
        //    Эвдэрсэн хувилбар дээр үлдэх нь ажилтныг AI-гүй орхино.
        const r = await switchModel({
          activate: () => state.manager.activate(uid),
          rollback: () => state.manager.rollback(),
          reloadEngine: () => state.rebuildEngine!(),
          smokeTest: () => state.engine.load(),
          log,
        });
        if (!r.ok) {
          return json(res, 500, {
            error:
              r.code === 'ROLLBACK_FAILED'
                ? `Идэвхжүүлэлт бүтэлгүйтэв, өмнөх хувилбар ч ачаалагдсангүй: ${r.detail}`
                : `Идэвхжүүлэлт бүтэлгүйтэв, өмнөх хувилбар руу буцлаа: ${r.detail}`,
            code: r.code,
            rolled_back: r.code === 'SMOKE_FAILED_ROLLED_BACK',
          });
        }

        return json(res, 200, { ok: true, engine: state.engine.info() });
      }

      /* ============================================================ */
      /*  SESSION B — СУУЛГАЦ / HEALTH / ДИАГНОСТИК (§11, §16, §30)      */
      /* ============================================================ */

      if (path.startsWith('/deploy/')) {
        const agent = state.deploy;
        if (!agent) return json(res, 503, { error: 'Deployment agent идэвхгүй.', code: 'DEPLOY_AGENT_UNAVAILABLE' });

        if (path === '/deploy/health' && req.method === 'GET') {
          // ⚠️ `?full=1` нь загварыг АЧААЛНА (VRAM) + 8 токен үүсгэнэ — зөвхөн эхний ажиллуулалт/repair.
          const full = url.searchParams.get('full') === '1';
          if (full && engineBusy(state)) return json(res, 409, { error: 'Хариулт бичиж байна.', code: 'busy' });
          const phase = state.updateStatus().phase;
          const r = await agent.report({ light: !full, updating: phase === 'downloading' || phase === 'installing' });
          return json(res, 200, r);
        }
        if (path === '/deploy/health/last' && req.method === 'GET') {
          return json(res, 200, agent.lastReport() ?? { status: 'UNKNOWN', checks: [] });
        }
        if (path === '/deploy/state' && req.method === 'GET') {
          await agent.syncInstalled();
          return json(res, 200, { installed: await agent.store.read(), telemetry_level: await agent.telemetryLevel() });
        }
        if (path === '/deploy/telemetry' && req.method === 'POST') {
          const body = (await readBody(req)) as Record<string, unknown>;
          if (!isTelemetryLevel(body.level) || body.level === 'DEBUG') {
            // DEBUG нь ЗӨВХӨН серверээс (heartbeat-ийн хариугаар) — локал хуудаснаас асаахгүй.
            return json(res, 400, { error: 'level нь OFF | MINIMAL | QUALITY байна.' });
          }
          await agent.setTelemetryLevel(body.level);
          return json(res, 200, { ok: true, level: body.level });
        }
        if (path === '/deploy/heartbeat' && req.method === 'POST') {
          return json(res, 200, await agent.heartbeat());
        }
        if (path === '/deploy/diagnostics' && req.method === 'GET') {
          const d = await agent.diagnostics();
          return json(res, d.ok ? 200 : 422, d);
        }
        return json(res, 404, { error: 'Ийм гарц байхгүй.' });
      }

      if (path === '/shutdown' && req.method === 'POST') {
        json(res, 200, { ok: true });
        setTimeout(() => {
          state.engine.unload().finally(() => process.exit(0));
        }, 50);
        return;
      }

      return json(res, 404, { error: 'Ийм гарц байхгүй.' });
    } catch (err) {
      log(`алдаа ${path}: ${(err as Error).message}`);
      return json(res, 500, { error: (err as Error).message });
    }
  });
}

/* ================================================================== */

export interface BenchResult {
  engine: string;
  runtime_variant: string;
  model_version: string | null;
  quantization: string | null;
  context_tokens: number;
  hardware: { cpu: string; gpu: string | null; vram_mb: number | null; ram_mb: number };
  load_ms: number;
  first_token_ms: number | null;
  total_ms: number;
  tokens: number;
  tokens_per_sec: number | null;
  measured_at: string;
}

/**
 * ⚠️ ХЭМЖИНЭ, ЗОХИОХГҮЙ (§40: «Do not fake performance numbers»).
 *    Энэ функцийн гаралт нь `ai/evaluation/benchmarks/`-д ТӨХӨӨРӨМЖИЙН
 *    ХУРУУНЫ ХЭЭТЭЙГЭЭ хамт хадгалагдана.  Баримтад тоо бичихээс өмнө
 *    ЭНЭ ажиллах ЁСТОЙ.
 */
export async function runBenchmark(state: RuntimeState, maxTokens = 128): Promise<BenchResult> {
  const loadStart = Date.now();
  await state.engine.load();
  const loadMs = Date.now() - loadStart;

  const turns: EngineTurn[] = [
    { role: 'system', content: 'Чи бол Монгол хэлний барилгын мэргэжлийн туслах. Товч хариул.' },
    { role: 'user', content: 'Барилгын ажлын зургийн иж бүрдэлд ямар үндсэн хэсгүүд ордог вэ?' },
  ];

  const start = Date.now();
  let firstTokenMs: number | null = null;
  let tokens = 0;

  // ⚠️ Хэмжүүр нь ПРОДАКШНЫ тохиргоог хэмжих ёстой.  Тусдаа temperature
  //    өгвөл benchmark нь хэрэглэгчийн үзэхээс ӨӨР зүйлийг хэмжинэ.
  for await (const chunk of state.engine.generate({ turns, maxTokens })) {
    if (chunk.type === 'token') {
      firstTokenMs ??= Date.now() - start;
      tokens += 1;
    }
  }
  const totalMs = Date.now() - start;
  const genMs = firstTokenMs === null ? totalMs : totalMs - firstTokenMs;

  const info = state.engine.info();
  return {
    engine: info.engine,
    runtime_variant: info.runtimeVariant,
    model_version: info.modelVersion,
    quantization: info.quantization,
    context_tokens: info.contextTokens,
    hardware: {
      cpu: state.hardware.cpu,
      gpu: state.hardware.gpu,
      vram_mb: state.hardware.vramMb,
      ram_mb: state.hardware.ramMb,
    },
    load_ms: loadMs,
    first_token_ms: firstTokenMs,
    total_ms: totalMs,
    tokens,
    tokens_per_sec: genMs > 0 && tokens > 0 ? Math.round((tokens / genMs) * 1000 * 10) / 10 : null,
    measured_at: new Date().toISOString(),
  };
}

/* ================================================================== */

export async function main(): Promise<void> {
  const state = await buildState();
  const server = createRuntimeServer(state);

  server.listen(state.cfg.port, BIND_HOST, () => {
    log(`MGL AI runtime ${RUNTIME_VERSION} — http://${BIND_HOST}:${state.cfg.port}`);
    log(`хөдөлгүүр: ${state.engine.info().engine} — ${state.engineReason}`);
    log(
      `төхөөрөмж: ${state.hardware.cpu} · ${state.hardware.ramMb} MB RAM · ` +
        `${state.hardware.gpu ?? 'GPU илрээгүй'}${state.hardware.vramMb ? ` (${state.hardware.vramMb} MB)` : ''}`,
    );

    log(
      `гүйцэтгэлийн профайл: ${state.profile} (${state.profileSource}) — ` +
        `${state.plan?.reason ?? 'төлөвлөгөөгүй'}`,
    );
    for (const n of state.plan?.notices ?? []) log(`  · ${n}`);

    /**
     * ⚠️ ЭХЛЭЛТЭД ЗАГВАРЫГ АЧААЛАХАА БОЛИВ (2026-09-09, §6).
     *
     *    2026-09-08-нд энд `state.engine.load()` байсан: өдрийн эхний
     *    асуулт 7 411 мс хүлээдэг байсныг засах гэж.  Тэр нь TTFT-д
     *    зөв ч §6-ийн «Avoid wasting GPU/RAM all day if the user never
     *    opens MGL AI» шаардлагын ШУУД эсрэг — ХЭМЖИГДСЭН: ачаалагдсан
     *    8B загвар нь асуулт асуугаагүй байхад 6 541 MiB VRAM эзэлнэ.
     *    8 GB картан дээр тэр нь Revit-д өдөржин хохирол.
     *
     *    Одоо ачаалалт нь ХОЁР бодит дохионы аль нэгээр эхэлнэ:
     *      · хөтөч AI хуудсыг нээхэд        → `POST /warmup`
     *      · эхний асуулт ирэхэд            → `generate()`-ийн `load()`
     *    Хоёулаа «хэрэглэгч MGL AI-г ҮНЭХЭЭР ашиглаж байна» гэсэн үг.
     *
     * ⚠️ ТИЙМЭЭС ЭНД ЗӨВХӨН ХӨНГӨН АЖИЛ.  Процесс нь ~60 MB RAM эзэлж,
     *    GPU-д ОГТ хүрэхгүй суух ба тэр нь нэвтрэх бүрд асахад тохирно.
     */
    startIdleWatcher(state);
    startUpdateWatcher(state);
    // Session B — 2 мин дараа хөнгөн health + heartbeat, дараа нь 30 мин тутам.
    state.deploy?.start();
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      log(`Порт ${state.cfg.port} эзэлсэн байна — MGL AI аль хэдийн ажиллаж байна уу?`);
      process.exit(1);
    }
    throw err;
  });

  const stop = () => {
    log('зогсож байна…');
    server.close();
    state.engine.unload().finally(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  /**
   * ⚠️ ЧИМЭЭГҮЙ ҮХЭЛТИЙН ЭСРЭГ (2026-09-11).  Node нь unhandled rejection
   *    дээр ӨГӨГДМӨЛӨӨР процессыг ЗОГСООДОГ — хойд дэвсгэрийн шинэчлэлтийн
   *    нэг унасан fetch нь бүх runtime-ыг авч унагаад, ажилтанд «MGL AI
   *    суугаагүй» гэж харагддаг байв.  Rejection-ыг ЛОГЛООД үргэлжлүүлнэ:
   *    сервер нь хүсэлт бүрээ өөрийн try/catch-аар хамгаалдаг тул нэг
   *    promise-ийн алдаа нь төлөвийг эвддэггүй.
   *
   *    Харин `uncaughtException` нь синхрон гэмтэл — төлөв найдваргүй тул
   *    ЛОГЛООД ГАРНА; супервайзер (`scripts/start.ps1 -Supervise`, эсвэл
   *    суулгагчийн даалгаврын RestartCount) цэвэр процессоор сэргээнэ.
   *    Дахин асаах нь ЭНД биш — процесс өөрийгөө сэргээх нь найдваргүй.
   */
  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
    log(`⚠️ unhandled rejection (үргэлжилнэ): ${msg}`);
  });
  process.on('uncaughtException', (err) => {
    log(`✖ uncaught exception — гарч байна, супервайзер сэргээнэ: ${err.stack ?? err.message}`);
    try {
      server.close();
    } catch {
      /* аль хэдийн хаагдсан */
    }
    state.engine.unload().catch(() => undefined).finally(() => process.exit(1));
    // unload гацвал ч 5 секундэд ЗААВАЛ гарна — супервайзер хүлээж байна.
    setTimeout(() => process.exit(1), 5000).unref();
  });
}

// `node src/server.ts` гэж шууд ажиллуулбал сервер асна.
if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) {
  main().catch((err: Error) => {
    process.stderr.write(`[mgl-ai] эхлүүлж чадсангүй: ${err.message}\n`);
    process.exit(1);
  });
}
