import { useLanguage } from '@/shared/i18n';
import { Label } from '@/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import type { EmailAccount } from '@/features/email/types/email';

export function CorrespondenceSendMailboxFields({
  accounts,
  accountId,
  fromAddr,
  fromAliases,
  onAccountChange,
  onFromChange,
}: {
  accounts: EmailAccount[];
  accountId: string;
  fromAddr: string;
  fromAliases: string[];
  onAccountChange: (id: string) => void;
  onFromChange: (v: string) => void;
}) {
  const { t } = useLanguage();
  const selected = accounts.find((a) => String(a.id) === accountId);

  return (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs">{t('correspondenceLogTab.selectMailbox')}</Label>
        <Select value={accountId} onValueChange={onAccountChange}>
          <SelectTrigger className="h-9 font-mono text-xs">
            <SelectValue placeholder={t('correspondenceLogTab.selectMailbox')} />
          </SelectTrigger>
          <SelectContent position="popper">
            {accounts.map((a) => (
              <SelectItem key={a.id} value={String(a.id)} className="font-mono text-xs">
                {a.label ? `${a.label} · ` : ''}
                {a.address}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {selected && (
        <div className="space-y-1.5">
          <Label className="text-xs">{t('correspondenceLogTab.fromAlias')}</Label>
          <Select value={fromAddr} onValueChange={onFromChange}>
            <SelectTrigger className="h-9 font-mono text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value={selected.address} className="font-mono text-xs">
                {selected.address}
              </SelectItem>
              {fromAliases.map((a) => (
                <SelectItem key={a} value={a} className="font-mono text-xs">
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </>
  );
}
