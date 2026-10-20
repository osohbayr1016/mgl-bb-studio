/**
 * MGL AI · ЧИМЭЭГҮЙ ШИНЭЧЛЭЛТ (§16–§20, §35).
 *
 * ⚠️ ГУРВАН ТӨРЛИЙН ШИНЭЧЛЭЛТ, ГУРВАН ӨӨР ӨРТӨГ.  Тэднийг ЯЛГАХ нь
 *    энэ файлын оршин байх шалтгаан:
 *
 *      суурь загвар (base)   4-5 GB   ХОВОР — жилд нэг-хоёр
 *      адаптер   (adapter)   ~200 MB  ОЙР ОЙР — MGL AI 1.1, 1.2, 1.3
 *      мэдлэг    (knowledge) ~5 MB    ХАМГИЙН ОЙР — шинэ норм ирэх бүрд
 *
 *    Хэрэв шинэ норм нэмэгдэх болгонд 5 GB татдаг байсан бол 40 ажилтны
 *    сүлжээ боомилогдох ба ажилтнууд шинэчлэлтийг унтраана.  §19 нь
 *    үүнийг ШУУД хориглодог.
 *
 * ⚠️ ХЭРЭГЛЭГЧ ЮУ Ч ХИЙХГҮЙ (§20).  «Шинэчлэх үү?» гэсэн харилцах цонх
 *    БАЙХГҮЙ, «дахин суулгах» шидтэн БАЙХГҮЙ.  Хамгийн ихдээ явцын
 *    мөр: «MGL AI шинэчлэл татаж байна · 37%».
 *
 * ⚠️ ХЭЗЭЭ Ч АЖИЛЛАЖ БАЙГАА ХУВИЛБАР ДЭЭР ДАРЖ БИЧИХГҮЙ (§18).
 *      татах → шалгах → ХАЖУУД суулгах → smoke тест → идэвхжүүлэх
 *      унавал → БУЦААХ.
 *    Ажилтан ҮРГЭЛЖ ажилладаг MGL AI-тай үлдэнэ.
 *
 * ⚠️ ХЭРЭГЛЭГЧ АЖИЛЛАЖ БАЙХАД ХҮНД АЖИЛ ХИЙХГҮЙ (§35).  `isBusy()` нь
 *    үүсгэлт явж байгаа эсэхийг хэлнэ; явж байвал шинэчлэлт ХҮЛЭЭНЭ.
 *    Татах нь сүлжээ/диск тул тэвчигдэнэ, харин smoke тест нь загварыг
 *    ДАХИН АЧААЛДАГ — тэр нь VRAM-ыг хоёр дахин эзлэх ба яг тэр «бүх
 *    компьютер зогсов» гэсэн мөчийг үүсгэнэ.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { ModelManager, ReleaseManifestEntry } from './modelManager.ts';
import { switchModel } from '../../deployment/src/activation.ts';

/* ================================================================== */
/*  ХОСОЛСОН ИТГЭМЖЛЭЛ (§4, §5)                                        */
/* ================================================================== */

/**
 * ⚠️ ЯАГААД RUNTIME ЕРӨӨСӨӨ ТОКЕН ХАДГАЛДАГ ВЭ.
 *
 *    Манифест ба артефакт нь ERP-ийн эрхээр хамгаалагдсан (захиалагчийн
 *    Lite ба ажилтны загвар нь ӨӨР хариу).  Гэвч шинэчлэлт нь ХӨТӨЧГҮЙ,
 *    ХОЙД ДЭВСГЭРТ явах ёстой — тиймээс runtime-д ямар нэг итгэмжлэл
 *    хэрэгтэй.
 *
 * ⚠️ ХЭРЭГЛЭГЧЭЭС ХЭЗЭЭ Ч АСУУХГҮЙ (§4).  Токеныг ХӨТӨЧ өгнө: ажилтан
 *    ERP-д нэвтэрсэн байхад хуудас нь `POST /pair` рүү өөрийн JWT-г
 *    дамжуулна.  Ажилтан ямар ч түлхүүр хараагүй, хуулаагүй.
 *
 * ⚠️ УРТ НАСЛАЛТ ТОКЕН ЗОРИУД ХЭРЭГЛЭХГҮЙ.  ERP-ийн сесс 24 цаг амьдардаг
 *    бөгөөд бид түүнийг Л хадгална.  Хугацаа дуусвал шинэчлэлт нь дараагийн
 *    удаа ажилтан ERP нээх хүртэл ХҮЛЭЭНЭ — тэр нь өдөрт нэг удаа болдог.
 *    365 хоногийн MCP токен мэт зүйл минтлэх нь ЖИЛИЙН ТУРШ хүчинтэй
 *    итгэмжлэлийг диск дээр үлдээх ба тэр нь §40-ийн эсрэг.
 */
export interface PairedCredential {
  token: string;
  /** JWT-ийн `exp`-ээс — хугацаа дуусахыг МЭДЭЖ байх ёстой. */
  expiresAtMs: number | null;
  userId: number | null;
  pairedAtMs: number;
}

/**
 * JWT-ийн `exp`-ийг ГАРЫН АВЛАГААР унших — БАТАЛГААЖУУЛАХГҮЙ.
 *
 * ⚠️ ЭНЭ НЬ БАТАЛГААЖУУЛАЛТ БИШ, БАЙЖ Ч БОЛОХГҮЙ.  Runtime-д
 *    `JWT_SECRET` БАЙХГҮЙ ба байх ЁСГҮЙ (тэр нь ажилтны машин дээр
 *    компанийн бүх сессийг хуурамчаар үйлдэх түлхүүр байх байсан).
 *    Токены ҮНЭН БАТАЛГААЖУУЛАЛТ нь Worker дээр, хүсэлт бүрд.  Энд
 *    зөвхөн «хэзээ дуусахыг» уншиж, дэмий хүсэлт илгээхээс сэргийлнэ.
 */
export function readJwtExpiry(token: string): { expiresAtMs: number | null; userId: number | null } {
  try {
    const part = token.split('.')[1];
    if (!part) return { expiresAtMs: null, userId: null };
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(json) as { exp?: number; sub?: number | string };
    const exp = typeof payload.exp === 'number' ? payload.exp * 1000 : null;
    const sub = Number(payload.sub);
    return { expiresAtMs: exp, userId: Number.isFinite(sub) ? sub : null };
  } catch {
    return { expiresAtMs: null, userId: null };
  }
}

export class CredentialStore {
  readonly #file: string;
  #cached: PairedCredential | null = null;
  #loaded = false;

  constructor(file: string) {
    this.#file = file;
  }

  async load(): Promise<PairedCredential | null> {
    if (this.#loaded) return this.#cached;
    this.#loaded = true;
    try {
      const raw = await readFile(this.#file, 'utf8');
      this.#cached = JSON.parse(raw) as PairedCredential;
    } catch {
      this.#cached = null;
    }
    return this.#cached;
  }

  async save(token: string): Promise<PairedCredential> {
    const { expiresAtMs, userId } = readJwtExpiry(token);
    const cred: PairedCredential = { token, expiresAtMs, userId, pairedAtMs: Date.now() };
    await mkdir(dirname(this.#file), { recursive: true });
    /**
     * ⚠️ `mode: 0o600` — ЗӨВХӨН ЭЗЭН.  Windows дээр энэ нь бүрэн ACL
     *    биш ч файл нь аль хэдийн хэрэглэгчийн ӨӨРИЙН профайлын хавтсанд
     *    байгаа (`%LOCALAPPDATA%`), тэр нь бусад хэрэглэгчээс
     *    хамгаалагдсан.  Локал ХОРТОЙ ПРОЦЕССООС энэ нь хамгаалахгүй —
     *    гэхдээ тэр процесс хөтчийн `localStorage`-ыг мөн адил уншиж
     *    чадна, өөрөөр хэлбэл ЭНЭ НЬ ШИНЭ ГАДАРГУУ НЭМЭХГҮЙ.
     */
    await writeFile(this.#file, JSON.stringify(cred), { encoding: 'utf8', mode: 0o600 });
    this.#cached = cred;
    this.#loaded = true;
    return cred;
  }

  /** Хүчинтэй токен, эсвэл `null`.  ⚠️ Хугацаа дуусахаас 2 минутын өмнө хүчингүй гэж үзнэ. */
  async valid(now = Date.now()): Promise<string | null> {
    const c = await this.load();
    if (c === null) return null;
    if (c.expiresAtMs !== null && c.expiresAtMs - 120_000 <= now) return null;
    return c.token;
  }

  async clear(): Promise<void> {
    this.#cached = null;
    this.#loaded = true;
    await writeFile(this.#file, 'null', 'utf8').catch(() => undefined);
  }
}

/* ================================================================== */
/*  ШИНЭЧЛЭЛТИЙН ТӨЛӨВ                                                 */
/* ================================================================== */

export type UpdatePhase =
  | 'idle'
  /** Манифест шалгаж байна — сүлжээ, хэдэн зуун байт. */
  | 'checking'
  /** Татаж байна — сүлжээ + диск, CPU/GPU-д ХҮРЭХГҮЙ (§35). */
  | 'downloading'
  /** Шалгаж, идэвхжүүлж байна — ЭНД загвар ДАХИН АЧААЛАГДАНА. */
  | 'installing'
  /** Дууссан, дараагийн ачаалалтад хүчинтэй. */
  | 'ready'
  | 'failed';

export interface UpdateStatus {
  phase: UpdatePhase;
  /** Юуг шинэчилж байна — `base` | `adapter` | `knowledge` | `null`. */
  what: string | null;
  /** 0-100, эсвэл `null` (нийт хэмжээ мэдэгдэхгүй). */
  percent: number | null;
  /** Хэрэглэгчид ХАРАГДАХ монгол мөр (§20).  Техник нэр томьёо БАЙХГҮЙ. */
  message: string | null;
  /** Хамгийн сүүлд амжилттай шалгасан.  `null` = хэзээ ч шалгаагүй. */
  lastCheckedAtMs: number | null;
  /** ⚠️ Алдааг НУУХГҮЙ, гэхдээ хэрэглэгчийн урсгалыг ЗОГСООХГҮЙ. */
  error: string | null;
  /** Шинэчлэлтийн дараа дахин ачаалах шаардлагатай эсэх. */
  restartRequired: boolean;
}

export function idleStatus(): UpdateStatus {
  return {
    phase: 'idle',
    what: null,
    percent: null,
    message: null,
    lastCheckedAtMs: null,
    error: null,
    restartRequired: false,
  };
}

/* ================================================================== */
/*  ХУВИЛБАРЫН ХАРЬЦУУЛАЛТ                                             */
/* ================================================================== */

/**
 * ⚠️ ЦЭВЭР ФУНКЦ — тестлэгдэнэ.  `1.10` > `1.9` байх ЁСТОЙ; мөрөөр
 *    харьцуулбал эсрэгээр гарна ба ажилтнууд ХУУЧИН хувилбар дээр
 *    гацна.
 *
 * ⚠️ Тоо БИШ хэсгүүдийг (`1.2-beta`) МӨРӨӨР харьцуулна — тэр нь
 *    `1.2` < `1.2-beta` гэж гаргах ба beta нь ХОЙНО байх нь зөв.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.\-+]/);
  const pb = b.split(/[.\-+]/);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const xa = pa[i] ?? '';
    const xb = pb[i] ?? '';
    const na = Number(xa);
    const nb = Number(xb);
    if (Number.isFinite(na) && Number.isFinite(nb) && xa !== '' && xb !== '') {
      if (na !== nb) return na < nb ? -1 : 1;
      continue;
    }
    if (xa !== xb) return xa < xb ? -1 : 1;
  }
  return 0;
}

/** `minimum_runtime_version` шаардлагыг хангаж байгаа эсэх (§17). */
export function runtimeSupports(
  runtimeVersion: string,
  entry: Pick<ReleaseManifestEntry, 'minimum_runtime_version'>,
): boolean {
  const min = entry.minimum_runtime_version;
  if (!min) return true;
  return compareVersions(runtimeVersion, min) >= 0;
}

/* ================================================================== */
/*  ЗОХИОН БАЙГУУЛАГЧ                                                  */
/* ================================================================== */

export interface KnowledgeManifestEntry {
  pack_id: string;
  version: string;
  url: string;
  sha256: string;
  bytes: number | null;
}

export interface UpdaterDeps {
  manager: ModelManager;
  credentials: CredentialStore;
  runtimeVersion: string;
  knowledgeDir: string;
  controlPlane: string;
  /** ⚠️ Үүсгэлт явж байвал ХҮНД АЛХМЫГ хойшлуулна (§35). */
  isBusy: () => boolean;
  /** Адаптер солигдсоны дараа хөдөлгүүрийг ДАХИН барихыг хүснэ. */
  reloadEngine: () => Promise<void>;
  /** Ачаалж чадсан эсэхийг шалгах smoke тест (§18). */
  smokeTest: () => Promise<void>;
  /**
   * Session B (P0-5): мэдлэгийн багцыг ИДЭВХЖҮҮЛЭЛТИЙН ХӨДӨЛГҮҮРЭЭР суулгана
   * (`deployment/src/activation.ts` — staging → SHA → versions/<v>/ → заагч).
   * ⚠️ Байхгүй бол мэдлэгийн шинэчлэлт АЛГАСАГДАНА — `installKnowledgePack`-ийн
   *    хуучин `.pack` файл руу буцахгүй: тэр зам нь шингээдэггүй, заагчгүй,
   *    хоёр дахь идэвхжүүлэлтийн семантик байсан.
   */
  activateKnowledge?: (
    pack: KnowledgeManifestEntry,
    token: string,
  ) => Promise<{ ok: boolean; code: string; restartRequired: boolean }>;
  /** `installed.json`-оос мэдлэгийн одоогийн хувилбар (заагчийнх). */
  installedKnowledgeVersion?: () => Promise<string | null>;
  log: (msg: string) => void;
}

export class Updater {
  readonly #d: UpdaterDeps;
  #status: UpdateStatus = idleStatus();
  #running = false;

  constructor(deps: UpdaterDeps) {
    this.#d = deps;
  }

  get status(): UpdateStatus {
    return this.#status;
  }

  /** ⚠️ Зэрэгцээ дуудлагыг НЭГТГЭНЭ — хоёр татаж авалт нь сүлжээг хоёр хуваана. */
  async check(opts: { force?: boolean } = {}): Promise<UpdateStatus> {
    if (this.#running) return this.#status;
    this.#running = true;
    try {
      await this.#run(opts.force === true);
    } catch (err) {
      this.#status = {
        ...this.#status,
        phase: 'failed',
        // ⚠️ ХЭРЭГЛЭГЧИД ХАРАГДАХ мөр нь ТЕХНИКГҮЙ (§39).  Дэлгэрэнгүй
        //    нь `error`-т — түүнийг зөвхөн диагностик харуулна.
        message: 'MGL AI шинэчлэлт татаж чадсангүй. Дараа дахин оролдоно.',
        error: (err as Error).message,
      };
      this.#d.log(`шинэчлэлт амжилтгүй: ${(err as Error).message}`);
    } finally {
      this.#running = false;
    }
    return this.#status;
  }

  async #run(force: boolean): Promise<void> {
    const token = await this.#d.credentials.valid();
    if (token === null) {
      /**
       * ⚠️ ЭНЭ НЬ АЛДАА БИШ.  Ажилтан ERP-ээ хараахан нээгээгүй, эсвэл
       *    сесс нь дууссан.  Шинэчлэлт нь дараагийн нэвтрэлтэд явна.
       *    Улаан алдаа үзүүлэх нь ХУДАЛ дохио.
       */
      this.#status = { ...this.#status, phase: 'idle', message: null, error: null };
      return;
    }

    this.#status = {
      ...this.#status,
      phase: 'checking',
      message: 'MGL AI шинэчлэлт шалгаж байна…',
      error: null,
    };

    const releases = await this.#d.manager.fetchManifest(token);
    const state = await this.#d.manager.reconcile();
    this.#status = { ...this.#status, lastCheckedAtMs: Date.now() };

    /* ── 1. МЭДЛЭГ — хамгийн хямд, хамгийн ойр ойр (§16) ────────── */
    /**
     * ⚠️ Session B (P0-5): суулгах нь ИДЭВХЖҮҮЛЭЛТИЙН ХӨДӨЛГҮҮРИЙН ажил
     *    (`activateKnowledge`).  Энд зөвхөн «шинэ хувилбар байна уу» гэж
     *    харьцуулна — `installed.json`-ийн knowledge хувилбартай, `state.json`-ийн
     *    хуучин `.pack` жагсаалттай БИШ.  Нэг манифестад олон багц байвал
     *    хамгийн сүүлийнх нь `knowledge` бүрэлдэхүүн (нэг sqlite = нэг багц).
     */
    const knowledge = await this.#fetchKnowledgeManifest(token);
    const pack = knowledge[knowledge.length - 1];
    if (pack && this.#d.activateKnowledge) {
      const current = await this.#d.installedKnowledgeVersion?.();
      if (current !== pack.version || force) {
        this.#status = { ...this.#status, phase: 'downloading', what: 'knowledge', percent: 0, message: 'Барилгын нормын шинэчлэл татаж байна…' };
        const r = await this.#d.activateKnowledge(pack, token);
        if (!r.ok) throw new Error(`мэдлэгийн багц ${pack.pack_id}@${pack.version}: ${r.code}`);
        this.#d.log(`мэдлэгийн багц идэвхжлээ: ${pack.pack_id}@${pack.version} (дараагийн асаалтад нээгдэнэ)`);
        if (r.restartRequired) this.#status = { ...this.#status, restartRequired: true };
      }
    }

    /* ── 2. АДАПТЕР — MGL AI 1.1 → 1.2 (§17) ───────────────────── */
    const adapters = releases
      .filter((r) => r.kind === 'adapter')
      .filter((r) => runtimeSupports(this.#d.runtimeVersion, r))
      // ⚠️ ИДЭВХТЭЙ СУУРЬ ЗАГВАРТ ЗОРИУЛАГДСАНЫГ Л.  Өөр суурьт
      //    зориулсан LoRA нь ХОГ гаргана (`activateAdapter` барина, гэхдээ
      //    5 GB-ыг дэмий татахаас өмнө энд шүүе).
      .filter((r) => r.base_release_uid === null || r.base_release_uid === state.active)
      .sort((a, b) => compareVersions(b.version, a.version));

    const newest = adapters[0];
    if (newest) {
      const current = state.adapters.find((a) => a.releaseUid === state.activeAdapter);
      const isNewer = current === undefined || compareVersions(newest.version, current.version) > 0;
      if (isNewer || force) {
        await this.#installAdapter(newest, token);
      }
    }

    /* ── 3. СУУРЬ ЗАГВАР — ХАМГИЙН ХОВОР, ХАМГИЙН ҮНЭТЭЙ ───────── */
    /**
     * ⚠️ СУУРЬ ЗАГВАРЫГ АВТОМАТААР СОЛИХГҮЙ, ЗӨВХӨН ОГТ БАЙХГҮЙ ҮЕД
     *    ТАТНА.  4-5 GB-ыг ажилтны мэдэлгүй чимээгүй татах нь §35-ийн
     *    «хэрэглэгч ажиллаж байхад их нөөц идэхгүй» шаардлагыг зөрчинө
     *    ба зарим ажилтны интернэт хэмжээтэй.  Суурь загварын
     *    шилжилтийг АДМИН зориуд эхлүүлнэ (`/update/base`).
     */
    if (state.active === null && state.installed.length === 0) {
      const bases = releases
        .filter((r) => (r.kind ?? 'base') === 'base')
        .filter((r) => runtimeSupports(this.#d.runtimeVersion, r))
        .sort((a, b) => compareVersions(b.version, a.version));
      const base = bases[0];
      if (base) await this.installBase(base, token);
    }

    this.#status = {
      ...this.#status,
      phase: 'ready',
      what: null,
      percent: null,
      message: null,
      error: null,
    };
  }

  /**
   * Суурь загварыг ТАТАЖ, идэвхжүүлнэ.  ⚠️ Анхны суулгац болон админ
   * зориуд эхлүүлсэн шилжилтэд Л дуудагдана.
   */
  async installBase(entry: ReleaseManifestEntry, token: string): Promise<void> {
    this.#status = {
      ...this.#status,
      phase: 'downloading',
      what: 'base',
      percent: 0,
      message: 'MGL AI-г бэлдэж байна…',
    };
    await this.#d.manager.install(entry, token, (pct) => {
      this.#status = { ...this.#status, percent: pct };
    });

    this.#status = { ...this.#status, phase: 'installing', message: 'MGL AI-г тохируулж байна…' };
    // ⚠️ P0-5: идэвхжүүл → smoke → буцаах семантик нь ЗӨВХӨН activation.ts-ийн `switchModel`.
    //    Анхны суулгацад буцах хувилбар БАЙХГҮЙ — `rollback` шидэлт тэнд залгигдана.
    const r = await switchModel({
      activate: () => this.#d.manager.activate(entry.release_uid),
      rollback: () => this.#d.manager.rollback(),
      reloadEngine: this.#d.reloadEngine,
      smokeTest: this.#d.smokeTest,
      log: this.#d.log,
    });
    if (!r.ok) throw new Error(`Загвар ачаалж чадсангүй: ${r.detail ?? r.code}`);
    this.#d.log(`суурь загвар идэвхжлээ: ${entry.version}`);
  }

  /**
   * Адаптерыг ТАТАЖ, ХАЖУУД суулгаж, smoke тест давбал идэвхжүүлнэ (§18).
   *
   * ⚠️ ХЭРЭГЛЭГЧ АЖИЛЛАЖ БАЙВАЛ ИДЭВХЖҮҮЛЭЛТИЙГ ХОЙШЛУУЛНА (§35).
   *    Татах нь сүлжээ/диск — тэвчигдэнэ.  Идэвхжүүлэлт нь загварыг
   *    ДАХИН АЧААЛНА: тэр агшинд хоёр хувилбар зэрэг VRAM эзэлж болох
   *    ба яг тэр нь «компьютер зогсов» гэсэн мөч.
   */
  async #installAdapter(entry: ReleaseManifestEntry, token: string): Promise<void> {
    this.#status = {
      ...this.#status,
      phase: 'downloading',
      what: 'adapter',
      percent: 0,
      message: `MGL AI ${entry.version} шинэчлэл татаж байна…`,
    };
    await this.#d.manager.installAdapter(entry, token, (pct) => {
      this.#status = { ...this.#status, percent: pct };
    });

    if (this.#d.isBusy()) {
      /**
       * ⚠️ ТАТСАН БОЛОВЧ ИДЭВХЖҮҮЛЭЭГҮЙ — тэр нь ЗӨВ завсрын төлөв.
       *    `candidateAdapter` нь диск дээр үлдэнэ; дараагийн шалгалт,
       *    эсвэл дараагийн эхлэлт түүнийг идэвхжүүлнэ.  Хэрэглэгчийн
       *    хариултыг таслах нь шинэчлэлтээс ХАМААГҮЙ чухал.
       */
      this.#status = {
        ...this.#status,
        phase: 'ready',
        percent: 100,
        message: 'MGL AI шинэчлэл бэлэн — дараагийн асуултаас эхэлнэ.',
        restartRequired: true,
      };
      this.#d.log(`адаптер ${entry.version} татагдсан, идэвхжүүлэлт хойшлов (үүсгэлт явж байна)`);
      return;
    }

    await this.applyPendingAdapter();
  }

  /**
   * НЭР ДЭВШИГЧ адаптерыг идэвхжүүлнэ — smoke тест + буцаалттай (§18).
   *
   * ⚠️ САЛГАСАН ФУНКЦ БАЙХ ШАЛТГААН: татаж авалт ба идэвхжүүлэлт нь
   *    ӨӨР ӨӨР ЦАГТ болно (дээрх «завгүй» салаа).  Мөн runtime дахин
   *    асахад л идэвхжүүлэх зам хэрэгтэй.
   */
  async applyPendingAdapter(): Promise<boolean> {
    const state = await this.#d.manager.readState();
    const uid = state.candidateAdapter;
    if (uid === null) return false;
    if (this.#d.isBusy()) return false;

    this.#status = { ...this.#status, phase: 'installing', message: 'MGL AI-г шинэчилж байна…' };
    // ⚠️ P0-5: идэвхжүүл → smoke → буцаах нь activation.ts-ийн `switchModel` — энд давхардуулахгүй.
    //    БУЦААЛТ — ажилтан ҮРГЭЛЖ ажилладаг MGL AI-тай үлдэнэ (§18).  `activateAdapter` нь суурь
    //    загварын таарлыг шалгаж шидвэл тэр нь activate шатны татгалзал — smoke биш, буцаах юмгүй.
    let r: { ok: boolean; code: string; detail?: string };
    try {
      r = await switchModel({
        activate: () => this.#d.manager.activateAdapter(uid),
        rollback: () => this.#d.manager.rollbackAdapter(),
        reloadEngine: this.#d.reloadEngine,
        smokeTest: this.#d.smokeTest,
        log: this.#d.log,
      });
    } catch (err) {
      r = { ok: false, code: 'ACTIVATE_REFUSED', detail: (err as Error).message };
    }
    if (!r.ok) {
      this.#status = {
        ...this.#status,
        phase: 'failed',
        message:
          r.code === 'ROLLBACK_FAILED'
            ? 'MGL AI шинэчлэл тохирсонгүй, өмнөх хувилбар ч ачаалагдсангүй. Засвар шаардлагатай.'
            : 'MGL AI шинэчлэл тохирсонгүй — өмнөх хувилбар үргэлжилж байна.',
        error: r.detail ?? r.code,
        restartRequired: false,
      };
      return false;
    }

    const after = await this.#d.manager.activeAdapterRow();
    this.#status = {
      ...this.#status,
      phase: 'ready',
      what: null,
      percent: null,
      // ⚠️ §20 — шинэчлэгдсэнийг НЭГ мөрөөр хэлнэ, шидтэн БАЙХГҮЙ.
      message: after ? `MGL AI ${after.version} болж шинэчлэгдлээ.` : 'MGL AI шинэчлэгдлээ.',
      error: null,
      restartRequired: false,
    };
    this.#d.log(`адаптер идэвхжлээ: ${after?.version ?? uid}`);
    return true;
  }

  /**
   * Мэдлэгийн манифест.
   *
   * ⚠️ ГАРЦ БАЙХГҮЙ БОЛ ХООСОН — АЛДАА БИШ.  Худалдан авалтын дараалал
   *    нь: runtime нь Worker-ээс ТУСДАА түгээгддэг тул шинэ runtime нь
   *    хуучин Worker-тэй ярьж болно.  404 нь «энэ Worker хараахан
   *    мэдлэгийн манифест гаргадаггүй» гэсэн үг бөгөөд тэр нь
   *    шинэчлэлтийг бүхэлд нь унагаах ЁСГҮЙ.
   */
  async #fetchKnowledgeManifest(token: string): Promise<KnowledgeManifestEntry[]> {
    try {
      const res = await fetch(`${this.#d.controlPlane}/api/mgl-ai/runtime/knowledge-manifest`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return [];
      const body = (await res.json()) as { packs?: KnowledgeManifestEntry[] };
      return Array.isArray(body.packs) ? body.packs : [];
    } catch {
      return [];
    }
  }
}
