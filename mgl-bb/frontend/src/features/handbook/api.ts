/**
 * `/api/handbook` — Гарын авлагын API давхарга.
 *
 * Backend: `backend/src/routes/handbook.ts` + migration `0172_handbook.sql`.
 * Ажилтны уншилт (`GET /handbook`) нь СЕРВЕР ТАЛД аль хэдийн шүүгдсэн байдаг —
 * зөвхөн `status='published'` ба `role = өөрийн role ЭСВЭЛ '*'` мөрүүд ирнэ.
 * Тиймээс reader хуудас дахин role-оор шүүх шаардлагагүй.
 *
 * Query key-үүд мөн энд — mutation бүрийн дараа ижил түлхүүрээр invalidate.
 */

import { apiFetch } from '@/shared/api/client';

export const BASE = '/handbook';

/** «Бүгд» гэсэн орлуулагч — `role` болон `level_code` хоёуланд нь (route-той ижил). */
export const HANDBOOK_ANY = '*';

/** Үнэлгээний band кодууд — routes/handbook.ts-ийн `LEVEL_CODES`-ийн толь. */
export const HANDBOOK_LEVELS = ['INTERN', 'JUNIOR', 'MIDDLE', 'SENIOR', 'EXPERT'] as const;
export type HandbookLevelCode = (typeof HANDBOOK_LEVELS)[number];

/** `types.ts`-ийн `ALL_ROLES`-ийн толь (backend нь үүнийг л зөвшөөрнө). */
export const HANDBOOK_ROLES = [
  'admin',
  'engineer',
  'architect',
  'senior',
  'client',
  'worker',
] as const;

/**
 * Гарын авлагыг ҮНЭХЭЭР УНШИЖ ЧАДАХ role-ууд — админы «хэнд зориулсан бэ»
 * сонголт ЗӨВХӨН эднийг санал болгоно.
 *
 * `client` нь `/app/handbook`-д ороход `ProtectedRoute` түүнийг `/client` рүү
 * буцаадаг ба сервер `GET /api/handbook`-д 403 өгнө; `worker` нь
 * `WORKER_ALLOWED_PATHS`-д ч, `lib/workerScope.ts`-ийн цагаан жагсаалтад ч
 * байхгүй.  Тэдэнд зориулж бичсэн бичлэг хэнд ч хүрэхгүй тул сонголтод
 * гаргахгүй — `HANDBOOK_ROLES` нь backend-ийн зөвшөөрдөг БҮРЭН толь хэвээр
 * үлдэнэ (хуучин мөрийг харуулах / шошголоход хэрэгтэй).
 */
export const HANDBOOK_AUDIENCE_ROLES = ['admin', 'engineer', 'architect', 'senior'] as const;

export type HandbookStatus = 'draft' | 'published';

export interface HandbookEntry {
  id: number;
  /** users.role эсвэл '*'. */
  role: string;
  /** Band код эсвэл '*'. */
  level_code: string;
  title_mn: string;
  title_en: string | null;
  body_md: string;
  sort_order: number;
  status: HandbookStatus;
  updated_at: string;
}

/** POST-д бүтнээр, PUT-д хэсэгчлэн илгээнэ (сервер хэсэгчилсэн PUT дэмжинэ). */
export interface HandbookEntryInput {
  role: string;
  level_code: string;
  title_mn: string;
  title_en: string | null;
  body_md: string;
  sort_order: number;
  status: HandbookStatus;
}

/** TanStack Query түлхүүрүүд — invalidate хийхэд эндээс авна. */
export const handbookKeys = {
  /** Ажилтны уншилт (role-оор шүүгдсэн, published). */
  list: ['/handbook'] as const,
  /** Админы жагсаалт (draft орно). */
  admin: ['/handbook/admin'] as const,
};

// ---------------------------------------------------------------------------
// Уншилт
// ---------------------------------------------------------------------------

/** Ажилтанд харагдах бичлэгүүд — сервер тал role + status-аар шүүсэн. */
export const fetchHandbook = () => apiFetch<{ entries: HandbookEntry[] }>(BASE);

/** Админ — БҮХ бичлэг (draft орно). */
export const fetchHandbookAdmin = () => apiFetch<{ entries: HandbookEntry[] }>(`${BASE}/admin`);

// ---------------------------------------------------------------------------
// Бичилт (бүгд admin)
// ---------------------------------------------------------------------------

export const createHandbookEntry = (input: HandbookEntryInput) =>
  apiFetch<{ entry: HandbookEntry }>(BASE, { method: 'POST', data: input });

export const updateHandbookEntry = (id: number, input: Partial<HandbookEntryInput>) =>
  apiFetch<{ entry: HandbookEntry }>(`${BASE}/${id}`, { method: 'PUT', data: input });

export const deleteHandbookEntry = (id: number) =>
  apiFetch<{ ok: true }>(`${BASE}/${id}`, { method: 'DELETE' });
