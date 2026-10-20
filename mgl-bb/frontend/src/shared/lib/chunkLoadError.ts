/**
 * Lazy chunk ачаалах алдаа мөн эсэх — deploy-ийн дараа SPA хуучин build-ийн
 * hash-тай chunk URL-ийг дуудаж 404 авах тохиолдол.  `AppErrorBoundary` нь
 * үүн дээр нэг удаа reload хийдэг; дотоод boundary-ууд үүнийг залгихгүй.
 */
export function isChunkLoadError(error: unknown): boolean {
  const msg = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return (
    /ChunkLoadError/i.test(msg) ||
    /Loading chunk [\d]+ failed/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg)
  );
}
