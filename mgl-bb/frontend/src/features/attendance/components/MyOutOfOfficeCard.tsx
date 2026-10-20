/**
 * Ажлаас гадуурх цагийн хүсэлт — жагсаалт + хүсэлт оруулах modal.
 *
 * MyLeavesCard-тай ижил pattern: нэг work_date + цаг + approve/reject
 * урсгал.  Ялгаа нь шалтгааны ангилал (Зохиогчийн хяналт, Хурал,
 * Бичиг баримт/Зураг хүргэх, Хичээл, Бусад) сонгоно.  «Бусад» үед
 * тайлбараа гараар бичнэ.
 */
import { useEffect, useState } from 'react';
import { apiFetch, uploadFile } from '@/shared/api/client';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { useLanguage } from '@/shared/i18n';
import type { OutOfOfficeCategory, OutOfOfficeRequest } from '@/shared/types';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Textarea } from '@/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import {
  CheckCircle2,
  Clock,
  Trash2,
  Paperclip,
  AlertCircle,
  Loader2,
  MapPin,
  Eye,
  Users,
  FileText,
  Ruler,
  GraduationCap,
  MoreHorizontal,
} from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { APPROVAL_STATUS_TONE } from '@/shared/lib/status-colors';
import { RequestCardShell, RequestStatusBadge } from '@/features/attendance/components/RequestCardKit';

import { formatDate } from '@/shared/lib/time';

const CATEGORY_META: Record<
  OutOfOfficeCategory,
  { labelKey: string; icon: React.ComponentType<{ className?: string }> }
> = {
  author_supervision: { labelKey: 'myOutOfOfficeCard.categoryAuthorSupervision', icon: Eye },
  meeting: { labelKey: 'myOutOfOfficeCard.categoryMeeting', icon: Users },
  documents: { labelKey: 'myOutOfOfficeCard.categoryDocuments', icon: FileText },
  drawings: { labelKey: 'myOutOfOfficeCard.categoryDrawings', icon: Ruler },
  class: { labelKey: 'myOutOfOfficeCard.categoryClass', icon: GraduationCap },
  other: { labelKey: 'myOutOfOfficeCard.categoryOther', icon: MoreHorizontal },
};

const CATEGORY_ORDER: OutOfOfficeCategory[] = [
  'author_supervision',
  'meeting',
  'documents',
  'drawings',
  'class',
  'other',
];

const DURATIONS = [1, 2, 3, 4, 5, 6];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function fmtDate(iso: string): string {
  return formatDate(new Date(iso + 'T00:00:00'));
}

export default function MyOutOfOfficeCard() {
  const { t } = useLanguage();
  const [items, setItems] = useState<OutOfOfficeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const res = await apiFetch<{ requests: OutOfOfficeRequest[] }>('/out-of-office/my');
      setItems(res.requests);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const cancel = async (id: number) => {
    if (!(await confirmDialog({ description: t('myOutOfOfficeCard.cancelConfirm'), variant: 'destructive' }))) return;
    try {
      await apiFetch(`/out-of-office/${id}`, { method: 'DELETE' });
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('myOutOfOfficeCard.cancelFailed'));
    }
  };

  const pendingCount = items.filter((o) => o.status === 'pending').length;

  return (
    <>
      <RequestCardShell
        id="sec-attendance-ooo"
        icon={MapPin}
        iconClassName="text-teal-500"
        title={t('myOutOfOfficeCard.title')}
        headerBadges={
          pendingCount > 0 && (
            <Badge variant="outline" className={cn('text-[10px]', APPROVAL_STATUS_TONE.pending)}>
              {t('myOutOfOfficeCard.pendingCount', { count: pendingCount })}
            </Badge>
          )
        }
        onNew={() => setShowForm(true)}
        newLabel={t('myOutOfOfficeCard.newRequest')}
        loading={loading}
        error={error}
        isEmpty={items.length === 0}
        emptyIcon={MapPin}
        emptyText={t('myOutOfOfficeCard.empty')}
        emptyHint={t('myOutOfOfficeCard.emptyHint')}
      >
        {items.map((o) => {
          const cm = CATEGORY_META[o.category];
          const Icon = cm.icon;
          return (
            <li key={o.id} className="py-3 flex items-start gap-3">
              <div className="h-9 w-9 rounded-lg flex items-center justify-center border shrink-0 bg-teal-50 border-teal-200 text-teal-600 dark:bg-teal-900/30">
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{t(cm.labelKey)}</span>
                  <RequestStatusBadge status={o.status} labelPrefix="myOutOfOfficeCard" />
                  <span className="text-[11px] text-muted-foreground tabular-nums ml-auto font-semibold">
                    {t('myOutOfOfficeCard.hoursShort', { hours: o.hours })}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {fmtDate(o.work_date)}
                  {(o.start_time || o.end_time) && (
                    <span className="ml-1.5 tabular-nums">
                      · {o.start_time ?? '?'} → {o.end_time ?? '?'}
                    </span>
                  )}
                </div>
                {o.reason && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{o.reason}</p>
                )}
                {o.reviewer_note && (
                  <p className="text-[11px] mt-1 px-2 py-1 rounded bg-muted/50 border border-border/50">
                    <span className="font-medium">
                      {o.reviewer_name ?? t('myOutOfOfficeCard.management')}:
                    </span>{' '}
                    {o.reviewer_note}
                  </p>
                )}
              </div>
              {o.status === 'pending' && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => cancel(o.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </li>
          );
        })}
      </RequestCardShell>

      <OutOfOfficeRequestDialog
        open={showForm}
        onClose={() => setShowForm(false)}
        onCreated={refresh}
      />
    </>
  );
}

function OutOfOfficeRequestDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useLanguage();
  const [category, setCategory] = useState<OutOfOfficeCategory>('author_supervision');
  const [workDate, setWorkDate] = useState(todayIso());
  const [hours, setHours] = useState<number>(2);
  const [customMode, setCustomMode] = useState(false);
  const [customHours, setCustomHours] = useState<string>('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [reason, setReason] = useState('');
  const [attachment, setAttachment] = useState('');
  const [attachName, setAttachName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCategory('author_supervision');
      setWorkDate(todayIso());
      setHours(2);
      setCustomMode(false);
      setCustomHours('');
      setStartTime('');
      setEndTime('');
      setReason('');
      setAttachment('');
      setAttachName('');
      setError(null);
    }
  }, [open]);

  // start/end оруулсан тохиолдолд автоматаар цагийг тооцно.
  useEffect(() => {
    if (startTime && endTime) {
      const [sh, sm] = startTime.split(':').map(Number);
      const [eh, em] = endTime.split(':').map(Number);
      if ([sh, sm, eh, em].every((n) => Number.isFinite(n))) {
        const mins = eh! * 60 + em! - (sh! * 60 + sm!);
        if (mins > 0) {
          const h = Math.round((mins / 60) * 100) / 100;
          if (h > 0 && h <= 16) {
            setCustomMode(true);
            setCustomHours(h.toString());
          }
        }
      }
    }
  }, [startTime, endTime]);

  const finalHours = customMode ? parseFloat(customHours) : hours;
  const isOther = category === 'other';

  const handleAttachment = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const url = await uploadFile(file);
      setAttachment(url);
      setAttachName(file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('myOutOfOfficeCard.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (!workDate) {
      setError(t('myOutOfOfficeCard.errorNoDate'));
      return;
    }
    if (!startTime) {
      setError(t('myOutOfOfficeCard.errorNoStart'));
      return;
    }
    if (!endTime) {
      setError(t('myOutOfOfficeCard.errorNoEnd'));
      return;
    }
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    const spanMins = eh * 60 + em - (sh * 60 + sm);
    if (!Number.isFinite(spanMins) || spanMins <= 0) {
      setError(t('myOutOfOfficeCard.errorEndBeforeStart'));
      return;
    }
    if (!reason.trim()) {
      setError(t('myOutOfOfficeCard.errorNoReason'));
      return;
    }
    const spanHours = Math.round((spanMins / 60) * 100) / 100;
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/out-of-office', {
        data: {
          work_date: workDate,
          category,
          hours: spanHours,
          start_time: startTime,
          end_time: endTime,
          reason: reason.trim(),
          attachment_url: attachment || null,
        },
      });
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('myOutOfOfficeCard.submitFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-teal-500" />
            {t('myOutOfOfficeCard.dialogTitle')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">{t('myOutOfOfficeCard.categoryLabel')}</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as OutOfOfficeCategory)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_ORDER.map((k) => {
                  const Icon = CATEGORY_META[k].icon;
                  return (
                    <SelectItem key={k} value={k}>
                      <span className="flex items-center gap-2">
                        <Icon className="h-3.5 w-3.5" /> {t(CATEGORY_META[k].labelKey)}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">{t('myOutOfOfficeCard.dateLabel')}</Label>
            <Input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">{t('myOutOfOfficeCard.durationLabel')}</Label>
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
              {DURATIONS.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => {
                    setHours(h);
                    setCustomMode(false);
                  }}
                  className={cn(
                    'text-xs py-2 rounded-md border font-semibold transition-colors',
                    !customMode && hours === h
                      ? 'bg-teal-500 text-white border-teal-500'
                      : 'border-border bg-muted/30 hover:bg-muted',
                  )}
                >
                  {t('myOutOfOfficeCard.hoursShort', { hours: h })}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCustomMode(true)}
                className={cn(
                  'text-[11px] py-2 rounded-md border font-medium transition-colors',
                  customMode
                    ? 'bg-teal-500 text-white border-teal-500'
                    : 'border-border bg-muted/30 hover:bg-muted',
                )}
              >
                {t('myOutOfOfficeCard.other')}
              </button>
            </div>
            {customMode && (
              <Input
                type="number"
                step="0.25"
                min="0.25"
                max="16"
                placeholder={t('myOutOfOfficeCard.customHoursPlaceholder')}
                value={customHours}
                onChange={(e) => setCustomHours(e.target.value)}
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">
                {t('myOutOfOfficeCard.startTimeLabel')} <span className="text-destructive">*</span>
              </Label>
              <Input
                type="time"
                required
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className={cn(!startTime && 'border-destructive/60')}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                {t('myOutOfOfficeCard.endTimeLabel')} <span className="text-destructive">*</span>
              </Label>
              <Input
                type="time"
                required
                value={endTime}
                min={startTime}
                onChange={(e) => setEndTime(e.target.value)}
                className={cn(!endTime && 'border-destructive/60')}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">
              {t('myOutOfOfficeCard.reasonLabel')} <span className="text-destructive">*</span>
            </Label>
            <Textarea
              rows={3}
              placeholder={
                isOther
                  ? t('myOutOfOfficeCard.reasonPlaceholderOther')
                  : t('myOutOfOfficeCard.reasonPlaceholder')
              }
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={cn(!reason.trim() && 'border-destructive/60')}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1">
              <Paperclip className="h-3 w-3" />
              {t('myOutOfOfficeCard.attachmentLabel')}{' '}
              <span className="text-muted-foreground font-normal">
                {t('myOutOfOfficeCard.optionalParen')}
              </span>
            </Label>
            {attachment ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-success/10 border border-success/30 text-success text-xs">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span className="truncate flex-1">{attachName}</span>
                <button
                  type="button"
                  aria-label={t('common.delete')}
                  className="text-success hover:text-success/80"
                  onClick={() => {
                    setAttachment('');
                    setAttachName('');
                  }}
                >
                  ✕
                </button>
              </div>
            ) : (
              <Input
                type="file"
                accept="image/*,application/pdf"
                disabled={uploading}
                onChange={(e) => handleAttachment(e.target.files?.[0] ?? null)}
              />
            )}
            {uploading && (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> {t('myOutOfOfficeCard.uploading')}
              </p>
            )}
          </div>

          <div className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs flex items-center justify-between dark:bg-teal-900/20 dark:border-teal-800">
            <span className="text-muted-foreground">{t('myOutOfOfficeCard.totalRequest')}</span>
            <span className="font-semibold text-teal-700 dark:text-teal-400 tabular-nums">
              {Number.isFinite(finalHours) && finalHours > 0
                ? t('myOutOfOfficeCard.hoursLong', { hours: finalHours })
                : '—'}
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={submitting || uploading}>
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />{' '}
                {t('myOutOfOfficeCard.submitting')}
              </>
            ) : (
              <>
                <Clock className="h-3.5 w-3.5 mr-1.5" /> {t('myOutOfOfficeCard.submit')}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
