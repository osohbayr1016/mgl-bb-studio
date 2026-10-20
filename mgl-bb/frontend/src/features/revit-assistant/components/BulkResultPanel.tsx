import { useMemo } from 'react';
import { CheckCircle2, CircleHelp, MinusCircle, RotateCcw, X, XCircle } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { cn } from '@/shared/lib/utils';

import { bulkReasonLabel, summarizeOutcomes, type BulkOutcomeStatus } from '../curation';
import type { BulkResult, BulkResultRow } from '../types';

/**
 * БАГЦ ҮЙЛДЛИЙН ТАЙЛАН — «20-оос 3 нь болсонгүй, ЭДГЭЭР нь».
 *
 * ⚠️ ЯАГААД toast БИШ ВЭ: toast нь 4 секундын дараа алга болдог бөгөөд
 * ГАНЦ тоо агуулна.  Хянагч 20 мөр илгээгээд «17 орлоо» гэсэн мэдэгдэл авах
 * нь ХЭРЭГГҮЙ мэдээлэл — үлдсэн 3 нь АЛЬ нь болохыг мэдэхгүй бол тэр 200
 * мөрийн жагсаалтыг нүдээр дахин уншиж олох ёстой.  Энэ самбар нь мөр
 * бүрийн бичвэр + төлөв + шалтгааныг ХАДГАЛЖ, хаах хүртэл дэлгэц дээр
 * үлдэнэ.
 *
 * ⚠️ Эрэмбэ нь ЗОРИУД: амжилтгүй → тодорхойгүй → алгасагдсан → амжилттай.
 * Амжилттай мөрүүд нь хийх ажилгүй тул доор байна; хянагчийн НҮД эхлээд
 * АСУУДАЛ дээр буух ёстой.
 *
 * ⚠️ `inferred` тэмдэглэгээ.  Сервер мөр тус бүрийн хариу буцаадаггүй үед
 * төлөвийг НИЙТ ТОО эсвэл ДАХИН уншигдсан дарааллаас ТААМАГЛАДАГ
 * (`curation.ts` → `reconcileBy*`).  Таамгийг серверийн баталгаатай нэг
 * өнгөөр харуулах нь ХУДАЛ итгэл төрүүлнэ, тиймээс ил ялгана.
 */

const STATUS_ORDER: Record<BulkOutcomeStatus, number> = {
  failed: 0,
  unknown: 1,
  skipped: 2,
  ok: 3,
};

const STATUS_META: Record<
  BulkOutcomeStatus,
  { icon: typeof CheckCircle2; badge: 'default' | 'destructive' | 'outline' | 'ghost'; labelKey: string }
> = {
  ok: { icon: CheckCircle2, badge: 'default', labelKey: 'assistantCuration.outcomeOk' },
  failed: { icon: XCircle, badge: 'destructive', labelKey: 'assistantCuration.outcomeFailed' },
  skipped: { icon: MinusCircle, badge: 'outline', labelKey: 'assistantCuration.outcomeSkipped' },
  unknown: { icon: CircleHelp, badge: 'ghost', labelKey: 'assistantCuration.outcomeUnknown' },
};

interface BulkResultPanelProps {
  result: BulkResult;
  onDismiss: () => void;
  /** Амжилтгүй / тодорхойгүй мөрүүдийг ДАХИН сонгоно (дахин оролдох гарц). */
  onReselect: (ids: number[]) => void;
}

export function BulkResultPanel({ result, onDismiss, onReselect }: BulkResultPanelProps) {
  const { t } = useLanguage();

  const sorted = useMemo<BulkResultRow[]>(
    () =>
      [...result.rows].sort(
        (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.id - b.id,
      ),
    [result.rows],
  );

  const totals = useMemo(() => summarizeOutcomes(result.rows), [result.rows]);
  const retryIds = useMemo(
    () => result.rows.filter((r) => r.status === 'failed' || r.status === 'unknown').map((r) => r.id),
    [result.rows],
  );

  const title = t(
    result.kind === 'promote'
      ? 'assistantCuration.resultTitlePromote'
      : 'assistantCuration.resultTitleReject',
  );

  return (
    <div
      role="status"
      aria-live="polite"
      className="space-y-3 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-label font-semibold">{title}</h3>
        {(['failed', 'unknown', 'skipped', 'ok'] as const).map((s) =>
          totals[s] > 0 ? (
            <Badge key={s} variant={STATUS_META[s].badge} className="gap-1">
              {t(STATUS_META[s].labelKey)} · {totals[s]}
            </Badge>
          ) : null,
        )}
        <span className="flex-1" />
        {retryIds.length > 0 ? (
          <Button variant="outline" size="sm" onClick={() => onReselect(retryIds)}>
            <RotateCcw aria-hidden />
            {t('assistantCuration.resultReselect', { count: retryIds.length })}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          onClick={onDismiss}
          aria-label={t('assistantCuration.resultDismiss')}
        >
          <X aria-hidden />
          {t('assistantCuration.resultDismiss')}
        </Button>
      </div>

      {/* ⚠️ Дуудлага БҮХЭЛДЭЭ унасан бол мөрийн төлөв нь «сервер татгалзсан»
          БИШ, «хүсэлт хүрээгүй».  Хоёрыг нэг үгээр тайлбарлавал хянагч
          өгөгдлөө алдсан гэж бодно. */}
      {result.requestFailed ? (
        <p className="rounded-md bg-destructive/10 p-3 text-body text-destructive">
          {t('assistantCuration.resultRequestFailed')}
        </p>
      ) : null}

      {!result.perRowFromServer && !result.requestFailed ? (
        <p className="rounded-md bg-muted p-3 text-micro text-muted-foreground">
          {t('assistantCuration.resultInferredHint')}
        </p>
      ) : null}

      <ul className="divide-y divide-border/60">
        {sorted.map((row) => {
          const meta = STATUS_META[row.status];
          const Icon = meta.icon;
          // ⚠️ Багц гарц нь `reason`-д НАРИЙН кодыг (`already_reviewed`, …)
          //    тавьдаг тул түүнийг орчуулна; хуучин гарцын түүхий алдааны
          //    мөр нь толинд байхгүй тул ӨӨРӨӨ хэвээр гарна.
          const reasonText = bulkReasonLabel(t, row.reason);
          return (
            <li key={row.id} className="flex items-start gap-3 py-2">
              <Icon
                aria-hidden
                className={cn(
                  'mt-0.5 size-4 shrink-0',
                  row.status === 'ok' && 'text-success',
                  row.status === 'failed' && 'text-destructive',
                  row.status === 'skipped' && 'text-muted-foreground',
                  row.status === 'unknown' && 'text-amber-600',
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="break-words text-body">{row.text || `#${row.id}`}</p>
                <p className="text-micro text-muted-foreground">
                  <span className="sr-only">{t(meta.labelKey)} — </span>
                  {t(meta.labelKey)}
                  {row.inferred ? ` · ${t('assistantCuration.outcomeInferred')}` : ''}
                  {row.reasonKey ? ` · ${t(row.reasonKey)}` : ''}
                  {reasonText ? ` · ${reasonText}` : ''}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
