import { useRef, type ReactNode } from 'react';
import { MessageSquareWarning, PencilLine, ThumbsDown, ThumbsUp, Users } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { Badge } from '@/ui/badge';
import { Checkbox } from '@/ui/checkbox';
import { cn } from '@/shared/lib/utils';
import { formatDateTime } from '@/shared/lib/time';

import { ASSISTANT_MIN_CONFIDENCE, type AssistantLogRow } from '../types';
import { intentLabel } from '../curation';

function decidedByLabel(t: (k: string) => string, decidedBy: string | null): string {
  if (!decidedBy) return '—';
  const key = `assistantCuration.decidedBy.${decidedBy}`;
  const label = t(key);
  return label === key ? decidedBy : label;
}

/**
 * БАГИЙН ТЭМДЭГЛЭГЭЭ — «энэ материал АЛЬ салбараас ирсэн бэ».
 *
 * ⚠️ ЯАГААД ЭНЭ ХЭРЭГТЭЙ ВЭ: `revit.ts:2590`-ийн `isManager()` нь admin
 * ЭСВЭЛ senior — багийн ГИШҮҮНЧЛЭЛИЙН шалгалт ХААНА Ч БАЙХГҮЙ.  Тиймээс
 * BA-гийн senior нь IZ-ийн инженерийн мөрийг хараад, шошголоод, дэвшүүлж
 * чадна.  `revit.ts:2403`-ын `AND review_status IS NULL` нь ЭХНИЙ
 * шийдвэрийг ялагч болгодог тул тэр алдааг БУЦААХ БОЛОМЖГҮЙ — багийн
 * корпус БАЙНГА бохирдоно.  Энэ тэмдэглэгээ бол хянагчийн ЦОРЫН ГАНЦ
 * сануулга.
 *
 * ⚠️ ГУРАВ САЛАА, `null` ба `undefined` хоёрыг ХОЛИХГҮЙ (`types.ts`-ийн
 * `AssistantLogRow.team_code`-ын тайлбар):
 *   · код байна        → кодыг харуулна.
 *   · `null`           → «Компани даяар» — сервер МЭДНЭ, баг нь тодорхойгүй.
 *   · `undefined`      → ЮУ Ч ХАРУУЛАХГҮЙ.  Сервер энэ баганыг хараахан
 *                        буцаадаггүй тул «компани даяар» гэж бичих нь
 *                        ХУДАЛ мэдэгдэл болно.  Хоосон газар нь дээр.
 */
function TeamBadge({ teamCode }: { teamCode: string | null | undefined }) {
  const { t } = useLanguage();
  if (teamCode === undefined) return null;
  if (!teamCode) {
    return (
      <Badge variant="ghost" className="gap-1">
        <Users aria-hidden />
        {t('assistantCuration.teamCompanyWide')}
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="gap-1"
      title={t('assistantCuration.teamBadgeTitle', { team: teamCode })}
    >
      <Users aria-hidden />
      {teamCode}
    </Badge>
  );
}

interface LogCardProps {
  row: AssistantLogRow;
  /** Багц сонголт.  `undefined` бол checkbox огт зурагдахгүй (хянасан таб). */
  selected?: boolean;
  /**
   * `range` — Shift дарсан үед АНХААРАЛТАЙ мөрөөс энэ мөр хүртэлх БҮХ мөрд
   * ижил үйлдэл хийнэ (жагсаалтын програмуудын нийтлэг конвенц).
   *
   * ⚠️ Shift-ийг ЭНД, `onClick`-оос уншина.  Radix-ийн `onCheckedChange` нь
   * үйл явдлыг ОГТ дамжуулдаггүй, харин Radix нь хэрэглэгчийн `onClick`-ыг
   * ӨӨРИЙНХӨӨСӨӨ ӨМНӨ дууддаг (`composeEventHandlers`) тул ref нь
   * `onCheckedChange` ажиллах үед аль хэдийн зөв утгатай байна.  Гараас
   * Space дархад ч `click` үүсдэг учир гарын хэрэглээ ч хамрагдана.
   */
  onToggleSelect?: (id: number, next: boolean, range: boolean) => void;
  /** Мөрийн доод талын үйлдлийн эгнээ. */
  actions?: ReactNode;
  /** Хянагчийн ӨӨРИЙНХ нь бичвэр эсэх — зөвхөн САНУУЛГА (§9-А-2 зөөлөн хувилбар). */
  isOwn?: boolean;
}

/**
 * Нэг бүртгэлийн карт.
 *
 * ⚠️ Багануудын дараалал нь СЕРВЕРИЙН эрэмбийг ДАГАНА — карт өөрөө юу ч
 * эрэмбэлэхгүй.  `/assistant/pending`-ийн `ORDER BY CASE` нь бүтээгдэхүүний
 * шийдвэр (чөлөөт тэмдэглэл → залруулга → 👎 → fallback → бусад); клиент
 * талд дахин эрэмбэлбэл хамгийн үнэ цэнтэй материал доош булагдана.
 */
export function LogCard({ row, selected, onToggleSelect, actions, isOwn }: LogCardProps) {
  const { t } = useLanguage();
  const lowConfidence = row.confidence != null && row.confidence < ASSISTANT_MIN_CONFIDENCE;
  const shiftRef = useRef(false);

  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-card p-4 space-y-3',
        row.feedback_note ? 'border-l-4 border-l-amber-500' : null,
      )}
    >
      <div className="flex items-start gap-3">
        {onToggleSelect ? (
          <Checkbox
            className="mt-1"
            checked={!!selected}
            onClick={(e) => {
              shiftRef.current = e.shiftKey;
            }}
            onCheckedChange={(v) => onToggleSelect(row.id, v === true, shiftRef.current)}
            // ⚠️ Ерөнхий «Мөрийг сонгох» БИШ.  Дэлгэц уншигч 200 checkbox-ыг
            //    ялгах ЗАМГҮЙ болно; эхний 80 тэмдэгт нь мөрийг таниулна.
            aria-label={t('assistantCuration.selectRowNamed', {
              text: row.text.slice(0, 80),
            })}
          />
        ) : null}
        <div className="min-w-0 flex-1 space-y-2">
          {/* Хэрэглэгчийн бичсэн ЯГ мөр — таслахгүй, бүтнээр нь. */}
          <p className="break-words text-body font-medium">{row.text}</p>

          <div className="flex flex-wrap items-center gap-1.5">
            {/* ⚠️ ТЭРГҮҮНД: хянагч эгнээг зүүнээс скан хийдэг тул «аль баг»
                нь санааны шошгоос ӨМНӨ уншигдана. */}
            <TeamBadge teamCode={row.team_code} />
            <Badge variant="secondary">{intentLabel(t, row.predicted)}</Badge>
            {row.confidence != null ? (
              <Badge variant={lowConfidence ? 'destructive' : 'outline'}>
                {row.confidence.toFixed(2)}
              </Badge>
            ) : null}
            <Badge variant="outline">{decidedByLabel(t, row.decided_by)}</Badge>
            {row.corrected ? (
              <Badge variant="default" className="gap-1">
                <PencilLine aria-hidden />
                {intentLabel(t, row.corrected)}
              </Badge>
            ) : null}
            {row.feedback === 1 ? (
              <Badge variant="outline" className="gap-1">
                <ThumbsUp aria-hidden />
              </Badge>
            ) : null}
            {row.feedback === -1 ? (
              <Badge variant="destructive" className="gap-1">
                <ThumbsDown aria-hidden />
              </Badge>
            ) : null}
            {row.acted === 0 ? (
              <Badge variant="ghost">{t('assistantCuration.notActed')}</Badge>
            ) : null}
          </div>

          {/* ЧӨЛӨӨТ ТЭМДЭГЛЭЛ — дарааллын хамгийн дээд эрэмбийн шалтгаан.
              Хүн бичих гэж цаг зарцуулсан тул БҮТНЭЭР харуулна, таслахгүй. */}
          {row.feedback_note ? (
            <div className="flex gap-2 rounded-md bg-amber-500/10 p-3 text-body">
              <MessageSquareWarning className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
              <p className="break-words whitespace-pre-wrap">{row.feedback_note}</p>
            </div>
          ) : null}

          {row.review_note ? (
            <div className="rounded-md bg-muted p-3 text-body">
              <span className="text-micro text-muted-foreground">
                {t('assistantCuration.reviewNoteLabel')}
              </span>
              <p className="break-words whitespace-pre-wrap">{row.review_note}</p>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-muted-foreground">
            <span>{row.user_name ?? '—'}</span>
            <span>{formatDateTime(row.created_at)}</span>
            {row.review_status ? (
              <span>
                {t(
                  row.review_status === 'promoted'
                    ? 'assistantCuration.statusPromoted'
                    : 'assistantCuration.statusRejected',
                )}
                {row.reviewer_name ? ` · ${row.reviewer_name}` : ''}
                {row.reviewed_at ? ` · ${formatDateTime(row.reviewed_at)}` : ''}
              </span>
            ) : null}
            {isOwn ? (
              <span className="text-amber-600">{t('assistantCuration.ownRowWarning')}</span>
            ) : null}
          </div>
        </div>
      </div>

      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
