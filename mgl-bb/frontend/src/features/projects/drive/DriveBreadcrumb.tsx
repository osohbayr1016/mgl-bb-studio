import { ChevronRight, HardDrive } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import type { DrivePathNode } from './types';

/**
 * Үндэс хавтаснаас одоогийн хавтас хүртэл.  `path` нь серверээс ирдэг —
 * ancestry шалгалт нь гинжийг аль хэдийн уншсан тул нэмэлт дуудлагагүй.
 * Хавтас солих нь `onNavigate` (URL-ын `?folder=`) — хуудаснаас гарахгүй.
 */
export function DriveBreadcrumb({
  path,
  rootName,
  onNavigate,
  dropTargets = false,
  overId = null,
}: {
  path: DrivePathNode[];
  rootName: string;
  onNavigate: (folderId: string) => void;
  /** Дээд хавтас руу чирж тавих зорилт болгох (`useDriveDragSession` барина) — 2026-09-18. */
  dropTargets?: boolean;
  /** Одоо чирж буй зүйл дээр нь байгаа зангилааны drop id ('root' эсвэл Drive id). */
  overId?: string | null;
}) {
  const nodes = path.length > 0 ? path : [{ id: 'root', name: rootName }];
  const last = nodes.length - 1;
  const dropProps = (node: DrivePathNode, target: string) =>
    dropTargets ? { 'data-drop-kind': 'crumb', 'data-drop-id': target, 'data-drop-name': node.name } : {};
  return (
    <nav className="flex min-w-0 flex-wrap items-center gap-0.5 text-xs text-muted-foreground">
      {nodes.map((node, i) => {
        const isLast = i === last;
        // Үндэс хавтсыг `root` гэж дамжуулна — id нь URL-д харагдахгүй,
        // харин серверт төслийн холбоосоор шийдэгдэнэ.
        const target = i === 0 ? 'root' : node.id;
        return (
          <span key={node.id} className="flex min-w-0 items-center gap-0.5">
            {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 opacity-50" />}
            {isLast ? (
              <span className="flex min-w-0 items-center gap-1 truncate px-1.5 font-medium text-foreground">
                {i === 0 && <HardDrive className="h-3.5 w-3.5 shrink-0 text-primary" />}
                <span className="truncate">{node.name}</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(target)}
                className={cn(
                  'flex min-w-0 items-center gap-1 truncate rounded-md px-1.5 py-0.5',
                  'hover:bg-muted hover:text-foreground',
                  overId === target && 'bg-primary/15 text-foreground outline outline-2 outline-primary/60',
                )}
                {...dropProps(node, target)}
              >
                {i === 0 && <HardDrive className="h-3.5 w-3.5 shrink-0 text-primary" />}
                <span className="truncate">{node.name}</span>
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
