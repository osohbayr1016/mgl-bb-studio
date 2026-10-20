/**
 * «Хугацаа сунгах» диалог — төслийн дуусах хугацааг ХОЙШЛУУЛАХ ЦОРЫН ГАНЦ зам
 * (migration 0337).
 *
 * «Хуваарь» цонх ба паспортын 1.3 хүснэгт нь хойшлуулсан огноог 409
 * `EXTENSION_REQUIRED`-ээр буцаадаг тул сунгалт бүр ЭНД: шинэ огноо + шалтгаан
 * + хэн зөвшөөрсөн (захиалагч / захирал / бусад) заавал; лавлах баримт,
 * зөвшөөрсөн огноо, тэмдэглэл сонголттой.  Сервер `finish_date`-ыг шинэчилж,
 * түүхийн мөр бичдэг тул Timeline, график, «хугацаа хэтэрсэн» бүгд шинэ
 * хугацааг автоматаар авна.
 *
 * Клиент талын шалгалт нь серверийн `validateExtensionInput`-ийг давхарлана —
 * сервер нь жинхэнэ хаалт хэвээр (400-ийн мессеж монголоор, шууд харуулна).
 */
import { useMemo, useState } from 'react';
import { CalendarPlus, Loader2 } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { toast } from '@/shared/components/Toast';
import { Button } from '@/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { Textarea } from '@/ui/textarea';

import { createExtension } from './api';
import { APPROVED_BY_KINDS, type ApprovedByKind } from './types';

/** Хатуу `YYYY-MM-DD` + жинхэнэ хуанлийн огноо (ScheduleDialog-той ижил). */
function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000,
  );
}

function addDays(iso: string, n: number): string {
  return new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
}

export interface ExtensionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  projectTitle: string;
  /** Одоогийн дуусах хугацаа (ISO).  null бол диалог «эхлээд тогтоо» гэж хэлнэ. */
  currentFinishDate: string | null;
  /** Хэд дэх сунгалт болох (0 = анхных). */
  extensionCount: number;
  /** «Хуваарь» цонхноос шилжиж ирэхэд урьдчилан бөглөх огноо. */
  initialDate?: string | null;
  onSaved?: (finishDate: string) => void;
}

export function ExtensionDialog(props: ExtensionDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* `key` — дахин нээхэд талбарууд шинээр эхэлнэ. */}
        {props.open && <ExtensionDialogBody key={`${props.projectId}:${props.initialDate ?? ''}`} {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function ExtensionDialogBody({
  onOpenChange,
  projectId,
  projectTitle,
  currentFinishDate,
  extensionCount,
  initialDate,
  onSaved,
}: ExtensionDialogProps) {
  const { t } = useLanguage();
  const [newDate, setNewDate] = useState(initialDate ?? '');
  const [reason, setReason] = useState('');
  const [kind, setKind] = useState<ApprovedByKind>('client');
  const [approverName, setApproverName] = useState('');
  const [approvedOn, setApprovedOn] = useState('');
  const [referenceNo, setReferenceNo] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const current = currentFinishDate && isIsoDate(currentFinishDate) ? currentFinishDate : null;
  const minDate = current ? addDays(current, 1) : undefined;

  const days = useMemo(
    () => (current && isIsoDate(newDate) ? daysBetween(current, newDate) : null),
    [current, newDate],
  );

  const submit = async () => {
    if (!current) {
      setError(t('deadlineExt.noCurrent'));
      return;
    }
    if (!isIsoDate(newDate)) {
      setError(t('timelinePage.invalidDate'));
      return;
    }
    if (newDate <= current) {
      setError(t('deadlineExt.mustBeLater'));
      return;
    }
    if (!reason.trim() || (kind === 'other' && !approverName.trim())) {
      setError(t('deadlineExt.requiredFields'));
      return;
    }
    if (approvedOn && !isIsoDate(approvedOn)) {
      setError(t('timelinePage.invalidDate'));
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const res = await createExtension(projectId, {
        new_finish_date: newDate,
        reason: reason.trim(),
        approved_by_kind: kind,
        approved_by_name: approverName.trim() || undefined,
        approved_on: approvedOn || undefined,
        reference_no: referenceNo.trim() || undefined,
        note: note.trim() || undefined,
      });
      toast.success(t('deadlineExt.saved'));
      onSaved?.(res.finish_date);
      onOpenChange(false);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t('common.error');
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <CalendarPlus className="h-4 w-4 text-primary" />
          {t('deadlineExt.extend')}
          <span className="text-muted-foreground font-normal text-sm">
            · {t('deadlineExt.nth', { n: extensionCount + 1 })}
          </span>
        </DialogTitle>
        <DialogDescription>{projectTitle}</DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-2">
        {/* Одоогийн → шинэ */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">{t('deadlineExt.current')}</Label>
            <div className="h-9 rounded-md border border-border bg-muted/40 px-3 flex items-center text-sm tabular-nums">
              {current ?? t('deadlines.noDate')}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ext-new-date" className="text-xs font-medium">
              {t('deadlineExt.newDate')} *
            </Label>
            <Input
              id="ext-new-date"
              type="date"
              value={newDate}
              min={minDate}
              disabled={!current}
              onChange={(e) => setNewDate(e.target.value)}
            />
          </div>
        </div>
        {days != null && (
          <p className={days > 0 ? 'text-body text-primary' : 'text-body text-danger'}>
            {days > 0 ? t('deadlineExt.daysPlus', { n: days }) : t('deadlineExt.mustBeLater')}
          </p>
        )}
        {!current && <p className="text-body text-warning">{t('deadlineExt.noCurrent')}</p>}

        {/* Шалтгаан */}
        <div className="space-y-1.5">
          <Label htmlFor="ext-reason" className="text-xs font-medium">
            {t('deadlineExt.reason')} *
          </Label>
          <Textarea
            id="ext-reason"
            rows={2}
            value={reason}
            maxLength={1000}
            placeholder={t('deadlineExt.reasonPlaceholder')}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        {/* Хэн зөвшөөрсөн */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">{t('deadlineExt.approvedBy')} *</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as ApprovedByKind)}>
              <SelectTrigger className="h-9 w-full text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {APPROVED_BY_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(`deadlineExt.kind_${k}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ext-approver" className="text-xs font-medium">
              {t('deadlineExt.approverName')}
              {kind === 'other' && ' *'}
            </Label>
            <Input
              id="ext-approver"
              value={approverName}
              maxLength={200}
              placeholder={t('deadlineExt.approverNamePlaceholder')}
              onChange={(e) => setApproverName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ext-approved-on" className="text-xs font-medium">
              {t('deadlineExt.approvedOn')}
            </Label>
            <Input
              id="ext-approved-on"
              type="date"
              value={approvedOn}
              onChange={(e) => setApprovedOn(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ext-ref" className="text-xs font-medium">
              {t('deadlineExt.referenceNo')}
            </Label>
            <Input
              id="ext-ref"
              value={referenceNo}
              maxLength={200}
              placeholder={t('deadlineExt.referenceNoPlaceholder')}
              onChange={(e) => setReferenceNo(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ext-note" className="text-xs font-medium">
            {t('deadlineExt.note')}
          </Label>
          <Textarea
            id="ext-note"
            rows={2}
            value={note}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {error && (
          <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-micro text-danger">
            {error}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
          {t('timelinePage.cancel')}
        </Button>
        <Button disabled={saving || !current} onClick={submit}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {t('deadlineExt.submit')}
        </Button>
      </DialogFooter>
    </>
  );
}

export default ExtensionDialog;
