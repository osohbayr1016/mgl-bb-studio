/**
 * АЖИЛТНЫ БОГИНО НЭР — «Б.Бат» (2026-10-02, эзний шийдвэр: таск дээрх хувь нэмэрчийн нэр).
 *
 * DB-ийн `users.full_name` нь «Овог Нэр» (жишээ нь «Бат-Өлзий Билгүүн») — ТҮҮНИЙГ ӨӨРЧИЛДӨГГҮЙ.  Богино нэр нь
 * харуулахдаа л: овгийн ЭХНИЙ ҮСЭГ + цэг + нэр → «Б.Билгүүн».  Нэг үгтэй нэр хэвээр.
 *
 * ⚠️ Хүний ТАНИЛТ нь ХЭЗЭЭ Ч нэр биш — хэрэглэгчийн id.  Хоёр хүний богино нэр давхцаж болно («Б.Бат» × 2) —
 * `shortNameLabels` давхцсан үед бүтэн нэр рүү шилжүүлнэ, өөр хүнийг нэг гэж нэгтгэхгүй.
 */
import { formatDisplayName } from './formatting';

/** «Овог Нэр» → «О.Нэр».  Хоосон/нэг үгтэй бол хэвээр. */
export function formatStaffShortName(fullName: string | null | undefined): string {
  const s = (fullName ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return '';
  const i = s.indexOf(' ');
  if (i <= 0) return s;
  const ovog = s.slice(0, i);
  const ner = s.slice(i + 1).trim();
  if (!ner) return s;
  // Эхний үсэг (кирилл/латин) — Unicode-ийн code point-оор (суррогат хос эвдэхгүй).
  const first = Array.from(ovog)[0] ?? '';
  return `${first.toLocaleUpperCase('mn-MN')}.${ner}`;
}

export interface NamedPerson {
  user_id: number;
  full_name: string | null;
}

/**
 * Жагсаалтын хүн бүрийн харуулах шошго.  Богино нэр давхцвал ТЭДНИЙГ бүтэн («Нэр Овог») нэрээр харуулна —
 * өөр өөр хүн хоёр «Б.Бат» гэж ялгагдахгүй харагдахаас сэргийлнэ.  Ижил `user_id` нэг л хүн.
 */
export function shortNameLabels(people: readonly NamedPerson[]): Map<number, string> {
  const shorts = new Map<number, string>();
  const count = new Map<string, Set<number>>();
  for (const p of people) {
    const s = formatStaffShortName(p.full_name) || `#${p.user_id}`;
    shorts.set(p.user_id, s);
    const set = count.get(s) ?? new Set<number>();
    set.add(p.user_id);
    count.set(s, set);
  }
  const out = new Map<number, string>();
  for (const p of people) {
    const s = shorts.get(p.user_id)!;
    const clash = (count.get(s)?.size ?? 0) > 1;
    out.set(p.user_id, clash ? formatDisplayName(p.full_name ?? '') || s : s);
  }
  return out;
}
