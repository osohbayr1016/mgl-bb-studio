/**
 * MGL AI · РЕЛИЗИЙН МАНИФЕСТ (Session B §5, §6, §28).
 *
 * ⚠️ ГАНЦ «ХУВИЛБАР» ГЭЖ БАЙХГҮЙ.  Суулгац нь ЗУРГААН бие даасан
 *    бүрэлдэхүүнтэй, тус бүр өөрийн хувилбар, өөрийн SHA-256, өөрийн
 *    шинэчлэлтийн хэмнэлтэй:
 *
 *      app            хөтчийн SPA-тай холбогдох локал UI гэрээ           ойр ойр, KB
 *      runtime        `ai/runtime` + `ai/retrieval` код                  ойр ойр, ~1 MB
 *      model          суурь GGUF + (заавал биш) адаптер                  ховор, GB
 *      knowledge      бэлэн `knowledge.sqlite` багц                      норм ирэх бүрд, MB
 *      normRegistry   дүрмийн бүртгэлийн хувилбар (Session A компилдог)  мэдлэгтэй хамт
 *      revit          Revit add-in zip                                   тусдаа
 *
 *    Загварын шинэчлэлт мэдлэгийг ДАХИН БАРИХГҮЙ, мэдлэгийн шинэчлэлт
 *    QLoRA ШААРДАХГҮЙ, UI-ийн засвар 5 GB ТАТУУЛАХГҮЙ.  Энэ файлын
 *    оршин байх шалтгаан нь тэр гурван «үгүй».
 *
 * ⚠️ ХЭШ ТААРАХГҮЙ ФАЙЛ ХЭЗЭЭ Ч ИДЭВХЖИХГҮЙ.  `sha256` нь бүрэлдэхүүн
 *    бүрд ЗААВАЛ (64 hex).  «Дараа нэмнэ» гэсэн зөөлрүүлэлт нь 40 машин
 *    дээр ажиллах баталгаажаагүй хоёртын файлын зам.
 *
 * ⚠️ ХАМААРЛЫГ МАНИФЕСТАД ИЛ БИЧНЭ (§28).  «App 1.4 нь runtime ≥ 0.8
 *    шаардана» гэдгийг кодонд нуухгүй; `requires` жагсаалтаар зарлана,
 *    `checkCompatibility` нь идэвхжүүлэхээс ӨМНӨ шалгана.
 *
 * ⚠️ ЭНЭ ФАЙЛ node:fs ИМПОРТЛОДОГГҮЙ — цэвэр өгөгдөл + баталгаажуулалт.
 *    Файлын хэш нь `integrity.ts`-д.
 */
import { compareVersions } from '../../runtime/src/updater.ts';

export const MANIFEST_SCHEMA = 'mgl-ai-release/1' as const;

export const COMPONENT_IDS = ['app', 'runtime', 'model', 'knowledge', 'normRegistry', 'revit'] as const;
export type ComponentId = (typeof COMPONENT_IDS)[number];

export function isComponentId(v: unknown): v is ComponentId {
  return typeof v === 'string' && (COMPONENT_IDS as readonly string[]).includes(v);
}

export const CHANNELS = ['admin', 'canary', 'stable'] as const;
export type Channel = (typeof CHANNELS)[number];

export function isChannel(v: unknown): v is Channel {
  return typeof v === 'string' && (CHANNELS as readonly string[]).includes(v);
}

/** Нэг бүрэлдэхүүн аль нөгөөгийн ямар доод хувилбарыг шаардахыг зарлана. */
export interface Requirement {
  component: ComponentId;
  min: string;
}

export interface ComponentSpec {
  /** Хүний уншиж болох таних тэмдэг (`mgl-qwen3-8b`, `norms`).  Заавал биш. */
  id?: string;
  version: string;
  /** 64 hex, жижиг үсэг.  ⚠️ ЗААВАЛ. */
  sha256: string;
  /**
   * Артефактын хаяг.  `null` = энэ бүрэлдэхүүн татагдахгүй (жишээ нь
   * `normRegistry` нь `knowledge` багц дотор ирдэг тул зөвхөн хувилбар).
   */
  url: string | null;
  sizeBytes: number | null;
  requires?: Requirement[];
  /** Бүрэлдэхүүнд тусгай метадата (загварын quantization, схемийн хувилбар…). */
  meta?: Record<string, string | number | boolean | null>;
}

export interface ReleaseManifest {
  schema: typeof MANIFEST_SCHEMA;
  releaseId: string;
  channel: Channel;
  createdAt: string;
  components: Partial<Record<ComponentId, ComponentSpec>>;
  /** Дэлхий нийтийн доод хязгаар — бүрэлдэхүүний `requires`-ээс гадна. */
  compatibility: {
    minAppVersion?: string | null;
    minRuntimeVersion?: string | null;
  };
  notes?: string | null;
}

export type ManifestValidation =
  | { ok: true; manifest: ReleaseManifest }
  | { ok: false; errors: string[] };

const SHA256_RE = /^[0-9a-f]{64}$/;
const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.\-+_]{0,63}$/;
const RELEASE_ID_RE = /^[0-9A-Za-z][0-9A-Za-z.\-_]{0,127}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Манифестыг БАТАЛГААЖУУЛНА.  Алдаа бүр нь машины уншиж болох мөр —
 * админ хуудас, тест хоёулаа ижил жагсаалтыг харна.
 *
 * ⚠️ БУРУУ МАНИФЕСТ БОЛ ХЭСЭГЧЛЭН Ч ХЭРЭГЛЭГДЭХГҮЙ.  «app хэсэг нь
 *    зөв, model хэсэг нь sha-гүй» гэсэн манифест бүхэлдээ татгалзагдана —
 *    хагас манифестаар суулгасан суулгац нь оношлох боломжгүй.
 */
export function validateManifest(raw: unknown): ManifestValidation {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: ['MANIFEST_NOT_OBJECT'] };

  if (raw.schema !== MANIFEST_SCHEMA) errors.push(`SCHEMA_UNSUPPORTED:${String(raw.schema)}`);
  if (typeof raw.releaseId !== 'string' || !RELEASE_ID_RE.test(raw.releaseId)) {
    errors.push('RELEASE_ID_INVALID');
  }
  if (!isChannel(raw.channel)) errors.push(`CHANNEL_INVALID:${String(raw.channel)}`);
  if (typeof raw.createdAt !== 'string' || Number.isNaN(Date.parse(raw.createdAt))) {
    errors.push('CREATED_AT_INVALID');
  }

  const components: Partial<Record<ComponentId, ComponentSpec>> = {};
  if (!isRecord(raw.components)) {
    errors.push('COMPONENTS_MISSING');
  } else {
    for (const [key, val] of Object.entries(raw.components)) {
      if (!isComponentId(key)) {
        errors.push(`COMPONENT_UNKNOWN:${key}`);
        continue;
      }
      const spec = validateComponent(key, val, errors);
      if (spec) components[key] = spec;
    }
  }
  if (Object.keys(components).length === 0 && errors.length === 0) errors.push('COMPONENTS_EMPTY');

  // `requires` нь ӨӨР бүрэлдэхүүнийг заана — өөрийгөө шаардах нь утгагүй.
  for (const [key, spec] of Object.entries(components)) {
    for (const r of spec.requires ?? []) {
      if (r.component === key) errors.push(`REQUIRES_SELF:${key}`);
    }
  }

  const compat: ReleaseManifest['compatibility'] = {};
  if (raw.compatibility !== undefined) {
    if (!isRecord(raw.compatibility)) {
      errors.push('COMPATIBILITY_INVALID');
    } else {
      for (const k of ['minAppVersion', 'minRuntimeVersion'] as const) {
        const v = raw.compatibility[k];
        if (v === undefined || v === null) continue;
        if (typeof v !== 'string' || !VERSION_RE.test(v)) errors.push(`COMPATIBILITY_${k}_INVALID`);
        else compat[k] = v;
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    manifest: {
      schema: MANIFEST_SCHEMA,
      releaseId: raw.releaseId as string,
      channel: raw.channel as Channel,
      createdAt: raw.createdAt as string,
      components,
      compatibility: compat,
      notes: typeof raw.notes === 'string' ? raw.notes : null,
    },
  };
}

function validateComponent(id: ComponentId, val: unknown, errors: string[]): ComponentSpec | null {
  if (!isRecord(val)) {
    errors.push(`COMPONENT_NOT_OBJECT:${id}`);
    return null;
  }
  let bad = false;
  if (typeof val.version !== 'string' || !VERSION_RE.test(val.version)) {
    errors.push(`VERSION_INVALID:${id}`);
    bad = true;
  }
  if (typeof val.sha256 !== 'string' || !SHA256_RE.test(val.sha256.toLowerCase())) {
    errors.push(`SHA256_INVALID:${id}`);
    bad = true;
  }
  if (val.url !== null && val.url !== undefined && typeof val.url !== 'string') {
    errors.push(`URL_INVALID:${id}`);
    bad = true;
  }
  if (val.sizeBytes !== null && val.sizeBytes !== undefined) {
    if (typeof val.sizeBytes !== 'number' || !Number.isInteger(val.sizeBytes) || val.sizeBytes < 0) {
      errors.push(`SIZE_INVALID:${id}`);
      bad = true;
    }
  }
  const requires: Requirement[] = [];
  if (val.requires !== undefined) {
    if (!Array.isArray(val.requires)) {
      errors.push(`REQUIRES_INVALID:${id}`);
      bad = true;
    } else {
      for (const r of val.requires) {
        if (
          !isRecord(r) ||
          !isComponentId(r.component) ||
          typeof r.min !== 'string' ||
          !VERSION_RE.test(r.min)
        ) {
          errors.push(`REQUIRES_ENTRY_INVALID:${id}`);
          bad = true;
          continue;
        }
        requires.push({ component: r.component, min: r.min });
      }
    }
  }
  if (bad) return null;
  return {
    ...(typeof val.id === 'string' ? { id: val.id } : {}),
    version: val.version as string,
    sha256: (val.sha256 as string).toLowerCase(),
    url: typeof val.url === 'string' ? val.url : null,
    sizeBytes: typeof val.sizeBytes === 'number' ? val.sizeBytes : null,
    ...(requires.length > 0 ? { requires } : {}),
    ...(isRecord(val.meta) ? { meta: val.meta as ComponentSpec['meta'] } : {}),
  };
}

/* ================================================================== */
/*  НИЙЦТЭЙ БАЙДАЛ (§28)                                               */
/* ================================================================== */

export interface CompatibilityIssue {
  code: 'REQUIRES_UNMET' | 'REQUIRES_MISSING' | 'MIN_APP_UNMET' | 'MIN_RUNTIME_UNMET';
  component: ComponentId;
  /** Шаардсан бүрэлдэхүүн ба доод хувилбар. */
  needs: { component: ComponentId; min: string };
  have: string | null;
}

/**
 * Идэвхжүүлэлтийн ДАРААХ хувилбарын зураг дээр нийцтэй байдлыг шалгана.
 *
 * `versions` нь «манифестыг хэрэглэсний дараа бүрэлдэхүүн бүр ямар
 * хувилбартай болох вэ» — өөрөөр хэлбэл суулгасан ⊕ манифест.  Дуудагч
 * (`updatePlan.ts`) тэр давхцлыг бүтээнэ; энэ функц цэвэр.
 *
 * ⚠️ ШААРДСАН БҮРЭЛДЭХҮҮН ОГТ БАЙХГҮЙ БОЛ «ХАНГАГДААГҮЙ», «мэдэхгүй»
 *    БИШ.  Runtime байхгүй машинд app идэвхжүүлэх нь ажиллахгүй суулгац.
 */
export function checkCompatibility(
  manifest: ReleaseManifest,
  versions: Partial<Record<ComponentId, string>>,
): CompatibilityIssue[] {
  const issues: CompatibilityIssue[] = [];
  for (const [key, spec] of Object.entries(manifest.components) as [ComponentId, ComponentSpec][]) {
    for (const r of spec.requires ?? []) {
      const have = versions[r.component] ?? null;
      if (have === null) {
        issues.push({ code: 'REQUIRES_MISSING', component: key, needs: r, have: null });
      } else if (compareVersions(have, r.min) < 0) {
        issues.push({ code: 'REQUIRES_UNMET', component: key, needs: r, have });
      }
    }
  }
  const app = versions.app ?? null;
  const rt = versions.runtime ?? null;
  const minApp = manifest.compatibility.minAppVersion ?? null;
  const minRt = manifest.compatibility.minRuntimeVersion ?? null;
  if (minApp !== null && (app === null || compareVersions(app, minApp) < 0)) {
    issues.push({
      code: 'MIN_APP_UNMET',
      component: 'app',
      needs: { component: 'app', min: minApp },
      have: app,
    });
  }
  if (minRt !== null && (rt === null || compareVersions(rt, minRt) < 0)) {
    issues.push({
      code: 'MIN_RUNTIME_UNMET',
      component: 'runtime',
      needs: { component: 'runtime', min: minRt },
      have: rt,
    });
  }
  return issues;
}

export { compareVersions };
