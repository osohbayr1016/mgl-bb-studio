import { useQuery } from '@tanstack/react-query';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Textarea } from '@/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { useLanguage } from '@/shared/i18n';
import { apiFetch } from '@/shared/api/client';
import { Switch } from '@/ui/switch';
import { ParticipantsEditor, type Employee } from './ParticipantsEditor';
import { DiscussionEditor } from './DiscussionEditor';
import { ProjectMultiSelect } from './ProjectMultiSelect';
import type { MeetingMeta } from './types';

/** Shared editable minutes metadata — used by the upload dialog and the detail
 *  edit panel. The parent owns the state; this only renders + patches. */
export function MeetingMetaForm({
  value,
  onPatch,
  projects,
}: {
  value: MeetingMeta;
  onPatch: (patch: Partial<MeetingMeta>) => void;
  projects: Array<{ id: number; name: string }>;
}) {
  const { t } = useLanguage();

  // Employee directory for the participant picker (admin-only feature → /users ok).
  const employeesQuery = useQuery({
    queryKey: ['employees-min'],
    queryFn: () => apiFetch<{ users: Employee[] }>('/users'),
  });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>{t('meetingNotes.meetingTitle')}</Label>
        <Input
          value={value.title}
          onChange={(e) => onPatch({ title: e.target.value })}
          placeholder={t('meetingNotes.titlePlaceholder')}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>{t('meetingNotes.meetingDate')}</Label>
          <Input
            type="date"
            value={value.meeting_date}
            onChange={(e) => onPatch({ meeting_date: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>{t('meetingNotes.meetingTime')}</Label>
          <Input
            type="time"
            value={value.meeting_time}
            onChange={(e) => onPatch({ meeting_time: e.target.value })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>{t('meetingNotes.location')}</Label>
        <Input
          value={value.location}
          onChange={(e) => onPatch({ location: e.target.value })}
          placeholder={t('meetingNotes.locationPlaceholder')}
        />
      </div>

      {/* Хурлын төрөл: төслийн (олон төсөл сонгож болно) эсвэл компанийн
          (төсөлд уягдахгүй).  Компанийн хурал руу шилжихэд төслүүд хаягдана —
          сервер ч ижил инвариантыг барьдаг (kind='company' ⇔ төсөлгүй). */}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2">
        <div className="min-w-0">
          <Label htmlFor="meeting-kind-company" className="cursor-pointer">
            {t('meetingNotes.companyMeeting')}
          </Label>
          <p className="text-xs text-muted-foreground">{t('meetingNotes.companyMeetingHint')}</p>
        </div>
        <Switch
          id="meeting-kind-company"
          checked={value.kind === 'company'}
          onCheckedChange={(on) =>
            onPatch(on ? { kind: 'company', project_ids: [] } : { kind: 'project' })
          }
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>{t('meetingNotes.projects')}</Label>
          {value.kind === 'company' ? (
            <p className="text-sm text-muted-foreground py-2">{t('meetingNotes.noProject')}</p>
          ) : (
            <ProjectMultiSelect
              projects={projects}
              value={value.project_ids}
              onChange={(project_ids) => onPatch({ project_ids })}
            />
          )}
        </div>
        <div className="space-y-2">
          <Label>{t('meetingNotes.language')}</Label>
          <Select value={value.language} onValueChange={(v) => onPatch({ language: v })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mn">{t('meetingNotes.lang.mn')}</SelectItem>
              <SelectItem value="en">{t('meetingNotes.lang.en')}</SelectItem>
              <SelectItem value="ru">{t('meetingNotes.lang.ru')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>{t('meetingNotes.purpose')}</Label>
        <Textarea
          value={value.purpose}
          onChange={(e) => onPatch({ purpose: e.target.value })}
          placeholder={t('meetingNotes.purposePlaceholder')}
          rows={2}
        />
      </div>

      <div className="space-y-2">
        <Label>{t('meetingNotes.participants')}</Label>
        <ParticipantsEditor
          value={value.participants}
          onChange={(participants) => onPatch({ participants })}
          employees={employeesQuery.data?.users ?? []}
        />
      </div>

      <div className="space-y-2">
        <Label>{t('meetingNotes.discussion')}</Label>
        <DiscussionEditor
          value={value.discussion}
          onChange={(discussion) => onPatch({ discussion })}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>{t('meetingNotes.nextMeetingDate')}</Label>
          <Input
            type="date"
            value={value.next_meeting_date}
            onChange={(e) => onPatch({ next_meeting_date: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>{t('meetingNotes.nextMeetingTime')}</Label>
          {/* Огноогүй цаг протоколд хэвлэгдэхгүй тул огноо сонгоогүй үед идэвхгүй. */}
          <Input
            type="time"
            value={value.next_meeting_time}
            onChange={(e) => onPatch({ next_meeting_time: e.target.value })}
            disabled={!value.next_meeting_date}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>{t('meetingNotes.conclusion')}</Label>
        <Textarea
          value={value.conclusion}
          onChange={(e) => onPatch({ conclusion: e.target.value })}
          placeholder={t('meetingNotes.conclusionPlaceholder')}
          rows={2}
        />
      </div>
    </div>
  );
}
