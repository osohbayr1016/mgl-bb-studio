/**
 * ERP-ээс төслийн Drive хавтсанд файл/хавтас БАЙРШУУЛАХ — хөтчийн тал
 * (2026-09-17, эзний шийдвэр: «Drive нээлгүй системээсээ оруулна»).
 *
 * Урсгал (`backend/src/lib/projectDriveUpload.ts`-ийн ихэр):
 *   1. `startDriveUpload` — сервер Google resumable session нээж гарын үсэгтэй
 *      тикет өгнө (Google-ийн URI хөтөчид ХЭЗЭЭ Ч ирэхгүй);
 *   2. файлыг `chunk_bytes` (сервер хэлнэ, 32 MiB)-ээр хувааж `putDriveChunk`
 *      — chunk бүр XHR тул явц байт-нарийвчлалтай;
 *   3. сүүлийн chunk-д Drive-ын мөр (`DriveItem`) буцна.
 *
 * Хавтас байршуулахад (`<input webkitdirectory>` эсвэл чирж тавьсан хавтас)
 * файл бүр `relPath` (хавтасны сегментүүд)-тэй ирнэ; зам бүрийг
 * `createDriveFolder(reuse:true)`-ээр НЭГ л удаа үүсгэнэ (`ensureFolder`
 * кэш) — ижил нэртэй дэд хавтас давхардахгүй, дахин байршуулахад одоо
 * байгаа хавтас руу нийлнэ.
 *
 * Хэрэглэгч Drive-ын түүх, манай ledger хоёуланд «шинэ хувилбар» гэж
 * харагдахын тулд ижил нэртэй файлыг `replace` (өгөгдмөл) → Drive `files.update`.
 */
import { ApiError } from '@/shared/api/client';
import { cancelDriveUpload, createDriveFolder, putDriveChunk, startDriveUpload } from './api';
import { describeDriveError } from './driveErrors';
import type { DriveItem, DriveScope, DriveUploadConflict } from './types';

/* ------------------------------------------------------------------ */
/*  Оролт: файл + харьцангуй зам                                       */
/* ------------------------------------------------------------------ */

export interface UploadEntry {
  file: File;
  /** Зорилтот хавтаснаас доош хавтасны сегментүүд ([] = шууд тэр хавтсанд). */
  relPath: string[];
}

/** Үйлдлийн системийн хог — хавтас байршуулахад ОРУУЛАХГҮЙ. */
const JUNK_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '.localized']);

function isJunk(name: string): boolean {
  return JUNK_NAMES.has(name) || name.startsWith('._');
}

/** `<input type=file [webkitdirectory]>`-ийн FileList → бичлэгүүд.  Хавтасны
 *  сонголтод `webkitRelativePath` = «Хавтас/дэд/файл.pdf» — сүүлийн сегмент нь
 *  файлын нэр. */
export function entriesFromFileList(files: FileList | File[]): UploadEntry[] {
  const out: UploadEntry[] = [];
  for (const file of Array.from(files)) {
    if (isJunk(file.name)) continue;
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || '';
    const segs = rel ? rel.split('/').filter(Boolean) : [];
    if (segs.length > 0) segs.pop();
    out.push({ file, relPath: segs });
  }
  return out;
}

/* Чирж тавьсан зүйлс — `webkitGetAsEntry` (бүх орчин үеийн хөтөчид байдаг,
 * стандартын нэр нь `getAsEntry` хараахан гараагүй).  Хавтсыг рекурсээр уншина;
 * `readEntries` нь нэг дуудлагад ≤100 л буцаадаг тул хоосон болтол давтана. */

function readAll(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader();
  const all: FileSystemEntry[] = [];
  return new Promise((resolve, reject) => {
    const step = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(all);
          return;
        }
        all.push(...batch);
        step();
      }, reject);
    };
    step();
  });
}

async function walkEntry(entry: FileSystemEntry, relPath: string[], out: UploadEntry[]): Promise<void> {
  if (entry.isFile) {
    if (isJunk(entry.name)) return;
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    out.push({ file, relPath });
    return;
  }
  if (entry.isDirectory) {
    const children = await readAll(entry as FileSystemDirectoryEntry);
    for (const child of children) await walkEntry(child, [...relPath, entry.name], out);
  }
}

/** `drop` үйл явдлын `dataTransfer` → бичлэгүүд (хавтас орсон бол рекурсээр). */
export async function entriesFromDataTransfer(dt: DataTransfer): Promise<UploadEntry[]> {
  const out: UploadEntry[] = [];
  const items = Array.from(dt.items ?? []);
  const entries = items
    .map((it) => it.webkitGetAsEntry())
    .filter((e): e is FileSystemEntry => e !== null);
  if (entries.length > 0) {
    for (const e of entries) await walkEntry(e, [], out);
    return out;
  }
  // Хуучин хөтөч — зөвхөн файлууд.
  return entriesFromFileList(dt.files);
}

/* ------------------------------------------------------------------ */
/*  Явц                                                                */
/* ------------------------------------------------------------------ */

export type UploadItemStatus = 'queued' | 'uploading' | 'done' | 'error' | 'cancelled';

export interface UploadItem {
  id: string;
  name: string;
  /** Харуулах зам («Зураг/АБ») — шууд хавтсанд бол ''. */
  path: string;
  size: number;
  loaded: number;
  status: UploadItemStatus;
  /** i18n түлхүүр (алдаанд). */
  errorKey?: string;
  /** Тохиргооны алдаанд серверийн бүтэн мессеж (админд яг заавар — DWD client id г.м.). */
  errorDetail?: string;
  /** Одоо байгаа файлын шинэ хувилбар болов. */
  replaced?: boolean;
  result?: DriveItem;
}

export interface UploadSummary {
  done: number;
  failed: number;
  cancelled: number;
}

export interface RunUploadOptions {
  scope: DriveScope;
  id: number;
  /** Зорилтот хавтас ('root' эсвэл Drive id). */
  folderId: string;
  conflict: DriveUploadConflict;
  onUpdate: (items: UploadItem[]) => void;
  signal?: AbortSignal;
  /** Зэрэг явах файлын тоо (хавтасны үүсгэлт нь дараалалтай). */
  concurrency?: number;
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/**
 * Бүх бичлэгийг байршуулна.  Дуусахад (эсвэл цуцлахад) нийлбэрийг буцаана;
 * мөр бүрийн төлөв `onUpdate`-ээр амьд ирнэ.  Нэг файлын алдаа бусдыг
 * зогсоохгүй; цуцлалт (`signal`) бүгдийг зогсооно.
 */
export async function runDriveUploads(entries: UploadEntry[], opts: RunUploadOptions): Promise<UploadSummary> {
  const items: UploadItem[] = entries.map((e, i) => ({
    id: `${Date.now()}-${i}`,
    name: e.file.name,
    path: e.relPath.join('/'),
    size: e.file.size,
    loaded: 0,
    status: 'queued',
  }));
  const emit = () => opts.onUpdate(items.map((it) => ({ ...it })));
  emit();

  // Хавтасны зам → Drive id (нэг зам нэг л удаа үүснэ, зэрэгцээ ажилчид хүлээнэ).
  const folderCache = new Map<string, Promise<string>>();
  folderCache.set('', Promise.resolve(opts.folderId));
  const ensureFolder = (segs: string[]): Promise<string> => {
    const key = segs.join('/');
    let p = folderCache.get(key);
    if (!p) {
      p = (async () => {
        const parent = await ensureFolder(segs.slice(0, -1));
        const res = await createDriveFolder(opts.scope, opts.id, parent, segs[segs.length - 1]!, { reuse: true });
        return res.item.id;
      })();
      folderCache.set(key, p);
    }
    return p;
  };

  const uploadOne = async (index: number): Promise<void> => {
    const entry = entries[index]!;
    const it = items[index]!;
    if (opts.signal?.aborted) {
      it.status = 'cancelled';
      emit();
      return;
    }
    it.status = 'uploading';
    emit();
    let token: string | null = null;
    try {
      const parentId = await ensureFolder(entry.relPath);
      const start = await startDriveUpload(
        opts.scope,
        opts.id,
        parentId,
        { name: entry.file.name, mime: entry.file.type, size: entry.file.size },
        opts.conflict,
      );
      token = start.upload_token;
      it.replaced = start.replacing !== null;
      const chunkBytes = start.chunk_bytes;
      let offset = 0;
      for (;;) {
        if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError');
        const end = Math.min(offset + chunkBytes, entry.file.size);
        const blob = entry.file.slice(offset, end);
        const base = offset;
        const res = await putDriveChunk(opts.scope, opts.id, token, offset, blob, {
          signal: opts.signal,
          onProgress: (loaded) => {
            it.loaded = base + loaded;
            emit();
          },
        });
        if (res.done) {
          it.loaded = entry.file.size;
          it.result = res.item;
          it.status = 'done';
          break;
        }
        // Google хүлээн авсан хүртэл — ердийн тохиолдолд яг `end`; өөр бол
        // зөвхөн chunk-ийн хилээс үргэлжлүүлж болно.
        if (res.received === end || (res.received > offset && res.received % chunkBytes === 0)) {
          offset = res.received;
          it.loaded = offset;
        } else {
          throw new ApiError(409, 'resume mismatch', { code: 'UPLOAD_SESSION_GONE' });
        }
      }
    } catch (err) {
      if (isAbort(err)) {
        it.status = 'cancelled';
      } else {
        it.status = 'error';
        const view = describeDriveError(err);
        it.errorKey = view.key;
        if (view.configuration && err instanceof ApiError && err.message) it.errorDetail = err.message;
      }
      if (token) void cancelDriveUpload(opts.scope, opts.id, token);
    }
    emit();
  };

  const concurrency = Math.max(1, opts.concurrency ?? 2);
  let next = 0;
  const worker = async () => {
    while (next < entries.length) {
      const i = next++;
      await uploadOne(i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, worker));

  return {
    done: items.filter((i) => i.status === 'done').length,
    failed: items.filter((i) => i.status === 'error').length,
    cancelled: items.filter((i) => i.status === 'cancelled').length,
  };
}

/** Зорилтот хавтсанд ШУУД очих файлуудаас одоо байгаа файлтай ижил нэртэйг нь
 *  олно — «солих уу, хоёуланг үлдээх үү» гэж нэг удаа асуухад.  Дэд хавтас
 *  доторх давхардлыг хөтөч мэдэхгүй (жагсаалт нь зөвхөн энэ хавтас) — тэнд
 *  сонгосон дүрэм л үйлчилнэ. */
export function findNameConflicts(entries: UploadEntry[], existing: DriveItem[]): string[] {
  const names = new Set(existing.filter((i) => i.kind === 'file').map((i) => i.name));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of entries) {
    if (e.relPath.length !== 0) continue;
    if (names.has(e.file.name) && !seen.has(e.file.name)) {
      seen.add(e.file.name);
      out.push(e.file.name);
    }
  }
  return out;
}
