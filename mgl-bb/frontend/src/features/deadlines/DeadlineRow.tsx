/**
 * Хугацааны жагсаалтын НЭГ мөр.
 *
 * Дөрвөн төрлийг (project / block / task / sub) нэг хэлбэрээр харуулна —
 * зүүн талд эрсдэлийн цэг, дунд нь гарчиг + контекст, баруун талд огноо
 * ба «N хоног үлдсэн».
 *
 * ⚠ Өнгө ХЭЗЭЭ Ч ганцаараа мэдээлэл дамжуулахгүй (`riskDisplay.ts`-ийн
 *   дүрэм): төлөвийн ТЕКСТ шошго үргэлж дагалдана.  Өнгө ялгадаггүй
 *   хэрэглэгч ба хэвлэсэн PDF хоёулаа уншигдана.
 */
import { Link } from 'react-router-dom';
import {
  CalendarDays,
  CheckCircle2,
  Circle,
  Flag,
  Layers3,
  Link2,
  ListChecks,
  Target,
} from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { RISK_TONE, riskDetail, riskLabelKey } from '@/features/timeline/lib/riskDisplay';

import type { DeadlineItem, DeadlineKind } from './types';

const KIND_ICON: Record<DeadlineKind, typeof Target> = {
  project: CalendarDays,
  milestone: Flag,
  block: Layers3,
  task: Target,
  sub: ListChecks,
};

const KIND_LABEL: Record<DeadlineKind, string> = {
  project: 'deadlines.kindProject',
  milestone: 'deadlines.kindMilestone',
  block: 'deadlines.kindBlock',
  task: 'deadlines.kindTask',
  sub: 'deadlines.kindSub',
};

export function DeadlineRow({
  item,
  /** Dashboard дээр мөр өөр өөр төслийнх тул төслийн нэрийг харуулна.
   *  Төслийн доторх табд бүгд нэг төслийнх тул шаардлагагүй. */
  showProject = false,
  /** Мөрийн баруун талд нэмэлт удирдлага (жишээ нь дэд хугацааны товчнууд). */
  trailing,
  /** Модны догол — дэд milestone-ыг эцгийнхээ доор шилжүүлж харуулна.
   *  ЗӨВХӨН харагдац: өгөгдөл нь хавтгай хэвээр. */
  indent = false,
}: {
  item: DeadlineItem;
  showProject?: boolean;
  trailing?: React.ReactNode;
  indent?: boolean;
}) {
  const { t } = useLanguage();
  const tone = RISK_TONE[item.risk_state];
  const Icon = KIND_ICON[item.kind];
  const detail = riskDetail(t, item.risk_state, item.days_left, null, item.days_to_start);

  // Контекстийн мөр: «Блок 1 · Тэнхлэг зурах» гэх мэт.  Дэд хугацаа нь
  // эцэг таскаа заавал харуулна — ганцаараа утгагүй.
  const context = [
    showProject ? item.project_title : null,
    item.kind === 'sub' ? item.task_name : null,
    item.kind === 'task' || item.kind === 'sub' ? item.block_name : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const body = (
    <>
      <span
        className={cn('mt-1.5 h-2 w-2 flex-none rounded-full', tone.dot)}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <Icon className="h-3.5 w-3.5 flex-none translate-y-0.5 text-muted-foreground" />
          <span
            className={cn(
              'truncate text-sm font-medium',
              item.done && 'text-muted-foreground line-through',
            )}
          >
            {item.title}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
          <span className="rounded bg-muted px-1 py-px font-medium">{t(KIND_LABEL[item.kind])}</span>
          {/* Ажилтай холбогдсон milestone — «энэ нь өөрөө хаагдана» гэдгийг
              ил хэлнэ, эс бөгөөс чагт байхгүйг алдаа гэж ойлгоно. */}
          {item.link && (
            <span
              className="inline-flex max-w-[14rem] items-center gap-0.5 truncate rounded bg-info/10 px-1 py-px text-info"
              title={t('deadlines.linkedHint')}
            >
              <Link2 className="h-2.5 w-2.5 flex-none" />
              <span className="truncate">{item.link.name}</span>
            </span>
          )}
          {context && <span className="truncate">{context}</span>}
          {item.people.length > 0 && (
            <span className="truncate">
              · {item.people.map((p) => p.full_name).join(', ')}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-none flex-col items-end gap-0.5">
        <span className="text-xs tabular-nums text-muted-foreground">
          {item.due_date ?? t('deadlines.noDate')}
        </span>
        {/* Төлөвийн шошго — өнгөний хажууд ЗААВАЛ текст. */}
        <span
          className={cn(
            'inline-flex items-center rounded border px-1.5 py-px text-[10px] font-medium',
            tone.chip,
          )}
        >
          {detail || t(riskLabelKey(item.risk_state))}
        </span>
      </div>
    </>
  );

  const rowClass = cn(
    'flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-muted/50',
    // Дэд хугацааны догол — зүүн талын нимгэн зураас нь эцэгтэйгээ
    // холбоотойг өнгөнөөс үл хамааран (хэлбэрээр) харуулна.
    indent && 'ml-4 border-l border-border/60 pl-3',
  );

  // Мөр дээр дарахад холбогдох хуудас руу шилжинэ.  Дэд хугацаа нь өөрийн
  // хуудасгүй тул эцэг таскийн төсөл рүү (эсвэл товчтой бол огт линкгүй).
  // Milestone нь төслийн «Хугацаа» таб руу шууд онилно.
  const href =
    item.kind === 'project'
      ? `/app/projects/${item.id}`
      : item.project_id
        ? `/app/projects/${item.project_id}${item.kind === 'milestone' ? '?tab=deadlines' : ''}`
        : null;

  if (trailing) {
    return (
      <div className={rowClass}>
        {body}
        <div className="flex flex-none items-center gap-1">{trailing}</div>
      </div>
    );
  }

  return href ? (
    <Link to={href} className={rowClass}>
      {body}
    </Link>
  ) : (
    <div className={rowClass}>{body}</div>
  );
}

/** Биелсэн/биелээгүйг харуулах жижиг тэмдэг — дэд хугацааны мөрөнд. */
export function DoneMark({ done }: { done: boolean }) {
  return done ? (
    <CheckCircle2 className="h-4 w-4 text-success" />
  ) : (
    <Circle className="h-4 w-4 text-muted-foreground/50" />
  );
}

export default DeadlineRow;
