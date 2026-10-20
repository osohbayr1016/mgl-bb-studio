import { Send, Loader2, X, Plus, CheckSquare, AlertTriangle } from 'lucide-react';
import { Button } from '@/ui/button';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';

/**
 * Сонгосон мөрүүдийг НЭГ дор явуулах доод самбар.
 *
 * Урьд нь мөр бүрд % бичээд Send дардаг байсан тул 15 таск = 15 үйлдэл,
 * 15 round-trip.  Одоо мөрүүдээ тэмдэглээд «+10%» → «Илгээх» гэсэн хоёр
 * үйлдэл болно (`POST /api/progress/bulk`).
 *
 * ⚠️ 100% хүрэх мөрүүд bulk-д ОРОХГҮЙ: тэдгээр нь дуусгах асуултуудыг
 * шаарддаг бөгөөд тэр нь мөр тус бүрийн харилцах цонх.  Тоог нь энд
 * тодорхой хэлж, ажилтан гайхахгүй байхаар шар анхааруулга үзүүлнэ.
 *
 * Байрлал нь `StickySaveBar`-тай ижил томьёо: утсан дээр доод navbar-ын
 * ДЭЭР (`--app-bottom-nav-h`), `z-30` нь navbar-ын `z-40`-ээс доогуур.
 */
export default function BulkReportBar({
  selectedCount,
  sendableCount,
  needsDialogCount,
  emptyCount,
  submitting,
  onBump,
  onSelectAll,
  onClear,
  onSubmit,
}: {
  selectedCount: number;
  sendableCount: number;
  /** 100%-д хүрсэн тул дуусгах асуултын dialog шаардаж буй мөрийн тоо. */
  needsDialogCount: number;
  /** Хувь нь хараахан бөглөгдөөгүй мөрийн тоо. */
  emptyCount: number;
  submitting: boolean;
  onBump: (delta: number) => void;
  onSelectAll: () => void;
  onClear: () => void;
  onSubmit: () => void;
}) {
  const { t } = useLanguage();
  if (selectedCount === 0) return null;

  return (
    <div
      role="region"
      aria-label={t('dailyReport.bulkTitle')}
      className={cn(
        'fixed inset-x-0 z-30 border-t border-primary/30 bg-background/95 backdrop-blur',
        'bottom-[calc(var(--app-bottom-nav-h)+env(safe-area-inset-bottom))] lg:bottom-0',
        'animate-in slide-in-from-bottom-2 fade-in duration-200',
      )}
    >
      <div className="mx-auto max-w-7xl px-4 py-2.5 flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1.5 text-sm shrink-0">
          <span
            className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full
                       bg-primary/15 text-primary text-[11px] font-semibold tabular-nums"
          >
            {selectedCount}
          </span>
          <span className="text-foreground/90">{t('dailyReport.bulkSelected')}</span>
        </span>

        <div className="flex items-center gap-1">
          {[5, 10, 25].map((delta) => (
            <Button
              key={delta}
              size="sm"
              variant="outline"
              className="h-8 px-2 text-xs tabular-nums"
              onClick={() => onBump(delta)}
              disabled={submitting}
              title={t('dailyReport.bulkBumpTitle', { delta })}
            >
              <Plus className="h-3 w-3 mr-0.5" />
              {delta}%
            </Button>
          ))}
        </div>

        <Button
          size="sm"
          variant="ghost"
          className="h-8 px-2 text-xs text-muted-foreground"
          onClick={onSelectAll}
          disabled={submitting}
        >
          <CheckSquare className="h-3.5 w-3.5 mr-1" />
          {t('dailyReport.bulkSelectAll')}
        </Button>

        {needsDialogCount > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] text-warning">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            {t('dailyReport.bulkBlocked', { count: needsDialogCount })}
          </span>
        )}
        {emptyCount > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            {t('dailyReport.bulkEmpty', { count: emptyCount })}
          </span>
        )}

        <div className="ml-auto flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2 text-xs"
            onClick={onClear}
            disabled={submitting}
          >
            <X className="h-3.5 w-3.5 mr-1" />
            {t('dailyReport.bulkClear')}
          </Button>
          <Button size="sm" className="h-8" onClick={onSubmit} disabled={submitting || sendableCount === 0}>
            {submitting ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5 mr-1.5" />
            )}
            {t('dailyReport.bulkSend', { count: sendableCount })}
          </Button>
        </div>
      </div>
    </div>
  );
}
