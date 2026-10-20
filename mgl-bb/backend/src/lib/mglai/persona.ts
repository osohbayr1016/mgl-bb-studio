/**
 * MGL AI · АЖИЛТНЫГ ТАНИХ БА ХУВИЙН БОЛГОХ (§18).
 *
 * ⚠️ ЯАГААД ЭНЭ ФАЙЛ ТУСДАА ВЭ.  «Хэн вэ» гэдэг нь ХОЁР өөр асуулт:
 *      1. ЭРХ  — юу үзэж болох вэ.  Тэр нь `identity.ts` + `visibility.ts`,
 *         тэднийг ХЭЗЭЭ Ч энэ файлаар сольж болохгүй.
 *      2. КОНТЕКСТ — хэнтэй ярьж байгаа, тэр хүн юун дээр ажиллаж байна.
 *         Энэ файл нь ЗӨВХӨН хоёр дахийг хариулна.
 *    Хоёрыг хольбол «нэрээ мэдэж байгаа тул харж болно» гэсэн алдаанд
 *    хүрнэ.  Энд буцаж байгаа зүйл нь prompt-ын ЧИМЭГ, эрхийн ШИЙДВЭР БИШ.
 *
 * ⚠️ ЭНД ХУРААСАН МЭДЭЭЛЭЛ НЬ ХЭРЭГЛЭГЧИЙН ӨӨРИЙНХ НЬ.  Өөр хүний ачаалал,
 *    цалин, үнэлгээ, шийтгэл ОРОХГҮЙ — §18: «Never infer sensitive employee
 *    traits», «Do not use MGL AI to make autonomous hiring/firing decisions».
 *    Тиймээс `users` -ээс зөвхөн нэр, албан тушаал, багийг л уншина.
 *
 * ⚠️ НЭГ ХҮСЭЛТЭД НЭГ ЗАМ.  Гурван жижиг query биш, нэг `SELECT` дотор
 *    дэд-асуулгаар — `/context` нь чатын хамгийн халуун зам бөгөөд D1-ийн
 *    round-trip бүр нь хэрэглэгчийн хүлээх хугацаа.
 */
import type { Env, UserRole } from '../../types';

export interface EmployeePersona {
  userId: number;
  /** Дэлгэцэд харагдах нэр — байхгүй бол `username`. */
  name: string;
  role: UserRole;
  position: string | null;
  teamName: string | null;
  teamCode: string | null;
  /** Одоо хариуцаж буй, дуусаагүй ажлын тоо. */
  openTaskCount: number;
  /** Хамгийн ойрын товлосон хугацаа (ISO огноо) — байвал. */
  nextDueDate: string | null;
  /** Хэдэн идэвхтэй төсөлд гишүүн болох. */
  activeProjectCount: number;
}

/**
 * Ажилтны хувийн контекстыг цуглуулна.
 *
 * ⚠️ АЛДАА ГАРВАЛ `null` — чат УНАХГҮЙ.  Хувийн болголт нь тав тух,
 *    шаардлага биш.  `users` -ийн бүтэц өөрчлөгдөхөд MGL AI бүхэлдээ
 *    зогсох ёсгүй.
 *
 * ⚠️ «ДУУСААГҮЙ ДААЛГАВАР»-ЫГ `tasks`-ААС ШУУД МЭДЭХ БОЛОМЖГҮЙ.
 *    `tasks`-д явцын багана БАЙХГҮЙ — `weight_percent` нь ЖИН, явц биш.
 *    Явц нь `progress_entries`-ийн хамгийн сүүлийн БАТЛАГДСАН мөрөөс
 *    гардаг (`get_my_assignments`-ийн ижил хэлбэр).  «tasks.progress_percent»
 *    гэж бичих нь продакшнд 500 — 2026-09-08-нд яг тийм алдаа гарсан.
 *
 * ⚠️ SQL дотор `--` тайлбар БИЧИХГҮЙ.  Тайлбар нь ЭНД байна: D1-ийн
 *    query parser нь тайлбарт эмзэг, мөн template literal дотор ард
 *    хашилт бичих нь мөрийг тасална.
 */
export async function loadPersona(env: Env, userId: number): Promise<EmployeePersona | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT
         u.id,
         COALESCE(NULLIF(TRIM(u.full_name), ''), u.username) AS name,
         u.role,
         u.position,
         t.name_mn AS team_name,
         t.code AS team_code,
         (SELECT COUNT(*)
            FROM task_assignees ta
            JOIN tasks tk ON tk.id = ta.task_id
           WHERE ta.user_id = u.id
             AND COALESCE((SELECT pe.percentage FROM progress_entries pe
                            WHERE pe.task_id = tk.id AND pe.status = 'approved'
                            ORDER BY pe.date DESC, pe.created_at DESC, pe.id DESC
                            LIMIT 1), 0) < 100) AS open_tasks,
         (SELECT MIN(tk2.due_date)
            FROM task_assignees ta2
            JOIN tasks tk2 ON tk2.id = ta2.task_id
           WHERE ta2.user_id = u.id
             AND tk2.due_date IS NOT NULL
             AND COALESCE((SELECT pe2.percentage FROM progress_entries pe2
                            WHERE pe2.task_id = tk2.id AND pe2.status = 'approved'
                            ORDER BY pe2.date DESC, pe2.created_at DESC, pe2.id DESC
                            LIMIT 1), 0) < 100) AS next_due,
         (SELECT COUNT(DISTINCT pm.project_id)
            FROM project_members pm
            JOIN projects p ON p.id = pm.project_id
           WHERE pm.user_id = u.id AND p.status = 'active') AS active_projects
       FROM users u
       LEFT JOIN teams t ON t.id = u.team_id
      WHERE u.id = ?`,
    )
      .bind(userId)
      .first<{
        id: number;
        name: string | null;
        role: string;
        position: string | null;
        team_name: string | null;
        team_code: string | null;
        open_tasks: number | null;
        next_due: string | null;
        active_projects: number | null;
      }>();

    if (row === null) return null;

    return {
      userId: row.id,
      name: row.name?.trim() || `#${row.id}`,
      role: row.role as UserRole,
      position: row.position?.trim() || null,
      teamName: row.team_name?.trim() || null,
      teamCode: row.team_code?.trim() || null,
      openTaskCount: Number(row.open_tasks ?? 0),
      nextDueDate: row.next_due,
      activeProjectCount: Number(row.active_projects ?? 0),
    };
  } catch {
    // ⚠️ Схем өөрчлөгдвөл хувийн болголт унтарна, чат ажиллана.
    return null;
  }
}

/**
 * Persona-г систем зааврын НЭГ мөр болгоно.
 *
 * ⚠️ ТОО ХЭЛЭХГҮЙ, ЗӨВХӨН ЧИГЛҮҮЛНЭ.  «12 даалгавартай» гэж prompt-д
 *    бичих нь §35-ийн зөрчил рүү хальтардаг: тэр тоо нь хүсэлт ирэх
 *    агшинд аль хэдийн хуучирсан байж болно, харин загвар түүнийг
 *    БАРИМТ гэж давтана.  Оронд нь «энэ хүн ажилтай» гэсэн ЧАНАРЫН
 *    дохио өгч, ТОДОРХОЙ тоог `get_my_assignments` хэрэгслээр авахыг
 *    зөвлөнө.
 *
 * ⚠️ Огноо нь ҮЛ ХАМААРАХ: `nextDueDate` нь ХУВААРЬ, хурдан хуучирдаг
 *    хэмжигдэхүүн биш.  Түүнийг оруулах нь «надад юу яаралтай вэ» гэсэн
 *    асуултад загварыг зөв чиглүүлнэ.
 */
export function personaLine(p: EmployeePersona): string {
  // ⚠️ «ХЭРЭГЛЭГЧИЙН НЭР: X» гэсэн ШОШГОТ хэлбэр, «Чи X-тэй ярьж байна»
  //    гэсэн өгүүлбэр БИШ.  Горимын дүрэм нь аль хэдийн «Чи ажилтантай
  //    ярьж байна» гэж эхэлдэг тул хоёр «Чи …» өгүүлбэр зэрэгцэхэд 4B
  //    загвар өөрийгөө хэрэглэгчтэй АНДУУРЧ, «Намайг Амаржаргал гэдэг»
  //    гэж хариулж байв (хэмжсэн 2026-09-08).  Шошго нь ойлгомжтой.
  const bits = [`Хэрэглэгчийн нэр: ${p.name}.`];
  if (p.position) bits.push(`Албан тушаал: ${p.position}.`);
  if (p.teamName) bits.push(`Баг: ${p.teamName}${p.teamCode ? ` (${p.teamCode})` : ''}.`);

  // ⚠️ ТОО ХЭЛЭХГҮЙ, ЗӨВХӨН ЧИГЛҮҮЛНЭ (§35).  Prompt-д бичсэн тоо нь
  //    хүсэлт ирэх агшинд хуучирсан байж болох ба загвар түүнийг БАРИМТ
  //    гэж давтана.
  if (p.openTaskCount > 0) {
    bits.push('Түүнд дуусгаагүй даалгавар бий; тодорхой жагсаалтыг хэрэгслээр ав.');
  }
  if (p.nextDueDate) bits.push(`Хамгийн ойрын товлосон хугацаа: ${p.nextDueDate}.`);

  return bits.join(' ');
}
