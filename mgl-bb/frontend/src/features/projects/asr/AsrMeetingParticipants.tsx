import { useMemo } from 'react';
import { X } from 'lucide-react';
import { EmployeePicker } from '@/shared/components/EmployeePicker';
import { useLanguage } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';
import { Button } from '@/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import type { AsrChange } from './AsrEditor';
import { findParticipantByName } from './meetingDoc';
import { useMeetingParticipantOptions } from './useMeetingParticipantOptions';
import {
  ASR_MEETING_MAX_PARTICIPANTS,
  type AsrFormState,
  type AsrReport,
} from './types';

/**
 * Оффис уулзалтын «Оролцсон» мөр (0367, эзний хүсэлт 2026-09-30) — талбайн
 * «Хяналтаар явсан» багийн чагтын оронд, БҮХ идэвхтэй ажилтнаас хайж сонгоно.
 *
 * Хадгалалт нь талбайн «хамт явсан»-тай ИЖИЛ `companion_user_ids` →
 * `asr_report_companions`: оролцогч тайланг харж чадна (`asrVisibleSql`), ЗХ-ийн
 * «хэн хэзээ явсан» самбарт гарна.  Сервер төрлийг харж бүх ажилтнаас
 * (`scope: 'all'`) сонгохыг зөвшөөрнө.  Зохиогч нь үргэлж эхний оролцогч
 * (хасагдахгүй, сервер companions-оос хасдаг).
 */
export function AsrMeetingParticipants({
  entry,
  form,
  onChange,
  readOnly,
}: {
  entry: AsrReport;
  form: AsrFormState;
  onChange: AsrChange;
  readOnly: boolean;
}) {
  const { t } = useLanguage();
  const { participants, loading, pool } = useMeetingParticipantOptions(entry, form, !readOnly);
  const byId = useMemo(() => new Map(participants.map((p) => [p.id, p])), [participants]);

  const picked = form.companion_user_ids.filter((id) => id !== entry.author_id);
  const pickable = pool.filter((u) => u.id !== entry.author_id && !picked.includes(u.id));
  const full = picked.length >= ASR_MEETING_MAX_PARTICIPANTS;

  const nameOf = (id: number) => formatDisplayName(byId.get(id)?.name ?? '') || `#${id}`;
  const positionOf = (id: number) => byId.get(id)?.position ?? '';

  const add = (id: number) =>
    onChange((prev) =>
      prev.companion_user_ids.includes(id) ||
      prev.companion_user_ids.length >= ASR_MEETING_MAX_PARTICIPANTS
        ? {}
        : { companion_user_ids: [...prev.companion_user_ids, id] },
    );
  const remove = (id: number) =>
    onChange((prev) => ({ companion_user_ids: prev.companion_user_ids.filter((x) => x !== id) }));

  const chip = (id: number, author: boolean) => {
    const position = author ? entry.author_position : positionOf(id);
    const name = author ? formatDisplayName(entry.author_name) : nameOf(id);
    return (
      <li
        key={id}
        className="flex min-h-9 items-center gap-1.5 rounded-full border border-foreground/25 bg-muted/40 py-1 pl-3 pr-1.5 text-sm"
      >
        <span className="min-w-0 break-words">
          <span className="font-medium">{name}</span>
          {position && <span className="text-muted-foreground"> · {position}</span>}
          {author && <span className="text-micro text-muted-foreground"> ({t('asr.meeting.author')})</span>}
        </span>
        {!readOnly && !author && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => remove(id)}
            aria-label={t('asr.meeting.removeParticipant', { name })}
            className="shrink-0 rounded-full text-muted-foreground"
          >
            <X />
          </Button>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-2 px-3 py-2">
      <ul className="flex flex-wrap gap-1.5">
        {entry.author_name && chip(entry.author_id, true)}
        {picked.map((id) => chip(id, false))}
      </ul>
      {!readOnly &&
        (full ? (
          <p className="text-micro text-muted-foreground">
            {t('asr.meeting.participantsFull', { max: ASR_MEETING_MAX_PARTICIPANTS })}
          </p>
        ) : (
          <EmployeePicker
            users={pickable}
            value={null}
            showSelected={false}
            placeholder={loading ? t('common.loading') : t('asr.meeting.participantsPlaceholder')}
            onChange={(id) => add(id)}
            className="w-full sm:max-w-md"
          />
        ))}
    </div>
  );
}

/**
 * «Манай тал»-ын гарын үсэг зурагч (эзэн 2026-10-08) — «Оролцсон» мөрөнд
 * сонгосон хүмүүсээс (зохиогч + оролцогчид) НЭГИЙГ л сонгоно; сонгомогц
 * албан тушаал нь доор гарна.  Хадгалах нь `sig_arch_name` (түүхий бүтэн
 * нэр) — хэвлэх баримт/Word албан тушаалыг `meetingSigner`-ээр ижил
 * жагсаалтаас олдог тул тусдаа багана хэрэггүй.
 */
export function AsrMeetingSignerPicker({
  entry,
  form,
  onChange,
  readOnly,
}: {
  entry: AsrReport;
  form: AsrFormState;
  onChange: AsrChange;
  readOnly: boolean;
}) {
  const { t } = useLanguage();
  const { participants } = useMeetingParticipantOptions(entry, form, !readOnly);
  const current = form.sig_arch_name.trim();
  const match = findParticipantByName(participants, current);
  const stale = !!current && !match;

  const position = match?.position ?? '';
  const display = current ? formatDisplayName(current) : '';

  if (readOnly) {
    return (
      <div className="px-3 py-2 text-sm">
        <div className="font-medium">{display || '—'}</div>
        {position && <div className="text-xs text-muted-foreground">{position}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-1 px-1 py-1">
      <Select
        value={match ? String(match.id) : ''}
        onValueChange={(v) => {
          const p = participants.find((x) => String(x.id) === v);
          if (p) onChange({ sig_arch_name: p.name });
        }}
      >
        <SelectTrigger
          aria-label={t('asr.meeting.signerPlaceholder')}
          className="h-auto min-h-9 w-full border-0 bg-transparent px-2 text-left font-medium whitespace-normal shadow-none dark:bg-transparent"
        >
          <SelectValue placeholder={stale ? display : t('asr.meeting.signerPlaceholder')}>
            {display}
          </SelectValue>
        </SelectTrigger>
        <SelectContent position="popper" align="start">
          {participants.map((p) => (
            <SelectItem key={p.id} value={String(p.id)}>
              <span className="flex min-w-0 flex-col">
                <span className="font-medium">{formatDisplayName(p.name) || `#${p.id}`}</span>
                {p.position && (
                  <span className="text-xs text-muted-foreground">{p.position}</span>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {position && <div className="px-2 pb-1 text-xs text-muted-foreground">{position}</div>}
      {stale && (
        <p className="px-2 pb-1 text-micro text-warning">{t('asr.meeting.signerNotParticipant')}</p>
      )}
    </div>
  );
}
