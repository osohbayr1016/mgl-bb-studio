import { useMemo } from 'react';
import { useAsrCompanionCandidates } from './api';
import type { MeetingParticipant } from './meetingDoc';
import { isAsrPersisted, type AsrFormState, type AsrReport } from './types';

export interface CandidateUser {
  id: number;
  full_name: string;
  username: string;
  position: string | null;
  profile_image: string | null;
  team_code: string | null;
}

/**
 * Маягтын АМЬД «Оролцсон» жагсаалт: зохиогч + `form.companion_user_ids`
 * (хадгалаагүй сонголт ч) — нэр, албан тушаалыг хадгалсан companions эсвэл
 * нэр дэвшигчдийн жагсаалтаас.  `name` нь ТҮҮХИЙ бүтэн нэр — хэвлэх баримтын
 * `meetingParticipants`-тай ижил, тиймээс «Манай тал»-ын `sig_arch_name`
 * хоёр талд нэг утгаар таарна.
 */
export function useMeetingParticipantOptions(
  entry: AsrReport,
  form: AsrFormState,
  enabled: boolean,
): { participants: MeetingParticipant[]; loading: boolean; pool: CandidateUser[] } {
  const candidates = useAsrCompanionCandidates(
    isAsrPersisted(entry) ? entry.id : null,
    enabled,
    'all',
  );
  const pool = useMemo<CandidateUser[]>(
    () =>
      (candidates.data?.users ?? []).map((u) => ({
        id: u.id,
        full_name: u.full_name,
        username: u.username ?? '',
        position: u.position ?? null,
        profile_image: u.profile_image ?? null,
        team_code: (u.team_codes ?? '').split(',')[0]?.trim() || null,
      })),
    [candidates.data],
  );
  const participants = useMemo(() => {
    const saved = new Map((entry.companions ?? []).map((c) => [c.user_id, c]));
    const byId = new Map(pool.map((u) => [u.id, u]));
    const out: MeetingParticipant[] = [];
    if (entry.author_name) {
      out.push({
        id: entry.author_id,
        name: entry.author_name,
        position: (entry.author_position ?? '').trim(),
        author: true,
      });
    }
    for (const id of form.companion_user_ids) {
      if (id === entry.author_id) continue;
      const s = saved.get(id);
      const u = byId.get(id);
      out.push({
        id,
        name: s?.full_name ?? u?.full_name ?? '',
        position: (s?.position ?? u?.position ?? '').trim(),
        author: false,
      });
    }
    return out;
  }, [entry.author_id, entry.author_name, entry.author_position, entry.companions, form.companion_user_ids, pool]);
  return { participants, loading: candidates.isLoading, pool };
}

