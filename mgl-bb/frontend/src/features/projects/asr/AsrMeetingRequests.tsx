import { Plus, X } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import { DocText } from './AsrDocKit';
import { AsrInlineImages } from './AsrInlineImages';
import type { AsrChange } from './AsrEditor';
import {
  MEETING_LABEL,
  MEETING_REQUEST_MAX_ITEMS,
  MEETING_REQUEST_SIDES,
  emptyMeetingRequests,
  emptyRequestItem,
  toRequestItem,
  meetingRequestHeading,
  meetingRequestSideLabel,
  type MeetingRequestItem,
  type MeetingRequestSide,
  type MeetingRequests,
} from './meetingDoc';
import type { AsrFormState } from './types';

/**
 * «Уулзалтын агуулга» доторх хүсэлтийн хоёр хүснэгт (0396, эзний Word
 * уулзалтын тэмдэглэлийн хэлбэр):
 *
 *   0.1 Захиалагч   [оршил]
 *   ┌───┬────────────────┬──────────────┐
 *   │ № │ Хүсэлт гаргагч │ Тайлбар      │
 *   ├───┼────────────────┼──────────────┤
 *   │ 1 │   Захиалагч    │ …            │  ← «Хүсэлт гаргагч» нэгтгэсэн нүд
 *   ├───┴────────────────┴──────────────┤
 *   │███████ хар-хөх хөлийн мөр ████████│
 *   └───────────────────────────────────┘
 *
 * Хэвлэлтийн ихэр `AsrDocument.tsx` (`MeetingRequestTables`), Word
 * `buildAsrDocx.ts` (`meetingRequestXml`).  Хоосон мөр засварлагчид
 * харагдана, хэвлэлтэд алгасагдана.
 */
export function AsrMeetingRequests({
  form,
  onChange,
  readOnly,
}: {
  form: AsrFormState;
  onChange: AsrChange;
  readOnly: boolean;
}) {
  const value = form.meeting_requests ?? emptyMeetingRequests();

  const patchSide = (
    side: MeetingRequestSide,
    fn: (sec: MeetingRequests[MeetingRequestSide]) => MeetingRequests[MeetingRequestSide],
  ) =>
    onChange((prev) => {
      const cur = prev.meeting_requests ?? emptyMeetingRequests();
      return { meeting_requests: { ...cur, [side]: fn(cur[side]) } };
    });

  return (
    <div className="space-y-5 px-3 pb-4 pt-3">
      {MEETING_REQUEST_SIDES.map((side) => (
        <RequestTable
          key={side}
          side={side}
          intro={value[side].intro}
          items={value[side].items}
          readOnly={readOnly}
          onIntro={(intro) => patchSide(side, (s) => ({ ...s, intro }))}
          onItem={(i, fn) =>
            patchSide(side, (s) => ({
              ...s,
              items: s.items.map((x, j) => (j === i ? fn(toRequestItem(x)) : x)),
            }))
          }
          onAdd={() =>
            patchSide(side, (s) =>
              s.items.length >= MEETING_REQUEST_MAX_ITEMS
                ? s
                : { ...s, items: [...s.items, emptyRequestItem()] },
            )
          }
          onRemove={(i) => patchSide(side, (s) => ({ ...s, items: s.items.filter((_, j) => j !== i) }))}
        />
      ))}
    </div>
  );
}

function RequestTable({
  side,
  intro,
  items,
  readOnly,
  onIntro,
  onItem,
  onAdd,
  onRemove,
}: {
  side: MeetingRequestSide;
  intro: string;
  items: MeetingRequestItem[];
  readOnly: boolean;
  onIntro: (v: string) => void;
  onItem: (i: number, fn: (item: MeetingRequestItem) => MeetingRequestItem) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
}) {
  const { t } = useLanguage();
  const rows = items.length > 0 ? items : null;
  const sideLabel = meetingRequestSideLabel(side);

  return (
    <section aria-label={meetingRequestHeading(side)} className="space-y-1.5">
      <h4 className="text-sm font-bold">{meetingRequestHeading(side)}</h4>
      {(!readOnly || intro.trim()) && (
        <DocText
          rows={1}
          aria-label={t('asr.meeting.requestIntro')}
          placeholder={t('asr.meeting.requestIntroPlaceholder')}
          value={intro}
          readOnly={readOnly}
          aiPolish={false}
          className="min-h-9 py-1.5 not-italic"
          onChange={(e) => onIntro(e.target.value)}
        />
      )}
      <table className="w-full table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-10" />
          <col className="w-20 sm:w-32" />
          <col />
        </colgroup>
        <thead>
          <tr className="font-semibold">
            <th className="border border-foreground/70 px-1 py-1.5 text-center">
              {MEETING_LABEL.requestNo}
            </th>
            <th className="border border-foreground/70 px-1 py-1.5 text-center">
              {MEETING_LABEL.requestBy}
            </th>
            <th className="border border-foreground/70 px-2 py-1.5 text-center">
              {MEETING_LABEL.requestText}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows ? (
            rows.map((item, i) => (
              <tr key={i} className="align-top">
                <td className="border border-foreground/70 px-1 py-2 text-center tabular-nums">
                  {i + 1}
                </td>
                {i === 0 && (
                  <td
                    rowSpan={rows.length}
                    className="border border-foreground/70 px-1 text-center align-middle"
                  >
                    {sideLabel}
                  </td>
                )}
                <td className="border border-foreground/70 p-0">
                  <div className="flex items-start">
                    <div className="min-w-0 flex-1">
                      <DocText
                        rows={1}
                        aria-label={`${sideLabel} ${i + 1}`}
                        placeholder={
                          side === 'client'
                            ? t('asr.meeting.requestItemPlaceholderClient')
                            : t('asr.meeting.requestItemPlaceholderContractor')
                        }
                        value={toRequestItem(item).text}
                        readOnly={readOnly}
                        aiPolish={false}
                        className="min-h-9 py-1.5 not-italic"
                        onChange={(e) => {
                          const text = e.target.value;
                          onItem(i, (it) => ({ ...it, text }));
                        }}
                      />
                      {/* Мөрийн ард зураг (эзэн 2026-10-12) — хэвлэлт/Word-д бичвэрийн доор. */}
                      <AsrInlineImages
                        images={toRequestItem(item).images}
                        readOnly={readOnly}
                        label={`${sideLabel} ${i + 1}`}
                        onChange={(fn) => onItem(i, (it) => ({ ...it, images: fn(it.images) }))}
                      />
                    </div>
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => onRemove(i)}
                        aria-label={t('asr.meeting.requestRemove', { n: i + 1 })}
                        title={t('asr.meeting.requestRemove', { n: i + 1 })}
                        className="m-1 shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td className="border border-foreground/70 px-1 py-2 text-center text-muted-foreground">
                —
              </td>
              <td className="border border-foreground/70 px-1 text-center">
                {sideLabel}
              </td>
              <td className="border border-foreground/70 px-3 py-2 text-muted-foreground">
                {t('asr.meeting.requestEmpty')}
              </td>
            </tr>
          )}
          {/* Хөлийн мөр — эзний баримтын хар-хөх зурвас (хэвлэлтэд ч ижил). */}
          <tr aria-hidden>
            {[0, 1, 2].map((i) => (
              <td
                key={i}
                className="h-5 border border-foreground/70 bg-brand-navy p-0 dark:border-white/40"
              />
            ))}
          </tr>
        </tbody>
      </table>
      {!readOnly && items.length < MEETING_REQUEST_MAX_ITEMS && (
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={onAdd}>
          <Plus className="size-3.5" /> {t('asr.meeting.requestAdd')}
        </Button>
      )}
    </section>
  );
}
