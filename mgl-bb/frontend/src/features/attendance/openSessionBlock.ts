/**
 * «Гарах бүртгэлээ хийгээгүй тул ирэх бүртгэл хийх боломжгүй» хаалтын
 * КЛИЕНТ талын нэгдсэн цэг.
 *
 * Сервер тал: `backend/src/routes/attendance.ts`
 *   • `POST /clock-in` → 409 `{ error, code: 'OPEN_PRIOR_SESSION', open_session }`
 *   • `GET /my-status` → `blocked_open_session: { id, date, clock_in } | null`
 *
 * Ирэх бүртгэл хийж болох ГУРВАН гадаргуу (Ирц хуудас, цэвэрлэгчийн хуудас,
 * Хяналтын самбарын widget) бүгд эндээс уншина — эс бөгөөс нэг нь хаалтыг
 * танихаа больж, хэрэглэгч ойлгомжгүй улаан мөр хараад үлдэнэ.
 */
import { ApiError } from '@/shared/api/client';

/** Хаалт үүсгэж буй, хаагдаагүй үлдсэн бүртгэлийн товч мэдээлэл. */
export type BlockedOpenSession = {
  id: number;
  /** `YYYY-MM-DD` (УБ) — хаагдаагүй үлдсэн ӨДӨР. */
  date: string;
  clock_in: string;
};

/**
 * Сервер энэ хүсэлтийг «өмнөх өдрийн хаагдаагүй бүртгэл» гэж татгалзсан уу?
 *
 * `code`-оор л шалгана — `err.message`-ийг мөрчлөн харьцуулах нь эмзэг
 * бөгөөд `ApiError` нь `payload.code`-ыг аль хэдийн `err.code` болгож
 * өргөдөг (`shared/api/client.ts`).
 */
export function isOpenSessionBlock(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'OPEN_PRIOR_SESSION';
}

/** Татгалзсан хариунаас хаагдаагүй бүртгэлийн мэдээллийг сугална (байвал). */
export function openSessionFromError(err: unknown): BlockedOpenSession | null {
  if (!(err instanceof ApiError)) return null;
  const raw = err.payload.open_session;
  if (!raw || typeof raw !== 'object') return null;
  const { id, date, clock_in: clockIn } = raw as Record<string, unknown>;
  if (typeof id !== 'number' || typeof date !== 'string' || typeof clockIn !== 'string') {
    return null;
  }
  return { id, date, clock_in: clockIn };
}
