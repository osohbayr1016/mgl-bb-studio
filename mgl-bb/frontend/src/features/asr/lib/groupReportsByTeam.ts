import type { AsrReport, AsrStatus, AsrTeamOption } from '@/features/projects/asr/types';

/**
 * Зохиогчийн хяналтын тайлангуудыг БАГААР нэгтгэх (админ / захирал).
 *
 * Нэг тайлан олон багийг хамарч болно (`team_codes` = «BA,BB») — тиймээс тэр
 * тайлан хамарсан баг БҮРИЙН бүлэгт орно; багийн бүлгүүдийн нийлбэр нийт
 * тайлангаас их байж болно (төслийн самбарын «Багаар» очилттой ижил конвенц — `lib/asrBoard.ts`).
 * Баг сонгоогүй тайлан (голдуу ноорог) хамгийн сүүлд «баггүй» бүлэгт.
 *
 * Зөвхөн харуулалтын дүрэм — сервер юу ч шүүхгүй (`asrVisibleSql` админд бүгдийг өгдөг).
 */

export type AsrStatusCounts = Record<AsrStatus, number> & { total: number };

export interface AsrTeamReportGroup {
  /** `team:<id>` | `team:<code>` (сонголтод байхгүй код) | `none`. */
  key: string;
  /** `null` = «баг сонгоогүй» бүлэг. */
  team: Pick<AsrTeamOption, 'code' | 'name_mn' | 'name_en'> & { id: number | null } | null;
  reports: AsrReport[];
  counts: AsrStatusCounts;
  /** Бүлгийн хамгийн сүүлийн тайлангийн огноо (`YYYY-MM-DD`). */
  lastDate: string | null;
}

function emptyCounts(): AsrStatusCounts {
  return { total: 0, draft: 0, submitted: 0, approved: 0, rejected: 0 };
}

/** Шинэ → хуучин; ижил өдөр id-аар (сервер жагсаалтын эрэмбэтэй ижил). */
function newestFirst(a: AsrReport, b: AsrReport): number {
  if (a.report_date !== b.report_date) return a.report_date < b.report_date ? 1 : -1;
  return b.id - a.id;
}

export function teamCodesOf(r: Pick<AsrReport, 'team_codes'>): string[] {
  const seen = new Set<string>();
  for (const raw of (r.team_codes ?? '').split(',')) {
    const code = raw.trim();
    if (code) seen.add(code);
  }
  return [...seen];
}

/**
 * @param entries  аль хэдийн шүүгдсэн (төлөв / зохиогч / баг) тайлангууд
 * @param teams    төслийн багийн сонголт (`GET /projects/:id`-ийн `teams`) —
 *                 бүлгийн ДАРААЛЛЫГ тодорхойлно; тайлантай баг л бүлэг болно.
 * @param onlyTeam баг сонгосон шүүлт идэвхтэй бол тэр багийн бүлэг ГАНЦ үлдэнэ.
 *                 Шүүлт нь «тэр багийг хамарсан тайлан»-г үлдээдэг тул BB+BA
 *                 тайлан BA шүүлтэд ч BB бүлэгт дахин гарвал хэрэглэгч андуурна.
 */
export function groupReportsByTeam(
  entries: AsrReport[],
  teams: Pick<AsrTeamOption, 'id' | 'code' | 'name_mn' | 'name_en'>[],
  onlyTeam: string | null = null,
): AsrTeamReportGroup[] {
  const byCode = new Map<string, AsrReport[]>();
  const noTeam: AsrReport[] = [];

  for (const r of entries) {
    const codes = teamCodesOf(r);
    if (codes.length === 0) {
      if (onlyTeam == null) noTeam.push(r);
      continue;
    }
    for (const code of codes) {
      if (onlyTeam != null && code !== onlyTeam) continue;
      const list = byCode.get(code) ?? [];
      list.push(r);
      byCode.set(code, list);
    }
  }

  const build = (
    key: string,
    team: AsrTeamReportGroup['team'],
    reports: AsrReport[],
  ): AsrTeamReportGroup => {
    const sorted = [...reports].sort(newestFirst);
    const counts = emptyCounts();
    for (const r of sorted) {
      counts.total += 1;
      counts[r.status] += 1;
    }
    return { key, team, reports: sorted, counts, lastDate: sorted[0]?.report_date ?? null };
  };

  const groups: AsrTeamReportGroup[] = [];
  const used = new Set<string>();

  for (const t of teams) {
    const list = byCode.get(t.code);
    if (!list) continue;
    used.add(t.code);
    groups.push(build(`team:${t.id}`, { id: t.id, code: t.code, name_mn: t.name_mn, name_en: t.name_en }, list));
  }

  // Багийн сонголтод байхгүй код (багийг хожим устгасан г.м.) — тайлан алдагдахгүй.
  for (const code of [...byCode.keys()].filter((c) => !used.has(c)).sort()) {
    groups.push(
      build(`team:${code}`, { id: null, code, name_mn: code, name_en: null }, byCode.get(code) ?? []),
    );
  }

  if (noTeam.length > 0) groups.push(build('none', null, noTeam));
  return groups;
}
