/**
 * Ажилтны бөглөх хуудас — ГЭХДЭЭ засагдана.
 *
 * Зорилго нь `components/SectionPage.tsx`-ийн харагдацыг ТОЛЬДОХ: ижил
 * гарчгийн хэмжээ, ижил карт, ижил 1..5 товчны эгнээ.  Ялгаа нь бүх текст
 * `EditableText` (дарж засна) бөгөөд hover дээр бүтцийн товчнууд гарна.
 * Оноо өгөх товчнууд нь ЗӨВХӨН ХАРАГДАЦ — админ энд хариулт өгөхгүй.
 */
import { ArrowDown, ArrowUp, Indent, Outdent, Plus, Trash2 } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/ui/button';
import { Card, CardContent, CardHeader } from '@/ui/card';

import type { EditorPage, EditorSelection } from '../../lib/editorPages';
import {
  addGroup,
  addItem,
  addSection,
  canDemote,
  canMove,
  canPromote,
  demoteNode,
  moveNode,
  promoteNode,
  removeNode,
  scaleOf,
  updateGroup,
  updateItem,
  updatePart,
  updateSection,
} from '../../lib/schemaDraft';
import type { DraftNodeRef, SchemaDraft } from '../../lib/schemaDraft';
import { EditableText } from './EditableText';
import { IntroBlocks } from './IntroBlocks';

export interface EditablePageProps {
  draft: SchemaDraft;
  page: EditorPage;
  selected: EditorSelection | null;
  onChange: (next: SchemaDraft) => void;
  onSelect: (ref: EditorSelection | null) => void;
  onCommit: () => void;
}

/** Сонгогдсон эсэх — хүрээ тодруулахад. */
function isPicked(selected: EditorSelection | null, kind: string, key: string): boolean {
  return selected?.kind === kind && selected.key === key;
}

/**
 * Бүтцийн товчны эгнээ — зөвхөн hover / сонгогдсон үед харагдана.
 *
 * ⚠️ Модулийн ТҮВШИНД тодорхойлов (эцэг компонентын дотор БИШ): дотор нь
 * бичвэл түлхүүр дарах бүрд компонентын төрөл шинээр үүсч, React бүх
 * товчийг unmount/mount хийнэ — 200 мөртэй хуудсанд мэдэгдэхүйц сааталтай.
 */
interface ToolbarProps {
  draft: SchemaDraft;
  node: DraftNodeRef;
  selected: EditorSelection | null;
  t: (key: string, params?: Record<string, string | number>) => string;
  onChange: (next: SchemaDraft) => void;
  onSelect: (ref: EditorSelection | null) => void;
  extra?: React.ReactNode;
}

function NodeToolbar({ draft, node, selected, t, onChange, onSelect, extra }: ToolbarProps) {
  return (
    <div
      // Эцэг блокууд «сонгох»-оор дардаг тул товчны даралт дээшээ БҮҮ гараг:
      // эс бөгөөс устгасны дараа эцэг нь устсан зангилааг дахин сонгоно.
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'flex shrink-0 items-center gap-1 transition-opacity',
        isPicked(selected, node.kind, node.key)
          ? 'opacity-100'
          : 'opacity-0 focus-within:opacity-100 group-hover/node:opacity-100',
      )}
    >
      <Button
        variant="outline"
        size="icon-xs"
        title={t('assessments.builder.moveUp')}
        disabled={!canMove(draft, node, -1)}
        onClick={() => onChange(moveNode(draft, node, -1))}
      >
        <ArrowUp />
      </Button>
      <Button
        variant="outline"
        size="icon-xs"
        title={t('assessments.builder.moveDown')}
        disabled={!canMove(draft, node, 1)}
        onClick={() => onChange(moveNode(draft, node, 1))}
      >
        <ArrowDown />
      </Button>
      {extra}
      <Button
        variant="outline"
        size="icon-xs"
        className="text-destructive"
        title={t('assessments.builder.remove')}
        onClick={() => {
          onChange(removeNode(draft, node));
          onSelect(null);
        }}
      >
        <Trash2 />
      </Button>
    </div>
  );
}

/** Хэсэг → шинэ part болгох / өмнөх part-тай нэгтгэх (promote / demote). */
function LevelButtons({
  draft,
  node,
  t,
  onChange,
  onSelect,
}: Omit<ToolbarProps, 'selected' | 'extra'>) {
  return (
    <>
      <Button
        variant="outline"
        size="icon-xs"
        title={
          node.kind === 'section'
            ? t('assessments.editor.sectionToPart')
            : t('assessments.builder.promote')
        }
        disabled={!canPromote(draft, node)}
        onClick={() => {
          const edit = promoteNode(draft, node);
          onChange(edit.draft);
          if (edit.ref) onSelect(edit.ref);
        }}
      >
        <Outdent />
      </Button>
      <Button
        variant="outline"
        size="icon-xs"
        title={
          node.kind === 'section'
            ? t('assessments.editor.sectionMergeUp')
            : t('assessments.builder.demote')
        }
        disabled={!canDemote(draft, node)}
        onClick={() => {
          const edit = demoteNode(draft, node);
          onChange(edit.draft);
          if (edit.ref) onSelect(edit.ref);
        }}
      >
        <Indent />
      </Button>
    </>
  );
}

export function EditablePage({
  draft,
  page,
  selected,
  onChange,
  onSelect,
  onCommit,
}: EditablePageProps) {
  const { t } = useLanguage();

  if (page.kind === 'intro') {
    return (
      <IntroBlocks
        draft={draft}
        selected={selected}
        onChange={onChange}
        onSelect={onSelect}
        onCommit={onCommit}
      />
    );
  }

  const { part, sections } = page;
  const scale = scaleOf(draft, part);
  const partRef: DraftNodeRef = { kind: 'part', key: part.key };
  const shared = { draft, selected, t, onChange, onSelect };

  return (
    <div className="space-y-6 pt-4">
      {/* -------- Part-ын толгой (ажилтны талд: жижиг ягаан гарчиг) -------- */}
      <div
        className="group/node space-y-1"
        onFocusCapture={() => onSelect(partRef)}
        onClick={() => onSelect(partRef)}
      >
        <div className="flex items-start gap-2">
          <EditableText
            value={part.title}
            ariaLabel={t('assessments.builder.fieldTitle')}
            placeholder={t('assessments.editor.partTitlePlaceholder')}
            onChange={(v) => onChange(updatePart(draft, part.key, { title: v }))}
            onCommit={onCommit}
            className="text-label font-semibold uppercase tracking-wide text-primary"
          />
          <NodeToolbar {...shared} node={partRef} />
        </div>
        <EditableText
          multiline
          value={part.intro ?? ''}
          ariaLabel={t('assessments.builder.fieldIntro')}
          placeholder={t('assessments.editor.partIntroPlaceholder')}
          onChange={(v) => onChange(updatePart(draft, part.key, { intro: v }))}
          onCommit={onCommit}
          className="text-body text-muted-foreground"
        />
      </div>

      {/* ---------------------------- Хэсгүүд ---------------------------- */}
      {sections.map((section) => {
        const sectionRef: DraftNodeRef = { kind: 'section', key: section.key };
        let counter = 0;

        return (
          <section key={section.key} className="space-y-3">
            <header
              className="group/node space-y-1"
              onFocusCapture={() => onSelect(sectionRef)}
              onClick={() => onSelect(sectionRef)}
            >
              <div className="flex items-start gap-2">
                <EditableText
                  value={section.title}
                  ariaLabel={t('assessments.builder.fieldTitle')}
                  placeholder={t('assessments.editor.sectionTitlePlaceholder')}
                  onChange={(v) => onChange(updateSection(draft, section.key, { title: v }))}
                  onCommit={onCommit}
                  className="text-lg font-semibold leading-tight text-foreground"
                />
                <NodeToolbar
                  {...shared}
                  node={sectionRef}
                  extra={<LevelButtons {...shared} node={sectionRef} />}
                />
              </div>
              <EditableText
                value={section.subtitle ?? ''}
                ariaLabel={t('assessments.builder.fieldSubtitle')}
                placeholder={t('assessments.editor.subtitlePlaceholder')}
                onChange={(v) => onChange(updateSection(draft, section.key, { subtitle: v }))}
                onCommit={onCommit}
                className="text-sm font-medium text-muted-foreground"
              />
              <EditableText
                multiline
                value={section.description ?? ''}
                ariaLabel={t('assessments.builder.fieldDescription')}
                placeholder={t('assessments.editor.descriptionPlaceholder')}
                onChange={(v) => onChange(updateSection(draft, section.key, { description: v }))}
                onCommit={onCommit}
                className="text-sm leading-relaxed text-muted-foreground"
              />
            </header>

            {section.groups.map((group) => {
              const groupRef: DraftNodeRef = { kind: 'group', key: group.key };
              return (
                <Card
                  key={group.key}
                  className={cn(
                    'border-border bg-card/60 transition-colors',
                    isPicked(selected, 'group', group.key) && 'border-primary/60',
                  )}
                >
                  <CardHeader
                    className="group/node pb-2"
                    onFocusCapture={() => onSelect(groupRef)}
                    onClick={() => onSelect(groupRef)}
                  >
                    <div className="flex items-start gap-2">
                      <EditableText
                        multiline
                        value={group.title}
                        ariaLabel={t('assessments.builder.fieldTitle')}
                        placeholder={t('assessments.editor.groupTitlePlaceholder')}
                        onChange={(v) => onChange(updateGroup(draft, group.key, { title: v }))}
                        onCommit={onCommit}
                        className="text-base font-semibold leading-tight"
                      />
                      <NodeToolbar
                        {...shared}
                        node={groupRef}
                        extra={<LevelButtons {...shared} node={groupRef} />}
                      />
                    </div>
                    <EditableText
                      multiline
                      value={group.hint ?? ''}
                      ariaLabel={t('assessments.builder.fieldHint')}
                      placeholder={t('assessments.editor.hintPlaceholder')}
                      onChange={(v) => onChange(updateGroup(draft, group.key, { hint: v }))}
                      onCommit={onCommit}
                      className="text-sm leading-snug text-muted-foreground"
                    />
                  </CardHeader>

                  <CardContent className="divide-y divide-border/60 py-1">
                    {group.items.map((item) => {
                      counter += 1;
                      const itemRef: DraftNodeRef = { kind: 'item', key: item.key };
                      return (
                        <div
                          key={item.key}
                          className="group/node flex flex-col gap-2 py-2.5 pl-1 pr-1 sm:flex-row sm:items-center sm:gap-3"
                          onFocusCapture={() => onSelect(itemRef)}
                          onClick={() => onSelect(itemRef)}
                        >
                          <span className="mt-1 shrink-0 select-none text-micro font-semibold tabular-nums text-muted-foreground">
                            {counter}.
                          </span>
                          <EditableText
                            multiline
                            value={item.text}
                            ariaLabel={t('assessments.builder.fieldText')}
                            placeholder={t('assessments.editor.itemTextPlaceholder')}
                            onChange={(v) => onChange(updateItem(draft, item.key, { text: v }))}
                            onCommit={onCommit}
                            className="min-w-0 flex-1 text-sm leading-snug text-foreground"
                          />
                          {/* Оноо өгөх товчнууд — зөвхөн харагдац (админ хариулахгүй). */}
                          <div
                            aria-hidden
                            className="flex shrink-0 items-center gap-1.5 self-end sm:self-auto"
                          >
                            {scale.options
                              .slice()
                              .sort((a, b) => a.value - b.value)
                              .map((opt) => (
                                <span
                                  key={opt.value}
                                  title={opt.label}
                                  className="flex h-9 min-w-9 items-center justify-center rounded-md border border-input bg-background text-sm font-semibold tabular-nums text-muted-foreground/70"
                                >
                                  {opt.value}
                                </span>
                              ))}
                          </div>
                          <NodeToolbar
                            {...shared}
                            node={itemRef}
                            extra={
                              <Button
                                variant="outline"
                                size="icon-xs"
                                title={t('assessments.builder.addSibling')}
                                onClick={() => {
                                  const edit = addItem(draft, itemRef);
                                  onChange(edit.draft);
                                  if (edit.ref) onSelect(edit.ref);
                                }}
                              >
                                <Plus />
                              </Button>
                            }
                          />
                        </div>
                      );
                    })}

                    <div className="py-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const edit = addItem(draft, groupRef);
                          onChange(edit.draft);
                          if (edit.ref) onSelect(edit.ref);
                        }}
                      >
                        <Plus /> {t('assessments.builder.addItem')}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const edit = addGroup(draft, sectionRef);
                onChange(edit.draft);
                if (edit.ref) onSelect(edit.ref);
              }}
            >
              <Plus /> {t('assessments.builder.addGroup')}
            </Button>
          </section>
        );
      })}

      <div className="border-t border-dashed border-border pt-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            // Сүүлийн хэсгийн АРД нэмнэ; хэсэггүй бол part-ын төгсгөлд.
            const last = sections[sections.length - 1];
            const anchor: DraftNodeRef = last ? { kind: 'section', key: last.key } : partRef;
            const edit = addSection(draft, anchor);
            onChange(edit.draft);
            if (edit.ref) onSelect(edit.ref);
          }}
        >
          <Plus /> {t('assessments.builder.addSection')}
        </Button>
      </div>
    </div>
  );
}

export default EditablePage;
