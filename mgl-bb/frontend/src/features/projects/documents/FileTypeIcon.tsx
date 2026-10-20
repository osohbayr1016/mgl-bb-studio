import { FileText, Folder } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { docKind } from './fileTypes';

const TILE =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg [&_svg]:h-4 [&_svg]:w-4';

export function FileTypeIcon({ kind }: { kind: 'folder' | string }) {
  if (kind === 'folder') {
    return (
      <span className={cn(TILE, 'bg-primary/10 text-primary')}>
        <Folder className="fill-primary/20" />
      </span>
    );
  }
  const k = docKind(kind);
  const tone =
    k === 'pdf'
      ? 'bg-red-500/10 text-red-500'
      : k === 'doc' || k === 'docx'
        ? 'bg-sky-500/10 text-sky-600'
        : 'bg-muted text-muted-foreground';
  return (
    <span className={cn(TILE, tone)}>
      <FileText />
    </span>
  );
}
