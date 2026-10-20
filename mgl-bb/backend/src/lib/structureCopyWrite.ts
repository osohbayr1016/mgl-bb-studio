/**
 * Төслийн БҮТЭЦ хуулах — D1 УНШИЛТ/БИЧИЛТИЙН давхарга.
 *
 * `lib/structureCopyPlan.ts` (цэвэр төлөвлөгч)-ийн гаргасан `CopyPlan`-ыг
 * зорилтот төсөлд бичнэ.  ХОЁР дуудагч ЯГ энэ кодыг хуваалцана:
 *   • `POST /api/projects/:id/copy-structure` — гараар «Бүтэц татах»;
 *   • `lib/categoryTemplates.ts` — шинэ төсөл ангиллын ЗАГВАРААС
 *     автоматаар (2026-10-06, эзэн: «EZ төсөл үүсгэхэд төсөл 75-ын бүтэц»).
 *
 * 2026-10-06-нд `routes/projects.ts`-ээс үг үсгээр нь зөөсөн — зан төлөв
 * ХЭВЭЭР.  Хоёр зам нэг бичигчтэй тул «хуулсан мод» хоёр өөр хэлбэртэй
 * болох боломжгүй.
 *
 * ⚠️ ГҮЙЦЭТГЭГЧ ба ОГНОО ХЭЗЭЭ Ч хуулагдахгүй (эзний шийдвэр, 0254):
 *    `tasks.assigned_to`, `task_assignees`, `due_date`, `start_date`-ыг энд
 *    ОГТ bind хийхгүй.  Мэдэгдэл ч ТЭГ.
 */
import type {
  CopyPlan,
  CopySourceTree,
  PlannedComponent,
  PlannedDrawing,
} from './structureCopyPlan';

/** Нэг хүсэлтэд (гар хуулалт ч, ангиллын загвар ч) хуулж болох ажлын ДЭЭД тоо. */
export const MAX_COPY_TASKS = 2000;

/** D1-ийн 100 bind-ийн хязгаараас доогуур байлгах batch-ийн хэмжээ
 *  (`lib/assessmentRoster.ts`-ийн `runBatched`-ийн ижил тоо). */
export const COPY_BATCH_SIZE = 50;

/** `INSERT … RETURNING id`-г 50-аар хэсэглэн ажиллуулж, шинэ id-г
 *  ИЛГЭЭСЭН ДАРААЛЛААР нь бүртгэнэ (байрлалаар тааруулах загвар; блок хуулах
 *  `POST /api/blocks/:id/duplicate` 0401-ээс хойш үүнийг БИШ, нэг транзакцтай
 *  `lib/blockDuplicate.ts`-ийг хэрэглэдэг).
 *
 *  ⚠️ id-г ДУУДАГЧИЙН ЭЗЭМШДЭГ `sink` массивд хэсэг бүр commit хийгдмэгц
 *  ШУУД бичнэ, амжилтын төгсгөлд БИШ.  `db.batch()` бол ганц гүйлгээ тул
 *  50 + 13 гэж хэсэглэсэн үед 2 дахь хэсэг унатал 1 дэх хэсэг АЛЬ ХЭДИЙН
 *  бичигдсэн байна; id-г зөвхөн `return`-ээр өгвөл онцгой нөхцөл дуудагч
 *  дээр очиход тэр id-ууд алга болж, нөхөн цэвэрлэгээ өнчин блокуудыг
 *  устгаж чадахгүй үлддэг байв.  `sink` нь ЯГ үүнийг зассан: N дахь хэсэг
 *  унахад дуудагч 1..N-1 хэсгийн id-г гартаа барьж үлдэнэ. */
export async function copyInsertReturningIds(
  db: D1Database,
  stmts: D1PreparedStatement[],
  sink: number[],
): Promise<number[]> {
  for (let i = 0; i < stmts.length; i += COPY_BATCH_SIZE) {
    const chunk = stmts.slice(i, i + COPY_BATCH_SIZE);
    if (chunk.length === 0) continue;
    const res = await db.batch(chunk);
    for (const r of res) {
      const row = (r?.results as Array<{ id: number }> | undefined)?.[0];
      // Хэсэг commit хийгдсэн — эндээс алдвал ч өмнөх id-ууд `sink`-д үлдэнэ.
      if (!row?.id) throw new Error('INSERT … RETURNING id нь id буцаасангүй');
      sink.push(row.id);
    }
  }
  return sink;
}

/** RETURNING шаардлагагүй INSERT-үүдийг 50-аар хэсэглэн ажиллуулна. */
export async function copyRunBatched(db: D1Database, stmts: D1PreparedStatement[]): Promise<void> {
  for (let i = 0; i < stmts.length; i += COPY_BATCH_SIZE) {
    const chunk = stmts.slice(i, i + COPY_BATCH_SIZE);
    if (chunk.length > 0) await db.batch(chunk);
  }
}

/** НӨХӨН ЦЭВЭРЛЭГЭЭ: ЯГ энэ хүсэлтийн үүсгэсэн блокуудыг гүнээс нь устгана.
 *  id жагсаалтыг 50-аар хэсэглэнэ — bind-ийн 100 хязгаар. */
export async function deleteCreatedBlocksDeep(db: D1Database, blockIds: number[]): Promise<void> {
  for (let i = 0; i < blockIds.length; i += COPY_BATCH_SIZE) {
    const chunk = blockIds.slice(i, i + COPY_BATCH_SIZE);
    if (chunk.length === 0) continue;
    const ph = chunk.map(() => '?').join(',');
    await db
      .prepare(
        `DELETE FROM tasks WHERE component_id IN (
           SELECT co.id FROM components co
           INNER JOIN drawings d ON d.id = co.drawing_id
           WHERE d.block_id IN (${ph}))`,
      )
      .bind(...chunk)
      .run();
    await db
      .prepare(
        `DELETE FROM components WHERE drawing_id IN (
           SELECT id FROM drawings WHERE block_id IN (${ph}))`,
      )
      .bind(...chunk)
      .run();
    await db
      .prepare(`DELETE FROM drawings WHERE block_id IN (${ph})`)
      .bind(...chunk)
      .run();
    await db
      .prepare(`DELETE FROM blocks WHERE id IN (${ph})`)
      .bind(...chunk)
      .run();
  }
}

/** Эх модыг ТАВАН зэрэгцээ SELECT-ээр (багийн хувь + 4 түвшин) уншина.
 *
 * ⚠️ Сонголтыг SQL-ийн `IN (…)`-д БҮҮ хий: 1000+ id нь D1-ийн 100
 * bind-ийн хязгаарыг шууд давна.  Шүүлтийг төлөвлөгч JS дээр хийнэ.
 * `sort_order` нь NULL байж болох тул COALESCE — эх утга нь ХЭВЭЭР. */
export async function loadCopySourceTree(
  db: D1Database,
  sourceId: number,
): Promise<CopySourceTree> {
  const [sharesRes, blocksRes, drawingsRes, componentsRes, tasksRes] = await Promise.all([
    db
      .prepare(
        `SELECT pts.team_id, t.code AS team_code, t.name_mn AS team_name,
                pts.share_percent, COALESCE(pts.sort_order, 0) AS sort_order
         FROM project_team_shares pts
         INNER JOIN teams t ON t.id = pts.team_id
         WHERE pts.project_id = ?
         ORDER BY pts.sort_order, pts.id`,
      )
      .bind(sourceId)
      .all<CopySourceTree['team_shares'][number]>(),
    db
      .prepare(
        `SELECT id, name, weight_percent, COALESCE(sort_order, 0) AS sort_order,
                team_id, responsible_name
         FROM blocks WHERE project_id = ? ORDER BY sort_order, id`,
      )
      .bind(sourceId)
      .all<CopySourceTree['blocks'][number]>(),
    db
      .prepare(
        `SELECT d.id, d.block_id, d.name, d.weight_percent,
                COALESCE(d.sort_order, 0) AS sort_order
         FROM drawings d
         INNER JOIN blocks b ON b.id = d.block_id
         WHERE b.project_id = ? ORDER BY d.sort_order, d.id`,
      )
      .bind(sourceId)
      .all<CopySourceTree['drawings'][number]>(),
    db
      .prepare(
        `SELECT co.id, co.drawing_id, co.name, co.weight_percent,
                COALESCE(co.sort_order, 0) AS sort_order
         FROM components co
         INNER JOIN drawings d ON d.id = co.drawing_id
         INNER JOIN blocks b   ON b.id = d.block_id
         WHERE b.project_id = ? ORDER BY co.sort_order, co.id`,
      )
      .bind(sourceId)
      .all<CopySourceTree['components'][number]>(),
    db
      .prepare(
        `SELECT t.id, t.component_id, t.name, t.weight_percent,
                COALESCE(t.sort_order, 0) AS sort_order
         FROM tasks t
         INNER JOIN components co ON co.id = t.component_id
         INNER JOIN drawings d    ON d.id = co.drawing_id
         INNER JOIN blocks b      ON b.id = d.block_id
         WHERE b.project_id = ? ORDER BY t.sort_order, t.id`,
      )
      .bind(sourceId)
      .all<CopySourceTree['tasks'][number]>(),
  ]);
  return {
    team_shares: sharesRes.results ?? [],
    blocks: blocksRes.results ?? [],
    drawings: drawingsRes.results ?? [],
    components: componentsRes.results ?? [],
    tasks: tasksRes.results ?? [],
  };
}

/** Блок → зураг → эд анги → ажил, ТҮВШИН ТҮВШНЭЭР бичнэ.
 *
 * Мөр тус бүр `INSERT … RETURNING id`, 50-аар хэсэглэсэн `db.batch()`;
 * `db.batch()` нь илгээсэн дараалалаараа хариу буцаадаг тул хуучин id →
 * шинэ id-г БАЙРЛАЛААР нь холбоно (blocks.ts:225-298-ийн загвар).
 * Олон мөрийн VALUES INSERT нь bind-ийн хязгаарт мөргөөд, RETURNING-ийн
 * байрлалын холбоосыг ч алддаг.
 *
 * ⚠️ `createdBlockIds`-ыг ДУУДАГЧ эзэмшинэ: хэсэглэсэн `db.batch()`-ийн N
 * дахь хэсэг унахад 1..N-1 хэсгийн блокууд аль хэдийн commit хийгдсэн
 * байдаг тул дуудагчийн catch дэх нөхөн цэвэрлэгээ
 * (`deleteCreatedBlocksDeep`) тэдгээрийг ХАРЖ байх ёстой.  Зураг/эд
 * ангийн id-г цэвэрлэгээнд НЭРЛЭХ шаардлагагүй — блокоос гүнзгий бууна.
 *
 * ⚠️ `responsible_name` ЗААВАЛ хуулагдана (`POST /api/blocks/:id/duplicate` ч
 * 0401-ээс хойш хуулдаг).
 *
 * ⚠️ БАГИЙН ХУВЬ нь ЭНЭ функцээс ӨМНӨ бичигдсэн байх ёстой (дуудагчийн
 * үүрэг): `PUT /api/blocks/:id` нь блокийн `team_id`-г өөрчилж чадахгүй тул
 * ростерт байхгүй баг дор буусан блок «Бусад» хуурмаг табд гацна. */
export async function insertPlannedStructure(
  db: D1Database,
  targetId: number,
  plan: CopyPlan,
  createdBlockIds: number[],
): Promise<void> {
  const blockStmt = db.prepare(
    `INSERT INTO blocks (project_id, name, weight_percent, sort_order, team_id, responsible_name)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
  );
  /* `createdBlockIds` нь ихэвчлэн хоосон ирнэ; хоосон биш байсан ч энэ
   * дуудлагын блокууд түүний АРД нэмэгдэх тул байрлалын холбоог `offset`-оос. */
  const offset = createdBlockIds.length;
  const newBlockIds = await copyInsertReturningIds(
    db,
    plan.blocks.map((b) =>
      blockStmt.bind(targetId, b.name, b.weight_percent, b.sort_order, b.team_id, b.responsible_name),
    ),
    createdBlockIds,
  );

  const flatDrawings: Array<{ parentId: number; row: PlannedDrawing }> = [];
  plan.blocks.forEach((b, i) => {
    const parentId = newBlockIds[offset + i];
    if (parentId === undefined) return;
    for (const d of b.drawings) flatDrawings.push({ parentId, row: d });
  });
  const drawStmt = db.prepare(
    `INSERT INTO drawings (block_id, name, weight_percent, sort_order)
     VALUES (?, ?, ?, ?) RETURNING id`,
  );
  const newDrawingIds: number[] = [];
  await copyInsertReturningIds(
    db,
    flatDrawings.map((x) =>
      drawStmt.bind(x.parentId, x.row.name, x.row.weight_percent, x.row.sort_order),
    ),
    newDrawingIds,
  );

  const flatComponents: Array<{ parentId: number; row: PlannedComponent }> = [];
  flatDrawings.forEach((x, i) => {
    const parentId = newDrawingIds[i];
    if (parentId === undefined) return;
    for (const co of x.row.components) flatComponents.push({ parentId, row: co });
  });
  const compStmt = db.prepare(
    `INSERT INTO components (drawing_id, name, weight_percent, sort_order)
     VALUES (?, ?, ?, ?) RETURNING id`,
  );
  const newComponentIds: number[] = [];
  await copyInsertReturningIds(
    db,
    flatComponents.map((x) =>
      compStmt.bind(x.parentId, x.row.name, x.row.weight_percent, x.row.sort_order),
    ),
    newComponentIds,
  );

  /* ⚠️ `assigned_to`, `due_date`, `start_date`-ыг ОГТ bind ХИЙХГҮЙ —
   * NULL хэвээр үлдэнэ (эзний шийдвэр).  `task_assignees` мөр НЭГ Ч
   * бичихгүй.  Мэдэгдэл ч ТЭГ. */
  const taskStmt = db.prepare(
    `INSERT INTO tasks (component_id, name, weight_percent, sort_order)
     VALUES (?, ?, ?, ?)`,
  );
  const taskStmts: D1PreparedStatement[] = [];
  flatComponents.forEach((x, i) => {
    const parentId = newComponentIds[i];
    if (parentId === undefined) return;
    for (const t of x.row.tasks) {
      taskStmts.push(taskStmt.bind(parentId, t.name, t.weight_percent, t.sort_order));
    }
  });
  await copyRunBatched(db, taskStmts);
}
