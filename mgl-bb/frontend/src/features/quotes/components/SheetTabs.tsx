/**
 * Excel-маягийн доод хуудасны таб зурвас — олон хуудаст ажлын дэвтрийн (v3)
 * навигаци. Идэвхтэй таб цагаан (`bg-background`), бусад нь саарал.
 *
 * Горим:
 *   • `onChange` өгсөн + `readOnly` биш → бүрэн засвар: сонгох, нэмэх, устгах,
 *     нэр солих (2 дарж), чирж дараалал солих, баруун товшуураар цэс.
 *   • `onChange` өгсөн + `readOnly`   → зөвхөн таб СОНГОНО (activeSheet солино).
 *   • `onChange` алга                 → зөвхөн ХАРУУЛНА (хэвлэх хуудас; таб
 *     солих боломжгүй, учир нь activeSheet-ийг бичих газар байхгүй).
 *
 * ⚠️ Дараалал солих — `@dnd-kit`-ийн оронд ХӨТӨЧИЙН уугуул HTML5 drag-and-drop
 * ашигласан: ганц хэвтээ зурвасын хувьд dnd-kit-ийн sensor/collision аппарат
 * илүүц бөгөөд энэ chunk руу нэмэлт сан татахаас зайлсхийнэ. Гар/хулганаар
 * хүртээмжтэй байлгах үүднээс баруун товшуурын цэст «зүүн/баруун зөөх» мөн бий.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';

import {
  addSheet,
  moveSheet,
  removeSheet,
  renameSheet,
  setActiveSheet,
} from '../lib/workbookOps';
import type { WorkbookDoc } from '../types/quotes';

export interface SheetTabsProps {
  workbook: WorkbookDoc;
  /** Өгөөгүй бол зөвхөн унших (хэвлэх хуудас) — таб солих ч боломжгүй. */
  onChange?: (wb: WorkbookDoc) => void;
  readOnly?: boolean;
}

type Menu = { index: number; x: number; y: number };

function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Нэрийн хүчинтэй эсэхийг шалгана — inline алдаа харуулахад. */
function validateName(
  wb: WorkbookDoc,
  index: number,
  name: string,
): 'ok' | 'required' | 'duplicate' {
  const trimmed = name.trim();
  if (trimmed === '') return 'required';
  const key = nameKey(trimmed);
  if (wb.sheets.some((s, i) => i !== index && nameKey(s.name) === key)) return 'duplicate';
  return 'ok';
}

export function SheetTabs({ workbook, onChange, readOnly = false }: SheetTabsProps) {
  const { t } = useLanguage();
  const canSelect = typeof onChange === 'function';
  const canEdit = canSelect && !readOnly;

  const active = workbook.activeSheet ?? 0;

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [renameError, setRenameError] = useState<'required' | 'duplicate' | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);

  /* --- Цэс: гадна дарахад/Escape дарахад хаана --- */
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  /* --- Нэр солих оролтод анхаарал өгч, текстийг сонгоно --- */
  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const emit = useCallback(
    (next: WorkbookDoc) => {
      onChange?.(next);
    },
    [onChange],
  );

  const selectTab = useCallback(
    (index: number) => {
      if (!canSelect || index === active) return;
      emit(setActiveSheet(workbook, index));
    },
    [canSelect, active, emit, workbook],
  );

  const startRename = useCallback(
    (index: number) => {
      if (!canEdit) return;
      const sheet = workbook.sheets[index];
      if (!sheet) return;
      setEditingId(sheet.id);
      setDraft(sheet.name);
      setRenameError(null);
      setMenu(null);
    },
    [canEdit, workbook.sheets],
  );

  const commitRename = useCallback(
    (index: number) => {
      const verdict = validateName(workbook, index, draft);
      if (verdict === 'required') {
        setRenameError('required');
        return;
      }
      if (verdict === 'duplicate') {
        setRenameError('duplicate');
        return;
      }
      emit(renameSheet(workbook, index, draft));
      setEditingId(null);
      setRenameError(null);
    },
    [workbook, draft, emit],
  );

  const cancelRename = useCallback(() => {
    setEditingId(null);
    setRenameError(null);
  }, []);

  const doAdd = useCallback(() => {
    if (!canEdit) return;
    emit(addSheet(workbook, t('quotes.tabs.newName')));
  }, [canEdit, emit, workbook, t]);

  const doDelete = useCallback(
    (index: number) => {
      if (!canEdit || workbook.sheets.length <= 1) return;
      setMenu(null);
      if (!window.confirm(t('quotes.tabs.deleteConfirm'))) return;
      emit(removeSheet(workbook, index));
    },
    [canEdit, workbook, emit, t],
  );

  const doMove = useCallback(
    (from: number, to: number) => {
      if (!canEdit) return;
      setMenu(null);
      emit(moveSheet(workbook, from, to));
    },
    [canEdit, workbook, emit],
  );

  /* --- Уугуул HTML5 drag-and-drop дараалал --- */
  const onDrop = useCallback(
    (to: number) => {
      if (dragIndex !== null && dragIndex !== to) emit(moveSheet(workbook, dragIndex, to));
      setDragIndex(null);
      setOverIndex(null);
    },
    [dragIndex, workbook, emit],
  );

  return (
    <div className="flex items-stretch border-t border-border bg-muted/30 text-xs select-none">
      <div className="flex items-stretch overflow-x-auto">
        {workbook.sheets.map((sheet, index) => {
          const isActive = index === active;
          const isEditing = editingId === sheet.id;
          const isOver = overIndex === index && dragIndex !== null && dragIndex !== index;
          return (
            <div
              key={sheet.id}
              role="tab"
              aria-selected={isActive}
              title={sheet.name}
              draggable={canEdit && !isEditing}
              onClick={() => selectTab(index)}
              onDoubleClick={() => startRename(index)}
              onContextMenu={(e) => {
                if (!canEdit) return;
                e.preventDefault();
                setMenu({ index, x: e.clientX, y: e.clientY });
              }}
              onDragStart={() => setDragIndex(index)}
              onDragOver={(e) => {
                if (dragIndex === null) return;
                e.preventDefault();
                setOverIndex(index);
              }}
              onDrop={(e) => {
                e.preventDefault();
                onDrop(index);
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setOverIndex(null);
              }}
              className={cn(
                'relative flex items-center border-r border-border px-3 py-1 whitespace-nowrap',
                canSelect && 'cursor-pointer',
                isActive
                  ? 'bg-background text-foreground font-medium'
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted',
                isOver && 'outline outline-2 outline-offset-[-2px] outline-primary z-10',
              )}
            >
              {isEditing ? (
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    if (renameError) setRenameError(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={() => commitRename(index)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitRename(index);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      cancelRename();
                    }
                  }}
                  aria-invalid={renameError !== null}
                  title={
                    renameError === 'required'
                      ? t('quotes.tabs.nameRequired')
                      : renameError === 'duplicate'
                        ? t('quotes.tabs.nameDuplicate')
                        : undefined
                  }
                  className={cn(
                    'w-24 bg-transparent outline-none border-0 p-0 m-0 text-inherit font-inherit',
                    renameError && 'text-danger',
                  )}
                />
              ) : (
                <span>{sheet.name}</span>
              )}
            </div>
          );
        })}
      </div>

      {canEdit && (
        <button
          type="button"
          onClick={doAdd}
          title={t('quotes.tabs.add')}
          aria-label={t('quotes.tabs.add')}
          className="flex items-center px-2.5 text-muted-foreground hover:text-foreground hover:bg-muted"
        >
          +
        </button>
      )}

      {menu && canEdit && (
        <div
          role="menu"
          onMouseDown={(e) => e.stopPropagation()}
          style={{ top: menu.y, left: menu.x }}
          className="fixed z-50 min-w-[10rem] rounded-md border border-border bg-popover text-popover-foreground py-1 text-xs shadow-lg"
        >
          <MenuItem label={t('quotes.tabs.rename')} onClick={() => startRename(menu.index)} />
          <MenuItem
            label={t('quotes.tabs.moveLeft')}
            disabled={menu.index === 0}
            onClick={() => doMove(menu.index, menu.index - 1)}
          />
          <MenuItem
            label={t('quotes.tabs.moveRight')}
            disabled={menu.index === workbook.sheets.length - 1}
            onClick={() => doMove(menu.index, menu.index + 1)}
          />
          <MenuItem
            label={t('quotes.tabs.delete')}
            danger
            disabled={workbook.sheets.length <= 1}
            onClick={() => doDelete(menu.index)}
          />
        </div>
      )}
    </div>
  );
}

interface MenuItemProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}

function MenuItem({ label, onClick, disabled, danger }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'block w-full px-3 py-1.5 text-left hover:bg-muted disabled:opacity-40 disabled:pointer-events-none',
        danger && 'text-danger',
      )}
    >
      {label}
    </button>
  );
}

export default SheetTabs;
