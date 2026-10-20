/**
 * `/app/asr` самбарын статистик — `GET /api/author-supervision/stats`
 * (`backend/src/routes/authorSupervisionStats.ts`).
 *
 * Тоо бүрийн тодорхойлолт тэр файлын толгойд; товчхондоо «очилт» =
 * илгээгдсэн + батлагдсан ТАЛБАЙН ХЯНАЛТ (0362; ноорог тоологдохгүй —
 * `useAsrVisits`-тэй ижил дүрэм, тиймээс төслийн жагсаалтын тоотой
 * зөрөхгүй).  Цахим/оффис уулзалт, зургийн өөрчлөлт нь `by_type`-д тусдаа.
 */
import { useApiQuery } from '@/shared/api/useApi';
import type { AsrRedBookStatus, AsrReportType, AsrStatus } from '@/features/projects/asr/types';

export interface AsrStatsTotals {
  /** Бүх төрлийн илгээсэн/батлагдсан тайлан (0362). */
  reports: number;
  /** Талбайн хяналт л. */
  visits: number;
  approved: number;
  awaiting_review: number;
  /** Үзэгчийн ноорог (админд бүх ноорог). */
  my_drafts: number;
  projects_visited: number;
  authors: number;
  first_visit: string | null;
  last_visit: string | null;
  this_month: number;
  prev_month: number;
  last_30_days: number;
  prev_30_days: number;
  photos_total: number;
}

export interface AsrStatsTeam {
  team_id: number;
  code: string;
  name_mn: string;
  name_en: string | null;
  visits: number;
  last_visit: string | null;
}

export interface AsrStatsMonth {
  /** `YYYY-MM` — сүүлийн 12 сар, хоосон сар 0-оор нөхөгдсөн. */
  month: string;
  visits: number;
  approved: number;
}

export interface AsrStatsPerson {
  user_id: number;
  full_name: string;
  avatar_url: string | null;
  visits: number;
  projects: number;
  last_visit: string | null;
}

export interface AsrStatsRecent {
  id: number;
  doc_no: string | null;
  report_date: string;
  status: AsrStatus;
  project_id: number;
  project_name: string;
  author_name: string | null;
  photo_count: number;
  team_codes: string | null;
  red_book_status: AsrRedBookStatus;
  report_type: AsrReportType;
  meeting_platform: string | null;
}

/** «Төрлөөр» самбарын мөр (0362) — 4 төрөл ҮРГЭЛЖ, тогтмол дараалалтай. */
export interface AsrStatsType {
  type: AsrReportType;
  total: number;
  this_month: number;
  last_date: string | null;
}

export interface AsrStatsResponse {
  today: string;
  totals: AsrStatsTotals;
  /**
   * «Багаар», «Бүрдэл» (`review` + `signatures`), «Хамгийн идэвхтэй зохиогчид»
   * нь ЗӨВХӨН админд (эзний шийдвэр 2026-09-29) — бусдад сервер `null` /
   * хоосон массив буцаана.  Бусад тоо нь үзэгчийн багийн тайлангаас.
   */
  review: { sample: number; avg_days: number | null; max_days: number | null } | null;
  /** `absent` = «Талбай дээр улаан дэвтэр байгаагүй» (0366); хуучин worker-т байхгүй. */
  red_book: { verified: number; signed: number; absent?: number; missing: number };
  signatures: { arch: number; site: number; both: number } | null;
  by_team: AsrStatsTeam[];
  by_month: AsrStatsMonth[];
  by_person: AsrStatsPerson[];
  recent: AsrStatsRecent[];
  /** ⚠️ 0362-оос өмнөх worker-т байхгүй — `?? []`. */
  by_type?: AsrStatsType[];
}

export const ASR_STATS_KEY = ['asr', 'stats'] as const;

export function useAsrStats(enabled = true) {
  return useApiQuery<AsrStatsResponse>(ASR_STATS_KEY, '/author-supervision/stats', {
    enabled,
    staleTime: 60_000,
  });
}
