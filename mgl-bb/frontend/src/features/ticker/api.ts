import { apiFetch } from '@/shared/api/client';

/**
 * Гүйдэг мэдээний АДМИН давхарга (`/api/ticker/admin/*`, migration 0255).
 *
 * Хоёр төрлийн мөр НЭГ эрэмбийн орон зайд амьдарна:
 *   • `builtin` — кодоор угсрагддаг ес (ирц, баяр, эрсдэл …).  DB-д мөр
 *     байхгүй тул зөвхөн ТОХИРГОО нь (`ticker_builtin_prefs`) хадгалагдана:
 *     унтраах, текст/шошго/өнгийг дарж бичих, эрэмбэ.
 *   • `message` — админаас бичсэн чөлөөт мэдээ (`ticker_messages`).
 *
 * ⚠️ Эрэмбийн дүрэм нь СЕРВЕРИЙНХТЭЙ ижил байх ёстой (`withAdminLayer`,
 *    `backend/src/routes/ticker.ts`): `sort_order` өсөхөөр, тэнцвэл гараар
 *    бичсэн мөр урдаа.  `mergeRows` нь яг тэр дүрмийн хуулбар — админ
 *    жагсаалтаа толгой дээрхтэй ижил дарааллаар харах ёстой.
 */

export type TickerTone = 'danger' | 'warning' | 'success' | 'info' | 'default';

export const TICKER_TONES: readonly TickerTone[] = [
  'default',
  'info',
  'success',
  'warning',
  'danger',
];

/** Суурин мөрийн тохиргоо + өгөгдмөл утгууд (сервер нийлүүлж өгнө). */
export interface TickerBuiltin {
  key: string;
  default_tag_key: string;
  default_text_key: string;
  default_tone: TickerTone;
  is_active: number;
  /** NULL = дараагүй (өгөгдмөл орчуулга хэвээр). */
  text_mn: string | null;
  text_en: string | null;
  tag_mn: string | null;
  tag_en: string | null;
  tone: TickerTone | null;
  sort_order: number;
}

/** Админаас бичсэн чөлөөт мэдээ. */
export interface TickerMessage {
  id: number;
  text_mn: string;
  text_en: string | null;
  tag_mn: string | null;
  tag_en: string | null;
  tone: TickerTone;
  href: string | null;
  is_active: number;
  starts_on: string | null;
  ends_on: string | null;
  sort_order: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface TickerAdminData {
  builtins: TickerBuiltin[];
  messages: TickerMessage[];
}

/** Мөрийн засварт илгээх талбарууд (бүгд заавал биш — PATCH нь хэсэгчилсэн). */
export interface TickerFieldPatch {
  text_mn?: string | null;
  text_en?: string | null;
  tag_mn?: string | null;
  tag_en?: string | null;
  tone?: TickerTone | null;
  href?: string | null;
  is_active?: boolean;
  starts_on?: string | null;
  ends_on?: string | null;
}

export const TICKER_ADMIN_QUERY_KEY = ['/ticker/admin'] as const;

export const fetchTickerAdmin = () => apiFetch<TickerAdminData>('/ticker/admin');

export const createTickerMessage = (body: TickerFieldPatch) =>
  apiFetch<{ message: TickerMessage }>('/ticker/admin/messages', { method: 'POST', data: body });

export const updateTickerMessage = (id: number, body: TickerFieldPatch) =>
  apiFetch<{ message: TickerMessage }>(`/ticker/admin/messages/${id}`, {
    method: 'PATCH',
    data: body,
  });

export const deleteTickerMessage = (id: number) =>
  apiFetch<{ ok: true }>(`/ticker/admin/messages/${id}`, { method: 'DELETE' });

export const updateTickerBuiltin = (key: string, body: TickerFieldPatch) =>
  apiFetch<{ ok: true }>(`/ticker/admin/builtin/${key}`, { method: 'PATCH', data: body });

/** Дарж бичсэн бүхнийг цуцалж өгөгдмөл рүү. */
export const resetTickerBuiltin = (key: string) =>
  apiFetch<{ ok: true }>(`/ticker/admin/builtin/${key}`, { method: 'DELETE' });

export const saveTickerOrder = (order: { kind: 'builtin' | 'message'; key: string | number }[]) =>
  apiFetch<{ ok: true }>('/ticker/admin/order', { method: 'POST', data: { order } });

/* ------------------------------------------------------------------ */

export type TickerRow =
  | { kind: 'builtin'; id: string; rank: number; builtin: TickerBuiltin }
  | { kind: 'message'; id: string; rank: number; message: TickerMessage };

/** Сервер талын `withAdminLayer`-ийн эрэмбийн ХУУЛБАР (дээрх тайлбарыг үз). */
export function mergeRows(data: TickerAdminData | undefined): TickerRow[] {
  if (!data) return [];
  const rows: { row: TickerRow; seq: number }[] = [];

  data.messages.forEach((m, i) => {
    rows.push({
      row: { kind: 'message', id: `m-${m.id}`, rank: m.sort_order, message: m },
      seq: i,
    });
  });
  data.builtins.forEach((b, i) => {
    rows.push({
      row: { kind: 'builtin', id: `b-${b.key}`, rank: b.sort_order, builtin: b },
      seq: 1000 + i,
    });
  });

  rows.sort((a, b) => a.row.rank - b.row.rank || a.seq - b.seq);
  return rows.map((r) => r.row);
}
