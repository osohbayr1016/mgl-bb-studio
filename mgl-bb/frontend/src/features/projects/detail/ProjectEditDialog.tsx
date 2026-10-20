/** Admin-only quick-edit dialog for a project's identity fields.
 *  Extracted verbatim from `ProjectDetailPage.tsx` when that file was split
 *  into per-component modules — no behavioural change. */
import { useEffect, useState } from 'react';
import { Loader2, Pencil } from 'lucide-react';

import { apiFetch } from '@/shared/api/client';
import { toast } from '@/shared/components/Toast';
import type { ProjectDetailResponse } from '@/shared/types';
import { DEFAULT_COMPLEXITY_PCT, clampComplexityPct } from '@/shared/lib/complexity';
import { ComplexityPicker } from '@/features/projects/components/ComplexityPicker';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Textarea } from '@/ui/textarea';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { useLanguage } from '@/shared/i18n';
import { extractMapsUrl } from '@/shared/lib/mapsLink';
import { resolveMapsLink } from '@/features/projects/lib/resolveMapsLink';
// Google Drive хавтас — өөрийн endpoint-оор (`PUT /projects/:id/drive-folder`)
// хадгалагддаг: сервер хавтсыг Drive-аас баталгаажуулдаг тул энэ цонхны
// ерөнхий PUT-той нэгтгэхгүй, тусдаа маягт.  Үндсэн төслийн сонголт ч мөн
// өөрийн endpoint (`PUT /main-projects/assign`) — шууд хадгалагдана.
import { DriveFolderForm } from '@/features/projects/drive/DriveFolderForm';
import { MainProjectSelect } from '@/features/projects/drive/MainProjectSelect';

/* ---------- Project edit dialog ----------
 * Admin-only.  Lets us tweak the three free-text identity fields of a
 * project (name / description / location) without going through the
 * full structure-setup page. Anything more involved (clients, dates,
 * passport metadata) stays on the dedicated `Мэдээлэл` tab.
 * The Google Drive folder link lives here too (its own save button —
 * see `DriveFolderForm`). */
export function ProjectEditDialog({
  open,
  onOpenChange,
  project,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  project: ProjectDetailResponse['project'];
  onSaved: () => Promise<void> | void;
}) {
  const { t } = useLanguage();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [location, setLocation] = useState(project.location ?? '');
  const [complexityPct, setComplexityPct] = useState<number>(
    clampComplexityPct(project.complexity_pct ?? DEFAULT_COMPLEXITY_PCT),
  );
  const [saving, setSaving] = useState(false);

  // Re-seed when a new project is opened in the same dialog mount, just
  // in case the caller decides to keep us mounted across navigations.
  useEffect(() => {
    setName(project.name);
    setDescription(project.description ?? '');
    setLocation(project.location ?? '');
    setComplexityPct(clampComplexityPct(project.complexity_pct ?? DEFAULT_COMPLEXITY_PCT));
  }, [project.id, project.name, project.description, project.location, project.complexity_pct]);

  // Явцын горим (0339) нь 0348-аас хойш АНГИЛЛААС л хамаарна — ZA (Засвар) үргэлж
  // цагаар (эзний шийдвэр 2026-09-25).  Сонгох товч ХАСАГДСАН, зөвхөн тайлбар.
  // FURNITURE LAND (ZA #49) нь хувиараа үлдсэн (миграц 0353) — ангиллаар биш горимоор.
  const showProgressMode = project.progress_mode === 'hours';

  const trimmedName = name.trim();
  const canSave = trimmedName.length > 0 && !saving;

  /* Хаягийн талбарт Google Maps холбоос буулгасан бол (ажилтнууд ингэж
   * хийдэг) хадгалахдаа координатыг нь ЗАДАЛЖ `latitude/longitude`-д ХАМТ
   * бичнэ — эс тэгвэл холбоос бичвэр хэвээр үлдээд газрын зургийн пин
   * хоосон, «Google Maps дээр нээх» нь холбоосыг л нээдэг байсан.  Бичвэр
   * нь хэрэглэгчийн бичсэнээр хэвээр (хаяг + холбоос хамт байж болно).
   * Пин байгаа төсөлд ХОЛБООС ӨӨРЧЛӨГДӨӨГҮЙ бол пиныг хөндөхгүй
   * (`addressHint`-ийн амлалт). */
  const mapsUrl = extractMapsUrl(location);
  const mapsUrlChanged = mapsUrl !== null && mapsUrl !== extractMapsUrl(project.location);

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      let coords: { latitude: number; longitude: number } | null = null;
      if (mapsUrlChanged && mapsUrl) {
        const r = await resolveMapsLink(mapsUrl);
        if (r.ok) coords = { latitude: r.coords.lat, longitude: r.coords.lng };
        else toast.warn(t('projectMap.linkSavedNoPin'));
      }
      await apiFetch(`/projects/${project.id}`, {
        method: 'PUT',
        data: {
          name: trimmedName,
          description: description.trim() || null,
          location: location.trim() || null,
          complexity_pct: complexityPct,
          ...(coords ?? {}),
        },
      });
      if (coords) toast.success(t('projectMap.linkSavedPin'));
      await onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="w-4 h-4 text-primary" /> {t('projectDetailPage.editProjectInfo')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('common.name')}
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('projectDetailPage.projectNamePlaceholder')}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('common.description')}
            </label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('projectDetailPage.descriptionPlaceholder')}
              rows={4}
              className="resize-none"
            />
            <p className="text-[11px] text-muted-foreground">
              {t('projectDetailPage.descriptionHint')}
            </p>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('projectDetailPage.address')}
            </label>
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder={t('projectDetailPage.addressPlaceholder')}
            />
            <p className="text-[11px] text-muted-foreground">
              {mapsUrlChanged ? t('projectMap.linkInAddressHint') : t('projectDetailPage.addressHint')}
            </p>
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="edit-project-complexity"
              className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
            >
              {t('projectDetailPage.complexityWeightPct')}
            </label>
            <ComplexityPicker
              inputId="edit-project-complexity"
              value={complexityPct}
              onChange={setComplexityPct}
            />
            <p className="text-[11px] text-muted-foreground">
              {t('projectDetailPage.complexityHint')}
            </p>
          </div>
          {showProgressMode && (
            <div className="space-y-1.5 border-t border-border pt-4" data-testid="progress-mode-field">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t('projectDetailPage.progressModeLabel')}
              </label>
              <p className="text-sm font-medium text-foreground">
                {t('projectDetailPage.progressModeHours')}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {t('projectDetailPage.progressModeHoursHint')}
              </p>
            </div>
          )}
          <div className="space-y-1.5 border-t border-border pt-4">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('mainProject.sectionTitle')}
            </label>
            <MainProjectSelect projectId={project.id} onChanged={onSaved} />
            <p className="text-[11px] text-muted-foreground">{t('mainProject.selectHint')}</p>
          </div>
          <div className="space-y-1.5 border-t border-border pt-4">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('projectDrive.sectionTitle')}
            </label>
            <DriveFolderForm scope="project" id={project.id} onLinked={onSaved} compact />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <DialogClose asChild>
            <Button variant="outline" disabled={saving}>
              {t('projectDetailPage.cancelAction')}
            </Button>
          </DialogClose>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('common.saving')}
              </>
            ) : (
              t('common.save')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ProjectEditDialog;
