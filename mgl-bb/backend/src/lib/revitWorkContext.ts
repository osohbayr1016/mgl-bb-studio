/**
 * «MGL ажил» самбарын (Revit work tracking MVP, 2026-09-29) КОНТЕКСТЫН ЦЭВЭР дүрэм.
 *
 * `GET /api/revit/work-context` нь нээлттэй .rvt файлаас ажилтны ОДООГИЙН таск
 * хүртэлх гинжийг шийднэ:  файл → бүртгэлтэй төсөл → миний НЭЭЛТТЭЙ таскууд.
 * Энд D1, Hono байхгүй — `revitWorkContext.test.ts` шууд ачаална.
 *
 * ⚠️ ТӨСЛИЙГ ТААХГҮЙ.  Файлын ↔ төслийн ЦОРЫН ГАНЦ баталгаа нь хэрэглэгчийн
 *    ил үйлдлээр үүссэн бүртгэл (`revit_documents`, `POST /handshake`).
 *    `MGL-yymmdd` код, «миний таскууд» нь зөвхөн САНАЛ — самбар тэднийг
 *    сонголт болгож харуулна, хэзээ ч өөрөө сонгохгүй.
 * ⚠️ `doc_uid` нь ГЛОБАЛ өвөрмөц БИШ (0187 — нэг .rte template-ээс үүссэн
 *    төслүүд ижил `ProjectInformation.UniqueId`-тай байж болно).  Нэг uid олон
 *    төсөлд бүртгэгдсэн үед ТААМАГЛАХГҮЙ: сануулга (`hint`) эсвэл «ганц
 *    төсөл дээр л миний таск байна» гэсэн ил нотолгоо, эс бөгөөс хэрэглэгч сонгоно.
 */

export interface WorkRegistration {
  revit_document_id: number;
  project_id: number;
  project_name: string;
  project_status: string | null;
}

/**
 * Бүртгэлийг юугаар сонгосон бэ:
 *   `hint`     — клиентийн санасан төсөл (хэрэглэгч урьд нь ЭНЭ файл дээр сонгосон)
 *   `single`   — uid ганц төсөлд л бүртгэлтэй
 *   `my_tasks` — олон бүртгэлийн ГАНЦ нь дээр л миний нээлттэй таск бий
 * ⚠️ Самбар таскийг АВТОМАТААР сонгох нь зөвхөн `hint` / `single` үед
 *    (баталгаатай төсөл); `my_tasks` бол дүгнэлт тул таск сонголтыг хүнд үлдээнэ.
 */
export type RegistrationSource = 'hint' | 'single' | 'my_tasks';

export interface RegistrationPick {
  registration: WorkRegistration | null;
  source: RegistrationSource | null;
  /** Олон бүртгэлтэй ба ялгах нотолгоогүй — хэрэглэгч сонгоно. */
  ambiguous: boolean;
}

export function pickRegistration(
  regs: readonly WorkRegistration[],
  hintProjectId: number | null,
  projectsWithOpenTasks: ReadonlySet<number>,
): RegistrationPick {
  if (regs.length === 0) return { registration: null, source: null, ambiguous: false };
  if (hintProjectId != null) {
    const hit = regs.find((r) => r.project_id === hintProjectId);
    if (hit) return { registration: hit, source: 'hint', ambiguous: false };
  }
  if (regs.length === 1) return { registration: regs[0]!, source: 'single', ambiguous: false };
  const mine = regs.filter((r) => projectsWithOpenTasks.has(r.project_id));
  if (mine.length === 1) return { registration: mine[0]!, source: 'my_tasks', ambiguous: false };
  return { registration: null, source: null, ambiguous: true };
}

/**
 * Компанийн төслийн код — «MGL-251006».  Revit-ийн файлын нэр, ProjectInformation
 * дээр `MGL_251006`, `mgl 251006`, `MGL251006` хэлбэрээр ч бичигддэг тул
 * add-in-ий `ProjectLinkPolicy.CodeRx`-тэй ИЖИЛ сул хэв маяг; буцаах утга нь
 * `lib/mainProjects.ts` `parseProjectName`-ийн хэвийн хэлбэр («MGL-dddddd»).
 */
const MGL_CODE_RE = /MGL[-_ ]?(\d{6})/i;

export function mglCodeIn(...texts: ReadonlyArray<string | null | undefined>): string | null {
  for (const t of texts) {
    if (!t) continue;
    const m = MGL_CODE_RE.exec(t);
    if (m) return `MGL-${m[1]}`;
  }
  return null;
}

export interface ProjectCandidate {
  project_id: number;
  project_name: string;
  /** Тухайн хэрэглэгчийн энэ төсөл дээрх НЭЭЛТТЭЙ таскийн тоо. */
  open_tasks: number;
  /** Төслийн нэрний код (`parseProjectName(name).code`) — байхгүй бол null. */
  code: string | null;
}

export interface ProjectSuggestion {
  project_id: number;
  project_name: string;
  /** `code` — файлын код таарсан; `my_tasks` — надад нээлттэй таск бий. */
  reason: 'code' | 'my_tasks';
  open_tasks: number;
}

/** Нэг хариунд буцаах саналын дээд тоо — самбарын жагсаалт богино байх ёстой. */
export const MAX_SUGGESTIONS = 12;

/**
 * Бүртгэлгүй файлд санал болгох төслүүд.  Эрэмбэ: код таарсан нь эхэнд (тэдний
 * дотор миний таск олонтой нь), дараа нь миний нээлттэй таск бүхий бусад төсөл.
 * Код ч, таск ч байхгүй төсөл ОРОХГҮЙ — бүх төслийн жагсаалт самбарт хэрэггүй
 * (ажилтан «бүх ERP таскийн сангаас хайх» ёсгүй, брифийн шаардлага).
 */
export function suggestProjects(
  docCode: string | null,
  candidates: readonly ProjectCandidate[],
  limit = MAX_SUGGESTIONS,
): ProjectSuggestion[] {
  const seen = new Set<number>();
  const byTasksThenName = (a: ProjectCandidate, b: ProjectCandidate) =>
    b.open_tasks - a.open_tasks || a.project_name.localeCompare(b.project_name) || a.project_id - b.project_id;

  const out: ProjectSuggestion[] = [];
  if (docCode) {
    const coded = candidates
      .filter((c) => c.code != null && c.code.toUpperCase() === docCode.toUpperCase())
      .sort(byTasksThenName);
    for (const c of coded) {
      if (seen.has(c.project_id)) continue;
      seen.add(c.project_id);
      out.push({ project_id: c.project_id, project_name: c.project_name, reason: 'code', open_tasks: c.open_tasks });
    }
  }
  const mine = candidates.filter((c) => c.open_tasks > 0).sort(byTasksThenName);
  for (const c of mine) {
    if (seen.has(c.project_id)) continue;
    seen.add(c.project_id);
    out.push({ project_id: c.project_id, project_name: c.project_name, reason: 'my_tasks', open_tasks: c.open_tasks });
  }
  return out.slice(0, Math.max(0, limit));
}

/**
 * Таск «нээлттэй» эсэх — самбарт сонгогдох боломжтой ажил.
 *   • хувиар явдаг (`tasks`) төсөлд: сүүлийн батлагдсан явц < 100
 *   • цагаар явдаг (`hours`, ZA) төсөлд: хувь бөглөгддөггүй тул ҮРГЭЛЖ нээлттэй
 *   • ажилтан «миний хэсэг дууссан» гэж тэмдэглэсэн (`task_self_done`) бол ХААЛТТАЙ
 *     — My Tasks-ийн «Хийгдэж буй» табтай ижил дүрэм.
 */
export function isOpenTask(t: {
  current_progress: number | null;
  progress_mode: string | null;
  self_done: boolean;
}): boolean {
  if (t.self_done) return false;
  if (t.progress_mode === 'hours') return true;
  return (t.current_progress ?? 0) < 100;
}
