import { Hono } from 'hono';
import { ROOT_PROTECTED_MESSAGE, protectedRootsIn, purgeRootsForProject } from '../lib/taskRootGuard';
import { guardClientProject } from '../lib/clientAccess';
import { launchBrowser, type BrowserSession } from '../lib/browser';
import { requireAdmin, requireManager, requireRole } from '../middleware/auth';
import { upsertSetting } from '../lib/settings';
import { withEdgeCache } from '../lib/edgeCache';
import { deleteReplacedMediaAll } from '../lib/mediaReplace';
import { signToken } from '../lib/jwt';
import { getManifest, mapStatus } from '../lib/aps';
import { isSingleSegmentMediaUrl } from '../lib/mediaUrl';
import { resolveMapsShortLink } from '../lib/mapsLinkResolve';
import { summarizeTeamNotes, TEAM_NOTE_QUESTIONS } from '../lib/teamNotesAi';
import { recalculateProjectPoints } from './progress';
import {
  getCategoryTeamShares,
  isProjectCategory,
  PROJECT_CATEGORY_CODES,
} from '../lib/projectCategories';
import { NOT_ASR_ONLY_SQL } from '../lib/asrEligible';
import { hideArchivedRows } from '../lib/archivedProjects';
import { latestApprovedPctByCreatedAt } from '../lib/progressLatest';
import {
  defaultProgressMode,
  projectProgressSql,
  hoursProgressOf,
} from '../lib/repairProgress';
import { rearmHoursBackfill } from '../lib/repairDayStore';
import { parseClientName, planClientNameSync } from '../lib/passportClient';
/* Ангиллын ЗАГВАР төсөл (2026-10-06, эзэн: «EZ төсөл үүсгэхэд төсөл 75-ын
 * бүтэц, хуваарилалт автоматаар»). */
import {
  applyCategoryTemplate,
  categoryTemplateKey,
  CATEGORY_TEMPLATE_PREFIX,
  loadCategoryTemplates,
  planTemplateCopy,
  resolveCategoryTemplate,
  type TemplateApplyResult,
} from '../lib/categoryTemplates';
/* Төслүүд хуудасны өгөгдмөл «идэвхээр» эрэмбэ (2026-09-18) — тусдаа асуулга,
 * `PROJECT_LIST_SQL`-ийн байрлалт bind-ийг хөнддөггүй. */
import {
  activityWindowStart,
  buildProjectActivity,
  emptyProjectActivity,
  PROJECT_ACTIVITY_SQL,
  type ProjectActivity,
  type ProjectActivityRow,
} from '../lib/projectActivity';
import { todayInUB } from '../lib/time';
import {
  extensionRequiredBody,
  isLaterThan,
  recordDeadlineCorrection,
} from '../lib/deadlineExtensions';
/* Бүтэц хуулах ЦЭВЭР төлөвлөгч (`POST /:id/copy-structure`).  Урьдчилсан
 * харалт (`dry_run`) ба бодит бичилт ХОЁУЛАА ЯГ энэ нэг дуудлагаас гардаг
 * тул хэрэглэгчийн харсан тоо, бичигдсэн мөр хоёр зөрөх боломжгүй. */
import { planStructureCopy, type CopySelection } from '../lib/structureCopyPlan';
/* Хуулах модыг унших/бичих D1 давхарга — `copy-structure` ба ангиллын
 * ЗАГВАР (`lib/categoryTemplates.ts`, 2026-10-06) ХОЁУЛАА энэ нэг кодыг
 * хэрэглэнэ. */
import {
  MAX_COPY_TASKS,
  copyRunBatched,
  deleteCreatedBlocksDeep,
  insertPlannedStructure,
  loadCopySourceTree,
} from '../lib/structureCopyWrite';
/* «1.3 Төслийн хугацаа»-ны БАГАНА ↔ JSON хөрвүүлэг НЭГ файлд шилжсэн
 * (2026-09-03) — `routes/timeline.ts`-ийн «Хуваарь» цонх ч ижил дүрмээр
 * бичдэг болсон тул хоёр зам зөрөх боломжгүй.  Зан чанар ХЭВЭЭР. */
import {
  columnsFromTimelineRows,
  normaliseTimelineRows,
  type PassportTimelineRow,
} from '../lib/passportTimeline';
import { isAdminRole } from '../types';
import type {
  Env,
  AppVariables,
  ProjectRow,
  CreateProjectRequest,
  ClientInput,
  UserRow,
  BlockRow,
  DrawingRow,
  ProjectClientRow,
  ComponentRow,
  TaskRow,
  TeamShareInput,
  ProjectCategory,
  CopyStructureRequest,
} from '../types';

const projects = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/** Validate and normalize a client list from a create/update request. Drops
 *  empty names and clamps `share_percent` into [0, 100]. We intentionally do
 *  NOT enforce that the total sums to 100 — the UI surfaces that as a soft
 *  warning so admins can still save an in-progress roster. */
function sanitizeClients(
  raw: ClientInput[],
): Array<{ type: 'company' | 'individual'; name: string; share_percent: number }> {
  const out: Array<{ type: 'company' | 'individual'; name: string; share_percent: number }> = [];
  for (const c of raw) {
    const name = (c?.name ?? '').trim();
    if (!name) continue;
    const type = c.type === 'individual' ? 'individual' : 'company';
    const share = Number.isFinite(c.share_percent)
      ? Math.max(0, Math.min(100, Number(c.share_percent)))
      : 0;
    out.push({ type, name, share_percent: share });
  }
  return out;
}

/** Validate and normalize a team-share roster from a create/update request.
 *  Drops rows without a positive integer team_id, clamps `share_percent`
 *  into [0, 100], and de-dups duplicate team_ids by keeping the LAST entry
 *  (so an in-flight UI swap that re-emits the same row wins). The 100%
 *  invariant is intentionally NOT enforced here — see `sanitizeClients`. */
function sanitizeTeamShares(
  raw: TeamShareInput[],
): Array<{ team_id: number; share_percent: number; sort_order: number }> {
  const seen = new Map<number, { team_id: number; share_percent: number; sort_order: number }>();
  raw.forEach((r, idx) => {
    const tid = Number(r?.team_id);
    if (!Number.isInteger(tid) || tid <= 0) return;
    const share = Number.isFinite(r?.share_percent)
      ? Math.max(0, Math.min(100, Number(r.share_percent)))
      : 0;
    const sort = Number.isFinite(r?.sort_order) ? Number(r.sort_order) : idx;
    seen.set(tid, { team_id: tid, share_percent: share, sort_order: sort });
  });
  return Array.from(seen.values());
}

/**
 * Single SQL that computes:
 *   - every project the caller can see (admin → all, others → only those they are a member of)
 *   - member_count per project
 *   - weighted total progress per project
 *
 * Previously this was done with 5-level nested N+1 loops (one progress query per
 * leaf task of every project) which produced hundreds of sequential D1 round
 * trips.  This version runs in a single round trip.
 */
// Exported so the MCP server (src/mcp/tools/projects.ts) can reuse the exact
// same five-level weighted rollup instead of duplicating the CTE.  Bind
// `user.sub` 3× (admin) or 4× (forUser=true) — see the call sites below.
//
// ⚠️ THIS MATH IS DUPLICATED IN TEN OTHER PLACES.  There is only one progress
// formula in this codebase (declared-budget — see the CTE comments below); if
// you change it here you MUST change all of these in the same commit:
//   • routes/projects.ts   — the inline copy inside GET /api/projects/:id
//   • routes/projects.ts   — getProjectHierarchyFast (JS)
//   • routes/dashboard.ts  — the portfolio list CTE
//   • routes/company.ts    — the company-overview CTE
//   • routes/projectChat.ts — the client-portal CTE *and* its JS rollup
//   • routes/progress.ts   — the consolidate CTE *and* its JS rollup
//   • routes/progress.ts   — calcProjectProgress + computeProgressFromMap
//   • lib/progressTimeseries.ts + lib/companyTimeseries.ts — JS coefficients
// Callers that import this constant (timeline, clientReport, MCP) follow
// automatically and need no edit.
/**
 * @param forUser      Зөвхөн гишүүн байгаа төслөө харах (харилцагч).
 * @param seesPending  Гэрээ хэлэлцээрийн шатны САНУУЛГА төслүүдийг харах эсэх.
 *   Тэдгээр нь бодит ажил биш, зөвхөн admin + senior-т зориулсан сануулга тул
 *   инженер/архитектор/харилцагчийн жагсаалтад ОГТ гарах ёсгүй.  Анхдагчаар
 *   `true` — MCP хэрэгслүүд зэрэг байгаа дуудагчид өөрчлөгдөхгүй.
 */
export const PROJECT_LIST_SQL = (forUser: boolean, seesPending = true) => `
WITH
-- ⚠️ 2026-09-11 (D1 rows_read аудит): latest_task нь ТАСКААС эхэлж, таск
-- бүрд НЭГ индексийн мөр уншдаг болов (lib/progressLatest.ts-ийн тайлбар).
-- Өмнөх «батлагдсан мөр бүрд корреляцтай дэд асуулга» хэлбэр энэ жагсаалтад
-- 76 849 мөр уншдаг байв.  Явцгүй таск → percentage NULL → COALESCE 0 — үр дүн
-- байт-ижил.  Тиебрейк ХЭВЭЭР: created_at DESC.
latest_task AS (
  SELECT t.id AS task_id, ${latestApprovedPctByCreatedAt('t.id')} AS percentage
  FROM tasks t
),
-- Drawing progress = Σ(task.w × task.p) / drawing.weight_percent — the
-- drawing's DECLARED budget, NOT the task weight that happens to exist under
-- it. Task weight that doesn't fill the budget is unregistered scope and
-- counts as unfinished work, so a half-entered drawing reads low instead of
-- showing the average of what IS entered.
--
-- NULLIF(d.weight_percent, 0) reproduces the CASE WHEN d.weight_percent > 0
-- … ELSE 0 gate in calcProjectProgress: a zero-budget drawing contributes 0
-- no matter how complete its tasks are.
draw_prog AS (
  SELECT d.id, d.block_id, d.weight_percent,
         COALESCE(
           SUM(t.weight_percent * COALESCE(lt.percentage, 0))
             / NULLIF(d.weight_percent, 0),
           0
         ) AS progress
  FROM drawings d
  LEFT JOIN components c ON c.drawing_id = d.id
  LEFT JOIN tasks t ON t.component_id = c.id
  LEFT JOIN latest_task lt ON lt.task_id = t.id
  GROUP BY d.id, d.block_id, d.weight_percent
),
-- Block weight is "% within its team". Every level from here up divides by
-- the DECLARED budget (100), so child weights that don't add up to 100 leave
-- the remainder counted as unfinished work.
--
-- ⚠️ This chain is algebraically IDENTICAL to calcProjectProgress and its
-- in-memory twin computeProgressFromMap (both in routes/progress.ts). There
-- is exactly ONE progress rollup in this codebase — if you change the math
-- here, change all three, and every copy listed in the header comment.
block_prog AS (
  SELECT b.id, b.project_id, b.team_id, b.weight_percent,
         COALESCE(SUM(dp.weight_percent * dp.progress), 0) / 100.0 AS progress
  FROM blocks b
  LEFT JOIN draw_prog dp ON dp.block_id = b.id
  GROUP BY b.id, b.project_id, b.team_id, b.weight_percent
),
team_prog AS (
  SELECT project_id, team_id,
         COALESCE(SUM(weight_percent * progress), 0) / 100.0 AS progress
  FROM block_prog
  GROUP BY project_id, team_id
),
project_prog AS (
  SELECT pts.project_id AS id,
         COALESCE(
           SUM(pts.share_percent * COALESCE(tmp.progress, 0)),
           0
         ) / 100.0 AS progress
  FROM project_team_shares pts
  LEFT JOIN team_prog tmp
    ON tmp.project_id = pts.project_id AND tmp.team_id = pts.team_id
  GROUP BY pts.project_id
),
-- A person counts as a project member if they were explicitly added
-- (project_members) OR they are assigned to at least one task under any of
-- the project's blocks.  The second source is what actually matters day to
-- day: engineers get tasks via claim/share without anyone adding them to
-- project_members, and they should still be counted.  UNION dedups the
-- (project_id, user_id) pairs so someone who is both an explicit member and
-- a task assignee — or is assigned to many tasks — is counted once.
member_count AS (
  -- ⚠️ role <> client: project_members нь захиалагчийн эрхийн ТУСГАЛ ч
  --    болдог (routes/clientAdmin.ts → syncOrgMembership) тул шүүлтгүйгээр
  --    «гишүүд» гэсэн тоо захиалагчийн холбоо барих хүмүүсээр хөөрөгддөг.
  --    Ижил шүүлт dashboard.ts ба company.ts-д ч бий — гурвуулаа хамт.
  SELECT project_id, COUNT(*) AS cnt
  FROM (
    SELECT pm.project_id AS project_id, pm.user_id AS user_id
    FROM project_members pm
    INNER JOIN users u ON u.id = pm.user_id AND u.role <> 'client'
    UNION
    SELECT b.project_id, ta.user_id
    FROM task_assignees ta
    INNER JOIN tasks t      ON t.id = ta.task_id
    INNER JOIN components c ON c.id = t.component_id
    INNER JOIN drawings d   ON d.id = c.drawing_id
    INNER JOIN blocks b     ON b.id = d.block_id
  )
  GROUP BY project_id
),
-- Drawings are mapped to teams by NAME prefix (e.g. "BA - Барилга
-- архитектур" → team code BA). There is no team_id column on drawings,
-- so we extract the prefix in SQL: substring up to the first space OR
-- hyphen, uppercased and trimmed. Unknown prefixes simply fail to
-- join teams.code and drop out of the rollup.
drawing_team AS (
  SELECT d.id AS drawing_id,
         b.project_id,
         tm.id AS team_id
  FROM drawings d
  INNER JOIN blocks b ON b.id = d.block_id
  INNER JOIN teams tm ON tm.code = UPPER(TRIM(
    CASE
      WHEN INSTR(d.name, ' ') > 0 AND (INSTR(d.name, '-') = 0 OR INSTR(d.name, ' ') < INSTR(d.name, '-'))
        THEN SUBSTR(d.name, 1, INSTR(d.name, ' ') - 1)
      WHEN INSTR(d.name, '-') > 0
        THEN SUBSTR(d.name, 1, INSTR(d.name, '-') - 1)
      ELSE d.name
    END
  ))
),
drawing_task_progress AS (
  SELECT dt.project_id,
         dt.team_id,
         t.id AS task_id,
         COALESCE(lt.percentage, 0) AS progress
  FROM drawing_team dt
  INNER JOIN components c ON c.drawing_id = dt.drawing_id
  INNER JOIN tasks t ON t.component_id = c.id
  LEFT JOIN latest_task lt ON lt.task_id = t.id
),
team_task_progress AS (
  SELECT project_id,
         team_id,
         ROUND(AVG(progress), 2) AS progress,
         COUNT(DISTINCT task_id) AS task_count
  FROM drawing_task_progress
  GROUP BY project_id, team_id
),
-- Union of every (project, team) pair we want to surface in the
-- card's "team progress" list:
--   • teams the admin explicitly added to project_team_shares, AND
--   • teams referenced by drawings (via the NAME-prefix mapping above).
-- UNION (not UNION ALL) dedups the (project_id, team_id) pairs.
team_keys AS (
  SELECT project_id, team_id FROM project_team_shares
  UNION
  SELECT project_id, team_id FROM drawing_team
),
-- Дуудагчийн (viewer) харьяалал — НЭГ удаа (дээрх is_member / is_team_assigned).
my_member_projects AS (
  SELECT pm2.project_id FROM project_members pm2 WHERE pm2.user_id = ?
  UNION
  SELECT b.project_id
  FROM task_assignees ta
  INNER JOIN tasks t      ON t.id = ta.task_id
  INNER JOIN components c ON c.id = t.component_id
  INNER JOIN drawings d   ON d.id = c.drawing_id
  INNER JOIN blocks b     ON b.id = d.block_id
  WHERE ta.user_id = ?
),
my_team_projects AS (
  SELECT DISTINCT b.project_id
  FROM user_teams ut_self
  INNER JOIN user_teams ut_other ON ut_other.team_id = ut_self.team_id
  INNER JOIN task_assignees ta   ON ta.user_id = ut_other.user_id
  INNER JOIN tasks t      ON t.id = ta.task_id
  INNER JOIN components c ON c.id = t.component_id
  INNER JOIN drawings d   ON d.id = c.drawing_id
  INNER JOIN blocks b     ON b.id = d.block_id
  WHERE ut_self.user_id = ?
),
team_progress AS (
  SELECT project_id,
         json_group_array(
           json_object(
             'team_id', team_id,
             'team_code', team_code,
             'team_name_mn', team_name_mn,
             'progress', progress,
             'task_count', task_count
           )
         ) AS team_progress_json
  FROM (
    SELECT tk.project_id,
           tm.id AS team_id,
           tm.code AS team_code,
           tm.name_mn AS team_name_mn,
           COALESCE(ttp.progress, 0) AS progress,
           COALESCE(ttp.task_count, 0) AS task_count
    FROM team_keys tk
    INNER JOIN teams tm ON tm.id = tk.team_id
    LEFT JOIN project_team_shares pts
      ON pts.project_id = tk.project_id AND pts.team_id = tk.team_id
    LEFT JOIN team_task_progress ttp
      ON ttp.project_id = tk.project_id AND ttp.team_id = tk.team_id
    -- Admin-curated order wins; teams that only show up via task
    -- assignments fall back to a very large sort_order so they
    -- consistently sit after the curated ones, then break ties on
    -- the global team sort_order / code.
    ORDER BY COALESCE(pts.sort_order, 999999), tm.sort_order, tm.code
  )
  GROUP BY project_id
)
SELECT
  p.id, p.name, p.description, p.location, p.latitude, p.longitude,
  p.status, p.complexity, p.complexity_pct, p.category, p.created_by, p.created_at, p.updated_at,
  p.sort_order, p.is_asap, p.is_pending,
  -- Бүтцээ хаанаас хуулж авсан (0254) + тэр эх төслийн нэр.  ⚠️ Дахин
  -- сануулъя: ЗӨВХӨН БАГАНА нэмэв, асуултын тэмдэг НЭГ Ч нэмээгүй —
  -- дээрх анхааруулгыг үз.
  p.source_project_id,
  src.name AS source_project_name,
  -- Толгойн урт гарчиг (0089).  ⚠️ Энэ жагсаалт үүнийг СОНГОДОГГҮЙ байсан
  -- атал GET /:id нь SELECT *-аар буцаадаг — тиймээс жагсаалт ба
  -- дэлгэрэнгүй хоёр гарчгаараа зөрдөг байв (lib/projectIdentity.ts-ийн
  -- гарчгийн шатлал үүнийг шаарддаг).
  p.display_title,
  -- Паспортын танигчид (0246/0247).  ⚠️ ЗӨВХӨН БАГАНА нэмэв — байрлалт
  -- параметр НЭГ Ч нэмээгүй: энэ template нь ДӨРВӨН дуудагчаас БАЙРЛАЛААР
  -- холбогддог (projects.ts:377-378, mcp/tools/projects.ts,
  -- lib/clientReport.ts, routes/timeline.ts) бөгөөд параметр нэмэхэд
  -- дөрвүүлээ чимээгүй эвдэрнэ (tsc барихгүй).
  passport.start_date, passport.finish_date,
  passport.drawing_no, passport.doc_no, passport.full_title,
  COALESCE(mc.cnt, 0)                           AS member_count,
  -- Явцын урьтамж: гар утга байвал ДАВАМГАЙЛНА.  Блок/зураг/таскийн модгүй
  -- жижиг засварын ажил нь жинлэсэн нэгтгэлээр үүрд 0% харагдахаас
  -- сэргийлнэ (migration 0141).  Түүхий баганыг мөн буцаана — UI нь
  -- «энэ нь гараар тавьсан утга» гэдгийг ялгаж харуулна.
  -- Цагаар бодох горим (0339): progress_mode = 'hours' (шинэ ZA засварын
  -- төсөл) бол жинлэсэн модны оронд ажилчдад олгосон SUM(user_points.amount)
  -- (2026-09-29, таазгүй).  Гар утга (manual_progress) хоёулангаас нь ДЭЭГҮҮР.
  ROUND(COALESCE(p.manual_progress, ${projectProgressSql('p', 'pp.progress')}, 0), 2) AS progress,
  p.manual_progress,
  p.progress_mode,
  COALESCE(tp.team_progress_json, '[]')         AS team_progress_json,
  -- "Assigned" tab membership: a project counts as the user's if they are
  -- either an explicit project_members row OR they are assigned to at
  -- least one task that lives under any of this project's blocks. The
  -- second clause is what makes the tab actually useful — engineers
  -- frequently claim/get assigned to tasks without anyone bothering to
  -- add them to project_members.
  --
  -- ⚠️ 2026-09-11: хоёр EXISTS нь төсөл БҮРД (24×) дахин гүйцэтгэгддэг байсан
  --    тул нэг удаа тооцсон my_member_projects / my_team_projects CTE-ээс
  --    IN-ээр шалгана.  Асуултын тэмдгийн ТОО (3) ба утга (бүгд viewer id)
  --    ХЭВЭЭР — дуудагчид байрлалаар ижил утгыг 3 удаа bind хийдэг.
  CASE WHEN p.id IN (SELECT project_id FROM my_member_projects) THEN 1 ELSE 0 END AS is_member,
  -- Looser membership: project counts as "my team's" if anyone on a team
  -- the caller belongs to is assigned to at least one task in the project.
  -- This drives the AttendanceWidget picker so workers can clock in on any
  -- team-owned project even when they personally haven't claimed tasks yet.
  CASE WHEN p.id IN (SELECT project_id FROM my_team_projects) THEN 1 ELSE 0 END AS is_team_assigned
FROM projects p
LEFT JOIN member_count mc ON mc.project_id = p.id
LEFT JOIN project_prog pp ON pp.id = p.id
LEFT JOIN team_progress tp ON tp.project_id = p.id
LEFT JOIN project_passport passport ON passport.project_id = p.id
-- Бүтцийн эх төсөл (0254).  LEFT JOIN — холбоосгүй / устсан эх төсөл
-- бол source_project_name нь NULL болно, мөр алдагдахгүй.
--
-- ⚠️ НУУГДМАЛ ТӨСЛИЙН НЭР ЗАДРАХААС СЭРГИЙЛЭХ нөхцөл: зохиогчийн хяналтын
-- бүрхүүл (asr_only) болон гэрээ хэлэлцээрийн шатны (is_pending) эх төсөл
-- нь ЭНЭ жагсаалтын WHERE-ээр өөрөө хаагддаг мөртлөө JOIN-оор дамжин
-- нэрээ инженер/архитектор/харилцагчид харуулж байв.  Нөхцөлийг JOIN дээр
-- нь тавьснаар мөр алдагдахгүй, зөвхөн source_project_name нь NULL болно.
--
-- ⚠️ Нөхцөл нь БОЛЗОЛГҮЙ (seesPending-ээс хамаарахгүй) байх ёстой:
-- энэ template нь ДӨРВӨН дуудагчаас БАЙРЛАЛААР холбогддог тул асуултын
-- тэмдэг нэмэх аргагүй, харин нэр нь картан дээрх гоо сайхны мэдээлэл —
-- эрхтэй хүн холбоосыг id-гаар нь дагаад төслийг бүрэн харна.
LEFT JOIN projects src ON src.id = p.source_project_id
                      AND COALESCE(src.asr_only, 0) = 0
                      AND COALESCE(src.is_pending, 0) = 0
${forUser ? 'INNER JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?' : ''}
WHERE ${NOT_ASR_ONLY_SQL}${seesPending ? '' : ' AND COALESCE(p.is_pending, 0) = 0'}
ORDER BY p.is_asap DESC, p.sort_order ASC, p.created_at DESC
`;

// GET /api/projects — staff (admin/engineer/architect/senior) see every
// project so they can find unassigned tasks to claim; clients only see the
// projects they are a member of.
projects.get('/', async (c) => {
  const user = c.get('user');
  const canSeeAll =
    isAdminRole(user.role) ||
    user.role === 'engineer' ||
    user.role === 'architect' ||
    user.role === 'senior';

  // Гэрээ хэлэлцээрийн шатны сануулга төслүүд нь бодит ажил БИШ — зөвхөн
  // admin + senior төлөвлөлтдөө хардаг.  Инженер, архитектор, харилцагчийн
  // жагсаалтад огт гарахгүй (Timeline хуудас өөрөө ч тэр хоёр ролиор
  // хаалттай).
  const seesPending = isAdminRole(user.role) || user.role === 'senior';

  // Cache the list per-viewer.  `canSeeAll` flips the SQL shape, so it
  // belongs in the vary tags too — otherwise the same role string could
  // collide across permission tiers in edge cases.  `seesPending` мөн адил:
  // engineer ба senior хоёр ижил `canSeeAll` утгатай ч ӨӨР жагсаалт харна.
  return withEdgeCache(
    c,
    {
      key: 'projects:list',
      varyTags: [user.sub, user.role, canSeeAll ? 'all' : 'mine', seesPending ? 'p1' : 'p0'],
      ttlSeconds: 60,
    },
    async () => {
      const stmt = c.env.DB.prepare(PROJECT_LIST_SQL(!canSeeAll, seesPending));
      // Bind user.sub THREE times for the three EXISTS clauses powering
      // `is_member` (project_members + task_assignees) and `is_team_assigned`
      // (any teammate assigned). The forUser branch additionally binds
      // user.sub a fourth time for the INNER JOIN that limits visibility to
      // projects the caller belongs to.
      // Идэвхийн тоо — жагсаалттай ЗЭРЭГ (batch), нэг round trip.  Кэшийн
      // TTL (60 с) ба vary tags ижил тул жагсаалт, идэвх хоёр зөрөхгүй.
      const since = activityWindowStart(todayInUB());
      const activityStmt = c.env.DB.prepare(PROJECT_ACTIVITY_SQL).bind(since, since);
      const [res, actRes] = await c.env.DB.batch<Record<string, unknown>>([
        canSeeAll
          ? stmt.bind(user.sub, user.sub, user.sub)
          : stmt.bind(user.sub, user.sub, user.sub, user.sub),
        activityStmt,
      ]);
      const activityById = new Map<number, ProjectActivity>();
      for (const row of (actRes?.results ?? []) as unknown as ProjectActivityRow[]) {
        activityById.set(Number(row.project_id), buildProjectActivity(row));
      }
      // Complexity weight нь дотоод оноо/үнэлгээний үзүүлэлт — зөвхөн
      // admin-tier рүү буцаана (инженер, архитектор, ахлах, харилцагчид
      // харахгүй). Edge cache нь user.role-оор vary хийдэг тул per-role
      // payload зөрчилдөхгүй.
      const showComplexity = isAdminRole(user.role);
      // Архивласан төсөл зөвхөн админд (2026-09-28, `lib/archivedProjects.ts`).
      // SQL-д БИШ, энд: `PROJECT_LIST_SQL` нь дөрвөн дуудагчаас байрлалаар
      // bind хийгддэг.  Кэш `user.role`-оор ялгагддаг тул payload зөрөхгүй.
      const visibleRows = hideArchivedRows(user.role, res?.results ?? []);
      const projects = visibleRows.map((row: Record<string, unknown>) => {
        const raw = typeof row.team_progress_json === 'string' ? row.team_progress_json : '[]';
        let team_progress: unknown[] = [];
        try {
          const parsed = JSON.parse(raw);
          team_progress = Array.isArray(parsed) ? parsed : [];
        } catch {
          team_progress = [];
        }
        const { team_progress_json, ...project } = row;
        void team_progress_json;
        if (!showComplexity) delete project.complexity_pct;
        const activity =
          activityById.get(Number(row.id)) ?? emptyProjectActivity(Number(row.id));
        return { ...project, team_progress, activity };
      });
      return { projects };
    },
  );
});

// (Cache bust on writes is intentionally omitted: the 30 s TTL keeps
// staleness bounded, and callers see their own writes via React
// Query's optimistic invalidation on the frontend.  If we ever need
// instant cross-user freshness we'll have to track variants in a KV
// index since the Cache API has no pattern-delete.)

// POST /api/projects (admin only)
projects.post('/', requireAdmin(), async (c) => {
  const body = await c.req.json<CreateProjectRequest>();
  const user = c.get('user');

  if (!body.name?.trim()) {
    return c.json({ error: 'Project name is required' }, 400);
  }

  const cleanClients = sanitizeClients(body.clients ?? []);
  const cleanTeamShares = sanitizeTeamShares(body.team_shares ?? []);

  const lat =
    typeof body.latitude === 'number' && Number.isFinite(body.latitude) ? body.latitude : null;
  const lng =
    typeof body.longitude === 'number' && Number.isFinite(body.longitude) ? body.longitude : null;

  const allowedComplexity = ['low', 'mid', 'high', 'special'] as const;
  const complexity =
    body.complexity &&
    allowedComplexity.includes(body.complexity as (typeof allowedComplexity)[number])
      ? body.complexity
      : 'mid';

  // Free per-project performance weight (0-100). Defaults to 50 (the
  // legacy 'mid' weight) when the caller omits it.
  const complexityPct =
    typeof body.complexity_pct === 'number' && Number.isFinite(body.complexity_pct)
      ? Math.max(0, Math.min(100, body.complexity_pct))
      : 50;

  let category: ProjectCategory | null = null;
  if (body.category !== undefined && body.category !== null) {
    if (!isProjectCategory(body.category)) {
      return c.json(
        { error: `Invalid category. Allowed: ${PROJECT_CATEGORY_CODES.join(', ')}` },
        400,
      );
    }
    category = body.category;
  }

  // Бүтцийн ЭХ төсөл (миграци 0254).  ⚠️ ЭНД юу ч ХУУЛАХГҮЙ — зөвхөн
  // холбоосыг хадгална.  Бүтэц хуулах нь тусдаа, дахин оролдож болох
  // дуудлага (`POST /api/projects/:id/copy-structure`): үүсгэлт нь
  // амжилттай атал хуулалт нь унасан ч төсөл нь үлдэж, admin дахин
  // оролдох боломжтой байх ёстой.
  let sourceProjectId: number | null = null;
  const rawSourceId = (body as { source_project_id?: unknown }).source_project_id;
  if (rawSourceId !== undefined && rawSourceId !== null && rawSourceId !== '') {
    const sid = Number(rawSourceId);
    if (!Number.isInteger(sid) || sid <= 0) {
      return c.json({ error: 'source_project_id must be a positive integer' }, 400);
    }
    const srcExists = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ?')
      .bind(sid)
      .first();
    if (!srcExists) return c.json({ error: 'Source project not found' }, 404);
    sourceProjectId = sid;
  }

  /* Ангиллын ЗАГВАР (`lib/categoryTemplates.ts`, 2026-10-06).  Тухайн
   * ангилалд загвар төсөл тохируулсан бол түүний модыг (багийн хувь, блок,
   * зураг, бүрэлдэхүүн, ажил, жин) шинэ төсөлд АВТОМАТААР хуулна.
   * Хэрэглэхгүй: үүсгэх цонхонд «загвараас хуулах»-ыг унтраасан
   * (`use_template: false`), ЭХ төсөл сонгосон (ZA — «Бүтэц татах» өөрөө
   * нээгдэнэ), эсвэл багийн хувийг ИЛ илгээсэн. */
  const wantsTemplate = (body as { use_template?: unknown }).use_template !== false;
  const template =
    wantsTemplate && category && sourceProjectId === null && cleanTeamShares.length === 0
      ? await resolveCategoryTemplate(c.env.DB, category)
      : null;

  // Явцын горим (0339): ZA (Засвар) → цагийн бүртгэлээс, бусад → жинлэсэн
  // мод.  0348-аас хойш АНГИЛЛААС л хамаарна (эзний шийдвэр: «бүх засварын
  // төсөлд хувь оруулах хэсэг байхгүй») — `progress_mode`-ыг илгээсэн ч үл тооно.
  const progressMode = defaultProgressMode(category);

  const result = await c.env.DB.prepare(
    'INSERT INTO projects (name, description, location, latitude, longitude, complexity, complexity_pct, category, created_by, is_pending, source_project_id, progress_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      body.name.trim(),
      body.description?.trim() || null,
      body.location?.trim() || null,
      lat,
      lng,
      complexity,
      complexityPct,
      category,
      user.sub,
      // Гэрээ хэлэлцээрийн шатны САНУУЛГА (Timeline-аас нэрээр үүсгэсэн).
      // Ийм төсөл ажилчдын жагсаалтад ОГТ гарахгүй — доорх
      // `PROJECT_LIST_SQL`-ийн харагдацын шүүлтийг үз.
      body.is_pending ? 1 : 0,
      sourceProjectId,
      progressMode,
    )
    .run();

  const projectId = Number(result.meta.last_row_id);

  // Batch-insert clients in a single round trip if any were supplied.
  if (cleanClients.length > 0) {
    const stmt = c.env.DB.prepare(
      'INSERT INTO project_clients (project_id, type, name, share_percent, sort_order) VALUES (?, ?, ?, ?, ?)',
    );
    await c.env.DB.batch(
      cleanClients.map((cl, i) => stmt.bind(projectId, cl.type, cl.name, cl.share_percent, i)),
    );
  }

  /* Загвар ЭХЛЭЭД — багийн хувийг өөрөө бичвэл доорх ангиллын өгөгдмөл
   * ростер ОРОХГҮЙ (эс бөгөөс EZ 100% дээр BA 50 / EZ 50 давхарлана).
   * Унавал загвар өөрийн бичсэнийг буцаагаад өгөгдмөл ростер суулгана —
   * төсөл өөрөө амжилттай үүссэн хэвээр. */
  let templateResult: TemplateApplyResult | null = null;
  if (template) templateResult = await applyCategoryTemplate(c.env.DB, projectId, template);
  const templateWroteShares =
    templateResult !== null && templateResult.applied && templateResult.team_shares_written;

  // If the caller supplied an explicit team_shares roster, use it
  // verbatim. Otherwise — and only if a category was picked — auto-seed
  // from the category default (e.g. AZ → 7 teams at 30/32/11/8/10/5/4).
  // Codes are resolved to numeric team ids in one round trip; any
  // unknown code is silently skipped so a category whose teams haven't
  // all been seeded yet still produces a usable roster.
  let teamSharesToInsert: Array<{ team_id: number; share_percent: number; sort_order: number }> =
    cleanTeamShares;
  if (!templateWroteShares && teamSharesToInsert.length === 0 && category) {
    const wanted = getCategoryTeamShares(category);
    const lookup = await c.env.DB.prepare(
      `SELECT id, code FROM teams WHERE code IN (${wanted.map(() => '?').join(',')})`,
    )
      .bind(...wanted.map((w) => w.team_code))
      .all<{ id: number; code: string }>();
    const codeToId = new Map((lookup.results ?? []).map((r) => [r.code, r.id]));
    teamSharesToInsert = wanted.flatMap((w, i) => {
      const team_id = codeToId.get(w.team_code);
      return team_id ? [{ team_id, share_percent: w.share_percent, sort_order: i }] : [];
    });
  }

  if (teamSharesToInsert.length > 0) {
    const stmt = c.env.DB.prepare(
      'INSERT INTO project_team_shares (project_id, team_id, share_percent, sort_order) VALUES (?, ?, ?, ?)',
    );
    await c.env.DB.batch(
      teamSharesToInsert.map((ts, i) =>
        stmt.bind(projectId, ts.team_id, ts.share_percent, ts.sort_order ?? i),
      ),
    );
  }

  return c.json(
    {
      message: 'Project created',
      project: { id: projectId, name: body.name.trim(), category },
      /* null = загвар хэрэглээгүй; `applied:false` = загвар байсан ч
       * хуулж чадаагүй (UI нь «Бүтэц татах»-ыг санал болгоно). */
      template: templateResult,
    },
    201,
  );
});

/**
 * GET /api/projects/top?limit=5 — Төслүүдийн ЖАГСААЛТЫН эрэмбээр эхний N.
 *
 * Sidebar-ийн «Төслүүд ▸» дэд цэс үүнийг уншина.
 *
 * ⚠ МАРШРУТЫН ДАРААЛАЛ: энэ нь доорх `/:id`-аас ЗААВАЛ ӨМНӨ байх ёстой —
 *   эс тэгвэл Hono `/top`-ыг `id = "top"` гэж уншиж, `parseInt` нь `NaN`
 *   буцаана.  Шинэ литерал зам нэмэхдээ мөн энэ дээр талд тавь.
 *
 * ⚠ Эрэмбэ нь `PROJECT_LIST_SQL`-ынхтай ЯГ ИЖИЛ байх ЁСТОЙ:
 *   `is_asap DESC, sort_order ASC, created_at DESC`.  Ингэснээр цэсэн дэх 5
 *   мөр нь Төслүүдийн хуудсын хамгийн дээд 5 мөртэй үргэлж таарна — ASAP
 *   тэмдэглэсэн нь дээшээ, дараа нь гараар чирсэн дараалал.  Хоёр газар өөр
 *   эрэмбэтэй бол хэрэглэгч «яагаад зөрж байна?» гэж эргэлзэнэ.  Тэндэх
 *   `ORDER BY`-г өөрчлөх бол ЭНЭ мөрийг ч хамт өөрчил.
 *
 * `PROJECT_LIST_SQL`-ыг дахин ашиглаагүй нь санаатай: тэр бол аппын хамгийн
 * хүнд query (5 түвшний үүрлэсэн CTE-ээр бүх даалгаврын жинг эргүүлж
 * прогресс бодно), sidebar нь ХУУДАС БҮР дээр зурагддаг.  Энд `projects`
 * хүснэгтээс цаашгүй — join ч, бүлэглэл ч, дэд query ч үгүй.
 *
 * Харагдац нь `GET /`-тэй ижил дүрэмтэй: staff бүх төслийг, бусад нь зөвхөн
 * гишүүн байгаагаа.  Архивласныг хасна — цэсэнд хэрэггүй.
 */
projects.get('/top', async (c) => {
  const user = c.get('user');
  const limit = Math.min(20, Math.max(1, parseInt(c.req.query('limit') ?? '5', 10) || 5));
  const canSeeAll =
    isAdminRole(user.role) ||
    user.role === 'engineer' ||
    user.role === 'architect' ||
    user.role === 'senior';

  // Жагсаалттай ИЖИЛ харагдацын дүрэм — гэрээний шатны сануулга нь зөвхөн
  // admin + senior-т.  Хоёр газар зөрвөл цэс болон хуудас таарахаа болино.
  const seesPending = isAdminRole(user.role) || user.role === 'senior';

  const stmt = c.env.DB.prepare(`
    SELECT p.id, p.name
    FROM projects p
    ${canSeeAll ? '' : 'INNER JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?'}
    WHERE p.status != 'archived'
    AND ${NOT_ASR_ONLY_SQL}
    ${seesPending ? '' : 'AND COALESCE(p.is_pending, 0) = 0'}
    ORDER BY p.is_asap DESC, p.sort_order ASC, p.created_at DESC
    LIMIT ?
  `);
  const res = canSeeAll ? await stmt.bind(limit).all() : await stmt.bind(user.sub, limit).all();

  return c.json({
    projects: (res.results ?? []).map((r: Record<string, unknown>) => ({
      id: Number(r.id),
      name: String(r.name ?? ''),
    })),
  });
});

/**
 * GET /api/projects/pins — нэвтэрсэн хэрэглэгчийн «дээр бэхэлсэн» төслийн
 * id-ууд (migration 0178).  Хариу: `{ project_ids: number[] }`.
 *
 * ⚠ МАРШРУТЫН ДАРААЛАЛ: доорх `/:id`-аас ЗААВАЛ ӨМНӨ байх ёстой — эс тэгвэл
 *   Hono үүнийг `id = "pins"` гэж уншина (`/top`-той яг ижил шалтгаан).
 *
 * ⚠ ЗОРИУД `PROJECT_LIST_SQL`-д НЭМЭЭГҮЙ.  Тэр асуулгыг дөрвөн газраас
 *   (энэ файлын `GET /`, `mcp/tools/projects.ts`, `lib/clientReport.ts`,
 *   `routes/timeline.ts`) БАЙРЛАЛААР нь bind хийдэг тул SELECT-д нэг `?`
 *   нэмэх нь дөрвүүлэнг зэрэг засахыг шаардана — мартвал ажиллах үедээ
 *   «wrong number of parameter bindings» өгч MCP болон харилцагчийн PDF
 *   хоёулаа унана.  Бэхлэлт нь зөвхөн Төслүүдийн хуудсанд хэрэгтэй, мөр
 *   цөөтэй, хэрэглэгчээр хязгаарлагдсан өгөгдөл тул тусдаа хямд асуулгаар
 *   авах нь аюулгүй: хуудас өөрөө жагсаалтаа аль хэдийн client талдаа
 *   эрэмбэлдэг (`ProjectsPage.tsx` → `filtered`).
 */
projects.get('/pins', async (c) => {
  const user = c.get('user');
  const res = await c.env.DB.prepare(
    `SELECT project_id FROM project_pins
      WHERE user_id = ?
      ORDER BY created_at DESC, project_id DESC`,
  )
    .bind(user.sub)
    .all();
  return c.json({
    project_ids: (res.results ?? []).map((r: Record<string, unknown>) => Number(r.project_id)),
  });
});

/* ---------------------------------------------------------------------------
 * АНГИЛЛЫН ЗАГВАР ТӨСӨЛ (`lib/categoryTemplates.ts`, 2026-10-06)
 *
 * GET  /api/projects/category-templates      — тохируулсан загварууд (admin)
 * PUT  /api/projects/:id/category-template   — {enabled} энэ төслийг өөрийн
 *                                              ангиллын загвар болгох/хасах
 *
 * ⚠️ МАРШРУТЫН ДАРААЛАЛ: `/category-templates` нь `/:id`-аас ДЭЭР байх ёстой
 * (`/top`, `/pins`-тэй ижил шалтгаан).
 * ------------------------------------------------------------------------- */
projects.get('/category-templates', requireAdmin(), async (c) => {
  return c.json({ templates: await loadCategoryTemplates(c.env.DB) });
});

projects.put('/:id/category-template', requireAdmin(), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'Invalid project id', code: 'BAD_REQUEST' }, 400);
  }
  const body = await c.req.json<{ enabled?: unknown }>().catch(() => null);
  if (!body || typeof body.enabled !== 'boolean') {
    return c.json({ error: '`enabled` (boolean) is required', code: 'BAD_REQUEST' }, 400);
  }
  const db = c.env.DB;
  const project = await db
    .prepare('SELECT id, category, asr_only FROM projects WHERE id = ?')
    .bind(id)
    .first<{ id: number; category: string | null; asr_only: number | null }>();
  if (!project) return c.json({ error: 'Project not found', code: 'NOT_FOUND' }, 404);

  if (!body.enabled) {
    /* Зөвхөн ЭНЭ төслийг заасан мөрийг устгана — хооронд нь өөр төсөл
     * загвар болсон бол түүнийг хөндөхгүй. */
    await db
      .prepare('DELETE FROM app_settings WHERE key LIKE ? AND value = ?')
      .bind(`${CATEGORY_TEMPLATE_PREFIX}%`, String(id))
      .run();
    return c.json({ templates: await loadCategoryTemplates(db) });
  }

  if (!project.category || !isProjectCategory(project.category)) {
    return c.json({ error: 'Ангилалгүй төсөл загвар болох боломжгүй', code: 'NO_CATEGORY' }, 400);
  }
  if ((project.asr_only ?? 0) === 1) {
    return c.json(
      { error: 'Зохиогчийн хяналтын төсөл загвар болох боломжгүй', code: 'ASR_ONLY' },
      400,
    );
  }
  /* Хоосон загвар нь «автоматаар хуулна» гэсэн амлалтыг чимээгүй худал
   * болгоно — ядаж нэг ажилтай мод шаардана (төлөвлөгч ажилгүй мөчрийг
   * тайрдаг тул `blocks.length` = хуулагдах зүйл). */
  const plan = await planTemplateCopy(db, id);
  if (plan.blocks.length === 0) {
    return c.json(
      { error: 'Энэ төсөлд хуулах бүтэц (ажил) алга', code: 'EMPTY_STRUCTURE' },
      400,
    );
  }
  if (plan.counts.tasks > MAX_COPY_TASKS) {
    return c.json({ error: `Хэт олон ажил: ${plan.counts.tasks}`, code: 'TOO_LARGE' }, 400);
  }
  await upsertSetting(db, categoryTemplateKey(project.category), String(id), c.get('user').sub);
  return c.json({ templates: await loadCategoryTemplates(db) });
});

/* GET /api/projects/maps-link/resolve?url=https://maps.app.goo.gl/…
 *
 * Google Maps БОГИНО холбоосыг урт болгоно, өөр юу ч хийхгүй.  Утасны
 * «Хуваалцах» нь үргэлж богино холбоос өгдөг, хөтөч түүний redirect-ийг
 * харж чадахгүй (CORS).  Координатыг задлах нь frontend
 * (`shared/lib/mapsLink.ts`) — сервер зөвхөн redirect дагана
 * (`lib/mapsLinkResolve.ts`: Google-ийн хостоос гадуур хоп ХЭЗЭЭ Ч
 * дагахгүй, ≤6 хоп, бие уншихгүй).  Нэртэй газрын share (`?q=нэр&ftid=`)
 * нь URL-даа координат авч явдаггүй — тэр тохиолдолд frontend ил хэлнэ,
 * сервер таамаглахгүй (толгойн тайлбарыг үз).
 * `requireManager` — байршил засах эрхтэй хүмүүс л (пин хадгалах нь
 * `PUT /:id` = admin; senior паспорт засдаг тул холбоосыг шалгаж үзэж
 * болно).  `/:id`-ээс ДЭЭР байрлана (`maps-link` нь тоо биш тул `/:id`
 * дээр NaN болж 404 өгөх байсан ч, дараалал ил байг). */
projects.get('/maps-link/resolve', requireManager(), async (c) => {
  const raw = c.req.query('url')?.trim() ?? '';
  if (!raw || raw.length > 2048) return c.json({ error: 'url required', code: 'INVALID_URL' }, 400);
  const r = await resolveMapsShortLink(raw);
  if (!r.ok) {
    const status = r.code === 'INVALID_URL' || r.code === 'NOT_MAPS_HOST' ? 400 : 502;
    return c.json({ error: 'maps link could not be resolved', code: r.code, url: r.url ?? null }, status);
  }
  return c.json({ url: r.url, hops: r.hops });
});

// GET /api/projects/:id — full project with hierarchy
projects.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const user = c.get('user');

  // Clients are external stakeholders and only get access to projects they
  // are explicitly added to. All internal staff can browse any project so
  // engineers/architects can discover and claim unassigned tasks.
  if (user.role === 'client') {
    const member = await c.env.DB.prepare(
      'SELECT id FROM project_members WHERE project_id = ? AND user_id = ?',
    )
      .bind(id, user.sub)
      .first();
    if (!member) {
      return c.json({ error: 'Access denied' }, 403);
    }
  }

  const project = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?')
    .bind(id)
    .first<ProjectRow>();

  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  const [hierarchy, progressRow, membersRes, clientsRes, teamSharesRes, passportRow] =
    await Promise.all([
      getProjectHierarchyFast(c.env.DB, id),
      c.env.DB.prepare(
        `
        WITH
        latest_task AS (
          -- 2026-09-11: таск бүрд НЭГ индексийн мөр (lib/progressLatest.ts). Тиебрейк хэвээр.
          SELECT t.id AS task_id, ${latestApprovedPctByCreatedAt('t.id')} AS percentage
          FROM tasks t
        ),
        -- PROJECT_LIST_SQL-тэй ижил rollup: түвшин бүр ЗАРЛАСАН төсвөөр хуваана
        -- (жин 100 болоогүй бол дутуу нь хийгдээгүй ажил гэж тоологдоно).
        draw_prog AS (
          SELECT d.id, d.block_id, d.weight_percent,
                 COALESCE(
                   SUM(t.weight_percent * COALESCE(lt.percentage, 0))
                     / NULLIF(d.weight_percent, 0),
                   0
                 ) AS progress
          FROM drawings d
          LEFT JOIN components c ON c.drawing_id = d.id
          LEFT JOIN tasks t ON t.component_id = c.id
          LEFT JOIN latest_task lt ON lt.task_id = t.id
          GROUP BY d.id, d.block_id, d.weight_percent
        ),
        block_prog AS (
          SELECT b.id, b.project_id, b.team_id, b.weight_percent,
                 COALESCE(SUM(dp.weight_percent * dp.progress), 0) / 100.0 AS progress
          FROM blocks b LEFT JOIN draw_prog dp ON dp.block_id = b.id
          GROUP BY b.id, b.project_id, b.team_id, b.weight_percent),
        team_prog AS (
          SELECT project_id, team_id,
                 COALESCE(SUM(weight_percent * progress), 0) / 100.0 AS progress
          FROM block_prog
          GROUP BY project_id, team_id)
        SELECT ROUND(COALESCE(
          SUM(pts.share_percent * COALESCE(tmp.progress, 0)),
        0) / 100.0, 2) AS progress
        FROM project_team_shares pts
        LEFT JOIN team_prog tmp
          ON tmp.project_id = pts.project_id AND tmp.team_id = pts.team_id
        WHERE pts.project_id = ?
      `,
      )
        .bind(id)
        .first<{ progress: number }>(),
      c.env.DB.prepare(
        `
        SELECT u.id, u.username, u.full_name, u.role, u.profile_image,
               u.team_id, pt.code AS team_code, pt.name_mn AS team_name_mn
        FROM users u
        INNER JOIN project_members pm ON pm.user_id = u.id
        LEFT JOIN user_teams ut_p ON ut_p.user_id = u.id AND ut_p.is_primary = 1
        LEFT JOIN teams pt ON pt.id = ut_p.team_id
        WHERE pm.project_id = ?
      `,
      )
        .bind(id)
        .all<UserRow>(),
      c.env.DB.prepare(
        `
        SELECT id, project_id, type, name, share_percent, sort_order, created_at
        FROM project_clients
        WHERE project_id = ?
        ORDER BY sort_order, id
      `,
      )
        .bind(id)
        .all<ProjectClientRow>(),
      // Per-team allocation rows — joined to `teams` so the UI doesn't need
      // a second round trip just to render the team name + code badge.
      c.env.DB.prepare(
        `
        SELECT pts.id, pts.project_id, pts.team_id, pts.share_percent,
               pts.sort_order, pts.created_at, pts.updated_at,
               t.code AS team_code, t.name_mn AS team_name_mn,
               t.name_en AS team_name_en
        FROM project_team_shares pts
        INNER JOIN teams t ON t.id = pts.team_id
        WHERE pts.project_id = ?
        ORDER BY pts.sort_order, t.sort_order, t.name_mn
      `,
      )
        .bind(id)
        .all(),
      /* Паспорт — НЭГ дуудлагад багтаах нэмэлт (additive) гишүүн.
       *
       * ⚠️ ХАНДАЛТЫН ШАЛГАЛТ ШИНЭЭР ХЭРЭГГҮЙ: `GET /:id` (дээрх :630-641) ба
       * `GET /:id/passport` (:1804-1815) хоёр нь ЯГ ИЖИЛ гэрээ — «client бол
       * `project_members`-д байх ёстой, дотоод ажилтан бүгдийг харна».  Би
       * хоёуланг нь харьцуулж шалгав: ижил SQL, ижил 403.  Тиймээс энэ нь
       * ӨМНӨ НЬ ХААЛТТАЙ байсан ямар ч өгөгдлийг НЭЭХГҮЙ — зөвхөн хоёр дахь
       * round trip-ийг хэмнэнэ.  Хэрэв ирээдүйд `/:id/passport` дээр илүү
       * чанга шалгалт нэмэгдвэл ЭНДЭЭС ч мөн адил хасах ёстой. */
      c.env.DB.prepare('SELECT * FROM project_passport WHERE project_id = ?')
        .bind(id)
        .first<PassportRow>(),
    ]);

  // Complexity weight нь дотоод оноо/үнэлгээний үзүүлэлт — зөвхөн admin-tier
  // рүү буцаана (инженер, архитектор, ахлах, харилцагчид харахгүй).
  // 'hours' горимд (0339) жинлэсэн мод биш цагийн бүртгэлээс — жагсаалтын
  // PROJECT_LIST_SQL-тэй ижил тоо, детайл хуудас зөрөхгүй.
  const progress =
    project.progress_mode === 'hours'
      ? await hoursProgressOf(c.env.DB, 'project_id', id)
      : (progressRow?.progress ?? 0);
  const projectOut: Record<string, unknown> = {
    ...project,
    progress,
  };
  if (!isAdminRole(user.role)) delete projectOut.complexity_pct;

  return c.json({
    project: projectOut,
    blocks: hierarchy,
    members: membersRes.results,
    clients: clientsRes.results,
    team_shares: teamSharesRes.results,
    /* ⚠️ НЭМЭЛТ түлхүүр — хуучин дуудагч бүр хэвээр ажиллана.  Паспортын
     * мөр байхгүй төсөл (24-ийн 9) дээр `null` ирнэ.  Mapper нь
     * `/:id/passport`-той ЯГ НЭГ (`rowToPassport`) — хоёр дахь хувилбар
     * бүү бич. */
    passport: rowToPassport(passportRow),
  });
});

// PUT /api/projects/reorder — admin гар эрэмбэ (drag-reorder).
// Body: { project_ids: number[] }.  Өгөгдсөн дарааллаар sort_order = (i+1)*10
// болгож batch-аар бичнэ (landing block-ийн pattern).  `/:id`-ээс ӨМНӨ
// бүртгэгдсэн байх ёстой — эс бөгөөс "reorder" нь :id болж барьцаалагдана.
projects.put('/reorder', requireAdmin(), async (c) => {
  const body = await c.req
    .json<{ project_ids?: unknown }>()
    .catch((): { project_ids?: unknown } => ({}));
  const ids = Array.isArray(body.project_ids)
    ? body.project_ids.filter((n): n is number => Number.isInteger(n) && (n as number) > 0)
    : [];
  if (ids.length === 0) {
    return c.json({ error: 'project_ids (number[]) шаардлагатай' }, 400);
  }
  const stmts = ids.map((id, i) =>
    c.env.DB.prepare(
      "UPDATE projects SET sort_order = ?, updated_at = datetime('now') WHERE id = ?",
    ).bind((i + 1) * 10, id),
  );
  await c.env.DB.batch(stmts);
  return c.json({ ok: true, count: ids.length });
});

// PATCH /api/projects/:id/asap — «ASAP / яаралтай» тэмдгийг асаах/унтраах (admin).
// Body: { is_asap: boolean }.  ASAP төсөл жагсаалтын дээр гарч улаанаар тодорно.
projects.patch('/:id/asap', requireAdmin(), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<{ is_asap?: unknown }>().catch((): { is_asap?: unknown } => ({}));
  const asap = body.is_asap ? 1 : 0;
  await c.env.DB.prepare(
    "UPDATE projects SET is_asap = ?, updated_at = datetime('now') WHERE id = ?",
  )
    .bind(asap, id)
    .run();
  return c.json({ ok: true, is_asap: asap });
});

/**
 * PATCH /api/projects/:id/pin — «дээр бэхлэх» тэмдгийг асаах/унтраах.
 * Body: `{ is_pinned: boolean }` (migration 0178).
 *
 * ⚠ РОЛЬ ШАЛГАХГҮЙ нь САНААТАЙ.  Бэхлэлт нь `project_pins`-д (user_id,
 *   project_id) хосоор бичигдэх бөгөөд ЗӨВХӨН дуудагчийн ӨӨРИЙНХ нь
 *   жагсаалтын эрэмбэд нөлөөлнө — бусдын харагдацыг өөрчлөхгүй тул
 *   инженер, архитектор, ахлах бүгд ашиглана.  Харин `/:id/asap` бол
 *   компанийн хэмжээний тэмдэг учраас admin-only хэвээр.
 *
 * Харагдацын шалгалт мөн зориуд байхгүй: харагдахгүй төслийг бэхэлсэн ч
 * жагсаалтад гарахгүй тул мэдээлэл алдагдахгүй (`GET /` өөрийн шүүлтээ
 * хийнэ).  Зөвхөн өнчин мөр үүсэхээс сэргийлж төслийн оршихуйг шалгана —
 * D1 нь FK-г ажиллах үедээ хэрэгжүүлдэггүй.
 */
projects.patch('/:id/pin', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
  const user = c.get('user');
  const body = await c.req
    .json<{ is_pinned?: unknown }>()
    .catch((): { is_pinned?: unknown } => ({}));
  const pinned = body.is_pinned ? 1 : 0;

  if (pinned) {
    const exists = await c.env.DB.prepare('SELECT 1 FROM projects WHERE id = ?').bind(id).first();
    if (!exists) return c.json({ error: 'Project not found' }, 404);
    // Давхар дарахад 409 биш, чимээгүй idempotent байх нь UI-д зөв:
    // optimistic toggle нь сүлжээ эргэж ирэхээс өмнө дахин илгээгдэж болно.
    await c.env.DB.prepare('INSERT OR IGNORE INTO project_pins (user_id, project_id) VALUES (?, ?)')
      .bind(user.sub, id)
      .run();
  } else {
    await c.env.DB.prepare('DELETE FROM project_pins WHERE user_id = ? AND project_id = ?')
      .bind(user.sub, id)
      .run();
  }
  return c.json({ ok: true, is_pinned: pinned });
});

// PATCH /api/projects/:id/pending — «Гэрээ хэлэлцээрийн шатанд» тэмдгийг
// асаах/унтраах (admin).  Body: { is_pending: boolean }.
//
// Ийм төсөл Timeline дээр шараар тодорч, компанийн «идэвхтэй төсөл»-ийн тоо
// болон хугацаа хэтэрсэн даалгаврын жагсаалтаас хасагдана.  ⚠ ОНОО болон
// таскийн түвшний прогрессод НӨЛӨӨЛӨХГҮЙ — тэдгээр нь ажил бодитоор хийгдсэн
// эсэхээр тооцогддог бөгөөд гэрээний шат нь түүнийг үгүйсгэхгүй.
projects.patch('/:id/pending', requireAdmin(), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req
    .json<{ is_pending?: unknown }>()
    .catch((): { is_pending?: unknown } => ({}));
  const pending = body.is_pending ? 1 : 0;
  await c.env.DB.prepare(
    "UPDATE projects SET is_pending = ?, updated_at = datetime('now') WHERE id = ?",
  )
    .bind(pending, id)
    .run();
  return c.json({ ok: true, is_pending: pending });
});

// PUT /api/projects/:id (admin only)
projects.put('/:id', requireAdmin(), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const body = await c.req.json<Partial<CreateProjectRequest> & { status?: string }>();

  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (body.name !== undefined) {
    updates.push('name = ?');
    values.push(body.name.trim());
  }
  if (body.description !== undefined) {
    updates.push('description = ?');
    values.push(body.description?.trim() || null);
  }
  if ((body as { display_title?: unknown }).display_title !== undefined) {
    const dt = (body as { display_title?: string | null }).display_title;
    updates.push('display_title = ?');
    values.push(dt?.trim() || null);
  }
  if (body.location !== undefined) {
    updates.push('location = ?');
    values.push(body.location?.trim() || null);
  }
  if ((body as { key_image_url?: unknown }).key_image_url !== undefined) {
    const keyImageUrl = (body as { key_image_url?: string | null }).key_image_url;
    const trimmed = keyImageUrl?.trim() || null;
    // ⚠️ Урьд ЯМАР Ч шалгалтгүй байсан — дурын мөр (гадаад URL, `data:`,
    //    хавтастай `/media/…`) шууд баганад ордог байв.  Hono `%2F`-ыг
    //    задалдаг тул `/media/a%2Fb.png` мэт утга уншихад хавтастай R2
    //    түлхүүр болно (`lib/mediaUrl.ts`-ийн толгойг үз); түүнчлэн
    //    `lib/clientReportRender.ts:131` нь хадгалсан утган дээр ӨӨРӨӨ
    //    `decodeURIComponent` хийж R2 руу ШУУД ханддаг.
    //    Хоосон/`null` = зургийг АВАХ (хүчинтэй үйлдэл).  Утгатай бол
    //    ЗААВАЛ `/media/<нэг сегмент>` — `ProjectKeyImage.tsx:35-38` нь
    //    `uploadFile()`-ийн буцаасан яг тэр хэлбэрийг л илгээдэг.
    if (trimmed !== null && !isSingleSegmentMediaUrl(trimmed)) {
      return c.json({ error: 'key_image_url must be a /media/ key' }, 400);
    }
    updates.push('key_image_url = ?');
    values.push(trimmed);
  }
  if ((body as { model_url?: unknown }).model_url !== undefined) {
    const modelUrl = (body as { model_url?: string | null }).model_url?.trim() || null;
    updates.push('model_url = ?');
    values.push(modelUrl);
    // The 3D viewer now runs on APS (.rvt). Real model uploads go through
    // PUT /api/aps/projects/:id/model (which translates via APS and records a
    // project_models version); this generic edit just stores the column.
  }
  if (body.latitude !== undefined) {
    const lat =
      typeof body.latitude === 'number' && Number.isFinite(body.latitude) ? body.latitude : null;
    updates.push('latitude = ?');
    values.push(lat);
  }
  if (body.longitude !== undefined) {
    const lng =
      typeof body.longitude === 'number' && Number.isFinite(body.longitude) ? body.longitude : null;
    updates.push('longitude = ?');
    values.push(lng);
  }
  if (body.status) {
    updates.push('status = ?');
    values.push(body.status);
    // Гараар төлөв солих нь «хувь дүүрч АВТОМАТААР архивлагдсан» гэдэг тэмдгийг (0378) арилгана — залруулгаар хувь
    // буурахад ЗӨВХӨН автоматаар архивлагдсан төслийг дахин нээнэ, гараар архивласныг хэзээ ч.
    updates.push('auto_archived_at = NULL');
  }
  if (body.complexity !== undefined) {
    const allowed = ['low', 'mid', 'high', 'special'];
    if (!allowed.includes(body.complexity as string)) {
      return c.json({ error: 'Invalid complexity tier' }, 400);
    }
    updates.push('complexity = ?');
    values.push(body.complexity as string);
  }
  if (body.complexity_pct !== undefined) {
    const pct = Number(body.complexity_pct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return c.json({ error: 'complexity_pct must be a number between 0 and 100' }, 400);
    }
    updates.push('complexity_pct = ?');
    values.push(pct);
  }
  // Явцын горим (0339) нь 0348-аас хойш АНГИЛЛААС л хамаарна: ZA → 'hours',
  // бусад → 'tasks'.  `progress_mode`-ыг илгээсэн ч үл тооно — ангилал
  // солигдоход доор хамт солигдоно.
  let modeFromCategory: 'tasks' | 'hours' | null = null;
  if ((body as { category?: unknown }).category !== undefined) {
    const cat = (body as { category?: unknown }).category;
    if (cat === null || cat === '') {
      updates.push('category = ?');
      values.push(null);
      modeFromCategory = defaultProgressMode(null);
    } else if (isProjectCategory(cat)) {
      updates.push('category = ?');
      values.push(cat);
      modeFromCategory = defaultProgressMode(cat);
    } else {
      return c.json(
        { error: `Invalid category. Allowed: ${PROJECT_CATEGORY_CODES.join(', ')}` },
        400,
      );
    }
    // Intentionally do NOT touch project_team_shares here — leave that
    // to an explicit user action in the setup page.
  }
  // Ангилал ZA болж ЦАГААР шилжвэл тэр төслийн хуучин хувийн бөглөлтийг ч цаг
  // болгож нөхүүлнэ (lib/repairDayStore.ts `rearmHoursBackfill` → cron).
  // ⚠️ Горимыг ЗӨВХӨН ангилал ҮНЭХЭЭР солигдоход дахин гаргана: засах цонх
  // хадгалах бүрд ангиллаа дахин илгээдэг тул эс тэгвэл гараар хувьд үлдээсэн
  // ZA төсөл (FURNITURE LAND #49, миграц 0353 — эзний шийдвэр 2026-09-28)
  // дараагийн хадгалалтаар чимээгүй цаг руу шилжинэ.
  let rearmBackfill = false;
  if (modeFromCategory) {
    const cur = await c.env.DB.prepare('SELECT category, progress_mode FROM projects WHERE id = ?')
      .bind(id)
      .first<{ category: string | null; progress_mode: string | null }>();
    const nextCategory = (body as { category?: unknown }).category || null;
    if (!cur || (cur.category ?? null) !== nextCategory) {
      rearmBackfill = modeFromCategory === 'hours' && cur?.progress_mode !== 'hours';
      updates.push('progress_mode = ?');
      values.push(modeFromCategory);
    }
  }

  /* Бүтцийн ЭХ төсөл (миграци 0254) — БУРУУ холбоосыг ЗАСАХ цорын ганц зам.
   * `null`/хоосон = холбоосыг АВНА.  Гогцоо (A→B→A) нь `GET /:id/derived`-ийн
   * рекурсив CTE-г мөнхөд эргүүлэх тул ЭНД хаана: DB талд ямар ч CHECK
   * байхгүй (`projects` дахин байгуулах нь 33 каскад хүүхэдтэй — path B). */
  if ((body as { source_project_id?: unknown }).source_project_id !== undefined) {
    const rawSourceId = (body as { source_project_id?: unknown }).source_project_id;
    if (rawSourceId === null || rawSourceId === '') {
      updates.push('source_project_id = ?');
      values.push(null);
    } else {
      const sid = Number(rawSourceId);
      if (!Number.isInteger(sid) || sid <= 0) {
        return c.json({ error: 'source_project_id must be a positive integer' }, 400);
      }
      if (sid === id) {
        return c.json({ error: 'Төсөл өөрийгөө эх төсөл болгож болохгүй', code: 'CYCLE' }, 409);
      }
      const srcExists = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ?')
        .bind(sid)
        .first();
      if (!srcExists) return c.json({ error: 'Source project not found' }, 400);
      if (await sourceChainReaches(c.env.DB, sid, id)) {
        return c.json({ error: 'Гогцоо үүсэх тул холбож болохгүй', code: 'CYCLE' }, 409);
      }
      updates.push('source_project_id = ?');
      values.push(sid);
    }
  }

  // Clients array is optional; if supplied it fully replaces the previous roster.
  const clientsProvided = Array.isArray(body.clients);

  if (updates.length === 0 && !clientsProvided) {
    return c.json({ error: 'No fields to update' }, 400);
  }

  if (updates.length > 0) {
    // 2026-09-11 (R2 аудит): гол зураг солигдвол хуучин объектыг цэвэрлэнэ
    // (lib/mediaReplace.ts) — UPDATE-ээс ӨМНӨ хуучин утгыг уншина.
    const keyImageBody = (body as { key_image_url?: string | null }).key_image_url;
    const keyImageTouched = keyImageBody !== undefined;
    const prevKeyImage = keyImageTouched
      ? await c.env.DB.prepare('SELECT key_image_url FROM projects WHERE id = ?')
          .bind(id)
          .first<{ key_image_url: string | null }>()
      : null;
    updates.push("updated_at = datetime('now')");
    values.push(id);
    await c.env.DB.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
    if (rearmBackfill) await rearmHoursBackfill(c.env.DB);
    if (prevKeyImage) {
      const nextKeyImage = typeof keyImageBody === 'string' ? keyImageBody.trim() || null : null;
      c.executionCtx.waitUntil(
        deleteReplacedMediaAll(c.env, [[prevKeyImage.key_image_url, nextKeyImage]]),
      );
    }
  }

  if (clientsProvided) {
    const cleaned = sanitizeClients(body.clients ?? []);
    await c.env.DB.prepare('DELETE FROM project_clients WHERE project_id = ?').bind(id).run();
    if (cleaned.length > 0) {
      const stmt = c.env.DB.prepare(
        'INSERT INTO project_clients (project_id, type, name, share_percent, sort_order) VALUES (?, ?, ?, ?, ?)',
      );
      await c.env.DB.batch(
        cleaned.map((cl, i) => stmt.bind(id, cl.type, cl.name, cl.share_percent, i)),
      );
    }
  }

  // Changing the per-project complexity weight (or the legacy tier)
  // rescales every past award on this project, so rebuild the leaderboard
  // ledger.  Wrapped so a recalc hiccup never fails the (already-committed)
  // project update.
  if (body.complexity !== undefined || body.complexity_pct !== undefined) {
    try {
      await recalculateProjectPoints(c.env.DB, id);
    } catch (err) {
      console.error(`recalculateProjectPoints failed for project ${id}:`, err);
    }
  }

  return c.json({ message: 'Project updated' });
});

// DELETE /api/projects/:id (admin only)
//
// Explicitly clears child tables whose FK to `projects` was created
// without `ON DELETE CASCADE` (currently `daily_active_projects` in
// migration 0044). Without this, deleting a project that any user has
// marked as "active for today" fails with a FOREIGN KEY constraint
// error → 500 Internal Server Error. All other project-scoped tables
// (blocks, project_members, documents, status reports, …) cascade
// automatically via their schema.
projects.delete('/:id', requireAdmin(), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  // Хуваарилалтын хүснэгтүүд (0376–0377) FK-гүй — төсөл бүхлээр устахад (админ, зориуд) мөрүүдийг гараар цэвэрлэнэ.
  await purgeRootsForProject(c.env.DB, id);
  await c.env.DB.prepare('DELETE FROM daily_active_projects WHERE project_id = ?').bind(id).run();
  // ⚠️ D1 нь runtime дээр FK-г хэрэгжүүлдэггүй тул хугацааны мөрүүдийг
  // ГАРААР устгана — эс бөгөөс өнчин мөр үлдэж `/api/deadlines/upcoming`,
  // Dashboard-ийн зурвас хоёрт мөнхөд цухуйна (migration 0173-ыг үз).
  await c.env.DB.prepare(
    `DELETE FROM project_milestone_assignees
      WHERE milestone_id IN (SELECT id FROM project_milestones WHERE project_id = ?)`,
  )
    .bind(id)
    .run();
  await c.env.DB.prepare('DELETE FROM project_milestones WHERE project_id = ?').bind(id).run();
  // Мөн шалтгаанаар хэрэглэгчдийн хувийн бэхлэлтийг ГАРААР устгана
  // (migration 0178) — үлдвэл `GET /api/projects/pins` устсан төслийн id
  // буцаасаар байх болно.
  await c.env.DB.prepare('DELETE FROM project_pins WHERE project_id = ?').bind(id).run();
  // Хугацааны сунгалтын түүх (migration 0339) — мөн ГАРААР.
  await c.env.DB.prepare('DELETE FROM project_deadline_changes WHERE project_id = ?').bind(id).run();
  // Миграци 0254: `projects.source_project_id` нь `ON DELETE SET NULL` гэж
  // ЗАРЛАГДСАН ч D1 нь runtime дээр FK-г хэрэгжүүлдэггүй тул ӨӨРСДӨӨ
  // тасална.  Эс бөгөөс энэ төслөөс бүтцээ хуулж авсан үр төслүүд устсан
  // id рүү заасаар үлдэж, `GET /:id/derived` ба `PROJECT_LIST_SQL`-ийн
  // `LEFT JOIN projects src` хоёрт өнчин холбоос болно.
  await c.env.DB.prepare('UPDATE projects SET source_project_id = NULL WHERE source_project_id = ?')
    .bind(id)
    .run();
  // Ангиллын загвар байсан бол тохиргоог ч цэвэрлэнэ (resolver устсан id-г
  // аль хэдийн үл тоодог ч өнчин мөр үлдээхгүй).
  await c.env.DB.prepare('DELETE FROM app_settings WHERE key LIKE ? AND value = ?')
    .bind(`${CATEGORY_TEMPLATE_PREFIX}%`, String(id))
    .run();
  await c.env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(id).run();
  return c.json({ message: 'Project deleted' });
});

// GET /api/projects/:id/models — 3D model version history for the viewer.
// Member-gated for clients (same rule as GET /:id); staff see any project's
// versions. Lives under /projects (not /aps) so member-clients can reach it.
interface ProjectModelRow {
  id: number;
  model_url: string;
  model_xkt_url: string | null;
  aps_urn: string | null;
  model_format: 'rvt' | 'ifc' | null;
  conversion_status: 'converting' | 'done' | 'failed';
  conversion_error: string | null;
  file_name: string | null;
  file_size: number | null;
  uploaded_by: number | null;
  uploaded_by_name: string | null;
  created_at: string;
  aps_progress?: string | null;
}
projects.get('/:id/models', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const user = c.get('user');
  if (user.role === 'client') {
    const member = await c.env.DB.prepare(
      'SELECT id FROM project_members WHERE project_id = ? AND user_id = ?',
    )
      .bind(id, user.sub)
      .first();
    if (!member) return c.json({ error: 'Access denied' }, 403);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT m.id, m.model_url, m.model_xkt_url, m.aps_urn, m.model_format,
            m.conversion_status, m.conversion_error, m.file_name, m.file_size,
            m.uploaded_by, u.full_name AS uploaded_by_name, m.created_at
       FROM project_models m
       LEFT JOIN users u ON u.id = m.uploaded_by
      WHERE m.project_id = ?
      ORDER BY m.created_at DESC, m.id DESC`,
  )
    .bind(id)
    .all<ProjectModelRow>();

  // Lazily refresh APS translation status for any in-flight .rvt version: the
  // frontend already polls this endpoint every 5s, so we check the Model
  // Derivative manifest here instead of running a durable background loop.
  // Wrapped per-row so an APS hiccup never 500s the whole version list.
  await Promise.all(
    results
      .filter(
        (m) =>
          m.model_format === 'rvt' && m.conversion_status === 'converting' && !!m.aps_urn,
      )
      .map(async (m) => {
        try {
          const manifest = await getManifest(c.env, m.aps_urn!);
          const mapped = mapStatus(manifest.status);
          if (mapped !== 'converting' || manifest.progress) {
            m.conversion_status = mapped;
            m.aps_progress = manifest.progress ?? null;
            await c.env.DB.prepare(
              `UPDATE project_models SET conversion_status=?, aps_progress=? WHERE id=?`,
            )
              .bind(mapped, manifest.progress ?? null, m.id)
              .run();
          }
        } catch {
          // keep the stored status; the next poll retries.
        }
      }),
  );

  return c.json({ models: results });
});

// GET /api/projects/:id/members
projects.get('/:id/members', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  // Захиалагч зөвхөн ӨӨРИЙН төслийн гишүүдийг харна.  `lib/clientScope.ts` нь
  // `/api/projects` угтварыг нээдэг тул төслийн ТҮВШНИЙ шалгалт энд байх ёстой.
  if (!(await guardClientProject(c.env.DB, c.get('user'), id))) {
    return c.json({ error: 'Access denied' }, 403);
  }
  const { results } = await c.env.DB.prepare(
    `
    SELECT u.id, u.username, u.full_name, u.role, u.status FROM users u
    INNER JOIN project_members pm ON pm.user_id = u.id
    WHERE pm.project_id = ?
  `,
  )
    .bind(id)
    .all<UserRow>();

  return c.json({ members: results });
});

// POST /api/projects/:id/members (admin only)
// Accepts either a single { user_id } or a batch { user_ids: [...] } payload.
// Existing memberships are silently ignored so the call is idempotent and
// admins can re-add without errors.
projects.post('/:id/members', requireManager(), async (c) => {
  const projectId = parseInt(c.req.param('id'), 10);
  const body = await c.req.json<{ user_id?: number; user_ids?: number[] }>();

  const ids =
    Array.isArray(body.user_ids) && body.user_ids.length > 0
      ? body.user_ids
      : typeof body.user_id === 'number'
        ? [body.user_id]
        : [];

  const clean = [...new Set(ids.filter((n) => Number.isFinite(n) && n > 0))];
  if (clean.length === 0) {
    return c.json({ error: 'user_id or user_ids required' }, 400);
  }

  const stmt = c.env.DB.prepare(
    'INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)',
  );
  await c.env.DB.batch(clean.map((uid) => stmt.bind(projectId, uid)));

  return c.json({ message: 'Members added', count: clean.length }, 201);
});

/* PUT /api/projects/:id/team-shares (admin only)
 * Replace-all editor: takes the full desired roster and rewrites the
 * project's team share rows in a single round-trip (DELETE → batch
 * INSERT, mirroring the `clients` PUT pattern in PUT /:id).  The 100%
 * invariant is intentionally NOT enforced — the UI surfaces it as a
 * soft warning so admins can save in-progress edits.
 *
 * Request body: { team_shares: TeamShareInput[] }
 *   team_shares[].team_id        — references teams.id
 *   team_shares[].share_percent  — clamped server-side to [0, 100]
 *   team_shares[].sort_order?    — optional; defaults to request order
 *
 * Response: { team_shares: [...] } — fresh rows joined to teams so the
 * caller can replace its in-memory state without a second GET.
 */
projects.put('/:id/team-shares', requireManager(), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid project id' }, 400);

  const exists = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(id).first();
  if (!exists) return c.json({ error: 'Project not found' }, 404);

  const body = await c.req
    .json<{ team_shares?: TeamShareInput[] }>()
    .catch(() => ({}) as { team_shares?: TeamShareInput[] });
  const cleaned = sanitizeTeamShares(body.team_shares ?? []);

  await c.env.DB.prepare('DELETE FROM project_team_shares WHERE project_id = ?').bind(id).run();

  if (cleaned.length > 0) {
    const stmt = c.env.DB.prepare(
      'INSERT INTO project_team_shares (project_id, team_id, share_percent, sort_order) VALUES (?, ?, ?, ?)',
    );
    await c.env.DB.batch(
      cleaned.map((ts, i) => stmt.bind(id, ts.team_id, ts.share_percent, ts.sort_order ?? i)),
    );
  }

  const { results } = await c.env.DB.prepare(
    `
    SELECT pts.id, pts.project_id, pts.team_id, pts.share_percent,
           pts.sort_order, pts.created_at, pts.updated_at,
           t.code AS team_code, t.name_mn AS team_name_mn,
           t.name_en AS team_name_en
    FROM project_team_shares pts
    INNER JOIN teams t ON t.id = pts.team_id
    WHERE pts.project_id = ?
    ORDER BY pts.sort_order, t.sort_order, t.name_mn
  `,
  )
    .bind(id)
    .all();

  // Team shares feed straight into project progress, so rebuild the
  // leaderboard ledger under the new split.
  try {
    await recalculateProjectPoints(c.env.DB, id);
  } catch (err) {
    console.error(`recalculateProjectPoints failed for project ${id}:`, err);
  }

  return c.json({ message: 'Хадгалагдлаа', team_shares: results });
});

/* ==========================================================================
 *  БҮТЭЦ ХУУЛАХ  —  POST /api/projects/:id/copy-structure
 *
 *  Ижил БАРИЛГА дээр ZA («Засвар») гэрээ ирэхэд шинэ төсөлд блок→зураг→
 *  эд анги→ажлын мод, багийн хувь ЮУ Ч байхгүй тул admin тэглэсэн газраас
 *  дахин барьдаг байв.  Энэ маршрут түүнийг хуулна.
 *
 *  ЭЗНИЙ ШИЙДВЭР — БҮҮ ӨӨРЧИЛ:
 *   • Жин ЯГ ХЭВЭЭР хуулагдана («keep»).  Хэвийн болгох, дахин тараах,
 *     «засах» гэсэн зүйл АЛГА.  7-оос 2 мэргэжлийг сонговол багийн хувь
 *     41 болж, шинэ төсөл хэзээ ч 41%-иас дээш заахгүй — энэ нь НУУГДАХ
 *     ёсгүй тул `CopyPlan.ceiling_pct` тэр дээд хязгаарыг үргэлж буцаана.
 *   • ГҮЙЦЭТГЭГЧ ба ОГНОО ХЭЗЭЭ Ч хуулагдахгүй: `tasks.assigned_to`,
 *     `task_assignees`, `due_date`, `start_date` — сонголт ч үгүй.
 *     Хуулсан гүйцэтгэгч нь чимээгүйхэн төслийн гишүүнчлэл олгож, «Миний
 *     ажил»-ыг үерлүүлнэ; хуулсан хуучин `due_date` нь эхний өдрөөс бүх
 *     жагсаалтыг улаан болгоод, хугацааны cron баг ахлагч нар руу мэдэгдэл
 *     бөмбөгдөнө.
 *   • МЭДЭГДЭЛ ТЭГ.  `createNotification`-ыг ЭНД ОГТ дуудахгүй —
 *     `lib/pushSweep.ts` мөр бүрийг минутын дотор бодит push болгодог тул
 *     хамгийн том төслийг хуулахад ~1000 push явна.
 * ========================================================================== */

/** `source_project_id`-гийн гинжийг дээш алхах ХЯЗГААР (гогцооны хамгаалалт). */
const COPY_LINK_MAX_HOPS = 20;

/** `null`/`undefined`/массив бус = «энэ түвшинд БҮГД» (төлөвлөгчийн гэрээ). */
function copyIdList(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<number>();
  const out: number[] = [];
  for (const v of raw) {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/**
 * `startId`-аас `source_project_id`-гийн гинжээр ДЭЭШ алхаж `targetId`-д
 * хүрэх эсэх.  Хүрвэл холбоос нь гогцоо үүсгэнэ (409 CYCLE).
 *
 * ⚠️ DB талд ямар ч хамгаалалт БАЙХГҮЙ — миграци 0254 санаатайгаар CHECK
 * нэмээгүй (`projects`-ыг дахин байгуулна гэсэн үг), тул энэ шалгалт нь
 * маршрутын үүрэг.  Өгөгдөлд аль хэдийн гогцоо байвал `seen` зогсооно.
 */
async function sourceChainReaches(
  db: D1Database,
  startId: number,
  targetId: number,
): Promise<boolean> {
  const seen = new Set<number>([startId]);
  let cursor = startId;
  for (let hop = 0; hop < COPY_LINK_MAX_HOPS; hop++) {
    const row: { source_project_id: number | null } | null = await db
      .prepare('SELECT source_project_id FROM projects WHERE id = ?')
      .bind(cursor)
      .first<{ source_project_id: number | null }>();
    const next: number | null = row?.source_project_id ?? null;
    if (next === null) return false;
    if (next === targetId) return true;
    if (seen.has(next)) return false;
    seen.add(next);
    cursor = next;
  }
  return false;
}

/**
 * Төслийн БҮХ бүтцийг устгана — ГҮНЭЭС нь эхлээд, ГАРААР.
 *
 * ⚠️ D1 нь runtime дээр FK-г хэрэгжүүлдэггүй тул `ON DELETE CASCADE` нь
 * маршрутын DELETE-ээс ХЭЗЭЭ Ч асахгүй: `blocks`-ыг ганцаар устгавал
 * зураг/эд анги/ажил өнчирнө.
 *
 * `progress_entries`-ыг САНААТАЙГААР хөндөхгүй — тэр бол түүх, гэрээнд
 * зөвхөн энэ таван түвшин заасан.
 */
async function deleteProjectStructureDeep(db: D1Database, projectId: number): Promise<void> {
  // Түүхтэй хуваарилагдсан таск HAS_PROGRESS хаалтаар аль хэдийн хаагдсан (projection-ийн батлагдсан бичлэг бий) —
  // энд зөвхөн түүхгүй root-ийн хуваарилалтын мөрийг цэвэрлэнэ (өнчин мөр үлдээхгүй).
  await purgeRootsForProject(db, projectId);
  await db
    .prepare(
      `DELETE FROM task_assignees WHERE task_id IN (
         SELECT t.id FROM tasks t
         INNER JOIN components co ON co.id = t.component_id
         INNER JOIN drawings d    ON d.id = co.drawing_id
         INNER JOIN blocks b      ON b.id = d.block_id
         WHERE b.project_id = ?)`,
    )
    .bind(projectId)
    .run();
  await db
    .prepare(
      `DELETE FROM tasks WHERE component_id IN (
         SELECT co.id FROM components co
         INNER JOIN drawings d ON d.id = co.drawing_id
         INNER JOIN blocks b   ON b.id = d.block_id
         WHERE b.project_id = ?)`,
    )
    .bind(projectId)
    .run();
  await db
    .prepare(
      `DELETE FROM components WHERE drawing_id IN (
         SELECT d.id FROM drawings d
         INNER JOIN blocks b ON b.id = d.block_id
         WHERE b.project_id = ?)`,
    )
    .bind(projectId)
    .run();
  await db
    .prepare('DELETE FROM drawings WHERE block_id IN (SELECT id FROM blocks WHERE project_id = ?)')
    .bind(projectId)
    .run();
  await db.prepare('DELETE FROM blocks WHERE project_id = ?').bind(projectId).run();
}

/** НӨХӨН ЦЭВЭРЛЭГЭЭ: зорилтот төслийн УРЬДЫН багийн хувь хэмжээг ЯГ
 *  хэвээр нь эргүүлж тавина.
 *
 *  ⚠️ Бичилтийн зам нь `project_team_shares`-ыг БОЛЗОЛГҮЙ устгаад эх
 *  төслийнхөөр солидог.  Дараагийн түвшин (блок/зураг/эд анги/ажил) унавал
 *  блокуудыг нь буцааж устгадаг байсан ч ростер нь ЭХ ТӨСЛИЙНХӨӨР үлдэж,
 *  «хуулбар бүтэлгүйтлээ» гэсэн хариутай зөрчилддөг байв.  Тиймээс
 *  снапшотыг сэргээх нь нөхөн цэвэрлэгээний ЗААВАЛ байх хэсэг. */
async function restoreTeamShares(
  db: D1Database,
  projectId: number,
  snapshot: { team_id: number; share_percent: number; sort_order: number }[],
): Promise<void> {
  await db.prepare('DELETE FROM project_team_shares WHERE project_id = ?').bind(projectId).run();
  if (snapshot.length === 0) return;
  const stmt = db.prepare(
    'INSERT INTO project_team_shares (project_id, team_id, share_percent, sort_order) VALUES (?, ?, ?, ?)',
  );
  await copyRunBatched(
    db,
    snapshot.map((s) => stmt.bind(projectId, s.team_id, s.share_percent, s.sort_order)),
  );
}

projects.post('/:id/copy-structure', requireManager(), async (c) => {
  const targetId = parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return c.json({ error: 'Invalid project id', code: 'BAD_REQUEST' }, 400);
  }

  const body = await c.req.json<CopyStructureRequest>().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Invalid JSON body', code: 'BAD_REQUEST' }, 400);
  }

  const sourceId = Number(body.source_project_id);
  if (!Number.isInteger(sourceId) || sourceId <= 0) {
    return c.json({ error: 'source_project_id is required', code: 'BAD_REQUEST' }, 400);
  }
  if (sourceId === targetId) {
    return c.json({ error: 'Эх ба зорилтот төсөл ижил байна', code: 'SAME_PROJECT' }, 400);
  }

  const rawSelection = body.selection;
  if (rawSelection !== undefined && rawSelection !== null && typeof rawSelection !== 'object') {
    return c.json({ error: 'Invalid selection', code: 'BAD_REQUEST' }, 400);
  }
  const selection: CopySelection = {
    team_ids: copyIdList(rawSelection?.team_ids),
    block_ids: copyIdList(rawSelection?.block_ids),
    drawing_ids: copyIdList(rawSelection?.drawing_ids),
    component_ids: copyIdList(rawSelection?.component_ids),
    task_ids: copyIdList(rawSelection?.task_ids),
  };

  const dryRun = body.dry_run === true;
  const wantLink = body.link !== false;
  const confirmReplace = body.confirm_replace === true;
  const db = c.env.DB;

  /* ── (a) УРЬДЧИЛСАН ШАЛГАЛТ — энэ бүхэн давахаас нааш ЮУ Ч бичихгүй ── */

  const projRes = await db
    .prepare('SELECT id, asr_only, source_project_id FROM projects WHERE id IN (?, ?)')
    .bind(sourceId, targetId)
    .all<{ id: number; asr_only: number | null; source_project_id: number | null }>();
  const projRows = projRes.results ?? [];
  const source = projRows.find((r) => r.id === sourceId);
  const target = projRows.find((r) => r.id === targetId);
  if (!source) return c.json({ error: 'Эх төсөл олдсонгүй', code: 'SOURCE_NOT_FOUND' }, 404);
  if (!target) return c.json({ error: 'Зорилтот төсөл олдсонгүй', code: 'TARGET_NOT_FOUND' }, 404);

  // Зохиогчийн хяналтын БҮРХҮҮЛ төсөлд ажлын мод байх ёсгүй (lib/asrTargets.ts).
  if ((target.asr_only ?? 0) === 1) {
    return c.json(
      { error: 'Зохиогчийн хяналтын төсөлд бүтэц хуулж болохгүй', code: 'TARGET_ASR_ONLY' },
      400,
    );
  }

  if (await sourceChainReaches(db, sourceId, targetId)) {
    return c.json({ error: 'Гогцоо үүсэх тул хуулж болохгүй', code: 'CYCLE' }, 409);
  }

  /* ⚠️ ALREADY_LINKED-ийг ЭНД шалгахаа БОЛИВ — доор, зорилтот төслийн
   * блокуудыг уншсаны дараа шалгана.  Учир нь үүсгэх цонх нь төслийг
   * ҮҮСГЭХ мөчид `source_project_id`-г бичдэг (эзний шийдвэр #4: шифр,
   * захиалагч, complexity_pct өвлөнө), тиймээс болзолгүй шалгалт нь
   * «А-гаас үүсгээд Б-гээс бүтэц татах» хэрэглээг МӨНХӨД хаадаг байв —
   * холбоосыг цэвэрлэх UI ч байхгүй.  Бүтэцгүй төсөл дээр өөр эх төсөл
   * сонгох нь зүгээр л ЗАССАН сонголт. */

  /* ── (b) Эх модыг (+ багийн хувь) уншина — `lib/structureCopyWrite.ts`
   * `loadCopySourceTree` (ангиллын загвар ч ЯГ энэ уншигчийг хэрэглэнэ).
   * Зорилтот төслийн хоёр уншилт түүнтэй ЗЭРЭГЦЭЭ. */
  const [tree, targetBlocksRes, targetSharesRes] = await Promise.all([
    loadCopySourceTree(db, sourceId),
    db.prepare('SELECT id FROM blocks WHERE project_id = ?').bind(targetId).all<{ id: number }>(),
    /* Зорилтот төслийн ОДООГИЙН ростерын СНАПШОТ.  Бичилтийн зам үүнийг
     * бүхэлд нь устгаж эх төслийнхөөр солино; дараагийн түвшин унавал
     * `restoreTeamShares` нь ЯГ эдгээр мөрийг эргүүлж тавина. */
    db
      .prepare(
        `SELECT team_id, share_percent, COALESCE(sort_order, 0) AS sort_order
         FROM project_team_shares WHERE project_id = ? ORDER BY sort_order, id`,
      )
      .bind(targetId)
      .all<{ team_id: number; share_percent: number; sort_order: number }>(),
  ]);

  const targetBlockIds = (targetBlocksRes.results ?? []).map((r) => r.id);
  const targetShares = targetSharesRes.results ?? [];

  /* ── (b2) ЗОРИЛТОТ ТӨСЛИЙН ТӨЛӨВӨӨС ХАМААРАХ ХААЛТУУД.
   * Хоёулаа `dry_run` дээр ч ажиллана — хэрэглэгч «Хуулах» дарахаас ӨМНӨ
   * боломжгүй гэдгээ мэдэх ёстой. */

  /* D2: холбоос нь ЗӨВХӨН зорилтот төсөл ӨӨР эх төслөөс ирсэн БҮТЭЦТЭЙ үед
   * саад болно.  Бүтэцгүй бол холбоос нь зүгээр л үүсгэх цонхны өвлүүлсэн
   * анхдагч утга тул засагдана (доорх UPDATE нь болзолгүй дарж бичнэ).
   *
   * `confirm_replace` нь ЧУХАМ бэлэн бүтцийг солихын тулд байдаг тул түүнийг
   * ч гарц болгоно — эс бөгөөс «А-гаас буруу татчихлаа, Б-гээс дахин татъя»
   * гэдэг нь ЯМАР Ч замгүй мухардал болно (холбоосыг цэвэрлэх UI байхгүй).
   * Аюулгүй байдлыг дээрх D1 (`HAS_PROGRESS`) хаалт хангана: батлагдсан
   * ахицтай төсөл энэ мөр хүртэл ХЭЗЭЭ Ч хүрэхгүй. */
  if (
    target.source_project_id !== null &&
    target.source_project_id !== sourceId &&
    targetBlockIds.length > 0 &&
    !confirmReplace
  ) {
    return c.json(
      { error: 'Энэ төсөл ӨӨР эх төслөөс бүтцээ аль хэдийн авсан', code: 'ALREADY_LINKED' },
      409,
    );
  }

  /* D1: БАТЛАГДСАН АХИЦТАЙ төслийн бүтцийг ХЭЗЭЭ Ч солихгүй.
   *
   * ⚠️ Шалтгаан нь зөвхөн «мод устана» биш, ОНООНЫ ДЭВТЭР:
   * `deleteProjectStructureDeep` нь ажлуудыг устгахад тэдгээрийн
   * `progress_entries` өнчирнө (D1 нь runtime дээр FK хэрэгжүүлдэггүй тул
   * мөрүүд нь ҮЛДЭНЭ), төгсгөлд дуудагдах `recalculateProjectPoints` нь
   * төслийн `source='progress'` бүх `user_points` зүсмийг устгачихаад
   * дахин тоглуулах ажил нь алга болсон тул ЮУ Ч сэргээж чадахгүй —
   * ажилтнууд аль хэдийн батлагдсан оноогоо чимээгүйхэн алдана.
   *
   * Энэ хаалт нь `confirm_replace`-ыг АЮУЛГҮЙ болгодог: үүнээс хойш
   * «дарж бичих» нь зөвхөн ХЭРЭГЛЭГДЭЭГҮЙ ноорог модыг л устгана. */
  if (targetBlockIds.length > 0) {
    const progressRow = await db
      .prepare(
        `SELECT 1 AS one FROM progress_entries pe
         INNER JOIN tasks t       ON t.id = pe.task_id
         INNER JOIN components co ON co.id = t.component_id
         INNER JOIN drawings d    ON d.id = co.drawing_id
         INNER JOIN blocks b      ON b.id = d.block_id
         WHERE b.project_id = ? AND pe.status = 'approved'
         LIMIT 1`,
      )
      .bind(targetId)
      .first<{ one: number }>();
    if (progressRow) {
      return c.json(
        {
          error:
            'Энэ төсөлд батлагдсан ахиц бүртгэгдсэн тул бүтцийг нь солих боломжгүй. Шинэ төсөл дээр татна уу.',
          code: 'HAS_PROGRESS',
        },
        409,
      );
    }
    // Хуваарилагдсан (managed) таск дээр цаг/хуваарилалтын түүх бий бол (явцын бичлэггүй ч) бүтцийг солихыг хаана —
    // `purgeRootsForProject` түүхийг ч устгадаг тул энд ЭХЛЭЭД хамгаална.
    const rootsProtected = await protectedRootsIn(db, { kind: 'project', id: targetId });
    if (rootsProtected.length > 0) {
      return c.json({ error: ROOT_PROTECTED_MESSAGE, code: 'ROOT_PROTECTED', task_ids: rootsProtected }, 409);
    }
  }

  /* ── (c) Төлөвлөгөө.  Урьдчилсан харалт ба бодит бичилт ХОЁУЛАА ЯГ
   * ЭНЭ объектоос гарна — хэрэглэгчийн харсан тоо, бичигдсэн мөр зөрөхгүй. */
  const plan = planStructureCopy(tree, selection);

  if (plan.blocks.length === 0) {
    return c.json({ error: 'Хуулах юу ч сонгогдоогүй', code: 'NO_SELECTION' }, 400);
  }
  if (plan.counts.tasks > MAX_COPY_TASKS) {
    return c.json(
      {
        error: `Хэт олон ажил: ${plan.counts.tasks} (дээд хязгаар ${MAX_COPY_TASKS})`,
        code: 'TOO_LARGE',
      },
      413,
    );
  }

  /* ── (c2) D4b: РОСТЕР БҮХЭЛДЭЭ СОЛИГДОНО гэдгийг хариунд ИЛ хэлнэ.
   * `NOT_EMPTY` нь зөвхөн БЛОК тоолдог тул блокгүй мөртлөө гараар
   * тохируулсан ростертой төсөл (энгийн дараалал: эхлээд хувь, дараа нь
   * блок) ЯМАР Ч анхааруулгагүйгээр устдаг байв.  UI нь эндээс
   * `copyStructure.rosterNotice`-г, баталгаажуулах цонхны шинэ бичвэрийг
   * гаргана. */
  const roster = {
    /** Үргэлж ҮНЭН: доорх бичилт ростерыг БОЛЗОЛГҮЙ дарж бичнэ. */
    replaced: true,
    /** Устах гэж буй ОДООГИЙН мөрийн тоо. */
    target_count: targetShares.length,
    /** Оронд нь орох ЭХ төслийн мөрийн тоо. */
    source_count: plan.team_shares.length,
  };

  /* `dry_run` нь ЮУ Ч бичихгүй.  ⚠️ `NOT_EMPTY`-г ЭНД САНААТАЙГААР
   * шалгахгүй: урьдчилсан харалт нь `confirm_replace` илгээдэггүй тул
   * бүтэцтэй төсөл дээр 409 өгвөл UI-ийн «Хуулах» товч мөнхөд идэвхгүй
   * болно (`CopyStructureSheet.tsx` нь `previewError !== null` үед түгжинэ).
   * Дарж бичихийг баталгаажуулах цонх нь бодит хуулбар дээр ажиллана. */
  if (dryRun) return c.json({ plan, roster });

  if (targetBlockIds.length > 0 && !confirmReplace) {
    return c.json({ error: 'Зорилтот төсөлд бүтэц аль хэдийн байна', code: 'NOT_EMPTY' }, 409);
  }

  /* ── (d)–(g) БИЧИЛТ.  Эндээс цааш алдвал нөхөн цэвэрлэнэ. ── */
  const createdBlockIds: number[] = [];
  /** Ростерыг устгаж эхэлсэн үү?  Нөхөн цэвэрлэгээ ЗӨВХӨН үнэн үед сэргээнэ
   *  (DELETE нь өөрөө унасан бол сэргээх юм алга). */
  let rosterTouched = false;
  /* Зорилтот төслийн ӨМНӨХ мод устсан эсэх.  Устсан бол нөхөн цэвэрлэгээ
   * түүнийг ХЭЗЭЭ Ч эргүүлж чадахгүй (хуулбар нь байхгүй) — хариу нь үүнийг
   * ҮНЭНЭЭР хэлэх ёстой, «бүх юм байрандаа» гэж худлаа хэлж болохгүй. */
  let priorStructureWiped = false;
  let linked = false;
  try {
    if (targetBlockIds.length > 0) {
      await deleteProjectStructureDeep(db, targetId);
      priorStructureWiped = true;
    }

    /* (e) БАГИЙН ХУВЬ нь БЛОКООС ӨМНӨ.  Энэ дараалал АЧААЛАЛ ҮҮРНЭ:
     * `PUT /api/blocks/:id` нь блокийн `team_id`-г ӨӨРЧИЛЖ ЧАДАХГҮЙ
     * (blocks.ts зөвхөн name + weight_percent зөвшөөрнө), `removeTeamShare`
     * нь блоктой багийг хасахаас татгалздаг — тиймээс ростерт байхгүй
     * баг дор буусан блок «Бусад» хуурмаг табд мөнхөд гацаж, устгахаас
     * өөр гарц үлдэхгүй.
     *
     * Түүнчлэн төсөл үүсэхэд ангиллын 7 багийн ростер АВТОМАТААР суусан
     * байдаг — энэ DELETE нь тэрхүү ростерыг зөвхөн хуулагдсан багуудаар,
     * ЭХ хувиар нь солино.  Эзний сонгосон «үнэнч» 100-аас доош дээд
     * хязгаар яг эндээс төрнө.
     *
     * `created_at`/`updated_at`-ыг bind ХИЙХГҮЙ — DEFAULT-аар нь. */
    await db.prepare('DELETE FROM project_team_shares WHERE project_id = ?').bind(targetId).run();
    rosterTouched = true;
    if (plan.team_shares.length > 0) {
      const shareStmt = db.prepare(
        'INSERT INTO project_team_shares (project_id, team_id, share_percent, sort_order) VALUES (?, ?, ?, ?)',
      );
      await copyRunBatched(
        db,
        plan.team_shares.map((ts) =>
          shareStmt.bind(targetId, ts.team_id, ts.share_percent, ts.sort_order),
        ),
      );
    }

    /* (f) Блок → зураг → эд анги → ажил, ТҮВШИН ТҮВШНЭЭР —
     * `lib/structureCopyWrite.ts` `insertPlannedStructure` (ангиллын загвар
     * ч ЯГ энэ бичигчийг хэрэглэнэ).  ⚠️ `createdBlockIds`-ыг ШУУД
     * дамжуулна: хэсэглэсэн `db.batch()`-ийн N дахь хэсэг унахад 1..N-1
     * хэсгийн блокууд аль хэдийн commit хийгдсэн байдаг тул catch дэх нөхөн
     * цэвэрлэгээ тэдгээрийг ХАРЖ байх ёстой.  Гүйцэтгэгч, огноо хуулагдахгүй,
     * мэдэгдэл ТЭГ (эзний шийдвэр). */
    await insertPlannedStructure(db, targetId, plan, createdBlockIds);

    /* (g) Холбоос.  ⚠️ `AND source_project_id IS NULL` нь БАЙХГҮЙ (D2):
     * үүсгэх цонх төслийг үүсэх мөчид А-тай холбочихсон байхад admin Б-гээс
     * бүтэц татвал хуучин холбоос нь чимээгүйхэн үлдэж, `source_project_name`
     * нь БУРУУ донорыг заасаар байв.  Бүтцээ хаанаас авсан бол ЯГ тэр л
     * бичигдэнэ.  (Гогцоо ба өөрийгөө заах шалгалт нь дээр аль хэдийн
     * гарсан тул энд дарж бичих нь аюулгүй.) */
    if (wantLink) {
      const upd = await db
        .prepare(
          "UPDATE projects SET source_project_id = ?, updated_at = datetime('now') WHERE id = ?",
        )
        .bind(sourceId, targetId)
        .run();
      linked = (upd.meta?.changes ?? 0) > 0 || target.source_project_id === sourceId;
    }
  } catch (err) {
    console.error(`copy-structure failed for project ${targetId}:`, err);
    /* (j) НӨХӨН ЦЭВЭРЛЭГЭЭ — гүнээс нь, ЯГ энэ хүсэлтийн үүсгэсэн id-гаар.
     * Цэвэрлэгээ ӨӨРӨӨ уначихвал л `PARTIAL` буцаана: хариу нь юу үлдсэнийг
     * ҮНЭНЭЭР хэлэх ёстой. */
    try {
      await deleteCreatedBlocksDeep(db, createdBlockIds);
      /* Ростерыг ч БУЦААНА (D4a) — эс бөгөөс «хуулбар бүтэлгүйтлээ» гэсэн
       * хариу өгчихөөд төсөл дээр ЭХ ТӨСЛИЙН багийн хувь үлдэнэ. */
      if (rosterTouched) await restoreTeamShares(db, targetId, targetShares);
    } catch (cleanupErr) {
      console.error(`copy-structure cleanup failed for project ${targetId}:`, cleanupErr);
      return c.json(
        {
          error: 'Хуулбар бүтэлгүйтэж, нөхөн цэвэрлэгээ ч амжилтгүй боллоо',
          code: 'PARTIAL',
          partial: true,
          created: { block_ids: createdBlockIds },
          roster: { ...roster, restored: false },
          prior_structure_lost: priorStructureWiped,
        },
        500,
      );
    }
    /* Цэвэрлэгээ амжилттай — ЭНЭ хүсэлтийн үүсгэсэн блокууд устаж, ростер
     * эргэж орлоо.  ⚠️ ГЭХДЭЭ `confirm_replace`-ээр зорилтот төслийн ӨМНӨХ
     * мод устсан бол түүнийг сэргээх БОЛОМЖГҮЙ (хуулбар нь хаана ч алга).
     * Тиймээс `prior_structure_lost` нь UI-д яг юу болсныг хэлнэ — «алдаа
     * гарлаа, бүх юм байрандаа» гэсэн худал мессеж хамгийн муу хувилбар. */
    return c.json(
      {
        error: priorStructureWiped
          ? 'Бүтэц хуулахад алдаа гарлаа. Төслийн ӨМНӨХ бүтэц устсан тул дахин хуулна уу.'
          : 'Бүтэц хуулахад алдаа гарлаа',
        code: 'COPY_FAILED',
        roster: { ...roster, restored: rosterTouched },
        prior_structure_lost: priorStructureWiped,
      },
      500,
    );
  }

  /* (h) Багийн хувь ба жин хоёулаа солигдсон тул онооны дэвтрийг дахин
   * тооцно.  Хамгийн сайндаа — уначихвал (аль хэдийн бичигдсэн) хуулбарыг
   * унагаах ёсгүй (blocks.ts:656-ийн загвар). */
  try {
    await recalculateProjectPoints(db, targetId);
  } catch (err) {
    console.error(`recalculateProjectPoints failed for project ${targetId}:`, err);
  }

  return c.json({ plan, created: { block_ids: createdBlockIds }, linked, roster });
});

/**
 * GET /api/projects/:id/derived — энэ төслөөс бүтцээ хуулж авсан БҮХ
 * үр төсөл (шууд болон дамжсан).
 *
 * Рекурсив CTE, гүн 10-аар хязгаарлав.  `UNION` (ALL БИШ) + `depth < 10`
 * хоёр нь гогцоотой өгөгдөл дээр ч query-г зогсооно.  Үндсэн төслөө өөрөө
 * хасна.  Шинэ нь дээр.
 *
 * ⚠️ `GROUP BY p.id` нь ЧИМЭГ БИШ.  `UNION` нь МӨРИЙГ (id, depth) хосоор
 * нь давхардуулдаг тул гогцоо (A→B→A) үед нэг төсөл ӨӨР ӨӨР гүнтэйгээр
 * 3-4 удаа гарч ирнэ — бодит sqlite дээр хэмжив.  Маршрутын 409 CYCLE нь
 * шинэ гогцоо үүсгэхийг хаадаг ч, гараар засагдсан хуучин өгөгдөл ийм
 * байж болзошгүй тул уншилтын тал ч өөрийгөө хамгаална.
 */
projects.get('/:id/derived', requireManager(), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'Invalid project id', code: 'BAD_REQUEST' }, 400);
  }

  const { results } = await c.env.DB.prepare(
    `
    WITH RECURSIVE lineage(id, depth) AS (
      SELECT id, 0 FROM projects WHERE id = ?
      UNION
      SELECT p.id, l.depth + 1
      FROM projects p
      INNER JOIN lineage l ON p.source_project_id = l.id
      WHERE l.depth < 10
    )
    SELECT p.id, p.name, p.display_title, p.category, p.status, p.created_at,
           p.source_project_id,
           (SELECT COUNT(*)
              FROM tasks t
              INNER JOIN components co ON co.id = t.component_id
              INNER JOIN drawings d    ON d.id = co.drawing_id
              INNER JOIN blocks b      ON b.id = d.block_id
             WHERE b.project_id = p.id) AS task_count
    FROM lineage l
    INNER JOIN projects p ON p.id = l.id
    WHERE l.id != ?
    GROUP BY p.id
    ORDER BY p.created_at DESC, p.id DESC
  `,
  )
    .bind(id, id)
    .all();

  return c.json({ projects: results ?? [] });
});

// DELETE /api/projects/:id/members/:userId (admin only)
projects.delete('/:id/members/:userId', requireManager(), async (c) => {
  const projectId = parseInt(c.req.param('id'), 10);
  const userId = parseInt(c.req.param('userId'), 10);

  await c.env.DB.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?')
    .bind(projectId, userId)
    .run();

  return c.json({ message: 'Member removed' });
});

// PUT /api/projects/:id/blocks/:blockId/responsible — блокийн ХАРИУЦАГЧ нэрийг
// тохируулна (чөлөөт текст).  Зөвхөн admin/senior.  Логикгүй — нэр л хадгална.
// Body: { name }.  name хоосон/null бол хариуцагчгүй болгоно.
projects.put('/:id/blocks/:blockId/responsible', requireManager(), async (c) => {
  const projectId = parseInt(c.req.param('id'), 10);
  const blockId = parseInt(c.req.param('blockId'), 10);
  if (!Number.isFinite(projectId) || !Number.isFinite(blockId)) {
    return c.json({ error: 'Invalid id' }, 400);
  }
  const body = await c.req
    .json<{ name?: string | null }>()
    .catch(() => ({}) as { name?: string | null });
  const trimmed = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : '';
  const value = trimmed.length > 0 ? trimmed : null;
  const res = await c.env.DB.prepare(
    `UPDATE blocks SET responsible_name = ? WHERE id = ? AND project_id = ?`,
  )
    .bind(value, blockId, projectId)
    .run();
  if ((res.meta?.changes ?? 0) === 0) {
    return c.json({ error: 'Блок олдсонгүй' }, 404);
  }
  return c.json({ ok: true, responsible_name: value });
});

/* GET /api/projects/:id/activity — recent progress entries scoped to a single
 * project, used by the project page's Activity tab. Returns entries newest
 * first along with the actor, the task they updated, and its drawing/block
 * breadcrumb so the UI can render a "who did what, where" feed without an
 * extra round-trip per row. Status is included so we can colour pending vs
 * approved vs rejected differently. Limit is bounded server-side to keep
 * the payload predictable. */
projects.get('/:id/activity', async (c) => {
  const projectId = parseInt(c.req.param('id'), 10);
  if (!(await guardClientProject(c.env.DB, c.get('user'), projectId))) {
    return c.json({ error: 'Access denied' }, 403);
  }
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '40', 10) || 40));

  const { results } = await c.env.DB.prepare(
    `
      SELECT pe.id,
      pe.user_id,
      pe.task_id,
      pe.percentage,
      pe.date,
      pe.notes,
      pe.status,
      pe.is_rest_day,
      pe.created_at,
      pe.reviewed_at,
      pe.reviewed_by,
      u.full_name AS user_name,
      u.team_code AS user_team_code,
      reviewer.full_name AS reviewer_name,
      t.name AS task_name,
      d.name AS drawing_name,
      b.name AS block_name,
      b.id   AS block_id
    FROM progress_entries pe
    INNER JOIN users u      ON u.id = pe.user_id
    LEFT JOIN users reviewer ON reviewer.id = pe.reviewed_by
    LEFT  JOIN tasks t      ON t.id = pe.task_id
    LEFT  JOIN components c ON c.id = t.component_id
    LEFT  JOIN drawings d   ON d.id = c.drawing_id
    LEFT  JOIN blocks b     ON b.id = d.block_id
    WHERE b.project_id = ? AND COALESCE(pe.source, '') <> 'alloc_adj'
    ORDER BY pe.created_at DESC, pe.id DESC
    LIMIT ?
  `,
  )
    .bind(projectId, limit)
    .all();

  return c.json({ entries: results });
});

/**
 * Fast version of getProjectHierarchy: performs a constant number of queries
 * (6 total, ran in parallel) regardless of project depth/size, then assembles
 * the hierarchy in-memory.  Previously this used nested Promise.all loops, one
 * query per node, which was the main source of slowness on the projects page.
 */
export async function getProjectHierarchyFast(db: D1Database, projectId: number) {
  const [blocksRes, drawingsRes, componentsRes, tasksRes, progressRes, taskAssigneesRes] =
    await Promise.all([
      db
        .prepare('SELECT * FROM blocks WHERE project_id = ? ORDER BY sort_order')
        .bind(projectId)
        .all<BlockRow>(),
      db
        .prepare(
          `
      SELECT d.* FROM drawings d
      INNER JOIN blocks b ON b.id = d.block_id
      WHERE b.project_id = ? ORDER BY d.sort_order
    `,
        )
        .bind(projectId)
        .all<DrawingRow>(),
      db
        .prepare(
          `
      SELECT c.* FROM components c
      INNER JOIN drawings d ON d.id = c.drawing_id
      INNER JOIN blocks b ON b.id = d.block_id
      WHERE b.project_id = ? ORDER BY c.sort_order
    `,
        )
        .bind(projectId)
        .all<ComponentRow>(),
      db
        .prepare(
          `
      SELECT t.*, u.full_name AS assigned_name, cv.root_task_id AS retired_into FROM tasks t
      INNER JOIN components c ON c.id = t.component_id
      INNER JOIN drawings d ON d.id = c.drawing_id
      INNER JOIN blocks b ON b.id = d.block_id
      LEFT JOIN users u ON u.id = t.assigned_to
      LEFT JOIN task_conversion_members cm ON cm.task_id = t.id AND cm.role = 'retired'
      LEFT JOIN task_conversions cv ON cv.id = cm.conversion_id AND cv.status = 'applied'
      -- Хөрвүүлэлтээр root-д нэгтгэгдсэн хэсэг (0385) шатлалд ОРОХГҮЙ: жин 0, явц/цаг/оноо root дээр.  Блок/зургийн картын тоо, график,
      -- багийн статистик, захиалагчийн тайлан, MCP бүгд ЭНЭ ганц эх сурвалжаас авдаг тул нэг газар шүүнэ (түүх нь progress_entries-д хэвээр).
      WHERE b.project_id = ? AND cv.id IS NULL ORDER BY t.sort_order
    `,
        )
        .bind(projectId)
        .all<TaskRow & { assigned_name: string | null; retired_into: number | null }>(),
      // Latest approved progress entry for every task in this project.
      db
        .prepare(
          `
      WITH scoped_tasks AS (
        SELECT t.id FROM tasks t
        INNER JOIN components c ON c.id = t.component_id
        INNER JOIN drawings d ON d.id = c.drawing_id
        INNER JOIN blocks b ON b.id = d.block_id
        WHERE b.project_id = ?
      )
      SELECT pe.task_id, pe.percentage, pe.user_id, pe.reviewed_by, pe.reviewed_at,
             reviewer.full_name AS reviewer_name
      FROM progress_entries pe
      LEFT JOIN users reviewer ON reviewer.id = pe.reviewed_by
      WHERE pe.status = 'approved'
        AND pe.task_id IN (SELECT id FROM scoped_tasks)
        AND pe.id = (
          SELECT id FROM progress_entries x
          WHERE x.task_id = pe.task_id AND x.status = 'approved'
          ORDER BY x.created_at DESC, x.id DESC LIMIT 1)
    `,
        )
        .bind(projectId)
        .all<{
          task_id: number;
          percentage: number;
          user_id: number;
          reviewed_by: number | null;
          reviewed_at: string | null;
          reviewer_name: string | null;
        }>(),

      db
        .prepare(
          `
      SELECT ta.task_id, ta.user_id, u.full_name, u.profile_image,
             u.team_id, pt.code AS team_code, pt.name_mn AS team_name_mn
      FROM task_assignees ta
      INNER JOIN tasks t ON t.id = ta.task_id
      INNER JOIN components c ON c.id = t.component_id
      INNER JOIN drawings d ON d.id = c.drawing_id
      INNER JOIN blocks b ON b.id = d.block_id
      INNER JOIN users u ON u.id = ta.user_id
      LEFT JOIN user_teams ut_p ON ut_p.user_id = u.id AND ut_p.is_primary = 1
      LEFT JOIN teams pt ON pt.id = ut_p.team_id
      WHERE b.project_id = ?
    `,
        )
        .bind(projectId)
        .all<{
          task_id: number;
          user_id: number;
          full_name: string;
          profile_image: string | null;
          team_id: number | null;
          team_code: string | null;
          team_name_mn: string | null;
        }>(),
    ]);

  type AssigneeInfo = {
    user_id: number;
    full_name: string;
    profile_image: string | null;
    team_id: number | null;
    team_code: string | null;
    team_name_mn: string | null;
  };
  const taskAssigneesById = new Map<number, AssigneeInfo[]>();
  for (const row of taskAssigneesRes.results) {
    const arr = taskAssigneesById.get(row.task_id) ?? [];
    arr.push({
      user_id: row.user_id,
      full_name: row.full_name,
      profile_image: row.profile_image,
      team_id: row.team_id,
      team_code: row.team_code,
      team_name_mn: row.team_name_mn,
    });
    taskAssigneesById.set(row.task_id, arr);
  }

  type LatestProgress = {
    percentage: number;
    reviewer_name: string | null;
    reviewed_at: string | null;
  };
  const latestTask = new Map<number, LatestProgress>();
  for (const row of progressRes.results) {
    if (row.task_id == null) continue;
    const showReviewer =
      row.reviewed_by != null && row.reviewer_name && row.reviewed_by !== row.user_id;
    latestTask.set(row.task_id, {
      percentage: row.percentage,
      reviewer_name: showReviewer ? row.reviewer_name : null,
      reviewed_at: showReviewer ? row.reviewed_at : null,
    });
  }

  const leafW = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  type TaskEnriched = TaskRow & {
    assigned_name: string | null;
    progress: number;
    assignees: AssigneeInfo[];
    reviewer_name: string | null;
    reviewed_at: string | null;
  };
  const tasksByComponent = new Map<number, TaskEnriched[]>();
  for (const t of tasksRes.results) {
    const latest = latestTask.get(t.id);
    const enriched: TaskEnriched = {
      ...t,
      progress: latest?.percentage ?? 0,
      reviewer_name: latest?.reviewer_name ?? null,
      reviewed_at: latest?.reviewed_at ?? null,
      assignees: taskAssigneesById.get(t.id) ?? [],
    };
    const arr = tasksByComponent.get(t.component_id) ?? [];
    arr.push(enriched);
    tasksByComponent.set(t.component_id, arr);
  }

  type ComponentEnriched = ComponentRow & { progress: number; tasks: TaskEnriched[] };
  const componentsByDrawing = new Map<number, ComponentEnriched[]>();
  for (const comp of componentsRes.results) {
    const tasks = tasksByComponent.get(comp.id) ?? [];
    // Component progress = simple weighted avg of its tasks (informational
    // only; the rollup aggregates task weights straight under the drawing).
    let tw = 0;
    let acc = 0;
    for (const t of tasks) {
      const w = Math.max(0, leafW(t.weight_percent));
      tw += w;
      acc += w * t.progress;
    }
    const progress = tw > 0 ? acc / tw : 0;
    const enriched: ComponentEnriched = { ...comp, progress, tasks };
    const arr = componentsByDrawing.get(comp.drawing_id) ?? [];
    arr.push(enriched);
    componentsByDrawing.set(comp.drawing_id, arr);
  }

  type DrawingEnriched = DrawingRow & { progress: number; components: ComponentEnriched[] };
  const drawingsByBlock = new Map<number, DrawingEnriched[]>();
  for (const d of drawingsRes.results) {
    const components = componentsByDrawing.get(d.id) ?? [];
    // Drawing progress = Σ(task.w × task.p) / drawing.weight_percent — the
    // drawing's ЗАРЛАСАН төсөв, not the task weight that happens to exist.
    // Дутуу жин нь бүртгэгдээгүй буюу хийгдээгүй ажил гэж тоологдоно.
    // Төсөв 0 бол зураг бүхэлдээ 0% (PROJECT_LIST_SQL-ийн `NULLIF` ба
    // calcProjectProgress-ийн `ELSE 0` хаалттай ижил).
    const dBudget = Math.max(0, leafW(d.weight_percent));
    let acc = 0;
    for (const c of components) {
      for (const t of c.tasks ?? []) {
        acc += Math.max(0, leafW(t.weight_percent)) * t.progress;
      }
    }
    const progress = dBudget > 0 ? acc / dBudget : 0;
    const enriched: DrawingEnriched = { ...d, progress, components };
    const arr = drawingsByBlock.get(d.block_id) ?? [];
    arr.push(enriched);
    drawingsByBlock.set(d.block_id, arr);
  }

  return blocksRes.results.map((b) => {
    const drawings = drawingsByBlock.get(b.id) ?? [];
    // Block progress = Σ(drawing.w × drawing.p) / 100 — блокийн ЗАРЛАСАН
    // төсөв.  Зургийн жингийн нийлбэр 100 хүрээгүй бол дутуу нь хийгдээгүй
    // ажил гэж үлдэнэ (PROJECT_LIST_SQL-ийн `block_prog`-той ижил).
    let dAcc = 0;
    for (const d of drawings) {
      dAcc += Math.max(0, leafW(d.weight_percent)) * (d?.progress ?? 0);
    }
    const progress = dAcc / 100;
    return { ...b, progress, drawings };
  });
}

/* ============================================================
 *  Project passport (cover-sheet metadata)
 * ============================================================
 *  Read: any project member (engineers see it on the staff side,
 *        clients see a read-only copy through /project-chat overview).
 *  Write: admin + senior (эзний шийдвэр 2026-09-02 — төслийг эхлүүлж буй
 *         багийн ахлах өөрөө бөглөнө). requireManager()-д төслийн
 *         гишүүнчлэлийн шалгалт БАЙХГҮЙ — блок / жин / багийн хуваарьт
 *         аль хэдийн байгаа ижил хүрээ.
 *
 *  We always upsert: there is at most one passport row per project,
 *  so callers don't need to differentiate POST vs PUT. */
export type PassportRow = {
  project_id: number;
  full_title: string | null;
  drawing_no: string | null;
  /** «Doc. No.» — БҮХЭЛД НЬ гараар бичигдэх чөлөөт текст (миграц 0246).
   *  Дугаарын хэсгүүд төсөл бүрт өөр тул үүсгэгч БАЙХГҮЙ; `drawing_no`
   *  (Зургийн шифр) нь өөр талбар бөгөөд тайланд хоёулаа хэвлэгдэнэ. */
  doc_no: string | null;
  scope: string | null;
  director: string | null;
  /** @deprecated single-line legacy field — replaced by `client_contacts_json`. */
  client_pm: string | null;
  start_date: string | null;
  finish_date: string | null;
  extension_date: string | null;
  /** @deprecated meeting schedule has been removed from the UI. */
  meeting_30: string | null;
  /** @deprecated meeting schedule has been removed from the UI. */
  meeting_50: string | null;
  /** @deprecated meeting schedule has been removed from the UI. */
  meeting_100: string | null;
  disciplines_json: string | null;
  client_contacts_json: string | null;
  /** «1.2 Хамрах хүрээ» хүснэгт (миграц 0247) — PassportScopeRow[]. */
  scope_rows_json: string | null;
  /** «1.3 Төслийн хугацаа» зүүн хүснэгт (0247) — PassportTimelineRow[]. */
  timeline_json: string | null;
  /** «1.3 Уулзалтын хуваарь» баруун хүснэгт (0247) — PassportMeetingRow[]. */
  meetings_json: string | null;
  notes: string | null;
  updated_at: string;
  updated_by_id: number | null;
};

/* ============================================================
 *  Word загварын 1.2 / 1.3 мөрүүд
 * ============================================================
 *  Эдгээр нь ХӨДӨЛГӨӨНТ УРТТАЙ хүснэгт учир JSON-оор хадгална
 *  (`disciplines_json` / `client_contacts_json`-той ижил хэв маяг).
 *  SQL-ээр хайгддаггүй тул багана болгох шаардлагагүй — харин 1.3-ын
 *  огноонууд нь `start_date`/`finish_date`/`extension_date` БАГАНА руу
 *  давхар бичигдэнэ, учир нь `deadlines.ts` ба `company.ts` тэднийг
 *  JOIN/ORDER BY-д хэрэглэдэг.
 *
 *  ⚠️ frontend `shared/types/index.ts`-ийн `ProjectScopeRow` /
 *  `ProjectTimelineRow` / `ProjectMeetingRow`-той ИЖРҮҮД — талбарын нэр
 *  зөрвөл чимээгүй `undefined` болно (JSON дээр тип шалгалт байхгүй). */
export interface PassportScopeRow {
  id: string;
  /** Дисциплины машины код (BA, BB…). */
  code: string;
  /** Гараар давхар бичсэн шошго; хоосон бол `code`-оос гарна. */
  codeLabel: string;
  identification: string;
  /** «Team leader» — багийн ахлах. */
  leader: string;
  /** «Хариуцсан мэргэжилтэн» — жишиг баримтын 2 дахь нэрийн багана. */
  specialist: string;
  fileName: string;
}

/** ⚠️ `PassportTimelineRow` нь `lib/passportTimeline.ts`-д амьдарна —
 *  «Хуваарь» цонх (`routes/timeline.ts`) ч ижил бүтцийг бичдэг тул мөрийн
 *  хэлбэр, `tl-*` id-ууд, normalise дүрэм гурав НЭГ газарт байх ёстой.
 *  Хуучин импортчид эвдрэхгүйн тулд эндээс дахин гаргана. */
export type { PassportTimelineRow };

export interface PassportMeetingRow {
  id: string;
  label: string;
  date: string;
}

/** JSON-оос ирсэн утгыг мөр болгоно (тоо, null, объект бүгд '' болно). */
function jstr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function normaliseScopeRows(input: unknown): PassportScopeRow[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((raw, i): PassportScopeRow | null => {
      if (!raw || typeof raw !== 'object') return null;
      const r = raw as Record<string, unknown>;
      const row: PassportScopeRow = {
        id: jstr(r.id) || `sc-${i}`,
        code: jstr(r.code),
        codeLabel: jstr(r.codeLabel),
        identification: jstr(r.identification),
        leader: jstr(r.leader),
        specialist: jstr(r.specialist),
        fileName: jstr(r.fileName),
      };
      // Бүрэн хоосон мөрийг хаяна (client_contacts-той ижил дүрэм).
      const filled =
        row.code || row.codeLabel || row.identification || row.leader || row.specialist || row.fileName;
      return filled ? row : null;
    })
    .filter((r): r is PassportScopeRow => r !== null);
}

/** 1.3-ын мөрийн normalise нь `lib/passportTimeline.ts`-д шилжсэн (дүрэм
 *  ХЭВЭЭР) — «Хуваарь» цонх ч тэр л парсерээр уншиж бичнэ. */
const normaliseTimeline = normaliseTimelineRows;

function normaliseMeetings(input: unknown): PassportMeetingRow[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((raw, i): PassportMeetingRow | null => {
      if (!raw || typeof raw !== 'object') return null;
      const r = raw as Record<string, unknown>;
      const row: PassportMeetingRow = {
        id: jstr(r.id) || `mt-${i}`,
        label: jstr(r.label),
        date: jstr(r.date),
      };
      return row.label || row.date ? row : null;
    })
    .filter((r): r is PassportMeetingRow => r !== null);
}

interface ClientContactInput {
  full_name?: string | null;
  position?: string | null;
  phone?: string | null;
  email?: string | null;
}

interface ClientContact {
  full_name: string;
  position: string;
  phone: string;
  email: string;
}

interface PassportPayload {
  full_title?: string | null;
  drawing_no?: string | null;
  doc_no?: string | null;
  scope?: string | null;
  director?: string | null;
  client_pm?: string | null;
  start_date?: string | null;
  finish_date?: string | null;
  extension_date?: string | null;
  disciplines?: string[] | null;
  client_contacts?: ClientContactInput[] | null;
  /** Word загварын 1.2 / 1.3 (0247).  Задлан шинжлэхийн өмнө төрөл нь
   *  тодорхойгүй тул `unknown` — normalise* функцууд шүүнэ. */
  scope_rows?: unknown;
  timeline?: unknown;
  meetings?: unknown;
  notes?: string | null;
  /** Паспортын «Client / Захиалагч» нүд (2026-09-28).  `project_clients`-д
   *  бичигдэнэ (`lib/passportClient.ts`); ирээгүй бол хөндөхгүй. */
  client_name?: string | null;
}

function parseClientContacts(json: string | null): ClientContact[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((c): ClientContact | null => {
        if (!c || typeof c !== 'object') return null;
        const item = c as Record<string, unknown>;
        return {
          full_name: typeof item.full_name === 'string' ? item.full_name : '',
          position: typeof item.position === 'string' ? item.position : '',
          phone: typeof item.phone === 'string' ? item.phone : '',
          email: typeof item.email === 'string' ? item.email : '',
        };
      })
      .filter((c): c is ClientContact => c !== null);
  } catch {
    return [];
  }
}

function normaliseClientContacts(input: ClientContactInput[] | null | undefined): ClientContact[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((c): ClientContact | null => {
      if (!c || typeof c !== 'object') return null;
      const full_name = typeof c.full_name === 'string' ? c.full_name.trim() : '';
      const position = typeof c.position === 'string' ? c.position.trim() : '';
      const phone = typeof c.phone === 'string' ? c.phone.trim() : '';
      const email = typeof c.email === 'string' ? c.email.trim() : '';
      // Drop completely empty rows.
      if (!full_name && !position && !phone && !email) return null;
      return { full_name, position, phone, email };
    })
    .filter((c): c is ClientContact => c !== null);
}

export function rowToPassport(row: PassportRow | null) {
  if (!row) return null;
  let disciplines: string[] = [];
  try {
    if (row.disciplines_json) {
      const arr = JSON.parse(row.disciplines_json);
      if (Array.isArray(arr)) disciplines = arr.filter((s): s is string => typeof s === 'string');
    }
  } catch {
    /* ignore malformed legacy rows */
  }
  const client_contacts = parseClientContacts(row.client_contacts_json);
  /* Хадгалсан JSON-ыг УНШИХАД ч БИЧИХЭД хэрэглэдэг ижил normalise*-аар
   * дамжуулна — хуучин / гэмтсэн мөр чимээгүй хаягдаж, талбарууд үргэлж
   * бүтэн ирнэ (UI `?? ''` бичих шаардлагагүй). */
  const parseRows = <T,>(json: string | null, norm: (v: unknown) => T[]): T[] => {
    if (!json) return [];
    try {
      return norm(JSON.parse(json));
    } catch {
      return [];
    }
  };
  const scope_rows = parseRows(row.scope_rows_json, normaliseScopeRows);
  const timeline = parseRows(row.timeline_json, normaliseTimeline);
  const meetings = parseRows(row.meetings_json, normaliseMeetings);
  const {
    disciplines_json: _omit,
    client_contacts_json: _omit2,
    scope_rows_json: _omit3,
    timeline_json: _omit4,
    meetings_json: _omit5,
    ...rest
  } = row;
  return { ...rest, disciplines, client_contacts, scope_rows, timeline, meetings };
}

projects.get('/:id/passport', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const user = c.get('user');
  if (user.role === 'client') {
    const member = await c.env.DB.prepare(
      'SELECT id FROM project_members WHERE project_id = ? AND user_id = ?',
    )
      .bind(id, user.sub)
      .first();
    if (!member) return c.json({ error: 'Access denied' }, 403);
  }
  const row = await c.env.DB.prepare('SELECT * FROM project_passport WHERE project_id = ?')
    .bind(id)
    .first<PassportRow>();
  return c.json({ passport: rowToPassport(row) });
});

/* Per-project client logo shown on report covers. Stored in app_settings as
 * `client_logo_url:<projectId>` so no schema migration is needed. The /media
 * URL it points at is already world-readable, so GET is open to any authed user
 * (the print/PDF route needs it); PUT is admin-only like the passport. */
projects.get('/:id/client-logo', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!(await guardClientProject(c.env.DB, c.get('user'), id))) {
    return c.json({ error: 'Access denied' }, 403);
  }
  const row = await c.env.DB.prepare('SELECT value FROM app_settings WHERE key = ?')
    .bind(`client_logo_url:${id}`)
    .first<{ value: string }>();
  const raw = row?.value?.trim();
  return c.json({ logo_url: raw && raw.length > 0 ? raw : null });
});

projects.put('/:id/client-logo', requireAdmin(), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const user = c.get('user');
  const body = await c.req.json<{ logo_url?: string | null }>().catch(() => ({}) as { logo_url?: string | null });
  const raw = typeof body.logo_url === 'string' ? body.logo_url.trim() : '';
  await upsertSetting(c.env.DB, `client_logo_url:${id}`, raw, user.sub);
  return c.json({ logo_url: raw || null });
});

projects.put('/:id/passport', requireManager(), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const body = await c.req.json<PassportPayload>();
  const user = c.get('user');

  // Basic project existence check — better than a foreign-key failure.
  const exists = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(id).first();
  if (!exists) return c.json({ error: 'Project not found' }, 404);

  /* Захиалагчийн нэрийг бүх бичилтээс ӨМНӨ шалгана — буруу утга паспортыг
   * хагас хадгалсан байдалд үлдээхгүй. */
  const clientName = parseClientName(body.client_name);
  if (!clientName.ok) return c.json({ error: clientName.error }, 400);

  const norm = (v: unknown) => {
    if (v == null) return null;
    const s = String(v).trim();
    return s.length === 0 ? null : s;
  };
  const disciplinesJson = Array.isArray(body.disciplines)
    ? JSON.stringify(body.disciplines.filter((d) => typeof d === 'string'))
    : null;
  const contacts = normaliseClientContacts(body.client_contacts);
  const contactsJson = contacts.length > 0 ? JSON.stringify(contacts) : null;

  /* ---- Word загварын 1.2 / 1.3 (0247) ---- */
  const scopeRows = normaliseScopeRows(body.scope_rows);
  const timeline = normaliseTimeline(body.timeline);
  const meetings = normaliseMeetings(body.meetings);
  const scopeRowsJson = scopeRows.length > 0 ? JSON.stringify(scopeRows) : null;
  const timelineJson = timeline.length > 0 ? JSON.stringify(timeline) : null;
  const meetingsJson = meetings.length > 0 ? JSON.stringify(meetings) : null;

  /* ⚠️ 1.3-ын хүснэгтээс ГУРВАН БАГАНА руу буулгана.
   *
   * Хүснэгт нь хөдөлгөөнт (мөр нэмж/хасаж, шошгыг нь өөрчилж болно) атал
   * `start_date` / `finish_date` / `extension_date` нь SQL-д ХЭРЭГЛЭГДДЭГ:
   * `deadlines.ts` эрсдэл/сануулгын шүүлт, `company.ts`-ийн хугацаа
   * хэтэрсэн сэрэмжлүүлэг, `projectCharts.ts` бүгд эднийг уншина.  Хэрэв
   * зөвхөн JSON-д хадгалбал тэдгээр нь чимээгүй хоосорно.
   *
   * Дараалал, сунгалтын дүрэм («ОГНООТОЙ СҮҮЛИЙН `tl-ext*`» — `find` БИШ)
   * бүгд `lib/passportTimeline.ts`-д — «Хуваарь» цонх ч эсрэг чиглэлд нь
   * тэр л дүрмээр бичдэг тул хоёр зам зөрөх боломжгүй.
   * Хүснэгт огт ирээгүй бол (`null` буцна) хуучин шууд талбарууд хэвээр
   * ажиллана — `asrTargets.ts` мэтийн хэсэгчилсэн дуудлагууд эвдрэхгүй. */
  const tlCols = columnsFromTimelineRows(timeline);
  const startDate = tlCols ? tlCols.start_date : norm(body.start_date);
  const finishDate = tlCols ? tlCols.finish_date : norm(body.finish_date);
  const extensionDate = tlCols ? tlCols.extension_date : norm(body.extension_date);

  /* ⚠️ `PUT /api/timeline/projects/:id/schedule` (routes/timeline.ts) нь
   * `finish < start` бол 400 буцаадаг.  1.3 хүснэгт нь тэр хоёр баганыг
   * бичдэг ХОЁР ДАХЬ зам болсон тул ижил шалгалт энд ч БАЙХ ЁСТОЙ — эс
   * бөгөөс захиалагчийн хуудсанд сөрөг үргэлжлэх хоног гарна. */
  if (startDate && finishDate && finishDate < startDate) {
    return c.json({ error: 'Дуусах огноо нь эхлэх огнооноос өмнө байж болохгүй' }, 400);
  }

  /* Хугацаа өөрчлөгдсөн эсэхийг МЭДЭХ хэрэгтэй (доорх сануулгын цэвэрлэгээ). */
  const beforeRow = await c.env.DB.prepare(
    'SELECT finish_date FROM project_passport WHERE project_id = ?',
  )
    .bind(id)
    .first<{ finish_date: string | null }>();

  /* ⚠️ ХОЙШЛУУЛАХ = СУНГАЛТ (migration 0339).  1.3 хүснэгтийн «Дуусах» мөрийг
   * хойш нь зөөх нь батлагч + шалтгаантай түүхийн мөр шаарддаг тул энд
   * ХААНА — `routes/timeline.ts`-ийн «Хуваарь» цонхтой ЯГ ижил дүрэм (тэнд
   * «Засвар» гэсэн ил туг бий; паспорт бол баримт тул тийм туг байхгүй —
   * буруу бичсэн огноог «Хуваарь»-аар залруулна).  Урагшлуулах / хоослох
   * хэвийн зам, доор `correction` гэж бүртгэгдэнэ. */
  if (isLaterThan(finishDate, beforeRow?.finish_date)) {
    return c.json(extensionRequiredBody(beforeRow?.finish_date), 409);
  }

  // INSERT … ON CONFLICT lets us treat the passport as a single row
  // without first having to SELECT to figure out create vs update.
  // NOTE: `meeting_30/50/100` are deprecated UI fields; we leave the
  // existing values untouched on update (and insert NULL on first create).
  await c.env.DB.prepare(
    `
    INSERT INTO project_passport (
      project_id, full_title, drawing_no, doc_no, scope, director, client_pm,
      start_date, finish_date, extension_date,
      disciplines_json, client_contacts_json,
      scope_rows_json, timeline_json, meetings_json,
      notes, updated_at, updated_by_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    ON CONFLICT(project_id) DO UPDATE SET
      full_title           = excluded.full_title,
      drawing_no           = excluded.drawing_no,
      doc_no               = excluded.doc_no,
      scope                = excluded.scope,
      director             = excluded.director,
      client_pm            = excluded.client_pm,
      start_date           = excluded.start_date,
      finish_date          = excluded.finish_date,
      extension_date       = excluded.extension_date,
      disciplines_json     = excluded.disciplines_json,
      client_contacts_json = excluded.client_contacts_json,
      scope_rows_json      = excluded.scope_rows_json,
      timeline_json        = excluded.timeline_json,
      meetings_json        = excluded.meetings_json,
      notes                = excluded.notes,
      updated_at           = datetime('now'),
      updated_by_id        = excluded.updated_by_id
  `,
  )
    .bind(
      id,
      norm(body.full_title),
      norm(body.drawing_no),
      norm(body.doc_no),
      norm(body.scope),
      norm(body.director),
      norm(body.client_pm),
      startDate,
      finishDate,
      extensionDate,
      disciplinesJson,
      contactsJson,
      scopeRowsJson,
      timelineJson,
      meetingsJson,
      norm(body.notes),
      user.sub,
    )
    .run();

  /* ⚠️ Дуусах хугацаа өөрчлөгдвөл илгээгдсэн сануулгын бүртгэлийг
   * цэвэрлэнэ.  `lib/deadlineSweep.ts` нь `(project_id, stage)`-ыг
   * ТӨСЛИЙН АМЬДРАЛД НЭГ л удаа тэмдэглэдэг тул цэвэрлэхгүй бол сунгасан
   * шинэ огноон дээр d7/d3/d1 сануулга ХЭЗЭЭ Ч илгээгдэхгүй.
   * `routes/timeline.ts:445` яг ижил зүйлийг хийдэг — 1.3 хүснэгт нь одоо
   * огноо засах ҮНДСЭН UI болсон тул энд ч заавал. */
  if ((beforeRow?.finish_date ?? null) !== finishDate) {
    await c.env.DB.prepare('DELETE FROM project_reminders WHERE project_id = ?').bind(id).run();
    // Түүхэнд `correction` мөр (0339) — хуучин огноо хаана ч алдагдахгүй.
    await recordDeadlineCorrection(c.env.DB, {
      project_id: id,
      from_date: beforeRow?.finish_date ?? null,
      to_date: finishDate,
      created_by: user.sub,
      note: 'Паспортын 1.3 хүснэгтээр',
    });
  }

  /* «Client / Захиалагч» нүд → `project_clients` (эх сурвалж хэвээр тэнд;
   * дүрэм `lib/passportClient.ts`).  Мөрүүд `GET /:id`-ийн ижил эрэмбээр. */
  const clientsSql = `SELECT id, project_id, type, name, share_percent, sort_order, created_at
                        FROM project_clients WHERE project_id = ? ORDER BY sort_order, id`;
  let clients: ProjectClientRow[] | undefined;
  if (clientName.value !== undefined) {
    const current = (await c.env.DB.prepare(clientsSql).bind(id).all<ProjectClientRow>()).results;
    const plan = planClientNameSync(current, clientName.value);
    if (plan.kind === 'delete_all') {
      await c.env.DB.prepare('DELETE FROM project_clients WHERE project_id = ?').bind(id).run();
    } else if (plan.kind === 'insert') {
      await c.env.DB.prepare(
        "INSERT INTO project_clients (project_id, type, name, share_percent, sort_order) VALUES (?, 'company', ?, 100, 0)",
      )
        .bind(id, plan.name)
        .run();
    } else if (plan.kind === 'rename') {
      await c.env.DB.batch([
        c.env.DB.prepare('UPDATE project_clients SET name = ? WHERE id = ? AND project_id = ?').bind(
          plan.name,
          plan.id,
          id,
        ),
        ...plan.dropIds.map((rid) =>
          c.env.DB.prepare('DELETE FROM project_clients WHERE id = ? AND project_id = ?').bind(rid, id),
        ),
      ]);
    }
    clients =
      plan.kind === 'none'
        ? current
        : (await c.env.DB.prepare(clientsSql).bind(id).all<ProjectClientRow>()).results;
  }

  const row = await c.env.DB.prepare('SELECT * FROM project_passport WHERE project_id = ?')
    .bind(id)
    .first<PassportRow>();
  return c.json({
    message: 'Хадгалагдлаа',
    passport: rowToPassport(row),
    ...(clients ? { clients } : {}),
  });
});

/* ============================================================
 *  Project client documents tracker (бичиг баримт)
 * ============================================================
 *  Each row represents a document the *client* must hand over.
 *  Engineers seed the list ("А даалгавар", "Геологийн дүгнэлт", …)
 *  and clients (or admins on their behalf) flip status to 'provided'.
 *
 *  Read   — any project member.
 *  Create — admin/engineer/architect/senior (staff side).
 *  Update — staff can edit any field; clients can only change `status`
 *           on docs in their project (mark "I provided this").
 *  Delete — admin only. */
type ClientDocRow = {
  id: number;
  project_id: number;
  sort_order: number;
  doc_name: string;
  doc_no: string | null;
  doc_date: string | null;
  source: string | null;
  description: string | null;
  status: 'pending' | 'provided' | 'not_required';
  provided_at: string | null;
  provided_by_id: number | null;
  file_url: string | null;
  file_name: string | null;
  created_at: string;
  updated_at: string;
};

interface DocPayload {
  doc_name?: string;
  doc_no?: string | null;
  doc_date?: string | null;
  source?: string | null;
  description?: string | null;
  status?: 'pending' | 'provided' | 'not_required';
  sort_order?: number;
  file_url?: string | null;
  file_name?: string | null;
}

async function ensureProjectAccess(
  db: D1Database,
  projectId: number,
  user: { sub: number; role: string },
): Promise<{ ok: true } | { ok: false; status: 403 | 404; error: string }> {
  const exists = await db.prepare('SELECT id FROM projects WHERE id = ?').bind(projectId).first();
  if (!exists) return { ok: false, status: 404, error: 'Project not found' };
  /* `senior` нь паспортыг засах эрхтэй (`PUT /:id/passport` = requireManager,
   * 2026-09-02) бөгөөд «Бичиг баримт» хүснэгт нь тэр л Word баримтын нэг
   * хэсэг — прод дээр `project_members` ажилтанд хоосон тул гишүүнчлэлээр
   * шалгавал senior баримтын мөрөө хэзээ ч уншиж/бичиж чадахгүй. */
  if (isAdminRole(user.role) || user.role === 'senior') return { ok: true };
  const member = await db
    .prepare('SELECT id FROM project_members WHERE project_id = ? AND user_id = ?')
    .bind(projectId, user.sub)
    .first();
  if (!member) return { ok: false, status: 403, error: 'Access denied' };
  return { ok: true };
}

projects.get('/:id/client-documents', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const user = c.get('user');
  const access = await ensureProjectAccess(c.env.DB, id, user);
  if (!access.ok) return c.json({ error: access.error }, access.status);

  const { results } = await c.env.DB.prepare(
    `
    SELECT cd.*, u.full_name AS provided_by_name
    FROM project_client_documents cd
    LEFT JOIN users u ON u.id = cd.provided_by_id
    WHERE cd.project_id = ?
    ORDER BY cd.sort_order, cd.id
  `,
  )
    .bind(id)
    .all<ClientDocRow & { provided_by_name: string | null }>();
  return c.json({ documents: results ?? [] });
});

// Staff-only create.
projects.post('/:id/client-documents', async (c) => {
  const user = c.get('user');
  if (user.role === 'client') return c.json({ error: 'Forbidden' }, 403);
  const id = parseInt(c.req.param('id'), 10);
  const body = await c.req.json<DocPayload>();
  const access = await ensureProjectAccess(c.env.DB, id, user);
  if (!access.ok) return c.json({ error: access.error }, access.status);

  if (!body.doc_name?.trim()) {
    return c.json({ error: 'doc_name шаардлагатай' }, 400);
  }
  const status =
    body.status === 'provided' || body.status === 'not_required' ? body.status : 'pending';
  // If admin creates the row already-provided, stamp it now so the audit
  // trail shows a sensible "when".
  const providedAt = status === 'provided' ? new Date().toISOString() : null;
  const providedBy = status === 'provided' ? user.sub : null;

  const result = await c.env.DB.prepare(
    `
    INSERT INTO project_client_documents (
      project_id, sort_order, doc_name, doc_no, doc_date, source,
      description, status, provided_at, provided_by_id, file_url, file_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  )
    .bind(
      id,
      Number.isFinite(body.sort_order) ? body.sort_order! : 0,
      body.doc_name.trim(),
      body.doc_no?.trim() || null,
      body.doc_date?.trim() || null,
      body.source?.trim() || null,
      body.description?.trim() || null,
      status,
      providedAt,
      providedBy,
      body.file_url?.trim() || null,
      body.file_name?.trim() || null,
    )
    .run();

  const row = await c.env.DB.prepare('SELECT * FROM project_client_documents WHERE id = ?')
    .bind(Number(result.meta.last_row_id))
    .first<ClientDocRow>();
  return c.json({ message: 'Нэмлээ', document: row }, 201);
});

projects.put('/client-documents/:docId', async (c) => {
  const docId = parseInt(c.req.param('docId'), 10);
  const user = c.get('user');
  const body = await c.req.json<DocPayload>();

  const existing = await c.env.DB.prepare('SELECT * FROM project_client_documents WHERE id = ?')
    .bind(docId)
    .first<ClientDocRow>();
  if (!existing) return c.json({ error: 'Document not found' }, 404);

  const access = await ensureProjectAccess(c.env.DB, existing.project_id, user);
  if (!access.ok) return c.json({ error: access.error }, access.status);

  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  // Clients are restricted to status flips + an optional file pointer
  // they uploaded themselves.  Everything else is staff-only.
  const isStaff = user.role !== 'client';

  if (body.status !== undefined) {
    if (!['pending', 'provided', 'not_required'].includes(body.status)) {
      return c.json({ error: 'Invalid status' }, 400);
    }
    updates.push('status = ?');
    values.push(body.status);
    if (body.status === 'provided' && existing.status !== 'provided') {
      updates.push("provided_at = datetime('now')");
      updates.push('provided_by_id = ?');
      values.push(user.sub);
    } else if (body.status !== 'provided') {
      updates.push('provided_at = NULL');
      updates.push('provided_by_id = NULL');
    }
  }

  if (body.file_url !== undefined) {
    updates.push('file_url = ?');
    values.push(body.file_url?.trim() || null);
  }
  if (body.file_name !== undefined) {
    updates.push('file_name = ?');
    values.push(body.file_name?.trim() || null);
  }

  if (isStaff) {
    if (body.doc_name !== undefined) {
      const trimmed = body.doc_name.trim();
      if (!trimmed) return c.json({ error: 'doc_name хоосон байж болохгүй' }, 400);
      updates.push('doc_name = ?');
      values.push(trimmed);
    }
    if (body.doc_no !== undefined) {
      updates.push('doc_no = ?');
      values.push(body.doc_no?.trim() || null);
    }
    if (body.doc_date !== undefined) {
      updates.push('doc_date = ?');
      values.push(body.doc_date?.trim() || null);
    }
    if (body.source !== undefined) {
      updates.push('source = ?');
      values.push(body.source?.trim() || null);
    }
    if (body.description !== undefined) {
      updates.push('description = ?');
      values.push(body.description?.trim() || null);
    }
    if (body.sort_order !== undefined && Number.isFinite(body.sort_order)) {
      updates.push('sort_order = ?');
      values.push(Number(body.sort_order));
    }
  }

  if (updates.length === 0) return c.json({ error: 'No fields to update' }, 400);

  updates.push("updated_at = datetime('now')");
  values.push(docId);
  await c.env.DB.prepare(`UPDATE project_client_documents SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  const row = await c.env.DB.prepare(
    `
    SELECT cd.*, u.full_name AS provided_by_name
    FROM project_client_documents cd
    LEFT JOIN users u ON u.id = cd.provided_by_id
    WHERE cd.id = ?
  `,
  )
    .bind(docId)
    .first();
  return c.json({ message: 'Шинэчиллээ', document: row });
});

projects.delete('/client-documents/:docId', requireAdmin(), async (c) => {
  const docId = parseInt(c.req.param('docId'), 10);
  const r = await c.env.DB.prepare('DELETE FROM project_client_documents WHERE id = ?')
    .bind(docId)
    .run();
  if (r.meta.changes === 0) return c.json({ error: 'Document not found' }, 404);
  return c.json({ message: 'Устгалаа' });
});

/* ============================================================
 *  Технийн нөхцөл — per-project list of engineering parameters
 *  the client / consultant provides at project start (water
 *  pressure, soil class, max power draw, …).  Same UX shape as
 *  `project_client_documents` minus the status/provided fields
 *  since these are spec values, not deliverables.
 * ============================================================ */

interface TechConditionRow {
  id: number;
  project_id: number;
  sort_order: number;
  title: string;
  value: string | null;
  description: string | null;
  condition_date: string | null;
  created_at: string;
  updated_at: string;
}
interface TechConditionPayload {
  title?: string;
  value?: string | null;
  description?: string | null;
  condition_date?: string | null;
  sort_order?: number;
}

projects.get('/:id/tech-conditions', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const user = c.get('user');
  const access = await ensureProjectAccess(c.env.DB, id, user);
  if (!access.ok) return c.json({ error: access.error }, access.status);

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM project_tech_conditions WHERE project_id = ? ORDER BY sort_order, id',
  )
    .bind(id)
    .all<TechConditionRow>();
  return c.json({ conditions: results ?? [] });
});

projects.post('/:id/tech-conditions', async (c) => {
  const user = c.get('user');
  if (user.role === 'client') return c.json({ error: 'Forbidden' }, 403);
  const id = parseInt(c.req.param('id'), 10);
  const access = await ensureProjectAccess(c.env.DB, id, user);
  if (!access.ok) return c.json({ error: access.error }, access.status);

  const body = await c.req.json<TechConditionPayload>();
  if (!body.title?.trim()) {
    return c.json({ error: 'title шаардлагатай' }, 400);
  }

  const result = await c.env.DB.prepare(
    `
    INSERT INTO project_tech_conditions
      (project_id, sort_order, title, value, description, condition_date)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  )
    .bind(
      id,
      Number.isFinite(body.sort_order) ? body.sort_order! : 0,
      body.title.trim(),
      body.value?.trim() || null,
      body.description?.trim() || null,
      body.condition_date?.trim() || null,
    )
    .run();

  const row = await c.env.DB.prepare('SELECT * FROM project_tech_conditions WHERE id = ?')
    .bind(Number(result.meta.last_row_id))
    .first<TechConditionRow>();
  return c.json({ message: 'Нэмлээ', condition: row }, 201);
});

projects.put('/tech-conditions/:condId', async (c) => {
  const condId = parseInt(c.req.param('condId'), 10);
  const user = c.get('user');
  if (user.role === 'client') return c.json({ error: 'Forbidden' }, 403);

  const existing = await c.env.DB.prepare('SELECT * FROM project_tech_conditions WHERE id = ?')
    .bind(condId)
    .first<TechConditionRow>();
  if (!existing) return c.json({ error: 'Condition not found' }, 404);

  const access = await ensureProjectAccess(c.env.DB, existing.project_id, user);
  if (!access.ok) return c.json({ error: access.error }, access.status);

  const body = await c.req.json<TechConditionPayload>();
  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (body.title !== undefined) {
    const trimmed = body.title.trim();
    if (!trimmed) return c.json({ error: 'title хоосон байж болохгүй' }, 400);
    updates.push('title = ?');
    values.push(trimmed);
  }
  if (body.value !== undefined) {
    updates.push('value = ?');
    values.push(body.value?.trim() || null);
  }
  if (body.description !== undefined) {
    updates.push('description = ?');
    values.push(body.description?.trim() || null);
  }
  if (body.condition_date !== undefined) {
    updates.push('condition_date = ?');
    values.push(body.condition_date?.trim() || null);
  }
  if (body.sort_order !== undefined && Number.isFinite(body.sort_order)) {
    updates.push('sort_order = ?');
    values.push(Number(body.sort_order));
  }
  if (updates.length === 0) return c.json({ error: 'No fields to update' }, 400);

  updates.push("updated_at = datetime('now')");
  values.push(condId);
  await c.env.DB.prepare(`UPDATE project_tech_conditions SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  const row = await c.env.DB.prepare('SELECT * FROM project_tech_conditions WHERE id = ?')
    .bind(condId)
    .first<TechConditionRow>();
  return c.json({ message: 'Шинэчиллээ', condition: row });
});

projects.delete('/tech-conditions/:condId', requireAdmin(), async (c) => {
  const condId = parseInt(c.req.param('condId'), 10);
  const r = await c.env.DB.prepare('DELETE FROM project_tech_conditions WHERE id = ?')
    .bind(condId)
    .run();
  if (r.meta.changes === 0) return c.json({ error: 'Condition not found' }, 404);
  return c.json({ message: 'Устгалаа' });
});

/* ============================================================
 *  Project status report (явцын тайлан)
 * ============================================================
 *  Header (1:1) — гэрээ, холбогдох хүн, явц, санхүүжилт, гадаад
 *  байгууллагатай харилцсан тэмдэглэлүүд.
 *  Notes  (1:N) — Title + body + attachments[] + timestamps.
 *
 *  Read   — staff (admin/engineer/architect/senior).  Захиалагч энд
 *           ороогүй учир client-уудад үзэгдэхгүй.
 *  Write  — admin / senior. */

type StatusReportRow = {
  project_id: number;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  contract_start: string | null;
  contract_end: string | null;
  work_progress: string | null; // legacy — UI ашиглахгүй
  funding_terms: string | null; // legacy — UI ашиглахгүй
  funding_percent: number | null; // legacy — UI ашиглахгүй
  funding_milestones_json: string | null;
  nema_note: string | null;
  health_note: string | null;
  bdc_experts_note: string | null;
  bdc_review_note: string | null;
  /** Per-agency "completed" flags — SQLite-д INTEGER (0/1) хадгалдаг. */
  nema_done: number;
  health_done: number;
  bdc_experts_done: number;
  bdc_review_done: number;
  notes: string | null;
  updated_at: string;
  updated_by_id: number | null;
};

interface FundingMilestoneInput {
  label?: string;
  percent?: number | string | null;
  done?: boolean;
  received_at?: string | null;
}

interface FundingMilestone {
  label: string;
  percent: number | null;
  done: boolean;
  received_at: string | null;
}

interface StatusReportPayload {
  contact_name?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  contract_start?: string | null;
  contract_end?: string | null;
  funding_milestones?: FundingMilestoneInput[];
  nema_note?: string | null;
  health_note?: string | null;
  bdc_experts_note?: string | null;
  bdc_review_note?: string | null;
  nema_done?: boolean;
  health_done?: boolean;
  bdc_experts_done?: boolean;
  bdc_review_done?: boolean;
  notes?: string | null;
}

function parseMilestones(json: string | null): FundingMilestone[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((m) => m && typeof m === 'object')
      .map((m) => ({
        label: typeof m.label === 'string' ? m.label : '',
        percent:
          typeof m.percent === 'number' && Number.isFinite(m.percent)
            ? Math.max(0, Math.min(100, m.percent))
            : null,
        done: !!m.done,
        received_at: typeof m.received_at === 'string' ? m.received_at : null,
      }));
  } catch {
    return [];
  }
}

function rowToReport(row: StatusReportRow | null) {
  if (!row) return null;
  const { funding_milestones_json: _omit, ...rest } = row;
  return {
    ...rest,
    nema_done: !!row.nema_done,
    health_done: !!row.health_done,
    bdc_experts_done: !!row.bdc_experts_done,
    bdc_review_done: !!row.bdc_review_done,
    funding_milestones: parseMilestones(row.funding_milestones_json),
  };
}

function normaliseMilestones(input: FundingMilestoneInput[] | undefined): FundingMilestone[] {
  if (!Array.isArray(input)) return [];
  return (
    input
      .map((m) => {
        const label = typeof m.label === 'string' ? m.label.trim() : '';
        let percent: number | null = null;
        if (m.percent != null && m.percent !== '') {
          const n = Number(m.percent);
          if (Number.isFinite(n)) percent = Math.max(0, Math.min(100, n));
        }
        return {
          label,
          percent,
          done: !!m.done,
          received_at:
            typeof m.received_at === 'string' && m.received_at.trim() ? m.received_at.trim() : null,
        };
      })
      // Бүрэн хоосон мөрийг хасъя.
      .filter((m) => m.label.length > 0 || m.percent != null)
  );
}

type ProgressNoteRow = {
  id: number;
  project_id: number;
  title: string;
  body: string | null;
  attachments_json: string | null;
  created_by_id: number | null;
  created_at: string;
  updated_at: string;
  category: string;
};

interface ProgressNoteAttachment {
  url: string;
  name: string;
}

interface ProgressNotePayload {
  title?: string;
  body?: string | null;
  attachments?: ProgressNoteAttachment[];
  category?: string;
}

function parseAttachments(json: string | null): ProgressNoteAttachment[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((a) => a && typeof a === 'object' && typeof a.url === 'string')
      .map((a) => ({ url: String(a.url), name: typeof a.name === 'string' ? a.name : '' }));
  } catch {
    return [];
  }
}

function rowToNote(
  row: ProgressNoteRow & { author_name?: string | null; author_image?: string | null },
) {
  const { attachments_json: _omit, ...rest } = row;
  return { ...rest, attachments: parseAttachments(row.attachments_json) };
}

const norm = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
};

projects.get('/:id/status-report', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const user = c.get('user');
  // Клиент тус төслийн гишүүн байх ёстой; өөр төслийн өгөгдөл харахгүй.
  if (user.role === 'client') {
    const member = await c.env.DB.prepare(
      'SELECT id FROM project_members WHERE project_id = ? AND user_id = ?',
    )
      .bind(id, user.sub)
      .first();
    if (!member) return c.json({ error: 'Access denied' }, 403);
  } else {
    const access = await ensureProjectAccess(c.env.DB, id, user);
    if (!access.ok) return c.json({ error: access.error }, access.status);
  }

  const header = await c.env.DB.prepare('SELECT * FROM project_status_reports WHERE project_id = ?')
    .bind(id)
    .first<StatusReportRow>();

  // Клиентэд "Явцын мэдээ" харагдахгүй — header л буцаана.
  if (user.role === 'client') {
    return c.json({ report: rowToReport(header), notes: [] });
  }

  const category = c.req.query('category');
  const categoryFilter = category ? 'AND n.category = ?' : '';
  const bindArgs: (string | number)[] = category ? [id, category] : [id];

  const { results } = await c.env.DB.prepare(
    `
    SELECT n.*, u.full_name AS author_name, u.profile_image AS author_image
    FROM project_progress_notes n
    LEFT JOIN users u ON u.id = n.created_by_id
    WHERE n.project_id = ? ${categoryFilter}
    ORDER BY n.created_at DESC
  `,
  )
    .bind(...bindArgs)
    .all<ProgressNoteRow & { author_name: string | null; author_image: string | null }>();

  return c.json({
    report: rowToReport(header),
    notes: results.map(rowToNote),
  });
});

projects.put(
  '/:id/status-report',
  requireRole('admin', 'senior'),
  async (c) => {
    const id = parseInt(c.req.param('id'), 10);
    const body = await c.req.json<StatusReportPayload>();
    const user = c.get('user');

    const exists = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(id).first();
    if (!exists) return c.json({ error: 'Project not found' }, 404);

    const milestones = normaliseMilestones(body.funding_milestones);
    const milestonesJson = milestones.length > 0 ? JSON.stringify(milestones) : null;

    const bool = (v: unknown) => (v === true || v === 1 || v === '1' ? 1 : 0);

    await c.env.DB.prepare(
      `
    INSERT INTO project_status_reports (
      project_id, contact_name, contact_phone, contact_email,
      contract_start, contract_end,
      funding_milestones_json,
      nema_note, health_note, bdc_experts_note, bdc_review_note,
      nema_done, health_done, bdc_experts_done, bdc_review_done,
      notes, updated_at, updated_by_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    ON CONFLICT(project_id) DO UPDATE SET
      contact_name             = excluded.contact_name,
      contact_phone            = excluded.contact_phone,
      contact_email            = excluded.contact_email,
      contract_start           = excluded.contract_start,
      contract_end             = excluded.contract_end,
      funding_milestones_json  = excluded.funding_milestones_json,
      nema_note                = excluded.nema_note,
      health_note              = excluded.health_note,
      bdc_experts_note         = excluded.bdc_experts_note,
      bdc_review_note          = excluded.bdc_review_note,
      nema_done                = excluded.nema_done,
      health_done              = excluded.health_done,
      bdc_experts_done         = excluded.bdc_experts_done,
      bdc_review_done          = excluded.bdc_review_done,
      notes                    = excluded.notes,
      updated_at               = datetime('now'),
      updated_by_id            = excluded.updated_by_id
  `,
    )
      .bind(
        id,
        norm(body.contact_name),
        norm(body.contact_phone),
        norm(body.contact_email),
        norm(body.contract_start),
        norm(body.contract_end),
        milestonesJson,
        norm(body.nema_note),
        norm(body.health_note),
        norm(body.bdc_experts_note),
        norm(body.bdc_review_note),
        bool(body.nema_done),
        bool(body.health_done),
        bool(body.bdc_experts_done),
        bool(body.bdc_review_done),
        norm(body.notes),
        user.sub,
      )
      .run();

    const row = await c.env.DB.prepare('SELECT * FROM project_status_reports WHERE project_id = ?')
      .bind(id)
      .first<StatusReportRow>();
    return c.json({ message: 'Хадгалагдлаа', report: rowToReport(row) });
  },
);

projects.post(
  '/:id/progress-notes',
  requireRole('admin', 'engineer', 'architect', 'senior'),
  async (c) => {
    const id = parseInt(c.req.param('id'), 10);
    const body = await c.req.json<ProgressNotePayload>();
    const user = c.get('user');

    const access = await ensureProjectAccess(c.env.DB, id, user);
    if (!access.ok) return c.json({ error: access.error }, access.status);

    const title = norm(body.title);
    if (!title) return c.json({ error: 'Гарчиг шаардлагатай' }, 400);

    const attachments: ProgressNoteAttachment[] = Array.isArray(body.attachments)
      ? body.attachments
          .filter((a) => a && typeof a.url === 'string' && a.url.trim().length > 0)
          .map((a) => ({ url: String(a.url), name: typeof a.name === 'string' ? a.name : '' }))
      : [];

    const category = body.category === 'client' ? 'client' : 'mgl';

    const result = await c.env.DB.prepare(
      `
    INSERT INTO project_progress_notes (project_id, title, body, attachments_json, created_by_id, category)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
    )
      .bind(
        id,
        title,
        norm(body.body),
        attachments.length > 0 ? JSON.stringify(attachments) : null,
        user.sub,
        category,
      )
      .run();

    const row = await c.env.DB.prepare(
      `
    SELECT n.*, u.full_name AS author_name, u.profile_image AS author_image
    FROM project_progress_notes n
    LEFT JOIN users u ON u.id = n.created_by_id
    WHERE n.id = ?
  `,
    )
      .bind(result.meta.last_row_id)
      .first<ProgressNoteRow & { author_name: string | null; author_image: string | null }>();

    return c.json({ message: 'Нэмэгдлээ', note: row ? rowToNote(row) : null }, 201);
  },
);

projects.put(
  '/progress-notes/:noteId',
  requireRole('admin', 'engineer', 'architect', 'senior'),
  async (c) => {
    const noteId = parseInt(c.req.param('noteId'), 10);
    const body = await c.req.json<ProgressNotePayload>();
    const user = c.get('user');

    const existing = await c.env.DB.prepare('SELECT * FROM project_progress_notes WHERE id = ?')
      .bind(noteId)
      .first<ProgressNoteRow>();
    if (!existing) return c.json({ error: 'Бичлэг олдсонгүй' }, 404);

    // Зөвхөн админ ба бичсэн хүн өөрөө л засах эрхтэй.
    if (!isAdminRole(user.role) && existing.created_by_id !== user.sub) {
      return c.json({ error: 'Зөвхөн өөрийн бичлэгээ засна' }, 403);
    }

    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    if (body.title !== undefined) {
      const t = norm(body.title);
      if (!t) return c.json({ error: 'Гарчиг хоосон байж болохгүй' }, 400);
      updates.push('title = ?');
      values.push(t);
    }
    if (body.body !== undefined) {
      updates.push('body = ?');
      values.push(norm(body.body));
    }
    if (body.attachments !== undefined) {
      const attachments: ProgressNoteAttachment[] = Array.isArray(body.attachments)
        ? body.attachments
            .filter((a) => a && typeof a.url === 'string' && a.url.trim().length > 0)
            .map((a) => ({ url: String(a.url), name: typeof a.name === 'string' ? a.name : '' }))
        : [];
      updates.push('attachments_json = ?');
      values.push(attachments.length > 0 ? JSON.stringify(attachments) : null);
    }
    if (body.category !== undefined) {
      updates.push('category = ?');
      values.push(body.category === 'client' ? 'client' : 'mgl');
    }

    if (updates.length === 0) return c.json({ error: 'Өөрчлөх зүйл алга' }, 400);

    updates.push("updated_at = datetime('now')");
    values.push(noteId);

    await c.env.DB.prepare(`UPDATE project_progress_notes SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();

    const row = await c.env.DB.prepare(
      `
    SELECT n.*, u.full_name AS author_name, u.profile_image AS author_image
    FROM project_progress_notes n
    LEFT JOIN users u ON u.id = n.created_by_id
    WHERE n.id = ?
  `,
    )
      .bind(noteId)
      .first<ProgressNoteRow & { author_name: string | null; author_image: string | null }>();

    return c.json({ message: 'Шинэчиллээ', note: row ? rowToNote(row) : null });
  },
);

projects.delete('/progress-notes/:noteId', async (c) => {
  const noteId = parseInt(c.req.param('noteId'), 10);
  const user = c.get('user');

  const existing = await c.env.DB.prepare('SELECT * FROM project_progress_notes WHERE id = ?')
    .bind(noteId)
    .first<ProgressNoteRow>();
  if (!existing) return c.json({ error: 'Бичлэг олдсонгүй' }, 404);

  if (!isAdminRole(user.role) && existing.created_by_id !== user.sub) {
    return c.json({ error: 'Зөвхөн өөрийн бичлэгээ устгана' }, 403);
  }

  await c.env.DB.prepare('DELETE FROM project_progress_notes WHERE id = ?').bind(noteId).run();
  return c.json({ message: 'Устгалаа' });
});

/* ===========================================================
 * GET /api/projects/:id/pdf
 * -----------------------------------------------------------
 * Server-side PDF export via Cloudflare Browser Rendering.
 * Mints a short-lived JWT, launches headless Chromium, navigates
 * to the frontend's print route, waits for the page to flag
 * itself ready, and streams the resulting PDF back to the caller.
 * =========================================================== */
projects.get('/:id/pdf', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const user = c.get('user');

  // Reuse the same access rule as the detail endpoint: clients only
  // see projects they're explicitly attached to; staff can fetch any.
  if (user.role === 'client') {
    const member = await c.env.DB.prepare(
      'SELECT id FROM project_members WHERE project_id = ? AND user_id = ?',
    )
      .bind(id, user.sub)
      .first();
    if (!member) return c.json({ error: 'Access denied' }, 403);
  }

  const project = await c.env.DB.prepare('SELECT id, name FROM projects WHERE id = ?')
    .bind(id)
    .first<{ id: number; name: string }>();
  if (!project) return c.json({ error: 'Project not found' }, 404);

  // Short-lived (60 s) token — long enough for cold-start + render,
  // short enough that a leaked URL is harmless. Carries the same
  // identity so the frontend's apiFetch sees the project as the
  // requesting user would.
  const printToken = await signToken(
    { sub: user.sub, role: user.role, purpose: 'print' },
    c.env.JWT_SECRET,
    1 / 60, // hours -> 1 minute
  );

  const printUrl =
    `${c.env.FRONTEND_URL.replace(/\/+$/, '')}/reports/project/${id}/print` +
    `?t=${encodeURIComponent(printToken)}`;

  let browser: BrowserSession | null = null;
  try {
    browser = await launchBrowser(c.env.BROWSER);
    const page = await browser.newPage();

    // A4 at ~150 dpi; matches the @page size set in the print stylesheet.
    await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 1 });

    await page.goto(printUrl, { waitUntil: 'networkidle0', timeout: 30000 });

    // The print page sets [data-print-ready="true"] on <body> after
    // data has loaded, Noto Sans has loaded (Cloudflare's headless
    // Chromium ships no Cyrillic glyphs by default), and three rAFs
    // have committed. Without this guard puppeteer would snapshot a
    // blank shell. Tolerate timeout — a partial render is more
    // useful than a 500 to the caller.
    try {
      await page.waitForSelector('body[data-print-ready="true"]', { timeout: 25000 });
    } catch {
      /* fall through and snapshot whatever we have */
    }

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', right: '12mm', bottom: '14mm', left: '12mm' },
    });

    const safeName =
      (project.name || 'project')
        .normalize('NFKD')
        .replace(/[^\p{L}\p{N}\s_-]/gu, '')
        .trim()
        .replace(/\s+/g, '_')
        .slice(0, 80) || 'project';

    return new Response(pdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeName}_tailan.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[project-pdf] render failed', err);
    return c.json(
      {
        error: 'PDF үүсгэхэд алдаа гарлаа',
        detail: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* swallow */
      }
    }
  }
});

/* ===========================================================
 * GET /api/projects/:id/team-reports/:teamCode/pdf
 * -----------------------------------------------------------
 * Client-facing PDF download for a single team's Тайлан.
 * Clone of GET /:id/pdf above — same Browser Rendering flow,
 * same short-lived print token, just pointed at the per-team
 * print route with `?mode=client` so the rendered PDF matches
 * the in-app Тайлан pane exactly.
 *
 * Access rule mirrors the team-report GET (line 1955): clients
 * only see projects they're attached to; staff can fetch any.
 * =========================================================== */
projects.get('/:id/team-reports/:teamCode/pdf', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const teamCode = (c.req.param('teamCode') ?? '').toUpperCase();
  const user = c.get('user');

  if (Number.isNaN(id) || !teamCode) {
    return c.json({ error: 'Invalid project or team code' }, 400);
  }

  if (user.role === 'client') {
    const member = await c.env.DB.prepare(
      'SELECT id FROM project_members WHERE project_id = ? AND user_id = ?',
    )
      .bind(id, user.sub)
      .first();
    if (!member) return c.json({ error: 'Access denied' }, 403);
  }

  const project = await c.env.DB.prepare('SELECT id, name FROM projects WHERE id = ?')
    .bind(id)
    .first<{ id: number; name: string }>();
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const printToken = await signToken(
    { sub: user.sub, role: user.role, purpose: 'print' },
    c.env.JWT_SECRET,
    1 / 60, // hours -> 1 minute
  );

  const printUrl =
    `${c.env.FRONTEND_URL.replace(/\/+$/, '')}/app/projects/${id}/team-reports/${teamCode}/print` +
    `?mode=client&t=${encodeURIComponent(printToken)}`;

  let browser: BrowserSession | null = null;
  try {
    browser = await launchBrowser(c.env.BROWSER);
    const page = await browser.newPage();
    await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 1 });

    await page.goto(printUrl, { waitUntil: 'networkidle0', timeout: 30000 });
    try {
      await page.waitForSelector('body[data-print-ready="true"]', { timeout: 25000 });
    } catch {
      /* snapshot whatever rendered */
    }

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', right: '12mm', bottom: '14mm', left: '12mm' },
    });

    const safeName =
      (project.name || 'project')
        .normalize('NFKD')
        .replace(/[^\p{L}\p{N}\s_-]/gu, '')
        .trim()
        .replace(/\s+/g, '_')
        .slice(0, 80) || 'project';

    return new Response(pdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeName}_${teamCode}_tailan.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[team-report-pdf] render failed', err);
    return c.json(
      {
        error: 'PDF үүсгэхэд алдаа гарлаа',
        detail: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* swallow */
      }
    }
  }
});

/* ============================================================
 *  Per-team explanatory note (Тайлбар бичиг)
 * ============================================================
 *  One row per (project, team_code). Each discipline assigned to
 *  the project can author its own questionnaire/answers blob; BA
 *  is the first template implemented but the same table backs all
 *  future teams (BB, HAS, TSBU, …).
 *
 *  Read:  any project member.
 *  Write: admin tier + architect + senior. */
type TeamReportRow = {
  project_id: number;
  team_code: string;
  building_type: string | null;
  answers_json: string;
  updated_at: string;
  updated_by_id: number | null;
};

interface TeamReportPayload {
  building_type?: 'rc' | 'steel' | null;
  answers?: Record<string, unknown> | null;
}

function rowToTeamReport(row: TeamReportRow | null) {
  if (!row) return null;
  let answers: Record<string, unknown> = {};
  try {
    if (row.answers_json) {
      const parsed = JSON.parse(row.answers_json);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        answers = parsed as Record<string, unknown>;
      }
    }
  } catch {
    /* ignore malformed legacy rows */
  }
  return {
    project_id: row.project_id,
    team_code: row.team_code,
    building_type: row.building_type as 'rc' | 'steel' | null,
    answers,
    updated_at: row.updated_at,
    updated_by_id: row.updated_by_id,
  };
}

/** Team codes are always uppercase short discipline codes ('BA',
 *  'BB', …). Reject anything else so we can't store rows with
 *  inconsistent casing or unbounded text. */
function normaliseTeamCode(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = raw.trim().toUpperCase();
  if (!/^[A-Z]{2,8}$/.test(s)) return null;
  return s;
}

/** List every team report the caller can see for this project — used
 *  on the outer tab to badge "filled in" / "empty" per sub-tab without
 *  N requests. */
projects.get('/:id/team-reports', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const user = c.get('user');
  if (user.role === 'client') {
    const member = await c.env.DB.prepare(
      'SELECT id FROM project_members WHERE project_id = ? AND user_id = ?',
    )
      .bind(id, user.sub)
      .first();
    if (!member) return c.json({ error: 'Access denied' }, 403);
  }
  const res = await c.env.DB.prepare(
    'SELECT * FROM project_team_reports WHERE project_id = ? ORDER BY team_code',
  )
    .bind(id)
    .all<TeamReportRow>();
  const reports = (res.results ?? []).map(rowToTeamReport).filter((r) => r !== null);
  return c.json({ reports });
});

projects.get('/:id/team-reports/:teamCode', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const teamCode = normaliseTeamCode(c.req.param('teamCode'));
  if (!teamCode) return c.json({ error: 'Invalid team code' }, 400);

  const user = c.get('user');
  if (user.role === 'client') {
    const member = await c.env.DB.prepare(
      'SELECT id FROM project_members WHERE project_id = ? AND user_id = ?',
    )
      .bind(id, user.sub)
      .first();
    if (!member) return c.json({ error: 'Access denied' }, 403);
  }
  const row = await c.env.DB.prepare(
    'SELECT * FROM project_team_reports WHERE project_id = ? AND team_code = ?',
  )
    .bind(id, teamCode)
    .first<TeamReportRow>();
  return c.json({ report: rowToTeamReport(row) });
});

projects.put(
  '/:id/team-reports/:teamCode',
  requireRole('admin', 'architect', 'senior'),
  async (c) => {
    const id = parseInt(c.req.param('id'), 10);
    const teamCode = normaliseTeamCode(c.req.param('teamCode'));
    if (!teamCode) return c.json({ error: 'Invalid team code' }, 400);

    const body = await c.req.json<TeamReportPayload>();
    const user = c.get('user');

    const exists = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(id).first();
    if (!exists) return c.json({ error: 'Project not found' }, 404);

    const buildingType =
      body.building_type === 'rc' || body.building_type === 'steel' ? body.building_type : null;
    const answersJson =
      body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers)
        ? JSON.stringify(body.answers)
        : '{}';

    await c.env.DB.prepare(
      `
      INSERT INTO project_team_reports (
        project_id, team_code, building_type, answers_json, updated_at, updated_by_id
      ) VALUES (?, ?, ?, ?, datetime('now'), ?)
      ON CONFLICT(project_id, team_code) DO UPDATE SET
        building_type = excluded.building_type,
        answers_json  = excluded.answers_json,
        updated_at    = datetime('now'),
        updated_by_id = excluded.updated_by_id
    `,
    )
      .bind(id, teamCode, buildingType, answersJson, user.sub)
      .run();

    const row = await c.env.DB.prepare(
      'SELECT * FROM project_team_reports WHERE project_id = ? AND team_code = ?',
    )
      .bind(id, teamCode)
      .first<TeamReportRow>();
    return c.json({ message: 'Хадгалагдлаа', report: rowToTeamReport(row) });
  },
);

/* ============================================================
 *  Per-team progress notes (Тэмдэглэл)
 * ============================================================
 *  Parallel to the Тайлбар бичиг routes above but the questions
 *  are a fixed 4-question checkpoint set (see TEAM_NOTE_QUESTIONS
 *  in lib/teamNotesAi.ts) and an AI summary is regenerated on every
 *  save.  One row per (project, team_code); latest answers win.
 *
 *  Read:  any project member.
 *  Write: admin tier + architect + senior (same as Тайлбар бичиг). */

type TeamNoteRow = {
  project_id: number;
  team_code: string;
  answers_json: string;
  ai_summary: string | null;
  ai_summary_at: string | null;
  updated_at: string;
  updated_by_id: number | null;
};

interface TeamNotePayload {
  answers?: Record<string, unknown> | null;
}

function rowToTeamNote(row: TeamNoteRow | null) {
  if (!row) return null;
  let answers: Record<string, string> = {};
  try {
    if (row.answers_json) {
      const parsed = JSON.parse(row.answers_json);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        // Coerce every value to string — the form only renders textareas
        // so we should never see other types, but defensive in case an
        // older payload survives.
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          answers[k] = typeof v === 'string' ? v : String(v ?? '');
        }
      }
    }
  } catch {
    /* ignore malformed legacy rows */
  }
  return {
    project_id: row.project_id,
    team_code: row.team_code,
    answers,
    ai_summary: row.ai_summary,
    ai_summary_at: row.ai_summary_at,
    updated_at: row.updated_at,
    updated_by_id: row.updated_by_id,
  };
}

/** GET list — used to badge "filled / empty" on the per-team sub-tabs
 *  without N round-trips. */
projects.get('/:id/team-notes', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const user = c.get('user');
  if (user.role === 'client') {
    const member = await c.env.DB.prepare(
      'SELECT id FROM project_members WHERE project_id = ? AND user_id = ?',
    )
      .bind(id, user.sub)
      .first();
    if (!member) return c.json({ error: 'Access denied' }, 403);
  }
  const res = await c.env.DB.prepare(
    'SELECT * FROM project_team_notes WHERE project_id = ? ORDER BY team_code',
  )
    .bind(id)
    .all<TeamNoteRow>();
  const notes = (res.results ?? []).map(rowToTeamNote).filter((r) => r !== null);
  return c.json({ notes, questions: TEAM_NOTE_QUESTIONS });
});

projects.get('/:id/team-notes/:teamCode', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const teamCode = normaliseTeamCode(c.req.param('teamCode'));
  if (!teamCode) return c.json({ error: 'Invalid team code' }, 400);

  const user = c.get('user');
  if (user.role === 'client') {
    const member = await c.env.DB.prepare(
      'SELECT id FROM project_members WHERE project_id = ? AND user_id = ?',
    )
      .bind(id, user.sub)
      .first();
    if (!member) return c.json({ error: 'Access denied' }, 403);
  }
  const row = await c.env.DB.prepare(
    'SELECT * FROM project_team_notes WHERE project_id = ? AND team_code = ?',
  )
    .bind(id, teamCode)
    .first<TeamNoteRow>();
  return c.json({ note: rowToTeamNote(row), questions: TEAM_NOTE_QUESTIONS });
});

projects.put(
  '/:id/team-notes/:teamCode',
  requireRole('admin', 'architect', 'senior'),
  async (c) => {
    const id = parseInt(c.req.param('id'), 10);
    const teamCode = normaliseTeamCode(c.req.param('teamCode'));
    if (!teamCode) return c.json({ error: 'Invalid team code' }, 400);

    const body = await c.req.json<TeamNotePayload>();
    const user = c.get('user');

    const exists = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(id).first();
    if (!exists) return c.json({ error: 'Project not found' }, 404);

    // Sanitise: keep only string values for known question ids so the
    // AI prompt can't be steered by injecting unexpected keys.
    const cleanAnswers: Record<string, string> = {};
    if (body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers)) {
      for (const q of TEAM_NOTE_QUESTIONS) {
        const v = (body.answers as Record<string, unknown>)[q.id];
        if (typeof v === 'string') cleanAnswers[q.id] = v.trim();
      }
    }

    await c.env.DB.prepare(
      `
      INSERT INTO project_team_notes (
        project_id, team_code, answers_json, updated_at, updated_by_id
      ) VALUES (?, ?, ?, datetime('now'), ?)
      ON CONFLICT(project_id, team_code) DO UPDATE SET
        answers_json  = excluded.answers_json,
        updated_at    = datetime('now'),
        updated_by_id = excluded.updated_by_id
    `,
    )
      .bind(id, teamCode, JSON.stringify(cleanAnswers), user.sub)
      .run();

    // Regenerate the AI summary in the background — the response doesn't
    // wait on it so saves stay snappy.  The lib clears the cached summary
    // when all four answers are empty so an erased note doesn't keep
    // showing a stale paragraph.
    c.executionCtx.waitUntil(
      summarizeTeamNotes({ db: c.env.DB, ai: c.env.AI, projectId: id, teamCode }),
    );

    const row = await c.env.DB.prepare(
      'SELECT * FROM project_team_notes WHERE project_id = ? AND team_code = ?',
    )
      .bind(id, teamCode)
      .first<TeamNoteRow>();
    return c.json({ message: 'Хадгалагдлаа', note: rowToTeamNote(row) });
  },
);

export default projects;
