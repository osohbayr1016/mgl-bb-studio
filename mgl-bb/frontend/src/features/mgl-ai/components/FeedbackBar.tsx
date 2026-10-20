import { useState } from 'react';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { Button } from '@/ui/button';
import { Textarea } from '@/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { apiFetch } from '@/shared/api/client';
import { FEEDBACK_REASONS, type FeedbackReason } from '@mgl/mglai-common/turn';
import { stampMessageContext } from '../lib/deployment';

/**
 * 👍/👎 + ЗАЛРУУЛГА (§29, §30).
 *
 * ⚠️ ТЕКСТ БИЧИХИЙГ ШААРДАХГҮЙ (§29: «Do not force users to type text»).
 *    👎 нь ангиллын товчнуудыг нээнэ; хэрэглэгч юу ч сонгохгүйгээр хаах
 *    боломжтой бөгөөд санал нь ХАДГАЛАГДСАН хэвээр үлдэнэ.
 *
 * ⚠️ ЭНЭ САНАЛ ЗАГВАРЫГ ШУУД ӨӨРЧЛӨХГҮЙ (§32).  Мөр нь `pending`
 *    төлөвтэй орж, зөвхөн АДМИНЫ баталгаагаар багц руу шилжинэ.  UI-д
 *    үүнийг ил хэлэх нь хэрэглэгчийн хүлээлтийг зөв тавина.
 */
const REASON_LABEL_MN: Record<FeedbackReason, string> = {
  incorrect: 'Буруу хариулсан',
  misunderstood: 'Асуултыг ойлгосонгүй',
  wrong_company_context: 'Компанийн мэдээлэл буруу',
  wrong_revit_context: 'Revit-ийн контекст буруу',
  wrong_regulation: 'Норм/дүрэм буруу',
  outdated: 'Хуучирсан мэдээлэл',
  hallucinated: 'Байхгүй зүйл зохиосон',
  too_long: 'Хэт урт',
  too_short: 'Хэт богино',
  slow: 'Удаан',
  unsafe_action: 'Аюултай үйлдэл санал болгосон',
  other: 'Бусад',
};

interface Props {
  convUid: string;
  msgUid: string;
  vote: 1 | -1 | null;
  onVoted: (vote: 1 | -1) => void;
}

export function FeedbackBar({ convUid, msgUid, vote, onVoted }: Props) {
  const [open, setOpen] = useState(false);
  const [reasons, setReasons] = useState<FeedbackReason[]>([]);
  const [text, setText] = useState('');
  const [correction, setCorrection] = useState('');
  const [saving, setSaving] = useState(false);

  async function send(v: 1 | -1, extra: Record<string, unknown> = {}) {
    setSaving(true);
    try {
      await apiFetch('/mgl-ai/feedback', {
        method: 'POST',
        data: { conv_uid: convUid, msg_uid: msgUid, vote: v, ...extra },
      });
      onVoted(v);
      // Session B — санал хүсэлтийг суулгацын хувилбараар тамгална (чимээгүй, fire-and-forget).
      void stampMessageContext(convUid, msgUid);
    } catch {
      // ⚠️ Санал алдагдсан нь ярианы урсгалыг зогсоох ЁСГҮЙ.  Чимээгүй
      //    унана — хэрэглэгч дахин дарж болно.
    } finally {
      setSaving(false);
    }
  }

  function toggle(r: FeedbackReason) {
    setReasons((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  }

  return (
    <>
      <div className="mt-2 flex items-center gap-1">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={`h-7 px-2 ${vote === 1 ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}
          disabled={saving}
          onClick={() => void send(1)}
          aria-label="Таалагдсан"
        >
          <ThumbsUp className="size-3.5" aria-hidden />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={`h-7 px-2 ${vote === -1 ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground'}`}
          disabled={saving}
          onClick={() => {
            // 👎 нь ШУУД хадгалагдана — попап нь НЭМЭЛТ, заавал биш.
            void send(-1);
            setOpen(true);
          }}
          aria-label="Таалагдаагүй"
        >
          <ThumbsDown className="size-3.5" aria-hidden />
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Юу нь болоогүй вэ?</DialogTitle>
            <DialogDescription>
              Заавал бөглөх шаардлагагүй — таны санал аль хэдийн хадгалагдсан. Нэмэлт мэдээлэл
              өгвөл засварлахад тусална. Санал бүрийг админ хянаж байж сургалтын багцад оруулна.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap gap-1.5">
            {FEEDBACK_REASONS.map((r) => (
              <Button
                key={r}
                type="button"
                size="sm"
                variant={reasons.includes(r) ? 'default' : 'outline'}
                className="h-7 text-xs"
                onClick={() => toggle(r)}
              >
                {REASON_LABEL_MN[r]}
              </Button>
            ))}
          </div>

          <div className="space-y-2">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Тайлбар (заавал биш)"
              rows={2}
            />
            <Textarea
              value={correction}
              onChange={(e) => setCorrection(e.target.value)}
              placeholder="Зөв хариу нь ямар байх ёстой байсан бэ? (заавал биш)"
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Хаах
            </Button>
            <Button
              type="button"
              disabled={saving}
              onClick={() => {
                void send(-1, {
                  reason_codes: reasons,
                  reason_text: text.trim() || undefined,
                  corrected_answer: correction.trim() || undefined,
                }).then(() => setOpen(false));
              }}
            >
              Илгээх
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
