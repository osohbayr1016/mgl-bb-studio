/** One team pill on the tab strip: selects the tab, edits the team's share %
 *  inline, and removes the team when it owns no blocks.
 *
 *  Extracted verbatim from `AdminProjectSetupPage.tsx` — no behavioural
 *  change. */
import { X } from 'lucide-react';

import type { ProjectTeamShare } from '@/shared/types';
import { Badge } from '@/ui/badge';
import { Input } from '@/ui/input';
import { cn } from '@/shared/lib/utils';
import { teamTone } from '@/shared/lib/team-colors';

import type { SetupApi } from './useProjectSetup';

export function TeamSharePill({
  ts,
  active,
  blockCount,
  onSelect,
  onShareChange,
  onRemove,
  t,
}: {
  ts: ProjectTeamShare;
  active: boolean;
  blockCount: number;
  onSelect: () => void;
  onShareChange: (value: number) => void;
  onRemove: () => void;
  t: SetupApi['t'];
}) {
  const tone = teamTone(ts.team_code);
  // Unsaved shares (id === 0) can always be undone — see removeTeamShare's
  // comment.
  const removable = blockCount === 0 || ts.id === 0;
  return (
    <div
      className={cn(
        'flex items-center gap-1 rounded-md border pl-1.5 pr-1 py-1 text-xs transition-colors',
        active ? cn(tone.border, 'border-l-4 bg-card shadow-sm') : 'border-border/40 hover:bg-muted/40',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'flex items-center gap-1 cursor-pointer',
          active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
        title={ts.team_name_mn ?? undefined}
      >
        <Badge variant="outline" className={cn('text-micro font-mono font-bold px-1.5', tone.chip)}>
          {ts.team_code ?? '?'}
        </Badge>
        <span className="text-micro tabular-nums opacity-60">({blockCount})</span>
      </button>
      <div className="relative w-[54px] flex-shrink-0">
        <Input
          type="number"
          min={0}
          max={100}
          step="0.01"
          value={ts.share_percent ?? 0}
          onChange={(e) => onShareChange(e.target.value === '' ? 0 : Number(e.target.value))}
          className="h-6 pr-4 text-micro tabular-nums px-1.5"
          aria-label={t('adminProjectSetupPage.teamShareAria', { code: ts.team_code ?? '' })}
        />
        <span className="absolute right-1 top-1/2 -translate-y-1/2 text-micro text-muted-foreground pointer-events-none">
          %
        </span>
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={!removable}
        className={cn(
          'h-5 w-5 rounded flex items-center justify-center flex-shrink-0 transition-colors',
          removable
            ? 'text-muted-foreground hover:text-destructive hover:bg-destructive/10'
            : 'text-muted-subtle cursor-not-allowed',
        )}
        title={
          removable
            ? t('adminProjectSetupPage.removeTeam')
            : t('adminProjectSetupPage.teamHasBlocksRemoveFirst', { count: blockCount })
        }
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

export default TeamSharePill;
