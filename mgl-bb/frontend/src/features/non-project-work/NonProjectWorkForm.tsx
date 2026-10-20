import { useState } from 'react';
import { CheckCircle2, Clock, Loader2 } from 'lucide-react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Textarea } from '@/ui/textarea';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { ApiError } from '@/shared/api/client';
import { categoryLabel, exceedsShiftEnd, formatDuration, overlapsLunch, previewMinutes } from './lib';
import type { NonProjectFormValues, NonProjectMeta } from './types';

/**
 * Төслийн бус ажлын маягт — «Миний ажлууд»-аас АЖЛАА ДУУСГАСНЫ ДАРАА бөглөнө
 * (эзний шийдвэр 2026-09-28).  Ирцийн цонх зөвхөн хяналт (`NonProjectPicker`,
 * цаг/хувь бодохгүй); цаг, хувь зөвхөн эндээс:
 *   ажлын төрөл, «Бусад» үед ямар ажил, эхэлсэн/дууссан цаг (ЗААВАЛ — ирцэд
 *   сонгосон мөрт эхэлсэн цаг нь сонгосон цагаар урьдчилан бөглөгдөнө), «юу
 *   хийсэн» (ЗААВАЛ).  Хадгалмагц админы шалгалт руу илгээгдэнэ.
 *
 * «Нийт хугацаа» мөр нь хоёр цаг хоёулаа бөглөгдсөн үед л гарна (эзэн: сонголт
 * хийхэд тэр хэсэг гарч ирэх ёсгүй).
 */
interface Props {
  meta: NonProjectMeta;
  initial?: Partial<NonProjectFormValues>;
  submitLabel: string;
  onSubmit: (values: NonProjectFormValues) => Promise<void>;
  onCancel?: () => void;
}

export default function NonProjectWorkForm({ meta, initial, submitLabel, onSubmit, onCancel }: Props) {
  const { t } = useLanguage();
  const [category, setCategory] = useState(initial?.category ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [start, setStart] = useState(initial?.start_time ?? '');
  const [end, setEnd] = useState(initial?.end_time ?? '');
  const [report, setReport] = useState(initial?.report ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = meta.categories.find((c) => c.key === category) ?? null;
  const needsNote = !!selected?.requires_note;
  const minutes = previewMinutes(start, end, meta.lunch);
  const timesEntered = start !== '' && end !== '';
  const lunchDeducted = minutes !== null && overlapsLunch(start, end, meta.lunch);
  const pastShift = exceedsShiftEnd(end, meta.shift_end);
  const shiftEnd = meta.shift_end || undefined;

  const valid =
    !!selected &&
    (!needsNote || note.trim().length > 0) &&
    minutes !== null &&
    minutes > 0 &&
    !pastShift &&
    report.trim().length > 0;

  const submit = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        category,
        note: needsNote ? note.trim() : '',
        start_time: start,
        end_time: end,
        report: report.trim(),
      });
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : t('nonProjectWork.failed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3" data-testid="non-project-form">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">{t('nonProjectWork.categoryLabel')}</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          {meta.categories.map((c) => {
            const active = c.key === category;
            return (
              <Button
                key={c.key}
                type="button"
                variant="ghost"
                disabled={submitting}
                onClick={() => setCategory(c.key)}
                data-category={c.key}
                aria-pressed={active}
                className={cn(
                  // ⚠️ `h-auto` ганцаараа `pointer-coarse:h-11`-ийг дардаггүй (tailwind-merge).
                  'h-auto justify-start gap-2 whitespace-normal rounded-lg border px-3 py-2 text-left text-sm font-normal pointer-coarse:h-auto pointer-coarse:min-h-11',
                  active
                    ? 'border-info/60 bg-info/10 text-info hover:bg-info/10 hover:text-info'
                    : 'border-border bg-background/40 hover:border-info/40 hover:bg-background/40',
                )}
              >
                <span
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                    active ? 'border-info bg-info text-info-foreground' : 'border-muted-foreground/40',
                  )}
                >
                  {active && <CheckCircle2 className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0 flex-1 break-words">{categoryLabel(c.key, c.label, t)}</span>
              </Button>
            );
          })}
        </div>
      </div>

      {needsNote && (
        <div className="space-y-1.5">
          <Label htmlFor="npw-note" className="text-xs text-muted-foreground">
            {t('nonProjectWork.noteLabel')}
          </Label>
          <Input
            id="npw-note"
            value={note}
            maxLength={500}
            disabled={submitting}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('nonProjectWork.notePlaceholder')}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="npw-start" className="text-xs text-muted-foreground">
            {t('nonProjectWork.startLabel')}
          </Label>
          <Input
            id="npw-start"
            type="time"
            value={start}
            max={shiftEnd}
            disabled={submitting}
            onChange={(e) => setStart(e.target.value)}
            className="tabular-nums"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="npw-end" className="text-xs text-muted-foreground">
            {t('nonProjectWork.endLabel')}
          </Label>
          <Input
            id="npw-end"
            type="time"
            value={end}
            max={shiftEnd}
            disabled={submitting}
            onChange={(e) => setEnd(e.target.value)}
            className="tabular-nums"
          />
        </div>
      </div>

      {timesEntered && (
        <div
          className="flex items-start justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm"
          data-testid="npw-duration-box"
        >
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            {t('nonProjectWork.durationLabel')}
          </span>
          <span className="text-right">
            {pastShift && meta.shift_end ? (
              <span className="text-xs text-warning" data-testid="npw-after-shift">
                {t('nonProjectWork.afterShiftEnd', { end: meta.shift_end })}
              </span>
            ) : minutes !== null && minutes > 0 ? (
              <span className="font-semibold tabular-nums" data-testid="npw-duration">
                {formatDuration(minutes, t)}
              </span>
            ) : (
              <span className="text-xs text-warning">
                {minutes === 0 ? t('nonProjectWork.allLunch') : t('nonProjectWork.endBeforeStart')}
              </span>
            )}
            {lunchDeducted && meta.lunch && minutes !== null && minutes > 0 && (
              <span className="block text-micro text-muted-foreground">
                {t('nonProjectWork.lunchDeducted', { start: meta.lunch.start, end: meta.lunch.end })}
              </span>
            )}
          </span>
        </div>
      )}
      {/* 0352: оффисоос гадуур явахдаа гарах бүртгэлээ хийгээд явна — гарах
          цагаас хойших энэ ажлын хугацаа ажилласан цагт тооцогдоно. */}
      {timesEntered && (
        <p className="text-micro text-muted-foreground" data-testid="npw-credit-hint">
          {t('nonProjectWork.creditHint')}
        </p>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="npw-report" className="text-xs text-muted-foreground">
          {t('nonProjectWork.reportLabel')}
        </Label>
        <Textarea
          id="npw-report"
          rows={3}
          value={report}
          maxLength={2000}
          disabled={submitting}
          onChange={(e) => setReport(e.target.value)}
          placeholder={t('nonProjectWork.reportPlaceholder')}
        />
      </div>

      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={submitting}>
            {t('common.cancel')}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          onClick={() => void submit()}
          disabled={!valid || submitting}
          className="gap-1.5"
          data-testid="npw-submit"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
