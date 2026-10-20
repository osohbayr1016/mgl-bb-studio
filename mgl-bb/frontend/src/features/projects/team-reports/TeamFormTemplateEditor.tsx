import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Pencil, Plus, RotateCcw, Save, Trash2, X } from 'lucide-react';
import { apiFetch } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { useAuth } from '@/shared/context/AuthContext';
import { toast } from '@/shared/components/Toast';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { Card, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Textarea } from '@/ui/textarea';
import type { SectionDef, FieldDef } from '@/features/projects/team-reports/types';
import type {
  TeamTemplateOverrides,
  TeamTemplateOverridesResponse,
} from '@/features/report-templates/types/teamTemplateOverrides';
import {
  TEAM_DRAWING_ITEMS_KEY,
  type TeamDrawingItem,
  type TeamDrawingItemsResponse,
} from '@/features/projects/team-reports/drawingList';

/* =============================================================
 * TeamFormTemplateEditor — per-project, per-team template
 * overrides editor body. Lives in both the admin page
 * (/app/admin/team-form-templates) and an inline dialog opened
 * from each team's тайлбар бичиг panel via TeamReportShell.
 * ============================================================= */

export interface TeamFormTemplateEditorProps {
  projectId: number;
  teamCode: string;
  /** Hardcoded baseline `SectionDef<A>[]` for the team — typically
   *  the team's `*_SECTIONS` array. */
  sections: readonly SectionDef<Record<string, unknown>>[];
  canManage: boolean;
  /** Optional title row shown above the editor (e.g.
   *  "Project · BA Барилга архитектур"). */
  heading?: React.ReactNode;
  /** Optional callback fired after a successful save. */
  onSaved?: () => void;
}

export function TeamFormTemplateEditor({
  projectId,
  teamCode,
  sections,
  canManage,
  heading,
  onSaved,
}: TeamFormTemplateEditorProps) {
  const queryClient = useQueryClient();
  const queryKey = ['/projects', projectId, 'team-form-templates', teamCode] as const;
  const overridesQuery = useApiQuery<TeamTemplateOverridesResponse>(
    queryKey,
    `/projects/${projectId}/team-form-templates/${teamCode}`,
    { retry: false },
  );

  const [overrides, setOverrides] = useState<TeamTemplateOverrides>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (overridesQuery.data) {
      setOverrides(overridesQuery.data.overrides ?? {});
      setDirty(false);
    }
  }, [overridesQuery.data]);

  const handleSectionField = (
    sectionId: string,
    fieldKey: string,
    patch: Partial<{ label: string; hint: string; placeholder: string }>,
  ) => {
    setOverrides((prev) => {
      const sec = prev.sections?.[sectionId] ?? {};
      const fields = sec.fields ?? {};
      const fo = fields[fieldKey] ?? {};
      const nextField = { ...fo, ...patch };
      (['label', 'hint', 'placeholder'] as const).forEach((k) => {
        if (nextField[k] === '') delete (nextField as Record<string, unknown>)[k];
      });
      const fieldsHasContent = Object.keys(nextField).length > 0;
      const nextFields = { ...fields };
      if (fieldsHasContent) nextFields[fieldKey] = nextField;
      else delete nextFields[fieldKey];
      const nextSec = { ...sec, fields: nextFields };
      if (!nextSec.fields || Object.keys(nextSec.fields).length === 0)
        delete (nextSec as Record<string, unknown>).fields;
      const sectionsMap = { ...(prev.sections ?? {}) };
      if (nextSec.title || nextSec.blurb || nextSec.fields) sectionsMap[sectionId] = nextSec;
      else delete sectionsMap[sectionId];
      setDirty(true);
      return { sections: sectionsMap };
    });
  };

  const handleSectionMeta = (
    sectionId: string,
    patch: Partial<{ title: string; blurb: string }>,
  ) => {
    setOverrides((prev) => {
      const sec = prev.sections?.[sectionId] ?? {};
      const nextSec = { ...sec, ...patch };
      if (nextSec.title === '') delete nextSec.title;
      if (nextSec.blurb === '') delete nextSec.blurb;
      const sectionsMap = { ...(prev.sections ?? {}) };
      if (nextSec.title || nextSec.blurb || nextSec.fields) sectionsMap[sectionId] = nextSec;
      else delete sectionsMap[sectionId];
      setDirty(true);
      return { sections: sectionsMap };
    });
  };

  const handleOptionLabel = (sectionId: string, fieldKey: string, value: string, label: string) => {
    setOverrides((prev) => {
      const sec = prev.sections?.[sectionId] ?? {};
      const fields = sec.fields ?? {};
      const fo = fields[fieldKey] ?? {};
      const existing = fo.options ?? [];
      const next = existing.filter((o) => o.value !== value);
      if (label.length > 0) next.push({ value, label });
      const nextField = { ...fo, options: next.length > 0 ? next : undefined };
      if (!nextField.options) delete nextField.options;
      const nextFields = { ...fields };
      if (Object.keys(nextField).length > 0) nextFields[fieldKey] = nextField;
      else delete nextFields[fieldKey];
      const nextSec = { ...sec, fields: nextFields };
      if (!nextSec.fields || Object.keys(nextSec.fields ?? {}).length === 0)
        delete (nextSec as Record<string, unknown>).fields;
      const sectionsMap = { ...(prev.sections ?? {}) };
      if (nextSec.title || nextSec.blurb || nextSec.fields) sectionsMap[sectionId] = nextSec;
      else delete sectionsMap[sectionId];
      setDirty(true);
      return { sections: sectionsMap };
    });
  };

  const resetField = (sectionId: string, fieldKey: string) => {
    setOverrides((prev) => {
      const sec = prev.sections?.[sectionId];
      if (!sec || !sec.fields) return prev;
      const nextFields = { ...sec.fields };
      delete nextFields[fieldKey];
      const nextSec = { ...sec, fields: nextFields };
      if (Object.keys(nextSec.fields ?? {}).length === 0)
        delete (nextSec as Record<string, unknown>).fields;
      const sectionsMap = { ...(prev.sections ?? {}) };
      if (nextSec.title || nextSec.blurb || nextSec.fields) sectionsMap[sectionId] = nextSec;
      else delete sectionsMap[sectionId];
      setDirty(true);
      return { sections: sectionsMap };
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      await apiFetch(`/projects/${projectId}/team-form-templates/${teamCode}`, {
        method: 'PUT',
        data: { overrides },
      });
      // Prefix invalidation — per-team key + Гүйцэтгэлийн тайлангийн preview-ийн
      // bulk ('full') түлхүүрийг хамтад нь сэргээнэ.
      queryClient.invalidateQueries({ queryKey: ['/projects', projectId, 'team-form-templates'] });
      queryClient.invalidateQueries({ queryKey: ['/projects/team-reports', projectId] });
      setDirty(false);
      toast.success('Хадгалагдлаа');
      onSaved?.();
    } catch (e) {
      toast.error('Хадгалж чадсангүй', e instanceof Error ? e.message : 'Алдаа');
    } finally {
      setSaving(false);
    }
  };

  const resetAll = async () => {
    if (!(await confirmDialog({ description: 'Бүх засваруудыг арилгах уу?', variant: 'destructive' }))) return;
    try {
      await apiFetch(`/projects/${projectId}/team-form-templates/${teamCode}`, {
        method: 'DELETE',
      });
      queryClient.invalidateQueries({ queryKey: ['/projects', projectId, 'team-form-templates'] });
      queryClient.invalidateQueries({ queryKey: ['/projects/team-reports', projectId] });
      setOverrides({});
      setDirty(false);
      toast.success('Үндсэн загвар руу буцлаа');
      onSaved?.();
    } catch (e) {
      toast.error('Буцаах боломжгүй', e instanceof Error ? e.message : 'Алдаа');
    }
  };

  if (overridesQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-20 gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Ачаалж байна…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-0">{heading}</div>
        {canManage && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={resetAll}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="w-4 h-4 mr-1.5" /> Бүх засварыг арилгах
            </Button>
            <Button size="sm" onClick={save} disabled={!dirty || saving}>
              {saving ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-1.5" />
              )}
              Хадгалах
            </Button>
          </>
        )}
      </div>

      {sections.map((section) => (
        <SectionEditor
          key={section.id}
          section={section}
          teamCode={teamCode}
          overrides={overrides.sections?.[section.id]}
          canManage={canManage}
          onSectionMeta={(patch) => handleSectionMeta(section.id, patch)}
          onField={(fieldKey, patch) => handleSectionField(section.id, fieldKey, patch)}
          onOptionLabel={(fieldKey, value, label) =>
            handleOptionLabel(section.id, fieldKey, value, label)
          }
          onResetField={(fieldKey) => resetField(section.id, fieldKey)}
        />
      ))}
    </div>
  );
}

/* ============================================================ */

function SectionEditor({
  section,
  teamCode,
  overrides,
  canManage,
  onSectionMeta,
  onField,
  onOptionLabel,
  onResetField,
}: {
  section: SectionDef<Record<string, unknown>>;
  teamCode: string;
  overrides:
    | {
        title?: string;
        blurb?: string;
        fields?: Record<
          string,
          {
            label?: string;
            hint?: string;
            placeholder?: string;
            options?: { value: string; label: string }[];
          }
        >;
      }
    | undefined;
  canManage: boolean;
  onSectionMeta: (patch: { title?: string; blurb?: string }) => void;
  onField: (
    fieldKey: string,
    patch: { label?: string; hint?: string; placeholder?: string },
  ) => void;
  onOptionLabel: (fieldKey: string, value: string, label: string) => void;
  onResetField: (fieldKey: string) => void;
}) {
  const effectiveTitle = overrides?.title ?? section.title;
  const effectiveBlurb = overrides?.blurb ?? section.blurb ?? '';

  return (
    <Card>
      <CardContent className="py-4 space-y-4">
        <div className="grid grid-cols-1 gap-2">
          <div>
            <Label className="text-xs">Хэсгийн нэр</Label>
            <Input
              value={effectiveTitle}
              disabled={!canManage}
              onChange={(e) => onSectionMeta({ title: e.target.value })}
            />
          </div>
          <div>
            <Label className="text-xs">Тайлбар (нэрний доор гарах текст)</Label>
            <Textarea
              rows={2}
              value={effectiveBlurb}
              disabled={!canManage}
              onChange={(e) => onSectionMeta({ blurb: e.target.value })}
              placeholder="Заавал биш. Жишээ нь: «Газар олголтын түвшин болон үндсэн зургийн даалгаврын товчоо.»"
            />
          </div>
        </div>

        <div className="space-y-3">
          {section.fields.map((field) => (
            <FieldEditor
              key={field.key as string}
              field={field}
              overrides={overrides?.fields?.[field.key as string]}
              canManage={canManage}
              onPatch={(patch) => onField(field.key as string, patch)}
              onOptionLabel={(value, label) => onOptionLabel(field.key as string, value, label)}
              onResetField={() => onResetField(field.key as string)}
            />
          ))}
        </div>

        {/* Зургийн жагсаалтын НИЙТЛЭГ нэмэлт мөрүүд — бүх төсөлд үйлчилнэ
            (дээрх текстийн override-ууд зөвхөн энэ төсөлд). */}
        {section.id === 'drawing-list' && (
          <GlobalDrawingItemsEditor teamCode={teamCode} canManage={canManage} />
        )}
      </CardContent>
    </Card>
  );
}

/* ============================================================
 * Нийтлэг зургийн жагсаалтын мөр удирдах хэсэг (/api/team-drawing-items).
 * Нэмэх/засах = admin+senior (canManage), устгах = admin. Мөр нь тухайн
 * багийн БҮХ төслийн форм + хэвлэх тайланд шууд гарна.
 * ============================================================ */
function GlobalDrawingItemsEditor({
  teamCode,
  canManage,
}: {
  teamCode: string;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const itemsQuery = useApiQuery<TeamDrawingItemsResponse>(
    TEAM_DRAWING_ITEMS_KEY,
    '/team-drawing-items',
    { staleTime: Infinity, retry: false },
  );
  const items = useMemo(
    () => (itemsQuery.data?.items ?? []).filter((it) => it.team_code === teamCode),
    [itemsQuery.data, teamCode],
  );

  const [newLabel, setNewLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState('');

  const refresh = () => queryClient.invalidateQueries({ queryKey: TEAM_DRAWING_ITEMS_KEY });

  const add = async () => {
    const label = newLabel.trim();
    if (!label || busy) return;
    setBusy(true);
    try {
      await apiFetch('/team-drawing-items', {
        method: 'POST',
        data: { team_code: teamCode, label },
      });
      setNewLabel('');
      await refresh();
      toast.success('Мөр нэмэгдлээ', 'Бүх төслийн жагсаалтад гарна.');
    } catch (e) {
      toast.error('Нэмж чадсангүй', e instanceof Error ? e.message : 'Алдаа');
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (item: TeamDrawingItem) => {
    const label = editLabel.trim();
    if (!label || busy) return;
    setBusy(true);
    try {
      await apiFetch(`/team-drawing-items/${item.id}`, { method: 'PATCH', data: { label } });
      setEditingId(null);
      await refresh();
      toast.success('Мөр шинэчлэгдлээ');
    } catch (e) {
      toast.error('Хадгалж чадсангүй', e instanceof Error ? e.message : 'Алдаа');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item: TeamDrawingItem) => {
    if (
      !(await confirmDialog({
        description: `«${item.label}» мөрийг бүх төслийн жагсаалтаас устгах уу?`,
        variant: 'destructive',
      }))
    )
      return;
    setBusy(true);
    try {
      await apiFetch(`/team-drawing-items/${item.id}`, { method: 'DELETE' });
      await refresh();
      toast.success('Мөр устгагдлаа');
    } catch (e) {
      toast.error('Устгаж чадсангүй', e instanceof Error ? e.message : 'Алдаа');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-2">
      <div>
        <Label className="text-xs font-semibold">Нийтлэг нэмэлт мөрүүд (бүх төсөлд)</Label>
        <p className="text-[11px] text-muted-foreground">
          Энд нэмсэн мөр {teamCode} багийн БҮХ төслийн зургийн жагсаалт болон хэвлэх тайланд
          гарна.
        </p>
      </div>

      {items.length > 0 && (
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-1.5 text-sm">
              {editingId === item.id ? (
                <>
                  <Input
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    className="h-7 text-xs flex-1"
                    autoFocus
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    disabled={busy || !editLabel.trim()}
                    onClick={() => saveEdit(item)}
                    aria-label="Хадгалах"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => setEditingId(null)}
                    aria-label="Болих"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </>
              ) : (
                <>
                  <span className="flex-1 min-w-0 truncate">{item.label}</span>
                  {canManage && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground"
                      onClick={() => {
                        setEditingId(item.id);
                        setEditLabel(item.label);
                      }}
                      aria-label="Засах"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {isAdmin && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      disabled={busy}
                      onClick={() => remove(item)}
                      aria-label="Устгах"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <div className="flex items-center gap-1.5">
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void add();
              }
            }}
            placeholder="Шинэ мөрийн нэр…"
            className="h-8 text-xs flex-1"
          />
          <Button type="button" size="sm" disabled={busy || !newLabel.trim()} onClick={add}>
            <Plus className="h-4 w-4 mr-1" /> Нэмэх
          </Button>
        </div>
      )}
    </div>
  );
}

function FieldEditor({
  field,
  overrides,
  canManage,
  onPatch,
  onOptionLabel,
  onResetField,
}: {
  field: FieldDef<Record<string, unknown>>;
  overrides:
    | {
        label?: string;
        hint?: string;
        placeholder?: string;
        options?: { value: string; label: string }[];
      }
    | undefined;
  canManage: boolean;
  onPatch: (patch: { label?: string; hint?: string; placeholder?: string }) => void;
  onOptionLabel: (value: string, label: string) => void;
  onResetField: () => void;
}) {
  const effLabel = overrides?.label ?? field.label;
  const effHint = overrides?.hint ?? field.hint ?? '';
  const effPlaceholder = overrides?.placeholder ?? field.placeholder ?? '';
  const hasOverride =
    !!overrides &&
    (overrides.label !== undefined ||
      overrides.hint !== undefined ||
      overrides.placeholder !== undefined ||
      (overrides.options && overrides.options.length > 0));

  const [moreOpen, setMoreOpen] = useState(false);
  const [techOpen, setTechOpen] = useState(false);

  const baseValues = new Set((field.options ?? []).map((o) => o.value));
  const customOptions = (overrides?.options ?? []).filter((o) => !baseValues.has(o.value));

  return (
    <div className="border rounded-md p-3 space-y-2 bg-card/40">
      <div className="space-y-1.5">
        <Label className="text-xs">Талбарын нэр</Label>
        <Input
          value={effLabel}
          disabled={!canManage}
          onChange={(e) => onPatch({ label: e.target.value })}
        />
      </div>

      <button
        type="button"
        onClick={() => setMoreOpen((v) => !v)}
        className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
      >
        {moreOpen ? '−' : '+'} Нэмэлт тохиргоо (туслах текст, placeholder)
      </button>
      {moreOpen && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
          <div>
            <Label className="text-xs">Туслах текст (hint)</Label>
            <Input
              value={effHint}
              disabled={!canManage}
              onChange={(e) => onPatch({ hint: e.target.value })}
            />
          </div>
          <div>
            <Label className="text-xs">Placeholder</Label>
            <Input
              value={effPlaceholder}
              disabled={!canManage}
              onChange={(e) => onPatch({ placeholder: e.target.value })}
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <button
          type="button"
          onClick={() => setTechOpen((v) => !v)}
          className="inline-flex items-center gap-1 hover:text-foreground"
        >
          {techOpen ? '−' : 'ⓘ'} Технологийн дэлгэрэнгүй
        </button>
        {techOpen && (
          <span className="font-mono">
            {field.key as string}
            <span className="opacity-60"> · {field.kind}</span>
          </span>
        )}
        {canManage && hasOverride && (
          <button
            type="button"
            onClick={onResetField}
            className="ml-auto inline-flex items-center gap-1 hover:text-foreground"
          >
            <RotateCcw className="w-3 h-3" /> Үндсэн рүү буцаах
          </button>
        )}
      </div>

      {field.kind === 'select' && field.options && field.options.length > 0 && (
        <OptionsEditor
          baseOptions={field.options}
          overrideOptions={overrides?.options ?? []}
          customOptions={customOptions}
          canManage={canManage}
          onSetLabel={(value, label) => onOptionLabel(value, label)}
        />
      )}
    </div>
  );
}

function OptionsEditor({
  baseOptions,
  overrideOptions,
  customOptions,
  canManage,
  onSetLabel,
}: {
  baseOptions: { value: string; label: string }[];
  overrideOptions: { value: string; label: string }[];
  customOptions: { value: string; label: string }[];
  canManage: boolean;
  onSetLabel: (value: string, label: string) => void;
}) {
  const [draftRows, setDraftRows] = useState<
    Array<{ tempId: string; value: string; label: string }>
  >([]);

  const baseValues = new Set(baseOptions.map((o) => o.value));
  const customValues = new Set(customOptions.map((o) => o.value));
  const allClaimedValues = new Set<string>([...baseValues, ...customValues]);

  const handleAdd = () => {
    const tempId = `tmp_${Math.random().toString(36).slice(2, 8)}`;
    setDraftRows((p) => [
      ...p,
      {
        tempId,
        value: `custom_${Math.random().toString(36).slice(2, 8)}`,
        label: '',
      },
    ]);
  };

  const commitDraft = (tempId: string) => {
    const row = draftRows.find((r) => r.tempId === tempId);
    if (!row) return;
    const v = row.value.trim();
    const l = row.label.trim();
    if (!l) return;
    if (!/^[a-zA-Z0-9_]+$/.test(v)) return;
    if (allClaimedValues.has(v)) return;
    onSetLabel(v, l);
    setDraftRows((p) => p.filter((r) => r.tempId !== tempId));
  };

  return (
    <div className="space-y-1.5 pt-1 mt-1 border-t border-border/60">
      <div className="text-[11px] text-muted-foreground pt-1">Сонголтуудын нэр:</div>

      {baseOptions.map((opt) => {
        const ov = overrideOptions.find((x) => x.value === opt.value);
        return (
          <OptionRow
            key={opt.value}
            value={opt.value}
            label={ov?.label ?? opt.label}
            canManage={canManage}
            onLabel={(label) => onSetLabel(opt.value, label)}
          />
        );
      })}

      {customOptions.map((opt) => (
        <OptionRow
          key={opt.value}
          value={opt.value}
          label={opt.label}
          custom
          canManage={canManage}
          onLabel={(label) => onSetLabel(opt.value, label)}
          onRemove={() => onSetLabel(opt.value, '')}
        />
      ))}

      {draftRows.map((row) => {
        const v = row.value.trim();
        const validValue = /^[a-zA-Z0-9_]+$/.test(v);
        const unique = !allClaimedValues.has(v);
        const valueErr = !validValue
          ? 'a-z, 0-9, _ зөвшөөрөгдөнө'
          : !unique
            ? 'давхцаж байна'
            : null;
        return (
          <div
            key={row.tempId}
            className="space-y-1 border border-dashed border-primary/40 rounded p-1.5 bg-primary/5"
          >
            <div className="flex items-center gap-2">
              <Input
                value={row.value}
                onChange={(e) =>
                  setDraftRows((p) =>
                    p.map((r) => (r.tempId === row.tempId ? { ...r, value: e.target.value } : r)),
                  )
                }
                placeholder="value (custom_*)"
                className="h-8 text-xs w-44 font-mono"
              />
              <Input
                value={row.label}
                onChange={(e) =>
                  setDraftRows((p) =>
                    p.map((r) => (r.tempId === row.tempId ? { ...r, label: e.target.value } : r)),
                  )
                }
                placeholder="Харагдах нэр"
                className="flex-1 h-8 text-xs"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={!!valueErr || !row.label.trim()}
                onClick={() => commitDraft(row.tempId)}
              >
                Нэмэх
              </Button>
              <button
                type="button"
                className="text-muted-foreground hover:text-destructive p-1"
                onClick={() => setDraftRows((p) => p.filter((r) => r.tempId !== row.tempId))}
                title="Болих"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {valueErr && <div className="text-[10px] text-destructive pl-1">{valueErr}</div>}
          </div>
        );
      })}

      {canManage && (
        <div className="pt-1">
          <Button variant="ghost" size="sm" onClick={handleAdd} className="h-7 text-xs">
            <Plus className="w-3.5 h-3.5 mr-1" /> Сонголт нэмэх
          </Button>
        </div>
      )}

      {customOptions.length > 0 && (
        <div className="text-[10px] text-amber-700/80 italic pt-1">
          Шинэ сонголтын хэвлэлийн нэр нь үндсэн загвар өөрчлөгдөх хүртэл анхдагч утга (жишээ нь
          "custom_abc123") хэлбэрээр гарч магадгүй.
        </div>
      )}
    </div>
  );
}

function OptionRow({
  value,
  label,
  custom = false,
  canManage,
  onLabel,
  onRemove,
}: {
  value: string;
  label: string;
  custom?: boolean;
  canManage: boolean;
  onLabel: (label: string) => void;
  onRemove?: () => void;
}) {
  const [local, setLocal] = useState(label);

  useMemo(() => setLocal(label), [label]);

  return (
    <div className="flex items-center gap-2">
      {custom ? (
        <span
          className="text-[10px] text-amber-700 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300 px-1.5 py-0.5 rounded font-mono w-24 truncate"
          title={value}
        >
          {value}
        </span>
      ) : (
        <span className="font-mono text-[10px] text-muted-foreground w-24 truncate" title={value}>
          {value}
        </span>
      )}
      <Input
        value={local}
        disabled={!canManage}
        onChange={(e) => {
          setLocal(e.target.value);
          onLabel(e.target.value);
        }}
        className="flex-1 h-8 text-xs"
      />
      {custom && canManage && onRemove && (
        <button
          type="button"
          className="text-muted-foreground hover:text-destructive p-1"
          onClick={onRemove}
          title="Сонголтыг устгах"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
