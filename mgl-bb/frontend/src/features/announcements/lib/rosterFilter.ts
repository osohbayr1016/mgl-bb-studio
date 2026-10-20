import type { RosterRow } from '../api';

export type RosterFilter = 'all' | 'acked' | 'pending';

/** Мөр хайлтад таарах уу — нэр / нэвтрэх нэр / багийн код, том жижиг үсэг ялгахгүй. */
export function rosterMatches(row: RosterRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [row.full_name, row.username, row.team_code].some((v) => (v ?? '').toLowerCase().includes(q));
}

/** Шүүлт (бүгд / баталгаажуулсан / хүлээгдэж буй) + хайлт — dialog-ийн харагдах мөрүүд. */
export function filterRoster(rows: RosterRow[], filter: RosterFilter, query: string): RosterRow[] {
  return rows.filter((r) => {
    if (filter === 'acked' && r.ack_id === null) return false;
    if (filter === 'pending' && r.ack_id !== null) return false;
    return rosterMatches(r, query);
  });
}

/** Баталгаажуулаагүй хүмүүсийн нэр — «нэр хуулах» товчны бичвэр (мөр бүрд нэг). */
export function pendingNames(rows: RosterRow[]): string[] {
  return rows.filter((r) => r.ack_id === null).map((r) => r.full_name ?? r.username ?? `#${r.user_id}`);
}
