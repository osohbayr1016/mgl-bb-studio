import { useMemo } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Copy,
  Scale,
  Layers3,
  FileText,
  Boxes,
  Target,
} from 'lucide-react';
import { Card, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';

/**
 * SetupCompletionHero — single-glance project readiness meter.
 *
 * Replaces the older RollupSummary tile-grid that asked the admin to read
 * five statistics and infer "is this project ready" themselves.  This
 * component computes a weighted readiness score from four signals
 * (weight balance, assignee coverage, date coverage, basic presence)
 * and renders one big number plus a checklist that explains it.  The
 * mismatch list is shown inline rather than tucked behind a popover so
 * fixing weights becomes a 1-click jump-to-section action.
 */

export interface CompletionInputs {
  /** Project root weight totals (drives the "weight balance" axis). */
  blockSum: number;
  blocksCount: number;
  drawingsCount: number;
  componentsCount: number;
  /** Total leaf tasks across the whole project. */
  tasksCount: number;
  /** Pre-formatted human strings, e.g. "А блок: зурагууд (90.0%)". */
  mismatches: string[];
}

export default function SetupCompletionHero({
  projectName,
  inputs,
  onAutoFixZero,
  onJumpToMismatch,
  onImportStructure,
}: {
  projectName: string;
  inputs: CompletionInputs;
  onAutoFixZero: () => void;
  /** Click on a mismatch row → admin wants to navigate to that block.
   *  We pass back the raw mismatch label and let the parent decide. */
  onJumpToMismatch?: (label: string) => void;
  /** «Бүтэц татах» — өөр төслөөс бүтцийг хуулах цонхыг нээнэ.
   *  ⚠️ ЗӨВХӨН нэг ч блок алга үед л ГОЛ үйлдэл болж гарна: хоосон төслийн
   *  дэлгэц дээр админд хийх зүйл ХОЁРХОН байдаг — гараар блок нэмэх, эсвэл
   *  өмнөх төслөөс татах.  Бүтэцтэй болсны дараа энэ товч нь харагдахаа
   *  болино (хуудасны толгойд байнга үлдэнэ), эс бөгөөс бэлэн ажлыг дарж
   *  бичих санал байнга нүдэнд өртөнө. */
  onImportStructure?: () => void;
}) {
  const { t } = useLanguage();
  const {
    blockSum,
    blocksCount,
    drawingsCount,
    componentsCount,
    tasksCount,
    mismatches,
  } = inputs;

  // Readiness math.  Each axis is 0..1; the weighted sum is shown as a
  // percentage.  ЗӨВХӨН бүтэц + жин: «Хариуцагч» тэнхлэг 2026-10-06-нд
  // хасагдсан — 0368/0369-өөс хойш байнгын хариуцагч байхгүй (таск дээрх
  // хүмүүс = ажилласан түүх), тиймээс тохиргооны үед хэзээ ч бөглөгдөхгүй
  // тэнхлэг шинэ төсөл бүрийг ~65%-д гацаадаг байв.  Блоггүй төсөлд жингийн
  // тэнхлэг 0 (өмнө нь 0.7 өгч хоосон төсөл ~50% харагддаг байв).
  const score = useMemo(() => {
    const weightAxis =
      blocksCount === 0
        ? 0
        : mismatches.length === 0 && Math.abs(blockSum - 100) < 0.5
          ? 1
          : mismatches.length === 0
            ? 0.7
            : Math.max(0, 1 - mismatches.length / Math.max(1, blocksCount + drawingsCount + 1));

    const presenceAxis = (blocksCount > 0 ? 0.5 : 0) + (tasksCount > 0 ? 0.5 : 0);

    const total = (weightAxis * 0.75 + presenceAxis * 0.25) * 100;

    return {
      total: Math.max(0, Math.min(100, total)),
      weightAxis: Math.round(weightAxis * 100),
      presenceAxis: Math.round(presenceAxis * 100),
    };
  }, [blockSum, blocksCount, drawingsCount, tasksCount, mismatches.length]);

  const ringClamp = score.total;
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (ringClamp / 100) * circumference;

  // Tone & label adapt to the score so admins can read severity at a glance.
  const tone =
    score.total >= 90
      ? { ring: 'stroke-emerald-500', text: 'text-emerald-500', label: t('setupCompletionHero.toneReady') }
      : score.total >= 60
        ? { ring: 'stroke-primary', text: 'text-primary', label: t('setupCompletionHero.toneAlmost') }
        : score.total >= 30
          ? { ring: 'stroke-amber-500', text: 'text-amber-500', label: t('setupCompletionHero.toneInProgress') }
          : { ring: 'stroke-destructive', text: 'text-destructive', label: t('setupCompletionHero.toneStart') };

  const zeroFixable = mismatches.filter((m) => /\(0\.0%\)/.test(m)).length;
  const showInlineMismatches = mismatches.length > 0;

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-card via-card to-primary/5 overflow-hidden">
      <CardContent className="pt-5 pb-5">
        <div className="flex flex-col md:flex-row gap-5 items-start">
          {/* Big ring */}
          <div className="flex items-center gap-4 md:min-w-[300px]">
            <div className="relative w-32 h-32 md:w-36 md:h-36 flex-shrink-0">
              <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
                <circle
                  cx="60"
                  cy="60"
                  r={radius}
                  strokeWidth="8"
                  fill="none"
                  className="stroke-muted"
                />
                <circle
                  cx="60"
                  cy="60"
                  r={radius}
                  strokeWidth="8"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={offset}
                  className={cn('transition-[stroke-dashoffset] duration-700', tone.ring)}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={cn('text-3xl md:text-4xl font-bold tabular-nums', tone.text)}>
                  {Math.round(score.total)}%
                </span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
                  {t('setupCompletionHero.readiness')}
                </span>
              </div>
            </div>

            <div className="min-w-0 space-y-1.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                {projectName || t('setupCompletionHero.project')}
              </div>
              <div className={cn('text-base md:text-lg font-semibold leading-tight', tone.text)}>
                {tone.label}
              </div>
              <div className="text-[11px] text-muted-foreground leading-relaxed flex items-center gap-1 flex-wrap">
                <span className="inline-flex items-center gap-1">
                  <Layers3 className="h-3 w-3" /> {t('setupCompletionHero.blocksCount', { count: blocksCount })}
                </span>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  <FileText className="h-3 w-3" /> {t('setupCompletionHero.drawingsCount', { count: drawingsCount })}
                </span>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  <Boxes className="h-3 w-3" /> {t('setupCompletionHero.componentsCount', { count: componentsCount })}
                </span>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  <Target className="h-3 w-3" /> {t('setupCompletionHero.tasksCount', { count: tasksCount })}
                </span>
              </div>
              {/* Хоосон төслийн ГОЛ үйлдэл — «Бүтэц татах». */}
              {onImportStructure && blocksCount === 0 && (
                <Button size="sm" className="mt-1 h-8 text-xs" onClick={onImportStructure}>
                  <Copy className="mr-1.5 h-3.5 w-3.5" />
                  {t('copyStructure.openButton')}
                </Button>
              )}
            </div>
          </div>

          {/* Axis breakdown — explains where the score comes from */}
          <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full">
            <AxisBar
              icon={<Scale className="h-3.5 w-3.5" />}
              label={t('setupCompletionHero.axisWeight')}
              pct={score.weightAxis}
              hint={
                blocksCount === 0
                  ? t('setupCompletionHero.noBlocks')
                  : mismatches.length === 0
                    ? t('setupCompletionHero.allLevels100')
                    : t('setupCompletionHero.mismatchCount', { count: mismatches.length })
              }
              ok={score.weightAxis === 100}
            />
            <AxisBar
              icon={<CheckCircle2 className="h-3.5 w-3.5" />}
              label={t('setupCompletionHero.axisStructure')}
              pct={score.presenceAxis}
              hint={
                blocksCount > 0 && tasksCount > 0
                  ? t('setupCompletionHero.complete')
                  : blocksCount === 0
                    ? t('setupCompletionHero.noBlocks')
                    : t('setupCompletionHero.noTasks')
              }
              ok={blocksCount > 0 && tasksCount > 0}
            />
          </div>
        </div>

        {/* Inline mismatches — the old "Хаана?" popover is replaced by an
            always-visible warning panel with one-click jump targets. */}
        {showInlineMismatches && (
          <div className="mt-4 pt-4 border-t border-border/60">
            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-500">
                <AlertTriangle className="h-3.5 w-3.5" />
                {t('setupCompletionHero.notReady100')}
                <Badge
                  variant="outline"
                  className="border-amber-500/40 bg-amber-500/10 text-amber-500 text-[10px] px-1.5"
                >
                  {mismatches.length}
                </Badge>
              </div>
              {zeroFixable > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px] border-amber-500/40 hover:bg-amber-500/10 text-amber-500"
                  onClick={onAutoFixZero}
                >
                  <Scale className="h-3 w-3 mr-1" />
                  {t('setupCompletionHero.splitEvenly', { count: zeroFixable })}
                </Button>
              )}
            </div>
            <div className="space-y-1 max-h-44 overflow-y-auto overflow-x-hidden">
              {mismatches.map((m, i) => {
                const isZero = /\(0\.0%\)/.test(m);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onJumpToMismatch?.(m)}
                    className={cn(
                      'group flex items-center gap-2 w-full text-left text-xs',
                      'rounded border-l-2 px-2 py-1 transition-colors',
                      isZero
                        ? 'border-amber-500/80 bg-amber-500/5 hover:bg-amber-500/10'
                        : 'border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10',
                    )}
                  >
                    <span className="flex-1 min-w-0 break-words text-muted-foreground group-hover:text-foreground">
                      {m}
                      {isZero && (
                        <span className="ml-1 text-[10px] text-amber-500/80">
                          {t('setupCompletionHero.autoFixable')}
                        </span>
                      )}
                    </span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground/50 group-hover:text-primary transition-colors flex-shrink-0" />
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AxisBar({
  icon,
  label,
  pct,
  hint,
  ok,
}: {
  icon: React.ReactNode;
  label: string;
  pct: number;
  hint: string;
  ok: boolean;
}) {
  const tone = ok
    ? 'bg-emerald-500'
    : pct >= 60
      ? 'bg-primary'
      : pct >= 30
        ? 'bg-amber-500'
        : 'bg-muted-foreground/40';
  return (
    <div className="rounded-lg border border-border/60 bg-card/50 p-2.5">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          <span className={ok ? 'text-emerald-500' : 'text-primary'}>{icon}</span>
          {label}
        </div>
        <span
          className={cn(
            'text-xs font-bold tabular-nums',
            ok ? 'text-emerald-500' : 'text-foreground',
          )}
        >
          {pct}%
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted/60 overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-[width] duration-500', tone)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-[10px] text-muted-foreground mt-1 truncate" title={hint}>
        {hint}
      </div>
    </div>
  );
}
