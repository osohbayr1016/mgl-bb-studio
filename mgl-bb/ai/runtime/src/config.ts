/**
 * MGL AI · ЛОКАЛ RUNTIME-ИЙН ТОХИРГОО.
 *
 * ⚠️ ЗАМУУД НЬ ХЭРЭГЛЭГЧИЙН ПРОФАЙЛД, PROGRAM FILES-Д БИШ.  Ажилтан нь
 *    админ эрхгүй байж болно; мөн загварын артефакт нь гигабайт тул
 *    хэрэглэгч тус бүрд биш, машин тус бүрд НЭГ хувь байх нь зөв —
 *    гэвч LOCALAPPDATA нь хэрэглэгчийнх.  Энэ буулт нь ЗОРИУД: нэг PC-г
 *    хоёр ажилтан хуваалцах нь MGL-д ховор, харин админ эрх шаардах нь
 *    20 машины суулгацыг зогсооно.
 *
 * ⚠️ ПОРТ 39217 — санамсаргүй сонгосон өндөр порт.  Түгээмэл портоос
 *    (8080, 3000, 11434) ЗАЙЛСХИЙСЭН: Ollama, LM Studio зэрэг хэрэгсэл
 *    тэднийг эзэлдэг ба мөргөлдөөн нь оношлоход хэцүү.
 */
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

export const RUNTIME_VERSION = '1.0.1';

/** ⚠️ ЗӨВХӨН loopback.  Тохируулах боломжгүй байх нь аюулгүй байдлын шийдвэр. */
export const BIND_HOST = '127.0.0.1';
export const DEFAULT_PORT = 39217;
/** llama-server-ийн дотоод порт — гадагш огт гарахгүй. */
export const DEFAULT_ENGINE_PORT = 39218;

export interface RuntimeConfig {
  port: number;
  /**
   * Нэг үүсгэлтийн ХАТУУ дээд хугацаа, мс (§7).
   *
   * ⚠️ `max_tokens` нь ХАНГАЛТГҮЙ.  Токен/сек унавал (GPU-гүй унасан,
   *    эсвэл өөр процесс VRAM идсэн) 900 токен хэдэн минут үргэлжилнэ.
   *    Энэ нь «Requests cannot run indefinitely» шаардлагын хоёр дахь
   *    тал — токены тоо БА цаг ХОЁУЛАА хязгаартай байх ёстой.
   */
  generateTimeoutMs: number;
  enginePort: number;
  /** Бүх артефакт, нууц, кэшийн үндэс. */
  dataDir: string;
  modelsDir: string;
  binDir: string;
  /**
   * Локал мэдлэгийн сан (§10, §11) — норматив хэсэг, дүрэм, FTS5 индекс.
   *
   * ⚠️ ЗАГВАРААС ТУСДАА ХАВТАС.  Загвар солиход мэдлэг ҮЛДЭХ ёстой:
   *    `models/` нь хувилбараар солигддог, `knowledge/` нь хуримтлагддаг.
   *    Нэг хавтсанд байрлуулбал загварын цэвэрлэгээ нормыг аваад явна.
   */
  knowledgeDir: string;
  knowledgeDb: string;
  secretFile: string;
  stateFile: string;
  /**
   * ХОСОЛСОН ERP ИТГЭМЖЛЭЛ (§4).
   *
   * ⚠️ ХЭРЭГЛЭГЧЭЭС АСУУДАГГҮЙ.  Хөтөч нь ERP-д нэвтэрсэн байхдаа
   *    `POST /pair` рүү өөрийн токеноо дамжуулна.  Ажилтан ямар ч
   *    түлхүүр хараагүй, хуулаагүй — §4-ийн шаардлагыг яг тэр.
   */
  credentialFile: string;
  /**
   * Хэрэглэгчийн сонгосон тохиргоо (гүйцэтгэлийн профайл г.м).
   *
   * ⚠️ `state.json`-ООС ТУСДАА ФАЙЛ.  Тэр нь загварын менежерийнх
   *    бөгөөд шинэчлэлт бүрд дахин бичигддэг; хэрэглэгчийн сонголт
   *    түүнтэй хамт алдагдах ЁСГҮЙ.
   */
  settingsFile: string;
  /**
   * СУЛ ЗОГСОЛТЫН ДАРААХ БУУЛГАЛТ, мс (§6).
   *
   * ⚠️ ЯАГААД 0 БИШ, ЯАГААД БАГА БИШ.  Загвар нь 5-7 GB VRAM эзэлдэг
   *    тул ажилтан AI-г нэг асуулт асуугаад мартвал тэр санах ой
   *    өдөржин баригдана — Revit, хөтөч тэр VRAM-ыг хүсэж байна.
   *    Гэвч дахин ачаалахад 10-20 секунд орох тул хэт богино завсар нь
   *    ажилтныг ХҮЛЭЭЛГЭНЭ.  20 минут нь «цайны цаг» ба «өөр ажил
   *    руу шилжсэн» хоёрын хооронд.
   *
   * ⚠️ 0 = ХЭЗЭЭ Ч БУУЛГАХГҮЙ (хөгжүүлэлт, benchmark).
   */
  idleUnloadMs: number;
  /** Шинэчлэлт шалгах давтамж, мс.  0 = автоматаар шалгахгүй. */
  updateCheckMs: number;
  /**
   * Гүйцэтгэлийн профайлын ХҮЧЭЭР тавьсан утга (env), эсвэл `null`.
   * `null` бол `settings.json` → автомат сонголт гэсэн дарааллаар.
   */
  perfProfileEnv: string | null;
  /** ERP Worker-ийн origin — манифест, heartbeat эндээс. */
  controlPlaneUrl: string;
  /** Хөтчийн зөвшөөрөгдсөн гарал үүсэл. */
  allowedOrigins: string[];
  /** Загваргүй ажиллах эсэх (тест, CI, анхны ажиллуулалт). */
  forceEcho: boolean;
  /**
   * ⚠️ ХӨГЖҮҮЛЭЛТ / ҮНЭЛГЭЭНИЙ ЗАМ — гараар авсан GGUF файлыг ШУУД заана.
   *
   * ЯАГААД ЭНЭ ОРШИН БАЙНА.  `ai_model_releases`-ийн `license_cleared`
   * хаалга нь БИДНИЙ МАНИФЕСТЭЭР 40 ажилтан руу ТҮГЭЭХИЙГ хаадаг — тэр нь
   * арилжааны дахин түгээлт учир хатуу байх ёстой.  Харин хөгжүүлэгч
   * ӨӨРИЙН машин дээр өөрөө татсан жинг УНШИХ нь түгээлт БИШ.  Хоёрыг
   * нэг хаалгаар барих нь үнэлгээг бүрмөсөн хаах ба «загвар ажиллахгүй»
   * гэсэн байдалд хүргэнэ.
   *
   * ⚠️ ГЭХДЭЭ: энэ замаар ачаалсан загвар нь `modelVersion: 'dev-local'`
   *    гэж ТЭМДЭГЛЭГДЭНЭ ба `/info`-д ил гарна.  Релизийн бүртгэлд
   *    ОРОХГҮЙ, ажилтан руу ТАРАХГҮЙ.  Тестийн тоог продакшны тоо мэт
   *    үзүүлэхээс сэргийлнэ.
   */
  devModelPath: string | null;
  /** `devModelPath`-тай хамт: ямар quantization гэж тэмдэглэх. */
  devModelQuant: string | null;
  /**
   * ⚠️ ХӨГЖҮҮЛЭЛТ / ҮНЭЛГЭЭ — GGUF LoRA адаптерыг ШУУД заана (`MGLAI_LORA_PATH`).
   *
   * `MGLAI_MODEL_PATH`-ийн ижил зарчим: суурь ба нэр дэвшигч адаптерыг ЯГ ижил
   * suite-ээр харьцуулахын тулд (§31) хоёр дахь runtime-ийг өөр порт дээр
   * (`MGLAI_PORT`/`MGLAI_ENGINE_PORT`/`MGLAI_DATA_DIR`) энэ адаптертай асаана.
   * `/info`-д `adapterVersion: 'dev-candidate:<файл>'` гэж ИЛ тэмдэглэгдэнэ,
   * релизийн бүртгэлд ОРОХГҮЙ, ажилтан руу ТАРАХГҮЙ.
   */
  devLoraPath: string | null;
}

function baseDir(): string {
  const home = homedir();
  if (platform() === 'win32') {
    return process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
  }
  return process.env.XDG_DATA_HOME ?? join(home, '.local', 'share');
}

/**
 * ⚠️ ЗӨВШӨӨРӨГДСӨН ГАРАЛ ҮҮСЭЛ.  Прод + локал хөгжүүлэлт.  Энэ жагсаалт
 *    нь `auth.ts`-ийн 3-р давхарга — өргөтгөх нь ХОРТОЙ ХУУДАСНЫ гадаргууг
 *    шууд нэмнэ, тул шинэ мөр нэмэхээсээ өмнө бод.
 */
const DEFAULT_ORIGINS = [
  'https://mgl-design-system.pages.dev',
  'https://www.mglenc.com',
  'https://mglenc.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

// ⚠️ `frontend/src/shared/api/apiHost.ts`-ийн `DEFAULT_API_HOST`-ийн ХОСЛОЛ.
//    workers.dev дэд домэйн нь АКАУНТАД харьяалагддаг тул компанийн
//    акаунтын нэр (`mglenc-design`) энд заавал орно — хуучин хувийн
//    акаунтын хаяг руу заавал хуучин Worker руу залгана.
//    Хоёр файлыг ХАМТ өөрчил.
const DEFAULT_CONTROL_PLANE = 'https://mgl-progress-api.mglenc-design.workers.dev';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const dataDir = env.MGLAI_DATA_DIR ?? join(baseDir(), 'MglAi');
  const extraOrigins = (env.MGLAI_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return {
    port: Number(env.MGLAI_PORT ?? DEFAULT_PORT),
    // 5 минут: CPU дээр унасан 8B загвар ч 900 токеныг үүнд багтаана.
    generateTimeoutMs: Number(env.MGLAI_GENERATE_TIMEOUT_MS ?? 300_000),
    enginePort: Number(env.MGLAI_ENGINE_PORT ?? DEFAULT_ENGINE_PORT),
    dataDir,
    modelsDir: join(dataDir, 'models'),
    binDir: join(dataDir, 'bin'),
    knowledgeDir: join(dataDir, 'knowledge'),
    knowledgeDb: join(dataDir, 'knowledge', 'knowledge.sqlite'),
    secretFile: join(dataDir, 'secret.txt'),
    stateFile: join(dataDir, 'state.json'),
    credentialFile: join(dataDir, 'credential.json'),
    settingsFile: join(dataDir, 'settings.json'),
    // 20 минут — «цайны цаг» ба «өөр ажил руу шилжсэн» хоёрын хооронд.
    idleUnloadMs: Number(env.MGLAI_IDLE_UNLOAD_MS ?? 20 * 60 * 1000),
    // 6 цаг — ажлын өдөрт хоёр удаа.  Илүү нь Worker-ийг дэмий цохино.
    updateCheckMs: Number(env.MGLAI_UPDATE_CHECK_MS ?? 6 * 60 * 60 * 1000),
    perfProfileEnv: env.MGLAI_PERF_PROFILE?.trim() || null,
    controlPlaneUrl: (env.MGLAI_CONTROL_PLANE ?? DEFAULT_CONTROL_PLANE).replace(/\/+$/, ''),
    allowedOrigins: [...DEFAULT_ORIGINS, ...extraOrigins],
    // ⚠️ `MGLAI_ENGINE=echo` нь ЗӨВХӨН гараар тавина.  Автомат fallback нь
    //    доор, `server.ts`-д — тэнд шалтгааныг нь ил хэлнэ.
    forceEcho: env.MGLAI_ENGINE === 'echo',
    devModelPath: env.MGLAI_MODEL_PATH?.trim() || null,
    devModelQuant: env.MGLAI_MODEL_QUANT?.trim() || null,
    devLoraPath: env.MGLAI_LORA_PATH?.trim() || null,
  };
}

/** llama-server-ийн хоёртын файлын нэр — платформоор. */
export function serverBinaryName(): string {
  return platform() === 'win32' ? 'llama-server.exe' : 'llama-server';
}
