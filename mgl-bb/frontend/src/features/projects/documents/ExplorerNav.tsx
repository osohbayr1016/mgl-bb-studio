import { Link } from 'react-router-dom';
import { cn } from '@/shared/lib/utils';
import { FileTypeIcon } from './FileTypeIcon';
import { explorerRoot, folderHref } from './paths';
import type { DocFolder } from './types';

export function ExplorerNav({
  archiveId,
  archiveName,
  folderId,
  folders,
}: {
  archiveId: number;
  archiveName: string;
  folderId: number | null;
  folders: DocFolder[];
}) {
  return (
    <nav className="hidden w-52 shrink-0 overflow-auto border-r border-border/60 py-2 lg:block">
      <Link
        to={explorerRoot(archiveId)}
        title={archiveName}
        className={cn(
          'mx-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
          folderId == null
            ? 'bg-primary/15 text-foreground'
            : 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground',
        )}
      >
        <FileTypeIcon kind="folder" />
        <span className="truncate font-medium">{archiveName}</span>
      </Link>
      <ul className="mt-1 space-y-px">
        {folders.map((f) => (
          <li key={f.id}>
            <Link
              to={folderHref(archiveId, f.id)}
              title={f.name}
              className={cn(
                'mx-1 flex items-center gap-2 rounded-md py-1.5 pr-2 pl-6 text-sm transition-colors',
                folderId === f.id
                  ? 'bg-primary/15 text-foreground'
                  : 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground',
              )}
            >
              <FileTypeIcon kind="folder" />
              <span className="truncate">{f.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
