/**
 * MGL AI · ЯРИАНЫ БҮТЭЦТЭЙ ТӨЛӨВ (ярианы кернел, 1-р хэсэг).
 *
 * ⚠️ ЯАГААД ЭНЭ ФАЙЛ ОРШИН БАЙНА.  Өмнө нь ярианы «төлөв» гэдэг нь
 *    сүүлийн 10 мессежийн БҮТЭН текст байв — түүнийг prompt-д хийгээд
 *    загвар өөрөө «одоо юуны тухай ярьж байна» гэдгийг таамаглана гэж
 *    найддаг байсан.  Үр дүн нь хэмжигдсэн хоёр гажиг:
 *      1. ГООЖИЛТ — «Төсөл A-ийн deadline?» гэснийй дараа «В2 галын
 *         ачаалал хэд вэ?» гэхэд загвар төсөл A-ийн ажилтан, хугацааг
 *         нормын хариултад ХОЛЬДОГ.
 *      2. ДАВТАЛТ — өмнөх 900 токены хариулт prompt-д бүтнээрээ байхад
 *         загвар түүнийг ДАХИН бичих хандлагатай.
 *
 *    Шийдэл нь түүхийг устгах БИШ (тэгвэл «яагаад удаад байна?» гэсэн
 *    үргэлжлэл ажиллахаа болино), харин ярианы төлөвийг БҮТЭЦТЭЙ
 *    болгож, ээлж бүрд ЮУГ дамжуулахыг тайлагч (`turn.ts`) шийддэг
 *    болгох.  Энэ файл нь тэр бүтэцтэй төлөвийн хэлбэр, ариутгал,
 *    шинэчлэл.
 *
 * ⚠️ ТӨЛӨВ НЬ КЛИЕНТЭЭР ДАМЖИНА, СЕРВЕР ШИЙДНЭ.  `tool_results`-ийн
 *    ижил загвар: `/context` нь `conv_state_next`-ийг буцаана, хөтөч
 *    түүнийг дараагийн `/plan`, `/context`-д ХӨНДӨЛГҮЙ буцааж өгнө.
 *    Сервер түүнийг `parseConvState`-ээр АРИУТГАНА — клиент дурын
 *    төслийн id тавьж болох ч тэр id нь ЭРХИЙН шийдвэрт ХЭЗЭЭ Ч
 *    оролцохгүй: хэрэгсэл нь `/tool` дээр `decideTool` + `projectIds`-ээр
 *    дахин хаагдана.  Төлөв бол prompt-ын чиглүүлэг, эрх БИШ.
 *
 * ⚠️ ТҮР ЗУУРЫН ТӨЛӨВ ХУГАЦААТАЙ (§11).  Идэвхтэй сэдэв нь
 *    `SUBJECT_TTL_TURNS` ээлжийн дараа өөрөө унтарна — өчигдрийн
 *    төсөл өнөөдрийн нормын асуултад орж ирэхгүй.
 *
 * ⚠️ ЦЭВЭР ФУНКЦ — D1-гүй, бүрэн тестлэгдэнэ (`convState.test.ts`).
 */
import type { AiIntent } from './intent';

export const CONV_STATE_VERSION = 1 as const;

/** Идэвхтэй сэдэв нь хэдэн ээлжийн дараа өөрөө унтрах вэ. */
export const SUBJECT_TTL_TURNS = 6;

/** Ярианд харагдсан төслүүдийн дээд тоо — нэр таних жагсаалт. */
const MAX_PROJECTS_SEEN = 40;
const MAX_NAME = 120;
const MAX_LABEL = 160;

/**
 * Идэвхтэй сэдэв.
 *
 * ⚠️ `project` нь id-тай — дараагийн ээлжинд `get_project_progress`
 *    гэх мэт хэрэгслийг ЯГ тэр төсөл дээр дуудахын тулд.  `norm` нь
 *    зөвхөн шошго — нормын үргэлжлэл нь ихэвчлэн тэмдэглэгээгээрээ
 *    (В2, 1800 MJ/m²) өөрөө танигддаг тул id хэрэггүй.
 */
export type ConvSubject =
  | { kind: 'project'; id: number; name: string }
  | { kind: 'norm'; label: string }
  | { kind: 'employee'; label: string };

export interface SeenProject {
  id: number;
  name: string;
}

export interface ConvState {
  version: typeof CONV_STATE_VERSION;
  /** Одоо ярьж буй зүйл — байхгүй бол `null`. */
  subject: ConvSubject | null;
  /** Сэдэв тогтоогдсон ээлжийн дугаар (`seq`) — хугацаа тоолоход. */
  subjectSetAtSeq: number;
  /** Өмнөх ээлжийн санаа — үргэлжлэл эсэхийг ялгахад. */
  lastIntent: AiIntent | null;
  /** Өмнөх ээлжинд дуудсан хэрэгслүүд. */
  lastTools: string[];
  /** Өмнөх ээлжийн асуулт (тайрсан) — тайлагчийн лавлагаа. */
  lastQuestion: string;
  /** Өмнөх ээлжийн дугаар. */
  lastSeq: number;
  /** Ярианд ERP-ээс ирсэн төслүүд — нэр → id таних жагсаалт. */
  projectsSeen: SeenProject[];
  /**
   * НОРМЫН ТӨЛӨВ (P0-13, 2026-09-11) — өмнөх нормын ээлжийн ИНЖЕНЕРИЙН ОРОЛТ,
   * баримт, үр дүнгийн хураангуй.  Follow-up («тэгвэл Q=50000, H=6 бол?») нь
   * эдгээрийг ОДООГИЙН асуулттай нэгтгэж (одоогийнх давамгайлна) хөдөлгүүрийг
   * ДАХИН ажиллуулна; хайлт нь үргэлж шинэ.  Өмнөх хариултын ТЕКСТ энд
   * хэзээ ч орохгүй — нотолгоо биш.
   */
  norm: NormTurnState | null;
}

export interface NormTurnState {
  /** Тоон оролт — түлхүүр нь EngineeringEntities-ийн нэр (gMjM2, qMj, sM2, hM, deltaPKpa, flashPointC, apparatusPressureKpa, apparatusVolumeM3, geometricVolumeM3). */
  inputs: Record<string, number>;
  medium: string[];
  equipmentVolumeUnknown: boolean;
  documentCode: string | null;
  lastKind: string | null;
  lastInitialCategory: string | null;
  lastFinalCategory: string | null;
  lastMissingInputs: string[];
  setAtSeq: number;
  /** L2 (2026-09-18): сүүлд тайлбарласан заалт («5.2», «8-р хавсралтын 8.3») — follow-up хаяг, текст биш. */
  lastClause?: string | null;
}

export function emptyConvState(): ConvState {
  return {
    version: CONV_STATE_VERSION,
    subject: null,
    subjectSetAtSeq: -1,
    lastIntent: null,
    lastTools: [],
    lastQuestion: '',
    lastSeq: -1,
    projectsSeen: [],
    norm: null,
  };
}

function cleanStr(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  if (s.length === 0) return null;
  return s.slice(0, max);
}

function cleanInt(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e9 ? v : null;
}

const KNOWN_INTENTS = new Set<string>([
  'CASUAL',
  'META',
  'GENERAL_HELP',
  'COMPANY_FACT',
  'ERP_ANALYSIS',
  'REVIT_READ',
  'REVIT_ACTION',
  'NORMATIVE',
  'DOCUMENT_ANALYSIS',
  'CALCULATION',
]);

function parseSubject(raw: unknown): ConvSubject | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === 'project') {
    const id = cleanInt(r.id);
    const name = cleanStr(r.name, MAX_NAME);
    if (id === null || id === 0 || name === null) return null;
    return { kind: 'project', id, name };
  }
  if (r.kind === 'norm' || r.kind === 'employee') {
    const label = cleanStr(r.label, MAX_LABEL);
    if (label === null) return null;
    return { kind: r.kind, label };
  }
  return null;
}

/**
 * Клиентээс ирсэн төлөвийг АРИУТГАНА.  Ямар ч алдаатай оролт хоосон
 * төлөв болно — чат УНАХГҮЙ, зүгээр л «санахгүй» болно.
 *
 * ⚠️ Хувилбар таарахгүй бол ХАЯНА.  Хуучин хөтөч, шинэ сервер хоёр
 *    зөрвөл дутуу ойлголцсон төлөв нь хоосноос дор.
 */
const NORM_INPUT_KEYS = new Set(['gMjM2', 'qMj', 'sM2', 'hM', 'deltaPKpa', 'flashPointC', 'apparatusPressureKpa', 'apparatusVolumeM3', 'geometricVolumeM3']);
const NORM_MEDIA = new Set(['flammable_gas', 'flammable_liquid_vapor', 'flammable_liquid', 'combustible_dust', 'combustible_fiber']);

/** Клиент хадгалдаг тул ТОО, ТҮЛХҮҮРИЙГ цагаан жагсаалтаар ариутгана. */
export function parseNormTurnState(raw: unknown): NormTurnState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const inputs: Record<string, number> = {};
  if (r.inputs && typeof r.inputs === 'object') {
    for (const [k, v] of Object.entries(r.inputs as Record<string, unknown>)) {
      if (NORM_INPUT_KEYS.has(k) && typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e12) inputs[k] = v;
    }
  }
  const medium = Array.isArray(r.medium) ? r.medium.filter((m): m is string => typeof m === 'string' && NORM_MEDIA.has(m)).slice(0, 5) : [];
  const setAtSeq = cleanInt(r.setAtSeq);
  if (Object.keys(inputs).length === 0 && medium.length === 0 && !r.documentCode) return null;
  return {
    inputs,
    medium,
    equipmentVolumeUnknown: r.equipmentVolumeUnknown === true,
    documentCode: cleanStr(r.documentCode, 64),
    lastKind: cleanStr(r.lastKind, 32),
    lastInitialCategory: cleanStr(r.lastInitialCategory, 8),
    lastFinalCategory: cleanStr(r.lastFinalCategory, 8),
    lastMissingInputs: Array.isArray(r.lastMissingInputs) ? r.lastMissingInputs.filter((x): x is string => typeof x === 'string').slice(0, 6).map((x) => x.slice(0, 32)) : [],
    setAtSeq: setAtSeq ?? -1,
    lastClause: cleanStr(r.lastClause, 40),
  };
}

export function parseConvState(raw: unknown): ConvState {
  const empty = emptyConvState();
  if (!raw || typeof raw !== 'object') return empty;
  const r = raw as Record<string, unknown>;
  if (r.version !== CONV_STATE_VERSION) return empty;

  const projectsSeen: SeenProject[] = [];
  if (Array.isArray(r.projectsSeen)) {
    const ids = new Set<number>();
    for (const p of r.projectsSeen.slice(0, MAX_PROJECTS_SEEN)) {
      if (!p || typeof p !== 'object') continue;
      const id = cleanInt((p as Record<string, unknown>).id);
      const name = cleanStr((p as Record<string, unknown>).name, MAX_NAME);
      if (id === null || id === 0 || name === null || ids.has(id)) continue;
      ids.add(id);
      projectsSeen.push({ id, name });
    }
  }

  const lastTools: string[] = [];
  if (Array.isArray(r.lastTools)) {
    for (const t of r.lastTools.slice(0, 8)) {
      const s = cleanStr(t, 64);
      if (s && /^[a-z_]+$/.test(s)) lastTools.push(s);
    }
  }

  const lastIntent = typeof r.lastIntent === 'string' && KNOWN_INTENTS.has(r.lastIntent)
    ? (r.lastIntent as AiIntent)
    : null;

  return {
    version: CONV_STATE_VERSION,
    subject: parseSubject(r.subject),
    subjectSetAtSeq: cleanInt(r.subjectSetAtSeq) ?? -1,
    lastIntent,
    lastTools,
    lastQuestion: cleanStr(r.lastQuestion, 300) ?? '',
    lastSeq: cleanInt(r.lastSeq) ?? -1,
    projectsSeen,
    norm: parseNormTurnState(r.norm),
  };
}

/** Сэдэв нь ХУУЧИРСАН эсэх — TTL-ээс олон ээлж өнгөрсөн бол. */
export function subjectExpired(state: ConvState, seq: number): boolean {
  if (state.subject === null) return true;
  if (state.subjectSetAtSeq < 0) return true;
  return seq - state.subjectSetAtSeq > SUBJECT_TTL_TURNS;
}

/** Хоёр сэдэв ижил эсэх. */
export function sameSubject(a: ConvSubject | null, b: ConvSubject | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'project' && b.kind === 'project') return a.id === b.id;
  if (a.kind !== 'project' && b.kind !== 'project') return a.label === b.label;
  return false;
}

/** Хэрэгслийн үр дүнгээс төслийн (id, нэр) хосыг цуглуулна. */
export function projectsFromToolData(tool: string, data: unknown): SeenProject[] {
  if (!data || typeof data !== 'object') return [];
  const d = data as Record<string, unknown>;
  const out: SeenProject[] = [];
  const push = (id: unknown, name: unknown) => {
    const i = cleanInt(id);
    const n = cleanStr(name, MAX_NAME);
    if (i !== null && i > 0 && n !== null) out.push({ id: i, name: n });
  };
  if (tool === 'get_project_progress') {
    push(d.id, d.name);
    return out;
  }
  if (tool === 'analyze_project' && d.project && typeof d.project === 'object') {
    const p = d.project as Record<string, unknown>;
    push(p.id, p.name);
    return out;
  }
  if (Array.isArray(d.projects)) {
    for (const p of d.projects) {
      if (p && typeof p === 'object') {
        const r = p as Record<string, unknown>;
        push(r.id, r.name);
      }
    }
  }
  if (Array.isArray(d.tasks)) {
    for (const t of d.tasks) {
      if (t && typeof t === 'object') {
        const r = t as Record<string, unknown>;
        push(r.project_id, r.project);
      }
    }
  }
  return out;
}

/** Хоёр жагсаалтыг id-аар нэгтгэж, ШИНИЙГ урд нь тавина. */
export function mergeProjectsSeen(
  prev: readonly SeenProject[],
  next: readonly SeenProject[],
): SeenProject[] {
  const seen = new Set<number>();
  const out: SeenProject[] = [];
  for (const p of [...next, ...prev]) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
    if (out.length >= MAX_PROJECTS_SEEN) break;
  }
  return out;
}
