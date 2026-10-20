import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { Wrench } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { MUTED_OPACITY, type RosterGroup, type RosterProjectLabel } from '../lib/donut';
import { NowBadge, RepairTag } from './AllocationBits';
import { CurrentWorkLines } from './CurrentWorkLines';

/** «A, B🔧, C» — засварын (дотоод) төслийн ард жижиг түлхүүрийн дүрс. */
function ProjectLabels({ items }: { items: RosterProjectLabel[] }) {
  const { t } = useLanguage();
  return (
    <>
      {items.map((x, i) => (
        <Fragment key={`${x.label}-${i}`}>
          {i > 0 && ', '}
          {x.label}
          {x.repair && (
            <span
              role="img"
              aria-label={t('teams.repairTag')}
              title={t('teams.repairTagHint')}
              className="ml-0.5 inline-flex -translate-y-px align-middle text-warning"
            >
              <Wrench className="h-2.5 w-2.5" aria-hidden />
            </span>
          )}
        </Fragment>
      ))}
    </>
  );
}

/**
 * Нэрсийн жагсаалт — бүлэг бүр (баг/төсөл) толгойтой, хүн бүр ТОД нэр
 * («Тэлмэн .Б», бүтэн нэр `title`-д) + ДООР нь жижгээр: үндсэн төсөл
 * (өнгөт цэгтэй) · бусад төслүүд · ажлын тоо (2026-09-16, эзний хүсэлт).
 *
 * ХОЁР газар нэг хэлбэрээр: донатын hover самбар (`DonutChart`) ба багийн
 * баруун талын sheet (`TeamSheet`).  `sliceLabel` = ганц бүлэг нь
 * эзэнтэйгээ ижил нэртэй бол толгойг давтахгүй.
 */
export function RosterList({
  groups,
  sliceLabel,
  className,
}: {
  groups: RosterGroup[];
  sliceLabel?: string;
  className?: string;
}) {
  const { t } = useLanguage();
  if (groups.length === 0) {
    return (
      <p className="py-2 text-center text-xs italic text-muted-foreground">{t('teams.rosterEmpty')}</p>
    );
  }
  return (
    <div className={cn('space-y-2.5', className)}>
      {groups.map((g) => (
        <section key={String(g.key)}>
          {!g.hideHeader && !(groups.length === 1 && g.label === sliceLabel) && (
            <div className="flex items-center gap-1.5 text-xs">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: g.color, opacity: g.muted ? MUTED_OPACITY : 1 }}
              />
              {g.code && <span className="font-mono text-[10px] font-semibold">{g.code}</span>}
              <span className="min-w-0 flex-1 truncate font-medium">{g.label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{g.people.length}</span>
            </div>
          )}
          {/* Тайлбар тасрахгүй — мөр шилжинэ, «аль аль төсөл» гэдгийг бүтнээр харна. */}
          <ul className={cn('space-y-1.5', !g.hideHeader && 'mt-1')}>
            {g.people.map((p) => (
              <li
                key={p.user_id}
                className="min-w-0 leading-tight"
                title={p.note ? `${p.full_name} — ${p.note}` : p.full_name}
              >
                <Link
                  to={`/app/users/${p.user_id}`}
                  className={cn(
                    'block min-w-0 truncate text-[13px] font-semibold hover:text-primary hover:underline',
                    (p.elsewhere || p.muted) && 'font-medium text-muted-foreground',
                  )}
                >
                  {p.display_name}
                </Link>
                {p.primary || p.others || p.earlier ? (
                  <div className="text-[10px] leading-snug text-muted-foreground">
                    {p.primary && (
                      <span className="inline-flex max-w-full items-baseline gap-1">
                        <span
                          className="inline-block h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full"
                          style={{ backgroundColor: p.primary.color }}
                        />
                        <span className="font-medium text-foreground/80">{p.primary.label}</span>
                        {p.primary.repair && <RepairTag className="self-center" />}
                        {/* Ижил засварын төсөл дээр өнөөдөр бүртгэсэн цаг — тусдаа
                            мөр болж давхардахгүй (`mergePickedRepairHours`). */}
                        {p.primary.duration && (
                          <span className="tabular-nums" data-testid="roster-pick-duration">
                            {p.primary.duration}
                          </span>
                        )}
                        {p.days && (
                          <span className="tabular-nums text-muted-subtle">{p.days}</span>
                        )}
                        {/* Ирцийн хэмжүүр: ОДОО энэ төсөл дээр / ирцээ хаасан.
                            Төслийн бус ажил одоо үргэлжилж байвал `now` = false
                            (`lib/currentWork.ts showPickNow`). */}
                        {p.now && <NowBadge />}
                        {p.left && (
                          <span className="rounded-sm bg-muted px-1 text-[9px] uppercase tracking-wide text-muted-foreground">
                            {t('teams.rosterLeft')}
                          </span>
                        )}
                      </span>
                    )}
                    {p.others && (
                      <span className="text-muted-subtle">
                        {p.primary ? ', ' : ''}
                        <ProjectLabels items={p.others} />
                      </span>
                    )}
                    {p.earlier && (
                      <span className="text-muted-subtle">
                        {p.primary || p.others ? ' · ' : ''}
                        {t('teams.rosterEarlierOnPrefix')} <ProjectLabels items={p.earlier} />
                      </span>
                    )}
                  </div>
                ) : (
                  p.note && (
                    <div className="text-[10px] leading-snug text-muted-subtle">{p.note}</div>
                  )
                )}
                {/* Төслийн бус ажил + засварын цаг (сонгосон өдрийн). */}
                <CurrentWorkLines work={p.work} className="mt-0.5" />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
