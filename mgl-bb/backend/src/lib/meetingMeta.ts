/**
 * Хурлын тэмдэглэл — цэвэр (DB-гүй) туслахууд: төслийн жагсаалт, хурлын
 * төрөл, оролцогчдын тоо.  `routes/meetings.ts` болон `mcp/tools/meetings.ts`
 * хоёулаа эндээс уншдаг тул REST/MCP хоёр талын дүрэм зөрөхгүй.
 * Тест: `meetingMeta.test.ts`.
 */

export type MeetingKind = 'project' | 'company';

export const MEETING_KINDS: readonly MeetingKind[] = ['project', 'company'];

/** Нэг хуралд холбогдох төслийн дээд тоо (bind-ийн 100-ын хязгаараас хол). */
export const MAX_MEETING_PROJECTS = 20;

export interface ParticipantMemberLike {
  name?: unknown;
}
export interface ParticipantGroupLike {
  org?: unknown;
  members?: unknown;
}

/**
 * `project_ids: number[]` (шинэ) эсвэл `project_id: number` (хуучин
 * клиент/MCP) → давхардалгүй, эерэг бүхэл тоонууд, дараалал хадгалагдана.
 * Талбар огт ирээгүй бол `undefined` (PUT «хөндөхгүй» гэсэн утга).
 */
export function parseProjectIds(body: {
  project_ids?: unknown;
  project_id?: unknown;
}): number[] | undefined {
  const raw: unknown[] | undefined = Array.isArray(body.project_ids)
    ? body.project_ids
    : 'project_id' in body
      ? [body.project_id]
      : undefined;
  if (raw === undefined) return undefined;
  const out: number[] = [];
  for (const v of raw) {
    const n = typeof v === 'string' ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) continue;
    if (!out.includes(n)) out.push(n);
    if (out.length >= MAX_MEETING_PROJECTS) break;
  }
  return out;
}

/**
 * Хурлын төрлийг шийднэ.  Инвариант: `company` ⇔ төсөлгүй.
 * - kind ирээгүй → төсөлтэй бол `project`, үгүй бол `company`.
 * - kind='company' → төслүүд ХАЯГДАНА (компанийн хурал төсөлд уягдахгүй).
 * - kind='project' ба төсөлгүй → алдаа (дуудагч 400 өгнө).
 */
export function resolveMeetingKind(
  kindRaw: unknown,
  projectIds: number[],
): { ok: true; kind: MeetingKind; projectIds: number[] } | { ok: false; error: string } {
  const kind =
    typeof kindRaw === 'string' && (MEETING_KINDS as readonly string[]).includes(kindRaw)
      ? (kindRaw as MeetingKind)
      : projectIds.length
        ? 'project'
        : 'company';
  if (kind === 'company') return { ok: true, kind, projectIds: [] };
  if (!projectIds.length) {
    return { ok: false, error: 'Төслийн хуралд дор хаяж нэг төсөл сонгоно уу' };
  }
  return { ok: true, kind, projectIds };
}

/** Бүтэцтэй оролцогчдын (байгууллага → гишүүд) нэртэй гишүүдийн тоо. */
export function countAttendees(groups: unknown): number {
  if (!Array.isArray(groups)) return 0;
  let n = 0;
  for (const g of groups) {
    if (!g || typeof g !== 'object') continue;
    const members = (g as ParticipantGroupLike).members;
    if (!Array.isArray(members)) continue;
    for (const m of members) {
      if (m && typeof m === 'object' && typeof (m as ParticipantMemberLike).name === 'string') {
        if (((m as ParticipantMemberLike).name as string).trim()) n += 1;
      }
    }
  }
  return n;
}

/** `participants_json` багана → оролцогчдын тоо (буруу JSON = 0). */
export function countAttendeesFromJson(raw: string | null | undefined): number {
  if (!raw) return 0;
  try {
    return countAttendees(JSON.parse(raw));
  } catch {
    return 0;
  }
}
