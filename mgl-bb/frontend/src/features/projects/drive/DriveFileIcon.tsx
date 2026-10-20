import {
  Archive,
  Box,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  Folder,
  Link2,
  Presentation,
  Video,
} from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import type { DriveFileKind } from './fileKind';

const TILE =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg [&_svg]:h-4 [&_svg]:w-4';

const TONE: Record<DriveFileKind, string> = {
  folder: 'bg-primary/10 text-primary',
  shortcut: 'bg-muted text-muted-foreground',
  pdf: 'bg-red-500/10 text-red-500',
  image: 'bg-violet-500/10 text-violet-500',
  gdoc: 'bg-sky-500/10 text-sky-600',
  gsheet: 'bg-emerald-500/10 text-emerald-600',
  gslides: 'bg-amber-500/10 text-amber-600',
  word: 'bg-sky-500/10 text-sky-600',
  excel: 'bg-emerald-500/10 text-emerald-600',
  powerpoint: 'bg-amber-500/10 text-amber-600',
  cad: 'bg-cyan-500/10 text-cyan-600',
  archive: 'bg-muted text-muted-foreground',
  text: 'bg-muted text-muted-foreground',
  video: 'bg-rose-500/10 text-rose-500',
  other: 'bg-muted text-muted-foreground',
};

function Glyph({ kind }: { kind: DriveFileKind }) {
  switch (kind) {
    case 'folder':
      return <Folder className="fill-primary/20" />;
    case 'shortcut':
      return <Link2 />;
    case 'image':
      return <FileImage />;
    case 'gsheet':
    case 'excel':
      return <FileSpreadsheet />;
    case 'gslides':
    case 'powerpoint':
      return <Presentation />;
    case 'cad':
      return <Box />;
    case 'archive':
      return <Archive />;
    case 'video':
      return <Video />;
    case 'pdf':
      return <FileType />;
    default:
      return <FileText />;
  }
}

/** Жагсаалтын мөрний дүрс — архивын `FileTypeIcon`-той ижил хэмжээ/өнгө. */
export function DriveFileIcon({ kind, className }: { kind: DriveFileKind; className?: string }) {
  return (
    <span className={cn(TILE, TONE[kind], className)}>
      <Glyph kind={kind} />
    </span>
  );
}
