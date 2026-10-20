import type { AckMode, AnnouncementKind, Audience } from '../api';
import type { Team } from '@/shared/types';
import { roleLabelKey } from '@/shared/lib/roles';

/** Төрөл → i18n түлхүүр (шошго, шүүлт, засварлагчийн сонголт — нэг эх). */
export const KIND_I18N: Record<AnnouncementKind, string> = {
  system_update: 'announcements.kind.system_update',
  company_info: 'announcements.kind.company_info',
  announcement: 'announcements.kind.announcement',
};

/** Баталгааны горим → i18n түлхүүр. */
export const ACK_MODE_I18N: Record<AckMode, string> = {
  none: 'announcements.ackMode.none',
  confirm: 'announcements.ackMode.confirm',
  signature: 'announcements.ackMode.signature',
};

/**
 * Хүрээний товч шошго — «Бүх ажилтан» | «Ахлах · BA, AR».  Роль ба багийг
 * ` · `-ээр, олон утгыг `, `-ээр.  `t` нь орчуулагч, `teams` нь нэр олоход.
 */
export function audienceLabel(
  a: Audience,
  t: (k: string) => string,
  teams: Pick<Team, 'id' | 'code'>[] | undefined,
): string {
  const parts: string[] = [];
  if (a.roles.length > 0) parts.push(a.roles.map((r) => t(roleLabelKey(r))).join(', '));
  if (a.team_ids.length > 0) {
    parts.push(a.team_ids.map((id) => teams?.find((tm) => tm.id === id)?.code ?? `#${id}`).join(', '));
  }
  return parts.length === 0 ? t('announcements.audience.everyone') : parts.join(' · ');
}
