/**
 * «Word дээр 2 судалгаа байсан бололтой — салгах уу?» диалог.
 *
 * Автомат таних 100% байх боломжгүй тул салгалт ХЭЗЭЭ Ч өөрөө хэрэгжихгүй
 * (docs/dev/assessments-spec.md §8) — админ энд нүдээр шалгаж зөвшөөрнө.
 * Татгалзвал бүх зүйл нэг part дотор хэвээр үлдэж, засварлагч дээр гараар
 * «Шинэ part болгох» товчоор хэдийд ч салгаж болно.
 */
import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';

import type { PartSplitProposal } from '../../lib/schemaDraft';

interface Props {
  open: boolean;
  proposal: PartSplitProposal;
  onOpenChange: (open: boolean) => void;
  onAccept: () => void;
}

export function SplitPartsPrompt({ open, proposal, onOpenChange, onAccept }: Props) {
  const { t } = useLanguage();
  const usable = proposal.parts.filter((p) => p.itemCount > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('assessments.editor.splitTitle', { count: usable.length })}</DialogTitle>
          <DialogDescription>{t('assessments.editor.splitDescription')}</DialogDescription>
        </DialogHeader>

        <ul className="space-y-2">
          {proposal.parts.map((part, i) => (
            <li
              key={`${part.from}-${i}`}
              className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {part.title || t('assessments.editor.splitUntitled', { n: i + 1 })}
                </span>
                <span className="text-xs text-muted-foreground">
                  {part.behavior
                    ? t('assessments.editor.splitBehaviorNote')
                    : t('assessments.editor.splitSkillNote')}
                </span>
              </span>
              <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {t('assessments.editor.splitCounts', {
                  sections: part.sectionCount,
                  items: part.itemCount,
                })}
              </span>
            </li>
          ))}
        </ul>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('assessments.editor.splitKeepOne')}
          </Button>
          <Button onClick={onAccept}>{t('assessments.editor.splitApply')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default SplitPartsPrompt;
