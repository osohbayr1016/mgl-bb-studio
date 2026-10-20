import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/ui/table';
import { formatDateTime } from '@/shared/lib/time';
import { useLanguage } from '@/shared/i18n';
import { FileTypeIcon } from './FileTypeIcon';
import { ExplorerRow } from './ExplorerRow';
import { formatBytes, docKind } from './fileTypes';
import type { DocFolder, ExplorerSelection } from './types';
import type { DocumentItem } from '@/shared/types';

function typeLabel(t: (k: string) => string, fileName: string): string {
  const k = docKind(fileName);
  if (k === 'pdf') return t('documentsPage.typePdf');
  if (k === 'doc') return t('documentsPage.typeDoc');
  if (k === 'docx') return t('documentsPage.typeDocx');
  return fileName;
}

function isSelected(selection: ExplorerSelection, kind: 'folder' | 'file', id: number) {
  return selection?.kind === kind && selection.id === id;
}

export function ExplorerList({
  folders,
  files,
  selection,
  onSelect,
  onOpenFolder,
  onOpenFile,
}: {
  folders: DocFolder[];
  files: DocumentItem[];
  selection: ExplorerSelection;
  onSelect: (s: ExplorerSelection) => void;
  onOpenFolder: (id: number) => void;
  onOpenFile: (file: DocumentItem) => void;
}) {
  const { t } = useLanguage();
  return (
    <Table>
      <TableHeader className="bg-muted/40">
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-9 pl-4 text-micro uppercase tracking-wide text-muted-foreground">
            {t('documentsPage.colName')}
          </TableHead>
          <TableHead className="h-9 w-44 text-micro uppercase tracking-wide text-muted-foreground">
            {t('documentsPage.colModified')}
          </TableHead>
          <TableHead className="h-9 w-36 text-micro uppercase tracking-wide text-muted-foreground">
            {t('documentsPage.colType')}
          </TableHead>
          <TableHead className="h-9 w-24 pr-4 text-right text-micro uppercase tracking-wide text-muted-foreground">
            {t('documentsPage.colSize')}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {folders.map((f) => (
          <ExplorerRow
            key={`f-${f.id}`}
            selected={isSelected(selection, 'folder', f.id)}
            onSelect={() =>
              onSelect({ kind: 'folder', id: f.id, name: f.name, isSystem: f.is_system === 1 })
            }
            onOpen={() => onOpenFolder(f.id)}
            icon={<FileTypeIcon kind="folder" />}
            name={f.name}
            modified={formatDateTime(f.created_at)}
            type={t('documentsPage.typeFolder')}
            size="—"
          />
        ))}
        {files.map((d) => {
          const name = d.file_name || d.title;
          return (
            <ExplorerRow
              key={`d-${d.id}`}
              selected={isSelected(selection, 'file', d.id)}
              onSelect={() => onSelect({ kind: 'file', id: d.id, name })}
              onOpen={() => onOpenFile(d)}
              icon={<FileTypeIcon kind={name} />}
              name={name}
              modified={formatDateTime(d.uploaded_at || d.created_at)}
              type={typeLabel(t, name)}
              size={formatBytes(d.file_size)}
            />
          );
        })}
      </TableBody>
    </Table>
  );
}
