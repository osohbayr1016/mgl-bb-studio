/**
 * Per-block-type edit forms for the admin CMS.
 *
 * Each editor is a controlled form bound to a `BlockEditState<T>` from
 * `useBlockEditState(block, pageId)`. Inputs call `state.patch(...)` on
 * change and `state.commitIfDirty()` on blur — that fires the autosave
 * PATCH if anything changed since the last commit.
 *
 * Array fields (services items, gallery images, etc.) use a small
 * generic `<ItemListEditor>` that handles add/remove. Drag-to-reorder
 * inside an item list is done with `@dnd-kit/sortable` here; the
 * parent block list does its own `@dnd-kit` context one level up.
 *
 * For Phase 2 we focus on functionality; the layout is dense but
 * readable. The block picker modal and per-block accordion live in
 * BlockListEditor — these are just the forms.
 */

import type { ReactNode } from 'react';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { useAppDndSensors } from '@/shared/lib/dndSensors';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { nanoid } from 'nanoid';

import { BilingualField } from '@/features/landing/components/BilingualField';
import { ImagePicker } from '@/features/landing/components/ImagePicker';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import type {
  AboutContent,
  AwardItem,
  AwardsContent,
  BlockType,
  ContactContent,
  CtaContent,
  DividerContent,
  GalleryImage,
  HeroContent,
  ImageContent,
  ImageGalleryContent,
  NewsContent,
  NewsItem,
  PartnerItem,
  PartnersContent,
  ProjectCreditsContent,
  ProjectGridContent,
  RichTextContent,
  ServiceItem,
  ServicesContent,
  StatTile,
  StatsContent,
  ImageComparisonContent,
} from '@/features/landing/types/landingBlocks';
import type { BlockEditState } from '@/features/landing/components/admin/saveState';

/* ------------------------------------------------------------------ */
/*  Generic helpers                                                    */
/* ------------------------------------------------------------------ */

/** Wraps a labelled section of fields. Used inside every editor to
 *  group related inputs (hero CTA, contact socials, etc.). */
function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Dispatch dispatcher for the BlockListEditor — picks the right form
 *  for a block's `type`. Kept here so the per-type union is exhaustive. */
export function BlockEditor<T extends BlockType>({
  state,
  type,
}: {
  state: BlockEditState<T>;
  type: T;
}) {
  // Each branch narrows on `type` at runtime; the cast through `unknown`
  // is necessary because TS can't follow the relationship from the
  // generic `BlockEditState<T>` back to a specific block type's state.
  const s = state as unknown;
  switch (type) {
    case 'hero':
      return <HeroEditor state={s as BlockEditState<'hero'>} />;
    case 'project-grid':
      return <ProjectGridEditor state={s as BlockEditState<'project-grid'>} />;
    case 'services':
      return <ServicesEditor state={s as BlockEditState<'services'>} />;
    case 'about':
      return <AboutEditor state={s as BlockEditState<'about'>} />;
    case 'stats':
      return <StatsEditor state={s as BlockEditState<'stats'>} />;
    case 'awards':
      return <AwardsEditor state={s as BlockEditState<'awards'>} />;
    case 'partners':
      return <PartnersEditor state={s as BlockEditState<'partners'>} />;
    case 'news':
      return <NewsEditor state={s as BlockEditState<'news'>} />;
    case 'contact':
      return <ContactEditor state={s as BlockEditState<'contact'>} />;
    case 'rich-text':
      return <RichTextEditor state={s as BlockEditState<'rich-text'>} />;
    case 'image':
      return <ImageEditor state={s as BlockEditState<'image'>} />;
    case 'image-gallery':
      return <ImageGalleryEditor state={s as BlockEditState<'image-gallery'>} />;
    case 'divider':
      return <DividerEditor state={s as BlockEditState<'divider'>} />;
    case 'cta':
      return <CtaEditor state={s as BlockEditState<'cta'>} />;
    case 'project-credits':
      return <ProjectCreditsEditor state={s as BlockEditState<'project-credits'>} />;
    case 'image-comparison':
      return <ImageComparisonEditor state={s as BlockEditState<'image-comparison'>} />;
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Sortable item-list helper                                          */
/* ------------------------------------------------------------------ */

interface ItemListEditorProps<T> {
  items: T[];
  onChange: (next: T[]) => void;
  /** Called when the user blurs or reorders — autosave hook. */
  onBlur: () => void;
  /** Render the inputs for a single item. The item already has a stable
   *  id (see `ensureIds`). */
  renderItem: (item: T, update: (next: T) => void, onBlur: () => void) => ReactNode;
  /** Factory for a new empty item (used by the "+ Add" button). */
  newItem: () => T;
  /** Friendly label shown when the list is empty (e.g. "Үйлчилгээ нэмэх"). */
  addLabel: string;
  /** Max items allowed — Stats block caps at 4. */
  maxItems?: number;
}

/** Ensures every item has a stable client_id for drag/key purposes. The
 *  id is not persisted; it's stripped on commit when this matters. */
type WithClientId<T> = T & { __cid?: string };
function ensureIds<T>(items: T[]): Array<WithClientId<T>> {
  return items.map((it) => {
    const cur = it as WithClientId<T>;
    if (cur.__cid) return cur;
    return { ...cur, __cid: nanoid(8) };
  });
}

function ItemListEditor<T>({
  items,
  onChange,
  onBlur,
  renderItem,
  newItem,
  addLabel,
  maxItems,
}: ItemListEditorProps<T>) {
  const withIds = ensureIds(items);
  const sensors = useAppDndSensors();

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = withIds.findIndex((i) => i.__cid === active.id);
    const newIndex = withIds.findIndex((i) => i.__cid === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onChange(arrayMove(withIds, oldIndex, newIndex) as T[]);
    onBlur();
  };

  return (
    <div className="space-y-3">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={withIds.map((i) => i.__cid as string)}
          strategy={verticalListSortingStrategy}
        >
          {withIds.map((it, idx) => (
            <SortableRow
              key={it.__cid}
              id={it.__cid as string}
              onRemove={() => {
                const next = withIds.filter((_, i) => i !== idx);
                onChange(next as T[]);
                onBlur();
              }}
            >
              {renderItem(
                it,
                (next) => {
                  const updated = [...withIds];
                  updated[idx] = { ...next, __cid: it.__cid } as WithClientId<T>;
                  onChange(updated as T[]);
                },
                onBlur,
              )}
            </SortableRow>
          ))}
        </SortableContext>
      </DndContext>
      {(maxItems === undefined || withIds.length < maxItems) && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            onChange([...withIds, { ...newItem(), __cid: nanoid(8) }] as T[]);
            onBlur();
          }}
          className="w-full"
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          {addLabel}
        </Button>
      )}
    </div>
  );
}

function SortableRow({
  id,
  onRemove,
  children,
}: {
  id: string;
  onRemove: () => void;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          aria-label="Drag to reorder"
          className="cursor-grab text-muted-foreground active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          <Trash2 className="mr-1 h-3.5 w-3.5" /> Устгах
        </Button>
      </div>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Section heading helper — every section block shares these fields   */
/* ------------------------------------------------------------------ */

interface SectionHeadingFields {
  section_label_mn: string;
  section_label_en: string;
  heading_mn: string;
  heading_en: string;
}

function SectionHeadingEditor<T extends SectionHeadingFields>({
  state,
  hideLabel = false,
}: {
  state: BlockEditState<BlockType> & {
    draft: T;
    patch: (p: Partial<T>) => void;
    commitIfDirty: () => void;
  };
  hideLabel?: boolean;
}) {
  return (
    <>
      {!hideLabel && (
        <BilingualField
          label="Жижиг гарчиг (section marker)"
          mnValue={state.draft.section_label_mn}
          enValue={state.draft.section_label_en}
          onChange={(lang, next) =>
            state.patch({ [`section_label_${lang}`]: next } as unknown as Partial<T>)
          }
          onBlur={state.commitIfDirty}
        />
      )}
      <BilingualField
        label="Том гарчиг"
        mnValue={state.draft.heading_mn}
        enValue={state.draft.heading_en}
        onChange={(lang, next) =>
          state.patch({ [`heading_${lang}`]: next } as unknown as Partial<T>)
        }
        onBlur={state.commitIfDirty}
        multiline
        rows={2}
      />
    </>
  );
}

interface SectionWithIntroFields extends SectionHeadingFields {
  intro_mn: string;
  intro_en: string;
}

function IntroEditor<T extends SectionWithIntroFields>({
  state,
}: {
  state: BlockEditState<BlockType> & {
    draft: T;
    patch: (p: Partial<T>) => void;
    commitIfDirty: () => void;
  };
}) {
  return (
    <BilingualField
      label="Танилцуулга"
      mnValue={state.draft.intro_mn}
      enValue={state.draft.intro_en}
      onChange={(lang, next) => state.patch({ [`intro_${lang}`]: next } as unknown as Partial<T>)}
      onBlur={state.commitIfDirty}
      multiline
      aiPolish
      rows={3}
    />
  );
}

/* ================================================================== */
/*                          HERO                                       */
/* ================================================================== */

function HeroEditor({ state }: { state: BlockEditState<'hero'> }) {
  const { draft, patch, commitIfDirty } = state;
  return (
    <div className="space-y-4">
      <BilingualField
        label="Гарчиг"
        mnValue={draft.title_mn}
        enValue={draft.title_en}
        onChange={(lang, next) => patch({ [`title_${lang}`]: next } as Partial<HeroContent>)}
        onBlur={commitIfDirty}
      />
      <BilingualField
        label="Дэд гарчиг"
        mnValue={draft.subtitle_mn}
        enValue={draft.subtitle_en}
        onChange={(lang, next) => patch({ [`subtitle_${lang}`]: next } as Partial<HeroContent>)}
        onBlur={commitIfDirty}
        multiline
        rows={2}
      />
      <ImagePicker
        value={draft.image_url}
        onChange={(next) => {
          patch({ image_url: next });
          commitIfDirty();
        }}
        label="Hero зураг"
        hint="Хэрэв видео байгаа бол энэ зураг нь видеоны постер болно."
      />
      <Field
        label="Видео URL"
        hint="Optional — хэрэв тохируулсан бол зургийн оронд автомат тоглоно."
      >
        <Input
          value={draft.video_url ?? ''}
          onChange={(e) => patch({ video_url: e.target.value || null })}
          onBlur={commitIfDirty}
          placeholder="https://..."
        />
      </Field>
      <BilingualField
        label="CTA товчны нэр"
        mnValue={draft.cta_label_mn}
        enValue={draft.cta_label_en}
        onChange={(lang, next) => patch({ [`cta_label_${lang}`]: next } as Partial<HeroContent>)}
        onBlur={commitIfDirty}
      />
      <Field
        label="CTA очих хэсэг (anchor)"
        hint='Жишээ: "projects", "contact". Хоосон үлдээвэл CTA товч харагдахгүй.'
      >
        <Input
          value={draft.cta_anchor}
          onChange={(e) => patch({ cta_anchor: e.target.value })}
          onBlur={commitIfDirty}
          placeholder="projects"
        />
      </Field>
    </div>
  );
}

/* ================================================================== */
/*                       PROJECT GRID                                  */
/* ================================================================== */

function ProjectGridEditor({ state }: { state: BlockEditState<'project-grid'> }) {
  const { draft, patch, commitIfDirty } = state;
  return (
    <div className="space-y-4">
      <SectionHeadingEditor
        state={
          state as unknown as BlockEditState<BlockType> & {
            draft: ProjectGridContent;
            patch: (p: Partial<ProjectGridContent>) => void;
            commitIfDirty: () => void;
          }
        }
      />
      <IntroEditor
        state={
          state as unknown as BlockEditState<BlockType> & {
            draft: ProjectGridContent;
            patch: (p: Partial<ProjectGridContent>) => void;
            commitIfDirty: () => void;
          }
        }
      />
      <Field
        label="Жагсаалтад орох төслүүд"
        hint="Дарааллыг өөрчлөхийн тулд мөрөнд дарж чирнэ үү. Шинэ төсөл нэмэхдээ зүүн талын “+ Шинэ төсөл хуудас” товчийг ашиглана уу."
      >
        <ProjectPageIdList
          ids={draft.project_page_ids}
          onChange={(ids) => {
            patch({ project_page_ids: ids });
            commitIfDirty();
          }}
        />
      </Field>
    </div>
  );
}

function ProjectPageIdList({
  ids,
  onChange,
}: {
  ids: number[];
  onChange: (next: number[]) => void;
}) {
  // Phase 2 keeps this minimal — drag to reorder, X to remove. Phase 2.x
  // can wire it to a project-page picker so admins add by name not by id.
  const sensors = useAppDndSensors();
  const items = ids.map((id) => ({ id, key: String(id) }));
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex((i) => i.key === active.id);
    const newIdx = items.findIndex((i) => i.key === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    onChange(arrayMove(ids, oldIdx, newIdx));
  };
  return (
    <div className="space-y-2">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items.map((i) => i.key)} strategy={verticalListSortingStrategy}>
          {items.map((it) => (
            <ProjectPageRow
              key={it.key}
              id={it.key}
              pageId={it.id}
              onRemove={() => onChange(ids.filter((x) => x !== it.id))}
            />
          ))}
        </SortableContext>
      </DndContext>
      {ids.length === 0 && (
        <p className="text-xs text-muted-foreground">Одоогоор төсөл сонгогдоогүй байна.</p>
      )}
    </div>
  );
}

function ProjectPageRow({
  id,
  pageId,
  onRemove,
}: {
  id: string;
  pageId: number;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-sm"
    >
      <button
        type="button"
        className="cursor-grab text-muted-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="font-mono text-xs">work/{pageId}</span>
      <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

/* ================================================================== */
/*                          SERVICES                                   */
/* ================================================================== */

function ServicesEditor({ state }: { state: BlockEditState<'services'> }) {
  const { draft, patch, commitIfDirty } = state;
  return (
    <div className="space-y-4">
      <SectionHeadingEditor
        state={
          state as unknown as BlockEditState<BlockType> & {
            draft: ServicesContent;
            patch: (p: Partial<ServicesContent>) => void;
            commitIfDirty: () => void;
          }
        }
      />
      <IntroEditor
        state={
          state as unknown as BlockEditState<BlockType> & {
            draft: ServicesContent;
            patch: (p: Partial<ServicesContent>) => void;
            commitIfDirty: () => void;
          }
        }
      />
      <Field label="Үйлчилгээний жагсаалт">
        <ItemListEditor<ServiceItem>
          items={draft.items}
          onChange={(items) => patch({ items })}
          onBlur={commitIfDirty}
          newItem={() => ({
            title_mn: '',
            title_en: '',
            body_mn: '',
            body_en: '',
            icon: 'Layers3',
          })}
          addLabel="Үйлчилгээ нэмэх"
          renderItem={(item, update, onBlur) => (
            <div className="space-y-3">
              <BilingualField
                label="Нэр"
                mnValue={item.title_mn}
                enValue={item.title_en}
                onChange={(lang, next) => update({ ...item, [`title_${lang}`]: next })}
                onBlur={onBlur}
                dense
              />
              <BilingualField
                label="Тайлбар"
                mnValue={item.body_mn}
                enValue={item.body_en}
                onChange={(lang, next) => update({ ...item, [`body_${lang}`]: next })}
                onBlur={onBlur}
                multiline
                rows={2}
                dense
              />
              <Field label="Дүрс">
                <Select
                  value={item.icon ?? 'Layers3'}
                  onValueChange={(next) => {
                    update({ ...item, icon: next });
                    onBlur();
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Layers3">Layers3 — Давхарга</SelectItem>
                    <SelectItem value="Building2">Building2 — Барилга</SelectItem>
                    <SelectItem value="HardHat">HardHat — Каск</SelectItem>
                    <SelectItem value="KanbanSquare">KanbanSquare — Kanban</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          )}
        />
      </Field>
    </div>
  );
}

/* ================================================================== */
/*                            ABOUT                                    */
/* ================================================================== */

function AboutEditor({ state }: { state: BlockEditState<'about'> }) {
  const { draft, patch, commitIfDirty } = state;
  return (
    <div className="space-y-4">
      <SectionHeadingEditor
        state={
          state as unknown as BlockEditState<BlockType> & {
            draft: AboutContent;
            patch: (p: Partial<AboutContent>) => void;
            commitIfDirty: () => void;
          }
        }
      />
      <BilingualField
        label="Үндсэн текст"
        mnValue={draft.body_mn}
        enValue={draft.body_en}
        onChange={(lang, next) => patch({ [`body_${lang}`]: next } as Partial<AboutContent>)}
        onBlur={commitIfDirty}
        multiline
        aiPolish
        rows={6}
      />
      <ImagePicker
        value={draft.image_url}
        onChange={(next) => {
          patch({ image_url: next });
          commitIfDirty();
        }}
        label="Хажуугийн зураг"
      />
    </div>
  );
}

/* ================================================================== */
/*                            STATS                                    */
/* ================================================================== */

function StatsEditor({ state }: { state: BlockEditState<'stats'> }) {
  const { draft, patch, commitIfDirty } = state;
  return (
    <div className="space-y-4">
      <SectionHeadingEditor
        state={
          state as unknown as BlockEditState<BlockType> & {
            draft: StatsContent;
            patch: (p: Partial<StatsContent>) => void;
            commitIfDirty: () => void;
          }
        }
      />
      <Field label="Тоон үзүүлэлтүүд (хамгийн ихдээ 4)">
        <ItemListEditor<StatTile>
          items={draft.tiles}
          onChange={(tiles) => patch({ tiles })}
          onBlur={commitIfDirty}
          newItem={() => ({ value: '0+', label_mn: '', label_en: '' })}
          addLabel="Тоо нэмэх"
          maxItems={4}
          renderItem={(item, update, onBlur) => (
            <div className="space-y-3">
              <Field label="Тоо" hint='Жишээ: "15+", "200+", "4"'>
                <Input
                  value={item.value}
                  onChange={(e) => update({ ...item, value: e.target.value })}
                  onBlur={onBlur}
                  placeholder="15+"
                />
              </Field>
              <BilingualField
                label="Нэр"
                mnValue={item.label_mn}
                enValue={item.label_en}
                onChange={(lang, next) => update({ ...item, [`label_${lang}`]: next })}
                onBlur={onBlur}
                dense
              />
            </div>
          )}
        />
      </Field>
    </div>
  );
}

/* ================================================================== */
/*                            AWARDS                                   */
/* ================================================================== */

function AwardsEditor({ state }: { state: BlockEditState<'awards'> }) {
  const { draft, patch, commitIfDirty } = state;
  return (
    <div className="space-y-4">
      <SectionHeadingEditor
        state={
          state as unknown as BlockEditState<BlockType> & {
            draft: AwardsContent;
            patch: (p: Partial<AwardsContent>) => void;
            commitIfDirty: () => void;
          }
        }
      />
      <IntroEditor
        state={
          state as unknown as BlockEditState<BlockType> & {
            draft: AwardsContent;
            patch: (p: Partial<AwardsContent>) => void;
            commitIfDirty: () => void;
          }
        }
      />
      <Field label="Шагналуудын жагсаалт">
        <ItemListEditor<AwardItem>
          items={draft.items}
          onChange={(items) => patch({ items })}
          onBlur={commitIfDirty}
          newItem={() => ({ title_mn: '', title_en: '', tag_mn: '', tag_en: '', image_url: null })}
          addLabel="Шагнал нэмэх"
          renderItem={(item, update, onBlur) => (
            <div className="space-y-3">
              <ImagePicker
                value={item.image_url}
                onChange={(next) => {
                  update({ ...item, image_url: next });
                  onBlur();
                }}
                label="Зураг"
                dense
              />
              <BilingualField
                label="Шагналын нэр"
                mnValue={item.title_mn}
                enValue={item.title_en}
                onChange={(lang, next) => update({ ...item, [`title_${lang}`]: next })}
                onBlur={onBlur}
                dense
              />
              <BilingualField
                label="Дэд бичээс"
                mnValue={item.tag_mn}
                enValue={item.tag_en}
                onChange={(lang, next) => update({ ...item, [`tag_${lang}`]: next })}
                onBlur={onBlur}
                dense
              />
            </div>
          )}
        />
      </Field>
    </div>
  );
}

/* ================================================================== */
/*                           PARTNERS                                  */
/* ================================================================== */

function PartnersEditor({ state }: { state: BlockEditState<'partners'> }) {
  const { draft, patch, commitIfDirty } = state;
  return (
    <div className="space-y-4">
      <SectionHeadingEditor
        state={
          state as unknown as BlockEditState<BlockType> & {
            draft: PartnersContent;
            patch: (p: Partial<PartnersContent>) => void;
            commitIfDirty: () => void;
          }
        }
      />
      <IntroEditor
        state={
          state as unknown as BlockEditState<BlockType> & {
            draft: PartnersContent;
            patch: (p: Partial<PartnersContent>) => void;
            commitIfDirty: () => void;
          }
        }
      />
      <Field label="Түншүүдийн жагсаалт">
        <ItemListEditor<PartnerItem>
          items={draft.items}
          onChange={(items) => patch({ items })}
          onBlur={commitIfDirty}
          newItem={() => ({ name: '', image_url: null, link_url: null })}
          addLabel="Түнш нэмэх"
          renderItem={(item, update, onBlur) => (
            <div className="space-y-3">
              <ImagePicker
                value={item.image_url}
                onChange={(next) => {
                  update({ ...item, image_url: next });
                  onBlur();
                }}
                label="Лого"
                dense
              />
              <Field label="Нэр">
                <Input
                  value={item.name}
                  onChange={(e) => update({ ...item, name: e.target.value })}
                  onBlur={onBlur}
                  placeholder="Autodesk Revit"
                />
              </Field>
              <Field label="Холбоос (optional)">
                <Input
                  value={item.link_url ?? ''}
                  onChange={(e) => update({ ...item, link_url: e.target.value || null })}
                  onBlur={onBlur}
                  placeholder="https://..."
                />
              </Field>
            </div>
          )}
        />
      </Field>
    </div>
  );
}

/* ================================================================== */
/*                             NEWS                                    */
/* ================================================================== */

function NewsEditor({ state }: { state: BlockEditState<'news'> }) {
  const { draft, patch, commitIfDirty } = state;
  return (
    <div className="space-y-4">
      <SectionHeadingEditor
        state={
          state as unknown as BlockEditState<BlockType> & {
            draft: NewsContent;
            patch: (p: Partial<NewsContent>) => void;
            commitIfDirty: () => void;
          }
        }
      />
      <Field label="Мэдээний жагсаалт">
        <ItemListEditor<NewsItem>
          items={draft.items}
          onChange={(items) => patch({ items })}
          onBlur={commitIfDirty}
          newItem={() => ({
            title_mn: '',
            title_en: '',
            excerpt_mn: '',
            excerpt_en: '',
            image_url: null,
            published_at: new Date().toISOString().slice(0, 10),
            link_url: null,
          })}
          addLabel="Мэдээ нэмэх"
          renderItem={(item, update, onBlur) => (
            <div className="space-y-3">
              <ImagePicker
                value={item.image_url}
                onChange={(next) => {
                  update({ ...item, image_url: next });
                  onBlur();
                }}
                label="Зураг"
                dense
              />
              <BilingualField
                label="Гарчиг"
                mnValue={item.title_mn}
                enValue={item.title_en}
                onChange={(lang, next) => update({ ...item, [`title_${lang}`]: next })}
                onBlur={onBlur}
                dense
              />
              <BilingualField
                label="Тойм"
                mnValue={item.excerpt_mn}
                enValue={item.excerpt_en}
                onChange={(lang, next) => update({ ...item, [`excerpt_${lang}`]: next })}
                onBlur={onBlur}
                multiline
                rows={2}
                dense
              />
              <Field label="Огноо" hint="YYYY-MM-DD">
                <Input
                  type="date"
                  value={(item.published_at ?? '').slice(0, 10)}
                  onChange={(e) => update({ ...item, published_at: e.target.value })}
                  onBlur={onBlur}
                />
              </Field>
              <Field label="Холбоос (optional)">
                <Input
                  value={item.link_url ?? ''}
                  onChange={(e) => update({ ...item, link_url: e.target.value || null })}
                  onBlur={onBlur}
                  placeholder="https://..."
                />
              </Field>
            </div>
          )}
        />
      </Field>
    </div>
  );
}

/* ================================================================== */
/*                           CONTACT                                   */
/* ================================================================== */

function ContactEditor({ state }: { state: BlockEditState<'contact'> }) {
  const { draft, patch, commitIfDirty } = state;
  return (
    <div className="space-y-4">
      <SectionHeadingEditor
        state={
          state as unknown as BlockEditState<BlockType> & {
            draft: ContactContent;
            patch: (p: Partial<ContactContent>) => void;
            commitIfDirty: () => void;
          }
        }
      />
      <IntroEditor
        state={
          state as unknown as BlockEditState<BlockType> & {
            draft: ContactContent;
            patch: (p: Partial<ContactContent>) => void;
            commitIfDirty: () => void;
          }
        }
      />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Утас">
          <Input
            value={draft.phone ?? ''}
            onChange={(e) => patch({ phone: e.target.value || null })}
            onBlur={commitIfDirty}
            placeholder="+976 ..."
          />
        </Field>
        <Field label="Имэйл">
          <Input
            value={draft.email ?? ''}
            onChange={(e) => patch({ email: e.target.value || null })}
            onBlur={commitIfDirty}
            placeholder="hello@..."
          />
        </Field>
      </div>
      <BilingualField
        label="Хаяг"
        mnValue={draft.address_mn ?? ''}
        enValue={draft.address_en ?? ''}
        onChange={(lang, next) =>
          patch({ [`address_${lang}`]: next || null } as Partial<ContactContent>)
        }
        onBlur={commitIfDirty}
        multiline
        rows={2}
      />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Facebook URL">
          <Input
            value={draft.facebook_url ?? ''}
            onChange={(e) => patch({ facebook_url: e.target.value || null })}
            onBlur={commitIfDirty}
            placeholder="https://facebook.com/..."
          />
        </Field>
        <Field label="LinkedIn URL">
          <Input
            value={draft.linkedin_url ?? ''}
            onChange={(e) => patch({ linkedin_url: e.target.value || null })}
            onBlur={commitIfDirty}
            placeholder="https://linkedin.com/..."
          />
        </Field>
        <Field label="Instagram URL">
          <Input
            value={draft.instagram_url ?? ''}
            onChange={(e) => patch({ instagram_url: e.target.value || null })}
            onBlur={commitIfDirty}
            placeholder="https://instagram.com/..."
          />
        </Field>
      </div>
    </div>
  );
}

/* ================================================================== */
/*                         RICH TEXT                                   */
/* ================================================================== */

function RichTextEditor({ state }: { state: BlockEditState<'rich-text'> }) {
  const { draft, patch, commitIfDirty } = state;
  return (
    <div className="space-y-4">
      <BilingualField
        label="Текст"
        mnValue={draft.body_mn}
        enValue={draft.body_en}
        onChange={(lang, next) => patch({ [`body_${lang}`]: next } as Partial<RichTextContent>)}
        onBlur={commitIfDirty}
        multiline
        aiPolish
        rows={8}
        placeholderMn="Урт хэлбэрийн текст…"
        placeholderEn="Long-form copy…"
      />
    </div>
  );
}

/* ================================================================== */
/*                            IMAGE                                    */
/* ================================================================== */

function ImageEditor({ state }: { state: BlockEditState<'image'> }) {
  const { draft, patch, commitIfDirty } = state;
  return (
    <div className="space-y-4">
      <ImagePicker
        value={draft.image_url}
        onChange={(next) => {
          patch({ image_url: next });
          commitIfDirty();
        }}
        label="Зураг"
      />
      <BilingualField
        label="Зургийн тайлбар"
        mnValue={draft.caption_mn}
        enValue={draft.caption_en}
        onChange={(lang, next) => patch({ [`caption_${lang}`]: next } as Partial<ImageContent>)}
        onBlur={commitIfDirty}
      />
      <Field label="Харьцаа">
        <Select
          value={draft.aspect}
          onValueChange={(next) => {
            patch({ aspect: next as ImageContent['aspect'] });
            commitIfDirty();
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="16/10">16:10 (өргөн)</SelectItem>
            <SelectItem value="4/5">4:5 (босоо)</SelectItem>
            <SelectItem value="1/1">1:1 (дөрвөлжин)</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}

/* ================================================================== */
/*                       IMAGE GALLERY                                 */
/* ================================================================== */

function ImageGalleryEditor({ state }: { state: BlockEditState<'image-gallery'> }) {
  const { draft, patch, commitIfDirty } = state;
  return (
    <div className="space-y-4">
      <Field
        label="Зургийн цуглуулга"
        hint="Эхний зураг том хэмжээтэй гарна, дараах нь хосоор урсаж харагдана."
      >
        <ItemListEditor<GalleryImage>
          items={draft.images}
          onChange={(images) => patch({ images })}
          onBlur={commitIfDirty}
          newItem={() => ({ image_url: null, caption_mn: '', caption_en: '' })}
          addLabel="Зураг нэмэх"
          renderItem={(item, update, onBlur) => (
            <div className="space-y-3">
              <ImagePicker
                value={item.image_url}
                onChange={(next) => {
                  update({ ...item, image_url: next });
                  onBlur();
                }}
                label="Зураг"
                dense
              />
              <BilingualField
                label="Тайлбар (optional)"
                mnValue={item.caption_mn}
                enValue={item.caption_en}
                onChange={(lang, next) => update({ ...item, [`caption_${lang}`]: next })}
                onBlur={onBlur}
                dense
              />
            </div>
          )}
        />
      </Field>
    </div>
  );
}

/* ================================================================== */
/*                          DIVIDER                                    */
/* ================================================================== */

function DividerEditor({ state }: { state: BlockEditState<'divider'> }) {
  const { draft, patch, commitIfDirty } = state;
  return (
    <div className="space-y-3">
      <Field
        label="Хэв маяг"
        hint="Hairline — нимгэн зураас; Section break — бүхэл хэсэг тусгаарлах."
      >
        <Select
          value={draft.style}
          onValueChange={(next) => {
            patch({ style: next as DividerContent['style'] });
            commitIfDirty();
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="hairline">Hairline</SelectItem>
            <SelectItem value="section-break">Section break</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}

/* ================================================================== */
/*                             CTA                                     */
/* ================================================================== */

function CtaEditor({ state }: { state: BlockEditState<'cta'> }) {
  const { draft, patch, commitIfDirty } = state;
  return (
    <div className="space-y-4">
      <BilingualField
        label="Eyebrow"
        mnValue={draft.eyebrow_mn}
        enValue={draft.eyebrow_en}
        onChange={(lang, next) => patch({ [`eyebrow_${lang}`]: next } as Partial<CtaContent>)}
        onBlur={commitIfDirty}
      />
      <BilingualField
        label="Гарчиг"
        mnValue={draft.heading_mn}
        enValue={draft.heading_en}
        onChange={(lang, next) => patch({ [`heading_${lang}`]: next } as Partial<CtaContent>)}
        onBlur={commitIfDirty}
        multiline
        rows={2}
      />
      <BilingualField
        label="Тайлбар"
        mnValue={draft.body_mn}
        enValue={draft.body_en}
        onChange={(lang, next) => patch({ [`body_${lang}`]: next } as Partial<CtaContent>)}
        onBlur={commitIfDirty}
        multiline
        rows={3}
      />
      <BilingualField
        label="Товчны нэр"
        mnValue={draft.button_label_mn}
        enValue={draft.button_label_en}
        onChange={(lang, next) => patch({ [`button_label_${lang}`]: next } as Partial<CtaContent>)}
        onBlur={commitIfDirty}
      />
      <Field label="Товчны URL">
        <Input
          value={draft.button_href}
          onChange={(e) => patch({ button_href: e.target.value })}
          onBlur={commitIfDirty}
          placeholder="https://... or /work/3"
        />
      </Field>
    </div>
  );
}

/* ================================================================== */
/*                     PROJECT CREDITS                                 */
/* ================================================================== */

function ProjectCreditsEditor({ state }: { state: BlockEditState<'project-credits'> }) {
  const { draft, patch, commitIfDirty } = state;
  return (
    <div className="space-y-4">
      <BilingualField
        label="Төслийн нэр"
        mnValue={draft.name_mn}
        enValue={draft.name_en}
        onChange={(lang, next) =>
          patch({ [`name_${lang}`]: next } as Partial<ProjectCreditsContent>)
        }
        onBlur={commitIfDirty}
      />
      <BilingualField
        label="Зарчим (Philosophy)"
        mnValue={draft.philosophy_mn}
        enValue={draft.philosophy_en}
        onChange={(lang, next) =>
          patch({ [`philosophy_${lang}`]: next } as Partial<ProjectCreditsContent>)
        }
        onBlur={commitIfDirty}
        multiline
        aiPolish
        rows={5}
      />
      <CreditFieldRow
        label="Барилгын төрөл"
        mnKey="typology_mn"
        enKey="typology_en"
        state={state}
      />
      <CreditFieldRow label="Байршил" mnKey="location_mn" enKey="location_en" state={state} />
      <Field label="Он">
        <Input
          value={draft.year ?? ''}
          onChange={(e) => patch({ year: e.target.value || null })}
          onBlur={commitIfDirty}
          placeholder="2024"
        />
      </Field>
      <CreditFieldRow label="Статус" mnKey="status_mn" enKey="status_en" state={state} />
      <CreditFieldRow label="Хэмжээ" mnKey="size_mn" enKey="size_en" state={state} />
      <CreditFieldRow label="Захиалагч" mnKey="client_mn" enKey="client_en" state={state} />
      <CreditFieldRow
        label="Дизайны баг"
        mnKey="design_team_mn"
        enKey="design_team_en"
        state={state}
      />
      <CreditFieldRow label="Төрөл" mnKey="category_mn" enKey="category_en" state={state} />
    </div>
  );
}

function CreditFieldRow({
  label,
  mnKey,
  enKey,
  state,
}: {
  label: string;
  mnKey: keyof ProjectCreditsContent;
  enKey: keyof ProjectCreditsContent;
  state: BlockEditState<'project-credits'>;
}) {
  return (
    <BilingualField
      label={label}
      mnValue={(state.draft[mnKey] as string | null) ?? ''}
      enValue={(state.draft[enKey] as string | null) ?? ''}
      onChange={(lang, next) =>
        state.patch({
          [lang === 'mn' ? mnKey : enKey]: next || null,
        } as unknown as Partial<ProjectCreditsContent>)
      }
      onBlur={state.commitIfDirty}
    />
  );
}

function ImageComparisonEditor({ state }: { state: BlockEditState<'image-comparison'> }) {
  const { draft, patch, commitIfDirty } = state;
  return (
    <div className="space-y-4">
      <SectionHeadingEditor
        state={
          state as unknown as BlockEditState<BlockType> & {
            draft: ImageComparisonContent;
            patch: (p: Partial<ImageComparisonContent>) => void;
            commitIfDirty: () => void;
          }
        }
      />
      <IntroEditor
        state={
          state as unknown as BlockEditState<BlockType> & {
            draft: ImageComparisonContent;
            patch: (p: Partial<ImageComparisonContent>) => void;
            commitIfDirty: () => void;
          }
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ImagePicker
          value={draft.image_left_url}
          onChange={(next) => {
            patch({ image_left_url: next });
            commitIfDirty();
          }}
          label="Зүүн талын зураг (Эскиз / Blueprint)"
        />
        <ImagePicker
          value={draft.image_right_url}
          onChange={(next) => {
            patch({ image_right_url: next });
            commitIfDirty();
          }}
          label="Баруун талын зураг (Бодит / Realization)"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <BilingualField
          label="Зүүн талын зургийн шошго"
          mnValue={draft.label_left_mn}
          enValue={draft.label_left_en}
          onChange={(lang, next) =>
            patch({ [`label_left_${lang}`]: next } as Partial<ImageComparisonContent>)
          }
          onBlur={commitIfDirty}
          placeholderMn="Эскиз зураг"
          placeholderEn="Plan / Blueprint"
        />
        <BilingualField
          label="Баруун талын зургийн шошго"
          mnValue={draft.label_right_mn}
          enValue={draft.label_right_en}
          onChange={(lang, next) =>
            patch({ [`label_right_${lang}`]: next } as Partial<ImageComparisonContent>)
          }
          onBlur={commitIfDirty}
          placeholderMn="Бодит гүйцэтгэл"
          placeholderEn="Realization / Photo"
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Make the helper-section types re-exportable for the typings        */
/* ------------------------------------------------------------------ */

export type { ImageGalleryContent };
