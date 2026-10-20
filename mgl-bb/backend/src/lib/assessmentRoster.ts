/* ============================================================
 * Судалгааны ОРОЛЦОГЧИЙН ЖАГСААЛТ (roster) — ганц эх сурвалж.
 *
 * 2026-08-19-д `routes/assessments.ts`-ээс салгаж авсан.  Шалтгаан: ажилтны
 * амьдралын мөчлөг (`routes/users.ts` — шинээр авах, баг солих, идэвхгүй
 * болгох) нь ЯГ ижил дүрмээр жагсаалтыг хөдөлгөх ёстой.  Хоёр файлд тус тусад
 * нь бичвэл «хэн судалгаанд орох ёстой вэ» гэдэг гарц бүр дээр өөр хариулттай
 * болно — энэ репод аль хэдийн баримтжсан алдаа (`PROJECT_LIST_SQL`-ийн арван
 * нэгэн хуулбарыг үз).
 *
 * ХОЁР ХАТУУ ДҮРЭМ энд амьдардаг:
 *   1. `PARTICIPANT_ROLES` — хэн үнэлүүлэх боломжтой вэ (admin бол ЗОХИОН
 *      БАЙГУУЛАГЧ, оролцогч БИШ),
 *   2. `ACTIVE_PARTICIPANT_SQL` — идэвхгүй болсон ажилтан бүх жагсаалт,
 *      тайлан, тоолуураас алга болно.
 * ============================================================ */

import { createNotification } from './notify';
import type { AssessmentRoundRow } from '../types';

/** Профайлын «Ур чадварын үнэлгээ» таб — бүх мэдэгдлийн холбоос. */
export const ASSESSMENT_LINK = '/app/profile?tab=assessment';

/**
 * Судалгаанд ОРОЛЦОГЧ (үнэлүүлэгч) болох role-ууд — 2026-08-19, эзний шийдвэр.
 *
 * `admin` бол үнэлгээг зохион байгуулагч, оролцогч БИШ.  Өмнө нь энэ дүрэм
 * зөвхөн frontend-ийн `PublishDialog.tsx` (`CREATE_ROLES`) дотор байсан бөгөөд
 * тэр нь ЗӨВХӨН «role-оор сонгох» горимд ажилладаг байв — анхдагч «багаар
 * сонгох» горимд MGMT багийг сонгоход бүх админыг чирж оруулдаг байсан.
 *
 * ⚠️ ГУРВАН ТВИН файл хамт хөдөлнө:
 *      backend/src/lib/assessmentRoster.ts (энэ)
 *      frontend/src/shared/lib/roles.ts    → `ASSESSMENT_ROLES`
 *      frontend/src/features/assessments/admin/editor/PublishDialog.tsx → `CREATE_ROLES`
 *
 * ⚠️ Энэ нь `routes/assessments.ts`-ийн `EXCLUDED_ROLES`-ТОЙ ӨӨР зүйл.  Тэр
 *    нь модулийн 403 хаалт (client/worker хандаж ч болохгүй); энэ нь «хэнийг
 *    үнэлэх вэ».  `admin` нь эхнийхэд БАЙХГҮЙ (тэр бүх гарцыг ашиглана),
 *    хоёрдугаарт БАЙХГҮЙ (тэр үнэлүүлэхгүй).
 */
export const PARTICIPANT_ROLES = ['engineer', 'architect', 'senior'];

/**
 * Оролцогчийн жагсаалт/тайланд ХАРАГДАХ хэрэглэгчийн нөхцөл (`u` alias).
 *
 * 2026-08-19 (эзний шийдвэр): ажилтан идэвхгүй болбол түүний үнэлгээ
 * «байхгүй болсон» гэж үзнэ — НЭЭЛТТЭЙ ч, ХААГДСАН ч раундад ялгаагүй.
 *
 * Үүнийг ӨГӨГДӨЛ УСТГАЖ биш, УНШИХ талд шүүж хийсэн нь зориуд:
 *   • илгээсэн (`submitted`) хариулт DB-д бүтнээрээ үлдэнэ — буцаагдашгүй
 *     устгал болохгүй,
 *   • дансыг эргүүлж `active` болговол хүн бүх тайландаа буцаж гарна,
 *   • одоо байгаа «хуучирсан» мөрүүдийг гар аргаар цэвэрлэх шаардлагагүй.
 *
 * ⚠️ Үүнийг өөрчилвөл `ROUND_SUMMARY_SQL`-ийн гурван тоолуурыг ЗЭРЭГ
 *    өөрчил — эс бөгөөс жагсаалтын «21 оролцогч» ба хүснэгтийн 19 мөр зөрнө.
 */
export const ACTIVE_PARTICIPANT_SQL = `u.status = 'active'`;

// ---------------------------------------------------------------------------
// Жижиг туслахууд (`routes/assessments.ts` мөн эдгээрийг импортлодог)
// ---------------------------------------------------------------------------

export function placeholders(n: number): string {
  return new Array(n).fill('?').join(',');
}

/** D1 batch-ийг хэсэглэн ажиллуулна (нэг batch-д хэт олон statement оруулахгүй). */
export async function runBatched(db: D1Database, stmts: D1PreparedStatement[], size = 50) {
  for (let i = 0; i < stmts.length; i += size) {
    const chunk = stmts.slice(i, i + size);
    if (chunk.length) await db.batch(chunk);
  }
}

/**
 * `team_codes` / `senior_user_ids` / `roles` / `user_ids` / `excluded_user_ids`
 * баганууд нь JSON массив ТЕКСТ (migration 0146 / 0182).  D1-д массив төрөл
 * байхгүй тул текстээр хадгалж, доорх хос функцээр л уншиж/бичнэ — гэмтэлтэй
 * JSON бол чимээгүй хоосон массив (route унахгүй).
 */
export function jsonTextToStrings(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((v) => (typeof v === 'string' ? v.trim() : '')).filter((s) => s.length > 0);
  } catch {
    return [];
  }
}

export function jsonTextToIds(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((v): v is number => Number.isInteger(v)))];
  } catch {
    return [];
  }
}

/** Массив → баганад хадгалах JSON текст. Хоосон бол NULL (шүүлт хялбар болно). */
export function toJsonText(list: (string | number)[]): string | null {
  return list.length ? JSON.stringify(list) : null;
}

// ---------------------------------------------------------------------------
// Хамрах хүрээ (cohort)
// ---------------------------------------------------------------------------

/**
 * Раунд «хэн нарыг хамрах вэ» гэдгийн тодорхойлолт.  Гурвуулаа хоосон бол
 * хамрах хүрээ тодорхойлогдоогүй (жишээ нь 0182-оос ӨМНӨ үүссэн раунд) —
 * тэр үед sync нь ЮУ Ч ХИЙХГҮЙ.  Энэ нь зориуд сонгосон аюулгүй байдал:
 * хуучин раундыг таамаглаж «бүх хүн» гэж ойлговол хэдэн арван хүнд буруу
 * мэдэгдэл явуулна.
 */
export interface CohortSpec {
  userIds: number[];
  teamCodes: string[];
  roles: string[];
}

export interface CohortMember {
  id: number;
  full_name: string;
  role: string;
  team_code: string | null;
}

/** Раундын мөрөөс хамрах хүрээг уншина (migration 0146 + 0182 баганууд). */
export function cohortSpecOf(round: AssessmentRoundRow): CohortSpec {
  return {
    userIds: jsonTextToIds(round.user_ids),
    teamCodes: jsonTextToStrings(round.team_codes),
    roles: jsonTextToStrings(round.roles),
  };
}

/** Хамрах хүрээ огт тодорхойлогдоогүй юу?  Тийм бол sync/аудит болгоомжилно. */
export function isCohortKnown(spec: CohortSpec): boolean {
  return spec.userIds.length > 0 || spec.teamCodes.length > 0 || spec.roles.length > 0;
}

/**
 * Хамрах хүрээг ГАНЦ газар шийднэ.  `POST /rounds`, `POST /rounds/:id/sync`,
 * `GET /rounds/:id/candidates` ба `routes/users.ts`-ийн автомат бүртгэл
 * БҮГД ЭНЭ функцийг дуудна.
 *
 * Хоёр хатуу шүүлт ҮРГЭЛЖ хэрэгжинэ: `status='active'` ба
 * `role IN PARTICIPANT_ROLES`.  Гурван шалгуур (`userIds` / `teamCodes` /
 * `roles`) нь OR-оор нэгдэнэ — аль нэгэнд нь тохирвол хамрагдана.
 */
export async function resolveCohortIds(
  db: D1Database,
  spec: CohortSpec,
): Promise<CohortMember[]> {
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (spec.userIds.length) {
    clauses.push(`u.id IN (${placeholders(spec.userIds.length)})`);
    binds.push(...spec.userIds);
  }
  if (spec.teamCodes.length) {
    clauses.push(
      `EXISTS (SELECT 1 FROM user_teams ut JOIN teams t ON t.id = ut.team_id
                WHERE ut.user_id = u.id AND t.code IN (${placeholders(spec.teamCodes.length)}))`,
    );
    binds.push(...spec.teamCodes);
  }
  if (spec.roles.length) {
    clauses.push(`u.role IN (${placeholders(spec.roles.length)})`);
    binds.push(...spec.roles);
  }
  // Нэг ч шалгуургүй бол ХООСОН буцаана — «бүх хүн» гэж ойлгож БОЛОХГҮЙ.
  if (!clauses.length) return [];

  const { results } = await db
    .prepare(
      `SELECT u.id, u.full_name, u.role,
              (SELECT t.code FROM user_teams ut JOIN teams t ON t.id = ut.team_id
                WHERE ut.user_id = u.id AND ut.is_primary = 1 LIMIT 1) AS team_code
         FROM users u
        WHERE ${ACTIVE_PARTICIPANT_SQL}
          AND u.role IN (${placeholders(PARTICIPANT_ROLES.length)})
          AND (${clauses.join(' OR ')})
        ORDER BY u.full_name ASC`,
    )
    .bind(...PARTICIPANT_ROLES, ...binds)
    .all<CohortMember>();
  return results ?? [];
}

// ---------------------------------------------------------------------------
// Бүртгэл (enrollment)
// ---------------------------------------------------------------------------

/**
 * Оролцогч + түүний маягтуудыг үүсгэх statement-ууд.
 *
 * ⚠️ Бүх INSERT нь `INSERT OR IGNORE` — энэ бол давхардлаас хамгаалах ЦОРЫН
 *    ГАНЦ хамгаалалт бөгөөд DB-ийн бодит UNIQUE индексүүд дээр тулгуурладаг
 *    (0139 `assessment_participants(round_id, user_id)`, 0142
 *    `assessment_responses(round_id, subject_user_id, evaluator_kind,
 *    evaluator_user_id)`).  Sync-ийг хоёр удаа дарахад юу ч давхардахгүй
 *    байх нь ЯГ эндээс гарна — эдгээрийг энгийн `INSERT` болговол
 *    идемпотент байдал алдагдана.
 */
export function enrollStatements(
  db: D1Database,
  roundId: number,
  memberIds: number[],
  evaluatorsFor: (memberId: number) => number[],
): { stmts: D1PreparedStatement[]; evaluatorLoad: Map<number, number> } {
  const stmts: D1PreparedStatement[] = [];
  /** Үнэлэгч → түүнд ШИНЭЭР оногдсон ажилтны тоо (мэдэгдэлд шууд бичнэ). */
  const evaluatorLoad = new Map<number, number>();

  for (const memberId of memberIds) {
    const evaluators = evaluatorsFor(memberId);
    for (const id of evaluators) evaluatorLoad.set(id, (evaluatorLoad.get(id) ?? 0) + 1);
    // `assessment_participants` нь нэг л үнэлэгч барина (хүснэгтийн «Ахлагч»
    // багана) — олон senior үед эхнийх нь төлөөлнө, жинхэнэ бүрэн жагсаалт
    // `assessment_responses`-д байна.
    const primary = evaluators[0] ?? null;

    stmts.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO assessment_participants (round_id, user_id, evaluator_user_id)
           VALUES (?, ?, ?)`,
        )
        .bind(roundId, memberId, primary),
    );
    // self маягтын «эзэн» нь ажилтан өөрөө — эрхийн шалгалт нэг дүрэм болно.
    stmts.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO assessment_responses
             (round_id, subject_user_id, evaluator_user_id, evaluator_kind)
           VALUES (?, ?, ?, 'self')`,
        )
        .bind(roundId, memberId, memberId),
    );
    for (const evaluator of evaluators) {
      stmts.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO assessment_responses
               (round_id, subject_user_id, evaluator_user_id, evaluator_kind)
             VALUES (?, ?, ?, 'senior')`,
          )
          .bind(roundId, memberId, evaluator),
      );
    }
  }
  return { stmts, evaluatorLoad };
}

/**
 * Раундын үнэлэгч тогтоох ХОЁР ГОРИМ-ыг нэг дор шийднэ (үүсгэх ба нөхөж
 * бүртгэх хоёр ижил ажиллах ёстой — эс бөгөөс дараа нэмэгдсэн хүн ахлагчгүй
 * үлдэнэ):
 *
 *   А) `roundSeniors` хоосон биш → тэд БҮГДИЙГ үнэлнэ (өөрөөсөө бусад),
 *   Б) хоосон бол → хүн бүрийн ҮНДСЭН багийн `teams.lead_user_id`.
 */
export async function buildEvaluatorResolver(
  db: D1Database,
  memberIds: number[],
  roundSeniors: number[],
): Promise<(memberId: number) => number[]> {
  if (roundSeniors.length) {
    return (memberId: number) => roundSeniors.filter((id) => id !== memberId);
  }
  const leadOf = new Map<number, number | null>();
  if (memberIds.length) {
    const { results } = await db
      .prepare(
        `SELECT ut.user_id AS user_id, t.lead_user_id AS lead_user_id
           FROM user_teams ut
           JOIN teams t ON t.id = ut.team_id
          WHERE ut.user_id IN (${placeholders(memberIds.length)})
          ORDER BY ut.is_primary DESC, ut.id ASC`,
      )
      .bind(...memberIds)
      .all<{ user_id: number; lead_user_id: number | null }>();
    for (const row of results ?? []) {
      // Эхний мөр = үндсэн баг (is_primary DESC эрэмбэ).
      if (!leadOf.has(row.user_id)) leadOf.set(row.user_id, row.lead_user_id ?? null);
    }
  }
  return (memberId: number) =>
    [leadOf.get(memberId) ?? null].filter((id): id is number => id !== null && id !== memberId);
}

/**
 * Ажилтнуудыг раундад бүртгэж, ЗӨВХӨН ШИНЭЭР нэмэгдсэн хүнд мэдэгдэнэ.
 *
 * `POST /sync`, нэг хүн нэмэх гарц, `routes/users.ts`-ийн автомат бүртгэл
 * гурвуулаа ЭНЭ функцээр явна.
 *
 * ⚠️ Дуудагч `newIds`-ыг УРЬДЧИЛАН (batch-аас ӨМНӨ) тооцсон байх ёстой.
 *    Batch-ийн дараа «хэн нэмэгдсэн бэ» гэж дүгнэвэл `INSERT OR IGNORE` нь
 *    аль хэдийн байсан мөрийг чимээгүй алгасдаг тул sync дарах болгонд
 *    бүх хүнд давхар мэдэгдэл явна.
 */
export async function enrollMembers(
  db: D1Database,
  round: AssessmentRoundRow,
  newIds: number[],
): Promise<number> {
  if (!newIds.length) return 0;
  const roundSeniors = jsonTextToIds(round.senior_user_ids);
  const evaluatorsFor = await buildEvaluatorResolver(db, newIds, roundSeniors);
  const { stmts, evaluatorLoad } = enrollStatements(db, round.id, newIds, evaluatorsFor);
  await runBatched(db, stmts);

  // Ноорог раунд нээгдээгүй тул чимээгүй — `PATCH /rounds/:id` нээх үедээ
  // `notifyRoundOpened`-оор бүгдэд нь нэг мөсөн мэдэгдэнэ.
  if (round.status === 'open') {
    await Promise.all([
      ...newIds.map((id) =>
        createNotification(
          db,
          id,
          'assessment_assigned',
          'Ур чадварын үнэлгээ',
          `${round.name} — өөрийн үнэлгээгээ бөглөнө үү`,
          ASSESSMENT_LINK,
        ),
      ),
      ...[...evaluatorLoad].map(([id, n]) =>
        createNotification(
          db,
          id,
          'assessment_assigned',
          'Багийнхаа үнэлгээг хийнэ үү',
          `${round.name} — танд нэмж ${n} ажилтны үнэлгээ оногдлоо`,
          ASSESSMENT_LINK,
        ),
      ),
    ]);
  }
  return newIds.length;
}

// ---------------------------------------------------------------------------
// Ажилтны амьдралын мөчлөгийн дэгээ (`routes/users.ts` дуудна)
// ---------------------------------------------------------------------------

/**
 * Нэг ажилтныг НЭЭЛТТЭЙ, автомат бүртгэлтэй бүх раундад нөхөж бүртгэнэ.
 *
 * Дуудагдах гурван мөч (`routes/users.ts`): шинэ ажилтан үүсгэх, баг солих,
 * дансыг эргүүлж `active` болгох.  Эзний хүсэлт: «шинэ хүн ажилд ороод багт
 * орвол assessment нь өөрөө харагддаг байх».
 *
 * ⚠️ БҮТЭЛГҮЙТЭЛ НЬ ҮНДСЭН ҮЙЛДЛИЙГ УНАГААХ ЁСГҮЙ.  Хэрэглэгч үүсгэх/баг
 *    солих нь судалгаанаас ХАМААРАЛГҮЙ ажил — энд гарсан алдаанаас болж
 *    HR-ийн үйлдэл 500 буцаах нь буруу.  Тиймээс дуудагч тал `catch`-даг
 *    ба энэ функц өөрөө ч раунд тус бүрийг тусад нь хамгаална.
 */
export async function autoEnrollUserIntoOpenRounds(
  db: D1Database,
  userId: number,
): Promise<number> {
  // Тухайн хүн ерөөсөө оролцох боломжтой юу (идэвхтэй + role тохирсон)?
  const user = await db
    .prepare(
      `SELECT id FROM users
        WHERE id = ? AND status = 'active'
          AND role IN (${placeholders(PARTICIPANT_ROLES.length)})`,
    )
    .bind(userId, ...PARTICIPANT_ROLES)
    .first<{ id: number }>();
  if (!user) return 0;

  const { results: rounds } = await db
    .prepare(
      `SELECT * FROM assessment_rounds WHERE status = 'open' AND auto_enroll = 1`,
    )
    .all<AssessmentRoundRow>();

  let enrolled = 0;
  for (const round of rounds ?? []) {
    const spec = cohortSpecOf(round);
    // Хамрах хүрээгээ мартсан хуучин раунд — таамаглахгүй, алгасна.
    if (!isCohortKnown(spec)) continue;
    // Админ ЗОРИУД хассан хүнийг автомат ажил хэзээ ч буцааж нэмэхгүй.
    if (jsonTextToIds(round.excluded_user_ids).includes(userId)) continue;

    // Хамрах хүрээг ЖАГСААЛТААР бодоод дотор нь байгаа эсэхийг шалгана.
    // Нэг хүнээр шүүсэн тусгай query бичихгүй байгаа нь ЗОРИУД: тэр нь
    // `resolveCohortIds`-ийн ХОЁР ДАХЬ хуулбар болж, «хэн хамрагдах вэ»
    // гэсэн дүрэм хоёр салаа замтай болно.  Компанийн хэмжээ (~80 хүн)
    // дээр энэ ялгаа мэдэгдэхгүй.
    const match = await resolveCohortIds(db, spec);
    if (!match.some((m) => m.id === userId)) continue;

    // Аль хэдийн бүртгэлтэй бол дахин мэдэгдэл явуулахгүй.
    const already = await db
      .prepare(`SELECT 1 AS ok FROM assessment_participants WHERE round_id = ? AND user_id = ?`)
      .bind(round.id, userId)
      .first<{ ok: number }>();
    if (already) continue;

    enrolled += await enrollMembers(db, round, [userId]);
  }
  return enrolled;
}

/**
 * Идэвхгүй болсон ажилтныг жагсаалтаас цэвэрлэнэ.
 *
 * ЯГ ЮУ УСТГАХ ВЭ:
 *   • оролцогчийн мөр (бүх раундаас — эзний шийдвэр «хаана ч байсан»),
 *   • түүний БӨГЛӨӨГҮЙ (`draft`) маягтууд,
 *   • түүнийг үнэлэх ахлагчийн БӨГЛӨӨГҮЙ маягтууд (ахлагчийн «Миний үнэлэх
 *     хүмүүс» жагсаалт цэвэрлэгдэнэ).
 *
 * ⚠️ ИЛГЭЭСЭН (`submitted`) маягтыг ХЭЗЭЭ Ч устгахгүй.  Тэр бол бодит
 *    тайлангийн өгөгдөл бөгөөд буцаагдашгүй.  Уншихад тэр хүн ямар ч
 *    байсан `ACTIVE_PARTICIPANT_SQL`-ээр шүүгдэж харагдахгүй тул дэлгэц
 *    дээрх үр дүн эзний хүссэнтэй ижил — гэхдээ дансыг эргүүлж `active`
 *    болговол бүх тоо бүтнээрээ буцаж ирнэ.
 */
export async function pruneInactiveUserFromRosters(
  db: D1Database,
  userId: number,
): Promise<void> {
  await runBatched(db, [
    db
      .prepare(
        `DELETE FROM assessment_responses WHERE subject_user_id = ? AND status = 'draft'`,
      )
      .bind(userId),
    db
      .prepare(
        `DELETE FROM assessment_responses
          WHERE evaluator_user_id = ? AND evaluator_kind = 'senior' AND status = 'draft'`,
      )
      .bind(userId),
    db.prepare(`DELETE FROM assessment_participants WHERE user_id = ?`).bind(userId),
  ]);
}
