import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Хөтчийн микрофоноор дуу бичих (`MediaRecorder`) — нэг бүтэн Blob болгож
 * буцаана.  `features/projects/asr/AsrRecorder.tsx`-ийн бичих логикийг
 * хурлын тэмдэглэлд дахин ашиглахын тулд hook болгосон; ASR-ийн файл нь
 * өөрийн хуулбартайгаа хэвээр (тэр модуль зэрэг засварлагдаж байгаа тул
 * энд шилжүүлээгүй — дараа нь энэ hook руу шилжүүлж болно).
 *
 * - `timesliceMs`: урт хурал (1–2 цаг) үед `ondataavailable`-г тогтмол
 *   дуудуулж chunk-уудыг санах ойд цуглуулна; нэг том Blob-ыг stop дээр
 *   л үүсгэдэг тул хөтчийн санах ойн дарамт бага.
 * - Микрофоны track-уудыг stop/unmount дээр ЗААВАЛ хаана — эс бөгөөс
 *   утсан дээр «бичиж байна» улаан заагч үлдэж батарей иддэг.
 * - Хөтөч дэмжихгүй бол `supported=false`; дуудагч файл сонгох замаа
 *   нээлттэй үлдээнэ (энэ бол мухардал биш).
 */

/** Хөтөч дээр бичих үеийн давуу дараалал.  Эхний дэмжигдсэнийг сонгоно. */
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4', // Safari
  'audio/ogg;codecs=opus',
];

export function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
}

export function recorderFileExtension(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'm4a';
  if (mimeType.includes('ogg')) return 'ogg';
  return 'webm';
}

export function isMediaRecorderSupported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    pickRecorderMimeType() !== undefined
  );
}

export type RecorderState = 'idle' | 'recording' | 'paused';

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  /** Секундын нарийвчлалтай таамаг (pause-ийн хугацаа орохгүй). */
  durationSeconds: number;
  file: (baseName: string) => File;
}

export interface UseMediaRecorder {
  supported: boolean;
  state: RecorderState;
  /** Бичсэн секунд (pause-д зогсоно). */
  elapsed: number;
  error: string | null;
  start: () => Promise<boolean>;
  pause: () => void;
  resume: () => void;
  /** Бичлэгийг дуусгаж Blob-ыг буцаана; бичээгүй бол null. */
  stop: () => Promise<RecordingResult | null>;
  /** Blob-гүйгээр хаяна (микрофон салгана). */
  discard: () => void;
}

export function useMediaRecorder(opts: { timesliceMs?: number } = {}): UseMediaRecorder {
  const timesliceMs = opts.timesliceMs ?? 10_000;
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const mimeRef = useRef<string>('');
  const elapsedRef = useRef(0);
  const stopResolveRef = useRef<((r: RecordingResult | null) => void) | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  }, []);

  // Unmount → микрофон заавал салгана.
  useEffect(
    () => () => {
      try {
        if (mediaRef.current && mediaRef.current.state !== 'inactive') mediaRef.current.stop();
      } catch {
        /* аль хэдийн зогссон */
      }
      stopStream();
    },
    [stopStream],
  );

  // Бичиж байх хугацааны тоолуур (pause-д зогсоно).
  useEffect(() => {
    if (state !== 'recording') return;
    const id = window.setInterval(() => {
      elapsedRef.current += 1;
      setElapsed(elapsedRef.current);
    }, 1000);
    return () => window.clearInterval(id);
  }, [state]);

  const start = useCallback(async (): Promise<boolean> => {
    setError(null);
    const mimeType = pickRecorderMimeType();
    if (!navigator.mediaDevices?.getUserMedia || mimeType === undefined) {
      setError('unsupported');
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      mimeRef.current = mimeType;
      const rec = new MediaRecorder(stream, { mimeType });
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        chunksRef.current = [];
        stopStream();
        const durationSeconds = elapsedRef.current;
        const result: RecordingResult | null =
          blob.size > 0
            ? {
                blob,
                mimeType,
                durationSeconds,
                file: (baseName: string) =>
                  new File([blob], `${baseName}.${recorderFileExtension(mimeType)}`, { type: mimeType }),
              }
            : null;
        stopResolveRef.current?.(result);
        stopResolveRef.current = null;
      };
      mediaRef.current = rec;
      elapsedRef.current = 0;
      setElapsed(0);
      rec.start(timesliceMs);
      setState('recording');
      return true;
    } catch {
      stopStream();
      setError('denied');
      return false;
    }
  }, [stopStream, timesliceMs]);

  const pause = useCallback(() => {
    const rec = mediaRef.current;
    if (rec && rec.state === 'recording') {
      rec.pause();
      setState('paused');
    }
  }, []);

  const resume = useCallback(() => {
    const rec = mediaRef.current;
    if (rec && rec.state === 'paused') {
      rec.resume();
      setState('recording');
    }
  }, []);

  const stop = useCallback((): Promise<RecordingResult | null> => {
    const rec = mediaRef.current;
    if (!rec || rec.state === 'inactive') {
      setState('idle');
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      stopResolveRef.current = resolve;
      mediaRef.current = null;
      setState('idle');
      rec.stop();
    });
  }, []);

  const discard = useCallback(() => {
    const rec = mediaRef.current;
    mediaRef.current = null;
    stopResolveRef.current = null;
    chunksRef.current = [];
    try {
      if (rec && rec.state !== 'inactive') {
        rec.onstop = null;
        rec.stop();
      }
    } catch {
      /* аль хэдийн зогссон */
    }
    stopStream();
    setState('idle');
    elapsedRef.current = 0;
    setElapsed(0);
  }, [stopStream]);

  return {
    supported: isMediaRecorderSupported(),
    state,
    elapsed,
    error,
    start,
    pause,
    resume,
    stop,
    discard,
  };
}
