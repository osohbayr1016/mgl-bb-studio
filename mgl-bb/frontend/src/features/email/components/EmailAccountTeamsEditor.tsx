import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Save } from 'lucide-react';
import { updateAccount } from '@/features/email/api/email';
import { EmailAccountTeamPicker } from '@/features/email/components/EmailAccountTeamPicker';
import type { EmailAccount } from '@/features/email/types/email';
import { Button } from '@/ui/button';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';

export function EmailAccountTeamsEditor({
  account,
  onSaved,
}: {
  account: EmailAccount;
  onSaved: () => void;
}) {
  const { t } = useLanguage();
  const [teamIds, setTeamIds] = useState<number[]>(account.team_ids ?? []);

  const save = useMutation({
    mutationFn: () => updateAccount(account.id, { team_ids: teamIds }),
    onSuccess: () => {
      toast.success(t('emailAccountsAdminPage.teamsSaved'));
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const dirty =
    JSON.stringify([...(account.team_ids ?? [])].sort()) !== JSON.stringify([...teamIds].sort());

  return (
    <div className="w-full">
      <EmailAccountTeamPicker teamIds={teamIds} onChange={setTeamIds} disabled={save.isPending} />
      {dirty && (
        <Button
          size="sm"
          variant="outline"
          className="mt-2 h-7 text-xs gap-1"
          disabled={save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Save className="h-3 w-3" />
          )}
          {t('emailAccountsAdminPage.saveTeams')}
        </Button>
      )}
    </div>
  );
}
