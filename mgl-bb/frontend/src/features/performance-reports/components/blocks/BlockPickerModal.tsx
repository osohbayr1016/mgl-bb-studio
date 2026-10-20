import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/dialog';
import {
  BLOCK_TYPES,
  BLOCK_TYPE_META,
  type BlockType,
} from '@/features/performance-reports/types/performanceReportBlocks';
import type { ReportBlock } from '@/features/performance-reports/types/performanceReportBlocks';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';

/* Block picker — modal grid of available kinds.
 * Hides kinds that are already on the report when their meta
 * disallows multiple instances (cover, TOC, intro, summary,
 * consolidated stats). */
export interface BlockPickerModalProps {
  open: boolean;
  blocks: ReportBlock[];
  onPick: (type: BlockType) => void;
  onClose: () => void;
}

const GROUP_LABEL_KEYS: Record<string, string> = {
  structure: 'blockPickerModal.groupStructure',
  team: 'blockPickerModal.groupTeam',
  content: 'blockPickerModal.groupContent',
};

export function BlockPickerModal({ open, blocks, onPick, onClose }: BlockPickerModalProps) {
  const { t } = useLanguage();
  const inUse = new Set(blocks.map((b) => b.type));
  const usable = BLOCK_TYPES.filter((t) => {
    const meta = BLOCK_TYPE_META[t];
    return meta.allowedMultiple || !inUse.has(t);
  });

  const grouped: Record<string, BlockType[]> = {};
  for (const t of usable) {
    const g = BLOCK_TYPE_META[t].group;
    (grouped[g] ??= []).push(t);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('blockPickerModal.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2 max-h-[60vh] overflow-y-auto">
          {Object.entries(grouped).map(([group, types]) => {
            const groupKey = GROUP_LABEL_KEYS[group];
            return (
            <div key={group}>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
                {groupKey ? t(groupKey) : group}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {types.map((t) => {
                  const meta = BLOCK_TYPE_META[t];
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        onPick(t);
                        onClose();
                      }}
                      className={cn(
                        'text-left border rounded-md p-3 hover:border-primary/60 hover:bg-primary/5 transition-colors',
                      )}
                    >
                      <div className="text-sm font-medium">{meta.label_mn}</div>
                      <div className="text-[11px] text-muted-foreground mt-1 leading-snug">
                        {meta.description_mn}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
            );
          })}
          {usable.length === 0 && (
            <p className="text-sm text-muted-foreground italic">
              {t('blockPickerModal.allAdded')}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
