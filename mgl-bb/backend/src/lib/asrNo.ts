import { asrProjectId } from './asrProjectName';

/**
 * Зохиогчийн хяналтын тайлангийн дугаарлалт.
 *
 * 2026-09-29-нөөс (эзний шийдвэр, миграц 0359): дугаар нь (төсөл, БАГ)
 * тус бүрээр, ТАЙЛАНГИЙН ОГНООНЫ дарааллаар 1..N — `DASR-BB-001`,
 * `DASR-BB-002`, `DASR-BA-001` …  Баг = тайлангийн ЭХНИЙ баг (sort_order),
 * толгойн Doc. No. ба файлын нэрэнд орж буй тэр баг.  11-р сарын очилтыг
 * 12-р сарынхаас ХОЙШ нөхөж оруулбал 11-р сарынх 001 болж, 12-р сарынх
 * автоматаар 002 болно — `renumberAsrProject` бүх дугаарыг дахин тооцно.
 * Өмнө нь төсөлд нэг дараалал, илгээх мөчийн `MAX(seq)+1` байсан тул
 * нөхсөн тайлан хамгийн сүүлийн дугаарыг авдаг байв.
 *
 * Дугаар нь ноорог биш (`status <> 'draft'`) бүх тайланд — буцаагдсан ба
 * Drive-аас нөхөж бүртгэсэн хуучин тайлан (0332, файлын дугаар нь
 * `legacy_doc_no`-д) ч орно.  Ноорог дугааргүй: хаягдсан ноорог дугаар идэхгүй.
 *
 * Товчлол нь 2026-09-28-наас **DASR** (Design Author’s Supervision Report).
 * ⚠️ ИХЭР: frontend `asrTemplate.ts` `ASR_ABBR`, `photoStamp.ts` `asrDocNoOf`.
 */

export function formatAsrDocNo(seq: number, teamCode?: string | null): string {
  const num = String(seq).padStart(3, '0');
  const team = (teamCode ?? '').trim();
  return team ? `DASR-${team}-${num}` : `DASR-${num}`;
}

/** Нэг төслийн дугаарлалтад хэрэгтэй багана — `renumberAsrProject` уншина. */
export interface AsrNumberingRow {
  id: number;
  status: string;
  report_date: string;
  seq: number | null;
  seq_team_id: number | null;
  doc_no: string | null;
  /** Тайлангийн ОДООГИЙН эхний баг (sort_order) — дугаарлах дараалал. */
  team_id: number | null;
  team_code: string | null;
}

export interface AsrNumberingChange {
  id: number;
  seq: number;
  seq_team_id: number | null;
  doc_no: string;
}

/**
 * Төслийн тайлангуудын ЗӨВ дугаарыг бодож, ӨӨРЧЛӨГДӨХ мөрүүдийг л буцаана
 * (цэвэр — `asrNo.test.ts`).
 *
 * Эрэмбэ баг тус бүр дотор: огноо → хуучин дугаар (ижил дараалалд байсан бол)
 * → id.  Хуучин дугаар нь тэнцүү огноотой тайлангуудыг байранд нь үлдээнэ
 * (нэг өдөр 5 баг тайлан бичсэн бол тэд хоорондоо солигдохгүй); шинээр
 * илгээсэн эсвэл өөр багаас шилжсэн тайлан ижил огноотой байгаа тайлангуудын
 * АРД орно.
 */
export function planAsrNumbering(rows: readonly AsrNumberingRow[]): AsrNumberingChange[] {
  const groups = new Map<number | null, AsrNumberingRow[]>();
  for (const r of rows) {
    if (r.status === 'draft') continue;
    const list = groups.get(r.team_id);
    if (list) list.push(r);
    else groups.set(r.team_id, [r]);
  }
  const prevRank = (r: AsrNumberingRow) =>
    r.seq != null && r.seq > 0 && r.seq_team_id != null && r.seq_team_id === r.team_id
      ? r.seq
      : Number.POSITIVE_INFINITY;
  const changes: AsrNumberingChange[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => {
      if (a.report_date !== b.report_date) return a.report_date < b.report_date ? -1 : 1;
      const pa = prevRank(a);
      const pb = prevRank(b);
      if (pa !== pb) return pa < pb ? -1 : 1;
      return a.id - b.id;
    });
    list.forEach((r, i) => {
      const seq = i + 1;
      const docNo = formatAsrDocNo(seq, r.team_code);
      if (r.seq !== seq || r.seq_team_id !== r.team_id || r.doc_no !== docNo) {
        changes.push({ id: r.id, seq, seq_team_id: r.team_id, doc_no: docNo });
      }
    });
  }
  return changes;
}

const NUMBERING_ROWS_SQL = `
  SELECT r.id, r.status, r.report_date, r.seq, r.seq_team_id, r.doc_no,
         (SELECT rt.team_id FROM author_supervision_report_teams rt
           WHERE rt.report_id = r.id
           ORDER BY rt.sort_order, rt.team_id LIMIT 1) AS team_id,
         (SELECT t.code FROM author_supervision_report_teams rt
            JOIN teams t ON t.id = rt.team_id
           WHERE rt.report_id = r.id
           ORDER BY rt.sort_order, rt.team_id LIMIT 1) AS team_code
    FROM author_supervision_reports r
   WHERE r.project_id = ?`;

/**
 * Төслийн бүх тайлангийн дугаарыг ОГНООНЫ дарааллаар дахин тооцно.
 * Илгээх, огноо/баг засах, устгах, нөхөж бүртгэх бүрийн ДАРАА дуудна.
 *
 * Нэг batch (D1-д транзакц): өөрчлөгдөх мөрүүдийг эхлээд мөргөлдөхгүй
 * `seq = -id, seq_team_id = NULL` байрлалд аваачаад (UNIQUE индекс мөр
 * тутамд шалгагддаг — «байрандаа» солиход дундуураа мөргөлдөнө), дараа нь
 * эцсийн утгыг бичнэ.  Холбоотой «өмнөх тайлангийн асуудал» мөрийн дугаарын
 * цооногийг ч дагуулна.  `updated_at`-ийг ЗОРИУД хөндөхгүй — агуулга
 * өөрчлөгдөөгүй, дугаар л шилжсэн.
 *
 * Зэрэг илгээлтээр төлөвлөгөө хуучирвал UNIQUE мөргөлдөөн → дахин уншаад
 * нэг удаа оролдоно; ямар ч тохиолдолд дараагийн дуудлага засна.
 *
 * @returns дугаар нь өөрчлөгдсөн тайлангийн тоо.
 */
export async function renumberAsrProject(db: D1Database, projectId: number): Promise<number> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { results } = await db.prepare(NUMBERING_ROWS_SQL).bind(projectId).all<AsrNumberingRow>();
    const plan = planAsrNumbering(results ?? []);
    if (plan.length === 0) return 0;
    const park = db.prepare(
      'UPDATE author_supervision_reports SET seq = ?, seq_team_id = NULL WHERE id = ?',
    );
    const put = db.prepare(
      'UPDATE author_supervision_reports SET seq = ?, seq_team_id = ?, doc_no = ? WHERE id = ?',
    );
    const follow = db.prepare('UPDATE asr_issue_resolutions SET prev_doc_no = ? WHERE prev_report_id = ?');
    try {
      await db.batch([
        ...plan.map((p) => park.bind(-p.id, p.id)),
        ...plan.map((p) => put.bind(p.seq, p.seq_team_id, p.doc_no, p.id)),
        ...plan.map((p) => follow.bind(p.doc_no, p.id)),
      ]);
      return plan.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt === 0 && /UNIQUE|constraint/i.test(msg)) continue;
      throw err;
    }
  }
  return 0;
}

/**
 * PDF-ийн файлын нэрийн үндэс — Word загварын нэрийн хэлбэр
 * `YYMMDD_PROJECT ID_ASR_BA_001` → `260925_MGL-251006_DASR_BB_015` (эзэн
 * 2026-09-28: шифр БИШ, төслийн ID + баг).  Дугаар олгогдоогүй бол `draft`;
 * нөхөж бүртгэсэн хуучин тайлан (`seq` NULL) файлын өөрийн дугаартай.
 *
 * ⚠️ ИХЭР: frontend `features/projects/asr/asrTemplate.ts` `asrFileStem`
 *    (Word-ийн нэр) — нэг тайлангийн PDF ба DOCX зэрэгцэж эрэмбэлэгдэнэ.
 */
export function asrFileStem(r: {
  reportDate: string | null;
  projectName: string | null;
  teamCode: string | null;
  seq: number | null;
  docNo: string | null;
}): string {
  const ymd = (r.reportDate || '').replace(/-/g, '').slice(2);
  const pid = asrProjectId(r.projectName).replace(/[\s/\\]+/g, '-');
  const num = r.seq != null ? String(r.seq).padStart(3, '0') : 'draft';
  const body =
    r.seq == null && r.docNo ? `${pid}_${r.docNo}` : `${pid}_DASR_${r.teamCode || 'XX'}_${num}`;
  return (
    `${ymd}_${body}`
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}._-]/gu, '')
      .slice(0, 90) || 'DASR'
  );
}

/**
 * Мөрийг `submitted` болгож, дугаарыг ОГНООНЫ дарааллаар олгоно.
 *
 * UPDATE нь ТҮР дугаар (төслийн `MAX(seq)+1`, `seq_team_id` NULL — UNIQUE
 * индекст мөргөлдөхгүй) өгөөд, амжилттай бол ШУУД `renumberAsrProject`
 * жинхэнэ байрыг (баг, огноо) бичнэ — тиймээс дуудагч дараа нь уншихад
 * (мэдэгдлийн бичвэр, хариу) дугаар аль хэдийн зөв.  Буцаагдсан тайланг
 * дахин илгээхэд дугаар нь хэвээр (огноо/баг өөрчлөгдөөгүй бол).
 *
 * ⚠️ ШИФР ЧУ ЭНД ХӨЛДӨНӨ.  `author_supervision_reports.shifr` нь 2026-09-03-
 *    аас хойш ЦООНОГ (snapshot) БИШ, ХҮЧИНГҮЙЛЭГЧ (override) утгатай:
 *      • NULL  ⇒ төслийн паспортын `drawing_no`-г ШУУД дагана;
 *      • утга  ⇒ хэрэглэгч гараар бичсэн, ЭСВЭЛ тайлан илгээгдэж хөлдсөн.
 *    Ноорог үүсгэх мөчид хуулах нь буруу байсан — баримт дуусахаас ӨМНӨ
 *    хөлдөж, паспорт дээрх үсгийн алдааны засвар нээлттэй ноорогт хэзээ ч
 *    хүрдэггүй байв.  Хөлдөх ЗӨВ мөч нь ИЛГЭЭХ мөч: тэр цагаас хойш
 *    баримт нь гарын үсэгтэй талбайн бичиг болох тул паспорт хожим
 *    өөрчлөгдсөнөөс болж хэвлэгдсэн шифр өөрчлөгдөж БОЛОХГҮЙ.
 *
 *    Хөлдөлт нь дугаар олголттой ЯГ НЭГ UPDATE дотор явна — тусад нь хийвэл
 *    хоёрын хооронд паспорт солигдох цонх үлдэнэ.
 *
 * @returns `changes > 0` эсэх — 0 бол мөр `draft|rejected` төлөвт байгаагүй
 *          (өөр хүн зэрэг илгээчихсэн) тул дуудагч 409 буцаана.
 */
export async function allocateAndSubmit(
  db: D1Database,
  reportId: number,
  projectId: number,
  submittedAt: string,
  /**
   * Төслийн товч танилцуулгын ЦООНОГ (`lib/asrProjectInfo.ts`, миграц 0256).
   * `null` бол хөлдөөхгүй — уншигч тал паспортоос амьдаар тооцсоор байна.
   */
  projectInfoJson: string | null = null,
): Promise<boolean> {
  const sql = `
    UPDATE author_supervision_reports
       SET seq = COALESCE(seq, (
             SELECT COALESCE(MAX(seq), 0) + 1
               FROM author_supervision_reports
              WHERE project_id = ?
           )),
           doc_no = COALESCE(doc_no, 'DASR-' || printf('%03d', COALESCE(seq, (
             SELECT COALESCE(MAX(seq), 0) + 1
               FROM author_supervision_reports
              WHERE project_id = ?
           )))),
           -- Шифрийн хөлдөлт.  COALESCE тул ХЭРЭГЛЭГЧИЙН бичсэн утга
           -- үргэлж хожино; зөвхөн NULL (паспортыг дагаж байсан) тайлан
           -- паспортын тэр агшны утгыг авна.  NULLIF(TRIM(...)) нь
           -- зөвхөн хоосон зайтай паспортын мөр «хөлдсөн хоосон мөр» болж
           -- дараа нь паспортоо дагахаа болихоос сэргийлнэ.
           -- ⚠️ Дээрхийн адил: тайлбарт BACKTICK бүү бич.
           shifr = COALESCE(shifr, NULLIF(TRIM((
             SELECT drawing_no FROM project_passport WHERE project_id = ?
           )), '')),
           -- Төслийн ЕРӨНХИЙ МЭДЭЭЛЛИЙН хөлдөлт (эзний шийдвэр 2026-09-04).
           -- Шифрийн яг тэр дүрэм: COALESCE тул НЭГ УДАА л бичигдэнэ —
           -- буцаагдсаныг дахин илгээхэд АНХНЫ илгээлтийн үеийн танилцуулга
           -- хэвээр үлдэнэ.  Дуудагч null өгвөл хөлдөхгүй, амьд хэвээр.
           project_info_json = COALESCE(project_info_json, ?),
           status = 'submitted',
           submitted_at = ?,
           -- Буцаагдсан тайланг ДАХИН илгээхэд өмнөх ХЯНАЛТЫН УЛ МӨРИЙГ
           -- цэвэрлэнэ.  Эс бөгөөс submitted төлөвтэй мөр reviewed_by,
           -- reviewed_at, review_note-оо хэвээр авч явж, «хянагдаагүй
           -- байхад хянасан хүнтэй» болно: жагсаалтын хариу reviewer_name
           -- буцааж, батлагч хүлээгдэж буй тайлан дээр өөрийнх нь буцаалтын
           -- тэмдэглэлийг одоогийнх мэт хардаг.  (Хэмжсэн 2026-08-26, локал
           -- prod хуулбар дээр буцаагаад дахин илгээхэд reviewed_by=3 ба
           -- буцаалтын тэмдэглэл үлдэж байв.)
           -- ⚠️ Энэ бол SQL БИШ, template literal — тайлбарт BACKTICK бүү
           --    бич, эс бөгөөс мөр тасарч файл компайл болохоо болино.
           reviewed_by = NULL,
           reviewed_at = NULL,
           review_note = NULL,
           updated_at = datetime('now')
     WHERE id = ?
       AND status IN ('draft', 'rejected')`;

  // ⚠️ Байрлалаар холбогдоно.  Дараалал: seq-ийн дэд query, doc_no-ийн дэд
  //    query, ШИФРИЙН дэд query, ТАНИЛЦУУЛГЫН JSON, submittedAt, reportId —
  //    нийт 6.  SET-ийн мөрийн дарааллыг сольвол энэ жагсаалтыг ЗААВАЛ
  //    дагуулж өөрчил.
  let submitted = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await db
        .prepare(sql)
        .bind(projectId, projectId, projectId, projectInfoJson, submittedAt, reportId)
        .run();
      submitted = (res.meta.changes ?? 0) > 0;
      break;
    } catch (err) {
      // UNIQUE мөргөлдөөн — өөр тайлан яг тэр хормын өмнө ижил ТҮР дугаарыг
      // авчихсан.  Дахин уншиж, дараагийнхыг авна.
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt === 0 && /UNIQUE|constraint/i.test(msg)) continue;
      throw err;
    }
  }
  // Retry-ээс ГАДУУР: дахин дугаарлалтын алдаа илгээлтийг «аль хэдийн
  // илгээгдсэн» 409 болгож хувиргах ёсгүй (төлөв нь аль хэдийн шилжсэн).
  if (submitted) await renumberAsrProject(db, projectId);
  return submitted;
}
