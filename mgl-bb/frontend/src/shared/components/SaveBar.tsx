/**
 * Хадгалалтын төлөвийн индикатор (autosave-тэй хуудсуудад).
 *   saving  — spinner + "Хадгалж байна…"
 *   error   — улаан + "Хадгалж чадсангүй"
 *   dirty   — амбер + "Хадгалаагүй"
 *   saved   — ногоон check + "Хадгалагдсан" (2.2с дараа арилна)
 *   idle    — саарал "Хамгийн сүүлд: 12 секундын өмнө"
 *
 * Өмнө нь features/quotes-д амьдарч байсныг үнийн саналын feature устгахад
 * shared рүү нүүлгэсэн (PGP autosave үүнийг ашигладаг).
 */
import { useEffect, useState } from 'react';
import { Check, Loader2, Save } from 'lucide-react';
import { Button } from '@/ui/button';
import { cn } from '@/shared/lib/utils';
import { formatTimeAgo } from '@/shared/lib/formatting';
import { useLanguage } from '@/shared/i18n';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface Props {
  status: SaveStatus;
  dirty: boolean;
  lastSavedAt: string | null;
  locale: 'mn' | 'en';
  onSave: () => void;
}

export function SaveBar({ status, dirty, lastSavedAt, locale, onSave }: Props) {
  const { t } = useLanguage();
  const [showSaved, setShowSaved] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (status === 'saved' && !dirty) {
      setShowSaved(true);
      const id = setTimeout(() => setShowSaved(false), 2200);
      return () => clearTimeout(id);
    }
    setShowSaved(false);
  }, [status, dirty]);

  // "12 секундын өмнө" ойролцоо байлгахын тулд 10с тутам re-tick.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  let label: string;
  let cls: string;
  let icon: React.ReactNode;
  if (status === 'saving') {
    label = t('common.saving');
    cls = 'bg-info/10 text-info border-info/30';
    icon = <Loader2 className="h-3 w-3 animate-spin" />;
  } else if (status === 'error') {
    label = t('common.saveFailed');
    cls = 'bg-destructive/10 text-destructive border-destructive/30';
    icon = <Save className="h-3 w-3" />;
  } else if (dirty) {
    label = t('saveBar.unsaved');
    cls = 'bg-warning/10 text-warning border-warning/30';
    icon = <Save className="h-3 w-3" />;
  } else if (showSaved) {
    label = t('saveBar.saved');
    cls = 'bg-success/10 text-success border-success/30';
    icon = <Check className="h-3 w-3" />;
  } else if (lastSavedAt) {
    const ago = formatTimeAgo(lastSavedAt, locale);
    label = t('saveBar.lastSaved', { ago });
    cls = 'bg-muted text-muted-foreground border-border';
    icon = <Check className="h-3 w-3" />;
  } else {
    label = t('saveBar.newDraft');
    cls = 'bg-muted text-muted-foreground border-border';
    icon = <Save className="h-3 w-3" />;
  }

  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-label font-medium ',
          cls,
        )}
      >
        {icon}
        {label}
      </span>
      <Button
        type="button"
        size="sm"
        variant={dirty || status === 'error' ? 'default' : 'outline'}
        onClick={onSave}
        disabled={status === 'saving' || (!dirty && status !== 'error')}
        className="h-7 text-xs"
      >
        <Save className="mr-1 h-3 w-3" />
        {t('common.save')}
      </Button>
    </div>
  );
}
