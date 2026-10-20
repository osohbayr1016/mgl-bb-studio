/**
 * email_account_teams — which firm mailboxes a team may send from.
 * Empty junction on an account = visible to every team (backward compatible).
 */
import type { EmailAccountRow } from '../types';

const ACCOUNT_COLUMNS =
  'id, address, label, auth_type, history_id, last_synced_at, last_sync_error, watch_expiration, is_active, created_at, updated_at';

export type PublicEmailAccount = Omit<EmailAccountRow, 'refresh_token_enc' | 'created_by_id'>;

/** Team ids linked to a mailbox. Empty = unrestricted (all teams). */
export async function getAccountTeamIds(db: D1Database, accountId: number): Promise<number[]> {
  const { results } = await db
    .prepare('SELECT team_id FROM email_account_teams WHERE account_id = ? ORDER BY team_id')
    .bind(accountId)
    .all<{ team_id: number }>();
  return (results ?? []).map((r) => r.team_id);
}

export async function setAccountTeamIds(
  db: D1Database,
  accountId: number,
  teamIds: number[],
): Promise<void> {
  const unique = [...new Set(teamIds.filter((id) => Number.isFinite(id)))];
  await db.prepare('DELETE FROM email_account_teams WHERE account_id = ?').bind(accountId).run();
  for (const teamId of unique) {
    await db
      .prepare('INSERT OR IGNORE INTO email_account_teams (account_id, team_id) VALUES (?, ?)')
      .bind(accountId, teamId)
      .run();
  }
}

async function userTeamId(db: D1Database, userId: number): Promise<number | null> {
  const row = await db
    .prepare('SELECT team_id FROM users WHERE id = ?')
    .bind(userId)
    .first<{ team_id: number | null }>();
  return row?.team_id ?? null;
}

/** Active mailboxes the viewer may send from (team-scoped; admin sees all). */
export async function listSendableAccounts(
  db: D1Database,
  viewer: { sub: number; role: string },
): Promise<PublicEmailAccount[]> {
  const isAdmin = viewer.role === 'admin';
  const teamId = isAdmin ? null : await userTeamId(db, viewer.sub);

  const { results } = await db
    .prepare(`SELECT ${ACCOUNT_COLUMNS} FROM email_accounts WHERE is_active = 1 ORDER BY id`)
    .all<PublicEmailAccount>();

  const accounts = results ?? [];
  if (isAdmin) return accounts;

  const filtered: PublicEmailAccount[] = [];
  for (const acct of accounts) {
    const linked = await getAccountTeamIds(db, acct.id);
    if (linked.length === 0) {
      filtered.push(acct);
      continue;
    }
    if (teamId != null && linked.includes(teamId)) filtered.push(acct);
  }
  return filtered;
}

/** Whether `accountId` is sendable by `viewer`. */
export async function canUseAccount(
  db: D1Database,
  viewer: { sub: number; role: string },
  accountId: number,
): Promise<boolean> {
  const accounts = await listSendableAccounts(db, viewer);
  return accounts.some((a) => a.id === accountId);
}
