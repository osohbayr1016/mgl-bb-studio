import { useEffect } from 'react';
import { useAuth } from '@/shared/context/AuthContext';
import { mglAiUsedWithin, PREWARM_IF_USED_WITHIN_DAYS } from '@/features/mgl-ai/lib/usage';

/**
 * MGL AI-г ERP НЭЭГДЭХЭД БЭЛЭН БОЛГОНО — MGL AI хуудсыг нээхийг хүлээлгүй.
 *
 * ⚠️ ЯАГААД LAYOUT ДЭЭР.  Өмнө нь загвар ЗӨВХӨН `/app/mgl-ai` нээгдэхэд
 *    халаагддаг байсан (`MglAiPage`-ийн `warmup()`), тиймээс ажилтан
 *    хуудсыг нээгээд эхний асуултаа бичихдээ 10-20 секунд «бэлдэж
 *    байна…» хардаг байв.  ERP-д нэвтэрч орох нь өөрөө хангалттай эрт
 *    дохио: дашбоардаас AI руу очих хугацаанд загвар VRAM-д орж амжина.
 *
 * ⚠️ ЗӨВХӨН AI-Г ХЭРЭГЛЭДЭГ ХӨТӨЧ ДЭЭР (`mglAiUsedWithin`).  Ажилтан бүрд
 *    5-6 GB VRAM барих нь 2026-09-09-нд засаж дууссан «компьютер хөшиж
 *    байна» гомдлыг буцааж авчирна.  Сүүлийн 14 хоногт нээгээгүй бол
 *    ЮУ Ч хийхгүй — localStorage-ийн нэг уншилт, сүлжээний хүсэлт ч алга.
 *    Тэр хүн AI хуудсаа нээхэд хуучин зам (хуудсан дээрх warmup) хэвээр.
 *
 * ⚠️ ХОСОЛТ (`pair`) ч ЭНД явна.  Runtime-ийн хойд дэвсгэрийн шинэчлэлт
 *    (адаптер, норм) нь ERP токен шаарддаг ба тэр токен 24 цаг амьдардаг.
 *    Өмнө нь зөвхөн AI хуудас нээхэд шинэчлэгддэг байсан — өдөр бүр ERP-д
 *    ордог ч AI-г долоо хоногт нэг нээдэг хүний runtime 6 хоног
 *    «хуучирсан токентой» зогсдог байв.
 *
 * ⚠️ БҮГД ЧИМЭЭГҮЙ, БҮГД ДИНАМИК IMPORT.  Runtime суугаагүй, унтарсан,
 *    Origin таарахгүй — аль ч тохиолдолд хэрэглэгчид юу ч харагдахгүй;
 *    `MglAiPage` өөрөө төлөвөө хэлнэ.  `runtime.ts` нь зөвхөн хаалга
 *    давсан ҮЕД ачаалагдана — үндсэн chunk-д орохгүй.
 *
 * ⚠️ ТАБ РУУ БУЦАХАД ДАХИН ХАЛААНА.  Runtime 20 мин сул байвал загварыг
 *    буулгадаг (VRAM чөлөөлөх); ажилтан Revit-ээс ERP таб руугаа буцаж
 *    ирэх нь дахин «ашиглах гэж байна» дохио.  15 минутаас богино
 *    завсарт загвар хараахан буугаагүй тул дэмий хүсэлт илгээхгүй.
 */
const REWARM_AFTER_HIDDEN_MS = 15 * 60_000;

export function useMglAiPrewarm(): void {
  const { user } = useAuth();
  const enabled = !!user && user.role !== 'worker';

  useEffect(() => {
    if (!enabled) return;
    if (!mglAiUsedWithin(PREWARM_IF_USED_WITHIN_DAYS)) return;

    let alive = true;
    let hiddenAt = 0;

    const prewarm = async () => {
      const rt = await import('@/features/mgl-ai/lib/runtime');
      if (!alive) return;
      const p = await rt.probe();
      if (!alive || !p.installed || !p.authorized) return;
      const token = localStorage.getItem('auth_token');
      if (token) void rt.pair(token);
      void rt.warmup();
    };

    void prewarm();

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt && Date.now() - hiddenAt >= REWARM_AFTER_HIDDEN_MS) void prewarm();
      hiddenAt = 0;
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled]);
}
