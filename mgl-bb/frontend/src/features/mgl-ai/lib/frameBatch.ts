/**
 * MGL AI · ТОКЕНЫ БАГЦЛАЛТ (§23).
 *
 * ⚠️ АСУУДАЛ.  Локал загвар секундэд 60-105 токен гаргадаг.  Токен бүрд
 *    `setActiveRun(...)` дуудах нь React-ийг секундэд 100 удаа дахин
 *    рендерлүүлнэ.  Токен бүр нь мессежийн жагсаалт, гүйцэтгэлийн
 *    самбар, markdown-ы модыг ХАМТ хөдөлгөнө — тэр нь §23-ийн «React
 *    render storm» бөгөөд гүйлгэлт, бичилт таталдана.
 *
 * ⚠️ ШИЙДЭЛ НЬ «ТОКЕН АЛГАСАХ» БИШ.  Төлөв нь ҮРГЭЛЖ ЯГ ЗӨВ байна:
 *    `reduce` нь токен бүрд СИНХРОНООР ажиллана (цэвэр функц, хямд).
 *    Зөвхөн ХАРАГДАЦЫГ НЬ шинэчлэх давтамжийг кадрын хурдад барина.
 *    Ингэснээр нэг ч токен алдагдахгүй, гэвч рендер нь ≤60/сек.
 *
 * ⚠️ ТОКЕН БИШ ҮЙЛ ЯВДЛЫГ ХОЙШЛУУЛАХГҮЙ.  «Эх сурвалж оллоо», «үүсгэлт
 *    эхэллээ», «алдаа» зэрэг нь ХОВОР бөгөөд УТГА УЧИРТАЙ — тэднийг 16
 *    мс хойшлуулах нь ямар ч ашиггүй, харин гүйцэтгэлийн самбарыг
 *    үнэн бус болгоно (§26: «Only real operations», бодит цаг хугацаанд).
 *
 * ⚠️ ЭНЭ ФАЙЛ ЦЭВЭР — `requestAnimationFrame`-ыг ТАРИЛГААР авна тул
 *    хөтөчгүйгээр тестлэгдэнэ (`check-ai-stream.mjs`).
 */

export interface FrameScheduler {
  /** Дараагийн кадрт нэг удаа flush хийхээр товлоно (давхардахгүй). */
  schedule(): void;
  /** ⚠️ ЯГ ОДОО flush.  Товлогдсон кадр байвал цуцлана. */
  flushNow(): void;
  /** Цэвэрлэгээ — цуцлагдсан ээлж, unmount. */
  cancel(): void;
}

export interface FrameSchedulerOptions {
  /** Хойшлуулсан ажил.  ⚠️ Идемпотент байх ёстой. */
  flush: () => void;
  /**
   * ⚠️ ТАРИЛГА — тест дээр гараар жолоодохын тулд.  Өгөгдмөл нь
   *    `requestAnimationFrame`, харин таб далд байхад хөтөч түүнийг
   *    ЗОГСООДОГ тул `setTimeout`-ийн нөөц зам ЗААВАЛ хэрэгтэй: далд
   *    таб дээр урсгал үргэлжилсээр байх ба хэрэглэгч буцаж ирэхэд
   *    хариулт бүрэн байх ёстой.
   */
  raf?: (cb: () => void) => number;
  caf?: (handle: number) => void;
  /**
   * rAF ажиллахгүй байх үеийн нөөц завсар, мс.
   * ⚠️ Далд табын хувьд хөтөч rAF-ыг зогсоодог — 250 мс тутам flush
   *    хийх нь тэр тохиолдолд хариултыг УРАГШЛУУЛНА, гэхдээ ачааллыг
   *    үл мэдэгдэхүйц болгоно.
   */
  fallbackMs?: number;
}

export function createFrameScheduler(opts: FrameSchedulerOptions): FrameScheduler {
  const raf =
    opts.raf ??
    (typeof requestAnimationFrame === 'function'
      ? (cb: () => void) => requestAnimationFrame(() => cb())
      : (cb: () => void) => setTimeout(cb, 16) as unknown as number);
  const caf =
    opts.caf ??
    (typeof cancelAnimationFrame === 'function'
      ? (h: number) => cancelAnimationFrame(h)
      : (h: number) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>));

  let handle: number | null = null;
  let backup: ReturnType<typeof setTimeout> | null = null;
  let pending = false;

  const run = () => {
    handle = null;
    if (backup !== null) {
      clearTimeout(backup);
      backup = null;
    }
    if (!pending) return;
    pending = false;
    opts.flush();
  };

  return {
    schedule() {
      pending = true;
      if (handle !== null) return;
      handle = raf(run);
      // ⚠️ НӨӨЦ ТАЙМЕР — далд таб дээр rAF ХЭЗЭЭ Ч ажиллахгүй.  Түүнгүйгээр
      //    хэрэглэгч табаа сольж буцахад хариулт ХӨЛДСӨН харагдана.
      if (backup === null) {
        backup = setTimeout(run, opts.fallbackMs ?? 250);
      }
    },
    flushNow() {
      if (handle !== null) {
        caf(handle);
        handle = null;
      }
      if (backup !== null) {
        clearTimeout(backup);
        backup = null;
      }
      if (!pending) return;
      pending = false;
      opts.flush();
    },
    cancel() {
      if (handle !== null) caf(handle);
      if (backup !== null) clearTimeout(backup);
      handle = null;
      backup = null;
      pending = false;
    },
  };
}

/**
 * Үйл явдал НЭН ДАРУЙ харагдах ёстой юу.
 *
 * ⚠️ ЭНЭ ЖАГСААЛТ НЬ БҮТЭЭГДЭХҮҮНИЙ ШИЙДВЭР, оновчлол БИШ.  Токен нь
 *    урсгал — нэг кадр хойшлох нь харагдахгүй.  Бусад бүх зүйл нь
 *    ТӨЛӨВИЙН ӨӨРЧЛӨЛТ: алхам дууссан, эх сурвалж олдсон, алдаа гарсан.
 *    Тэднийг хойшлуулах нь гүйцэтгэлийн самбарыг бодит цагаас хоцроож,
 *    §26-ийн «зөвхөн бодит үйлдэл, бодит цагт» гэрээг зөрчинө.
 */
export function isImmediateEvent(type: string): boolean {
  return type !== 'token' && type !== 'heartbeat';
}
