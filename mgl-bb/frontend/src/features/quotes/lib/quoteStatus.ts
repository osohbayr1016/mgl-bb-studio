/**
 * Юүлүүрийн шатны i18n түлхүүр.
 *
 * ⚠️ Компонентын файлаас ТУСДАА байгаагийн шалтгаан нь зөвхөн
 * `react-refresh/only-export-components` дүрэм (`components/QuoteStatusBadge.tsx`
 * зөвхөн компонент экспортолно).
 *
 * Шатны БАГЦ гурван газар зэрэг өөрчлөгдөнө: `../types/quotes`-ийн
 * `QUOTE_STATUSES`, серверийн `routes/quotes.ts`-ийн ижил нэртэй тогтмол
 * (тэр нь ЖИНХЭНЭ валидац — DB-д CHECK байхгүй), ба
 * `shared/lib/status-colors`-ийн `QUOTE_STATUS_TONE`.
 */
import type { TranslationKey } from '@/shared/i18n';

import type { QuoteSource, QuoteStatus } from '../types/quotes';

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, TranslationKey> = {
  draft: 'quotes.status.draft',
  sent: 'quotes.status.sent',
  active: 'quotes.status.active',
  lost: 'quotes.status.lost',
};

/**
 * PDF / хэвлэх боломжтой юу?
 *
 * ⚠️ ФУНКЦИОНАЛЬ ШААРДЛАГА, гоо сайхны асуудал БИШ. «Хурдан нэмэх» болон
 * багц импортоор орсон мөрүүд нь ХООСОН ажлын дэвтэртэй (migration 0170) —
 * тэдгээр дээр хэвлэх хуудас хоосон A4 гаргана. Тиймээс UI тэр үйлдлийг
 * НУУНА. Дэвтэргүй шинэ эх сурвалж нэмэх бол ЭНД дагуулж нэмнэ.
 */
export const canPrintQuote = (source: QuoteSource): boolean => source === 'app';
