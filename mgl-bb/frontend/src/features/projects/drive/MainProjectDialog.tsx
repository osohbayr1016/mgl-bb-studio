/**
 * Үндсэн төсөл үүсгэх / засах цонх (admin).
 *
 * Нэр, код, гишүүн ангиллын төслүүд (AZ/ZA/EZ/…) — эдгээр нь «Хадгалах»-аар
 * `POST|PUT /main-projects`.  Google Drive хавтас нь `DriveFolderForm`-оор
 * (scope='main') өөрийн товчтой: сервер хавтсыг Drive-аас баталгаажуулдаг тул
 * ерөнхий хадгалалттай нийлүүлдэггүй.  Шинэ үндсэн төсөл үүсмэгц цонх засах
 * горимд шилжиж, хавтас холбох маягт гарна.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Trash2 } from 'lucide-react';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Input } from '@/ui/input';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { createMainProject, deleteMainProject, updateMainProject } from './api';
import { DriveFolderForm } from './DriveFolderForm';
import type { MainProject, MainProjectMember } from './types';

export function MainProjectDialog({
  open,
  onOpenChange,
  main,
  /** Сонгож болох төслүүд: харьяалалгүй + (засах горимд) одоогийн гишүүд. */
  candidates,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** null = шинээр үүсгэх. */
  main: MainProject | null;
  candidates: MainProjectMember[];
}) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  // Үүсгэсний дараа ижил цонхонд засах горимд шилжинэ (хавтас холбохын тулд).
  const [createdId, setCreatedId] = useState<number | null>(null);
  const editingId = main?.id ?? createdId;
  const [name, setName] = useState(main?.name ?? '');
  const [code, setCode] = useState(main?.code ?? '');
  const [selected, setSelected] = useState<Set<number>>(new Set(main?.members.map((m) => m.id) ?? []));
  const [saving, setSaving] = useState(false);

  // Өөр үндсэн төсөл нээхэд талбаруудыг дахин тарина.
  useEffect(() => {
    if (!open) return;
    setCreatedId(null);
    setName(main?.name ?? '');
    setCode(main?.code ?? '');
    setSelected(new Set(main?.members.map((m) => m.id) ?? []));
  }, [open, main]);

  const options = useMemo(() => {
    const byId = new Map<number, MainProjectMember>();
    for (const m of main?.members ?? []) byId.set(m.id, m);
    for (const c of candidates) byId.set(c.id, c);
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [main, candidates]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['project-drive'] });

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const ids = [...selected];
      if (editingId == null) {
        const res = await createMainProject({ name: trimmed, code: code.trim() || null, project_ids: ids });
        setCreatedId(res.id);
        toast.success(t('mainProject.createdToast', { name: trimmed }));
      } else {
        await updateMainProject(editingId, { name: trimmed, code: code.trim() || null, project_ids: ids });
        toast.success(t('common.saved'));
      }
      await invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (editingId == null) return;
    const ok = await confirmDialog({
      description: t('mainProject.deleteConfirm', { name: name.trim() || main?.name || '' }),
      variant: 'destructive',
    });
    if (!ok) return;
    setSaving(true);
    try {
      await deleteMainProject(editingId);
      toast.success(t('mainProject.deletedToast'));
      await invalidate();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const toggle = (id: number, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editingId == null ? t('mainProject.createTitle') : t('mainProject.editTitle')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t('common.name')}
              </label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('mainProject.namePlaceholder')} autoFocus />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t('mainProject.code')}
              </label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="MGL-251222" spellCheck={false} />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('mainProject.members')}
            </label>
            {options.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('mainProject.noCandidates')}</p>
            ) : (
              <div className="max-h-56 space-y-1 overflow-auto rounded-md border border-border p-2">
                {options.map((p) => (
                  <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/50">
                    <Checkbox checked={selected.has(p.id)} onCheckedChange={(v) => toggle(p.id, v === true)} />
                    <span className="min-w-0 flex-1 truncate">{p.display_title?.trim() || p.name}</span>
                    {p.category && <Badge variant="outline">{p.category}</Badge>}
                    {p.status === 'archived' && (
                      <Badge variant="secondary">{t('mainProject.archived')}</Badge>
                    )}
                  </label>
                ))}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">{t('mainProject.membersHint')}</p>
          </div>

          {editingId != null ? (
            <div className="space-y-1.5 border-t border-border pt-4">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t('projectDrive.sectionTitle')}
              </label>
              <DriveFolderForm scope="main" id={editingId} compact />
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">{t('mainProject.folderAfterCreate')}</p>
          )}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {editingId != null ? (
            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={remove} disabled={saving}>
              <Trash2 className="h-4 w-4" /> {t('mainProject.delete')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              {t('common.close')}
            </Button>
            <Button onClick={save} disabled={saving || name.trim().length === 0}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {editingId == null ? t('mainProject.create') : t('common.save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
