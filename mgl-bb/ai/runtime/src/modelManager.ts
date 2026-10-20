/**
 * MGL AI · ЗАГВАРЫН МЕНЕЖЕР (§37, §38).
 *
 * ⚠️ ДУРЫН ЗАГВАР ТАТАХГҮЙ.  Манифест нь БИДНИЙ Worker-ээс ирнэ
 *    (`/api/mgl-ai/runtime/manifest`) бөгөөд тэр нь `license_cleared = 1`
 *    БА `eval_passed = 1` мөрийг Л буцаана.  HuggingFace эсвэл дурын URL
 *    руу шууд заах зам ЭНЭ ФАЙЛД БАЙХГҮЙ — тэр нь хорлогдсон артефактын
 *    хамгийн энгийн зам.
 *
 * ⚠️ SHA-256 ЗААВАЛ.  Шалгалт тохирохгүй бол файл УСТГАГДАНА, суулгагдахгүй.
 *
 * ⚠️ АЖИЛЛАЖ БУЙ ХУВИЛБАР ДЭЭР ДАРЖ БИЧИХГҮЙ (§38).  Шинэ хувилбар нь
 *    ХАЖУУД нь суудаг, smoke тест давсны ДАРАА л идэвхжинэ, хуучин нь
 *    буцаах хувилбар болж үлдэнэ.  Татаж авалт нь `.part` файл руу орж,
 *    бүрэн шалгагдсаны дараа Л нэрээ авна — тасарсан татаж авалт нь
 *    хэзээ ч бүтэн загвар мэт харагдахгүй.
 */
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, rm, rename, stat, readdir } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';

/**
 * ⚠️ ГУРВАН ТӨРЛИЙН АРТЕФАКТ, ГУРВАН ӨӨР ШИНЭЧЛЭЛТИЙН ХЭМНЭЛ (§15–§19).
 *
 *    `base`      — суурь GGUF (4-5 GB).  НЭГ УДАА татагдана.  Шинэ норм,
 *                  шинэ fine-tune нь үүнийг ДАХИН ТАТУУЛАХГҮЙ.
 *    `adapter`   — LoRA (хэдэн зуун MB).  MGL AI 1.1 → 1.2 нь ЭНЭ Л.
 *    `knowledge` — норматив багц (хэдэн MB).  Жинд ОРДОГГҮЙ (§15).
 *
 * ⚠️ ЭНЭ ЯЛГАА НЬ БҮТЭЭГДЭХҮҮНИЙ ГОЛ ШААРДЛАГА.  «Шинэ норм нэмэгдэхэд
 *    5 GB дахин татах» нь §19-ийн шууд зөрчил бөгөөд 40 ажилтны сүлжээг
 *    боомилно.
 */
export type ArtifactKind = 'base' | 'adapter' | 'knowledge';

export interface ReleaseManifestEntry {
  /**
   * ⚠️ Хуучин манифестад ЭНЭ ТАЛБАР БАЙХГҮЙ.  Байхгүй бол `base` гэж
   *    үзнэ — тэр нь 2026-09-09-ний өмнөх бүх мөрийн зөв утга.
   */
  kind?: ArtifactKind;
  /** Адаптер аль суурь загварт наалдахыг заана (`kind: 'adapter'`). */
  base_release_uid?: string | null;
  /** Энэ артефактыг ажиллуулахад шаардагдах runtime-ийн доод хувилбар. */
  minimum_runtime_version?: string | null;
  release_uid: string;
  version: string;
  runtime_variant: string;
  base_model: string;
  quantization: string | null;
  runtime: string;
  context_tokens: number;
  artifact_url: string | null;
  artifact_bytes: number | null;
  artifact_sha256: string | null;
  min_vram_mb: number | null;
  min_ram_mb: number | null;
  channel: string;
  build_commit: string | null;
}

export interface InstalledModel {
  releaseUid: string;
  version: string;
  runtimeVariant: string;
  quantization: string | null;
  contextTokens: number;
  path: string;
  bytes: number;
  sha256: string;
  installedAt: string;
}

/**
 * Суулгасан LoRA адаптер.
 *
 * ⚠️ ЗАГВАРААС ТУСДАА БҮРТГЭГДЭНЭ.  Суурь загварыг солиход адаптер
 *    ҮЛДЭХ, адаптерыг буцаахад суурь загвар ХӨДЛӨХГҮЙ байх ёстой —
 *    хоёрыг нэг жагсаалтад хийвэл §18-ийн буцаалт нь хоёуланг зэрэг
 *    буцаах ба тэр нь буруу (5 GB-ыг дэмий сольно).
 */
export interface InstalledAdapter {
  releaseUid: string;
  version: string;
  /** Аль суурь загварт зориулагдсан — үл тохирвол идэвхжүүлэхгүй. */
  baseReleaseUid: string | null;
  path: string;
  bytes: number;
  sha256: string;
  installedAt: string;
}

/** Суулгасан норматив мэдлэгийн багц (§16). */
export interface InstalledKnowledge {
  packId: string;
  version: string;
  sha256: string;
  bytes: number;
  installedAt: string;
}

export interface ManagerState {
  /** Одоо ИДЭВХТЭЙ хувилбар. */
  active: string | null;
  /** Буцаах хувилбар — идэвхжүүлэлт бүтэлгүйтвэл энд буцна. */
  previous: string | null;
  installed: InstalledModel[];
  /**
   * ⚠️ АДАПТЕРЫН ГУРВАН СУУРЬ (§18): ИДЭВХТЭЙ · НЭР ДЭВШИГЧ · ӨМНӨХ.
   *    `candidate` нь татагдсан ба шалгагдсан боловч ХАРААХАН
   *    идэвхжээгүй — smoke тест давсны дараа Л `active` болно.
   */
  adapters: InstalledAdapter[];
  activeAdapter: string | null;
  previousAdapter: string | null;
  candidateAdapter: string | null;
  knowledge: InstalledKnowledge[];
}

/** ⚠️ Файлын шалгалтыг ганц газраас — тестэд орлуулах цэг. */
function existsSyncSafe(p: string): boolean {
  try {
    return existsSync(p);
  } catch {
    return false;
  }
}

const EMPTY_STATE: ManagerState = {
  active: null,
  previous: null,
  installed: [],
  adapters: [],
  activeAdapter: null,
  previousAdapter: null,
  candidateAdapter: null,
  knowledge: [],
};

export class ModelManager {
  readonly #modelsDir: string;
  readonly #stateFile: string;
  readonly #controlPlane: string;

  constructor(opts: { modelsDir: string; stateFile: string; controlPlane: string }) {
    this.#modelsDir = opts.modelsDir;
    this.#stateFile = opts.stateFile;
    this.#controlPlane = opts.controlPlane;
  }

  async readState(): Promise<ManagerState> {
    try {
      const raw = await readFile(this.#stateFile, 'utf8');
      const parsed = JSON.parse(raw) as Partial<ManagerState>;
      return {
        active: parsed.active ?? null,
        previous: parsed.previous ?? null,
        installed: Array.isArray(parsed.installed) ? parsed.installed : [],
        // ⚠️ ХУУЧИН `state.json`-Д ЭДГЭЭР ТАЛБАР БАЙХГҮЙ.  Байхгүйг
        //    хоосон гэж уншина — шинэчлэлт нь хуучин суулгацыг
        //    ХЭЗЭЭ Ч эвдэх ёсгүй.
        adapters: Array.isArray(parsed.adapters) ? parsed.adapters : [],
        activeAdapter: parsed.activeAdapter ?? null,
        previousAdapter: parsed.previousAdapter ?? null,
        candidateAdapter: parsed.candidateAdapter ?? null,
        knowledge: Array.isArray(parsed.knowledge) ? parsed.knowledge : [],
      };
    } catch {
      // ⚠️ Эвдэрсэн/байхгүй төлөв нь ХООСОН гэж уншигдана — суулгасан
      //    загвар байвал `reconcile()` түүнийг олно.
      return { ...EMPTY_STATE };
    }
  }

  async writeState(state: ManagerState): Promise<void> {
    await mkdir(this.#modelsDir, { recursive: true });
    await writeFile(this.#stateFile, JSON.stringify(state, null, 2), 'utf8');
  }

  /**
   * Зөвшөөрөгдсөн манифестыг ТАТНА.
   *
   * ⚠️ `token` нь ажилтны ERP сессийн JWT.  Манифест нь эрхээр
   *    хамгаалагдсан — захиалагчийн Lite ба ажилтны 4B нь ӨӨР хариу.
   */
  async fetchManifest(token: string): Promise<ReleaseManifestEntry[]> {
    const res = await fetch(`${this.#controlPlane}/api/mgl-ai/runtime/manifest`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Манифест татаж чадсангүй: HTTP ${res.status}`);
    const body = (await res.json()) as { releases?: ReleaseManifestEntry[] };
    return body.releases ?? [];
  }

  /**
   * Артефакт татаж, checksum шалгаж, суулгана.
   *
   * ⚠️ ИДЭВХЖҮҮЛЭХГҮЙ — зөвхөн суулгана.  Идэвхжүүлэлт нь `activate()`,
   *    тэр нь smoke тестийн ДАРАА дуудагдана (§38).
   */
  async install(
    entry: ReleaseManifestEntry,
    token: string,
    onProgress?: (pct: number, bytes: number) => void,
  ): Promise<InstalledModel> {
    if (!entry.artifact_url) throw new Error(`${entry.version}: артефактын хаяг байхгүй.`);
    if (!entry.artifact_sha256) {
      // ⚠️ Checksum-гүй артефакт нь ХОРЛОГДСОН гэж үзэгдэнэ.  «Дараа
      //    нэмнэ» гэсэн зөөлрүүлэлт нь §48-ийн «malicious model artifact»
      //    хамгаалалтыг бүрэн устгана.
      throw new Error(`${entry.version}: SHA-256 байхгүй — суулгахаас татгалзав.`);
    }

    await mkdir(this.#modelsDir, { recursive: true });
    const finalPath = join(this.#modelsDir, `${entry.release_uid}.gguf`);
    const partPath = `${finalPath}.part`;

    const res = await fetch(entry.artifact_url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok || !res.body) throw new Error(`Татаж чадсангүй: HTTP ${res.status}`);

    const total = entry.artifact_bytes ?? Number(res.headers.get('content-length') ?? 0);
    const hash = createHash('sha256');
    let received = 0;

    // ⚠️ ХЭШИЙГ PIPELINE ДОТОР бодно, `source.on('data')`-аар БИШ.
    //    `'data'` сонсогч нь урсгалыг ТЭР ДАРУЙ flowing горимд оруулдаг тул
    //    `pipeline` бичигчээ холбохоос ӨМНӨ эхний хэсгүүд алдагдана:
    //    хэш нь ЗӨВ гарч, файл нь ХООСОН үлдэнэ — өөрөөр хэлбэл
    //    checksum давсан эвдэрсэн загвар.  Transform нь backpressure-ыг ч
    //    хүндэтгэнэ.  (`modelManager.test.ts` барьсан бодит алдаа.)
    const tap = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        hash.update(chunk);
        received += chunk.length;
        if (total > 0) onProgress?.(Math.round((received / total) * 100), received);
        cb(null, chunk);
      },
    });

    await rm(partPath, { force: true });
    const source = Readable.fromWeb(res.body as never);
    await pipeline(source, tap, createWriteStream(partPath));

    const digest = hash.digest('hex');
    if (digest.toLowerCase() !== entry.artifact_sha256.toLowerCase()) {
      await rm(partPath, { force: true });
      throw new Error(
        `SHA-256 тохирохгүй.  Хүлээсэн ${entry.artifact_sha256}, гарсан ${digest}.  Файл устгагдав.`,
      );
    }

    // ⚠️ Зөвхөн ЭНД нэрээ авна — тасарсан татаж авалт хэзээ ч бүтэн
    //    загвар мэт харагдахгүй.
    await rename(partPath, finalPath);
    const st = await stat(finalPath);

    const installed: InstalledModel = {
      releaseUid: entry.release_uid,
      version: entry.version,
      runtimeVariant: entry.runtime_variant,
      quantization: entry.quantization,
      contextTokens: entry.context_tokens,
      path: finalPath,
      bytes: st.size,
      sha256: digest,
      installedAt: new Date().toISOString(),
    };

    const state = await this.readState();
    state.installed = [...state.installed.filter((m) => m.releaseUid !== entry.release_uid), installed];
    await this.writeState(state);
    return installed;
  }

  /* ================================================================ */
  /*  АДАПТЕР (§17, §18, §19)                                          */
  /* ================================================================ */

  /**
   * ⚠️ ТАТААД ШАЛГАНА — ИДЭВХЖҮҮЛЭХГҮЙ.  Идэвхжүүлэлт нь `activateAdapter`,
   *    тэр нь ЗӨВХӨН smoke тест давсны дараа дуудагдана (§18).
   *
   * ⚠️ SHA-256 ЗААВАЛ, суурь загвартай АДИЛХАН хатуу.  Адаптер нь
   *    загварын зан төлөвийг ӨӨРЧИЛДӨГ тул хорлогдсон адаптер нь
   *    хорлогдсон загвартай ижил эрсдэлтэй.
   *
   * ⚠️ `models/`-Д ШУУД ХАДГАЛАХГҮЙ.  `discoverLocalModel()` нь тэндээс
   *    хамгийн том `.gguf`-ыг СУУРЬ ЗАГВАР гэж авдаг — адаптерыг тэнд
   *    тавибал нэг өдөр адаптерыг суурь загвар гэж ачаалахыг оролдоно.
   *    Тиймээс ТУСДАА `adapters/` дэд хавтас.
   */
  async installAdapter(
    entry: ReleaseManifestEntry,
    token: string,
    onProgress?: (pct: number, bytes: number) => void,
  ): Promise<InstalledAdapter> {
    if (!entry.artifact_url) throw new Error(`${entry.version}: адаптерын хаяг байхгүй.`);
    if (!entry.artifact_sha256) {
      throw new Error(`${entry.version}: адаптерын SHA-256 байхгүй — суулгахаас татгалзав.`);
    }

    const dir = join(this.#modelsDir, 'adapters');
    await mkdir(dir, { recursive: true });
    const finalPath = join(dir, `${entry.release_uid}.adapter.gguf`);

    const { bytes, digest } = await this.#downloadVerified({
      url: entry.artifact_url,
      token,
      destPath: finalPath,
      expectedSha256: entry.artifact_sha256,
      expectedBytes: entry.artifact_bytes,
      onProgress,
    });

    const installed: InstalledAdapter = {
      releaseUid: entry.release_uid,
      version: entry.version,
      baseReleaseUid: entry.base_release_uid ?? null,
      path: finalPath,
      bytes,
      sha256: digest,
      installedAt: new Date().toISOString(),
    };

    const state = await this.readState();
    state.adapters = [
      ...state.adapters.filter((a) => a.releaseUid !== entry.release_uid),
      installed,
    ];
    // ⚠️ НЭР ДЭВШИГЧ гэж тэмдэглэнэ, ИДЭВХТЭЙ гэж БИШ.  Хооронд нь
    //    ялгах нь §18-ийн бүх утга учир: smoke тест унавал бид юу руу
    //    буцахаа мэдэж байх ёстой.
    state.candidateAdapter = entry.release_uid;
    await this.writeState(state);
    return installed;
  }

  /**
   * Адаптерыг идэвхжүүлнэ.  ⚠️ Хуучин нь `previousAdapter` болж ҮЛДЭНЭ.
   *
   * ⚠️ СУУРЬ ЗАГВАРЫН ТААРАЛТЫГ ШАЛГАНА.  Өөр суурь загварт зориулсан
   *    LoRA-г ачаалах нь llama.cpp дээр эсвэл унана, эсвэл ХАМААГҮЙ ХОГ
   *    гаргана — сүүлийнх нь илүү аюултай, учир нь ажиллаж байгаа мэт
   *    харагдана.
   */
  async activateAdapter(releaseUid: string | null): Promise<ManagerState> {
    const state = await this.readState();
    if (releaseUid !== null) {
      const a = state.adapters.find((x) => x.releaseUid === releaseUid);
      if (!a) throw new Error(`${releaseUid} адаптер суулгагдаагүй байна.`);
      if (a.baseReleaseUid !== null && state.active !== null && a.baseReleaseUid !== state.active) {
        throw new Error(
          `Адаптер ${a.version} нь ${a.baseReleaseUid} суурь загварт зориулагдсан, ` +
            `идэвхтэй нь ${state.active}.  Идэвхжүүлэхээс татгалзав.`,
        );
      }
    }
    if (state.activeAdapter !== releaseUid) {
      state.previousAdapter = state.activeAdapter;
      state.activeAdapter = releaseUid;
    }
    state.candidateAdapter = null;
    await this.writeState(state);
    return state;
  }

  /** Адаптерын буцаалт — суурь загварыг ХӨНДӨХГҮЙ (§18). */
  async rollbackAdapter(): Promise<ManagerState> {
    const state = await this.readState();
    const target = state.previousAdapter;
    state.previousAdapter = state.activeAdapter;
    state.activeAdapter = target;
    state.candidateAdapter = null;
    await this.writeState(state);
    return state;
  }

  async activeAdapterRow(): Promise<InstalledAdapter | null> {
    const state = await this.readState();
    if (state.activeAdapter === null) return null;
    return state.adapters.find((a) => a.releaseUid === state.activeAdapter) ?? null;
  }

  /* ================================================================ */
  /*  ТАТАЖ АВАЛТЫН ЦӨМ                                                */
  /* ================================================================ */

  /**
   * ⚠️ НЭГ ХЭРЭГЖҮҮЛЭЛТ, ГУРВАН ХЭРЭГЛЭГЧ (суурь · адаптер · мэдлэг).
   *
   *    Хэшийг PIPELINE ДОТОР бодно, `source.on('data')`-аар БИШ.
   *    `'data'` сонсогч нь урсгалыг ТЭР ДАРУЙ flowing горимд оруулдаг
   *    тул `pipeline` бичигчээ холбохоос ӨМНӨ эхний хэсгүүд алдагдана:
   *    хэш нь ЗӨВ гарч, файл нь ХООСОН үлдэнэ — өөрөөр хэлбэл checksum
   *    давсан эвдэрсэн артефакт.  (`modelManager.test.ts` барьсан
   *    бодит алдаа.)
   *
   * ⚠️ `.part` → шалгалт → `rename`.  Тасарсан татаж авалт нь ХЭЗЭЭ Ч
   *    бүтэн артефакт мэт харагдахгүй (§18).
   */
  async #downloadVerified(opts: {
    url: string;
    token: string;
    destPath: string;
    expectedSha256: string;
    expectedBytes: number | null;
    onProgress?: (pct: number, bytes: number) => void;
    signal?: AbortSignal;
  }): Promise<{ bytes: number; digest: string }> {
    const partPath = `${opts.destPath}.part`;
    const res = await fetch(opts.url, {
      headers: { Authorization: `Bearer ${opts.token}` },
      signal: opts.signal,
    });
    if (!res.ok || !res.body) throw new Error(`Татаж чадсангүй: HTTP ${res.status}`);

    const total = opts.expectedBytes ?? Number(res.headers.get('content-length') ?? 0);
    const hash = createHash('sha256');
    let received = 0;

    const tap = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        hash.update(chunk);
        received += chunk.length;
        if (total > 0) opts.onProgress?.(Math.round((received / total) * 100), received);
        cb(null, chunk);
      },
    });

    await rm(partPath, { force: true });
    const source = Readable.fromWeb(res.body as never);
    await pipeline(source, tap, createWriteStream(partPath));

    const digest = hash.digest('hex');
    if (digest.toLowerCase() !== opts.expectedSha256.toLowerCase()) {
      await rm(partPath, { force: true });
      throw new Error(
        `SHA-256 тохирохгүй.  Хүлээсэн ${opts.expectedSha256}, гарсан ${digest}.  Файл устгагдав.`,
      );
    }

    await rename(partPath, opts.destPath);
    const st = await stat(opts.destPath);
    return { bytes: st.size, digest };
  }

  /* ================================================================ */
  /*  НОРМАТИВ МЭДЛЭГ (§16)                                            */
  /* ================================================================ */

  /**
   * Мэдлэгийн багцыг ТАТАЖ, шалгаж, зааж өгсөн зам руу тавина.
   *
   * ⚠️ ЭНЭ НЬ ШИНГЭЭХГҮЙ.  SQLite рүү оруулах нь `ai/retrieval`-ийн
   *    ажил; энэ нь зөвхөн ФАЙЛЫГ найдвартай хүргэнэ.  Хоёрыг холих нь
   *    менежерийг мэдлэгийн схемээс хамааралтай болгоно.
   *
   * ⚠️ ХУВИЛБАРЫГ ХАРЬЦУУЛЖ АЛГАСНА.  Ижил хувилбар аль хэдийн байвал
   *    ЮУ Ч ТАТАХГҮЙ — §19-ийн «шаардлагагүй юмыг дахин татахгүй».
   */
  async installKnowledgePack(
    pack: { pack_id: string; version: string; url: string; sha256: string; bytes: number | null },
    token: string,
    destDir: string,
    onProgress?: (pct: number, bytes: number) => void,
  ): Promise<{ installed: InstalledKnowledge; path: string; skipped: boolean }> {
    const state = await this.readState();
    const existing = state.knowledge.find((k) => k.packId === pack.pack_id);
    const path = join(destDir, `${pack.pack_id}.pack`);
    if (existing && existing.version === pack.version && existsSyncSafe(path)) {
      return { installed: existing, path, skipped: true };
    }

    await mkdir(destDir, { recursive: true });
    const { bytes, digest } = await this.#downloadVerified({
      url: pack.url,
      token,
      destPath: path,
      expectedSha256: pack.sha256,
      expectedBytes: pack.bytes,
      onProgress,
    });

    const installed: InstalledKnowledge = {
      packId: pack.pack_id,
      version: pack.version,
      sha256: digest,
      bytes,
      installedAt: new Date().toISOString(),
    };
    const next = await this.readState();
    next.knowledge = [...next.knowledge.filter((k) => k.packId !== pack.pack_id), installed];
    await this.writeState(next);
    return { installed, path, skipped: false };
  }

  /**
   * Хувилбарыг идэвхжүүлнэ.  ⚠️ Хуучин нь `previous` болж ҮЛДЭНЭ —
   * §38-ийн «retains rollback copy temporarily».
   */
  async activate(releaseUid: string): Promise<ManagerState> {
    const state = await this.readState();
    if (!state.installed.some((m) => m.releaseUid === releaseUid)) {
      throw new Error(`${releaseUid} суулгагдаагүй байна.`);
    }
    if (state.active !== releaseUid) {
      state.previous = state.active;
      state.active = releaseUid;
    }
    await this.writeState(state);
    return state;
  }

  /** Идэвхжүүлэлт бүтэлгүйтвэл өмнөх рүү буцна. */
  async rollback(): Promise<ManagerState> {
    const state = await this.readState();
    if (state.previous === null) throw new Error('Буцах хувилбар байхгүй.');
    const target = state.previous;
    state.previous = state.active;
    state.active = target;
    await this.writeState(state);
    return state;
  }

  async activeModel(): Promise<InstalledModel | null> {
    const state = await this.readState();
    if (state.active === null) return null;
    return state.installed.find((m) => m.releaseUid === state.active) ?? null;
  }

  /**
   * `models/` дотор БҮРТГЭГДЭЭГҮЙ GGUF файл байвал олно.
   *
   * ⚠️ ЯАГААД ЭНЭ ХЭРЭГТЭЙ ВЭ.  Релизийн бүртгэл (`ai_model_releases`)
   *    хоосон байхад ажилтан гараар GGUF тавьсан ч runtime нь «загвар
   *    суулгаагүй» гэж хэлээд Echo руу унадаг байсан.  Тэр нь техникийн
   *    хувьд «зөв» ч практикт бүтээгдэхүүн АЖИЛЛАХГҮЙ гэсэн үг —
   *    хэрэглэгч 2.3 GB татаж тавьчихаад юу ч болохгүй байхыг харна
   *    (2026-09-08-нд яг ийм байдалд орсон).
   *
   * ⚠️ ЛИЦЕНЗИЙН ХААЛГАТАЙ ЗӨРЧИЛДӨХГҮЙ.  Хаалга нь БИДНИЙ МАНИФЕСТЭЭР
   *    ТҮГЭЭХИЙГ хаадаг.  Хэрэглэгч өөрийн машин дээр өөрөө тавьсан
   *    файлыг унших нь түгээлт БИШ — гэхдээ `dev-local` гэж ТЭМДЭГЛЭГДЭЖ,
   *    `/info`-д ил гарна, релизийн бүртгэлд ОРОХГҮЙ.
   *
   * ⚠️ ХАМГИЙН ТОМ файлыг сонгоно: хэсэгчлэн татсан `.part` үлдэгдэл
   *    эсвэл жижиг туршилтын загвараас бодит загварыг ялгах энгийн дүрэм.
   *    `.part` өргөтгөлтэйг ОГТ авахгүй — тэр нь дуусаагүй татаж авалт.
   */
  async discoverLocalModel(): Promise<{ path: string; name: string; bytes: number } | null> {
    let names: string[];
    try {
      names = await readdir(this.#modelsDir);
    } catch {
      return null; // хавтас байхгүй — алдаа биш
    }

    const found: { path: string; name: string; bytes: number }[] = [];
    for (const name of names) {
      if (!name.toLowerCase().endsWith('.gguf')) continue;
      const full = join(this.#modelsDir, name);
      try {
        const st = await stat(full);
        // ⚠️ 100 MB-аас жижиг «GGUF» нь бүтэн загвар байх боломжгүй.
        if (st.isFile() && st.size > 100 * 1024 * 1024) {
          found.push({ path: full, name, bytes: st.size });
        }
      } catch {
        // унших боломжгүй — алгасна
      }
    }
    if (found.length === 0) return null;
    found.sort((a, b) => b.bytes - a.bytes);
    return found[0]!;
  }

  /**
   * Дискэн дээрх бодит байдалтай төлвийг тааруулна.
   *
   * ⚠️ Гараар устгасан файл, эсвэл эвдэрсэн `state.json` нь MGL AI-г
   *    бүхэлд нь унагаах ЁСГҮЙ.  Байхгүй файл нь жагсаалтаас хасагдана.
   */
  async reconcile(): Promise<ManagerState> {
    const state = await this.readState();
    const alive: InstalledModel[] = [];
    for (const m of state.installed) {
      try {
        await stat(m.path);
        alive.push(m);
      } catch {
        // файл алга — чимээгүй хасна
      }
    }
    state.installed = alive;
    if (state.active !== null && !alive.some((m) => m.releaseUid === state.active)) {
      state.active = null;
    }
    if (state.previous !== null && !alive.some((m) => m.releaseUid === state.previous)) {
      state.previous = null;
    }
    await this.writeState(state);
    return state;
  }

  /**
   * Хуучин хувилбаруудыг цэвэрлэнэ.  ⚠️ ИДЭВХТЭЙ ба БУЦААХ хувилбарыг
   * ХЭЗЭЭ Ч устгахгүй.
   */
  async prune(keep = 2): Promise<string[]> {
    const state = await this.reconcile();
    const protectedUids = new Set([state.active, state.previous].filter(Boolean) as string[]);
    const sorted = [...state.installed].sort((a, b) => b.installedAt.localeCompare(a.installedAt));

    const removed: string[] = [];
    for (const [i, m] of sorted.entries()) {
      if (protectedUids.has(m.releaseUid)) continue;
      if (i < keep) continue;
      await rm(m.path, { force: true });
      removed.push(m.releaseUid);
    }
    if (removed.length > 0) {
      state.installed = state.installed.filter((m) => !removed.includes(m.releaseUid));
      await this.writeState(state);
    }
    return removed;
  }

  /** Дискэн дээрх .gguf файлуудын нийт хэмжээ. */
  async diskUsageBytes(): Promise<number> {
    try {
      const files = await readdir(this.#modelsDir);
      let total = 0;
      for (const f of files) {
        if (!f.endsWith('.gguf')) continue;
        const st = await stat(join(this.#modelsDir, f));
        total += st.size;
      }
      return total;
    } catch {
      return 0;
    }
  }
}
