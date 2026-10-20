// Browser (web) notification туслахууд.
//
// Service worker бүртгэгдсэн үед `registration.showNotification()`-оор
// харуулна — ингэснээр мэдэгдэл нь SW-ийн `notificationclick` handler-т
// холбогдож, дарахад апп зөв хуудас руу шилжинэ.  SW байхгүй орчинд
// (dev, хэвлэлтийн зам) хуучин `new Notification()` руу шилжинэ.
//
// ⚠️ `new Notification()` нь Android Chrome дээр SW-гүйгээр TypeError шиддэг,
// iOS дээр огт ажиллахгүй.  Яг тийм учраас ажил эхлэхийн өмнөх сануулга
// (useWorkStartReminder) утсан дээр чимээгүй бүтэлгүйтдэг байсан.

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.permission;
}

/**
 * Зөвшөөрөл асууна (default үед).  granted бол true.
 *
 * ⚠️ ЗААВАЛ хэрэглэгчийн товшилтын дотроос дуудна.  Mount дээр автоматаар
 * дуудвал Chrome-ын abusive-permission эвристик түүнийг блоклодог, iOS Safari
 * бол хэрэглэгчийн идэвхжүүлэлтгүй бол шууд татгалздаг.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    const res = await Notification.requestPermission();
    return res === 'granted';
  } catch {
    return false;
  }
}

interface ShowOpts {
  body?: string;
  /** Ижил tag-тай мэдэгдэл нэг нэгнээ дарж шинэчилнэ (давхардал багасгана). */
  tag?: string;
  /** Дарахад шилжих SPA зам. SW-ийн `notificationclick` үүнийг уншина. */
  link?: string;
}

/**
 * Мэдэгдэл харуулна.  Зөвшөөрөл байхгүй / дэмжихгүй бол чимээгүй no-op.
 */
export async function showWebNotification(title: string, opts: ShowOpts = {}): Promise<void> {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg) {
      await reg.showNotification(title, {
        body: opts.body,
        tag: opts.tag,
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-72.png',
        data: { link: opts.link ?? '/app' },
      });
      return;
    }
    // SW бүртгэгдээгүй орчин (dev) — desktop дээр энэ хэвээр ажиллана.
    new Notification(title, { body: opts.body, tag: opts.tag });
  } catch {
    /* чимээгүй алгасна */
  }
}
