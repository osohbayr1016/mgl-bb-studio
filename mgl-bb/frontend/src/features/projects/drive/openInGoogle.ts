/**
 * «Эх файлыг нээх» — .docx-ийг Google дээр нээхээс ӨМНӨ Word-той ижил харагдахаар засна
 * (2026-09-30, эзний хүсэлт: «Google Docs болгох» товч давхардал үүсгэдэг тул хасаж, эх файлыг
 * нээхэд navy дэвсгэрийн бичвэр цагаан, жишиг PDF-тэй адилхан).
 *
 * Урсгал: товч дармагц ШИНЭ ЦОНХ (попап хориглогч async-ийн дараах `window.open`-ыг хаадаг тул
 * заавал эхэнд) «бэлтгэж байна» → Drive-аас шинэ мета + байт → `docxGoogleReady.ts` → засах
 * зүйл байвал ИЖИЛ файлын ШИНЭ ХУВИЛБАР (`POST …/revision` + ердийн chunk; шинэ файл хэзээ ч
 * үүсэхгүй) → цонхыг Google руу.  Засвар унавал ч файл нээгдэнэ (зөвхөн анхааруулга).
 *
 * Засвар нэг л удаа: дараа нь файл өөрчлөгдөөгүй бол (`modified_time`) localStorage-аас мэдээд
 * дахин татахгүй.  Хэн нэгэн хооронд нь файлыг засварласан бол сервер 409 — бусдын засварыг
 * хуучин байтаар дарахгүй, энэ удаа засваргүй нээнэ.
 */
import { toast } from '@/shared/components/Toast';
import { apiFetchBlob } from '@/shared/api/client';
import { driveFilePath, fetchDriveFile, putDriveChunk, startDriveRevision } from './api';
import { describeDriveError } from './driveErrors';
import { isDocxFile } from './fileKind';
import type { DriveItem, DriveScope, DriveUploadChunkResult } from './types';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** backend `REVISION_MAX_BYTES`-тэй ИХЭР — зурагтай том тайланг (50–110 MB) дахин татахгүй. */
export const GOOGLE_READY_MAX_BYTES = 40 * 1024 * 1024;

// v2 (2026-10-05): фонт → Arial нэмэгдсэн тул өмнө «цэвэр» гэж тэмдэглэсэн файлууд дахин шалгагдана.
const CACHE_PREFIX = 'mgl:google-ready:v2:';

function readCache(fileId: string): string | null {
  try {
    return localStorage.getItem(CACHE_PREFIX + fileId);
  } catch {
    return null;
  }
}

function writeCache(fileId: string, modifiedTime: string | null | undefined): void {
  if (!modifiedTime) return;
  try {
    localStorage.setItem(CACHE_PREFIX + fileId, modifiedTime);
  } catch {
    /* хувийн цонх — дараагийн удаа дахин шалгана */
  }
}

/** Засвартай нээх ёстой юу: ажилтны scope, .docx, таазаас бага. */
export function needsGooglePrep(scope: DriveScope, item: DriveItem): boolean {
  return (
    scope !== 'client' &&
    item.kind === 'file' &&
    item.open_url != null &&
    isDocxFile(item.mime_type, item.name) &&
    (item.size == null || item.size <= GOOGLE_READY_MAX_BYTES)
  );
}

export type GoogleReadyOutcome = 'clean' | 'fixed' | 'skipped' | 'failed';

/** Файлыг Google-д бэлэн болгоно (шаардлагатай бол шинэ хувилбар). */
export async function ensureGoogleReady(scope: DriveScope, id: number, item: DriveItem): Promise<GoogleReadyOutcome> {
  const meta = await fetchDriveFile(scope, id, item.id);
  const base = meta.item.modified_time;
  if (!base) return 'skipped';
  if (readCache(item.id) === base) return 'clean';
  if (meta.item.size != null && meta.item.size > GOOGLE_READY_MAX_BYTES) return 'skipped';

  const blob = await apiFetchBlob(`${driveFilePath(scope, id, item.id)}/content?download=1`);
  if (blob.size > GOOGLE_READY_MAX_BYTES) return 'skipped';
  const { prepareDocxForGoogle } = await import('./docxGoogleReady');
  const ready = prepareDocxForGoogle(new Uint8Array(await blob.arrayBuffer()));
  if (!ready.changed) {
    writeCache(item.id, base);
    return 'clean';
  }

  const start = await startDriveRevision(scope, id, item.id, {
    size: ready.bytes.length,
    base_modified_time: base,
  });
  const body = new Blob([ready.bytes as BlobPart], { type: DOCX_MIME });
  let offset = 0;
  let last: DriveUploadChunkResult | null = null;
  while (offset < body.size) {
    const chunk = body.slice(offset, Math.min(body.size, offset + start.chunk_bytes));
    last = await putDriveChunk(scope, id, start.upload_token, offset, chunk);
    offset += chunk.size;
  }
  if (last?.done) writeCache(item.id, last.item.modified_time);
  return 'fixed';
}

type Translate = (key: string, vars?: Record<string, string | number>) => string;

function showWaiting(win: Window, text: string): void {
  try {
    const d = win.document;
    d.title = text;
    const p = d.createElement('p');
    p.textContent = text;
    p.style.cssText = 'font:15px system-ui,sans-serif;color:#334155;margin:64px auto;max-width:560px;text-align:center';
    d.body.appendChild(p);
  } catch {
    /* цонх аль хэдийн өөр хаяг руу шилжсэн */
  }
}

function navigate(win: Window | null, url: string, t: Translate): void {
  if (win && !win.closed) {
    try {
      win.opener = null;
      win.location.replace(url);
      return;
    } catch {
      /* доорх нөөц */
    }
  }
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  // `noopener` үед хөтөч үргэлж null буцаадаг тул хориглогдсоныг зөвхөн эхний цонхоор мэднэ.
  if (!win && !opened) toast.error(t('projectDrive.googlePopupBlocked'));
}

/**
 * «Эх файлыг нээх» товчны handler — CLICK-ийн дотор СИНХРОН дуудна (попап).
 * `.docx` биш / захиалагч → шууд нээнэ.
 */
export function openDriveFileInGoogle(opts: {
  scope: DriveScope;
  id: number;
  item: DriveItem;
  t: Translate;
  /** Шинэ хувилбар байршсаны дараа (жагсаалтыг шинэчлэх). */
  onFixed?: () => void;
}): void {
  const { scope, id, item, t } = opts;
  const url = item.open_url;
  if (!url) return;
  if (!needsGooglePrep(scope, item)) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  const win = window.open('', '_blank');
  if (win) showWaiting(win, t('projectDrive.googlePreparing'));
  void ensureGoogleReady(scope, id, item)
    .then((outcome) => {
      if (outcome === 'fixed') {
        toast.success(t('projectDrive.googleReadyFixed'));
        opts.onFixed?.();
      }
    })
    .catch((err: unknown) => {
      const view = describeDriveError(err);
      // Хооронд нь өөр хүн засварласан — засваргүй нээнэ, дараагийн удаа дахин оролдоно.
      if (view.code === 'STALE_FILE') return;
      console.error('[drive] google-ready', err);
      toast.error(t('projectDrive.googleReadyFailed'));
    })
    .finally(() => navigate(win, url, t));
}
