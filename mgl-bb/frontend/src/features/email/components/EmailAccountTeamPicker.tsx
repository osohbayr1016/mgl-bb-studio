import { useApiQuery } from '@/shared/api/useApi';
import { useLanguage } from '@/shared/i18n';
import { Label } from '@/ui/label';
import { Checkbox } from '@/ui/checkbox';
import type { Team } from '@/shared/types';

export function EmailAccountTeamPicker({
  teamIds,
  onChange,
  disabled,
}: {
  teamIds: number[];
  onChange: (ids: number[]) => void;
  disabled?: boolean;
}) {
  const { t } = useLanguage();
  const { data } = useApiQuery<{ teams: Team[] }>('/teams');
  const teams = data?.teams ?? [];

  const toggle = (id: number, checked: boolean) => {
    if (checked) onChange([...new Set([...teamIds, id])]);
    else onChange(teamIds.filter((t) => t !== id));
  };

  if (teams.length === 0) return null;

  return (
    <div className="space-y-1.5 pt-2 border-t border-border/60">
      <Label className="text-xs">{t('emailAccountsAdminPage.teamsLabel')}</Label>
      <p className="text-[10px] text-muted-foreground">{t('emailAccountsAdminPage.teamsHint')}</p>
      <div className="flex flex-wrap gap-2">
        {teams.map((team) => (
          <label
            key={team.id}
            className="inline-flex items-center gap-1.5 text-xs rounded-md border border-border px-2 py-1"
          >
            <Checkbox
              checked={teamIds.includes(team.id)}
              disabled={disabled}
              onCheckedChange={(v) => toggle(team.id, v === true)}
            />
            {team.code}
          </label>
        ))}
      </div>
    </div>
  );
}
