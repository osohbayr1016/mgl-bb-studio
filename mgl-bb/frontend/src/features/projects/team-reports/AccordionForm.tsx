import { useMemo } from 'react';
import { Plus, Trash2, CheckCircle2, Circle, Sparkles } from 'lucide-react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { PolishableTextarea } from '@/ui/PolishableTextarea';
import { Label } from '@/ui/label';
import { Checkbox } from '@/ui/checkbox';
import { Progress } from '@/ui/progress';
import { Badge } from '@/ui/badge';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/ui/accordion';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { cn } from '@/shared/lib/utils';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import type { FieldDef, SectionDef } from '@/features/projects/team-reports/types';

/* =============================================================
 * Shared questionnaire renderer.
 * -------------------------------------------------------------
 * Drives every team's report form. Sections collapse into an
 * accordion; each section displays a small completion badge,
 * and an overall progress bar above the accordion tracks the
 * full report. Custom widgets (block-rows / floor-rows) are
 * inlined here so all the form's input rendering lives in one
 * place and the team-specific templates stay pure data.
 * ============================================================= */

interface AccordionFormProps<A> {
  sections: SectionDef<A>[];
  answers: A;
  /** Current top-level variant (e.g. BA's `building_type`). Used to
   *  filter rows whose `variants` array doesn't include the current
   *  value. Pass `null` when the team has no variants. */
  variant: string | null;
  readOnly?: boolean;
  onChange: (patch: Partial<A>) => void;
  /** Sections opened by default. Defaults to the first section so a
   *  fresh form has somewhere to start. */
  defaultOpenIds?: string[];
}

/** A field is "filled" when its value isn't empty/false/empty-array.
 *  Boolean false counts as unfilled (a deliberate empty checkbox)
 *  so the progress bar reflects what the user has actually said
 *  rather than what they've merely been shown. */
function isFilled(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.length > 0;
  return false;
}

function variantMatches(allowed: string[] | undefined, variant: string | null): boolean {
  if (!allowed || allowed.length === 0) return true;
  if (!variant) return false;
  return allowed.includes(variant);
}

function isFieldVisible<A>(field: FieldDef<A>, answers: A, variant: string | null): boolean {
  if (!variantMatches(field.variants, variant)) return false;
  if (field.visibleIf && !field.visibleIf(answers)) return false;
  return true;
}

export function AccordionForm<A>({
  sections,
  answers,
  variant,
  readOnly = false,
  onChange,
  defaultOpenIds,
}: AccordionFormProps<A>) {
  /* Visible (variant + conditional) view of the template — recomputed
   * whenever the variant or any answer changes so progress badges
   * and the overall bar reflect the user's current filter state. */
  const visibleSections = useMemo(() => {
    return sections
      .filter((s) => variantMatches(s.variants, variant))
      .map((section) => {
        const visibleFields = section.fields.filter((f) => isFieldVisible(f, answers, variant));
        return { section, visibleFields };
      })
      .filter((s) => s.visibleFields.length > 0);
  }, [sections, answers, variant]);

  const { filled, total } = useMemo(() => {
    let f = 0;
    let t = 0;
    for (const { visibleFields } of visibleSections) {
      for (const field of visibleFields) {
        t += 1;
        if (isFilled(answers[field.key])) f += 1;
      }
    }
    return { filled: f, total: t };
  }, [visibleSections, answers]);

  const overallPct = total === 0 ? 0 : Math.round((filled / total) * 100);
  const defaultOpen = defaultOpenIds ?? (visibleSections[0] ? [visibleSections[0].section.id] : []);

  return (
    <div className="space-y-3">
      {/* Top progress bar — shows the user how much of the form is filled.
          Counted over the variant-filtered field set so it never feels
          unreachable (you can hit 100% with the rows that apply to your
          chosen building type). */}
      <div className="rounded-lg border border-border bg-card px-4 py-3 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">Бөглөгдсөн байдал</span>
          <span className="text-muted-foreground tabular-nums">
            {filled} / {total} ({overallPct}%)
          </span>
        </div>
        <Progress value={overallPct} className="h-2" />
      </div>

      <Accordion
        type="multiple"
        defaultValue={defaultOpen}
        className="rounded-lg border border-border bg-card divide-y"
      >
        {visibleSections.map(({ section, visibleFields }) => {
          const sectionFilled = visibleFields.filter((f) => isFilled(answers[f.key])).length;
          const sectionTotal = visibleFields.length;
          const complete = sectionFilled === sectionTotal;
          return (
            <AccordionItem key={section.id} value={section.id} className="px-4 last:border-b-0">
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {complete ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  ) : (
                    <Circle className="w-4 h-4 text-muted-foreground/60 flex-shrink-0" />
                  )}
                  <span className="truncate">{section.title}</span>
                  <Badge
                    variant={complete ? 'secondary' : 'outline'}
                    className="ml-2 text-[10px] tabular-nums"
                  >
                    {sectionFilled}/{sectionTotal}
                  </Badge>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-3">
                  {section.blurb && (
                    <p className="text-sm text-muted-foreground leading-relaxed">{section.blurb}</p>
                  )}
                  {section.preset && !readOnly && (
                    <PresetButton
                      label={section.preset.label}
                      description={section.preset.description}
                      onApply={async () => {
                        // Warn before overwriting existing answers when the
                        // section explicitly asks for confirmation (default).
                        // The check looks at the preset's keys only — answers
                        // outside the section are untouched either way.
                        const confirm = section.preset!.confirm !== false;
                        if (confirm) {
                          const presetKeys = Object.keys(section.preset!.values) as (keyof A)[];
                          const hasFilled = presetKeys.some((k) => isFilled(answers[k]));
                          if (hasFilled) {
                            const ok = await confirmDialog({
                              description:
                                'Зарим талбар бөглөгдсөн байна. Эдгээрийг ' +
                                section.preset!.label +
                                ' утгуудаар дарж бичих үү?',
                              variant: 'destructive',
                            });
                            if (!ok) return;
                          }
                        }
                        onChange(section.preset!.values);
                      }}
                    />
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {visibleFields.map((field) => (
                      <FieldRow
                        key={field.key}
                        field={field}
                        answers={answers}
                        readOnly={readOnly}
                        onChange={onChange}
                      />
                    ))}
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
}

/* ─── Field rendering ─── */
interface FieldRowProps<A> {
  field: FieldDef<A>;
  answers: A;
  readOnly: boolean;
  onChange: (patch: Partial<A>) => void;
}

function FieldRow<A>({ field, answers, readOnly, onChange }: FieldRowProps<A>) {
  const spanClass = field.span === 'full' ? 'md:col-span-2' : 'md:col-span-1';
  const value = answers[field.key];

  return (
    <div className={cn('space-y-1.5', spanClass)}>
      <Label className="text-sm font-medium text-foreground/90">{field.label}</Label>
      <FieldInput field={field} value={value} readOnly={readOnly} onChange={onChange} />
      {field.hint && <p className="text-sm text-muted-foreground leading-relaxed">{field.hint}</p>}
    </div>
  );
}

function FieldInput<A>({
  field,
  value,
  readOnly,
  onChange,
}: {
  field: FieldDef<A>;
  value: unknown;
  readOnly: boolean;
  onChange: (patch: Partial<A>) => void;
}) {
  // The cast is unavoidable because TypeScript can't connect the
  // field's runtime `kind` to the value type at the key. The form
  // dictates the input widget so this is safe in practice.
  const setKey = (v: unknown) => onChange({ [field.key]: v } as Partial<A>);

  switch (field.kind) {
    case 'textarea':
      return (
        <PolishableTextarea
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => setKey(e.target.value)}
          placeholder={field.placeholder}
          disabled={readOnly}
          rows={4}
        />
      );

    case 'select':
      return (
        <Select
          value={typeof value === 'string' ? value : ''}
          onValueChange={(v) => setKey(v)}
          disabled={readOnly}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={field.placeholder ?? 'Сонгох'} />
          </SelectTrigger>
          <SelectContent>
            {field.options?.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );

    case 'checkbox':
      return (
        <div className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={value === true}
            onCheckedChange={(v) => setKey(v === true)}
            disabled={readOnly}
          />
          <span className="text-muted-foreground">Тийм</span>
        </div>
      );

    case 'block-rows':
      return (
        <BlockRowsEditor
          rows={Array.isArray(value) ? (value as BlockRowValue[]) : []}
          readOnly={readOnly}
          onChange={(rows) => setKey(rows)}
        />
      );

    case 'floor-rows':
      return (
        <FloorRowsEditor
          rows={Array.isArray(value) ? (value as FloorRowValue[]) : []}
          readOnly={readOnly}
          onChange={(rows) => setKey(rows)}
        />
      );

    case 'zone-rows':
      return (
        <ZoneRowsEditor
          rows={Array.isArray(value) ? (value as ZoneRowValue[]) : []}
          readOnly={readOnly}
          onChange={(rows) => setKey(rows)}
        />
      );

    case 'floor-areas-rows':
      return (
        <FloorAreasRowsEditor
          rows={Array.isArray(value) ? (value as FloorAreaRowValue[]) : []}
          readOnly={readOnly}
          onChange={(rows) => setKey(rows)}
        />
      );

    case 'text':
    case 'number':
    default:
      return (
        <div className="relative">
          <Input
            type={field.kind === 'number' ? 'number' : 'text'}
            inputMode={field.kind === 'number' ? 'decimal' : undefined}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => setKey(e.target.value)}
            placeholder={field.placeholder}
            disabled={readOnly}
            className={field.suffix ? 'pr-14' : undefined}
          />
          {field.suffix && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground pointer-events-none">
              {field.suffix}
            </span>
          )}
        </div>
      );
  }
}

/* ─── Bespoke widgets ─────────────────────────────────────────
 * These are agnostic to which team / template uses them — any
 * template can declare a `kind: 'block-rows'` or `'floor-rows'`
 * field and get the right editor. The row shapes are defined
 * loosely here so any team can reuse them; BA narrows them via
 * its own answers interface.
 * ─────────────────────────────────────────────────────────── */
interface BlockRowValue {
  name: string;
  dimensions: string;
  height: string;
  floors: string;
  purpose: string;
}

interface FloorRowValue {
  floor: string;
  purpose: string;
}

const EMPTY_BLOCK: BlockRowValue = {
  name: '',
  dimensions: '',
  height: '',
  floors: '',
  purpose: '',
};
const EMPTY_FLOOR: FloorRowValue = { floor: '', purpose: '' };

function BlockRowsEditor({
  rows,
  readOnly,
  onChange,
}: {
  rows: BlockRowValue[];
  readOnly: boolean;
  onChange: (rows: BlockRowValue[]) => void;
}) {
  const update = (idx: number, patch: Partial<BlockRowValue>) => {
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-separate border-spacing-y-1">
          <thead>
            <tr className="text-[11px] text-muted-foreground">
              <th className="text-left font-medium w-[90px]">Блок</th>
              <th className="text-left font-medium">Хэмжээ</th>
              <th className="text-left font-medium w-[90px]">Өндөр</th>
              <th className="text-left font-medium w-[90px]">Давхар</th>
              <th className="text-left font-medium">Зориулалт</th>
              <th className="w-[36px]"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx}>
                <td>
                  <Input
                    value={row.name}
                    onChange={(e) => update(idx, { name: e.target.value })}
                    disabled={readOnly}
                    placeholder="А блок"
                  />
                </td>
                <td>
                  <Input
                    value={row.dimensions}
                    onChange={(e) => update(idx, { dimensions: e.target.value })}
                    disabled={readOnly}
                    placeholder="30 × 12 м"
                  />
                </td>
                <td>
                  <Input
                    value={row.height}
                    onChange={(e) => update(idx, { height: e.target.value })}
                    disabled={readOnly}
                    placeholder="12.5 м"
                  />
                </td>
                <td>
                  <Input
                    value={row.floors}
                    onChange={(e) => update(idx, { floors: e.target.value })}
                    disabled={readOnly}
                    placeholder="3"
                  />
                </td>
                <td>
                  <Input
                    value={row.purpose}
                    onChange={(e) => update(idx, { purpose: e.target.value })}
                    disabled={readOnly}
                    placeholder="Хүлээн авах"
                  />
                </td>
                <td>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => onChange(rows.filter((_, i) => i !== idx))}
                    disabled={readOnly}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => onChange([...rows, { ...EMPTY_BLOCK }])}
        disabled={readOnly}
      >
        <Plus className="h-4 w-4 mr-1" /> Блок нэмэх
      </Button>
    </div>
  );
}

function FloorRowsEditor({
  rows,
  readOnly,
  onChange,
}: {
  rows: FloorRowValue[];
  readOnly: boolean;
  onChange: (rows: FloorRowValue[]) => void;
}) {
  const update = (idx: number, patch: Partial<FloorRowValue>) => {
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };
  return (
    <div className="space-y-2">
      {rows.map((row, idx) => (
        <div key={idx} className="grid grid-cols-12 gap-2 items-center">
          <div className="col-span-4">
            <Input
              value={row.floor}
              onChange={(e) => update(idx, { floor: e.target.value })}
              disabled={readOnly}
              placeholder="1-р давхар (+0.00)"
            />
          </div>
          <div className="col-span-7">
            <Input
              value={row.purpose}
              onChange={(e) => update(idx, { purpose: e.target.value })}
              disabled={readOnly}
              placeholder="Үндсэн орц, лобби, амралтын бүс"
            />
          </div>
          <div className="col-span-1 flex justify-end">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => onChange(rows.filter((_, i) => i !== idx))}
              disabled={readOnly}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => onChange([...rows, { ...EMPTY_FLOOR }])}
        disabled={readOnly}
      >
        <Plus className="h-4 w-4 mr-1" /> Давхар нэмэх
      </Button>
    </div>
  );
}

/* ─── Interior (IZ) widgets ───────────────────────────────────
 * zone-rows:        давтагдах бүс × өнгөлгөө, тоноглолын шийдэл (Хана/Шал/…).
 * floor-areas-rows: 3D рендерийн индекс — давхар → {хэсэг, хуудас}.
 * Row shape-ийг (block-rows/floor-rows шиг) энд кодолж, IZ-ийн
 * answers interface нарийсгана.
 * ─────────────────────────────────────────────────────────── */
interface ZoneRowValue {
  name: string;
  wall: string;
  floor: string;
  ceiling: string;
  lighting: string;
  doors: string;
  furniture: string;
  fixtures: string;
  general: string;
}

const EMPTY_ZONE: ZoneRowValue = {
  name: '',
  wall: '',
  floor: '',
  ceiling: '',
  lighting: '',
  doors: '',
  furniture: '',
  fixtures: '',
  general: '',
};

const ZONE_FACETS: ReadonlyArray<{ key: keyof Omit<ZoneRowValue, 'name'>; label: string }> = [
  { key: 'wall', label: 'Хана' },
  { key: 'floor', label: 'Шал' },
  { key: 'ceiling', label: 'Тааз' },
  { key: 'lighting', label: 'Гэрэлтүүлэг' },
  { key: 'doors', label: 'Хаалга, цонх' },
  { key: 'furniture', label: 'Тавилга' },
  { key: 'fixtures', label: 'Тоноглол (АЦӨ)' },
  { key: 'general', label: 'Ерөнхий шийдэл' },
];

function ZoneRowsEditor({
  rows,
  readOnly,
  onChange,
}: {
  rows: ZoneRowValue[];
  readOnly: boolean;
  onChange: (rows: ZoneRowValue[]) => void;
}) {
  const update = (idx: number, patch: Partial<ZoneRowValue>) => {
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };
  return (
    <div className="space-y-3">
      {rows.map((row, idx) => (
        <div key={idx} className="rounded-lg border border-border bg-card p-3 space-y-3">
          <div className="flex items-center gap-2">
            <Input
              value={row.name}
              onChange={(e) => update(idx, { name: e.target.value })}
              disabled={readOnly}
              placeholder="Бүсийн нэр (ж: Toyota хэсэг)"
              className="font-medium"
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => onChange(rows.filter((_, i) => i !== idx))}
              disabled={readOnly}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {ZONE_FACETS.map((f) => (
              <div key={f.key} className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">{f.label}</Label>
                <PolishableTextarea
                  value={row[f.key]}
                  onChange={(e) => update(idx, { [f.key]: e.target.value } as Partial<ZoneRowValue>)}
                  disabled={readOnly}
                  rows={2}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => onChange([...rows, { ...EMPTY_ZONE }])}
        disabled={readOnly}
      >
        <Plus className="h-4 w-4 mr-1" /> Бүс нэмэх
      </Button>
    </div>
  );
}

interface RenderAreaValue {
  name: string;
  pages: string;
}
interface FloorAreaRowValue {
  floor: string;
  firstPage: string;
  areas: RenderAreaValue[];
}

function FloorAreasRowsEditor({
  rows,
  readOnly,
  onChange,
}: {
  rows: FloorAreaRowValue[];
  readOnly: boolean;
  onChange: (rows: FloorAreaRowValue[]) => void;
}) {
  const update = (idx: number, patch: Partial<FloorAreaRowValue>) => {
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };
  const updateArea = (fi: number, ai: number, patch: Partial<RenderAreaValue>) => {
    update(fi, {
      areas: (rows[fi]?.areas ?? []).map((a, i) => (i === ai ? { ...a, ...patch } : a)),
    });
  };
  return (
    <div className="space-y-3">
      {rows.map((row, idx) => (
        <div key={idx} className="rounded-lg border border-border bg-card p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Input
              value={row.floor}
              onChange={(e) => update(idx, { floor: e.target.value })}
              disabled={readOnly}
              placeholder="Давхар (ж: 1-р давхар)"
              className="font-medium"
            />
            <Input
              value={row.firstPage}
              onChange={(e) => update(idx, { firstPage: e.target.value })}
              disabled={readOnly}
              placeholder="Эхлэх хуудас"
              className="w-32 shrink-0"
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => onChange(rows.filter((_, i) => i !== idx))}
              disabled={readOnly}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="space-y-1 pl-1">
            {(row.areas ?? []).map((a, ai) => (
              <div key={ai} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-8">
                  <Input
                    value={a.name}
                    onChange={(e) => updateArea(idx, ai, { name: e.target.value })}
                    disabled={readOnly}
                    placeholder="Хэсгийн нэр"
                  />
                </div>
                <div className="col-span-3">
                  <Input
                    value={a.pages}
                    onChange={(e) => updateArea(idx, ai, { pages: e.target.value })}
                    disabled={readOnly}
                    placeholder="Хуудас"
                  />
                </div>
                <div className="col-span-1 flex justify-end">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() =>
                      update(idx, { areas: (row.areas ?? []).filter((_, i) => i !== ai) })
                    }
                    disabled={readOnly}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => update(idx, { areas: [...(row.areas ?? []), { name: '', pages: '' }] })}
              disabled={readOnly}
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> Хэсэг нэмэх
            </Button>
          </div>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => onChange([...rows, { floor: '', firstPage: '', areas: [] }])}
        disabled={readOnly}
      >
        <Plus className="h-4 w-4 mr-1" /> Давхар нэмэх
      </Button>
    </div>
  );
}

/** One-click pre-fill button rendered above a section's fields when the
 *  template provides `section.preset`.  Visual is a soft accent card with
 *  a sparkle icon so it reads as "smart action" rather than another
 *  required input — engineers know they can ignore it if they want to
 *  fill the section by hand. */
function PresetButton({
  label,
  description,
  onApply,
}: {
  label: string;
  description?: string;
  onApply: () => void;
}) {
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 flex items-center gap-3 flex-wrap">
      <Sparkles className="w-4 h-4 text-primary flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-foreground">
          {label} утгуудаар автоматаар бөглөх
        </div>
        {description && (
          <div className="text-[11px] text-muted-foreground mt-0.5">{description}</div>
        )}
      </div>
      <Button type="button" size="sm" variant="outline" onClick={onApply}>
        Хэрэглэх
      </Button>
    </div>
  );
}
