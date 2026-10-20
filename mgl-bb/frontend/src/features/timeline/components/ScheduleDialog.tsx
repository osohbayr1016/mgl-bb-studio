/* ─────────────────────────────────────────────────────────────────────────
 * Хуваарь тавих диалог — эхлэх / дуусах огноо (+ гар прогресс)
 * -------------------------------------------------------------------------
 * Repo-д огноо сонгогч компонент БАЙХГҮЙ: бүх 36 огнооны талбар нь төрөлх
 * `<input type="date">` (ж: `features/projects/detail/TaskDatesEditor.tsx`).
 * Тиймээс энд ч мөн адил.
 *
 * Талбар цэвэрлэх = хоосон утга → сервер рүү `null` илгээнэ.
 * Клиент талын шалгалт нь серверийн дүрмийг ЯГ давхарлана (буруу формат,
 * дуусах < эхлэх) — сервер нь жинхэнэ хаалт хэвээр.
 *
 * `has_breakdown === false` үед (блок/зураг/эд ангийн мод огт байхгүй жижиг
 * засварын ажил) прогресс нь мөнхөд 0% байх тул гараар оруулах талбар нэмэгдэнэ.
 * ───────────────────────────────────────────────────────────────────────── */
import { useState } from 'react';
import { CalendarPlus, CalendarRange, Eraser, Loader2 } from 'lucide-react';

import { ApiError } from '@/shared/api/client';
import { useLanguage } from '@/shared/i18n';
import { toast } from '@/shared/components/Toast';
import { Button } from '@/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';

import type { TimelineProject } from '../types';
import { saveManualProgress, saveSchedule } from '../api';

interface ScheduleDialogProps {
  /** `null` үед диалог хаалттай. */
  project: TimelineProject | null;
  onOpenChange: (open: boolean) => void;
  /** Амжилттай хадгалсны дараа — cache-ийг шинэчлэх. */
  onSaved: () => void;
  /** Дуусах огноог ХОЙШЛУУЛАХ нь сунгалт (migration 0337) — хэрэглэгч
   *  «сунгалт болгож бүртгэх» гэж сонговол энэ диалог хаагдаж, дуудагч
   *  `ExtensionDialog`-ийг тэр огноогоор нээнэ. */
  onExtend: (project: TimelineProject, newFinishDate: string) => void;
}

/** Хатуу `YYYY-MM-DD` + жинхэнэ хуанлийн огноо эсэх. */
function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return false;
  // `2026-02-31` мэт огноог JS чимээгүй нааш нь гүйлгэдэг тул буцааж шалгана.
  return date.toISOString().slice(0, 10) === value;
}

export function ScheduleDialog({ project, onOpenChange, onSaved, onExtend }: ScheduleDialogProps) {
  return (
    <Dialog open={project !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {project && (
          // `key` — өөр төсөл сонгоход draft-ууд шинээр эхэлнэ (useEffect хэрэггүй).
          <ScheduleDialogBody
            key={project.id}
            project={project}
            onOpenChange={onOpenChange}
            onSaved={onSaved}
            onExtend={onExtend}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ScheduleDialogBody({
  project,
  onOpenChange,
  onSaved,
  onExtend,
}: {
  project: TimelineProject;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onExtend: (project: TimelineProject, newFinishDate: string) => void;
}) {
  const { t } = useLanguage();
  const [start, setStart] = useState((project.start_date ?? '').slice(0, 10));
  const [finish, setFinish] = useState((project.finish_date ?? '').slice(0, 10));
  const [manual, setManual] = useState(
    project.manual_progress == null ? '' : String(project.manual_progress),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /* Хойшлуулсан огноо илэрсэн (клиент дээр эсвэл сервер 409-өөр) — хэрэглэгч
   * «сунгалт» / «зөвхөн засвар» гэж сонгох хүртэл хадгалахгүй.  Засвар бол
   * `change_kind: 'correction'` + тайлбартайгаар дахин илгээнэ. */
  const [laterPrompt, setLaterPrompt] = useState(false);
  const [correctionNote, setCorrectionNote] = useState('');

  const needsManual = project.has_breakdown === false;

  const currentFinishIso =
    project.finish_date && isIsoDate(project.finish_date) ? project.finish_date : null;

  const submit = async (asCorrection = false) => {
    const startValue = start.trim() || null;
    const finishValue = finish.trim() || null;

    // Формат — төрөлх талбар нь зөвхөн хүчинтэй утга өгдөг ч passport баганууд
    // нь чөлөөт текст тул анхны утга нь ('-' гэх мэт) энд орж ирж болно.
    if ((startValue && !isIsoDate(startValue)) || (finishValue && !isIsoDate(finishValue))) {
      setError(t('timelinePage.invalidDate'));
      return;
    }
    if (startValue && finishValue && finishValue < startValue) {
      setError(t('timelinePage.finishBeforeStart'));
      return;
    }

    // Хойшлуулах = сунгалт (0337).  Сервер ч ижил дүрмээр 409 буцаана; энд
    // урьдчилан асууснаар алдааны тойрог үүсгэхгүй.
    if (!asCorrection && finishValue && currentFinishIso && finishValue > currentFinishIso) {
      setLaterPrompt(true);
      return;
    }

    setError(null);
    setSaving(true);
    try {
      await saveSchedule(project.id, {
        start_date: startValue,
        finish_date: finishValue,
        ...(asCorrection
          ? { change_kind: 'correction' as const, note: correctionNote.trim() || undefined }
          : {}),
      });

      if (needsManual) {
        const raw = manual.trim();
        let next: number | null = null;
        if (raw !== '') {
          const parsed = Number(raw);
          if (!Number.isFinite(parsed)) {
            setError(t('timelinePage.invalidDate'));
            setSaving(false);
            return;
          }
          next = Math.max(0, Math.min(100, parsed));
        }
        if (next !== project.manual_progress) {
          await saveManualProgress(project.id, next);
        }
      }

      toast.success(t('timelinePage.saved'));
      onSaved();
      onOpenChange(false);
    } catch (e: unknown) {
      // Паспортын түүхий утга ISO биш байхад (`2026.07.09`) клиент хойшлуулалтыг
      // мэдэхгүй — сервер л хэлнэ.
      if (e instanceof ApiError && e.code === 'EXTENSION_REQUIRED') {
        setLaterPrompt(true);
        setSaving(false);
        return;
      }
      const message = e instanceof Error ? e.message : t('common.error');
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <CalendarRange className="h-4 w-4 text-primary" />
          {t('timelinePage.scheduleTitle')}
        </DialogTitle>
        <DialogDescription>{project.display_title?.trim() || project.name}</DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-2">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="timeline-start" className="text-xs font-medium">
              {t('timelinePage.startDate')}
            </Label>
            <Input
              id="timeline-start"
              type="date"
              value={start}
              max={finish || undefined}
              onChange={(e) => setStart(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="timeline-finish" className="text-xs font-medium">
              {t('timelinePage.finishDate')}
            </Label>
            <Input
              id="timeline-finish"
              type="date"
              value={finish}
              min={start || undefined}
              onChange={(e) => setFinish(e.target.value)}
            />
          </div>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5"
          disabled={saving || (!start && !finish)}
          onClick={() => {
            setStart('');
            setFinish('');
            setError(null);
          }}
        >
          <Eraser className="h-3.5 w-3.5" />
          {t('timelinePage.clearDates')}
        </Button>

        {/* Задаргаагүй (блокгүй) төсөл — прогрессыг гараар оруулна. */}
        {needsManual && (
          <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-3">
            <Label htmlFor="timeline-manual" className="text-xs font-medium">
              {t('timelinePage.manualProgress')}
            </Label>
            <p className="text-micro text-muted-foreground">{t('timelinePage.noBreakdown')}</p>
            <div className="flex items-center gap-2">
              <div className="relative w-28">
                <Input
                  id="timeline-manual"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  inputMode="numeric"
                  value={manual}
                  onChange={(e) => setManual(e.target.value)}
                  className="pr-6 tabular-nums"
                />
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  %
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={saving || manual === ''}
                onClick={() => setManual('')}
              >
                {t('timelinePage.manualProgressClear')}
              </Button>
            </div>
            <p className="text-micro text-muted-foreground">
              {t('timelinePage.manualProgressHint')}
            </p>
          </div>
        )}

        {/* Хойшлуулсан огноо: сунгалт уу, засвар уу? (migration 0337) */}
        {laterPrompt && (
          <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
            <p className="text-body text-foreground">{t('deadlineExt.laterHint')}</p>
            <Input
              value={correctionNote}
              maxLength={1000}
              placeholder={t('deadlineExt.correctionNote')}
              onChange={(e) => setCorrectionNote(e.target.value)}
            />
            <div className="flex flex-wrap gap-1.5">
              <Button
                type="button"
                size="sm"
                disabled={saving}
                onClick={() => {
                  onOpenChange(false);
                  onExtend(project, finish.trim());
                }}
              >
                <CalendarPlus className="h-3.5 w-3.5" />
                {t('deadlineExt.asExtension')}
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => void submit(true)}>
                {t('deadlineExt.asCorrection')}
              </Button>
            </div>
          </div>
        )}

        {error && (
          <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-micro text-danger">
            {error}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
          {t('timelinePage.cancel')}
        </Button>
        <Button disabled={saving || laterPrompt} onClick={() => void submit()}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {t('timelinePage.save')}
        </Button>
      </DialogFooter>
    </>
  );
}

export default ScheduleDialog;
