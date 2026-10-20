import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Pencil, Send } from 'lucide-react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';
import type { PeriodKind, ProductivityGap, ProductivityMember } from './types';
import { fmtAvg, fmtPct } from './lib';

/**
 * Эзний дүрэм: багийн хамгийн дээд ба хамгийн доод хүний өдрийн дундаж
 * бүтээмжийн зөрүү босгоос (анхдагч 20%) их байж болохгүй.  Зөрүү =
 * (дээд − доод) ÷ дээд; «шугам» = дээд хүний (100 − босго)%.  Хэтэрвэл улаан —
 * захирал «Ахлахад анхааруулах» товчоор ахлах руу мэдэгдэл илгээнэ.
 */
export function GapCard({
  gap,
  members,
  kind,
  canWarn,
  belowCount,
  onWarn,
  onSaveThreshold,
}: {
  gap: ProductivityGap;
  members: ProductivityMember[];
  kind: PeriodKind;
  canWarn: boolean;
  belowCount: number;
  onWarn: () => void;
  onSaveThreshold: (v: number) => Promise<void>;
}) {
  const { t } = useLanguage();
  const top = members.find((m) => m.user_id === gap.top_user_id) ?? null;
  const bottom = members.find((m) => m.user_id === gap.bottom_user_id) ?? null;
  const enough = gap.compared >= 2 && gap.gap_pct != null;
  const status: 'bad' | 'ok' | 'na' = !enough ? 'na' : gap.exceeded ? 'bad' : 'ok';
  const linePct = 100 - gap.threshold_pct;
  const bottomPos = enough && gap.top_avg ? Math.max(0, Math.min(100, ((gap.bottom_avg ?? 0) / gap.top_avg) * 100)) : 0;

  return (
    <section
      id="sec-team-gap"
      data-testid="tp-gap-card"
      data-status={status}
      className={cn(
        'scroll-mt-24 rounded-xl border p-4',
        status === 'bad' && 'border-danger/40 bg-danger/5',
        status === 'ok' && 'border-success/40 bg-success/5',
        status === 'na' && 'border-border/60 bg-card',
      )}
    >
      <div className="flex flex-wrap items-start gap-3">
        {/* min-w: нарийн дэлгэцэнд товчнууд доош унана — гарчиг нэг үгээр тасрахгүй. */}
        <div className="min-w-56 flex-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            {status === 'bad' && <AlertTriangle className="h-4 w-4 text-danger" />}
            {status === 'ok' && <CheckCircle2 className="h-4 w-4 text-success" />}
            {status === 'na' && <Info className="h-4 w-4 text-muted-foreground" />}
            {t('teamProductivity.gapTitle')}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('teamProductivity.gapRule', { threshold: fmtPct(gap.threshold_pct) })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canWarn && <ThresholdEditor value={gap.threshold_pct} onSave={onSaveThreshold} />}
          {canWarn && enough && (
            <Button
              size="sm"
              variant={status === 'bad' ? 'default' : 'outline'}
              className={cn('gap-1.5', status === 'bad' && 'bg-danger text-danger-foreground hover:bg-danger/90')}
              onClick={onWarn}
              data-testid="tp-warn-open"
            >
              <Send className="h-3.5 w-3.5" />
              {t('teamProductivity.warnLead')}
            </Button>
          )}
        </div>
      </div>

      {!enough ? (
        <p className="mt-3 text-sm text-muted-foreground">{t('teamProductivity.gapNotEnough')}</p>
      ) : (
        <div className="mt-3 grid gap-4 md:grid-cols-[auto_1fr]">
          <div className="flex items-baseline gap-2">
            <span
              className={cn('text-4xl font-bold tabular-nums leading-none', status === 'bad' ? 'text-danger' : 'text-success')}
              data-testid="tp-gap-pct"
            >
              {fmtPct(gap.gap_pct)}
            </span>
            <span className="text-xs text-muted-foreground">
              {status === 'bad'
                ? t('teamProductivity.gapOver', { threshold: fmtPct(gap.threshold_pct) })
                : t('teamProductivity.gapWithin', { threshold: fmtPct(gap.threshold_pct) })}
            </span>
          </div>

          <div className="min-w-0 space-y-2">
            {/* Шкала: 0 … дээд хүн (100%).  Шугам = дээд хүний (100 − босго)%. */}
            <div className="relative h-3 rounded-full bg-muted" aria-hidden>
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-primary/25"
                style={{ width: `${bottomPos}%` }}
              />
              <div
                className="absolute inset-y-[-3px] w-0.5 bg-foreground/70"
                style={{ left: `${linePct}%` }}
                title={t('teamProductivity.lineTitle')}
              />
              <div
                className={cn('absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background', status === 'bad' ? 'bg-danger' : 'bg-success')}
                style={{ left: `${bottomPos}%` }}
              />
              <div className="absolute right-0 top-1/2 h-3.5 w-3.5 translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-primary" />
            </div>
            <div className="grid gap-1 text-xs sm:grid-cols-2">
              <span className="truncate">
                <span className="text-muted-foreground">{t('teamProductivity.top')}: </span>
                <b>{top ? formatDisplayName(top.full_name) : '—'}</b> · {fmtAvg(gap.top_avg)}
                {t('teamProductivity.perDaySuffix')}
              </span>
              <span className="truncate">
                <span className="text-muted-foreground">{t('teamProductivity.bottom')}: </span>
                <b>{bottom ? formatDisplayName(bottom.full_name) : '—'}</b> · {fmtAvg(gap.bottom_avg)}
                {t('teamProductivity.perDaySuffix')}
              </span>
              <span className="sm:col-span-2">
                <span className="text-muted-foreground">{t('teamProductivity.line', { pct: fmtPct(linePct) })}: </span>
                <b>{fmtAvg(gap.line)}</b>
                {t('teamProductivity.perDaySuffix')}
                {belowCount > 0 && (
                  <span className={cn('ml-1', status === 'bad' ? 'text-danger' : 'text-muted-foreground')}>
                    · {t('teamProductivity.belowCount', { n: belowCount })}
                  </span>
                )}
              </span>
            </div>
          </div>
        </div>
      )}
      {kind === 'day' && enough && (
        <p className="mt-3 text-label font-normal normal-case tracking-normal text-muted-foreground">{t('teamProductivity.dayNoisy')}</p>
      )}
    </section>
  );
}

function ThresholdEditor({ value, onSave }: { value: number; onSave: (v: number) => Promise<void> }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const [saving, setSaving] = useState(false);
  const n = Number(draft);
  const valid = Number.isFinite(n) && n >= 1 && n <= 100;
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setDraft(String(value));
      }}
    >
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" data-testid="tp-threshold-open">
          <Pencil className="h-3.5 w-3.5" />
          {t('teamProductivity.thresholdShort', { v: fmtPct(value) })}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-2" align="end">
        <p className="text-xs font-medium">{t('teamProductivity.thresholdTitle')}</p>
        <p className="text-label font-normal normal-case tracking-normal text-muted-foreground">{t('teamProductivity.thresholdHelp')}</p>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={1}
            max={100}
            step={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="h-8 w-20"
            data-testid="tp-threshold-input"
          />
          <span className="text-sm">%</span>
          <Button
            size="sm"
            className="ml-auto h-8"
            disabled={!valid || saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave(n);
                setOpen(false);
              } finally {
                setSaving(false);
              }
            }}
            data-testid="tp-threshold-save"
          >
            {t('common.save')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
