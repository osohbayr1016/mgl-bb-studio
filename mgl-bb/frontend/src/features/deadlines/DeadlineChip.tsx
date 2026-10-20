/**
 * Төслийн hero мөрөнд суух хугацааны chip — шаардлага #1
 * («deadline хугацаа шууд харагддаг болгох»).
 *
 * Өөрөө өгөгдлөө татна (`/api/deadlines/project/:id`) тул hero карт руу
 * огноо дамжуулах шаардлагагүй.  ⚠️ `GET /api/projects/:id` нь
 * `SELECT * FROM projects` тул паспортын огноог БУЦААДАГГҮЙ — тиймээс
 * chip нь «Хугацаа» табтай ЯГ НЭГ эх сурвалжаас уншина (query түлхүүр ч
 * ижил, тул хоёр газарт хоёр дуудлага явахгүй, кэш нь хуваалцагдана).
 *
 * Огноо тодорхойгүй (паспорт хоосон, эсвэл '-' гэх мэт хог утга) үед
 * chip нь ОГТ гарахгүй — hero мөрийг хоосон мэдээллээр дүүргэхгүй.
 */
import { Link } from 'react-router-dom';
import { CalendarClock } from 'lucide-react';

import { Badge } from '@/ui/badge';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { RISK_TONE, riskDetail, riskLabelKey } from '@/features/timeline/lib/riskDisplay';

import { useProjectDeadlines } from './api';

export function DeadlineChip({
  projectId,
  className,
}: {
  projectId: number;
  className?: string;
}) {
  const { t } = useLanguage();
  const { data } = useProjectDeadlines(projectId);
  const proj = data?.project;

  if (!proj?.finish_date) return null;

  const tone = RISK_TONE[proj.risk_state];
  const detail = riskDetail(t, proj.risk_state, proj.days_left, null, proj.days_to_start);

  return (
    <Badge
      asChild
      variant="outline"
      className={cn('gap-1.5 tabular-nums', tone.chip, className)}
      title={t('deadlines.projectFinish')}
    >
      {/* «Хугацаа» таб руу шууд аваачна — chip дарахад дэлгэрэнгүй нээгдэнэ. */}
      <Link to={`/app/projects/${projectId}?tab=deadlines`}>
        <CalendarClock className="h-3 w-3" />
        {proj.finish_date}
        {/* Өнгө ганцаараа мэдээлэл дамжуулахгүй — текст ЗААВАЛ дагана. */}
        <span className="opacity-80">· {detail || t(riskLabelKey(proj.risk_state))}</span>
      </Link>
    </Badge>
  );
}

export default DeadlineChip;
