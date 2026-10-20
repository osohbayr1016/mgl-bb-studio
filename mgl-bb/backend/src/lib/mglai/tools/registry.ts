/**
 * MGL AI · ХЭРЭГСЛИЙН БҮРТГЭЛ (§26).
 *
 * ⚠️ ЗАГВАР SQL БИЧИХГҮЙ.  §26: «Do not expose raw SQL generation as the
 *    normal model interface.»  Загвар нь ЗӨВХӨН энд бүртгэгдсэн НЭР ба
 *    түүний бүтэцтэй аргументыг сонгоно.  Хэрэв ямар нэг өдөр «SQL
 *    ажиллуул» гэсэн хэрэгсэл нэмэгдвэл тэр нь энэ файлын бүх утгыг
 *    устгана.
 *
 * ⚠️ РЕФЛЕКЦЭЭР ДУУДАХГҮЙ.  `TOOLS` бол `Record<name, def>` бөгөөд
 *    гүйцэтгэгч нь ЗӨВХӨН энэ объектоос хайна.  Загварын нэрлэсэн мөрийг
 *    функц болгож хувиргах ямар ч зам байхгүй.
 *
 * ⚠️ ЭРХ НЬ ХЭРЭГСЛИЙН ТОДОРХОЙЛОЛТОД, ХЭРЭГЖҮҮЛЭЛТЭД БИШ.  `modes` ба
 *    `kind` нь `lib/mglai/permissions.ts`-ийн `decideTool`-д ордог тул
 *    шинэ хэрэгсэл нэмэхэд эрхийг МАРТАХ боломжгүй — талбар нь заавал.
 *
 * ⚠️ `readsLiveErp: true` нь §35-ийн гол зорилго.  Эдгээр хэрэгсэл нь
 *    «ажилтны тоо», «төслийн явц» гэх мэт ӨӨРЧЛӨГДДӨГ баримтыг жингээс
 *    БИШ, өгөгдлийн сангаас авдгийг тэмдэглэнэ.  Сургалтын багц энэ
 *    тугийг ашиглан «энэ асуултад хэрэгсэл дуудна» гэсэн ЗАН ТӨЛӨВИЙГ
 *    сургана, ХАРИУЛТЫГ биш.
 */
import type { AiMode } from '../identity';
import type { ToolKind } from '../permissions';

export interface ToolParam {
  name: string;
  /** `json` — бүтэцтэй объект/массив; агуулгыг ХЭРЭГСЭЛ ӨӨРӨӨ шалгана (Query DSL). */
  type: 'string' | 'number' | 'integer' | 'boolean' | 'json';
  required: boolean;
  description: string;
  /** Хаалттай олонлог — өгөгдвөл бусад утга 400. */
  enum?: readonly string[];
  min?: number;
  max?: number;
}

export interface ToolDef {
  name: string;
  /** Монгол тайлбар — загварт монголоор танилцуулна. */
  descriptionMn: string;
  descriptionEn: string;
  kind: ToolKind;
  /** Ямар горимд харагдах вэ.  `denied` ХЭЗЭЭ Ч орохгүй. */
  modes: readonly Exclude<AiMode, 'denied'>[];
  params: readonly ToolParam[];
  /** ERP-ийн ТӨЛӨВИЙГ өөрчилдөг эсэх — `erp_write_enabled` шаардана. */
  isErpWrite?: boolean;
  /** Дур мэдсэн код ажиллуулдаг эсэх — `roslyn_enabled` шаардана. */
  isRoslyn?: boolean;
  /** Амьд ERP өгөгдөл уншдаг эсэх (§35-ийн зан төлөвийн сургалтад). */
  readsLiveErp?: boolean;
}

/* ================================================================== */
/*  ERP-ийн уншилтын хэрэгслүүд                                        */
/* ================================================================== */

export const TOOLS: Record<string, ToolDef> = Object.freeze({
  get_active_employees: {
    name: 'get_active_employees',
    descriptionMn:
      'Компанийн ИДЭВХТЭЙ ажилтнуудын жагсаалт ба тоо. Ажилтны тоо, хэн ямар албан тушаалтай гэсэн асуултад ЗААВАЛ энэ хэрэгслийг дуудна — санахуйгаас хариулах нь хуучирсан тоо өгнө.',
    descriptionEn:
      'List and count of active employees. Always call this for headcount or roster questions.',
    kind: 'read',
    modes: ['employee', 'admin'],
    params: [
      {
        name: 'role',
        type: 'string',
        required: false,
        description: 'Зөвхөн энэ албан тушаалаар шүүх.',
        enum: ['engineer', 'architect', 'senior', 'admin'],
      },
    ],
    readsLiveErp: true,
  },

  list_projects: {
    name: 'list_projects',
    descriptionMn:
      'Хэрэглэгчийн харах эрхтэй төслүүд, тус бүрийн жигнэсэн явцын хувьтай. «Хэдэн төсөл байна», «ямар төслүүд идэвхтэй вэ» гэсэн асуултад энэ хэрэгслийг дуудна.',
    descriptionEn: 'Projects visible to the caller with weighted progress percent.',
    kind: 'read',
    modes: ['client', 'employee', 'admin'],
    params: [
      {
        name: 'status',
        type: 'string',
        required: false,
        description: 'Төлвөөр шүүх.',
        enum: ['active', 'completed', 'on_hold', 'cancelled'],
      },
      {
        name: 'limit',
        type: 'integer',
        required: false,
        description: 'Хамгийн ихдээ хэдэн мөр (өгөгдмөл 50).',
        min: 1,
        max: 200,
      },
    ],
    readsLiveErp: true,
  },

  get_upcoming_deadlines: {
    name: 'get_upcoming_deadlines',
    descriptionMn:
      'Хугацаа нь ойртож буй төслүүд, ойрхноос нь эрэмбэлсэн. «Хамгийн ойрхон дуусах ямар төсөл вэ» гэсэн асуултад энэ хэрэгслийг дуудаж, өдрийн зөрүүг ХЭРЭГСЛИЙН буцаасан тоогоор хэл — өөрөө бодохгүй.',
    descriptionEn: 'Projects ordered by nearest finish date, with days remaining computed server-side.',
    kind: 'read',
    modes: ['employee', 'admin'],
    params: [
      {
        name: 'days',
        type: 'integer',
        required: false,
        description: 'Хэдэн хоногийн дотор (өгөгдмөл 30).',
        min: 1,
        max: 365,
      },
      { name: 'limit', type: 'integer', required: false, description: 'Мөрийн тоо.', min: 1, max: 50 },
    ],
    readsLiveErp: true,
  },

  get_overdue_tasks: {
    name: 'get_overdue_tasks',
    descriptionMn:
      'Хугацаа нь хэтэрсэн, дуусаагүй даалгаврууд. Ажилтны горимд өөрийнх нь даалгавар, админд бүх компанийнх.',
    descriptionEn: 'Tasks past their due date and not complete.',
    kind: 'read',
    modes: ['employee', 'admin'],
    params: [
      {
        name: 'scope',
        type: 'string',
        required: false,
        description: 'mine = зөвхөн өөрийн, all = бүх компани (зөвхөн админ).',
        enum: ['mine', 'all'],
      },
      { name: 'limit', type: 'integer', required: false, description: 'Мөрийн тоо.', min: 1, max: 100 },
    ],
    readsLiveErp: true,
  },

  get_my_assignments: {
    name: 'get_my_assignments',
    descriptionMn:
      'Нэвтэрсэн хэрэглэгчийн одоогийн даалгаврууд, явцын хувьтай. «Би юу хийх ёстой вэ» гэсэн асуултад.',
    descriptionEn: 'Current tasks assigned to the authenticated user.',
    kind: 'read',
    modes: ['employee', 'admin'],
    params: [
      { name: 'limit', type: 'integer', required: false, description: 'Мөрийн тоо.', min: 1, max: 100 },
    ],
    readsLiveErp: true,
  },

  get_project_progress: {
    name: 'get_project_progress',
    descriptionMn:
      'Нэг төслийн жигнэсэн явц, багийн задаргаатай. Хувийг ХЭРЭГСЛЭЭС авна — блок, зургийн жингээр өөрөө бодохгүй.',
    descriptionEn: 'Weighted progress for one project, broken down by team.',
    kind: 'read',
    modes: ['client', 'employee', 'admin'],
    params: [
      { name: 'project_id', type: 'integer', required: true, description: 'Төслийн id.', min: 1 },
    ],
    readsLiveErp: true,
  },

  search_regulations: {
    name: 'search_regulations',
    descriptionMn:
      'Барилгын норм, дүрэм, стандартаас (БНбД, БД, MNS) хайх. Нормын асуултад ЗААВАЛ эхлээд энэ хэрэгслийг дуудна. Үр дүн байхгүй бол «баталгаажсан эх сурвалж олдсонгүй» гэж хариулна — дүрэм ЗОХИОХ нь ХОРИОТОЙ.',
    descriptionEn:
      'Search Mongolian construction codes and standards. Mandatory before answering any regulation question.',
    kind: 'read',
    modes: ['client', 'employee', 'admin'],
    params: [
      { name: 'query', type: 'string', required: true, description: 'Хайх утга, монголоор эсвэл англиар.' },
      {
        name: 'top_k',
        type: 'integer',
        required: false,
        description: 'Хэдэн хэсэг буцаах (өгөгдмөл 6).',
        min: 1,
        max: 20,
      },
    ],
  },

  /* ── Системийн ба шинжилгээний хэрэгслүүд (§10, §15, §17, §34) ───── */

  describe_system: {
    name: 'describe_system',
    descriptionMn:
      'MGL ERP систем (вэб апп) ямар хуудас, хэсэг, функцтэйг хэрэглэгчийн эрхээр буцаана. «Манай сайт/систем юу агуулдаг вэ», «хаанаас … харах вэ» гэсэн асуултад ЭНЭ хэрэгслийг дуудна — санахуйгаас зохиохгүй.',
    descriptionEn: 'Describe the ERP web app: pages, sections and features visible to the caller.',
    kind: 'read',
    modes: ['client', 'employee', 'admin'],
    params: [
      { name: 'topic', type: 'string', required: false, description: 'Зөвхөн энэ сэдэвтэй хуудсыг (жишээ нь «ирц»).' },
    ],
  },

  get_employee_activity: {
    name: 'get_employee_activity',
    descriptionMn:
      'Ажилтнуудын сүүлийн N хоногийн ИДЭВХИЙН шинжилгээ — батлагдсан явцын бүртгэл, ирсэн өдөр, тайлан, засварын цагаар тооцсон оноо, эрэмбэтэй. Албан ёсны KPI БИШ: metric_definition-ийг хариултад заавал дурд.',
    descriptionEn: 'Transparent activity metric per employee over the last N days (not an official KPI).',
    kind: 'read',
    modes: ['employee', 'admin'],
    params: [
      { name: 'days', type: 'integer', required: false, description: 'Хэдэн хоногийн цонх (өгөгдмөл 30).', min: 1, max: 365 },
      { name: 'limit', type: 'integer', required: false, description: 'Эрэмбийн урт (өгөгдмөл 10).', min: 1, max: 50 },
      { name: 'team_code', type: 'string', required: false, description: 'Зөвхөн энэ багийн код (BA, BB …).' },
    ],
    readsLiveErp: true,
  },

  analyze_project: {
    name: 'analyze_project',
    descriptionMn:
      'Нэг төслийн эрүүл мэндийн шинжилгээ: явц, дуусах хугацаа, хоцорсон/зогссон/эзэнгүй даалгавар, батлагдаагүй явц, сүүлийн хөдөлгөөн, багийн задаргаа. «Яагаад удаад байна», «хаана саатаж байна» гэсэн асуултад ЭНЭ хэрэгслийг дуудна. facts = баримт, signals = дүгнэлтийн санаа.',
    descriptionEn: 'Project health analysis: overdue/stale/unassigned tasks, pending approvals, recent activity, per-team breakdown.',
    kind: 'read',
    modes: ['employee', 'admin'],
    params: [
      { name: 'project_id', type: 'integer', required: true, description: 'Төслийн id.', min: 1 },
    ],
    readsLiveErp: true,
  },

  query_entities: {
    name: 'query_entities',
    descriptionMn:
      'Компанийн өгөгдлийн гарц — projects, tasks, employees, teams, progress_entries, attendance, asr_reports, meetings, repair_entries entity-г бүтэцтэй асуулгаар (entity, fields, filters, sort, limit, group_by, aggregate) авна. Урьдчилан бичээгүй асуултад ЭНЭ хэрэгслийг ашиглана. Хариу нь хэрэглэгчийн эрхээр шүүгдсэн.',
    descriptionEn: 'Structured, permission-filtered query over the company data gateway (no SQL).',
    kind: 'read',
    modes: ['client', 'employee', 'admin'],
    params: [
      { name: 'query', type: 'json', required: true, description: 'EntityQuery объект — { entity, fields?, filters?, sort?, limit?, group_by?, aggregate? }.' },
    ],
    readsLiveErp: true,
  },

  search_company_documents: {
    name: 'search_company_documents',
    descriptionMn:
      'Компанийн архивын баримтаас хайх. Үр дүн нь хэрэглэгчийн эрхээр ШҮҮГДСЭН байна.',
    descriptionEn: 'Search the company document archive, permission-filtered.',
    kind: 'read',
    modes: ['employee', 'admin'],
    params: [
      { name: 'query', type: 'string', required: true, description: 'Хайх утга.' },
      { name: 'top_k', type: 'integer', required: false, description: 'Мөрийн тоо.', min: 1, max: 20 },
    ],
  },
});

export type ToolName = keyof typeof TOOLS;

export function isKnownTool(name: unknown): name is string {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(TOOLS, name);
}

/** Тухайн горимд харагдах хэрэгслүүд.  `denied` нь ХООСОН авна. */
export function toolsForMode(mode: AiMode): ToolDef[] {
  if (mode === 'denied') return [];
  return Object.values(TOOLS).filter((t) => (t.modes as readonly string[]).includes(mode));
}

export type ValidationResult =
  | { ok: true; args: Record<string, string | number | boolean | object> }
  | { ok: false; error: string };

/**
 * ⚠️ АРГУМЕНТЫН ХАТУУ ШАЛГАЛТ.  Загварын гаргасан JSON нь дурын хэлбэртэй
 *    байж болно — нэмэлт талбар нь ЧИМЭЭГҮЙ ХАЯГДАНА (алдаа биш: загвар
 *    ихэвчлэн нэмэлт талбар зохиодог), харин ТӨРӨЛ буруу эсвэл заавал
 *    талбар дутуу бол алдаа.
 */
export function validateToolArgs(name: string, raw: unknown): ValidationResult {
  const def = TOOLS[name];
  if (!def) return { ok: false, error: `Танихгүй хэрэгсэл: ${name}` };

  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Record<string, string | number | boolean | object> = {};

  for (const p of def.params) {
    const v = input[p.name];
    if (v === undefined || v === null) {
      if (p.required) return { ok: false, error: `«${p.name}» шаардлагатай.` };
      continue;
    }

    if (p.type === 'string') {
      if (typeof v !== 'string') return { ok: false, error: `«${p.name}» нь текст байх ёстой.` };
      const s = v.trim();
      if (s.length === 0) {
        if (p.required) return { ok: false, error: `«${p.name}» хоосон байна.` };
        continue;
      }
      if (p.enum && !p.enum.includes(s)) {
        return { ok: false, error: `«${p.name}» нь ${p.enum.join(' | ')} байх ёстой.` };
      }
      out[p.name] = s.slice(0, 512);
      continue;
    }

    if (p.type === 'json') {
      // ⚠️ Бүтцийг ХЭРЭГСЭЛ шалгана (`compileQuery`); энд зөвхөн объект/массив мөн эсэх.
      if (typeof v !== 'object') return { ok: false, error: `«${p.name}» нь объект байх ёстой.` };
      out[p.name] = v as never;
      continue;
    }

    if (p.type === 'boolean') {
      if (typeof v !== 'boolean') return { ok: false, error: `«${p.name}» нь true/false байх ёстой.` };
      out[p.name] = v;
      continue;
    }

    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) return { ok: false, error: `«${p.name}» нь тоо байх ёстой.` };
    if (p.type === 'integer' && !Number.isInteger(n)) {
      return { ok: false, error: `«${p.name}» нь бүхэл тоо байх ёстой.` };
    }
    if (p.min !== undefined && n < p.min) return { ok: false, error: `«${p.name}» ≥ ${p.min} байна.` };
    if (p.max !== undefined && n > p.max) return { ok: false, error: `«${p.name}» ≤ ${p.max} байна.` };
    out[p.name] = n;
  }

  return { ok: true, args: out };
}
