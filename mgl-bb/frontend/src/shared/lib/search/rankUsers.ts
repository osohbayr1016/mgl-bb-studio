/**
 * Ажилтан хайх — НЭР / БАГ / албан тушаал / ажилтны кодоор, кирилл↔латин
 * фолдтой (`normalize.ts`), хамаарлаар эрэмбэлсэн богино жагсаалт.
 *
 * Яагаад `rank.ts`-ийн `rankSearchEntries` биш: тэр нь nav-ийн мөрөнд
 * тааруулагдсан (`icon`/`kind` шаарддаг, fuzzy subsequence).  Хүний нэрэнд
 * fuzzy нь худал таарц ихтэй («бат» → «Баттулга», «Батболд», «Сүхбат»
 * бүгд зөв, харин subsequence нь «Болор Тэнгис»-ийг ч барьдаг).  Энд
 * ЗӨВХӨН угтвар/дундах таарц, AND-токен.
 *
 * Оноо (бага нь дээр): нэрийн эхэнд 0 · нэрийн үгийн эхэнд 1 · нэрийн дунд 2
 * · багийн код/нэр 3 · албан тушаал 4 · username / ажилтны код 5.
 */
import { foldSearchText, foldSearchTokens } from './normalize';

export interface PickableUser {
  id: number;
  full_name: string;
  username: string;
  employee_id?: string | null;
  position?: string | null;
  profile_image?: string | null;
  team_code?: string | null;
  team_name_mn?: string | null;
  team_name_en?: string | null;
  teams?: Array<{ code: string; name_mn: string; name_en?: string | null }> | null;
}

interface Prepared<T extends PickableUser> {
  user: T;
  name: string;
  nameWords: string[];
  team: string;
  position: string;
  codes: string;
}

function prepare<T extends PickableUser>(u: T): Prepared<T> {
  const name = foldSearchText(u.full_name);
  const teamParts = [u.team_code, u.team_name_mn, u.team_name_en];
  for (const t of u.teams ?? []) teamParts.push(t.code, t.name_mn, t.name_en ?? null);
  return {
    user: u,
    name,
    nameWords: name ? name.split(' ') : [],
    team: foldSearchText(teamParts.filter(Boolean).join(' ')),
    position: foldSearchText(u.position ?? ''),
    codes: foldSearchText([u.username, u.employee_id ?? ''].join(' ')),
  };
}

/** Нэг токены оноо; таарахгүй бол null. */
function tokenScore<T extends PickableUser>(p: Prepared<T>, tok: string): number | null {
  if (p.name.startsWith(tok)) return 0;
  if (p.nameWords.some((w) => w.startsWith(tok))) return 1;
  if (p.name.includes(tok)) return 2;
  if (p.team && (p.team === tok || p.team.split(' ').some((w) => w.startsWith(tok)))) return 3;
  if (p.position && p.position.includes(tok)) return 4;
  if (p.codes && p.codes.split(' ').some((w) => w.startsWith(tok))) return 5;
  return null;
}

/**
 * `query` хоосон бол `users`-ийг өөрчлөлгүй (эхний `limit`) буцаана.
 * Үг БҮР аль нэг талбарт таарах ёстой (AND); эрэмбэ = токенуудын онооны
 * нийлбэр, тэнцвэл нэрээр.
 */
export function rankUsers<T extends PickableUser>(users: T[], query: string, limit = 8): T[] {
  const tokens = foldSearchTokens(query);
  if (tokens.length === 0) return users.slice(0, limit);
  const scored: Array<{ u: T; score: number }> = [];
  for (const u of users) {
    const p = prepare(u);
    let total = 0;
    let ok = true;
    for (const tok of tokens) {
      const s = tokenScore(p, tok);
      if (s === null) {
        ok = false;
        break;
      }
      total += s;
    }
    if (ok) scored.push({ u, score: total });
  }
  scored.sort((a, b) => a.score - b.score || a.u.full_name.localeCompare(b.u.full_name));
  return scored.slice(0, limit).map((s) => s.u);
}
