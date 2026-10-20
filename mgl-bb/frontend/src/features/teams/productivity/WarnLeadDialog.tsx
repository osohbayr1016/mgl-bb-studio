import { useMemo, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { Textarea } from '@/ui/textarea';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';
import { sendGapWarning } from './api';
import type {
  ProductivityGap,
  ProductivityMember,
  ProductivityPeriod,
  ProductivityTeam,
  WarningCandidate,
} from './types';
import { fmtAvg, fmtPct, periodLabel } from './lib';

const NOTE_MAX = 1000;

/**
 * Захирал → багийн ахлах руу «гишүүдийн бүтээмжийн зөрүүнд анхаар» мэдэгдэл.
 * Хүлээн авагч = ахлах (тохируулсан бол), эсвэл тухайн багийн senior-ууд
 * (`createNotificationForReviewers`-ийн ижил дүрэм).  Тоог СЕРВЕР дахин бодож
 * бичвэрээ угсарна — энд харагдаж буй нь зөвхөн урьдчилсан харагдац.
 */
export function WarnLeadDialog({
  open,
  onOpenChange,
  team,
  period,
  gap,
  members,
  candidates,
  onSent,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  team: ProductivityTeam;
  period: ProductivityPeriod;
  gap: ProductivityGap;
  members: ProductivityMember[];
  candidates: WarningCandidate[];
  onSent: () => void | Promise<void>;
}) {
  const { t } = useLanguage();
  // Дуудагч цонхыг нээх бүрд ШИНЭЭР mount хийнэ (`{open && <WarnLeadDialog/>}`) —
  // анхны сонголт effect-гүйгээр энд тогтоно.
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(candidates.filter((c) => c.default_selected).map((c) => c.id)),
  );
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  const below = useMemo(
    () => members.filter((m) => m.below_line).sort((a, b) => (a.avg ?? 0) - (b.avg ?? 0)),
    [members],
  );
  const top = members.find((m) => m.user_id === gap.top_user_id);
  const bottom = members.find((m) => m.user_id === gap.bottom_user_id);

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const send = async () => {
    if (selected.size === 0) return;
    setSending(true);
    try {
      const res = await sendGapWarning(team.id, {
        period: period.kind,
        date: period.from,
        recipient_ids: [...selected],
        note: note.trim(),
      });
      toast.success(
        t('teamProductivity.warnSent'),
        res.notified.map((n) => formatDisplayName(n.full_name)).join(', '),
      );
      await onSent();
      onOpenChange(false);
    } catch (err) {
      toast.error(t('teamProductivity.warnFailed'), err instanceof Error ? err.message : undefined);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] max-w-lg flex-col overflow-hidden" data-testid="tp-warn-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4 text-danger" />
            {t('teamProductivity.warnTitle')}
          </DialogTitle>
          <DialogDescription>
            {team.code} · {team.name_mn} · {periodLabel(period, t)}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <div className="space-y-1 rounded-lg border border-danger/30 bg-danger/5 p-3 text-xs">
            <p className="text-sm font-semibold text-danger">
              {t('teamProductivity.warnGapLine', { gap: fmtPct(gap.gap_pct), threshold: fmtPct(gap.threshold_pct) })}
            </p>
            {top && (
              <p>
                {t('teamProductivity.top')}: <b>{formatDisplayName(top.full_name)}</b> · {fmtAvg(gap.top_avg)}
                {t('teamProductivity.perDaySuffix')}
              </p>
            )}
            {bottom && (
              <p>
                {t('teamProductivity.bottom')}: <b>{formatDisplayName(bottom.full_name)}</b> · {fmtAvg(gap.bottom_avg)}
                {t('teamProductivity.perDaySuffix')}
              </p>
            )}
            {below.length > 0 && (
              <div className="pt-1">
                <p className="text-muted-foreground">{t('teamProductivity.belowCount', { n: below.length })}:</p>
                <ul className="mt-1 space-y-0.5">
                  {below.map((m) => (
                    <li key={m.user_id} className="flex justify-between gap-2 tabular-nums">
                      <span className="truncate">{formatDisplayName(m.full_name)}</span>
                      <span className="shrink-0">
                        {fmtAvg(m.avg)} · <span className="text-danger">+{fmtAvg(m.need_per_day)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium">{t('teamProductivity.warnRecipients')}</p>
            {!team.lead_active && (
              <p className="text-label font-normal normal-case tracking-normal text-muted-foreground">{t('teamProductivity.warnNoLead')}</p>
            )}
            {candidates.length === 0 ? (
              <p className="text-xs text-danger">{t('teamProductivity.warnNoCandidates')}</p>
            ) : (
              <ul className="space-y-1" data-testid="tp-warn-recipients">
                {candidates.map((c) => (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
                      <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} data-user-id={c.id} />
                      <span className="text-sm">{formatDisplayName(c.full_name)}</span>
                      {c.is_lead && (
                        <span className="rounded border border-success/40 bg-success/10 px-1 text-label text-success">
                          {t('teamProductivity.leadBadge')}
                        </span>
                      )}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium">{t('teamProductivity.warnNote')}</p>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
              rows={3}
              placeholder={t('teamProductivity.warnNotePlaceholder')}
              data-testid="tp-warn-note"
            />
            <p className="text-right text-label font-normal normal-case tracking-normal text-muted-foreground">
              {note.length}/{NOTE_MAX}
            </p>
          </div>
        </div>

        <DialogFooter className="pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={send}
            disabled={selected.size === 0 || sending}
            className="gap-1.5"
            data-testid="tp-warn-send"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {t('teamProductivity.warnSend', { n: selected.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
