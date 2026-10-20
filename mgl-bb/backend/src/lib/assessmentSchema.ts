/**
 * Үнэлгээний схемийн каноник төрлүүд + сервер талын шалгалт/цэвэрлэгээ.
 *
 * ⚠️ Энэ файлын СХЕМИЙН төрлүүд `frontend/src/features/assessments/types.ts`-тэй
 *    ЯГ ИЖИЛ байна.  Shared package байхгүй тул хоёр талд давхардуулсан — аль
 *    нэгийг засвал нөгөөг нь заавал дагуулж засна.
 *    Дэлгэрэнгүй: docs/dev/assessments-spec.md §5.
 *
 * Схем нь `assessment_templates.schema_json` / `assessment_rounds.schema_json`
 * баганад JSON-оор хадгалагдана (кодонд БИШ) — шинэ асуулга нэмэхэд migration
 * хэрэггүй.  Тиймээс DB-ээс уншсан бүх схем «үл итгэмжит» гэж үзэж энд
 * бүтцээр нь шалгаж, буруу бол `null` буцаана (route унахгүй).
 */

// ---------------------------------------------------------------------------
// Схем (assessment_templates.schema_json / assessment_rounds.schema_json)
// ---------------------------------------------------------------------------

/** 1–5 онооны нэг шатлалын тайлбар (хуудасны оройн legend-д харагдана). */
export interface AssessmentScaleOption {
  /** Оноо (ихэвчлэн 1..5). */
  value: number;
  /** Богино нэр — жишээ нь «EXPERT», «Тогтмол, байнгын». */
  label: string;
  /** Дэлгэрэнгүй тайлбар — «20 ба түүнээс дээш төсөлд хийж гүйцэтгэсэн…». */
  caption?: string;
}

/** Онооны шатлал. Ур чадвар (туршлага) ба зан чанар нь өөр өөр тайлбартай. */
export interface AssessmentScale {
  id: string;
  label: string;
  min: number;
  max: number;
  options: AssessmentScaleOption[];
}

/** `pct` утгыг level нэр рүү буулгах хязгаар. */
export interface AssessmentLevelBand {
  code: string;
  label: string;
  /** Хамрах хувийн доод хязгаар (оруулаад). */
  minPct: number;
  /** Хамрах хувийн дээд хязгаар (оруулаад). */
  maxPct: number;
  /** Tailwind-гүй түүхий hex — график болон badge-д. */
  color: string;
}

/** 1–5 оноо өгөх нэг мөр. `must` оноо бүрд `scale.max` нэмэгдэнэ. */
export interface AssessmentItem {
  id: string;
  text: string;
  /** true бол оноог урвуулж тооцно (5→1). Архитекторын судалгаанд хэрэглээгүй. */
  reverse?: boolean;
}

/** Дэд асуулт (1.1.1 гэх мэт) — доор нь оноо өгөх мөрүүд байна. */
export interface AssessmentGroup {
  id: string;
  title: string;
  hint?: string;
  items: AssessmentItem[];
}

/** Хэсэг — ур чадварт нэг хуудас, зан чанарт spider-ийн нэг тэнхлэг. */
export interface AssessmentSection {
  id: string;
  /** График/Excel-д харагдах богино код: «CONCEPT_DESIGN». */
  code: string;
  title: string;
  subtitle?: string;
  description?: string;
  /** Зөвхөн `weighted: true` part-д утгатай. Нийлбэр 100 байх ёстой (зөөлөн). */
  weight: number;
  groups: AssessmentGroup[];
}

export interface AssessmentPart {
  id: string;
  title: string;
  intro?: string;
  /** `AssessmentSchema.scales[].id` руу заана. */
  scaleId: string;
  chart: 'scatter' | 'radar';
  /** true — жин, level, нийт оноо бодогдоно. false — зөвхөн хэсгийн хувь. */
  weighted: boolean;
  /** 'section' — хэсэг бүр тусдаа хуудас. 'part' — бүгд нэг хуудсанд. */
  paging: 'section' | 'part';
  sections: AssessmentSection[];
}

/**
 * Асуултгүй танилцуулга/зааврын нэг блок.
 *
 * Word-оос ирсэн «СУДАЛГААНЫ АГУУЛГА», «СУДАЛГАА НЬ ҮНДСЭН 2 ХЭСЭГТ
 * ХУВААГДАНА» мэт оноо өгөх мөргүй хэсгүүд ЭНД хадгалагдана — тэдгээр нь
 * хог биш, ажилтан бөглөж эхлэхийн ӨМНӨ уншдаг заавар юм.  Wizard-ын
 * ХАМГИЙН ЭХНИЙ хуудас болж гарна (`AssessmentFillPage` → `IntroPage`).
 */
export interface AssessmentIntroBlock {
  id: string;
  /** Гарчиг — Word дээрх хоосон хэсгийн нэр. */
  heading?: string;
  /** Догол мөрүүд — `\n`-ээр тусгаарласан энгийн текст (markdown БИШ). */
  body?: string;
}

export interface AssessmentSchema {
  version: 1;
  scales: AssessmentScale[];
  levels: AssessmentLevelBand[];
  parts: AssessmentPart[];
  /** Танилцуулга хуудас. Хоосон/байхгүй бол тэр хуудас гарахгүй. */
  intro?: AssessmentIntroBlock[];
}

/** Хариултын хавтгай map: item id → оноо. */
export type AssessmentAnswers = Record<string, number>;

export type EvaluatorKind = 'self' | 'senior';
export type ResponseStatus = 'draft' | 'submitted';
export type RoundStatus = 'draft' | 'open' | 'closed';
export type TemplateStatus = 'draft' | 'active' | 'archived';

// ---------------------------------------------------------------------------
// Хязгаарууд
// ---------------------------------------------------------------------------

export const SCHEMA_VERSION = 1;
/** Нэг схемд байж болох оноо өгөх мөрийн дээд тоо. */
export const MAX_SCHEMA_ITEMS = 2000;
/** `schema_json`-ий дээд хэмжээ (UTF-8 байтаар). */
export const MAX_SCHEMA_BYTES = 400 * 1024;
/** `answers_json`-ий дээд хэмжээ (UTF-8 байтаар). */
export const MAX_ANSWERS_BYTES = 200 * 1024;

/** Хоосон (шинэ) схем — гэмтэлтэй JSON-ы оронд хэрэглэнэ. */
export const EMPTY_SCHEMA: AssessmentSchema = {
  version: 1,
  scales: [],
  levels: [],
  parts: [],
};

// ---------------------------------------------------------------------------
// Дотоод туслахууд
// ---------------------------------------------------------------------------

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** JSON мөрийн UTF-8 байтын урт (кирилл текст 2 байт эзэлдэг тул .length хангалтгүй). */
export function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

// ---------------------------------------------------------------------------
// Шалгалт
// ---------------------------------------------------------------------------

export type SchemaValidation =
  | { ok: true; schema: AssessmentSchema }
  | { ok: false; error: string };

/**
 * Түүхий (үл итгэмжит) объектыг схем болгон шалгаж, ЦЭВЭРЛЭСЭН хуулбарыг
 * буцаана — танихгүй талбарууд хасагдана.
 *
 * Хатуу шалгах зүйлс: `version === 1`, `parts` массив, section бүрд `groups`
 * массив, асуултын id давхардаагүй, part бүрийн `scaleId` нь `scales` дотор
 * байгаа, нийт мөр ≤ 2000, JSON ≤ 400 KB.  Жингийн нийлбэр 100 эсэхийг
 * ШАЛГАХГҮЙ — репогийн конвенцоор энэ нь UI-ийн зөөлөн (шар) сэрэмжлүүлэг.
 */
export function validateSchema(input: unknown): SchemaValidation {
  if (!isObj(input)) return { ok: false, error: 'Схем объект байх ёстой' };
  if (input.version !== SCHEMA_VERSION) {
    return { ok: false, error: 'Схемийн version нь 1 байх ёстой' };
  }

  /* ---- scales ---- */
  if (input.scales !== undefined && !Array.isArray(input.scales)) {
    return { ok: false, error: 'scales нь массив байх ёстой' };
  }
  const scales: AssessmentScale[] = [];
  const scaleIds = new Set<string>();
  for (const rawScale of (input.scales as unknown[] | undefined) ?? []) {
    if (!isObj(rawScale)) return { ok: false, error: 'scale элемент объект байх ёстой' };
    const id = str(rawScale.id)?.trim();
    if (!id) return { ok: false, error: 'scale.id хоосон байна' };
    if (scaleIds.has(id)) return { ok: false, error: `scale.id давхардсан: ${id}` };
    scaleIds.add(id);

    const min = num(rawScale.min);
    const max = num(rawScale.max);
    if (min === null || max === null) {
      return { ok: false, error: `«${id}» шатлалын min/max тоо байх ёстой` };
    }
    if (max <= min) {
      return { ok: false, error: `«${id}» шатлалын max нь min-ээс их байх ёстой` };
    }

    if (rawScale.options !== undefined && !Array.isArray(rawScale.options)) {
      return { ok: false, error: `«${id}» шатлалын options массив байх ёстой` };
    }
    const options: AssessmentScaleOption[] = [];
    for (const rawOpt of (rawScale.options as unknown[] | undefined) ?? []) {
      if (!isObj(rawOpt)) continue;
      const value = num(rawOpt.value);
      if (value === null) continue;
      options.push({
        value,
        label: str(rawOpt.label) ?? '',
        caption: str(rawOpt.caption) ?? undefined,
      });
    }

    scales.push({ id, label: str(rawScale.label) ?? '', min, max, options });
  }

  /* ---- levels (хоосон байж болно — тэгвэл score талын DEFAULT_LEVELS ажиллана) ---- */
  if (input.levels !== undefined && !Array.isArray(input.levels)) {
    return { ok: false, error: 'levels нь массив байх ёстой' };
  }
  const levels: AssessmentLevelBand[] = [];
  for (const rawLevel of (input.levels as unknown[] | undefined) ?? []) {
    if (!isObj(rawLevel)) return { ok: false, error: 'level элемент объект байх ёстой' };
    const code = str(rawLevel.code)?.trim();
    if (!code) return { ok: false, error: 'level.code хоосон байна' };
    const minPct = num(rawLevel.minPct);
    const maxPct = num(rawLevel.maxPct);
    if (minPct === null || maxPct === null) {
      return { ok: false, error: `«${code}» түвшний minPct/maxPct тоо байх ёстой` };
    }
    levels.push({
      code,
      label: str(rawLevel.label) ?? code,
      minPct,
      maxPct,
      color: str(rawLevel.color) ?? '#94a3b8',
    });
  }

  /* ---- intro (танилцуулга хуудас — заавал биш) ---- */
  if (input.intro !== undefined && !Array.isArray(input.intro)) {
    return { ok: false, error: 'intro нь массив байх ёстой' };
  }
  const intro: AssessmentIntroBlock[] = [];
  const introIds = new Set<string>();
  for (const rawBlock of (input.intro as unknown[] | undefined) ?? []) {
    if (!isObj(rawBlock)) return { ok: false, error: 'intro элемент объект байх ёстой' };
    const blockId = str(rawBlock.id)?.trim();
    if (!blockId) return { ok: false, error: 'intro.id хоосон байна' };
    if (introIds.has(blockId)) return { ok: false, error: `intro.id давхардсан: ${blockId}` };
    introIds.add(blockId);
    intro.push({
      id: blockId,
      heading: str(rawBlock.heading)?.trim() || undefined,
      body: str(rawBlock.body) ?? undefined,
    });
  }

  /* ---- parts → sections → groups → items ---- */
  if (!Array.isArray(input.parts)) return { ok: false, error: 'parts нь массив байх ёстой' };

  const parts: AssessmentPart[] = [];
  const partIds = new Set<string>();
  const sectionIds = new Set<string>();
  const groupIds = new Set<string>();
  const itemIds = new Set<string>();

  for (const rawPart of input.parts as unknown[]) {
    if (!isObj(rawPart)) return { ok: false, error: 'part элемент объект байх ёстой' };
    const partId = str(rawPart.id)?.trim();
    if (!partId) return { ok: false, error: 'part.id хоосон байна' };
    if (partIds.has(partId)) return { ok: false, error: `part.id давхардсан: ${partId}` };
    partIds.add(partId);

    const scaleId = str(rawPart.scaleId)?.trim() ?? '';
    if (!scaleIds.has(scaleId)) {
      return {
        ok: false,
        error: `«${partId}» хэсгийн scaleId «${scaleId}» нь scales жагсаалтад алга`,
      };
    }

    if (!Array.isArray(rawPart.sections)) {
      return { ok: false, error: `«${partId}» хэсгийн sections массив байх ёстой` };
    }

    const sections: AssessmentSection[] = [];
    for (const rawSection of rawPart.sections as unknown[]) {
      if (!isObj(rawSection)) return { ok: false, error: 'section элемент объект байх ёстой' };
      const sectionId = str(rawSection.id)?.trim();
      if (!sectionId) return { ok: false, error: 'section.id хоосон байна' };
      if (sectionIds.has(sectionId)) {
        return { ok: false, error: `section.id давхардсан: ${sectionId}` };
      }
      sectionIds.add(sectionId);

      // Spec: section бүр ЗААВАЛ groups талбартай (хоосон массив байж болно —
      // хагас зохиосон асуулгыг хадгалахыг хориглохгүй).
      if (!Array.isArray(rawSection.groups)) {
        return { ok: false, error: `«${sectionId}» хэсэгт groups массив алга` };
      }

      const groups: AssessmentGroup[] = [];
      for (const rawGroup of rawSection.groups as unknown[]) {
        if (!isObj(rawGroup)) return { ok: false, error: 'group элемент объект байх ёстой' };
        const groupId = str(rawGroup.id)?.trim();
        if (!groupId) return { ok: false, error: 'group.id хоосон байна' };
        if (groupIds.has(groupId)) {
          return { ok: false, error: `group.id давхардсан: ${groupId}` };
        }
        groupIds.add(groupId);

        if (!Array.isArray(rawGroup.items)) {
          return { ok: false, error: `«${groupId}» бүлэгт items массив алга` };
        }

        const items: AssessmentItem[] = [];
        for (const rawItem of rawGroup.items as unknown[]) {
          if (!isObj(rawItem)) return { ok: false, error: 'item элемент объект байх ёстой' };
          const itemId = str(rawItem.id)?.trim();
          if (!itemId) return { ok: false, error: 'item.id хоосон байна' };
          // Хариулт нь хавтгай map тул id БҮХ схемийн хэмжээнд давхардаж болохгүй.
          if (itemIds.has(itemId)) {
            return { ok: false, error: `Асуултын id давхардсан: ${itemId}` };
          }
          itemIds.add(itemId);
          items.push({
            id: itemId,
            text: str(rawItem.text) ?? '',
            reverse: rawItem.reverse === true ? true : undefined,
          });
        }

        groups.push({
          id: groupId,
          title: str(rawGroup.title) ?? '',
          hint: str(rawGroup.hint) ?? undefined,
          items,
        });
      }

      sections.push({
        id: sectionId,
        code: str(rawSection.code)?.trim() || sectionId,
        title: str(rawSection.title) ?? '',
        subtitle: str(rawSection.subtitle) ?? undefined,
        description: str(rawSection.description) ?? undefined,
        weight: num(rawSection.weight) ?? 0,
        groups,
      });
    }

    parts.push({
      id: partId,
      title: str(rawPart.title) ?? '',
      intro: str(rawPart.intro) ?? undefined,
      scaleId,
      chart: rawPart.chart === 'radar' ? 'radar' : 'scatter',
      weighted: rawPart.weighted === true,
      paging: rawPart.paging === 'section' ? 'section' : 'part',
      sections,
    });
  }

  if (itemIds.size > MAX_SCHEMA_ITEMS) {
    return {
      ok: false,
      error: `Асуултын тоо хэт их: ${itemIds.size} (дээд тал нь ${MAX_SCHEMA_ITEMS})`,
    };
  }

  const schema: AssessmentSchema = {
    version: 1,
    scales,
    levels,
    parts,
    ...(intro.length ? { intro } : {}),
  };
  if (utf8Length(JSON.stringify(schema)) > MAX_SCHEMA_BYTES) {
    return { ok: false, error: 'Схем хэт том байна (400 KB-аас их)' };
  }
  return { ok: true, schema };
}

/**
 * DB-ийн `schema_json` (эсвэл аль хэдийн парслагдсан объект) → схем.
 * JSON гэмтэлтэй эсвэл бүтэц буруу бол `null`.
 */
export function parseSchema(raw: unknown): AssessmentSchema | null {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw || '{}');
    } catch {
      return null;
    }
  }
  const checked = validateSchema(data);
  return checked.ok ? checked.schema : null;
}

/** Схемийн бүх оноо өгөх мөрийн id. */
export function collectItemIds(schema: AssessmentSchema): Set<string> {
  const ids = new Set<string>();
  for (const part of schema.parts) {
    for (const section of part.sections) {
      for (const group of section.groups) {
        for (const item of group.items) ids.add(item.id);
      }
    }
  }
  return ids;
}

/** item id → тухайн мөрийн шатлалын [min, max] хязгаар. */
function itemBounds(schema: AssessmentSchema): Map<string, { min: number; max: number }> {
  const bounds = new Map<string, { min: number; max: number }>();
  for (const part of schema.parts) {
    // scaleForPart-тай ижил дефолтлолт (score талд давхардуулахгүйн тулд энд бичив —
    // assessmentScore.ts нь ЭНЭ файлаас импортлодог тул урвуу хамаарал үүсгэхгүй).
    const scale = schema.scales.find((s) => s.id === part.scaleId) ?? schema.scales[0];
    const min = scale ? scale.min : 1;
    const max = scale ? scale.max : 5;
    for (const section of part.sections) {
      for (const group of section.groups) {
        for (const item of group.items) bounds.set(item.id, { min, max });
      }
    }
  }
  return bounds;
}

/**
 * Клиентээс ирсэн хариултын map-ыг цэвэрлэнэ:
 *   • схемд БАЙХГҮЙ item id-г хаяна (хуучирсан/хуурамч түлхүүр),
 *   • бүхэл тоо болгож бөөрөнхийлнө,
 *   • тухайн мөрийн шатлалын `min..max` завсарт багтаана,
 *   • 0 / сөрөг / тоо биш утгыг «хариулаагүй» гэж үзэж түлхүүрийг ХАСНА
 *     (ингэснээр хэрэглэгч сонголтоо буцааж цэвэрлэж чадна; оноо бодох тал
 *     мөн 0-ийг хариулаагүйд тооцдог — assessmentScore.sumSection).
 */
export function sanitizeAnswers(raw: unknown, schema: AssessmentSchema): AssessmentAnswers {
  const out: AssessmentAnswers = {};
  if (!isObj(raw)) return out;
  const bounds = itemBounds(schema);
  for (const [key, value] of Object.entries(raw)) {
    const bound = bounds.get(key);
    if (!bound) continue;
    const n = num(value);
    if (n === null || n <= 0) continue;
    out[key] = Math.min(Math.max(Math.round(n), bound.min), bound.max);
  }
  return out;
}
