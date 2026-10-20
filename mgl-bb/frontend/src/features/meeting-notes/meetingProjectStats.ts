import type { MeetingListItem, MeetingProjectRow } from './types';

export function buildMeetingProjectRows(
  projects: Array<{ id: number; name: string }>,
  meetings: MeetingListItem[],
): MeetingProjectRow[] {
  const stats = new Map<number, { count: number; lastDate: string | null }>();

  for (const m of meetings) {
    // Олон төсөлтэй хурал төсөл бүртээ тоологдоно (meeting_projects, 0333);
    // хуучин хариу (projects талбаргүй) project_id-руу буцна.
    const ids = m.projects?.length ? m.projects.map((p) => p.id) : m.project_id != null ? [m.project_id] : [];
    for (const pid of ids) {
      const prev = stats.get(pid) ?? { count: 0, lastDate: null };
      const lastDate =
        m.meeting_date && (!prev.lastDate || m.meeting_date > prev.lastDate)
          ? m.meeting_date
          : prev.lastDate;
      stats.set(pid, { count: prev.count + 1, lastDate });
    }
  }

  return projects.map((p) => {
    const row = stats.get(p.id);
    return {
      id: p.id,
      name: p.name,
      meeting_count: row?.count ?? 0,
      last_meeting_date: row?.lastDate ?? null,
    };
  });
}

/** Компанийн (төсөлгүй) хурлын тоо + сүүлийн огноо. */
export function companyMeetingStats(meetings: MeetingListItem[]) {
  let count = 0;
  let lastDate: string | null = null;
  for (const m of meetings) {
    if (m.kind !== 'company' && (m.project_id != null || m.projects?.length)) continue;
    count += 1;
    if (m.meeting_date && (!lastDate || m.meeting_date > lastDate)) {
      lastDate = m.meeting_date;
    }
  }
  return { count, lastDate };
}
