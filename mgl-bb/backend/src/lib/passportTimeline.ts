/* =============================================================
 * «1.3 Төслийн хугацаа» — БАГАНА ↔ JSON хөрвүүлгийн ЦОРЫН ГАНЦ газар
 * -------------------------------------------------------------
 *  Паспортын эхлэх/дуусах/сунгах огноо нь ХОЁР дүрслэлтэй:
 *
 *    (1) `project_passport.start_date / finish_date / extension_date`
 *        БАГАНА — SQL-ээр уншигддаг (`deadlines.ts` эрсдэлийн шүүлт,
 *        `company.ts` хугацаа хэтрэлт, `projectCharts.ts`, захиалагчийн
 *        PDF `lib/clientReportHtml.ts`).
 *    (2) `project_passport.timeline_json` — «Мэдээлэл» табын 1.3
 *        ХҮСНЭГТ (мөр нэмж хасаж, шошгыг өөрчилж болно).  Гүйцэтгэлийн
 *        тайлангийн §1 (`features/performance-reports/lib/introAuto.ts`)
 *        энэ хүснэгтийг ЭХЭЛЖ уншина.
 *
 *  ⚠️ ХОЁУЛАА бичигддэг тул хоёрын дүрэм НЭГ файлд байх ЁСТОЙ.  Урьд нь
 *  `PUT /api/projects/:id/passport` нь JSON → багана руу буулгадаг,
 *  `PUT /api/timeline/projects/:id/schedule` нь ЗӨВХӨН баганыг бичдэг
 *  байсан.  Үр дүнд нь 1.3 хүснэгтээ нэг удаа бөглөсөн төсөл дээр
 *  «Хуваарь» цонхноос тавьсан огноог гүйцэтгэлийн тайлан ХАРАХГҮЙ, харин
 *  захиалагчийн PDF ХАРНА — нэг төсөл хоёр өөр хугацаа хэвлэдэг байв.
 *  Frontend-ийн `mergeTimelineWithLegacy` нь зөвхөн хүн «Мэдээлэл» табыг
 *  НЭЭЖ ХАДГАЛСАН үед л ажилладаг тул засвар биш, нөмрөг байсан.
 *
 *  ⚠️ ИЖРҮҮД (id-ууд ачаалал үүрсэн — шошгыг өөрчилж болно, id-г ҮГҮЙ):
 *    • `frontend/src/features/projects/components/passport/passportSections.ts`
 *      — `defaultTimelineRows()` / `blankTimelineRow()` / `mergeTimelineWithLegacy`
 *    • `backend/src/lib/projectIdentity.ts` — `IDENTITY_DEFAULT_TIMELINE`
 *    • `frontend/src/features/performance-reports/types/introOverride.ts`
 *      — `DEFAULT_TIMELINE`
 * ============================================================= */

/** «1.3 Төслийн хугацаа» хүснэгтийн нэг мөр.
 *  ⚠️ frontend `shared/types/index.ts`-ийн `ProjectTimelineRow`-той ИЖРҮҮД —
 *  талбарын нэр зөрвөл JSON дээр тип шалгалт байхгүй тул чимээгүй
 *  `undefined` болно. */
export interface PassportTimelineRow {
  /** `tl-start` / `tl-finish` / `tl-ext…` — багана руу буулгах түлхүүр. */
  id: string;
  labelEn: string;
  labelMn: string;
  date: string;
}

/** Уншихад л хэрэгтэй бүтцийн доод хэмжээ — дуудагч өөрийн (бүтцээрээ
 *  ижил) төрлөө дамжуулж чадна. */
export type TimelineRowLike = Readonly<PassportTimelineRow>;

export const TL_START_ID = 'tl-start';
export const TL_FINISH_ID = 'tl-finish';
/** Сунгалтын мөрүүд — `tl-ext`, `tl-ext-x9f2k`… (жишиг баримт дээр ХОЁР). */
export const TL_EXT_PREFIX = 'tl-ext';

/** Паспортын гурван огооны БАГАНА. */
export interface PassportDateColumns {
  start_date: string | null;
  finish_date: string | null;
  extension_date: string | null;
}

/** Хүснэгт огт байхгүй үеийн гурван мөр.
 *  ⚠️ `passportSections.ts`-ийн `defaultTimelineRows()`-ийн ХУУЛБАР:
 *  id, `labelEn`, `labelMn` гурав ЯГ таарах ёстой — эс бөгөөс сервер
 *  үүсгэсэн мөрийг «Мэдээлэл» таб танихгүй, хоёр дахь Эхлэх мөр урган
 *  гарна. */
export function defaultTimelineRows(): PassportTimelineRow[] {
  return [
    { id: TL_START_ID, labelEn: 'Start', labelMn: 'Эхлэх', date: '' },
    { id: TL_FINISH_ID, labelEn: 'Finish', labelMn: 'Дуусах', date: '' },
    { id: TL_EXT_PREFIX, labelEn: 'Extension', labelMn: 'Сунгалт', date: '' },
  ];
}

/** JSON-оос ирсэн утгыг мөр болгоно (тоо, null, объект бүгд '' болно). */
function jstr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Хадгалахад ч, уншихад ч ЯГ ижил дүрэм — хуучин / гэмтсэн мөр чимээгүй
 *  хаягдаж, талбарууд үргэлж бүтэн ирнэ. */
export function normaliseTimelineRows(input: unknown): PassportTimelineRow[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((raw, i): PassportTimelineRow | null => {
      if (!raw || typeof raw !== 'object') return null;
      const r = raw as Record<string, unknown>;
      const row: PassportTimelineRow = {
        id: jstr(r.id) || `tl-${i}`,
        labelEn: jstr(r.labelEn),
        labelMn: jstr(r.labelMn),
        date: jstr(r.date),
      };
      // Огноогүй ч ШОШГОТОЙ мөр нь хүчинтэй (хоосон нүд бөглөх ээлж).
      return row.labelEn || row.labelMn || row.date ? row : null;
    })
    .filter((r): r is PassportTimelineRow => r !== null);
}

/** `timeline_json` баганын түүхий утгыг мөр болгоно.  Буруу JSON бол
 *  хоосон массив — паспорт бол баримт, задалж чадахгүй нь 500 биш. */
export function parseTimelineJson(raw: string | null | undefined): PassportTimelineRow[] {
  if (!raw) return [];
  try {
    return normaliseTimelineRows(JSON.parse(raw));
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  Чиглэл 1: ХҮСНЭГТ → БАГАНА                                         */
/* ------------------------------------------------------------------ */

/**
 * 1.3 хүснэгтээс гурван баганыг гаргана.
 *
 * ⚠️ `routes/projects.ts`-ийн паспорт хадгалах замаас ЗӨӨГДСӨН — зан
 * чанар нь бит-ийн хэмжээнд ХЭВЭЭР:
 *   • Дараалал: тогтмол id-гаар (`tl-start`…) → байхгүй бол БАЙРЛАЛААР
 *     (0 / 1 / 2).  Хуучин, id нь `tl-0`, `tl-1` болж хадгалагдсан мөрүүд
 *     байрлалаараа зөв буудаг.
 *   • Сунгалт нь ОГНООТОЙ СҮҮЛИЙН `tl-ext*` мөр — `find` (ЭХНИЙ) хийвэл
 *     хэрэглэгч 2 дахь сунгалтаа бөглөсөн үед багана NULL болж,
 *     захиалагчийн тайлангаас «Сунгалт» мөр чимээгүй алга болно.
 *
 * @returns Хүснэгт ХООСОН бол `null` — дуудагч хуучин шууд талбарууд руугаа
 *   (`body.start_date` гэх мэт) буцаж унана.
 */
export function columnsFromTimelineRows(
  rows: readonly TimelineRowLike[],
): PassportDateColumns | null {
  if (rows.length === 0) return null;
  const pick = (id: string, pos: number): string | null => {
    const byId = rows.find((r) => r.id === id);
    if (byId) return byId.date || null;
    return rows[pos]?.date || null;
  };
  const extRows = rows.filter((r) => r.id.startsWith(TL_EXT_PREFIX) && r.date);
  return {
    start_date: pick(TL_START_ID, 0),
    finish_date: pick(TL_FINISH_ID, 1),
    extension_date: (extRows[extRows.length - 1]?.date ?? rows[2]?.date ?? null) || null,
  };
}

/* ------------------------------------------------------------------ */
/*  Чиглэл 2: БАГАНА → ХҮСНЭГТ                                         */
/* ------------------------------------------------------------------ */

/** `undefined` = хөндөхгүй, `null` = цэвэрлэх, ISO мөр = тавих —
 *  `routes/timeline.ts`-ийн `readDateField`-ийн гурван төлөвтэй ижил. */
export interface ScheduleUpdate {
  start_date?: string | null;
  finish_date?: string | null;
}

/**
 * «Хуваарь» цонхноос тавьсан огноог 1.3 хүснэгт рүү буулгана.
 *
 * ДҮРЭМ:
 *   • Хүснэгт БАЙВАЛ — `tl-start` / `tl-finish` мөрийг БАЙРАН ДЭЭР НЬ
 *     засна.  Мөр нэмэхгүй, хасахгүй, ДАРААЛЛЫГ хөндөхгүй: хэрэглэгчийн
 *     гараар бичсэн шошго, нэмэлт сунгалтын мөрүүд бүрэн үлдэнэ.
 *   • Тогтмол id олдохгүй бол БАЙРЛАЛААР (0 / 1) — `columnsFromTimelineRows`
 *     яг тэр нөхөлтөөр УНШДАГ тул бичихдээ өөр газар онивол хоёр чиглэл
 *     зөрнө (энэ файл байгаа шалтгаан).  Тэр байрлалд СУНГАЛТЫН мөр
 *     сууж байвал эсвэл байрлал огт байхгүй бол канон мөрийг өөрийнх нь
 *     байрлалд ОРУУЛНА — эс бөгөөс огноо баганад бичигдээд хүснэгтэд
 *     тусахгүй, буцаад ижил зөрүү үүснэ.
 *   • Хүснэгт БАЙХГҮЙ бол `defaultTimelineRows()`-ийн ГУРВАН мөрийг
 *     үүсгэнэ — «Мэдээлэл» таб танихын тулд id, шошго ЯГ ижил байх ёстой.
 *   • Хоёулаа хоосон утгатай ШИНЭ хүснэгт бол `[]` буцаана: огноогүй 3
 *     хоосон мөр бичих нь `timeline_json`-ыг шалтгаангүй дүүргэнэ.
 *   • Хөндөөгүй (`undefined`) талбарыг ҮЛ ХӨНДӨНӨ.  Продакшнд паспортын
 *     огноо баталгаажаагүй чөлөөт текст ('-', '2026.07.09') байдаг —
 *     зөвхөн дуусах огноог өөрчлөхөд эхлэх мөрийн ийм утга устах ёсгүй.
 *
 * @param seed Одоогийн ГУРВАН БАГАНА — ЗӨВХӨН хүснэгт ШИНЭЭР үүсэх үед
 *   (`rows.length === 0`) хэрэглэгдэнэ.
 *   ⚠️ Энэ нь заавал байх ёстой: продакшны 15 паспорт БҮГД
 *   `timeline_json IS NULL` бөгөөд `routes/timeline.ts` нь `extension_date`-ыг
 *   хэзээ ч дамжуулдаггүй.  Үргүй үүсгэвэл шинэ хүснэгт «Сунгалт»-ыг
 *   ХООСОН гэж зарлана — хүснэгтийг ЭХЭЛЖ уншдаг бүх талбар (тайлангийн §1,
 *   захиалагчийн PDF-ийн 1.3, `projectIdentity`, «Мэдээлэл» таб) сунгалтын
 *   огноог алдана, дараагийн `PUT /:id/passport` нь `columnsFromTimelineRows`-
 *   оор баганыг ч НӨХӨЖ УСТГАНА.
 *   ⚠️ Хүснэгт БАЙГАА үед үрийг хэрэглэхгүй — тэнд хэрэглэгчийн гараар
 *   бичсэн мөрүүд эрхтэй, багана нь тэдгээрийн ҮР ДҮН болохоос эх биш.
 */
export function applyScheduleToTimelineRows(
  rows: readonly TimelineRowLike[],
  update: ScheduleUpdate,
  seed?: Partial<PassportDateColumns>,
): PassportTimelineRow[] {
  const touchedStart = update.start_date !== undefined;
  const touchedFinish = update.finish_date !== undefined;
  if (!touchedStart && !touchedFinish) return rows.map((r) => ({ ...r }));

  const created = rows.length === 0;
  const next: PassportTimelineRow[] = created ? defaultTimelineRows() : rows.map((r) => ({ ...r }));

  if (created && seed) {
    /* Хөндөөгүй талбарыг баганаас нь авч суулгана; сунгалтыг ҮРГЭЛЖ —
     * `ScheduleUpdate`-д сунгалт огт байхгүй тул түүнийг «хөндсөн» гэж
     * үзэх боломж БАЙХГҮЙ. */
    const seedInto = (id: string, value: string | null | undefined) => {
      const at = next.findIndex((r) => r.id === id);
      const cur = next[at];
      if (cur) next[at] = { ...cur, date: value ?? '' };
    };
    if (!touchedStart) seedInto(TL_START_ID, seed.start_date);
    if (!touchedFinish) seedInto(TL_FINISH_ID, seed.finish_date);
    seedInto(TL_EXT_PREFIX, seed.extension_date);
  }

  const setDate = (id: string, pos: number, value: string | null) => {
    const date = value ?? '';
    const byId = next.findIndex((r) => r.id === id);
    if (byId !== -1) {
      const cur = next[byId];
      if (cur) next[byId] = { ...cur, date };
      return;
    }
    /* Байрлалын нөхөлт — `columnsFromTimelineRows` ЯГ ингэж уншдаг тул
     * бичихдээ өөр газар онивол хоёр чиглэл зөрнө.  ГЭХДЭЭ СУНГАЛТЫН
     * мөрийг хэзээ ч дарж бичихгүй: жишиг баримт дээр 1.3 нь [Эхлэх,
     * Сунгалт] хэлбэртэй байвал байрлал 1 нь сунгалт болох бөгөөд дуусах
     * огноог тэнд бичих нь хэрэглэгчийн сунгалтыг устгана. */
    const atPos = next[pos];
    if (atPos && !atPos.id.startsWith(TL_EXT_PREFIX)) {
      next[pos] = { ...atPos, date };
      return;
    }
    /* Суух газар алга — КАНОН мөрийг өөрийнх нь БАЙРЛАЛД оруулна (арын
     * талд нааж болохгүй: `columnsFromTimelineRows`-ийн сунгалтын сүүлчийн
     * нөхөлт `rows[2]`-ыг уншдаг тул хойно тавьсан «Дуусах» мөр сунгалт
     * болж хувирна). */
    const canon = defaultTimelineRows().find((r) => r.id === id);
    if (!canon) return;
    next.splice(Math.min(pos, next.length), 0, { ...canon, date });
  };

  if (touchedStart) setDate(TL_START_ID, 0, update.start_date ?? null);
  if (touchedFinish) setDate(TL_FINISH_ID, 1, update.finish_date ?? null);

  if (created && next.every((r) => !r.date)) return [];
  return next;
}
