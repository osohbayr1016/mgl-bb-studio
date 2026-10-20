/** The collapsed/expanded header of one block card: drag grip, name,
 *  weight input, counts and the duplicate/delete overflow actions.
 *
 *  Extracted verbatim from `AdminProjectSetupPage.tsx` — no behavioural
 *  change. */
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { CardHeader } from '@/ui/card';
import { Check, ChevronRight, Copy, GripVertical, Pencil, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Input } from '@/ui/input';
import { WeightInput } from './WeightInput';
import { cn } from '@/shared/lib/utils';
import type { SortableHandle } from './SortableShells';
import type { Block } from './types';
import type { SetupApi } from './useProjectSetup';

type Props = Pick<
  SetupApi,
  | 'delBlock'
  | 'dupBlock'
  | 'renameBlock'
  | 'saving'
  | 'setExpBlocks'
  | 'setLastOpenedBlock'
  | 't'
  | 'uBlock'
> & {
  block: Block;
  dragHandle: SortableHandle;
  isOpen: boolean;
};

/** `POST /blocks/:id/duplicate` names the clone «<нэр> (хуулбар)» — the pencil
 *  lives exactly as long as that suffix does, so it only ever shows on a block
 *  that was duplicated and not yet renamed. */
const COPY_SUFFIX_RE = /\(хуулбар\)\s*$/;

export function BlockCardHeader(props: Props) {
  const {
    isOpen,
    delBlock,
    dupBlock,
    renameBlock,
    saving,
    setExpBlocks,
    setLastOpenedBlock,
    t,
    uBlock,
    block,
    dragHandle,
  } = props;

  const isCopy = COPY_SUFFIX_RE.test(block.name);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const startRename = () => {
    setDraft(block.name.replace(COPY_SUFFIX_RE, '').trimEnd());
    setRenaming(true);
  };
  const commitRename = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await renameBlock(block.id, draft);
    setBusy(false);
    if (ok) setRenaming(false);
  };

  return (
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <button
                            type="button"
                            className="flex items-center justify-center h-9 w-6 -ml-1 rounded-md cursor-grab active:cursor-grabbing text-muted-subtle hover:text-muted-foreground hover:bg-muted/40 transition-colors flex-shrink-0 touch-none"
                            title={t('adminProjectSetupPage.dragToReorder')}
                            {...dragHandle.attributes}
                            {...dragHandle.listeners}
                          >
                            <GripVertical className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setExpBlocks((prev) => {
                                const next = new Set(prev);
                                if (isOpen) next.delete(block.id);
                                else next.add(block.id);
                                return next;
                              });
                              if (!isOpen) setLastOpenedBlock(block.id);
                            }}
                            className={cn(
                              'flex items-center gap-2 rounded-md px-1.5 py-1 -ml-1.5',
                              'hover:bg-muted/40 transition-colors flex-shrink-0',
                            )}
                            aria-expanded={isOpen}
                            title={isOpen ? t('adminProjectSetupPage.collapse') : t('common.open')}
                          >
                            <ChevronRight
                              className={cn('w-4 h-4 transition-transform', isOpen && 'rotate-90')}
                            />
                            <Badge className="bg-primary/20 text-primary">
                              {t('adminProjectSetupPage.block')}
                            </Badge>
                          </button>
                          {renaming ? (
                            <div className="flex items-center gap-1 min-w-[220px] flex-1 max-w-md">
                              <Input
                                autoFocus
                                value={draft}
                                onFocus={(e) => e.currentTarget.select()}
                                onChange={(e) => setDraft(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') void commitRename();
                                  else if (e.key === 'Escape') setRenaming(false);
                                }}
                                disabled={busy}
                                className="h-10 flex-1"
                                placeholder={t('adminProjectSetupPage.blockNamePlaceholder')}
                              />
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-9 w-9 text-success"
                                onClick={() => void commitRename()}
                                title={t('adminProjectSetupPage.renameSave')}
                                disabled={busy || !draft.trim()}
                              >
                                <Check className="w-4 h-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-9 w-9"
                                onClick={() => setRenaming(false)}
                                title={t('adminProjectSetupPage.renameCancel')}
                                disabled={busy}
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            </div>
                          ) : (
                            <>
                              <Input
                                value={block.name}
                                onChange={(e) => uBlock(block.id, 'name', e.target.value)}
                                className="h-10 min-w-[220px] flex-1 max-w-md"
                                placeholder={t('adminProjectSetupPage.blockNamePlaceholder')}
                              />
                              {isCopy && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-9 w-9"
                                  onClick={startRename}
                                  title={t('adminProjectSetupPage.renameBlock')}
                                >
                                  <Pencil className="w-4 h-4" />
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <WeightInput
                            value={block.weight_percent}
                            onChange={(v) => uBlock(block.id, 'weight_percent', v)}
                            label={t('adminProjectSetupPage.weightLabelTeam')}
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-9 w-9"
                            onClick={() => dupBlock(block.id)}
                            title={t('adminProjectSetupPage.copyBlock')}
                            disabled={saving}
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-9 w-9 text-destructive"
                            onClick={() => delBlock(block.id)}
                            title={t('adminProjectSetupPage.deleteBlock')}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
  );
}

export default BlockCardHeader;
