/**
 * Төслийн ЖАГСААЛТ хуудасны нэг мөрийн хугацааны chip.
 *
 * «Дараагийн хугацаа хэзээ вэ, хэд нь хэтэрсэн бэ» гэсэн ХОЁР баримтыг
 * нэг мөрөнд багтаана.  Өгөгдөл нь `GET /api/deadlines/summary`-аас
 * БАГЦААР ирнэ (карт бүр өөрөө дуудвал N+1 хүсэлт болно) — тиймээс энэ
 * компонент өөрөө хүсэлт ХИЙХГҮЙ, зөвхөн дүрсэлнэ.
 *
 * ⚠️ Мэдэгдэх зүйлгүй бол ЮУ Ч ГАРГАХГҮЙ (null).  Хугацаа тавиагүй төсөл
 *    дээр хоосон хайрцаг үлдээвэл жагсаалт бүхэлдээ чимээ шуугиантай
 *    болно — карт нь аль хэдийн явц, хуваарь хоёрыг харуулж байгаа.
 *
 * ⚠ Өнгө ганцаараа мэдээлэл дамжуулахгүй: огнооны хажууд «N хоног»
 *   гэсэн текст үргэлж явна (`riskDisplay.ts`-ийн дүрэм).
 */
import { Flag } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { RISK_TONE, riskDetail, riskLabelKey } from '@/features/timeline/lib/riskDisplay';

import type { DeadlineSummary } from './types';

export function ProjectDeadlineChip({
  summary,
  className,
}: {
  summary: DeadlineSummary | undefined;
  className?: string;
}) {
  const { t } = useLanguage();

  if (!summary || summary.next === null) return null;

  const { next, overdue_count } = summary;
  const tone = RISK_TONE[next.risk_state];
  const detail = riskDetail(t, next.risk_state, next.days_left, null, null);

  return (
    <div className={cn('flex min-w-0 items-center gap-1.5 text-[11px]', className)}>
      <Flag className="h-3 w-3 flex-none text-muted-foreground" aria-hidden="true" />
      <span
        className={cn(
          'flex-none rounded border px-1 py-px tabular-nums',
          tone.chip,
        )}
      >
        {next.due_date}
      </span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground" title={next.title}>
        {next.title}
      </span>
      <span className="flex-none text-muted-foreground">
        {detail || t(riskLabelKey(next.risk_state))}
      </span>
      {/* Хэтэрсэн тоо нь «дараагийнх» мөрөөс ТУСДАА баримт — дараагийнх нь
          хэтэрсэн байсан ч ард нь өөр хэдэн мөр хэвтэж болно. */}
      {overdue_count > 1 && (
        <span className="flex-none rounded border border-danger/40 bg-danger/15 px-1 py-px text-danger">
          {t('deadlines.overdueCount', { n: overdue_count })}
        </span>
      )}
    </div>
  );
}

export default ProjectDeadlineChip;
