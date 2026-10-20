import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * MGL AI — асуултын ДАРААЛАЛ.
 *
 * Локал загвар нэг удаад НЭГ хариулт үүсгэдэг.  Урьд нь хариулт гарч байхад
 * оролт хаалттай байсан тул хэрэглэгч дараагийн асуултаа бичиж чаддаггүй байв.
 * Одоо ажил гүйж байхад илгээсэн асуулт дараалалд орж, өмнөх хариулт ДУУССАНЫ
 * дараа ээлжээр (нэг нэгээр) автоматаар эхэлнэ.
 *
 * Дараалал нь ЗӨВХӨН энэ табын санах ойд — серверт хадгалагдахгүй (хуудас
 * шинэчлэх/яриа солиход цэвэрлэгдэнэ).
 */
export const MAX_QUEUED_QUESTIONS = 10;
const MAX_QUESTION_CHARS = 8000;

export interface QueuedQuestion {
  id: string;
  text: string;
}

export type EnqueueResult =
  | { ok: true; queue: QueuedQuestion[] }
  | { ok: false; reason: 'empty' | 'full'; queue: QueuedQuestion[] };

/** Цэвэр: дараалалд нэмнэ (хоосон / дүүрсэн бол татгалзана). */
export function enqueueQuestion(queue: readonly QueuedQuestion[], raw: string, id: string): EnqueueResult {
  const text = raw.trim().slice(0, MAX_QUESTION_CHARS);
  if (text.length === 0) return { ok: false, reason: 'empty', queue: [...queue] };
  if (queue.length >= MAX_QUEUED_QUESTIONS) return { ok: false, reason: 'full', queue: [...queue] };
  return { ok: true, queue: [...queue, { id, text }] };
}

/** Цэвэр: нэгийг хасна (id-аар). */
export function removeQueued(queue: readonly QueuedQuestion[], id: string): QueuedQuestion[] {
  return queue.filter((q) => q.id !== id);
}

let seq = 0;
const newQueueId = () => `q${Date.now().toString(36)}-${(seq++).toString(36)}`;

/**
 * `busy` false болж, дараалал хоосон биш үед НЭГ асуултыг гаргаж `start`-ыг дуудна.
 *
 * ⚠️ `start` нь ЗААВАЛ синхроноор `busy`-г true болгох ёстой (`send` нь `setActiveRun`-ыг
 *    ямар ч await-аас өмнө дууддаг) — эс бөгөөс энэ effect дараагийн render дээр дараагийн
 *    асуултыг ДАХИН гаргаж, дарааллыг хоослоно.  `start`-ийн ref-ийг drain effect-ээс ӨМНӨ
 *    шинэчилнэ (effect-ийн зарлалтын дараалал) тул үргэлж хамгийн сүүлийн `send` дуудагдана.
 * ⚠️ Үнэн эх сурвалж = `ref` (синхрон шийдвэр: дүүрсэн/хоосон үр дүнг шууд буцаахын тулд);
 *    `queue` state нь зөвхөн дүрслэл + drain effect-ийг сэрээнэ.
 */
export function useQuestionQueue(busy: boolean, start: (text: string) => void) {
  const ref = useRef<QueuedQuestion[]>([]);
  const [queue, setQueueState] = useState<QueuedQuestion[]>([]);
  const startRef = useRef(start);
  useEffect(() => {
    startRef.current = start;
  });

  const commit = useCallback((next: QueuedQuestion[]) => {
    ref.current = next;
    setQueueState(next);
  }, []);

  useEffect(() => {
    if (busy) return;
    const [next, ...rest] = ref.current;
    if (!next) return;
    commit(rest);
    startRef.current(next.text);
  }, [busy, queue, commit]);

  const add = useCallback(
    (raw: string): EnqueueResult => {
      const r = enqueueQuestion(ref.current, raw, newQueueId());
      if (r.ok) commit(r.queue);
      return r;
    },
    [commit],
  );
  const remove = useCallback((id: string) => commit(removeQueued(ref.current, id)), [commit]);
  const clear = useCallback(() => commit([]), [commit]);

  return { queue, add, remove, clear };
}
