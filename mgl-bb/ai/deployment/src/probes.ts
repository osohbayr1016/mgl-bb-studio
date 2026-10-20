/**
 * MGL AI · БОДИТ HEALTH ШАЛГАЛТУУД (Session B §11) — `health.ts`-ийн
 * `HealthProbes`-ийн файлын систем + HTTP хэрэгжүүлэлт.
 *
 * ⚠️ RUNTIME-ИЙН ДОТООД МОДУЛИЙГ ИМПОРТЛОХГҮЙ.  Бүх шалгалт нь runtime-ийн
 *    НИЙТИЙН гарцаар (`/health`, `/info`, `/generate`) явна — тиймээс
 *    процесс дотроос ч (server.ts-ийн hook), гаднаас ч (`bin/health.ts`,
 *    суулгагчийн эхний ажиллуулалт) ИЖИЛ шалгалт ажиллана.
 *
 * ⚠️ ЗАГВАРЫН SHA-г БҮРЭН ФАЙЛ ДЭЭР БОДНО — 5 GB, ~10-20 с (SSD).  Тиймээс
 *    `shaCacheFile`: `{path, size, mtimeMs, sha256}` таарвал дахин бодохгүй.
 *    Эхний ажиллуулалт ба шинэчлэлтийн дараа Л бүтэн бодно.
 *
 * ⚠️ ҮҮСГЭЛТИЙН SMOKE НЬ ЗАГВАРЫГ АЧААЛНА (VRAM).  `light` горимд health.ts
 *    түүнийг алгасдаг; энд `generationSmoke` нь 8 токен, 60 с timeout.
 */
import { open, stat } from 'node:fs/promises';

import type { CheckOutcome, HealthProbes } from './health.ts';
import { sha256File, readJson, writeJsonAtomic } from './integrity.ts';
import type { InstallLayout } from './layout.ts';
import { readPointer } from './activation.ts';

export interface RuntimeInfoLite {
  runtime_version?: string;
  engine_reason?: string;
  deployment?: { running?: Record<string, string>; versions?: Record<string, string> } | null;
  active_model?: { path: string; sha256: string; version: string } | null;
  engine?: { loaded?: boolean; kind?: string };
  engine_health?: { ok?: boolean };
  knowledge_installed?: boolean;
}

export interface ProbeDeps {
  layout: InstallLayout;
  /** `http://127.0.0.1:39217` */
  runtimeUrl: string;
  /** `x-mglai-secret` — суулгацын нууц (secret.txt).  Гаднаас ажиллахад хэрэгтэй. */
  runtimeHeaders: Record<string, string>;
  /** ERP Worker — `/api/mgl-ai/health` (нэвтрэлт шаардана → 401 ч «хүрсэн»). */
  controlPlane: string;
  /** Revit гүүрийн локал порт, байхгүй бол null. */
  revitBridgeUrl: string | null;
  fetchImpl?: typeof fetch;
  /** SHA кэш — `state/model-sha.json`. */
  shaCacheFile: string;
  /** Хүлээгдэж буй загварын SHA (installed.json-оос).  `null` = шалгахгүй, зөвхөн байгаа эсэх. */
  expectedModelSha256: string | null;
  knowledgeDbPath: string | null;
  /** ХҮССЭН хувилбарууд (installed.json / заагч) — `versionsMatch`-д `/info.deployment.running`-тэй тулгана. */
  desiredVersions?: Partial<Record<string, string>>;
  /**
   * Ажиллаж буй runtime-ийн өөрийн entry (process.argv[1]) — заагчгүй суулгац
   * (bootstrap-ийн шууд `app/`, эсвэл dev repo) дээр «файл байна» гэдгийг энэ замаар шалгана.
   */
  runtimeEntryHint?: string | null;
}

async function fetchJson<T>(f: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<{ status: number; body: T | null }> {
  try {
    const res = await f(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const body = (await res.json().catch(() => null)) as T | null;
    return { status: res.status, body };
  } catch {
    return { status: 0, body: null };
  }
}

/** SQLite толгой — «SQLite format 3\0» (16 байт). */
async function isSqliteFile(path: string): Promise<boolean> {
  try {
    const fh = await open(path, 'r');
    try {
      const buf = Buffer.alloc(16);
      const { bytesRead } = await fh.read(buf, 0, 16, 0);
      return bytesRead === 16 && buf.toString('utf8', 0, 15) === 'SQLite format 3';
    } finally {
      await fh.close();
    }
  } catch {
    return false;
  }
}

function engineName(body: RuntimeInfoLite | null): string | null {
  const e = body?.engine as { engine?: string; kind?: string } | undefined;
  return e?.engine ?? e?.kind ?? null;
}
/** `MGLAI_ENGINE=echo` гэж ГАРААР тавьсан echo — runtime-ийн `engine_reason` тэгж хэлдэг. */
function isExplicitEcho(body: RuntimeInfoLite | null): boolean {
  return engineName(body) === 'echo' && /MGLAI_ENGINE=echo/.test(body?.engine_reason ?? '');
}

export function createProbes(deps: ProbeDeps): HealthProbes {
  const f = deps.fetchImpl ?? fetch;
  const info = () => fetchJson<RuntimeInfoLite>(f, `${deps.runtimeUrl}/info`, { headers: deps.runtimeHeaders }, 8000);

  return {
    async filesValid(): Promise<CheckOutcome> {
      // runtime-ийн код: заагч байвал түүний зам, байхгүй бол bootstrap-ийн шууд AppDir (хуучин суулгац).
      const p = await readPointer(deps.layout, 'runtime');
      const candidates = p
        ? [`${p.path}/runtime/src/server.ts`]
        : [deps.runtimeEntryHint, `${deps.layout.app}/runtime/src/server.ts`].filter((x): x is string => typeof x === 'string' && x.length > 0);
      for (const entry of candidates) {
        try {
          await stat(entry);
          return { ok: true, code: p ? 'RUNTIME_FILES_OK' : 'RUNTIME_FILES_LEGACY_LAYOUT' };
        } catch {
          /* дараагийнх */
        }
      }
      return { ok: false, code: 'RUNTIME_ENTRY_MISSING', detail: candidates.join(' | ') };
    },

    async modelExists(): Promise<CheckOutcome> {
      const { body } = await info();
      // Echo хөдөлгүүрийг ЗОРИУД тавьсан (MGLAI_ENGINE=echo — fixture/acceptance) бол загваргүй нь
      // алдаа биш, гэхдээ READY ч биш: skipped → LOCAL_AI DEGRADED.
      if (isExplicitEcho(body)) return { ok: true, code: 'ENGINE_ECHO_FIXTURE', skipped: true };
      const m = body?.active_model ?? null;
      if (!m) return { ok: false, code: 'MODEL_MISSING' };
      try {
        const st = await stat(m.path);
        return st.size > 100 * 1024 * 1024 ? { ok: true, code: 'MODEL_PRESENT' } : { ok: false, code: 'MODEL_TOO_SMALL' };
      } catch {
        return { ok: false, code: 'MODEL_FILE_MISSING', detail: m.path };
      }
    },

    async modelShaMatches(): Promise<CheckOutcome> {
      const { body } = await info();
      if (isExplicitEcho(body)) return { ok: true, code: 'ENGINE_ECHO_FIXTURE', skipped: true };
      const m = body?.active_model ?? null;
      if (!m) return { ok: false, code: 'MODEL_MISSING' };
      const expected = (deps.expectedModelSha256 ?? m.sha256 ?? '').toLowerCase();
      if (!expected) return { ok: true, code: 'MODEL_SHA_UNKNOWN', skipped: true };
      let st;
      try {
        st = await stat(m.path);
      } catch {
        return { ok: false, code: 'MODEL_FILE_MISSING' };
      }
      const cache = await readJson<{ path: string; size: number; mtimeMs: number; sha256: string }>(deps.shaCacheFile);
      let actual: string;
      if (cache && cache.path === m.path && cache.size === st.size && cache.mtimeMs === st.mtimeMs) {
        actual = cache.sha256;
      } else {
        actual = await sha256File(m.path);
        await writeJsonAtomic(deps.shaCacheFile, { path: m.path, size: st.size, mtimeMs: st.mtimeMs, sha256: actual });
      }
      return actual === expected ? { ok: true, code: 'MODEL_SHA_OK' } : { ok: false, code: 'MODEL_SHA_MISMATCH' };
    },

    async runtimeStarts(): Promise<CheckOutcome> {
      const { status, body } = await fetchJson<{ ok?: boolean; service?: string }>(f, `${deps.runtimeUrl}/health`, {}, 3000);
      if (status === 0) return { ok: false, code: 'RUNTIME_NOT_RUNNING' };
      if (body?.service !== 'mgl-ai-runtime') return { ok: false, code: 'PORT_CONFLICT' };
      return { ok: true, code: 'RUNTIME_UP' };
    },

    async healthReachable(): Promise<CheckOutcome> {
      const { status } = await info();
      if (status === 200) return { ok: true, code: 'INFO_OK' };
      if (status === 401) return { ok: false, code: 'RUNTIME_AUTH_FAILED' };
      return { ok: false, code: `INFO_HTTP_${status}` };
    },

    async versionsMatch(): Promise<CheckOutcome> {
      const { body } = await info();
      const running = body?.deployment?.running;
      const desired = deps.desiredVersions ?? {};
      if (!running || Object.keys(desired).length === 0) return { ok: true, code: 'VERSION_MATCH_UNKNOWN', skipped: true };
      const mm: string[] = [];
      for (const [c, want] of Object.entries(desired)) {
        const have = running[c];
        if (have === undefined || want === undefined) continue;
        if (have !== want) mm.push(`${c}:${want}!=${have}`);
      }
      return mm.length === 0 ? { ok: true, code: 'VERSION_MATCH_OK' } : { ok: false, code: 'VERSION_MISMATCH', detail: mm.join(', ') };
    },

    async modelLoads(): Promise<CheckOutcome> {
      const { body } = await info();
      if (isExplicitEcho(body)) return { ok: true, code: 'ENGINE_ECHO_FIXTURE', skipped: true };
      if (engineName(body) === 'echo') return { ok: false, code: 'ENGINE_ECHO_NO_MODEL' };
      if (body?.engine?.loaded === true) return { ok: true, code: 'MODEL_LOADED' };
      // Ачаалж эхлүүлээд, 90 с хүртэл хүлээнэ.
      await fetchJson(f, `${deps.runtimeUrl}/warmup`, { method: 'POST', headers: deps.runtimeHeaders }, 5000);
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        const { body: b } = await info();
        if (b?.engine?.loaded === true) return { ok: true, code: 'MODEL_LOADED' };
        if (b?.engine_health && b.engine_health.ok === false && b.engine?.loaded === false) break;
      }
      return { ok: false, code: 'MODEL_LOAD_TIMEOUT' };
    },

    async knowledgeOpens(): Promise<CheckOutcome> {
      const p = deps.knowledgeDbPath;
      if (!p) return { ok: false, code: 'KNOWLEDGE_NOT_INSTALLED' };
      try {
        await stat(p);
      } catch {
        return { ok: false, code: 'KNOWLEDGE_NOT_INSTALLED', detail: p };
      }
      return (await isSqliteFile(p)) ? { ok: true, code: 'KNOWLEDGE_OK' } : { ok: false, code: 'KNOWLEDGE_CORRUPT' };
    },

    async knowledgeManifestValid(): Promise<CheckOutcome> {
      const p = await readPointer(deps.layout, 'knowledge');
      if (!p) return { ok: true, code: 'KNOWLEDGE_POINTER_ABSENT_LEGACY', skipped: true };
      try {
        const st = await stat(p.path);
        return st.size > 0 ? { ok: true, code: 'KNOWLEDGE_MANIFEST_OK' } : { ok: false, code: 'KNOWLEDGE_EMPTY' };
      } catch {
        return { ok: false, code: 'KNOWLEDGE_POINTER_DANGLING' };
      }
    },

    async generationSmoke(): Promise<CheckOutcome> {
      const t0 = Date.now();
      try {
        const res = await f(`${deps.runtimeUrl}/generate`, {
          method: 'POST',
          headers: { ...deps.runtimeHeaders, 'content-type': 'application/json' },
          body: JSON.stringify({ turns: [{ role: 'user', content: 'Сайн уу' }], max_tokens: 8, stream: false }),
          signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok) return { ok: false, code: `GENERATION_HTTP_${res.status}` };
        const text = await res.text();
        return text.length > 0 ? { ok: true, code: 'GENERATION_OK', detail: `${Date.now() - t0} мс` } : { ok: false, code: 'GENERATION_EMPTY' };
      } catch (err) {
        return { ok: false, code: 'GENERATION_FAILED', detail: (err as Error).message };
      }
    },

    async backendReachable(): Promise<CheckOutcome> {
      const { status } = await fetchJson(f, `${deps.controlPlane}/api/mgl-ai/health`, {}, 8000);
      // 401 = хүрсэн, зөвхөн нэвтрэлт хэрэгтэй.  0 = сүлжээ.
      if (status === 0) return { ok: false, code: 'BACKEND_UNREACHABLE' };
      if (status >= 500) return { ok: false, code: `BACKEND_HTTP_${status}` };
      return { ok: true, code: 'BACKEND_OK' };
    },

    async revitBridge(): Promise<CheckOutcome> {
      if (!deps.revitBridgeUrl) return { ok: true, code: 'REVIT_NOT_INSTALLED', skipped: true };
      const { status } = await fetchJson(f, `${deps.revitBridgeUrl}/ping`, {}, 2000);
      return status === 0 ? { ok: false, code: 'REVIT_BRIDGE_OFFLINE' } : { ok: true, code: 'REVIT_BRIDGE_OK' };
    },
  };
}

/** Мэдлэгийн санг ХААНААС уншихыг шийднэ: заагч (шинэ) → шууд зам (хуучин суулгац). */
export async function resolveKnowledgeDb(layout: InstallLayout, legacyPath: string): Promise<string | null> {
  const p = await readPointer(layout, 'knowledge');
  if (p) return p.path;
  try {
    await stat(legacyPath);
    return legacyPath;
  } catch {
    return null;
  }
}

/**
 * АЖИЛЛАЖ БУЙ кодын хувилбар — entry-ийн хажуугийн `package.json` (`runtime/src/server.ts`
 * → `../../package.json`).  Заагчийн хувилбар БИШ, файл дээрх бодит хувилбар: заагч 1.2
 * рүү заасан атлаа хуучин процесс амьд бол энэ нь 1.1 гэж хэлнэ (P0-6).
 */
export async function runningCodeVersion(entry: string | null): Promise<string | null> {
  if (!entry) return null;
  const { dirname, join } = await import('node:path');
  const { readFile } = await import('node:fs/promises');
  for (const rel of ['../../package.json', '../package.json', './package.json']) {
    try {
      const raw = await readFile(join(dirname(entry), rel), 'utf8');
      const v = (JSON.parse(raw) as { version?: unknown }).version;
      if (typeof v === 'string' && v.length > 0) return v;
    } catch {
      /* дараагийнх */
    }
  }
  return null;
}
