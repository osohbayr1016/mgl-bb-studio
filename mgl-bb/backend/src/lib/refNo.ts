/**
 * Auto-numbering for correspondence documents.  Produces a sequential
 * reference like `RFI-202606-001`, scoped per project + doc_type + year-month
 * (derived from the entry's `log_date`).  The sequence resets each month.
 *
 * Used when an admin classifies a Gmail message (routes/email.ts) or adds a
 * manual ledger entry (routes/correspondence.ts) without typing an explicit
 * `ref_no`.  A typed ref_no always wins.
 *
 * Note: count+1 is not strictly race-safe under simultaneous writes, but
 * correspondence is logged one-at-a-time by an admin, so collisions are
 * effectively impossible in practice.
 */
import type { DocType } from '../types';

const PREFIX: Record<DocType, string> = {
  rfi: 'RFI',
  cr: 'CR',
  official: 'OL',
  mr: 'MR',
};

export async function nextRefNo(
  db: D1Database,
  projectId: number,
  docType: DocType,
  logDate: string,
): Promise<string> {
  const ym = logDate.slice(0, 7); // 'YYYY-MM'
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM correspondence_log
       WHERE project_id = ? AND doc_type = ? AND substr(log_date, 1, 7) = ?`,
    )
    .bind(projectId, docType, ym)
    .first<{ n: number }>();
  const seq = (row?.n ?? 0) + 1;
  return `${PREFIX[docType]}-${ym.replace('-', '')}-${String(seq).padStart(3, '0')}`;
}
