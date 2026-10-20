import { apiFetch, apiFetchBlob, uploadFile } from '@/shared/api/client';
import { isAllowedDocFile } from './fileTypes';
import type { ArchiveRow, BrowseResponse, ImportFileInput, ImportResult, TrashResponse } from './types';

// ---------------------------------------------------------------------------
// Архив — серверээс импортолсон нэг хавтас.  Баримт бичгийн хуудас нь
// төслүүдийг ЖАГСААХАА больсон (эзний шийдвэр 2026-09-03), тиймээс энэ бол
// explorer-ийн үндсэн нэгж.
// ---------------------------------------------------------------------------

export const archivesKey = ['/documents/archives'] as const;

export async function fetchArchives(): Promise<{ archives: ArchiveRow[] }> {
  return apiFetch<{ archives: ArchiveRow[] }>('/documents/archives');
}

export async function createArchiveApi(name: string, sourcePath?: string): Promise<number> {
  const res = await apiFetch<{ archive_id: number }>('/documents/archives', {
    data: { name, source_path: sourcePath ?? null },
  });
  return res.archive_id;
}

export async function renameArchiveApi(id: number, name: string): Promise<void> {
  await apiFetch(`/documents/archives/${id}`, { method: 'PATCH', data: { name } });
}

export async function deleteArchiveApi(id: number): Promise<void> {
  await apiFetch(`/documents/archives/${id}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Explorer
// ---------------------------------------------------------------------------

export function browsePath(archiveId: number, folderId: number | null): string {
  const q = new URLSearchParams({ archive_id: String(archiveId) });
  if (folderId != null) q.set('folder_id', String(folderId));
  return `/documents/browse?${q}`;
}

export function browseKey(archiveId: number, folderId: number | null) {
  return ['/documents/browse', archiveId, folderId] as const;
}

export async function createFolderApi(
  archiveId: number,
  parentId: number | null,
  name: string,
): Promise<number> {
  const res = await apiFetch<{ folder_id: number }>('/documents/folders', {
    data: { archive_id: archiveId, parent_id: parentId, name },
  });
  return res.folder_id;
}

/**
 * Импортын 1-р алхам: хавтасны бүтэн МОДЫГ нэг дуудлагаар үүсгэнэ.
 * Буцаах утга нь харьцангуй зам → folder id.
 */
export async function createFolderTreeApi(
  archiveId: number,
  rootId: number | null,
  paths: string[],
): Promise<Record<string, number>> {
  const res = await apiFetch<{ folders: Record<string, number> }>('/documents/folders/bulk', {
    data: { archive_id: archiveId, root_id: rootId, paths },
  });
  return res.folders ?? {};
}

/** Импортын 2-р алхам: байршуулахын ӨМНӨ ижил нэртэй файлыг илрүүлнэ. */
export async function findConflictsApi(
  archiveId: number,
  items: { folder_id: number | null; title: string }[],
): Promise<{ folder_id: number | null; title: string; document_id: number }[]> {
  const res = await apiFetch<{
    conflicts: { folder_id: number | null; title: string; document_id: number }[];
  }>('/documents/conflicts', { data: { archive_id: archiveId, items } });
  return res.conflicts ?? [];
}

/** Импортын 4-р алхам: байршуулсан файлуудыг нэг багцаар бүртгэнэ. */
export async function registerFilesApi(
  archiveId: number,
  files: ImportFileInput[],
): Promise<ImportResult> {
  return apiFetch<ImportResult>('/documents/bulk', {
    data: { archive_id: archiveId, files },
  });
}

export async function renameFolderApi(id: number, name: string): Promise<void> {
  await apiFetch(`/documents/folders/${id}`, { method: 'PATCH', data: { name } });
}

export async function trashFolderApi(id: number): Promise<void> {
  await apiFetch(`/documents/folders/${id}`, { method: 'DELETE' });
}

export async function restoreFolderApi(id: number): Promise<void> {
  await apiFetch(`/documents/folders/${id}/restore`, { method: 'POST', data: {} });
}

export async function purgeFolderApi(id: number): Promise<void> {
  await apiFetch(`/documents/folders/${id}/purge`, { method: 'POST', data: {} });
}

export async function renameFileApi(id: number, title: string): Promise<void> {
  await apiFetch(`/documents/${id}`, { method: 'PATCH', data: { title } });
}

export async function trashFileApi(id: number): Promise<void> {
  await apiFetch(`/documents/${id}`, { method: 'DELETE' });
}

export async function restoreFileApi(id: number): Promise<void> {
  await apiFetch(`/documents/${id}/restore`, { method: 'POST', data: {} });
}

export async function purgeFileApi(id: number): Promise<void> {
  await apiFetch(`/documents/${id}/purge`, { method: 'POST', data: {} });
}

/** Ганц файл нэмэх (гараар «Файл нэмэх» товч). */
export async function uploadIntoFolder(
  archiveId: number,
  folderId: number | null,
  file: File,
): Promise<number> {
  if (!isAllowedDocFile(file.name)) throw new Error('bad_file_type');
  const file_url = await uploadFile(file);
  const res = await apiFetch<{ document_id: number }>('/documents', {
    data: {
      archive_id: archiveId,
      folder_id: folderId,
      title: file.name,
      file_url,
      file_name: file.name,
      file_type: file.type,
      file_size: file.size,
    },
  });
  return res.document_id;
}

export async function fetchTrash(archiveId: number): Promise<TrashResponse> {
  return apiFetch<TrashResponse>(`/documents/trash?archive_id=${archiveId}`);
}

// ---------------------------------------------------------------------------
// Office (Word / Excel / PowerPoint) — харах + Google дээр засах
// ---------------------------------------------------------------------------

export interface OfficeStatus {
  /** null бол Google дээр засах боломжгүй төрөл. */
  office: 'doc' | 'sheet' | 'slide' | null;
  file_name: string;
  revision_id: number;
  /** Сервер дээр DOCS_DRIVE_SUBJECT тохируулагдсан эсэх. */
  drive_enabled: boolean;
  /** Аль хэдийн нээгдсэн бол Google-ийн засварлагчийн хаяг. */
  edit_url: string | null;
  last_synced_at: string | null;
}

export function officeStatusKey(documentId: number) {
  return ['/documents/office', documentId] as const;
}

export function officeStatusPath(documentId: number): string {
  return `/documents/${documentId}/office`;
}

/** Google-ийн засварлагчийг нээх.  Анх удаад хөрвүүлэлт хийгддэг тул удаан. */
export async function openInGoogleApi(documentId: number): Promise<string> {
  const res = await apiFetch<{ edit_url: string }>(`/documents/${documentId}/office/open`, {
    method: 'POST',
    timeoutMs: 120_000,
  });
  return res.edit_url;
}

/**
 * Урьдчилан харах PDF.  `apiFetchBlob` нь `Authorization` толгойг явуулдаг —
 * эндпойнт нь нэвтрэлт шаарддаг тул түүхий URL-ыг iframe-д өгөх боломжгүй.
 * Мөн манай origin cross-origin isolated тул PDF-ийг ЗААВАЛ `blob:` -ээр
 * үзүүлэх ёстой (`AttachmentPreviews.tsx` дээрх хэмжилт).
 */
export async function fetchOfficePreview(documentId: number): Promise<Blob> {
  return apiFetchBlob(`/documents/${documentId}/office/preview`);
}

/** Google дээрх засварыг архив руу яг одоо буулгана. */
export async function syncFromGoogleApi(documentId: number): Promise<number> {
  const res = await apiFetch<{ revision_id: number }>(`/documents/${documentId}/office/sync`, {
    method: 'POST',
    timeoutMs: 120_000,
  });
  return res.revision_id;
}

/** Засварыг дуусгах — сүүлчийн байдлаар татаад Drive дээрх хуулбарыг хаана. */
export async function closeGoogleApi(documentId: number): Promise<void> {
  await apiFetch(`/documents/${documentId}/office/close`, { method: 'POST', timeoutMs: 120_000 });
}

export type { BrowseResponse };
