/**
 * MGL AI · ЭЭЛЖИЙН ТӨЛӨВЛӨГӨӨ — `/plan` ба `/context`-ийн ХАМТЫН цөм.
 *
 * ⚠️ ЯАГААД НЭГ ФАЙЛ ВЭ.  `/plan` нь хэрэгслийн жагсаалт гаргадаг,
 *    `/context` нь prompt угсардаг — хоёулаа «энэ ээлж юу вэ» гэдгийг
 *    ИЖИЛ байдлаар тайлах ёстой.  Хоёр газар тус тусад нь бичвэл хосын
 *    зөрүү үүснэ (энэ репогийн хамгийн түгээмэл алдаа): `/plan` нь
 *    үргэлжлэл гэж үзээд төслийн хэрэгслийг дуудсан атлаа `/context` нь
 *    шинэ сэдэв гэж үзээд түүхийг хаях.  Тиймээс тайлал, хэрэгслийн
 *    төлөвлөгөө, нормын асуулт ГУРВУУЛАА энд, цэвэр функцээр.
 *
 * ⚠️ ЦЭВЭР — D1-гүй, тестлэгдэнэ.
 */
import { looksRegulatory } from './context';
import { isGeneralAecAdvice } from './intent';
import { decideDepth, type DepthDecision } from './depth';
import { detectLanguage, type LanguageDetection } from './lang';
import { planTools, type PlannedTool } from './toolPlan';
import { detectNormCatalogAsk, type NormCatalogAsk } from './normCatalog';
import { findProjectMention, interpretTurn, type TurnInterpretation, type TurnTask } from './turn';
import {
  CONV_STATE_VERSION,
  SUBJECT_TTL_TURNS,
  mergeProjectsSeen,
  parseConvState,
  projectsFromToolData,
  sameSubject,
  type ConvState,
  type ConvSubject,
  type NormTurnState,
  type SeenProject,
} from './convState';

export interface TurnPlan {
  turn: TurnInterpretation;
  state: ConvState;
  lang: LanguageDetection;
  /** Ээлжийн НИЙТ хатуу байдал — аль нэг даалгавар норм бол `true`. */
  regulatory: boolean;
  /** Нормын даалгавар (байвал) — локал `/norm`-д ЭНЭ текстийг өгнө. */
  normTask: TurnTask | null;
  /** Нормын даалгаврын 1-ээс эхэлсэн индекс — олон даалгавартай үед. */
  normTaskIndex: number | null;
  /** Локал нормын санг асуух эсэх. */
  askLocalNorm: boolean;
  /**
   * МЭДЛЭГИЙН САНГИЙН КАТАЛОГ (`normCatalog.ts`) — «чамд ямар норм байгаа вэ» / «X юуны тухай вэ».
   * Хөтөч runtime `POST /norm/catalog`-ыг дуудна; `/norm` хайлт ЭНЭ ээлжид асахгүй.
   */
  normCatalog: NormCatalogAsk | null;
  /** Гүйцэтгэх ERP хэрэгслүүд — бүх даалгаврын НЭГДЭЛ. */
  tools: PlannedTool[];
  /** D1-ийн текстэн хайлтад өгөх асуулт — нормын даалгавар байвал түүнийх. */
  searchQuestion: string;
  /**
   * ХАРИУЛТЫН ГҮН (`depth.ts`) — санамжгүй шийдвэр; `/context` хадгалсан
   * `answer_length` тохиргоотой дахин шийднэ (ил хүсэлт санамжаас дээгүүр).
   */
  depth: DepthDecision;
}

export interface TurnPlanInput {
  question: string;
  rawState: unknown;
  seq: number;
  lastAssistant?: string | null;
  /** Тухайн горимд харагдах хэрэгслийн нэрс. */
  visibleTools: readonly string[];
  /** Revit-д сонгосон элементийн тоо — `interpretTurn.revitSelection` (R3.5). */
  revitSelection?: number;
  /** Add-in детерминист тайлангийн нотолгоо хавсаргасан эсэх — тайлангийн асуулт REVIT_READ (R3.5). */
  revitReport?: boolean;
}

/** Хэрэгслийн нэрийг давхардуулахгүйгээр нэмнэ. */
function addTool(list: PlannedTool[], t: PlannedTool): void {
  if (!list.some((x) => x.name === t.name)) list.push(t);
}

export function planTurn(input: TurnPlanInput): TurnPlan {
  const state = parseConvState(input.rawState);
  const turn = interpretTurn({
    question: input.question,
    state,
    seq: input.seq,
    lastAssistant: input.lastAssistant ?? null,
    revitSelection: input.revitSelection,
    revitReport: input.revitReport,
  });
  const lang = detectLanguage(input.question);

  // Даалгавар бүрийн хатуу байдал — `looksRegulatory` (түлхүүр үг) ЭСВЭЛ
  // санааны бодлого.  Аль нэг нь ажиллахад хатуу горим асна.
  const taskRegulatory = turn.tasks.map((t) => {
    // Intent has explicit GENERAL_HELP exceptions for qualitative AEC
    // coordination/compliance process advice. Raw regulatory-looking words
    // must not silently undo that decision.
    if (t.intent === 'GENERAL_HELP' && isGeneralAecAdvice(t.text)) return false;
    return looksRegulatory(t.text) || t.policy.evidenceMandatory;
  });
  const normIdx = taskRegulatory.findIndex((r) => r);
  const normTask = normIdx >= 0 ? turn.tasks[normIdx]! : null;
  const regulatory = normIdx >= 0;

  // ── Хэрэгслүүд — даалгавар бүрээс, нэгтгээд ────────────────────
  const tools: PlannedTool[] = [];
  const seen = new Set(input.visibleTools);
  for (const t of turn.tasks) {
    // ⚠️ Нормын даалгаварт ERP хэрэгсэл ДУУДАХГҮЙ — «В2-ийн галын
    //    ачаалал» гэсэн асуултад «ачаалал» гэж `get_active_employees`
    //    орж ирэх нь яг тэр холилдол.
    if (t.domain === 'norm') continue;
    // ERP planner is a live-company-data planner, not a generic keyword retriever.
    // GENERAL_HELP may contain words such as «төсөл», «deadline», «хана» while
    // discussing design practice; those must never summon ERP context.
    if (!t.policy.needsErpTools) continue;
    // ⚠️ `text`, `resolvedText` БИШ — «(төсөл: A)» гэсэн залгаас нь
    //    «төсөл» түлхүүр үгээр `list_projects` (50 мөр) дуудуулна; сэдвийн
    //    төслийг доор ИЛ хэрэгслээр авна.
    for (const p of planTools(t.text, input.visibleTools)) addTool(tools, p);
  }

  // ── Үргэлжлэл дээр ТӨСЛИЙН хэрэгслийг ил нэмнэ ─────────────────
  // ⚠️ «яагаад удаад байна?» гэсэн асуултад түлхүүр үг байхгүй тул
  //    `planTools` юу ч олохгүй; сэдэв нь төсөл бол тэр төслийн явцыг
  //    ШИНЭЭР татна — өмнөх ээлжийн тоог prompt-оос давтахгүй (§28).
  const followUpLike =
    turn.kind === 'FOLLOW_UP' ||
    turn.kind === 'CORRECTION' ||
    turn.kind === 'REFERENCE_TO_PRIOR_RESULT' ||
    turn.kind === 'CLARIFICATION' ||
    turn.kind === 'CONTINUATION';
  for (const t of turn.tasks) {
    if (t.subject?.kind !== 'project' || t.domain !== 'erp') continue;
    // ⚠️ «Яагаад удаад байна» = ШИНЖИЛГЭЭ → `analyze_project` (хоцорсон,
    //    зогссон, хариуцагчгүй даалгавар, батлагдаагүй явц — бүгд СЕРВЕР
    //    тоолсон).  Зөвхөн явцын хувь өгвөл загвар шалтгааныг ЗОХИОДОГ
    //    байв (хэмжсэн 2026-09-10: «үнэн зөв хөдөлж байна» гэх мэт).
    if (t.intent === 'ERP_ANALYSIS' && seen.has('analyze_project')) {
      addTool(tools, { name: 'analyze_project', args: { project_id: t.subject.id } });
    } else if (seen.has('get_project_progress')) {
      addTool(tools, { name: 'get_project_progress', args: { project_id: t.subject.id } });
    }
  }
  // Сэдэв байхгүй ERP үргэлжлэл («тэгвэл хоцорсон нь?») — өмнөх ээлжийн
  // хэрэгслийг ДАХИН ажиллуулна: өгөгдөл шинэ, prompt дахь хуучин тоо биш.
  if (followUpLike && tools.length === 0 && turn.tasks.some((t) => t.domain === 'erp')) {
    for (const name of state.lastTools) {
      if (seen.has(name) && name !== 'get_project_progress') addTool(tools, { name, args: {} });
    }
    // `get_project_progress` нь аргументтай — сэдэв төсөл байвал л дуудна.
    if (state.subject?.kind === 'project' && state.lastTools.includes('get_project_progress')) {
      addTool(tools, { name: 'get_project_progress', args: { project_id: state.subject.id } });
    }
  }

  // ⚠️ Сэдэв нь ТОДОРХОЙ төсөл байхад «төсөл» түлхүүр үгээр орж ирсэн
  //    `list_projects` (50 мөр) нь дуу чимээ — төслийн хэрэгсэл байвал хасна.
  const projectSpecific = tools.some((t) => t.name === 'analyze_project' || t.name === 'get_project_progress');
  const pruned = projectSpecific ? tools.filter((t) => t.name !== 'list_projects') : tools;

  // Каталогийн асуулт (META) — нормын даалгавар үүсэхгүй тул `askLocalNorm` аль хэдийн false;
  //    олон даалгавартай мессежид ч ганц каталогийн асуулт л таних (эхнийх нь).
  const normCatalog = turn.tasks.length === 1 ? detectNormCatalogAsk(input.question) : (turn.tasks.map((t) => detectNormCatalogAsk(t.text)).find((a) => a !== null) ?? null);
  const askLocalNorm = normTask !== null && normTask.policy.needsRetrieval;

  const depth = decideDepth({ question: input.question, intent: turn.intent, taskCount: turn.tasks.length, regulatory, catalog: normCatalog?.kind ?? null });

  return {
    turn,
    state,
    lang,
    regulatory,
    depth,
    normTask,
    normTaskIndex: normIdx >= 0 ? normIdx + 1 : null,
    askLocalNorm,
    normCatalog,
    tools: pruned.slice(0, 4),
    searchQuestion: normTask ? normTask.text : turn.tasks[0]?.resolvedText ?? input.question,
  };
}

/**
 * НОРМ-ЗӨВХӨН ээлж — бүх даалгавар нормын (NORM-INTEL v3, 2026-10-04).  Ийм ээлжид ERP-ийн төсөл/ажилтан/хугацаа,
 * Revit-ийн view/family/parameter контекст prompt-д ХЭЗЭЭ Ч орохгүй: «Firefighter lift-д ямар шаардлага тавигддаг вэ?»
 * гэсэн хариултад төслийн deadline, ажилтны ачаалал, Revit view гарч байсан (хэмжсэн 2026-10-04).  Тусдаа ERP/Revit
 * даалгавартай олон даалгаварт мессеж энд `false` — тэр даалгавар өөрийн хэрэгслээ авна.
 */
export function isNormOnlyTurn(turn: Pick<TurnInterpretation, 'tasks'>): boolean {
  return turn.tasks.length > 0 && turn.tasks.every((t) => t.domain === 'norm');
}

/** UI, оношилгоонд буцаах ээлжийн товч хэлбэр. */
export function turnSummary(turn: TurnInterpretation) {
  return {
    kind: turn.kind,
    reason: turn.reason,
    subject: turn.subject,
    history_messages: turn.historyMessages,
    tasks: turn.tasks.map((t) => ({ text: t.text, intent: t.intent, domain: t.domain })),
  };
}

/* ================================================================== */
/*  Төлөв шинэчлэх — хэрэгсэл ажилласны ДАРАА                          */
/* ================================================================== */

export interface ToolResultLite {
  tool: string;
  ok: boolean;
  data: unknown;
}

/** «Аль нэг», «хамгийн» — ГАНЦ хариулт хүлээсэн асуулт эсэх. */
function expectsSingle(question: string): boolean {
  return /аль|хамгийн|ali\b|hamgiin|which|closest|nearest|most|first/iu.test(question);
}

/**
 * Ээлжийн дараах ярианы төлөв.
 *
 * ⚠️ СЭДВИЙН ЭХ СУРВАЛЖ, дарааллаар:
 *    1. Тайлагчийн шийдсэн сэдэв (нэрлэсэн / өвлөсөн / засварласан).
 *    2. `get_project_progress` ажилласан бол ТЭР төсөл.
 *    3. Ганц хариулт хүлээсэн асуултад `get_upcoming_deadlines`-ийн
 *       ЭХНИЙ төсөл — «хамгийн ойр deadline-тай төсөл аль вэ?» гэсний
 *       хариу нь яг тэр, дараагийн «яагаад?» түүнийг заана.
 *    Жагсаалт асуусан бол («бүх төсөл») сэдэв ТОГТООХГҮЙ — олон юмны
 *    дундаас нэгийг таамаглах нь буруу үргэлжлэлээс дор.
 *
 * ⚠️ ШИНЭ СЭДЭВ хуучин сэдвийг УСТГАНА — нормын асуултын дараа төсөл
 *    «санагдаж» үлдэхгүй.  Гэхдээ `projectsSeen` ҮЛДЭНЭ: «үгүй ээ, B-г
 *    хэлсэн» гэсэн засварт нэр таних жагсаалт хэрэгтэй.
 */
export function advanceState(input: {
  state: ConvState;
  turn: TurnInterpretation;
  toolResults: readonly ToolResultLite[];
  seq: number;
  question: string;
  /** Нормын ээлжийн төлөв (P0-13) — `/context` хөдөлгүүрийн үр дүнгээс бичнэ; `undefined` = хэвээр үлдээ. */
  norm?: NormTurnState | null;
}): ConvState {
  const { state, turn, toolResults, seq } = input;

  let seenNew: SeenProject[] = [];
  for (const r of toolResults) {
    if (!r.ok) continue;
    seenNew = seenNew.concat(projectsFromToolData(r.tool, r.data));
  }
  const projectsSeen = mergeProjectsSeen(state.projectsSeen, seenNew);

  let subject: ConvSubject | null = turn.subject;
  let subjectSetAtSeq = subject === null ? -1 : seq;
  if (subject !== null && turn.kind !== 'NEW_TOPIC' && turn.kind !== 'CORRECTION' && sameSubject(subject, state.subject)) {
    // Өвлөсөн сэдэв — хугацааг ШИНЭЧИЛНЭ (идэвхтэй хэрэглэж байгаа).
    subjectSetAtSeq = seq;
  }
  // ⚠️ МЭНДЧИЛГЭЭ / МЕТА нь сэдвийг ХӨНДӨХГҮЙ (Session C): «Баярлалаа» гэсний
  //    дараа «яагаад удаад байна?» нь өмнөх төслөө заасаар байх ёстой.  Сэдэв
  //    хэвээр, гэвч хугацаа ШИНЭЧЛЭГДЭХГҮЙ — TTL нь ердийнхөөрөө унтраана.
  const social = turn.intent === 'CASUAL' || turn.intent === 'META';
  if (subject === null && social && state.subject !== null) {
    subject = state.subject;
    subjectSetAtSeq = state.subjectSetAtSeq;
  }
  // ⚠️ ХЭРЭГЛЭГЧ ТӨСЛИЙГ НЭРЭЭР НЬ АНХ УДАА ДУРДСАН (Session C): тайлагч
  //    `projectsSeen`-д байхгүй нэрийг таньж чадахгүй, харин хэрэгслийн үр дүн
  //    түүнийг ОДОО авчирсан — «Хан-Уул сургууль төслийн deadline?» → «Хариуцсан
  //    хүн нь?» гэсэн үргэлжлэл өмнө нь сэдэвгүй үлдэж байв.
  if (subject === null && !social && turn.kind !== 'MULTI_INTENT') {
    const named = findProjectMention(input.question, projectsSeen);
    if (named) {
      subject = { kind: 'project', id: named.id, name: named.name };
      subjectSetAtSeq = seq;
    }
  }
  if (subject === null) {
    const prog = toolResults.find(
      (r) => r.ok && (r.tool === 'get_project_progress' || r.tool === 'analyze_project'),
    );
    const fromProg = prog ? projectsFromToolData(prog.tool, prog.data)[0] : undefined;
    if (fromProg) {
      subject = { kind: 'project', id: fromProg.id, name: fromProg.name };
      subjectSetAtSeq = seq;
    } else if (expectsSingle(input.question)) {
      const dl = toolResults.find((r) => r.ok && r.tool === 'get_upcoming_deadlines');
      const first = dl ? projectsFromToolData(dl.tool, dl.data)[0] : undefined;
      if (first) {
        subject = { kind: 'project', id: first.id, name: first.name };
        subjectSetAtSeq = seq;
      }
    }
  }
  // Нормын ээлж нь төслийн сэдвийг ЦЭВЭРЛЭНЭ — гоожилтын хоёр дахь хаалга.
  if (subject === null && turn.kind === 'NEW_TOPIC') subjectSetAtSeq = -1;

  // ⚠️ Нормын төлөв: шинэ үр дүн бол солино; нормын бус ШИНЭ СЭДЭВ бол устгана;
  //    үргэлжлэл бол хэвээр (TTL нь `SUBJECT_TTL_TURNS`-тэй ижил).
  // ⚠️ Нормын төлөв нь НОРМЫН БУС ээлжийг (ERP асуулт) ДАВЖ амьдарна — «g=1800 → В2»,
  //    «хэдэн төсөл?», «Q=50000, H=6» гэсэн дараалалд гурав дахь нь эхнийхийн үргэлжлэл
  //    (хэмжсэн GOLD multi-turn M3).  Зөвхөн TTL-ээр хуучирна; ШИНЭ нормын сэдэв бол
  //    `normTurnStateFrom` ЦЭВЭР төлөв өгнө (өмнөх Q/H өвлөгдөхгүй).
  let norm: NormTurnState | null = input.norm === undefined ? state.norm : input.norm;
  if (norm !== null && input.norm === undefined && seq - norm.setAtSeq > SUBJECT_TTL_TURNS) norm = null;

  return {
    version: CONV_STATE_VERSION,
    subject,
    subjectSetAtSeq,
    lastIntent: turn.intent,
    lastTools: toolResults.filter((r) => r.ok).map((r) => r.tool).slice(0, 8),
    lastQuestion: input.question.slice(0, 300),
    lastSeq: seq,
    projectsSeen,
    norm,
  };
}
