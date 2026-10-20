import { Badge } from '@/ui/badge';
import { Label } from '@/ui/label';
import { useLanguage } from '@/shared/i18n';
import type { ClientContact } from '@/shared/types';

export function ClientContactChips({
  contacts,
  onPick,
}: {
  contacts: ClientContact[];
  onPick: (email: string) => void;
}) {
  const { t } = useLanguage();
  if (contacts.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{t('correspondenceLogTab.pickClientContact')}</Label>
      <div className="flex flex-wrap gap-1.5">
        {contacts.map((c, i) => (
          <button
            key={`${c.email}-${i}`}
            type="button"
            onClick={() => onPick(c.email)}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/30 px-2 py-1 text-[11px] hover:bg-muted"
          >
            <Badge variant="outline" className="h-4 px-1 text-[9px]">
              {c.full_name || c.email}
            </Badge>
            <span className="font-mono text-muted-foreground">{c.email}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
