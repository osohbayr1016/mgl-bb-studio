/* Хуваарилагдсан таскийн «Миний хэсэг» цэс — «Миний ажлууд»-ын мөрөнд (2026-10-02).
 *
 *   ⋯ → Хуваарилалт засах · Үлдсэн ажлаа буцаах / шилжүүлэх · Хуваалтыг цуцлах (анхны байдалд, 2026-10-06) ·
 *       Миний бүртгэл (явц засах/сэргээх, цаг хүчингүй болгох) */
import { useState } from 'react';
import { History, MoreHorizontal, RotateCcw, Undo2, Users } from 'lucide-react';

import { Button } from '@/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { useLanguage } from '@/shared/i18n';

import { AllocationEditorDialog } from './AllocationEditorDialog';
import { OwnRecordsDialog } from './OwnRecordsDialog';
import { ReleaseDialog } from './ReleaseDialog';
import { UnsplitDialog } from './UnsplitDialog';
import { useTaskAllocGate } from './useTaskAllocGate';

type Open = 'edit' | 'release' | 'unsplit' | 'records' | null;

export function ManagedRowActions({
  task,
  canRelease,
  canEdit = true,
  canUnsplit = false,
  canRecords = true,
  disabled = false,
  onChanged,
}: {
  task: { id: number; name: string };
  /** Надад ирээдүйн ажил (T > D) байна — буцаах боломжтой. */
  canRelease: boolean;
  /** Хуваарилалт засах (оролцогч эсвэл ахлах/админ — сервер дахин шалгана). */
  canEdit?: boolean;
  /** «Хуваалтыг цуцлах» — таскийг огт хуваагаагүй анхны байдалд (оролцогч эсвэл ахлах/админ — сервер дахин шалгана). */
  canUnsplit?: boolean;
  /** «Миний бүртгэл» — надад хуваарилалт байвал. */
  canRecords?: boolean;
  disabled?: boolean;
  /** Бүтэц өөрчлөгдсөний дараа (жагсаалт дахин уншина). */
  onChanged?: () => void;
}) {
  const { t } = useLanguage();
  const gate = useTaskAllocGate();
  const locked = !gate.writable;
  const [open, setOpen] = useState<Open>(null);
  const close = () => {
    setOpen(null);
    onChanged?.();
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
            disabled={disabled}
            title={t('taskAlloc.menu.title')}
            aria-label={t('taskAlloc.menu.title')}
            data-testid="managed-menu"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canEdit && (
            <DropdownMenuItem onSelect={() => setOpen('edit')} disabled={locked} title={locked ? t('taskAlloc.gate.locked') : undefined} data-testid="managed-menu-edit">
              <Users className="h-4 w-4" />
              {t('taskAlloc.menu.edit')}
            </DropdownMenuItem>
          )}
          {canRelease && (
            <DropdownMenuItem onSelect={() => setOpen('release')} disabled={locked} title={locked ? t('taskAlloc.gate.locked') : undefined} data-testid="managed-menu-release">
              <Undo2 className="h-4 w-4" />
              {t('taskAlloc.menu.release')}
            </DropdownMenuItem>
          )}
          {canUnsplit && (
            <DropdownMenuItem
              onSelect={() => setOpen('unsplit')}
              disabled={locked}
              title={locked ? t('taskAlloc.gate.locked') : t('taskAlloc.menu.unsplitTitle')}
              className="text-destructive focus:text-destructive"
              data-testid="managed-menu-unsplit"
            >
              <RotateCcw className="h-4 w-4" />
              {t('taskAlloc.menu.unsplit')}
            </DropdownMenuItem>
          )}
          {canRecords && (
            <DropdownMenuItem onSelect={() => setOpen('records')} data-testid="managed-menu-records">
              <History className="h-4 w-4" />
              {t('taskAlloc.menu.records')}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {open === 'edit' && <AllocationEditorDialog task={task} onClose={close} />}
      {open === 'release' && <ReleaseDialog task={task} onClose={close} />}
      {open === 'unsplit' && <UnsplitDialog task={task} onClose={close} />}
      {open === 'records' && <OwnRecordsDialog task={task} onClose={close} />}
    </>
  );
}

export default ManagedRowActions;
