import { useState } from 'react';
import { CheckCircle2, ClipboardList, Loader2, Pencil, Trash2 } from 'lucide-react';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { formatDate } from '@/shared/lib/time';
import { toast } from '@/shared/components/Toast';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { ApiError } from '@/shared/api/client';
import { fmtPts } from '@/features/reports/lib/format';
import { STAGE_TONE, categoryLabel, entryTimeLabel } from './lib';
import { useNonProjectWorkActions } from './useNonProjectWork';
import type { NonProjectEntry } from './types';

interface Props {
  entry: NonProjectEntry;
  /** Огноог харуулах эсэх. */
  showDate?: boolean;
  /** Дуусгах / засах цонх (цаг + «юу хийсэн»). */
  onEdit?: (entry: NonProjectEntry) => void;
  /** Бусад үйлдэл ажиллаж байх үед товчнуудыг түгжинэ. */
  disabled?: boolean;
}

/**
 * «Миний ажлууд»-ын нэг төслийн бус ажлын мөр: төрөл («Бусад» бол бичсэн нэр),
 * цаг (ирцэд сонгосон бол «Ирцэд 15:00-д сонгосон · цаг оруулаагүй»), шат,
 * «юу хийсэн» тайлбар.  Ирцэд сонгосон ч дуусгаагүй (`needs_report`) мөрөнд
 * «Дуусгаж бүртгэх» товч — ажилтан ажлаа дуусгасны дараа эндээс цаг, тайлбараа
 * оруулж шалгуулна (эзний дүрэм 2026-09-28).  Засах/устгах нь зөвхөн админ
 * шалгаагүй (`pending`) үед — сервер ч мөн адил хаана.
 */
export default function NonProjectEntryItem({ entry, showDate = false, onEdit, disabled = false }: Props) {
  const { t } = useLanguage();
  const actions = useNonProjectWorkActions();
  const pending = entry.status === 'pending';
  const incomplete = entry.stage === 'needs_report';
  const [deleting, setDeleting] = useState(false);

  const label = categoryLabel(entry.category, entry.category_label, t);
  const busy = disabled || deleting;

  const remove = async () => {
    if (
      !(await confirmDialog({
        description: t('nonProjectWork.deleteConfirm'),
        variant: 'destructive',
        confirmText: t('common.delete'),
      }))
    )
      return;
    setDeleting(true);
    try {
      await actions.remove(entry.id);
      toast.success(t('nonProjectWork.deleted'));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('nonProjectWork.failed'));
      setDeleting(false);
    }
  };

  return (
    <li className="flex items-start gap-3 py-2.5" data-testid="npw-entry" data-stage={entry.stage}>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-info/30 bg-info/10 text-info">
        <ClipboardList className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground break-words">
            {label}
            {entry.note && <span className="font-normal text-muted-foreground"> · {entry.note}</span>}
          </span>
          <Badge variant="outline" className={cn('text-micro', STAGE_TONE[entry.stage])}>
            {t(`nonProjectWork.stage.${entry.stage}`)}
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground tabular-nums">
          {showDate && <span>{formatDate(new Date(entry.date))} · </span>}
          {entryTimeLabel(entry, t)}
        </div>
        {entry.stage === 'approved' && entry.computed_pct != null && (
          // Админ баталсны дараа л бүтээмжид орно — хэдэн хувь орсныг ажилтанд харуулна.
          <div className="text-xs font-medium text-success tabular-nums" data-testid="npw-earned">
            {t('nonProjectWork.earned', { pct: fmtPts(entry.computed_pct) })}
          </div>
        )}

        {entry.report && (
          <p className="whitespace-pre-wrap break-words rounded-md bg-muted/40 px-2 py-1 text-xs text-foreground">
            {entry.report}
          </p>
        )}

        {entry.review_note && (
          <p className="rounded-md border border-border/50 bg-muted/50 px-2 py-1 text-micro">
            {t('nonProjectWork.reviewNote', { note: entry.review_note })}
          </p>
        )}

        {pending && incomplete && onEdit && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-2 text-xs"
            disabled={busy}
            onClick={() => onEdit(entry)}
            data-testid="npw-complete"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t('nonProjectWork.complete')}
          </Button>
        )}
      </div>

      {pending && (
        <div className="flex shrink-0 items-center gap-0.5">
          {onEdit && !incomplete && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              disabled={busy}
              onClick={() => onEdit(entry)}
              aria-label={t('nonProjectWork.edit')}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            disabled={busy}
            onClick={() => void remove()}
            aria-label={t('common.delete')}
          >
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </Button>
        </div>
      )}
    </li>
  );
}
