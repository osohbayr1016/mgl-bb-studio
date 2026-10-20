/**
 * Эрсдэлийн төлөвийн ХАРАГДАХ тал — эрэмбэ, өнгө, шошгын түлхүүр.
 *
 * Логик нь `backend/src/lib/projectRisk.ts`-д бодогдож ирнэ; энэ файл нь
 * зөвхөн түүнийг хүнд ойлгомжтой болгоно. `RISK_ORDER` нь backend-ийнхтэй
 * ЯГ ижил дараалалтай байх ёстой — жагсаалтын эрэмбэ хоёр талд ижил гарна.
 *
 * ӨНГӨНИЙ ДҮРЭМ (`shared/lib/status-colors.ts`-ийн гэрийн стиль):
 *   зөөлөн  → `bg-<token>/10 text-<token> border-<token>/30`
 *   дүүрэн  → `bg-<token> text-<token>-foreground`
 * ЗӨВХӨН семантик token (success / warning / danger / info / muted /
 * primary). Түүхий Tailwind палитр (`bg-amber-500`) ХОРИОТОЙ —
 * `npm run lint:tokens` үүнийг регрессийн хаалт болгож шалгана.
 *
 * ⚠ Өнгө нь ХЭЗЭЭ Ч ганцаараа мэдээлэл дамжуулахгүй: дуудагч тал бүр
 * `riskLabelKey`-ийн текст шошгыг өнгөний хамт заавал үзүүлнэ
 * (өнгө ялгаж чаддаггүй хэрэглэгч + хэвлэсэн PDF хоёулаа уншигдана).
 */

import type { TranslationKey, TParams } from '@/shared/i18n';
import type { RiskState } from '../types';

/** Хамгийн яаралтайгаас нь эхэлсэн дараалал (backend RISK_ORDER-тэй ижил). */
export const RISK_ORDER: readonly RiskState[] = [
  'overdue',
  'due_1',
  'due_3',
  'due_7',
  'stale',
  'unscheduled',
  'not_started',
  'on_track',
  'done',
];

/** Эрэмбийн индекс — жижиг нь илүү яаралтай. Танигдахгүй төлөв хамгийн ард. */
export function riskRank(state: RiskState): number {
  const i = RISK_ORDER.indexOf(state);
  return i === -1 ? RISK_ORDER.length : i;
}
// EXPECT: riskRank('overdue') === 0 < riskRank('due_3') < riskRank('done')

/** «Анхаарал шаардсан» самбарт орох төлөвүүд (эрэмбийн дарааллаар). */
export const ATTENTION_STATES: readonly RiskState[] = [
  'overdue',
  'due_1',
  'due_3',
  'due_7',
  'stale',
  'unscheduled',
];

export interface RiskTone {
  /** Badge / chip — хүрээ + дэвсгэр + текст. */
  chip: string;
  /** Гантт баарны дүүргэлт — баарны өнгөний ЦОРЫН ГАНЦ эх сурвалж. */
  bar: string;
  /** Жагсаалтын жижиг индикатор цэг. */
  dot: string;
}

export const RISK_TONE: Record<RiskState, RiskTone> = {
  // Хугацаа хэтэрсэн — хамгийн хүчтэй дохио.
  overdue: {
    chip: 'bg-danger/15 text-danger border-danger/40',
    bar: 'bg-danger',
    dot: 'bg-danger',
  },
  // Өнөөдөр/маргааш — дүүрэн warning (хамгийн их анхаарал татна).
  due_1: {
    chip: 'bg-warning text-warning-foreground border-warning',
    bar: 'bg-warning',
    dot: 'bg-warning',
  },
  due_3: {
    chip: 'bg-warning/15 text-warning border-warning/40',
    bar: 'bg-warning/80',
    dot: 'bg-warning',
  },
  // 7 хоног — зөөлөн (бага тунгалаг), «санаж яв» түвшин.
  due_7: {
    chip: 'bg-warning/10 text-warning border-warning/25',
    bar: 'bg-warning/60',
    dot: 'bg-warning/60',
  },
  // Хөдөлгөөнгүй — зөвхөн ХҮРЭЭ (дэвсгэр тунгалаг), тасархай зураас.
  // Хугацааны асуудал биш, ЗҮТГЭЛИЙН асуудал гэдгийг хэлбэрээр ялгав.
  stale: {
    chip: 'bg-transparent text-warning border-warning/50 border-dashed',
    bar: 'bg-transparent border border-dashed border-warning/60',
    dot: 'bg-transparent border border-warning',
  },
  not_started: {
    chip: 'bg-info/10 text-info border-info/30',
    bar: 'bg-info/40',
    dot: 'bg-info',
  },
  unscheduled: {
    chip: 'bg-muted text-muted-foreground border-border',
    bar: 'bg-muted',
    dot: 'bg-muted-foreground/50',
  },
  // Хэвийн — тайван, «юу ч хийх шаардлагагүй» түвшин.  (2026-08 хүртэл
  // баар нь БАГИЙН таних өнгийг авдаг байсан тул энэ tone нь зөвхөн
  // баггүй үеийн нөөц байв; одоо баг гэсэн ойлголт энэ хуудсанд байхгүй
  // болсон тул баарны өнгийг ҮРГЭЛЖ эндээс авна.)
  on_track: {
    chip: 'bg-primary/10 text-primary border-primary/30',
    bar: 'bg-primary/70',
    dot: 'bg-primary',
  },
  done: {
    chip: 'bg-success/10 text-success border-success/30',
    bar: 'bg-success',
    dot: 'bg-success',
  },
};

/**
 * ТОМ текстэд зориулсан ЦУЛ өнгө (тоо, гарчиг).
 *
 * ⚠️ `RISK_TONE[…].chip`-ээс `text-*`-ыг сугалж авч БОЛОХГҮЙ.  Хоёр урхи:
 *   · `due_1`-ийн chip нь `text-warning-foreground` — харанхуйд бараг хар
 *     (`38 100% 8%`).  36px тоо `bg-card` дээр бүрмөсөн алга болно.
 *   · `on_track` нь `text-primary` — харанхуйд ердөө 2.82:1 (index.css:327).
 *     Тиймээс энд `text-primary-ink` (5.17:1) хэрэглэнэ.
 * `check-contrast` нь энэ хоёрыг барихгүй — тэр токеныг ангилдаг болохоос
 * ямар tone хаана хэрэглэснийг мэдэхгүй.
 */
export const RISK_INK: Record<RiskState, string> = {
  overdue: 'text-danger',
  due_1: 'text-warning',
  due_3: 'text-warning',
  due_7: 'text-warning',
  stale: 'text-warning',
  not_started: 'text-info',
  unscheduled: 'text-muted-foreground',
  on_track: 'text-primary-ink',
  done: 'text-success',
};

const LABEL_KEY: Record<RiskState, TranslationKey> = {
  done: 'timelinePage.stateDone',
  overdue: 'timelinePage.stateOverdue',
  due_1: 'timelinePage.stateDue1',
  due_3: 'timelinePage.stateDue3',
  due_7: 'timelinePage.stateDue7',
  stale: 'timelinePage.stateStale',
  not_started: 'timelinePage.stateNotStarted',
  unscheduled: 'timelinePage.stateUnscheduled',
  on_track: 'timelinePage.stateOnTrack',
};

/** Төлөвийн орчуулгын түлхүүр. */
export function riskLabelKey(state: RiskState): TranslationKey {
  return LABEL_KEY[state] ?? 'timelinePage.stateOnTrack';
}

type TFn = (key: TranslationKey, params?: TParams) => string;

/**
 * Шошгын ДООРХ хоёрдогч мөр — «3 хоног үлдсэн», «12 хоног хэтэрсэн» гэх мэт.
 * Тоо гаргах боломжгүй үед хоосон мөр буцаана (дуудагч тал `&&`-ээр нуух).
 */
export function riskDetail(
  t: TFn,
  state: RiskState,
  daysLeft: number | null,
  staleDays: number | null,
  daysToStart: number | null = null,
): string {
  switch (state) {
    case 'overdue':
      return daysLeft === null ? '' : t('timelinePage.overdueDays', { n: Math.abs(daysLeft) });

    case 'due_1':
      if (daysLeft === null) return '';
      if (daysLeft <= 0) return t('timelinePage.dueToday');
      if (daysLeft === 1) return t('timelinePage.dueTomorrow');
      return t('timelinePage.daysLeft', { n: daysLeft });

    // Хараахан эхлээгүй төсөл дээр «дуусах хүртэл N хоног» биш «N хоногийн
    // дараа эхэлнэ» гэдэг нь мэдээлэл илүү өгнө — уншигч эхлэх огноог
    // хүлээж байгаа болохоос дуусахыг биш.  Эхлэх огноогүй бол дуусах
    // хүртэлх хоног руу шилжинэ.
    case 'not_started':
      if (daysToStart !== null && daysToStart > 0) {
        return t('timelinePage.startsIn', { n: daysToStart });
      }
      return daysLeft === null ? '' : t('timelinePage.daysLeft', { n: daysLeft });

    case 'due_3':
    case 'due_7':
    case 'on_track':
      return daysLeft === null ? '' : t('timelinePage.daysLeft', { n: daysLeft });

    case 'stale':
      return staleDays === null ? '' : t('timelinePage.staleDays', { n: staleDays });

    // Хуваарьгүй → хэлэх тоо байхгүй; Дууссан → үлдсэн хоног утгагүй.
    case 'unscheduled':
    case 'done':
      return '';
  }
}
// EXPECT: riskDetail(t, 'overdue', -12, null) → «12 хоног хэтэрсэн» (тэмдэггүй тоо)
// EXPECT: riskDetail(t, 'due_1', 0, null)     → «Өнөөдөр дуусах»
// EXPECT: riskDetail(t, 'stale', 3, 21)       → «21 хоног хөдөлгөөнгүй»
// EXPECT: riskDetail(t, 'unscheduled', null, null) === ''
// EXPECT: riskDetail(t, 'not_started', 40, null, 12) → «12 хоногийн дараа эхэлнэ»
// EXPECT: riskDetail(t, 'not_started', 40, null, null) → «40 хоног үлдсэн» (эхлэх огноогүй)
