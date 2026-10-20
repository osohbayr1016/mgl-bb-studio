/**
 * Баруун доод булангийн тэмдэглэлийг (`DailyLogNote`) хаанаас ч нээх дохио —
 * жишээ нь «Менежментийн багийн тайлан»-ын «Миний ажил нэмэх» товч.  Хуудас
 * өөрийн маягт барихын оронд энэ ГАНЦ тэмдэглэл рүү чиглүүлнэ.
 */
export const OPEN_DAILY_NOTE_EVENT = 'mgl:daily-note-open';

export function openDailyNote(): void {
  window.dispatchEvent(new Event(OPEN_DAILY_NOTE_EVENT));
}
