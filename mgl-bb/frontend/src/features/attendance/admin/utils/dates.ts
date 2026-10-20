// ---------------------------------------------------------------------------
// Огнооны туслахууд — товчлол (preset) товчнууд болон анхны утгуудад.
// ---------------------------------------------------------------------------

/** `HH:mm` (24 цаг) хэлбэрийн шалгуур — цаг оруулах бүх талбарт нийтлэг. */
export const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function todayStr(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

export function getWeekStart(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
}

export function getMonthStart(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

export function getLastMonthRange(): [string, string] {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0);
  return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
}

export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Улаанбаатарын одоогийн цагийг `HH:mm`-ээр (гарах цаг нөхөх default). */
export function nowHmInUB(): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ulaanbaatar',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());
}

/** Улаанбаатарын өнөөдөр `yyyy-mm-dd`.
 *
 *  ⚠️ `todayStr()` нь `toISOString()` (UTC) дээр тулгуурладаг тул UB-ийн
 *  00:00–08:00 хооронд ӨЧИГДРИЙГ буцаана.  Огнооны ЗӨРҮҮ тоолдог газарт
 *  (жнь «хэдэн хоног хаагдаагүй») тэр нь нэг хоногийн алдаа өгдөг учир
 *  энд бүсийг нь тодорхой зааж өгсөн хувилбарыг хэрэглэнэ. */
export function todayInUB(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ulaanbaatar',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
