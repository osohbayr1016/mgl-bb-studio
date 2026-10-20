import { formatUnits } from '../units';

/** Нэгж (1% = 10 000) → «12.5%». */
export const unitsPct = (u: number): string => `${formatUnits(u)}%`;

/** `YYYY-MM-DD HH:MM[:SS]` эсвэл ISO → «YYYY-MM-DD HH:MM» (серверийн UTC, хөрвүүлэлтгүй — аудитын лог). */
export function dateTime(v: string | null | undefined): string {
  if (!v) return '—';
  return v.replace('T', ' ').slice(0, 16);
}

/** Хурууны хээний богино харагдац. */
export const shortHash = (h: string | null | undefined): string => (h ? h.slice(0, 10) : '—');
