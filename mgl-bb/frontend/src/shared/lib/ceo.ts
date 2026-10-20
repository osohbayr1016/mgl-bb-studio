/**
 * CEO hardcode — «admin-аас дээгүүр» гүйцэтгэх захирал (user_id 2, «Бат-Өлзий
 * Билгүүн»).  Шинэ DB role нэмэхгүй (D1 CHECK constraint-ийн улмаас); тодорхой
 * id дээр hardcode.  Backend талд ижил тогтмол `backend/src/lib/ceo.ts`-д бий —
 * хоёр талыг ижил байлга.
 */
export const CEO_USER_ID = 2;

/** Нэвтэрсэн хэрэглэгч CEO мөн эсэх. */
export function isCeo(user: { id?: number | null } | null | undefined): boolean {
  return !!user && user.id === CEO_USER_ID;
}
