import { fmtPtsNumber } from '@/features/reports/lib/format';
import type { NonProjectStage, NonProjectStatus } from '@/features/non-project-work/types';

/**
 * «Өдрийн тайлан» табын ЦАГААР бүртгэгддэг хоёр ажил — засвар ба төслийн бус
 * ажил (`GET /profiles/:id/hours-log`, backend `routes/profiles.ts`).  Тоо бүр
 * серверт хадгалагдсан snapshot — энд юу ч дахин бодохгүй.
 */

export interface RepairLogItem {
  /** `mark` = «Ажилласан» тэмдэглэгээ боловч энэ өдөр 0 цаг ногдсон (0348). */
  kind: 'entry' | 'mark';
  id: number;
  date: string;
  created_at: string;
  hours: number;
  hours_source: 'manual' | 'auto' | 'backfill';
  /** Өдрийн дундаж ханш (snapshot).  Хувиас нөхсөн мөрөнд null. */
  daily_rate: number | null;
  rate_source: string | null;
  computed_pct: number | null;
  description: string | null;
  project_id: number | null;
  repair_project_id: number | null;
  project_name: string | null;
  is_repair_project: boolean;
  task_id: number | null;
  task_name: string | null;
}

export interface NonProjectLogItem {
  id: number;
  date: string;
  category: string;
  category_label: string;
  note: string | null;
  start_time: string | null;
  end_time: string | null;
  minutes: number;
  report: string | null;
  status: NonProjectStatus;
  stage: NonProjectStage;
  review_note: string | null;
  /** Батлах үеийн ханш ба олгосон хувь — батлагдаагүй мөрөнд null. */
  daily_rate: number | null;
  rate_source: string | null;
  computed_pct: number | null;
  created_at: string;
}

export interface HoursLogResponse {
  repairs: RepairLogItem[];
  non_project: NonProjectLogItem[];
}

/**
 * Хувь — бүтээмжийн ханш ихэвчлэн маш жижиг (прод 2026-09-28: 0.0001–0.02 %/өдөр).
 * `fmtPts` 3 оронд таслаад «0%» болгодог тул 0.001-ээс доош утгыг 2 чухал цифрээр
 * («0.00029%») харуулна.  Жинхэнэ 0 л «0%».
 */
export function fmtRate(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v === 0) return '0%';
  if (Math.abs(v) >= 0.001) return `${fmtPtsNumber(v)}%`;
  return `${Number(v.toPrecision(2)).toString()}%`;
}

/** Өдрийн нийлбэрт орох цаг — татгалзсан төслийн бус ажил тооцогдохгүй. */
export function npwHours(item: NonProjectLogItem): number {
  return item.status === 'rejected' ? 0 : item.minutes / 60;
}

/** Өдрийн нийлбэрт орох олгосон хувь — зөвхөн батлагдсан. */
export function npwCredited(item: NonProjectLogItem): number {
  return item.status === 'approved' ? (item.computed_pct ?? 0) : 0;
}
