/* =============================================================
 * Паспортын «Client / Захиалагч» нүд → `project_clients`
 * -------------------------------------------------------------
 * Эзний хүсэлт 2026-09-28: захиалагчийг «Захиалагч» табаар биш,
 * паспортын баримт / маягт дээр НЭРИЙГ НЬ шууд бичиж нэмж, хасдаг
 * болгох («захиалагчийг яаж хийхээ дараа нь шийднэ»).
 *
 * Эх сурвалж ХЭВЭЭР `project_clients` — ЗХ, гүйцэтгэлийн тайлан,
 * захиалагчийн PDF, MCP бүгд тэндээс уншдаг тул паспортад хоёр дахь
 * багана нээхгүй.  Баримт дээрх нүд нь ГАНЦ мөр текст тул дүрэм:
 *
 *   • хоосон         → бүх мөрийг устгана (захиалагч хасагдсан);
 *   • мөр байхгүй    → нэг мөр нэмнэ (`company`, 100%);
 *   • мөр байгаа     → ЭХНИЙ мөрийн нэрийг солино (төрөл, хувь хэвээр),
 *                      бусдыг нь устгана — нүд нь бүх жагсаалтыг
 *                      «A, B» гэж харуулдаг тул засвар нь жагсаалтыг
 *                      бүхэлд нь орлоно;
 *   • харагдацтайгаа ижил → юу ч хийхгүй.
 *
 * Хэмжсэн 2026-09-28 (прод): 8 төсөл захиалагчтай, бүгд ЯГ 1 мөртэй —
 * «бусдыг устгах» салаа өнөөдөр хэнд ч хүрэхгүй.
 * Цэвэр функц — `passportClient.test.ts`.
 * ============================================================= */

export const CLIENT_NAME_MAX = 300;

export interface ClientRowLite {
  id: number;
  name: string;
}

export type ClientNameSync =
  | { kind: 'none' }
  | { kind: 'delete_all' }
  | { kind: 'insert'; name: string }
  | { kind: 'rename'; id: number; name: string; dropIds: number[] };

/** Хүсэлтийн `client_name`-ийг шалгана.  `undefined` = талбар ирээгүй
 *  (хөндөхгүй); `null`/хоосон = хасах.  Буруу төрөл / хэт урт → алдаа. */
export function parseClientName(
  raw: unknown,
): { ok: true; value: string | undefined } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null) return { ok: true, value: '' };
  if (typeof raw !== 'string') return { ok: false, error: 'client_name must be a string' };
  const value = raw.trim();
  if (value.length > CLIENT_NAME_MAX) {
    return { ok: false, error: `client_name must be at most ${CLIENT_NAME_MAX} characters` };
  }
  return { ok: true, value };
}

/** Одоогийн мөрүүд (sort_order, id дарааллаар) + шинэ нэр → хийх үйлдэл. */
export function planClientNameSync(
  rows: readonly ClientRowLite[],
  name: string,
): ClientNameSync {
  const next = name.trim();
  if (!next) return rows.length ? { kind: 'delete_all' } : { kind: 'none' };
  if (rows.length === 0) return { kind: 'insert', name: next };
  const shown = rows.map((r) => r.name.trim()).join(', ');
  if (shown === next) return { kind: 'none' };
  const [first, ...rest] = rows;
  return { kind: 'rename', id: first!.id, name: next, dropIds: rest.map((r) => r.id) };
}
