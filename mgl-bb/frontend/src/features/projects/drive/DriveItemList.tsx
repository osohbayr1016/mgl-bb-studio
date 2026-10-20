import type { DragEvent } from 'react';
import { Download, ExternalLink, Eye, History, Pencil, Share2 } from 'lucide-react';
import { Button } from '@/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table';
import { formatDateTime } from '@/shared/lib/time';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { formatBytes } from '@/features/projects/documents/fileTypes';
import { DriveFileIcon } from './DriveFileIcon';
import { setDragPayload } from './driveDnd';
import { driveFileKind, driveKindLabelKey, isDocxFile } from './fileKind';
import type { DriveItem } from './types';
import { SigningBadge } from './signing/SigningBadge';
import type { FileSignStatus } from './signing/types';

/**
 * Хавтасны агуулгын хүснэгт — архивын `ExplorerList`-тэй ижил дүр төрх
 * (нэр · өөрчлөгдсөн · төрөл · хэмжээ).  Мөр бүрд зөвхөн хэрэгтэй үйлдэл:
 * харах / эх файлыг нээх / татах / хувилбарууд (§10) — үйлдлүүд мөрөнд hover хийхэд
 * гарна; нэр солих харандаа нь нэрийн ард шууд (2026-09-18).
 *
 * Чирж тавих (2026-09-18): мөр бүр чирэгдэнэ (Drive дотор зөөх); хавтасны мөр
 * нь `data-drop-kind="folder"` зорилт — үйл явдлыг `useDriveDragSession`
 * (document-түвшин) барьж, `overId` таарсан мөр л тодорно; мөр өөрөө
 * enter/leave тоолохгүй (тоолуур зөрж overlay гацдаг байсан).
 *
 * Захиалагчийн портал (миграц 0327) ч ЭНЭ хүснэгтийг ашигладаг: тэнд
 * `onVersions`/`onRename`/`onShareClient` өгөгдөхгүй тул тэр товчнууд гарахгүй,
 * `open_url` сервер талд null тул «эх файл» холбоос ч гарахгүй.  Ажилтны
 * талд `onShareClient` + `clientSharedIds` нь мөр бүрийн «Захиалагчид нээх»
 * товч ба нээгдсэн мөрийн тэмдэг.
 */
export function DriveItemList({
  items,
  onOpenFolder,
  onPreview,
  onDownload,
  onVersions,
  onRename,
  onShareClient,
  onOpenOriginal,
  clientSharedIds,
  draggable = false,
  overId = null,
  signStatuses,
}: {
  items: DriveItem[];
  onOpenFolder: (item: DriveItem) => void;
  onPreview: (item: DriveItem) => void;
  onDownload: (item: DriveItem) => void;
  /** «Эх файлыг нээх» (.docx): Google-д бэлтгээд нээх (`openInGoogle.ts`); өгөөгүй бол энгийн холбоос. */
  onOpenOriginal?: (item: DriveItem) => void;
  /** «Хувилбарууд» — файлын хадгалагдсан төлөв бүрийн түүх (миграц 0300). */
  onVersions?: (item: DriveItem) => void;
  onRename?: (item: DriveItem) => void;
  /** «Захиалагчид нээх» (миграц 0327) — зөвхөн ажилтны төслийн scope. */
  onShareClient?: (item: DriveItem) => void;
  /** Захиалагчид аль хэдийн нээгдсэн зүйлсийн Drive id — мөрөнд тэмдэг. */
  clientSharedIds?: ReadonlySet<string>;
  /** Мөрүүдийг чирж болох (зөөх) + хавтасны мөр зорилт болох. */
  draggable?: boolean;
  /** Одоо чирж буй зүйл дээр нь байгаа хавтасны id (`useDriveDragSession`). */
  overId?: string | null;
  /** Word баримтын гарын үсгийн төлөв (`signing/`, 2026-10-01) — мөрийн тэмдэг. */
  signStatuses?: Record<string, FileSignStatus>;
}) {
  const { t } = useLanguage();
  return (
    <Table>
      <TableHeader className="bg-muted/40">
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-9 pl-4 text-micro uppercase tracking-wide text-muted-foreground">
            {t('documentsPage.colName')}
          </TableHead>
          <TableHead className="hidden h-9 w-40 text-micro uppercase tracking-wide text-muted-foreground md:table-cell">
            {t('documentsPage.colModified')}
          </TableHead>
          <TableHead className="hidden h-9 w-36 text-micro uppercase tracking-wide text-muted-foreground lg:table-cell">
            {t('documentsPage.colType')}
          </TableHead>
          <TableHead className="hidden h-9 w-24 text-right text-micro uppercase tracking-wide text-muted-foreground sm:table-cell">
            {t('documentsPage.colSize')}
          </TableHead>
          <TableHead className="h-9 w-36 pr-3" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <DriveRow
            key={item.id}
            item={item}
            onOpenFolder={onOpenFolder}
            onPreview={onPreview}
            onDownload={onDownload}
            onVersions={onVersions}
            onRename={onRename}
            onShareClient={onShareClient}
            onOpenOriginal={onOpenOriginal}
            clientShared={clientSharedIds?.has(item.id) ?? false}
            draggable={draggable}
            over={overId === item.id}
            signStatus={signStatuses?.[item.id]}
          />
        ))}
      </TableBody>
    </Table>
  );
}

function DriveRow({
  item,
  onOpenFolder,
  onPreview,
  onDownload,
  onVersions,
  onRename,
  onShareClient,
  onOpenOriginal,
  clientShared,
  draggable,
  over,
  signStatus,
}: {
  item: DriveItem;
  onOpenFolder: (item: DriveItem) => void;
  onPreview: (item: DriveItem) => void;
  onDownload: (item: DriveItem) => void;
  onVersions?: (item: DriveItem) => void;
  onRename?: (item: DriveItem) => void;
  onShareClient?: (item: DriveItem) => void;
  onOpenOriginal?: (item: DriveItem) => void;
  clientShared: boolean;
  draggable: boolean;
  over: boolean;
  signStatus?: FileSignStatus;
}) {
  const { t } = useLanguage();
  const isFolder = item.kind === 'folder';
  const acceptsDrop = isFolder && draggable;

  const onDragStart = (e: DragEvent) => {
    setDragPayload(e.dataTransfer, { id: item.id, name: item.name, kind: item.kind });
  };
  const kind = driveFileKind(
    item.kind === 'shortcut' ? (item.shortcut_target_mime ?? item.mime_type) : item.mime_type,
    item.name,
  );
  const canPreview = item.kind === 'file';
  // Google-ийн өөрийн формат (Docs/Sheets) татахад PDF болно; товчлол,
  // Forms/Sites г.м. огт татагдахгүй.
  const canDownload =
    item.kind === 'file' &&
    (!item.mime_type.startsWith('application/vnd.google-apps.') ||
      item.preview === 'google');

  const activate = () => (isFolder ? onOpenFolder(item) : canPreview ? onPreview(item) : undefined);

  return (
    <TableRow
      className={cn(
        'group cursor-pointer border-border/50 transition-colors hover:bg-muted/40',
        over && 'bg-primary/10 outline outline-2 -outline-offset-2 outline-primary/60',
      )}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === 'Enter') activate();
      }}
      tabIndex={0}
      draggable={draggable}
      onDragStart={onDragStart}
      title={acceptsDrop ? t('projectDrive.dragHint') : undefined}
      data-drop-over={over ? 'true' : undefined}
      data-drop-kind={acceptsDrop ? 'folder' : undefined}
      data-drop-id={acceptsDrop ? item.id : undefined}
      data-drop-name={acceptsDrop ? item.name : undefined}
      data-id={item.id}
    >
      <TableCell className="py-2.5 pl-4">
        <div className="flex min-w-0 items-center gap-3">
          <DriveFileIcon kind={item.kind === 'shortcut' ? 'shortcut' : kind} />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1">
              <span className="truncate font-medium text-foreground">{item.name}</span>
              <SigningBadge status={signStatus} />
              {clientShared && (
                <span
                  className="shrink-0 rounded-full bg-emerald-500/15 px-1.5 py-px text-[10px] font-medium text-emerald-700 dark:text-emerald-300"
                  title={t('projectDrive.clientShare.sharedBadgeHint')}
                >
                  {t('projectDrive.clientShare.sharedBadge')}
                </span>
              )}
              {/* Нэр солих харандаа НЭРИЙН ХАЖУУД (эзний хүсэлт 2026-09-18) —
                  баруун талын үйлдлийн баганад биш; мөр дээр hover/focus, мэдрэгч
                  дэлгэц дээр үргэлж харагдана. */}
              {onRename && (
                <Button
                  size="icon-xs"
                  variant="ghost"
                  className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100"
                  title={t('projectDrive.rename')}
                  aria-label={t('projectDrive.rename')}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRename(item);
                  }}
                >
                  <Pencil />
                </Button>
              )}
            </div>
            {/* Жижиг дэлгэц дээр нуугдсан багануудыг нэрийн доор шахна. */}
            <div className="truncate text-[11px] text-muted-foreground md:hidden">
              {item.modified_time ? formatDateTime(item.modified_time) : ''}
              {item.size != null ? ` · ${formatBytes(item.size)}` : ''}
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell className="hidden py-2.5 text-muted-foreground md:table-cell">
        {item.modified_time ? formatDateTime(item.modified_time) : '—'}
      </TableCell>
      <TableCell className="hidden py-2.5 text-muted-foreground lg:table-cell">
        {t(driveKindLabelKey(item.kind === 'shortcut' ? 'shortcut' : kind))}
      </TableCell>
      <TableCell className="hidden py-2.5 text-right tabular-nums text-muted-foreground sm:table-cell">
        {isFolder ? '' : formatBytes(item.size)}
      </TableCell>
      <TableCell className="py-1.5 pr-3">
        <div
          className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          {canPreview && (
            <Button
              size="icon-sm"
              variant="ghost"
              title={t('projectDrive.preview')}
              aria-label={t('projectDrive.preview')}
              onClick={() => onPreview(item)}
            >
              <Eye className="h-4 w-4" />
            </Button>
          )}
          {item.open_url &&
            (onOpenOriginal && item.kind === 'file' && isDocxFile(item.mime_type, item.name) ? (
              <Button
                size="icon-sm"
                variant="ghost"
                title={t('projectDrive.openOriginal')}
                aria-label={t('projectDrive.openOriginal')}
                onClick={() => onOpenOriginal(item)}
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                size="icon-sm"
                variant="ghost"
                title={t('projectDrive.openOriginal')}
                aria-label={t('projectDrive.openOriginal')}
                asChild
              >
                <a href={item.open_url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            ))}
          {canDownload && (
            <Button
              size="icon-sm"
              variant="ghost"
              title={t('projectDrive.download')}
              aria-label={t('projectDrive.download')}
              onClick={() => onDownload(item)}
            >
              <Download className="h-4 w-4" />
            </Button>
          )}
          {item.kind === 'file' && onVersions && (
            <Button
              size="icon-sm"
              variant="ghost"
              title={t('projectDrive.versions')}
              aria-label={t('projectDrive.versions')}
              onClick={() => onVersions(item)}
            >
              <History className="h-4 w-4" />
            </Button>
          )}
          {onShareClient && item.kind !== 'shortcut' && (
            <Button
              size="icon-sm"
              variant="ghost"
              className={cn(clientShared && 'text-emerald-600')}
              title={t('projectDrive.clientShare.rowAction')}
              aria-label={t('projectDrive.clientShare.rowAction')}
              onClick={() => onShareClient(item)}
            >
              <Share2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
