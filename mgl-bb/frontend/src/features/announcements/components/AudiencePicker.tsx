import { useApiQuery } from '@/shared/api/useApi';
import { useLanguage, pickLocalized } from '@/shared/i18n';
import { ANNOUNCEMENT_ROLES, roleLabelKey } from '@/shared/lib/roles';
import { cn } from '@/shared/lib/utils';
import type { Team, UserRole } from '@/shared/types';
import { Checkbox } from '@/ui/checkbox';
import { Label } from '@/ui/label';

import type { Audience } from '../api';

/**
 * Хүрээ сонгогч — role × баг.  Юу ч сонгоогүй = бүх ажилтан.  Хоёулаа
 * сонгосон бол ХОЁУЛАА биелэх ёстой (сервер `audienceMatches`-тэй ижил дүрэм):
 * «BA багийн senior».  Дэлгэцэн дээрх тайлбар тэр дүрмийг хэлнэ.
 */
export function AudiencePicker({ value, onChange, disabled }: { value: Audience; onChange: (a: Audience) => void; disabled?: boolean }) {
  const { t, lang } = useLanguage();
  const teamsQuery = useApiQuery<{ teams: Team[] }>(['/teams'], '/teams', { retry: false, staleTime: 60_000 });
  const teams = teamsQuery.data?.teams ?? [];

  const toggleRole = (role: UserRole) => {
    const roles = value.roles.includes(role) ? value.roles.filter((r) => r !== role) : [...value.roles, role];
    onChange({ ...value, roles });
  };
  const toggleTeam = (id: number) => {
    const team_ids = value.team_ids.includes(id) ? value.team_ids.filter((x) => x !== id) : [...value.team_ids, id];
    onChange({ ...value, team_ids });
  };
  const everyone = value.roles.length === 0 && value.team_ids.length === 0;

  return (
    <div className="space-y-3" data-testid="audience-picker">
      <div className="flex items-center gap-2">
        <Checkbox
          id="aud-everyone"
          checked={everyone}
          disabled={disabled}
          onCheckedChange={(v) => {
            if (v === true) onChange({ roles: [], team_ids: [] });
          }}
        />
        <Label htmlFor="aud-everyone" className="text-sm">
          {t('announcements.audience.everyone')}
        </Label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset className="space-y-1.5">
          <legend className="text-micro font-medium uppercase tracking-wide text-muted-foreground">{t('announcements.audience.roles')}</legend>
          {ANNOUNCEMENT_ROLES.map((role) => (
            <div key={role} className="flex items-center gap-2">
              <Checkbox id={`aud-role-${role}`} checked={value.roles.includes(role)} disabled={disabled} onCheckedChange={() => toggleRole(role)} />
              <Label htmlFor={`aud-role-${role}`} className={cn('text-sm', !value.roles.includes(role) && 'text-muted-foreground')}>
                {t(roleLabelKey(role))}
              </Label>
            </div>
          ))}
        </fieldset>
        <fieldset className="space-y-1.5">
          <legend className="text-micro font-medium uppercase tracking-wide text-muted-foreground">{t('announcements.audience.teams')}</legend>
          {teams.length === 0 && <p className="text-micro text-muted-foreground">{t('common.loading')}</p>}
          {teams.map((team) => (
            <div key={team.id} className="flex items-center gap-2">
              <Checkbox id={`aud-team-${team.id}`} checked={value.team_ids.includes(team.id)} disabled={disabled} onCheckedChange={() => toggleTeam(team.id)} />
              <Label htmlFor={`aud-team-${team.id}`} className={cn('text-sm', !value.team_ids.includes(team.id) && 'text-muted-foreground')}>
                <span className="font-mono text-micro text-muted-foreground">{team.code}</span> {pickLocalized(lang, team.name_mn, team.name_en)}
              </Label>
            </div>
          ))}
        </fieldset>
      </div>
      <p className="text-micro text-muted-foreground">{everyone ? t('announcements.audience.everyoneHint') : t('announcements.audience.bothHint')}</p>
    </div>
  );
}
