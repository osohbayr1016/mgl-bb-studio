/**
 * MGL AI · СУДАЛГААНЫ ТӨЛӨВЛӨГЧ — ОЛОН ШАТЛАЛТ (§9, §13, §16).
 *
 * ⚠️ ЯАГААД ЭНЭ ФАЙЛ ОРШИН БАЙНА.  `toolPlan.ts` нь НЭГ шатлалтай: асуулт →
 *    түлхүүр үг → хэрэгсэл → дуус.  Тэр нь «хамгийн ойр deadline-тай төсөл
 *    яагаад удаад байна?» гэсэн асуултад deadline-ийн жагсаалтыг л аваад
 *    ЗОГСДОГ байв — тэр төслийн даалгавар, зогсолт, хариуцагчийг хэзээ ч
 *    шалгахгүй.  Мөн каталогт байгаа боловч түлхүүр үгээр таараагүй асуулт
 *    хоосон төлөвлөгөөтэй үлдэж, загвар санахуйгаас хариулдаг байв.
 *
 *    Одоо: ШАТ 0 = түлхүүр үг + КАТАЛОГИЙН ТАНИЛТ (entity discovery);
 *          ШАТ ≥1 = өмнөх үр дүнгээс хамаарсан ДАРААГИЙН алхам (deadline →
 *          тэр төслийн шинжилгээ; хоцролт → хамгийн муу 3 төслийн шинжилгээ);
 *          `done` = нэмэх зүйлгүй.
 *
 * ⚠️ САНАА (intent) НЬ ЗӨВХӨН ЗӨВЛӨМЖ, ХААЛГА БИШ (§9).  GENERAL_HELP
 *    гэж ангилагдсан ч каталогийн entity таарвал хэрэгсэл дуудна.
 *
 * ⚠️ ХЯЗГААР: ≤ 3 шат, нийт ≤ `maxTools` хэрэгсэл (профайлын
 *    `max_tool_iterations`, өгөгдмөл 8).  «Судал», «шинжил» гэсэн гүн
 *    судалгаанд ч энэ хязгаар хэвээр — гүйлт зогсолтгүй болохгүй.
 *
 * ⚠️ ЭРХ ЭНД ШИЙДЭГДЭХГҮЙ.  Төлөвлөгөө бол ХҮСЭЛТ; `/tool` бүр өөрийн
 *    хаалгатай.  Өмнөх үр дүнгээс авсан id-г ч тэр хаалга дахин шалгана.
 *
 * ⚠️ ЦЭВЭР ФУНКЦ — D1-гүй, тестлэгдэнэ (`researchPlan.test.ts`).
 */
import { normalizeLatinMongolian } from './lang';
import { classifyIntent, isGeneralAecAdvice } from './intent';
import { entitiesForMode, type EntityDef } from './gateway/entities';
import type { PlannedTool } from './toolPlan';
import type { TurnPlan } from './turnPlan';
import type { AiMode } from './identity';

export type ResearchDepth = 'fast' | 'normal' | 'analysis' | 'deep';

export interface PriorToolResult {
  tool: string;
  ok: boolean;
  data: unknown;
  args?: Record<string, unknown>;
}

export interface ResearchInput {
  question: string;
  plan: TurnPlan;
  mode: AiMode;
  visibleTools: readonly string[];
  round: number;
  prior: readonly PriorToolResult[];
  maxTools?: number;
}

export interface ResearchStep {
  tools: PlannedTool[];
  done: boolean;
  depth: ResearchDepth;
  reason: string;
  /** Каталогоос танигдсан entity-үүд (оношилгоо, UI). */
  entities: string[];
}

export const MAX_ROUNDS = 3;
const DEFAULT_MAX_TOOLS = 8;

function fold(q: string): string {
  const lower = q.toLowerCase();
  return `${lower} ${normalizeLatinMongolian(lower)}`;
}

const RE = {
  // ⚠️ «system» ГАНЦААРАА БИШ: «system dotor heden tusul baina» нь системийн
  //    БҮТЦИЙН асуулт биш, төслийн ТООЛОЛ.  Хэмжигдсэн: describe_system-ийн
  //    page_count=19-ийг загвар «19 төсөл» гэж уншсан.
  system: /(сайт|вэб ?сайт|website|web ?site|веб|хуудас|huudas|систем юу|system (what|contains?|has|does)|what (does|is) (the )?(system|site|app)|апп юу|цэс|menu|хаанаас хар|haanaas har|юу агуулд|aguuld|ямар функц|feature|ямар хэсэг|модуль)/u,
  // ⚠️ ASCII `` нь кирилл үсгийн хажууд ҮҮСДЭГГҮЙ (CLAUDE.md-ийн урхи) — зайгаар хүрээлнэ.
  anaphora: /(?:^|\s)(энэ|тэр|ene|ter|this|that|түүний|tuunii)(?:\s|$)/u,
  activity: /(идэвх|idevh|active|хамгийн их ажилла|бүтээмж|buteemj|productiv|хамгийн сайн ажилл|top (employee|worker)|хамгийн ажилсаг|most active)/u,
  count: /(хэдэн|хэд\b|heden|hed\b|how many|тоо\b|too\b|count|нийт|niit|total)/u,
  analytical: /(яагаад|yagaad|yagad|why|шалтгаан|shaltgaan|удааш|udaash|удаад|udaad|саата|saata|delay|late|bottleneck|хаана саат|асуудал|asuudal|problem|эрсдэл|risk)/u,
  deep: /(судал|sudal|шинжил|shinjil|research|analy[sz]|дүгнэлт|dugnelt|bottleneck|харьцуул|hartsuul|compare|тайлан гарга|report on)/u,
  overdueCompany: /(хоцор|hotsor|overdue|хэтэрс|heters|delayed|удааш|udaash|сунжир|saatal|саатал)/u,
  // ⚠️ «төслүүд» нь «төсөл» агуулдаггүй (эгшиг гээгдэнэ) — язгуураар.
  projectWord: /(төсл|төсөл|tusul|tosol|tusluud|project)/u,
  single: /(аль|хамгийн|ali\b|hamgiin|which|closest|nearest|most|first|эхний)/u,
  monthsWindow: /(сүүлийн|suuliin|last|past)\s+(\d{1,2})\s*(сар|sar|month|хоног|honog|day|долоо хоног|week)/u,
  employeeCount: /(ажилтан|ажилчид|ajiltan|employee|staff|хүн хүч)/u,
  who: /(?:^|\s)(хэн|hen|who|хэн хэн)(?:\s|\?|$)/u,
  whichTeam: /(аль баг|ali bag|which team|ямар баг|багаар|bagaar|by team)/u,
  /** Багийн код — латин 2–4 том үсэг («BA», «TSAH»). */
  teamCode: /(?:^|\s)([A-Z]{2,4})(?:\s|$|-)/,
};

function wordCount(text: string): number {
  return text.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0).length;
}

function has(list: readonly PlannedTool[], name: string): boolean {
  return list.some((t) => t.name === name);
}
function add(list: PlannedTool[], t: PlannedTool, seen: Set<string>, used: Set<string>): void {
  if (!seen.has(t.name)) return;
  // analyze_project нь өөр өөр төсөлд олон удаа болно — аргументаар ялгана;
  // бусад хэрэгсэл нэг шатанд нэг л удаа.
  if (t.name !== 'analyze_project' && has(list, t.name)) return;
  const key = `${t.name}:${JSON.stringify(t.args)}`;
  if (used.has(key)) return;
  used.add(key);
  list.push(t);
}
function remove(list: PlannedTool[], name: string): void {
  const i = list.findIndex((t) => t.name === name);
  if (i >= 0) list.splice(i, 1);
}

/** Асуултаас каталогийн entity-г таньна — түлхүүр үгийн ХАМРАЛТААР эрэмбэлнэ. */
export function discoverEntities(question: string, mode: AiMode): EntityDef[] {
  const hay = ` ${fold(question)} `;
  const hits: { e: EntityDef; score: number }[] = [];
  for (const e of entitiesForMode(mode)) {
    let score = 0;
    for (const k of e.keywords) if (hay.includes(k.toLowerCase())) score += k.length >= 5 ? 2 : 1;
    if (score > 0) hits.push({ e, score });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.map((h) => h.e);
}

/** Өмнөх хэрэгслийн үр дүнгээс төслийн id-г уншина (`convState`-ийн ижил хэлбэр). */
function projectIdsFrom(r: PriorToolResult): { id: number; name: string }[] {
  if (!r.ok || !r.data || typeof r.data !== 'object') return [];
  const d = r.data as Record<string, unknown>;
  const list = Array.isArray(d.projects) ? d.projects : Array.isArray(d.rows) && d.entity === 'projects' ? d.rows : null;
  const out: { id: number; name: string }[] = [];
  if (list) {
    for (const p of list.slice(0, 20)) {
      if (p && typeof p === 'object' && Number.isInteger((p as { id?: unknown }).id)) {
        out.push({ id: (p as { id: number }).id, name: String((p as { name?: unknown }).name ?? '') });
      }
    }
  } else if (Number.isInteger(d.id) && typeof d.name === 'string') {
    out.push({ id: d.id as number, name: d.name });
  } else if (d.project && typeof d.project === 'object' && Number.isInteger((d.project as { id?: unknown }).id)) {
    const p = d.project as { id: number; name?: string };
    out.push({ id: p.id, name: String(p.name ?? '') });
  }
  return out;
}

/** Хоцорсон даалгавраас төслүүдийг хоцролтын тоогоор эрэмбэлнэ. */
function projectsByOverdue(r: PriorToolResult): number[] {
  if (!r.ok || !r.data || typeof r.data !== 'object') return [];
  const d = r.data as Record<string, unknown>;
  const tasks = Array.isArray(d.tasks) ? d.tasks : [];
  const count = new Map<number, number>();
  for (const t of tasks) {
    const pid = (t as { project_id?: unknown }).project_id;
    if (Number.isInteger(pid)) count.set(pid as number, (count.get(pid as number) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

export function depthOf(question: string, plan: TurnPlan, toolCount: number): ResearchDepth {
  const hay = fold(question);
  const intent = plan.turn.intent;
  if (intent === 'CASUAL' || intent === 'META') return 'fast';
  if (RE.deep.test(hay) && plan.turn.tasks.some((t) => t.domain === 'erp' || t.domain === 'general')) return 'deep';
  if (intent === 'ERP_ANALYSIS' || RE.analytical.test(hay) || toolCount >= 3) return 'analysis';
  return 'normal';
}

/**
 * ⚠️ ГОЛ ФУНКЦ.  Тухайн шатанд ЯМАР хэрэгсэл дуудахыг шийднэ.
 */
export function planResearch(input: ResearchInput): ResearchStep {
  const { plan, question } = input;
  const seen = new Set(input.visibleTools);
  const used = new Set(input.prior.map((p) => `${p.tool}:${JSON.stringify(p.args ?? {})}`));
  // analyze_project/get_project_progress-ийн аргументгүй давхардлаас хамгаална.
  const usedNames = new Set(input.prior.map((p) => p.tool));
  const maxTools = input.maxTools ?? DEFAULT_MAX_TOOLS;
  const budgetLeft = Math.max(0, maxTools - input.prior.length);
  const hay = fold(question);
  // ERP-domain tasks always get company research. Generic GENERAL_HELP keeps
  // legacy catalog discovery (teams/pages/meetings), except AEC reasoning/advice:
  // words such as «төсөл» in design language must never pull live ERP rows.
  const hasErpTask = plan.turn.tasks.some((t) => t.domain === 'erp' && t.policy.needsErpTools);
  const hasGenericTask = plan.turn.tasks.some((t) => t.domain === 'general');
  const erpLike = hasErpTask || (hasGenericTask && !isGeneralAecAdvice(question));
  const subjectProject = plan.turn.subject?.kind === 'project' ? plan.turn.subject : null;
  const entities = erpLike ? discoverEntities(question, input.mode) : [];

  const finish = (tools: PlannedTool[], reason: string, forceDone = false): ResearchStep => {
    const trimmed = tools.slice(0, budgetLeft);
    const depth = depthOf(question, plan, input.prior.length + trimmed.length);
    return {
      tools: trimmed,
      done: forceDone || trimmed.length === 0 || input.round + 1 >= MAX_ROUNDS,
      depth,
      reason,
      entities: entities.map((e) => e.name),
    };
  };

  if (budgetLeft === 0) return finish([], 'хэрэгслийн төсөв дууссан', true);
  if (input.mode === 'denied') return finish([], 'хандах эрхгүй', true);

  // ⚠️ АСУУЛТЫН ӨӨРИЙН АНГИЛАЛ — тайлагчийн өвлүүлсэн санаа БИШ.  Хэмжигдсэн
  //    (2026-09-10): deadline асуултын дараа «Сайн уу», «Чи юу хийж чадах вэ»
  //    хүртэл FOLLOW_UP болж, `get_project_progress` чирээд BA багийн тухай
  //    хариулж байв.  Мэндчилгээ/мета нь ХЭЗЭЭ Ч хэрэгсэлгүй.
  const own = classifyIntent(question).intent;
  if (own === 'CASUAL' || own === 'META') return finish([], `${own.toLowerCase()} — хэрэгсэлгүй`, true);

  /* ── ШАТ 0 ─────────────────────────────────────────────────────── */
  if (input.round === 0) {
    const tools: PlannedTool[] = [];
    for (const t of plan.tools) add(tools, t, seen, used);
    const reasons: string[] = [];

    // ── СЭДВИЙН ҮЛДЭГДЭЛ ────────────────────────────────────────────
    // ⚠️ Өмнөх ээлжийн төсөл нь ЗӨВХӨН анафоратай («энэ», «яагаад?»), эсвэл
    //    нэрээр нь дурдсан, эсвэл өөр ямар ч entity-гүй богино асуултад
    //    үлдэнэ.  «BA багийн ажилтнууд хэн хэн бэ» гэсэн бие даасан асуултад
    //    өмнөх төслийн явц орж ирэх нь хариултыг бүхэлд нь буруу болгож байв.
    const subjName = subjectProject ? fold(subjectProject.name) : '';
    const mentionsSubject = subjName.length >= 4 && hay.includes(subjName.split(' ')[0]!);
    const otherEntity = entities.some((e) => e.name !== 'projects');
    const keepSubject =
      RE.anaphora.test(hay) || mentionsSubject || (!otherEntity && wordCount(question) <= 6 && !RE.count.test(hay));
    if (subjectProject && !keepSubject) {
      remove(tools, 'get_project_progress');
      remove(tools, 'analyze_project');
      reasons.push('сэдвийн үлдэгдлийг хасав');
    }

    // Норм л асуусан бол ERP хэрэгсэл огт хэрэггүй.
    if (!erpLike) return finish(tools, 'ERP биш — түлхүүр үгийн төлөвлөгөө хэвээр');

    // ТООЛОЛ — сэдвийн үлдэгдэл биш, ОЛОНЛОГИЙН асуулт.
    // ⚠️ «хамгийн ойр deadline?» → «хэдэн төсөл байна?» дараалалд тайлагч
    //    сэдвийг өвлүүлж `get_project_progress` (нэг төсөл) дуудаж, тоолох
    //    хэрэгсэл ОГТ ордоггүй байв (хэмжигдсэн: «19 төсөл» — хуудасны тоо).
    //    Анафорагүй тоолол = бүх олонлог.
    if (RE.count.test(hay) && !RE.anaphora.test(hay) && entities.length > 0) {
      const e = entities[0]!;
      if (e.name === 'projects') add(tools, { name: 'list_projects', args: { limit: 50 } }, seen, used);
      else if (e.name === 'employees') add(tools, { name: 'get_active_employees', args: {} }, seen, used);
      else add(tools, { name: 'query_entities', args: { query: { entity: e.name, aggregate: [{ fn: 'count' }] } } }, seen, used);
      remove(tools, 'get_project_progress');
      remove(tools, 'analyze_project');
      reasons.push(`тоолол → ${e.name}`);
    }

    // Систем / сайт.
    if (RE.system.test(hay) && !RE.employeeCount.test(hay)) {
      add(tools, { name: 'describe_system', args: {} }, seen, used);
      // «сайт юу агуулдаг» асуултад 50 төслийн жагсаалт, өмнөх сэдвийн төсөл нь чимээ.
      if (!RE.count.test(hay)) remove(tools, 'list_projects');
      if (!RE.anaphora.test(hay)) {
        remove(tools, 'get_project_progress');
        remove(tools, 'analyze_project');
      }
      reasons.push('систем/сайтын асуулт');
    }

    // Идэвх — ТОО биш, ЭРЭМБЭ.
    if (RE.activity.test(hay) && RE.employeeCount.test(hay)) {
      const m = RE.monthsWindow.exec(hay);
      let days = 30;
      if (m) {
        const n = Number(m[2]);
        days = /сар|sar|month/.test(m[3]!) ? n * 30 : /долоо|week/.test(m[3]!) ? n * 7 : n;
      }
      add(tools, { name: 'get_employee_activity', args: { days, limit: 10 } }, seen, used);
      if (!RE.count.test(hay)) remove(tools, 'get_active_employees');
      reasons.push('идэвхийн шинжилгээ');
    }

    // Сэдэвтэй төслийн шинжилгээ («яагаад удаад байна»).
    if (subjectProject && keepSubject && (plan.turn.intent === 'ERP_ANALYSIS' || RE.analytical.test(hay))) {
      add(tools, { name: 'analyze_project', args: { project_id: subjectProject.id } }, seen, used);
      remove(tools, 'list_projects');
      reasons.push('сэдэвтэй төслийн шинжилгээ');
    }

    // «ХЭН хоцордог» = хүний ИРЦИЙН хоцролт, төслийн хугацаа биш.
    // ⚠️ Хэмжигдсэн: `get_overdue_tasks` 0 мөр буцаахад (продод due_date-тэй
    //    даалгавар ердөө 2) загвар төслийн жагсаалтаас «22 ажилтантай төсөл
    //    хамгийн их хоцордог» гэж зохиосон.
    if (RE.who.test(` ${hay} `) && RE.overdueCompany.test(hay) && seen.has('query_entities') && entitiesForMode(input.mode).some((e) => e.name === 'attendance')) {
      const m = RE.monthsWindow.exec(hay);
      const days = m ? Number(m[2]) * (/сар|sar|month/.test(m[3]!) ? 30 : /долоо|week/.test(m[3]!) ? 7 : 1) : 30;
      add(
        tools,
        {
          name: 'query_entities',
          args: {
            query: {
              entity: 'attendance',
              filters: [{ field: 'date', op: 'gte', value: `today-${days}` }, { field: 'late_minutes', op: 'gt', value: 0 }],
              group_by: 'user_name',
              aggregate: [{ fn: 'count' }, { fn: 'sum', field: 'late_minutes' }],
              sort: { field: 'sum_late_minutes', dir: 'desc' },
              limit: 10,
            },
          },
        },
        seen,
        used,
      );
      remove(tools, 'get_overdue_tasks');
      remove(tools, 'list_projects');
      remove(tools, 'get_project_progress');
      return finish(tools, 'хэн хоцордог → ирцийн хоцролт хүнээр');
    }

    // Компани даяарх хоцролт / удаашрал — сэдэвгүй.
    if ((!subjectProject || !keepSubject) && (RE.overdueCompany.test(hay) || (RE.analytical.test(hay) && RE.projectWord.test(hay)))) {
      add(tools, { name: 'get_overdue_tasks', args: { scope: 'all', limit: 50 } }, seen, used);
      add(
        tools,
        {
          name: 'query_entities',
          args: {
            query: {
              entity: 'projects',
              fields: ['id', 'name', 'status', 'progress', 'finish_date', 'days_remaining', 'member_count'],
              filters: [{ field: 'status', op: 'eq', value: 'active' }],
              sort: { field: 'days_remaining', dir: 'asc' },
              limit: 15,
            },
          },
        },
        seen,
        used,
      );
      remove(tools, 'list_projects');
      reasons.push('компани даяарх хоцролт');
    }

    // ⚠️ БАГИЙН КОД + ажилтны түлхүүр үг («BA багийн ажилтнууд»): `toolPlan`-ы
    //    `get_active_employees` (бүх ажилтан) нь багаар шүүсэн каталогийн
    //    асуулгаас ДОР — түүнийг хасаж, доорх каталогийн замаар багийн шүүлт
    //    авна (Session C: морфологийн язгуур нэмэгдэхэд энэ зам алдагдаж байв).
    const teamCodeEarly = RE.teamCode.exec(question)?.[1] ?? null;
    if (teamCodeEarly && has(tools, 'get_active_employees') && tools.length === 1 && entities.some((x) => x.name === 'employees')) {
      remove(tools, 'get_active_employees');
    }

    // Каталогийн танилт — түлхүүр үгийн хэрэгсэл юу ч олоогүй бол.
    if (tools.length === 0 && entities.length > 0) {
      // «хэн» + явц/ирц → хүнээр бүлэглэсэн тоолол; «BA багийн …» → багийн шүүлт.
      const wantsWho = RE.who.test(` ${hay} `);
      const teamCode = teamCodeEarly;
      let e = entities[0]!;
      if (wantsWho && entities.some((x) => x.name === 'progress_entries' || x.name === 'attendance')) {
        e = entities.find((x) => x.name === 'progress_entries' || x.name === 'attendance')!;
      } else if (teamCode && entities.some((x) => x.name === 'employees')) {
        e = entities.find((x) => x.name === 'employees')!;
      }
      const q: Record<string, unknown> = { entity: e.name, limit: 20 };
      const filters: { field: string; op: string; value: unknown }[] = [];
      if (e.name === 'employees') filters.push({ field: 'status', op: 'eq', value: 'active' });
      if (e.name === 'progress_entries' || e.name === 'attendance') {
        const m = RE.monthsWindow.exec(hay);
        const days = m ? Number(m[2]) * (/сар|sar|month/.test(m[3]!) ? 30 : /долоо|week/.test(m[3]!) ? 7 : 1) : 30;
        filters.push({ field: 'date', op: 'gte', value: `today-${days}` });
        if (e.name === 'progress_entries') filters.push({ field: 'status', op: 'eq', value: 'approved' });
      }
      if (teamCode && e.fields.some((f) => f.name === 'team_code')) filters.push({ field: 'team_code', op: 'eq', value: teamCode });
      if (filters.length > 0) q.filters = filters;
      if (wantsWho && e.fields.some((f) => f.name === 'user_name')) {
        q.group_by = 'user_name';
        q.aggregate = [{ fn: 'count' }];
        q.sort = { field: 'count', dir: 'desc' };
      } else if (RE.whichTeam.test(hay) && e.fields.some((f) => f.name === 'team_code')) {
        q.group_by = 'team_code';
        q.aggregate = [{ fn: 'count' }];
      } else if (RE.count.test(hay)) {
        q.aggregate = [{ fn: 'count' }];
      }
      add(tools, { name: 'query_entities', args: { query: q } }, seen, used);
      reasons.push(`каталогийн танилт → ${e.name}`);
    }

    return finish(tools, reasons.length > 0 ? reasons.join('; ') : 'түлхүүр үгийн төлөвлөгөө');
  }

  /* ── ШАТ ≥ 1 — өмнөх үр дүнгээс хамаарна ───────────────────────── */
  const tools: PlannedTool[] = [];
  const analytical = plan.turn.intent === 'ERP_ANALYSIS' || RE.analytical.test(hay);
  const deep = RE.deep.test(hay);
  const analyzed = new Set(
    input.prior.filter((p) => p.tool === 'analyze_project').map((p) => Number(p.args?.project_id)),
  );

  // 1. Deadline-ийн ГАНЦ хариулт + «яагаад» → тэр төслийн шинжилгээ.
  if (analytical && RE.single.test(hay)) {
    const dl = input.prior.find((p) => p.tool === 'get_upcoming_deadlines' && p.ok);
    const first = dl ? projectIdsFrom(dl)[0] : undefined;
    if (first && !analyzed.has(first.id)) {
      add(tools, { name: 'analyze_project', args: { project_id: first.id } }, seen, used);
      return finish(tools, `deadline-ийн эхний төсөл (${first.name}) → шинжилгээ`);
    }
  }

  // 2. Явц татсан боловч шинжлээгүй сэдэвтэй төсөл.
  if (analytical) {
    const prog = input.prior.find((p) => p.tool === 'get_project_progress' && p.ok);
    const p = prog ? projectIdsFrom(prog)[0] : undefined;
    if (p && !analyzed.has(p.id)) {
      add(tools, { name: 'analyze_project', args: { project_id: p.id } }, seen, used);
      return finish(tools, `явцтай төсөл (${p.name}) → шинжилгээ`);
    }
  }

  // 3. Гүн судалгаа — хамгийн муу 3 төслийг шинжилнэ.
  if (deep || (analytical && !subjectProject)) {
    const ov = input.prior.find((p) => p.tool === 'get_overdue_tasks' && p.ok);
    let ids = ov ? projectsByOverdue(ov) : [];
    if (ids.length === 0) {
      const qe = input.prior.find((p) => p.tool === 'query_entities' && p.ok && (p.data as { entity?: string })?.entity === 'projects');
      ids = qe ? projectIdsFrom(qe).map((x) => x.id) : [];
    }
    const pick = ids.filter((id) => !analyzed.has(id)).slice(0, 3);
    for (const id of pick) add(tools, { name: 'analyze_project', args: { project_id: id } }, seen, used);
    if (tools.length > 0) return finish(tools, `гүн судалгаа → ${pick.length} төслийн шинжилгээ`);
  }

  // 4. Каталогийн асуулга шүүлттэй атлаа хоосон буцсан → шүүлтгүй нэг удаа.
  const empty = input.prior.find(
    (p) =>
      p.tool === 'query_entities' &&
      p.ok &&
      (p.data as { returned?: number })?.returned === 0 &&
      Array.isArray((p.args?.query as { filters?: unknown[] })?.filters) &&
      ((p.args?.query as { filters: unknown[] }).filters.length > 0),
  );
  if (empty && !usedNames.has('__retry_unfiltered')) {
    const q = { ...(empty.args?.query as Record<string, unknown>) };
    delete q.filters;
    // ⚠️ Тугийг query ДОТОР — `validateToolArgs` нь танихгүй дээд түвшний
    //    талбарыг хаядаг тул гүйцэтгэгч үүнийг өөр замаар харахгүй.  Хэрэгсэл
    //    нь үр дүндээ «шүүлтгүй, бүх хугацаа» гэж тэмдэглэнэ — загвар «сүүлийн
    //    30 хоногт» гэж худал хэлэхгүй.
    q.unfiltered_retry = true;
    add(tools, { name: 'query_entities', args: { query: q } }, seen, used);
    if (tools.length > 0) return finish(tools, 'шүүлттэй асуулга хоосон → шүүлтгүй дахин', true);
  }

  return finish([], 'нэмэх хэрэгсэлгүй', true);
}
