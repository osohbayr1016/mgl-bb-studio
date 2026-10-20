/* =============================================================
 * «1.3 Project Timeline / Төслийн хугацаа» + «Meeting schedule».
 * -------------------------------------------------------------
 * Жишиг Word баримт дээр эдгээр нь ЗЭРЭГЦЭЭ хоёр хүснэгт бөгөөд
 * мөрийн тоо нь ТОГТМОЛ БИШ (Extension хоёр удаа гарч болно,
 * уулзалт 30/60/90/100 % байна).  Тиймээс хоёулаа мөр нэмж/хасаж
 * болдог хүснэгт.
 *
 * ⚠️ Хугацааны мөрийн `id` АЧААЛАЛ ҮҮРСЭН: сервер `tl-start` /
 * `tl-finish` / `tl-ext*`-ээр `start_date` / `finish_date` /
 * `extension_date` БАГАНА-г бөглөдөг ба тэдгээрийг `deadlines.ts`,
 * `company.ts` SQL-ээр уншдаг.  Шошгыг өөрчлөх аюулгүй, id-г БИШ —
 * тиймээс энэ хүснэгтэд id харагдахгүй, зөвхөн шошго засагдана.
 *
 * ⚠️ Уулзалтын хүснэгт нь урьд нь ProjectInfoTab-аас ХАСАГДСАН
 * байсан (`meeting_30/50/100` багана deprecated).  Эзний шийдвэр
 * 2026-09-02-оор жишиг баримтад байгаа тул `meetings_json`-оор
 * ЭРГЭЖ ОРЛОО — хуучин гурван багана хэвээр хөндөгдөхгүй.
 * ============================================================= */

import { CalendarClock, CalendarCheck, Plus, Sparkles, Trash2 } from 'lucide-react';
import type { ProjectMeetingRow, ProjectTimelineRow } from '@/shared/types';
import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
/* Баримт харагдац огноог `2026.09.25` (цэгтэй) хэлбэрээр state-д бичдэг —
 * `<input type="date">` зөвхөн ISO уншдаг тул хөрвүүлэхгүй бол нүд хоосон харагдана. */
import {
  blankMeetingRow,
  blankTimelineRow,
  defaultMeetingRows,
  toIsoDate,
} from './passportSections';

export function TimelineEditor({
  timeline,
  meetings,
  onTimelineChange,
  onMeetingsChange,
  readOnly = false,
}: {
  timeline: ProjectTimelineRow[];
  meetings: ProjectMeetingRow[];
  onTimelineChange: (next: ProjectTimelineRow[]) => void;
  onMeetingsChange: (next: ProjectMeetingRow[]) => void;
  readOnly?: boolean;
}) {
  const { t } = useLanguage();

  const patchTl = (id: string, key: keyof ProjectTimelineRow, v: string) =>
    onTimelineChange(timeline.map((r) => (r.id === id ? { ...r, [key]: v } : r)));
  const patchMt = (id: string, key: keyof ProjectMeetingRow, v: string) =>
    onMeetingsChange(meetings.map((r) => (r.id === id ? { ...r, [key]: v } : r)));

  /* Эхний хоёр мөр (`tl-start` / `tl-finish`) нь `start_date` /
   * `finish_date` баганыг тэжээдэг тул тэднийг УСТГАХЫГ хаана —
   * эс бөгөөс хугацаа хэтэрсэн сэрэмжлүүлэг чимээгүй унтарна. */
  const locked = (id: string) => id === 'tl-start' || id === 'tl-finish';

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {/* ---------------- Зүүн: хугацаа ---------------- */}
      <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <Label className="text-xs flex items-center gap-1.5 text-muted-foreground">
            <CalendarClock className="w-3.5 h-3.5 text-primary" />
            {t('projectInfoTab.timelineTitle')}
          </Label>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {timeline.map((r, i) => (
              <tr key={r.id} className="align-middle">
                <td className="py-1 pr-2 text-micro text-muted-foreground w-6">{i + 1}</td>
                <td className="py-1 pr-2">
                  <Input
                    className="h-8 text-sm"
                    value={r.labelMn}
                    readOnly={readOnly}
                    onChange={(e) => patchTl(r.id, 'labelMn', e.target.value)}
                    placeholder={t('projectInfoTab.timelineStart')}
                  />
                </td>
                <td className="py-1 pr-2 w-[10.5rem]">
                  <Input
                    type="date"
                    className="h-8 text-sm"
                    value={toIsoDate(r.date)}
                    readOnly={readOnly}
                    onChange={(e) => patchTl(r.id, 'date', e.target.value)}
                  />
                </td>
                {!readOnly && (
                  <td className="py-1 w-8">
                    {!locked(r.id) && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => onTimelineChange(timeline.filter((x) => x.id !== r.id))}
                        aria-label={t('common.delete')}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {!readOnly && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2 h-7 text-micro"
            onClick={() => onTimelineChange([...timeline, blankTimelineRow()])}
          >
            <Plus className="h-3 w-3 mr-1.5" />
            {t('projectInfoTab.addExtension')}
          </Button>
        )}
      </div>

      {/* ---------------- Баруун: уулзалтын хуваарь ---------------- */}
      <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <Label className="text-xs flex items-center gap-1.5 text-muted-foreground">
            <CalendarCheck className="w-3.5 h-3.5 text-primary" />
            {t('projectInfoTab.meetingsTitle')}
          </Label>
        </div>
        {meetings.length === 0 ? (
          <div className="space-y-2">
            <p className="text-micro text-muted-foreground italic">
              {t('projectInfoTab.meetingsEmpty')}
            </p>
            {/* ⚠️ Жишиг мөрүүдийг зөвхөн ИЛ дарж нэмнэ.  Автоматаар бөглөвөл
                хэрэглэгчийн бичээгүй 4 мөр хадгалалт бүрт DB рүү бичигдэж,
                устгасан ч дараагийн ачаалалт дээр эргэж ирдэг байв. */}
            {!readOnly && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-micro"
                onClick={() => onMeetingsChange(defaultMeetingRows())}
              >
                <Sparkles className="h-3 w-3 mr-1.5" />
                {t('projectInfoTab.meetingsSeed')}
              </Button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {meetings.map((r, i) => (
                <tr key={r.id} className="align-middle">
                  <td className="py-1 pr-2 text-micro text-muted-foreground w-6">{i + 1}</td>
                  <td className="py-1 pr-2">
                    <Input
                      className="h-8 text-sm"
                      value={r.label}
                      readOnly={readOnly}
                      onChange={(e) => patchMt(r.id, 'label', e.target.value)}
                      placeholder="10%"
                    />
                  </td>
                  <td className="py-1 pr-2 w-[10.5rem]">
                    <Input
                      type="date"
                      className="h-8 text-sm"
                      value={toIsoDate(r.date)}
                      readOnly={readOnly}
                      onChange={(e) => patchMt(r.id, 'date', e.target.value)}
                    />
                  </td>
                  {!readOnly && (
                    <td className="py-1 w-8">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => onMeetingsChange(meetings.filter((x) => x.id !== r.id))}
                        aria-label={t('common.delete')}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!readOnly && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2 h-7 text-micro"
            onClick={() => onMeetingsChange([...meetings, blankMeetingRow()])}
          >
            <Plus className="h-3 w-3 mr-1.5" />
            {t('projectInfoTab.addRow')}
          </Button>
        )}
      </div>
    </div>
  );
}
