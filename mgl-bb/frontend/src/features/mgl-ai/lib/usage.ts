/**
 * MGL AI · «ЭНЭ ХӨТӨЧ AI-Г ХЭРЭГЛЭДЭГ ҮҮ» гэсэн ганц тэмдэг.
 *
 * ⚠️ ЯАГААД ЭНЭ ФАЙЛ ТУСДАА ВЭ.  `Layout` нь апп нээгдэх бүрд загварыг
 *    урьдчилан халаах эсэхийг шийддэг (`useMglAiPrewarm`), гэхдээ тэр
 *    шийдвэрт `runtime.ts`-ийн бүх клиент код хэрэггүй — зөвхөн ЭНЭ
 *    тэмдэг.  Тэмдгийг эндээс уншиж, зөвхөн ХЭРЭГТЭЙ үедээ `runtime.ts`-ийг
 *    динамикаар ачаална; ингэснээр AI-г огт хэрэглэдэггүй ажилтны
 *    эхний ачааллын chunk нэг байт ч томрохгүй.
 *
 * ⚠️ ЯАГААД «СҮҮЛД ХЭРЭГЛЭСЭН ОГНОО», «ҮРГЭЛЖ» БИШ.  Загвар VRAM-д
 *    орох нь Revit-тэй хуваалцдаг 8 GB картан дээр БОДИТ өртөг
 *    (2026-09-09-ний хэмжилт: 687 MB чөлөөт үлдэхэд компьютер хөшдөг).
 *    AI-г нээдэггүй хүнд тэр өртгийг төлүүлэхгүй; нээдэг хүнд ERP-д
 *    орохоор нь шууд бэлэн болгоно.  14 хоног нь амралт/чөлөөний
 *    завсарыг давдаг ч хаясан хүнийг удаан «дагахгүй».
 */

const KEY = 'mglai.last_used';

/** Ийм хоногийн дотор нээсэн бол «хэрэглэдэг» гэж үзнэ. */
export const PREWARM_IF_USED_WITHIN_DAYS = 14;

export function markMglAiUsed(): void {
  try {
    localStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* хувийн цонх / хориглосон localStorage — тэмдэггүй ч чат ажиллана */
  }
}

export function mglAiUsedWithin(days: number): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < days * 86_400_000;
  } catch {
    return false;
  }
}
