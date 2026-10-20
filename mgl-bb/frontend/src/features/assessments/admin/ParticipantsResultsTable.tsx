import { useMemo } from 'react';
import { Search, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useLanguage } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';
import { Badge } from '@/ui/badge';
import { DataTable, type DataTableColumn } from '@/ui/data-table';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';

import type { ParticipantResult } from '../api';
import { headlinePart } from '../lib/aggregate';
import { fmtPct } from '../lib/exportAssessmentXlsx';
import {
  ALL_TEAMS,
  NO_TEAM,
  matchesSubFilter,
  type SubFilter,
  type TeamOption,
} from '../lib/participantFilters';
import { LevelTag } from '../components/LevelTag';

interface Props {
  roundId: number;
  results: ParticipantResult[];
  teamCode: string;
  onTeamCodeChange: (v: string) => void;
  teamOptions: TeamOption[];
  search: string;
  onSearchChange: (v: string) => void;
  subFilter: SubFilter;
  onSubFilterChange: (v: SubFilter) => void;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

export function ParticipantsResultsTable({
  roundId,
  results,
  teamCode,
  onTeamCodeChange,
  teamOptions,
  search,
  onSearchChange,
  subFilter,
  onSubFilterChange,
  isLoading,
  error,
  onRetry,
}: Props) {
  const { t } = useLanguage();
  const navigate = useNavigate();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return results.filter((r) => {
      if (teamCode !== ALL_TEAMS && (r.team_code ?? NO_TEAM) !== teamCode) return false;
      if (!matchesSubFilter(r, subFilter)) return false;
      if (!q) return true;
      return `${r.full_name} ${r.employee_id ?? ''} ${r.position ?? ''}`.toLowerCase().includes(q);
    });
  }, [results, teamCode, search, subFilter]);

  const columns: DataTableColumn<ParticipantResult>[] = useMemo(
    () => [
      {
        id: 'name',
        header: t('assessments.colName'),
        cell: (r) => (
          <span className="font-medium text-foreground">{formatDisplayName(r.full_name)}</span>
        ),
        sortValue: (r) => formatDisplayName(r.full_name),
      },
      {
        id: 'team',
        header: t('assessments.colTeam'),
        cell: (r) => <span className="text-muted-foreground">{r.team_code ?? '—'}</span>,
        sortValue: (r) => r.team_code,
      },
      {
        id: 'overall',
        header: t('assessments.colOverallPct'),
        numeric: true,
        cell: (r) => (
          <span className="tabular-nums">{fmtPct(headlinePart(r)?.overall_pct ?? null)}</span>
        ),
        sortValue: (r) => headlinePart(r)?.overall_pct ?? null,
      },
      {
        id: 'level',
        header: t('assessments.colLevel'),
        cell: (r) => <LevelTag level={headlinePart(r)?.overall_level ?? null} />,
        sortValue: (r) => headlinePart(r)?.overall_level?.minPct ?? null,
      },
      {
        id: 'self',
        header: t('assessments.colSelfSubmitted'),
        cell: (r) => (
          <Badge variant={r.self_submitted ? 'default' : 'outline'}>
            {r.self_submitted ? t('assessments.yes') : t('assessments.no')}
          </Badge>
        ),
        sortValue: (r) => (r.self_submitted ? 1 : 0),
      },
      {
        id: 'senior',
        header: t('assessments.colSeniorSubmitted'),
        cell: (r) =>
          r.senior_total_count > 1 ? (
            <Badge variant={r.senior_submitted ? 'default' : 'outline'}>
              {r.senior_submitted_count}/{r.senior_total_count}
            </Badge>
          ) : (
            <Badge variant={r.senior_submitted ? 'default' : 'outline'}>
              {r.senior_submitted ? t('assessments.yes') : t('assessments.no')}
            </Badge>
          ),
        sortValue: (r) => r.senior_submitted_count,
      },
      {
        id: 'evaluator',
        header: t('assessments.colEvaluator'),
        hideOnMobile: true,
        cell: (r) => {
          const names = r.senior_evaluators
            .map((e) => (e.full_name ? formatDisplayName(e.full_name) : null))
            .filter((n): n is string => !!n);
          return <span className="text-muted-foreground">{names.length ? names.join(', ') : '—'}</span>;
        },
        sortValue: (r) => {
          const names = r.senior_evaluators
            .map((e) => (e.full_name ? formatDisplayName(e.full_name) : null))
            .filter((n): n is string => !!n);
          return names.length ? names.join(', ') : null;
        },
      },
    ],
    [t],
  );

  const openParticipant = (userId: number) => {
    navigate(`/app/admin/assessments/${roundId}/${userId}${window.location.search}`);
  };

  return (
    <DataTable
      columns={columns}
      rows={isLoading ? undefined : filtered}
      rowKey={(r) => r.user_id}
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      emptyTitle={filtered.length === 0 && results.length > 0 ? t('assessments.noMatches') : t('assessments.noParticipants')}
      emptyDescription={filtered.length === 0 && results.length > 0 ? t('assessments.noMatchesHint') : undefined}
      defaultSort={{ id: 'overall', dir: 'desc' }}
      onRowClick={(r) => openParticipant(r.user_id)}
      className="p-3 md:p-0"
      toolbar={
        <div className="mb-3 flex flex-wrap items-end gap-3 border-b border-border px-1 pb-3 md:mb-0 md:px-4 md:py-3">
          <div className="flex items-center gap-1.5 text-body font-medium text-foreground">
            <Users className="h-4 w-4 text-primary" aria-hidden />
            {t('assessments.participantsTitle')}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="assessment-team">{t('assessments.filterTeam')}</Label>
            <Select value={teamCode} onValueChange={onTeamCodeChange}>
              <SelectTrigger id="assessment-team" className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_TEAMS}>{t('assessments.allTeams')}</SelectItem>
                {teamOptions.map((option) => (
                  <SelectItem key={option.code} value={option.code}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="assessment-search">{t('assessments.filterSearch')}</Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="assessment-search"
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={t('assessments.filterSearchPlaceholder')}
                className="w-[200px] pl-8"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="assessment-sub">{t('assessments.subFilterLabel')}</Label>
            <Select value={subFilter} onValueChange={(v) => onSubFilterChange(v as SubFilter)}>
              <SelectTrigger id="assessment-sub" className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('assessments.subFilterAll')}</SelectItem>
                <SelectItem value="complete">{t('assessments.subFilterComplete')}</SelectItem>
                <SelectItem value="missingSelf">{t('assessments.subFilterMissingSelf')}</SelectItem>
                <SelectItem value="missingSenior">{t('assessments.subFilterMissingSenior')}</SelectItem>
                <SelectItem value="none">{t('assessments.subFilterNone')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {!isLoading && (
            <span className="pb-2 text-micro text-muted-foreground">
              {t('assessments.participantsFiltered', {
                shown: filtered.length,
                total: results.length,
              })}
            </span>
          )}
        </div>
      }
    />
  );
}

export default ParticipantsResultsTable;
