/**
 * Танилцуулга хуудас — засварлагчийн 1-р хуудас.
 *
 * Word-оос ирсэн оноо өгөх мөргүй хэсгүүд («СУДАЛГААНЫ АГУУЛГА», «СУДАЛГАА
 * НЬ ҮНДСЭН 2 ХЭСЭГТ ХУВААГДАНА») энд орж ирнэ.  Ажилтан бөглөж эхлэхийн
 * ӨМНӨ яг ийм байдлаар (зөвхөн уншина) харна.
 */
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';

import {
  addIntroBlock,
  moveIntroBlock,
  removeIntroBlock,
  updateIntroBlock,
} from '../../lib/schemaDraft';
import type { SchemaDraft } from '../../lib/schemaDraft';
import type { EditorSelection } from '../../lib/editorPages';
import { EditableText } from './EditableText';

interface Props {
  draft: SchemaDraft;
  selected: EditorSelection | null;
  onChange: (next: SchemaDraft) => void;
  onSelect: (ref: EditorSelection | null) => void;
  onCommit: () => void;
}

export function IntroBlocks({ draft, selected, onChange, onSelect, onCommit }: Props) {
  const { t } = useLanguage();

  return (
    <div className="space-y-4 pt-4">
      <div className="space-y-1">
        <p className="text-label font-semibold uppercase tracking-wide text-primary">
          {t('assessments.editor.introPageTitle')}
        </p>
        <p className="text-body text-muted-foreground">{t('assessments.editor.introPageHint')}</p>
      </div>

      {draft.intro.map((block, index) => {
        const picked = selected?.kind === 'intro' && selected.key === block.key;
        return (
          <Card
            key={block.key}
            className={cn(
              'group/node border-border bg-card/60 transition-colors',
              picked && 'border-primary/60',
            )}
            onFocusCapture={() => onSelect({ kind: 'intro', key: block.key })}
            onClick={() => onSelect({ kind: 'intro', key: block.key })}
          >
            <CardContent className="space-y-1 py-3">
              <div className="flex items-start gap-2">
                <EditableText
                  multiline
                  value={block.heading}
                  ariaLabel={t('assessments.editor.introHeading')}
                  placeholder={t('assessments.editor.introHeadingPlaceholder')}
                  onChange={(v) => onChange(updateIntroBlock(draft, block.key, { heading: v }))}
                  onCommit={onCommit}
                  className="text-base font-semibold leading-tight text-foreground"
                />
                <div
                  // Картын «сонгох» даралт руу БҮҮ гараг — устгасны дараа
                  // устсан блокийг дахин сонгохоос сэргийлнэ.
                  onClick={(e) => e.stopPropagation()}
                  className={cn(
                    'flex shrink-0 items-center gap-1 transition-opacity',
                    picked ? 'opacity-100' : 'opacity-0 group-hover/node:opacity-100',
                  )}
                >
                  <Button
                    variant="outline"
                    size="icon-xs"
                    title={t('assessments.builder.moveUp')}
                    disabled={index === 0}
                    onClick={() => onChange(moveIntroBlock(draft, block.key, -1))}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-xs"
                    title={t('assessments.builder.moveDown')}
                    disabled={index >= draft.intro.length - 1}
                    onClick={() => onChange(moveIntroBlock(draft, block.key, 1))}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-xs"
                    title={t('assessments.builder.addSibling')}
                    onClick={() => onChange(addIntroBlock(draft, block.key))}
                  >
                    <Plus />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-xs"
                    className="text-destructive"
                    title={t('assessments.builder.remove')}
                    onClick={() => {
                      onChange(removeIntroBlock(draft, block.key));
                      onSelect(null);
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
              <EditableText
                multiline
                value={block.body}
                ariaLabel={t('assessments.editor.introBody')}
                placeholder={t('assessments.editor.introBodyPlaceholder')}
                onChange={(v) => onChange(updateIntroBlock(draft, block.key, { body: v }))}
                onCommit={onCommit}
                className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground"
              />
            </CardContent>
          </Card>
        );
      })}

      <Button variant="outline" size="sm" onClick={() => onChange(addIntroBlock(draft))}>
        <Plus /> {t('assessments.editor.addIntroBlock')}
      </Button>
    </div>
  );
}

export default IntroBlocks;
