import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Loader2, Mic, PenLine, Pencil, Square, Trash2, Upload } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { uploadMeetingAudio } from '@/shared/api/client';
import { toast } from '@/shared/components/Toast';
import { useLocalDraft } from '@/shared/hooks/useLocalDraft';
import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import { Textarea } from '@/ui/textarea';
import {
  asrKeys,
  useAsrAddRecording,
  useAsrDeleteRecording,
  useAsrRecordings,
  useAsrUpdateRecording,
} from './api';
import {
  ASR_MAX_RECORDINGS,
  isAsrRecordingPending,
  type AsrRecording,
} from './types';

/**
 * Талбайн дуу бичлэг → текст.
 *
 * Талбай дээр бээлийтэй, шаттай, шуургатай инженер бичиж чаддаггүй.
 * Ярьж бичүүлээд, Speechmatics текст болгож, инженер тэр текстээ
 * «Тайлбар» руу ӨӨРӨӨ оруулна.  (Багийн «Ажлын тайлан» руу оруулах чип
 * 2026-09-28-нд хасагдсан — тэр талбар засварлагчаас алга болсон тул
 * текст үл харагдах газар орох байсан.)
 *
 * ⚠️ Аудио нь `uploadMeetingAudio()`-оор PRIVATE `MEETING_BUCKET` руу очно.
 *    `uploadFile()` (public `/media`) ХЭРЭГЛЭЖ БОЛОХГҮЙ — `/media/:key` нь
 *    баталгаажуулалтгүй, түлхүүрээ мэдсэн хэн ч уншина.  Клиент нь
 *    түлхүүрээс өөр юу ч авдаггүй; транскрипт л буцаж ирнэ.
 *
 * ⚠️ ТРАНСКРИПТИЙГ АВТОМАТААР ТЕКСТ ТАЛБАР РУУ ХИЙХГҮЙ.  Хүний хэлснийг
 *    зөвшөөрөлгүй тайлан руу шургуулах нь албан баримт дээр буруу — «Оруулах»
 *    товчийг хүн өөрөө дарна.  Оруулсны дараа тэр талбар дээрх
 *    `PolishableTextarea`-ийн «Сайжруулах» AI-аар цэгцлэх боломж нээлттэй.
 *
 * ⚠️ ГАРААР ЗАСАХ (2026-08-21).  Speechmatics нь талбайн чимээ, барилгын нэр
 *    томьёо, овог нэрийг тогтмол буруу сонсдог тул текст дээр дарахад тэр нь
 *    `Textarea` болж, `PATCH /:id/recordings/:recId`-аар СЕРВЕРТ хадгалагдана.
 *    Транскрипц бүтэлгүйтсэн мөр дээр ч ажиллах тул «дууг сонсоод гараар
 *    бичих» зам ч энэ мөн.  AI товч энд ЗОРИУДААР БАЙХГҮЙ — түүхий яриаг
 *    засах нь хүний ажил; цэгцлэх бол «Тайлбар» руу оруулсны дараа тэнд
 *    байгаа «Сайжруулах».
 *
 * ⚠️ Хадгалагдаагүй засварыг АЛДАХГҮЙ.  `useLocalDraft` нь бичилт бүрийг
 *    localStorage руу (500мс debounce, таб нуугдахад flush) толиндог тул
 *    талбай дээр сүлжээ унасан, эсвэл камер асаахад iOS таб-ыг хаасан ч
 *    текст үлдэж, мөр нь «хадгалагдаагүй» гэж сануулж дахин илгээх товч
 *    гаргана.  Энэ бол `AsrEditorShell`-ийн маягтын хоёр давхар
 *    хамгаалалтын яг тэр загвар.
 *
 * ⚠️ Push-to-talk (олон сегмент → нэг бүтэн audio) нь ЭНЭ файлыг тэлж
 *    хийгдэнэ: `MediaRecorder`-ийг `pause()`/`resume()` хийвэл НЭГ бүтэн
 *    контейнер гарах тул `stop()`-ийн үеийн `finishUpload` зам огт
 *    өөрчлөгдөхгүй.  Тиймээс бичих/байршуулах логикийг доор
 *    ЗОРИУДААР салгасан.
 */

/** Хөтөч дээр бичих үеийн давуу дараалал.  Эхний дэмжигдсэнийг сонгоно. */
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4', // Safari
  'audio/ogg;codecs=opus',
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
}

/**
 * Нэг бичлэгийн ХАДГАЛАГДААГҮЙ транскрипт засварын localStorage түлхүүр.
 * `recordingId`-аар (тайлангийн id-аар БИШ) — нэг тайланд 20 хүртэл бичлэг
 * байх бөгөөд тус бүр нь бие даасан засвартай.
 */
const asrTranscriptDraftKey = (recordingId: number) =>
  `mgl:asr-rec-draft:${recordingId}`;

function fmtDuration(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return '—';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export interface AsrRecorderProps {
  reportId: number;
  /** Дэлгэрэнгүй хариунаас ирсэн анхны жагсаалт (poll эхлэхээс өмнөх утга). */
  initial?: AsrRecording[];
  readOnly: boolean;
  /** «Тайлбар» руу нэмэх. */
  onAppendDescription: (text: string) => void;
  /**
   * Оруулах товчны шошго — өгөөгүй бол «Тайлбар».  Оффис уулзалтад транскрипт
   * «Уулзалтын агуулга» руу ордог (0367).
   */
  appendLabel?: string;
}

export function AsrRecorder({
  reportId,
  initial,
  readOnly,
  onAppendDescription,
  appendLabel,
}: AsrRecorderProps) {
  const { t } = useLanguage();
  const qc = useQueryClient();

  const { data } = useAsrRecordings(reportId, initial);
  const recordings = data?.recordings ?? [];

  const add = useAsrAddRecording();
  const del = useAsrDeleteRecording();
  const upd = useAsrUpdateRecording();

  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  /** Микрофоны track-уудыг заавал хаана — эс бөгөөс утсан дээр улаан
   *  бичиж буй заагч үлдэж, батарей иддэг. */
  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  }, []);

  // Компонент unmount болоход (Sheet хаагдах) микрофоныг заавал салгана.
  useEffect(() => () => stopStream(), [stopStream]);

  // Бичиж байх хугацааны тоолуур.
  useEffect(() => {
    if (!recording) return;
    const id = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => window.clearInterval(id);
  }, [recording]);

  const refresh = useCallback(
    (next: AsrRecording[]) => {
      qc.setQueryData(asrKeys.recordings(reportId), { recordings: next });
      // Дэлгэрэнгүй хариу ч `recordings`-ыг агуулдаг тул хамт хуучирна.
      void qc.invalidateQueries({ queryKey: asrKeys.one(reportId) });
    },
    [qc, reportId],
  );

  /**
   * Байршуулах → тайланд хавсаргах → STT-д илгээх.
   *
   * Бичсэн Blob болон сонгосон файл ХОЁУЛАА энэ замаар ордог, мөн
   * push-to-talk-ийн эцсийн нэг бүтэн Blob ч ирээдүйд ЭНД ирнэ.
   */
  const finishUpload = useCallback(
    async (file: File, durationSeconds?: number) => {
      if (recordings.length >= ASR_MAX_RECORDINGS) {
        toast.error(t('asr.recordingLimit', { max: ASR_MAX_RECORDINGS }));
        return;
      }
      setBusy(true);
      try {
        const audioKey = await uploadMeetingAudio(file);
        const res = await add.mutateAsync({
          id: reportId,
          audio_key: audioKey,
          content_type: file.type || undefined,
          size_bytes: file.size,
          duration_seconds: durationSeconds,
          sort_order: recordings.length,
        });
        refresh(res.recordings);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('asr.recordingUploadFailed'));
      } finally {
        setBusy(false);
      }
    },
    [add, recordings.length, refresh, reportId, t],
  );

  const startRecording = async () => {
    setMicError(null);
    const mimeType = pickMimeType();
    if (!navigator.mediaDevices?.getUserMedia || mimeType === undefined) {
      // Хөтөч дэмжихгүй бол бичих товч нуугдана, гэхдээ файл сонгох зам
      // хэвээр ажиллана — тиймээс энэ бол мухардал биш.
      setMicError(t('asr.recorderUnsupported'));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const rec = new MediaRecorder(stream, { mimeType });
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        chunksRef.current = [];
        stopStream();
        // `elapsed` нь секундын нарийвчлалтай таамаг — сервер дуусахад
        // Speechmatics-ийн бодит үргэлжлэх хугацаагаар дарж бичнэ.
        const seconds = elapsed;
        const ext = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
        void finishUpload(new File([blob], `asr-${reportId}-${Date.now()}.${ext}`, { type: mimeType }), seconds);
      };
      mediaRef.current = rec;
      setElapsed(0);
      rec.start();
      setRecording(true);
    } catch {
      stopStream();
      setMicError(t('asr.micDenied'));
    }
  };

  const stopRecording = () => {
    setRecording(false);
    mediaRef.current?.stop();
    mediaRef.current = null;
  };

  const onDelete = async (recordingId: number) => {
    setBusy(true);
    try {
      const res = await del.mutateAsync({ id: reportId, recordingId });
      // Мөр алга болсон тул түүний хадгалагдаагүй засвар ч утгагүй —
      // localStorage-д өнчин түлхүүр үлдээхгүй.
      try {
        localStorage.removeItem(asrTranscriptDraftKey(recordingId));
      } catch {
        /* private mode — ноорог бол нэмэлт хамгаалалт, урсгалыг зогсоохгүй */
      }
      refresh(res.recordings);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('asr.recordingDeleteFailed'));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Гараар засварласан транскриптийг серверт бичих.
   *
   * ЗОРИУДААР `throw` хийнэ — дуудагч мөр нь алдааг барьж, текстээ
   * `Textarea` дотор нь үлдээж, «хадгалагдаагүй» төлөв рүү шилжинэ.
   * Энд `toast` дуудвал мөр амжилттай гэж андуурна.
   */
  const saveTranscript = useCallback(
    async (recordingId: number, text: string) => {
      const res = await upd.mutateAsync({ id: reportId, recordingId, transcript_text: text });
      refresh(res.recordings);
    },
    [upd, refresh, reportId],
  );

  const canRecord = typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  const atLimit = recordings.length >= ASR_MAX_RECORDINGS;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t('asr.recordingsHint')}</p>

      {recordings.length > 0 && (
        <div className="space-y-2">
          {recordings.map((r, i) => (
            <RecordingRow
              /*
               * ⚠️ Түлхүүрт `readOnly` ЗААВАЛ орно.  `RecordingRow` нь
               * `useLocalDraft(readOnly ? null : …)`, `unsaved`, `draft`
               * гурвыг БҮГДИЙГ нь `useState`-ийн эхлүүлэгчид, өөрөөр
               * хэлбэл ЗӨВХӨН mount дээр уншдаг.  Админ батлагдсан
               * тайлангийн цоожийг «Засварлах»-аар тайлахад `readOnly`
               * true→false болох ба mount дахин болохгүй тул транскриптийн
               * локал ноорог хэзээ ч сэргэхгүй, «хадгалагдаагүй» баннер
               * хуучин төлөвтэйгөө үлдэнэ.  Түлхүүрийг сольж дахин mount
               * хийлгэнэ — энэ нь зөвхөн цоож тайлах агшинд болно.
               */
              key={`${r.id}:${readOnly ? 'ro' : 'rw'}`}
              index={i + 1}
              rec={r}
              readOnly={readOnly}
              busy={busy}
              onDelete={() => void onDelete(r.id)}
              onSaveTranscript={saveTranscript}
              onAppendDescription={onAppendDescription}
              appendLabel={appendLabel}
            />
          ))}
        </div>
      )}

      {!readOnly && (
        <>
          {micError && (
            <p className="flex items-start gap-1.5 text-xs text-danger">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{micError}</span>
            </p>
          )}
          <div className="flex gap-2">
            {canRecord &&
              (recording ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="flex-1 gap-2"
                  onClick={stopRecording}
                >
                  <Square className="h-4 w-4" />
                  {t('asr.recordStop')} · <span className="tabular-nums">{fmtDuration(elapsed)}</span>
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1 gap-2"
                  disabled={busy || atLimit}
                  onClick={() => void startRecording()}
                >
                  <Mic className="h-4 w-4" /> {t('asr.recordStart')}
                </Button>
              ))}

            <label className="flex-1">
              {/* Утсанд бичих боломжгүй хөтөч дээр (эсвэл өмнө нь бичсэн
                  файлтай бол) файл сонгох зам үргэлж нээлттэй. */}
              <input
                type="file"
                accept="audio/*,video/mp4"
                className="hidden"
                disabled={busy || recording || atLimit}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void finishUpload(f);
                }}
              />
              <span
                className={
                  'inline-flex h-8 w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-border bg-background px-3 text-sm ' +
                  (busy || recording || atLimit ? 'pointer-events-none opacity-50' : 'hover:bg-accent')
                }
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {t('asr.recordUpload')}
              </span>
            </label>
          </div>
          {atLimit && (
            <p className="text-xs text-muted-foreground">
              {t('asr.recordingLimit', { max: ASR_MAX_RECORDINGS })}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Нэг бичлэгийн мөр — үргэлжлэх хугацаа, төлөв, транскрипт, «Оруулах» чипүүд.
 *
 * Транскрипт нь ДАРЖ ЗАСАГДАНА (`editing`).  Гурван эх сурвалж нэг текст рүү
 * нийлдэг тул дарааллыг санаж байх хэрэгтэй:
 *   1. `serverText` — D1 дэх утга (Speechmatics эсвэл өмнөх засвар);
 *   2. `unsaved`    — серверт ХҮРЭЭГҮЙ засвар (сүлжээ унасан / таб хаагдсан),
 *                     localStorage-оос mount дээр уншигдана;
 *   3. `draft`      — яг одоо `Textarea` дотор бичигдэж буй утга.
 *
 * Уншихад харагдах текст нь ҮРГЭЛЖ `unsaved ?? serverText` — өөрөөр хэлбэл
 * хүний хамгийн сүүлд бичсэн үг сервер дээрх хуучин хувилбарт хэзээ ч
 * дарагдахгүй.
 */
function RecordingRow({
  index,
  rec,
  readOnly,
  busy,
  onDelete,
  onSaveTranscript,
  onAppendDescription,
  appendLabel,
}: {
  index: number;
  rec: AsrRecording;
  readOnly: boolean;
  busy: boolean;
  onDelete: () => void;
  /** Амжилтгүй бол `throw` хийнэ — мөр нь текстээ алдалгүй барина. */
  onSaveTranscript: (recordingId: number, text: string) => Promise<void>;
  onAppendDescription: (text: string) => void;
  appendLabel?: string;
}) {
  const { t } = useLanguage();
  const pending = isAsrRecordingPending(rec);
  const failed = rec.stt_status === 'error' || rec.stt_status === 'fetch_error' || rec.stt_status === 'trim_error';
  const serverText = (rec.transcript_text ?? '').trim();

  // Уншиж буй тайлан дээр ноорог хадгалах утгагүй — `null` түлхүүр нь
  // `useLocalDraft`-ыг бүхэлд нь идэвхгүй болгоно.
  const { saved: localDraft, persist, clear } = useLocalDraft<string>(
    readOnly ? null : asrTranscriptDraftKey(rec.id),
  );

  const [unsaved, setUnsaved] = useState<string | null>(() =>
    !readOnly && localDraft != null && localDraft.trim() !== serverText ? localDraft : null,
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => unsaved ?? serverText);
  const [saving, setSaving] = useState(false);

  // Poll дуусаад транскрипт ирэхэд (эсвэл өөр таб дээр засагдахад) харагдах
  // текстийг шинэчилнэ — ГЭХДЭЭ бичиж байх үед болон хадгалагдаагүй засвар
  // байхад ХЭЗЭЭ Ч БИШ, эс бөгөөс хүний үг гар доороос нь солигдоно.
  const syncedRef = useRef(serverText);
  useEffect(() => {
    if (serverText === syncedRef.current) return;
    syncedRef.current = serverText;
    if (editing || unsaved != null) return;
    setDraft(serverText);
  }, [serverText, editing, unsaved]);

  /** Уншихад харагдах — мөн «Оруулах» товчийн илгээх текст. */
  const shownText = unsaved ?? serverText;

  const startEdit = () => {
    if (readOnly) return;
    setDraft(unsaved ?? serverText);
    setEditing(true);
  };

  const onDraftChange = (next: string) => {
    setDraft(next);
    // Бичилт бүр localStorage руу (500мс debounce).  Сүлжээнээс ҮЛ ХАМААРНА.
    persist(next);
  };

  const doSave = async () => {
    if (saving) return;
    const next = draft.trim();
    setSaving(true);
    try {
      await onSaveTranscript(rec.id, next);
      // Сервер эзэмшлээ авсан тул локал хуулбар илүүц.
      clear();
      setUnsaved(null);
      setEditing(false);
      // `refresh()` шинэ текстийг query-д тавихад дээрх effect дахин
      // ажиллах шаардлагагүй — бид аль хэдийн энэ утган дээр байна.
      syncedRef.current = next;
      setDraft(next);
    } catch (err) {
      // Сүлжээ унасан.  Мөрийг «хадгалагдаагүй» болгож, дахин оролдох
      // товчийг нээлттэй үлдээнэ.  `persist` нь давхардсан мэт харагдавч
      // заавал: хүн бичээд 500мс-ийн debounce дуусахаас өмнө «Хадгалах»
      // дарвал localStorage-д хуучин утга байх бөгөөд дараагийн mount
      // дээр `unsaved` нь тайрагдаагүй хувилбараар сэргэнэ.
      persist(next);
      setUnsaved(next);
      toast.error(err instanceof Error ? err.message : t('asr.transcriptSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const doCancel = () => {
    setEditing(false);
    if (unsaved != null) {
      // «Болих» нь ЭНЭ удаагийн бичилтийг л буцаана — өмнө нь сүлжээнд
      // саатсан текстийг устгах эрх зөвхөн «Хаях» товчид байна.
      setDraft(unsaved);
      persist(unsaved);
    } else {
      setDraft(serverText);
      clear();
    }
  };

  const doDiscard = () => {
    clear();
    setUnsaved(null);
    setEditing(false);
    setDraft(serverText);
  };

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">
          {t('asr.recordingN', { n: index })}
        </span>
        <span className="tabular-nums">{fmtDuration(rec.duration_seconds)}</span>
        {pending && (
          <span className="inline-flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t('asr.transcribing')}
          </span>
        )}
        {failed && <span className="text-danger">{t('asr.transcribeFailed')}</span>}
        {!readOnly && (
          <button
            type="button"
            aria-label={t('asr.recordingDelete')}
            title={t('asr.recordingDelete')}
            disabled={busy || saving}
            onClick={onDelete}
            className="ml-auto rounded-md p-1 text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Алдааны бодит текстийг харуулна — «дахин оролдоно уу» гэдэг нь
          талбай дээрх хүнд юу ч хэлэхгүй (жишээ нь дуу хоосон байсан уу,
          эсвэл түлхүүр буруу байсан уу).  Гараар бичсэний дараа энэ нь
          зөвхөн чимээ тул нуугдана. */}
      {failed && rec.error && !shownText && (
        <p className="break-words text-xs text-danger">{rec.error}</p>
      )}

      {editing ? (
        <div className="space-y-2">
          <Textarea
            autoFocus
            rows={4}
            className="text-sm"
            value={draft}
            disabled={saving}
            placeholder={t('asr.transcriptPlaceholder')}
            onChange={(e) => onDraftChange(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="gap-1.5"
              disabled={saving}
              onClick={() => void doSave()}
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              {t('common.save')}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={doCancel}>
              {t('common.cancel')}
            </Button>
            {unsaved != null && (
              <span className="inline-flex items-center gap-1 text-xs text-warning">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {t('asr.transcriptUnsaved')}
              </span>
            )}
          </div>
        </div>
      ) : shownText ? (
        /* Бүтэн мөр нь товч — талбай дээр бээлийтэй хуруунд жижиг
           «харандаа» дүрс дангаараа хэтэрхий нарийн байна. */
        <button
          type="button"
          disabled={readOnly}
          onClick={startEdit}
          title={readOnly ? undefined : t('asr.transcriptEditHint')}
          className={
            'group block w-full rounded-md bg-muted/40 p-2 text-left text-sm transition-colors ' +
            (readOnly ? 'cursor-default' : 'hover:bg-muted/70')
          }
        >
          <span className="whitespace-pre-wrap break-words">{shownText}</span>
          {!readOnly && (
            <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground opacity-70 transition-opacity group-hover:opacity-100">
              <Pencil className="h-3 w-3" />
              {t('asr.transcriptEditHint')}
            </span>
          )}
        </button>
      ) : (
        // Текст ХООСОН.  Транскрипц явж байвал юу ч гаргахгүй (дээр «Текст
        // болгож байна…» гэж байгаа); дууссан эсвэл бүтэлгүйтсэн бол
        // «дууг сонсоод гараар бичих» зам нээгдэнэ.
        !readOnly &&
        !pending && (
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={startEdit}>
            <PenLine className="h-3.5 w-3.5" />
            {t('asr.transcriptManual')}
          </Button>
        )
      )}

      {/* ⚠️ Баннер нь `shownText` салаанаас ГАДНА байх ЁСТОЙ.  Офлайн үед
          текстээ бүрэн хоослосон бол `unsaved === ''` бөгөөд `''` нь falsy
          тул дээрх ternary «Гараар бичих» руу унана — баннер дотор нь байсан
          бол хоослосон засварыг серверт илгээх зам үлдэхгүй байсан. */}
      {unsaved != null && !editing && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
          <span className="min-w-0 flex-1">{t('asr.transcriptUnsaved')}</span>
          <button
            type="button"
            disabled={saving}
            onClick={() => void doSave()}
            className="rounded-full border border-warning/40 px-2 py-0.5 font-medium transition-colors hover:bg-warning/20 disabled:opacity-50"
          >
            {saving ? t('asr.transcriptSaving') : t('common.save')}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={doDiscard}
            className="rounded-full px-2 py-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            {t('asr.transcriptDiscard')}
          </button>
        </div>
      )}

      {/* Хүн ӨӨРӨӨ дарж оруулна — транскриптийг автоматаар тайлан руу
          шургуулахгүй гэсэн зарчим хэвээр.  Илгээгдэх текст нь `shownText`,
          өөрөөр хэлбэл хадгалагдаагүй засвар байвал ТЭР — сүлжээ унасан
          гэдэг нь тайлангаа бөглөж чадахгүй гэсэн үг биш. */}
      {!editing && !readOnly && shownText.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{t('asr.insertInto')}:</span>
          <button
            type="button"
            onClick={() => onAppendDescription(shownText)}
            className="rounded-full border px-2 py-0.5 text-xs transition-colors hover:border-primary/40 hover:bg-primary/5"
          >
            {appendLabel ?? t('asr.description')}
          </button>
        </div>
      )}

    </div>
  );
}
