import type { BrowseTrail } from './types';

export function explorerRoot(archiveId: number): string {
  return `/app/documents/${archiveId}`;
}

export function folderHref(archiveId: number, folderId: number | null): string {
  const root = explorerRoot(archiveId);
  return folderId == null ? root : `${root}?folder=${folderId}`;
}

/** Дээд хавтас — архивын үндэс дээр архивын жагсаалт руу. */
export function upHref(archiveId: number, trail: BrowseTrail[]): string {
  if (trail.length === 0) return '/app/documents';
  if (trail.length === 1) return explorerRoot(archiveId);
  const parent = trail[trail.length - 2];
  return parent ? folderHref(archiveId, parent.id) : explorerRoot(archiveId);
}
