import { useState } from 'react';

import { useLanguage } from '@/shared/i18n';
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
import { Textarea } from '@/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select';

import { ASSISTANT_INTENTS, SLOT_INTENTS, type AssistantIntent } from '../types';
import { intentLabel } from '../curation';

/** `review_note` / `feedback_note`-ийн серверийн хязгаар (`revit.ts` `str(v, 500)`). */
const MAX_NOTE = 500;

interface RejectDialogProps {
  open: boolean;
  /** Хэдэн мөр татгалзагдах гэж байна (багц үйлдэлд > 1). */
  count: number;
  busy?: boolean;
  /**
   * Гарчиг / тайлбарын i18n түлхүүр.  Анхдагч нь ТҮҮХИЙ БҮРТГЭЛИЙН татгалзал
   * (`/assistant/review`).  Сургалтын багц дахь ЖИШЭЭГ унтраахад
   * (`/assistant/reject` — `example_ids`) утга нь өөр: тэр мөр аль хэдийн
   * корпуст ОРСОН бөгөөд одоо ХАСАГДАЖ байна.  Хоёрыг нэг үгээр тайлбарлах
   * нь хянагчийг төөрөгдүүлнэ.
   */
  titleKey?: string;
  hintKey?: string;
  /**
   * Шалтгааныг ЗААВАЛ болгоно (анхдагч: үгүй).
   *
   * ⚠️ ЯАГААД PROP ВЭ, ЯАГААД БҮХ ГАЗАРТ ЗААВАЛ БИШ ВЭ: энэ цонхыг ХОЁР
   * гарц дууддаг.  Курацийн дараалалд татгалзал бол корпусын хамгийн үнэ
   * цэнтэй СӨРӨГ дохио («яагаад энэ мөр сургалтад орох ЁСГҮЙ вэ») бөгөөд
   * тэр текст нь `assistant_logs.review_note`-д ҮҮРД үлдэнэ — багцаар 40
   * мөр хаяхад шалтгаангүй үлдээх нь тэр 40 мөрийг ХОГ болгоно.  Харин
   * сургалтын багц дахь ЖИШЭЭГ унтраах гарц нь өөр семантиктай (мөр аль
   * хэдийн корпуст орсон, одоо буцаагдаж байна) тул түүний зан төлөвийг
   * ЭНЭ өөрчлөлт ХӨНДӨХГҮЙ — анхдагч нь `false`.
   */
  requireNote?: boolean;
  onCancel: () => void;
  onConfirm: (note: string) => void;
}

/**
 * ТАТГАЛЗАХ харилцах цонх.
 *
 * ⚠️ Шалтгаан нь СОНГОЛТТОЙ (сервер шаарддаггүй) ч энэ нь курацийн хамгийн
 * үнэ цэнтэй гаралт — «яагаад энэ мөр сургалтад орох ЁСГҮЙ вэ».  Тиймээс
 * талбар нь автоматаар фокустай, тайлбар нь түүнийг бичихийг уриална.
 */
export function RejectDialog({
  open,
  count,
  busy,
  titleKey = 'assistantCuration.rejectTitle',
  hintKey = 'assistantCuration.rejectHint',
  requireNote = false,
  onCancel,
  onConfirm,
}: RejectDialogProps) {
  const { t } = useLanguage();
  const [note, setNote] = useState('');

  // Цонх дахин нээгдэх бүрд өмнөх шалтгааныг арчина — өөр мөрөнд буруу
  // тайлбар наалдах нь бүртгэлийг ХУДЛАА болгоно.
  //
  // ⚠️ useEffect БИШ, RENDER ҮЕИЙН ЗАСВАР (react.dev «You Might Not Need an
  //    Effect» → «Adjusting some state when a prop changes»).  Effect дотор
  //    setState дуудвал цонх нээгдэхэд ХУУЧИН тайлбартай нэг удаа зурагдаад
  //    дараа нь цэвэрлэгдэнэ — хэрэглэгч өмнөх мөрийн шалтгааныг агшин
  //    зуур ХАРНА.  Энэ хэлбэрт React дахин зурахаас ӨМНӨ шинэчилдэг тул
  //    хуучин утга дэлгэцэнд ХЭЗЭЭ Ч гарахгүй.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setNote('');
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(titleKey)}</DialogTitle>
          <DialogDescription>{t(hintKey, { count })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="assistant-reject-note">
            {t('assistantCuration.rejectNoteLabel')}
            {requireNote ? <span aria-hidden> *</span> : null}
          </Label>
          <Textarea
            id="assistant-reject-note"
            autoFocus
            rows={4}
            maxLength={MAX_NOTE}
            required={requireNote}
            aria-describedby={requireNote ? 'assistant-reject-note-req' : undefined}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('assistantCuration.rejectNotePlaceholder')}
          />
          {requireNote ? (
            <p id="assistant-reject-note-req" className="text-micro text-muted-foreground">
              {t('assistantCuration.rejectNoteRequired')}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={() => onConfirm(note)}
            disabled={busy || (requireNote && note.trim().length === 0)}
          >
            {t('assistantCuration.reject')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface CorrectDialogProps {
  open: boolean;
  /** Анхдагч санаа — хэрэглэгчийн ЗАЛРУУЛГА байвал тэр, эс бөгөөс таамаг. */
  defaultIntent: AssistantIntent;
  defaultSlot?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (intent: AssistantIntent, slot: string) => void;
}

/**
 * ЗАСААД ДЭВШҮҮЛЭХ — санааг гараар сонгож сургалтын багцад оруулна.
 *
 * `isolate_sheet` нь ГАНЦ slot-той санаа (хуудасны дугаар); бусад санаанд
 * талбар нь харагдахгүй тул санамсаргүй утга орохгүй.
 */
export function CorrectDialog({
  open,
  defaultIntent,
  defaultSlot,
  busy,
  onCancel,
  onConfirm,
}: CorrectDialogProps) {
  const { t } = useLanguage();
  const [intent, setIntent] = useState<AssistantIntent>(defaultIntent);
  const [slot, setSlot] = useState(defaultSlot ?? '');

  // ⚠️ Дээрхтэй ИЖИЛ шалтгаан (render үеийн засвар, effect БИШ).
  //    Хуучин effect нь `[open, defaultIntent, defaultSlot]`-оос хамаардаг
  //    байсан тул цонх НЭЭЛТТЭЙ байхад анхдагч утга солигдвол ч дахин
  //    тавьдаг байв.  Тэр ЯГ ТЭР зан төлөвийг хадгалахын тулд түлхүүр нь
  //    гурвуулангаас бүрдэнэ — өөрөөр хэлбэл зөвхөн `open`-ыг мөшгих нь
  //    зан төлөвийг ЧИМЭЭГҮЙ өөрчилнө.
  const resetKey = open ? JSON.stringify([defaultIntent, defaultSlot ?? '']) : null;
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (resetKey !== prevResetKey) {
    setPrevResetKey(resetKey);
    if (resetKey !== null) {
      setIntent(defaultIntent);
      setSlot(defaultSlot ?? '');
    }
  }

  const needsSlot = SLOT_INTENTS.includes(intent);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('assistantCuration.correctTitle')}</DialogTitle>
          <DialogDescription>{t('assistantCuration.correctHint')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('assistantCuration.intentLabel')}</Label>
            <Select value={intent} onValueChange={(v) => setIntent(v as AssistantIntent)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASSISTANT_INTENTS.map((i) => (
                  <SelectItem key={i} value={i}>
                    {intentLabel(t, i)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {needsSlot ? (
            <div className="space-y-2">
              <Label htmlFor="assistant-correct-slot">{t('assistantCuration.slotLabel')}</Label>
              <Input
                id="assistant-correct-slot"
                value={slot}
                maxLength={64}
                onChange={(e) => setSlot(e.target.value)}
                placeholder={t('assistantCuration.slotPlaceholder')}
              />
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => onConfirm(intent, needsSlot ? slot.trim() : '')} disabled={busy}>
            {t('assistantCuration.promote')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
