/**
 * MGL AI · СУУЛГАСАН ТӨЛӨВИЙН БҮРТГЭЛ (Session B §5, §14, §16).
 *
 *   state/installed.json
 *   {
 *     schema: 'mgl-ai-installed/1',
 *     installationId: 'ins_…',          ← санамсаргүй UUID, ТӨХӨӨРӨМЖИЙН ХУРУУНЫ ХЭЭ БИШ
 *     channel: 'stable',
 *     components: { runtime: {version, sha256, path, installedAt, releaseId}, … },
 *     previous:   { runtime: {…} },      ← буцаах хувилбар, бүрэлдэхүүн тус бүр
 *     currentRelease / previousRelease / lastKnownGoodRelease
 *   }
 *
 * ⚠️ `installationId` НЬ ХАРДВЕРЭЭС ГАРДАГГҮЙ (§16).  MAC, диск ID,
 *    Windows SID — юу ч биш; `crypto.randomUUID()`.  Дахин суулгахад
 *    шинэ ID үүснэ, тэр нь зөв: «нэг PC = мөнхийн мөрдөлт» гэсэн загвар
 *    нь энэ бүтээгдэхүүнд хэрэггүй бөгөөд хувийн нууцын хувьд буруу.
 *
 * ⚠️ `lastKnownGoodRelease` НЬ ЗӨВХӨН HEALTH READY-ИЙН ДАРАА БИЧИГДЭНЭ.
 *    Идэвхжүүлээд шууд «сайн» гэж тэмдэглэвэл буцаах газаргүй болно.
 *
 * ⚠️ `model` БҮРЭЛДЭХҮҮН НЬ ТУСГАЛ.  Эх сурвалж нь `models/state.json`
 *    (`modelManager.ts`).  `mirrorModel()` тэндээс хуулж авна; энэ файлаас
 *    загварын active-ийг ХЭЗЭЭ Ч шийдэхгүй.
 */
import { randomUUID } from 'node:crypto';

import { readJson, writeJsonAtomic } from './integrity.ts';
import { isChannel, type Channel, type ComponentId, COMPONENT_IDS } from './manifest.ts';

export const INSTALLED_SCHEMA = 'mgl-ai-installed/1' as const;

export interface InstalledComponent {
  version: string;
  sha256: string;
  /** Идэвхтэй хувилбарын зам (хавтас эсвэл файл).  Тусгал бүрэлдэхүүнд `null`. */
  path: string | null;
  installedAt: string;
  /** Аль манифестаас ирсэн.  Гараар тавьсан бол `null`. */
  releaseId: string | null;
  id?: string;
}

export interface InstalledState {
  schema: typeof INSTALLED_SCHEMA;
  installationId: string;
  channel: Channel;
  components: Partial<Record<ComponentId, InstalledComponent>>;
  previous: Partial<Record<ComponentId, InstalledComponent>>;
  currentRelease: string | null;
  previousRelease: string | null;
  lastKnownGoodRelease: string | null;
  createdAt: string;
  updatedAt: string;
}

export function emptyState(now = new Date().toISOString()): InstalledState {
  return {
    schema: INSTALLED_SCHEMA,
    installationId: `ins_${randomUUID()}`,
    channel: 'stable',
    components: {},
    previous: {},
    currentRelease: null,
    previousRelease: null,
    lastKnownGoodRelease: null,
    createdAt: now,
    updatedAt: now,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function sanitizeComponents(raw: unknown): Partial<Record<ComponentId, InstalledComponent>> {
  const out: Partial<Record<ComponentId, InstalledComponent>> = {};
  if (!isRecord(raw)) return out;
  for (const id of COMPONENT_IDS) {
    const c = raw[id];
    if (!isRecord(c) || typeof c.version !== 'string' || typeof c.sha256 !== 'string') continue;
    out[id] = {
      version: c.version,
      sha256: c.sha256,
      path: typeof c.path === 'string' ? c.path : null,
      installedAt: typeof c.installedAt === 'string' ? c.installedAt : '',
      releaseId: typeof c.releaseId === 'string' ? c.releaseId : null,
      ...(typeof c.id === 'string' ? { id: c.id } : {}),
    };
  }
  return out;
}

/**
 * Эвдэрсэн/байхгүй файл → ХООСОН төлөв (алдаа биш).  Хагас талбартай
 * файл → байгаа талбарууд + өгөгдмөл.  ⚠️ `installationId` алга бол
 * ШИНЭЭР үүсгэнэ, гэхдээ бусад талбарыг хаяхгүй.
 */
export function parseInstalledState(raw: unknown, now = new Date().toISOString()): InstalledState {
  const base = emptyState(now);
  if (!isRecord(raw)) return base;
  return {
    schema: INSTALLED_SCHEMA,
    installationId:
      typeof raw.installationId === 'string' && raw.installationId.length >= 8
        ? raw.installationId
        : base.installationId,
    channel: isChannel(raw.channel) ? raw.channel : 'stable',
    components: sanitizeComponents(raw.components),
    previous: sanitizeComponents(raw.previous),
    currentRelease: typeof raw.currentRelease === 'string' ? raw.currentRelease : null,
    previousRelease: typeof raw.previousRelease === 'string' ? raw.previousRelease : null,
    lastKnownGoodRelease: typeof raw.lastKnownGoodRelease === 'string' ? raw.lastKnownGoodRelease : null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
  };
}

/** Бүрэлдэхүүн тус бүрийн одоогийн хувилбар — `checkCompatibility`-ийн оролт. */
export function versionsOf(state: InstalledState): Partial<Record<ComponentId, string>> {
  const out: Partial<Record<ComponentId, string>> = {};
  for (const [k, v] of Object.entries(state.components) as [ComponentId, InstalledComponent][]) {
    out[k] = v.version;
  }
  return out;
}

export class InstalledStateStore {
  readonly #file: string;
  #cache: InstalledState | null = null;

  constructor(file: string) {
    this.#file = file;
  }

  async read(): Promise<InstalledState> {
    if (this.#cache) return this.#cache;
    const raw = await readJson<unknown>(this.#file);
    const state = parseInstalledState(raw);
    // Анх удаа: ID үүссэн бол шууд хадгална — дараагийн уншилт ижил ID өгөх ёстой.
    if (raw === null || !isRecord(raw) || typeof raw.installationId !== 'string') {
      await writeJsonAtomic(this.#file, state);
    }
    this.#cache = state;
    return state;
  }

  async write(state: InstalledState): Promise<InstalledState> {
    const next = { ...state, updatedAt: new Date().toISOString() };
    await writeJsonAtomic(this.#file, next);
    this.#cache = next;
    return next;
  }

  async update(fn: (s: InstalledState) => InstalledState | void): Promise<InstalledState> {
    const cur = await this.read();
    const draft: InstalledState = {
      ...cur,
      components: { ...cur.components },
      previous: { ...cur.previous },
    };
    const res = fn(draft);
    return this.write(res ?? draft);
  }

  /**
   * Бүрэлдэхүүн идэвхжсэнийг бүртгэнэ: хуучин нь `previous` руу.
   * ⚠️ `lastKnownGoodRelease`-ийг ХӨНДӨХГҮЙ — тэр нь health-ийн ажил.
   */
  async recordActivation(
    component: ComponentId,
    next: InstalledComponent,
    releaseId: string | null,
  ): Promise<InstalledState> {
    return this.update((s) => {
      const old = s.components[component];
      if (old && old.version !== next.version) s.previous[component] = old;
      s.components[component] = next;
      if (releaseId !== null && s.currentRelease !== releaseId) {
        s.previousRelease = s.currentRelease;
        s.currentRelease = releaseId;
      }
    });
  }

  /**
   * Буцаалт: `previous` → `components`.
   *   • өмнөх байвал → түүнийг сэргээж буцаана
   *   • өмнөх байхгүй, одоогийнх байвал (АНХНЫ суулгац унав) → бүрэлдэхүүнийг
   *     «суулгаагүй» болгож `removed` — заагчгүй үлдэх нь зөв, учир нь
   *     health даваагүй хувилбар «идэвхтэй» гэж бүртгэгдэх ёсгүй
   *   • аль нь ч байхгүй → `null`
   */
  async recordRollback(component: ComponentId): Promise<InstalledComponent | 'removed' | null> {
    let result: InstalledComponent | 'removed' | null = null;
    await this.update((s) => {
      const prev = s.previous[component];
      const cur = s.components[component];
      if (prev) {
        s.components[component] = prev;
        if (cur) s.previous[component] = cur;
        else delete s.previous[component];
        result = prev;
      } else if (cur) {
        delete s.components[component];
        result = 'removed';
      }
    });
    return result;
  }

  async markHealthy(releaseId: string | null): Promise<void> {
    if (releaseId === null) return;
    await this.update((s) => {
      s.lastKnownGoodRelease = releaseId;
    });
  }

  async setChannel(channel: Channel): Promise<void> {
    await this.update((s) => {
      s.channel = channel;
    });
  }

  /**
   * `models/state.json` (modelManager) → `installed.components.model` тусгал.
   * Эх сурвалж тэнд; энд зөвхөн хувилбар/хэш харагдана.
   */
  async mirrorModel(
    active: { version: string; sha256: string; path: string; releaseUid: string } | null,
    adapter: { version: string; sha256: string } | null,
  ): Promise<void> {
    await this.update((s) => {
      if (active === null) {
        delete s.components.model;
        return;
      }
      s.components.model = {
        id: active.releaseUid,
        version: adapter ? `${active.version}+${adapter.version}` : active.version,
        sha256: adapter ? adapter.sha256 : active.sha256,
        path: active.path,
        installedAt: s.components.model?.installedAt ?? new Date().toISOString(),
        releaseId: s.components.model?.releaseId ?? null,
      };
    });
  }
}
