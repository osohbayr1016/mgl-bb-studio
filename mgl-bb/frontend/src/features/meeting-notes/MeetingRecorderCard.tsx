import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Mic, Pause, Play, RefreshCw, Square, Trash2, Upload } from 'lucide-react';
import { apiFetch, uploadMeetingAudio } from '@/shared/api/client';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { toast } from '@/shared/components/Toast';
import { useMediaRecorder } from '@/shared/hooks/useMediaRecorder';
import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { TranscribeProgress } from './TranscribeProgress';

/**
 * Хурлын дуу бичлэг — хөтчийн микрофоноор бичих / файл оруулах, дараа нь
 * `POST /meetings/:id/audio`-оор хавсаргаж Speechmatics-д илгээнэ.
 *
 * ⚠️ Аудио `uploadMeetingAudio()`-оор PRIVATE `MEETING_BUCKET` руу очно —
 *    `/media` (нийтийн) руу ХЭЗЭЭ Ч биш.  Тоглуулах нь гарын үсэгтэй
 *    `audio_url` (purpose:'stt-audio' JWT).
 *
 * Бичлэгийн явцад хуудсаас гарахыг `beforeunload`-аар анхааруулна —
 * 1–2 цагийн бичлэг санах ойд л байдаг тул таб хаагдвал алдагдана.
 */
function fmt(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

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

export function MeetingRecorderCard({
  meetingId,
  status,
  language,
  recording,
  audioUrl,
  autoStart,
  onAutoStartConsumed,
}: {
  meetingId: number;
  status: string;
  language: string;
  recording: {
    duration_seconds: number | null;
    content_type: string | null;
    stt_status: string | null;
    submitted_at: string | null;
  } | null;
  audioUrl: string | null;
  /** `?record=1` — хуудас нээгдмэгц бичлэг эхлүүлнэ (нэг удаа). */
  autoStart: boolean;
  onAutoStartConsumed: () => void;
}) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const rec = useMediaRecorder();
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const autoStartedRef = useRef(false);

  const busyServer = status === 'transcribing' || status === 'analyzing';
  const hasRecording = !!recording;
  const isRecording = rec.state !== 'idle';

  const attach = useMutation({
    mutationFn: async ({ file, durationSeconds }: { file: File; durationSeconds?: number | null }) => {
      setUploading(true);
      setProgress(0);
      const duration = durationSeconds ?? (await getAudioDuration(file));
      const key = await uploadMeetingAudio(file, {
        onProgress: (p) => setProgress(Math.round(p.pct)),
      });
      return apiFetch<{ meetingId: number; status: string; error?: string }>(`/meetings/${meetingId}/audio`, {
        method: 'POST',
        data: {
          audio_key: key,
          content_type: file.type || undefined,
          size_bytes: file.size,
          duration_seconds: duration ?? undefined,
          language,
        },
      });
    },
    onSuccess: (res) => {
      if (res.status === 'transcribe_failed') toast.warn(t('meetingNotes.transcribeFailedHint'), res.error);
      else toast.success(t('meetingNotes.recordingAttached'));
      qc.invalidateQueries({ queryKey: ['meeting', meetingId] });
      qc.invalidateQueries({ queryKey: ['meetings'] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t('meetingNotes.uploadFailed')),
    onSettled: () => {
      setUploading(false);
      setProgress(0);
    },
  });

  // ?record=1 → нэг удаа автоматаар эхлүүлнэ (микрофоны зөвшөөрөл асууна).
  useEffect(() => {
    if (!autoStart || autoStartedRef.current || hasRecording || !rec.supported) return;
    autoStartedRef.current = true;
    onAutoStartConsumed();
    void rec.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, hasRecording, rec.supported]);

  // Бичиж байхад таб хаах/шинэчлэхийг анхааруулна.
  useEffect(() => {
    if (!isRecording) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [isRecording]);

  const confirmReplace = async () =>
    !hasRecording || (await confirmDialog({ description: t('meetingNotes.confirmReplaceRecording'), variant: 'destructive' }));

  const startRecording = async () => {
    if (!(await confirmReplace())) return;
    const ok = await rec.start();
    if (!ok) toast.error(rec.error === 'denied' ? t('meetingNotes.micDenied') : t('meetingNotes.recorderUnsupported'));
  };

  const stopRecording = async () => {
    const result = await rec.stop();
    if (!result) {
      toast.warn(t('meetingNotes.recordingEmpty'));
      return;
    }
    attach.mutate({
      file: result.file(`meeting-${meetingId}-${Date.now()}`),
      durationSeconds: result.durationSeconds || null,
    });
  };

  const discardRecording = async () => {
    if (await confirmDialog({ description: t('meetingNotes.confirmDiscardRecording'), variant: 'destructive' })) {
      rec.discard();
    }
  };

  const onPickFile = async (f: File | null) => {
    if (!f) return;
    if (!(await confirmReplace())) return;
    attach.mutate({ file: f });
  };

  return (
    <Card data-testid="meeting-recorder-card">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Mic className="h-4 w-4 text-primary" /> {t('meetingNotes.recordingTitle')}
          {recording?.duration_seconds ? (
            <span className="text-xs font-normal text-muted-foreground tabular-nums">
              · {fmt(recording.duration_seconds)}
            </span>
          ) : null}
        </CardTitle>
        {isRecording && (
          <span className="flex items-center gap-2 text-sm tabular-nums" data-testid="meeting-recording-timer">
            <span
              className={
                'inline-block h-2.5 w-2.5 rounded-full bg-destructive ' +
                (rec.state === 'recording' ? 'animate-pulse' : 'opacity-40')
              }
            />
            {rec.state === 'paused' ? t('meetingNotes.recordingPaused') : t('meetingNotes.recordingLive')} · {fmt(rec.elapsed)}
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {audioUrl && !isRecording && (
          <audio controls preload="none" src={audioUrl} className="w-full">
            {t('meetingNotes.audioUnsupported')}
          </audio>
        )}

        {uploading && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{progress > 0 && progress < 100 ? t('meetingNotes.uploading', { pct: progress }) : t('meetingNotes.submitting')}</span>
            </div>
            <div className="h-1.5 w-full rounded bg-muted overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${Math.max(progress, 4)}%` }} />
            </div>
          </div>
        )}

        {status === 'transcribing' && !uploading && (
          <TranscribeProgress
            startedAt={recording?.submitted_at}
            estimateSeconds={recording?.duration_seconds}
            label={t('meetingNotes.transcribingHint')}
          />
        )}

        {!hasRecording && !isRecording && !uploading && (
          <p className="text-sm text-muted-foreground">{t('meetingNotes.noRecordingYet')}</p>
        )}

        {!rec.supported && !isRecording && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{t('meetingNotes.recorderUnsupported')}</span>
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {isRecording ? (
            <>
              <Button type="button" variant="destructive" size="sm" onClick={() => void stopRecording()} data-testid="meeting-record-stop">
                <Square className="h-4 w-4 mr-2" /> {t('meetingNotes.recordStopAndTranscribe')}
              </Button>
              {rec.state === 'recording' ? (
                <Button type="button" variant="outline" size="sm" onClick={rec.pause}>
                  <Pause className="h-4 w-4 mr-2" /> {t('meetingNotes.recordPause')}
                </Button>
              ) : (
                <Button type="button" variant="outline" size="sm" onClick={rec.resume}>
                  <Play className="h-4 w-4 mr-2" /> {t('meetingNotes.recordResume')}
                </Button>
              )}
              <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => void discardRecording()}>
                <Trash2 className="h-4 w-4 mr-2" /> {t('meetingNotes.recordDiscard')}
              </Button>
            </>
          ) : (
            <>
              {rec.supported && (
                <Button
                  type="button"
                  variant={hasRecording ? 'outline' : 'default'}
                  size="sm"
                  disabled={uploading || busyServer}
                  onClick={() => void startRecording()}
                  data-testid="meeting-record-start"
                >
                  {hasRecording ? <RefreshCw className="h-4 w-4 mr-2" /> : <Mic className="h-4 w-4 mr-2" />}
                  {hasRecording ? t('meetingNotes.recordAgain') : t('meetingNotes.recordStart')}
                </Button>
              )}
              <label>
                <input
                  type="file"
                  accept="audio/*,.m4a,.mp3,.wav,.mp4,.ogg,.flac,.aac"
                  className="hidden"
                  disabled={uploading || busyServer}
                  data-testid="meeting-audio-file"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    e.target.value = '';
                    void onPickFile(f);
                  }}
                />
                <span
                  className={
                    'inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 text-sm ' +
                    (uploading || busyServer ? 'pointer-events-none opacity-50' : 'hover:bg-accent')
                  }
                >
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {hasRecording ? t('meetingNotes.replaceFile') : t('meetingNotes.uploadFile')}
                </span>
              </label>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
