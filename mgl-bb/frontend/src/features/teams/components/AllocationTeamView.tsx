import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { Badge } from '@/ui/badge';
import { cn } from '@/shared/lib/utils';
import { teamChipClass, teamHex } from '@/shared/lib/team-colors';
import { useLanguage, pickLocalized } from '@/shared/i18n';
import { DonutChart, SplitBar, type DonutSlice } from './DonutChart';
import { IDLE_COLOR } from '../lib/donut';
import { PeopleStack } from './AllocationBits';
import type { AllocationModel } from '../lib/allocation';
import {
  isSpanAverage,
  buildPrimaryProjectMap,
  buildProjectPalette,
  isWorkforceTeam,
  openTasksPerPerson,
  projectHref,
  shortProjectLabel,
  splitTeamByPrimary,
} from '../lib/allocation';
import { OTHERS_COLOR, PROJECT_PALETTE } from '../lib/projectColors';
import { cellPeople, teamIdlePeople } from '../lib/roster';
import { useRosterContext } from '../lib/useRoster';

/**
 * «Багаар» — баг тус бүр НЭГ карт, карт бүр НЭГ донат (2026-09-14).
 *
 * Донат = энэ багийн ГИШҮҮД, хүн бүр ЯГ НЭГ зүсэмд: үндсэн төслөөрөө
 * (төслийн өнгө), төсөлгүй бол саарал.  Голд нь гишүүдийн тоо — зүсмүүдийн
 * нийлбэртэй ҮРГЭЛЖ тэнцүү.  (Өмнө нь хүн × төсөл тоолдог байсан тул 18
 * хүнтэй багийн зүсмүүд 32 болж, «Бусад» хөөрч, эзэн «алдаатай» гэж үзсэн.)
 * Хэд хэдэн төсөл дээр зэрэг байгаа хүнийг тоогоор нь доор тайлбарлана.
 * Доор нь: гишүүн/төсөлтэй тууз, нэг хүнд ногдох дуусаагүй ажил, төсөлгүй
 * хүмүүсийн аватар.
 *
 * Төслийн өнгө нь Тойм табтай ИЖИЛ (`buildProjectPalette`) — нэг төсөл хаа
 * сайгүй нэг өнгө.  Менежментийн баг (`MGMT`) картгүй — эзний шийдвэр
 * (2026-09-16): «менежментийг бүх донатаас хас».  Хэмжүүр нь үргэлж ИРЦ
 * (2026-09-24-нөөс сэлгүүргүй).
 */
export function AllocationTeamView({ model }: { model: AllocationModel }) {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  // Мужаар: зүсэм бүр өдрийн ДУНДАЖ хүн (`lib/allocation.ts`-ийн тайлбар).
  const spanAvg = isSpanAverage(model);

  const colorOfProject = useMemo(
    () => buildProjectPalette(model, PROJECT_PALETTE, OTHERS_COLOR),
    [model],
  );

  const primary = useMemo(() => buildPrimaryProjectMap(model), [model]);
  const roster = useRosterContext(model, primary, colorOfProject);

  const rows = useMemo(
    () =>
      model.byTeam
        .filter((row) => isWorkforceTeam(row.entity.code))
        .filter((row) => row.entity.member_count > 0 || row.people > 0)
        .sort((a, b) => b.people - a.people || a.entity.sort_order - b.entity.sort_order),
    [model.byTeam],
  );

  if (rows.length === 0) {
    return (
      <p className="py-16 text-center text-sm italic text-muted-foreground">
        {t('teams.emptyMatrix')}
      </p>
    );
  }

  return (
    <div className="grid h-full min-h-0 auto-rows-min grid-cols-1 gap-3 overflow-y-auto p-3 sm:grid-cols-2 sm:p-4 xl:grid-cols-3 2xl:grid-cols-4">
      {rows.map((row) => {
        const hex = teamHex(row.entity.code);
        const split = splitTeamByPrimary(row, primary, model.spanDays);
        const memberCount = Math.max(row.entity.member_count, split.assigned);
        const slices: DonutSlice[] = row.cells
          .filter((cell) => (split.byProject.get(cell.project_id) ?? 0) > 0)
          .map((cell) => {
            const project = model.byProject.find((p) => p.entity.id === cell.project_id)?.entity;
            const inCell = cell.active;
            const primaryHere = split.byProject.get(cell.project_id) ?? 0;
            const personDays = cell.active_members.reduce((s, m) => s + m.days, 0);
            const label = project ? shortProjectLabel(project.name) : String(cell.project_id);
            return {
              key: cell.project_id,
              label,
              value: primaryHere,
              color: colorOfProject(cell.project_id),
              href: projectHref(project),
              // Hover: энэ багаас энэ төсөл дээр байгаа БҮХ хүн (үндсэн нь
              // өөр байсан ч — бүдэг, «үндсэн: X» тайлбартай).
              roster: [
                {
                  key: cell.project_id,
                  label,
                  color: colorOfProject(cell.project_id),
                  people: cellPeople(roster, cell),
                },
              ],
              hint: [
                spanAvg
                  ? `${t('teams.avgPersonCount', { count: inCell })} · ${t('teams.personDays', { count: personDays })}`
                  : inCell > primaryHere
                    ? t('teams.primaryHintCell', { total: inCell })
                    : null,
                cell.tasks > 0
                  ? `${t('teams.taskCount', { count: cell.tasks })} · ${cell.avg_progress}%`
                  : null,
              ]
                .filter(Boolean)
                .join(' · '),
            };
          })
          .sort((a, b) => b.value - a.value);
        // Дундаж горимд бутархай — 1 орноор.
        const idleCount = Math.round((memberCount - split.assigned) * 10) / 10;
        if (idleCount > 0) {
          slices.push({
            key: '__idle',
            label: t('teams.legendIdle'),
            value: idleCount,
            color: IDLE_COLOR,
            muted: true,
            roster: [
              {
                key: '__idle',
                label: roster.labels.idle,
                color: IDLE_COLOR,
                muted: true,
                people: teamIdlePeople(roster, row),
              },
            ],
          });
        }
        const load = openTasksPerPerson(row);
        const idle = row.entity.idle_members;

        const openProfile = () => navigate(`/app/teams/${row.entity.id}`);
        return (
          <section
            key={row.entity.id}
            id={`sec-team-${row.entity.code.toLowerCase()}`}
            data-testid="team-alloc-card"
            data-team-id={row.entity.id}
            title={t('teams.viewTeamPage')}
            onClick={(e) => {
              // Хүний аватар, нэрийн холбоос өөрийн замаараа явна.
              if ((e.target as HTMLElement).closest('a')) return;
              openProfile();
            }}
            className="flex min-w-0 cursor-pointer scroll-mt-24 flex-col rounded-xl border border-border bg-card p-3 outline-none transition-shadow hover:shadow-md focus-within:ring-2 focus-within:ring-primary/30"
            style={{ borderTopWidth: 3, borderTopColor: hex }}
          >
            <header className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={cn('px-1.5 py-0 font-mono text-[10px]', teamChipClass(row.entity.code))}
              >
                {row.entity.code}
              </Badge>
              {/* Багийн нэр дээр дарахад багийн профайл (2026-09-24, эзний хүсэлт). */}
              <Link
                to={`/app/teams/${row.entity.id}`}
                className="min-w-0 flex-1 truncate text-sm font-medium transition-colors hover:text-primary hover:underline"
                title={t('teams.viewTeamPage')}
              >
                {pickLocalized(lang, row.entity.name_mn, row.entity.name_en)}
              </Link>
              <Link
                to={`/app/teams/${row.entity.id}`}
                className="shrink-0 text-muted-foreground transition-colors hover:text-primary"
                title={t('teams.viewTeamPage')}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </header>

            <DonutChart
              className="mt-3"
              slices={slices}
              size={120}
              center={{ value: memberCount, label: t('teams.detailMembers') }}
              legendMax={20}
              emptyLabel={t('teams.teamNoTasks')}
              onSelect={openProfile}
            />
            {spanAvg ? (
              <p className="mt-1.5 text-[10px] leading-snug text-muted-subtle">
                {t('teams.spanAvgNote', { days: model.activeDays })}
              </p>
            ) : (
              split.multi > 0 && (
                <p className="mt-1.5 text-[10px] leading-snug text-muted-subtle">
                  {t('teams.primaryNote', { multi: split.multi })}
                </p>
              )
            )}

            <div className="mt-3 space-y-1.5 border-t border-border/60 pt-2.5">
              <SplitBar
                value={split.assigned}
                total={memberCount}
                color={hex}
                caption={t('teams.legendAssigned').toLowerCase()}
              />
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{t('teams.projectCount', { count: row.partners })}</span>
                <span title={t('teams.loadPerPersonHint')}>
                  {load == null ? (
                    '—'
                  ) : (
                    <>
                      <span className="font-semibold tabular-nums text-foreground">{load}</span>{' '}
                      {t('teams.loadPerPerson')}
                    </>
                  )}
                </span>
              </div>
              {idle.length > 0 && (
                <div className="flex items-center gap-2 pt-1">
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {t('teams.idleTitle')} · {idle.length}
                  </span>
                  <PeopleStack people={idle} size="xs" limit={8} />
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
