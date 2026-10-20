/**
 * 02 — Явц.  Мэргэжлийн баг → блок → зураг → ажил гэсэн мод.
 *
 * Баг сонголт ЗААВАЛ (өмнөх порталын зан төлөв): «Бүгд» гэсэн сонголт
 * байхгүй — өөр өөр багийн блокууд холилдвол захиалагч аль нь хэнийх болохыг
 * ялгахгүй.  Төслийн блокууд багаар тэмдэглэгдээгүй бол шүүлтгүйгээр бүгд.
 *
 * Сонголтын «засвар» (устсан баг/блок) нь effect-ээр БИШ рендерийн үед
 * гаргаж авна — `react-hooks/set-state-in-effect`.
 */
import { useState } from 'react';

import { Button } from '@/ui/button';
import { useLanguage } from '@/shared/i18n';
import { teamHex } from '@/shared/lib/team-colors';
import { cn } from '@/shared/lib/utils';

import type { BlockRow, DisciplineRow, OverviewResponse } from '../client-dashboard.types';
import {
  ErrorState,
  Eyebrow,
  ProgressLine,
  SectionHeader,
  SkeletonBar,
  SubHeader,
} from '../components/primitives';
import { pctInt, pctOne } from '../lib/clientFormat';
import { disciplineName, countLabel } from '../lib/labels';
import { DrawingRegister } from './DrawingRegister';

export function ProgressTab({
  overview,
  loading,
  error,
  retrying,
  onRetry,
}: {
  overview: OverviewResponse | null;
  loading: boolean;
  error: string | null;
  retrying: boolean;
  onRetry: () => void;
}) {
  const { t } = useLanguage();

  return (
    <div className="flex flex-col gap-14 pt-10 md:gap-20 md:pt-14">
      <SectionHeader
        index="02"
        eyebrow={t('clientRoom.nav.progress')}
        title={t('clientRoom.progressTab.title')}
        description={t('clientRoom.progressTab.description')}
        aside={
          overview ? (
            <div className="text-right">
              <p className="font-mono text-label uppercase tracking-[0.14em] text-muted-foreground">
                {t('clientRoom.progress.overall')}
              </p>
              <p className="mt-1 font-display text-5xl font-light tabular-nums tracking-[-0.04em] text-foreground">
                {pctOne(overview.overall_progress)}
                <span className="text-xl text-muted-foreground">%</span>
              </p>
            </div>
          ) : null
        }
      />
      {loading ? (
        <div className="grid gap-4">
          <SkeletonBar className="h-10 w-2/3" />
          <SkeletonBar className="h-48" />
        </div>
      ) : overview ? (
        <ProgressBody overview={overview} />
      ) : (
        <ErrorState message={error} onRetry={onRetry} retrying={retrying} />
      )}
    </div>
  );
}

function ProgressBody({ overview }: { overview: OverviewResponse }) {
  const { t } = useLanguage();
  const blocks = overview.blocks;
  const teams = overview.block_teams ?? [];
  const [pickedTeam, setPickedTeam] = useState<number | null>(null);
  const [pickedBlock, setPickedBlock] = useState<number | null>(null);

  // Сонголтыг өгөгдөлтэй ТААРУУЛЖ гаргана (refetch-ийн дараа ч хүчинтэй).
  const teamId =
    teams.length === 0
      ? null
      : teams.some((x) => x.team_id === pickedTeam)
        ? pickedTeam
        : (teams[0]?.team_id ?? null);
  const visible = teams.length === 0 ? blocks : blocks.filter((b) => b.team_id === teamId);
  const selected = visible.find((b) => b.id === pickedBlock) ?? visible[0] ?? null;

  if (blocks.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('clientRoom.progressTab.noBlocks')}</p>;
  }

  return (
    <div className="flex flex-col gap-14">
      {teams.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-12 md:gap-8">
          <div className="md:col-span-3">
            <Eyebrow>{t('clientRoom.progressTab.discipline')}</Eyebrow>
          </div>
          <div
            role="group"
            aria-label={t('clientRoom.progressTab.discipline')}
            className="flex flex-wrap gap-2 md:col-span-9"
          >
            {teams.map((team) => {
              const active = team.team_id === teamId;
              return (
                <Button
                  key={team.team_id}
                  variant="outline"
                  size="sm"
                  aria-pressed={active}
                  onClick={() => {
                    setPickedTeam(team.team_id);
                    setPickedBlock(null);
                  }}
                  className={cn(
                    'h-10 gap-2.5 rounded-none px-4 font-normal',
                    active
                      ? 'border-foreground bg-foreground text-background hover:bg-foreground/90 hover:text-background'
                      : 'border-foreground/20 bg-transparent hover:border-foreground/50 hover:bg-transparent',
                  )}
                >
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0"
                    style={{ backgroundColor: teamHex(team.code) }}
                  />
                  <span className="font-mono text-micro">{team.code}</span>
                  <span className="text-body">{disciplineName(t, team.code, team.name_mn)}</span>
                  <span
                    className={cn(
                      'font-mono text-micro tabular-nums',
                      active ? 'text-background/70' : 'text-muted-foreground',
                    )}
                  >
                    {team.block_count}
                  </span>
                </Button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div>
        <SubHeader
          title={t('clientRoom.progressTab.blocks')}
          meta={countLabel(t, 'clientRoom.progressTab.blocksCount', visible.length)}
        />
        <div className="mt-6 grid grid-cols-2 border-l border-t border-foreground/10 lg:grid-cols-3 2xl:grid-cols-4">
          {visible.map((b) => (
            <BlockTile
              key={b.id}
              block={b}
              active={selected?.id === b.id}
              onSelect={() => setPickedBlock(b.id)}
            />
          ))}
        </div>
      </div>

      {selected ? (
        <BlockDetail key={selected.id} block={selected} disciplines={overview.disciplines} />
      ) : null}
    </div>
  );
}

function BlockTile({
  block,
  active,
  onSelect,
}: {
  block: BlockRow;
  active: boolean;
  onSelect: () => void;
}) {
  const { t } = useLanguage();
  return (
    <Button
      variant="ghost"
      aria-pressed={active}
      onClick={onSelect}
      data-testid="client-block-tile"
      className={cn(
        'group flex h-auto pointer-coarse:h-auto min-w-0 flex-col items-stretch gap-5 whitespace-normal rounded-none border-b border-r border-foreground/10 p-4 text-left font-normal sm:gap-6 sm:p-5 md:p-6',
        active
          ? 'bg-foreground text-background hover:bg-foreground hover:text-background'
          : 'hover:bg-foreground/[0.03]',
      )}
    >
      <span className="line-clamp-2 min-h-[2.5rem] text-sm leading-snug" title={block.name}>
        {block.name}
      </span>
      <span className="font-display text-4xl font-light leading-none tabular-nums tracking-[-0.04em] sm:text-5xl">
        {pctInt(block.progress)}
        <span className={cn('text-lg', active ? 'text-background/60' : 'text-muted-foreground')}>%</span>
      </span>
      <span className="flex flex-col gap-3">
        <ProgressLine value={block.progress} tone={active ? 'inverse' : 'ink'} />
        <span
          className={cn(
            'flex flex-wrap justify-between gap-x-3 gap-y-1 font-mono text-micro tabular-nums',
            active ? 'text-background/70' : 'text-muted-foreground',
          )}
        >
          <span>{countLabel(t, 'clientRoom.progressTab.drawingsCount', block.drawing_count)}</span>
          <span>{t('clientRoom.progressTab.weight', { value: block.weight_percent.toFixed(1) })}</span>
        </span>
      </span>
    </Button>
  );
}

function BlockDetail({ block, disciplines }: { block: BlockRow; disciplines: DisciplineRow[] }) {
  const { t } = useLanguage();
  const perDiscipline = block.block_disciplines ?? [];
  const labelOf = new Map(disciplines.map((d) => [d.code, d.label_mn]));

  return (
    <section aria-labelledby="client-block-title" className="flex flex-col gap-12">
      <div className="grid gap-6 border-t border-foreground pt-6 md:grid-cols-12 md:gap-8">
        <div className="md:col-span-3">
          <Eyebrow>{t('clientRoom.progressTab.selectedBlock')}</Eyebrow>
        </div>
        <div className="flex flex-col gap-6 md:col-span-9 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h3
              id="client-block-title"
              className="break-words font-display text-3xl font-light leading-tight tracking-[-0.025em] text-foreground md:text-4xl"
            >
              {block.name}
            </h3>
            <p className="mt-3 font-mono text-micro tabular-nums text-muted-foreground">
              {countLabel(t, 'clientRoom.progressTab.drawingsCount', block.drawing_count)} ·{' '}
              {countLabel(t, 'clientRoom.progressTab.tasksCount', block.task_count)} ·{' '}
              {t('clientRoom.progressTab.weight', { value: block.weight_percent.toFixed(1) })}
            </p>
          </div>
          <p className="font-display text-6xl font-light leading-none tabular-nums tracking-[-0.05em] text-foreground">
            {pctInt(block.progress)}
            <span className="text-2xl text-muted-foreground">%</span>
          </p>
        </div>
      </div>

      {perDiscipline.length > 1 ? (
        <div>
          <SubHeader title={t('clientRoom.progressTab.byDiscipline')} />
          <ul className="divide-y divide-foreground/10">
            {perDiscipline.map((d) => (
              <li
                key={d.code}
                className="grid grid-cols-[4.25rem_minmax(0,1fr)_3.5rem] items-center gap-4 py-3 md:grid-cols-[4.25rem_minmax(0,14rem)_minmax(0,1fr)_7rem_3.5rem]"
              >
                <span className="flex items-center gap-2 font-mono text-micro text-foreground">
                  <span aria-hidden className="h-2 w-2" style={{ backgroundColor: teamHex(d.code) }} />
                  {d.code}
                </span>
                <span className="min-w-0 truncate text-body text-foreground">
                  {disciplineName(t, d.code, labelOf.get(d.code))}
                </span>
                <ProgressLine
                  value={d.progress}
                  color={teamHex(d.code)}
                  className="col-span-3 row-start-2 md:col-span-1 md:row-start-auto"
                />
                <span className="hidden text-right font-mono text-micro tabular-nums text-muted-foreground md:block">
                  {countLabel(t, 'clientRoom.progressTab.drawingsCount', d.drawing_count)}
                </span>
                <span className="text-right font-mono text-micro tabular-nums text-foreground">
                  {pctInt(d.progress)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <DrawingRegister drawings={block.drawings ?? []} />
    </section>
  );
}
