/**
 * Онооны шатлалын (1..5) тайлбар засах диалог.
 *
 * Хуучин `TemplateBuilder`-ийн «Rating scales» табаас нүүсэн — шинэ бүтэн
 * дэлгэцийн засварлагчид таб байхгүй тул баруун панелиас нээгддэг диалог
 * болов.  Эдгээр тайлбар нь ажилтны хуудасны оройн legend-д гарна.
 */
import { useLanguage } from '@/shared/i18n';
import { Badge } from '@/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogScrollableBody,
  DialogTitle,
} from '@/ui/dialog';
import { Input } from '@/ui/input';
import { Textarea } from '@/ui/textarea';

import { updateScales } from '../../lib/schemaDraft';
import type { SchemaDraft } from '../../lib/schemaDraft';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: SchemaDraft;
  onChange: (next: SchemaDraft) => void;
  onCommit: () => void;
}

export function ScalesDialog({ open, onOpenChange, draft, onChange, onCommit }: Props) {
  const { t } = useLanguage();

  const patch = (
    scaleIndex: number,
    optionIndex: number,
    field: 'label' | 'caption',
    value: string,
  ) => {
    const scales = draft.scales.map((scale, si) =>
      si !== scaleIndex
        ? scale
        : {
            ...scale,
            options: scale.options.map((option, oi) =>
              oi !== optionIndex ? option : { ...option, [field]: value },
            ),
          },
    );
    onChange(updateScales(draft, scales));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('assessments.builder.tabScales')}</DialogTitle>
          <DialogDescription>{t('assessments.editor.scalesHint')}</DialogDescription>
        </DialogHeader>

        <DialogScrollableBody className="space-y-4 sm:max-h-[70vh] sm:overflow-y-auto">
          {draft.scales.map((scale, si) => (
            <div key={scale.id} className="rounded-lg border p-3">
              <div className="mb-2 flex items-center gap-2">
                <Input
                  className="max-w-xs"
                  value={scale.label}
                  onBlur={onCommit}
                  onChange={(e) =>
                    onChange(
                      updateScales(
                        draft,
                        draft.scales.map((s, i) =>
                          i === si ? { ...s, label: e.target.value } : s,
                        ),
                      ),
                    )
                  }
                />
                <Badge variant="outline">
                  {scale.min}–{scale.max}
                </Badge>
              </div>
              <div className="space-y-2">
                {scale.options.map((option, oi) => (
                  <div
                    key={option.value}
                    className="grid gap-2 sm:grid-cols-[3rem_12rem_minmax(0,1fr)]"
                  >
                    <div className="grid place-items-center rounded-md border text-sm font-medium tabular-nums">
                      {option.value}
                    </div>
                    <Input
                      value={option.label}
                      placeholder={t('assessments.builder.scaleOptionLabel')}
                      onBlur={onCommit}
                      onChange={(e) => patch(si, oi, 'label', e.target.value)}
                    />
                    <Textarea
                      rows={2}
                      value={option.caption ?? ''}
                      placeholder={t('assessments.builder.scaleOptionCaption')}
                      onBlur={onCommit}
                      onChange={(e) => patch(si, oi, 'caption', e.target.value)}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </DialogScrollableBody>
      </DialogContent>
    </Dialog>
  );
}

export default ScalesDialog;
