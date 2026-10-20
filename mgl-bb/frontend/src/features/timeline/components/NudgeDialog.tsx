/* ─────────────────────────────────────────────────────────────────────────
 * Сануулах (nudge) диалог
 * -------------------------------------------------------------------------
 * Хариуцагчийг сервер тал `notifyProjectResponsible`-ээр шийддэг (багийн
 * ахлагч → багийн senior гишүүд → админ).  Энд харуулж буй `project.leads`
 * нь тэр каскадын эхний давхарга бөгөөд ХООСОН байж болно — тийм үед ч
 * илгээх боломжтой хэвээр (сервер админ руу шилжинэ), гэхдээ хэнд очихыг
 * урьдчилж амлахгүй.
 *
 * Нэг илгээгч нэг төслийг өдөрт нэг л удаа сануулна — сервер 409 буцаана.
 * ───────────────────────────────────────────────────────────────────────── */
import { useState } from 'react';
import { BellRing, Loader2, Users } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { ApiError } from '@/shared/api/client';
import { toast } from '@/shared/components/Toast';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { Label } from '@/ui/label';
import { Textarea } from '@/ui/textarea';

import type { TimelineProject } from '../types';
import { sendNudge } from '../api';

const NOTE_MAX = 500;

interface NudgeDialogProps {
  /** `null` үед диалог хаалттай. */
  project: TimelineProject | null;
  onOpenChange: (open: boolean) => void;
  /** Амжилттай илгээсний дараа — cache-ийг шинэчлэх. */
  onSent: () => void;
}

export function NudgeDialog({ project, onOpenChange, onSent }: NudgeDialogProps) {
  return (
    <Dialog open={project !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {project && (
          <NudgeDialogBody
            key={project.id}
            project={project}
            onOpenChange={onOpenChange}
            onSent={onSent}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function NudgeDialogBody({
  project,
  onOpenChange,
  onSent,
}: {
  project: TimelineProject;
  onOpenChange: (open: boolean) => void;
  onSent: () => void;
}) {
  const { t } = useLanguage();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const submit = async () => {
    setError(null);
    setSending(true);
    try {
      const result = await sendNudge(project.id, note.trim().slice(0, NOTE_MAX));
      const names = (result.notified ?? []).map((user) => user.full_name).join(', ');
      if (names) {
        toast.success(t('timelinePage.nudgeSent', { names }));
      } else {
        // Сервер 200 буцаасан ч хэн ч олдоогүй тохиолдол.
        toast.warn(t('timelinePage.nudgeNoTarget'));
      }
      onSent();
      onOpenChange(false);
    } catch (e: unknown) {
      // 409 = энэ илгээгч энэ төслийг өнөөдөр аль хэдийн сануулсан.
      const message =
        e instanceof ApiError && e.status === 409
          ? t('timelinePage.nudgeTooSoon')
          : e instanceof Error
            ? e.message
            : t('common.error');
      setError(message);
      toast.error(message);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <BellRing className="h-4 w-4 text-primary" />
          {t('timelinePage.nudgeTitle')}
        </DialogTitle>
        <DialogDescription>{project.display_title?.trim() || project.name}</DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-2">
        <p className="text-body text-muted-foreground">{t('timelinePage.nudgeDescription')}</p>

        {/* Хэнд очих вэ */}
        <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
            <Users className="h-3.5 w-3.5 text-muted-foreground" />
            {t('timelinePage.leads')}
          </div>
          {project.leads.length === 0 ? (
            <p className="text-micro text-muted-foreground">{t('timelinePage.nudgeNoTarget')}</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {project.leads.map((lead) => (
                <Badge key={lead.id} variant="outline" className="text-micro">
                  {lead.full_name}
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="timeline-nudge-note" className="text-xs font-medium">
            {t('timelinePage.nudgeNote')}
          </Label>
          <Textarea
            id="timeline-nudge-note"
            rows={3}
            maxLength={NOTE_MAX}
            value={note}
            placeholder={t('timelinePage.nudgeNotePlaceholder')}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="text-right text-micro tabular-nums text-muted-foreground">
            {note.length}/{NOTE_MAX}
          </div>
        </div>

        {error && (
          <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-micro text-danger">
            {error}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" disabled={sending} onClick={() => onOpenChange(false)}>
          {t('timelinePage.cancel')}
        </Button>
        <Button disabled={sending} onClick={submit}>
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <BellRing className="h-4 w-4" />
          )}
          {t('timelinePage.nudgeSend')}
        </Button>
      </DialogFooter>
    </>
  );
}

export default NudgeDialog;
