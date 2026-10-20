import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, uploadMeetingAudio } from '@/shared/api/client';
import { useLanguage } from '@/shared/i18n';
import { isMediaRecorderSupported } from '@/shared/hooks/useMediaRecorder';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/ui/button';
import { Label } from '@/ui/label';
import { Input } from '@/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/ui/dialog';
import { Plus, Upload, Loader2, Mic, FileAudio, PenLine } from 'lucide-react';
import { MeetingMetaForm } from './MeetingMetaForm';
import { meetingDetailPath, COMPANY_MEETINGS } from './MeetingProjectWorkspace';
import { EMPTY_META, type MeetingMeta, type MeetingProjectRef } from './types';

/**
 * «Шинэ хурал» dialog.  Хурлыг ЭХЛЭЭД үүсгээд (metadata), дуу бичлэгийг
 * гурван замын аль нэгээр авна:
 *   - `record` — үүсгэсний дараа дэлгэрэнгүй хуудас руу `?record=1`-ээр
 *     шилжиж хөтчийн микрофоноор бичлэг ЭХЭЛНЭ (MeetingRecorderCard);
 *   - `file`   — бэлэн файлыг байршуулж POST /meetings-д хамт өгнө (хуучин урсгал);
 *   - `none`   — бичлэггүй (тэмдэглэлийг гараар бичнэ / дараа хавсаргана).
 * Бүх зам `status='draft'`-аас эхэлдэг тул хурал бичлэггүй ч оршин байна.
 */
type AudioSource = 'record' | 'file' | 'none';

function getAudioDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const audio = document.createElement('audio');
      audio.preload = 'metadata';
      const done = (v: number | null) => {
        URL.revokeObjectURL(url);
        resolve(v);
      };
      audio.onloadedmetadata = () =>
        done(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null);
      audio.onerror = () => done(null);
      audio.src = url;
    } catch {
      resolve(null);
    }
  });
}

/** Meta → POST /meetings body (metadata хэсэг). */
function metaToPayload(meta: MeetingMeta) {
  return {
    title: meta.title.trim(),
    meeting_date: meta.meeting_date || undefined,
    meeting_time: meta.meeting_time || undefined,
    location: meta.location || undefined,
    purpose: meta.purpose || undefined,
    conclusion: meta.conclusion || undefined,
    participants: meta.participants,
    discussion: meta.discussion,
    next_meeting_date: meta.next_meeting_date || undefined,
    next_meeting_time: meta.next_meeting_time || undefined,
    kind: meta.kind,
    project_ids: meta.kind === 'company' ? [] : meta.project_ids,
    language: meta.language,
  };
}

export function UploadMeetingDialog({
  defaultProjectId = null,
  defaultKind = 'project',
}: {
  defaultProjectId?: number | null;
  /** Компанийн хурлын жагсаалтаас нээхэд `company` — төслийн сонгогч нуугдана. */
  defaultKind?: MeetingMeta['kind'];
}) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [meta, setMeta] = useState<MeetingMeta>(EMPTY_META);
  const [source, setSource] = useState<AudioSource>(() => (isMediaRecorderSupported() ? 'record' : 'file'));
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const canRecord = isMediaRecorderSupported();

  const projectsQuery = useQuery({
    queryKey: ['projects-min'],
    queryFn: () => apiFetch<{ projects: MeetingProjectRef[] }>('/projects'),
    enabled: open,
  });

  // Нээгдэх бүрд хаанаас нээгдсэнээ (төслийн/компанийн жагсаалт) урьдчилан
  // бөглөнө — effect биш, нээх үйлдэл дээр шууд (react-hooks/set-state-in-effect).
  const initialMeta = (): MeetingMeta => ({
    ...EMPTY_META,
    kind: defaultKind,
    project_ids: defaultKind === 'company' ? [] : defaultProjectId != null ? [defaultProjectId] : [],
  });

  const patch = (p: Partial<MeetingMeta>) => setMeta((m) => ({ ...m, ...p }));
  const reset = () => {
    setMeta(EMPTY_META);
    setFile(null);
    setProgress(0);
  };

  const projectParamFor = (m: MeetingMeta): string | null =>
    m.kind === 'company' ? COMPANY_MEETINGS : m.project_ids[0] != null ? String(m.project_ids[0]) : null;

  const mutation = useMutation({
    mutationFn: async () => {
      const base = metaToPayload(meta);
      if (source === 'file') {
        if (!file) throw new Error(t('meetingNotes.pickFile'));
        const duration = await getAudioDuration(file);
        const key = await uploadMeetingAudio(file, {
          onProgress: (p) => setProgress(Math.round(p.pct)),
        });
        return apiFetch<{ meetingId: number; status: string; error?: string }>('/meetings', {
          data: {
            ...base,
            audio_key: key,
            content_type: file.type || undefined,
            size_bytes: file.size,
            duration_seconds: duration ?? undefined,
          },
        });
      }
      return apiFetch<{ meetingId: number; status: string; error?: string }>('/meetings', {
        data: base,
      });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['meetings'] });
      const path = meetingDetailPath(res.meetingId, projectParamFor(meta));
      const snapshotSource = source;
      setOpen(false);
      reset();
      navigate(snapshotSource === 'record' ? `${path}${path.includes('?') ? '&' : '?'}record=1` : path);
    },
  });

  const busy = mutation.isPending;
  const metaValid = !!meta.title.trim() && (meta.kind === 'company' || meta.project_ids.length > 0);
  const canSubmit = metaValid && (source !== 'file' || !!file) && !busy;

  const sources: Array<{ key: AudioSource; icon: typeof Mic; label: string; hint: string; disabled?: boolean }> = [
    {
      key: 'record',
      icon: Mic,
      label: t('meetingNotes.sourceRecord'),
      hint: canRecord ? t('meetingNotes.sourceRecordHint') : t('meetingNotes.recorderUnsupported'),
      disabled: !canRecord,
    },
    { key: 'file', icon: FileAudio, label: t('meetingNotes.sourceFile'), hint: t('meetingNotes.audioHint') },
    { key: 'none', icon: PenLine, label: t('meetingNotes.sourceNone'), hint: t('meetingNotes.sourceNoneHint') },
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!busy) {
          setOpen(o);
          if (o) setMeta(initialMeta());
          else reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" data-testid="meeting-create-open">
          <Plus className="h-4 w-4 mr-2" /> {t('meetingNotes.newMeeting')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('meetingNotes.newMeeting')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <MeetingMetaForm value={meta} onPatch={patch} projects={projectsQuery.data?.projects ?? []} />

          <div className="space-y-2">
            <Label>{t('meetingNotes.audioSource')}</Label>
            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
              {sources.map((s) => {
                const Icon = s.icon;
                const active = source === s.key;
                return (
                  <button
                    key={s.key}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={s.disabled || busy}
                    onClick={() => setSource(s.key)}
                    data-testid={`meeting-source-${s.key}`}
                    className={cn(
                      'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors',
                      active ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/40',
                      s.disabled && 'opacity-50 cursor-not-allowed',
                    )}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <Icon className={cn('h-4 w-4', active ? 'text-primary' : 'text-muted-foreground')} />
                      {s.label}
                    </span>
                    <span className="text-xs text-muted-foreground leading-snug">{s.hint}</span>
                  </button>
                );
              })}
            </div>
            {source === 'file' && (
              <Input
                type="file"
                accept="audio/*,.m4a,.mp3,.wav,.mp4,.ogg,.flac,.aac"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            )}
          </div>

          {busy && progress > 0 && progress < 100 && (
            <div className="h-1.5 w-full rounded bg-muted overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}

          {mutation.isError && (
            <p className="text-sm text-destructive">
              {mutation.error instanceof Error ? mutation.error.message : t('meetingNotes.uploadFailed')}
            </p>
          )}

          <Button
            className="w-full"
            onClick={() => mutation.mutate()}
            disabled={!canSubmit}
            data-testid="meeting-create-submit"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : source === 'record' ? (
              <Mic className="h-4 w-4 mr-2" />
            ) : source === 'file' ? (
              <Upload className="h-4 w-4 mr-2" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            {busy && progress > 0 && progress < 100
              ? t('meetingNotes.uploading', { pct: progress })
              : busy
                ? t('meetingNotes.submitting')
                : source === 'record'
                  ? t('meetingNotes.createAndRecord')
                  : source === 'file'
                    ? t('meetingNotes.startTranscription')
                    : t('meetingNotes.createMeeting')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
